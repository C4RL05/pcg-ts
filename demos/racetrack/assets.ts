/**
 * Which asset goes at each station, and where its own distributions put
 * it.
 *
 * NO ARCHETYPE LABEL. The previous attempt sorted assets into a fitted
 * three-way class and gave each class its own distribution, and the class
 * label ended up driving a lap-scale artefact that nothing in the
 * vocabulary supports. So there is no label here: each asset carries its
 * own behaviour — where across the track its instances sit, how high,
 * which side, and how its rate varies with curvature — and that is what
 * places it. An asset is its own archetype.
 *
 * CURVATURE ENTERS HERE AND NOWHERE ELSE. D-6's response is per asset:
 * ONE density along the lap, with each asset's share of it modulated by
 * its own curvature preference. The station process upstream of this
 * knows nothing about curvature, and total density is never modulated —
 * `affinity` is stated against LAP LENGTH, so it already carries the
 * population's own decline in bends, and applying D-6's population curve
 * on top would count it twice.
 *
 * AND THE AFFINITIES ARE NOT RENORMALISED per bucket afterwards. That
 * would divide the effect straight back out — the same error as the
 * affinity denominator, one level up.
 */

import { CORRIDOR, fitsOverhead, resolveCorridor } from "./zones.js";
import { SAME_PLACE_W, SAME_SHARE } from "./tolerance.js";
import { mixDonorPriority, rand } from "./rand.js";

/** The per-asset distributions this module places from. */
export interface AssetWhere {
  readonly lateral: { readonly median: number; readonly p10: number; readonly p90: number };
  readonly height: { readonly median: number; readonly p10: number; readonly p90: number };
  /** Share of this asset's instances on the right of travel. */
  readonly rightOfTravel: number;
  /** Along-lap gap CV for this asset alone. Not applied — see below. */
  readonly gapCv: number;
  /** Rate per curvature bucket, relative to that bucket's share of lap length. */
  readonly affinity: Record<CurvatureBucket, number>;
}

export interface PlaceableAsset {
  readonly id: number;
  readonly name: string;
  readonly shape: string;
  /** This asset's frequency in the vocabulary. */
  readonly instances: number;
  readonly size: { readonly across: number; readonly along: number; readonly tall: number };
  readonly capped?: boolean;
  readonly where?: AssetWhere;
}

export type CurvatureBucket = "straight" | "easy" | "medium" | "tight";

/**
 * The rule set's cuts, in W. Not guessed — an earlier version here used
 * 8/16/30 and the straight edge was well off, which moves a lot of track
 * between buckets for a statistic that is keyed by bucket name.
 */
export function bucketOf(radiusW: number): CurvatureBucket {
  if (radiusW >= 40) return "straight";
  if (radiusW >= 15) return "easy";
  if (radiusW >= 7) return "medium";
  return "tight";
}

/** The one placement stream. Re-exported: see `./rand.js` for why. */
export { rand } from "./rand.js";

/**
 * Draw from a distribution given only its p10, median and p90.
 *
 * A PIECEWISE-LINEAR INVERSE CDF, which is the most the published summary
 * supports. Three points is not much, and inventing a shape between them
 * — a lognormal fitted to the quantiles, say — would put detail in the
 * output that nothing in the vocabulary backs. Below p10 and above p90 it
 * continues the outer segment's slope rather than clamping, so the tails exist
 * without being invented: clamping would pile a tenth of every asset's
 * instances onto exactly two values.
 */
export function drawQuantile(
  q: { median: number; p10: number; p90: number },
  u: number,
): number {
  const { p10, median, p90 } = q;
  if (u <= 0.1) return p10 - (0.1 - u) * ((median - p10) / 0.4);
  if (u <= 0.5) return p10 + ((u - 0.1) / 0.4) * (median - p10);
  if (u <= 0.9) return median + ((u - 0.5) / 0.4) * (p90 - median);
  return p90 + (u - 0.9) * ((p90 - median) / 0.4);
}

/** One placement, before the corridor rule and before the kit's boxes. */
export interface AssetPlacement {
  readonly asset: PlaceableAsset;
  /** Signed offset across the track, positive RIGHT of travel, in W. */
  readonly t: number;
  /** Height in W, on whatever datum `where.height` uses. */
  readonly h: number;
}

/**
 * The weight an asset carries at a station of the given curvature.
 *
 * `instances` is its natural frequency in the vocabulary — an asset
 * carrying twenty is twenty times as likely as one carrying one, which is
 * what "how often does this appear" means. The affinity then modulates
 * that by where the station is.
 *
 * A ONE-OFF STILL GETS A WEIGHT, deliberately: the vocabulary has 135 of
 * its 206 assets at exactly one, and dropping them would throw away two
 * thirds of the vocabulary in exchange for a slightly better frequency
 * match. L-4 wants a landmark in every tenth of the lap and those are
 * where it comes from.
 */
