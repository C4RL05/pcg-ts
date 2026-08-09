/**
 * Path authoring nodes: build polyline topology over a point cloud,
 * resample a path by arc length, and write per-point tangents at a path's
 * own points.
 *
 * These are the in-graph door to polyline geometry. Before them the
 * library had a polyline consumer (splineSample), a polyline type
 * (`primtype`), and CLI branches that render and inspect polylines — but
 * no producer, so a serialized graph could not contain a path at all;
 * every existing polyline was built by TypeScript calling createPolyline,
 * which a JSON author cannot do.
 *
 * A path here is exactly what createPolyline emits, with no new
 * representation: `polyline` primitives whose vertices walk the points in
 * order, and closure carried STRUCTURALLY by a trailing vertex that
 * references the path's first point. There is deliberately no `closed`
 * attribute; it would be a second, weaker copy of a fact the topology
 * already states, free to disagree with it.
 *
 * Topology is fragile in this library and these nodes say so in their own
 * descriptions: every filter node and mergePoints rebuild the point
 * domain and drop topology, so a path routed through one arrives as a
 * plain cloud. Only cloneGeometry preserves it, which is what each of
 * these nodes uses.
 */
import {
  createPointCloud,
  setPolylineTopology,
  type Attribute,
  type Geometry,
} from "../data/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { standardNode } from "./registry.js";
import { locateOnArcLength, polylineArcTables, requireGeometry } from "./util.js";

/**
 * Resolve a param that names a scalar numeric point attribute, with an
 * error that names the node, the param, and what is actually available.
 */
function requireScalarPointAttr(
  geo: Geometry,
  name: string,
  nodeType: string,
  param: string,
): Attribute {
  const set = geo.attrs.point;
  const attr = set.get(name);
  if (!attr) {
    throw new Error(
      `${nodeType}: param "${param}" names point attribute "${name}", which does not exist; available point attributes: ${set.names().join(", ") || "(none)"} (leave "${param}" empty to skip it)`,
    );
  }
  if (attr.type === "string") {
    throw new Error(
      `${nodeType}: param "${param}" names string attribute "${name}"; it must name a numeric attribute — write one with setAttribute (type 'i32')`,
    );
  }
  if (attr.tupleSize !== 1) {
    throw new Error(
      `${nodeType}: param "${param}" names attribute "${name}" with tupleSize ${attr.tupleSize}; it must be scalar (tupleSize 1)`,
    );
  }
  return attr;
}

/** Params of {@link pointsToPath}. */
export interface PointsToPathParams {
  closed: boolean;
  groupAttr: string;
  orderAttr: string;
}

