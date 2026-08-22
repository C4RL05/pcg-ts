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
  COVERAGE,
  type CoverageRepair,
  DENSITY,
  DISPERSION_SPREAD,
  DISPERSION_TARGET,
  DISPERSION_WINDOWS_W,
  FITTED,
  coverage,
  coverageIsMinimal,
  dispersionCurve,
  indexOfDispersion,
  makeStations,
  makeStationsDetailed,
  placementCoverageIsMinimal,
  repairPlacementCoverage,
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

    // MINIMAL, by the same criterion the band-mix repair is held to: both
    // conserve the count, so neither can be characterised by where a
    // placement lands — only by whether any move it made was removable
    // with the bound still holding.
    for (const seed of SEEDS) {
      const d = makeStationsDetailed(LAP_W, seed);
      const { minimal, removable } = coverageIsMinimal(d, LAP_W);
      expect(minimal, `seed ${seed}: ${removable} of ${d.gapRepairs} moves unnecessary`).toBe(true);
    }
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

/**
 * D-4 AT THE PLACEMENT LEVEL — §9's stage 6, which is the one that
 * actually enforces the rule.
 *
 * WHY THERE ARE TWO COVERAGE PASSES AND NOT ONE. The pass above runs at
 * stage 1, on bare stations, and it is honest there: it closes every hole
 * the two-level clustering left. Then stage 4's sightline cull moves and
 * DROPS placements, and every gap it opens is opened after the only thing
 * that was looking for gaps had already finished. A lap can therefore
 * finish outside D-4 while the stage-1 figure reads zero repairs — the
 * exact mis-sequencing that put the band mix and the landmark rules after
 * the cull rather than before it.
 *
 * THE REPAIR MOVES, IT DOES NOT RE-DRAW, and that is the whole reason it
 * is generic over the placement rather than operating on stations. A
 * station-level pass can only hand back numbers, so a caller wanting to
 * close a gap in a DRESSED lap would have to draw a fresh asset for the
 * hole — which passes a count check while quietly re-rolling the
 * vocabulary L-4 is measured on. Moving the donor keeps its asset, its
 * lateral and its height, so D-1's count and L-4's uniqueness both come
 * through untouched.
 *
 * EVERY CHECK HERE IS PROVED ABLE TO FAIL FIRST. A hole is built by hand
 * before the repair is asked to close one; the identity check is shown
 * rejecting a re-drawn asset; the minimality check is shown rejecting a
 * repair with a surplus move; and the protection is tested on a lap where
 * the protected placement would otherwise have been the donor. A check
 * whose only evidence is that it passes on correct input is
 * indistinguishable from one that always passes.
 */
