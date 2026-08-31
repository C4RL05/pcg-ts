/**
 * THE SECOND REPAIR PASS: whether it CAN fire, not whether it has.
 *
 * `assemble` runs the repair body twice — once before L-6 places cover
 * (node `repair`, output `placementsFirst`) and once after it, over the
 * merged list (node `repairWithCover`, output `placements`). The second
 * pass has never removed a placement. Measured stage by stage over seeds
 * 1-6 of the shipped vocabulary: it drops ZERO of the 322-352 that arrive,
 * adds only L-6's 4-16 cover pieces, and L-6's own trim reports
 * `l6TrimMoved = 0` on every point of every seed because the lap never
 * reaches the enclosure ceiling that gates it. The one thing that moves
 * anywhere in six seeds is a single Z-3 band redraw on seed 3 — one
 * placement crossing from 2.95W to -1.21W — plus five of L-5's run-fit
 * DIAGNOSTIC columns (`edgeSlope`, `edgeResidual`, `edgeSpan`,
 * `edgeIndex`, `edgeCount`). Those five are the only columns that move on
 * a surviving placement: `edgeBand`, `edgeDrop`, `trackT`, `trackH`,
 * `stationW` and `conePushW` are bit-identical on every common id, which
 * reads as the cover pieces joining the runs the fit is taken over
 * without changing any placement's band or position.
 *
 * THAT PARAGRAPH IS A RECORD AND NOT A GATE. It was measured separately,
 * stage by stage over six laps; the suite below runs SEED 1 and
 * reproduces none of it. So it can go stale without anything here going
 * red, and a reader who needs it current has to re-measure rather than
 * trust it. It is written down because the alternative is that the next
 * person measures it again from nothing, and because the two claims the
 * suite DOES gate are about mechanism, which six laps could not have
 * established anyway.
 *
 * A PASS THAT NEVER RUNS IS INDISTINGUISHABLE FROM ONE THAT CANNOT, and
 * that is what this file is for. It was kept as insurance for a kit whose
 * cover sits lower, so the question is not "did it fire" but "what would
 * have to arrive for it to". Three things are separated below, because
 * they have three different answers:
 *
 *   1. THE BODY IS LIVE. Handed a population with work in it, the second
 *      pass's own body — `buildRoundGraph(..., { trim: true })`, which is
 *      the body `assemble` wraps as `repairWithCover` — pushes 46 of 329
 *      and, once those blockers are locked so the push ladder has no
 *      allowance, REMOVES all 46. So the pass is not dead code. Note what
 *      that took: on an unsettled lap the cull still drops nothing on its
 *      own, because every blocker clears inside the 6W ladder, so removal
 *      is a branch that needs L-3's lock and not merely a blocked cone.
 *   2. NOTHING L-6 ADDS CAN GIVE IT WORK, for three reasons that stack.
 *      `occlusionCull` tests a point against the sight CHORDS and never
 *      against another point, so a point that joins the cloud is not an
 *      occluder for anything already in it. The demo hands it
 *      `include: 1 - cover`, which takes a cover piece out of the subject
 *      set entirely, so it is not tested either. And `pushClearance` is 0,
 *      which is the only other channel by which one point reaches another
 *      — a nonzero clearance would make the appended pieces obstacles the
 *      push ladder has to step around, and this claim would stop holding.
 *      That third one hangs on a LITERAL 0 at `dressGraph.ts`, not on a
 *      small number: the node takes the widest clearance over the whole
 *      input cloud and switches to its greedy path if any point asks for
 *      one, so were `pushClearance` ever made a field, a single appended
 *      cover piece with a nonzero clearance would put EVERY other point
 *      on the greedy path at once. The margin here is exact, not narrow.
 *      Asserted here rather than argued: the same body is cooked over a
 *      settled lap with and without its cover, and L-1's output is
 *      compared point by point, against a control that moves one
 *      placement so the comparison has to prove it can see a difference.
 *   3. THE INSURANCE IS BUYABLE AFTER ALL, but not with the kit anyone
 *      expected. "Cover that sits lower" cannot be stated:
 *      `coverPlacements` floors a piece's centre at
 *      `CORRIDOR.ceilingW + tall/2` with a `max`, so the lowest UNDERSIDE
 *      any kit can state is 1.2W, and the graph port applies the same
 *      floor. But a rib ON that floor still reaches the cone once it is
 *      LONG enough, because the lap has +/-2.89W of relief and a rib is
 *      horizontal in the frame of its own station while the road falls
 *      away under its far end. Measured with L-1's own predicate: nothing
 *      blocks up to 32W of `along`, 1-4 ribs per seed block at 44W, 4-9 at
 *      60W. The longest asset in the shipped vocabulary is 10.29W and
 *      `coverCandidates` caps `across` but not `along`, so what holds the
 *      cone clear is a factor of four in the ART, not two constants.
 *
 * SO THERE IS EXACTLY ONE LOCK AND IT IS THE `include` GATE, which the
 * fixtures below leave SHUT because that is how the demo has it. That
 * matters more than it would if the geometry were the second lock it was
 * first written up as: (2) is the whole of the answer, and (3) is a margin
 * that moves when the vocabulary does. Someone adding a 44W cover asset
 * makes the geometry reachable and the pass still will not fire, because
 * the gate is shut; someone deleting the `include` param makes it fire on
 * that asset the same day. Both are measured, in that order of importance.
 *
 * WHAT THIS IS NOT. `tests/racetrackCoverSightline.test.ts` already gates
 * the exemption itself — that L-1, handed a cover piece it DOES block,
 * leaves it alone — by marking a real blocker and watching the verdict
 * flip. That is the rule; this is the pass. The two overlap on one fact
 * and are answering different questions, so neither subsumes the other.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry, type Geometry } from "pcg-ts";
import {
  DRESS_OUTPUTS,
  PLACEMENT,
  buildRoundGraph,
} from "../demos/racetrack/dressGraph.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { reserveMarkers, type StationedPlacement } from "../demos/racetrack/legibility.js";
import { FITTED, makeStationsDetailed } from "../demos/racetrack/stations.js";
import { bucketOf, placeAsset, type PlaceableAsset } from "../demos/racetrack/assets.js";
import { radiusAtW } from "../demos/racetrack/corners.js";
import {
  SIGHTLINE,
  defaultEyeStations,
  occludes,
  type Frame,
  type Occluder,
} from "../demos/racetrack/sightline.js";
import { CORRIDOR } from "../demos/racetrack/zones.js";
import { ENCLOSE, coverPlacements, type EnclosurePlan } from "../demos/racetrack/tunnels.js";
import { dressedLapFor, lapFor } from "./support/lap.js";
import { placeAt, poseAt, type Lap } from "../demos/racetrack/lap.js";

/** One seed. The claims are rules, and a second lap is a second copy of the same yes. */
const SEED = 1;

