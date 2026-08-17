/**
 * Filtering nodes: keep or drop points by density, bounds, attribute
 * comparisons, minimum mutual distance, or project them onto a plane.
 *
 * Every POINT filter here rebuilds the point domain from the survivors,
 * and by DEFAULT (`topology "drop"`) the topology describing the points
 * that are gone goes with it — all of it, touched primitives and untouched
 * alike. `topology "keep"` is the opt-in that drops only the primitives
 * which actually lose a point; it is one shared param, one shared guard
 * and one shared rebuild ({@link rebuildFiltered}) across all five,
 * because five filters disagreeing about whether a network survives them
 * is the same class of bug as two boxes disagreeing about a face.
 * {@link filterPrimitivesByBounds} and {@link filterPrimitivesByAttribute}
 * come at it from the other side, filtering the PRIMITIVE domain and
 * deciding what happens to the POINTS — see their descriptions.
 *
 * Each primitive filter is the twin of a point filter and shares its
 * decision rather than restating it: the box test with filterByBounds,
 * the comparison with filterByAttribute. Two filters that disagree about
 * a face, or about what `ge` means on a bool, are how a partitioned cook
 * goes quietly wrong.
 */
import type { Attribute, Geometry } from "../data/index.js";
import { type Column, isField } from "../fields/index.js";
// The non-cloning spec reader, deliberately not part of the package's
// field surface: `staticScalar` below only ASKS whether a field is one
// authored constant, and copying a whole spec tree to answer that would
// cost more than the question is worth.
import { peekFieldSpec } from "../fields/spec.js";
import { pointIdentities } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem, type ParamSchema } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { type PositionView, UniformGrid } from "../spatial/index.js";
import { standardNode } from "./registry.js";
import {
  type FieldParam,
  gatherPoints,
  gatherPrimitives,
  readComp,
  requireGeometry,
  resolveOn,
  resolveOnAllowingNonFinite,
} from "./util.js";

/**
 * Resolve one of this file's SCALAR field-capable params — a density
 * threshold, or a comparison's right-hand side — to exactly one number per
 * element of the filter's OWN domain. `domain` is the filter's domain, not
 * always the point domain: the two primitive filters read one value per
 * PRIMITIVE.
 *
 * GUARDED (`resolveOn`), unlike {@link selfPruneScalar} beside it: none of
 * the three params routed through here has a documented meaning for NaN or
 * ±Infinity, so a non-finite value is a broken expression rather than data
 * and the refusal names the param. The message below is the other half of
 * that contract — a vector here is the likely mistake, since the standard
 * `scale` attribute is a vec3 and a threshold is one number.
 */
function filterScalarColumn(
  nodeType: string,
  geo: Geometry,
  domain: "point" | "primitive",
  param: string,
  value: FieldParam,
  seed: number,
  what: string,
): Column {
  const col = resolveOn(geo, domain, value, seed, nodeType, param);
  if (col.tupleSize !== 1) {
    throw new Error(
      `${nodeType}: param "${param}" must evaluate to ONE number per ${domain} (tupleSize 1), got tupleSize ${col.tupleSize} — ${what} is a single number, and fields broadcast elementwise, so a vec3 such as attribute("scale") yields three numbers per ${domain}. Reduce it to a scalar first, e.g. component(attribute("scale"), 0).`,
    );
  }
  return col;
}

/**
 * The width check every VEC3 field-capable param here shares: a corner or a
 * direction is three numbers, and a scalar broadcasts to all three exactly
 * as a plain scalar written in a graph does.
 *
 * Only the guard is shared, never the resolver — which of the two the
 * caller used is a property of the PARAM (see
 * `resolveOnAllowingNonFinite`): the bounds params document ±Infinity as
 * the way to leave an axis unbounded and so must not be guarded, while
 * `projectToPlane`'s plane has no meaning for a non-finite component at all.
 */
function requireVec3Column(
  nodeType: string,
  param: string,
  domain: string,
  col: Column,
  what: string,
): Column {
  if (col.tupleSize !== 1 && col.tupleSize !== 3) {
    throw new Error(
      `${nodeType}: param "${param}" must evaluate to three components [x, y, z] (tupleSize 3) per ${domain}, or to one number broadcast to all three (tupleSize 1), got tupleSize ${col.tupleSize} — ${what}. Build it with vec(x, y, z), e.g. vec(attribute("minX"), -1000, attribute("minZ")).`,
    );
  }
  return col;
}

/**
 * The `topology` param, ONE object shared verbatim by all five point
 * filters (the registry copies every schema it is handed, so sharing is
 * safe). Five nodes making one decision must not be able to describe it
 * five ways — the same reason {@link insideBoxPredicate} is one predicate
 * and {@link requireUnreferencedPointsRule} is one guard.
 */
const TOPOLOGY_PARAM: ParamSchema = {
  type: "enum",
  default: "drop",
  enum: ["drop", "keep"],
  description:
    "What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter.",
};

/**
 * Returns whether the surviving primitives are KEPT; see
 * {@link requireUnreferencedPointsRule}, whose reasoning this shares. A
 * param's `enum` is metadata for an editor, not a runtime guard, so the
 * value is checked here rather than defaulted through an `else` — five
 * filters silently disagreeing about whether a network survives them is
 * exactly the drift the shared schema above exists to prevent.
 */
function requireTopologyRule(nodeType: string, value: string): boolean {
  if (value !== "drop" && value !== "keep") {
    throw new Error(
      `${nodeType}: topology must be "drop" or "keep", got ${JSON.stringify(value)}; ` +
        '"drop" outputs a point cloud and every primitive goes with the filtered points, ' +
        '"keep" preserves the primitives all of whose points survive (a primitive that loses one point is dropped whole)',
    );
  }
  return value === "keep";
}

/**
 * THE rebuild every point filter ends on, so the five cannot drift on what
 * a filtered geometry IS.
 *
 * `keep` is ascending and distinct — every caller here fills it by walking
 * the point domain in order.
 *
 * The `false` arm is the call this file has always made, unchanged and not
 * re-derived: `topology "drop"` has to stay byte-identical to what shipped.
 * The `true` arm marks the survivors, selects the primitives that lose
 * none of their points, and hands both to the assembler that already
 * renumbers topology and carries the vertex, primitive and detail domains
 * (`gatherPrimitives`, the same helper the two primitive filters use). It
 * runs even when the input has NO primitives, because what the output IS
 * must depend on the graph and never on the data — the rule selfPrune's
 * off-switch comment states.
 */
function rebuildFiltered(geo: Geometry, keep: ArrayLike<number>, keepTopology: boolean): Geometry {
  if (!keepTopology) return gatherPoints(geo, keep);
  const alive = new Uint8Array(geo.pointCount);
  for (let j = 0; j < keep.length; j++) alive[keep[j]] = 1;
  const v2p = geo.vertexToPoint;
  const starts = geo.primVertexStart;
  const counts = geo.primVertexCount;
  const prims: number[] = [];
  const nPrims = geo.primitiveCount;
  for (let p = 0; p < nPrims; p++) {
    const s = starts[p];
    const c = counts[p];
    // Vacuously true for c === 0: a primitive with no vertices references
    // no point, so it loses none. (filterPrimitivesByBounds writes down the
    // opposite vacuous answer for the same case, and the two agree —
    // "where is it" has no answer for a primitive that is nowhere, while
    // "did it lose a point" does.)
    let survives = true;
    for (let j = 0; j < c; j++) {
      if (alive[v2p[s + j]] === 0) {
        survives = false;
        break;
      }
    }
    if (survives) prims.push(p);
  }
  return gatherPrimitives(geo, prims, keep);
}

/** Params of {@link filterByDensity}. */
export interface FilterByDensityParams {
  mode: string;
  threshold: FieldParam;
  seed: number;
  topology: string;
}

