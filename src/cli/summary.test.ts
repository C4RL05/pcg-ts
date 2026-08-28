/**
 * The statistics behind `pcg inspect` and `pcg cook`. `attributeStats` and
 * `geometrySummary` are exported from `pcg-ts/cli`, so their numbers are a
 * public contract — pinned here as values rather than inferred from the
 * shape of a report, because a mean divided by the wrong denominator or a
 * min and a max swapped is invisible in a table that only has to contain
 * the word "height".
 */
import { describe, expect, it } from "vitest";
import {
  Attribute,
  createPointCloud,
  createPolyline,
  createTriangleMesh,
  makeGeometryItem,
  makeInstancesItem,
} from "../index.js";
import { attrListText, attributeStats, geometrySummary, itemLine, sampleRows, summarizeItem } from "./summary.js";

/** A standalone column of `values`, one component per element. */
function column(values: readonly number[], type: "f32" | "i32" | "u32" | "bool" = "f32"): Attribute {
  const attr = new Attribute("h", type, 1, values.length);
  values.forEach((v, i) => attr.set(i, v));
  return attr;
}

describe("attributeStats — numeric", () => {
  it("reports min, max, mean and the non-finite count, as numbers", () => {
    const stats = attributeStats(column([1, Number.NaN, 3, Number.POSITIVE_INFINITY]), 4);
    expect(stats.name).toBe("h");
    expect(stats.type).toBe("f32");
    expect(stats.tupleSize).toBe(1);
    expect(stats.min).toEqual([1]);
    expect(stats.max).toEqual([3]);
    // The mean divides by the FINITE count (2), not by the element count
    // (4) and not by anything else.
    expect(stats.mean).toEqual([2]);
    expect(stats.nonFinite).toBe(2);
  });

  it("keeps min below max, and both away from the mean", () => {
    const stats = attributeStats(column([10, 2, 6]), 3);
    expect(stats.min).toEqual([2]);
    expect(stats.max).toEqual([10]);
    expect(stats.mean).toEqual([6]);
  });

  it("counts -Infinity as non-finite too, and excludes it from the extremes", () => {
    const stats = attributeStats(column([Number.NEGATIVE_INFINITY, -5, 5]), 3);
    expect(stats.min).toEqual([-5]);
    expect(stats.max).toEqual([5]);
    expect(stats.mean).toEqual([0]);
    expect(stats.nonFinite).toBe(1);
  });

  it("says nothing rather than something wrong when every value is non-finite", () => {
    const stats = attributeStats(column([Number.NaN, Number.NaN, Number.NaN]), 3);
    expect(stats.min).toBeUndefined();
    expect(stats.max).toBeUndefined();
    expect(stats.mean).toBeUndefined();
    expect(stats.nonFinite).toBe(3);
  });

  it("works per component for a tuple", () => {
    const attr = new Attribute("v", "f32", 3, 2);
    attr.setTuple(0, [1, -2, Number.NaN]);
    attr.setTuple(1, [3, 2, 8]);
    const stats = attributeStats(attr, 2);
    expect(stats.min).toEqual([1, -2, 8]);
    expect(stats.max).toEqual([3, 2, 8]);
    expect(stats.mean).toEqual([2, 0, 8]);
    expect(stats.nonFinite).toBe(1);
  });

  it("never wraps a u32 through Int32", () => {
    const stats = attributeStats(column([0, 2147483648, 4294967295, 3000000000], "u32"), 4);
    expect(stats.min).toEqual([0]);
    expect(stats.max).toEqual([4294967295]);
    expect(stats.mean).toEqual([2360612735.75]);
  });

  it("reports an empty domain as empty, not as zero", () => {
    const stats = attributeStats(column([]), 0);
    expect(stats.min).toBeUndefined();
    expect(stats.max).toBeUndefined();
    expect(stats.nonFinite).toBe(0);
  });
});

