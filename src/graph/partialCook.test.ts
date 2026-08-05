/**
 * Per-output cooking: `cook(graph, { outputs: [...] })` cooks only the
 * induced upstream subgraph of the selected declared outputs. These
 * suites prove the hard requirements: memo interplay (shared upstream
 * reuse, nothing recooks unnecessarily), budget/cancel/resume on partial
 * cooks, reentrancy serialization, byte-identical composition in any
 * cook order, and actionable errors for unknown selections.
 */
import { describe, expect, it } from "vitest";
import { randomField } from "../fields/index.js";
import { firstGeometry, type DataCollection } from "./data.js";
import { CookCancelledError, GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode, type NodeDef } from "./node.js";
import { counterNode, makePointsNode, slowNode, transformNode } from "./testNodes.js";

function valueOf(coll: DataCollection): unknown {
  const item = coll[0];
  return item?.kind === "value" ? item.value : undefined;
}

function pointBytes(coll: DataCollection): number[] {
  const geo = firstGeometry(coll);
  if (!geo) throw new Error("no geometry in collection");
  return [...geo.attrs.point.require("P").data];
}

/** Shared source feeding two independent terminal branches. */
function diamond() {
  const g = new Graph();
  const src = counterNode(1);
  const a = counterNode(10);
  const b = counterNode(100);
  const hs = g.add(src.def, undefined, "src");
  const ha = g.add(a.def, undefined, "a");
  const hb = g.add(b.def, undefined, "b");
  g.connect(hs, "out", ha, "in");
  g.connect(hs, "out", hb, "in");
  g.output(ha, "out", "a");
  g.output(hb, "out", "b");
  return { g, src, a, b };
}

/** Seeded source with two stochastic downstream branches, outputs a/b. */
function stochastic(): Graph {
  const g = new Graph(77);
  const p = g.add(makePointsNode(6), undefined, "pts");
  const ta = g.add(transformNode(), { offset: randomField("ja") }, "ta");
  const tb = g.add(transformNode(), { offset: randomField("jb") }, "tb");
  g.connect(p, "out", ta, "in");
  g.connect(p, "out", tb, "in");
  g.output(ta, "out", "a");
  g.output(tb, "out", "b");
  return g;
}

