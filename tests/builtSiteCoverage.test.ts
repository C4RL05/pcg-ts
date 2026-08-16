/**
 * `docs/pages/` is a COMMITTED BUILD, and nothing regenerates it.
 *
 * WHY THIS EXISTS. The sandbox enumerates the graph corpus with
 * `import.meta.glob` (`shared/presets.ts`), which vite resolves at BUILD
 * time — so a graph added to `graphs/` is invisible to the hosted page
 * until someone runs `npm run examples:pages` by hand. Neither `npm run
 * docs` nor CI does. Twice in one session a graph landed with its docs
 * updated to "51 graphs" / "53 graphs" while the deployed sandbox still
 * offered the previous count, and both times it was caught by eye rather
 * than by a gate. This is that gate.
 *
 * WHAT IT CHECKS: every graph in `graphs/` has at least one emitted chunk
 * naming it. That is exactly the property that breaks — a stale build is
 * missing the new graph's chunk entirely — and nothing more.
 *
 * WHAT IT DOES NOT CHECK, deliberately:
 *   - That a chunk is UP TO DATE. Editing a graph's contents rebuilds its
 *     chunk under a new content hash, but the old name still matches, so
 *     an edit-without-rebuild passes here. Catching that needs the build
 *     itself, which is too slow for `npm test`.
 *   - The chunk COUNT. Most graphs emit two (the `meta` import and the
 *     raw body are separate glob entries), but sixteen emit one, because
 *     vite folds them when only one of the two is reachable. A count rule
 *     would be wrong for those and would fail on an unrelated change to
 *     how the sandbox imports.
 *
 * The fix when it fails is one command — `npm run examples:pages` — and
 * the failure message says so, because a gate that reports drift without
 * naming the remedy just moves the puzzle.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GRAPHS = join(ROOT, "graphs");
const ASSETS = join(ROOT, "docs", "pages", "assets");

const graphNames = readdirSync(GRAPHS)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

describe("the committed site build covers every graph", () => {
  it("found graphs to check", () => {
    // Vacuity guard: every case below iterates this list.
    expect(graphNames.length).toBeGreaterThan(20);
  });

  it("docs/pages/assets exists", () => {
    // If the build directory is gone entirely, say THAT rather than
    // reporting 53 individually missing chunks.
    expect(existsSync(ASSETS)).toBe(true);
  });

  const assets = existsSync(ASSETS) ? readdirSync(ASSETS) : [];

  for (const name of graphNames) {
    it(`${name} has a chunk in the built site`, () => {
      // Prefix plus the hash separator, so `basics-path` cannot be
      // satisfied by `basics-path-resample-<hash>.js`.
      if (!assets.some((a) => a.startsWith(`${name}-`))) {
        throw new Error(
          [
            `graphs/${name}.json has no chunk in docs/pages/assets.`,
            "",
            "The sandbox globs graphs/ at BUILD time, so the hosted page cannot see",
            "this graph until the committed site is rebuilt:",
            "",
            "  npm run examples:pages",
            "",
            "then commit the changed files under docs/pages/.",
          ].join("\n"),
        );
      }
    });
  }
});