describe("D-4 after the cull", () => {
  /**
   * A stand-in for a dressed placement: a station plus the fields a move
   * must not touch. `t`/`h` are drawn as f32s so the triple is a
   * fingerprint — a re-drawn placement cannot collide with the one it
   * replaced by accident.
   */
  interface TestPlacement {
    readonly station: number;
    /** Stands in for the asset id. */
    readonly id: number;
    readonly t: number;
    readonly h: number;
    /** What the corner language would pin. */
    readonly pinned?: boolean;
  }

  function dressStations(lapW: number, seed: number): TestPlacement[] {
    const rng = new Pcg32(hashCombine(seed, 0x0d4e));
    return makeStations(lapW, seed).map((station) => ({
      station,
      id: 100 + Math.floor(rng.nextF32() * 40),
      t: rng.nextF32() * 6 - 3,
      h: rng.nextF32() * 2,
    }));
  }

  /** The multiset of everything that is not a station. */
  const fingerprint = (ps: readonly TestPlacement[]): string[] =>
    ps.map((p) => `${p.id}:${p.t}:${p.h}`).sort();

  /**
   * TWO STAND-INS FOR THE CULL, because the shape of what it removes is
   * what decides whether a hole opens at all.
   *
   * The uniform one is the OPTIMISTIC model: scattered single drops
   * rarely leave a hole, because a placement's neighbours are still
   * there. The real cull is not uniform — it drops what stands in the
   * cone, which is the inside of corners, so it removes correlated runs.
   * The window model is that shape. Neither is a measurement of the real
   * cull, which needs a cooked lap and the kit and so lives in
   * `roadSightline.test.ts`; they are here to say what the repair does
   * with each shape, and the honest reading is that the uniform figures
   * are a LOWER bound on how often stage 6 has work to do.
   */
  function dropUniform(
    ps: readonly TestPlacement[],
    rate: number,
    seed: number,
  ): TestPlacement[] {
    const rng = new Pcg32(hashCombine(seed, 0xc011));
    return ps.filter(() => rng.nextF32() >= rate);
  }

  function dropWindow(
    ps: readonly TestPlacement[],
    widthW: number,
    seed: number,
    lapW = LAP_W,
  ): TestPlacement[] {
    const rng = new Pcg32(hashCombine(seed, 0xc02e));
    const s0 = rng.nextF32() * lapW;
    return ps.filter((p) => {
      let d = (p.station - s0) % lapW;
      if (d < 0) d += lapW;
      return d >= widthW;
    });
  }

  const CULLS: {
    name: string;
    apply: (ps: readonly TestPlacement[], seed: number) => TestPlacement[];
  }[] = [
    { name: "no cull", apply: (ps) => [...ps] },
    { name: "uniform 20%", apply: (ps, seed) => dropUniform(ps, 0.2, seed) },
    { name: "26W window", apply: (ps, seed) => dropWindow(ps, 26, seed) },
  ];

  /**
   * THE NEGATIVE CONTROL, BUILT BY HAND rather than sampled.
   *
   * A hole is placed where the wrap is, because that is the gap a naive
   * scan misses: the lap is a loop and the start line is an arbitrary cut
   * in it, so the run from the last station back to the first is a gap
   * like any other. Thirty-one placements over the first 60W of a 100W
   * lap leave exactly 40W empty across it — fifteen past D-4's limit.
   *
   * The detector is checked before the repair is, and against
   * `coverage()`, which is the independent one the gate above uses. If
   * the two disagreed, every zero the repair reports would be worthless.
   */
  it("sees a hole it was built to have, and closes it", () => {
    const lapW = 100;
    const built: TestPlacement[] = [];
    for (let s = 0; s <= 60; s += 2) built.push({ station: s, id: s, t: 0.5, h: 1 });

    const before = coverage(
      built.map((p) => p.station),
      lapW,
    );
    expect(before.longestGapW).toBeCloseTo(40, 6);
    expect(before.longestGapW).toBeGreaterThan(COVERAGE.maxGapW);

    const r = repairPlacementCoverage(built, lapW);
    // The repair's own reading of "before" is the same number the
    // independent detector gave.
    expect(r.worstGapBeforeW).toBeCloseTo(before.longestGapW, 6);
    expect(r.moves).toBeGreaterThan(0);
    expect(r.worstGapAfterW).toBeLessThanOrEqual(COVERAGE.maxGapW);
    // And the independent detector agrees about the repaired lap too.
    const after = coverage(
      r.placements.map((p) => p.station),
      lapW,
    );
    expect(after.longestGapW).toBeLessThanOrEqual(COVERAGE.maxGapW);
  });

  /**
   * THE OTHER HALF OF THE CONTROL. A repair that fires on a compliant lap
   * is as wrong as one that never fires, and it would pass every bound
   * check above — the output would simply be a lap that was already fine,
   * rearranged.
   */
  it("does nothing to a lap that already satisfies D-4", () => {
    const lapW = 100;
    const even: TestPlacement[] = [];
    for (let s = 0; s < lapW; s += 5) even.push({ station: s, id: s, t: 0, h: 0 });
    const r = repairPlacementCoverage(even, lapW);
    expect(r.worstGapBeforeW).toBeCloseTo(5, 6);
    expect(r.moves).toBe(0);
    expect(r.log).toEqual([]);
    expect(r.worstGapAfterW).toBeCloseTo(5, 6);
    expect(r.placements.map((p) => p.station)).toEqual(even.map((p) => p.station));
  });

  /**
   * D-1'S BUDGET SURVIVES STAGE 6.
   *
   * This is the claim that decides MOVE versus ADD, and it is checked on
   * every seed under every cull shape rather than on the one that
   * happened to fire: a repair that added a placement when it could not
   * find a donor would pass the coverage gate and break the density band,
   * and the shape of the cull is exactly what decides whether it reaches
   * that branch.
   */
  it("conserves the count, exactly, on every seed", () => {
    for (const seed of SEEDS) {
      for (const cull of CULLS) {
        const input = cull.apply(dressStations(LAP_W, seed), seed);
        const r = repairPlacementCoverage(input, LAP_W);
        expect(r.placements.length, `seed ${seed}, ${cull.name}`).toBe(input.length);
      }
    }
  });

  /**
   * AND THE MOVED PLACEMENT IS THE SAME PLACEMENT.
   *
   * The count check above cannot see the difference between moving a
   * placement and deleting one to draw a fresh one into the gap — both
   * hand back the same number of placements. What separates them is
   * whether the multiset of everything that is not a station came through
   * unchanged, which is why the fingerprint carries `t` and `h` as well
   * as the asset: a re-draw that happened to pick the same asset would
   * still have re-rolled the lateral.
   */
  it("keeps every asset, lateral and height it was given", () => {
    for (const seed of SEEDS) {
      for (const cull of CULLS) {
        const input = cull.apply(dressStations(LAP_W, seed), seed);
        const r = repairPlacementCoverage(input, LAP_W);
        expect(fingerprint(r.placements), `seed ${seed}, ${cull.name}`).toEqual(fingerprint(input));
      }
    }

    // THE FINGERPRINT, PROVED ABLE TO FAIL. One placement re-drawn — the
    // exact thing this test exists to forbid — and the multiset differs.
    const input = dressStations(LAP_W, 1);
    const redrawn = input.map((p, i) => (i === 5 ? { ...p, id: p.id + 1 } : p));
    expect(fingerprint(redrawn)).not.toEqual(fingerprint(input));
  });

  /**
   * MINIMALITY, by the criterion every conserved-count repair in this
   * demo is held to.
   *
   * Nothing can be said about where a placement ENDS UP, because the
   * repair conserves the count: any statement about the output is a
   * statement about a lap with the same number of placements as the
   * input, which is what the input already was. What CAN be said is
   * whether any single move was surplus — put the donor back where it
   * came from and ask whether D-4 still holds. Idempotence would not do:
   * a pass that closed one gap six times over would halt afterwards and
   * pass it.
   */
  it("makes no move it did not need", () => {
    for (const seed of SEEDS) {
      for (const cull of CULLS) {
        const input = cull.apply(dressStations(LAP_W, seed), seed);
        const r = repairPlacementCoverage(input, LAP_W);
        const { minimal, removable } = placementCoverageIsMinimal(r, LAP_W);
        expect(
          minimal,
          `seed ${seed}, ${cull.name}: ${removable} of ${r.moves} moves unnecessary`,
        ).toBe(true);
      }
    }
  });

  /**
   * AND THE MINIMALITY CHECK CAN SAY NO — on a repair built to be
   * surplus.
   *
   * A compliant lap, one placement moved anyway, and the move logged. The
   * checker has to see that putting it back leaves D-4 satisfied, or its
   * green above means only that it never says anything.
   */
  it("sees a move that did not need making", () => {
    const lapW = 100;
    const even: TestPlacement[] = [];
    for (let s = 0; s < lapW; s += 5) even.push({ station: s, id: s, t: 0, h: 0 });
    const from = 50;
    const to = 52.5;
    const surplus: CoverageRepair<TestPlacement> = {
      placements: even
        .map((p) => (p.station === from ? { ...p, station: to } : p))
        .sort((a, b) => a.station - b.station),
      moves: 1,
      worstGapBeforeW: 5,
      worstGapAfterW: 7.5,
      log: [{ from, to }],
    };
    expect(placementCoverageIsMinimal(surplus, lapW)).toEqual({ minimal: false, removable: 1 });
  });

  /**
   * PROTECT, ON A LAP WHERE THE PROTECTED PLACEMENT WOULD HAVE BEEN THE
   * DONOR.
   *
   * The corner language pins its markers and rulers to a measured
   * distance before a corner entry, so a coverage pass that moved one
   * would satisfy D-4 by breaking L-2 or L-3 — a repair that fixes its
   * own rule by breaking another's is worse than the hole it closed.
   *
   * The lap here is built so the protection has to BIND rather than
   * merely be declared: a tight clump at station 10 whose members are a
   * tenth of a W apart is by far the most redundant thing on it, and the
   * unprotected run is asserted to take its donor from there. A protect
   * test on a lap where nothing tempting was protected passes for the
   * wrong reason, and would keep passing if `protect` were ignored
   * entirely.
   */
  it("never takes a protected placement, on a lap where it was tempted", () => {
    const lapW = 100;
    // A clump nobody would miss one of, pinned.
    const clump = [10, 10.1, 10.5, 11];
    const built: TestPlacement[] = clump.map((station, i) => ({
      station,
      id: i,
      t: 0,
      h: 0,
      pinned: true,
    }));
    // A regular run out to 70, then 40W of nothing across the start line.
    for (let s = 20; s <= 70; s += 5) built.push({ station: s, id: 100 + s, t: 0, h: 0 });
    expect(repairPlacementCoverage(built, lapW).worstGapBeforeW).toBeCloseTo(40, 6);

    // UNPROTECTED: the donor comes out of the clump. This is the half
    // that proves the protection below had something to refuse.
    const loose = repairPlacementCoverage(built, lapW);
    expect(loose.moves).toBeGreaterThan(0);
    expect(clump).toContain(loose.log[0].from);

    // PROTECTED: same lap, same hole, and the clump is untouched.
    const pinnedStations = new Set(clump);
    const tight = repairPlacementCoverage(built, lapW, { protect: (p) => p.pinned === true });
    expect(tight.moves).toBeGreaterThan(0);
    for (const m of tight.log) expect(pinnedStations.has(m.from)).toBe(false);
    // Not just absent from the log: still where they were put.
    const stillThere = tight.placements.filter((p) => p.pinned).map((p) => p.station);
    expect(stillThere.sort((a, b) => a - b)).toEqual(clump);
    // And the hole is closed anyway, from the run instead.
    expect(tight.worstGapAfterW).toBeLessThanOrEqual(COVERAGE.maxGapW);
  });

  /**
   * THE FIRE COUNT — the one figure that separates a working repair from
   * an unreachable one.
   *
   * Zero fires and a working repair leave identical green tests, so
   * everything above is compatible with a stage that never runs. This
   * prints what it did across the seeds and across cull shapes, and the
   * uniform sweep is the part worth reading: it says how much of a lap
   * has to disappear before a hole opens, which is the only honest answer
   * to "does stage 6 have work to do on a real lap".
   *
   * The `no cull` row is expected to be zero and is printed anyway,
   * because that zero is the FINDING: stage 1 leaves the lap compliant,
   * so anything stage 6 does is work the cull created.
   */
  it("reports how often it fires, by how much of the lap the cull removed", () => {
    const rows: string[] = [];
    let totalFires = 0;

    for (const rate of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
      let over = 0;
      let worstBefore = 0;
      let worstAfter = 0;
      let moves = 0;
      let n = 0;
      for (const seed of SEEDS) {
        const input = dropUniform(dressStations(LAP_W, seed), rate, seed);
        const r = repairPlacementCoverage(input, LAP_W);
        if (r.worstGapBeforeW > COVERAGE.maxGapW) over++;
        worstBefore = Math.max(worstBefore, r.worstGapBeforeW);
        worstAfter = Math.max(worstAfter, r.worstGapAfterW);
        moves += r.moves;
        n += input.length;
      }
      totalFires += moves;
      rows.push(
        `  uniform ${(100 * rate).toFixed(0).padStart(3)}%  ` +
          `${(n / SEEDS.length).toFixed(0).padStart(4)} placed  ` +
          `${over}/${SEEDS.length} laps over  ` +
          `worst gap ${worstBefore.toFixed(1).padStart(5)} -> ${worstAfter.toFixed(1).padStart(5)} W  ` +
          `${moves} moves`,
      );
    }

    // The corner-shaped stand-in: one contiguous stretch of lap emptied,
    // which is what the real cull does at the inside of a corner.
    for (const widthW of [10, 20, 26]) {
      let over = 0;
      let worstBefore = 0;
      let worstAfter = 0;
      let moves = 0;
      for (const seed of SEEDS) {
        const input = dropWindow(dressStations(LAP_W, seed), widthW, seed);
        const r = repairPlacementCoverage(input, LAP_W);
        if (r.worstGapBeforeW > COVERAGE.maxGapW) over++;
        worstBefore = Math.max(worstBefore, r.worstGapBeforeW);
        worstAfter = Math.max(worstAfter, r.worstGapAfterW);
        moves += r.moves;
      }
      totalFires += moves;
      rows.push(
        `  window ${widthW.toString().padStart(4)}W  ` +
          `             ${over}/${SEEDS.length} laps over  ` +
          `worst gap ${worstBefore.toFixed(1).padStart(5)} -> ${worstAfter.toFixed(1).padStart(5)} W  ` +
          `${moves} moves`,
      );
    }

    console.log(
      [
        `D-4 at the placement level, ${LAP_W} W lap, ${SEEDS.length} seeds ` +
          `(limit ${COVERAGE.maxGapW} W)`,
        ...rows,
        `  total moves across every row: ${totalFires}`,
      ].join("\n"),
    );

    // THE CLAIM THIS PINS: the repair is reachable. A cull that empties a
    // stretch of lap opens a hole stage 1 cannot have seen, and this
    // stage closes it.
    expect(totalFires).toBeGreaterThan(0);
  });

  /**
   * SAME INPUT, SAME OUTPUT. The repair is part of a deterministic
   * pipeline, so it may not depend on iteration order or on anything it
   * did not receive.
   */
  it("is deterministic", () => {
    const input = dropWindow(dressStations(LAP_W, 3), 26, 3);
    const a = repairPlacementCoverage(input, LAP_W);
    const b = repairPlacementCoverage(input, LAP_W);
    expect(a.placements).toEqual(b.placements);
    expect(a.log).toEqual(b.log);
  });

  /**
   * A LAP WITH NOTHING TO TAKE FROM IS REPORTED, NOT THROWN.
   *
   * Two placements have no donor that is not one side of the gap, and a
   * lap whose every candidate is pinned has none either. Both are real
   * states a pipeline can reach — a cull can drop a lap down to almost
   * nothing — and the contract is that `worstGapAfterW` says the rule
   * still fails rather than the pass pretending it succeeded.
   */
  it("reports an un-closable gap instead of spinning on it", () => {
    const lapW = 100;
    const two: TestPlacement[] = [
      { station: 0, id: 0, t: 0, h: 0 },
      { station: 50, id: 1, t: 0, h: 0 },
    ];
    const r = repairPlacementCoverage(two, lapW);
    expect(r.moves).toBe(0);
    expect(r.worstGapAfterW).toBeCloseTo(50, 6);
    expect(r.worstGapAfterW).toBeGreaterThan(COVERAGE.maxGapW);

    // And with everything pinned: a hole it can see and may not fix.
    const built: TestPlacement[] = [];
    for (let s = 0; s <= 60; s += 2) built.push({ station: s, id: s, t: 0, h: 0, pinned: true });
    const stuck = repairPlacementCoverage(built, lapW, { protect: (p) => p.pinned === true });
    expect(stuck.moves).toBe(0);
    expect(stuck.worstGapAfterW).toBeCloseTo(40, 6);
    expect(stuck.placements.length).toBe(built.length);
  });
});