/** Keep points by their `density` attribute. */
export const filterByDensity = standardNode<FilterByDensityParams>({
  type: "filterByDensity",
  category: "filter",
  description:
    "Filters points by their `density` point attribute (f32, tuple 1). mode 'threshold' keeps points with density >= threshold; mode 'probabilistic' keeps each point when a deterministic per-point hashed random in [0, 1) is < its density (so density 0 never survives, 1 always does). The probabilistic draw is keyed on each point's IDENTITY — its stored position bits together with its `seed` point attribute — not on its array index, so the same point survives or does not whatever order it arrives in and whichever cell derived it. Two points that share a position AND a seed are one point as far as that draw is concerned and always decide the same way, so a cloud with no per-point seeds (the attribute defaults to 0) decides purely on position. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.",
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
      acceptsField: true,
      description:
        "Minimum density a point needs to survive in 'threshold' mode: a point is kept when its own `density` attribute is >= this. Ignored in 'probabilistic' mode, and a field written here is not even evaluated in that mode — the param nothing reads costs nothing and refuses nothing. As a FIELD it is a PER-POINT threshold, evaluated on the input's points, so each point is tested against the bar IT was given rather than against one number shared by the cloud: attribute(\"minDensity\") lets a value written upstream set each point's own bar, and a noise or a position expression makes the bar vary across the world, which thins one region at 0.8 while another survives at 0.2 in a single cook. The comparison is unchanged and still `density >= threshold`, so a constant field matches the plain number wherever that number is exactly representable in f32 — which is the honest form of the claim, because a field resolves into an f32 COLUMN while a plain param stays the f64 the author wrote. `constant(0.7)` is 0.699999988079071 and a datum sitting between the two lands on different sides of them. That is not a defect to be fixed here but clause 1 of the capability rule showing through, and it is why the equality tests use f32-exact values on purpose. Non-finite values are REFUSED rather than read: a field resolving to NaN or ±Infinity here names this param and stops, because a threshold has no documented meaning for one — unlike selfPrune's radius, where NaN means 'claims no room'. Guard the expression itself (max(x, 1e-6) under a div) if it can produce one.",
    },
    seed: {
      type: "u32",
      default: 0,
      description: "Extra seed for 'probabilistic' mode; change it to re-roll which points survive.",
    },
    topology: TOPOLOGY_PARAM,
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterByDensity");
    const keepTopology = requireTopologyRule("filterByDensity", params.topology);
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
      // Resolved ONCE, before the scan, and only in the mode that reads it.
      // A plain threshold keeps the path it always had rather than going
      // through a column: `constant()` stores f32, and a bar that is not
      // f32-exact would move the point sitting on it.
      if (typeof params.threshold === "number") {
        const t = params.threshold;
        for (let i = 0; i < n; i++) {
          if (density.data[i] >= t) keep.push(i);
        }
      } else {
        // The node's own seed: `seed` above is documented as the extra seed
        // for the probabilistic draw, and this mode never makes one.
        const t = filterScalarColumn(
          "filterByDensity",
          geo,
          "point",
          "threshold",
          params.threshold,
          nodeSeed,
          "a threshold",
        ).data;
        for (let i = 0; i < n; i++) {
          if (density.data[i] >= t[i]) keep.push(i);
        }
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
    return { out: [makeGeometryItem(rebuildFiltered(geo, keep, keepTopology))] };
  },
});

/**
 * The three checks every bounds filter makes before it looks at a point,
 * shared so the two nodes cannot drift apart on the question they exist to
 * answer — which side of a face something is on. Each names the calling
 * node, because a message that says only "boundary" leaves an agent
 * guessing which of two nodes it has to edit.
 *
 * Both enums are checked rather than defaulted through an `else`: which
 * face a point belongs to is a decision no typo should make silently, and
 * an off-by-one-face is invisible until two boxes disagree about something
 * they share.
 */
function requireInsideOutside(nodeType: string, mode: string): boolean {
  if (mode !== "inside" && mode !== "outside") {
    throw new Error(
      `${nodeType}: mode must be "inside" or "outside", got ${JSON.stringify(mode)}`,
    );
  }
  return mode === "inside";
}

/** Returns whether the max faces are INCLUSIVE; see {@link requireInsideOutside}. */
function requireBoundaryRule(nodeType: string, boundary: string): boolean {
  if (boundary !== "halfOpen" && boundary !== "inclusive") {
    throw new Error(
      `${nodeType}: boundary must be "halfOpen" or "inclusive", got ${JSON.stringify(boundary)}; "halfOpen" keeps min <= p < max (the ownership rule: abutting boxes claim a shared face exactly once between them), "inclusive" keeps min <= p <= max (a selection: both boxes claim it)`,
    );
  }
  return boundary === "inclusive";
}

/**
 * Returns whether points no surviving primitive references are DROPPED.
 *
 * Shared by both primitive filters, for the reason
 * {@link insideBoxPredicate} is shared by both bounds filters: what
 * happens to the points a dropped primitive leaves behind is one decision,
 * and two nodes answering it differently would mean a network survives one
 * filter with its halo and the next without it.
 */
function requireUnreferencedPointsRule(nodeType: string, value: string): boolean {
  if (value !== "keep" && value !== "drop") {
    throw new Error(
      `${nodeType}: unreferencedPoints must be "keep" or "drop", got ${JSON.stringify(value)}; ` +
        '"keep" leaves the point domain untouched (indices, attributes and identities stay the input\'s, and unreferenced points remain as isolated leftovers), ' +
        '"drop" removes every point no surviving primitive references and renumbers the topology onto the rest',
    );
  }
  return value === "drop";
}

/**
 * A two-component bound leaves z undefined, and every comparison against
 * undefined is false — so the box would quietly hold nothing (and
 * 'outside' quietly hold everything). The likely source is a World "xz"
 * cell, whose ctx.min / ctx.max ARE 2D, which is exactly the binding these
 * nodes are most often used for.
 *
 * A FIELD bound is skipped here and checked on its resolved column instead
 * ({@link requireVec3Column}), which is the only place its width exists: a
 * field is a recipe until it lands on a domain, and the same
 * two-components-is-a-mistake rule is applied there in the same shape.
 */
function requireBounds3(nodeType: string, boundsMin: FieldParam, boundsMax: FieldParam): void {
  for (const [name, value] of [
    ["boundsMin", boundsMin],
    ["boundsMax", boundsMax],
  ] as const) {
    if (isField(value)) continue;
    const v = value as readonly number[];
    if (v.length < 3) {
      throw new Error(
        `${nodeType}: ${name} needs three components [x, y, z], got ${v.length}; a World "xz" cell's ctx.min / ctx.max are 2D [x, z], so spell the box out as [ctx.min[0], -Infinity, ctx.min[1]] and [ctx.max[0], Infinity, ctx.max[1]]`,
      );
    }
  }
}

/**
 * THE face rule: the ONE expression in this library that decides which side
 * of a box face a coordinate falls on.
 *
 * One boolean, which each caller negates for its 'outside' mode, so the
 * complement is exact by construction under either rule — a second
 * predicate for the outside case is how a gap or an overlap gets in. And
 * ONE definition across the two nodes (and now across the uniform and
 * per-element closures below), because which side of a FACE a coordinate
 * falls on is the single decision they all exist to make, and the one a
 * partitioned cook is silently wrong about when two boxes answer it
 * differently. The guards above it were already shared for that reason; the
 * decision itself is what actually had to be.
 *
 * A NaN anywhere in it satisfies no comparison, so a point with a NaN
 * coordinate — or one whose own box has a NaN corner — is never inside and
 * always lands in 'outside'.
 *
 * The `inclusive` ternary stays INSIDE rather than splitting into two
 * functions: hoisting it would re-duplicate the face rule, which is exactly
 * what this exists to prevent, and the branch is uniform across a whole
 * cook.
 */
function insideBox(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  inclusive: boolean,
): boolean {
  return (
    x >= ax &&
    y >= ay &&
    z >= az &&
    (inclusive ? x <= bx && y <= by && z <= bz : x < bx && y < by && z < bz)
  );
}

/**
 * The box test, built once per cook and shared by both bounds filters:
 * given a point index and the index of the ELEMENT asking, is that point
 * inside `[boundsMin, boundsMax]` under the active `boundary` rule?
 *
 * The two indices are the same number for `filterByBounds`, whose elements
 * ARE the points it tests. They differ for `filterPrimitivesByBounds`,
 * which asks about a POINT reached through a vertex while the box belongs
 * to the PRIMITIVE doing the asking — so a field bound there is one box per
 * primitive, and every vertex of that primitive is tested against it.
 *
 * A corner arrives either as the plain param (a `readonly number[]`) or as
 * a resolved {@link Column}, and the two are kept on separate closures on
 * purpose. Routing a plain corner through a column would store it as f32,
 * and a face at a bound that is not f32-exact would MOVE — so the uniform
 * closure below is the one that always shipped, reading the raw f64 param.
 */
