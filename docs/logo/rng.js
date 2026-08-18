/**
 * Hash-keyed randomness, the same construction the library uses.
 *
 * Inlined rather than imported: this page has no build step and no
 * node_modules, and it needs exactly two functions. They are ports of
 * `hashCombine` / `hashFloat` from pcg-ts `src/random/hash.ts` — if that
 * ever changes, this is the thing to re-check.
 *
 * The point of hashing over a stream: a value is keyed by WHAT it is for
 * (this cell, this flip) rather than by how many numbers have been drawn
 * before it. Nothing accumulates, so time can be scrubbed backwards and
 * every frame is reproducible from `(seed, t)` alone.
 */

const mix = (h, value) => {
  let x = (h ^ Math.imul(value | 0, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

/** Combine any number of integer keys into one 32-bit hash. */
export function hashCombine(...values) {
  let h = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) h = mix(h, Math.floor(values[i]));
  return h >>> 0;
}

/** A hash as a float in [0, 1). */
export function hashFloat(h) {
  return (h >>> 8) * 2 ** -24;
}

/** The one call site shape everything here uses. */
export const rnd = (...key) => hashFloat(hashCombine(...key));
