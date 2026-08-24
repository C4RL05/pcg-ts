/**
 * L-4: a landmark in every tenth of the lap.
 *
 * A THRESHOLD, so the gate is that every stretch carries one afterwards —
 * and, as with every conserved-count repair here, that no move it made
 * was removable. Idempotence alone would pass a repair that swapped six
 * placements into one bare stretch and then halted.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import {
  type CurvatureBucket,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
} from "../demos/racetrack/assets.js";
import { OUTPUTS, buildRoadGraph } from "../demos/racetrack/graph.js";
import { DEFAULT_KIT, kitOrAbsent, kitPath } from "./support/kits.js";
import { type Lap, readLap } from "../demos/racetrack/lap.js";
import {
  BRAKING,
  LANDMARK,
  MARKER,
  type StationedPlacement,
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  landmarkRepairIsMinimal,
  landmarksPerStretch,
  landmarksSatisfied,
  markerCandidates,
  placeCornerLanguage,
  repairLandmarks,
  reserveMarkers,
  strictlyVertical,
  uniqueAssets,
} from "../demos/racetrack/legibility.js";
import { type Corner, cornersOf, radiusAtW } from "../demos/racetrack/corners.js";
import { makeStations } from "../demos/racetrack/stations.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";

const KIT_KEY = DEFAULT_KIT;
const KIT = kitPath(KIT_KEY);

describe.skipIf(!KIT)("L-4, landmark uniqueness", () => {
  const kit = kitOrAbsent<{ assets: PlaceableAsset[] }>(KIT_KEY);
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

/**
 * L-2 and L-3: the corner language.
 *
 * BOTH ARE THRESHOLDS AND BOTH ARE GUARANTEES ABOUT EVERY CORNER, so the
 * gates are "every corner has one" rather than any distribution — and, as
 * everywhere else here, each gate is first shown able to FAIL on a lap
 * built to break it. A marker rule that passes on a lap with the markers
 * deleted is not a rule.
 *
 * L-3 IS AN INVENTION and is tested as one. The source circuits have a
 * median of ZERO verticals in the window it fills, so there is no
 * measurement to match — only the rule's own text, which asks for three
 * evenly spaced marks. What is checked is therefore that they are a
 * RULER: three of them, on one line, with a spacing CV of zero, against
 * the 0.46 the source manages by accident on the 4% of corners where
 * three happen to fall there at all.
 */
