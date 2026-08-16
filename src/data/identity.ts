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
 * A PRIMITIVE gets its name the same way, from the same place: it is the
 * order-independent fold of its own points' identities
 * ({@link primitiveIdentities}), so it too survives a reordering and moves
 * only when its points move. The vertex domain has no identity here and no
 * caller asking for one — a vertex is a point AND a position within a
 * primitive, which is a different question from either of these.
 *
 * Internal: deliberately NOT re-exported from `src/data/index.ts`, and so
 * not part of the package surface, for the same reason `src/spatial` is
 * not re-exported from `src/index.ts`.
 */
import { hashCombine, hashFinalize, hashMix, hashSeed } from "../random/hash.js";
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
 * Fold a run of identities in sorted order — the MULTISET of them, without
 * their arrangement.
 *
 * Sorted because the arrangement must not matter: an edge and its reverse
 * are one edge, and an item whose points a caller permuted is one item. XOR
 * would be the cheaper fold and is wrong — it cancels duplicates, and
 * coincident points are manufactured deliberately (`snapToGrid`), so a
 * two-vertex primitive over one repeated point would fold to the same digest
 * as an empty one. The length seeds the fold, so runs agreeing on a prefix
 * cannot collide either.
 *
 * The copy is deliberate: the identity columns are allocated fresh, but
 * sorting in place would still be sorting a buffer the caller may hold.
 * Typed-array `sort` is numeric by default, so no comparator closure runs
 * per compare.
 *
 * Shared with `src/graph/itemKey.ts`, whose item key is this same fold over
 * a whole geometry's points. It lives HERE because identity is this module's
 * subject and `itemKey.ts` already imports this file — the dependency only
 * runs one way.
 */
export function foldIdentities(ids: Uint32Array): number {
  const sorted = ids.slice().sort();
  let h = hashCombine(sorted.length);
  for (let i = 0; i < sorted.length; i++) h = hashCombine(h, sorted[i]);
  return h;
}

/**
 * Per-primitive identity hashes over `geo`'s primitive domain, one u32 per
 * primitive in primitive order (SoA: one allocation, no per-primitive
 * objects).
 *
 * A primitive is named by ITS OWN POINTS: the order-independent fold
 * ({@link foldIdentities}) of the identities of the points its vertices
 * reference. The array index is not a name here for the same reason it is
 * not one for a point — a faster neighbour query, a filter upstream, or a
 * cell cooked with a halo all re-emit the same primitives in a different
 * order, and none of those is supposed to change what a primitive generates.
 *
 * Its OWN points, never a parent's, although `sweepProfile` and
 * `extrudePolygon` do carry a `primSrc` back to the primitive they came
 * from and keying on that is tempting: a cell may hold a derived primitive
 * whose parent lies outside it, and then there is no parent identity to
 * read. Own points are present by construction.
 *
 * Consequence worth stating plainly, in the same voice {@link
 * pointIdentities} states its own: two primitives over the same point SET
 * are the SAME primitive here, whatever their vertex order — a quad ABCD and
 * a quad ABDC collide. The related case is the one that has to work and is
 * why the fold is order-independent at all: an edge and its reverse are one
 * edge. Separating ABDC from ABCD would want a canonical CYCLIC sequence
 * instead (rotate to the smallest identity, then take the lexicographically
 * smaller of the two directions), which distinguishes the two quads and
 * still agrees on an edge and its reverse. Deferred until a caller needs it,
 * and named here so it is not re-derived from scratch.
 *
 * `who` names the caller in the errors {@link pointIdentities} raises.
 */
export function primitiveIdentities(geo: Geometry, who: string): Uint32Array {
  const n = geo.primitiveCount;
  const out = new Uint32Array(n);
  if (n === 0) return out;
  // `setTopology` is the only thing that resizes the primitive domain, so
  // these agree for every geometry built through the API. A hand-built one
  // that resized the attribute set directly would silently hand every
  // primitive an empty vertex range, and so one identity repeated.
  if (geo.primVertexCount.length !== n) {
    throw new Error(
      `${who}: per-primitive randomness is keyed on primitive IDENTITY (the fold of its own points' identities), ` +
        `so the primitive domain's ${n} elements need matching topology, but this geometry carries ` +
        `${geo.primVertexCount.length} vertex ranges. Build the topology with setTopology (or setPolylineTopology), ` +
        "which sizes the primitive attributes to match, rather than resizing the primitive attribute set on its own.",
    );
  }
  const point = pointIdentities(geo, who);
  const v2p = geo.vertexToPoint;
  const start = geo.primVertexStart;
  const count = geo.primVertexCount;
  // One scratch buffer grown to the widest primitive so far, viewed per
  // primitive: `foldIdentities` copies before it sorts, so gathering into a
  // fresh array here would allocate twice per primitive instead of once.
  let scratch = new Uint32Array(0);
  for (let p = 0; p < n; p++) {
    const k = count[p];
    if (k > scratch.length) scratch = new Uint32Array(k);
    const s = start[p];
    for (let i = 0; i < k; i++) scratch[i] = point[v2p[s + i]];
    out[p] = foldIdentities(scratch.subarray(0, k));
  }
  return out;
}

/**
 * CANONICAL POINT ORDER: rank `r[i]` is point `i`'s position in an order
 * fixed by the POINTS, not by the array they arrived in. It answers the
 * questions a derived structure cannot leave to arrival order — which of a
 * pair leads, and what order the results come out in.
 *
 * The key is identity ({@link pointIdentities}), then the raw position bits
 * per axis, then `seed`, then — only for two points that agree on ALL of
 * that — the array index.
 *
 * A weaker order that falls back to the index on any 32-bit identity
 * COLLISION is not enough, and the difference is why this lives here rather
 * than in the node that needed it first. A collision is independent of
 * position, so two windows holding a colliding pair at different array
 * indices would disagree about which point leads, and whatever is derived
 * from the pair would be emitted twice or not at all across the seam.
 * Adding the position bits and `seed` after the hash removes that: the
 * order is now total except between points that are byte-identical in
 * position AND seed, which this module already treats as the SAME point.
 * Such a pair is necessarily coincident, so one window owns both and the
 * index fallback cannot straddle a seam.
 *
 * `who` names the caller in the errors {@link pointIdentities} raises.
 */
export function canonicalPointRanks(geo: Geometry, who: string): Uint32Array {
  const set = geo.attrs.point;
  const n = set.count;
  const rank = new Uint32Array(n);
  if (n === 0) return rank;
  // Validates P and `seed` before either is read below.
  const ident = pointIdentities(geo, who);
  const P = set.require("P");
  const pd = P.data;
  const ps = P.tupleSize;
  const bx = new Uint32Array(n);
  const by = new Uint32Array(n);
  const bz = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * ps;
    bx[i] = f32Bits(pd[o]);
    by[i] = f32Bits(pd[o + 1]);
    bz[i] = f32Bits(pd[o + 2]);
  }
  const seedAttr = set.get("seed");
  // A missing seed column contributes 0 for every point, exactly as it
  // does inside pointIdentities: no seeds and all-zero seeds are the same
  // cloud, and both rest their order on position.
  const sd = seedAttr && seedAttr.type !== "string" ? seedAttr.data : undefined;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort(
    (a, b) =>
      ident[a] - ident[b] ||
      bx[a] - bx[b] ||
      by[a] - by[b] ||
      bz[a] - bz[b] ||
      (sd === undefined ? 0 : (sd[a] >>> 0) - (sd[b] >>> 0)) ||
      a - b,
  );
  for (let k = 0; k < n; k++) rank[order[k]] = k;
  return rank;
}
