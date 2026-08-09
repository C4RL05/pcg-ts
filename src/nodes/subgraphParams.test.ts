/**
 * Resolving an exposed-param DECLARATION into a schema. The rule the
 * whole design rests on is that the schema is DERIVED from the targets'
 * registered schemas and never hand-written, so these tests are mostly
 * about what the merge refuses: an exposed param must not admit a value
 * one of its targets would reject.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  GraphValidationError,
  type NodeHandle,
  defineNode,
  subgraphNode,
} from "../graph/index.js";
import { fieldFromJson } from "./fieldJson.js";
import {
  filterByDensity,
  jitterPoints,
  meshPrimitive,
  pointGrid,
  pointScatterInBounds,
  setAttribute,
  surfaceSample,
  transformPoints,
} from "./index.js";
import { dataInput } from "../runtime/dataInput.js";
import { resolveExposedParam } from "./subgraphParams.js";

describe("resolveExposedParam — a single target", () => {
  it("derives type, bounds and field capability from the target's registered schema", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, undefined, "sc");
    const resolved = resolveExposedParam(inner, {
      name: "count",
      targets: [{ node: sc, param: "count" }],
      description: "How many candidate points to scatter.",
    });
    expect(resolved.schema).toEqual({
      type: "i32",
      default: 100,
      description: "How many candidate points to scatter.",
      min: 0,
    });
    expect(resolved.targets).toEqual([{ node: { id: "sc" }, param: "count", acceptsField: false }]);
  });

  it("takes the default from the target's LIVE value, so a tuned graph keeps its tuning", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, { count: 200 }, "sc");
    const resolved = resolveExposedParam(inner, {
      name: "count",
      targets: [{ node: sc, param: "count" }],
      description: "How many candidate points to scatter.",
    });
    // Not the registered schema default of 100.
    expect(resolved.schema.default).toBe(200);
  });

  it("lets the author override the default, and validates it against the merged schema", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, { count: 200 }, "sc");
    const decl = {
      name: "count",
      targets: [{ node: sc, param: "count" }],
      description: "How many candidate points to scatter.",
    };
    expect(resolveExposedParam(inner, { ...decl, default: 12 }).schema.default).toBe(12);
    expect(() => resolveExposedParam(inner, { ...decl, default: -1 })).toThrow(
      /exposed param "count": default -1 is below min 0/,
    );
  });

  it("carries the target's enum values through unchanged", () => {
    const inner = new Graph();
    const f = inner.add(filterByDensity, undefined, "f");
    const resolved = resolveExposedParam(inner, {
      name: "mode",
      targets: [{ node: f, param: "mode" }],
      description: "How points are kept.",
    });
    expect(resolved.schema.type).toBe("enum");
    expect(resolved.schema.enum).toEqual(["threshold", "probabilistic"]);
  });

  it("keeps an item-list default empty, whatever is bound at wrap time", () => {
    const inner = new Graph();
    const di = inner.add(dataInput, undefined, "di");
    inner.setParam(di, "items", [{ kind: "value", value: 1, tags: new Set(), rev: 1 }] as never);
    const resolved = resolveExposedParam(inner, {
      name: "items",
      targets: [{ node: di, param: "items" }],
      description: "Items injected by the host.",
    });
    expect(resolved.schema).toEqual({
      type: "items",
      default: [],
      description: "Items injected by the host.",
    });
  });

  it("refuses to take a default from a target holding a Field, and says what to do", () => {
    const inner = new Graph();
    const jit = inner.add(
      jitterPoints,
      { amount: fieldFromJson({ fn: "constant", value: 0.5 }) },
      "jit",
    );
    expect(() =>
      resolveExposedParam(inner, {
        name: "wobble",
        targets: [{ node: jit, param: "amount" }],
        description: "How far points wander.",
      }),
    ).toThrow(/exposed param "wobble": its default would come from the live value of "jit"\.amount, which holds a Field/);
  });

  it("requires a description, and rejects an empty name", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, undefined, "sc");
    expect(() =>
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "   ",
      }),
    ).toThrow(/exposed param "count": must have a non-empty description/);
    expect(() =>
      resolveExposedParam(inner, {
        name: "",
        targets: [{ node: sc, param: "count" }],
        description: "Anything.",
      }),
    ).toThrow(/exposed param: name must be a non-empty string/);
  });
});

describe("resolveExposedParam — bad targets", () => {
  it("names an inner node that does not exist and lists the ones that do", () => {
    const inner = new Graph();
    inner.add(pointScatterInBounds, undefined, "sc");
    expect(() =>
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: { id: "nope" }, param: "count" }],
        description: "Anything.",
      }),
    ).toThrow(/exposed param "count": unknown inner node "nope"; inner nodes: sc/);
  });

  it("names a param the target does not have and lists the ones it does", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, undefined, "sc");
    expect(() =>
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: sc, param: "cont" }],
        description: "Anything.",
      }),
    ).toThrow(
      /exposed param "count": node "sc" \(type "pointScatterInBounds"\) has no param "cont"; params: count, boundsMin/,
    );
  });

  it("refuses a target whose node type is not registered", () => {
    const inner = new Graph();
    const bespoke = defineNode<{ amount: number }>({
      type: "resolver_unregistered",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: { amount: 0 },
      execute: () => ({ out: [] }),
    });
    const h = inner.add(bespoke, undefined, "b");
    expect(() =>
      resolveExposedParam(inner, {
        name: "amount",
        targets: [{ node: h, param: "amount" }],
        description: "Anything.",
      }),
    ).toThrow(/inner node "b" has unregistered type "resolver_unregistered"/);
  });

  it("rejects a declaration with no targets", () => {
    const inner = new Graph();
    expect(() =>
      resolveExposedParam(inner, { name: "count", targets: [], description: "Anything." }),
    ).toThrow(/exposed param "count": needs at least one target/);
  });
});

describe("resolveExposedParam — fan-out across several targets", () => {
  it("intersects bounds to the tightest range", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, { count: 8 }, "sc"); // min 0
    const grid = inner.add(pointGrid, { countX: 8 }, "grid"); // min 1
    const resolved = resolveExposedParam(inner, {
      name: "count",
      targets: [
        { node: sc, param: "count" },
        { node: grid, param: "countX" },
      ],
      description: "How many points.",
    });
    expect(resolved.schema.min).toBe(1);
    expect(resolved.schema.max).toBeUndefined();
  });

  it("is field-capable only when every target is", () => {
    const inner = new Graph();
    const jit = inner.add(jitterPoints, undefined, "jit"); // vec3, field-capable
    const xf = inner.add(transformPoints, undefined, "xf"); // vec3, field-capable
    const grid = inner.add(pointGrid, undefined, "grid"); // vec3, plain only

    const both = resolveExposedParam(inner, {
      name: "wobble",
      targets: [
        { node: jit, param: "amount" },
        { node: xf, param: "translate" },
      ],
      description: "How far points wander.",
    });
    expect(both.schema.acceptsField).toBe(true);
    expect(both.targets.map((t) => t.acceptsField)).toEqual([true, true]);

    const mixed = resolveExposedParam(inner, {
      name: "wobble",
      targets: [
        { node: jit, param: "amount" },
        { node: grid, param: "spacing" },
      ],
      description: "How far points wander.",
    });
    expect(mixed.schema.acceptsField).toBeUndefined();
    expect(mixed.targets.map((t) => t.acceptsField)).toEqual([true, false]);
  });

  it("refuses targets that disagree on type, naming both and both types", () => {
    const inner = new Graph();
    const jit = inner.add(jitterPoints, undefined, "jit"); // vec3
    const attr = inner.add(setAttribute, undefined, "at"); // f32
    expect(() =>
      resolveExposedParam(inner, {
        name: "amount",
        targets: [
          { node: jit, param: "amount" },
          { node: attr, param: "value" },
        ],
        description: "Anything.",
      }),
    ).toThrow(
      /exposed param "amount": targets disagree on type — "jit"\.amount is vec3 but "at"\.value is f32; every target of one exposed param must have the same param type/,
    );
  });

  it("refuses targets that disagree on their enum values, naming both lists", () => {
    const inner = new Graph();
    const f = inner.add(filterByDensity, undefined, "f"); // threshold | probabilistic
    const attr = inner.add(setAttribute, undefined, "at"); // point | vertex | ...
    expect(() =>
      resolveExposedParam(inner, {
        name: "mode",
        targets: [
          { node: f, param: "mode" },
          { node: attr, param: "domain" },
        ],
        description: "Anything.",
      }),
    ).toThrow(
      /exposed param "mode": targets disagree on their enum values — "f"\.mode allows threshold, probabilistic but "at"\.domain allows point, vertex, primitive, detail/,
    );
  });

  it("refuses an empty merged range, listing every target's range", () => {
    // Two nested wrappers, each narrowing setAttribute.tupleSize (1..4)
    // to a range the other excludes, then one param over both.
    const wrap = (label: string, tupleSize: number, bound: { min?: number; max?: number }) => {
      const graph = new Graph();
      const attr = graph.add(setAttribute, { tupleSize }, "at");
      return subgraphNode(graph, [], [{ name: "out", node: attr, pin: "out" }], [
        resolveExposedParam(graph, {
          name: "tuple",
          targets: [{ node: attr, param: "tupleSize" }],
          description: `Components per element (${label}).`,
          ...bound,
        }),
      ]);
    };
    const middle = new Graph();
    const a = middle.add(wrap("high", 3, { min: 3 }), undefined, "a");
    const b = middle.add(wrap("low", 2, { max: 2 }), undefined, "b");
    expect(() =>
      resolveExposedParam(middle, {
        name: "tuple",
        targets: [
          { node: a, param: "tuple" },
          { node: b, param: "tuple" },
        ],
        description: "Components per element.",
      }),
    ).toThrow(
      /exposed param "tuple": the merged bounds are empty — min 3 is above max 2; the targets' ranges do not overlap \("a"\.tuple \[3, 4\], "b"\.tuple \[1, 2\]\)/,
    );
  });

  it("resolves a target that is itself a subgraph node, through its exposed param", () => {
    const innermost = new Graph();
    const sc = innermost.add(pointScatterInBounds, { count: 200 }, "sc");
    const nested = subgraphNode(innermost, [], [{ name: "out", node: sc, pin: "out" }], [
      resolveExposedParam(innermost, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "Inner count.",
      }),
    ]);
    const middle = new Graph();
    const n = middle.add(nested, undefined, "n");
    const resolved = resolveExposedParam(middle, {
      name: "count",
      targets: [{ node: n, param: "count" }],
      description: "Outer count.",
    });
    expect(resolved.schema).toEqual({
      type: "i32",
      default: 200,
      description: "Outer count.",
      min: 0,
    });
  });

  it("names a nested subgraph target that exposes no such param", () => {
    const innermost = new Graph();
    const sc = innermost.add(pointScatterInBounds, undefined, "sc");
    const nested = subgraphNode(innermost, [], [{ name: "out", node: sc, pin: "out" }], [
      resolveExposedParam(innermost, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "Inner count.",
      }),
    ]);
    const middle = new Graph();
    const n = middle.add(nested, undefined, "n");
    expect(() =>
      resolveExposedParam(middle, {
        name: "seed",
        targets: [{ node: n, param: "seed" }],
        description: "Anything.",
      }),
    ).toThrow(
      /exposed param "seed": inner subgraph node "n" exposes no param "seed"; its exposed params: "count"/,
    );
  });
});

describe("resolveExposedParam — authored bounds", () => {
  it("accepts a narrower bound", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, { count: 50 }, "sc");
    const resolved = resolveExposedParam(inner, {
      name: "count",
      targets: [{ node: sc, param: "count" }],
      description: "How many points.",
      min: 10,
      max: 500,
    });
    expect(resolved.schema.min).toBe(10);
    expect(resolved.schema.max).toBe(500);
  });

  it("refuses a bound that would widen the target's own, and says how far it may go", () => {
    const inner = new Graph();
    const sc = inner.add(pointScatterInBounds, { count: 50 }, "sc");
    expect(() =>
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "How many points.",
        min: -5,
      }),
    ).toThrow(
      /exposed param "count": min -5 is wider than the targets' own bound 0; an exposed bound may only narrow — omit it, or raise it to at least 0/,
    );

    const attr = inner.add(setAttribute, { tupleSize: 2 }, "at");
    expect(() =>
      resolveExposedParam(inner, {
        name: "tuple",
        targets: [{ node: attr, param: "tupleSize" }],
        description: "Components per element.",
        max: 9,
      }),
    ).toThrow(
      /exposed param "tuple": max 9 is wider than the targets' own bound 4; an exposed bound may only narrow — omit it, or lower it to at most 4/,
    );
  });

  it("refuses an empty range the author created by narrowing", () => {
    const inner = new Graph();
    const attr = inner.add(setAttribute, { tupleSize: 2 }, "at"); // 1..4
    expect(() =>
      resolveExposedParam(inner, {
        name: "tuple",
        targets: [{ node: attr, param: "tupleSize" }],
        description: "Components per element.",
        min: 5,
        default: 5,
      }),
    ).toThrow(/exposed param "tuple": the merged bounds are empty — min 5 is above max 4/);
  });
});

it("rejects a resolved param whose target list is legal but empty at wrap time", () => {
  // subgraphNode does its own target check, independent of the resolver:
  // a declaration built by hand cannot slip past it either.
  const inner = new Graph();
  const sc = inner.add(pointScatterInBounds, undefined, "sc");
  const resolved = resolveExposedParam(inner, {
    name: "count",
    targets: [{ node: sc, param: "count" }],
    description: "How many points.",
  });
  const other = new Graph();
  other.add(pointGrid, undefined, "grid");
  expect(() => subgraphNode(other, [], [], [resolved])).toThrow(GraphValidationError);
  expect(() => subgraphNode(other, [], [], [resolved])).toThrow(
    /exposed param "count": unknown inner node "sc"; inner nodes: grid/,
  );
});

describe("resolveExposedParam — asserting field capability", () => {
  /**
   * The exact shape a vocabulary survey measured going wrong: a "density"
   * knob meant to accept a field, fanned across `surfaceSample.densityField`
   * (field-capable) and `filterByDensity.threshold` (not). The merge is
   * right to AND the capability away; its silence is what costs the author
   * the feature they were building.
   */
  function densityFanout(): { inner: Graph; targets: { node: NodeHandle; param: string }[] } {
    const inner = new Graph(1);
    const mesh = inner.add(meshPrimitive, {}, "mesh");
    const scatter = inner.add(surfaceSample, { count: 50 }, "scatter");
    const thin = inner.add(filterByDensity, {}, "thin");
    inner.connect(mesh, "out", scatter, "in");
    inner.connect(scatter, "out", thin, "in");
    return {
      inner,
      targets: [
        { node: scatter, param: "densityField" },
        { node: thin, param: "threshold" },
      ],
    };
  }

  it("still ANDs capability away when nothing was asserted", () => {
    const { inner, targets } = densityFanout();
    const resolved = resolveExposedParam(inner, {
      name: "density",
      targets,
      description: "How dense the scatter is.",
    });
    // The merge is correct — one target would reject a Field — and this is
    // the behavior that is silent, which is why the assertion below exists.
    expect(resolved.schema.acceptsField).toBeUndefined();
  });

  it("names the target that refuses when the author asserts acceptsField", () => {
    const { inner, targets } = densityFanout();
    expect(() =>
      resolveExposedParam(inner, {
        name: "density",
        targets,
        description: "How dense the scatter is.",
        acceptsField: true,
      }),
    ).toThrow(GraphValidationError);
    expect(() =>
      resolveExposedParam(inner, {
        name: "density",
        targets,
        description: "How dense the scatter is.",
        acceptsField: true,
      }),
    ).toThrow(/"thin"\.threshold does not accept fields.*"scatter"\.densityField would/s);
  });

  it("accepts the assertion when every target is field-capable", () => {
    const { inner, targets } = densityFanout();
    const resolved = resolveExposedParam(inner, {
      name: "density",
      targets: [targets[0]],
      description: "How dense the scatter is.",
      acceptsField: true,
    });
    expect(resolved.schema.acceptsField).toBe(true);
  });
});
