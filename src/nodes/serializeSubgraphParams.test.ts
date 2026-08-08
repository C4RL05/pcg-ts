/**
 * Exposed params through the JSON format. The split under test mirrors
 * how native nodes work: DECLARATIONS live in the subgraph payload (the
 * authored part only — `type`, `enum` and `acceptsField` are re-derived
 * from the registry on load, so a payload cannot carry a schema that
 * lies), and VALUES live in the node's own `params`.
 *
 * This also closes a house-rule violation that shipped in v0.9.1: a param
 * set on a subgraph instance was SILENTLY DROPPED by `serializeGraph`
 * while `deserializeGraph` hard-errored on the same data. A writer that
 * discards what the reader refuses is how a tuned graph loses its tuning
 * between save and load.
 */
import { describe, expect, it } from "vitest";
import { Graph, cook, subgraphNode, type ExposedParam, type NodeHandle } from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  fieldFromJson,
  jitterPoints,
  pointScatterInBounds,
  resolveExposedParam,
  serializeGraph,
  setAttribute,
  transformPoints,
} from "./index.js";
import { firstGeo, snapshotGeometry } from "./testSupport.js";

/**
 * An outer graph whose single subgraph node exposes two params: `count`,
 * bound to one i32 target, and `wobble`, fanned out to two field-capable
 * vec3 targets.
 */
function build(seed = 4): { graph: Graph; sub: NodeHandle<Record<string, unknown>> } {
  const inner = new Graph(11);
  const sc = inner.add(pointScatterInBounds, { count: 24, boundsMax: [4, 1, 4] }, "sc");
  const jit = inner.add(jitterPoints, { amount: [0.2, 0.2, 0.2] }, "jit");
  const xf = inner.add(transformPoints, { translate: [0.5, 0, 0] }, "xf");
  inner.connect(sc, "out", jit, "in");
  inner.connect(jit, "out", xf, "in");
  const def = subgraphNode(inner, [], [{ name: "out", node: xf, pin: "out" }], [
    resolveExposedParam(inner, {
      name: "count",
      targets: [{ node: sc, param: "count" }],
      description: "How many candidate points to scatter.",
    }),
    resolveExposedParam(inner, {
      name: "wobble",
      targets: [
        { node: jit, param: "amount" },
        { node: xf, param: "translate" },
      ],
      description: "How far points wander, in metres.",
    }),
  ]);
  const graph = new Graph(seed);
  const sub = graph.add(def, undefined, "sub");
  graph.output(sub, "out", "result");
  return { graph, sub };
}

async function bytes(graph: Graph): Promise<Record<string, unknown>> {
  return snapshotGeometry(firstGeo((await cook(graph)).outputs.result));
}

