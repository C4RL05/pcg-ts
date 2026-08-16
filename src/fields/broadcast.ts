/**
 * The broadcast rule, and the column read that honours it.
 *
 * Its own module rather than a pair of exports in `./types.js`, because
 * `src/fields/index.ts` re-exports that file with `export *` and these two
 * are internal: `publicSurface.test.ts` caught them escaping as API on
 * their first draft, which is exactly the failure that guard exists for.
 * The same reasoning already moved `capture.ts` off a wildcard — see the
 * comment there.
 *
 * Shared by every fn that combines columns of possibly different widths:
 * the ~25 elementwise combinators in `./combinators.ts` and the case-set
 * selector `byAttribute` in `./inputs.ts`, which cannot import the
 * combinators (they import IT back, for `resolveField`). One
 * implementation, so the two cannot drift into different notions of
 * "these widths agree".
 */
import type { Column } from "./types.js";

/**
 * @internal Scalars (tupleSize 1) broadcast against any tuple size; two
 * non-scalar tuple sizes must match exactly. `undefined` — a width not
 * known until a geometry is in hand, as for `attribute(name)` with no
 * declared `tupleSize` — makes the answer unknown, which defers the check
 * to evaluation.
 *
 * `kind` prefixes the message. A caller with more to say about WHICH
 * inputs disagreed (`byAttribute` names the offending case key) checks the
 * sizes itself and treats this as the reference rule.
 */
export function broadcastTupleSize(
  kind: string,
  sizes: readonly (number | undefined)[],
): number | undefined {
  let ts: number | undefined = 1;
  for (const s of sizes) {
    if (s === undefined) return undefined;
    if (s === 1) continue;
    if (ts !== 1 && ts !== s) {
      throw new Error(`${kind}: incompatible tuple sizes ${ts} and ${s}`);
    }
    ts = s;
  }
  return ts;
}

/** @internal Read component k of element i from a column, broadcasting scalars. */
export function readColumnAt(col: Column, i: number, k: number): number {
  return col.tupleSize === 1 ? col.data[i] : col.data[i * col.tupleSize + k];
}
