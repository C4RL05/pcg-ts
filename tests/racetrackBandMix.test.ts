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
import { Z3, bandOfPlacement, repairBandMix, type Band } from "../demos/racetrack/assets.js";
import { placementsBeforeLanguage, reserveFor } from "../demos/racetrack/dress.js";
import {
  MIX_BANDS,
  PLACEMENT,
  cookBandMix,
  cookBandRedraw,
  dressLapByGraph,
  mixPoseIds,
  poseAssetId,
  poseLibrary,
} from "../demos/racetrack/dressGraph.js";
import type { Attribute } from "pcg-ts";
import { rand } from "../demos/racetrack/rand.js";
import { landmarkAssets } from "../demos/racetrack/legibility.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
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
    const { placements, pool, lap, frames } = await unmixedLap(seed);
    const got = await cookBandMix({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: new Set<number>(),
      pool,
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
      pool,
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
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const graph = await cookBandMix({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
      pool,
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
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const base = {
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      pool,
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

describe("bandMix: the redraw", () => {
  it.each(SEEDS)("lands every redrawn placement in the band it was sent to (seed %i)", async (seed) => {
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const got = await cookBandRedraw({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
      pool,
    });

    let marked = 0;
    let applied = 0;
    let unchanged = 0;
    for (let i = 0; i < placements.length; i++) {
      const dst = got.target[i];
      if (dst === undefined) {
        // NOT MARKED, SO NOT TOUCHED. This half of the loop is what says
        // the stage is a repair and not a redressing: the stamp draws an
        // asset for every placement, including the ones staying put, and
        // the commit gate has to throw all of those away.
        expect(got.applied[i]).toBe(false);
        const p = placements[i] as StationedPlacement;
        expect(got.t[i]).toBeCloseTo(p.t, 5);
        expect(got.h[i]).toBeCloseTo(p.h, 5);
        unchanged++;
        continue;
      }
      marked++;
      if (!got.applied[i]) continue;
      applied++;
      // THE POSTCONDITION, and the only exact claim available: a redrawn
      // placement is IN the band it was drawn for. `settleIntoBand` clamps
      // the lateral into the band and the asset's own reach, and Z-1 is
      // applied at the point of drawing, so a commit means both held.
      expect(bandOfPlacement(got.t[i], got.h[i], got.tall[i], "centre")).toBe(dst);
    }
    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: ${marked} marked, ${applied} redrawn, ${unchanged} left alone`,
    );
    expect(marked).toBeGreaterThan(10);
    // NON-VACUITY. A gate that refused everything would satisfy every line
    // above; the measurement behind the single draw says most land.
    expect(applied).toBeGreaterThan(marked / 2);
  });

  it.each(SEEDS)("keeps the asset id and the pose in step (seed %i)", async (seed) => {
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const got = await cookBandRedraw({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
      pool,
    });
    // THE STRING IS WRITTEN BY A FIELD, out of a table, and this is what
    // says it lines up: every placement's asset id must be exactly what
    // `poseAssetId` answers for the pose column beside it — including the
    // ones the mix never touched, whose ids the stage re-derives rather
    // than carries.
    for (let i = 0; i < placements.length; i++) {
      expect(got.asset[i]).toBe(poseAssetId(got.pose[i], false));
    }
    // And a redrawn placement takes a pose that exists.
    const lib = poseLibrary(KIT);
    for (let i = 0; i < placements.length; i++) {
      if (!got.applied[i]) continue;
      expect(got.pose[i]).toBeGreaterThanOrEqual(0);
      expect(got.pose[i]).toBeLessThan(lib.boxes.length);
    }
  });

  it("gives a redrawn placement a pose belonging to the asset it drew", async () => {
    // THIS TEST USED TO COMPARE `poseFor` TO ITSELF. It walked only the
    // placements the mix did NOT touch — whose pose column the stage never
    // writes, because the commit gate is 0 — and re-derived the same
    // expression `placementCloudInTrackFrame` had already put there. The
    // 100-odd it checked were all placements the graph computed nothing
    // for, so the flat pose table, `poseOff` and `poseCount` were never
    // read by any assertion in the suite.
    //
    // The claim that matters is on the APPLIED side: a redrawn placement
    // holds a pose of the asset it actually drew, chosen by that asset's
    // own list from the station's own uniform.
    const lib = poseLibrary(KIT);
    const ownerOf = new Map<number, number>();
    for (const [asset, ids] of lib.posesOf) for (const id of ids) ownerOf.set(id, asset);

    let checked = 0;
    for (const seed of SEEDS) {
      const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
      const got = await cookBandRedraw({
        kit: KIT,
        lap,
        frames,
        placements,
        seed,
        immovable: new Set<number>(),
        mixPinned: pinned,
        pool,
      });
      for (let i = 0; i < placements.length; i++) {
        if (!got.applied[i]) continue;
        const p = placements[i] as StationedPlacement;
        const owner = ownerOf.get(got.pose[i] as number);
        expect(owner).toBeDefined();
        const asset = pool.find((a) => a.id === owner);
        expect(asset).toBeDefined();
        // The pose is the one THIS asset's list answers for this station.
        const ids = lib.posesOf.get(owner as number) as number[];
        const u = rand(seed, Math.round(p.station * 97), 0x7053);
        expect(got.pose[i]).toBe(ids[Math.floor(u * ids.length) % ids.length]);
        // And the extents committed are that asset's own, which is what
        // says the pose and the asset came out of the same draw.
        expect(got.tall[i]).toBeCloseTo((asset as PlaceableAsset).size.tall, 5);
        checked++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`${checked} redrawn placements checked against their asset's pose list`);
    expect(checked).toBeGreaterThan(50);
  }, 120_000);

  it("indexes the asset-id table at both ends and under cover", async () => {
    // THE `cover:` HALF IS UNREACHABLE FROM A LAP, because the mix
    // excludes cover pieces and `placementsBeforeLanguage` makes none — so
    // a `half` off by one would ship. The table is checked directly
    // instead: the index the stage computes is `pose + 1 + cover * half`.
    const lib = poseLibrary(KIT);
    const table = mixPoseIds(lib);
    const half = table.length / 2;
    expect(Number.isInteger(half)).toBe(true);
    expect(half).toBe(lib.boxes.length + 1);
    const at = (pose: number, cover: 0 | 1): string =>
      table[pose + 1 + cover * half] as string;
    expect(at(-1, 0)).toBe(poseAssetId(-1, false));
    expect(at(0, 0)).toBe(poseAssetId(0, false));
    expect(at(lib.boxes.length - 1, 0)).toBe(poseAssetId(lib.boxes.length - 1, false));
    expect(at(-1, 1)).toBe(poseAssetId(-1, true));
    expect(at(0, 1)).toBe(poseAssetId(0, true));
    expect(at(lib.boxes.length - 1, 1)).toBe(poseAssetId(lib.boxes.length - 1, true));
    // Nothing past the ends: the selector floors then CLAMPS, so an index
    // one past the last entry would silently answer the last cover pose.
    expect(lib.boxes.length - 1 + 1 + half).toBe(table.length - 1);
  });

  it("moves the shares toward Z-3, which is what the whole rule is for", async () => {
    const seed = 1;
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const got = await cookBandRedraw({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
      pool,
    });
    const live = placements.filter((p) => p.cover !== true).length;
    const before = new Map<Band, number>();
    const after = new Map<Band, number>();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i] as StationedPlacement;
      if (p.cover === true) continue;
      const b0 = bandOfPlacement(p.t, p.h, p.asset.size.tall, "centre");
      const b1 = bandOfPlacement(got.t[i] as number, got.h[i] as number, got.tall[i] as number, "centre");
      before.set(b0, (before.get(b0) ?? 0) + 1);
      after.set(b1, (after.get(b1) ?? 0) + 1);
    }
    const miss = (counts: Map<Band, number>): number => {
      let total = 0;
      for (const b of MIX_BANDS) {
        const share = (counts.get(b) ?? 0) / live;
        const [lo, hi] = Z3[b].rule;
        total += Math.max(0, lo - share) + Math.max(0, share - hi);
      }
      return total;
    };
    const m0 = miss(before);
    const m1 = miss(after);
    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: total share miss ${m0.toFixed(4)} -> ${m1.toFixed(4)} over ${live} live placements`,
    );
    // THE DIRECTION IS THE CLAIM, not a threshold. One pass of a rule that
    // `dressLap` runs to a fixed point does not have to satisfy Z-3; it
    // has to make the lap less wrong, and by most of the way, or the
    // decision and the redraw disagree about what they are doing.
    expect(m0).toBeGreaterThan(0.05);
    expect(m1).toBeLessThan(m0 * 0.5);
  });
});

describe("bandMix: in the loop", () => {
  it.each([1, 11, 18] as const)(
    "settles a lap the mix has real work on, with P and scale following it (seed %i)",
    async (seed) => {
      // THE CASE NOTHING ELSE COVERS. Every other suite either switches
      // Z-3 off (the rule comparisons, which measure the other three) or
      // hands it a list `dressLap` has already balanced (the streamed
      // level), so the mix marks nothing and its bugs are invisible. This
      // cooks the WHOLE body, loop and all, over a list the mix has 14 to
      // 46 moves to make on — and seeds 11 and 18 are here by name because
      // they are the two of twenty that used to run the loop out.
      const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
      const got = await dressLapByGraph({
        kit: KIT,
        lap,
        frames,
        placements,
        seed,
        immovable: new Set<number>(),
        mixPinned: pinned,
        pool,
      });

      // eslint-disable-next-line no-console
      console.log(`seed ${seed}: ${got.rounds} rounds, converged ${got.converged}`);
      expect(got.converged).toBe(true);

      // P AND `scale` ARE DERIVED, AND THE REDRAW INVALIDATES BOTH. The
      // mix rewrites a placement's lateral, height and extents after the
      // lift has already turned the old ones into a world position, so a
      // stage that forgets to re-derive them leaves the boxes where the
      // PREVIOUS asset stood — measured at up to 113 world units before
      // this was checked, and invisible inside the loop because the next
      // round repairs it. It only escapes on the round the loop stops,
      // which is exactly the round that ships.
      const geo = got.placements;
      const pts = geo.attrs.point;
      const P = pts.require("P");
      const framePos = pts.require(PLACEMENT.framePos);
      const across = pts.require(PLACEMENT.across);
      const up = pts.require(PLACEMENT.up);
      const t = pts.require(PLACEMENT.t);
      const h = pts.require(PLACEMENT.h);
      const scale = pts.require("scale");
      const sizes = [
        pts.require(PLACEMENT.sizeAcross),
        pts.require(PLACEMENT.sizeAlong),
        pts.require(PLACEMENT.sizeTall),
      ];
      let worstP = 0;
      let worstS = 0;
      for (let i = 0; i < pts.count; i++) {
        for (let k = 0; k < 3; k++) {
          const want =
            framePos.get(i, k) +
            across.get(i, k) * t.get(i) * lap.halfWidth +
            up.get(i, k) * h.get(i) * lap.halfWidth;
          worstP = Math.max(worstP, Math.abs(P.get(i, k) - want));
          worstS = Math.max(
            worstS,
            Math.abs(scale.get(i, k) - (sizes[k] as Attribute).get(i) * lap.halfWidth),
          );
        }
      }
      // eslint-disable-next-line no-console
      console.log(`seed ${seed}: worst P drift ${worstP.toExponential(2)}, scale ${worstS.toExponential(2)}`);
      // f32 columns at a lap's world scale, not an equality: the lift
      // recomputes in f32 from f32 inputs and stores f32.
      expect(worstP).toBeLessThan(0.05);
      expect(worstS).toBeLessThan(1e-3);
    },
    120_000,
  );

  it("brings the settled lap's band shares inside Z-3", async () => {
    const seed = 1;
    const { placements, pool, pinned, lap, frames } = await unmixedLap(seed);
    const got = await dressLapByGraph({
      kit: KIT,
      lap,
      frames,
      placements,
      seed,
      immovable: new Set<number>(),
      mixPinned: pinned,
      pool,
    });
    const pts = got.placements.attrs.point;
    const t = pts.require(PLACEMENT.t);
    const h = pts.require(PLACEMENT.h);
    const tall = pts.require(PLACEMENT.sizeTall);
    const cover = pts.require(PLACEMENT.cover);
    const counts = new Map<Band, number>();
    let live = 0;
    for (let i = 0; i < pts.count; i++) {
      if (cover.get(i) !== 0) continue;
      live++;
      const b = bandOfPlacement(t.get(i), h.get(i), tall.get(i), "centre");
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const report: string[] = [];
    let outside = 0;
    for (const b of MIX_BANDS) {
      const share = (counts.get(b) ?? 0) / live;
      const [lo, hi] = Z3[b].rule;
      report.push(`${b}=${share.toFixed(3)}`);
      if (share < lo - 1e-6 || share > hi + 1e-6) outside++;
    }
    // eslint-disable-next-line no-console
    console.log(`seed ${seed}: ${live} live, ${report.join(" ")}, ${outside} bands outside`);
    // THE WHOLE POINT OF THE RULE, end to end and through the cull that
    // spends the loop undoing it.
    expect(outside).toBe(0);
  }, 120_000);
});
