/**
 * `repeatUntil`: the fixed point the graph could not wire.
 *
 * The properties that matter, in the order they matter: the carry really
 * IS fed back (round k sees round k-1's output, not the original input),
 * the settle signal really does stop the loop on the round it goes to
 * zero, exhausting the budget is reported rather than hidden, and the
 * shapes that would silently mean something else are refused.
 *
 * Every count assertion here is paired with the case that would produce a
 * different one — a test that says "3" is worth nothing unless something
 * in the suite can make it say 4.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import {
  type DataCollection,
  type DataItem,
  makeDeviceInstancesItem,
  makeGeometryItem,
} from "../graph/data.js";
import { CookCancelledError, GraphValidationError } from "../graph/errors.js";
import { cook } from "../graph/execute.js";
import { Graph } from "../graph/graph.js";
import { type NodeDef, defineNode } from "../graph/node.js";
import type { NodeHandle } from "../graph/graph.js";
import { subgraphNode } from "../graph/subgraph.js";
import type { DeviceInstanceBatch, DeviceTransformsHandle } from "../fields/gpuResolver.js";
import { dataInput } from "../runtime/dataInput.js";
import { deserializeGraph, serializeGraph } from "./serialize.js";
import { attributeReduce, mergePoints, transformPoints } from "./index.js";
import { repeatUntilNode } from "./repeatUntil.js";

// ---------------------------------------------------------------------------
// Bodies
//
// The convergent ones are hand-built defs rather than library nodes: a
// relaxation needs a body that does LESS work each round and eventually
// none, and writing that explicitly is what makes "settles after exactly 3"
// a fact of the fixture rather than an accident of some node's semantics.

interface StepParams {
  /** How far along +x a point is dragged per round, at most. */
  step: number;
  /** Where the points are being dragged to. */
  target: number;
  /** Detail attribute receiving how many points actually moved. */
  report: string;
}

/**
 * Drag every point toward `target` by at most `step` per round and report
 * how many actually moved.
 *
 * The canonical relaxation shape: monotone, terminating, and its own
 * termination witness. Points starting at 0 with step 1 and target 3 move
 * on rounds 1, 2 and 3 and are still on round 4 — so "converged after 3"
 * and "the carry advanced 3 times" are the same fact seen twice.
 */
const stepToward = defineNode<StepParams>({
  type: "__test_stepToward",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  defaultParams: { step: 1, target: 3, report: "moves" },
  execute({ inputs, params }) {
    const out: DataItem[] = [];
    for (const item of inputs.in ?? []) {
      if (item.kind !== "geometry") continue;
      const src = item.geo;
      const geo = createPointCloud(src.pointCount);
      const from = src.attrs.point.require("P");
      const P = geo.attrs.point.require("P");
      let moved = 0;
      for (let i = 0; i < src.pointCount; i++) {
        const x = from.get(i, 0);
        const gap = params.target - x;
        const dx = Math.sign(gap) * Math.min(Math.abs(gap), params.step);
        if (dx !== 0) moved++;
        P.setTuple(i, [x + dx, from.get(i, 1), from.get(i, 2)]);
      }
      geo.attrs.detail.replace(params.report, "u32", 1, 0).set(0, moved);
      out.push(makeGeometryItem(geo, item.tags));
    }
    return { out };
  },
});

/** A body that reports a settle signal but never zero: it cannot converge. */
const neverSettles = defineNode<{ report: string }>({
  type: "__test_neverSettles",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  defaultParams: { report: "moves" },
  execute({ inputs, params }) {
    const out: DataItem[] = [];
    for (const item of inputs.in ?? []) {
      if (item.kind !== "geometry") continue;
      const src = item.geo;
      const geo = createPointCloud(src.pointCount);
      const from = src.attrs.point.require("P");
      const P = geo.attrs.point.require("P");
      for (let i = 0; i < src.pointCount; i++) {
        P.setTuple(i, [from.get(i, 0) + 1, from.get(i, 1), from.get(i, 2)]);
      }
      geo.attrs.detail.replace(params.report, "u32", 1, 0).set(0, 1);
      out.push(makeGeometryItem(geo, item.tags));
    }
    return { out };
  },
});

