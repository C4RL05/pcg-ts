/**
 * The animated lockup in the page header: a glitch over the wordmark, a
 * split-flap board over the small text.
 *
 * This is the host, and it is deliberately thin. It owns the clock and the
 * tuning and nothing else — each frame it asks `glitchAt` and `flapAt` what
 * the world looks like at time `t` and hands the answer to the stage.
 * Neither engine remembers the last frame, which is what makes freezing the
 * whole thing on one settled frame the same operation as playing it.
 *
 * The engines (`glitch.js`, `flap.js`, `stage.js`, `rng.js`) and the artwork
 * (`logo-data.js`) came out of a tuning playground that is not in this
 * repository; `logo-data.js` is generated from the artwork and says so.
 * What was left behind is every knob: the values in PARAMS below are the
 * tuning the playground settled on, frozen as constants, because a page
 * header has nothing to tune them with.
 */
import { buildCells, buildSchedule, flapAt } from "./flap.js";
import { createFrame, glitchAt } from "./glitch.js";
import { createStage } from "./stage.js";

/**
 * The whole loop, in seconds.
 *
 * The board's own cycle is "the last cell to settle, plus a hold", which
 * lands near 5.3s at this tuning. Overriding it is how the loop is pinned to
 * a round number: every cell has settled by ~2.2s either way, so a longer
 * cycle only lengthens the hold at the end. Anything shorter than the settle
 * time would cut the board off mid-sweep, so this is a floor as well as a
 * choice.
 */
const CYCLE = 8;

/** dt is clamped to this, so a backgrounded tab does not jump the clock. */
const MAX_STEP = 0.1;

const PARAMS = {
  /** Everything random here derives from this and the clock, nothing else. */
  seed: 1337,

  // ---- the wordmark: glitch -------------------------------------------
  glitch: true,
  /** Length of a scheduling slot; at most one burst is drawn per slot. */
  burstPeriod: 0.5,
  /** Odds that a given slot fires at all. */
  burstChance: 0.55,
  burstMin: 0.08,
  burstMax: 0.4,
  /** Rate the displacement is re-rolled at. Low values read as digital. */
  stutter: 22,
  /** Horizontal slices the wordmark is cut into. */
  bands: 4,
  /** Fraction of slices displaced on a given stutter frame. */
  bandChance: 1,
  /** Peak horizontal slice offset, in logo units. */
  slice: 26,
  /** Peak vertical slice offset. Small values only, or it stops reading. */
  sliceY: 1.5,
  /** Odds a displaced slice also drops most of its opacity. */
  drop: 0.18,
  /** Channel separation during a burst. */
  rgbSplit: 5,
  /** Channel separation at rest — a little is what sells the tube. */
  idleSplit: 0.7,
  /** Whole-wordmark kick during a burst. */
  slam: 3,

  // ---- the wordmark: intro ---------------------------------------------
  // Runs at the head of every cycle, then hands over to the glitch above.
  intro: true,
  /** How long the mark takes to resolve out of the mosh. */
  introDur: 0.5,
  /** Mosaic block at full strength, in logo units. 0 leaves pixels alone. */
  introBlock: 0,
  /** Columns the mark is chopped into; rows follow, kept roughly square. */
  introCols: 16,
  /** Peak block slip, per axis. */
  introShiftX: 512,
  introShiftY: 0,
  /** Odds a block takes its pixels from somewhere else — the smear. */
  introMosh: 1,

  // ---- the small text: split-flap board --------------------------------
  flap: true,
  /** `random` scrambles; `roll` walks the wheel to the target like a board. */
  flapMode: "random",
  charset: "alnum",
  /** Flips per second. */
  flapRate: 20,
  /** How long one cell scrambles before it locks. */
  scramble: 0.15,
  /** Added delay per column, which is what resolves a line left to right. */
  cellStagger: 0.01,
  /** Added delay per line. */
  lineDelay: 0.14,
  /** Per-cell randomness folded into the start time, as a share of `scramble`. */
  jitter: 1,
  /**
   * Time the finished board is held. CYCLE overrides the cycle this feeds,
   * so it only has to be large enough not to be the binding constraint.
   */
  hold: 3.2,
  /** Odds a settled cell is knocked out by a wordmark burst. */
  corrupt: 0.12,
};

/** The same tuning with both effects off: the lockup, resolved and still. */
const STILL = { ...PARAMS, glitch: false, intro: false, flap: false };

function mount(frame) {
  const cells = buildCells();
  const stage = createStage(frame, cells);
  const schedule = buildSchedule(cells, PARAMS);
  // The board's own cycle is a consequence of its stagger and hold; the
  // header wants a round loop, and every cell settles well inside it.
  schedule.cycle = Math.max(CYCLE, schedule.cycle - PARAMS.hold);
  const glitchFrame = createFrame(PARAMS.bands, PARAMS.introCols);
  const chars = new Array(cells.length).fill("");
  const states = new Uint8Array(cells.length);

  /** Draw the world at `t`. The only thing that touches the surfaces. */
  function drawAt(p, t) {
    glitchAt(p, t, glitchFrame, schedule.cycle);
    stage.applyGlitch(glitchFrame);
    flapAt(cells, schedule, p, t, glitchFrame.intensity, chars, states);
    stage.applyBoard(chars, states);
  }

  let t = 0;
  let raf = 0;
  let last = 0;

  function tick(now) {
    t += Math.min(MAX_STEP, (now - last) / 1000);
    last = now;
    drawAt(PARAMS, t);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * A header that glitches forever is the one thing on this page a reader
   * may have asked the operating system not to do. Reduced motion gets the
   * lockup resolved and still — the artwork, without the arrival.
   */
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** Off-screen and backgrounded are the same answer: stop drawing. */
  let onScreen = true;

  function sync() {
    if (calm.matches) {
      pause();
      drawAt(STILL, 0);
      return;
    }
    if (onScreen && !document.hidden) play();
    else pause();
  }

  new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(frame);

  document.addEventListener("visibilitychange", sync);
  // `change` rather than a one-time read: the setting can be toggled while
  // the page is open, and a header that keeps glitching after it was turned
  // off is exactly the complaint the setting exists to make.
  calm.addEventListener("change", sync);

  // A resize rebuilds the wordmark's tinted copies, and a still frame has
  // no loop to redraw itself afterwards — so it has to be told.
  new ResizeObserver(() => {
    if (calm.matches) requestAnimationFrame(() => drawAt(STILL, 0));
  }).observe(frame);

  // One frame before anything is revealed, so the swap cannot flash empty.
  drawAt(calm.matches ? STILL : PARAMS, 0);
  sync();
}

/**
 * The static wordmark in the markup is the fallback, and it stays the
 * fallback: it is only hidden once the stage has drawn a frame. Nothing
 * here is load-bearing for the page, so a browser that cannot run it — or
 * a canvas context that is refused — keeps the mark it already had.
 */
const frame = document.querySelector("[data-logo]");
const fallback = document.querySelector("[data-logo-static]");
if (frame) {
  try {
    mount(frame);
    frame.removeAttribute("hidden");
    if (fallback) fallback.setAttribute("hidden", "");
  } catch (err) {
    console.warn("logo: falling back to the static wordmark —", err);
  }
}
