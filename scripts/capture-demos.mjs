#!/usr/bin/env node
/**
 * capture-demos.mjs — regenerate docs/manual-assets/*.jpg and docs/thumbs/*.jpg
 * from the editor (`editor/`) and the three hosted demos under `demos/`.
 * (Spelling that second path as a glob would end this comment early — the
 * star-slash closes it — and the file stops parsing. It did once.)
 *
 * Run with `npm run capture` (optionally `-- --only=editor,galaxy` / `--no-build`).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS
 *
 * These ten JPEGs are committed and are referenced from docs/manual.html and
 * docs/index.html with hard-coded width/height attributes. They used to be
 * produced by an ad-hoc script that lived on one machine, so they drifted
 * silently whenever a demo changed. Everything below is the set of things that
 * script got wrong, encoded so the next person does not have to rediscover
 * them.
 *
 * The machinery this shares with `npm run preview` — the rAF counter, the
 * stable-frame loop, the JPEG encoder and its blank guard, the browser
 * flags — lives in `scripts/lib/capture.mjs`. What stays here is what is
 * specific to these pages.
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
 *      text: the shared overlay (shared/overlay.ts) renders one
 *      `.pcg-stat` per readout as `<span>label</span><span>value</span>`, and
 *      every value starts as an en dash "–" until the demo writes it. That
 *      makes the demo's own instrumentation the readiness signal — no
 *      demo-side hooks were added for this script. Per demo we wait for the
 *      specific stat that means "the cook is done": the editor toolbar's
 *      status line carrying a hash, `pending` reaching 0 for the two
 *      streaming worlds, and, for the one page that exposes a real probe
 *      object, the probe itself (`window.pcgWorld`, gpu-world).
 *
 *   3. A STABLE FRAME. Cook-complete is not the same as settled, so after (2)
 *      we sample repeatedly and only shoot once the picture stops changing.
 *      Two acceptance criteria, and the script reports which one it used:
 *        - "pixel": three consecutive byte-identical PNG screenshots of a clip
 *          region covering only the 3D viewport (the overlay is excluded
 *          because its fps counter ticks every 500 ms and would never settle).
 *        - "stats-plateau": for demos that animate by design and can never be
 *          pixel-identical (the galaxy twinkles star shaders on a clock), the
 *          demo's own non-volatile counters holding steady over several samples.
 *      Neither converging inside the budget is a hard failure.
 *
 * DETERMINISM. Every demo hard-codes its seed (1, or 42 for the galaxy), and
 * the only URL parameter any of them reads is the editor's `?graph=`, which
 * this script sets deliberately — so content is already reproducible. What is
 * not reproducible is the camera: infinite-world flies forward at 18 u/s from
 * t=0, gpu-world has autopilot on, and the galaxy cruises. Each is stopped
 * through its own UI
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
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  encodeJpeg,
  frameCounterScript,
  launchCaptureBrowser,
  waitForStableFrame,
} from "./lib/capture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "node_modules", ".cache", "pcg-capture");
const MANUAL_DIR = join(ROOT, "docs", "manual-assets");
const THUMB_DIR = join(ROOT, "docs", "thumbs");

// JPEG quality for the two outputs. Dark 3D renders band badly in shadow, so
// these sit higher than a photo would need.
const DEBUG = process.argv.includes("--debug");
const MANUAL_QUALITY = 0.9;
const THUMB_QUALITY = 0.85;

// Every thumbnail is 640x345 (docs/index.html declares that for every card), and
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
  editor: { css: [1454, 783], out: [1454, 783] },
  "editor-gpu": { css: [1454, 783], out: [1454, 783] },
  "editor-rig": { css: [1454, 783], out: [1454, 783] },
  "infinite-world": { css: [1454, 783], out: [1454, 783] },
  galaxy: { css: [1454, 783], out: [1454, 783] },
  "gpu-world": { css: [1079, 791], out: [1079, 791] },
};

/**
 * Readiness predicates. Each runs in the page with `s` bound to the demo's
 * overlay stats (label -> value). `has(v)` means "the demo has written this
 * readout at least once" (it starts life as an en dash).
 */
