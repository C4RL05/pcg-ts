/**
 * The logo, as data. GENERATED — do not edit by hand.
 *
 * Produced by `scripts/gen-logo-data.mjs` in the sibling private repo,
 * which reads the artwork and verifies every character in the lockup
 * against the glyph atlas before writing this file.
 *
 * Coordinates are the lockup's own, so everything here shares one space:
 * the 1055 x 245 viewBox below. Glyph outlines are the
 * exception — each is emitted in CELL space, an 8 x 8 box with
 * its cap line at y=0 and its baseline at y=8, so a cell can render any
 * character by pointing at a different outline. That is what lets the
 * board flap without a font installed anywhere.
 */

/** Horizontal advance between character cells. */
export const PITCH = 9.6;
/** Baseline-to-baseline distance between text rows. */
export const LEAD = 12.8;
/** The glyph ink box is exactly square: cap line to baseline, and wide. */
export const CELL = 8;

export const VIEW_BOX = {
  x: 0,
  y: 0,
  width: 1055,
  height: 245,
};

/** Where the big letters sit inside the viewBox — the glitch works on this. */
export const WORDMARK_BOX = {
  x: 0,
  y: 26.403,
  width: 1054.633,
  height: 127.96,
};

/** The six shapes of the wordmark, in lockup coordinates. */
export const WORDMARK = [
  { id: "P", d: "M138.62,58.393L138.62,26.403L0,26.403L0,58.393L138.62,58.393ZM138.622,58.393L138.622,90.383L31.99,90.383L0,122.373L0,154.363L31.99,154.363L31.99,122.373L138.622,122.373L170.612,90.383L170.612,58.393L138.622,58.393Z" },
  { id: "C", d: "M359.628,58.393L359.628,26.403L221.005,26.403L189.015,58.393L189.015,122.373L220.999,122.373L220.999,154.363L359.628,154.363L359.628,122.373L221.005,122.373L221.005,58.393L359.628,58.393Z" },
  { id: "G", d: "M548.643,58.393L548.643,26.403L410.02,26.403L378.03,58.393L378.03,122.373L410.02,122.373L410.02,58.393L548.643,58.393ZM469.785,154.363L501.777,122.373L516.653,122.373L516.653,154.363L548.643,154.363L548.643,90.383L488.556,90.383L456.566,122.373L410.02,122.373L410.02,154.363L469.785,154.363Z" },
  { id: "_-", d: "M567.046,90.383L695.006,90.383L695.006,122.373L567.046,122.373Z" },
  { id: "T", d: "M796.305,154.363L796.305,58.393L764.315,58.393L764.315,154.363L796.305,154.363ZM865.615,58.393L865.615,26.403L796.308,26.403L796.308,58.393L865.615,58.393ZM764.309,58.393L764.309,26.403L695.005,26.403L695.005,58.393L764.309,58.393Z" },
  { id: "S", d: "M916.008,58.393L1022.64,58.393L1022.64,26.403L916.008,26.403L884.018,58.393L884.018,90.383L1054.63,154.363L1054.63,120.214L916.008,68.207L916.008,58.393ZM916.008,154.363L916.008,122.373L884.018,122.373L884.018,154.363L916.008,154.363ZM1054.633,90.377L1054.633,58.393L1022.643,58.393L1022.643,90.377L1054.633,90.377Z" },
];

/**
 * Every glyph the board can show, in CELL space. 41 of them: the
 * atlas alphabet plus the punctuation the lockup uses.
 *
 * Worth knowing before scrambling: 'S' and '5' are the same outline in this
 * face, so a flip between the two shows no movement.
 */
