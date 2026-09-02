/**
 * The whole pipeline, in §9's order.
 *
 * THE ORDER IS THE DESIGN, and getting it wrong makes the rules look
 * incompatible when they are only mis-sequenced:
 *
 *   0. reserve       L-2/L-3's vocabulary, before anything is dressed
 *   1. stations      how many and where along  (D-1, D-5's curve)
 *   2. assets        which asset, from its own placement statistics
 *   3. corridor      Z-1, by size
 *   4. language      L-2's markers and L-3's rulers
 *   5. landmarks     L-4        — REFERENCE ONLY, see the last paragraph
 *   6. sightline     L-1's cull — MOVES AND DROPS THINGS
 *   7. coverage      D-4 — closes the gaps the cull opened
 *   8. band mix      Z-3 — fixes the bands the cull moved
 *
 * THE CULL IS SIXTH, NOT FOURTH, and that is a correction. It used to run
 * before the legibility rules, which meant every marker L-2 placed and
 * every asset L-4 swapped in went onto the lap WITHOUT EVER BEING CONE
 * TESTED — a corner marker is a tall object near the racing line and is
 * exactly the kind of thing L-1 exists to catch. §9's step 11 places the
 * markers and then runs the cone test, in that order, and it is right:
 * §7 decides what must exist, and L-1 gets the last word on whether it
 * may stand where it was put.
 *
 * The price is that L-1 can push one mark of a ruler outward and break
 * L-3's "on one line". §9 resolves that by ordering rather than by
 * exemption, so the cull wins and the damage is counted.
 *
 * Seven and eight still come after the cull, for the reason they always
 * have: a
 * mix repaired before a cull is a mix repaired against a lap that no
 * longer exists.
 *
 * EVERY REPAIR IS MINIMAL AND REPORTS ITS FIRE COUNT. A repair that never
 * runs is indistinguishable from a compliant generator at the assertion
 * level, and a repair that overshoots satisfies every bound while being
 * wrong — so each stage says how much it had to do.
 *
 * STEP 5 IS NOT ON THE SHIPPED PAGE, AND THAT IS A DECISION RATHER THAN A
 * DEFERRAL. This file is the reference pipeline and the comparison suites
 * run it, but `demos/racetrack/main.ts` does not: the page omits
 * `placements` and the lap level's graph decides the list, and
 * `repairLandmarks` — L-4 — HAS NO GRAPH STAGE and is not going to get
 * one. Every other rule in the list above does; L-4 alone is missing.
 *
 * IT IS MISSING BECAUSE PORTING IT WOULD MAKE THE PICTURE WORSE, measured
 * before it was decided. L-4's actual guarantee is stretch coverage —
 * every tenth of the lap holds an asset that appears nowhere else on it —
 * and the only thing the graph path would need from it is `mixPinned`'s
 * landmark half, protecting those assets from Z-3's redraw. Over six
 * seeds, against a two-pass reconstruction of the reference's full 13-id
 * pin set, the covered-stretch count was IDENTICAL on seeds 1-5 (10, 10,
 * 9, 10, 10) and the reserved-only lap was strictly BETTER on seed 6, 10
 * against 9.
 *
 * THOSE SIX NUMBERS ARE FROM BEFORE 2026-08-28 AND ONE HALF OF THE PAIR
 * HAS BEEN RETAKEN. Z-3's donor order changed, so which asset stands at a
 * station changed, and so did which of them are unique. The reserved-only
 * graph lap now reads 10, 10, 10, 10, 10, 9 — the one bare tenth moved
 * from seed 3 to seed 6 — and the reference path reads 10 on all six. The
 * FULL-PIN arm was NOT re-run, so the comparison itself is currently
 * unmeasured: what is written above is what it said when it was taken, and
 * anyone leaning on the conclusion should retake both arms rather than
 * assume the gap survived. The MECHANISM below is what the decision rests
 * on and is unaffected by any of it.
 *
 * Pinning costs a donor and a draw — a pinned id leaves both
 * the quota's eligible set and the redraw pool — so withholding ten more
 * assets from a ~226-asset pool pushes the mix onto more-repeated
 * replacements, and that destroys uniqueness elsewhere faster than the
 * pin preserves it here. The reference's pin is also answering a
 * situation the graph does not have: there, L-4 runs again next round and
 * restores what the mix broke, so the pin is one half of a fight. In the
 * graph there is no second half, and a purely defensive pin is not worth
 * its cost. `main.ts` carries the same argument at the call site; this is
 * the copy a reader of the RULE LIST will reach first.
 */
import {
  type AssetPlacement,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
  rand,
  Z3,
  repairBandMix,
} from "./assets.js";
import type { AssetChoice } from "./assetGraph.js";
import { type Corner, cornersOf, radiusAtW } from "./corners.js";
import type { Kit, PlacedBox } from "./kit.js";
import type { Lap } from "./lap.js";
import { placeAt } from "./lap.js";
import {
  type CornerBookkeepingResult,
  type DrawnCornerLanguage,
  type MarkerKit,
  type StationedPlacement,
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  placeCornerLanguage,
  repairLandmarks,
  landmarkAssets,
  reserveMarkers,
} from "./legibility.js";
import { repairFalseEdges } from "./falseEdges.js";
import { type Frame, blocksCone, cullSightlines, defaultEyeStations } from "./sightline.js";
import { LONG_QUANTILE, longCoverBudgetW, placeEnclosure, reduceEnclosure } from "./tunnels.js";
import { measureEnclosure } from "./enclosure.js";
import { FITTED, makeStationsDetailed,
  type StationStats, repairPlacementCoverage } from "./stations.js";
import { SAME_PLACE_W } from "./tolerance.js";
import { resolveCorridor } from "./zones.js";

