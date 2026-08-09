/**
 * Filtering nodes: keep or drop points by density, bounds, attribute
 * comparisons, minimum mutual distance, or project them onto a plane.
 * Filters output points only (topology is not carried).
 */
import type { Geometry } from "../data/index.js";
import type { Column } from "../fields/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { UniformGrid } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import { type FieldParam, gatherPoints, requireGeometry, resolveOn } from "./util.js";

/** Params of {@link filterByDensity}. */
export interface FilterByDensityParams {
  mode: string;
  threshold: number;
  seed: number;
}

/** Keep points by their `density` attribute. */
export const filterByDensity = standardNode<FilterByDensityParams>({
  type: "filterByDensity",
  category: "filter",
  description:
    "Filters points by their `density` point attribute (f32, tuple 1). mode 'threshold' keeps points with density >= threshold; mode 'probabilistic' keeps each point when a deterministic per-point hashed random in [0, 1) is < its density (so density 0 never survives, 1 always does). Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "threshold",
      enum: ["threshold", "probabilistic"],
      description:
        "'threshold' keeps density >= threshold; 'probabilistic' keeps each point with probability equal to its density.",
    },
    threshold: {
      type: "f32",
      default: 0.5,
      description: "Minimum density a point needs to survive in 'threshold' mode. Ignored in 'probabilistic' mode.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed for 'probabilistic' mode; change it to re-roll which points survive.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterByDensity");
    const density = geo.attrs.point.get("density");
    if (!density || density.type !== "f32" || density.tupleSize !== 1) {
      throw new Error(
        'filterByDensity: input needs a point attribute "density" (f32, tuple 1); standard point clouds have it, or create it with setAttribute',
      );
    }
    const seed = hashCombine(nodeSeed, params.seed);
    const n = geo.pointCount;
    const keep: number[] = [];
    if (params.mode === "threshold") {
      for (let i = 0; i < n; i++) {
        if (density.data[i] >= params.threshold) keep.push(i);
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (hashFloat(hashCombine(seed, i)) < density.data[i]) keep.push(i);
      }
    }
    return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
  },
});

/** Params of {@link filterByBounds}. */
export interface FilterByBoundsParams {
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  mode: string;
}

/** Keep points inside (or outside) an axis-aligned box. */
export const filterByBounds = standardNode<FilterByBoundsParams>({
  type: "filterByBounds",
  category: "filter",
  description:
    "Keeps points by position against the axis-aligned box [boundsMin, boundsMax] (bounds inclusive). mode 'inside' keeps points within the box, 'outside' keeps the rest. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: { type: "vec3", default: [0, 0, 0], description: "Minimum corner of the box, in world units." },
    boundsMax: { type: "vec3", default: [1, 1, 1], description: "Maximum corner of the box, in world units." },
    mode: {
      type: "enum",
      default: "inside",
      enum: ["inside", "outside"],
      description: "'inside' keeps points within the box (inclusive); 'outside' keeps points beyond it.",
    },
  },
  execute({ inputs, params }) {
    const geo = requireGeometry(inputs, "in", "filterByBounds");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const [ax, ay, az] = params.boundsMin;
    const [bx, by, bz] = params.boundsMax;
    const wantInside = params.mode === "inside";
    const keep: number[] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      const x = pd[i * ps];
      const y = pd[i * ps + 1];
      const z = pd[i * ps + 2];
      const inside = x >= ax && x <= bx && y >= ay && y <= by && z >= az && z <= bz;
      if (inside === wantInside) keep.push(i);
    }
    return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
  },
});

/** Params of {@link filterByAttribute}. */
export interface FilterByAttributeParams {
  attribute: string;
  comparison: string;
  value: number;
  stringValue: string;
}

