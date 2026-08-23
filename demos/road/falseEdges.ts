/**
 * L-5: no false edges.
 *
 * THE RULE. Nothing in Z2-Z3 may present a continuous horizontal line at
 * h = 0.2-0.6W that runs parallel to the track but DIVERGES from it. It
 * reads as the track edge, and a driver steering to it steers off the
 * road. Diverging ground detail must sit below h = 0.2W or beyond
 * |t| = 2.5W.
 *
 * UPSTREAM CALLED THIS ONE INVENTED AND EXPECTED IT TO BE WRONG. It is
 * not, and the evidence is worth stating precisely because it is the only
 * §7 rule with a mechanism confirmed from the source rather than assumed.
 *
 * Scanning the exemplar for the thing the rule describes — runs of three
 * or more placements in the band, gaps under 3W, spanning at least 4W —
 * finds seven runs, of which two span far enough to qualify. Both are
 * genuine LINES: one fits a straight line with a maximum residual of
 * 0.00W over 6.2W, which is a barrier and not a coincidence. And both are
 * PARALLEL, at slopes of 0.001 and 0.015 W per W against the rule's 0.02
 * divergence threshold.
 *
 * So the precondition occurs. The originals do build continuous
 * horizontal lines at exactly this height in exactly this band, and the
 * ones they build do not diverge. L-5 is not describing an imaginary
 * failure.
 *
 * WHAT IT DOES NOT SHOW, and this matters as much. Shuffling which
 * lateral goes with which station inside the band — stations kept, so the
 * run structure is identical — makes 39% of qualifying runs into false
 * edges, with a median |slope| of 0.029, above the threshold. Against
 * that null, zero-of-two is p = 0.37. TWO RUNS CANNOT DEMONSTRATE
 * COMPLIANCE. The residual is the stronger signal (0.10 real against 0.22
 * median null), and it argues these are deliberate straight lines rather
 * than that they were deliberately kept parallel. Upstream has all
 * twenty-two circuits and can settle it; this file's claim is only that
 * the rule is reachable, not that the source obeys it.
 *
 * The generator, by contrast, places laterals independently from each
 * asset's own distribution — which is the null — so it produces false
 * edges at the null rate unless something stops it. That is why the
 * repair exists whatever the originals turn out to do.
 */
import type { StationedPlacement } from "./legibility.js";

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

/** Is this placement in the band where a line would be mistaken for the edge? */
export function inEdgeBand(p: StationedPlacement): boolean {
  const a = Math.abs(p.t);
  return (
    a >= FALSE_EDGE.lateralW[0] &&
    a <= FALSE_EDGE.lateralW[1] &&
    p.h >= FALSE_EDGE.heightW[0] &&
    p.h <= FALSE_EDGE.heightW[1]
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
 */
function fitRun(placements: readonly StationedPlacement[], members: readonly number[]): {
  slope: number;
  residualW: number;
} {
  const n = members.length;
  const s = members.map((i) => placements[i].station);
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

    let run: number[] = [];
    const flush = (): void => {
      if (run.length < FALSE_EDGE.minMembers) return;
      const startW = placements[run[0]].station;
      const spanW = placements[run[run.length - 1]].station - startW;
      const { slope, residualW } = fitRun(placements, run);
      out.push({ members: [...run], startW, spanW, slope, residualW, side });
    };
    for (const i of idx) {
      if (run.length > 0 && placements[i].station - placements[run[run.length - 1]].station < FALSE_EDGE.gapW) {
        run.push(i);
      } else {
        flush();
        run = [i];
      }
    }
    flush();
  }
  void lapW;
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
 * here draws laterals from measurement.
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
      // Already below the band? Then this run cannot be broken this way,
      // and the pass bound stops the repair rather than spinning.
      if (p.h < FALSE_EDGE.heightW[0]) continue;
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