/** Two or three rounds, each well inside the default; stated anyway. */
const ROUND_MS = 120_000;

/** The pool `dressLap` reserves at this seed. */
function poolFor(seed: number): PlaceableAsset[] {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  return reserveMarkers(all, seed).pool;
}

/**
 * `dressLap`'s steps 0 to 2 — the list before any repair has run.
 *
 * The same construction `tests/racetrackCoverSightline.test.ts` uses, and
 * for the same reason: a settled lap is one L-1 has no work left on, so a
 * round cooked over it measures nothing.
 */
function beforeRepairs(lap: Lap, seed: number): StationedPlacement[] {
  const pool = poolFor(seed);
  const st = makeStationsDetailed(lap.lengthW, seed, FITTED);
  const out: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const p = placeAsset(pool, bucketOf(radiusAtW(lap, s)), seed, i);
    if (p) out.push({ ...p, station: s });
  }
  return out;
}

/** L-1's verdict on one placement, keyed on the id it came in with. */
interface Verdict {
  readonly t: number;
  readonly push: number;
  readonly cover: number;
}

function verdicts(geo: Geometry): Map<number, Verdict> {
  const pts = geo.attrs.point;
  const id = pts.require(PLACEMENT.id);
  const t = pts.require(PLACEMENT.t);
  const cover = pts.has(PLACEMENT.cover) ? pts.require(PLACEMENT.cover) : undefined;
  const push = pts.has(PLACEMENT.pushW) ? pts.require(PLACEMENT.pushW) : undefined;
  const out = new Map<number, Verdict>();
  for (let i = 0; i < pts.count; i++) {
    out.set(id.get(i), {
      t: t.get(i),
      push: push === undefined ? 0 : push.get(i),
      cover: cover === undefined ? 0 : cover.get(i),
    });
  }
  return out;
}

