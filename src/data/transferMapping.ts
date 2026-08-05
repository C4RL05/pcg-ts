/**
 * Mesh-based attribute transfer: {@link transferUv} (barycentric lookup in
 * the source triangulation's UV space) and {@link transferRaycast} (per-point
 * rays cast against the source triangle mesh). Both create or overwrite the
 * attribute on the destination's point domain and report how many
 * destination points found no source triangle (misses).
 *
 * Shared policies (deterministic by construction, no randomness anywhere):
 *
 * - **Triangles.** Source primitives participate when they have exactly 3
 *   vertices and (when a `primtype` attribute exists) type `"poly"`; other
 *   primitives are ignored. A source with no such primitives is an error.
 *   "Triangle index" below always means ascending source primitive order.
 * - **Degenerate triangles are skipped.** For uv: |doubled signed UV area|
 *   < {@link TRANSFER_AREA_EPS}. For raycast: |cross(edge1, edge2)| <
 *   {@link TRANSFER_AREA_EPS} (zero 3D area). Triangles with non-finite
 *   corner data are also skipped.
 * - **Bounding-box containment guard.** A destination UV (uv) or ray hit
 *   point (raycast) counts as inside a triangle only if it also lies within
 *   that triangle's padded bounding box — the same padded boxes the
 *   acceleration grids bucket by (padding = {@link TRANSFER_BOX_PAD_REL} ×
 *   the triangle's own max extent + 1e-12). This is part of the containment
 *   policy, not an optimization: for near-degenerate sliver triangles the
 *   float64 barycentric predicate can accept points arbitrarily far along
 *   the sliver's carrier line (the tiny perpendicular offset is absorbed by
 *   rounding at large query magnitudes). The box guard rejects those, and it
 *   makes grid pruning and the documented predicate coincide — so the grid
 *   cell size is result-neutral by construction.
 * - **Interpolation by type.** `f32` attributes interpolate barycentrically
 *   (componentwise, accumulated in float64, stored as f32). `i32`, `u32`,
 *   `bool`, and `string` cannot interpolate: they take the value at the
 *   triangle corner with the largest barycentric weight; equal weights
 *   resolve to the first such corner in the triangle's vertex order.
 * - **Misses keep the prior value.** When the destination already has the
 *   attribute with the same type and tuple size, missed elements keep their
 *   existing values; otherwise the attribute is created and missed elements
 *   hold the source attribute's default. The miss count is returned.
 * - **Determinism.** Results are independent of the internal grid cell size
 *   (exposed as a hint for testing): the grids can only skip triangles whose
 *   padded box excludes the query, which the containment policy also
 *   rejects (see the bounding-box guard above) — so which triangle wins is
 *   decided solely by containment/nearest-hit plus the lowest-triangle-index
 *   tie rule, never by cell layout.
 */
import type { Attribute, AttributeSet } from "./attribute.js";
import { PRIMTYPE_ATTR, type Geometry } from "./geometry.js";
import type { AttrData, AttrDefault } from "./types.js";

/**
 * Containment slack on normalized barycentric coordinates: a coordinate as
 * low as -TRANSFER_BARY_EPS still counts as inside (so points exactly on
 * shared edges are contained by both triangles and the lowest triangle
 * index wins deterministically). Applied identically by the uv containment
 * test and the raycast Möller–Trumbore bounds; weights are clamped to >= 0
 * and renormalized before interpolating.
 */
export const TRANSFER_BARY_EPS = 1e-9;

/**
 * Degenerate-triangle threshold: uv triangles with |doubled signed UV area|
 * below this, and raycast triangles with |cross(edge1, edge2)| (twice the
 * 3D area) below this, are skipped entirely.
 */
export const TRANSFER_AREA_EPS = 1e-12;

/**
 * Möller–Trumbore determinant epsilon (ray direction is normalized before
 * the test): |det| below this means the ray is parallel to the triangle
 * plane (or the triangle is degenerate) and the triangle is not hit.
 */
export const TRANSFER_DET_EPS = 1e-12;

/**
 * Relative padding of each triangle's bounding box (× the triangle's own
 * max extent, + 1e-12 absolute). The padded box is used both to bucket the
 * triangle into grid cells and as the containment guard: queries / hit
 * points outside it never count as inside the triangle (see the module
 * policy on the bounding-box containment guard).
 */
export const TRANSFER_BOX_PAD_REL = 1e-6;

/** Grid resolution cap per axis; keeps linear cell keys exact in float64. */
const MAX_DIM = 2048;

/** Domain the transferred source attribute is read from. */
export type TransferAttrDomain = "point" | "vertex";

/** Result of {@link transferUv} / {@link transferRaycast}. */
export interface TransferMappingResult {
  /** The attribute created or overwritten on the destination point domain. */
  attribute: Attribute;
  /** Destination points with no containing triangle / no ray hit. */
  missCount: number;
}

