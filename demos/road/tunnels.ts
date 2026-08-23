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
import type { EnclosureReport } from "./enclosure.js";
import { CORRIDOR, OVERHEAD } from "./zones.js";

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

      // ITS BASE SAT ABOVE THE CORRIDOR, NOT ITS CENTRE.
      //
      // The first version asked whether the measured height MEDIAN
      // cleared 1.2W, and that is the bounds-centre mistake for the third
      // time in this demo. A grass bank 2.6W tall whose centre sat at
      // 1.3W has its base on the ground: it is a landform beside the
      // road, not a roof over it. It qualified, L-6 tiled with it, and
      // two copies of a five-and-a-half-half-width slab ended up parked
      // on the racing line.
      //
      // What makes something cover is that its MATERIAL was above the
      // corridor. A gantry recorded at 2.03W and 0.42W thick has a base
      // at 1.82W and passes; the grass bank has a base at 0.00W and does
      // not.
      if (w.height.median - a.size.tall / 2 < CORRIDOR.ceilingW) return false;

      // And it has to reach the span it is meant to cover.
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
 * gives a wildly variable share — one 42W draw is a third of the budgetW.
 */
export function planEnclosure(
  assets: readonly PlaceableAsset[],
  lapW: number,
  corners: readonly Corner[],
  radiusAt: (stationW: number) => number,
  seed: number,
  /** How much lap to put under cover, in W. */
  budgetW: number,
  /**
   * The lowest quantile a stretch length may be drawn from.
   *
   * L-6 IS USUALLY ASKED FOR THE TAIL, NOT THE TOTAL. Measured by ray
   * cast, the ordinary dressing on an overhead-rich kit already runs a
   * fifth to a quarter of the lap under something — but in fifty-odd
   * SHORT stretches with a heavy-tail share of zero, where the source has
   * about fifteen stretches holding 39% of their covered length in the
   * few longer than 10W. The total is right and the shape is wrong. So
   * what enclosure has to supply is the long stretches the incidental
   * cover never produces, and this is the knob that says so.
   */
  minQuantile = 0,
): { plans: EnclosurePlan[]; attempted: number; rejectedInCorner: number; rejectedOverlap: number } {
  const cover = coverCandidates(assets);
  const plans: EnclosurePlan[] = [];
  if (cover.length === 0) {
    return { plans, attempted: 0, rejectedInCorner: 0, rejectedOverlap: 0 };
  }

  let covered = 0;
  let attempted = 0;
  let rejectedInCorner = 0;
  let rejectedOverlap = 0;

  // Bounded: a run of rejections cannot spin, and a lap that cannot fit
  // its budgetW reports a short share rather than looping.
  const maxTries = 2000;
  for (let k = 0; k < maxTries && covered < budgetW; k++) {
    attempted++;
    const uLen = minQuantile + rand(seed, k, 0x6c01) * (1 - minQuantile);
    // CLAMPED TO WHAT IS LEFT. The budgetW is already capped by L-6's own
    // ceiling, but a single draw from the tail is 10 to 42W and will
    // sail past a budgetW of twelve — and the lap then finishes
    // over-enclosed with nothing able to fix it, because the reduction
    // never touches L-6's own runs. One overshooting draw was taking a
    // lap to 26.3% against a 25% ceiling.
    const lengthW = Math.min(
      Math.max(ENCLOSE.minLengthW, drawStretchLengthW(uLen)),
      Math.max(ENCLOSE.minLengthW, budgetW - covered),
    );
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
      // One more column than the span strictly needs, for the same reason:
    // pieces laid edge to edge across the corridor leave seams that the
    // rays find.
    const columns =
      Math.max(1, Math.ceil((2 * ENCLOSE.coverW) / Math.max(0.2, asset.size.across))) +
      (asset.size.across < 2 * ENCLOSE.coverW ? 1 : 0);
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
  // ONE POSE FOR THE WHOLE RUN. Every recorded instance of an asset has
  // its own box set — the yaw the format never stored — and drawing a
  // fresh one per piece is right for scenery and wrong here. A tunnel is
  // the same segment repeated; varying the shape along it reopens the
  // seams the overlap was added to close, and a 17W covered stretch fell
  // back to 8W the moment poses were drawn per piece.
  const pose = Math.floor(rand(seed, Math.round(plan.startW * 31), 0x7091) * 1024);
  const measured = plan.asset.where?.height.median ?? 2;
  const baseH = Math.max(measured, CORRIDOR.ceilingW + plan.asset.size.tall / 2);
  // ROUNDED UP, SO PIECES OVERLAP RATHER THAN ABUT. Rounding to nearest
  // leaves a gap whenever the run is not a whole number of pieces long,
  // and a gap is not a near-miss: the ray cast needs three of six rays
  // blocked, so one missing piece cuts a covered stretch in two. A
  // planned 15W run was closing 9.6W — under the 10W the rule counts as a
  // long stretch, which is the whole reason enclosure is placed at all.
  const steps = Math.max(1, Math.ceil(plan.lengthW / alongW) + 1);

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
        pose,
      });
    }
  }
  return out;
}