export function weightAt(asset: PlaceableAsset, bucket: CurvatureBucket): number {
  if (!asset.where) return 0;
  const aff = asset.where.affinity[bucket];
  return asset.instances * (Number.isFinite(aff) ? Math.max(0, aff) : 0);
}

/**
 * Choose an asset for one station and place it from its own distributions.
 *
 * The lateral is drawn from the asset's OWN distribution rather than from
 * a band, which is what Z-1 means by "draw |t| from the asset's own
 * distribution" — and it is what finally makes the corridor resolution
 * reachable: 32 of the 206 assets have a lateral p10 inside 1W.
 */
export function placeAsset(
  assets: readonly PlaceableAsset[],
  bucket: CurvatureBucket,
  seed: number,
  index: number,
): AssetPlacement | undefined {
  let total = 0;
  for (const a of assets) total += weightAt(a, bucket);
  if (total <= 0) return undefined;

  let u = rand(seed, index, 0x11) * total;
  let chosen = assets[0];
  for (const a of assets) {
    u -= weightAt(a, bucket);
    if (u <= 0) {
      chosen = a;
      break;
    }
  }
  const w = chosen.where;
  if (!w) return undefined;

  const t = drawQuantile(w.lateral, rand(seed, index, 0x23));
  const h = drawQuantile(w.height, rand(seed, index, 0x37));
  // The asset's own side lean, not an even coin: a barrier that only ever
  // faced the track keeps facing it. Assets with no lean sit at 0.5 and
  // this is a fair flip for them.
  const right = rand(seed, index, 0x41) < w.rightOfTravel;
  return { asset: chosen, t: right ? Math.abs(t) : -Math.abs(t), h };
}

export type Band = "over" | "verge" | "near" | "mid" | "far" | "distant";

/**
 * Z-3's shares — the POOLED rule, and the per-lap spread beside it.
 *
 * The rule is pooled over every object in the vocabulary, and a single lap
 * sits outside it on some band as a matter of course: the per-lap p10-p90
 * is roughly twice as wide. So Z-3 is a target for a GENERATED lap, not a
 * description every lap satisfies, and one lap missing it is not evidence
 * against it.
 *
 * A generated lap is scored against `rule`. A single lap's own wander is
 * judged against `spread`, and comparing one to the other is how a good
 * lap gets mistaken for a bad generator.
 */
export const Z3 = {
  over: { rule: [0.1, 0.21], spread: [0.06, 0.32], median: 0.13 },
  verge: { rule: [0.04, 0.12], spread: [0.01, 0.17], median: 0.06 },
  near: { rule: [0.23, 0.35], spread: [0.16, 0.39], median: 0.27 },
  mid: { rule: [0.28, 0.4], spread: [0.19, 0.45], median: 0.34 },
  far: { rule: [0.07, 0.19], spread: [0.03, 0.21], median: 0.08 },
  distant: { rule: [0, 0.03], spread: [0, 0.01], median: 0 },
} as const satisfies Record<Band, { rule: readonly [number, number] | number[]; spread: number[] | readonly [number, number]; median: number }>;

/**
 * Which band a placement falls in.
 *
 * THE DATUM IS A PARAMETER BECAUSE IT CHANGES THE ANSWER, and Z-3 does
 * not state which one it means. Every published figure is on the
 * BOUNDS CENTRE — §13's "object centres stand in for placements" — so a
 * gantry over the track is logged at h = 3.19W with its legs on the
 * ground, and `centre` is the only datum that can be compared against
 * those figures.
 *
 * `base` is the physically meaningful one and gives a different answer:
 * on one lap it moved `over` from 9.5% to 12.7% and `verge` from 9.0%
 * to 5.9%. It is not more correct, it is a different statistic, and
 * quoting a base-banded figure against a centre-banded rule is a
 * comparison of two things.
 */
