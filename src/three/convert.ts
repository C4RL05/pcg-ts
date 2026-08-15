/**
 * Conversions in both directions.
 *
 * Inbound (three → pcg): BufferGeometry to a sampleable triangle mesh,
 * and Curve to spline (polyline) geometry.
 *
 * Outbound (pcg → three): {@link toBufferGeometry} for the `poly`
 * primitives a mesh carries and {@link toLineGeometry} for the
 * `polyline` primitives a path or edge network carries. Both return a
 * bare `BufferGeometry` and pick no material — {@link toPointsObject} is
 * the one helper that does, and it is named for the debugging it exists
 * for.
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { Curve, Vector3 } from "three";
import {
  Geometry,
  PRIMTYPE_ATTR,
  createPolyline,
  createTriangleMesh,
  type PrimType,
} from "../data/index.js";
import { readRgb, rgbSourceOf } from "../spawn/color.js";

/**
 * Convert a triangle `THREE.BufferGeometry` into a pcg {@link Geometry}:
 * the `position` attribute becomes the `P` point attribute and the index
 * buffer becomes one `poly` primitive per index triple (a non-indexed
 * geometry gets sequential indices — `toNonIndexed()` output works
 * directly). Positions are read via the attribute accessors, so
 * interleaved and normalized attributes are handled. Triangles only:
 * throws when the index (or non-indexed position) count is not a
 * multiple of 3. Other attributes (normal, uv, ...) are not carried.
 *
 * The full position and index buffers are converted as-is: `drawRange`,
 * material `groups`, and morph targets are ignored — a geometry relying
 * on them converts to its complete, unmorphed base mesh.
 */
export function fromBufferGeometry(bufferGeo: BufferGeometry): Geometry {
  const pos = bufferGeo.getAttribute("position");
  if (!pos) {
    throw new Error(
      'fromBufferGeometry: BufferGeometry has no "position" attribute; ' +
        "pass a geometry with vertex positions (every built-in three geometry has them)",
    );
  }
  if (pos.itemSize !== 3) {
    throw new Error(
      `fromBufferGeometry: "position" attribute has itemSize ${pos.itemSize}, expected 3`,
    );
  }
  const n = pos.count;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const index = bufferGeo.getIndex();
  let triangles: ArrayLike<number>;
  if (index) {
    if (index.count % 3 !== 0) {
      throw new Error(
        `fromBufferGeometry: index count ${index.count} is not a multiple of 3 — ` +
          "only triangle geometries are supported",
      );
    }
    triangles = index.array;
  } else {
    if (n % 3 !== 0) {
      throw new Error(
        `fromBufferGeometry: non-indexed position count ${n} is not a multiple of 3 — ` +
          "only triangle geometries are supported",
      );
    }
    const sequential = new Uint32Array(n);
    for (let i = 0; i < n; i++) sequential[i] = i;
    triangles = sequential;
  }
  return createTriangleMesh(positions, triangles);
}

/**
 * Sample a `THREE.Curve` into a pcg polyline {@link Geometry}. Uses
 * `curve.getSpacedPoints(segments)` — arc-length-parameterized, so
 * samples are evenly spaced along the curve (unlike `getPoints`, which
 * spaces them in parameter space). Open curves keep all `segments + 1`
 * samples; with `closed: true` the final sample (which duplicates the
 * first on a closed curve) is dropped and the polyline primitive closes
 * back to point 0 instead.
 */
export function fromCurve(
  curve: Curve<Vector3>,
  segments: number,
  closed = false,
): Geometry {
  const minimum = closed ? 3 : 1;
  if (!Number.isInteger(segments) || segments < minimum) {
    throw new Error(
      `fromCurve: segments must be an integer >= ${minimum} (${closed ? "closed" : "open"}), got ${segments}`,
    );
  }
  const samples = curve.getSpacedPoints(segments);
  const count = closed ? segments : segments + 1;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = samples[i];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }
  return createPolyline(positions, { closed });
}

/** Options common to {@link toBufferGeometry} and {@link toLineGeometry}. */
export interface ToThreeGeometryOptions {
  /**
   * Carry the standard `color` point attribute (f32, tuple >= 3) as a
   * three `color` attribute when present (default true; alpha dropped).
   * Set `vertexColors: true` on the material to see it.
   */
  readonly useColor?: boolean;
}

/** Options for {@link toBufferGeometry}. */
export interface ToBufferGeometryOptions extends ToThreeGeometryOptions {
  /**
   * Give the result normals (default true), because a `BufferGeometry`
   * without them renders black under every lit material — the trap this
   * default exists to close. The standard `normal` point attribute
   * (f32, tuple >= 3, what `surfaceSample` writes) is used when present;
   * otherwise `computeVertexNormals()` runs, which smooths across the
   * shared points the indexed result is built from. `false` returns a
   * geometry with no `normal` attribute, for an unlit material or for a
   * caller that will compute its own.
   */
  readonly normals?: boolean;
}

