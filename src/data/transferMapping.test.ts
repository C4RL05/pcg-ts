import { describe, expect, it } from "vitest";
import type { Attribute } from "./attribute.js";
import { Geometry, createTriangleMesh, PRIMTYPE_ATTR } from "./geometry.js";
import { createPointCloud } from "./points.js";
import {
  TRANSFER_AREA_EPS,
  TRANSFER_BARY_EPS,
  TRANSFER_BOX_PAD_REL,
  TRANSFER_DET_EPS,
  transferRaycast,
  transferUv,
} from "./transferMapping.js";

/** Tiny deterministic LCG in [0, 1); no Math.random anywhere. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One resolved mapping for one destination point. */
interface RefHit {
  /** Source element indices of the three triangle corners (attr domain). */
  c: [number, number, number];
  /** Clamped, renormalized barycentric weights. */
  w: [number, number, number];
}

/** Usable triangles (3-vertex "poly" prims) in ascending primitive order. */
function usableTriangles(src: Geometry): number[] {
  const primType = src.attrs.primitive.get(PRIMTYPE_ATTR);
  const tris: number[] = [];
  for (let p = 0; p < src.primitiveCount; p++) {
    if (src.primVertexCount[p] !== 3) continue;
    if (primType && primType.getString(p) !== "poly") continue;
    tris.push(src.primVertexStart[p]);
  }
  return tris;
}

/**
 * Brute-force O(n*m) reference for transferUv: scan every triangle in
 * ascending order per destination point, using the documented containment
 * policy (signed-area barycentrics, TRANSFER_BARY_EPS slack, degenerates
 * skipped, first containing triangle wins).
 */
function refUv(
  dst: Geometry,
  src: Geometry,
  opts: { uvAttr?: string; uvDomain?: "vertex" | "point"; attrDomain?: "point" | "vertex" } = {},
): (RefHit | null)[] {
  const uvName = opts.uvAttr ?? "uv";
  const uvDomain = opts.uvDomain ?? (src.attrs.vertex.has(uvName) ? "vertex" : "point");
  const attrDomain = opts.attrDomain ?? "point";
  const srcUv = src.attrs[uvDomain].require(uvName);
  const us = srcUv.tupleSize;
  const ud = srcUv.data;
  const v2p = src.vertexToPoint;
  const tris = usableTriangles(src);
  const dstUv = dst.attrs.point.require(uvName);
  const uts = dstUv.tupleSize;
  const uvd = dstUv.data;
  const out: (RefHit | null)[] = [];
  for (let j = 0; j < dst.pointCount; j++) {
    const qu = uvd[j * uts];
    const qv = uvd[j * uts + 1];
    let hit: RefHit | null = null;
    if (Number.isFinite(qu) && Number.isFinite(qv)) {
      for (const v of tris) {
        const c0 = (uvDomain === "vertex" ? v : v2p[v]) * us;
        const c1 = (uvDomain === "vertex" ? v + 1 : v2p[v + 1]) * us;
        const c2 = (uvDomain === "vertex" ? v + 2 : v2p[v + 2]) * us;
        const u0 = ud[c0];
        const v0 = ud[c0 + 1];
        const u1 = ud[c1];
        const v1 = ud[c1 + 1];
        const u2 = ud[c2];
        const v2 = ud[c2 + 1];
        const area2 = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
        if (!(Math.abs(area2) >= TRANSFER_AREA_EPS) || !Number.isFinite(area2)) continue;
        // Containment policy: within the padded UV bounding box first.
        const bu0 = Math.min(u0, u1, u2);
        const bu1 = Math.max(u0, u1, u2);
        const bv0 = Math.min(v0, v1, v2);
        const bv1 = Math.max(v0, v1, v2);
        const pad = TRANSFER_BOX_PAD_REL * Math.max(bu1 - bu0, bv1 - bv0) + 1e-12;
        if (qu < bu0 - pad || qv < bv0 - pad || qu > bu1 + pad || qv > bv1 + pad) continue;
        const inv = 1 / area2;
        const w0 = ((u1 - qu) * (v2 - qv) - (u2 - qu) * (v1 - qv)) * inv;
        const w1 = ((u2 - qu) * (v0 - qv) - (u0 - qu) * (v2 - qv)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -TRANSFER_BARY_EPS || w1 < -TRANSFER_BARY_EPS || w2 < -TRANSFER_BARY_EPS) {
          continue;
        }
        const a = w0 > 0 ? w0 : 0;
        const b = w1 > 0 ? w1 : 0;
        const c = w2 > 0 ? w2 : 0;
        const s = 1 / (a + b + c);
        hit = {
          c: [
            attrDomain === "vertex" ? v : v2p[v],
            attrDomain === "vertex" ? v + 1 : v2p[v + 1],
            attrDomain === "vertex" ? v + 2 : v2p[v + 2],
          ],
          w: [a * s, b * s, c * s],
        };
        break;
      }
    }
    out.push(hit);
  }
  return out;
}

/**
 * Brute-force O(n*m) reference for transferRaycast: normalized ray,
 * Möller–Trumbore per triangle with the documented epsilons, nearest t
 * wins, exactly-equal t resolves to the lowest triangle index.
 */
