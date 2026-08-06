/**
 * Deterministic 32-bit hashing (murmur3-style) for seed derivation:
 * graph seed, node seed, cell coords, point index, and so on. Pure
 * integer math — identical results across runs and platforms.
 */

// Murmur3 constants, exported as the single source of truth so the WGSL
// port (src/gpu) serializes these exact values instead of duplicating
// literals that could drift.

/** Murmur3 mix-round first multiplier (c1). */
export const HASH_MIX_MUL1 = 0xcc9e2d51;
/** Murmur3 mix-round rotate amount for the folded value (r1). */
export const HASH_MIX_ROT1 = 15;
/** Murmur3 mix-round second multiplier (c2). */
export const HASH_MIX_MUL2 = 0x1b873593;
/** Murmur3 mix-round rotate amount for the running hash (r2). */
export const HASH_MIX_ROT2 = 13;
/** Murmur3 mix-round hash multiplier (m). */
export const HASH_MIX_ROUND_MUL = 5;
/** Murmur3 mix-round hash addend (n). */
export const HASH_MIX_ROUND_ADD = 0xe6546b64;
/** Murmur3 finalizer (fmix32) first xor-shift amount. */
export const HASH_FINAL_SHIFT1 = 16;
/** Murmur3 finalizer (fmix32) first multiplier. */
export const HASH_FINAL_MUL1 = 0x85ebca6b;
/** Murmur3 finalizer (fmix32) second xor-shift amount. */
export const HASH_FINAL_SHIFT2 = 13;
/** Murmur3 finalizer (fmix32) second multiplier. */
export const HASH_FINAL_MUL2 = 0xc2b2ae35;
/** Murmur3 finalizer (fmix32) final xor-shift amount. */
export const HASH_FINAL_SHIFT3 = 16;
/** hashSeed basis (golden-ratio constant). */
export const HASH_SEED_BASIS = 0x9e3779b9;
/** hashSeed length multiplier (shared with the fmix32 first multiplier). */
export const HASH_SEED_MUL = 0x85ebca6b;
/** hashFloat scale: 2^-24, mapping the top 24 hash bits into [0, 1). */
export const HASH_FLOAT_SCALE = 2 ** -24;

/** One murmur3 mix round: fold a 32-bit value into the running hash. */
export function hashMix(h: number, value: number): number {
  let k = value >>> 0;
  k = Math.imul(k, HASH_MIX_MUL1);
  k = (k << HASH_MIX_ROT1) | (k >>> (32 - HASH_MIX_ROT1));
  k = Math.imul(k, HASH_MIX_MUL2);
  h = (h ^ k) >>> 0;
  h = (h << HASH_MIX_ROT2) | (h >>> (32 - HASH_MIX_ROT2));
  h = (Math.imul(h, HASH_MIX_ROUND_MUL) + HASH_MIX_ROUND_ADD) >>> 0;
  return h;
}

/** Murmur3 finalizer (fmix32): avalanche the running hash into a u32. */
export function hashFinalize(h: number): number {
  h ^= h >>> HASH_FINAL_SHIFT1;
  h = Math.imul(h, HASH_FINAL_MUL1);
  h ^= h >>> HASH_FINAL_SHIFT2;
  h = Math.imul(h, HASH_FINAL_MUL2);
  h ^= h >>> HASH_FINAL_SHIFT3;
  return h >>> 0;
}

/** Initial hash state for a value sequence of the given length. */
export function hashSeed(count: number): number {
  return (HASH_SEED_BASIS ^ Math.imul(count, HASH_SEED_MUL)) >>> 0;
}

/**
 * Combine values into one well-mixed unsigned 32-bit hash. Values are
 * interpreted modulo 2^32 (negatives wrap, floats truncate toward zero).
 * The sequence length is part of the hash, so `(1)` and `(1, 0)` differ.
 */
export function hashCombine(...values: number[]): number {
  let h = hashSeed(values.length);
  for (let i = 0; i < values.length; i++) h = hashMix(h, values[i]);
  return hashFinalize(h);
}

/**
 * Map a 32-bit hash to a float in [0, 1). Uses the top 24 bits, so the
 * result is exactly representable as an f32 and stays < 1 when stored
 * in a Float32Array.
 */
export function hashFloat(hash: number): number {
  return (hash >>> 8) * HASH_FLOAT_SCALE;
}

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