describe("attributeStats — strings", () => {
  it("counts the values actually in use and lists them in table order", () => {
    const attr = new Attribute("kind", "string", 1, 3);
    attr.setString(0, "oak");
    attr.setString(1, "pine");
    attr.setString(2, "oak");
    attr.internString("never-written");
    const stats = attributeStats(attr, 3);
    expect(stats.distinct).toBe(2);
    expect(stats.values).toEqual(["oak", "pine"]);
    expect(stats.min).toBeUndefined();
    expect(stats.max).toBeUndefined();
  });

  it("caps the listed values while still counting them all", () => {
    const attr = new Attribute("kind", "string", 1, 20);
    for (let i = 0; i < 20; i++) attr.setString(i, `v${i}`);
    const stats = attributeStats(attr, 20);
    expect(stats.distinct).toBe(20);
    expect(stats.values).toHaveLength(8);
  });
});

describe("geometrySummary", () => {
  it("bounds the point positions and names the domains", () => {
    const geo = createPointCloud(2);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [0, 1, 2]);
    P.setTuple(1, [4, 5, 6]);
    const summary = geometrySummary(geo);
    expect(summary.points).toBe(2);
    expect(summary.bounds).toEqual({ min: [0, 1, 2], max: [4, 5, 6] });
    expect(summary.boundsExcluded).toBeUndefined();
    expect(summary.domains.map((d) => d.domain)).toEqual([
      "point",
      "vertex",
      "primitive",
      "detail",
    ]);
  });

  it("says so when the box does not contain every point", () => {
    const geo = createPointCloud(3);
    const P = geo.attrs.point.require("P");
    P.setTuple(0, [Number.NaN, 1, 1]);
    P.setTuple(1, [0, 0, 0]);
    P.setTuple(2, [2, 2, 2]);
    const summary = geometrySummary(geo);
    expect(summary.bounds).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
    // A box printed as if it were complete is worse than no box at all.
    expect(summary.boundsExcluded).toBe(1);
    expect(itemLine(summarizeItem(makeGeometryItem(geo)))).toContain(
      "(excludes 1 non-finite P value)",
    );
  });

  it("counts primitives by their primtype", () => {
    const summary = geometrySummary(createPolyline(Float32Array.of(0, 0, 0, 1, 0, 1)));
    expect(summary.primitives).toBe(1);
    expect(summary.primTypes).toEqual({ polyline: 1 });
  });

  it("omits primTypes for a primtype column over zero primitives", () => {
    // What a primitive filter that kept nothing produces: the column
    // survives the resize, so the geometry is tagged and empty at once.
    // `primitives: 0` already says this; an empty record would be a
    // second spelling of the same fact in the --json payload.
    const empty = geometrySummary(createTriangleMesh(Float32Array.of(0, 0, 0), []));
    expect(empty.primitives).toBe(0);
    expect(Object.hasOwn(empty, "primTypes")).toBe(false);
  });
});

