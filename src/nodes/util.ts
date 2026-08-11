/**
 * Internal helpers shared by the standard node library: input plumbing,
 * position views, field resolution, element copying, point and primitive
 * gathering, and quaternion math. Not part of the public API.
 */
import {
  Geometry,
  PRIMTYPE_ATTR,
  type AttrData,
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
import type { PositionView } from "../spatial/index.js";

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

/**
 * The `P` attribute as a {@link PositionView}, with the three failures a
 * spatial query would otherwise hit deep inside the index reported here
 * instead, naming the node the author has to fix and the pin the geometry
 * arrived on.
 *
 * Defined once for every node that runs a distance query, because these
 * messages ARE the agent API: a second copy is a second wording to drift,
 * and an author reading two different answers to "what does P have to be"
 * has to guess which node meant which.
 */
export function positionView(geo: Geometry, nodeType: string, pin: string): PositionView {
  const P = geo.attrs.point.get("P");
  if (!P) {
    throw new Error(
      `${nodeType}: input "${pin}" has no point attribute "P"; every point cloud in this library carries one — available: ${geo.attrs.point.names().join(", ") || "(none)"}`,
    );
  }
  if (P.type === "string") {
    throw new Error(
      `${nodeType}: input "${pin}" has a string attribute "P"; positions must be numeric (f32, tupleSize 3)`,
    );
  }
  if (P.tupleSize < 3) {
    throw new Error(
      `${nodeType}: input "${pin}" has point attribute "P" with tupleSize ${P.tupleSize}, but distances need x, y and z (tupleSize 3); something upstream overwrote P with a narrower attribute`,
    );
  }
  return { data: P.data, stride: P.tupleSize, count: geo.pointCount };
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

/** The message {@link Attribute.copyFrom} raises for an index it cannot read. */
function copyRangeError(name: string): Error {
  return new Error(`attribute "${name}": copyFrom range out of bounds`);
}

/**
 * Copy `count` elements of every attribute in `from` into `to`, creating
 * the columns (types, tuple sizes, defaults and string tables) as it goes.
 * `indices` selects which source element lands at each destination slot;
 * `undefined` means the identity, which is one bulk copy per column rather
 * than one call per element.
 *
 * `from` is an `AttributeSet` at nearly every call site, and is typed as
 * an iterable only so a caller can hand over a FILTERED SUBSET of one
 * without copying any data — {@link carryPrimitiveAttributes} passes the
 * primitive columns minus `primtype`. It is iterated twice (create, then
 * fill), so a one-shot generator is not a valid argument; pass an array.
 *
 * `to` is resized only when it is not already the right size — the vertex
 * and primitive sets are sized by `setTopology`, and resizing them again
 * would be a no-op at best.
 *
 * The gather reads and writes the raw storage rather than calling
 * `Attribute.copyFrom` once per element. That call re-checks the pair's
 * shape and allocates a `subarray` VIEW for every element of every column,
 * which is precisely the per-element allocation the SoA rule exists to
 * forbid: half a million points cost half a million transient objects. The
 * shape is checked once here instead — each destination column was just
 * created from its source's own type and tuple size, so the two always
 * match — leaving only the source index, which is still checked per element
 * and raises exactly what `copyFrom` would have. String columns keep the
 * `copyFrom` path: their values are indices into a per-attribute table and
 * have to be re-interned into the destination's, which is knowledge the
 * attribute owns.
 */
export function copyElements(
  from: Iterable<Attribute>,
  to: AttributeSet,
  indices: ArrayLike<number> | undefined,
  count: number,
): void {
  for (const attr of from) to.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue);
  if (to.count !== count) to.resize(count);
  for (const attr of from) {
    const dst = to.require(attr.name);
    if (indices === undefined) {
      dst.copyFrom(attr, 0, 0, count);
      continue;
    }
    if (attr.type === "string") {
      for (let j = 0; j < count; j++) dst.copyFrom(attr, indices[j], j, 1);
      continue;
    }
    const src = attr.data;
    const out = dst.data;
    const ts = attr.tupleSize;
    const cap = attr.capacity;
    if (ts === 1) {
      for (let j = 0; j < count; j++) {
        const s = indices[j];
        if (s < 0 || s >= cap) throw copyRangeError(dst.name);
        out[j] = src[s];
      }
      continue;
    }
    for (let j = 0; j < count; j++) {
      const s = indices[j];
      if (s < 0 || s >= cap) throw copyRangeError(dst.name);
      const so = s * ts;
      const dof = j * ts;
      for (let k = 0; k < ts; k++) out[dof + k] = src[so + k];
    }
  }
}

/** A name a carried primitive column could take instead, offered as the fix. */
function carrySuggestion(name: string): string {
  return `prim${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Carry a SOURCE PRIMITIVE's attributes onto elements a sampler just
 * produced: `srcPrim[j]` names the primitive destination element `j` came
 * from, and every primitive column except `primtype` is gathered through
 * it. This is the road's `roadWidth` reaching the lamps standing on it.
 *
 * Every node that samples a primitive down onto points builds a FRESH
 * cloud and reads nothing from `attrs.primitive`, so before this helper a
 * per-edge value died at the sampler and no manual workaround existed
 * either. The carry is AUTOMATIC and has no opt-out param on purpose: the
 * author who wrote `roadWidth` must get it without knowing a knob exists,
 * and `place/along-curve` would otherwise have to re-expose one.
 *
 * Deliberately NO index column rides along with the values. Primitive
 * numbering is per-partition, so a shipped `sourcePrimitive` would differ
 * between one cell and the whole region and redden split-equals-whole,
 * which compares every point attribute float-exact. Values carry; identity
 * does not.
 *
 * `primtype` is excluded because it is a type TAG rather than a value —
 * `"polyline"` says nothing about a point, and the library already
 * special-cases the name where a node writes the primitive domain.
 *
 * COLLISIONS ARE REFUSED, never merged, renamed or silently dropped. A
 * sampler carries no input POINT attributes, so the only name a carried
 * column can hit is one the node itself just wrote (`P`, `tangent`,
 * `curveU`, `seed`, ...), and landing on it would DELETE what the node
 * wrote and still return a plausible cook — the failure
 * {@link requireReportSlot} exists to refuse. `AttributeSet.add` would
 * raise `attribute "P" already exists`, which names neither the node nor
 * the fix, so the refusal is made here instead.
 *
 * The accepted cost, recorded so nobody rediscovers it as a bug: every
 * upstream primitive attribute is now part of a sampler's output
 * contract, so an unrelated `connectPoints` `lengthAttr` widens the
 * samples too. The widening is bounded — only `connectPoints` and
 * `promoteAttribute` produce primitive columns — and losing the value
 * silently is worse.
 */
export function carryPrimitiveAttributes(
  from: AttributeSet,
  to: AttributeSet,
  srcPrim: ArrayLike<number>,
  nodeType: string,
  toDomain: "point" | "primitive",
): void {
  // The destination is sized by its own node (a fresh cloud, or
  // setTopology). A mismatch here would make copyElements RESIZE it,
  // which on the primitive domain would silently desync it from the
  // topology — exactly the plausible-looking cook this library refuses.
  if (to.count !== srcPrim.length) {
    throw new Error(
      `${nodeType}: internal — carrying primitive attributes onto ${srcPrim.length} ${toDomain} elements, but that domain holds ${to.count}`,
    );
  }
  const carried: Attribute[] = [];
  for (const attr of from) {
    if (attr.name === PRIMTYPE_ATTR) continue;
    const existing = to.get(attr.name);
    if (existing !== undefined) {
      throw new Error(
        `${nodeType}: the input's primitive attribute "${attr.name}" ` +
          `(${shapeLabel(attr.type, attr.tupleSize)}) is carried onto this node's samples, but ` +
          `"${attr.name}" is already the ${shapeLabel(existing.type, existing.tupleSize)} ` +
          `${toDomain} attribute this node writes itself — carrying it would DELETE that column ` +
          `and the cook would look fine afterwards. Primitive attributes come along ` +
          `automatically and there is no opt-out, so give this one a name of its own where it ` +
          `is written (the "name" param of the setAttribute or promoteAttribute that produced ` +
          `it, e.g. "${carrySuggestion(attr.name)}"), or drop it upstream with removeAttribute ` +
          `(domain "primitive", names ["${attr.name}"]) if it is dead. The names this node owns ` +
          `on its ${toDomain} domain are: ${to.names().join(", ")}. "${PRIMTYPE_ATTR}" is the ` +
          `one primitive attribute never carried — it is a type tag, not a value.`,
      );
    }
    carried.push(attr);
  }
  if (carried.length === 0) return;
  copyElements(carried, to, srcPrim, srcPrim.length);
}

