import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, PlaneGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PRIMTYPE_ATTR } from "../data/index.js";
import { fromBufferGeometry, fromCurve } from "./convert.js";

describe("fromBufferGeometry", () => {
  it("converts an indexed BoxGeometry (24 points, 36 vertices, 12 triangles)", () => {
    const box = new BoxGeometry(1, 2, 3);
    const geo = fromBufferGeometry(box);
    expect(geo.pointCount).toBe(24);
    expect(geo.vertexCount).toBe(36);
    expect(geo.primitiveCount).toBe(12);
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("poly");
    // Positions round-trip exactly.
    const P = geo.attrs.point.require("P");
    const pos = box.getAttribute("position");
    for (let i = 0; i < 24; i++) {
      expect(P.get(i, 0)).toBe(pos.getX(i));
      expect(P.get(i, 1)).toBe(pos.getY(i));
      expect(P.get(i, 2)).toBe(pos.getZ(i));
    }
    // Index buffer round-trips into vertexToPoint.
    expect(Array.from(geo.vertexToPoint)).toEqual(Array.from(box.getIndex()!.array));
  });

  it("generates sequential indices for a non-indexed geometry", () => {
    const plane = new PlaneGeometry().toNonIndexed();
    expect(plane.getIndex()).toBeNull();
    const geo = fromBufferGeometry(plane);
    expect(geo.pointCount).toBe(6);
    expect(geo.vertexCount).toBe(6);
    expect(geo.primitiveCount).toBe(2);
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("throws actionable errors for missing position and non-triangle counts", () => {
    expect(() => fromBufferGeometry(new BufferGeometry())).toThrow(/"position"/);

    const badIndexed = new BufferGeometry();
    badIndexed.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    badIndexed.setIndex([0, 1]);
    expect(() => fromBufferGeometry(badIndexed)).toThrow(/multiple of 3/);

    const badNonIndexed = new BufferGeometry();
    badNonIndexed.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3),
    );
    expect(() => fromBufferGeometry(badNonIndexed)).toThrow(/multiple of 3/);
  });
});

describe("fromCurve", () => {
  const controls = [
    new Vector3(0, 0, 0),
    new Vector3(1, 1, 0),
    new Vector3(2, 0, 1),
    new Vector3(3, 1, 1),
  ];

  it("samples an open curve into segments + 1 points on one polyline", () => {
    const curve = new CatmullRomCurve3(controls);
    const geo = fromCurve(curve, 8);
    expect(geo.pointCount).toBe(9);
    expect(geo.vertexCount).toBe(9);
    expect(geo.primitiveCount).toBe(1);
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("polyline");
    // Endpoints match the curve's own endpoints (getSpacedPoints samples t=0..1).
    const P = geo.attrs.point.require("P");
    const start = curve.getPoint(0);
    const end = curve.getPoint(1);
    expect(P.get(0, 0)).toBeCloseTo(start.x, 5);
    expect(P.get(0, 1)).toBeCloseTo(start.y, 5);
    expect(P.get(8, 0)).toBeCloseTo(end.x, 5);
    expect(P.get(8, 2)).toBeCloseTo(end.z, 5);
  });

  it("drops the duplicated final sample of a closed curve and closes the polyline", () => {
    const curve = new CatmullRomCurve3(controls, true);
    const geo = fromCurve(curve, 8, true);
    expect(geo.pointCount).toBe(8);
    // The closing wrap vertex references point 0.
    expect(geo.vertexCount).toBe(9);
    expect(geo.vertexToPoint[8]).toBe(0);
    expect(geo.primitiveCount).toBe(1);
  });

  it("rejects too-small or fractional segment counts", () => {
    const curve = new CatmullRomCurve3(controls);
    expect(() => fromCurve(curve, 0)).toThrow(/segments/);
    expect(() => fromCurve(curve, 2.5)).toThrow(/segments/);
    expect(() => fromCurve(curve, 2, true)).toThrow(/segments/);
  });
});
