/**
 * The station process as a graph, measured against the process it
 * replaces rather than against its output.
 *
 * WHY THERE IS NO GOLDEN LAP HERE. `makeStationsDetailed` draws from one
 * sequential PCG32 stream in written order, and a field draws from
 * `randomField`, which is keyed on a point's identity. The two cannot
 * agree draw for draw, and making them agree would mean giving up the
 * property that lets a cook be reordered, budgeted and partitioned. So
 * these tests check the SHAPE of what the graph produces — the
 * distribution, the budget, the wrap — which is what `stations.ts` was
 * fitted to in the first place.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  type Geometry,
  Pcg32,
  attribute,
  cook,
  createPointCloud,
  createPolyline,
  dataInput,
  evaluateField,
  hashCombine,
  makeGeometryItem,
  pathResample,
} from "pcg-ts";
import {
  type StationStageOptions,
  addStationStage,
  gaussianField,
  roundField,
} from "../demos/racetrack/stationGraph.js";
import { FITTED } from "../demos/racetrack/stations.js";

/**
 * A cloud whose points are at distinct positions, which is what makes
 * their identities distinct.
 *
 * THE POSITIONS ARE THE POINT, not decoration. `randomField` keys on
 * `pointIdentities`, which is derived from a point's stored position and
 * its `seed` column — so a cloud of coincident points with equal seeds
 * draws the SAME "random" number at every one of them. That is the trap
 * waiting for anyone who builds a per-parent fan-out from a
 * single-point template, and a fixture of coincident points would hide
 * it here.
 */
function spreadCloud(n: number): ReturnType<typeof createPointCloud> {
  const geo = createPointCloud(n);
  const P = geo.attrs.point.require("P").data;
  const seeds = geo.attrs.point.require("seed").data;
  for (let i = 0; i < n; i++) {
    P[i * 3] = i * 0.5;
    P[i * 3 + 1] = 0;
    P[i * 3 + 2] = 0;
    seeds[i] = hashCombine(0x5741, i);
  }
  return geo;
}

/** Resolve a scalar field on a cloud's point domain. */
function sample(field: ReturnType<typeof gaussianField>, n: number, seed: number): Float64Array {
  const col = evaluateField(field, { geo: spreadCloud(n), domain: "point", seed });
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = col.data[i];
  return out;
}

function moments(v: Float64Array): {
  mean: number;
  sd: number;
  skew: number;
  kurt: number;
} {
  const n = v.length;
  let mean = 0;
  for (const x of v) mean += x;
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of v) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const sd = Math.sqrt(m2);
  return { mean, sd, skew: m3 / (sd * sd * sd), kurt: m4 / (m2 * m2) - 3 };
}

describe("stationGraph: the gaussian a field can express", () => {
  const N = 200_000;

  it("has the first four moments of a standard normal", () => {
    const v = sample(gaussianField("g.r", "g.theta"), N, 12345);
    const { mean, sd, skew, kurt } = moments(v);
    // Standard errors at N = 200,000: mean 1/sqrt(N) = 2.2e-3, sd
    // 1/sqrt(2N) = 1.6e-3, skew sqrt(6/N) = 5.5e-3, kurtosis
    // sqrt(24/N) = 1.1e-2. Every bound below is comfortably outside its
    // own standard error and comfortably inside what a WRONG
    // distribution would produce. Measured against the same-key
    // degenerate case this suite also builds: it reads skew 1.0104 and
    // excess kurtosis 0.6357, which are 180 and 58 standard errors out.
    // Its MEAN (0.0533) and SD (1.0530) are barely moved, so those two
    // bounds catch a scaling mistake and nothing about shape -- which is
    // why the skew and kurtosis bounds, and the sigma-mass test below,
    // are the ones doing the work here.
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(0.98);
    expect(sd).toBeLessThan(1.02);
    expect(Math.abs(skew)).toBeLessThan(0.05);
    expect(Math.abs(kurt)).toBeLessThan(0.08);
  });

  it("puts the right mass inside one, two and three sigma", () => {
    const v = sample(gaussianField("m.r", "m.theta"), N, 999);
    const within = (k: number): number => v.filter((x) => Math.abs(x) <= k).length / N;
    // 68.27 / 95.45 / 99.73, the three-sigma rule. A distribution can
    // match four moments and still have the wrong shape; this reads the
    // body directly.
    expect(within(1)).toBeGreaterThan(0.675);
    expect(within(1)).toBeLessThan(0.69);
    expect(within(2)).toBeGreaterThan(0.949);
    expect(within(2)).toBeLessThan(0.96);
    expect(within(3)).toBeGreaterThan(0.995);
    expect(within(3)).toBeLessThan(0.999);
  });

  it("is finite everywhere, including where the uniform underflows to zero", () => {
    // The guard's whole purpose. `randomField` is exactly 0 about once in
    // 16.7 million draws and log(0) is -Infinity, which propagates
    // silently until something downstream refuses the column. 200,000
    // draws will not usually contain one, so this is a statement about
    // the expression's RANGE rather than a sampling test: the clamp puts
    // a hard ceiling on |value| at sqrt(-2*log(1e-7)) = 5.68.
    const v = sample(gaussianField("f.r", "f.theta"), N, 4242);
    for (const x of v) expect(Number.isFinite(x)).toBe(true);
    const ceiling = Math.sqrt(-2 * Math.log(1e-7));
    for (const x of v) expect(Math.abs(x)).toBeLessThanOrEqual(ceiling);
  });

  it("draws independently from two keys, and identically from one", () => {
    // The control that proves the estimator can report "correlated" --
    // without it, an r near zero says nothing about whether the test
    // could ever have seen otherwise.
    const a = sample(gaussianField("i.r", "i.theta"), 50_000, 7);
    const b = sample(gaussianField("j.r", "j.theta"), 50_000, 7);
    const r = (x: Float64Array, y: Float64Array): number => {
      const n = x.length;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < n; i++) {
        mx += x[i];
        my += y[i];
      }
      mx /= n;
      my /= n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    expect(Math.abs(r(a, b))).toBeLessThan(0.02);
    expect(r(a, a)).toBeCloseTo(1, 10);
  });

  it("refuses one key used twice, because that is not a normal", () => {
    expect(() => gaussianField("same", "same")).toThrow(
      /gaussianField: both uniforms were given the key "same"/,
    );
  });

  it("would be visibly wrong if the two uniforms were the same draw", () => {
    // Proves the refusal above guards something real rather than a
    // stylistic preference: built by hand from one key, the result is
    // bounded, skewed and nothing like a normal.
    const rng = new Pcg32(hashCombine(1, 2));
    const degenerate = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.max(1e-7, rng.nextF32());
      degenerate[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * u);
    }
    const { sd, skew, kurt } = moments(degenerate);
    // Measured: mean 0.0533, sd 1.0530, skew 1.0104, kurt 0.6357. The
    // two SHAPE moments are what give it away; the first two moments
    // sit close enough to a normal's to pass an eye test, which is the
    // whole reason a same-key gaussian is worth refusing outright
    // rather than trusting a reviewer to spot.
    expect(Math.abs(skew)).toBeGreaterThan(0.5);
    expect(Math.abs(kurt)).toBeGreaterThan(0.3);
    expect(Math.abs(sd - 1)).toBeLessThan(0.1);
  });
});

