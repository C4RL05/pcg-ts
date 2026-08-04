/**
 * Spawner protocol: build render-agnostic {@link InstanceBatch}es from a
 * point cloud's standard transform attributes. Core code — no renderer
 * (and no three.js) imports; the three adapter consumes the batches.
 */
import type { Geometry } from "../data/index.js";
import type { InstanceBatch } from "../graph/data.js";

/** Options for {@link buildInstanceBatches}. */
export interface BuildInstanceBatchesOptions {
  /** Asset id used for every point not overridden by `assetAttr`. */
  readonly defaultAssetId: string;
  /**
   * Name of a string point attribute holding a per-point asset id. Points
   * whose value is the empty string fall back to `defaultAssetId`. When
   * set, the attribute must exist and be a string attribute.
   */
  readonly assetAttr?: string;
}

/**
 * Write one column-major TRS matrix `T(p) * R(q) * S(s)` into `out` at
 * `offset`, in the exact `THREE.Matrix4.elements` layout (first column at
 * 0-3, translation at 12-14, 15 = 1). Mirrors `Matrix4.compose` so the
 * three adapter's matrices match bit-for-bit. Quaternion is xyzw.
 */
export function composeTRS(
  out: Float32Array,
  offset: number,
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = px;
  out[offset + 13] = py;
  out[offset + 14] = pz;
  out[offset + 15] = 1;
}

/**
 * Build instance batches from a point cloud: per point, compose a 4x4
 * world matrix `T(P) * R(rot) * S(scale)` from the standard point
 * attributes (`rot` is a quaternion, f32 tuple 4, xyzw; missing or
 * mis-shaped `rot`/`scale` fall back to identity), then group points by
 * asset id — one batch per asset, in deterministic first-occurrence
 * order, instances in point order within each batch. Pure: the geometry
 * is only read.
 */
export function buildInstanceBatches(
  geo: Geometry,
  opts: BuildInstanceBatchesOptions,
): InstanceBatch[] {
  const points = geo.attrs.point;
  const n = points.count;
  const P = points.get("P");
  if (!P || P.type !== "f32" || P.tupleSize !== 3) {
    throw new Error(
      'buildInstanceBatches: geometry needs a point attribute "P" (f32, tupleSize 3); ' +
        "create points with createPointCloud() or add the attribute explicitly",
    );
  }
  const rotAttr = points.get("rot");
  const rot =
    rotAttr && rotAttr.type === "f32" && rotAttr.tupleSize === 4 ? rotAttr.data : undefined;
  const scaleAttr = points.get("scale");
  const scale =
    scaleAttr && scaleAttr.type === "f32" && scaleAttr.tupleSize === 3
      ? scaleAttr.data
      : undefined;

  let assetOf: (i: number) => string;
  const attrName = opts.assetAttr;
  if (attrName !== undefined && attrName !== "") {
    const attr = points.get(attrName);
    if (!attr) {
      const stringAttrs = points
        .names()
        .filter((name) => points.require(name).type === "string");
      throw new Error(
        `buildInstanceBatches: assetAttr "${attrName}" not found on the point domain; ` +
          `string point attributes present: ${stringAttrs.length > 0 ? stringAttrs.join(", ") : "(none)"}`,
      );
    }
    if (attr.type !== "string") {
      throw new Error(
        `buildInstanceBatches: assetAttr "${attrName}" must be a string attribute, got ${attr.type}`,
      );
    }
    const fallback = opts.defaultAssetId;
    assetOf = (i) => {
      const id = attr.getString(i);
      return id === "" ? fallback : id;
    };
  } else {
    const fixed = opts.defaultAssetId;
    assetOf = () => fixed;
  }

  // Group point indices per asset id; Map preserves first-occurrence order.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const id = assetOf(i);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = []));
    group.push(i);
  }

  const pd = P.data;
  const batches: InstanceBatch[] = [];
  for (const [assetId, indices] of groups) {
    const count = indices.length;
    const transforms = new Float32Array(count * 16);
    for (let k = 0; k < count; k++) {
      const i = indices[k];
      composeTRS(
        transforms,
        k * 16,
        pd[i * 3],
        pd[i * 3 + 1],
        pd[i * 3 + 2],
        rot ? rot[i * 4] : 0,
        rot ? rot[i * 4 + 1] : 0,
        rot ? rot[i * 4 + 2] : 0,
        rot ? rot[i * 4 + 3] : 1,
        scale ? scale[i * 3] : 1,
        scale ? scale[i * 3 + 1] : 1,
        scale ? scale[i * 3 + 2] : 1,
      );
    }
    batches.push({ assetId, count, transforms });
  }
  return batches;
}
