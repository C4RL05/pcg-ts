import { describe, expect, it } from "vitest";
import { UniformGrid, type PositionView } from "./index.js";

/** Deterministic PRNG for the property cases (never Math.random). */
function lcg(seed: number): () => number {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pack positions into an f32 SoA view, optionally with padding per point. */
function view(pts: readonly (readonly number[])[], stride = 3): PositionView {
  const data = new Float32Array(pts.length * stride);
  pts.forEach((p, i) => {
    data[i * stride] = p[0];
    data[i * stride + 1] = p[1];
    data[i * stride + 2] = p[2];
  });
  return { data, stride, count: pts.length };
}

/**
 * Brute-force references. They read through the same view with the same
 * expression order as the grid, so any disagreement is a search bug and
 * never a floating-point difference.
 */
function refRadius(v: PositionView, x: number, y: number, z: number, r: number): number[] {
  const limit = r * r;
  const out: number[] = [];
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    const dx = v.data[o] - x;
    const dy = v.data[o + 1] - y;
    const dz = v.data[o + 2] - z;
    if (dx * dx + dy * dy + dz * dz <= limit) out.push(i);
  }
  return out;
}

function refCloser(v: PositionView, x: number, y: number, z: number, d: number): boolean {
  const limit = d * d;
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    const dx = v.data[o] - x;
    const dy = v.data[o + 1] - y;
    const dz = v.data[o + 2] - z;
    if (dx * dx + dy * dy + dz * dz < limit) return true;
  }
  return false;
}

function refNearest(
  v: PositionView,
  x: number,
  y: number,
  z: number,
  maxRadius = Number.POSITIVE_INFINITY,
): number {
  const limit = maxRadius * maxRadius;
  let best = Number.POSITIVE_INFINITY;
  let bestIdx = -1;
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    const dx = v.data[o] - x;
    const dy = v.data[o + 1] - y;
    const dz = v.data[o + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 <= limit)) continue;
    if (bestIdx < 0 || d2 < best) {
      best = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** The greedy `selfPrune` decides, written the slow, obvious way. */
function refGreedy(v: PositionView, minDistance: number): number[] {
  const kept: number[] = [];
  const limit = minDistance * minDistance;
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    let ok = true;
    for (const j of kept) {
      const p = j * v.stride;
      const dx = v.data[p] - v.data[o];
      const dy = v.data[p + 1] - v.data[o + 1];
      const dz = v.data[p + 2] - v.data[o + 2];
      if (dx * dx + dy * dy + dz * dz < limit) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(i);
  }
  return kept;
}

function gridGreedy(v: PositionView, minDistance: number): number[] {
  const grid = new UniformGrid(v, minDistance);
  const kept: number[] = [];
  for (let i = 0; i < v.count; i++) {
    const o = i * v.stride;
    if (grid.hasPointCloserThan(v.data[o], v.data[o + 1], v.data[o + 2], minDistance)) continue;
    kept.push(i);
    grid.insert(i);
  }
  return kept;
}

function randomCloud(n: number, seed: number, lo: number, hi: number): PositionView {
  const r = lcg(seed);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    pts.push([lo + r() * (hi - lo), lo + r() * (hi - lo), lo + r() * (hi - lo)]);
  }
  return view(pts);
}

const UNIT_LINE = view([
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
]);

