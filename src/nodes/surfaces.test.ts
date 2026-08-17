/**
 * sweepProfile and extrudePolygon — the two producers that make a
 * surface. What is asserted here is what the rest of the library depends
 * on rather than what the implementation happens to do: 3-vertex `poly`
 * primitives (so surfaceSample and the mesh transfer mappings can SEE the
 * result), outward-facing winding, the attribute rules across the
 * dimension change, and determinism under a shuffled input.
 */
import { describe, expect, it } from "vitest";
import {
  PRIMTYPE_ATTR,
  createPolyline,
  primitiveTypeCounts,
  setPolylineTopology,
  type Geometry,
} from "../data/index.js";
import { attribute, constant } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import {
  extrudePolygon,
  surfaceSample,
  sweepProfile,
  writeCurveFrame,
  type ExtrudePolygonParams,
  type SweepProfileParams,
} from "./index.js";
import { firstGeo, runNode, snapshotGeometry } from "./nodes.testsupport.js";

/** A straight open path along +x with `n` evenly spaced points. */
function straight(n: number, step = 1): Geometry {
  const pos: number[] = [];
  for (let i = 0; i < n; i++) pos.push(i * step, 0, 0);
  return createPolyline(pos);
}

/** The unit square in the xz plane, wound so its Newell normal is +y. */
function unitSquare(): Geometry {
  return createPolyline([0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1], { closed: true });
}

async function sweep(
  input: Geometry,
  params: Partial<SweepProfileParams> = {},
): Promise<Geometry> {
  return firstGeo((await runNode(sweepProfile, params, { in: [makeGeometryItem(input)] })).out);
}

async function extrude(
  input: Geometry,
  params: Partial<ExtrudePolygonParams> = {},
): Promise<Geometry> {
  return firstGeo((await runNode(extrudePolygon, params, { in: [makeGeometryItem(input)] })).out);
}

/** Unit normal of triangle `t`, from its winding. */
function triangleNormal(geo: Geometry, t: number): number[] {
  const P = geo.attrs.point.require("P");
  const v = geo.primVertexStart[t];
  const [a, b, c] = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len === 0 ? n : n.map((k) => k / len);
}

/** Every triangle is 3-vertex `poly` — the constraint the consumers impose. */
function expectTriangleMesh(geo: Geometry): void {
  expect(primitiveTypeCounts(geo)).toEqual({ poly: geo.primitiveCount });
  for (let p = 0; p < geo.primitiveCount; p++) expect(geo.primVertexCount[p]).toBe(3);
  expect(geo.vertexCount).toBe(geo.primitiveCount * 3);
}

/**
 * The written `normal` points the same way the winding does, on every
 * triangle. This is the assertion that a surface is not shaded
 * inside-out, and it is separate from "the winding faces outward"
 * because the two can disagree while each looks right alone: a ribbon
 * whose band is stitched the wrong way round has a perfectly sensible
 * normal column and a face pointing at exactly minus it. Zero-area
 * triangles have no winding to compare against and are skipped — they
 * draw nothing and area-weighted sampling ignores them.
 */
function expectNormalsMatchWinding(geo: Geometry, label: string): void {
  const N = geo.attrs.point.require("normal");
  let compared = 0;
  for (let t = 0; t < geo.primitiveCount; t++) {
    const face = triangleNormal(geo, t);
    if (Math.hypot(...face) < 0.5) continue; // degenerate: no winding
    const v = geo.primVertexStart[t];
    const mean = [0, 1, 2].map((k) => {
      let s = 0;
      for (let c = 0; c < 3; c++) s += N.get(geo.vertexToPoint[v + c], k);
      return s / 3;
    });
    const len = Math.hypot(...mean);
    expect(len, `${label}: triangle ${t} has a zero written normal`).toBeGreaterThan(0.5);
    const dot = (face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2]) / len;
    expect(dot, `${label}: triangle ${t} winding disagrees with its normal`).toBeGreaterThan(0);
    compared++;
  }
  expect(compared, `${label}: nothing was compared`).toBeGreaterThan(0);
}

/** Byte-exact snapshot of an input, to prove a node never touched it. */
function expectUntouched(before: Record<string, unknown>, geo: Geometry, label: string): void {
  expect(snapshotGeometry(geo), `${label} mutated its input`).toEqual(before);
}

