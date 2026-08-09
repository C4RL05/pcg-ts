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

  it("defaults to includeEnd, matching an explicit true", async () => {
    // The default is the shipped behavior: adding the param must not move
    // a single position, so the two runs are compared to each other AND to
    // the endpoint-inclusive layout.
    const implicit = firstGeo(
      (await runNode(pointLine, { count: 5, start: [0, 0, 0], end: [4, 0, 0] })).out,
    );
    const explicit = firstGeo(
      (
        await runNode(pointLine, {
          count: 5,
          start: [0, 0, 0],
          end: [4, 0, 0],
          includeEnd: true,
        })
      ).out,
    );
    expect(pointLine.defaultParams.includeEnd).toBe(true);
    expect(snapshotGeometry(implicit)).toEqual(snapshotGeometry(explicit));
    expect(positionsOf(implicit)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
  });

  it("includeEnd false stops one step short of end", async () => {
    // Four samples over [0, 4) step by 4/4 = 1 and never reach 4, so the
    // count is the number of DISTINCT positions a wrapping sweep gets.
    const geo = firstGeo(
      (
        await runNode(pointLine, {
          count: 4,
          start: [0, 0, 0],
          end: [4, 0, 0],
          includeEnd: false,
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
  });

  it("exclusive count n covers the same positions as inclusive count n + 1, minus the seam", async () => {
    // The relationship the ring rewiring depends on: dropping the seam
    // point is exactly what the exclusive mode does, so a primitive no
    // longer needs an extra filter node to do it.
    const closed = firstGeo(
      (
        await runNode(pointLine, {
          count: 7,
          start: [0, 0, 0],
          end: [1, 0, 0],
          includeEnd: false,
        })
      ).out,
    );
    const openWithSeam = firstGeo(
      (await runNode(pointLine, { count: 8, start: [0, 0, 0], end: [1, 0, 0] })).out,
    );
    expect(closed.pointCount).toBe(7);
    expect(positionsOf(closed)).toEqual(positionsOf(openWithSeam).slice(0, 7));
  });

  it("count 1 places a single point at start under both modes", async () => {
    // Degenerate: one sample has no step to take, so there is nothing for
    // the excluded endpoint to be short of. Both modes emit start.
    for (const includeEnd of [true, false]) {
      const geo = firstGeo(
        (
          await runNode(pointLine, { count: 1, start: [5, 5, 5], end: [9, 9, 9], includeEnd })
        ).out,
      );
      expect(positionsOf(geo), `includeEnd ${includeEnd}`).toEqual([[5, 5, 5]]);
    }
  });

  it("count 0 emits an empty point cloud under both modes", async () => {
    // Below the schema minimum of 1, so unreachable through a validated
    // graph — pinned anyway because the executor must stay total rather
    // than divide by zero or emit a stray point.
    for (const includeEnd of [true, false]) {
      const geo = firstGeo(
        (
          await runNode(pointLine, { count: 0, start: [0, 0, 0], end: [1, 0, 0], includeEnd })
        ).out,
      );
      expect(geo.pointCount, `includeEnd ${includeEnd}`).toBe(0);
      expect(positionsOf(geo), `includeEnd ${includeEnd}`).toEqual([]);
    }
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
