/**
 * three.js → pcg conversions: BufferGeometry to a sampleable triangle
 * mesh, and Curve to spline (polyline) geometry.
 */
import type { BufferGeometry, Curve, Vector3 } from "three";
import { Geometry, createPolyline, createTriangleMesh } from "../data/index.js";

/**
 * Convert a triangle `THREE.BufferGeometry` into a pcg {@link Geometry}:
 * the `position` attribute becomes the `P` point attribute and the index
 * buffer becomes one `poly` primitive per index triple (a non-indexed
 * geometry gets sequential indices — `toNonIndexed()` output works
 * directly). Positions are read via the attribute accessors, so
 * interleaved and normalized attributes are handled. Triangles only:
 * throws when the index (or non-indexed position) count is not a
 * multiple of 3. Other attributes (normal, uv, ...) are not carried.
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