/** Options for {@link transferUv}. */
export interface TransferUvOptions {
  /**
   * UV attribute name on both geometries (default "uv"). On the destination
   * it must live on the point domain (f32, tupleSize >= 2; components
   * beyond the first two are ignored). On the source its domain follows
   * `uvDomain`.
   */
  uvAttr?: string;
  /**
   * Which source domain holds the UVs: "vertex" (per-corner UVs, the norm
   * for meshes — supports seams), "point" (shared across all triangles
   * touching the point), or "auto" (default: vertex when present, else
   * point).
   */
  uvDomain?: "auto" | "vertex" | "point";
  /**
   * Domain the transferred attribute is read from on the source: "point"
   * (default; triangle corners read through vertexToPoint) or "vertex"
   * (per-corner values). The result always lands on the destination's
   * point domain.
   */
  attrDomain?: TransferAttrDomain;
  /**
   * Uniform-grid cell size hint in UV units. Derived from the triangle
   * count when omitted; raised if it would exceed the maximum grid
   * resolution. Never affects results — only lookup cost.
   */
  cellSize?: number;
}

/** Options for {@link transferRaycast}. */
export interface TransferRaycastOptions {
  /**
   * Constant ray direction ([x, y, z], default [0, -1, 0]). Normalized
   * internally, so hit distances are world-space. Must be finite and
   * non-zero. Ignored when `directionAttr` is set.
   */
  direction?: readonly number[];
  /**
   * Per-point ray direction attribute on the destination point domain
   * (f32, tupleSize >= 3), overriding `direction`. Each direction is
   * normalized per point; points with a zero or non-finite direction miss.
   */
  directionAttr?: string;
  /**
   * Maximum world-space hit distance (must be a positive finite number
   * when given). Hits farther along the ray are ignored. Unlimited when
   * omitted. Rays are forward-only regardless: hits need t >= 0.
   */
  maxDistance?: number;
  /** Position attribute name on both geometries (default "P", f32, tupleSize >= 3). */
  positionAttr?: string;
  /** Same contract as {@link TransferUvOptions.attrDomain}. */
  attrDomain?: TransferAttrDomain;
  /**
   * Uniform-grid cell size hint in world units. Derived when omitted;
   * raised if it would exceed the maximum grid resolution. Never affects
   * results — only lookup cost.
   */
  cellSize?: number;
}

function requireF32(
  set: AttributeSet,
  name: string,
  minTuple: number,
  fn: string,
  what: string,
): Attribute<"f32"> {
  const attr = set.get(name);
  if (!attr) {
    throw new Error(
      `${fn}: ${what} attribute "${name}" not found (needs f32, tupleSize >= ${minTuple}); available: ${set.names().join(", ") || "(none)"}`,
    );
  }
  if (attr.type !== "f32" || attr.tupleSize < minTuple) {
    throw new Error(
      `${fn}: ${what} attribute "${name}" must be f32 with tupleSize >= ${minTuple}, got ${attr.type} tuple ${attr.tupleSize}`,
    );
  }
  return attr as Attribute<"f32">;
}

function requireSourceAttr(
  src: Geometry,
  attrName: string,
  attrDomain: TransferAttrDomain,
  fn: string,
): Attribute {
  if (attrDomain !== "point" && attrDomain !== "vertex") {
    throw new Error(
      `${fn}: attrDomain must be "point" or "vertex", got ${JSON.stringify(attrDomain)}`,
    );
  }
  const set = src.attrs[attrDomain];
  const attr = set.get(attrName);
  if (!attr) {
    throw new Error(
      `${fn}: attribute "${attrName}" not found on source ${attrDomain} domain; available: ${set.names().join(", ") || "(none)"}`,
    );
  }
  return attr;
}

/**
 * Start-vertex of every usable triangle (3-vertex "poly" primitives), in
 * ascending primitive order — the "triangle index" order all tie rules
 * refer to. Throws when the source has none.
 */
function collectTriangles(src: Geometry, fn: string): Uint32Array {
  const counts = src.primVertexCount;
  const starts = src.primVertexStart;
  const primType = src.attrs.primitive.get(PRIMTYPE_ATTR);
  const out: number[] = [];
  for (let p = 0; p < src.primitiveCount; p++) {
    if (counts[p] !== 3) continue;
    if (primType && primType.getString(p) !== "poly") continue;
    out.push(starts[p]);
  }
  if (out.length === 0) {
    throw new Error(
      `${fn}: source has no triangles (needs 3-vertex "poly" primitives; build meshes with createTriangleMesh, or triangulate before transferring)`,
    );
  }
  return Uint32Array.from(out);
}

