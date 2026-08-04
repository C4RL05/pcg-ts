import { describe, expect, it } from "vitest";
import { firstGeometry, type DataCollection } from "./data.js";
import { CookCancelledError, GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { subgraphNode } from "./subgraph.js";
import { counterNode, makePointsNode, slowNode, transformNode } from "./testNodes.js";

function pointBytes(coll: DataCollection, count: number): number[] {
  const geo = firstGeometry(coll);
  if (!geo) throw new Error("no geometry in collection");
  return [...geo.attrs.point.require("P").data.subarray(0, count * 3)];
}

function valueOf(coll: DataCollection): unknown {
  const item = coll[0];
  return item?.kind === "value" ? item.value : undefined;
}

describe("subgraphNode", () => {
  it("cooks the inner graph with outer inputs and exposes outputs", async () => {
    const inner = new Graph();
    const t = inner.add(transformNode(), { offset: [1, 0, 0] }, "t");
    const def = subgraphNode(inner, [{ name: "geo", node: t, pin: "in" }], [
      { name: "res", node: t, pin: "out" },
    ]);

    const g = new Graph();
    const p = g.add(makePointsNode(4), undefined, "pts");
    const s = g.add(def, undefined, "sub");
    g.connect(p, "out", s, "geo");
    g.output(p, "out", "src");
    g.output(s, "res", "out");
    const r = await cook(g);
    const src = pointBytes(r.outputs.src, 4);
    const res = pointBytes(r.outputs.out, 4);
    for (let i = 0; i < src.length; i++) {
      expect(res[i]).toBeCloseTo(src[i] + (i % 3 === 0 ? 1 : 0), 5);
    }
  });

  it("caches at the outer level on an unchanged re-cook", async () => {
    const inner = new Graph();
    const c = counterNode(5);
    const h = inner.add(c.def, undefined, "c");
    const def = subgraphNode(inner, [], [{ name: "res", node: h, pin: "out" }]);

    const g = new Graph();
    const s = g.add(def, undefined, "sub");
    g.output(s, "res", "out");
    const r1 = await cook(g);
    expect(valueOf(r1.outputs.out)).toBe(5);
    expect(c.state.count).toBe(1);
    const r2 = await cook(g);
    expect(r2.stats.cached).toBe(1);
    expect(c.state.count).toBe(1); // inner graph never re-cooked
    expect(valueOf(r2.outputs.out)).toBe(5);
  });

  it("persists inner caches across outer re-executions", async () => {
    // Two independent chains inside the subgraph; changing only one outer
    // input must recook only that chain inside.
    const inner = new Graph();
    const ca = counterNode(1);
    const cb = counterNode(2);
    const ia = inner.add(ca.def, undefined, "ca");
    const ib = inner.add(cb.def, undefined, "cb");
    const def = subgraphNode(
      inner,
      [
        { name: "a", node: ia, pin: "in" },
        { name: "b", node: ib, pin: "in" },
      ],
      [
        { name: "oa", node: ia, pin: "out" },
        { name: "ob", node: ib, pin: "out" },
      ],
    );

    const g = new Graph();
    const sa = counterNode(10);
    const sb = counterNode(20);
    const ha = g.add(sa.def, undefined, "sa");
    const hb = g.add(sb.def, undefined, "sb");
    const s = g.add(def, undefined, "sub");
    g.connect(ha, "out", s, "a");
    g.connect(hb, "out", s, "b");
    g.output(s, "oa", "oa");
    g.output(s, "ob", "ob");

    const r1 = await cook(g);
    expect(valueOf(r1.outputs.oa)).toBe(11);
    expect(valueOf(r1.outputs.ob)).toBe(22);
    expect(ca.state.count).toBe(1);
    expect(cb.state.count).toBe(1);

    g.setParam(ha, "value", 50);
    const r2 = await cook(g);
    expect(valueOf(r2.outputs.oa)).toBe(51);
    expect(valueOf(r2.outputs.ob)).toBe(22);
    expect(ca.state.count).toBe(2); // affected chain recooked
    expect(cb.state.count).toBe(1); // untouched chain served from inner cache
  });

  it("derives different inner seeds for different instances", async () => {
    const inner = new Graph();
    const p = inner.add(makePointsNode(4), undefined, "pts");
    const def = subgraphNode(inner, [], [{ name: "res", node: p, pin: "out" }]);

    const g = new Graph();
    const s1 = g.add(def, undefined, "s1");
    const s2 = g.add(def, undefined, "s2");
    g.output(s1, "res", "r1");
    g.output(s2, "res", "r2");
    const r = await cook(g);
    expect(pointBytes(r.outputs.r1, 4)).not.toEqual(pointBytes(r.outputs.r2, 4));
  });

  it("propagates cancellation out of the inner cook", async () => {
    const inner = new Graph();
    const slow = inner.add(slowNode(150), undefined, "slow");
    const def = subgraphNode(inner, [{ name: "in", node: slow, pin: "in" }], [
      { name: "out", node: slow, pin: "out" },
    ]);

    const g = new Graph();
    const s = g.add(def, undefined, "sub");
    g.output(s, "out", "res");
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
  });

  it("validates exposed pins at construction", () => {
    const inner = new Graph();
    const t = inner.add(transformNode(), undefined, "t");
    expect(() =>
      subgraphNode(inner, [{ name: "x", node: t, pin: "nope" }], []),
    ).toThrow(GraphValidationError);
    expect(() =>
      subgraphNode(inner, [], [{ name: "x", node: t, pin: "nope" }]),
    ).toThrow(GraphValidationError);
    expect(() =>
      subgraphNode(
        inner,
        [
          { name: "x", node: t, pin: "in" },
          { name: "x", node: t, pin: "in" },
        ],
        [],
      ),
    ).toThrow(GraphValidationError);
  });
});
