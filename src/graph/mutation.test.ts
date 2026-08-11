/**
 * Phase 16 — Graph mutation: removeNode / disconnect / removeOutput,
 * their exact cache semantics (cook stats prove what recooked), memory
 * boundedness under add/remove cycles, subgraph interplay, and
 * serialization consistency after mutation sequences.
 */
import { describe, expect, it } from "vitest";
import {
  deserializeGraph,
  jitterPoints,
  pointScatterInBounds,
  serializeGraph,
  transformPoints,
} from "../nodes/index.js";
import { firstGeo, snapshotGeometry } from "../nodes/nodes.testsupport.js";
import type { DataCollection } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { getSubgraphPlumbing, subgraphNode } from "./subgraph.js";
import { counterNode, makePointsNode, mergeNode, transformNode } from "./testNodes.js";

function valuesOf(coll: DataCollection | undefined): unknown[] {
  return (coll ?? []).map((item) => (item.kind === "value" ? item.value : item.kind));
}

describe("removeNode", () => {
  it("removes the node, all touching connections, and its declared outputs", () => {
    const g = new Graph();
    const a = g.add(makePointsNode(), undefined, "a");
    const t = g.add(transformNode(), undefined, "t");
    const m = g.add(mergeNode(), undefined, "m");
    g.connect(a, "out", t, "in");
    g.connect(t, "out", m, "in");
    g.output(t, "out", "res");
    g.output(a, "out", "src");
    const before = g.version;
    g.removeNode(t);
    expect(g.version).toBeGreaterThan(before);
    const d = g.describe();
    expect(d.nodes.map((n) => n.id)).toEqual(["a", "m"]);
    expect(d.connections).toEqual([]);
    expect(d.outputs).toEqual([{ id: "a", pin: "out", name: "src" }]);
  });

  it("throws for foreign or already-removed handles, without bumping the version", () => {
    const g1 = new Graph();
    const g2 = new Graph();
    const foreign = g2.add(makePointsNode(), undefined, "far");
    const before = g1.version;
    expect(() => g1.removeNode(foreign)).toThrow(GraphValidationError);
    expect(() => g1.removeNode(foreign)).toThrow(/unknown node "far"/);
    expect(g1.version).toBe(before);
    const h = g1.add(makePointsNode(), undefined, "gone");
    g1.removeNode(h);
    expect(() => g1.removeNode(h)).toThrow(/unknown node "gone"/);
  });

  it("recooks exactly the downstream of the removal; untouched branches stay cached", async () => {
    const g = new Graph();
    const a = counterNode(1);
    const b = counterNode(2);
    const c = counterNode(3);
    const d = counterNode(4);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    const hc = g.add(c.def, undefined, "c");
    const hd = g.add(d.def, undefined, "d");
    g.connect(ha, "out", hb, "in");
    g.connect(hc, "out", hd, "in");
    g.output(hb, "out", "left");
    g.output(hd, "out", "right");
    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(4);
    expect(valuesOf(r1.outputs.left)).toEqual([3]); // 1 + 2

    g.removeNode(ha);
    const r2 = await cook(g);
    // b lost its input (changed input revs): recooks. c and d: cached.
    expect(r2.stats.cooked).toBe(1);
    expect(r2.stats.cached).toBe(2);
    expect(b.state.count).toBe(2);
    expect(c.state.count).toBe(1);
    expect(d.state.count).toBe(1);
    expect(valuesOf(r2.outputs.left)).toEqual([2]);
    expect(valuesOf(r2.outputs.right)).toEqual([7]);
  });

  it("upstream survivors of a removed mid-chain node keep their caches", async () => {
    const g = new Graph();
    const a = counterNode(1);
    const m = counterNode(10);
    const z = counterNode(100);
    const ha = g.add(a.def, undefined, "a");
    const hm = g.add(m.def, undefined, "m");
    const hz = g.add(z.def, undefined, "z");
    g.connect(ha, "out", hm, "in");
    g.connect(hm, "out", hz, "in");
    g.output(ha, "out", "head");
    g.output(hz, "out", "tail");
    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(3);
    expect(valuesOf(r1.outputs.tail)).toEqual([111]);

    g.removeNode(hm);
    const r2 = await cook(g);
    expect(r2.stats.cooked).toBe(1); // z, with its input gone
    expect(r2.stats.cached).toBe(1); // a, untouched
    expect(a.state.count).toBe(1);
    expect(valuesOf(r2.outputs.tail)).toEqual([100]);
  });

  it("per-output cooking rejects a name removed by the cascade, listing survivors", async () => {
    const g = new Graph();
    const p = g.add(makePointsNode(), undefined, "p");
    const t = g.add(transformNode(), undefined, "t");
    g.connect(p, "out", t, "in");
    g.output(t, "out", "res");
    g.output(p, "out", "src");
    g.removeNode(t);
    await expect(cook(g, { outputs: ["res"] })).rejects.toThrow(
      /unknown output "res"; declared outputs: "src"/,
    );
    const r = await cook(g);
    expect(Object.keys(r.outputs)).toEqual(["src"]);
  });

  it("repeated add/cook/remove cycles keep every graph-owned structure bounded", async () => {
    const g = new Graph();
    const sinkCounter = counterNode(0);
    const sink = g.add(sinkCounter.def, undefined, "sink");
    g.output(sink, "out", "res");
    await cook(g);
    for (let i = 0; i < 25; i++) {
      const c = counterNode(i);
      const h = g.add(c.def);
      g.connect(h, "out", sink, "in");
      g.output(h, "out", "tmp");
      await cook(g); // populates the transient node's memo cache
      g.removeNode(h); // cascade drops its connection, output, and cache
    }
    // The memo caches live on the per-node states in _nodes, so these
    // sizes bound everything the graph retains across the cycles.
    expect(g._nodes.size).toBe(1);
    expect(g._connections).toHaveLength(0);
    expect(g._outputs).toHaveLength(1);
    expect(g._inTo.size).toBeLessThanOrEqual(1);
    expect(g._outFrom.size).toBeLessThanOrEqual(1);
    for (const list of g._inTo.values()) expect(list).toHaveLength(0);
    for (const list of g._outFrom.values()) expect(list).toHaveLength(0);
    const r = await cook(g);
    expect(valuesOf(r.outputs.res)).toEqual([0]);
  });
});

