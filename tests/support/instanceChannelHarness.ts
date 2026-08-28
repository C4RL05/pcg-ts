/**
 * NODE HALF of the instance-channel render harness: bundle the page,
 * serve it, drive a real browser at it, and hand the pixels back.
 *
 * `tests/instanceChannelRender.test.ts` is the only consumer;
 * `./instanceChannelPage.ts` is the page it runs. The split is the same
 * one `src/gpu`'s device suites use — the browser/device side is a
 * PROGRAM bundled by PATH through esbuild and never imported, because
 * importing it into a vitest worker would pull `three` and `document`
 * into a process that has neither.
 *
 * ## Why a browser at all, and why a headed one
 *
 * A vitest worker has no GL context, so the one thing this file exists to
 * establish — that a shader can READ a per-instance channel — cannot be
 * established in-process at any fidelity. The browser is not a
 * convenience here; it is the instrument.
 *
 * Headed rather than headless, and the launch flags below, are copied
 * from `scripts/lib/capture.mjs` (`launchCaptureBrowser`) along with the
 * reasoning already paid for there: headless has historically produced
 * blank or software-fallback renders in this repo, and Chrome throttles
 * or stops painting a window it believes is hidden. A software fallback
 * would not be a false PASS here — a readback is a readback — but it
 * would quietly stop testing the driver an integrator actually ships
 * against, and the WebGPU case cannot run on it at all.
 *
 * This file does NOT import `scripts/lib/capture.mjs`. It is a plain
 * `.mjs` with no declarations, so a typed import of it fails `tsc
 * --noEmit`, and `tests/` has no other dependency on `scripts/`. The two
 * things worth sharing are forty lines; the citation above is the link.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type { RunRequest, RunResult } from "./instanceChannelPage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "..", "..", "node_modules", ".cache", "pcg-ts-instance-channels");

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

/**
 * Can a headed browser be started on this machine? Returns a label for
 * the suite title, or `null` with the reason, so a checkout with no
 * browser SKIPS visibly instead of exploding — the shape
 * `src/gpu/gpuDevice.testsupport.ts` uses for a missing WebGPU adapter
 * and `tests/support/kits.ts` uses for a missing kit.
 *
 * The probe is deliberately cheap (no launch): it asks whether Chrome is
 * downloaded, and whether a display exists to put a window on. Both are
 * the actual failure modes — an unconfigured CI container has neither.
 */
export function probeBrowser(): { label: string } | { reason: string } {
  if (process.env.PCG_SKIP_BROWSER_TESTS === "1") {
    return { reason: "PCG_SKIP_BROWSER_TESTS=1" };
  }
  if (
    process.platform !== "win32" &&
    process.platform !== "darwin" &&
    process.env.DISPLAY === undefined &&
    process.env.WAYLAND_DISPLAY === undefined
  ) {
    // Headed Chrome cannot start without one, and headless is not an
    // equivalent substitute here (see the file header).
    return { reason: "no DISPLAY/WAYLAND_DISPLAY for a headed browser" };
  }
  const found = browserPath();
  if ("reason" in found) return found;
  if (!existsSync(found.exe)) {
    return {
      reason: `puppeteer's browser is not downloaded (${found.exe}); run \`npx puppeteer browsers install chrome\``,
    };
  }
  // The install directory carries the build, e.g. `win64-151.0.7922.71`.
  // Cheaper and more reliable than launching the binary for `--version`,
  // which prints nothing on some Windows builds.
  const build = found.exe.split(/[\\/]/).find((part) => /^\w+-\d+\./.test(part));
  return { label: `chrome ${build ?? "(unknown build)"}` };
}

/**
 * Where puppeteer's browser is, resolved SYNCHRONOUSLY in a child
 * process because `describe.skipIf` needs its answer at collection time
 * and puppeteer 25's `executablePath()` is async. Same shape as
 * `src/gpu/gpuDevice.testsupport.ts`, which shells out for the same
 * reason: a gate has to be a value, not a promise.
 */
