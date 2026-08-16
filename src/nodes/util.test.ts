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
import { requireReportSlot, type ReportSlot } from "./util.js";

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

/**
 * The refusal has to name the geometry the collision is actually ON.
 *
 * Every caller until `pathSegments.segmentIndexAttr` and `pathResample`'s
 * second run checked a set that arrived on a pin, so "the input's" was
 * true and "remove it from the input" was a real fix. A node that checks a
 * set IT BUILT gets neither: the input's `P` is not the `P` at risk, and
 * removing it clears nothing. `ReportSlot.on` is what separates them, and
 * these two cases pin both sides of it — the input wording because half a
 * dozen suites elsewhere quote it verbatim, the output wording because
 * that is the whole point of the flag.
 */
describe("requireReportSlot: which geometry the collision is on", () => {
  /** The slot every case below varies: i32 landing on the f32x3 `P`. */
  function slotOnP(on?: "input" | "output"): ReportSlot {
    return {
      attrs: createPointCloud(4).attrs.point,
      nodeType: "pathSegments",
      param: "segmentIndexAttr",
      name: "P",
      type: "i32",
      tupleSize: 1,
      domain: "point",
      suggestion: "segmentIndex",
      ...(on === undefined ? {} : { on }),
    };
  }

  it("says the INPUT by default, in the wording other suites pin", () => {
    let msg = "";
    try {
      requireReportSlot(slotOnP());
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain(
      'pathSegments: segmentIndexAttr "P" already exists on the input\'s point domain as f32x3',
    );
    expect(msg).toContain(
      'or remove "P" from the input first with removeAttribute if it is genuinely dead',
    );
    // Passing the default explicitly changes nothing.
    expect(() => requireReportSlot(slotOnP("input"))).toThrow(msg);
  });

  it("says the OUTPUT, and withdraws the fix that is not one, when the node built the set", () => {
    let msg = "";
    try {
      requireReportSlot(slotOnP("output"));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain(
      'pathSegments: segmentIndexAttr "P" already exists on the output\'s point domain — the ' +
        "geometry pathSegments builds for itself, not the input's — as f32x3",
    );
    // The defect in one assertion: the old message sent an author to
    // removeAttribute a column that is not on the input at all.
    expect(msg).not.toContain("the input's point domain");
    expect(msg).not.toContain('remove "P" from the input first');
    expect(msg).toContain("removeAttribute upstream cannot help here");
    // The half that must NOT vary: the hazard, and the rename that fixes it.
    expect(msg).toContain('writing it would DELETE the "P" column');
    expect(msg).toContain('a name of its own (e.g. "segmentIndex"');
    expect(msg).toContain("A name that already holds i32 is fine");
  });

  it("refuses nothing on either side when the shape already matches", () => {
    const attrs = createPointCloud(4).attrs.point;
    attrs.add("segmentIndex", "i32", 1, 0);
    const same = { ...slotOnP(), attrs, name: "segmentIndex" } as const;
    expect(() => requireReportSlot(same)).not.toThrow();
    expect(() => requireReportSlot({ ...same, on: "output" })).not.toThrow();
  });
});
