import { describe, expect, it } from "vitest";
import { mul, position } from "../fields/index.js";
import { Graph, cook, defineNode } from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  fieldFromJson,
  filterByDensity,
  jitterPoints,
  pointScatterInBounds,
  serializeGraph,
  setAttribute,
  transformPoints,
} from "./index.js";
import { firstGeo, snapshotGeometry } from "./testSupport.js";

/** A nontrivial pipeline: scatter -> density from fbm -> filter -> jitter -> transform. */
function buildGraph(seed: number): Graph {
  const g = new Graph(seed);
  const scatter = g.add(
    pointScatterInBounds,
    { count: 300, boundsMin: [0, 0, 0], boundsMax: [10, 2, 10] },
    "scatter",
  );
  const den = g.add(
    setAttribute,
    {
      name: "density",
      value: fieldFromJson({
        fn: "remap",
        args: [
          { fn: "fbm", base: "perlinNoise", opts: { seed: 5, frequency: 0.3, octaves: 3 } },
          -1,
          1,
          0,
          1,
        ],
      }),
    },
    "den",
  );
  const filter = g.add(filterByDensity, { mode: "probabilistic", seed: 2 }, "filter");
  const jit = g.add(
    jitterPoints,
    { amount: fieldFromJson({ fn: "vec", args: [0.2, 0, 0.2] }) },
    "jit",
  );
  const xf = g.add(transformPoints, { translate: [1, 0, 0], rotateEuler: [0, 45, 0] }, "xf");
  g.connect(scatter, "out", den, "in");
  g.connect(den, "out", filter, "in");
  g.connect(filter, "out", jit, "in");
  g.connect(jit, "out", xf, "in");
  g.output(xf, "out", "result");
  return g;
}

describe("serializeGraph", () => {
  it("emits the versioned format with all params, connections, and outputs", () => {
    const json = serializeGraph(buildGraph(42));
    expect(json.formatVersion).toBe(1);
    expect(json.seed).toBe(42);
    expect(json.nodes.map((n) => n.id)).toEqual(["scatter", "den", "filter", "jit", "xf"]);
    const scatter = json.nodes[0];
    expect(scatter.type).toBe("pointScatterInBounds");
    // All schema params serialized, including untouched defaults.
    expect(scatter.params).toEqual({
      count: 300,
      boundsMin: [0, 0, 0],
      boundsMax: [10, 2, 10],
      seed: 0,
    });
    // Field params serialize as their specs.
    expect(json.nodes[1].params.value).toEqual({
      fn: "remap",
      args: [
        { fn: "fbm", base: "perlinNoise", opts: { seed: 5, frequency: 0.3, octaves: 3 } },
        -1,
        1,
        0,
        1,
      ],
    });
    expect(json.connections).toEqual([
      { from: ["scatter", "out"], to: ["den", "in"] },
      { from: ["den", "out"], to: ["filter", "in"] },
      { from: ["filter", "out"], to: ["jit", "in"] },
      { from: ["jit", "out"], to: ["xf", "in"] },
    ]);
    expect(json.outputs).toEqual([{ id: "xf", pin: "out", name: "result" }]);
    // JSON-safe end to end.
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("rejects unregistered node types", () => {
    const rogue = defineNode<{ x: number }>({
      type: "rogueNode",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: { x: 0 },
      execute: () => ({ out: [] }),
    });
    const g = new Graph();
    g.add(rogue, {}, "r");
    expect(() => serializeGraph(g)).toThrow(GraphSerializationError);
    expect(() => serializeGraph(g)).toThrow(/type "rogueNode" is not registered/);
  });

  it("rejects code-authored fields with a pointer to fieldFromJson", () => {
    const g = new Graph();
    const jit = g.add(jitterPoints, { amount: mul(position(), 0.1) }, "jit");
    g.output(jit, "out");
    expect(() => serializeGraph(g)).toThrow(/node "jit" param "amount".*fieldFromJson/);
  });
});

describe("deserializeGraph round trip", () => {
  it("serialize(deserialize(j)) deep-equals j", () => {
    const json = serializeGraph(buildGraph(7));
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
  });

  it("cooks byte-identically to the original graph", async () => {
    const original = buildGraph(1234);
    const rebuilt = deserializeGraph(serializeGraph(original));
    const a = await cook(original);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.result);
    const geoB = firstGeo(b.outputs.result);
    expect(geoA.pointCount).toBeGreaterThan(0);
    expect(snapshotGeometry(geoB)).toEqual(snapshotGeometry(geoA));
  });

  it("fills omitted params with schema defaults", async () => {
    const g = deserializeGraph({
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "a", type: "pointScatterInBounds", params: { count: 5 } }],
      connections: [],
      outputs: [{ id: "a", pin: "out", name: "pts" }],
    });
    const result = await cook(g);
    expect(firstGeo(result.outputs.pts).pointCount).toBe(5);
  });
});

