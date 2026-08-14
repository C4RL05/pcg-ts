/**
 * COLLECTION PERMUTATION EQUIVARIANCE: reorder a collection and cook
 * again, and every iteration must produce exactly what it produced
 * before — the same blocks, permuted the same way.
 *
 * This is `tests/crossPartition.test.ts`'s first kind, one level up. That
 * file establishes the property for POINTS inside a geometry, and phase 42
 * built `src/data/identity.ts` to make it hold. `forEach` raises the same
 * hazard to ITEMS: a collection's order is an artefact of how it was
 * produced — `partitionByAttribute` emits its groups in first-occurrence
 * order, `assembleInputs` concatenates in connection order, a `dataInput`
 * binding is whatever the host passed this frame — and none of those is
 * supposed to decide what a group generates.
 *
 * WHY THIS FILE HAD TO BE WRITTEN RATHER THAN INHERITED. No existing suite
 * catches an index-keyed forEach. `crossPartition.test.ts` never builds a
 * multi-item collection; `corpus.test.ts` partitions in TIME, and a budget
 * cannot reorder a collection, because a node body is atomic under one. An
 * index-keyed loop would have shipped green through everything.
 *
 * The negative control at the bottom is the point of the file. It runs the
 * same body over the same items keyed on the ITERATION INDEX instead of on
 * content, through the same harness and the same assertions, and must
 * fail them. A test that has never been seen to fail is worth nothing.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  cook,
  createPointCloud,
  forEachNode,
  jitterPoints,
  makeGeometryItem,
  type DataCollection,
  type GeometryItem,
  type Geometry,
} from "../src/index.js";
import { dataInput } from "../src/runtime/index.js";
import { hashCombine } from "../src/random/hash.js";
import { Pcg32 } from "../src/random/pcg32.js";
import { pointRows } from "./support/pointMultiset.js";

/** A shuffle of 0..n-1, deterministic in `seed`. */
function shuffleOrder(n: number, seed: number): Uint32Array {
  const rng = new Pcg32(seed);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.range(0, i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/**
 * K groups, each several points, each distinctly placed and tagged —
 * the shape `partitionByAttribute` emits.
 */
function groups(k: number): GeometryItem[] {
  return Array.from({ length: k }, (_, g) =>
    makeGeometryItem(
      cloudAt([
        [g * 10, 0, 0],
        [g * 10 + 1, 0, 0],
        [g * 10 + 2, 0, 0],
      ]),
      [`district=${g}`],
    ),
  );
}

/** One string per emitted block: its tags, then every point row in it. */
function blocks(coll: DataCollection): string[] {
  return coll.map((item) => {
    if (item.kind !== "geometry") return `${item.kind}`;
    return `[${[...item.tags].sort().join("|")}] ${pointRows(item.geo).join(" ; ")}`;
  });
}

/** Cook the items in the given order through a jittering forEach body. */
async function runForEach(items: readonly GeometryItem[]): Promise<string[]> {
  const inner = new Graph(4);
  const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
  const def = forEachNode(inner, [{ name: "each", node: j, pin: "in" }], [
    { name: "out", node: j, pin: "out" },
  ]);
  const g = new Graph(11);
  const src = g.add(dataInput, { items: [...items] }, "src");
  const fe = g.add(def, undefined, "fe");
  g.connect(src, "out", fe, "each");
  g.output(fe, "out", "out");
  return blocks((await cook(g)).outputs.out);
}

/**
 * THE CONTROL. The same body over the same items, looped in TypeScript and
 * seeded on the iteration index — what a forEach would do if it keyed on
 * position instead of content. Every assertion below must reject it.
 */
async function runIndexKeyed(items: readonly GeometryItem[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const g = new Graph(hashCombine(11, i));
    const src = g.add(dataInput, { items: [items[i]] }, "src");
    const j = g.add(jitterPoints, { amount: [1, 1, 1] }, "j");
    g.connect(src, "out", j, "in");
    g.output(j, "out", "out");
    out.push(...blocks((await cook(g)).outputs.out));
  }
  return out;
}

const K = 6;
const ORDER = shuffleOrder(K, 20260814);

describe("forEach: collection permutation equivariance", () => {
  it("shuffles the output exactly as the input was shuffled", async () => {
    const straight = groups(K);
    const shuffled = [...ORDER].map((i) => straight[i]);
    // Non-vacuity first: a shuffle that changed nothing would pass the
    // real assertion for the wrong reason.
    expect([...ORDER]).not.toEqual([...Array(K).keys()]);

    const before = await runForEach(straight);
    const after = await runForEach(shuffled);
    expect(before).toHaveLength(K);
    expect(new Set(before).size, "every block distinct").toBe(K);
    // Equivariance, NOT invariance: the blocks move, and each one is
    // byte-for-byte the block that item produced in the other order.
    expect(after).toEqual([...ORDER].map((i) => before[i]));
  });

  it("is unmoved by which connection order assembled the collection", async () => {
    // The other way a collection gets reordered: two dataInput nodes into
    // one multi pin, wired in either order.
    const items = groups(4);
    const build = async (first: GeometryItem[], second: GeometryItem[]): Promise<string[]> => {
      const inner = new Graph(4);
      const j = inner.add(jitterPoints, { amount: [1, 1, 1] }, "j");
      const def = forEachNode(inner, [{ name: "each", node: j, pin: "in" }], [
        { name: "out", node: j, pin: "out" },
      ]);
      const g = new Graph(11);
      const a = g.add(dataInput, { items: first }, "a");
      const b = g.add(dataInput, { items: second }, "b");
      const fe = g.add(def, undefined, "fe");
      g.connect(a, "out", fe, "each");
      g.connect(b, "out", fe, "each");
      g.output(fe, "out", "out");
      return blocks((await cook(g)).outputs.out);
    };
    const ab = await build(items.slice(0, 2), items.slice(2));
    const ba = await build(items.slice(2), items.slice(0, 2));
    expect(ba).toEqual([...ab.slice(2), ...ab.slice(0, 2)]);
  });

  it("gives one item the same block however many others travel with it", async () => {
    // A filter upstream that drops a group must not re-roll the survivors.
    const all = groups(K);
    const full = await runForEach(all);
    const thinned = await runForEach([all[1], all[4]]);
    expect(thinned).toEqual([full[1], full[4]]);
  });
});

describe("forEach equivariance: the negative control", () => {
  it("REDDENS when the iteration is keyed on its index instead of its content", async () => {
    const straight = groups(K);
    const shuffled = [...ORDER].map((i) => straight[i]);
    const before = await runIndexKeyed(straight);
    const after = await runIndexKeyed(shuffled);
    // Same harness, same assertion as the first test above — and it must
    // not hold, or that test proves nothing.
    expect(after).not.toEqual([...ORDER].map((i) => before[i]));
  });

  it("REDDENS on the thinning case too", async () => {
    const all = groups(K);
    const full = await runIndexKeyed(all);
    const thinned = await runIndexKeyed([all[1], all[4]]);
    expect(thinned).not.toEqual([full[1], full[4]]);
  });
});
