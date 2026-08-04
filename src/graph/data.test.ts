import { describe, expect, it } from "vitest";
import { createPointCloud, createTriangleMesh } from "../data/index.js";
import { cloneGeometry } from "./clone.js";
import { filterByTag, firstGeometry, makeGeometryItem, makeValueItem } from "./data.js";

describe("data items", () => {
  it("assigns strictly increasing revs", () => {
    const a = makeValueItem(1);
    const b = makeValueItem(2);
    const c = makeGeometryItem(createPointCloud(1));
    expect(b.rev).toBeGreaterThan(a.rev);
    expect(c.rev).toBeGreaterThan(b.rev);
  });

  it("defaults to no tags and copies given tags", () => {
    expect(makeValueItem(0).tags.size).toBe(0);
    const item = makeValueItem(0, ["a", "b"]);
    expect(item.tags.has("a")).toBe(true);
    expect(item.tags.has("b")).toBe(true);
    expect(item.tags.has("c")).toBe(false);
  });

  it("filterByTag keeps only tagged items, in order", () => {
    const a = makeValueItem(1, ["x"]);
    const b = makeValueItem(2);
    const c = makeValueItem(3, ["x", "y"]);
    expect(filterByTag([a, b, c], "x")).toEqual([a, c]);
    expect(filterByTag([a, b, c], "z")).toEqual([]);
  });

  it("firstGeometry skips value items", () => {
    const geo = createPointCloud(2);
    const coll = [makeValueItem(1), makeGeometryItem(geo), makeGeometryItem(createPointCloud(3))];
    expect(firstGeometry(coll)).toBe(geo);
    expect(firstGeometry([makeValueItem(1)])).toBeUndefined();
  });
});

describe("cloneGeometry", () => {
  function makeMesh() {
    // Two triangles sharing an edge.
    const geo = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
      [0, 1, 2, 1, 3, 2],
    );
    const density = geo.attrs.point.add("density", "f32", 1, 0.5);
    for (let i = 0; i < geo.pointCount; i++) density.set(i, i * 0.25);
    return geo;
  }

  it("copies attributes, topology, and string tables", () => {
    const src = makeMesh();
    const dst = cloneGeometry(src);
    expect(dst.pointCount).toBe(src.pointCount);
    expect(dst.vertexCount).toBe(src.vertexCount);
    expect(dst.primitiveCount).toBe(src.primitiveCount);
    expect([...dst.vertexToPoint]).toEqual([...src.vertexToPoint]);
    expect([...dst.primVertexStart]).toEqual([...src.primVertexStart]);
    expect([...dst.primVertexCount]).toEqual([...src.primVertexCount]);
    expect(dst.attrs.point.names()).toEqual(src.attrs.point.names());
    const n = src.pointCount * 3;
    expect([...dst.attrs.point.require("P").data.subarray(0, n)]).toEqual([
      ...src.attrs.point.require("P").data.subarray(0, n),
    ]);
    expect(dst.attrs.primitive.require("primtype").getString(0)).toBe("poly");
    expect(dst.attrs.primitive.require("primtype").getString(1)).toBe("poly");
  });

  it("is a deep copy: mutating the clone leaves the source intact", () => {
    const src = makeMesh();
    const dst = cloneGeometry(src);
    dst.attrs.point.require("P").set(0, 99);
    dst.attrs.point.require("density").set(1, 99);
    dst.vertexToPoint[0] = 3;
    dst.attrs.primitive.require("primtype").setString(0, "polyline");
    expect(src.attrs.point.require("P").get(0)).toBe(0);
    expect(src.attrs.point.require("density").get(1)).toBe(0.25);
    expect(src.vertexToPoint[0]).toBe(0);
    expect(src.attrs.primitive.require("primtype").getString(0)).toBe("poly");
  });

  it("preserves attribute defaults", () => {
    const src = makeMesh();
    const dst = cloneGeometry(src);
    dst.attrs.point.resize(src.pointCount + 1);
    expect(dst.attrs.point.require("density").get(src.pointCount)).toBe(0.5);
  });
});