describe("exposed params in the serialized format", () => {
  it("splits declarations into the payload and values onto the node", () => {
    const { graph, sub } = build();
    graph.setParam(sub, "count", 7);
    const json = serializeGraph(graph);
    const node = json.nodes[0];
    expect(node.params).toEqual({ count: 7, wobble: [0.2, 0.2, 0.2] });
    expect(node.subgraph?.params).toEqual([
      {
        name: "count",
        targets: [{ node: "sc", param: "count" }],
        description: "How many candidate points to scatter.",
        default: 24,
        min: 0,
      },
      {
        name: "wobble",
        targets: [
          { node: "jit", param: "amount" },
          { node: "xf", param: "translate" },
        ],
        description: "How far points wander, in metres.",
        default: [0.2, 0.2, 0.2],
      },
    ]);
    // Derived, never written: a payload cannot claim a type or a field
    // capability the inner params do not have.
    for (const decl of node.subgraph?.params ?? []) {
      expect(decl).not.toHaveProperty("type");
      expect(decl).not.toHaveProperty("acceptsField");
      expect(decl).not.toHaveProperty("enum");
    }
    expect(json.formatVersion).toBe(1);
  });

  it("leaves a subgraph node that exposes nothing byte-identical to before", () => {
    const inner = new Graph(11);
    const sc = inner.add(pointScatterInBounds, { count: 5 }, "sc");
    const def = subgraphNode(inner, [], [{ name: "out", node: sc, pin: "out" }]);
    const graph = new Graph(1);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "out", "result");
    const node = serializeGraph(graph).nodes[0];
    expect(node.params).toEqual({});
    expect(node.subgraph).not.toHaveProperty("params");
  });

  it("round-trips and cooks byte-identically, with the value carried across", async () => {
    const { graph, sub } = build();
    graph.setParam(sub, "count", 7);
    graph.setParam(sub, "wobble", [0.9, 0, 0.9]);

    const json = serializeGraph(graph);
    const rebuilt = deserializeGraph(json);
    // A fixed point: serializing what we just read yields the same JSON.
    expect(serializeGraph(rebuilt)).toEqual(json);
    expect(await bytes(rebuilt)).toEqual(await bytes(graph));

    // And the value really is the one that was set, not the default.
    const defaults = deserializeGraph({
      ...json,
      nodes: [{ ...json.nodes[0], params: {} }],
    });
    expect(await bytes(defaults)).not.toEqual(await bytes(graph));
  });

  it("round-trips a Field value on a field-capable exposed param", async () => {
    const { graph, sub } = build();
    graph.setParam(sub, "wobble", fieldFromJson({ fn: "constant", value: 0.4 }));
    const json = serializeGraph(graph);
    expect(json.nodes[0].params.wobble).toEqual({ fn: "constant", value: 0.4 });
    const rebuilt = deserializeGraph(json);
    expect(serializeGraph(rebuilt)).toEqual(json);
    expect(await bytes(rebuilt)).toEqual(await bytes(graph));
  });

  it("re-derives the schema on load rather than trusting the payload", () => {
    const { graph } = build();
    const json = serializeGraph(graph);
    // A payload that tries to widen `count` beyond its target's bound is
    // rejected by the same rule that applies at authoring time.
    const tampered = {
      ...json,
      nodes: [
        {
          ...json.nodes[0],
          subgraph: {
            ...json.nodes[0].subgraph!,
            params: [{ ...json.nodes[0].subgraph!.params![0], min: -50 }],
          },
        },
      ],
    };
    expect(() => deserializeGraph(tampered)).toThrow(
      /node "sub": exposed param "count": min -50 is wider than the targets' own bound 0/,
    );
  });

  it("refuses a tampered VALUE on load, the same rule it applies on save", () => {
    const { graph } = build();
    const json = serializeGraph(graph);
    const tampered = {
      ...json,
      nodes: [{ ...json.nodes[0], params: { ...json.nodes[0].params, count: -3 } }],
    };
    // The declaration is fine; the VALUE is not. Both halves are checked
    // on load, against the schema just re-derived from the registry.
    expect(() => deserializeGraph(tampered)).toThrow(
      /node "sub" param "count": -3 is below the minimum 0/,
    );
  });
});

/**
 * The inner graph is shared mutable state that cooking writes into, and
 * `serializeGraph` reads it to emit the nested payload. So the bytes must
 * not depend on cook history — not on whether THIS graph cooked, not on
 * which OTHER graph sharing the def cooked, and not on whether a cook
 * failed halfway. This is the guarantee `SubgraphSpec.seed` already gives
 * the inner seed; the wrapper gives it to params by restoring every slot
 * it wrote.
 */
