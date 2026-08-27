/**
 * The racetrack's two-level World: the lap decides, the sectors draw.
 *
 * WHAT THIS SUITE IS FOR. `demos/racetrack/levels.ts` claims that cutting
 * the work between an unbounded lap level and `cellMode: "path"` sectors
 * costs nothing — that the union of the sectors is the whole lap, box for
 * box, rather than the whole lap to within a tolerance. That claim is only
 * worth making if it is tested as an EXACT one, so nothing here compares
 * with an epsilon: the transforms are compared as bytes.
 *
 * THE CLAIM IS STRUCTURAL, WHICH IS WHY IT CAN BE EXACT. A placement's
 * geometry is a pure function of that placement, so a sector reads no
 * neighbour and repairs nothing. If any repair ever moves back down onto
 * the sectors, these tests are the ones that stop being true, and they
 * should be made to fail rather than loosened — a windowed repair needs a
 * DIFFERENT claim (a stated halo and a measured drift), not a wider
 * epsilon on this one.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  World,
  buildInstanceBatches,
  cook,
  dataInput,
  firstGeometry,
  makeGeometryItem,
  setAttribute,
  spawnInstances,
  vec,
  type DataItem,
  type Geometry,
} from "pcg-ts";
import {
  DRESS_OUTPUTS,
  PLACEMENT,
  buildDressGraph,
  dressLapByGraph,
  poseAssetId,
  readEnclosure,
  type EnclosureReport,
} from "../demos/racetrack/dressGraph.js";
import { dressLap } from "../demos/racetrack/dress.js";
import { LEVELS, SECTOR_W, buildRacetrackLevels } from "../demos/racetrack/levels.js";
import type { Lap } from "../demos/racetrack/lap.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { dressedLapFor } from "./support/lap.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";

/** Cooking a lap and then driving a World round it is not a 5 s operation. */
const LAP_MS = 120_000;

const SEEDS = [1, 2, 3] as const;

/**
 * One instance, flattened so it can be compared and sorted.
 *
 * The 16 matrix elements are kept as the f32 values the spawner wrote,
 * joined into a string. That is a blunt key and it is the right one here:
 * two instances are the same instance when every bit of their transform
 * agrees, and a numeric tolerance would be exactly the thing this suite
 * exists to avoid.
 */
interface Instance {
  readonly assetId: string;
  readonly key: string;
}

function instancesOf(items: readonly DataItem[]): Instance[] {
  const out: Instance[] = [];
  for (const item of items) {
    if (item.kind !== "instances") continue;
    for (const batch of item.batches) {
      for (let i = 0; i < batch.count; i++) {
        const m = batch.transforms.subarray(i * 16, i * 16 + 16);
        out.push({ assetId: batch.assetId, key: Array.from(m).join(",") });
      }
    }
  }
  return out;
}

/** A multiset comparison: the same instances, however they were partitioned. */
function sortedKeys(list: readonly Instance[]): string[] {
  return list.map((v) => `${v.assetId}|${v.key}`).sort();
}

/**
 * The whole lap spawned in one piece — the reference the sectors are held to.
 *
 * IT IS THE SAME THREE NODES THE SECTOR GRAPH USES, minus the filter. A
 * reference that composed the transforms by hand would be a second
 * implementation of `composeTRS`, and a disagreement between the two would
 * read as a partitioning bug rather than as the arithmetic slip it was.
 */
async function spawnWhole(settled: Geometry, lap: Lap): Promise<Instance[]> {
  const g = new Graph(0);
  const src = g.add(dataInput, {}, "placements");
  g.setParam(src, "items", [makeGeometryItem(settled)]);
  const scaled = g.add(
    setAttribute,
    {
      name: "scale",
      tupleSize: 3,
      value: vec(lap.halfWidth, lap.halfWidth, lap.halfWidth),
    },
    "trackScale",
  );
  g.connect(src, "out", scaled, "in");
  const spawn = g.add(
    spawnInstances,
    { assetId: poseAssetId(0, false), assetAttr: PLACEMENT.asset },
    "spawn",
  );
  g.connect(scaled, "out", spawn, "in");
  g.output(spawn, "instances", "instances");
  return instancesOf((await cook(g)).outputs["instances"] ?? []);
}

