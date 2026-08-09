/**
 * Filtering nodes: keep or drop points by density, bounds, attribute
 * comparisons, minimum mutual distance, or project them onto a plane.
 * Filters output points only (topology is not carried).
 */
import type { Geometry } from "../data/index.js";
import type { Column } from "../fields/index.js";
import { pointIdentities } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { type PositionView, UniformGrid } from "../spatial/index.js";
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
    "Filters points by their `density` point attribute (f32, tuple 1). mode 'threshold' keeps points with density >= threshold; mode 'probabilistic' keeps each point when a deterministic per-point hashed random in [0, 1) is < its density (so density 0 never survives, 1 always does). The probabilistic draw is keyed on each point's IDENTITY — its stored position bits together with its `seed` point attribute — not on its array index, so the same point survives or does not whatever order it arrives in and whichever cell derived it. Two points that share a position AND a seed are one point as far as that draw is concerned and always decide the same way, so a cloud with no per-point seeds (the attribute defaults to 0) decides purely on position. Output is a point cloud of the survivors with all attributes carried.",
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
      // Keyed on identity, not on `i`: the same world point gets a
      // different index depending on which query produced it, so an
      // index-keyed acceptance would re-roll under a shuffle, an upstream
      // filter, or a halo. Identity is the point's own name.
      const ident = pointIdentities(geo, "filterByDensity");
      for (let i = 0; i < n; i++) {
        if (hashFloat(hashCombine(seed, ident[i])) < density.data[i]) keep.push(i);
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
  boundary: string;
}

