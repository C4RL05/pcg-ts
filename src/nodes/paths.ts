/**
 * Path authoring nodes: build polyline topology over a point cloud,
 * resample a path by arc length, write per-point tangents at a path's own
 * points, and turn a path's segments into oriented instance points.
 *
 * That last one, pathSegments, was for a long time the only way a curve
 * in this library became solid: the polyline converter emits line
 * segments a pixel wide, and meshPrimitive builds planes and boxes, so a
 * tube was not a surface here — it was a run of instanced assets, one
 * per segment, which is also why it costs one draw call for a whole
 * tangle of cable. sweepProfile (src/nodes/surfaces.ts) now emits the
 * real thing, and pathSegments keeps the job it was always right for:
 * ONE ORIENTED ASSET PER SEGMENT, which is how a chain of separate links
 * is spelled and which no swept surface can express.
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
 * descriptions. The predicate is REMOVING POINTS, not the node's
 * category: a node that can drop a point rebuilds the point domain from
 * the survivors (gatherPoints) and the primitives go with it —
 * filterByDensity, filterByBounds, filterByAttribute, filterByExpression,
 * selfPrune and partitionByAttribute — and mergePoints does the same when
 * it concatenates clouds. So a path routed through one arrives as a plain
 * cloud. Neither direction of that rule follows the category: projectToPlane
 * is categorised `filter` and PRESERVES topology (it clones), while
 * partitionByAttribute is categorised `attribute` and drops it. Nor is it
 * "did remove" — filterByAttribute drops topology even when its predicate
 * keeps every point. Only cloneGeometry preserves it, which is what each of
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
import {
  ORIENT_AXES,
  type FieldParam,
  carryPrimitiveAttributes,
  locateOnArcLength,
  orientQuat,
  polylineArcTables,
  readComp,
  requireGeometry,
  requireReportSlot,
  requireTuple,
  resolveOnMaybeGpu,
  writePolylineTangents,
} from "./util.js";

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

/**
 * Resolve a param naming a GROUP KEY: the same scalar rule, plus strings,
 * because a group is usually a NAME. `partitionByAttribute` already splits
 * on a string and this is the same question asked of one geometry, so the
 * two must not disagree about what a key is.
 */
