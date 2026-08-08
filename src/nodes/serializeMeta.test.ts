/**
 * The optional `meta` block: an additive, formatVersion-1 field carrying
 * what a graph is and what it is for. Cooking never reads it, so the
 * tests that matter are the round-trip, the strictness of its validation
 * (a near-miss key must fail loudly, not cook), and the guarantee that a
 * graph without meta serializes exactly as it did before the field
 * existed.
 */
import { describe, expect, it } from "vitest";
import { GRAPH_META_KEYS, Graph, subgraphNode } from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  pointScatterInBounds,
  serializeGraph,
} from "./index.js";

function scatterGraph(seed = 3): Graph {
  const g = new Graph(seed);
  const scatter = g.add(pointScatterInBounds, { count: 4 });
  g.output(scatter, "out", "points");
  return g;
}

/** Minimal valid graph JSON with the given meta value spliced in. */
function graphJsonWithMeta(meta: unknown): unknown {
  return {
    formatVersion: 1,
    seed: 1,
    meta,
    nodes: [{ id: "scatter", type: "pointScatterInBounds", params: { count: 2 } }],
    connections: [],
    outputs: [{ id: "scatter", pin: "out", name: "points" }],
  };
}

describe("graph meta", () => {
  it("round-trips through serialize and deserialize", () => {
    const g = scatterGraph();
    g.setMeta({
      title: "scatter basics",
      description: "Four points in a unit box.",
      tags: ["basics", "scatter"],
    });
    const json = serializeGraph(g);
    expect(json.formatVersion).toBe(1);
    expect(json.meta).toEqual({
      title: "scatter basics",
      description: "Four points in a unit box.",
      tags: ["basics", "scatter"],
    });

    const back = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(back.meta).toEqual(json.meta);
    expect(serializeGraph(back)).toEqual(json);
  });

  it("is omitted entirely when the graph declares none", () => {
    const json = serializeGraph(scatterGraph());
    expect("meta" in json).toBe(false);
    expect(deserializeGraph(JSON.parse(JSON.stringify(json))).meta).toBeUndefined();
  });

  it("keeps partial blocks partial: absent keys stay absent", () => {
    const g = scatterGraph();
    g.setMeta({ title: "only a title" });
    const meta = serializeGraph(g).meta as Record<string, unknown>;
    // Object.keys, not toEqual: toEqual treats an explicitly-undefined key
    // as absent, so it cannot tell `{title}` from `{title, tags: undefined}`
    // — and the second serializes to JSON the reader would refuse.
    expect(Object.keys(meta)).toEqual(["title"]);
    expect(JSON.stringify(meta)).toBe('{"title":"only a title"}');
  });

  it("emits the keys in canonical order regardless of author order", () => {
    const g = scatterGraph();
    g.setMeta({ tags: ["b"], description: "d", title: "t" });
    expect(JSON.stringify(serializeGraph(g).meta)).toBe(
      '{"title":"t","description":"d","tags":["b"]}',
    );
  });

  it("validates in setMeta by the same rules the reader applies", () => {
    const g = scatterGraph();
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["a non-string title", { title: 7 }, "setMeta.title: expected a string, got 7"],
      ["an unknown key", { titel: "typo" }, 'setMeta: unknown key "titel"; valid keys: '],
      ["a string where tags belong", { tags: "abc" }, "setMeta.tags: expected an array of strings"],
      ["a non-string tag", { tags: ["ok", 3] }, "setMeta.tags[1]: expected a string, got 3"],
      ["not an object at all", "a title", "setMeta: expected an object"],
    ];
    for (const [label, meta, message] of cases) {
      expect(() => g.setMeta(meta as never), label).toThrow(message);
    }
    // The writer refusing exactly what the reader refuses is the point:
    // anything setMeta accepts must survive a round-trip.
    expect(g.meta).toBeUndefined();
  });

  it("rejects a sparse tags array rather than saving holes as nulls", () => {
    const sparse: string[] = ["a"];
    sparse[2] = "c"; // index 1 is a hole
    expect(() => scatterGraph().setMeta({ tags: sparse })).toThrow(
      "setMeta.tags[1]: expected a string, got undefined",
    );
    expect(() => deserializeGraph(graphJsonWithMeta({ tags: sparse }))).toThrow(
      '"meta".tags[1]: expected a string',
    );
  });

  it("freezes the tags array it hands back, not just the block", () => {
    const g = scatterGraph();
    g.setMeta({ title: "t", tags: ["a"] });
    const tags = g.meta?.tags as string[];
    expect(Object.isFrozen(tags)).toBe(true);
    expect(() => tags.push("b")).toThrow();
    expect(g.meta?.tags).toEqual(["a"]);
  });

  it("cannot be made to advertise a key it would then drop", () => {
    // GRAPH_META_KEYS is read both to decide what is legal and to write
    // the error listing the alternatives; a mutable copy would let a
    // caller desynchronize the two.
    expect(Object.isFrozen(GRAPH_META_KEYS)).toBe(true);
    expect(() => (GRAPH_META_KEYS as string[]).push("author")).toThrow();
  });

  it("does not bump the graph version — retitling invalidates no cache", () => {
    const g = scatterGraph();
    const before = g.version;
    g.setMeta({ title: "renamed" });
    expect(g.version).toBe(before);
  });

  it("copies defensively and freezes what it stores", () => {
    const g = scatterGraph();
    const tags = ["a"];
    g.setMeta({ title: "t", tags });
    tags.push("b");
    expect(g.meta?.tags).toEqual(["a"]);
    expect(Object.isFrozen(g.meta)).toBe(true);
    g.setMeta(undefined);
    expect(g.meta).toBeUndefined();
  });

  it("travels inside a subgraph payload", () => {
    const inner = new Graph(9);
    const innerScatter = inner.add(pointScatterInBounds, { count: 2 });
    inner.setMeta({ title: "inner" });
    const outer = new Graph(1);
    const wrapped = outer.add(subgraphNode(inner, [], [{ name: "out", node: innerScatter, pin: "out" }]));
    outer.output(wrapped, "out", "points");
    outer.setMeta({ title: "outer" });

    const json = serializeGraph(outer);
    expect(json.meta).toEqual({ title: "outer" });
    expect(json.nodes[0].subgraph?.graph.meta).toEqual({ title: "inner" });
    const back = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(back.meta).toEqual({ title: "outer" });
    expect(serializeGraph(back)).toEqual(json);
  });

  describe("rejects malformed blocks, naming the offender", () => {
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["not an object", "a title", '"meta": expected an object'],
      ["an array", ["a"], '"meta": expected an object'],
      ["an unknown key", { titel: "typo" }, '"meta": unknown key "titel"; valid keys: title, description, tags'],
      ["a non-string title", { title: 7 }, '"meta".title: expected a string, got 7'],
      ["a non-string description", { description: [] }, '"meta".description: expected a string'],
      ["non-array tags", { tags: "basics" }, '"meta".tags: expected an array of strings'],
      ["a non-string tag", { tags: ["ok", 3] }, '"meta".tags[1]: expected a string, got 3'],
    ];
    for (const [label, meta, message] of cases) {
      it(label, () => {
        expect(() => deserializeGraph(graphJsonWithMeta(meta))).toThrow(GraphSerializationError);
        expect(() => deserializeGraph(graphJsonWithMeta(meta))).toThrow(message);
      });
    }
  });

  it("accepts an explicitly empty block", () => {
    const g = deserializeGraph(graphJsonWithMeta({}));
    expect(g.meta).toEqual({});
    expect(serializeGraph(g).meta).toEqual({});
  });
});
