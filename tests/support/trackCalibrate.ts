/**
 * The half of the technique a cook cannot do: fitting the kit before
 * anything is placed, and correcting it after measuring what landed.
 *
 * WHY THIS IS NOT IN THE GRAPH. Every quantity here is a SHARE OF THE
 * WHOLE — placements per W, the share of placements in each lateral band,
 * the share of in-bend placements on the outside. A pcg-ts field resolves
 * one element from that element alone, and `attributeReduce`'s totals land
 * on the detail domain, which a point-domain field deliberately cannot
 * read. So a cook can produce a distribution but cannot normalise itself
 * against its own totals, and the correction has to happen between cooks.
 *
 * That is the technique's own architecture rather than a workaround: it
 * fits the band mix by iterative proportional fitting BEFORE placing, so
 * the mix is a property of the kit, then measures and corrects across
 * three regenerations and keeps the BEST — not the last, because the
 * corrections are measured on samples small enough to be noisy.
 */
import { ARCHETYPES, type Preset, bandOf } from "./trackKit.js";

/** What the closed loop carries from one iteration to the next. */
export interface Corrections {
  densityScale: number;
  bandAdjust: Record<string, number>;
  outsideShift: number;
}

/** A calibrated kit: what to place, how much of it, and where. */
export interface Plan {
  readonly countByProfile: Record<string, number>;
  readonly weightByArchetype: Record<string, number>;
  readonly outsideShift: number;
  readonly totalCount: number;
}

export function noCorrections(): Corrections {
  return { densityScale: 1, bandAdjust: {}, outsideShift: 0 };
}

/**
 * The share of an archetype's draws landing in each lateral band.
 *
 * Deterministic quadrature rather than a Monte-Carlo: the lateral and
 * height envelopes are uniform and independent, so a 24x24 grid over the
 * unit square integrates them exactly enough, and it removes a random
 * seed from a calibration that has to reproduce.
 */
function bandFractions(
  lateralW: readonly [number, number],
  heightW: readonly [number, number],
  push: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const N = 24;
  for (let i = 0; i < N; i++) {
    const t = (lateralW[0] + (lateralW[1] - lateralW[0]) * ((i + 0.5) / N)) * push;
    for (let j = 0; j < N; j++) {
      const h = heightW[0] + (heightW[1] - heightW[0]) * ((j + 0.5) / N);
      const b = bandOf(t, h);
      out[b] = (out[b] ?? 0) + 1 / (N * N);
    }
  }
  return out;
}

/**
 * Fit the kit to a preset.
 *
 * (a) Band mix by iterative proportional fitting. Each archetype's rate is
 * multiplied by the square root of its weighted target/current ratio; the
 * square root damps the step, which is what makes it converge instead of
 * oscillating between two overshoots.
 *
 * (b) Density last, because it is a pure scale and must not be undone by
 * the band fitting above it.
 */