/**
 * Build a points-only geometry holding the selected point indices of
 * `src`, carrying every point attribute (types, tuple sizes, defaults,
 * string tables). Topology is not carried — the result is a point cloud.
 */
export function gatherPoints(src: Geometry, indices: ArrayLike<number>): Geometry {
  const out = new Geometry();
  copyElements(src.attrs.point, out.attrs.point, indices, indices.length);
  return out;
}

/**
 * Build a geometry holding the selected PRIMITIVES of `src`, with their
 * topology intact: the chosen primitives in the given order, each keeping
 * its own vertices in their own order, plus every vertex, primitive and
 * detail attribute carried across.
 *
 * The counterpart of {@link gatherPoints}, and deliberately the only one of
 * the pair that preserves topology — which is the whole reason
 * `filterPrimitivesByBounds` exists.
 *
 * With `dropUnreferenced` the point domain is compacted to the points some
 * surviving primitive still references, in ascending source order (the
 * same convention {@link gatherPoints} callers produce), and the topology is
 * renumbered onto it. Otherwise the point domain is copied whole and the
 * topology keeps the indices it arrived with.
 */
export function gatherPrimitives(
  src: Geometry,
  prims: ArrayLike<number>,
  dropUnreferenced: boolean,
): Geometry {
  const starts = src.primVertexStart;
  const counts = src.primVertexCount;
  const v2p = src.vertexToPoint;
  const nPrim = prims.length;
  let nv = 0;
  for (let k = 0; k < nPrim; k++) nv += counts[prims[k]];
  // Source vertex index of each surviving vertex, so vertex attributes
  // travel with the primitive that owns them.
  const vertexSrc = new Uint32Array(nv);
  const newStart = new Uint32Array(nPrim);
  const newCount = new Uint32Array(nPrim);
  let w = 0;
  for (let k = 0; k < nPrim; k++) {
    const p = prims[k];
    const c = counts[p];
    const s = starts[p];
    newStart[k] = w;
    newCount[k] = c;
    for (let j = 0; j < c; j++) vertexSrc[w++] = s + j;
  }

  const np = src.pointCount;
  let pointSrc: Uint32Array | undefined;
  let remap: Uint32Array | undefined;
  if (dropUnreferenced) {
    const used = new Uint8Array(np);
    for (let v = 0; v < nv; v++) used[v2p[vertexSrc[v]]] = 1;
    remap = new Uint32Array(np);
    let kept = 0;
    for (let i = 0; i < np; i++) {
      if (used[i] === 1) remap[i] = kept++;
    }
    pointSrc = new Uint32Array(kept);
    let k = 0;
    for (let i = 0; i < np; i++) {
      if (used[i] === 1) pointSrc[k++] = i;
    }
  }

  const out = new Geometry();
  // Points first, so setTopology validates the new vertex references
  // against the right point count.
  copyElements(src.attrs.point, out.attrs.point, pointSrc, pointSrc?.length ?? np);
  const newV2P = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const pt = v2p[vertexSrc[v]];
    newV2P[v] = remap === undefined ? pt : remap[pt];
  }
  out.setTopology(newV2P, newStart, newCount);
  copyElements(src.attrs.vertex, out.attrs.vertex, vertexSrc, nv);
  copyElements(src.attrs.primitive, out.attrs.primitive, prims, nPrim);
  copyElements(src.attrs.detail, out.attrs.detail, undefined, src.attrs.detail.count);
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

