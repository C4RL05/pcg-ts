/**
 * Point IDENTITY: a permutation-stable name for a point.
 *
 * Array index is not one. The same world point lands at a different index
 * depending on which query produced it, so anything keyed on index — a
 * probabilistic acceptance, a jitter offset, a greedy tiebreak — answers
 * differently after a shuffle, a filter upstream, or a cell cooked with a
 * halo. Every one of those is a reordering, and none of them is supposed
 * to move a point.
 *
 * The identity of a point is `hashCombine(bits(Px), bits(Py), bits(Pz),
 * seed)`: the u32 bit patterns of its stored f32 position components,
 * plus its standard per-point `seed` attribute. BOTH halves are load
 * bearing:
 *
 * - `seed` alone is not enough. It defaults to 0 for hand-built and
 *   `dataInput` clouds, `mergePoints` fills the default over an input's
 *   whole range when that input had no seed column, and `copyToPoints`
 *   collides across copies of a zero-seed source.
 * - Position alone is not enough. Coincident points collide, and
 *   `snapToGrid` deliberately manufactures them.
 *
 * Bits, never the float value: `hashCombine` interprets its arguments
 * modulo 2^32, so a float is truncated toward zero and every position
 * inside the unit cube would hash to the same identity.
 *
 * Consequence worth stating plainly, because it is the one surprise here:
 * two points that agree on position AND seed are the SAME point as far as
 * identity is concerned, and every identity-keyed decision treats them
 * identically. A cloud straight out of `createPointCloud` — every P at the
 * origin, every seed 0 — is one point repeated, and identity-keyed
 * randomness over it is constant. Real clouds get distinct positions and
 * per-point seeds from their source; hand-built ones must too.
 *
 * Internal: deliberately NOT re-exported from `src/data/index.ts`, and so
 * not part of the package surface, for the same reason `src/spatial` is
 * not re-exported from `src/index.ts`.
 */
import { hashFinalize, hashMix, hashSeed } from "../random/hash.js";
import type { Geometry } from "./geometry.js";

/** Scratch for reinterpreting a number as the f32 that would be stored. */
const F32_SCRATCH = new Float32Array(1);
const F32_SCRATCH_BITS = new Uint32Array(F32_SCRATCH.buffer);

/**
 * The u32 bit pattern of `x` rounded to f32 — what `hashCombine` must
 * receive for a coordinate, since it truncates a float toward zero.
 */
export function f32Bits(x: number): number {
  F32_SCRATCH[0] = x;
  return F32_SCRATCH_BITS[0];
}

/**
 * Per-point identity hashes over `geo`'s point domain, one u32 per point
 * in point order (SoA: one allocation, no per-point objects).
 *
 * `who` names the caller in the two error messages, so an author reads
 * the node they have to fix rather than the internal that noticed.
 *
 * A missing `seed` column contributes 0, which is exactly what a column
 * of defaults would contribute — a cloud with no seeds and a cloud with
 * all-zero seeds are the same cloud, and both rest their identity on
 * position alone.
 */
export function pointIdentities(geo: Geometry, who: string): Uint32Array {
  const set = geo.attrs.point;
  const n = set.count;
  const out = new Uint32Array(n);
  if (n === 0) return out;
  const P = set.get("P");
  if (!P || P.type === "string" || P.tupleSize < 3) {
    throw new Error(
      `${who}: per-point randomness is keyed on point IDENTITY (position bits + the seed attribute), ` +
        `so the input needs a numeric point attribute "P" with x, y and z (tupleSize 3); ` +
        (P === undefined
          ? `available: ${set.names().join(", ") || "(none)"}`
          : `got ${P.type} tupleSize ${P.tupleSize}`) +
        ". Every point cloud in this library carries P — something upstream removed it or overwrote it with a narrower attribute.",
    );
  }
  const seedAttr = set.get("seed");
  if (seedAttr && (seedAttr.type === "string" || seedAttr.tupleSize !== 1)) {
    throw new Error(
      `${who}: the standard point attribute "seed" must be a numeric scalar (u32, tupleSize 1) — ` +
        `it is part of every point's identity — but this input has it as ${seedAttr.type} tupleSize ${seedAttr.tupleSize}. ` +
        "Rename that column with setAttribute, or removeAttribute it if it is dead.",
    );
  }
  const pd = P.data;
  const ps = P.tupleSize;
  const sd = seedAttr?.data;
  // f32 storage is reinterpreted in place rather than round-tripped
  // through the scratch: same bits, no per-coordinate copy. Any other
  // numeric storage goes the slow way, which rounds to f32 exactly as
  // storing the value would have.
  const bits =
    pd instanceof Float32Array ? new Uint32Array(pd.buffer, pd.byteOffset, pd.length) : undefined;
  for (let i = 0; i < n; i++) {
    const o = i * ps;
    // Inlined hashCombine(bx, by, bz, seed): the variadic form allocates a
    // rest array per call, and this runs once per point.
    let h = hashSeed(4);
    h = hashMix(h, bits === undefined ? f32Bits(pd[o]) : bits[o]);
    h = hashMix(h, bits === undefined ? f32Bits(pd[o + 1]) : bits[o + 1]);
    h = hashMix(h, bits === undefined ? f32Bits(pd[o + 2]) : bits[o + 2]);
    h = hashMix(h, sd === undefined ? 0 : sd[i] >>> 0);
    out[i] = hashFinalize(h);
  }
  return out;
}

/**
 * Visit order for an identity-keyed greedy: point indices sorted by
 * identity ascending, ties (points that agree on position AND seed, hence
 * indistinguishable) broken by the lower index so the order stays total
 * and reproducible.
 */
export function identityOrder(ident: Uint32Array): Uint32Array {
  const order = new Uint32Array(ident.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => ident[a] - ident[b] || a - b);
  return order;
}
