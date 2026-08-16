import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { type EvalContext, type Field, evaluateField, mul, position } from "../fields/index.js";
import type { FieldSpec } from "../fields/spec.js";
import { fieldFromJson, fieldToJson, getFieldSpec, listFieldFns } from "../fields/fieldJson.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { NOISE_BASES, WORLEY_OUTPUTS } from "./bases.js";
import { fbm } from "./fbm.js";
import { perlinNoise } from "./perlin.js";
import { simplexNoise } from "./simplex.js";
import { NOISE_RAW_RANGES, hash2, hash5, noiseOutputRange, type NoiseFactory } from "./util.js";
import { valueNoise } from "./value.js";
import { worleyNoise, type WorleyNoiseOpts } from "./worley.js";

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

describe("simplex skew-cell continuity", () => {
  // Regression for the r²=0.6 kernel: its support overran the four
  // traversed corners, giving a true C0 jump (|Δv| ≈ 5e-3) across
  // skew-cell boundaries. Construct pairs straddling skew-lattice faces
  // and assert the difference vanishes with the straddle width.
  const G3 = 1 / 6;
  const unskew = (X: number, Y: number, Z: number): [number, number, number] => {
    const t = (X + Y + Z) * G3;
    return [X - t, Y - t, Z - t];
  };

  function straddlePairs(eps: number): { a: Float32Array; b: Float32Array; count: number } {
    const cells: Array<[number, number, number]> = [
      [0, 0, 0], [1, -2, 3], [-1, -1, -1], [2, 0, -3],
      [-4, 5, 1], [0, 2, -2], [3, 3, 3], [-2, -3, 4],
    ];
    const fracs = [0.1, 0.35, 0.5, 0.65, 0.9];
    const count = cells.length * fracs.length * fracs.length * 3;
    const a = new Float32Array(count * 3);
    const b = new Float32Array(count * 3);
    let idx = 0;
    for (const [ci, cj, ck] of cells) {
      for (const fa of fracs) {
        for (const fb of fracs) {
          for (let axis = 0; axis < 3; axis++) {
            // Skewed-space point exactly on the integer face of `axis`.
            const S: [number, number, number] =
              axis === 0
                ? [ci, cj + fa, ck + fb]
                : axis === 1
                  ? [ci + fa, cj, ck + fb]
                  : [ci + fa, cj + fb, ck];
            const lo: [number, number, number] = [...S];
            const hi: [number, number, number] = [...S];
            lo[axis] -= eps / 2;
            hi[axis] += eps / 2;
            a.set(unskew(...lo), idx * 3);
            b.set(unskew(...hi), idx * 3);
            idx++;
          }
        }
      }
    }
    return { a, b, count };
  }

  function maxJump(eps: number): number {
    const field = simplexNoise({ seed: 8 });
    const { a, b, count } = straddlePairs(eps);
    const va = sample(field, a);
    const vb = sample(field, b);
    let worst = 0;
    for (let i = 0; i < count; i++) {
      worst = Math.max(worst, Math.abs(vb[i] - va[i]));
    }
    return worst;
  }

  it("has no jump across straddling pairs, shrinking with eps", () => {
    const coarse = maxJump(1e-3);
    const fine = maxJump(1e-5);
    // A C0 discontinuity (~5e-3) would dwarf this bound.
    expect(fine).toBeLessThan(1e-3);
    expect(fine).toBeLessThan(coarse);
  });
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

describe("noise grammar tables", () => {
  // `NOISE_BASES` / `WORLEY_OUTPUTS` are read by BOTH the spec derivers
  // (this module) and the spec parser (`fieldFromJson`). These pin the
  // agreement that makes them one table rather than two that drift: a
  // deriver that emits a name the parser rejects is a graph that saves and
  // cannot be reopened.

  it("names every base exactly as that factory's own spec names itself", () => {
    // This is what lets `fbm` recover a base's grammar name from the spec
    // its octave carries instead of scanning the table.
    for (const [name, factory] of Object.entries(NOISE_BASES)) {
      expect(getFieldSpec(factory())).toEqual({ fn: name, opts: expect.any(Object) });
    }
  });

  it("names only bases the parser accepts", () => {
    const fns = listFieldFns();
    for (const name of Object.keys(NOISE_BASES)) {
      expect(fns).toContain(name);
      // The parser's own base check reads the same table.
      expect(() => fieldFromJson({ fn: "fbm", base: name })).not.toThrow();
    }
    expect(() => fieldFromJson({ fn: "fbm", base: "notANoise" })).toThrow(/fbm base must be one of/);
  });

  it("derives an fbm spec over every listed base that rebuilds the same field", () => {
    for (const [name, factory] of Object.entries(NOISE_BASES)) {
      const field = fbm(factory, { seed: 3, octaves: 2, lacunarity: 2.5, gain: 0.4 });
      const spec = getFieldSpec(field);
      expect(spec).toMatchObject({ fn: "fbm", base: name });
      // The round trip is the whole point: same structural key means the
      // reopened graph evaluates to the same bytes.
      expect(fieldFromJson(spec as FieldSpec).key).toBe(field.key);
    }
  });

  it("lists exactly the worley outputs the factory derives a spec for", () => {
    for (const output of WORLEY_OUTPUTS) {
      const opts = { output } as WorleyNoiseOpts;
      const spec = getFieldSpec(worleyNoise(opts));
      expect(spec).toMatchObject({ fn: "worleyNoise", opts: { output } });
      expect(fieldFromJson(spec as FieldSpec).key).toBe(worleyNoise(opts).key);
    }
    // An output outside the shared list derives nothing and parses to
    // nothing — the two ends withhold together.
    const offGrammar = worleyNoise({ output: "f3" as WorleyNoiseOpts["output"] });
    expect(getFieldSpec(offGrammar)).toBeUndefined();
    expect(() => fieldFromJson({ fn: "worleyNoise", opts: { output: "f3" } })).toThrow(
      /output must be one of: f1, f2, f2-f1/,
    );
  });
});

describe("normalized noise contract", () => {
  const positions = gridPositions(13, 0.29); // 2197 samples
  const TOL = 1e-6; // the family's established range tolerance

  interface NormCase {
    name: string;
    make: (normalized: boolean, seed: number) => Field<1>;
    /** Documented range; fbm cases derive theirs from noiseOutputRange. */
    range?: readonly [number, number];
  }

  const NORM_CASES: NormCase[] = [
    {
      name: "value",
      make: (normalized, seed) => valueNoise({ seed, normalized }),
      range: NOISE_RAW_RANGES.valueNoise,
    },
    {
      name: "perlin",
      make: (normalized, seed) => perlinNoise({ seed, normalized }),
      range: NOISE_RAW_RANGES.perlinNoise,
    },
    {
      name: "simplex",
      make: (normalized, seed) => simplexNoise({ seed, normalized }),
      range: NOISE_RAW_RANGES.simplexNoise,
    },
    {
      name: "worley f1",
      make: (normalized, seed) => worleyNoise({ seed, normalized }),
      range: NOISE_RAW_RANGES.worleyNoise.f1,
    },
    {
      name: "worley f2",
      make: (normalized, seed) => worleyNoise({ seed, output: "f2", normalized }),
      range: NOISE_RAW_RANGES.worleyNoise.f2,
    },
    {
      name: "worley f2-f1",
      make: (normalized, seed) => worleyNoise({ seed, output: "f2-f1", normalized }),
      range: NOISE_RAW_RANGES.worleyNoise["f2-f1"],
    },
    {
      name: "fbm(perlin) 3 octaves",
      make: (normalized, seed) => fbm(perlinNoise, { seed, octaves: 3, normalized }),
    },
    {
      name: "fbm(value) gain 0.7",
      make: (normalized, seed) => fbm(valueNoise, { seed, octaves: 4, gain: 0.7, normalized }),
    },
  ];

  /** The case's documented range: explicit, or the field's own metadata. */
  function caseRange(c: NormCase, seed: number): readonly [number, number] {
    const range = c.range ?? noiseOutputRange(c.make(false, seed));
    if (!range) throw new Error(`case ${c.name}: no range`);
    return range;
  }

  describe.each(NORM_CASES)("$name", (c) => {
    it("raw output stays in the documented raw range across seeds", () => {
      for (const seed of [0, 5, 42]) {
        const [lo, hi] = caseRange(c, seed);
        const values = sample(c.make(false, seed), positions);
        for (let i = 0; i < values.length; i++) {
          expect(values[i]).toBeGreaterThanOrEqual(lo - TOL);
          expect(values[i]).toBeLessThanOrEqual(hi + TOL);
        }
      }
    });

    it("normalized output lands in [0, 1] and is exactly the affine image of raw", () => {
      for (const seed of [5, 21]) {
        const [lo, hi] = caseRange(c, seed);
        const span = hi - lo;
        const raw = sample(c.make(false, seed), positions);
        const norm = sample(c.make(true, seed), positions);
        for (let i = 0; i < raw.length; i++) {
          expect(norm[i]).toBeGreaterThanOrEqual(0 - TOL);
          expect(norm[i]).toBeLessThanOrEqual(1 + TOL);
          expect(norm[i]).toBe(Math.fround((raw[i] - lo) / span));
        }
      }
    });

    it("normalized and raw fields have distinct keys (cache correctness)", () => {
      expect(c.make(true, 5).key).not.toBe(c.make(false, 5).key);
    });
  });

  it("value noise normalization is the identity map (raw range is already [0, 1])", () => {
    const raw = sample(valueNoise({ seed: 3 }), positions);
    const norm = sample(valueNoise({ seed: 3, normalized: true }), positions);
    expect(Array.from(norm)).toEqual(Array.from(raw));
  });

  it("exposes machine-readable output ranges via noiseOutputRange", () => {
    expect(noiseOutputRange(valueNoise({ seed: 1 }))).toEqual([0, 1]);
    expect(noiseOutputRange(perlinNoise({ seed: 1 }))).toEqual([-1, 1]);
    expect(noiseOutputRange(simplexNoise({ seed: 1 }))).toEqual([-1, 1]);
    expect(noiseOutputRange(worleyNoise({ seed: 1 }))).toEqual([0, Math.sqrt(3)]);
    expect(noiseOutputRange(worleyNoise({ seed: 1, output: "f2" }))).toEqual([0, Math.sqrt(6)]);
    expect(noiseOutputRange(worleyNoise({ seed: 1, output: "f2-f1", exact: true }))).toEqual([
      0,
      Math.sqrt(6),
    ]);
    // Normalized fields report the [0, 1] contract.
    expect(noiseOutputRange(perlinNoise({ seed: 1, normalized: true }))).toEqual([0, 1]);
    // fbm reports its per-configuration amplitude-summed range.
    expect(noiseOutputRange(fbm(perlinNoise, { seed: 1, octaves: 3 }))).toEqual([-1.75, 1.75]);
    expect(noiseOutputRange(fbm(valueNoise, { seed: 1, octaves: 2, gain: 0.25 }))).toEqual([
      0, 1.25,
    ]);
    // Fields not built by a noise factory carry no range.
    expect(noiseOutputRange(mul(perlinNoise({ seed: 1 }), 2))).toBeUndefined();
  });

  it("fbm with normalized: true rejects a base without range metadata, actionably", () => {
    const rangeless: NoiseFactory = (opts) => mul(perlinNoise(opts), 1) as Field<1>;
    expect(() => fbm(rangeless, { normalized: true })).toThrow(/output-range metadata/);
    // Without normalized the same base is fine (range just stays unknown).
    expect(noiseOutputRange(fbm(rangeless, { octaves: 2 }))).toBeUndefined();
  });
});

describe("worley exact mode", () => {
  // The worley kind salt ("worl"); the effective sampler seed is
  // hash2(salt, seed), mirrored here for the brute-force reference.
  const WORLEY_SALT = 0x776f726c;

  /** f64 brute force over a Chebyshev-radius-4 block (9^3 cells) — more
   * than sufficient: features beyond ring r are at distance >= r-1, and
   * f2 <= sqrt(6) < 3. Same arithmetic as the implementation, so results
   * are bit-comparable after fround. */
  function bruteForce(seed: number, x: number, y: number, z: number): { f1: number; f2: number } {
    const s = hash2(WORLEY_SALT, seed >>> 0);
    const qx = Math.fround(x); // P storage rounds positions to f32
    const qy = Math.fround(y);
    const qz = Math.fround(z);
    const cx = Math.floor(qx);
    const cy = Math.floor(qy);
    const cz = Math.floor(qz);
    let f1 = Infinity;
    let f2 = Infinity;
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          const gz = cz + dz;
          const px = gx + hashFloat(hash5(s, gx, gy, gz, 0));
          const py = gy + hashFloat(hash5(s, gx, gy, gz, 1));
          const pz = gz + hashFloat(hash5(s, gx, gy, gz, 2));
          const ddx = px - qx;
          const ddy = py - qy;
          const ddz = pz - qz;
          const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return { f1, f2 };
  }

  /** Deterministic query mix: corner-adjacent (the known 3x3x3 failure
   * style), uniform, and near-cell-center points, spread over cells. */
  function queryPositions(seed: number, count: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < count; i++) {
      const kind = i % 3;
      for (let k = 0; k < 3; k++) {
        const cell = Math.floor(hashFloat(hashCombine(seed, i, k)) * 20) - 10;
        const u = hashFloat(hashCombine(seed, i, k + 3));
        const frac = kind === 0 ? 0.002 * u : kind === 1 ? u : 0.5 + 0.1 * (u - 0.5);
        pts.push(cell + frac);
      }
    }
    return pts;
  }

  it("equals brute force for f1, f2, and f2-f1 across seeds and query styles", () => {
    for (const seed of [0, 1, 2, 7, 123]) {
      const pts = queryPositions(seed, 120);
      const n = pts.length / 3;
      const f1 = sample(worleyNoise({ seed, output: "f1", exact: true }), pts);
      const f2 = sample(worleyNoise({ seed, output: "f2", exact: true }), pts);
      const diff = sample(worleyNoise({ seed, output: "f2-f1", exact: true }), pts);
      for (let i = 0; i < n; i++) {
        const b = bruteForce(seed, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
        expect(f1[i], `seed ${seed} pt ${i} f1`).toBe(Math.fround(b.f1));
        expect(f2[i], `seed ${seed} pt ${i} f2`).toBe(Math.fround(b.f2));
        expect(diff[i], `seed ${seed} pt ${i} f2-f1`).toBe(Math.fround(b.f2 - b.f1));
        expect(f2[i]).toBeGreaterThanOrEqual(f1[i]);
      }
    }
  });

  it("regression: the 3x3x3 approximation misses features the exact search finds", () => {
    // Found by scanning corner-adjacent queries; documents why `exact`
    // exists. Pinned from this implementation (f32-exact).
    const p = [-4.998670892715454, -8.998210570454598, -8.999643901944161];
    const approxF1 = sample(worleyNoise({ seed: 2, output: "f1" }), p)[0];
    const exactF1 = sample(worleyNoise({ seed: 2, output: "f1", exact: true }), p)[0];
    expect(approxF1).toBe(1.08261239528656);
    expect(exactF1).toBe(1.0463942289352417);
    expect(exactF1).toBeLessThan(approxF1);
    const approxF2 = sample(worleyNoise({ seed: 2, output: "f2" }), p)[0];
    const exactF2 = sample(worleyNoise({ seed: 2, output: "f2", exact: true }), p)[0];
    expect(approxF2).toBe(1.0957316160202026);
    expect(exactF2).toBe(1.08261239528656);
    // Both agree with brute force in exact mode.
    const b = bruteForce(2, p[0], p[1], p[2]);
    expect(exactF1).toBe(Math.fround(b.f1));
    expect(exactF2).toBe(Math.fround(b.f2));
  });

  it("keeps the approximate path bit-identical and keyed apart from exact", () => {
    const opts: WorleyNoiseOpts = { seed: 4, output: "f2" };
    expect(worleyNoise(opts).key).not.toBe(worleyNoise({ ...opts, exact: true }).key);
    expect(worleyNoise(opts).key).toBe(worleyNoise({ ...opts, exact: false }).key);
    // Away from cell corners the two modes agree.
    const pts = gridPositions(6, 0.5);
    const approx = sample(worleyNoise(opts), pts);
    const exact = sample(worleyNoise({ ...opts, exact: true }), pts);
    let agree = 0;
    for (let i = 0; i < approx.length; i++) {
      if (approx[i] === exact[i]) agree++;
      expect(exact[i]).toBeLessThanOrEqual(approx[i]); // exact can only shrink
    }
    expect(agree).toBeGreaterThan(approx.length * 0.99);
  });

  it("degrades non-finite positions to the approximate path's GIGO result instead of hanging", () => {
    // NaN/±Inf coordinates make every candidate distance NaN, which never
    // lowers f1/f2 — without the r = 3 ring cap the exact search would
    // expand forever. It must return promptly with the same Infinity/NaN
    // output the approximate path produces on identical input.
    const badPositions = [
      [NaN, 0, 0],
      [Infinity, 0, 0],
      [0, -Infinity, 2.5],
      [NaN, Infinity, -1],
    ];
    for (const p of badPositions) {
      for (const output of ["f1", "f2", "f2-f1"] as const) {
        const approx = sample(worleyNoise({ seed: 6, output }), p)[0];
        const exact = sample(worleyNoise({ seed: 6, output, exact: true }), p)[0];
        expect(exact, `p ${p.join(",")} ${output}`).toEqual(approx);
        // GIGO, not a number: Infinity for f1/f2, NaN for the difference.
        expect(Number.isFinite(exact)).toBe(false);
      }
    }
  });

  it("ring cap never alters finite-input results (still bit-equal to brute force)", () => {
    // Adversarial corner-adjacent points where the 3x3x3 block is wrong
    // and the expansion must still run to completion under the cap.
    const cases: Array<{ seed: number; p: number[] }> = [
      { seed: 2, p: [-4.998670892715454, -8.998210570454598, -8.999643901944161] },
      { seed: 0, p: [-1.998649707555771, -9.999446158885956, -4.998861848115921] },
      { seed: 1, p: [6.000710737228394, -7.9989544306993485, -6.999742455005646] },
      { seed: 1, p: [-2.9987929607629775, 0.00018293261528015136, 0.0008445199728012085] },
    ];
    for (const { seed, p } of cases) {
      const b = bruteForce(seed, p[0], p[1], p[2]);
      const f1 = sample(worleyNoise({ seed, output: "f1", exact: true }), p)[0];
      const f2 = sample(worleyNoise({ seed, output: "f2", exact: true }), p)[0];
      const diff = sample(worleyNoise({ seed, output: "f2-f1", exact: true }), p)[0];
      expect(f1, `seed ${seed} f1`).toBe(Math.fround(b.f1));
      expect(f2, `seed ${seed} f2`).toBe(Math.fround(b.f2));
      expect(diff, `seed ${seed} f2-f1`).toBe(Math.fround(b.f2 - b.f1));
    }
  });

  it("composes with normalized (bounds hold for the exact search too)", () => {
    const pts = queryPositions(9, 60);
    const raw = sample(worleyNoise({ seed: 9, output: "f2", exact: true }), pts);
    const norm = sample(worleyNoise({ seed: 9, output: "f2", exact: true, normalized: true }), pts);
    const [lo, hi] = NOISE_RAW_RANGES.worleyNoise.f2;
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBeGreaterThanOrEqual(lo);
      expect(raw[i]).toBeLessThanOrEqual(hi);
      expect(norm[i]).toBe(Math.fround((raw[i] - lo) / (hi - lo)));
      expect(norm[i]).toBeGreaterThanOrEqual(0);
      expect(norm[i]).toBeLessThanOrEqual(1);
    }
  });

  it("composes with fbm through a factory closure, including normalized", () => {
    const base: NoiseFactory = (opts) => worleyNoise({ ...opts, exact: true });
    const pts = gridPositions(8, 0.41);
    const raw = sample(fbm(base, { seed: 3, octaves: 2 }), pts);
    const again = sample(fbm(base, { seed: 3, octaves: 2 }), pts);
    expect(again).toEqual(raw);
    // Range metadata flows through the closure: f1 ∈ [0, √3] per octave.
    const rawField = fbm(base, { seed: 3, octaves: 2 });
    expect(noiseOutputRange(rawField)).toEqual([0, Math.sqrt(3) * 1.5]);
    const norm = sample(fbm(base, { seed: 3, octaves: 2, normalized: true }), pts);
    const hi = Math.sqrt(3) * 1.5;
    for (let i = 0; i < raw.length; i++) {
      expect(norm[i]).toBe(Math.fround(raw[i] / hi));
      expect(norm[i]).toBeGreaterThanOrEqual(0);
      expect(norm[i]).toBeLessThanOrEqual(1);
    }
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
        0.17185145616531372, -0.59765625, 0.21675285696983337, -0.46495112776756287,
        0.18732710182666779,
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

/**
 * `opts.seed: { from: "node", variant }` — the one non-numeric seed form.
 *
 * The contract is stated so it can be checked from OUTSIDE the library: a
 * node-seeded noise at evaluation seed `S` IS the noise a literal
 * `hashCombine(S, variant)` builds. Everything else here follows from
 * that one equation, which is why it is asserted per factory rather than
 * once — each of the five reaches the sampler by its own route, and fbm
 * reaches it once per octave.
 */
describe("node-derived noise seeds", () => {
  const POSITIONS = gridPositions(8, 0.7);
  const GRAPH_SEED = 0x51ed9a3b;

  /** Sample at an explicit evaluation seed (`cloudCtx` pins seed 0). */
  function sampleAt(field: Field, seed: number): Float32Array {
    const geo = createPointCloud(POSITIONS.length / 3);
    geo.attrs.point.require("P").data.set(POSITIONS);
    return evaluateField(field, { geo, domain: "point", seed }).data as Float32Array;
  }

  function correlation(a: Float32Array, b: Float32Array): number {
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) {
      ma += a[i];
      mb += b[i];
    }
    ma /= a.length;
    mb /= b.length;
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < a.length; i++) {
      cov += (a[i] - ma) * (b[i] - mb);
      va += (a[i] - ma) ** 2;
      vb += (b[i] - mb) ** 2;
    }
    return cov / Math.sqrt(va * vb);
  }

  const FACTORIES: Array<[string, NoiseFactory]> = [
    ["valueNoise", valueNoise],
    ["perlinNoise", perlinNoise],
    ["simplexNoise", simplexNoise],
    ["worleyNoise", worleyNoise],
    ["fbm(perlin)", (o) => fbm(perlinNoise, { ...o, octaves: 3 })],
    ["fbm(worley)", (o) => fbm(worleyNoise, { ...o, octaves: 3, lacunarity: 2.1, gain: 0.45 })],
  ];

  it.each(FACTORIES)(
    "%s: a variant is exactly the literal seed hashCombine(graphSeed, variant)",
    (_name, make) => {
      for (const variant of [0, 1, 7, 12345, 2 ** 24]) {
        const derived = sampleAt(
          make({ seed: { from: "node", variant }, frequency: 0.4 }),
          GRAPH_SEED,
        );
        const literal = sampleAt(
          make({ seed: hashCombine(GRAPH_SEED, variant), frequency: 0.4 }),
          GRAPH_SEED,
        );
        expect(Array.from(derived), `variant ${variant}`).toEqual(Array.from(literal));
      }
    },
  );

  it.each(FACTORIES)("%s: an omitted variant is variant 0", (_name, make) => {
    const implicit = sampleAt(make({ seed: { from: "node" }, frequency: 0.4 }), GRAPH_SEED);
    const explicit = sampleAt(
      make({ seed: { from: "node", variant: 0 }, frequency: 0.4 }),
      GRAPH_SEED,
    );
    expect(Array.from(implicit)).toEqual(Array.from(explicit));
  });

  it.each(FACTORIES)("%s: variant N and N+1 are different fields", (_name, make) => {
    for (const variant of [0, 1, 41]) {
      const a = sampleAt(make({ seed: { from: "node", variant }, frequency: 0.4 }), GRAPH_SEED);
      const b = sampleAt(
        make({ seed: { from: "node", variant: variant + 1 }, frequency: 0.4 }),
        GRAPH_SEED,
      );
      expect(Array.from(a), `variant ${variant} vs ${variant + 1}`).not.toEqual(Array.from(b));
    }
  });

  // The claim the position-shift idiom's rotating `K` constants had to be
  // chosen for (|r| ~ 0.003 rather than 0.339), now had for free: two
  // variants are two independent draws, not one draw wearing two hats.
  it("variants 0/1/2 on one node are uncorrelated", () => {
    // Its own, much wider sampling: the shared grid spans under two
    // lattice cells at these frequencies, where any two smooth fields
    // correlate and the measurement would be about the domain rather
    // than about the seeds.
    const wide = gridPositions(16, 1.3);
    const geo = createPointCloud(wide.length / 3);
    geo.attrs.point.require("P").data.set(wide);
    const columns = [0, 1, 2].map(
      (variant) =>
        evaluateField(perlinNoise({ seed: { from: "node", variant }, frequency: 1 }), {
          geo,
          domain: "point",
          seed: GRAPH_SEED,
        }).data as Float32Array,
    );
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      expect(Math.abs(correlation(columns[i], columns[j])), `variants ${i}/${j}`).toBeLessThan(0.06);
    }
  });

  // The second half is what proves the first can tell: a check that
  // reported "changed" for everything would pass the seed-response claim
  // without measuring it.
  it("the graph seed moves a node-seeded noise and not a literal-seeded one", () => {
    const derived = perlinNoise({ seed: { from: "node", variant: 3 }, frequency: 0.4 });
    expect(Array.from(sampleAt(derived, 101))).not.toEqual(Array.from(sampleAt(derived, 102)));
    const literal = perlinNoise({ seed: 3, frequency: 0.4 });
    expect(Array.from(sampleAt(literal, 101))).toEqual(Array.from(sampleAt(literal, 102)));
  });

  // The sampler is memoized on the last resolved seed, so a field
  // evaluated at two seeds and then back at the first must rebuild rather
  // than serve the second's sampler.
  it("re-evaluating at an earlier seed rebuilds that seed's sampler", () => {
    const field = valueNoise({ seed: { from: "node", variant: 2 }, frequency: 0.4 });
    const first = Array.from(sampleAt(field, 11));
    sampleAt(field, 22);
    expect(Array.from(sampleAt(field, 11))).toEqual(first);
  });

  // The key is fixed at construction while the seed arrives at
  // evaluation, so it names the REF. `n` prefixes it because a literal
  // seed spells itself as a bare decimal and the two must never collide.
  it("Field.key names the ref, and separates variants from literals", () => {
    expect(perlinNoise({ seed: { from: "node", variant: 3 } }).key).toContain("perlin(n3,");
    expect(perlinNoise({ seed: 3 }).key).toContain("perlin(3,");
    expect(perlinNoise({ seed: { from: "node", variant: 3 } }).key).not.toBe(
      perlinNoise({ seed: { from: "node", variant: 4 } }).key,
    );
  });

  it("the derived spec re-emits the ref", () => {
    expect(
      getFieldSpec(perlinNoise({ seed: { from: "node", variant: 3 }, frequency: 0.045 })),
    ).toEqual({
      fn: "perlinNoise",
      opts: { seed: { from: "node", variant: 3 }, frequency: 0.045, offset: [0, 0, 0] },
    });
    expect(getFieldSpec(fbm(worleyNoise, { seed: { from: "node", variant: 5 }, octaves: 2 }))).toEqual(
      {
        fn: "fbm",
        base: "worleyNoise",
        opts: {
          seed: { from: "node", variant: 5 },
          frequency: 1,
          offset: [0, 0, 0],
          octaves: 2,
          lacunarity: 2,
          gain: 0.5,
        },
      },
    );
  });

  // An omitted variant normalizes to 0 in the DERIVED spec, so what comes
  // back rebuilds the field that is already in hand.
  it("the derived spec normalizes an omitted variant to 0", () => {
    expect(getFieldSpec(valueNoise({ seed: { from: "node" } }))).toEqual({
      fn: "valueNoise",
      opts: { seed: { from: "node", variant: 0 }, frequency: 1, offset: [0, 0, 0] },
    });
  });

  // The ref object a caller keeps is theirs to mutate; a spec is not.
  it("the derived spec does not alias the ref it was given", () => {
    const ref = { from: "node", variant: 3 } as const;
    const spec = getFieldSpec(perlinNoise({ seed: ref })) as FieldSpec;
    expect((spec.opts as { seed: unknown }).seed).not.toBe(ref);
  });

  // A variant outside the parser's range could not be read back, so no
  // spec is derived rather than one that fails to reopen.
  it.each([[1.5], [-1], [2 ** 24 + 1]])("a variant of %s withholds the spec", (variant) => {
    const field = perlinNoise({ seed: { from: "node", variant } });
    expect(getFieldSpec(field)).toBeUndefined();
    expect(() => fieldToJson(field)).toThrow(
      /perlinNoise's `seed\.variant` must be an integer from 0 to 16777216/,
    );
  });

  // fbm's octave layers carry an internal ref with an `octave`, which has
  // no grammar form — so THEY withhold while the fbm itself does not, and
  // no unparseable spec ever escapes through the octave tree.
  it("an fbm's octave layers withhold their own spec, and the fbm does not", () => {
    expect(getFieldSpec(fbm(perlinNoise, { seed: { from: "node", variant: 2 }, octaves: 2 }))).toBeDefined();
    const octave = perlinNoise({ seed: { from: "node", variant: 2, octave: 1 } });
    expect(getFieldSpec(octave)).toBeUndefined();
    expect(() => fieldToJson(octave)).toThrow(
      /perlinNoise's per-octave `seed` ref is internal to fbm/,
    );
  });

  // An fbm over a base the grammar cannot name falls back to serializing
  // the octave tree it composed. A ref seed gives that up — the octave
  // layers withhold — so the refusal must name the BASE rather than trail
  // off into an octave's internal reason.
  it("fbm over a non-built-in base names the base once a ref seed removes the fallback", () => {
    const forwards: NoiseFactory = (o) => worleyNoise({ ...o, output: "f2" });
    expect((fieldToJson(fbm(forwards, { seed: 7, octaves: 2 })) as FieldSpec).fn).toBe("add");
    expect(() =>
      fieldToJson(fbm(forwards, { seed: { from: "node", variant: 7 }, octaves: 2 })),
    ).toThrow(/fbm's `base` is not one of the built-in noise factories/);
  });
});