describe("exposed params — serialization does not depend on cook history", () => {
  it("emits identical JSON before and after a cook", async () => {
    const { graph, sub } = build();
    graph.setParam(sub, "count", 7);
    graph.setParam(sub, "wobble", [0.9, 0, 0.9]);
    const before = JSON.stringify(serializeGraph(graph));
    await cook(graph);
    expect(JSON.stringify(serializeGraph(graph))).toBe(before);
    // Specifically: the inner nodes still carry what their author set,
    // not the values the wrapper pushed through them.
    const innerNodes = serializeGraph(graph).nodes[0].subgraph!.graph.nodes;
    expect(innerNodes.find((n) => n.id === "sc")?.params.count).toBe(24);
    expect(innerNodes.find((n) => n.id === "xf")?.params.translate).toEqual([0.5, 0, 0]);
  });

  it("keeps one graph's bytes independent of another graph's cook when both share a def", async () => {
    const inner = new Graph(11);
    const sc = inner.add(pointScatterInBounds, { count: 24, boundsMax: [4, 1, 4] }, "sc");
    const def = subgraphNode(inner, [], [{ name: "out", node: sc, pin: "out" }], [
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "How many candidate points to scatter.",
      }),
    ]);
    const a = new Graph(4);
    const subA = a.add(def, { count: 7 }, "sub");
    a.output(subA, "out", "result");
    const b = new Graph(5);
    const subB = b.add(def, { count: 99 }, "sub");
    b.output(subB, "out", "result");

    await cook(a);
    const aJson = JSON.stringify(serializeGraph(a));
    const aBytes = await bytes(a);
    await cook(b);
    // A's payload must not report what B cooked with.
    expect(JSON.stringify(serializeGraph(b))).not.toBe(aJson);
    expect(JSON.stringify(serializeGraph(a))).toBe(aJson);
    expect(await bytes(a)).toEqual(aBytes);
  });

  it("stays serializable after a cook that fails, with the inner graph untouched", async () => {
    const inner = new Graph(11);
    const sc = inner.add(pointScatterInBounds, { count: 24 }, "sc");
    // `jit` is deliberately left unconnected, so the inner cook throws
    // AFTER the exposed value has been written into `sc`.
    const jit = inner.add(jitterPoints, { amount: [0.2, 0.2, 0.2] }, "jit");
    const def = subgraphNode(inner, [], [{ name: "out", node: jit, pin: "out" }], [
      resolveExposedParam(inner, {
        name: "count",
        targets: [{ node: sc, param: "count" }],
        description: "How many candidate points to scatter.",
      }),
    ]);
    const graph = new Graph(4);
    const sub = graph.add(def, { count: 7 }, "sub");
    graph.output(sub, "out", "result");

    const before = JSON.stringify(serializeGraph(graph));
    await expect(cook(graph)).rejects.toThrow();
    // Before the restore, the failed cook left `count: 7` wedged in the
    // inner graph — and a value outside the inner param's own bounds
    // would have made the graph unserializable with no way back.
    expect(JSON.stringify(serializeGraph(graph))).toBe(before);
    expect(inner.getParams(sc).count).toBe(24);
  });
});

/**
 * `subgraphNode`'s fourth argument takes an ALREADY RESOLVED declaration
 * and the graph layer cannot audit its per-target claims — schemas live in
 * this layer's registry, which the graph layer may not import. So the
 * writer re-derives every declaration before writing it: `deserializeGraph`
 * refuses a declaration that does not match the registry, and a graph you
 * can save and cannot reopen is the worst outcome available.
 */