function insideBoxPredicate(
  pd: ArrayLike<number>,
  ps: number,
  boundsMin: readonly number[] | Column,
  boundsMax: readonly number[] | Column,
  inclusive: boolean,
): (pt: number, elem: number) => boolean {
  const minCol = Array.isArray(boundsMin) ? undefined : (boundsMin as Column);
  const maxCol = Array.isArray(boundsMax) ? undefined : (boundsMax as Column);
  if (minCol === undefined && maxCol === undefined) {
    const [ax, ay, az] = boundsMin as readonly number[];
    const [bx, by, bz] = boundsMax as readonly number[];
    return (pt: number): boolean => {
      const o = pt * ps;
      return insideBox(pd[o], pd[o + 1], pd[o + 2], ax, ay, az, bx, by, bz, inclusive);
    };
  }
  // At least one corner varies per element; whichever does not still reads
  // its raw f64 numbers, so mixing a field min with a plain max costs the
  // max nothing.
  const [ax, ay, az] = minCol === undefined ? (boundsMin as readonly number[]) : [0, 0, 0];
  const [bx, by, bz] = maxCol === undefined ? (boundsMax as readonly number[]) : [0, 0, 0];
  return (pt: number, elem: number): boolean => {
    const o = pt * ps;
    return insideBox(
      pd[o],
      pd[o + 1],
      pd[o + 2],
      minCol === undefined ? ax : readComp(minCol, elem, 0),
      minCol === undefined ? ay : readComp(minCol, elem, 1),
      minCol === undefined ? az : readComp(minCol, elem, 2),
      maxCol === undefined ? bx : readComp(maxCol, elem, 0),
      maxCol === undefined ? by : readComp(maxCol, elem, 1),
      maxCol === undefined ? bz : readComp(maxCol, elem, 2),
      inclusive,
    );
  };
}

/**
 * Resolve a bounds corner to one box per element of the filter's own
 * domain.
 *
 * Deliberately NOT guarded against non-finite values (see
 * `resolveOnAllowingNonFinite`): both bounds params carry
 * `acceptsInfinite: true` and both descriptions name ±Infinity as the way
 * to leave an axis unbounded, so a throw here would delete a documented
 * meaning rather than protect anything. A NaN component bounds nothing —
 * every comparison against it is false — so that element is never inside,
 * which is exactly what a NaN COORDINATE already does in these nodes.
 */
function boundsColumn(
  nodeType: string,
  geo: Geometry,
  domain: "point" | "primitive",
  param: string,
  value: FieldParam,
  seed: number,
): Column {
  return requireVec3Column(
    nodeType,
    param,
    domain,
    resolveOnAllowingNonFinite(geo, domain, value, seed),
    "a box corner is a position in space",
  );
}

/** Params of {@link filterByBounds}. */
export interface FilterByBoundsParams {
  boundsMin: FieldParam;
  boundsMax: FieldParam;
  mode: string;
  boundary: string;
  topology: string;
}

/** Keep points inside (or outside) an axis-aligned box. */
export const filterByBounds = standardNode<FilterByBoundsParams>({
  type: "filterByBounds",
  category: "filter",
  description:
    "Keeps points by position against the axis-aligned box [boundsMin, boundsMax]. What happens ON a face is the `boundary` param, and it is the difference between a selection and an OWNERSHIP RULE: the default 'halfOpen' keeps min <= p < max on every axis — the min face is inside, the max face is not — so two boxes that MEET at a face (one's max is the other's min, the same number) tile space with no gap and no duplicate, and each point belongs to exactly one of them. That is the rule a grid cell uses, and the one pointScatterInWorld's query window and a World cell rectangle already follow; note that it is the shared ENDPOINT VALUE that makes the tiling exact, so building the boxes as [c*size, (c+1)*size) is exact at any size, while recovering the index arithmetically as floor(p / size) can name the neighbouring cell when size is not exactly representable (floor(67.8 / 0.1) is 677, yet 678*0.1 is exactly 67.8). 'inclusive' keeps min <= p <= max, which is what you want to select a box whose faces carry points on purpose, and which emits a point sitting on a shared face from BOTH neighbouring boxes — harmless in a one-off selection, wrong in a partitioned cook, where a doubled point is invisible until two cells disagree. mode 'outside' is the exact complement of 'inside' under whichever boundary rule is active, so the two modes always partition the input: no point lost, none emitted twice. Infinite bounds work under both rules (every finite coordinate satisfies p < +Infinity), so an axis that should not be bounded — the Y of a World 'xz' column — needs no extra param. A NaN coordinate is never inside, so such a point lands in 'outside'. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsInfinite: true,
      acceptsField: true,
      description:
        "Minimum corner of the box, in world units. INCLUSIVE under both boundary rules: a point lying exactly on this face is inside. Use -Infinity on an axis that should not be bounded (an infinity does not survive JSON, so a graph that must serialize needs a finite bound wide enough to hold the world). As a FIELD it is a PER-POINT corner, evaluated on the input's points, so each point is tested against its OWN box rather than against one box shared by the cloud — which turns this node from 'keep what is in this region' into 'keep every point that is inside the box it carries', the test a per-point cell, plot or footprint written upstream asks for. Build the corner with vec(x, y, z); a scalar field broadcasts to all three axes exactly as a plain scalar would. NON-FINITE VALUES ARE READ, NOT REFUSED — this is one of the few field params where they are data: -Infinity on a component leaves that axis unbounded for that point, exactly as the plain value does, and a NaN component satisfies no comparison at all, so that point is never inside and lands in 'outside'. `inside` and `outside` stay exact complements point by point, since both read the same resolved value for a point — with one caveat a plain box does not have: two SEPARATE nodes resolve their own columns, so a bound built from randomField or nodeSeed differs between them and the pair no longer partitions. Give both nodes the same bounds field to keep it exact.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsInfinite: true,
      acceptsField: true,
      description:
        "Maximum corner of the box, in world units. EXCLUSIVE under the default 'halfOpen' boundary (a point exactly on this face belongs to the next box along), INCLUSIVE under 'inclusive'. Use +Infinity on an axis that should not be bounded. An axis with max <= min keeps nothing under 'halfOpen' — a zero-width box has no interior — while under 'inclusive' max === min still keeps the points lying exactly on that plane. As a FIELD it is a PER-POINT corner on the input's points, with the same reading boundsMin's description gives, and the two are independent: a field min with a plain max is legal and the plain one costs nothing per point. The max <= min rule above then applies PER POINT — a point whose own box is empty on any axis simply fails the test and lands in 'outside'. Non-finite components are read rather than refused (±Infinity unbounds an axis, NaN keeps nothing), and a scalar field broadcasts to all three axes.",
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
    topology: TOPOLOGY_PARAM,
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterByBounds");
    const keepTopology = requireTopologyRule("filterByBounds", params.topology);
    const wantInside = requireInsideOutside("filterByBounds", params.mode);
    const inclusive = requireBoundaryRule("filterByBounds", params.boundary);
    requireBounds3("filterByBounds", params.boundsMin, params.boundsMax);
    const P = geo.attrs.point.require("P");
    // Each corner resolves ONCE, before the scan — never per point, and
    // never per test. A plain corner is not resolved at all; see
    // insideBoxPredicate for why routing one through a column would move a
    // face.
    const minCol = isField(params.boundsMin)
      ? boundsColumn("filterByBounds", geo, "point", "boundsMin", params.boundsMin, nodeSeed)
      : undefined;
    const maxCol = isField(params.boundsMax)
      ? boundsColumn("filterByBounds", geo, "point", "boundsMax", params.boundsMax, nodeSeed)
      : undefined;
    // Built once per cook, never per point — the SoA rule stands.
    const insidePoint = insideBoxPredicate(
      P.data,
      P.tupleSize,
      minCol ?? (params.boundsMin as readonly number[]),
      maxCol ?? (params.boundsMax as readonly number[]),
      inclusive,
    );
    const keep: number[] = [];
    const nPoints = geo.pointCount;
    for (let i = 0; i < nPoints; i++) {
      // The point being tested and the element whose box is being read are
      // the same element here: this filter's domain IS the point domain.
      if (insidePoint(i, i) === wantInside) keep.push(i);
    }
    return { out: [makeGeometryItem(rebuildFiltered(geo, keep, keepTopology))] };
  },
});

/** Params of {@link filterPrimitivesByBounds}. */
export interface FilterPrimitivesByBoundsParams {
  boundsMin: FieldParam;
  boundsMax: FieldParam;
  vertex: string;
  mode: string;
  boundary: string;
  unreferencedPoints: string;
}

