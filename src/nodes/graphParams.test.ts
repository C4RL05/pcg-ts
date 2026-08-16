/**
 * The addresses a graph publishes for its own params. What matters here is
 * not that a list comes back but that the KEYS are the ones a panel file
 * and a shared link already use — the three-part one especially, since
 * nothing outside the field spec names an inline `param` at all.
 */
import { describe, expect, it } from "vitest";
import { Graph, type NodeHandle, subgraphNode } from "../graph/index.js";
import { fieldFromJson } from "../fields/fieldJson.js";
import { describeGraphParams, inlineParamSchema } from "./graphParams.js";
import { pointGrid, transformPoints } from "./index.js";
import { resolveExposedParam } from "./subgraphParams.js";

/** `mul(position, param frequency) * param amplitude`, both inline. */
const LIFT = {
  fn: "mul",
  args: [
    {
      fn: "mul",
      args: [{ fn: "position" }, { fn: "param", name: "frequency", value: 0.06 }],
    },
    { fn: "param", name: "amplitude", value: 18, min: 0, max: 40, description: "Dune height." },
  ],
} as const;

function graphWithField(): Graph {
  const g = new Graph(7);
  const grid = g.add(pointGrid, { countX: 4, countZ: 4 }, "grid");
  const dunes = g.add(
    transformPoints,
    { translate: fieldFromJson({ fn: "vec", args: [0, LIFT, 0] }) },
    "dunes",
  );
  g.connect(grid, "out", dunes, "in");
  return g;
}

describe("describeGraphParams", () => {
  it("addresses an inline field param as node.param.fieldParam", () => {
    const params = describeGraphParams(graphWithField());
    const keys = params.map((p) => p.key);
    expect(keys).toContain("dunes.translate");
    expect(keys).toContain("dunes.translate.frequency");
    expect(keys).toContain("dunes.translate.amplitude");
    // The field params follow the node param they live inside, so reading
    // the list top to bottom reads the graph's own structure.
    expect(keys.indexOf("dunes.translate.frequency")).toBe(keys.indexOf("dunes.translate") + 1);
  });

  it("reports the node param as holding a field, and the literals inside it as values", () => {
    const params = describeGraphParams(graphWithField());
    const byKey = new Map(params.map((p) => [p.key, p]));
    const held = byKey.get("dunes.translate");
    expect([held?.holdsField, held?.value, held?.exposed]).toEqual([true, undefined, false]);
    const amplitude = byKey.get("dunes.translate.amplitude");
    expect([amplitude?.holdsField, amplitude?.value, amplitude?.exposed]).toEqual([false, 18, true]);
    // Range and prose come from the graph, where the author wrote them.
    expect(amplitude?.schema).toEqual({
      type: "f32",
      default: 18,
      description: "Dune height.",
      min: 0,
      max: 40,
    });
  });

  it("says so when an inline param declares nothing about itself", () => {
    const byKey = new Map(describeGraphParams(graphWithField()).map((p) => [p.key, p]));
    const frequency = byKey.get("dunes.translate.frequency");
    expect(frequency?.schema.min).toBeUndefined();
    expect(frequency?.schema.description).toMatch(/write "description", "min" and "max"/);
  });

  it("takes a wrapper's params from the instance and marks them declared", () => {
    const inner = new Graph();
    const grid = inner.add(pointGrid, { countX: 4, countZ: 4 }, "grid");
    inner.output(grid, "out", "out");
    const def = subgraphNode(
      inner,
      [],
      [{ name: "out", node: { id: "grid" }, pin: "out" }],
      [
        resolveExposedParam(inner, {
          name: "countX",
          targets: [{ node: grid, param: "countX" }],
          description: "How many columns.",
        }),
      ],
    );
    const outer = new Graph(1);
    outer.add(def, { countX: 9 }, "patch");
    const params = describeGraphParams(outer);
    expect(params.map((p) => [p.key, p.value, p.exposed])).toEqual([["patch.countX", 9, true]]);
    // The registry knows the `subgraph` type as paramless — a wrapper's
    // real interface is per-instance, which is the thing this must not miss.
    expect(params[0].schema.type).toBe("i32");
  });

  it("omits items params and keeps every plain one", () => {
    const g = new Graph(3);
    g.add(pointGrid, { countX: 2 }, "grid");
    const keys = describeGraphParams(g).map((p) => p.key);
    expect(keys).toEqual([
      "grid.countX",
      "grid.countY",
      "grid.countZ",
      "grid.spacing",
      "grid.origin",
    ]);
  });

  it("skips a node whose def carries no registered schema", () => {
    const g = new Graph(3);
    g.add(
      {
        type: "adHoc",
        inputs: [],
        outputs: [{ name: "out", kind: "geometry" }],
        defaultParams: { size: 2 },
        execute: () => ({ out: [] }),
      },
      undefined,
      "loose",
    );
    // Its params exist and are readable; what does not exist is anything
    // true to say about them, so the honest answer is to publish nothing.
    expect(g.getParams({ id: "loose" } as NodeHandle<{ size: number }>).size).toBe(2);
    expect(describeGraphParams(g)).toEqual([]);
  });
});

describe("inlineParamSchema", () => {
  it("types a value by its shape and carries what the node declares", () => {
    expect(inlineParamSchema("a", 2, { min: 1, max: 3, description: "Two." })).toEqual({
      type: "f32",
      default: 2,
      description: "Two.",
      min: 1,
      max: 3,
    });
    expect(inlineParamSchema("b", [1, 2, 3])?.type).toBe("vec3");
    expect(inlineParamSchema("c", [1, 2, 3, 4])?.type).toBe("vec4");
  });

  it("refuses a tuple the param vocabulary cannot name", () => {
    // The grammar takes any non-empty run of numbers; `ParamType` names
    // only vec3 and vec4, so 2 and 5 have no honest schema — and a knob
    // that cannot be read back is worse than no knob.
    expect(inlineParamSchema("d", [1, 2])).toBeUndefined();
    expect(inlineParamSchema("e", [1, 2, 3, 4, 5])).toBeUndefined();
  });
});
