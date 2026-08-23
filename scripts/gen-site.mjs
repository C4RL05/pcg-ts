#!/usr/bin/env node
/**
 * Stamp the package version into the hand-authored Pages site
 * (docs/index.html, docs/manual.html).
 *
 * Usage: node scripts/gen-site.mjs
 *
 * These two pages have no generator behind them — the prose is written by
 * a person, and the roadmap entries in particular explain a mechanism and
 * name its limitation, which is not machine work. So only the version
 * stamps are generated, and only the sites explicitly marked with
 * `<!--pcg:version-->` … `<!--/pcg:version-->` are touched. The roadmap
 * carries a version string per release, and a rewrite that matched
 * version SYNTAX instead of those markers would silently overwrite the
 * whole release history with today's version.
 *
 * Making the stamps generated is what puts the pages behind the existing
 * "Generated artifacts are up to date" CI step (`npm run docs`, then
 * `git diff --exit-code -- docs`): publish a release without regenerating
 * and the diff is no longer empty. The counts stated in the prose and the
 * presence of a roadmap entry for the current version are checked by
 * src/docs/site.test.ts instead — those are assertions, not rewrites.
 *
 * This script is I/O only — read the pages, stamp them, say what changed.
 * The rewrite lives in src/docs/site.ts (imported here from dist) so the
 * test renders through the exact same code and cannot drift from it.
 *
 * Reads dist/docs/index.js (run `npm run build` first). Output is
 * deterministic and idempotent: the stamp text is a pure function of
 * package.json's version, and everything else in the file is passed
 * through byte for byte — including its newline style, so a CRLF checkout
 * is not rewritten wholesale.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
          `gen-site: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-site.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const docs = await importDist("../dist/docs/index.js");

if (typeof docs.renderSiteVersion !== "function" || !Array.isArray(docs.SITE_PAGES)) {
  console.error(
    "gen-site: dist/docs/index.js does not export renderSiteVersion()/SITE_PAGES; rebuild with `npm run build`.",
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

/**
 * The landing page's opening paragraphs, from the README.
 *
 * Read once, before the loop: it is one source for one hole, and a page
 * that has no hole simply does not get one — only `docs/index.html`
 * borrows it today, and `renderSiteLede` is only called where the markers
 * are. A missing README block, or markdown the converter does not
 * implement, stops the build here rather than publishing its own syntax.
 */
let ledeHtml;
try {
  const markdown = readFileSync(join(root, docs.LEDE_SOURCE), "utf8");
  ledeHtml = docs.ledeToHtml(docs.extractLede(markdown, docs.LEDE_SOURCE), docs.LEDE_SOURCE);
} catch (err) {
  console.error(`gen-site: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
}

const changed = [];
let stamps = 0;

for (const page of docs.SITE_PAGES) {
  const file = `docs/${page}`;
  const path = join(root, "docs", page);

  let html;
  try {
    html = readFileSync(path, "utf8");
  } catch (err) {
    console.error(
      `gen-site: cannot read ${file} — ${err && err.message ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  let result;
  try {
    result = docs.renderSiteVersion(html, version, file);
    // The lede goes in wherever a page opened a hole for it.
    if (result.html.includes("<!--pcg:lede-->")) {
      const withLede = docs.renderSiteLede(result.html, ledeHtml, file);
      result = { html: withLede.html, stamps: result.stamps + withLede.stamps };
    }
  } catch (err) {
    console.error(`gen-site: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }

  stamps += result.stamps;
  if (result.html !== html) {
    writeFileSync(path, result.html);
    changed.push(file);
  }
}

const what = changed.length === 0 ? "already current" : `updated ${changed.join(", ")}`;
console.log(`gen-site: stamped v${version} into ${stamps} sites across ${docs.SITE_PAGES.length} pages (${what})`);
