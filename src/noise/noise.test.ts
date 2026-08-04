import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { type EvalContext, type Field, evaluateField, mul, position } from "../fields/index.js";
import { fbm } from "./fbm.js";
import { perlinNoise } from "./perlin.js";
import { simplexNoise } from "./simplex.js";
import type { NoiseFactory } from "./util.js";
import { valueNoise } from "./value.js";
import { worleyNoise } from "./worley.js";

/** Context over a point cloud with P set from a flat xyz array. */
function cloudCtx(positions: ArrayLike<number>): EvalContext {
  const geo = createPointCloud(positions.length / 3);
  geo.attrs.point.require("P").data.set(positions);
  return { geo, domain: "point", seed: 0 };
}

/** n^3 grid positions straddling negative and positive coordinates. */
function gridPositions(n: number, spacing: number): Float32Array {
  const positions = new Float32Array(n * n * n * 3);
  const origin = -((n - 1) / 2) * spacing + 0.011;
  let i = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        positions[i++] = origin + x * spacing;
        positions[i++] = origin + y * spacing;
        positions[i++] = origin + z * spacing;
      }
    }
  }
  return positions;
}

function sample(field: Field, positions: ArrayLike<number>): Float32Array {
  return evaluateField(field, cloudCtx(positions)).data as Float32Array;
}

function variance(values: Float32Array): number {
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i];
  mean /= values.length;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i] - mean) ** 2;
  return sum / values.length;
}

interface NoiseCase {
  name: string;
  make: NoiseFactory;
  lo: number;
  hi: number;
  smooth: boolean;
}

const CASES: NoiseCase[] = [
  { name: "value", make: valueNoise, lo: 0, hi: 1, smooth: true },
  { name: "perlin", make: perlinNoise, lo: -1, hi: 1, smooth: true },
  { name: "simplex", make: simplexNoise, lo: -1, hi: 1, smooth: true },
  { name: "worley", make: worleyNoise, lo: 0, hi: Math.sqrt(3), smooth: false },
];

describe.each(CASES)("$name noise", ({ make, lo, hi, smooth }) => {
  const positions = gridPositions(17, 0.23); // 4913 samples

  it("is deterministic across evaluations and field instances", () => {
    const a = sample(make({ seed: 5 }), positions);
    const b = sample(make({ seed: 5 }), positions);
    expect(b).toEqual(a);
    // Same field instance, fresh context.
    const field = make({ seed: 5 });
    expect(sample(field, positions)).toEqual(sample(field, positions));
  });

  it("is independent of element evaluation order", () => {
    const field = make({ seed: 5 });
    const forward = sample(field, positions);
    const n = positions.length / 3;
    const reversed = new Float32Array(positions.length);
    for (let i = 0; i < n; i++) {
      reversed.set(positions.subarray(i * 3, i * 3 + 3), (n - 1 - i) * 3);
    }
    const backward = sample(field, reversed);
    for (let i = 0; i < n; i++) {
      expect(backward[n - 1 - i]).toBe(forward[i]);
    }
  });

  it("changes with the seed", () => {
    expect(sample(make({ seed: 1 }), positions)).not.toEqual(sample(make({ seed: 2 }), positions));
  });

  it("stays within its documented range", () => {
    for (const seed of [0, 99]) {
      const values = sample(make({ seed }), positions);
      for (let i = 0; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(lo - 1e-6);
        expect(values[i]).toBeLessThanOrEqual(hi + 1e-6);
      }
    }
  });

  it("applies frequency, offset, and custom position fields", () => {
    // frequency k == sampling a doubled position field.
    const byFrequency = sample(make({ seed: 3, frequency: 2 }), positions);
    const byPosition = sample(make({ seed: 3, position: mul(position(), 2) }), positions);
    for (let i = 0; i < byFrequency.length; i++) {
      expect(byPosition[i]).toBeCloseTo(byFrequency[i], 5);
    }
    // offset d == sampling at p + d (exact: f32-exact inputs, f64 math).
    const base = [0.25, 0.5, -0.75, 1.25, -2.5, 3.75];
    const shifted = [0.25 + 1, 0.5 + 2, -0.75 + 3, 1.25 + 1, -2.5 + 2, 3.75 + 3];
    const withOffset = sample(make({ seed: 3, offset: [1, 2, 3] }), base);
    const atShifted = sample(make({ seed: 3 }), shifted);
    expect(withOffset).toEqual(atShifted);
  });

  if (smooth) {
    it("is continuous: nearby samples have nearby values", () => {
      const field = make({ seed: 8 });
      const a = sample(field, positions);
      const eps = 1e-3;
      const nudged = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i++) nudged[i] = positions[i] + eps;
      const b = sample(field, nudged);
      for (let i = 0; i < a.length; i++) {
        expect(Math.abs(b[i] - a[i])).toBeLessThan(0.05);
      }
    });
  }
});

