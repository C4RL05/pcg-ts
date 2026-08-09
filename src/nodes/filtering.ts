/**
 * Filtering nodes: keep or drop points by density, bounds, attribute
 * comparisons, minimum mutual distance, or project them onto a plane.
 * Filters output points only (topology is not carried).
 */
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
  minDistance: number;
}

/** Greedy minimum-distance pruning in point-index order. */
export const selfPrune = standardNode<SelfPruneParams>({
  type: "selfPrune",
  category: "filter",
  description:
    "Enforces a minimum distance between points: scans points in index order and keeps a point only when every previously kept point is at least minDistance away (deterministic greedy — lower indices win). Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    minDistance: {
      type: "f32",
      default: 1,
      min: 0,
      description:
        "Minimum allowed distance between any two kept points, in world units. 0 keeps every point.",
    },
  },
  execute({ inputs, params }) {
    const geo = requireGeometry(inputs, "in", "selfPrune");
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    const minDist = params.minDistance;
    if (!(minDist > 0)) {
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
    // One cell per minimum distance, so the survivors already kept within
    // reach of a candidate are exactly the 3x3x3 block around its cell.
    const grid = new UniformGrid({ data: pd, stride: ps, count: n }, minDist);
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = i * ps;
      if (grid.hasPointCloserThan(pd[o], pd[o + 1], pd[o + 2], minDist)) continue;
      keep.push(i);
      grid.insert(i);
    }
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
