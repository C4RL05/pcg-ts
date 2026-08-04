import { describe, expect, it } from "vitest";
import type { Geometry } from "./geometry.js";
import { createPointCloud } from "./points.js";
import { transferNearest } from "./transfer.js";

/** Tiny deterministic LCG in [0, 1); no Math.random anywhere. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Point cloud with LCG positions in [min, max)^3 and seed attr = index. */
function seededCloud(count: number, seed: number, min: number, max: number): Geometry {
  const geo = createPointCloud(count);
  const rand = makeLcg(seed);
  const P = geo.attrs.point.require("P").data as Float32Array;
  const idx = geo.attrs.point.require("seed").data as Uint32Array;
  for (let i = 0; i < count; i++) {
    P[i * 3] = min + rand() * (max - min);
    P[i * 3 + 1] = min + rand() * (max - min);
    P[i * 3 + 2] = min + rand() * (max - min);
    idx[i] = i;
  }
  return geo;
}

/**
 * Reference nearest-neighbor indices by exhaustive scan, mirroring the
 * documented policy: lowest index wins ties, non-finite source points are
 * never candidates, non-finite queries map to source index 0.
 */
function bruteNearest(src: Geometry, dst: Geometry): number[] {
  const sp = src.attrs.point.require("P").data as Float32Array;
  const dp = dst.attrs.point.require("P").data as Float32Array;
  const ns = src.attrs.point.count;
  const nd = dst.attrs.point.count;
  const result: number[] = [];
  for (let j = 0; j < nd; j++) {
    const qx = dp[j * 3];
    const qy = dp[j * 3 + 1];
    const qz = dp[j * 3 + 2];
    if (!Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz)) {
      result.push(0);
      continue;
    }
    let best = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < ns; i++) {
      const sx = sp[i * 3];
      const sy = sp[i * 3 + 1];
      const sz = sp[i * 3 + 2];
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) continue;
      const dx = sx - qx;
      const dy = sy - qy;
      const dz = sz - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bestIdx = i;
      }
    }
    result.push(bestIdx);
  }
  return result;
}

function transferredSeeds(dst: Geometry): number[] {
  const data = dst.attrs.point.require("seed").data;
  return Array.from(data.subarray(0, dst.attrs.point.count));
}

