#!/usr/bin/env node
/**
 * Generate the example index (docs/examples.md + docs/examples.json) from
 * the corpus files under `examples/graphs/` — their own `meta` blocks plus
 * what each graph structurally contains.
 *
 * Usage: node scripts/gen-examples.mjs
 *
 * This script is I/O only — read the corpus, write the files, say what it
 * wrote. The rendering lives in src/docs/examples.ts (imported here from
 * dist) so the drift test in src/docs/examples.test.ts renders through the
 * exact same code and cannot drift from it.
 *
 * IT DESERIALIZES EVERY GRAPH FIRST, and that check is not redundant with
 * the rendering. The index is derived from the JSON text, so a graph
 * naming an unregistered node type or an unresolvable primitive would
 * index perfectly while failing to load — a passing generator over a
 * broken corpus, the same failure mode gen-primitives avoids by going
 * through the registry. Loading each graph proves the index describes
 * something that exists. (`dist/docs/index.js` registers the shipped
 * primitives on import, which is what makes `ref` nodes resolvable here.)
 *
 * Reads dist/index.js and dist/docs/index.js (run `npm run build` first).
 * Output is deterministic: examples sorted by file name, canonical key
 * order, LF newlines, no timestamp — running twice yields identical bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);

/** Import a built module, failing with the build instruction instead of a stack. */
async function importDist(relative) {
  const url = new URL(relative, import.meta.url);
  try {
    return await import(url.href);
  } catch (err) {
    const code = err && err.code;
    const message = err && err.message ? String(err.message) : "";
    if (code === "ERR_MODULE_NOT_FOUND" && message.includes("dist")) {
      console.error(
        [
          `gen-examples: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-examples.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const lib = await importDist("../dist/index.js");
const docs = await importDist("../dist/docs/index.js");

for (const [module, name, exported] of [
  ["dist/index.js", "deserializeGraph", lib.deserializeGraph],
  ["dist/docs/index.js", "loadCorpus", docs.loadCorpus],
  ["dist/docs/index.js", "describeExample", docs.describeExample],
  ["dist/docs/index.js", "renderExampleIndex", docs.renderExampleIndex],
]) {
  if (typeof exported !== "function") {
    console.error(`gen-examples: ${module} does not export ${name}(); rebuild with \`npm run build\`.`);
    process.exit(1);
  }
}

const corpus = docs.loadCorpus(root);
if (corpus.length === 0) {
  console.error(
    `gen-examples: no ${docs.CORPUS_PREFIX}*.json files under ${docs.CORPUS_DIR} — nothing to index.`,
  );
  process.exit(1);
}

for (const entry of corpus) {
  try {
    lib.deserializeGraph(entry.json);
  } catch (err) {
    console.error(
      [
        `gen-examples: ${entry.path} does not load, so it must not be indexed as if it did.`,
        `  ${err && err.message ? err.message : String(err)}`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

const { json, markdown } = docs.renderExampleIndex(corpus.map(docs.describeExample));

const docsDir = join(root, "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, "examples.json"), json);
writeFileSync(join(docsDir, "examples.md"), markdown);
console.log(
  `gen-examples: wrote docs/examples.md and docs/examples.json (${corpus.length} ${
    corpus.length === 1 ? "example" : "examples"
  })`,
);