export const GLYPHS = {
  "+": "M3.2,0L4.8,0L4.8,3.2L8,3.2L8,4.8L4.8,4.8L4.8,8L3.2,8L3.2,4.8L0,4.8L0,3.2L3.2,3.2L3.2,0Z",
  "-": "M0,3.2L8,3.2L8,4.8L0,4.8Z",
  ".": "M3.2,6.4L4.8,6.4L4.8,8L3.2,8Z",
  "/": "M6.4,0L8,0L8,1.6L6.4,1.6L6.4,0ZM4.8,1.6L6.4,1.6L6.4,3.2L4.8,3.2L4.8,1.6ZM3.2,3.2L4.8,3.2L4.8,4.8L3.2,4.8L3.2,3.2ZM1.6,4.8L3.2,4.8L3.2,6.4L1.6,6.4L1.6,4.8ZM0,6.4L1.6,6.4L1.6,8L0,8L0,6.4Z",
  "0": "M0,0L8,0L8,8L0,8L0,0ZM1.6,1.6L1.6,6.4L6.4,6.4L6.4,1.6L1.6,1.6ZM3.2,3.2L4.8,3.2L4.8,4.8L3.2,4.8L3.2,3.2Z",
  "1": "M0,0L4.8,0L4.8,6.4L8,6.4L8,8L0,8L0,6.4L3.2,6.4L3.2,1.6L0,1.6L0,0Z",
  "2": "M0,0L8,0L8,4.8L1.6,4.8L1.6,6.4L8,6.4L8,8L0,8L0,3.2L6.4,3.2L6.4,1.6L0,1.6L0,0Z",
  "3": "M0,0L8,0L8,8L0,8L0,6.4L6.4,6.4L6.4,4.8L0,4.8L0,3.2L6.4,3.2L6.4,1.6L0,1.6L0,0Z",
  "4": "M0,0L1.6,0L1.6,3.2L6.4,3.2L6.4,0L8,0L8,8L6.4,8L6.4,4.8L0,4.8L0,0Z",
  "5": "M0,0L8,0L8,1.6L1.6,1.6L1.6,3.2L8,3.2L8,8L0,8L0,6.4L6.4,6.4L6.4,4.8L0,4.8L0,0Z",
  "6": "M0,0L8,0L8,1.6L1.6,1.6L1.6,3.2L8,3.2L8,8L0,8L0,0ZM1.6,4.8L1.6,6.4L6.4,6.4L6.4,4.8L1.6,4.8Z",
  "7": "M0,0L8,0L8,8L6.4,8L6.4,1.6L0,1.6L0,0Z",
  "8": "M0,0L8,0L8,8L0,8L0,0ZM1.6,1.6L1.6,3.2L6.4,3.2L6.4,1.6L1.6,1.6ZM1.6,4.8L1.6,6.4L6.4,6.4L6.4,4.8L1.6,4.8Z",
  "9": "M0,0L8,0L8,8L0,8L0,6.4L6.4,6.4L6.4,4.8L0,4.8L0,0ZM1.6,1.6L1.6,3.2L6.4,3.2L6.4,1.6L1.6,1.6Z",
  "A": "M0,0L8,0L8,8L6.4,8L6.4,4.8L1.6,4.8L1.6,8L0,8L0,0ZM1.6,1.6L1.6,3.2L6.4,3.2L6.4,1.6L1.6,1.6Z",
  "B": "M0,0L6.4,0L6.4,3.2L8,3.2L8,8L0,8L0,0ZM1.6,1.6L1.6,3.2L4.8,3.2L4.8,1.6L1.6,1.6ZM1.6,4.8L1.6,6.4L6.4,6.4L6.4,4.8L1.6,4.8Z",
  "C": "M0,0L8,0L8,1.6L1.6,1.6L1.6,6.4L8,6.4L8,8L0,8L0,0Z",
  "D": "M0,0L6.4,0L6.4,1.6L1.6,1.6L1.6,6.4L6.4,6.4L6.4,8L0,8L0,0ZM6.4,1.6L8,1.6L8,6.4L6.4,6.4L6.4,1.6Z",
  "E": "M0,0L8,0L8,1.6L1.6,1.6L1.6,3.2L8,3.2L8,4.8L1.6,4.8L1.6,6.4L8,6.4L8,8L0,8L0,0Z",
  "F": "M0,0L8,0L8,1.6L1.6,1.6L1.6,3.2L6.4,3.2L6.4,4.8L1.6,4.8L1.6,8L0,8L0,0Z",
  "G": "M0,0L8,0L8,1.6L1.6,1.6L1.6,6.4L6.4,6.4L6.4,4.8L3.2,4.8L3.2,3.2L8,3.2L8,8L0,8L0,0Z",
  "H": "M0,0L1.6,0L1.6,3.2L6.4,3.2L6.4,0L8,0L8,8L6.4,8L6.4,4.8L1.6,4.8L1.6,8L0,8L0,0Z",
  "I": "M0,0L8,0L8,1.6L4.8,1.6L4.8,6.4L8,6.4L8,8L0,8L0,6.4L3.2,6.4L3.2,1.6L0,1.6L0,0Z",
  "J": "M0,0L8,0L8,8L0,8L0,6.4L6.4,6.4L6.4,1.6L0,1.6L0,0Z",
  "K": "M0,0L1.6,0L1.6,3.2L4.8,3.2L4.8,4.8L1.6,4.8L1.6,8L0,8L0,0ZM6.4,0L8,0L8,1.6L6.4,1.6L6.4,0ZM4.8,1.6L6.4,1.6L6.4,3.2L4.8,3.2L4.8,1.6ZM4.8,4.8L6.4,4.8L6.4,6.4L4.8,6.4L4.8,4.8ZM6.4,6.4L8,6.4L8,8L6.4,8L6.4,6.4Z",
  "L": "M0,0L1.6,0L1.6,6.4L8,6.4L8,8L0,8L0,0Z",
  "M": "M0,0L8,0L8,8L6.4,8L6.4,1.6L4.8,1.6L4.8,8L3.2,8L3.2,1.6L1.6,1.6L1.6,8L0,8L0,0Z",
  "N": "M0,0L1.6,0L1.6,1.6L3.2,1.6L3.2,3.2L1.6,3.2L1.6,8L0,8L0,0ZM6.4,0L8,0L8,8L6.4,8L6.4,6.4L4.8,6.4L4.8,4.8L6.4,4.8L6.4,0ZM3.2,3.2L4.8,3.2L4.8,4.8L3.2,4.8L3.2,3.2Z",
  "O": "M0,0L8,0L8,8L0,8L0,0ZM1.6,1.6L1.6,6.4L6.4,6.4L6.4,1.6L1.6,1.6Z",
  "P": "M0,0L8,0L8,4.8L1.6,4.8L1.6,8L0,8L0,0ZM1.6,1.6L1.6,3.2L6.4,3.2L6.4,1.6L1.6,1.6Z",
  "Q": "M0,0L8,0L8,8L0,8L0,0ZM1.6,1.6L1.6,6.4L3.2,6.4L3.2,4.8L4.8,4.8L4.8,6.4L6.4,6.4L6.4,1.6L1.6,1.6Z",
  "R": "M0,0L8,0L8,4.8L6.4,4.8L6.4,6.4L4.8,6.4L4.8,4.8L1.6,4.8L1.6,8L0,8L0,0ZM1.6,1.6L1.6,3.2L6.4,3.2L6.4,1.6L1.6,1.6ZM6.4,6.4L8,6.4L8,8L6.4,8L6.4,6.4Z",
  "S": "M0,0L8,0L8,1.6L1.6,1.6L1.6,3.2L8,3.2L8,8L0,8L0,6.4L6.4,6.4L6.4,4.8L0,4.8L0,0Z",
  "T": "M0,0L8,0L8,1.6L4.8,1.6L4.8,8L3.2,8L3.2,1.6L0,1.6L0,0Z",
  "U": "M0,0L1.6,0L1.6,6.4L6.4,6.4L6.4,0L8,0L8,8L0,8L0,0Z",
  "V": "M0,0L1.6,0L1.6,4.8L0,4.8L0,0ZM6.4,0L8,0L8,4.8L6.4,4.8L6.4,0ZM1.6,4.8L3.2,4.8L3.2,6.4L1.6,6.4L1.6,4.8ZM4.8,4.8L6.4,4.8L6.4,6.4L4.8,6.4L4.8,4.8ZM3.2,6.4L4.8,6.4L4.8,8L3.2,8L3.2,6.4Z",
  "W": "M0,0L1.6,0L1.6,6.4L3.2,6.4L3.2,0L4.8,0L4.8,6.4L6.4,6.4L6.4,0L8,0L8,8L0,8L0,0Z",
  "X": "M0,0L1.6,0L1.6,1.6L0,1.6L0,0ZM6.4,0L8,0L8,1.6L6.4,1.6L6.4,0ZM1.6,1.6L3.2,1.6L3.2,3.2L1.6,3.2L1.6,1.6ZM4.8,1.6L6.4,1.6L6.4,3.2L4.8,3.2L4.8,1.6ZM3.2,3.2L4.8,3.2L4.8,4.8L3.2,4.8L3.2,3.2ZM1.6,4.8L3.2,4.8L3.2,6.4L1.6,6.4L1.6,4.8ZM4.8,4.8L6.4,4.8L6.4,6.4L4.8,6.4L4.8,4.8ZM0,6.4L1.6,6.4L1.6,8L0,8L0,6.4ZM6.4,6.4L8,6.4L8,8L6.4,8L6.4,6.4Z",
  "Y": "M0,0L1.6,0L1.6,1.6L0,1.6L0,0ZM6.4,0L8,0L8,1.6L6.4,1.6L6.4,0ZM1.6,1.6L3.2,1.6L3.2,3.2L1.6,3.2L1.6,1.6ZM4.8,1.6L6.4,1.6L6.4,3.2L4.8,3.2L4.8,1.6ZM3.2,3.2L4.8,3.2L4.8,8L3.2,8L3.2,3.2Z",
  "Z": "M0,0L8,0L8,1.6L6.4,1.6L6.4,3.2L4.8,3.2L4.8,1.6L0,1.6L0,0ZM3.2,3.2L4.8,3.2L4.8,4.8L3.2,4.8L3.2,3.2ZM1.6,4.8L3.2,4.8L3.2,6.4L8,6.4L8,8L0,8L0,6.4L1.6,6.4L1.6,4.8Z",
  "r": "M0,0L8,0L8,1.6L1.6,1.6L1.6,8L0,8L0,0Z",
};