function requireGroupPointAttr(
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
    "Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph. Ordering is fixed and deterministic: within a path the points are visited in ascending point index (the order they arrive on this node's input) unless orderAttr names a sort key, and ties in that key always break to the lower point index. With groupAttr set, the cloud splits into one path per distinct group key — a whole-number id or a string name — emitted in ascending key order. `closed` appends a trailing vertex referencing the path's first point — closure is structural, exactly what createPolyline produces and what splineSample detects; no `closed` attribute is written. Any existing topology on the input is replaced, and its vertex and primitive attributes are dropped with it. Downstream: any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path; put this node after them, not before. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
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
        "Name of a scalar point attribute holding a group key, splitting the cloud into one path per distinct key. A NUMERIC key must be a whole number (write one with setAttribute type 'i32', or have copyToPoints write the target index with `targetIndexAttr`) and paths are emitted in ascending key; a STRING key names the group instead — the usual thing a group is — and paths are emitted in ascending code-unit order of the word, never of its table index, so the same names produce the same paths in every geometry and every cell. Fractional numbers are refused rather than grouped: a key is an identity, two values a ULP apart would be two paths, and CPU/GPU parity is a tolerance rather than an equality. Leave empty to build a single path over every point.",
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
    const grouped = new Map<number | string, number[]>();
    if (groupName === "") {
      const all = new Array<number>(np);
      for (let i = 0; i < np; i++) all[i] = i;
      grouped.set(0, all);
    } else {
      const attr = requireGroupPointAttr(geo, groupName, "pointsToPath", "groupAttr");
      // Strings group BY VALUE, never by table index: an index is
      // insertion-ordered, so the same word interns differently in two
      // geometries and, under partitioned cooking, in two cells — the
      // identity-versus-index rule, here deciding which points share a
      // path.
      const isString = attr.type === "string";
      for (let i = 0; i < np; i++) {
        let key: number | string;
        if (isString) {
          key = attr.getString(i);
        } else {
          const value = attr.data[i];
          if (!Number.isInteger(value)) {
            throw new Error(
              `pointsToPath: point ${i} has ${groupName} = ${value}, which is not a whole number; a group key is an IDENTITY, and a fractional one cannot be trusted to be equal to itself — two values a single ULP apart are two paths, and the GPU is only promised to agree with the CPU within a tolerance. Write a whole-number id with setAttribute (type 'i32', which truncates), let copyToPoints write one with "targetIndexAttr", or name the group with a string attribute, which this param also accepts`,
            );
          }
          key = value;
        }
        let bucket = grouped.get(key);
        if (!bucket) grouped.set(key, (bucket = []));
        bucket.push(i);
      }
    }
    // Sorted, never first-seen: the paths a cloud produces must not depend
    // on the order its points arrived in. Strings compare by code unit,
    // which is a property of the WORD and so survives interning.
    const ids = [...grouped.keys()].sort((a, b) =>
      typeof a === "string" || typeof b === "string"
        ? String(a) < String(b)
          ? -1
          : String(a) > String(b)
            ? 1
            : 0
        : a - b,
    );

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
      const named = typeof id === "string" ? JSON.stringify(id) : String(id);
      if (indices.length < 2) {
        // Only a group can be this short: with no groupAttr the single
        // bucket holds every point, and `np < 2` above already rejected
        // that case — so there is no "the input" wording to reach here.
        throw new Error(
          `pointsToPath: group ${named} (attribute "${groupName}") has ${indices.length} point; every path needs at least 2 — drop that group upstream or give it another point`,
        );
      }
      const where = groupName === "" ? "the input" : `group ${named} (attribute "${groupName}")`;
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
    "Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed. Unlike splineSample, each polyline is resampled on its own arc length rather than as one concatenated curve, so a graph with several paths keeps them separate. mode 'count' places exactly `count` samples per path (endpoints included on an open path; a closed path divides its length without duplicating the start). mode 'spacing' steps every `spacing` world units, keeping that step exact rather than stretching it to fit: an open path always ends on its true endpoint, so it never comes back shorter than it went in, and a closed path closes with a REMAINDER segment at the seam that is shorter than `spacing` (use 'count' to divide a loop evenly — see the `spacing` param). Output points are new: they carry the standard point-cloud attributes plus the unit segment `tangent` (f32 tuple 3) and `curveU` (f32, normalized position within that path), and the input's point attributes are NOT carried across. Its PRIMITIVE attributes ARE, in both directions: every attribute of the polyline a sample came from lands on that sample, and each output polyline keeps the attributes of the input polyline it replaces (output primitive i resamples input polyline i and nothing else), so a road resampled here comes back still a road rather than a nameless polyline. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes (P, tangent, curveU, seed, ...) is refused with an error naming the attribute and the fix. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a resampled path that passes through one stops being a path. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
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
        `Distance between samples in world units when mode is 'spacing'. The step is EXACT and is never stretched to make the samples come out even, so a CLOSED path ends on a REMAINDER: the last sample sits at floor(length / spacing) * spacing and the segment from it back to the start is SHORTER than \`spacing\` — a 43-unit loop at spacing 5 gets 9 samples and closes with a 3-unit segment at the seam. That remainder is whatever the loop's length leaves over, anywhere from a hair above 0 to just under \`spacing\`. To divide a loop EVENLY, switch mode to 'count': it splits the length into \`count\` equal steps and has no seam segment. An open path is the same story at its far end — it always lands on its true endpoint, so its last segment is short in the same way. Must be > 0, small enough to leave at least 2 samples on each open path (3 on a closed one), and large enough that the whole input stays under ${MAX_RESAMPLE_POINTS} samples. Ignored in 'count' mode.`,
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
    // Which input polyline each sample came from, and which input polyline
    // each OUTPUT polyline replaces. The second is a structural 1:1 —
    // output primitive `ti` is a resampling of `tables[ti].prim` and of
    // nothing else — which is what lets a resampled road stay a road.
    const samplePrim = new Uint32Array(total);
    const outPrimSrc = new Uint32Array(tables.length);
    const at = [0, 0]; // scratch [segment, t] reused by every sample
    let w = 0;
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      const positions = perPath[ti];
      const L = table.length;
      outPrimSrc[ti] = table.prim;
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
        samplePrim[w] = table.prim;
        w++;
      }
    }
    carryPrimitiveAttributes(
      geo.attrs.primitive,
      out.attrs.point,
      samplePrim,
      "pathResample",
      "point",
    );

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
    // The other half of the same bug: setPolylineTopology DELETES the
    // vertex and primitive columns, so without this a resampled road came
    // back a nameless polyline — the node destroyed on its own output the
    // values it had just carried onto the points. Restored as a structural
    // 1:1, so it is exact rather than a nearest-match: output primitive
    // `ti` is a resampling of `tables[ti].prim`.
    carryPrimitiveAttributes(
      geo.attrs.primitive,
      out.attrs.primitive,
      outPrimSrc,
      "pathResample",
      "primitive",
    );
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link pathSegments}. */
export interface PathSegmentsParams {
  axis: string;
  radius: FieldParam;
  extend: number;
}