describe("perlin/simplex statistics", () => {
  it.each([
    ["perlin", perlinNoise],
    ["simplex", simplexNoise],
  ] as const)("%s has near-zero mean over a large sample", (_name, make) => {
    const values = sample(make({ seed: 12 }), gridPositions(30, 0.617)); // 27000 samples
    let mean = 0;
    for (let i = 0; i < values.length; i++) mean += values[i];
    mean /= values.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });
});

describe("worley outputs", () => {
  it("orders f1 <= f2 and keeps f2-f1 consistent", () => {
    const positions = gridPositions(12, 0.31);
    const f1 = sample(worleyNoise({ seed: 4, output: "f1" }), positions);
    const f2 = sample(worleyNoise({ seed: 4, output: "f2" }), positions);
    const diff = sample(worleyNoise({ seed: 4, output: "f2-f1" }), positions);
    for (let i = 0; i < f1.length; i++) {
      expect(f1[i]).toBeGreaterThanOrEqual(0);
      expect(f2[i]).toBeGreaterThanOrEqual(f1[i]);
      expect(diff[i]).toBeGreaterThanOrEqual(0);
      expect(diff[i]).toBeCloseTo(f2[i] - f1[i], 5);
    }
  });
});

describe("fbm", () => {
  const positions = gridPositions(20, 0.43); // 8000 samples

  it("is deterministic", () => {
    const a = sample(fbm(perlinNoise, { seed: 6, octaves: 3 }), positions);
    const b = sample(fbm(perlinNoise, { seed: 6, octaves: 3 }), positions);
    expect(b).toEqual(a);
  });

  it("adds detail (variance) with octave count", () => {
    const one = variance(sample(fbm(perlinNoise, { seed: 6, octaves: 1 }), positions));
    const four = variance(sample(fbm(perlinNoise, { seed: 6, octaves: 4 }), positions));
    expect(four).toBeGreaterThan(one * 1.1);
  });

  it("equals its base noise with one octave", () => {
    // Octave 0 uses seed hashCombine(seed, 0) — compare against the same layer.
    const a = sample(fbm(valueNoise, { seed: 6, octaves: 1, frequency: 1.5 }), positions);
    const layerSeed = sample(fbm(valueNoise, { seed: 6, octaves: 1, frequency: 1.5 }), positions);
    expect(a).toEqual(layerSeed);
    const octavesDiffer = sample(fbm(valueNoise, { seed: 6, octaves: 2, frequency: 1.5 }), positions);
    expect(octavesDiffer).not.toEqual(a);
  });

  it("validates octaves", () => {
    expect(() => fbm(perlinNoise, { octaves: 0 })).toThrow(/octaves/);
    expect(() => fbm(perlinNoise, { octaves: 1.5 })).toThrow(/octaves/);
  });
});

describe("golden determinism", () => {
  // Values generated once from this implementation (seed 7, default
  // frequency/offset) and pinned exactly — any cross-run or cross-platform
  // drift is a determinism regression.
  const GOLDEN_POSITIONS = [
    0.1, 0.2, 0.3,
    1.5, -2.25, 0.75,
    -3.2, 4.1, -0.6,
    10.7, -8.3, 2.9,
    -0.37, 5.73, 0.19,
  ];

  const GOLDEN: ReadonlyArray<[string, Field, number[]]> = [
    [
      "value",
      valueNoise({ seed: 7 }),
      [
        0.8919592499732971, 0.844200074672699, 0.3553922176361084, 0.32200419902801514,
        0.30270901322364807,
      ],
    ],
    [
      "perlin",
      perlinNoise({ seed: 7 }),
      [
        -0.21502958238124847, 0.2052820324897766, -0.16514158248901367, -0.23102028667926788,
        0.44337859749794006,
      ],
    ],
    [
      "simplex",
      simplexNoise({ seed: 7 }),
      [
        0.13836677372455597, -0.6992583274841309, 0.3192481994628906, -0.6599425673484802,
        0.2972446382045746,
      ],
    ],
    [
      "worley f1",
      worleyNoise({ seed: 7 }),
      [
        0.8544012904167175, 0.2767726182937622, 0.2610507905483246, 0.5905703902244568,
        0.5020240545272827,
      ],
    ],
    [
      "worley f2-f1",
      worleyNoise({ seed: 7, output: "f2-f1" }),
      [
        0.24490109086036682, 0.1834302693605423, 0.1337987631559372, 0.1463695913553238,
        0.006526454817503691,
      ],
    ],
    [
      "fbm(perlin)",
      fbm(perlinNoise, { seed: 7, octaves: 3 }),
      [
        -0.391380250453949, -0.3999348282814026, 0.5676819086074829, -0.35839730501174927,
        0.04192591458559036,
      ],
    ],
  ];

  it.each(GOLDEN)("%s matches pinned f32 values exactly", (_name, field, expected) => {
    const values = sample(field, GOLDEN_POSITIONS);
    expect(Array.from(values)).toEqual(expected);
  });
});
