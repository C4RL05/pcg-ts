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

/** Deterministic uniform for `(seed, index, salt)`. */
function rand(seed: number, index: number, salt: number): number {
  let h = (seed * 0x9e3779b1 + index * 0x85ebca6b + salt * 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

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

/**
 * Which band a placement falls in, for scoring against Z-3.
 *
 * ON THE BASE, NOT THE CENTRE. The kit records an object at its bounds
 * centre — §13's "object centres stand in for placements" — so a gantry
 * spanning the track is logged at a height of 3.19W with its legs on the
 * ground. Banding on the centre puts the reference circuit's `over` share
 * at 9.5% against a rule of 10-21 and its `verge` at 9.0; banding on the
 * base moves them to 12.7 and 5.9, both inside. The height datum is the
 * whole difference, and neither figure is a placement error.
 */
export function bandOfPlacement(
  t: number,
  centreH: number,
  tallW: number,
): "over" | "verge" | "near" | "mid" | "far" | "distant" {
  const a = Math.abs(t);
  const baseH = centreH - tallW / 2;
  if (a < 1.5 && (baseH > 1.2 || baseH < 0)) return "over";
  if (a < 1.5) return "verge";
  if (a < 2.5) return "near";
  if (a < 5) return "mid";
  if (a < 13) return "far";
  return "distant";
}
