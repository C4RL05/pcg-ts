/**
 * pointNeighborhood and sampleNearestPoint.
 *
 * Both are index-backed, so both are validated the way `src/spatial`
 * itself was: against a brute-force reference over pseudo-random inputs,
 * where the reference restates the SEMANTICS (every pair, boundary
 * inclusive, lowest index wins) and never the implementation.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import {
  pointNeighborhood,
  sampleNearestPoint,
  type PointNeighborhoodParams,
  type SampleNearestPointParams,
} from "./index.js";
import {
  firstGeo,
  permutePoints,
  runNode,
  shuffledOrder,
  snapshotGeometry,
} from "./testSupport.js";

function cloudAt(positions: readonly (readonly number[])[]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/** Deterministic pseudo-random cloud in a box, independent of the library's nodes. */
function randomPositions(count: number, seed: number, extent = 10): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    out.push([
      hashFloat(hashCombine(seed, i, 0)) * extent,
      hashFloat(hashCombine(seed, i, 1)) * extent,
      hashFloat(hashCombine(seed, i, 2)) * extent,
    ]);
  }
  return out;
}

function attrTuples(
  geo: ReturnType<typeof createPointCloud>,
  name: string,
): number[][] {
  const attr = geo.attrs.point.require(name);
  const out: number[][] = [];
  for (let i = 0; i < geo.pointCount; i++) out.push(attr.getTuple(i));
  return out;
}

async function runNeighborhood(
  positions: readonly (readonly number[])[],
  params: Partial<PointNeighborhoodParams> = {},
): Promise<ReturnType<typeof createPointCloud>> {
  const cloud = cloudAt(positions);
  const out = await runNode(pointNeighborhood, params, { in: [makeGeometryItem(cloud)] });
  return firstGeo(out.out) as ReturnType<typeof createPointCloud>;
}

// ---------------------------------------------------------------------------
// Brute-force references: the semantics, restated without the index.

/** Every other point within `radius`, boundary included, ascending index. */
function bruteNeighbors(
  positions: readonly (readonly number[])[],
  i: number,
  radius: number,
  includeSelf: boolean,
): number[] {
  const out: number[] = [];
  for (let j = 0; j < positions.length; j++) {
    if (j === i && !includeSelf) continue;
    const dx = positions[j][0] - positions[i][0];
    const dy = positions[j][1] - positions[i][1];
    const dz = positions[j][2] - positions[i][2];
    if (dx * dx + dy * dy + dz * dz <= radius * radius) out.push(j);
  }
  return out;
}

/** Nearest source index within `maxDistance`, ties to the lowest index; -1 for none. */
function bruteNearest(
  source: readonly (readonly number[])[],
  p: readonly number[],
  maxDistance: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  let bestIdx = -1;
  for (let j = 0; j < source.length; j++) {
    const dx = source[j][0] - p[0];
    const dy = source[j][1] - p[1];
    const dz = source[j][2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 <= maxDistance * maxDistance)) continue;
    if (bestIdx < 0 || d2 < best) {
      best = d2;
      bestIdx = j;
    }
  }
  return bestIdx;
}