/** Keep points by comparing a scalar or string point attribute. */
export const filterByAttribute = standardNode<FilterByAttributeParams>({
  type: "filterByAttribute",
  category: "filter",
  description:
    "Keeps points whose named point attribute satisfies a comparison. Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value` with any comparison. String attributes compare against `stringValue` and support only 'eq' and 'ne'. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    attribute: {
      type: "string",
      default: "density",
      description: "Name of the point attribute to test. Must exist with tuple size 1.",
    },
    comparison: {
      type: "enum",
      default: "ge",
      enum: ["eq", "ne", "lt", "le", "gt", "ge"],
      description:
        "Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne.",
    },
    value: {
      type: "f32",
      default: 0,
      description: "Right-hand side for numeric attributes. Ignored for string attributes.",
    },
    stringValue: {
      type: "string",
      default: "",
      description: "Right-hand side for string attributes. Ignored for numeric attributes.",
    },
  },
  execute({ inputs, params }) {
    const geo = requireGeometry(inputs, "in", "filterByAttribute");
    const attr = geo.attrs.point.get(params.attribute);
    if (!attr) {
      throw new Error(
        `filterByAttribute: point attribute "${params.attribute}" not found; available: ${geo.attrs.point.names().join(", ")}`,
      );
    }
    if (attr.tupleSize !== 1) {
      throw new Error(
        `filterByAttribute: attribute "${params.attribute}" has tuple size ${attr.tupleSize}; only scalar (tuple 1) attributes can be filtered`,
      );
    }
    const cmp = params.comparison;
    const keep: number[] = [];
    if (attr.type === "string") {
      if (cmp !== "eq" && cmp !== "ne") {
        throw new Error(
          `filterByAttribute: string attribute "${params.attribute}" supports only comparisons "eq" and "ne", got "${cmp}"`,
        );
      }
      for (let i = 0; i < geo.pointCount; i++) {
        const match = attr.getString(i) === params.stringValue;
        if (match === (cmp === "eq")) keep.push(i);
      }
    } else {
      const rhs = params.value;
      const data = attr.data;
      for (let i = 0; i < geo.pointCount; i++) {
        const v = data[i];
        const pass =
          cmp === "eq"
            ? v === rhs
            : cmp === "ne"
              ? v !== rhs
              : cmp === "lt"
                ? v < rhs
                : cmp === "le"
                  ? v <= rhs
                  : cmp === "gt"
                    ? v > rhs
                    : v >= rhs;
        if (pass) keep.push(i);
      }
    }
    return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
  },
});

/** Params of {@link filterByExpression}. */
export interface FilterByExpressionParams {
  predicate: FieldParam;
  seed: number;
}

/** Keep points where a boolean field predicate holds. */
export const filterByExpression = standardNode<FilterByExpressionParams>({
  type: "filterByExpression",
  category: "filter",
  description:
    "Keeps points where a field-capable `predicate` evaluates to a non-zero number. The predicate is resolved once over the input's point domain, so it can read position, any attribute, noise, or per-point randomness — which means a test that would otherwise need a scratch attribute plus filterByAttribute becomes one node, with no leftover column on the output. Comparison field functions (gt/ge/lt/le/eq/ne) already yield 1 and 0, and combining them with mul acts as AND, max as OR. NaN never passes, so a predicate that fails to compute drops the point instead of keeping it. The predicate must evaluate to tuple size 1: comparisons broadcast elementwise, so comparing a vector yields a vector of flags, which is not a decision. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    predicate: {
      type: "f32",
      default: 1,
      acceptsField: true,
      description:
        "Per-point test: non-zero keeps the point, 0 and NaN drop it. Field-capable and evaluated on the input's points. The default 1 keeps everything, so an unconfigured node passes its input through.",
    },
    seed: {
      type: "u32",
      default: 0,
      description:
        "Extra seed for evaluating `predicate`: 0 (the default) uses the node's derived seed unchanged; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the evaluation context (randomField, and the per-point seed attribute) but NOT noise, whose seed lives inside its own field spec.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterByExpression");
    const seed = params.seed === 0 ? nodeSeed : hashCombine(nodeSeed, params.seed);
    // Deliberately NOT a `gpu: "fields"` adopter, unlike every other node
    // with a field-capable param. The device path is a documented
    // approximation of the CPU one, tolerated elsewhere because it moves a
    // VALUE by an ulp. Here the value is a decision: a point sitting exactly
    // on the predicate boundary flips in or out, which changes the surviving
    // COUNT, and with it every downstream index, per-point seed and cache
    // key. Adopting is one line plus a fixture in the bidirectional guard at
    // src/gpu/onePredicate.test.ts — do it only with a parity budget
    // expressed in surviving points, not in ulps.
    const col = resolveOn(geo, "point", params.predicate, seed);
    if (col.tupleSize !== 1) {
      throw new Error(
        `filterByExpression: predicate must evaluate to tuple size 1 (one flag per point), got tuple size ${col.tupleSize}; field comparisons broadcast elementwise, so comparing a vector such as gt(position(), 0) yields one flag per component — compare a single component instead, e.g. gt(component(position(), 1), 0)`,
      );
    }
    const data = col.data;
    const keep: number[] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      // `> 0 || < 0` is the non-zero test that also rejects NaN, where
      // `!== 0` would keep it.
      const v = data[i];
      if (v > 0 || v < 0) keep.push(i);
    }
    return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
  },
});

