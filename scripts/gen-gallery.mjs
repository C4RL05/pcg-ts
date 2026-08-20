#!/usr/bin/env node
/**
 * Generate the corpus gallery (docs/gallery.html) from the graphs under
 * `graphs/` and the frames committed under `docs/gallery/`.
 *
 * Usage:
 *   node scripts/gen-gallery.mjs                     render the page
 *   node scripts/gen-gallery.mjs --scenes=<dir>      re-ingest the scene frames
 *   node scripts/gen-gallery.mjs --graphs=<dir>      re-ingest the node-graph frames
 *
 * This script is I/O only — read the graphs, read the frame listing, write
 * the page, say what it wrote. The rendering lives in src/docs/gallery.ts
 * (imported here from dist) so the drift test in src/docs/gallery.test.ts
 * renders through the exact same code and cannot drift from it.
 *
 * THE PAGE AND THE FRAMES ARE ON DIFFERENT CLOCKS, on purpose. Rendering
 * is pure text and runs in the `npm run docs` chain, so CI's staleness gate
 * catches a corpus change that the page has not caught up with. Capturing a
 * frame drives a real browser through the editor and cannot run in that
 * chain at all, so the frames are committed artifacts and re-ingesting them
 * is an explicit flag. Either directory of PNGs named `<graph>.png` will
 * do; what produces them is outside this repository's concern.
 *
 * Ingest converts to WebP at the size the page displays (720x480, cover) —
 * roughly a fifth of the PNG bytes at a quality where the dark scenes do
 * not band. It also DELETES frames whose graph has left the corpus, so a
 * renamed example cannot leave an orphan behind.
 *
 * Reads dist/docs/index.js (run `npm run build` first). Output is
 * deterministic: entries sorted by file name, LF newlines, no timestamp —
 * running twice yields identical bytes.
 */
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);
const OUT_DIR = join(root, "docs", "gallery");
const OUT_PAGE = join(root, "docs", "gallery.html");

/** The size the page displays a frame at, and what ingest writes. */
const FRAME = { width: 720, height: 480 };
/** Dark point clouds band badly, so this sits higher than a photo would need. */
const QUALITY = { scene: 0.9, graph: 0.88 };

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
          `gen-gallery: ${relative.replace("../", "")} not found — the library is not built.`,
          "Run `npm run build` first, then re-run:",
          "  node scripts/gen-gallery.mjs",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }
}

const docs = await importDist("../dist/docs/index.js");

for (const [name, exported] of [
  ["loadGraphs", docs.loadGraphs],
  ["describeExample", docs.describeExample],
  ["renderGallery", docs.renderGallery],
  ["galleryStats", docs.galleryStats],
]) {
  if (typeof exported !== "function") {
    console.error(
      `gen-gallery: dist/docs/index.js does not export ${name}(); rebuild with \`npm run build\`.`,
    );
    process.exit(1);
  }
}

const flag = (name) => {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};

const entries = docs.loadGraphs(root).map(docs.describeExample);
const names = entries.map((entry) => entry.file.replace(/\.json$/, ""));

/* ------------------------------------------------------------------ *
 * Ingest (optional)
 * ------------------------------------------------------------------ */

/**
 * Re-encode `<dir>/<name>.png` to `docs/gallery/<name>[.graph].webp`.
 *
 * The encoder is a headless browser rather than an image library: this
 * repository already depends on one for the demo captures, and adding a
 * native image dependency to shrink 67 files twice a year is a worse
 * trade. `cover` is the same crop the page's `object-fit` would apply, so
 * what lands on disk is what the card shows.
 */
async function ingest(dir, kind) {
  const require = createRequire(join(root, "package.json"));
  const puppeteer = require("puppeteer");
  const suffix = kind === "graph" ? ".graph.webp" : ".webp";
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const written = [];
  const absent = [];

  for (const name of names) {
    let png;
    try {
      png = readFileSync(join(dir, `${name}.png`));
    } catch {
      absent.push(name);
      continue;
    }
    const dataUrl = await page.evaluate(
      async ({ src, width, height, quality }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // `cover`: fill the frame, crop the overflow, never distort.
        const scale = Math.max(width / img.width, height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        return canvas.toDataURL("image/webp", quality);
      },
      {
        src: `data:image/png;base64,${png.toString("base64")}`,
        width: FRAME.width,
        height: FRAME.height,
        quality: QUALITY[kind],
      },
    );
    writeFileSync(join(OUT_DIR, name + suffix), Buffer.from(dataUrl.split(",")[1], "base64"));
    written.push(name);
  }

  await browser.close();
  console.log(`gen-gallery: ingested ${written.length} ${kind} frames from ${dir}`);
  if (absent.length > 0) {
    console.log(`gen-gallery: no ${kind} frame for ${absent.length}: ${absent.join(", ")}`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

const scenesFrom = flag("scenes");
const graphsFrom = flag("graphs");
if (scenesFrom !== null) await ingest(scenesFrom, "scene");
if (graphsFrom !== null) await ingest(graphsFrom, "graph");

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

const files = readdirSync(OUT_DIR).filter((file) => file.endsWith(".webp"));
const frames = {
  scenes: files.filter((f) => !f.endsWith(".graph.webp")).map((f) => f.slice(0, -".webp".length)),
  graphs: files.filter((f) => f.endsWith(".graph.webp")).map((f) => f.slice(0, -".graph.webp".length)),
};

// A frame whose graph left the corpus is dead weight the page cannot show.
// Only an ingest run removes it: rendering must never touch the artifacts
// it reads, or CI's staleness check would start deleting files.
const orphans = [...new Set([...frames.scenes, ...frames.graphs])].filter(
  (name) => !names.includes(name),
);
if (orphans.length > 0) {
  if (scenesFrom === null && graphsFrom === null) {
    console.log(`gen-gallery: ${orphans.length} frames for graphs no longer in the corpus:`);
    console.log(`  ${orphans.join(", ")}`);
    console.log("  Re-run with --scenes=<dir> or --graphs=<dir> to clear them.");
  } else {
    for (const name of orphans) {
      rmSync(join(OUT_DIR, `${name}.webp`), { force: true });
      rmSync(join(OUT_DIR, `${name}.graph.webp`), { force: true });
    }
    console.log(`gen-gallery: removed ${orphans.length} orphaned frames: ${orphans.join(", ")}`);
    frames.scenes = frames.scenes.filter((name) => names.includes(name));
    frames.graphs = frames.graphs.filter((name) => names.includes(name));
  }
}

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// The counts under each card come from the corpus golden rather than from a
// cook here: it is the same record the corpus test asserts against, so the
// caption cannot drift from the assertion, and `npm run docs` stays text.
const golden = JSON.parse(readFileSync(join(root, "tests", "graphs.golden.json"), "utf8"));
const html = docs.renderGallery(entries, {
  version,
  frames: { scenes: frames.scenes.sort(), graphs: frames.graphs.sort() },
  stats: docs.galleryStats(golden),
});
writeFileSync(OUT_PAGE, html, "utf8");

const without = names.filter((name) => !frames.scenes.includes(name));
console.log(
  `gen-gallery: wrote docs/gallery.html (${entries.length} graphs, ${frames.scenes.length} scene + ${frames.graphs.length} graph frames)`,
);
if (without.length > 0) {
  console.log(`gen-gallery: ${without.length} graphs have no scene frame: ${without.join(", ")}`);
}
