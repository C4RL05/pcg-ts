/**
 * The GIVEN spline — the one thing on this page pcg-ts does not make.
 *
 * The demo's claim is "hand the library a spline you already have and it
 * dresses the roadside of it", so the spline has to come from outside the
 * graph or the claim is untested. This module is that outside: plain
 * arithmetic over a closed loop, no library import, handed in through a
 * `dataInput` node. Swap this file for a track exported from anywhere and
 * nothing downstream changes.
 *
 * IT CLOSES EXACTLY, and that is the only hard requirement it has. The
 * loop is built from INTEGER harmonics of the lap angle so the last
 * sample meets the first to the bit; a noise-shaped radius would leave a
 * seam at the start line, and a seam is visible in every pass this page
 * runs — the road ribbon kinks there, the dressing doubles up, and the
 * lap counter jumps.
 */

/** A closed centreline: flat xyz triples, first point NOT repeated. */
export interface Spline {
  readonly positions: Float64Array;
  readonly closed: true;
  /** Half the road width, in world units — the scale everything is stated in. */
  readonly halfWidth: number;
}

/** Knobs for {@link makeTrackSpline}. */
export interface TrackOptions {
  /** Control points around the loop. More is smoother, not longer. */
  readonly controlPoints?: number;
  /** Mean radius of the lap, in world units. */
  readonly radius?: number;
  /** Peak height swing of the circuit, in world units. */
  readonly relief?: number;
  /** Half the road width, in world units. */
  readonly halfWidth?: number;
  /** Which lap to draw: changes the harmonic phases, never their orders. */
  readonly seed?: number;
}

/**
 * Deterministic phase for harmonic `k` under `seed`.
 *
 * A hash rather than `Math.random`, because the page re-derives the same
 * lap on every reload and after every recook, and because the project
 * forbids `Math.random` outright. Integer-in, float-out, and the same
 * (seed, k) always gives the same angle.
 */
function phase(seed: number, k: number): number {
  let h = (seed * 0x9e3779b1 + k * 0x85ebca6b) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

/**
 * A closed racetrack centreline.
 *
 * THE HARMONIC ORDERS ARE CHOSEN FOR THE CORNERS THEY MAKE, not for the
 * outline. A radial harmonic of order k and relative amplitude a tightens
 * the local radius of curvature by roughly a·k², so the low orders decide
 * the lap's overall shape and the high ones are what put actual corners
 * in it. Only the PHASES move with the seed: re-rolling the orders would
 * give laps whose corner statistics differ, and then no two seeds could
 * be compared.
 */
export function makeTrackSpline(opts: TrackOptions = {}): Spline {
  const n = opts.controlPoints ?? 720;
  const radius = opts.radius ?? 620;
  const relief = opts.relief ?? 26;
  const halfWidth = opts.halfWidth ?? 9;
  const seed = opts.seed ?? 1;

  const harmonics: readonly (readonly [order: number, amplitude: number])[] = [
    [3, 0.17],
    [7, 0.115],
    [11, 0.065],
  ];

  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let r = 1;
    for (const [order, amplitude] of harmonics) r += amplitude * Math.sin(order * t + phase(seed, order));
    r *= radius;
    positions[i * 3 + 0] = Math.cos(t) * r;
    positions[i * 3 + 1] = relief * Math.sin(2 * t + phase(seed, 2));
    positions[i * 3 + 2] = Math.sin(t) * r;
  }
  return { positions, closed: true, halfWidth };
}

/** Axis-aligned extents of a spline, for framing the map camera. */
export function splineBounds(spline: Spline): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const p = spline.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}
