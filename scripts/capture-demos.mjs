#!/usr/bin/env node
/**
 * capture-demos.mjs — regenerate docs/manual-assets/*.jpg and docs/thumbs/*.jpg
 * from the nine browser demos in examples/.
 *
 * Run with `npm run capture` (optionally `-- --only=04,07` / `--no-build`).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 *
 * These 18 JPEGs are committed and are referenced from docs/manual.html and
 * docs/index.html with hard-coded width/height attributes. They used to be
 * produced by an ad-hoc script that lived on one machine, so they drifted
 * silently whenever a demo changed. Everything below is the set of things that
 * script got wrong, encoded so the next person does not have to rediscover
 * them.
 *
 * ---------------------------------------------------------------------------
 * THE READINESS SIGNAL (the important part)
 *
 * These demos cook asynchronously, stream cells over many frames, and several
 * of them animate forever. A fixed `sleep(n)` is what makes a capture script
 * flaky a year later: it silently starts photographing a half-cooked world the
 * moment the machine, the GPU or the demo gets slower. So nothing here sleeps
 * for a fixed duration. Three signals gate every shot, in order:
 *
 *   1. rAF LIVENESS. `evaluateOnNewDocument` installs a requestAnimationFrame
 *      counter (`window.__capFrames`). Before and during every wait we require
 *      it to keep increasing. A backgrounded or occluded tab stops servicing
 *      rAF, which is exactly how you end up with an empty frame in the file;
 *      here that fails loudly instead.
 *
 *   2. DEMO-DECLARED COOK STATE. Every demo already publishes its own state as
 *      text: the shared overlay (examples/shared/overlay.ts) renders one
 *      `.pcg-stat` per readout as `<span>label</span><span>value</span>`, and
 *      every value starts as an en dash "–" until the demo writes it. That
 *      makes the demo's own instrumentation the readiness signal — no
 *      demo-side hooks were added for this script. Per demo we wait for the
 *      specific stat that means "the cook is done": `cook` leaving "–" (01,
 *      03), `build + evaluate` (05), the toolbar leaving "cooking…" (06),
 *      `pending` reaching 0 for the streaming worlds (04, 07), the panel's
 *      `cook` reading "idle" (08), and the two demos that expose a real probe
 *      object use it (`window.pcgForest`, `window.pcgWorld`).
 *
 *   3. A STABLE FRAME. Cook-complete is not the same as settled, so after (2)
 *      we sample repeatedly and only shoot once the picture stops changing.
 *      Two acceptance criteria, and the script reports which one it used:
 *        - "pixel": three consecutive byte-identical PNG screenshots of a clip
 *          region covering only the 3D viewport (the overlay is excluded
 *          because its fps counter ticks every 500 ms and would never settle).
 *        - "stats-plateau": for demos that animate by design and can never be
 *          pixel-identical (07 twinkles star shaders on a clock), the demo's
 *          own non-volatile counters holding steady over several samples.
 *      Neither converging inside the budget is a hard failure.
 *
 * DETERMINISM. Every demo hard-codes its seed (1, or 42 for the galaxy) and
 * reads no URL parameters, so content is already reproducible. What is not
 * reproducible is the camera: 04 flies forward at 18 u/s from t=0, 09 has
 * autopilot on, and 07 cruises. Each of those is stopped through its own UI
 * *before* waiting for the world to settle, so the camera sits at its initial
 * position and the framing does not depend on how fast the machine booted.
 *
 * OTHER HARD-WON CONSTRAINTS
 *   - Headed, not headless. Two demos are WebGPU and want a real device;
 *     headless has historically produced a blank or fallback render.
 *   - deviceScaleFactor 2 — the assets are supersampled and resampled down, so
 *     the committed pixels are 2x-sampled.
 *   - One page at a time, and it is always brought to the front. Chrome also
 *     stops painting a window it believes is occluded, hence the
 *     CalculateNativeWinOcclusion / renderer-backgrounding flags below.
 *   - The built demos are served from a static server, not the vite dev
 *     server, so the captures show what actually ships.
 *   - Sizes are NOT invented here. docs/manual.html and docs/index.html pin
 *     width/height per image; SIZES below reproduces exactly those pixel
 *     dimensions. Change one and you must change the HTML that declares it.
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import puppeteer from "puppeteer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "node_modules", ".cache", "pcg-capture");
const MANUAL_DIR = join(ROOT, "docs", "manual-assets");
const THUMB_DIR = join(ROOT, "docs", "thumbs");

// JPEG quality for the two outputs. Dark 3D renders band badly in shadow, so
// these sit higher than a photo would need.
const DEBUG = process.argv.includes("--debug");
const MANUAL_QUALITY = 0.9;
const THUMB_QUALITY = 0.85;

// Every thumbnail is 640x345 (docs/index.html declares that for all nine), and
// 1454x783 is the CSS layout that gives it its aspect ratio and the panel
// proportions the existing thumbnails have.
const THUMB = { css: [1454, 783], out: [640, 345], quality: THUMB_QUALITY };

/**
 * Per demo: the CSS viewport to lay the page out at, and the pixel size to
 * write. `out` is either equal to `css` (captured at 2x, resampled down) or
 * exactly 2x `css` (kept at native 2x). Both come straight from the
 * width/height attributes in docs/manual.html.
 */
