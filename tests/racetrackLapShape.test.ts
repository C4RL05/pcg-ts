/**
 * The demo's spline, held to the target shape of a circuit.
 *
 * WHY THIS IS GATED. The spline is the demo's INPUT, and the rules it
 * exists to exercise are corner rules: dress a corner's approach, put a
 * braking ruler before a tight one, give each severity its own vocabulary.
 * A lap with no tight corners satisfies all of them by having nothing to
 * do, and would go on satisfying them while the generator quietly could
 * not handle a real track. The first version of this file did exactly
 * that — a radius p10 of 9.5W where the target range is 5.1 to 8.8, and
 * almost nothing in the tight bucket at all.
 *
 * THE BANDS ARE p10-p90 SPREADS, not tolerances. Landing
 * inside them means this lap is the kind of thing the rules were written
 * for; landing outside means the demo is testing something else. They are
 * the rules' figures, length-weighted, with corners counted as RUNS so a
 * long bend is one corner rather than forty.
 *
 * These are checked against the SPLINE ITSELF rather than against a cook,
 * so a failure points at `spline.ts` and not at the graph.
 */
import { describe, expect, it } from "vitest";
import { makeTrackSpline } from "../demos/racetrack/spline.js";

/**
 * Curvature bucket cuts in W, and the share of lap length each holds.
 *
 * The cuts are the rules' rather than guessed — an earlier version here
 * used 8 / 16 / 30 and the straight edge was well off, which moves a lot
 * of track between buckets for a keyed statistic.
 *
 * The shares are p10-p90 ranges, so they say what an ordinary lap looks
 * like rather than what this one must hit. A single catalogue variant can
 * sit outside them — the street one reads 58.7% straight against a 53.3
 * p90 — so tuning toward any one variant would be tuning toward an
 * outlier.
 */
const BUCKETS = [
  { name: "tight", lo: 0, hi: 7, share: [0.046, 0.189] },
  { name: "medium", lo: 7, hi: 15, share: [0.134, 0.374] },
  { name: "easy", lo: 15, hi: 40, share: [0.129, 0.332] },
  { name: "straight", lo: 40, hi: Infinity, share: [0.342, 0.533] },
] as const;

interface Shape {
  lapW: number;
  p10: number;
  median: number;
  tightest: number;
  corners: number;
  perTwentyW: number;
  cornerShare: number;
  trueStraight: number;
}

/**
 * Every published lap-shape figure, measured the way the rules define it.
 *
 * Curvature by central difference of unit tangents, which is what
 * `writeCurveFrame` does — so this measures the same quantity the cooked
 * frames will carry rather than a second definition of it.
 */
function shapeOf(seed: number): Shape {
  const spline = makeTrackSpline({ seed });
  const p = spline.positions;
  const n = p.length / 3;
  const W = spline.halfWidth;

  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    length += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  const step = length / n;

  const T = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const x = p[b * 3] - p[a * 3];
    const y = p[b * 3 + 1] - p[a * 3 + 1];
    const z = p[b * 3 + 2] - p[a * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    T[i * 3] = x / l;
    T[i * 3 + 1] = y / l;
    T[i * 3 + 2] = z / l;
  }

  const R: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const k = Math.hypot(
      (T[b * 3] - T[a * 3]) / (2 * step),
      (T[b * 3 + 1] - T[a * 3 + 1]) / (2 * step),
      (T[b * 3 + 2] - T[a * 3 + 2]) / (2 * step),
    );
    R.push(k > 1e-12 ? 1 / (k * W) : Infinity);
  }

  const finite = R.filter(Number.isFinite).sort((a, b) => a - b);
  const pctl = (f: number): number => finite[Math.min(finite.length - 1, Math.floor(f * finite.length))];

  // Corners as RUNS under R = 12W, the rules' definition.
  let corners = 0;
  let inCorner = 0;
  for (let i = 0; i < n; i++) {
    if (R[i] < 12) {
      inCorner++;
      if (!(R[(i - 1 + n) % n] < 12)) corners++;
    }
  }

  const lapW = length / W;
  return {
    lapW,
    p10: pctl(0.1),
    median: pctl(0.5),
    tightest: Math.min(...finite),
    corners,
    perTwentyW: (corners / lapW) * 20,
    cornerShare: inCorner / n,
    // R >= 200W is straight in the sense a DRIVER would recognise. The
    // `straight` bucket starts at 40W and 40W still curves visibly over a
    // long run, so the bucket overstates real straight by nearly double —
    // which is why this is measured separately and not read off it.
    trueStraight: R.filter((r) => r >= 200).length / n,
  };
}

