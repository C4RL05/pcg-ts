/**
 * Input-plumbing diagnostics shared by the standard node library.
 *
 * The case that matters here is silent truncation: a pin carries a
 * COLLECTION, and one upstream connection can put many geometries on it
 * (partitionByAttribute emits one per distinct value). A node that
 * processes one geometry used to take item[0] and discard the rest with
 * no error and no warning, which turns a truncated result into something
 * that looks like a successful cook. These tests pin the diagnostic.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem, makeValueItem, type GeometryItem } from "../graph/index.js";
import { spawnInstances } from "../spawn/index.js";
import {
  filterByDensity,
  partitionByAttribute,
  transformPoints,
  volumeSample,
} from "./index.js";
import { firstGeo, runNode } from "./nodes.testsupport.js";

function cloudAt(positions: number[][]): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/** Four distinct groups, exactly as a per-district graph would produce. */
async function fourGroups(): Promise<GeometryItem[]> {
  const cloud = cloudAt([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [4, 0, 0],
    [5, 0, 0],
  ]);
  const district = cloud.attrs.point.add("district", "i32", 1, 0);
  [10, 20, 30, 40, 10, 20].forEach((v, i) => district.set(i, v));
  const out = (
    await runNode(partitionByAttribute, { name: "district" }, { in: [makeGeometryItem(cloud)] })
  ).out as GeometryItem[];
  expect(out).toHaveLength(4);
  return out;
}

describe("requireGeometry: multi-item collections", () => {
  it("refuses to silently truncate 4 partitioned groups", async () => {
    const groups = await fourGroups();
    // The bug this guards: transformPoints used to process groups[0] and
    // drop the other three, reporting a clean cook.
    await expect(runNode(transformPoints, {}, { in: groups })).rejects.toThrow(
      /transformPoints: input pin "in" received 4 geometries/,
    );
  });

  it("names the node, the count, and the fix available today", async () => {
    const groups = await fourGroups();
    const err = await runNode(filterByDensity, {}, { in: groups }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    // Receiving node and pin.
    expect(msg).toMatch(/^filterByDensity: input pin "in"/);
    // How many arrived, and how many would have been discarded.
    expect(msg).toContain("received 4 geometries");
    expect(msg).toContain("discarding the other 3");
    // This node processes exactly one.
    expect(msg).toMatch(/processes exactly ONE/);
    // Where a collection comes from, so the author can find the split.
    expect(msg).toContain("partitionByAttribute");
    // The fix that exists today, by exact node type.
    expect(msg).toContain("mergePoints");
    // And the node that DOES process each group separately. This assertion
    // read `/no for-each/i` until forEach shipped: the message's whole job
    // is to leave an agent knowing its next move, so the day the answer
    // changed the message had to change with it.
    expect(msg).toMatch(/inside a forEach/);
    expect(msg).toContain("forEachNode");
    // The escape hatch must name only things a package consumer can
    // actually reach: `filterByTag` is exported, and the plain filter
    // needs no import at all. `geometryItems` is internal to the node
    // library, so naming it would send an agent into an import error.
    expect(msg).toContain('item.kind === "geometry"');
    expect(msg).toContain("filterByTag");
  });

  it("still accepts exactly one geometry", async () => {
    const cloud = cloudAt([
      [0, 0, 0],
      [1, 2, 3],
    ]);
    const geo = firstGeo(
      (await runNode(transformPoints, { translate: [1, 0, 0] }, { in: [makeGeometryItem(cloud)] }))
        .out,
    );
    expect(geo.pointCount).toBe(2);
  });

  it("ignores non-geometry items sharing the pin", async () => {
    const cloud = cloudAt([[0, 0, 0]]);
    const geo = firstGeo(
      (
        await runNode(
          transformPoints,
          {},
          { in: [makeValueItem(7), makeGeometryItem(cloud), makeValueItem("tag")] },
        )
      ).out,
    );
    expect(geo.pointCount).toBe(1);
  });

  it("keeps the empty-pin message unchanged", async () => {
    await expect(runNode(transformPoints, {}, { in: [] })).rejects.toThrow(
      'transformPoints: input pin "in" has no geometry connected',
    );
  });
});

describe("optional geometry inputs", () => {
  it("volumeSample refuses a multi-item bounds input", async () => {
    const groups = await fourGroups();
    await expect(runNode(volumeSample, { cellSize: 1 }, { in: groups })).rejects.toThrow(
      /volumeSample: input pin "in" received 4 geometries/,
    );
  });

  it("volumeSample still falls back to params when nothing is connected", async () => {
    const out = await runNode(volumeSample, {
      cellSize: 1,
      boundsMin: [0, 0, 0],
      boundsMax: [2, 0, 0],
    });
    expect(firstGeo(out.out).pointCount).toBeGreaterThan(0);
  });
});

describe("spawnInstances", () => {
  it("refuses to spawn from only the first of several groups", async () => {
    const groups = await fourGroups();
    await expect(runNode(spawnInstances, {}, { in: groups })).rejects.toThrow(
      /spawnInstances: input pin "in" received 4 geometries/,
    );
  });

  it("keeps its empty-pin message unchanged", async () => {
    await expect(runNode(spawnInstances, {}, { in: [] })).rejects.toThrow(
      'spawnInstances: input pin "in" has no geometry connected',
    );
  });
});
