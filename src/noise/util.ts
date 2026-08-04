import {
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  makeField,
  position,
  resolveField,
} from "../fields/index.js";
import { hashFinalize, hashMix, hashSeed } from "../random/hash.js";

/** Options shared by all noise fields. */
export interface NoiseOpts {
  /**
   * Integer seed. Noise is a pure function of (seed, sample position) —
   * the field context seed does not affect it; derive per-node seeds
   * with `hashCombine` when needed. Default 0.
   */
  seed?: number;
  /** Uniform scale applied to positions before sampling. Default 1. */
  frequency?: number;
  /** Offset added after scaling (in noise space). Default [0, 0, 0]. */
  offset?: readonly [number, number, number];
  /** Position input field (tuple 3). Defaults to `position()`. */
  position?: FieldLike;
}

/** A noise constructor usable as an fbm base (e.g. `perlinNoise`). */
export type NoiseFactory = (opts?: NoiseOpts) => Field<1>;

/** Fixed-arity hashCombine(a, b): identical output, no rest-array alloc. */
export function hash2(a: number, b: number): number {
  return hashFinalize(hashMix(hashMix(hashSeed(2), a), b));
}

/** Fixed-arity hashCombine(a, b, c, d) for per-cell lattice hashing. */
export function hash4(a: number, b: number, c: number, d: number): number {
  return hashFinalize(hashMix(hashMix(hashMix(hashMix(hashSeed(4), a), b), c), d));
}

/** Fixed-arity hashCombine(a, b, c, d, e) for salted per-cell hashing. */
export function hash5(a: number, b: number, c: number, d: number, e: number): number {
  return hashFinalize(hashMix(hashMix(hashMix(hashMix(hashMix(hashSeed(5), a), b), c), d), e));
}

/** Quintic fade curve 6t^5 - 15t^4 + 10t^3 (C2-continuous at lattice planes). */
export function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Scalar linear interpolation. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The 12 cube-edge gradient directions (components -1/0/1, length √2),
 * flat xyz triplets.
 */
export const GRAD3: Float32Array = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

/**
 * Build a noise Field from per-sample logic: resolves the position input,
 * applies frequency/offset, and evaluates `sample` per element into an
 * f32 scalar column. `kindSalt` decorrelates noise types sharing a seed;
 * the effective seed passed to `makeSampler` is `hash2(kindSalt, seed)`.
 */
export function makeNoiseField(
  kind: string,
  kindSalt: number,
  opts: NoiseOpts,
  makeSampler: (seed: number) => (x: number, y: number, z: number) => number,
): Field<1> {
  const seed = (opts.seed ?? 0) >>> 0;
  const frequency = opts.frequency ?? 1;
  const [ox, oy, oz] = opts.offset ?? [0, 0, 0];
  const pos = resolveField(opts.position ?? position());
  const key = `${kind}(${seed},${frequency},${ox},${oy},${oz};${pos.key})`;
  const sample = makeSampler(hash2(kindSalt, seed));
  return makeField(key, 1, (ctx) => {
    const posCol = evaluateField(pos, ctx);
    if (posCol.tupleSize !== 3) {
      throw new Error(`${kind}: position field must have tupleSize 3, got ${posCol.tupleSize}`);
    }
    const n = elementCount(ctx);
    const p = posCol.data;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = sample(
        p[i * 3] * frequency + ox,
        p[i * 3 + 1] * frequency + oy,
        p[i * 3 + 2] * frequency + oz,
      );
    }
    return { data: out, tupleSize: 1 };
  });
}