function refRaycast(
  dst: Geometry,
  src: Geometry,
  opts: {
    dir?: readonly number[];
    dirAttr?: string;
    maxDistance?: number;
    attrDomain?: "point" | "vertex";
  } = {},
): (RefHit | null)[] {
  const attrDomain = opts.attrDomain ?? "point";
  const maxT = opts.maxDistance ?? Infinity;
  const srcP = src.attrs.point.require("P");
  const pd = srcP.data;
  const ps = srcP.tupleSize;
  const v2p = src.vertexToPoint;
  const tris = usableTriangles(src);
  const dstP = dst.attrs.point.require("P");
  const dps = dstP.tupleSize;
  const dpd = dstP.data;
  const dirAttr = opts.dirAttr !== undefined ? dst.attrs.point.require(opts.dirAttr) : null;
  const cd = opts.dir ?? [0, -1, 0];
  const clen = Math.sqrt(cd[0] * cd[0] + cd[1] * cd[1] + cd[2] * cd[2]);
  const out: (RefHit | null)[] = [];
  for (let j = 0; j < dst.pointCount; j++) {
    const ox = dpd[j * dps];
    const oy = dpd[j * dps + 1];
    const oz = dpd[j * dps + 2];
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) {
      out.push(null);
      continue;
    }
    let dx: number;
    let dy: number;
    let dz: number;
    if (dirAttr) {
      const rx = dirAttr.data[j * dirAttr.tupleSize];
      const ry = dirAttr.data[j * dirAttr.tupleSize + 1];
      const rz = dirAttr.data[j * dirAttr.tupleSize + 2];
      const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (!(len > 0) || !Number.isFinite(len)) {
        out.push(null);
        continue;
      }
      dx = rx / len;
      dy = ry / len;
      dz = rz / len;
    } else {
      dx = cd[0] / clen;
      dy = cd[1] / clen;
      dz = cd[2] / clen;
    }
    let bestT = Infinity;
    let bestTri = -1;
    let bestU = 0;
    let bestV = 0;
    let bestStart = 0;
    for (let ti = 0; ti < tris.length; ti++) {
      const v = tris[ti];
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const c = v2p[v + 2] * ps;
      const ax = pd[a];
      const ay = pd[a + 1];
      const az = pd[a + 2];
      const e1x = pd[b] - ax;
      const e1y = pd[b + 1] - ay;
      const e1z = pd[b + 2] - az;
      const e2x = pd[c] - ax;
      const e2y = pd[c + 1] - ay;
      const e2z = pd[c + 2] - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(twiceArea >= TRANSFER_AREA_EPS) || !Number.isFinite(twiceArea)) continue;
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < TRANSFER_DET_EPS) continue;
      const inv = 1 / det;
      const tx = ox - ax;
      const ty = oy - ay;
      const tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < -TRANSFER_BARY_EPS || u > 1 + TRANSFER_BARY_EPS) continue;
      const qx = ty * e1z - tz * e1y;
      const qy = tz * e1x - tx * e1z;
      const qz = tx * e1y - ty * e1x;
      const vv = (dx * qx + dy * qy + dz * qz) * inv;
      if (vv < -TRANSFER_BARY_EPS || u + vv > 1 + TRANSFER_BARY_EPS) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t < 0 || t > maxT) continue;
      // Containment policy: the hit point must lie in the padded 3D box.
      const bx0 = Math.min(ax, ax + e1x, ax + e2x);
      const by0 = Math.min(ay, ay + e1y, ay + e2y);
      const bz0 = Math.min(az, az + e1z, az + e2z);
      const bx1 = Math.max(ax, ax + e1x, ax + e2x);
      const by1 = Math.max(ay, ay + e1y, ay + e2y);
      const bz1 = Math.max(az, az + e1z, az + e2z);
      const pad = TRANSFER_BOX_PAD_REL * Math.max(bx1 - bx0, by1 - by0, bz1 - bz0) + 1e-12;
      const hx = ox + dx * t;
      const hy = oy + dy * t;
      const hz = oz + dz * t;
      if (
        hx < bx0 - pad ||
        hy < by0 - pad ||
        hz < bz0 - pad ||
        hx > bx1 + pad ||
        hy > by1 + pad ||
        hz > bz1 + pad
      ) {
        continue;
      }
      if (t < bestT || (t === bestT && ti < bestTri)) {
        bestT = t;
        bestTri = ti;
        bestU = u;
        bestV = vv;
        bestStart = v;
      }
    }
    if (bestTri < 0) {
      out.push(null);
      continue;
    }
    let w0 = 1 - bestU - bestV;
    let w1 = bestU;
    let w2 = bestV;
    if (w0 < 0) w0 = 0;
    if (w1 < 0) w1 = 0;
    if (w2 < 0) w2 = 0;
    const s = 1 / (w0 + w1 + w2);
    const v = bestStart;
    out.push({
      c: [
        attrDomain === "vertex" ? v : v2p[v],
        attrDomain === "vertex" ? v + 1 : v2p[v + 1],
        attrDomain === "vertex" ? v + 2 : v2p[v + 2],
      ],
      w: [w0 * s, w1 * s, w2 * s],
    });
  }
  return out;
}