/** A body that writes no settle signal at all. */
const noSignal = defineNode<Record<string, never>>({
  type: "__test_noSignal",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  defaultParams: {},
  execute({ inputs }) {
    return { out: (inputs.in ?? []).filter((i) => i.kind === "geometry") };
  },
});

/** One point at x, as a collection of one geometry item. */
function pointAt(x: number): DataItem[] {
  const geo = createPointCloud(1);
  geo.attrs.point.require("P").setTuple(0, [x, 0, 0]);
  return [makeGeometryItem(geo)];
}

/** Every P.x of a collection, in item then point order. */
function xs(coll: DataCollection): number[] {
  const out: number[] = [];
  for (const item of coll) {
    if (item.kind !== "geometry") continue;
    const P = item.geo.attrs.point.require("P");
    for (let i = 0; i < item.geo.pointCount; i++) out.push(P.get(i, 0));
  }
  return out;
}

/** The single value on a value pin. */
function value(coll: DataCollection): unknown {
  expect(coll).toHaveLength(1);
  const item = coll[0];
  if (item.kind !== "value") throw new Error(`expected a value item, got ${item.kind}`);
  return item.value;
}

/** A repeatUntil around `stepToward`, exposing only the carry. */
function stepBody(params: Partial<StepParams> = {}): {
  inner: Graph;
  def: NodeDef<Record<string, unknown>>;
} {
  const inner = new Graph(5);
  const s = inner.add(stepToward, params, "s");
  const def = repeatUntilNode(
    inner,
    [{ name: "carry", node: s, pin: "in" }],
    [{ name: "carry", node: s, pin: "out" }],
  );
  return { inner, def };
}

/** Cook `items` through a repeatUntil def and return its three pins. */
async function run(
  def: NodeDef<Record<string, unknown>>,
  items: readonly DataItem[],
  params: Record<string, unknown> = {},
  extra?: (g: Graph, node: { id: string }) => void,
): Promise<{ carry: DataCollection; rounds: unknown; converged: unknown }> {
  const g = new Graph(7);
  const src = g.add(dataInput, { items: [...items] }, "src");
  const n = g.add(def, params, "loop");
  g.connect(src, "out", n, "carry");
  g.output(n, "carry", "carry");
  g.output(n, "rounds", "rounds");
  g.output(n, "converged", "converged");
  extra?.(g, n);
  const result = await cook(g);
  return {
    carry: result.outputs.carry,
    rounds: value(result.outputs.rounds),
    // The pin carries 1 or 0 (see the wire-shape test below); the boolean
    // is for readability at the assertion sites.
    converged: value(result.outputs.converged) === 1,
  };
}

// ---------------------------------------------------------------------------