function browserPath(): { exe: string } | { reason: string } {
  const script =
    'import("puppeteer")' +
    ".then(async (m) => process.stdout.write(JSON.stringify({ exe: await m.default.executablePath() })))" +
    ".catch((e) => process.stdout.write(JSON.stringify({ reason: String(e) })));";
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: join(HERE, "..", ".."),
      encoding: "utf8",
      timeout: 60_000,
    });
    const parsed = JSON.parse(out) as { exe?: string; reason?: string };
    if (typeof parsed.exe === "string") return { exe: parsed.exe };
    return { reason: `puppeteer could not name a browser (${parsed.reason ?? "no reason given"})` };
  } catch (err) {
    return { reason: `puppeteer is not usable here (${String(err)})` };
  }
}

/** Suite title that carries either the browser or the reason it is absent. */
export function browserSuiteName(base: string, probe: ReturnType<typeof probeBrowser>): string {
  return "reason" in probe ? `${base} [SKIPPED: ${probe.reason}]` : `${base} [${probe.label}]`;
}

/* ------------------------------------------------------------------ *
 * Bundling and serving
 * ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
};

/**
 * Minimal loopback static server for one built directory, the same shape
 * (and the same path-escape guard) as `serveDir` in
 * `scripts/lib/capture.mjs`. It exists to be read by a browser on this
 * machine and nothing more.
 */
function serveDir(dir: string): Promise<{ server: Server; port: number }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      // The tab asks for this unprompted and logs the 404 as a console
      // error, which would otherwise land in `errors` and fail the run.
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }
      const file = join(dir, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      if (!file.startsWith(dir) || !existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      ok({ server, port: typeof address === "object" && address !== null ? address.port : 0 });
    });
  });
}

/**
 * Bundle the page. `instanceChannelPage.ts` is named BY PATH here and is
 * never imported — the convention `src/gpu`'s device suites established,
 * and the reason CLAUDE.md says renaming one of these means grepping the
 * bare filename too.
 *
 * The output directory is pid-suffixed because vitest runs files in
 * parallel workers and two of them must not race on one path.
 */