describe("transferNearest grid path", () => {
  it("matches brute force on a few hundred seeded-random points", () => {
    const src = seededCloud(300, 1001, 0, 10);
    const dst = seededCloud(200, 2002, -1, 11); // some queries outside src bounds
    const expected = bruteNearest(src, dst);
    transferNearest(dst, src, "seed", { bruteForceThreshold: 0 });
    expect(transferredSeeds(dst)).toEqual(expected);
  });

  it("agrees with the internal brute-force path", () => {
    const src = seededCloud(120, 42, 0, 5);
    const dstGrid = seededCloud(80, 77, 0, 5);
    const dstBrute = seededCloud(80, 77, 0, 5);
    transferNearest(dstGrid, src, "seed", { bruteForceThreshold: 0 });
    transferNearest(dstBrute, src, "seed", { bruteForceThreshold: Number.MAX_SAFE_INTEGER });
    expect(transferredSeeds(dstGrid)).toEqual(transferredSeeds(dstBrute));
  });

  it("is insensitive to the cell size", () => {
    const src = seededCloud(150, 5, 0, 8);
    const expected = bruteNearest(src, seededCloud(60, 6, 0, 8));
    for (const cellSize of [0.25, 1, 7, 100]) {
      const dst = seededCloud(60, 6, 0, 8);
      transferNearest(dst, src, "seed", { bruteForceThreshold: 0, cellSize });
      expect(transferredSeeds(dst), `cellSize ${cellSize}`).toEqual(expected);
    }
  });

  it("handles queries far outside the source bounds", () => {
    const src = seededCloud(100, 9, 0, 1);
    const dst = createPointCloud(3);
    const dp = dst.attrs.point.require("P").data as Float32Array;
    dp.set([50, -30, 20, -100, -100, -100, 0.5, 0.5, 200]);
    const expected = bruteNearest(src, dst);
    transferNearest(dst, src, "seed", { bruteForceThreshold: 0 });
    expect(transferredSeeds(dst)).toEqual(expected);
  });

  it("handles planar (degenerate-extent) sources", () => {
    const src = seededCloud(200, 31, 0, 5);
    const sp = src.attrs.point.require("P").data as Float32Array;
    for (let i = 0; i < 200; i++) sp[i * 3 + 2] = 0; // flatten to z = 0
    const dst = seededCloud(100, 32, 0, 5);
    const expected = bruteNearest(src, dst);
    transferNearest(dst, src, "seed", { bruteForceThreshold: 0 });
    expect(transferredSeeds(dst)).toEqual(expected);
  });

  it("completes quickly for queries at extreme distances", () => {
    // Regression: the ring search used to start at r=0 and pay one empty
    // ring per cell of distance, hanging on far-away (but valid) queries.
    const src = seededCloud(100, 9, 0, 1);
    const dst = createPointCloud(2);
    const dp = dst.attrs.point.require("P").data as Float32Array;
    dp.set([3e8, -3e8, 3e8, -1e7, 0.5, 0.5]);
    const expected = bruteNearest(src, dst);
    const t0 = performance.now();
    transferNearest(dst, src, "seed", { bruteForceThreshold: 0 });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(transferredSeeds(dst)).toEqual(expected);
  });

  it("ignores non-finite source points on both paths", () => {
    const src = seededCloud(40, 81, 0, 4);
    const sp = src.attrs.point.require("P").data as Float32Array;
    // Original position of point 5, captured before poisoning: a query
    // parked exactly there would pick index 5 if it were not skipped.
    const parked = [sp[5 * 3], sp[5 * 3 + 1], sp[5 * 3 + 2]];
    sp[5 * 3] = Number.NaN; // point 5: NaN x
    sp[17 * 3 + 2] = Infinity; // point 17: +Inf z would poison the bounds
    const expected: number[] = [];
    for (const bruteForceThreshold of [0, Number.MAX_SAFE_INTEGER]) {
      const dst = seededCloud(25, 82, 0, 4);
      (dst.attrs.point.require("P").data as Float32Array).set(parked, 0);
      if (expected.length === 0) {
        expected.push(...bruteNearest(src, dst));
        expect(expected).not.toContain(5);
        expect(expected).not.toContain(17);
      }
      transferNearest(dst, src, "seed", { bruteForceThreshold });
      expect(transferredSeeds(dst), `threshold ${bruteForceThreshold}`).toEqual(expected);
    }
  });

  it("maps non-finite destination positions to source index 0", () => {
    const src = seededCloud(50, 91, 0, 2);
    for (const bruteForceThreshold of [0, Number.MAX_SAFE_INTEGER]) {
      const dst = createPointCloud(3);
      const dp = dst.attrs.point.require("P").data as Float32Array;
      dp.set([Number.NaN, 0, 0, 1, Infinity, 1, 0.5, 0.5, 0.5]);
      const expected = bruteNearest(src, dst);
      transferNearest(dst, src, "seed", { bruteForceThreshold });
      const got = transferredSeeds(dst);
      expect(got[0], `threshold ${bruteForceThreshold}`).toBe(0);
      expect(got[1], `threshold ${bruteForceThreshold}`).toBe(0);
      expect(got, `threshold ${bruteForceThreshold}`).toEqual(expected);
    }
  });

  it("throws when no source position is finite", () => {
    const src = createPointCloud(5);
    (src.attrs.point.require("P").data as Float32Array).fill(Number.NaN, 0, 15);
    const dst = seededCloud(2, 93, 0, 1);
    expect(() => transferNearest(dst, src, "seed", { bruteForceThreshold: 0 })).toThrow(
      /no source point has a finite/,
    );
    expect(() => transferNearest(dst, src, "seed")).toThrow(/no source point has a finite/);
  });

  it("handles a single-point source and coincident sources", () => {
    const single = createPointCloud(1);
    (single.attrs.point.require("P").data as Float32Array).set([1, 2, 3]);
    single.attrs.point.require("seed").data[0] = 7;
    const dst = seededCloud(10, 3, -5, 5);
    transferNearest(dst, single, "seed", { bruteForceThreshold: 0 });
    expect(transferredSeeds(dst)).toEqual(new Array(10).fill(7));

    // 50 coincident points: ties resolve to the lowest source index.
    const coincident = createPointCloud(50);
    const cp = coincident.attrs.point.require("P").data as Float32Array;
    const cs = coincident.attrs.point.require("seed").data as Uint32Array;
    for (let i = 0; i < 50; i++) {
      cp.set([1, 2, 3], i * 3);
      cs[i] = i;
    }
    const dst2 = seededCloud(5, 4, 0, 4);
    transferNearest(dst2, coincident, "seed", { bruteForceThreshold: 0 });
    expect(transferredSeeds(dst2)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("transferNearest values", () => {
  it("copies exact values on a tiny known layout", () => {
    const src = createPointCloud(3);
    (src.attrs.point.require("P").data as Float32Array).set([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const val = src.attrs.point.add("val", "f32");
    val.data.set([7, 8, 9]);
    const dst = createPointCloud(2);
    (dst.attrs.point.require("P").data as Float32Array).set([6, 0, 0, 1, 1, 0]);
    // Default threshold -> brute path (3 < 32).
    transferNearest(dst, src, "val");
    const brute = Array.from(dst.attrs.point.require("val").data.subarray(0, 2));
    expect(brute).toEqual([8, 7]);
    // Forced grid path agrees.
    const dst2 = createPointCloud(2);
    (dst2.attrs.point.require("P").data as Float32Array).set([6, 0, 0, 1, 1, 0]);
    transferNearest(dst2, src, "val", { bruteForceThreshold: 0 });
    expect(Array.from(dst2.attrs.point.require("val").data.subarray(0, 2))).toEqual([8, 7]);
  });

  it("transfers tuple attributes componentwise", () => {
    const src = seededCloud(100, 21, 0, 6);
    const uv = src.attrs.point.add("uv", "f32", 2);
    for (let i = 0; i < 100; i++) {
      uv.data[i * 2] = i;
      uv.data[i * 2 + 1] = i * 0.5;
    }
    const dst = seededCloud(40, 22, 0, 6);
    const expected = bruteNearest(src, dst);
    transferNearest(dst, src, "uv", { bruteForceThreshold: 0 });
    const got = dst.attrs.point.require("uv");
    for (let j = 0; j < 40; j++) {
      expect(got.get(j, 0)).toBe(expected[j]);
      expect(got.get(j, 1)).toBe(expected[j] * 0.5);
    }
  });

  it("transfers string attributes", () => {
    const src = seededCloud(64, 51, 0, 3);
    const tag = src.attrs.point.add("tag", "string");
    for (let i = 0; i < 64; i++) tag.setString(i, `s${i % 7}`);
    const dst = seededCloud(30, 52, 0, 3);
    const expected = bruteNearest(src, dst);
    transferNearest(dst, src, "tag", { bruteForceThreshold: 0 });
    const got = dst.attrs.point.require("tag");
    for (let j = 0; j < 30; j++) {
      expect(got.getString(j)).toBe(`s${expected[j] % 7}`);
    }
  });

  it("creates or overwrites the destination attribute", () => {
    const src = seededCloud(50, 61, 0, 4);
    const dst = seededCloud(20, 62, 0, 4);
    expect(dst.attrs.point.has("extra")).toBe(false);
    src.attrs.point.add("extra", "i32", 1, -1).fill(123, 0, 50);
    transferNearest(dst, src, "extra", { bruteForceThreshold: 0 });
    const got = dst.attrs.point.require("extra");
    expect(got.type).toBe("i32");
    expect(Array.from(got.data.subarray(0, 20))).toEqual(new Array(20).fill(123));
  });

  it("survives transferring a geometry onto itself", () => {
    const geo = createPointCloud(4);
    (geo.attrs.point.require("P").data as Float32Array).set([
      0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0,
    ]);
    const val = geo.attrs.point.add("val", "u32");
    val.data.set([11, 22, 33, 44]);
    transferNearest(geo, geo, "val", { bruteForceThreshold: 0 });
    expect(Array.from(geo.attrs.point.require("val").data.subarray(0, 4))).toEqual([
      11, 22, 33, 44,
    ]);
  });

  it("validates inputs", () => {
    const src = seededCloud(10, 71, 0, 1);
    const dst = seededCloud(5, 72, 0, 1);
    expect(() => transferNearest(dst, src, "nope")).toThrow(/not found on source/);
    expect(() => transferNearest(dst, createPointCloud(0), "seed")).toThrow(/no points/);
    expect(() => transferNearest(dst, src, "seed", { cellSize: 0, bruteForceThreshold: 0 })).toThrow(
      /positive finite/,
    );
  });
});
