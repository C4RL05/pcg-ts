/**
 * Internal helpers shared by the standard node library: input plumbing,
 * field resolution, point gathering/compaction, and quaternion math.
 * Not part of the public API.
 */
import {
  Geometry,
  PRIMTYPE_ATTR,
  type AttrDefault,
  type AttrType,
  type Attribute,
  type AttributeSet,
} from "../data/index.js";
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
 * The message for a single-geometry node handed a whole collection.
 *
 * This case used to be silent: the node took item[0] and discarded the
 * rest, so a four-group partition cooked "successfully" into one group.
 * That is the worst failure mode available — plausible output — and it
 * violates both the determinism and the introspectability pillars, so it
 * is now an error. The text has to leave an agent knowing its next move
 * without reading source, hence the named alternatives.
 */
function multiGeometryMessage(nodeType: string, pin: string, count: number): string {
  return (
    `${nodeType}: input pin "${pin}" received ${count} geometries, but ${nodeType} processes ` +
    `exactly ONE. Using the first and discarding the other ${count - 1} would look like a ` +
    "successful cook, so it is an error instead. A pin carries a COLLECTION, and a SINGLE " +
    "connection can put many geometries on it: partitionByAttribute emits one per distinct " +
    "value, and a subgraph or dataInput forwards however many it holds. Fixes: (1) insert " +
    `mergePoints between the source and ${nodeType} to concatenate the ${count} back into one ` +
    "cloud — mergePoints is points-only, so rebuild any path after it with pointsToPath; (2) " +
    `move ${nodeType} UPSTREAM of the split, so it runs once on the whole cloud before it is ` +
    "partitioned; (3) to process each geometry separately, note there is no for-each node and " +
    "no in-graph node that selects one item of a collection — drive it from TypeScript, where " +
    'collection.filter((item) => item.kind === "geometry") gives you all of them and ' +
    'filterByTag(collection, "<attr>=<value>") picks one by the tag partitionByAttribute wrote.'
  );
}

/**
 * The one geometry connected to a pin. Throws an actionable error naming
 * the node type and pin when none is connected, and refuses a collection
 * of several ({@link multiGeometryMessage}) rather than silently
 * processing the first.
 *
 * Non-geometry items sharing the pin are ignored, not counted — a value
 * item riding alongside one geometry is still one geometry.
 */
export function requireGeometry(
  inputs: Record<string, DataCollection>,
  pin: string,
  nodeType: string,
): Geometry {
  return requireGeometryItem(inputs, pin, nodeType).geo;
}

/**
 * As {@link requireGeometry}, but yields the whole item — for nodes that
 * also need its tags or pass the item through to keep its rev (and so
 * downstream caches) intact.
 */
export function requireGeometryItem(
  inputs: Record<string, DataCollection>,
  pin: string,
  nodeType: string,
): GeometryItem {
  const items = geometryItems(inputs[pin] ?? []);
  if (items.length === 0) {
    throw new Error(`${nodeType}: input pin "${pin}" has no geometry connected`);
  }
  if (items.length > 1) throw new Error(multiGeometryMessage(nodeType, pin, items.length));
  return items[0];
}

/**
 * The geometry connected to an OPTIONAL pin: `undefined` when nothing is
 * connected (the caller falls back to params), the geometry when exactly
 * one is, and the same loud error as {@link requireGeometry} when several
 * are. Optional does not mean lenient — a node that cannot say what four
 * inputs mean must not pick one.
 */
