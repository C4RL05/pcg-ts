import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud, createTriangleMesh } from "../data/index.js";
import { buildInstanceBatches } from "./instances.js";

/** Point cloud with P/rot/scale set per point from [x,y,z,qx,qy,qz,qw,sx,sy,sz] rows. */
function cloud(rows: number[][]): Geometry {
  const geo = createPointCloud(rows.length);
  const P = geo.attrs.point.require("P");
  const rot = geo.attrs.point.require("rot");
  const scale = geo.attrs.point.require("scale");
  rows.forEach((row, i) => {
    P.setTuple(i, row.slice(0, 3));
    rot.setTuple(i, row.slice(3, 7));
    scale.setTuple(i, row.slice(7, 10));
  });
  return geo;
}

function matrixOf(batchTransforms: Float32Array, instance: number): number[] {
  return Array.from(batchTransforms.subarray(instance * 16, instance * 16 + 16));
}

function expectClose(actual: number[], expected: number[], eps = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - expected[i]), `element ${i}: ${v} vs ${expected[i]}`).toBeLessThanOrEqual(eps);
  });
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("buildInstanceBatches TRS composition", () => {
  it("translation only: identity basis with P in elements 12-14", () => {
    const geo = cloud([[1, 2, 3, 0, 0, 0, 1, 1, 1, 1]]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a" });
    expect(batch.count).toBe(1);
    expect(matrixOf(batch.transforms, 0)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1,
    ]);
  });

  it("rotation only: 90 degrees about Y", () => {
    const s = Math.SQRT1_2;
    const geo = cloud([[0, 0, 0, 0, s, 0, s, 1, 1, 1]]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a" });
    // Ry(90): x-axis -> (0,0,-1), y-axis -> (0,1,0), z-axis -> (1,0,0); column-major.
    expectClose(matrixOf(batch.transforms, 0), [
      0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("scale only: diagonal", () => {
    const geo = cloud([[0, 0, 0, 0, 0, 0, 1, 2, 3, 4]]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a" });
    expectClose(matrixOf(batch.transforms, 0), [
      2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1,
    ]);
  });

  it("combined TRS matches hand-computed T(P) * R(rot) * S(scale)", () => {
    // 90 degrees about Z: x-axis -> (0,1,0), y-axis -> (-1,0,0).
    const s = Math.SQRT1_2;
    const geo = cloud([[1, 2, 3, 0, 0, s, s, 2, 3, 4]]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a" });
    // Columns: R*(2,0,0)=(0,2,0), R*(0,3,0)=(-3,0,0), R*(0,0,4)=(0,0,4), T=(1,2,3).
    expectClose(matrixOf(batch.transforms, 0), [
      0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1,
    ]);
  });

  it("missing rot/scale attributes are treated as identity", () => {
    // createTriangleMesh only has P.
    const geo = createTriangleMesh([5, 6, 7, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a" });
    expect(batch.count).toBe(3);
    expect(matrixOf(batch.transforms, 0)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1,
    ]);
  });

  it("throws an actionable error when P is missing", () => {
    const geo = new Geometry();
    geo.attrs.point.add("foo", "f32", 1);
    geo.attrs.point.resize(2);
    expect(() => buildInstanceBatches(geo, { defaultAssetId: "a" })).toThrow(/"P"/);
  });
});

describe("buildInstanceBatches grouping", () => {
  function taggedCloud(assetIds: string[]): Geometry {
    const geo = createPointCloud(assetIds.length);
    const attr = geo.attrs.point.add("asset", "string", 1, "");
    const P = geo.attrs.point.require("P");
    assetIds.forEach((id, i) => {
      attr.setString(i, id);
      P.setTuple(i, [i, 0, 0]);
    });
    return geo;
  }

  it("groups by assetAttr in first-occurrence order, instances in point order", () => {
    const geo = taggedCloud(["b", "a", "b"]);
    const batches = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    expect(batches.map((b) => b.assetId)).toEqual(["b", "a"]);
    expect(batches.map((b) => b.count)).toEqual([2, 1]);
    // b holds points 0 and 2, a holds point 1 (x encodes the point index).
    expect(batches[0].transforms[12]).toBe(0);
    expect(batches[0].transforms[16 + 12]).toBe(2);
    expect(batches[1].transforms[12]).toBe(1);
  });

  it("empty per-point values fall back to defaultAssetId", () => {
    const geo = taggedCloud(["x", "", "x"]);
    const batches = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    expect(batches.map((b) => b.assetId)).toEqual(["x", "d"]);
    expect(batches.map((b) => b.count)).toEqual([2, 1]);
  });

  it("without assetAttr every point lands in one defaultAssetId batch", () => {
    const geo = taggedCloud(["b", "a", "b"]);
    const batches = buildInstanceBatches(geo, { defaultAssetId: "solo" });
    expect(batches).toHaveLength(1);
    expect(batches[0].assetId).toBe("solo");
    expect(batches[0].count).toBe(3);
    expect(batches[0].transforms).toHaveLength(48);
  });

  it("missing assetAttr names the attribute and lists string attrs", () => {
    const geo = taggedCloud(["a"]);
    expect(() =>
      buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "nope" }),
    ).toThrow(/assetAttr "nope".*asset/s);
  });

  it("non-string assetAttr throws", () => {
    const geo = createPointCloud(1);
    expect(() =>
      buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "density" }),
    ).toThrow(/must be a string attribute/);
  });

  it("empty geometry produces no batches", () => {
    expect(buildInstanceBatches(createPointCloud(0), { defaultAssetId: "a" })).toEqual([]);
  });

  it("is deterministic and pure: identical output on repeat calls, input untouched", () => {
    const geo = taggedCloud(["b", "a", "b"]);
    const before = Array.from(geo.attrs.point.require("P").data);
    const first = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    const second = buildInstanceBatches(geo, { defaultAssetId: "d", assetAttr: "asset" });
    expect(second.map((b) => b.assetId)).toEqual(first.map((b) => b.assetId));
    second.forEach((b, i) => {
      expect(Array.from(b.transforms)).toEqual(Array.from(first[i].transforms));
    });
    expect(Array.from(geo.attrs.point.require("P").data)).toEqual(before);
  });
});
