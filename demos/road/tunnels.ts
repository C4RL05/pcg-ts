/**
 * L-6: enclosure, placed.
 *
 * ENCLOSURE IS A PATTERN, NOT AN ASSET, and that is a measurement rather
 * than a modelling preference. On the most enclosed of the twenty-two
 * source circuits the cover is held up by 126 SEPARATE OBJECTS and the
 * largest single one accounts for 5.9% of it. The workhorse is a strip
 * 0.47W wide and 5.45W long placed 24 times. So there is no tunnel model
 * to find and place; there is a run of repeated pieces over a station
 * range, which is what this builds.
 *
 * THE TARGET MOVED, AND THE OLD ONE WAS AN ARTEFACT. Upstream's first
 * figure was 32.3% of a lap enclosed, and it has been withdrawn: three
 * different projections of the same circuit gave 7.9%, 32.3% and 50.3%,
 * and 32.3% came from nearest-frame projection near a hairpin, where one
 * object claimed 78W of lap for 6W of geometry. Cast rays instead and the
 * answer converges — 10.5% at a 6W ceiling, 10.7% at 12W — so the rule is
 * now 10-25% and not 20-40%.
 *
 * The general form is worth keeping: IF A SUMMARY STATISTIC CAN BE
 * COMPUTED BUT THE DISTRIBUTION BEHIND IT CANNOT, the statistic is
 * probably an artefact of the projection. Asking for the distribution is
 * what exposed this one.
 *
 * THE LENGTHS ARE HEAVILY SKEWED and fitting the median alone would build
 * the wrong circuit. Pooled over 326 real stretches: p10 0.9W, median
 * 1.1W, p75 3.1W, p90 6.9W, max 42.4W — and the 6% longer than 10W hold
 * 39% of all the covered length. Mostly one-frame gantries, plus a few
 * real tunnels doing most of the work. A generator matched to the median
 * produces a lap of gantries and no tunnels and scores perfectly.
 */
import type { PlaceableAsset } from "./assets.js";
import { rand } from "./assets.js";
import { type Corner, SEVERITY, beforeEntryW } from "./corners.js";
import type { StationedPlacement } from "./legibility.js";
import { CORRIDOR } from "./zones.js";

export const ENCLOSE = {
  /** L-6's revised range, after the 32.3% figure was withdrawn. */
  ruleShare: [0.1, 0.25],
  /** What the source population actually does, by the ray method. */
  sourceShare: 0.105,
  /**
   * The stretch-length distribution, as (cumulative probability, length
   * in W). The last point is the observed maximum at its own rank in 326
   * samples, which is what keeps the tail from being cut off at p90.
   */
  lengthCdf: [
    [0.1, 0.9],
    [0.5, 1.1],
    [0.75, 3.1],
    [0.9, 6.9],
    [0.997, 42.4],
  ],
  /** Shorter than this is not a stretch, it is a rounding error. */
  minLengthW: 0.5,
  /** A stretch is "long" for the concentration figure at this length. */
  longW: 10,
  /** Share of covered length held by the long stretches, in the source. */
  sourceLongShare: 0.39,
  /** L-6's flare: the mouth opens over this distance. */
  flareW: 2.5,
  /** And rises by this much at the very mouth. */
  flareRiseW: 1.2,
  /** Half-width of the span the cover has to reach across. */
  coverW: 1.5,
  /** Stretches may not START inside a corner tighter than this. */
  noStartTighterThanW: SEVERITY.tightW,
  /** Keep this much clear between stretches, so two do not read as one. */
  separationW: 2,
} as const;

/**
 * A stretch length, from the source's own quantiles.
 *
 * INTERPOLATED IN LOG SPACE above the median, because the tail spans a
 * factor of forty and linear interpolation between p90 and the maximum
 * would make every long stretch the same length. Below the median it is
 * linear, where the range is 0.9 to 1.1 and it makes no difference.
 */
export function drawStretchLengthW(u: number): number {
  const cdf = ENCLOSE.lengthCdf;
  if (u <= cdf[0][0]) return Math.max(ENCLOSE.minLengthW, cdf[0][1]);
  for (let i = 1; i < cdf.length; i++) {
    const [u0, l0] = cdf[i - 1];
    const [u1, l1] = cdf[i];
    if (u <= u1) {
      const f = (u - u0) / (u1 - u0);
      // Log-linear once the lengths start to separate.
      if (l1 / l0 > 1.5) return l0 * Math.exp(f * Math.log(l1 / l0));
      return l0 + f * (l1 - l0);
    }
  }
  return cdf[cdf.length - 1][1];
}