export function bandOfPlacement(
  t: number,
  centreH: number,
  tallW: number,
  datum: "centre" | "base" = "centre",
): Band {
  const a = Math.abs(t);
  const h = datum === "base" ? centreH - tallW / 2 : centreH;

  // A VALUE ON A BOUNDARY BELONGS TO THE OUTER BAND, AND IT HAS TO STAY
  // THERE THROUGH AN f32 ROUND TRIP.
  //
  // These boundaries are not approached, they are LANDED ON. Z-1 stands
  // large art off at exactly `1 + across/2`, which for a piece exactly
  // one half-width wide is exactly 1.5 — the verge ceiling — and two of
  // the four seeds measured here put placements there to the last bit.
  // The mix raises an `over` replacement to exactly `1.2 + tall/2`, whose
  // base is meant to be exactly the corridor ceiling.
  //
  // AND ON THE HEIGHT AXIS f64 ALREADY LOSES THAT, WHICH IS THE STRONGER
  // REASON FOR THE TOLERANCE RATHER THAN AN ARGUMENT AGAINST IT. Under
  // the `base` datum this function recovers the base as `h - tall/2`
  // after the mix set `h = 1.2 + tall/2`, and that round trip does not
  // return 1.2: over the vegetation kit's 229 assets it misses for 96 of
  // them — 41 landing at 1.2000000000000002 and 55 at 1.1999999999999997.
  // A strict `h > CORRIDOR.ceilingW` therefore called 41 of them `over`
  // and 55 of them `verge`, splitting ONE logical situation — a piece
  // whose base is at the ceiling — two ways on nothing but which
  // direction the last bit rounded. That is not a boundary being read
  // correctly; it is a coin toss with a stable seed.
  //
  // With the tolerance all 96 read the same, and they read `verge`, which
  // is what the rule says: `over` is material ABOVE the ceiling, and a
  // base sitting on it is not above it. In f32 the same round trip is
  // ~1e-7 wide instead of ~1e-16, so without this the toss is between
  // cooks rather than merely between assets — and Z-3's shares, the
  // repair that reads them and the count of moves it makes all follow.
  //
  // So each edge is pulled IN by `SAME_PLACE_W` and each height test
  // pushed OUT by it: anything within a ten-thousandth of a half-width of
  // a boundary is treated as being on it, which is the f64 answer. It
  // reclassifies genuine values inside that sliver too. Measured across
  // four seeds of the dressed lap, the nearest placement to any boundary
  // that was not exactly on one sat 8.9e-4W away — an order of magnitude
  // clear of it — and among the vocabulary's own placements the nearest is
  // 8e-4W.
  const inside = (limit: number): boolean => a < limit - SAME_PLACE_W;

  // ANCHORED INSIDE THE CORRIDOR IS `over`, WHATEVER ITS HEIGHT. Z2's
  // verge is 1.0-1.5W and Z1 holds nothing, so a placement recorded at
  // |t| < 1W is not verge art that strayed — it is something SPANNING the
  // corridor, logged at its centre. §13: "object centres stand in for
  // placements ... which is why 8% of terrain reads as over the track".
  //
  // This was `a < 1.5` for both, which counted the corridor as verge and
  // put seven points of a 362-placement lap in the wrong band —
  // `over` 3% against a true 10%, `verge` 13% against 6%. It was caught
  // by a second pass over the same lap disagreeing, not by anything here.
  if (inside(CORRIDOR.halfWidthW)) return "over";
  if (
    inside(1.5) &&
    (h > CORRIDOR.ceilingW + SAME_PLACE_W || h < CORRIDOR.floorW - SAME_PLACE_W)
  ) {
    return "over";
  }
  if (inside(1.5)) return "verge";
  if (inside(2.5)) return "near";
  if (inside(5)) return "mid";
  if (inside(13)) return "far";
  return "distant";
}

/**
 * The |t| range an asset's own instances actually reach, from the two
 * quantiles the format publishes.
 *
 * A MEDIAN IS NOT A RANGE, AND CONFUSING THE TWO IS WHAT MADE THE BAND MIX
 * SPIN. Eligibility for a band used to be "this asset's median lateral
 * falls in it", and the placement's lateral was then drawn from the whole
 * distribution — which is wide, so the draw landed in a different band as
 * often as not. Overlap is the honest test: an asset belongs to a band if
 * its own instances REACH there, which is what makes placing one there a
 * statement about that asset rather than about an average.
 *
 * A distribution straddling the centreline reaches 0, because |t| does.
 */
export function lateralReach(w: AssetWhere): readonly [number, number] {
  const { p10, p90 } = w.lateral;
  const a = Math.abs(p10);
  const b = Math.abs(p90);
  return [p10 <= 0 && p90 >= 0 ? 0 : Math.min(a, b), Math.max(a, b)];
}

/** The |t| span each band occupies, for choosing an asset that lands in it. */
export const BAND_T: Record<Band, readonly [number, number]> = {
  over: [0, 1.5],
  // FROM 1W, NOT FROM 0. The verge is 1-1.5W, and drawing from 0 let the
  // repair pick an asset whose own lateral sits at 0.4W, place it there,
  // and land in `over` instead — a move that costs a pass and does not
  // fill the band it was made for.
  verge: [1, 1.5],
  near: [1.5, 2.5],
  mid: [2.5, 5],
  far: [5, 13],
  distant: [13, 1e9],
};