describe("disconnect", () => {
  it("keeps the remaining multi-input connections in insertion order", async () => {
    const g = new Graph();
    const a = counterNode(1);
    const b = counterNode(2);
    const c = counterNode(3);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    const hc = g.add(c.def, undefined, "c");
    const m = g.add(mergeNode(), undefined, "m");
    g.connect(ha, "out", m, "in");
    g.connect(hb, "out", m, "in");
    g.connect(hc, "out", m, "in");
    g.output(m, "out", "res");
    const r1 = await cook(g);
    expect(valuesOf(r1.outputs.res)).toEqual([1, 2, 3]);

    expect(g.disconnect(hb, "out", m, "in")).toBe(true);
    const r2 = await cook(g);
    expect(valuesOf(r2.outputs.res)).toEqual([1, 3]);
    // Only the merge recooked; the untouched sources served their caches.
    expect(r2.stats.cooked).toBe(1);
    expect(r2.stats.cached).toBe(2);

    // Reconnecting appends at the end of the order, deterministically.
    g.connect(hb, "out", m, "in");
    const r3 = await cook(g);
    expect(valuesOf(r3.outputs.res)).toEqual([1, 3, 2]);
  });

  it("names unknown nodes and pins and lists the valid pins", () => {
    const g = new Graph();
    const other = new Graph();
    const foreign = other.add(makePointsNode(), undefined, "far");
    const p = g.add(makePointsNode(), undefined, "p");
    const t = g.add(transformNode(), undefined, "t");
    g.connect(p, "out", t, "in");
    expect(() => g.disconnect(foreign, "out", t, "in")).toThrow(/unknown node "far"/);
    expect(() => g.disconnect(p, "nope", t, "in")).toThrow(
      /node "p" has no output pin "nope"; output pins: "out"/,
    );
    expect(() => g.disconnect(p, "out", t, "nope")).toThrow(
      /node "t" has no input pin "nope"; input pins: "in"/,
    );
    // Valid endpoints, no such connection: reported as false, no bump.
    const before = g.version;
    expect(g.disconnect(t, "out", t, "in")).toBe(false);
    expect(g.version).toBe(before);
  });
});

describe("removeOutput", () => {
  it("undeclares the name, keeps node caches, and frees the name for redeclaration", async () => {
    const g = new Graph();
    const p = g.add(makePointsNode(), undefined, "p");
    g.output(p, "out", "a1");
    g.output(p, "out", "a2");
    const r1 = await cook(g);
    expect(Object.keys(r1.outputs)).toEqual(["a1", "a2"]);

    const before = g.version;
    g.removeOutput("a1");
    expect(g.version).toBeGreaterThan(before);
    const r2 = await cook(g);
    expect(Object.keys(r2.outputs)).toEqual(["a2"]);
    // No memo key changed: the sole node is served from cache.
    expect(r2.stats.cooked).toBe(0);
    expect(r2.stats.cached).toBe(1);
    await expect(cook(g, { outputs: ["a1"] })).rejects.toThrow(
      /unknown output "a1"; declared outputs: "a2"/,
    );
    g.output(p, "out", "a1"); // the name is free again
    const r3 = await cook(g);
    expect(Object.keys(r3.outputs)).toEqual(["a2", "a1"]);
  });

  it("unknown names throw and list what is declared", () => {
    const g = new Graph();
    expect(() => g.removeOutput("zzz")).toThrow(GraphValidationError);
    expect(() => g.removeOutput("zzz")).toThrow(
      /unknown output "zzz": this graph declares no outputs/,
    );
    const p = g.add(makePointsNode(), undefined, "p");
    g.output(p, "out", "kept");
    const before = g.version;
    expect(() => g.removeOutput("zzz")).toThrow(/declared outputs: "kept"/);
    expect(g.version).toBe(before);
  });
});

