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
import {
  type AssetPlacement,
  type PlaceableAsset,
  drawQuantile,
  placeAsset,
  rand,
} from "./assets.js";
import { type Corner, beforeEntryW } from "./corners.js";

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
  /**
   * Set on L-6's cover pieces.
   *
   * WHY THEY ARE MARKED RATHER THAN INFERRED. A tunnel rib is structure,
   * not scenery: its lateral is dictated by the tunnel it belongs to and
   * not drawn from a measured distribution, and it is placed as one of a
   * repeated run rather than at a station of its own. Z-3's bands
   * describe where scenery sits across the track, so counting forty ribs
   * as forty `over` placements measures the tunnel instead of the
   * dressing. It cannot be inferred from the asset, because cover is
   * tiled from the same vocabulary the dressing draws on.
   */
  readonly cover?: boolean;
  /**
   * Which recorded pose of its asset to draw, if the caller has an
   * opinion. L-6's cover does: a tunnel is the SAME piece repeated, so a
   * run picks one pose and every piece in it uses that one. Scenery has
   * no opinion and takes a pose per copy.
   */
  readonly pose?: number;
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
  /** Asset ids the corner language reserved; never a victim, never a draw. */
  protect: ReadonlySet<number> = new Set(),
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
    const unused = assets.filter((a) => !used.has(a.id) && !protect.has(a.id));
    if (unused.length === 0) continue;

    // The most repeated asset in this stretch is the cheapest to lose.
    const counts = new Map<number, number>();
    for (const p of out) counts.set(p.asset.id, (counts.get(p.asset.id) ?? 0) + 1);
    let victim = -1;
    let victimCount = 0;
    for (let i = 0; i < out.length; i++) {
      if (stretchOf(out[i].station) !== k) continue;
      if (protect.has(out[i].asset.id)) continue;
      // Cover is structure. Swapping a tunnel rib for a one-off makes a
      // landmark and a hole in the roof at the same time.
      if (out[i].cover) continue;
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

// ---------------------------------------------------------------------------
// L-2 and L-3: the corner language.
// ---------------------------------------------------------------------------

/**
 * L-2's numbers, and the test that decides what can be a marker.
 *
 * THE SELECTION IS ON PROPORTIONS, NOT ON CLASS. The rule says "one
 * archetype per corner severity", and this kit has no archetype labels by
 * design. Upstream's reading, which is the one implemented here: any
 * asset whose own `size` is markedly taller than it is wide or long, and
 * whose measured height median already lands where the rule wants the
 * marker, is a vertical object — whatever family it came from.
 */
export const MARKER = {
  /** L-2's placement window before the corner entry, in W. */
  windowW: [3, 6],
  /** L-2's height band, in W. */
  heightW: [1, 2],
  /** `tall` must exceed this multiple of the larger footprint axis. */
  slenderness: 1.5,
  /** And the asset's own measured height median must land in this band. */
  heightMedianW: [1, 2],
  /** Markers are pushed at least this far out, so Z-1 never has to move one. */
  minLateralW: 1.5,
} as const;

/**
 * L-3's numbers.
 *
 * INVENTED, AND MEASURED TO BE SO. Over the 305 corners tighter than
 * R = 8W across all 22 source circuits, 20% have any vertical in this
 * window at all, 4% have three or more, and THE MEDIAN COUNT IS ZERO.
 * Where three do happen to fall there their spacing CV is 0.46 — not a
 * ruler, but not random either. So this rule is a pure addition: it is
 * built here because the demo is allowed to be better than its source,
 * and it is labelled so that nobody later reads a passing L-3 as evidence
 * that the originals did this.
 */
export const BRAKING = {
  /** L-3's window before the corner entry, in W. */
  windowW: [6, 15],
  /** Corners tighter than this get a ruler. */
  tighterThanW: 8,
  /** How many verticals in it. */
  count: 3,
  /** The band the ruler's common lateral is drawn from, in W. */
  lateralW: [1.5, 2.5],
  /** What the originals do in the same window, for the contrast report. */
  sourceMedianCount: 0,
  sourceAnyShare: 0.2,
  sourceThreeShare: 0.04,
} as const;

/** Is this asset a vertical object, by its own proportions alone? */
export function isVertical(a: PlaceableAsset): boolean {
  const foot = Math.max(a.size.across, a.size.along);
  return a.size.tall > MARKER.slenderness * foot;
}

/**
 * The stricter reading, which also asks that the asset's instances
 * HISTORICALLY sat at marker height.
 *
 * NOT THE ONE USED, and the reason is worth keeping. On the demo's kit the
 * proportion test alone finds 8 verticals out of 229 placeable assets;
 * adding the height-median band leaves exactly 3 — the bare minimum the
 * corner language needs, which makes the seeded choice between them
 * degenerate and puts the whole rule one asset away from silently doing
 * nothing. The five it discards sit at medians of 0.57 to 0.91W and one
 * at 2.26W.
 *
 * And the clause is measuring the wrong thing. L-2 fixes the marker's
 * height at 1-2W and this code sets it there explicitly, so where the
 * asset's instances happened to sit in the source is a property the
 * placement then OVERRIDES. Filtering on it is the same constraint
 * counted twice, and it costs five eighths of the vocabulary to do it.
 * Kept as a function because the contrast is worth reporting, and because
 * if upstream's validator applies it, the number it will see is here.
 */
export function strictlyVertical(a: PlaceableAsset): boolean {
  if (!isVertical(a)) return false;
  const m = a.where?.height.median;
  return m !== undefined && m >= MARKER.heightMedianW[0] && m <= MARKER.heightMedianW[1];
}

/** Every asset in the kit that could serve as a marker. */
export function markerCandidates(assets: readonly PlaceableAsset[]): PlaceableAsset[] {
  return assets.filter(isVertical).sort((a, b) => a.id - b.id);
}

/** The three assets reserved to speak the corner language on this lap. */
export interface MarkerKit {
  /** L-2's archetype for corners tighter than `SEVERITY.sharpW`. */
  readonly sharp: PlaceableAsset;
  /** L-2's archetype for the rest. */
  readonly open: PlaceableAsset;
  /** L-3's ruler element. */
  readonly brake: PlaceableAsset;
}

/**
 * Reserve the corner language's assets, and hand back the pool without
 * them.
 *
 * WHY RESERVATION RATHER THAN SELECTION AFTER THE FACT. L-2 wants a
 * DISTINCT object per severity, used consistently for the whole lap. An
 * object that also appears sixty times as ordinary scenery is not
 * distinct, and a player cannot brake on it. Exclusivity is the property
 * that makes the rule work at all, so it is established by construction:
 * these three are removed from the general pool before a single station
 * is dressed, and they appear only where the corner language puts them.
 *
 * THREE, NOT TWO. L-2 asks for a distinct object per severity and L-3 for
 * a ruler; if the ruler were one of the two markers, the marker would
 * stop being distinct — the rule's own word forces the third.
 *
 * Returns no markers when the kit cannot supply three verticals, which is
 * reported rather than thrown: a small kit is a fact about the kit.
 */
export function reserveMarkers(
  assets: readonly PlaceableAsset[],
  seed: number,
): { markers?: MarkerKit; pool: PlaceableAsset[] } {
  const cands = markerCandidates(assets);
  if (cands.length < 3) return { pool: [...assets] };

  // WEIGHTED BY HOW OFTEN THE SOURCE USED THE ASSET, not uniform over the
  // candidates. L-2 puts its marker at every corner of a severity, so
  // whatever is chosen becomes one of the most repeated objects on the
  // lap — and promoting a one-off to that is a far bigger departure from
  // the source than L-2 intends. Of this kit's eight verticals one has 18
  // instances and one has 1; a uniform draw treats those as equally
  // plausible corner furniture, which they are not.
  const picked: PlaceableAsset[] = [];
  const rest = [...cands];
  for (let k = 0; k < 3; k++) {
    let total = 0;
    for (const a of rest) total += Math.max(1, a.instances);
    let u = rand(seed, k, 0x4d21) * total;
    let i = rest.length - 1;
    for (let j = 0; j < rest.length; j++) {
      u -= Math.max(1, rest[j].instances);
      if (u <= 0) {
        i = j;
        break;
      }
    }
    picked.push(rest[i]);
    rest.splice(i, 1);
  }
  const bySize = [...picked].sort((a, b) => b.size.tall - a.size.tall);
  const markers: MarkerKit = { sharp: bySize[0], open: bySize[1], brake: bySize[2] };
  const reserved = new Set(picked.map((a) => a.id));
  return { markers, pool: assets.filter((a) => !reserved.has(a.id)) };
}

/** Is this asset one of the three the corner language reserved? */
export function isReserved(markers: MarkerKit, id: number): boolean {
  return id === markers.sharp.id || id === markers.open.id || id === markers.brake.id;
}

/**
 * Where a corner's three braking marks go.
 *
 * ONE DEFINITION, used by the placer and by the gate. If the gate
 * re-derived these stations it would be checking its own arithmetic
 * against a copy of itself, and both could drift together.
 */
export function rulerStations(c: Corner, lapW: number): number[] {
  const span = BRAKING.windowW[1] - BRAKING.windowW[0];
  const out: number[] = [];
  for (let k = 0; k < BRAKING.count; k++) {
    const beforeW = BRAKING.windowW[0] + (span * k) / (BRAKING.count - 1);
    out.push((((c.entryW - beforeW) % lapW) + lapW) % lapW);
  }
  return out;
}

/** Shortest distance between two stations round the loop. */
function apartW(a: number, b: number, lapW: number): number {
  const d = beforeEntryW(a, b, lapW);
  return Math.min(d, lapW - d);
}

/** What the corner language cost, in placements. */
export interface CornerLanguage {
  readonly placements: StationedPlacement[];
  /** L-2 markers that took over an existing placement's slot. */
  readonly converted: number;
  /** L-2 markers with no candidate to take over, so added outright. */
  readonly added: number;
  /** L-3 verticals placed. Three per tight corner, or none. */
  readonly brakeAdded: number;
  /** Ordinary placements removed from a braking window to pay for them. */
  readonly brakeDisplaced: number;
  /** Corners the language reached. */
  readonly corners: number;
  readonly tightCorners: number;
  /** Verticals already in the braking windows BEFORE L-3 ran. */
  readonly verticalsBefore: number;
}

/**
 * L-2 and L-3, placed together because they share a corner model, a
 * reserved vocabulary and a definition of "outside".
 *
 * L-2 CONVERTS WHERE IT CAN AND ADDS WHERE IT MUST. A marker that must
 * exist cannot be conditional on an ordinary placement happening to fall
 * in a 3W window, so where the window is empty the marker is added and
 * D-1's budget drifts up by one. The two counts are reported separately
 * so that drift is never mistaken for a density model that missed.
 *
 * L-3 ALWAYS ADDS, because its whole point is exact spacing: converting
 * the nearest placement would put the ruler wherever the station process
 * left something, and a ruler with jittered marks is not a ruler. It pays
 * for itself instead by displacing the most-repeated ordinary placements
 * from the same window — which is also the window L-1 most wants clear.
 */
export function placeCornerLanguage(
  placements: readonly StationedPlacement[],
  corners: readonly Corner[],
  markers: MarkerKit | undefined,
  lapW: number,
  seed: number,
): CornerLanguage {
  const tight = corners.filter((c) => c.tightestW < BRAKING.tighterThanW);
  const verticalsBefore = countVerticalsInBrakingWindows(placements, tight, lapW);
  if (!markers) {
    return {
      placements: [...placements],
      converted: 0,
      added: 0,
      brakeAdded: 0,
      brakeDisplaced: 0,
      corners: corners.length,
      tightCorners: tight.length,
      verticalsBefore,
    };
  }

  const out = [...placements];
  let converted = 0;
  let added = 0;
  let brakeAdded = 0;
  let brakeDisplaced = 0;

  /** How repeated each asset is, so the cheapest thing to lose is known. */
  const repeats = (): Map<number, number> => {
    const m = new Map<number, number>();
    for (const p of out) m.set(p.asset.id, (m.get(p.asset.id) ?? 0) + 1);
    return m;
  };

  for (let ci = 0; ci < corners.length; ci++) {
    const c = corners[ci];
    const asset = c.severity === "sharp" ? markers.sharp : markers.open;
    const where = asset.where;
    if (!where) continue;

    // The window is measured BACK from the entry, so a larger `before` is
    // further upstream of the corner.
    const u = rand(seed, ci, 0x2c01);
    const beforeW = MARKER.windowW[0] + u * (MARKER.windowW[1] - MARKER.windowW[0]);
    const station = (((c.entryW - beforeW) % lapW) + lapW) % lapW;

    // Its own lateral, forced to the outside and out past the corridor.
    const raw = Math.abs(drawQuantile(where.lateral, rand(seed, ci, 0x2c02)));
    const t = c.outside * Math.max(MARKER.minLateralW, raw);
    const h = MARKER.heightW[0] + rand(seed, ci, 0x2c03) * (MARKER.heightW[1] - MARKER.heightW[0]);

    // Convert the most-repeated ordinary placement already in the window
    // on the outside, if there is one. Its station is kept: the station
    // process put it there and L-2 only asks that the marker be in the
    // window, which that station already is.
    const counts = repeats();
    let victim = -1;
    let victimCount = 1;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      // NEVER CONVERT A MARKER. On a real circuit two corners can be
      // close enough that one's marker sits inside the next one's
      // window, and a marker placed at every corner is by then one of
      // the most REPEATED assets on the lap — which is exactly what the
      // victim rule below reaches for. Left unguarded it eats the
      // previous corner's marker and the lap comes up one short, with
      // every count still looking plausible.
      if (isReserved(markers, p.asset.id)) continue;
      const d = beforeEntryW(p.station, c.entryW, lapW);
      if (d < MARKER.windowW[0] || d > MARKER.windowW[1]) continue;
      if (Math.sign(p.t) !== c.outside) continue;
      const n = counts.get(p.asset.id) ?? 0;
      if (n > victimCount) {
        victimCount = n;
        victim = i;
      }
    }
    if (victim >= 0) {
      out[victim] = { asset, t, h, station: out[victim].station };
      converted++;
    } else {
      out.push({ asset, t, h, station });
      added++;
    }
  }

  // L-3, on the tight corners only.
  for (let ti = 0; ti < tight.length; ti++) {
    const c = tight[ti];
    // One lateral for all three: they are a line, not a scatter.
    const mag =
      BRAKING.lateralW[0] + rand(seed, ti, 0x3b01) * (BRAKING.lateralW[1] - BRAKING.lateralW[0]);
    const t = c.outside * mag;
    const h = MARKER.heightW[0];

    // Pay first, so the displaced placements cannot be the marks just
    // added — and so a window with nothing to give still gets its ruler.
    const counts = repeats();
    for (let k = 0; k < BRAKING.count; k++) {
      let victim = -1;
      let victimCount = 1;
      for (let i = 0; i < out.length; i++) {
        const p = out[i];
        if (isReserved(markers, p.asset.id)) continue;
        const d = beforeEntryW(p.station, c.entryW, lapW);
        if (d < BRAKING.windowW[0] || d > BRAKING.windowW[1]) continue;
        const n = counts.get(p.asset.id) ?? 0;
        if (n > victimCount) {
          victimCount = n;
          victim = i;
        }
      }
      if (victim < 0) break;
      counts.set(out[victim].asset.id, (counts.get(out[victim].asset.id) ?? 1) - 1);
      out.splice(victim, 1);
      brakeDisplaced++;
    }

    // EXACTLY EVEN, spanning the window end to end. Spacing CV is zero by
    // construction, against the 0.46 the source manages by accident.
    for (const station of rulerStations(c, lapW)) {
      out.push({ asset: markers.brake, t, h, station });
      brakeAdded++;
    }
  }

  return {
    placements: out,
    converted,
    added,
    brakeAdded,
    brakeDisplaced,
    corners: corners.length,
    tightCorners: tight.length,
    verticalsBefore,
  };
}