/** The settled placement cloud, cooked the way the lap level cooks it. */
async function settledFor(
  seed: number,
  override?: readonly StationedPlacement[],
): Promise<{ settled: Geometry; lap: Lap }> {
  const { lap, frames, dressing } = await dressedLapFor(seed);
  const g = buildDressGraph({
    kit: shippedVocabulary(),
    lap,
    frames,
    placements: override ?? dressing.placements,
    mixPinned: dressing.mixPinned,
    seed,
    immovable: new Set<number>(),
    pool: dressing.pool,
  });
  const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placements] })).outputs;
  const settled = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
  if (!settled) throw new Error("the lap graph produced no placements");
  return { settled, lap };
}

/**
 * Drive a World once round the lap, collecting what each sector spawned.
 *
 * The anchor walks in even steps rather than jumping, because that is what
 * a car does and because a retention band only means anything against a
 * moving anchor. Every sector of a closed lap is wanted at some point in
 * one circuit, so the collected map is the whole circuit by the end.
 */
async function driveLap(
  seed: number,
  opts: {
    readonly steps?: number;
    readonly backwards?: boolean;
    readonly placements?: readonly StationedPlacement[];
  } = {},
): Promise<{ bySector: Map<number, Instance[]>; sectorCount: number; lap: Lap }> {
  const { lap, frames, dressing } = await dressedLapFor(seed);
  const built = buildRacetrackLevels({
    kit: shippedVocabulary(),
    lap,
    frames,
    placements: opts.placements ?? dressing.placements,
    seed,
    immovable: new Set<number>(),
    mixPinned: dressing.mixPinned,
    pool: dressing.pool,
  });

  const bySector = new Map<number, Instance[]>();
  const world = new World({
    seed,
    levels: built.levels,
    // Clear of the sector count, so a closed lap costs one cook per sector
    // for the session rather than re-cooking what it is about to reach.
    maxCellsPerLevel: built.sectorCount + 8,
    onCellReady(levelName, coord, outputs) {
      if (levelName !== LEVELS.dressing) return;
      bySector.set(coord[0], instancesOf(outputs["instances"] ?? []));
    },
  });

  const steps = opts.steps ?? built.sectorCount * 2;
  for (let i = 0; i < steps; i++) {
    const t = (opts.backwards ? steps - 1 - i : i) / steps;
    await world.update([0, 0, 0], { anchors: { [LEVELS.dressing]: t * lap.lengthW } });
  }
  return { bySector, sectorCount: built.sectorCount, lap };
}

/**
 * L-6's figures, off the lap LEVEL rather than off a cook.
 *
 * WHAT THIS IS ACTUALLY ABOUT, which is scheduling and not enclosure.
 * `dressLapByGraph` cooks the dress graph and hands its caller the four
 * enclosure numbers on the next line. The page does not cook it: it hands
 * the same graph to a `World` as the lap level, so the numbers arrive in
 * `onCellReady`, asynchronously, some frames after the panel was drawn.
 * That difference is the last thing that kept `demos/racetrack/main.ts`
 * running L-6 in TypeScript -- the rule was ported and tested, and what
 * was left was WHERE the stat is printed.
 *
 * SO THE CLAIM IS AN EQUALITY BETWEEN TWO SCHEDULES. Cook the graph and
 * read it; stream the graph and read the cell; the two report the same
 * lap. If they ever stop agreeing, the page is printing a number about a
 * lap it is not drawing, which is precisely the failure the TypeScript
 * stat had.
 *
 * THE INPUT IS DRESSED WITH `enclosure: "deferred"`, which is what the
 * page passes now. Without it `dressLap` builds the cover itself, the
 * level measures a lap that is already enclosed, its budget comes out
 * zero and it correctly adds nothing -- so every assertion here would
 * hold while the level's L-6 did no work at all. The bare-list check
 * below is what keeps that from passing quietly.
 */