/** The small text: one entry per line, placed in lockup coordinates. */
export const LINES = [
  { x: 516.653, baseline: 180.766, text: "WORKER-POOL COOKING" },
  { x: 516.653, baseline: 193.566, text: "WEBGPU ACCELERATED" },
  { x: 516.653, baseline: 219.166, text: "THREE.JS INTEROP" },
  { x: 0, baseline: 180.766, text: "PROCEDURAL CONTENT GENERATION" },
  { x: 0, baseline: 193.566, text: "JSON + VISUAL NODE-GRAPH EDITOR" },
  { x: 0, baseline: 206.366, text: "SEEDED DETERMINISTIC EXECUTION" },
  { x: 0, baseline: 231.966, text: "DESIGNED FOR AGENTS + HUMANS" },
  { x: 0, baseline: 8, text: "MIT LICENSE" },
  { x: 695.006, baseline: 8, text: "PCG32" },
  { x: 764.315, baseline: 180.766, text: "NPM INSTALL PCG-TS" },
  { x: 764.315, baseline: 206.366, text: "C4rL05.GITHUB.IO/PCG-TS" },
  { x: 764.315, baseline: 219.166, text: "GITHUB.COM/C4rL05/PCG-TS" },
  { x: 764.315, baseline: 244.766, text: "STRICT TYPESCRIPT ESM" },
];

/** Total character cells across every line, spaces excluded. */
export const CELL_COUNT = 253;