/** One oriented instance point per polyline segment. */
export const pathSegments = standardNode<PathSegmentsParams>({
  type: "pathSegments",
  category: "sampler",
  description:
    "Emits ONE POINT PER SEGMENT of every polyline primitive, placed and oriented so that spawning a unit-sized asset on it draws the path as solid geometry. This is the DISCRETE way to draw a curve: one asset per segment, which is what a chain of separate links, a row of sleepers or a string of beads is. For a continuous skin use sweepProfile instead — it emits a real triangle mesh, shares rings between segments, and needs no `extend` because it leaves no gap to fill. Each output point sits at its segment's MIDPOINT, with `rot` turning the chosen local `axis` onto the segment direction and `scale` holding the segment's length on that axis and `radius` on the other two — so a unit cylinder (height 1, radius 1) lands exactly on the segment. Also writes the unit `tangent` (f32 tuple 3, the segment direction), `curveU` (f32, the midpoint's normalized position along that path) and `seed`; the input's POINT attributes are not carried, its PRIMITIVE attributes are. The default axis is '+y', deliberately unlike orientAlongVector's '+z': the assets this feeds are cylinders and capsules, which are built along Y in three.js, whereas orientAlongVector points props at a heading. Roll around the segment is fixed by an up hint of [0, 1, 0] with the same deterministic fallbacks orientAlongVector uses ([0, 0, 1], then [1, 0, 0]) — a tube is rotationally symmetric so the roll is arbitrary, but it is never random; when it MATTERS (alternating chain links), re-orient downstream with orientAlongVector reading the `tangent` this node wrote. Segments of zero length are SKIPPED rather than emitted as degenerate instances, so the output can hold fewer points than the input had segments. THE OUTPUT IS A PLAIN CLOUD, not a path: the points are segment midpoints, not the curve, and no polyline topology is built over them — resampling or re-pathing this output describes the midpoints, not the original curve, so branch off the path itself for that. Closed paths need nothing special: their closing segment is a segment like any other.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    axis: {
      type: "enum",
      default: "+y",
      enum: [...ORIENT_AXES],
      description:
        "Which local axis of the spawned asset runs along the segment, and therefore which `scale` component carries the segment length. Default '+y' — three.js CylinderGeometry and CapsuleGeometry are built along Y, and this node exists to feed them. The other two components carry `radius`.",
    },
    radius: {
      type: "f32",
      default: 0.05,
      min: 0,
      acceptsField: true,
      description:
        "Scale written to the two components that are not the axis; with a unit-radius asset this is the tube's radius in world units. Field-capable, but note WHERE it resolves: on the INPUT points (the path's own points), not on the segments this node emits — the output domain does not exist yet when the field runs. Each segment takes the AVERAGE of the values at its two endpoints, so a radius that tapers along a path tapers smoothly across the segments. That also means a field can only read attributes the input POINTS carry: a per-path radius living on the PRIMITIVE domain has to be promoted onto the points first (promoteAttribute, primitive to point) before a field can see it. Values below 0 are clamped to 0.",
    },
    extend: {
      type: "f32",
      default: 0,
      min: 0,
      description:
        "World units added to BOTH ends of every segment (the length on the axis becomes segment + 2 * extend; the midpoint does not move). This is the joint filler: consecutive segments meeting at a bend leave a wedge-shaped gap on the outside of the corner, and overlapping them closes it. About one radius is enough down to right-angle bends. Costs nothing but overlap, and with a capsule asset the rounded caps hide the seam entirely.",
    },
  },
  // `radius` may resolve on the GPU. It is evaluated on the INPUT
  // geometry, which this node never mutates (it builds a fresh cloud),
  // so the resolver and the CPU fallback see identical bytes.
  gpu: "fields",
  async execute({ inputs, params, seed, gpu, checkCancelled }) {
    const axis = params.axis;
    if (!(ORIENT_AXES as readonly string[]).includes(axis)) {
      throw new Error(
        `pathSegments: param "axis" must be one of ${ORIENT_AXES.join(", ")}; got "${axis}"`,
      );
    }
    const extend = params.extend;
    if (!Number.isFinite(extend) || extend < 0) {
      throw new Error(
        `pathSegments: param "extend" must be a finite number >= 0, got ${extend}`,
      );
    }
    const geo = requireGeometry(inputs, "in", "pathSegments");
    const tables = polylineArcTables(geo, "pathSegments");
    const radius = requireTuple(
      await resolveOnMaybeGpu(gpu, geo, "point", params.radius, seed, "pathSegments", "radius"),
      [1],
      "pathSegments",
      "radius",
    );

    // Count first: zero-length segments are skipped, so the output size
    // is not simply the vertex count and the cloud must be sized before
    // anything is written into it.
    let total = 0;
    for (const table of tables) {
      for (let k = 0; k < table.segLen.length; k++) {
        if (table.segLen[k] > 0) total++;
      }
    }
    if (total === 0) {
      throw new Error(
        `pathSegments: every segment of the input's ${tables.length} path(s) has zero length (all of a path's points sit at the same position), so there is nothing to draw; move the points apart, or drop the degenerate paths upstream`,
      );
    }

    const out = createPointCloud(total);
    const op = out.attrs.point.require("P").data;
    const rot = out.attrs.point.require("rot").data;
    const scale = out.attrs.point.require("scale").data;
    const seeds = out.attrs.point.require("seed").data;
    const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
    // Which input polyline each segment came from. There is no output
    // primitive domain to carry onto — the output is a cloud.
    const samplePrim = new Uint32Array(total);
    // Which scale component the length goes on; the other two take the
    // radius. The sign in the axis name only picks a direction, not a
    // component, and a negative scale would mirror the asset.
    const lengthComp = axis[1] === "x" ? 0 : axis[1] === "y" ? 1 : 2;
    const q: number[] = [0, 0, 0, 1];
    let w = 0;
    for (const table of tables) {
      const L = table.length;
      const pts = table.points;
      for (let k = 0; k < table.segLen.length; k++) {
        if ((w & 1023) === 0) checkCancelled();
        // The geometric length of the delta this node also takes the
        // direction from, NOT a difference of cumulative lengths: those
        // agree to a float hair, and here the two must be the SAME
        // number or a segment's tube would not span its own endpoints.
        const len = table.segLen[k];
        if (len === 0) continue; // degenerate: no direction, nothing to draw
        const dx = table.segDir[k * 3];
        const dy = table.segDir[k * 3 + 1];
        const dz = table.segDir[k * 3 + 2];
        const inv = 1 / len;
        const fx = dx * inv;
        const fy = dy * inv;
        const fz = dz * inv;
        // Midpoint, from the segment's own start and delta.
        op[w * 3] = table.segStart[k * 3] + dx * 0.5;
        op[w * 3 + 1] = table.segStart[k * 3 + 1] + dy * 0.5;
        op[w * 3 + 2] = table.segStart[k * 3 + 2] + dz * 0.5;
        tangent[w * 3] = fx;
        tangent[w * 3 + 1] = fy;
        tangent[w * 3 + 2] = fz;
        // A path of zero total length cannot reach here: every one of
        // its segments is degenerate and was skipped above.
        curveU[w] = (table.cum[k] + len * 0.5) / L;
        orientQuat(q, fx, fy, fz, 0, 1, 0, axis);
        rot[w * 4] = q[0];
        rot[w * 4 + 1] = q[1];
        rot[w * 4 + 2] = q[2];
        rot[w * 4 + 3] = q[3];
        // Radius resolves on the INPUT points, so it is averaged over
        // the two the segment runs between — the segment itself has no
        // element in that domain to have been evaluated at.
        const r0 = radius.data[pts[k]];
        const r1 = radius.data[pts[k + 1]];
        const r = Math.max(0, (r0 + r1) * 0.5);
        scale[w * 3] = r;
        scale[w * 3 + 1] = r;
        scale[w * 3 + 2] = r;
        scale[w * 3 + lengthComp] = len + 2 * extend;
        seeds[w] = hashCombine(seed, w);
        samplePrim[w] = table.prim;
        w++;
      }
    }
    carryPrimitiveAttributes(
      geo.attrs.primitive,
      out.attrs.point,
      samplePrim,
      "pathSegments",
      "point",
    );
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link pathPointAt}. */
export interface PathPointAtParams {
  mode: string;
  parameter: FieldParam;
}

