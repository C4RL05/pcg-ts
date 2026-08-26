/**
 * Level 1's first three stages, checked against the TypeScript they mirror.
 *
 * WHAT THIS SUITE IS FOR. `demos/racetrack/dressGraph.ts` states box
 * building, Z-1 and the enclosure measurement as a pcg-ts graph. Those
 * three already exist as synchronous TypeScript over a cooked `Lap`
 * (`buildBoxes` in `dress.ts`, `resolveCorridor` in `zones.ts`,
 * `enclosureMask` in `enclosure.ts`) and that TypeScript is not going
 * anywhere yet — so there are two implementations of one rule, and the
 * only thing that makes the second one worth having is checking it
 * against the first. A comment claiming "same convention" would be just
 * as convincing while being wrong about which axis is which.
 *
 * AND THE TWO DO NOT AGREE EXACTLY, FOR THREE REASONS THAT ARE WORTH
 * TELLING APART. Each has its own tolerance below, derived rather than
 * tuned, and each is measured and reported so that it fails loudly if it
 * gets worse instead of quietly widening a bound:
 *
 *   1. f32 STORAGE. Every attribute column is f32 where the TypeScript is
 *      f64. At this lap's world scale a position is worth about 3e-4 of
 *      f32 spacing on its own, which sets the floor for anything measured
 *      in world units.
 *   2. THE FRAME SHEAR. `poseAt` lerps `across`, `along` and `up` between
 *      two frames and renormalizes each INDEPENDENTLY, so the triple is
 *      mutually orthogonal only to about 1.9e-4 over these four seeds —
 *      worst where the track turns hardest, and the same effect
 *      `tests/racetrackSpawn.test.ts` measured at 1.6e-4 on one of them.
 *      `buildBoxes` uses those three vectors as they are.
 *      `orientAlongVector` cannot: it carries the frame as a QUATERNION,
 *      which can only express a rotation, so it rebuilds `across` from
 *      `up x along` and the shear is projected away. That moves a box's
 *      CENTRE by up to its own local offset times the shear, which is the
 *      largest of the three effects and the only one that grows with the
 *      geometry. `tests/racetrackSpawn.test.ts` found the same difference
 *      from the other side.
 *   3. SUMMATION ORDER, in the enclosure share alone: the same per-frame
 *      arc lengths added in frame order here and grouped into runs there.
 *
 * WHAT IS NOT ALLOWED TO DIFFER AT ALL: the number of boxes, the order
 * they come out in, which Z-1 branch fired, which placements L-1 kept,
 * which of them it pushed rather than dropped, and the covered mask frame
 * by frame. Those are decisions rather than values, and a decision that
 * disagrees is a defect however small the number behind it was.
 *
 * L-1 IS COMPARED AGAINST THE SAME EYES, WHICH IS THE ONLY WAY THE
 * COMPARISON MEANS ANYTHING. `occlusionCull` takes its eyes from the
 * points of the sight path, and the graph hands it the lap's 900 frames;
 * `cullSightlines` takes an eye list as an argument and `dressLap` gives
 * it one every 2W. Comparing those two directly would measure the
 * SAMPLING and report it as a cull defect, so every reference cull here is
 * given the frames' own stations. That the two sampling rates disagree is
 * a finding in its own right and gets its own test rather than being
 * folded into a tolerance.
 */
import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { Graph, cook, firstGeometry, type DataCollection, type Geometry } from "pcg-ts";
import {
  DRESS_OUTPUTS,
  COVER,
  buildDressGraph,
  buildRoundGraph,
  dressLapByGraph,
  type GraphDressing,
} from "../demos/racetrack/dressGraph.js";
import { buildBoxes, dressLap, frameLookup } from "../demos/racetrack/dress.js";
import { readLap, type Lap } from "../demos/racetrack/lap.js";
import { dressedLapFor } from "./support/lap.js";
import { buildRoadGraph, OUTPUTS } from "../demos/racetrack/graph.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { ENCLOSURE, enclosureMask, measureEnclosure } from "../demos/racetrack/enclosure.js";
import { resolveCorridor } from "../demos/racetrack/zones.js";
import { FALSE_EDGE, falseEdges, repairFalseEdges } from "../demos/racetrack/falseEdges.js";
import {
  SIGHTLINE,
  cullSightlines,
  defaultEyeStations,
  type CullResult,
  type Occluder,
} from "../demos/racetrack/sightline.js";
import { SAME_PLACE_W, SAME_STATION_W } from "../demos/racetrack/tolerance.js";
import { bucketOf, placeAsset, type PlaceableAsset } from "../demos/racetrack/assets.js";
import { radiusAtW } from "../demos/racetrack/corners.js";
import { reserveMarkers, type StationedPlacement } from "../demos/racetrack/legibility.js";
import { FITTED, makeStationsDetailed } from "../demos/racetrack/stations.js";
import type { PlacedBox } from "../demos/racetrack/kit.js";

/** The seeds every comparison runs over. Four laps, not one. */
const SEEDS = [1, 2, 3, 4] as const;

/**
 * How long a four-lap comparison may take.
 *
 * STATED, BECAUSE THE DEFAULT IS FIVE SECONDS AND THE HEAVY TESTS HERE
 * WANT TWO TO THREE OF THEM ON AN IDLE MACHINE. Each cooks four road
 * graphs, dresses four laps to a fixed point, runs the same fixed point
 * again as a TypeScript reference, and — in the box test — cooks a graph
 * that stamps three million points to keep eight thousand. Run alone they
 * finish in about half the default; run inside the full suite, against
 * every other file's workers, they do not.
 *
 * A TIMEOUT IS NOT A TOLERANCE, so this is not tuned to what was observed:
 * it is far enough above it that machine load decides nothing, which is
 * the only property a timeout should have. What would be wrong is leaving
 * the default and letting a green suite depend on how busy the box was —
 * the failure that prompted this looked exactly like a regression and was
 * not one.
 */
const FOUR_LAP_MS = 60_000;

/**
 * The largest mutual non-orthogonality the interpolated track frame has.
 *
 * NOT A TOLERANCE — a claim about `poseAt`, and every other constant in
 * this file is derived FROM it, which is why it is stated first. Measured
 * at 1.92e-4 over these four laps, against 1.62e-4 for seed 1 alone in
 * `tests/racetrackSpawn.test.ts`.
 *
 * THE SAME 5e-4 THAT SUITE PINS, AND DELIBERATELY SO EVEN THOUGH IT
 * LEAVES HEADROOM. There is one fact here — how far `poseAt`'s
 * independently renormalized axes are from orthogonal — and two suites
 * that depend on it, so it is one number in two places rather than two
 * numbers that can drift apart while both look reasonable. The headroom
 * is what a bound on a measured maximum needs to survive a fifth seed,
 * and the actual figure is printed on every run, so a drift toward the
 * bound is visible long before it fails.
 */
const MAX_FRAME_SKEW = 5e-4;

/** The f32 spacing at a magnitude — the floor under anything stored f32. */
const ulp = (v: number): number => Math.max(Math.abs(v), 1) * 2 ** -23;

/**
 * How far one box centre may sit from the other — PER BOX, not one number.
 *
 * A SINGLE CONSTANT WOULD HAVE TO BE THE WORST CASE EVERYWHERE, and the
 * worst case here is thirty times the typical one: the shear term scales
 * with a box's own arm, which runs from nothing to fifty-odd world units
 * on this vocabulary. A flat bound sized for the longest arm is slack of
 * two orders for every short one, and a box that moved for a real reason
 * would sail through it. So the bound is derived at each box from the two
 * quantities that actually produce the difference:
 *
 *   - `4 * ulp(...)` — the f32 storage floor. Taken at the LARGER of the
 *     box's coordinate and its PLACEMENT's, which is the part that is
 *     easy to get wrong: the composition reads a target position stored
 *     as f32 and adds a rotated offset to it, so the rounding that
 *     reaches the answer is the one at the TARGET's magnitude, not at the
 *     result's. A box whose arm nearly cancels its placement's coordinate
 *     has a centre near zero and a target fifty units out, and a floor
 *     read off the centre alone would be an order too small there. Four
 *     spacings, not one: `tolerance.ts` argues that sizing an epsilon at
 *     one ulp is the same mistake as sizing it at zero, one round of
 *     arithmetic later.
 *   - `arm * MAX_FRAME_SKEW` — the shear the quaternion projects away,
 *     acting on the lever it is turned through. This is the whole
 *     difference for any box more than a few units off its placement.
 *
 * Nothing in it was fitted: both terms are properties of the storage and
 * of `poseAt`, and the test reports how much of the bound was actually
 * used so that a change which starts eating the margin is visible before
 * it fails.
 */
const centreBound = (centre: number, placement: number, arm: number): number =>
  4 * ulp(Math.max(Math.abs(centre), Math.abs(placement))) + arm * MAX_FRAME_SKEW;

/**
 * How far apart two world extents may be.
 *
 * AN EXTENT NEVER PASSES THROUGH THE FRAME, so the shear does not reach
 * it and this is f32 alone. The extent makes two f32 round trips — the
 * pose library keeps its half-widths, the placement multiplies by the
 * half-width — over a value that reaches about 100 world units on this
 * vocabulary, where f32 spacing is 8e-6. 1e-4 is thirteen spacings there
 * and four orders below the smallest real mistake this could hide: a
 * floor applied in the wrong units moves a sheet by 1e-3 exactly, and
 * forgetting the half-width scales every extent by nine.
 */
const EXTENT_TOL = 1e-4;

/**
 * How far apart two frame axes may be, component by component.
 *
 * THIS IS THE SHEAR AND NOTHING ELSE, which is why the bound is
 * `MAX_FRAME_SKEW` itself rather than a round number above it. The
 * graph's three axes are orthonormal by construction and the
 * TypeScript's are not; to first order the angle between the two
 * versions of an axis IS the triple's non-orthogonality, so a bound of
 * the skew plus f32 room is a claim about what the difference is, not a
 * budget for it. On a UNIT vector, a swapped or mirrored axis differs by
 * 1 or 2 — three orders clear.
 */
const AXIS_TOL = MAX_FRAME_SKEW + 1e-5;

