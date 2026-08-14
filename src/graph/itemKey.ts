/**
 * ITEM IDENTITY: a permutation-stable name for one element of a collection.
 *
 * This is `src/data/identity.ts` one level up. That module says array index
 * is not a name for a POINT, because the same world point lands at a
 * different index depending on which query produced it. The same is true of
 * an ITEM: `partitionByAttribute` emits its groups in first-occurrence
 * order, `assembleInputs` concatenates in connection order, and a
 * `dataInput` binding is whatever the host passed this frame. None of those
 * orders is supposed to change what a group generates, so a `forEach` that
 * seeded iteration k on k would re-roll every group whenever an upstream
 * filter moved one of them.
 *
 * So an iteration is seeded on what its item CONTAINS, never on where it
 * sat. For a geometry that is the multiset of its point identities, folded
 * in sorted order — sorted because the item's own point order must not
 * matter either, and a `forEach` body that permutes its input would
 * otherwise re-roll one level up. XOR would be the cheaper fold and is
 * wrong: it cancels duplicates, and `snapToGrid` manufactures coincident
 * points deliberately.
 *
 * TAGS PARTICIPATE, and they are memo-safe. `partitionByAttribute` records
 * the group value nowhere else — `name=value` on the item is the only place
 * an author's meaning survives (`src/nodes/attributes.ts`) — and a tag
 * change always mints a fresh `rev` (`makeGeometryItem`), so the executor's
 * rev-keyed `inputSig` already covers every tag edit. Nothing here needs the
 * memo key widened.
 *
 * WHAT COLLIDES, stated plainly for the same reason `identity.ts` states
 * its version: `pointIdentities` reads position bits and the `seed`
 * attribute and nothing else, so two items whose points agree on those and
 * whose tags agree are the same item as far as this is concerned, however
 * their other attribute columns differ. Their OUTPUTS still differ — the
 * body reads the real geometry — but their randomness is correlated. From
 * `partitionByAttribute` this is unreachable, since groups are disjoint
 * point sets. It is constructible by hand, and a caller that cannot tolerate
 * it should give its items distinct tags. Deep-hashing every column instead
 * would contradict this library's standing rule that data is never
 * deep-hashed, and cost a full pass per cook to buy very little.
 *
 * Internal: not re-exported from `src/index.ts`, for the same reason
 * `pointIdentities` is not.
 */
import { pointIdentities } from "../data/identity.js";
import { hashCombine, hashString } from "../random/hash.js";
import type { DataItem, DataValue, GeometryItem } from "./data.js";

/** Domain salts, so a value item and a geometry never share a key by luck. */
const GEOMETRY_SALT = hashString("pcg:item/geometry");
const VALUE_SALT = hashString("pcg:item/value");
const POINT_SALT = hashString("pcg:item/point");

/**
 * Fold a tag set into one u32, independent of iteration order.
 *
 * `Set` iterates in insertion order, and two items carrying the same tags
 * added in a different order are the same item — so the names are sorted
 * before folding rather than trusted as they arrive.
 */
function tagDigest(tags: ReadonlySet<string>): number {
  if (tags.size === 0) return 0;
  const names = [...tags].sort();
  let h = hashCombine(names.length);
  for (const name of names) h = hashCombine(h, hashString(name));
  return h;
}

/**
 * Fold per-point identities in sorted order — the multiset of points,
 * without their arrangement.
 *
 * The copy is deliberate: `pointIdentities` allocates fresh, but sorting in
 * place would still be sorting a buffer the caller may hold. Typed-array
 * `sort` is numeric by default, so no comparator closure runs per compare.
 */
function foldIdentities(ids: Uint32Array): number {
  const sorted = ids.slice().sort();
  let h = hashCombine(sorted.length);
  for (let i = 0; i < sorted.length; i++) h = hashCombine(h, sorted[i]);
  return h;
}

/**
 * A canonical digest of a plain value.
 *
 * Routed through the DECIMAL STRING rather than through `hashCombine`
 * directly, because `hashCombine` interprets its arguments modulo 2^32 —
 * every value in `(-1, 1)` would truncate to zero and collide. `String(n)`
 * round-trips a double exactly, so this is total and lossless where a
 * numeric fold would not be. `-0` and `0` render alike and therefore
 * collide, which is correct: they are the same value.
 */
function valueDigest(value: DataValue): number {
  if (typeof value === "string") return hashCombine(hashString("s"), hashString(value));
  if (typeof value === "boolean") return hashCombine(hashString("b"), value ? 1 : 0);
  if (typeof value === "number") return hashCombine(hashString("n"), hashString(String(value)));
  let h = hashCombine(hashString("a"), value.length);
  for (let i = 0; i < value.length; i++) h = hashCombine(h, hashString(String(value[i])));
  return h;
}

/**
 * The identity of one item, for `who` to seed an iteration on.
 *
 * `who` names the caller in the error, so an author reads the node they
 * have to fix rather than the internal that noticed.
 */
export function itemKey(item: DataItem, who: string): number {
  switch (item.kind) {
    case "geometry":
      return hashCombine(
        GEOMETRY_SALT,
        tagDigest(item.tags),
        item.geo.pointCount,
        foldIdentities(pointIdentities(item.geo, who)),
      );
    case "value":
      return hashCombine(VALUE_SALT, tagDigest(item.tags), valueDigest(item.value));
    case "instances":
      throw new Error(
        `${who}: cannot iterate an instances item. Instance batches are a terminal render payload — ` +
          "spawnInstances is the end of a chain, not something with elements to walk" +
          (item.deviceBatches === undefined
            ? ""
            : ", and this one is device-resident, so its transforms were never composed on the CPU at all") +
          ". Iterate the points BEFORE they are spawned, and spawn inside the body.",
      );
  }
}

/**
 * The identity of one POINT of an item, for the per-point iteration mode.
 *
 * Salted apart from {@link itemKey} so a one-point geometry iterated as an
 * item and the same point iterated per-point do not seed alike — they are
 * different requests and a caller comparing the two should see two answers.
 *
 * The whole column is computed once by the caller and indexed here; this
 * takes the identity rather than the geometry so a K-point iteration does
 * not recompute K identity columns.
 */
export function pointItemKey(identity: number, tags: ReadonlySet<string>): number {
  return hashCombine(POINT_SALT, tagDigest(tags), identity);
}

/**
 * Per-point identities of `item`, for the per-point iteration mode.
 *
 * Exists so `forEach` does not import `src/data/identity.js` itself — the
 * identity rule for an iteration lives in one file.
 */
export function pointIdentityColumn(item: GeometryItem, who: string): Uint32Array {
  return pointIdentities(item.geo, who);
}
