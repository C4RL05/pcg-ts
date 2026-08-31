/**
 * The racetrack's reference lap, cooked once per seed and shared.
 *
 * WHY IT IS HERE AND NOT IN EACH SUITE. Every `tests/racetrack*` file needs
 * the same seven lines — a spline, a road graph, a cook, the frames off the
 * `frames` output, a `readLap`, and usually a `dressLap` over the shipped
 * vocabulary. It had been written out five times, and the two newest suites
 * spelled it a sixth and seventh way while `tests/support/` already existed
 * for exactly this. The cost of that is not the lines: it is that changing
 * what "the reference lap" means takes seven edits, and missing one leaves
 * two suites measuring different laps while both stay green.
 *
 * AND IT IS MEMOIZED, WHICH IS THE LARGER HALF. Cooking a road graph is
 * hundreds of milliseconds, and across the suite seed 1's lap was being
 * cooked upwards of thirty times per run. The cache is keyed by seed and
 * lives for the process, which is safe for one reason worth stating: a
 * cooked lap is IMMUTABLE by the library's own contract — `readLap` copies
 * the columns it reads, and every consumer here treats the geometry as
 * read-only. A fixture that could be mutated by one test and observed by
 * the next would be a worse bug than the duplication it removed.
 *
 * The dressing is memoized separately, because several suites want the lap
 * without paying for a dressing they do not read.
 */
import { cook, firstGeometry, type Geometry } from "pcg-ts";
import { dressLap, type Dressing } from "../../demos/racetrack/dress.js";
import { buildRoadGraph, OUTPUTS } from "../../demos/racetrack/graph.js";
import { readLap, type Lap } from "../../demos/racetrack/lap.js";
import { makeTrackSpline } from "../../demos/racetrack/spline.js";
import { shippedVocabulary } from "../../demos/racetrack/vocabulary.js";

/** A cooked lap: the frames as geometry, and the reading of them. */
export interface CookedLap {
  readonly lap: Lap;
  readonly frames: Geometry;
}

const laps = new Map<number, Promise<CookedLap>>();
const dressings = new Map<number, Dressing>();

/** The lap for a seed, cooked at most once per process. */
export function lapFor(seed: number): Promise<CookedLap> {
  let hit = laps.get(seed);
  if (!hit) {
    hit = (async () => {
      const spline = makeTrackSpline({ seed });
      const out = (await cook(buildRoadGraph({ spline, seed }))).outputs;
      const frames = firstGeometry(out[OUTPUTS.frames] ?? []);
      if (!frames) throw new Error(`the road graph produced no frames for seed ${seed}`);
      return { lap: readLap(frames), frames };
    })();
    laps.set(seed, hit);
  }
  return hit;
}

/**
 * The lap for a seed, dressed from the shipped vocabulary.
 *
 * The shipped vocabulary rather than a local catalogue, deliberately: it
 * is the one every suite can reach, since the local catalogues are absent
 * from a plain checkout.
 */
export async function dressedLapFor(
  seed: number,
): Promise<CookedLap & { readonly dressing: Dressing }> {
  const cooked = await lapFor(seed);
  let dressing = dressings.get(seed);
  if (!dressing) {
    dressing = dressLap(shippedVocabulary(), cooked.lap, seed, {});
    dressings.set(seed, dressing);
  }
  return { ...cooked, dressing };
}
