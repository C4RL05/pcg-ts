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
 * they come out in, which Z-1 branch fired, and the covered mask frame by
 * frame. Those are decisions rather than values, and a decision that
 * disagrees is a defect however small the number behind it was.
 */
import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { cook, firstGeometry, type Geometry } from "pcg-ts";
import {
  DRESS_OUTPUTS,
  COVER,
  buildDressGraph,
  dressLapByGraph,
} from "../demos/racetrack/dressGraph.js";
import { dressLap } from "../demos/racetrack/dress.js";
import { readLap, type Lap } from "../demos/racetrack/lap.js";
import { buildRoadGraph, OUTPUTS } from "../demos/racetrack/graph.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { ENCLOSURE, enclosureMask, measureEnclosure } from "../demos/racetrack/enclosure.js";
import { resolveCorridor } from "../demos/racetrack/zones.js";
import { SAME_PLACE_W } from "../demos/racetrack/tolerance.js";
import { bucketOf, placeAsset, type PlaceableAsset } from "../demos/racetrack/assets.js";
import { radiusAtW } from "../demos/racetrack/corners.js";
import { reserveMarkers, type StationedPlacement } from "../demos/racetrack/legibility.js";
import { FITTED, makeStationsDetailed } from "../demos/racetrack/stations.js";
import type { PlacedBox } from "../demos/racetrack/kit.js";

/** The seeds every comparison runs over. Four laps, not one. */
const SEEDS = [1, 2, 3, 4] as const;

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

interface Cooked {
  readonly lap: Lap;
  readonly frames: Geometry;
  readonly dressing: ReturnType<typeof dressLap>;
}

async function cookLap(seed: number): Promise<Cooked> {
  const spline = makeTrackSpline({ seed });
  const out = (await cook(buildRoadGraph({ spline, seed }))).outputs;
  const frames = firstGeometry(out[OUTPUTS.frames] ?? []);
  if (!frames) throw new Error("the road graph produced no frames");
  const lap = readLap(frames);
  return { lap, frames, dressing: dressLap(shippedVocabulary(), lap, seed, {}) };
}

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
      const got = await dressLapByGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: dressing.placements,
        seed,
      });

      cookMs += got.cookMs;
      // WHAT THE BROADCAST ACTUALLY COST, in the units the finding is
      // stated in. `copyToPoints` has no per-target source selection, so
      // the whole pose library is stamped on every placement and the
      // wrong copies are filtered out. The number is reported rather than
      // argued, because "it is a product of two counts" is an argument
      // and "it built 780,000 points to keep 1,985" is a measurement —
      // and the second is the one that says whether a per-target selector
      // is worth a node change.
      copies += got.stamped;

      const want: readonly PlacedBox[] = dressing.boxes;
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
  });

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
      const g = buildDressGraph({
        kit: shippedVocabulary(),
        lap,
        frames,
        placements,
        seed,
      });
      // Only the placement output: the box build and the coverage cast
      // are the other two tests' business, and cooking them here would
      // pay for a million-point broadcast to read two columns.
      const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placements] })).outputs;
      const cloud = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
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
  });

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
    const input = { kit: shippedVocabulary(), lap, frames, placements: dressing.placements, seed };

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
      const got = await dressLapByGraph({
        kit: shippedVocabulary(),
        lap,
        frames: cookedLap.frames,
        placements: dressing.placements,
        seed,
      });

      // The reference runs over the TypeScript's OWN boxes, not the
      // graph's: two measurements of one set of geometry is the question,
      // and feeding the reference the graph's boxes would fold the box
      // comparison into this one and hide which half disagreed.
      const want = enclosureMask(lap, dressing.boxes);
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
  });
});

const dot3 = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
