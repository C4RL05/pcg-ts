/**
 * §7's rules: what the environment owes the driver rather than what it
 * owes the statistics.
 *
 * ALL THRESHOLDS. Every rule here is a guarantee — a cone that must be
 * visible, a landmark that must exist in every tenth of the lap, a marker
 * before every corner — so none of them can be sampled and all of them
 * are checked and repaired after placement. L-1's cull lives in
 * `sightline.ts` because it is geometry; the rest are here.
 *
 * AND THEY RUN BEFORE THE FILL AND MIX PASSES. A cull opens a gap and a
 * landmark swap moves a band, so anything that repairs coverage or the
 * band mix has to come after — running them the other way makes §7 and
 * §3 look incompatible when they are only mis-sequenced.
 */
import { type AssetPlacement, type PlaceableAsset, placeAsset } from "./assets.js";

/** L-4's numbers. */
export const LANDMARK = {
  /** How many equal stretches the lap is divided into. */
  tenths: 10,
  /** How many unique-to-the-lap assets each stretch must contain. */
  perStretch: 1,
} as const;

/** A placement with the station it sits at, which §7 needs and §3 does not. */
export interface StationedPlacement extends AssetPlacement {
  readonly station: number;
}

/**
 * Which assets appear exactly once on this lap.
 *
 * THE UNIT OF UNIQUENESS IS AN ASSET, not a family. The rule says
 * "archetype", and this kit has no archetype labels by design — the
 * previous attempt's fitted three-way class is what drove a lap-scale
 * artefact. Per-asset is the stricter reading and, for what L-4 is
 * actually for, the better one: a player navigating by scenery
 * recognises a specific object, not a family it belongs to.
 */
export function uniqueAssets(placements: readonly StationedPlacement[]): Set<number> {
  const seen = new Map<number, number>();
  for (const p of placements) seen.set(p.asset.id, (seen.get(p.asset.id) ?? 0) + 1);
  const out = new Set<number>();
  for (const [id, n] of seen) if (n === 1) out.add(id);
  return out;
}

/** How many landmarks each tenth of the lap holds. */
export function landmarksPerStretch(
  placements: readonly StationedPlacement[],
  lapW: number,
): number[] {
  const unique = uniqueAssets(placements);
  const counts = new Array<number>(LANDMARK.tenths).fill(0);
  for (const p of placements) {
    if (!unique.has(p.asset.id)) continue;
    const k = Math.min(LANDMARK.tenths - 1, Math.floor((p.station / lapW) * LANDMARK.tenths));
    counts[k]++;
  }
  return counts;
}

/** One re-draw, kept so the repair can be checked for minimality. */
export interface LandmarkMove {
  readonly index: number;
  readonly before: StationedPlacement;
}

export interface LandmarkRepair {
  readonly placements: StationedPlacement[];
  readonly moves: number;
  /** Stretches that held no landmark before the repair. */
  readonly wasBare: number[];
  readonly log: LandmarkMove[];
}

/**
 * L-4: every tenth of the lap gets at least one asset that appears
 * nowhere else on it.
 *
 * WHY IT MATTERS AND WHAT IT PREVENTS: without it a player cannot tell
 * where they are from the scenery, which is exactly the failure of the
 * originals' worst tracks — one family covering 54% of placements. A lap
 * can satisfy every density and band rule and still be unnavigable.
 *
 * THE REPAIR RE-DRAWS RATHER THAN ADDS, so D-1's budget stays exact: a
 * placement in the bare stretch is replaced by one drawn from the assets
 * this lap has not used at all. It takes the placement whose own asset is
 * the MOST repeated, because that is the one whose loss costs the least —
 * removing one of twelve copies changes nothing a viewer can name.
 *
 * A stretch can be un-repairable, and that is reported rather than
 * thrown: it needs an unused asset to exist, and a small kit on a long
 * lap can run out. `wasBare` says which stretches needed help and
 * `moves` says how many got it.
 */
export function repairLandmarks(
  placements: readonly StationedPlacement[],
  assets: readonly PlaceableAsset[],
  lapW: number,
  seed: number,
): LandmarkRepair {
  const out = [...placements];
  const log: LandmarkMove[] = [];
  const wasBare: number[] = [];
  let moves = 0;

  const stretchOf = (station: number): number =>
    Math.min(LANDMARK.tenths - 1, Math.floor((station / lapW) * LANDMARK.tenths));

  for (let k = 0; k < LANDMARK.tenths; k++) {
    if (landmarksPerStretch(out, lapW)[k] >= LANDMARK.perStretch) continue;
    wasBare.push(k);

    // Assets this lap has not used at all. Drawing from these is what
    // makes the new placement unique BY CONSTRUCTION rather than by luck.
    const used = new Set(out.map((p) => p.asset.id));
    const unused = assets.filter((a) => !used.has(a.id));
    if (unused.length === 0) continue;

    // The most repeated asset in this stretch is the cheapest to lose.
    const counts = new Map<number, number>();
    for (const p of out) counts.set(p.asset.id, (counts.get(p.asset.id) ?? 0) + 1);
    let victim = -1;
    let victimCount = 0;
    for (let i = 0; i < out.length; i++) {
      if (stretchOf(out[i].station) !== k) continue;
      const n = counts.get(out[i].asset.id) ?? 0;
      if (n > victimCount) {
        victimCount = n;
        victim = i;
      }
    }
    // A stretch with no placement at all cannot carry a landmark, and
    // that is D-4's problem rather than L-4's — the coverage floor runs
    // later and will put something there.
    if (victim < 0 || victimCount < 2) continue;

    const drawn = placeAsset(unused, "straight", seed, 0x4c00 + k);
    if (!drawn) continue;
    log.push({ index: victim, before: out[victim] });
    out[victim] = { ...drawn, station: out[victim].station };
    moves++;
  }
  return { placements: out, moves, wasBare, log };
}

/** Does every tenth carry its landmark? */
export function landmarksSatisfied(
  placements: readonly StationedPlacement[],
  lapW: number,
): boolean {
  return landmarksPerStretch(placements, lapW).every((n) => n >= LANDMARK.perStretch);
}

/**
 * Minimality, by the criterion every conserved-count repair here is held
 * to: no single move may be removable with the rule still satisfied.
 *
 * Idempotence is not enough — a repair that swapped six placements into
 * one bare stretch would halt afterwards and pass it, while five of the
 * six were surplus.
 */
export function landmarkRepairIsMinimal(
  repair: LandmarkRepair,
  lapW: number,
): { minimal: boolean; removable: number[] } {
  const removable: number[] = [];
  for (const m of repair.log) {
    const trial = [...repair.placements];
    trial[m.index] = m.before;
    if (landmarksSatisfied(trial, lapW)) removable.push(m.index);
  }
  return { minimal: removable.length === 0, removable };
}