/**
 * How many times the tail may validate and feed back before giving up.
 *
 * TWELVE, RAISED FROM SIX. Six was generous when the tail was four
 * repairs and settled in two rounds. It is now seven — Z-1, L-1, L-6's
 * top-up and trim, D-4, L-4, L-5 and Z-3 — and each one that yields to
 * another adds a round: protecting landmarks from the mix stopped those
 * two fighting, and the cost of not fighting is that the mix takes
 * longer to reach its bands. The bound exists to stop a hang, not to
 * enforce a quality bar, and `converged` is reported either way. It
 * is bounded at all because the four repairs it runs can in principle
 * chase each other — the cull drops what coverage just placed, coverage
 * replaces it, and so on — and a demo that hangs on one seed in a hundred
 * is worse than one that reports it did not settle.
 *
 * TWENTY NOW, AND THE TWELVE ABOVE WAS SHIPPING A DEFECT. Measured on the
 * shipped vocabulary — `shippedVocabulary()`, which is what `main.ts:306`
 * dresses the published page from — over seeds 1..256 with this bound
 * lifted out of the way: 255 of the 256 settle in two to eight rounds,
 * and **seed 242 needs thirteen**. At twelve it shipped
 * `converged: false`. One seed in 256 of the published page, and the
 * histogram is 81/91/45/17/7/8/6 seeds at 2/3/4/5/6/7/8 rounds.
 *
 * WHY NOT THIRTEEN, and this is the whole of the choice. The range 9..12
 * is EMPTY — nothing in 256 seeds lands there. So thirteen is not the top
 * of a tail whose shape was sampled; it is one sample of a different
 * phenomenon, and setting the ceiling on it re-arms the same defect for
 * the first lap whose ramp runs one round longer. Seed 242 is a genuine
 * L-6 ramp rather than a chase: its placements climb 372 → 384 → 389 →
 * 394 → 400 → 405 → 421 as `cover +=` reads 2,2,1,1,1,1,1, because the
 * loop appends cover each round (below) and `longCoverBudgetW` sizes the
 * next increment against a target that rises with what was just added.
 * Only when that flattens at round seven does the ordinary `cull=1 mix=1`
 * settling run the remaining six. Ramp plus tail, and 256 seeds say the
 * ramp is rare without saying how long it can get.
 *
 * SO: the observed worst (13) plus the full width of the settled body
 * (2..8, seven rounds) is twenty — a lap whose ramp runs as long as 242's
 * and whose tail then runs as long as the worst ordinary seed's ENTIRE
 * dressing. Headroom is very nearly free, for the reason
 * `stationGraph.ts`'s `REPAIR_MAX_ROUNDS` gives: the loop stops the round
 * it stops moving, not when it runs out, so a higher ceiling costs the
 * 255 seeds that settle by eight exactly nothing.
 *
 * AND WHY IT IS NOT LARGER THAN TWENTY. The cost is not zero for a
 * population that never settles at all, where it is paid in full and
 * linearly: a kit that chases burns every round the bound allows. One
 * exists — see PLAN.md, "Raising the round cap does not reach the street
 * kit". The bound is a hang-stop, and this is where it stops being one.
 */
const MAX_REPAIR_ROUNDS = 20;

/** Knobs a host may turn without rewriting the rules. */
export interface DressOptions {
  /**
   * Multiplier on D-1's fitted density, which is 0.95 placements per W.
   *
   * A KNOB, NOT A RULE. D-1 is a distribution with a threshold hidden in
   * its floor: 0.6 to 1.2 placements per W is the accepted band and
   * "under 0.6" means unfinished. Turning this past either edge leaves
   * the rule, so `perW` is reported and the page says when the lap has
   * stopped being compliant rather than letting the slider imply it is
   * all equally valid.
   *
   * Everything downstream follows the count, because every other rule is
   * expressed as a share or a threshold over the population rather than
   * as an absolute — so a denser lap gets proportionally more markers,
   * more cover and more repairs without anything being retuned.
   */
  readonly density?: number;

  /**
   * Where the stations come from, when the caller has already decided.
   *
   * PLUGGABLE BECAUSE THE PROCESS IS BEING MOVED INTO A GRAPH, one seam
   * at a time. `stationGraph.cookStations` produces exactly this shape by
   * running the process and D-4's repair as nodes, and the page passes
   * its result in — which is what lets the lap level stop needing a
   * TypeScript prelude without every caller of `dressLap` changing at
   * once.
   *
   * IT IS AN OPTION RATHER THAN A SWITCH INSIDE because cooking is async
   * and `dressLap` is not. Reaching a cook from here would make this
   * function async and ripple through every synchronous caller and test
   * for no benefit; taking the answer instead leaves it to the caller to
   * choose where the stations come from, which is the arrangement this
   * campaign is heading for anyway.
   *
   * Omitted, the fitted TypeScript process runs as it always has. The two
   * do NOT agree station for station and cannot — see
   * `stationGraph`'s header for why — so passing this re-bases every
   * figure downstream of it.
   */
  readonly stations?: StationStats;

  /**
   * Which asset stands at each station, when the caller has decided.
   *
   * THE SECOND SEAM, and it rides on the first: entry `i` is the asset
   * for `stations.stations[i]`, so this is only meaningful alongside a
   * `stations` from the same cook. `assetGraph.cookLapPlacements` runs
   * both stages in ONE graph and returns them together for exactly that
   * reason — two cooks would give the same numbers today and would have
   * to be undone to reach a lap LEVEL, which is one graph.
   *
   * AN INDEX, NOT AN ASSET, and the index is into the pool `reserveFor`
   * answers for this kit and seed. Passing the object would let a caller
   * hand over an asset the lap reserved for its corner markers, which L-2
   * establishes by construction and would then quietly lose; passing an
   * index into the pool the reservation already produced cannot express
   * that. Call {@link reserveFor} once and give its `pool` to the cook.
   *
   * `undefined` at an entry is `placeAsset` answering `undefined` — every
   * asset weighed zero at that station — and the station is skipped, as
   * it always was.
   *
   * Omitted, the TypeScript draw runs as it always has. Like `stations`,
   * passing this re-bases every figure downstream of it.
   */
  readonly choices?: readonly (AssetChoice | undefined)[];

  /**
   * Where L-2's markers and L-3's ruler marks go, when a graph drew them.
   *
   * THE THIRD SEAM, and the narrowest of the three. It carries only the
   * four quantities the corner language DRAWS -- a marker's distance back
   * from the entry, its lateral quantile and its height, and a ruler's
   * shared lateral -- because everything else L-2 and L-3 do is either
   * exact arithmetic (`rulerStations`) or a greedy walk over the whole
   * placement list that recomputes a lap-wide histogram after every
   * change. `assetGraph.cookCornerLanguage` produces this shape.
   *
   * IT PAIRS BY POSITION, and against two different lists: `markers` is
   * parallel to `cornersOf(lap)` and `rulers` is three per corner tighter
   * than `SEVERITY.tightW`, both in racing order. Cook it against the same
   * lap that is being dressed.
   *
   * Omitted, the TypeScript draws run as they always have. Like the other
   * two, passing this re-bases every figure downstream of it.
   */
  readonly language?: DrawnCornerLanguage;

