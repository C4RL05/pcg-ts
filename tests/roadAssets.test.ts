/**
 * Placing from each asset's own measurements, and what band mix that
 * produces.
 *
 * THE QUESTION THIS FILE EXISTS TO ANSWER. Z-3 states a band mix and the
 * assets state their own laterals, and the two are different sources for
 * the same quantity. If drawing from `where` lands inside Z-3, they agree
 * and there is nothing to decide. If it does not, one of them is wrong
 * about the circuit they were both measured from — and that is a question
 * for the measurement rather than a licence to repair the output until it
 * matches.
 *
 * Skips without the kit, which lives outside both repositories.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Band,
  type CurvatureBucket,
  type PlaceableAsset,
  Z3,
  bandOfPlacement,
  bucketOf,
  drawQuantile,
  mixInsideRule,
  placeAsset,
  repairBandMix,
  repairIsMinimal,
  weightAt,
} from "../demos/road/assets.js";
import { DEFAULT_KIT, KITS } from "../demos/road/kitSource.js";
import { inCorridor, resolveCorridor } from "../demos/road/zones.js";

/**
 * WHICH CIRCUIT, and why it is not the first one.
 *
 * The first exemplar was chosen for reuse and coherence and never checked
 * against the population on anything else. It turned out to be at or past
 * the edge on six figures — the worst band mix of twenty-two, and a
 * curvature response of 2.97 straight-to-tight against a population 1.33.
 * Since that response is exactly the mechanism this module relies on, a
 * generator learning from it would have been faithfully reproducing an
 * outlier.
 *
 * `vegetation` is second-best of the twenty-two on band mix and has all
 * four affinity buckets inside the per-circuit band. `street` is kept
 * beside it because the comparison is the evidence.
 */
const DIR = "<kit-dir>/";
const KIT = DIR + KITS[DEFAULT_KIT];
const OTHER = DIR + KITS.street;

