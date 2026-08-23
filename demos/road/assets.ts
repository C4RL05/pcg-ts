/**
 * Which asset goes at each station, and where its own measurements put
 * it.
 *
 * NO ARCHETYPE LABEL. The previous attempt sorted assets into a fitted
 * three-way class and gave each class its own distribution, and the class
 * label ended up driving a lap-scale artefact that no measurement of the
 * source supports. So there is no label here: each asset carries its own
 * measured behaviour — where across the track its instances sat, how
 * high, which side, and how its rate varied with curvature — and that is
 * what places it. An asset is its own archetype.
 *
 * CURVATURE ENTERS HERE AND NOWHERE ELSE. D-6's response is per asset:
 * ONE density along the lap, with each asset's share of it modulated by
 * its own curvature preference. The station process upstream of this
 * knows nothing about curvature, and total density is never modulated —
 * `affinity` is measured against LAP LENGTH, so it already carries the
 * population's own decline in bends, and applying D-6's population curve
 * on top would count it twice.
 *
 * AND THE AFFINITIES ARE NOT RENORMALISED per bucket afterwards. That
 * would divide the effect straight back out — the same error as the
 * affinity denominator, one level up.
 */

import { CORRIDOR, fitsOverhead, resolveCorridor } from "./zones.js";
import { rand } from "./rand.js";

/** The per-asset measurements this module places from. */
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
  /** How many times this asset appeared on the circuit it was measured on. */
  readonly instances: number;
  readonly size: { readonly across: number; readonly along: number; readonly tall: number };
  readonly capped?: boolean;
  readonly where?: AssetWhere;
}

export type CurvatureBucket = "straight" | "easy" | "medium" | "tight";

/**
 * Upstream's cuts, in W. Not guessed — an earlier version here used
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
 * output that no measurement backs. Below p10 and above p90 it continues
 * the outer segment's slope rather than clamping, so the tails exist
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
  /** Height in W, on whatever datum the source's `where.height` used. */
  readonly h: number;
}

/**
 * The weight an asset carries at a station of the given curvature.
 *
 * `instances` is its natural frequency on the circuit it was measured
 * on — an asset placed twenty times is twenty times as likely as one
 * placed once, which is what "how often does this appear" means. The
 * affinity then modulates that by where the station is.
 *
 * A ONE-OFF STILL GETS A WEIGHT, deliberately: 135 of the 206 assets
 * appeared exactly once, and dropping them would throw away two thirds of
 * the vocabulary in exchange for a slightly better frequency match. L-4
 * wants a landmark in every tenth of the lap and those are where it comes
 * from.
 */
export function weightAt(asset: PlaceableAsset, bucket: CurvatureBucket): number {
  if (!asset.where) return 0;
  const aff = asset.where.affinity[bucket];
  return asset.instances * (Number.isFinite(aff) ? Math.max(0, aff) : 0);
}

/**
 * Choose an asset for one station and place it from its own measurements.
 *
 * The lateral is drawn from the asset's OWN distribution rather than from
 * a band, which is what Z-1 means by "draw |t| from the measured
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
 * Z-3's shares — the POOLED rule, and the per-circuit spread behind it.
 *
 * The rule is pooled over every object in the source era, and a single
 * circuit sits outside it on some band as a matter of course: the
 * per-circuit p10-p90 is roughly twice as wide. So Z-3 is a target for a
 * GENERATED lap, not a description any original satisfies, and an
 * original missing it is not evidence against it.
 *
 * A generated lap is scored against `rule`. A real circuit is compared
 * against `spread`, and comparing one to the other is how a good exemplar
 * gets mistaken for a bad generator.
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
 * not state which one it means. Everything upstream publishes is on the
 * BOUNDS CENTRE — §13's "object centres stand in for placements" — so a
 * gantry over the track is logged at h = 3.19W with its legs on the
 * ground, and `centre` is the only datum that can be compared against
 * those figures.
 *
 * `base` is the physically meaningful one and gives a different answer:
 * on one circuit it moved `over` from 9.5% to 12.7% and `verge` from 9.0%
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
  // ANCHORED INSIDE THE CORRIDOR IS `over`, WHATEVER ITS HEIGHT. Z2's
  // verge is 1.0-1.5W and Z1 holds nothing, so a placement recorded at
  // |t| < 1W is not verge art that strayed — it is something SPANNING the
  // corridor, logged at its centre. §13: "object centres stand in for
  // placements ... which is why 8% of terrain reads as over the track".
  //
  // This was `a < 1.5` for both, which counted the corridor as verge and
  // put seven points of a 362-placement circuit in the wrong band —
  // `over` 3% against a true 10%, `verge` 13% against 6%. It was caught
  // by a second measurement of the same circuit disagreeing, not by
  // anything here.
  if (a < CORRIDOR.halfWidthW) return "over";
  if (a < 1.5 && (h > CORRIDOR.ceilingW || h < CORRIDOR.floorW)) return "over";
  if (a < 1.5) return "verge";
  if (a < 2.5) return "near";
  if (a < 5) return "mid";
  if (a < 13) return "far";
  return "distant";
}

/** The |t| span each band occupies, for choosing an asset that lands in it. */
const BAND_T: Record<Band, readonly [number, number]> = {
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
    if (share < lo - 1e-9 || share > hi + 1e-9) return false;
  }
  return true;
}