describe("UniformGrid construction", () => {
  it("rejects a non-positive or NaN cell size, naming the fix", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => new UniformGrid(UNIT_LINE, bad)).toThrow(
        /cellSize must be a positive number.*query radius/s,
      );
    }
    // Degenerate but legal: an infinite cell puts every finite point in one
    // bucket, which is what a minimum distance of Infinity means.
    expect(() => new UniformGrid(UNIT_LINE, Number.POSITIVE_INFINITY)).not.toThrow();
  });

  it("rejects a view that cannot hold xyz", () => {
    expect(() => new UniformGrid({ data: new Float32Array(4), stride: 2, count: 2 }, 1)).toThrow(
      /stride must be >= 3/,
    );
    expect(() => new UniformGrid({ data: new Float32Array(0), stride: 3, count: -1 }, 1)).toThrow(
      /count must be >= 0/,
    );
  });

  it("build indexes every point; a bare grid indexes none", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.size).toBe(4);
    expect(grid.cellCount).toBe(4);
    expect(new UniformGrid(UNIT_LINE, 1).size).toBe(0);
    expect(UniformGrid.build(view([]), 1).size).toBe(0);
  });

  it("rejects an index that is not a point of the view", () => {
    const grid = new UniformGrid(UNIT_LINE, 1);
    for (const bad of [-1, 4, 1.5, Number.NaN]) {
      expect(() => grid.insert(bad)).toThrow(/is not a point of the view/);
    }
  });

  it("indexes through the stride, so padded position tuples work", () => {
    const padded = view(
      [
        [0, 0, 0],
        [5, 5, 5],
      ],
      4,
    );
    const grid = UniformGrid.build(padded, 1);
    expect(grid.queryRadius(5, 5, 5, 0.5)).toEqual([1]);
    expect(grid.nearest(4.9, 5, 5)).toBe(1);
  });

  it("shares one cell for coincident points and counts them once", () => {
    const grid = UniformGrid.build(
      view([
        [2, 2, 2],
        [2, 2, 2],
        [2, 2, 2],
      ]),
      1,
    );
    expect(grid.size).toBe(3);
    expect(grid.cellCount).toBe(1);
    expect(grid.queryRadius(2, 2, 2, 0)).toEqual([0, 1, 2]);
  });
});

