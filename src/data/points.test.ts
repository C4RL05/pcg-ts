import { describe, expect, it } from "vitest";
import { STANDARD_POINT_ATTRS, createPointCloud } from "./points.js";

describe("createPointCloud", () => {
  it("creates a points-only geometry", () => {
    const geo = createPointCloud(5);
    expect(geo.pointCount).toBe(5);
    expect(geo.vertexCount).toBe(0);
    expect(geo.primitiveCount).toBe(0);
    expect(geo.attrs.detail.count).toBe(1);
  });

  it("declares the standard attributes in a stable order", () => {
    const geo = createPointCloud(1);
    expect(geo.attrs.point.names()).toEqual([
      "P",
      "rot",
      "scale",
      "density",
      "boundsMin",
      "boundsMax",
      "color",
      "seed",
    ]);
    expect(geo.attrs.point.names()).toEqual(STANDARD_POINT_ATTRS.map((s) => s.name));
  });

  it("uses the documented types and tuple sizes", () => {
    const points = createPointCloud(1).attrs.point;
    for (const spec of STANDARD_POINT_ATTRS) {
      const attr = points.require(spec.name);
      expect(attr.type, spec.name).toBe(spec.type);
      expect(attr.tupleSize, spec.name).toBe(spec.tupleSize);
    }
    expect(points.require("P").data).toBeInstanceOf(Float32Array);
    expect(points.require("seed").data).toBeInstanceOf(Uint32Array);
  });

  it("initializes every point to the standard defaults", () => {
    const points = createPointCloud(5).attrs.point;
    for (const i of [0, 4]) {
      expect(points.require("P").getTuple(i)).toEqual([0, 0, 0]);
      expect(points.require("rot").getTuple(i)).toEqual([0, 0, 0, 1]);
      expect(points.require("scale").getTuple(i)).toEqual([1, 1, 1]);
      expect(points.require("density").get(i)).toBe(1);
      expect(points.require("boundsMin").getTuple(i)).toEqual([0, 0, 0]);
      expect(points.require("boundsMax").getTuple(i)).toEqual([0, 0, 0]);
      expect(points.require("color").getTuple(i)).toEqual([1, 1, 1, 1]);
      expect(points.require("seed").get(i)).toBe(0);
    }
  });

  it("applies defaults to points added by resize", () => {
    const geo = createPointCloud(2);
    const points = geo.attrs.point;
    points.require("density").set(0, 0.25);
    points.resize(9);
    expect(points.require("density").get(0)).toBe(0.25);
    expect(points.require("density").get(8)).toBe(1);
    expect(points.require("rot").getTuple(8)).toEqual([0, 0, 0, 1]);
    expect(points.require("color").getTuple(8)).toEqual([1, 1, 1, 1]);
  });
});
