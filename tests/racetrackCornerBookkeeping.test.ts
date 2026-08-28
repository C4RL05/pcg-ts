/**
 * L-2's convert-or-add and L-3's displacement, as a graph.
 *
 * THIS ONE IS CHECKABLE EXACTLY, like the corner model and unlike the
 * three draws. Which placement a corner converts and which ones a ruler
 * displaces are decided by counting and comparing, with no draw anywhere
 * — so the graph and `placeCornerLanguage` must agree placement for
 * placement, and the suite asserts that rather than a distribution.
 *
 * THE REFERENCE IS TRANSCRIBED HERE RATHER THAN CALLED, and that is the
 * one thing worth defending. `placeCornerLanguage` decides the victims
 * and BUILDS the resulting list in one pass, so there is no way to ask it
 * "which index did corner 7 convert" — the answer is gone by the time it
 * returns. The loop below is that function's victim rule and nothing
 * else, lifted verbatim so the two can be compared where they actually
 * differ. It is a copy, and a copy is exactly what a differential test
 * needs: if it drifts from the original the end-to-end suites still
 * catch it, because they run the original.
 */
import { describe, expect, it } from "vitest";
import { buildCornerBookkeeping } from "../demos/racetrack/cornerGraph.js";
import { dressedLapFor } from "./support/lap.js";
import { cornersOf } from "../demos/racetrack/corners.js";
import {
  type VictimPlacement,
  cookCornerBookkeeping,
  cookCorners,
} from "../demos/racetrack/cornerGraph.js";
import { type Corner, SEVERITY, beforeEntryW } from "../demos/racetrack/corners.js";
import {
  BRAKING,
  MARKER,
  type StationedPlacement,
  placeCornerLanguage,
} from "../demos/racetrack/legibility.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
import { dressLap, reserveFor } from "../demos/racetrack/dress.js";
import { resolveCorridor } from "../demos/racetrack/zones.js";
import { cookLapPlacements } from "../demos/racetrack/assetGraph.js";
import { rand } from "../demos/racetrack/rand.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

const KIT = shippedVocabulary();

/** `placeCornerLanguage`'s victim rule, lifted so the picks are visible. */
function reference(
  placements: readonly VictimPlacement[],
  corners: readonly Corner[],
  lapW: number,
): { claimedBy: number[]; displacedBy: number[] } {
  const ord = placements.map((p) => p.assetOrd);
  const claimedBy = placements.map(() => -1);
  const displacedBy = placements.map(() => -1);
  const alive = placements.map(() => true);

  /** Counts over what is still on the lap, by whatever asset it now is. */
  const repeats = (): Map<number, number> => {
    const m = new Map<number, number>();
    for (let i = 0; i < ord.length; i++) {
      if (!alive[i]) continue;
      m.set(ord[i], (m.get(ord[i]) ?? 0) + 1);
    }
    return m;
  };
  const pick = (
    entryW: number,
    window: readonly [number, number],
    outside: number | undefined,
    counts: Map<number, number>,
  ): number => {
    let victim = -1;
    let victimCount = 1;
    for (let i = 0; i < placements.length; i++) {
      if (!alive[i] || claimedBy[i] >= 0) continue;
      if (ord[i] < 0) continue;
      const d = beforeEntryW(placements[i].station, entryW, lapW);
      if (d < window[0] || d > window[1]) continue;
      if (outside !== undefined && Math.sign(placements[i].t) !== outside) continue;
      const n = counts.get(ord[i]) ?? 0;
      if (n > victimCount) {
        victimCount = n;
        victim = i;
      }
    }
    return victim;
  };

  for (let ci = 0; ci < corners.length; ci++) {
    const c = corners[ci];
    const v = pick(
      c.entryW,
      MARKER.windowW as unknown as readonly [number, number],
      c.outside,
      repeats(),
    );
    if (v >= 0) {
      claimedBy[v] = ci;
      ord[v] = c.severity === "sharp" ? -1 : -2;
    }
  }
  const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW);
  for (let ti = 0; ti < tight.length; ti++) {
    for (let k = 0; k < BRAKING.count; k++) {
      const v = pick(
        tight[ti].entryW,
        BRAKING.windowW as unknown as readonly [number, number],
        undefined,
        repeats(),
      );
      if (v < 0) break;
      displacedBy[v] = ti;
      alive[v] = false;
    }
  }
  return { claimedBy, displacedBy };
}