describe("repeatUntilNode — the loop", () => {
  it("stops on the round the settle signal reaches zero, and counts that round", async () => {
    const { def } = stepBody({ step: 1, target: 3 });
    const out = await run(def, pointAt(0));
    // Rounds 1..3 each move the point; round 4 finds it already there and
    // reports zero. So four cooks, and `rounds` is 4 — the settling round
    // counts, which is what "that round counts" in the contract means.
    expect(out.rounds).toBe(4);
    expect(out.converged).toBe(true);
    expect(xs(out.carry)).toEqual([3]);
  });

  it("reports both pins as ONE value item carrying a number", async () => {
    // The wire shape, asserted once so the readability helper above cannot
    // hide it: `converged` is 1 or 0, not true/false, because `rounds` is a
    // number and the two are read together.
    const { def } = stepBody({ step: 1, target: 1 });
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const n = g.add(def, { maxRounds: 4 }, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "rounds", "rounds");
    g.output(n, "converged", "converged");
    const settled = await cook(g);
    expect(settled.outputs.converged).toHaveLength(1);
    expect(settled.outputs.converged[0].kind).toBe("value");
    expect(value(settled.outputs.converged)).toBe(1);
    expect(value(settled.outputs.rounds)).toBe(2);
    // And 0 on the other branch, so "1" is not simply what this pin always
    // holds.
    g.setParam(n, "maxRounds", 1);
    expect(value((await cook(g)).outputs.converged)).toBe(0);
  });

  it("takes a different number of rounds when the body has further to go", async () => {
    // The falsifier for the count above: same body, twice the distance.
    const { def } = stepBody({ step: 1, target: 6 });
    const out = await run(def, pointAt(0));
    expect(out.rounds).toBe(7);
    expect(out.converged).toBe(true);
    expect(xs(out.carry)).toEqual([6]);
  });

  it("really feeds the carry back: the Nth value comes out, not the 1st", async () => {
    // If round k+1 saw the ORIGINAL input instead of round k's output, the
    // point would come out at 1 (one step from 0) however many rounds ran.
    const { def } = stepBody({ step: 1, target: 5 });
    const out = await run(def, pointAt(0), { maxRounds: 3 });
    expect(xs(out.carry)).toEqual([3]);
    expect(out.rounds).toBe(3);
    expect(out.converged).toBe(false);
  });

  it("stops at maxRounds with converged false when the body never settles", async () => {
    const inner = new Graph(5);
    const n = inner.add(neverSettles, {}, "n");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: n, pin: "in" }],
      [{ name: "carry", node: n, pin: "out" }],
    );
    const out = await run(def, pointAt(0), { maxRounds: 5 });
    expect(out.rounds).toBe(5);
    expect(out.converged).toBe(false);
    // Five cooks of a body that advances by one: the count and the geometry
    // agree, so neither can be right by accident.
    expect(xs(out.carry)).toEqual([5]);
  });

  it("obeys maxRounds: a different ceiling gives a different count", async () => {
    const inner = new Graph(5);
    const n = inner.add(neverSettles, {}, "n");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: n, pin: "in" }],
      [{ name: "carry", node: n, pin: "out" }],
    );
    expect((await run(def, pointAt(0), { maxRounds: 2 })).rounds).toBe(2);
    expect((await run(def, pointAt(0), { maxRounds: 9 })).rounds).toBe(9);
  });

  it("runs exactly one round at maxRounds 1, and still reports whether it settled", async () => {
    const { def } = stepBody({ step: 1, target: 3 });
    const one = await run(def, pointAt(0), { maxRounds: 1 });
    expect(one.rounds).toBe(1);
    expect(one.converged).toBe(false);
    // The same one round over a point already at the target settles.
    const already = await run(def, pointAt(3), { maxRounds: 1 });
    expect(already.rounds).toBe(1);
    expect(already.converged).toBe(true);
  });

  it("reads the settle signal from the attribute settleAttr names", async () => {
    const { def } = stepBody({ step: 1, target: 2, report: "delta" });
    const named = await run(def, pointAt(0), { settleAttr: "delta", maxRounds: 8 });
    expect(named.converged).toBe(true);
    expect(named.rounds).toBe(3);
    // The falsifier: the same body read through the default name has no
    // signal at all, and is refused rather than treated as settled.
    await expect(run(def, pointAt(0), { maxRounds: 8 })).rejects.toThrow(
      /produced no detail attribute "moves"/,
    );
  });

  it("refuses an absent settle signal rather than reading it as zero", async () => {
    const inner = new Graph(5);
    const n = inner.add(noSignal, {}, "n");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: n, pin: "in" }],
      [{ name: "carry", node: n, pin: "out" }],
    );
    await expect(run(def, pointAt(0))).rejects.toThrow(/no detail attribute "moves"/);
    // And it names the fix rather than only the fault.
    await expect(run(def, pointAt(0))).rejects.toThrow(/attributeReduce/);
  });
});

