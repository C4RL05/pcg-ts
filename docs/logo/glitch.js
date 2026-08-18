/**
 * The wordmark glitch: horizontal slices, channel separation, dropouts.
 *
 * Same contract as the board — a pure function of `(seed, t)`, keyed by
 * hash rather than drawn from a stream, so scrubbing backwards is as cheap
 * and as exact as running forwards.
 *
 * The look rests on one idea: displacement is re-rolled at `stutter` Hz,
 * not per frame. A glitch that moves smoothly at 60fps reads as a wobble;
 * one that jumps on a coarse clock reads as a signal fault, and it holds up
 * at whatever rate the display happens to be running.
 */
import { WORDMARK_BOX } from "./logo-data.js";
import { rnd } from "./rng.js";

const TAG_FIRE = 0x9e11;
const TAG_BLOCK = 0x8c31;
const TAG_BDX = 0x2f70;
const TAG_MOSH = 0x6ae4;
const TAG_HIDE = 0x13d8;
const TAG_LEN = 0x2c4b;
const TAG_WHEN = 0x77a3;
const TAG_GATE = 0x5bb1;
const TAG_BAND = 0x30f7;
const TAG_DX = 0x41e9;
const TAG_DY = 0x6d02;
const TAG_DROP = 0x1b8c;
const TAG_SLAM = 0xa50d;

/** Block grid for the intro, sized so the blocks come out roughly square. */
export function blockGrid(cols) {
  const c = Math.max(1, Math.round(cols));
  const w = WORDMARK_BOX.width / c;
  return { cols: c, rows: Math.max(1, Math.round(WORDMARK_BOX.height / w)), w };
}

/** Everything the renderer needs for one frame. Reused, never reallocated. */
export function createFrame(bands, cols = 28) {
  const grid = blockGrid(cols);
  const n = grid.cols * grid.rows;
  return {
    /** 1 at the head of the cycle, 0 once the mark has resolved. */
    intro: 0,
    /** Mosaic block edge, in logo units. 0 means no pixelation. */
    pixel: 0,
    blockCols: grid.cols,
    blockRows: grid.rows,
    blockW: grid.w,
    blockH: WORDMARK_BOX.height / grid.rows,
    /** Where a block is drawn, relative to where it belongs. */
    blockDx: new Float32Array(n),
    blockDy: new Float32Array(n),
    /** Where a block reads its pixels FROM — the smear. */
    blockSx: new Float32Array(n),
    blockSy: new Float32Array(n),
    blockA: new Float32Array(n).fill(1),
    /** 0 at rest, up to 1 at the peak of a burst. */
    intensity: 0,
    /** Horizontal offset per slice, in logo units. */
    dx: new Float32Array(bands),
    dy: new Float32Array(bands),
    /** Per-slice opacity — dropouts live here. */
    alpha: new Float32Array(bands).fill(1),
    /** Channel separation, in logo units. */
    split: 0,
    slamX: 0,
    slamY: 0,
  };
}

/**
 * Burst envelope at `t`: 0 outside a burst, rising to 1 inside one.
 *
 * Time is cut into slots of `burstPeriod`. A slot either fires or it does
 * not, and a firing slot places one burst wholly inside itself — which is
 * what keeps this a single lookup instead of a search backwards through
 * history for something still ringing.
 *
 * A burst longer than its slot is clamped to start at the slot boundary and
 * is cut off at the next one. That is a degradation, not a fault: turning
 * `burstMax` above `burstPeriod` just means the fault runs continuously.
 */
function envelope(p, t) {
  const period = Math.max(0.05, p.burstPeriod);
  const slot = Math.floor(t / period);
  if (rnd(p.seed, TAG_FIRE, slot) >= p.burstChance) return 0;

  const lo = Math.min(p.burstMin, p.burstMax);
  const hi = Math.max(p.burstMin, p.burstMax);
  const dur = Math.max(0.01, lo + rnd(p.seed, TAG_LEN, slot) * (hi - lo));
  const at = slot * period + rnd(p.seed, TAG_WHEN, slot) * Math.max(0, period - dur);
  const phase = (t - at) / dur;
  if (phase < 0 || phase >= 1) return 0;

  // Flat, then a quick fall — a burst should stop, not fade.
  return phase < 0.7 ? 1 : (1 - phase) / 0.3;
}

