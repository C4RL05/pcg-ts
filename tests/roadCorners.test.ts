/**
 * The corner model — §9's step 2, which L-2, L-3 and L-6 all read.
 *
 * TESTED ON LAPS WHOSE ANSWERS ARE KNOWN BY CONSTRUCTION, not on the
 * generated circuit. A circle's curvature is 1/R everywhere and a
 * stadium has exactly two bends, so these can check the model against
 * arithmetic rather than against itself. The generated circuit then only
 * has to be checked for the things a synthetic lap cannot show.
 *
 * THE SIGN IS THE POINT. Turn direction decides which side "outside" is,
 * and a mirrored sign produces a lap where every marker sits on the
 * inside of every corner while every count, share and distance still
 * passes — the same class of defect as the lateral axis that was mirrored
 * once already and could not be seen in a screenshot.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import {
  CORNER_R_W,
  SEVERITY,
  beforeEntryW,
  cornersOf,
  radiusAtIndex,
  signedCurvatureAt,
} from "../demos/road/corners.js";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import { type Lap, readLap } from "../demos/road/lap.js";
import { makeTrackSpline } from "../demos/road/spline.js";

const W = 4;

/**
 * A lap from a list of world positions, with the frame the graph
 * publishes: `up` is world up and `across` is `tangent x up`, which is
 * RIGHT of travel.
 *
 * The tangents are supplied rather than differenced, so a test can state
 * the curve exactly and let the model do the differencing — the same
 * division of labour the cooked frames have.
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
    // tangent x up, componentwise: (Ty*0 - Tz*1, Tz*0 - Tx*0, Tx*1 - Ty*0)
    across[i * 3] = -tangent[i * 3 + 2];
    across[i * 3 + 2] = tangent[i * 3];
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    s[i + 1] =
      s[i] + Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  const length = s[count];
  return { count, p, tangent, across, up, s, length, halfWidth: W, lengthW: length / W };
}

/**
 * A circle in the XZ plane, traversed with increasing angle.
 *
 * WHICH WAY DOES THIS TURN? At angle zero the point is (R, 0, 0) and the
 * tangent is +Z, so the driver faces +Z with world up; right of travel is
 * then tangent x up = -X, and the centre of the circle is at the origin,
 * which is also -X from the driver. The centre is to the right, so this
 * is a RIGHT-HANDER, and `turn` must read +1. Reverse the parameter and
 * every one of those statements flips.
 */
function circle(radiusW: number, n: number, phase = 0): Lap {
  const R = radiusW * W;
  const pts: [number, number, number][] = [];
  const tans: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = phase + (2 * Math.PI * i) / n;
    pts.push([R * Math.cos(th), 0, R * Math.sin(th)]);
    tans.push([-Math.sin(th), 0, Math.cos(th)]);
  }
  return lapFrom(pts, tans);
}

describe("curvature sign and radius", () => {
  it("reads a right-hander as positive, at the radius it was built with", () => {
    const lap = circle(5, 400);
    for (const i of [0, 37, 199, 355]) {
      // 1/R in half-widths, from a circle of radius 5W.
      expect(signedCurvatureAt(lap, i)).toBeCloseTo(1 / 5, 3);
      expect(radiusAtIndex(lap, i)).toBeCloseTo(5, 2);
    }
  });

  it("reads the same circle traversed the other way as negative", () => {
    // THE NEGATIVE CONTROL FOR THE SIGN. Same geometry, same radius,
    // opposite direction of travel: everything unsigned is identical and
    // only the sign moves. A model that ignored `across` would pass the
    // test above and fail this one.
    const lap = circle(5, 400);
    const rev = lapFrom(
      Array.from({ length: lap.count }, (_, i) => {
        const j = lap.count - 1 - i;
        return [lap.p[j * 3], lap.p[j * 3 + 1], lap.p[j * 3 + 2]] as [number, number, number];
      }),
      Array.from({ length: lap.count }, (_, i) => {
        const j = lap.count - 1 - i;
        return [-lap.tangent[j * 3], -lap.tangent[j * 3 + 1], -lap.tangent[j * 3 + 2]] as [
          number,
          number,
          number,
        ];
      }),
    );
    expect(signedCurvatureAt(rev, 100)).toBeCloseTo(-1 / 5, 3);
    expect(radiusAtIndex(rev, 100)).toBeCloseTo(5, 2);
  });

  it("calls a straight infinite rather than dividing by a tiny curvature", () => {
    const n = 64;
    const pts: [number, number, number][] = [];
    const tans: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      // A closed degenerate loop: out and back. The turn-arounds at the
      // ends are corners; the middle of each leg is dead straight.
      const x = i < n / 2 ? i : n - i;
      pts.push([x, 0, 0]);
      tans.push([i < n / 2 ? 1 : -1, 0, 0]);
    }
    const lap = lapFrom(pts, tans);
    expect(radiusAtIndex(lap, 8)).toBe(Number.POSITIVE_INFINITY);
    expect(signedCurvatureAt(lap, 8)).toBe(0);
  });
});

