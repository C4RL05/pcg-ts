/**
 * Where along the lap things go — the two-level clustering, and nothing
 * else.
 *
 * WHAT THIS ANSWERS AND WHAT IT DOES NOT. This decides only the STATION
 * of each placement: how many, and how they are spaced along the arc.
 * Which zone a placement lands in, which asset it is, which side of the
 * road it sits on and how high are all downstream and read other rules.
 * Keeping the station process separate is deliberate — it is the one part
 * with a published curve to match, and mixing it with asset choice is how
 * the last attempt ended up with a lap-scale artefact driven by a fitted
 * label.
 *
 * THE TARGET IS THE DISPERSION CURVE, NOT THE CLUSTER TABLES. A
 * catalogue's tables give cluster counts, sizes and spans, and a
 * homogeneous Poisson process at the same density reproduces almost all
 * of them — so placing clumps drawn from those tables counts the
 * clustering twice, once for the clumps placed and again for the merging
 * that thresholding does on its own. Reconstructed that way it overshoots
 * by three times at a 2W window and six at 128W. The tables are for
 * validating against; this is fitted to the curve.
 *
 * TWO LEVELS, AND EXACTLY TWO. One level of clustering flattens the curve
 * to about 1.9 at every window — the small scales carry themselves and
 * nothing carries the middle. A lap-scale envelope is the other failure:
 * it keeps climbing to 38 and 60 where the target plateaus at 16-24W,
 * because a swell puts its variance at the largest scales. Clumps of
 * FINITE EXTENT, scattered, are the only thing that climbs and then
 * stops.
 */
import { Pcg32, hashCombine } from "pcg-ts";

/** The published window widths, so the two curves are one statistic. */
export const DISPERSION_WINDOWS_W = [2, 4, 8, 16, 32, 64, 128] as const;

/**
 * The published MEDIAN index of dispersion at each window — reported
 * against, never aimed at. See {@link DISPERSION_SPREAD}.
 */
export const DISPERSION_TARGET = [1.48, 1.81, 3.01, 5.03, 6.63, 5.98, 5.11] as const;

/**
 * And its p10-p90 spread, which is the part that matters.
 *
 * A FIFTEEN-FOLD RANGE at a 32W window. A lap landing on the median is no
 * more expected than one at 2 or at 20, so matching the median row would
 * be fitting to the centre of a distribution that wide — easy to hit by
 * accident and meaningless when hit. What the curve constrains is the
 * SHAPE: it climbs and then stops from about 16-24W. That claim
 * survives the spread, and so do the two mechanisms it rules out.
 */
export const DISPERSION_SPREAD = [
  [0.7, 3.9],
  [0.9, 5.5],
  [1.1, 8.7],
  [1.4, 17.0],
  [1.7, 26.4],
  [1.1, 26.8],
  [0.5, 20.3],
] as const;

/** D-1's band, in placements per W of lap. */
export const DENSITY = {
  /** What to aim at. */
  target: 0.95,
  /** The dressed circuits' range. Outside this is a finding, not a taste. */
  min: 0.71,
  max: 1.54,
  /**
   * Below this a lap is UNFINISHED rather than quiet — four circuits sit
   * here and the sparsest carries 21 objects over a 362W lap. A validator
   * should say so in those words rather than call it sparse.
   */
  unfinished: 0.6,
} as const;

/** The shape of the two-level process. Fitted to the curve, not the tables. */
export interface StationParams {
  /** Placements per W of lap. */
  readonly density: number;
  /** Super-cluster anchors per W. */
  readonly superRate: number;
  /** Spread of clusters around their super anchor, in W (std dev). */
  readonly superSpreadW: number;
  /** Mean clusters per super anchor. */
  readonly clustersPerSuper: number;
  /** Spread of instances around their cluster anchor, in W (std dev). */
  readonly clusterSpreadW: number;
  /**
   * Share of placements drawn from a flat background rather than from a
   * cluster. Without it the gaps between supers are empty, which reads as
   * stretches nobody dressed and fails the coverage floor.
   */
  readonly background: number;
}

/**
 * Fitted against the published curve. See `tests/racetrackStations.test.ts`,
 * which holds these to it — every one is a knob with no independent
 * justification, so the test is the only thing keeping them honest.
 */