describe("deserializeGraph validation", () => {
  const base = {
    formatVersion: 1,
    seed: 0,
    nodes: [{ id: "a", type: "pointScatterInBounds", params: {} }],
    connections: [],
    outputs: [],
  };

  it("rejects bad format versions", () => {
    expect(() => deserializeGraph({ ...base, formatVersion: 2 })).toThrow(
      /unsupported formatVersion 2; this build reads formatVersion 1/,
    );
    expect(() => deserializeGraph(null)).toThrow(/expected a serialized graph object/);
  });

  it("rejects unknown node types, listing registered ones", () => {
    expect(() =>
      deserializeGraph({ ...base, nodes: [{ id: "a", type: "warpDrive", params: {} }] }),
    ).toThrow(/node "a": unknown node type "warpDrive"; registered types: .*pointGrid/);
  });

  it("rejects params of the wrong type, naming node and param", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [{ id: "a", type: "pointScatterInBounds", params: { count: "many" } }],
      }),
    ).toThrow(/node "a" param "count": expected an integer, got "many"/);
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [{ id: "a", type: "pointScatterInBounds", params: { boundsMin: [1, 2] } }],
      }),
    ).toThrow(/param "boundsMin": expected an array of 3 finite numbers/);
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [{ id: "a", type: "pointScatterInBounds", params: { count: -3 } }],
      }),
    ).toThrow(/param "count".*below the minimum 0/);
  });

  it("rejects enum values outside the list", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "f", type: "filterByDensity", params: { mode: "banana" } },
        ],
      }),
    ).toThrow(/node "f" param "mode": expected one of "threshold", "probabilistic", got "banana"/);
  });

  it("rejects unknown param keys, listing valid ones", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [{ id: "a", type: "pointScatterInBounds", params: { frobnicate: 1 } }],
      }),
    ).toThrow(/node "a": unknown param "frobnicate".*valid params: count, boundsMin, boundsMax, seed/);
  });

  it("rejects bad field specs inside field-capable params", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "s", type: "setAttribute", params: { value: { fn: "warble" } } },
        ],
      }),
    ).toThrow(/node "s" param "value".*unknown field fn "warble"/);
  });

  it("rejects duplicate node ids", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "a", type: "pointScatterInBounds", params: {} },
        ],
      }),
    ).toThrow(/duplicate node id "a"/);
  });

  it("rejects connections to unknown nodes or pins", () => {
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "j", type: "jitterPoints", params: {} },
        ],
        connections: [{ from: ["ghost", "out"], to: ["j", "in"] }],
      }),
    ).toThrow(/connections\[0\]: unknown source node "ghost"; known nodes: a, j/);
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "j", type: "jitterPoints", params: {} },
        ],
        connections: [{ from: ["a", "sideways"], to: ["j", "in"] }],
      }),
    ).toThrow(/connections\[0\]: node "a" has no output pin "sideways"; valid output pins: out/);
    expect(() =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "j", type: "jitterPoints", params: {} },
        ],
        connections: [{ from: ["a", "out"], to: ["j", "warp"] }],
      }),
    ).toThrow(/node "j" has no input pin "warp"; valid input pins: in/);
  });

  it("rejects outputs on unknown nodes or pins", () => {
    expect(() =>
      deserializeGraph({ ...base, outputs: [{ id: "ghost", pin: "out", name: "x" }] }),
    ).toThrow(/outputs\[0\]: unknown node "ghost"/);
    expect(() =>
      deserializeGraph({ ...base, outputs: [{ id: "a", pin: "nope", name: "x" }] }),
    ).toThrow(/outputs\[0\]: node "a" has no output pin "nope"; valid output pins: out/);
  });

  it("rejects a non-numeric seed", () => {
    expect(() => deserializeGraph({ ...base, seed: "zero" })).toThrow(
      /graph seed must be a finite number/,
    );
  });
});
