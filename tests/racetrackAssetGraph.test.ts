/**
 * The asset choice, as a graph — and whether it draws what `placeAsset`
 * draws.
 *
 * WHAT THIS SUITE CAN AND CANNOT ASSERT. The port re-bases: `placeAsset`
 * draws from one sequential stream indexed by a station's rank in sorted
 * order, and the graph draws from `randomField`, which keys on a point's
 * identity so a cook is order-independent. So there is no lap to compare
 * station for station, and every claim here is either DISTRIBUTIONAL (the
 * frequencies a weighted pick must produce, over enough draws that the
 * bound is tight) or STRUCTURAL (exactly one asset per station, a
 * zero-weight asset never picked, the same seed twice giving the same
 * lap). Those are the claims that survive the re-basing, and they are the
 * ones a golden file would not have caught anyway.
 *
 * THE SYNTHETIC HALF RUNS ON A HAND-BUILT LAP, on purpose. A measured kit
 * has 229 assets whose weights differ by three orders of magnitude, which
 * is exactly the wrong fixture for asking "does the bracket land where
 * the weights say": the answer is dominated by a handful of rows and a
 * bug in the tail is invisible. Four assets with weights chosen to be
 * checkable makes the frequency test a real test.
 */
import { describe, expect, it } from "vitest";
import {
  type Geometry,
  Graph,
  cook,
  createPointCloud,
  createPolyline,
  dataInput,
  makeGeometryItem,
} from "pcg-ts";
import {
  ASSET,
  CHOICE,
  addAssetChoiceStage,
  assetCloud,
  cookLapPlacements,
} from "../demos/racetrack/assetGraph.js";
import {
  type PlaceableAsset,
  bucketOf,
  drawQuantile,
  weightAt,
} from "../demos/racetrack/assets.js";
import { CORNER_MODEL } from "../demos/racetrack/graph.js";
import type { Lap } from "../demos/racetrack/lap.js";
import { dressLap, reserveFor } from "../demos/racetrack/dress.js";
import { DENSITY } from "../demos/racetrack/stations.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

/** An asset with only the fields the choice stage reads. */
function asset(
  id: number,
  instances: number,
  affinity: readonly [number, number, number, number],
  where: {
    lateral?: [number, number, number];
    height?: [number, number, number];
    right?: number;
  } = {},
): PlaceableAsset {
  const lat = where.lateral ?? [1, 2, 3];
  const hgt = where.height ?? [0.5, 1, 2];
  return {
    id,
    name: `a${id}`,
    shape: "box",
    instances,
    size: { across: 1, along: 1, tall: 1 },
    where: {
      lateral: { p10: lat[0], median: lat[1], p90: lat[2] },
      height: { p10: hgt[0], median: hgt[1], p90: hgt[2] },
      rightOfTravel: where.right ?? 0.5,
      gapCv: 1,
      affinity: {
        straight: affinity[0],
        easy: affinity[1],
        medium: affinity[2],
        tight: affinity[3],
      },
    },
  };
}

/**
 * A straight lap of `lengthW` half-widths, at one radius everywhere.
 *
 * ONE RADIUS SO THE BUCKET IS KNOWN. `transferAlongPath` interpolates,
 * and a fixture whose radius varied between frames would put stations in
 * a bucket that depends on where between two frames they fell — which is
 * a real property of the stage and the wrong thing to be measuring while
 * checking the arithmetic of a weighted draw.
 */
function flatLap(lengthW: number, halfWidth: number, radiusW: number): Geometry {
  const n = 64;
  const p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) p[i * 3] = (i / (n - 1)) * lengthW * halfWidth;
  const geo = createPolyline(p, { closed: false });
  const col = geo.attrs.point.add(CORNER_MODEL.radius, "f32", 1);
  for (let i = 0; i < n; i++) col.set(i, radiusW);
  return geo;
}

/**
 * `count` stations spread evenly over the lap.
 *
 * THE POSITIONS ARE SET, not left at the origin, and that is the fixture
 * bug this comment exists to prevent a repeat of. `randomField` keys on a
 * point's identity — its position bits and its seed — so a cloud of
 * coincident points draws the SAME uniform at every one of them. The
 * first version of this file wrote them with `set(i, [x, y, z])`, whose
 * second parameter is a SCALAR and whose third is a component index, so
 * every x became NaN and every identity became the same one. The suite
 * then reported a pick that always chose the heaviest asset and a coin
 * that always came up right — a broken fixture reading exactly like a
 * broken sampler, which is why {@link setTuple} is worth the two extra
 * characters.
 */
