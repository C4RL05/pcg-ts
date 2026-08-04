import { describe, expect, it } from "vitest";
import { pointGrid, pointLine, pointScatterInBounds } from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./testSupport.js";

describe("pointGrid", () => {
  it("lays out origin + spacing with X fastest", async () => {
    const out = await runNode(pointGrid, {
      countX: 2,
      countY: 2,
      countZ: 1,
      spacing: [1, 2, 3],
      origin: [10, 20, 30],
    });
    const geo = firstGeo(out.out);
    expect(positionsOf(geo)).toEqual([
      [10, 20, 30],
      [11, 20, 30],
      [10, 22, 30],
      [11, 22, 30],
    ]);
    // Standard attrs present, per-point seeds distinct.
    const seeds = geo.attrs.point.require("seed");
    expect(new Set([seeds.get(0), seeds.get(1), seeds.get(2), seeds.get(3)]).size).toBe(4);
    expect(geo.attrs.point.require("density").get(0)).toBe(1);
  });
});

describe("pointLine", () => {
  it("places count points from start to end inclusive", async () => {
    const geo = firstGeo(
      (await runNode(pointLine, { count: 3, start: [0, 0, 0], end: [4, 2, 0] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [2, 1, 0],
      [4, 2, 0],
    ]);
  });

  it("count 1 places a single point at start", async () => {
    const geo = firstGeo(
      (await runNode(pointLine, { count: 1, start: [5, 5, 5], end: [9, 9, 9] })).out,
    );
    expect(positionsOf(geo)).toEqual([[5, 5, 5]]);
  });
});

describe("pointScatterInBounds", () => {
  it("keeps every point inside the box", async () => {
    const geo = firstGeo(
      (
        await runNode(pointScatterInBounds, {
          count: 200,
          boundsMin: [-2, 0, 5],
          boundsMax: [-1, 3, 6],
        })
      ).out,
    );
    expect(geo.pointCount).toBe(200);
    for (const [x, y, z] of positionsOf(geo)) {
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(-1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(3 + 1e-6);
      expect(z).toBeGreaterThanOrEqual(5);
      expect(z).toBeLessThan(6 + 1e-6);
    }
  });

  it("is deterministic per seed and differs across seeds", async () => {
    const a = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 9)).out);
    const b = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 9)).out);
    const c = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 10)).out);
    const d = firstGeo(
      (await runNode(pointScatterInBounds, { count: 50, seed: 1 }, {}, 9)).out,
    );
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(c));
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(d));
  });
});