const SIZES = {
  "01-scatter-basic": { css: [1400, 860], out: [2800, 1720] },
  "02-forest": { css: [1400, 845], out: [1400, 845] },
  "03-spline-fence": { css: [1454, 783], out: [1454, 783] },
  "04-infinite-world": { css: [1454, 783], out: [1454, 783] },
  "05-fields-playground": { css: [1454, 783], out: [1454, 783] },
  "06-graph-editor": { css: [1454, 783], out: [1454, 783] },
  "07-galaxy": { css: [1454, 783], out: [1454, 783] },
  "08-gpu-fields": { css: [1366, 900], out: [1366, 900] },
  "09-gpu-world": { css: [1079, 791], out: [1079, 791] },
};

/**
 * Readiness predicates. Each runs in the page with `s` bound to the demo's
 * overlay stats (label -> value). `has(v)` means "the demo has written this
 * readout at least once" (it starts life as an en dash).
 */
const DEMOS = [
  {
    id: "01-scatter-basic",
    ready: (s, has) => has(s["cook"]) && has(s["instances"]),
  },
  {
    id: "02-forest",
    ready: (s, has) =>
      !!window.pcgForest &&
      window.pcgForest.probe().mode !== null &&
      has(s["status"]) &&
      !/initialising|cooking/i.test(s["status"]),
  },
  {
    id: "03-spline-fence",
    ready: (s, has) => has(s["cook"]) && has(s["posts"]),
  },
  {
    id: "04-infinite-world",
    // The GPU adapter resolving triggers a full world rebuild, so "pending is
    // 0" only means anything once the adapter question has been answered.
    ready: (s, has) =>
      has(s["adapter"]) &&
      !/requesting/i.test(s["adapter"]) &&
      s["pending"] === "0" &&
      has(s["instances"]) &&
      s["instances"] !== "0",
    // Freeze the flying camera at its start position before anything settles,
    // so the framing does not depend on how long the boot took.
    settleWait: () => !!window.__capRow("speed"),
    settle: () => setRangeByLabel("speed", 0),
  },
  {
    id: "05-fields-playground",
    ready: (s, has) => has(s["build + evaluate"]) && has(s["elements"]),
  },
  {
    id: "06-graph-editor",
    // The starter graph is cooked behind a 150 ms debounce; the toolbar reads
    // "cooking…" until the first cook lands.
    ready: (s, has) => {
      const status = document.querySelector(".toolbar .status");
      return !!status && /^cook\s/.test(status.textContent || "") && has(s["output hash"]);
    },
  },
  {
    id: "07-galaxy",
    ready: (s, has) => s["pending"] === "0" && has(s["stars"]) && s["stars"] !== "0",
    // Cruise only disengages on a movement key. A tap moves the camera a
    // couple of units out of a 420-unit radius, which is invisible, and stops
    // the 55-second altitude drift so the framing is repeatable.
    settleKey: "KeyW",
    // Star shaders animate on a clock: pixel-identical frames never happen.
    animated: true,
  },
  {
    id: "08-gpu-fields",
    // This demo has no shared overlay; its readouts live in the Svelte panel.
    // The point of the demo is the three-way cost comparison, and the table is
    // empty until "cook all paths (cold)" has run — so press it once the
    // opening cook is idle, and treat "all three rows carry a time" as ready.
    // The CPU path alone is ~12 s of blocking work over a million points.
    settleWait: (s) => s["cook"] === "idle" && !!s["points"] && s["points"] !== "0",
    settle: () => clickButtonByText("cook all paths"),
    ready: (s) => {
      if (s["cook"] !== "idle") return false;
      const rows = [...document.querySelectorAll(".paths .pathrow:not(.off) .pv")];
      return rows.length >= 3 && rows.every((r) => /[\d.]+ ms · best [\d.]+ ms/.test(r.textContent));
    },
  },
  {
    id: "09-gpu-world",
    ready: (s, has) =>
      !!window.pcgWorld &&
      window.pcgWorld.probe().meshes > 0 &&
      has(s["status"]) &&
      !/initialising/i.test(s["status"]),
    // Autopilot flies the camera, so cells stream and evict forever and no
    // frame is ever the same twice. Turn it off AND zero the speed: the
    // checkbox alone leaves the last keyboard velocity in play.
    settleWait: () => !!window.__capRow("autopilot"),
    settle: () => {
      setCheckboxByLabel("autopilot", false);
      setRangeByLabel("speed", 0);
    },
  },
];

