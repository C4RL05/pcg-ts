/**
 * RUNS: consecutive points along a path that belong together because they
 * are CLOSE IN ARC LENGTH, and the two operations that need them.
 *
 * `pathScan` and `pathRuns` (src/nodes/paths.ts) already accumulate along a
 * path, and `pathRuns` already cuts a path into runs — but it cuts them at
 * points something else FLAGGED, and the flag has to come from somewhere. A
 * barrier, a row of bollards, a stretch of cover: nothing flags those. What
 * separates them is a GAP, and a gap is a fact about two points at once,
 * which is exactly the shape of fact a field cannot state (a field resolves
 * each element from that element alone) and which no boolean column exists
 * to carry until someone has already found the runs.
 *
 * So these two nodes are the gap-delimited half of the same family:
 *
 * - {@link runFit} finds the runs and FITS a line through each one, which
 *   is how "these things line up" stops being an eyeball judgement and
 *   becomes a number a filter can act on.
 * - {@link arcTile} takes arc RANGES and lays a repeated piece over each,
 *   which is how a run gets BUILT rather than merely detected.
 *
 * They are in one file because they share the mental model and, by
 * default, a wire: `runFit` writes `runStart` and `runSpan`, and those are
 * the names `arcTile` reads its ranges from. Detect a run, and you can
 * re-tile it; plan a run, and `runFit` will tell you what it came out as.
 *
 * BOTH MATCH `pathRuns` ON WRAPPING, deliberately and to the letter. A
 * closed path's seam is not a boundary unless something makes it one, so a
 * run straddling the start/finish line is ONE run; `runFit` gets there the
 * same way `pathRuns` does, by starting the walk at the first real break
 * instead of at vertex zero, and falls back to the seam when there is no
 * break to rotate onto. Three nodes agreeing about the seam is the point:
 * a lap is the case this library keeps meeting, and one node disagreeing
 * about where a lap begins is a bug nobody sees until a line of eight
 * objects across the start line reads as two lines of four.
 *
 * ON THE TOPOLOGY CONTRACT, which each node states again in its own
 * description because it is the thing most likely to bite: the predicate is
 * REMOVING POINTS. `runFit` removes none — it clones and writes columns, so
 * the path arrives a path and leaves a path. `arcTile` removes none either,
 * because it reads two inputs and builds a FRESH cloud from them; its
 * output is a plain cloud with no topology at all, exactly as
 * `pathSegments`' is, and re-pathing it describes the tiles rather than the
 * curve they sit on.
 *
 * NEITHER DRAWS A RANDOM NUMBER. `runFit` is a measurement, and `arcTile`
 * copies choices that were made upstream rather than making them — see its
 * description for why that is the whole point rather than a limitation.
 * Their seeds are used only to resolve field params, and both cook
 * byte-identically for the same input in any cook order.
 */
import {
  createPointCloud,
  type Attribute,
  type AttrData,
  type AttrType,
  type Geometry,
} from "../data/index.js";
import type { Column } from "../fields/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { standardNode } from "./registry.js";
import {
  ORIENT_AXES,
  type FieldParam,
  carryPrimitiveAttributes,
  copyElements,
  locateOnArcLength,
  orientQuat,
  polylineArcTables,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  resolveOn,
} from "./util.js";

/**
 * Resolve a param naming a scalar numeric POINT attribute, with a message
 * that names the node, the param, and what the geometry actually carries.
 *
 * A near-copy of the helper `paths.ts` keeps for itself, and kept separate
 * on purpose rather than exported from there: this one names the GEOMETRY
 * the column was looked for on ("the ranges"), because `arcTile` reads two
 * inputs and "point attribute not found" is unanswerable when the author
 * has to guess which pin it means.
 */
function requireScalarPointAttr(
  geo: Geometry,
  name: string,
  nodeType: string,
  param: string,
  which: string,
): Attribute {
  const set = geo.attrs.point;
  const attr = set.get(name);
  if (!attr) {
    throw new Error(
      `${nodeType}: param "${param}" names point attribute "${name}", which does not exist on ${which}; available point attributes there: ${set.names().join(", ") || "(none)"}`,
    );
  }
  if (attr.type === "string") {
    throw new Error(
      `${nodeType}: param "${param}" names string attribute "${name}" on ${which}; it must name a numeric attribute (f32/i32/u32/bool) — a run is measured, not spelled`,
    );
  }
  if (attr.tupleSize !== 1) {
    throw new Error(
      `${nodeType}: param "${param}" names attribute "${name}" on ${which} with tupleSize ${attr.tupleSize}; it must be scalar (tupleSize 1), and which component was meant is not a question this node answers for you — extract it first with setAttribute and a component() field`,
    );
  }
  return attr;
}

/**
 * A field-capable numeric param read ONCE PER ELEMENT of a domain, as a
 * function of the element index.
 *
 * A PLAIN value never touches a column, which is not an optimization but a
 * precision decision: `constant()` materializes an f32 column, so a plain
 * gap of 0.1 would arrive as the f32 nearest 0.1 and cut a run in a place
 * the author's own number does not. The f64 the author typed is the number
 * the node uses. A FIELD has no such choice — a resolved column IS f32 —
 * and that is stated in every field param's description here.
 */
function perElement(
  geo: Geometry,
  domain: "point" | "primitive",
  value: FieldParam,
  seed: number,
  nodeType: string,
  param: string,
  elementWord: string,
  what: string,
): (i: number) => number {
  if (typeof value === "number") return () => value;
  const col: Column = requireScalarColumn(
    resolveOn(geo, domain, value, seed, nodeType, param),
    nodeType,
    param,
    elementWord,
    what,
  );
  return (i: number) => col.data[i];
}

// ---------------------------------------------------------------------------
// runFit

/** Params of {@link runFit}. */
export interface RunFitParams {
  arcAttr: string;
  valueAttr: string;
  gap: FieldParam;
  period: FieldParam;
  wrap: boolean;
  slopeAttr: string;
  residualAttr: string;
  spanAttr: string;
  idAttr: string;
  indexAttr: string;
  countAttr: string;
  startAttr: string;
  interceptAttr: string;
}

/** One column {@link runFit} may write, and what it is called. */
interface RunFitSlot {
  readonly param: string;
  readonly name: string;
  readonly type: AttrType;
  readonly fallback: number;
  readonly suggestion: string;
  /** Whether an empty name is refused rather than read as "skip it". */
  readonly required: boolean;
}

/** Every slot `runFit` writes, in the order its params are declared. */
function runFitSlots(p: RunFitParams): RunFitSlot[] {
  return [
    {
      param: "slopeAttr",
      name: p.slopeAttr,
      type: "f32",
      fallback: 0,
      suggestion: "runSlope",
      required: true,
    },
    {
      param: "residualAttr",
      name: p.residualAttr,
      type: "f32",
      fallback: 0,
      suggestion: "runResidual",
      required: true,
    },
    {
      param: "spanAttr",
      name: p.spanAttr,
      type: "f32",
      fallback: 0,
      suggestion: "runSpan",
      required: true,
    },
    {
      param: "idAttr",
      name: p.idAttr,
      type: "i32",
      fallback: -1,
      suggestion: "runId",
      required: false,
    },
    {
      param: "indexAttr",
      name: p.indexAttr,
      type: "i32",
      fallback: -1,
      suggestion: "runIndex",
      required: false,
    },
    {
      param: "countAttr",
      name: p.countAttr,
      type: "i32",
      fallback: 0,
      suggestion: "runCount",
      required: false,
    },
    {
      param: "startAttr",
      name: p.startAttr,
      type: "f32",
      fallback: 0,
      suggestion: "runStart",
      required: false,
    },
    {
      param: "interceptAttr",
      name: p.interceptAttr,
      type: "f32",
      fallback: 0,
      suggestion: "runIntercept",
      required: false,
    },
  ];
}

