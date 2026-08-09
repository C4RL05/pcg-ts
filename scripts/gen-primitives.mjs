#!/usr/bin/env node
/**
 * Generate the primitive catalog (docs/primitives.md + docs/primitives.json)
 * from the built library's named-subgraph registry (`listSubgraphs()`).
 *
 * Usage: node scripts/gen-primitives.mjs
 *
 * This script is I/O only — read the registry, write the files, say what it
 * wrote. The rendering lives in src/docs/primitives.ts (imported here from
 * dist) so the drift test in src/docs/primitives.test.ts renders through the
 * exact same code and cannot drift from it.
 *
 * SOURCE OF TRUTH IS THE REGISTRY, not the recipe files a future phase will
 * ship. Reading recipes off disk would let the catalog generate cleanly while
 * the assets failed to register — a passing generator over a broken library.
 * Going through `listSubgraphs()` (and materializing each entry, which
 * `describePrimitive` does) proves they load.
 *
 * THE SHIPPED PRIMITIVES REGISTER ON IMPORT of `dist/primitives/index.js`,
 * which is why it is imported below purely for its side effect. BOTH this
 * script and src/docs/primitives.test.ts must import that module — they are
 * the two readers of the registry, and one of them importing it while the
 * other does not is exactly the drift the test exists to catch.
 *
 * Reads dist/index.js and dist/docs/index.js (run `npm run build` first).
 * Output is deterministic: primitives sorted by name, canonical key order,
 * LF newlines, no timestamp — running twice yields identical bytes.
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
          `gen-primitives: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-primitives.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const lib = await importDist("../dist/index.js");
const docs = await importDist("../dist/docs/index.js");
// Side effect only: this is what puts anything in the registry to read.
await importDist("../dist/primitives/index.js");

for (const [module, name, exported] of [
  ["dist/index.js", "listSubgraphs", lib.listSubgraphs],
  ["dist/docs/index.js", "describePrimitive", docs.describePrimitive],
  ["dist/docs/index.js", "renderPrimitiveCatalog", docs.renderPrimitiveCatalog],
]) {
  if (typeof exported !== "function") {
    console.error(`gen-primitives: ${module} does not export ${name}(); rebuild with \`npm run build\`.`);
    process.exit(1);
  }
}

const entries = lib.listSubgraphs();
const { json, markdown } = docs.renderPrimitiveCatalog(entries.map(docs.describePrimitive));

const docsDir = join(root, "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, "primitives.json"), json);
writeFileSync(join(docsDir, "primitives.md"), markdown);
console.log(
  `gen-primitives: wrote docs/primitives.md and docs/primitives.json (${entries.length} registered ${
    entries.length === 1 ? "primitive" : "primitives"
  })`,
);
