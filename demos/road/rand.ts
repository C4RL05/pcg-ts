/**
 * The placement stream's hash.
 *
 * ITS OWN MODULE BECAUSE EVERY RULE DRAWS FROM ONE STREAM. A second
 * generator would make a marker's position depend on which module asked
 * for it, and the whole demo is a determinism claim. It lived in
 * `assets.ts` and was then copied verbatim into `zones.ts` — which
 * `assets.ts` imports, so the copy could not simply be deleted in favour
 * of an import without closing a cycle. Sitting below both, it can be the
 * one definition the comment above always claimed it was.
 *
 * NOT `hashCombine`/`hashFloat` from the library, though it should be.
 * Those are the right primitives and `stations.ts` already uses them; the
 * swap is deferred only because their mix differs from this one, so every
 * generated layout would move and every measured figure in the suite with
 * it. That is a re-baselining, not a cleanup.
 */
export function rand(seed: number, index: number, salt: number): number {
  let h = (seed * 0x9e3779b1 + index * 0x85ebca6b + salt * 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}