describe("sweepProfile shape and counts", () => {
  it("puts one ring on each point and stitches the bands between them", async () => {
    const geo = await sweep(straight(4));
    // 4 rings of 9 points (8 sides + the duplicated uv seam), plus two
    // caps of 8 + 1. 3 bands x 8 x 2 side triangles, plus 8 per cap.
    expect(geo.pointCount).toBe(4 * 9 + 2 * 9);
    expect(geo.primitiveCount).toBe(3 * 8 * 2 + 2 * 8);
    expectTriangleMesh(geo);
  });

  it("does not resample: ring count follows the input point count exactly", async () => {
    for (const n of [2, 5, 17]) {
      const geo = await sweep(straight(n), { caps: false });
      expect(geo.pointCount).toBe(n * 9);
      expect(geo.primitiveCount).toBe((n - 1) * 8 * 2);
    }
  });

  it("shares the first and last ring of a CLOSED path, so no seam ring is emitted", async () => {
    const geo = await sweep(unitSquare(), { caps: true });
    // 4 distinct points -> 4 rings, 4 bands (the closing one included),
    // and caps are ignored because a closed path has no ends.
    expect(geo.pointCount).toBe(4 * 9);
    expect(geo.primitiveCount).toBe(4 * 8 * 2);
  });

  it("caps only an open path with a closed profile", async () => {
    const open = straight(3);
    const capped = await sweep(open, { caps: true });
    const bare = await sweep(open, { caps: false });
    expect(capped.primitiveCount - bare.primitiveCount).toBe(16);
    // A ribbon has no inside, so `caps` cannot add anything to one.
    const ribbon = await sweep(open, { profile: "ribbon", caps: true });
    expect(ribbon.pointCount).toBe(3 * 2);
    expect(ribbon.primitiveCount).toBe(2 * 1 * 2);
  });

  it("gives a square profile flat faces by duplicating its corners", async () => {
    const geo = await sweep(straight(2), { profile: "square", caps: false });
    expect(geo.pointCount).toBe(2 * 8);
    expect(geo.primitiveCount).toBe(1 * 4 * 2);
    // Four distinct face normals, each appearing on four points.
    const N = geo.attrs.point.require("normal");
    const seen = new Map<string, number>();
    for (let i = 0; i < geo.pointCount; i++) {
      const key = N.getTuple(i)
        .map((v) => Math.round(v * 1e6) / 1e6 + 0)
        .join(",");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(seen.size).toBe(4);
    for (const count of seen.values()) expect(count).toBe(4);
  });
});

describe("sweepProfile geometry", () => {
  it("holds the radius exactly on every ring point of a straight tube", async () => {
    const geo = await sweep(straight(3), { radius: 0.25, caps: false });
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < geo.pointCount; i++) {
      const [x, y, z] = P.getTuple(i);
      // The path runs along +x, so the section lies in the yz plane.
      expect(Math.hypot(y, z)).toBeCloseTo(0.25, 6);
      expect(x).toBeCloseTo(Math.floor(i / 9), 6);
    }
  });

  it("winds every triangle outward", async () => {
    const geo = await sweep(straight(3), { radius: 0.25 });
    const P = geo.attrs.point.require("P");
    for (let t = 0; t < geo.primitiveCount; t++) {
      const n = triangleNormal(geo, t);
      const v = geo.primVertexStart[t];
      // Centroid, versus the axis point at the same x — the outward
      // direction for a tube around the x axis.
      const pts = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
      const c = [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k]) / 3);
      const radial = [0, c[1], c[2]];
      const rl = Math.hypot(radial[1], radial[2]);
      // Cap triangles point along the axis; wall triangles point radially.
      const dot =
        rl > 1e-9
          ? (n[1] * radial[1] + n[2] * radial[2]) / rl
          : 0;
      const axial = n[0] * (c[0] > 1 ? 1 : -1);
      expect(Math.max(dot, axial)).toBeGreaterThan(0.5);
    }
  });

  it("miters a right-angle bend so the section keeps its radius", async () => {
    const bend = createPolyline([-1, 0, 0, 0, 0, 0, 0, 0, -1]);
    const r = 0.2;
    const mitered = await sweep(bend, { radius: r, joint: "miter", caps: false });
    const pinched = await sweep(bend, { radius: r, joint: "perpendicular", caps: false });
    // The middle ring is points 9..17. Its widest half-extent should be
    // r / cos(45 deg) mitered and r perpendicular.
    const widest = (geo: Geometry): number => {
      const P = geo.attrs.point.require("P");
      let max = 0;
      for (let i = 9; i < 18; i++) {
        const [x, y, z] = P.getTuple(i);
        max = Math.max(max, Math.hypot(x, y, z));
      }
      return max;
    };
    expect(widest(mitered)).toBeCloseTo(r / Math.cos(Math.PI / 4), 5);
    expect(widest(pinched)).toBeCloseTo(r, 5);
  });

  it("falls back to the unstretched section past miterLimit", async () => {
    // A 170-degree turn wants a stretch of about 11.5.
    const a = Math.PI - 170 * (Math.PI / 180);
    const hairpin = createPolyline([-1, 0, 0, 0, 0, 0, -Math.cos(a), 0, Math.sin(a)]);
    const limited = await sweep(hairpin, { radius: 0.2, miterLimit: 4, caps: false });
    const loose = await sweep(hairpin, { radius: 0.2, miterLimit: 64, caps: false });
    const widest = (geo: Geometry): number => {
      const P = geo.attrs.point.require("P");
      let max = 0;
      for (let i = 9; i < 18; i++) max = Math.max(max, Math.hypot(...P.getTuple(i)));
      return max;
    };
    expect(widest(limited)).toBeCloseTo(0.2, 5);
    expect(widest(loose)).toBeGreaterThan(1);
  });

  it("writes u as normalized arc length and v around the profile", async () => {
    const geo = await sweep(straight(3, 2), { caps: false });
    const uv = geo.attrs.point.require("uv");
    expect(uv.tupleSize).toBe(2);
    for (const [ring, u] of [
      [0, 0],
      [1, 0.5],
      [2, 1],
    ] as const) {
      for (let i = 0; i <= 8; i++) {
        expect(uv.get(ring * 9 + i, 0)).toBeCloseTo(u, 6);
        expect(uv.get(ring * 9 + i, 1)).toBeCloseTo(i / 8, 6);
      }
    }
  });

  it("duplicates the seam column at the same position with a different v", async () => {
    const geo = await sweep(straight(2), { caps: false });
    const P = geo.attrs.point.require("P");
    const uv = geo.attrs.point.require("uv");
    expect(P.getTuple(8)).toEqual(P.getTuple(0));
    expect(uv.get(0, 1)).toBe(0);
    expect(uv.get(8, 1)).toBe(1);
  });

  it("turns the profile with roll without moving the ring plane", async () => {
    const flat = await sweep(straight(2), { profile: "ribbon", width: 2, roll: 0 });
    const turned = await sweep(straight(2), { profile: "ribbon", width: 2, roll: 0.25 });
    // A quarter turn takes the strip from spanning one axis to the other.
    const span = (geo: Geometry, k: number): number => {
      const P = geo.attrs.point.require("P");
      return Math.abs(P.get(0, k) - P.get(1, k));
    };
    expect(span(flat, 1) + span(flat, 2)).toBeCloseTo(2, 6);
    expect(span(turned, 1) + span(turned, 2)).toBeCloseTo(2, 6);
    expect(span(flat, 1)).not.toBeCloseTo(span(turned, 1), 3);
  });
});

