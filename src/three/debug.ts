/**
 * Debug helper: visualize a pcg point cloud as THREE.Points.
 */
import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from "three";
import type { Geometry } from "../data/index.js";

/** Options for {@link toPointsObject}. */
export interface ToPointsOptions {
  /** Point size in world units (default 0.1, size-attenuated). */
  readonly size?: number;
  /**
   * Use the standard `color` point attribute (f32, tuple >= 3) as vertex
   * colors when present (default true; alpha is dropped).
   */
  readonly useColor?: boolean;
}

/**
 * Build a `THREE.Points` debug object from a geometry's point domain:
 * positions from the `P` attribute, vertex colors from the standard
 * `color` attribute when present (rgb; alpha dropped). The returned
 * object owns a freshly allocated BufferGeometry and PointsMaterial —
 * the caller is responsible for disposing both when done.
 */
export function toPointsObject(
  geo: Geometry,
  opts: ToPointsOptions = {},
): Points<BufferGeometry, PointsMaterial> {
  const points = geo.attrs.point;
  const P = points.get("P");
  if (!P || P.type !== "f32" || P.tupleSize !== 3) {
    throw new Error('toPointsObject: geometry needs a point attribute "P" (f32, tupleSize 3)');
  }
  const n = points.count;
  const bufferGeo = new BufferGeometry();
  // slice() copies, decoupling the three buffer from the (growable)
  // attribute storage and trimming unused capacity.
  bufferGeo.setAttribute(
    "position",
    new BufferAttribute((P.data as Float32Array).slice(0, n * 3), 3),
  );
  let vertexColors = false;
  const colorAttr = points.get("color");
  if (
    opts.useColor !== false &&
    colorAttr &&
    colorAttr.type === "f32" &&
    colorAttr.tupleSize >= 3
  ) {
    const ts = colorAttr.tupleSize;
    const cd = colorAttr.data;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = cd[i * ts];
      rgb[i * 3 + 1] = cd[i * ts + 1];
      rgb[i * 3 + 2] = cd[i * ts + 2];
    }
    bufferGeo.setAttribute("color", new BufferAttribute(rgb, 3));
    vertexColors = true;
  }
  const material = new PointsMaterial({
    size: opts.size ?? 0.1,
    sizeAttenuation: true,
    vertexColors,
  });
  return new Points(bufferGeo, material);
}