/** Least-squares fit of a run, per point, along a path. */
export const runFit = standardNode<RunFitParams>({
  type: "runFit",
  category: "attribute",
  description:
    "Cuts every polyline into RUNS at along-arc GAPS, least-squares fits a numeric point attribute against arc position WITHIN each run, and writes the fit back onto every point of the run it belongs to. This is the node that turns 'those things line up' into numbers a filter can act on: a slope (how fast the value drifts per unit of arc), a worst-case residual (how far the furthest member sits off the fitted line) and a span (how much arc the run covers). Detection is the first use and CONSTRUCTION is the second — a run detected here has a start and a span, which are exactly what arcTile lays a repeated piece over, and the default names line up on purpose (`runStart`, `runSpan`). WHY A NODE AND NOT A FIELD: a gap is a fact about two points at once, and a field resolves each element from that element alone, so neither the grouping nor the fit has any formulation in the grammar. pathRuns cuts runs too, but at points something already FLAGGED — and nothing flags a barrier: what separates one row of posts from the next is empty arc, which is the thing no upstream column knows. IT FITS AGAINST RUN-LOCAL ARC, NOT THE PATH'S, and that is a numerical decision worth stating because it is invisible when it goes wrong. A least-squares fit only ever uses `s - mean(s)`, so fitting an O(1) quantity against an O(300) lap coordinate subtracts away every leading digit it was written with: in f64 that costs about four of seventeen digits and nobody notices, but in f32 there are seven digits and the spacing at 300 is ~3e-5, so a 40-unit run keeps about two digits of deviation — against divergence thresholds that live in the third. The detector would be reading its own quantisation. Subtracting the run's own start first is THE SAME LINE THROUGH THE SAME POINTS (a fit is translation-invariant in the abscissa; slope and residual are unchanged) computed where the numbers are small, so the fit is exactly translation-invariant here rather than approximately. It is also what makes the degenerate-run guard a plain `den > 0` rather than an epsilon: at lap arc those squared deviations were pure cancellation of the same order as any epsilon anyone would pick. THE FIT LANDS ON THE POINT DOMAIN, REPEATED ACROSS EACH RUN, and the alternative was considered and refused. A run is NOT a primitive — one path holds many runs, so the primitive domain has no element to hold one — and giving each run a primitive would mean re-topologising the path into fragments, which destroys the path to describe it. Repeated per point is also the shape the answer is USED in: every consumer is a per-point decision ('drop the middle member of every straight run longer than 4 units', filterByExpression), and a per-point decision needs the run's verdict AT the point. THE RESIDUAL IS THE WORST MEMBER, not an RMS: the rule these exist to serve is 'no member sits further than X off the line', and an RMS lets one outlier hide behind five good members, which is precisely the case that reads as a line to a human eye and passes as scatter to a mean. THE SEAM IS NOT A BREAK unless a gap makes it one. On a CLOSED path with `wrap` on, the walk starts at the first REAL break rather than at vertex zero, so a run straddling the start/finish line stays one run — the same rotation, the same fallback and the same reasoning as pathRuns, because a lap is the case this keeps meeting and one node disagreeing about where a lap begins is a bug nobody sees. A closed path with wrap on and NO gap anywhere is one cyclic run with nowhere to begin, so the seam stands in and the result is what `wrap` off gives. On an OPEN path `wrap` does nothing. TWO-POINT RUNS FIT EXACTLY AND REPORT A ZERO RESIDUAL (or the rounding noise left of one, ~1e-16 of the values' own size), which is the mistake this node most wants you to avoid: a line through two points is always perfect, so 'straight' is only evidence above three, and `countAttr` exists to be filtered on. Compare residuals against a threshold rather than against zero for the same reason every float is. NaN VALUES ARE EXCLUDED FROM THE FIT but stay members of their run (they hold their place along the arc; dropping them would join the two runs they separate), so `countAttr` reports what the line was actually fitted to. A NaN or infinite ARC is refused outright, naming the point — a point with no place along the path cannot be assigned to a run at all, and silently dropping it would merge its neighbours. Points in no polyline keep the defaults (-1 for the id and index, 0 elsewhere), and a point in several polylines takes the last in primitive order, both matching pathScan and pathRuns. TOPOLOGY SURVIVES: this node removes no points, so a path arrives a path and leaves a path — unlike anything downstream that can drop a point (filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute, mergePoints), which rebuilds the point domain and takes the primitives with it. It emits no points either, so it needs no ceiling: the output is exactly as big as the input.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    arcAttr: {
      type: "string",
      default: "",
      description:
        "POINT attribute (tuple 1, numeric) holding each point's ALONG-ARC coordinate — the axis runs are cut on and the fit is made against. EMPTY (the default) MEASURES IT: the path's own cumulative arc length, in world units, walked from its first vertex. Name a column instead when the coordinate is not the path's own geometry, which is the usual case for detection: props threaded into a path in station order are separated along the ROAD, and the 3D chord between two of them also carries their lateral offsets, so a row alternating between two sides measures gaps longer than the road ever had and a run is cut where there is no gap. The coordinate must not DECREASE along the walk — this node refuses a decrease rather than reading it as a huge gap, because a path walked against its own coordinate produces a fit through a sequence running backwards and every number it reports is then a plausible-looking lie. Equal values are fine (two props at the same station). NaN and ±Infinity are refused, naming the point.",
    },
    valueAttr: {
      type: "string",
      default: "density",
      description:
        "POINT attribute (tuple 1, numeric) that is FITTED against the arc coordinate — the quantity whose drift the slope reports. Must exist. THE SIGN IS YOURS TO DECIDE, and it decides what the detector can see: a lateral offset fitted signed gives the two sides of a road opposite slopes for the same defect and halves the sensitivity of any threshold written for one of them, so fit the ABSOLUTE offset (setAttribute with an abs() field) when 'drifting away from the centre' is the question. A NaN value is EXCLUDED from the fit rather than poisoning it, and stays a member of its run — it still holds its place along the arc, and dropping it would merge the runs on either side of it. `countAttr` reports how many members survived into the fit, which is the number to filter on.",
    },
    gap: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "The along-arc distance that SEPARATES runs, in the units of the arc coordinate: consecutive members closer than this belong to the same run, and a gap GREATER THAN OR EQUAL to it starts a new one. Must be > 0. The comparison is closed on the break side deliberately — 'members closer than `gap` belong together' is the sentence the number is chosen from, so an exactly-`gap` spacing is a break rather than a coincidence to argue about. AS A FIELD IT IS ONE GAP PER PATH, resolved on the input's PRIMITIVE domain, for the same reason pathResample's spacing is: each polyline is cut on its OWN arc, so there is a primitive element to read one value per, and a motorway and a footpath in one geometry can take different gaps in ONE cook. The field sees the primitive domain, so it can read a primitive attribute (setAttribute domain 'primitive', or promoteAttribute point → primitive), index(), fraction(), randomField() and nodeSeed(); a POINT attribute is not in scope there and position() has no meaning for a path. A field is not range-checked the way a plain value is — a schema's min binds a number, and a field is a recipe with no number until it lands on a domain — so bound the expression itself with max(<expr>, <the smallest gap you meant>); a NaN or infinite gap is refused, naming this param.",
    },
    period: {
      type: "f32",
      default: 0,
      min: 0,
      acceptsField: true,
      description:
        "The value the arc coordinate WRAPS AT on a closed path — the lap length, in the arc coordinate's own units. 0 (the default) means the path's OWN MEASURED ARC LENGTH, which is correct whenever `arcAttr` is empty or holds a measured world-unit arc. IT IS READ ONLY WHERE IT MATTERS: a closed path with `wrap` on, where the gap across the seam is `arc(first) + period - arc(last)` and nothing else can supply it. THE MISTAKE IT EXISTS TO PREVENT: `arcAttr: \"curveU\"` is a 0..1 coordinate, so its period is 1, and leaving this at 0 hands it a period of a few hundred world units — the seam gap then dwarfs every real gap, no break is ever found there, and the lap silently becomes one run. A period SMALLER than the coordinate's own extent is caught (the seam gap goes negative and the cook is refused naming this param). A period LARGER than it cannot be caught by arithmetic — which is why the combination that produces one is REFUSED instead: a wrapping closed path that reads a non-empty `arcAttr` must state its period, because 0 would hand it a world-unit length for a coordinate that is not in world units, and the run crossing the seam would split with nothing in the output to show it. Clear `arcAttr` to use the measured arc, or set `wrap` false, or say what the coordinate wraps at. One value per PATH as a field, resolved on the PRIMITIVE domain exactly as `gap` is.",
    },
    wrap: {
      type: "bool",
      default: true,
      description:
        "Whether a run may cross a CLOSED path's seam. True (the default) rotates the walk onto the first REAL break — the first point whose gap-before is at least `gap`, measured the long way round through the seam — so a run straddling the start/finish line stays one run. This is pathRuns' rule and the same code shape, because a lap is the case that keeps arriving and a line of eight objects laid across the start line must not read as two lines of four, each too short to be anything. False treats the seam as a break, which is what you want when vertex order carries meaning of its own. A closed path with NO break anywhere is one cyclic run with no place to begin, so the seam stands in and the answer is identical under both settings. No effect on an open path.",
    },
    slopeAttr: {
      type: "string",
      default: "runSlope",
      description:
        "POINT attribute (f32) receiving the fitted SLOPE of the run each point belongs to: the change in `valueAttr` per unit of arc, signed, and the same number on every member of a run. This is the divergence figure — 'this line drifts 0.03 units of lateral per unit of lap' — and it is what separates a line running PARALLEL to the path (slope ~0, ordinary dressing) from one converging on it (a false edge a driver would steer to). A run whose members all sit at one arc position has no slope to fit and reports 0, as does a run with fewer than two fittable members. May not be empty: a runFit that writes no fit is a cook that looks like it worked. Same reporting-slot rule as the rest of the library — a column of a different shape under this name is refused rather than deleted and re-added, and a same-shape one is reset.",
    },
    residualAttr: {
      type: "string",
      default: "runResidual",
      description:
        "POINT attribute (f32) receiving the run's WORST residual: the largest absolute distance from any fitted member to the fitted line, in the units of `valueAttr`, repeated on every member. Worst rather than RMS on purpose — the rule this serves is 'no member sits further than X off the line', and an RMS lets one outlier hide behind five good members, which is exactly the arrangement that reads as a straight line to the eye and as scatter to a mean. THE NUMBER TO DISTRUST IS A ZERO ON A SHORT RUN: two points define a line, so a two-member run always reports 0 — or the rounding noise left of it, which is why a threshold and not an equality is what to test — and always looks perfectly assembled. Filter on `countAttr` before believing a residual. May not be empty, and the reporting-slot rule applies.",
    },
    spanAttr: {
      type: "string",
      default: "runSpan",
      description:
        "POINT attribute (f32) receiving the run's SPAN: the arc distance from its first member to its last, in the arc coordinate's units, repeated on every member. Zero for a single-member run. This is the length threshold every rule about runs eventually needs — a line has to be long enough to read as one — and, with `startAttr`, it is exactly the range arcTile tiles: the pair's default names (`runStart`, `runSpan`) are that node's default `startAttr` and `lengthAttr` so the two wire together without renaming. Note it is the span of the MEMBERS, not of the arc they were cut from: a run ends at its last member, not half a gap later. May not be empty, and the reporting-slot rule applies.",
    },
    idAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (i32) receiving a run's INDEX, numbered from 0 across the whole geometry in primitive order and then in walk order, with -1 left on every point no polyline reaches. Empty (the default) writes none and the output is byte-identical to a cook without it. It is the GROUP KEY the rest of the library takes: partitionByAttribute splits one item per run, pointsToPath's `groupAttr` builds one path per run, and attributeReduce collapses per run. Numbered across the geometry rather than per path so those nodes see distinct groups without having to combine two columns; the path a run came from is recoverable from any carried primitive attribute.",
    },
    indexAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (i32) receiving each point's 0-BASED POSITION WITHIN ITS OWN RUN, restarting at 0 for every run, -1 on points no polyline reaches. Empty (the default) writes none. Two things need it. ALTERNATION along a run ('every other post a different asset') has no other spelling: the global point index agrees with the per-run one only while every run has the same, even, length, and nothing reports when that stops being true. And index 0 is the FIRST MEMBER, which is how a run becomes ONE element: filterByExpression on it leaves one point per run carrying that run's start, span and fit — a ranges cloud, which is what arcTile consumes. It counts in the WALK order the runs were cut in, so on a closed path with `wrap` on, index 0 of the seam-straddling run sits before the seam.",
    },
    countAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (i32) receiving how many members of the run WERE FITTED — members whose `valueAttr` was finite — repeated on every member of the run, including any that were excluded. Empty (the default) writes none. FITTED rather than total because the only reason to ask is to distrust a fit made from too few points, and a run of eight whose values are six NaNs is a two-point fit however many members it has. Two is the number to watch: a line through two points is exact, so both the residual and any 'how straight is it' rule are meaningless below three, and this is the column that says so.",
    },
    startAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (f32) receiving the arc coordinate of the run's FIRST MEMBER, repeated on every member. Empty (the default) writes none. Reported in the path's OWN coordinate rather than the unwrapped one the fit used, so a run that began before a closed path's seam still starts where it starts — with `spanAttr` it is the range arcTile tiles, and a range that reported a start past the end of the lap would be a range no other node could read. It is also the origin `interceptAttr` is measured at: to evaluate the fitted line at an arbitrary arc a, take intercept + slope * ((a - start) wrapped into [0, period)) on a closed path, or intercept + slope * (a - start) on an open one.",
    },
    interceptAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (f32) receiving the fitted line's value AT THE RUN'S OWN START (arc offset zero, the position `startAttr` reports), repeated on every member. Empty (the default) writes none. This is the half of the fit that RECONSTRUCTS it: slope alone says how fast the line drifts and nothing about where it is, so anything that wants to place along the fitted line — snap a straggler onto it, continue it with fresh pieces, draw it for a debug overlay — needs this too. At the run's start rather than at the arc origin for the reason the node's description gives about cancellation: an intercept extrapolated back to lap arc zero is a number computed hundreds of units away from any data, and its error is the slope's error times that distance.",
    },
  },
  execute({ inputs, params, seed, checkCancelled }) {
    // Params before geometry: a bad param reported as "no polyline
    // primitives" sends the author to debug the wrong thing entirely.
    const { arcAttr, valueAttr } = params;
    if (valueAttr === "") {
      throw new Error(
        'runFit: param "valueAttr" must be a non-empty attribute name; it is the point attribute the line is fitted through, and a fit with nothing to fit is not a cheaper cook but an empty one',
      );
    }
    const slots = runFitSlots(params);
    const taken = new Map<string, string>();
    for (const slot of slots) {
      if (slot.name === "") {
        if (!slot.required) continue;
        throw new Error(
          `runFit: param "${slot.param}" must be a non-empty attribute name (the default is "${slot.suggestion}"); it is one of the three columns this node exists to write, and a runFit that writes no fit is a cook that looks like it worked`,
        );
      }
      if (slot.name === "P") {
        throw new Error(
          `runFit: param "${slot.param}" cannot be "P" — that would overwrite the positions the path is measured along; use "${slot.suggestion}" or another name`,
        );
      }
      if (slot.name === valueAttr) {
        throw new Error(
          `runFit: params "${slot.param}" and "valueAttr" are both "${slot.name}"; the fit would be written over the column it was fitted through, so every later path would be fitted against this node's own output rather than the data`,
        );
      }
      if (arcAttr !== "" && slot.name === arcAttr) {
        throw new Error(
          `runFit: params "${slot.param}" and "arcAttr" are both "${slot.name}"; the fit would be written over the arc coordinate the runs were cut on, so every later path would be cut on this node's own output rather than on the arc`,
        );
      }
      const other = taken.get(slot.name);
      if (other !== undefined) {
        throw new Error(
          `runFit: params "${other}" and "${slot.param}" are both "${slot.name}"; they are two different values and need two attributes, or the second would overwrite the first with no complaint`,
        );
      }
      taken.set(slot.name, slot.param);
    }
    const scalarGap = typeof params.gap === "number" ? params.gap : undefined;
    if (scalarGap !== undefined && !(scalarGap > 0)) {
      throw new Error(
        `runFit: param "gap" must be > 0, got ${scalarGap}; it is the along-arc distance that separates runs, and a gap of 0 or less separates nothing — every point would open its own run`,
      );
    }
    const scalarPeriod = typeof params.period === "number" ? params.period : undefined;
    if (scalarPeriod !== undefined && !(scalarPeriod >= 0)) {
      throw new Error(
        `runFit: param "period" must be >= 0, got ${scalarPeriod}; 0 means "the path's own measured arc length" and any other value is the coordinate the arc wraps at`,
      );
    }

    const src = requireGeometry(inputs, "in", "runFit");
    const value = requireScalarPointAttr(src, valueAttr, "runFit", "valueAttr", "the input");
    const arc =
      arcAttr === ""
        ? null
        : requireScalarPointAttr(src, arcAttr, "runFit", "arcAttr", "the input");
    for (const slot of slots) {
      if (slot.name === "") continue;
      requireReportSlot({
        attrs: src.attrs.point,
        nodeType: "runFit",
        param: slot.param,
        name: slot.name,
        type: slot.type,
        tupleSize: 1,
        domain: "point",
        suggestion: slot.suggestion,
      });
    }

    const geo = cloneGeometry(src);
    // The full arc table rather than `polylineWalks`: this node measures
    // distance, which is the whole basis of a gap, and in the default
    // (`arcAttr` empty) mode the cumulative lengths ARE the coordinate.
    const tables = polylineArcTables(geo, "runFit");
    const gapOf =
      scalarGap === undefined
        ? perElement(geo, "primitive", params.gap, seed, "runFit", "gap", "path", "a gap")
        : () => scalarGap;
    const periodOf =
      scalarPeriod === undefined
        ? perElement(geo, "primitive", params.period, seed, "runFit", "period", "path", "a period")
        : () => scalarPeriod;

    const valData = geo.attrs.point.require(valueAttr).data;
    const arcData = arc === null ? null : geo.attrs.point.require(arcAttr).data;
    // One `replace` per named slot, in the params' own order, so a
    // re-run over this node's own output RESETS its columns rather than
    // colliding with them — the rule requireReportSlot documents.
    const written = new Map<string, AttrData>();
    for (const slot of slots) {
      if (slot.name === "") continue;
      written.set(slot.param, geo.attrs.point.replace(slot.name, slot.type, 1, slot.fallback).data);
    }
    // The three required columns are named or the cook was already
    // refused above, so `require` here is a fact rather than a hope.
    const requireCol = (param: string): AttrData => {
      const col = written.get(param);
      if (!col) throw new Error(`runFit: internal — param "${param}" wrote no column`);
      return col;
    };
    const slope = requireCol("slopeAttr");
    const residual = requireCol("residualAttr");
    const span = requireCol("spanAttr");
    const runIdCol = written.get("idAttr");
    const runIndexCol = written.get("indexAttr");
    const runCountCol = written.get("countAttr");
    const runStartCol = written.get("startAttr");
    const runInterceptCol = written.get("interceptAttr");

    let nextRunId = 0;
    for (const table of tables) {
      const pts = table.points;
      // A closed path repeats its first point as its last vertex; that
      // repeat is the closure, not a member to fit twice.
      const m = table.closed ? pts.length - 1 : pts.length;
      const g = gapOf(table.prim);
      if (!(g > 0)) {
        throw new Error(
          `runFit: the "gap" field resolved to ${g} on the path at primitive ${table.prim}, but every path's gap must be > 0 — a gap of 0 or less separates nothing, so every point would open its own run. Bound the expression with max(<the gap field>, <the smallest gap you meant>).`,
        );
      }
      const rawPeriod = periodOf(table.prim);
      const cyclic = table.closed && params.wrap;
      // A CUSTOM ARC COORDINATE MUST STATE ITS OWN PERIOD, and it is
      // refused rather than guessed.
      //
      // `period: 0` means "the path's own measured length", which is the
      // right answer for the measured arc and a WRONG one for any other
      // coordinate — and wrong in the direction that is hardest to see.
      // The seam gap is `arc(first) + period - arc(last)`, so a period
      // larger than the coordinate's true extent inflates it, a break is
      // found where the path does not break, and the run that straddled
      // the seam quietly becomes two. Nothing about the output says so:
      // both halves are well-formed runs with plausible fits. Caught in
      // testing exactly that way, from the DEFAULT, on a coordinate whose
      // units simply were not world units.
      //
      // The opposite mistake — a period SMALLER than the extent — is
      // already caught below, because the seam gap goes negative. This
      // closes the half that could not be. The cost is one stated param
      // on a path that has already opted into a coordinate of its own,
      // which is where the author knows the answer and the node does not.
      if (cyclic && rawPeriod === 0 && params.arcAttr !== "") {
        throw new Error(
          `runFit: the closed path at primitive ${table.prim} wraps and reads its arc from attribute "${params.arcAttr}", but "period" is 0, which means "the path's own measured length" (${table.length}) — a value in world units that is only right if "${params.arcAttr}" is measured in them too. The seam gap is arc(first) + period - arc(last), so a period larger than that attribute's real extent invents a break at the seam and silently splits the run that crossed it. Set "period" to the value "${params.arcAttr}" wraps at (1 for a curveU coordinate, the lap length for a station), or set "wrap" false to treat the seam as a break, or clear "arcAttr" to use the measured arc.`,
        );
      }
      // 0 is the documented "use the path's own measured length".
      const period = rawPeriod === 0 ? table.length : rawPeriod;
      if (cyclic && !(period > 0)) {
        throw new Error(
          `runFit: the closed path at primitive ${table.prim} wraps, but its period resolved to ${period} — the seam gap is arc(first) + period - arc(last) and cannot be measured without one. Its measured arc length is ${table.length}; set "period" to the value the arc coordinate wraps at (1 for a curveU coordinate), or set "wrap" false to treat the seam as a break.`,
        );
      }

      // Raw arc coordinate per vertex, validated before anything is cut:
      // a coordinate that cannot be read cannot place a point in a run,
      // and a run built around one is a plausible-looking lie.
      const raw = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        if ((k & 1023) === 0) checkCancelled();
        const a = arcData === null ? table.cum[k] : arcData[pts[k]];
        if (!Number.isFinite(a)) {
          throw new Error(
            `runFit: the arc coordinate at point ${pts[k]} (vertex ${k} of the path at primitive ${table.prim}) is ${Number.isNaN(a) ? "NaN" : a > 0 ? "+Infinity" : "-Infinity"}${arcAttr === "" ? ", measured from the path's own positions — a point of this path holds a non-finite P" : `, read from attribute "${arcAttr}"`}. A point with no place along the path cannot be put in a run, and dropping it silently would merge the runs on either side of it; fix the column upstream, or drop the point with filterByExpression before this node.`,
          );
        }
        raw[k] = a;
      }
      for (let k = 1; k < m; k++) {
        if (raw[k] < raw[k - 1]) {
          throw new Error(
            `runFit: the arc coordinate decreases along the path at primitive ${table.prim} — vertex ${k - 1} reads ${raw[k - 1]} and vertex ${k} reads ${raw[k]}${arcAttr === "" ? "" : ` in attribute "${arcAttr}"`}. Runs are cut on the walk order, so a coordinate running against it would put a negative gap where a break belongs and fit a line through a sequence read backwards. Reverse the path (pointsToPath with the opposite "orderAttr"), negate the coordinate, or sort the points into the coordinate's order before building the path.`,
          );
        }
      }

      // Where the walk starts. Same rotation as pathRuns, with the break
      // playing the part its boundary flag plays: onto the first REAL
      // gap, so a run across the seam stays one run — and onto vertex
      // zero when there is no gap anywhere, since a cyclic run with no
      // break has no place to begin and the seam stands in.
      let rotate = 0;
      if (cyclic) {
        const seam = raw[0] + period - raw[m - 1];
        if (seam < 0) {
          throw new Error(
            `runFit: the seam gap on the closed path at primitive ${table.prim} is ${seam} — negative, which means "period" (${period}) is smaller than the arc coordinate's own extent (${raw[m - 1] - raw[0]} between its first and last vertex). Set "period" to the value the coordinate actually wraps at: its measured arc length is ${table.length}, and a curveU coordinate wraps at 1.`,
          );
        }
        for (let k = 0; k < m; k++) {
          const before = k === 0 ? seam : raw[k] - raw[k - 1];
          if (before >= g) {
            rotate = k;
            break;
          }
        }
      }

      // The walk, rotated and UNWRAPPED: members that come round past the
      // seam carry a period so the axis stays monotonic, which is what
      // both the span and the fit need. SoA, and allocated per path
      // rather than per run — a run is a range of these, never a list.
      const sArr = new Float64Array(m);
      const pArr = new Uint32Array(m);
      for (let j = 0; j < m; j++) {
        const idx = cyclic ? (rotate + j) % m : j;
        pArr[j] = pts[idx];
        sArr[j] = raw[idx] + (idx < rotate ? period : 0);
      }

      let a = 0;
      for (let j = 1; j <= m; j++) {
        if ((j & 1023) === 0) checkCancelled();
        // Members closer than `gap` stay together; a gap at least `gap`
        // wide closes the run before it. The end of the walk closes the
        // last one, which is why this runs to m inclusive.
        if (j < m && sArr[j] - sArr[j - 1] < g) continue;

        const s0 = sArr[a];
        const runSpan = sArr[j - 1] - s0;
        // Rebased on the run's own start before anything is summed — the
        // same line through the same points, computed where the numbers
        // are small. See the node description.
        let fitted = 0;
        let ms = 0;
        let mv = 0;
        for (let k = a; k < j; k++) {
          const v = valData[pArr[k]];
          // A NaN (or infinite) value is excluded from the FIT and stays
          // a member of the run: it holds its place along the arc.
          if (!Number.isFinite(v)) continue;
          fitted++;
          ms += sArr[k] - s0;
          mv += v;
        }
        let sl = 0;
        let ic = 0;
        let res = 0;
        if (fitted > 0) {
          ms /= fitted;
          mv /= fitted;
          let num = 0;
          let den = 0;
          for (let k = a; k < j; k++) {
            const v = valData[pArr[k]];
            if (!Number.isFinite(v)) continue;
            const d = sArr[k] - s0 - ms;
            num += d * (v - mv);
            den += d * d;
          }
          // `> 0` and not an epsilon: rebasing removed the cancellation
          // an epsilon used to stand in for, so this is now exactly the
          // degenerate case — every fitted member at one arc position.
          sl = den > 0 ? num / den : 0;
          ic = mv - sl * ms;
          for (let k = a; k < j; k++) {
            const v = valData[pArr[k]];
            if (!Number.isFinite(v)) continue;
            const off = Math.abs(v - (ic + sl * (sArr[k] - s0)));
            if (off > res) res = off;
          }
        }
        // Reported in the path's own coordinate rather than the unwrapped
        // one: a run that began before the seam still starts where it
        // starts, and a start past the end of the lap is a range no other
        // node could read.
        const startRaw = raw[cyclic ? (rotate + a) % m : a];
        const rid = nextRunId++;
        for (let k = a; k < j; k++) {
          const p = pArr[k];
          slope[p] = sl;
          residual[p] = res;
          span[p] = runSpan;
          if (runIdCol) runIdCol[p] = rid;
          if (runIndexCol) runIndexCol[p] = k - a;
          if (runCountCol) runCountCol[p] = fitted;
          if (runStartCol) runStartCol[p] = startRaw;
          if (runInterceptCol) runInterceptCol[p] = ic;
        }
        a = j;
      }
    }
    return { out: [makeGeometryItem(geo)] };
  },
});