/** Keep or drop whole primitives by a bounds test, preserving topology. */
export const filterPrimitivesByBounds = standardNode<FilterPrimitivesByBoundsParams>({
  type: "filterPrimitivesByBounds",
  category: "filter",
  description:
    "Keeps or drops WHOLE PRIMITIVES by testing their vertices against the axis-aligned box [boundsMin, boundsMax], and it is one of the two filters in this library that PRESERVE TOPOLOGY (filterPrimitivesByAttribute, which tests a value a primitive carries rather than where its vertices lie, is the other): the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network. Every point filter — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune — rebuilds the point domain from the survivors and the primitives go with it; this node filters the PRIMITIVE domain instead, which is what makes the difference. It exists to complete the partitioned network cook connectPoints prescribes, whose last step no node could perform: widen the cell's rectangle by `radius` and clip the CLOUD to it with filterByBounds ('halfOpen'), run connectPoints, then run THIS node on the UNWIDENED rectangle with vertex 'first' and the same 'halfOpen' boundary. Each cell then emits exactly the edges it owns, the cells tile the whole-region network with no duplicate and no gap, and the recipe is a serializable graph rather than a TypeScript script. `vertex` decides what 'in the box' means for a primitive: 'first' and 'last' consult ONE vertex, which is what makes them OWNERSHIP rules — every primitive has exactly one first vertex, so exactly one box of a tiling claims it — while 'all' and 'any' are SELECTIONS and do not tile ('any' claims a straddling primitive from every box it reaches, 'all' from none of them). connectPoints emits each edge's lower-keyed endpoint FIRST, so with vertex 'first' this node's owner and that node's canonical edge order are the same choice by construction. For a polyline from any other source — pointsToPath, resamplePath, createPolyline — the first vertex is simply the path's START point: still exactly one owner per path, so the tiling is still exact, but the owner is the cell holding the start rather than the cell holding most of the road, and that one cell emits the whole path however far it runs. `mode` 'outside' is the exact complement of 'inside' under whichever vertex rule and boundary are active, so running both over one input reproduces its primitives exactly once; combined with `vertex` that spans the four quantifiers — 'all'+'inside' keeps primitives lying entirely inside, 'any'+'outside' those lying entirely outside, 'any'+'inside' those touching the box, 'all'+'outside' those not entirely within it. `boundary` is filterByBounds' rule with the same meaning and the same reason to prefer 'halfOpen' wherever ownership matters. POINTS: by default (unreferencedPoints 'keep') the point domain is passed through untouched — same points, same indices, same attributes, same identities — so a partition cell keeps its halo points as isolated leftovers; 'drop' removes every point no surviving primitive references and renumbers the topology onto what is left, which is how a clean network comes out. A geometry with no primitives is not an error but an empty result: a cell too sparse to make an edge is a legitimate, silent case in a partitioned cook. Primitives of any kind are handled, polylines and polys alike — this reads vertices, never `primtype`.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    boundsMin: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsInfinite: true,
      acceptsField: true,
      description:
        "Minimum corner of the box, in world units. INCLUSIVE under both boundary rules: a vertex lying exactly on this face is inside. Use -Infinity on an axis that should not be bounded (note that an infinity does not survive JSON, so a graph that must serialize needs a finite bound wide enough to hold the world). As a FIELD it is evaluated on the PRIMITIVE DOMAIN, not on the points — one corner per primitive, so each primitive is tested against the box IT carries, and every vertex the `vertex` rule consults is tested against that same box. Read a primitive column (attribute(\"cellMinX\") and friends, promoteAttribute lifts a point column onto primitives) or build one with vec(x, y, z); a scalar field broadcasts to all three axes. The reading it enables is 'does this edge lie in ITS OWN cell', which one shared box cannot ask. TILING IS THEN THE AUTHOR'S TO PRESERVE: the ownership guarantee this node's description makes — abutting boxes claim each primitive exactly once — is a property of the BOXES, so per-primitive boxes tile only if they were built to, and boxes that overlap or leave a gap double-count or lose primitives with no error to say so. Non-finite components are read rather than refused: ±Infinity unbounds an axis exactly as the plain value does, and a NaN component satisfies no comparison, so a primitive whose box has one is never inside and lands in 'outside'.",
    },
    boundsMax: {
      type: "vec3",
      default: [1, 1, 1],
      acceptsInfinite: true,
      acceptsField: true,
      description:
        "Maximum corner of the box, in world units. EXCLUSIVE under the default 'halfOpen' boundary (a vertex exactly on this face belongs to the next box along), INCLUSIVE under 'inclusive'. Use +Infinity on an axis that should not be bounded, subject to the serialization note on boundsMin. As a FIELD it is one corner PER PRIMITIVE, with the same reading boundsMin's description gives, and the two are independent: a field min with a plain max is legal and the plain one costs nothing per primitive. A primitive whose own box is empty on an axis (max <= min under 'halfOpen') keeps nothing and lands in 'outside'; non-finite components are read rather than refused; a scalar field broadcasts to all three axes.",
    },
    vertex: {
      type: "enum",
      default: "first",
      enum: ["first", "last", "all", "any"],
      description:
        "Which of a primitive's vertices the box test reads. 'first' (the default) and 'last' read exactly ONE — the primitive's first or last vertex — which is what makes them ownership rules: every primitive has exactly one of each, so abutting boxes under the 'halfOpen' boundary claim it exactly once between them. Use 'first' with connectPoints, whose edges already lead with their lower-keyed endpoint, so the owner a cell computes matches the canonical edge order rather than merely correlating with it. 'all' keeps a primitive only when EVERY vertex is in the box, 'any' when at least one is; both are selections, and neither tiles — 'any' hands a straddling primitive to every box it reaches and 'all' to none of them, so a partitioned cook using either double-counts or loses edges at the seams. A primitive with no vertices is never inside, under all four rules.",
    },
    mode: {
      type: "enum",
      default: "inside",
      enum: ["inside", "outside"],
      description:
        "'inside' keeps the primitives the `vertex` rule places in the box, 'outside' keeps the rest. They are exact complements under whichever vertex rule and boundary are active, so running both over one input reproduces every primitive exactly once. Read the two params together: 'any' with 'outside' keeps primitives lying ENTIRELY outside the box (no vertex inside), which is the deletion 'all' with 'outside' does NOT perform — that one keeps everything not entirely within it, straddlers included.",
    },
    boundary: {
      type: "enum",
      default: "halfOpen",
      enum: ["halfOpen", "inclusive"],
      description:
        "Which faces belong to the box, exactly as in filterByBounds. 'halfOpen' (the default) keeps min <= p < max on every axis, so two boxes meeting at a face claim a vertex lying on it exactly once between them — pair it with vertex 'first' and it is an ownership rule a partitioned cook can tile with. 'inclusive' keeps min <= p <= max, so both boxes claim that vertex, and with vertex 'first' both would emit the same edge; choose it for a selection whose faces carry points on purpose, never for a cook that is split into cells.",
    },
    unreferencedPoints: {
      type: "enum",
      default: "keep",
      enum: ["keep", "drop"],
      description:
        "What happens to points no surviving primitive references. 'keep' (the default) leaves the point domain completely untouched: same points in the same order, so every point index, attribute and identity is still the input's and anything computed per point upstream still lines up — a partition cell keeps its halo points as isolated leftovers beside the network it owns. 'drop' removes them and renumbers the topology onto the points that remain, in ascending input order, which yields a clean network with nothing dangling; the cost is that point indices move, and that a point kept by one cell may also be kept by its neighbour, since an edge crossing a seam needs both of its endpoints wherever it is emitted. Note that 'drop' also drops points that had NO primitive to begin with, so a cloud carrying both a road network and unrelated scatter loses the scatter — filter such a cloud before the network is built, or keep the leftovers.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterPrimitivesByBounds");
    const who = "filterPrimitivesByBounds";
    const wantInside = requireInsideOutside(who, params.mode);
    const inclusive = requireBoundaryRule(who, params.boundary);
    requireBounds3(who, params.boundsMin, params.boundsMax);
    const vertexRule = params.vertex;
    if (
      vertexRule !== "first" &&
      vertexRule !== "last" &&
      vertexRule !== "all" &&
      vertexRule !== "any"
    ) {
      throw new Error(
        `${who}: vertex must be "first", "last", "all" or "any", got ${JSON.stringify(vertexRule)}; ` +
          '"first" and "last" test ONE vertex and are the ownership rules a partitioned cook tiles with (use "first" after connectPoints, whose edges lead with their lower-keyed endpoint); ' +
          '"all" and "any" test every vertex and are selections — neither tiles, since a primitive straddling a seam is claimed by every cell under "any" and by none under "all"',
      );
    }
    const drop = requireUnreferencedPointsRule(who, params.unreferencedPoints);
    // Named here rather than left to `require("P")`, which would report a
    // bare attribute name and leave an agent hunting for the node.
    const P = geo.attrs.point.get("P");
    if (!P) {
      throw new Error(
        `${who}: input has no point attribute "P"; every point cloud in this library carries one — available: ${geo.attrs.point.names().join(", ") || "(none)"}`,
      );
    }
    if (P.type === "string" || P.tupleSize < 3) {
      throw new Error(
        `${who}: point attribute "P" is ${P.type}${P.tupleSize === 1 ? "" : `x${P.tupleSize}`}, but a box test needs x, y and z (f32, tupleSize 3); something upstream overwrote P`,
      );
    }
    // Each corner resolves ONCE, before the scan, on THIS node's own domain:
    // a field bound here is one box per PRIMITIVE, not per point, so the
    // element index below is `p` while the position read is a vertex's
    // point. A plain corner is not resolved at all.
    const minCol = isField(params.boundsMin)
      ? boundsColumn(who, geo, "primitive", "boundsMin", params.boundsMin, nodeSeed)
      : undefined;
    const maxCol = isField(params.boundsMax)
      ? boundsColumn(who, geo, "primitive", "boundsMax", params.boundsMax, nodeSeed)
      : undefined;
    // The same box test filterByBounds runs, built once per cook and never
    // per vertex, so the two nodes cannot disagree about a face.
    const insidePoint = insideBoxPredicate(
      P.data,
      P.tupleSize,
      minCol ?? (params.boundsMin as readonly number[]),
      maxCol ?? (params.boundsMax as readonly number[]),
      inclusive,
    );
    const v2p = geo.vertexToPoint;
    const starts = geo.primVertexStart;
    const counts = geo.primVertexCount;
    const keep: number[] = [];
    const nPrims = geo.primitiveCount;
    for (let p = 0; p < nPrims; p++) {
      const c = counts[p];
      const s = starts[p];
      let inside: boolean;
      if (c === 0) {
        // Nothing to test: not inside under every rule, including the
        // vacuous-truth reading of "all", so the four rules agree.
        inside = false;
      } else if (vertexRule === "first") {
        inside = insidePoint(v2p[s], p);
      } else if (vertexRule === "last") {
        inside = insidePoint(v2p[s + c - 1], p);
      } else {
        const wantAll = vertexRule === "all";
        inside = wantAll;
        for (let j = 0; j < c; j++) {
          if (insidePoint(v2p[s + j], p) !== wantAll) {
            inside = !wantAll;
            break;
          }
        }
      }
      if (inside === wantInside) keep.push(p);
    }
    return { out: [makeGeometryItem(gatherPrimitives(geo, keep, drop ? "referenced" : "all"))] };
  },
});

