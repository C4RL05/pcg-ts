/**
 * Source nodes: create point clouds from nothing (no geometry inputs).
 * All emit standard point clouds (P, rot, scale, density, bounds, color,
 * seed) with per-point seeds derived from the node seed.
 */
import { createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";

/** Params of {@link pointGrid}. */
export interface PointGridParams {
  countX: number;
  countY: number;
  countZ: number;
  spacing: readonly number[];
  origin: readonly number[];
}

/**
 * Regular grid of points: `countX * countY * countZ` points starting at
 * `origin`, stepped by `spacing`. X varies fastest, then Y, then Z.
 */
export const pointGrid = standardNode<PointGridParams>({
  type: "pointGrid",
  category: "source",
  description:
    "Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis. Point order is X fastest, then Y, then Z. Emits a standard point cloud; per-point seed is hashed from the node seed and point index.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    countX: { type: "i32", default: 10, min: 1, description: "Number of points along X. Minimum 1." },
    countY: { type: "i32", default: 1, min: 1, description: "Number of points along Y. Minimum 1." },
    countZ: { type: "i32", default: 10, min: 1, description: "Number of points along Z. Minimum 1." },
    spacing: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Distance between neighboring points along each axis, in world units.",
    },
    origin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "World position of the first point (index 0,0,0).",
    },
  },
  execute({ params, seed }) {
    const { countX, countY, countZ } = params;
    const [sx, sy, sz] = params.spacing;
    const [ox, oy, oz] = params.origin;
    const n = countX * countY * countZ;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    let i = 0;
    for (let z = 0; z < countZ; z++) {
      for (let y = 0; y < countY; y++) {
        for (let x = 0; x < countX; x++) {
          P[i * 3] = ox + x * sx;
          P[i * 3 + 1] = oy + y * sy;
          P[i * 3 + 2] = oz + z * sz;
          seeds[i] = hashCombine(seed, i);
          i++;
        }
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pointLine}. */
export interface PointLineParams {
  count: number;
  start: readonly number[];
  end: readonly number[];
}

/** Evenly spaced points on the segment from `start` to `end`, inclusive. */
export const pointLine = standardNode<PointLineParams>({
  type: "pointLine",
  category: "source",
  description:
    "Creates `count` evenly spaced points on the straight segment from start to end, both endpoints included (count 1 places a single point at start). Emits a standard point cloud; per-point seed is hashed from the node seed and point index.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: { type: "i32", default: 10, min: 1, description: "Number of points to place. Minimum 1." },
    start: { type: "vec3", default: [0, 0, 0], description: "World position of the first point." },
    end: { type: "vec3", default: [10, 0, 0], description: "World position of the last point." },
  },
  execute({ params, seed }) {
    const n = params.count;
    const [ax, ay, az] = params.start;
    const [bx, by, bz] = params.end;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      P[i * 3] = ax + (bx - ax) * t;
      P[i * 3 + 1] = ay + (by - ay) * t;
      P[i * 3 + 2] = az + (bz - az) * t;
      seeds[i] = hashCombine(seed, i);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pointScatterInBounds}. */
export interface PointScatterInBoundsParams {
  count: number;
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  seed: number;
}

/** Uniform random points inside an axis-aligned box, hash-seeded. */
export const pointScatterInBounds = standardNode<PointScatterInBoundsParams>({
  type: "pointScatterInBounds",
  category: "source",
  description:
    "Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax]. Each coordinate is an independent deterministic hash of (seed, point index, axis) — same seed always reproduces the same points, independent of evaluation order. Emits a standard point cloud.",
  inputs: [],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: { type: "i32", default: 100, min: 0, description: "Number of points to scatter. Minimum 0." },
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "Minimum corner of the box, in world units.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner of the box, in world units. Should be >= boundsMin per component.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the scatter.",
    },
  },
  execute({ params, seed: nodeSeed }) {
    const seed = hashCombine(nodeSeed, params.seed);
    const n = params.count;
    const [ax, ay, az] = params.boundsMin;
    const [bx, by, bz] = params.boundsMax;
    const geo = createPointCloud(n);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    for (let i = 0; i < n; i++) {
      P[i * 3] = ax + (bx - ax) * hashFloat(hashCombine(seed, i, 0));
      P[i * 3 + 1] = ay + (by - ay) * hashFloat(hashCombine(seed, i, 1));
      P[i * 3 + 2] = az + (bz - az) * hashFloat(hashCombine(seed, i, 2));
      seeds[i] = hashCombine(seed, i, 3);
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
