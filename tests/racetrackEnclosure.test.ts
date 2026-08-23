/**
 * L-6's enclosure MEASUREMENT: which frames run under cover, how long each
 * covered stretch is, and what share of the lap they add up to.
 *
 * TESTED ON LAPS AND BOXES WHOSE ANSWER IS KNOWN BY CONSTRUCTION, not on a
 * dressed circuit and not on the kit — a hand-built tunnel over a stated
 * range of stations has a length that is arithmetic, so these check the
 * measurement against a number rather than against itself. Nothing here
 * reads a file, so it runs everywhere.
 *
 * THE THREE THRESHOLDS ARE THE POINT, because every one of them is a place
 * where the measurement silently becomes a measurement of something else.
 * Drop the floor and scenery beside the road counts as cover. Drop the
 * ceiling and the answer is 100%, because the skybox is a box. Drop the
 * three-of-six and one lamp arm encloses the corridor. Each is checked
 * against the SAME boxes moved, so the only thing that differs between a
 * pass and a fail is the quantity being tested.
 *
 * AND EVERY CHECK HAS TO BE ABLE TO FAIL. A check whose only evidence is
 * that it passes on correct input is indistinguishable from one that
 * always passes, so each zero here is paired with input built to make the
 * same call answer nonzero, and each nonzero with input built to make it
 * answer nothing.
 */
import { describe, expect, it } from "vitest";
import type { PlacedBox } from "../demos/racetrack/kit.js";
import {
  ENCLOSURE,
  RAY_LATERALS_W,
  enclosedAtFrame,
  enclosureMask,
  measureEnclosure,
} from "../demos/racetrack/enclosure.js";
import { type Lap, placeAt } from "../demos/racetrack/lap.js";

/** Half the road width, in world units — the scale every W is measured in. */
const W = 4;

/**
 * A lap from world positions and tangents, with the frame the graph
 * publishes: `up` is world up and `across` is `tangent x up`, RIGHT of
 * travel. The same construction `roadCorners.test.ts` uses, and for the
 * same reason — the curve is stated rather than differenced, so a test can
 * say what the shape is and let the module do the work.
 */
function lapFrom(
  pts: readonly (readonly [number, number, number])[],
  tans: readonly (readonly [number, number, number])[],
): Lap {
  const count = pts.length;
  const p = new Float64Array(count * 3);
  const tangent = new Float64Array(count * 3);
  const across = new Float64Array(count * 3);
  const up = new Float64Array(count * 3);
  const s = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    p[i * 3] = pts[i][0];
    p[i * 3 + 1] = pts[i][1];
    p[i * 3 + 2] = pts[i][2];
    const [tx, ty, tz] = tans[i];
    const l = Math.hypot(tx, ty, tz) || 1;
    tangent[i * 3] = tx / l;
    tangent[i * 3 + 1] = ty / l;
    tangent[i * 3 + 2] = tz / l;
    up[i * 3 + 1] = 1;
    // tangent x up, componentwise.
    across[i * 3] = -tangent[i * 3 + 2];
    across[i * 3 + 2] = tangent[i * 3];
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    s[i + 1] =
      s[i] +
      Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  const length = s[count];
  return { count, p, tangent, across, up, s, length, halfWidth: W, lengthW: length / W };
}

const RING = { radiusW: 50, frames: 600 };

/**
 * A big circle in the XZ plane.
 *
 * WHY A RING AND NOT A STRAIGHT. A lap is a loop, and the obvious straight
 * — out along +X and back — puts the two legs in the SAME world positions,
 * so a box over one leg is also over the other and the arithmetic stops
 * being known. A wide ring is a genuine loop whose every station is
 * somewhere different, and at 50W radius it is straight enough over a
 * box's own length that the chord/arc difference is four decimal places
 * below anything asserted here.
 *
 * `startIndex` rotates where the sampling begins. That moves the start
 * line and changes NOTHING about the shape: the world positions are the
 * same set in the same order, cut in a different place.
 */
function ring(startIndex = 0): Lap {
  const R = RING.radiusW * W;
  const n = RING.frames;
  const pts: [number, number, number][] = [];
  const tans: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * ((i + startIndex) % n)) / n;
    pts.push([R * Math.cos(th), 0, R * Math.sin(th)]);
    tans.push([-Math.sin(th), 0, Math.cos(th)]);
  }
  return lapFrom(pts, tans);
}

/** Arc length between frames, in W. Uniform on a ring, by construction. */
const stepW = (lap: Lap): number => lap.lengthW / lap.count;