/**
 * Write a unit central-difference tangent at every point of every
 * polyline, into a tuple-3 destination indexed by POINT.
 *
 * The rule, which both callers repeat in their own descriptions: the
 * tangent at a point is the normalized difference between its
 * neighbours along the path, which stays smooth through corners; at the
 * ends of an open path it is the adjacent segment direction, and a
 * closed path wraps. Where the two neighbours coincide — a hairpin — the
 * forward segment stands in, pointing the way the path LEAVES the point.
 * A point whose neighbours all sit on top of it is left as found (both
 * callers zero the column first), and a point visited by several
 * polylines takes the tangent of the last one in primitive order.
 *
 * Shared rather than written twice for the reason {@link PolylineArcTable}
 * gives about arc length: writeTangents and writeCurveFrame have to
 * agree to the bit, or a frame's normal ends up not quite perpendicular
 * to the tangent sitting in the column beside it, and everything placed
 * with that frame inherits the skew.
 */
export function writePolylineTangents(
  tables: readonly PolylineArcTable[],
  pd: AttrData,
  ps: number,
  out: Float32Array,
): void {
  for (const table of tables) {
    const pts = table.points;
    const nv = pts.length;
    // A closed path repeats its first point as the last vertex; that
    // repeat is the closure, not a separate point to write twice.
    const m = table.closed ? nv - 1 : nv;
    for (let k = 0; k < m; k++) {
      const cur = pts[k] * ps;
      const prev = (table.closed ? pts[(k + m - 1) % m] : pts[k > 0 ? k - 1 : 0]) * ps;
      const next = (table.closed ? pts[(k + 1) % m] : pts[k + 1 < nv ? k + 1 : nv - 1]) * ps;
      // Central difference, falling back to the forward segment when the
      // two neighbours land on top of each other (a hairpin).
      let dx = pd[next] - pd[prev];
      let dy = pd[next + 1] - pd[prev + 1];
      let dz = pd[next + 2] - pd[prev + 2];
      let sq = dx * dx + dy * dy + dz * dz;
      if (sq === 0) {
        dx = pd[next] - pd[cur];
        dy = pd[next + 1] - pd[cur + 1];
        dz = pd[next + 2] - pd[cur + 2];
        sq = dx * dx + dy * dy + dz * dz;
      }
      // There is deliberately NO backward fallback after this one, and
      // restoring it would only add dead code: reaching it needs `next`
      // to coincide with `prev` AND with `cur`, which makes `cur` and
      // `prev` coincide too, so `cur - prev` could only ever be zero.
      // P is f32 (polylineArcTables requires it), so `sq === 0` really
      // does mean the deltas are exactly 0 — the smallest nonzero gap
      // between two f32 values squares to ~2e-90, far from underflow.
      if (sq === 0) continue; // every neighbour coincides: leave as found
      const inv = 1 / Math.sqrt(sq);
      const o = pts[k] * 3;
      out[o] = dx * inv;
      out[o + 1] = dy * inv;
      out[o + 2] = dz * inv;
    }
  }
}

