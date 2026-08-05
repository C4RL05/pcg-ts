import { describe, expect, it } from "vitest";
import {
  Graph,
  cook,
  defineNode,
  getSubgraphSpec,
  subgraphNode,
  type NodeHandle,
} from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  fieldFromJson,
  filterByDensity,
  getNodeType,
  hasNodeType,
  jitterPoints,
  pointScatterInBounds,
  serializeGraph,
  setAttribute,
  transformPoints,
} from "./index.js";
import { firstGeo, snapshotGeometry } from "./testSupport.js";

/**
 * Outer graph with one subgraph node whose inner graph is nontrivial:
 * noise-driven density, probabilistic filtering, and a transform.
 */
function buildOuter(seed: number): Graph {
  const inner = new Graph(11); // nonzero wrap-time seed: the canonical payload seed
  const den = inner.add(
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
  const filter = inner.add(filterByDensity, { mode: "probabilistic", seed: 2 }, "filter");
  const xf = inner.add(transformPoints, { translate: [1, 0, 0], rotateEuler: [0, 45, 0] }, "xf");
  inner.connect(den, "out", filter, "in");
  inner.connect(filter, "out", xf, "in");
  const def = subgraphNode(
    inner,
    [{ name: "pts", node: den, pin: "in" }],
    [{ name: "out", node: xf, pin: "out" }],
  );

  const g = new Graph(seed);
  const scatter = g.add(
    pointScatterInBounds,
    { count: 200, boundsMin: [0, 0, 0], boundsMax: [10, 2, 10] },
    "scatter",
  );
  const sub = g.add(def, undefined, "sub");
  g.connect(scatter, "out", sub, "pts");
  g.output(sub, "out", "result");
  return g;
}

/** Outer graph with a subgraph nested inside another subgraph. */
function buildNested(seed: number): Graph {
  const inner2 = new Graph();
  const xf2 = inner2.add(transformPoints, { translate: [0, 1, 0] }, "xf2");
  const def2 = subgraphNode(
    inner2,
    [{ name: "in", node: xf2, pin: "in" }],
    [{ name: "out", node: xf2, pin: "out" }],
  );

  const inner1 = new Graph();
  const jit = inner1.add(
    jitterPoints,
    { amount: fieldFromJson({ fn: "vec", args: [0.2, 0, 0.2] }) },
    "jit",
  );
  const deep = inner1.add(def2, undefined, "deep");
  inner1.connect(jit, "out", deep, "in");
  const def1 = subgraphNode(
    inner1,
    [{ name: "in", node: jit, pin: "in" }],
    [{ name: "out", node: deep, pin: "out" }],
  );

  const g = new Graph(seed);
  const scatter = g.add(pointScatterInBounds, { count: 50 }, "scatter");
  const sub = g.add(def1, undefined, "sub");
  g.connect(scatter, "out", sub, "in");
  g.output(sub, "out", "result");
  return g;
}

describe("subgraph registry entry", () => {
  it("is registered with metadata-only pins and params", () => {
    expect(hasNodeType("subgraph")).toBe(true);
    const info = getNodeType("subgraph").info;
    expect(info.inputs).toEqual([]);
    expect(info.outputs).toEqual([]);
    expect(info.params).toEqual({});
    expect(info.description).toMatch(/subgraphNode/);
  });

  it("its def cannot cook and points at subgraphNode", () => {
    const def = getNodeType("subgraph").def;
    expect(() =>
      def.execute({
        inputs: {},
        params: {},
        seed: 0,
        checkCancelled() {
          /* noop */
        },
      }),
    ).toThrow(/metadata-only.*subgraphNode/);
  });
});

describe("subgraph serialization", () => {
  it("serializes as a nested payload without the injected plumbing", () => {
    const json = serializeGraph(buildOuter(42));
    const sub = json.nodes.find((n) => n.id === "sub");
    expect(sub).toBeDefined();
    expect(sub?.type).toBe("subgraph");
    expect(sub?.params).toEqual({});
    const payload = sub?.subgraph;
    expect(payload).toBeDefined();
    // Nested payload is the same versioned format, recursively.
    expect(payload?.graph.formatVersion).toBe(1);
    // Portal nodes, portal connections and __out_ declarations are
    // wrapper plumbing — never part of the payload.
    expect(payload?.graph.nodes.map((n) => n.id)).toEqual(["den", "filter", "xf"]);
    expect(payload?.graph.connections).toEqual([
      { from: ["den", "out"], to: ["filter", "in"] },
      { from: ["filter", "out"], to: ["xf", "in"] },
    ]);
    expect(payload?.graph.outputs).toEqual([]);
    expect(payload?.inputs).toEqual([{ name: "pts", node: "den", pin: "in" }]);
    expect(payload?.outputs).toEqual([{ name: "out", node: "xf", pin: "out" }]);
    // JSON-safe end to end.
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("round-trips: serialize(deserialize(j)) deep-equals j", () => {
    const json = serializeGraph(buildOuter(7));
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
  });

  it("a deserialized graph cooks byte-identically to the original", async () => {
    const original = buildOuter(1234);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(original))));
    const a = await cook(original);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.result);
    // The probabilistic filter kept a proper noise-driven subset.
    expect(geoA.pointCount).toBeGreaterThan(0);
    expect(geoA.pointCount).toBeLessThan(200);
    expect(snapshotGeometry(firstGeo(b.outputs.result))).toEqual(snapshotGeometry(geoA));
  });

  it("nested subgraphs round-trip recursively and cook byte-identically", async () => {
    const original = buildNested(5);
    const json = serializeGraph(original);
    const deep = json.nodes
      .find((n) => n.id === "sub")
      ?.subgraph?.graph.nodes.find((n) => n.id === "deep");
    expect(deep?.type).toBe("subgraph");
    expect(deep?.subgraph?.graph.nodes.map((n) => n.id)).toEqual(["xf2"]);

    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
    const a = await cook(original);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.result);
    expect(geoA.pointCount).toBe(50);
    expect(snapshotGeometry(firstGeo(b.outputs.result))).toEqual(snapshotGeometry(geoA));
  });

  it("emits identical JSON before and after cooks (canonical inner seed)", async () => {
    const g = buildNested(9);
    const before = serializeGraph(g);
    await cook(g); // overwrites the live inner seeds at every depth
    const after = serializeGraph(g);
    expect(after).toEqual(before);

    // The nested payload carries the wrap-time seed, not the transient
    // live seed a cook writes into the inner graph.
    const g2 = buildOuter(4);
    const json2 = serializeGraph(g2);
    expect(json2.nodes.find((n) => n.id === "sub")?.subgraph?.graph.seed).toBe(11);
    await cook(g2);
    expect(serializeGraph(g2)).toEqual(json2);

    // Both serializations rebuild to byte-identical cooks.
    const a = await cook(deserializeGraph(JSON.parse(JSON.stringify(before))));
    const b = await cook(deserializeGraph(JSON.parse(JSON.stringify(after))));
    expect(snapshotGeometry(firstGeo(b.outputs.result))).toEqual(
      snapshotGeometry(firstGeo(a.outputs.result)),
    );
  });

  it("nested inner edits on a code-first graph invalidate the outer cache", async () => {
    const g = buildNested(8);
    const r1 = await cook(g);
    const snap1 = snapshotGeometry(firstGeo(r1.outputs.result));
    expect((await cook(g)).stats.cached).toBe(2);

    const spec1 = getSubgraphSpec(g.require("sub").def);
    const spec2 = spec1 ? getSubgraphSpec(spec1.graph.require("deep").def) : undefined;
    expect(spec2).toBeDefined();
    spec2?.graph.setParam(
      { id: "xf2" } as NodeHandle<Record<string, unknown>>,
      "translate",
      [0, 9, 0],
    );
    const r2 = await cook(g);
    expect(r2.stats.cooked).toBe(1); // sub recooked, scatter cached
    expect(r2.stats.cached).toBe(1);
    expect(snapshotGeometry(firstGeo(r2.outputs.result))).not.toEqual(snap1);
  });

  it("nested inner edits after deserialization invalidate the outer cache", async () => {
    const rebuilt = deserializeGraph(serializeGraph(buildNested(6)));
    const r1 = await cook(rebuilt);
    const snap1 = snapshotGeometry(firstGeo(r1.outputs.result));
    expect((await cook(rebuilt)).stats.cached).toBe(2);

    const spec1 = getSubgraphSpec(rebuilt.require("sub").def);
    const spec2 = spec1 ? getSubgraphSpec(spec1.graph.require("deep").def) : undefined;
    expect(spec2).toBeDefined();
    spec2?.graph.setParam(
      { id: "xf2" } as NodeHandle<Record<string, unknown>>,
      "translate",
      [0, 9, 0],
    );
    const r2 = await cook(rebuilt);
    expect(r2.stats.cooked).toBe(1); // sub recooked, scatter cached
    expect(r2.stats.cached).toBe(1);
    expect(snapshotGeometry(firstGeo(r2.outputs.result))).not.toEqual(snap1);
  });

  it("inner-graph edits after deserialization still invalidate outer caches", async () => {
    const rebuilt = deserializeGraph(serializeGraph(buildOuter(3)));
    const r1 = await cook(rebuilt);
    const snap1 = snapshotGeometry(firstGeo(r1.outputs.result));
    const r1b = await cook(rebuilt);
    expect(r1b.stats.cached).toBe(2); // scatter + sub both served from cache

    const spec = getSubgraphSpec(rebuilt.require("sub").def);
    expect(spec).toBeDefined();
    spec?.graph.setParam(
      { id: "xf" } as NodeHandle<Record<string, unknown>>,
      "translate",
      [5, 0, 0],
    );
    const r2 = await cook(rebuilt);
    expect(r2.stats.cooked).toBe(1); // sub recooked ...
    expect(r2.stats.cached).toBe(1); // ... scatter still cached
    expect(snapshotGeometry(firstGeo(r2.outputs.result))).not.toEqual(snap1);
  });

  it("detects a subgraph node whose inner graph is the graph being serialized", () => {
    const g = new Graph();
    const xf = g.add(transformPoints, undefined, "xf");
    const def = subgraphNode(g, [], [{ name: "out", node: xf, pin: "out" }]);
    g.add(def, undefined, "ouro");
    expect(() => serializeGraph(g)).toThrow(GraphSerializationError);
    expect(() => serializeGraph(g)).toThrow(/node "ouro".*cycle/);
  });

  it("detects an indirect subgraph cycle (A wraps B wraps A)", () => {
    const a = new Graph();
    const a1 = a.add(transformPoints, undefined, "a1");
    const b = new Graph();
    const b1 = b.add(transformPoints, undefined, "b1");
    const defA = subgraphNode(a, [], [{ name: "out", node: a1, pin: "out" }]);
    b.add(defA, undefined, "subA");
    const defB = subgraphNode(b, [], [{ name: "out", node: b1, pin: "out" }]);
    a.add(defB, undefined, "subB");
    expect(() => serializeGraph(a)).toThrow(GraphSerializationError);
    // Breadcrumb names the outer node, the innermost names the cycle.
    expect(() => serializeGraph(a)).toThrow(/node "subB" inner graph:.*node "subA".*cycle/);
  });

  it("rejects a hand-defined def of type subgraph, pointing at subgraphNode", () => {
    const fake = defineNode<Record<string, never>>({
      type: "subgraph",
      inputs: [],
      outputs: [{ name: "out", kind: "any" }],
      defaultParams: {},
      execute: () => ({ out: [] }),
    });
    const g = new Graph();
    g.add(fake, undefined, "fake");
    expect(() => serializeGraph(g)).toThrow(/node "fake".*subgraphNode/);
  });
});