describe("repeatUntilNode — broadcast inputs", () => {
  it("hands every non-carry input to every round, unchanged", async () => {
    // The body merges the carry with a broadcast cloud, then steps the
    // result. If the broadcast pin were fed the LAST round's output — the
    // way the carry is — the point count would grow every round. If it were
    // fed only on round 1 it would vanish afterwards. Neither happens: the
    // count is constant and the broadcast point is at its own coordinate
    // every round.
    const inner = new Graph(5);
    const m = inner.add(mergePoints, {}, "m");
    const s = inner.add(stepToward, { step: 1, target: 20 }, "s");
    inner.connect(m, "out", s, "in");
    const def = repeatUntilNode(
      inner,
      [
        { name: "carry", node: m, pin: "in" },
        { name: "shared", node: m, pin: "in" },
      ],
      [{ name: "carry", node: s, pin: "out" }],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const shared = g.add(dataInput, { items: pointAt(10) }, "shared");
    const n = g.add(def, { maxRounds: 4 }, "loop");
    g.connect(src, "out", n, "carry");
    g.connect(shared, "out", n, "shared");
    g.output(n, "carry", "carry");
    g.output(n, "rounds", "rounds");
    const result = await cook(g);
    expect(value(result.outputs.rounds)).toBe(4);
    // Round 1: carry {0} + shared {10} -> {1, 11}
    // Round 2: carry {1,11} + shared {10} -> {2, 12, 11}
    // The broadcast point enters ONCE PER ROUND at 10 and is stepped to 11,
    // so the collection grows by exactly one point per round — the proof
    // that the pin was re-read from the outer input every round.
    expect(xs(result.outputs.carry)).toHaveLength(5);
    expect(xs(result.outputs.carry).filter((x) => x === 11)).toHaveLength(1);
  });
});

describe("repeatUntilNode — the exposed interface", () => {
  it("refuses a body with no carry input", () => {
    const inner = new Graph(5);
    const s = inner.add(stepToward, {}, "s");
    expect(() =>
      repeatUntilNode(inner, [{ name: "in", node: s, pin: "in" }], [
        { name: "carry", node: s, pin: "out" },
      ]),
    ).toThrow(/no carried input/);
  });

  it("refuses a body with no carry output", () => {
    const inner = new Graph(5);
    const s = inner.add(stepToward, {}, "s");
    expect(() =>
      repeatUntilNode(inner, [{ name: "carry", node: s, pin: "in" }], [
        { name: "out", node: s, pin: "out" },
      ]),
    ).toThrow(/no carried output/);
  });

  it("names what it does have, so a rename is one edit", () => {
    const inner = new Graph(5);
    const s = inner.add(stepToward, {}, "s");
    expect(() =>
      repeatUntilNode(inner, [{ name: "spine", node: s, pin: "in" }], [
        { name: "carry", node: s, pin: "out" },
      ]),
    ).toThrow(/"spine"/);
  });

  it("refuses two carry inputs", () => {
    const inner = new Graph(5);
    const m = inner.add(mergePoints, {}, "m");
    expect(() =>
      repeatUntilNode(
        inner,
        [
          { name: "carry", node: m, pin: "in" },
          { name: "carry", node: m, pin: "in" },
        ],
        [{ name: "carry", node: m, pin: "out" }],
      ),
    ).toThrow(/2 exposed inputs named "carry"/);
  });

  it("refuses two carry outputs", () => {
    const inner = new Graph(5);
    const s = inner.add(stepToward, {}, "s");
    expect(() =>
      repeatUntilNode(
        inner,
        [{ name: "carry", node: s, pin: "in" }],
        [
          { name: "carry", node: s, pin: "out" },
          { name: "carry", node: s, pin: "out" },
        ],
      ),
    ).toThrow(/2 exposed outputs named "carry"/);
  });

  it("refuses the pin names the other loop owns", () => {
    const inner = new Graph(5);
    const m = inner.add(mergePoints, {}, "m");
    expect(() =>
      repeatUntilNode(
        inner,
        [
          { name: "carry", node: m, pin: "in" },
          { name: "each", node: m, pin: "in" },
        ],
        [{ name: "carry", node: m, pin: "out" }],
      ),
    ).toThrow(/reserved for the pin a "forEach" iterates/);
  });

  it("refuses a body output that would shadow a report pin", () => {
    const inner = new Graph(5);
    const s = inner.add(stepToward, {}, "s");
    expect(() =>
      repeatUntilNode(
        inner,
        [{ name: "carry", node: s, pin: "in" }],
        [
          { name: "carry", node: s, pin: "out" },
          { name: "rounds", node: s, pin: "out" },
        ],
      ),
    ).toThrow(/adds "rounds" and "converged" outputs of its own/);
  });

  it("is refused as a node of the graph it wraps", () => {
    // The wrap-cycle guard reads the recorded spec, so a wrapper missing
    // from that map is one whose self-nesting is not caught at `add` and
    // hangs at cook time instead. This is the test that it is recorded.
    const { inner, def } = stepBody();
    expect(() => inner.add(def, undefined, "self")).toThrow(GraphValidationError);
  });

  it("refuses maxRounds below 1 rather than cooking nothing", async () => {
    const { def } = stepBody();
    await expect(run(def, pointAt(0), { maxRounds: 0 })).rejects.toThrow(
      /must cook the body at least once/,
    );
  });
});

describe("repeatUntilNode — the seed", () => {
  it("restores the inner graph's seed, and leaves it otherwise untouched", async () => {
    const { inner, def } = stepBody({ step: 1, target: 2 });
    const seedBefore = inner.seed;
    const versionBefore = inner.version;
    const out = await run(def, pointAt(0));
    expect(out.converged).toBe(true);
    expect(inner.seed).toBe(seedBefore);
    expect(inner.version).toBe(versionBefore);
    expect(inner.require("s").params.step).toBe(1);
  });

  it("restores the seed even when the loop throws", async () => {
    const inner = new Graph(5);
    const n = inner.add(noSignal, {}, "n");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: n, pin: "in" }],
      [{ name: "carry", node: n, pin: "out" }],
    );
    const seedBefore = inner.seed;
    await expect(run(def, pointAt(0))).rejects.toThrow();
    expect(inner.seed).toBe(seedBefore);
  });

  it("holds ONE seed across every round: the body sees the same seed each time", async () => {
    // The load-bearing decision, asserted directly. A recording body notes
    // the inner graph's seed on every cook; all rounds must agree, because
    // a fixed point only exists if the body is the same function each time.
    const seen: number[] = [];
    const inner = new Graph(5);
    const recorder = defineNode<{ report: string }>({
      type: "__test_seedRecorder",
      inputs: [{ name: "in", kind: "geometry", multi: true }],
      outputs: [{ name: "out", kind: "geometry" }],
      defaultParams: { report: "moves" },
      execute({ inputs, params }) {
        seen.push(inner.seed);
        const out: DataItem[] = [];
        for (const item of inputs.in ?? []) {
          if (item.kind !== "geometry") continue;
          const geo = createPointCloud(item.geo.pointCount);
          const from = item.geo.attrs.point.require("P");
          const P = geo.attrs.point.require("P");
          for (let i = 0; i < item.geo.pointCount; i++) {
            P.setTuple(i, [from.get(i, 0) + 1, from.get(i, 1), from.get(i, 2)]);
          }
          geo.attrs.detail.replace(params.report, "u32", 1, 0).set(0, 1);
          out.push(makeGeometryItem(geo));
        }
        return { out };
      },
    });
    const r = inner.add(recorder, {}, "r");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: r, pin: "in" }],
      [{ name: "carry", node: r, pin: "out" }],
    );
    await run(def, pointAt(0), { maxRounds: 4 });
    expect(seen).toHaveLength(4);
    // The falsifier for "they are all equal": there really were four
    // distinct cooks, and a rotating seed would have produced four values.
    expect(new Set(seen).size).toBe(1);
  });
});