/** Expected f32 output: barycentric interpolation, misses keep `prior`. */
function interpExpected(
  hits: (RefHit | null)[],
  srcData: ArrayLike<number>,
  ts: number,
  prior: number[],
): number[] {
  const out = prior.slice();
  hits.forEach((h, j) => {
    if (!h) return;
    for (let k = 0; k < ts; k++) {
      out[j * ts + k] = Math.fround(
        h.w[0] * srcData[h.c[0] * ts + k] +
          h.w[1] * srcData[h.c[1] * ts + k] +
          h.w[2] * srcData[h.c[2] * ts + k],
      );
    }
  });
  return out;
}

/** Dominant corner: largest weight, ties to the first corner in order. */
function dominant(h: RefHit): number {
  let c = 0;
  if (h.w[1] > h.w[c]) c = 1;
  if (h.w[2] > h.w[c]) c = 2;
  return h.c[c];
}

/** Expected non-interpolating output (i32/u32/bool by dominant corner). */
function dominantExpected(
  hits: (RefHit | null)[],
  srcData: ArrayLike<number>,
  ts: number,
  prior: number[],
): number[] {
  const out = prior.slice();
  hits.forEach((h, j) => {
    if (!h) return;
    const so = dominant(h) * ts;
    for (let k = 0; k < ts; k++) out[j * ts + k] = srcData[so + k];
  });
  return out;
}

function attrValues(attr: Attribute, count: number): number[] {
  return Array.from(attr.data.subarray(0, count * attr.tupleSize));
}

/** Unit quad in UV space: 2 triangles, point-domain uv = xy, val = 10..40. */
function unitQuad(): Geometry {
  const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
  geo.attrs.point.add("uv", "f32", 2).data.set([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
  return geo;
}

/** Point cloud with a point-domain "uv" lookup attribute. */
function cloudWithUv(uvs: number[][]): Geometry {
  const geo = createPointCloud(uvs.length);
  const uv = geo.attrs.point.add("uv", "f32", 2);
  uvs.forEach((q, i) => uv.setTuple(i, q));
  return geo;
}

/**
 * LCG terrain: (n+1)^2 grid points (jittered uv/heights), 2 triangles per
 * quad, plus one degenerate triangle appended (three collinear corners in
 * both UV and 3D). Point attrs: uv (= xz), val (f32), id (i32 = index).
 */
function terrain(n: number, seed: number): Geometry {
  const rand = makeLcg(seed);
  const positions: number[] = [];
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x, rand() * 2, z);
    }
  }
  // Three extra collinear points: degenerate in 3D and in UV (uv = xz).
  positions.push(0, 5, 0, 1, 5, 0, 2, 5, 0);
  const tris: number[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      const b = a + 1;
      const c = a + n + 2;
      const d = a + n + 1;
      tris.push(a, b, c, a, c, d);
    }
  }
  const base = (n + 1) * (n + 1);
  tris.push(base, base + 1, base + 2); // degenerate
  const geo = createTriangleMesh(positions, tris);
  const np = geo.pointCount;
  const uv = geo.attrs.point.add("uv", "f32", 2);
  const val = geo.attrs.point.add("val", "f32", 1);
  const id = geo.attrs.point.add("id", "i32", 1);
  const P = geo.attrs.point.require("P").data;
  for (let i = 0; i < np; i++) {
    uv.data[i * 2] = P[i * 3];
    uv.data[i * 2 + 1] = P[i * 3 + 2];
    val.data[i] = Math.fround(rand() * 100);
    id.data[i] = i;
  }
  return geo;
}

