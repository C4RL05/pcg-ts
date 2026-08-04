/**
 * Internal helpers shared by the standard node library: input plumbing,
 * field resolution, point gathering/compaction, and quaternion math.
 * Not part of the public API.
 */
import { Geometry, type AttrDefault } from "../data/index.js";
import {
  type Column,
  type Field,
  type FieldLike,
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
 * Quaternion for intrinsic XYZ Euler rotation in degrees: the resulting
 * rotation applies X first, then Y, then Z (`R = Rz · Ry · Rx`).
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