export const FITTED: StationParams = {
  density: 0.95,
  superRate: 0.0493,
  superSpreadW: 14.95,
  clustersPerSuper: 7.92,
  clusterSpreadW: 4.99,
  background: 0.117,
};

/**
 * A NOTE ON `clusterSpreadW`, because it looks wrong beside the tables.
 *
 * The tables threshold clusters at 1.5W and report a median span
 * of 0.55W, and this is five. They are not the same quantity: 1.5W is
 * where a DETECTOR cuts a continuous distribution of gaps, and 4.99 is
 * the standard deviation of the process that produces those gaps. A
 * generative spread of 1.5 would be the same double-count as building
 * C-1's tables directly — it would place the clumps the threshold is
 * about to find again. These six numbers are fitted to the curve and
 * nothing else, and the only defensible reading of any of them is "this
 * is what reproduces the published dispersion".
 */

/** A deterministic uniform stream, seeded the way the library seeds. */
function stream(seed: number, salt: number): () => number {
  const rng = new Pcg32(hashCombine(seed, salt));
  return () => rng.nextF32();
}

/** Box-Muller, from two uniforms of the same stream. */
function gauss(u: () => number): number {
  const a = Math.max(1e-12, u());
  const b = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

/**
 * Stations for one lap, in W, sorted, wrapped into [0, lapW).
 *
 * The COUNT is exact — `density * lapW` rounded — rather than Poisson.
 * A budget is a budget: D-1 is a target a generator hits, and letting the
 * total float adds variance at the lap scale, which is the one place the
 * vocabulary has none.
 */
/**
 * What a generating pass had to REPAIR, reported rather than swallowed.
 *
 * A rule that resolves a conflict has to say how often it fired, because
 * ZERO IS INDISTINGUISHABLE FROM SUCCESS at the assertion level: a repair
 * that never ran and a repair that ran and worked both leave a green
 * test. This is the generalisation of a corridor rule in `zones.ts` that
 * passed every assertion while being unreachable, and it is cheap enough
 * to apply everywhere a repair exists.
 */
export interface StationStats {
  readonly stations: number[];
  /** Placements moved to close a gap longer than D-4 allows. */
  readonly gapRepairs: number;
  /** The longest gap before any repair, in W. */
  readonly worstGapBeforeW: number;
  /**
   * Every move, so a caller can put each one back and re-check D-4.
   *
   * SAME REASONING AS THE Z-3 REPAIR. This repair conserves the count
   * too — it takes a placement from the densest run and puts it in the
   * longest gap — so no statement about where a placement ENDS UP can
   * characterise it. What can: whether any single move is REMOVABLE with
   * the bound still holding. Idempotence is not enough, because a repair
   * that overshot in one pass and then halted would pass it.
   */
  readonly log: { readonly removed: number; readonly added: number }[];
}

export function makeStations(lapW: number, seed: number, p: StationParams = FITTED): number[] {
  return makeStationsDetailed(lapW, seed, p).stations;
}

/** {@link makeStations}, with what it had to repair on the way. */
export function makeStationsDetailed(
  lapW: number,
  seed: number,
  p: StationParams = FITTED,
): StationStats {
  const total = Math.max(1, Math.round(p.density * lapW));
  const wantBackground = Math.round(total * p.background);
  const wantClustered = total - wantBackground;

  const u = stream(seed, 0x5741);
  const out: number[] = [];

  // Level 1: super anchors, uniform along the lap.
  const supers = Math.max(1, Math.round(p.superRate * lapW));
  const superAt: number[] = [];
  for (let i = 0; i < supers; i++) superAt.push(u() * lapW);

  // Level 2: cluster anchors, gaussian about their super.
  const clusterAt: number[] = [];
  for (const s of superAt) {
    // Rounded stochastically so the MEAN is `clustersPerSuper` rather
    // than its floor — at 4.6 a plain round would give every super 5.
    const k = Math.floor(p.clustersPerSuper + u());
    for (let j = 0; j < k; j++) clusterAt.push(s + gauss(u) * p.superSpreadW);
  }
  if (clusterAt.length === 0) clusterAt.push(u() * lapW);

  // Level 3: instances, gaussian about their cluster. Clusters are drawn
  // WITH REPLACEMENT to fill the budget rather than each getting a fixed
  // share: a fixed share makes every cluster the same size, and the size
  // distribution is most of what the curve is made of.
  for (let i = 0; i < wantClustered; i++) {
    const c = clusterAt[Math.floor(u() * clusterAt.length) % clusterAt.length];
    out.push(c + gauss(u) * p.clusterSpreadW);
  }

  // The background. See `background` — this is what keeps the gaps
  // between supers from reading as undressed lap.
  for (let i = 0; i < wantBackground; i++) out.push(u() * lapW);

  for (let i = 0; i < out.length; i++) {
    out[i] = ((out[i] % lapW) + lapW) % lapW;
  }
  out.sort((a, b) => a - b);
  return enforceCoverage(out, lapW);
}

/** The longest gap in a sorted, wrapped station list. */
function longestGap(sorted: readonly number[], lapW: number): number {
  // AN EMPTY LAP IS ONE GAP THE WHOLE WAY ROUND, not a covered one. The
  // loop below returns zero for it, which reads as perfect coverage —
  // unreachable from the station process, whose count is always at least
  // one, but reachable at the placement level the moment a cull drops
  // everything. `coverage()` already answers `lapW` here; this is the
  // same answer given by the other of the two functions D-4 is read from.
  if (sorted.length === 0) return lapW;
  let worst = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + lapW;
    worst = Math.max(worst, next - sorted[i]);
  }
  return worst;
}