/** Which local axis an orientation maps onto its forward direction. */
export const ORIENT_AXES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;

/** Squared-length threshold below which up and forward count as parallel. */
export const ORIENT_PARALLEL_EPS = 1e-12;

/**
 * Quaternion ([x, y, z, w]) putting the chosen local `axis` along a UNIT
 * forward direction, with a UNIT `up` hint fixing the roll. Both inputs
 * must already be normalized — the callers normalize once, outside their
 * per-element loops, and the parallel test below is only scale-invariant
 * because of it.
 *
 * This is the one place the library builds an orientation from a
 * direction. orientAlongVector and pathSegments both go through it for
 * the reason {@link PolylineArcTable} gives about arc length: two nodes
 * computing the same quantity is how they drift apart, and here the
 * drift would be invisible — a roll that disagrees by a degree still
 * looks like a rotation. The up-hint fallbacks ([0, 0, 1], then
 * [1, 0, 0]) are part of that contract, not an implementation detail:
 * they are what makes a vertical direction's roll deterministic rather
 * than whatever the cross product degenerated to.
 */
export function orientQuat(
  out: number[],
  fx: number,
  fy: number,
  fz: number,
  upx: number,
  upy: number,
  upz: number,
  axis: string,
): number[] {
  // right = up x forward, falling back when (anti)parallel.
  let rx = upy * fz - upz * fy;
  let ry = upz * fx - upx * fz;
  let rz = upx * fy - upy * fx;
  let rl = rx * rx + ry * ry + rz * rz;
  if (rl <= ORIENT_PARALLEL_EPS) {
    // [0, 0, 1] x f
    rx = -fy;
    ry = fx;
    rz = 0;
    rl = rx * rx + ry * ry;
    if (rl <= ORIENT_PARALLEL_EPS) {
      // f is (anti)parallel to Z too; [1, 0, 0] x f always works here.
      rx = 0;
      ry = -fz;
      rz = fy;
      rl = ry * ry + rz * rz;
    }
  }
  const rInv = 1 / Math.sqrt(rl);
  rx *= rInv;
  ry *= rInv;
  rz *= rInv;
  // u = forward x right (unit: forward and right are orthonormal).
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  // Assign (right, u, forward) to basis columns so the chosen local
  // axis maps to forward and the frame stays right-handed.
  switch (axis) {
    case "+x":
      quatFromBasis(out, fx, fy, fz, ux, uy, uz, -rx, -ry, -rz);
      break;
    case "-x":
      quatFromBasis(out, -fx, -fy, -fz, ux, uy, uz, rx, ry, rz);
      break;
    case "+y":
      quatFromBasis(out, -rx, -ry, -rz, fx, fy, fz, ux, uy, uz);
      break;
    case "-y":
      quatFromBasis(out, rx, ry, rz, -fx, -fy, -fz, ux, uy, uz);
      break;
    case "+z":
      quatFromBasis(out, rx, ry, rz, ux, uy, uz, fx, fy, fz);
      break;
    default: // "-z"
      quatFromBasis(out, -rx, -ry, -rz, ux, uy, uz, -fx, -fy, -fz);
      break;
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
