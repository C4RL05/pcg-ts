/**
 * `docs/nodes.md` and `docs/nodes.json` are generated from the node
 * registry, and nothing in the build regenerates them — so they drift
 * silently. Registering a node type, adding a param, or editing a
 * description changes the registry; the committed docs only change if
 * someone remembers to run the generator. Nothing caught the gap: there
 * is no CI in this repo, so the drift check has to be a test.
 *
 * This pins them together. It renders through the same module the
 * generator uses (src/docs/node-reference.ts, imported here from source
 * so `npm test` works on a fresh clone with no build) and compares the
 * bytes. If it fails, the fix is `npm run build && npm run docs:nodes`,
 * not relaxing the test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listNodeTypes } from "../index.js";
import { renderNodeReference } from "./node-reference.js";

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
    `docs/${file} is stale: the node registry changed but the generated`,
    "reference was not regenerated. Run:",
    "",
    "  npm run build && npm run docs:nodes",
    "",
    firstDifference(committed, generated),
  ].join("\n");
}

describe("node reference docs", () => {
  const { json, markdown } = renderNodeReference(listNodeTypes());

  it("docs/nodes.json matches the live node registry", () => {
    const committed = readDoc("nodes.json");
    if (committed !== json) throw new Error(drift("nodes.json", committed, json));
  });

  it("docs/nodes.md matches the live node registry", () => {
    const committed = readDoc("nodes.md");
    if (committed !== markdown) throw new Error(drift("nodes.md", committed, markdown));
  });

  it("renders identically twice (deterministic output)", () => {
    const again = renderNodeReference(listNodeTypes());
    expect(again.json).toBe(json);
    expect(again.markdown).toBe(markdown);
  });

  /**
   * The renderer rebuilds `NodeTypeInfo` field by field, which is what
   * keeps the emitted key order stable — and is also how a registry field
   * goes missing here while `listNodeTypes()` carries it. That failure is
   * SILENT in the worst way: a field the generator cannot emit produces no
   * docs diff, so the byte-compare above stays green and CI never sees it.
   * The two tests below are the guard, one per shape, and they read the
   * registry rather than a literal so they follow the set.
   */
  const selfMeteringTypes = listNodeTypes().filter((t) => t.selfMetered === true);

  it("carries selfMetered into nodes.json for every type the registry flags", () => {
    expect(selfMeteringTypes.length).toBeGreaterThan(0); // the guard must have something to guard
    const emitted = JSON.parse(json) as Array<{ type: string; selfMetered?: boolean }>;
    const flagged = emitted.filter((t) => t.selfMetered === true).map((t) => t.type);
    expect(flagged.sort()).toEqual(selfMeteringTypes.map((t) => t.type).sort());
    // ...and the key is absent, not `false`, everywhere else — same
    // convention `category` uses, and what keeps the other entries'
    // bytes untouched.
    expect(emitted.filter((t) => "selfMetered" in t).length).toBe(selfMeteringTypes.length);
  });

  it("says so in nodes.md too, so the prose and the JSON cannot disagree", () => {
    const marker = "**Meters the cook budget itself:**";
    const occurrences = markdown.split(marker).length - 1;
    expect(occurrences).toBe(selfMeteringTypes.length);
    for (const t of selfMeteringTypes) {
      // The note belongs to that type's section, not to some other.
      const section = markdown.split(`\n## ${t.type}\n`)[1] ?? "";
      expect(section.split("\n## ")[0]).toContain(marker);
    }
  });
});