// ---------------------------------------------------------------------------
// arcTile

/**
 * Ceiling on the points one `arcTile` may emit.
 *
 * The count is a quotient of two numbers the graph computed — a range's
 * length over its spacing — so nothing an author typed bounds it, and a
 * spacing that came out small on one range runs away silently. The same
 * hazard `pathResample` bounds with MAX_RESAMPLE_POINTS and `volumeSample`
 * with MAX_VOLUME_POINTS, bounded at the same figure and for the same
 * reason: it is far above any legitimate tiling and far below the size
 * where the process simply dies.
 */
const MAX_TILE_POINTS = 1_048_576;

/** Params of {@link arcTile}. */
export interface ArcTileParams {
  startAttr: string;
  lengthAttr: string;
  pathAttr: string;
  spacing: FieldParam;
  flare: FieldParam;
  taper: FieldParam;
  axis: string;
  flareAttr: string;
  tileIndexAttr: string;
  rangeIndexAttr: string;
  rangeNames: string[];
}

/** A repeated piece laid over each of a path's arc ranges. */
export const arcTile = standardNode<ArcTileParams>({
  type: "arcTile",
  category: "sampler",
  description:
    "Lays a REPEATED PIECE over arc ranges of a path: one oriented instance point every `spacing` units between each range's start and end, ready for spawnInstances. This is the tile-a-tunnel-out-of-one-rib operation, and it is a primitive rather than a convenience because ENCLOSURE IS A PATTERN, NOT AN ASSET — on the most enclosed of twenty-two measured circuits the cover is held up by 126 separate objects and the largest single one accounts for 5.9% of it, the workhorse being one strip placed 24 times. There is no tunnel model to find and place; there is a run of repeated pieces over an arc range, which is what this builds. THE RANGES ARRIVE AS A SECOND GEOMETRY, one point per range, carrying the range's start and length as point attributes (`runStart` and `runSpan` by default, which are runFit's own defaults, so a detected run re-tiles without renaming anything). A point cloud rather than params because there are MANY ranges and each carries its own decisions — where it starts, how long it is, which piece it is made of, how wide, which variant — and a param is one value for the cook. It also makes every existing node a range producer: scatter them, filter them, snap them, reject the ones that overlap, all before a single tile exists. ATOMICITY IS THE WHOLE POINT AND IT IS STRUCTURAL. A tunnel is the SAME piece repeated; drawing a fresh piece per rib reopens the seams the overlap was there to close, and in the case this node comes from a planned 17-unit covered stretch measured back as 8 the moment poses were drawn per piece. So the choice is made ONCE, upstream, on the range point — where there is exactly one element per run to make it on — and `rangeNames` COPIES it onto every tile of that range. Copying is what makes it atomic: a per-tile draw can be uniform only by luck, and only until someone changes the seed. The tile's own `seed` is rooted in the range for a weaker but related reason — it is hashCombine(the node's seed, hashCombine(the range's own seed, the range's index), the tile's index within the range), so the tiles of one range keep their per-tile jitter when a DIFFERENT range changes its spacing, which a seed taken from the global tile index cannot offer. The range's INDEX is folded in as well as its seed because a ranges cloud that never had a seed written carries a column of zeros, and rooting on that alone would hand every range identical tiles. SPACING IS A CEILING ON THE PITCH, NOT THE PITCH. A range takes ceil(length / spacing) tiles, placed at the centres of that many EQUAL sub-intervals, so the actual step is length / count and is at most `spacing`. Rounded UP so pieces at least abut: rounding to nearest leaves the pitch wider than asked whenever a range is not a whole number of pieces long, and a gap in a tiled cover is not a near-miss but a hole — a planned 15-unit run was closing 9.6, under the 10 that counted as a long stretch at all. Nothing here knows how big your piece is: to OVERLAP, give a spacing smaller than the piece. THE MOUTHS FLARE. `flare` is the arc distance over which each end opens and `taper` the scale the very mouth reaches, applied to the two `scale` components that are not the `axis` — so the cross-section opens and the length along the path does not, which is what makes a driver see an opening rather than a wall and what keeps the entry clear at the moment it matters. `flareAttr` writes the raw 0..1 ramp instead, for everything else a mouth might do (lift, tilt, a different asset), because WHAT flares is the asset's business and not this node's. ON A CLOSED PATH RANGES WRAP: a range crossing the seam is one range, its arc taken modulo the path's length, matching what pathRuns and runFit do with a run there. On an OPEN path a range reaching past either end is REFUSED rather than clamped — a clamped range is a shorter tunnel than the one that was planned, reported as success. THE OUTPUT IS A PLAIN CLOUD, not a path: the tiles are placements along the curve, not the curve, and no polyline topology is built over them, exactly as pathSegments leaves its segment midpoints. Each tile carries P, `rot` (the `axis` turned onto the path's tangent, roll fixed by an up hint of [0, 1, 0] with orientAlongVector's deterministic fallbacks), `scale` (1, tapered at the mouths), `tangent`, `curveU`, `seed`, the standard point attributes, whatever `rangeNames` carries, and the PATH's primitive attributes — so a road's width reaches the ribs standing over it. It emits no randomness of its own.",
  inputs: [
    { name: "path", kind: "geometry" },
    { name: "ranges", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    startAttr: {
      type: "string",
      default: "runStart",
      description:
        "POINT attribute on the RANGES input (tuple 1, numeric) holding where each range begins, as an arc length in WORLD UNITS along the path — the same coordinate pathResample steps and pathPointAt's 'distance' mode reads. Defaults to runFit's `startAttr` suggestion so a detected run tiles without renaming; note the one conversion that pairing needs, which is that runFit may have been run against a CUSTOM arc coordinate in other units (a lap measured in half-widths), and this node reads world units. On a CLOSED path the value wraps: any real number is legal and is taken modulo the path's length. On an OPEN path a range must lie inside the path, and one that does not is refused rather than clamped.",
    },
    lengthAttr: {
      type: "string",
      default: "runSpan",
      description:
        "POINT attribute on the RANGES input (tuple 1, numeric) holding how much arc each range covers, in world units. Must be > 0 on every range: a range with no length is a single placement rather than a tiling, and this node refuses one instead of emitting a lone tile that looks like a very short tunnel — drop it upstream (filterByAttribute on the length) or place it with pathPointAt. On a closed path it may not exceed the path's own length, since the tiles would lap the loop and cover the same arc twice. Must differ from `startAttr`: a start and a length are two values, and one column cannot hold both.",
    },
    pathAttr: {
      type: "string",
      default: "",
      description:
        "POINT attribute on the RANGES input (tuple 1, numeric) naming WHICH polyline each range belongs to, as an index into the path input's PRIMITIVE domain — the same numbering every error message here uses. Empty (the default) is legal only when the path input holds exactly ONE polyline, which is the ordinary case; with several, this is REQUIRED rather than defaulted to the first, because tiling the wrong road is a cook that looks entirely fine. An index that is not a polyline of the input is refused, listing the ones that are.",
    },
    spacing: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "Ceiling on the distance between consecutive tiles, in world units. A range of length L takes max(1, ceil(L / spacing)) tiles at the centres of that many equal sub-intervals, so the PITCH is L / count and is at most this value — never more. Rounded up rather than to nearest so that pieces meant to abut do: a nearest-rounded pitch is wider than asked whenever the range is not a whole number of pieces long, and a gap in tiled cover is a hole rather than a near-miss. This node does not know how big your piece is, so overlap is spelled as a spacing SMALLER than the piece — about 5% under is enough to close the wedge two pieces leave on the outside of a bend. Must be > 0. AS A FIELD IT IS ONE SPACING PER RANGE, resolved on the RANGES input's POINT domain, which is what lets the pitch follow the piece: a range that chose a 5-unit strip and one that chose a 1-unit rib tile at their own pitches in ONE cook, reading the size the range itself carries. A field is not range-checked the way a plain value is, so bound the expression with max(<expr>, <the smallest pitch you meant>); a NaN or infinite spacing is refused, naming this param, and so is the whole cook when the resolved spacings would place more than " +
        `${MAX_TILE_POINTS} tiles.`,
    },
    flare: {
      type: "f32",
      default: 0,
      min: 0,
      acceptsField: true,
      description:
        "Arc distance over which each MOUTH of a range opens, in world units; 0 (the default) is no flare. Every tile gets a ramp of 1 at the very mouth falling to 0 at this distance inside, taken from whichever end is nearer, and the ramp drives `taper` and `flareAttr`. It exists because a tiled cover that starts at full section is a wall with a hole in it: the eye reads an opening from the way the section grows, and the flare is also what keeps the view clear at the moment of entry, which is the moment it matters. A flare of at least half the range's length ramps every tile (the two mouths meet in the middle) and is legal — the ramps do not add, each tile taking the nearer mouth's. One value per RANGE as a field, resolved on the ranges' POINT domain exactly as `spacing` is, so a long tunnel and a short gantry can open over different distances in one cook.",
    },
    taper: {
      type: "f32",
      default: 1,
      min: 0,
      acceptsField: true,
      description:
        "The `scale` a tile reaches AT the mouth, interpolated to 1 at `flare` inside; 1 (the default) is no taper, and with `flare` at 0 this is read nowhere. Applied to the two scale components that are NOT `axis` — the cross-section — so the mouth opens or pinches while the piece's length along the path is left alone; scaling all three would make the mouth pieces longer as well as wider and leave gaps between them. Above 1 opens the mouth (1.5 is a mouth half again as tall and wide), below 1 pinches it, which is what a run that should taper away to nothing at its ends wants. One value per RANGE as a field, on the ranges' POINT domain.",
    },
    axis: {
      type: "enum",
      default: "+z",
      enum: [...ORIENT_AXES],
      description:
        "Which local axis of the tiled asset points ALONG the path, and therefore which two `scale` components `taper` opens. Default '+z', matching orientAlongVector rather than pathSegments' '+y': this node points a piece at a heading and does not stretch it to span anything, where pathSegments puts the SEGMENT'S LENGTH on the chosen axis to draw a tube. Roll around the path is fixed by an up hint of [0, 1, 0] with the same deterministic fallbacks orientAlongVector uses ([0, 0, 1], then [1, 0, 0]) — never random, and never left to whatever a degenerate cross product produced.",
    },
    flareAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (f32) on the output receiving each tile's raw FLARE RAMP — 1 at the mouth, falling linearly to 0 at `flare` inside, and 0 everywhere on a range with no flare. Empty (the default) writes none and the output is byte-identical to a cook without it. It is here because WHAT a mouth does is the asset's business and not this node's: `taper` covers the common case of opening the section, and everything else — lifting the roof, tilting the pieces outward, swapping in a wider variant at the entrance, fading a material — is a field or a setAttribute reading this column. The ramp is per tile, taken from the NEARER mouth, so a range shorter than twice its flare has every tile ramped and none of them at zero.",
    },
    tileIndexAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (i32) receiving each tile's 0-BASED INDEX WITHIN ITS OWN RANGE, restarting at 0 for every range. Empty (the default) writes none. It is the per-range coordinate nothing else can state: this node emits NEW points, so an index written upstream with setAttribute does not survive, and `curveU` is a fraction of the whole path rather than of the range. Without it, 'every other rib' has to be spelled on the GLOBAL point index, which agrees with the per-range one only while every range emits the same, EVEN, number of tiles and reports nothing when that stops being true. Index 0 is the tile nearest the range's start in the path's walk direction, including on a range that wraps a closed path's seam.",
    },
    rangeIndexAttr: {
      type: "string",
      default: "",
      description:
        "OPT-IN: POINT attribute (i32) receiving the index of the RANGE a tile came from, in the ranges input's own point order. Empty (the default) writes none. This is the group key: partitionByAttribute splits one item per run, pointsToPath's `groupAttr` threads each run's tiles into a path of their own, and attributeReduce collapses per run — 'how long did this run actually come out' is a reduction over this. It also names the atomic unit for anything that must be decided once per run and is easier to write downstream than upstream.",
    },
    rangeNames: {
      type: "stringList",
      default: [],
      description:
        "Point attributes of the RANGES input to copy onto every tile of that range, in any order; empty (the default) carries nothing, which is not an error. THIS IS THE ATOMICITY MECHANISM. A tunnel is one piece repeated, so the piece is chosen ONCE — on the range point, where there is exactly one element per run to choose on, by whatever upstream node makes that kind of decision — and copied here, unchanged, onto every tile. A per-tile draw is uniform only by accident: the case this node comes from measured a planned 17-unit covered stretch back as 8 the moment poses were drawn per piece, because varying the shape along a run reopens the seams the overlap existed to close. Carry the asset id, the variant, the yaw, the width, the material — anything that must be the same all the way along. Each column arrives with the range's own type, tuple size and default. Three names are refused rather than resolved silently: one this node writes itself (P, rot, scale, density, boundsMin, boundsMax, color, seed, tangent, curveU, and whatever flareAttr/tileIndexAttr/rangeIndexAttr named) — copy it to another name on the ranges first with setAttribute and carry that; a name repeated in the list; and a name the ranges input does not have, which is an error listing what it does have.",
    },
  },
  execute({ inputs, params, seed, checkCancelled }) {
    // Params before geometry, as everywhere in this family: a param
    // mistake reported as "no polyline primitives" sends the author to
    // debug topology that is fine.
    const axis = params.axis;
    if (!(ORIENT_AXES as readonly string[]).includes(axis)) {
      throw new Error(
        `arcTile: param "axis" must be one of ${ORIENT_AXES.join(", ")}; got "${axis}"`,
      );
    }
    if (params.startAttr === "") {
      throw new Error(
        'arcTile: param "startAttr" must be a non-empty attribute name (the default is "runStart"); it is the point attribute on the ranges input holding where each range begins',
      );
    }
    if (params.lengthAttr === "") {
      throw new Error(
        'arcTile: param "lengthAttr" must be a non-empty attribute name (the default is "runSpan"); it is the point attribute on the ranges input holding how much arc each range covers',
      );
    }
    if (params.startAttr === params.lengthAttr) {
      throw new Error(
        `arcTile: params "startAttr" and "lengthAttr" are both "${params.startAttr}"; a start and a length are two values and one column cannot hold both`,
      );
    }
    const scalarSpacing = typeof params.spacing === "number" ? params.spacing : undefined;
    if (scalarSpacing !== undefined && !(scalarSpacing > 0)) {
      throw new Error(
        `arcTile: param "spacing" must be > 0, got ${scalarSpacing}; it is the ceiling on the distance between consecutive tiles, and a spacing of 0 or less places no tile at any distance`,
      );
    }
    const scalarFlare = typeof params.flare === "number" ? params.flare : undefined;
    if (scalarFlare !== undefined && !(scalarFlare >= 0)) {
      throw new Error(
        `arcTile: param "flare" must be >= 0, got ${scalarFlare}; it is the arc distance over which a mouth opens, and 0 is the no-flare case`,
      );
    }
    const scalarTaper = typeof params.taper === "number" ? params.taper : undefined;
    if (scalarTaper !== undefined && !(scalarTaper >= 0)) {
      throw new Error(
        `arcTile: param "taper" must be >= 0, got ${scalarTaper}; it is the scale a tile reaches at the mouth, and a negative one would mirror the asset there`,
      );
    }

    const path = requireGeometry(inputs, "path", "arcTile");
    const ranges = requireGeometry(inputs, "ranges", "arcTile");
    const tables = polylineArcTables(path, "arcTile");
    const nRanges = ranges.attrs.point.count;

    const startAttr = requireScalarPointAttr(
      ranges,
      params.startAttr,
      "arcTile",
      "startAttr",
      "the ranges input",
    );
    const lengthAttr = requireScalarPointAttr(
      ranges,
      params.lengthAttr,
      "arcTile",
      "lengthAttr",
      "the ranges input",
    );
    // Primitive index (what every message here names) to arc table.
    const primToTable = new Int32Array(path.primitiveCount).fill(-1);
    for (let i = 0; i < tables.length; i++) primToTable[tables[i].prim] = i;
    let whichPath: Attribute | null = null;
    if (params.pathAttr !== "") {
      whichPath = requireScalarPointAttr(
        ranges,
        params.pathAttr,
        "arcTile",
        "pathAttr",
        "the ranges input",
      );
    } else if (tables.length > 1) {
      throw new Error(
        `arcTile: the path input holds ${tables.length} polylines (primitives ${tables.map((t) => t.prim).join(", ")}), so every range has to say which one it tiles — set "pathAttr" to a point attribute on the ranges input holding that primitive index. It is required rather than defaulted to the first, because tiling the wrong road produces a cook that looks entirely fine.`,
      );
    }

    const spacingOf =
      scalarSpacing === undefined
        ? perElement(ranges, "point", params.spacing, seed, "arcTile", "spacing", "range", "a spacing")
        : () => scalarSpacing;
    const flareOf =
      scalarFlare === undefined
        ? perElement(ranges, "point", params.flare, seed, "arcTile", "flare", "range", "a flare")
        : () => scalarFlare;
    const taperOf =
      scalarTaper === undefined
        ? perElement(ranges, "point", params.taper, seed, "arcTile", "taper", "range", "a taper")
        : () => scalarTaper;

    // Pass one: validate every range and count its tiles. The cloud has
    // to be sized before anything is written into it, and a refusal is
    // cheapest before any of it is built.
    const tileCount = new Int32Array(nRanges);
    const tableOf = new Int32Array(nRanges);
    const startOf = new Float64Array(nRanges);
    const stepOf = new Float64Array(nRanges);
    const lengthOf = new Float64Array(nRanges);
    let total = 0;
    for (let r = 0; r < nRanges; r++) {
      if ((r & 1023) === 0) checkCancelled();
      let ti = 0;
      if (whichPath !== null) {
        const raw = whichPath.data[r];
        const prim = Math.trunc(raw);
        const found = prim >= 0 && prim < primToTable.length ? primToTable[prim] : -1;
        if (!Number.isFinite(raw) || found < 0) {
          throw new Error(
            `arcTile: range ${r} names primitive ${raw} in "pathAttr" attribute "${params.pathAttr}", which is not a polyline of the path input; its polylines are at primitives ${tables.map((t) => t.prim).join(", ")}`,
          );
        }
        ti = found;
      }
      const table = tables[ti];
      const L = table.length;
      if (!(L > 0)) {
        throw new Error(
          `arcTile: the path at primitive ${table.prim} has zero length (all of its points sit at the same position), so there is no arc to tile along; move its points apart or drop it upstream`,
        );
      }
      const len = lengthAttr.data[r];
      if (!(len > 0)) {
        throw new Error(
          `arcTile: range ${r} has length ${len} in "${params.lengthAttr}", but every range must have length > 0 — a range with no length is a single placement rather than a tiling, and emitting one tile for it would look like a very short tunnel. Drop it upstream (filterByAttribute on "${params.lengthAttr}") or place it with pathPointAt.`,
        );
      }
      const rawStart = startAttr.data[r];
      if (!Number.isFinite(rawStart)) {
        throw new Error(
          `arcTile: range ${r} has start ${rawStart} in "${params.startAttr}"; a range with no arc position has nowhere to be tiled. Fix the column upstream, or drop the range with filterByExpression.`,
        );
      }
      let start = rawStart;
      if (table.closed) {
        if (len > L) {
          throw new Error(
            `arcTile: range ${r} is ${len} long on the closed path at primitive ${table.prim}, whose own length is ${L} — the tiles would lap the loop and cover the same arc twice. Shorten the range, or tile the loop in one range of exactly ${L}.`,
          );
        }
        // A closed path's arc wraps, so any start is legal; normalized
        // once here rather than per tile.
        start = ((start % L) + L) % L;
      } else if (start < 0 || start + len > L) {
        throw new Error(
          `arcTile: range ${r} runs from ${start} to ${start + len} on the OPEN path at primitive ${table.prim}, whose arc runs 0 to ${L}. An open path does not wrap, and this is refused rather than clamped: a clamped range is a shorter run than the one that was planned, reported as a success. Move or shorten the range upstream, or close the path (pointsToPath with closed true) if it was meant to be a loop.`,
        );
      }
      const sp = spacingOf(r);
      if (!(sp > 0)) {
        throw new Error(
          `arcTile: the "spacing" field resolved to ${sp} on range ${r}, but every range's spacing must be > 0 — a spacing of 0 or less places no tile at any distance. Bound the expression with max(<the spacing field>, <the smallest pitch you meant>).`,
        );
      }
      // Ceil, not round: see the `spacing` param. At least one tile, so a
      // range shorter than its own spacing still gets its piece.
      const count = Math.max(1, Math.ceil(len / sp));
      if (total + count > MAX_TILE_POINTS) {
        throw new Error(
          `arcTile: range ${r} (length ${len}, spacing ${sp}) takes ${count} tiles, and the input's ${nRanges} range(s) would place more than ${MAX_TILE_POINTS} tiles in total. The cap is on the TOTAL, not on one range — a per-range cap would pass a thousand ranges of a million tiles each — so this is the range the running count ran out on rather than necessarily the finest offender. Raise the spacing, or shorten the ranges: a spacing of ${len / Math.max(1, MAX_TILE_POINTS - total)} would fit this range in what is left.`,
        );
      }
      tileCount[r] = count;
      tableOf[r] = ti;
      startOf[r] = start;
      lengthOf[r] = len;
      stepOf[r] = len / count;
      total += count;
    }

    const out = createPointCloud(total);
    const op = out.attrs.point.require("P").data;
    const rot = out.attrs.point.require("rot").data;
    const scale = out.attrs.point.require("scale").data;
    const seeds = out.attrs.point.require("seed").data;
    const tangent = out.attrs.point.add("tangent", "f32", 3, [0, 0, 0]).data;
    const curveU = out.attrs.point.add("curveU", "f32", 1, 0).data;
    // The opt-in columns, checked against the set they land on — this
    // node's OWN fresh cloud, not the input's, so the refusal must say so
    // (removeAttribute upstream cannot reach a column the node writes on
    // the geometry it emits).
    const optional: { param: string; name: string; type: AttrType; suggestion: string }[] = [
      { param: "flareAttr", name: params.flareAttr, type: "f32", suggestion: "flare" },
      { param: "tileIndexAttr", name: params.tileIndexAttr, type: "i32", suggestion: "tileIndex" },
      { param: "rangeIndexAttr", name: params.rangeIndexAttr, type: "i32", suggestion: "rangeIndex" },
    ];
    const seenOpt = new Map<string, string>();
    for (const slot of optional) {
      if (slot.name === "") continue;
      const other = seenOpt.get(slot.name);
      if (other !== undefined) {
        throw new Error(
          `arcTile: params "${other}" and "${slot.param}" are both "${slot.name}"; they are two different values and need two attributes, or the second would overwrite the first with no complaint`,
        );
      }
      seenOpt.set(slot.name, slot.param);
      requireReportSlot({
        attrs: out.attrs.point,
        nodeType: "arcTile",
        param: slot.param,
        name: slot.name,
        type: slot.type,
        tupleSize: 1,
        domain: "point",
        suggestion: slot.suggestion,
        on: "output",
      });
    }
    const flareCol =
      params.flareAttr === "" ? null : out.attrs.point.replace(params.flareAttr, "f32", 1, 0).data;
    const tileIndexCol =
      params.tileIndexAttr === ""
        ? null
        : out.attrs.point.replace(params.tileIndexAttr, "i32", 1, 0).data;
    const rangeIndexCol =
      params.rangeIndexAttr === ""
        ? null
        : out.attrs.point.replace(params.rangeIndexAttr, "i32", 1, 0).data;

    // The carried range columns, checked before a single tile is placed:
    // the refusal costs nothing here and the work does.
    const carried: Attribute[] = [];
    const seenCarry = new Set<string>();
    for (const name of params.rangeNames) {
      if (name === "") {
        throw new Error(
          'arcTile: param "rangeNames" holds an empty name; every entry must name a point attribute of the ranges input',
        );
      }
      if (seenCarry.has(name)) {
        throw new Error(
          `arcTile: param "rangeNames" lists "${name}" twice; one column cannot be carried onto the tiles under one name twice, and the repeat is more likely a typo for another attribute`,
        );
      }
      seenCarry.add(name);
      const attr = ranges.attrs.point.get(name);
      if (!attr) {
        throw new Error(
          `arcTile: param "rangeNames" names point attribute "${name}", which the ranges input does not have; its point attributes are: ${ranges.attrs.point.names().join(", ") || "(none)"}`,
        );
      }
      if (out.attrs.point.has(name)) {
        throw new Error(
          `arcTile: param "rangeNames" names "${name}", which is already a column this node writes on every tile — carrying it would DELETE what the node wrote and the cook would look fine afterwards. Copy it to another name on the ranges first (setAttribute) and carry that. The names this node owns on its tiles are: ${out.attrs.point.names().join(", ")}.`,
        );
      }
      carried.push(attr);
    }

    // Which range and which path each tile came from: the first drives the
    // carry that makes a run atomic, the second the primitive carry that
    // brings the road's own values along.
    const tileRange = new Uint32Array(total);
    const tilePrim = new Uint32Array(total);
    // The range roots each tile's seed — its own `seed` folded with its
    // index — so the tiles of one range keep their randomness when a
    // DIFFERENT range changes, which a global tile index cannot offer.
    // The index is folded in as well as the seed because a ranges cloud
    // that never had one written carries a column of zeros, and rooting
    // on that alone would give every range the same tiles.
    const rangeSeed = ranges.attrs.point.get("seed");
    const lengthComp = axis[1] === "x" ? 0 : axis[1] === "y" ? 1 : 2;
    const at = [0, 0]; // scratch [segment, t], reused by every tile
    const q: number[] = [0, 0, 0, 1];
    let w = 0;
    for (let r = 0; r < nRanges; r++) {
      const table = tables[tableOf[r]];
      const L = table.length;
      const count = tileCount[r];
      const step = stepOf[r];
      const start = startOf[r];
      const len = lengthOf[r];
      const fl = flareOf(r);
      const tp = taperOf(r);
      const key = hashCombine(rangeSeed === undefined ? 0 : rangeSeed.data[r], r);
      for (let i = 0; i < count; i++) {
        if ((w & 1023) === 0) checkCancelled();
        // Centres of `count` equal sub-intervals: a piece one step long
        // laid on each covers the range exactly, with none of it hanging
        // out of either mouth.
        const local = (i + 0.5) * step;
        let s = start + local;
        // Only a closed path wraps; an open one had its range checked
        // against its ends above.
        if (table.closed && s >= L) s %= L;
        locateOnArcLength(at, table.cum, s);
        const lo = at[0];
        const t = at[1];
        const dx = table.segDir[lo * 3];
        const dy = table.segDir[lo * 3 + 1];
        const dz = table.segDir[lo * 3 + 2];
        op[w * 3] = table.segStart[lo * 3] + dx * t;
        op[w * 3 + 1] = table.segStart[lo * 3 + 1] + dy * t;
        op[w * 3 + 2] = table.segStart[lo * 3 + 2] + dz * t;
        const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (segLen > 0) {
          const inv = 1 / segLen;
          const fx = dx * inv;
          const fy = dy * inv;
          const fz = dz * inv;
          tangent[w * 3] = fx;
          tangent[w * 3 + 1] = fy;
          tangent[w * 3 + 2] = fz;
          orientQuat(q, fx, fy, fz, 0, 1, 0, axis);
          rot[w * 4] = q[0];
          rot[w * 4 + 1] = q[1];
          rot[w * 4 + 2] = q[2];
          rot[w * 4 + 3] = q[3];
        }
        // A tile landing on a zero-length segment keeps the identity
        // rotation and a zero tangent, which is pathResample's answer to
        // the same degeneracy — there is no direction to point at.
        curveU[w] = s / L;
        // The nearer mouth decides the ramp; the two never add, so a
        // range shorter than twice its flare is ramped everywhere.
        const toMouth = Math.min(local, len - local);
        const ramp = fl > 0 && toMouth < fl ? 1 - toMouth / fl : 0;
        if (ramp > 0 && tp !== 1) {
          // The cross-section opens; the length along the path does not,
          // or the mouth pieces would grow apart and open the seams.
          const f = 1 + (tp - 1) * ramp;
          scale[w * 3] = lengthComp === 0 ? 1 : f;
          scale[w * 3 + 1] = lengthComp === 1 ? 1 : f;
          scale[w * 3 + 2] = lengthComp === 2 ? 1 : f;
        }
        if (flareCol) flareCol[w] = ramp;
        if (tileIndexCol) tileIndexCol[w] = i;
        if (rangeIndexCol) rangeIndexCol[w] = r;
        seeds[w] = hashCombine(seed, key, i);
        tileRange[w] = r;
        tilePrim[w] = table.prim;
        w++;
      }
    }
    if (carried.length > 0) copyElements(carried, out.attrs.point, tileRange, total);
    carryPrimitiveAttributes(path.attrs.primitive, out.attrs.point, tilePrim, "arcTile", "point");
    return { out: [makeGeometryItem(out)] };
  },
});