/** Keep points inside (or outside) an axis-aligned box. */
export const filterByBounds = standardNode<FilterByBoundsParams>({
  type: "filterByBounds",
  category: "filter",
  description:
    "Keeps points by position against the axis-aligned box [boundsMin, boundsMax]. What happens ON a face is the `boundary` param, and it is the difference between a selection and an OWNERSHIP RULE: the default 'halfOpen' keeps min <= p < max on every axis — the min face is inside, the max face is not — so two boxes that MEET at a face (one's max is the other's min, the same number) tile space with no gap and no duplicate, and each point belongs to exactly one of them. That is the rule a grid cell uses, and the one pointScatterInWorld's query window and a World cell rectangle already follow; note that it is the shared ENDPOINT VALUE that makes the tiling exact, so building the boxes as [c*size, (c+1)*size) is exact at any size, while recovering the index arithmetically as floor(p / size) can name the neighbouring cell when size is not exactly representable (floor(67.8 / 0.1) is 677, yet 678*0.1 is exactly 67.8). 'inclusive' keeps min <= p <= max, which is what you want to select a box whose faces carry points on purpose, and which emits a point sitting on a shared face from BOTH neighbouring boxes — harmless in a one-off selection, wrong in a partitioned cook, where a doubled point is invisible until two cells disagree. mode 'outside' is the exact complement of 'inside' under whichever boundary rule is active, so the two modes always partition the input: no point lost, none emitted twice. Infinite bounds work under both rules (every finite coordinate satisfies p < +Infinity), so an axis that should not be bounded — the Y of a World 'xz' column — needs no extra param. A NaN coordinate is never inside, so such a point lands in 'outside'. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      description:
        "Minimum corner of the box, in world units. INCLUSIVE under both boundary rules: a point lying exactly on this face is inside. Use -Infinity on an axis that should not be bounded.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      description:
        "Maximum corner of the box, in world units. EXCLUSIVE under the default 'halfOpen' boundary (a point exactly on this face belongs to the next box along), INCLUSIVE under 'inclusive'. Use +Infinity on an axis that should not be bounded. An axis with max <= min keeps nothing under 'halfOpen' — a zero-width box has no interior — while under 'inclusive' max === min still keeps the points lying exactly on that plane.",
    },
    mode: {
      type: "enum",
      default: "inside",
      enum: ["inside", "outside"],
      description:
        "'inside' keeps points within the box, 'outside' keeps the rest. They are exact complements under whichever `boundary` rule is active, so running both over one input reproduces it exactly once.",
    },
    boundary: {
      type: "enum",
      default: "halfOpen",
      enum: ["halfOpen", "inclusive"],
      description:
        "Which faces belong to the box. 'halfOpen' (the default) keeps min <= p < max on every axis, matching the half-open windows of pointScatterInWorld and of a World cell: two abutting boxes then own a point on their shared face exactly once between them, which is what makes this node usable as the ownership rule of a partitioned cook. 'inclusive' keeps min <= p <= max, so BOTH such boxes emit that point — choose it when the box is a selection whose faces carry points deliberately (a pointGrid's last row, an authored extent) and nothing downstream requires one owner per point.",
    },
  },
  execute({ inputs, params }) {
    const geo = requireGeometry(inputs, "in", "filterByBounds");
    // Both enums are checked rather than defaulted through an else: which
    // face a point belongs to is a decision no typo should make silently,
    // and an off-by-one-face is invisible until two boxes disagree about
    // a point they share.
    if (params.mode !== "inside" && params.mode !== "outside") {
      throw new Error(
        `filterByBounds: mode must be "inside" or "outside", got ${JSON.stringify(params.mode)}`,
      );
    }
    if (params.boundary !== "halfOpen" && params.boundary !== "inclusive") {
      throw new Error(
        `filterByBounds: boundary must be "halfOpen" or "inclusive", got ${JSON.stringify(params.boundary)}; "halfOpen" keeps min <= p < max (the ownership rule: abutting boxes claim a shared face exactly once between them), "inclusive" keeps min <= p <= max (a selection: both boxes claim it)`,
      );
    }
    // A two-component bound leaves z undefined, and every comparison
    // against undefined is false — so the box would quietly hold nothing
    // (and 'outside' quietly hold everything). The likely source is a
    // World "xz" cell, whose ctx.min / ctx.max ARE 2D, which is exactly
    // the binding this node is most often used for.
    for (const [name, v] of [
      ["boundsMin", params.boundsMin],
      ["boundsMax", params.boundsMax],
    ] as const) {
      if (v.length < 3) {
        throw new Error(
          `filterByBounds: ${name} needs three components [x, y, z], got ${v.length}; a World "xz" cell's ctx.min / ctx.max are 2D [x, z], so spell the box out as [ctx.min[0], -Infinity, ctx.min[1]] and [ctx.max[0], Infinity, ctx.max[1]]`,
        );
      }
    }
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const [ax, ay, az] = params.boundsMin;
    const [bx, by, bz] = params.boundsMax;
    const wantInside = params.mode === "inside";
    const inclusive = params.boundary === "inclusive";
    const keep: number[] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      const x = pd[i * ps];
      const y = pd[i * ps + 1];
      const z = pd[i * ps + 2];
      // One boolean, negated for 'outside', so the complement is exact by
      // construction under either rule — a second predicate for the
      // outside case is how a gap or an overlap gets in.
      const inside =
        x >= ax &&
        y >= ay &&
        z >= az &&
        (inclusive ? x <= bx && y <= by && z <= bz : x < bx && y < by && z < bz);
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
  mode: string;
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

/**
 * The survival ORDER, defined once because both of {@link selfPrune}'s
 * rules settle every contest by it: `priority` DESCENDING, ties to the
 * LOWER point identity, and — only between points that are
 * indistinguishable, or whose identities collide — the lower index.
 * Negative when `a` wins, and never 0 for two different points, so it is a
 * strict total order and not merely a sort key.
 *
 * The index fallback is the one part of the order that a partitioned cook
 * cannot reproduce, since a point's index depends on which query produced
 * it. It is reached only when two points agree on position AND seed (they
 * are copies of each other, so which one comes back is not observable) or
 * when their 32-bit identities collide — an event independent of position,
 * so a colliding pair must ALSO fall within minDistance of each other
 * before it can decide anything.
 */
function comparePruneOrder(
  a: number,
  b: number,
  ident: Uint32Array,
  rank: Float64Array | undefined,
): number {
  // A difference of two equal infinities is NaN, which is falsy, so equal
  // infinite ranks fall through to the identity like any other tie.
  return (rank === undefined ? 0 : rank[b] - rank[a]) || ident[a] - ident[b] || a - b;
}

/**
 * GREEDY rule: visit points in `order` and keep one only when every
 * ALREADY-KEPT point is at least its distance away. `radius` is the plain
 * minimum distance, or one claim per point; `cellSize` is the grid's.
 *
 * Returns one flag per point. Dense, order-dependent, and NOT reproducible
 * from a bounded halo — see the node's `mode` param for why.
 */
function greedyKeep(
  view: PositionView,
  radius: number | Float64Array,
  cellSize: number,
  order: Uint32Array,
): Uint8Array {
  const pd = view.data;
  const ps = view.stride;
  const n = view.count;
  const kept = new Uint8Array(n);
  const grid = new UniformGrid(view, cellSize);
  if (typeof radius === "number") {
    // One cell per minimum distance, so the survivors already kept within
    // reach of a candidate are exactly the 3x3x3 block around its cell.
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const o = i * ps;
      if (grid.hasPointCloserThan(pd[o], pd[o + 1], pd[o + 2], radius)) continue;
      kept[i] = 1;
      grid.insert(i);
    }
    return kept;
  }
  const hits: number[] = [];
  // Largest claim among the points kept so far: a candidate has to look
  // that far out, because a kept point's own radius can reach the
  // candidate even when the candidate's cannot reach back.
  let widest = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const o = i * ps;
    const x = pd[o];
    const y = pd[o + 1];
    const z = pd[o + 2];
    const rc = radius[i];
    const reach = rc > widest ? rc : widest;
    let blocked = false;
    if (reach > 0) {
      grid.queryRadius(x, y, z, reach, hits);
      for (const j of hits) {
        const rj = radius[j];
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
  return kept;
}

/**
 * LOCAL-MAXIMUM rule: a point survives exactly when it wins the order
 * against every point it CONFLICTS with — closer than the larger of the two
 * radii — whether or not that neighbour itself survives.
 *
 * That independence is the whole point. Each answer reads one hop of
 * neighbourhood and nothing beyond it, so a cell holding every point within
 * that reach of its own points computes the same answers a whole-region
 * cook would, and no chain of survivals crosses the seam. The greedy above
 * cannot make that claim at any halo width.
 *
 * Every conflicting pair is discovered from whichever side's own radius
 * covers the distance (at least one does, since conflict means `d` is under
 * the larger); when both do, the pair is decided twice, identically.
 *
 * Costlier than the greedy, and structurally so: every point issues a query,
 * and each query sweeps every INPUT point in range rather than the sparse
 * set of survivors the greedy indexes (which also short-circuits on its
 * first blocker). Measured on a flat scatter at minDistance 2: 53 ms against
 * 38 ms at 20k points, 438 ms against 197 ms at 100k — the same shape of
 * curve, a constant factor apart.
 */
function localMaximumKeep(
  view: PositionView,
  radius: number | Float64Array,
  cellSize: number,
  ident: Uint32Array,
  rank: Float64Array | undefined,
): Uint8Array {
  const pd = view.data;
  const ps = view.stride;
  const n = view.count;
  // Survival is the default here, unlike the greedy's earn-your-place scan:
  // a point falls out the moment one neighbour outranks it.
  const kept = new Uint8Array(n).fill(1);
  const grid = UniformGrid.build(view, cellSize);
  const hits: number[] = [];
  for (let i = 0; i < n; i++) {
    // A point claiming nothing (0, negative or NaN radius) discovers no
    // pair of its own; a bigger neighbour still finds it from the far side
    // and can prune it.
    const rc = typeof radius === "number" ? radius : radius[i];
    if (!(rc > 0)) continue;
    const o = i * ps;
    const x = pd[o];
    const y = pd[o + 1];
    const z = pd[o + 2];
    const limit = rc * rc;
    grid.queryRadius(x, y, z, rc, hits);
    for (const j of hits) {
      if (j === i) continue;
      const q = j * ps;
      const dx = pd[q] - x;
      const dy = pd[q + 1] - y;
      const dz = pd[q + 2] - z;
      // Strictly closer, matching the greedy's test exactly: a pair at
      // exactly the distance is not a conflict, and a NaN distance is
      // never one.
      if (!(dx * dx + dy * dy + dz * dz < limit)) continue;
      if (comparePruneOrder(i, j, ident, rank) < 0) kept[j] = 0;
      else kept[i] = 0;
    }
  }
  return kept;
}

/** Minimum-distance pruning: greedy, or the partition-safe local maximum. */
export const selfPrune = standardNode<SelfPruneParams>({
  type: "selfPrune",
  category: "filter",
  description:
    "Enforces a minimum distance between points, under one of two rules chosen by `mode`. The default 'greedy' considers points one at a time and keeps a point only when every already-kept point is at least minDistance away; it packs points densely, and it CANNOT BE SPLIT ACROSS CELLS — a point's fate depends on whether its neighbour survived, which depends on ITS neighbour, an unbounded chain that no halo width covers, so running it per cell in a partitioned or World cook silently produces survivors that differ with the cell size and seam pairs closer than minDistance (measured: 1.41 apart where 3 was asked for) that read as a rendering artifact rather than as this node. Use mode 'localMaximum' there: it decides each point from its immediate neighbours alone, which makes a halo of minDistance exactly sufficient, at the price of keeping fewer points. Both rules settle every contest the same way — `priority` DESCENDING (higher priority survives) with ties broken by the LOWER point IDENTITY, a hash of the point's stored position bits and its `seed` point attribute, NOT its array index. That is what makes the survivors a property of the points rather than of the order they arrived in: shuffle the input, filter something upstream, or derive the same region inside another cell's halo, and the same points survive. With priority left alone every point ties, so identity alone decides, and the result is a spatially unbiased thinning rather than the front-of-the-array-wins prune an index order gives. Points that are indistinguishable — same position AND same seed — fall back to the lower index, since nothing else separates them. Both params are field-capable: a field `minDistance` is a PER-POINT radius (scale-aware declutter — big trees claim more room than bushes), and a pair then conflicts when it is closer than the LARGER of the two radii, so no kept point ever has another kept point inside its own radius. Survivors always come out in ascending INPUT index order; priority chooses who survives, never the order of the output. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    mode: {
      type: "enum",
      default: "greedy",
      enum: ["greedy", "localMaximum"],
      description:
        "Which rule picks the survivors — the two disagree by design, and what separates them is how far one decision reaches. 'greedy' (the default) considers the points in order and keeps one whenever every ALREADY-KEPT point is at least minDistance away. It packs points about as densely as the order allows, and it is the right rule for cooking a region in one piece. Its decisions chain, though: this point survives because that neighbour did not, which happened because ITS neighbour did, and so on with no bound — so a cell cannot reproduce it from any halo, however wide. MEASURED, not argued: over one 60x60 world of 2000 points at minDistance 3, where a whole-region cook keeps 238, cooking in cells of 10, 15, 20 and 30 (each with a full 3-unit halo) kept 4, 4, 2 and 1 point the whole cook had pruned and dropped 7, 5, 2 and 3 it had kept — every cell size wrong in its own way, none agreeing with another — and three of the four left a surviving pair closer than the 3 that was asked for (1.41, 2.18 and 1.41; the worst of them under half of it). 'localMaximum' is the rule to reach for under partitioned or per-cell (World) cooking: a point survives only when it OUTRANKS EVERY point within minDistance of it, consulting nothing further. That is ONE hop, so a cell holding everything within minDistance of its own points computes exactly the whole-region answer — all four cell sizes above: identical survivors, and no pair under minDistance anywhere, seams included. The honest cost is density. A local-maximum survivor is always a greedy survivor too, never the reverse, so this rule keeps strictly FEWER points — 122 against 238 on that same world, about half — and leaves gaps a greedy pass would have filled. It is not the better rule; it is the correct one where the greedy is wrong.",
    },
    minDistance: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Minimum allowed distance between two kept points, in world units. As a FIELD it is a per-point radius, evaluated on the input's points, and two points conflict when they are closer than the LARGER of their two radii (never the smaller, which would let a big point be crowded by a small one, and never the sum, which would double the spacing of an evenly-sized cloud and so disagree with the same number passed plainly). A per-point radius that is 0, negative or NaN claims no room of its own, but such a point can still be pruned by a bigger neighbour. A PLAIN 0 (or less) turns the node off: every point survives, topology included, and `priority` is not evaluated, whichever mode is set. A field never takes that shortcut — it always outputs a point cloud, so what the output IS never depends on the numbers that come back. This is also the HALO WIDTH a cell needs under mode 'localMaximum', and as a field that width is the GLOBAL MAXIMUM the field can return anywhere in the world — not each point's own radius, since a big point reaches that far into its neighbours, and NOT the largest radius present in the cell's cloud, which is circular: the cloud a cell sees has already been clipped by the very halo you are trying to size, so the big neighbour that would have set the width is precisely the one it cannot see. Bound the field instead of measuring it — a constant times the range of whatever drives it (e.g. a noise field is in [-1, 1], so `2 + 3 * noise` maxes at 5; a radius read from an attribute maxes at that attribute's maximum over the WHOLE world, not over this cell) — and pass that bound as the halo. Overestimating costs a wider query; underestimating silently keeps pairs closer than the field asked for, at the seams only.",
    },
    priority: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Per-point survival priority: HIGHER WINS. Points are considered in descending priority, so a point at priority 1 survives against a neighbour at priority 0 whichever of them the tiebreak would have preferred — this is how authored points beat procedural ones by SAYING so, instead of by being merged onto an earlier pin. Field-capable and evaluated on the input's points: attribute(\"locked\") ranks by a flag written upstream (merge the layers with mergePoints first — an attribute missing on one input fills with its default there), and randomField(\"key\") re-rolls the thinning when the key changes. Equal priorities break to the LOWER point IDENTITY (position bits plus the `seed` attribute), and NaN ranks lowest. The default 0 ties every point, so identity alone picks the survivors — which is already unbiased, so a random priority is for re-rolling, not for undoing an ordering bias. This decides WHO survives, never the output order.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "selfPrune");
    // Checked before anything else, including the pass-through below: which
    // rule ran is not a detail an author can afford to have defaulted
    // silently, since the two disagree by design and only one of them
    // survives being split across cells.
    const mode = params.mode;
    if (mode !== "greedy" && mode !== "localMaximum") {
      throw new Error(
        `selfPrune: mode must be "greedy" or "localMaximum", got ${JSON.stringify(mode)}; ` +
          '"greedy" packs points as densely as the order allows but its survivors depend on an unbounded chain of neighbours, so it cannot be reproduced from a halo; ' +
          '"localMaximum" decides each point from its immediate neighbours alone, which is what makes a halo of minDistance exactly sufficient',
      );
    }
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
    // The order both rules settle contests by: priority descending, ties
    // to the lower IDENTITY. Who wins is then decided entirely by the
    // points themselves, so an index tiebreak made the survivors a
    // function of array order — the same two points would swap winners
    // after a shuffle, an upstream filter, or a cook that derived them in
    // a different cell. Identity is the point's own name, so both sides
    // of a seam agree on it. Points that are indistinguishable (same
    // position AND same seed) still fall through to the index, which
    // keeps the order total.
    //
    // The rank column is built even at a constant priority, where the
    // greedy's loop used to walk 0..n-1: index order IS the visit order
    // there, so leaving it alone would have left the default path the
    // only index-keyed one.
    const ident = pointIdentities(geo, "selfPrune");
    let rank: Float64Array | undefined;
    if (ranks !== undefined) {
      rank = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const v = ranks.data[i];
        // NaN ranks lowest rather than poisoning the comparator.
        rank[i] = v === v ? v : Number.NEGATIVE_INFINITY;
      }
    }
    const view = { data: pd, stride: ps, count: n };
    // What each point claims, and how big a grid cell is. For a plain
    // minDistance both are that number. For a field, each point's CLAIM is
    // its radius when that is positive and 0 otherwise, so a negative or
    // NaN radius claims nothing (and, unlike a raw NaN, cannot wipe out a
    // neighbour's claim through the max rule).
    let radius: number | Float64Array;
    let cellSize: number;
    if (radii === undefined) {
      radius = uniform as number;
      cellSize = uniform as number;
    } else {
      const claim = new Float64Array(n);
      let widest = 0;
      for (let i = 0; i < n; i++) {
        const v = radii.data[i];
        const c = v > 0 ? v : 0;
        claim[i] = c;
        if (c > widest && c < Number.POSITIVE_INFINITY) widest = c;
      }
      radius = claim;
      // Cell size never decides an answer, only how many cells a query
      // touches — the pair tests are exact whatever it is. The largest
      // FINITE claim makes the usual case (radii within a small factor of
      // each other) a 3x3x3 block; an all-zero or all-infinite set has no
      // informative size, so 1 stands in.
      cellSize = widest > 0 ? widest : 1;
    }
    let kept: Uint8Array;
    if (mode === "greedy") {
      const order = new Uint32Array(n);
      for (let i = 0; i < n; i++) order[i] = i;
      order.sort((a, b) => comparePruneOrder(a, b, ident, rank));
      kept = greedyKeep(view, radius, cellSize, order);
    } else {
      kept = localMaximumKeep(view, radius, cellSize, ident, rank);
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
