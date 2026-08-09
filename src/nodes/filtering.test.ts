import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { pointIdentities } from "../data/identity.js";
import { attribute, constant, position, randomField } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import {
  filterByAttribute,
  filterByBounds,
  filterByDensity,
  pointGrid,
  projectToPlane,
  selfPrune,
} from "./index.js";
import {
  firstGeo,
  permutePoints,
  pointRecords,
  positionsOf,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./testSupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/**
 * `cloudAt` plus a genuine per-point `seed`, which is half of a point's
 * identity: a cloud straight out of createPointCloud has every seed at 0
 * and rests its identity on position alone.
 */
function seededCloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = cloudAt(positions);
  const seed = geo.attrs.point.require("seed");
  for (let i = 0; i < positions.length; i++) seed.set(i, hashCombine(0x5eed, i));
  return geo;
}

/** A deterministic scatter that owes nothing to the library's own sources. */
function scatter(count: number, seed: number, extent = 8): number[][] {
  return Array.from({ length: count }, (_, i) => [
    hashFloat(hashCombine(seed, i, 0)) * extent,
    hashFloat(hashCombine(seed, i, 1)) * extent,
    hashFloat(hashCombine(seed, i, 2)) * extent,
  ]);
}

/** A cloud plus one scalar f32 point attribute per named value list. */
function cloudWith(
  positions: number[][],
  attrs: Record<string, number[]>,
): ReturnType<typeof createPointCloud> {
  const geo = cloudAt(positions);
  for (const [name, values] of Object.entries(attrs)) {
    const attr = geo.attrs.point.add(name, "f32", 1, 0);
    values.forEach((v, i) => attr.set(i, v));
  }
  return geo;
}

describe("filterByDensity", () => {
  it("threshold mode keeps density >= threshold", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const density = cloud.attrs.point.require("density");
    density.set(0, 0.2);
    density.set(1, 0.5);
    density.set(2, 0.9);
    const geo = firstGeo(
      (
        await runNode(filterByDensity, { mode: "threshold", threshold: 0.5 }, {
          in: [makeGeometryItem(cloud)],
        })
      ).out,
    );
    expect(positionsOf(geo).map((p) => p[0])).toEqual([1, 2]);
  });

  it("probabilistic mode keeps a density-proportional, deterministic subset", async () => {
    const cloud = cloudAt(Array.from({ length: 1000 }, (_, i) => [i, 0, 0]));
    cloud.attrs.point.require("density").fill(0.3, 0, 1000);
    const run = () =>
      runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(cloud)] }, 5);
    const a = firstGeo((await run()).out);
    const b = firstGeo((await run()).out);
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
    expect(a.pointCount).toBeGreaterThan(200);
    expect(a.pointCount).toBeLessThan(400);
    // Survivors are a subset of the input positions.
    const inputXs = new Set(positionsOf(cloud).map((p) => p[0]));
    for (const [x] of positionsOf(a)) expect(inputXs.has(x)).toBe(true);
    // density 0 never survives, density 1 always does.
    cloud.attrs.point.require("density").fill(0, 0, 1000);
    expect(firstGeo((await run()).out).pointCount).toBe(0);
    cloud.attrs.point.require("density").fill(1, 0, 1000);
    expect(firstGeo((await run()).out).pointCount).toBe(1000);
  });

  it("probabilistic mode is permutation-equivariant", async () => {
    // The acceptance draw is keyed on each point's IDENTITY, so shuffling
    // the input can only shuffle the output: the same points survive.
    const cloud = seededCloudAt(scatter(400, 21));
    cloud.attrs.point.require("density").fill(0.4, 0, 400);
    const order = shuffledOrder(400, 9);
    const run = (geo: ReturnType<typeof createPointCloud>) =>
      runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(geo)] }, 5);
    const straight = firstGeo((await run(cloud)).out);
    const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
    // The filter really filtered — an all-survive run proves nothing.
    expect(straight.pointCount).toBeGreaterThan(100);
    expect(straight.pointCount).toBeLessThan(300);
    expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
  });

  it("probabilistic mode reads BOTH halves of a point's identity", async () => {
    // Neither half can be dropped: seeds alone default to 0 on hand-built
    // clouds, and positions alone collide on coincident points. Each half
    // is shown to matter by moving ONLY it and watching the survivor set
    // change — which is also what makes this fail against index keying,
    // where neither half is read at all.
    const positions = scatter(200, 3);
    const ordered = (geo: ReturnType<typeof createPointCloud>) => {
      const ord = geo.attrs.point.add("ord", "f32", 1, 0);
      for (let i = 0; i < geo.pointCount; i++) ord.set(i, i);
      geo.attrs.point.require("density").fill(0.5, 0, geo.pointCount);
      return geo;
    };
    const survivors = async (geo: ReturnType<typeof createPointCloud>): Promise<number[]> => {
      const out = firstGeo(
        (await runNode(filterByDensity, { mode: "probabilistic" }, { in: [makeGeometryItem(geo)] }, 5)).out,
      );
      const ord = out.attrs.point.require("ord");
      return Array.from({ length: out.pointCount }, (_, i) => ord.get(i, 0));
    };
    const seeded = await survivors(ordered(seededCloudAt(positions)));
    const unseeded = await survivors(ordered(cloudAt(positions)));
    const moved = await survivors(
      ordered(seededCloudAt(positions.map(([x, y, z]) => [x + 0.5, y, z]))),
    );
    expect(seeded.length).toBeGreaterThan(50);
    expect(seeded).not.toEqual(unseeded); // the seed attribute is read
    expect(seeded).not.toEqual(moved); // the position bits are read
  });

  it("errors actionably when density is missing", async () => {
    const geo = createPointCloud(1);
    geo.attrs.point.remove("density");
    await expect(
      runNode(filterByDensity, {}, { in: [makeGeometryItem(geo)] }),
    ).rejects.toThrow(/"density".*setAttribute/);
  });
});