/** Pick a cell size targeting a few triangles per occupied cell. */
function deriveCell(extents: readonly number[], count: number): number {
  let volume = 1;
  let axes = 0;
  for (const e of extents) {
    if (e > 0) {
      volume *= e;
      axes++;
    }
  }
  if (axes === 0) return 1;
  const cell = Math.pow(volume / count, 1 / axes) * 2;
  return Number.isFinite(cell) && cell > 0 ? cell : 1;
}

function checkCellSize(cell: number, fn: string): void {
  if (!Number.isFinite(cell) || cell <= 0) {
    throw new Error(`${fn}: cellSize must be a positive finite number`);
  }
}

/**
 * Write the mapped values onto the destination point domain. `cornerElem`
 * holds the three source element indices (point or vertex, per attrDomain)
 * and `weights` the normalized barycentric weights of each hit; `hit[j]`
 * is 0 for misses. Applies the documented per-type interpolation and
 * miss policies.
 */
function writeMapped(
  dst: Geometry,
  srcAttr: Attribute,
  attrName: string,
  cornerElem: Uint32Array,
  weights: Float64Array,
  hit: Uint8Array,
): TransferMappingResult {
  const dstSet = dst.attrs.point;
  const nd = dstSet.count;
  const ts = srcAttr.tupleSize;
  const existing = dstSet.get(attrName);
  const inPlace =
    existing !== undefined && existing.type === srcAttr.type && existing.tupleSize === ts;

  // Snapshot source values if writing in place would clobber them
  // (transfer onto the same geometry/attribute).
  let readData: AttrData = srcAttr.data;
  let readStrings: readonly string[] = srcAttr.stringTable;
  if (existing === srcAttr) {
    readData = srcAttr.data.slice();
    readStrings = srcAttr.stringTable.slice();
  }

  const out =
    inPlace && existing
      ? existing
      : dstSet.replace(attrName, srcAttr.type, ts, srcAttr.defaultValue as AttrDefault);

  let missCount = 0;
  if (srcAttr.type === "f32") {
    const outData = out.data;
    for (let j = 0; j < nd; j++) {
      if (hit[j] === 0) {
        missCount++;
        continue;
      }
      const o = j * 3;
      const e0 = cornerElem[o] * ts;
      const e1 = cornerElem[o + 1] * ts;
      const e2 = cornerElem[o + 2] * ts;
      const w0 = weights[o];
      const w1 = weights[o + 1];
      const w2 = weights[o + 2];
      const dofs = j * ts;
      for (let k = 0; k < ts; k++) {
        outData[dofs + k] = w0 * readData[e0 + k] + w1 * readData[e1 + k] + w2 * readData[e2 + k];
      }
    }
    return { attribute: out, missCount };
  }
  // i32/u32/bool/string cannot interpolate: dominant corner (largest
  // barycentric weight; equal weights resolve to the first such corner in
  // the triangle's vertex order).
  const isString = srcAttr.type === "string";
  const outData = out.data;
  for (let j = 0; j < nd; j++) {
    if (hit[j] === 0) {
      missCount++;
      continue;
    }
    const o = j * 3;
    let c = 0;
    if (weights[o + 1] > weights[o + c]) c = 1;
    if (weights[o + 2] > weights[o + c]) c = 2;
    const so = cornerElem[o + c] * ts;
    const dofs = j * ts;
    if (isString) {
      for (let k = 0; k < ts; k++) out.setString(j, readStrings[readData[so + k]] ?? "", k);
    } else {
      for (let k = 0; k < ts; k++) outData[dofs + k] = readData[so + k];
    }
  }
  return { attribute: out, missCount };
}

/**
 * Transfer an attribute from `src` to `dst` by UV lookup: each destination
 * point's UV (from the destination point-domain `uvAttr`) is located in the
 * source triangulation's UV space, and the source attribute is
 * barycentrically interpolated inside the containing triangle.
 *
 * Containment requires both (a) the UV to lie within the triangle's padded
 * UV bounding box (see {@link TRANSFER_BOX_PAD_REL} and the module policy —
 * this guards sliver triangles against fp-collapsed barycentrics) and (b)
 * normalized barycentric coordinates within a slack of
 * {@link TRANSFER_BARY_EPS}, so a UV exactly on an edge shared by two
 * triangles is contained by both — the lowest triangle index (ascending
 * source primitive order) wins. UVs outside every triangle, and
 * destination UVs with non-finite components, are misses (prior value
 * kept; see the module policy). Degenerate (zero-UV-area) triangles are
 * skipped. Accelerated with a deterministic 2D uniform grid over the same
 * padded boxes; the grid cell size never affects results (the guard and
 * the bucketing use one predicate).
 *
 * Creates or overwrites the attribute on `dst`'s point domain and returns
 * it with the miss count.
 */