export function calibrate(preset: Preset, lapW: number, c: Corrections): Plan {
  const rate: Record<string, number> = {};
  for (const a of ARCHETYPES) {
    rate[a.id] = a.rate * (preset.kitBias[a.id] ?? 1) * (c.bandAdjust[a.id] ?? 1);
  }
  const frac: Record<string, Record<string, number>> = {};
  for (const a of ARCHETYPES) {
    frac[a.id] = bandFractions(a.lateralW, a.heightW, preset.lateralPush[a.id] ?? 1);
  }
  const bands = Object.keys(preset.bands);

  for (let iter = 0; iter < 24; iter++) {
    const total = ARCHETYPES.reduce((s, a) => s + rate[a.id], 0);
    if (total <= 0) break;
    const current: Record<string, number> = {};
    for (const b of bands) current[b] = 0;
    for (const a of ARCHETYPES) {
      for (const [b, f] of Object.entries(frac[a.id])) {
        current[b] = (current[b] ?? 0) + (rate[a.id] / total) * f;
      }
    }
    const ratio: Record<string, number> = {};
    for (const b of bands) {
      // A band nothing reaches cannot be fitted to; leaving its ratio at 1
      // keeps the step finite instead of sending every rate to infinity.
      ratio[b] = current[b] > 1e-9 ? preset.bands[b] / current[b] : 1;
    }
    for (const a of ARCHETYPES) {
      let w = 0;
      for (const [b, f] of Object.entries(frac[a.id])) w += f * (ratio[b] ?? 1);
      rate[a.id] *= Math.sqrt(Math.max(w, 1e-6));
    }
  }

  // (b) Scale to the target placements per W.
  const sumRate = ARCHETYPES.reduce((s, a) => s + rate[a.id], 0);
  const targetTotal = preset.density * c.densityScale * lapW;
  const scale = sumRate > 0 ? targetTotal / sumRate : 0;
  for (const a of ARCHETYPES) rate[a.id] *= scale;

  const countByProfile: Record<string, number> = {};
  for (const a of ARCHETYPES) {
    countByProfile[a.profile] = (countByProfile[a.profile] ?? 0) + rate[a.id];
  }
  // The clustering pass multiplies what the density pass anchors, so the
  // anchor count has to be divided by the mean cluster size or the lap
  // comes out `clusterMean` times too busy.
  const meanCluster =
    ARCHETYPES.reduce((s, a) => s + rate[a.id] * Math.max(1, a.cluster * (preset.clusterMean / 1.6)), 0) /
    Math.max(1e-9, ARCHETYPES.reduce((s, a) => s + rate[a.id], 0));
  for (const k of Object.keys(countByProfile)) {
    countByProfile[k] = Math.max(1, Math.round(countByProfile[k] / meanCluster));
  }

  return {
    countByProfile,
    weightByArchetype: rate,
    outsideShift: c.outsideShift,
    totalCount: targetTotal,
  };
}

/** One placement, as the metrics see it. */
export interface Placement {
  readonly archetype: string;
  readonly stationW: number;
  readonly lateralW: number;
  readonly heightW: number;
  readonly footprintW: number;
  readonly radiusW: number;
  readonly kSigned: number;
  readonly zone: number;
  readonly cornerK: number;
}

/** One scored metric. */
export interface Metric {
  readonly id: number;
  readonly name: string;
  readonly value: number;
  readonly target: string;
  readonly pass: boolean;
}

/** Everything a scoring run produces. */
export interface Report {
  readonly metrics: readonly Metric[];
  readonly passed: number;
  readonly failed: number;
  readonly perW: number;
  readonly bandShare: Record<string, number>;
  readonly outsideShare: number;
  readonly densityCv: number;
}

/**
 * Score a lap on the metrics this implementation is answerable for.
 *
 * Six of the technique's seventeen are NOT here and are not silently
 * dropped: 2 (polygon budget) and 3 (sprite share) need the kit-scaling
 * pass, 11 and 12 need per-archetype art VARIANTS which this kit does not
 * model, and 17 needs the landmark pass. Metric 9 IS scored, and it is
 * the one that measures a pass this implementation leaves out — see the
 * test, which asserts what it actually achieves rather than what the
 * balance pass would.
 */