/** The frame nearest a station, and that frame's own exact station. */
function frameNear(lap: Lap, stationW: number): { i: number; stationW: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < lap.count; i++) {
    const d = Math.abs(lap.s[i] / lap.halfWidth - stationW);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { i: best, stationW: lap.s[best] / lap.halfWidth };
}

interface BoxSpec {
  readonly stationW: number;
  readonly lateralW?: number;
  readonly heightW: number;
  readonly acrossW: number;
  readonly alongW: number;
  readonly tallW: number;
}

/**
 * One box, placed on the lap the way `placeKit` places one.
 *
 * THE UNITS ARE THE TRAP. Everything a test states is in half-widths,
 * because that is what the rules are written in — but `PlacedBox.size` is
 * WORLD, so the extents are multiplied by the half-width here exactly as
 * `placeKit` does. Stating them in W and forgetting the multiply builds a
 * box four times too small on this lap, which still hits the middle rays
 * and would make the corridor-coverage checks pass for the wrong reason.
 */
function boxAt(lap: Lap, spec: BoxSpec): PlacedBox {
  const { p, pose } = placeAt(lap, {
    station: spec.stationW,
    lateral: spec.lateralW ?? 0,
    height: spec.heightW,
  });
  return {
    centre: p,
    size: [spec.acrossW * W, spec.alongW * W, spec.tallW * W],
    // `dir` IS the along axis — one vector, two names, the same mapping
    // `sightline.ts` makes when it hands a placement to the slab test.
    basis: { across: pose.across, along: pose.dir, up: pose.up },
    role: "span",
    thickness: 0,
  };
}

/**
 * A run of shells over the road, from `fromW` to `toW`.
 *
 * The defaults span the corridor with room to spare (4W across, so
 * `-2W..+2W` against a corridor of `-1.5W..+1.5W`) and sit ENTIRELY inside
 * the ray's height range at the default height: 0.8W tall about h = 2W is
 * 1.6W..2.4W, inside 1.2W..6W. That matters for the floor and ceiling
 * checks, which move the same boxes and need them to land entirely outside
 * the range rather than poking into it.
 *
 * Spaced closer than they are long, so the run is continuous: at 0.5W
 * spacing and 1W length each box overlaps its neighbours by half.
 */
interface TunnelSpec {
  readonly heightW: number;
  readonly acrossW: number;
  readonly alongW: number;
  readonly tallW: number;
  readonly spacingW: number;
  readonly lateralW?: number;
}

const TUNNEL: TunnelSpec = { heightW: 2, acrossW: 4, alongW: 1, tallW: 0.8, spacingW: 0.5 };

function tunnel(
  lap: Lap,
  fromW: number,
  toW: number,
  over: Partial<TunnelSpec> = {},
): PlacedBox[] {
  const spec = { ...TUNNEL, ...over };
  const n = Math.round((toW - fromW) / spec.spacingW);
  const out: PlacedBox[] = [];
  for (let k = 0; k <= n; k++) {
    out.push(
      boxAt(lap, {
        stationW: fromW + k * spec.spacingW,
        lateralW: over.lateralW ?? 0,
        heightW: spec.heightW,
        acrossW: spec.acrossW,
        alongW: spec.alongW,
        tallW: spec.tallW,
      }),
    );
  }
  return out;
}

/**
 * A wide flat canopy anchored well off the road and reaching over it.
 *
 * The awkward case for any acceleration structure: 45W across, so it
 * spans `-2.5W .. +42.5W` and covers every ray, while its CENTRE sits 20W
 * to the side of a corridor 1.5W wide. Everything about where it is says
 * "nowhere near the road" and it is directly overhead.
 */
const CANOPY_W = {
  stationW: 250,
  lateralW: 20,
  heightW: 2,
  acrossW: 45,
  alongW: 4,
  tallW: 0.8,
} as const;

const CANOPY = (lap: Lap): PlacedBox => boxAt(lap, CANOPY_W);

/**
 * What a tunnel over `[fromW, toW]` must measure, in W, as arithmetic.
 *
 * The cover starts half a box's length before the first box and ends half
 * a box's length after the last, so the covered range is the stated span
 * widened by one whole box length. The measurement then quantises each end
 * to a frame, which can move it by up to one frame's spacing — so that is
 * the tolerance, and it is a tolerance rather than a fudge: the module
 * measures per frame on purpose.
 */
