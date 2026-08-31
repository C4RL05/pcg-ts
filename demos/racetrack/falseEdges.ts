/**
 * L-5: no false edges.
 *
 * THE RULE. Nothing in Z2-Z3 may present a continuous horizontal line at
 * h = 0.2-0.6W that runs parallel to the track but DIVERGES from it. It
 * reads as the track edge, and a driver steering to it steers off the
 * road. Diverging ground detail must sit below h = 0.2W or beyond
 * |t| = 2.5W.
 *
 * THIS ONE IS INVENTED, AND WAS EXPECTED TO BE WRONG. The answer, from
 * a pooled sweep of the catalogue's own placements, is that half of it is
 * confirmed and half of it is refuted — and the half that is refuted is
 * the half I first reported.
 *
 * SEVENTEEN QUALIFYING RUNS, against a null that shuffles which lateral
 * goes with which station inside the band and side, so the runs form in
 * the same places and only the offsets are dealt at random:
 *
 *   worst residual off the fitted line   0.063W real   0.237W null   p < 0.002
 *   |slope| of the line                  0.004         0.012         p = 0.008
 *   lines diverging past 0.02            5 of 17       7 of 17       p = 0.264
 *
 * THE LINES ARE REAL. Four times tighter to a straight fit than chance,
 * and flatter than chance. The catalogue's own placements do build
 * continuous horizontal lines at exactly this height in exactly this
 * band, and they are assembled, not scattered.
 *
 * THE NON-DIVERGENCE IS NOT. Five of seventeen diverge against seven
 * expected: A THIRD OF THE CATALOGUE'S OWN VERGE LINES ARE FALSE EDGES BY
 * THIS RULE'S OWN DEFINITION. And that is not an underpowered null — seventeen
 * runs at a 41% null rate would have given p = 0.0006 had none diverged,
 * so the test could have confirmed the rule and did not. It is
 * non-significant at every qualifying span from 4W to 8W, so it is not a
 * threshold artefact either.
 *
 * The reading: the tightness is a property of how a run is assembled —
 * repeated pieces set along a barrier at a fixed offset — and not of any
 * rule against divergence. Where a line drifts, the catalogue lets it
 * drift. So L-5 stays INVENTED, with the invention now separated from the
 * rest: build the lines the way the catalogue does, and add the
 * non-divergence yourself, knowing it is yours.
 *
 * WHICH MAKES THE REPAIR MATTER MORE THAN A GREEN WOULD HAVE. If the
 * catalogue only avoids two thirds of these by accident, a generator that
 * avoids all of them is doing something the catalogue does not,
 * deliberately and for a stated reason.
 *
 * The generator, by contrast, places laterals independently from each
 * asset's own distribution — which is the null — so it produces false
 * edges at the null rate unless something stops it. That is why the
 * repair exists whatever the catalogue turns out to do.
 */
import type { StationedPlacement } from "./legibility.js";
import { SAME_PLACE_W } from "./tolerance.js";

export const FALSE_EDGE = {
  /** Z2-Z3: the verge and near bands, where a line reads as the edge. */
  lateralW: [1, 2.5],
  /** The height a driver mistakes for the track edge. */
  heightW: [0.2, 0.6],
  /** Members closer than this along the lap belong to the same run. */
  gapW: 3,
  /** Fewer than this is not a line. */
  minMembers: 3,
  /** And a line shorter than this is not read as an edge. */
  minSpanW: 4,
  /** How far a member may sit off the common line and still be on it. */
  straightW: 0.3,
  /** Divergence, in W of lateral per W of lap. Below this is parallel. */
  divergence: [0.02, 0.3],
  /** A single object this long presents a line by itself. */
  singleSpanW: 4,
} as const;