describe("UniformGrid cell mapping", () => {
  it("floors the scaled coordinate, so cells are half-open [k, k+1)", () => {
    const grid = new UniformGrid(UNIT_LINE, 2);
    expect(grid.inverseCellSize).toBe(0.5);
    expect(grid.cellCoordOf(0)).toBe(0);
    expect(grid.cellCoordOf(1.999)).toBe(0);
    expect(grid.cellCoordOf(2)).toBe(1); // boundary belongs to the upper cell
    expect(grid.cellCoordOf(-0.001)).toBe(-1);
    expect(grid.cellCoordOf(-2)).toBe(-1);
    expect(grid.cellCoordOf(-2.001)).toBe(-2);
  });

  it("puts -0 and 0 in the same cell", () => {
    const grid = UniformGrid.build(
      view([
        [0, 0, 0],
        [-0, -0, -0],
      ]),
      1,
    );
    expect(grid.cellCount).toBe(1);
    expect(grid.queryRadius(0, 0, 0, 0)).toEqual([0, 1]);
  });

  it("cellRadiusFor covers the distance in whole cells", () => {
    const grid = new UniformGrid(UNIT_LINE, 2);
    expect(grid.cellRadiusFor(0)).toBe(0);
    expect(grid.cellRadiusFor(-1)).toBe(0);
    expect(grid.cellRadiusFor(Number.NaN)).toBe(0);
    expect(grid.cellRadiusFor(0.5)).toBe(1);
    expect(grid.cellRadiusFor(2)).toBe(1); // exactly one cell
    expect(grid.cellRadiusFor(2.0001)).toBe(2);
    expect(grid.cellRadiusFor(4)).toBe(2);
    expect(grid.cellRadiusFor(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    // An infinite cell size is one bucket: a matching distance is one ring,
    // even though the ratio Infinity / Infinity is NaN.
    expect(new UniformGrid(UNIT_LINE, Number.POSITIVE_INFINITY).cellRadiusFor(
      Number.POSITIVE_INFINITY,
    )).toBe(1);
  });
});

describe("UniformGrid.hasPointCloserThan", () => {
  it("is strict at the boundary: exactly `distance` away is not closer", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.hasPointCloserThan(1, 0, 0, 1)).toBe(true); // coincident
    expect(grid.hasPointCloserThan(0.5, 0, 0, 0.5)).toBe(false); // exactly 0.5 to both
    expect(grid.hasPointCloserThan(0.5, 0, 0, 0.5000001)).toBe(true);
    expect(grid.hasPointCloserThan(1.5, 0, 0, 0.5)).toBe(false);
  });

  it("finds neighbours across cell boundaries in every direction", () => {
    const grid = UniformGrid.build(view([[0.99, 0.99, 0.99]]), 1);
    // Query sits in cell (1,1,1); the point is in cell (0,0,0).
    expect(grid.cellCoordOf(1.01)).toBe(1);
    expect(grid.hasPointCloserThan(1.01, 1.01, 1.01, 0.1)).toBe(true);
    // Same across a negative boundary.
    const neg = UniformGrid.build(view([[-0.01, -0.01, -0.01]]), 1);
    expect(neg.hasPointCloserThan(0.01, 0.01, 0.01, 0.1)).toBe(true);
  });

  it("is false for an empty grid, a non-positive distance, and NaN", () => {
    const empty = new UniformGrid(UNIT_LINE, 1);
    expect(empty.hasPointCloserThan(0, 0, 0, 10)).toBe(false);
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.hasPointCloserThan(0, 0, 0, 0)).toBe(false);
    expect(grid.hasPointCloserThan(0, 0, 0, -1)).toBe(false);
    expect(grid.hasPointCloserThan(0, 0, 0, Number.NaN)).toBe(false);
    expect(grid.hasPointCloserThan(Number.NaN, 0, 0, 1)).toBe(false);
  });

  it("scans beyond one ring when the distance exceeds the cell size", () => {
    const grid = UniformGrid.build(view([[0, 0, 0]]), 0.1);
    expect(grid.hasPointCloserThan(0.55, 0, 0, 0.6)).toBe(true); // 6 rings away
    expect(grid.hasPointCloserThan(0.55, 0, 0, 0.5)).toBe(false);
  });

  it("stays strict at the boundary on the wide-scan path too", () => {
    // A cell size far below the distance makes the ring block outgrow the
    // occupied cells, which switches the scan to every occupied cell. Both
    // paths must answer identically, boundary included.
    const v = view([[1, 0, 0]]);
    const wide = UniformGrid.build(v, 0.01); // 100 rings -> whole-grid scan
    const tight = UniformGrid.build(v, 1); // one ring
    for (const grid of [wide, tight]) {
      expect(grid.hasPointCloserThan(0, 0, 0, 1)).toBe(false); // exactly 1 away
      expect(grid.hasPointCloserThan(0, 0, 0, 1.0000001)).toBe(true);
      expect(grid.queryRadius(0, 0, 0, 1)).toEqual([0]); // inclusive
      expect(grid.queryRadius(0, 0, 0, 0.9999999)).toEqual([]);
    }
  });

  it("answers when the radius overflows the ring count", () => {
    // radius / cellSize is Infinity here: the ring walk cannot be expressed,
    // so the query has to fall back to scanning the occupied cells.
    const v = view([
      [0, 0, 0],
      [1e120, 0, 0],
      [-3, 4, 0],
    ]);
    const grid = UniformGrid.build(v, 1e-300);
    expect(grid.cellRadiusFor(1e300)).toBe(Number.POSITIVE_INFINITY);
    expect(grid.queryRadius(0, 0, 0, 1e300)).toEqual([0, 1, 2]);
    expect(grid.queryRadius(0, 0, 0, 4)).toEqual([0]);
    expect(grid.hasPointCloserThan(0, 0, 0, 1e300)).toBe(true);
    expect(grid.hasPointCloserThan(0, 0, 0, 5)).toBe(true); // (-3, 4, 0) at 5
    expect(grid.hasPointCloserThan(-3, 4, 0, 5)).toBe(true); // itself
    expect(grid.hasPointCloserThan(-3, 4, 0.5, 0.4)).toBe(false);
  });
});

