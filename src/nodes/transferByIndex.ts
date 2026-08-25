/**
 * THE INDEX GATHER: for each destination point, read the source
 * geometry's point NUMBER `i`, where `i` is a number the caller computed.
 *
 * WHY IT IS NOT A FOURTH MAPPING ON `transferAttribute`. That node's three
 * mappings all answer a question asked in SPACE — which source point is
 * nearest, which triangle contains this UV, what does this ray hit — and
 * every one of them is a SEARCH whose answer the caller does not know and
 * cannot state. This one is asked in the source's own STORAGE ORDER, and
 * its answer is not searched for at all: it is handed over. The two are
 * not near-misses of one operation, they are different operations that
 * happen to end with the same write. A node whose param list decided which
 * of two incompatible questions was being asked would be one node in name
 * only — `transferAlongPath`'s header makes the identical argument for the
 * arc-parametric case, and the three of them are one family precisely
 * because each keeps its own question intact.
 *
 * The vocabulary is deliberately `transferAttribute`'s, down to the
 * spelling: an `attributes` list, misses that keep the destination's prior
 * value, `hitAttr` with the HIT polarity, `missCountAttr` as a u32 detail
 * count. Reading one of these three teaches the other two, which is the
 * whole point of a family.
 *
 * WHAT AN INDEX IS HERE, and the trap it carries: the source's point
 * order, which is the order the points sit in storage. It is not an
 * identity and nothing preserves it. A filter, a sort, a resample or a
 * partition upstream of the source renumbers every point, and this node
 * cannot see that it happened — index 7 is whatever is seventh today. That
 * is not a defect of the node, it is what asking for "point number 7"
 * means; a gather that must survive a reorder has to gather on a value
 * (transferAttribute's 'nearest', or a lookup written with setAttribute),
 * not on a position in an array.
 *
 * WHY THE LIBRARY NEEDED IT. A settled list — a lap's worth of placements,
 * a table of archetypes, a palette — is a point cloud whose ORDER is the
 * answer. Picking from it uniformly is `floor(mul(randomField(k), n))`,
 * picking from it in sequence is a counter, picking the entry a
 * neighbourhood already chose is an attribute; all three produce a number,
 * and before this node there was no way to spend one. The nearest-point
 * gather could not stand in: the entries of a table have no meaningful
 * positions, and giving them some so that a proximity query could find
 * them again is a fiction that fails silently the moment two of them land
 * near each other.
 */
import type { AttrData, AttrDefault, Attribute, AttributeSet } from "../data/index.js";
import { cloneGeometry, makeGeometryItem } from "../graph/index.js";
import { standardNode } from "./registry.js";
import {
  CANCEL_STRIDE,
  type FieldParam,
  requireGeometry,
  requireReportSlot,
  requireScalarColumn,
  resolveOn,
  TRANSFER_BOOKKEEPING,
} from "./util.js";


/** The three readings of an index that is not a source point. */
const OUT_OF_RANGE = ["clamp", "wrap", "miss"] as const;

/** Params of {@link transferByIndex}. */
export interface TransferByIndexParams {
  index: FieldParam;
  attributes: string[];
  outOfRange: string;
  hitAttr: string;
  missCountAttr: string;
}

/**
 * Refuse an `attributes` list holding an empty entry or a repeat, with
 * `transferAlongPath`'s wording and for its reason: a name appearing twice
 * is two decisions about one column and only one of them can be right.
 */
function requireDistinctNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (name === "") {
      throw new Error(
        'transferByIndex: param "attributes" holds an empty name; every entry must name a point attribute of the `source` input',
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `transferByIndex: param "attributes" names "${name}" twice; a name appearing twice is two decisions about one column and this node cannot tell which of them you meant — take one of them out`,
      );
    }
    seen.add(name);
  }
}

/**
 * The destination column one gathered attribute is written into.
 *
 * A COPY TARGET, not a reporting slot: the shape is the SOURCE'S, and
 * overwriting is what a copy IS — {@link requireReportSlot}'s own doc
 * comment names `transferAttribute.name` as the case, and this node is the
 * same case with a list instead of one name. So a destination column of
 * another shape is replaced rather than refused, exactly as
 * `transferNearest` replaces it.
 *
 * An existing column of the SAME shape is kept and written in place,
 * because that is what makes a MISS mean anything: `AttributeSet.replace`
 * resets every element to the default, so replacing here would erase the
 * prior values the miss policy promises to leave alone. Where the column
 * had to be created (or reshaped), "the prior value" is the source
 * attribute's default, which is the same sentence `transferAttribute`'s
 * description already says out loud.
 */