/**
 * WHAT A BARRIER LOOKS LIKE, and what this demo does not build.
 *
 * Pooled over the 17 qualifying runs in the catalogue. It is here because
 * it DESCRIBES THE PIECE THAT IS MISSING, and it belongs next to
 * the rule that piece would satisfy.
 *
 *   pieces per run     p10 3      median 5      p90 13      max 15
 *   run length         p10 5.4W   median 6.5W   p90 22.6W   max 40.6W
 *   spacing of pieces  p10 1.13W  median 2.59W  p90 2.93W   CV 0.37
 *   residual off line  p10 0.008W median 0.063W p90 0.245W
 *
 * THE CV IS THE FINDING. 0.37, against C-1's 1.5-2.5 for scattered
 * furniture. That gap is the assembly signature and it is what produces
 * the tight residual the pooled test found: A BARRIER IS NOT FURNITURE
 * PLACED DENSELY, IT IS A REGULAR RUN, and those are different
 * primitives.
 *
 * ONE FIGURE IS CENSORED AND MUST NOT BE BUILT TO. A run is DEFINED by
 * gaps under 3W, so the spacing p90 of 2.93W is the definition showing
 * through rather than a finding. The median and the CV are the usable
 * numbers.
 *
 * WHY THIS DEMO ONLY AVOIDS THE FAILURE INSTEAD OF BUILDING THE THING.
 * The generator draws every lateral independently from its asset's own
 * distribution, which is exactly the null the pooled test was scored
 * against — so it makes false edges at the null rate and the repair below
 * earns its place. But it has no model of ASSEMBLY at all: it cannot
 * produce a 0.063W residual, only decline to produce a diverging one.
 * The missing primitive is a run placer — repeated pieces at a fixed
 * offset over a stretch — which is the same shape as L-6's tiled cover in
 * `tunnels.ts`. If those are one primitive, L-5 and L-6 are both
 * satisfied by CONSTRUCTION by the same code, which would be a better
 * outcome than two repairs.
 *
 * NOBODY HAS COMPARED THEM, AND THE PREDICTION IS ON THE RECORD SO IT CAN
 * BE WRONG. The guess, made before anyone checked: ONE primitive.
 * Both are repeated pieces at a fixed offset over a station range, and
 * both showed the same tiling signature from opposite directions — L-6's
 * cover reads as 126 separate objects with no single one above 5.9% of
 * it, L-5's barrier as a spacing CV of 0.37 against C-1's
 * 1.5-2.5 — and neither had any reason to resemble the other unless a run
 * has exactly one way of being built.
 *
 * If it turns out to be TWO, the interesting part is what separates them,
 * and that is the better finding. Written down here rather than left in a
 * message thread because a prediction that cannot be found later is not a
 * prediction.
 */
export const BARRIER = {
  piecesPerRun: { p10: 3, median: 5, p90: 13, max: 15 },
  runLengthW: { p10: 5.4, median: 6.5, p90: 22.6, max: 40.6 },
  /** `p90` is censored by the 3W run definition. Use the median and CV. */
  spacingW: { p10: 1.13, median: 2.59, p90: 2.93, cv: 0.37 },
  residualW: { p10: 0.008, median: 0.063, p90: 0.245 },
  /** C-1's gap CV for scattered furniture, for the contrast. */
  furnitureCv: [1.5, 2.5],
} as const;

/**
 * Is this placement in the band where a line would be mistaken for the edge?
 *
 * EVERY RUNG SLACKED OUTWARD, AND THE SLACK IS NOT DEFENSIVE — it is what
 * makes this test mean the same thing as the one `dressGraph.ts` states in
 * f32 attribute columns. The two spellings have to agree on a boundary
 * this demo lands on BY CONSTRUCTION: Z-1 stands large art off at exactly
 * `1 + across/2`, which is the lower lateral bound for a piece of no width
 * and the upper one for a piece exactly 3W wide, and Z-3's bands take
 * their heights from a table whose entries are the bounds themselves.
 *
 * The graph MUST slack: `f32(0.6)` is 0.600000024, above 0.6, so an
 * untoleranced `<=` there drops a placement this function keeps — and the
 * whole run around it changes span, slope, residual and midpoint. Having
 * established that one side has to, the only way the two can agree is for
 * both to, which is the same conclusion `inCorridor` reached in `zones.ts`
 * and for the same reason. Slacking OUTWARD keeps the f64 answer for any
 * value sitting exactly on a rung, and `SAME_PLACE_W` is sized so that
 * nothing on these populations sits inside the slack.
 */