function stationCloud(count: number, lengthW: number, halfWidth: number): Geometry {
  const geo = createPointCloud(count);
  const P = geo.attrs.point.require("P");
  const st = geo.attrs.point.add("stationW", "f32", 1);
  for (let i = 0; i < count; i++) {
    const s = ((i + 0.5) / count) * lengthW;
    st.set(i, s);
    P.setTuple(i, [s * halfWidth, 0, 0]);
  }
  return geo;
}

/** Cook one choice stage over a hand-built lap and read every column back. */
async function pick(opts: {
  pool: readonly PlaceableAsset[];
  stations: number;
  radiusW: number;
  seed: number;
  lengthW?: number;
  halfWidth?: number;
}): Promise<{ ord: number[]; idx: number[]; t: number[]; h: number[]; u: number[] }> {
  const lengthW = opts.lengthW ?? 200;
  const halfWidth = opts.halfWidth ?? 9;
  const g = new Graph(opts.seed);
  const pathIn = g.add(dataInput, {}, "path");
  g.setParam(pathIn, "items", [makeGeometryItem(flatLap(lengthW, halfWidth, opts.radiusW))]);
  const stIn = g.add(dataInput, {}, "stations");
  g.setParam(stIn, "items", [
    makeGeometryItem(stationCloud(opts.stations, lengthW, halfWidth)),
  ]);
  const assetsIn = g.add(dataInput, {}, "assets");
  g.setParam(assetsIn, "items", [makeGeometryItem(assetCloud(opts.pool))]);

  const stage = addAssetChoiceStage(
    g,
    { node: stIn, pin: "out" },
    { node: assetsIn, pin: "out" },
    { node: pathIn, pin: "out" },
    { halfWidth, assetCount: opts.pool.length },
  );
  g.output(stage.out, "out", "chosen");

  const cooked = await cook(g);
  const geo = (cooked.outputs.chosen[0] as { geo: Geometry }).geo;
  const col = (name: string): number[] => {
    const c = geo.attrs.point.require(name);
    const out: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) out.push(c.get(i) as number);
    return out;
  };
  return {
    ord: col(ASSET.ord),
    idx: col(CHOICE.stationIdx),
    t: col(CHOICE.t),
    h: col(CHOICE.h),
    u: col(CHOICE.uLat),
  };
}

