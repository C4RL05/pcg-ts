import { Geometry } from "./geometry.js";
import type { AttrType } from "./types.js";

/** Descriptor of one standard point attribute. */
export interface StandardPointAttr {
  readonly name: string;
  readonly type: AttrType;
  readonly tupleSize: number;
  readonly defaultValue: number | readonly number[];
}

/**
 * The standard point attributes (the PCG "point with attributes"):
 * transform (P/rot/scale), density, bounds, color, and per-point seed.
 */
export const STANDARD_POINT_ATTRS: readonly StandardPointAttr[] = [
  { name: "P", type: "f32", tupleSize: 3, defaultValue: [0, 0, 0] },
  { name: "rot", type: "f32", tupleSize: 4, defaultValue: [0, 0, 0, 1] },
  { name: "scale", type: "f32", tupleSize: 3, defaultValue: [1, 1, 1] },
  { name: "density", type: "f32", tupleSize: 1, defaultValue: 1 },
  { name: "boundsMin", type: "f32", tupleSize: 3, defaultValue: [0, 0, 0] },
  { name: "boundsMax", type: "f32", tupleSize: 3, defaultValue: [0, 0, 0] },
  { name: "color", type: "f32", tupleSize: 4, defaultValue: [1, 1, 1, 1] },
  { name: "seed", type: "u32", tupleSize: 1, defaultValue: 0 },
];

/**
 * Create a points-only Geometry (no vertices or primitives) with the
 * standard point attributes initialized to their defaults. This is the
 * hot-path data type of the library: all storage is SoA typed arrays,
 * never per-point objects.
 */
export function createPointCloud(count = 0): Geometry {
  const geo = new Geometry();
  const points = geo.attrs.point;
  for (const spec of STANDARD_POINT_ATTRS) {
    points.add(spec.name, spec.type, spec.tupleSize, spec.defaultValue);
  }
  points.resize(count);
  return geo;
}
