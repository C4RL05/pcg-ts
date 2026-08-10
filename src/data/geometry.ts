import { AttributeSet } from "./attribute.js";
import type { Domain } from "./types.js";

/** Name of the primitive-type string attribute on the primitive domain. */
export const PRIMTYPE_ATTR = "primtype";

/** Values of the {@link PRIMTYPE_ATTR} attribute. */
export type PrimType = "poly" | "polyline";

/**
 * Geometry container: one {@link AttributeSet} per domain plus topology.
 * The detail domain always has exactly one element. Topology is
 * range-based: vertex `i` references point `vertexToPoint[i]`, and
 * primitive `p` spans vertices
 * `[primVertexStart[p], primVertexStart[p] + primVertexCount[p])`.
 */
export class Geometry {
  readonly attrs: Record<Domain, AttributeSet>;

  /** Vertex i references point vertexToPoint[i]; length = vertex count. */
  vertexToPoint: Uint32Array = new Uint32Array(0);
  /** First vertex of each primitive; length = primitive count. */
  primVertexStart: Uint32Array = new Uint32Array(0);
  /** Vertex count of each primitive; length = primitive count. */
  primVertexCount: Uint32Array = new Uint32Array(0);

  constructor() {
    this.attrs = {
      point: new AttributeSet(),
      vertex: new AttributeSet(),
      primitive: new AttributeSet(),
      detail: new AttributeSet(),
    };
    this.attrs.detail.resize(1);
  }

  get pointCount(): number {
    return this.attrs.point.count;
  }

  get vertexCount(): number {
    return this.attrs.vertex.count;
  }

  get primitiveCount(): number {
    return this.attrs.primitive.count;
  }

  /**
   * Replace the topology, validating references, and resize the vertex and
   * primitive attribute sets to match. The arrays are copied defensively,
   * so later caller-side mutation cannot corrupt validated topology.
   * Point attributes are untouched.
   */
  setTopology(
    vertexToPoint: Uint32Array,
    primVertexStart: Uint32Array,
    primVertexCount: Uint32Array,
  ): void {
    if (primVertexStart.length !== primVertexCount.length) {
      throw new Error("setTopology: primVertexStart and primVertexCount lengths differ");
    }
    const np = this.pointCount;
    const nv = vertexToPoint.length;
    for (let v = 0; v < nv; v++) {
      if (vertexToPoint[v] >= np) {
        throw new Error(`setTopology: vertex ${v} references point ${vertexToPoint[v]} >= ${np}`);
      }
    }
    for (let p = 0; p < primVertexStart.length; p++) {
      if (primVertexStart[p] + primVertexCount[p] > nv) {
        throw new Error(`setTopology: primitive ${p} vertex range exceeds ${nv} vertices`);
      }
    }
    this.vertexToPoint = vertexToPoint.slice();
    this.primVertexStart = primVertexStart.slice();
    this.primVertexCount = primVertexCount.slice();
    this.attrs.vertex.resize(nv);
    this.attrs.primitive.resize(primVertexStart.length);
  }
}

/**
 * How many primitives carry each {@link PRIMTYPE_ATTR} value — `{}` for a
 * geometry with no primitives, and also for one whose topology was set
 * through {@link Geometry.setTopology} directly, which stamps no tag.
 *
 * This is how a caller asks what a geometry IS before deciding what to do
 * with it: a mesh (`poly`) goes to a surface sampler or a triangle
 * renderer, a path or edge network (`polyline`) to an arc-length sampler
 * or a line renderer, and neither is inferable from point count. Reading
 * `primtype` by hand means knowing it is a string attribute on the
 * primitive domain, which is exactly the internal detail this saves.
 */
export function primitiveTypeCounts(geo: Geometry): Record<string, number> {
  const attr = geo.attrs.primitive.get(PRIMTYPE_ATTR);
  const counts: Record<string, number> = {};
  if (attr === undefined || attr.type !== "string") return counts;
  for (let p = 0; p < geo.primitiveCount; p++) {
    const value = attr.getString(p);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Build a triangle-mesh Geometry from flat xyz positions and indexed
 * triangles (three point indices per triangle). Creates the `P` point
 * attribute and one `poly` primitive per triangle.
 */
export function createTriangleMesh(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
): Geometry {
  if (positions.length % 3 !== 0) {
    throw new Error("createTriangleMesh: positions length must be a multiple of 3");
  }
  if (triangles.length % 3 !== 0) {
    throw new Error("createTriangleMesh: triangles length must be a multiple of 3");
  }
  const np = positions.length / 3;
  const geo = new Geometry();
  const P = geo.attrs.point.add("P", "f32", 3);
  geo.attrs.point.resize(np);
  P.data.set(positions);

  const nv = triangles.length;
  const vertexToPoint = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const idx = triangles[v];
    if (!Number.isInteger(idx) || idx < 0 || idx >= np) {
      throw new Error(`createTriangleMesh: index ${idx} out of range [0, ${np})`);
    }
    vertexToPoint[v] = idx;
  }
  const nTri = nv / 3;
  const primVertexStart = new Uint32Array(nTri);
  const primVertexCount = new Uint32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    primVertexStart[t] = t * 3;
    primVertexCount[t] = 3;
  }
  geo.setTopology(vertexToPoint, primVertexStart, primVertexCount);
  geo.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "poly" satisfies PrimType);
  return geo;
}

