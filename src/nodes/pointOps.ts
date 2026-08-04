/**
 * Point operation nodes: transform, jitter, instance-copy, merge, and
 * bounds stamping. All clone their inputs before mutating (the executor
 * caches inputs by reference).
 */
import { Geometry, type AttrDefault } from "../data/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  geometryItems,
  quatFromEulerDeg,
  quatMul,
  readComp,
  requireGeometry,
  requireTuple,
  resolveOn,
  rotateVec,
} from "./util.js";

/** Params of {@link transformPoints}. */
export interface TransformPointsParams {
  translate: FieldParam;
  rotateEuler: FieldParam;
  scale: FieldParam;
}

/** Per-point SRT transform that composes with existing rot/scale attrs. */
export const transformPoints = standardNode<TransformPointsParams>({
  type: "transformPoints",
  description:
    "Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX'). Composes with existing point transform attributes when present: rot becomes R * rot (quaternion product) and scale multiplies componentwise. All three params are field-capable and resolve per point on the input positions.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    translate: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description: "Translation added after rotation and scale, in world units. Field-capable (tuple 1 broadcasts).",
    },
    rotateEuler: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description:
        "Rotation about the world origin in degrees per axis, applied extrinsically in XYZ order: world X first, then world Y, then world Z (equivalent to intrinsic ZYX; three.js Euler order 'ZYX'). Field-capable (tuple 1 broadcasts).",
    },
    scale: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsField: true,
      description: "Componentwise scale about the world origin, applied before rotation. Field-capable (tuple 1 broadcasts).",
    },
  },
  execute({ inputs, params, seed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "transformPoints"));
    const n = geo.pointCount;
    const tCol = requireTuple(resolveOn(geo, "point", params.translate, seed), [1, 3], "transformPoints", "translate");
    const rCol = requireTuple(resolveOn(geo, "point", params.rotateEuler, seed), [1, 3], "transformPoints", "rotateEuler");
    const sCol = requireTuple(resolveOn(geo, "point", params.scale, seed), [1, 3], "transformPoints", "scale");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const rotAttr = geo.attrs.point.get("rot");
    const rot = rotAttr && rotAttr.type === "f32" && rotAttr.tupleSize === 4 ? rotAttr.data : undefined;
    const scaleAttr = geo.attrs.point.get("scale");
    const scl = scaleAttr && scaleAttr.type === "f32" && scaleAttr.tupleSize === 3 ? scaleAttr.data : undefined;
    const q: number[] = [0, 0, 0, 1];
    const v: number[] = [0, 0, 0];
    const q2: number[] = [0, 0, 0, 1];
    for (let i = 0; i < n; i++) {
      const sx = readComp(sCol, i, 0);
      const sy = readComp(sCol, i, 1);
      const sz = readComp(sCol, i, 2);
      quatFromEulerDeg(q, readComp(rCol, i, 0), readComp(rCol, i, 1), readComp(rCol, i, 2));
      rotateVec(v, q[0], q[1], q[2], q[3], pd[i * ps] * sx, pd[i * ps + 1] * sy, pd[i * ps + 2] * sz);
      pd[i * ps] = v[0] + readComp(tCol, i, 0);
      pd[i * ps + 1] = v[1] + readComp(tCol, i, 1);
      pd[i * ps + 2] = v[2] + readComp(tCol, i, 2);
      if (rot) {
        quatMul(q2, q[0], q[1], q[2], q[3], rot[i * 4], rot[i * 4 + 1], rot[i * 4 + 2], rot[i * 4 + 3]);
        rot[i * 4] = q2[0];
        rot[i * 4 + 1] = q2[1];
        rot[i * 4 + 2] = q2[2];
        rot[i * 4 + 3] = q2[3];
      }
      if (scl) {
        scl[i * 3] *= sx;
        scl[i * 3 + 1] *= sy;
        scl[i * 3 + 2] *= sz;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link jitterPoints}. */
export interface JitterPointsParams {
  amount: FieldParam;
  seed: number;
}

/** Deterministic random offset per point. */
export const jitterPoints = standardNode<JitterPointsParams>({
  type: "jitterPoints",
  description:
    "Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point index, axis) — order-independent and reproducible. amount is field-capable (evaluated on the input positions; tuple 1 broadcasts to all axes).",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    amount: {
      type: "vec3",
      default: [0.1, 0.1, 0.1],
      acceptsField: true,
      description: "Maximum offset per axis, in world units. Field-capable (tuple 1 broadcasts).",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the jitter.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "jitterPoints"));
    const seed = hashCombine(nodeSeed, params.seed);
    const amount = requireTuple(resolveOn(geo, "point", params.amount, seed), [1, 3], "jitterPoints", "amount");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        pd[i * ps + k] += (hashFloat(hashCombine(seed, i, k)) * 2 - 1) * readComp(amount, i, k);
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Standard transform attrs ensured on copyToPoints output. */
const COPY_STANDARD: ReadonlyArray<{
  name: string;
  type: "f32" | "u32";
  tupleSize: number;
  defaultValue: number | readonly number[];
}> = [
  { name: "P", type: "f32", tupleSize: 3, defaultValue: [0, 0, 0] },
  { name: "rot", type: "f32", tupleSize: 4, defaultValue: [0, 0, 0, 1] },
  { name: "scale", type: "f32", tupleSize: 3, defaultValue: [1, 1, 1] },
  { name: "seed", type: "u32", tupleSize: 1, defaultValue: 0 },
];

/** Params of {@link copyToPoints} (none). */
export type CopyToPointsParams = Record<string, never>;

/** Copy a source cloud onto every target point, composing transforms. */
export const copyToPoints = standardNode<CopyToPointsParams>({
  type: "copyToPoints",
  description:
    "Copies the source point cloud onto every target point (output count = source points * target points, grouped by target). Transforms compose per copy: P = targetP + targetRot * (targetScale * sourceP), rot = targetRot * sourceRot (quaternion product), scale = targetScale * sourceScale (componentwise), and each copied seed is hashCombine(sourceSeed, targetSeed). All other source point attributes are carried through unchanged; missing transform attributes are treated as identity.",
  inputs: [
    { name: "source", kind: "geometry" },
    { name: "target", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {},
  execute({ inputs }) {
    const src = requireGeometry(inputs, "source", "copyToPoints");
    const tgt = requireGeometry(inputs, "target", "copyToPoints");
    const srcSet = src.attrs.point;
    const tgtSet = tgt.attrs.point;
    const nS = srcSet.count;
    const nT = tgtSet.count;
    const total = nS * nT;

    const out = new Geometry();
    const outSet = out.attrs.point;
    for (const attr of srcSet) {
      outSet.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
    }
    for (const std of COPY_STANDARD) {
      if (!outSet.has(std.name)) {
        outSet.add(std.name, std.type, std.tupleSize, std.defaultValue as AttrDefault);
      }
    }
    outSet.resize(total);

    // Bulk-carry every source attribute into each target block, then
    // overwrite the composed transform attributes.
    for (const attr of srcSet) {
      const dst = outSet.require(attr.name);
      for (let t = 0; t < nT; t++) dst.copyFrom(attr, 0, t * nS, nS);
    }

    const readVec = (geoAttr: ReturnType<typeof srcSet.get>, tuple: number): Float32Array | undefined =>
      geoAttr && geoAttr.type === "f32" && geoAttr.tupleSize === tuple
        ? (geoAttr.data as Float32Array)
        : undefined;
    const sP = readVec(srcSet.get("P"), 3);
    if (!sP) throw new Error('copyToPoints: source needs a point attribute "P" (f32, tupleSize 3)');
    const tP = readVec(tgtSet.get("P"), 3);
    if (!tP) throw new Error('copyToPoints: target needs a point attribute "P" (f32, tupleSize 3)');
    const sRot = readVec(srcSet.get("rot"), 4);
    const tRot = readVec(tgtSet.get("rot"), 4);
    const sScale = readVec(srcSet.get("scale"), 3);
    const tScale = readVec(tgtSet.get("scale"), 3);
    const sSeedAttr = srcSet.get("seed");
    const sSeed = sSeedAttr && sSeedAttr.type === "u32" && sSeedAttr.tupleSize === 1 ? sSeedAttr.data : undefined;
    const tSeedAttr = tgtSet.get("seed");
    const tSeed = tSeedAttr && tSeedAttr.type === "u32" && tSeedAttr.tupleSize === 1 ? tSeedAttr.data : undefined;

    const oP = outSet.require("P").data;
    const oRot = outSet.require("rot").data;
    const oScale = outSet.require("scale").data;
    const oSeed = outSet.require("seed").data;
    const v: number[] = [0, 0, 0];
    const q: number[] = [0, 0, 0, 1];
    for (let t = 0; t < nT; t++) {
      const qx = tRot ? tRot[t * 4] : 0;
      const qy = tRot ? tRot[t * 4 + 1] : 0;
      const qz = tRot ? tRot[t * 4 + 2] : 0;
      const qw = tRot ? tRot[t * 4 + 3] : 1;
      const tsx = tScale ? tScale[t * 3] : 1;
      const tsy = tScale ? tScale[t * 3 + 1] : 1;
      const tsz = tScale ? tScale[t * 3 + 2] : 1;
      const tSeedVal = tSeed ? tSeed[t] : t;
      for (let s = 0; s < nS; s++) {
        const i = t * nS + s;
        rotateVec(v, qx, qy, qz, qw, sP[s * 3] * tsx, sP[s * 3 + 1] * tsy, sP[s * 3 + 2] * tsz);
        oP[i * 3] = tP[t * 3] + v[0];
        oP[i * 3 + 1] = tP[t * 3 + 1] + v[1];
        oP[i * 3 + 2] = tP[t * 3 + 2] + v[2];
        quatMul(
          q,
          qx,
          qy,
          qz,
          qw,
          sRot ? sRot[s * 4] : 0,
          sRot ? sRot[s * 4 + 1] : 0,
          sRot ? sRot[s * 4 + 2] : 0,
          sRot ? sRot[s * 4 + 3] : 1,
        );
        oRot[i * 4] = q[0];
        oRot[i * 4 + 1] = q[1];
        oRot[i * 4 + 2] = q[2];
        oRot[i * 4 + 3] = q[3];
        oScale[i * 3] = tsx * (sScale ? sScale[s * 3] : 1);
        oScale[i * 3 + 1] = tsy * (sScale ? sScale[s * 3 + 1] : 1);
        oScale[i * 3 + 2] = tsz * (sScale ? sScale[s * 3 + 2] : 1);
        oSeed[i] = hashCombine(sSeed ? sSeed[s] : s, tSeedVal);
      }
    }
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link mergePoints} (none). */
export type MergePointsParams = Record<string, never>;

/** Concatenate the point clouds of every connected input. */
export const mergePoints = standardNode<MergePointsParams>({
  type: "mergePoints",
  description:
    "Concatenates the points of every connected geometry, in connection order, into one point cloud. The output carries the union of all point attributes: an attribute missing on an input fills with its default over that input's range. Attributes sharing a name must agree on type and tuple size. Topology (vertices/primitives) is not carried — the result is points only. Output tags are the union of input tags.",
  inputs: [{ name: "in", kind: "geometry", multi: true }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {},
  execute({ inputs }) {
    const items = geometryItems(inputs.in);
    const out = new Geometry();
    const outSet = out.attrs.point;
    // Union of attributes, first-occurrence order and shape.
    for (const item of items) {
      for (const attr of item.geo.attrs.point) {
        const existing = outSet.get(attr.name);
        if (!existing) {
          outSet.add(attr.name, attr.type, attr.tupleSize, attr.defaultValue as AttrDefault);
        } else if (existing.type !== attr.type || existing.tupleSize !== attr.tupleSize) {
          throw new Error(
            `mergePoints: attribute "${attr.name}" has conflicting shapes across inputs (${existing.type} tuple ${existing.tupleSize} vs ${attr.type} tuple ${attr.tupleSize})`,
          );
        }
      }
    }
    let total = 0;
    for (const item of items) total += item.geo.pointCount;
    outSet.resize(total);
    let offset = 0;
    for (const item of items) {
      const n = item.geo.pointCount;
      for (const attr of item.geo.attrs.point) {
        outSet.require(attr.name).copyFrom(attr, 0, offset, n);
      }
      offset += n;
    }
    const tags = new Set<string>();
    for (const item of items) for (const tag of item.tags) tags.add(tag);
    return { out: [makeGeometryItem(out, tags)] };
  },
});

/** Params of {@link setBounds}. */
export interface SetBoundsParams {
  boundsMin: readonly number[];
  boundsMax: readonly number[];
}

/** Stamp the standard boundsMin/boundsMax point attributes. */
export const setBounds = standardNode<SetBoundsParams>({
  type: "setBounds",
  description:
    "Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing. Downstream nodes and spawners read these as each point's axis-aligned extent.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "Minimum corner written to every point's boundsMin, in world units.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner written to every point's boundsMax, in world units.",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "setBounds"));
    const set = geo.attrs.point;
    for (const [name, value] of [
      ["boundsMin", params.boundsMin],
      ["boundsMax", params.boundsMax],
    ] as const) {
      let attr = set.get(name);
      if (!attr || attr.type !== "f32" || attr.tupleSize !== 3) {
        if (attr) set.remove(name);
        attr = set.add(name, "f32", 3, [0, 0, 0]);
      }
      attr.fill(value as AttrDefault, 0, set.count);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