export function optionalGeometry(
  inputs: Record<string, DataCollection>,
  pin: string,
  nodeType: string,
): Geometry | undefined {
  const items = geometryItems(inputs[pin] ?? []);
  if (items.length === 0) return undefined;
  if (items.length > 1) throw new Error(multiGeometryMessage(nodeType, pin, items.length));
  return items[0].geo;
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

/** `f32x3`, or just `bool` when the tuple is 1 — the golden's spelling. */
function shapeLabel(type: AttrType, tupleSize: number): string {
  return tupleSize === 1 ? type : `${type}x${tupleSize}`;
}

/** One reporting slot to check — see {@link requireReportSlot}. */
export interface ReportSlot {
  /** Attribute set the slot is written to (NOT always the one it reads). */
  readonly attrs: AttributeSet;
  /** Node type, for the message. */
  readonly nodeType: string;
  /** Param that named the slot, for the message (e.g. "hitAttr"). */
  readonly param: string;
  /** Attribute name the param resolved to. */
  readonly name: string;
  /** Type the node writes there. */
  readonly type: AttrType;
  /** Tuple size the node writes there. */
  readonly tupleSize: number;
  /** Domain of {@link attrs}, for the message (e.g. "point"). */
  readonly domain: string;
  /** A name that would not collide, offered as the fix. */
  readonly suggestion: string;
  /**
   * The column this node just READ and is rewriting from its own
   * contents, when the slot can legitimately land on it — an in-place
   * conversion, not a clobber. Omit for a pure report.
   */
  readonly source?: Attribute | undefined;
}

/**
 * The library's rule for REPORTING SLOTS: a param that names an attribute
 * whose SHAPE the node picks, not the data (a bool hit flag, a u32 count,
 * an f32 distance, an i32 index, a reduction, a remap result).
 * `AttributeSet.replace` resets a column of the same shape but DELETES and
 * re-adds one of any other shape, so a slot pointed at an existing column
 * of a different shape quietly destroyed it: `hitAttr: "P"` turned every
 * position into a bool flag and returned a geometry that still cooked and
 * still had the right point count, minus its positions. A
 * plausible-looking cook is the worst failure this library can produce, so
 * the destructive case is refused here instead.
 *
 * Only that case. An existing column of the SAME shape is still reused and
 * reset in place — that is what makes re-running a node over its own
 * output ordinary, and what lets `averageOutAttr` name `averageAttr` and
 * average in place.
 *
 * Two kinds of slot are deliberately NOT covered. A COPY TARGET
 * (`transferAttribute.name`, `sampleNearestPoint.outAttribute`) takes its
 * shape from the source attribute, and overwriting is what a copy IS. And
 * an IN-PLACE rewrite passes `source`: when the existing column is the very
 * column the node read, replacing it destroys nothing that was not about
 * to be rewritten from its own values — `attributeRemap` with an empty
 * `outName` converting an i32 attribute to f32 is the documented case.
 * Identity, not name equality, is the test: an attribute of the same name
 * on another domain is a different column and stays refused.
 */
export function requireReportSlot(slot: ReportSlot): void {
  const existing = slot.attrs.get(slot.name);
  if (existing === undefined) return;
  if (existing.type === slot.type && existing.tupleSize === slot.tupleSize) return;
  if (slot.source !== undefined && existing === slot.source) return;
  const want = shapeLabel(slot.type, slot.tupleSize);
  throw new Error(
    `${slot.nodeType}: ${slot.param} "${slot.name}" already exists on the input's ` +
      `${slot.domain} domain as ${shapeLabel(existing.type, existing.tupleSize)}, but ` +
      `${slot.param} is written as ${want} — writing it would DELETE the "${slot.name}" column ` +
      `and everything in it, and the cook would look fine afterwards. Give ${slot.param} a name ` +
      `of its own (e.g. "${slot.suggestion}" — a "__" prefix marks a name internal), or remove ` +
      `"${slot.name}" from the input first with removeAttribute if it is genuinely dead. A name ` +
      `that already holds ${want} is fine: that column is reset, not deleted.`,
  );
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
    const what =
      geo.primitiveCount === 0
        ? `the input is a plain point cloud (${geo.pointCount} points, 0 primitives)`
        : `the input has ${geo.primitiveCount} primitives but no usable polyline among them (a polyline needs primtype "polyline" and at least 2 vertices)`;
    throw new Error(
      `${nodeType}: input has no polyline primitives — ${what}. Build a path in-graph with pointsToPath (or createPolyline in TypeScript). If one WAS built upstream, a node between it and ${nodeType} dropped the topology: any node that can REMOVE points rebuilds the point domain from the survivors and the primitives go with it — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and mergePoints does the same when it concatenates clouds. Category is not the rule: projectToPlane is categorised "filter" but preserves topology, and filterByAttribute drops it even when its predicate keeps every point. filterPrimitivesByBounds is never the culprit for a DROPPED topology — it filters the PRIMITIVE domain and preserves the topology of everything it keeps — but it can empty that domain by rejecting every primitive, so if one is upstream, check its boundsMin/boundsMax, vertex and mode before you move anything. Fix by moving pointsToPath after those nodes, so the path is built over the points that survive.`,
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