async function bundlePage(): Promise<string> {
  const { build } = await import("esbuild");
  const outDir = join(CACHE, `page-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [join(HERE, "instanceChannelPage.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: join(outDir, "page.js"),
    logLevel: "silent",
  });
  writeFileSync(
    join(outDir, "index.html"),
    `<!doctype html>
<html><head><meta charset="utf-8"><title>pcg-ts instance channels</title></head>
<body style="background:#111;color:#ddd;font:13px ui-monospace,monospace;padding:12px">
<h1 style="font-size:14px">pcg-ts per-instance channel render harness</h1>
<p>Each strip below is a 64x16 render target blown up: four instances, one per column,
coloured by a per-instance channel that only the shader can see.</p>
<script type="module" src="./page.js"></script>
</body></html>
`,
  );
  return outDir;
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

/** One line the tab printed, whatever severity it printed it at. */
export interface ConsoleLine {
  readonly type: string;
  readonly text: string;
}

export interface Harness {
  /** Render every case and read the pixels back. */
  run(request: RunRequest): Promise<RunResult>;
  /** Errors the page raised, across every run so far. */
  readonly errors: readonly string[];
  /**
   * EVERY console line the tab printed, at any severity, across every run
   * — warnings and logs included, which `errors` deliberately excludes.
   *
   * `errors` answers "did the page break". This answers a different and,
   * for the missing-channel cases, the substantive question: whether
   * anything was said AT ALL. A silent wrong result and a warned-about
   * wrong result are different products to integrate against, and only a
   * list that collects `console.warn` can tell them apart.
   */
  readonly console: readonly ConsoleLine[];
  /**
   * Wait until the tab has stopped printing, so `console` can be READ as
   * a count rather than merely inspected.
   *
   * A console line crosses from the browser process over CDP and does not
   * arrive with the `page.evaluate` that provoked it — ANGLE's driver
   * warnings least of all, since they originate below the renderer. A
   * before/after count taken without this would race, and the race runs
   * the dangerous way: the lines would arrive after the snapshot, and
   * "nothing was said" would look confirmed when it was merely early.
   *
   * WHAT THIS DOES AND DOES NOT GUARANTEE. It polls until two consecutive
   * samples agree, so it BOUNDS the mis-attribution at one quiet window
   * (~500 ms) rather than eliminating it: a line lagging its own run by
   * longer than that still lands in the next slice, and a line lost that
   * way is a line the silence assertion does not see. Measured, every
   * line this page produces arrives inside the window — the attribution
   * across a whole session's log is exact — but the bound is the honest
   * description and a widened gap is where this would go wrong first.
   * `CAP_MS` gives up quietly for the same reason a hook timeout is
   * generous here: under a full-suite run the tab competes with
   * everything else, and a hard failure there would be a machine-load
   * report, not a finding.
   */
  settle(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Build the page, serve it, open it in a real browser, and wait until it
 * says it is ready. Throws with the page's own message if it could not
 * get a GL context, which is the one failure worth distinguishing from a
 * failed assertion.
 */
export async function openHarness(): Promise<Harness> {
  const outDir = await bundlePage();
  const { server, port } = await serveDir(outDir);
  const browser: Browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--window-position=0,0",
      "--window-size=900,500",
      "--hide-scrollbars",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
  const errors: string[] = [];
  const lines: ConsoleLine[] = [];
  let page: Page;
  try {
    page = await browser.newPage();
    page.on("pageerror", (err: unknown) => errors.push(`pageerror: ${String(err)}`));
    page.on("console", (msg) => {
      // The tab asks for /favicon.ico unprompted and logs the 404 as an
      // error. Every other console error is the page's own and matters.
      const text = msg.text();
      const from = msg.location().url ?? "";
      const favicon = text.includes("favicon") || from.endsWith("/favicon.ico");
      if (favicon) return;
      // Recorded at EVERY severity: a warning is not an error but it is a
      // diagnostic, and whether one exists is exactly what the
      // missing-channel cases are measuring.
      lines.push({ type: msg.type(), text });
      if (msg.type() === "error") errors.push(`console.error: ${text}`);
    });
    page.on("requestfailed", (req) => {
      if (!req.url().endsWith("/favicon.ico")) errors.push(`requestfailed: ${req.url()}`);
    });
    // No `bringToFront()`, unlike `scripts/lib/capture.mjs`. That call is
    // there because a SCREENSHOT is a compositor read and an occluded
    // window has nothing to compose. Nothing here screenshots: every
    // measurement is `render()` into an offscreen render target followed
    // by a readback, which is a direct command stream and does not depend
    // on the window being painted (the flags above already stop Chrome
    // throttling the renderer). Leaving it out keeps `npm test` from
    // stealing focus from whoever is running it.
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__pcgChannels?.state !== "loading", { polling: 100, timeout: 30_000 });
    const state = await page.evaluate(() => ({
      state: window.__pcgChannels.state,
      error: window.__pcgChannels.error,
    }));
    if (state.state === "error") {
      throw new Error(`the harness page could not create a WebGL context: ${state.error ?? "(no message)"}`);
    }
  } catch (err) {
    await browser.close().catch(() => undefined);
    server.close();
    rmSync(outDir, { recursive: true, force: true });
    throw err;
  }

  return {
    errors,
    console: lines,
    async run(request: RunRequest): Promise<RunResult> {
      return await page.evaluate((req) => window.__pcgChannels.run(req), request as RunRequest);
    },
    async settle(): Promise<void> {
      const STEP_MS = 250;
      const CAP_MS = 4_000;
      const started = Date.now();
      let seen = -1;
      while (Date.now() - started < CAP_MS) {
        // Slept IN THE PAGE: a `setTimeout` here would be a bare sleep in
        // the test process, and the page's event loop is the one that has
        // to turn for its messages to be flushed anyway.
        await page.evaluate((ms) => new Promise((ok) => setTimeout(ok, ms)), STEP_MS);
        if (lines.length === seen) return;
        seen = lines.length;
      }
    },
    async close(): Promise<void> {
      await browser.close().catch(() => undefined);
      server.close();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