/** D-4's limits. A floor to satisfy, not a distribution to match. */
export const COVERAGE = { within2W: 0.85, maxGapW: 25 } as const;

/**
 * Close any gap longer than D-4 allows, by MOVING the most redundant
 * placement into it.
 *
 * WHY A REPAIR AND NOT A TIGHTER FIT. Clustering and a coverage floor
 * pull against each other: the same finite-extent clumps that make the
 * dispersion curve climb and plateau are what leave holes between them.
 * Fitting the process hard enough to never leave a 25W gap would flatten
 * the curve, and the curve is the part with a statistic behind it —
 * D-4 is a stated floor with a threshold, which is exactly the kind of
 * rule a generator should ENFORCE rather than hope for. Fitted to
 * eight laps it failed on one, at 31.7W, which is what hoping looks like.
 *
 * MOVED RATHER THAN ADDED, so D-1's budget stays exact: the donor is the
 * placement whose nearest neighbour is closest, which is the one whose
 * absence changes the picture least. That keeps the count a budget rather
 * than a suggestion, and it takes from where there is most to spare.
 *
 * Bounded by the number of gaps it could ever need to fix, so a
 * pathological input cannot spin here.
 */
function enforceCoverage(sorted: number[], lapW: number): StationStats {
  const r = repairPlacementCoverage(
    sorted.map((station) => ({ station })),
    lapW,
  );
  return {
    stations: r.placements.map((p) => p.station),
    gapRepairs: r.moves,
    worstGapBeforeW: r.worstGapBeforeW,
    log: r.log.map((m) => ({ removed: m.from, added: m.to })),
  };
}

// ---------------------------------------------------------------------------
// D-4 at the placement level: the same repair, after the cull.
// ---------------------------------------------------------------------------

/** Anything that sits at a station along the lap. */
export interface Stationed {
  readonly station: number;
}

/**
 * One move: the donor's station before, and where it went.
 *
 * STATIONS RATHER THAN INDICES, unlike the band-mix and landmark logs.
 * Those two repairs re-draw a placement IN PLACE, so an index identifies
 * the move for as long as the array exists. This one re-sorts after every
 * move, so an index means nothing a pass later — and the pair of stations
 * is what a minimality check needs anyway: put `to` back at `from` and ask
 * whether D-4 still holds.
 */
export interface CoverageMove {
  readonly from: number;
  readonly to: number;
}

/** What a placement-level coverage pass had to do. */
export interface CoverageRepair<T> {
  readonly placements: T[];
  /** Placements moved to close a gap longer than D-4 allows. */
  readonly moves: number;
  /** The longest gap before the pass, in W. */
  readonly worstGapBeforeW: number;
  /**
   * And after it — which is NOT always inside D-4. The pass is bounded,
   * and a lap with fewer than three placements has no donor to take, so
   * an un-closable lap is reported rather than thrown. A caller that
   * wants a gate reads this figure; one that wants a fire count reads
   * `moves`.
   */
  readonly worstGapAfterW: number;
  readonly log: CoverageMove[];
}

