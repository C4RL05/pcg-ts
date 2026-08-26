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
  type AttributeSet,
  type Geometry,
} from "../data/index.js";
import type { Column } from "../fields/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  ORIENT_AXES,
  type FieldParam,
  type PolylineArcTable,
  carryPrimitiveAttributes,
  locateOnArcLength,
  orientQuat,
  polylineArcTables,
  polylineWalks,
  readComp,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  requireTuple,
  resolveOn,
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
  shortGroups: string;
}

/**
 * Returns whether a group with too few points for the requested path is
 * SKIPPED rather than refused.
 *
 * Checked at runtime for the reason `copyToPoints`' topology guard gives:
 * a param's `enum` is metadata for an editor, not a runtime guard, and a
 * serialized graph can carry any string into `execute`. An unrecognized
 * value must not fall through to either behaviour — silently meaning
 * "error" would leave the author with a cook that failed on a group they
 * thought they had excused, and silently meaning "skip" would leave them
 * with paths quietly missing from the output, which is the failure this
 * param exists to make explicit rather than to invent a new way of.
 */
function requireShortGroupsRule(value: string): boolean {
  if (value !== "error" && value !== "skip") {
    throw new Error(
      `pointsToPath: shortGroups must be "error" or "skip", got ${JSON.stringify(value)}; ` +
        '"error" refuses the cook and names the group that had too few points for the requested path, ' +
        '"skip" emits no primitive for that group and leaves its points in the cloud, belonging to no path',
    );
  }
  return value === "skip";
}

