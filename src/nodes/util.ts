/**
 * Internal helpers shared by the standard node library: input plumbing,
 * field resolution, point gathering/compaction, and quaternion math.
 * Not part of the public API.
 */
import { Geometry, PRIMTYPE_ATTR, type AttrDefault } from "../data/index.js";
import {
  type Column,
  type Field,
  type FieldLike,
  type GpuFieldResolver,
  evaluateField,
  isField,
  resolveField,
} from "../fields/index.js";
import type { DataCollection, GeometryItem } from "../graph/index.js";

/** All geometry items on a pin, in connection order. */
export function geometryItems(collection: DataCollection): GeometryItem[] {
  return collection.filter((item): item is GeometryItem => item.kind === "geometry");
}

/**
 * The first geometry connected to a pin; throws an actionable error
 * naming the node type and pin when none is connected.
 */
export function requireGeometry(
  inputs: Record<string, DataCollection>,
  pin: string,
  nodeType: string,
): Geometry {
  for (const item of inputs[pin] ?? []) {
    if (item.kind === "geometry") return item.geo;
  }
  throw new Error(`${nodeType}: input pin "${pin}" has no geometry connected`);
}

/** A param value that may be a plain value or a Field. */
export type FieldParam = FieldLike;

/**
 * Resolve a field-capable param against a geometry domain. Plain numbers
 * and tuples become constants; Fields evaluate with the given seed.
 */
export function resolveOn(
  geo: Geometry,
  domain: "point" | "vertex" | "primitive" | "detail",
  value: FieldLike,
  seed: number,
): Column {
  const field: Field = isField(value) ? value : resolveField(value);
  return evaluateField(field, { geo, domain, seed });
}

/**
 * Try to resolve a field-capable param on the GPU. Returns the resolved
 * column, or `null` when the param is a plain value (constants are
 * cheaper on the CPU than a dispatch) or the resolver declares the field
 * ineligible — the caller then falls back to {@link resolveOn}, which
 * must produce the same bytes the GPU path would have. Counter recording
 * happens inside the resolver (the cook's stats view).
 */
export async function tryResolveOnGpu(
  gpu: GpuFieldResolver,
  geo: Geometry,
  domain: "point" | "vertex" | "primitive" | "detail",
  value: FieldLike,
  seed: number,
): Promise<Column | null> {
  if (!isField(value)) return null;
  const pending = gpu.resolveField(value, { geo, domain, seed });
  return pending === null ? null : await pending;
}

/**
 * The standard optional-GPU resolution pattern for adopting nodes
 * (`NodeDef.gpu: "fields"`): try the resolver when the cook carries one
 * ({@link tryResolveOnGpu}), otherwise — or on ineligibility — fall
 * back to the CPU {@link resolveOn} with the exact same geometry,
 * domain, and seed, so fallback bytes are what the CPU-only cook
 * produces. GPU columns are freshly allocated where CPU columns may be
 * zero-copy views of attribute storage; callers must therefore resolve
 * every field-capable param BEFORE mutating any attribute a param
 * could read (all adopters do — see their execute bodies).
 */
export async function resolveOnMaybeGpu(
  gpu: GpuFieldResolver | undefined,
  geo: Geometry,
  domain: "point" | "vertex" | "primitive" | "detail",
  value: FieldLike,
  seed: number,
): Promise<Column> {
  if (gpu !== undefined) {
    const col = await tryResolveOnGpu(gpu, geo, domain, value, seed);
    if (col !== null) return col;
  }
  return resolveOn(geo, domain, value, seed);
}

/**
 * Require the column's tuple size to be one of `allowed`; error names the
 * node type and param.
 */
export function requireTuple(
  col: Column,
  allowed: readonly number[],
  nodeType: string,
  param: string,
): Column {
  if (!allowed.includes(col.tupleSize)) {
    throw new Error(
      `${nodeType}: param "${param}" must evaluate to tupleSize ${allowed.join(" or ")}, got ${col.tupleSize}`,
    );
  }
  return col;
}

/** Read component k of element i, broadcasting scalar columns. */
export function readComp(col: Column, i: number, k: number): number {
  return col.tupleSize === 1 ? col.data[i] : col.data[i * col.tupleSize + k];
}

/**
 * Build a points-only geometry holding the selected point indices of
 * `src`, carrying every point attribute (types, tuple sizes, defaults,
 * string tables). Topology is not carried — the result is a point cloud.
 */