describe("assetGraph: the weighted pick", () => {
  // Weights at a straight: instances * affinity.straight, so 10, 30, 60,
  // and 0 — a tenth, three tenths, six tenths, and never.
  const POOL = [
    asset(0, 10, [1, 0, 0, 0]),
    asset(1, 10, [3, 0, 0, 0]),
    asset(2, 20, [3, 0, 0, 0]),
    asset(3, 50, [0, 1, 1, 1]),
  ];

  it("keeps exactly one asset per station, and knows which station it is", async () => {
    const got = await pick({ pool: POOL, stations: 500, radiusW: 100, seed: 3 });
    expect(got.ord.length).toBe(500);
    // Every station exactly once: the bracket's top IS its successor's
    // bottom, so no station can keep two copies and none can keep none.
    expect(new Set(got.idx).size).toBe(500);
    expect(got.idx.every((v) => Number.isInteger(v) && v >= 0 && v < 500)).toBe(true);
  });

  it("draws each asset at the share its weight says, and never draws a zero", async () => {
    const got = await pick({ pool: POOL, stations: 4000, radiusW: 100, seed: 11 });
    const total = POOL.reduce((n, a) => n + weightAt(a, "straight"), 0);
    const seen = [0, 0, 0, 0];
    for (const o of got.ord) seen[o]++;
    const share = seen.map((n) => n / got.ord.length);
    const want = POOL.map((a) => weightAt(a, "straight") / total);
    // eslint-disable-next-line no-console
    console.log(
      "pick shares: " +
        share.map((s, i) => `${i} ${s.toFixed(4)} (want ${want[i].toFixed(4)})`).join("  "),
    );
    // THE ZERO IS THE EXACT HALF OF THIS CLAIM. An asset with no weight
    // gets a bracket whose top equals its bottom, so it is unreachable by
    // construction rather than merely unlikely -- and if the bracket were
    // built as `cum <= x < cum + w` in f32 it would NOT be, which is the
    // failure this pins.
    expect(seen[3]).toBe(0);
    // Four sigma on 4000 draws is about 0.031 at p = 0.6, so 0.02 is a
    // real bound rather than a restatement of the sample.
    for (let i = 0; i < 3; i++) expect(Math.abs(share[i] - want[i])).toBeLessThan(0.02);
  });

  it("reads the curvature at the station, so the bucket decides the pool", async () => {
    // The same four assets, on a lap tight enough that only the fourth
    // has any weight at all. If curvature never reached the weight, the
    // straight's answer would come back here unchanged.
    const got = await pick({ pool: POOL, stations: 300, radiusW: 5, seed: 7 });
    expect(bucketOf(5)).toBe("tight");
    expect(new Set(got.ord)).toEqual(new Set([3]));

    // And the cuts are where `bucketOf` puts them: 40 W is a straight and
    // 39 W is not, which is the boundary the curvature reciprocal has to
    // preserve.
    const atStraight = await pick({ pool: POOL, stations: 200, radiusW: 41, seed: 7 });
    const atEasy = await pick({ pool: POOL, stations: 200, radiusW: 39, seed: 7 });
    expect(atStraight.ord.includes(3)).toBe(false);
    expect(new Set(atEasy.ord)).toEqual(new Set([3]));
  });

  it("places from the asset's own quantiles, agreeing with drawQuantile", async () => {
    // ONE ASSET SO THE ANSWER IS CHECKABLE against the function it ports:
    // the graph publishes the uniform it drew, so this is the two
    // implementations of the same inverse CDF on the same input rather
    // than two samples that happen to have similar moments.
    const one = [asset(0, 1, [1, 1, 1, 1], { lateral: [1, 4, 10], right: 1 }), asset(1, 0, [0, 0, 0, 0])];
    const got = await pick({ pool: one, stations: 400, radiusW: 100, seed: 5 });
    expect(got.ord.every((o) => o === 0)).toBe(true);
    let worst = 0;
    for (let i = 0; i < got.t.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(Math.abs(got.t[i]) - drawQuantile({ p10: 1, median: 4, p90: 10 }, got.u[i])),
      );
    }
    // eslint-disable-next-line no-console
    console.log(`lateral vs drawQuantile: worst |delta| ${worst.toExponential(2)}`);
    // f32 columns against f64 arithmetic on values running to ~10, where
    // f32 spacing is about 1e-6.
    expect(worst).toBeLessThan(1e-4);
  });

  it("keeps each asset on the side its instances were on", async () => {
    // The gate `racetrackAssets` makes of `placeAsset`, made of the graph:
    // an asset measured entirely on one side stays there, and one with no
    // lean gets a fair flip rather than a constant.
    const right = [asset(0, 1, [1, 1, 1, 1], { right: 1 }), asset(1, 0, [0, 0, 0, 0])];
    const left = [asset(0, 1, [1, 1, 1, 1], { right: 0 }), asset(1, 0, [0, 0, 0, 0])];
    const even = [asset(0, 1, [1, 1, 1, 1], { right: 0.5 }), asset(1, 0, [0, 0, 0, 0])];
    const r = await pick({ pool: right, stations: 300, radiusW: 100, seed: 2 });
    const l = await pick({ pool: left, stations: 300, radiusW: 100, seed: 2 });
    const e = await pick({ pool: even, stations: 2000, radiusW: 100, seed: 2 });
    expect(r.t.every((v) => v > 0)).toBe(true);
    expect(l.t.every((v) => v < 0)).toBe(true);
    const rightShare = e.t.filter((v) => v > 0).length / e.t.length;
    // eslint-disable-next-line no-console
    console.log(`even lean: ${(rightShare * 100).toFixed(1)}% right of travel`);
    expect(Math.abs(rightShare - 0.5)).toBeLessThan
      (0.04);
  });

  it("gives the same lap twice, from the same seed", async () => {
    const a = await pick({ pool: POOL, stations: 300, radiusW: 100, seed: 42 });
    const b = await pick({ pool: POOL, stations: 300, radiusW: 100, seed: 42 });
    expect(b).toEqual(a);
    const c = await pick({ pool: POOL, stations: 300, radiusW: 100, seed: 43 });
    expect(c.ord).not.toEqual(a.ord);
  });

  it("refuses a pool too small to be a draw, naming what to do instead", async () => {
    await expect(pick({ pool: [POOL[0]], stations: 4, radiusW: 100, seed: 1 })).rejects.toThrow(
      /assetCount must be a whole number >= 2/,
    );
  });
});

/**
 * THE SHIPPED VOCABULARY, NOT A MEASURED KIT, and that is a deliberate
 * departure from `racetrackAssets`. That suite exists to compare two
 * SOURCES of the same quantity and has to run on measurement; this one
 * asks whether a graph draws what a function draws, which is a question
 * about the arithmetic and not about the circuit. The shipped vocabulary
 * is committed, so these run in a plain checkout — and the measured kits
 * live outside both repositories, so a suite gated on them is a suite CI
 * never executes.
 */