// The attribute comparison, defined once and read by both domains.

/** The comparison set both attribute filters offer, in menu order. */
const COMPARISONS = ["eq", "ne", "lt", "le", "gt", "ge"] as const;

/** One of {@link COMPARISONS}, once {@link requireComparison} has checked it. */
type Comparison = (typeof COMPARISONS)[number];

/** `f32x3`, or just `bool` when the tuple is 1 — the golden's spelling. */
function shapeOf(attr: Attribute): string {
  return attr.tupleSize === 1 ? attr.type : `${attr.type}x${attr.tupleSize}`;
}

/**
 * Check the comparison BEFORE the geometry is consulted, so a typo is
 * reported as a typo rather than as whatever the attribute lookup happens
 * to say next.
 *
 * The enum in a param schema is metadata for an editor, not a runtime
 * guard, so an unchecked comparison used to fall through the chain to the
 * `ge` arm and answer a question nobody asked.
 */
function requireComparison(nodeType: string, comparison: string): Comparison {
  if (!(COMPARISONS as readonly string[]).includes(comparison)) {
    throw new Error(
      `${nodeType}: comparison must be one of ${COMPARISONS.join(", ")}, got ${JSON.stringify(comparison)}; ` +
        "eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=) — and a string attribute allows only eq and ne",
    );
  }
  return comparison as Comparison;
}

/**
 * The sentence that turns "not found" into a fix when the name IS in this
 * geometry, on another domain.
 *
 * The POINT/PRIMITIVE confusion is not a slip, it is the idiom these two
 * nodes replace: before a primitive-domain filter existed, the only way to
 * test a primitive attribute was to let a sampler flatten it onto points
 * (samplers carry primitive columns down automatically) and then reach for
 * filterByAttribute. Graphs written that way are everywhere, so the
 * message names the other node by name rather than merely listing what is
 * available.
 */
function otherDomainHint(
  geo: Geometry,
  domain: "point" | "primitive",
  name: string,
): string {
  const twin = domain === "point" ? "primitive" : "point";
  for (const other of [twin, "vertex", "detail"] as const) {
    const found = geo.attrs[other].get(name);
    if (!found) continue;
    const shape = shapeOf(found);
    if (other !== twin) {
      return (
        ` — but "${name}" IS a ${shape} ${other} attribute here, so move it onto the ${domain} domain first ` +
        `with promoteAttribute (name "${name}", from "${other}", to "${domain}")`
      );
    }
    return domain === "primitive"
      ? ` — but "${name}" IS a ${shape} POINT attribute here, which is the likeliest mix-up: this node keeps whole ` +
          `PRIMITIVES and reads the PRIMITIVE domain, which is what lets a filtered network stay a network. Either ` +
          `lift the column with promoteAttribute (name "${name}", from "point", to "primitive") and filter here, or ` +
          `filter the points with filterByAttribute — same comparisons, but it rebuilds the point domain, so it only ` +
          `reads right once a sampler has already flattened the primitives to points, and it keeps a network only ` +
          `under its topology "keep" (which drops every primitive that loses a point, not just the ones you tested)`
      : ` — but "${name}" IS a ${shape} PRIMITIVE attribute here: filterByAttribute filters POINTS and outputs a ` +
          `point cloud, so the primitives carrying "${name}" would not survive it in any case. Keep whole primitives ` +
          `with filterPrimitivesByAttribute, which reads the primitive domain directly and preserves topology, or ` +
          `push the column down with promoteAttribute (name "${name}", from "primitive", to "point") if points are ` +
          `genuinely what you want`;
  }
  return "";
}

/**
 * Resolve the scalar column an attribute filter compares, on ITS OWN
 * domain, naming the node, the attribute, the domain and the way out.
 */
function requireFilterAttribute(
  nodeType: string,
  geo: Geometry,
  domain: "point" | "primitive",
  name: string,
): Attribute {
  const set = domain === "point" ? geo.attrs.point : geo.attrs.primitive;
  const attr = set.get(name);
  if (!attr) {
    // No primitives AND no primitive columns is a different diagnosis from
    // a misspelling: the topology was dropped upstream, or never built.
    // Every point-removing node rebuilds the point domain and takes the
    // primitives with it, so a filter placed one node too late reads an
    // empty domain and would otherwise be told only that a name is missing.
    const gone =
      domain === "primitive" && geo.primitiveCount === 0 && set.names().length === 0
        ? ` — and this geometry has no primitives at all, so either none was ever built (pointsToPath, connectPoints, meshPrimitive) or a node between the builder and here removed points and the topology went with them (filterByDensity, filterByBounds, filterByAttribute, filterByExpression and selfPrune all take topology "keep", which preserves the primitives that lose no point; partitionByAttribute and mergePoints do not, and need the network rebuilt after them)`
        : "";
    throw new Error(
      `${nodeType}: ${domain} attribute "${name}" not found; available: ${set.names().join(", ") || "(none)"}` +
        `${otherDomainHint(geo, domain, name)}${gone}`,
    );
  }
  if (attr.tupleSize !== 1) {
    throw new Error(
      `${nodeType}: ${domain} attribute "${name}" has tuple size ${attr.tupleSize} (${shapeOf(attr)}); ` +
        "only scalar (tuple 1) attributes can be filtered — comparing a vector yields a vector of flags rather " +
        "than a decision. Copy the one component you mean onto a scalar column upstream (setAttribute) and filter that.",
    );
  }
  return attr;
}

/**
 * THE comparison, built once per cook and shared by both attribute
 * filters: given an element index on the filter's own domain, does its
 * value satisfy the test?
 *
 * One definition across the two nodes for the reason
 * {@link insideBox} is one: `ge` on a bool, `eq` against a NaN and the
 * string/numeric split are the decisions they both exist to make, and a
 * graph that moves a filter from the point domain to the primitive domain
 * must not change its answer.
 *
 * `value` is the right-hand side: one number for every element, or a
 * resolved {@link Column} holding one per element of the filter's own
 * domain — read at the same index as the value it is compared against, so
 * `data[i] >= rhs[i]` is each element tested against its own bar. The two
 * arms are written out rather than funnelled through a per-element reader
 * closure, because the twelve one-line comparisons ARE the definition this
 * function exists to keep in one place; a plain value also keeps its raw
 * f64 self this way, where a column would have rounded it to f32.
 */