export function gatherPoints(src: Geometry, indices: ArrayLike<number>): Geometry {
  const out = new Geometry();
  const srcSet = src.attrs.point;
  const dstSet = out.attrs.point;
  for (const attr of srcSet) {
    dstSet.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
  }
  const n = indices.length;
  dstSet.resize(n);
  for (const attr of srcSet) {
    const dst = dstSet.require(attr.name);
    for (let j = 0; j < n; j++) dst.copyFrom(attr, indices[j], j, 1);
  }
  return out;
}

/**
 * The arc-length table of ONE polyline primitive: the walk along its
 * vertices, per-segment geometry, and the running length. Every path node
 * measures distance through this — sampling, resampling and tangents all
 * need the same numbers, and computing them twice is how two nodes drift
 * apart.
 *
 * All arrays are SoA typed arrays holding f64 values (positions are read
 * from an f32 column, so no precision is lost or invented). A polyline of
 * `nv` vertices has `nv - 1` segments; segment `k` runs from vertex `k`
 * to vertex `k + 1`.
 */
export interface PolylineArcTable {
  /** Index of this primitive in the source geometry. */
  readonly prim: number;
  /**
   * Point index of each vertex along the path, in walk order. A closed
   * path repeats its first point as the last entry — closure is
   * structural, carried by the topology and nothing else.
   */
  readonly points: Uint32Array;
  /** Start position of each segment, 3 per segment. */
  readonly segStart: Float64Array;
  /** Segment delta (unnormalized direction), 3 per segment. */
  readonly segDir: Float64Array;
  /** Segment length, one per segment. */
  readonly segLen: Float64Array;
  /** Length before each segment; `nSeg + 1` entries, `cum[0] === 0`. */
  readonly cum: Float64Array;
  /** Total arc length of this polyline (`cum[nSeg]`). */
  readonly length: number;
  /** Whether the last vertex references the first vertex's point. */
  readonly closed: boolean;
}

/**
 * Build one {@link PolylineArcTable} per polyline primitive, in primitive
 * index order. Primitives with fewer than 2 vertices are skipped, and so
 * are primitives whose `primtype` is not `"polyline"` (a geometry with no
 * `primtype` attribute at all has every multi-vertex primitive treated as
 * a polyline). Throws — naming `nodeType` — when the input has no usable
 * polyline, because a path node with no path is always an authoring
 * mistake worth reporting loudly.
 */
export function polylineArcTables(geo: Geometry, nodeType: string): PolylineArcTable[] {
  const P = geo.attrs.point.get("P");
  if (!P || P.type !== "f32" || P.tupleSize < 3) {
    throw new Error(`${nodeType}: input needs a point attribute "P" (f32, tupleSize >= 3)`);
  }
  const pd = P.data;
  const ps = P.tupleSize;
  const v2p = geo.vertexToPoint;
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const primType = geo.attrs.primitive.get(PRIMTYPE_ATTR);
  const tables: PolylineArcTable[] = [];
  for (let p = 0; p < geo.primitiveCount; p++) {
    const nv = counts[p];
    if (nv < 2) continue;
    if (primType && primType.getString(p) !== "polyline") continue;
    const v0 = starts[p];
    const nSeg = nv - 1;
    const points = new Uint32Array(nv);
    for (let k = 0; k < nv; k++) points[k] = v2p[v0 + k];
    const segStart = new Float64Array(nSeg * 3);
    const segDir = new Float64Array(nSeg * 3);
    const segLen = new Float64Array(nSeg);
    const cum = new Float64Array(nSeg + 1);
    for (let k = 0; k < nSeg; k++) {
      const a = points[k] * ps;
      const b = points[k + 1] * ps;
      const dx = pd[b] - pd[a];
      const dy = pd[b + 1] - pd[a + 1];
      const dz = pd[b + 2] - pd[a + 2];
      segStart[k * 3] = pd[a];
      segStart[k * 3 + 1] = pd[a + 1];
      segStart[k * 3 + 2] = pd[a + 2];
      segDir[k * 3] = dx;
      segDir[k * 3 + 1] = dy;
      segDir[k * 3 + 2] = dz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      segLen[k] = len;
      cum[k + 1] = cum[k] + len;
    }
    tables.push({
      prim: p,
      points,
      segStart,
      segDir,
      segLen,
      cum,
      length: cum[nSeg],
      closed: points[0] === points[nv - 1],
    });
  }
  if (tables.length === 0) {
    throw new Error(
      `${nodeType}: input has no polyline primitives (build one in-graph with pointsToPath, or in TypeScript with createPolyline; note that every filter node and mergePoints drop topology, so a path must reach this node without passing through one)`,
    );
  }
  return tables;
}