const expectedTunnelW = (fromW: number, toW: number): number => toW - fromW + TUNNEL.alongW;
const tunnelTolW = (lap: Lap): number => 1.5 * stepW(lap);

describe("the sampling the definition specifies", () => {
  it("spreads six rays across the corridor, edges included", () => {
    // Stated because everything else depends on it: the corner rays at
    // +/-1.5W are what a shell's legs stand at, and dropping them to an
    // interior spacing would make a legs-only piece read as cover.
    expect(RAY_LATERALS_W.length).toBe(ENCLOSURE.rays);
    expect(RAY_LATERALS_W[0]).toBeCloseTo(-ENCLOSURE.corridorW, 12);
    expect(RAY_LATERALS_W[ENCLOSURE.rays - 1]).toBeCloseTo(ENCLOSURE.corridorW, 12);
    expect([...RAY_LATERALS_W].map((t) => Number(t.toFixed(3)))).toEqual([
      -1.5, -0.9, -0.3, 0.3, 0.9, 1.5,
    ]);
    // At least half of six.
    expect(ENCLOSURE.minHits * 2).toBeGreaterThanOrEqual(ENCLOSURE.rays);
  });
});

describe("a lap with nothing over it", () => {
  it("measures no cover at all", () => {
    const lap = ring();
    const bare = measureEnclosure(lap, []);
    expect(bare.share).toBe(0);
    expect(bare.stretches).toEqual([]);
    expect(bare.longestW).toBe(0);
    expect(bare.heavyTailShare).toBe(0);
    expect(enclosureMask(lap, []).some(Boolean)).toBe(false);

    // AND THE ZERO HAS TO MEAN SOMETHING. The same lap with a tunnel on it
    // measures cover, so the zero above is the absence of boxes and not a
    // measurement that never fires.
    expect(measureEnclosure(lap, tunnel(lap, 20, 40)).share).toBeGreaterThan(0);
  });
});

describe("a hand-built tunnel", () => {
  it("measures one stretch as long as the range it was built over", () => {
    const lap = ring();
    const boxes = tunnel(lap, 20, 40);
    const r = measureEnclosure(lap, boxes);

    expect(r.stretches.length).toBe(1);
    const want = expectedTunnelW(20, 40);
    expect(r.stretches[0].lengthW).toBeGreaterThan(want - tunnelTolW(lap));
    expect(r.stretches[0].lengthW).toBeLessThan(want + tunnelTolW(lap));
    expect(r.longestW).toBe(r.stretches[0].lengthW);
    // The stretch is where it was built, not somewhere else of the right
    // length: a measurement that lost the station would still pass every
    // length assertion above. Both ends are quantised to a frame, so the
    // window is the stated edge give or take one frame's spacing.
    const firstW = 20 - TUNNEL.alongW / 2;
    const lastW = 40 + TUNNEL.alongW / 2;
    expect(r.stretches[0].startW).toBeGreaterThan(firstW - stepW(lap));
    expect(r.stretches[0].startW).toBeLessThan(firstW + stepW(lap));
    expect(r.stretches[0].endW).toBeGreaterThan(lastW - stepW(lap));
    expect(r.stretches[0].endW).toBeLessThan(lastW + stepW(lap));
    // share is that length over the lap, and nothing else.
    expect(r.share).toBeCloseTo(r.stretches[0].lengthW / lap.lengthW, 12);
  });
});

describe("the floor is real", () => {
  it("does not call scenery beside the road cover", () => {
    const lap = ring();
    // THE POSITIVE CONTROL FIRST, with the identical boxes at the height
    // the rule calls cover. Without it, "lowered boxes measure zero" is
    // equally consistent with a measurement that always measures zero.
    const above = measureEnclosure(lap, tunnel(lap, 20, 40, { heightW: 2 }));
    expect(above.share).toBeGreaterThan(0);

    // 0.5W centre, 0.8W tall: 0.1W .. 0.9W, entirely below the 1.2W floor.
    const low = tunnel(lap, 20, 40, { heightW: 0.5 });
    expect(ENCLOSURE.floorW).toBeGreaterThan(0.5 + TUNNEL.tallW / 2);
    const r = measureEnclosure(lap, low);
    expect(r.share).toBe(0);
    expect(r.stretches).toEqual([]);
  });
});

