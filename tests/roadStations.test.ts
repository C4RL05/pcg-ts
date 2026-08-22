/**
 * The station process, held to the published dispersion curve.
 *
 * WHY THE CURVE AND NOT A SINGLE NUMBER. "How clumped is this" has a
 * different answer at every scale, and the source's answer is a SHAPE:
 * it climbs from a 2W window to about 16-24W and then stops. Two
 * mechanisms that fail this test pass a single-window one — a lap-scale
 * envelope keeps climbing to 38 and 60, and a single level of clustering
 * flattens to about 1.9 everywhere. Both would score correctly at one
 * window chosen badly, which is why the rule was restated twice upstream
 * before becoming a curve.
 *
 * AND WHY THE SHAPE AND NOT THE VALUES. The published row is a median
 * over circuits whose p10-p90 at a 32W window is [1.7, 26.4]. A lap
 * landing on 6.63 there is no more expected than one at 2 or at 20, so
 * the values are reported and bracket-checked while the SHAPE is what is
 * actually gated. The two negatives below are the reason that is enough:
 * both wrong mechanisms are wrong in shape, and both sit comfortably
 * inside those brackets while being wrong.
 *
 * MEASURED AT UPSTREAM'S WIDTHS AND WITH UPSTREAM'S DEFINITION —
 * 2/4/8/16/32/64/128 W, variance-to-mean of the count in a window,
 * Poisson null at 1.0. Not because those widths are special but because
 * they are the ones the published table uses, and two curves at different
 * widths are two statistics.
 *
 * AVERAGED OVER SEEDS. At a 128W window a 347W lap holds two bins, so one
 * seed's figure there is nearly meaningless; the source's own circuits
 * are 286-443W and had the same problem. The gate is on the mean over
 * eight laps, and the per-seed spread is reported so nobody reads the
 * mean as a promise about one lap.
 */
import { describe, expect, it } from "vitest";
import { Pcg32, hashCombine } from "pcg-ts";
import {
  DENSITY,
  DISPERSION_SPREAD,
  DISPERSION_TARGET,
  DISPERSION_WINDOWS_W,
  FITTED,
  coverage,
  dispersionCurve,
  indexOfDispersion,
  makeStations,
  makeStationsDetailed,
} from "../demos/road/stations.js";

/** The demo's own lap length, so the gate is measured where it is used. */
const LAP_W = 347;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function meanCurve(lapW = LAP_W): number[] {
  const acc = new Array<number>(DISPERSION_WINDOWS_W.length).fill(0);
  for (const s of SEEDS) {
    const c = dispersionCurve(makeStations(lapW, s), lapW);
    for (let i = 0; i < acc.length; i++) acc[i] += c[i] / SEEDS.length;
  }
  return acc;
}