/** Every enclosure placement for a lap. */
export function placeEnclosure(
  assets: readonly PlaceableAsset[],
  lapW: number,
  corners: readonly Corner[],
  radiusAt: (stationW: number) => number,
  seed: number,
  budgetW: number,
  minQuantile = 0,
): { placements: StationedPlacement[]; plans: EnclosurePlan[]; plannedShare: number } {
  const { plans } = planEnclosure(assets, lapW, corners, radiusAt, seed, budgetW, minQuantile);
  const placements: StationedPlacement[] = [];
  for (const p of plans) placements.push(...coverPlacements(p, lapW, seed));
  const plannedShare = plans.reduce((a, p) => a + p.lengthW, 0) / lapW;
  return { placements, plans, plannedShare };
}

/**
 * How much LONG cover to add, given what the lap already has.
 *
 * TWO TARGETS, AND THE FIRST DRAFT COLLAPSED THEM INTO ONE. L-6 asks for
 * a total (10-25% of lap, population median 10.5%) and the measurement
 * behind it carries a shape (39% of covered length in stretches longer
 * than 10W). Solving only for the shape gives
 * `x = (f*total - long)/(1 - f)`, which is correct arithmetic and wrong:
 * on a lap with NO cover it returns zero, because 39% of nothing is
 * nothing. A bare circuit would have got no tunnels at all and the
 * formula would have looked right.
 *
 * So the total target comes first — lift the lap to the population share
 * if it is under, leave it alone if it is already above — and the shape
 * target is then a fraction of THAT rather than of what happens to be
 * there. The ceiling caps both: L-6 says at most a quarter of the lap may
 * be enclosed, and satisfying the shape by breaking the total is not
 * satisfying L-6.
 *
 * Returns zero when there is no room for even one long stretch. A budgetW
 * of half a half-width cannot buy a 10W tunnel, and spending it anyway
 * would overshoot the ceiling by twenty times the budgetW.
 */
export function longCoverBudgetW(
  totalCoveredW: number,
  longCoveredW: number,
  lapW: number,
): number {
  const targetTotalW =
    Math.min(ENCLOSE.ruleShare[1], Math.max(ENCLOSE.sourceShare, totalCoveredW / lapW)) * lapW;
  const targetLongW = ENCLOSE.sourceLongShare * targetTotalW;
  const room = ENCLOSE.ruleShare[1] * lapW - totalCoveredW;
  const budgetW = Math.min(targetLongW - longCoveredW, room);
  return budgetW >= ENCLOSE.longW ? budgetW : 0;
}

/**
 * The quantile at which a drawn stretch first exceeds `longW`.
 *
 * DERIVED FROM THE DISTRIBUTION, not chosen: `drawStretchLengthW` crosses
 * 10W at u = 0.9198, which sits neatly against the source's own figure
 * that 6% of its stretches are that long. Drawing above it gives 12.1W at
 * 0.93, 17.6W at 0.95 and 37.2W at 0.99 — the tunnels, and only the
 * tunnels.
 */
export const LONG_QUANTILE = 0.92;