/** The lap's placements, in the shape the bookkeeping reads. */
async function lapPlacements(
  seed: number,
): Promise<{ placements: VictimPlacement[]; corners: Corner[]; lapW: number }> {
  const { lap } = await lapFor(1);
  const { markers, pool } = reserveFor(KIT, seed);
  const decided = await cookLapPlacements({ lap, seed, pool, markers });
  const placements: VictimPlacement[] = [];
  for (let i = 0; i < decided.stations.stations.length; i++) {
    const ch = decided.choices[i];
    if (!ch) continue;
    placements.push({
      assetOrd: ch.assetIndex,
      station: decided.stations.stations[i],
      t: ch.t,
    });
  }
  return { placements, corners: await cookCorners({ lap }), lapW: lap.lengthW };
}

describe("cornerBookkeeping: against the rule it transcribes", () => {
  it.each([1, 2, 3, 4])("agrees placement for placement (seed %i)", async (seed) => {
    const { placements, corners, lapW } = await lapPlacements(seed);
    const got = await cookCornerBookkeeping({ placements, corners, lapW });
    const want = reference(placements, corners, lapW);
    expect(got.claimedBy).toEqual(want.claimedBy);
    expect(got.displacedBy).toEqual(want.displacedBy);
  });

  it("converts and displaces enough to be worth checking", async () => {
    // A DIFFERENTIAL TEST AGREES TRIVIALLY WHEN NEITHER SIDE DOES
    // ANYTHING, so the fixture has to be shown to exercise the rule. On
    // this lap both stages fire on most corners.
    const { placements, corners, lapW } = await lapPlacements(1);
    const got = await cookCornerBookkeeping({ placements, corners, lapW });
    const converted = got.claimedBy.filter((v) => v >= 0).length;
    const displaced = got.displacedBy.filter((v) => v >= 0).length;
    const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW).length;
    // eslint-disable-next-line no-console
    console.log(
      `${placements.length} placements, ${corners.length} corners (${tight} tight): ${converted} converted, ${got.added.length} added, ${displaced} displaced`,
    );
    expect(converted).toBeGreaterThan(3);
    expect(displaced).toBeGreaterThan(3);
    expect(converted + got.added.length).toBe(corners.length);
  });

  it("never takes the same placement twice, and never takes a marker", async () => {
    // THE FAILURE A PARALLEL PICK WOULD HAVE HAD. Two corners naming one
    // placement converts it twice and silently leaves one corner without
    // a marker, while converted + added still sums to the corner count --
    // so the sum is not the check, and this is.
    for (let seed = 1; seed <= 4; seed++) {
      const { placements, corners, lapW } = await lapPlacements(seed);
      const got = await cookCornerBookkeeping({ placements, corners, lapW });
      for (let i = 0; i < placements.length; i++) {
        expect(
          got.claimedBy[i] >= 0 && got.displacedBy[i] >= 0,
          `placement ${i} both converted and displaced`,
        ).toBe(false);
      }
      // Every corner appears at most once as a converter, and every tight
      // corner displaces at most `BRAKING.count`.
      const perCorner = new Map<number, number>();
      for (const v of got.claimedBy) if (v >= 0) perCorner.set(v, (perCorner.get(v) ?? 0) + 1);
      for (const [, n] of perCorner) expect(n).toBe(1);
      const perTight = new Map<number, number>();
      for (const v of got.displacedBy) if (v >= 0) perTight.set(v, (perTight.get(v) ?? 0) + 1);
      for (const [, n] of perTight) expect(n).toBeLessThanOrEqual(BRAKING.count);
    }
  });

  it("leaves an asset with one copy on the lap alone", async () => {
    // L-4's LANDMARKS ARE SAFE BY CONSTRUCTION, not by a protect set:
    // `victimCount` starts at 1 with a strict `>`, so an asset appearing
    // exactly once is never the most repeated anything. That is a rule
    // hiding in a loop initialiser, and this is where it is stated.
    const { placements, corners, lapW } = await lapPlacements(1);
    const counts = new Map<number, number>();
    for (const p of placements) counts.set(p.assetOrd, (counts.get(p.assetOrd) ?? 0) + 1);
    const singles = placements
      .map((p, i) => ({ i, one: (counts.get(p.assetOrd) ?? 0) === 1 }))
      .filter((r) => r.one)
      .map((r) => r.i);
    expect(singles.length).toBeGreaterThan(0);
    const got = await cookCornerBookkeeping({ placements, corners, lapW });
    for (const i of singles) {
      expect(got.claimedBy[i], `placement ${i} is a one-off`).toBe(-1);
      expect(got.displacedBy[i], `placement ${i} is a one-off`).toBe(-1);
    }
  });

  it("gives the same answer twice", async () => {
    const { placements, corners, lapW } = await lapPlacements(2);
    const a = await cookCornerBookkeeping({ placements, corners, lapW });
    const b = await cookCornerBookkeeping({ placements, corners, lapW });
    expect(b).toEqual(a);
  });

  it("answers an empty lap without a victim anywhere", async () => {
    const { corners, lapW } = await lapPlacements(1);
    const got = await cookCornerBookkeeping({ placements: [], corners, lapW });
    expect(got.claimedBy).toEqual([]);
    expect(got.displacedBy).toEqual([]);
    // Every corner's marker has to be added, since there was nothing to
    // convert -- which is `placeCornerLanguage`'s own answer too.
    expect(got.added.length).toBe(corners.length);
  });
});