describe("repeatUntilNode — cancellation", () => {
  it("rethrows CookCancelledError unwrapped", async () => {
    const controller = new AbortController();
    const inner = new Graph(5);
    // Aborts partway into the loop, so the abort lands INSIDE an inner
    // cook — the case forEach's comment says the naive order broke.
    let cooks = 0;
    const abortingBody = defineNode<Record<string, never>>({
      type: "__test_abortingBody",
      inputs: [{ name: "in", kind: "geometry", multi: true }],
      outputs: [{ name: "out", kind: "geometry" }],
      defaultParams: {},
      execute({ inputs }) {
        if (++cooks === 2) controller.abort();
        const out: DataItem[] = [];
        for (const item of inputs.in ?? []) {
          if (item.kind !== "geometry") continue;
          const geo = createPointCloud(item.geo.pointCount);
          geo.attrs.detail.replace("moves", "u32", 1, 0).set(0, 1);
          out.push(makeGeometryItem(geo));
        }
        return { out };
      },
    });
    const a = inner.add(abortingBody, {}, "a");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: a, pin: "in" }],
      [{ name: "carry", node: a, pin: "out" }],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const n = g.add(def, { maxRounds: 20 }, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "carry", "carry");
    await expect(cook(g, { signal: controller.signal })).rejects.toThrow(CookCancelledError);
    // Unwrapped: a NodeExecutionError would satisfy the line above only if
    // it happened to carry the same name, so assert the shape too.
    const err = await cook(g, { signal: controller.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CookCancelledError);
    expect((err as Error).message).not.toMatch(/repeatUntil: round/);
  });

  it("names the round when the body fails for a reason that is not cancellation", async () => {
    const inner = new Graph(5);
    let cooks = 0;
    const blowsUp = defineNode<Record<string, never>>({
      type: "__test_blowsUp",
      inputs: [{ name: "in", kind: "geometry", multi: true }],
      outputs: [{ name: "out", kind: "geometry" }],
      defaultParams: {},
      execute({ inputs }) {
        if (++cooks === 3) throw new Error("boom");
        const out: DataItem[] = [];
        for (const item of inputs.in ?? []) {
          if (item.kind !== "geometry") continue;
          const geo = createPointCloud(item.geo.pointCount);
          geo.attrs.detail.replace("moves", "u32", 1, 0).set(0, 1);
          out.push(makeGeometryItem(geo));
        }
        return { out };
      },
    });
    const b = inner.add(blowsUp, {}, "b");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: b, pin: "in" }],
      [{ name: "carry", node: b, pin: "out" }],
    );
    await expect(run(def, pointAt(0), { maxRounds: 9 })).rejects.toThrow(
      /repeatUntil: round 3 of at most 9 failed/,
    );
  });
});

