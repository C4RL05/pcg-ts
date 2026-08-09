/**
 * Sampler nodes: derive point clouds from other geometry — triangle mesh
 * surfaces, polyline splines, and bounded volumes.
 */
import { PRIMTYPE_ATTR, createPointCloud } from "../data/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  gatherPoints,
  locateOnArcLength,
  optionalGeometry,
  polylineArcTables,
  requireGeometry,
  requireTuple,
  resolveOnMaybeGpu,
} from "./util.js";

/** Params of {@link surfaceSample}. */
export interface SurfaceSampleParams {
  count: number;
  seed: number;
  densityField: FieldParam;
}

/**
 * Area-weighted triangle-mesh surface sampling with optional density
 * acceptance.
 */
export const surfaceSample = standardNode<SurfaceSampleParams>({
  type: "surfaceSample",
  category: "sampler",
  description:
    "Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement). densityField (0..1) is then evaluated once over the candidate cloud and each candidate is accepted when a per-candidate hashed random < density — so the output count is at most `count` and exactly `count` when density is 1. Output points carry P, a flat per-triangle `normal` (f32 tuple 3), density 1, and a hashed per-point seed.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    count: {
      type: "i32",
      default: 100,
      min: 0,
      description: "Number of candidate samples to place before density acceptance. Minimum 0.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the sampling.",
    },
    densityField: {
      type: "f32",
      default: 1,
      min: 0,
      max: 1,
      acceptsField: true,
      description:
        "Acceptance probability in [0, 1] per candidate, evaluated on the candidate points after placement (so it can read P or noise). 1 keeps every candidate; 0 keeps none.",
    },
  },
  // `densityField` may resolve on the GPU. It is evaluated over the
  // internally built candidate cloud (the standard point-cloud
  // attributes plus `normal`) with the sampling-derived seed — the
  // resolver receives exactly the EvalContext the CPU `resolveOn` call
  // would ({ geo: candidates, domain: "point", seed }), after candidate
  // placement and before any acceptance, so fallback equivalence stays
  // byte-exact.
  gpu: "fields",
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const geo = requireGeometry(inputs, "in", "surfaceSample");
    const seed = hashCombine(nodeSeed, params.seed);
    const P = geo.attrs.point.get("P");
    if (!P || P.type !== "f32" || P.tupleSize < 3) {
      throw new Error('surfaceSample: input needs a point attribute "P" (f32, tupleSize >= 3)');
    }
    const pd = P.data;
    const ps = P.tupleSize;
    const v2p = geo.vertexToPoint;
    const starts = geo.primVertexStart;
    const counts = geo.primVertexCount;
    const primType = geo.attrs.primitive.get(PRIMTYPE_ATTR);

    // Collect triangles (3-vertex "poly" primitives) and their areas.
    const tris: number[] = [];
    const cumArea: number[] = [];
    const normals: number[] = [];
    let total = 0;
    for (let p = 0; p < geo.primitiveCount; p++) {
      if (counts[p] !== 3) continue;
      if (primType && primType.getString(p) !== "poly") continue;
      const v = starts[p];
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const c = v2p[v + 2] * ps;
      const abx = pd[b] - pd[a];
      const aby = pd[b + 1] - pd[a + 1];
      const abz = pd[b + 2] - pd[a + 2];
      const acx = pd[c] - pd[a];
      const acy = pd[c + 1] - pd[a + 1];
      const acz = pd[c + 2] - pd[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (twiceArea <= 0) continue;
      tris.push(v);
      total += twiceArea / 2;
      cumArea.push(total);
      const inv = 1 / twiceArea;
      normals.push(nx * inv, ny * inv, nz * inv);
    }
    if (tris.length === 0 || total <= 0) {
      throw new Error(
        "surfaceSample: input has no triangles with non-zero area (needs 3-vertex poly primitives; build meshes with createTriangleMesh)",
      );
    }

    // Place candidates: area-weighted triangle, uniform barycentric point.
    const n = params.count;
    const candidates = createPointCloud(n);
    const cp = candidates.attrs.point.require("P").data;
    const cn = candidates.attrs.point.add("normal", "f32", 3, [0, 1, 0]).data;
    const cs = candidates.attrs.point.require("seed").data;
    for (let i = 0; i < n; i++) {
      const r = hashFloat(hashCombine(seed, i, 0)) * total;
      // First triangle whose cumulative area exceeds r.
      let lo = 0;
      let hi = cumArea.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumArea[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      const v = tris[lo];
      const a = v2p[v] * ps;
      const b = v2p[v + 1] * ps;
      const c = v2p[v + 2] * ps;
      let u = hashFloat(hashCombine(seed, i, 1));
      let w = hashFloat(hashCombine(seed, i, 2));
      if (u + w > 1) {
        u = 1 - u;
        w = 1 - w;
      }
      for (let k = 0; k < 3; k++) {
        cp[i * 3 + k] = pd[a + k] + u * (pd[b + k] - pd[a + k]) + w * (pd[c + k] - pd[a + k]);
      }
      cn[i * 3] = normals[lo * 3];
      cn[i * 3 + 1] = normals[lo * 3 + 1];
      cn[i * 3 + 2] = normals[lo * 3 + 2];
      cs[i] = hashCombine(seed, i, 3);
    }

    // Accept candidates by density (evaluated once over the candidate cloud).
    const density = requireTuple(
      await resolveOnMaybeGpu(gpu, candidates, "point", params.densityField, seed),
      [1],
      "surfaceSample",
      "densityField",
    );
    const accepted: number[] = [];
    for (let i = 0; i < n; i++) {
      if (hashFloat(hashCombine(seed, i, 4)) < density.data[i]) accepted.push(i);
    }
    return { out: [makeGeometryItem(gatherPoints(candidates, accepted))] };
  },
});