describe("the ceiling is real", () => {
  it("does not call the sky a tunnel", () => {
    const lap = ring();
    const above = measureEnclosure(lap, tunnel(lap, 20, 40, { heightW: 2 }));
    expect(above.share).toBeGreaterThan(0);

    // 10W centre, 0.8W tall: 9.6W .. 10.4W, entirely above the 6W ceiling.
    // This is the check that keeps a skybox from reading as 100% cover,
    // and it is the one the withdrawn figures did not have.
    const high = tunnel(lap, 20, 40, { heightW: 10 });
    expect(ENCLOSURE.ceilingW).toBeLessThan(10 - TUNNEL.tallW / 2);
    const r = measureEnclosure(lap, high);
    expect(r.share).toBe(0);
    expect(r.stretches).toEqual([]);
  });
});

describe("half the rays is real", () => {
  /**
   * Three boxes at one frame, differing ONLY in how much of the corridor
   * they span. The rays stand at -1.5, -0.9, -0.3, +0.3, +0.9, +1.5, so:
   *
   *   left third      [-1.6, -0.4]  hits 2  -> not enclosed
   *   three of six    [-2.1, +0.1]  hits 3  -> enclosed, exactly at the cut
   *   middle two      [-1.0, +1.0]  hits 4  -> enclosed
   *
   * The extents are widened off the exact thirds so that no ray sits on a
   * face: a box edge exactly at -1.5 would make the answer a question
   * about floating point rather than about the rule.
   */
  it("takes half the corridor to enclose a frame, not a third", () => {
    const lap = ring();
    const at = frameNear(lap, 30);
    const one = (lateralW: number, acrossW: number): PlacedBox[] => [
      boxAt(lap, {
        stationW: at.stationW,
        lateralW,
        heightW: TUNNEL.heightW,
        acrossW,
        alongW: TUNNEL.alongW,
        tallW: TUNNEL.tallW,
      }),
    ];

    // The left third of the corridor: two rays, one short.
    expect(enclosedAtFrame(lap, at.i, one(-1.0, 1.2))).toBe(false);
    // The middle two thirds: four rays.
    expect(enclosedAtFrame(lap, at.i, one(0, 2.0))).toBe(true);
    // And exactly at the cut, from the same side that failed — so the
    // false above is about the ray COUNT and not about being off-centre,
    // being at the wrong height, or being at the wrong frame.
    expect(enclosedAtFrame(lap, at.i, one(-1.0, 2.2))).toBe(true);
  });

  /**
   * THREE BOXES OVER ONE STRIP ARE NOT THREE RAYS.
   *
   * The rule counts RAYS that hit at least one box, and the difference
   * only shows when boxes overlap — which on a real lap they always do,
   * since a shell is a run of repeated pieces and a gantry stands over its
   * own legs. Counting hits instead of rays turns "art spans the corridor"
   * into "there is a lot of art", and the failure is invisible: a stack of
   * three panels down one edge of the road would report the corridor
   * enclosed while the sky over it is wide open.
   */
  it("counts distinct rays, not boxes over the same ray", () => {
    const lap = ring();
    const at = frameNear(lap, 30);
    const stack = (lateralW: number, acrossW: number): PlacedBox[] =>
      // Three heights, none overlapping: 1.6-2.4, 2.6-3.4, 3.6-4.4W, all
      // inside the ray's 1.2-6W range.
      [2, 3, 4].map((heightW) =>
        boxAt(lap, {
          stationW: at.stationW,
          lateralW,
          heightW,
          acrossW,
          alongW: TUNNEL.alongW,
          tallW: TUNNEL.tallW,
        }),
      );

    // Three panels stacked over the left edge: six ray/box hits, two rays.
    expect(enclosedAtFrame(lap, at.i, stack(-1.0, 1.2))).toBe(false);
    // The same three panels over the middle: still six hits, but now four
    // distinct rays. Same box count, same heights, opposite answer — so
    // the false above is about which rays were hit and not about the
    // stack failing to intersect anything.
    expect(enclosedAtFrame(lap, at.i, stack(0, 2.0))).toBe(true);
  });
});

