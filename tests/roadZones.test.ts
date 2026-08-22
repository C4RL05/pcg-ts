/**
 * The band mix, and the corridor.
 *
 * BOTH TURNED OUT TO BE THRESHOLDS, which was not the expectation.
 *
 * Z-1's corridor obviously is: nothing may be inside it, ever. Z-3's band
 * mix reads as a distribution — six shares with ranges around them — and
 * sampling at the source's own share puts `mid` at 40.6% on one lap in
 * eight against a stated ceiling of 40. A lap outside the range has
 * broken the rule however faithfully the sampler was aimed, so the mix is
 * sampled for its variation and then REPAIRED into range, exactly as D-4
 * had to be. That is the second rule in this ruleset to wear a
 * distribution's clothes over a threshold, and the distinction is now
 * worth checking for by default.
 *
 * ONE CAUTION CARRIED FROM UPSTREAM: Z-3's figures come from the exemplar
 * circuit rather than from the population, and that circuit has now sat
 * high or outside on straightness, density and curvature-bucket share. A
 * miss here is a question about the reference before it is a question
 * about the placement.
 */
import { describe, expect, it } from "vitest";
import {
  BAND_MIX,
  CORRIDOR,
  type ZoneName,
  bandOf,
  inCorridor,
  lateralFor,
  resolveCorridor,
  zoneFor,
  zonesForLap,
  zonesForLapDetailed,
} from "../demos/road/zones.js";

const N = 330;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** One lap's worth of bands, as the shares Z-3 is stated in. */
function mixFor(seed: number): Record<string, number> {
  const counts: Record<string, number> = {};
  const zones = zonesForLap(N, seed);
  for (let i = 0; i < N; i++) {
    const l = lateralFor(zones[i], seed, i);
    const b = bandOf(l.t, l.baseH);
    counts[b] = (counts[b] ?? 0) + 1;
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(BAND_MIX)) out[k] = (counts[k] ?? 0) / N;
  return out;
}

describe("the band mix", () => {
  it("reports itself against Z-3", () => {
    const rows = Object.keys(BAND_MIX).map((k) => {
      const vals = SEEDS.map((s) => mixFor(s)[k]);
      const b = BAND_MIX[k as keyof typeof BAND_MIX];
      return (
        `  ${k.padEnd(8)} ${(100 * Math.min(...vals)).toFixed(1)}-${(100 * Math.max(...vals)).toFixed(1)}%` +
        `   aim ${(100 * b.aim).toFixed(1)}   rule ${(100 * b.lo).toFixed(0)}-${(100 * b.hi).toFixed(0)}%`
      );
    });
    console.log([`band mix over ${SEEDS.length} laps of ${N} placements`, ...rows].join("\n"));
    expect(rows.length).toBe(6);
  });

  it.each(Object.keys(BAND_MIX))("keeps %s inside its rule range on every seed", (band) => {
    const b = BAND_MIX[band as keyof typeof BAND_MIX];
    for (const seed of SEEDS) {
      const got = mixFor(seed)[band];
      expect(got, `seed ${seed}`).toBeGreaterThanOrEqual(b.lo);
      expect(got, `seed ${seed}`).toBeLessThanOrEqual(b.hi);
    }
  });

  /**
   * THE REPAIR HAS TO SAY HOW OFTEN IT FIRED, for the same reason the
   * coverage repair does: zero fires and a working repair leave identical
   * green tests, and this file already shipped one rule that passed every
   * assertion while being unreachable.
   *
   * It also pins the claim that Z-3 needs repairing at all — if the
   * sampler never went out of range, the repair would be ceremony and the
   * rule would be a distribution after all.
   */
  it("reports how often the mix repair fired, and it is not never", () => {
    let fired = 0;
    const needed: number[] = [];
    for (const seed of SEEDS) {
      const d = zonesForLapDetailed(N, seed);
      fired += d.mixRepairs;
      if (d.mixRepairs > 0) needed.push(seed);
    }
    console.log(
      `Z-3 repair: fired ${fired} times over ${SEEDS.length} laps; ` +
        `laps that needed it: ${needed.length}/${SEEDS.length}`,
    );
    expect(fired).toBeGreaterThan(0);
  });

  /**
   * SAMPLED, NOT QUOTA'D — and this is what tells the two apart.
   *
   * A quota would deal out exactly the aim share every lap and the
   * variation across seeds would be zero. Z-3 is a range because real
   * circuits vary within it, and a generator that hits the centre every
   * time is not reproducing that; it is reproducing the summary of it.
   */
  it("varies between laps rather than hitting the aim every time", () => {
    const spread = Object.keys(BAND_MIX).map((k) => {
      const vals = SEEDS.map((s) => mixFor(s)[k]);
      return Math.max(...vals) - Math.min(...vals);
    });
    expect(Math.max(...spread)).toBeGreaterThan(0.01);
  });
});