/** One re-draw, kept so the repair can be checked for MINIMALITY. */
export interface MixMove<T extends AssetPlacement = AssetPlacement> {
  readonly index: number;
  readonly before: T | undefined;
}

/** What a Z-3 repair had to do. Reported, for the usual reason. */
export interface MixRepair<T extends AssetPlacement = AssetPlacement> {
  readonly placements: (T | undefined)[];
  /** Placements re-drawn to bring a band inside Z-3. */
  readonly moves: number;
  /** Bands that were outside before, with the share they held. */
  readonly wasOutside: { band: Band; share: number; edge: number }[];
  /**
   * Every move, so a caller can put each one back and re-check the
   * bounds.
   *
   * MINIMALITY IS THE CRITERION, not idempotence. A repair that jumps
   * every out-of-range band to the CENTRE of its range in one pass and
   * then halts IS idempotent — a second pass makes no moves — and it is
   * exactly the behaviour "to the nearest edge" exists to forbid. What
   * distinguishes them is whether any single move could be removed with
   * every bound still holding: an overshoot's surplus moves are
   * removable, and an edge-repair's are not.
   *
   * It is also the only checkable form, because the count is conserved:
   * every move takes from one band and gives to another, so no band's
   * final share is attributable to its own repair and no assertion about
   * where things END UP can be right. Three of those were tried here
   * before this one.
   */
  readonly log: MixMove<T>[];
  /**
   * The datum and the exclusion this repair ran under, carried on the
   * result so the minimality gate cannot be handed a different pair.
   *
   * `mixInsideRule`'s own doc says the exclusion "must match whatever
   * the repair excluded" — and `repairIsMinimal` then called it with the
   * default, which excludes nothing, while production excludes L-6's
   * cover. The gate was scoring a population the repair had never tried
   * to balance, so the only configuration it could check was the one
   * nothing runs. A doc comment is the wrong place to enforce an
   * invariant that the type can carry.
   */
  readonly datum: "centre" | "base";
  readonly exclude: (p: T) => boolean;
}

/** Are all six bands inside Z-3's rule for this set of placements? */
export function mixInsideRule<T extends AssetPlacement>(
  placements: readonly (T | undefined)[],
  datum: "centre" | "base" = "centre",
  /** Must match whatever the repair excluded, or the gate scores a
   *  different population from the one the repair balanced. */
  exclude: (p: T) => boolean = () => false,
): boolean {
  const live = placements.filter((p): p is T => p !== undefined && !exclude(p));
  if (live.length === 0) return true;
  const c = Object.fromEntries((Object.keys(Z3) as Band[]).map((b) => [b, 0])) as Record<
    Band,
    number
  >;
  for (const p of live) c[bandOfPlacement(p.t, p.h, p.asset.size.tall, datum)]++;
  for (const b of Object.keys(Z3) as Band[]) {
    const share = c[b] / live.length;
    const [lo, hi] = Z3[b].rule;
    // THE SLACK HAS TO BE COARSER THAN THE ARITHMETIC IT FORGIVES. A
    // share is a ratio of whole numbers and Z-3's bounds are written as
    // two decimal places, so a band landing EXACTLY on its bound is the
    // ordinary case (36 of 360 is exactly the `over` floor) and this
    // epsilon is the only thing that keeps it inside. In f32 the spacing
    // at 0.1 is 7.5e-9 — the 1e-9 that was here is finer than the
    // quantity it is comparing, so a share that lands on a bound reads
    // as outside it, and the repair chases a band that is already right.
    // `SAME_SHARE` is a third of a thousandth of one placement on a
    // 360-placement lap: it cannot move the verdict on a ratio that was
    // not already sitting on the bound.
    if (share < lo - SAME_SHARE || share > hi + SAME_SHARE) return false;
  }
  return true;
}

/**
 * Bring a lap's band mix inside Z-3 — TO THE NEAREST EDGE, never to the
 * centre.
 *
 * WHY Z-3 IS REPAIRED AT ALL, given that a catalogue's own placements can
 * miss it. Because Z-3 does not describe them. A catalogue can run `over`
 * anywhere in 4-40% and `near` in 0-56%, and a gate at that full range is
 * vacuous. Z-3 is deliberately NARROWER — the same standing as Z-1's
 * corridor, a decision to be better than what a catalogue settles for —
 * so a lap outside it reads wrong even though a catalogued placement
 * might sit there.
 *
 * AND WHY THE NEAREST EDGE. Driving every lap to the centre of each band
 * would make generated laps markedly more uniform than the catalogue's
 * own placements, which vary by a factor of five on `over`. That is the
 * density-envelope error in different clothes: imposing at the LAP level
 * an aggregate the population reaches through variation BETWEEN laps.
 * Eight laps spread across a band is correct; eight laps all landing on
 * 15% would be worse art while scoring better against the rule.
 *
 * So: lift a band to its floor, trim it to its ceiling, stop. Enforce the
 * bound, preserve the spread inside it.
 */