describe("transferUv", () => {
  it("interpolates inside the containing triangle (known values)", () => {
    const src = unitQuad();
    const dst = cloudWithUv([
      [0.5, 0.5], // on the shared diagonal -> triangle 0, value 20
      [0, 0], // at a corner -> 10
      [1, 1], // at the far corner -> 30
      [2, 2], // outside everything -> miss
    ]);
    const { attribute, missCount } = transferUv(dst, src, "val");
    expect(missCount).toBe(1);
    // The miss (no pre-existing attr) holds the source default (0).
    expect(attrValues(attribute, 4)).toEqual([20, 10, 30, 0]);
  });

  it("matches a brute-force scan on an adversarial terrain (f32 + i32)", () => {
    const src = terrain(6, 11);
    const rand = makeLcg(22);
    const uvs: number[][] = [];
    for (let i = 0; i < 120; i++) uvs.push([-1 + rand() * 8, -1 + rand() * 8]);
    // Adversarial exact queries: grid vertices, quad-diagonal midpoints
    // (shared edges), edge midpoints, points on the degenerate triangle's
    // line, far offsets, non-finite.
    uvs.push([2, 3], [0, 0], [6, 6], [2.5, 3.5], [1.5, 3.5], [2.5, 3], [0.5, 0], [1.5, 5]);
    uvs.push([1.5, 0.0001], [1e6, 1e6], [-50, 2], [Number.NaN, 1]);
    const dst = cloudWithUv(uvs);
    const hits = refUv(dst, src, {});
    const nd = dst.pointCount;
    const srcVal = src.attrs.point.require("val");
    const { attribute, missCount } = transferUv(dst, src, "val");
    expect(attrValues(attribute, nd)).toEqual(
      interpExpected(hits, srcVal.data, 1, new Array<number>(nd).fill(0)),
    );
    expect(missCount).toBe(hits.filter((h) => h === null).length);
    expect(missCount).toBeGreaterThan(0); // the suite really exercises misses
    const dst2 = cloudWithUv(uvs);
    const idOut = transferUv(dst2, src, "id");
    expect(attrValues(idOut.attribute, nd)).toEqual(
      dominantExpected(hits, src.attrs.point.require("id").data, 1, new Array<number>(nd).fill(0)),
    );
  });

  it("UVs on a shared edge deterministically pick the lowest triangle index", () => {
    // Per-corner (vertex-domain) values differ across the diagonal, so the
    // winning triangle is observable: triangle 0 corners carry 1,2,3 and
    // triangle 1 corners 4,5,6.
    const src = unitQuad();
    src.attrs.vertex.add("cv", "f32", 1).data.set([1, 2, 3, 4, 5, 6]);
    const dst = cloudWithUv([
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.75],
    ]);
    const { attribute } = transferUv(dst, src, "cv", { attrDomain: "vertex" });
    // On the diagonal of triangle 0 ((0,0),(1,0),(1,1)): w = (1-t, 0, t).
    expect(attrValues(attribute, 3)).toEqual([2, 1.5, 2.5]);
  });

  it("vertex-domain UVs support seams; auto prefers vertex over point", () => {
    // Same 4 points, but the two triangles map to disjoint UV islands via
    // per-corner UVs. Point-domain UVs also exist and must be ignored.
    const src = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    src.attrs.vertex.add("uv", "f32", 2).data.set([0, 0, 1, 0, 1, 1, 10, 0, 11, 1, 10, 1]);
    src.attrs.point.add("uv", "f32", 2).data.set([50, 50, 51, 50, 51, 51, 50, 51]);
    src.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
    const dst = cloudWithUv([
      [0.5, 0.25], // island A (triangle 0)
      [10.4, 0.6], // island B (triangle 1)
      [50.5, 50.25], // point-domain island: must miss under auto (vertex wins)
    ]);
    const { attribute, missCount } = transferUv(dst, src, "val");
    expect(missCount).toBe(1);
    const got = attrValues(attribute, 3);
    // Island A at (0.5, 0.25): w = (0.5, 0.25, 0.25) over 10,20,30.
    expect(got[0]).toBeCloseTo(17.5, 5);
    // Island B at (10.4, 0.6): w ~= (0.4, 0.4, 0.2) over 10,30,40 (f32 UVs).
    expect(got[1]).toBeCloseTo(24, 3);
    expect(got[2]).toBe(0); // missed under auto
    // Forcing uvDomain "point" flips which query hits.
    const dst2 = cloudWithUv([
      [0.5, 0.25],
      [10.4, 0.6],
      [50.5, 50.25],
    ]);
    const forced = transferUv(dst2, src, "val", { uvDomain: "point" });
    expect(forced.missCount).toBe(2);
    expect(attrValues(forced.attribute, 3)[2]).not.toBe(0);
  });

  it("misses keep the prior value when the attribute already exists", () => {
    const src = unitQuad();
    const dst = cloudWithUv([
      [0.5, 0.25],
      [5, 5],
      [Number.NaN, 0.5],
    ]);
    dst.attrs.point.add("val", "f32", 1).data.set([999, 999, 999]);
    const { attribute, missCount } = transferUv(dst, src, "val");
    expect(missCount).toBe(2);
    const got = attrValues(attribute, 3);
    expect(got[0]).toBeCloseTo(17.5, 5);
    expect(got[1]).toBe(999);
    expect(got[2]).toBe(999);
    // A shape mismatch replaces the attribute; misses then hold the source
    // default.
    const dst2 = cloudWithUv([
      [0.5, 0.25],
      [5, 5],
    ]);
    dst2.attrs.point.add("val", "i32", 1).data.set([777, 777]);
    const replaced = transferUv(dst2, src, "val");
    expect(replaced.attribute.type).toBe("f32");
    expect(attrValues(replaced.attribute, 2)[1]).toBe(0);
  });

  it("applies the per-type interpolation matrix (f32 interp, others dominant)", () => {
    const src = unitQuad();
    src.attrs.point.add("v3", "f32", 3).data.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    src.attrs.point.add("iv", "i32", 1).data.set([100, 200, 300, 400]);
    src.attrs.point.add("ui", "u32", 1).data.set([7, 8, 9, 10]);
    src.attrs.point.add("bv", "bool", 1).data.set([0, 1, 1, 0]);
    const sv = src.attrs.point.add("sv", "string", 1);
    ["a", "b", "c", "d"].forEach((s, i) => sv.setString(i, s));
    // Exactly-representable UVs so the weight arithmetic is exact:
    // (0.5, 0.25) -> w = (0.5, 0.25, 0.25): dominant corner 0.
    // (0.75, 0.25) -> w = (0.25, 0.5, 0.25): dominant corner 1.
    // (0.5, 0) edge midpoint -> w = (0.5, 0.5, 0): exact tie -> corner 0.
    const queries = [
      [0.5, 0.25],
      [0.75, 0.25],
      [0.5, 0],
    ];
    const mk = (): Geometry => cloudWithUv(queries);
    const f1 = transferUv(mk(), src, "val").attribute;
    expect(attrValues(f1, 3)).toEqual([17.5, 20, 15]);
    const f3 = transferUv(mk(), src, "v3").attribute;
    expect(f3.tupleSize).toBe(3);
    expect(attrValues(f3, 3)[0]).toBeCloseTo(0.5 * 1 + 0.25 * 4 + 0.25 * 7, 5);
    const iv = transferUv(mk(), src, "iv").attribute;
    expect(attrValues(iv, 3)).toEqual([100, 200, 100]);
    const ui = transferUv(mk(), src, "ui").attribute;
    expect(ui.type).toBe("u32");
    expect(attrValues(ui, 3)).toEqual([7, 8, 7]);
    const bv = transferUv(mk(), src, "bv").attribute;
    expect(attrValues(bv, 3)).toEqual([0, 1, 0]);
    const svOut = transferUv(mk(), src, "sv").attribute;
    expect([0, 1, 2].map((j) => svOut.getString(j))).toEqual(["a", "b", "a"]);
  });

  it("is byte-identical across repeated runs and grid cell sizes", () => {
    const src = terrain(5, 31);
    const rand = makeLcg(32);
    const uvs: number[][] = [];
    for (let i = 0; i < 80; i++) uvs.push([-1 + rand() * 7, -1 + rand() * 7]);
    uvs.push([2.5, 3.5], [2, 2], [9, 9]);
    let baseline: number[] | null = null;
    for (const cellSize of [undefined, 0.05, 0.9, 50]) {
      for (let run = 0; run < 2; run++) {
        const dst = cloudWithUv(uvs);
        const opts = cellSize === undefined ? {} : { cellSize };
        const { attribute } = transferUv(dst, src, "val", opts);
        const got = attrValues(attribute, dst.pointCount);
        if (baseline === null) baseline = got;
        else expect(got, `cellSize ${cellSize} run ${run}`).toEqual(baseline);
      }
    }
  });

  it("survives self-transfer when the destination attribute aliases the source", () => {
    // Vertex-domain source UVs, point-domain lookup UVs rotated one corner:
    // point j samples the value at corner (j+1) % 4 — a non-identity
    // mapping, so clobbering the shared storage mid-write would corrupt it.
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    geo.attrs.vertex.add("uv", "f32", 2).data.set([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    geo.attrs.point.add("uv", "f32", 2).data.set([1, 0, 1, 1, 0, 1, 0, 0]);
    geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
    const { attribute, missCount } = transferUv(geo, geo, "val");
    expect(missCount).toBe(0);
    expect(attrValues(attribute, 4)).toEqual([20, 30, 40, 10]);
  });

  it("treats an all-degenerate triangulation as all-miss", () => {
    const geo = createTriangleMesh([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3]);
    // All UVs collinear -> every triangle has zero UV area -> skipped.
    geo.attrs.point.add("uv", "f32", 2).data.set([0, 0, 1, 1, 2, 2, 3, 3]);
    geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
    const dst = cloudWithUv([[1, 1]]);
    dst.attrs.point.add("val", "f32", 1).data.set([555]);
    const { attribute, missCount } = transferUv(dst, geo, "val");
    expect(missCount).toBe(1);
    expect(attrValues(attribute, 1)).toEqual([555]);
  });

  it("sliver triangles cannot capture far-away UVs (bbox guard, cellSize-neutral)", () => {
    // Audit repro (D1): the sliver's 2^-30 perpendicular offset is absorbed
    // by f64 rounding at UV magnitude 2^24, so both edge crosses evaluate
    // to exactly 0 and the barycentric slack would accept Q — the padded
    // bounding-box guard (part of the containment policy) must reject it,
    // and identically for every grid cell size. Pre-fix, cellSize 1e9 (one
    // cell, sliver shares Q's bucket) hit with value 30 while cellSize 64
    // missed.
    const Q = 2 ** 24;
    const geo = createTriangleMesh(
      [0, 0, 0, 3, 3, 0, 7, 7, 0, Q + 4, Q + 4, 0, Q + 8, Q + 4, 0, Q + 8, Q + 8, 0],
      [0, 1, 2, 3, 4, 5],
    );
    geo.attrs.point.add("uv", "f32", 2).data.set([
      // Sliver: legal (non-degenerate) UV area of ~4 * 2^-30.
      2 ** -7, 2 ** -7 - 2 ** -30, 3, 3, 7, 7,
      // Decoy triangle near Q so the grid reaches Q's cell at fine sizes.
      Q + 4, Q + 4, Q + 8, Q + 4, Q + 8, Q + 8,
    ]);
    geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 100, 200, 300]);
    const queries = [
      [Q, Q], // far along the sliver's carrier line -> must MISS
      [Q + 6, Q + 6], // on the decoy's A-C edge -> hits the decoy
    ];
    let baseline: number[] | null = null;
    for (const cellSize of [undefined, 64, 1e9]) {
      const dst = cloudWithUv(queries);
      dst.attrs.point.add("val", "f32", 1).data.set([999, 999]);
      const opts = cellSize === undefined ? {} : { cellSize };
      const { attribute, missCount } = transferUv(dst, geo, "val", opts);
      const got = attrValues(attribute, 2);
      expect(missCount, `cellSize ${cellSize}`).toBe(1);
      expect(got[0], `cellSize ${cellSize}`).toBe(999); // miss keeps prior
      expect(got[1], `cellSize ${cellSize}`).toBe(200); // w = (0.5, 0, 0.5) over 100,200,300
      if (baseline === null) baseline = got;
      else expect(got, `cellSize ${cellSize}`).toEqual(baseline);
    }
    // The brute-force reference (identical guard) agrees.
    const hits = refUv(cloudWithUv(queries), geo, {});
    expect(hits[0]).toBeNull();
    expect(hits[1]).not.toBeNull();
  });

  it("raises actionable errors", () => {
    const src = unitQuad();
    const noUv = createPointCloud(2);
    expect(() => transferUv(noUv, src, "val")).toThrow(
      /destination point-domain UV attribute "uv" not found/,
    );
    const badUv = createPointCloud(1);
    badUv.attrs.point.add("uv", "f32", 1);
    expect(() => transferUv(badUv, src, "val")).toThrow(/must be f32 with tupleSize >= 2/);
    const dst = cloudWithUv([[0.5, 0.5]]);
    expect(() => transferUv(dst, src, "ghost")).toThrow(
      /attribute "ghost" not found on source point domain/,
    );
    expect(() => transferUv(dst, createPointCloud(3), "density")).toThrow(
      /destination point-domain UV|source UV attribute/,
    );
    const cloudSrc = createPointCloud(3);
    cloudSrc.attrs.point.add("uv", "f32", 2);
    expect(() => transferUv(dst, cloudSrc, "density")).toThrow(/source has no triangles/);
    const noSrcUv = createTriangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    noSrcUv.attrs.point.add("val", "f32", 1);
    expect(() => transferUv(dst, noSrcUv, "val")).toThrow(
      /source UV attribute "uv" not found on the vertex or point domain/,
    );
    expect(() => transferUv(dst, src, "val", { uvDomain: "vertex" })).toThrow(
      /source vertex-domain UV attribute "uv" not found/,
    );
    expect(() => transferUv(dst, src, "val", { cellSize: 0 })).toThrow(
      /cellSize must be a positive finite number/,
    );
    expect(() =>
      transferUv(dst, src, "val", { attrDomain: "primitive" as never }),
    ).toThrow(/attrDomain must be "point" or "vertex"/);
    expect(() => transferUv(dst, src, "val", { uvDomain: "detail" as never })).toThrow(
      /uvDomain must be "auto", "vertex", or "point"/,
    );
  });
});