/** Build polyline primitives over an existing point cloud. */
export const pointsToPath = standardNode<PointsToPathParams>({
  type: "pointsToPath",
  category: "point op",
  description:
    "Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph. Ordering is fixed and deterministic: within a path the points are visited in ascending point index (the order they arrive on this node's input) unless orderAttr names a sort key, and ties in that key always break to the lower point index. With groupAttr set, the cloud splits into one path per distinct group key — a whole-number id or a string name — emitted in ascending key order. A group with too few points for the path being asked for — fewer than 2, or fewer than 3 when `closed` — is an error by default; `shortGroups \"skip\"` emits no primitive for it instead and leaves its points in the cloud belonging to no path, which is what makes a DATA-DEPENDENT grouping (a key computed from a scatter, a cell, a copyToPoints target index) cookable at all, since nobody can know at graph-build time how many points land in each group. It governs the WHOLE INPUT by the same rule: a cloud of fewer than 2 points is an error by default and passes straight through under \"skip\", because one point in one cloud is the same nothing-to-draw as one point in one group and a caller that has excused the second has already excused the first. `closed` appends a trailing vertex referencing the path's first point — closure is structural, exactly what createPolyline produces and what splineSample detects; no `closed` attribute is written. Any existing topology on the input is replaced, and its vertex and primitive attributes are dropped with it. Downstream: any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path; put this node after them, not before. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    closed: {
      type: "bool",
      default: false,
      description:
        "Close each path by appending a trailing vertex back to its first point (structural closure — no attribute is written). A closed path needs at least 3 points; 2 would fold the path back onto itself and is an error by default (`shortGroups \"skip\"` drops such a path instead). This param is therefore what decides which groups count as SHORT: the same 2-point group is a perfectly good open path and an impossible closed one.",
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
    shortGroups: {
      type: "enum",
      default: "error",
      enum: ["error", "skip"],
      description:
        "What happens to a group that has too few points for the path being asked for — fewer than 2, or fewer than 3 when `closed` is true, so the SAME 2-point group is short only when it is being closed. 'error' (the default) refuses the cook and names the group, which is the right answer when the groups are AUTHORED: an id you wrote by hand belongs to a population you can predict, so a group of one is a mistake in the graph and a cook that quietly emitted one path fewer would hide it. 'skip' emits NO primitive for that group and leaves its points exactly where they are — same indices, every attribute intact, simply belonging to no path — which is the only workable answer when the groups are DATA: a key computed from a scatter, a grid cell, or a copyToPoints target index has a population nobody can know at graph-build time, so a sparse cell that drops a single point into one lane is not an authoring error and must not fail the whole cook. Nothing else moves under 'skip': the surviving groups are the same paths, over the same point indices, emitted in the same ascending-key order they would have had if the short group had never been in the input, so turning this on can only remove a path that could not be built — it can never change one that could. With `groupAttr` EMPTY the whole cloud is a single implicit group and this param still applies to it, because a group is a group however it was formed and a second rule for the unnamed one would be a trap: the only way to be short there is exactly 2 points with `closed` true, and under 'skip' such a cloud comes back with its points and no polyline instead of failing. What that case does NOT cover is a cloud of fewer than 2 points, which is refused under both settings by a different check — a node handed one point has nothing to do at all, and no grouping question was ever asked. Downstream, points belonging to no path are invisible to every path node (pathResample, splineSample, writeTangents, pathScan and pathSegments all walk primitives, not points), so a skipped group's points still filter, transfer and merge like any other points but never become a path on their own; if that is not what you want, fix the population upstream — scatter more points, widen the cell, or merge the sparse groups — rather than leaving them stranded.",
    },
  },
  execute({ inputs, params }) {
    // Params before geometry: a typo in this one reported later as a short
    // group would send the author to debug their data instead of their
    // spelling.
    const skipShort = requireShortGroupsRule(params.shortGroups);
    // cloneGeometry is the only helper that preserves topology, and it is
    // also what keeps this node honest about purity: the input geometry
    // is a cached upstream object and must never be mutated.
    const geo = cloneGeometry(requireGeometry(inputs, "in", "pointsToPath"));
    const np = geo.pointCount;
    // THE WHOLE-INPUT FLOOR OBEYS `shortGroups` TOO, and it took an
    // argument to see why. A cloud of one point is the same fact as a
    // group of one point — there is nothing to draw a path through — and
    // the reason `skip` exists is that a data-dependent grouping cannot be
    // sized at graph-build time. A cell that drops ONE placement is
    // strictly sparser than a cell that drops one into a lane, so refusing
    // the first while excusing the second would fail exactly the case the
    // param was added for, and fail it further from the author. Under
    // `skip` an input too small to draw anything through emits the cloud
    // unchanged with no primitives, which is what a caller asking to skip
    // short groups has already said it wants.
    if (np < 2 && !skipShort) {
      throw new Error(
        `pointsToPath: input has ${np} point${np === 1 ? "" : "s"}; a path needs at least 2 (scatter more points, loosen the filter feeding this node, or set shortGroups "skip" to pass the cloud through with no path over it)`,
      );
    }
    if (np < 2) return { out: [makeGeometryItem(geo)] };

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
      // The threshold is the one the path being asked for actually needs,
      // which is why `closed` is read here and not only below: a 2-point
      // group is a path when open and impossible when closed. Under
      // `shortGroups "skip"` a group under it emits nothing and its points
      // are simply left in the cloud — `continue` before anything is pushed,
      // so the groups that DO build see the same vertex offsets they would
      // have seen had the short one never arrived.
      if (indices.length < (closed ? 3 : 2)) {
        if (skipShort) continue;
        if (indices.length < 2) {
          // Only a group can be this short: with no groupAttr the single
          // bucket holds every point, and `np < 2` above already rejected
          // that case — so there is no "the input" wording to reach here.
          throw new Error(
            `pointsToPath: group ${named} (attribute "${groupName}") has ${indices.length} point; every path needs at least 2 — drop that group upstream, give it another point, or set shortGroups "skip" to leave its points in the cloud with no path over them`,
          );
        }
        const where = groupName === "" ? "the input" : `group ${named} (attribute "${groupName}")`;
        throw new Error(
          `pointsToPath: ${where} has 2 points and closed is true, which would fold the path back over itself; set closed false, give the path at least 3 points, or set shortGroups "skip" to leave those points in the cloud with no path over them`,
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
  spacing: FieldParam;
  lengthAttr: string;
  stepAttr: string;
}

/**
 * The two opt-in reports {@link pathResample} writes, checked against one
 * attribute set.
 *
 * BOTH LAND ON THE PRIMITIVE DOMAIN, and that is the whole design
 * decision. A path has ONE arc length, and in 'count' mode it has ONE
 * step — `count` samples divide that path's own length, so two paths of
 * different lengths get different steps and neither number varies from
 * sample to sample. A per-path value on the point domain would be the
 * same number repeated `count` times, which is not a cheaper spelling of
 * the fact but a weaker one: it says nothing about the path, it is free
 * to disagree with itself, and it costs a column the length of the cloud.
 * `connectPoints.lengthAttr` already writes a per-edge length on the
 * primitive domain for exactly this reason, and a resampled path's length
 * is the same kind of fact about the same kind of element. A field that
 * needs it per sample promotes it (promoteAttribute, primitive to point),
 * which is the route `pathSegments.radius` already documents.
 *
 * Run TWICE: once against the INPUT's primitive domain, where a refusal
 * costs nothing and where every column that is about to be carried onto
 * the output already lives, and once against the OUTPUT's, which is the
 * domain actually written and the only one guaranteed to hold `primtype`
 * (an input with no `primtype` at all still has its polylines read).
 */
function requireResampleReports(
  attrs: AttributeSet,
  params: PathResampleParams,
  on: "input" | "output",
): void {
  const slots = [
    ["lengthAttr", params.lengthAttr, "pathLength"],
    ["stepAttr", params.stepAttr, "sampleStep"],
  ] as const;
  for (const [param, name, suggestion] of slots) {
    if (name === "") continue;
    requireReportSlot({
      attrs,
      nodeType: "pathResample",
      param,
      name,
      type: "f32",
      tupleSize: 1,
      domain: "primitive",
      suggestion,
      on,
    });
  }
}

/**
 * Ceiling on the points one `pathResample` may emit in 'spacing' mode.
 * 'count' mode is bounded by a number the author typed; a spacing is not,
 * so a small one on a long path runs away silently — the same hazard
 * volumeSample bounds with MAX_VOLUME_POINTS, and bounded the same way.
 */
const MAX_RESAMPLE_POINTS = 1_048_576;

/**
 * `pathResample.spacing` as one step per PATH, resolved on the INPUT's
 * PRIMITIVE domain.
 *
 * That domain is the whole reason this param can be a field at all. The
 * rule is that a param is field-capable exactly when its value is read PER
 * ELEMENT, and "nothing that decides how many elements come OUT" reads like
 * it should disqualify a spacing — it sizes the output. It does not here,
 * because this node resamples every polyline ON ITS OWN ARC LENGTH: there
 * IS an element per reading, the primitive, and each path's sample count
 * follows that path's own value. `splineSample.spacing` stays disqualified
 * for exactly the reason this one is not — it concatenates every polyline
 * into ONE curve and reads its spacing once, against no element.
 *
 * Guarded (`resolveOn`, not the allowing variant): a NaN or infinite
 * spacing has no documented meaning here — it is a broken expression, and
 * an infinite one would place one sample on a path that needs two.
 */
function resampleSpacingColumn(geo: Geometry, value: FieldParam, seed: number): Column {
  return requireScalarColumn(
    resolveOn(geo, "primitive", value, seed, "pathResample", "spacing"),
    "pathResample",
    "spacing",
    // The word the message uses for one element, which is "path" here even
    // though the column lands on the primitive domain: that is what a
    // polyline IS to the author of this node.
    "path",
    "a spacing",
  );
}

/**
 * The refusal when the samples placed so far, plus this path's, would pass
 * {@link MAX_RESAMPLE_POINTS}.
 *
 * The cap is on the TOTAL and always has been — the running count is
 * global, so a field cannot buy ten paths of 200 000 samples each by
 * keeping every one of them under the cap on its own. What the field
 * changes is only what can be SAID about the fix: a plain spacing has one
 * number to raise, while a field has one per path, so the message names the
 * path the running total ran out on and offers the bound that would make
 * even a uniform spacing fit.
 */
function resampleBudgetError(
  sp: number,
  table: PolylineArcTable,
  tables: readonly PolylineArcTable[],
  totalLength: number,
  fielded: boolean,
): Error {
  const fit = totalLength / Math.max(1, MAX_RESAMPLE_POINTS - tables.length);
  if (!fielded) {
    return new Error(
      `pathResample: spacing ${sp} would place more than ${MAX_RESAMPLE_POINTS} samples over the input's ${tables.length} path(s), whose total length is ${totalLength}; use spacing >= ${fit}, or switch mode to 'count'`,
    );
  }
  return new Error(
    `pathResample: the "spacing" field resolved to ${sp} on the path at primitive ${table.prim} (length ${table.length}), and the resolved spacings would place more than ${MAX_RESAMPLE_POINTS} samples over the input's ${tables.length} path(s), whose total length is ${totalLength}. The cap is on the TOTAL, not on one path: the field is read once per path and the samples are counted as they are placed, so this is the path the running total ran out on rather than necessarily the coarsest offender. A field is not range-checked the way a plain value is — a schema's min binds a number, and a field is a recipe with no number to check until it lands on a domain — so bound the expression itself: max(<the spacing field>, ${fit}) fits the whole input even if every path takes it. Or switch mode to 'count', whose output size is a number you typed.`,
  );
}

/** Even arc-length resampling of each polyline primitive. */
export const pathResample = standardNode<PathResampleParams>({
  type: "pathResample",
  category: "sampler",
  description:
    "Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed. Unlike splineSample, each polyline is resampled on its own arc length rather than as one concatenated curve, so a graph with several paths keeps them separate. mode 'count' places exactly `count` samples per path (endpoints included on an open path; a closed path divides its length without duplicating the start). mode 'spacing' steps every `spacing` world units, keeping that step exact rather than stretching it to fit: an open path always ends on its true endpoint, so it never comes back shorter than it went in, and a closed path closes with a REMAINDER segment at the seam that is shorter than `spacing` (use 'count' to divide a loop evenly — see the `spacing` param). Output points are new: they carry the standard point-cloud attributes plus the unit segment `tangent` (f32 tuple 3) and `curveU` (f32, normalized position within that path), and the input's point attributes are NOT carried across. Its PRIMITIVE attributes ARE, in both directions: every attribute of the polyline a sample came from lands on that sample, and each output polyline keeps the attributes of the input polyline it replaces (output primitive i resamples input polyline i and nothing else), so a road resampled here comes back still a road rather than a nameless polyline. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes (P, tangent, curveU, seed, ...) is refused with an error naming the attribute and the fix. TWO OPT-IN REPORTS publish what the resampling already computed, so anything sized in units of the sampling can be stated as a multiple of it instead of retyped as a literal that the count knob then invalidates: `lengthAttr` writes each path's TRUE ARC LENGTH and `stepAttr` the distance between its samples, both on the PRIMITIVE domain because both are facts about a PATH. Both are empty by default and the output is byte-identical to a cook without them. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a resampled path that passes through one stops being a path. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.",
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
      acceptsField: true,
      description:
        `Distance between samples in world units when mode is 'spacing'. The step is EXACT and is never stretched to make the samples come out even, so a CLOSED path ends on a REMAINDER: the last sample sits at floor(length / spacing) * spacing and the segment from it back to the start is SHORTER than \`spacing\` — a 43-unit loop at spacing 5 gets 9 samples and closes with a 3-unit segment at the seam. That remainder is whatever the loop's length leaves over, anywhere from a hair above 0 to just under \`spacing\`. To divide a loop EVENLY, switch mode to 'count': it splits the length into \`count\` equal steps and has no seam segment. An open path is the same story at its far end — it always lands on its true endpoint, so its last segment is short in the same way. Must be > 0, small enough to leave at least 2 samples on each open path (3 on a closed one), and large enough that the whole input stays under ${MAX_RESAMPLE_POINTS} samples. Ignored in 'count' mode. AS A FIELD IT IS ONE SPACING PER PATH, resolved on the INPUT's PRIMITIVE domain: a wide road and a footpath in one geometry take different steps in ONE COOK, each path's count following its own value against its own arc length. That is why this param can be a field where splineSample's spacing cannot — this node resamples every polyline ON ITS OWN ARC LENGTH, so there is a primitive element to read one value per, while splineSample concatenates every polyline into ONE curve and reads its spacing exactly once, against no element at all. The field sees the PRIMITIVE domain, so what it can read is what a path carries: a primitive attribute (written with setAttribute domain 'primitive', or carried up from the points with promoteAttribute point → primitive), index() and fraction() over the paths, randomField(), and nodeSeed(). A POINT attribute is not in scope there, and position() is not either — a path has no one position. Both limits stay, and they are enforced differently on purpose. The MINIMUM is PER PATH: a path whose own resolved spacing is too coarse to leave 2 samples (3 when closed) is REFUSED, naming that primitive and the spacing it resolved to — never quietly dropped from the output, since a path missing from an otherwise fine-looking cook is the plausible failure this library exists to refuse. The BUDGET is on the TOTAL: samples are counted as they are placed, across every path in primitive order, and the cook is refused as soon as they add up past ${MAX_RESAMPLE_POINTS} — a per-path cap would pass ten paths of 200 000 samples each. A field is not range-checked the way a plain value is (a schema's min binds a number, not a recipe), so bound the expression itself — max(<expr>, <the smallest step you meant>) — and note that a NaN or infinite spacing is refused rather than read as a meaning.`,
    },
    lengthAttr: {
      type: "string",
      default: "",
      description:
        "Name of an f32 PRIMITIVE attribute receiving each path's TRUE ARC LENGTH in world units — the sum of its input polyline's segment lengths. Empty (the default) writes none. This is the number the graph cannot otherwise know: the straight-line span between a curve's endpoints is SHORTER than the curve, and no field can walk a polyline's vertices to find the difference, so a size derived from the length is authored today as a literal measured by hand elsewhere. It lands on the PRIMITIVE domain because a length is a fact about a PATH, one per path, exactly like `connectPoints.lengthAttr`; promote it (promoteAttribute, primitive to point) for a field to read per sample, or filter on it with filterPrimitivesByAttribute. The length reported is the INPUT polyline's, not the polyline through the new samples: a coarse resample of a curve cuts corners and comes back shorter, and reporting that would report the approximation rather than the curve — it is also what makes `stepAttr` times the divisions equal it exactly. The shape is this node's to pick (f32, tuple 1), so a name arriving on the output's primitive domain under a DIFFERENT shape is REFUSED rather than deleted and re-added; a same-shape column is RESET, which is what keeps resampling a resampled path under the same name ordinary.",
    },
    stepAttr: {
      type: "string",
      default: "",
      description:
        "Name of an f32 PRIMITIVE attribute receiving the ARC-LENGTH STEP between consecutive samples on that path. Empty (the default) writes none. Per path and so on the PRIMITIVE domain for the same reason as `lengthAttr`: in 'count' mode the step is that path's OWN length divided by its divisions (length / (count - 1) on an open path, length / count on a closed one, the divisor that leaves no duplicate at the seam), so two paths of different lengths get different steps and neither varies from sample to sample. In 'spacing' mode it reports `spacing` itself, unchanged — or, when `spacing` is a field, that path's OWN resolved value, which is the same statement once the param is read per path — not a tautology but the point of reporting it at all: a downstream size written as a multiple of this attribute follows the sampling when the mode or the knob changes under it, instead of silently meaning something else. Note that in 'spacing' mode the LAST step is the remainder described under `spacing` and is SHORTER than the value reported here; this is the step the node takes, not what the path had left over. Same reporting-slot rule as `lengthAttr`, and the two params may not name the same attribute — the second write would overwrite the first with no complaint, since the shapes agree.",
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
    // A PLAIN spacing is still checked here, before the geometry is even
    // looked at: a param error reported as "no polyline primitives" sends
    // the author to debug topology. A FIELD has no number to check yet —
    // its values arrive per path below, and each one is checked there.
    const scalarSpacing = typeof params.spacing === "number" ? params.spacing : undefined;
    if (params.mode === "spacing" && scalarSpacing !== undefined && !(scalarSpacing > 0)) {
      throw new Error(`pathResample: spacing must be > 0 in 'spacing' mode, got ${scalarSpacing}`);
    }
    // Both reports are f32 tuple 1, so a shared name passes the shape
    // check and the second write silently replaces the first — the same
    // reason writeCurveFrame refuses two of its three names being equal.
    if (params.lengthAttr !== "" && params.lengthAttr === params.stepAttr) {
      throw new Error(
        `pathResample: params "lengthAttr" and "stepAttr" are both "${params.lengthAttr}"; a length and a step are two values and need two attributes, or the step would overwrite the length`,
      );
    }
    const geo = requireGeometry(inputs, "in", "pathResample");
    // Against the INPUT first, where a refusal costs nothing: its
    // primitive columns are the ones carried onto the output, so this
    // catches every collision except a `primtype` the input lacks.
    requireResampleReports(geo.attrs.primitive, params, "input");
    const tables = polylineArcTables(geo, "pathResample");
    // Only needed to name a spacing that would fit the budget below.
    const totalLength = tables.reduce((sum, table) => sum + table.length, 0);
    // Resolved ONCE, before the walk, and only in the mode that reads it:
    // 'count' ignores `spacing` entirely, so evaluating a field there would
    // let a param the mode never reads fail the cook. `undefined` means the
    // scalar path, which keeps its f64 number rather than the f32 a column
    // would round it to — a plain spacing must cook byte-identically to
    // what it always did.
    const spacings =
      params.mode === "spacing" && scalarSpacing === undefined
        ? resampleSpacingColumn(geo, params.spacing, seed)
        : undefined;

    // Arc-length positions per path, validated before anything is built.
    const perPath: number[][] = [];
    // The step each path was sampled at, taken from the same expression
    // that placed the samples rather than measured back off them — see
    // `stepAttr`. Always computed: it is one division per path, and a
    // number the node needs anyway to have placed anything.
    const steps: number[] = [];
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
        // The same division, so the reported step IS positions[1] to the
        // bit: `1 * L` is `L`. Recovering it as a difference of two
        // positions instead would report a number the sampling never used.
        steps.push(L / denom);
      } else {
        // One value per PATH: the column is over the input's primitive
        // domain, and `table.prim` is this path's index in it.
        const sp = spacings === undefined ? (scalarSpacing as number) : spacings.data[table.prim];
        if (spacings !== undefined && !(sp > 0)) {
          // Only a field reaches here — a plain spacing was checked before
          // the geometry was read. Per path, and refused rather than
          // skipped: dropping the path would return a cook that looks fine
          // and is missing a road.
          throw new Error(
            `pathResample: the "spacing" field resolved to ${sp} on the ${kind} path at primitive ${table.prim}, but every path's spacing must be > 0 — a step of 0 or less places no samples, and this node refuses the cook rather than dropping that path from the output. Bound the expression with max(<the spacing field>, <the smallest step you meant>), or switch mode to 'count'.`,
          );
        }
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
          // `total` is the samples every EARLIER path already claimed, so
          // this is a running check against the global cap and not a
          // per-path one — see resampleBudgetError. It also lives inside
          // the placing loop on purpose: a spacing of 1e-9 must be refused
          // in a million steps rather than counted out to the end first.
          if (total + positions.length >= MAX_RESAMPLE_POINTS) {
            throw resampleBudgetError(sp, table, tables, totalLength, spacings !== undefined);
          }
          positions.push(s);
        }
        if (!table.closed) positions.push(L);
        if (positions.length < least) {
          throw new Error(
            spacings === undefined
              ? `pathResample: spacing ${sp} leaves ${positions.length} sample(s) on the ${kind} path at primitive ${table.prim} (length ${L}), fewer than the ${least} a path needs; use spacing <= ${L / least} or switch mode to 'count'`
              : `pathResample: the "spacing" field resolved to ${sp} on the ${kind} path at primitive ${table.prim} (length ${L}), which leaves ${positions.length} sample(s) — fewer than the ${least} a path needs. The minimum is PER PATH, and a path too coarse for its own spacing is refused rather than dropped from the output: give that path a spacing <= ${L / least}, for instance by bounding the field with min(<the spacing field>, ${L / least}), or switch mode to 'count'.`,
          );
        }
        // The step this mode takes is the one the author typed, on every
        // path. The short LAST step — the seam remainder on a closed path,
        // the run to the true endpoint on an open one — is deliberately
        // not what is reported; see `stepAttr`.
        steps.push(sp);
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

    // The reports go LAST, after the carry, and the order is load-bearing:
    // resampling a resampled path under the SAME lengthAttr must RESET the
    // previous run's column, which is what `replace` does to a column of
    // the same shape. Written before the carry it would instead collide
    // with itself and be refused, and re-running a node over its own
    // output has to stay ordinary. The general shape check runs again here
    // because this is the domain actually written — the early one saw the
    // input's. Marked "output" so the refusal names THIS domain: the only
    // collision that reaches here is `primtype`, which setPolylineTopology
    // stamped above and which the input may never have had, so the
    // input-side advice would send an author after a column that is not
    // there.
    requireResampleReports(out.attrs.primitive, params, "output");
    if (params.lengthAttr !== "") {
      const data = out.attrs.primitive.replace(params.lengthAttr, "f32", 1, 0).data;
      // Output primitive `ti` resamples `tables[ti]` and nothing else, the
      // same 1:1 the primitive carry above relies on.
      for (let ti = 0; ti < tables.length; ti++) data[ti] = tables[ti].length;
    }
    if (params.stepAttr !== "") {
      const data = out.attrs.primitive.replace(params.stepAttr, "f32", 1, 0).data;
      for (let ti = 0; ti < tables.length; ti++) data[ti] = steps[ti];
    }
    return { out: [makeGeometryItem(out)] };
  },
});

/** Params of {@link pathSegments}. */
export interface PathSegmentsParams {
  axis: string;
  radius: FieldParam;
  extend: FieldParam;
  segmentIndexAttr: string;
}

/** One oriented instance point per polyline segment. */
export const pathSegments = standardNode<PathSegmentsParams>({
  type: "pathSegments",
  category: "sampler",
  description:
    "Emits ONE POINT PER SEGMENT of every polyline primitive, placed and oriented so that spawning a unit-sized asset on it draws the path as solid geometry. This is the DISCRETE way to draw a curve: one asset per segment, which is what a chain of separate links, a row of sleepers or a string of beads is. For a continuous skin use sweepProfile instead — it emits a real triangle mesh, shares rings between segments, and needs no `extend` because it leaves no gap to fill. Each output point sits at its segment's MIDPOINT, with `rot` turning the chosen local `axis` onto the segment direction and `scale` holding the segment's length on that axis and `radius` on the other two — so a unit cylinder (height 1, radius 1) lands exactly on the segment. Also writes the unit `tangent` (f32 tuple 3, the segment direction), `curveU` (f32, the midpoint's normalized position along that path) and `seed`; the input's POINT attributes are not carried, its PRIMITIVE attributes are. An opt-in `segmentIndexAttr` adds the segment's 0-based index WITHIN ITS OWN PATH, which is otherwise unrecoverable here — a point attribute written upstream does not survive this node, and `curveU` is a fraction that needs the count back to become an index. It is empty by default and the output is byte-identical to a cook without it. The default axis is '+y', deliberately unlike orientAlongVector's '+z': the assets this feeds are cylinders and capsules, which are built along Y in three.js, whereas orientAlongVector points props at a heading. Roll around the segment is fixed by an up hint of [0, 1, 0] with the same deterministic fallbacks orientAlongVector uses ([0, 0, 1], then [1, 0, 0]) — a tube is rotationally symmetric so the roll is arbitrary, but it is never random; when it MATTERS (alternating chain links), re-orient downstream with orientAlongVector reading the `tangent` this node wrote. Segments of zero length are SKIPPED rather than emitted as degenerate instances, so the output can hold fewer points than the input had segments. THE OUTPUT IS A PLAIN CLOUD, not a path: the points are segment midpoints, not the curve, and no polyline topology is built over them — resampling or re-pathing this output describes the midpoints, not the original curve, so branch off the path itself for that. Closed paths need nothing special: their closing segment is a segment like any other.",
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
      acceptsField: true,
      description:
        "World units added to BOTH ends of every segment (the length on the axis becomes segment + 2 * extend; the midpoint does not move). This is the joint filler: consecutive segments meeting at a bend leave a wedge-shaped gap on the outside of the corner, and overlapping them closes it. About one radius is enough down to right-angle bends. Costs nothing but overlap, and with a capsule asset the rounded caps hide the seam entirely. Field-capable, and it resolves EXACTLY WHERE `radius` DOES — on the INPUT points (the path's own points, since the segments this node emits have no domain yet), then AVERAGED over the two points a segment runs between — so it is one filler PER SEGMENT and the two params take the same expression: a taper that thins the tube thins its joints with it, and 'about one radius' becomes a fill that follows the radius instead of a literal that stops matching the moment the radius moves. It follows that a field here reads what the input POINTS carry; a per-path extend living on the PRIMITIVE domain has to be promoted onto the points first (promoteAttribute, primitive to point), the same route `radius` documents. A PLAIN value must be finite and >= 0 and is refused otherwise. A FIELD's negative value is clamped to 0 per segment, exactly as `radius` is — a filler is a length, and a negative one would shorten the segment away from its own endpoints — while a NaN or infinite one is refused, naming this param.",
    },
    segmentIndexAttr: {
      type: "string",
      default: "",
      description:
        "Name of an i32 POINT attribute receiving each segment's 0-BASED INDEX WITHIN ITS OWN PATH, restarting at 0 for every polyline. Empty (the default) writes none. It is the per-path coordinate this node otherwise has no way to state: `curveU` is a fraction, and turning one back into an index needs the segment count again, while an index written upstream with setAttribute does not survive — this node emits a NEW point per segment and carries no point attributes. Without it, 'every other link of THIS chain' has to be spelled on the GLOBAL point index, which agrees with the per-path one only while every path has the same, EVEN, number of segments, and nothing reports when that stops being true. It counts the segments this node EMITTED, so a skipped zero-length segment leaves NO GAP and an alternation over it (index - 2 * floor(index / 2)) keeps its parity through a degenerate path; an index into the input's segment list would not, and would also address elements that are not in this output. The shape is this node's to pick (i32, tuple 1), so a name already among the columns written here — P, rot, scale, density, boundsMin, boundsMax, color, seed, tangent, curveU — under a DIFFERENT shape is REFUSED rather than deleted and re-added, and a carried PRIMITIVE attribute of the same name is refused too, with the fix.",
    },
  },
  // `radius` and `extend` may both resolve on the GPU. Both are evaluated
  // on the INPUT geometry, which this node never mutates (it builds a
  // fresh cloud), so the resolver and the CPU fallback see identical
  // bytes.
  gpu: "fields",
  async execute({ inputs, params, seed, gpu, checkCancelled }) {
    const axis = params.axis;
    if (!(ORIENT_AXES as readonly string[]).includes(axis)) {
      throw new Error(
        `pathSegments: param "axis" must be one of ${ORIENT_AXES.join(", ")}; got "${axis}"`,
      );
    }
    // A PLAIN extend is checked here, before the geometry is read, exactly
    // as it always was. A FIELD has no number to check yet — it resolves
    // per point below, where a negative value clamps and a non-finite one
    // is refused by the guarded resolve.
    const scalarExtend = typeof params.extend === "number" ? params.extend : undefined;
    if (scalarExtend !== undefined && (!Number.isFinite(scalarExtend) || scalarExtend < 0)) {
      throw new Error(
        `pathSegments: param "extend" must be a finite number >= 0, got ${scalarExtend}`,
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
    // Resolved once, before the walk, and only when it is a field: a plain
    // extend keeps its f64 number rather than the f32 a column would round
    // it to, so the scalar path cooks byte-identically to what it did
    // before this param took a field.
    const extend =
      scalarExtend === undefined
        ? requireTuple(
            await resolveOnMaybeGpu(gpu, geo, "point", params.extend, seed, "pathSegments", "extend"),
            [1],
            "pathSegments",
            "extend",
          )
        : undefined;

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
    // The opt-in per-path index, checked the moment the columns it must
    // not destroy exist. There is no earlier point that knows them: this
    // node builds a FRESH cloud rather than cloning, so the domain the
    // slot lands on is one it has just declared itself, and the input's
    // point attributes — which never reach the output — are the wrong
    // thing to check against. Before the fill loop and before the
    // primitive carry, so it still costs no work that matters.
    let segmentIndex: Int32Array | undefined;
    if (params.segmentIndexAttr !== "") {
      requireReportSlot({
        attrs: out.attrs.point,
        nodeType: "pathSegments",
        param: "segmentIndexAttr",
        name: params.segmentIndexAttr,
        type: "i32",
        tupleSize: 1,
        domain: "point",
        suggestion: "segmentIndex",
        // `out` is this node's own fresh cloud, so the refusal must name
        // it: the input's `P` never reaches here, and "remove it from the
        // input" would be advice about the wrong geometry.
        on: "output",
      });
      segmentIndex = out.attrs.point.replace(params.segmentIndexAttr, "i32", 1, 0).data;
    }
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
      // Where this path's run of output points begins. `w` only advances
      // for a segment that was actually emitted, so `w - pathStart` is a
      // DENSE 0-based index within the path — see `segmentIndexAttr` for
      // why a skipped degenerate segment must not leave a hole in it.
      const pathStart = w;
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
        // `extend` is averaged over the same two endpoints as `radius`, so
        // one expression drives both and a joint filler follows the tube it
        // fills. A plain value skips the column entirely (see above).
        const e =
          extend === undefined
            ? (scalarExtend as number)
            : Math.max(0, (extend.data[pts[k]] + extend.data[pts[k + 1]]) * 0.5);
        scale[w * 3 + lengthComp] = len + 2 * e;
        seeds[w] = hashCombine(seed, w);
        samplePrim[w] = table.prim;
        if (segmentIndex) segmentIndex[w] = w - pathStart;
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

/** Params of {@link pathScan}. */
export interface PathScanParams {
  name: string;
  outName: string;
  reduce: string;
  mode: string;
  totalAttr: string;
}

/** A running fold along a path, in walk order. */
export const pathScan = standardNode<PathScanParams>({
  type: "pathScan",
  category: "attribute",
  description:
    "Writes a RUNNING FOLD of a numeric point attribute along every polyline, in the path's own walk order — by default a prefix SUM, the accumulating counterpart to attributeReduce's collapse, and under `reduce` a running minimum or maximum over that same walk instead. This is the operation a field cannot express at any length: a field resolves each element from that element alone, so 'how much of this attribute lies BEHIND me along the curve' has no formulation in the grammar, and the quantities that need it are ordinary — distance travelled, accumulated cost, an inventory that fills as the path runs, and above all a CUMULATIVE DISTRIBUTION, which is what turns a per-sample density into placements. Order is the path's, which is why this is a path node rather than a domain-wide one: a scan without an order is not defined, and a polyline is where this library keeps one. A CLOSED path scans from its seam and does not count the repeated last vertex twice, under every fold — and the skip is not merely tidiness for the folds that could absorb it. A min or a max is idempotent, so folding the seam vertex's value in a second time could not move the path's answer; but the second VISIT would also re-WRITE the seam point's own column entry, with the fold over nearly the whole path rather than with what stands behind that point, and that is wrong under all three. One rule, one set of visited points, three folds. Points in no polyline are left at the fold's IDENTITY — zero for a sum, which is what they have always read, and ±Infinity for a min or a max — and a point visited by several polylines takes the last one in primitive order, both matching writeTangents and pathRuns. NaN CONTRIBUTES NOTHING rather than poisoning everything downstream of it — zero to a sum, and no candidate to a min or a max — which matters more here than in attributeReduce: there one bad element spoils one statistic, here it would spoil the whole tail of a column. INVERSE-TRANSFORM SAMPLING, the reason the SUM exists, is then three nodes — scan a per-sample density with `totalAttr` set, divide by that total for a CDF in 0..1, and transferAttribute 'nearest' from a cloud of N evenly spaced targets in CDF space back onto the frames. Each target lands on the sample whose CDF is nearest its own, which places exactly N points in proportion to the density, with no rejection and no approximate count. THAT IDIOM IS `reduce` 'sum' AND NOTHING ELSE, and the nearest-in-CDF lookup is the part that gives it away: a distribution is accumulated MASS, and a running extreme accumulates none — it opens at the first value rather than at zero and moves only where a record is set, so the buckets it lays out have width only at the samples that beat the record and ZERO width everywhere else. Evenly spaced targets in that space land on the records and nowhere else, which is not sampling in proportion to anything. WHAT THE OTHER FOLDS ARE FOR is the GROUPED REDUCTION the library otherwise cannot spell: pointsToPath with a `groupAttr` cuts a cloud into one path per group, `reduce` 'max' with `totalAttr` set writes each group's maximum onto the primitive domain, and promoteAttribute (primitive to point) hands it back to every point of its own group. attributeReduce has min and max but collapses a WHOLE domain onto the detail domain and cannot group, so 'the largest value in each group, on every member of that group' had no expression at all before this param and came out as a hand-written loop in whatever host needed it.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description:
        "Numeric POINT attribute to fold (f32/i32/u32/bool, tuple 1..4). Must exist. Tuples fold COMPONENTWISE, each component its own independent running value — which under `reduce` 'min' or 'max' means a per-component extreme and not the tuple that happened to hold the smallest component: comparing tuples would need an order on tuples, and there is none that is not an arbitrary choice made on the caller's behalf.",
    },
    outName: {
      type: "string",
      default: "scan",
      description:
        "POINT attribute receiving the running value (f32, at the source's tuple size). Must differ from `name`: scanning in place would read back values this node had already overwritten, so every element after the first would fold in this node's own output instead of its input. 'P' is refused outright. Same reporting-slot rule as the rest of the library — a column of a different shape under this name is refused rather than deleted and re-added, and a same-shape one is reset. f32 whatever `reduce` is, and that is not a limitation for a min or a max: an extreme is one of the values that were handed in, never a combination of two, so it survives the trip at the same precision a sum's inputs did — and f32 carries the ±Infinity a path that has folded in nothing yet reads.",
    },
    reduce: {
      type: "enum",
      default: "sum",
      enum: ["sum", "min", "max"],
      description:
        "WHAT THE ACCUMULATOR IS. 'sum' (the default, and everything this node did before this param existed) adds the values along a path; 'min' and 'max' keep the smallest or largest seen so far instead. Nothing else moves — `mode`, `totalAttr`, the walk order, the seam rule and componentwise tuple handling are the same scan, because a running minimum differs from a prefix sum only in the fold, and the fold was never the hard part: the ORDER is, and a polyline is where this library keeps one. EACH PATH OPENS ON ITS FOLD'S IDENTITY: 0 for a sum, +Infinity for a min, -Infinity for a max — attributeReduce's answer over an empty domain, and the same answer for the same reason. In 'exclusive' mode a path's FIRST point reads exactly that, since by definition its own value is not in its own total, so a min there reads +Infinity and a max -Infinity. That is the honest answer rather than a sentinel to remember: the minimum of no values IS +Infinity — it is the only x for which min(x, v) = v — the output column is f32 and represents both infinities exactly, and unlike a sum's 0 it can never be mistaken for a measurement, so `isFinite` on the column is a usable test for 'nothing has been folded in here' — which covers a path's first point in 'exclusive' AND a point on no polyline at all, the two elements that have nothing behind them — that a sum can never offer. Answering 0 instead would make an empty min compare TIGHTER than every real value, which is precisely the false positive a threshold rule cannot survive. NaN IS SKIPPED, not propagated — the rule the sum already had, kept: both `<` and `>` are false against a NaN, so an unmeasurable value simply never becomes the record, and one bad sample costs its own point instead of the whole tail of the column. A PATH OF ONE POINT is degenerate rather than unreachable — a polyline needs two vertices, but a CLOSED one whose two vertices are the same point walks exactly one — and it reads the identity in 'exclusive' and its own value in 'inclusive', which is the sum's 0-and-v said in the other monoid, since min(+Infinity, v) is v. THE COMPARISON IS SIGNED, never a magnitude: a max over -5 and -1 is -1. WHAT `mode` COSTS DIFFERS BY FOLD: for a sum the two modes differ at a point BY THAT POINT'S OWN VALUE, so they part company almost everywhere and agree only where the value is zero (or a NaN, which contributes zero); for a min or a max they differ only at the points that SET A NEW RECORD, because an extreme is idempotent and the running value therefore moves one way and then stays. IT IS A PARAM AND NOT A SECOND NODE for the reason pathRuns' `reduce` is one: 'the largest width so far along this lap' and 'the width so far along this lap' are one query asked twice, and this is that same param over a whole path where pathRuns spells it over segmented runs — one vocabulary, one identity, one NaN rule, so a graph that folds a minimum between markers and one that folds it along the whole path do not have to be read two different ways.",
    },
    mode: {
      type: "enum",
      default: "inclusive",
      enum: ["inclusive", "exclusive"],
      description:
        "Whether a point's own value is part of its own running value. 'inclusive' ends the last point of a path on the path's whole fold; 'exclusive' starts the first point at the `reduce` fold's identity — zero for a sum, which is the one that makes a CDF whose first bucket is reachable, and ±Infinity for a min or a max, which is what 'the smallest thing strictly behind me' means when there is nothing behind me yet. Neither is more correct — pick by which end you need exact.",
    },
    totalAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN REPORT: name of an f32 PRIMITIVE attribute receiving each path's WHOLE FOLD — its total under `reduce` 'sum', its minimum under 'min', its maximum under 'max' — the number both modes are heading for. Empty (the default) writes none and the output is byte-identical to a cook without it. On the PRIMITIVE domain because a fold is a fact about a PATH, exactly as pathResample's `lengthAttr` is; promote it (promoteAttribute, primitive to point) for a field to read it per sample, which is what normalizing a scan into a 0..1 CDF needs — and, with a `groupAttr` on the pointsToPath upstream, what makes this node the library's GROUPED REDUCTION: one path per group, that group's fold on its primitive, promoted back onto every point of it. Promote with 'first' rather than 'average' when the fold can be an infinity: with one path per point the two agree on the value, and where a point really does sit on two paths, averaging a +Infinity against a -Infinity gives NaN where 'first' still gives a number. REPORTED IN 'exclusive' MODE TOO, where a sum's total is otherwise unrecoverable from the column because no point holds it. Under a min or a max that sentence is nearly true, and the exception is the dangerous half: the last point's exclusive value IS the whole fold unless the last point is the one that set the record, and nothing in the column says which case you are in — so the report is the answer that is right every time rather than usually, which is a stronger reason to ask for it than the sum ever had. Primitives that are not polylines are left at the identity like any unwritten element, so a mesh in the same geometry reads the fold over no points rather than a zero that would beat every real minimum. May not name the same attribute as `outName` — a different domain, but one name, which is a coincidence worth refusing rather than explaining downstream.",
    },
  },
  execute({ inputs, params }) {
    // Params before geometry: a bad name reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    const { name, outName, totalAttr } = params;
    if (name === "") {
      throw new Error(
        'pathScan: param "name" must be a non-empty attribute name; it is the point attribute to accumulate',
      );
    }
    if (outName === "") {
      throw new Error(
        'pathScan: param "outName" must be a non-empty attribute name; the default is "scan"',
      );
    }
    if (outName === "P") {
      throw new Error(
        'pathScan: param "outName" cannot be "P" — that would overwrite the positions the path is walked along; use "scan" or another name',
      );
    }
    if (outName === name) {
      throw new Error(
        `pathScan: params "name" and "outName" are both "${name}"; a scan cannot be written over its own source, because every element after the first would fold in the running values this node had already written rather than the values it was given`,
      );
    }
    if (totalAttr !== "" && totalAttr === outName) {
      throw new Error(
        `pathScan: params "outName" and "totalAttr" are both "${totalAttr}"; they are different domains but one name, which is a coincidence worth refusing rather than explaining downstream`,
      );
    }
    const src = requireGeometry(inputs, "in", "pathScan");
    const attr = src.attrs.point.get(name);
    if (!attr) {
      throw new Error(
        `pathScan: point attribute "${name}" not found; available: ${src.attrs.point.names().join(", ") || "(none)"}`,
      );
    }
    if (attr.type === "string") {
      throw new Error(
        `pathScan: attribute "${name}" is a string attribute and cannot be accumulated; scan a numeric attribute (f32/i32/u32/bool)`,
      );
    }
    if (attr.tupleSize > 4) {
      throw new Error(
        `pathScan: attribute "${name}" has tupleSize ${attr.tupleSize}; scanning supports tuple sizes 1 to 4`,
      );
    }
    const ts = attr.tupleSize;
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "pathScan",
      param: "outName",
      name: outName,
      type: "f32",
      tupleSize: ts,
      domain: "point",
      suggestion: "scan",
    });
    if (totalAttr !== "") {
      requireReportSlot({
        attrs: src.attrs.primitive,
        nodeType: "pathScan",
        param: "totalAttr",
        name: totalAttr,
        type: "f32",
        tupleSize: ts,
        domain: "primitive",
        suggestion: "scanTotal",
      });
    }

    const geo = cloneGeometry(src);
    // `polylineWalks`, not `polylineArcTables`: a scan reads no distance,
    // and the full table allocates four Float64Arrays per path and takes a
    // square root per segment to produce numbers this node never touches.
    const walks = polylineWalks(geo, "pathScan");
    const sd = geo.attrs.point.require(name).data;
    const exclusive = params.mode === "exclusive";
    const takeMin = params.reduce === "min";
    const takeMax = params.reduce === "max";
    // Hoisted so the fold below is one loop-invariant test on the sum
    // path rather than two: sum is the default and must stay exactly the
    // arithmetic this node has always done.
    const extreme = takeMin || takeMax;
    // Every path opens on its fold's IDENTITY, and so do both output
    // columns, so an element nothing wrote — a point in no polyline, a
    // primitive that is not one — reads the reduction over no values at
    // all: 0 for a sum (what it has always read), +Infinity for a min,
    // -Infinity for a max, which is attributeReduce's answer over an
    // empty domain. f32 carries both infinities exactly, so this is a
    // real value rather than a sentinel the caller has to remember, and
    // it is the one answer that cannot be confused with a measurement.
    const identity = takeMin
      ? Number.POSITIVE_INFINITY
      : takeMax
        ? Number.NEGATIVE_INFINITY
        : 0;
    const start = new Array<number>(ts).fill(identity);
    const out = geo.attrs.point.replace(outName, "f32", ts, start).data;
    const totals =
      totalAttr === "" ? null : geo.attrs.primitive.replace(totalAttr, "f32", ts, start);
    // Accumulate in f64 whatever the source type, so a long f32 sum does
    // not lose its tail — the same reason attributeReduce does. A min or
    // a max needs none of that (it COPIES one of the values it was handed
    // rather than combining two, so it is exact in any width that holds
    // the source) and loses nothing by sharing the same slab.
    const acc = new Float64Array(4);
    // The mode is decided once for the node, so it picks the loop rather
    // than being re-tested per component of per point.
    for (const walk of walks) {
      const pts = walk.points;
      // A closed path repeats its first point as its last vertex; that
      // repeat is the closure, not a value to fold a second time. The
      // skip stays under every `reduce` even though an extreme would
      // absorb the second contribution unchanged: the second VISIT also
      // re-writes the seam point's own column entry, with the fold over
      // nearly the whole path instead of with what stands behind it.
      const m = walk.closed ? pts.length - 1 : pts.length;
      acc.fill(identity);
      if (exclusive) {
        for (let k = 0; k < m; k++) {
          const o = pts[k] * ts;
          for (let c = 0; c < ts; c++) {
            const v = sd[o + c];
            out[o + c] = acc[c];
            // The fold. NaN contributes nothing rather than propagating,
            // in both forms: `v === v` is the NaN test that does not
            // depend on argument coercion, and for an extreme the
            // comparison IS that test, since `<` and `>` are both false
            // against a NaN and it therefore never becomes the record.
            if (!extreme) {
              if (v === v) acc[c] += v;
            } else if (takeMin) {
              if (v < acc[c]) acc[c] = v;
            } else if (v > acc[c]) acc[c] = v;
          }
        }
      } else {
        for (let k = 0; k < m; k++) {
          const o = pts[k] * ts;
          for (let c = 0; c < ts; c++) {
            const v = sd[o + c];
            if (!extreme) {
              if (v === v) acc[c] += v;
            } else if (takeMin) {
              if (v < acc[c]) acc[c] = v;
            } else if (v > acc[c]) acc[c] = v;
            out[o + c] = acc[c];
          }
        }
      }
      if (totals) {
        const t = walk.prim * ts;
        for (let c = 0; c < ts; c++) totals.data[t + c] = acc[c];
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

/** Params of {@link pathRuns}. */
export interface PathRunsParams {
  name: string;
  boundary: string;
  outName: string;
  reduce: string;
  mode: string;
  direction: string;
  wrap: boolean;
}

/** A running total WITHIN each run of a path, reset at flagged points. */
export const pathRuns = standardNode<PathRunsParams>({
  type: "pathRuns",
  category: "attribute",
  description:
    "Writes a SEGMENTED running total of a numeric point attribute along every polyline: like pathScan, except the accumulator RESETS at points a boolean attribute flags, and on a closed path a run may cross the seam. `reduce` picks WHAT the accumulator is — a sum (the default), a running minimum or a running maximum over the same runs — because a segmented minimum is this same walk with a different fold, and the walk is the part that was hard. This is what answers 'how far since the last marker' and 'how far to the next one' — the two queries a prefix sum cannot express. pathScan accumulates monotonically from the seam and never resets, so emulating a segmented scan from it means subtracting the scan value at the most recent flagged point BEHIND you, and obtaining that value is itself a backward look-up along the path, which no field can perform: a field resolves each element from that element alone. This is the missing primitive, and wrapping is a property it needs rather than the whole of what was missing. IT ACCUMULATES A VALUE, NOT A COUNT, which is the whole ergonomic difference: scan a per-segment length for distance, a per-sample cost for cost, or a constant 1 for the vertex count, and one node covers all three. RUNS ARE HALF-OPEN AND ORIENTED. Forward, a run begins at a flagged point (inclusive) and continues until the next flagged point (exclusive), accumulating in the path's walk order; backward, a run ENDS at a flagged point (inclusive) and extends back to just after the previous one, accumulating against the walk order. Both exist because they answer different questions — 'distance since the corner behind me' is the forward run and 'distance to the corner ahead' is the backward one — and neither is recoverable from the other without knowing each run's total. THE SEAM IS NOT A BOUNDARY unless something flags it. On a CLOSED path with `wrap` on, the walk starts at the first flagged point rather than at vertex zero, so the run that straddles the start/finish line is one run and not two; that is the case a lap actually has, and a backward segmented scan built on an unwrapped prefix sum gets it wrong every time. A closed path with wrap on and NO flagged point anywhere has no place for a cyclic run to begin, so the seam stands in and the result is what `wrap` off would give. On an OPEN path `wrap` does nothing. Points in no polyline are left at the fold's IDENTITY — zero for a sum, which is what they have always read, and ±Infinity for a min or a max — and a point visited by several polylines takes the last one in primitive order, both matching pathScan and writeTangents. NaN CONTRIBUTES NOTHING rather than poisoning the rest of its run: zero to a sum, and no candidate to a min or a max. A NaN in the BOUNDARY column is not a boundary either — a column that could not be measured must not silently cut every run in the path.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    name: {
      type: "string",
      default: "density",
      description:
        "Numeric POINT attribute to accumulate (f32/i32/u32/bool, tuple 1..4). Must exist. Tuples accumulate componentwise, each component its own independent running total, and all of them reset together at a boundary. Scan a per-segment length here for distance, or an attribute set to a constant 1 for the count of points since the boundary.",
    },
    boundary: {
      type: "string",
      default: "boundary",
      description:
        "POINT attribute (tuple 1) whose NON-ZERO values mark where a run begins, forward, or ends, backward. Must exist. Any numeric type: a bool column is the obvious one, and an i32 marker column or an f32 written by a field works the same way, because the test is only 'is this nonzero'. NaN is NOT a boundary, deliberately: a boundary column carrying an unmeasurable value would otherwise cut every run in the path, and silently. A tuple wider than 1 is refused rather than reduced — a flag is one column, and which component would have decided is not a question this node should answer for you.",
    },
    outName: {
      type: "string",
      default: "run",
      description:
        "POINT attribute receiving the running total (f32, at the source's tuple size). Must differ from `name`: scanning in place would read back values this node had already overwritten. 'P' is refused outright. Same reporting-slot rule as the rest of the library — a column of a different shape under this name is refused rather than deleted and re-added, and a same-shape one is reset. f32 whatever `reduce` is, and that is not a limitation for a min or a max: an extreme is one of the values that were handed in, never a combination of two, so it survives the trip at the same precision a sum's inputs did — and f32 carries the ±Infinity a run that has folded in nothing yet reads.",
    },
    reduce: {
      type: "enum",
      default: "sum",
      enum: ["sum", "min", "max"],
      description:
        "WHAT THE ACCUMULATOR IS. 'sum' (the default, and everything this node did before this param existed) adds the values of a run; 'min' and 'max' keep the run's smallest or largest instead. Nothing else moves — `boundary`, `mode`, `direction`, `wrap` and componentwise tuple handling are the same walk, because a segmented minimum differs from a segmented sum only in the fold, and the fold was never the hard part: the rotation onto the first flagged point, the seam, and the reset are. IT IS A PARAM AND NOT A SECOND NODE because 'the tightest radius since this corner began' and 'the distance since this corner began' are ONE query asked twice, and the library could previously spell only the second — attributeReduce has min and max but collapses a WHOLE domain onto the detail domain and cannot group, so a grouped extreme had no expression at all and came out as a hand-written loop in whatever host needed it. EACH RUN OPENS ON ITS FOLD'S IDENTITY: 0 for a sum, +Infinity for a min, -Infinity for a max — attributeReduce's answer over an empty domain, and the same answer for the same reason. In 'exclusive' mode a run's FIRST point reads exactly that, since by definition its own value is not in its own total, so a min there reads +Infinity and a max -Infinity. That is the honest answer rather than a sentinel to remember: the minimum of no values IS +Infinity — it is the only x for which min(x, v) = v — the output column is f32 and represents both infinities exactly, and unlike a sum's 0 it can never be mistaken for a measurement, so `isFinite` on the column is a usable test for 'this run has folded in nothing yet' that a sum can never offer. Answering 0 instead would make an empty min compare TIGHTER than every real radius, which is precisely the false positive a threshold rule cannot survive. NaN IS SKIPPED, not propagated — the rule the sum already had, kept: both `<` and `>` are false against a NaN, so an unmeasurable value simply never becomes the record, and one bad sample costs its own point instead of the rest of its run. A RUN OF ONE POINT reads the identity in 'exclusive' and its own value in 'inclusive', which is the sum's 0-and-v said in the other monoid, since min(+Infinity, v) is v; a run of NO points is not observable, because a run is opened by a point. THE COMPARISON IS SIGNED, never a magnitude: a max over -5 and -1 is -1. WHAT `mode` COSTS DIFFERS BY FOLD: for a sum, 'inclusive' differs from 'exclusive' at EVERY point, by that point's own value; for a min or a max they differ only at the points that set a new record, because an extreme is idempotent and the running value therefore moves one way and then stays. `direction` IS UNAFFECTED — all three folds are commutative and associative, so over a FIXED set of points the order of traversal cannot change the answer, and what direction changes is which points form a run (half-open the other way) and where the run's answer lands, exactly as it always did.",
    },
    mode: {
      type: "enum",
      default: "exclusive",
      enum: ["inclusive", "exclusive"],
      description:
        "Whether a point's own value is part of its own running total. 'exclusive' (the default here, where pathScan defaults to 'inclusive') starts every run on its boundary point at the `reduce` fold's identity — zero for a sum, which is what 'distance since the marker' means, the marker itself being at distance zero, and ±Infinity for a min or a max, which is what 'the tightest thing strictly behind me' means when there is nothing behind me yet. 'inclusive' ends each run's last point on the run's whole total instead. Neither is more correct; pick by which end of the run you need exact.",
    },
    direction: {
      type: "enum",
      default: "forward",
      enum: ["forward", "backward"],
      description:
        "Which way the runs are oriented. 'forward' accumulates in the path's walk order, so a point reads what lies BEHIND it since the last boundary — the query a 'distance since the last corner' rule wants. 'backward' accumulates against the walk order, so a point reads what lies AHEAD of it up to the next boundary — the query a marker rule wants ('place an entry marker 3 to 6W before the corner'). The two are not each other's complement without the run's total, which is why both are built rather than one plus an instruction to reverse the path — and under `reduce` 'min' or 'max' not even WITH it, because an extreme discards everything that was not the record and no arithmetic recovers it. On a CLOSED path reversing also moves which side of the seam a run starts on, so 'reverse it yourself' is a trap exactly where wrapping matters. Note also that the two directions do not cut the path into the SAME runs: forward a flagged point opens its run and backward it closes one, so the partitions sit one point apart. That is true of every fold and is not something `reduce` changes.",
    },
    wrap: {
      type: "bool",
      default: true,
      description:
        "Whether a run may cross a CLOSED path's seam. True (the default) starts the walk at the first flagged point instead of at vertex zero, so a run straddling the start/finish line stays one run — the case a closed lap always has and the one a prefix sum cannot answer. False treats the seam as a run boundary, which is what you want when the vertex order carries meaning of its own, such as a lap whose start line IS a marker. No effect on an open path, and no effect on a closed path with nothing flagged, where there is no cyclic starting point to rotate to.",
    },
  },
  execute({ inputs, params }) {
    // Params before geometry: a bad name reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    const { name, boundary, outName } = params;
    if (name === "") {
      throw new Error(
        'pathRuns: param "name" must be a non-empty attribute name; it is the point attribute to accumulate',
      );
    }
    if (boundary === "") {
      throw new Error(
        'pathRuns: param "boundary" must be a non-empty attribute name; it is the point attribute whose nonzero values delimit the runs, and a segmented scan with no boundaries is pathScan',
      );
    }
    if (outName === "") {
      throw new Error(
        'pathRuns: param "outName" must be a non-empty attribute name; the default is "run"',
      );
    }
    if (outName === "P") {
      throw new Error(
        'pathRuns: param "outName" cannot be "P" — that would overwrite the positions the path is walked along; use "run" or another name',
      );
    }
    if (outName === name) {
      throw new Error(
        `pathRuns: params "name" and "outName" are both "${name}"; a scan cannot be written over its own source, because every element after the first would accumulate the totals this node had already written rather than the values it was given`,
      );
    }
    if (outName === boundary) {
      throw new Error(
        `pathRuns: params "boundary" and "outName" are both "${outName}"; the output would overwrite the flags that decide where the runs start, and every point after the first would be read against totals rather than against its marker`,
      );
    }
    const src = requireGeometry(inputs, "in", "pathRuns");
    const attr = src.attrs.point.get(name);
    if (!attr) {
      throw new Error(
        `pathRuns: point attribute "${name}" not found; available: ${src.attrs.point.names().join(", ") || "(none)"}`,
      );
    }
    if (attr.type === "string") {
      throw new Error(
        `pathRuns: attribute "${name}" is a string attribute and cannot be accumulated; scan a numeric attribute (f32/i32/u32/bool)`,
      );
    }
    if (attr.tupleSize > 4) {
      throw new Error(
        `pathRuns: attribute "${name}" has tupleSize ${attr.tupleSize}; scanning supports tuple sizes 1 to 4`,
      );
    }
    const bnd = src.attrs.point.get(boundary);
    if (!bnd) {
      throw new Error(
        `pathRuns: point attribute "${boundary}" not found; available: ${src.attrs.point.names().join(", ") || "(none)"}`,
      );
    }
    if (bnd.type === "string") {
      throw new Error(
        `pathRuns: boundary attribute "${boundary}" is a string attribute; a boundary is tested for being nonzero, so give it a numeric column (bool/i32/u32/f32)`,
      );
    }
    if (bnd.tupleSize !== 1) {
      throw new Error(
        `pathRuns: boundary attribute "${boundary}" has tupleSize ${bnd.tupleSize}; a boundary flag is one column, and which component would decide is not a question this node answers for you — promote or extract the component you meant first`,
      );
    }
    const ts = attr.tupleSize;
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: "pathRuns",
      param: "outName",
      name: outName,
      type: "f32",
      tupleSize: ts,
      domain: "point",
      suggestion: "run",
    });

    const geo = cloneGeometry(src);
    // `polylineWalks`, not `polylineArcTables`: a segmented scan reads no
    // distance of its own — where distance is wanted it arrives as the
    // attribute being accumulated — so the arc table's four Float64Arrays
    // and per-segment square root would all be paid for nothing.
    const walks = polylineWalks(geo, "pathRuns");
    const sd = geo.attrs.point.require(name).data;
    const bd = geo.attrs.point.require(boundary).data;
    const exclusive = params.mode === "exclusive";
    const backward = params.direction === "backward";
    const takeMin = params.reduce === "min";
    const takeMax = params.reduce === "max";
    // Hoisted so the fold below is one loop-invariant test on the sum
    // path rather than two: sum is the default and must stay exactly the
    // arithmetic this node has always done.
    const extreme = takeMin || takeMax;
    // Every run opens on its fold's IDENTITY, and so does the column, so
    // a point in no polyline reads the reduction over no values at all —
    // 0 for a sum (what it has always read), +Infinity for a min,
    // -Infinity for a max, which is attributeReduce's answer over an
    // empty domain. f32 carries both infinities exactly, so this is a
    // real value rather than a sentinel the caller has to remember, and
    // it is the one answer that cannot be confused with a measurement.
    const identity = takeMin
      ? Number.POSITIVE_INFINITY
      : takeMax
        ? Number.NEGATIVE_INFINITY
        : 0;
    const start = new Array<number>(ts).fill(identity);
    const out = geo.attrs.point.replace(outName, "f32", ts, start).data;
    // Accumulate in f64 whatever the source type, so a long f32 sum does
    // not lose its tail — the same reason attributeReduce and pathScan do.
    // A min or a max needs none of that (it COPIES one of the values it
    // was handed rather than combining two, so it is exact in any width
    // that holds the source) and loses nothing by sharing the same slab.
    const acc = new Float64Array(4);
    for (const walk of walks) {
      const pts = walk.points;
      // A closed path repeats its first point as its last vertex; that
      // repeat is the closure, not a point to visit a second time. It
      // needs no separate write either, being the same point index.
      const m = walk.closed ? pts.length - 1 : pts.length;
      // The visit order: the walk, reversed for a backward scan, and
      // rotated onto the first boundary when a closed path may wrap.
      const at = (k: number): number => pts[backward ? m - 1 - k : k];
      const flagged = (p: number): boolean => {
        const b = bd[p];
        // `b === b` rejects NaN, which is deliberately NOT a boundary.
        return b === b && b !== 0;
      };
      let rotate = 0;
      const cyclic = walk.closed && params.wrap;
      if (cyclic) {
        let found = -1;
        for (let k = 0; k < m; k++) {
          if (flagged(at(k))) {
            found = k;
            break;
          }
        }
        // Nothing flagged anywhere: a cyclic run has no place to begin,
        // so the seam stands in and this is exactly the unwrapped result.
        rotate = found < 0 ? 0 : found;
      }
      acc.fill(identity);
      for (let j = 0; j < m; j++) {
        const p = at(cyclic ? (rotate + j) % m : j);
        // The reset happens BEFORE the point is read in either mode, so a
        // boundary point opens its own run rather than closing the one
        // before it. Backward, that is the same rule read the other way:
        // the flagged point is the last of its run in walk order.
        if (flagged(p)) acc.fill(identity);
        const o = p * ts;
        if (exclusive) {
          for (let c = 0; c < ts; c++) {
            const v = sd[o + c];
            out[o + c] = acc[c];
            // The fold. NaN contributes nothing rather than propagating,
            // in both forms: `v === v` is the NaN test that does not
            // depend on argument coercion, and for an extreme the
            // comparison IS that test, since `<` and `>` are both false
            // against a NaN and it therefore never becomes the record.
            if (!extreme) {
              if (v === v) acc[c] += v;
            } else if (takeMin) {
              if (v < acc[c]) acc[c] = v;
            } else if (v > acc[c]) acc[c] = v;
          }
        } else {
          for (let c = 0; c < ts; c++) {
            const v = sd[o + c];
            if (!extreme) {
              if (v === v) acc[c] += v;
            } else if (takeMin) {
              if (v < acc[c]) acc[c] = v;
            } else if (v > acc[c]) acc[c] = v;
            out[o + c] = acc[c];
          }
        }
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
  curvatureName: string;
}

/**
 * Where along an OPEN path the TANGENT at vertex `k` was actually
 * measured, in arc length from the path's start.
 *
 * At almost every vertex that is the vertex itself: the tangent is the
 * central difference of its two neighbours, which is centred on it. The
 * exception is the two ends of an OPEN path, where there is no neighbour
 * on one side and writePolylineTangents falls back to the adjacent
 * segment's chord direction. A chord is the curve's MEAN direction over
 * that segment, so it belongs to the segment's midpoint — half a step in
 * from the end.
 *
 * Only curvature needs this, because only curvature divides by the
 * distance between two tangents. Getting it wrong is not a small error:
 * an endpoint's difference spans half a segment, so dividing it by a
 * whole one reports half the curvature the curve has.
 *
 * OPEN only. A closed path has a true central difference at every vertex
 * — including the seam, which wraps — so its divisor is just the two
 * segments meeting there, and no station subtraction could express that:
 * at the seam the next vertex's station is BEHIND the previous one's.
 */
function openTangentStation(
  cum: Float64Array,
  segLen: Float64Array,
  vertexCount: number,
  k: number,
): number {
  const last = vertexCount - 1;
  if (k === 0) return cum[0] + segLen[0] / 2;
  if (k === last) return cum[last] - segLen[last - 1] / 2;
  return cum[k];
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
    "Writes a full orthonormal frame — `tangent`, `curveNormal` and `curveBinormal` (f32 tuple 3) — at the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived. The tangent is the same central difference writeTangents writes, from the same shared code, so the three columns are guaranteed mutually perpendicular rather than nearly so. WHY IT EXISTS: orientAlongVector fixes the roll around a direction with an `up` hint, and a CONSTANT up cannot follow a curve that turns over — as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve (a radial spike, a chain link, a bracket) snaps round with it. The normal here is carried ALONG the curve instead of recomputed from a world axis: it starts perpendicular to the first tangent and is transported point to point by double reflection, which is the rotation that moves it as little as each step allows. Feed it back in as orientAlongVector's `up` — field-capable for exactly this — and the roll varies smoothly however the curve turns; combine `curveNormal` and `curveBinormal` with cos and sin of an angle to aim anything radially around the path. THE FRAME IS NOT LOCAL: a point's normal depends on every point before it along its path, so this must run BEFORE anything that splits a path across cook cells or partitions it — the same curve arriving as two pieces gets two unrelated frames. A CLOSED path does not come back seamless: transport around a loop returns rotated by a residual angle (the holonomy of that curve), so the frame either side of the seam differs, and no local rule can fix it. That is a property of closed curves rather than a defect, and it is left visible instead of smeared out. Degenerate points follow writeTangents: a point whose neighbours all coincide gets a zero tangent and is skipped by the transport, a point in several polylines takes the last one in primitive order, and unreferenced points get [0, 0, 0] on all three. AN OPT-IN FOURTH COLUMN, `curvatureName`, reports the CURVATURE VECTOR dT/ds beside the frame — how hard the curve turns, which the frame's three axes describe the orientation of but never the amount of. It is here rather than in a node of its own because it is the same central difference of the same tangents over the same arc tables, and computing it twice is how two nodes drift apart; it is opt-in because it is a different quantity from a frame, and a graph that wants only the roll should not pay for it. Local corner radius is `1 / length(attribute(\"curvature\"))`, and a signed turn is that vector dotted with whichever axis you mean by 'right'.",
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
    curvatureName: {
      type: "string",
      default: "",
      description:
        "OPT-IN REPORT: name of an f32 tuple-3 point attribute receiving the CURVATURE VECTOR dT/ds — the rate the unit tangent turns per unit of arc length, pointing toward the centre of curvature. Empty (the default) writes none and the output is byte-identical to a cook without it. A VECTOR rather than a scalar because in 3D the scalar is the incomplete answer: the magnitude is |dT/ds| = 1/R (`length(attribute(\"curvature\"))`, and the local radius is its reciprocal), while the SIGN of a turn only exists relative to some reference axis, which no curve carries on its own — take it against whichever axis you actually mean with `dot`, most often a level right vector built from the tangent and world up. Computed from the SAME neighbours the tangent's own central difference used, so the two columns describe one discrete curve rather than two slightly different ones, and a closed path wraps exactly as the tangent does. The divisor is the arc length between the two tangents being differenced — the two segments meeting at the point, and at an open path's END a HALF segment, because the tangent there is that segment's chord direction and so belongs to its midpoint rather than to its far end. Zero where it cannot be measured: at a point whose own tangent or either neighbour's is zero (a degenerate point), at an unreferenced point, and at every point of a closed loop of two distinct points, whose two neighbours are the same point. Zero on a straight too — but that is the measurement rather than the absence of one. SAMPLE THE PATH FOR THE CURVATURE YOU WANT TO READ, because more samples is not better here: this is a SECOND difference of f32 positions, so halving the step halves the signal while leaving the position quantization where it was, and past a point the noise wins. Measured against an analytic parabola, the error falls to about half a percent and then climbs back — 1.4% at 100 samples, 0.5% at 200-500, 2.9% at 1000, 12% at 2000. The useful rule is to keep the sample step somewhere near a hundredth of the smallest radius you care about and no finer; resampling a curve to a step far below that makes its curvature worse, not sharper. NOTE THAT normalize(curvature) IS THE FRENET NORMAL, which is NOT what `normalName` writes — the Frenet normal is undefined on a straight and flips a half turn through an inflection, which is exactly why the frame here is transported instead. Same reporting-slot rule as the three axis names: a column of a different shape under this name is refused rather than deleted and re-added, and it may not repeat one of the axis names.",
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
      curvatureName: "curvature",
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
    // The curvature is opt-in, so "" is OFF rather than a missing name —
    // which is the one rule it does not share with the three axes. Every
    // other rule it does: it may not be "P", and it may not sit on top of
    // an axis.
    const curvatureName = params.curvatureName;
    if (curvatureName === "P") {
      throw new Error(
        'writeCurveFrame: param "curvatureName" cannot be "P" — that would overwrite the positions the curvature is computed from; use "curvature" or another name, or leave it empty to write none',
      );
    }
    if (curvatureName !== "") {
      const clash = names.find(([, name]) => name === curvatureName);
      if (clash) {
        throw new Error(
          `writeCurveFrame: params "curvatureName" and "${clash[0]}" are both "${curvatureName}"; the curvature is a fourth column beside the frame's three axes and not one of them, so it needs a name of its own`,
        );
      }
    }
    const slots =
      curvatureName === ""
        ? names
        : [...names, ["curvatureName", curvatureName] as const];
    const src = requireGeometry(inputs, "in", "writeCurveFrame");
    // Each name is a reporting slot of this node's own shape, so a
    // differently shaped column under one is refused rather than deleted
    // and re-added — see writeTangents for why that distinction matters.
    for (const [param, name] of slots) {
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
    // Allocated here with the rest rather than after the transport, so
    // every column this node writes exists before any of them is written
    // into and no later `replace` can move one out from under a `.data`
    // reference already taken.
    const curvature =
      curvatureName === ""
        ? null
        : geo.attrs.point.replace(curvatureName, "f32", 3, [0, 0, 0]);
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

    // Curvature, as a second pass over the same tables. Separate from the
    // transport because it shares nothing with it: dT/ds needs the
    // tangents and the arc length and no carried state at all, so a point
    // it cannot measure costs the ones after it nothing, where a point the
    // transport cannot measure has to be stepped over.
    if (curvature) {
      const kd = curvature.data;
      for (const table of tables) {
        const pts = table.points;
        const nv = pts.length;
        const closed = table.closed;
        const segLen = table.segLen;
        const cum = table.cum;
        const m = closed ? nv - 1 : nv;
        for (let k = 0; k < m; k++) {
          const p = pts[k];
          // The SAME neighbours writePolylineTangents differenced to get
          // the tangent, so the two columns describe one discrete curve
          // rather than two slightly different ones.
          const kPrev = closed ? (k + m - 1) % m : k > 0 ? k - 1 : 0;
          const kNext = closed ? (k + 1) % m : k + 1 < nv ? k + 1 : nv - 1;
          // A closed loop of two distinct points: both neighbours are the
          // same point, so there is no difference to take.
          if (kPrev === kNext) continue;
          // Arc length BETWEEN THE TWO TANGENTS being differenced —
          // `station` below, not the vertices' own spacing. The two agree
          // everywhere except at an open path's two ends, and using the
          // vertex spacing there reports a fraction of the real curvature
          // at FOUR points of every open path: measured against an
          // analytic parabola, half at each end and three quarters at
          // each of their neighbours.
          const ds = closed
            ? segLen[(k + m - 1) % m] + segLen[k]
            : openTangentStation(cum, segLen, nv, kNext) -
              openTangentStation(cum, segLen, nv, kPrev);
          if (!(ds > 0)) continue;
          const a = pts[kPrev] * 3;
          const b = pts[kNext] * 3;
          const c = p * 3;
          // A zero tangent is a missing measurement, not a direction:
          // differencing against one reports a turn the curve never took.
          if (td[c] === 0 && td[c + 1] === 0 && td[c + 2] === 0) continue;
          if (td[a] === 0 && td[a + 1] === 0 && td[a + 2] === 0) continue;
          if (td[b] === 0 && td[b + 1] === 0 && td[b + 2] === 0) continue;
          // Read from the STORED f32 tangents rather than re-measured at
          // f64. Measured, that changes nothing: the tangents come from
          // f32 positions, whose quantization enters the angle as
          // eps*|P|/h against the column's flat eps — larger by roughly
          // the sample count. Re-deriving in f64 would buy a factor of
          // (1 + 1/N) and cost a second copy of the tangent rule.
          const inv = 1 / ds;
          kd[c] = (td[b] - td[a]) * inv;
          kd[c + 1] = (td[b + 1] - td[a + 1]) * inv;
          kd[c + 2] = (td[b + 2] - td[a + 2]) * inv;
        }
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