export interface CoverageRepairOptions<T> {
  /**
   * Placements that may never be the donor. The corner language pins its
   * markers and rulers to a stated distance before an entry, so moving
   * one to close a gap would satisfy D-4 by breaking L-2 or L-3 — a
   * repair that fixes its own rule by breaking another's is worse than
   * the hole it closed.
   */
  readonly protect?: (p: T) => boolean;
}

/**
 * {@link enforceCoverage}, lifted off bare numbers and onto whatever
 * carries a station — and this is the one that belongs in the pipeline.
 *
 * WHY IT HAS TO RUN LATE. §9's stage 1 enforces D-4 on the stations, and
 * stage 4's sightline cull then MOVES AND DROPS placements. Every gap the
 * cull opens is opened after the only pass that was looking for gaps, so
 * a lap can finish with a 30W hole while the stage-1 figure reads zero
 * repairs. Enforcing coverage on stations is enforcing it on a lap that
 * no longer exists, which is the same mis-sequencing the band mix and the
 * landmark rules were moved after the cull to avoid.
 *
 * MOVED, NOT RE-DRAWN. The donor keeps its asset, its lateral and its
 * height and changes only its station, so the count stays exactly D-1's
 * budget and the band mix sees the same population it would have seen.
 * A repair that drew a fresh asset into the gap would pass a count check
 * and quietly re-roll the vocabulary L-4 is measured on.
 *
 * The donor is the placement whose nearest neighbour along the lap is
 * closest — the one with the most company, so the one whose absence
 * changes the picture least — and never one of the two placements
 * bounding the gap being filled, since taking either widens the hole it
 * is trying to close.
 */
export function repairPlacementCoverage<T extends Stationed>(
  placements: readonly T[],
  lapW: number,
  opts: CoverageRepairOptions<T> = {},
): CoverageRepair<T> {
  const out = [...placements].sort((a, b) => a.station - b.station);
  const at = (i: number): number => out[i].station;
  const stations = (): number[] => out.map((p) => p.station);
  const worstGapBeforeW = longestGap(stations(), lapW);
  const log: CoverageMove[] = [];
  let moves = 0;

  // Bounded by the number of gaps it could ever need to fix, so a
  // pathological input cannot spin here.
  const maxPasses = Math.ceil(lapW / COVERAGE.maxGapW) + 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    let worst = -1;
    let worstGap = 0;
    for (let i = 0; i < out.length; i++) {
      const next = i + 1 < out.length ? at(i + 1) : at(0) + lapW;
      const gap = next - at(i);
      if (gap > worstGap) {
        worstGap = gap;
        worst = i;
      }
    }
    if (worstGap <= COVERAGE.maxGapW || worst < 0 || out.length < 3) break;

    let donor = -1;
    let donorGap = Infinity;
    for (let i = 0; i < out.length; i++) {
      if (i === worst || i === (worst + 1) % out.length) continue;
      if (opts.protect?.(out[i])) continue;
      const prev = at((i - 1 + out.length) % out.length);
      const next = at((i + 1) % out.length);
      const near = Math.min(
        Math.abs(at(i) - prev + (i === 0 ? lapW : 0)),
        Math.abs(next - at(i) + (i === out.length - 1 ? lapW : 0)),
      );
      if (near < donorGap) {
        donorGap = near;
        donor = i;
      }
    }
    // Every candidate protected, or too few placements to have one: the
    // gap stays open and `worstGapAfterW` says so.
    if (donor < 0) break;

    const mid = (at(worst) + worstGap / 2) % lapW;
    log.push({ from: at(donor), to: mid });
    out[donor] = { ...out[donor], station: mid };
    out.sort((a, b) => a.station - b.station);
    moves++;
  }
  return {
    placements: out,
    moves,
    worstGapBeforeW,
    worstGapAfterW: longestGap(stations(), lapW),
    log,
  };
}

/**
 * Is a placement-level coverage repair minimal — could any single move be
 * undone with D-4 still holding?
 *
 * See {@link coverageIsMinimal}, which asks the same question of the
 * station-level pass, and {@link CoverageMove} for why a move is
 * identified by its two stations. Undoing a move means putting the donor
 * back where it came from, which is exactly `to -> from`.
 *
 * O(moves) rather than exponential, and deliberately: the criterion is
 * "no SINGLE move is removable", not "no subset is". That is what
 * separates a repair that stops at the bound from one that carries on
 * past it, and idempotence would separate neither — a pass that closed
 * one gap six times over would halt afterwards and pass it.
 */