describe("cook: per-output selection", () => {
  it("cooks only the selected output's upstream subgraph", async () => {
    const { g, src, a, b } = diamond();
    const seen: string[] = [];
    const r = await cook(g, { outputs: ["a"], onNodeDone: (i) => seen.push(i.id) });
    expect(seen).toEqual(["src", "a"]);
    expect(r.stats.cooked).toBe(2);
    expect(r.stats.cached).toBe(0);
    expect(src.state.count).toBe(1);
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(0); // untouched branch
    expect(Object.keys(r.outputs)).toEqual(["a"]);
    expect(valueOf(r.outputs.a)).toBe(11);
  });

  it("reuses shared upstream across sequential partial cooks; a full cook then recooks nothing", async () => {
    const { g, src, a, b } = diamond();
    const ra = await cook(g, { outputs: ["a"] });
    expect(ra.stats.cooked).toBe(2);

    const rb = await cook(g, { outputs: ["b"] });
    expect(rb.stats.cooked).toBe(1); // only b
    expect(rb.stats.cached).toBe(1); // src served from cache
    expect(src.state.count).toBe(1); // never re-executed
    expect(valueOf(rb.outputs.b)).toBe(101);

    const rAll = await cook(g);
    expect(rAll.stats.cooked).toBe(0);
    expect(rAll.stats.cached).toBe(3);
    expect(valueOf(rAll.outputs.a)).toBe(11);
    expect(valueOf(rAll.outputs.b)).toBe(101);
    expect(a.state.count + b.state.count).toBe(2);
  });

  it("partial cook order produces byte-identical data to any other order and to a full cook", async () => {
    // a-then-b, b-then-a, and all-at-once must agree byte for byte.
    const g1 = stochastic();
    const first1 = await cook(g1, { outputs: ["a"] });
    expect(first1.stats.cooked).toBe(2); // pts + ta
    const r1 = await cook(g1);
    expect(r1.stats.cooked).toBe(1); // only tb; nothing recooks unnecessarily
    expect(r1.stats.cached).toBe(2);

    const g2 = stochastic();
    await cook(g2, { outputs: ["b"] });
    const r2 = await cook(g2);
    expect(r2.stats.cooked).toBe(1); // only ta

    const g3 = stochastic();
    const r3 = await cook(g3);
    expect(r3.stats.cooked).toBe(3);

    expect(pointBytes(r1.outputs.a)).toEqual(pointBytes(r3.outputs.a));
    expect(pointBytes(r2.outputs.a)).toEqual(pointBytes(r3.outputs.a));
    expect(pointBytes(r1.outputs.b)).toEqual(pointBytes(r3.outputs.b));
    expect(pointBytes(r2.outputs.b)).toEqual(pointBytes(r3.outputs.b));
    // The two branches genuinely differ (different field keys).
    expect(pointBytes(r3.outputs.a)).not.toEqual(pointBytes(r3.outputs.b));
  });

  it("tolerates duplicate names and an empty selection", async () => {
    const { g, src } = diamond();
    const dup = await cook(g, { outputs: ["a", "a"] });
    expect(Object.keys(dup.outputs)).toEqual(["a"]);
    expect(dup.stats.cooked).toBe(2);

    const none = await cook(g, { outputs: [] });
    expect(none.outputs).toEqual({});
    expect(none.stats.cooked).toBe(0);
    expect(none.stats.cached).toBe(0);
    expect(src.state.count).toBe(1); // untouched by the empty pass
  });

  it("rejects unknown output names, listing the declared outputs", async () => {
    const { g } = diamond();
    await expect(cook(g, { outputs: ["nope"] })).rejects.toBeInstanceOf(GraphValidationError);
    await expect(cook(g, { outputs: ["nope"] })).rejects.toThrow(
      /unknown output "nope"; declared outputs: "a", "b"/,
    );

    const empty = new Graph();
    await expect(cook(empty, { outputs: ["x"] })).rejects.toThrow(
      /unknown output "x": this graph declares no outputs; declare one with graph\.output/,
    );
  });

  it("aborting a partial cook keeps completed caches and resumes without touching other branches", async () => {
    const g = new Graph();
    const src = counterNode(1);
    const end = counterNode(2);
    const quick = counterNode(3);
    const hs = g.add(src.def, undefined, "src");
    const hSlow = g.add(slowNode(150), undefined, "slow");
    const hEnd = g.add(end.def, undefined, "end");
    const hQuick = g.add(quick.def, undefined, "quick");
    g.connect(hs, "out", hSlow, "in");
    g.connect(hSlow, "out", hEnd, "in");
    g.connect(hs, "out", hQuick, "in");
    g.output(hEnd, "out", "a");
    g.output(hQuick, "out", "b");

    const ac = new AbortController();
    const pending = cook(g, { outputs: ["a"], signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
    expect(src.state.count).toBe(1); // completed before the abort
    expect(end.state.count).toBe(0);
    expect(quick.state.count).toBe(0); // unselected branch never entered

    const resumed = await cook(g, { outputs: ["a"] });
    expect(resumed.stats.cached).toBe(1); // src resumed from cache
    expect(resumed.stats.cooked).toBe(2); // slow + end
    expect(valueOf(resumed.outputs.a)).toBe(3);
    expect(quick.state.count).toBe(0); // still untouched
  });

  it("yields to the event loop under a budget during a partial cook, then completes", async () => {
    const busy = (ms: number): NodeDef<{ ms: number }> =>
      defineNode<{ ms: number }>({
        type: "busy",
        inputs: [{ name: "in", kind: "any" }],
        outputs: [{ name: "out", kind: "any" }],
        defaultParams: { ms },
        execute({ inputs, params }) {
          const end = performance.now() + params.ms;
          while (performance.now() < end) {
            // spin
          }
          return { out: inputs.in };
        },
      });
    const g = new Graph();
    const h1 = g.add(busy(4), undefined, "b1");
    const h2 = g.add(busy(4), undefined, "b2");
    const h3 = g.add(busy(4), undefined, "b3");
    g.connect(h1, "out", h2, "in");
    g.connect(h2, "out", h3, "in");
    g.output(h3, "out", "a");
    g.output(h1, "out", "b");

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    const result = await cook(g, { outputs: ["a"], budgetMs: 1 });
    expect(timerFired).toBe(true); // the budget yield released the loop
    expect(result.stats.cooked).toBe(3);
    expect(Object.keys(result.outputs)).toEqual(["a"]);
  });

  it("serializes overlapping partial cooks of different outputs (shared upstream runs once)", async () => {
    const { g, src, a, b } = diamond();
    const [ra, rb] = await Promise.all([
      cook(g, { outputs: ["a"] }),
      cook(g, { outputs: ["b"] }),
    ]);
    expect(src.state.count).toBe(1); // once total across both cooks
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(1);
    expect(ra.stats.cooked).toBe(2);
    expect(rb.stats.cooked).toBe(1);
    expect(rb.stats.cached).toBe(1);
    expect(valueOf(ra.outputs.a)).toBe(11);
    expect(valueOf(rb.outputs.b)).toBe(101);
  });
});