describe("pointNeighborhood", () => {
  it("counts the other points inside the radius, boundary included", async () => {
    // x = 0, 1, 2, 5. Radius 1 pairs (0,1) and (1,2); 5 is alone.
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [5, 0, 0],
      ],
      { radius: 1 },
    );
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([1, 2, 1, 0]);
  });

  it("includeSelf adds the point itself", async () => {
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [1, 0, 0],
        [5, 0, 0],
      ],
      { radius: 1, includeSelf: true },
    );
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([2, 2, 1]);
  });

  it("averages a tuple-3 attribute — the neighbor centroid of P", async () => {
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      { radius: 1, averageAttr: "P", averageOutAttr: "nbrP" },
    );
    // 0 sees only 1; 1 sees 0 and 2 (centroid 1); 2 sees only 1.
    expect(attrTuples(geo, "nbrP")).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]);
    // P itself is untouched.
    expect(attrTuples(geo, "P")).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("a point with no neighbors keeps its own value as the average", async () => {
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [50, 0, 0],
      ],
      { radius: 1, averageAttr: "P", averageOutAttr: "nbrP" },
    );
    // Own position, so (P - nbrP) is exactly zero and a relaxation step
    // moves an isolated point nowhere.
    expect(attrTuples(geo, "nbrP")).toEqual([
      [0, 0, 0],
      [50, 0, 0],
    ]);
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([0, 0]);
  });

  it("averaging into the source attribute's own name works in place", async () => {
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      { radius: 1, averageAttr: "P", averageOutAttr: "P", countAttr: "" },
    );
    expect(attrTuples(geo, "P")).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]);
  });

  it("maxCount keeps the NEAREST neighbors, ties to the lower index", async () => {
    // 0 at the origin; 1 and 2 at distance 1 (tie); 3 at distance 2.
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 2, 0],
      ],
      { radius: 5, maxCount: 2, averageAttr: "P", averageOutAttr: "nbrP" },
    );
    // Point 0's two nearest are 1 and 2 (the tie resolves before 3 either
    // way), whose centroid is the origin — not (1/3, 2/3, 0), which is what
    // averaging all three would give.
    expect(attrTuples(geo, "nbrP")[0]).toEqual([0, 0, 0]);
    expect(attrTuples(geo, "nbrCount").flat()[0]).toBe(2);
  });

  it("a capped average accumulates in point-index order, not in distance order", async () => {
    // Float addition is order-dependent, so the two orders are separable
    // by construction: index order sums 1e16, -1e16, 1 (cancelling first,
    // keeping the 1), distance order sums 1, -1e16, 1e16 (losing it).
    const cloud = cloudAt([
      [0, 0, 0],
      [10, 0, 0],
      [3, 0, 0],
      [2, 0, 0],
      [1, 0, 0],
    ]);
    const v = cloud.attrs.point.add("v", "f32", 1, 0);
    v.data.set([0, 0, 1e16, -1e16, 1]);
    const geo = firstGeo(
      (
        await runNode(
          pointNeighborhood,
          { radius: 11, maxCount: 3, averageAttr: "v", averageOutAttr: "vAvg", countAttr: "" },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    // Point 0's nearest three are 4, 3, 2; averaged in index order that is
    // (1e16 - 1e16 + 1) / 3.
    expect(geo.attrs.point.require("vAvg").get(0)).toBeCloseTo(1 / 3, 6);
  });

  it("a capped average is byte-identical to the same neighbors uncapped", async () => {
    // 12 points; cap at exactly the number each one has, so the cap binds
    // (the sort path runs) without changing which neighbors are averaged.
    const positions = randomPositions(12, 21, 3);
    const uncapped = await runNeighborhood(positions, {
      radius: 4,
      averageAttr: "P",
      averageOutAttr: "nbrP",
    });
    const capped = await runNeighborhood(positions, {
      radius: 4,
      maxCount: 11,
      averageAttr: "P",
      averageOutAttr: "nbrP",
    });
    expect(snapshotGeometry(capped)).toEqual(snapshotGeometry(uncapped));
  });

  describe("permutation equivariance", () => {
    /** A cloud with distinct positions AND distinct per-point seeds. */
    function seededCloud(count: number, seed: number, extent = 4): ReturnType<typeof cloudAt> {
      const geo = cloudAt(randomPositions(count, seed, extent));
      const seeds = geo.attrs.point.require("seed");
      for (let i = 0; i < count; i++) seeds.set(i, hashCombine(0x5eed, i));
      return geo;
    }

    it("the capped neighbor SET does not depend on point order", async () => {
      // A lattice is nothing but distance ties, so the cap's tiebreak
      // decides every answer; keyed on index it moves under a shuffle.
      const lattice: number[][] = [];
      for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) lattice.push([x, 0, z]);
      const cloud = cloudAt(lattice);
      const order = shuffledOrder(lattice.length, 5);
      const run = (geo: ReturnType<typeof cloudAt>) =>
        runNode(
          pointNeighborhood,
          { radius: 2.5, maxCount: 3, averageAttr: "P", averageOutAttr: "nbrP" },
          { in: [makeGeometryItem(geo)] },
        );
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(snapshotGeometry(shuffled)).toEqual(snapshotGeometry(permutePoints(straight, order)));
    });

    it("the average does not depend on point order, even when addition is not associative", async () => {
      // Values chosen so summation order is observable: 1e16 and -1e16
      // cancel only if they meet before the small terms are lost.
      const cloud = seededCloud(80, 44);
      const v = cloud.attrs.point.add("v", "f32", 1, 0);
      for (let i = 0; i < 80; i++) v.set(i, i % 3 === 0 ? 1e16 : i % 3 === 1 ? -1e16 : 1);
      const order = shuffledOrder(80, 17);
      const run = (geo: ReturnType<typeof cloudAt>) =>
        runNode(
          pointNeighborhood,
          { radius: 2, averageAttr: "v", averageOutAttr: "vAvg" },
          { in: [makeGeometryItem(geo)] },
        );
      const straight = firstGeo((await run(cloud)).out);
      const shuffled = firstGeo((await run(permutePoints(cloud, order))).out);
      expect(snapshotGeometry(shuffled)).toEqual(snapshotGeometry(permutePoints(straight, order)));
    });
  });

  it("radius 0 gives every point an empty neighborhood", async () => {
    // Coincident points, so a radius-0 search that ran at all would find
    // them — and positions well away from the origin, so the own-value
    // fallback is distinguishable from a zero fill.
    const geo = await runNeighborhood(
      [
        [4, 5, 6],
        [4, 5, 6],
      ],
      { radius: 0, includeSelf: true, averageAttr: "P", averageOutAttr: "nbrP" },
    );
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([0, 0]);
    expect(attrTuples(geo, "nbrP")).toEqual([
      [4, 5, 6],
      [4, 5, 6],
    ]);
  });

  it("handles an empty cloud and a single point", async () => {
    const empty = await runNeighborhood([], { radius: 2, averageAttr: "P", averageOutAttr: "nbrP" });
    expect(empty.pointCount).toBe(0);
    expect(empty.attrs.point.has("nbrCount")).toBe(true);
    expect(empty.attrs.point.has("nbrP")).toBe(true);

    const single = await runNeighborhood([[3, 4, 5]], {
      radius: 2,
      averageAttr: "P",
      averageOutAttr: "nbrP",
    });
    expect(attrTuples(single, "nbrCount").flat()).toEqual([0]);
    expect(attrTuples(single, "nbrP")).toEqual([[3, 4, 5]]);
  });

  it("non-finite positions are nobody's neighbor and have none", async () => {
    const geo = await runNeighborhood(
      [
        [0, 0, 0],
        [0.5, 0, 0],
        [NaN, 0, 0],
        [Infinity, 0, 0],
      ],
      { radius: 1, averageAttr: "P", averageOutAttr: "nbrP" },
    );
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([1, 1, 0, 0]);
    // The bad points fall back to their own value, so the average of the
    // good ones is unaffected by them.
    expect(attrTuples(geo, "nbrP")[0]).toEqual([0.5, 0, 0]);
    expect(attrTuples(geo, "nbrP")[1]).toEqual([0, 0, 0]);
    expect(attrTuples(geo, "nbrP")[2][0]).toBeNaN();
  });

  it("agrees with a brute-force reference over random clouds", async () => {
    for (const [count, seed, radius] of [
      [40, 3, 2],
      [40, 4, 0.75],
      [120, 5, 1.5],
      [7, 6, 100],
    ] as const) {
      const positions = randomPositions(count, seed);
      for (const includeSelf of [false, true]) {
        const geo = await runNeighborhood(positions, {
          radius,
          includeSelf,
          averageAttr: "P",
          averageOutAttr: "nbrP",
        });
        const counts = attrTuples(geo, "nbrCount").flat();
        const means = attrTuples(geo, "nbrP");
        for (let i = 0; i < count; i++) {
          const nbr = bruteNeighbors(positions, i, radius, includeSelf);
          expect(counts[i], `count ${count}/${seed}/${radius}/${includeSelf} point ${i}`).toBe(
            nbr.length,
          );
          const expected = [0, 1, 2].map((k) =>
            nbr.length === 0
              ? positions[i][k]
              : nbr.reduce((s, j) => s + positions[j][k], 0) / nbr.length,
          );
          for (let k = 0; k < 3; k++) {
            expect(means[i][k]).toBeCloseTo(expected[k], 5);
          }
        }
      }
    }
  });

  it("is deterministic: the same input cooks to the same bytes twice", async () => {
    const positions = randomPositions(60, 11);
    const a = await runNeighborhood(positions, {
      radius: 2,
      averageAttr: "P",
      averageOutAttr: "nbrP",
    });
    const b = await runNeighborhood(positions, {
      radius: 2,
      averageAttr: "P",
      averageOutAttr: "nbrP",
    });
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
    // ... and does not depend on the node seed, which it never reads.
    const cloud = cloudAt(positions);
    const seeded = firstGeo(
      (
        await runNode(
          pointNeighborhood,
          { radius: 2, averageAttr: "P", averageOutAttr: "nbrP" },
          { in: [makeGeometryItem(cloud)] },
          987654,
        )
      ).out,
    );
    expect(snapshotGeometry(seeded)).toEqual(snapshotGeometry(a));
  });

  it("names the offender and the fix on misuse", async () => {
    const one = [makeGeometryItem(cloudAt([[0, 0, 0]]))];
    await expect(
      runNode(pointNeighborhood, { countAttr: "" }, { in: one }),
    ).rejects.toThrow(/nothing to write/);
    await expect(
      runNode(pointNeighborhood, { averageAttr: "P", averageOutAttr: "" }, { in: one }),
    ).rejects.toThrow(/averageOutAttr is empty/);
    await expect(
      runNode(pointNeighborhood, { averageAttr: "nope" }, { in: one }),
    ).rejects.toThrow(/"nope" not found; available: P, /);
    await expect(runNode(pointNeighborhood, {}, {})).rejects.toThrow(
      /input pin "in" has no geometry connected/,
    );
  });

  it("rejects a P that cannot hold a position", async () => {
    const geo = createPointCloud(2);
    geo.attrs.point.remove("P");
    geo.attrs.point.add("P", "f32", 2, 0);
    await expect(
      runNode(pointNeighborhood, { radius: 1 }, { in: [makeGeometryItem(geo)] }),
    ).rejects.toThrow(/tupleSize 2, but distances need x, y and z/);
  });

  it("refuses to DELETE an existing attribute of another shape, P included", async () => {
    // countAttr and averageOutAttr are REPORTING slots: the node picks the
    // shape (u32 tuple 1, f32 at averageAttr's tuple size), so an existing
    // column of another shape is not overwritten by `replace`, it is
    // dropped and re-added. `countAttr: "P"` therefore used to turn every
    // position into a neighbour count and return a geometry that still
    // cooked with the right point count and no positions left in it — the
    // plausible-looking cook, which is the worst thing this library can
    // produce. Same rule, same message shape as transferAttribute's
    // hitAttr / missCountAttr.
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    await expect(
      runNode(pointNeighborhood, { radius: 1, countAttr: "P" }, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(
      /pointNeighborhood: countAttr "P" already exists on the input's point domain as f32x3.*would DELETE.*nbrCount/s,
    );
    // The refusal costs nothing: it happens before any write, so the input
    // still holds its positions.
    expect(cloud.attrs.point.require("P").tupleSize).toBe(3);

    const tagged = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    tagged.attrs.point.add("tag", "i32", 1, -1).data.set([5, 6]);
    await expect(
      runNode(
        pointNeighborhood,
        { radius: 2, countAttr: "", averageAttr: "P", averageOutAttr: "tag" },
        { in: [makeGeometryItem(tagged)] },
      ),
    ).rejects.toThrow(
      /pointNeighborhood: averageOutAttr "tag" already exists on the input's point domain as i32.*written as f32x3.*would DELETE.*nbrAvg/s,
    );
  });

  it("still reuses and resets an existing column of the SAME shape", async () => {
    // The refusal must not widen into "never touch an existing name".
    // Re-running the node over its own output is the ordinary case, and
    // averaging an attribute into its own name (already asserted above)
    // depends on the same allowance.
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 0, 0],
      [50, 0, 0],
    ]);
    cloud.attrs.point.add("nbrCount", "u32", 1, 0).data.set([99, 99, 99]);
    const geo = firstGeo(
      (await runNode(pointNeighborhood, { radius: 1 }, { in: [makeGeometryItem(cloud)] })).out,
    ) as ReturnType<typeof createPointCloud>;
    // 99 was stale, not a starting value: the column describes THIS cook.
    expect(attrTuples(geo, "nbrCount").flat()).toEqual([1, 1, 0]);
  });
});

