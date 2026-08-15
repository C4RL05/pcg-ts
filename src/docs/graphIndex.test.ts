/**
 * `docs/graphs.md` and `docs/graphs.json` are generated from the
 * corpus under `graphs/`, and nothing in the build regenerates
 * them — so they drift silently. Adding an example, retitling one,
 * editing a description, or wiring in another node type changes what the
 * index should say; the committed index only changes if someone
 * remembers to run the generator. There is no CI in this repository, so
 * the drift check has to be a test.
 *
 * This pins them together. It renders through the same module the
 * generator uses (src/docs/graphIndex.ts, imported here from source so
 * `npm test` works on a fresh clone with no build) and compares the
 * bytes. If it fails, the fix is `npm run build && npm run docs:examples`,
 * not relaxing the test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeExample, loadGraphs, renderExampleIndex } from "./graphIndex.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Committed docs are read through git, and a Windows checkout with
 * `core.autocrlf=true` materializes them with CRLF. The generator always
 * writes LF (that is what makes its output byte-stable across platforms),
 * so normalize the on-disk copy rather than fail every Windows clone on
 * line endings the repository does not actually store.
 */
function readDoc(name: string): string {
  const path = fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/**
 * Where two texts first differ, as a short excerpt — never both whole
 * files. A drift failure should name the line to look at.
 */
function firstDifference(actual: string, expected: string): string {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const n = Math.max(a.length, e.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== e[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  committed: ${a[i] === undefined ? "<end of file>" : JSON.stringify(a[i])}`,
        `  generated: ${e[i] === undefined ? "<end of file>" : JSON.stringify(e[i])}`,
        `(${a.length} committed lines vs ${e.length} generated)`,
      ].join("\n");
    }
  }
  return "files differ only in trailing bytes";
}

function drift(file: string, committed: string, generated: string): string {
  return [
    `docs/${file} is stale: the example corpus changed but the generated`,
    "index was not regenerated. Run:",
    "",
    "  npm run build && npm run docs:examples",
    "",
    firstDifference(committed, generated),
  ].join("\n");
}

describe("example index docs", () => {
  const corpus = loadGraphs(ROOT);
  const { json, markdown } = renderExampleIndex(corpus.map(describeExample));

  it("finds the corpus at all", () => {
    // Guards every assertion below: rendering an empty corpus produces a
    // valid, empty index that would match a committed empty index, and
    // the suite would pass while testing nothing.
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("docs/graphs.json matches the corpus on disk", () => {
    const committed = readDoc("graphs.json");
    if (committed !== json) throw new Error(drift("graphs.json", committed, json));
  });

  it("docs/graphs.md matches the corpus on disk", () => {
    const committed = readDoc("graphs.md");
    if (committed !== markdown) throw new Error(drift("graphs.md", committed, markdown));
  });

  it("renders identically twice (deterministic output)", () => {
    const again = renderExampleIndex(loadGraphs(ROOT).map(describeExample));
    expect(again.json).toBe(json);
    expect(again.markdown).toBe(markdown);
  });
});