/** Verticals sitting in the braking windows, by the same proportion test. */
export function countVerticalsInBrakingWindows(
  placements: readonly StationedPlacement[],
  tight: readonly Corner[],
  lapW: number,
): number {
  let n = 0;
  for (const p of placements) {
    if (!isVertical(p.asset)) continue;
    for (const c of tight) {
      const d = beforeEntryW(p.station, c.entryW, lapW);
      if (d >= BRAKING.windowW[0] && d <= BRAKING.windowW[1]) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Does every corner carry its marker, on the outside and in the window? */
export function cornerMarkersSatisfied(
  placements: readonly StationedPlacement[],
  corners: readonly Corner[],
  markers: MarkerKit,
  lapW: number,
): { satisfied: boolean; missing: number[] } {
  const missing: number[] = [];
  for (let ci = 0; ci < corners.length; ci++) {
    const c = corners[ci];
    const want = c.severity === "sharp" ? markers.sharp.id : markers.open.id;
    const ok = placements.some((p) => {
      if (p.asset.id !== want) return false;
      const d = beforeEntryW(p.station, c.entryW, lapW);
      return (
        d >= MARKER.windowW[0] - 1e-6 &&
        d <= MARKER.windowW[1] + 1e-6 &&
        Math.sign(p.t) === c.outside &&
        p.h >= MARKER.heightW[0] - 1e-6 &&
        p.h <= MARKER.heightW[1] + 1e-6
      );
    });
    if (!ok) missing.push(ci);
  }
  return { satisfied: missing.length === 0, missing };
}

/**
 * Does every tight corner carry a ruler — three marks at the stations
 * L-3 asks for, on one line, on the outside?
 *
 * CHECKED AT THE EXPECTED STATIONS, NOT BY COUNTING THE WINDOW. The
 * first version of this counted brake marks falling in the corner's
 * 6-15W window and demanded exactly three, and it failed on a real
 * circuit for a reason that is a fact about circuits rather than about
 * the code: two corners nine half-widths apart have OVERLAPPING braking
 * windows, so one corner's ruler is visible inside the next one's
 * window and the count reads four. Asking instead whether a mark sits
 * at each station this corner's own ruler specifies is both stricter —
 * it is the spacing check, since those stations are evenly spaced by
 * construction — and immune to a neighbour's marks.
 *
 * The overlap itself is reported rather than failed. Nothing in L-3
 * forbids it and there is nowhere else for the marks to go on a circuit
 * whose corners are that close.
 */
export function brakingRulersSatisfied(
  placements: readonly StationedPlacement[],
  corners: readonly Corner[],
  markers: MarkerKit,
  lapW: number,
): { satisfied: boolean; failures: string[]; overlaps: number } {
  const failures: string[] = [];
  const tight = corners.filter((c) => c.tightestW < BRAKING.tighterThanW);
  const marks = placements.filter((p) => p.asset.id === markers.brake.id);
  let overlaps = 0;

  for (let ti = 0; ti < tight.length; ti++) {
    const c = tight[ti];
    const want = rulerStations(c, lapW);
    const found = want.map((st) =>
      marks.find((p) => apartW(p.station, st, lapW) < 1e-6 && Math.sign(p.t) === c.outside),
    );
    const missing = found.filter((m) => m === undefined).length;
    if (missing > 0) {
      failures.push(`corner ${ti}: ${missing} of ${BRAKING.count} marks missing or on the inside`);
      continue;
    }
    const ts = found.map((m) => m!.t);
    const spread = Math.max(...ts) - Math.min(...ts);
    if (spread > 1e-6) failures.push(`corner ${ti}: marks not on one line (${spread.toFixed(3)}W)`);

    // Anything else of the ruler's asset inside this corner's window
    // belongs to a neighbour.
    const inWindow = marks.filter((p) => {
      const d = beforeEntryW(p.station, c.entryW, lapW);
      return d >= BRAKING.windowW[0] - 1e-6 && d <= BRAKING.windowW[1] + 1e-6;
    }).length;
    overlaps += Math.max(0, inWindow - BRAKING.count);
  }
  return { satisfied: failures.length === 0, failures, overlaps };
}