/** Params of {@link splineSample}. */
export interface SplineSampleParams {
  mode: string;
  count: number;
  spacing: number;
}

/** Arc-length spline sampling over polyline primitives. */
export const splineSample = standardNode<SplineSampleParams>({
  type: "splineSample",
  category: "sampler",
  description:
    "Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve. mode 'count' places exactly `count` samples (endpoints included on open curves; when every polyline is closed the samples divide the total length without duplicating the start). mode 'spacing' places samples every `spacing` world units from the start. Output points carry P, the unit segment `tangent` (f32 tuple 3), and `curveU` (f32) — the normalized arc-length position in [0, 1]. Input polylines come from pointsToPath, pathResample, or createPolyline in TypeScript; the output is a plain point CLOUD with no topology, so it is no longer a path. Topology is fragile upstream too: any node that can REMOVE points drops it — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path and this node will report that it found no polylines. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "count",
      enum: ["count", "spacing"],
      description:
        "How samples are placed: 'count' distributes exactly `count` samples over the total arc length; 'spacing' steps every `spacing` units.",
    },
    count: {
      type: "i32",
      default: 10,
      min: 1,
      description: "Number of samples when mode is 'count'. Minimum 1. Ignored in 'spacing' mode.",
    },
    spacing: {
      type: "f32",
      default: 1,
      min: 0,
      description:
        "Distance between samples in world units when mode is 'spacing'. Must be > 0 in that mode. Ignored in 'count' mode.",
    },
  },
  execute({ inputs, params, seed }) {
    const geo = requireGeometry(inputs, "in", "splineSample");

    // One arc-length table per polyline primitive, then concatenated into
    // a single curve — the node's documented "all polylines as one" rule.
    // Concatenating with the tables' own per-segment lengths keeps the
    // running total accumulated segment by segment in path order, which
    // is what makes this identical to the pre-extraction single pass.
    const tables = polylineArcTables(geo, "splineSample");
    let nSeg = 0;
    for (const table of tables) nSeg += table.segLen.length;
    const segAx = new Float64Array(nSeg * 3);
    const segDir = new Float64Array(nSeg * 3); // per-segment direction (unnormalized)
    const cum = new Float64Array(nSeg + 1); // cumulative length; cum[j] = length before segment j
    let closedCount = 0;
    let j = 0;
    for (const table of tables) {
      if (table.closed) closedCount++;
      for (let k = 0; k < table.segLen.length; k++) {
        for (let c = 0; c < 3; c++) {
          segAx[j * 3 + c] = table.segStart[k * 3 + c];
          segDir[j * 3 + c] = table.segDir[k * 3 + c];
        }
        cum[j + 1] = cum[j] + table.segLen[k];
        j++;
      }
    }
    const L = cum[nSeg];
    const allClosed = closedCount === tables.length;

    // Sample arc-length positions.
    const positions: number[] = [];
    if (params.mode === "count") {
      const n = params.count;
      const denom = allClosed ? n : Math.max(1, n - 1);
      for (let i = 0; i < n; i++) positions.push((i * L) / denom);
    } else {
      const sp = params.spacing;
      if (!(sp > 0)) {
        throw new Error(`splineSample: spacing must be > 0 in 'spacing' mode, got ${sp}`);
      }
      const eps = sp * 1e-6;
      for (let s = 0; s <= L + eps; s += sp) {
        if (allClosed && s >= L - eps && positions.length > 0) break;
        positions.push(Math.min(s, L));
      }
    }

    const n = positions.length;
    const out = createPointCloud(n);
    const op = out.attrs.point.require("P").data;
    const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
    const seeds = out.attrs.point.require("seed").data;
    const at = [0, 0]; // scratch [segment, t] reused by every sample
    for (let i = 0; i < n; i++) {
      const s = positions[i];
      locateOnArcLength(at, cum, s);
      const lo = at[0];
      const t = at[1];
      const dx = segDir[lo * 3];
      const dy = segDir[lo * 3 + 1];
      const dz = segDir[lo * 3 + 2];
      op[i * 3] = segAx[lo * 3] + dx * t;
      op[i * 3 + 1] = segAx[lo * 3 + 1] + dy * t;
      op[i * 3 + 2] = segAx[lo * 3 + 2] + dz * t;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0) {
        tangent[i * 3] = dx / len;
        tangent[i * 3 + 1] = dy / len;
        tangent[i * 3 + 2] = dz / len;
      }
      curveU[i] = L > 0 ? s / L : 0;
      seeds[i] = hashCombine(seed, i);
    }
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link volumeSample}. */
export interface VolumeSampleParams {
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  cellSize: number;
  jitter: FieldParam;
  seed: number;
}

