/**
 * Quotas: what a population is MADE OF, and the smallest change that makes
 * it so.
 *
 * One node so far, {@link quotaRebalance}, and one question behind it — the
 * things here fall into kinds, the kinds are supposed to appear in stated
 * proportions, and they do not. That question is not a distribution and
 * cannot be sampled: drawing each element from a weighted table gives the
 * proportions IN EXPECTATION and a particular population still misses,
 * which is exactly the case a stated proportion exists to rule out. So the
 * shape here is the shape `src/nodes/visibility.ts` already has — placement
 * happens upstream, this checks the result and says what to change.
 *
 * IT DECIDES AND DOES NOT ACT, which is the difference between this file
 * and that one. `occlusionCull` knows what a blocked point should become
 * (moved aside, or gone). Nothing here knows what an element of a different
 * KIND looks like: turning a "mid" into an "over" is a redraw only the
 * caller can perform. So the node writes down WHICH elements must change
 * kind and WHICH kind each should join, and a `setAttribute` or a
 * `copyToPoints` downstream does the changing. That also keeps it whole:
 * one node, no draw, no seed, no randomness at all.
 */
import type { Geometry } from "../data/index.js";
// Directly, not through `../data/index.js`: identity is internal to the
// library (see that module's header), and every identity-keyed node in the
// standard library reaches it the same way.
import { canonicalPointRanks } from "../data/identity.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";
import {
  CANCEL_STRIDE,
  type FieldParam,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  resolveOn,
} from "./util.js";

/** Named once; every message in this file leads with it. */
const NODE = "quotaRebalance";

/**
 * What a stay is written as, and it is not a category index.
 *
 * A DESTINATION COLUMN THAT SPELLED "STAYS" AS THE ELEMENT'S OWN CATEGORY
 * would be ambiguous in the one place it is read: the caller's test for
 * "did this element move" is a comparison against the category column, and
 * an element the node never considered — one `include` switched off, whose
 * category it therefore never validated — has no category to compare
 * against. -1 is outside every category index by construction, so `>= 0` is
 * the whole of the test and it is right for both.
 */
const STAYS = -1;

/** Params of {@link quotaRebalance}. */
export interface QuotaRebalanceParams {
  category: FieldParam;
  min: readonly number[];
  max: readonly number[];
  include: FieldParam;
  eligible: FieldParam;
  priority: FieldParam;
  targetAttr: string;
  unmetAttr: string;
}

/**
 * Resolve one field-capable scalar param to a per-point array.
 *
 * A PLAIN NUMBER IS FILLED, NEVER ROUTED THROUGH A FIELD COLUMN, for the
 * reason `visibility.ts` gives at the same helper: `constant()` stores f32,
 * so a plain `priority` of 0.3 would arrive as 0.30000001192092896 and two
 * elements an author wrote as equal would order by rounding rather than by
 * identity. The fill is also the common case — three of the four params
 * here are constant in every graph that does not need them.
 */
function scalarPerPoint(
  geo: Geometry,
  param: string,
  value: FieldParam,
  count: number,
): Float64Array {
  const out = new Float64Array(count);
  if (typeof value === "number") {
    // CHECKED HERE AND NOT ONLY ON THE FIELD PATH, which is the asymmetry
    // this guard closes. `resolveOn` refuses a non-finite FIELD; a plain
    // number went straight into the array, and a plain NaN `priority` then
    // made the sort comparator inconsistent (NaN differs from itself, so
    // both `(a, b)` and `(b, a)` compared greater) and the identity
    // tiebreak was never reached — the one promise this node makes about
    // order, broken by the one param spelling that skipped the check.
    if (!Number.isFinite(value)) {
      throw new Error(
        `${NODE}: param "${param}" is ${value}; it must be a finite number (or a field that resolves to one on every point)`,
      );
    }
    out.fill(value);
    return out;
  }
  const col = requireScalarColumn(
    // Seed 0: nothing here is random, and a field that reads `randomField`
    // still resolves — it just resolves the same way on every cook, which
    // is what a node with no seed param can promise.
    resolveOn(geo, "point", value, 0, NODE, param),
    NODE,
    param,
    "point",
    `${param} is a single number per element`,
  );
  // A resolved column is packed data plus a tuple size, not an accessor —
  // and a scalar one broadcasts when it came from a constant, so its data
  // can be shorter than the domain.
  const data = col.data;
  const wide = data.length >= count;
  for (let i = 0; i < count; i++) out[i] = data[wide ? i : 0] as number;
  return out;
}