describe("a stretch that crosses the start line", () => {
  /**
   * THE WRAP, WHICH IS WHERE A NAIVE SCAN GETS IT WRONG.
   *
   * The boxes are built once, on a lap cut at station zero, and then
   * measured against the SAME ring cut in the middle of the tunnel. The
   * world geometry is identical; only the arbitrary cut moved. A scan that
   * runs from index zero and closes a run at the end of the array reports
   * TWO stretches here, each about half the length, and gives one of them
   * a false start at station zero — which L-6 would then read as a tunnel
   * beginning at the start line.
   */
  it("counts a tunnel straddling the cut as one stretch", () => {
    const lap = ring();
    const boxes = tunnel(lap, 150, 170);
    const plain = measureEnclosure(lap, boxes);
    expect(plain.stretches.length).toBe(1);

    const cut = ring(Math.round(160 / stepW(lap)));
    const mask = enclosureMask(cut, boxes);
    // THE INPUT REALLY IS BUILT TO BREAK IT: cover runs across the cut, so
    // the first and last frames are both under it. Without this the test
    // would pass on a rotation that happened to miss the tunnel.
    expect(mask[0]).toBe(true);
    expect(mask[cut.count - 1]).toBe(true);

    const r = measureEnclosure(cut, boxes);
    expect(r.stretches.length).toBe(1);
    expect(r.stretches[0].lengthW).toBeCloseTo(plain.stretches[0].lengthW, 6);
    expect(r.share).toBeCloseTo(plain.share, 6);
    // It wraps: the run ends at a lower station than it starts, and no
    // invented stretch sits on the cut.
    expect(r.stretches[0].endW).toBeLessThan(r.stretches[0].startW);
    expect(r.stretches.some((s) => s.startW < 1e-9)).toBe(false);
  });

  it("reports a fully covered lap as one stretch, not none", () => {
    // A lap covered end to end has no frame that BEGINS a run, which is
    // the same degenerate case a circle presents to the corner model —
    // except that here the answer is the whole lap rather than nothing, so
    // it has to be recognised rather than fallen through.
    const lap = ring();
    const roofed = tunnel(lap, 0, lap.lengthW);
    expect(enclosureMask(lap, roofed).every(Boolean)).toBe(true);
    const r = measureEnclosure(lap, roofed);
    expect(r.share).toBe(1);
    expect(r.stretches.length).toBe(1);
    expect(r.stretches[0].lengthW).toBe(lap.lengthW);
  });
});

describe("length and share arithmetic", () => {
  it("adds two tunnels up, and reports the longer one as longest", () => {
    const lap = ring();
    const long = tunnel(lap, 20, 44); // 24W of stations
    const short = tunnel(lap, 100, 108); // 8W of stations
    const r = measureEnclosure(lap, [...long, ...short]);

    expect(r.stretches.length).toBe(2);
    const wantLong = expectedTunnelW(20, 44);
    const wantShort = expectedTunnelW(100, 108);
    const tol = tunnelTolW(lap);

    // The share is the SUM over the lap length, stated as arithmetic.
    expect(r.share).toBeGreaterThan((wantLong + wantShort - 2 * tol) / lap.lengthW);
    expect(r.share).toBeLessThan((wantLong + wantShort + 2 * tol) / lap.lengthW);

    // And the longest is the long one. The two differ by 16W against a
    // tolerance under 1W, so a `longestW` that took the first, the last or
    // the shortest could not pass this.
    expect(r.longestW).toBeGreaterThan(wantLong - tol);
    expect(r.longestW).toBeLessThan(wantLong + tol);
    expect(r.longestW).toBeGreaterThan(wantShort + tol);

    const sum = r.stretches.reduce((a, s) => a + s.lengthW, 0);
    expect(r.share).toBeCloseTo(sum / lap.lengthW, 12);
    console.log(
      `enclosure: ${(100 * r.share).toFixed(1)}% of a ${lap.lengthW.toFixed(0)}W lap in ` +
        `${r.stretches.length} stretches, longest ${r.longestW.toFixed(1)}W ` +
        `(built as ${wantLong.toFixed(1)}W and ${wantShort.toFixed(1)}W)`,
    );
  });
});