describe("the post-enclosure repair pass", () => {
  /**
   * The second pass's body, run bare for one round.
   *
   * `trim: true` IS WHAT MAKES IT THE SECOND PASS'S and not the first's —
   * `assemble` builds the two from the same `buildRepairBody` and the flag
   * is the only argument that differs. `buildRoundGraph` already exists
   * for exactly this, and its own doc makes the same argument for the trim
   * that this file makes for the pass: a rule no shipped lap reaches is a
   * rule a whole-lap suite would be green for after it had been deleted.
   *
   * Z-3 IS SWITCHED OFF THROUGH ITS OWN PARAMETER, by pinning the whole
   * pool so the mix has no donor. Not tidiness: the mix reads population
   * SHARES, so it is the one rule in the body that genuinely does see the
   * cover pieces arrive, and it is what moves the single placement that
   * moves on seed 3. Leaving it in would put its verdict inside a
   * comparison whose subject is L-1's.
   */
  const round = async (
    lap: Lap,
    frames: Geometry,
    placements: readonly StationedPlacement[],
    immovable: ReadonlySet<number> = new Set<number>(),
  ): Promise<Record<string, unknown[]>> => {
    const pool = poolFor(SEED);
    return (
      await cook(
        buildRoundGraph(
          {
            kit: shippedVocabulary(),
            lap,
            frames,
            placements,
            seed: SEED,
            immovable,
            mixPinned: new Set(pool.map((a) => a.id)),
            pool,
          },
          { trim: true },
        ),
        { outputs: [DRESS_OUTPUTS.placed, DRESS_OUTPUTS.culled, DRESS_OUTPUTS.placements] },
      )
    ).outputs as Record<string, unknown[]>;
  };

  /**
   * THE PASS IS LIVE, AND WHAT IT TAKES TO REMOVE IS NOT WHAT IT TAKES TO
   * ACT.
   *
   * Handed the unsettled list, the second pass's body pushes 46 of 329 and
   * drops NONE — every blocker clears inside L-1's 6W ladder, which is the
   * same thing the dress-graph suite found for the first pass's body. So
   * "the pass removes nothing" is true of an unsettled lap too, and a test
   * that only cooked one would have proved nothing about the settled case.
   *
   * REMOVAL NEEDS A BLOCKER THAT CANNOT BE MOVED, which in this demo is
   * L-3's braking marks: `immovable` sets `PLACEMENT.locked`, `locked`
   * sets `pushMax` to 0, and a blocker with no allowance is dropped rather
   * than shoved out of line. Locking the assets this lap's cone already
   * pushes is how the branch is reached — the same construction
   * `tests/racetrackDressGraph.test.ts` uses for the first pass's body,
   * pointed at the second's. The PAIRING is the test: the same list, the
   * same lap, one set changed, and the count goes down.
   */
  it("is live: handed a blocker it cannot move, the body removes placements", async () => {
    const { lap, frames } = await lapFor(SEED);
    const src = beforeRepairs(lap, SEED);
    expect(src.length, "this lap placed nothing to repair").toBeGreaterThan(0);
    expect(
      src.some((p) => p.cover),
      "the assembled list already carries cover, so this is not the population it claims to be",
    ).toBe(false);

    const open = await round(lap, frames, src);
    const arrived = firstGeometry(open[DRESS_OUTPUTS.placed] as never);
    const culled = firstGeometry(open[DRESS_OUTPUTS.culled] as never);
    if (!arrived || !culled) throw new Error("the round graph produced no placements");

    const openDropped = arrived.pointCount - culled.pointCount;
    const rows = verdicts(culled);
    const pushedIds = [...rows.entries()].filter(([, v]) => v.push !== 0).map(([id]) => id);
    expect(pushedIds.length, "L-1 pushed nothing, so there is no blocker to lock").toBeGreaterThan(
      0,
    );

    // Lock the assets whose placements the cone pushed. Not every copy of
    // them blocks, which is what keeps this an exception to the repair
    // rather than a ban on the asset — asserted below by the survivors.
    const locked = new Set(pushedIds.map((id) => src[id].asset.id));
    const shut = await round(lap, frames, src, locked);
    const shutCulled = firstGeometry(shut[DRESS_OUTPUTS.culled] as never);
    if (!shutCulled) throw new Error("the round graph produced no placements");
    const shutDropped = arrived.pointCount - shutCulled.pointCount;

    console.log(
      [
        `the second pass's body, one round over ${arrived.pointCount} unsettled placements`,
        `  pushMax open   pushed ${pushedIds.length}  dropped ${openDropped}`,
        `  blockers locked  dropped ${shutDropped}  (${locked.size} asset ids)`,
      ].join("\n"),
    );

    // THE REMOVAL BRANCH, REACHED. This is the whole answer to "a pass
    // that never runs is indistinguishable from one that cannot": it can.
    expect(shutDropped).toBeGreaterThan(openDropped);
    expect(shutCulled.pointCount).toBeLessThan(culled.pointCount);
    // And the lock is not a blanket removal: copies of the same assets
    // that never blocked are still here. This is what makes it an
    // exception to the REPAIR rather than a filter on the vocabulary.
    const survivors = verdicts(shutCulled);
    const stillPlaced = src.filter((p, i) => locked.has(p.asset.id) && survivors.has(i));
    expect(stillPlaced.length).toBeGreaterThan(0);
  }, ROUND_MS);

  it("but nothing L-6 appends can give it work — the cull's verdict is unchanged", async () => {
    const { lap, frames, dressing } = await dressedLapFor(SEED);
    const all = dressing.placements as readonly StationedPlacement[];
    // `dressLap` adds its cover INSIDE its own loop, so the settled list it
    // returns already carries the pieces. Splitting it is how this suite
    // reconstructs the two populations `assemble` shows the two passes:
    // the first sees the dressing, the second sees the dressing with cover
    // concatenated after it — which is `mergePoints`' order, and is why
    // the ids of the originals are the same in both cooks.
    const dressingOnly = all.filter((p) => !p.cover);
    const cover = all.filter((p) => p.cover);
    expect(cover.length, "this seed's lap has no cover, so there is nothing to append").toBeGreaterThan(0);
    expect(dressingOnly.length).toBeGreaterThan(cover.length);
    const merged = [...dressingOnly, ...cover];

    const [withoutCover, withCover] = [
      await round(lap, frames, dressingOnly),
      await round(lap, frames, merged),
    ];
    const a = firstGeometry(withoutCover[DRESS_OUTPUTS.culled] as never);
    const b = firstGeometry(withCover[DRESS_OUTPUTS.culled] as never);
    if (!a || !b) throw new Error("the round graph produced no placements");
    const before = verdicts(a);
    const after = verdicts(b);

    // EVERY ORIGINAL SURVIVES THE SAME WAY. Not "roughly the same count" —
    // the same ids, at the same lateral, with the same push, to the bit.
    // This is the claim that makes the second pass a no-op on this list,
    // and it is a claim about `occlusionCull`'s shape rather than about
    // this lap: the node tests a point against the sight chords and never
    // against another point, so a point that joins the cloud is not an
    // occluder for anything already in it.
    for (const [id, was] of before) {
      const now = after.get(id);
      expect(now, `cover being appended dropped placement ${id}, which L-1 had kept`).toBeDefined();
      if (now === undefined) continue;
      expect(now.t, `cover being appended moved placement ${id}`).toBe(was.t);
      expect(now.push, `cover being appended changed L-1's push on placement ${id}`).toBe(was.push);
    }

    // AND NOT ONE COVER PIECE IS TESTED. The `include` gate is `1 - cover`,
    // so a piece is carried through unmoved and in its place; a nonzero
    // push on one would mean the gate had been opened or deleted.
    const covered = [...after.values()].filter((v) => v.cover !== 0);
    expect(covered.length).toBe(cover.length);
    for (const v of covered) expect(v.push).toBe(0);

    // THE CONTROL, AND WITHOUT IT THE PARAGRAPH ABOVE IS WORTH NOTHING. A
    // settled lap's verdicts are "kept, unmoved" all the way down, so a
    // comparison of two settled cooks is 338 pairs of zeroes and would
    // read as "unchanged" for a `verdicts` that returned the wrong column,
    // or for two cooks of the same list. So the same comparison is run
    // against a population that IS different — one placement shoved 3W
    // across, which is a lateral no repair would produce — and it has to
    // report the difference before "no difference" means anything.
    //
    // IT IS THE WEAKEST CONTROL THAT STILL WORKS, and the limit is worth
    // naming rather than leaving for a reader to find. It changes exactly
    // ONE verdict, and that one is the placement that was edited — so it
    // shows `verdicts` reads a live column and that the join is real, and
    // it does NOT show the harness could see a change induced in some
    // OTHER placement. There is no control that could: with
    // `pushClearance` at 0 no such change exists to induce, which is the
    // claim itself. One differing verdict is what the independence claim
    // predicts, so the control is a check on the instrument and the
    // mechanism argument in the header is what carries the result.
    const nudged = merged.map((p, i) => (i === 0 ? { ...p, t: p.t + 3 } : p));
    const moved = firstGeometry(
      (await round(lap, frames, nudged))[DRESS_OUTPUTS.culled] as never,
    );
    if (!moved) throw new Error("the round graph produced no placements");
    const control = verdicts(moved);
    const differing = [...before.entries()].filter(([id, was]) => {
      const now = control.get(id);
      return now === undefined || now.t !== was.t || now.push !== was.push;
    });
    expect(
      differing.length,
      "the comparison cannot tell two different laps apart, so it cannot say they are the same",
    ).toBeGreaterThan(0);

    // Counted the way the control counts, so the two numbers in the line
    // below are the same statistic and can be read against each other.
    const same = [...before.entries()].filter(([id, was]) => {
      const now = after.get(id);
      return now !== undefined && now.t === was.t && now.push === was.push;
    }).length;
    console.log(
      [
        `appending ${cover.length} cover pieces to ${dressingOnly.length} settled placements`,
        `  ${before.size} verdicts in, ${same} unchanged, ${covered.length} cover pieces untested`,
        `  control: moving ONE placement 3W across changes ${differing.length} verdict(s)`,
      ].join("\n"),
    );
  }, ROUND_MS);

  /**
   * THE HEIGHT FLOOR, WHICH IS THE HALF OF THE GEOMETRY THAT DOES HOLD.
   *
   * `coverPlacements` sets a piece's centre to
   * `max(where.height.median, CORRIDOR.ceilingW + tall/2)` and the flare
   * only ever ADDS to it, so however low an asset states its measured
   * height, its UNDERSIDE comes out at or above `CORRIDOR.ceilingW`. The
   * graph port applies the identical floor, so there is no second,
   * unfloored producer of cover heights.
   *
   * The adversarial assets below are the ones a kit could not do worse
   * than: a stated height of zero, of a negative number, and of nothing at
   * all, across thicknesses from a sheet to five track widths. The
   * measured floor over the shipped seeds is far above this — the lowest
   * cover CENTRE over seeds 1-6 is 3.6105W and the lowest UNDERSIDE 2.158W
   * — so what is gated here is the bound, not the data.
   *
   * WHAT THIS DOES NOT PROVE is that the cone cannot reach a rib sitting
   * on that floor. The next test is that, and it is the one that came out
   * the other way round.
   */
  it("the height floor holds for any kit a caller could state", () => {
    const asset = (tall: number, height?: number): PlaceableAsset =>
      ({
        id: 9001,
        name: "adversarial",
        size: { across: 1.4, along: 2.2, tall },
        boxes: [{ min: [-0.7, -1.1, -tall / 2], max: [0.7, 1.1, tall / 2] }],
        where:
          height === undefined
            ? undefined
            : { height: { median: height, p10: height, p90: height } },
      }) as unknown as PlaceableAsset;

    const undersides: number[] = [];
    for (const tall of [0, 0.05, 0.4, 1.2, 3, 5]) {
      for (const height of [0, -50, 0.29, undefined]) {
        const plan: EnclosurePlan = {
          startW: 10,
          lengthW: 24,
          asset: asset(tall, height),
          columns: 3,
        };
        const pieces = coverPlacements(plan, 400, SEED);
        expect(pieces.length).toBeGreaterThan(0);
        for (const p of pieces) undersides.push(p.h - tall / 2);
      }
    }

    const lowest = Math.min(...undersides);
    // The floor is the corridor's ceiling, exactly — `coverPlacements` says
    // so and this is the check that it keeps saying so. The epsilon is
    // THIS TEST'S arithmetic and not the rule's: the rule adds `tall/2` to
    // 1.2 and the test subtracts it again, and `1.2 + 0.025 - 0.025` is
    // 1.1999999999999997 in f64. A tolerance of a billionth cannot hide a
    // cover piece 0.9W lower than it should be, which is what this is
    // guarding against.
    expect(lowest).toBeGreaterThan(CORRIDOR.ceilingW - 1e-9);
    // The flare lifts, never lowers, which is the other half of the floor.
    expect(ENCLOSE.flareRiseW).toBeGreaterThan(0);
    console.log(
      [
        "L-6's height floor, over adversarial kits",
        `  the lowest underside any kit can state  ${lowest.toFixed(2)} W` +
          `  (= CORRIDOR.ceilingW ${CORRIDOR.ceilingW.toFixed(2)})`,
        `  the eye the cone hangs from             ${SIGHTLINE.eyeW.toFixed(2)} W`,
      ].join("\n"),
    );
  });

  /**
   * AND THE CLEARANCE IS NOT A SECOND LOCK. THIS TEST REPLACES A CLAIM
   * THAT WAS WRONG, so it is worth writing down what was wrong with it.
   *
   * The claim was: `CORRIDOR.ceilingW` is 1.2W, `SIGHTLINE.eyeW` is 0.3W,
   * every chord runs from the eye DOWN to a target on the road surface,
   * therefore 0.9W of clearance no kit can close — "a property of two
   * constants in this repository, not of any asset's geometry". Both premises
   * are true and the conclusion does not follow, because THE LAP IS NOT
   * FLAT. `LAP.relief` is 26 against a half-width of 9, written as a
   * two-cycle sinusoid, so the surface swings +/-2.89W. A cover rib is
   * horizontal in the frame of ITS OWN station while the road falls away
   * under the far end of it, and a chord 0.3W above the road it is
   * actually over can pass a long way under a rib pinned to the datum of a
   * station behind. The clearance is between the rib and the road BENEATH
   * THE CHORD, and that is not the road the rib was floored against.
   *
   * `demos/racetrack/dressGraph.ts` said so already, in the paragraph
   * arguing for the exemption this file is about: "That is a coincidence
   * of two constants and not a rule — a lower kit, a taller eye or a fan
   * over a crest all reach it." A FAN OVER A CREST. The claim withdrawn
   * here contradicted a comment fifteen lines from the parameter it was
   * about.
   *
   * MEASURED, by running `occludes` — L-1's own predicate — over a rib
   * every 4W of six laps, at an underside of exactly `CORRIDOR.ceilingW`:
   *
   *     along     2.2   8   10.29   16   24   32     44        60
   *     ribs        0   0       0    0    0    0   1-4       4-9
   *
   * So the reachable lever is not a lower kit. It is a LONGER one, and the
   * threshold is somewhere between 32W and 44W of `along`. What protects
   * the demo is data: the longest asset in the shipped vocabulary is
   * 10.29W, a factor of about four short, and `coverCandidates` filters
   * candidates on their height and their ACROSS extent with no cap on
   * `along` at all. That is what this test gates — the margin, which can
   * change when the vocabulary does — rather than the two constants, which
   * cannot deliver it.
   */
  it("but the floor is not clearance: a long enough rib reaches the cone over a crest", async () => {
    const TALL = 0.4;
    /** Every 4W, which is finer than any cover run is short. */
    const ribs = (lap: Lap): number[] => {
      const out: number[] = [];
      for (let s = 0; s < lap.lengthW; s += 4) out.push(s);
      return out;
    };
    const blocking = async (along: number, h: number, seed: number): Promise<number> => {
      const { lap, frames } = await lapFor(seed);
      void frames;
      const at = (s: number, t: number, y: number): Frame => {
        const pose = poseAt(lap, s * lap.halfWidth);
        return {
          p: placeAt(lap, { station: s, lateral: t, height: y }).p,
          dir: pose.dir,
          up: pose.up,
          across: pose.across,
        };
      };
      const eyes = defaultEyeStations(lap.lengthW);
      let n = 0;
      for (const s of ribs(lap)) {
        const o: Occluder = { station: s, t: 0, h, across: 1.4, along, tall: TALL };
        if (eyes.some((e) => occludes(o, e, at, lap.halfWidth))) n++;
      }
      return n;
    };

    const SEEDS = [1, 2, 3, 4, 5, 6];
    const floor = CORRIDOR.ceilingW + TALL / 2;
    const rows: string[] = [];
    const at = async (along: number): Promise<number[]> =>
      Promise.all(SEEDS.map((s) => blocking(along, floor, s)));

    const shipped = Math.max(
      ...(shippedVocabulary().assets as unknown as { size: { along: number } }[]).map(
        (a) => a.size.along,
      ),
    );

    // THE CONTROL FIRST, because a "blocks nothing" row means nothing from
    // a harness that cannot see a blocker. A rib at 0.1W is squarely in
    // the cone and has to light every station up.
    const inTheCone = await blocking(2.2, 0.1, 1);
    const stations = ribs((await lapFor(1)).lap).length;
    expect(inTheCone).toBe(stations);

    // The shipped vocabulary's longest asset clears, on every seed.
    const atShipped = await at(shipped);
    rows.push(`  along ${shipped.toFixed(2)} W (longest shipped)  ribs blocking: ${atShipped.join(" ")}`);
    for (const n of atShipped) expect(n).toBe(0);

    // And so does three times it, which is the margin this rests on.
    const at32 = await at(32);
    rows.push(`  along 32.00 W                    ribs blocking: ${at32.join(" ")}`);
    for (const n of at32) expect(n).toBe(0);

    // BUT NOT FOUR TIMES IT. This is the assertion that makes the two
    // above mean something: the floor is held by the vocabulary's reach,
    // not by the corridor's ceiling, and here is where it gives.
    const at44 = await at(44);
    rows.push(`  along 44.00 W                    ribs blocking: ${at44.join(" ")}`);
    expect(at44.some((n) => n > 0)).toBe(true);

    console.log(
      [
        `cover at an underside of exactly CORRIDOR.ceilingW (${CORRIDOR.ceilingW} W),` +
          ` ${stations} ribs per lap, seeds ${SEEDS.join("")}`,
        ...rows,
        `  control: the same rib at h=0.1 blocks ${inTheCone}/${stations}`,
        `  nothing caps \`along\` in coverCandidates; the margin is ${(44 / shipped).toFixed(1)}x`,
      ].join("\n"),
    );
  }, 300_000);
});