export function inEdgeBand(p: StationedPlacement): boolean {
  const a = Math.abs(p.t);
  return (
    a >= FALSE_EDGE.lateralW[0] - SAME_PLACE_W &&
    a <= FALSE_EDGE.lateralW[1] + SAME_PLACE_W &&
    p.h >= FALSE_EDGE.heightW[0] - SAME_PLACE_W &&
    p.h <= FALSE_EDGE.heightW[1] + SAME_PLACE_W
  );
}

export interface EdgeRun {
  /** Indices into the placement list, in station order. */
  readonly members: number[];
  readonly startW: number;
  readonly spanW: number;
  /** W of lateral per W of lap. Signed: away from the track is positive. */
  readonly slope: number;
  /** The worst distance from the fitted line, in W. */
  readonly residualW: number;
  readonly side: 1 | -1;
}

/**
 * Fit a line to a run and report how straight and how divergent it is.
 *
 * FITTED ON |t|, NOT t. A false edge is a line drifting AWAY from the
 * road, and on the left of the track that means t decreasing. Fitting the
 * signed lateral would give the two sides opposite signs for the same
 * defect and halve the detector's sensitivity on whichever side the
 * threshold was written for.
 *
 * AND FITTED ON RUN-LOCAL ARC, NOT ON LAP ARC. `stations` arrive as
 * distances round the whole lap — 0 to ~360W, and past a lap where the
 * run crosses the start line — while the run itself spans forty W at the
 * outside and the |t| it is fitted against is order one. The regression
 * only ever uses `s - mean(s)`, so every one of those leading digits is
 * subtracted away again: this is a difference of two nearly equal large
 * numbers, computed to decide a threshold on a small one.
 *
 * In f64 that costs four of seventeen digits and nobody notices. In f32
 * there are seven digits and the spacing at station 360 is 3e-5, so a
 * forty-W span is written with about six of them and the deviation from
 * its mean keeps two — against a divergence band of 0.02 to 0.3 W of
 * lateral per W of lap, which is where the whole of L-5 lives. The
 * detector would be reading its own quantisation.
 *
 * Subtracting the run's own start first is THE SAME LINE THROUGH THE SAME
 * POINTS — a least-squares fit is translation-invariant in s, and both
 * the slope and the residual are unchanged by it — computed where the
 * numbers are small. It is free in f64 and it is the difference between a
 * detector and a noise source in f32. It also puts the degenerate-run
 * guard below back above the floor it was sitting in: `den` is a sum of
 * squared deviations, and at lap arc those squares were ~1e-9 of pure
 * cancellation, which is the guard's own threshold.
 */
function fitRun(
  placements: readonly StationedPlacement[],
  members: readonly number[],
  /**
   * The members' stations, UNWRAPPED — ascending even where the run
   * crosses the start line, so a line through station 0 fits as the line
   * it is rather than as a jump back to zero.
   */
  stations: readonly number[],
): {
  slope: number;
  residualW: number;
} {
  // FROM `stations`, NOT `members`. The two are parallel by
  // construction and there is one call site — but deriving the length
  // from one array while averaging over the other is how a mismatch
  // becomes a silent misfit rather than an error.
  //
  // AND AN EMPTY RUN IS ANSWERED, NOT REBASED. Rebasing reads
  // `stations[0]`, which is `undefined` on an empty array and turns every
  // element into NaN — where the un-rebased version this replaced just
  // produced `n = 0` and fell through to the `den` guard. The one call
  // site can never send an empty run (it returns early below
  // `FALSE_EDGE.minMembers`), so this is unreachable today; it is here
  // because the change made an exported function newly able to answer
  // NaN, and a guard is cheaper than the argument that nobody will.
  if (stations.length === 0) return { slope: 0, residualW: 0 };

  // Rebased on the run's own start, per the note above. The run's first
  // member is the origin, so `s` runs 0 to `spanW` however far round the
  // lap the run sits, and the slope and residual it produces are the lap
  // arc's own.
  const s = stations.map((v) => v - stations[0]);
  const n = s.length;
  const t = members.map((i) => Math.abs(placements[i].t));
  const ms = s.reduce((a, b) => a + b, 0) / n;
  const mt = t.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (s[i] - ms) * (t[i] - mt);
    den += (s[i] - ms) ** 2;
  }
  const slope = den > 1e-9 ? num / den : 0;
  let residualW = 0;
  for (let i = 0; i < n; i++) {
    residualW = Math.max(residualW, Math.abs(t[i] - (mt + slope * (s[i] - ms))));
  }
  return { slope, residualW };
}