describe("assetGraph: the lap the page actually draws", () => {
  const kit = shippedVocabulary();
  const SEEDS = [1, 2, 3];

  const theLap = async (): Promise<Lap> => (await lapFor(1)).lap;

  it.each(SEEDS)("chooses an asset for every station it was given (seed %i)", async (seed) => {
    const lap = await theLap();
    const { pool } = reserveFor(kit, seed);
    const out = await cookLapPlacements({ lap, seed, pool });
    expect(out.choices.length).toBe(out.stations.stations.length);
    // A station with no asset is legal and vanishingly unlikely on a real
    // kit -- 229 assets, and a bucket in which every one of them weighs
    // zero would be a defect in the measurement, not a draw.
    expect(out.choices.every((c) => c !== undefined)).toBe(true);
    expect(out.choices.every((c) => c && c.assetIndex >= 0 && c.assetIndex < pool.length)).toBe(
      true,
    );
  });

  it("uses the whole vocabulary rather than a few frequent assets", async () => {
    // `racetrackAssets` makes this claim of `placeAsset` and it is the one
    // that matters most for the picture: 135 of 206 assets appeared once,
    // and a weighting that dropped one-offs would collapse the lap into a
    // handful of repeated objects while every count still passed.
    const lap = await theLap();
    const seen = new Set<number>();
    let poolSize = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { pool } = reserveFor(kit, seed);
      poolSize = pool.length;
      const out = await cookLapPlacements({ lap, seed, pool });
      for (const c of out.choices) if (c) seen.add(c.assetIndex);
    }
    // eslint-disable-next-line no-console
    console.log(`distinct assets over 6 laps: ${seen.size} of ${poolSize}`);
    expect(seen.size).toBeGreaterThan(poolSize * 0.5);
  });

  it("declines into bends, because the affinities do and nothing else does", async () => {
    // D-6 WITHOUT DOUBLE-COUNTING IT. The share-weighted mean affinity of
    // what was actually PICKED must fall from straight to tight -- and it
    // must fall because the pool at a tight station is a different pool,
    // not because any density knob was turned. Measured on the lap's own
    // stations, split by the curvature the graph read there.
    const lap = await theLap();
    const { pool } = reserveFor(kit, 4);
    const out = await cookLapPlacements({ lap, seed: 4, pool });
    const corners = lap.corner;
    if (!corners) throw new Error("racetrackAssetGraph: the lap carries no corner model");
    const sum = { straight: [0, 0], tight: [0, 0] };
    for (let i = 0; i < out.choices.length; i++) {
      const c = out.choices[i];
      if (!c) continue;
      const s = out.stations.stations[i];
      const frame = Math.min(
        lap.count - 1,
        Math.max(0, Math.round((s / lap.lengthW) * lap.count)),
      );
      const b = bucketOf(corners.radiusW[frame]);
      const where = pool[c.assetIndex].where;
      if (!where) continue;
      if (b === "straight") {
        sum.straight[0] += where.affinity.straight;
        sum.straight[1]++;
      } else if (b === "tight" || b === "medium") {
        sum.tight[0] += where.affinity.straight;
        sum.tight[1]++;
      }
    }
    const meanStraight = sum.straight[0] / sum.straight[1];
    const meanBend = sum.tight[0] / sum.tight[1];
    // eslint-disable-next-line no-console
    console.log(
      `mean straight-affinity of what was picked: straights ${meanStraight.toFixed(3)} (n=${sum.straight[1]}), bends ${meanBend.toFixed(3)} (n=${sum.tight[1]})`,
    );
    // Assets that like straights are picked on straights. This is the
    // mechanism, and if the curvature read were broken the two means
    // would be the same number.
    expect(meanStraight).toBeGreaterThan(meanBend);
  });

  it.each(SEEDS)("dresses a whole lap from a graph-decided one (seed %i)", async (seed) => {
    const lap = await theLap();
    const { pool } = reserveFor(kit, seed);
    const out = await cookLapPlacements({ lap, seed, pool });
    const dressed = dressLap(kit, lap, seed, {
      stations: out.stations,
      choices: out.choices,
    });
    const perW = dressed.stats.placed / lap.lengthW;
    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: ${dressed.stats.placed} placed, ${perW.toFixed(3)} per W, ${dressed.boxes.length} boxes`,
    );
    expect(perW).toBeGreaterThan(DENSITY.min);
    expect(perW).toBeLessThan(DENSITY.max);
    expect(dressed.boxes.length).toBeGreaterThan(0);
  });

  it("refuses a lap with no corner model, naming the fix", async () => {
    const lap = await theLap();
    const bare = { ...lap, corner: undefined };
    const { pool } = reserveFor(kit, 1);
    await expect(cookLapPlacements({ lap: bare, seed: 1, pool })).rejects.toThrow(
      /carries no corner model/,
    );
  });
});