describe("stationGraph: roundField", () => {
  it("rounds a half toward +Infinity, the way Math.round does", () => {
    const cases = [-2.5, -1.5, -0.5, 0.4, 0.5, 0.6, 1.5, 2.5, 99.4, 99.5];
    const geo = createPointCloud(cases.length);
    const v = geo.attrs.point.add("v", "f32", 1);
    for (let i = 0; i < cases.length; i++) v.set(i, cases[i]);
    const col = evaluateField(roundField(attribute("v")), { geo, domain: "point", seed: 0 });
    for (let i = 0; i < cases.length; i++) {
      // `===` rather than `toBe`, which is Object.is and separates -0
      // from 0: Math.round(-0.5) is -0 while floor(-0.5 + 0.5) is +0.
      // These are populations, so the sign of a zero is not a
      // difference — but it IS a difference the spelling makes, and
      // saying so here is better than a reader finding it later.
      expect(col.data[i] === Math.round(cases[i]), `round(${cases[i]})`).toBe(true);
    }
  });
});

describe("stationGraph: the process as a graph", () => {
  const HALF_WIDTH = 9;
  // A closed loop whose chord length is known by construction, so the
  // budget below is checked against arithmetic rather than against the
  // graph's own opinion of how long its path is.
  const LOOP_RADIUS = 500;
  const LOOP_POINTS = 512;

  function loopGeometry(): ReturnType<typeof createPolyline> {
    const pos = new Float64Array(LOOP_POINTS * 3);
    for (let i = 0; i < LOOP_POINTS; i++) {
      const a = (i / LOOP_POINTS) * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * LOOP_RADIUS;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = Math.sin(a) * LOOP_RADIUS;
    }
    return createPolyline(pos, { closed: true });
  }

  /** The chord length the library will measure, computed independently. */
  function loopChordLength(): number {
    return 2 * LOOP_POINTS * LOOP_RADIUS * Math.sin(Math.PI / LOOP_POINTS);
  }

  async function runStations(
    seed: number,
    opts: Partial<StationStageOptions> = {},
  ): Promise<{ stations: number[]; lapW: number }> {
    const g = new Graph(seed);
    const pathIn = g.add(dataInput, {}, "path");
    g.setParam(pathIn, "items", [makeGeometryItem(loopGeometry())]);
    const measured = g.add(
      pathResample,
      { mode: "count", count: LOOP_POINTS, lengthAttr: "lapLen" },
      "measure",
    );
    g.connect(pathIn, "out", measured, "in");
    const stage = addStationStage(g, { node: measured, pin: "out" }, {
      halfWidth: HALF_WIDTH,
      ...opts,
    });
    g.output(stage.out, "out", "stations");
    const res = await cook(g);
    const items = res.outputs.stations;
    const geo = (items[0] as { geo: Geometry }).geo;
    const col = geo.attrs.point.require(stage.stationAttr);
    const stations: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) stations.push(col.get(i) as number);
    return { stations, lapW: loopChordLength() / HALF_WIDTH };
  }

  it("hits D-1's budget exactly, the way the process it replaces does", async () => {
    const { stations, lapW } = await runStations(1);
    // total = round(density * lapW). The graph computes this from the
    // path's own primitive-domain length column; this recomputes it from
    // the radius, so the two agree only if the count field really is
    // reading the curve.
    expect(stations).toHaveLength(Math.round(FITTED.density * lapW));
  });

  it("scales its count with the lap rather than stretching a fixed one", async () => {
    const { stations, lapW } = await runStations(1);
    const half = await runStations(1, { densityScale: 0.5 });
    expect(half.stations.length).toBe(Math.round(FITTED.density * 0.5 * lapW));
    expect(stations.length / half.stations.length).toBeCloseTo(2, 1);
  });

  it("puts every station inside [0, lapW), wrapped rather than clipped", async () => {
    const { stations, lapW } = await runStations(3);
    for (const s of stations) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(lapW);
    }
    // A CLIP would pile mass on the two ends; a wrap does not. If the
    // Euclidean spelling were wrong, negatives would either survive
    // (caught above) or collapse onto 0.
    const atZero = stations.filter((s) => s < 0.001).length;
    expect(atZero).toBeLessThan(3);
  });

  it("gives the same lap twice and a different one per seed", async () => {
    const a = await runStations(7);
    const b = await runStations(7);
    const c = await runStations(8);
    expect(a.stations).toEqual(b.stations);
    expect(a.stations).not.toEqual(c.stations);
  });

  it("is clustered rather than uniform, which is the whole point", async () => {
    // The index of dispersion at a 16 W window: variance over mean of
    // the per-bin counts. A Poisson process reads 1.0; the fitted
    // process is published at 5.03 at this window. This is the coarse
    // gate -- the full seven-window curve belongs with the port's
    // acceptance suite -- but it separates "clustered" from "uniform",
    // which is what a broken cluster stage would silently lose.
    const { stations, lapW } = await runStations(11);
    const windowW = 16;
    const bins = Math.max(2, Math.floor(lapW / windowW));
    const counts = new Array<number>(bins).fill(0);
    for (const s of stations) counts[Math.min(bins - 1, Math.floor((s / lapW) * bins))]++;
    const mean = counts.reduce((a, b) => a + b, 0) / bins;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / bins;
    const dispersion = variance / mean;
    // Measured 3.775 on this seed, against a Poisson control of 1.335
    // from the same estimator (the test below). The published median at
    // a 16 W window is 5.03 with a p10-p90 of 1.4-17.0, so this sits
    // inside the source's spread. The bound is set at 2.2 -- above the
    // control by a clear margin and below the measurement by one -- so
    // that losing the cluster stage entirely fails it rather than
    // landing in an overlap where neither test says anything.
    expect(dispersion).toBeGreaterThan(2.2);
  });

  it("spreads its instances over many clusters, not onto one", async () => {
    // THE FAILURE DISPERSION CANNOT SEE. If the cluster gather were
    // broken so that every instance read the SAME cluster, the lap would
    // become MORE clustered, not less -- the index of dispersion rises
    // and the gate above passes while the whole lap sits in one heap.
    // Measured the other way instead: how much of the lap's population
    // the densest single stretch holds.
    const { stations, lapW } = await runStations(11);
    const windowW = 30; // about three cluster spreads
    let worst = 0;
    for (const centre of stations) {
      let n = 0;
      for (const s of stations) {
        const d = Math.abs(s - centre);
        if (Math.min(d, lapW - d) <= windowW / 2) n++;
      }
      if (n > worst) worst = n;
    }
    // Measured 0.1446 on this seed. The same measurement with the
    // gather mutated to read cluster 0 for every instance reads
    // 0.9006, and the dispersion gate above PASSES under that
    // mutation -- which is the whole reason this test exists.
    expect(worst / stations.length).toBeLessThan(0.25);
  });

  it("reads 1.0 for a pure background draw, so the instrument works", async () => {
    // The control. With background = 1 every placement is uniform, so
    // the same estimator must come back near Poisson -- without this,
    // the test above cannot distinguish "clustered" from "my estimator
    // is broken".
    const { stations, lapW } = await runStations(11, {
      params: { ...FITTED, background: 1 },
    });
    const windowW = 16;
    const bins = Math.max(2, Math.floor(lapW / windowW));
    const counts = new Array<number>(bins).fill(0);
    for (const s of stations) counts[Math.min(bins - 1, Math.floor((s / lapW) * bins))]++;
    const mean = counts.reduce((a, b) => a + b, 0) / bins;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / bins;
    // Measured 1.335, against the clustered 3.775 above. Not exactly
    // 1.0 because 21 bins is a small sample, which is why the bound is
    // 1.9 rather than something tighter.
    expect(variance / mean).toBeLessThan(1.9);
  });
});