function comparisonPredicate(
  nodeType: string,
  domain: "point" | "primitive",
  attr: Attribute,
  comparison: Comparison,
  value: number | Column,
  stringValue: string,
): (i: number) => boolean {
  if (attr.type === "string") {
    if (comparison !== "eq" && comparison !== "ne") {
      throw new Error(
        `${nodeType}: ${domain} attribute "${attr.name}" is a string, and string attributes support only ` +
          `comparisons "eq" and "ne", got "${comparison}"; the right-hand side is the stringValue param, and an ` +
          "ordering test needs a numeric column",
      );
    }
    const wantEqual = comparison === "eq";
    return (i: number): boolean => (attr.getString(i) === stringValue) === wantEqual;
  }
  const data = attr.data;
  if (typeof value !== "number") {
    // A per-element right-hand side (tupleSize 1, guaranteed by
    // filterScalarColumn), read at the element's own index.
    const rhs = value.data;
    switch (comparison) {
      case "eq":
        return (i: number): boolean => data[i] === rhs[i];
      case "ne":
        return (i: number): boolean => data[i] !== rhs[i];
      case "lt":
        return (i: number): boolean => data[i] < rhs[i];
      case "le":
        return (i: number): boolean => data[i] <= rhs[i];
      case "gt":
        return (i: number): boolean => data[i] > rhs[i];
      default:
        return (i: number): boolean => data[i] >= rhs[i];
    }
  }
  const rhs = value;
  switch (comparison) {
    case "eq":
      return (i: number): boolean => data[i] === rhs;
    case "ne":
      return (i: number): boolean => data[i] !== rhs;
    case "lt":
      return (i: number): boolean => data[i] < rhs;
    case "le":
      return (i: number): boolean => data[i] <= rhs;
    case "gt":
      return (i: number): boolean => data[i] > rhs;
    default:
      return (i: number): boolean => data[i] >= rhs;
  }
}

/**
 * The right-hand side an attribute filter compares against: `value` as it
 * stands when it is a plain number, one number per element when it is a
 * field, and an unread 0 when the attribute is a STRING one.
 *
 * A field is resolved only for a NUMERIC attribute, deliberately. `value`
 * is documented as ignored for a string attribute, and evaluating a field
 * no comparison reads would spend a column on nothing — and could refuse
 * the graph outright (the resolver rejects a non-finite result) over a
 * param nobody consulted.
 */
function comparisonRhs(
  nodeType: string,
  geo: Geometry,
  domain: "point" | "primitive",
  attr: Attribute,
  value: FieldParam,
  seed: number,
): number | Column {
  if (typeof value === "number") return value;
  if (attr.type === "string") return 0;
  return filterScalarColumn(
    nodeType,
    geo,
    domain,
    "value",
    value,
    seed,
    "a right-hand side to compare against",
  );
}

/** Params of {@link filterByAttribute}. */
export interface FilterByAttributeParams {
  attribute: string;
  comparison: string;
  value: FieldParam;
  stringValue: string;
  topology: string;
}

/** Keep points by comparing a scalar or string point attribute. */
export const filterByAttribute = standardNode<FilterByAttributeParams>({
  type: "filterByAttribute",
  category: "filter",
  description:
    "Keeps points whose named point attribute satisfies a comparison. Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value` with any comparison. String attributes compare against `stringValue` and support only 'eq' and 'ne'. Output is a point cloud of the survivors with all attributes carried, so by default the topology describing the points that are gone goes with them — all of it. Two ways to keep a network a network: set `topology` to 'keep' here, which preserves every primitive ALL of whose points survived and drops the rest, or reach for filterPrimitivesByAttribute, which is this node at the PRIMITIVE domain and tests a value the primitive itself carries.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    attribute: {
      type: "string",
      default: "density",
      description:
        "Name of the POINT attribute to test. Must exist on the point domain with tuple size 1. A name that exists on the primitive domain instead is refused with the fix, since filtering a primitive column here means letting a sampler flatten it onto points first.",
    },
    comparison: {
      type: "enum",
      default: "ge",
      enum: [...COMPARISONS],
      description:
        "Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne.",
    },
    value: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Right-hand side for numeric attributes. Ignored for string attributes, and a field written here is not even evaluated for one — the param nothing reads costs nothing and refuses nothing. As a FIELD it is a PER-POINT right-hand side, evaluated on the input's points, so each point is compared against its own number: `attribute(\"minLevel\")` with comparison 'ge' keeps every point that clears the bar it was given, and a noise or a position expression makes the bar vary across the world. The comparison itself is unchanged — the same six operators, the same meaning per point — so this is the two-column test (attribute against attribute) that otherwise needs a scratch column plus filterByExpression. A a constant field matches the plain number wherever that number is exactly representable in f32 — which is the honest form of the claim, because a field resolves into an f32 COLUMN while a plain param stays the f64 the author wrote. `constant(0.7)` is 0.699999988079071 and a datum sitting between the two lands on different sides of them. That is not a defect to be fixed here but clause 1 of the capability rule showing through, and it is why the equality tests use f32-exact values on purpose. Non-finite values are REFUSED rather than read: a field resolving to NaN or ±Infinity names this param and stops, because a right-hand side has no documented meaning for one. Note that this refusal is about the FIELD, never about the attribute — a NaN in the COLUMN being tested is still data and still passes only 'ne'.",
    },
    stringValue: {
      type: "string",
      default: "",
      description: "Right-hand side for string attributes. Ignored for numeric attributes.",
    },
    topology: TOPOLOGY_PARAM,
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const who = "filterByAttribute";
    const geo = requireGeometry(inputs, "in", who);
    const cmp = requireComparison(who, params.comparison);
    const keepTopology = requireTopologyRule(who, params.topology);
    const attr = requireFilterAttribute(who, geo, "point", params.attribute);
    // Resolved ONCE, before the scan; nothing below mutates the geometry, so
    // a column aliasing attribute storage stays valid for the whole walk.
    const rhs = comparisonRhs(who, geo, "point", attr, params.value, nodeSeed);
    // Built once per cook, never per point — the SoA rule stands.
    const pass = comparisonPredicate(who, "point", attr, cmp, rhs, params.stringValue);
    const keep: number[] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      if (pass(i)) keep.push(i);
    }
    return { out: [makeGeometryItem(rebuildFiltered(geo, keep, keepTopology))] };
  },
});

/** Params of {@link filterPrimitivesByAttribute}. */
export interface FilterPrimitivesByAttributeParams {
  attribute: string;
  comparison: string;
  value: FieldParam;
  stringValue: string;
  unreferencedPoints: string;
}

