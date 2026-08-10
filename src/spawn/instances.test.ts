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

describe("buildInstanceBatches per-instance colour", () => {
  /**
   * Cloud whose point `i` sits at x = i and carries an rgba encoding that
   * same index in its red channel, so every assertion below can check
   * that an instance's colour came from the point its transform did.
   */
  function paintedCloud(n: number, assetIds?: readonly string[]): Geometry {
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P");
    const color = geo.attrs.point.require("color");
    for (let i = 0; i < n; i++) {
      P.setTuple(i, [i, 0, 0]);
      color.setTuple(i, [i / 10, 0.25, 0.5, 0.75]);
    }
    if (assetIds) {
      const attr = geo.attrs.point.add("asset", "string", 1, "");
      assetIds.forEach((id, i) => attr.setString(i, id));
    }
    return geo;
  }

  it("carries rgb from the named attribute, in instance order", () => {
    const [batch] = buildInstanceBatches(paintedCloud(3), {
      defaultAssetId: "a",
      colorAttr: "color",
    });
    expect(batch.colors).toBeInstanceOf(Float32Array);
    expect(batch.colors).toHaveLength(9);
    expectClose(Array.from(batch.colors ?? []), [
      0, 0.25, 0.5, 0.1, 0.25, 0.5, 0.2, 0.25, 0.5,
    ]);
  });

  it("drops alpha from the standard f32x4 color attribute", () => {
    const geo = createPointCloud(1);
    geo.attrs.point.require("color").setTuple(0, [0.1, 0.2, 0.3, 0.4]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a", colorAttr: "color" });
    expect(batch.colors).toHaveLength(3);
    expectClose(Array.from(batch.colors ?? []), [0.1, 0.2, 0.3]);
  });

  it("accepts a 3-tuple source under any name", () => {
    const geo = createPointCloud(2);
    const tint = geo.attrs.point.add("tint", "f32", 3, 0);
    tint.setTuple(0, [1, 0, 0]);
    tint.setTuple(1, [0, 1, 0]);
    const [batch] = buildInstanceBatches(geo, { defaultAssetId: "a", colorAttr: "tint" });
    expect(Array.from(batch.colors ?? [])).toEqual([1, 0, 0, 0, 1, 0]);
  });

  it("carries no colour at all when colorAttr is absent or empty", () => {
    // The standard `color` attribute is present at [1,1,1,1] on every
    // cloud and must NOT be picked up: an existing graph's batch has to
    // stay byte-for-byte what it was, allocating nothing.
    for (const opts of [
      { defaultAssetId: "a" },
      { defaultAssetId: "a", colorAttr: "" },
    ]) {
      const [batch] = buildInstanceBatches(paintedCloud(3), opts);
      expect(batch.colors).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(batch, "colors")).toBe(false);
    }
  });

  it("colour follows its own point when grouping permutes instance order", () => {
    // Asset ids interleave, so batch "b" holds points 0 and 2 and batch
    // "a" holds points 1 and 3 — instance order is not point order.
    const geo = paintedCloud(4, ["b", "a", "b", "a"]);
    const batches = buildInstanceBatches(geo, {
      defaultAssetId: "d",
      assetAttr: "asset",
      colorAttr: "color",
    });
    expect(batches.map((b) => b.assetId)).toEqual(["b", "a"]);
    for (const batch of batches) {
      const colors = batch.colors;
      if (!colors) throw new Error("expected colours on the batch");
      for (let k = 0; k < batch.count; k++) {
        // x encodes the point index; red encodes it as index / 10.
        const pointIndex = batch.transforms[k * 16 + 12];
        expect(colors[k * 3], `instance ${k} of "${batch.assetId}"`).toBeCloseTo(
          pointIndex / 10,
          6,
        );
      }
    }
    // ...and the permutation really was non-trivial.
    expect(Array.from(batches[0].transforms.filter((_, i) => i % 16 === 12))).toEqual([0, 2]);
  });

  it("missing colorAttr names the param and lists the usable attributes", () => {
    expect(() =>
      buildInstanceBatches(paintedCloud(1), { defaultAssetId: "a", colorAttr: "tint" }),
    ).toThrow(/colorAttr "tint" not found.*colour-compatible shape.*color/s);
  });

  it("a colorAttr of the wrong shape is refused, naming the shape and the rule", () => {
    // density is f32 tuple 1 — numeric, but not three components.
    expect(() =>
      buildInstanceBatches(paintedCloud(1), { defaultAssetId: "a", colorAttr: "density" }),
    ).toThrow(/colorAttr "density" is f32 .*must be f32 with tupleSize >= 3/s);
    // seed is u32 tuple 1.
    expect(() =>
      buildInstanceBatches(paintedCloud(1), { defaultAssetId: "a", colorAttr: "seed" }),
    ).toThrow(/colorAttr "seed" is u32/);
  });
});

describe("buildInstanceBatches instance budget", () => {
  /** Bare cloud of `n` points: only P, so a big one costs 12 bytes each. */
  function bareCloud(n: number): Geometry {
    const geo = new Geometry();
    geo.attrs.point.add("P", "f32", 3);
    geo.attrs.point.resize(n);
    return geo;
  }

  it("refuses a cook over the budget, naming the count, the budget and the fix", () => {
    expect(() => buildInstanceBatches(bareCloud(1_048_577), { defaultAssetId: "a" })).toThrow(
      /1048577 instances.*1048576/s,
    );
    expect(() => buildInstanceBatches(bareCloud(1_048_577), { defaultAssetId: "a" })).toThrow(
      /per COOK/,
    );
  });

  it("fires before allocating: a runaway count throws whatever else is wrong", () => {
    // No assetAttr present either — the budget still decides, and the
    // 16 floats per instance are never reserved.
    expect(() =>
      buildInstanceBatches(bareCloud(4_000_000), { defaultAssetId: "a", assetAttr: "nope" }),
    ).toThrow(/4000000 instances/);
  });

  it("accepts exactly the budget", () => {
    const [batch] = buildInstanceBatches(bareCloud(1_048_576), { defaultAssetId: "a" });
    expect(batch.count).toBe(1_048_576);
  });
});