// Stats that change every frame or every 500 ms and therefore can never be
// part of a "has this settled" comparison.
const VOLATILE = new Set([
  "fps",
  "cook",
  "position",
  "last update",
  "churn per second",
  "device dispatches",
]);

/** Injected into every demo page before its own scripts run. */
function pageInstrumentation() {
  window.__capFrames = 0;
  const tick = () => {
    window.__capFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  window.__capStats = () => {
    const out = {};
    // Shared overlay: .pcg-stat = <span>label</span><span>value</span>
    for (const row of document.querySelectorAll(".pcg-overlay .pcg-stat")) {
      const spans = row.querySelectorAll("span");
      if (spans.length >= 2) out[text(spans[0])] = text(spans[1]);
    }
    // Svelte panels (05, 08): .stat = <span>label</span><b>value</b>
    for (const row of document.querySelectorAll(".panel .stat")) {
      const k = row.querySelector("span");
      const v = row.querySelector("b");
      if (k && v) out[text(k)] = text(v);
    }
    return out;
  };

  window.__capRow = (label) => {
    for (const row of document.querySelectorAll(".pcg-overlay .pcg-row")) {
      const l = row.querySelector("label");
      if (l && text(l).toLowerCase().startsWith(label.toLowerCase())) return row;
    }
    return null;
  };

  window.setRangeByLabel = (label, value) => {
    const row = window.__capRow(label);
    const input = row && row.querySelector('input[type="range"]');
    if (!input) throw new Error(`no range control labelled "${label}"`);
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  window.setCheckboxByLabel = (label, checked) => {
    const row = window.__capRow(label);
    const input = row && row.querySelector('input[type="checkbox"]');
    if (!input) throw new Error(`no checkbox labelled "${label}"`);
    if (input.checked !== checked) input.click();
    return true;
  };

  window.clickButtonByText = (needle) => {
    for (const b of document.querySelectorAll("button")) {
      if (text(b).toLowerCase().includes(needle.toLowerCase())) {
        if (b.disabled) throw new Error(`button "${needle}" is disabled`);
        b.click();
        return true;
      }
    }
    throw new Error(`no button matching "${needle}"`);
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

/** Minimal static server for the built demos. */
function serve(dir) {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = join(dir, decodeURIComponent(url.pathname));
      if (!file.startsWith(dir)) {
        res.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, "index.html");
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash("sha1").update(buf).digest("hex");

/**
 * Poll a predicate inside the page. The predicate is shipped as source and
 * rebuilt there, so it can read the DOM directly; it receives the demo's stats
 * and `has(v)`, which is false for a readout the demo has not written yet (the
 * shared overlay initialises every value to an en dash).
 */
async function waitForPredicate(page, predicate, timeout) {
  await page.waitForFunction(
    (src) => {
      const fn = new Function(`return (${src})`)();
      const has = (v) => !!v && v !== "–" && v !== "-";
      try {
        return !!fn(window.__capStats(), has);
      } catch {
        return false;
      }
    },
    { timeout, polling: 250 },
    predicate.toString(),
  );
}

/** Clip covering only the 3D viewport: no overlay panel, no HUD, no editor. */
function clipFor([w, h]) {
  const left = 340; // widest left overlay is 300 CSS px + margin
  const right = 400; // 05/08 keep a ~356 px panel on the right
  return {
    x: left,
    y: 60,
    width: Math.max(160, w - left - right),
    height: Math.max(120, Math.round(h * 0.4)),
  };
}

/**
 * Wait until the frame stops changing. Returns the criterion that was met.
 * Throws if neither criterion is reached, or if rendering stalls.
 */
async function waitForStableFrame(page, css, animated, log) {
  const clip = clipFor(css);
  const started = Date.now();
  let lastPixels = null;
  let lastStats = null;
  let lastFrames = -1;
  let pixelRun = 0;
  let statsRun = 0;

  for (let i = 0; i < 60; i++) {
    const shot = await page.screenshot({ type: "png", clip, optimizeForSpeed: true });
    const frames = await page.evaluate(() => window.__capFrames);
    const stats = await page.evaluate(() => {
      const s = window.__capStats();
      return JSON.stringify(s);
    });

    if (lastFrames >= 0 && frames <= lastFrames) {
      throw new Error(
        "rendering stalled — requestAnimationFrame stopped firing " +
          "(occluded or backgrounded window, or the demo's loop died)",
      );
    }
    lastFrames = frames;

    const pixels = sha(shot);
    const stable = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(stats)).filter(([k]) => !VOLATILE.has(k))),
    );

    if (DEBUG && lastStats !== null) {
      const before = JSON.parse(lastStats);
      const after = JSON.parse(stable);
      const moved = Object.keys(after).filter((k) => before[k] !== after[k]);
      log(
        `    [debug] pixels ${pixels === lastPixels ? "same" : "CHANGED"}` +
          `  stats moved: ${moved.length ? moved.map((k) => `${k}=${after[k]}`).join(", ") : "none"}`,
      );
    }

    pixelRun = pixels === lastPixels ? pixelRun + 1 : 0;
    statsRun = stable === lastStats ? statsRun + 1 : 0;
    lastPixels = pixels;
    lastStats = stable;

    const elapsed = Date.now() - started;
    if (!animated && pixelRun >= 2) return { criterion: "pixel", elapsed };
    if (elapsed > 6000 && statsRun >= 6) {
      if (!animated) log(`    note: no pixel-identical run; accepted on a counter plateau`);
      return { criterion: "stats-plateau", elapsed };
    }
    await sleep(250);
  }
  throw new Error(
    `never reached a stable frame (${Math.round((Date.now() - started) / 1000)}s): ` +
      "the picture kept changing and the demo's counters never plateaued",
  );
}

/**
 * Resample a raw 2x screenshot to its committed size, JPEG-encode it, and
 * measure it. Runs in a spare page so the demo page is never competing.
 */
async function encode(encPage, pngBase64, [w, h], quality) {
  const result = await encPage.evaluate(
    async (b64, width, height, q) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bin], { type: "image/png" }));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      // Blank/broken detection: a flat rectangle has ~no luma variance and
      // almost no distinct colours. Darkness alone is not suspicious here —
      // the galaxy demo is mostly black by design.
      const data = ctx.getImageData(0, 0, width, height).data;
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      const colours = new Set();
      for (let i = 0; i < data.length; i += 4 * 13) {
        const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        sum += l;
        sumSq += l * l;
        n++;
        colours.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
      }
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return { jpeg: btoa(s), mean, sd, colours: colours.size };
    },
    pngBase64,
    w,
    h,
    quality,
  );

  if (result.sd < 3 || result.colours < 48) {
    throw new Error(
      `render looks blank (luma sd ${result.sd.toFixed(1)}, ${result.colours} distinct colours) — ` +
        "refusing to write a flat rectangle",
    );
  }
  return { buffer: Buffer.from(result.jpeg, "base64"), ...result };
}

