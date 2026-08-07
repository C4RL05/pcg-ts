/**
 * The asset-grouping ordering spec, in ONE implementation.
 *
 * Both spawner paths consume this function: the CPU spawner
 * ({@link buildInstanceBatches}) and the device-resident run
 * (`src/gpu/run.ts`, which uploads {@link AssetGrouping.perm} and
 * composes one output buffer per batch). The two therefore agree on
 * batch order, batch membership, and within-batch order *by
 * construction* rather than by comparison — the device path never
 * re-derives the spec, so it cannot drift from it.
 *
 * The spec, normatively:
 *
 * - **Key resolution.** With no `assetAttr` every point resolves to
 *   `defaultAssetId`. With one, point `i` resolves to
 *   `attr.getString(i)` — component 0 only, whatever the tuple size —
 *   and the empty string (including an out-of-range string-table index,
 *   which reads as `""`) resolves to `defaultAssetId`. The map from
 *   string-table index to asset id is therefore NOT injective: `""` and
 *   a literal entry equal to `defaultAssetId` are the same asset and
 *   must land in the same batch. Grouping keys are always *resolved* ids
 *   remapped to a dense index, never raw table indices.
 * - **Batch order** is ascending first-occurrence point index of each
 *   distinct resolved id. Not table order, not intern order, not
 *   lexicographic — so a recook whose string table interned in a
 *   different order still produces the same batch order.
 * - **Within a batch**, instances are in ascending original point index.
 *   Equivalently: the whole thing is a stable partition by resolved key.
 * - **Zero points produce zero batches**, in constant mode too. An asset
 *   present in the string table but on no point produces no batch:
 *   groups are built from points, never from the table.
 *
 * Two conditions throw, and they are part of the agent-facing API: a
 * missing `assetAttr` (the message lists the string attributes that ARE
 * present) and an `assetAttr` naming a non-string attribute. The
 * resident-run planner rejects both at plan time instead, so the CPU
 * path serves and raises exactly these messages.
 */
import type { Geometry } from "../data/index.js";

/** Options for {@link groupPointsByAsset}. */
export interface AssetGroupingOptions {
  /** Asset id every point not overridden by `assetAttr` resolves to. */
  readonly defaultAssetId: string;
  /**
   * Name of a string point attribute holding per-point asset ids.
   * Undefined or empty selects constant mode (one batch).
   */
  readonly assetAttr?: string;
}

/**
 * A stable partition of the point domain by resolved asset id, in the
 * order the spec above fixes.
 *
 * `order`, `counts` and `offsets` are parallel and have one entry per
 * batch; `perm` is the concatenation of the batches' point-index lists,
 * so batch `j` covers `perm[offsets[j] .. offsets[j] + counts[j])` and
 * `perm` is always a permutation of `0 .. n-1`.
 */
export interface AssetGrouping {
  /** Resolved asset ids, in batch order. */
  readonly order: readonly string[];
  /** Points in each batch. Always > 0 — batches come from points. */
  readonly counts: Uint32Array;
  /** Start of each batch inside {@link perm} (exclusive prefix sum of counts). */
  readonly offsets: Uint32Array;
  /** Stable-partition permutation: source point index per instance slot. */
  readonly perm: Uint32Array;
}

/** The identity permutation of length `n`. */
function identityPerm(n: number): Uint32Array {
  const perm = new Uint32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  return perm;
}

/**
 * Group a geometry's points by resolved asset id, per the module's
 * ordering spec. Pure: the geometry is only read.
 *
 * Complexity is one pass over the key column plus one scatter pass, both
 * over typed arrays; per-point string work is memoized per string-table
 * index, so a cell with thousands of points and a handful of assets
 * resolves a handful of strings.
 */
export function groupPointsByAsset(geo: Geometry, opts: AssetGroupingOptions): AssetGrouping {
  const points = geo.attrs.point;
  const n = points.count;
  const attrName = opts.assetAttr;

  if (attrName === undefined || attrName === "") {
    // Constant mode: every point in one batch, in point order. Zero
    // points still means zero batches, not one empty batch.
    return n === 0
      ? { order: [], counts: new Uint32Array(0), offsets: new Uint32Array(0), perm: new Uint32Array(0) }
      : {
          order: [opts.defaultAssetId],
          counts: Uint32Array.of(n),
          offsets: Uint32Array.of(0),
          perm: identityPerm(n),
        };
  }

  const attr = points.get(attrName);
  if (!attr) {
    const stringAttrs = points.names().filter((name) => points.require(name).type === "string");
    throw new Error(
      `buildInstanceBatches: assetAttr "${attrName}" not found on the point domain; ` +
        `string point attributes present: ${stringAttrs.length > 0 ? stringAttrs.join(", ") : "(none)"}`,
    );
  }
  if (attr.type !== "string") {
    throw new Error(
      `buildInstanceBatches: assetAttr "${attrName}" must be a string attribute, got ${attr.type}`,
    );
  }

  const data = attr.data;
  const ts = attr.tupleSize;
  const table = attr.stringTable;
  const tableLen = table.length;
  // Dense batch index per string-table index, -1 = not yet resolved.
  // The extra trailing slot absorbs EVERY out-of-range table index:
  // `getString` reads those as "", which resolves to defaultAssetId, so
  // they all share one dense key rather than becoming distinct assets.
  const denseByTable = new Int32Array(tableLen + 1).fill(-1);
  const denseById = new Map<string, number>();
  const order: string[] = [];
  const counts: number[] = [];
  const keyOf = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    const tableIdx = data[i * ts];
    const slot = tableIdx < tableLen ? tableIdx : tableLen;
    let dense = denseByTable[slot];
    if (dense < 0) {
      // Resolve once per distinct table index, not once per point.
      const raw = slot < tableLen ? (table[slot] ?? "") : "";
      const id = raw === "" ? opts.defaultAssetId : raw;
      const existing = denseById.get(id);
      if (existing === undefined) {
        dense = order.length;
        denseById.set(id, dense);
        order.push(id);
        counts.push(0);
      } else {
        // A second table index resolving to an id already seen (the
        // ""/defaultAssetId merge, or two out-of-range indices) joins
        // the EXISTING batch and never opens a new one.
        dense = existing;
      }
      denseByTable[slot] = dense;
    }
    keyOf[i] = dense;
    counts[dense]++;
  }

  const batches = order.length;
  const offsets = new Uint32Array(batches);
  let acc = 0;
  for (let j = 0; j < batches; j++) {
    offsets[j] = acc;
    acc += counts[j];
  }
  // Stable scatter: `i` ascends and each batch's cursor only advances,
  // so within a batch the point indices come out ascending.
  const cursor = Uint32Array.from(offsets);
  const perm = new Uint32Array(n);
  for (let i = 0; i < n; i++) perm[cursor[keyOf[i]]++] = i;

  return { order, counts: Uint32Array.from(counts), offsets, perm };
}