/**
 * The intro: the mark arrives as coarse blocks reading their pixels from
 * the wrong places, and resolves out of it.
 *
 * Keyed to the head of the CYCLE rather than to load, so it replays with
 * the board every time round instead of being a thing you have to reload
 * to see. Reading from the wrong place is the whole trick — a block that
 * keeps its slot but shows pixels belonging elsewhere smears, where one
 * that merely moves only shakes.
 */
function introAt(p, t, cycle, gframe, out) {
  const n = out.blockCols * out.blockRows;
  const tc = cycle > 0 ? t % cycle : t;
  const u = tc / Math.max(0.05, p.introDur);
  const amt = p.intro && u < 1 ? (1 - u) ** 1.4 : 0;
  out.intro = amt;
  out.pixel = p.introBlock * amt;

  if (amt <= 0) {
    out.blockDx.fill(0);
    out.blockDy.fill(0);
    out.blockSx.fill(0);
    out.blockSy.fill(0);
    out.blockA.fill(1);
    return;
  }

  for (let i = 0; i < n; i++) {
    if (rnd(p.seed, TAG_BLOCK, gframe, i) < 0.2 + 0.75 * amt) {
      out.blockDx[i] = (rnd(p.seed, TAG_BDX, gframe, i) * 2 - 1) * p.introShiftX * amt;
      out.blockDy[i] = (rnd(p.seed, TAG_BDX, gframe, i, 1) * 2 - 1) * p.introShiftY * amt;
    } else {
      out.blockDx[i] = 0;
      out.blockDy[i] = 0;
    }

    if (rnd(p.seed, TAG_MOSH, gframe, i) < p.introMosh * amt) {
      out.blockSx[i] = (rnd(p.seed, TAG_MOSH, gframe, i, 1) * 2 - 1) * p.introShiftX * amt;
      out.blockSy[i] = (rnd(p.seed, TAG_MOSH, gframe, i, 2) * 2 - 1) * p.introShiftY * amt;
    } else {
      out.blockSx[i] = 0;
      out.blockSy[i] = 0;
    }

    out.blockA[i] = rnd(p.seed, TAG_HIDE, gframe, i) < 0.14 * amt ? 0 : 1;
  }
}

export function glitchAt(p, t, out, cycle = 0) {
  const bands = out.dx.length;
  const gframe = Math.floor(t * Math.max(1, p.stutter));

  // Independent of `glitch`: the intro is its own effect, and wanting the
  // arrival without the ongoing fault is a reasonable thing to ask for.
  introAt(p, t, cycle, gframe, out);

  if (!p.glitch) {
    out.intensity = 0;
    out.split = 0;
    out.slamX = 0;
    out.slamY = 0;
    out.dx.fill(0);
    out.dy.fill(0);
    out.alpha.fill(1);
    return;
  }

  const env = envelope(p, t);

  // Even mid-burst the fault drops out now and then; that gap is most of
  // what separates a glitch from a vibration.
  const gate = env > 0 && rnd(p.seed, TAG_GATE, gframe) < 0.82 ? 1 : 0;
  const level = env * gate * (0.55 + 0.45 * rnd(p.seed, TAG_GATE, gframe, 1));
  out.intensity = level;

  out.split = p.idleSplit + p.rgbSplit * level;
  out.slamX = level > 0 ? (rnd(p.seed, TAG_SLAM, gframe) * 2 - 1) * p.slam : 0;
  out.slamY = level > 0 ? (rnd(p.seed, TAG_SLAM, gframe, 1) * 2 - 1) * p.slam * 0.25 : 0;

  for (let k = 0; k < bands; k++) {
    if (level <= 0 || rnd(p.seed, TAG_BAND, gframe, k) >= p.bandChance) {
      out.dx[k] = 0;
      out.dy[k] = 0;
      out.alpha[k] = 1;
      continue;
    }
    out.dx[k] = (rnd(p.seed, TAG_DX, gframe, k) * 2 - 1) * p.slice * level;
    out.dy[k] = (rnd(p.seed, TAG_DY, gframe, k) * 2 - 1) * p.sliceY * level;
    out.alpha[k] = rnd(p.seed, TAG_DROP, gframe, k) < p.drop ? 0.25 : 1;
  }
}
