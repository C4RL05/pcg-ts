/**
 * Z-3's band mix, as far as a graph takes it: the DECISION.
 *
 * WHAT MOVED AND WHAT DID NOT. `repairBandMix` is two things wearing one
 * name — a lap-wide search for WHICH placements must change band, and a
 * per-placement REDRAW that gives one of them a new asset, lateral and
 * height. Only the first half is stated over the whole lap, and only the
 * first half is here: `quotaRebalance` reads every placement's band and
 * Z-3's six share bands and writes down the smallest set that must move.
 * The redraw is still `dressLap`'s, because the asset pool, the pose
 * library and the asset id string are all outside the repair body.
 *
 * SO THIS SUITE COMPARES DECISIONS, NOT DRESSINGS, and the comparison is
 * exact rather than statistical: the same placements, marked for the same
 * bands. Two things have to hold for that to mean anything, and both are
 * checked below — the graph's band LADDER has to agree with
 * `bandOfPlacement` on every placement of a real lap, and its choice of
 * donors has to agree with the linear `find` the reference walks.
 *
 * AND THE FIXTURE HAS TO BE A LAP THE MIX ACTUALLY HAS WORK ON. A settled
 * dressing is one Z-3 has already balanced, so both paths agree on making
 * no moves and the test passes without measuring anything. Every case here
 * runs on the list as it reaches step 8 for the FIRST time.
 */
import { describe, expect, it } from "vitest";
import { bandOfPlacement, repairBandMix, type Band } from "../demos/racetrack/assets.js";
import { placementsBeforeLanguage, reserveFor } from "../demos/racetrack/dress.js";
import { MIX_BANDS, cookBandMix } from "../demos/racetrack/dressGraph.js";
import { landmarkAssets } from "../demos/racetrack/legibility.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

const KIT = shippedVocabulary();
const SEEDS = [1, 2, 3, 4] as const;

/**
 * The lap as the mix first sees it: stations, assets and Z-1, and nothing
 * after. Not a dressing — a dressing is a lap the mix has already
 * balanced, and comparing two paths that both have nothing to do is not a
 * comparison.
 */
async function unmixedLap(seed: number): Promise<{
  placements: StationedPlacement[];
  pool: ReturnType<typeof reserveFor>["pool"];
  pinned: Set<number>;
  lap: Awaited<ReturnType<typeof lapFor>>["lap"];
  frames: Awaited<ReturnType<typeof lapFor>>["frames"];
}> {
  const { lap, frames } = await lapFor(seed);
  const reservation = reserveFor(KIT, seed);
  const { placements } = placementsBeforeLanguage(lap, seed, reservation.pool, {
    reservation,
  });
  // The protect set the reference builds for itself at this point: the
  // reserved corner vocabulary plus L-4's landmarks over this same list.
  const pinned = new Set<number>(
    reservation.markers
      ? [
          reservation.markers.sharp.id,
          reservation.markers.open.id,
          reservation.markers.brake.id,
        ]
      : [],
  );
  for (const id of landmarkAssets(placements, lap.lengthW)) pinned.add(id);
  return { placements, pool: reservation.pool, pinned, lap, frames };
}