describe("racetrack levels: the lap level reports the enclosure it built", () => {
  it(
    "publishes L-6's own figures, and a cook of the same graph agrees",
    async () => {
      for (const seed of SEEDS) {
        const { lap, frames, dressing } = await dressedLapFor(seed);
        const deferred = dressLap(shippedVocabulary(), lap, seed, {
          enclosure: "deferred",
          reservation: { markers: dressing.markers, pool: dressing.pool },
        });
        expect(
          deferred.placements.some((p) => p.cover),
          `seed ${seed}: "deferred" still added cover, so the level has nothing left to build`,
        ).toBe(false);

        const input = {
          kit: shippedVocabulary(),
          lap,
          frames,
          placements: deferred.placements,
          seed,
          immovable: new Set<number>(),
          mixPinned: dressing.mixPinned,
          pool: dressing.pool,
        };
        const built = buildRacetrackLevels(input);

        // THE LEVEL, READ THE WAY THE PAGE READS IT. `onCellReady` is the
        // page's only handle on the lap level's outputs, so the test takes
        // the same one rather than reaching into the World.
        let report: EnclosureReport | undefined;
        let reports = 0;
        const world = new World({
          seed,
          levels: built.levels,
          maxCellsPerLevel: built.sectorCount + 8,
          onCellReady(levelName, _coord, outputs) {
            if (levelName !== LEVELS.lap) return;
            reports++;
            report = readEnclosure(outputs, lap);
          },
        });
        // The lap level is one unbounded cell and it cooks on the first
        // update it is given room for; a handful of updates is slack, not
        // a poll for something that might never arrive.
        for (let i = 0; i < 4 && report === undefined; i++) {
          await world.update([0, 0, 0], { anchors: { [LEVELS.dressing]: 0 } });
        }
        expect(report, `seed ${seed}: the lap level never published its outputs`).toBeDefined();
        const got = report as EnclosureReport;
        expect(reports, `seed ${seed}: the unbounded lap level cooked more than once`).toBe(1);

        // L-6 DID SOMETHING, which is the assertion a green suite does not
        // otherwise make: a level that added no cover reports a share equal
        // to the one it started from and every other check here still holds.
        expect(got.coverPieces, `seed ${seed}: the lap level built no cover`).toBeGreaterThan(0);
        expect(got.coverStretches, `seed ${seed}: the pieces tile no run`).toBeGreaterThan(0);
        expect(
          got.share,
          `seed ${seed}: cover was built and the covered share did not rise`,
        ).toBeGreaterThan(got.shareBefore);

        // AND THE TWO SCHEDULES AGREE, exactly. Same graph, same input, one
        // cooked and one streamed: a tolerance here would be admitting that
        // the page and the suite measure different laps.
        const cooked = await dressLapByGraph(input);
        expect(got.share, `seed ${seed}: share`).toBe(cooked.share);
        expect(got.shareBefore, `seed ${seed}: shareBefore`).toBe(cooked.shareBefore);
        expect(got.coverPieces, `seed ${seed}: coverPieces`).toBe(cooked.coverPieces);
        expect(got.coverStretches, `seed ${seed}: coverStretches`).toBe(cooked.coverStretches);
        expect(Array.from(got.hits), `seed ${seed}: per-frame ray hits`).toEqual(
          Array.from(cooked.hits),
        );
        expect(got.covered, `seed ${seed}: per-frame cover mask`).toEqual(cooked.covered);

        // AND THE PANEL'S OTHER LINE HAS TO COME FROM HERE TOO, which is
        // the second half of the same scheduling problem. `dressLap` with
        // enclosure deferred hands over a SHORTER list than the level
        // settles -- short by the cover the level is about to build -- so
        // a page printing the prelude's count beside the level's cover
        // share would be describing two laps, and the count is what D-1's
        // verdict is computed from.
        expect(
          cooked.placements.pointCount,
          `seed ${seed}: the level settled no more than the prelude handed it, so nothing ` +
            `stops the panel taking its count from the prelude`,
        ).toBeGreaterThan(deferred.stats.placed);
        console.log(
          `seed ${seed}: prelude ${deferred.stats.placed} placements, level ` +
            `${cooked.placements.pointCount}; cover ${(100 * got.shareBefore).toFixed(1)}% -> ` +
            `${(100 * got.share).toFixed(1)}% in ${got.coverStretches} runs of ` +
            `${got.coverPieces} pieces; trims ${deferred.stats.enclosureTrims}`,
        );
      }
    },
    LAP_MS,
  );
});