describe("repeatUntilNode — device-resident intermediates", () => {
  /** A disposable stand-in for a device buffer handle. */
  function stubHandle(): DeviceTransformsHandle {
    let disposed = false;
    return {
      backend: "webgpu",
      byteLength: 64,
      get disposed() {
        return disposed;
      },
      get resource(): unknown {
        if (disposed) throw new Error("disposed");
        return {};
      },
      dispose() {
        disposed = true;
      },
    };
  }

  it("disposes every discarded round's handles and keeps the last round's", async () => {
    // The hazard forEach does not have: this node discards every round but
    // the last, and the executor's own disposeUndelivered is per-cook-run —
    // a round's outputs WERE delivered, to this node. So the intermediates
    // are ours to free.
    const minted: DeviceTransformsHandle[] = [];
    const inner = new Graph(5);
    const emitter = defineNode<Record<string, never>>({
      type: "__test_deviceEmitter",
      inputs: [{ name: "in", kind: "geometry", multi: true }],
      outputs: [
        { name: "out", kind: "geometry" },
        { name: "inst", kind: "instances" },
      ],
      defaultParams: {},
      execute({ inputs }) {
        const out: DataItem[] = [];
        for (const item of inputs.in ?? []) {
          if (item.kind !== "geometry") continue;
          const geo = createPointCloud(item.geo.pointCount);
          const from = item.geo.attrs.point.require("P");
          const P = geo.attrs.point.require("P");
          for (let i = 0; i < item.geo.pointCount; i++) {
            P.setTuple(i, [from.get(i, 0) + 1, from.get(i, 1), from.get(i, 2)]);
          }
          geo.attrs.detail.replace("moves", "u32", 1, 0).set(0, 1);
          out.push(makeGeometryItem(geo));
        }
        const handle = stubHandle();
        minted.push(handle);
        const batch: DeviceInstanceBatch = {
          residency: "device",
          assetId: "a",
          count: 1,
          transforms: handle,
        };
        return { out, inst: [makeDeviceInstancesItem([batch])] };
      },
    });
    const e = inner.add(emitter, {}, "e");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: e, pin: "in" }],
      [
        { name: "carry", node: e, pin: "out" },
        { name: "spawned", node: e, pin: "inst" },
      ],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const n = g.add(def, { maxRounds: 5 }, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "carry", "carry");
    g.output(n, "spawned", "spawned");
    const result = await cook(g);
    expect(minted).toHaveLength(5);
    // Rounds 1..4 are discarded, so their buffers are freed…
    expect(minted.slice(0, 4).map((h) => h.disposed)).toEqual([true, true, true, true]);
    // …and round 5's, which the caller now owns, is not.
    expect(minted[4].disposed).toBe(false);
    // The surviving handle is the one actually delivered — otherwise the
    // assertion above could pass while the caller held a dead buffer.
    const item = result.outputs.spawned[0];
    if (item.kind !== "instances" || item.deviceBatches === undefined) {
      throw new Error("expected a device-resident instances item");
    }
    expect(item.deviceBatches[0].transforms).toBe(minted[4]);
  });

  it("frees every round's handles when the loop throws", async () => {
    const minted: DeviceTransformsHandle[] = [];
    const inner = new Graph(5);
    let cooks = 0;
    const emitter = defineNode<Record<string, never>>({
      type: "__test_deviceEmitterFails",
      inputs: [{ name: "in", kind: "geometry", multi: true }],
      outputs: [
        { name: "out", kind: "geometry" },
        { name: "inst", kind: "instances" },
      ],
      defaultParams: {},
      execute({ inputs }) {
        if (++cooks === 3) throw new Error("boom");
        const out: DataItem[] = [];
        for (const item of inputs.in ?? []) {
          if (item.kind !== "geometry") continue;
          const geo = createPointCloud(item.geo.pointCount);
          geo.attrs.detail.replace("moves", "u32", 1, 0).set(0, 1);
          out.push(makeGeometryItem(geo));
        }
        const handle = stubHandle();
        minted.push(handle);
        return {
          out,
          inst: [
            makeDeviceInstancesItem([
              { residency: "device", assetId: "a", count: 1, transforms: handle },
            ]),
          ],
        };
      },
    });
    const e = inner.add(emitter, {}, "e");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: e, pin: "in" }],
      [
        { name: "carry", node: e, pin: "out" },
        { name: "spawned", node: e, pin: "inst" },
      ],
    );
    await expect(run(def, pointAt(0), { maxRounds: 9 })).rejects.toThrow(/boom/);
    expect(minted).toHaveLength(2);
    expect(minted.map((h) => h.disposed)).toEqual([true, true]);
  });
});

