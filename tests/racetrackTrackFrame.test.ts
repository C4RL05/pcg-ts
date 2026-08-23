/**
 * The road demo's track-relative frame, checked against the contract it
 * claims to implement.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. The frame exists so that placement
 * rules measured on one circuit transfer to a spline that circuit never
 * had, and every one of those rules is stated in half-widths and in a
 * signed lateral offset. Every failure mode here is SILENT: a mirrored
 * `across` puts the whole kit on the wrong side of the road and looks
 * fine from above, a station that normalises to 0..1 makes every spacing
 * rule scale with lap length, and an `up` rebuilt from world up rather
 * than from the frame quietly ignores bank. None of the three shows up in
 * a render, and the first one already shipped once.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry, type Geometry } from "pcg-ts";
import { OUTPUTS, TRACK_FRAME, buildRoadGraph } from "../demos/racetrack/graph.js";
import { placeAt, poseAt, readLap } from "../demos/racetrack/lap.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";

const spline = makeTrackSpline({ seed: 1 });

async function cookFrames(): Promise<Geometry> {
  const out = (await cook(buildRoadGraph({ spline, seed: 1 }))).outputs;
  const geo = firstGeometry(out[OUTPUTS.frames] ?? []);
  if (!geo) throw new Error("the road graph produced no frames");
  return geo;
}

function vec(g: Geometry, name: string, i: number): [number, number, number] {
  const a = g.attrs.point.require(name);
  return [a.data[i * 3], a.data[i * 3 + 1], a.data[i * 3 + 2]];
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("the published track frame", () => {
  it("writes all four columns", async () => {
    const g = await cookFrames();
    for (const name of Object.values(TRACK_FRAME)) {
      expect(g.attrs.point.get(name), `missing column ${name}`).toBeTruthy();
    }
  });

  it("is orthonormal at every frame", async () => {
    const g = await cookFrames();
    for (let i = 0; i < g.pointCount; i += 37) {
      const along = vec(g, TRACK_FRAME.along, i);
      const across = vec(g, TRACK_FRAME.across, i);
      const up = vec(g, TRACK_FRAME.up, i);
      expect(len(along)).toBeCloseTo(1, 4);
      expect(len(across)).toBeCloseTo(1, 4);
      expect(len(up)).toBeCloseTo(1, 4);
      expect(dot(along, across)).toBeCloseTo(0, 4);
      expect(dot(across, up)).toBeCloseTo(0, 4);
      expect(dot(up, along)).toBeCloseTo(0, 4);
    }
  });

  /**
   * THE ONE THAT ALREADY SHIPPED WRONG.
   *
   * `across` must point RIGHT of travel, which in a right-handed Y-up
   * frame is `along` x up — check it with along +Z and up +Y and you get
   * -X, the driver's right. The opposite order reads as an equally
   * plausible "across" and mirrors the entire kit about the centreline.
   */
  it("points across to the RIGHT of travel", async () => {
    const g = await cookFrames();
    for (let i = 0; i < g.pointCount; i += 37) {
      const along = vec(g, TRACK_FRAME.along, i);
      const across = vec(g, TRACK_FRAME.across, i);
      expect(dot(cross(along, [0, 1, 0]), across)).toBeGreaterThan(0.9);
    }
  });

  it("states the station in half-widths, not as a fraction", async () => {
    const g = await cookFrames();
    const station = g.attrs.point.require(TRACK_FRAME.station);
    const halfWidth = g.attrs.point.require(TRACK_FRAME.halfWidth).data[0];
    expect(halfWidth).toBeCloseTo(spline.halfWidth, 6);

    const last = station.data[g.pointCount - 1];
    // A fraction would end just under 1. A lap of this size is hundreds of
    // half-widths long, which is the whole difference between "every 12 W"
    // meaning a distance and meaning a proportion.
    expect(last).toBeGreaterThan(50);

    // Monotone from the seam, and the last sample stops one step short of
    // the lap rather than repeating the start.
    let prev = -Infinity;
    for (let i = 0; i < g.pointCount; i++) {
      expect(station.data[i]).toBeGreaterThan(prev);
      prev = station.data[i];
    }
  });

  it("does not move a station when the frame count changes", async () => {
    // The station is built from the MEASURED lap length, so resampling
    // finer must not slide anything along the track. Built from the frame
    // count instead, every rule would drift when the resolution changed.
    const coarse = firstGeometry(
      (await cook(buildRoadGraph({ spline, seed: 1, frames: 400 }))).outputs[OUTPUTS.frames] ?? [],
    );
    const fine = firstGeometry(
      (await cook(buildRoadGraph({ spline, seed: 1, frames: 1200 }))).outputs[OUTPUTS.frames] ?? [],
    );
    const endW = (g: Geometry | undefined): number => {
      if (!g) throw new Error("no frames");
      const s = g.attrs.point.require(TRACK_FRAME.station);
      return s.data[g.pointCount - 1];
    };
    // Within one coarse step of each other: both end one sample short of
    // the same measured lap.
    expect(Math.abs(endW(coarse) - endW(fine))).toBeLessThan(1);
  });
});

describe("the host reads the same frame the graph wrote", () => {
  it("places a lateral offset of 1 W on the road edge", async () => {
    const lap = readLap(await cookFrames());
    for (const station of [0, 37.5, 120, 260.25]) {
      const here = poseAt(lap, station * lap.halfWidth);
      const right = placeAt(lap, { station, lateral: 1, height: 0 });
      const d = Math.hypot(
        right.p[0] - here.p[0],
        right.p[1] - here.p[1],
        right.p[2] - here.p[2],
      );
      // One half-width from the centreline is, by definition, the edge of
      // the road the ribbon was swept at.
      expect(d).toBeCloseTo(lap.halfWidth, 4);
    }
  });

  it("puts a positive lateral on the opposite side from a negative one", async () => {
    const lap = readLap(await cookFrames());
    const station = 88;
    const here = poseAt(lap, station * lap.halfWidth);
    const r = placeAt(lap, { station, lateral: 2, height: 0 }).p;
    const l = placeAt(lap, { station, lateral: -2, height: 0 }).p;
    const toR = [r[0] - here.p[0], r[1] - here.p[1], r[2] - here.p[2]];
    const toL = [l[0] - here.p[0], l[1] - here.p[1], l[2] - here.p[2]];
    // Opposite, not merely different: the sign is the only thing that
    // distinguishes the two sides of a road in the kit's coordinates.
    expect(dot(toR, toL) / (len(toR) * len(toL))).toBeCloseTo(-1, 4);
    expect(dot(toR, here.across)).toBeGreaterThan(0);
  });

  it("raises height along the surface normal", async () => {
    const lap = readLap(await cookFrames());
    const station = 200;
    const here = poseAt(lap, station * lap.halfWidth);
    const up = placeAt(lap, { station, lateral: 0, height: 3 }).p;
    const rise = [up[0] - here.p[0], up[1] - here.p[1], up[2] - here.p[2]];
    expect(len(rise)).toBeCloseTo(3 * lap.halfWidth, 4);
    expect(dot(rise, here.up) / len(rise)).toBeCloseTo(1, 4);
  });

  it("wraps the station at the lap rather than clamping", async () => {
    const lap = readLap(await cookFrames());
    const a = placeAt(lap, { station: 5, lateral: 1.5, height: 0 }).p;
    const b = placeAt(lap, { station: 5 + lap.lengthW, lateral: 1.5, height: 0 }).p;
    // A clamp would park everything past the finish line on the last
    // frame, which reads as a pile of art at the seam.
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 3);
  });
});
