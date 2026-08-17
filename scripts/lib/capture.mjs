/**
 * Shared browser-capture machinery for `npm run capture` (the nine demo
 * screenshots) and `npm run preview` (an arbitrary graph).
 *
 * Everything here was learned the hard way by `scripts/capture-demos.mjs`
 * and is extracted so the second consumer inherits it rather than
 * rediscovering it. The two callers photograph very different pages, but
 * the hard parts are identical: proving the tab is actually painting,
 * deciding when the picture has settled, and refusing to write a blank
 * rectangle.
 *
 * What stays with the callers is what genuinely differs — which pages to
 * open, how to tell that page's cook is done, and what to clip.
 */
import { createHash } from "node:crypto";
import puppeteer from "puppeteer";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (buf) => createHash("sha1").update(buf).digest("hex");

/**
 * Installed via `page.evaluateOnNewDocument` before any page script runs.
 * A backgrounded or occluded tab stops servicing requestAnimationFrame,
 * which is exactly how an empty frame ends up in a file; counting frames
 * turns that into a loud failure instead.
 */
export function frameCounterScript() {
  window.__capFrames = 0;
  const tick = () => {
    window.__capFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * A headed browser configured for capture.
 *
 * Headed, not headless: two demos are WebGPU and want a real device, and
 * headless has historically produced a blank or fallback render. The
 * flags exist because Chrome stops painting a window it believes is
 * covered and throttles renderers it believes are hidden — both produce
 * empty captures.
 */
export function launchCaptureBrowser({ width = 1520, height = 1000 } = {}) {
  return puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--window-position=0,0",
      `--window-size=${width},${height}`,
      "--hide-scrollbars",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
}

/** Which keys of a JSON signal object moved between two samples. */
function debugNote(before, after) {
  if (before === undefined || after === undefined || before === null) return "";
  const a = JSON.parse(before);
  const b = JSON.parse(after);
  const moved = Object.keys(b).filter((k) => a[k] !== b[k]);
  return `  signal moved: ${moved.length ? moved.map((k) => `${k}=${b[k]}`).join(", ") : "none"}`;
}

/**
 * Wait until the frame stops changing, and report which criterion was
 * met. Cook-complete is not the same as settled, so this samples
 * repeatedly and only returns once the picture holds still.
 *
 * - **"pixel"** — `pixelRun + 1` consecutive byte-identical PNG
 *   screenshots of `clip`. The default, and the only criterion a page
 *   that does not animate should ever need.
 * - **"stats-plateau"** — for a page that animates by design and can
 *   therefore never be pixel-identical, `signal()` (the page's own
 *   non-volatile counters, as a string) holding steady across
 *   `plateauRun + 1` samples once `plateauAfterMs` has passed. Omit
 *   `signal` and this criterion is disabled entirely, which is what a
 *   caller with no such counters wants: a constant signal would
 *   otherwise "plateau" over a picture still visibly changing.
 *
 * Throws if neither criterion is reached, and separately if rendering
 * stalls — a stalled tab is a different failure and deserves to say so.
 */
export async function waitForStableFrame(
  page,
  {
    clip,
    signal,
    acceptPixels = true,
    samples = 60,
    intervalMs = 250,
    pixelRun = 2,
    plateauAfterMs = 6000,
    plateauRun = 6,
    debug = false,
    log,
  },
) {
  const started = Date.now();
  let lastPixels = null;
  let lastSignal = null;
  let lastFrames = -1;
  let stallStreak = 0;
  let pixelStreak = 0;
  let signalStreak = 0;

  for (let i = 0; i < samples; i++) {
    const shot = await page.screenshot({ type: "png", clip, optimizeForSpeed: true });
    const frames = await page.evaluate(() => window.__capFrames);
    // Two consecutive non-advancing samples, not one. Samples are ~300 ms
    // apart including the screenshot round-trip, and a scene heavy enough
    // to render slower than that would otherwise be diagnosed as a
    // stalled tab — the wrong answer, and an expensive one to chase.
    stallStreak = lastFrames >= 0 && frames <= lastFrames ? stallStreak + 1 : 0;
    if (stallStreak >= 2) {
      throw new Error(
        "rendering stalled — requestAnimationFrame stopped firing " +
          "(occluded or backgrounded window, or the page's loop died)",
      );
    }
    lastFrames = frames;

    const pixels = sha(shot);
    const current = signal === undefined ? undefined : await signal();

    // Logged from here because only this loop holds BOTH the pixel hash
    // and the page's signal, and the pair is the point: on a page that
    // animates by design, "pixels CHANGED while the counters are flat" is
    // the whole reason the plateau criterion exists.
    if (debug && lastPixels !== null) {
      log?.(`    [debug] pixels ${pixels === lastPixels ? "same" : "CHANGED"}${debugNote(lastSignal, current)}`);
    }

    pixelStreak = pixels === lastPixels ? pixelStreak + 1 : 0;
    signalStreak = current !== undefined && current === lastSignal ? signalStreak + 1 : 0;
    lastPixels = pixels;
    lastSignal = current;

    const elapsed = Date.now() - started;
    if (acceptPixels && pixelStreak >= pixelRun) return { criterion: "pixel", elapsed };
    if (current !== undefined && elapsed > plateauAfterMs && signalStreak >= plateauRun) {
      if (acceptPixels) log?.("    note: no pixel-identical run; accepted on a counter plateau");
      return { criterion: "stats-plateau", elapsed };
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `never reached a stable frame (${Math.round((Date.now() - started) / 1000)}s): ` +
      "the picture kept changing" +
      (signal === undefined ? "" : " and the page's counters never plateaued"),
  );
}

/**
 * Resample a raw screenshot to `[w, h]`, JPEG-encode it, and measure it.
 * Runs in a spare page so the page being photographed is never competing
 * for the main thread.
 *
 * The measurement is a blank/broken guard: a flat rectangle has almost no
 * luma variance and almost no distinct TONES. Darkness alone is not
 * suspicious — the galaxy demo is mostly black by design — so the test is
 * variance, not brightness.
 *
 * The second floor counts distinct 8-bit LUMA levels, not distinct
 * colours. It used to bucket RGB at 5 bits a channel, which quietly made
 * the guard a colour detector: every pixel of a greyscale render lands on
 * the r==g==b diagonal, so it can produce at most 32 buckets no matter how
 * rich it is, and a floor of 48 was unreachable by construction. The
 * greyscale editor tripped it with a picture that was completely fine.
 * Tone count says what the floor was always meant to say — "this has
 * structure in it" — and says it about colour and greyscale alike.
 *
 * Both floors are caller-set because they are calibrated to a KIND of
 * picture, not to correctness. The demo screenshots carry UI chrome,
 * gradients and text, so a tone floor costs them nothing; a clean
 * synthetic render of sky, ground and one cloud is legitimately sparse,
 * and failing it would block an authoring loop over a picture that is
 * exactly right. Luma variance is the signal that actually separates
 * "rendered" from "context lost", and it stays.
 */
export async function encodeJpeg(
  encPage,
  pngBase64,
  [w, h],
  quality,
  { minSd = 3, minTones = 40 } = {},
) {
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

      const data = ctx.getImageData(0, 0, width, height).data;
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      const tones = new Set();
      for (let i = 0; i < data.length; i += 4 * 13) {
        const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        sum += l;
        sumSq += l * l;
        n++;
        tones.add(Math.round(l));
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
      return { jpeg: btoa(s), mean, sd, tones: tones.size };
    },
    pngBase64,
    w,
    h,
    quality,
  );

  if (result.sd < minSd || result.tones < minTones) {
    throw new Error(
      `render looks blank (luma sd ${result.sd.toFixed(1)}, ${result.tones} distinct tones) — ` +
        "refusing to write a flat rectangle",
    );
  }
  return { buffer: Buffer.from(result.jpeg, "base64"), ...result };
}