describe("drawing from three quantiles", () => {
  const q = { p10: 1, median: 3, p90: 9 };

  it("reproduces the quantiles it was given", () => {
    expect(drawQuantile(q, 0.1)).toBeCloseTo(1, 9);
    expect(drawQuantile(q, 0.5)).toBeCloseTo(3, 9);
    expect(drawQuantile(q, 0.9)).toBeCloseTo(9, 9);
  });

  it("is monotone, so the inverse CDF is a CDF", () => {
    let prev = -Infinity;
    for (let u = 0; u <= 1; u += 0.005) {
      const v = drawQuantile(q, u);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("keeps a tail rather than clamping a tenth onto two values", () => {
    // Clamping would put 10% of every asset's instances at exactly p10
    // and 10% at exactly p90, which is a spike the source cannot have.
    expect(drawQuantile(q, 0.0)).toBeLessThan(1);
    expect(drawQuantile(q, 1.0)).toBeGreaterThan(9);
  });

  it("recovers the median from a uniform sweep", () => {
    const vals: number[] = [];
    for (let i = 0; i < 10_000; i++) vals.push(drawQuantile(q, (i + 0.5) / 10_000));
    vals.sort((a, b) => a - b);
    expect(vals[5000]).toBeCloseTo(3, 1);
  });
});

describe.skipIf(!existsSync(KIT))("placing from the kit's own `where`", () => {
  const kit = JSON.parse(readFileSync(KIT, "utf8")) as {
    assets: PlaceableAsset[];
    placements: { lateral: number; height: number; size: { tall: number } }[];
    track: { curvatureShare: Record<CurvatureBucket, number> };
  };
  const assets = kit.assets.filter((a) => a.where);

  /** One lap's worth of placements at a given curvature mix. */
  function lap(seed: number, n = 330): ReturnType<typeof placeAsset>[] {
    // Buckets drawn in the proportions the demo's own spline carries, so
    // the affinities are exercised across all four rather than at one.
    const mix: [CurvatureBucket, number][] = [
      ["straight", 0.51],
      ["easy", 0.157],
      ["medium", 0.256],
      ["tight", 0.077],
    ];
    const out: ReturnType<typeof placeAsset>[] = [];
    for (let i = 0; i < n; i++) {
      let u = ((i * 2654435761) % 1000) / 1000;
      let bucket: CurvatureBucket = "straight";
      for (const [b, w] of mix) {
        if (u < w) {
          bucket = b;
          break;
        }
        u -= w;
      }
      out.push(placeAsset(assets, bucket, seed, i));
    }
    return out;
  }

  it("uses the whole vocabulary rather than a few frequent assets", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      for (const p of lap(seed)) if (p) seen.add(p.asset.id);
    }
    console.log(`distinct assets over 8 laps: ${seen.size} of ${assets.length}`);
    // Most of any circuit's assets appear once or twice, so a weighting
    // that dropped one-offs would collapse the vocabulary — and L-4's
    // landmark-per-tenth comes from exactly those.
    expect(seen.size).toBeGreaterThan(assets.length * 0.5);
  });

  /**
   * THE MEASUREMENT THIS FILE IS FOR — and the comparison it has to make
   * carefully.
   *
   * A GENERATED lap is scored against Z-3's pooled rule. A REAL circuit is
   * compared against the per-circuit spread, which is roughly twice as
   * wide: the rule is pooled over all of the source era's objects, and any one
   * original sits outside it on some band as a matter of course. Scoring
   * an original against the rule is how a good exemplar gets mistaken for
   * a bad generator, which is very nearly what happened here.
   *
   * BANDED ON THE CENTRE, because every figure upstream publishes is. The
   * base datum is the physically meaningful one and gives a different
   * answer — it is a different statistic, not a better one, and quoting it
   * against a centre-banded rule compares two things.
   */
  it("reports the band mix from `where`, against the rule and the spread", () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const p of lap(seed)) {
        if (!p) continue;
        counts[bandOfPlacement(p.t, p.h, p.asset.size.tall)] =
          (counts[bandOfPlacement(p.t, p.h, p.asset.size.tall)] ?? 0) + 1;
        n++;
      }
    }
    const refOf = (path: string): { c: Record<string, number>; n: number } => {
      const k = JSON.parse(readFileSync(path, "utf8")) as typeof kit;
      const c: Record<string, number> = {};
      for (const p of k.placements) {
        const b = bandOfPlacement(p.lateral, p.height, p.size.tall);
        c[b] = (c[b] ?? 0) + 1;
      }
      return { c, n: k.placements.length };
    };
    const here = refOf(KIT);
    const there = refOf(OTHER);

    const pc = (v: number): string => `${(100 * v).toFixed(0)}%`.padStart(4);
    console.log(
      [
        `band mix, centre datum, ${DEFAULT_KIT}`,
        "  band      mine   this circuit   street    rule       spread",
        ...(Object.keys(Z3) as Band[]).map((b) => {
          const z = Z3[b];
          const mine = (counts[b] ?? 0) / n;
          const inRule = mine >= z.rule[0] && mine <= z.rule[1];
          return (
            `  ${b.padEnd(8)} ${pc(mine)}${inRule ? " " : "*"}     ${pc((here.c[b] ?? 0) / here.n)}` +
            `         ${pc((there.c[b] ?? 0) / there.n)}    ` +
            `${pc(z.rule[0])}-${pc(z.rule[1])}  ${pc(z.spread[0])}-${pc(z.spread[1])}`
          );
        }),
        "  (* = my lap outside Z-3's pooled rule)",
      ].join("\n"),
    );
    expect(n).toBeGreaterThan(1000);
  });

  /**
   * THE REPAIR, AND THE THING IT MUST NOT DO.
   *
   * Z-3 is not a measurement: the observed range across twenty-two
   * circuits is `over` 4-40% and `near` 0-56%, so a gate at the full
   * range is vacuous and a gate at p10-p90 rejects a fifth of real
   * circuits. The rule is deliberately narrower than the source — the
   * same standing as Z-1 — so a generated lap IS repaired into it.
   *
   * But to the NEAREST EDGE. Driving every lap to the centre would make
   * generated laps more uniform than the originals, which vary by a
   * factor of five on `over`. That is the density-envelope error again:
   * imposing at the lap level an aggregate the population reaches through
   * variation between laps. So the test checks both halves — inside the
   * rule, and still spread.
   */
  it("repairs the mix to the nearest edge, and reports the moves", () => {
    const rows: string[] = [];
    const perBand: Record<string, number[]> = {};
    let totalMoves = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const raw = lap(seed);
      const fixed = repairBandMix(raw, assets, seed);
      totalMoves += fixed.moves;
      const n = fixed.placements.filter(Boolean).length;
      const c: Record<string, number> = {};
      for (const p of fixed.placements) {
        if (!p) continue;
        const b = bandOfPlacement(p.t, p.h, p.asset.size.tall);
        c[b] = (c[b] ?? 0) + 1;
      }
      for (const b of Object.keys(Z3) as Band[]) {
        const share = (c[b] ?? 0) / n;
        (perBand[b] ??= []).push(share);
        const [lo, hi] = Z3[b].rule;
        expect(share, `seed ${seed} ${b}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(share, `seed ${seed} ${b}`).toBeLessThanOrEqual(hi + 1e-9);
      }
      if (seed === 1) {
        rows.push(
          `  seed 1 moved ${fixed.moves}; was outside: ` +
            fixed.wasOutside
              .map((w) => `${w.band} ${(100 * w.share).toFixed(0)}%->${(100 * w.edge).toFixed(0)}%`)
              .join(", "),
        );
      }
    }
    console.log(
      [
        `Z-3 repair over 8 laps: ${totalMoves} placements re-drawn`,
        ...rows,
        ...(Object.keys(Z3) as Band[]).map((b) => {
          const v = perBand[b];
          const [lo, hi] = Z3[b].rule;
          return (
            `  ${b.padEnd(8)} ${(100 * Math.min(...v)).toFixed(0)}-${(100 * Math.max(...v)).toFixed(0)}%` +
            `   rule ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%`
          );
        }),
      ].join("\n"),
    );
    expect(totalMoves).toBeGreaterThan(0);
  });

  /**
   * WHERE "PRESERVE THE SPREAD INSIDE IT" STOPS BEING ACHIEVABLE.
   *
   * Repairing to the nearest edge preserves lap-to-lap variation only
   * when laps are outside by DIFFERING amounts. When the raw mix is
   * SYSTEMATICALLY outside on a band — every lap over its ceiling, or
   * every lap under its floor — edge-repair pins all of them to the same
   * value and the spread on that band goes to zero. That is not
   * over-correction; it is the minimum correction, and the flattening
   * follows from the violation being systematic rather than from the
   * repair being greedy.
   *
   * Measured here rather than asserted away, because the distinction
   * matters: a band that keeps its spread is evidence the repair is
   * behaving, and a band that loses it is evidence about the KIT.
   */
  it("stops as soon as every band is inside, and reports what the spread cost", () => {
    const perBand: Record<
      string,
      { before: number[]; after: number[]; repaired: number; outLaps: number[] }
    > = {};
    for (const b of Object.keys(Z3) as Band[])
      perBand[b] = { before: [], after: [], repaired: 0, outLaps: [] };

    for (let seed = 1; seed <= 8; seed++) {
      const raw = lap(seed);
      const fixed = repairBandMix(raw, assets, seed);
      const shareOf = (set: readonly (ReturnType<typeof placeAsset>)[]): Record<string, number> => {
        const n = set.filter(Boolean).length;
        const c: Record<string, number> = {};
        for (const p of set) {
          if (!p) continue;
          const b = bandOfPlacement(p.t, p.h, p.asset.size.tall);
          c[b] = (c[b] ?? 0) + 1;
        }
        const out: Record<string, number> = {};
        for (const b of Object.keys(Z3) as Band[]) out[b] = (c[b] ?? 0) / n;
        return out;
      };
      const a = shareOf(raw);
      const z = shareOf(fixed.placements);
      for (const b of Object.keys(Z3) as Band[]) {
        perBand[b].before.push(a[b]);
        perBand[b].after.push(z[b]);
        // Recorded PER LAP, not as a band-level flag: a band can be out of
        // range on one lap and a donor or recipient on the next, and the
        // edge criterion only means anything on the laps where it was
        // actually out. Conflating the two is how this assertion was
        // wrong three times running.
        if (fixed.wasOutside.some((w) => w.band === b)) {
          perBand[b].repaired++;
          perBand[b].outLaps.push(z[b]);
        }
      }
    }

    const span = (v: number[]): number => Math.max(...v) - Math.min(...v);
    console.log(
      [
        "lap-to-lap spread, before -> after repair (8 laps)",
        ...(Object.keys(Z3) as Band[]).map((b) => {
          const d = perBand[b];
          return (
            `  ${b.padEnd(8)} ${(100 * span(d.before)).toFixed(1)} -> ${(100 * span(d.after)).toFixed(1)} points` +
            `   repaired on ${d.repaired}/8 laps`
          );
        }),
      ].join("\n"),
    );

    // WHAT "TO THE EDGE, AND STOP" ACTUALLY REDUCES TO, after four
    // attempts at stating it and three failures — each on a correct
    // behaviour.
    //
    //   "an unrepaired band is untouched"      -> false: it can be a donor
    //   "a repaired band lands near its edge"  -> false: it can also be a
    //                                             donor, funding another
    //                                             band's lift
    //   "...on the laps it was out of range"   -> still false: a band
    //                                             lifted to its floor then
    //                                             KEEPS RECEIVING, because
    //                                             a trim's surplus has to
    //                                             go somewhere
    //
    // The count is conserved. Every move takes from one band and gives to
    // another, so no band's final share is attributable to its own repair,
    // and no statement about a resting place can be right.
    //
    // What survives is about the PROCESS rather than the result: the
    // repair stops as soon as every band is inside. That is exactly what
    // "and stop" means under conservation, and it is what a walk to the
    // centre would violate — a centre-seeking repair would keep moving
    // after the bounds were met.
    for (let seed = 1; seed <= 8; seed++) {
      const once = repairBandMix(lap(seed), assets, seed);
      const twice = repairBandMix(once.placements, assets, seed);
      expect(twice.moves, `seed ${seed} is not yet settled`).toBe(0);
    }

    // AND MINIMALITY, which idempotence does not give. A repair that
    // jumped every out-of-range band to the CENTRE in one pass and then
    // halted would pass the check above — a second pass makes no moves —
    // and is exactly what "to the nearest edge" forbids. What separates
    // them is whether any single move could be removed with every bound
    // still holding.
    for (let seed = 1; seed <= 8; seed++) {
      const r = repairBandMix(lap(seed), assets, seed);
      const { minimal, removable } = repairIsMinimal(r);
      expect(
        minimal,
        `seed ${seed}: ${removable.length} of ${r.moves} moves were unnecessary`,
      ).toBe(true);
    }

    // And at least one band IS repaired, or the claim is vacuous.
    expect((Object.keys(Z3) as Band[]).filter((b) => perBand[b].repaired > 0).length)
      .toBeGreaterThan(0);
  });

  /**
   * THE MINIMALITY CHECK, PROVED ABLE TO FAIL.
   *
   * An instrument that has never said no has not been shown to work, and
   * this one is the whole gate — so it is run against a repair that
   * deliberately keeps going after the bounds are met. Those extra moves
   * are removable by construction, so a working check must find them.
   */
  it("the minimality check catches a repair that overshoots", () => {
    const seed = 1;
    const honest = repairBandMix(lap(seed), assets, seed);
    expect(repairIsMinimal(honest).minimal).toBe(true);
    expect(mixInsideRule(honest.placements)).toBe(true);

    // Keep going: re-draw a few more placements into a band that is
    // already inside its range. Every one is surplus.
    const over = { ...honest, placements: [...honest.placements], log: [...honest.log] };
    let added = 0;
    for (let i = 0; i < over.placements.length && added < 6; i++) {
      const p = over.placements[i];
      if (!p) continue;
      if (bandOfPlacement(p.t, p.h, p.asset.size.tall) !== "mid") continue;
      const pool = assets.filter((a) => {
        const m = a.where?.lateral.median;
        return m !== undefined && Math.abs(m) >= 1.5 && Math.abs(m) < 2.5;
      });
      const swap = placeAsset(pool, "straight", seed, 9000 + i);
      if (!swap) continue;
      over.log.push({ index: i, before: p });
      over.placements[i] = swap;
      added++;
    }
    expect(added).toBeGreaterThan(0);
    // Still inside the rule — an overshoot does not break the bounds,
    // which is exactly why a bounds check cannot catch it.
    expect(mixInsideRule(over.placements)).toBe(true);
    // But no longer minimal.
    const { minimal, removable } = repairIsMinimal(over);
    expect(minimal, "an overshooting repair should not read as minimal").toBe(false);
    expect(removable.length).toBeGreaterThan(0);
  });

  /**
   * THE CORRIDOR RULE, FIRING FOR REAL AT LAST.
   *
   * Assets whose lateral p10 reaches inside 1W are what produce these, so drawing from
   * `where` produces genuine conflicts where drawing from a band produced
   * none. This reports the count for the same reason every repair here
   * does: a resolution that never runs is indistinguishable from one that
   * works.
   */
  it("resolves real corridor conflicts, and reports how many", () => {
    let conflicts = 0;
    let lifted = 0;
    let stoodOff = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const p of lap(seed)) {
        if (!p) continue;
        const baseH = p.h - p.asset.size.tall / 2;
        if (!inCorridor(p.t, baseH)) continue;
        conflicts++;
        const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
        expect(inCorridor(fixed.t, fixed.baseH)).toBe(false);
        if (fixed.baseH > baseH) lifted++;
        else stoodOff++;
      }
    }
    console.log(
      `corridor conflicts from \`where\`: ${conflicts} over 8 laps (${lifted} lifted, ${stoodOff} stood off)`,
    );
    // The whole reason the resolution was extracted from the band sampler.
    expect(conflicts).toBeGreaterThan(0);
  });

  it("keeps each asset on the side its instances were on", () => {
    // An asset measured entirely on the left stays left. This is where a
    // side lean belongs — not in the corridor sampler, which is even.
    const oneSided = assets.filter(
      (a) => a.where && (a.where.rightOfTravel === 0 || a.where.rightOfTravel === 1),
    );
    expect(oneSided.length).toBeGreaterThan(0);
    for (const a of oneSided.slice(0, 12)) {
      const want = a.where?.rightOfTravel === 1;
      for (let i = 0; i < 40; i++) {
        const p = placeAsset([a], "straight", 5, i);
        if (!p) continue;
        expect(p.t > 0, `${a.name}`).toBe(want);
      }
    }
  });

  /**
   * D-6 WITHOUT DOUBLE-COUNTING IT.
   *
   * The population's own decline in bends must EMERGE from per-asset
   * affinities drawn at a uniform density — not be applied on top. So the
   * check is that the share-weighted mean affinity falls from straight to
   * tight, which is the mechanism, rather than that some density knob was
   * turned, which would be the double-count.
   */
  it("declines into bends on its own, with no density modulation", () => {
    const buckets: CurvatureBucket[] = ["straight", "easy", "medium", "tight"];
    const mean = buckets.map((b) => {
      let num = 0;
      let den = 0;
      for (const a of assets) {
        num += weightAt(a, b);
        den += a.instances;
      }
      return num / den;
    });
    console.log(
      "share-weighted mean affinity: " +
        buckets.map((b, i) => `${b} ${mean[i].toFixed(2)}`).join("  "),
    );
    // Straight above tight, which is the direction all three games show.
    expect(mean[0]).toBeGreaterThan(mean[3]);
  });

  it("puts the curvature bucket cuts where upstream puts them", () => {
    expect(bucketOf(60)).toBe("straight");
    expect(bucketOf(40)).toBe("straight");
    expect(bucketOf(39.9)).toBe("easy");
    expect(bucketOf(15)).toBe("easy");
    expect(bucketOf(14.9)).toBe("medium");
    expect(bucketOf(7)).toBe("medium");
    expect(bucketOf(6.9)).toBe("tight");
  });
});