describe("sweepProfile attributes", () => {
  it("copies input point attributes around the ring without interpolating", async () => {
    const path = straight(3);
    const tag = path.attrs.point.add("tag", "f32", 1, 0);
    tag.data.set([10, 20, 30]);
    const geo = await sweep(path, { caps: false });
    const out = geo.attrs.point.require("tag");
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < 9; i++) expect(out.get(ring * 9 + i, 0)).toBe([10, 20, 30][ring]);
    }
  });

  it("gathers input primitive attributes onto the triangles that came from them", async () => {
    const two = twoPaths();
    const width = two.attrs.primitive.add("roadWidth", "f32", 1, 0);
    width.data.set([1.5, 2.5]);
    const geo = await sweep(two, { caps: false });
    const carried = geo.attrs.primitive.require("roadWidth");
    // Not just the SET of values: each triangle must carry the width of
    // the path it actually came from, which a shuffled gather would fail
    // while still producing the right two numbers. Path 0 runs along
    // z = 0 and path 1 along z = 5, so the geometry says which is which.
    const P = geo.attrs.point.require("P");
    for (let p = 0; p < geo.primitiveCount; p++) {
      const z = P.get(geo.vertexToPoint[geo.primVertexStart[p]], 2);
      expect(carried.get(p, 0), `triangle ${p} at z=${z}`).toBe(z < 2.5 ? 1.5 : 2.5);
    }
    // `primtype` is the one primitive attribute never carried; the node
    // stamps its own.
    expect(geo.attrs.primitive.require(PRIMTYPE_ATTR).getString(0)).toBe("poly");
  });

  it("drops input vertex attributes and carries detail through 1:1", async () => {
    const path = straight(3);
    path.attrs.vertex.add("vtag", "f32", 1, 7);
    path.attrs.detail.add("dtag", "f32", 1, 0).data.set([42]);
    const geo = await sweep(path, { caps: false });
    expect(geo.attrs.vertex.names()).toEqual([]);
    expect(geo.attrs.detail.require("dtag").get(0, 0)).toBe(42);
  });

  it("refuses an input already carrying normal or uv at another shape", async () => {
    const withNormal = straight(3);
    withNormal.attrs.point.add("normal", "f32", 1, 0);
    await expect(sweep(withNormal)).rejects.toThrow(/sweepProfile:.*"normal".*already exists/s);
    const withUv = straight(3);
    withUv.attrs.point.add("uv", "f32", 3, 0);
    await expect(sweep(withUv)).rejects.toThrow(/sweepProfile:.*"uv".*already exists/s);
  });

  it("accepts and overwrites an input carrying normal or uv at the SAME shape", async () => {
    const path = straight(3);
    path.attrs.point.add("normal", "f32", 3, [9, 9, 9]);
    path.attrs.point.add("uv", "f32", 2, [9, 9]);
    const geo = await sweep(path, { caps: false });
    expect(geo.attrs.point.require("normal").getTuple(0)).not.toEqual([9, 9, 9]);
    expect(geo.attrs.point.require("uv").getTuple(0)).toEqual([0, 0]);
  });

  it("keeps a primitive attribute named like a written point column apart from it", async () => {
    // The two live on different domains, so this is not the collision
    // carryPrimitiveAttributes refuses — and a silent merge would be the
    // worse answer, so it is asserted rather than assumed.
    const path = straight(3);
    path.attrs.primitive.add("normal", "f32", 3, 0).data.set([5, 6, 7]);
    const geo = await sweep(path, { caps: false });
    expect(geo.attrs.primitive.require("normal").getTuple(0)).toEqual([5, 6, 7]);
    expect(geo.attrs.point.require("normal").getTuple(0)).not.toEqual([5, 6, 7]);
  });
});