describe("repeatUntilNode — serialization", () => {
  /**
   * A body built from REGISTERED nodes only, so it can round-trip: step
   * along +x, then reduce the point count into a detail attribute. The
   * count never reaches zero, so this body never settles — which is what
   * makes `maxRounds` and `converged` observable in the round trip.
   */
  function registeredBody(): { inner: Graph; def: NodeDef<Record<string, unknown>> } {
    const inner = new Graph(5);
    const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
    const r = inner.add(
      attributeReduce,
      { name: "", domain: "point", mode: "count", outName: "moves" },
      "r",
    );
    inner.connect(t, "out", r, "in");
    const def = repeatUntilNode(
      inner,
      [{ name: "carry", node: t, pin: "in" }],
      [{ name: "carry", node: r, pin: "out" }],
    );
    return { inner, def };
  }

  it("round-trips through serializeGraph/deserializeGraph and still cooks", async () => {
    const { def } = registeredBody();
    const g = new Graph(7);
    const src = g.add(dataInput, { items: [] }, "src");
    const n = g.add(def, { maxRounds: 3, settleAttr: "moves" }, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "carry", "carry");
    g.output(n, "rounds", "rounds");
    g.output(n, "converged", "converged");

    const json = serializeGraph(g);
    const node = json.nodes.find((entry) => entry.id === "loop");
    expect(node?.type).toBe("repeatUntil");
    expect(node?.params).toMatchObject({ maxRounds: 3, settleAttr: "moves" });

    const reloaded = deserializeGraph(json);
    // The reloaded graph needs its own input items: `items` params are
    // runtime-injected and serialize as [].
    reloaded.setParam({ id: "src" } as NodeHandle<{ items: DataCollection }>, "items", pointAt(0));
    const out = await cook(reloaded);
    expect(value(out.outputs.rounds)).toBe(3);
    expect(value(out.outputs.converged)).toBe(0);
    // Three rounds of +1 on a point that started at 0: the carry fed back
    // across the round trip too.
    expect(xs(out.outputs.carry)).toEqual([3]);
    // And the round trip is a fixed point of itself.
    expect(serializeGraph(reloaded)).toEqual(json);
  });

  it("carries maxRounds through the round trip, not a default", async () => {
    // The falsifier for the test above: a different ceiling must survive.
    const { def } = registeredBody();
    const g = new Graph(7);
    const src = g.add(dataInput, { items: [] }, "src");
    const n = g.add(def, { maxRounds: 6 }, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "rounds", "rounds");
    const reloaded = deserializeGraph(serializeGraph(g));
    reloaded.setParam({ id: "src" } as NodeHandle<{ items: DataCollection }>, "items", pointAt(0));
    expect(value((await cook(reloaded)).outputs.rounds)).toBe(6);
  });

  it("refuses a saved body that names its carry pins from a plain subgraph", () => {
    const { def } = registeredBody();
    const g = new Graph(7);
    const n = g.add(def, undefined, "loop");
    g.output(n, "carry", "carry");
    const json = serializeGraph(g);
    // Retype it as a plain subgraph: the payload is identical, so nothing
    // but the reserved name can catch that it would cook exactly once.
    const retyped = {
      ...json,
      nodes: json.nodes.map((entry) =>
        entry.id === "loop" ? { ...entry, type: "subgraph", params: {} } : entry,
      ),
    };
    expect(() => deserializeGraph(retyped)).toThrow(/cannot expose input "carry"/);
  });
});