/**
 * How far apart the two enclosure shares may be.
 *
 * The masks are compared frame by frame and must agree EXACTLY, so this
 * covers only the summation-order difference in adding one arc length per
 * covered frame — a handful of f64 ulps on a number of order 0.1. 1e-9 is
 * enormously more than that and enormously less than one frame's worth of
 * lap, which on 900 frames is about 1e-3 of the share: a bound that
 * cannot be met by a mask that differs anywhere.
 */
const SHARE_TOL = 1e-9;

/**
 * The shared fixture, memoized across the whole suite — see
 * `tests/support/lap.ts` for why it is not spelled out here.
 */
const cookLap = dressedLapFor;

/** The three axes a `rot` quaternion stands for, as the box basis. */
function axesOf(rot: Float32Array | ArrayLike<number>, i: number): {
  across: Vector3;
  along: Vector3;
  up: Vector3;
} {
  const q = new Quaternion(rot[i * 4], rot[i * 4 + 1], rot[i * 4 + 2], rot[i * 4 + 3]);
  return {
    across: new Vector3(1, 0, 0).applyQuaternion(q),
    along: new Vector3(0, 1, 0).applyQuaternion(q),
    up: new Vector3(0, 0, 1).applyQuaternion(q),
  };
}

const worstAxis = (want: readonly number[], got: Vector3): number =>
  Math.max(Math.abs(want[0] - got.x), Math.abs(want[1] - got.y), Math.abs(want[2] - got.z));

/**
 * The placement list as it stands BEFORE Z-1 has ever run.
 *
 * REBUILT RATHER THAN TAKEN FROM THE DRESSING, and the difference is the
 * whole value of the corridor test. `dressLap` returns a list Z-1 has
 * already settled, so running the rule over it is a check that nothing
 * moves — necessary, and vacuous on its own. The population that actually
 * exercises both branches is the one at step 2: assets placed from their
 * OWN measured lateral distributions, 32 of which reach inside 1W. This
 * repeats steps 0 to 2 of `dressLap` from the same exported pieces, which
 * is why it can only be assembled here and not asked for.
 */
function beforeCorridor(lap: Lap, seed: number): StationedPlacement[] {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const { pool } = reserveMarkers(all, seed);
  const st = makeStationsDetailed(lap.lengthW, seed, FITTED);
  const out: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const p = placeAsset(pool, bucketOf(radiusAtW(lap, s)), seed, i);
    if (p) out.push({ ...p, station: s });
  }
  return out;
}

/**
 * `dressLap`'s step 3, stated as the reference for the graph's Z-1.
 *
 * AND THE TWO ARE NOT THE SAME PREDICATE, WHICH IS WHY THE BRANCH IS
 * ASSERTED SEPARATELY BELOW. `resolveCorridor` tests the corridor volume
 * with no tolerance; `writeCorridor` slacks every rung by `SAME_PLACE_W`,
 * because in f32 the round trip through `base = h - tall/2` puts an
 * overhead placement's base a few parts in ten million under a ceiling it
 * is sitting exactly on, and the untolerated rule then stands every
 * gantry off to the verge. So this comparison is a claim about the
 * POPULATION — that nothing on these four laps sits inside the slack —
 * rather than a claim that the two spellings are interchangeable. It is
 * the claim `tolerance.ts` sized `SAME_PLACE_W` to support, and 1300
 * placements is enough of a sample to make it worth stating.
 */