/**
 * Replace a geometry's topology with polyline primitives over its OWN
 * points, and stamp every primitive's {@link PRIMTYPE_ATTR} to
 * `"polyline"`. This is the factory nodes build paths through: they
 * assemble flat scratch arrays and hand them over, rather than calling
 * {@link Geometry.setTopology} (which knows nothing about polylines)
 * themselves.
 *
 * `pointIndices` is the concatenated vertex list; polyline `p` owns
 * `pointIndices[primVertexStart[p] .. + primVertexCount[p])`. Closure is
 * structural and has no flag: a closed polyline simply ends with a vertex
 * referencing its own first point, which is what consumers detect.
 *
 * Point attributes survive untouched, so a node can clone a point cloud
 * and give it topology without losing a column. Existing vertex and
 * primitive attributes are dropped: the topology they described is gone,
 * and keeping them would leave values belonging to elements that no
 * longer exist.
 */
export function setPolylineTopology(
  geo: Geometry,
  pointIndices: ArrayLike<number>,
  primVertexStart: ArrayLike<number>,
  primVertexCount: ArrayLike<number>,
): void {
  if (primVertexStart.length !== primVertexCount.length) {
    throw new Error(
      `setPolylineTopology: primVertexStart has ${primVertexStart.length} entries and primVertexCount has ${primVertexCount.length}; they need one entry per polyline`,
    );
  }
  const np = geo.pointCount;
  const nv = pointIndices.length;
  const vertexToPoint = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const idx = pointIndices[v];
    if (!Number.isInteger(idx) || idx < 0 || idx >= np) {
      throw new Error(
        `setPolylineTopology: vertex ${v} references point ${idx}, which is not a whole number in [0, ${np})`,
      );
    }
    vertexToPoint[v] = idx;
  }
  for (let p = 0; p < primVertexCount.length; p++) {
    const start = primVertexStart[p];
    const count = primVertexCount[p];
    if (count < 2) {
      throw new Error(
        `setPolylineTopology: polyline ${p} has ${count} vertices; a polyline needs at least 2 (drop it, or give it another point)`,
      );
    }
    if (start < 0 || start + count > nv) {
      throw new Error(
        `setPolylineTopology: polyline ${p} spans vertices [${start}, ${start + count}) but only ${nv} vertex indices were given`,
      );
    }
  }
  for (const domain of ["vertex", "primitive"] as const) {
    const set = geo.attrs[domain];
    for (const name of set.names()) set.remove(name);
  }
  geo.setTopology(
    vertexToPoint,
    Uint32Array.from(primVertexStart),
    Uint32Array.from(primVertexCount),
  );
  geo.attrs.primitive.add(PRIMTYPE_ATTR, "string", 1, "polyline" satisfies PrimType);
}

/**
 * Build a polyline Geometry from flat xyz positions: one `polyline`
 * primitive whose vertices reference the points in order. With
 * `closed: true` an extra final vertex references point 0.
 */
export function createPolyline(
  positions: ArrayLike<number>,
  options: { closed?: boolean } = {},
): Geometry {
  if (positions.length % 3 !== 0) {
    throw new Error("createPolyline: positions length must be a multiple of 3");
  }
  const np = positions.length / 3;
  if (np < 2) {
    throw new Error("createPolyline: need at least 2 points");
  }
  const geo = new Geometry();
  const P = geo.attrs.point.add("P", "f32", 3);
  geo.attrs.point.resize(np);
  P.data.set(positions);

  const closed = options.closed === true;
  const nv = np + (closed ? 1 : 0);
  const vertexToPoint = new Uint32Array(nv);
  for (let v = 0; v < np; v++) vertexToPoint[v] = v;
  // With closed, the trailing vertex is already 0.
  setPolylineTopology(geo, vertexToPoint, Uint32Array.of(0), Uint32Array.of(nv));
  return geo;
}