describe("exposed params — a hand-built declaration the reader would refuse", () => {
  /** An outer graph over one hand-built (unresolved) exposed param. */
  function handBuilt(exposed: ExposedParam): Graph {
    const inner = new Graph(11);
    inner.add(pointScatterInBounds, { count: 4 }, "sc");
    const def = subgraphNode(inner, [], [{ name: "out", node: { id: "sc" }, pin: "out" }], [
      exposed,
    ]);
    const graph = new Graph(4);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "out", "result");
    return graph;
  }

  it("refuses a declared type its targets do not have", () => {
    const graph = handBuilt({
      name: "count",
      targets: [{ node: { id: "sc" }, param: "count" }],
      schema: { type: "f32", default: 4, description: "Claims f32.", min: 0 },
    });
    expect(() => serializeGraph(graph)).toThrow(GraphSerializationError);
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "count" declares type "f32", but its targets \("sc"\.count\) are i32/,
    );
  });

  it("refuses a claimed field capability its targets do not have", () => {
    const graph = handBuilt({
      name: "count",
      targets: [{ node: { id: "sc" }, param: "count", acceptsField: true }],
      schema: { type: "i32", default: 4, description: "Claims fields.", acceptsField: true, min: 0 },
    });
    // The lie the cook-time gate reads: it keys off the merged flag, so a
    // Field would sail past it and surface as "[object Object]" from
    // inside the inner node.
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "count" claims to be field-capable, but not every target is/,
    );
  });

  it("refuses a per-target field-capability flag the registry contradicts", () => {
    const graph = handBuilt({
      name: "count",
      targets: [{ node: { id: "sc" }, param: "count", acceptsField: true }],
      schema: { type: "i32", default: 4, description: "Honest merged schema.", min: 0 },
    });
    // The merged schema is honest here; only the per-target flag lies —
    // and that flag is what the cook-time error message reads.
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "count" records target "sc"\.count as field-capable, but its registered schema says otherwise/,
    );
  });

  it("refuses a bound wider than its targets', the same way the reader does", () => {
    const graph = handBuilt({
      name: "count",
      targets: [{ node: { id: "sc" }, param: "count" }],
      schema: { type: "i32", default: 4, description: "Widened.", min: -100 },
    });
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "count": min -100 is wider than the targets' own bound 0/,
    );
  });

  it("refuses a bound dropped from what its targets declare", () => {
    const graph = handBuilt({
      name: "count",
      targets: [{ node: { id: "sc" }, param: "count" }],
      schema: { type: "i32", default: 4, description: "Bound dropped." },
    });
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "count" omits a min bound its targets declare \(0\)/,
    );
  });

  it("refuses declared enum values its targets do not allow", () => {
    const inner = new Graph(11);
    const sc = inner.add(pointScatterInBounds, { count: 4 }, "sc");
    const at = inner.add(setAttribute, { name: "w", type: "f32" }, "at");
    inner.connect(sc, "out", at, "in");
    const def = subgraphNode(inner, [], [{ name: "out", node: at, pin: "out" }], [
      {
        name: "kind",
        targets: [{ node: { id: "at" }, param: "type" }],
        schema: {
          type: "enum",
          default: "f32",
          description: "Claims a shorter list.",
          enum: ["f32", "i32"],
        },
      },
    ]);
    const graph = new Graph(4);
    const sub = graph.add(def, undefined, "sub");
    graph.output(sub, "out", "result");
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": exposed param "kind" declares enum values f32, i32, but its targets \("at"\.type\) allow /,
    );
  });

  it("writes a resolved declaration unchanged", () => {
    // The control: everything above is rejected, and the supported door
    // still goes through untouched.
    const { graph } = build();
    expect(serializeGraph(graph).nodes[0].subgraph?.params).toHaveLength(2);
  });
});