describe("subgraph interplay", () => {
  it("removing a subgraph instance leaves no ghosts in serialization or plumbing", async () => {
    const inner = new Graph();
    const it_ = inner.add(transformNode(), { offset: [1, 0, 0] }, "t");
    const def = subgraphNode(
      inner,
      [{ name: "in", node: it_, pin: "in" }],
      [{ name: "out", node: it_, pin: "out" }],
    );

    const outer = new Graph(5);
    const scatter = outer.add(
      pointScatterInBounds,
      { count: 6, boundsMin: [0, 0, 0], boundsMax: [4, 1, 4] },
      "scatter",
    );
    const sub = outer.add(def, {}, "sub");
    outer.connect(scatter, "out", sub, "in");
    outer.output(sub, "out", "res");
    outer.output(scatter, "out", "raw");
    const r1 = await cook(outer);
    expect(Object.keys(r1.outputs)).toEqual(["res", "raw"]);

    outer.removeNode(sub);
    // Serialization sees only the surviving structure — no subgraph node,
    // no dangling connection or output — and round-trips.
    const json = serializeGraph(outer);
    expect(json.nodes.map((n) => n.id)).toEqual(["scatter"]);
    expect(json.connections).toEqual([]);
    expect(json.outputs).toEqual([{ id: "scatter", pin: "out", name: "raw" }]);
    expect(getSubgraphPlumbing(outer)).toBeUndefined();

    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    const live = await cook(outer);
    const round = await cook(rebuilt);
    expect(snapshotGeometry(firstGeo(round.outputs.raw))).toEqual(
      snapshotGeometry(firstGeo(live.outputs.raw)),
    );

    // The definition survives instance removal: re-adding it cooks.
    const sub2 = outer.add(def, {}, "sub2");
    outer.connect(scatter, "out", sub2, "in");
    outer.output(sub2, "out", "res2");
    const r2 = await cook(outer);
    expect(firstGeo(r2.outputs.res2).pointCount).toBe(6);
  });

  it("removing a node inside a wrapped inner graph invalidates the wrapping node only", async () => {
    const inner = new Graph();
    const c = counterNode(5);
    const hc = inner.add(c.def, undefined, "c");
    const dangling = inner.add(counterNode(9).def, undefined, "dangling");
    const def = subgraphNode(inner, [], [{ name: "res", node: hc, pin: "out" }]);

    const g = new Graph();
    const s = g.add(def, undefined, "sub");
    g.output(s, "res", "out");
    const r1 = await cook(g);
    expect(valuesOf(r1.outputs.out)).toEqual([5]);
    const r2 = await cook(g);
    expect(r2.stats.cached).toBe(1);

    // An inner removal is an inner edit: the outer memo key folds the
    // inner version, so the wrapper recooks — but unchanged inner nodes
    // still serve their own caches (the counter does not re-execute).
    inner.removeNode(dangling);
    const r3 = await cook(g);
    expect(r3.stats.cooked).toBe(1);
    expect(valuesOf(r3.outputs.out)).toEqual([5]);
    expect(c.state.count).toBe(1);
  });
});

describe("serialization consistency after mutation", () => {
  it("a mutated graph serializes, round-trips, and cooks byte-identically", async () => {
    const g = new Graph(42);
    const scatter = g.add(
      pointScatterInBounds,
      { count: 50, boundsMin: [0, 0, 0], boundsMax: [10, 2, 10] },
      "scatter",
    );
    const jit = g.add(jitterPoints, { amount: [0.2, 0, 0.2], seed: 3 }, "jit");
    const xf = g.add(transformPoints, { translate: [1, 0, 0] }, "xf");
    g.connect(scatter, "out", jit, "in");
    g.connect(jit, "out", xf, "in");
    g.output(xf, "out", "result");
    g.output(jit, "out", "mid");
    await cook(g); // caches populated before surgery

    // Mutation sequence: detach and remove the jitter (cascades away the
    // "mid" output and its connections), rewire scatter straight into the
    // transform, and exercise removeOutput on a fresh declaration.
    expect(g.disconnect(scatter, "out", jit, "in")).toBe(true);
    g.removeNode(jit);
    g.connect(scatter, "out", xf, "in");
    g.output(scatter, "out", "raw");
    g.removeOutput("raw");

    const json = serializeGraph(g);
    expect(json.nodes.map((n) => n.id)).toEqual(["scatter", "xf"]);
    expect(json.connections).toEqual([{ from: ["scatter", "out"], to: ["xf", "in"] }]);
    expect(json.outputs).toEqual([{ id: "xf", pin: "out", name: "result" }]);

    const rebuilt = deserializeGraph(JSON.parse(JSON.stringify(json)));
    expect(serializeGraph(rebuilt)).toEqual(json);
    const live = await cook(g);
    const round = await cook(rebuilt);
    expect(Object.keys(round.outputs)).toEqual(Object.keys(live.outputs));
    expect(snapshotGeometry(firstGeo(round.outputs.result))).toEqual(
      snapshotGeometry(firstGeo(live.outputs.result)),
    );
  });
});