describe("sweepProfile frames", () => {
  it("reads curveNormal when asked, and names the fix when it is missing", async () => {
    await expect(sweep(straight(3), { frame: "curveFrame" })).rejects.toThrow(
      /writeCurveFrame/,
    );
    const framed = firstGeo(
      (await runNode(writeCurveFrame, {}, { in: [makeGeometryItem(straight(3))] })).out,
    );
    const geo = await sweep(framed, { frame: "curveFrame", profile: "ribbon", caps: false });
    expect(geo.primitiveCount).toBe(2 * 2);
  });

  it("refuses frame 'rot' on an input with no rot attribute", async () => {
    const bare = createPolyline([0, 0, 0, 1, 0, 0]);
    await expect(sweep(bare, { frame: "rot" })).rejects.toThrow(/orientAlongVector/);
  });
});

describe("sweepProfile is visible to the library's own consumers", () => {
  it("can be surface-sampled, which 3-vertex poly is the whole requirement for", async () => {
    const tube = await sweep(straight(6), { radius: 0.5 });
    const cloud = firstGeo(
      (await runNode(surfaceSample, { count: 200 }, { in: [makeGeometryItem(tube)] })).out,
    );
    expect(cloud.pointCount).toBe(200);
    const P = cloud.attrs.point.require("P");
    for (let i = 0; i < cloud.pointCount; i++) {
      const [x] = P.getTuple(i);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(5 + 1e-6);
    }
  });
});

describe("extrudePolygon", () => {
  it("builds walls and both caps from a closed footprint", async () => {
    const geo = await extrude(unitSquare(), { distance: 2 });
    // 4 walls of 4 points and 2 triangles, plus two 4-point caps of 2.
    expect(geo.pointCount).toBe(4 * 4 + 4 + 4);
    expect(geo.primitiveCount).toBe(4 * 2 + 2 + 2);
    expectTriangleMesh(geo);
    const P = geo.attrs.point.require("P");
    let maxY = -Infinity;
    for (let i = 0; i < geo.pointCount; i++) maxY = Math.max(maxY, P.get(i, 1));
    expect(maxY).toBeCloseTo(2, 6);
  });

  it("faces every wall outward and every cap along its own end", async () => {
    const geo = await extrude(unitSquare(), { distance: 2 });
    const P = geo.attrs.point.require("P");
    for (let t = 0; t < geo.primitiveCount; t++) {
      const n = triangleNormal(geo, t);
      const v = geo.primVertexStart[t];
      const pts = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
      const c = [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k]) / 3);
      // Outward from the solid's centre (0.5, 1, -0.5).
      const away = [c[0] - 0.5, c[1] - 1, c[2] + 0.5];
      const len = Math.hypot(...away);
      expect((n[0] * away[0] + n[1] * away[1] + n[2] * away[2]) / len).toBeGreaterThan(0.3);
    }
  });

  it("faces the walls outward for the OPPOSITE winding too", async () => {
    const reversed = createPolyline([0, 0, 0, 0, 0, -1, 1, 0, -1, 1, 0, 0], { closed: true });
    const geo = await extrude(reversed, { distance: 2 });
    const P = geo.attrs.point.require("P");
    for (let t = 0; t < geo.primitiveCount; t++) {
      const n = triangleNormal(geo, t);
      const v = geo.primVertexStart[t];
      const pts = [0, 1, 2].map((k) => P.getTuple(geo.vertexToPoint[v + k]));
      const c = [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k]) / 3);
      const away = [c[0] - 0.5, c[1] - 1, c[2] + 0.5];
      const len = Math.hypot(...away);
      expect((n[0] * away[0] + n[1] * away[1] + n[2] * away[2]) / len).toBeGreaterThan(0.3);
    }
  });

  it("takes a per-point distance, which is what makes a sloped top", async () => {
    const sq = unitSquare();
    const h = sq.attrs.point.add("h", "f32", 1, 0);
    h.data.set([1, 2, 3, 4]);
    const geo = await extrude(sq, { distance: attribute("h"), caps: "top", sides: false });
    const P = geo.attrs.point.require("P");
    expect([0, 1, 2, 3].map((i) => P.get(i, 1))).toEqual([1, 2, 3, 4]);
  });

  it("honours the caps and sides switches, and refuses building nothing", async () => {
    expect((await extrude(unitSquare(), { caps: "none" })).primitiveCount).toBe(8);
    expect((await extrude(unitSquare(), { caps: "top", sides: false })).primitiveCount).toBe(2);
    await expect(extrude(unitSquare(), { caps: "none", sides: false })).rejects.toThrow(
      /leave nothing to build/,
    );
  });

  it("uses each polygon's own Newell normal in polygonNormal mode", async () => {
    // A square in the xy plane: its own normal is -z by this winding.
    const wall = createPolyline([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], { closed: true });
    const geo = await extrude(wall, { direction: "polygonNormal", distance: 3 });
    const P = geo.attrs.point.require("P");
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < geo.pointCount; i++) {
      minZ = Math.min(minZ, P.get(i, 2));
      maxZ = Math.max(maxZ, P.get(i, 2));
    }
    expect(Math.abs(maxZ - minZ)).toBeCloseTo(3, 6);
  });

  it("refuses an OPEN polyline by name and states the fix", async () => {
    await expect(extrude(straight(4))).rejects.toThrow(/OPEN.*pointsToPath/s);
  });

  it("carries point and primitive attributes and writes normal and uv", async () => {
    const sq = unitSquare();
    sq.attrs.point.add("tag", "f32", 1, 0).data.set([1, 2, 3, 4]);
    sq.attrs.primitive.add("lotId", "i32", 1, 0).data.set([7]);
    const geo = await extrude(sq, { distance: 1 });
    expect(geo.attrs.point.require("uv").tupleSize).toBe(2);
    expect(geo.attrs.point.require("normal").tupleSize).toBe(3);
    for (let p = 0; p < geo.primitiveCount; p++) {
      expect(geo.attrs.primitive.require("lotId").get(p, 0)).toBe(7);
    }
    // Each output point carries the tag of the footprint corner it stands
    // over, not merely one of the four: the boundary corners are at
    // distinct (x, z), so position identifies the source exactly.
    const P = geo.attrs.point.require("P");
    const tag = geo.attrs.point.require("tag");
    const expected = new Map([
      ["0,0", 1],
      ["1,0", 2],
      ["1,-1", 3],
      ["0,-1", 4],
    ]);
    for (let i = 0; i < geo.pointCount; i++) {
      const key = `${Math.round(P.get(i, 0))},${Math.round(P.get(i, 2))}`;
      expect(tag.get(i, 0), `point ${i} at ${key}`).toBe(expected.get(key));
    }
  });
});