  /**
   * The three reserved marker assets and the pool that is left, when the
   * caller has already reserved them.
   *
   * THE SEAM THE OTHER THREE ASSUMED, and it was missing. `choices` is an
   * index INTO the pool, so a caller cooking against a graph-reserved
   * pool while this function re-derived a TypeScript-reserved one was
   * handing over indices into a list that does not exist here -- which is
   * exactly what {@link AssetChoice}'s carried asset id catches, and did.
   * Before that guard existed the two pools happened to agree at one seed
   * and the whole arrangement looked correct.
   *
   * BOTH HALVES TOGETHER, NOT THE MARKERS ALONE. A reservation is a
   * partition: three assets held back, and everything else left to dress
   * from. Taking only the markers and re-deriving the pool would let the
   * two disagree, which is the failure this option exists to make
   * unwriteable.
   *
   * `markers` absent is `reserveMarkers` reporting a kit with fewer than
   * three verticals, and `dressLap` answers that by placing no corner
   * language -- the same as it always has.
   */
  readonly reservation?: {
    readonly markers?: MarkerKit;
    readonly pool: PlaceableAsset[];
  };

  /**
   * Which placement each corner converts, and which ones each ruler
   * displaces, when a graph has decided.
   *
   * THE FIFTH SEAM, and the only one that is checkable EXACTLY. Nothing
   * here is drawn -- a victim is chosen by counting and comparing -- so
   * `cornerGraph.cookCornerBookkeeping` and the TypeScript search must
   * agree placement for placement, and the suite asserts that rather than
   * a distribution.
   *
   * ITS INDICES NAME THE LIST AS IT REACHES STEP 4, which is after the
   * stations, the asset choice and Z-1 and before anything is converted.
   * Cook it against exactly that list.
   *
   * Omitted, the TypeScript search runs as it always has.
   */
  readonly bookkeeping?: CornerBookkeepingResult;
  /**
   * Who builds L-6's enclosure.
   *
   * "rules" (the default) is this function, as it always has. "deferred"
   * means DO NOT RUN L-6 AT ALL -- neither the top-up nor the trim,
   * because something downstream owns the whole rule -- and it exists
   * because the racetrack's enclosure now runs as a graph stage inside
   * `buildDressGraph`, which cooks AFTER this returns.
   *
   * IT COVERS BOTH HALVES AND IT USED TO COVER ONE. When only the top-up
   * was ported, deferring it and still trimming here was the honest
   * arrangement: the trim was the only implementation there was. Now the
   * graph's second repair pass runs the trim every round, so leaving this
   * one in would trim a lap and then hand it to a stage that trims it
   * again, against a ceiling the first pass had already brought it under.
   * The two would not disagree about the ANSWER -- both stop at the
   * ceiling -- but the moves would be counted twice and reported twice.
   *
   * IT IS A SKIP AND NOT A HAND-IN, which is where it parts company with
   * every other option here. `stations`, `choices`, `language` and
   * `bookkeeping` all take a graph's ANSWER and let this function stay the
   * authority on the list; enclosure cannot work that way round, because
   * the budget it spends is measured from boxes built out of the settled
   * list -- which does not exist until this function has finished. So the
   * graph runs later and this one stands aside.
   *
   * A lap dressed with it deferred and never handed to the graph is a lap
   * with no tunnels on it. That is a legitimate thing to ask for and it is
   * why the option is named for WHO does the work rather than for whether
   * it happens.
   */
  readonly enclosure?: "rules" | "deferred";
}

/**
 * The corner-marker reservation, and the pool everything else draws from.
 *
 * ONE DEFINITION OF "THE POOL", because an {@link AssetChoice} is an
 * INDEX into it and two derivations that drifted apart would silently
 * place the wrong assets rather than fail. `dressLap` calls this, and a
 * caller cooking the choices calls it too and passes the same array to
 * both.
 *
 * L-2 AND L-3 RESERVE BEFORE ANYTHING IS DRESSED. An object that also
 * appears sixty times as scenery cannot announce a corner, so exclusivity
 * is established by construction here rather than hoped for afterwards.
 */
export function reserveFor(
  kit: Kit,
  seed: number,
): { readonly markers?: MarkerKit; readonly pool: PlaceableAsset[] } {
  return reserveMarkers((kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where), seed);
}

/**
 * One cooked choice, resolved against the pool it indexes.
 *
 * THE ID CHECK IS THE POINT, AND THE RANGE CHECK IS NOT ENOUGH. A choice
 * is an index, so a pool that is not the one the cook was given yields a
 * different asset rather than an error. `reserveFor` answers a pool of
 * the SAME LENGTH for every seed and varies only which three assets it
 * held back, so every index stays in range and nothing looks wrong:
 * cooking against seed 1's pool and dressing at seed 2 was measured to
 * name a different asset at 23 of 329 placements, with a normal-looking
 * lap coming out the other side. Comparing the id the cook carried
 * against the id at that index is what turns the whole class into a
 * throw, and it costs one integer per placement.
 */
function fromChoice(
  choice: AssetChoice | undefined,
  pool: readonly PlaceableAsset[],
  station: number,
): AssetPlacement | undefined {
  if (!choice) return undefined;
  const asset = pool[choice.assetIndex];
  if (!asset) {
    throw new Error(
      `dressLap: opts.choices[${station}] names pool index ${choice.assetIndex}, but the pool has ${pool.length}. A choice is an INDEX into the pool reserveFor answers for this kit and seed — cook the choices against that same pool.`,
    );
  }
  if (asset.id !== choice.assetId) {
    throw new Error(
      `dressLap: opts.choices[${station}] was cooked for asset id ${choice.assetId} but pool index ${choice.assetIndex} holds id ${asset.id}. These choices came from a different pool — reserveFor answers a DIFFERENT pool per seed at the same length, so pass the same kit and seed to both, and give the cook the pool reserveFor returned.`,
    );
  }
  return { asset, t: choice.t, h: choice.h };
}