/** Move each point of a path to a chosen parameter along its own polyline. */
export const pathPointAt = standardNode<PathPointAtParams>({
  type: "pathPointAt",
  category: "point op",
  description:
    "Moves every point of every polyline to the position at a given parameter ALONG ITS OWN polyline, and writes the unit `tangent` and `curveU` it finds there. Points, attributes and topology all survive — this slides points along the curve they already sit on rather than building new ones, so a path stays the same path and only its parameterization changes. This is the evaluate-at-parameter the library otherwise lacks: pathResample and splineSample can only step a whole curve at even intervals, so 'where is this curve at u = 0.37' had no answer, and anything that needed one had to approximate by stepping along the tangent and hoping the curve was straight enough. mode 'fraction' reads the parameter as 0..1 of that polyline's arc length; mode 'distance' reads it as world units from the start. Both CLAMP out of range rather than wrapping or erroring — a parameter is usually computed, and a clamp is what keeps a point on the curve. The parameter is field-capable and resolves on the INPUT points BEFORE anything moves, so a field reading `curveU` sees where each point started and can be written as an offset from it: lerp(curveU, target, amount) slides each point partway toward a target. A point in several polylines is placed by the LAST one in primitive order, matching writeTangents, and a point in none is left exactly where it is with a zero tangent and curveU 0 — as is every point of a polyline whose length is zero, since it has no parameter to speak of. Because points can slide past each other, a path whose parameters are not monotonic comes back folded; that is the caller's to avoid, and it is legal geometry either way.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "fraction",
      enum: ["fraction", "distance"],
      description:
        "How the parameter is read: 'fraction' is 0..1 of the polyline's own arc length, so the same value means the same relative place on curves of different lengths; 'distance' is world units from the polyline's start. Both clamp to the ends.",
    },
    parameter: {
      type: "f32",
      default: 0.5,
      acceptsField: true,
      description:
        "Where along the polyline to place the point, read according to `mode`. Field-capable, resolved on the INPUT points before any of them move — so it can read `curveU` and express a move relative to where the point already is (for example lerp(attribute('curveU'), target, amount)), which is the usual way to use this node. Values outside the range clamp.",
    },
  },
  // `parameter` may resolve on the GPU. It is evaluated on the cloned
  // input's point domain BEFORE P is touched, so the resolver and the
  // CPU fallback both see the pre-move positions.
  gpu: "fields",
  async execute({ inputs, params, seed, gpu }) {
    if (params.mode !== "fraction" && params.mode !== "distance") {
      throw new Error(
        `pathPointAt: unknown mode "${params.mode}"; valid modes: fraction, distance`,
      );
    }
    const src = requireGeometry(inputs, "in", "pathPointAt");
    // Both columns are this node's own shape to write, so a differently
    // shaped one already under either name is refused rather than
    // deleted and re-added — see writeTangents for why.
    for (const [name, tupleSize] of [
      ["tangent", 3],
      ["curveU", 1],
    ] as const) {
      requireReportSlot({
        attrs: src.attrs.point,
        nodeType: "pathPointAt",
        // Not a param: this node always writes both, so the message
        // names what it is rather than a knob that could be pointed
        // elsewhere. The fix it suggests — removeAttribute — still is.
        param: `the ${name} it writes`,
        name,
        type: "f32",
        tupleSize,
        domain: "point",
        suggestion: name,
      });
    }
    const geo = cloneGeometry(src);
    const tables = polylineArcTables(geo, "pathPointAt");
    const at = requireTuple(
      await resolveOnMaybeGpu(gpu, geo, "point", params.parameter, seed, "pathPointAt", "parameter"),
      [1],
      "pathPointAt",
      "parameter",
    );
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    // Reset rather than update in place: a point no polyline reaches has
    // no tangent to report, and leaving a stale one from upstream would
    // be a value that quietly describes a different curve.
    const tangent = geo.attrs.point.replace("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = geo.attrs.point.replace("curveU", "f32", 1, 0).data;
    const found = [0, 0]; // scratch [segment, t], reused by every point

    for (const table of tables) {
      const L = table.length;
      if (!(L > 0)) continue; // every point coincides: no parameter to seek
      const pts = table.points;
      const nv = pts.length;
      // A closed path repeats its first point as the last vertex; that
      // repeat is the closure, not a second point to place.
      const m = table.closed ? nv - 1 : nv;
      for (let k = 0; k < m; k++) {
        const p = pts[k];
        const raw = readComp(at, p, 0);
        const want = params.mode === "fraction" ? raw * L : raw;
        const s = want < 0 ? 0 : want > L ? L : want;
        locateOnArcLength(found, table.cum, s);
        const lo = found[0];
        const t = found[1];
        const dx = table.segDir[lo * 3];
        const dy = table.segDir[lo * 3 + 1];
        const dz = table.segDir[lo * 3 + 2];
        pd[p * ps] = table.segStart[lo * 3] + dx * t;
        pd[p * ps + 1] = table.segStart[lo * 3 + 1] + dy * t;
        pd[p * ps + 2] = table.segStart[lo * 3 + 2] + dz * t;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
          tangent[p * 3] = dx / len;
          tangent[p * 3 + 1] = dy / len;
          tangent[p * 3 + 2] = dz / len;
        }
        curveU[p] = s / L;
      }
    }
    return { out: [makeGeometryItem(geo)] };
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
    "Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path. This is the tangent source for paths that were never spline-sampled: splineSample emits `tangent` only for the new points it creates, so a path built with pointsToPath has none, and orientAlongVector (which reads a direction field, typically the tangent attribute) has nothing to consume. The tangent at a point is the normalized central difference between its neighbours along the path, which stays smooth through corners; at the ends of an open path it is the adjacent segment direction, and a closed path wraps around. When the two neighbours coincide — a hairpin, where the path doubles back on itself — the forward segment direction stands in, pointing the way the path LEAVES the point. A point whose neighbours all sit on top of it, and any point not referenced by any polyline, gets [0, 0, 0] — orientAlongVector deliberately leaves a zero direction's rot untouched. A point visited by more than one polyline takes the tangent of the last one in primitive order. Any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so run this before them, not after. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "tangent",
      description:
        "Attribute to write (created, or reset when it already exists as f32 tuple 3). The default 'tangent' is the name splineSample emits and the one an orientAlongVector direction field usually reads. The shape is this node's to pick, so a name the input's point domain already holds under a DIFFERENT shape is REFUSED rather than deleted and re-added — writing it would destroy that column and everything in it while the cook still looked fine. Give the tangents a name of their own, or removeAttribute the clash first. 'P' is refused outright, same shape or not: it is what the tangents are computed from.",
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
    const src = requireGeometry(inputs, "in", "writeTangents");
    // `name` is a reporting slot: the shape is this node's (f32 tuple 3),
    // so `replace` would DELETE a differently shaped column and re-add it,
    // and the cook would still look fine. Refusing only "P" left every
    // other column open. Checked before the clone and before the arc
    // tables — a refusal must cost nothing, and a name clash reported as
    // "no polyline primitives" sends the author to debug the wrong thing.
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "writeTangents",
      param: "name",
      name,
      type: "f32",
      tupleSize: 3,
      domain: "point",
      suggestion: "tangent",
    });
    // cloneGeometry preserves topology; gatherPoints and mergePoints do not.
    // It is also what keeps this node pure: the input is a cached upstream
    // object, and this is the one path node that writes into its geometry.
    const geo = cloneGeometry(src);
    const tables = polylineArcTables(geo, "writeTangents");
    const dst = geo.attrs.point.replace(name, "f32", 3, [0, 0, 0]);
    const P = geo.attrs.point.require("P");
    writePolylineTangents(tables, P.data, P.tupleSize, dst.data);
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link writeCurveFrame}. */
export interface WriteCurveFrameParams {
  tangentName: string;
  normalName: string;
  binormalName: string;
}