/** One planned run of cover. */
export interface EnclosurePlan {
  readonly startW: number;
  readonly lengthW: number;
  /** The piece this run is tiled from. */
  readonly asset: PlaceableAsset;
  /** How many copies sit side by side across the span. */
  readonly columns: number;
}

/**
 * Which assets can hold up cover.
 *
 * THE TEST IS WHERE ITS INSTANCES SAT, NOT WHAT IT IS CALLED. A piece
 * that the source placed above the corridor ceiling, near enough to the
 * centre to reach over the road, is cover — whatever family it came from.
 * On the enclosure exemplar that is 121 of 235 assets, holding 195 of the
 * circuit's 401 placements.
 *
 * AND THEIR MEASURED HEIGHT IS USABLE, unlike a shell's. These are thin
 * plates and strips, so their bounds centre is on the material rather
 * than in an empty middle — which is exactly the distinction that makes
 * Z-3's `over` band take its height from the band instead.
 */
export function coverCandidates(assets: readonly PlaceableAsset[]): PlaceableAsset[] {
  return assets
    .filter((a) => {
      const w = a.where;
      if (!w) return false;
      if (w.height.median <= 1.2) return false;
      // Its own half-width must bring it inside the span it has to cover.
      return Math.abs(w.lateral.median) - a.size.across / 2 < ENCLOSE.coverW;
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * Where the cover goes.
 *
 * INDEPENDENTLY ROUND THE LAP, not clustered. The source's gap CV is 0.9
 * against a SIMULATED uniform null of 0.9 — indistinguishable. The null
 * had to be simulated: at fifteen stretches the sample CV sits below 1 by
 * construction, and reading it directly would have said the stretches
 * were regular when they are not.
 *
 * Draws until the target share is reached rather than to a fixed count,
 * because the length distribution is skewed enough that a fixed count
 * gives a wildly variable share — one 42W draw is a third of the budget.
 */
export function planEnclosure(
  assets: readonly PlaceableAsset[],
  lapW: number,
  corners: readonly Corner[],
  radiusAt: (stationW: number) => number,
  seed: number,
  targetShare = ENCLOSE.sourceShare,
): { plans: EnclosurePlan[]; attempted: number; rejectedInCorner: number; rejectedOverlap: number } {
  const cover = coverCandidates(assets);
  const plans: EnclosurePlan[] = [];
  if (cover.length === 0) {
    return { plans, attempted: 0, rejectedInCorner: 0, rejectedOverlap: 0 };
  }

  const budget = targetShare * lapW;
  let covered = 0;
  let attempted = 0;
  let rejectedInCorner = 0;
  let rejectedOverlap = 0;

  // Bounded: a run of rejections cannot spin, and a lap that cannot fit
  // its budget reports a short share rather than looping.
  const maxTries = 2000;
  for (let k = 0; k < maxTries && covered < budget; k++) {
    attempted++;
    const lengthW = Math.max(ENCLOSE.minLengthW, drawStretchLengthW(rand(seed, k, 0x6c01)));
    const startW = rand(seed, k, 0x6c02) * lapW;

    // L-6: never START inside a tight corner. Entering cover mid-corner
    // takes the sky away exactly where the driver is reading the exit.
    if (radiusAt(startW) < ENCLOSE.noStartTighterThanW) {
      rejectedInCorner++;
      continue;
    }
    // And not so close before one that the flare is still opening in it.
    const intoCorner = corners.some(
      (c) =>
        c.tightestW < ENCLOSE.noStartTighterThanW &&
        beforeEntryW(startW, c.entryW, lapW) < ENCLOSE.flareW,
    );
    if (intoCorner) {
      rejectedInCorner++;
      continue;
    }

    const clash = plans.some((p) => {
      // Overlap on the loop, compared as arcs rather than as an interval
      // difference: a stretch that starts near the end of the lap wraps,
      // and the wrapped copy has to be tested against both neighbours.
      const a0 = startW;
      const a1 = startW + lengthW + ENCLOSE.separationW;
      const b0 = p.startW;
      const b1 = p.startW + p.lengthW + ENCLOSE.separationW;
      const overlaps = (x0: number, x1: number, y0: number, y1: number): boolean =>
        x0 < y1 && y0 < x1;
      return (
        overlaps(a0, a1, b0, b1) ||
        overlaps(a0 + lapW, a1 + lapW, b0, b1) ||
        overlaps(a0, a1, b0 + lapW, b1 + lapW)
      );
    });
    if (clash) {
      rejectedOverlap++;
      continue;
    }

    // The piece, weighted by how often the source used it.
    let total = 0;
    for (const a of cover) total += Math.max(1, a.instances);
    let u = rand(seed, k, 0x6c03) * total;
    let asset = cover[cover.length - 1];
    for (const a of cover) {
      u -= Math.max(1, a.instances);
      if (u <= 0) {
        asset = a;
        break;
      }
    }
    const columns = Math.max(1, Math.ceil((2 * ENCLOSE.coverW) / Math.max(0.2, asset.size.across)));
    plans.push({ startW: startW % lapW, lengthW, asset, columns });
    covered += lengthW;
  }

  return { plans, attempted, rejectedInCorner, rejectedOverlap };
}

/**
 * Turn one plan into placements: a grid of the same piece, tiled along
 * the run and repeated across the span.
 *
 * THE FLARE IS THE RULE'S, and it is the reason the mouth is not simply
 * the first tile. L-6 asks for entries flared over 2-3W, so the cover
 * lifts toward both ends and the driver sees an opening rather than a
 * wall. It is also what keeps the cone clear at the moment of entry,
 * which is the moment it matters.
 */
export function coverPlacements(plan: EnclosurePlan, lapW: number, seed: number): StationedPlacement[] {
  const out: StationedPlacement[] = [];
  const alongW = Math.max(0.3, plan.asset.size.along);
  const acrossW = Math.max(0.2, plan.asset.size.across);
  // ITS BASE MUST CLEAR THE CORRIDOR, not just its centre. A piece whose
  // measured centre sits at 1.4W and is 0.6W thick reaches down to 1.1W,
  // which is inside the protected volume — Z-1 then stands it off to the
  // corridor edge and the tunnel acquires a hole exactly where the driver
  // looks. Raising it here is what makes cover exempt from Z-1 honest:
  // it is exempt because it is already clear, not because it is special.
  const measured = plan.asset.where?.height.median ?? 2;
  const baseH = Math.max(measured, CORRIDOR.ceilingW + plan.asset.size.tall / 2);
  const steps = Math.max(1, Math.round(plan.lengthW / alongW));

  for (let i = 0; i < steps; i++) {
    const along = (i + 0.5) * (plan.lengthW / steps);
    const station = (plan.startW + along) % lapW;
    // Distance to the nearer mouth, for the flare.
    const toMouth = Math.min(along, plan.lengthW - along);
    const lift =
      toMouth >= ENCLOSE.flareW ? 0 : ENCLOSE.flareRiseW * (1 - toMouth / ENCLOSE.flareW);

    for (let c = 0; c < plan.columns; c++) {
      // Centred on the corridor and spread to cover it edge to edge.
      const t =
        plan.columns === 1
          ? 0
          : -ENCLOSE.coverW + acrossW / 2 + (c * (2 * ENCLOSE.coverW - acrossW)) / (plan.columns - 1);
      out.push({
        asset: plan.asset,
        t,
        h: baseH + lift,
        station,
      });
    }
  }
  void seed;
  return out;
}

/** Every enclosure placement for a lap. */
export function placeEnclosure(
  assets: readonly PlaceableAsset[],
  lapW: number,
  corners: readonly Corner[],
  radiusAt: (stationW: number) => number,
  seed: number,
  targetShare = ENCLOSE.sourceShare,
): { placements: StationedPlacement[]; plans: EnclosurePlan[]; plannedShare: number } {
  const { plans } = planEnclosure(assets, lapW, corners, radiusAt, seed, targetShare);
  const placements: StationedPlacement[] = [];
  for (const p of plans) placements.push(...coverPlacements(p, lapW, seed));
  const plannedShare = plans.reduce((a, p) => a + p.lengthW, 0) / lapW;
  return { placements, plans, plannedShare };
}

/** The share of covered length held by stretches longer than `longW`. */
export function longStretchShare(lengths: readonly number[]): number {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return lengths.filter((l) => l > ENCLOSE.longW).reduce((a, b) => a + b, 0) / total;
}
