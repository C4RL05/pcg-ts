/**
 * L-3's GROUP CLEARANCE SEARCH, in both statements of the rule.
 *
 * WHAT IT IS FOR. The brake mark is locked -- `immovable` in the reference
 * pipeline, `pushMax: 0` in the graph -- so L-1 answers a blocked mark by
 * DELETING it rather than shoving it out of line. That is the right trade
 * for one object and the wrong outcome for a ruler, whose whole claim is
 * about the set of three: what a driver is left with is two marks where the
 * rule promised three. So the lateral is chosen for the SET, at draw time,
 * off the ladder L-1 would itself have walked -- the draw is rung 0, so a
 * corner that was already clear comes out bit-identical to the lap that had
 * no search in it, and a corner that was not gets one lateral all three
 * marks survive.
 *
 * WHY THE PREMISE IS ASSERTED AND NOT ASSUMED. "The search chose a later
 * rung" is only worth anything if the FIRST rung was genuinely blocked, and
 * "the marks survive" only if they would not have. Both halves are measured
 * here through the cull itself, from the same shipped function run twice --
 * once with the clearance question answerable and once not -- so nothing in
 * this file restates the draw or restates what blocked means.
 *
 * WHY THIS IS ITS OWN FILE. `racetrackCornerLanguage` is about what the two
 * paths DRAW and compares them quantity by quantity; this is about a
 * decision one of those draws now makes against a rule stated in a
 * different file, and it needs the sight cone, the cull and a dressed lap
 * to say anything. The two suites would share nothing but the lap fixture.
 */
import { describe, expect, it } from "vitest";
import {
  RULER_RUNGS,
  cookCornerLanguage,
  cookReserveMarkers,
} from "../demos/racetrack/cornerGraph.js";
import { cookCorners } from "../demos/racetrack/cornerGraph.js";
import {
  BRAKING,
  type StationedPlacement,
  brakingRulersSatisfied,
  chooseRulerLateral,
  placeCornerLanguage,
  rulerLateralLadder,
  rulerStations,
} from "../demos/racetrack/legibility.js";
import { SEVERITY } from "../demos/racetrack/corners.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
import { frameLookup, reserveFor } from "../demos/racetrack/dress.js";
import type { Lap } from "../demos/racetrack/lap.js";
import {
  SIGHTLINE,
  blocksCone,
  cullSightlines,
  defaultEyeStations,
} from "../demos/racetrack/sightline.js";
import { SAME_PLACE_W, SAME_STATION_W } from "../demos/racetrack/tolerance.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

const KIT = shippedVocabulary();
const POOL = (KIT.assets as unknown as PlaceableAsset[]).filter((a) => a.where);

/** L-1's question and L-1's answer, for one lap and one brake asset. */
function clearanceFor(lap: Lap, brake: PlaceableAsset) {
  const frameAt = frameLookup(lap);
  const eyes = defaultEyeStations(lap.lengthW);
  const box = (m: { station: number; t: number; h: number }) => ({
    station: m.station,
    t: m.t,
    h: m.h,
    across: brake.size.across,
    along: brake.size.along,
    tall: brake.size.tall,
  });
  return {
    clear: (m: { station: number; t: number; h: number }): boolean =>
      !blocksCone(box(m), lap.lengthW, frameAt, lap.halfWidth, eyes),
    /** What L-1 would do to these marks, `immovable` and all. */
    cull: (marks: readonly StationedPlacement[]) =>
      cullSightlines(
        marks.map((m) => box(m)),
        lap.lengthW,
        frameAt,
        lap.halfWidth,
        eyes,
        () => true,
      ),
  };
}