/** What each stage had to do, so a page can show it. */
export interface DressStats {
  readonly placed: number;
  /** Placements per W of lap — D-1's own units. Accepted band 0.6-1.2. */
  readonly perW: number;
  /** D-4 closed at step 1, on the stations, before anything was culled. */
  readonly stationGapRepairs: number;
  /** D-4 closed again at step 7, on the lap the cull left behind. */
  readonly coverageMoves: number;
  /** And what the longest gap is once it has. */
  readonly worstGapW: number;
  readonly corridorFixes: number;
  readonly corners: number;
  readonly tightCorners: number;
  readonly markersConverted: number;
  readonly markersAdded: number;
  readonly brakeMarks: number;
  readonly brakeDisplaced: number;
  /**
   * L-3 rulers whose lateral had to step out to clear L-1's cone, and the
   * ones no rung could clear.
   *
   * READ TOGETHER WITH `dropped`. `rulersStepped` is how much of the lap
   * the group clearance search moved — zero is the lap that had no search
   * in it — and `rulersFellBack` is the only place a braking mark can
   * still be lost, because a corner that fell back is a corner the cull is
   * left to thin out exactly as it did before.
   */
  readonly rulersStepped: number;
  readonly rulersFellBack: number;
  readonly blocked: number;
  readonly pushedOut: number;
  readonly dropped: number;
  /** L-6: runs of cover placed, and the pieces they are tiled from. */
  readonly coverStretches: number;
  readonly coverPieces: number;
  /** The share of lap the top-up intended. What it ACHIEVES is measured. */
  readonly plannedEnclosure: number;
  /** Overhead pieces moved out to bring an over-enclosed lap under. */
  readonly enclosureTrims: number;
  /** And how many whole covered runs those pieces made up. */
  readonly enclosureRunsTrimmed: number;
  /** L-6 left unsatisfied because trimming further would break Z-3. */
  readonly enclosureBlocked: boolean;
  /** No incidental overhead existed to trim — NOT the same as blocked. */
  readonly enclosureNothingToTrim: boolean;
  /** L-5: lines in Z2-Z3 that a driver could mistake for the track edge. */
  readonly falseEdges: number;
  readonly edgeMoves: number;
  /** Enclosure the ORDINARY dressing already produced, before L-6 ran. */
  readonly enclosureBefore: number;
  /** And what the finished lap measures. L-6's only real claim. */
  readonly enclosureAfter: number;
  /** How many validate-and-feed-back rounds the tail needed. */
  readonly rounds: number;
  /** Whether it reached a fixed point, or ran out of rounds still repairing. */
  readonly converged: boolean;
  /** Corners whose marker the cull moved off the outside or dropped. */
  readonly markersLostToCull: number;
  /** Rulers the cull broke — L-1 wins, and this is what that costs. */
  readonly rulersLostToCull: number;
  readonly landmarkFixes: number;
  readonly mixMoves: number;
  readonly cookMs: number;
}

export interface Dressing {
  readonly boxes: PlacedBox[];
  readonly stats: DressStats;
  /**
   * The placements the boxes were built from, and the corner model they
   * were built against.
   *
   * RETURNED SO THE ASSEMBLED PIPELINE CAN BE CHECKED. Every rule here
   * had a test of its own and the pipeline that runs them had none, which
   * is how the cull came to run before the legibility rules for as long
   * as it did: each stage was correct and the ORDER was not, and nothing
   * looked at the order. A gate on the finished lap is the only thing
   * that can see that class of defect.
   */
  readonly placements: StationedPlacement[];
  readonly corners: Corner[];
  readonly markers?: MarkerKit;
  /**
   * The asset ids Z-3 was forbidden to move, on the lap as it finished.
   *
   * RETURNED SO THE GRAPH IS TOLD RATHER THAN ASKED TO RE-DERIVE. The set
   * is L-2 and L-3's reserved corner vocabulary plus L-4's landmarks, and
   * re-deriving the second half is re-deriving L-4 — a rule the graph does
   * not run, over a list it would have to walk to find out which asset is
   * unique in which tenth of the lap. Handing the answer over is the two
   * paths agreeing by construction, which is the same argument
   * `immovable` already makes for L-3's braking mark.
   *
   * ON THE FINAL PLACEMENTS, not on the ones any particular round saw:
   * this describes the lap being handed on, and that is the lap the graph
   * is given.
   */
  readonly mixPinned: Set<number>;
  /**
   * The pool every draw on this lap came out of — the kit's placeable
   * assets with L-2 and L-3's reserved vocabulary already removed.
   *
   * HANDED ON FOR `reservation`'s REASON. `reserveFor` answers a pool of
   * the same LENGTH for every seed and varies only its membership, so a
   * second derivation cannot be caught by a length check: cooking against
   * one seed's pool and dressing at another was measured to name a
   * different asset at 23 of 329 placements with every index in range.
   * Z-3's redraw picks out of this pool, so it has to be THIS pool.
   */
  readonly pool: PlaceableAsset[];
}

/** The lap's own frame lookup, shared by every stage that needs one. */
export function frameLookup(lap: Lap): (s: number, t: number, h: number) => Frame {
  return (s, t, h) => {
    // ONE lookup. This asked `poseAt` for the pose and then `placeAt` for
    // the point — and `placeAt` derives its point from exactly that same
    // `poseAt(lap, s * halfWidth)` and hands the pose back. Two binary
    // searches over the lap where one does, on the demo's hottest path.
    const { p, pose } = placeAt(lap, { station: s, lateral: t, height: h });
    return { p, dir: pose.dir, up: pose.up, across: pose.across };
  };
}


/**
 * Each placement's own box decomposition, put on the lap.
 *
 * A FUNCTION BECAUSE IT RUNS TWICE. L-6 has to know how much of the lap
 * the dressing ALREADY covers before it can decide how much to add, and
 * that is a question about boxes rather than about placements — a
 * placement is a point, and whether something spans the corridor is a
 * fact about its geometry.
 */
type KitBoxes = { min: number[]; max: number[]; role?: string; thickness?: number }[];

interface KitIndex {
  /** Asset id -> every pose of it the vocabulary carries. */
  readonly poseOf: Map<number, KitBoxes[]>;
  /** Asset id -> the catalogue entry, without a linear scan. */
  readonly assetById: Map<number, { boxes?: KitBoxes; poses?: KitBoxes[] }>;
}

/**
 * The kit's two lookups, built once per kit rather than per call.
 *
 * `buildBoxes` runs a dozen times a cook — the repair loop measures
 * enclosure on every round — and it was rebuilding the pose map over all
 * the kit's placements and then doing a LINEAR `assets.find` per
 * placement, which is a few hundred times a few hundred comparisons for a
 * table that never changes. Keyed on the kit object, so a page that
 * switches vocabularies still gets the right one.
 */
const kitIndexCache = new WeakMap<Kit, KitIndex>();

function kitIndex(kit: Kit): KitIndex {
  const hit = kitIndexCache.get(kit);
  if (hit) return hit;

  // EVERY POSE OF EACH ASSET, gathered from the kit's own
  // instances. The format states no rotation, so an asset has one
  // representative box set and drawing every copy from it stamps the same
  // object at the same yaw all the way round the lap. But each instance's
  // boxes are correct, and on this kit 362 of them give 361 distinct
  // sets — the yaw the format does not state, surviving in the shapes.
  const poseOf = new Map<number, KitBoxes[]>();
  for (const pl of (kit.placements ?? []) as unknown as {
    asset: number;
    boxes?: KitBoxes;
  }[]) {
    if (!pl.boxes?.length) continue;
    const list = poseOf.get(pl.asset) ?? [];
    list.push(pl.boxes);
    poseOf.set(pl.asset, list);
  }

  const assetById = new Map<number, { boxes?: KitBoxes; poses?: KitBoxes[] }>();
  for (const a of kit.assets as unknown as (PlaceableAsset & {
    boxes?: KitBoxes;
    poses?: KitBoxes[];
  })[]) {
    assetById.set(a.id, a);
  }

  const index: KitIndex = { poseOf, assetById };
  kitIndexCache.set(kit, index);
  return index;
}

