/**
 * What the animation draws into: a canvas for the wordmark, an SVG for the
 * board, stacked in one frame that both size themselves from.
 *
 * WHY TWO SURFACES. The wordmark is the part that moves every frame, and
 * the SVG shape of it is the expensive shape: slicing means a `clipPath`
 * per band, the channels mean `mix-blend-mode` compositing over the whole
 * mark, and driving the slices through a group that `<use>` elements point
 * at means mutating a `<use>` target — which costs an instance-tree rebuild
 * per reference, per change, before any drawing happens.
 *
 * None of that is necessary. Pre-render the mark once per resize into three
 * tinted copies and a frame becomes `bands x 3` strip blits with additive
 * compositing: aligned strips sum back to white, offset ones leave the
 * coloured fringes, and the per-frame work is blitting.
 *
 * The board stays SVG, where it belongs: no blending, no clipping, and
 * flipping a character is one `href` write against an outline that is
 * already parsed. That is what lets the board run without the font.
 *
 * Measured at 60fps through both the scramble and the settled phase, in a
 * foreground window — the only place a frame rate means anything, since a
 * backgrounded tab throttles rAF and reads low no matter what it is doing.
 */
import { GLYPHS, VIEW_BOX, WORDMARK, WORDMARK_BOX } from "./logo-data.js";

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Stable dom id per glyph — the characters themselves are not id-safe. */
const GLYPH_IDS = new Map(Object.keys(GLYPHS).map((ch, i) => [ch, `gl-${i}`]));

/** Index order matches the state constants in flap.js. */
const STATE_CLASS = ["blank", "roll", "", "corrupt"];

const CHANNEL_COLORS = ["#f00", "#0f0", "#00f"];