describe("UniformGrid.queryRadius", () => {
  it("includes the boundary and returns ascending indices", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.queryRadius(1.5, 0, 0, 0.5)).toEqual([1, 2]);
    expect(grid.queryRadius(1.5, 0, 0, 0.4999999)).toEqual([]);
    expect(grid.queryRadius(0, 0, 0, 10)).toEqual([0, 1, 2, 3]);
  });

  it("orders by index, not by insertion or by cell", () => {
    const v = view([
      [3, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
      [1, 0, 0],
    ]);
    const forward = UniformGrid.build(v, 1);
    const backward = new UniformGrid(v, 1);
    for (let i = v.count - 1; i >= 0; i--) backward.insert(i);
    expect(forward.queryRadius(1.5, 0, 0, 10)).toEqual([0, 1, 2, 3]);
    expect(backward.queryRadius(1.5, 0, 0, 10)).toEqual([0, 1, 2, 3]);
  });

  it("reuses the output array and clears it first", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    const out: number[] = [99, 98];
    const same = grid.queryRadius(0, 0, 0, 0.5, out);
    expect(same).toBe(out);
    expect(out).toEqual([0]);
    grid.queryRadius(100, 0, 0, 0.5, out);
    expect(out).toEqual([]);
  });

  it("returns nothing for a negative or NaN radius, and only coincident points for 0", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.queryRadius(0, 0, 0, -1)).toEqual([]);
    expect(grid.queryRadius(0, 0, 0, Number.NaN)).toEqual([]);
    expect(grid.queryRadius(0, 0, 0, 0)).toEqual([0]);
    expect(grid.queryRadius(0.5, 0, 0, 0)).toEqual([]);
  });

  it("never returns a non-finite point, and never matches a non-finite query", () => {
    const v = view([
      [0, 0, 0],
      [Number.NaN, 0, 0],
      [Number.POSITIVE_INFINITY, 0, 0],
      [Number.NEGATIVE_INFINITY, 0, 0],
      [0.1, 0, 0],
    ]);
    const grid = UniformGrid.build(v, 1);
    expect(grid.size).toBe(5);
    expect(grid.queryRadius(0, 0, 0, 1e30)).toEqual([0, 4]);
    expect(grid.queryRadius(Number.NaN, 0, 0, 1e30)).toEqual([]);
    expect(grid.queryRadius(Number.POSITIVE_INFINITY, 0, 0, 1e30)).toEqual([]);
    expect(grid.nearest(Number.POSITIVE_INFINITY, 0, 0)).toBe(-1);
  });
});

describe("UniformGrid.nearest", () => {
  it("finds the nearest point and breaks ties toward the lowest index", () => {
    const grid = UniformGrid.build(
      view([
        [1, 0, 0],
        [-1, 0, 0],
        [-1, 0, 0],
        [1, 0, 0],
      ]),
      1,
    );
    expect(grid.nearest(0.9, 0, 0)).toBe(0);
    expect(grid.nearest(0, 0, 0)).toBe(0); // all four at distance 1
    expect(grid.nearest(-0.9, 0, 0)).toBe(1);
  });

  it("honours maxRadius inclusively", () => {
    const grid = UniformGrid.build(UNIT_LINE, 1);
    expect(grid.nearest(10, 0, 0)).toBe(3);
    expect(grid.nearest(10, 0, 0, 7)).toBe(3);
    expect(grid.nearest(10, 0, 0, 6.9999)).toBe(-1);
    expect(grid.nearest(0, 0, 0, 0)).toBe(0);
    expect(grid.nearest(0.5, 0, 0, 0)).toBe(-1);
    expect(grid.nearest(0, 0, 0, -1)).toBe(-1);
    expect(grid.nearest(0, 0, 0, Number.NaN)).toBe(-1);
  });

  it("returns -1 when nothing is indexed or nothing is finite", () => {
    expect(new UniformGrid(UNIT_LINE, 1).nearest(0, 0, 0)).toBe(-1);
    const nonFinite = UniformGrid.build(
      view([
        [Number.NaN, 0, 0],
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0],
      ]),
      1,
    );
    expect(nonFinite.nearest(0, 0, 0)).toBe(-1);
    expect(nonFinite.nearest(Number.NaN, 0, 0)).toBe(-1);
  });

  it("terminates on far-away and huge-magnitude queries", () => {
    const v = view([
      [0, 0, 0],
      [1e12, 1e12, 1e12],
    ]);
    const grid = UniformGrid.build(v, 1e-3);
    expect(grid.nearest(-1e15, 0, 0)).toBe(0);
    expect(grid.nearest(1e12 - 1, 1e12, 1e12)).toBe(1);
    // At 1e300 both squared distances overflow to Infinity, so the answer is
    // decided by the tie rule (lowest index) — and matches brute force.
    expect(grid.nearest(1e300, 1e300, 1e300)).toBe(refNearest(v, 1e300, 1e300, 1e300));
    expect(grid.nearest(1e300, 1e300, 1e300)).toBe(0);
  });

  it("skips non-finite points when the shell walk hands over to the full scan", () => {
    // The shell walk only ever visits finite cells, so a NaN position can
    // only surface on the full-scan path — where a NaN distance must lose to
    // every real candidate instead of being taken as the first one seen.
    const v = view([
      [Number.NaN, 0, 0], // first bucket the full scan meets
      [0, 0, 0],
      [1e6, 0, 0],
      [0.5, 0, 0],
      [Number.POSITIVE_INFINITY, Number.NaN, 0],
    ]);
    // A cell size this fine puts the two clusters ~1e10 cells apart, so a
    // query between them exhausts the shell budget and hands over.
    const grid = UniformGrid.build(v, 1e-4);
    expect(grid.nearest(2e5, 0, 0)).toBe(refNearest(v, 2e5, 0, 0));
    expect(grid.nearest(2e5, 0, 0)).toBe(3);
    expect(grid.nearest(2e5, 0, 0, 1e9)).toBe(3);
    expect(grid.nearest(2e5, 0, 0, 10)).toBe(-1);
  });

  it("agrees with the full scan when the shell walk is abandoned", () => {
    // Two distant clusters at a fine cell size: the shell walk between them
    // runs out of budget and hands over to the full scan.
    const pts: number[][] = [];
    const r = lcg(5);
    for (let i = 0; i < 200; i++) pts.push([r(), r(), r()]);
    for (let i = 0; i < 200; i++) pts.push([1e6 + r(), r(), r()]);
    const v = view(pts);
    const fine = UniformGrid.build(v, 1e-4);
    const coarse = UniformGrid.build(v, 0.5);
    for (const q of [
      [5e5, 0.5, 0.5],
      [-1e5, 0, 0],
      [1e6 + 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ]) {
      const expected = refNearest(v, q[0], q[1], q[2]);
      expect(fine.nearest(q[0], q[1], q[2])).toBe(expected);
      expect(coarse.nearest(q[0], q[1], q[2])).toBe(expected);
    }
  });
});