/**
 * How many draws the mix may take before it gives a donor up.
 *
 * ONE DRAW IS NOT ENOUGH AND UNLIMITED DRAWS ARE NOT A REPAIR, and what
 * makes one draw insufficient is Z-1 rather than the draw itself.
 * `settleIntoBand` clamps the drawn lateral into the band, so the lateral
 * lands where it was asked to — and then applies the corridor rule, which
 * can stand a WIDE piece off far enough to leave the band again. Nothing
 * about the asset says in advance whether it is narrow enough to survive
 * that, so the only way to find a piece that fits is to draw another one.
 *
 * Retrying without a bound would be a search whose cost is a property of
 * the vocabulary rather than of the rule: a band whose every candidate is
 * too wide would be drawn from forever.
 *
 * Eight is enough that a pool holding any piece that fits finds one, and
 * small enough that a pool holding none is abandoned and the donor marked.
 * It is a search resolution and not a quantity anything states — but it is
 * load-bearing, not a margin: at one attempt the enclosed kit's mix test
 * fails outright, which is the check that says so.
 */
const MIX_DRAW_ATTEMPTS = 8;

/**
 * THE STATION IS NOW PART OF THE INPUT TYPE, AND IT USED TO BE OPTIONAL.
 * This repair took a bare `AssetPlacement` while it chose its donor by
 * array position; it chooses by `mixDonorPriority(station)` now, so a
 * placement with no station has no priority and there is no honest default
 * for one — falling back to the index would silently restore the
 * contiguous-stretch behaviour this change exists to remove, in exactly
 * the callers that forgot. The constraint is written as an intersection
 * rather than by importing `StationedPlacement`, which lives in
 * `legibility.ts` and imports this module.
 */
