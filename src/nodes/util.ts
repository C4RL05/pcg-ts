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
