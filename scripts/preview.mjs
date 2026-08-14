#!/usr/bin/env node
/**
 * preview.mjs — render an arbitrary serialized graph and write the frames.
 *
 *   npm run preview -- examples/graphs/basics-spawn-instances.json
 *   npm run preview -- my-forest.json --views hero,ground --extent 200
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A REPO SCRIPT AND NOT `pcg preview`
 *
 * three.js needs a real browser, and headless has been unreliable enough
 * here that `npm run capture` runs headed. A `pcg preview` subcommand
 * would therefore drag Chromium behind the published `bin` — either a
 * ~150 MB download on every install of a library that has zero runtime
 * dependencies, or a command that appears in `--help` and throws for
 * everyone but the maintainer. A shipped restriction outlives the release
 * that introduced it, so it stays a repo script.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 *
 * It exists so an agent authoring a graph can SEE it. Structure is
 * already checkable — `pcg validate`, `pcg cook --stats`, `pcg render`
 * (SVG, top-down) — and none of that answers "does this look like a
 * forest". The intended loop is: change one thing, re-render, compare
 * against reference imagery, critique, repeat.
 *
 * Two properties make that loop mean anything, and both are enforced here
 * rather than left to discipline:
 *
 *   HOLD THE SEED. A seed change moves every point, so an iteration that
 *   changes a parameter AND the seed produces two incomparable images.
 *   The seed is written into the sidecar next to every frame, and a
 *   change from the previous run is reported.
 *
 *   HOLD THE CAMERA. Auto-framing from the content's bounding box would
 *   re-frame on every edit. The page quantizes the extent to a coarse
 *   ladder so ordinary tuning leaves the pose bit-identical; when it does
 *   move, this script says so and says the images are not comparable.
 *   `--extent` pins it outright.
 *
 * GROUND LEVEL IS NOT OPTIONAL. `hero` and `top` both flatter placement:
 * a density that reads well from above can be a bald patch at eye height,
 * and the reference imagery this gets compared against is first-person.
 * `ground` stands inside the content at 1.7 m and looks across it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE LIBRARY ENDS
 *
 * The look is dominated by lighting, materials, tone mapping and post —
 * none of which pcg-ts touches. `castShadow` and `receiveShadow` are set
 * by the preview page, never by `src/three`. Expect critique of these
 * images to land on renderer and asset work as often as on generation;
 * what pcg-ts is answerable for is PLACEMENT — density, slope, declutter,
 * species mix, clearings, trails.
 *
 * ---------------------------------------------------------------------------
 * KNOWN LIMITATIONS
 *
 * Found by review, left in deliberately. Each is a picture that is
 * legitimate but answers less than it appears to, so read the sidecar
 * before concluding anything from the frame alone.
 *
 *   - **Several items in one collection are indistinguishable.** Every
 *     geometry draws in the same colour, so `partitionByAttribute`'s
 *     three outputs are three identical white clouds and a graph whose
 *     SUBJECT is the split shows you nothing. The sidecar lists each item
 *     separately, which is the reliable read. Tinting per item is not the
 *     fix it looks like: the standard `color` attribute is minted white
 *     on every cloud, so its presence carries no intent and there is no
 *     way to tell "default white" from "authored white" — the same
 *     reasoning that made `spawnInstances`' `colorAttr` opt-in.
 *
 *   - **Concurrent runs fight over the foreground window.** Both open a
 *     headed browser at the same position, and Chrome stops painting the
 *     one it believes is occluded. There is no lock; the symptom is a
 *     screenshot that times out after three minutes with a CDP message
 *     naming nothing in this codebase. Run one at a time.
 *
 *   - **Untagged topology is a guess.** `Geometry.setTopology` is public
 *     and stamps no `primtype`, so the exporters infer the kind from
 *     vertex count: three or more vertices reads as a triangle. An
 *     untagged polyline of three points therefore renders as a filled
 *     face. The sidecar flags it (`untagged: true`) — nothing else will.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  encodeJpeg,
  frameCounterScript,
  launchCaptureBrowser,
  waitForStableFrame,
} from "./lib/capture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUALITY = 0.92;

const USAGE = `usage: npm run preview -- <graph.json> [options]

  --out DIR       where to write frames and the sidecar (default preview/)
  --label NAME    output basename (default the graph file's stem)
  --views LIST    comma-separated subset of hero,ground,top (default all)
  --seed N        override the graph's seed
  --extent N      pin the framing extent in world units
  --eye N         ground-camera eye height in world units (default 1.7)
  --size WxH      capture size in CSS pixels (default 1280x720)
  --points        draw points even for geometries that carry topology
  --grid          add a ground grid
  --keep-open     leave the browser open for manual inspection`;

function parseArgs(argv) {
  const opts = { views: null, out: "preview", size: [1280, 720] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      // Refusing an option-shaped value turns `--out --grid` from a
      // directory literally named "--grid" into an error.
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} needs a value\n\n${USAGE}`);
      }
      return next;
    };
    const number = (name, { positive = false } = {}) => {
      const raw = value();
      const n = Number(raw);
      // Number("") is 0, so an empty --seed would silently reseed to 0.
      if (raw.trim() === "" || !Number.isFinite(n)) {
        throw new Error(`${name} must be a finite number, got "${raw}"\n\n${USAGE}`);
      }
      if (positive && n <= 0) throw new Error(`${name} must be greater than 0\n\n${USAGE}`);
      return n;
    };
    if (arg === "--out") opts.out = value();
    else if (arg === "--label") opts.label = value();
    else if (arg === "--views") {
      opts.views = value()
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      // An empty list is not nullish, so it would survive the `??`
      // below and render zero frames with exit 0.
      if (opts.views.length === 0) throw new Error(`--views listed no views\n\n${USAGE}`);
    } else if (arg === "--seed") opts.seed = number("--seed");
    else if (arg === "--extent") opts.extent = number("--extent", { positive: true });
    else if (arg === "--eye") opts.eye = number("--eye", { positive: true });
    else if (arg === "--points") opts.points = true;
    else if (arg === "--grid") opts.grid = true;
    else if (arg === "--keep-open") opts.keepOpen = true;
    else if (arg === "--size") {
      const m = /^(\d+)x(\d+)$/.exec(value());
      if (!m) throw new Error(`--size wants WxH, e.g. 1600x900\n\n${USAGE}`);
      opts.size = [Number(m[1]), Number(m[2])];
    } else if (arg === "--help" || arg === "-h") {
      // Asking for help is not a failure: stdout, exit 0.
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}\n\n${USAGE}`);
    } else positional.push(arg);
  }
  if (positional.length !== 1) {
    throw new Error(`expected exactly one graph file, got ${positional.length}\n\n${USAGE}`);
  }
  opts.graphPath = resolve(positional[0]);
  opts.label ??= basename(opts.graphPath, extname(opts.graphPath));
  return opts;
}

/** Read and parse the graph, stripping a BOM as the CLI's loader does. */
async function loadGraph(path) {
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  let text = await readFile(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

/**
 * What changed since the last run of this label. Reported rather than
 * enforced: re-framing is legitimate, comparing ACROSS it is not.
 *
 * The comparison is over the poses themselves, not over the extent that
 * derives them. Checking the extent alone lets `--eye`, `--size` and any
 * shift of the content's centre move all three cameras while the tool
 * announces the run is comparable — a wrong claim about the only thing
 * this tool is for.
 */
function compareWithPrevious(previous, current) {
  if (previous === undefined) return [];
  const notes = [];
  if (previous.seed !== current.seed) {
    notes.push(
      `seed ${previous.seed} -> ${current.seed}: every point moved, so these frames are NOT ` +
        "comparable to the last run. Hold the seed to compare one change at a time.",
    );
  }
  if (JSON.stringify(previous.views) !== JSON.stringify(current.views)) {
    const before = previous.framing?.extent;
    const after = current.framing?.extent;
    notes.push(
      `the camera moved, so these frames are NOT comparable to the last run` +
        (before !== after ? ` (framing extent ${before} -> ${after}; --extent ${before} holds it)` : "") +
        ".",
    );
  }
  if (JSON.stringify(previous.size) !== JSON.stringify(current.size)) {
    notes.push(`capture size ${previous.size?.join("x")} -> ${current.size.join("x")}.`);
  }
  return notes;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (m) => process.stdout.write(`${m}\n`);
  const graph = await loadGraph(opts.graphPath);

  const outDir = resolve(opts.out);
  await mkdir(outDir, { recursive: true });
  const sidecarPath = join(outDir, `${opts.label}.json`);
  let previous;
  if (existsSync(sidecarPath)) {
    try {
      previous = JSON.parse(await readFile(sidecarPath, "utf8"));
    } catch {
      // A corrupt sidecar costs the comparison, not the run.
    }
  }

  const job = {
    graph,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.extent !== undefined ? { extent: opts.extent } : {}),
    ...(opts.eye !== undefined ? { eye: opts.eye } : {}),
    ...(opts.points ? { points: true } : {}),
    ...(opts.grid ? { grid: true } : {}),
  };

  // The vite DEV server, not a build: the aliases in examples/vite.config.ts
  // point at src/, so the preview always exercises current source, and an
  // iterate-and-look loop pays no build per cycle.
  const server = await createServer({
    configFile: join(ROOT, "examples", "vite.config.ts"),
    logLevel: "warn",
    server: { port: 0 },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");

  // Inside the try, or a browser that fails to launch leaves the server
  // listening with no `finally` to close it and node never exits.
  const errors = [];
  let failed = false;
  let browser;
  try {
    browser = await launchCaptureBrowser({
      width: opts.size[0] + 120,
      height: opts.size[1] + 160,
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) {
        errors.push(`console: ${m.text()}`);
      }
    });
    await page.evaluateOnNewDocument(frameCounterScript);
    await page.evaluateOnNewDocument((injected) => {
      window.__PCG_PREVIEW_JOB__ = injected;
    }, job);
    await page.setViewport({ width: opts.size[0], height: opts.size[1], deviceScaleFactor: 2 });
    await page.bringToFront();
    await page.goto(`${origin}/preview/`, { waitUntil: "load" });

    // The page reports its own state, so a cook failure surfaces as the
    // library's error message rather than as a blank screenshot.
    await page.waitForFunction(() => window.__pcgPreview?.state !== "loading", { polling: 100 });
    const state = await page.evaluate(() => ({
      state: window.__pcgPreview.state,
      error: window.__pcgPreview.error,
      views: window.__pcgPreview.views,
      report: window.__pcgPreview.report,
    }));
    if (state.state === "error") throw new Error(state.error);

    const wanted = opts.views ?? state.views;
    const unknown = wanted.filter((v) => !state.views.includes(v));
    if (unknown.length > 0) {
      throw new Error(`unknown view(s) ${unknown.join(", ")}; this page has: ${state.views.join(", ")}`);
    }

    // rAF liveness before anything is judged stable.
    await page.waitForFunction(() => window.__capFrames > 3, { timeout: 20_000 });

    const encPage = await browser.newPage();
    await encPage.goto("about:blank");

    const frames = [];
    for (const view of wanted) {
      const t0 = Date.now();
      await page.evaluate((name) => window.__pcgPreview.setView(name), view);
      // No `signal`: this page has no counters, and a constant signal
      // would "plateau" over a picture still visibly changing.
      const stability = await waitForStableFrame(page, {
        clip: { x: 0, y: 0, width: opts.size[0], height: opts.size[1] },
        log,
      });
      // Checked BEFORE the write, not once at the end. The frame counter
      // is its own rAF chain, so a render callback that throws leaves the
      // canvas holding the previous view's pixels — three identical
      // screenshots, criterion satisfied, and a stale image written under
      // the new view's name.
      if (errors.length > 0) {
        throw new Error(
          `page reported ${errors.length} error(s) before the "${view}" frame: ` +
            errors.slice(0, 3).join(" | "),
        );
      }
      const shot = await page.screenshot({ type: "png", optimizeForSpeed: true });
      // Loosened from the demo-screenshot defaults on purpose, and the
      // measurements are from real frames of the corpus. A sparse cloud
      // seen from directly above is a few thousand lit pixels over a
      // uniform ground — correct, useful, luma sd ~2 — and a flat mesh
      // at eye height is sky over surface, eleven 5-bit colour buckets
      // in total. Both are exactly right and both failed the demo
      // thresholds. The failure still worth catching is a lost WebGL
      // context, and that clears to ONE flat colour: sd ~0, one or two
      // buckets. The floors sit just above that and nowhere near real
      // content.
      const image = await encodeJpeg(encPage, shot.toString("base64"), opts.size, QUALITY, {
        minSd: 1,
        minTones: 4,
      });
      const file = `${opts.label}.${view}.jpg`;
      await writeFile(join(outDir, file), image.buffer);
      frames.push({
        view,
        file,
        bytes: image.buffer.length,
        stability: stability.criterion,
        elapsedMs: Date.now() - t0,
      });
      log(
        `  ${view.padEnd(7)} ${file}  ${(image.buffer.length / 1024).toFixed(0)} KB  ` +
          `stable via ${stability.criterion} in ${(stability.elapsed / 1000).toFixed(1)}s`,
      );
    }

    if (errors.length > 0) {
      throw new Error(`page reported ${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
    }

    // `relative`, not a slice of ROOT: the header advertises arbitrary
    // paths, and slicing chops a fixed prefix length off one that does
    // not start with ROOT. Timings live in their own block so everything
    // above them diffs cleanly between two runs — the sidecar is meant
    // to be compared, and elapsed milliseconds never repeat.
    const sidecar = {
      graph: relative(ROOT, opts.graphPath).replace(/\\/g, "/"),
      size: opts.size,
      ...state.report,
      frames: frames.map(({ elapsedMs, ...rest }) => rest),
      timing: {
        cookMs: state.report?.cook?.elapsedMs,
        frames: Object.fromEntries(frames.map((f) => [f.view, f.elapsedMs])),
      },
    };
    if (sidecar.cook !== undefined) delete sidecar.cook.elapsedMs;
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
    log(`  sidecar ${basename(sidecarPath)}`);

    const notes = compareWithPrevious(previous, sidecar);
    for (const note of notes) log(`\n  ! ${note}`);
    if (notes.length === 0 && previous !== undefined) {
      log(`\n  seed and framing unchanged — comparable to the previous run.`);
    }

    if (opts.keepOpen) {
      log("\n--keep-open: the browser stays up. Ctrl-C when done.");
      await new Promise(() => {});
    }
  } catch (err) {
    failed = true;
    process.stderr.write(`\npreview failed: ${err.message}\n`);
    if (errors.length > 0) process.stderr.write(`page errors: ${errors.join("\n  ")}\n`);
    // A failed run is exactly when --keep-open is worth having, so say so
    // rather than closing the window that holds the evidence.
    if (opts.keepOpen && browser !== undefined) {
      process.stderr.write("--keep-open: the browser stays up. Ctrl-C when done.\n");
      await new Promise(() => {});
    }
  } finally {
    if (!opts.keepOpen && browser !== undefined) await browser.close();
    await server.close();
  }
  if (failed) process.exitCode = 1;
}

await main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