describe("subgraph deserialization validation", () => {
  const innerGraphJson = {
    formatVersion: 1,
    seed: 0,
    nodes: [{ id: "t", type: "transformPoints", params: {} }],
    connections: [],
    outputs: [],
  };
  const outer = (node: Record<string, unknown>): Record<string, unknown> => ({
    formatVersion: 1,
    seed: 0,
    nodes: [node],
    connections: [],
    outputs: [],
  });

  it("requires the subgraph payload, naming the node", () => {
    expect(() => deserializeGraph(outer({ id: "s", type: "subgraph", params: {} }))).toThrow(
      /node "s": a "subgraph" node needs a "subgraph" payload/,
    );
  });

  it("rejects params on subgraph nodes, naming them", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: { bogus: 1 },
          subgraph: { graph: innerGraphJson, inputs: [], outputs: [] },
        }),
      ),
    ).toThrow(/node "s": subgraph nodes carry no params.*found: bogus/);
  });

  it("rejects exposed pins referencing unknown inner nodes, listing them", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: innerGraphJson,
            inputs: [{ name: "in", node: "ghost", pin: "in" }],
            outputs: [],
          },
        }),
      ),
    ).toThrow(/node "s" subgraph inputs\[0\] \("in"\): unknown inner node "ghost"; inner nodes: t/);
  });

  it("rejects exposed pins referencing missing pins, naming node and pin", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: innerGraphJson,
            inputs: [{ name: "in", node: "t", pin: "warp" }],
            outputs: [],
          },
        }),
      ),
    ).toThrow(/node "s": exposed input "in": node "t" has no input pin "warp"/);
  });

  it("surfaces inner-graph validation errors with the wrapping node as context", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: { ...innerGraphJson, nodes: [{ id: "t", type: "warpDrive", params: {} }] },
            inputs: [],
            outputs: [],
          },
        }),
      ),
    ).toThrow(/node "s" inner graph: node "t": unknown node type "warpDrive"/);
  });

  it("explains reserved __in_ ids on portal collisions, naming node, id, pin and fix", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: {
              formatVersion: 1,
              seed: 0,
              nodes: [
                { id: "__in_pts", type: "transformPoints", params: {} },
                { id: "t", type: "transformPoints", params: {} },
              ],
              connections: [],
              outputs: [],
            },
            inputs: [{ name: "pts", node: "t", pin: "in" }],
            outputs: [],
          },
        }),
      ),
    ).toThrow(
      /node "s": inner node id "__in_pts" collides with the portal node injected for exposed input "pts".*reserved for subgraph plumbing; rename the inner node or the exposed pin/,
    );
  });

  it("explains reserved __out_ names on output collisions, naming node, name, pin and fix", () => {
    expect(() =>
      deserializeGraph(
        outer({
          id: "s",
          type: "subgraph",
          params: {},
          subgraph: {
            graph: {
              ...innerGraphJson,
              outputs: [{ id: "t", pin: "out", name: "__out_res" }],
            },
            inputs: [],
            outputs: [{ name: "res", node: "t", pin: "out" }],
          },
        }),
      ),
    ).toThrow(
      /node "s": inner output "__out_res" collides with the output injected for exposed output "res".*reserved for subgraph plumbing; rename the inner output or the exposed pin/,
    );
  });

  it("rejects a self-referencing payload object instead of recursing forever", () => {
    const payload: Record<string, unknown> = { inputs: [], outputs: [] };
    payload.graph = {
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "s2", type: "subgraph", params: {}, subgraph: payload }],
      connections: [],
      outputs: [],
    };
    expect(() =>
      deserializeGraph(outer({ id: "s", type: "subgraph", params: {}, subgraph: payload })),
    ).toThrow(/node "s2".*payload cycle|node "s2".*reaches itself/);
  });

  it("validates connections against a subgraph instance's exposed pins", () => {
    const json = JSON.parse(JSON.stringify(serializeGraph(buildOuter(1)))) as {
      connections: unknown[];
    };
    json.connections[0] = { from: ["scatter", "out"], to: ["sub", "nope"] };
    expect(() => deserializeGraph(json)).toThrow(
      /connections\[0\]: node "sub" has no input pin "nope"; valid input pins: pts/,
    );
  });
});