describe("UniformGrid determinism and reuse", () => {
  it("queries never mutate the grid, so one build serves many callers", () => {
    const v = randomCloud(300, 3, -5, 5);
    const grid = UniformGrid.build(v, 0.5);
    const before = { size: grid.size, cells: grid.cellCount };
    const first = grid.queryRadius(0, 0, 0, 1.25);
    const nearest = grid.nearest(0, 0, 0);
    for (let i = 0; i < 5; i++) {
      expect(grid.queryRadius(0, 0, 0, 1.25)).toEqual(first);
      expect(grid.nearest(0, 0, 0)).toBe(nearest);
    }
    expect({ size: grid.size, cells: grid.cellCount }).toEqual(before);
  });

  it("two grids built the same way answer identically", () => {
    const v = randomCloud(400, 9, 0, 3);
    const a = UniformGrid.build(v, 0.31);
    const b = UniformGrid.build(v, 0.31);
    const r = lcg(77);
    for (let i = 0; i < 200; i++) {
      const q = [r() * 3, r() * 3, r() * 3];
      expect(a.queryRadius(q[0], q[1], q[2], 0.4)).toEqual(b.queryRadius(q[0], q[1], q[2], 0.4));
      expect(a.nearest(q[0], q[1], q[2])).toBe(b.nearest(q[0], q[1], q[2]));
    }
  });

  it("insertion order changes nothing an observer can see", () => {
    const v = randomCloud(250, 4, -2, 2);
    const forward = UniformGrid.build(v, 0.4);
    const backward = new UniformGrid(v, 0.4);
    for (let i = v.count - 1; i >= 0; i--) backward.insert(i);
    const shuffled = new UniformGrid(v, 0.4);
    const order = [...Array(v.count).keys()].sort(
      (a, b) => ((a * 7919) % 251) - ((b * 7919) % 251),
    );
    for (const i of order) shuffled.insert(i);
    const r = lcg(31);
    for (let i = 0; i < 150; i++) {
      const q = [-2 + r() * 4, -2 + r() * 4, -2 + r() * 4];
      const expected = forward.queryRadius(q[0], q[1], q[2], 0.6);
      expect(backward.queryRadius(q[0], q[1], q[2], 0.6)).toEqual(expected);
      expect(shuffled.queryRadius(q[0], q[1], q[2], 0.6)).toEqual(expected);
      const near = forward.nearest(q[0], q[1], q[2]);
      expect(backward.nearest(q[0], q[1], q[2])).toBe(near);
      expect(shuffled.nearest(q[0], q[1], q[2])).toBe(near);
    }
  });
});