/** Reader for the `primtype` tag, or undefined when the geometry has none. */
function primTypeReader(geo: Geometry): ((prim: number) => string) | undefined {
  const attr = geo.attrs.primitive.get(PRIMTYPE_ATTR);
  if (attr === undefined || attr.type !== "string") return undefined;
  return (prim) => attr.getString(prim);
}

/**
 * What the geometry holds, for the "nothing to draw" refusal.
 *
 * Deliberately not `primitiveTypeCounts`, though it counts the same
 * thing: that function collapses "untagged" and "no primitives at all"
 * to the same empty record, and telling those two apart is the entire
 * job here — one means "use the other exporter", the other means "this
 * is a cloud".
 */
function describeContents(geo: Geometry): string {
  if (geo.primitiveCount === 0) {
    return `it has ${geo.pointCount} point(s) and no primitives at all`;
  }
  const read = primTypeReader(geo);
  if (read === undefined) return `it has ${geo.primitiveCount} untagged primitive(s)`;
  const counts = new Map<string, number>();
  for (let p = 0; p < geo.primitiveCount; p++) {
    const value = read(p);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const parts = [...counts].map(([name, n]) => `${n} "${name}"`);
  return `it has ${parts.join(", ")}`;
}

/**
 * Shared skeleton for both exporters. Walks the primitives a caller
 * wants, lets it push point-index tuples, and builds the compacted
 * buffers.
 *
 * Two properties come from compacting rather than copying `P` wholesale,
 * and both matter more than the copy costs:
 *
 * - **Unreferenced points never reach the buffer.** Either primitive
 *   filter — `filterPrimitivesByBounds`, `filterPrimitivesByAttribute` —
 *   keeps the points its dropped primitives left behind by default, and a
 *   geometry can carry a cloud alongside a mesh. Either would inflate
 *   the bounding sphere and break frustum culling for the whole object.
 * - **Non-finite positions never reach it either**, because a primitive
 *   touching one is dropped before its points are mapped. A single NaN
 *   makes `computeBoundingSphere()` produce a NaN radius, which three
 *   reports and which disables culling for that object.
 *
 * Partial drops are silent by design — there is no way to draw a NaN,
 * and this mirrors what the SVG renderer already does. What is NOT
 * silent is dropping everything: the callers throw rather than hand back
 * an empty geometry that renders as nothing.
 */
function collectIndexed(
  who: string,
  geo: Geometry,
  wanted: PrimType,
  perPrimitive: (
    start: number,
    count: number,
    emit: (a: number, b: number, c?: number) => void,
  ) => void,
  slotsPerPrimitive: (count: number) => number,
): { positions: Float32Array; indices: Uint32Array; kept: Uint32Array } {
  const P = geo.attrs.point.get("P");
  if (!P || P.type !== "f32" || P.tupleSize !== 3) {
    throw new Error(`${who}: geometry needs a point attribute "P" (f32, tupleSize 3)`);
  }
  const source = P.data as Float32Array;
  const read = primTypeReader(geo);
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const v2p = geo.vertexToPoint;

  // Without the tag the shape is inferred from vertex count, which is
  // the only information present: `Geometry.setTopology` is public and
  // stamps no `primtype`, so refusing an untagged geometry would refuse
  // a legitimate one.
  const minVertices = wanted === "poly" ? 3 : 2;
  const perTuple = wanted === "poly" ? 3 : 2;
  const selects = (prim: number): boolean =>
    read === undefined ? counts[prim] >= minVertices : read(prim) === wanted;

  // `selected` counts primitives of the wanted KIND; `slots` counts the
  // ones with enough vertices to draw. Separating them is what lets the
  // refusal below tell "you passed a path network to the mesh exporter"
  // apart from "your triangles have two vertices each" — the same count
  // for both would say there are no poly primitives and then say how
  // many poly primitives there are.
  let selected = 0;
  let slots = 0;
  for (let p = 0; p < geo.primitiveCount; p++) {
    if (!selects(p)) continue;
    selected++;
    if (counts[p] >= minVertices) slots += slotsPerPrimitive(counts[p]);
  }
  if (slots === 0) {
    const alternative =
      wanted === "poly"
        ? "Use toLineGeometry for a path or edge network (pointsToPath, pathResample, connectPoints), " +
          "or toPointsObject for a cloud with no topology."
        : "Use toBufferGeometry for a triangle mesh (meshPrimitive, createTriangleMesh), " +
          "or toPointsObject for a cloud with no topology.";
    throw new Error(
      selected > 0
        ? `${who}: all ${selected} "${wanted}" primitive(s) have fewer than ${minVertices} ` +
          `vertices, so none of them can be drawn — a "${wanted}" needs at least ${minVertices}. ` +
          "Check the topology that tagged them, or drop the degenerate primitives."
        : `${who}: no "${wanted}" primitives to export — ${describeContents(geo)}. ${alternative}`,
    );
  }

  // Emitted as ORIGINAL point indices, then remapped in place once the
  // survivors are known. Deferring the mapping is what lets the compaction
  // run in ascending point order rather than first-referenced order: a
  // geometry whose every point is referenced then compacts to the identity,
  // which is what makes `toBufferGeometry(fromBufferGeometry(x))` return
  // x's index buffer unchanged instead of a valid permutation of it.
  const raw = new Uint32Array(slots * perTuple);
  const used = new Uint8Array(geo.pointCount);
  let cursor = 0;

  const finite = (point: number): boolean => {
    const o = point * 3;
    return (
      Number.isFinite(source[o]) && Number.isFinite(source[o + 1]) && Number.isFinite(source[o + 2])
    );
  };
  const emit = (a: number, b: number, c?: number): void => {
    if (!finite(a) || !finite(b) || (c !== undefined && !finite(c))) return;
    raw[cursor++] = a;
    raw[cursor++] = b;
    used[a] = 1;
    used[b] = 1;
    if (c !== undefined) {
      raw[cursor++] = c;
      used[c] = 1;
    }
  };

  for (let p = 0; p < geo.primitiveCount; p++) {
    // The vertex-count half of this guard is load-bearing and is NOT
    // implied by `selects`: for a TAGGED geometry `selects` consults only
    // the tag, so a primitive tagged "poly" with two vertices reaches
    // here. Without the guard `slotsPerPrimitive` returns a negative,
    // `raw` is under-allocated, and the surplus writes fall off the end
    // of the typed array silently — a truncated index buffer rather than
    // an error. Pinned by the degenerate-primitive tests.
    if (!selects(p) || counts[p] < minVertices) continue;
    perPrimitive(starts[p], counts[p], emit);
  }
  if (cursor === 0) {
    throw new Error(
      `${who}: every "${wanted}" primitive touches a non-finite position, so there is nothing ` +
        "to draw — a field divided by zero or overflowed upstream",
    );
  }

  const compact = new Int32Array(geo.pointCount);
  let keptCount = 0;
  for (let p = 0; p < geo.pointCount; p++) compact[p] = used[p] === 1 ? keptCount++ : -1;

  const positions = new Float32Array(keptCount * 3);
  const kept = new Uint32Array(keptCount);
  for (let p = 0, slot = 0; p < geo.pointCount; p++) {
    if (used[p] !== 1) continue;
    kept[slot] = p;
    positions[slot * 3] = source[p * 3];
    positions[slot * 3 + 1] = source[p * 3 + 1];
    positions[slot * 3 + 2] = source[p * 3 + 2];
    slot++;
  }

  const indices = cursor === raw.length ? raw : raw.slice(0, cursor);
  for (let i = 0; i < indices.length; i++) indices[i] = compact[indices[i]];
  return { positions, indices, kept };
}

/**
 * Gather the first three components of a point-domain f32 column onto
 * the compacted points, or undefined when no column of that shape is
 * there. `rgbSourceOf`/`readRgb` are reused for the `normal` column as
 * well as `color`: both are purely structural ("f32 with at least three
 * components", "copy components 0-2"), and duplicating the tuple-stride
 * arithmetic to rename it would be the more expensive mistake.
 */
function gatherVec3(geo: Geometry, name: string, kept: Uint32Array): Float32Array | undefined {
  const source = rgbSourceOf(geo.attrs.point.get(name));
  if (source === undefined) return undefined;
  const out = new Float32Array(kept.length * 3);
  for (let i = 0; i < kept.length; i++) readRgb(out, i * 3, source, kept[i]);
  return out;
}

/**
 * Gather the first two components of a point-domain f32 column onto the
 * compacted points, or undefined when no column of that shape is there.
 *
 * Separate from {@link gatherVec3} rather than a width parameter on it:
 * that one is the colour-shaped read (`rgbSourceOf`/`readRgb`, three
 * components, alpha dropped) and widening it would put a uv through a
 * function named for colour. Two components is the whole difference.
 */
function gatherVec2(geo: Geometry, name: string, kept: Uint32Array): Float32Array | undefined {
  const attr = geo.attrs.point.get(name);
  if (attr === undefined || attr.type !== "f32" || attr.tupleSize < 2) return undefined;
  const src = attr.data;
  const ts = attr.tupleSize;
  const out = new Float32Array(kept.length * 2);
  for (let i = 0; i < kept.length; i++) {
    const o = kept[i] * ts;
    out[i * 2] = src[o];
    out[i * 2 + 1] = src[o + 1];
  }
  return out;
}

/**
 * Convert a pcg {@link Geometry}'s `poly` primitives into a triangle
 * `THREE.BufferGeometry` — the inverse of {@link fromBufferGeometry},
 * and what makes a cooked mesh (`meshPrimitive`, `createTriangleMesh`,
 * anything downstream of them) visible.
 *
 * The result is indexed and shares points exactly as the source does.
 * Primitives with more than three vertices are fan-triangulated from
 * their first vertex, which is correct for a convex face and is all the
 * topology records; primitives of any other `primtype` are ignored.
 *
 * The point domain is compacted onto the points the surviving triangles
 * actually reference, so unreferenced points and non-finite positions
 * cannot reach the buffer (either would break the bounding sphere, and
 * with it culling). Compaction preserves the original point ORDER, so a
 * mesh whose every point is referenced compacts to the identity and
 * `toBufferGeometry(fromBufferGeometry(x))` returns x's index buffer
 * unchanged rather than a valid permutation of it. A triangle touching a
 * non-finite position is dropped; if that leaves nothing, this throws
 * rather than return an empty geometry.
 *
 * Four point attributes cross the bridge: `P` as `position`, `color` and
 * `normal` under {@link ToBufferGeometryOptions}, and `uv` (f32, tuple 2
 * or wider, first two components) unconditionally — what `meshPrimitive`
 * and `sweepProfile`/`extrudePolygon` write. Nothing else does; a
 * geometry's other columns stay on the pcg side.
 *
 * The caller owns the result and should `dispose()` it.
 */
export function toBufferGeometry(
  geo: Geometry,
  opts: ToBufferGeometryOptions = {},
): BufferGeometry {
  const { positions, indices, kept } = collectIndexed(
    "toBufferGeometry",
    geo,
    "poly",
    (start, count, emit) => {
      const first = geo.vertexToPoint[start];
      for (let k = 1; k + 1 < count; k++) {
        emit(first, geo.vertexToPoint[start + k], geo.vertexToPoint[start + k + 1]);
      }
    },
    (count) => count - 2,
  );

  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(positions, 3));
  out.setIndex(new BufferAttribute(indices, 1));
  if (opts.useColor !== false) {
    const colors = gatherVec3(geo, "color", kept);
    if (colors) out.setAttribute("color", new BufferAttribute(colors, 3));
  }
  if (opts.normals !== false) {
    const normals = gatherVec3(geo, "normal", kept);
    if (normals) out.setAttribute("normal", new BufferAttribute(normals, 3));
    else out.computeVertexNormals();
  }
  // Unconditional, unlike `color` and `normal`: a `uv` attribute is inert
  // until a material samples a texture, so there is no shader variant to
  // flip and no expensive fallback to choose between. Dropping it was a
  // silent hole — meshPrimitive has written `uv` since it shipped and not
  // one of those coordinates could reach three.
  const uvs = gatherVec2(geo, "uv", kept);
  if (uvs) out.setAttribute("uv", new BufferAttribute(uvs, 2));
  return out;
}