describe("the demo's lap is shaped like a racing circuit", () => {
  const s = shapeOf(1);

  it("reports its shape", () => {
    console.log(
      [
        "lap shape, seed 1 (bands are p10-p90 spreads)",
        `  lap length        ${s.lapW.toFixed(0)} W        [286-443]`,
        `  radius p10        ${s.p10.toFixed(1)} W        [5.1-8.8]`,
        `  radius median     ${s.median.toFixed(1)} W       [16.4-45.1]`,
        `  tightest corner   ${s.tightest.toFixed(1)} W        [2.2-5.5]`,
        `  corners           ${s.corners} (${s.perTwentyW.toFixed(2)} per 20W)  [0.61-1.33]`,
        `  share in corner   ${(100 * s.cornerShare).toFixed(0)}%        [20-37]`,
        `  truly straight    ${(100 * s.trueStraight).toFixed(0)}%        [14.2-39.7]  R >= 200W`,
      ].join("\n"),
    );
    expect(s.lapW).toBeGreaterThan(0);
  });

  it.each([
    ["lap length", () => s.lapW, 286, 443],
    ["radius p10", () => s.p10, 5.1, 8.8],
    ["radius median", () => s.median, 16.4, 45.1],
    ["tightest corner", () => s.tightest, 2.2, 5.5],
    ["corners per 20W", () => s.perTwentyW, 0.61, 1.33],
    ["share of lap in corner", () => s.cornerShare, 0.2, 0.37],
    ["truly straight share", () => s.trueStraight, 0.142, 0.397],
  ])("%s lands inside the measured band", (_name, get, lo, hi) => {
    const v = get();
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
  });

  /**
   * THE ONE THE OLD SPLINE FAILED, and the reason the construction
   * changed. L-2 and L-3 dress corner approaches and tight bends; with
   * nothing in the tight bucket a generator satisfies them vacuously.
   */
  it("holds every curvature bucket inside its measured share", () => {
    const spline = makeTrackSpline({ seed: 1 });
    const p = spline.positions;
    const n = p.length / 3;
    const W = spline.halfWidth;
    let length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      length += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
    }
    const step = length / n;
    const R: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const t = (idx: number, c: number): number => {
        const x = p[((idx + 1) % n) * 3 + c] - p[((idx - 1 + n) % n) * 3 + c];
        return x;
      };
      const norm = (idx: number): number => Math.hypot(t(idx, 0), t(idx, 1), t(idx, 2)) || 1;
      const k = Math.hypot(
        (t(b, 0) / norm(b) - t(a, 0) / norm(a)) / (2 * step),
        (t(b, 1) / norm(b) - t(a, 1) / norm(a)) / (2 * step),
        (t(b, 2) / norm(b) - t(a, 2) / norm(a)) / (2 * step),
      );
      R.push(k > 1e-12 ? 1 / (k * W) : Infinity);
    }
    const shares = BUCKETS.map((b) => ({
      name: b.name,
      share: R.filter((r) => r >= b.lo && r < b.hi).length / R.length,
    }));
    console.log(
      "curvature buckets: " + shares.map((b) => `${b.name} ${(100 * b.share).toFixed(1)}%`).join("  "),
    );
    // Every bucket, not only the tight one: a lap can carry enough tight
    // corners while being wrong everywhere else, and the four shares are a
    // stricter statement of "this is the kind of track the rules were
    // measured on" than any single figure.
    for (const b of BUCKETS) {
      const got = shares.find((x) => x.name === b.name) as { share: number };
      expect(got.share, `${b.name} share`).toBeGreaterThanOrEqual(b.share[0]);
      expect(got.share, `${b.name} share`).toBeLessThanOrEqual(b.share[1]);
    }
  });

  /**
   * THE ONE A MEDIAN CANNOT SEE, and the reason it is gated separately.
   *
   * The first windowless wobble put the median radius squarely in band
   * and left only 11.5% of the lap truly straight, under a target p10
   * of 14.2. "Half the lap curves" and "a quarter of it does not" are
   * both true of a circuit and neither implies the other, so a lap
   * can satisfy the median while having no straight at all — which is a
   * different track to drive and a different one to dress.
   *
   * Checked across seeds because the window's phase moves with the seed,
   * and a window that happens to align with the long edges on seed 1
   * would pass here while failing for everyone else.
   */
  it.each([1, 2, 3, 4])("keeps a real straight on seed %i", (seed) => {
    const t = shapeOf(seed).trueStraight;
    expect(t).toBeGreaterThanOrEqual(0.142);
    expect(t).toBeLessThanOrEqual(0.397);
  });

  it("gives a different lap for a different seed, and the same one twice", () => {
    const a = makeTrackSpline({ seed: 1 }).positions;
    const b = makeTrackSpline({ seed: 1 }).positions;
    const c = makeTrackSpline({ seed: 2 }).positions;
    expect(Array.from(a.slice(0, 30))).toEqual(Array.from(b.slice(0, 30)));
    expect(Array.from(a.slice(0, 30))).not.toEqual(Array.from(c.slice(0, 30)));
  });
});