function corridorReference(p: StationedPlacement): { t: number; h: number } {
  if (p.cover) return { t: p.t, h: p.h };
  const baseH = p.h - p.asset.size.tall / 2;
  const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
  const moved =
    Math.abs(fixed.t - p.t) > SAME_PLACE_W || Math.abs(fixed.baseH - baseH) > SAME_PLACE_W;
  if (!moved) return { t: p.t, h: p.h };
  return { t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
}

/**
 * Every frame's own station, in W — the eye set the graph's cull uses.
 *
 * NOT `defaultEyeStations`, and the difference is the subject of its own
 * test below. `occlusionCull` cannot be told to use one spacing for its
 * eyes and another for its targets, so handing it the lap frames fixes
 * both at the frame resolution; a reference cull that wants to check the
 * NODE rather than the sampling has to stand in the same places.
 */
function frameStationsOf(lap: Lap): number[] {
  const out: number[] = [];
  for (let i = 0; i < lap.count; i++) out.push(lap.s[i] / lap.halfWidth);
  return out;
}

/**
 * An occluder carrying where it came from, so a verdict can be traced.
 *
 * `id` IS THE INDEX IN THE LIST THE GRAPH WAS HANDED, matching the
 * `placementId` column the cloud carries — which is the only thing the two
 * sides can be compared by once the cull has removed something. Neither
 * the station nor the asset is unique enough: two placements can share an
 * asset, and after a push two can share very nearly a lateral.
 */
type Traced = Occluder & { readonly id: number; readonly src: StationedPlacement };

const traced = (p: StationedPlacement, id: number): Traced => ({
  station: p.station,
  t: p.t,
  h: p.h,
  across: p.asset.size.across,
  along: p.asset.size.along,
  tall: p.asset.size.tall,
  id,
  src: p,
});

/**
 * The list the graph handed L-5: the survivors, at the laterals L-1 left.
 *
 * The twin of {@link readPlacements} one stage down, and it cannot be the
 * same function: L-1 REMOVES points, so the cloud is shorter than the
 * source and `placementId` is the only thing that still says which
 * placement each survivor was.
 */
function readCulled(
  cloud: Geometry,
  src: readonly StationedPlacement[],
): StationedPlacement[] {
  const t = cloud.attrs.point.require("trackT");
  const h = cloud.attrs.point.require("trackH");
  const id = cloud.attrs.point.require("placementId");
  const out: StationedPlacement[] = [];
  for (let i = 0; i < cloud.pointCount; i++) {
    out.push({ ...src[id.get(i)], t: t.get(i), h: h.get(i) });
  }
  return out;
}

/**
 * The list the graph handed L-1: the input placements at Z-1's laterals.
 *
 * THE REFERENCE CULL STARTS FROM THE GRAPH'S OWN Z-1 ANSWER, so that a
 * cull comparison measures the cull. Rebuilding the input through
 * `resolveCorridor` instead would fold Z-1's f32 difference — up to
 * `SAME_PLACE_W` of lateral — into a BOOLEAN occlusion verdict, where it
 * can flip a grazing case and be reported as a cull disagreement. The
 * corridor test is what says that answer is right; this is entitled to
 * start from it.
 */
function readPlacements(
  cloud: Geometry,
  src: readonly StationedPlacement[],
): StationedPlacement[] {
  expect(cloud.pointCount, "the pre-cull cloud lost a placement").toBe(src.length);
  const t = cloud.attrs.point.require("trackT");
  const h = cloud.attrs.point.require("trackH");
  const id = cloud.attrs.point.require("placementId");
  return src.map((p, i) => {
    expect(id.get(i), "the pre-cull cloud reordered the list").toBe(i);
    return { ...p, t: t.get(i), h: h.get(i) };
  });
}

/**
 * L-3's ruler element, which L-1 must drop rather than shove out of line.
 *
 * DERIVED THE WAY `dressLap` DERIVES IT rather than read off the dressing:
 * `reserveMarkers` is a pure function of the asset list and the seed, so
 * calling it again returns the same three assets, and `beforeCorridor`
 * already relies on exactly that to rebuild the pool.
 */
function brakeOf(seed: number): Set<number> {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const id = reserveMarkers(all, seed).markers?.brake.id;
  return id === undefined ? new Set() : new Set([id]);
}

/**
 * Every asset id in the pool — which is how these cases switch Z-3 OFF.
 *
 * THROUGH THE RULE'S OWN PARAMETER AND NOT A MODE FLAG. The repair body
 * runs Z-1, L-1, L-5 and now Z-3, and every claim in this suite is about
 * the first three: a mix that redraws a placement mid-comparison is not
 * noise, it is a different lap. `mixPinned` is the set Z-3 may not take a
 * donor from, so pinning the whole pool leaves it with nothing to move and
 * the body reduces to exactly the three rules being measured. A second
 * spelling — a boolean on the body — would be a second thing to keep true.
 */
function noMix(seed: number): Set<number> {
  return new Set(dressingPool(seed).map((a) => a.id));
}

/**
 * The pool the dressing at this seed drew from — the same one `dressLap`
 * reserves, since `reserveFor` varies its MEMBERSHIP by seed and not its
 * length, so a pool from the wrong seed passes every range check.
 */
function dressingPool(seed: number): PlaceableAsset[] {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  return reserveMarkers(all, seed).pool;
}

/** `cullSightlines` over the graph's eye set — the reference for every L-1 claim here. */
function cullReference(
  lap: Lap,
  placements: readonly StationedPlacement[],
  immovable: ReadonlySet<number>,
): CullResult<Traced> {
  return cullSightlines(
    placements.map(traced),
    lap.lengthW,
    frameLookup(lap),
    lap.halfWidth,
    frameStationsOf(lap),
    (o) => immovable.has(o.src.asset.id),
  );
}

/**
 * How far apart the two laterals may be — PER PLACEMENT, not once.
 *
 * NOT A BUDGET FOR THE PUSH. The two searches walk the SAME ladder of
 * twelve half-W rungs, so a placement that cleared at rung three on one
 * side cleared at rung three on the other, and the laterals are the same
 * number rather than two numbers within a tolerance of a rung. Every bound
 * below is four orders under 0.5W, so nothing here could absorb a search
 * that disagreed about where a placement settled.
 *
 * THE DOMINANT TERM IS NOT THE LATERAL, WHICH IS WHY THIS IS NOT A
 * CONSTANT. `occlusionCull` computes the pushed position in f64 and stores
 * it in the f32 `P` column, so each component carries up to half a spacing
 * AT THE LAP'S WORLD SCALE — this circuit reaches 574 units from the
 * origin, where f32 is worth 6.8e-5 — and `pushW` recovers the distance by
 * projecting that position onto a unit `across`, which can gather all
 * three components. Dividing back into half-widths is the only thing that
 * shrinks it. So the bound scales with how far the TRACK is from the
 * origin over the half-width, and has nothing to do with how large a
 * lateral is.
 *
 * THIS WAS A CONSTANT, DERIVED FROM THE LATERAL'S OWN MAGNITUDE, AND THE
 * MEASUREMENT IT WAS MEANT TO EXPLAIN FALSIFIED IT. Two f32 writes of a
 * lateral at 7W allow 4.8e-7 between them; the suite reported 1.8e-6, near
 * four times that, so the account was wrong even where it passed. A
 * constant sized on this circuit would also have gone red on a larger one
 * with the two culls agreeing perfectly — and its own reasoning said that
 * was impossible, so it would have been read as a cull defect.
 *
 * The second term IS the lateral: `trackT` is written by the lift and
 * again by the push.
 *
 * Both terms take the FULL spacing where the error is at most half of one,
 * and sum three components where a unit projection reaches at most √3 of
 * them — about 3.5x of deliberate headroom on a bound that must never be
 * tightened to fit a measurement. The margin actually used is printed.
 */
const lateralBound = (lap: Lap, px: number, py: number, pz: number, t: number): number =>
  (ulp(px) + ulp(py) + ulp(pz)) / lap.halfWidth + 4 * ulp(t);

/**
 * The three repairs that have a fixed point, iterated as the graph iterates
 * them - the reference for the `repeatUntil` in `buildDressGraph`.
 *
 * NOT `dressLap`'s LOOP, AND THE DIFFERENCE IS THE POINT. That loop runs
 * eight repairs; five of them read a lap-wide measurement of the dressing
 * every earlier repair rewrote, or draw from `seed + rounds`, and one of
 * those does not terminate at all on the enclosed kit. The graph iterates
 * the three that answer from the list they were handed, so the honest
 * reference is those same three iterated the same way. Comparing against
 * `dressLap` would measure the five that are missing.
 *
 * THE SETTLE RULE IS THE GRAPH'S, restated here rather than imported,
 * because the whole claim is that two independent statements of it agree.
 * It counts SURVIVORS that moved and deliberately not placements the cull
 * removed - `writeSettleCount` argues why that is correct rather than
 * convenient, and the round counts here are what would catch it if it
 * were not.
 */
function repairReference(
  lap: Lap,
  start: readonly StationedPlacement[],
  immovable: ReadonlySet<number>,
  maxRounds = 12,
): { placements: StationedPlacement[]; rounds: number; converged: boolean } {
  // THE SAME NUMBERS THE GRAPH STARTS FROM, WHICH IS NOT THE SAME AS THE
  // SAME LIST. The graph's first act is to store this list in f32 columns,
  // so its Z-1 tests an f32 lateral where a f64 reference would test the
  // number the catalogue published. That difference is about 5e-7W — far
  // below any threshold here, and a BOOLEAN occlusion verdict does not
  // care how far below: a placement whose cone test is marginal can flip
  // on one side and not the other, and the symptom is a survivor-count
  // mismatch blamed on the loop. Rounding the start is what makes the two
  // sides comparable by construction rather than by luck; it is the guard
  // an earlier version of this file placed mid-chain, moved to the only
  // place a loop still has one.
  let list = start.map((p) => ({ ...p, t: Math.fround(p.t), h: Math.fround(p.h) }));
  let rounds = 0;
  let converged = false;
  for (let r = 0; r < maxRounds; r++) {
    rounds = r + 1;
    let moved = 0;

    list = list.map((p) => {
      const want = corridorReference(p);
      if (want.t === p.t && want.h === p.h) return p;
      moved++;
      return { ...p, t: want.t, h: want.h };
    });

    const cull = cullReference(lap, list, immovable);
    moved += cull.moved;
    list = cull.kept.map((o) => ({ ...o.src, t: o.t }));

    const edged = repairFalseEdges(list, lap.lengthW, 1);
    moved += edged.moves;
    list = edged.placements;

    if (moved === 0) {
      converged = true;
      break;
    }
  }
  return { placements: list, rounds, converged };
}

/** The one number on a value output, for the loop's `rounds`/`converged`. */
function numberOf(collection: DataCollection | undefined): number {
  for (const item of collection ?? []) {
    if (item.kind === "value" && typeof item.value === "number") return item.value;
  }
  throw new Error("expected a value item carrying a number");
}

/**
 * `buildBoxes` over the list L-1 left — the reference geometry for every
 * comparison that is about boxes rather than about the cull.
 *
 * TWO CALLERS AND ONE LIST, DELIBERATELY. The box test and the enclosure
 * test both need "what the TypeScript would have built from what the graph
 * decided", and building it twice from two slightly different lists is how
 * one of them ends up measuring the other's disagreement. It is still the
 * TYPESCRIPT'S boxes on both sides — `enclosureMask` must not be handed
 * the graph's geometry, or the box comparison folds into the coverage one
 * and neither says which half was wrong.
 *
 * IT RUNS THE WHOLE FIXED POINT, and the f32 guard that used to sit
 * mid-chain has moved to the start of it. This used to cull once from
 * `readPlacements(got.placed, ...)` so that both sides tested the same f32
 * laterals; now the graph iterates, there is no single mid-point to hand
 * over, and `repairReference` rounds its starting list to f32 instead. The
 * reason is unchanged and is worth keeping in view: an f32 lateral and an
 * f64 one reaching the same BOOLEAN occlusion verdict is luck, not a
 * property, and the symptom of that luck running out would be a survivor
 * count blamed on the box build.
 */
function referenceBoxes(
  lap: Lap,
  placements: readonly StationedPlacement[],
  immovable: ReadonlySet<number>,
  seed: number,
): PlacedBox[] {
  // THE WHOLE FIXED POINT, NOT ONE ROUND OF IT, since the graph now runs
  // the three repairs to convergence before it builds a box. A one-round
  // reference would differ by whatever the second round moved, and would
  // report it as a box-building defect.
  return buildBoxes(
    shippedVocabulary(),
    lap,
    repairReference(lap, placements, immovable).placements,
    seed,
  );
}

describe("racetrack dressing, as a graph", () => {
  it("restates L-6's measurement without changing it", () => {
    // Two independent statements of one measurement, pinned equal. The
    // independence is the point — `enclosure.ts` argues why a measurement
    // must not import the placement rules it is measuring — and so is the
    // pin, which is what would catch a hand edit to either.
    expect(COVER.corridorW).toBe(ENCLOSURE.corridorW);
    expect(COVER.rays).toBe(ENCLOSURE.rays);
    expect(COVER.floorW).toBe(ENCLOSURE.floorW);
    expect(COVER.ceilingW).toBe(ENCLOSURE.ceilingW);
    expect(COVER.minHits).toBe(ENCLOSURE.minHits);
  });

  it("lowers a false-edge member clear of the band, which is what lets the loop stop", () => {
    // THE MARGIN THE WHOLE FIXED POINT RESTS ON, AND NOTHING ELSE STATES IT.
    //
    // L-5's settle flag is `edgeDrop`, and `edgeDrop` marks the member the
    // rule SELECTED, not one it observed to have moved — re-selecting an
    // already-lowered member would set it again. The loop terminates only
    // because a lowered member leaves the edge band and so cannot be a run
    // member next round: the rule drops it to `heightW[0] - 0.05`, and the
    // band test is slacked outward by `SAME_PLACE_W`, so what actually has
    // to hold is that 0.05 is bigger than that slack.
    //
    // It is bigger by five hundred times today, so this looks like a
    // formality. It is not: retune the drop toward the floor — or widen
    // `SAME_PLACE_W`, which a later f32 finding could easily argue for —
    // and the loop spins to `maxRounds` reporting `converged: false` with
    // nothing actually moving, which is the hardest kind of failure to
    // read. This is the assertion that names the connection.
    const DROP_BELOW_FLOOR = 0.05;
    expect(DROP_BELOW_FLOOR).toBeGreaterThan(SAME_PLACE_W);
    // And the lowered height really is outside the slacked band test the
    // graph uses, which is the thing that has to be true.
    expect(FALSE_EDGE.heightW[0] - DROP_BELOW_FLOOR).toBeLessThan(
      FALSE_EDGE.heightW[0] - SAME_PLACE_W,
    );
  });

  it("runs the three repairs to the same fixed point the rules do", async () => {
    // WHAT ONLY A LOOP CAN BE WRONG ABOUT. Every other test here checks
    // one rule for one round. This checks the three things that are
    // properties of the iteration and of nothing inside it: that it
    // stops, that it stops in the same place the TypeScript does, and
    // that where it stopped is actually a fixed point.
    let seeds = 0;
    let totalRounds = 0;
    let worstT = 0;
    let worstMargin = 0;
    const perSeed: string[] = [];

    for (const seed of SEEDS) {
      const { lap, frames } = await cookLap(seed);
      const src = beforeCorridor(lap, seed);
      const immovable = brakeOf(seed);
      const g = buildDressGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: src,
        seed,
        immovable,
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      const out = (
        await cook(g, {
          outputs: [DRESS_OUTPUTS.placements, DRESS_OUTPUTS.rounds, DRESS_OUTPUTS.converged],
        })
      ).outputs;
      const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
      if (!after) throw new Error("the dress graph produced no placements");
      const rounds = numberOf(out[DRESS_OUTPUTS.rounds]);
      const converged = numberOf(out[DRESS_OUTPUTS.converged]) !== 0;

      const ref = repairReference(lap, src, immovable);
      seeds++;
      totalRounds += rounds;
      perSeed.push(`${seed}:${rounds}${converged ? "" : "!"}`);

      // IT SETTLED. A bounded repair that ran out is not a failed cook and
      // is not a pass either — it is a lap on which some rule is still
      // broken, which is exactly why the node reports it instead of
      // returning quietly.
      expect(converged, `seed ${seed}: the repair loop ran out of rounds`).toBe(true);
      expect(ref.converged, `seed ${seed}: the reference loop ran out of rounds`).toBe(true);

      // THE SAME NUMBER OF ROUNDS. This is the assertion that would catch
      // a settle signal counting the wrong thing: a loop that stopped one
      // round early or late would still land on the same answer here (the
      // extra round moves nothing) and only the count would say so.
      expect(rounds, `seed ${seed}: rounds`).toBe(ref.rounds);

      // AND THE SAME PLACE, member by member. The station is what says
      // WHICH placement each one is — see the comment on the comparison
      // itself — rather than `placementId`, which the reference has no way
      // to carry through three repairs that all rebuild their lists.
      expect(after.pointCount, `seed ${seed}: survivor count`).toBe(ref.placements.length);
      const kP = after.attrs.point.require("P");
      const kStation = after.attrs.point.require("stationW");
      const kT = after.attrs.point.require("trackT");
      const kH = after.attrs.point.require("trackH");
      for (let i = 0; i < after.pointCount; i++) {
        const want = ref.placements[i];
        // The station pins WHICH placement this is: it is drawn from a
        // continuous process and no repair in this body changes it, so two
        // lists agreeing on it position by position are the same list in
        // the same order. The lateral and the height are what the repairs
        // actually moved.
        expect(
          Math.abs(kStation.get(i) - want.station),
          `seed ${seed}: placement ${i} is a different placement`,
        ).toBeLessThan(SAME_STATION_W);
        // THE SAME MECHANISM THE CULL TEST DERIVES, TIMES THE ROUNDS.
        // `trackT` is not merely re-stored each round, it is RECOMPUTED:
        // L-1 recovers its push by projecting a world position onto
        // `across` and dividing by the half-width, so the lateral inherits
        // the f32 rounding of a coordinate at the lap's world scale. That
        // is `lateralBound`, and it dominates the lateral's own spacing by
        // two orders. Sizing this on `ulp(t)` instead passed at 98% of its
        // bound, which is a bound that has not understood what it is
        // bounding — the number it tracked was a coincidence of how far
        // this circuit happens to sit from the origin.
        const bound =
          rounds * lateralBound(lap, kP.get(i, 0), kP.get(i, 1), kP.get(i, 2), want.t);
        worstT = Math.max(worstT, Math.abs(kT.get(i) - want.t));
        worstMargin = Math.max(worstMargin, Math.abs(kT.get(i) - want.t) / bound);
        expect(Math.abs(kT.get(i) - want.t), `seed ${seed}: placement ${i} lateral`).toBeLessThan(
          bound,
        );
        // The height takes no such route — nothing recovers it from a
        // world position — so it is storage and arithmetic alone, four
        // spacings a round.
        expect(Math.abs(kH.get(i) - want.h), `seed ${seed}: placement ${i} height`).toBeLessThan(
          4 * rounds * ulp(want.h),
        );
      }

      // AND IT REALLY IS A FIXED POINT — of the GRAPH'S cloud, which is the
      // only version of this assertion that can fail. Running one more
      // reference round from `ref.placements` would be a tautology: the
      // reference has already been asserted to have converged, so its last
      // round moved nothing and a further round over the same list is the
      // same computation again. Reading the graph's own survivors back and
      // running the rule over THOSE is a claim about the graph.
      const again = repairReference(lap, readCulled(after, src), immovable, 1);
      expect(again.converged, `seed ${seed}: the settled lap is not a fixed point`).toBe(true);
    }

    console.log(
      `dress graph repair loop: ${seeds} seeds settled in ${perSeed.join(", ")} rounds ` +
        `(${(totalRounds / seeds).toFixed(2)} mean); "!" would mark one that ran out. ` +
        `Worst lateral ${worstT.toExponential(2)}W, using ${(worstMargin * 100).toFixed(1)}% ` +
        `of its per-round bound`,
    );
    // A LOOP THAT ALWAYS RAN ONCE WOULD NOT BE A LOOP. If every seed
    // settled in a single round the wrapper would be untested machinery,
    // so the suite says out loud that at least one lap needed a second.
    expect(totalRounds, "no lap needed more than one round").toBeGreaterThan(seeds);
  }, FOUR_LAP_MS);

  it("builds the same boxes buildBoxes does", async () => {
    let worstCentre = 0;
    let worstMargin = 0;
    let worstExtent = 0;
    let biggestExtent = 0;
    let worstAxisErr = 0;
    let worstSkew = 0;
    let worstOffset = 0;
    let total = 0;
    let cookMs = 0;
    let copies = 0;

    for (const seed of SEEDS) {
      const { lap, frames, dressing } = await cookLap(seed);
      // THE COMPARISON'S PREMISE, ASSERTED RATHER THAN ASSUMED. The graph
      // runs Z-1 over the list it is handed, so it can only reproduce
      // `buildBoxes`' boxes if that list is one Z-1 has already settled.
      // `dressLap` settles it by running to a fixed point — unless it ran
      // out of rounds, in which case a placement the loop still wanted to
      // move would move here and take all of its boxes with it. That is a
      // real difference and not a defect in either side, so it is worth
      // failing on the premise with a message that says so rather than on
      // a centre that is fifty units out.
      expect(
        dressing.stats.converged,
        `seed ${seed}: dressLap did not converge, so its placements are not a Z-1 fixed point`,
      ).toBe(true);
      const immovable = brakeOf(seed);
      const got = await dressLapByGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: dressing.placements,
        // Z-3 switched off: this compares the other three rules. See `noMix`.
        mixPinned: noMix(seed),
        seed,
        immovable,
        pool: dressingPool(seed),
      });

      cookMs += got.cookMs;
      // WHAT THE BOX STAGE ACTUALLY BUILT, in the units the finding was
      // stated in. This used to be the whole pose library stamped on
      // every placement with the wrong copies filtered out, and it read
      // "780,000 points built to keep 1,985" — a measurement rather than
      // an argument, and the one that said a per-target source selector
      // was worth a node change. `copyToPoints` has that selector now, so
      // the line below prints the copies actually emitted against the
      // boxes kept: it should read 100%, and a ratio that drifts off it
      // means something started stamping again.
      copies += got.stamped;

      // THE REFERENCE IS BUILT FROM THE LIST L-1 LEFT, NOT FROM THE ONE
      // `dressLap` FINISHED WITH, and the cull is what forced that. Taking
      // `dressing.boxes` would compare boxes built from two different
      // placement lists and read the difference — a placement the graph
      // pushed at least half a W clear of the cone, against a derived
      // centre bound of 0.03 world units at the longest arm — as a
      // box-building defect of two orders. The two lists differ by a
      // handful of laterals per lap, which is precisely the finding the
      // sampling test below states.
      //
      // AND IT STARTS FROM THE SAME f32 NUMBERS THE GRAPH DOES.
      // `dressing.placements` carries f64 laterals where the graph's
      // columns carry f32 ones, and the corridor test measures that gap at
      // 5e-7W. Below every threshold here — and a BOOLEAN occlusion
      // verdict does not care how far below, which is why
      // `repairReference` rounds its input rather than trusting the gap to
      // stay harmless.
      const want: readonly PlacedBox[] = referenceBoxes(
        lap,
        dressing.placements,
        immovable,
        seed,
      );
      expect(want.length).toBeGreaterThan(100);
      // THE COUNT AND THE ORDER FIRST. `copyToPoints` lays its copies out
      // in per-target blocks and the filter preserves order, so the
      // survivors are placement-then-box, which is `buildBoxes`' order —
      // if that ever stopped being true every comparison below would be
      // between unrelated boxes and would fail as noise rather than as a
      // reordering.
      expect(got.boxes.pointCount, `seed ${seed} box count`).toBe(want.length);

      const P = got.boxes.attrs.point.require("P");
      const scale = got.boxes.attrs.point.require("scale");
      const rot = got.boxes.attrs.point.require("rot");
      // THE ARM THE SHEAR ACTS ON, measured rather than guessed. A box
      // sits at `placementP + basis * offset`, so what turns a
      // non-orthogonality into a position error is |offset| — and that is
      // recoverable exactly, because the box cloud carries the index of
      // the placement it decomposes. It is the second term of the centre
      // bound, so it has to be read before the centre is checked.
      const pp = got.placements.attrs.point.require("P");
      const owner = got.boxes.attrs.point.require("placementIndex");

      for (let i = 0; i < want.length; i++) {
        const b = want[i];
        const t = owner.get(i);
        expect(t, `seed ${seed} box ${i} belongs to no placement`).toBeGreaterThanOrEqual(0);
        const arm = Math.hypot(
          b.centre[0] - pp.get(t, 0),
          b.centre[1] - pp.get(t, 1),
          b.centre[2] - pp.get(t, 2),
        );
        worstOffset = Math.max(worstOffset, arm);

        for (let c = 0; c < 3; c++) {
          const d = Math.abs(P.get(i, c) - b.centre[c]);
          const allowed = centreBound(b.centre[c], pp.get(t, c), arm);
          worstCentre = Math.max(worstCentre, d);
          worstMargin = Math.max(worstMargin, d / allowed);
          expect(
            d,
            `seed ${seed} box ${i} centre component ${c} (arm ${arm.toFixed(1)})`,
          ).toBeLessThan(allowed);
          const e = Math.abs(scale.get(i, c) - b.size[c]);
          worstExtent = Math.max(worstExtent, e);
          biggestExtent = Math.max(biggestExtent, Math.abs(b.size[c]));
          expect(e, `seed ${seed} box ${i} extent component ${c}`).toBeLessThan(EXTENT_TOL);
        }
        const ax = axesOf(rot.data, i);
        const err = Math.max(
          worstAxis(b.basis.across, ax.across),
          worstAxis(b.basis.along, ax.along),
          worstAxis(b.basis.up, ax.up),
        );
        worstAxisErr = Math.max(worstAxisErr, err);
        expect(err, `seed ${seed} box ${i} orientation`).toBeLessThan(AXIS_TOL);

        // The two quantities the centre tolerance is derived from,
        // measured rather than assumed: the shear the quaternion drops,
        // and the local offset it acts on.
        const skew = Math.max(
          Math.abs(dot3(b.basis.across, b.basis.along)),
          Math.abs(dot3(b.basis.across, b.basis.up)),
          Math.abs(dot3(b.basis.along, b.basis.up)),
        );
        worstSkew = Math.max(worstSkew, skew);
        total++;
      }
    }

    console.log(
      `dress graph boxes: ${total} boxes over ${SEEDS.length} seeds — ` +
        `worst centre ${worstCentre.toExponential(2)} world units, ` +
        `using ${(worstMargin * 100).toFixed(1)}% of its derived bound; ` +
        `worst extent ${worstExtent.toExponential(2)} on extents to ` +
        `${biggestExtent.toFixed(1)}; worst axis component ` +
        `${worstAxisErr.toExponential(2)}; frame skew ${worstSkew.toExponential(2)}, ` +
        `arm to ${worstOffset.toFixed(1)} world units`,
    );
    console.log(
      `dress graph cost: ${copies} copies stamped to keep ${total} boxes ` +
        `(${((100 * total) / copies).toFixed(2)}%), ${cookMs.toFixed(0)}ms of cook ` +
        `over ${SEEDS.length} seeds`,
    );
    // The skew is the reason the centre bound is what it is, so it is
    // asserted rather than only printed.
    expect(worstSkew).toBeGreaterThan(0);
    expect(worstSkew).toBeLessThan(MAX_FRAME_SKEW);
  }, FOUR_LAP_MS);

  it("resolves the corridor the way resolveCorridor does, on both branches", async () => {
    let worstT = 0;
    let worstH = 0;
    let fired = 0;
    let rose = 0;
    let stoodOff = 0;
    let total = 0;

    for (const seed of SEEDS) {
      const { lap, frames } = await cookLap(seed);
      const placements = beforeCorridor(lap, seed);
      const g = buildRoundGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements,
        seed,
        // Nothing is locked here: this test reads only the pre-cull cloud,
        // which L-1 has not touched. Stated rather than omitted, which is
        // what the param being required is for.
        immovable: new Set(),
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      // THE PRE-CULL CLOUD, WHICH IS THE ONLY ONE THAT CAN ANSWER THIS.
      // Z-1's verdict is "what did the corridor rule do to the list it was
      // given", and L-1 overwrites `trackT` for every placement it pushes
      // — after which a piece Z-1 left alone and the cull shoved half a W
      // outward is indistinguishable from one Z-1 stood off, and the
      // branch assertion below would read the cull's work as a corridor
      // fix. It is exactly why the graph publishes both clouds.
      //
      // Only this output: the box build and the coverage cast are the
      // other two tests' business, and cooking them here would pay for a
      // million-point broadcast to read two columns.
      const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placed] })).outputs;
      const cloud = firstGeometry(out[DRESS_OUTPUTS.placed] ?? []);
      if (!cloud) throw new Error("the dress graph produced no placements");
      expect(cloud.pointCount).toBe(placements.length);

      const t = cloud.attrs.point.require("trackT");
      const h = cloud.attrs.point.require("trackH");
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        const want = corridorReference(p);
        const movedT = Math.abs(want.t - p.t) > SAME_PLACE_W;
        const movedH = Math.abs(want.h - p.h) > SAME_PLACE_W;
        if (movedT || movedH) fired++;
        if (movedH && !movedT) rose++;
        if (movedT) stoodOff++;

        // THE BRANCH IS CHECKED BEFORE THE VALUE. A disagreement about
        // which of the two exits was taken moves a placement by half its
        // own width, so it would show up as a value error too — but as an
        // unexplained one, and it is exactly the failure a tolerance is
        // tempted to swallow.
        const gotMovedT = Math.abs(t.get(i) - p.t) > SAME_PLACE_W;
        const gotMovedH = Math.abs(h.get(i) - p.h) > SAME_PLACE_W;
        expect(gotMovedT, `seed ${seed} placement ${i}: lateral branch`).toBe(movedT);
        expect(gotMovedH, `seed ${seed} placement ${i}: height branch`).toBe(movedH);

        const dt = Math.abs(t.get(i) - want.t);
        const dh = Math.abs(h.get(i) - want.h);
        worstT = Math.max(worstT, dt);
        worstH = Math.max(worstH, dh);
        total++;
      }
    }

    // Both branches have to have run, or the comparison proved nothing
    // about the rule that matters: `zones.ts` exists because the two
    // exits are different, and a suite that only ever saw the no-op would
    // pass against a function that returned its argument.
    expect(fired, "Z-1 never fired; the population does not exercise the rule").toBeGreaterThan(0);
    expect(rose, "no small piece rose to the ceiling").toBeGreaterThan(0);
    expect(stoodOff, "no large piece stood off to the corridor edge").toBeGreaterThan(0);

    /**
     * The bound, in half-widths.
     *
     * Both quantities are stored f32 and the arithmetic is f64 over them,
     * so the error is the f32 spacing of the values involved: a lateral
     * reaches 20W and a height 6W, where f32 spacing is about 2e-6 and
     * 5e-7. 1e-5 clears both and is four orders below `SAME_PLACE_W`, the
     * threshold the branch decisions above are taken at — so no value
     * this bound admits could have changed a decision.
     */
    const TRACK_TOL = 1e-5;
    expect(worstT).toBeLessThan(TRACK_TOL);
    expect(worstH).toBeLessThan(TRACK_TOL);
    console.log(
      `dress graph Z-1: ${total} placements, ${fired} fixed ` +
        `(${rose} rose, ${stoodOff} stood off) — worst |dt| ${worstT.toExponential(2)}W, ` +
        `worst |dh| ${worstH.toExponential(2)}W`,
    );
  }, FOUR_LAP_MS);

  it("culls the cone the way cullSightlines does", async () => {
    let seeds = 0;
    let placements = 0;
    let blocking = 0;
    let pushed = 0;
    let dropped = 0;
    let worstT = 0;
    let worstPush = 0;
    let worstMargin = 0;
    let graphMs = 0;
    let refMs = 0;

    for (const seed of SEEDS) {
      const { lap, frames } = await cookLap(seed);
      // THE POPULATION Z-1 HAS SETTLED AND L-1 HAS NEVER SEEN, for the
      // same reason `beforeCorridor` exists at all: `dressLap`'s own
      // output has already been culled, so running the cull over it is a
      // check that nothing moves — necessary, and vacuous on its own.
      // This one has forty to sixty blockers in it, which is what makes
      // the comparison worth making.
      const src = beforeCorridor(lap, seed);
      const immovable = brakeOf(seed);
      const g = buildRoundGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: src,
        seed,
        immovable,
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      const t0 = performance.now();
      const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placed, DRESS_OUTPUTS.placements] }))
        .outputs;
      graphMs += performance.now() - t0;
      const before = firstGeometry(out[DRESS_OUTPUTS.placed] ?? []);
      const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
      if (!before || !after) throw new Error("the dress graph produced no placements");

      const zoned = readPlacements(before, src);
      const t1 = performance.now();
      const ref = cullReference(lap, zoned, immovable);
      refMs += performance.now() - t1;

      seeds++;
      placements += zoned.length;
      blocking += ref.blocking;
      pushed += ref.moved;
      dropped += ref.dropped;
      // A RULE THAT NEVER FIRED IS NOT A RULE THAT PASSED.
      expect(ref.blocking, `seed ${seed}: nothing blocked the cone`).toBeGreaterThan(0);

      const survivors = new Map<number, { t: number; push: number }>();
      const kId = after.attrs.point.require("placementId");
      const kT = after.attrs.point.require("trackT");
      const kPush = after.attrs.point.require("conePushW");
      for (let i = 0; i < after.pointCount; i++) {
        survivors.set(kId.get(i), { t: kT.get(i), push: kPush.get(i) });
      }

      // WHO SURVIVED, MEMBER BY MEMBER. Not a count: two culls that
      // dropped the same NUMBER of different placements would pass one.
      expect(survivors.size, `seed ${seed}: survivor count`).toBe(ref.kept.length);
      for (const o of ref.kept) {
        expect(
          survivors.has(o.id),
          `seed ${seed}: placement ${o.id} kept by the rule, not by the graph`,
        ).toBe(true);
      }
      const keptByRule = new Set(ref.kept.map((o) => o.id));
      for (const id of survivors.keys()) {
        expect(
          keptByRule.has(id),
          `seed ${seed}: placement ${id} kept by the graph, not by the rule`,
        ).toBe(true);
      }

      // AND WHERE IT LEFT THEM, plus the column that says so. A demo that
      // reported a push it had not made, or made one it did not report,
      // would have two accounts of the same move and no way to tell which
      // one anything downstream had read.
      const bP = before.attrs.point.require("P");
      for (const o of ref.kept) {
        const got = survivors.get(o.id);
        if (!got) continue;
        // The bound is read off the placement's OWN world position, which
        // is where the f32 rounding that reaches the lateral happens.
        const allowed = lateralBound(
          lap,
          bP.get(o.id, 0),
          bP.get(o.id, 1),
          bP.get(o.id, 2),
          o.t,
        );
        const d = Math.abs(got.t - o.t);
        worstT = Math.max(worstT, d);
        worstMargin = Math.max(worstMargin, d / allowed);
        expect(d, `seed ${seed}: placement ${o.id} lateral`).toBeLessThan(allowed);
        const dp = Math.abs(got.push - (o.t - o.src.t));
        worstPush = Math.max(worstPush, dp);
        worstMargin = Math.max(worstMargin, dp / allowed);
        expect(dp, `seed ${seed}: placement ${o.id} push distance`).toBeLessThan(allowed);
      }
    }

    console.log(
      `dress graph cull: ${placements} placements over ${seeds} seeds — ` +
        `${blocking} blocked the cone, ${pushed} pushed clear, ${dropped} dropped; ` +
        `worst lateral ${worstT.toExponential(2)}W, worst push ${worstPush.toExponential(2)}W, ` +
        `using ${(worstMargin * 100).toFixed(1)}% of the derived bound; ` +
        `${graphMs.toFixed(0)}ms of cook against ${refMs.toFixed(0)}ms of cullSightlines`,
    );
    // Both exits of the repair, over the four laps rather than per lap:
    // dropping only happens where six W of push still cannot clear the
    // cone, and that is two laps in four.
    expect(pushed).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  }, FOUR_LAP_MS);

  it("breaks false edges the way repairFalseEdges does, one pass", async () => {
    let seeds = 0;
    let runsFound = 0;
    let lowered = 0;
    let residual = 0;
    let extraPasses = 0;
    let thinnestSide = Number.POSITIVE_INFINITY;
    const perSeed: string[] = [];

    for (const seed of SEEDS) {
      const { lap, frames } = await cookLap(seed);
      const src = beforeCorridor(lap, seed);
      const immovable = brakeOf(seed);
      const g = buildRoundGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: src,
        seed,
        immovable,
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      const out = (
        await cook(g, {
          outputs: [DRESS_OUTPUTS.placed, DRESS_OUTPUTS.culled, DRESS_OUTPUTS.placements],
        })
      ).outputs;
      const placed = firstGeometry(out[DRESS_OUTPUTS.placed] ?? []);
      const culled = firstGeometry(out[DRESS_OUTPUTS.culled] ?? []);
      const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
      if (!placed || !culled || !after) throw new Error("the dress graph produced no placements");

      // The list L-5 was handed: what L-1 left. Same discipline as every
      // other stage here — the reference starts from the graph's own
      // answer for the stage before, so this test measures L-5 alone.
      const cull = cullReference(lap, readPlacements(placed, src), immovable);
      const input = cull.kept.map((o) => ({ ...o.src, t: o.t }));
      const ref = repairFalseEdges(input, lap.lengthW, 1);

      seeds++;
      const runs = falseEdges(input, lap.lengthW);
      runsFound += runs.length;
      lowered += ref.moves;
      perSeed.push(`${seed}:${runs.length}`);

      // WHAT ONE PASS LEAVES BEHIND, MEASURED RATHER THAN ASSERTED TO BE
      // SMALL. The graph states one pass because nothing in the library
      // re-cooks a subgraph until an output settles; `repairFalseEdges`
      // runs up to eight because lowering the middle of an eight-member
      // run can leave two fours that each still qualify. This is the size
      // of that gap, and it is the number that says whether the missing
      // loop matters — printed every run, and gated below so that a
      // change which made it worse could not pass quietly.
      const full = repairFalseEdges(input, lap.lengthW, 8);
      residual += ref.after;
      extraPasses += full.moves - ref.moves;
      // A rule that never fired is not a rule that passed, and this one
      // fires on every lap once L-1 has had its turn — the cull pushes
      // pieces INTO the edge band, so the population L-5 sees is not the
      // one it would have seen first.
      expect(runs.length, `seed ${seed}: nothing to break on this lap`).toBeGreaterThan(0);

      // THE PREMISE THE STAGE RESTS ON, MEASURED RATHER THAN ASSUMED.
      // `runFit` takes its wrap from the topology, so `pointsToPath` has
      // to close each side, and a closed path needs three points. A side
      // with fewer band members than that would fail the cook — not
      // report no runs — so the thinnest side is checked and printed.
      const bandOf = (sign: number): number =>
        input.filter((p) => {
          const a = Math.abs(p.t);
          return (
            a >= FALSE_EDGE.lateralW[0] &&
            a <= FALSE_EDGE.lateralW[1] &&
            p.h >= FALSE_EDGE.heightW[0] &&
            p.h <= FALSE_EDGE.heightW[1] &&
            (p.t < 0 ? -1 : 1) === sign
          );
        }).length;
      const thin = Math.min(bandOf(-1), bandOf(1));
      thinnestSide = Math.min(thinnestSide, thin);
      expect(thin, `seed ${seed}: a side carries too few band members to close`).toBeGreaterThan(2);

      // WHICH PLACEMENTS THE GRAPH LOWERED, member by member against the
      // rule's own log. `repairFalseEdges` records the index it moved in
      // `log`, and those indices are into the list handed in — which is
      // the list `placementId` names, because L-1 preserved the column.
      const ids = new Map<number, number>();
      const cId = culled.attrs.point.require("placementId");
      for (let i = 0; i < culled.pointCount; i++) ids.set(cId.get(i), i);

      const wantLowered = new Set(ref.log.map((e) => input[e.index].station));
      const gotLowered = new Set<number>();
      const kDrop = after.attrs.point.require("edgeDrop");
      const kH = after.attrs.point.require("trackH");
      const kStation = after.attrs.point.require("stationW");
      for (let i = 0; i < after.pointCount; i++) {
        if (kDrop.get(i) !== 0) gotLowered.add(kStation.get(i));
      }
      expect(gotLowered.size, `seed ${seed}: how many L-5 lowered`).toBe(wantLowered.size);
      for (const st of wantLowered) {
        expect(
          [...gotLowered].some((g2) => Math.abs(g2 - st) <= SAME_PLACE_W),
          `seed ${seed}: the rule lowered the placement at station ${st.toFixed(3)}, the graph did not`,
        ).toBe(true);
      }

      // AND EVERY HEIGHT, not only the ones that moved: a stage that
      // lowered the right placement and perturbed another would pass the
      // comparison above.
      expect(after.pointCount, `seed ${seed}: L-5 changed the population size`).toBe(
        ref.placements.length,
      );
      for (let i = 0; i < after.pointCount; i++) {
        expect(
          Math.abs(kH.get(i) - ref.placements[i].h),
          `seed ${seed}: placement ${i} height`,
        ).toBeLessThan(4 * ulp(ref.placements[i].h));
      }
    }

    console.log(
      `dress graph L-5: over ${seeds} seeds the detector found ${runsFound} false edges ` +
        `(${perSeed.join(", ")}) and one pass lowered ${lowered}, leaving ${residual} ` +
        `still qualifying; the full eight-pass repair would have lowered ${extraPasses} more; ` +
        `thinnest edge-band side ${thinnestSide} members`,
    );
    expect(lowered).toBeGreaterThan(0);
    // THE COST OF THE MISSING LOOP, MEASURED — AND IT IS NOT ZERO.
    //
    // I expected it to be, and wrote `toBe(0)` here on the reasoning that
    // no run on these laps is long enough for breaking its middle to leave
    // two halves that each still qualify. The run says otherwise: of six
    // false edges across four seeds, one survives its own repair and the
    // full eight-pass loop lowers one more placement than the graph does.
    // So the graph's single pass really is losing work, on one lap in
    // four, and the file's claim that it does is a measurement rather than
    // a hedge.
    //
    // A CEILING, NOT AN EQUALITY, and not a floor either. It must not GROW
    // — that would mean the gap between the graph and the rule is
    // widening. It is free to shrink to zero, which is what building the
    // fixed point as a subgraph would do, and a test that forbade that
    // would have to be deleted by whoever finally closed the gap.
    expect(
      extraPasses,
      "one pass of L-5 is losing more than it did; the missing repair loop now costs more",
    ).toBeLessThanOrEqual(3);
  }, FOUR_LAP_MS);

  it("agrees with runFit about a false edge built to order", async () => {
    // THE RULE IS THIN ON REAL DATA — two runs on one lap, none on
    // another — so the population cannot exercise the four measurements
    // that make a run qualify. This builds one: eight pieces in the verge,
    // 3W apart, drifting outward at 0.05 W per W, which clears the span,
    // the straightness and both ends of the divergence band. Then each
    // threshold is moved just past its edge and the run must STOP
    // qualifying, which is the half that says the gate is a gate.
    const seed = 1;
    const { lap, frames } = await cookLap(seed);
    const kit = shippedVocabulary();

    // A PIECE TOO SMALL TO BLOCK THE CONE, and that is the fixture's whole
    // difficulty rather than a detail of it. L-1 runs before L-5 and is
    // exactly the rule that moves a line of objects standing in the verge
    // — the first version of this test built the run out of a real asset,
    // and the cull pushed most of it clear of the edge band before the
    // detector ever saw it. Two hundredths of a half-width is 18cm on this
    // track: it sits in the band, it fits the line, and no chord from any
    // eye finds it. Its id is not the vocabulary's, so `poseFor` gives it
    // no boxes, which costs nothing here — L-5 is a rule about placements.
    const asset = {
      id: -1,
      size: { across: 0.02, along: 0.02, tall: 0.02 },
    } as unknown as PlaceableAsset;

    const at = (t: number, h: number, station: number): StationedPlacement =>
      ({ asset, t, h, station }) as unknown as StationedPlacement;

    // FILLER OUTSIDE THE BAND, ON EVERY CASE, and it is not padding. The
    // stage sorts the cloud into three paths — left of the racing line,
    // right of it, and everything not in the band — so a fixture made
    // only of band members leaves the third path empty and exercises an
    // arrangement no lap produces. It also matters for the short-group
    // case: skip a two-member side and a band-only fixture has no paths
    // at all, which is a different degenerate case from the one under
    // test. Height 1.0 is above the band's 0.6 ceiling.
    const filler = [at(1.4, 1.0, 200), at(1.5, 1.0, 210), at(1.6, 1.0, 220)];

    const line = (n: number, gapW: number, slope: number, h: number): StationedPlacement[] => [
      ...Array.from({ length: n }, (_, i) => at(1.2 + slope * (i * gapW), h, 20 + i * gapW)),
      ...filler,
    ];

    const cases: { name: string; list: StationedPlacement[]; want: number }[] = [
      { name: "qualifying", list: line(8, 3 - 0.1, 0.05, 0.4), want: 1 },
      // Each of the four gates, moved just past its edge.
      { name: "too few members", list: line(2, 3 - 0.1, 0.05, 0.4), want: 0 },
      { name: "too short a span", list: line(3, 1.2, 0.05, 0.4), want: 0 },
      { name: "too flat", list: line(8, 3 - 0.1, 0.005, 0.4), want: 0 },
      // STEEP AND STILL IN THE BAND, which the obvious spelling is not.
      // Eight pieces 2.9W apart at a slope of 0.4 leave the lateral window
      // at the third one — `1.2 + 0.4 * 5.8` is 3.52 against a ceiling of
      // 2.5 — so the run has two members and is refused for its COUNT.
      // That fixture passed while testing nothing: deleting the upper
      // divergence term from the gate left every case green. A slope of
      // 0.35 over three pieces 2.1W apart reaches 2.67 at the last, which
      // is out, so it is 1.20 / 1.94 / 2.67 -> two in band. Tighter
      // still: 0.35 over 1.4W steps holds 1.20 / 1.69 / 2.18 / 2.67,
      // three in band spanning 4.2W, slope 0.35, which is inside every
      // gate except the one under test.
      { name: "too steep", list: line(4, 1.4, 0.35, 0.4), want: 0 },
      { name: "above the band", list: line(8, 3 - 0.1, 0.05, 0.9), want: 0 },
      // The gap rule, from the other side: 3W apart is one run, 3.5W apart
      // is eight runs of one. Paired with the qualifying case above, which
      // differs from it only in the spacing.
      { name: "too widely spaced", list: line(8, 3.5, 0.05, 0.4), want: 0 },
    ];

    for (const c of cases) {

      const g = buildRoundGraph({
        kit,
        lap,
        frames,
        placements: c.list,
        seed,
        immovable: new Set(),
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      const out = (
        await cook(g, { outputs: [DRESS_OUTPUTS.culled, DRESS_OUTPUTS.placements] })
      ).outputs;
      const culled = firstGeometry(out[DRESS_OUTPUTS.culled] ?? []);
      const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
      if (!culled || !after) throw new Error("the dress graph produced no placements");

      // THE REFERENCE RUNS OVER WHAT L-1 LEFT, NOT OVER THE FIXTURE, and
      // that is not bookkeeping — the cull genuinely rewrites this
      // fixture. Eight pieces at knee height a metre off the racing line
      // are exactly what L-1 exists to move, and it pushes most of them
      // clear of the edge band before L-5 ever sees them. Comparing the
      // graph's L-5 against `falseEdges` of the ORIGINAL list measures the
      // cull and reports it as an L-5 defect, which is what the first
      // version of this test did.
      const seen = readCulled(culled, c.list);
      const want = falseEdges(seen, lap.lengthW).length;
      expect(want, `the fixture "${c.name}" does not survive the cull as stated`).toBe(c.want);

      const drop = after.attrs.point.require("edgeDrop");
      let fired = 0;
      for (let i = 0; i < after.pointCount; i++) if (drop.get(i) !== 0) fired++;
      expect(fired, `the graph disagreed about "${c.name}"`).toBe(c.want);
    }
  });

  it("walks the full push ladder at a half-width f32 cannot hold", async () => {
    // THE DEFAULT HALF-WIDTH HIDES THIS ENTIRELY, WHICH IS WHY IT IS ITS
    // OWN TEST WITH ITS OWN TRACK.
    //
    // `occlusionCull` walks `floor(pushMax / pushStep)` rungs. `pushMax`
    // has to be a FIELD here, because L-3's exception is per placement,
    // and a field is resolved onto an f32 column — so the allowance is
    // `fround(k * halfWidth)` while the step stays f64. At the default
    // half-width of 9 the rule's own 6W comes to 54, which f32 holds
    // exactly, and every ladder in every other test is twelve rungs by
    // luck. At 7.3 it is 43.799999237 against a step of 3.65: the ratio
    // falls a hundred-millionth short of 12 and the graph walks ELEVEN
    // rungs, so a placement that only clears at the full 6W is dropped by
    // the graph and kept by the rule.
    //
    // The fix is in `writeSightlineCull`: state the allowance half a rung
    // above the rule's maximum, where no rounding of either number can
    // move the floor. This is the test that would have caught it, and it
    // fails on the previous spelling — which is the only reason to believe
    // it is testing anything.
    const RUNGS = SIGHTLINE.maxPushW / SIGHTLINE.pushStepW;
    const rungsAt = (allowanceW: number, halfWidth: number): number =>
      // `Math.fround` IS the field column: `scalarPerElement` resolves a
      // field onto f32 and the node then divides by an f64 step, which is
      // the whole of the arithmetic being pinned.
      Math.floor(Math.fround(allowanceW * halfWidth) / (SIGHTLINE.pushStepW * halfWidth));

    // THE ARITHMETIC FIRST, SWEPT, AND PAIRED WITH THE BOUND MOVED ASIDE.
    // Asserting that the shipped spelling gives twelve rungs is only
    // evidence if the spelling it replaced does not — otherwise every
    // half-width in the sweep could be one where f32 happens to be exact
    // and the test would pass on the defect. So the naive spelling is
    // counted as it goes and required to have failed somewhere.
    let naiveShort = 0;
    const shortAt: number[] = [];
    for (let hundredths = 100; hundredths <= 2000; hundredths++) {
      const w = hundredths / 100;
      if (rungsAt(SIGHTLINE.maxPushW, w) < RUNGS) {
        naiveShort++;
        if (shortAt.length < 5) shortAt.push(w);
      }
      expect(
        rungsAt(SIGHTLINE.maxPushW + SIGHTLINE.pushStepW / 2, w),
        `half-width ${w}: the shipped allowance does not give ${RUNGS} rungs`,
      ).toBe(RUNGS);
    }
    console.log(
      `L-1 push ladder: over 1901 half-widths from 1 to 20, the rule's own ` +
        `${SIGHTLINE.maxPushW}W allowance loses a rung on ${naiveShort} of them ` +
        `(${shortAt.join(", ")}, ...); the half-rung spelling loses one on none`,
    );
    expect(
      naiveShort,
      "no half-width in the sweep exercised the rounding, so the pairing proves nothing",
    ).toBeGreaterThan(0);

    // AND THEN END TO END ON ONE OF THEM, because the sweep above pins the
    // arithmetic and not the wiring: a `pushMax` that reached the node as
    // something else entirely would satisfy every line of it.
    const seed = 1;
    for (const halfWidth of [7.3]) {
      expect(rungsAt(SIGHTLINE.maxPushW, halfWidth), "this lap does not exercise it").toBeLessThan(
        RUNGS,
      );
      const spline = makeTrackSpline({ seed, halfWidth });
      const out0 = (await cook(buildRoadGraph({ spline, seed }))).outputs;
      const frames = firstGeometry(out0[OUTPUTS.frames] ?? []);
      if (!frames) throw new Error("the road graph produced no frames");
      const lap = readLap(frames);
      expect(lap.halfWidth, `half-width ${halfWidth} did not reach the lap`).toBeCloseTo(
        halfWidth,
        6,
      );

      const src = beforeCorridor(lap, seed);
      const immovable = brakeOf(seed);
      const g = buildRoundGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: src,
        seed,
        immovable,
        // Z-3 is switched off here: these cases measure Z-1, L-1 and
        // L-5, and a mix that redraws a placement mid-comparison is a
        // different lap rather than noise. See `noMix`.
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });
      const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placed, DRESS_OUTPUTS.placements] }))
        .outputs;
      const before = firstGeometry(out[DRESS_OUTPUTS.placed] ?? []);
      const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
      if (!before || !after) throw new Error("the dress graph produced no placements");

      const ref = cullReference(lap, readPlacements(before, src), immovable);
      // WHAT THIS HALF OF THE TEST DOES NOT COVER, SAID OUT LOUD. Eleven
      // rungs and twelve agree on every placement that cleared before rung
      // twelve, and the deepest push this lap needs is printed below —
      // well short of it. So this is a wiring check, and the sweep above
      // is what actually pins the ladder's length. A lap that reached the
      // last rung would be better and none of the seeds produces one.
      const deepest = ref.kept.reduce((m, o) => Math.max(m, Math.abs(o.t - o.src.t)), 0);
      console.log(
        `L-1 push ladder: at half-width ${halfWidth} the graph and the rule agree on ` +
          `${ref.kept.length} survivors; deepest push ${deepest.toFixed(1)}W of ` +
          `${SIGHTLINE.maxPushW}W, so rung ${RUNGS} is not reached by this population`,
      );

      const survivors = new Set<number>();
      const kId = after.attrs.point.require("placementId");
      for (let i = 0; i < after.pointCount; i++) survivors.add(kId.get(i));
      expect(after.pointCount, `half-width ${halfWidth}: survivor count`).toBe(ref.kept.length);
      for (const o of ref.kept) {
        expect(
          survivors.has(o.id),
          `half-width ${halfWidth}: placement ${o.id} kept by the rule, not by the graph`,
        ).toBe(true);
      }
    }
  });

  it("drops a locked asset rather than pushing it", async () => {
    // THE BRANCH REAL DATA DOES NOT REACH, CONSTRUCTED RATHER THAN LEFT
    // GREEN. L-3's ruler element is the asset L-1 must remove rather than
    // shove out of line, and on these four laps the braking marks never
    // block the cone: every drop in the test above is an ordinary
    // placement that six W of push could not clear. So the exception is
    // exercised by locking an asset that IS among the blockers and
    // checking the verdict flips from pushed to dropped. It is the whole
    // reason `occlusionCull` takes `pushMax` as a field.
    const seed = 1;
    const { lap, frames } = await cookLap(seed);
    const src = beforeCorridor(lap, seed);
    const build = (immovable: ReadonlySet<number>): Graph =>
      buildRoundGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: src,
        seed,
        immovable,
        mixPinned: noMix(seed),
        pool: dressingPool(seed),
      });

    const open0 = (await cook(build(new Set()), { outputs: [DRESS_OUTPUTS.placed] })).outputs;
    const before = firstGeometry(open0[DRESS_OUTPUTS.placed] ?? []);
    if (!before) throw new Error("the dress graph produced no placements");
    const zoned = readPlacements(before, src);

    const open = cullReference(lap, zoned, new Set());
    const movedBy = open.kept.filter((o) => Math.abs(o.t - o.src.t) > SAME_PLACE_W);
    expect(movedBy.length, "nothing was pushed, so there is no asset to lock").toBeGreaterThan(0);
    // AN ASSET WITH ONE PLACEMENT THAT BLOCKS AND ONE THAT DOES NOT, so
    // that the second claim below has something to be about: a lock is not
    // a ban on the asset, it is a rule about what happens to the copies of
    // it that BLOCK. An asset every copy of which blocks would satisfy
    // "the locked one was dropped" while being indistinguishable from a
    // lock that removed the asset outright.
    const clear = new Set(
      open.kept.filter((o) => Math.abs(o.t - o.src.t) <= SAME_PLACE_W).map((o) => o.src.asset.id),
    );
    const pick = movedBy.find((o) => clear.has(o.src.asset.id));
    expect(pick, "no asset has both a blocking and a clear placement").toBeDefined();
    if (!pick) throw new Error("unreachable");
    const locked = new Set([pick.src.asset.id]);
    const shut = cullReference(lap, zoned, locked);

    // THE BOUND PAIRED WITH THE BOUND MOVED ASIDE, which is the only way
    // an assertion about a lock is evidence the lock did anything: a cull
    // that dropped every blocker would satisfy "the locked one was
    // dropped" while never having pushed at all.
    expect(shut.dropped, "locking a blocker dropped nothing extra").toBeGreaterThan(open.dropped);
    expect(shut.moved, "locking a blocker left the push count alone").toBeLessThan(open.moved);

    const out = (await cook(build(locked), { outputs: [DRESS_OUTPUTS.placements] })).outputs;
    const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
    if (!after) throw new Error("the dress graph produced no placements");
    const kId = after.attrs.point.require("placementId");
    const survivors = new Set<number>();
    for (let i = 0; i < after.pointCount; i++) survivors.add(kId.get(i));

    expect(after.pointCount, "the graph and the rule kept different numbers").toBe(
      shut.kept.length,
    );
    for (const o of shut.kept) {
      expect(survivors.has(o.id), `placement ${o.id} kept by the rule, not by the graph`).toBe(true);
    }
    const droppedLocked = zoned
      .map((p, i) => i)
      .filter((i) => locked.has(zoned[i].asset.id) && !survivors.has(i));
    expect(droppedLocked.length, "the graph dropped no locked placement").toBeGreaterThan(0);
    // AND THE LOCK IS NOT A BLANKET REMOVAL. A placement of the same asset
    // that never blocked is untouched, which is what makes this an
    // exception to the REPAIR rather than a filter on the vocabulary.
    const lockedTotal = zoned.filter((p) => locked.has(p.asset.id)).length;
    expect(droppedLocked.length, "the lock removed every copy of the asset").toBeLessThan(
      lockedTotal,
    );
  });

  it("finds cone blockers that the rule's own 2W eye spacing steps over", async () => {
    // THE FINDING THIS STAGE PRODUCED, PINNED SO THAT IT FAILS IF IT GROWS.
    //
    // L-1 says the next 12W of centreline must be visible FROM ANY
    // STATION. `defaultEyeStations` checks every 2W, which its own comment
    // labels a sampling compromise, and `dressLap` runs its repair loop
    // until that check reports nothing — so its output is a fixed point of
    // the SAMPLING rather than of the rule. `occlusionCull` takes its eyes
    // from the points of the sight path, and the lap's frames are 0.385W
    // apart, so the graph asks the same question five times as often and
    // finds placements standing in the cone on every lap `dressLap`
    // declared clear. Those are real violations rather than a stricter
    // reading: a driver at one of those stations cannot see the road.
    //
    // IT IS NOT FIXED HERE. Raising `dress.ts`'s eye density moves the
    // output of every rule downstream of the cull — the coverage gaps, the
    // band mix, the enclosure share — and that is a retune of the demo
    // rather than part of stating its rules as nodes. Reported, measured,
    // and left where the decision belongs.
    let stepped = 0;
    const perSeed: string[] = [];

    for (const seed of SEEDS) {
      const { lap, dressing } = await cookLap(seed);
      expect(
        dressing.stats.converged,
        `seed ${seed}: dressLap did not converge, so its own cull had not finished either`,
      ).toBe(true);
      const occ = dressing.placements.map(traced);
      const frameAt = frameLookup(lap);
      const at = (eyes: readonly number[]): CullResult<Traced> =>
        cullSightlines(occ, lap.lengthW, frameAt, lap.halfWidth, eyes, () => false);

      // THE PREMISE, ASSERTED: `dressLap` really did finish, by its own
      // measure. Without this the comparison could be reporting a lap that
      // ran out of repair rounds, where both eye sets would find blockers
      // and the finer one would find more for a reason that says nothing
      // about the sampling.
      const coarse = at(defaultEyeStations(lap.lengthW));
      expect(coarse.blocking, `seed ${seed}: the 2W cull was not at a fixed point`).toBe(0);

      const fine = at(frameStationsOf(lap));
      stepped += fine.blocking;
      perSeed.push(`${seed}:${fine.blocking}`);
      expect(fine.blocking, `seed ${seed}: the finer eye set found nothing`).toBeGreaterThan(0);
      // AND EVERY ONE OF THEM CLEARS BY A PUSH, which is the difference
      // between "the finer sampling finds violations the demo can repair"
      // and "the finer sampling would cost the lap twenty-five placements".
      // Reading only `blocking` leaves that unsaid, and the second reading
      // is the one that would make raising the eye density expensive.
      expect(fine.dropped, `seed ${seed}: the finer eye set had to drop something`).toBe(0);
    }

    console.log(
      `L-1 eye sampling: over ${SEEDS.length} converged laps the 2W spacing reported 0 blockers ` +
        `of a ${SIGHTLINE.aheadW}W look-ahead, and the frame spacing (~0.385W) found ${stepped} ` +
        `(${perSeed.join(", ")})`,
    );
    // A CEILING, NOT AN EQUALITY. What the number must not do is grow:
    // these are violations the shipped demo leaves on the track, and a
    // change that doubled them would otherwise pass silently. Measured at
    // 25 over the four laps.
    expect(stepped).toBeLessThanOrEqual(40);
  }, FOUR_LAP_MS);

  it("gives the same bytes whatever was asked for and in what order", async () => {
    // DETERMINISM IS THE LIBRARY'S HARD INVARIANT AND THIS IS THE ONE
    // THING THE OTHER THREE TESTS CANNOT SEE. They compare one cook
    // against a reference at a tolerance, so a stage that answered
    // slightly differently on a second run would pass all three twice.
    //
    // THE ORDER IS VARIED BY WHAT IS ASKED FOR, not by re-running the
    // same request. A cook only evaluates what its declared outputs
    // reach, so asking for the boxes alone and asking for all three
    // schedules different work — and if any of these stages drew from
    // something outside its own inputs and seed, the two would part.
    const seed = 2;
    const { lap, frames, dressing } = await cookLap(seed);
    const input = {
      kit: shippedVocabulary(),
      lap,
      frames,
      placements: dressing.placements,
      seed,
      immovable: brakeOf(seed),
      mixPinned: noMix(seed),
      pool: dressing.pool,
    };

    const alone = (await cook(buildDressGraph(input), { outputs: [DRESS_OUTPUTS.boxes] })).outputs;
    const together = await dressLapByGraph(input);
    const first = firstGeometry(alone[DRESS_OUTPUTS.boxes] ?? []);
    if (!first) throw new Error("the dress graph produced no boxes");

    // Both counts pinned against a floor before they are pinned against
    // each other, for the reason the enclosure test now states: two empty
    // clouds are byte-identical and say nothing.
    expect(first.pointCount).toBeGreaterThan(100);
    expect(first.pointCount).toBe(together.boxes.pointCount);
    // BIT EQUALITY, NOT A TOLERANCE. "Same seed, identical output,
    // independent of cook order" is a promise about the same path re-run,
    // and the only honest way to check a promise about bits is to compare
    // bits — a bound of 1e-12 here would be a different, weaker claim.
    for (const name of ["P", "rot", "scale", "placementIndex"]) {
      const a = first.attrs.point.require(name);
      const b = together.boxes.attrs.point.require(name);
      expect(a.tupleSize).toBe(b.tupleSize);
      for (let i = 0; i < first.pointCount * a.tupleSize; i++) {
        expect(a.data[i], `${name}[${i}] differs between cooks`).toBe(b.data[i]);
      }
    }
  });

  it("measures the same enclosure enclosureMask does, frame by frame", async () => {
    let worstShare = 0;
    let frames = 0;
    let under = 0;
    let shares = "";

    for (const seed of SEEDS) {
      const cookedLap = await cookLap(seed);
      const { lap, dressing } = cookedLap;
      const immovable = brakeOf(seed);
      const got = await dressLapByGraph({
        kit: shippedVocabulary(),
        lap,
        frames: cookedLap.frames,
        placements: dressing.placements,
        mixPinned: noMix(seed),
        seed,
        immovable,
        pool: dressingPool(seed),
      });

      // The reference runs over the TypeScript's OWN boxes, not the
      // graph's: two measurements of one set of geometry is the question,
      // and feeding the reference the graph's boxes would fold the box
      // comparison into this one and hide which half disagreed.
      //
      // BUILT FROM THE LIST L-1 LEFT, THOUGH, WHICH IS NOT `dressing.boxes`.
      // The graph culls before it builds, so its coverage is cast against
      // a lap where a handful of placements per seed have been pushed
      // clear of the cone; measuring `dressing.boxes` instead would be two
      // measurements of two different laps, and the masks agreeing would
      // be luck about whether a pushed piece happened to still cover the
      // frame it used to.
      const want = enclosureMask(lap, referenceBoxes(lap, dressing.placements, immovable, seed));
      expect(got.covered.length).toBe(want.length);

      // THE LAP HAS TO BE COVERED SOMEWHERE, OR THIS PROVES NOTHING.
      // Everything below compares two masks and a share, and two all-false
      // masks agree perfectly: a `pathCoverage` wired to the wrong boxes
      // pin, a `far` an order too small, a `spread` of zero — every one of
      // those produces a run that finishes clean with 0 === 0 in it. The
      // Z-1 test guards itself the same way by pinning that both exits
      // fired; a measurement suite owes the same guard, and L-6's own
      // published figure for this circuit is about a tenth of the lap, so
      // "some" is a floor no correct run can miss.
      const coveredFrames = want.reduce((n, c) => n + (c ? 1 : 0), 0);
      expect(
        coveredFrames,
        `seed ${seed}: no frame is under cover, so the comparison is vacuous`,
      ).toBeGreaterThan(0);
      expect(got.share, `seed ${seed}: the graph measured no cover at all`).toBeGreaterThan(0);

      const disagree: number[] = [];
      for (let i = 0; i < want.length; i++) {
        if (got.covered[i] !== want[i]) disagree.push(i);
        // The count is the raw material of the decision and the node
        // writes both, so the two are checked against each other: a mask
        // that agreed with the TypeScript while disagreeing with its own
        // hit count would mean the flag came from somewhere else.
        expect(got.hits[i]).toBeLessThanOrEqual(COVER.rays);
        expect(got.covered[i], `seed ${seed} frame ${i}: flag against its own count`).toBe(
          got.hits[i] >= COVER.minHits,
        );
      }
      expect(
        disagree.length,
        `seed ${seed}: frames disagreeing on cover: ${disagree.slice(0, 8).join(", ")}`,
      ).toBe(0);

      const report = measureEnclosure(lap, dressing.boxes);
      const d = Math.abs(got.share - report.share);
      worstShare = Math.max(worstShare, d);
      expect(d, `seed ${seed} enclosure share`).toBeLessThan(SHARE_TOL);
      frames += want.length;
      under += coveredFrames;
      shares += `${shares ? " " : ""}${(100 * got.share).toFixed(1)}%`;
    }

    console.log(
      `dress graph enclosure: ${frames} frames over ${SEEDS.length} seeds, ` +
        `${under} of them under cover (${shares}), masks identical, ` +
        `worst share delta ${worstShare.toExponential(2)}`,
    );
  }, FOUR_LAP_MS);
});

const dot3 = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
