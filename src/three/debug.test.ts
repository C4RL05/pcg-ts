import { describe, expect, it } from "vitest";
import { Geometry, createPointCloud } from "../data/index.js";
import { toPointsObject } from "./debug.js";

describe("toPointsObject", () => {
  function coloredCloud(): Geometry {
    const geo = createPointCloud(2);
    geo.attrs.point.require("P").setTuple(0, [1, 2, 3]);
    geo.attrs.point.require("P").setTuple(1, [4, 5, 6]);
    geo.attrs.point.require("color").setTuple(0, [1, 0, 0, 1]);
    geo.attrs.point.require("color").setTuple(1, [0, 0.5, 1, 0.25]);
    return geo;
  }

  it("copies P into the position attribute and rgba color into rgb vertex colors", () => {
    const points = toPointsObject(coloredCloud());
    const pos = points.geometry.getAttribute("position");
    expect(pos.count).toBe(2);
    expect(Array.from(pos.array as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);
    const color = points.geometry.getAttribute("color");
    expect(Array.from(color.array as Float32Array)).toEqual([1, 0, 0, 0, 0.5, 1]);
    expect(points.material.vertexColors).toBe(true);
    expect(points.material.size).toBe(0.1);
  });

  it("honors size and useColor options", () => {
    const points = toPointsObject(coloredCloud(), { size: 2, useColor: false });
    expect(points.material.size).toBe(2);
    expect(points.material.vertexColors).toBe(false);
    expect(points.geometry.getAttribute("color")).toBeUndefined();
  });

  it("copies the data: mutating the source afterwards leaves the buffer intact", () => {
    const geo = coloredCloud();
    const points = toPointsObject(geo);
    geo.attrs.point.require("P").setTuple(0, [9, 9, 9]);
    expect((points.geometry.getAttribute("position").array as Float32Array)[0]).toBe(1);
  });

  it("throws without a P attribute", () => {
    expect(() => toPointsObject(new Geometry())).toThrow(/"P"/);
  });
});