/** Keep whole primitives by comparing a primitive attribute, preserving topology. */
export const filterPrimitivesByAttribute = standardNode<FilterPrimitivesByAttributeParams>({
  type: "filterPrimitivesByAttribute",
  category: "filter",
  description:
    "Keeps WHOLE PRIMITIVES whose named PRIMITIVE attribute satisfies a comparison, and preserves topology: the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network. It is filterByAttribute at the primitive domain — the same six comparisons, the same numeric/string split, the same scalar-only rule — and filterPrimitivesByBounds' sibling, differing only in what it asks about a primitive (a value it carries, rather than where its vertices lie). Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value`; string attributes compare against `stringValue` and allow only 'eq' and 'ne', which includes `primtype`, so 'primtype eq polyline' is how a mixed geometry is narrowed to its curves. WHY IT MATTERS WHERE THE FILTER SITS: a primitive attribute — connectPoints' edge length, a promoted density, anything promoteAttribute lifted onto the primitive domain — can also be read AFTER a sampler has flattened it onto points, because every sampler carries primitive columns down onto the points it makes; filterByAttribute then works, and that is how such graphs were written before this node existed. The cost is that the flattening, and everything downstream of it, runs on primitives that were always going to be discarded. Filtering here instead discards them while they are still primitives, so the work that follows is proportional to what survives rather than to what was proposed. POINTS: by default (unreferencedPoints 'keep') the point domain is passed through untouched — same points, same indices, same attributes, same identities — so anything computed per point upstream still lines up and a partition cell keeps its halo; 'drop' removes every point no surviving primitive references and renumbers the topology onto what is left, which is how a clean network comes out. DETERMINISM: the test reads one primitive's own value and nothing else — not its index, not its neighbours, not how many primitives there are — so the survivors and their order are the input's however the cook was partitioned, and no index column is emitted for a per-partition number to leak through. An EMPTY primitive domain that still carries the named column is an empty result rather than an error, as in filterPrimitivesByBounds: a cell too sparse to make a primitive is a legitimate, silent case in a partitioned cook. A geometry with no primitive columns at all is refused instead, and told so — that is a topology never built or dropped upstream, not a sparse cell.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    attribute: {
      type: "string",
      default: "edgeLength",
      description:
        "Name of the PRIMITIVE attribute to test. Must exist on the primitive domain with tuple size 1. The default names connectPoints' own convention for its `lengthAttr`, which is the commonest key here; `primtype` is always present once a geometry has topology and is tested with 'eq'/'ne' against stringValue. A name that exists on the POINT domain instead is refused with the fix, since that is the shape of the idiom this node replaces.",
    },
    comparison: {
      type: "enum",
      default: "ge",
      enum: [...COMPARISONS],
      description:
        "Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne. Identical to filterByAttribute's, deliberately: moving a filter between the two domains must not change what it means.",
    },
    value: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Right-hand side for numeric attributes. Ignored for string attributes, and a field written here is not even evaluated for one. As a FIELD it is evaluated on the PRIMITIVE DOMAIN — one right-hand side per primitive, never per point — so each primitive is compared against its own number: `attribute(\"maxLength\")` with comparison 'le' keeps every edge shorter than the limit IT carries, which is the per-primitive budget one shared number cannot express. Everything else is unchanged: the same six operators with the same meaning, the same scalar-only rule, and a a constant field matches the plain number wherever that number is exactly representable in f32 — which is the honest form of the claim, because a field resolves into an f32 COLUMN while a plain param stays the f64 the author wrote. `constant(0.7)` is 0.699999988079071 and a datum sitting between the two lands on different sides of them. That is not a defect to be fixed here but clause 1 of the capability rule showing through, and it is why the equality tests use f32-exact values on purpose. Because the value is read per primitive and nothing else — not its index, not its neighbours, not how many primitives there are — the determinism the node's description promises is unaffected, PROVIDED the field is too: a field reading position or a primitive attribute is partition-independent, while randomField and nodeSeed are per-node and per-cell like any other seeded draw. Non-finite values are REFUSED rather than read, naming this param: a right-hand side has no documented meaning for NaN or ±Infinity. That is about the FIELD only — a NaN in the primitive COLUMN being tested is still data, and still passes only 'ne'.",
    },
    stringValue: {
      type: "string",
      default: "",
      description: "Right-hand side for string attributes. Ignored for numeric attributes.",
    },
    unreferencedPoints: {
      type: "enum",
      default: "keep",
      enum: ["keep", "drop"],
      description:
        "What happens to points no surviving primitive references, exactly as in filterPrimitivesByBounds. 'keep' (the default) leaves the point domain completely untouched: same points in the same order, so every point index, attribute and identity is still the input's. 'drop' removes them and renumbers the topology onto the points that remain, in ascending input order, which yields a clean network with nothing dangling; the cost is that point indices move. Note that 'drop' also drops points that had NO primitive to begin with, so a cloud carrying both a network and unrelated scatter loses the scatter.",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const who = "filterPrimitivesByAttribute";
    const geo = requireGeometry(inputs, "in", who);
    // Params before the attribute lookup, so a misspelled comparison is
    // reported as a misspelled comparison rather than as whatever the
    // domain happens to be missing.
    const cmp = requireComparison(who, params.comparison);
    const drop = requireUnreferencedPointsRule(who, params.unreferencedPoints);
    const attr = requireFilterAttribute(who, geo, "primitive", params.attribute);
    // Resolved ONCE, on THIS node's own domain: one right-hand side per
    // primitive, aligned with the primitive column it is compared against.
    const rhs = comparisonRhs(who, geo, "primitive", attr, params.value, nodeSeed);
    const pass = comparisonPredicate(who, "primitive", attr, cmp, rhs, params.stringValue);
    const keep: number[] = [];
    const nPrims = geo.primitiveCount;
    for (let p = 0; p < nPrims; p++) {
      if (pass(p)) keep.push(p);
    }
    return { out: [makeGeometryItem(gatherPrimitives(geo, keep, drop ? "referenced" : "all"))] };
  },
});

/** Params of {@link filterByExpression}. */
export interface FilterByExpressionParams {
  predicate: FieldParam;
  seed: number;
  topology: string;
}

/** Keep points where a boolean field predicate holds. */
export const filterByExpression = standardNode<FilterByExpressionParams>({
  type: "filterByExpression",
  category: "filter",
  description:
    "Keeps points where a field-capable `predicate` evaluates to a non-zero number. The predicate is resolved once over the input's point domain, so it can read position, any attribute, noise, or per-point randomness — which means a test that would otherwise need a scratch attribute plus filterByAttribute becomes one node, with no leftover column on the output. Comparison field functions (gt/ge/lt/le/eq/ne) already yield 1 and 0, and combining them with mul acts as AND, max as OR. NaN never passes, so a predicate that fails to compute drops the point instead of keeping it. The predicate must evaluate to tuple size 1: comparisons broadcast elementwise, so comparing a vector yields a vector of flags, which is not a decision. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.",
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
        "Extra seed for evaluating `predicate`: 0 (the default) uses the node's derived seed unchanged; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the evaluation context (randomField, the per-point seed attribute, and the `nodeSeed` field) but not a noise on its own, whose seed lives inside its own field spec — a noise moves with this only when its `opts.position` reads `nodeSeed`.",
    },
    topology: TOPOLOGY_PARAM,
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = requireGeometry(inputs, "in", "filterByExpression");
    const keepTopology = requireTopologyRule("filterByExpression", params.topology);
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
    // Deliberately NOT guarded against non-finite values: a NaN predicate
    // means DROP THIS POINT, which this node's own description states and
    // the `> 0 || < 0` test below implements. A throw would delete a
    // documented meaning — see resolveOnAllowingNonFinite.
    const col = resolveOnAllowingNonFinite(geo, "point", params.predicate, seed);
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
    return { out: [makeGeometryItem(rebuildFiltered(geo, keep, keepTopology))] };
  },
});

/** Params of {@link selfPrune}. */
export interface SelfPruneParams {
  mode: string;
  minDistance: FieldParam;
  priority: FieldParam;
  topology: string;
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
  // Deliberately NOT guarded against non-finite values, for BOTH params
  // (see resolveOnAllowingNonFinite): a NaN radius claims nothing (every
  // distance involving it compares false, the spatial index's documented
  // tolerance) and a NaN rank loses every contest, falling through to the
  // identity tiebreak. Both are stated in the two param descriptions and
  // pinned by tests — "treats 0, negative and NaN radii as claiming
  // nothing, but still prunes them", and "ranks NaN lowest".
  const col = resolveOnAllowingNonFinite(geo, "point", value, seed);
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

/**
 * The one number a field-capable scalar param stands for when it is
 * statically uniform, or undefined when it is a real expression.
 *
 * A plain number is one. So is a field whose WHOLE spec is a `constant`,
 * which is the same literal spelled the other way — it is the spec an
 * editor seeds when a knob is flipped to field mode, so it is the FIRST
 * thing a caller cooks — and a value cannot mean two things depending on
 * which of the two spellings carried it.
 *
 * The distinction this keeps is between a graph LITERAL and DATA. A
 * `constant` spec is authored, fixed before any point exists, and reading
 * it here decides nothing from the cook's numbers; a field that reads an
 * attribute, a position or a random is data, and is deliberately NOT
 * resolved here even when every value it returns is identical.
 */
function staticScalar(value: FieldParam): number | undefined {
  if (typeof value === "number") return value;
  if (!isField(value)) return undefined;
  const spec = peekFieldSpec(value);
  if (spec === undefined || spec.fn !== "constant") return undefined;
  const literal = spec.value;
  if (typeof literal === "number") return literal;
  // A 1-tuple constant is the scalar spelling with brackets round it.
  return Array.isArray(literal) && literal.length === 1 && typeof literal[0] === "number"
    ? literal[0]
    : undefined;
}

/** Minimum-distance pruning: greedy, or the partition-safe local maximum. */
export const selfPrune = standardNode<SelfPruneParams>({
  type: "selfPrune",
  category: "filter",
  description:
    "Enforces a minimum distance between points, under one of two rules chosen by `mode`. The default 'greedy' considers points one at a time and keeps a point only when every already-kept point is at least minDistance away; it packs points densely, and it CANNOT BE SPLIT ACROSS CELLS — a point's fate depends on whether its neighbour survived, which depends on ITS neighbour, an unbounded chain that no halo width covers, so running it per cell in a partitioned or World cook silently produces survivors that differ with the cell size and seam pairs closer than minDistance (measured: 1.41 apart where 3 was asked for) that read as a rendering artifact rather than as this node. Use mode 'localMaximum' there: it decides each point from its immediate neighbours alone, which makes a halo of minDistance exactly sufficient, at the price of keeping fewer points. Both rules settle every contest the same way — `priority` DESCENDING (higher priority survives) with ties broken by the LOWER point IDENTITY, a hash of the point's stored position bits and its `seed` point attribute, NOT its array index. That is what makes the survivors a property of the points rather than of the order they arrived in: shuffle the input, filter something upstream, or derive the same region inside another cell's halo, and the same points survive. With priority left alone every point ties, so identity alone decides, and the result is a spatially unbiased thinning rather than the front-of-the-array-wins prune an index order gives. Points that are indistinguishable — same position AND same seed — fall back to the lower index, since nothing else separates them. Both params are field-capable: a field `minDistance` is a PER-POINT radius (scale-aware declutter — big trees claim more room than bushes), and a pair then conflicts when it is closer than the LARGER of the two radii, so no kept point ever has another kept point inside its own radius. Survivors always come out in ascending INPUT index order; priority chooses who survives, never the order of the output. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.",
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
        "Minimum allowed distance between two kept points, in world units. As a FIELD it is a per-point radius, evaluated on the input's points, and two points conflict when they are closer than the LARGER of their two radii (never the smaller, which would let a big point be crowded by a small one, and never the sum, which would double the spacing of an evenly-sized cloud and so disagree with the same number passed plainly). A per-point radius that is 0, negative or NaN claims no room of its own, but such a point can still be pruned by a bigger neighbour. A minDistance of 0 or less turns the node off: every point survives, topology included, and `priority` is not evaluated, whichever mode is set. That is a property of the VALUE, so both spellings of it get there — a plain 0 and a `constant` field of 0 are one graph literal written two ways, and they cook to the same geometry. A field that READS anything (an attribute, a position, a random) never takes that shortcut, even when every value it returns is 0: it always outputs a point cloud, so what the output IS depends on the graph and never on the numbers that come back. This is also the HALO WIDTH a cell needs under mode 'localMaximum', and as a field that width is the GLOBAL MAXIMUM the field can return anywhere in the world — not each point's own radius, since a big point reaches that far into its neighbours, and NOT the largest radius present in the cell's cloud, which is circular: the cloud a cell sees has already been clipped by the very halo you are trying to size, so the big neighbour that would have set the width is precisely the one it cannot see. Bound the field instead of measuring it — a constant times the range of whatever drives it (e.g. a noise field is in [-1, 1], so `2 + 3 * noise` maxes at 5; a radius read from an attribute maxes at that attribute's maximum over the WHOLE world, not over this cell) — and pass that bound as the halo. Overestimating costs a wider query; underestimating silently keeps pairs closer than the field asked for, at the seams only.",
    },
    priority: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Per-point survival priority: HIGHER WINS. Points are considered in descending priority, so a point at priority 1 survives against a neighbour at priority 0 whichever of them the tiebreak would have preferred — this is how authored points beat procedural ones by SAYING so, instead of by being merged onto an earlier pin. Field-capable and evaluated on the input's points: attribute(\"locked\") ranks by a flag written upstream (merge the layers with mergePoints first — an attribute missing on one input fills with its default there), and randomField(\"key\") re-rolls the thinning when the key changes. Equal priorities break to the LOWER point IDENTITY (position bits plus the `seed` attribute), and NaN ranks lowest. The default 0 ties every point, so identity alone picks the survivors — which is already unbiased, so a random priority is for re-rolling, not for undoing an ordering bias. This decides WHO survives, never the output order.",
    },
    topology: TOPOLOGY_PARAM,
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
    // Checked here, ABOVE the off-switch below, for the reason `mode` is:
    // a typo must not pass silently just because this cook happened to
    // take the pass-through path.
    const keepTopology = requireTopologyRule("selfPrune", params.topology);
    const P = geo.attrs.point.require("P");
    const pd = P.data;
    const ps = P.tupleSize;
    const n = geo.pointCount;
    // A non-positive minDistance turns the node off, as it always has:
    // the input passes through cloned, topology and all. It is the VALUE
    // that turns it off, so both spellings of the same literal reach here
    // — a plain 0 and a `constant` field of 0 are one graph, and used to
    // be two geometries. A field that could VARY still never takes this
    // path, even when every value it returns is 0: whether the output
    // carries topology must not depend on the data, only on the graph.
    const uniform = staticScalar(params.minDistance);
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
    return { out: [makeGeometryItem(rebuildFiltered(geo, keep, keepTopology))] };
  },
});