export function placementCoverageIsMinimal<T extends Stationed>(
  repair: CoverageRepair<T>,
  lapW: number,
): { minimal: boolean; removable: number } {
  let removable = 0;
  for (const m of repair.log) {
    const trial = repair.placements.map((p) => p.station);
    // ONE occurrence, not every station equal to it: two placements can
    // share a station, and dropping both would test a lap with a
    // placement missing rather than a move undone.
    const i = trial.indexOf(m.to);
    // A later pass moved this one again, so the move is not the thing
    // undoing `to -> from` would undo. Not removable, by inspection.
    if (i < 0) continue;
    trial[i] = m.from;
    trial.sort((a, b) => a - b);
    if (longestGap(trial, lapW) <= COVERAGE.maxGapW) removable++;
  }
  return { minimal: removable === 0, removable };
}

/**
 * Is the coverage repair minimal — could any single move be put back with
 * D-4 still holding?
 *
 * See {@link StationStats.log}. This is the same criterion the band-mix
 * repair is held to, and for the same reason: both conserve the count, so
 * both are characterised by the moves they make rather than by where
 * anything lands.
 */
export function coverageIsMinimal(
  stats: StationStats,
  lapW: number,
): { minimal: boolean; removable: number } {
  let removable = 0;
  for (const m of stats.log) {
    const trial = stats.stations.filter((s) => s !== m.added);
    trial.push(m.removed);
    trial.sort((a, b) => a - b);
    if (longestGap(trial, lapW) <= COVERAGE.maxGapW) removable++;
  }
  return { minimal: removable === 0, removable };
}

/**
 * Index of dispersion — variance-to-mean of the count in a window of
 * `windowW`, swept round the lap.
 *
 * Reads 1.00 at every scale for a Poisson process, above 1 where the
 * process clumps, below where it is regular. Non-overlapping windows,
 * because overlapping ones share placements and correlate their counts,
 * which drags the statistic toward the mean and understates clumping at
 * exactly the wide windows this is trying to read.
 */
export function indexOfDispersion(stations: readonly number[], lapW: number, windowW: number): number {
  const bins = Math.max(2, Math.floor(lapW / windowW));
  const counts = new Float64Array(bins);
  for (const s of stations) counts[Math.min(bins - 1, Math.floor((s / lapW) * bins))]++;
  let mean = 0;
  for (const c of counts) mean += c;
  mean /= bins;
  if (mean <= 0) return 0;
  let varSum = 0;
  for (const c of counts) varSum += (c - mean) * (c - mean);
  return varSum / bins / mean;
}

/** The whole curve, at the published window widths. */
export function dispersionCurve(stations: readonly number[], lapW: number): number[] {
  return DISPERSION_WINDOWS_W.map((w) => indexOfDispersion(stations, lapW, w));
}

/** D-4's two coverage figures: share of lap within 2W, and the longest gap. */
export function coverage(stations: readonly number[], lapW: number): {
  within2W: number;
  longestGapW: number;
} {
  if (stations.length === 0) return { within2W: 0, longestGapW: lapW };
  // The gap loop is `longestGap`'s, so it is `longestGap`. It was
  // written out again here, which is how the two answers to D-4's
  // second figure drift apart.
  const longest = longestGap(stations, lapW);

  // Share of the lap within 2W of a placement, sampled at 0.25W — fine
  // enough that a 2W radius is twenty samples across.
  const n = stations.length;
  const steps = Math.max(1, Math.round(lapW / 0.25));
  let covered = 0;
  // ONE POINTER, NOT A SCAN PER SAMPLE. Both the samples and the
  // stations ascend, so the neighbours either side of a sample only ever
  // move forwards — but a `stations.findIndex` sat inside this loop and
  // re-scanned the whole lap for each of ~1400 samples, next to the
  // two-pointer that was already here and already correct.
  let j = -1;
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * lapW;
    while (j + 1 < n && stations[j + 1] <= s) j++;
    const before = j >= 0 ? s - stations[j] : s + lapW - stations[n - 1];
    const after = j + 1 < n ? stations[j + 1] - s : stations[0] + lapW - s;
    if (Math.min(before, after) <= 2) covered++;
  }
  return { within2W: covered / steps, longestGapW: longest };
}