/**
 * Every run of band placements that could form a line.
 *
 * PER SIDE. A run alternating between the left and right verges is not a
 * line a driver could steer to, and grouping the two together would
 * invent edges out of ordinary two-sided dressing.
 */
export function edgeRuns(placements: readonly StationedPlacement[], lapW: number): EdgeRun[] {
  const out: EdgeRun[] = [];
  for (const side of [1, -1] as const) {
    const idx = placements
      .map((p, i) => i)
      .filter((i) => inEdgeBand(placements[i]) && Math.sign(placements[i].t || 1) === side)
      .sort((a, b) => placements[a].station - placements[b].station);
    const n = idx.length;
    if (n === 0) continue;

    // WHERE THE SCAN STARTS DECIDES WHETHER A LINE THROUGH THE START LINE
    // IS ONE RUN OR TWO.
    //
    // This scanned the sorted list straight through and discarded `lapW`,
    // so station 0 was treated as a break that the lap does not have: a
    // line of eight objects laid across the start line was read as two
    // runs of four, each of them shorter than `minSpanW` and neither of
    // them a false edge. The rule that exists to catch a line a driver
    // would mistake for the road edge was blind to it at exactly one
    // place on every lap.
    //
    // Same model as `cornersOf`, and for the same reason: find a REAL
    // break first, then scan from there. The gap before the first
    // member is measured the long way round, through the start line.
    const gapBefore = (k: number): number => {
      const prev = placements[idx[(k + n - 1) % n]].station;
      const here = placements[idx[k]].station;
      return k === 0 ? here + lapW - prev : here - prev;
    };
    let start = 0;
    for (let k = 0; k < n; k++) {
      if (gapBefore(k) >= FALSE_EDGE.gapW) {
        start = k;
        break;
      }
    }
    // No break anywhere on this side: every member is within `gapW` of
    // its neighbour all the way round, so the side is ONE ring. Scanning
    // from an arbitrary point is then correct — there is no wrong place
    // to cut a ring that has no gap in it — and the members stay in one
    // run rather than being split at whichever index sorted first.

    // Unwrap: rotating the sorted list puts the low stations last, so
    // they carry a lap to stay ascending. `fitRun` and the span both
    // need a monotonic axis.
    const walk = Array.from({ length: n }, (_, k) => {
      const pos = (start + k) % n;
      const i = idx[pos];
      return { i, s: placements[i].station + (pos < start ? lapW : 0) };
    });

    let run: { i: number; s: number }[] = [];
    const flush = (): void => {
      if (run.length < FALSE_EDGE.minMembers) return;
      const members = run.map((r) => r.i);
      const stations = run.map((r) => r.s);
      const spanW = stations[stations.length - 1] - stations[0];
      const { slope, residualW } = fitRun(placements, members, stations);
      // Reported back in lap coordinates: a run that began before the
      // start line still starts where it starts.
      out.push({ members, startW: stations[0] % lapW, spanW, slope, residualW, side });
    };
    for (const w of walk) {
      if (run.length > 0 && w.s - run[run.length - 1].s < FALSE_EDGE.gapW) run.push(w);
      else {
        flush();
        run = [w];
      }
    }
    flush();
  }
  return out;
}