export function transferUv(
  dst: Geometry,
  src: Geometry,
  attrName: string,
  options: TransferUvOptions = {},
): TransferMappingResult {
  const fn = "transferUv";
  const uvName = options.uvAttr ?? "uv";
  const attrDomain = options.attrDomain ?? "point";
  const srcAttr = requireSourceAttr(src, attrName, attrDomain, fn);
  const dstUv = requireF32(dst.attrs.point, uvName, 2, fn, "destination point-domain UV");

  const uvDomainOpt = options.uvDomain ?? "auto";
  let srcUvDomain: "vertex" | "point";
  if (uvDomainOpt === "auto") {
    if (src.attrs.vertex.has(uvName)) srcUvDomain = "vertex";
    else if (src.attrs.point.has(uvName)) srcUvDomain = "point";
    else {
      throw new Error(
        `${fn}: source UV attribute "${uvName}" not found on the vertex or point domain (needs f32, tupleSize >= 2); add per-corner UVs on vertices (preferred, supports seams) or shared UVs on points`,
      );
    }
  } else if (uvDomainOpt === "vertex" || uvDomainOpt === "point") {
    srcUvDomain = uvDomainOpt;
  } else {
    throw new Error(
      `${fn}: uvDomain must be "auto", "vertex", or "point", got ${JSON.stringify(uvDomainOpt)}`,
    );
  }
  const srcUv = requireF32(src.attrs[srcUvDomain], uvName, 2, fn, `source ${srcUvDomain}-domain UV`);

  const triStart = collectTriangles(src, fn);
  const v2p = src.vertexToPoint;
  const us = srcUv.tupleSize;
  const ud = srcUv.data;

  // Compact usable (finite, non-degenerate) triangles: corner UVs, inverse
  // doubled signed area, attr corner element ids, padded UV bbox.
  const ntAll = triStart.length;
  const triUv = new Float64Array(ntAll * 6);
  const triInv = new Float64Array(ntAll);
  const triCorner = new Uint32Array(ntAll * 3);
  const triBox = new Float64Array(ntAll * 4);
  let nt = 0;
  for (let t = 0; t < ntAll; t++) {
    const v = triStart[t];
    const c0 = (srcUvDomain === "vertex" ? v : v2p[v]) * us;
    const c1 = (srcUvDomain === "vertex" ? v + 1 : v2p[v + 1]) * us;
    const c2 = (srcUvDomain === "vertex" ? v + 2 : v2p[v + 2]) * us;
    const u0 = ud[c0];
    const v0 = ud[c0 + 1];
    const u1 = ud[c1];
    const v1 = ud[c1 + 1];
    const u2 = ud[c2];
    const v2 = ud[c2 + 1];
    const area2 = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    // Skips NaN areas (non-finite corner UVs) along with degenerates.
    if (!(Math.abs(area2) >= TRANSFER_AREA_EPS) || !Number.isFinite(area2)) continue;
    const o6 = nt * 6;
    triUv[o6] = u0;
    triUv[o6 + 1] = v0;
    triUv[o6 + 2] = u1;
    triUv[o6 + 3] = v1;
    triUv[o6 + 4] = u2;
    triUv[o6 + 5] = v2;
    triInv[nt] = 1 / area2;
    const o3 = nt * 3;
    triCorner[o3] = attrDomain === "vertex" ? v : v2p[v];
    triCorner[o3 + 1] = attrDomain === "vertex" ? v + 1 : v2p[v + 1];
    triCorner[o3 + 2] = attrDomain === "vertex" ? v + 2 : v2p[v + 2];
    const bu0 = Math.min(u0, u1, u2);
    const bu1 = Math.max(u0, u1, u2);
    const bv0 = Math.min(v0, v1, v2);
    const bv1 = Math.max(v0, v1, v2);
    // The padded box doubles as grid-bucketing extent and containment
    // guard (see the module policy), so epsilon-boundary candidates are
    // always found in the query's grid cell and far-away queries can never
    // "hit" a sliver whose barycentrics collapse under fp rounding.
    const pad = TRANSFER_BOX_PAD_REL * Math.max(bu1 - bu0, bv1 - bv0) + 1e-12;
    const o4 = nt * 4;
    triBox[o4] = bu0 - pad;
    triBox[o4 + 1] = bv0 - pad;
    triBox[o4 + 2] = bu1 + pad;
    triBox[o4 + 3] = bv1 + pad;
    nt++;
  }

  const nd = dst.attrs.point.count;
  const cornerElem = new Uint32Array(nd * 3);
  const weights = new Float64Array(nd * 3);
  const hit = new Uint8Array(nd);

  if (nt > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let ti = 0; ti < nt; ti++) {
      const o4 = ti * 4;
      if (triBox[o4] < minX) minX = triBox[o4];
      if (triBox[o4 + 1] < minY) minY = triBox[o4 + 1];
      if (triBox[o4 + 2] > maxX) maxX = triBox[o4 + 2];
      if (triBox[o4 + 3] > maxY) maxY = triBox[o4 + 3];
    }
    const ex = maxX - minX;
    const ey = maxY - minY;
    let cell = options.cellSize ?? deriveCell([ex, ey], nt);
    checkCellSize(cell, fn);
    cell = Math.max(cell, ex / MAX_DIM, ey / MAX_DIM);
    const nx = Math.floor(ex / cell) + 1;
    const ny = Math.floor(ey / cell) + 1;

    // Bucket triangles by every overlapped cell; ascending ti keeps each
    // bucket in ascending triangle order (the tie-rule order).
    const cells = new Map<number, number[]>();
    for (let ti = 0; ti < nt; ti++) {
      const o4 = ti * 4;
      const x0 = Math.max(0, Math.floor((triBox[o4] - minX) / cell));
      const y0 = Math.max(0, Math.floor((triBox[o4 + 1] - minY) / cell));
      const x1 = Math.min(nx - 1, Math.floor((triBox[o4 + 2] - minX) / cell));
      const y1 = Math.min(ny - 1, Math.floor((triBox[o4 + 3] - minY) / cell));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cx + nx * cy;
          let bucket = cells.get(key);
          if (!bucket) {
            bucket = [];
            cells.set(key, bucket);
          }
          bucket.push(ti);
        }
      }
    }

    const uts = dstUv.tupleSize;
    const uvd = dstUv.data;
    for (let j = 0; j < nd; j++) {
      const qu = uvd[j * uts];
      const qv = uvd[j * uts + 1];
      if (!Number.isFinite(qu) || !Number.isFinite(qv)) continue; // miss
      const cx = Math.floor((qu - minX) / cell);
      if (cx < 0 || cx >= nx) continue;
      const cy = Math.floor((qv - minY) / cell);
      if (cy < 0 || cy >= ny) continue;
      const bucket = cells.get(cx + nx * cy);
      if (!bucket) continue;
      for (const ti of bucket) {
        // Containment policy part 1: inside the triangle's padded UV box.
        // Not just an early-out — without it, near-degenerate slivers
        // would accept far-away queries whose barycentrics collapse to the
        // carrier line under fp rounding, and results would depend on
        // which cells the grid happens to bucket the sliver into.
        const o4 = ti * 4;
        if (qu < triBox[o4] || qv < triBox[o4 + 1] || qu > triBox[o4 + 2] || qv > triBox[o4 + 3]) {
          continue;
        }
        const o6 = ti * 6;
        const inv = triInv[ti];
        const w0 =
          ((triUv[o6 + 2] - qu) * (triUv[o6 + 5] - qv) -
            (triUv[o6 + 4] - qu) * (triUv[o6 + 3] - qv)) *
          inv;
        if (w0 < -TRANSFER_BARY_EPS) continue;
        const w1 =
          ((triUv[o6 + 4] - qu) * (triUv[o6 + 1] - qv) -
            (triUv[o6] - qu) * (triUv[o6 + 5] - qv)) *
          inv;
        if (w1 < -TRANSFER_BARY_EPS) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -TRANSFER_BARY_EPS) continue;
        // First containing triangle in ascending order = lowest index.
        const a = w0 > 0 ? w0 : 0;
        const b = w1 > 0 ? w1 : 0;
        const c = w2 > 0 ? w2 : 0;
        const s = 1 / (a + b + c);
        const o = j * 3;
        weights[o] = a * s;
        weights[o + 1] = b * s;
        weights[o + 2] = c * s;
        const t3 = ti * 3;
        cornerElem[o] = triCorner[t3];
        cornerElem[o + 1] = triCorner[t3 + 1];
        cornerElem[o + 2] = triCorner[t3 + 2];
        hit[j] = 1;
        break;
      }
    }
  }

  return writeMapped(dst, srcAttr, attrName, cornerElem, weights, hit);
}

