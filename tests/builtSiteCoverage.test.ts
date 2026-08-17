/**
 * `docs/pages/` is a COMMITTED BUILD, and nothing regenerates it.
 *
 * WHY THIS EXISTS. The editor enumerates the graph corpus with
 * `import.meta.glob` (`shared/presets.ts`), which vite resolves at BUILD
 * time — so a graph added to `graphs/` is invisible to the hosted page
 * until someone runs `npm run examples:pages` by hand. Neither `npm run
 * docs` nor CI does. Twice in one session a graph landed with its docs
 * updated to "51 graphs" / "53 graphs" while the deployed editor still
 * offered the previous count, and both times it was caught by eye rather
 * than by a gate. This is that gate.
 *
 * WHAT IT CHECKS: every graph in `graphs/` has at least one emitted chunk
 * naming it. That is exactly the property that breaks — a stale build is
 * missing the new graph's chunk entirely — and nothing more.
 *
 * IT ALSO CHECKS THE CHUNKS ARE CURRENT, which this file used to say it
 * deliberately could not. The reasoning was that catching an EDIT needs
 * the build itself and the build is too slow for `npm test` — true of a
 * byte-comparison, and beside the point: a chunk EMBEDS its graph's JSON
 * verbatim in a template literal, so the committed build can be asked what
 * graph it is carrying without building anything. That is what the second
 * case below does, and it is why the first is kept separate: "no chunk at
 * all" and "a chunk of the previous text" are different mistakes with the
 * same one-command fix, and a reader hitting one should not have to read
 * past the other.
 *
 * A byte-comparing CI step was the other candidate and was rejected: the
 * gate would then depend on vite emitting identical bytes across two node
 * majors and an OS it was not built on, and a gate that cries wolf is
 * worse than the drift it looks for.
 *
 * WHAT IT DOES NOT CHECK, deliberately:
 *   - The chunk COUNT. Most graphs emit two (the `meta` import and the
 *     raw body are separate glob entries), but sixteen emit one, because
 *     vite folds them when only one of the two is reachable. A count rule
 *     would be wrong for those and would fail on an unrelated change to
 *     how the editor imports.
 *
 * The fix when it fails is one command — `npm run examples:pages` — and
 * the failure message says so, because a gate that reports drift without
 * naming the remedy just moves the puzzle.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

  /**
   * Chunks emitted for exactly this graph.
   *
   * Vite appends `-<hash>` with a hash of exactly 8 characters, so the base
   * is the name with those 9 characters removed. Two cheaper rules were
   * tried and both are wrong on this corpus:
   *
   *   - `startsWith(name + "-")` also accepts a neighbour whose name merely
   *     begins the same way, so `pipeline-3-lots` is satisfied by
   *     `pipeline-3-lots-edits`'s chunks — hiding its own absence, and
   *     reporting its neighbour's perfectly current text as stale.
   *   - Cutting at the LAST dash assumes the hash has none, and vite's
   *     alphabet is base64url: `basics-transfer-attribute-LLFqeMS-.js` ends
   *     with one, and three graphs in this corpus draw such a hash today.
   */
  const HASH = /^[A-Za-z0-9_-]{8}$/;
  const chunksFor = (name: string): string[] =>
    assets.filter((a) => {
      if (!a.endsWith(".js")) return false;
      const stem = a.slice(0, -3);
      return stem.slice(0, -9) === name && stem[stem.length - 9] === "-" && HASH.test(stem.slice(-8));
    });

  /**
   * The JSON a chunk is carrying, or undefined when it carries none.
   *
   * A chunk is `var e=`<the graph's text>`;…`, so recovering the text is
   * undoing template-literal escaping — the backslash and the backtick,
   * plus `$` because `${` would otherwise open an interpolation. Nothing
   * else is transformed on the way in, which is what makes this comparison
   * exact rather than approximate.
   */
  const carriedJson = (file: string): unknown => {
    const text = readFileSync(join(ASSETS, file), "utf8");
    const open = text.indexOf("`");
    if (open < 0) return undefined;
    let out = "";
    for (let i = open + 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === "`") break;
      if (ch === "\\") {
        const next = text[++i];
        out += next === "\\" || next === "`" || next === "$" ? next : `\${next}`;
        continue;
      }
      out += ch;
    }
    try {
      return JSON.parse(out);
    } catch {
      return undefined;
    }
  };

  /** Every JSON a graph's name legitimately maps to: the graph, and its panel. */
  const sourcesFor = (name: string): unknown[] => {
    const out: unknown[] = [];
    for (const path of [join(GRAPHS, `${name}.json`), join(GRAPHS, "panels", `${name}.json`)]) {
      if (existsSync(path)) out.push(JSON.parse(readFileSync(path, "utf8")));
    }
    return out;
  };

  for (const name of graphNames) {
    it(`${name}'s chunks carry the CURRENT text`, () => {
      // The failure this catches: a graph edited and committed without the
      // site rebuilt, which leaves the previous text hosted under a name
      // the presence check above is perfectly happy with. It happened for
      // 25 graphs in one commit; only memory caught it.
      const chunks = chunksFor(name);
      const sources = sourcesFor(name);
      const stale: string[] = [];
      for (const chunk of chunks) {
        const carried = carriedJson(chunk);
        if (carried === undefined) continue; // not a JSON-carrying chunk
        if (!sources.some((src) => JSON.stringify(src) === JSON.stringify(carried))) {
          stale.push(chunk);
        }
      }
      if (stale.length > 0) {
        throw new Error(
          [
            `docs/pages/assets carries an out-of-date copy of graphs/${name}.json:`,
            ...stale.map((c) => `  ${c}`),
            "",
            "The graph was edited without rebuilding the committed site, so the",
            "hosted editor is cooking different geometry from the file in the repo:",
            "",
            "  npm run examples:pages",
            "",
            "then commit the changed files under docs/pages/.",
          ].join("\n"),
        );
      }
    });

    it(`${name} has a chunk in the built site`, () => {
      // Exact base, not a prefix: `basics-path` must not be satisfied by
      // `basics-path-resample-<hash>.js`, and `pipeline-3-lots` must not be
      // satisfied by `pipeline-3-lots-edits-<hash>.js` — which a prefix
      // test allows, and which would hide a missing chunk for any graph
      // whose name begins another's.
      if (chunksFor(name).length === 0) {
        throw new Error(
          [
            `graphs/${name}.json has no chunk in docs/pages/assets.`,
            "",
            "The editor globs graphs/ at BUILD time, so the hosted page cannot see",
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