/** Params of {@link selfPrune}. */
export interface SelfPruneParams {
  minDistance: FieldParam;
  priority: FieldParam;
}

/**
 * Resolve one of {@link selfPrune}'s field-capable params to exactly one
 * number per point. The message names the node, the param and the fix,
 * because a vector here is the likely mistake: the standard `scale`
 * attribute is a vec3, and a radius or a rank is a single number.
 */
function selfPruneScalar(
  geo: Geometry,
  param: "minDistance" | "priority",
  value: FieldParam,
  seed: number,
  what: string,
): Column {
  const col = resolveOn(geo, "point", value, seed);
  if (col.tupleSize !== 1) {
    throw new Error(
      `selfPrune: param "${param}" must evaluate to ONE number per point (tupleSize 1), got tupleSize ${col.tupleSize} — ${what} is a single number, and fields broadcast elementwise, so a vec3 such as attribute("scale") yields three numbers per point. Reduce it to a scalar first, e.g. component(attribute("scale"), 0).`,
    );
  }
  return col;
}

/** Greedy minimum-distance pruning, ordered by priority then point index. */
export const selfPrune = standardNode<SelfPruneParams>({
  type: "selfPrune",
  category: "filter",
  description:
    "Enforces a minimum distance between points: considers points one at a time and keeps a point only when every already-kept point is at least minDistance away. The order decides who wins, and it is `priority` DESCENDING (higher priority survives) with ties broken by the LOWER point index — so with priority left alone, every point ties and this is exactly the index-greedy prune it has always been. Both params are field-capable: a field `minDistance` is a PER-POINT radius (scale-aware declutter — big trees claim more room than bushes), and a pair then conflicts when it is closer than the LARGER of the two radii, so no kept point ever has another kept point inside its own radius. Survivors always come out in ascending INPUT index order; priority chooses who survives, never the order of the output. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    minDistance: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Minimum allowed distance between two kept points, in world units. As a FIELD it is a per-point radius, evaluated on the input's points, and two points conflict when they are closer than the LARGER of their two radii (never the smaller, which would let a big point be crowded by a small one, and never the sum, which would double the spacing of an evenly-sized cloud and so disagree with the same number passed plainly). A per-point radius that is 0, negative or NaN claims no room of its own, but such a point can still be pruned by a bigger neighbour. A PLAIN 0 (or less) turns the node off: every point survives, topology included, and `priority` is not evaluated. A field never takes that shortcut — it always outputs a point cloud, so what the output IS never depends on the numbers that come back.",
    },
    priority: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Per-point survival priority: HIGHER WINS. Points are considered in descending priority, so a point at priority 1 survives against a neighbour at priority 0 whichever of them has the lower index — this is how authored points beat procedural ones by SAYING so, instead of by being merged onto an earlier pin. Field-capable and evaluated on the input's points: attribute(\"locked\") ranks by a flag written upstream (merge the layers with mergePoints first — an attribute missing on one input fills with its default there), and randomField(\"key\") thins without the spatial bias of index order, re-rolling when the key changes. Equal priorities break to the LOWER point index, and NaN ranks lowest. The default 0 ties every point, which reproduces the index-greedy prune exactly. This decides WHO survives, never the output order.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "selfPrune");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    // A plain non-positive minDistance turns the node off, as it always
    // has: the input passes through cloned, topology and all. A FIELD
    // never takes this path, even when every value it returns is 0 —
    // whether the output carries topology must not depend on the data.
    const uniform = typeof params.minDistance === "number" ? params.minDistance : undefined;
    if (uniform !== undefined && !(uniform > 0)) {
      // Nothing to prune; pass a cloned input through.
      return { out: [makeGeometryItem(cloneGeometry(geo))] };
    }
    // A P narrower than xyz would have the grid read the NEXT point's
    // coordinates as this one's y and z — silently, before the shared
    // index made it an error. Caught here so the message names the node
    // the author has to fix, not the internal that noticed.
    if (ps < 3) {
      throw new Error(
        `selfPrune: point attribute "P" has tupleSize ${ps}, but distances need x, y and z (tupleSize 3); something upstream overwrote P with a narrower attribute`,
      );
    }
    // Both params resolve before anything is decided; nothing here
    // mutates the geometry, so columns that alias attribute storage stay
    // valid for the whole scan.
    const radii =
      uniform === undefined
        ? selfPruneScalar(geo, "minDistance", params.minDistance, nodeSeed, "a radius")
        : undefined;
    const ranks =
      typeof params.priority === "number"
        ? undefined
        : selfPruneScalar(geo, "priority", params.priority, nodeSeed, "a rank");
    // Visit order: priority descending, ties to the lower index. The
    // tiebreak is the point INDEX deliberately, not a hashed identity:
    // it is what makes a constant priority (the default) reduce to the
    // shipped greedy exactly, and this node is single-partition — index
    // is a stable name for a point here, which it is not in the
    // cross-partition ops that need identity hashing.
    let order: Uint32Array | undefined;
    if (ranks !== undefined) {
      const rank = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const v = ranks.data[i];
        // NaN ranks lowest rather than poisoning the comparator.
        rank[i] = v === v ? v : Number.NEGATIVE_INFINITY;
      }
      order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      // A difference of two infinities is NaN, which is falsy, so equal
      // infinite ranks fall through to the index like any other tie.
      order.sort((a, b) => rank[b] - rank[a] || a - b);
    }
    const kept = new Uint8Array(n);
    const view = { data: pd, stride: ps, count: n };
    if (radii === undefined) {
      const minDist = uniform as number;
      // One cell per minimum distance, so the survivors already kept
      // within reach of a candidate are exactly the 3x3x3 block around
      // its cell.
      const grid = new UniformGrid(view, minDist);
      for (let k = 0; k < n; k++) {
        const i = order === undefined ? k : order[k];
        const o = i * ps;
        if (grid.hasPointCloserThan(pd[o], pd[o + 1], pd[o + 2], minDist)) continue;
        kept[i] = 1;
        grid.insert(i);
      }
    } else {
      // Per-point radii. Each point's CLAIM is its radius when that is
      // positive and 0 otherwise, so a negative or NaN radius claims
      // nothing (and, unlike a raw NaN, cannot wipe out a neighbour's
      // claim through the max below).
      const claim = new Float64Array(n);
      let cellSize = 0;
      for (let i = 0; i < n; i++) {
        const v = radii.data[i];
        const c = v > 0 ? v : 0;
        claim[i] = c;
        if (c > cellSize && c < Number.POSITIVE_INFINITY) cellSize = c;
      }
      // Cell size never decides an answer, only how many cells a query
      // touches — the pair test below is exact whatever it is. The
      // largest FINITE claim makes the usual case (radii within a small
      // factor of each other) a 3x3x3 block; an all-zero or all-infinite
      // set has no informative size, so 1 stands in.
      const grid = new UniformGrid(view, cellSize > 0 ? cellSize : 1);
      const hits: number[] = [];
      // Largest claim among the points kept so far: a candidate has to
      // look that far out, because a kept point's own radius can reach
      // the candidate even when the candidate's cannot reach back.
      let widest = 0;
      for (let k = 0; k < n; k++) {
        const i = order === undefined ? k : order[k];
        const o = i * ps;
        const x = pd[o];
        const y = pd[o + 1];
        const z = pd[o + 2];
        const rc = claim[i];
        const reach = rc > widest ? rc : widest;
        let blocked = false;
        if (reach > 0) {
          grid.queryRadius(x, y, z, reach, hits);
          for (const j of hits) {
            const rj = claim[j];
            // The LARGER radius decides the pair — see the param docs.
            const limit = rc > rj ? rc : rj;
            const q = j * ps;
            const dx = pd[q] - x;
            const dy = pd[q + 1] - y;
            const dz = pd[q + 2] - z;
            if (dx * dx + dy * dy + dz * dz < limit * limit) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
        kept[i] = 1;
        grid.insert(i);
        if (rc > widest) widest = rc;
      }
    }
    const keep: number[] = [];
    for (let i = 0; i < n; i++) if (kept[i] === 1) keep.push(i);
    return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
  },
});

