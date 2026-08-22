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
  type CurvatureBucket,
  type PlaceableAsset,
  bandOfPlacement,
  bucketOf,
  drawQuantile,
  placeAsset,
  weightAt,
} from "../demos/road/assets.js";
import { inCorridor, resolveCorridor } from "../demos/road/zones.js";

const KIT = "<kit-dir>/street-kit.json";
const RULE = {
  over: [0.1, 0.21],
  verge: [0.04, 0.12],
  near: [0.23, 0.35],
  mid: [0.28, 0.4],
  far: [0.07, 0.19],
  distant: [0, 0.03],
} as const;

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
    // 135 of the 206 appeared exactly once on the source circuit, so a
    // weighting that dropped one-offs would collapse the vocabulary — and
    // L-4's landmark-per-tenth comes from exactly those.
    expect(seen.size).toBeGreaterThan(assets.length * 0.5);
  });

  /**
   * THE MEASUREMENT THIS FILE IS FOR.
   *
   * Reported rather than gated, because the reference circuit's OWN
   * placements do not satisfy Z-3 either — near 10.9% against a rule of
   * 23-35, mid 43.2 against 28-40, far 27.4 against 7-19. Gating my output
   * to a range its own source misses would be repairing the generator to
   * hide a disagreement between two published figures.
   */
  it("reports the band mix that `where` produces, beside the source's own", () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const p of lap(seed)) {
        if (!p) continue;
        const b = bandOfPlacement(p.t, p.h, p.asset.size.tall);
        counts[b] = (counts[b] ?? 0) + 1;
        n++;
      }
    }
    const ref: Record<string, number> = {};
    for (const p of kit.placements) {
      const b = bandOfPlacement(p.lateral, p.height, p.size.tall);
      ref[b] = (ref[b] ?? 0) + 1;
    }
    const rn = kit.placements.length;
    console.log(
      [
        "band mix, banded on the BASE (see bandOfPlacement)",
        ...Object.keys(RULE).map((b) => {
          const mine = (100 * (counts[b] ?? 0)) / n;
          const theirs = (100 * (ref[b] ?? 0)) / rn;
          const [lo, hi] = RULE[b as keyof typeof RULE];
          const mark = (v: number): string => (v >= 100 * lo && v <= 100 * hi ? " " : "*");
          return (
            `  ${b.padEnd(8)} from where ${mine.toFixed(1)}%${mark(mine)}` +
            `   reference ${theirs.toFixed(1)}%${mark(theirs)}` +
            `   rule ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%`
          );
        }),
        "  (* = outside Z-3)",
      ].join("\n"),
    );
    expect(n).toBeGreaterThan(1000);
  });

  /**
   * THE CORRIDOR RULE, FIRING FOR REAL AT LAST.
   *
   * 32 of the 206 assets have a lateral p10 inside 1W, so drawing from
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