describe("exposed params — what serialization refuses", () => {
  it("refuses to drop a value for a param the node does not expose", () => {
    const { graph, sub } = build();
    // The pre-existing bug: this used to serialize as `params: {}` while
    // the reader hard-errored on the very same data.
    graph.setParam(sub, "bogus", 1);
    expect(() => serializeGraph(graph)).toThrow(GraphSerializationError);
    expect(() => serializeGraph(graph)).toThrow(
      /cannot serialize node "sub": param "bogus" is not an exposed param of this subgraph node; exposed params: count, wobble/,
    );
  });

  it("refuses a value that violates the exposed schema", () => {
    const { graph, sub } = build();
    graph.setParam(sub, "count", -3);
    expect(() => serializeGraph(graph)).toThrow(
      /node "sub" param "count": -3 is below the minimum 0/,
    );
  });

  it("refuses a Field on an exposed param that is not field-capable", () => {
    const { graph, sub } = build();
    graph.setParam(sub, "count", fieldFromJson({ fn: "constant", value: 3 }));
    expect(() => serializeGraph(graph)).toThrow(
      /node "sub" param "count": holds a Field but the param is not field-capable/,
    );
  });

  it("refuses an unknown param in JSON, listing the declared ones", () => {
    const { graph } = build();
    const json = serializeGraph(graph);
    const tampered = {
      ...json,
      nodes: [{ ...json.nodes[0], params: { ...json.nodes[0].params, bogus: 1 } }],
    };
    expect(() => deserializeGraph(tampered)).toThrow(
      /node "sub": unknown param "bogus"; this subgraph node exposes: count, wobble/,
    );
  });

  it("refuses a declaration targeting an inner node that does not exist", () => {
    const { graph } = build();
    const json = serializeGraph(graph);
    const tampered = {
      ...json,
      nodes: [
        {
          ...json.nodes[0],
          subgraph: {
            ...json.nodes[0].subgraph!,
            params: [
              {
                ...json.nodes[0].subgraph!.params![0],
                targets: [{ node: "nope", param: "count" }],
              },
            ],
          },
        },
      ],
    };
    expect(() => deserializeGraph(tampered)).toThrow(
      /node "sub" subgraph params\[0\] \("count"\) targets\[0\]: unknown inner node "nope"; inner nodes: sc, jit, xf/,
    );
  });

  it("refuses a malformed declaration, saying what one looks like", () => {
    const { graph } = build();
    const json = serializeGraph(graph);
    const withParams = (params: unknown) => ({
      ...json,
      nodes: [{ ...json.nodes[0], params: {}, subgraph: { ...json.nodes[0].subgraph!, params } }],
    });
    expect(() => deserializeGraph(withParams("nope"))).toThrow(
      /node "sub" subgraph params: expected an array of \{ name, targets, description, default \} objects/,
    );
    expect(() => deserializeGraph(withParams([{ name: "count" }]))).toThrow(
      /node "sub" subgraph params\[0\]: expected \{ name, targets, description, default \}/,
    );
    expect(() =>
      deserializeGraph(withParams([{ name: "count", description: "x", targets: [] }])),
    ).toThrow(/node "sub" subgraph params\[0\] \("count"\): "targets" must be a non-empty array/);
  });
});

describe("exposed params on a nested subgraph", () => {
  it("round-trips a param exposed through two levels and drives the innermost node", async () => {
    const innermost = new Graph(3);
    const attr = innermost.add(setAttribute, { name: "w", value: 0.25 }, "at");
    const deep = subgraphNode(
      innermost,
      [{ name: "in", node: attr, pin: "in" }],
      [{ name: "out", node: attr, pin: "out" }],
      [
        resolveExposedParam(innermost, {
          name: "weight",
          targets: [{ node: attr, param: "value" }],
          description: "Weight written to every point.",
        }),
      ],
    );

    const middle = new Graph(5);
    const sc = middle.add(pointScatterInBounds, { count: 6 }, "sc");
    const nested = middle.add(deep, undefined, "deep");
    middle.connect(sc, "out", nested, "in");
    const def = subgraphNode(middle, [], [{ name: "out", node: nested, pin: "out" }], [
      resolveExposedParam(middle, {
        name: "weight",
        targets: [{ node: nested, param: "weight" }],
        description: "Weight written to every point.",
      }),
    ]);

    const graph = new Graph(9);
    const sub = graph.add(def, { weight: 0.75 }, "sub");
    graph.output(sub, "out", "result");

    const json = serializeGraph(graph);
    const rebuilt = deserializeGraph(json);
    expect(serializeGraph(rebuilt)).toEqual(json);

    const snapshot = await bytes(rebuilt);
    expect(snapshot).toEqual(await bytes(graph));
    // The value really reached the innermost node.
    const geo = firstGeo((await cook(rebuilt)).outputs.result);
    expect([...geo.attrs.point.require("w").data.subarray(0, 6)]).toEqual(new Array(6).fill(0.75));
  });
});