/**
 * A stadium: two straights of `straightW` joined by two semicircular
 * bends of `bendW`, both turning the same way.
 *
 * Exactly two corners, by construction, and their entries are a known
 * distance apart. Sampled at a uniform arc-length step so the central
 * difference behaves the same way everywhere.
 */
function stadium(bendW: number, straightW: number, stepW: number, rotate = 0): Lap {
  const R = bendW * W;
  const L = straightW * W;
  const step = stepW * W;
  const pts: [number, number, number][] = [];
  const tans: [number, number, number][] = [];

  const nStraight = Math.round(L / step);
  const nBend = Math.round((Math.PI * R) / step);

  // Straight 1: +Z at x = +R.
  for (let i = 0; i < nStraight; i++) {
    pts.push([R, 0, -L / 2 + (L * i) / nStraight]);
    tans.push([0, 0, 1]);
  }
  // Bend 1: centre (0,0,L/2), angle 0 -> pi.
  for (let i = 0; i < nBend; i++) {
    const f = (Math.PI * i) / nBend;
    pts.push([R * Math.cos(f), 0, L / 2 + R * Math.sin(f)]);
    tans.push([-Math.sin(f), 0, Math.cos(f)]);
  }
  // Straight 2: -Z at x = -R.
  for (let i = 0; i < nStraight; i++) {
    pts.push([-R, 0, L / 2 - (L * i) / nStraight]);
    tans.push([0, 0, -1]);
  }
  // Bend 2: centre (0,0,-L/2), angle pi -> 2pi.
  for (let i = 0; i < nBend; i++) {
    const f = Math.PI + (Math.PI * i) / nBend;
    pts.push([R * Math.cos(f), 0, -L / 2 + R * Math.sin(f)]);
    tans.push([-Math.sin(f), 0, Math.cos(f)]);
  }

  // Rotating the sampling start moves the start line without changing
  // one thing about the shape.
  const k = ((rotate % pts.length) + pts.length) % pts.length;
  return lapFrom([...pts.slice(k), ...pts.slice(0, k)], [...tans.slice(k), ...tans.slice(0, k)]);
}