describe("cornerBookkeeping: against the shipped function", () => {
  it.each([1, 2, 3, 4])("reports the same counts placeCornerLanguage does (seed %i)", async (seed) => {
    // THE TRANSCRIBED REFERENCE ABOVE IS MINE, so agreeing with it proves
    // the graph matches MY reading of the rule and nothing more. This
    // compares against the function that actually ships: it does not
    // expose which placement each corner took, but it does report how
    // many were converted, added and displaced, and those three numbers
    // cannot all be right by accident across four seeds.
    const { lap } = await lapFor(1);
    const { markers, pool } = reserveFor(KIT, seed);
    if (!markers) throw new Error("racetrackCornerBookkeeping: no markers reserved");
    const decided = await cookLapPlacements({ lap, seed, pool, markers });
    const stationed: StationedPlacement[] = [];
    const victims: VictimPlacement[] = [];
    for (let i = 0; i < decided.stations.stations.length; i++) {
      const ch = decided.choices[i];
      if (!ch) continue;
      const station = decided.stations.stations[i];
      stationed.push({ asset: pool[ch.assetIndex], t: ch.t, h: ch.h, station });
      victims.push({ assetOrd: ch.assetIndex, station, t: ch.t });
    }
    const corners = await cookCorners({ lap });
    const lang = placeCornerLanguage(
      stationed,
      corners,
      markers,
      lap.lengthW,
      seed,
      decided.language,
    );
    const got = await cookCornerBookkeeping({
      placements: victims,
      corners,
      lapW: lap.lengthW,
    });
    const converted = got.claimedBy.filter((v) => v >= 0).length;
    const displaced = got.displacedBy.filter((v) => v >= 0).length;
    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: graph ${converted}+${got.added.length}/-${displaced}, shipped ${lang.converted}+${lang.added}/-${lang.brakeDisplaced}`,
    );
    expect(converted).toBe(lang.converted);
    expect(got.added.length).toBe(lang.added);
    expect(displaced).toBe(lang.brakeDisplaced);
  });
});

describe("cornerBookkeeping: through dressLap", () => {
  it.each([1, 2, 3])("dresses the same lap either way (seed %i)", async (seed) => {
    // THE CLAIM THAT MATTERS, and the one only a seam can make: handing
    // `dressLap` the graph's bookkeeping must produce the SAME lap as
    // letting it search for itself. Nothing here is drawn, so this is an
    // equality rather than a range -- and it exercises the removal path,
    // which the graph does by marking and `dressLap` does by filtering
    // once, where the TypeScript splices as it goes.
    const { lap } = await lapFor(1);
    const reservation = reserveFor(KIT, seed);
    const { markers, pool } = reservation;
    if (!markers) throw new Error("racetrackCornerBookkeeping: no markers reserved");
    const decided = await cookLapPlacements({ lap, seed, pool, markers });

    const plain = dressLap(KIT, lap, seed, {
      reservation,
      stations: decided.stations,
      choices: decided.choices,
      language: decided.language,
    });

    // The list as it reaches step 4, which is what the bookkeeping's
    // indices name: stations, assets and Z-1, and nothing after.
    const victims: VictimPlacement[] = [];
    for (let i = 0; i < decided.stations.stations.length; i++) {
      const ch = decided.choices[i];
      if (!ch) continue;
      const asset = pool[ch.assetIndex];
      const baseH = ch.h - asset.size.tall / 2;
      const fixed = resolveCorridor(ch.t, baseH, asset.size.across, asset.size.tall);
      victims.push({
        assetOrd: ch.assetIndex,
        station: decided.stations.stations[i],
        t: fixed.t,
      });
    }
    const corners = await cookCorners({ lap });
    const booked = await cookCornerBookkeeping({
      placements: victims,
      corners,
      lapW: lap.lengthW,
    });
    const viaGraph = dressLap(KIT, lap, seed, {
      reservation,
      stations: decided.stations,
      choices: decided.choices,
      language: decided.language,
      bookkeeping: booked,
    });

    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: plain ${plain.stats.placed} placed L-2 ${plain.stats.markersConverted}+${plain.stats.markersAdded}, graph ${viaGraph.stats.placed} placed L-2 ${viaGraph.stats.markersConverted}+${viaGraph.stats.markersAdded}`,
    );
    expect(viaGraph.stats.markersConverted).toBe(plain.stats.markersConverted);
    expect(viaGraph.stats.markersAdded).toBe(plain.stats.markersAdded);
    expect(viaGraph.stats.brakeMarks).toBe(plain.stats.brakeMarks);
    expect(viaGraph.stats.placed).toBe(plain.stats.placed);
    // THE WHOLE LAP, not just the counts: the boxes are what the page
    // draws, and two laps with the same counts and different contents
    // would pass everything above.
    expect(JSON.stringify(viaGraph.boxes)).toBe(JSON.stringify(plain.boxes));
  });
});