describe("racetrack levels: the placement cloud carries its own asset id", () => {
  it(
    "every settled placement names a pose the asset map can answer for",
    async () => {
      for (const seed of SEEDS) {
        const { settled } = await settledFor(seed);
        const asset = settled.attrs.point.require(PLACEMENT.asset);
        expect(asset.type).toBe("string");
        expect(settled.pointCount).toBeGreaterThan(0);

        const pose = settled.attrs.point.require(PLACEMENT.pose);
        const cover = settled.attrs.point.require(PLACEMENT.cover);
        for (let i = 0; i < settled.pointCount; i++) {
          // The id has to agree with the pose column it was derived from,
          // AFTER the repair loop — which is the part worth testing. A
          // string that survived the carry but drifted from its pose would
          // draw the wrong mesh at the right place.
          expect(asset.getString(i)).toBe(poseAssetId(pose.get(i), cover.get(i) !== 0));
        }
      }
    },
    LAP_MS,
  );
});

describe("racetrack levels: the sectors partition the lap", () => {
  it(
    "every placement is spawned by exactly one sector",
    async () => {
      for (const seed of SEEDS) {
        const { bySector, sectorCount } = await driveLap(seed);
        expect(bySector.size).toBe(sectorCount);

        const { settled } = await settledFor(seed);
        const total = [...bySector.values()].reduce((n, v) => n + v.length, 0);
        // Exactly the placement count: not fewer (a boundary nobody
        // claimed) and not more (one claimed twice). A half-open
        // `[sMin, sMax)` is what makes both impossible, and f32-rounded
        // bounds are what make it true rather than nearly true.
        expect(total).toBe(settled.pointCount);
      }
    },
    LAP_MS,
  );

  it(
    "the union of the sectors is the whole lap, bit for bit",
    async () => {
      for (const seed of SEEDS) {
        const { bySector } = await driveLap(seed);
        const { settled, lap } = await settledFor(seed);

        const streamed = sortedKeys([...bySector.values()].flat());
        const whole = sortedKeys(await spawnWhole(settled, lap));
        expect(streamed).toEqual(whole);
      }
    },
    LAP_MS,
  );
});

