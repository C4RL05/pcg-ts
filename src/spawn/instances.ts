/**
 * Spawner protocol: build render-agnostic {@link InstanceBatch}es from a
 * point cloud's standard transform attributes. Core code — no renderer
 * (and no three.js) imports; the three adapter consumes the batches.
 */
import type { Geometry } from "../data/index.js";
import type { InstanceBatch } from "../graph/data.js";
import { readRgb, requireRgbSource } from "./color.js";
import { groupPointsByAsset } from "./grouping.js";

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
  /**
   * Name of an f32 point attribute (tupleSize >= 3) whose components 0-2
   * become each instance's RGB; alpha is dropped. Undefined or empty
   * carries no colour, and the batches then allocate none. When set, the
   * attribute must exist with that shape — nothing is picked up by
   * default, because every cloud carries `color` at [1,1,1,1].
   */
  readonly colorAttr?: string;
}

/**
 * Ceiling on the instances one call may spawn — one per input point, at
 * 16 floats of transform each, so 2^20 is 64 MiB of matrices. Same value
 * and same shape as `MAX_EDGES` (`src/nodes/topology.ts`) and
 * `MAX_RESAMPLE_POINTS` (`src/nodes/paths.ts`): a density or a radius is
 * a number an author typed, but the count it implies is not, and an
 * agent-authored graph turns a typo into an allocation failure instead of
 * a diagnostic.
 *
 * It bounds ONE COOK, never a world. A ceiling on the instances alive
 * across resident cells would depend on which cells happen to be loaded
 * when a cell cooks, so the same graph would throw or not depending on
 * camera history — an order-dependent error, which is a determinism
 * violation of exactly the kind the invariant exists to prevent. A
 * streamed world may therefore hold far more than this in total.
 *
 * Exported from this module, not from the package: `spawnInstances`'
 * description quotes the live number instead of repeating a literal that
 * could drift from it, and the GPU run planner (`src/gpu/run.ts`)
 * enforces the same budget so a rejected run raises the identical
 * message. Both are internal readers. It is deliberately absent from the
 * root surface — see `src/spawn/index.ts` and publicSurface.test.ts.
 */
export const MAX_INSTANCES = 1_048_576;

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
 *
 * With `colorAttr` set, each instance also carries the RGB of its own
 * point (alpha dropped); without it the batches carry no colour and
 * allocate none. Either way the total is bounded by
 * {@link MAX_INSTANCES}, checked once before anything is allocated.
 *
 * The grouping itself lives in {@link groupPointsByAsset}, which the
 * device-resident spawner terminal consumes too, so both paths order
 * their batches identically by construction. This function only adds the
 * matrix compose on top of it.
 */
export function buildInstanceBatches(
  geo: Geometry,
  opts: BuildInstanceBatchesOptions,
): InstanceBatch[] {
  const points = geo.attrs.point;
  const P = points.get("P");
  if (!P || P.type !== "f32" || P.tupleSize !== 3) {
    throw new Error(
      'buildInstanceBatches: geometry needs a point attribute "P" (f32, tupleSize 3); ' +
        "create points with createPointCloud() or add the attribute explicitly",
    );
  }
  // Before anything is allocated — the count is known from the point
  // domain alone, and the grouping's own per-point arrays come next.
  if (points.count > MAX_INSTANCES) {
    throw new Error(
      `buildInstanceBatches: this cook would spawn ${points.count} instances (one per input ` +
        `point), over the budget of ${MAX_INSTANCES} — each instance costs 16 floats of ` +
        `transform, so the budget is 64 MiB of matrices. Thin the cloud upstream (a lower ` +
        `density or count on the scatter, filterByDensity, selfPrune), or cook the region in ` +
        `cells with a World level: the budget is per COOK, not per world, so a streamed world ` +
        `may hold many times this across its resident cells.`,
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

  // The ordering spec, shared verbatim with the device path (P is
  // validated first, so a missing P still reports before a bad
  // assetAttr — the order this function has always thrown in).
  const grouping = groupPointsByAsset(geo, opts);

  // Resolved once for the whole cook, after the grouping so that a bad
  // assetAttr — the structural param — still reports first. `undefined`
  // means no colour anywhere: no allocation, no `colors` key on the
  // batch, and the renderer's instance-colour channel left untouched.
  const color =
    opts.colorAttr !== undefined && opts.colorAttr !== ""
      ? requireRgbSource(points, opts.colorAttr, "buildInstanceBatches", "colorAttr")
      : undefined;

  const pd = P.data;
  const batches: InstanceBatch[] = [];
  for (let j = 0; j < grouping.order.length; j++) {
    const assetId = grouping.order[j];
    const count = grouping.counts[j];
    const start = grouping.offsets[j];
    const transforms = new Float32Array(count * 16);
    const colors = color ? new Float32Array(count * 3) : undefined;
    for (let k = 0; k < count; k++) {
      const i = grouping.perm[start + k];
      // Colour is read HERE, from the same `i` that places the transform
      // below, and never in a pass of its own: one loop, one index
      // expression, so an instance's colour cannot come from a different
      // point than its matrix did. There is no second traversal to fall
      // out of step, and so no ordering to test into place.
      if (color && colors) readRgb(colors, k * 3, color, i);
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
    batches.push(colors ? { assetId, count, transforms, colors } : { assetId, count, transforms });
  }
  return batches;
}