describe("L-3: the ruler clears the cone as a group", () => {
  it("steps a blocked ruler out until all three marks clear, and they then survive L-1", async () => {
    // SEED 5, BECAUSE IT IS THE ONE THAT BITES on this vocabulary through
    // `reserveFor`'s reservation: five of its ten tight corners draw a
    // lateral that puts at least one mark in the cone. Seeds 1, 2 and 4 are
    // clear at the draw and would make every assertion below vacuous, which
    // is what the premise checks are here to prevent.
    const seed = 5;
    const { lap } = await lapFor(seed);
    const corners = await cookCorners({ lap });
    const { markers, pool } = reserveFor(KIT, seed);
    if (!markers) throw new Error("racetrackRulerClearance: no markers reserved");
    const { clear, cull } = clearanceFor(lap, markers.brake);

    // A lap of ordinary placements to put the language onto, the same shape
    // `racetrackCornerLanguage` builds: the corner language needs something
    // to convert and something to displace, and none of that is the subject
    // here.
    const base = Array.from({ length: 300 }, (_, i) => ({
      asset: pool[i % pool.length],
      t: (i % 2 === 0 ? 1 : -1) * 2,
      h: 0.5,
      station: ((i + 0.5) / 300) * lap.lengthW,
    }));

    // THE SAME FUNCTION TWICE, which is what keeps the draw out of this
    // test. Omitting the clearance is exactly the path that existed before
    // the search, so `plain` IS the old lap rather than a reconstruction of
    // it, and the difference between the two is the whole subject.
    const plain = placeCornerLanguage(base, corners, markers, lap.lengthW, seed);
    const searched = placeCornerLanguage(
      base,
      corners,
      markers,
      lap.lengthW,
      seed,
      undefined,
      undefined,
      clear,
    );

    expect(plain.rulersStepped, "a run with no clearance question must not step").toBe(0);
    expect(
      searched.rulersStepped,
      `seed ${seed}: no ruler stepped, so nothing below is testing the search`,
    ).toBeGreaterThan(0);
    expect(searched.rulersFellBack, `seed ${seed}: a ruler ran out of ladder`).toBe(0);
    expect(searched.brakeAdded, "the search must not change how many marks exist").toBe(
      plain.brakeAdded,
    );

    const marksOf = (out: { placements: StationedPlacement[] }): StationedPlacement[] =>
      out.placements.filter((p) => p.asset.id === markers.brake.id);
    const before = marksOf(plain);
    const after = marksOf(searched);

    // THE PREMISE, MEASURED THROUGH THE CULL AND NOT THROUGH THE PREDICATE:
    // this is the number of marks L-1 would actually have deleted from the
    // drawn laterals, which is the thing the change exists to remove.
    const lost = cull(before).dropped;
    expect(lost, `seed ${seed}: the drawn laterals were already clear`).toBeGreaterThan(0);

    // AND THE ANSWER: nothing left for it to take.
    expect(cull(after).dropped, `seed ${seed}: the search chose a lateral L-1 still culls`).toBe(
      0,
    );

    // WHAT A STEP MAY AND MAY NOT DO. Stations are untouched -- the ladder
    // is lateral only, and a moved station would be a different ruler --
    // the side never changes, the move is outward, and it lands on a whole
    // rung rather than between two.
    const key = (m: StationedPlacement): string => m.station.toFixed(4);
    const byStation = new Map(before.map((m) => [key(m), m]));
    let moved = 0;
    for (const m of after) {
      const was = byStation.get(key(m));
      expect(was, `a mark moved to a station no drawn mark was at: ${key(m)}`).toBeDefined();
      if (!was) continue;
      expect(Math.sign(m.t), "a stepped mark changed sides").toBe(Math.sign(was.t));
      const step = Math.abs(m.t) - Math.abs(was.t);
      expect(step, "a mark stepped inward").toBeGreaterThanOrEqual(0);
      const rungs = step / SIGHTLINE.pushStepW;
      expect(Math.abs(rungs - Math.round(rungs)), "a mark landed between rungs").toBeLessThan(
        1e-6,
      );
      if (step > 0) moved++;
    }
    expect(moved, "the stepped rulers moved no marks").toBe(
      searched.rulersStepped * BRAKING.count,
    );

    // And the shipped gate agrees, which is the sentence a reader of the
    // rule cares about rather than any of the arithmetic above.
    expect(
      brakingRulersSatisfied(searched.placements, corners, markers, lap.lengthW).satisfied,
    ).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `L-3 group clearance, seed ${seed}: ${searched.rulersStepped}/${searched.tightCorners} rulers stepped, ${lost} marks L-1 would have taken, 0 taken now`,
    );
  });

  it("falls back to the draw when no rung of the ladder clears", () => {
    // THE FALLBACK IS UNREACHABLE ON THE SHIPPED VOCABULARY -- measured
    // zero over seeds 1-6, on both reservations and both paths -- so it is
    // tested directly rather than through a lap that cannot produce it. A
    // test driven by a lap would be a test that cannot fail. What must hold
    // is that a corner the ladder cannot solve is left exactly as it was,
    // which is the property that makes this change unable to make a corner
    // worse.
    const stations = [10, 14.5, 19];
    expect(chooseRulerLateral(2, 1, stations, 1, () => false)).toEqual({
      mag: 2,
      rung: 0,
      fellBack: true,
    });

    // The positive control, so "always false" is not the only thing this
    // function is ever asked. A predicate that clears only past a whole
    // number of rungs picks exactly that rung -- not the one before it, and
    // not the last one on the ladder.
    expect(chooseRulerLateral(2, 1, stations, 1, (m) => Math.abs(m.t) >= 3 - 1e-9)).toEqual({
      mag: 3,
      rung: 2,
      fellBack: false,
    });

    // AND EVERY MARK IS ASKED, NOT JUST THE FIRST. Getting this wrong is
    // the one way to write the search that still reports a clean lap: the
    // ruler would be placed for whichever mark happened to be tested and
    // the other two would go where they were told.
    const asked: number[] = [];
    chooseRulerLateral(2, 1, stations, 1, (m) => {
      asked.push(m.station);
      return true;
    });
    expect(asked).toEqual(stations);
  });

  it("offers the same candidates in both paths, candidate for candidate", () => {
    // THE CLAIM IS NOT "THE TWO REACH THE SAME ANSWER". Two ladders of
    // different lengths, or of the same length with a different step, agree
    // on every corner whose FIRST rung already cleared -- which is most
    // corners on most seeds -- and diverge only on the ones the search
    // exists for. So what is checked is the enumeration itself: same count,
    // same first rung, same offset at every k, same reach.
    //
    // THE GRAPH SAYS `RULER_MAG + rung * SIGHTLINE.pushStepW`; the rule
    // ACCUMULATES the step. Those are the same number only because the step
    // is a power of two. `RULER_RUNGS` is DERIVED from the ladder rather
    // than restated, so the count cannot drift; this pins the step and the
    // origin, which can.
    //
    // ACROSS THE WHOLE DRAWN BAND, not at one magnitude: the accumulation
    // and the multiplication could agree at 1.7 and part company at a draw
    // whose mantissa is less kind. `BRAKING.lateralW` is where the draw
    // actually lands, and the endpoints are included because that is where
    // a draw is least likely to have been tried by hand.
    const band = BRAKING.lateralW;
    const draws = [band[0], 1.7, (band[0] + band[1]) / 2, 2.4999999, band[1]];
    for (const drawn of draws) {
      const ladder = rulerLateralLadder(drawn);
      expect(ladder.length, `the graph walks a different number of rungs at ${drawn}`).toBe(
        RULER_RUNGS,
      );
      expect(ladder[0], `the draw must be rung 0 at ${drawn}`).toBe(drawn);
      for (let k = 0; k < ladder.length; k++) {
        expect(ladder[k], `rung ${k} at ${drawn} is not ${k} steps past the draw`).toBe(
          drawn + k * SIGHTLINE.pushStepW,
        );
      }
      expect(
        ladder[ladder.length - 1] - ladder[0],
        `the ladder at ${drawn} is not L-1's own reach`,
      ).toBe(SIGHTLINE.maxPushW);
    }
  });

  it("steps the graph's rulers too, and leaves them one line at the right stations", async () => {
    // THE GRAPH'S HALF OF THE SAME RULE, through the reservation the PAGE
    // ships -- which picks different assets from `reserveFor`, and is why
    // the seed that bites here is 2 and not the 5 above. What is asserted
    // is that the search FIRES and that firing it costs L-3 none of its own
    // invariants: three marks, one lateral, the stations `rulerStations`
    // names. Whether the marks then survive the page's own cull is
    // `tests/racetrackLevels`' assertion, because that needs the settled
    // lap and this cook has never seen one.
    const seed = 2;
    const { lap } = await lapFor(seed);
    const { markers } = await cookReserveMarkers({ assets: POOL, seed });
    if (!markers) throw new Error("racetrackRulerClearance: no markers reserved");
    const corners = await cookCorners({ lap });
    const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW);
    const lang = await cookCornerLanguage({ lap, seed, markers });

    expect(lang.rulers.length).toBe(tight.length * BRAKING.count);
    const stepped = new Set(lang.rulers.filter((r) => r.rung > 0).map((r) => r.corner));
    expect(
      stepped.size,
      `seed ${seed}: no ruler stepped, so the graph's search is not firing`,
    ).toBeGreaterThan(0);
    // L-2's markers have no ladder and must say so, or a reader counting
    // stepped rulers off this cook would count them too. The length guard
    // is not decoration: `[].every()` is `true`, so without it this passes
    // on a cook that produced no markers at all.
    expect(lang.markers.length).toBe(corners.length);
    expect(lang.markers.every((m) => m.rung === 0)).toBe(true);

    for (let ti = 0; ti < tight.length; ti++) {
      const marks = lang.rulers.slice(ti * BRAKING.count, (ti + 1) * BRAKING.count);
      expect(
        new Set(marks.map((m) => m.rung)).size,
        `tight corner ${ti}: its marks came off different rungs`,
      ).toBe(1);
      // AND OFF A RUNG THAT EXISTS. A graph walking one rung more than the
      // rule states would show up here and nowhere else: the extra rung is
      // only ever chosen on a corner the rule would have failed to solve.
      expect(marks[0].rung, `tight corner ${ti}: rung off the ladder`).toBeGreaterThanOrEqual(0);
      expect(marks[0].rung, `tight corner ${ti}: rung off the ladder`).toBeLessThan(RULER_RUNGS);
      const spread = Math.max(...marks.map((m) => m.t)) - Math.min(...marks.map((m) => m.t));
      expect(spread, `tight corner ${ti}: a stepped ruler is not one line`).toBeLessThan(
        SAME_PLACE_W,
      );
      const want = rulerStations(tight[ti], lap.lengthW);
      for (let k = 0; k < BRAKING.count; k++) {
        const apart = Math.abs(marks[k].station - want[k]);
        expect(
          Math.min(apart, lap.lengthW - apart),
          `tight corner ${ti} mark ${k}: the search moved a station`,
        ).toBeLessThan(SAME_STATION_W);
      }
      // THE BAND IS A CLAIM ABOUT THE DRAW, NOT ABOUT THE PLACEMENT. A
      // stepped ruler is deliberately outside `BRAKING.lateralW`; what must
      // still hold is that backing the rungs off lands inside it, which is
      // the graph having stepped a drawn magnitude rather than invented one.
      const mag = Math.abs(marks[0].t) - marks[0].rung * SIGHTLINE.pushStepW;
      expect(mag).toBeGreaterThanOrEqual(BRAKING.lateralW[0] - SAME_PLACE_W);
      expect(mag).toBeLessThanOrEqual(BRAKING.lateralW[1] + SAME_PLACE_W);
      expect(Math.sign(marks[0].t), `tight corner ${ti}: stepped onto the inside`).toBe(
        tight[ti].outside,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `L-3 group clearance in the graph, seed ${seed}: ${stepped.size}/${tight.length} rulers stepped`,
    );
  });
});