/**
 * Convert a pcg {@link Geometry}'s `polyline` primitives into a
 * `THREE.BufferGeometry` of line segments — pair it with
 * `new THREE.LineSegments(g, new THREE.LineBasicMaterial(...))`. This is
 * what makes a path or edge network visible: `pointsToPath`,
 * `pathResample`, `connectPoints` and `createPolyline` all produce
 * polylines that nothing else in this package can draw.
 *
 * Each polyline contributes one segment per consecutive vertex pair.
 * Closure is structural in this library — a closed polyline's last
 * vertex references its own first point — so the closing segment falls
 * out of the same walk and needs no flag. Primitives of any other
 * `primtype` are ignored.
 *
 * Compaction, non-finite handling and ownership are as
 * {@link toBufferGeometry} describes; a segment touching a non-finite
 * position is dropped, and this throws rather than return an empty
 * geometry.
 */
export function toLineGeometry(geo: Geometry, opts: ToThreeGeometryOptions = {}): BufferGeometry {
  const { positions, indices, kept } = collectIndexed(
    "toLineGeometry",
    geo,
    "polyline",
    (start, count, emit) => {
      for (let k = 0; k + 1 < count; k++) {
        emit(geo.vertexToPoint[start + k], geo.vertexToPoint[start + k + 1]);
      }
    },
    (count) => count - 1,
  );

  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(positions, 3));
  out.setIndex(new BufferAttribute(indices, 1));
  if (opts.useColor !== false) {
    const colors = gatherVec3(geo, "color", kept);
    if (colors) out.setAttribute("color", new BufferAttribute(colors, 3));
  }
  return out;
}
