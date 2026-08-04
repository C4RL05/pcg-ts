import { describe, expect, it } from "vitest";
import { constant, randomField } from "../fields/index.js";
import { firstGeometry } from "./data.js";
import { NodeExecutionError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode } from "./node.js";
import { counterNode, countNode, makePointsNode, mergeNode, transformNode } from "./testNodes.js";

function pointBytes(coll: Parameters<typeof firstGeometry>[0], count: number): number[] {
  const geo = firstGeometry(coll);
  if (!geo) throw new Error("no geometry in collection");
  return [...geo.attrs.point.require("P").data.subarray(0, count * 3)];
}

function valueOf(coll: Parameters<typeof firstGeometry>[0]): unknown {
  const item = coll[0];
  return item?.kind === "value" ? item.value : undefined;
}

describe("cook: execution order and reachability", () => {
  it("returns an empty result when no outputs are declared", async () => {
    const g = new Graph();
    g.add(makePointsNode());
    const result = await cook(g);
    expect(result.outputs).toEqual({});
    expect(result.stats.cooked).toBe(0);
    expect(result.stats.cached).toBe(0);
  });

  it("cooks upstream before downstream and only reachable nodes", async () => {
    const g = new Graph();
    const a = counterNode(1);
    const b = counterNode(2);
    const stray = counterNode(3);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    g.add(stray.def, undefined, "stray");
    g.connect(ha, "out", hb, "in");
    g.output(hb, "out");
    const seen: string[] = [];
    const result = await cook(g, { onNodeDone: (info) => seen.push(info.id) });
    expect(seen).toEqual(["a", "b"]);
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(1);
    expect(stray.state.count).toBe(0);
    expect(valueOf(result.outputs["b.out"])).toBe(3); // 2 + 1
  });

  it("keys outputs by default and custom names", async () => {
    const g = new Graph();
    const h = g.add(counterNode(7).def, undefined, "c");
    g.output(h, "out");
    g.output(h, "out", "alias");
    const result = await cook(g);
    expect(valueOf(result.outputs["c.out"])).toBe(7);
    expect(valueOf(result.outputs.alias)).toBe(7);
  });

  it("concatenates multi-pin inputs in connection order", async () => {
    const g = new Graph();
    const sa = g.add(counterNode(10).def);
    const sb = g.add(counterNode(20).def);
    const sc = g.add(counterNode(30).def);
    const m = g.add(mergeNode());
    g.connect(sb, "out", m, "in");
    g.connect(sa, "out", m, "in");
    g.connect(sc, "out", m, "in");
    g.output(m, "out", "res");
    const result = await cook(g);
    const values = result.outputs.res.map((it) => (it.kind === "value" ? it.value : undefined));
    expect(values).toEqual([20, 10, 30]);
  });

  it("treats unconnected input pins as empty collections", async () => {
    const g = new Graph();
    const c = g.add(countNode(), undefined, "n");
    g.output(c, "count");
    const result = await cook(g);
    expect(valueOf(result.outputs["n.count"])).toBe(0);
  });
});