describe("itemLine / attrListText", () => {
  it("names attributes with their type and tuple size", () => {
    const geo = createPointCloud(1);
    geo.attrs.point.add("elevation", "f32", 1);
    const point = geometrySummary(geo).domains[0];
    expect(attrListText(point.attrs)).toContain("P(f32x3)");
    expect(attrListText(point.attrs)).toContain("elevation(f32)");
    expect(attrListText([])).toBe("(none)");
  });

  it("describes an instances item by residency and batch", () => {
    const item = makeInstancesItem([
      { assetId: "tree", count: 3, transforms: new Float32Array(48) },
    ]);
    expect(itemLine(summarizeItem(item))).toBe(
      "instances  3 instances in 1 batch (cpu) — tree x3",
    );
  });

  it("names each per-instance channel, so a spawn can be confirmed to have carried it", () => {
    // The gap this closes: `instanceAttrs` is the ABI between a graph and
    // its host, and before this the CLI reported only the asset and the
    // count — an author had no way to see whether the channel they named
    // crossed the spawner at all.
    const item = makeInstancesItem([
      {
        assetId: "reed",
        count: 2,
        transforms: new Float32Array(32),
        attributes: {
          phase: new Float32Array([0.25, 0.75]),
          plantId: new Uint32Array([17, 99]),
        },
      },
    ]);
    expect(itemLine(summarizeItem(item))).toBe(
      "instances  2 instances in 1 batch (cpu) — reed x2 [phase(f32), plantId(u32)]",
    );
  });

  it("keeps a channel's dtype rather than reporting everything as f32", () => {
    // The whole reason the dtype is preserved across the spawner is that
    // f32 stops representing consecutive integers past 2^24, so an `inspect`
    // that reported a u32 id column as f32 would hide exactly the widening
    // the channel exists to avoid.
    const item = makeInstancesItem([
      {
        assetId: "rock",
        count: 2,
        transforms: new Float32Array(32),
        attributes: {
          id: new Uint32Array([16_777_217, 16_777_218]),
          flag: new Uint8Array([1, 0]),
          bias: new Int32Array([-3, 4]),
        },
      },
    ]);
    const summary = summarizeItem(item);
    if (summary.kind !== "instances") throw new Error("expected an instances summary");
    expect(summary.batches[0].channels).toEqual([
      { name: "id", type: "u32", itemSize: 1 },
      { name: "flag", type: "bool", itemSize: 1 },
      { name: "bias", type: "i32", itemSize: 1 },
    ]);
  });

  it("derives itemSize from the column, and reports 0 where there is nothing to divide by", () => {
    const wide = makeInstancesItem([
      {
        assetId: "banner",
        count: 2,
        transforms: new Float32Array(32),
        attributes: { rgba: new Float32Array(8) },
      },
    ]);
    const wideSummary = summarizeItem(wide);
    if (wideSummary.kind !== "instances") throw new Error("expected an instances summary");
    expect(wideSummary.batches[0].channels).toEqual([
      { name: "rgba", type: "f32", itemSize: 4 },
    ]);

    const empty = makeInstancesItem([
      {
        assetId: "banner",
        count: 0,
        transforms: new Float32Array(0),
        attributes: { rgba: new Float32Array(0) },
      },
    ]);
    const emptySummary = summarizeItem(empty);
    if (emptySummary.kind !== "instances") throw new Error("expected an instances summary");
    expect(emptySummary.batches[0].channels).toEqual([
      { name: "rgba", type: "f32", itemSize: 0 },
    ]);
  });

  it("reports a hand-built batch's plain colors as the reserved channel", () => {
    // `colors` is sugar over `attributes.color`, and the normalizer is what
    // makes the two spellings report identically instead of one of them
    // reading as no channel at all.
    const item = makeInstancesItem([
      { assetId: "bush", count: 1, transforms: new Float32Array(16), colors: new Float32Array(3) },
    ]);
    expect(itemLine(summarizeItem(item))).toBe(
      "instances  1 instance in 1 batch (cpu) — bush x1 [color(f32x3)]",
    );
  });
});

describe("sampleRows", () => {
  it("clamps the limit to what the domain holds", () => {
    const geo = createPointCloud(5);
    const rowsFor = (limit: number): number => sampleRows(geo, "point", limit).rows.length;
    expect(rowsFor(0)).toBe(0);
    expect(rowsFor(1)).toBe(1);
    expect(rowsFor(4)).toBe(4);
    expect(rowsFor(5)).toBe(5);
    expect(rowsFor(6)).toBe(5);
    expect(rowsFor(-3)).toBe(0);
    expect(sampleRows(geo, "point", 2).total).toBe(5);
  });

  it("leads with the element index and then every attribute, in order", () => {
    const geo = createPointCloud(1);
    const sample = sampleRows(geo, "point", 1);
    expect(sample.columns[0]).toBe("#");
    expect(sample.columns).toContain("P");
    expect(sample.rows[0][0]).toBe("0");
  });

  it("returns nothing for an empty domain rather than throwing", () => {
    const sample = sampleRows(createPointCloud(3), "vertex", 5);
    expect(sample.rows).toEqual([]);
    expect(sample.total).toBe(0);
  });
});