async function captureDemo(browser, encPage, origin, demo, log) {
  const size = SIZES[demo.id];
  const errors = [];
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(90_000);
    const ignorable = (url) => /favicon/i.test(url);
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      // "Failed to load resource" carries no URL; the response hook below
      // reports those with one, so don't double-count them.
      if (m.type() !== "error" || /Failed to load resource/i.test(m.text())) return;
      errors.push(`console: ${m.text()}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && !ignorable(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    page.on("requestfailed", (r) => {
      if (!ignorable(r.url())) errors.push(`request failed: ${r.url()}`);
    });
    await page.evaluateOnNewDocument(pageInstrumentation);
    await page.setViewport({ width: size.css[0], height: size.css[1], deviceScaleFactor: 2 });
    await page.bringToFront();

    await page.goto(`${origin}/${demo.id}/`, { waitUntil: "load" });

    // (1) rendering is actually happening in this tab
    await page.waitForFunction(() => window.__capFrames > 3, { timeout: 20_000 });

    // Stop any self-driving camera before the world settles, so framing does
    // not depend on how long the boot took.
    // Put the demo into the state worth photographing: stop self-driving
    // cameras, press the button that produces the readout the demo exists to
    // show. `settleWait` is how we know the control is there to be driven.
    if (demo.settle) {
      await waitForPredicate(page, demo.settleWait, 60_000);
      await page.evaluate(demo.settle);
    }
    if (demo.settleKey) {
      await page.keyboard.down(demo.settleKey);
      await page.keyboard.up(demo.settleKey);
    }

    // (2) the demo's own instrumentation says the cook is done
    await waitForPredicate(page, demo.ready, 180_000);

    // (3) a stable frame
    const stability = await waitForStableFrame(page, size.css, demo.animated === true, log);

    const stats = await page.evaluate(() => window.__capStats());
    const rawManual = await page.screenshot({ type: "png", optimizeForSpeed: true });

    // Demos whose manual asset is laid out at the thumbnail's CSS size get
    // both images from one screenshot; the rest need a second pass so the
    // thumbnail keeps the 640x345 aspect docs/index.html declares.
    let rawThumb = rawManual;
    if (size.css[0] !== THUMB.css[0] || size.css[1] !== THUMB.css[1]) {
      await page.setViewport({ width: THUMB.css[0], height: THUMB.css[1], deviceScaleFactor: 2 });
      await waitForStableFrame(page, THUMB.css, demo.animated === true, log);
      rawThumb = await page.screenshot({ type: "png", optimizeForSpeed: true });
    }

    if (errors.length) {
      throw new Error(`page reported ${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
    }

    await page.close();

    const manual = await encode(encPage, rawManual.toString("base64"), size.out, MANUAL_QUALITY);
    const thumb = await encode(encPage, rawThumb.toString("base64"), THUMB.out, THUMB.quality);

    await writeFile(join(MANUAL_DIR, `${demo.id}.jpg`), manual.buffer);
    await writeFile(join(THUMB_DIR, `${demo.id}.jpg`), thumb.buffer);

    return { stability, stats, manual, thumb, size };
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const noBuild = args.includes("--no-build");
  const selected = only
    ? DEMOS.filter((d) => only.split(",").some((p) => d.id.startsWith(p.trim())))
    : DEMOS;
  if (!selected.length) throw new Error(`--only=${only} matched no demo`);

  const log = (m) => process.stdout.write(`${m}\n`);

  if (!noBuild) {
    log("building demos (vite, production)…");
    await build({
      configFile: join(ROOT, "examples", "vite.config.ts"),
      base: "./",
      logLevel: "warn",
      build: { outDir: OUT_DIR, emptyOutDir: true },
    });
  } else if (!existsSync(OUT_DIR)) {
    throw new Error(`--no-build but ${OUT_DIR} does not exist; run once without it`);
  }

  await mkdir(MANUAL_DIR, { recursive: true });
  await mkdir(THUMB_DIR, { recursive: true });

  const { server, port } = await serve(OUT_DIR);
  const origin = `http://127.0.0.1:${port}`;
  log(`serving ${OUT_DIR} at ${origin}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--window-position=0,0",
      "--window-size=1520,1000",
      "--hide-scrollbars",
      // Chrome stops painting a window it thinks is covered, and throttles
      // renderers it thinks are hidden. Both produce empty captures.
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });

  // A parked page used only to resample and JPEG-encode. It never renders, so
  // it is safe for it to sit in the background while a demo is in front.
  const encPage = await browser.newPage();
  await encPage.goto("about:blank");

  const failures = [];
  try {
    for (const demo of selected) {
      const t0 = Date.now();
      log(`\n${demo.id}`);
      try {
        const r = await captureDemo(browser, encPage, origin, demo, log);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        log(
          `    ok  manual ${r.size.out[0]}x${r.size.out[1]} ${(r.manual.buffer.length / 1024).toFixed(0)} KB` +
            `  ·  thumb ${THUMB.out[0]}x${THUMB.out[1]} ${(r.thumb.buffer.length / 1024).toFixed(0)} KB` +
            `  ·  stable via ${r.stability.criterion} in ${(r.stability.elapsed / 1000).toFixed(1)}s` +
            `  ·  ${secs}s total`,
        );
      } catch (err) {
        failures.push({ id: demo.id, message: err.message });
        log(`    FAILED  ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    log(`\n${failures.length} demo(s) failed to capture:`);
    for (const f of failures) log(`  - ${f.id}: ${f.message}`);
    process.exitCode = 1;
    return;
  }
  log(`\ncaptured ${selected.length} demo(s); wrote ${selected.length * 2} files.`);
}

await main();