describe("corner bookkeeping topology", () => {
  /**
   * THE GRAPH IS THE SAME GRAPH WHATEVER LAP IT IS GIVEN, and this is the
   * only assertion that says what the two convert/displace loops were
   * for.
   *
   * L-2's conversion and L-3's payment were both UNROLLED — a node stage
   * per corner, and per (corner, mark) — so a lap with nineteen corners
   * built a bigger graph than a lap with twelve. A graph whose shape
   * depends on the spline cannot be serialized once and re-run against
   * another track, which is the whole point of putting these rules in a
   * graph at all.
   *
   * Behaviour is checked against the reference everywhere else in this
   * file; what is checked here is the SHAPE, because that is the property
   * the rewrite bought and it is invisible to every other test. Both
   * loops passed their suites while still unrolled.
   */
  it("has the same nodes for laps with different corner counts", async () => {
    const shapes: { seed: number; corners: number; tight: number; nodes: number }[] = [];

    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { lap, dressing } = await dressedLapFor(seed);
      const corners = cornersOf(lap);
      const g = buildCornerBookkeeping({
        placements: dressing.placements.map((p) => ({
          assetOrd: 0,
          station: p.station,
          t: p.t,
        })),
        corners,
        lapW: lap.lengthW,
        seed,
      });
      shapes.push({
        seed,
        corners: corners.length,
        tight: corners.filter((c) => c.tightestW < SEVERITY.tightW).length,
        nodes: g.describe().nodes.length,
      });
    }

    // THE PREMISE, ASSERTED. If every lap happened to have the same corner
    // count the comparison below would hold for a graph that was still
    // unrolled, and would prove nothing at all.
    const cornerCounts = new Set(shapes.map((s) => s.corners));
    const tightCounts = new Set(shapes.map((s) => s.tight));
    expect(
      cornerCounts.size + tightCounts.size,
      `every lap has the same corner shape (${[...cornerCounts]} / ${[...tightCounts]}), ` +
        "so this test cannot tell an unrolled graph from a looped one",
    ).toBeGreaterThan(2);

    const nodeCounts = new Set(shapes.map((s) => s.nodes));
    expect(
      nodeCounts.size,
      "the bookkeeping graph's node count varies with the lap: " +
        shapes.map((s) => `seed ${s.seed} ${s.corners}c/${s.tight}t -> ${s.nodes} nodes`).join(", "),
    ).toBe(1);

    console.log(
      `corner bookkeeping: ${[...nodeCounts][0]} nodes for every lap — ` +
        shapes.map((s) => `${s.corners}c/${s.tight}t`).join(", "),
    );
  }, 120000);
});