export function score(
  placements: readonly Placement[],
  preset: Preset,
  lapW: number,
  cornerEntries: number,
  markedCorners: number,
  blockingCount: number,
): Report {
  const n = placements.length;
  const perW = n / lapW;
  const metrics: Metric[] = [];
  const add = (id: number, name: string, value: number, pass: boolean, target: string) =>
    metrics.push({ id, name, value, target, pass });

  add(1, "placements per W", perW, perW >= preset.densityAccept[0] && perW <= preset.densityAccept[1],
    `${preset.densityAccept[0]}-${preset.densityAccept[1]}`);

  // 4. Band mix. Judged against target +- max(quarter of target, 3 points)
  // plus a sampling allowance, because six constraints on one sample of a
  // few hundred placements is a tight ask and the source data scatters
  // widely around its own mean.
  const bandShare: Record<string, number> = {};
  for (const b of Object.keys(preset.bands)) bandShare[b] = 0;
  for (const p of placements) bandShare[bandOf(p.lateralW, p.heightW)] += 1 / Math.max(1, n);
  let bandsOk = 0;
  const bandNames = Object.keys(preset.bands);
  for (const b of bandNames) {
    const target = preset.bands[b];
    const se = Math.sqrt(Math.max(target * (1 - target), 1e-6) / Math.max(1, n));
    const tol = Math.max(target * 0.25, 0.03) + 1.64 * se;
    if (Math.abs(bandShare[b] - target) <= tol) bandsOk++;
  }
  add(4, "bands within target", bandsOk, bandsOk === bandNames.length, `${bandNames.length} of ${bandNames.length}`);

  // 5 and 6. Coverage: how much of the lap is within 2W of something, and
  // the longest stretch of it that is not.
  const stations = placements.map((p) => ((p.stationW % lapW) + lapW) % lapW).sort((a, b) => a - b);
  const STEP = 0.25;
  let covered = 0;
  let samples = 0;
  let gap = 0;
  let longest = 0;
  for (let s = 0; s < lapW; s += STEP) {
    samples++;
    const near = nearestCircular(stations, s, lapW) <= 2;
    if (near) {
      covered++;
      gap = 0;
    } else {
      gap += STEP;
      longest = Math.max(longest, gap);
    }
  }
  const coverage = samples > 0 ? covered / samples : 0;
  add(5, "lap within 2W of a placement", coverage, coverage >= preset.coverageFloor, `>= ${preset.coverageFloor}`);
  add(6, "longest empty stretch (W)", longest, longest <= preset.maxGapW, `<= ${preset.maxGapW}`);

  // 7. How much the density varies along the lap.
  const TENTHS = 10;
  const buckets = new Array<number>(TENTHS).fill(0);
  for (const p of placements) {
    const idx = Math.min(TENTHS - 1, Math.floor((((p.stationW % lapW) + lapW) % lapW) / (lapW / TENTHS)));
    buckets[idx]++;
  }
  const mean = buckets.reduce((a, b) => a + b, 0) / TENTHS;
  const cv =
    mean > 0
      ? Math.sqrt(buckets.reduce((a, b) => a + (b - mean) ** 2, 0) / TENTHS) / mean
      : 0;
  add(7, "density CV per tenth of lap", cv, cv >= 0.12 && cv <= 0.75, "0.12-0.75");

  // 8. Outside-of-corner share, over the placements that sit IN a bend.
  // Overhead and under-deck work is excluded: something on the centreline
  // has no side.
  const inBend = placements.filter(
    (p) => Math.abs(p.radiusW) < 12 && Math.abs(p.lateralW) >= 1 && p.zone !== 7 && p.zone !== 8,
  );
  const outside = inBend.filter((p) => Math.sign(p.lateralW) === -Math.sign(p.kSigned)).length;
  const outsideShare = inBend.length > 0 ? outside / inBend.length : 0;
  const bin = 1.64 * Math.sqrt(0.25 / Math.max(1, inBend.length));
  add(8, "outside-of-corner share", outsideShare,
    outsideShare >= preset.outsideAccept[0] - bin && outsideShare <= preset.outsideAccept[1] + bin,
    `${preset.outsideAccept[0]}-${preset.outsideAccept[1]}`);

  // 9. Left/right balance.
  const right = placements.filter((p) => p.lateralW > 0).length;
  const sided = placements.filter((p) => p.lateralW !== 0).length;
  const balance = sided > 0 ? right / sided : 0.5;
  add(9, "left/right balance", balance, balance >= 0.45 && balance <= 0.55, "0.45-0.55");

  // 13. Gap CV per repeating archetype: what this excludes is METRONOMIC
  // placement, which sits below 0.4. Judged over archetypes with enough
  // instances for a gap distribution to mean anything.
  const byKind = new Map<string, number[]>();
  for (const p of placements) {
    if (!byKind.has(p.archetype)) byKind.set(p.archetype, []);
    byKind.get(p.archetype)!.push(((p.stationW % lapW) + lapW) % lapW);
  }
  const cvs: number[] = [];
  for (const [, ss] of byKind) {
    if (ss.length < 8) continue;
    ss.sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ss.length; i++) gaps.push(ss[i] - ss[i - 1]);
    gaps.push(lapW - ss[ss.length - 1] + ss[0]);
    const m = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (m <= 0) continue;
    cvs.push(Math.sqrt(gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length) / m);
  }
  const medianCv = cvs.length > 0 ? cvs.sort((a, b) => a - b)[Math.floor(cvs.length / 2)] : 0;
  add(13, "median gap CV per archetype", medianCv, medianCv >= 0.4, ">= 0.4 (not metronomic)");

  // 14. The corridor is inviolable: nothing anchored over the track at
  // driving height, ever.
  const intruding = placements.filter(
    (p) => Math.abs(p.lateralW) < 1 && p.heightW >= 0 && p.heightW < 1.2,
  ).length;
  add(14, "corridor intrusions", intruding, intruding === 0, "0");

  // 15. Every corner announces itself.
  const marked = cornerEntries > 0 ? markedCorners / cornerEntries : 1;
  add(15, "corners with an entry marker", marked, marked >= 0.999, "100%");

  // 16. Look-ahead clear.
  add(16, "placements blocking the look-ahead", blockingCount, blockingCount === 0, "0");

  return {
    metrics,
    passed: metrics.filter((m) => m.pass).length,
    failed: metrics.filter((m) => !m.pass).length,
    perW,
    bandShare,
    outsideShare,
    densityCv: cv,
  };
}

