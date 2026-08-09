import { describe, expect, it } from "vitest";
import {
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  createTriangleMesh,
  setPolylineTopology,
  type Geometry,
} from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { fieldFromJson, splineSample, surfaceSample, volumeSample } from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./testSupport.js";

/** Unit square in the XY plane at z = 0, two CCW triangles. */
function unitSquare() {
  return createTriangleMesh(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [0, 1, 2, 0, 2, 3],
  );
}

describe("surfaceSample", () => {
  it("places exactly count points on the mesh with density 1", async () => {
    const mesh = unitSquare();
    const geo = firstGeo(
      (await runNode(surfaceSample, { count: 500 }, { in: [makeGeometryItem(mesh)] })).out,
    );
    expect(geo.pointCount).toBe(500);
    for (const [x, y, z] of positionsOf(geo)) {
      // On the square: inside XY bounds and exactly in the z=0 plane
      // (barycentric residual).
      expect(Math.abs(z)).toBeLessThan(1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(1 + 1e-6);
    }
    const normal = geo.attrs.point.require("normal");
    for (let i = 0; i < geo.pointCount; i++) {
      expect(normal.getTuple(i)).toEqual([0, 0, 1]);
    }
    const seeds = geo.attrs.point.require("seed");
    expect(new Set(Array.from(seeds.data.subarray(0, geo.pointCount))).size).toBe(geo.pointCount);
  });

  it("weights triangle choice by area", async () => {
    // A tiny and a huge triangle: expect samples overwhelmingly on the
    // huge one (area ratio 10000:1 in x extent).
    const mesh = createTriangleMesh(
      [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0, 10, 0, 5, 110, 0, 5, 10, 100, 5],
      [0, 1, 2, 3, 4, 5],
    );
    const geo = firstGeo(
      (await runNode(surfaceSample, { count: 1000 }, { in: [makeGeometryItem(mesh)] })).out,
    );
    let onBig = 0;
    for (const [, , z] of positionsOf(geo)) if (Math.abs(z - 5) < 1e-5) onBig++;
    expect(onBig).toBeGreaterThan(990);
  });

  it("applies the density field on candidates and hits proportions", async () => {
    const mesh = unitSquare();
    // density = 1 where x < 0.5, else 0.
    const density = fieldFromJson({
      fn: "lt",
      args: [{ fn: "component", args: [{ fn: "position" }], index: 0 }, 0.5],
    });
    const geo = firstGeo(
      (
        await runNode(
          surfaceSample,
          { count: 1000, densityField: density },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    expect(geo.pointCount).toBeGreaterThan(300);
    expect(geo.pointCount).toBeLessThan(700);
    for (const [x] of positionsOf(geo)) expect(x).toBeLessThan(0.5);
    // Scalar density 0 keeps nothing; 0.5 keeps roughly half.
    const none = firstGeo(
      (await runNode(surfaceSample, { count: 200, densityField: 0 }, { in: [makeGeometryItem(mesh)] }))
        .out,
    );
    expect(none.pointCount).toBe(0);
    const half = firstGeo(
      (
        await runNode(
          surfaceSample,
          { count: 1000, densityField: 0.5 },
          { in: [makeGeometryItem(mesh)] },
        )
      ).out,
    );
    expect(half.pointCount).toBeGreaterThan(400);
    expect(half.pointCount).toBeLessThan(600);
  });

  it("is deterministic per seed and differs across the seed param", async () => {
    const mesh = unitSquare();
    const run = (seedParam: number) =>
      runNode(surfaceSample, { count: 64, seed: seedParam }, { in: [makeGeometryItem(mesh)] }, 3);
    expect(snapshotGeometry(firstGeo((await run(0)).out))).toEqual(
      snapshotGeometry(firstGeo((await run(0)).out)),
    );
    expect(snapshotGeometry(firstGeo((await run(0)).out))).not.toEqual(
      snapshotGeometry(firstGeo((await run(1)).out)),
    );
  });

  it("errors actionably without triangles", async () => {
    const cloud = createPointCloud(4);
    await expect(
      runNode(surfaceSample, {}, { in: [makeGeometryItem(cloud)] }),
    ).rejects.toThrow(/no triangles/);
    await expect(runNode(surfaceSample, {}, {})).rejects.toThrow(/input pin "in"/);
  });
});

describe("splineSample", () => {
  it("count mode spans the arc length uniformly with tangent and curveU", async () => {
    // L-shaped polyline: 10 along X then 10 along Y; length 20.
    const line = createPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    const geo = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 5 }, { in: [makeGeometryItem(line)] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 0],
      [10, 5, 0],
      [10, 10, 0],
    ]);
    const curveU = geo.attrs.point.require("curveU");
    expect([0, 1, 2, 3, 4].map((i) => curveU.get(i))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const tangent = geo.attrs.point.require("tangent");
    expect(tangent.getTuple(0)).toEqual([1, 0, 0]);
    expect(tangent.getTuple(4)).toEqual([0, 1, 0]);
  });

  it("spacing mode steps by arc length and drops the duplicate end on closed curves", async () => {
    // Closed unit square: perimeter 4.
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo(
      (
        await runNode(splineSample, { mode: "spacing", spacing: 1 }, { in: [makeGeometryItem(square)] })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    // Open curve keeps the endpoint.
    const open = createPolyline([0, 0, 0, 2, 0, 0]);
    const openGeo = firstGeo(
      (await runNode(splineSample, { mode: "spacing", spacing: 1 }, { in: [makeGeometryItem(open)] }))
        .out,
    );
    expect(positionsOf(openGeo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("closed curves in count mode avoid duplicating the start", async () => {
    const square = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = firstGeo(
      (await runNode(splineSample, { mode: "count", count: 4 }, { in: [makeGeometryItem(square)] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
  });

  it("errors actionably without polyline primitives", async () => {
    await expect(
      runNode(splineSample, {}, { in: [makeGeometryItem(unitSquare())] }),
    ).rejects.toThrow(/no polyline primitives/);
  });
});

/**
 * `splineSample`'s arc-length table moved out into the shared
 * `polylineArcTables` helper so the path nodes could measure a curve the
 * same way. The goldens above are the first proof that the move changed
 * nothing; this is the second, and the sharper one — they only pin a
 * handful of round numbers, while a floating-point regression in the
 * concatenation would hide in the digits they never look at.
 *
 * `legacySplineSample` is the execute body EXACTLY as it stood before the
 * extraction, frozen. It must never be "kept up to date": the moment it
 * tracks the node it stops being evidence. If it ever disagrees with the
 * node, the extraction is wrong — not this oracle.
 */
function legacySplineSample(
  geo: Geometry,
  params: { mode: string; count: number; spacing: number },
  seed: number,
): Geometry {
  const P = geo.attrs.point.get("P");
  if (!P || P.type !== "f32" || P.tupleSize < 3) {
    throw new Error('splineSample: input needs a point attribute "P" (f32, tupleSize >= 3)');
  }
  const pd = P.data;
  const ps = P.tupleSize;
  const v2p = geo.vertexToPoint;
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const primType = geo.attrs.primitive.get(PRIMTYPE_ATTR);

  const segAx: number[] = [];
  const segDir: number[] = [];
  const cum: number[] = [0];
  let closedCount = 0;
  let polylineCount = 0;
  for (let p = 0; p < geo.primitiveCount; p++) {
    const nv = counts[p];
    if (nv < 2) continue;
    if (primType && primType.getString(p) !== "polyline") continue;
    polylineCount++;
    const v0 = starts[p];
    if (v2p[v0] === v2p[v0 + nv - 1]) closedCount++;
    for (let v = v0; v < v0 + nv - 1; v++) {
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const dx = pd[b] - pd[a];
      const dy = pd[b + 1] - pd[a + 1];
      const dz = pd[b + 2] - pd[a + 2];
      segAx.push(pd[a], pd[a + 1], pd[a + 2]);
      segDir.push(dx, dy, dz);
      cum.push(cum[cum.length - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  if (polylineCount === 0) {
    throw new Error(
      "splineSample: input has no polyline primitives (build them with createPolyline)",
    );
  }
  const nSeg = segDir.length / 3;
  const L = cum[nSeg];
  const allClosed = closedCount === polylineCount;

  const positions: number[] = [];
  if (params.mode === "count") {
    const n = params.count;
    const denom = allClosed ? n : Math.max(1, n - 1);
    for (let i = 0; i < n; i++) positions.push((i * L) / denom);
  } else {
    const sp = params.spacing;
    if (!(sp > 0)) {
      throw new Error(`splineSample: spacing must be > 0 in 'spacing' mode, got ${sp}`);
    }
    const eps = sp * 1e-6;
    for (let s = 0; s <= L + eps; s += sp) {
      if (allClosed && s >= L - eps && positions.length > 0) break;
      positions.push(Math.min(s, L));
    }
  }

  const n = positions.length;
  const out = createPointCloud(n);
  const op = out.attrs.point.require("P").data;
  const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
  const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
  const seeds = out.attrs.point.require("seed").data;
  for (let i = 0; i < n; i++) {
    const s = positions[i];
    let lo = 0;
    let hi = nSeg - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] > s) hi = mid;
      else lo = mid + 1;
    }
    const segLen = cum[lo + 1] - cum[lo];
    const t = segLen > 0 ? Math.min((s - cum[lo]) / segLen, 1) : 0;
    const dx = segDir[lo * 3];
    const dy = segDir[lo * 3 + 1];
    const dz = segDir[lo * 3 + 2];
    op[i * 3] = segAx[lo * 3] + dx * t;
    op[i * 3 + 1] = segAx[lo * 3 + 1] + dy * t;
    op[i * 3 + 2] = segAx[lo * 3 + 2] + dz * t;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0) {
      tangent[i * 3] = dx / len;
      tangent[i * 3 + 1] = dy / len;
      tangent[i * 3 + 2] = dz / len;
    }
    curveU[i] = L > 0 ? s / L : 0;
    seeds[i] = hashCombine(seed, i);
  }
  return out;
}

describe("splineSample arc-length extraction", () => {
  /** Two polylines over one cloud, so the concatenation is exercised. */
  function pair(a: readonly number[], b: readonly number[], closeB: boolean): Geometry {
    const na = a.length / 3;
    const nb = b.length / 3;
    const geo = createPointCloud(na + nb);
    const P = geo.attrs.point.require("P").data;
    P.set(a, 0);
    P.set(b, na * 3);
    const indices: number[] = [];
    for (let i = 0; i < na; i++) indices.push(i);
    for (let i = 0; i < nb; i++) indices.push(na + i);
    if (closeB) indices.push(na);
    setPolylineTopology(
      geo,
      indices,
      [0, na],
      [na, nb + (closeB ? 1 : 0)],
    );
    return geo;
  }

  /** Deliberately awkward geometry: diagonals, tiny and huge segments. */
  const IRRATIONAL = [0, 0, 0, 1, 1, 1, -3.7, 2.5, 0.001, 900.25, -0.5, 17, 900.25, -0.5, 17];
  const CASES: Array<[string, Geometry]> = [
    ["open L", createPolyline([0, 0, 0, 10, 0, 0, 10, 10, 0])],
    ["closed square", createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true })],
    ["irrational 3D", createPolyline(IRRATIONAL)],
    ["irrational closed", createPolyline(IRRATIONAL, { closed: true })],
    ["two open", pair([0, 0, 0, 3, 4, 0], IRRATIONAL, false)],
    ["open + closed", pair(IRRATIONAL, [0, 0, 0, 2, 0, 0, 2, 2, 0], true)],
    ["repeated points", createPolyline([0, 0, 0, 0, 0, 0, 5, 0, 0, 5, 0, 0, 5, 9, 0])],
  ];
  const PARAMS: Array<{ mode: string; count: number; spacing: number }> = [
    { mode: "count", count: 1, spacing: 1 },
    { mode: "count", count: 2, spacing: 1 },
    { mode: "count", count: 5, spacing: 1 },
    { mode: "count", count: 37, spacing: 1 },
    { mode: "spacing", count: 10, spacing: 0.3 },
    { mode: "spacing", count: 10, spacing: 1.7 },
    { mode: "spacing", count: 10, spacing: 7 },
  ];

  for (const [name, geo] of CASES) {
    it(`matches the pre-extraction implementation byte for byte: ${name}`, async () => {
      for (const params of PARAMS) {
        const live = firstGeo(
          (await runNode(splineSample, params, { in: [makeGeometryItem(geo)] }, 9)).out,
        );
        const legacy = legacySplineSample(geo, params, 9);
        expect(snapshotGeometry(live), `${name} / ${JSON.stringify(params)}`).toEqual(
          snapshotGeometry(legacy),
        );
        expect(live.pointCount).toBeGreaterThan(0);
      }
    });
  }
});

describe("volumeSample", () => {
  it("fills bounds with cell centers when jitter is 0", async () => {
    const geo = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [2, 1, 1],
          cellSize: 1,
          jitter: 0,
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0.5, 0.5, 0.5],
      [1.5, 0.5, 0.5],
    ]);
  });

  it("keeps jittered points inside their cells", async () => {
    const geo = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [4, 4, 4],
          cellSize: 1,
          jitter: 1,
        })
      ).out,
    );
    expect(geo.pointCount).toBe(64);
    const centers = firstGeo(
      (
        await runNode(volumeSample, {
          boundsMin: [0, 0, 0],
          boundsMax: [4, 4, 4],
          cellSize: 1,
          jitter: 0,
        })
      ).out,
    );
    const jittered = positionsOf(geo);
    const base = positionsOf(centers);
    for (let i = 0; i < 64; i++) {
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(jittered[i][k] - base[i][k])).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("derives bounds from a connected geometry", async () => {
    const cloud = createPointCloud(2);
    cloud.attrs.point.require("P").setTuple(0, [0, 0, 0]);
    cloud.attrs.point.require("P").setTuple(1, [2, 1, 1]);
    const geo = firstGeo(
      (
        await runNode(
          volumeSample,
          { boundsMin: [99, 99, 99], boundsMax: [100, 100, 100], cellSize: 1, jitter: 0 },
          { in: [makeGeometryItem(cloud)] },
        )
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0.5, 0.5, 0.5],
      [1.5, 0.5, 0.5],
    ]);
  });

  it("rejects non-positive cell sizes and oversized grids", async () => {
    await expect(runNode(volumeSample, { cellSize: 0 })).rejects.toThrow(/cellSize must be > 0/);
    await expect(
      runNode(volumeSample, { boundsMin: [0, 0, 0], boundsMax: [1e4, 1e4, 1e4], cellSize: 1 }),
    ).rejects.toThrow(/increase cellSize/);
  });
});