const MAX_VOLUME_POINTS = 16_777_216;

/** Regular jittered grid inside an axis-aligned box. */
export const volumeSample = standardNode<VolumeSampleParams>({
  type: "volumeSample",
  category: "sampler",
  description:
    "Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell. jitter in [0, 1] scales a deterministic per-cell random offset (0 = exact centers, 1 = anywhere in the cell) and may be a field evaluated on the un-jittered centers. Bounds come from the optional input geometry's P extents when connected, else from boundsMin/boundsMax. Emits a standard point cloud.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description: "Minimum corner of the box, in world units. Ignored when a geometry is connected.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description: "Maximum corner of the box, in world units. Ignored when a geometry is connected.",
    },
    cellSize: {
      type: "f32",
      default: 1,
      description:
        "Requested grid cell edge length in world units, and a LOWER BOUND rather than " +
        "the cell you get. Each axis is divided into floor(extent / cellSize) whole cells " +
        "(at least one), so the actual cell is extent / that count and is always >= " +
        "cellSize: an extent of 20 with cellSize 12 yields ONE 20-wide cell, not a 12-wide " +
        "one. Divide evenly to get the cell you asked for. Must be > 0.",
    },
    jitter: {
      type: "f32",
      default: 0,
      min: 0,
      max: 1,
      acceptsField: true,
      description:
        "Per-cell jitter amount in [0, 1]: fraction of the cell size each point may move from its cell center, per axis. Field-capable (evaluated on the grid centers).",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed folded into the node seed; change it to re-roll the jitter.",
    },
  },
  // `jitter` may resolve on the GPU. It is evaluated over the freshly
  // built grid cloud (the standard point-cloud attributes) while P
  // still holds the un-jittered cell centers, with the jitter-derived
  // seed — the resolver receives exactly the EvalContext the CPU
  // `resolveOn` call would, before any point moves, so fallback
  // equivalence stays byte-exact.
  gpu: "fields",
  async execute({ inputs, params, seed: nodeSeed, gpu }) {
    const seed = hashCombine(nodeSeed, params.seed);
    if (!(params.cellSize > 0)) {
      throw new Error(`volumeSample: cellSize must be > 0, got ${params.cellSize}`);
    }
    let [minX, minY, minZ] = params.boundsMin;
    let [maxX, maxY, maxZ] = params.boundsMax;
    // Optional: the connected geometry supplies the bounds, and nothing
    // connected falls back to the params. Several connected is an error,
    // not a first-item pick — the bounds of ONE of four groups is a
    // silently wrong volume, and unioning them would be a different node.
    const source = optionalGeometry(inputs, "in", "volumeSample");
    if (source) {
      const P = source.attrs.point.get("P");
      if (!P || P.type !== "f32" || P.tupleSize < 3 || source.pointCount === 0) {
        throw new Error(
          'volumeSample: connected input needs points with a "P" attribute (f32, tupleSize >= 3); disconnect it to use the bounds params',
        );
      }
      minX = minY = minZ = Infinity;
      maxX = maxY = maxZ = -Infinity;
      const pd = P.data;
      const ps = P.tupleSize;
      for (let i = 0; i < source.pointCount; i++) {
        const x = pd[i * ps];
        const y = pd[i * ps + 1];
        const z = pd[i * ps + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      if (!Number.isFinite(minX)) {
        throw new Error("volumeSample: connected input has no finite point positions");
      }
    }
    const ex = Math.max(0, maxX - minX);
    const ey = Math.max(0, maxY - minY);
    const ez = Math.max(0, maxZ - minZ);
    const nx = Math.max(1, Math.floor(ex / params.cellSize + 1e-9));
    const ny = Math.max(1, Math.floor(ey / params.cellSize + 1e-9));
    const nz = Math.max(1, Math.floor(ez / params.cellSize + 1e-9));
    const total = nx * ny * nz;
    if (total > MAX_VOLUME_POINTS) {
      throw new Error(
        `volumeSample: grid would have ${total} points (max ${MAX_VOLUME_POINTS}); increase cellSize or shrink the bounds`,
      );
    }
    const cellX = nx > 0 ? ex / nx : 0;
    const cellY = ny > 0 ? ey / ny : 0;
    const cellZ = nz > 0 ? ez / nz : 0;

    const geo = createPointCloud(total);
    const P = geo.attrs.point.require("P").data;
    const seeds = geo.attrs.point.require("seed").data;
    let i = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          P[i * 3] = minX + (x + 0.5) * cellX;
          P[i * 3 + 1] = minY + (y + 0.5) * cellY;
          P[i * 3 + 2] = minZ + (z + 0.5) * cellZ;
          seeds[i] = hashCombine(seed, i);
          i++;
        }
      }
    }
    // Jitter each point inside its cell (field evaluated on the centers).
    const jitter = requireTuple(
      await resolveOnMaybeGpu(gpu, geo, "point", params.jitter, seed),
      [1],
      "volumeSample",
      "jitter",
    );
    i = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const j = Math.min(1, Math.max(0, jitter.data[i]));
          if (j > 0) {
            P[i * 3] += (hashFloat(hashCombine(seed, x, y, z, 0)) - 0.5) * j * cellX;
            P[i * 3 + 1] += (hashFloat(hashCombine(seed, x, y, z, 1)) - 0.5) * j * cellY;
            P[i * 3 + 2] += (hashFloat(hashCombine(seed, x, y, z, 2)) - 0.5) * j * cellZ;
          }
          i++;
        }
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
