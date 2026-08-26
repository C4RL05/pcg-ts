/**
 * `quotaRebalance`: the minimum set that must change category.
 *
 * WHAT THIS SUITE PINS is the DECISION and not a redraw. The node names
 * which elements must leave an over-full category and which category each
 * should join; nothing here checks what a caller then does with that,
 * because the node cannot know. `tests/racetrackBandMix.test.ts` is where
 * the decision is checked against the rule it was generalised from.
 *
 * EVERY FIXTURE IS ARITHMETIC ANYONE CAN REDO ON PAPER. Twenty points in
 * three categories against bands written in twentieths, so "0.35 of 20 is
 * 7" is a sentence rather than a cook — the numbers in the expectations
 * were derived that way and not read off a run.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, type Geometry } from "../data/index.js";
import { attribute, component } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { quotaRebalance, type QuotaRebalanceParams } from "./quotas.js";
import {
  firstGeo,
  permutePoints,
  pointRecords,
  runNode,
  shuffledOrder,
} from "./nodes.testsupport.js";

/**
 * A cloud of `categories.length` points, one per entry, carrying that
 * entry as a `band` attribute and a genuine per-point `seed`.
 *
 * The positions are distinct and evenly spaced so that identity is total
 * (a cloud straight out of `createPointCloud` rests its identity on
 * position alone, and coincident points are ONE point to this library).
 */
function population(categories: readonly number[]): Geometry {
  const geo = createPointCloud(categories.length);
  const P = geo.attrs.point.require("P");
  const seed = geo.attrs.point.require("seed");
  const band = geo.attrs.point.add("band", "i32", 1);
  categories.forEach((c, i) => {
    P.setTuple(i, [i, 0, 0]);
    seed.set(i, hashCombine(0x5eed, i));
    band.set(i, c);
  });
  return geo;
}

/** Cook the node over one population and read the destination column back. */
async function rebalance(
  geo: Geometry,
  params: Partial<QuotaRebalanceParams>,
): Promise<number[]> {
  const out = await runNode(
    quotaRebalance,
    { category: attribute("band"), ...params },
    { in: [makeGeometryItem(geo)] },
  );
  const g = firstGeo(out.out);
  const target = g.attrs.point.require(params.targetAttr ?? "quotaTarget");
  return Array.from({ length: g.attrs.point.count }, (_, i) => target.get(i));
}