/**
 * EXPORTED FOR THE GRAPH COMPARISON, and for nothing else in the demo.
 *
 * `tests/racetrackDressGraph.test.ts` checks `dressGraph.ts`'s box build
 * against this one, and since L-1's cull now runs inside that graph the
 * reference has to be built from the list the cull LEFT rather than from
 * the one `dressLap` happened to finish with. Taking `dressing.boxes`
 * instead would compare boxes built from two different placement lists
 * and read the difference as a box-building defect.
 */
export function buildBoxes(
  kit: Kit,
  lap: Lap,
  placements: readonly StationedPlacement[],
  seed = 1,
): PlacedBox[] {
  const W = lap.halfWidth;
  const frameAt = frameLookup(lap);
  const boxes: PlacedBox[] = [];

  const { poseOf, assetById } = kitIndex(kit);
  for (const p of placements) {
    const frame = frameAt(p.station, p.t, p.h);
    const kitAsset = assetById.get(p.asset.id);

    // A POSE PER COPY, NOT ONE POSE PER ASSET.
    //
    // The format states no rotation, so an asset carries ONE
    // representative box set — and drawing every copy from it stamps the
    // same object at the same yaw all the way round the lap, which is
    // what made the generated dressing read as wrongly placed beside the
    // catalogue's own placements. But every INSTANCE carries its own
    // correct boxes, and on this kit 362 instances give 361 distinct box
    // sets: the yaw the format does not state is still there, in the shapes.
    //
    // So the vocabulary keeps them as `poses` and a placement draws one.
    // It is the catalogue used as what it is — a library of poses —
    // rather than a layout, which is the part that stays behind.
    const poses = poseOf.get(p.asset.id) ?? kitAsset?.poses;
    const pose =
      poses && poses.length > 0
        ? poses[
            (p.pose ?? Math.floor(rand(seed, Math.round(p.station * 97), 0x7053) * poses.length)) %
              poses.length
          ]
        : (kitAsset?.boxes ?? []);
    for (const b of pose) {
      const c = [
        ((b.min[0] + b.max[0]) / 2) * W,
        ((b.min[1] + b.max[1]) / 2) * W,
        ((b.min[2] + b.max[2]) / 2) * W,
      ];
      boxes.push({
        centre: [
          frame.p[0] + frame.across[0] * c[0] + frame.dir[0] * c[1] + frame.up[0] * c[2],
          frame.p[1] + frame.across[1] * c[0] + frame.dir[1] * c[1] + frame.up[1] * c[2],
          frame.p[2] + frame.across[2] * c[0] + frame.dir[2] * c[1] + frame.up[2] * c[2],
        ],
        size: [
          Math.max((b.max[0] - b.min[0]) * W, 1e-3),
          Math.max((b.max[1] - b.min[1]) * W, 1e-3),
          Math.max((b.max[2] - b.min[2]) * W, 1e-3),
        ],
        basis: { across: frame.across, along: frame.dir, up: frame.up },
        role: b.role ?? "mass",
        cover: p.cover === true,
        thickness: b.thickness ?? 0,
      });
    }
  }
  return boxes;
}

/**
 * Did Z-1 actually move this, or is it an epsilon?
 *
 * A REPAIR THAT CANNOT TELL ITS OWN NO-OP NEVER SETTLES. The corridor
 * resolution sets a base of exactly 1.2W, and a placement stores its
 * CENTRE — so the next round recovers the base as `h - tall/2` and gets
 * 1.1999999999999997, which is below the ceiling, so the rule fires
 * again. And again.
 *
 * Traced on one lap: rounds three to twelve did nothing but this, one
 * phantom fix per round, on a lap where every rule had been satisfied
 * since round two. The stat line read 56 mix moves against 23 corridor
 * fixes and NOT CONVERGED, which looks exactly like an unresolved
 * conflict between Z-1 and Z-3 — I spent two changes treating it as one.
 * There was no conflict. There was a value that could not survive a
 * round trip through its own datum.
 *
 * AND THE 1e-9 THAT FIXED IT WAS AN f64 ANSWER TO AN f64 PROBLEM. The
 * residue it was sized against is the ~1e-16 an f64 round trip through
 * `h = base + tall/2` leaves behind. In f32 the same round trip leaves
 * about 1e-7 — a hundred times that epsilon — so every one of those
 * phantom fixes comes back the moment these rules are computed in
 * attribute columns, and this loop stops converging for exactly the
 * reason it did before, with exactly the misleading stat line.
 *
 * `SAME_PLACE_W` IS SIZED FOR THAT, AND IT COSTS NOTHING, because a
 * REAL Z-1 fix is never small. There are only two of them and both are
 * jumps: small art rises to the ceiling from wherever under it it was,
 * and large art goes from inside 1W out to `1 + across/2`, which is at
 * least half its own width away. Nothing in this rule moves a placement
 * by a ten-thousandth of a half-width, so nothing this threshold can
 * swallow is a fix at all — it is the ceiling failing to recognise
 * itself.
 */
function moved(fixed: { t: number; baseH: number }, t: number, baseH: number): boolean {
  return Math.abs(fixed.t - t) > SAME_PLACE_W || Math.abs(fixed.baseH - baseH) > SAME_PLACE_W;
}

/** How many corners are still correctly marked, and how many rulers hold. */
function legibilityHealth(
  placements: readonly StationedPlacement[],
  corners: readonly Corner[],
  markers: MarkerKit | undefined,
  lapW: number,
): { unmarked: number; brokenRulers: number } {
  if (!markers) return { unmarked: 0, brokenRulers: 0 };
  return {
    unmarked: cornerMarkersSatisfied(placements, corners, markers, lapW).missing.length,
    brokenRulers: brakingRulersSatisfied(placements, corners, markers, lapW).failures.length,
  };
}