/**
 * Decides which elements must change CATEGORY for every category's share of
 * the population to land inside its stated band, and names the category
 * each should join.
 */
export const quotaRebalance = standardNode<QuotaRebalanceParams>({
  type: NODE,
  category: "attribute",
  description:
    "Reads a CATEGORY per point and a stated SHARE BAND per category, and writes down the minimum set of points that must change category for every share to land inside its band — which category each should join, and nothing else. This is the node for 'these six kinds, in these proportions', where the proportions are a REQUIREMENT rather than a hope: drawing each element from a weighted table gives the mix in expectation, and any particular population still misses, which is exactly what a stated proportion exists to rule out. `min` and `max` are two lists of the same length, one entry per category, in shares of the counted population (0.1 is a tenth); the list length IS the number of categories, so there is no second param to disagree with them. IT MOVES TO THE NEAREST EDGE AND STOPS, never to the middle of a band, and that is the whole of its restraint: a category a tenth below its floor is lifted to its floor and left there. Driving every category to the centre of its range would make a generated population markedly more uniform than a real one — populations reach a stated aggregate through variation between them, not by every one of them hitting the same number, so a generator that lands on the middle every time scores better against the rule and is worse. IT DECIDES AND DOES NOT ACT. Nothing here knows what an element of a different category looks like: whatever turns a 'mid' into an 'over' is a redraw only the caller can perform. So the output is a per-point DESTINATION, and a setAttribute, copyToPoints or transferByIndex downstream does the changing — usually inside a repeatUntil, so that a redraw which lands in the wrong category is simply seen again on the next round. WHICH ELEMENTS GO is `priority` ascending: the lowest-priority eligible member of an over-full category leaves first. That param is the one worth thinking about, because the obvious choice is usually wrong — priority by a POSITION coordinate takes the first members along that axis and concentrates every change in one stretch, which reads as a patch of different-looking work rather than as a mix. A hash (randomField) spreads them; a measure of how badly each element fits where it is concentrates them where they were least right. `include` and `eligible` are two different exclusions and both are needed: an element with `include` off is not counted in any share and cannot move (it is not part of the scheme being stated), while an element with `eligible` off still COUNTS toward its category's share but is never chosen to leave (it is part of the population and is pinned where it is — a landmark, a reserved marker, anything a stronger rule already placed). DETERMINISM: ties in `priority` are broken by point IDENTITY — the bits of the stored position plus the per-point `seed` attribute — never by array index, so shuffling the input or filtering something upstream yields the identical decision. HALO: none, and unlike the rest of the library that is not a number but an absence. A share is a fact about the WHOLE population, so this node has no partitioned form at all: cooked over half the points it reads half the denominator and decides a different set. It belongs on an unbounded level, or before a split. OUTPUT is the input geometry with one i32 point attribute added, `targetAttr`: the category index each moving point should join, and -1 on every point that stays — including every point `include` switched off, whose category is therefore never even read. No point is added, removed or moved, and topology survives untouched. A SHARE IS A RATIO OF WHOLE POINTS, and that is checked rather than hoped for. A category can only hold ceil(min*n) to floor(max*n) of n counted points, so bands that are legal as real numbers can still be unreachable by this particular population: five points against a band of [0.04, 0.12] need at least 1 and allow at most 0, and two categories banded [0, 0.1] and [0, 0.9] over 13 points admit no arrangement at all, since 1/13 is under the first ceiling and 12/13 is over the second. Measured over 312,581 band lists that pass the two SUM checks, better than one in five are unreachable this way, and every one of them used to drive this node into a ping-pong that spent its whole budget and emitted moves a caller would have redrawn assets for. WHEN THE BANDS ARE UNREACHABLE NO MOVE IS MADE — no arrangement is right, so none is chosen, and a best effort would be a different node, since 'minimum change' has no meaning once the target cannot be hit. That is reported and not thrown, and the distinction is deliberate: a band list no population could satisfy is an authoring error and the two SUM checks refuse it outright, while a band list this population cannot satisfy is DATA — a cell holding five points, a lap a cull has thinned — and a node that throws on data cannot sit inside the repair loop it exists for. IT CAN ALSO STOP EARLY for a second reason: a category whose members are all ineligible has nothing to give up. `unmetAttr` is how a caller hears about either. COST is one pass over the points per move, and on a reachable set of bands every point that moves moves exactly once — so the pass count IS the move count, the move count is the minimum, and a mix put right by moving a tenth of the population costs a tenth of the passes.",
  inputs: [{ name: "in", kind: "geometry" }],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    category: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Which category each point is IN, as an index into `min`/`max`: 0 for the first entry, 1 for the second, and so on. Read as floor(value), and a point whose index lands outside [0, min.length) is refused naming the point — not clamped, because a category the author did not list is a scheme the author did not state, and folding it into the first or last one would balance a mix nobody asked for. Field-capable and evaluated on the point domain, which is the usual way it arrives: a band decided from a position and a size is an expression, not a column somebody wrote. Only read for points `include` leaves in, so an element outside the scheme needs no category at all.",
    },
    min: {
      type: "numberList",
      default: [],
      description:
        "The FLOOR of each category's share, in order, as a fraction of the counted population: [0.1, 0.04, 0.23] says the first category must hold at least a tenth. Each entry is in [0, 1] and must not exceed the matching `max`. THE LIST'S LENGTH IS THE NUMBER OF CATEGORIES, and `max` must be the same length — a count param beside them would be a third thing to keep in agreement. A floor of 0 is a category with no lower requirement, which is how 'this kind may be absent' is written. The floors are refused if they sum above 1: no population can satisfy them, and finding that out as a cook that never settles is the failure this check exists to replace.",
    },
    max: {
      type: "numberList",
      default: [],
      description:
        "The CEILING of each category's share, in order, on the same scale as `min` and with the same length. A ceiling of 1 is a category with no upper limit. The ceilings are refused if they sum below 1, for the mirror of `min`'s reason: the population has to go somewhere, so ceilings that leave less than the whole of it unallocated cannot all hold at once. A share landing EXACTLY on a floor or a ceiling is INSIDE the band — the comparisons are strict, so a category at exactly its ceiling is not over it, and a caller checking the same thing afterwards should use the same strictness or a slack coarser than the arithmetic (a share is a ratio of whole counts, so landing exactly on a two-decimal bound is the ordinary case rather than a coincidence).",
    },
    include: {
      type: "f32",
      default: 1,
      acceptsField: true,
      description:
        "Nonzero (the default) puts the point IN the scheme: it is counted in its category's share and it may be chosen to move. Zero takes it out of both — not counted in any share, never moved, and its `category` never even read, so an element outside the scheme needs no category to be given one. This is the exclusion for elements that are STRUCTURE rather than population: a tunnel's ribs are all one category by geometry and a lap can carry forty of them, which would take that category from a tenth of the population to a quarter and make the stated mix unreachable on any track that has a tunnel. Compare `eligible`, which is the other exclusion and does the opposite thing to the denominator.",
    },
    eligible: {
      type: "f32",
      default: 1,
      acceptsField: true,
      description:
        "Nonzero (the default) allows this point to be chosen to LEAVE its category. Zero pins it: it still counts toward its category's share — it is part of the population — but is never selected to move. This is the exclusion for elements a STRONGER RULE already placed, and the distinction from `include` is the whole reason there are two params. Switching `include` off would hide the element from the shares as well, so the mix would be balanced against a population that is not the one on screen; switching `eligible` off leaves the arithmetic honest and takes only the element off the table. A category whose members are all ineligible simply cannot give any up, and the rebalance stops when it runs out of donors rather than looping.",
    },
    priority: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Which members of an over-full category leave FIRST: lowest value first, ties broken by point identity. The default of 0 makes every point tie, so the whole decision falls to identity — a stable, position-derived order that is the right answer when the choice genuinely does not matter. IT USUALLY DOES MATTER, and in a way that is invisible in the counts: priority by a position or arc coordinate takes the first k members along that axis, and since a category's members are spread over the whole population, 'the first k' is a CONTIGUOUS PATCH. Every change then lands in one stretch and the result reads as a repair rather than a mix, while every share is exactly right. randomField spreads them instead; a measure of how poorly each element suits its current category concentrates the changes where they were least deserved, which is usually what 'minimum change' was meant to mean.",
    },
    unmetAttr: {
      type: "string",
      default: "",
      description:
        "Optional DETAIL attribute (u32) receiving how many categories are still outside their band when this node stops — 0 when every band was met. Empty (the default) writes nothing. IT EXISTS BECAUSE STOPPING EARLY IS LEGAL AND SILENT. A category whose members are all `eligible`-off cannot give any up, so the rebalance runs out of donors and returns; the geometry it returns looks exactly like the geometry it would have returned on success, and a caller looping until nothing moves would spin on the difference. Name a column here and that caller can tell 'the mix is right' from 'the mix is still wrong and I stopped trying'. It is a count of CATEGORIES rather than of points because that is the question the bands ask; the number of points that moved is already readable as how many of `targetAttr` are >= 0. Same family as transferByIndex's and transferAttribute's `missCountAttr`, and written on the detail domain for their reason: it is one fact about the whole geometry, not one per element.",
    },
    targetAttr: {
      type: "string",
      default: "quotaTarget",
      description:
        "POINT attribute (i32) receiving the category each point should JOIN: an index into `min`/`max` for a point that must move, and -1 for every point that stays where it is, including every point `include` switched off. So the test for 'did this point move' is `>= 0` and needs no comparison against the category column — which matters, because a point outside the scheme has no category this node ever read. May not be empty: a quotaRebalance that writes nothing is a cook that looks like it worked. Same reporting-slot rule as the rest of the library — an existing column of a different shape under this name is refused rather than silently deleted and re-added, and a same-shape one is reset.",
    },
  },
  execute({ inputs, params, checkCancelled }) {
    // Params before geometry, the house order: a bad param reported
    // against the data sends an author to debug the wrong thing.
    const { min, max, targetAttr } = params;
    if (targetAttr === "") {
      throw new Error(
        `${NODE}: param "targetAttr" must be a non-empty attribute name (the default is "quotaTarget"); it is the one column this node exists to write, and a rebalance that writes no destination is a cook that looks like it worked`,
      );
    }
    if (targetAttr === "P") {
      throw new Error(
        `${NODE}: param "targetAttr" cannot be "P" — that would overwrite the positions; use "quotaTarget" or another name`,
      );
    }
    const k = min.length;
    if (k === 0) {
      throw new Error(
        `${NODE}: params "min" and "max" are empty, so no categories are stated and there is nothing to balance; list one share band per category, e.g. min [0.1, 0.3, 0.6] with max [0.2, 0.4, 0.7]`,
      );
    }
    if (max.length !== k) {
      throw new Error(
        `${NODE}: params "min" (${k} entries) and "max" (${max.length} entries) must be the same length — they are the floor and ceiling of the SAME list of categories, and their common length is how many categories there are`,
      );
    }
    let minSum = 0;
    let maxSum = 0;
    for (let c = 0; c < k; c++) {
      const lo = min[c] as number;
      const hi = max[c] as number;
      if (!Number.isFinite(lo) || lo < 0 || lo > 1) {
        throw new Error(
          `${NODE}: param "min" entry ${c} is ${lo}; every entry is a SHARE of the counted population and must be in [0, 1] (0.1 is a tenth, not ten percent of a percent)`,
        );
      }
      if (!Number.isFinite(hi) || hi < 0 || hi > 1) {
        throw new Error(
          `${NODE}: param "max" entry ${c} is ${hi}; every entry is a SHARE of the counted population and must be in [0, 1]`,
        );
      }
      if (lo > hi) {
        throw new Error(
          `${NODE}: category ${c} has min ${lo} above max ${hi}, which is a band no share can be inside; swap them, or widen whichever one was meant`,
        );
      }
      minSum += lo;
      maxSum += hi;
    }
    // A TOLERANCE, BECAUSE THESE ARE SUMS OF AUTHORED DECIMALS AND NOT
    // MEASURED DATA. [0.06, 0.57, 0.37] sums to 0.9999999999999999 in
    // binary and [0.33, 0.56, 0.11] to 1.0000000000000002, so both of
    // those exactly-1 lists were refused — and worse, the verdict moved
    // with the ORDER of the categories, since [0.06, 0.08, 0.86] sums to
    // 1 and the same three ceilings relabelled do not. Around one list in
    // fifteen written in hundredths is affected. This is not the epsilon
    // the share comparisons below deliberately do without: that one is a
    // share against a bound, where landing exactly on the bound is a
    // MEANING; this is a sum of literals against the number they were
    // written to add up to.
    const SUM_SLACK = 1e-9;
    if (minSum > 1 + SUM_SLACK) {
      throw new Error(
        `${NODE}: param "min" sums to ${minSum}, above 1 — the floors together demand more than the whole population, so no arrangement satisfies them and the rebalance would move points forever without converging. Lower the floors so they sum to at most 1`,
      );
    }
    if (maxSum < 1 - SUM_SLACK) {
      throw new Error(
        `${NODE}: param "max" sums to ${maxSum}, below 1 — the ceilings together leave part of the population with nowhere to be, so some category must exceed its ceiling whatever this node does. Raise the ceilings so they sum to at least 1`,
      );
    }

    if (params.unmetAttr !== "" && params.unmetAttr === targetAttr) {
      throw new Error(
        `${NODE}: params "targetAttr" and "unmetAttr" are both "${targetAttr}"; they are two different facts on two different domains and need two names`,
      );
    }

    const src = requireGeometry(inputs, "in", NODE);
    if (params.unmetAttr !== "") {
      requireReportSlot({
        attrs: src.attrs.detail,
        nodeType: NODE,
        param: "unmetAttr",
        name: params.unmetAttr,
        type: "u32",
        tupleSize: 1,
        domain: "detail",
        suggestion: "quotaUnmet",
      });
    }
    requireReportSlot({
      attrs: src.attrs.point,
      nodeType: NODE,
      param: "targetAttr",
      name: targetAttr,
      type: "i32",
      tupleSize: 1,
      domain: "point",
      suggestion: "quotaTarget",
    });

    const geo = cloneGeometry(src);
    const n = geo.attrs.point.count;
    const target = geo.attrs.point.replace(targetAttr, "i32", 1, STAYS).data;
    if (n === 0) return { out: [makeGeometryItem(geo)] };
    target.fill(STAYS, 0, n);

    const include = scalarPerPoint(geo, "include", params.include, n);
    const eligible = scalarPerPoint(geo, "eligible", params.eligible, n);
    const priority = scalarPerPoint(geo, "priority", params.priority, n);
    const categoryRaw = scalarPerPoint(geo, "category", params.category, n);

    // Current category per point, and the counts that make the shares.
    // `cur` is mutated as moves are assigned, exactly as the population it
    // stands for would be, so a point that has already joined a category
    // is a member of it for every later pass.
    const cur = new Int32Array(n);
    // Where each point STARTED, kept because `cur` is overwritten.
    //
    // AND IT IS UNREACHABLE ON ANY INPUT THIS NODE ACCEPTS, which is worth
    // saying rather than leaving for someone to discover: on a reachable
    // set of bands the loop makes the minimum number of moves, so every
    // point that moves moves exactly once and none comes home. The branch
    // it feeds was written before the feasibility check above existed, when
    // a point really could ping-pong, and it is kept because the two
    // guards answer different questions — that one decides which inputs are
    // answerable, this one keeps the REPORT honest if one ever slips
    // through. It has no test for the same reason it has no cost: nothing
    // the suite can construct reaches it.
    const home = new Int32Array(n);
    const count = new Int32Array(k);
    let counted = 0;
    for (let i = 0; i < n; i++) {
      if (!(include[i] !== 0)) {
        cur[i] = STAYS;
        continue;
      }
      const raw = categoryRaw[i] as number;
      const c = Math.floor(raw);
      if (!Number.isFinite(raw) || c < 0 || c >= k) {
        throw new Error(
          `${NODE}: param "category" evaluates to ${raw} at point ${i}, which floors to ${c} and is not one of the ${k} categories "min"/"max" state (0 to ${k - 1}). A category outside the list is a scheme this node was not given, and folding it into the nearest one would balance a mix nobody stated — list the category, or switch "include" off for this point`,
        );
      }
      cur[i] = c;
      home[i] = c;
      count[c] = (count[c] as number) + 1;
      counted++;
    }
    if (counted === 0) return { out: [makeGeometryItem(geo)] };

    // INTEGER FEASIBILITY, AND IT IS A FACT ABOUT THE POPULATION RATHER
    // THAN ABOUT THE PARAMS — which is why it is answered here, and why it
    // is ANSWERED rather than refused.
    //
    // The two sum checks above are exactly right for the REAL-VALUED
    // problem: a box [min, max] meets the probability simplex iff the
    // floors sum to at most 1 and the ceilings to at least 1. A share is
    // not a real number. It is `m / counted` for a whole m, so what a
    // category can actually hold is the integer window [ceil(min*counted),
    // floor(max*counted)], and those windows can be empty, or fail to
    // admit `counted` between them, while the sums are perfectly legal.
    // Five points against a band of [0.04, 0.12] is the whole thing in one
    // line: the floor needs 1 point and the ceiling allows 0.
    //
    // MEASURED, BECAUSE THE SIZE OF IT IS THE ARGUMENT FOR CHECKING AT
    // ALL: over 312,581 band lists and populations that pass the two sum
    // checks, 66,141 -- better than one in five -- are integer-infeasible,
    // and every single one of them drove the loop below into a ping-pong
    // that spent the whole pass budget and emitted moves the caller would
    // have redrawn assets for. On the same sweep every integer-FEASIBLE
    // input finished inside the budget with every band met and no move to
    // spare, so this predicate is not a heuristic guard: it is the exact
    // line between the inputs this node can answer and the ones it cannot.
    //
    // AND IT MAKES NO MOVES RATHER THAN THROWING, which is a correction to
    // what this file did first. A band list that cannot be satisfied by
    // ANY population is an authoring error and the two sum checks above
    // refuse it. A band list that cannot be satisfied by THIS population
    // is data — a cell holding five points, a lap the cull has thinned —
    // and a node that throws on data cannot sit inside a repair loop,
    // which is the one place this node is for. So: no arrangement is
    // right, therefore none is made, and `unmetAttr` is how a caller hears
    // about it. The alternative, a best effort, would be a different node:
    // "minimum change" has no meaning once the target is unreachable.
    //
    // DERIVED WITH THE LOOP'S OWN COMPARISONS rather than with ceil and
    // floor, so that a predicate and a loop which disagree by one ulp is
    // not a thing that can happen: `lo` is the least whole count the loop
    // would not call under its floor, `hi` the greatest it would not call
    // over its ceiling.
    let reachable = true;
    let loSum = 0;
    let hiSum = 0;
    for (let c = 0; c < k; c++) {
      let lo = Math.ceil((min[c] as number) * counted);
      while (lo > 0 && !((min[c] as number) - (lo - 1) / counted > 0)) lo--;
      while ((min[c] as number) - lo / counted > 0) lo++;
      let hi = Math.floor((max[c] as number) * counted);
      while (hi < counted && !((hi + 1) / counted - (max[c] as number) > 0)) hi++;
      while (hi > 0 && hi / counted - (max[c] as number) > 0) hi--;
      if (lo > hi) reachable = false;
      loSum += lo;
      hiSum += hi;
    }
    if (loSum > counted || hiSum < counted) reachable = false;

    // Visit order: priority ascending, ties by point identity. The ranks
    // are built unconditionally even where every priority differs, for
    // `occlusionCull`'s reason — whether this node breaks a tie by
    // identity must be a property of the node and not of the data.
    const rank = canonicalPointRanks(geo, NODE);
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => {
      const pa = priority[a] as number;
      const pb = priority[b] as number;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (rank[a] as number) - (rank[b] as number);
    });
    // Where each point sits in `order`, so a move can rewind the cursor of
    // the category it joins without a search.
    const slot = new Int32Array(n);
    for (let j = 0; j < n; j++) slot[order[j] as number] = j;

    // One cursor per category into `order`: everything before it has
    // already been offered and either taken or found ineligible. Rewound
    // when a point JOINS a category ahead of it, which is the only way a
    // member can appear behind a cursor that has already passed.
    const cursor = new Int32Array(k);

    // The pass loop is the reference shape this node generalises: recompute
    // the shares, take the worst offender on each side, move ONE element,
    // repeat. Bounded by the counted population, and on a feasible input
    // that bound is not merely safe but TIGHT IN THE RIGHT DIRECTION: every
    // point that moves, moves exactly once, so the pass count is the move
    // count and the move count is the minimum.
    //
    // THIS COMMENT USED TO CLAIM THAT A MOVE CANNOT UNDO AN EARLIER ONE,
    // "because a category is only ever a source while it is above its
    // ceiling and only ever a destination while it is below its floor."
    // BOTH HALVES ARE FALSE, and stating it plainly matters because the
    // falsity was the mechanism of the bug the feasibility check above now
    // rules out: the two `room` fallbacks below choose a source that is NOT
    // over its ceiling and a destination that is NOT under its floor, which
    // is exactly how one category becomes a source in one pass and a
    // destination in the next. What actually stops the undo is feasibility,
    // enforced up there and not down here.
    for (let pass = 0; reachable && pass < counted; pass++) {
      if ((pass & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
      let from = -1;
      let over = 0;
      let to = -1;
      let under = 0;
      for (let c = 0; c < k; c++) {
        const share = (count[c] as number) / counted;
        const above = share - (max[c] as number);
        if (above > over) {
          over = above;
          from = c;
        }
        const below = (min[c] as number) - share;
        if (below > under) {
          under = below;
          to = c;
        }
      }
      // Nothing above a ceiling and nothing below a floor: done, however
      // far any category sits from the middle of its band.
      if (from < 0 && to < 0) break;
      // One side set and not the other. The missing half goes to whichever
      // category has the most ROOM in the direction needed — the most left
      // above its floor when it must donate, the most left below its
      // ceiling when it must receive — which keeps a forced move from
      // opening the next violation.
      // A WHOLE POINT OF ROOM, not merely room. A category with less than
      // one point of slack cannot give one up, or take one, without
      // crossing its own bound — so choosing it here would be choosing the
      // move that opens the next violation, which is the shape the loop
      // spends its budget on. Measured against the looser `spare > 0`: on
      // 245,552 feasible inputs the two agree on every point, and on the
      // inputs the feasibility check above now refuses it cut the wasted
      // passes by two thirds. So it costs nothing where the node is right,
      // and it is the more honest statement of what "room" has to mean.
      // The test is `>=` and not `>`: a category with EXACTLY one point of
      // room lands exactly on its bound after the move, and a share on its
      // bound is inside it — the same strictness the two tests above use.
      const WHOLE = 1 / counted;
      if (from < 0) {
        let room = -Infinity;
        for (let c = 0; c < k; c++) {
          if (c === to) continue;
          const spare = (count[c] as number) / counted - (min[c] as number);
          if (spare >= WHOLE && spare > room) {
            room = spare;
            from = c;
          }
        }
      } else if (to < 0) {
        let room = -Infinity;
        for (let c = 0; c < k; c++) {
          if (c === from) continue;
          const spare = (max[c] as number) - (count[c] as number) / counted;
          if (spare >= WHOLE && spare > room) {
            room = spare;
            to = c;
          }
        }
      }
      if (from < 0 || to < 0 || from === to) break;

      // The lowest-priority eligible member of `from` that has not already
      // been taken. A category whose members are all pinned has none, and
      // that ends the rebalance rather than spinning on it.
      let picked = -1;
      let j = cursor[from] as number;
      for (; j < n; j++) {
        const i = order[j] as number;
        if (cur[i] !== from) continue;
        if (!(eligible[i] !== 0)) continue;
        picked = i;
        break;
      }
      cursor[from] = j + 1;
      if (picked < 0) break;

      cur[picked] = to;
      target[picked] = to === (home[picked] as number) ? STAYS : to;
      count[from] = (count[from] as number) - 1;
      count[to] = (count[to] as number) + 1;
      const joined = slot[picked] as number;
      if (joined < (cursor[to] as number)) cursor[to] = joined;
    }

    if (params.unmetAttr !== "") {
      let unmet = 0;
      for (let c = 0; c < k; c++) {
        const share = (count[c] as number) / counted;
        if (share - (max[c] as number) > 0 || (min[c] as number) - share > 0) unmet++;
      }
      geo.attrs.detail.replace(params.unmetAttr, "u32", 1, 0).set(0, unmet);
    }

    return { out: [makeGeometryItem(geo)] };
  },
});