describe("cook: caching and dirty propagation", () => {
  function chain() {
    const g = new Graph();
    const a = counterNode(1);
    const b = counterNode(10);
    const c = counterNode(100);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    const hc = g.add(c.def, undefined, "c");
    g.connect(ha, "out", hb, "in");
    g.connect(hb, "out", hc, "in");
    g.output(hc, "out", "res");
    return { g, a, b, c, ha, hb, hc };
  }

  it("serves everything from cache on an unchanged re-cook", async () => {
    const { g, a, b, c } = chain();
    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(3);
    expect(valueOf(r1.outputs.res)).toBe(111);
    const r2 = await cook(g);
    expect(r2.stats.cooked).toBe(0);
    expect(r2.stats.cached).toBe(3);
    expect(valueOf(r2.outputs.res)).toBe(111);
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(1);
    expect(c.state.count).toBe(1);
  });

  it("a param change recooks only the node and its downstream", async () => {
    const { g, a, b, c, hb } = chain();
    await cook(g);
    g.setParam(hb, "value", 20);
    const r = await cook(g);
    expect(a.state.count).toBe(1); // upstream untouched
    expect(b.state.count).toBe(2);
    expect(c.state.count).toBe(2); // input revs changed
    expect(r.stats.cached).toBe(1);
    expect(r.stats.cooked).toBe(2);
    expect(valueOf(r.outputs.res)).toBe(121);
  });

  it("does not recook siblings that are not downstream", async () => {
    const g = new Graph();
    const a = counterNode(1);
    const b = counterNode(10);
    const d = counterNode(1000);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    const hd = g.add(d.def, undefined, "d");
    g.connect(ha, "out", hb, "in");
    g.connect(ha, "out", hd, "in");
    g.output(hb, "out", "b");
    g.output(hd, "out", "d");
    await cook(g);
    g.setParam(hb, "value", 20);
    await cook(g);
    expect(b.state.count).toBe(2);
    expect(d.state.count).toBe(1);
  });

  it("an upstream change propagates to all downstream via revs", async () => {
    const { g, a, b, c, ha } = chain();
    await cook(g);
    g.setParam(ha, "value", 2);
    const r = await cook(g);
    expect(a.state.count).toBe(2);
    expect(b.state.count).toBe(2);
    expect(c.state.count).toBe(2);
    expect(valueOf(r.outputs.res)).toBe(112);
  });

  it("setting a param to an equal value keeps the cache", async () => {
    const { g, a, b, c, hb } = chain();
    await cook(g);
    g.setParam(hb, "value", 10); // same value: dirty flag set, key unchanged
    expect(g.isDirty(hb)).toBe(true);
    const r = await cook(g);
    expect(r.stats.cached).toBe(3);
    expect(b.state.count).toBe(1);
    expect(g.isDirty(hb)).toBe(false);
    expect(a.state.count + c.state.count).toBe(2);
  });

  it("hashes Field params by key identity, not instance identity", async () => {
    const g = new Graph();
    const p = g.add(makePointsNode(4), undefined, "pts");
    const t = g.add(transformNode(), undefined, "t");
    g.connect(p, "out", t, "in");
    g.output(t, "out", "res");
    g.setParam(t, "offset", constant([1, 2, 3]));
    const r1 = await cook(g);
    expect(r1.stats.cooked).toBe(2);
    // Fresh instance, same structural key: cached.
    g.setParam(t, "offset", constant([1, 2, 3]));
    const r2 = await cook(g);
    expect(r2.stats.cooked).toBe(0);
    expect(r2.stats.cached).toBe(2);
    // Different key: the transform recooks, the source stays cached.
    g.setParam(t, "offset", constant([4, 5, 6]));
    const r3 = await cook(g);
    expect(r3.stats.cooked).toBe(1);
    expect(r3.stats.cached).toBe(1);
  });

  it("setSeed recooks everything; re-setting the same seed does not", async () => {
    const g = new Graph(1);
    const p = g.add(makePointsNode(4), undefined, "pts");
    g.output(p, "out", "res");
    const r1 = await cook(g);
    const bytes1 = pointBytes(r1.outputs.res, 4);
    g.setSeed(2);
    const r2 = await cook(g);
    expect(r2.stats.cooked).toBe(1);
    expect(pointBytes(r2.outputs.res, 4)).not.toEqual(bytes1);
    g.setSeed(2);
    const r3 = await cook(g);
    expect(r3.stats.cached).toBe(1);
    g.setSeed(1);
    const r4 = await cook(g);
    expect(r4.stats.cooked).toBe(1);
    expect(pointBytes(r4.outputs.res, 4)).toEqual(bytes1);
  });

  it("disconnect dirties the target and changes its result", async () => {
    const g = new Graph();
    const a = counterNode(5);
    const b = counterNode(10);
    const ha = g.add(a.def, undefined, "a");
    const hb = g.add(b.def, undefined, "b");
    g.connect(ha, "out", hb, "in");
    g.output(hb, "out", "res");
    const r1 = await cook(g);
    expect(valueOf(r1.outputs.res)).toBe(15);
    g.disconnect(ha, "out", hb, "in");
    const r2 = await cook(g);
    expect(valueOf(r2.outputs.res)).toBe(10);
    expect(b.state.count).toBe(2);
  });
});

describe("cook: determinism and purity", () => {
  function buildReplayGraph(seed: number): Graph {
    const g = new Graph(seed);
    const p = g.add(makePointsNode(8), undefined, "pts");
    const t = g.add(transformNode(), { offset: randomField("jitter") }, "t");
    g.connect(p, "out", t, "in");
    g.output(t, "out", "res");
    return g;
  }

  it("two fresh identical graphs replay to identical geometry bytes", async () => {
    const r1 = await cook(buildReplayGraph(1234));
    const r2 = await cook(buildReplayGraph(1234));
    expect(pointBytes(r1.outputs.res, 8)).toEqual(pointBytes(r2.outputs.res, 8));
    const r3 = await cook(buildReplayGraph(99));
    expect(pointBytes(r3.outputs.res, 8)).not.toEqual(pointBytes(r1.outputs.res, 8));
  });

  it("transform does not mutate its cached input geometry", async () => {
    const g = new Graph();
    const p = g.add(makePointsNode(4), undefined, "pts");
    const t = g.add(transformNode(), { offset: [1, 1, 1] }, "t");
    g.connect(p, "out", t, "in");
    g.output(p, "out", "src");
    g.output(t, "out", "res");
    const r1 = await cook(g);
    const srcGeo = firstGeometry(r1.outputs.src);
    const before = pointBytes(r1.outputs.src, 4);
    for (let i = 0; i < before.length; i++) {
      expect(pointBytes(r1.outputs.res, 4)[i]).toBeCloseTo(before[i] + 1, 5);
    }
    // Recook only the transform; the source is served from cache (same
    // geometry object) and must be untouched by the transform's work.
    g.setParam(t, "offset", [2, 2, 2]);
    const r2 = await cook(g);
    expect(firstGeometry(r2.outputs.src)).toBe(srcGeo);
    expect(pointBytes(r2.outputs.src, 4)).toEqual(before);
    for (let i = 0; i < before.length; i++) {
      expect(pointBytes(r2.outputs.res, 4)[i]).toBeCloseTo(before[i] + 2, 5);
    }
  });
});

describe("cook: node failures", () => {
  it("wraps execute exceptions in NodeExecutionError with the node id", async () => {
    const boom = defineNode<Record<string, never>>({
      type: "boom",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      execute() {
        throw new Error("kaboom");
      },
    });
    const g = new Graph();
    const h = g.add(boom, undefined, "boom_1");
    g.output(h, "out");
    const err = await cook(g).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NodeExecutionError);
    expect((err as NodeExecutionError).nodeId).toBe("boom_1");
    expect(((err as NodeExecutionError).cause as Error).message).toBe("kaboom");
  });

  it("rejects when a node omits a declared output pin", async () => {
    const lazy = defineNode<Record<string, never>>({
      type: "lazy",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      execute() {
        return {};
      },
    });
    const g = new Graph();
    const h = g.add(lazy);
    g.output(h, "out");
    await expect(cook(g)).rejects.toBeInstanceOf(NodeExecutionError);
  });
});
