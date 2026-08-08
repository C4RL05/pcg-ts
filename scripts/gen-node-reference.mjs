#!/usr/bin/env node
/**
 * Generate the node reference (docs/nodes.md + docs/nodes.json) from the
 * built library's node registry metadata (`listNodeTypes()`).
 *
 * Usage: node scripts/gen-node-reference.mjs
 *
 * This script is I/O only — read the registry, write the files, say what
 * it wrote. The rendering lives in src/docs/node-reference.ts (imported
 * here from dist) so the drift test in src/docs/node-reference.test.ts
 * renders through the exact same code and cannot drift from it.
 *
 * Reads dist/index.js and dist/docs/index.js (run `npm run build` first).
 * Output is deterministic: node types sorted alphabetically, canonical key
 * order, LF newlines — running twice yields identical bytes.
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
          `gen-node-reference: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-node-reference.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const lib = await importDist("../dist/index.js");
const docs = await importDist("../dist/docs/index.js");

if (typeof lib.listNodeTypes !== "function") {
  console.error(
    "gen-node-reference: dist/index.js does not export listNodeTypes(); rebuild with `npm run build`.",
  );
  process.exit(1);
}
if (typeof docs.renderNodeReference !== "function") {
  console.error(
    "gen-node-reference: dist/docs/index.js does not export renderNodeReference(); rebuild with `npm run build`.",
  );
  process.exit(1);
}

const types = lib.listNodeTypes();
const { json, markdown } = docs.renderNodeReference(types);

const docsDir = join(root, "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, "nodes.json"), json);
writeFileSync(join(docsDir, "nodes.md"), markdown);
console.log(`gen-node-reference: wrote docs/nodes.md and docs/nodes.json (${types.length} node types)`);