/**
 * Bring a lap's band mix inside Z-3 — TO THE NEAREST EDGE, never to the
 * centre.
 *
 * WHY Z-3 IS REPAIRED AT ALL, given that the exemplar misses it. Because
 * it is not a measurement. Across the twenty-two circuits the observed
 * range is `over` 4-40% and `near` 0-56%; a gate at the full range is
 * vacuous and a gate at p10-p90 rejects a fifth of real circuits. Z-3 is
 * deliberately NARROWER than the source — the same standing as Z-1's
 * corridor, a decision to be better than what was measured — so a lap
 * outside it reads wrong even though some original does it.
 *
 * AND WHY THE NEAREST EDGE. Driving every lap to the centre of each band
 * would make generated laps markedly more uniform than the originals,
 * which vary by a factor of five on `over`. That is the density-envelope
 * error in different clothes: imposing at the LAP level an aggregate the
 * population reaches through variation BETWEEN laps. Eight laps spread
 * across a band is correct; eight laps all landing on 15% would be worse
 * art while scoring better against the rule.
 *
 * So: lift a band to its floor, trim it to its ceiling, stop. Enforce the
 * bound, preserve the spread inside it.
 */
export function repairBandMix<T extends AssetPlacement>(
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
   * to a quarter of the population and make Z-3 unsatisfiable on any
   * circuit that has a tunnel. They are structure rather than dressing,
   * and the share Z-3 states was measured on dressing.
   */
  exclude: (p: T) => boolean = () => false,
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

  const before = shares();
  const log: MixMove<T>[] = [];
  const wasOutside: MixRepair["wasOutside"] = [];
  for (const b of Object.keys(Z3) as Band[]) {
    const [lo, hi] = Z3[b].rule;
    if (before[b] < lo) wasOutside.push({ band: b, share: before[b], edge: lo });
    else if (before[b] > hi) wasOutside.push({ band: b, share: before[b], edge: hi });
  }

  let moves = 0;
  // Bounded by the population: each pass moves exactly one placement.
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

    const donor = live().find((x) => x.band === src && !protect.has(out[x.i]?.asset.id ?? -1));
    if (!donor) break;

    // Re-place the station with an asset whose OWN measurements put it in
    // the band that needs filling — rather than moving the existing
    // placement's lateral, which would break the link between an asset
    // and where its instances actually sat.
    const [lo, hi] = BAND_T[dst];
    const pool = assets.filter((a) => {
      if (protect.has(a.id)) return false;
      // Z7 is FURNITURE, not enclosure. Anything too tall to hang under
      // the overhead ceiling is a shell, and a shell placed here becomes
      // a roof over the whole band. See `fitsOverhead`.
      if (dst === "over" && !fitsOverhead(a.size.tall)) return false;
      const m = a.where?.lateral.median;
      return m !== undefined && Math.abs(m) >= lo && Math.abs(m) < hi;
    });
    if (pool.length === 0) break;
    let replacement = placeAsset(pool, "straight", seed, donor.i + 0x9e37 * (pass + 1));
    if (!replacement) break;

    // AN `over` PLACEMENT SPANS THE CORRIDOR; IT DOES NOT SIT IN IT.
    // The band is |t| < 1W — which is the corridor — so filling it from
    // an asset's own measured height puts an object on the racing line
    // at about knee height. Z-1 then either raises it (fine) or stands
    // it off to the corridor edge, which takes it OUT of this band, so
    // the mix refills it and the two rules oscillate: measured at 147
    // mix moves against 95 corridor fixes over six rounds, never
    // settling, finishing with eight objects in the middle of the road.
    //
    // So the height comes from the BAND here rather than from the asset.
    // Raised, it stays `over` for any |t| under 1.5W, Z-1 has nothing to
    // fix, and the loop settles in two.
    if (dst === "over") {
      const tall = replacement.asset.size.tall;
      replacement = { ...replacement, h: CORRIDOR.ceilingW + tall / 2 };
    } else {
      // AND EVERY OTHER BAND GETS Z-1 APPLIED AT THE POINT OF DRAWING.
      //
      // A replacement's lateral comes from its asset's own distribution,
      // which reaches inside 1W for a good part of the vocabulary — so
      // the mix emits corridor violations, Z-1 relocates them on the next
      // round, relocating changes their band, and the mix rebalances.
      // Neither repair is wrong and the pair never settles: measured at
      // 56 mix moves and 23 corridor fixes over twelve rounds on a lap
      // where every rule was already satisfied by round two.
      //
      // A repair must not emit something another repair has to undo.
      const tall = replacement.asset.size.tall;
      const baseH = replacement.h - tall / 2;
      const fixed = resolveCorridor(replacement.t, baseH, replacement.asset.size.across, tall);
      if (fixed.t !== replacement.t || fixed.baseH !== baseH) {
        replacement = { ...replacement, t: fixed.t, h: fixed.baseH + tall / 2 };
      }
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
