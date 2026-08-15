/**
 * Order-insensitive, float-exact comparison of point clouds, keyed on
 * point IDENTITY.
 *
 * The suites in `tests/crossPartition.test.ts` compare clouds that are
 * legitimately in DIFFERENT ORDERS: a shuffled input, a region stitched
 * back together out of cells, two sides of a seam. Every comparator the
 * repo already has answers a different question.
 *
 * - `graphFingerprint` (`src/docs/graphGolden.ts`) is float-exact but hashes
 *   each attribute COLUMN in index order, so any reordering is a total
 *   mismatch with nothing to read. Right for determinism, unusable here.
 * - `geometryDiff` (`src/runtime/runtime.testsupport.ts`) walks the buffers
 *   element by element — also index-ordered.
 * - `snapshotGeometry` (`src/nodes/nodes.testsupport.ts`) returns VALUES rather
 *   than a hash, so it can be permuted before comparing, and that is
 *   exactly what the equivariance suite does when it knows the
 *   permutation. It does not help when the reordering is implicit.
 *
 * WHY IDENTITY AND NOT A SORT OF THE POSITIONS. Sorting floats to make a
 * comparison order-insensitive hides the bugs these suites exist to
 * catch: a lexicographic sort over `x` then `z` reorders whenever a
 * coordinate moves by an ulp, and a sort over a rendered string ranks
 * "10" before "9". Point identity — `hashCombine` over the bit patterns
 * of the stored position plus the standard `seed` attribute, the same
 * function every identity-keyed node keys on (`src/data/identity.ts`) —
 * is a name the point carries, not a rank over the population. It is
 * stable under reordering by construction, and the primary key here.
 *
 * Identity alone would be too weak, though: it covers `P` and `seed` and
 * nothing else, so a wrong `nbrCount` or a wrong `density` would compare
 * equal. Each key is therefore identity PLUS a float-exact rendering of
 * every point attribute, and the multiset is over those. Identity groups;
 * the full row decides.
 *
 * Float-exact means exact: `String(x)` is the shortest decimal that round
 * trips a double, so two doubles render alike exactly when they are
 * equal — with `-0` and `NaN`, which `String` flattens, spelled out. This
 * is `Object.is` equality, expressed as a string so it can go in a Map.
 */
import { pointIdentities } from "../../src/data/identity.js";
import type { AttributeSet, Geometry } from "../../src/data/index.js";

/** A double rendered so that equal renderings mean `Object.is` equality. */
function exact(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (Object.is(n, -0)) return "-0";
  return String(n);
}

/**
 * One string per element of `set`, holding every attribute of that
 * element in a fixed (name-sorted) order. Domain-agnostic so the edge
 * comparator in `edgeMultiset.ts` can render a PRIMITIVE row with the
 * same float-exact rules — an edge's length has to compare as exactly as
 * a point's position does.
 */
export function attributeRows(set: AttributeSet): string[] {
  const names = set.names().sort();
  const attrs = names.map((name) => set.require(name));
  const out: string[] = [];
  for (let i = 0; i < set.count; i++) {
    const parts: string[] = [];
    for (let a = 0; a < attrs.length; a++) {
      const attr = attrs[a];
      const vals: string[] = [];
      for (let k = 0; k < attr.tupleSize; k++) {
        vals.push(attr.type === "string" ? JSON.stringify(attr.getString(i, k)) : exact(attr.get(i, k)));
      }
      parts.push(`${names[a]}=${vals.join(",")}`);
    }
    out.push(parts.join(" "));
  }
  return out;
}

/**
 * One string per point holding every point attribute of that point.
 * Topology is deliberately absent: a point cloud's primitives have no
 * identity of their own to key on, which is exactly what
 * `edgeMultiset.ts` builds ON TOP of this rather than inside it.
 */
export function pointRows(geo: Geometry): string[] {
  return attributeRows(geo.attrs.point);
}

/**
 * One key per point: its identity, then its full row. Two points compare
 * equal exactly when they are the same point carrying the same values.
 */
export function pointKeys(geo: Geometry, who: string): string[] {
  const ident = pointIdentities(geo, who);
  const rows = pointRows(geo);
  return rows.map((row, i) => `#${ident[i]} ${row}`);
}