/**
 * Transfer an attribute from `src` to `dst` by raycast: from each
 * destination point a ray is cast along `direction` (or the per-point
 * `directionAttr`), normalized so hit distances are world-space, against
 * the source triangle mesh (positions from the point domain via topology).
 * The source attribute is barycentrically interpolated at the nearest hit.
 *
 * Intersection is Möller–Trumbore in float64 with |det| <
 * {@link TRANSFER_DET_EPS} rejected (parallel/degenerate) and barycentric
 * bounds slackened by {@link TRANSFER_BARY_EPS} (so rays through shared
 * edges hit both triangles); additionally the hit point must lie within
 * the triangle's padded 3D bounding box (see {@link TRANSFER_BOX_PAD_REL}
 * and the module policy — this guards sliver triangles against
 * fp-collapsed barycentric bounds far along the carrier plane). Rays are
 * forward-only (t >= 0; a hit at the origin counts); the nearest hit
 * (smallest t, capped by `maxDistance`) wins and exactly-equal t resolves
 * to the lowest triangle index (ascending source primitive order). Points
 * with non-finite positions or zero/non-finite directions, and rays
 * hitting nothing, are misses (prior value kept; see the module policy).
 * Zero-area triangles are skipped. Accelerated with a deterministic 3D
 * uniform grid over the same padded boxes, walked by DDA; the walk and the
 * grid cell size never affect results (every accepted hit lies inside a
 * box the triangle is bucketed by).
 *
 * Creates or overwrites the attribute on `dst`'s point domain and returns
 * it with the miss count.
 */