/** The message of a refusal, or a failure saying the cook went through. */
async function refusal(
  geo: Geometry,
  params: Partial<QuotaRebalanceParams>,
): Promise<string> {
  try {
    await rebalance(geo, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected quotaRebalance to refuse this input, but it cooked");
}

/** How many points ended in each category, given the destinations. */
function finalCounts(categories: readonly number[], target: readonly number[], k: number): number[] {
  const out = new Array<number>(k).fill(0);
  categories.forEach((c, i) => {
    const t = target[i] as number;
    out[t >= 0 ? t : c] = (out[t >= 0 ? t : c] as number) + 1;
  });
  return out;
}

describe("quotaRebalance: what moves", () => {
  it("moves nothing when every share is already inside its band", async () => {
    // 10 / 5 / 5 of 20 is 0.5 / 0.25 / 0.25, all inside.
    const cats = [
      ...Array<number>(10).fill(0),
      ...Array<number>(5).fill(1),
      ...Array<number>(5).fill(2),
    ];
    const target = await rebalance(population(cats), {
      min: [0.4, 0.2, 0.2],
      max: [0.6, 0.3, 0.3],
    });
    expect(target.every((t) => t === -1)).toBe(true);
    // THE CONTROL, without which this passes against a node that does
    // nothing at all: the same population under a band it MISSES has to
    // move something.
    const tighter = await rebalance(population(cats), {
      min: [0.4, 0.3, 0.3],
      max: [0.4, 0.3, 0.3],
    });
    expect(tighter.filter((t) => t >= 0)).toHaveLength(2);
  });

  it("moves exactly the deficit and stops at the edge, not the middle", async () => {
    // 16 / 4 / 0 of 20. Category 2 must reach 0.25 (5 points) and
    // category 0 must come down to 0.5 (10 points). Six leave category 0:
    // five to satisfy category 2's floor, one more to bring category 0
    // under its ceiling — and that sixth goes to whichever category has
    // the most receiving room, which is 2 again (0.6 spare against 1's
    // 0.05). So 0 ends at 10, 1 at 4, 2 at 6.
    const cats = [...Array<number>(16).fill(0), ...Array<number>(4).fill(1)];
    const target = await rebalance(population(cats), {
      min: [0, 0.2, 0.25],
      max: [0.5, 0.25, 1],
    });
    const moved = target.filter((t) => t >= 0);
    expect(moved).toHaveLength(6);
    expect(finalCounts(cats, target, 3)).toEqual([10, 4, 6]);
    // NEAREST EDGE, NOT THE CENTRE: category 0's band is [0, 0.5] whose
    // middle is 0.25, i.e. 5 points. It stops at 10.
    expect(finalCounts(cats, target, 3)[0]).toBe(10);
  });

  it("takes the lowest-priority eligible members first", async () => {
    // 12 / 8 of 20. Category 0 must come down to 0.5, so two leave.
    // Priority is the x coordinate, which is the point index, so the two
    // that go are indices 0 and 1.
    const cats = [...Array<number>(12).fill(0), ...Array<number>(8).fill(1)];
    const target = await rebalance(population(cats), {
      min: [0, 0.4],
      max: [0.5, 1],
      priority: component(attribute("P"), 0),
    });
    expect(target.map((t, i) => (t >= 0 ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1]);
  });

  it("counts a pinned member and never chooses it", async () => {
    const cats = [...Array<number>(12).fill(0), ...Array<number>(8).fill(1)];
    const geo = population(cats);
    const flag = geo.attrs.point.add("pinned", "i32", 1);
    for (let i = 0; i < cats.length; i++) flag.set(i, i < 2 ? 0 : 1);
    const target = await rebalance(geo, {
      min: [0, 0.4],
      max: [0.5, 1],
      priority: component(attribute("P"), 0),
      eligible: attribute("pinned"),
    });
    // Two still leave — the pinned pair is part of the population that
    // put category 0 over its ceiling — but the pair itself stays.
    expect(target.map((t, i) => (t >= 0 ? i : -1)).filter((i) => i >= 0)).toEqual([2, 3]);
  });

  it("takes an excluded member out of the denominator as well as the pool", async () => {
    // 12 / 8, but four of category 0 are excluded. The counted population
    // is 16, of which category 0 holds 8 — exactly its 0.5 ceiling — so
    // NOTHING moves. Under `eligible` instead, the same four would still
    // be counted and two points would have to go.
    const cats = [...Array<number>(12).fill(0), ...Array<number>(8).fill(1)];
    const geo = population(cats);
    const flag = geo.attrs.point.add("inScheme", "i32", 1);
    for (let i = 0; i < cats.length; i++) flag.set(i, i < 4 ? 0 : 1);
    const target = await rebalance(geo, {
      min: [0, 0.4],
      max: [0.5, 1],
      include: attribute("inScheme"),
    });
    expect(target.every((t) => t === -1)).toBe(true);
    // THE CONTROL THE COMMENT ABOVE PROMISES, and it is the only thing
    // that tells `include` apart from a no-op: the SAME four points under
    // `eligible` stay in the denominator, so category 0 is 12 of 20 and
    // two points have to go.
    const asEligible = await rebalance(geo, {
      min: [0, 0.4],
      max: [0.5, 1],
      eligible: attribute("inScheme"),
    });
    expect(asEligible.filter((t) => t >= 0)).toHaveLength(2);
  });

  it("stops when a category's members are all pinned", async () => {
    // Category 0 is 0.75 against a 0.5 ceiling and every member of it is
    // ineligible, so there is no donor. The node stops rather than
    // spinning, and reports no move at all.
    const cats = [...Array<number>(15).fill(0), ...Array<number>(5).fill(1)];
    const geo = population(cats);
    const flag = geo.attrs.point.add("pinned", "i32", 1);
    for (let i = 0; i < cats.length; i++) flag.set(i, cats[i] === 0 ? 0 : 1);
    const target = await rebalance(geo, {
      min: [0, 0.25],
      max: [0.5, 1],
      eligible: attribute("pinned"),
    });
    expect(target.every((t) => t === -1)).toBe(true);
    // AND IT SAYS SO, which is the difference between stopping and
    // succeeding: category 0 is still 0.75 against a 0.5 ceiling.
    const out = await runNode(
      quotaRebalance,
      {
        category: attribute("band"),
        min: [0, 0.25],
        max: [0.5, 1],
        eligible: attribute("pinned"),
        unmetAttr: "quotaUnmet",
      },
      { in: [makeGeometryItem(geo)] },
    );
    expect(firstGeo(out.out).attrs.detail.require("quotaUnmet").get(0)).toBe(1);
    // THE CONTROL: unpin them and the same population moves five points
    // and reports nothing unmet.
    const free = population(cats);
    const ok = await runNode(
      quotaRebalance,
      {
        category: attribute("band"),
        min: [0, 0.25],
        max: [0.5, 1],
        unmetAttr: "quotaUnmet",
      },
      { in: [makeGeometryItem(free)] },
    );
    const freed = firstGeo(ok.out);
    expect(freed.attrs.detail.require("quotaUnmet").get(0)).toBe(0);
    const t2 = freed.attrs.point.require("quotaTarget");
    expect(
      Array.from({ length: cats.length }, (_, i) => t2.get(i)).filter((t) => t >= 0),
    ).toHaveLength(5);
  });

  it("empties an over-full category into the one with the most room", async () => {
    // Nothing is below a floor — every floor is 0 — so the destination
    // comes entirely from the overflow rule. Category 0 is 18 of 20 and
    // must come down to 10; category 1 has 0.9 of receiving room against
    // category 2's 0.15, so all eight go to 1.
    const cats = [...Array<number>(18).fill(0), ...Array<number>(1).fill(1), 2];
    const target = await rebalance(population(cats), {
      min: [0, 0, 0],
      max: [0.5, 0.95, 0.2],
    });
    expect(finalCounts(cats, target, 3)).toEqual([10, 9, 1]);
    expect(target.filter((t) => t === 1)).toHaveLength(8);
  });

  it("writes -1 on a point outside the scheme without reading its category", async () => {
    // The excluded point carries a category of 99, which is outside the
    // list — and is never validated, because `include` is off for it.
    const geo = population([0, 0, 0, 1, 99]);
    const flag = geo.attrs.point.add("inScheme", "i32", 1);
    for (let i = 0; i < 5; i++) flag.set(i, i === 4 ? 0 : 1);
    const target = await rebalance(geo, {
      min: [0, 0],
      max: [1, 1],
      include: attribute("inScheme"),
    });
    expect(target[4]).toBe(-1);
    // THE CONTROL: with that point INCLUDED, its category of 99 is read
    // and refused — so the -1 above is the exclusion working and not the
    // category quietly passing validation.
    const flag2 = geo.attrs.point.require("inScheme");
    flag2.set(4, 1);
    await expect(rebalance(geo, { min: [0, 0], max: [1, 1] })).rejects.toThrow(/point 4/);
  });
});

describe("quotaRebalance: determinism", () => {
  it("decides the same set however the input is ordered", async () => {
    const cats = [...Array<number>(13).fill(0), ...Array<number>(7).fill(1)];
    const geo = population(cats);
    const straight = firstGeo(
      (
        await runNode(
          quotaRebalance,
          { category: attribute("band"), min: [0, 0.4], max: [0.5, 1] },
          { in: [makeGeometryItem(geo)] },
        )
      ).out,
    );
    const shuffled = firstGeo(
      (
        await runNode(
          quotaRebalance,
          { category: attribute("band"), min: [0, 0.4], max: [0.5, 1] },
          { in: [makeGeometryItem(permutePoints(geo, shuffledOrder(cats.length, 7)))] },
        )
      ).out,
    );
    expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
  });

  it("actually moved something, so the shuffle test is not vacuous", async () => {
    // 13 of 20 is 0.65 against a 0.5 ceiling: three have to go.
    const cats = [...Array<number>(13).fill(0), ...Array<number>(7).fill(1)];
    const target = await rebalance(population(cats), { min: [0, 0.4], max: [0.5, 1] });
    expect(target.filter((t) => t >= 0)).toHaveLength(3);
  });

  it("breaks a priority tie by identity, not by array index", async () => {
    // Every priority is the default 0, so the whole choice falls to
    // identity — and identity is derived from position and seed, which
    // the permutation carries with each point. The two runs must pick the
    // same POINTS even though those points sit at different indices.
    const cats = [...Array<number>(12).fill(0), ...Array<number>(8).fill(1)];
    const geo = population(cats);
    const order = shuffledOrder(cats.length, 11);
    const a = await rebalance(geo, { min: [0, 0.4], max: [0.5, 1] });
    const b = await rebalance(permutePoints(geo, order), { min: [0, 0.4], max: [0.5, 1] });
    const movedA = new Set(a.map((t, i) => (t >= 0 ? i : -1)).filter((i) => i >= 0));
    const movedB = new Set(
      b.map((t, j) => (t >= 0 ? (order[j] as number) : -1)).filter((i) => i >= 0),
    );
    expect([...movedB].sort((x, y) => x - y)).toEqual([...movedA].sort((x, y) => x - y));
  });
});

describe("quotaRebalance: reachable bands", () => {
  it("refuses bands no whole number of points can land in", async () => {
    // Two categories banded [0, 0.1] and [0, 0.9] over 13 points. The
    // SUMS are legal — 0 <= 1 and 1.0 >= 1 — and no arrangement works:
    // 1/13 is 0.077, under the first ceiling, and 12/13 is 0.923, over
    // the second, so each state makes the other look like the repair.
    // This is the input the node used to ping-pong on until its budget
    // ran out, emitting moves a caller would have redrawn assets for.
    const m = await refusal(population(Array<number>(13).fill(1)), {
      min: [0, 0],
      max: [0.1, 0.9],
    });
    expect(m).toContain("13 counted points cannot satisfy these bands");
  });

  it("refuses a band narrower than one point of the population", async () => {
    // 7 points, and a band of [0.2, 0.28]: 1 point is 0.143 and 2 is
    // 0.286, so the band falls between two counts and is unreachable
    // however the rest of the population is arranged.
    const m = await refusal(population([0, 0, 0, 1, 1, 1, 1]), {
      min: [0.2, 0],
      max: [0.28, 1],
    });
    expect(m).toContain("no whole number of points lands there");
  });

  it("accepts the same band on a population that can reach it", async () => {
    // THE CONTROL FOR BOTH REFUSALS ABOVE: 25 points reach [0.2, 0.28] —
    // 5 is exactly 0.2 and 7 is 0.28 — so the identical band cooks.
    const cats = [...Array<number>(2).fill(0), ...Array<number>(23).fill(1)];
    const target = await rebalance(population(cats), { min: [0.2, 0], max: [0.28, 1] });
    expect(finalCounts(cats, target, 2)[0]).toBe(5);
  });

  it("accepts band lists that sum to 1 only in decimal", async () => {
    // [0.06, 0.57, 0.37] sums to 0.9999999999999999 in binary and
    // [0.33, 0.56, 0.11] to 1.0000000000000002. Both are exactly 1 as
    // written, and both were refused before the sums carried a slack.
    const cats = [...Array<number>(40).fill(0), ...Array<number>(60).fill(1)];
    await expect(
      rebalance(population(cats), { min: [0, 0, 0], max: [0.06, 0.57, 0.37] }),
    ).resolves.toBeDefined();
    await expect(
      rebalance(population(cats), { min: [0.33, 0.56, 0.11], max: [1, 1, 1] }),
    ).resolves.toBeDefined();
  });

  it("gives the same verdict however the categories are ordered", async () => {
    // The same three ceilings relabelled. [0.06, 0.08, 0.86] sums to 1
    // exactly and [0.06, 0.86, 0.08] to 0.9999999999999999, so before the
    // slack this pair disagreed about whether one band list was legal.
    const cats = [...Array<number>(50).fill(0), ...Array<number>(50).fill(1)];
    for (const max of [
      [0.06, 0.08, 0.86],
      [0.06, 0.86, 0.08],
      [0.86, 0.08, 0.06],
    ]) {
      await expect(
        rebalance(population(cats), { min: [0, 0, 0], max }),
      ).resolves.toBeDefined();
    }
  });
});

describe("quotaRebalance: over many populations", () => {
  /** The library has no Math.random, tests included. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** The integer window a category may hold, on this population. */
  function window(lo: number, hi: number, n: number): [number, number] {
    let a = 0;
    while (lo - a / n > 0) a++;
    let b = n;
    while (b > 0 && b / n - hi > 0) b--;
    return [a, b];
  }

  it("meets every band, and never with a move to spare", async () => {
    // THE PROPERTY THE 24 CASES ABOVE ONLY SAMPLE. Random populations
    // against random bands, keeping the ones the node accepts, and
    // asserting the two things its description promises: every share
    // lands inside its band, and the number of moves is the MINIMUM —
    // which is derivable, not observed. Every excess point must leave and
    // every deficit must be filled, and one move does one of each, so the
    // floor is the larger of the two totals.
    const rand = lcg(20260826);
    let checked = 0;
    let refused = 0;
    let moves = 0;
    for (let trial = 0; trial < 400; trial++) {
      const k = 2 + Math.floor(rand() * 4);
      const n = 4 + Math.floor(rand() * 60);
      const cats = Array.from({ length: n }, () => Math.floor(rand() * k));
      const min: number[] = [];
      const max: number[] = [];
      for (let c = 0; c < k; c++) {
        const lo = Math.floor(rand() * (100 / k)) / 100;
        min.push(lo);
        max.push(Math.min(1, lo + Math.floor(rand() * 40) / 100));
      }
      let target: number[];
      try {
        target = await rebalance(population(cats), { min, max });
      } catch {
        refused++;
        continue;
      }
      checked++;
      const before = new Array<number>(k).fill(0);
      cats.forEach((c) => (before[c] = (before[c] as number) + 1));
      const after = finalCounts(cats, target, k);
      let excess = 0;
      let deficit = 0;
      for (let c = 0; c < k; c++) {
        const [lo, hi] = window(min[c] as number, max[c] as number, n);
        // The band holds afterwards. This is the claim, and nothing in
        // the 24 cases above states it in general.
        expect(after[c]).toBeGreaterThanOrEqual(lo);
        expect(after[c]).toBeLessThanOrEqual(hi);
        excess += Math.max(0, (before[c] as number) - hi);
        deficit += Math.max(0, lo - (before[c] as number));
      }
      const made = target.filter((t) => t >= 0).length;
      expect(made).toBe(Math.max(excess, deficit));
      moves += made;
    }
    // Non-vacuity, twice over: the sweep has to REACH the node, and it
    // has to reach populations that need work.
    // eslint-disable-next-line no-console
    console.log(`quotaRebalance sweep: ${checked} cooked, ${refused} refused, ${moves} moves`);
    expect(checked).toBeGreaterThan(100);
    expect(moves).toBeGreaterThan(100);
  });
});

describe("quotaRebalance: refusals", () => {
  const cats = [0, 0, 1, 1];

  it("refuses an empty band list", async () => {
    expect(await refusal(population(cats), { min: [], max: [] })).toContain(
      "no categories are stated",
    );
  });

  it("refuses lists of different lengths", async () => {
    expect(await refusal(population(cats), { min: [0, 0], max: [1] })).toContain(
      "must be the same length",
    );
  });

  it("refuses a floor above its ceiling", async () => {
    const m = await refusal(population(cats), { min: [0.8, 0], max: [0.2, 1] });
    expect(m).toContain("a band no share can be inside");
  });

  it("refuses a share outside [0, 1]", async () => {
    expect(await refusal(population(cats), { min: [0, 0], max: [1.5, 1] })).toContain(
      "must be in [0, 1]",
    );
  });

  it("refuses floors that sum above 1", async () => {
    const m = await refusal(population(cats), { min: [0.6, 0.6], max: [1, 1] });
    expect(m).toContain("demand more than the whole population");
  });

  it("refuses ceilings that sum below 1", async () => {
    const m = await refusal(population(cats), { min: [0, 0], max: [0.3, 0.3] });
    expect(m).toContain("nowhere to be");
  });

  it("refuses a category index outside the list, naming the point", async () => {
    const m = await refusal(population([0, 1, 5, 0]), { min: [0, 0], max: [1, 1] });
    expect(m).toContain("point 2");
    expect(m).toContain("not one of the 2 categories");
  });

  it("refuses an empty destination name", async () => {
    const m = await refusal(population(cats), { min: [0, 0], max: [1, 1], targetAttr: "" });
    expect(m).toContain("a cook that looks like it worked");
  });

  it("refuses writing over P", async () => {
    const m = await refusal(population(cats), { min: [0, 0], max: [1, 1], targetAttr: "P" });
    expect(m).toContain("overwrite the positions");
  });

  it("refuses a non-finite plain param", async () => {
    // The FIELD path already refused one. A plain number went straight
    // into the array, and a plain NaN priority made the sort comparator
    // inconsistent — NaN differs from itself, so both orderings of a pair
    // compared greater and the identity tiebreak was never reached.
    const m = await refusal(population(cats), { min: [0, 0], max: [1, 1], priority: NaN });
    expect(m).toContain('param "priority" is NaN');
  });

  it("refuses a same-named column of a different shape", async () => {
    const geo = population(cats);
    geo.attrs.point.add("quotaTarget", "f32", 3);
    const m = await refusal(geo, { min: [0, 0], max: [1, 1] });
    expect(m).toContain("quotaTarget");
  });
});

describe("quotaRebalance: degenerate populations", () => {
  it("cooks an empty cloud and writes an empty column", async () => {
    const target = await rebalance(population([]), { min: [0, 0], max: [1, 1] });
    expect(target).toEqual([]);
  });

  it("cooks a population that is entirely excluded", async () => {
    const geo = population([0, 0, 1]);
    const flag = geo.attrs.point.add("inScheme", "i32", 1);
    for (let i = 0; i < 3; i++) flag.set(i, 0);
    const target = await rebalance(geo, {
      min: [0.5, 0.5],
      max: [1, 1],
      include: attribute("inScheme"),
    });
    expect(target).toEqual([-1, -1, -1]);
  });

  it("treats a share exactly on a bound as inside it", async () => {
    // 10 of 20 is exactly 0.5 against a ceiling of 0.5, and 10 is exactly
    // 0.5 against a floor of 0.5. Neither is outside, so nothing moves —
    // the comparisons are strict, which the node's own description says
    // a caller re-checking the same thing has to match.
    const cats = [...Array<number>(10).fill(0), ...Array<number>(10).fill(1)];
    const target = await rebalance(population(cats), { min: [0.5, 0.5], max: [0.5, 0.5] });
    expect(target.every((t) => t === -1)).toBe(true);
  });
});
