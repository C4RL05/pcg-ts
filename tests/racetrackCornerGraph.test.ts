/**
 * The corner model as a graph, against the corner model as a loop.
 *
 * THIS IS THE ONE PORT THAT CAN BE CHECKED EXACTLY, and the suite is
 * built around that. The station process and the asset choice both draw
 * random numbers off `randomField`, which keys on point identity rather
 * than on a position in a stream, so neither could reproduce the lap its
 * TypeScript produced and both had to be judged distributionally. A
 * corner is geometry: the same frames, the same threshold, the same
 * arithmetic, no draw anywhere. So the claim here is equality, corner for
 * corner, on every lap that can be built — which is a far stronger test
 * than "the distributions overlap", and it is the reason this file asserts
 * so little about statistics and so much about identity.
 *
 * BOTH SIDES READ THE SAME COLUMNS. `cornerColumnsOf` produces the
 * segmented scans for a hand-built lap and the road graph produces them
 * for a cooked one; either way the two implementations under comparison
 * are handed the same input, so a disagreement is about the ASSEMBLY this
 * port replaced rather than about two different measurements of one bend.
 */
import { describe, expect, it } from "vitest";
import {
  CORNER_R_W,
  type Corner,
  SEVERITY,
  cornerColumnsOf,
  cornersOf,
} from "../demos/racetrack/corners.js";
import { cookCorners } from "../demos/racetrack/cornerGraph.js";
import type { Lap } from "../demos/racetrack/lap.js";
import { lapFor } from "./support/lap.js";

const W = 4;

/** A lap from stated positions and stated tangents. See racetrackCorners. */
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
    across[i * 3] = -tangent[i * 3 + 2];
    across[i * 3 + 2] = tangent[i * 3];
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    s[i + 1] =
      s[i] +
      Math.hypot(
        p[j * 3] - p[i * 3],
        p[j * 3 + 1] - p[i * 3 + 1],
        p[j * 3 + 2] - p[i * 3 + 2],
      );
  }
  const length = s[count];
  return { count, p, tangent, across, up, s, length, halfWidth: W, lengthW: length / W };
}

/**
 * Attach the corner columns a hand-built lap has never been given.
 *
 * WITHOUT THIS THE GRAPH REFUSES THE LAP, deliberately: `cookCorners`
 * derives corners from the model's columns rather than re-measuring the
 * tangents, and a lap that carries none has nothing to derive from. The
 * suite supplies them from `corners.ts`' own restatement, which is what
 * `cornersOf` would have used anyway — so this is not the test dodging a
 * refusal, it is the test making both sides read one input.
 */
function withColumns(lap: Lap): Lap {
  return { ...lap, corner: cornerColumnsOf(lap) };
}

/** A circle in XZ, traversed with increasing angle: a RIGHT-hander. */
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

/**
 * Two straights joined by two half-circle bends, driven anticlockwise.
 *
 * `rotate` turns the whole point list so the start line falls elsewhere —
 * which is how a bend is made to straddle it.
 */
function stadium(bendW: number, straightW: number, stepW: number, rotate = 0): Lap {
  const R = bendW * W;
  const L = straightW * W;
  const step = stepW * W;
  const pts: [number, number, number][] = [];
  const tans: [number, number, number][] = [];
  const push = (x: number, z: number, tx: number, tz: number) => {
    pts.push([x, 0, z]);
    tans.push([tx, 0, tz]);
  };
  const nStraight = Math.max(2, Math.round(L / step));
  const nBend = Math.max(3, Math.round((Math.PI * R) / step));
  for (let i = 0; i < nStraight; i++) push(-R, -L / 2 + (L * i) / nStraight, 0, 1);
  for (let i = 0; i < nBend; i++) {
    const th = Math.PI + (Math.PI * i) / nBend;
    push(R * Math.cos(th), L / 2 + R * Math.sin(th), Math.sin(th), -Math.cos(th));
  }
  for (let i = 0; i < nStraight; i++) push(R, L / 2 - (L * i) / nStraight, 0, -1);
  for (let i = 0; i < nBend; i++) {
    const th = (Math.PI * i) / nBend;
    push(R * Math.cos(th), -L / 2 + R * Math.sin(th), Math.sin(th), -Math.cos(th));
  }
  const n = pts.length;
  const r = ((rotate % n) + n) % n;
  return lapFrom([...pts.slice(r), ...pts.slice(0, r)], [...tans.slice(r), ...tans.slice(0, r)]);
}

/**
 * The comparison, written once.
 *
 * TOLERANCES, AND WHY THEY ARE NOT ZERO. The graph computes in f32
 * attribute columns and `cornersOf` in f64, so a station running to a few
 * hundred W lands within f32's spacing there and a radius within its own.
 * Everything that is an IDENTITY rather than a measurement — the count,
 * the turn sign, the severity — is compared exactly, because a tolerance
 * on those would be hiding a disagreement rather than allowing for one.
 */