/** Build polyline primitives over an existing point cloud. */
export const pointsToPath = standardNode<PointsToPathParams>({
  type: "pointsToPath",
  category: "point op",
  description:
    "Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph. Ordering is fixed and deterministic: within a path the points are visited in ascending point index (the order they arrive on this node's input) unless orderAttr names a sort key, and ties in that key always break to the lower point index. With groupAttr set, the cloud splits into one path per distinct group id, emitted in ascending group id. `closed` appends a trailing vertex referencing the path's first point — closure is structural, exactly what createPolyline produces and what splineSample detects; no `closed` attribute is written. Any existing topology on the input is replaced, and its vertex and primitive attributes are dropped with it. Downstream: every filter node and mergePoints drop topology, so a path that passes through one stops being a path — put this node after the filtering, not before.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    closed: {
      type: "bool",
      default: false,
      description:
        "Close each path by appending a trailing vertex back to its first point (structural closure — no attribute is written). A closed path needs at least 3 points; 2 would fold the path back onto itself and is an error.",
    },
    groupAttr: {
      type: "string",
      default: "",
      description:
        "Name of a scalar numeric point attribute holding a group id, splitting the cloud into one path per distinct id (paths are emitted in ascending id). Ids must be whole numbers — write them with setAttribute (type 'i32'). Leave empty to build a single path over every point.",
    },
    orderAttr: {
      type: "string",
      default: "",
      description:
        "Name of a scalar numeric point attribute to order each path by, ascending; ties break to the lower point index, so the result never depends on sort implementation. Values must be finite. Leave empty to use point index order.",
    },
  },
  execute({ inputs, params }) {
    // cloneGeometry is the only helper that preserves topology, and it is
    // also what keeps this node honest about purity: the input geometry
    // is a cached upstream object and must never be mutated.
    const geo = cloneGeometry(requireGeometry(inputs, "in", "pointsToPath"));
    const np = geo.pointCount;
    if (np < 2) {
      throw new Error(
        `pointsToPath: input has ${np} point${np === 1 ? "" : "s"}; a path needs at least 2 (scatter more points, or loosen the filter feeding this node)`,
      );
    }

    // Group ids, then the paths in ascending id order. Sorting the ids
    // rather than taking them in first-seen order keeps the output
    // independent of point order.
    const groupName = params.groupAttr;
    const grouped = new Map<number, number[]>();
    if (groupName === "") {
      const all = new Array<number>(np);
      for (let i = 0; i < np; i++) all[i] = i;
      grouped.set(0, all);
    } else {
      const attr = requireScalarPointAttr(geo, groupName, "pointsToPath", "groupAttr");
      for (let i = 0; i < np; i++) {
        const value = attr.data[i];
        if (!Number.isInteger(value)) {
          throw new Error(
            `pointsToPath: point ${i} has ${groupName} = ${value}, which is not a whole number; group ids must be whole numbers — write them with setAttribute (type 'i32', which truncates)`,
          );
        }
        let bucket = grouped.get(value);
        if (!bucket) grouped.set(value, (bucket = []));
        bucket.push(i);
      }
    }
    const ids = [...grouped.keys()].sort((a, b) => a - b);

    // Optional sort key. The comparator falls back to the point index, so
    // the order is fully determined here rather than by sort stability.
    if (params.orderAttr !== "") {
      const attr = requireScalarPointAttr(geo, params.orderAttr, "pointsToPath", "orderAttr");
      for (let i = 0; i < np; i++) {
        if (!Number.isFinite(attr.data[i])) {
          throw new Error(
            `pointsToPath: point ${i} has ${params.orderAttr} = ${attr.data[i]}, which is not finite; order keys must be finite numbers`,
          );
        }
      }
      const key = attr.data;
      for (const id of ids) {
        (grouped.get(id) as number[]).sort((a, b) =>
          key[a] < key[b] ? -1 : key[a] > key[b] ? 1 : a - b,
        );
      }
    }

    const closed = params.closed;
    const pointIndices: number[] = [];
    const primVertexStart: number[] = [];
    const primVertexCount: number[] = [];
    for (const id of ids) {
      const indices = grouped.get(id) as number[];
      if (indices.length < 2) {
        // Only a group can be this short: with no groupAttr the single
        // bucket holds every point, and `np < 2` above already rejected
        // that case — so there is no "the input" wording to reach here.
        throw new Error(
          `pointsToPath: group ${id} (attribute "${groupName}") has ${indices.length} point; every path needs at least 2 — drop that group upstream or give it another point`,
        );
      }
      const where = groupName === "" ? "the input" : `group ${id} (attribute "${groupName}")`;
      if (closed && indices.length < 3) {
        throw new Error(
          `pointsToPath: ${where} has 2 points and closed is true, which would fold the path back over itself; set closed false, or give the path at least 3 points`,
        );
      }
      primVertexStart.push(pointIndices.length);
      for (const index of indices) pointIndices.push(index);
      if (closed) pointIndices.push(indices[0]);
      primVertexCount.push(indices.length + (closed ? 1 : 0));
    }
    setPolylineTopology(geo, pointIndices, primVertexStart, primVertexCount);
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pathResample}. */
export interface PathResampleParams {
  mode: string;
  count: number;
  spacing: number;
}

/**
 * Ceiling on the points one `pathResample` may emit in 'spacing' mode.
 * 'count' mode is bounded by a number the author typed; a spacing is not,
 * so a small one on a long path runs away silently — the same hazard
 * volumeSample bounds with MAX_VOLUME_POINTS, and bounded the same way.
 */
const MAX_RESAMPLE_POINTS = 1_048_576;