describe("the written normal agrees with the winding", () => {
  // The one property that makes a surface shade the way it faces. It is
  // checked across every profile and every cap combination because the
  // bug it catches is per-profile: a band stitched the wrong way round
  // has a sensible normal column and a face pointing at minus it.
  it("holds for every sweepProfile shape", async () => {
    const path = createPolyline([0, 0, 0, 3, 0, 0, 5, 0, 2, 5, 2, 5]);
    for (const profile of ["circle", "square", "ribbon"] as const) {
      for (const caps of [true, false]) {
        for (const joint of ["miter", "perpendicular"] as const) {
          const geo = await sweep(path, { profile, caps, joint, radius: 0.3, width: 1.5 });
          expectNormalsMatchWinding(geo, `sweep ${profile} caps=${caps} ${joint}`);
        }
      }
    }
  });

  it("faces a flat ribbon UP, not down — the direction, not just the agreement", async () => {
    // A road ribbon on the ground plane is single-sided, so which side
    // it is drawn from is the whole of whether it is visible. Agreement
    // between winding and normal is necessary but not sufficient: both
    // could be upside down together.
    const geo = await sweep(straight(4), { profile: "ribbon", width: 2 });
    const N = geo.attrs.point.require("normal");
    for (let i = 0; i < geo.pointCount; i++) expect(N.getTuple(i)).toEqual([0, 1, 0]);
    for (let t = 0; t < geo.primitiveCount; t++) {
      expect(triangleNormal(geo, t)[1], `triangle ${t}`).toBeCloseTo(1, 6);
    }
  });

  it("holds for a closed path and for frames read from attributes", async () => {
    expectNormalsMatchWinding(await sweep(unitSquare(), { profile: "square" }), "closed square");
    const framed = firstGeo(
      (await runNode(writeCurveFrame, {}, { in: [makeGeometryItem(straight(6))] })).out,
    );
    expectNormalsMatchWinding(
      await sweep(framed, { frame: "curveFrame", profile: "ribbon" }),
      "curveFrame ribbon",
    );
  });

  it("holds for every extrudePolygon combination, both windings and both signs", async () => {
    const cw = createPolyline([0, 0, 0, 0, 0, -1, 1, 0, -1, 1, 0, 0], { closed: true });
    for (const footprint of [unitSquare(), cw]) {
      for (const caps of ["none", "top", "bottom", "both"] as const) {
        for (const distance of [2, -2]) {
          const geo = await extrude(footprint, { caps, distance, sides: true });
          expectNormalsMatchWinding(geo, `extrude caps=${caps} distance=${distance}`);
        }
      }
    }
  });

  it("tilts a sloped top cap's normal off the extrusion direction", async () => {
    // The whole reason `distance` is field-capable: a ramped roof must
    // not shade as if it were flat.
    const sq = unitSquare();
    sq.attrs.point.add("h", "f32", 1, 0).data.set([1, 1, 4, 4]);
    const geo = await extrude(sq, { distance: attribute("h"), caps: "top", sides: false });
    const n = geo.attrs.point.require("normal").getTuple(0);
    expect(Math.hypot(...n)).toBeCloseTo(1, 6);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[1]).toBeLessThan(0.99); // genuinely tilted, not stamped +y
    expectNormalsMatchWinding(geo, "sloped top");
  });
});

