/**
 * The GIVEN spline — the one thing on this page pcg-ts does not make.
 *
 * The demo's claim is "hand the library a spline you already have and it
 * dresses the roadside of it", so the spline has to come from outside the
 * graph or the claim is untested. This module is that outside: plain
 * arithmetic, no library import, handed in through a `dataInput` node.
 * Swap this file for a track exported from anywhere and nothing
 * downstream changes.
 *
 * IT IS SHAPED LIKE A RACING CIRCUIT, and that took a different
 * construction than the obvious one. The first version was a sum of
 * integer harmonics of the lap angle — closes exactly, reads fine from
 * above, and cannot produce a racetrack. A radial harmonic of order k
 * puts its curvature extremes 2k times around the lap, so the corner
 * COUNT is set by the order and the corner DEPTH by the amplitude, and
 * the two cannot be chosen independently. Against the shape targets
 * below, prioritising the tight tail gave a
 * radius p10 of 6.8W (wanted 5.1-8.8) with 3.57 corners per 20W (wanted
 * 0.61-1.33); prioritising the corner count gave 0.92 corners per 20W
 * with a p10 of 18.1 and one percent of the lap in a corner against a
 * target twenty to thirty-seven. The two targets are mutually
 * exclusive under a harmonic sum, because a circuit has BIMODAL
 * curvature — near-straight between distinct corners — and a sum of
 * sinusoids is smooth everywhere.
 *
 * SO: A FILLETED POLYGON. Vertices on a jittered circle rounded by arcs.
 * Closure is free because a polygon closes, the corner count IS the
 * vertex count, and each corner's radius is its fillet's — so every
 * figure in the target table below becomes a knob rather than an
 * emergent property.
 *
 * PLUS A WINDOWED WOBBLE, which is the part that is not obvious, and
 * which took two goes.
 *
 * A filleted polygon has LITERAL straights, and half a lap of literal
 * straight reads as an infinite radius: the median came out at 76W
 * against a target 31.5. So the long edges have to bend. A low-order
 * radial wobble does that without touching a 4W fillet, and it moved the
 * median into band immediately.
 *
 * It also bent EVERYTHING, which the median could not see. A quarter of
 * the lap — 25.4% [14.2-39.7] at R >= 200W — has to be straight in the
 * sense a driver would recognise, and a global wobble left 11.5%, under the tenth
 * percentile. So the wobble is WINDOWED: a raised sinusoid clipped at a
 * floor, active over part of the lap and exactly zero over the rest, with
 * the clip smooth enough that the window is not itself a corner.
 *
 * Two figures, one of which is invisible to the other. "Half the lap
 * curves" and "a quarter of it does not" are both true and neither
 * implies the other, which is the whole reason the second one is gated
 * separately.
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
  /** Samples around the finished loop. */
  readonly samples?: number;
  /** Half the road width, in world units. */
  readonly halfWidth?: number;
  /** Which lap to draw: moves the jitter and the phases, never the shape rules. */
  readonly seed?: number;
}

/**
 * The target shape, and what each knob below is set from. Medians are
 * length-weighted, with corners counted as RUNS so a long bend is one
 * corner rather than forty.
 *
 * Kept here as a comment rather than as code because nothing reads them
 * at runtime — the tuning happened once, offline, and `tests/
 * roadLapShape.test.ts` is what holds this file to them.
 *
 *   lap length              362 W   [286-443]
 *   radius p10              6.6 W   [5.1-8.8]
 *   radius median          31.5 W   [16.4-45.1]
 *   tightest corner         3.1 W   [2.2-5.5]
 *   corners per lap          18     [11-24]      runs under R = 12W
 *   share of lap in corner   30%    [20-37]
 *   truly straight          25.4%   [14.2-39.7]  R >= 200W
 *
 * A CORNER IS A MAXIMAL RUN of frames under R = 12W, with no hysteresis
 * and no minimum length, so two bends with a frame of straight between
 * them are two corners. That is the rules' definition and it is crude on
 * purpose: tightening it to a 2W minimum run moves the population
 * figure from 18 corners to 15, which is not enough to matter. Entry is
 * the run's first frame in racing order and severity is its tightest
 * radius, which is what L-2 and L-3 assume.
 */
const LAP = {
  /** Corners around the lap. This IS the vertex count of the polygon. */
  corners: 23,
  /** Mean polygon radius, in world units. Sets the lap's length. */
  radius: 440.4,
  /** Per-vertex radial jitter, as a fraction of `radius`. */
  jitterR: 0.230,
  /** Per-vertex angular jitter, in radians. */
  jitterA: 0.165,
  /** Corner radius range, in half-widths, drawn per corner. */
  cornerMinW: 3.85,
  cornerMaxW: 19.99,
  /** The wobble that bends the straights. Amplitude is a fraction of radius. */
  wobbleAmp: 0.0606,
  wobbleOrder: 6,
  /**
   * The window the wobble acts through. `maskOrder` is how many times
   * round the lap it opens and closes; `maskFloor` is where the raised
   * sinusoid is clipped, so a higher floor leaves more of the lap
   * genuinely straight.
   */
  maskOrder: 2,
  maskFloor: -0.067,
  /** Peak height swing of the circuit, in world units. */
  relief: 26,
  /**
   * Largest share of an edge a fillet may consume. Below about a half the
   * straights survive; at a half two fillets meet and the lap becomes a
   * rounded polygon with no straight at all.
   */
  maxEdgeShare: 0.4,
  /** Samples per fillet arc before the even-arc-length resample. */
  arcSamples: 26,
} as const;