describe("repeatUntilNode — composition", () => {
  it("runs inside a subgraph", async () => {
    const { def } = stepBody({ step: 1, target: 2 });
    const mid = new Graph(3);
    const loop = mid.add(def, { maxRounds: 8 }, "loop");
    const subDef = subgraphNode(
      mid,
      [{ name: "in", node: loop, pin: "carry" }],
      [
        { name: "out", node: loop, pin: "carry" },
        { name: "rounds", node: loop, pin: "rounds" },
      ],
    );
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const s = g.add(subDef, undefined, "s");
    g.connect(src, "out", s, "in");
    g.output(s, "out", "out");
    g.output(s, "rounds", "rounds");
    const out = await cook(g);
    expect(xs(out.outputs.out)).toEqual([2]);
    expect(value(out.outputs.rounds)).toBe(3);
  });

  it("is deterministic: the same graph cooked twice gives the same bytes", async () => {
    const { def } = stepBody({ step: 1, target: 4 });
    const first = await run(def, pointAt(0));
    const second = await run(def, pointAt(0));
    expect(xs(second.carry)).toEqual(xs(first.carry));
    expect(second.rounds).toEqual(first.rounds);
    expect(second.converged).toEqual(first.converged);
  });
});

describe("repeatUntilNode — memoization", () => {
  it("caches at the outer level on an unchanged recook", async () => {
    const { def } = stepBody({ step: 1, target: 2 });
    const g = new Graph(7);
    const src = g.add(dataInput, { items: pointAt(0) }, "src");
    const n = g.add(def, undefined, "loop");
    g.connect(src, "out", n, "carry");
    g.output(n, "carry", "carry");
    await cook(g);
    const second = await cook(g);
    expect(second.stats.cooked).toBe(0);
    expect(second.stats.cached).toBe(2);
  });
});
