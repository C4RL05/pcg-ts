import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, PlaneGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPointCloud,
  createPolyline,
  createTriangleMesh,
  primitiveTypeCounts,
} from "../data/index.js";
import { fromBufferGeometry, fromCurve, toBufferGeometry, toLineGeometry } from "./convert.js";

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

/** Indices as triples, for comparing triangulations by value. */
function triples(index: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < index.length; i += 3) out.push([index[i], index[i + 1], index[i + 2]]);
  return out;
}

/** Indices as pairs, for comparing segment lists by value. */
function pairs(index: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < index.length; i += 2) out.push([index[i], index[i + 1]]);
  return out;
}

describe("toBufferGeometry", () => {
  it("is the inverse of fromBufferGeometry for an indexed box", () => {
    const box = new BoxGeometry(1, 2, 3);
    const back = toBufferGeometry(fromBufferGeometry(box), { normals: false });
    const before = box.getAttribute("position");
    const after = back.getAttribute("position");
    // Every point of the box is referenced by a triangle, so compaction
    // is the identity here and the index buffer must match exactly.
    expect(after.count).toBe(before.count);
    for (let i = 0; i < before.count; i++) {
      expect([after.getX(i), after.getY(i), after.getZ(i)]).toEqual([
        before.getX(i),
        before.getY(i),
        before.getZ(i),
      ]);
    }
    expect(Array.from(back.getIndex()!.array)).toEqual(Array.from(box.getIndex()!.array));
  });

  it("fan-triangulates an n-gon from its first vertex", () => {
    // One quad over four points: 0-1-2-3 becomes (0,1,2) and (0,2,3).
    const geo = new Geometry();
    const P = geo.attrs.point.add("P", "f32", 3);
    geo.attrs.point.resize(4);
    P.data.set([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    geo.setTopology(Uint32Array.of(0, 1, 2, 3), Uint32Array.of(0), Uint32Array.of(4));
    geo.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly");

    const out = toBufferGeometry(geo, { normals: false });
    expect(triples(out.getIndex()!.array)).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it("compacts onto referenced points, remapping colours with them", () => {
    // Four points, one triangle referencing 3, 1, 2. Point 0 is
    // unreferenced: it must not reach the buffer, and the colours must
    // follow the compaction rather than the original point order.
    const geo = createTriangleMesh(
      [0, 9, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0],
      [3, 1, 2],
    );
    const color = geo.attrs.point.add("color", "f32", 4);
    for (let i = 0; i < 4; i++) color.setTuple(i, [i, i * 2, i * 3, 1]);

    const out = toBufferGeometry(geo, { normals: false });
    const pos = out.getAttribute("position");
    expect(pos.count).toBe(3);
    // Points 1, 2, 3 survive in that order; point 0 is gone, so the
    // triangle's (3, 1, 2) becomes (2, 0, 1).
    expect(triples(out.getIndex()!.array)).toEqual([[2, 0, 1]]);
    expect([pos.getX(0), pos.getX(1), pos.getX(2)]).toEqual([1, 2, 3]);
    // Colours are gathered through the same map — reading them in point
    // order instead would start at point 0's black.
    expect(Array.from(out.getAttribute("color").array)).toEqual([1, 2, 3, 2, 4, 6, 3, 6, 9]);
    // The unreferenced point sat at y = 9; a bounding sphere that saw it
    // would be bigger than the triangle.
    out.computeBoundingSphere();
    expect(out.boundingSphere!.center.y).toBe(0);
  });

  it("drops triangles touching a non-finite position and keeps the bounding sphere finite", () => {
    // One bad component per axis in turn: a check that reads only x and y
    // passes the z case, and z is the component a height field ruins.
    for (const bad of [
      [Number.NaN, 0, 2],
      [2, Number.NaN, 2],
      [2, 0, Number.NaN],
    ]) {
      const geo = createTriangleMesh(
        [0, 0, 0, 1, 0, 0, 0, 0, 1, ...bad],
        [0, 1, 2, 0, 2, 3],
      );
      const out = toBufferGeometry(geo, { normals: false });
      expect(triples(out.getIndex()!.array)).toEqual([[0, 1, 2]]);
      expect(out.getAttribute("position").count).toBe(3);
      out.computeBoundingSphere();
      expect(Number.isFinite(out.boundingSphere!.radius)).toBe(true);
    }
  });

  it("keeps the round trip exact when the unreferenced point is in the MIDDLE", () => {
    // A leading unreferenced point shifts every index by one, which a
    // broken remap can still get right. A middle one does not.
    const geo = createTriangleMesh(
      [0, 0, 0, 1, 0, 0, 5, 5, 5, 0, 0, 1, 1, 0, 1],
      [0, 1, 3, 1, 4, 3],
    );
    const out = toBufferGeometry(geo, { normals: false });
    expect(out.getAttribute("position").count).toBe(4);
    expect(triples(out.getIndex()!.array)).toEqual([
      [0, 1, 2],
      [1, 3, 2],
    ]);
  });

  it("refuses a geometry whose tagged polys are all degenerate, without contradicting itself", () => {
    // Tagged "poly" but two vertices: `selects` consults only the tag, so
    // this reaches the walk. Without the vertex-count guard the index
    // buffer is silently truncated instead of refused.
    const geo = new Geometry();
    const P = geo.attrs.point.add("P", "f32", 3);
    geo.attrs.point.resize(4);
    P.data.set([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
    geo.setTopology(Uint32Array.of(0, 1, 2, 0, 3), Uint32Array.of(0, 3), Uint32Array.of(3, 2));
    geo.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly");

    // The 3-vertex one still exports; the 2-vertex one is skipped.
    expect(triples(toBufferGeometry(geo, { normals: false }).getIndex()!.array)).toEqual([
      [0, 1, 2],
    ]);

    const allBad = new Geometry();
    const Q = allBad.attrs.point.add("P", "f32", 3);
    allBad.attrs.point.resize(2);
    Q.data.set([0, 0, 0, 1, 0, 0]);
    allBad.setTopology(Uint32Array.of(0, 1), Uint32Array.of(0), Uint32Array.of(2));
    allBad.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly");
    expect(() => toBufferGeometry(allBad)).toThrow(
      /all 1 "poly" primitive\(s\) have fewer than 3 vertices/,
    );
    // The old message said there were none and then said there was one.
    expect(() => toBufferGeometry(allBad)).not.toThrow(/no "poly" primitives/);
  });

  it("falls back to vertex-count inference when primtype is not a string column", () => {
    // Nothing stops a graph writing an f32 under that name, and reading
    // it as a string throws. Both exporters must survive it.
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);
    geo.attrs.primitive.remove(PRIMTYPE_ATTR);
    geo.attrs.primitive.add(PRIMTYPE_ATTR, "f32", 1, 7);
    expect(primitiveTypeCounts(geo)).toEqual({});
    expect(triples(toBufferGeometry(geo, { normals: false }).getIndex()!.array)).toEqual([
      [0, 1, 2],
    ]);
  });

  it("takes normals from the point attribute, computes them otherwise, and omits them on request", () => {
    const flat = (): Geometry => createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);

    const computed = toBufferGeometry(flat());
    // A triangle in the y = 0 plane wound 0-1-2 faces -y under three's
    // right-handed convention; what matters is that normals exist and
    // are unit length rather than which way they point.
    const n = computed.getAttribute("normal");
    expect(n.count).toBe(3);
    expect(Math.hypot(n.getX(0), n.getY(0), n.getZ(0))).toBeCloseTo(1, 6);

    const authored = flat();
    const normal = authored.attrs.point.add("normal", "f32", 3);
    for (let i = 0; i < 3; i++) normal.setTuple(i, [0, 1, 0]);
    expect(Array.from(toBufferGeometry(authored).getAttribute("normal").array)).toEqual([
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);

    expect(toBufferGeometry(flat(), { normals: false }).getAttribute("normal")).toBeUndefined();
  });

  it("carries the uv point attribute onto the compacted points", () => {
    // meshPrimitive has written `uv` since it shipped and this bridge
    // dropped every one of them, so a textured plane was not expressible
    // in the examples at all. Asserted through the shape a producer
    // actually writes: f32 tuple 2 on the point domain.
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);
    const uv = geo.attrs.point.add("uv", "f32", 2);
    uv.setTuple(0, [0, 0]);
    uv.setTuple(1, [1, 0]);
    uv.setTuple(2, [0, 1]);
    const out = toBufferGeometry(geo, { normals: false });
    expect(Array.from(out.getAttribute("uv").array)).toEqual([0, 0, 1, 0, 0, 1]);

    // Compaction applies to it as it does to position: an unreferenced
    // point takes its uv out of the buffer with it.
    const extra = createTriangleMesh([9, 9, 9, 0, 0, 0, 1, 0, 0, 0, 0, 1], [1, 2, 3]);
    const uv2 = extra.attrs.point.add("uv", "f32", 2);
    for (let i = 0; i < 4; i++) uv2.setTuple(i, [i / 4, 0]);
    const compacted = toBufferGeometry(extra, { normals: false });
    expect(Array.from(compacted.getAttribute("uv").array)).toEqual([0.25, 0, 0.5, 0, 0.75, 0]);

    // No column, no attribute — nothing is invented.
    const bare = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);
    expect(toBufferGeometry(bare, { normals: false }).getAttribute("uv")).toBeUndefined();

    // A wider column contributes its first two components and nothing
    // else — the same "extra components ignored" rule the uv transfer
    // mapping states.
    const wide = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);
    const uv3 = wide.attrs.point.add("uv", "f32", 3);
    uv3.setTuple(0, [0, 0, 9]);
    uv3.setTuple(1, [1, 0, 9]);
    uv3.setTuple(2, [0, 1, 9]);
    const wideOut = toBufferGeometry(wide, { normals: false }).getAttribute("uv");
    expect(wideOut.itemSize).toBe(2);
    expect(Array.from(wideOut.array)).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("carries a swept surface's uv, normal and position together", async () => {
    // The end-to-end reason the uv gap mattered: sweepProfile writes all
    // three, and before this bridge carried uv, two of them arrived.
    const { sweepProfile } = await import("../nodes/index.js");
    const { makeGeometryItem } = await import("../graph/index.js");
    const path = createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const cooked = await sweepProfile.execute({
      inputs: { in: [makeGeometryItem(path)] },
      params: { ...sweepProfile.defaultParams, sides: 6, caps: false },
      seed: 1,
      checkCancelled() {},
    });
    const item = cooked.out?.[0];
    if (item === undefined || item.kind !== "geometry") throw new Error("expected geometry");
    const out = toBufferGeometry(item.geo);
    const uv = out.getAttribute("uv");
    expect(uv.itemSize).toBe(2);
    expect(uv.count).toBe(out.getAttribute("position").count);
    expect(out.getAttribute("normal").count).toBe(uv.count);
    // u is normalized arc length, v runs 0..1 around the profile, and
    // both ends of each range are actually present.
    let minU = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(minU).toBeCloseTo(0, 6);
    expect(maxU).toBeCloseTo(1, 6);
    expect(maxV).toBeCloseTo(1, 6);
  });

  it("refuses a polyline network and a bare cloud, naming the function that does draw them", () => {
    const path = createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(() => toBufferGeometry(path)).toThrow(/toBufferGeometry: no "poly" primitives/);
    expect(() => toBufferGeometry(path)).toThrow(/1 "polyline"/);
    expect(() => toBufferGeometry(path)).toThrow(/toLineGeometry/);

    const cloud = createPointCloud(5);
    expect(() => toBufferGeometry(cloud)).toThrow(/5 point\(s\) and no primitives/);
    expect(() => toBufferGeometry(cloud)).toThrow(/toPointsObject/);
  });

  it("refuses a mesh whose every triangle is non-finite rather than return an empty geometry", () => {
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, Number.NaN, 0, 1], [0, 1, 2]);
    expect(() => toBufferGeometry(geo)).toThrow(/non-finite position/);
  });
});

describe("toLineGeometry", () => {
  it("emits one segment per consecutive vertex pair on an open path", () => {
    const out = toLineGeometry(createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]));
    expect(pairs(out.getIndex()!.array)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(out.getAttribute("position").count).toBe(4);
  });

  it("closes a closed path through the structural wrap vertex", () => {
    const out = toLineGeometry(createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 1], { closed: true }));
    expect(pairs(out.getIndex()!.array)).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  it("walks several polylines and drops segments touching a non-finite position", () => {
    const geo = createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    geo.attrs.point.require("P").setTuple(1, [Number.NaN, 0, 0]);
    expect(() => toLineGeometry(geo)).toThrow(/non-finite position/);

    const mixed = createPolyline([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    mixed.attrs.point.require("P").setTuple(2, [0, Number.NaN, 0]);
    // Segments 1-2 and 2-3 both touch the bad point; 0-1 survives.
    expect(pairs(toLineGeometry(mixed).getIndex()!.array)).toEqual([[0, 1]]);
  });

  it("carries the standard colour attribute unless told not to", () => {
    const geo = createPolyline([0, 0, 0, 1, 0, 0]);
    const color = geo.attrs.point.add("color", "f32", 4);
    color.setTuple(0, [1, 0, 0, 1]);
    color.setTuple(1, [0, 0, 1, 1]);
    expect(Array.from(toLineGeometry(geo).getAttribute("color").array)).toEqual([1, 0, 0, 0, 0, 1]);
    expect(toLineGeometry(geo, { useColor: false }).getAttribute("color")).toBeUndefined();
  });

  it("refuses a triangle mesh, naming the function that does draw it", () => {
    const mesh = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]);
    expect(() => toLineGeometry(mesh)).toThrow(/toLineGeometry: no "polyline" primitives/);
    expect(() => toLineGeometry(mesh)).toThrow(/1 "poly"/);
    expect(() => toLineGeometry(mesh)).toThrow(/toBufferGeometry/);
  });

  it("infers shape from vertex count when the geometry carries no primtype tag", () => {
    // setTopology is public and stamps no tag; refusing it would refuse a
    // legitimate geometry, so vertex count is the only signal left.
    const geo = new Geometry();
    const P = geo.attrs.point.add("P", "f32", 3);
    geo.attrs.point.resize(3);
    P.data.set([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    geo.setTopology(Uint32Array.of(0, 1, 1, 2), Uint32Array.of(0, 2), Uint32Array.of(2, 2));
    expect(geo.attrs.primitive.get(PRIMTYPE_ATTR)).toBeUndefined();
    expect(pairs(toLineGeometry(geo).getIndex()!.array)).toEqual([
      [0, 1],
      [1, 2],
    ]);
    // Two-vertex primitives can never be triangles, so the mesh exporter
    // still finds nothing.
    expect(() => toBufferGeometry(geo)).toThrow(/2 untagged primitive\(s\)/);
  });
});