function destinationColumn(outSet: AttributeSet, src: Attribute): Attribute {
  const existing = outSet.get(src.name);
  if (existing !== undefined && existing.type === src.type && existing.tupleSize === src.tupleSize) {
    return existing;
  }
  return outSet.replace(src.name, src.type, src.tupleSize, src.defaultValue as AttrDefault);
}

/** One gathered column, resolved once before a single point is read. */
interface Gathered {
  /** The source's storage. */
  readonly srcData: AttrData;
  /** The destination's storage (same type and tuple size). */
  readonly dstData: AttrData;
  /** Components per element, shared by both sides. */
  readonly ts: number;
  /**
   * Non-null for a STRING column: its values are indices into a
   * per-attribute table, so they are re-interned rather than copied.
   */
  readonly strings: { readonly table: readonly string[]; readonly dst: Attribute } | null;
}

/** Gather a source geometry's point attributes at a per-point index. */
export const transferByIndex = standardNode<TransferByIndexParams>({
  type: "transferByIndex",
  category: "attribute",
  description:
    "Reads the `source` geometry's point attributes AT A PER-POINT COMPUTED INDEX and writes them onto the main input's points, creating or overwriting them on the output's point domain. For each destination point the `index` param resolves to a number, that number is truncated to an integer, and the source point with that ORDINAL — its position in the source's point storage, counting from 0 — is copied verbatim. This is the transfer that asks its question in the SOURCE'S ORDER rather than in space: transferAttribute's three mappings are all searches (nearest point, containing triangle, ray hit) whose answer the caller does not know, and transferAlongPath's is an arc coordinate; this one is handed the answer. It is a separate node rather than a fourth mapping because an index is not a spatial query — the params a search needs mean nothing to it, the param it needs means nothing to them, and a node whose param list decided which of two incompatible questions was being asked would be one node in name only. THE INDEX IS AN ORDINAL, NOT AN IDENTITY, and that is the trap: a filter, a sort, a resample or a partition upstream of `source` renumbers every point, and index 7 is then whatever is seventh afterwards. Nothing here can detect that. A gather that must survive a reorder has to gather on a VALUE (transferAttribute mapping 'nearest') rather than on a position in an array. WHAT IT IS FOR: a settled list whose ORDER is the answer — a lap's worth of placements, a table of archetypes, a palette, an asset roster. Picking from one uniformly is floor(mul(randomField(k), n)), picking in sequence is a counter, picking what a neighbour already chose is an attribute; every one of those produces a number, and this is the node that spends it. THE VALUES ARE COPIED, NEVER BLENDED: each column arrives with the source's own type and tuple size, so an i32 lane index stays an i32 lane index and a STRING asset id transfers intact — which is the case transferAlongPath cannot serve at all, since there is no value between two strings. WHICH ATTRIBUTES: name them in `attributes`, or leave it empty to take every point attribute of the source except the eight standard bookkeeping columns (P, rot, scale, density, boundsMin, boundsMax, color, seed) — see that param. Naming one LIFTS the exclusion, and naming P is the placement idiom: gather P and every destination point moves onto its chosen source point's position. AN INDEX OUTSIDE THE SOURCE is read by `outOfRange` — clamp to the ends, wrap round by Euclidean modulo, or MISS. A miss leaves the destination point's prior value (the source attribute's default where the column had to be created) and is counted by missCountAttr and flagged 0 by hitAttr, exactly as a miss on transferAttribute is. AN EMPTY SOURCE MISSES EVERY POINT under all three settings, including clamp and wrap: there is no index to clamp into and no length to wrap by, and inventing one would hand every destination point a value no source point holds. A NON-FINITE index is REFUSED, naming this node and the param, because an index that could not be computed is a broken expression rather than data — see `index` for the argument and the fix. DETERMINISM IS STRUCTURAL: this node draws no randomness at all, and each destination point is answered from its own index and the source alone, so the result does not depend on cook order, on partitioning, or on how many points are in hand. Shuffling the destination shuffles the output and changes nothing else. The output keeps the destination's count, order, identities and topology — this node removes no point and adds none.",
  inputs: [
    { name: "in", kind: "geometry" },
    { name: "source", kind: "geometry" },
  ],
  outputs: [{ name: "out", kind: "geometry" }],
  params: {
    index: {
      type: "f32",
      default: 0,
      acceptsField: true,
      description:
        "Which SOURCE POINT each destination point reads, as an ordinal counting from 0. Resolved on the DESTINATION'S point domain, so a field here sees the `in` cloud's attributes and never the source's — the source is what is being read, not what the expression runs over. As a plain number it is one index shared by every destination point, which is the broadcast case (every point takes source entry 3) and is mostly useful for a table of one. AS A FIELD IT IS THE POINT OF THE NODE: floor(mul(randomField(k), n)) is the uniform pick over an n-entry source, attribute(\"slot\") spends an index some earlier node settled, and an expression over position() gathers by where the destination point is without ever asking a spatial query to find it. TRUNCATED TOWARD ZERO (Math.trunc), not floored: 3.9 and 3.0 both name source point 3, and so do -0.5 and 0.5, because truncation collapses the whole open interval (-1, 1) onto 0. That matters only for a negative fraction, and it is why the uniform idiom is spelled with floor() — a random in [0, 1) scaled by n and floored covers every entry exactly once, while a value that can go negative needs to decide what it means before it arrives here. PRECISION: a field resolves to an f32 column, and f32 represents every integer only up to 16,777,216. An index computed beyond that lands on a neighbouring integer — the arithmetic that produced it is where the precision went, not this node, and a source that large wants an i32 attribute read straight through attribute() rather than a computed expression. NON-FINITE IS REFUSED, naming this param: NaN and ±Infinity are what a division by zero, an overflow or a floor() of a broken sub-expression produce, and they are not indices under any reading. This param does NOT take the finiteness opt-out that filterByExpression's predicate and pointNeighborhood's radius take, and the reason is the bar those meet: a stated meaning for NaN that a throw would delete. There is no such meaning here. NaN has none under 'clamp' (which end?) and none under 'wrap' (NaN modulo anything is NaN); +Infinity clamps sensibly but wraps to NaN, so even the three non-finite values disagree with each other within one setting; and any reading of NaN as a miss would have to be conditioned on `outOfRange`, making finiteness a property of a SIBLING PARAM'S VALUE rather than of this param, which is exactly the ambiguity the guard exists to prevent. If a broken index should miss rather than fail the cook, say so explicitly: map it to a sentinel outside the source — e.g. -1 — with a select() in the expression, and set outOfRange to 'miss'. That is a decision the graph states rather than one this node guesses.",
    },
    attributes: {
      type: "stringList",
      default: [],
      description:
        "Source POINT attributes to gather, in any order. AN EXPLICIT LIST IS WHAT TO WRITE WHEN THE ANSWER MATTERS: every name here is gathered, and naming one of the eight standard bookkeeping columns lifts the exclusion the empty list applies — they are skipped by that rule, never forbidden by it. EMPTY (the default) means every point attribute of the source EXCEPT P, rot, scale, density, boundsMin, boundsMax, color and seed. Those eight are excluded because they are the point domain's own bookkeeping — written on every cloud in the library before anyone has decided anything — and each describes the SOURCE'S POINTS rather than whatever the source is a table of: gathering seed hands two destination points the same identity and then drives randomness with it, P moves the destination cloud, rot and scale overwrite the transform it arrived with, boundsMin/boundsMax its extent. What is left is exactly what somebody wrote onto the source deliberately — an asset id, a lane, a width, a hue, a weight — which is what an index is asking for. STRING ATTRIBUTES ARE INCLUDED by the empty rule, unlike transferAlongPath's otherwise identical rule, and the difference is the operation: that node INTERPOLATES, and there is no value between two strings, while this one COPIES, and a copied string is just a string. Gathering an asset id out of a roster is the case this node was built for, so leaving it out of 'everything' would make the default useless exactly where the node is most used. NAMING P IS THE PLACEMENT IDIOM: gather P and every destination point moves to its chosen source point's position, which is how a scattered cloud becomes a set of picks from a settled list. The one reshape this node refuses is P's own: a source whose P is not the destination's shape is refused rather than replacing the position column with something every downstream node would misread. EVERY OTHER COLUMN IS A COPY TARGET and takes the source's shape outright — an existing destination column of another type or tuple size is REPLACED, not refused, because overwriting is what a copy is (this is transferAttribute's rule, not the reporting-slot rule that governs hitAttr and missCountAttr below). A same-shape column is written IN PLACE, which is what lets a miss keep its prior value. A source with no point attributes left after the exclusions is refused rather than cooking to a cloud with nothing added, which would look like success.",
    },
    outOfRange: {
      type: "enum",
      default: "clamp",
      enum: [...OUT_OF_RANGE],
      description:
        "How an index outside [0, sourceCount-1] is read, applied AFTER the truncation. 'clamp' (the default) pins it to the ends, so every negative index reads source point 0 and everything past the end reads the last point; nothing misses, and a source of one point answers every query with it. 'wrap' takes a EUCLIDEAN modulo — the remainder is made non-negative before it is used, so -1 reads the LAST source point and -n-1 reads the last again, not the truncated remainder JavaScript's own % operator returns (-1 % 5 is -1, which is not a point). This is the setting for a repeating table: a counter that has run off the end of a 5-entry palette comes back to entry 0, and one that ran off the start comes back to entry 4. 'miss' leaves the destination point's PRIOR VALUE untouched and flags it — the same miss transferAttribute's uv and raycast mappings produce, counted by missCountAttr and marked 0 by hitAttr. Use it when an out-of-range index means 'no answer' rather than 'the nearest answer': clamp and wrap both invent one, and a clamped index looks exactly like a real hit downstream. AN EMPTY SOURCE MISSES UNDER ALL THREE, this setting included: clamping needs an end to clamp to and wrapping needs a length to wrap by, and a source with no points has neither. Every destination point then keeps its prior value, missCountAttr counts them all and hitAttr is all zeros — the columns are still created, so the shape of the output does not depend on whether the source happened to be empty this cook.",
    },
    hitAttr: {
      type: "string",
      default: "",
      description:
        "When non-empty, writes a per-point flag of this name onto the OUTPUT'S POINT DOMAIN (bool, tuple 1). The polarity is the HIT, not the miss — the inverse of missCountAttr, which counts the zeros: 1 means this point read a source point and received its values, 0 means it missed and kept its prior value (the source attribute's default where the column had to be created). Every point is written, so the column never carries a stale value: with outOfRange 'clamp' or 'wrap' and a non-empty source it is all 1 by construction, since neither setting can fail to land, and an EMPTY source leaves it all 0 whatever outOfRange says. Feed it to filterByAttribute (comparison 'eq', value 1) to keep only the points that landed, then removeAttribute to clean it up. A miss cannot report itself through the gathered value — the prior value is a real value and looks like one — so this is the only per-point way to find one. Two kinds of name are refused rather than written: any attribute this node is GATHERING (whether named in `attributes` or selected by its empty default), which the flag would otherwise overwrite with a bool, and any point attribute the input ALREADY holds under a different shape — the flag's shape is this node's to pick, so writing it there would delete that column and everything in it while the cook still looked fine (hitAttr \"P\" would leave a point cloud with no positions). An existing bool tuple-1 column of the same name IS reused and reset, which is what keeps the flag describing THIS gather only. On a clash, give the flag a name of its own (a \"__\" prefix marks it internal, e.g. \"__hit\") or removeAttribute the existing column first. Empty = don't record.",
    },
    missCountAttr: {
      type: "string",
      default: "",
      description:
        "When non-empty, writes the number of missed destination points into a u32 detail attribute of this name on the output. With outOfRange 'clamp' or 'wrap' and a non-empty source this is always 0 — every point lands — so a non-zero count there means the source was empty. Empty = don't record. For WHICH points those were, see hitAttr; a count is a cook statistic and cannot be filtered on. This is a reporting slot whose shape this node picks (u32, tuple 1), so a name the input's DETAIL domain already holds under a different shape is REFUSED rather than deleted and re-added — give it a name of its own (a \"__\" prefix marks it internal, e.g. \"__missed\") or removeAttribute the clash first. A same-shape column is reused and reset.",
    },
  },
  execute({ inputs, params, seed, checkCancelled }) {
    // Params before geometry, as everywhere in this family: a bad name
    // reported as a missing attribute sends the author to debug the wrong
    // input.
    requireDistinctNames(params.attributes);
    const mode = params.outOfRange;
    if (mode !== "clamp" && mode !== "wrap" && mode !== "miss") {
      throw new Error(
        `transferByIndex: unknown outOfRange "${mode}"; valid settings: ${OUT_OF_RANGE.join(", ")} — clamp pins an index to the source's ends, wrap takes a Euclidean modulo of it, miss leaves the destination point's prior value and flags it`,
      );
    }

    const dstIn = requireGeometry(inputs, "in", "transferByIndex");
    const src = requireGeometry(inputs, "source", "transferByIndex");
    const srcSet = src.attrs.point;

    // WHICH COLUMNS, resolved on the SOURCE before anything is cloned: a
    // refusal costs nothing here and the clone does.
    const sources: Attribute[] = [];
    if (params.attributes.length > 0) {
      for (const name of params.attributes) {
        const attr = srcSet.get(name);
        if (!attr) {
          throw new Error(
            `transferByIndex: param "attributes" names point attribute "${name}", which the \`source\` input does not have; its point attributes are: ${srcSet.names().join(", ") || "(none)"}`,
          );
        }
        sources.push(attr);
      }
    } else {
      for (const attr of srcSet) {
        if (TRANSFER_BOOKKEEPING.has(attr.name)) continue;
        sources.push(attr);
      }
      if (sources.length === 0) {
        throw new Error(
          `transferByIndex: param "attributes" is empty, so this node gathers every point attribute of the \`source\` input except the standard bookkeeping ones (${[...TRANSFER_BOOKKEEPING].join(", ")}) — and the source has none left. Its point attributes are: ${srcSet.names().join(", ") || "(none)"}. Write what you want to gather onto the source first (setAttribute), or name one of the excluded columns explicitly in "attributes" — naming P is how a cloud is placed onto the source's positions.`,
        );
      }
    }

    // The reporting slots, checked against the INPUT's sets (shape-identical
    // to the clone's) so a refusal still costs nothing.
    const gathering = new Set(sources.map((a) => a.name));
    if (params.hitAttr !== "") {
      if (gathering.has(params.hitAttr)) {
        const how =
          params.attributes.length > 0
            ? 'it is named in "attributes"'
            : 'the empty "attributes" default selects it';
        throw new Error(
          `transferByIndex: hitAttr "${params.hitAttr}" is also being gathered (${how}) — the hit flag would overwrite the value this node just read, and the cook would look fine afterwards. Give hitAttr a distinct name (a "__" prefix marks it internal, e.g. "__hit"), or leave it empty to skip the flag.`,
        );
      }
      requireReportSlot({
        attrs: dstIn.attrs.point,
        nodeType: "transferByIndex",
        param: "hitAttr",
        name: params.hitAttr,
        type: "bool",
        tupleSize: 1,
        domain: "point",
        suggestion: "__hit",
      });
    }
    if (params.missCountAttr !== "") {
      requireReportSlot({
        attrs: dstIn.attrs.detail,
        nodeType: "transferByIndex",
        param: "missCountAttr",
        name: params.missCountAttr,
        type: "u32",
        tupleSize: 1,
        domain: "detail",
        suggestion: "__missed",
      });
    }

    // P IS THE ONE COLUMN THIS NODE MAY NOT RESHAPE, and the refusal is
    // stated here rather than left to the copy-target rule: every
    // downstream node reads P as the destination's own positions, so
    // replacing it with a differently shaped column returns a cloud that
    // still cooks and still has the right point count while nothing can
    // read where its points are. Gathering P at the SAME shape is the
    // placement idiom and goes through untouched.
    const dstP = dstIn.attrs.point.get("P");
    for (const attr of sources) {
      if (attr.name !== "P" || dstP === undefined) continue;
      if (attr.type !== dstP.type || attr.tupleSize !== dstP.tupleSize) {
        throw new Error(
          `transferByIndex: param "attributes" names "P", but the \`source\` input carries it as ${attr.type}[${attr.tupleSize}] while the \`in\` input's own P is ${dstP.type}[${dstP.tupleSize}]. Gathering it would reshape the destination's position column, which every node downstream reads — that is not something this node may do. Gather it under another name (rename it on the SOURCE first with setAttribute), or fix the source's P.`,
        );
      }
    }

    // Resolved on the DESTINATION, and BEFORE the clone is mutated: a field
    // may read a column this gather is about to overwrite, and the answer
    // must be the one the input held. Guarded (`resolveOn`, not the
    // allowing variant) — see the param's description for why a non-finite
    // index does not meet util.ts's bar for the opt-out.
    const indexCol = requireScalarColumn(
      resolveOn(dstIn, "point", params.index, seed, "transferByIndex", "index"),
      "transferByIndex",
      "index",
      "point",
      "a source point index",
    );

    const out = cloneGeometry(dstIn);
    const outSet = out.attrs.point;
    // `cloneGeometry` deep-copies, so the destination's storage is never the
    // source's even when one geometry is wired to both pins: a self-gather
    // reads the values the node was handed, not the ones it is writing.
    const columns: Gathered[] = [];
    for (const attr of sources) {
      const dst = destinationColumn(outSet, attr);
      columns.push({
        srcData: attr.data,
        dstData: dst.data,
        ts: attr.tupleSize,
        strings: attr.type === "string" ? { table: attr.stringTable, dst } : null,
      });
    }

    const n = outSet.count;
    const m = srcSet.count;
    const idx = indexCol.data;
    const hit = params.hitAttr !== "" ? new Uint8Array(n) : null;
    const nCols = columns.length;
    let missCount = 0;

    if (m === 0) {
      // AN EMPTY SOURCE MISSES EVERYTHING, whatever outOfRange says: there
      // is no end to clamp to and no length to wrap by. Hoisted out of the
      // walk rather than tested per point, which also means there is no
      // walk to cancel — the columns above were still created, so the
      // output's shape does not depend on this branch.
      missCount = n;
    } else {
      for (let i = 0; i < n; i++) {
        if ((i & (CANCEL_STRIDE - 1)) === 0) checkCancelled();
        // Truncation toward zero, then the range policy — in that order, so
        // -0.5 is index 0 (and lands) rather than -1 (and wraps to the end).
        let s = Math.trunc(idx[i]);
        if (mode === "clamp") {
          if (s < 0) s = 0;
          else if (s >= m) s = m - 1;
        } else if (mode === "wrap") {
          // Euclidean, not JavaScript's truncated remainder: -1 % 5 is -1,
          // which is not a point. The correction runs on the remainder, so
          // it is one branch rather than a loop however far out `s` is.
          s = s % m;
          if (s < 0) s += m;
        } else if (s < 0 || s >= m) {
          missCount++;
          continue;
        }
        for (let k = 0; k < nCols; k++) {
          const c = columns[k];
          const ts = c.ts;
          const so = s * ts;
          const doff = i * ts;
          const strings = c.strings;
          if (strings !== null) {
            // A string column's values are indices into a PER-ATTRIBUTE
            // table, so they are re-interned into the destination's rather
            // than copied as numbers — the two tables are unrelated.
            for (let t = 0; t < ts; t++) {
              strings.dst.setString(i, strings.table[c.srcData[so + t]] ?? "", t);
            }
            continue;
          }
          const dstData = c.dstData;
          const srcData = c.srcData;
          for (let t = 0; t < ts; t++) dstData[doff + t] = srcData[so + t];
        }
        if (hit !== null) hit[i] = 1;
      }
    }

    if (params.missCountAttr !== "") {
      out.attrs.detail.replace(params.missCountAttr, "u32", 1).set(0, missCount);
    }
    if (hit !== null) {
      // `replace` resets every element to 0 before the fill, so a
      // destination that already carried this name contributes nothing: the
      // flag describes THIS gather only. An internal marker that inherited
      // a prior value is how a miss gets to claim it landed.
      const flag = outSet.replace(params.hitAttr, "bool", 1);
      flag.data.set(hit.subarray(0, n));
    }
    return { out: [makeGeometryItem(out)] };
  },
});