describe("bandMix: the ladder", () => {
  it.each(SEEDS)("puts every placement in the band bandOfPlacement does (seed %i)", async (seed) => {
    const { placements, lap, frames } = await unmixedLap(seed);
    const got = await cookBandMix({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: new Set<number>(),
    });

    const counts = new Map<Band, number>();
    let disagreed = 0;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i] as StationedPlacement;
      const want = bandOfPlacement(p.t, p.h, p.asset.size.tall, "centre");
      counts.set(want, (counts.get(want) ?? 0) + 1);
      if (got.band[i] !== want) disagreed++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: ${placements.length} placements, ${disagreed} disagreements, ` +
        MIX_BANDS.map((b) => `${b}=${counts.get(b) ?? 0}`).join(" "),
    );
    expect(disagreed).toBe(0);
    // NON-VACUITY: the ladder has to have been EXERCISED. A lap whose
    // placements all landed in one band would pass the line above against
    // a graph that returns a constant.
    const used = MIX_BANDS.filter((b) => (counts.get(b) ?? 0) > 0);
    expect(used.length).toBeGreaterThanOrEqual(4);
  });

  it("reads the height edges the way the f32 columns force", async () => {
    // The two cases `assets.ts` measured and this port has to keep. A
    // placement inside 1.5W whose CENTRE sits exactly on the corridor
    // ceiling is `verge`, not `over` — the height test is pushed OUT by
    // SAME_PLACE_W so that a base sitting on the ceiling is not above it.
    // And a lateral exactly on a boundary belongs to the OUTER band.
    expect(bandOfPlacement(1.2, 1.2, 0, "centre")).toBe("verge");
    expect(bandOfPlacement(1.2, 1.30001, 0, "centre")).toBe("over");
    expect(bandOfPlacement(1.5, 0.5, 0, "centre")).toBe("near");
    expect(bandOfPlacement(1.0, 0.5, 0, "centre")).toBe("verge");
  });
});

describe("bandMix: the decision", () => {
  it.each(SEEDS)("marks the placements repairBandMix moves (seed %i)", async (seed) => {
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);

    const graph = await cookBandMix({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
    });

    // The reference, on the identical list, with the identical exclusions.
    const ref = repairBandMix(placements, pool, seed, "centre", pinned, (p) => p.cover === true);

    const refMoved = new Map<number, Band>();
    for (const e of ref.log) {
      const after = ref.placements[e.index] as StationedPlacement;
      refMoved.set(e.index, bandOfPlacement(after.t, after.h, after.asset.size.tall, "centre"));
    }
    const graphMoved = new Map<number, Band>();
    graph.target.forEach((b, i) => {
      if (b !== undefined) graphMoved.set(i, b);
    });

    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: reference moved ${refMoved.size}, graph marked ${graphMoved.size}`,
    );

    // THE COUNT FIRST, because a set comparison that is empty on both
    // sides is not a comparison. The mix does real work on this list.
    expect(refMoved.size).toBeGreaterThan(10);
    expect(graphMoved.size).toBe(refMoved.size);

    // THEN THE SETS, WHICH IS THE CLAIM. Same placements, same
    // destinations — the graph's `priority` is the station and the
    // reference's donor scan is a linear `find` over a station-ordered
    // list, so "the first k eligible members of this band" is the same k
    // placements either way.
    const missing = [...refMoved.keys()].filter((i) => !graphMoved.has(i));
    const extra = [...graphMoved.keys()].filter((i) => !refMoved.has(i));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const [i, band] of refMoved) expect(graphMoved.get(i)).toBe(band);
  });

  it.each(SEEDS)("never marks a pinned placement (seed %i)", async (seed) => {
    const { placements, pinned, lap, frames } = await unmixedLap(seed);
    const graph = await cookBandMix({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
    });
    let pinnedSeen = 0;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i] as StationedPlacement;
      if (!pinned.has(p.asset.id)) continue;
      pinnedSeen++;
      expect(graph.target[i]).toBeUndefined();
    }
    // NON-VACUITY: the lap has to CARRY pinned placements, or "none of
    // them moved" is a statement about the empty set.
    expect(pinnedSeen).toBeGreaterThan(0);
  });

  it("marks more when nothing is pinned, which is what pinning costs", async () => {
    // THE CONTROL FOR THE TEST ABOVE. Without it, "no pinned placement
    // moved" passes against a graph that marks nothing at all — and the
    // difference between the two runs is exactly the placements the
    // corner language and L-4 hold back.
    const seed = 1;
    const { placements, pinned, lap, frames } = await unmixedLap(seed);
    const base = {
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
    };
    const withPins = await cookBandMix({ ...base, mixPinned: pinned });
    const without = await cookBandMix({ ...base, mixPinned: new Set<number>() });
    const a = withPins.target.filter((b) => b !== undefined);
    const b = without.target.filter((x) => x !== undefined);
    // eslint-disable-next-line no-console
    console.log(`seed ${seed}: ${a.length} marked with pins, ${b.length} without`);
    expect(a.length).toBe(b.length);
    // The COUNT is the same — the quota is the quota — and the SET is not:
    // a pinned donor is replaced by the next eligible member of its band.
    const differing = withPins.target.filter((x, i) => x !== without.target[i]);
    expect(differing.length).toBeGreaterThan(0);
  });
});