/** Params of {@link projectToPlane}. */
export interface ProjectToPlaneParams {
  origin: readonly number[];
  normal: readonly number[];
  keepOffset: boolean;
}

/** Orthogonally project points onto a plane. */
export const projectToPlane = standardNode<ProjectToPlaneParams>({
  type: "projectToPlane",
  category: "filter",
  description:
    "Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally; must be non-zero). With keepOffset enabled, the signed distance each point moved (positive along the normal) is stored in a `planeOffset` point attribute (f32, tuple 1) before projecting, so the flattening is invertible.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    origin: { type: "vec3", default: [0, 0, 0], description: "A point on the plane, in world units." },
    normal: {
      type: "vec3",
      default: [0, 1, 0],
      description: "Plane normal; any non-zero vector (normalized internally).",
    },
    keepOffset: {
      type: "bool",
      default: false,
      description:
        "When true, store each point's signed pre-projection distance to the plane in a `planeOffset` point attribute (f32).",
    },
  },
  execute({ inputs, params }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "projectToPlane"));
    const [nxr, nyr, nzr] = params.normal;
    const len = Math.sqrt(nxr * nxr + nyr * nyr + nzr * nzr);
    if (!(len > 0)) {
      throw new Error("projectToPlane: normal must be a non-zero vector");
    }
    const nx = nxr / len;
    const ny = nyr / len;
    const nz = nzr / len;
    const [ox, oy, oz] = params.origin;
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    let offsets: Float32Array | undefined;
    if (params.keepOffset) {
      const set = geo.attrs.point;
      if (set.has("planeOffset")) set.remove("planeOffset");
      offsets = set.add("planeOffset", "f32", 1, 0).data;
    }
    for (let i = 0; i < n; i++) {
      const d =
        (pd[i * ps] - ox) * nx + (pd[i * ps + 1] - oy) * ny + (pd[i * ps + 2] - oz) * nz;
      if (offsets) offsets[i] = d;
      pd[i * ps] -= d * nx;
      pd[i * ps + 1] -= d * ny;
      pd[i * ps + 2] -= d * nz;
    }
    return { out: [makeGeometryItem(geo)] };
  },
});