describe("the corridor", () => {
  const ZONE_NAMES: ZoneName[] = [
    "verge",
    "near",
    "mid",
    "far",
    "distant",
    "overhead",
    "under",
  ];

  /**
   * THE HARD RULE, over every band and both size classes.
   *
   * Nothing may sit inside |t| = 1W below h = 1.2W. Only the verge band
   * can even reach in, but the test sweeps all of them: a later change to
   * a band's extent should fail here rather than quietly leak.
   */
  it("never puts geometry inside it", () => {
    for (const zone of ZONE_NAMES) {
      for (const [acrossW, tallW] of [
        [0.4, 0.8],
        [3.0, 4.0],
        [0.4, 4.0],
        [3.0, 0.8],
      ]) {
        for (let seed = 1; seed <= 6; seed++) {
          for (let i = 0; i < 400; i++) {
            const l = lateralFor(zone, seed, i, acrossW, tallW);
            expect(
              inCorridor(l.t, l.baseH),
              `${zone} ${acrossW}x${tallW} seed ${seed} i ${i}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  /**
   * BY SIZE, NOT BY OFFSET, which is the part that is easy to get wrong
   * in a way that still passes the rule above.
   *
   * Clamping every lateral to 1W satisfies the corridor and costs the
   * verge band, because the archetypes that reach inside 1W are the same
   * ones that fill 1.0-1.5W. So the two size classes must resolve
   * DIFFERENTLY: small art rises and keeps its lateral, large art keeps
   * its band and stands off.
   */
  /**
   * THE RESOLUTION, EXERCISED DIRECTLY.
   *
   * A lateral drawn from a band never reaches inside the corridor — Z2
   * starts at exactly 1.0W — so testing this only through `lateralFor`
   * would report a green rule that had never run. The measured
   * distribution does reach inside (9.3% of the reference circuit's
   * placements), and that distribution arrives with the assets, so this
   * tests the rule on the inputs it will actually see.
   */
  it.each([
    [0.0, "on the centreline"],
    [0.24, "at the source's median reach"],
    [0.6, "half way out"],
    [-0.9, "just inside, left"],
  ])("resolves a conflict at t=%s (%s)", (t) => {
    const small = resolveCorridor(t as number, 0.4, 0.4, 0.8);
    expect(inCorridor(small.t, small.baseH)).toBe(false);
    // Small art RISES and keeps its lateral.
    expect(small.t).toBe(t);
    expect(small.baseH).toBeGreaterThanOrEqual(CORRIDOR.ceilingW);

    const large = resolveCorridor(t as number, 0.4, 3, 4);
    expect(inCorridor(large.t, large.baseH)).toBe(false);
    // Large art STANDS OFF and keeps its height.
    expect(Math.abs(large.t)).toBeCloseTo(CORRIDOR.halfWidthW, 9);
    expect(large.baseH).toBe(0.4);
  });

  it("leaves a position outside the corridor exactly where it is", () => {
    // Including below the deck: Z8 sits inside the corridor's footprint
    // and is nowhere near a driver, so a floor-less check would push
    // pylons sideways for no reason.
    for (const [t, h] of [
      [1.4, 0.3],
      [0.5, 2.0],
      [0.5, -1.2],
      [3.0, 0.0],
    ]) {
      expect(resolveCorridor(t, h, 0.4, 0.8)).toEqual({ t, baseH: h });
    }
  });

  it("lifts small art and stands large art off", () => {
    let smallLifted = 0;
    let smallInside = 0;
    let largeAtEdge = 0;
    let largeInside = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (let i = 0; i < 600; i++) {
        const small = lateralFor("verge", seed, i, 0.4, 0.8);
        if (Math.abs(small.t) < CORRIDOR.halfWidthW) {
          smallInside++;
          if (small.baseH >= CORRIDOR.ceilingW) smallLifted++;
        }
        const large = lateralFor("verge", seed, i, 3, 4);
        if (Math.abs(large.t) <= CORRIDOR.halfWidthW + 1e-9) {
          largeInside++;
          if (Math.abs(Math.abs(large.t) - CORRIDOR.halfWidthW) < 1e-9) largeAtEdge++;
        }
      }
    }
    // The verge band starts at exactly 1.0W, so a draw lands inside only
    // at the boundary — what matters is that when it does, the two
    // classes take different exits.
    console.log(
      `corridor conflicts: small ${smallInside} (${smallLifted} lifted), large ${largeInside} (${largeAtEdge} at the edge)`,
    );
    // A large piece is never lifted, and a small one is never pushed out:
    // that is the whole distinction, and clamping everything would break
    // the first half while passing the corridor test above.
    for (let i = 0; i < 400; i++) {
      const large = lateralFor("verge", 3, i, 3, 4);
      expect(large.baseH).toBe(0);
    }
  });

  it("puts the overhead band above the ceiling and the under band below zero", () => {
    for (let i = 0; i < 300; i++) {
      expect(lateralFor("overhead", 1, i).baseH).toBeGreaterThan(CORRIDOR.ceilingW);
      expect(lateralFor("under", 1, i).baseH).toBeLessThan(0);
    }
  });

  it("uses both sides of the road", () => {
    let right = 0;
    for (let i = 0; i < 2000; i++) if (lateralFor("mid", 1, i).t > 0) right++;
    // Even by design: an asset's own lean lives in its `rightOfTravel`,
    // not here. The reference circuit reads 191 right against 251 left,
    // which is the asset mix rather than a rule about the corridor.
    expect(right / 2000).toBeGreaterThan(0.4);
    expect(right / 2000).toBeLessThan(0.6);
  });

  it("is a pure function of seed and index", () => {
    // Nothing depends on how many placements came before, so a caller can
    // ask about one station without generating the rest.
    expect(lateralFor("mid", 7, 42)).toEqual(lateralFor("mid", 7, 42));
    expect(zoneFor(7, 42)).toBe(zoneFor(7, 42));
    expect(lateralFor("mid", 7, 42)).not.toEqual(lateralFor("mid", 7, 43));
  });
});