export function createStage(frame, cells) {
  const canvas = document.createElement("canvas");
  canvas.className = "mark";
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  const svg = el("svg", {
    viewBox: `${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`,
    preserveAspectRatio: "xMidYMid meet",
    class: "board",
  });

  const defs = el("defs");
  for (const [ch, d] of Object.entries(GLYPHS)) {
    defs.append(el("path", { id: GLYPH_IDS.get(ch), d }));
  }
  svg.append(defs);

  const board = el("g", { class: "cells" });
  const fallback = GLYPH_IDS.get("A");
  const cellNodes = cells.map((c) =>
    el("use", {
      href: `#${GLYPH_IDS.get(c.target) ?? fallback}`,
      x: c.x,
      y: c.y,
      class: "cell",
    }),
  );
  board.append(...cellNodes);
  svg.append(board);

  frame.append(canvas, svg);

  /* ------------------------------------------------------- wordmark bitmap */

  const paths = WORDMARK.map((s) => new Path2D(s.d));
  let channels = [];
  let width = 0;
  let height = 0;
  let scale = 1;

  /**
   * Re-render the three tinted copies. Only on resize — the glitch never
   * touches these, it only reads strips out of them.
   */
  function resize() {
    const rect = frame.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    scale = width / VIEW_BOX.width;

    channels = CHANNEL_COLORS.map((color) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const cx = c.getContext("2d");
      cx.setTransform(scale, 0, 0, scale, -VIEW_BOX.x * scale, -VIEW_BOX.y * scale);
      cx.fillStyle = color;
      for (const p of paths) cx.fill(p);
      return c;
    });
  }

  resize();

  // Coalesced to one rebuild per frame. The Size slider commits live, so a
  // drag fires the observer as fast as the pointer moves, and each raw call
  // allocates three full-resolution canvases and refills six paths.
  let pending = 0;
  new ResizeObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      resize();
    });
  }).observe(frame);

  // Scratch for the intro's mosaic — one per channel, reused. The mark is
  // shrunk into these and read back out enlarged, so the downscale averages
  // each block's colour and the upscale keeps its edges hard.
  const scratch = [0, 1, 2].map(() => document.createElement("canvas"));

  /**
   * Blit the mark as a grid of blocks, each free to sit somewhere other
   * than where it belongs AND to show pixels from somewhere else again.
   * One `drawImage` per block does the mosaic and the displacement at once:
   * the source rect is expressed in whichever space `srcScale` maps to.
   */
  function drawIntro(f) {
    const px = Math.max(1, f.pixel * scale);
    const mosaic = px > 1.05;
    const sw = Math.max(1, Math.ceil(width / px));
    const sh = Math.max(1, Math.ceil(height / px));

    if (mosaic) {
      for (let c = 0; c < 3; c++) {
        const s = scratch[c];
        if (s.width !== sw || s.height !== sh) {
          s.width = sw;
          s.height = sh;
        }
        const sx = s.getContext("2d");
        sx.clearRect(0, 0, sw, sh);
        sx.imageSmoothingEnabled = true;
        sx.drawImage(channels[c], 0, 0, width, height, 0, 0, sw, sh);
      }
    }

    const srcScale = mosaic ? 1 / px : 1;
    const bw = f.blockW * scale;
    const bh = f.blockH * scale;
    const originX = (WORDMARK_BOX.x - VIEW_BOX.x) * scale;
    const originY = (WORDMARK_BOX.y - VIEW_BOX.y) * scale;

    ctx.imageSmoothingEnabled = false;
    for (let c = 0; c < 3; c++) {
      const chOff = (c === 0 ? -f.split : c === 2 ? f.split : 0) + f.slamX;
      const src = mosaic ? scratch[c] : channels[c];
      for (let by = 0; by < f.blockRows; by++) {
        for (let bx = 0; bx < f.blockCols; bx++) {
          const i = by * f.blockCols + bx;
          const a = f.blockA[i];
          if (a <= 0) continue;
          const homeX = originX + bx * bw;
          const homeY = originY + by * bh;
          ctx.globalAlpha = a;
          ctx.drawImage(
            src,
            (homeX + f.blockSx[i] * scale) * srcScale,
            (homeY + f.blockSy[i] * scale) * srcScale,
            bw * srcScale,
            bh * srcScale,
            homeX + (f.blockDx[i] + chOff) * scale,
            homeY + (f.blockDy[i] + f.slamY) * scale,
            bw,
            bh,
          );
        }
      }
    }
    ctx.imageSmoothingEnabled = true;
  }

  function applyGlitch(f) {
    if (channels.length !== 3) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    if (f.intro > 0) {
      drawIntro(f);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      return;
    }

    const bands = f.dx.length;
    const bandH = WORDMARK_BOX.height / bands;
    const top = WORDMARK_BOX.y - VIEW_BOX.y;

    for (let c = 0; c < 3; c++) {
      // Red trails the split, blue leads it; green holds the centre.
      const chOff = (c === 0 ? -f.split : c === 2 ? f.split : 0) + f.slamX;
      const src = channels[c];
      for (let k = 0; k < bands; k++) {
        const sy = (top + k * bandH) * scale;
        // A hair of overlap, or the seams show as hairlines at some scales.
        const sh = Math.min(bandH * scale + 1, height - sy);
        if (sh <= 0) continue;
        ctx.globalAlpha = f.alpha[k];
        ctx.drawImage(
          src,
          0,
          sy,
          width,
          sh,
          (f.dx[k] + chOff) * scale,
          sy + (f.dy[k] + f.slamY) * scale,
          width,
          sh,
        );
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Only what changed is written back: at twenty flips a second most cells
  // are holding still on any given frame, and a blanket rewrite of every
  // `href` would be the most expensive thing on the page.
  const lastChar = new Array(cells.length).fill("");
  const lastState = new Uint8Array(cells.length).fill(255);

  function applyBoard(chars, states) {
    for (let i = 0; i < cellNodes.length; i++) {
      const ch = chars[i];
      if (ch !== lastChar[i]) {
        lastChar[i] = ch;
        const id = GLYPH_IDS.get(ch);
        if (id) cellNodes[i].setAttribute("href", `#${id}`);
      }
      const st = states[i];
      if (st !== lastState[i]) {
        lastState[i] = st;
        const cls = STATE_CLASS[st];
        cellNodes[i].setAttribute("class", cls ? `cell ${cls}` : "cell");
      }
    }
  }

  return { frame, canvas, applyGlitch, applyBoard };
}