/**
 * The lap as it reaches the corner language: stations, assets, Z-1.
 *
 * EXPORTED BECAUSE THE BOOKKEEPING'S INDICES NAME THIS LIST. A caller
 * cooking `DressOptions.bookkeeping` has to hand the graph exactly the
 * placements step 4 will see, and reproducing steps 1 to 3 on its own
 * would be a second spelling of Z-1 -- the kind of duplication that
 * agrees until the day it does not. `dressLap` calls this too, so there
 * is one definition and a caller re-running it gets the same list rather
 * than a similar one.
 *
 * CHEAP TO RE-RUN, which is what makes that arrangement honest rather
 * than merely tidy: it is a draw the caller already has plus one pure
 * function per placement, so the caller cooking it and `dressLap`
 * computing it again cost the same twice and cannot disagree.
 */
export function placementsBeforeLanguage(
  lap: Lap,
  seed: number,
  pool: readonly PlaceableAsset[],
  opts: DressOptions = {},
): { placements: StationedPlacement[]; corridorFixes: number } {
  const scale = opts.density ?? 1;
  const st =
    opts.stations ??
    makeStationsDetailed(
      lap.lengthW,
      seed,
      scale === 1 ? FITTED : { ...FITTED, density: FITTED.density * scale },
    );
  const chosen = opts.choices;
  if (chosen && chosen.length !== st.stations.length) {
    throw new Error(
      `dressLap: opts.choices has ${chosen.length} entries but there are ${st.stations.length} stations. They are parallel lists — entry i is the asset for station i — so they must come from the same cook; see assetGraph.cookLapPlacements, which returns both.`,
    );
  }
  let placements: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const p = chosen
      ? fromChoice(chosen[i], pool, i)
      : placeAsset(pool, bucketOf(radiusAtW(lap, s)), seed, i);
    if (p) placements.push({ ...p, station: s });
  }

  // Z-1, by size. The asset's own lateral distribution reaches inside the
  // corridor for some assets, which is what makes this reachable.
  let corridorFixes = 0;
  placements = placements.map((p) => {
    // Cover is placed clear of the corridor by construction — see
    // `coverPlacements`. Standing a tunnel rib off to the corridor edge
    // puts a hole in the roof over the racing line.
    if (p.cover) return p;
    const baseH = p.h - p.asset.size.tall / 2;
    const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
    if (!moved(fixed, p.t, baseH)) return p;
    corridorFixes++;
    return { ...p, t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
  });
  return { placements, corridorFixes };
}

/**
 * Dress a lap from a catalogue.
 *
 * The output is the same `PlacedBox` shape the reference layer produces,
 * so a page can draw generated dressing and the catalogue's own
 * placements with one renderer — which is the only way a viewer can
 * compare them fairly.
 */