describe("UniformGrid cell-size neutrality", () => {
  /**
   * Phase 13's audit found a nearest-point bug that only appeared at some
   * grid resolutions (a sliver triangle sharing a bucket with the query at
   * one cell size and not at another). The invariant that catches that class
   * of bug is that the answer must not depend on the cell size, so these
   * cases sweep it across four orders of magnitude — including sizes far
   * below and far above the query radius, which switch the scan between the
   * shell walk and the full scan.
   */
  const CELL_SIZES = [0.01, 0.1, 0.37, 1, 2.5, 10, 1000];

  it("radius and nearest answers are identical at every cell size", () => {
    const v = randomCloud(500, 17, -6, 6);
    const r = lcg(18);
    const queries: number[][] = [];
    for (let i = 0; i < 60; i++) queries.push([-7 + r() * 14, -7 + r() * 14, -7 + r() * 14]);
    // Queries that land exactly on cell boundaries for several sizes.
    for (const c of [0.1, 1, 2.5]) queries.push([c, c * 2, -c], [c * 3, -c * 4, c * 5]);
    for (const q of queries) {
      for (const radius of [0.001, 0.5, 3]) {
        const expected = refRadius(v, q[0], q[1], q[2], radius);
        const expectedNear = refNearest(v, q[0], q[1], q[2]);
        for (const cell of CELL_SIZES) {
          const grid = UniformGrid.build(v, cell);
          expect(grid.queryRadius(q[0], q[1], q[2], radius), `cell ${cell}`).toEqual(expected);
          expect(grid.nearest(q[0], q[1], q[2]), `cell ${cell}`).toBe(expectedNear);
        }
      }
    }
  });

  it("points sitting exactly on cell boundaries are still found", () => {
    // Every coordinate is an exact multiple of several candidate cell sizes,
    // so points straddle bucket walls at each of them.
    const pts: number[][] = [];
    for (let i = -3; i <= 3; i++) pts.push([i, i * 0.5, -i * 2], [i + 0.5, i, i * 0.25]);
    const v = view(pts);
    for (const cell of [0.25, 0.5, 1, 2, 4]) {
      const grid = UniformGrid.build(v, cell);
      for (let i = 0; i < v.count; i++) {
        const o = i * v.stride;
        const x = v.data[o];
        const y = v.data[o + 1];
        const z = v.data[o + 2];
        // A point always finds itself, at radius 0 and at any radius.
        expect(grid.queryRadius(x, y, z, 0), `cell ${cell} point ${i}`).toContain(i);
        expect(grid.nearest(x, y, z), `cell ${cell} point ${i}`).toBe(
          refNearest(v, x, y, z),
        );
        expect(grid.queryRadius(x, y, z, 1.5), `cell ${cell} point ${i}`).toEqual(
          refRadius(v, x, y, z, 1.5),
        );
      }
    }
  });

  it("degenerate clouds behave the same at every cell size", () => {
    const clouds: Record<string, PositionView> = {
      identical: view(Array.from({ length: 40 }, () => [1.5, -2.5, 3.5])),
      collinear: view(Array.from({ length: 40 }, (_, i) => [i * 0.1, 0, 0])),
      coplanar: view(Array.from({ length: 40 }, (_, i) => [Math.cos(i), 0, Math.sin(i)])),
      twoFarClusters: view([
        ...Array.from({ length: 20 }, (_, i) => [i * 0.01, 0, 0]),
        ...Array.from({ length: 20 }, (_, i) => [1e5 + i * 0.01, 0, 0]),
      ]),
      negative: view(Array.from({ length: 40 }, (_, i) => [-i * 0.3, -i * 0.1, -1])),
    };
    const queries = [
      [0, 0, 0],
      [1.5, -2.5, 3.5],
      [-1, -1, -1],
      [0.55, 0, 0],
      [5e4, 0, 0],
    ];
    for (const [name, v] of Object.entries(clouds)) {
      for (const q of queries) {
        const expectedNear = refNearest(v, q[0], q[1], q[2]);
        const expectedRadius = refRadius(v, q[0], q[1], q[2], 0.35);
        for (const cell of [0.05, 0.35, 7, 1e6]) {
          const grid = UniformGrid.build(v, cell);
          expect(grid.nearest(q[0], q[1], q[2]), `${name} cell ${cell}`).toBe(expectedNear);
          expect(grid.queryRadius(q[0], q[1], q[2], 0.35), `${name} cell ${cell}`).toEqual(
            expectedRadius,
          );
        }
      }
    }
  });
});