/** Ground quad on y=0 spanning [0,10]^2 in xz; val = 10..40, id = index. */
function groundQuad(): Geometry {
  const geo = createTriangleMesh(
    [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10],
    [0, 1, 2, 0, 2, 3],
  );
  geo.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
  geo.attrs.point.add("id", "i32", 1).data.set([0, 1, 2, 3]);
  return geo;
}

function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

describe("transferRaycast", () => {
  it("interpolates at the nearest forward hit (known layout)", () => {
    const src = groundQuad();
    const dst = cloudAt([
      [5, 7, 2.5], // hits triangle 0 at (5,0,2.5): w = (0.5, 0.25, 0.25)
      [5, -3, 2.5], // below, ray points down -> t < 0 -> miss
      [50, 7, 50], // off the mesh -> miss
    ]);
    const { attribute, missCount } = transferRaycast(dst, src, "val");
    expect(missCount).toBe(2);
    expect(attrValues(attribute, 3)).toEqual([17.5, 0, 0]);
    // Pointing up from below hits the same spot.
    const dst2 = cloudAt([[5, -3, 2.5]]);
    const up = transferRaycast(dst2, src, "val", { direction: [0, 1, 0] });
    expect(up.missCount).toBe(0);
    expect(attrValues(up.attribute, 1)).toEqual([17.5]);
  });

  it("matches a brute-force scan on adversarial terrain (f32 + i32)", () => {
    const src = terrain(6, 41);
    const rand = makeLcg(42);
    const pts: number[][] = [];
    for (let i = 0; i < 120; i++) pts.push([-2 + rand() * 10, 10, -2 + rand() * 10]);
    // Adversarial: exactly above grid vertices (multi-triangle vertex
    // ties), above quad-diagonal midpoints (shared-edge ties), above the
    // degenerate triangle's line, far away, below the terrain, non-finite.
    pts.push([2, 10, 3], [0, 10, 0], [6, 10, 6], [2.5, 10, 3.5], [1.5, 10, 3.5]);
    pts.push([1, 10, 0], [3e6, 10, 3e6], [2, -50, 3], [Number.NaN, 10, 1]);
    const dst = cloudAt(pts);
    const hits = refRaycast(dst, src, {});
    const nd = dst.pointCount;
    const { attribute, missCount } = transferRaycast(dst, src, "val");
    expect(attrValues(attribute, nd)).toEqual(
      interpExpected(hits, src.attrs.point.require("val").data, 1, new Array<number>(nd).fill(0)),
    );
    expect(missCount).toBe(hits.filter((h) => h === null).length);
    expect(missCount).toBeGreaterThan(0);
    const dst2 = cloudAt(pts);
    const idOut = transferRaycast(dst2, src, "id");
    expect(attrValues(idOut.attribute, nd)).toEqual(
      dominantExpected(hits, src.attrs.point.require("id").data, 1, new Array<number>(nd).fill(0)),
    );
  });

  it("matches brute force with per-point directions", () => {
    const src = terrain(5, 51);
    const rand = makeLcg(52);
    const pts: number[][] = [];
    const dirs: number[] = [];
    for (let i = 0; i < 80; i++) {
      pts.push([rand() * 5, 5 + rand() * 3, rand() * 5]);
      dirs.push(rand() * 2 - 1, -0.2 - rand(), rand() * 2 - 1);
    }
    pts.push([2, 8, 2], [3, 8, 3]);
    dirs.push(0, 0, 0, Number.NaN, -1, 0); // zero and non-finite: misses
    const dst = cloudAt(pts);
    dst.attrs.point.add("dir", "f32", 3).data.set(dirs);
    const hits = refRaycast(dst, src, { dirAttr: "dir" });
    const nd = dst.pointCount;
    const { attribute, missCount } = transferRaycast(dst, src, "val", {
      directionAttr: "dir",
    });
    expect(attrValues(attribute, nd)).toEqual(
      interpExpected(hits, src.attrs.point.require("val").data, 1, new Array<number>(nd).fill(0)),
    );
    expect(missCount).toBe(hits.filter((h) => h === null).length);
    expect(hits[nd - 2]).toBeNull();
    expect(hits[nd - 1]).toBeNull();
  });

  it("equal-distance hits resolve to the lowest triangle index", () => {
    // Vertex-domain values differ across the shared diagonal; a ray
    // through the diagonal hits both triangles at exactly t = 7.
    const src = groundQuad();
    src.attrs.vertex.add("cv", "f32", 1).data.set([1, 2, 3, 4, 5, 6]);
    const dst = cloudAt([
      [5, 7, 5],
      [2.5, 7, 2.5],
    ]);
    const { attribute, missCount } = transferRaycast(dst, src, "cv", {
      attrDomain: "vertex",
    });
    expect(missCount).toBe(0);
    // Triangle 0 wins: on its diagonal w = (1 - z/10, 0, z/10) over 1,2,3.
    expect(attrValues(attribute, 2)).toEqual([2, 1.5]);
  });

  it("the nearest of stacked planes wins regardless of triangle order", () => {
    // Lower plane first in primitive order, upper plane second: casting
    // down from above must pick the upper (nearer) plane's triangles even
    // though their indices are higher.
    const geo = createTriangleMesh(
      [
        0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10, // y = 0
        0, 5, 0, 10, 5, 0, 10, 5, 10, 0, 5, 10, // y = 5
      ],
      [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    );
    const val = geo.attrs.point.add("val", "f32", 1);
    val.data.set([1, 1, 1, 1, 2, 2, 2, 2]);
    const above = cloudAt([[5, 8, 2.5]]);
    expect(attrValues(transferRaycast(above, geo, "val").attribute, 1)).toEqual([2]);
    const between = cloudAt([[5, 3, 2.5]]);
    expect(attrValues(transferRaycast(between, geo, "val").attribute, 1)).toEqual([1]);
    const upward = cloudAt([[5, 3, 2.5]]);
    expect(
      attrValues(transferRaycast(upward, geo, "val", { direction: [0, 1, 0] }).attribute, 1),
    ).toEqual([2]);
  });

  it("maxDistance caps hits in world units", () => {
    const src = groundQuad();
    const mk = (): Geometry => {
      const d = cloudAt([[5, 7, 2.5]]);
      d.attrs.point.add("val", "f32", 1).data.set([999]);
      return d;
    };
    expect(transferRaycast(mk(), src, "val", { maxDistance: 6.9 }).missCount).toBe(1);
    const exact = transferRaycast(mk(), src, "val", { maxDistance: 7 });
    expect(exact.missCount).toBe(0);
    expect(attrValues(exact.attribute, 1)).toEqual([17.5]);
    const kept = transferRaycast(mk(), src, "val", { maxDistance: 0.5 });
    expect(attrValues(kept.attribute, 1)).toEqual([999]); // miss keeps prior
  });

  it("rays parallel to the surface (grazing) miss", () => {
    const src = groundQuad();
    const dst = cloudAt([[5, 0, 5]]); // on the plane, casting along it
    dst.attrs.point.add("val", "f32", 1).data.set([123]);
    const { missCount, attribute } = transferRaycast(dst, src, "val", {
      direction: [1, 0, 0],
    });
    expect(missCount).toBe(1);
    expect(attrValues(attribute, 1)).toEqual([123]);
  });

  it("applies the per-type matrix and the dominant-corner tie rule", () => {
    const src = groundQuad();
    src.attrs.point.add("ui", "u32", 1).data.set([7, 8, 9, 10]);
    src.attrs.point.add("bv", "bool", 1).data.set([0, 1, 1, 0]);
    const sv = src.attrs.point.add("sv", "string", 1);
    ["a", "b", "c", "d"].forEach((s, i) => sv.setString(i, s));
    // Hit at (5,0,5) on the diagonal: w = (0.5, 0, 0.5) — weight tie between
    // corners 0 and 2 resolves to corner 0 (point 0). Hit at (7.5,0,2.5):
    // w = (0.25, 0.5, 0.25) — dominant corner 1 (point 1).
    const mk = (): Geometry => cloudAt([[5, 7, 5], [7.5, 7, 2.5]]);
    expect(attrValues(transferRaycast(mk(), src, "id").attribute, 2)).toEqual([0, 1]);
    expect(attrValues(transferRaycast(mk(), src, "ui").attribute, 2)).toEqual([7, 8]);
    expect(attrValues(transferRaycast(mk(), src, "bv").attribute, 2)).toEqual([0, 1]);
    const svOut = transferRaycast(mk(), src, "sv").attribute;
    expect([svOut.getString(0), svOut.getString(1)]).toEqual(["a", "b"]);
    expect(attrValues(transferRaycast(mk(), src, "val").attribute, 2)).toEqual([20, 20]);
  });

  it("works far from the origin (large offsets)", () => {
    const off = 100000; // exactly representable in f32
    const src = createTriangleMesh(
      [off, 0, off, off + 10, 0, off, off + 10, 0, off + 10, off, 0, off + 10],
      [0, 1, 2, 0, 2, 3],
    );
    src.attrs.point.add("val", "f32", 1).data.set([10, 20, 30, 40]);
    const dst = cloudAt([
      [off + 5, 7, off + 2.5],
      [off - 5, 7, off + 5],
    ]);
    const hits = refRaycast(dst, src, {});
    const { attribute, missCount } = transferRaycast(dst, src, "val");
    expect(missCount).toBe(1);
    expect(attrValues(attribute, 2)).toEqual(
      interpExpected(hits, src.attrs.point.require("val").data, 1, [0, 0]),
    );
  });

  it("is byte-identical across repeated runs and grid cell sizes", () => {
    const src = terrain(5, 61);
    const rand = makeLcg(62);
    const pts: number[][] = [];
    for (let i = 0; i < 60; i++) pts.push([-1 + rand() * 7, 8, -1 + rand() * 7]);
    pts.push([2.5, 8, 3.5], [2, 8, 2]);
    let baseline: number[] | null = null;
    for (const cellSize of [undefined, 0.3, 2, 100]) {
      for (let run = 0; run < 2; run++) {
        const dst = cloudAt(pts);
        const opts = cellSize === undefined ? {} : { cellSize };
        const { attribute } = transferRaycast(dst, src, "val", opts);
        const got = attrValues(attribute, dst.pointCount);
        if (baseline === null) baseline = got;
        else expect(got, `cellSize ${cellSize} run ${run}`).toEqual(baseline);
      }
    }
  });

  it("raises actionable errors", () => {
    const src = groundQuad();
    const dst = cloudAt([[5, 7, 5]]);
    expect(() => transferRaycast(dst, src, "val", { direction: [0, 0, 0] })).toThrow(
      /direction must be a finite, non-zero \[x, y, z\] vector/,
    );
    expect(() => transferRaycast(dst, src, "val", { direction: [1, 0] })).toThrow(
      /direction must be a finite, non-zero/,
    );
    expect(() => transferRaycast(dst, src, "val", { maxDistance: 0 })).toThrow(
      /maxDistance must be a positive finite number/,
    );
    expect(() => transferRaycast(dst, src, "val", { maxDistance: -1 })).toThrow(
      /maxDistance must be a positive finite number/,
    );
    expect(() => transferRaycast(dst, src, "val", { directionAttr: "dir" })).toThrow(
      /destination per-point direction attribute "dir" not found/,
    );
    expect(() => transferRaycast(dst, src, "ghost")).toThrow(
      /attribute "ghost" not found on source point domain/,
    );
    expect(() => transferRaycast(dst, createPointCloud(5), "density")).toThrow(
      /source has no triangles/,
    );
    expect(() => transferRaycast(dst, src, "val", { cellSize: -2 })).toThrow(
      /cellSize must be a positive finite number/,
    );
    const noP = new Geometry();
    noP.attrs.point.add("x", "f32", 1);
    noP.attrs.point.resize(2);
    expect(() => transferRaycast(noP, src, "val")).toThrow(
      /destination position attribute "P" not found/,
    );
  });
});