describe("racetrack levels: a placement exactly on a seam", () => {
  it(
    "is claimed by the sector that starts there and not by the one that ends there",
    async () => {
      const seed = SEEDS[0];
      const { lap, dressing } = await dressedLapFor(seed);
      const sectorCount = Math.round(lap.lengthW / SECTOR_W);

      // THE CASE THE REAL LAPS DO NOT PRODUCE. Across every seed measured,
      // no generated placement lands within an f32 ulp of a sector bound,
      // so `lt` and `le` are indistinguishable on the shipped data and the
      // half-open rule goes untested by it. This moves placements onto the
      // seams deliberately, which is the only way the rule is exercised at
      // all — an ownership claim that is only true because the awkward
      // input never arrives is not an ownership claim.
      const bounds = Array.from({ length: sectorCount }, (_, k) =>
        Math.fround((k * lap.lengthW) / sectorCount),
      );
      const moved = dressing.placements.map((p, i) =>
        i < bounds.length ? { ...p, station: bounds[i] } : p,
      );

      const { settled } = await settledFor(seed, moved);
      const station = settled.attrs.point.require(PLACEMENT.station);
      const onSeam = new Set(bounds);
      let seamCount = 0;
      for (let i = 0; i < settled.pointCount; i++) {
        if (onSeam.has(station.get(i))) seamCount++;
      }
      // THE TEST PROVES ITS OWN PREMISE BEFORE IT ASSERTS ANYTHING. If the
      // bound arithmetic here ever drifts from the runtime's, the moved
      // placements stop landing on seams and every assertion below passes
      // for the wrong reason — silently, which is exactly how the version
      // of this test that did not check went green against a filter that
      // was wrong.
      expect(seamCount).toBeGreaterThan(0);

      const { bySector } = await driveLap(seed, { placements: moved });

      // PER-SECTOR IDENTITY, NOT A TOTAL. Counting everything and
      // comparing to the placement count says the sectors partition the
      // lap; it does not say WHICH sector took a seam, and an owner rule
      // of `(sMin, sMax]` keeps every total intact while moving every
      // seam placement one sector back. So the expectation is computed
      // per sector here, from the same half-open rule with the same last
      // bound inclusive, and compared sector by sector.
      const stations: number[] = [];
      for (let i = 0; i < settled.pointCount; i++) stations.push(station.get(i));
      const edge = [...bounds, lap.lengthW];
      for (let k = 0; k < sectorCount; k++) {
        const lo = edge[k];
        const hi = edge[k + 1];
        const want = stations.filter((v) =>
          k === sectorCount - 1 ? v >= lo && v <= hi : v >= lo && v < hi,
        ).length;
        expect({ sector: k, count: (bySector.get(k) ?? []).length }).toEqual({
          sector: k,
          count: want,
        });
      }
    },
    LAP_MS,
  );
});

describe("racetrack levels: the end of the table is owned", () => {
  it(
    "a station that rounds up onto the lap length still has a sector",
    async () => {
      const seed = SEEDS[0];
      const { lap, dressing } = await dressedLapFor(seed);

      // THE INPUT CLASS HALF-OPEN-EVERYWHERE LOSES. `stationW` is an f32
      // column and the station process works in f64, so a station
      // strictly below `lengthW` can round UP to exactly `lengthW` on the
      // way into the column. It then fails `lt` in the last sector and
      // `ge` in every other, and one placement vanishes with nothing
      // going red. The band is about half an f32 ulp, which is why no
      // generated lap has ever landed in it -- and why the case has to be
      // built rather than waited for.
      const atEnd = Math.fround(lap.lengthW);
      const nudged = Math.fround(lap.lengthW - 1e-6);
      const moved = dressing.placements.map((p, i) =>
        i === 0 ? { ...p, station: nudged } : i === 1 ? { ...p, station: atEnd } : p,
      );

      const { settled } = await settledFor(seed, moved);
      const station = settled.attrs.point.require(PLACEMENT.station);
      let atLength = 0;
      for (let i = 0; i < settled.pointCount; i++) {
        if (station.get(i) >= atEnd) atLength++;
      }
      // Again the premise first: if f32 stopped rounding these up, the
      // test would be exercising an ordinary interior station.
      expect(atLength).toBeGreaterThan(0);

      const { bySector } = await driveLap(seed, { placements: moved });
      const total = [...bySector.values()].reduce((n, v) => n + v.length, 0);
      expect(total).toBe(settled.pointCount);
    },
    LAP_MS,
  );
});

describe("racetrack levels: a sector does not depend on how it was reached", () => {
  it(
    "driving the lap backwards produces the identical sectors",
    async () => {
      const seed = SEEDS[0];
      const forward = await driveLap(seed);
      const backward = await driveLap(seed, { backwards: true });

      expect([...backward.bySector.keys()].sort()).toEqual([...forward.bySector.keys()].sort());
      for (const [sector, list] of forward.bySector) {
        // THE POINT OF THE WHOLE ARRANGEMENT, in one assertion: a sector's
        // content is a function of the sector, not of the anchor path that
        // wanted it, not of what had been cooked before it, and not of the
        // order the World happened to cook in.
        expect(sortedKeys(backward.bySector.get(sector) ?? [])).toEqual(sortedKeys(list));
      }
    },
    LAP_MS,
  );
});
