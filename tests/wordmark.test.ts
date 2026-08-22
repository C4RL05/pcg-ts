/**
 * One logotype, drawn the same way everywhere.
 *
 * The mark exists three times on purpose. `shared/wordmark.ts` holds the
 * geometry the browser pages draw inline — they are served from two roots,
 * so a `src` path is right in one and broken in the other — and
 * `docs/logo-dark.svg` / `docs/logo-light.svg` are standalone files for the
 * README and the site to reference with `<img>`, which cannot use a
 * TypeScript module. Three artefacts, one drawing.
 *
 * That is exactly the pairing that drifts, and it drifts INVISIBLY: nobody
 * sees the editor's mark and the README's mark at the same moment, so a
 * nudged coordinate in one of them is caught the day someone puts them
 * side by side and not before.
 *
 * The comparison is on the path data, not on the file. The three differ in
 * everything around it — the files carry an explicit fill, a `<title>`, and
 * width/height attributes, and the module carries `currentColor` so it can
 * take the colour of whatever it is set in — and none of that is the
 * drawing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from "../shared/wordmark.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Every `d=""` and `<rect>` in a fragment, in document order. */
function geometry(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/\sd="([^"]+)"/g)) out.push(`path ${m[1]}`);
  for (const m of svg.matchAll(/<rect\s([^>]+?)\s*\/>/g)) out.push(`rect ${m[1]}`);
  for (const m of svg.matchAll(/transform="(translate\([^"]+\))"/g)) out.push(`xf ${m[1]}`);
  return out;
}

describe("the wordmark", () => {
  const files = ["docs/logo-dark.svg", "docs/logo-light.svg"];

  it("has geometry to compare at all", () => {
    // The comparison below is only worth anything if the extractor finds
    // something. An empty list would make every assertion pass by matching
    // nothing against nothing.
    expect(geometry(WORDMARK_PATHS).length).toBeGreaterThan(8);
  });

  it.each(files)("%s draws the same shapes as the module", (file) => {
    const svg = readFileSync(`${ROOT}${file}`, "utf8");
    expect(geometry(svg)).toEqual(geometry(WORDMARK_PATHS));
  });

  it.each(files)("%s is drawn in the same box", (file) => {
    const svg = readFileSync(`${ROOT}${file}`, "utf8");
    // A matching outline in a different viewBox is the same drawing at the
    // wrong scale, which reads as a subtly heavier or lighter logotype
    // rather than as a broken one.
    expect(svg).toContain(`viewBox="${WORDMARK_VIEWBOX}"`);
  });

  it("takes its colour from whatever it is set in", () => {
    // `currentColor` is what lets one geometry serve a dark toolbar and a
    // light page without a second asset. A literal fill here would silently
    // pin the inline mark to one theme.
    expect(WORDMARK_PATHS).toContain('fill="currentColor"');
    expect(WORDMARK_PATHS).not.toMatch(/fill="#/);
  });

  it("is drawn by every demo and by the editor", () => {
    for (const demo of ["galaxy", "gpu-world", "infinite-world", "racetrack"]) {
      expect(readFileSync(`${ROOT}demos/${demo}/main.ts`, "utf8")).toContain("attachWordmark()");
    }
    // The editor reads the same constant rather than carrying its own copy
    // of the paths, which is what it did before the demos wanted the mark.
    const toolbar = readFileSync(`${ROOT}editor/Toolbar.svelte`, "utf8");
    expect(toolbar).toContain("WORDMARK_PATHS");
    expect(toolbar).not.toContain("M147.76,-95.97");
  });
});