/** Is this run a false edge — a straight line, long enough, diverging? */
export function isFalseEdge(run: EdgeRun): boolean {
  return (
    run.spanW >= FALSE_EDGE.minSpanW &&
    run.residualW <= FALSE_EDGE.straightW &&
    Math.abs(run.slope) >= FALSE_EDGE.divergence[0] &&
    Math.abs(run.slope) <= FALSE_EDGE.divergence[1]
  );
}

export function falseEdges(placements: readonly StationedPlacement[], lapW: number): EdgeRun[] {
  return edgeRuns(placements, lapW).filter(isFalseEdge);
}

export interface EdgeRepair {
  readonly placements: StationedPlacement[];
  readonly moves: number;
  readonly before: number;
  readonly after: number;
  readonly log: { readonly index: number; readonly before: StationedPlacement }[];
}

/**
 * Break every false edge, by the cheapest move that breaks it.
 *
 * THE RULE ITSELF NAMES THE FIX: diverging ground detail must sit below
 * h = 0.2W or beyond |t| = 2.5W. So one member is dropped out of the
 * band rather than the line being straightened — straightening it would
 * make the line PARALLEL, which is allowed, but it would also move a
 * placement to a lateral its own asset never sat at, and every other rule
 * here draws laterals from the vocabulary.
 *
 * THE MIDDLE MEMBER, because a line is broken most cheaply where it is
 * least anchored: dropping an end shortens the run and may leave the rest
 * still spanning 4W, and the repair then fires again on what is left. The
 * middle splits it into two runs, each too short to read as an edge.
 *
 * IT LOWERS RATHER THAN WIDENS. Below 0.2W is ground detail — a kerb
 * stone, a marking — which is what the rule says such a thing should be.
 * Pushing it past 2.5W would move it two bands out and take it away from
 * the road entirely.
 */
export function repairFalseEdges(
  placements: readonly StationedPlacement[],
  lapW: number,
  maxPasses = 8,
): EdgeRepair {
  const out = [...placements];
  const log: EdgeRepair["log"] = [];
  const before = falseEdges(out, lapW).length;
  let moves = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    const bad = falseEdges(out, lapW);
    if (bad.length === 0) break;
    for (const run of bad) {
      const mid = run.members[Math.floor(run.members.length / 2)];
      const p = out[mid];
      // NO GUARD AGAINST A MEMBER THAT IS ALREADY BELOW THE BAND, because
      // there cannot be one, and the guard that used to stand here said
      // otherwise. Every member of every run came through `inEdgeBand`,
      // which requires `h >= heightW[0]`; `bad` is recomputed at the top
      // of each pass, so a member lowered in pass k is not in the band in
      // pass k+1 and cannot be a member of anything; and runs are disjoint
      // within a side while a placement has only one side, so no placement
      // is the midpoint of two runs in one pass. The branch was therefore
      // unreachable, and its comment described a state this loop cannot
      // produce — which is worse than no comment, because it implies the
      // pass bound is what stops a spin. It is not: every pass strictly
      // lowers at least one member out of the band, so the repair
      // terminates on its own and `maxPasses` is a ceiling, not a brake.
      log.push({ index: mid, before: p });
      out[mid] = { ...p, h: FALSE_EDGE.heightW[0] - 0.05 };
      moves++;
    }
  }
  return { placements: out, moves, before, after: falseEdges(out, lapW).length, log };
}

/**
 * Minimality, by the criterion every repair here is held to: no single
 * move may be put back with the rule still satisfied.
 */
export function edgeRepairIsMinimal(
  repair: EdgeRepair,
  lapW: number,
): { minimal: boolean; removable: number[] } {
  const removable: number[] = [];
  for (const m of repair.log) {
    const trial = [...repair.placements];
    trial[m.index] = m.before;
    if (falseEdges(trial, lapW).length === 0) removable.push(m.index);
  }
  return { minimal: removable.length === 0, removable };
}