/** Params of {@link projectToPlane}. */
export interface ProjectToPlaneParams {
  origin: FieldParam;
  normal: FieldParam;
  keepOffset: boolean;
}

/** Orthogonally project points onto a plane. */
export const projectToPlane = standardNode<ProjectToPlaneParams>({
  type: "projectToPlane",
  category: "filter",
  description:
    "Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally). As plain vectors they describe ONE plane and the normal must be non-zero; as fields they are read per point, so each point falls onto the plane IT was given and a zero normal there is not a plane at all — that point is left exactly where it stands. With keepOffset enabled, the signed distance each point moved (positive along the normal) is stored in a `planeOffset` point attribute (f32, tuple 1) before projecting, so the flattening is invertible. This node is categorised as a filter but removes nothing: the point count, the attributes and the topology all come out as they went in.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    origin: {
      type: "vec3",
      default: [0, 0, 0],
      acceptsField: true,
      description:
        "A point on the plane, in world units. As a FIELD it is a PER-POINT origin, evaluated on the input's points, so each point is projected onto a plane sliding with it — with a constant normal that is a per-point OFFSET along that normal, which is how a stepped or terraced flattening is written (floor the height, feed it back as the origin) rather than one flat sheet. Build it with vec(x, y, z); a scalar field broadcasts to all three axes. Only the component along the normal can matter, since the projection subtracts (P - origin) . n: two origins differing by anything perpendicular to the normal name the same plane and move nothing. Non-finite values are REFUSED rather than read, naming this param — a plane through NaN has no meaning, and the resulting positions would draw nothing downstream.",
    },
    normal: {
      type: "vec3",
      default: [0, 1, 0],
      acceptsField: true,
      description:
        "Plane normal; any non-zero vector (normalized internally). As a FIELD it is a PER-POINT normal, evaluated on the input's points, so each point is projected along the direction IT carries — attribute(\"N\") flattens every point onto its own surface plane, and a varying normal collapses a cloud onto a fan of planes rather than one. A ZERO-LENGTH NORMAL IS THE ONE REFUSAL THAT CHANGES SHAPE HERE, and it changes only for a field: a plain zero vector is still refused outright, because one plane that does not exist is an authoring mistake with nothing to salvage, while a field's zero is a per-point answer — that point has no plane, so it is left exactly where it stands and its planeOffset is 0 (it moved nothing). Nothing is invented for it and nothing is dropped; a point that did not move is visible as an offset of 0. Scale is free either way, since the vector is normalized before use, and a scalar field broadcasts to all three axes — note that vec(1,1,1) is a diagonal plane, not an axis one. Non-finite components are REFUSED rather than read, naming this param: a NaN normal would normalize to NaN and send every coordinate of that point to NaN.",
    },
    keepOffset: {
      type: "bool",
      default: false,
      description:
        "When true, store each point's signed pre-projection distance to the plane in a `planeOffset` point attribute (f32).",
    },
  },
  execute({ inputs, params, seed: nodeSeed }) {
    const geo = cloneGeometry(requireGeometry(inputs, "in", "projectToPlane"));
    // Both resolve ONCE, before the walk, and BEFORE `planeOffset` is
    // created below: a column may alias attribute storage, and adding a
    // column can reallocate the set. A plain vector is not resolved at all
    // — `constant()` stores f32, so routing one through a column would tilt
    // every plane whose normal is not f32-exact.
    const normalCol = isField(params.normal)
      ? requireVec3Column(
          "projectToPlane",
          "normal",
          "point",
          resolveOn(geo, "point", params.normal, nodeSeed, "projectToPlane", "normal"),
          "a plane normal is a direction",
        )
      : undefined;
    const originCol = isField(params.origin)
      ? requireVec3Column(
          "projectToPlane",
          "origin",
          "point",
          resolveOn(geo, "point", params.origin, nodeSeed, "projectToPlane", "origin"),
          "a plane origin is a position in space",
        )
      : undefined;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (normalCol === undefined) {
      const [nxr, nyr, nzr] = params.normal as readonly number[];
      const len = Math.sqrt(nxr * nxr + nyr * nyr + nzr * nzr);
      if (!(len > 0)) {
        throw new Error(
          "projectToPlane: normal must be a non-zero vector — as a plain param it names ONE plane, " +
            "and a zero vector names none. A FIELD normal is read per point instead, and a point " +
            "whose own normal is zero is left exactly where it stands rather than refused.",
        );
      }
      nx = nxr / len;
      ny = nyr / len;
      nz = nzr / len;
    }
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (originCol === undefined) {
      const origin = params.origin as readonly number[];
      ox = origin[0];
      oy = origin[1];
      oz = origin[2];
    }
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
      if (normalCol !== undefined) {
        const rx = readComp(normalCol, i, 0);
        const ry = readComp(normalCol, i, 1);
        const rz = readComp(normalCol, i, 2);
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
        // No direction is no plane. This point keeps its position and
        // records an offset of 0, because 0 is exactly how far it moved —
        // the alternatives (a guessed axis, a dropped point) would invent
        // a value or change what the output IS, and neither is a
        // projection.
        if (!(len > 0)) {
          if (offsets) offsets[i] = 0;
          continue;
        }
        nx = rx / len;
        ny = ry / len;
        nz = rz / len;
      }
      if (originCol !== undefined) {
        ox = readComp(originCol, i, 0);
        oy = readComp(originCol, i, 1);
        oz = readComp(originCol, i, 2);
      }
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
