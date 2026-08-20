/**
 * One breakpoint, spelled the same way everywhere.
 *
 * `shared/mobile.ts` owns the cramped-screen query and hands it to the JS
 * that has to know (the editor collapses its toolbar when it matches).
 * The CSS cannot import it — a Svelte `<style>` block has no way to
 * interpolate a constant — so three components hard-code the same string
 * with a comment pointing at the module, and nothing but that comment
 * keeps them together.
 *
 * That is exactly the kind of pairing that drifts. When it does, the
 * failure is quiet and confusing rather than loud: the CSS switches to
 * the phone layout at one width while the JS is still deciding the
 * toolbar is expanded at another, so the bar shows every control on a
 * layout designed to carry four of them.
 *
 * This is a text check on purpose. Parsing the CSS would let the two
 * spellings differ so long as they mean the same thing, which is a
 * licence this pairing does not need — there is one query and it should
 * read identically in all four files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NARROW_MEDIA_QUERY } from "../shared/mobile.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIRS = ["editor", "demos", "shared"];

/** Every `@media` prelude in the browser pages, with where it was found. */
function mediaRules(): { file: string; query: string }[] {
  const found: { file: string; query: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(svelte|css|html)$/.test(entry.name)) continue;
      const source = readFileSync(join(ROOT, path), "utf8");
      for (const match of source.matchAll(/@media\s+([^{]+)\{/g)) {
        found.push({ file: path, query: match[1]!.trim() });
      }
    }
  };
  for (const dir of DIRS) walk(dir);
  return found;
}

describe("the narrow-screen breakpoint", () => {
  const rules = mediaRules();
  const sized = rules.filter((rule) => /max-width|min-width|max-height|min-height/.test(rule.query));

  it("is used by the browser pages", () => {
    expect(sized.length).toBeGreaterThan(0);
  });

  for (const rule of sized) {
    it(`${rule.file} spells it the way shared/mobile.ts does`, () => {
      expect(
        rule.query,
        [
          `${rule.file} has a size media query that is not the shared breakpoint.`,
          `  found:  @media ${rule.query}`,
          `  shared: @media ${NARROW_MEDIA_QUERY}`,
          "",
          "The JS in shared/mobile.ts switches state on the shared query, so a",
          "second breakpoint means the layout and the state change at different",
          "widths. If this component genuinely needs its own, give it a name in",
          "shared/mobile.ts and teach this test about it.",
        ].join("\n"),
      ).toBe(NARROW_MEDIA_QUERY);
    });
  }
});