/** Even arc-length resampling of each polyline primitive. */
export const pathResample = standardNode<PathResampleParams>({
  type: "pathResample",
  category: "sampler",
  description:
    "Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed. Unlike splineSample, each polyline is resampled on its own arc length rather than as one concatenated curve, so a graph with several paths keeps them separate. mode 'count' places exactly `count` samples per path (endpoints included on an open path; a closed path divides its length without duplicating the start). mode 'spacing' steps every `spacing` world units and an open path always ends on its true endpoint, so it never comes back shorter than it went in. Output points are new: they carry the standard point-cloud attributes plus the unit segment `tangent` (f32 tuple 3) and `curveU` (f32, normalized position within that path), and the input's point attributes are NOT carried across. Downstream, every filter node and mergePoints drop topology, so a resampled path that passes through one stops being a path.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "count",
      enum: ["count", "spacing"],
      description:
        "How samples are placed: 'count' puts exactly `count` samples on each path; 'spacing' steps every `spacing` units along each path.",
    },
    count: {
      type: "i32",
      default: 10,
      min: 2,
      description:
        "Samples per path when mode is 'count'. Minimum 2 for an open path and 3 for a closed one — below that the result would not be a path. Ignored in 'spacing' mode.",
    },
    spacing: {
      type: "f32",
      default: 1,
      min: 0,
      description:
        `Distance between samples in world units when mode is 'spacing'. Must be > 0, small enough to leave at least 2 samples on each open path (3 on a closed one), and large enough that the whole input stays under ${MAX_RESAMPLE_POINTS} samples. Ignored in 'count' mode.`,
    },
  },
  execute({ inputs, params, seed, checkCancelled }) {
    // Params before geometry: a bad param reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    if (params.mode !== "count" && params.mode !== "spacing") {
      throw new Error(
        `pathResample: unknown mode "${params.mode}"; valid modes: count, spacing`,
      );
    }
    if (params.mode === "spacing" && !(params.spacing > 0)) {
      throw new Error(`pathResample: spacing must be > 0 in 'spacing' mode, got ${params.spacing}`);
    }
    const geo = requireGeometry(inputs, "in", "pathResample");
    const tables = polylineArcTables(geo, "pathResample");
    // Only needed to name a spacing that would fit the budget below.
    const totalLength = tables.reduce((sum, table) => sum + table.length, 0);

    // Arc-length positions per path, validated before anything is built.
    const perPath: number[][] = [];
    let total = 0;
    for (const table of tables) {
      const L = table.length;
      const kind = table.closed ? "closed" : "open";
      const least = table.closed ? 3 : 2;
      if (!(L > 0)) {
        throw new Error(
          `pathResample: polyline primitive ${table.prim} has zero length (all of its points sit at the same position), so there is nothing to resample; move its points apart or drop it upstream`,
        );
      }
      const positions: number[] = [];
      if (params.mode === "count") {
        const n = params.count;
        if (!Number.isInteger(n) || n < least) {
          throw new Error(
            `pathResample: count is ${n}, but the ${kind} path at primitive ${table.prim} needs at least ${least} samples to still be a path; raise count`,
          );
        }
        // Closed paths divide the loop; open paths land on both ends.
        const denom = table.closed ? n : n - 1;
        for (let i = 0; i < n; i++) positions.push((i * L) / denom);
      } else {
        const sp = params.spacing;
        // The epsilon is load-bearing on a closed path: without it a step
        // that lands a float-hair short of the total length slips in as an
        // extra sample on the seam, duplicating the start point and
        // closing the path with a zero-length segment.
        const eps = sp * 1e-6;
        // Index * spacing rather than a running sum: no accumulated drift,
        // and the same positions on every platform.
        for (let i = 0; ; i++) {
          if ((i & 1023) === 0) checkCancelled();
          const s = i * sp;
          if (s >= L - eps) break;
          if (total + positions.length >= MAX_RESAMPLE_POINTS) {
            const fit = totalLength / Math.max(1, MAX_RESAMPLE_POINTS - tables.length);
            throw new Error(
              `pathResample: spacing ${sp} would place more than ${MAX_RESAMPLE_POINTS} samples over the input's ${tables.length} path(s), whose total length is ${totalLength}; use spacing >= ${fit}, or switch mode to 'count'`,
            );
          }
          positions.push(s);
        }
        if (!table.closed) positions.push(L);
        if (positions.length < least) {
          throw new Error(
            `pathResample: spacing ${sp} leaves ${positions.length} sample(s) on the ${kind} path at primitive ${table.prim} (length ${L}), fewer than the ${least} a path needs; use spacing <= ${L / least} or switch mode to 'count'`,
          );
        }
      }
      perPath.push(positions);
      total += positions.length;
    }

    const out = createPointCloud(total);
    const op = out.attrs.point.require("P").data;
    const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
    const seeds = out.attrs.point.require("seed").data;
    const at = [0, 0]; // scratch [segment, t] reused by every sample
    let w = 0;
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      const positions = perPath[ti];
      const L = table.length;
      for (let i = 0; i < positions.length; i++) {
        if ((w & 1023) === 0) checkCancelled();
        const s = positions[i];
        locateOnArcLength(at, table.cum, s);
        const lo = at[0];
        const t = at[1];
        const dx = table.segDir[lo * 3];
        const dy = table.segDir[lo * 3 + 1];
        const dz = table.segDir[lo * 3 + 2];
        op[w * 3] = table.segStart[lo * 3] + dx * t;
        op[w * 3 + 1] = table.segStart[lo * 3 + 1] + dy * t;
        op[w * 3 + 2] = table.segStart[lo * 3 + 2] + dz * t;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
          tangent[w * 3] = dx / len;
          tangent[w * 3 + 1] = dy / len;
          tangent[w * 3 + 2] = dz / len;
        }
        curveU[w] = s / L;
        seeds[w] = hashCombine(seed, w);
        w++;
      }
    }

    // Rebuild the topology the samples came from: one polyline per input
    // polyline, closed when the input was.
    const pointIndices: number[] = [];
    const primVertexStart: number[] = [];
    const primVertexCount: number[] = [];
    let base = 0;
    for (let ti = 0; ti < tables.length; ti++) {
      const n = perPath[ti].length;
      primVertexStart.push(pointIndices.length);
      for (let i = 0; i < n; i++) pointIndices.push(base + i);
      if (tables[ti].closed) pointIndices.push(base);
      primVertexCount.push(n + (tables[ti].closed ? 1 : 0));
      base += n;
    }
    setPolylineTopology(out, pointIndices, primVertexStart, primVertexCount);
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link writeTangents}. */
export interface WriteTangentsParams {
  name: string;
}