describe("filterByBounds", () => {
  const positions = [
    [0.5, 0.5, 0.5],
    [2, 0.5, 0.5],
    [1, 1, 1], // on the boundary: inclusive
  ];

  it("inside keeps points within the box (inclusive)", async () => {
    const geo = firstGeo(
      (
        await runNode(filterByBounds, { boundsMin: [0, 0, 0], boundsMax: [1, 1, 1], mode: "inside" }, {
          in: [makeGeometryItem(cloudAt(positions))],
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0.5, 0.5, 0.5],
      [1, 1, 1],
    ]);
  });

  it("outside keeps the complement", async () => {
    const geo = firstGeo(
      (
        await runNode(filterByBounds, { boundsMin: [0, 0, 0], boundsMax: [1, 1, 1], mode: "outside" }, {
          in: [makeGeometryItem(cloudAt(positions))],
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([[2, 0.5, 0.5]]);
  });
});

describe("filterByAttribute", () => {
  it("compares numeric attributes with every operator", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
    const attr = cloud.attrs.point.add("level", "i32", 1, 0);
    attr.set(0, -1);
    attr.set(1, 0);
    attr.set(2, 3);
    const item = makeGeometryItem(cloud);
    const xsFor = async (comparison: string, value: number) =>
      positionsOf(
        firstGeo(
          (
            await runNode(filterByAttribute, { attribute: "level", comparison, value }, { in: [item] })
          ).out,
        ),
      ).map((p) => p[0]);
    expect(await xsFor("eq", 0)).toEqual([1]);
    expect(await xsFor("ne", 0)).toEqual([0, 2]);
    expect(await xsFor("lt", 0)).toEqual([0]);
    expect(await xsFor("le", 0)).toEqual([0, 1]);
    expect(await xsFor("gt", 0)).toEqual([2]);
    expect(await xsFor("ge", 0)).toEqual([1, 2]);
  });

  it("compares string attributes with eq/ne and rejects ordering", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const attr = cloud.attrs.point.add("species", "string", 1, "");
    attr.setString(0, "oak");
    attr.setString(1, "fir");
    const item = makeGeometryItem(cloud);
    const eq = firstGeo(
      (
        await runNode(
          filterByAttribute,
          { attribute: "species", comparison: "eq", stringValue: "oak" },
          { in: [item] },
        )
      ).out,
    );
    expect(positionsOf(eq)).toEqual([[0, 0, 0]]);
    await expect(
      runNode(filterByAttribute, { attribute: "species", comparison: "lt" }, { in: [item] }),
    ).rejects.toThrow(/only comparisons "eq" and "ne"/);
  });

  it("errors actionably on missing or non-scalar attributes", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    await expect(
      runNode(filterByAttribute, { attribute: "nope" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/"nope" not found; available: P, rot/);
    await expect(
      runNode(filterByAttribute, { attribute: "P" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/tuple size 3/);
  });
});

describe("selfPrune", () => {
  it("keeps points pairwise >= minDistance", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 1.5 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBeGreaterThan(0);
    expect(geo.pointCount).toBeLessThan(100);
    const kept = positionsOf(geo);
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const d = Math.hypot(kept[i][0] - kept[j][0], kept[i][1] - kept[j][1], kept[i][2] - kept[j][2]);
        expect(d).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("keeps everything when spacing already satisfies the distance", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 40, countY: 1, countZ: 40 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 0.5 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBe(1600);
  });

  it("minDistance 0 passes points through", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 3, countY: 1, countZ: 1 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 0 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBe(3);
  });

  describe("permutation equivariance", () => {
    // The visit order is priority DESCENDING then IDENTITY ascending, so
    // reordering the input can only reorder the output. Against the old
    // index-greedy every one of these picks a different survivor set.
    const cloud = seededCloudAt(scatter(300, 77, 6));

    it("holds at a uniform minDistance", async () => {
      const order = shuffledOrder(300, 4);
      const run = (geo: ReturnType<typeof createPointCloud>) =>
        runNode(selfPrune, { minDistance: 1 }, { in: [makeGeometryItem(geo)] }, 3);
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(straight.pointCount).toBeGreaterThan(10);
      expect(straight.pointCount).toBeLessThan(300); // it really pruned
      expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
    });

    it("holds with per-point radii and a random priority", async () => {
      const order = shuffledOrder(300, 12);
      const run = (geo: ReturnType<typeof createPointCloud>) =>
        runNode(
          selfPrune,
          { minDistance: constant(1.2), priority: randomField("thin") } as never,
          { in: [makeGeometryItem(geo)] },
          3,
        );
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(straight.pointCount).toBeGreaterThan(10);
      expect(straight.pointCount).toBeLessThan(300);
      expect(pointRecords(shuffled).sort()).toEqual(pointRecords(straight).sort());
    });

    it("still emits survivors in ascending INPUT index order", async () => {
      // Identity decides WHO survives; it never decides the output order.
      const geo = firstGeo(
        (await runNode(selfPrune, { minDistance: 1 }, { in: [makeGeometryItem(cloud)] }, 3)).out,
      );
      const seen = positionsOf(cloud).map((p) => p.join(","));
      const kept = positionsOf(geo).map((p) => seen.indexOf(p.join(",")));
      expect(kept).toEqual([...kept].sort((a, b) => a - b));
    });
  });

  /**
   * The visit order the node uses when every point ties on priority:
   * identity ascending, indistinguishable points (same position AND same
   * seed) falling back to the index. Stated here so the reference greedy
   * below can restate the CONTRACT — priority, then identity — without
   * restating the implementation.
   */
  function visitOrder(pts: number[][]): number[] {
    const ident = pointIdentities(cloudAt(pts), "test");
    return Array.from({ length: pts.length }, (_, i) => i).sort(
      (a, b) => ident[a] - ident[b] || a - b,
    );
  }

  /** The single point of `pts` an identity-ordered greedy considers first. */
  function firstVisited(pts: number[][]): number[] {
    return pts[visitOrder(pts)[0]];
  }

  /**
   * The published contract, pinned against its own definition: the grid is
   * an accelerator, so its answers must equal the O(n^2) greedy exactly —
   * including where distances are NaN. Positions are f32-rounded up front so
   * the reference sees the same numbers the geometry stores. Points are
   * CONSIDERED in identity order and RETURNED in input order, which is the
   * node's split between who survives and what order they come out in.
   */
  function greedy(pts: number[][], minDistance: number): number[][] {
    const limit = minDistance * minDistance;
    const kept: number[] = [];
    for (const i of visitOrder(pts)) {
      const p = pts[i];
      let ok = true;
      for (const j of kept) {
        const q = pts[j];
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const dz = q[2] - p[2];
        if (dx * dx + dy * dy + dz * dz < limit) {
          ok = false;
          break;
        }
      }
      if (ok) kept.push(i);
    }
    return kept.sort((a, b) => a - b).map((i) => pts[i]);
  }

  async function prune(pts: number[][], minDistance: number): Promise<number[][]> {
    const out = firstGeo(
      (await runNode(selfPrune, { minDistance }, { in: [makeGeometryItem(cloudAt(pts))] })).out,
    );
    return positionsOf(out);
  }

  it("equals the O(n^2) greedy on lattices, clusters, and duplicates", async () => {
    let state = 12345;
    const rand = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.fround(state / 4294967296);
    };
    const lattice: number[][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) lattice.push([x, 0, z]);
    const scatter: number[][] = [];
    for (let i = 0; i < 400; i++) scatter.push([rand() * 4, rand() * 4, rand() * 4]);
    const duplicates = Array.from({ length: 20 }, (_, i) => [i % 2, 0, 0]);
    for (const pts of [lattice, scatter, duplicates]) {
      // 1 and 1.5 straddle the lattice spacing, so ties are exercised.
      for (const minDistance of [0.25, 1, 1.5, 3]) {
        expect(await prune(pts, minDistance)).toEqual(greedy(pts, minDistance));
      }
    }
  });

  it("keeps the exact survivors of a 6x6 lattice at minDistance 1.5", async () => {
    const lattice: number[][] = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) lattice.push([x, 0, z]);
    // 1.5 rejects the spacing-1 and the diagonal spacing-sqrt(2)
    // neighbours and accepts spacing 2, so 9 of the 36 sites survive. WHICH
    // nine is decided by identity order, not by array order: the answer is
    // a scattered maximal set rather than the every-other-site pattern an
    // index-greedy produces by always starting at the array's front corner.
    expect(await prune(lattice, 1.5)).toEqual([
      [0, 0, 1],
      [0, 0, 3],
      [0, 0, 5],
      [2, 0, 0],
      [2, 0, 5],
      [3, 0, 3],
      [4, 0, 1],
      [4, 0, 5],
      [5, 0, 3],
    ]);
  });

  it("survives a subnormal minDistance", async () => {
    // 5e-324 is positive, so pruning runs, but its square underflows to 0
    // and no pair is ever closer than that: everything survives. The grid is
    // built at that cell size, which is where a scaled cell size would
    // underflow to zero and fail.
    const pts = [
      [0, 0, 0],
      [0, 0, 0],
      [1, 2, 3],
      [-1, -2, -3],
    ];
    expect(await prune(pts, Number.MIN_VALUE)).toEqual(greedy(pts, Number.MIN_VALUE));
    expect(await prune(pts, Number.MIN_VALUE)).toHaveLength(4);
  });

  it("never prunes with a non-finite coordinate, and is never pruned by one", async () => {
    // Every distance involving NaN or an infinity is NaN, which is not less
    // than minDistance, so those points survive and shield nothing.
    const pts = [
      [0, 0, 0],
      [NaN, 1, 2],
      [Infinity, -Infinity, NaN],
      [0.5, 0.5, 0.5], // pruned by point 0
      [-Infinity, 0, 0],
      [Infinity, 0, 0],
      [Infinity, 0, 0], // a duplicate infinity still survives
      [2, 2, 2],
    ];
    const kept = await prune(pts, 1);
    expect(kept).toEqual(greedy(pts, 1));
    expect(kept.length).toBe(7);
    expect(kept[3]).toEqual([-Infinity, 0, 0]);
  });

  /** Survivor positions for one `priority` / `minDistance` configuration. */
  async function survivors(
    geo: ReturnType<typeof createPointCloud>,
    params: Record<string, unknown>,
  ): Promise<number[][]> {
    return positionsOf(
      firstGeo((await runNode(selfPrune, params as never, { in: [makeGeometryItem(geo)] })).out),
    );
  }

  describe("priority", () => {
    // Half a minDistance apart: exactly one of the two can survive, so
    // whichever comes back names the winner with no ambiguity.
    const pair = [
      [0, 0, 0],
      [0.5, 0, 0],
    ];

    it("lets the HIGHER priority win, whatever the index order", async () => {
      const won = (rank: number[]) =>
        survivors(cloudWith(pair, { rank }), { minDistance: 1, priority: attribute("rank") });
      // The later point wins on priority alone — the greedy would keep the first.
      expect(await won([0, 1])).toEqual([[0.5, 0, 0]]);
      // Polarity, stated the other way round: a LOWER value never wins.
      expect(await won([1, 0])).toEqual([[0, 0, 0]]);
      // Equal priority falls back to the tiebreak, which is IDENTITY —
      // and for this pair identity does NOT agree with the index, so the
      // two rules are separated rather than assumed apart.
      expect(firstVisited(pair)).not.toEqual(pair[0]);
      expect(await won([0, 0])).toEqual([firstVisited(pair)]);
      expect(await won([4, 4])).toEqual([firstVisited(pair)]);
    });

    it("ranks NaN lowest", async () => {
      const won = (rank: number[]) =>
        survivors(cloudWith(pair, { rank }), { minDistance: 1, priority: attribute("rank") });
      expect(await won([NaN, 0])).toEqual([[0.5, 0, 0]]);
      expect(await won([0, NaN])).toEqual([[0, 0, 0]]);
      // Two unrankable points still break their tie by identity.
      expect(await won([NaN, NaN])).toEqual([firstVisited(pair)]);
    });

    it("is the same as no priority at all when every point ties", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
      const item = makeGeometryItem(grid);
      const base = firstGeo(
        (await runNode(selfPrune, { minDistance: 1.5 }, { in: [item] })).out,
      );
      for (const priority of [0, 5, -3, constant(7), attribute("density")]) {
        const same = firstGeo(
          (await runNode(selfPrune, { minDistance: 1.5, priority } as never, { in: [item] })).out,
        );
        expect(snapshotGeometry(same)).toEqual(snapshotGeometry(base));
      }
    });

    it("decides WHO survives, never the order they come out in", async () => {
      // Index 2 outranks everything, prunes index 0, and index 1 is far
      // enough away to be untouched. Emitting in priority order would put
      // [0.25, 0, 0] first.
      const geo = cloudWith(
        [
          [0, 0, 0],
          [5, 0, 0],
          [0.25, 0, 0],
        ],
        { rank: [0, 0, 9] },
      );
      expect(await survivors(geo, { minDistance: 1, priority: attribute("rank") })).toEqual([
        [5, 0, 0],
        [0.25, 0, 0],
      ]);
    });

    it("is deterministic under a random priority, and re-rolls with the key", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 12, countY: 1, countZ: 12 })).out);
      const item = makeGeometryItem(grid);
      const run = (key: string) =>
        runNode(selfPrune, { minDistance: 1.5, priority: randomField(key) } as never, {
          in: [item],
        }, 5);
      const a = firstGeo((await run("thin")).out);
      const b = firstGeo((await run("thin")).out);
      expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
      // The negative half: a different key must actually move the result.
      const c = firstGeo((await run("other")).out);
      expect(snapshotGeometry(c)).not.toEqual(snapshotGeometry(a));
    });
  });

  describe("per-point minDistance", () => {
    it("agrees with the same number passed plainly", async () => {
      const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
      const item = makeGeometryItem(grid);
      for (const minDistance of [0.5, 1.5, 2]) {
        const plain = firstGeo((await runNode(selfPrune, { minDistance }, { in: [item] })).out);
        const field = firstGeo(
          (
            await runNode(selfPrune, { minDistance: constant(minDistance) } as never, {
              in: [item],
            })
          ).out,
        );
        expect(snapshotGeometry(field)).toEqual(snapshotGeometry(plain));
      }
    });

    it("conflicts a pair on the LARGER of the two radii", async () => {
      // 2 apart: inside the big claim of 3, outside the small claim of 0.5.
      // A rule reading only the candidate's own radius would keep both, so
      // what is under test is that exactly ONE comes back. Which one is the
      // tiebreak's business, and the tiebreak is identity — the same point
      // wins whichever slot each occupies, which the swapped case pins.
      const pts = [
        [0, 0, 0],
        [2, 0, 0],
      ];
      expect(
        await survivors(cloudWith(pts, { crown: [3, 0.5] }), {
          minDistance: attribute("crown"),
        }),
      ).toEqual([firstVisited(pts)]);
      // Swapped slots, swapped radii: the same POSITION survives, because
      // identity does not know where in the array a point sits.
      expect(
        await survivors(
          cloudWith(
            [
              [2, 0, 0],
              [0, 0, 0],
            ],
            { crown: [0.5, 3] },
          ),
          { minDistance: attribute("crown") },
        ),
      ).toEqual([firstVisited(pts)]);
    });

    it("does not add the two radii up", async () => {
      // 1.5 apart, each claiming 1: the max rule keeps both, a sum rule
      // (radii as touching discs) would have pruned one.
      expect(
        await survivors(
          cloudWith(
            [
              [0, 0, 0],
              [1.5, 0, 0],
            ],
            { crown: [1, 1] },
          ),
          { minDistance: attribute("crown") },
        ),
      ).toEqual([
        [0, 0, 0],
        [1.5, 0, 0],
      ]);
    });

    it("treats 0, negative and NaN radii as claiming nothing, but still prunes them", async () => {
      const pts = [
        [0, 0, 0],
        [2, 0, 0],
        [8, 0, 0],
        [8.25, 0, 0],
      ];
      // 8 and 8.25 claim nothing and are a quarter apart, so neither can
      // prune the other and BOTH survive — that is the "claiming nothing"
      // half. The 0/2 pair is inside the claim of 3, so exactly one of
      // them comes back, whichever identity considers first — that is the
      // "still prunes them" half.
      const contested = visitOrder(pts).find((i) => i === 0 || i === 1) as number;
      expect(
        await survivors(cloudWith(pts, { crown: [3, NaN, -1, 0] }), {
          minDistance: attribute("crown"),
        }),
      ).toEqual([pts[contested], [8, 0, 0], [8.25, 0, 0]]);
    });

    it("lets priority beat radius", async () => {
      // The small, high-priority point is placed first and the big one
      // then loses to it — authored beats procedural by saying so.
      expect(
        await survivors(
          cloudWith(
            [
              [0, 0, 0],
              [2, 0, 0],
            ],
            { crown: [3, 0.5], rank: [0, 1] },
          ),
          { minDistance: attribute("crown"), priority: attribute("rank") },
        ),
      ).toEqual([[2, 0, 0]]);
    });

    it("keeps every point when the radii are all zero, as a point cloud", async () => {
      const geo = cloudWith(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        { crown: [0, 0] },
      );
      expect(await survivors(geo, { minDistance: attribute("crown") })).toEqual([
        [0, 0, 0],
        [0, 0, 0],
      ]);
    });

    it("names the node and the param when a field is not one number per point", async () => {
      const geo = cloudAt([[0, 0, 0]]);
      await expect(
        runNode(selfPrune, { minDistance: position() } as never, { in: [makeGeometryItem(geo)] }),
      ).rejects.toThrow(/selfPrune: param "minDistance" must evaluate to ONE number per point/);
      await expect(
        runNode(selfPrune, { minDistance: 1, priority: position() } as never, {
          in: [makeGeometryItem(geo)],
        }),
      ).rejects.toThrow(/selfPrune: param "priority" must evaluate to ONE number per point/);
    });
  });
});

describe("projectToPlane", () => {
  it("projects onto the plane and can keep the signed offset", async () => {
    const cloud = cloudAt([
      [1, 5, 2],
      [3, -1, 4],
    ]);
    const geo = firstGeo(
      (
        await runNode(
          projectToPlane,
          { origin: [0, 2, 0], normal: [0, 2, 0], keepOffset: true },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [1, 2, 2],
      [3, 2, 4],
    ]);
    const offset = geo.attrs.point.require("planeOffset");
    expect(offset.get(0)).toBeCloseTo(3, 5);
    expect(offset.get(1)).toBeCloseTo(-3, 5);
  });

  it("rejects a zero normal", async () => {
    await expect(
      runNode(projectToPlane, { normal: [0, 0, 0] }, { in: [makeGeometryItem(cloudAt([[0, 0, 0]]))] }),
    ).rejects.toThrow(/non-zero/);
  });
});
