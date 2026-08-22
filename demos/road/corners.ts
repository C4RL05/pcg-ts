/**
 * The corner model — §9's step 2, and the thing three separate rules need
 * before they can say anything.
 *
 * L-2 puts a marker before every corner's ENTRY, L-3 puts a ruler before
 * every corner tighter than R = 8W, and L-6 may not start enclosure
 * INSIDE a corner tighter than R = 8W. All three need the same four
 * numbers per corner, so they are derived once here rather than three
 * times with three chances to disagree.
 *
 * THE DEFINITION IS UPSTREAM'S, and it is crude on purpose: a corner is a
 * maximal run of frames under R = 12W, with no hysteresis and no minimum
 * length. A chicane whose curvature crosses 12W between the two apexes is
 * two corners. Keeping their definition is what lets a figure measured on
 * their circuits be compared with a figure measured on this one at all —
 * a better definition here would silently rebase every published number.
 *
 * SIGN IS THE PART THAT CANNOT BE CHECKED BY EYE. "Outside" is the side
 * away from the centre of curvature, so it is a function of which way the
 * corner turns, and a mirrored turn direction produces a lap where every
 * marker is on the wrong side while every count, share and distance still
 * passes. That is the exact failure the lateral axis already had once.
 */
import type { Lap } from "./lap.js";

/** Corners are runs under this radius, in half-widths. Upstream's cut. */
export const CORNER_R_W = 12;

/** L-2's severity split, and L-3's and L-6's threshold. */
export const SEVERITY = {
  /** Corners tighter than this get L-2's first archetype. */
  sharpW: 6,
  /** L-3's braking references, and L-6's forbidden enclosure start. */
  tightW: 8,
} as const;

export type Severity = "sharp" | "open";

export interface Corner {
  /** Station of the run's first frame in racing order, in W. */
  readonly entryW: number;
  /** Station of the run's last frame, in W. May be less than entry: it wraps. */
  readonly exitW: number;
  /** The run's tightest radius, in W — upstream's per-corner severity. */
  readonly tightestW: number;
  /** +1 for a right-hander, -1 for a left-hander. */
  readonly turn: 1 | -1;
  /** Which side is the outside: the sign a placement's lateral takes. */
  readonly outside: 1 | -1;
  /** L-2's two classes. */
  readonly severity: Severity;
}

/**
 * Signed curvature at a frame, in 1/W. Positive turns RIGHT.
 *
 * Central difference of unit tangents projected onto `across`, which is
 * right of travel — so the sign is read off the published axis rather
 * than re-derived from a cross product that could come out mirrored.
 */
export function signedCurvatureAt(lap: Lap, i: number): number {
  const a = (i - 1 + lap.count) % lap.count;
  const b = (i + 1) % lap.count;
  const step = lap.length / lap.count;
  const dx = (lap.tangent[b * 3] - lap.tangent[a * 3]) / (2 * step);
  const dy = (lap.tangent[b * 3 + 1] - lap.tangent[a * 3 + 1]) / (2 * step);
  const dz = (lap.tangent[b * 3 + 2] - lap.tangent[a * 3 + 2]) / (2 * step);
  const k = dx * lap.across[i * 3] + dy * lap.across[i * 3 + 1] + dz * lap.across[i * 3 + 2];
  return k * lap.halfWidth;
}

/** Unsigned radius at a frame, in W. Infinite on a straight. */
export function radiusAtIndex(lap: Lap, i: number): number {
  const a = (i - 1 + lap.count) % lap.count;
  const b = (i + 1) % lap.count;
  const step = lap.length / lap.count;
  const k = Math.hypot(
    (lap.tangent[b * 3] - lap.tangent[a * 3]) / (2 * step),
    (lap.tangent[b * 3 + 1] - lap.tangent[a * 3 + 1]) / (2 * step),
    (lap.tangent[b * 3 + 2] - lap.tangent[a * 3 + 2]) / (2 * step),
  );
  return k > 1e-12 ? 1 / (k * lap.halfWidth) : Number.POSITIVE_INFINITY;
}

/** Local corner radius in W at a station, from the cooked frames. */
export function radiusAtW(lap: Lap, stationW: number): number {
  const i = Math.min(lap.count - 1, Math.max(0, Math.round((stationW / lap.lengthW) * lap.count)));
  return radiusAtIndex(lap, i);
}

/** The station, in W, of a frame index. */
export function stationOfIndex(lap: Lap, i: number): number {
  return (lap.s[i] ?? 0) / lap.halfWidth;
}

/**
 * Every corner on the lap, in racing order from the start line.
 *
 * A RUN THAT WRAPS THE START LINE IS ONE CORNER, not two. The lap is a
 * loop and the start line is an arbitrary cut in it; splitting there
 * would invent an extra corner on roughly one lap in `corners`, and give
 * it a false entry at station zero that L-2 would then mark.
 */
export function cornersOf(lap: Lap): Corner[] {
  const n = lap.count;
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) R[i] = radiusAtIndex(lap, i);

  const isCorner = (i: number): boolean => R[i] < CORNER_R_W;

  // Start the scan at a frame that BEGINS a run, so no run is cut in
  // half by where the scan happens to start. If every frame is a corner
  // there is no such frame, and the lap is one continuous bend.
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (isCorner(i) && !isCorner((i - 1 + n) % n)) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const out: Corner[] = [];
  let i = 0;
  while (i < n) {
    const at = (start + i) % n;
    if (!isCorner(at)) {
      i++;
      continue;
    }
    // Walk the whole run.
    let len = 0;
    let tightest = Number.POSITIVE_INFINITY;
    let signSum = 0;
    while (len < n && isCorner((start + i + len) % n)) {
      const j = (start + i + len) % n;
      tightest = Math.min(tightest, R[j]);
      // Weighted by curvature, so the run's direction is set by its
      // deepest part rather than by frames near the 12W threshold where
      // the sign is noise.
      signSum += signedCurvatureAt(lap, j);
      len++;
    }
    const first = (start + i) % n;
    const last = (start + i + len - 1) % n;
    const turn: 1 | -1 = signSum >= 0 ? 1 : -1;
    out.push({
      entryW: stationOfIndex(lap, first),
      exitW: stationOfIndex(lap, last),
      tightestW: tightest,
      turn,
      // The outside of a right-hander is to the LEFT, and lateral is
      // positive right of travel.
      outside: turn === 1 ? -1 : 1,
      severity: tightest < SEVERITY.sharpW ? "sharp" : "open",
    });
    i += len;
  }
  return out;
}

/**
 * Distance back along the lap from `station` to `entry`, always positive.
 *
 * Everything L-2 and L-3 do is expressed as "so many W BEFORE the entry",
 * and on a loop that is a modular subtraction — a marker at station 4 for
 * a corner entering at station 2 of a 300W lap is 298W early, not 2W
 * late, and the naive difference gets that backwards exactly once per
 * lap.
 */
export function beforeEntryW(station: number, entryW: number, lapW: number): number {
  let d = (entryW - station) % lapW;
  if (d < 0) d += lapW;
  return d;
}
