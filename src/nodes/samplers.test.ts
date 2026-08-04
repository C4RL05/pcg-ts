import { describe, expect, it } from "vitest";
import { createPointCloud, createPolyline, createTriangleMesh } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
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
