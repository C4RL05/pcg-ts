/**
 * `docs/gallery.html` is generated from the corpus under `graphs/` and the
 * frames under `docs/gallery/`, and nothing in the build regenerates it —
 * so it drifts silently. Adding an example, retitling one, or wiring in
 * another node changes what the page should say; the committed page only
 * changes if someone remembers to run the generator.
 *
 * This pins them together the way graphIndex.test.ts pins the prose index:
 * render through the same module the generator uses (imported from source,
 * so `npm test` works on a fresh clone with no build) and compare bytes.
 * If it fails, the fix is `npm run build && npm run docs:gallery`.
 *
 * A missing FRAME is deliberately not a failure. Capturing one drives a
 * real browser, so a graph can legitimately land before its picture does —
 * the page marks it instead of dropping it. What is a failure is a card
 * pointing at a frame that is not there, which is the broken-image case a
 * reader would meet.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeExample, loadGraphs } from "./graphIndex.js";
import { galleryStats, renderGallery } from "./gallery.js";
import type { GalleryGolden } from "./gallery.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Committed docs are read through git, and a Windows checkout with
 * `core.autocrlf=true` materializes them with CRLF. The generator always
 * writes LF, so normalize rather than fail every Windows clone on line
 * endings the repository does not store.
 */
function readDoc(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../docs/${name}`, import.meta.url)), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
}

/** Where two texts first differ, as a short excerpt — never both whole files. */
function firstDifference(committed: string, generated: string): string {
  const a = committed.split("\n");
  const b = generated.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  committed: ${a[i] === undefined ? "<end of file>" : JSON.stringify(a[i])}`,
        `  generated: ${b[i] === undefined ? "<end of file>" : JSON.stringify(b[i])}`,
        `(${a.length} committed lines vs ${b.length} generated)`,
      ].join("\n");
    }
  }
  return "files differ only in trailing bytes";
}

const frameFiles = readdirSync(fileURLToPath(new URL("../../docs/gallery/", import.meta.url))).filter(
  (file) => file.endsWith(".webp"),
);
const frames = {
  scenes: frameFiles
    .filter((file) => !file.endsWith(".graph.webp"))
    .map((file) => file.slice(0, -".webp".length))
    .sort(),
  graphs: frameFiles
    .filter((file) => file.endsWith(".graph.webp"))
    .map((file) => file.slice(0, -".graph.webp".length))
    .sort(),
};

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

const stats = galleryStats(
  JSON.parse(
    readFileSync(new URL("../../tests/graphs.golden.json", import.meta.url), "utf8"),
  ) as GalleryGolden,
);

describe("corpus gallery", () => {
  const entries = loadGraphs(ROOT).map(describeExample);
  const generated = renderGallery(entries, { version, frames, stats });
  const committed = readDoc("gallery.html");

  it("docs/gallery.html is up to date with the corpus", () => {
    expect(committed, [
      "docs/gallery.html is stale: the corpus or the frames changed but the",
      "page was not regenerated. Run:",
      "",
      "  npm run build && npm run docs:gallery",
      "",
      firstDifference(committed, generated),
    ].join("\n")).toBe(generated);
  });

  it("gives every graph in the corpus a card", () => {
    for (const entry of entries) {
      const name = entry.file.replace(/\.json$/, "");
      expect(committed, `docs/gallery.html has no card for ${name}`).toContain(`id="${name}"`);
    }
  });

  it("references no frame that is not committed", () => {
    const referenced = [...committed.matchAll(/src="\.\/gallery\/([^"]+)"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(frameFiles, `docs/gallery.html points at docs/gallery/${file}, which is missing`).toContain(
        file,
      );
    }
  });

  it("renders a marked card rather than dropping a graph with no frame", () => {
    const [first, ...rest] = entries;
    if (first === undefined) throw new Error("gallery.test: the corpus is empty");
    const name = first.file.replace(/\.json$/, "");
    const withoutFirst = renderGallery(entries, {
      version,
      stats,
      frames: {
        scenes: frames.scenes.filter((n) => n !== name),
        graphs: frames.graphs.filter((n) => n !== name),
      },
    });
    expect(withoutFirst).toContain(`id="${name}"`);
    expect(withoutFirst).toContain("no frame captured");
    expect(withoutFirst).not.toContain(`src="./gallery/${name}.webp"`);
    // Every other card is untouched.
    for (const entry of rest) {
      expect(withoutFirst).toContain(`src="./gallery/${entry.file.replace(/\.json$/, "")}.webp"`);
    }
  });
});