const DEMOS = [
  {
    id: "editor",
    // The graph is cooked behind a 150 ms debounce; the toolbar reads
    // "cooking…" until the first cook lands. There is no stats card to
    // scrape any more — the status line carries the readouts.
    //
    // The load toast has to be gone as well. It carries the hash of the
    // cook that produced it and expires after 3.5 s, which is longer than
    // this page takes to settle: shoot before it clears and the figure
    // shows a hash from an earlier cook next to the status line's current
    // one, reading as a contradiction.
    ready: () => {
      const status = document.querySelector(".toolbar .status");
      return (
        !!status &&
        /hash [0-9a-f]{8}/.test(status.textContent || "") &&
        !document.querySelector(".toast")
      );
    },
  },
  {
    // The same page, twice, because the editor absorbed what the retired
    // gpu-fields demo used to be: a graph is not what changes between
    // the two shots, the cook path under it is. `?graph=` opens it on the
    // fusable chain and `manualOnly` keeps it out of docs/thumbs, since
    // the demo index has one card per PAGE and this is not another page.
    id: "editor-gpu",
    path: "editor/?graph=examples-gpu-fields",
    manualOnly: true,
    // The selector's GPU options stay disabled until the adapter probe
    // answers, so waiting for the option is waiting for the device — and
    // if there is none, this fails loudly rather than photographing a CPU
    // cook under a heading that claims otherwise.
    settleWait: () => {
      const opt = document.querySelector('.toolbar .path.cook select option[value="gpu-fused"]');
      return !!opt && !opt.disabled;
    },
    // Async, and it has to be: the FIRST cook on a device path compiles its
    // pipelines and reports a wall time that is mostly compilation (measured
    // here: 293 ms per-node, against 41 ms once the cache is warm). A figure
    // showing that number would say the device is no faster than the CPU.
    // So switch, let it cook, then force a second cook that changes nothing —
    // seed +1 and back, which lands on the same seed the other shot uses and
    // recooks in full, because a node holds one memo slot.
    settle: async () => {
      const line = () => document.querySelector(".toolbar .status")?.textContent ?? "";
      const changedFrom = async (before) => {
        for (let i = 0; i < 1800; i++) {
          const t = line();
          if (t !== before && /hash [0-9a-f]{8}/.test(t)) return t;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("the status line never settled after a cook");
      };
      let before = line();
      setSelectByValue(".toolbar .path.cook select", "gpu-fused");
      await changedFrom(before);
      for (const step of [1, -1]) {
        before = line();
        const seed = document.querySelector('.toolbar input[type="number"]');
        seed.value = String(Number(seed.value) + step);
        seed.dispatchEvent(new Event("change", { bubbles: true }));
        await changedFrom(before);
      }
      return true;
    },
    // Device counters are appended to the status line only on a GPU path,
    // so "the line carries dispatches" is the proof the switch took —
    // a hash alone would also match the CPU cook it replaced. The toast
    // clause is the one above: here it would show the CPU hash from the
    // opening cook beside the fused hash on the status line.
    ready: () => {
      const status = document.querySelector(".toolbar .status");
      const text = status ? status.textContent || "" : "";
      return (
        /hash [0-9a-f]{8}/.test(text) &&
        /\d+ disp/.test(text) &&
        !document.querySelector(".toast")
      );
    },
  },
  {
    // The corpus's largest graph, drawn the way it is worth looking at:
    // no overlay, because 78 node boxes over a truss is a wall, and
    // normals, because the geometry is the subject. Normals earned their
    // place back when this was 8,282 instanced cylinders and a key light
    // flattened them into one silhouette; the parts are swept surfaces
    // now, so lit reads properly — but normals still separates twelve
    // pale tubes from each other where one material cannot.
    id: "editor-rig",
    path: "editor/?graph=examples-rig",
    manualOnly: true,
    settleWait: () => !!document.querySelector(".toolbar .path.shade select"),
    settle: async () => {
      const line = () => document.querySelector(".toolbar .status")?.textContent ?? "";
      const settled = async (before) => {
        for (let i = 0; i < 1800; i++) {
          const t = line();
          if (t !== before && /hash [0-9a-f]{8}/.test(t)) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("the status line never settled");
      };
      await settled("");
      setSelectByValue(".toolbar .path.shade select", "normals");
      // ONE click on the graph toggle turns that layer off and leaves the
      // scene alone, which is the view this figure wants. It was two
      // clicks on a three-state cycler until the bar grew two independent
      // toggles: same destination, one step, and the step now names the
      // layer it is switching off instead of counting to it. Shading is a
      // redraw and a view change touches no cook, so neither moves the
      // status line and neither needs waiting on.
      //
      // Selected by CLASS, not by its text. This read `view ·` once, and a
      // purely cosmetic change to the button's markup — the separator moved
      // into a span — silently stopped matching, so the rig figure failed to
      // capture with "no button matching". The class is what the button IS;
      // its label is presentation and will move again.
      const graphLayer = document.querySelector(".toolbar button.view.graph");
      if (!graphLayer) throw new Error("no .toolbar button.view.graph to turn the graph layer off with");
      // The toggle publishes its own state as `aria-pressed`, so this can
      // ask rather than assume: click only while the layer is up, then
      // insist it went down. A click that lands on nothing fails here,
      // loudly, instead of in the picture.
      //
      // The check comes AFTER the wait, and has to: the attribute is
      // rendered, the render is a frame away, and reading it in the same
      // turn as the click reads the state the click just left.
      if (graphLayer.getAttribute("aria-pressed") === "true") graphLayer.click();
      await new Promise((r) => setTimeout(r, 400));
      if (graphLayer.getAttribute("aria-pressed") !== "false") {
        throw new Error("the graph layer is still on after clicking .toolbar button.view.graph");
      }
      return true;
    },
    ready: () => {
      const status = document.querySelector(".toolbar .status");
      return (
        !!status &&
        /hash [0-9a-f]{8}/.test(status.textContent || "") &&
        !document.querySelector(".toast")
      );
    },
  },
  {
    id: "infinite-world",
    path: "demos/infinite-world/",
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
    id: "galaxy",
    path: "demos/galaxy/",
    ready: (s, has) => s["pending"] === "0" && has(s["stars"]) && s["stars"] !== "0",
    // Cruise only disengages on a movement key. A tap moves the camera a
    // couple of units out of a 420-unit radius, which is invisible, and stops
    // the 55-second altitude drift so the framing is repeatable.
    settleKey: "KeyW",
    // Star shaders animate on a clock: pixel-identical frames never happen.
    animated: true,
  },
  {
    id: "gpu-world",
    path: "demos/gpu-world/",
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

/**
 * Injected into every demo page before its own scripts run, alongside the
 * shared frame counter. Everything here reads the demo's OWN
 * instrumentation — no demo-side hooks were added for this script.
 */
function pageInstrumentation() {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  window.__capStats = () => {
    const out = {};
    // Shared overlay: .pcg-stat = <span>label</span><span>value</span>
    for (const row of document.querySelectorAll(".pcg-overlay .pcg-stat")) {
      const spans = row.querySelectorAll("span");
      if (spans.length >= 2) out[text(spans[0])] = text(spans[1]);
    }
    // Editor toolbar: .status holds one .stat per reading. Read the
    // label and the value BY TAG rather than by position — the markup
    // emits them in either order (`labelFirst` puts the <i> first for a
    // count, last for a unit like "21.4 ms"), so an index would pick up
    // the value as the key on half of them. A stat with an empty label
    // renders no <i> at all and is skipped: it has no name to file under.
    for (const row of document.querySelectorAll(".status .stat")) {
      const k = row.querySelector("i");
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

  window.setSelectByValue = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no select matching "${selector}"`);
    const option = [...el.options].find((o) => o.value === value);
    if (!option) throw new Error(`select "${selector}" has no option "${value}"`);
    if (option.disabled) throw new Error(`option "${value}" is disabled`);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  // There was a `clickButtonByText` here and it is deliberately gone. Its
  // last caller cycled the editor view by matching the label "view ·",
  // and a cosmetic markup change — the separator moving into a span —
  // silently stopped matching, so a figure failed to capture for a reason
  // that had nothing to do with the figure. Select a control by the class
  // that says what it IS (`button.view.graph`, `.path.cook`, `.path.shade`);
  // those classes exist for this tooling and are documented as such where
  // they are declared. A label is presentation and will move again.
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
  const right = 400; // the panelled pages keep a ~356 px panel on the right
  return {
    x: left,
    y: 60,
    width: Math.max(160, w - left - right),
    height: Math.max(120, Math.round(h * 0.4)),
  };
}

/**
 * The demos' own non-volatile counters, as a string the shared stabilizer
 * can compare. This is the "stats-plateau" signal: readouts that tick
 * every frame or every 500 ms are filtered out first, or nothing would
 * ever hold still.
 */
function demoSignal(page) {
  return async () => {
    const stats = await page.evaluate(() => JSON.stringify(window.__capStats()));
    return JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(stats)).filter(([k]) => !VOLATILE.has(k))),
    );
  };
}

/** Stabilize this demo at the given CSS size. */
function settleAt(page, css, animated, log) {
  return waitForStableFrame(page, {
    clip: clipFor(css),
    signal: demoSignal(page),
    acceptPixels: !animated,
    debug: DEBUG,
    log,
  });
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
    await page.evaluateOnNewDocument(frameCounterScript);
    await page.evaluateOnNewDocument(pageInstrumentation);
    await page.setViewport({ width: size.css[0], height: size.css[1], deviceScaleFactor: 2 });
    await page.bringToFront();

    await page.goto(`${origin}/${demo.path ?? `${demo.id}/`}`, { waitUntil: "load" });

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

    // Every page this script drives carries readings — that is the whole
    // premise of `pageInstrumentation`. So an EMPTY set here does not mean
    // "this page is quiet", it means both scrapers missed, and the failure
    // is silent in the worst possible place: `settleAt` compares
    // successive stat snapshots, and a signal that is constantly `{}`
    // reads as a page that has already stopped moving. The capture then
    // photographs a scene mid-cook and reports it as stable. That is how
    // a renamed class turns into wrong committed screenshots rather than
    // into a crash, so it is checked here rather than trusted.
    if (Object.keys(await page.evaluate(() => window.__capStats())).length === 0) {
      throw new Error(
        `${demo.id}: __capStats() found no readings. The scrapers look for ` +
          `".pcg-overlay .pcg-stat" and ".status .stat" — one of those hooks has ` +
          `moved. Fix the selector in pageInstrumentation() before trusting a capture.`,
      );
    }

    // (3) a stable frame
    const stability = await settleAt(page, size.css, demo.animated === true, log);

    const stats = await page.evaluate(() => window.__capStats());
    const rawManual = await page.screenshot({ type: "png", optimizeForSpeed: true });

    // Demos whose manual asset is laid out at the thumbnail's CSS size get
    // both images from one screenshot; the rest need a second pass so the
    // thumbnail keeps the 640x345 aspect docs/index.html declares. A
    // `manualOnly` shot is a second figure of a page that already has a
    // card, so it needs no thumbnail at all.
    let rawThumb = rawManual;
    if (!demo.manualOnly && (size.css[0] !== THUMB.css[0] || size.css[1] !== THUMB.css[1])) {
      await page.setViewport({ width: THUMB.css[0], height: THUMB.css[1], deviceScaleFactor: 2 });
      await settleAt(page, THUMB.css, demo.animated === true, log);
      rawThumb = await page.screenshot({ type: "png", optimizeForSpeed: true });
    }

    if (errors.length) {
      throw new Error(`page reported ${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
    }

    await page.close();

    const manual = await encodeJpeg(encPage, rawManual.toString("base64"), size.out, MANUAL_QUALITY);
    await writeFile(join(MANUAL_DIR, `${demo.id}.jpg`), manual.buffer);

    let thumb;
    if (!demo.manualOnly) {
      thumb = await encodeJpeg(encPage, rawThumb.toString("base64"), THUMB.out, THUMB.quality);
      await writeFile(join(THUMB_DIR, `${demo.id}.jpg`), thumb.buffer);
    }

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
      configFile: join(ROOT, "vite.config.ts"),
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

  const browser = await launchCaptureBrowser();

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
            (r.thumb
              ? `  ·  thumb ${THUMB.out[0]}x${THUMB.out[1]} ${(r.thumb.buffer.length / 1024).toFixed(0)} KB`
              : `  ·  no thumb (manual-only)`) +
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
