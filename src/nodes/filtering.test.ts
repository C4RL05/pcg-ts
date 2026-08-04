import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import {
  filterByAttribute,
  filterByBounds,
  filterByDensity,
  pointGrid,
  projectToPlane,
  selfPrune,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./testSupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
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
  it("keeps points pairwise >= minDistance, greedily by index", async () => {
    const grid = firstGeo((await runNode(pointGrid, { countX: 10, countY: 1, countZ: 10 })).out);
    const geo = firstGeo(
      (await runNode(selfPrune, { minDistance: 1.5 }, { in: [makeGeometryItem(grid)] })).out,
    );
    expect(geo.pointCount).toBeGreaterThan(0);
    expect(geo.pointCount).toBeLessThan(100);
    // The first point always survives (greedy in index order).
    expect(positionsOf(geo)[0]).toEqual(positionsOf(grid)[0]);
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
