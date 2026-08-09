import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPolyline,
  createTriangleMesh,
  setPolylineTopology,
} from "./geometry.js";

// Unit quad split into two triangles sharing the edge (p1, p2).
const QUAD_POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
const QUAD_TRIANGLES = [0, 1, 2, 2, 1, 3];

describe("Geometry", () => {
  it("starts empty with a single detail element", () => {
    const geo = new Geometry();
    expect(geo.pointCount).toBe(0);
    expect(geo.vertexCount).toBe(0);
    expect(geo.primitiveCount).toBe(0);
    expect(geo.attrs.detail.count).toBe(1);
    expect(geo.vertexToPoint.length).toBe(0);
  });

  it("copies topology arrays defensively", () => {
    const geo = new Geometry();
    geo.attrs.point.resize(3);
    const vertexToPoint = Uint32Array.of(0, 1, 2);
    const primVertexStart = Uint32Array.of(0);
    const primVertexCount = Uint32Array.of(3);
    geo.setTopology(vertexToPoint, primVertexStart, primVertexCount);
    // Caller-side mutation after the call must not corrupt the geometry.
    vertexToPoint[0] = 99;
    primVertexStart[0] = 7;
    primVertexCount[0] = 1;
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2]);
    expect(Array.from(geo.primVertexStart)).toEqual([0]);
    expect(Array.from(geo.primVertexCount)).toEqual([3]);
  });

  it("validates topology references", () => {
    const geo = new Geometry();
    geo.attrs.point.resize(3);
    expect(() =>
      geo.setTopology(Uint32Array.of(0, 1, 3), Uint32Array.of(0), Uint32Array.of(3)),
    ).toThrow(/references point 3/);
    expect(() =>
      geo.setTopology(Uint32Array.of(0, 1, 2), Uint32Array.of(0), Uint32Array.of(4)),
    ).toThrow(/vertex range exceeds/);
    expect(() =>
      geo.setTopology(Uint32Array.of(0), Uint32Array.of(0, 1), Uint32Array.of(1)),
    ).toThrow(/lengths differ/);
  });
});

describe("createTriangleMesh", () => {
  it("builds the expected domains and topology", () => {
    const geo = createTriangleMesh(QUAD_POSITIONS, QUAD_TRIANGLES);
    expect(geo.pointCount).toBe(4);
    expect(geo.vertexCount).toBe(6);
    expect(geo.primitiveCount).toBe(2);
    expect(geo.attrs.detail.count).toBe(1);
    expect(Array.from(geo.vertexToPoint)).toEqual(QUAD_TRIANGLES);
    expect(Array.from(geo.primVertexStart)).toEqual([0, 3]);
    expect(Array.from(geo.primVertexCount)).toEqual([3, 3]);
  });

  it("round-trips positions through P", () => {
    const geo = createTriangleMesh(QUAD_POSITIONS, QUAD_TRIANGLES);
    const P = geo.attrs.point.require("P");
    expect(P.type).toBe("f32");
    expect(P.tupleSize).toBe(3);
    expect(P.getTuple(0)).toEqual([0, 0, 0]);
    expect(P.getTuple(3)).toEqual([1, 1, 0]);
  });

  it("tags primitives as poly", () => {
    const geo = createTriangleMesh(QUAD_POSITIONS, QUAD_TRIANGLES);
    const primtype = geo.attrs.primitive.require(PRIMTYPE_ATTR);
    expect(primtype.getString(0)).toBe("poly");
    expect(primtype.getString(1)).toBe("poly");
  });

  it("rejects malformed input", () => {
    expect(() => createTriangleMesh([0, 0], [])).toThrow(/multiple of 3/);
    expect(() => createTriangleMesh(QUAD_POSITIONS, [0, 1])).toThrow(/multiple of 3/);
    expect(() => createTriangleMesh(QUAD_POSITIONS, [0, 1, 4])).toThrow(/out of range/);
  });
});