describe("the heavy tail", () => {
  it("is zero when every stretch is short and one when only a long one is", () => {
    const lap = ring();
    // 4W spans measure about 5W each, both well under the 10W cut.
    const shorts = [...tunnel(lap, 20, 24), ...tunnel(lap, 100, 104)];
    const flat = measureEnclosure(lap, shorts);
    expect(flat.stretches.length).toBe(2);
    for (const s of flat.stretches) expect(s.lengthW).toBeLessThan(ENCLOSURE.heavyW);
    expect(flat.heavyTailShare).toBe(0);

    // One 25W stretch and nothing else: all of the covered length is in
    // the tail. Same call, opposite answer — which is what makes the zero
    // above evidence of anything.
    const oneLong = measureEnclosure(lap, tunnel(lap, 20, 44));
    expect(oneLong.stretches.length).toBe(1);
    expect(oneLong.stretches[0].lengthW).toBeGreaterThan(ENCLOSURE.heavyW);
    expect(oneLong.heavyTailShare).toBe(1);
  });

  it("is a share, not a flag", () => {
    // A long tunnel and a short one together: the answer has to be the
    // proportion of COVERED length in the long one, which is neither 0 nor
    // 1. A `heavyTailShare` implemented as "is there a long stretch" would
    // pass both halves of the test above and fail here.
    const lap = ring();
    const r = measureEnclosure(lap, [...tunnel(lap, 20, 44), ...tunnel(lap, 100, 104)]);
    expect(r.stretches.length).toBe(2);
    const wantLong = expectedTunnelW(20, 44);
    const wantShort = expectedTunnelW(100, 104);
    expect(r.heavyTailShare).toBeCloseTo(wantLong / (wantLong + wantShort), 1);
    expect(r.heavyTailShare).toBeGreaterThan(0);
    expect(r.heavyTailShare).toBeLessThan(1);
    // Explicitly: it divides by the covered length, not by the lap.
    const covered = r.stretches[0].lengthW + r.stretches[1].lengthW;
    expect(r.heavyTailShare).toBeCloseTo(r.longestW / covered, 12);
  });
});

describe("the candidate bucketing", () => {
  /**
   * THE OPTIMISATION MAY NOT CHANGE THE ANSWER.
   *
   * The measurement prefilters boxes by world-space reach before it casts
   * anything, which is the difference between 600k slab tests and a few
   * thousand. A prefilter that is too tight does not crash — it silently
   * reports less cover, which is indistinguishable from a lap with less
   * cover on it. So the same tunnel is measured against a box list padded
   * with far-away boxes and with boxes at the far side of the ring, and
   * has to give the identical answer to the bare list.
   */
  it("gives the same answer whatever else is on the lap", () => {
    const lap = ring();
    const boxes = tunnel(lap, 20, 40);
    const bare = measureEnclosure(lap, boxes);

    const noise: PlacedBox[] = [
      // The far side of the ring, at cover height: same distance from the
      // start line the long way round, nowhere near these frames.
      ...tunnel(lap, 200, 210),
      // Beside the road and under the floor, where nothing counts.
      ...tunnel(lap, 20, 40, { heightW: 0.5, lateralW: 6 }),
      CANOPY(lap),
    ];
    const padded = measureEnclosure(lap, [...boxes, ...noise]);

    // The far tunnel adds a stretch of its own; the tunnel under test is
    // unchanged, and so is everything about it.
    const same = padded.stretches.find((s) => Math.abs(s.startW - bare.stretches[0].startW) < 1e-9);
    expect(same).toBeDefined();
    expect(same?.lengthW).toBeCloseTo(bare.stretches[0].lengthW, 12);

    // AND THE PADDING IS NOT INERT: the canopy really does reach the
    // corridor, so the awkward path is exercised rather than merely
    // present, and the share went up because of it.
    expect(padded.share).toBeGreaterThan(bare.share);
    expect(enclosedAtFrame(lap, frameNear(lap, CANOPY_W.stationW).i, [CANOPY(lap)])).toBe(true);
  });

  /**
   * THE PREFILTER MUST ADMIT A BOX WHOSE CENTRE IS NOWHERE NEAR THE ROAD.
   *
   * The canopy's centre stands 20W to the side — thirteen times the
   * corridor's half width, and three times the whole reach of a ray — and
   * it still covers the road, because it is 45W wide. Any bound that asked
   * only how far the rays reach, or that bucketed the box at its centre,
   * would drop it and report a bare lap. That is the same shape of mistake
   * as the withdrawn bounds-centre proxy, one layer down, and it is worth
   * saying out loud that a prefilter which is too TIGHT does not crash: it
   * quietly measures less cover, which reads exactly like less cover.
   */
  it("finds cover from a box centred far off the road", () => {
    const lap = ring();
    const at = frameNear(lap, CANOPY_W.stationW);
    expect(enclosedAtFrame(lap, at.i, [CANOPY(lap)])).toBe(true);
    // Stated as arithmetic so the numbers above cannot drift apart: the
    // centre is further from the frame than a ray can reach, and only the
    // box's own half-diagonal closes the gap.
    const centreDistW = Math.hypot(CANOPY_W.lateralW, CANOPY_W.heightW);
    const rayReachW = Math.hypot(ENCLOSURE.corridorW, ENCLOSURE.ceilingW);
    expect(centreDistW).toBeGreaterThan(rayReachW);
    expect(measureEnclosure(lap, [CANOPY(lap)]).share).toBeGreaterThan(0);
  });
});
