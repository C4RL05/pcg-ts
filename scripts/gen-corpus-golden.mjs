#!/usr/bin/env node
/**
 * Regenerate the corpus golden (tests/corpus.golden.json) by cooking every
 * example under `examples/graphs/` and recording its COUNT-LEVEL statistics:
 * element counts per domain, attribute presence, instance batch shape, and
 * the bounds of `P`.
 *
 * Usage: node scripts/gen-corpus-golden.mjs
 *
 * THIS IS THE INTENDED WAY TO UPDATE THE GOLDEN. A change that legitimately
 * moves what a corpus graph produces — a new param default, a better
 * primitive, an example edited to teach its point more clearly — is
 * accepted by running this and committing the diff, which is reviewable
 * precisely because the file holds counts and attribute names rather than
 * floats. What the golden must NEVER be updated to silence is a diff
 * nobody intended; read it before committing it.
 *
 * This script is I/O only. The cooking and the reduction live in
 * src/docs/corpus.ts (imported here from dist), which tests/corpus.test.ts
 * also goes through — so the golden cannot be recorded under different
 * cook options than the ones it is checked under.
 *
 * Reads dist/docs/index.js (run `npm run build` first). Output is
 * deterministic: examples keyed in sorted order, canonical key order,
 * bounds rounded, LF newlines, no timestamp — running twice over an
 * unchanged corpus rewrites identical bytes.
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
          `gen-corpus-golden: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-corpus-golden.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const docs = await importDist("../dist/docs/index.js");

for (const name of ["loadCorpus", "cookCorpusGraph", "corpusStats", "renderCorpusGolden"]) {
  if (typeof docs[name] !== "function") {
    console.error(
      `gen-corpus-golden: dist/docs/index.js does not export ${name}(); rebuild with \`npm run build\`.`,
    );
    process.exit(1);
  }
}

const corpus = docs.loadCorpus(root);
if (corpus.length === 0) {
  console.error(
    `gen-corpus-golden: no ${docs.CORPUS_PREFIX}*.json files under ${docs.CORPUS_DIR} — nothing to record.`,
  );
  process.exit(1);
}

const entries = [];
let slowest = { file: "", elapsedMs: 0 };
for (const entry of corpus) {
  let cooked;
  try {
    cooked = await docs.cookCorpusGraph(entry.json);
  } catch (err) {
    console.error(
      [
        `gen-corpus-golden: ${entry.path} failed to cook, so there is nothing to record for it.`,
        `  ${err && err.message ? err.message : String(err)}`,
      ].join("\n"),
    );
    process.exit(1);
  }
  if (cooked.elapsedMs > slowest.elapsedMs) {
    slowest = { file: entry.file, elapsedMs: cooked.elapsedMs };
  }
  entries.push({ file: entry.file, stats: docs.corpusStats(cooked.outputs) });
}

const testsDir = join(root, "tests");
mkdirSync(testsDir, { recursive: true });
writeFileSync(join(testsDir, "corpus.golden.json"), docs.renderCorpusGolden(entries));
console.log(
  `gen-corpus-golden: wrote tests/corpus.golden.json (${entries.length} examples, slowest ${
    slowest.file
  } at ${slowest.elapsedMs.toFixed(1)} ms of the ${docs.CORPUS_TIME_LIMIT_MS} ms budget)`,
);