/**
 * THE ANSWER IS A FACT ABOUT THE LAP, NOT ABOUT HOW THE CLOUD WAS STORED.
 *
 * WHY THIS EXISTS. `placeCornerLanguage` scans its list with a strict `>`,
 * so it keeps the FIRST occurrence of the maximum count -- in the order
 * that list is held, which is STATION order. The graph used to rank by row
 * index, which says the same thing only while the cloud happens to be
 * sorted. The dress graph's is not: `pointScatterOnPath` lays stations down
 * in an order unrelated to arc position, and the placements reach the
 * bookkeeping in it.
 *
 * WHAT THAT COST, MEASURED BEFORE THE FIX. Shuffling one lap's placements
 * left the same corners claiming the same NUMBER of victims but a different
 * SET -- two to six rows moved -- and moved L-3's displacement count as
 * well, 34 or 35 on seed 3, because a different pick leaves a different
 * candidate in the next window and a window that runs out stops early. Four
 * of six shuffles gave 34 where the station-ordered reference gives 35.
 *
 * So this is not a tidiness property. Until it held, the graph's answer and
 * the rule's answer differed by a placement on a real lap, and neither was
 * wrong -- they were answering with different orders.
 */
describe("cornerBookkeeping: the order of the list does not decide the answer", () => {
  it("gives the same claims and displacements however the list is ordered", async () => {
    let rowsCompared = 0;

    for (const seed of [1, 2, 3, 4]) {
      const { placements, corners, lapW } = await lapPlacements(seed);
      const straight = await cookCornerBookkeeping({ placements, corners, lapW });

      // Fisher-Yates on the demo's own stream, so the shuffle is a fixture.
      const perm = placements.map((_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand(seed, i, 0x9e11) * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      // THE PREMISE, ASSERTED. A shuffle that left the list alone would make
      // every comparison below hold for a stage that reads row order.
      const moved = perm.filter((v, i) => v !== i).length;
      expect(
        moved,
        `seed ${seed}: the shuffle left ${perm.length - moved} of ${perm.length} rows in place`,
      ).toBeGreaterThan(perm.length * 0.9);

      const jumbled = await cookCornerBookkeeping({
        placements: perm.map((k) => placements[k]),
        corners,
        lapW,
      });

      // MATCHED THROUGH THE PERMUTATION. Row i of the shuffled run is row
      // `perm[i]` of the straight one, so these are the same placements
      // asked the same question in a different order.
      for (let i = 0; i < perm.length; i++) {
        expect(
          jumbled.claimedBy[i],
          `seed ${seed}: placement ${perm[i]} is claimed by a different corner`,
        ).toBe(straight.claimedBy[perm[i]]);
        expect(
          jumbled.displacedBy[i],
          `seed ${seed}: placement ${perm[i]} is displaced by a different ruler`,
        ).toBe(straight.displacedBy[perm[i]]);
        rowsCompared++;
      }

      // AND THE RULE FIRED, so the agreement is not two empty answers.
      expect(
        straight.claimedBy.filter((v) => v >= 0).length,
        `seed ${seed}: nothing was claimed`,
      ).toBeGreaterThan(3);
      expect(
        straight.displacedBy.filter((v) => v >= 0).length,
        `seed ${seed}: nothing was displaced`,
      ).toBeGreaterThan(3);
    }

    // eslint-disable-next-line no-console
    console.log(`cornerBookkeeping order invariance: ${rowsCompared} placements matched`);
  }, 120000);
});

/**
 * TWO CONSTANTS CUT THE SAME SET OF CORNERS, and nothing said so.
 *
 * `cornerGraph` filters tight corners with `SEVERITY.tightW` and
 * `placeCornerLanguage` filters them with `BRAKING.tighterThanW`. They are
 * both 8 and they are declared in different files, so the agreement is a
 * coincidence that has held rather than a fact anything checks.
 *
 * WHAT WOULD HAPPEN IF THEY DIVERGED is worse than a count being off:
 * `VICTIM.displacedBy` holds an index into the TIGHT corner list, so the
 * two sides would number that list differently and a ruler's victim would
 * be attributed to a different corner -- with both sides still running,
 * both answers still plausible, and every existing comparison in this file
 * comparing two lists that no longer mean the same thing.
 */
describe("cornerBookkeeping: the two tight-corner thresholds", () => {
  it("are the same number", () => {
    expect(
      SEVERITY.tightW,
      "cornerGraph and legibility disagree about which corners are tight, " +
        "so `displacedBy` indexes two different lists",
    ).toBe(BRAKING.tighterThanW);
  });
});