/**
 * Deterministic value in [0, 1) for `k` under `seed`.
 *
 * A hash rather than `Math.random`, because the page re-derives the same
 * lap on every reload and after every recook, and because the project
 * forbids `Math.random` outright.
 */
function hash(seed: number, k: number): number {
  let h = (seed * 0x9e3779b1 + k * 0x85ebca6b) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

type Pt = readonly [number, number];

/** The polygon whose corners become the circuit's corners. */
function vertices(seed: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < LAP.corners; i++) {
    const a = (i / LAP.corners) * Math.PI * 2 + (hash(seed, i * 3 + 1) - 0.5) * LAP.jitterA;
    const r = LAP.radius * (1 + (hash(seed, i * 3 + 2) - 0.5) * 2 * LAP.jitterR);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/**
 * Round every vertex with an arc, emitting the corner samples in order.
 *
 * The straights need no samples of their own: consecutive fillets' exit
 * and entry points are the ends of one, and the even-arc-length resample
 * below fills it in. That is also why the tangent length is CLAMPED to a
 * share of the shorter edge — without it a generous fillet on a short
 * edge eats the whole straight, and two adjacent ones overlap and fold
 * the path back on itself.
 */
function fillet(V: readonly Pt[], seed: number): Pt[] {
  const pts: Pt[] = [];
  const n = V.length;
  for (let i = 0; i < n; i++) {
    const p = V[i];
    const a = V[(i - 1 + n) % n];
    const b = V[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ua: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
    const ub: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const cosI = Math.max(-0.9999, Math.min(0.9999, ua[0] * ub[0] + ua[1] * ub[1]));
    const half = Math.acos(cosI) / 2;

    const wantW = LAP.cornerMinW + hash(seed, i * 3 + 3) * (LAP.cornerMaxW - LAP.cornerMinW);
    const want = wantW * DEFAULT_HALF_WIDTH;
    const tanLen = Math.min(want / Math.tan(half), Math.min(la, lb) * LAP.maxEdgeShare);
    const R = tanLen * Math.tan(half);

    const ta: Pt = [p[0] + ua[0] * tanLen, p[1] + ua[1] * tanLen];
    const tb: Pt = [p[0] + ub[0] * tanLen, p[1] + ub[1] * tanLen];
    // The arc centre sits along the interior bisector at R / sin(half).
    const bx = ua[0] + ub[0];
    const by = ua[1] + ub[1];
    const lbis = Math.hypot(bx, by) || 1;
    const cx = p[0] + (bx / lbis) * (R / Math.sin(half));
    const cy = p[1] + (by / lbis) * (R / Math.sin(half));

    const a0 = Math.atan2(ta[1] - cy, ta[0] - cx);
    let sweep = Math.atan2(tb[1] - cy, tb[0] - cx) - a0;
    // The SHORT way round. Taking the long way turns a corner into a loop.
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;

    pts.push(ta);
    for (let k = 1; k < LAP.arcSamples; k++) {
      const t = a0 + sweep * (k / LAP.arcSamples);
      pts.push([cx + Math.cos(t) * R, cy + Math.sin(t) * R]);
    }
    pts.push(tb);
  }
  return pts;
}

/** The half-width the corner radii above were tuned against. */
const DEFAULT_HALF_WIDTH = 9;

/** A closed racetrack centreline, shaped to the targets above. */
export function makeTrackSpline(opts: TrackOptions = {}): Spline {
  const halfWidth = opts.halfWidth ?? DEFAULT_HALF_WIDTH;
  const count = opts.samples ?? 1440;
  const seed = opts.seed ?? 1;

  const pts = fillet(vertices(seed), seed);

  // Even arc length, so the resample downstream starts from a path whose
  // samples already carry no bias toward the corners — where `fillet`
  // emits twenty-six points per arc and none along a straight.
  const n = pts.length;
  const s = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s[i + 1] = s[i] + Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
  }
  const total = s[n];

  const positions = new Float64Array(count * 3);
  const reliefPhase = hash(seed, 2) * Math.PI * 2;
  const wobblePhase = hash(seed, 5) * Math.PI * 2;
  const maskPhase = hash(seed, 7) * Math.PI * 2;
  let k = 0;
  for (let m = 0; m < count; m++) {
    const d = (m / count) * total;
    while (k < n - 1 && s[k + 1] < d) k++;
    const span = s[k + 1] - s[k];
    const f = span > 0 ? (d - s[k]) / span : 0;
    const j = (k + 1) % n;
    let x = pts[k][0] + (pts[j][0] - pts[k][0]) * f;
    let z = pts[k][1] + (pts[j][1] - pts[k][1]) * f;

    // The wobble, through its window. Radial and low-order, so it bends a
    // long straight and leaves a tight fillet alone; windowed, so a
    // quarter of the lap keeps a straight a driver would recognise. See
    // the header for why one figure cannot stand in for the other.
    const theta = Math.atan2(z, x);
    const raw = Math.sin(LAP.maskOrder * theta + maskPhase);
    const gate = Math.max(0, raw - LAP.maskFloor) / (1 - LAP.maskFloor);
    const scale = 1 + LAP.wobbleAmp * gate * Math.sin(LAP.wobbleOrder * theta + wobblePhase);
    x *= scale;
    z *= scale;

    positions[m * 3] = x;
    // Relief runs on the lap FRACTION rather than on theta: theta is not
    // monotonic once the polygon is jittered, and a height built on it
    // doubles back wherever the lap does.
    positions[m * 3 + 1] = LAP.relief * Math.sin(2 * ((m / count) * Math.PI * 2) + reliefPhase);
    positions[m * 3 + 2] = z;
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