describe("corner runs", () => {
  it("finds both bends of a stadium, on the correct side", () => {
    const lap = stadium(5, 60, 0.5);
    const cs = cornersOf(lap);
    expect(cs.length).toBe(2);
    for (const c of cs) {
      expect(c.turn).toBe(1);
      // Right-hander: the outside is to the LEFT, and lateral is
      // positive right of travel.
      expect(c.outside).toBe(-1);
      expect(c.tightestW).toBeGreaterThan(4.5);
      expect(c.tightestW).toBeLessThan(5.5);
      expect(c.severity).toBe(SEVERITY.sharpW > 5 ? "sharp" : "open");
    }
    // Half a lap apart, because the stadium is symmetric.
    const gap = beforeEntryW(cs[0].entryW, cs[1].entryW, lap.lengthW);
    expect(gap).toBeCloseTo(lap.lengthW / 2, 0);
  });

  it("mirrors the outside when the stadium is driven the other way", () => {
    // The same negative control as for the sign, one level up: the rule
    // that puts markers "on the outside" is only as good as this.
    const lap = stadium(5, 60, 0.5);
    const rev = lapFrom(
      Array.from({ length: lap.count }, (_, i) => {
        const j = lap.count - 1 - i;
        return [lap.p[j * 3], lap.p[j * 3 + 1], lap.p[j * 3 + 2]] as [number, number, number];
      }),
      Array.from({ length: lap.count }, (_, i) => {
        const j = lap.count - 1 - i;
        return [-lap.tangent[j * 3], -lap.tangent[j * 3 + 1], -lap.tangent[j * 3 + 2]] as [
          number,
          number,
          number,
        ];
      }),
    );
    const cs = cornersOf(rev);
    expect(cs.length).toBe(2);
    for (const c of cs) {
      expect(c.turn).toBe(-1);
      expect(c.outside).toBe(1);
    }
  });

  /**
   * THE WRAP, WHICH IS WHERE A NAIVE SCAN GETS IT WRONG.
   *
   * Rotating the start line into the middle of a bend does not change the
   * circuit at all — a lap is a loop and the start line is an arbitrary
   * cut in it. A scan that runs from index zero and closes a run at the
   * end of the array reports THREE corners here, and gives one of them a
   * false entry at station zero, which L-2 would then dutifully mark.
   */
  it("counts a bend straddling the start line as one corner", () => {
    const plain = cornersOf(stadium(5, 60, 0.5));
    for (const rotate of [40, 41, 200, 331]) {
      const cs = cornersOf(stadium(5, 60, 0.5, rotate));
      expect(cs.length, `rotated by ${rotate}`).toBe(2);
      expect(cs.map((c) => c.severity).sort()).toEqual(plain.map((c) => c.severity).sort());
      // And no invented entry sitting exactly on the cut.
      expect(cs.some((c) => c.entryW < 1e-9)).toBe(false);
    }
  });

  it("reports no corners on a lap that is one continuous bend", () => {
    // A circle has no entry: every frame is under the threshold, so there
    // is no frame that BEGINS a run. Reporting zero is correct and is
    // the reason the scan looks for a run start before it scans at all —
    // an implementation that started anywhere would cut the circle at an
    // arbitrary point and invent a corner there.
    expect(cornersOf(circle(5, 400))).toEqual([]);
    // And a circle wider than the threshold is a straight, not a corner.
    expect(cornersOf(circle(CORNER_R_W * 2, 400))).toEqual([]);
  });
});

describe("distance back to an entry", () => {
  it("measures the short way round, not the signed difference", () => {
    // 300W lap, entry at 2, marker at 4: the marker is 298W BEFORE the
    // next entry, not 2W after it. The naive subtraction gets this
    // backwards exactly once per lap and puts one corner's marker on the
    // far side of the start line.
    expect(beforeEntryW(4, 2, 300)).toBeCloseTo(298);
    expect(beforeEntryW(2, 4, 300)).toBeCloseTo(2);
    expect(beforeEntryW(299, 4, 300)).toBeCloseTo(5);
  });
});

describe("the generated circuit's corners", () => {
  it("agrees with a run count derived independently of the model", async () => {
    const frames = firstGeometry(
      (await cook(buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 })))
        .outputs[OUTPUTS.frames] ?? [],
    );
    if (!frames) throw new Error("no frames");
    const lap = readLap(frames);

    // The same definition, counted the other way: scan every frame and
    // count the transitions into a run. Independent of `cornersOf`'s
    // start-finding and wrap handling, which is the part being checked.
    let runs = 0;
    let inCorner = 0;
    for (let i = 0; i < lap.count; i++) {
      const here = radiusAtIndex(lap, i) < CORNER_R_W;
      const prev = radiusAtIndex(lap, (i - 1 + lap.count) % lap.count) < CORNER_R_W;
      if (here) {
        inCorner++;
        if (!prev) runs++;
      }
    }

    const cs = cornersOf(lap);
    expect(cs.length).toBe(runs);
    for (const c of cs) expect(c.tightestW).toBeLessThan(CORNER_R_W);

    const tight = cs.filter((c) => c.tightestW < SEVERITY.tightW).length;
    const sharp = cs.filter((c) => c.severity === "sharp").length;
    console.log(
      `corners: ${cs.length} on a ${lap.lengthW.toFixed(0)}W lap, ` +
        `${sharp} sharp (R<${SEVERITY.sharpW}W), ${tight} tight (R<${SEVERITY.tightW}W); ` +
        `${((100 * inCorner) / lap.count).toFixed(1)}% of the lap in a corner; ` +
        `${cs.filter((c) => c.turn === 1).length} right-handers`,
    );

    // BOTH DIRECTIONS MUST OCCUR. A circuit whose corners all turn the
    // same way would exercise only one branch of the outside rule, and
    // every marker could be on the wrong side without a test noticing.
    expect(cs.some((c) => c.turn === 1)).toBe(true);
    expect(cs.some((c) => c.turn === -1)).toBe(true);
  }, 300_000);
});
