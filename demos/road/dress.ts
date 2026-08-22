/**
 * The whole pipeline, in §9's order.
 *
 * THE ORDER IS THE DESIGN, and getting it wrong makes the rules look
 * incompatible when they are only mis-sequenced:
 *
 *   1. stations      how many and where along  (D-1, D-5's curve)
 *   2. assets        which asset, from its own measured behaviour
 *   3. corridor      Z-1, by size
 *   4. sightline     L-1's cull — MOVES AND DROPS THINGS
 *   5. landmarks     L-4
 *   6. coverage      D-4 — closes the gaps the cull opened
 *   7. band mix      Z-3 — fixes the bands the cull moved
 *
 * Four and five remove and replace placements, so six and seven have to
 * come after them: a mix repaired before a cull is a mix repaired against
 * a lap that no longer exists. That is why the cull is not last even
 * though it is the strictest rule.
 *
 * EVERY REPAIR IS MINIMAL AND REPORTS ITS FIRE COUNT. A repair that never
 * runs is indistinguishable from a compliant generator at the assertion
 * level, and a repair that overshoots satisfies every bound while being
 * wrong — so each stage says how much it had to do.
 */
import {
  type CurvatureBucket,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
  repairBandMix,
} from "./assets.js";
import type { Kit, PlacedBox } from "./kit.js";
import type { Lap } from "./lap.js";
import { placeAt, poseAt } from "./lap.js";
import { type StationedPlacement, repairLandmarks } from "./legibility.js";
import { type Frame, cullSightlines, defaultEyeStations } from "./sightline.js";
import { makeStationsDetailed } from "./stations.js";
import { resolveCorridor } from "./zones.js";

/** What each stage had to do, so a page can show it. */
export interface DressStats {
  readonly placed: number;
  readonly gapRepairs: number;
  readonly corridorFixes: number;
  readonly blocked: number;
  readonly pushedOut: number;
  readonly dropped: number;
  readonly landmarkFixes: number;
  readonly mixMoves: number;
  readonly cookMs: number;
}

export interface Dressing {
  readonly boxes: PlacedBox[];
  readonly stats: DressStats;
}

/** Local corner radius in W at a station, from the cooked frames. */
export function radiusAtW(lap: Lap, stationW: number): number {
  const i = Math.min(lap.count - 1, Math.max(0, Math.round((stationW / lap.lengthW) * lap.count)));
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

/** The lap's own frame lookup, shared by every stage that needs one. */
export function frameLookup(lap: Lap): (s: number, t: number, h: number) => Frame {
  return (s, t, h) => {
    const pose = poseAt(lap, s * lap.halfWidth);
    return {
      p: placeAt(lap, { station: s, lateral: t, height: h }).p,
      dir: pose.dir,
      up: pose.up,
      across: pose.across,
    };
  };
}

/**
 * Dress a lap from a measured kit.
 *
 * The output is the same `PlacedBox` shape the reference log produces, so
 * a page can draw generated dressing and measured dressing with one
 * renderer — which is the only way a viewer can compare them fairly.
 */
export function dressLap(kit: Kit, lap: Lap, seed: number): Dressing {
  const t0 = performance.now();
  const assets = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const frameAt = frameLookup(lap);

  // 1. Stations.
  const st = makeStationsDetailed(lap.lengthW, seed);

  // 2. An asset per station, from its own measured behaviour, weighted by
  //    the curvature THERE. This is the only place curvature enters.
  let placements: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const bucket: CurvatureBucket = bucketOf(radiusAtW(lap, s));
    const p = placeAsset(assets, bucket, seed, i);
    if (p) placements.push({ ...p, station: s });
  }

  // 3. Z-1, by size. The asset's own lateral distribution reaches inside
  //    the corridor for some assets, which is what makes this reachable.
  let corridorFixes = 0;
  placements = placements.map((p) => {
    const baseH = p.h - p.asset.size.tall / 2;
    const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
    if (fixed.t === p.t && fixed.baseH === baseH) return p;
    corridorFixes++;
    return { ...p, t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
  });

  // 4. L-1's cull. Moves and drops, so everything that repairs a count or
  //    a share has to come after it.
  const cull = cullSightlines(
    placements.map((p) => ({
      station: p.station,
      t: p.t,
      h: p.h,
      across: p.asset.size.across,
      along: p.asset.size.along,
      tall: p.asset.size.tall,
      src: p,
    })),
    lap.lengthW,
    frameAt,
    lap.halfWidth,
    defaultEyeStations(lap.lengthW),
  );
  placements = cull.kept.map((o) => ({ ...o.src, t: o.t, h: o.h, station: o.station }));

  // 5. L-4.
  const marks = repairLandmarks(placements, assets, lap.lengthW, seed);
  placements = marks.placements;

  // 6-7. The share repairs, last, against the lap that actually exists.
  const mix = repairBandMix(placements, assets, seed);
  placements = mix.placements.filter((p): p is StationedPlacement => p !== undefined);

  // Finally: each placement's own box decomposition, put on the lap.
  const W = lap.halfWidth;
  const boxes: PlacedBox[] = [];
  for (const p of placements) {
    const frame = frameAt(p.station, p.t, p.h);
    const kitAsset = kit.assets.find((a) => (a as unknown as PlaceableAsset).id === p.asset.id) as
      | { boxes?: { min: number[]; max: number[]; role?: string; thickness?: number }[] }
      | undefined;
    for (const b of kitAsset?.boxes ?? []) {
      const c = [
        ((b.min[0] + b.max[0]) / 2) * W,
        ((b.min[1] + b.max[1]) / 2) * W,
        ((b.min[2] + b.max[2]) / 2) * W,
      ];
      boxes.push({
        centre: [
          frame.p[0] + frame.across[0] * c[0] + frame.dir[0] * c[1] + frame.up[0] * c[2],
          frame.p[1] + frame.across[1] * c[0] + frame.dir[1] * c[1] + frame.up[1] * c[2],
          frame.p[2] + frame.across[2] * c[0] + frame.dir[2] * c[1] + frame.up[2] * c[2],
        ],
        size: [
          Math.max((b.max[0] - b.min[0]) * W, 1e-3),
          Math.max((b.max[1] - b.min[1]) * W, 1e-3),
          Math.max((b.max[2] - b.min[2]) * W, 1e-3),
        ],
        basis: { across: frame.across, along: frame.dir, up: frame.up },
        role: b.role ?? "mass",
        thickness: b.thickness ?? 0,
      });
    }
  }

  return {
    boxes,
    stats: {
      placed: placements.length,
      gapRepairs: st.gapRepairs,
      corridorFixes,
      blocked: cull.blocking,
      pushedOut: cull.moved,
      dropped: cull.dropped,
      landmarkFixes: marks.moves,
      mixMoves: mix.moves,
      cookMs: performance.now() - t0,
    },
  };
}
