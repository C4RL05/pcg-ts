import { describe, expect, it } from "vitest";
import { type Field, add, makeField, mul, position } from "../fields/index.js";
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

/**
 * The grammar's nesting cap, restated here rather than imported: this is
 * the boundary the serialized format promises, so a change to it must
 * break a test and be re-approved, not follow the code silently.
 */
const MAX_DEPTH = 256;

/** A field whose derived spec is exactly `levels` deep (position + adds). */
function addChain(levels: number): Field {
  let f: Field = position();
  for (let i = 1; i < levels; i++) f = add(f, 1);
  return f;
}

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

  it("rejects fields with no derivable spec, naming the node, the param and the cause", () => {
    // `makeField` takes an arbitrary closure, so no spec can describe it
    // — and a combinator over one inherits that (undefined propagates).
    const opaque = makeField("opaque", 1, (ctx) => ({
      data: new Float32Array(ctx.geo.attrs[ctx.domain].count),
      tupleSize: 1,
    }));
    const g = new Graph();
    const jit = g.add(jitterPoints, { amount: mul(opaque, 0.1) }, "jit");
    g.output(jit, "out");
    // Matching only "fieldFromJson" could not tell the real message from
    // one that misstates the cause, so the cause is pinned too.
    expect(() => serializeGraph(g)).toThrow(/node "jit" param "amount".*carries no JSON spec/);
    expect(() => serializeGraph(g)).toThrow(/makeField closure can never be named/);
  });

  it("refuses a field nested past the grammar's cap instead of writing an unloadable graph", () => {
    // The contract is that a derived spec always survives `fieldFromJson`.
    // A chain one level past the cap therefore carries NO spec, and the
    // graph refuses up front — rather than serializing to JSON that
    // `deserializeGraph` would then throw on, which is a saved file that
    // cannot be opened.
    const g = new Graph();
    const jit = g.add(jitterPoints, { amount: addChain(MAX_DEPTH + 1) }, "jit");
    g.output(jit, "out");
    expect(() => serializeGraph(g)).toThrow(GraphSerializationError);
    expect(() => serializeGraph(g)).toThrow(/node "jit" param "amount".*carries no JSON spec/);
    expect(() => serializeGraph(g)).toThrow(/at most 256 levels deep/);

    // One level shallower serializes AND loads back — the refusal is the
    // cap, not a blanket refusal of deep expressions.
    const ok = new Graph(4);
    const src = ok.add(pointScatterInBounds, { count: 8 }, "src");
    const deep = ok.add(jitterPoints, { amount: addChain(MAX_DEPTH) }, "jit");
    ok.connect(src, "out", deep, "in");
    ok.output(deep, "out", "result");
    const json = serializeGraph(ok);
    expect(() => deserializeGraph(JSON.parse(JSON.stringify(json)))).not.toThrow();
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

  it("round-trips a graph whose field param was built from combinators", async () => {
    // Before derived specs this threw: a combinator field carried no
    // spec, so the whole graph was unserializable and the author had to
    // rewrite the field as JSON. That authoring cliff is what phase 32
    // removes, so the positive case is pinned here rather than left to
    // the negative test above to imply.
    const g = new Graph(9);
    const src = g.add(pointScatterInBounds, { count: 64 }, "src");
    const jit = g.add(jitterPoints, { amount: mul(position(), 0.1) }, "jit");
    g.connect(src, "out", jit, "in");
    g.output(jit, "out", "result");

    const json = serializeGraph(g);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    // Idempotent thereafter, and cooks to the same bytes as the graph
    // that was never serialized at all.
    expect(serializeGraph(rebuilt)).toEqual(json);
    const a = firstGeo((await cook(g)).outputs.result);
    const b = firstGeo((await cook(rebuilt)).outputs.result);
    expect(a.pointCount).toBeGreaterThan(0);
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
  });

  it("canonicalizes scalar values on vec field-capable params and cooks identically", async () => {
    // amount: 0.5 is runtime-legal on the vec3 param via tuple-1
    // broadcast; serialization canonicalizes it to [0.5, 0.5, 0.5].
    const g = new Graph(3);
    const src = g.add(pointScatterInBounds, { count: 40 }, "src");
    const jit = g.add(jitterPoints, { amount: 0.5 }, "jit");
    g.connect(src, "out", jit, "in");
    g.output(jit, "out", "result");
    const json = serializeGraph(g);
    expect(json.nodes[1].params.amount).toEqual([0.5, 0.5, 0.5]);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    const a = await cook(g);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.result);
    expect(geoA.pointCount).toBe(40);
    expect(snapshotGeometry(firstGeo(b.outputs.result))).toEqual(snapshotGeometry(geoA));
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

  it("wraps cyclic field specs as GraphSerializationError", () => {
    const cyclic: Record<string, unknown> = { fn: "abs" };
    cyclic.args = [cyclic];
    const build = () =>
      deserializeGraph({
        ...base,
        nodes: [
          { id: "a", type: "pointScatterInBounds", params: {} },
          { id: "s", type: "setAttribute", params: { value: cyclic } },
        ],
      });
    expect(build).toThrow(GraphSerializationError);
    expect(build).toThrow(/node "s" param "value".*cyclic field spec/);
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

describe("string setAttribute serialization", () => {
  /** scatter -> string species from a random selector -> output. */
  function buildStringGraph(seed: number): Graph {
    const g = new Graph(seed);
    const scatter = g.add(
      pointScatterInBounds,
      { count: 60, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
      "scatter",
    );
    const species = g.add(
      setAttribute,
      {
        name: "species",
        type: "string",
        values: ["pine", "bush", "rock"],
        value: fieldFromJson({
          fn: "floor",
          args: [{ fn: "mul", args: [{ fn: "randomField", key: 2 }, 3] }],
        }),
        seed: 11,
      },
      "species",
    );
    g.connect(scatter, "out", species, "in");
    g.output(species, "out", "pts");
    return g;
  }

  it("serializes string-list contents (authoring data, unlike items)", () => {
    const json = serializeGraph(buildStringGraph(21));
    const species = json.nodes[1];
    expect(species.params.values).toEqual(["pine", "bush", "rock"]);
    expect(species.params.type).toBe("string");
    expect(species.params.stringValue).toBe("");
    expect(species.params.seed).toBe(11);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(serializeGraph(deserializeGraph(JSON.parse(JSON.stringify(json))))).toEqual(json);
  });

  it("deserialized graph cooks byte-identically, string table and indices included", async () => {
    const original = buildStringGraph(77);
    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(original))));
    const a = await cook(original);
    const b = await cook(rebuilt);
    const geoA = firstGeo(a.outputs.pts);
    const geoB = firstGeo(b.outputs.pts);
    const attr = geoA.attrs.point.require("species");
    expect(attr.type).toBe("string");
    // The selector actually spreads over multiple values.
    const distinct = new Set<string>();
    for (let i = 0; i < geoA.pointCount; i++) distinct.add(attr.getString(i));
    expect(distinct.size).toBeGreaterThan(1);
    // snapshotGeometry captures raw indices AND resolved strings.
    expect(snapshotGeometry(geoB)).toEqual(snapshotGeometry(geoA));
  });

  it("rejects non-string entries in stringList params, naming node and param", () => {
    expect(() =>
      deserializeGraph({
        formatVersion: 1,
        seed: 0,
        nodes: [{ id: "s", type: "setAttribute", params: { type: "string", values: [1] } }],
        connections: [],
        outputs: [],
      }),
    ).toThrow(/node "s" param "values": expected an array of strings/);
  });
});
