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
 * THE TARGET IS THE DISPERSION CURVE, NOT THE CLUSTER TABLES. The source
 * measurement publishes cluster counts, sizes and spans, and a
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
 * it keeps climbing to 38 and 60 where the source plateaus at 16-24W,
 * because a swell puts its variance at the largest scales. Clumps of
 * FINITE EXTENT, scattered, are the only thing that climbs and then
 * stops.
 */
import { Pcg32, hashCombine } from "pcg-ts";

/** The published window widths. Upstream's, so the two are one statistic. */
export const DISPERSION_WINDOWS_W = [2, 4, 8, 16, 32, 64, 128] as const;

/**
 * The source's MEDIAN index of dispersion at each window — reported
 * against, never aimed at. See {@link DISPERSION_SPREAD}.
 */
export const DISPERSION_TARGET = [1.48, 1.81, 3.01, 5.03, 6.63, 5.98, 5.11] as const;

/**
 * And its p10-p90 across circuits, which is the part that matters.
 *
 * A FIFTEEN-FOLD RANGE at a 32W window. A lap landing on the median is no
 * more expected than one at 2 or at 20, so matching the median row would
 * be fitting to the centre of a distribution that wide — easy to hit by
 * accident and meaningless when hit. What the source constrains is the
 * SHAPE: the curve climbs and then stops from about 16-24W. That claim
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

/** The shape of the two-level process. Fitted to the curve, not measured. */
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
 * Fitted against the published curve. See `tests/roadStations.test.ts`,
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
 * A NOTE ON `clusterSpreadW`, because it looks wrong beside the source.
 *
 * The measurement thresholds clusters at 1.5W and reports a median span
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
 * source has none.
 */
export function makeStations(lapW: number, seed: number, p: StationParams = FITTED): number[] {
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
 * the curve, and the curve is the part with a measurement behind it —
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
function enforceCoverage(sorted: number[], lapW: number): number[] {
  const out = [...sorted];
  const maxPasses = Math.ceil(lapW / COVERAGE.maxGapW) + 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    let worst = -1;
    let worstGap = 0;
    for (let i = 0; i < out.length; i++) {
      const next = i + 1 < out.length ? out[i + 1] : out[0] + lapW;
      const gap = next - out[i];
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
      const prev = out[(i - 1 + out.length) % out.length];
      const next = out[(i + 1) % out.length];
      const near = Math.min(
        Math.abs(out[i] - prev + (i === 0 ? lapW : 0)),
        Math.abs(next - out[i] + (i === out.length - 1 ? lapW : 0)),
      );
      if (near < donorGap) {
        donorGap = near;
        donor = i;
      }
    }
    if (donor < 0) break;

    const mid = (out[worst] + worstGap / 2) % lapW;
    out.splice(donor, 1);
    out.push(mid);
    out.sort((a, b) => a - b);
  }
  return out;
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
  let longest = 0;
  for (let i = 0; i < stations.length; i++) {
    const next = i + 1 < stations.length ? stations[i + 1] : stations[0] + lapW;
    longest = Math.max(longest, next - stations[i]);
  }
  // Share of the lap within 2W of a placement, sampled at 0.25W — fine
  // enough that a 2W radius is twenty samples across.
  const steps = Math.max(1, Math.round(lapW / 0.25));
  let covered = 0;
  let j = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * lapW;
    while (j < stations.length - 1 && stations[j + 1] < s) j++;
    const before = stations[j] <= s ? s - stations[j] : s + lapW - stations[stations.length - 1];
    const afterIdx = stations.findIndex((v) => v >= s);
    const after = afterIdx >= 0 ? stations[afterIdx] - s : stations[0] + lapW - s;
    if (Math.min(before, after) <= 2) covered++;
  }
  return { within2W: covered / steps, longestGapW: longest };
}