describe("createPolyline", () => {
  const POSITIONS = [0, 0, 0, 1, 0, 0, 2, 1, 0, 3, 1, 1];

  it("builds an open polyline", () => {
    const geo = createPolyline(POSITIONS);
    expect(geo.pointCount).toBe(4);
    expect(geo.vertexCount).toBe(4);
    expect(geo.primitiveCount).toBe(1);
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2, 3]);
    expect(Array.from(geo.primVertexStart)).toEqual([0]);
    expect(Array.from(geo.primVertexCount)).toEqual([4]);
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("polyline");
    expect(geo.attrs.point.require("P").getTuple(2)).toEqual([2, 1, 0]);
  });

  it("closes with an extra vertex back to point 0", () => {
    const geo = createPolyline(POSITIONS, { closed: true });
    expect(geo.pointCount).toBe(4);
    expect(geo.vertexCount).toBe(5);
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2, 3, 0]);
    expect(Array.from(geo.primVertexCount)).toEqual([5]);
  });

  it("rejects malformed input", () => {
    expect(() => createPolyline([0, 0, 0])).toThrow(/at least 2 points/);
    expect(() => createPolyline([0, 0])).toThrow(/multiple of 3/);
  });
});

describe("setPolylineTopology", () => {
  /** Five points in a row, carrying a non-standard attribute. */
  function cloud(): Geometry {
    const geo = new Geometry();
    const P = geo.attrs.point.add("P", "f32", 3);
    const tag = geo.attrs.point.add("tag", "i32", 1, -1);
    geo.attrs.point.resize(5);
    for (let i = 0; i < 5; i++) {
      P.setTuple(i, [i, 0, 0]);
      tag.set(i, i * 10);
    }
    return geo;
  }

  it("builds several polylines over the geometry's own points", () => {
    const geo = cloud();
    setPolylineTopology(geo, [0, 1, 2, 3, 4, 3], [0, 4], [4, 2]);
    expect(Array.from(geo.vertexToPoint)).toEqual([0, 1, 2, 3, 4, 3]);
    expect(Array.from(geo.primVertexStart)).toEqual([0, 4]);
    expect(Array.from(geo.primVertexCount)).toEqual([4, 2]);
    const primType = geo.attrs.primitive.require(PRIMTYPE_ATTR);
    expect([0, 1].map((p) => primType.getString(p))).toEqual(["polyline", "polyline"]);
  });

  it("keeps every point attribute, including non-standard ones", () => {
    const geo = cloud();
    setPolylineTopology(geo, [0, 1, 2, 3, 4], [0], [5]);
    expect(geo.pointCount).toBe(5);
    expect(geo.attrs.point.require("P").getTuple(3)).toEqual([3, 0, 0]);
    expect(geo.attrs.point.require("tag").get(3)).toBe(30);
  });

  it("carries structural closure with no closed attribute", () => {
    const geo = cloud();
    setPolylineTopology(geo, [0, 1, 2, 0], [0], [4]);
    expect(geo.vertexToPoint[0]).toBe(geo.vertexToPoint[3]);
    // The only primitive attribute is the type; closure lives in topology.
    expect(geo.attrs.primitive.names()).toEqual([PRIMTYPE_ATTR]);
  });

  it("drops vertex and primitive attributes of the topology it replaces", () => {
    const geo = createTriangleMesh(QUAD_POSITIONS, QUAD_TRIANGLES);
    geo.attrs.vertex.add("corner", "i32", 1, 7);
    geo.attrs.primitive.add("area", "f32", 1, 0.5);
    setPolylineTopology(geo, [0, 1, 3, 2], [0], [4]);
    expect(geo.attrs.vertex.names()).toEqual([]);
    expect(geo.attrs.primitive.names()).toEqual([PRIMTYPE_ATTR]);
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("polyline");
    expect(geo.pointCount).toBe(4);
  });

  it("rejects malformed topology with an actionable message", () => {
    expect(() => setPolylineTopology(cloud(), [0, 1], [0], [2, 2])).toThrow(
      /one entry per polyline/,
    );
    expect(() => setPolylineTopology(cloud(), [0, 1, 2], [0, 2], [2, 1])).toThrow(
      /polyline 1 has 1 vertices; a polyline needs at least 2/,
    );
    expect(() => setPolylineTopology(cloud(), [0, 9], [0], [2])).toThrow(
      /references point 9, which is not a whole number in \[0, 5\)/,
    );
    expect(() => setPolylineTopology(cloud(), [0, 1.5], [0], [2])).toThrow(/not a whole number/);
    expect(() => setPolylineTopology(cloud(), [0, 1, 2], [1], [3])).toThrow(
      /spans vertices \[1, 4\) but only 3 vertex indices were given/,
    );
  });
});