function expectSameCorners(got: readonly Corner[], want: readonly Corner[], lapW: number): void {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    const g = got[i];
    const w = want[i];
    const at = `corner ${i}`;
    // A station is modular, so two values a hair either side of the seam
    // are the same station and a plain difference calls them a lap apart.
    const near = (a: number, b: number) => {
      const d = Math.abs(a - b) % lapW;
      return Math.min(d, lapW - d);
    };
    expect(near(g.entryW, w.entryW), `${at} entry`).toBeLessThan(1e-3);
    expect(near(g.exitW, w.exitW), `${at} exit`).toBeLessThan(1e-3);
    expect(Math.abs(g.tightestW - w.tightestW), `${at} tightest`).toBeLessThan(1e-3);
    expect(g.turn, `${at} turn`).toBe(w.turn);
    expect(g.severity, `${at} severity`).toBe(w.severity);
    // OUTSIDE IS CHECKED TWICE, AGAINST TWO THINGS, because it is the
    // field a mirrored answer hides in. `corners.ts` says so directly:
    // "a mirrored turn direction produces a lap where every marker is on
    // the wrong side while every count, share and distance still passes".
    // The first check is agreement with the loop; the second is the
    // relation itself, so that both implementations flipping together —
    // which is what a shared helper would let happen — still fails.
    expect(g.outside, `${at} outside`).toBe(w.outside);
    expect(g.outside, `${at} outside is the turn negated`).toBe(-g.turn);
  }
}

describe("cornerGraph: against the loop it replaces", () => {
  it("finds both bends of a stadium, exactly as cornersOf does", async () => {
    const lap = withColumns(stadium(5, 40, 0.5));
    const want = cornersOf(lap);
    expect(want.length).toBe(2);
    expectSameCorners(await cookCorners({ lap }), want, lap.lengthW);
  });

  it("keeps a bend that straddles the start line as ONE corner", async () => {
    // The case a prefix sum cannot answer and the one that would
    // otherwise invent an extra corner with a false entry at station
    // zero. Rotated so a bend sits across the seam.
    const lap = withColumns(stadium(5, 40, 0.5, 8));
    const want = cornersOf(lap);
    expect(want.length).toBe(2);
    expectSameCorners(await cookCorners({ lap }), want, lap.lengthW);
  });

  it("reports no corners on a lap that is one continuous bend", async () => {
    // A circle has no straight frame, so it has no ENTRY: a segmented
    // scan with nothing to reset on starts counting at the seam, and the
    // frame there reads 1. Both sides have to refuse that, or a circle
    // acquires a corner nothing turned into, cut at an arbitrary point.
    const lap = withColumns(circle(5, 240));
    expect(cornersOf(lap)).toEqual([]);
    expect(await cookCorners({ lap })).toEqual([]);
  });

  it("agrees on the generated circuit, corner for corner", async () => {
    // THE REAL LAP, and the reason this suite exists. 19 corners of
    // varying severity, one of which the seam runs through on some seeds.
    for (let seed = 1; seed <= 4; seed++) {
      const { lap } = await lapFor(seed);
      const want = cornersOf(lap);
      expect(want.length).toBeGreaterThan(5);
      expectSameCorners(await cookCorners({ lap }), want, lap.lengthW);
    }
  });

  it("puts the severity split and L-3's gate where corners.ts puts them", async () => {
    const { lap } = await lapFor(1);
    const got = await cookCorners({ lap });
    const want = cornersOf(lap);
    const sharp = (cs: readonly Corner[]) => cs.filter((c) => c.severity === "sharp").length;
    const tight = (cs: readonly Corner[]) =>
      cs.filter((c) => c.tightestW < SEVERITY.tightW).length;
    // eslint-disable-next-line no-console
    console.log(
      `seed 1: ${got.length} corners, ${sharp(got)} sharp (R<${SEVERITY.sharpW}W), ${tight(got)} tight (R<${SEVERITY.tightW}W)`,
    );
    expect(sharp(got)).toBe(sharp(want));
    expect(tight(got)).toBe(tight(want));
    // Every corner is under the threshold that defines one, which is the
    // claim the minimum has to get right for any of the above to mean
    // anything: a reduction that returned the LAST radius instead of the
    // smallest would still pass a count.
    for (const c of got) expect(c.tightestW).toBeLessThan(CORNER_R_W);
  });

  it("gives the same corners twice, from the same lap", async () => {
    const { lap } = await lapFor(2);
    expect(await cookCorners({ lap })).toEqual(await cookCorners({ lap }));
  });

  it("refuses a lap with no corner model, naming both ways out", async () => {
    const lap = stadium(5, 40, 0.5);
    expect(lap.corner).toBeUndefined();
    await expect(cookCorners({ lap })).rejects.toThrow(/carries no corner model/);
  });
});