/** The share of covered length held by stretches longer than `longW`. */
export function longStretchShare(lengths: readonly number[]): number {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return lengths.filter((l) => l > ENCLOSE.longW).reduce((a, b) => a + b, 0) / total;
}

/**
 * Bring an over-enclosed lap back under L-6's ceiling, BY RUN.
 *
 * WHY A REDUCTION EXISTS AT ALL. L-6 reads as a rule about building
 * tunnels, and the top-up above treats it that way. But it is stated as a
 * range — at most a quarter of the lap — and on a kit whose vocabulary is
 * half overhead pieces the ORDINARY dressing sails past that without any
 * enclosure pass running. Adding cannot fix that. The lap needs less
 * cover, not more, and every other threshold in this demo has a repair
 * rather than a hope.
 *
 * THE FIRST VERSION TRIMMED THE MOST CENTRAL PIECES AND WAS WRONG, in a
 * way worth keeping because the reasoning looked sound. Of the enclosure
 * exemplar's 124 covered frames, only 11 are roofed by a SINGLE object;
 * the median frame has three holders and the p90 has six. TILED COVER IS
 * REDUNDANT COVER. So removing an overhead piece costs a placement and
 * opens no sky about nine times in ten — the trim was paying in
 * population for a reduction it was not buying, emptying Z-3's `over`
 * band long before it moved the share, and the two rules oscillated until
 * the round bound stopped them. Six rounds, 73 mix moves, 580ms, NOT
 * CONVERGED.
 *
 * SO IT TAKES OUT A WHOLE STRETCH. Every non-cover overhead piece over
 * the chosen run goes, which actually opens the sky there, and costs the
 * band far less than shaving pieces off runs that stay roofed anyway.
 *
 * THE SHORTEST STRETCH FIRST, which is the same choice as everywhere else
 * here — take what costs least — and it happens to be exactly what L-6
 * wants: the long stretches are the tunnels, and the tail is the part of
 * the distribution the rule is hardest to satisfy on. Trimming from the
 * short end preserves the shape while fixing the total.
 *
 * IT MOVES RATHER THAN DROPS, so D-1's count stays exact, and it never
 * touches L-6's own runs — taking a deliberate tunnel apart to satisfy
 * L-6 would be absurd. What comes out is the cover the dressing produced
 * without meaning to.
 *
 * The caller supplies `reportOf` because measuring means building boxes
 * and casting rays, which this module has no business doing — and because
 * the measurement has to be the SAME one the gate uses. A reduction
 * scored against its own private estimate of enclosure is a reduction
 * that stops when it thinks it is done.
 */