/** Per-point tangents at a path's own points, keeping the path intact. */
export const writeTangents = standardNode<WriteTangentsParams>({
  type: "writeTangents",
  category: "attribute",
  description:
    "Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path. This is the tangent source for paths that were never spline-sampled: splineSample emits `tangent` only for the new points it creates, so a path built with pointsToPath has none, and orientAlongVector (which reads a direction field, typically the tangent attribute) has nothing to consume. The tangent at a point is the normalized central difference between its neighbours along the path, which stays smooth through corners; at the ends of an open path it is the adjacent segment direction, and a closed path wraps around. When the two neighbours coincide — a hairpin, where the path doubles back on itself — the forward segment direction stands in, pointing the way the path LEAVES the point. A point whose neighbours all sit on top of it, and any point not referenced by any polyline, gets [0, 0, 0] — orientAlongVector deliberately leaves a zero direction's rot untouched. A point visited by more than one polyline takes the tangent of the last one in primitive order. Every filter node and mergePoints drop topology, so run this before any filtering, not after.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "tangent",
      description:
        "Attribute to write (created, or replaced when it exists with another shape). The default 'tangent' is the name splineSample emits and the one an orientAlongVector direction field usually reads. Cannot be 'P'.",
    },
  },
  execute({ inputs, params }) {
    // Params before geometry: a bad name reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    const name = params.name;
    if (name === "") {
      throw new Error(
        'writeTangents: param "name" must be a non-empty attribute name; the default is "tangent"',
      );
    }
    if (name === "P") {
      throw new Error(
        'writeTangents: param "name" cannot be "P" — that would overwrite the positions the tangents are computed from; use "tangent" or another name',
      );
    }
    // cloneGeometry preserves topology; gatherPoints and mergePoints do not.
    // It is also what keeps this node pure: the input is a cached upstream
    // object, and this is the one path node that writes into its geometry.
    const geo = cloneGeometry(requireGeometry(inputs, "in", "writeTangents"));
    const tables = polylineArcTables(geo, "writeTangents");
    const dst = geo.attrs.point.replace(name, "f32", 3, [0, 0, 0]);
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const td = dst.data;

    for (const table of tables) {
      const pts = table.points;
      const nv = pts.length;
      // A closed path repeats its first point as the last vertex; that
      // repeat is the closure, not a separate point to write twice.
      const m = table.closed ? nv - 1 : nv;
      for (let k = 0; k < m; k++) {
        const cur = pts[k] * ps;
        const prev = (table.closed ? pts[(k + m - 1) % m] : pts[k > 0 ? k - 1 : 0]) * ps;
        const next = (table.closed ? pts[(k + 1) % m] : pts[k + 1 < nv ? k + 1 : nv - 1]) * ps;
        // Central difference, falling back to the forward segment when the
        // two neighbours land on top of each other (a hairpin).
        let dx = pd[next] - pd[prev];
        let dy = pd[next + 1] - pd[prev + 1];
        let dz = pd[next + 2] - pd[prev + 2];
        let sq = dx * dx + dy * dy + dz * dz;
        if (sq === 0) {
          dx = pd[next] - pd[cur];
          dy = pd[next + 1] - pd[cur + 1];
          dz = pd[next + 2] - pd[cur + 2];
          sq = dx * dx + dy * dy + dz * dz;
        }
        // There is deliberately NO backward fallback after this one, and
        // restoring it would only add dead code: reaching it needs `next`
        // to coincide with `prev` AND with `cur`, which makes `cur` and
        // `prev` coincide too, so `cur - prev` could only ever be zero.
        // P is f32 (polylineArcTables requires it), so `sq === 0` really
        // does mean the deltas are exactly 0 — the smallest nonzero gap
        // between two f32 values squares to ~2e-90, far from underflow.
        if (sq === 0) continue; // every neighbour coincides: leave [0, 0, 0]
        const inv = 1 / Math.sqrt(sq);
        const o = pts[k] * 3;
        td[o] = dx * inv;
        td[o + 1] = dy * inv;
        td[o + 2] = dz * inv;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
