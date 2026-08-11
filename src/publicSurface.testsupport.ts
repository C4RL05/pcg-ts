/**
 * Shared machinery for the per-entry-point public-surface tests.
 *
 * The library re-exports through `export *` in most barrels, which is
 * convenient and silently publishes anything a module happens to export.
 * That is how ANON_ATTR_PREFIX — the internal `"__anon_"` marker, read by
 * nothing outside its own file — became part of the package's API: nobody
 * decided to export it, and nothing failed when it appeared.
 *
 * These tests do not judge what belongs; they only make the surface
 * impossible to change by accident. Adding an export becomes a one-line
 * diff a reviewer can see, instead of an invisible change that a consumer
 * later depends on and freezes.
 *
 * There is one test per entry point rather than one covering all three,
 * because src/gpu and src/three are off-limits to core files —
 * noGpuInCore.test.ts and noThreeInCore.test.ts enforce exactly that, and
 * a single root-level test importing all three trips both.
 *
 * VALUE exports only: `interface` and `type` vanish at runtime, so
 * `Object.keys` cannot see them. Type-only additions carry no runtime
 * coupling and would show up as a .d.ts diff at build time.
 */

/** Sorted value-export names of a module namespace object. */
export const surfaceOf = (mod: object): string[] =>
  Object.keys(mod)
    .filter((k) => k !== "default")
    .sort();

/**
 * Drift in both directions, phrased as the decision the reader has to
 * make. Empty string means the surface matches.
 */
export function surfaceDiff(actual: string[], expected: readonly string[]): string {
  const added = actual.filter((n) => !expected.includes(n));
  const removed = expected.filter((n) => !actual.includes(n));
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(
      `ADDED (now public, was not): ${added.join(", ")}\n` +
        `  Deliberate? Add the name to the list in the failing test and document it — ` +
        `an undocumented export is one nobody can find and everybody inherits.\n` +
        `  Not deliberate? Something internal escaped through an 'export *'. Replace ` +
        `that wildcard with named exports (see src/fields/index.ts) rather than ` +
        `widening the list.`,
    );
  }
  if (removed.length > 0) {
    parts.push(
      `REMOVED (was public, now gone): ${removed.join(", ")}\n` +
        `  This BREAKS consumers. If intended, update the list and note it in the ` +
        `release as a breaking change.`,
    );
  }
  return parts.join("\n");
}