describe("UniformGrid agrees with brute force", () => {
  it("over random clouds, radii, and cell sizes", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const n = 40 + seed * 60;
      const v = randomCloud(n, seed, -4, 4);
      const q = lcg(seed * 101);
      // 1/3, 0.1 and 3 have inexact reciprocals, so `v * (1 / cellSize)`
      // rounds near cell walls — the arithmetic most likely to misplace a
      // point by a cell.
      for (const cell of [0.15, 0.8, 3, 1 / 3, 0.1]) {
        const grid = UniformGrid.build(v, cell);
        for (let i = 0; i < 60; i++) {
          // Half the queries sit exactly on an indexed point, which is where
          // ties and zero distances live.
          const onPoint = i % 2 === 0;
          const idx = Math.min(v.count - 1, Math.floor(q() * v.count));
          const o = idx * v.stride;
          const x = onPoint ? v.data[o] : -5 + q() * 10;
          const y = onPoint ? v.data[o + 1] : -5 + q() * 10;
          const z = onPoint ? v.data[o + 2] : -5 + q() * 10;
          for (const radius of [0, 0.2, 0.9, 2.5]) {
            expect(grid.queryRadius(x, y, z, radius)).toEqual(refRadius(v, x, y, z, radius));
            expect(grid.hasPointCloserThan(x, y, z, radius)).toBe(refCloser(v, x, y, z, radius));
          }
          expect(grid.nearest(x, y, z)).toBe(refNearest(v, x, y, z));
          expect(grid.nearest(x, y, z, 0.5)).toBe(refNearest(v, x, y, z, 0.5));
        }
      }
    }
  });

  it("over lattices whose spacing lands exactly on cell walls", () => {
    // Exact ties everywhere (a lattice point has 6 neighbours at the same
    // distance) and every coordinate a multiple of the cell size, so the
    // nearest tie rule and the shell cutoff are exercised at the boundary.
    const pts: number[][] = [];
    for (let x = -2; x <= 2; x++)
      for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) pts.push([x, y, z]);
    const v = view(pts);
    const queries: number[][] = [];
    for (const p of pts) queries.push(p, [p[0] + 0.5, p[1], p[2]], [p[0], p[1] + 0.5, p[2] - 0.5]);
    for (const cell of [1, 2, 3, 0.5, 1 / 3, 0.1, 7]) {
      const grid = UniformGrid.build(v, cell);
      for (const q of queries) {
        expect(grid.nearest(q[0], q[1], q[2]), `cell ${cell} at ${q}`).toBe(
          refNearest(v, q[0], q[1], q[2]),
        );
        for (const radius of [1, 2, 1.4142135623730951]) {
          expect(grid.queryRadius(q[0], q[1], q[2], radius), `cell ${cell} at ${q}`).toEqual(
            refRadius(v, q[0], q[1], q[2], radius),
          );
        }
      }
    }
  });

  it("reproduces the greedy minimum-distance scan exactly", () => {
    // `selfPrune`'s contract, checked against the O(n^2) definition: same
    // survivors, same order, for clouds that cluster, collide, and tie.
    const clouds: Record<string, PositionView> = {
      uniform: randomCloud(600, 21, 0, 6),
      dense: randomCloud(600, 22, 0, 1),
      grid: view(
        Array.from({ length: 512 }, (_, i) => [i % 8, Math.floor(i / 8) % 8, Math.floor(i / 64)]),
      ),
      identical: view(Array.from({ length: 50 }, () => [0.25, 0.25, 0.25])),
      collinear: view(Array.from({ length: 200 }, (_, i) => [i * 0.05, 0, 0])),
      negative: randomCloud(300, 23, -3, 0),
    };
    for (const [name, v] of Object.entries(clouds)) {
      for (const minDistance of [0.05, 0.1, 0.5, 1, 1.0000001, 2]) {
        expect(gridGreedy(v, minDistance), `${name} @ ${minDistance}`).toEqual(
          refGreedy(v, minDistance),
        );
      }
    }
  });
});