describe.skipIf(!KIT)("L-2 and L-3, the corner language", () => {
  const kit = kitOrAbsent<{ assets: PlaceableAsset[] }>(KIT_KEY);
  const all = kit.assets.filter((a) => a.where);

  let cache: { lap: Lap; corners: Corner[] } | undefined;
  async function theTrack(): Promise<NonNullable<typeof cache>> {
    if (!cache) {
      const frames = firstGeometry(
        (await cook(buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 })))
          .outputs[OUTPUTS.frames] ?? [],
      );
      if (!frames) throw new Error("no frames");
      const lap = readLap(frames);
      cache = { lap, corners: cornersOf(lap) };
    }
    return cache;
  }

  /** A lap dressed from the pool the reservation leaves behind. */
  async function spoken(seed: number) {
    const { lap, corners } = await theTrack();
    const { markers, pool } = reserveMarkers(all, seed);
    if (!markers) throw new Error("kit supplied no markers");
    const stations = makeStations(lap.lengthW, seed);
    const raw: StationedPlacement[] = [];
    for (let i = 0; i < stations.length; i++) {
      const bucket: CurvatureBucket = bucketOf(radiusAtW(lap, stations[i]));
      const p = placeAsset(pool, bucket, seed, i);
      if (p) raw.push({ ...p, station: stations[i] });
    }
    const lang = placeCornerLanguage(raw, corners, markers, lap.lengthW, seed);
    return { lap, corners, markers, pool, raw, lang };
  }

  /**
   * THE CANDIDATE SET, AND WHY IT IS NOT UPSTREAM'S.
   *
   * Their test is proportions AND a measured height median in 1-2W. On
   * this kit that leaves exactly three assets — the bare minimum the
   * language needs — which makes the choice between them degenerate and
   * puts the rule one asset away from silently doing nothing. Proportions
   * alone leave eight. This test exists to keep both numbers visible, so
   * that if their validator applies the strict form the difference is a
   * known quantity rather than a surprise.
   */
  it("reports the vocabulary the kit can supply", () => {
    const loose = markerCandidates(all);
    const strict = all.filter(strictlyVertical);
    console.log(
      `L-2 vocabulary from ${all.length} placeable assets: ` +
        `${loose.length} verticals by proportion, ${strict.length} of those also with a ` +
        `height median in ${MARKER.heightMedianW[0]}-${MARKER.heightMedianW[1]}W\n` +
        loose
          .map(
            (a) =>
              `  id=${a.id} tall=${a.size.tall.toFixed(2)} ` +
              `foot=${Math.max(a.size.across, a.size.along).toFixed(2)} ` +
              `hMedian=${a.where?.height.median.toFixed(2)} ` +
              `instances=${a.instances}${strictlyVertical(a) ? " *strict" : ""}`,
          )
          .join("\n"),
    );
    expect(loose.length).toBeGreaterThanOrEqual(3);
    // The strict set being SMALLER is the finding; if it ever stops being
    // smaller the comment above has gone stale.
    expect(strict.length).toBeLessThan(loose.length);
  });

  it("reserves three distinct assets, deterministically", async () => {
    for (const seed of [1, 2, 3, 4]) {
      const a = reserveMarkers(all, seed);
      const b = reserveMarkers(all, seed);
      expect(a.markers).toBeDefined();
      expect(a.markers).toEqual(b.markers);
      const ids = [a.markers!.sharp.id, a.markers!.open.id, a.markers!.brake.id];
      expect(new Set(ids).size).toBe(3);
      // And the pool no longer contains any of them.
      expect(a.pool.some((x) => ids.includes(x.id))).toBe(false);
      expect(a.pool.length).toBe(all.length - 3);
    }
  });

  it("puts a marker before every corner, on the outside, in the window", async () => {
    for (const seed of [1, 2, 3, 4]) {
      const { lap, corners, markers, lang } = await spoken(seed);
      const r = cornerMarkersSatisfied(lang.placements, corners, markers, lap.lengthW);
      expect(r.satisfied, `seed ${seed}: corners ${r.missing.join(",")} unmarked`).toBe(true);
    }
  }, 300_000);

  /**
   * EXCLUSIVITY, which is the property that makes L-2 work at all.
   *
   * An object that also appears sixty times as ordinary scenery does not
   * announce a corner, whatever the rule says about placing it there. So
   * the check is not "is the marker present" but "does the marker appear
   * ANYWHERE ELSE" — and it is enforced by construction, by removing the
   * three from the pool before a station is dressed.
   */
  it("uses the reserved assets nowhere but the corners", async () => {
    for (const seed of [1, 2, 3]) {
      const { lap, corners, markers, lang } = await spoken(seed);
      const tight = corners.filter((c) => c.tightestW < BRAKING.tighterThanW);
      const count = (id: number) => lang.placements.filter((p) => p.asset.id === id).length;
      // One marker per corner of the matching severity, and nothing more.
      const sharp = corners.filter((c) => c.severity === "sharp").length;
      const open = corners.length - sharp;
      expect(count(markers.sharp.id), `seed ${seed} sharp markers`).toBe(sharp);
      expect(count(markers.open.id), `seed ${seed} open markers`).toBe(open);
      expect(count(markers.brake.id), `seed ${seed} brake marks`).toBe(
        tight.length * BRAKING.count,
      );
      expect(lap.lengthW).toBeGreaterThan(0);
    }
  }, 300_000);

  /**
   * THE CHECK, PROVED ABLE TO FAIL — three ways, because there are three
   * separate things the rule asks for and a gate that only sees one of
   * them would pass a lap that breaks the other two.
   */
  it("sees a marker on the wrong side, out of the window, or at the wrong height", async () => {
    const { lap, corners, markers, lang } = await spoken(1);
    const isMarker = (p: StationedPlacement) =>
      p.asset.id === markers.sharp.id || p.asset.id === markers.open.id;

    // Deleted outright.
    expect(
      cornerMarkersSatisfied(
        lang.placements.filter((p) => !isMarker(p)),
        corners,
        markers,
        lap.lengthW,
      ).missing.length,
    ).toBe(corners.length);

    // Mirrored onto the inside: every count and distance still holds.
    const mirrored = lang.placements.map((p) => (isMarker(p) ? { ...p, t: -p.t } : p));
    expect(cornerMarkersSatisfied(mirrored, corners, markers, lap.lengthW).satisfied).toBe(false);

    // Moved out of the window by 4W, which is still "before the corner".
    const late = lang.placements.map((p) =>
      isMarker(p) ? { ...p, station: (p.station + 4) % lap.lengthW } : p,
    );
    expect(cornerMarkersSatisfied(late, corners, markers, lap.lengthW).satisfied).toBe(false);

    // Dropped to ground level, where a driver would never see it against
    // the horizon.
    const low = lang.placements.map((p) => (isMarker(p) ? { ...p, h: 0.2 } : p));
    expect(cornerMarkersSatisfied(low, corners, markers, lap.lengthW).satisfied).toBe(false);
  }, 300_000);

  it("puts an exact ruler before every corner tighter than R = 8W", async () => {
    for (const seed of [1, 2, 3, 4]) {
      const { lap, corners, markers, lang } = await spoken(seed);
      const r = brakingRulersSatisfied(lang.placements, corners, markers, lap.lengthW);
      expect(r.satisfied, `seed ${seed}: ${r.failures.join("; ")}`).toBe(true);
    }
  }, 300_000);

  it("sees a ruler with jittered marks, or with one off the line", async () => {
    const { lap, corners, markers, lang } = await spoken(1);
    const first = lang.placements.findIndex((p) => p.asset.id === markers.brake.id);
    expect(first).toBeGreaterThanOrEqual(0);

    // A ruler whose marks are still all in the window and still three in
    // number, but no longer evenly spaced. A count-only gate passes this.
    const jittered = [...lang.placements];
    jittered[first] = { ...jittered[first], station: (jittered[first].station + 1.5) % lap.lengthW };
    expect(brakingRulersSatisfied(jittered, corners, markers, lap.lengthW).satisfied).toBe(false);

    // And one mark pushed off the common line, which stops it reading as
    // a line at all.
    const bent = [...lang.placements];
    bent[first] = { ...bent[first], t: bent[first].t * 1.4 };
    expect(brakingRulersSatisfied(bent, corners, markers, lap.lengthW).satisfied).toBe(false);
  }, 300_000);

  /**
   * WHAT THE LANGUAGE COST, reported rather than asserted.
   *
   * L-2 adds a placement wherever a corner's window held nothing to
   * convert, so D-1's budget drifts upward and the size of that drift is
   * a number somebody downstream needs. L-3 always adds and pays by
   * displacing the most repeated ordinary placements from the same
   * window, so its net cost is the difference between two counts. And the
   * `before` column is the contrast with the source: a median of zero
   * verticals in the braking window, across 305 real corners.
   */
  it("reports the budget drift and the contrast with the source", async () => {
    const rows: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const { lap, corners, markers, raw, lang } = await spoken(seed);
      const r = brakingRulersSatisfied(lang.placements, corners, markers, lap.lengthW);
      rows.push(
        `  seed ${seed}: ${raw.length} placed -> ${lang.placements.length}; ` +
          `L-2 ${lang.converted} converted + ${lang.added} added over ${lang.corners} corners; ` +
          `L-3 ${lang.brakeAdded} marks - ${lang.brakeDisplaced} displaced over ` +
          `${lang.tightCorners} tight corners; ` +
          `verticals in those windows before: ${lang.verticalsBefore}; ` +
          `neighbours' marks seen in a window: ${r.overlaps}`,
      );
    }
    console.log(
      [
        `L-2/L-3 cost. Source, over 305 corners tighter than R=${BRAKING.tighterThanW}W: ` +
          `median ${BRAKING.sourceMedianCount} verticals in the window, ` +
          `${(100 * BRAKING.sourceAnyShare).toFixed(0)}% have any, ` +
          `${(100 * BRAKING.sourceThreeShare).toFixed(0)}% have three.`,
        ...rows,
      ].join("\n"),
    );
    expect(rows.length).toBe(4);
  }, 300_000);

  /**
   * THE LANGUAGE MUST ACTUALLY FIRE. Every corner marked and zero markers
   * placed is the shape of a vacuous pass, and this demo has already been
   * caught once by a rule that was green and unreachable.
   */
  it("fires rather than passing vacuously", async () => {
    const { lang } = await spoken(1);
    expect(lang.corners).toBeGreaterThan(0);
    expect(lang.tightCorners).toBeGreaterThan(0);
    expect(lang.converted + lang.added).toBe(lang.corners);
    expect(lang.brakeAdded).toBe(lang.tightCorners * BRAKING.count);
  }, 300_000);
});