describe("degenerate input is defined, not NaN", () => {
  it("sweeps a path with a repeated point without inventing a zero normal", async () => {
    const geo = await sweep(createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]), { radius: 0.2 });
    const N = geo.attrs.point.require("normal");
    const P = geo.attrs.point.require("P");
    for (let i = 0; i < geo.pointCount; i++) {
      expect(Math.hypot(...N.getTuple(i)), `point ${i} normal`).toBeCloseTo(1, 5);
      for (const c of P.getTuple(i)) expect(Number.isFinite(c)).toBe(true);
    }
    expectNormalsMatchWinding(geo, "repeated point");
  });

  it("extrudes a footprint with a repeated corner without a black facet", async () => {
    const geo = await extrude(
      createPolyline([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1], { closed: true }),
      { distance: 2 },
    );
    const N = geo.attrs.point.require("normal");
    for (let i = 0; i < geo.pointCount; i++) {
      expect(Math.hypot(...N.getTuple(i)), `point ${i} normal`).toBeCloseTo(1, 5);
    }
  });

  it("keeps a good path's blocks aligned when a dead one is skipped beside it", async () => {
    // The one input class where a counting/writing divergence would
    // truncate the topology silently rather than throw.
    const geo = createPolyline([7, 7, 7, 7, 7, 7, 0, 0, 0, 1, 0, 0]);
    setPolylineTopology(geo, Uint32Array.of(0, 1, 2, 3), Uint32Array.of(0, 2), Uint32Array.of(2, 2));
    geo.attrs.primitive.add("tag", "f32", 1, 0).data.set([11, 22]);
    const out = await sweep(geo, { caps: false });
    expect(out.pointCount).toBe(2 * 9); // only the live path emitted rings
    const P = out.attrs.point.require("P");
    for (let i = 0; i < out.pointCount; i++) {
      // The live path spans x 0..1; the dead one sits at 7. A ring point
      // lands on the path exactly in x, to a float hair.
      expect(P.get(i, 0)).toBeGreaterThan(-1e-6);
      expect(P.get(i, 0)).toBeLessThan(1 + 1e-6);
    }
    for (let p = 0; p < out.primitiveCount; p++) {
      expect(out.attrs.primitive.require("tag").get(p, 0)).toBe(22);
    }
  });

  it("refuses a whole input with no sweepable path, naming what a path needs", async () => {
    const dead = createPolyline([5, 5, 5, 5, 5, 5]);
    await expect(sweep(dead)).rejects.toThrow(/at least one segment of nonzero length/);
  });
});

describe("neither node touches its input", () => {
  // Both declare `gpu: "fields"`, whose contract is that the field
  // resolver and the CPU fallback see identical bytes — which only holds
  // because the input is never mutated.
  it("leaves the geometry it was handed byte-identical", async () => {
    const path = straight(5);
    path.attrs.point.add("tag", "f32", 1, 0).data.set([1, 2, 3, 4, 5]);
    const before = snapshotGeometry(path);
    await sweep(path, { profile: "square" });
    expectUntouched(before, path, "sweepProfile");

    const sq = unitSquare();
    const beforeSq = snapshotGeometry(sq);
    await extrude(sq, { distance: 3 });
    expectUntouched(beforeSq, sq, "extrudePolygon");
  });
});

describe("param validation names the offender and the valid set", () => {
  it("refuses bad enums and out-of-range numbers", async () => {
    const path = straight(3);
    await expect(sweep(path, { profile: "hexagon" })).rejects.toThrow(
      /param "profile" must be one of circle, square, ribbon/,
    );
    await expect(sweep(path, { joint: "round" })).rejects.toThrow(/param "joint" must be one of/);
    await expect(sweep(path, { frame: "frenet" })).rejects.toThrow(/param "frame" must be one of/);
    await expect(sweep(path, { sides: 2 })).rejects.toThrow(/whole number in \[3, 256\]/);
    await expect(sweep(path, { sides: 8.5 })).rejects.toThrow(/whole number in \[3, 256\]/);
    await expect(sweep(path, { miterLimit: 0.5 })).rejects.toThrow(/miterLimit.*>= 1/s);
    await expect(extrude(unitSquare(), { direction: "up" })).rejects.toThrow(
      /param "direction" must be one of/,
    );
    await expect(
      extrude(unitSquare(), { direction: "vector", vector: [0, 0, 0] }),
    ).rejects.toThrow(/names no direction/);
  });

  it("extrudes along an arbitrary vector", async () => {
    const geo = await extrude(unitSquare(), {
      direction: "vector",
      vector: [0, 0, 4],
      distance: 2,
    });
    const P = geo.attrs.point.require("P");
    let maxZ = -Infinity;
    for (let i = 0; i < geo.pointCount; i++) maxZ = Math.max(maxZ, P.get(i, 2));
    expect(maxZ).toBeCloseTo(2, 6); // the vector is normalized before use
    expectNormalsMatchWinding(geo, "vector mode");
  });
});

