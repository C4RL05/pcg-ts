/**
 * L-1's look-ahead cone, and the cull that enforces it.
 *
 * A THRESHOLD, so the gate is "nothing blocks the cone afterwards" rather
 * than any distribution. But the interesting question is the SECOND one:
 * what the cull costs. Dropping a blocker opens a gap and moves a band,
 * which is why §9 runs the cull before the fill and mix passes — and why
 * this file measures the damage rather than only the compliance.
 *
 * THE GEOMETRY IS TESTED SEPARATELY FROM THE RULE. `segmentHitsBox` is
 * ordinary slab-method intersection and can be checked against cases
 * whose answers are known by construction; the cull on top of it can
 * then be trusted to be asking the right question of a right answer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import { type Lap, placeAt, poseAt, readLap } from "../demos/road/lap.js";
import { makeTrackSpline } from "../demos/road/spline.js";
import {
  type Frame,
  type Occluder,
  SIGHTLINE,
  cullSightlines,
  defaultEyeStations,
  occludes,
  segmentHitsBox,
} from "../demos/road/sightline.js";
import { DEFAULT_KIT, kitPath } from "./support/kits.js";
import {
  type CurvatureBucket,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
} from "../demos/road/assets.js";
import { makeStations } from "../demos/road/stations.js";

const KIT = kitPath(DEFAULT_KIT);

const UNIT = {
  across: [1, 0, 0] as const,
  along: [0, 0, 1] as const,
  up: [0, 1, 0] as const,
};

describe("segment against box", () => {
  const half = [1, 1, 1] as const;
  const at = [0, 0, 0] as const;

  it("hits a box the segment passes through", () => {
    expect(segmentHitsBox([-5, 0, 0], [5, 0, 0], at, UNIT, half)).toBe(true);
  });

  it("misses a box the segment passes beside", () => {
    expect(segmentHitsBox([-5, 3, 0], [5, 3, 0], at, UNIT, half)).toBe(false);
  });

  it("misses a box the segment stops short of", () => {
    // The whole point of a SEGMENT rather than a ray: something behind
    // the far end of the cone is not in the cone.
    expect(segmentHitsBox([-5, 0, 0], [-2, 0, 0], at, UNIT, half)).toBe(false);
  });

  it("hits when the segment starts inside", () => {
    expect(segmentHitsBox([0, 0, 0], [9, 0, 0], at, UNIT, half)).toBe(true);
  });

  it("handles a segment parallel to a face without dividing by zero", () => {
    // Exactly parallel to the x slab and outside it: the degenerate case
    // the slab method has to special-case, and the one that returns NaN
    // if it does not.
    expect(segmentHitsBox([-5, 5, 0], [5, 5, 0], at, UNIT, half)).toBe(false);
    expect(segmentHitsBox([-5, 0.5, 0], [5, 0.5, 0], at, UNIT, half)).toBe(true);
  });

  it("respects the box's own axes, not the world's", () => {
    // A box of half-extent 1 turned 45 degrees about Y. The discriminating
    // point is on the world diagonal, and the arithmetic decides which way
    // round the answer goes rather than intuition — my first version of
    // this had it backwards.
    //
    //   world-aligned: (0.9, 0, 0.9) has |x| = |z| = 0.9 <= 1  -> INSIDE
    //   turned:        projected onto across = (r,0,r) gives
    //                  0.9r + 0.9r = 1.273 > 1                 -> OUTSIDE
    //
    // So the same short segment hits one box and misses the other, which
    // it could not do if the test were using world axes for both.
    const r = Math.SQRT1_2;
    const turned = {
      across: [r, 0, r] as const,
      along: [-r, 0, r] as const,
      up: [0, 1, 0] as const,
    };
    const from = [0.85, 0, 0.85] as const;
    const to = [0.95, 0, 0.95] as const;
    expect(segmentHitsBox(from, to, at, UNIT, half)).toBe(true);
    expect(segmentHitsBox(from, to, at, turned, half)).toBe(false);
  });
});

describe.skipIf(!KIT)("the look-ahead cull", () => {
  const kit = JSON.parse(readFileSync(KIT!, "utf8")) as { assets: PlaceableAsset[] };
  const assets = kit.assets.filter((a) => a.where);

  let cached: { lap: Lap; frameAt: (s: number, t: number, h: number) => Frame } | undefined;
  async function theLap(): Promise<NonNullable<typeof cached>> {
    if (cached) return cached;
    const spline = makeTrackSpline({ seed: 1 });
    const frames = firstGeometry(
      (await cook(buildRoadGraph({ spline, seed: 1 }))).outputs[OUTPUTS.frames] ?? [],
    );
    if (!frames) throw new Error("no frames");
    const lap = readLap(frames);
    cached = {
      lap,
      frameAt: (s, t, h) => {
        const pose = poseAt(lap, s * lap.halfWidth);
        return {
          p: placeAt(lap, { station: s, lateral: t, height: h }).p,
          dir: pose.dir,
          up: pose.up,
          across: pose.across,
        };
      },
    };
    return cached;
  }

  /** A lap's placements, in the shape the cull takes. */
  async function dressed(seed: number): Promise<(Occluder & { band: number })[]> {
    const { lap, frameAt } = await theLap();
    const stations = makeStations(lap.lengthW, seed);
    const out: (Occluder & { band: number })[] = [];
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      const pose = poseAt(lap, s * lap.halfWidth);
      const kx = pose.dir;
      void kx;
      // Curvature bucket at this station, from the lap's own radius.
      const bucket: CurvatureBucket = bucketOf(radiusAt(lap, s));
      const p = placeAsset(assets, bucket, seed, i);
      if (!p) continue;
      out.push({
        station: s,
        t: p.t,
        h: p.h,
        across: p.asset.size.across,
        along: p.asset.size.along,
        tall: p.asset.size.tall,
        band: 0,
      });
    }
    void frameAt;
    return out;
  }

  /** Local radius in W at a station, from the cooked frames' curvature. */
  function radiusAt(lap: Lap, stationW: number): number {
    const i = Math.min(
      lap.count - 1,
      Math.max(0, Math.round((stationW / lap.lengthW) * lap.count)),
    );
    const a = (i - 1 + lap.count) % lap.count;
    const b = (i + 1) % lap.count;
    const step = lap.length / lap.count;
    const k = Math.hypot(
      (lap.tangent[b * 3] - lap.tangent[a * 3]) / (2 * step),
      (lap.tangent[b * 3 + 1] - lap.tangent[a * 3 + 1]) / (2 * step),
      (lap.tangent[b * 3 + 2] - lap.tangent[a * 3 + 2]) / (2 * step),
    );
    return k > 1e-12 ? 1 / (k * lap.halfWidth) : Infinity;
  }

  it("clears the cone, and reports what that cost", async () => {
    const { lap, frameAt } = await theLap();
    const eyes = defaultEyeStations(lap.lengthW);
    const rows: string[] = [];
    for (const seed of [1, 2, 3]) {
      const before = await dressed(seed);
      const r = cullSightlines(before, lap.lengthW, frameAt, lap.halfWidth, eyes);
      rows.push(
        `  seed ${seed}: ${before.length} placed, ${r.blocking} blocked the cone ` +
          `(${(100 * r.blocking) / before.length}%) -> ${r.moved} moved out, ${r.dropped} dropped`,
      );
      // THE THRESHOLD. Nothing may block afterwards.
      for (const o of r.kept) {
        const blocks = eyes.some((s) => occludes(o, s, frameAt, lap.halfWidth));
        expect(blocks, `a kept placement still blocks at station ${o.station.toFixed(1)}`).toBe(
          false,
        );
      }
    }
    console.log([`L-1 cull, ${SIGHTLINE.aheadW}W cone from h=${SIGHTLINE.eyeW}W`, ...rows].join("\n"));
  }, 300_000);

  /**
   * THE CULL MUST ACTUALLY FIND SOMETHING.
   *
   * A cull that never fires is indistinguishable from a compliant
   * placement at the assertion level — the same failure as the corridor
   * rule that passed every test while being unreachable, and the reason
   * every repair in this demo now reports its fire count.
   */
  it("finds real occluders rather than passing vacuously", async () => {
    const { lap, frameAt } = await theLap();
    const r = cullSightlines(
      await dressed(1),
      lap.lengthW,
      frameAt,
      lap.halfWidth,
      defaultEyeStations(lap.lengthW),
    );
    expect(r.blocking).toBeGreaterThan(0);
  }, 300_000);

  /**
   * AND THE TEST MUST BE ABLE TO SEE A BLOCKER, which is a different
   * claim: a box planted squarely across the corridor at driver height
   * has to register, or the cull's zero would mean nothing.
   */
  it("detects a box planted in the corridor", async () => {
    const { lap, frameAt } = await theLap();
    const blocker: Occluder = {
      station: 40,
      t: 0,
      h: 0.6,
      across: 1.8,
      along: 1.8,
      tall: 1.8,
    };
    // From just behind it, inside the cone.
    expect(occludes(blocker, 36, frameAt, lap.halfWidth)).toBe(true);
    // From well past it, it is behind the eye and cannot block.
    expect(occludes(blocker, 60, frameAt, lap.halfWidth)).toBe(false);
  }, 300_000);
});