export function repairBandMix<T extends AssetPlacement & { readonly station: number }>(
  placements: readonly (T | undefined)[],
  assets: readonly PlaceableAsset[],
  seed: number,
  datum: "centre" | "base" = "centre",
  /**
   * Asset ids the corner language reserved. §7 outranks §3 — a marker
   * moved to balance a band is a corner that no longer announces itself,
   * and the band mix has 200 other placements to work with.
   */
  protect: ReadonlySet<number> = new Set(),
  /**
   * Placements outside the mix altogether — neither counted in a band's
   * share nor available as a donor.
   *
   * L-6's cover uses this. Its pieces are all `over` by geometry and a
   * lap can carry forty of them, which would take the band from a tenth
   * to a quarter of the population and make Z-3 unsatisfiable on any lap
   * that has a tunnel. They are structure rather than dressing, and the
   * share Z-3 states is a statement about dressing.
   */
  exclude: (p: T) => boolean = () => false,
  /**
   * WHICH ELIGIBLE MEMBER OF AN OVER-FULL BAND LEAVES FIRST, lowest key
   * first. The default is the rule; the parameter exists so the gate that
   * checks the rule can be shown to FAIL.
   *
   * `donor spread` in `tests/racetrackBandMix.test.ts` asserts that a lap's
   * conversions touch most tenths of the circuit. An assertion no input
   * breaks is not an instrument, and the input that breaks this one is the
   * order this repair used until 2026-08-28 — the station RAW, ascending,
   * which is what the array scan it replaced amounted to. So the control
   * passes `(p) => p.station` here and the gate reports both numbers side
   * by side.
   *
   * IT IS NOT A KNOB. Every production caller takes the default, and the
   * default is the one order `writeBandMix` can also spell — changing it
   * here alone would put the reference and the graph on different rules,
   * which is the divergence the decision suite exists to catch.
   */
  priorityOf: (p: T) => number = (p) => mixDonorPriority(p.station),
): MixRepair<T> {
  const out = [...placements];
  const live = (): { i: number; band: Band }[] =>
    out.flatMap((p, i) =>
      p && !exclude(p) ? [{ i, band: bandOfPlacement(p.t, p.h, p.asset.size.tall, datum) }] : [],
    );

  const n = live().length;
  if (n === 0) return { placements: out, moves: 0, wasOutside: [], log: [], datum, exclude };

  const shares = (): Record<Band, number> => {
    const c = Object.fromEntries(
      (Object.keys(Z3) as Band[]).map((b) => [b, 0]),
    ) as Record<Band, number>;
    for (const { band } of live()) c[band]++;
    for (const b of Object.keys(c) as Band[]) c[b] /= n;
    return c;
  };

  /**
   * A freshly drawn placement, adjusted so that it does not immediately
   * owe another rule a repair.
   *
   * IT RUNS BEFORE THE BAND IS CHECKED, WHICH IS THE WHOLE REASON IT IS A
   * FUNCTION. Both adjustments below MOVE the placement, so the band it
   * ends up in is not the band it was drawn into — checking the raw draw
   * would accept pieces that Z-1 is about to relocate out of the band, and
   * reject pieces that Z-1 is about to relocate into it.
   */
  const settleIntoBand = (drawn: AssetPlacement, dst: Band): AssetPlacement => {
    const tall = drawn.asset.size.tall;

    // THE BAND DECIDES THE LATERAL, WITHIN WHAT THE ASSET REACHES.
    //
    // The draw comes from the asset's whole distribution and the band is a
    // slice of it, so most draws miss — that is arithmetic, not bad luck,
    // and retrying it is a lottery rather than a repair. What the rule
    // wants is a placement of THIS asset in THAT band, and the asset was
    // chosen precisely because its own instances reach there. So the drawn
    // lateral is clamped into the intersection of the band and the asset's
    // own reach, which keeps every placement inside the range the
    // vocabulary gives it.
    //
    // This is the same move the `over` branch below has always made with
    // the height, for the same reason: the band is what is being repaired,
    // so the band supplies the coordinate. What it deliberately is NOT is
    // sliding the EXISTING placement sideways — that would put an asset
    // where its instances never sat, which is the thing the surrounding
    // comment refuses and still refuses.
    // `where` is present by construction: the pool filter refuses an asset
    // without one, so there is no band an asset with no distributions could
    // have been drawn for.
    const reach = lateralReach(drawn.asset.where as AssetWhere);
    const [blo, bhi] = BAND_T[dst];
    // The top of a band belongs to the band ABOVE it (`bandOfPlacement`
    // puts a value on a boundary in the outer band, and says why), so the
    // ceiling is approached and never touched.
    const clampLo = Math.max(blo, reach[0]);
    const clampHi = Math.min(bhi - 2 * SAME_PLACE_W, reach[1]);
    if (clampHi >= clampLo) {
      const sign = drawn.t < 0 ? -1 : 1;
      const want = Math.min(Math.max(Math.abs(drawn.t), clampLo), clampHi);
      drawn = { ...drawn, t: sign * want };
    }
    // AN `over` PLACEMENT SPANS THE CORRIDOR; IT DOES NOT SIT IN IT.
    // The band is |t| < 1W — which is the corridor — so filling it from
    // an asset's own height puts an object on the racing line at
    // about knee height. Z-1 then either raises it (fine) or stands it off
    // to the corridor edge, which takes it OUT of this band, so the mix
    // refills it and the two rules oscillate: measured at 147 mix moves
    // against 95 corridor fixes over six rounds, never settling, finishing
    // with eight objects in the middle of the road.
    //
    // So the height comes from the BAND here rather than from the asset.
    if (dst === "over") return { ...drawn, h: CORRIDOR.ceilingW + tall / 2 };

    // AND EVERY OTHER BAND GETS Z-1 APPLIED AT THE POINT OF DRAWING.
    //
    // A replacement's lateral comes from its asset's own distribution,
    // which reaches inside 1W for a good part of the vocabulary — so the
    // mix emits corridor violations, Z-1 relocates them on the next round,
    // relocating changes their band, and the mix rebalances. Neither
    // repair is wrong and the pair never settles: measured at 56 mix moves
    // and 23 corridor fixes over twelve rounds on a lap where every rule
    // was already satisfied by round two.
    //
    // A repair must not emit something another repair has to undo.
    const baseH = drawn.h - tall / 2;
    const fixed = resolveCorridor(drawn.t, baseH, drawn.asset.size.across, tall);
    if (fixed.t === drawn.t && fixed.baseH === baseH) return drawn;
    return { ...drawn, t: fixed.t, h: fixed.baseH + tall / 2 };
  };

  const before = shares();
  const log: MixMove<T>[] = [];
  const wasOutside: MixRepair["wasOutside"] = [];
  for (const b of Object.keys(Z3) as Band[]) {
    const [lo, hi] = Z3[b].rule;
    if (before[b] < lo) wasOutside.push({ band: b, share: before[b], edge: lo });
    else if (before[b] > hi) wasOutside.push({ band: b, share: before[b], edge: hi });
  }

  let moves = 0;
  // DONORS THIS REPAIR HAS ALREADY FAILED TO REFILL, keyed by donor and
  // destination band. It is what turns "this placement cannot become an
  // `over` piece" into progress rather than into another identical pass:
  // the scan for a donor is a minimum over a FIXED per-placement key, so
  // without it the same lowest-priority member of the band is chosen every
  // time and the loop spends the whole population budget re-deciding the
  // same thing. (It used to be a linear `find` and the sentence read
  // "first-in-band"; the order changed, the trap did not — a deterministic
  // scan over an unchanged list returns the same answer however it is
  // ordered.)
  const failed = new Set<string>();
  // Bounded by the population: each pass either moves one placement or
  // strikes one (donor, band) pair off, and both are finite.
  for (let pass = 0; pass < n; pass++) {
    const s = shares();
    let from: Band | undefined;
    let to: Band | undefined;
    let over = 0;
    let under = 0;
    for (const b of Object.keys(Z3) as Band[]) {
      const [lo, hi] = Z3[b].rule;
      if (s[b] - hi > over) {
        over = s[b] - hi;
        from = b;
      }
      if (lo - s[b] > under) {
        under = lo - s[b];
        to = b;
      }
    }
    // STOPS AT THE EDGE. Nothing over its ceiling and nothing under its
    // floor means done, however far any band sits from its centre.
    if (from === undefined && to === undefined) break;

    // Prefer moving from an over-full band into an under-full one. With
    // only one of the two, take from (or give to) whichever band has most
    // room without pushing it out of its own range.
    const pick = (want: Band | undefined, other: Band | undefined): Band | undefined => {
      if (want) return want;
      let best: Band | undefined;
      let slack = 0;
      for (const b of Object.keys(Z3) as Band[]) {
        if (b === other) continue;
        const [lo, hi] = Z3[b].rule;
        const room = other === from ? hi - s[b] : s[b] - lo;
        if (room > slack) {
          slack = room;
          best = b;
        }
      }
      return best;
    };
    const src = pick(from, to);
    const dst = pick(to, from);
    if (!src || !dst || src === dst) break;

    // A DONOR THIS REPAIR HAS NOT ALREADY FAILED TO REPLACE. Keyed by the
    // band it was being drawn INTO, because a donor that cannot be turned
    // into an `over` piece may still make a perfectly good `verge` one.
    // Without this the scan below returns the same placement every pass,
    // which is half of why this repair used to spin.
    //
    // LOWEST `mixDonorPriority` FIRST, AND IT USED TO BE A LINEAR `find`.
    // That took the first eligible member in ARRAY order, and this list is
    // held in station order, so "the first k" was a contiguous stretch of
    // track: measured over seeds 1-6, on the lap as the mix first sees it,
    // every conversion landed in the first two tenths on every seed,
    // and the frames showed it as a continuous canopy of overhead
    // furniture over the start of the circuit. A hashed order puts the
    // conversions in seven to ten tenths and changes nothing else — the
    // pass structure above decides how MANY placements move and which
    // bands they move between, and this line only decides which of the
    // eligible members that number is drawn from. Band shares, placement
    // count and station set all came out identical on all six seeds.
    //
    // THE SAME ORDER THE GRAPH USES, WHICH IS THE POINT OF THE HASH BEING
    // THE LIBRARY'S. `writeBandMix` hands `quotaRebalance` a `priority` of
    // `randomFrom(attribute(PLACEMENT.station), MIX_DONOR_KEY)`, and
    // `quotaRebalance` takes its donors lowest-priority-first. Same key,
    // same input, same order — so the decision suite still compares the
    // two donor for donor rather than shrugging at a divergence.
    //
    // AND IT IS STILL THE STATION, hashed rather than raw. Keying on the
    // ARRAY INDEX would spread the donors equally well and would make this
    // repair's answer depend on the order of the list it was handed, which
    // is a property the graph is measured on and this reference is the
    // statement of. See {@link mixDonorPriority}.
    let donor: { i: number; band: Band } | undefined;
    let donorKey = Infinity;
    for (const x of live()) {
      if (x.band !== src) continue;
      if (protect.has(out[x.i]?.asset.id ?? -1)) continue;
      if (failed.has(`${x.i}|${dst}`)) continue;
      const key = priorityOf(out[x.i] as T);
      // STRICTLY LESS THAN, so a tie keeps the lower index. Two placements
      // at one station is the only way to tie and this demo's laps do not
      // carry a pair; `mixDonorPriority` says so at more length, including
      // what the graph would do instead.
      if (key < donorKey) {
        donorKey = key;
        donor = x;
      }
    }
    if (!donor) break;

    // Re-place the station with an asset whose OWN distributions put it in
    // the band that needs filling — rather than moving the existing
    // placement's lateral, which would break the link between an asset
    // and where its instances actually reach.
    const [lo, hi] = BAND_T[dst];
    const pool = assets.filter((a) => {
      if (protect.has(a.id)) return false;
      // Z7 is FURNITURE, not enclosure. Anything too tall to hang under
      // the overhead ceiling is a shell, and a shell placed here becomes
      // a roof over the whole band. See `fitsOverhead`.
      if (dst === "over" && !fitsOverhead(a.size.tall)) return false;
      if (!a.where) return false;
      // OVERLAP, NOT THE MEDIAN — see `lateralReach`. On the enclosure kit
      // the median test left the `verge` pool holding assets that almost
      // never drew into the verge, which is how a repair with a non-empty
      // pool still failed every placement it attempted.
      const [rlo, rhi] = lateralReach(a.where);
      return rhi >= lo && rlo < hi;
    });
    if (pool.length === 0) break;

    // DRAW, SETTLE, AND CHECK WHERE IT ACTUALLY LANDED — the loop that
    // stops this repair claiming moves it did not make.
    //
    // The bug it closes: eligibility used to be "this asset's MEDIAN
    // lateral falls in `dst`" while the placement's lateral was drawn from
    // the asset's whole distribution, which is wide. The draw therefore
    // landed in a different band as often as not, and was committed and
    // counted regardless. On a kit where the misses outnumber the hits the
    // shares never changed, so the same `src` and `dst` were chosen again
    // and the same donor found again: `moves === n` every round, forever,
    // measured on the enclosure kit at twelve rounds and `converged:
    // false` on every seed.
    //
    // Two things fixed it and the check is the second. The pool is now
    // chosen by OVERLAP (see `lateralReach`) and `settleIntoBand` places
    // within the band, so the lateral lands where it was asked to. What
    // can still move it is Z-1, which stands a wide piece off the corridor
    // and may push it out of the band again — so the result is verified
    // rather than assumed, and only a placement that IS in `dst` is
    // committed. See `MIX_DRAW_ATTEMPTS` for why more than one draw.
    let replacement: AssetPlacement | undefined;
    for (let attempt = 0; attempt < MIX_DRAW_ATTEMPTS; attempt++) {
      const drawn = placeAsset(
        pool,
        "straight",
        seed,
        donor.i + 0x9e37 * (pass + 1) + attempt * 0x85eb_ca6b,
      );
      if (!drawn) break;
      const settled = settleIntoBand(drawn, dst);
      if (bandOfPlacement(settled.t, settled.h, settled.asset.size.tall, datum) === dst) {
        replacement = settled;
        break;
      }
    }
    // Nothing this asset pool produced landed where it was needed. Leave
    // the donor alone, remember that, and let the next pass try another.
    // Not counted as a move, which is what lets the caller's own loop see
    // that this repair has finished.
    if (!replacement) {
      failed.add(`${donor.i}|${dst}`);
      continue;
    }

    log.push({ index: donor.i, before: out[donor.i] });
    // SPREAD OVER THE DONOR, never straight onto it. `placeAsset` returns
    // an asset, a lateral and a height and knows nothing about the rest
    // of a placement — so assigning its result whole silently DELETES
    // every other field the caller was carrying. Here that was the
    // station: forty of a lap's placements came out of this repair with
    // no station at all, which put their boxes at NaN in the world,
    // hid them from the cull that runs after this, and made D-4's
    // longest gap unreadable. Nothing failed. The lap just quietly lost
    // an eighth of its dressing.
    out[donor.i] = { ...(out[donor.i] as T), ...replacement };
    moves++;
  }
  return { placements: out, moves, wasOutside, log, datum, exclude };
}

/**
 * Is this repair minimal — could any single move be removed with every
 * bound still holding?
 *
 * O(moves) rather than exponential, deliberately: the criterion is "no
 * SINGLE move is removable", not "no subset is". The single-move form is
 * what separates edge-repair from centre-repair and from a repair that
 * carries on after the bounds are met, and checking subsets would be
 * checking a different and much stronger claim than the rule makes.
 */
export function repairIsMinimal<T extends AssetPlacement>(
  repair: MixRepair<T>,
): { minimal: boolean; removable: number[] } {
  const removable: number[] = [];
  for (const m of repair.log) {
    const trial = [...repair.placements];
    trial[m.index] = m.before;
    // THE REPAIR'S OWN datum AND exclusion, off the result. Taking them
    // as parameters let the gate score a different population from the
    // one the repair balanced; there is now no way to ask the wrong
    // question.
    if (mixInsideRule(trial, repair.datum, repair.exclude)) removable.push(m.index);
  }
  return { minimal: removable.length === 0, removable };
}