describe("a field param answers per element, where a number cannot", () => {
  // Both params here used to be settled before the walk. What is asserted
  // is the thing that separates a field from a number: ONE cook giving
  // two elements two different answers. Every constant-field comparison
  // carries a CONTROL that differs, so an equality that cannot fail is
  // never mistaken for a passing one, and every number in one is f32-exact
  // so a difference would be a real difference and not a rounding.
  it("extrudes two polygons of one input along two different vectors", async () => {
    const geo = twoSquares();
    geo.attrs.primitive.add("dir", "f32", 3, 0).data.set([0, 4, 0, 4, 0, 0]);
    const out = await extrude(geo, {
      direction: "vector",
      vector: attribute("dir"),
      distance: 2,
    });
    // 24 output points per polygon (16 wall + 4 bottom + 4 top).
    expect(out.pointCount).toBe(48);
    // Square A rises; square B travels along +x and never leaves y = 0.
    expect(span(out, 0, 24, 1)).toEqual([0, 2]);
    expect(span(out, 0, 24, 0)).toEqual([0, 1]);
    expect(span(out, 24, 48, 1)).toEqual([0, 0]);
    expect(span(out, 24, 48, 0)).toEqual([4, 7]);
    expectNormalsMatchWinding(out, "two vectors");

    // The control: one plain vector cannot say both things, and the same
    // measurement reports the other answer for it.
    const one = await extrude(twoSquares(), {
      direction: "vector",
      vector: [0, 4, 0],
      distance: 2,
    });
    expect(span(one, 24, 48, 1)).toEqual([0, 2]);
    expect(span(one, 24, 48, 0)).toEqual([4, 5]);
  });

  it("extrudes along a constant vector field exactly as along the plain vector", async () => {
    const plain = await extrude(unitSquare(), {
      direction: "vector",
      vector: [0.25, 4, 0],
      distance: 2.5,
    });
    const field = await extrude(unitSquare(), {
      direction: "vector",
      vector: constant([0.25, 4, 0]),
      distance: 2.5,
    });
    expect(snapshotGeometry(field)).toEqual(snapshotGeometry(plain));
    // Control: a different constant field is a different solid, so the
    // equality above is one the comparison could have refused.
    const other = await extrude(unitSquare(), {
      direction: "vector",
      vector: constant([0, 4, 0]),
      distance: 2.5,
    });
    expect(snapshotGeometry(other)).not.toEqual(snapshotGeometry(plain));
  });

  it("refuses a zero vector BY PRIMITIVE, and a plain zero by the param", async () => {
    const geo = twoSquares();
    geo.attrs.primitive.add("dir", "f32", 3, 0).data.set([0, 4, 0, 0, 0, 0]);
    // Primitive 0 is fine; primitive 1 names no direction, and the
    // message says which polygon and what to do about it.
    await expect(
      extrude(geo, { direction: "vector", vector: attribute("dir"), distance: 2 }),
    ).rejects.toThrow(/param "vector" resolved to \[0, 0, 0\] on primitive 1.*polygonNormal/s);
    await expect(
      extrude(twoSquares(), { direction: "vector", vector: [0, 0, 0] }),
    ).rejects.toThrow(/param "vector" is \[0, 0, 0\], which names no direction/);
  });

  it("does not even evaluate the vector in the other direction modes", async () => {
    // `attribute("dir")` throws when it is read and there is no such
    // attribute, so cooking at all is the assertion.
    const geo = twoSquares();
    const ignored = await extrude(geo, { direction: "+y", vector: attribute("dir"), distance: 2 });
    const plain = await extrude(twoSquares(), { direction: "+y", distance: 2 });
    expect(snapshotGeometry(ignored)).toEqual(snapshotGeometry(plain));
  });

  it("miters one bend and pinches an identical one in the same sweep", async () => {
    const path = zigzag();
    path.attrs.point.add("lim", "f32", 1, 0).data.set([1, 1.25, 2, 1, 1]);
    // Both bends turn 90 degrees and want the same stretch of sqrt(2);
    // ring 1's own limit refuses it and ring 2's allows it.
    const geo = await sweep(path, { radius: 0.2, miterLimit: attribute("lim"), caps: false });
    const wide = 0.2 * Math.SQRT2;
    expect(ringWidest(geo, 1, [0, 0, 0])).toBeCloseTo(0.2, 5);
    expect(ringWidest(geo, 2, [0, 0, -1])).toBeCloseTo(wide, 5);

    // The controls: neither plain limit produces that pair, and the same
    // two measurements report both of the answers a number can give.
    const tight = await sweep(zigzag(), { radius: 0.2, miterLimit: 1.25, caps: false });
    expect(ringWidest(tight, 1, [0, 0, 0])).toBeCloseTo(0.2, 5);
    expect(ringWidest(tight, 2, [0, 0, -1])).toBeCloseTo(0.2, 5);
    const loose = await sweep(zigzag(), { radius: 0.2, miterLimit: 2, caps: false });
    expect(ringWidest(loose, 1, [0, 0, 0])).toBeCloseTo(wide, 5);
    expect(ringWidest(loose, 2, [0, 0, -1])).toBeCloseTo(wide, 5);
  });

  it("sweeps with a constant miterLimit field exactly as with the plain number", async () => {
    const plain = await sweep(zigzag(), { radius: 0.25, miterLimit: 2, caps: false });
    const field = await sweep(zigzag(), { radius: 0.25, miterLimit: constant(2), caps: false });
    expect(snapshotGeometry(field)).toEqual(snapshotGeometry(plain));
    // Control: a limit the bends exceed builds a different surface.
    const other = await sweep(zigzag(), { radius: 0.25, miterLimit: constant(1.25), caps: false });
    expect(snapshotGeometry(other)).not.toEqual(snapshotGeometry(plain));
  });

  it("reads a resolved limit below 1 as 'no miter here' rather than refusing it", async () => {
    const geo = await sweep(zigzag(), { radius: 0.2, miterLimit: constant(0.25), caps: false });
    expect(ringWidest(geo, 1, [0, 0, 0])).toBeCloseTo(0.2, 5);
    expect(ringWidest(geo, 2, [0, 0, -1])).toBeCloseTo(0.2, 5);
    // A PLAIN limit below 1 is still refused at the door, unchanged.
    await expect(sweep(zigzag(), { miterLimit: 0.25 })).rejects.toThrow(/miterLimit.*>= 1/s);
  });

  it("does not evaluate miterLimit at all under joint 'perpendicular'", async () => {
    const path = zigzag();
    const ignored = await sweep(path, {
      joint: "perpendicular",
      miterLimit: attribute("lim"),
      caps: false,
    });
    const plain = await sweep(zigzag(), { joint: "perpendicular", caps: false });
    expect(snapshotGeometry(ignored)).toEqual(snapshotGeometry(plain));
  });

  it("refuses a non-finite miterLimit field, naming the param and the element", async () => {
    const path = zigzag();
    path.attrs.point.add("lim", "f32", 1, 0).data.set([1, Infinity, 2, 1, 1]);
    await expect(sweep(path, { miterLimit: attribute("lim"), caps: false })).rejects.toThrow(
      /param "miterLimit" resolved to \+Infinity at element 1/,
    );
  });
});