export function transferRaycast(
  dst: Geometry,
  src: Geometry,
  attrName: string,
  options: TransferRaycastOptions = {},
): TransferMappingResult {
  const fn = "transferRaycast";
  const posName = options.positionAttr ?? "P";
  const attrDomain = options.attrDomain ?? "point";
  const srcAttr = requireSourceAttr(src, attrName, attrDomain, fn);
  const srcP = requireF32(src.attrs.point, posName, 3, fn, "source position");
  const dstP = requireF32(dst.attrs.point, posName, 3, fn, "destination position");

  let dirData: Float32Array | null = null;
  let dirStride = 3;
  if (options.directionAttr !== undefined && options.directionAttr !== "") {
    const attr = requireF32(
      dst.attrs.point,
      options.directionAttr,
      3,
      fn,
      "destination per-point direction",
    );
    dirData = attr.data;
    dirStride = attr.tupleSize;
  }
  let cdx = 0;
  let cdy = -1;
  let cdz = 0;
  if (dirData === null) {
    const d = options.direction ?? [0, -1, 0];
    const x = d[0];
    const y = d[1];
    const z = d[2];
    const len =
      d.length >= 3 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        ? Math.sqrt(x * x + y * y + z * z)
        : NaN;
    if (!(len > 0) || !Number.isFinite(len)) {
      throw new Error(
        `${fn}: direction must be a finite, non-zero [x, y, z] vector, got ${JSON.stringify(d)}; pass e.g. [0, -1, 0] to cast straight down`,
      );
    }
    cdx = x / len;
    cdy = y / len;
    cdz = z / len;
  }

  const maxT = options.maxDistance ?? Infinity;
  if (options.maxDistance !== undefined && (!Number.isFinite(maxT) || maxT <= 0)) {
    throw new Error(
      `${fn}: maxDistance must be a positive finite number (world units), got ${String(options.maxDistance)}; omit it for an unlimited ray`,
    );
  }

  const triStart = collectTriangles(src, fn);
  const v2p = src.vertexToPoint;
  const ps = srcP.tupleSize;
  const pd = srcP.data;

  // Compact usable triangles: [A, edge1, edge2] in float64, attr corner
  // element ids, padded world bbox.
  const ntAll = triStart.length;
  const triGeo = new Float64Array(ntAll * 9);
  const triCorner = new Uint32Array(ntAll * 3);
  const triBox = new Float64Array(ntAll * 6);
  let nt = 0;
  for (let t = 0; t < ntAll; t++) {
    const v = triStart[t];
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
    // Skips NaN (non-finite corner positions) along with zero-area tris.
    if (!(twiceArea >= TRANSFER_AREA_EPS) || !Number.isFinite(twiceArea)) continue;
    const o9 = nt * 9;
    triGeo[o9] = ax;
    triGeo[o9 + 1] = ay;
    triGeo[o9 + 2] = az;
    triGeo[o9 + 3] = e1x;
    triGeo[o9 + 4] = e1y;
    triGeo[o9 + 5] = e1z;
    triGeo[o9 + 6] = e2x;
    triGeo[o9 + 7] = e2y;
    triGeo[o9 + 8] = e2z;
    const o3 = nt * 3;
    triCorner[o3] = attrDomain === "vertex" ? v : v2p[v];
    triCorner[o3 + 1] = attrDomain === "vertex" ? v + 1 : v2p[v + 1];
    triCorner[o3 + 2] = attrDomain === "vertex" ? v + 2 : v2p[v + 2];
    const bx0 = Math.min(ax, ax + e1x, ax + e2x);
    const by0 = Math.min(ay, ay + e1y, ay + e2y);
    const bz0 = Math.min(az, az + e1z, az + e2z);
    const bx1 = Math.max(ax, ax + e1x, ax + e2x);
    const by1 = Math.max(ay, ay + e1y, ay + e2y);
    const bz1 = Math.max(az, az + e1z, az + e2z);
    const pad = TRANSFER_BOX_PAD_REL * Math.max(bx1 - bx0, by1 - by0, bz1 - bz0) + 1e-12;
    const o6 = nt * 6;
    triBox[o6] = bx0 - pad;
    triBox[o6 + 1] = by0 - pad;
    triBox[o6 + 2] = bz0 - pad;
    triBox[o6 + 3] = bx1 + pad;
    triBox[o6 + 4] = by1 + pad;
    triBox[o6 + 5] = bz1 + pad;
    nt++;
  }

  const nd = dst.attrs.point.count;
  const cornerElem = new Uint32Array(nd * 3);
  const weights = new Float64Array(nd * 3);
  const hit = new Uint8Array(nd);

  if (nt > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let ti = 0; ti < nt; ti++) {
      const o6 = ti * 6;
      if (triBox[o6] < minX) minX = triBox[o6];
      if (triBox[o6 + 1] < minY) minY = triBox[o6 + 1];
      if (triBox[o6 + 2] < minZ) minZ = triBox[o6 + 2];
      if (triBox[o6 + 3] > maxX) maxX = triBox[o6 + 3];
      if (triBox[o6 + 4] > maxY) maxY = triBox[o6 + 4];
      if (triBox[o6 + 5] > maxZ) maxZ = triBox[o6 + 5];
    }
    const ex = maxX - minX;
    const ey = maxY - minY;
    const ez = maxZ - minZ;
    let cell = options.cellSize ?? deriveCell([ex, ey, ez], nt);
    checkCellSize(cell, fn);
    cell = Math.max(cell, ex / MAX_DIM, ey / MAX_DIM, ez / MAX_DIM);
    const nx = Math.floor(ex / cell) + 1;
    const ny = Math.floor(ey / cell) + 1;
    const nz = Math.floor(ez / cell) + 1;

    const cells = new Map<number, number[]>();
    for (let ti = 0; ti < nt; ti++) {
      const o6 = ti * 6;
      const x0 = Math.max(0, Math.floor((triBox[o6] - minX) / cell));
      const y0 = Math.max(0, Math.floor((triBox[o6 + 1] - minY) / cell));
      const z0 = Math.max(0, Math.floor((triBox[o6 + 2] - minZ) / cell));
      const x1 = Math.min(nx - 1, Math.floor((triBox[o6 + 3] - minX) / cell));
      const y1 = Math.min(ny - 1, Math.floor((triBox[o6 + 4] - minY) / cell));
      const z1 = Math.min(nz - 1, Math.floor((triBox[o6 + 5] - minZ) / cell));
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            const key = cx + nx * (cy + ny * cz);
            let bucket = cells.get(key);
            if (!bucket) {
              bucket = [];
              cells.set(key, bucket);
            }
            bucket.push(ti);
          }
        }
      }
    }

    // Per-query dedup stamp so triangles spanning several cells are tested
    // once (results are unaffected either way — same (t, index) outcome).
    const stamp = new Uint32Array(nt);
    let stampId = 0;

    const dps = dstP.tupleSize;
    const dpd = dstP.data;
    for (let j = 0; j < nd; j++) {
      const ox = dpd[j * dps];
      const oy = dpd[j * dps + 1];
      const oz = dpd[j * dps + 2];
      if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) continue;
      let dx = cdx;
      let dy = cdy;
      let dz = cdz;
      if (dirData !== null) {
        const rx = dirData[j * dirStride];
        const ry = dirData[j * dirStride + 1];
        const rz = dirData[j * dirStride + 2];
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (!(len > 0) || !Number.isFinite(len)) continue; // zero/non-finite direction: miss
        dx = rx / len;
        dy = ry / len;
        dz = rz / len;
      }

      // Clip the ray to the grid box (slab test) within [0, maxT]; every
      // possible hit lies inside the padded triangle bounds, so an empty
      // interval is a guaranteed miss.
      let t0 = 0;
      let t1 = maxT;
      let outside = false;
      for (let axis = 0; axis < 3; axis++) {
        const o = axis === 0 ? ox : axis === 1 ? oy : oz;
        const d = axis === 0 ? dx : axis === 1 ? dy : dz;
        const lo = axis === 0 ? minX : axis === 1 ? minY : minZ;
        const hi = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
        if (d === 0) {
          if (o < lo || o > hi) {
            outside = true;
            break;
          }
        } else {
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) {
            const tmp = ta;
            ta = tb;
            tb = tmp;
          }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) {
            outside = true;
            break;
          }
        }
      }
      if (outside) continue;

      // DDA setup from the entry point.
      let cx = Math.min(nx - 1, Math.max(0, Math.floor((ox + dx * t0 - minX) / cell)));
      let cy = Math.min(ny - 1, Math.max(0, Math.floor((oy + dy * t0 - minY) / cell)));
      let cz = Math.min(nz - 1, Math.max(0, Math.floor((oz + dz * t0 - minZ) / cell)));
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      const tDeltaX = stepX !== 0 ? cell / Math.abs(dx) : Infinity;
      const tDeltaY = stepY !== 0 ? cell / Math.abs(dy) : Infinity;
      const tDeltaZ = stepZ !== 0 ? cell / Math.abs(dz) : Infinity;
      let tMaxX =
        stepX !== 0 ? (minX + (cx + (stepX > 0 ? 1 : 0)) * cell - ox) / dx : Infinity;
      let tMaxY =
        stepY !== 0 ? (minY + (cy + (stepY > 0 ? 1 : 0)) * cell - oy) / dy : Infinity;
      let tMaxZ =
        stepZ !== 0 ? (minZ + (cz + (stepZ > 0 ? 1 : 0)) * cell - oz) / dz : Infinity;

      stampId++;
      let bestT = Infinity;
      let bestTri = -1;
      let bestU = 0;
      let bestV = 0;
      for (;;) {
        const bucket = cells.get(cx + nx * (cy + ny * cz));
        if (bucket) {
          for (const ti of bucket) {
            if (stamp[ti] === stampId) continue;
            stamp[ti] = stampId;
            const o9 = ti * 9;
            const e1x = triGeo[o9 + 3];
            const e1y = triGeo[o9 + 4];
            const e1z = triGeo[o9 + 5];
            const e2x = triGeo[o9 + 6];
            const e2y = triGeo[o9 + 7];
            const e2z = triGeo[o9 + 8];
            const px = dy * e2z - dz * e2y;
            const py = dz * e2x - dx * e2z;
            const pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < TRANSFER_DET_EPS) continue;
            const inv = 1 / det;
            const tx = ox - triGeo[o9];
            const ty = oy - triGeo[o9 + 1];
            const tz = oz - triGeo[o9 + 2];
            const u = (tx * px + ty * py + tz * pz) * inv;
            if (u < -TRANSFER_BARY_EPS || u > 1 + TRANSFER_BARY_EPS) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < -TRANSFER_BARY_EPS || u + v > 1 + TRANSFER_BARY_EPS) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (t < 0 || t > maxT) continue;
            // Containment policy part 2 (mirrors the uv box guard): the
            // hit point must lie inside the triangle's padded 3D box. For
            // sliver triangles the u/v bounds can collapse under fp
            // rounding far along the carrier plane; the guard rejects
            // those and also makes the DDA provably complete — every
            // accepted hit lies in a cell the triangle is bucketed into.
            const b6 = ti * 6;
            const hx = ox + dx * t;
            const hy = oy + dy * t;
            const hz = oz + dz * t;
            if (
              hx < triBox[b6] ||
              hy < triBox[b6 + 1] ||
              hz < triBox[b6 + 2] ||
              hx > triBox[b6 + 3] ||
              hy > triBox[b6 + 4] ||
              hz > triBox[b6 + 5]
            ) {
              continue;
            }
            if (t < bestT || (t === bestT && ti < bestTri)) {
              bestT = t;
              bestTri = ti;
              bestU = u;
              bestV = v;
            }
          }
        }
        const tNext = Math.min(tMaxX, tMaxY, tMaxZ);
        // A hit at t' lies in a cell entered at tEntry <= t'; strict >
        // keeps scanning through equal-t cells so the exact tie rule
        // (lowest triangle index) always sees every candidate.
        if (tNext > t1) break;
        if (bestTri >= 0 && tNext > bestT) break;
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
          cx += stepX;
          if (cx < 0 || cx >= nx) break;
          tMaxX += tDeltaX;
        } else if (tMaxY <= tMaxZ) {
          cy += stepY;
          if (cy < 0 || cy >= ny) break;
          tMaxY += tDeltaY;
        } else {
          cz += stepZ;
          if (cz < 0 || cz >= nz) break;
          tMaxZ += tDeltaZ;
        }
      }

      if (bestTri >= 0) {
        // Möller–Trumbore u, v weight corners B and C.
        let w0 = 1 - bestU - bestV;
        let w1 = bestU;
        let w2 = bestV;
        if (w0 < 0) w0 = 0;
        if (w1 < 0) w1 = 0;
        if (w2 < 0) w2 = 0;
        const s = 1 / (w0 + w1 + w2);
        const o = j * 3;
        weights[o] = w0 * s;
        weights[o + 1] = w1 * s;
        weights[o + 2] = w2 * s;
        const t3 = bestTri * 3;
        cornerElem[o] = triCorner[t3];
        cornerElem[o + 1] = triCorner[t3 + 1];
        cornerElem[o + 2] = triCorner[t3 + 2];
        hit[j] = 1;
      }
    }
  }

  return writeMapped(dst, srcAttr, attrName, cornerElem, weights, hit);
}
