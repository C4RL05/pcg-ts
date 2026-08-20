#!/usr/bin/env node
/**
 * Capture one frame per corpus graph for the gallery: the cooked scene,
 * and the node graph that produced it.
 *
 * Usage:
 *   node scripts/capture-gallery.mjs                  all of them
 *   node scripts/capture-gallery.mjs --only=basics-p  the matching subset
 *   node scripts/capture-gallery.mjs --no-build       reuse the built site
 *   node scripts/capture-gallery.mjs --debug          per-sample settling
 *
 * This is what makes `docs/gallery.html` reproducible from a clean clone.
 * Every graph is opened once at `?graph=<name>` and shot TWICE off the
 * same cook, using the editor's own layer toggles: the scene with the node
 * overlay off, then the node graph with the scene off and `fit` pressed.
 * The chrome — toolbar, knobs, inspector — is hidden either way; it is
 * identical in all of them and would spend the frame on nothing.
 *
 * Readiness is the editor's own instrumentation, never a fixed sleep: the
 * status line carries a hash once a cook has landed, and the shared
 * `waitForStableFrame` then holds out for byte-identical frames. A graph
 * that never gets there is REPORTED AND LEFT WITHOUT A FRAME rather than
 * photographed mid-cook — the page marks a card with no frame, which is
 * the honest outcome, and this script exits non-zero so nobody has to
 * notice on their own.
 *
 * THE TWO VIEWPORTS ARE DIFFERENT ON PURPOSE, and both were arrived at by
 * looking at the result:
 *
 *  - The scene is laid out at 240x160 CSS and supersampled 3x. Point
 *    sprites draw at a fixed PIXEL size, so their share of the frame is
 *    set by the CSS viewport and not by the device pixels behind it. A
 *    small viewport supersampled hard is what makes a 500-point scatter
 *    read as a scatter instead of as dust.
 *  - The node canvas wants the opposite: `fit` reserves a fixed 40px of
 *    breathing room on every side, so in a 240x160 viewport it spends a
 *    third of the width on padding and the graph lands tiny in the
 *    middle. 720x480 at 2x gives it room, and the zoom `fit` picks is a
 *    ratio, so the graph fills the frame either way.
 *
 * Both land on 720x480 device pixels, which is what the gallery displays.
 *
 * Frames are written as PNG under `node_modules/.cache/pcg-gallery/`, and
 * the run finishes by handing those to `scripts/gen-gallery.mjs`, which
 * owns the WebP encode and the page. Capture and encode stay separate so
 * that re-encoding never needs a browser and re-capturing never needs to
 * know what the page looks like.
 *
 * Needs `npm run build` first, for the same reason gen-gallery does.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCaptureSite,
  frameCounterScript,
  launchCaptureBrowser,
  serveDir,
  sleep,
  waitForStableFrame,
} from "./lib/capture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GRAPHS_DIR = join(ROOT, "graphs");
/** The same built site `npm run capture` uses — one build serves both. */
const SITE_DIR = join(ROOT, "node_modules", ".cache", "pcg-capture");
const FRAMES_DIR = join(ROOT, "node_modules", ".cache", "pcg-gallery");
const SCENE_DIR = join(FRAMES_DIR, "scenes");
const GRAPH_DIR = join(FRAMES_DIR, "graphs");

const SCENE = { width: 240, height: 160, dpr: 3 };
const GRAPH = { width: 720, height: 480, dpr: 2 };

/** Everything that is chrome rather than the picture. Injected on every navigation. */
const HIDE = ".toolbar, .panel, .toast, .inspector, .overview { display: none !important; }";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const noBuild = args.includes("--no-build");
const DEBUG = args.includes("--debug");
const log = (m) => process.stdout.write(`${m}\n`);

const names = readdirSync(GRAPHS_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => basename(file, ".json"))
  .sort()
  .filter((name) => !only || only.split(",").some((part) => name.includes(part.trim())));

if (names.length === 0) {
  console.error(`capture-gallery: --only=${only} matched no graph under graphs/`);
  process.exit(2);
}

/**
 * Set one of the editor's layer toggles to a known state.
 *
 * Selected by the class that says what the control IS rather than by its
 * label: `button.view.scene` and `button.view.graph` exist for this
 * tooling and publish `aria-pressed`. A label is presentation and moves.
 */
const setLayer = (page, which, on) =>
  page.evaluate(
    ({ which, on }) => {
      const button = document.querySelector(`.toolbar button.view.${which}`);
      if (!button) throw new Error(`no .toolbar button.view.${which}`);
      if ((button.getAttribute("aria-pressed") === "true") !== on) button.click();
    },
    { which, on },
  );

const useViewport = (page, v) =>
  page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: v.dpr });

const clipOf = (v) => ({ x: 0, y: 0, width: v.width, height: v.height });

/** The status line carries a hash once a cook has landed, and the load toast has expired. */
const ready = (page) =>
  page.waitForFunction(
    () => {
      const status = document.querySelector(".toolbar .status");
      return (
        !!status &&
        /hash [0-9a-f]{8}/.test(status.textContent || "") &&
        !document.querySelector(".toast")
      );
    },
    { timeout: 30_000, polling: 200 },
  );