describe("determinism", () => {
  it("sweeps identically across runs", async () => {
    const path = straight(9);
    const a = await sweep(path, { radius: 0.3, profile: "square" });
    const b = await sweep(path, { radius: 0.3, profile: "square" });
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
  });

  it("emits elements in an order that is a total function of the input's own order", async () => {
    // The output must not depend on which ring was built first, and the
    // only thing that can reorder it is the input's primitive order. Two
    // paths swapped in the input swap their blocks and change nothing else.
    const geo = await sweep(twoPaths(), { caps: false });
    const swapped = await sweep(twoPaths(true), { caps: false });
    expect(geo.pointCount).toBe(swapped.pointCount);
    const P = geo.attrs.point.require("P");
    const Q = swapped.attrs.point.require("P");
    const half = geo.pointCount / 2;
    for (let i = 0; i < half; i++) {
      expect(P.getTuple(i)).toEqual(Q.getTuple(half + i));
      expect(P.getTuple(half + i)).toEqual(Q.getTuple(i));
    }
  });

  it("extrudes identically across runs", async () => {
    const a = await extrude(unitSquare(), { distance: 2.5 });
    const b = await extrude(unitSquare(), { distance: 2.5 });
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
  });
});

/**
 * Two unit squares in one input, as two CLOSED polyline primitives —
 * the shape that makes a per-primitive answer visible: the blocks are
 * separated in x, so which polygon a point came from is readable off its
 * position alone.
 */
function twoSquares(): Geometry {
  const geo = createPolyline([
    0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 4, 0, 0, 5, 0, 0, 5, 0, -1, 4, 0, -1,
  ]);
  setPolylineTopology(
    geo,
    Uint32Array.of(0, 1, 2, 3, 0, 4, 5, 6, 7, 4),
    Uint32Array.of(0, 5),
    Uint32Array.of(5, 5),
  );
  return geo;
}

/** An open path with two IDENTICAL 90-degree bends, at points 1 and 2. */
function zigzag(): Geometry {
  return createPolyline([-1, 0, 0, 0, 0, 0, 0, 0, -1, 1, 0, -1, 2, 0, -1]);
}

/** [min, max] of component `k` of P over the output points [from, to). */
function span(geo: Geometry, from: number, to: number, k: number): [number, number] {
  const P = geo.attrs.point.require("P");
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i < to; i++) {
    min = Math.min(min, P.get(i, k));
    max = Math.max(max, P.get(i, k));
  }
  return [min, max];
}

/**
 * Widest half-extent of one 9-point ring about the path point it stands
 * on — `radius` unmitered, `radius / cos(half the turn)` mitered.
 */
function ringWidest(geo: Geometry, ring: number, center: readonly number[]): number {
  const P = geo.attrs.point.require("P");
  let max = 0;
  for (let i = ring * 9; i < ring * 9 + 9; i++) {
    const [x, y, z] = P.getTuple(i);
    max = Math.max(max, Math.hypot(x - center[0], y - center[1], z - center[2]));
  }
  return max;
}

/** Two separate 2-point polylines, optionally in the other order. */
function twoPaths(swapped = false): Geometry {
  const a = [0, 0, 0, 1, 0, 0];
  const b = [0, 0, 5, 1, 0, 5];
  const geo = createPolyline(swapped ? [...b, ...a] : [...a, ...b]);
  setPolylineTopology(geo, Uint32Array.of(0, 1, 2, 3), Uint32Array.of(0, 2), Uint32Array.of(2, 2));
  return geo;
}
