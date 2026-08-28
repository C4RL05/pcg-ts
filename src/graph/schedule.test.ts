import { describe, expect, it } from "vitest";
import { CookCancelledError, NodeExecutionError } from "./errors.js";
import { cook, type NodeDoneInfo } from "./execute.js";
import { Graph } from "./graph.js";
import { defineNode, type NodeDef, type NodeExecuteArgs } from "./node.js";
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

  it("a node throwing CookCancelledError without an abort is a node failure", async () => {
    const rogue = defineNode<Record<string, never>>({
      type: "rogue",
      inputs: [],
      outputs: [{ name: "out", kind: "value" }],
      defaultParams: {},
      execute() {
        throw new CookCancelledError();
      },
    });
    const g = new Graph();
    const h = g.add(rogue, undefined, "rogue_1");
    g.output(h, "out");
    const err = await cook(g).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NodeExecutionError);
    expect((err as NodeExecutionError).nodeId).toBe("rogue_1");
  });

  it("onNodeDone exceptions reject the cook; the finished node stays cached", async () => {
    const { g, a, b } = slowChain();
    await expect(
      cook(g, {
        onNodeDone: () => {
          throw new Error("callback boom");
        },
      }),
    ).rejects.toThrow("callback boom");
    expect(a.state.count).toBe(1); // first node finished and was cached
    expect(b.state.count).toBe(0);
    const r = await cook(g);
    expect(r.stats.cached).toBe(1);
    expect(r.stats.cooked).toBe(2);
    expect(b.state.count).toBe(1);
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

/**
 * `NodeDoneInfo.selfMetered`: what a reported `elapsedMs` MEANS.
 *
 * The executor's budget check sits outside `cookNode`, so an ordinary
 * node's `elapsedMs` is an uninterrupted block. A node that meters
 * `budgetMs` inside its own execute breaks that, and by a lot — each
 * yield costs the platform's timer latency and such a node takes many,
 * so under a small budget its `elapsedMs` can be two orders of magnitude
 * above its real longest block. A consumer ranking budget settings on
 * the raw number then inverts its verdict.
 *
 * The point of these tests is that the executor learns which is which
 * from the DEF and from nothing else: no list of type names lives in
 * `execute.ts`, so a node type joining the set is flagged by declaring
 * it.
 */
describe("cook: onNodeDone.selfMetered", () => {
  /**
   * A node that reads `budgetMs` and yields on it, exactly as the shipped
   * composites do — declared, so the executor has something to read.
   * Deliberately NOT one of the three shipped types: if the executor
   * carried a hardcoded list instead of reading the def, this node would
   * report false and this test would fail. That is the whole mechanism.
   */
  function yieldingNode(slices: number, declare: boolean): NodeDef<Record<string, never>> {
    const base = {
      type: declare ? "yieldingLeaf" : "undeclaredYieldingLeaf",
      inputs: [],
      outputs: [{ name: "out", kind: "any" as const }],
      defaultParams: {},
      async execute({ budgetMs }: NodeExecuteArgs<Record<string, never>>) {
        for (let i = 0; i < slices; i++) {
          if (budgetMs !== undefined) await new Promise((r) => setTimeout(r, 0));
        }
        return { out: [] };
      },
    };
    // The declaration is the ONLY difference between the two defs.
    return defineNode<Record<string, never>>(declare ? { ...base, selfMetered: true } : base);
  }

  async function cookOne<P>(
    def: NodeDef<P>,
    budgetMs?: number,
  ): Promise<{ g: Graph; seen: NodeDoneInfo[] }> {
    const g = new Graph();
    const h = g.add(def, undefined, "n");
    g.output(h, "out");
    const seen: NodeDoneInfo[] = [];
    await cook(g, {
      ...(budgetMs === undefined ? {} : { budgetMs }),
      onNodeDone: (i) => seen.push(i),
    });
    return { g, seen };
  }

  it("flags a node type that declares it, and not a leaf that does not", async () => {
    const busy = await cookOne(busyNode(2), 1);
    expect(busy.seen.map((i) => i.selfMetered)).toEqual([false]);

    const yielding = await cookOne(yieldingNode(4, true), 1);
    expect(yielding.seen.map((i) => i.selfMetered)).toEqual([true]);
  });

  it("reads the declaration off the def, so a node joining the set follows on its own", async () => {
    // The two defs differ in exactly one property. If `execute.ts` knew
    // the self-metering set by type name rather than by declaration,
    // both would report the same thing and this would fail.
    const declared = await cookOne(yieldingNode(4, true), 1);
    const undeclared = await cookOne(yieldingNode(4, false), 1);
    expect(declared.seen[0].selfMetered).toBe(true);
    expect(undeclared.seen[0].selfMetered).toBe(false);
  });

  it("describes the node, not the pass: unchanged without a budget and on a cache hit", async () => {
    // Nothing can yield without a budget, so the number IS a block — but
    // the flag is a statement about where the number came from, and it
    // stays put so a consumer can key on it.
    const unbudgeted = await cookOne(yieldingNode(4, true));
    expect(unbudgeted.seen[0].selfMetered).toBe(true);

    const g = new Graph();
    const h = g.add(yieldingNode(4, true), undefined, "n");
    g.output(h, "out");
    const first: NodeDoneInfo[] = [];
    await cook(g, { budgetMs: 1, onNodeDone: (i) => first.push(i) });
    const second: NodeDoneInfo[] = [];
    await cook(g, { budgetMs: 1, onNodeDone: (i) => second.push(i) });
    expect(first[0]).toMatchObject({ cached: false, selfMetered: true });
    expect(second[0]).toMatchObject({ cached: true, selfMetered: true });
  });

  it("a budgeted self-metering node's elapsedMs is wall time, not work", async () => {
    // The regression this whole field exists for, made small and
    // deterministic: the SAME node reports far more time under a budget
    // than without one, and every extra millisecond is yield latency.
    // Only `selfMetered` tells a consumer that the second number must
    // not be compared with the first.
    const without = await cookOne(yieldingNode(20, true));
    const with_ = await cookOne(yieldingNode(20, true), 0);
    expect(without.seen[0].selfMetered).toBe(true);
    expect(with_.seen[0].selfMetered).toBe(true);
    // 20 macrotask hops cost real milliseconds on every platform this
    // runs on; the unbudgeted run does no work at all.
    expect(with_.seen[0].elapsedMs).toBeGreaterThan(without.seen[0].elapsedMs);
  });
});