describe("the station process", () => {
  it("reports its curve against the source", () => {
    const got = meanCurve();
    const row = (label: string, v: readonly number[]): string =>
      label.padEnd(9) + v.map((x) => x.toFixed(2).padStart(7)).join("");
    console.log(
      [
        `dispersion, mean of ${SEEDS.length} laps at ${LAP_W} W, non-overlapping windows`,
        "window   " + DISPERSION_WINDOWS_W.map((w) => `${w}W`.padStart(7)).join(""),
        row("got", got),
        row("source", DISPERSION_TARGET),
        row("poisson", DISPERSION_WINDOWS_W.map(() => 1)),
      ].join("\n"),
    );
    expect(got.length).toBe(DISPERSION_TARGET.length);
  });

  /**
   * INSIDE THE BRACKETS, NOT ON THE MEDIAN — and the difference is the
   * whole point.
   *
   * The published row is a median over circuits whose p10-p90 at a 32W
   * window is [1.7, 26.4]: a fifteen-fold range. An earlier version of
   * this file gated each window within 25% of the median, which would
   * have been fitting to the centre of a distribution that wide — a
   * target no real circuit is expected to hit, easy to reach by accident,
   * and meaningless when reached. The brackets are what the source
   * actually constrains.
   */
  it.each(DISPERSION_WINDOWS_W.map((w, i) => [w, i] as const))(
    "sits inside the source's spread at a %iW window",
    (_w, i) => {
      const got = meanCurve()[i];
      const [lo, hi] = DISPERSION_SPREAD[i];
      expect(got).toBeGreaterThanOrEqual(lo);
      expect(got).toBeLessThanOrEqual(hi);
    },
  );

  /**
   * THE SHAPE, ASSERTED SEPARATELY FROM THE VALUES.
   *
   * Every window could sit inside its tolerance while the curve did
   * something the source never does — and the two failure modes upstream
   * names are both shape failures rather than value failures. So the
   * climb and the plateau are checked as relations, which no amount of
   * per-window slack can satisfy by accident.
   */
  it("climbs to the middle scales and then stops", () => {
    const c = meanCurve();
    const at = (w: number): number => c[DISPERSION_WINDOWS_W.indexOf(w as never)];
    // Climbs: every window up to 32W is above the one below it.
    expect(at(4)).toBeGreaterThan(at(2));
    expect(at(8)).toBeGreaterThan(at(4));
    expect(at(16)).toBeGreaterThan(at(8));
    expect(at(32)).toBeGreaterThan(at(16));
    // And stops: 64 and 128 do not keep climbing. A lap-scale envelope
    // reaches 38 and 60 here, which is the thing this forbids.
    //
    // 64W AND 128W ARE THE DIAGNOSTIC WINDOWS, and worth knowing if an
    // envelope is ever suspected of having crept back in. A depth-1.0
    // lap-period envelope reads 1.9 / 2.8 / 4.5 / 9.8 / 17.7 / 38.3 /
    // 60.2 — inside the source's p90 from 2W through 32W, and outside it
    // only at the last two, which is exactly where a swell puts its
    // variance and the only place the brackets are narrow relative to it.
    // Everything narrower will look fine.
    expect(at(128)).toBeLessThan(at(32) * 1.15);
    expect(at(128)).toBeLessThan(12);
  });

  /**
   * THE CONTROL. A homogeneous Poisson process at the same density must
   * read about 1.0 at every window, and if it does not then the
   * instrument is wrong and every figure above is meaningless. This is
   * the same discipline as the shuffled hop and the random-mask fill:
   * prove the measurement can report "not clumped" before believing it
   * when it reports "clumped".
   */
  it("reads 1.0 for a Poisson process, so the instrument works", () => {
    const flat = makeStations(LAP_W, 1, {
      ...FITTED,
      // Every placement from the flat background: no clustering at all.
      background: 1,
    });
    for (const w of DISPERSION_WINDOWS_W) {
      const d = indexOfDispersion(flat, LAP_W, w);
      expect(d, `window ${w}W`).toBeGreaterThan(0.55);
      expect(d, `window ${w}W`).toBeLessThan(1.9);
    }
  });

  it("hits D-1's budget exactly", () => {
    for (const seed of SEEDS) {
      const n = makeStations(LAP_W, seed).length;
      expect(n).toBe(Math.round(DENSITY.target * LAP_W));
      const perW = n / LAP_W;
      expect(perW).toBeGreaterThan(DENSITY.min);
      expect(perW).toBeLessThan(DENSITY.max);
    }
  });

  it("meets D-4's coverage floor on every seed", () => {
    const within: number[] = [];
    const gaps: number[] = [];
    for (const seed of SEEDS) {
      const k = coverage(makeStations(LAP_W, seed), LAP_W);
      within.push(k.within2W);
      gaps.push(k.longestGapW);
    }
    console.log(
      `D-4: within 2W ${(100 * Math.min(...within)).toFixed(1)}-${(100 * Math.max(...within)).toFixed(1)}% ` +
        `(floor 85)   longest gap ${Math.min(...gaps).toFixed(1)}-${Math.max(...gaps).toFixed(1)} W (limit 25)`,
    );
    // Clustering and a coverage floor pull against each other, which is
    // why this is gated beside the curve rather than after it: a process
    // fitted to the curve alone will happily leave a 40W hole.
    for (const v of within) expect(v).toBeGreaterThanOrEqual(0.85);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(25);
  });

  /**
   * THE TWO NEGATIVES, AND WHY THEY ARE HERE RATHER THAN IN A COMMENT.
   *
   * The shape gate above is the only real gate in this file, so it is
   * worth knowing it can FAIL.
   *
   * And it is the ONLY thing that catches a mild envelope. A depth-1.0
   * one is caught by the brackets, but late — only at 64W and 128W. One
   * mild enough to sit inside every bracket is invisible to them at every
   * width, and the envelope built below is that kind. Upstream names two mechanisms that read as
   * the same rule and are not, and both were built and measured
   * downstream before being ruled out — so they are the exact shapes this
   * has to reject. Building them here and watching the gate refuse them
   * is the same discipline as the shuffled hop and the random-mask fill:
   * an instrument that has never said no has not been shown to work.
   */
  describe("the shapes the source does not have", () => {
    const shape = (stations: readonly number[]): { climbs: boolean; stops: boolean } => {
      const c = dispersionCurve(stations, LAP_W);
      const at = (w: number): number => c[DISPERSION_WINDOWS_W.indexOf(w as never)];
      return {
        climbs: at(4) > at(2) && at(8) > at(4) && at(16) > at(8) && at(32) > at(16),
        stops: at(128) < at(32) * 1.15,
      };
    };

    it("rejects a single-period envelope, which peaks instead of plateauing", () => {
      // An inhomogeneous Poisson process with a lap-periodic rate. This is
      // D-5's forbidden mechanism, built from scratch rather than by
      // turning a knob, so it cannot accidentally inherit the fitted
      // process's shape.
      const rng = new Pcg32(hashCombine(1, 0x1111));
      const n = Math.round(DENSITY.target * LAP_W);
      const stations: number[] = [];
      const period = 40;
      while (stations.length < n) {
        const s0 = rng.nextF32() * LAP_W;
        const rate = 0.5 + 0.5 * Math.cos((2 * Math.PI * s0) / period);
        if (rng.nextF32() < rate) stations.push(s0);
      }
      stations.sort((a, b) => a - b);
      const got = shape(stations);
      // It may climb toward the modulation period; what it must not do is
      // climb all the way and stay up, because the variance a swell adds
      // averages out in windows wider than the swell.
      expect(got.climbs && got.stops).toBe(false);
    });

    it("rejects a single clustering level, which flattens to about 1.9", () => {
      // One level: cluster anchors ARE super anchors, so nothing carries
      // the middle scales.
      const oneLevel = makeStations(LAP_W, 1, {
        ...FITTED,
        clustersPerSuper: 1,
        superSpreadW: 0.001,
      });
      const c = dispersionCurve(oneLevel, LAP_W);
      const at = (w: number): number => c[DISPERSION_WINDOWS_W.indexOf(w as never)];
      console.log(
        "one clustering level: " +
          DISPERSION_WINDOWS_W.map((w, i) => `${w}W ${c[i].toFixed(1)}`).join("  "),
      );
      // The published symptom is a flat curve rather than a climbing one.
      // Whatever it does, it must not reproduce the two-level shape.
      expect(at(32) / at(2)).toBeLessThan(meanCurve()[4] / meanCurve()[0]);
    });
  });

  /**
   * THE REPAIR HAS TO SAY HOW OFTEN IT FIRED.
   *
   * Zero fires and a working repair leave identical green tests, so a
   * coverage gate alone cannot tell "the process never left a hole" from
   * "the repair fixed every hole" from "the repair is unreachable and the
   * process happened to be fine on these eight seeds". This is the
   * generalisation of a corridor rule in `zones.ts` that passed every
   * assertion while being impossible to trigger.
   *
   * It also pins a real claim: the process DOES leave holes, which is why
   * the repair exists rather than being belt-and-braces over a fit that
   * was already good enough.
   */
  it("reports how often the coverage repair fired, and it is not never", () => {
    let fired = 0;
    let worstBefore = 0;
    const overLimit: number[] = [];
    for (const seed of SEEDS) {
      const d = makeStationsDetailed(LAP_W, seed);
      fired += d.gapRepairs;
      worstBefore = Math.max(worstBefore, d.worstGapBeforeW);
      if (d.worstGapBeforeW > 25) overLimit.push(seed);
    }
    console.log(
      `D-4 repair: fired ${fired} times over ${SEEDS.length} laps; ` +
        `worst gap before repair ${worstBefore.toFixed(1)} W; ` +
        `laps that needed it: ${overLimit.length}/${SEEDS.length}`,
    );
    expect(fired).toBeGreaterThan(0);
    // And the un-repaired process really does violate D-4, which is the
    // claim that justifies a repair pass over more fitting.
    expect(worstBefore).toBeGreaterThan(25);
  });

  it("gives the same lap twice and a different one per seed", () => {
    expect(makeStations(LAP_W, 1)).toEqual(makeStations(LAP_W, 1));
    expect(makeStations(LAP_W, 1)).not.toEqual(makeStations(LAP_W, 2));
  });

  it("scales its count with the lap rather than stretching a fixed one", () => {
    // A rule stated per W is a DENSITY. Stretching a fixed count over a
    // longer lap inflates every gap and breaks D-1 and D-4 at once, which
    // is the distinction between the reference log (one circuit's
    // dressing, which scales) and the rules (a density, which does not).
    const short = makeStations(300, 1).length;
    const long = makeStations(600, 1).length;
    expect(long / short).toBeCloseTo(2, 1);
  });
});