export function reduceEnclosure<T extends StationedPlacement>(
  placements: readonly T[],
  reportOf: (ps: readonly T[]) => {
    share: number;
    stretches: readonly { startW: number; endW: number; lengthW: number }[];
  },
  /**
   * How many overhead pieces must survive.
   *
   * THE FALLBACK, NOT THE MECHANISM — and it has never once fired.
   *
   * Z-3 wants a tenth of the population over the corridor and L-6 wants
   * at most a quarter of the lap roofed. Across the twenty-two circuits
   * those are not independent axes: enclosure correlates with `over`
   * share at r = 0.57, roughly 2.5% + 0.62 x over-share. But at the
   * ranges as written they are compatible — Z-3's 10-21% predicts 9-16%
   * enclosure, comfortably inside L-6 — and the two circuits that satisfy
   * both are ORDINARY ones, ranking 2nd and 4th most typical of the
   * twenty-two on eight axes chosen to exclude enclosure and `over` share
   * so the question could not answer itself. The ruleset describes a real
   * and unremarkable circuit.
   *
   * Measured here: twelve laps across two vocabularies — including the
   * most overhead-rich circuit in the source, whose own `over` share is
   * 32%, half again above Z-3's ceiling — and this floor stopped the trim
   * on none of them. Every lap landed inside L-6's range with runs to
   * spare.
   *
   * So when it DOES fire the diagnosis is specific and it is not the
   * ruleset: THIS VOCABULARY CANNOT MAKE A LAP THIS OPEN. It is kept, and
   * exercised by a constructed case rather than by a real lap, because a
   * path no test can reach is a path that will be wrong when it is first
   * needed.
   */
  keepOverhead: number,
  /**
   * The report for `placements` as handed in, when the caller has just
   * measured it.
   *
   * Re-measuring costs a full rebuild of every box on the lap and a ray
   * cast per frame, and the caller reaches this having usually done
   * exactly that a moment earlier — on rounds where the cover top-up
   * added nothing, the two are the same measurement of the same
   * placements. Optional rather than required: the constructed cases in
   * the suite have no earlier report to pass, and re-measuring is always
   * correct, only wasteful.
   */
  already?: EnclosureReport,
): {
  placements: T[];
  moves: number;
  runsTrimmed: number;
  before: number;
  after: number;
  /**
   * The trim stopped short because Z-3's floor refused a trim that was
   * otherwise available — the band mix genuinely held enclosure back.
   */
  blockedByBandMix: boolean;
  /**
   * The trim stopped short because it had nothing it was allowed to
   * take: either no incidental overhead exists at all, or none of what
   * exists lies inside a stretch that is over the ceiling.
   *
   * A DIFFERENT DIAGNOSIS, and it used to be reported as the one above.
   * A lap whose overhead is all L-6's own deliberate cover has nothing
   * this pass may touch, and saying "held back by Z-3" of it blames a
   * rule that was never consulted. The two answers send a reader to
   * different places: one says the vocabulary cannot make a lap this
   * open, the other says the band mix is binding.
   */
  nothingToTrim: boolean;
} {
  const ceiling = ENCLOSE.ruleShare[1];
  const maxPasses = 6;
  let out = [...placements];
  const first = already ?? reportOf(out);
  const before = first.share;
  let moves = 0;
  let runsTrimmed = 0;
  let after = before;
  let blockedByBandMix = false;
  let nothingToTrim = false;

  const isTrimmable = (p: T): boolean =>
    !p.cover &&
    Math.abs(p.t) < ENCLOSE.coverW &&
    p.h >= CORRIDOR.ceilingW &&
    p.h < OVERHEAD.ceilingW;

  for (let pass = 0; pass < maxPasses && after > ceiling; pass++) {
    const report = pass === 0 ? first : reportOf(out);
    after = report.share;
    if (after <= ceiling) break;

    const overheadCount = out.filter(isTrimmable).length;
    if (overheadCount === 0) {
      nothingToTrim = true;
      break;
    }
    if (overheadCount <= keepOverhead) {
      blockedByBandMix = true;
      break;
    }

    // Shortest stretch first: the long ones are the tunnels.
    const runs = [...report.stretches].sort((a, b) => a.lengthW - b.lengthW);
    let took = 0;
    // PER PASS, NOT STICKY. A run refused for the floor used to set the
    // result flag directly, so a pass that went on to trim a different
    // run successfully still reported itself held back by Z-3. What the
    // flag should say is why the reduction STOPPED.
    let refusedForFloor = false;
    for (const run of runs) {
      const over = out
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => isTrimmable(p) && inRun(p.station, run));
      if (over.length === 0) continue;
      if (overheadCount - over.length < keepOverhead) {
        refusedForFloor = true;
        continue;
      }
      for (const { p, i } of over) {
        out[i] = { ...p, t: Math.sign(p.t || 1) * (ENCLOSE.coverW + p.asset.size.across / 2) };
        moves++;
      }
      runsTrimmed++;
      took = over.length;
      break;
    }
    if (took === 0) {
      // Nothing was trimmed this pass, so this is where it ends — and
      // which of the two reasons applies is exactly whether the floor
      // turned a candidate away or there was never a candidate.
      blockedByBandMix = refusedForFloor;
      nothingToTrim = !refusedForFloor;
      break;
    }
    after = reportOf(out).share;
  }
  return { placements: out, moves, runsTrimmed, before, after, blockedByBandMix, nothingToTrim };
}

/** Is this station inside a stretch, which may wrap the start line? */
function inRun(station: number, run: { startW: number; endW: number }): boolean {
  return run.startW <= run.endW
    ? station >= run.startW && station <= run.endW
    : station >= run.startW || station <= run.endW;
}