/** Occurrence counts of `keys`, so equality is a multiset comparison. */
export function multisetOf(keys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

/**
 * Whether two clouds hold the same points with the same values, in any
 * order. Returns null when they agree, else the first difference — the
 * key is printed whole, so the message names the point's world position.
 */
export function multisetDiff(
  a: Geometry,
  b: Geometry,
  labelA: string,
  labelB: string,
): string | null {
  return keyMultisetDiff(pointKeys(a, labelA), pointKeys(b, labelB), labelA, labelB, "points");
}

/**
 * {@link multisetDiff} over keys already extracted, so the same
 * comparison serves the point domain and the edge set built over it.
 * `noun` names what is being counted in the size message.
 */
export function keyMultisetDiff(
  aKeys: readonly string[],
  bKeys: readonly string[],
  labelA: string,
  labelB: string,
  noun: string,
): string | null {
  const left = multisetOf(aKeys);
  const right = multisetOf(bKeys);
  if (aKeys.length !== bKeys.length) {
    // Reported first because it is the difference an author can act on
    // without reading a coordinate.
    return `${labelA} has ${aKeys.length} ${noun}, ${labelB} has ${bKeys.length}`;
  }
  for (const [key, count] of left) {
    const other = right.get(key) ?? 0;
    if (other !== count) {
      return other === 0
        ? `only in ${labelA}: ${key}`
        : `${labelA} holds ${count} of ${key}, ${labelB} holds ${other}`;
    }
  }
  for (const key of right.keys()) {
    if (!left.has(key)) return `only in ${labelB}: ${key}`;
  }
  return null;
}

/** A point claimed by more than one part of a partition. */
export interface Duplicate {
  readonly key: string;
  readonly parts: readonly string[];
}

/**
 * How a set of parts fails to be a partition of `whole`. The two failure
 * modes are reported separately on purpose: a seam that emits a boundary
 * point TWICE and a seam that emits it NEVER are opposite bugs with the
 * same symptom in a bare count comparison, and a test that only checked
 * the total would pass on a pair of them.
 */
export interface PartitionReport {
  /** Points more than one part claims (or one part claims twice). */
  readonly duplicated: readonly Duplicate[];
  /** Points of `whole` no part claims. */
  readonly missing: readonly string[];
  /** Points a part claims that `whole` does not hold. */
  readonly extra: readonly Duplicate[];
}

/**
 * Check that `parts` partition `whole`: every point exactly once, values
 * float-exact. `parts` are labelled so a duplicate names the two cells
 * that both claimed the point.
 */
export function partitionReport(
  parts: readonly { readonly label: string; readonly geo: Geometry }[],
  whole: Geometry,
  who: string,
): PartitionReport {
  return keyPartitionReport(
    parts.map((part) => ({ label: part.label, keys: pointKeys(part.geo, `${who}/${part.label}`) })),
    pointKeys(whole, `${who}/whole`),
  );
}

/**
 * {@link partitionReport} over keys already extracted. The edge suites
 * cannot hand a `Geometry` here at all: an edge a window OWNS and an edge
 * it merely SAW are the same primitive, told apart only by an ownership
 * rule the caller applies, so what they partition is a list of keys.
 */
export function keyPartitionReport(
  parts: readonly { readonly label: string; readonly keys: readonly string[] }[],
  whole: readonly string[],
): PartitionReport {
  const claims = new Map<string, string[]>();
  for (const part of parts) {
    for (const key of part.keys) {
      const list = claims.get(key);
      if (list === undefined) claims.set(key, [part.label]);
      else list.push(part.label);
    }
  }
  const target = multisetOf(whole);
  const duplicated: Duplicate[] = [];
  const extra: Duplicate[] = [];
  for (const [key, labels] of claims) {
    const wanted = target.get(key) ?? 0;
    if (wanted === 0) extra.push({ key, parts: labels });
    else if (labels.length > wanted) duplicated.push({ key, parts: labels });
  }
  const missing: string[] = [];
  for (const [key, wanted] of target) {
    const got = claims.get(key)?.length ?? 0;
    if (got < wanted) missing.push(key);
  }
  return { duplicated, missing, extra };
}

/**
 * A partition report as a message, or null when the parts partition the
 * whole. `noun` names the thing being partitioned, so an edge suite's
 * failure reads as an edge rather than as a point.
 */
export function formatPartitionReport(
  report: PartitionReport,
  headline: string,
  noun = "point",
): string | null {
  const lines: string[] = [];
  for (const dup of report.duplicated.slice(0, 4)) {
    lines.push(`  claimed by ${dup.parts.join(" and ")}: ${dup.key}`);
  }
  for (const key of report.missing.slice(0, 4)) lines.push(`  claimed by nobody: ${key}`);
  for (const item of report.extra.slice(0, 4)) {
    lines.push(`  ${item.parts.join(" and ")} emitted a ${noun} the whole region does not hold: ${item.key}`);
  }
  if (lines.length === 0) return null;
  return [
    `${headline}: ${report.duplicated.length} duplicated, ${report.missing.length} missing, ${report.extra.length} spurious.`,
    ...lines,
  ].join("\n");
}