/**
 * Locate the arc-length position `s` on a cumulative-length array
 * (`cum[0] === 0`, one entry per segment boundary), writing
 * `[segment index, t]` into `out` — a caller-owned scratch tuple, because
 * this runs once per sample and per-sample allocation is exactly what the
 * SoA hot-path rule forbids. `t` is in [0, 1] along the segment.
 * Positions past the end clamp to the last segment, and a zero-length
 * segment reports `t = 0`, so the answer is always a real segment.
 *
 * The segment length is taken as `cum[seg + 1] - cum[seg]` rather than a
 * stored per-segment length. That is deliberate: the difference and the
 * stored length are not the same f64 in general, and every sampler in the
 * library must agree on which one it means.
 */
export function locateOnArcLength(out: number[], cum: Float64Array, s: number): number[] {
  // First segment j with cum[j + 1] > s; clamp to the last segment.
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] > s) hi = mid;
    else lo = mid + 1;
  }
  const segLen = cum[lo + 1] - cum[lo];
  out[0] = lo;
  out[1] = segLen > 0 ? Math.min((s - cum[lo]) / segLen, 1) : 0;
  return out;
}

/** Quaternion product out = a ⊗ b (Hamilton, [x, y, z, w] layout). */
export function quatMul(
  out: number[],
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
): number[] {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/**
 * Quaternion for extrinsic XYZ Euler rotation in degrees: rotates about
 * the world X axis first, then world Y, then world Z (`R = Rz · Ry · Rx`).
 * This is equivalent to intrinsic ZYX; in three.js terms, Euler order
 * "ZYX".
 */
export function quatFromEulerDeg(out: number[], rx: number, ry: number, rz: number): number[] {
  const hx = (rx * Math.PI) / 360;
  const hy = (ry * Math.PI) / 360;
  const hz = (rz * Math.PI) / 360;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sz = Math.sin(hz);
  const cz = Math.cos(hz);
  // qz ⊗ qy ⊗ qx expanded.
  out[0] = sx * cy * cz - cx * sy * sz;
  out[1] = cx * sy * cz + sx * cy * sz;
  out[2] = cx * cy * sz - sx * sy * cz;
  out[3] = cx * cy * cz + sx * sy * sz;
  return out;
}

/**
 * Quaternion ([x, y, z, w]) from an orthonormal right-handed basis given
 * as the images of the local +X, +Y, +Z axes (the rotation matrix's
 * columns). Uses the trace-based branch structure of three.js
 * `Quaternion.setFromRotationMatrix`, so the result composes with
 * three.js `Matrix4.compose` exactly like quaternions built by three.
 */
export function quatFromBasis(
  out: number[],
  xx: number,
  xy: number,
  xz: number,
  yx: number,
  yy: number,
  yz: number,
  zx: number,
  zy: number,
  zz: number,
): number[] {
  // Row-major element names (m<row><col>) over columns X, Y, Z.
  const m11 = xx;
  const m12 = yx;
  const m13 = zx;
  const m21 = xy;
  const m22 = yy;
  const m23 = zy;
  const m31 = xz;
  const m32 = yz;
  const m33 = zz;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[0] = (m32 - m23) * s;
    out[1] = (m13 - m31) * s;
    out[2] = (m21 - m12) * s;
    out[3] = 0.25 / s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    out[0] = 0.25 * s;
    out[1] = (m12 + m21) / s;
    out[2] = (m13 + m31) / s;
    out[3] = (m32 - m23) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    out[0] = (m12 + m21) / s;
    out[1] = 0.25 * s;
    out[2] = (m23 + m32) / s;
    out[3] = (m13 - m31) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    out[0] = (m13 + m31) / s;
    out[1] = (m23 + m32) / s;
    out[2] = 0.25 * s;
    out[3] = (m21 - m12) / s;
  }
  return out;
}

/** Rotate vector v by unit quaternion q, writing into out (xyz). */
export function rotateVec(
  out: number[],
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  vx: number,
  vy: number,
  vz: number,
): number[] {
  // t = 2 * cross(q.xyz, v); v' = v + qw * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + qy * tz - qz * ty;
  out[1] = vy + qw * ty + qz * tx - qx * tz;
  out[2] = vz + qw * tz + qx * ty - qy * tx;
  return out;
}
