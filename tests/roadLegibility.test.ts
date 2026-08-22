/**
 * L-4: a landmark in every tenth of the lap.
 *
 * A THRESHOLD, so the gate is that every stretch carries one afterwards —
 * and, as with every conserved-count repair here, that no move it made
 * was removable. Idempotence alone would pass a repair that swapped six
 * placements into one bare stretch and then halted.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import {
  type CurvatureBucket,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
} from "../demos/road/assets.js";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import { DEFAULT_KIT, KITS } from "../demos/road/kitSource.js";
import { type Lap, readLap } from "../demos/road/lap.js";
import {
  LANDMARK,
  type StationedPlacement,
  landmarkRepairIsMinimal,
  landmarksPerStretch,
  landmarksSatisfied,
  repairLandmarks,
  uniqueAssets,
} from "../demos/road/legibility.js";
import { makeStations } from "../demos/road/stations.js";
import { makeTrackSpline } from "../demos/road/spline.js";

const KIT = `<kit-dir>/${KITS[DEFAULT_KIT]}`;

describe.skipIf(!existsSync(KIT))("L-4, landmark uniqueness", () => {
  const kit = JSON.parse(readFileSync(KIT, "utf8")) as { assets: PlaceableAsset[] };
  const assets = kit.assets.filter((a) => a.where);

  let lap: Lap | undefined;
  async function theLap(): Promise<Lap> {
    if (!lap) {
      const frames = firstGeometry(
        (await cook(buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 })))
          .outputs[OUTPUTS.frames] ?? [],
      );
      if (!frames) throw new Error("no frames");
      lap = readLap(frames);
    }
    return lap;
  }

  function radiusAt(l: Lap, stationW: number): number {
    const i = Math.min(l.count - 1, Math.max(0, Math.round((stationW / l.lengthW) * l.count)));
    const a = (i - 1 + l.count) % l.count;
    const b = (i + 1) % l.count;
    const step = l.length / l.count;
    const k = Math.hypot(
      (l.tangent[b * 3] - l.tangent[a * 3]) / (2 * step),
      (l.tangent[b * 3 + 1] - l.tangent[a * 3 + 1]) / (2 * step),
      (l.tangent[b * 3 + 2] - l.tangent[a * 3 + 2]) / (2 * step),
    );
    return k > 1e-12 ? 1 / (k * l.halfWidth) : Infinity;
  }

  async function dressed(seed: number): Promise<StationedPlacement[]> {
    const l = await theLap();
    const stations = makeStations(l.lengthW, seed);
    const out: StationedPlacement[] = [];
    for (let i = 0; i < stations.length; i++) {
      const bucket: CurvatureBucket = bucketOf(radiusAt(l, stations[i]));
      const p = placeAsset(assets, bucket, seed, i);
      if (p) out.push({ ...p, station: stations[i] });
    }
    return out;
  }

  it("reports how bare the raw lap is, and what the repair costs", async () => {
    const l = await theLap();
    const rows: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const raw = await dressed(seed);
      const before = landmarksPerStretch(raw, l.lengthW);
      const r = repairLandmarks(raw, assets, l.lengthW, seed);
      const after = landmarksPerStretch(r.placements, l.lengthW);
      rows.push(
        `  seed ${seed}: ${uniqueAssets(raw).size} unique of ${raw.length} placed; ` +
          `per tenth ${before.join(",")} -> ${after.join(",")}; ` +
          `${r.wasBare.length} bare, ${r.moves} re-drawn`,
      );
    }
    console.log([`L-4, ${LANDMARK.tenths} stretches, ${LANDMARK.perStretch} landmark each`, ...rows].join("\n"));
    expect(rows.length).toBe(4);
  }, 300_000);

  it("leaves every stretch with a landmark", async () => {
    const l = await theLap();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = repairLandmarks(await dressed(seed), assets, l.lengthW, seed);
      // A stretch can be un-repairable when the kit runs out of unused
      // assets, so the gate is: every stretch that COULD be helped was.
      const after = landmarksPerStretch(r.placements, l.lengthW);
      const stillBare = after.filter((n) => n < LANDMARK.perStretch).length;
      expect(stillBare, `seed ${seed}: ${stillBare} stretches still bare`).toBe(0);
      expect(landmarksSatisfied(r.placements, l.lengthW)).toBe(true);
    }
  }, 300_000);

  it("makes no move it did not need, and settles", async () => {
    const l = await theLap();
    for (const seed of [1, 2, 3, 4]) {
      const r = repairLandmarks(await dressed(seed), assets, l.lengthW, seed);
      const { minimal, removable } = landmarkRepairIsMinimal(r, l.lengthW);
      expect(minimal, `seed ${seed}: ${removable.length} of ${r.moves} moves unnecessary`).toBe(
        true,
      );
      // And settled: a second pass has nothing to do.
      const again = repairLandmarks(r.placements, assets, l.lengthW, seed);
      expect(again.moves).toBe(0);
    }
  }, 300_000);

  /**
   * THE CHECK, PROVED ABLE TO FAIL — on a lap built to be exactly the
   * thing L-4 exists to prevent.
   *
   * One family covering everything is the documented failure of the
   * originals' worst tracks (54% of placements from a single family), and
   * a lap made entirely of repeats has no landmark anywhere. If the
   * detector cannot see that, its zero on a real lap means nothing.
   */
  it("sees a lap with no landmarks at all", async () => {
    const l = await theLap();
    const raw = await dressed(1);
    // Every placement the same asset: nothing appears exactly once.
    const monotonous = raw.map((p) => ({ ...p, asset: raw[0].asset }));
    expect(uniqueAssets(monotonous).size).toBe(0);
    expect(landmarksSatisfied(monotonous, l.lengthW)).toBe(false);
    expect(landmarksPerStretch(monotonous, l.lengthW).every((n) => n === 0)).toBe(true);

    // And the repair rescues it.
    const r = repairLandmarks(monotonous, assets, l.lengthW, 1);
    expect(r.wasBare.length).toBe(LANDMARK.tenths);
    expect(landmarksSatisfied(r.placements, l.lengthW)).toBe(true);
  }, 300_000);

  it("counts an asset used twice as no landmark at all", async () => {
    const l = await theLap();
    const raw = await dressed(1);
    const unique = [...uniqueAssets(raw)];
    expect(unique.length).toBeGreaterThan(0);
    // Duplicate one unique asset into another stretch: it stops being a
    // landmark, in BOTH places. Uniqueness is a property of the lap, not
    // of a placement, which is the part that makes a naive
    // "is this asset rare" check wrong.
    const id = unique[0];
    const at = raw.findIndex((p) => p.asset.id === id);
    const elsewhere = raw.findIndex((p, i) => i !== at && p.asset.id !== id);
    const copied = [...raw];
    copied[elsewhere] = { ...copied[elsewhere], asset: raw[at].asset };
    expect(uniqueAssets(copied).has(id)).toBe(false);
  }, 300_000);
});
