import { describe, expect, it } from "vitest";
import { CookCancelledError } from "./errors.js";
import { cook } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode, type NodeDef } from "./node.js";
import { counterNode, slowNode } from "./testNodes.js";

/** Synchronous busy-wait node for budget tests. */
function busyNode(ms: number): NodeDef<{ ms: number }> {
  return defineNode<{ ms: number }>({
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
}

function slowChain() {
  const g = new Graph();
  const a = counterNode(1);
  const b = counterNode(2);
  const ha = g.add(a.def, undefined, "a");
  const hs = g.add(slowNode(150), undefined, "slow");
  const hb = g.add(b.def, undefined, "b");
  g.connect(ha, "out", hs, "in");
  g.connect(hs, "out", hb, "in");
  g.output(hb, "out", "res");
  return { g, a, b };
}

describe("cook: cancellation", () => {
  it("aborting mid-node rejects with CookCancelledError", async () => {
    const { g, a, b } = slowChain();
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
    expect(a.state.count).toBe(1); // completed before the abort
    expect(b.state.count).toBe(0); // never reached
  });

  it("keeps completed caches, so a re-cook resumes and completes", async () => {
    const { g, a, b } = slowChain();
    const ac = new AbortController();
    const pending = cook(g, { signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(CookCancelledError);
    const result = await cook(g);
    expect(a.state.count).toBe(1); // resumed from cache
    expect(b.state.count).toBe(1);
    expect(result.stats.cached).toBe(1); // a
    expect(result.stats.cooked).toBe(2); // slow + b
    const item = result.outputs.res[0];
    expect(item.kind === "value" && item.value).toBe(3);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { g, a } = slowChain();
    const ac = new AbortController();
    ac.abort();
    await expect(cook(g, { signal: ac.signal })).rejects.toBeInstanceOf(CookCancelledError);
    expect(a.state.count).toBe(0);
  });
});

describe("cook: time budget", () => {
  function busyChain() {
    const g = new Graph();
    const h1 = g.add(busyNode(4), undefined, "b1");
    const h2 = g.add(busyNode(4), undefined, "b2");
    const h3 = g.add(busyNode(4), undefined, "b3");
    g.connect(h1, "out", h2, "in");
    g.connect(h2, "out", h3, "in");
    g.output(h3, "out", "res");
    return g;
  }

  it("yields to the event loop when the budget is exceeded, then completes", async () => {
    const g = busyChain();
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    const result = await cook(g, { budgetMs: 1 });
    // The pre-scheduled macrotask ran while the cook was still in
    // progress: the budget yield handed control back to the event loop.
    expect(timerFired).toBe(true);
    expect(result.stats.cooked).toBe(3); // ...and the cook still finished
  });

  it("does not yield between synchronous nodes without a budget", async () => {
    const g = busyChain();
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    await cook(g);
    // Promise continuations are microtasks; without budget yields the
    // pending 0 ms timer cannot run before the cook resolves.
    expect(timerFired).toBe(false);
  });

  it("reports per-node completion through onNodeDone", async () => {
    const g = busyChain();
    const first: Array<{ id: string; cached: boolean }> = [];
    await cook(g, { onNodeDone: (i) => first.push({ id: i.id, cached: i.cached }) });
    expect(first).toEqual([
      { id: "b1", cached: false },
      { id: "b2", cached: false },
      { id: "b3", cached: false },
    ]);
    const second: Array<{ id: string; cached: boolean }> = [];
    await cook(g, { onNodeDone: (i) => second.push({ id: i.id, cached: i.cached }) });
    expect(second).toEqual([
      { id: "b1", cached: true },
      { id: "b2", cached: true },
      { id: "b3", cached: true },
    ]);
  });
});