describe("sampleNearestPoint", () => {
  async function run(
    dst: readonly (readonly number[])[],
    src: readonly (readonly number[])[],
    params: Partial<SampleNearestPointParams> = {},
    prepare?: (source: ReturnType<typeof createPointCloud>) => void,
  ): Promise<ReturnType<typeof createPointCloud>> {
    const source = cloudAt(src);
    prepare?.(source);
    const out = await runNode(sampleNearestPoint, params, {
      in: [makeGeometryItem(cloudAt(dst))],
      source: [makeGeometryItem(source)],
    });
    return firstGeo(out.out) as ReturnType<typeof createPointCloud>;
  }

  it("writes the distance to the nearest source point", async () => {
    const geo = await run(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [
        [3, 0, 0],
        [-4, 0, 0],
      ],
    );
    expect(attrTuples(geo, "nearDist").flat()).toEqual([3, 7]);
  });

  it("writes the source index, resolving distance ties to the lowest", async () => {
    const geo = await run(
      [[0, 0, 0]],
      [
        [2, 0, 0],
        [-2, 0, 0],
      ],
      { indexAttr: "nearIdx" },
    );
    expect(attrTuples(geo, "nearIdx").flat()).toEqual([0]);
  });

  it("copies a source attribute, optionally renaming it", async () => {
    const geo = await run(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [
        [1, 0, 0],
        [9, 0, 0],
      ],
      { attribute: "tag", outAttribute: "nearTag" },
      (source) => {
        const tag = source.attrs.point.add("tag", "string", 1, "");
        tag.setString(0, "near");
        tag.setString(1, "far");
      },
    );
    const tag = geo.attrs.point.require("nearTag");
    expect([tag.getString(0), tag.getString(1)]).toEqual(["near", "far"]);
    expect(geo.attrs.point.has("tag")).toBe(false);
  });

  it("misses report Infinity, index -1, and leave a copied attribute alone", async () => {
    const geo = await run(
      [
        [0, 0, 0],
        [100, 0, 0],
      ],
      [[1, 0, 0]],
      { indexAttr: "nearIdx", attribute: "density", outAttribute: "srcDensity", maxDistance: 5 },
      (source) => {
        source.attrs.point.require("density").set(0, 0.25);
      },
    );
    expect(attrTuples(geo, "nearDist").flat()).toEqual([1, Infinity]);
    expect(attrTuples(geo, "nearIdx").flat()).toEqual([0, -1]);
    // The miss keeps the attribute default (the source column's default),
    // never a neighbor's value.
    expect(attrTuples(geo, "srcDensity").flat()).toEqual([0.25, 1]);
    // -1 is the column's DEFAULT too, not only the value written here: a
    // downstream filter carries defaults onto its survivors, so a later
    // resize must not manufacture a reference to source point 0.
    expect(geo.attrs.point.require("nearIdx").defaultValue).toEqual([-1]);
  });

  it("a miss keeps a value the destination attribute already held", async () => {
    const dst = cloudAt([
      [0, 0, 0],
      [100, 0, 0],
    ]);
    // The destination already carries `mark`; only the hit is overwritten.
    const mark = dst.attrs.point.add("mark", "f32", 1, -99);
    mark.data.set([7, 8]);
    const source = cloudAt([[1, 0, 0]]);
    source.attrs.point.add("mark", "f32", 1, -99).data.set([42]);
    const geo = firstGeo(
      (
        await runNode(
          sampleNearestPoint,
          { attribute: "mark", maxDistance: 5 },
          { in: [makeGeometryItem(dst)], source: [makeGeometryItem(source)] },
        )
      ).out,
    );
    expect(attrTuples(geo, "mark").flat()).toEqual([42, 8]);
  });

  it("an empty source makes every point a miss", async () => {
    const geo = await run(
      [
        [0, 0, 0],
        [1, 2, 3],
      ],
      [],
      { indexAttr: "nearIdx" },
    );
    expect(attrTuples(geo, "nearDist").flat()).toEqual([Infinity, Infinity]);
    expect(attrTuples(geo, "nearIdx").flat()).toEqual([-1, -1]);
  });

  it("an empty destination produces an empty cloud with the attributes present", async () => {
    const geo = await run([], [[0, 0, 0]], { indexAttr: "nearIdx" });
    expect(geo.pointCount).toBe(0);
    expect(geo.attrs.point.has("nearDist")).toBe(true);
    expect(geo.attrs.point.has("nearIdx")).toBe(true);
  });

  it("a non-finite destination position is a miss", async () => {
    const geo = await run([[NaN, 0, 0]], [[0, 0, 0]], { indexAttr: "nearIdx" });
    expect(attrTuples(geo, "nearDist").flat()).toEqual([Infinity]);
    expect(attrTuples(geo, "nearIdx").flat()).toEqual([-1]);
  });

  it("agrees with a brute-force reference over random clouds", async () => {
    for (const [nDst, nSrc, seed, maxDistance] of [
      [50, 30, 31, 0],
      [50, 30, 32, 2],
      [30, 1, 33, 0],
      [20, 200, 34, 0.5],
    ] as const) {
      const dst = randomPositions(nDst, seed);
      const src = randomPositions(nSrc, seed + 1000);
      const geo = await run(dst, src, { indexAttr: "nearIdx", maxDistance });
      const idx = attrTuples(geo, "nearIdx").flat();
      const dist = attrTuples(geo, "nearDist").flat();
      const limit = maxDistance > 0 ? maxDistance : Number.POSITIVE_INFINITY;
      for (let i = 0; i < nDst; i++) {
        const expected = bruteNearest(src, dst[i], limit);
        expect(idx[i], `${nDst}/${nSrc}/${seed}/${maxDistance} point ${i}`).toBe(expected);
        if (expected < 0) {
          expect(dist[i]).toBe(Infinity);
        } else {
          const d = Math.hypot(
            src[expected][0] - dst[i][0],
            src[expected][1] - dst[i][1],
            src[expected][2] - dst[i][2],
          );
          expect(dist[i]).toBeCloseTo(d, 5);
        }
      }
    }
  });

  it("is deterministic and seed-independent", async () => {
    const dst = randomPositions(40, 7);
    const src = randomPositions(25, 8);
    const a = await run(dst, src, { indexAttr: "nearIdx" });
    const b = await run(dst, src, { indexAttr: "nearIdx" });
    expect(snapshotGeometry(b)).toEqual(snapshotGeometry(a));
    const seeded = firstGeo(
      (
        await runNode(
          sampleNearestPoint,
          { indexAttr: "nearIdx" },
          { in: [makeGeometryItem(cloudAt(dst))], source: [makeGeometryItem(cloudAt(src))] },
          424242,
        )
      ).out,
    );
    expect(snapshotGeometry(seeded)).toEqual(snapshotGeometry(a));
  });

  it("names the offender and the fix on misuse", async () => {
    const one = [makeGeometryItem(cloudAt([[0, 0, 0]]))];
    await expect(
      runNode(sampleNearestPoint, { distanceAttr: "" }, { in: one, source: one }),
    ).rejects.toThrow(/nothing to write/);
    await expect(
      runNode(sampleNearestPoint, { attribute: "nope" }, { in: one, source: one }),
    ).rejects.toThrow(/"nope" not found on the source geometry; available: P, /);
    await expect(runNode(sampleNearestPoint, {}, { in: one })).rejects.toThrow(
      /input pin "source" has no geometry connected/,
    );
  });

  it("refuses to DELETE an existing attribute of another shape, P included", async () => {
    // distanceAttr and indexAttr are the same REPORTING slots as
    // pointNeighborhood's: f32 tuple 1 and i32 tuple 1, both chosen by the
    // node. `outAttribute` is deliberately NOT in this rule — its shape
    // comes from the source attribute being copied and overwriting is what
    // a copy IS, exactly as transferAttribute's `name` is exempt there.
    const dst = cloudAt([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    const source = [makeGeometryItem(cloudAt([[3, 0, 0]]))];
    await expect(
      runNode(
        sampleNearestPoint,
        { distanceAttr: "P" },
        { in: [makeGeometryItem(dst)], source },
      ),
    ).rejects.toThrow(
      /sampleNearestPoint: distanceAttr "P" already exists on the input's point domain as f32x3.*would DELETE.*nearDist/s,
    );
    expect(dst.attrs.point.require("P").tupleSize).toBe(3);

    const uvDst = cloudAt([[0, 0, 0]]);
    uvDst.attrs.point.add("uv", "f32", 2, 0).data.set([0.25, 0.5]);
    await expect(
      runNode(
        sampleNearestPoint,
        { distanceAttr: "", indexAttr: "uv" },
        { in: [makeGeometryItem(uvDst)], source },
      ),
    ).rejects.toThrow(
      /sampleNearestPoint: indexAttr "uv" already exists on the input's point domain as f32x2.*written as i32.*would DELETE.*nearIndex/s,
    );
  });

  it("still reuses and resets an existing column of the SAME shape", async () => {
    const dst = cloudAt([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    dst.attrs.point.add("nearDist", "f32", 1, 0).data.set([99, 99]);
    dst.attrs.point.add("nearIdx", "i32", 1, -1).data.set([7, 7]);
    const geo = firstGeo(
      (
        await runNode(
          sampleNearestPoint,
          { indexAttr: "nearIdx" },
          {
            in: [makeGeometryItem(dst)],
            source: [makeGeometryItem(cloudAt([[3, 0, 0]]))],
          },
        )
      ).out,
    ) as ReturnType<typeof createPointCloud>;
    expect(attrTuples(geo, "nearDist").flat()).toEqual([3, 7]);
    expect(attrTuples(geo, "nearIdx").flat()).toEqual([0, 0]);
  });
});
