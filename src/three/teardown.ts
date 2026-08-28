/**
 * One teardown invariant, stated once: **a throwing teardown step must
 * never abort the ownership bookkeeping around it.**
 *
 * Every release path in this package sits next to a step that decides
 * what is still reachable — the swap that publishes a cell, the handle
 * releases after an adapter release, the mesh list a failed build
 * discards. An exception escaping one of those windows does not merely
 * fail loudly; it removes the resource from every index that could later
 * free it, and no later `dispose()` can recover what it can no longer
 * find. So every step runs, state is committed, and only then does the
 * first failure propagate — the rest are suppressed, since only one
 * error can propagate and the first is the one with a live cause.
 *
 * `worldBinding.ts` wrote this first and documented it at length; it now
 * imports the helper from here rather than keeping a second copy.
 */

/** The first failure a teardown hit, or undefined if every step ran clean. */
export type TeardownFailure = { readonly err: unknown } | undefined;

/**
 * Run one teardown step to completion, capturing what it throws instead
 * of letting it escape, and return the failure to carry forward.
 *
 * Seed the carry-forward with a failure that already happened (the build
 * error a cleanup is unwinding, say) and that is the one that propagates:
 * the first is kept.
 */
export function attempt(failure: TeardownFailure, step: () => void): TeardownFailure {
  try {
    step();
  } catch (err) {
    return failure ?? { err };
  }
  return failure;
}
