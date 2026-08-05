import { describe, expect, it } from "vitest";
import { firstGeometry, type DataCollection } from "./data.js";
import { CookCancelledError, GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode } from "./node.js";
import { describeSubgraphPins, subgraphNode } from "./subgraph.js";
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

  it("recooks when the wrapped inner graph is edited directly", async () => {
    const inner = new Graph();
    const c = counterNode(5);
    const h = inner.add(c.def, undefined, "c");
    const def = subgraphNode(inner, [], [{ name: "res", node: h, pin: "out" }]);

    const g = new Graph();
    const s = g.add(def, undefined, "sub");
    g.output(s, "res", "out");
    const r1 = await cook(g);
    expect(valueOf(r1.outputs.out)).toBe(5);

    inner.setParam(h, "value", 7); // direct edit of the wrapped graph
    const r2 = await cook(g);
    expect(valueOf(r2.outputs.out)).toBe(7); // not the stale 5
    expect(r2.stats.cached).toBe(0);
    expect(r2.stats.cooked).toBe(1);
    expect(c.state.count).toBe(2);

    const r3 = await cook(g); // and it re-caches afterwards
    expect(r3.stats.cached).toBe(1);
    expect(c.state.count).toBe(2);
  });

  it("propagates nested inner edits to the outer memo key (2 deep)", async () => {
    const inner2 = new Graph();
    const c = counterNode(5);
    const h2 = inner2.add(c.def, undefined, "c");
    const def2 = subgraphNode(inner2, [], [{ name: "out", node: h2, pin: "out" }]);

    const inner1 = new Graph();
    const mid = inner1.add(def2, undefined, "mid");
    const def1 = subgraphNode(inner1, [], [{ name: "out", node: mid, pin: "out" }]);

    const g = new Graph();
    const s = g.add(def1, undefined, "sub");
    g.output(s, "out", "res");

    const r1 = await cook(g);
    expect(valueOf(r1.outputs.res)).toBe(5);
    const r2 = await cook(g);
    expect(r2.stats.cached).toBe(1); // unchanged: outer serves its cache

    inner2.setParam(h2, "value", 9); // innermost edit, two levels down
    const r3 = await cook(g);
    expect(valueOf(r3.outputs.res)).toBe(9); // not the stale 5
    expect(r3.stats.cooked).toBe(1);
    expect(c.state.count).toBe(2);
  });

  it("folds inner-graph versions transitively at any depth (3 deep)", async () => {
    const inner3 = new Graph();
    const c = counterNode(1);
    const h3 = inner3.add(c.def, undefined, "c");
    const def3 = subgraphNode(inner3, [], [{ name: "out", node: h3, pin: "out" }]);
    const inner2 = new Graph();
    const n2 = inner2.add(def3, undefined, "deep");
    const def2 = subgraphNode(inner2, [], [{ name: "out", node: n2, pin: "out" }]);
    const inner1 = new Graph();
    const n1 = inner1.add(def2, undefined, "mid");
    const def1 = subgraphNode(inner1, [], [{ name: "out", node: n1, pin: "out" }]);
    const g = new Graph();
    const s = g.add(def1, undefined, "sub");
    g.output(s, "out", "res");

    expect(valueOf((await cook(g)).outputs.res)).toBe(1);
    inner3.setParam(h3, "value", 7);
    const r = await cook(g);
    expect(valueOf(r.outputs.res)).toBe(7);
    expect(r.stats.cooked).toBe(1);
  });

  it("memoKey terminates on adversarial cyclic wiring", () => {
    const g = new Graph();
    const t = g.add(transformNode(), undefined, "t");
    const def = subgraphNode(g, [], [{ name: "out", node: t, pin: "out" }]);
    g.add(def, undefined, "ouro"); // the graph wraps itself
    expect(typeof def.memoKey?.()).toBe("string"); // no infinite recursion
  });

  it("forwards budgetMs into the inner cook", async () => {
    let timerFired = false;
    const sawTimer: boolean[] = [];
    const busy = defineNode<{ ms: number }>({
      type: "busy",
      inputs: [{ name: "in", kind: "any" }],
      outputs: [{ name: "out", kind: "any" }],
      defaultParams: { ms: 4 },
      execute({ inputs, params }) {
        sawTimer.push(timerFired);
        const end = performance.now() + params.ms;
        while (performance.now() < end) {
          // spin
        }
        return { out: inputs.in };
      },
    });
    const inner = new Graph();
    const b1 = inner.add(busy, undefined, "b1");
    const b2 = inner.add(busy, undefined, "b2");
    const b3 = inner.add(busy, undefined, "b3");
    inner.connect(b1, "out", b2, "in");
    inner.connect(b2, "out", b3, "in");
    const def = subgraphNode(inner, [], [{ name: "res", node: b3, pin: "out" }]);

    const g = new Graph();
    const s = g.add(def, undefined, "sub");
    g.output(s, "res", "out");
    setTimeout(() => {
      timerFired = true;
    }, 0);
    await cook(g, { budgetMs: 1 });
    // The inner cook yielded between inner nodes (the outer graph has only
    // one node, so only a forwarded budget can explain the interleaving).
    expect(sawTimer).toEqual([false, true, true]);
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

describe("describeSubgraphPins", () => {
  it("describes pins with the exposed inner pins' actual kinds", () => {
    const inner = new Graph();
    const t = inner.add(transformNode(), undefined, "t");
    const c = inner.add(counterNode(0).def, undefined, "c");
    const def = subgraphNode(
      inner,
      [
        { name: "geo", node: t, pin: "in" },
        { name: "num", node: c, pin: "in" },
      ],
      [
        { name: "res", node: t, pin: "out" },
        { name: "n", node: c, pin: "out" },
      ],
    );
    const pins = describeSubgraphPins(def);
    expect(pins).toEqual({
      inputs: [
        { name: "geo", kind: "geometry" },
        { name: "num", kind: "value" },
      ],
      outputs: [
        { name: "res", kind: "geometry" },
        { name: "n", kind: "value" },
      ],
    });
  });

  it("returns a frozen snapshot", () => {
    const inner = new Graph();
    const t = inner.add(transformNode(), undefined, "t");
    const def = subgraphNode(inner, [{ name: "geo", node: t, pin: "in" }], [
      { name: "res", node: t, pin: "out" },
    ]);
    const pins = describeSubgraphPins(def);
    if (pins === undefined) throw new Error("expected a pin description");
    expect(Object.isFrozen(pins)).toBe(true);
    expect(Object.isFrozen(pins.inputs)).toBe(true);
    expect(Object.isFrozen(pins.outputs)).toBe(true);
    expect(Object.isFrozen(pins.inputs[0])).toBe(true);
    expect(() => {
      (pins.inputs as unknown as unknown[]).push({ name: "x", kind: "any" });
    }).toThrow();
    expect(() => {
      (pins.inputs[0] as { name: string }).name = "clobbered";
    }).toThrow();
  });

  it("resolves nested subgraph pins through the recorded specs", () => {
    const innermost = new Graph();
    const t = innermost.add(transformNode(), undefined, "t");
    const c = innermost.add(counterNode(0).def, undefined, "c");
    const defInner = subgraphNode(
      innermost,
      [
        { name: "a", node: t, pin: "in" },
        { name: "v", node: c, pin: "in" },
      ],
      [
        { name: "b", node: t, pin: "out" },
        { name: "w", node: c, pin: "out" },
      ],
    );
    const mid = new Graph();
    const s1 = mid.add(defInner, undefined, "s1");
    const defOuter = subgraphNode(
      mid,
      [
        { name: "outerGeo", node: s1, pin: "a" },
        { name: "outerVal", node: s1, pin: "v" },
      ],
      [
        { name: "outGeo", node: s1, pin: "b" },
        { name: "outVal", node: s1, pin: "w" },
      ],
    );
    expect(describeSubgraphPins(defOuter)).toEqual({
      inputs: [
        { name: "outerGeo", kind: "geometry" },
        { name: "outerVal", kind: "value" },
      ],
      outputs: [
        { name: "outGeo", kind: "geometry" },
        { name: "outVal", kind: "value" },
      ],
    });
  });

  it("returns undefined for defs not created by subgraphNode", () => {
    expect(describeSubgraphPins(transformNode())).toBeUndefined();
    expect(describeSubgraphPins(makePointsNode(1))).toBeUndefined();
  });

  it("throws actionably when a later edit removed an exposed inner node", () => {
    const inner = new Graph();
    const t = inner.add(transformNode(), undefined, "t");
    const p = inner.add(makePointsNode(1), undefined, "keep");
    const def = subgraphNode(inner, [], [
      { name: "res", node: t, pin: "out" },
      { name: "pts", node: p, pin: "out" },
    ]);
    inner.removeNode(t);
    expect(() => describeSubgraphPins(def)).toThrow(GraphValidationError);
    expect(() => describeSubgraphPins(def)).toThrow(
      /exposed output "res".*inner node "t".*no longer exists/,
    );
  });
});
