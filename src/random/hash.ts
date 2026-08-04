/**
 * Deterministic 32-bit hashing (murmur3-style) for seed derivation:
 * graph seed, node seed, cell coords, point index, and so on. Pure
 * integer math — identical results across runs and platforms.
 */

/** One murmur3 mix round: fold a 32-bit value into the running hash. */
export function hashMix(h: number, value: number): number {
  let k = value >>> 0;
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h = (h ^ k) >>> 0;
  h = (h << 13) | (h >>> 19);
  h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  return h;
}

/** Murmur3 finalizer (fmix32): avalanche the running hash into a u32. */
export function hashFinalize(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Initial hash state for a value sequence of the given length. */
export function hashSeed(count: number): number {
  return (0x9e3779b9 ^ Math.imul(count, 0x85ebca6b)) >>> 0;
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
  return (hash >>> 8) * 2 ** -24;
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