/**
 * A unit vector perpendicular to `t`, chosen deterministically. Used
 * once per path, to start the transport off.
 *
 * It projects whichever world axis `t` is LEAST aligned with, so the
 * projection is never near-degenerate. That choice is a branch: two
 * curves whose start tangents sit either side of it begin a quarter turn
 * apart. Harmless — the roll of a frame has no natural zero and every
 * point after the first is relative to this one — but it is worth
 * knowing that the frame at a path's end is a property of the WHOLE
 * path, not of that point.
 */
function seedNormal(out: number[], tx: number, ty: number, tz: number): number[] {
  const ax = Math.abs(tx);
  const ay = Math.abs(ty);
  const az = Math.abs(tz);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  if (ax <= ay && ax <= az) sx = 1;
  else if (ay <= az) sy = 1;
  else sz = 1;
  const d = sx * tx + sy * ty + sz * tz;
  const nx = sx - d * tx;
  const ny = sy - d * ty;
  const nz = sz - d * tz;
  const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  out[0] = nx * inv;
  out[1] = ny * inv;
  out[2] = nz * inv;
  return out;
}

/** A rotation-minimizing frame at every point of a path. */
export const writeCurveFrame = standardNode<WriteCurveFrameParams>({
  type: "writeCurveFrame",
  category: "attribute",
  description:
    "Writes a full orthonormal frame — `tangent`, `curveNormal` and `curveBinormal` (f32 tuple 3) — at the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived. The tangent is the same central difference writeTangents writes, from the same shared code, so the three columns are guaranteed mutually perpendicular rather than nearly so. WHY IT EXISTS: orientAlongVector fixes the roll around a direction with an `up` hint, and a CONSTANT up cannot follow a curve that turns over — as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve (a radial spike, a chain link, a bracket) snaps round with it. The normal here is carried ALONG the curve instead of recomputed from a world axis: it starts perpendicular to the first tangent and is transported point to point by double reflection, which is the rotation that moves it as little as each step allows. Feed it back in as orientAlongVector's `up` — field-capable for exactly this — and the roll varies smoothly however the curve turns; combine `curveNormal` and `curveBinormal` with cos and sin of an angle to aim anything radially around the path. THE FRAME IS NOT LOCAL: a point's normal depends on every point before it along its path, so this must run BEFORE anything that splits a path across cook cells or partitions it — the same curve arriving as two pieces gets two unrelated frames. A CLOSED path does not come back seamless: transport around a loop returns rotated by a residual angle (the holonomy of that curve), so the frame either side of the seam differs, and no local rule can fix it. That is a property of closed curves rather than a defect, and it is left visible instead of smeared out. Degenerate points follow writeTangents: a point whose neighbours all coincide gets a zero tangent and is skipped by the transport, a point in several polylines takes the last one in primitive order, and unreferenced points get [0, 0, 0] on all three.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    tangentName: {
      type: "string",
      default: "tangent",
      description:
        "Attribute for the unit tangent (created, or reset when it already exists as f32 tuple 3). The default matches what pathResample and splineSample emit, so a path that already carries tangents has them rewritten to identical values.",
    },
    normalName: {
      type: "string",
      default: "curveNormal",
      description:
        "Attribute for the transported normal. NOT called 'normal' deliberately: surfaceSample writes a surface `normal` of the same shape (f32 tuple 3), and an identical shape is exactly the case a reporting slot ACCEPTS — so that name would be quietly reset in place, and a graph that samples a surface and frames a curve would have one silently overwrite the other.",
    },
    binormalName: {
      type: "string",
      default: "curveBinormal",
      description:
        "Attribute for the binormal, tangent cross normal — the third axis of the frame. Written here rather than left to the consumer because recomputing it downstream from two f32 columns is where a frame stops being exactly orthonormal.",
    },
  },
  execute({ inputs, params }) {
    // Params before geometry: a bad name reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    const names = [
      ["tangentName", params.tangentName],
      ["normalName", params.normalName],
      ["binormalName", params.binormalName],
    ] as const;
    const suggestion: Record<string, string> = {
      tangentName: "tangent",
      normalName: "curveNormal",
      binormalName: "curveBinormal",
    };
    for (const [param, name] of names) {
      if (name === "") {
        throw new Error(
          `writeCurveFrame: param "${param}" must be a non-empty attribute name; the default is "${suggestion[param]}"`,
        );
      }
      if (name === "P") {
        throw new Error(
          `writeCurveFrame: param "${param}" cannot be "P" — that would overwrite the positions the frame is computed from; use "${suggestion[param]}" or another name`,
        );
      }
    }
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        if (names[i][1] === names[j][1]) {
          throw new Error(
            `writeCurveFrame: params "${names[i][0]}" and "${names[j][0]}" are both "${names[i][1]}"; the three axes of a frame need three different attributes, or two of them would overwrite each other`,
          );
        }
      }
    }
    const src = requireGeometry(inputs, "in", "writeCurveFrame");
    // Each name is a reporting slot of this node's own shape, so a
    // differently shaped column under one is refused rather than deleted
    // and re-added — see writeTangents for why that distinction matters.
    for (const [param, name] of names) {
      requireReportSlot({
        attrs: src.attrs.point,
        nodeType: "writeCurveFrame",
        param,
        name,
        type: "f32",
        tupleSize: 3,
        domain: "point",
        suggestion: suggestion[param],
      });
    }

    const geo = cloneGeometry(src);
    const tables = polylineArcTables(geo, "writeCurveFrame");
    const P = geo.attrs.point.require("P");
    const tangent = geo.attrs.point.replace(params.tangentName, "f32", 3, [0, 0, 0]);
    const normal = geo.attrs.point.replace(params.normalName, "f32", 3, [0, 0, 0]);
    const binormal = geo.attrs.point.replace(params.binormalName, "f32", 3, [0, 0, 0]);
    writePolylineTangents(tables, P.data, P.tupleSize, tangent.data);

    const td = tangent.data;
    const nd = normal.data;
    const bd = binormal.data;
    const pd = P.data;
    const ps = P.tupleSize;
    const seed: number[] = [0, 0, 0];

    for (const table of tables) {
      const pts = table.points;
      const nv = pts.length;
      const m = table.closed ? nv - 1 : nv;
      // The transport runs in f64 and is rounded to f32 only on store:
      // the normal at one step feeds the next, so rounding inside the
      // recurrence would compound along the path instead of staying put.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      // The last point a frame was written at — NOT k - 1, which may be
      // a degenerate point that was skipped and carries a zero tangent.
      // Transporting from one of those reflects across nothing.
      let prev = -1;
      for (let k = 0; k < m; k++) {
        const p = pts[k];
        const tx = td[p * 3];
        const ty = td[p * 3 + 1];
        const tz = td[p * 3 + 2];
        if (tx === 0 && ty === 0 && tz === 0) continue;
        if (prev === -1) {
          seedNormal(seed, tx, ty, tz);
          nx = seed[0];
          ny = seed[1];
          nz = seed[2];
        } else {
          // Double reflection (Wang et al.): reflect the previous frame
          // across the plane bisecting the step, then across the plane
          // bisecting the tangent change. Two reflections compose to a
          // rotation, so the result stays orthonormal by construction
          // rather than by renormalizing and hoping, and it is the
          // rotation that moves the normal least.
          const v1x = pd[p * ps] - pd[prev * ps];
          const v1y = pd[p * ps + 1] - pd[prev * ps + 1];
          const v1z = pd[p * ps + 2] - pd[prev * ps + 2];
          const c1 = v1x * v1x + v1y * v1y + v1z * v1z;
          let lnx = nx;
          let lny = ny;
          let lnz = nz;
          let ltx = td[prev * 3];
          let lty = td[prev * 3 + 1];
          let ltz = td[prev * 3 + 2];
          if (c1 > 0) {
            const f1 = (2 / c1) * (v1x * nx + v1y * ny + v1z * nz);
            lnx = nx - f1 * v1x;
            lny = ny - f1 * v1y;
            lnz = nz - f1 * v1z;
            const f2 = (2 / c1) * (v1x * ltx + v1y * lty + v1z * ltz);
            ltx = ltx - f2 * v1x;
            lty = lty - f2 * v1y;
            ltz = ltz - f2 * v1z;
          }
          const v2x = tx - ltx;
          const v2y = ty - lty;
          const v2z = tz - ltz;
          const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
          if (c2 > 0) {
            const f3 = (2 / c2) * (v2x * lnx + v2y * lny + v2z * lnz);
            nx = lnx - f3 * v2x;
            ny = lny - f3 * v2y;
            nz = lnz - f3 * v2z;
          } else {
            nx = lnx;
            ny = lny;
            nz = lnz;
          }
          // Re-orthogonalize against the tangent and renormalize. The
          // reflections are exact in theory; in f64 over a few thousand
          // points they are not, and a frame that has drifted off the
          // tangent by a thousandth is a spike that visibly leans.
          const d = nx * tx + ny * ty + nz * tz;
          nx -= d * tx;
          ny -= d * ty;
          nz -= d * tz;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len > 0) {
            const inv = 1 / len;
            nx *= inv;
            ny *= inv;
            nz *= inv;
          } else {
            // The transported normal collapsed onto the tangent, which
            // takes a full reversal inside one step. Restart from the
            // seed rather than propagate a zero frame down the rest.
            seedNormal(seed, tx, ty, tz);
            nx = seed[0];
            ny = seed[1];
            nz = seed[2];
          }
        }
        nd[p * 3] = nx;
        nd[p * 3 + 1] = ny;
        nd[p * 3 + 2] = nz;
        // binormal = tangent x normal, so (t, n, b) is right-handed.
        bd[p * 3] = ty * nz - tz * ny;
        bd[p * 3 + 1] = tz * nx - tx * nz;
        bd[p * 3 + 2] = tx * ny - ty * nx;
        prev = p;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