export function dressLap(
  kit: Kit,
  lap: Lap,
  seed: number,
  opts: DressOptions = {},
): Dressing {
  const t0 = performance.now();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const frameAt = frameLookup(lap);
  const corners = cornersOf(lap);

  // 0. Reserve L-2 and L-3's vocabulary BEFORE anything is dressed --
  //    from the caller when it has already reserved, and from
  //    `reserveFor` when it has not. See `DressOptions.reservation`.
  const { markers, pool } = opts.reservation ?? reserveFor(kit, seed);
  const reserved = new Set(
    markers ? [markers.sharp.id, markers.open.id, markers.brake.id] : [],
  );

  // 1, 2 and 3: stations, assets and Z-1, all in one place because a
  //    caller cooking `opts.bookkeeping` needs exactly this list and must
  //    not have to build it a second way. See `placementsBeforeLanguage`.
  const staged = placementsBeforeLanguage(lap, seed, pool, opts);
  const st =
    opts.stations ??
    makeStationsDetailed(
      lap.lengthW,
      seed,
      (opts.density ?? 1) === 1
        ? FITTED
        : { ...FITTED, density: FITTED.density * (opts.density ?? 1) },
    );
  let placements: StationedPlacement[] = staged.placements;
  let corridorFixes = staged.corridorFixes;

  // WHERE THE EYES ARE, HOISTED ABOVE THE PLACEMENT AND NOT ONLY ABOVE THE
  // LOOP. L-3 now asks L-1's question at draw time — "would all three of
  // this ruler's marks clear the cone here" — and it has to ask it of the
  // SAME eye set the cull will use twenty lines below, or the two rules
  // disagree about what blocked means and the search buys nothing. One
  // list, built once, read by both.
  const eyes = defaultEyeStations(lap.lengthW);

  // 4. L-2 and L-3. Markers land outside the corridor by construction, so
  //    they do not need step 3 run again over them. Where each marker and
  //    each ruler mark GOES comes from the caller when a graph drew it;
  //    see `DressOptions.language`.
  //
  //    AND L-3 IS TOLD WHERE THE CONE IS. The brake mark is `immovable`,
  //    which is this pipeline's `dropRatherThanMove` and the page's
  //    `pushMax: 0` — a blocked mark is DELETED, not shoved out of line,
  //    because a braking reference in the wrong place is worse than none.
  //    The consequence is that L-1 can only ever take marks off a ruler,
  //    so the repair has to happen before the ruler is placed: this
  //    predicate is what lets `placeCornerLanguage` choose a lateral all
  //    three marks survive rather than one the cull will thin out. It is a
  //    box test on the reserved brake asset alone, since every mark on the
  //    lap is that asset at that size.
  const brakeClear = markers
    ? (mark: { station: number; t: number; h: number }): boolean =>
        !blocksCone(
          {
            station: mark.station,
            t: mark.t,
            h: mark.h,
            across: markers.brake.size.across,
            along: markers.brake.size.along,
            tall: markers.brake.size.tall,
          },
          lap.lengthW,
          frameAt,
          lap.halfWidth,
          eyes,
        )
    : undefined;
  const lang = placeCornerLanguage(
    placements,
    corners,
    markers,
    lap.lengthW,
    seed,
    opts.language,
    opts.bookkeeping,
    brakeClear,
  );
  placements = lang.placements;

  // 5. L-4, which may not touch the reserved vocabulary.
  const marks = repairLandmarks(placements, pool, lap.lengthW, seed, reserved);
  placements = marks.placements;

  const before = legibilityHealth(placements, corners, markers, lap.lengthW);

  // 6-9. §9's step 12: VALIDATE, AND FEED EACH FAILURE BACK INTO THE PASS
  //      THAT OWNS IT. Run once through, these four repairs undo one
  //      another. The cull opens gaps, so coverage moves a placement into
  //      one — possibly into the cone the cull just cleared. The mix
  //      re-draws a placement with an asset from another band, which can
  //      be larger than the one it replaced and can block. Both change
  //      which assets appear exactly once, which is the whole of L-4. A
  //      single pass left 31 placements blocking the cone and a bare
  //      tenth of the lap, with every individual stage behaving
  //      correctly.
  //
  //      So the tail is a fixed point rather than a sequence. It is
  //      bounded, and whether it converged is reported rather than
  //      assumed: a repair loop that silently ran out of rounds would
  //      leave a lap breaking a threshold with a stat line full of
  //      plausible numbers.
  let rounds = 0;
  let blocked = 0;
  let pushedOut = 0;
  let dropped = 0;
  let coverageMoves = 0;
  let landmarkFixes = 0;
  let mixMoves = 0;
  let worstGapW = 0;
  let coverStretches = 0;
  let coverPieces = 0;
  let plannedEnclosure = 0;
  let enclosureBefore = -1;
  let enclosureTrims = 0;
  let enclosureRunsTrimmed = 0;
  let enclosureBlocked = false;
  let enclosureNothingToTrim = false;
  let edgeMoves = 0;
  let edgesFound = 0;
  let converged = false;
  while (rounds < MAX_REPAIR_ROUNDS) {
    rounds++;
    // Z-1 FIRST, OVER WHAT THE PREVIOUS ROUND'S MIX DREW. The `over` band is |t| < 1W,
    // which is the corridor — so satisfying Z-3's floor for it means
    // deliberately drawing assets whose own lateral sits there, and
    // `placeAsset` then gives them their own HEIGHT, which for
    // most of them is about half a half-width. That is an object in the
    // middle of the road at knee height. Z-1 ran at step 3 and never saw
    // them, because they did not exist yet; nine per lap survived to the
    // finished dressing, sitting on the racing line.
    //
    // `over` does not mean "in the corridor", it means SPANNING it, and
    // resolving them here is what makes that true.
    //
    // IT RUNS BEFORE THE CULL, and the order is the whole of it. Z-1
    // stands a large piece off to the corridor EDGE and no further, by
    // rule — but half its width still overhangs the corridor, so the
    // cone can still be blocked. Running Z-1 after the cull put the two
    // rules in a loop: the cull pushed a piece clear, Z-1 pulled it back
    // to the edge, and the lap finished with eight objects on the racing
    // line and a repair count that had settled. §9 gives L-1 the last
    // word, so L-1 goes last.
    let fixedThisRound = 0;
    placements = placements.map((p) => {
      if (p.cover) return p;
      const baseH = p.h - p.asset.size.tall / 2;
      const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
      if (!moved(fixed, p.t, baseH)) return p;
      fixedThisRound++;
      return { ...p, t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
    });
    corridorFixes += fixedThisRound;


    const cull = cullSightlines(
      placements.map((p) => ({
        station: p.station,
        t: p.t,
        h: p.h,
        across: p.asset.size.across,
        along: p.asset.size.along,
        tall: p.asset.size.tall,
        src: p,
      })),
      lap.lengthW,
      frameAt,
      lap.halfWidth,
      eyes,
      (o) => markers !== undefined && o.src.asset.id === markers.brake.id,
    );
    placements = cull.kept.map((o) => ({ ...o.src, t: o.t, h: o.h, station: o.station }));
    blocked += cull.blocking;
    pushedOut += cull.moved;
    dropped += cull.dropped;

    // L-6, AS A TOP-UP AND AFTER THE CULL.
    //
    // §9 puts enclosure at step 5 and places it before anything else is
    // dressed, which assumes cover comes only from the enclosure pass. It
    // does not: measured by ray cast, the ordinary dressing on an
    // overhead-rich kit already runs a fifth to a third of the lap under
    // something, from nothing but the per-asset placement of a vocabulary
    // that happens to be half overhead pieces.
    //
    // AND IT HAS TO BE MEASURED HERE RATHER THAN BEFORE THE CULL. On the
    // enclosed kit — the only one of the three with enough overhead to
    // show it — the first round reads 26.1% to 28.4% before the cull and
    // 22.1% to 23.3% after it, over seeds 1-3: L-1 pushes overhead pieces
    // outward and takes four to six points of enclosure with them, on
    // every seed. Topping up against the pre-cull figure adds nothing and
    // then watches the cull open the roof, which is the same mistake as
    // repairing coverage against a lap the cull has not run on yet.
    //
    // THE FIGURES USED TO READ 34.2% AND 24.8%, "nine points", and were
    // retaken on 2026-08-28 when Z-3's donor order changed which asset
    // stands at each station — enclosure is a ray cast over the boxes
    // those assets decompose into, so it moved with them. The gap narrowed
    // and the argument did not: the cull still opens several points of
    // roof on every seed, which is the whole of why the measurement is
    // taken on this side of it.
    //
    // WHAT IT SUPPLIES IS THE TAIL, NOT THE TOTAL. That incidental cover
    // is fifty-odd SHORT stretches with a heavy-tail share of ZERO, where
    // the vocabulary holds 39% of its covered length in the few longer than
    // 10W. The total can be right while the shape is wrong: what the
    // dressing never produces on its own is a tunnel.
    const already = measureEnclosure(lap, buildBoxes(kit, lap, placements, seed));
    if (enclosureBefore < 0) enclosureBefore = already.share;
    const coveredW = already.share * lap.lengthW;
    const budgetW = longCoverBudgetW(coveredW, already.heavyTailShare * coveredW, lap.lengthW);
    let addedCover = 0;
    let coverChangedPlacements = false;
    if (budgetW > 0 && opts.enclosure !== "deferred") {
      const add = placeEnclosure(
        all,
        lap.lengthW,
        corners,
        (st) => radiusAtW(lap, st),
        seed + rounds,
        budgetW,
        LONG_QUANTILE,
      );
      coverChangedPlacements = add.placements.length > 0;
      placements = [...placements, ...add.placements.map((p) => ({ ...p, cover: true as const }))];
      coverStretches += add.plans.length;
      coverPieces += add.placements.length;
      plannedEnclosure += add.plannedShare;
      addedCover = add.plans.length;
    }

    // And the other end of the range. See `reduceEnclosure`: on a kit
    // whose vocabulary is half overhead pieces the dressing sails past
    // L-6's ceiling with no enclosure pass having run at all, and no
    // amount of adding fixes a lap that already has too much roof.
    //
    // DEFERRED SKIPS THIS TOO, which is the whole of L-6 standing aside
    // rather than half of it -- see {@link DressOptions.enclosure}.
    //
    // ZERO MOVES WHEN IT DID NOT RUN, which is what the settle test below
    // reads: a round is settled when nothing moved, and a rule that stood
    // aside moved nothing.
    let trimMoves = 0;
    if (opts.enclosure !== "deferred") {
      const reduce = reduceEnclosure(
        placements,
        (ps) => measureEnclosure(lap, buildBoxes(kit, lap, ps, seed)),
        Math.ceil(Z3.over.rule[0] * placements.length),
        // `already` IS this measurement whenever the top-up added nothing,
        // which is most rounds. Handing it over skips a rebuild of every
        // box on the lap plus a ray cast per frame — the single most
        // expensive thing this pipeline does.
        coverChangedPlacements ? undefined : already,
      );
      placements = reduce.placements;
      trimMoves = reduce.moves;
      enclosureTrims += reduce.moves;
      enclosureRunsTrimmed += reduce.runsTrimmed;
      if (reduce.blockedByBandMix) enclosureBlocked = true;
      if (reduce.nothingToTrim) enclosureNothingToTrim = true;
    }

    // D-4, on the lap the cull actually left. The station process
    // enforces coverage too, but at step 1 — before a single one of the
    // gaps it is meant to close has been opened. It matters: under a
    // UNIFORM thinning D-4 barely ever breaks, but this cull is not
    // uniform, it empties contiguous stretches, and against a 26W
    // emptied stretch the limit is breached on every lap of eight by up
    // to 17W.
    //
    // Markers are protected. A marker moved to close a gap is a corner
    // that no longer announces itself, and there are three hundred other
    // placements to move instead.
    const cov = repairPlacementCoverage(placements, lap.lengthW, {
      protect: (p) => reserved.has(p.asset.id) || p.cover === true,
    });
    placements = cov.placements;
    coverageMoves += cov.moves;
    worstGapW = cov.worstGapAfterW;

    // L-4 after them, because both change which assets appear once.
    const marks = repairLandmarks(placements, pool, lap.lengthW, seed + rounds, reserved);
    placements = marks.placements;
    landmarkFixes += marks.moves;

    // L-5, before the mix, because breaking an edge lowers a placement
    // out of the verge band and Z-3 has to see the lap that leaves.
    const edges = repairFalseEdges(placements, lap.lengthW);
    placements = edges.placements;
    edgeMoves += edges.moves;
    edgesFound += edges.before;

    // Z-3 next, against the lap that actually exists.
    // LANDMARKS ARE PROTECTED FROM THE MIX, for the same reason markers
    // are: L-4 is a THRESHOLD and Z-3 is a distribution, and a threshold
    // outranks a distribution when they cannot both be had.
    //
    // Left unprotected they fight. The mix re-draws a placement's asset,
    // which either takes a landmark away or adds a second copy of one
    // elsewhere — and uniqueness is a property of the whole lap, so
    // either move destroys it. L-4 restores it, the mix breaks it again,
    // and the loop ran out at six rounds with 61 mix moves and a bare
    // tenth. Protecting by ASSET ID covers both directions: a landmark
    // cannot be donated away, and no second copy of one can be drawn in.
    //
    // ONE PER TENTH, not every unique asset: see `landmarkAssets`.
    // Protecting all of them withholds 71 to 79 assets of a 226-asset pool
    // from the mix -- re-measured over seeds 1-6 on 2026-08-28, where it
    // read 94 of 229 before Z-3's donor order changed which assets a lap
    // ends up carrying once. Roughly a third of the pool either way, which
    // leaves Z-3 unable to reach its bands at all.
    const protectIds = new Set(reserved);
    for (const id of landmarkAssets(placements, lap.lengthW)) protectIds.add(id);

    const mix = repairBandMix(
      placements,
      pool,
      seed + rounds,
      "centre",
      protectIds,
      (p) => p.cover === true,
    );
    placements = mix.placements.filter((p): p is StationedPlacement => p !== undefined);
    mixMoves += mix.moves;

    // GUARDED BECAUSE THIS FILE RUNS IN A BROWSER TOO, and `process` is
    // not defined there. The trace is a Node-side aid -- it is read when a
    // test or a script wants the per-round repair counts -- but `dressLap`
    // is on the page's critical path, so a bare `process.env` here is a
    // ReferenceError that takes the demo down before it draws anything.
    //
    // It survived a long time because nothing that is CHECKED ever hit it:
    // the production build rewrites `process.env` to `{}`, so the captured
    // screenshots, the published pages and the tests all take a dead
    // branch, and only `npm run examples` -- the dev server, which does no
    // such rewrite -- actually evaluates the identifier.
    if (typeof process !== "undefined" && process.env.ROAD_TRACE) {
      console.log(
        `  round ${rounds}: corridor=${fixedThisRound} cull=${cull.blocking} cover+=${addedCover} ` +
          `trim=${trimMoves} cov=${cov.moves} L4=${marks.moves} L5=${edges.moves} mix=${mix.moves}`,
      );
    }
    if (
      cull.blocking === 0 &&
      cov.moves === 0 &&
      marks.moves === 0 &&
      mix.moves === 0 &&
      edges.moves === 0 &&
      fixedThisRound === 0 &&
      addedCover === 0 &&
      trimMoves === 0
    ) {
      converged = true;
      break;
    }
  }

  const after = legibilityHealth(placements, corners, markers, lap.lengthW);

  const boxes = buildBoxes(kit, lap, placements, seed);

  // The same two halves the loop's own `protectIds` is built from, over
  // the list as it finished. See `Dressing.mixPinned`.
  const mixPinned = new Set(reserved);
  for (const id of landmarkAssets(placements, lap.lengthW)) mixPinned.add(id);

  return {
    boxes,
    placements,
    corners,
    markers,
    mixPinned,
    pool,
    stats: {
      placed: placements.length,
      perW: placements.length / lap.lengthW,
      stationGapRepairs: st.gapRepairs,
      coverageMoves,
      worstGapW,
      corridorFixes,
      corners: lang.corners,
      tightCorners: lang.tightCorners,
      markersConverted: lang.converted,
      markersAdded: lang.added,
      brakeMarks: lang.brakeAdded,
      rulersStepped: lang.rulersStepped,
      rulersFellBack: lang.rulersFellBack,
      brakeDisplaced: lang.brakeDisplaced,
      blocked,
      pushedOut,
      dropped,
      rounds,
      converged,
      markersLostToCull: Math.max(0, after.unmarked - before.unmarked),
      rulersLostToCull: Math.max(0, after.brokenRulers - before.brokenRulers),
      coverStretches,
      coverPieces,
      plannedEnclosure,
      enclosureTrims,
      enclosureRunsTrimmed,
      enclosureBlocked,
      enclosureNothingToTrim,
      falseEdges: edgesFound,
      edgeMoves,
      enclosureBefore: Math.max(0, enclosureBefore),
      enclosureAfter: measureEnclosure(lap, boxes).share,
      landmarkFixes: marks.moves + landmarkFixes,
      mixMoves,
      cookMs: performance.now() - t0,
    },
  };
}
