/**
 * The split-flap board: the small text, one character cell at a time.
 *
 * The whole engine is a pure function of `(seed, t)`. No cell carries state
 * between frames and nothing accumulates — every draw is keyed by cell and
 * flip index. Park the clock on any `t` and the same board comes back,
 * which is what lets the page park the loop on one settled frame when the
 * reader has asked for reduced motion.
 */
import { CELL, GLYPHS, LINES, PITCH } from "./logo-data.js";
import { rnd } from "./rng.js";

/** Hash tags, so draws for different purposes cannot correlate. */
const TAG_START = 0x51a27;
const TAG_PICK = 0x1e3d1;
const TAG_CORRUPT = 0xc077;

export const CHARSETS = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  alnum: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  full: Object.keys(GLYPHS).join(""),
};

/** How a cell is being drawn this frame. Indexes STATE_CLASS in stage.js. */
export const BLANK = 0;
export const ROLLING = 1;
export const SETTLED = 2;
export const CORRUPT = 3;

/** One cell per non-space character, in lockup coordinates. */
export function buildCells() {
  const cells = [];
  LINES.forEach((line, li) => {
    for (let col = 0; col < line.text.length; col++) {
      const ch = line.text[col];
      if (ch === " ") continue;
      cells.push({
        line: li,
        col,
        target: ch,
        x: line.x + col * PITCH,
        y: line.baseline - CELL,
      });
    }
  });
  return cells;
}

/**
 * Per-cell timing. `cycle` is the full loop: the last cell to settle, plus
 * the hold — so no cell's settle time can fall outside one turn of it.
 *
 * Staggered by WHERE A CELL IS, not by its index in `LINES`. The lockup's
 * line order is authoring order (right column, then left, then the top
 * row), so keying the delay to it made the board resolve in jumps between
 * blocks. Rows are ranked top to bottom, and the column term is the cell's
 * real x in pitch units — so the sweep crosses the whole width at one
 * speed, and two blocks sharing a baseline continue each other instead of
 * starting over.
 */
export function buildSchedule(cells, p) {
  const baselines = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
  const row = new Map(baselines.map((y, i) => [y, i]));
  const originX = Math.min(...cells.map((c) => c.x));

  const start = new Float64Array(cells.length);
  const end = new Float64Array(cells.length);
  let last = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const jitter = rnd(p.seed, TAG_START, i) * p.jitter * p.scramble;
    const column = (c.x - originX) / PITCH;
    const s = row.get(c.y) * p.lineDelay + column * p.cellStagger + jitter;
    start[i] = s;
    end[i] = s + p.scramble;
    if (end[i] > last) last = end[i];
  }
  return { start, end, cycle: last + Math.max(0.1, p.hold) };
}

/**
 * Resolve the whole board at time `t`.
 *
 * `glitch` is the wordmark's current intensity — it is what gives settled
 * cells a chance of being knocked out, so a burst reaches across both
 * effects instead of the two running as strangers on the same page.
 *
 * Writes into `chars` and `states` rather than allocating: this runs every
 * frame over every cell, and the caller diffs the result to decide what
 * actually has to touch the DOM.
 */
export function flapAt(cells, schedule, p, t, glitch, chars, states) {
  const set = CHARSETS[p.charset] ?? CHARSETS.alnum;
  const n = set.length;

  if (!p.flap) {
    for (let i = 0; i < cells.length; i++) {
      chars[i] = cells[i].target;
      states[i] = SETTLED;
    }
    return;
  }

  const roll = p.flapMode === "roll";
  const steps = Math.max(1, Math.floor(p.scramble * p.flapRate));
  // Knock-outs share the glitch's clock rather than one of their own, so a
  // corrupted cell flickers WITH the burst instead of beating against it.
  const gframe = Math.floor(t * Math.max(1, p.stutter));
  const tc = t % schedule.cycle;

  for (let i = 0; i < cells.length; i++) {
    const target = cells[i].target;
    const s = schedule.start[i];
    const e = schedule.end[i];

    if (tc < s) {
      chars[i] = target;
      states[i] = BLANK;
      continue;
    }

    if (tc >= e) {
      // Settled — unless a burst is knocking cells out right now.
      if (
        p.corrupt > 0 &&
        glitch > 0 &&
        rnd(p.seed, TAG_CORRUPT, i, gframe) < p.corrupt * glitch
      ) {
        chars[i] = set[Math.floor(rnd(p.seed, TAG_PICK, i, gframe, 7) * n)];
        states[i] = CORRUPT;
      } else {
        chars[i] = target;
        states[i] = SETTLED;
      }
      continue;
    }

    const flip = Math.floor((tc - s) * p.flapRate);
    if (roll) {
      // A real board walks its wheel and stops on the letter. Work back from
      // the target so the last flip lands on it exactly. A target outside
      // the chosen wheel cannot be walked to, so it scrambles instead.
      const at = set.indexOf(target);
      if (at < 0) {
        chars[i] = set[Math.floor(rnd(p.seed, TAG_PICK, i, flip) * n)];
      } else {
        const from = (((at - steps) % n) + n) % n;
        chars[i] = set[(from + Math.min(flip, steps)) % n];
      }
    } else {
      chars[i] = set[Math.floor(rnd(p.seed, TAG_PICK, i, flip) * n)];
    }
    states[i] = ROLLING;
  }
}
