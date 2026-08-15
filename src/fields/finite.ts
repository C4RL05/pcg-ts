/**
 * The library's ONE definition of "non-finite", and the two scans built on
 * it. Internal: deliberately not re-exported from `src/fields/index.ts`,
 * because the policy — WHICH values a param may take — belongs to the
 * seams that call this (`src/nodes/util.ts`, the fused-run terminal in
 * `src/graph/execute.ts`), not to a helper anyone can point at a column.
 *
 * Two scans rather than one, because a clean column and a broken one want
 * opposite things. `firstNonFinite` early-exits, so the answer on the
 * failing path is cheap; the cost that matters is the CLEAN path, which
 * always pays a full pass (measured at ~0.57 ns/element, see
 * PLAN-finiteness.md section 2.1). `countNonFiniteElements` is the second
 * pass, paid only once a failure is already certain and a diagnostic is
 * being written.
 *
 * `Number.isFinite` rather than the branch-free `v * 0 === 0`: measured
 * faster at every column size, and it says what it means.
 *
 * F32 COLUMNS ONLY, and this is a correctness rule rather than an
 * optimization. `Int32Array`/`Uint32Array`/`Uint8Array` storage cannot
 * HOLD a non-finite value, and the float-to-int store that produced one of
 * them from a non-finite f32 is documented GIGO on the device and
 * explicitly not matched against the CPU (`src/gpu/applyKernels.ts`), so
 * an int column is a place where the two paths are allowed to disagree.
 * Reading meaning out of one here would make the guard's answer depend on
 * which path ran.
 */
import type { AttrData } from "../data/index.js";
import type { ColumnData } from "./types.js";

/**
 * Index of the first non-finite scalar in `data`'s first `scalars`
 * entries, or -1 when every one of them is finite (and for any storage
 * that cannot hold a non-finite value at all).
 *
 * `scalars` is required rather than defaulted to `data.length` because the
 * two callers disagree about it: a {@link Column} is exactly
 * `count * tupleSize` scalars long, while an `Attribute`'s storage is
 * `capacity * tupleSize` and its tail holds elements the geometry does not
 * have. Scanning that tail would let dead storage decide a live answer.
 */
export function firstNonFinite(data: ColumnData | AttrData, scalars: number): number {
  if (!(data instanceof Float32Array)) return -1;
  const n = Math.min(scalars, data.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(data[i])) return i;
  }
  return -1;
}

/**
 * How many ELEMENTS of `data`'s first `scalars` entries hold at least one
 * non-finite component — the number a diagnostic quotes, because "3 of 600
 * points" is what an author can act on and "5 of 1800 scalars" is not.
 *
 * See {@link firstNonFinite} for why `scalars` is a required argument.
 */
export function countNonFiniteElements(
  data: ColumnData | AttrData,
  scalars: number,
  tupleSize: number,
): number {
  if (!(data instanceof Float32Array)) return 0;
  const n = Math.min(scalars, data.length);
  let count = 0;
  for (let i = 0; i < n; i += tupleSize) {
    for (let k = 0; k < tupleSize; k++) {
      if (!Number.isFinite(data[i + k])) {
        count++;
        break;
      }
    }
  }
  return count;
}