/** Distance from `s` to the nearest station, around a lap that closes. */
function nearestCircular(sorted: readonly number[], s: number, lap: number): number {
  if (sorted.length === 0) return Infinity;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  const cands = [sorted[lo % sorted.length], sorted[(lo - 1 + sorted.length) % sorted.length]];
  let best = Infinity;
  for (const c of cands) {
    const d = Math.abs(c - s);
    best = Math.min(best, Math.min(d, lap - d));
  }
  return best;
}

/**
 * The closed loop's correction step: measure what landed, and move the
 * knobs that produced it.
 *
 * Every step is damped and clamped. The measurements are noisy — only a
 * few dozen placements sit inside bends on a typical lap — and an
 * undamped correction chases that noise instead of the target.
 */
export function correct(preset: Preset, report: Report, c: Corrections): Corrections {
  const next: Corrections = {
    densityScale: c.densityScale,
    bandAdjust: { ...c.bandAdjust },
    outsideShift: c.outsideShift,
  };
  if (report.perW > 0) {
    next.densityScale = clampNum(
      c.densityScale * ((preset.density * 1.0) / report.perW),
      0.4,
      2.5,
    );
  }
  for (const a of ARCHETYPES) {
    const band = bandOf((a.lateralW[0] + a.lateralW[1]) / 2, (a.heightW[0] + a.heightW[1]) / 2);
    const target = preset.bands[band] ?? 0;
    const achieved = report.bandShare[band] ?? 0;
    if (target > 0 && achieved > 0) {
      next.bandAdjust[a.id] = clampNum(
        (c.bandAdjust[a.id] ?? 1) * Math.pow(target / achieved, 0.8),
        0.15,
        4,
      );
    }
  }
  next.outsideShift = clampNum(
    c.outsideShift + (preset.outsideShare - report.outsideShare) * 0.6,
    -0.2,
    0.2,
  );
  return next;
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