/**
 * A fresh page, wired for capture.
 *
 * ONE PAGE PER GRAPH, and it is not a style choice. Driving all 67 loads
 * through a single page walks the renderer into a crash somewhere around
 * the twentieth — every graph builds a WebGL context, and the ones that
 * have been navigated away from are not reclaimed fast enough to keep up.
 * The failure is not local either: once the target is gone, every graph
 * after it fails too, so a run that dies at 20 reports 47 false negatives.
 * A page per graph bounds what one cook can hold and turns a crash back
 * into a single missing frame.
 */
async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(frameCounterScript);
  await page.evaluateOnNewDocument((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    });
  }, HIDE);
  return page;
}

async function captureGraph(page, origin, name) {
  // THE VIEWPORT IS SET BEFORE THE NAVIGATION, and that ordering is the
  // whole reason these frames agree with each other. The editor places
  // the camera once, when a graph loads, and then leaves it alone — so
  // the viewport in effect AT THAT MOMENT is what every frame is composed
  // against. Resizing after `goto` makes the composition depend on
  // whether the cook beat the resize, and on what the previous graph in
  // the loop happened to leave behind: the first graph of a run comes out
  // framed differently from the rest. Set it first and the question never
  // arises.
  await useViewport(page, SCENE);
  await page.goto(`${origin}/editor/?graph=${name}`, { waitUntil: "domcontentloaded" });

  // --- the scene, with the node overlay down -----------------------------
  await ready(page);
  await setLayer(page, "graph", false);
  await setLayer(page, "scene", true);
  await waitForStableFrame(page, { clip: clipOf(SCENE), debug: DEBUG, log });
  await writeFile(
    join(SCENE_DIR, `${name}.png`),
    await page.screenshot({ type: "png", clip: clipOf(SCENE) }),
  );

  // --- the same cook, the other layer ------------------------------------
  // Order matters: `fit` is disabled while the graph layer is down, so the
  // layer goes up first. There is no state with neither layer up, so the
  // scene has to be switched off SECOND or the toggle would swap instead
  // of clear.
  await useViewport(page, GRAPH);
  await setLayer(page, "graph", true);
  await setLayer(page, "scene", false);
  // Fitted AFTER the resize, and after a beat: `fit` measures the canvas'
  // client rect, and one computed against the previous viewport puts the
  // graph somewhere that is not the middle of this one.
  await sleep(250);
  await page.evaluate(() => {
    const button = document.querySelector('.toolbar button[aria-label="fit"]');
    if (!button) throw new Error("no fit button");
    button.click();
  });
  await waitForStableFrame(page, { clip: clipOf(GRAPH), debug: DEBUG, log });
  await writeFile(
    join(GRAPH_DIR, `${name}.png`),
    await page.screenshot({ type: "png", clip: clipOf(GRAPH) }),
  );
}

async function main() {
  if (!noBuild) {
    log("building the browser pages (vite, production)…");
    await buildCaptureSite({ root: ROOT, outDir: SITE_DIR });
  } else if (!existsSync(SITE_DIR)) {
    throw new Error(`--no-build but ${SITE_DIR} does not exist; run once without it`);
  }

  await mkdir(SCENE_DIR, { recursive: true });
  await mkdir(GRAPH_DIR, { recursive: true });

  const { server, port } = await serveDir(SITE_DIR);
  const origin = `http://127.0.0.1:${port}`;
  log(`serving ${SITE_DIR} at ${origin}`);

  const browser = await launchCaptureBrowser({ width: 820, height: 620 });

  const failed = [];
  try {
    for (const [index, name] of names.entries()) {
      const at = `[${index + 1}/${names.length}] ${name}`;
      // Two attempts, because the failures worth retrying are the ones
      // that say nothing about the graph: a renderer that went down on
      // the previous page, a cook that lost its window. A graph that is
      // genuinely unphotographable fails the same way twice and costs
      // one extra load to prove it.
      let why = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        // Opening the page is inside the try as well: if the BROWSER is
        // what died, that throw belongs in this graph's report like any
        // other, not thrown through the loop that is keeping the run's
        // score.
        let page = null;
        try {
          page = await newPage(browser);
          await captureGraph(page, origin, name);
          why = null;
          break;
        } catch (err) {
          why = err instanceof Error ? err.message : String(err);
          if (attempt === 1) log(`${at}  retrying — ${why}`);
        } finally {
          if (page !== null && !page.isClosed()) await page.close().catch(() => {});
        }
      }
      if (why === null) log(`${at}  ok`);
      else {
        failed.push({ name, why });
        log(`${at}  FAILED — ${why}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  log("");
  const encode = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "gen-gallery.mjs"), `--scenes=${SCENE_DIR}`, `--graphs=${GRAPH_DIR}`],
    { stdio: "inherit" },
  );
  if (encode.status !== 0) process.exit(encode.status ?? 1);

  log("");
  log(`capture-gallery: ${names.length - failed.length} of ${names.length} captured`);
  if (failed.length > 0) {
    log(`capture-gallery: ${failed.length} never settled and have no new frame:`);
    for (const { name, why } of failed) log(`  ${name} — ${why}`);
    process.exit(1);
  }
}

await main();
