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
 * THE DERIVATION IS THE GRAPH'S NOW. `graph.ts` publishes it as columns
 * on the frames — the local radius, the signed turn, and the two
 * segmented scans that cut the lap into runs (see `CORNER_MODEL`) — and
 * this module assembles those into corners. What used to be here was a second central
 * difference over the same tangents and a second walk over the same
 * frames; both are things the library does, and doing them again in the
 * host is how a demo ends up with two definitions of a corner that agree
 * until the day they do not. What is left is the part that is genuinely
 * not a scan: the tightest radius in a run is a MINIMUM, and a segmented
 * running total is a sum.
 *
 * WHY THERE IS STILL A TYPESCRIPT STATEMENT OF THE RULE. A `Lap` need not
 * have been cooked. The corner suites build one out of stated positions
 * and stated tangents — a circle whose radius is known to be 5W, a
 * stadium with exactly two bends, the same stadium with its start line
 * rotated into the middle of one of them — because those are laps whose
 * answers are arithmetic rather than a re-run of the code under test.
 * Deriving the columns for such a lap is what `cornerColumnsOf` does, and
 * it is written to MIRROR the nodes rather than to be clever: the same
 * threshold, the same masking, the same rotation onto the first straight
 * frame that `pathRuns` performs. A divergence between the two then has
 * to be an edit somebody made, not a difference that crept in.
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
import type { CornerColumns, Lap } from "./lap.js";

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
 * The cooked column when there is one — `graph.ts` takes the curvature
 * vector `writeCurveFrame` wrote and dots it with the frame's own
 * `across`, which is right of travel, so the sign is read off the
 * published axis rather than re-derived from a cross product that could
 * come out mirrored.
 *
 * Otherwise the same quantity from the lap's own tangents: a central
 * difference over the mean frame spacing. That divisor is where the two
 * differ at all — the node divides by the two segments actually meeting
 * at the frame, which on a resampled curve are a shade shorter inside a
 * corner than the lap's average, so the node reads a corner as very
 * slightly tighter. The node is the one that is right; the mean
 * approximates it, and a hand-built lap has no arc table to do better.
 */
export function signedCurvatureAt(lap: Lap, i: number): number {
  if (lap.corner) return lap.corner.turnK[i];
  const a = (i - 1 + lap.count) % lap.count;
  const b = (i + 1) % lap.count;
  const step = lap.length / lap.count;
  const dx = (lap.tangent[b * 3] - lap.tangent[a * 3]) / (2 * step);
  const dy = (lap.tangent[b * 3 + 1] - lap.tangent[a * 3 + 1]) / (2 * step);
  const dz = (lap.tangent[b * 3 + 2] - lap.tangent[a * 3 + 2]) / (2 * step);
  const k = dx * lap.across[i * 3] + dy * lap.across[i * 3 + 1] + dz * lap.across[i * 3 + 2];
  return k * lap.halfWidth;
}

/**
 * Unsigned radius at a frame, in W. Infinite on a straight.
 *
 * The cooked column when there is one; see `signedCurvatureAt` for what
 * separates the two paths. The `1e-12` cut on the hand-built path and the
 * node's plain division by zero reach the same answer from opposite
 * directions: a curvature that small already inverts past any radius any
 * rule can tell from infinite.
 */
export function radiusAtIndex(lap: Lap, i: number): number {
  if (lap.corner) return lap.corner.radiusW[i];
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
 * A frame is in a corner when its radius is UNDER the threshold.
 *
 * A STRICT LESS-THAN and nothing else, which is what makes it total: a
 * straight's Infinity and an unmeasurable frame's NaN both compare false
 * and land on the straight side with no second test to remember. It is
 * the same predicate the graph negates to build `cornerStraight`, and
 * for the same reason — see that node for why `ge` and `step` are the
 * wrong spellings of it.
 *
 * A frame whose radius could not be measured must not become a corner by
 * default: it would enter at a station nothing chose, and L-2 would
 * dutifully mark it.
 */
function inCorner(radiusW: number): boolean {
  return radiusW < CORNER_R_W;
}

/**
 * One direction of the segmented scan the two `pathRuns` nodes perform,
 * for a lap that was never cooked.
 *
 * A DELIBERATE TRANSCRIPTION of that node, not an independent solution to
 * the same problem — inclusive mode, masked to zero outside a corner,
 * and the walk rotated onto the first flagged frame so a run may cross
 * the seam. `dir` is -1 for the backward scan, which visits the frames in
 * reverse and so accumulates what lies AHEAD of each one.
 */
function scanRuns(radiusW: Float64Array, turnK: Float64Array, out: Float64Array, dir: 1 | -1): void {
  const n = radiusW.length;
  const visit = (k: number): number => (dir > 0 ? k : n - 1 - k);
  // Rotate onto the first straight frame in visit order. With none —
  // every frame a corner — there is no place for a cyclic run to begin,
  // so the seam stands in, exactly as `wrap` does with nothing flagged.
  let rotate = 0;
  for (let k = 0; k < n; k++) {
    if (!inCorner(radiusW[visit(k)])) {
      rotate = k;
      break;
    }
  }
  let count = 0;
  let turn = 0;
  for (let j = 0; j < n; j++) {
    const i = visit((rotate + j) % n);
    // The reset happens BEFORE the frame is read, so a straight frame
    // opens its own run rather than closing the one before it — and,
    // contributing a masked zero to it, leaves it reading zero.
    if (!inCorner(radiusW[i])) {
      count = 0;
      turn = 0;
    } else {
      count += 1;
      // A NaN CONTRIBUTES NOTHING rather than poisoning the rest of its
      // run, which is the node's rule and applies per component — a turn
      // that could not be measured must not take the count down with it.
      // `v === v` is the NaN test that does not depend on coercion. The
      // count itself needs no such guard: its source is a masked 0 or 1.
      if (turnK[i] === turnK[i]) turn += turnK[i];
    }
    out[i * 2] = count;
    out[i * 2 + 1] = turn;
  }
}

/**
 * The corner columns for a lap: the graph's when it has them, and the
 * same rule restated here when it does not. See this module's header.
 *
 * EXPORTED FOR THE SUITES, and for one reason: `cornerGraph` derives the
 * corners from these columns rather than from the frames, so testing it
 * on a hand-built lap means attaching them first. That keeps the
 * comparison honest -- both sides then read the SAME columns, so a
 * disagreement is about the assembly this port replaced and not about
 * two different measurements of the same bend.
 */
export function cornerColumnsOf(lap: Lap): CornerColumns {
  if (lap.corner) return lap.corner;
  const n = lap.count;
  const radiusW = new Float64Array(n);
  const turnK = new Float64Array(n);
  // Through the two exported readers rather than inline, so the central
  // difference is written down exactly once even on this path.
  for (let i = 0; i < n; i++) {
    radiusW[i] = radiusAtIndex(lap, i);
    turnK[i] = signedCurvatureAt(lap, i);
  }
  const behind = new Float64Array(n * 2);
  const ahead = new Float64Array(n * 2);
  scanRuns(radiusW, turnK, behind, 1);
  scanRuns(radiusW, turnK, ahead, -1);
  return { radiusW, turnK, behind, ahead };
}

/**
 * Every corner on the lap, in racing order from the start line.
 *
 * A CORNER IS FOUND BY A FILTER, not by a scan with state. The forward
 * segmented run counts 1 at a corner's first frame and nowhere else — a
 * straight frame reads 0 because its own contribution is masked away, and
 * every later frame of a corner reads 2 or more — so the entries are
 * simply the frames reading 1, and the backward run at that same frame
 * already holds the whole corner: how many frames it lasts, and its total
 * turn. What is left to do here is the minimum, which a running total
 * cannot express.
 *
 * A RUN THAT WRAPS THE START LINE IS ONE CORNER, not two, and that is the
 * scans' `wrap` rather than anything this function does. The lap is a
 * loop and the start line is an arbitrary cut in it; splitting there
 * would invent an extra corner on roughly one lap in `corners`, and give
 * it a false entry at station zero that L-2 would then mark.
 *
 * THE ORDER IS THE FRAME ORDER, which is racing order from the start
 * line. That holds even when a corner straddles the line: its entry is
 * the highest frame index of any entry, so it comes last, and the frames
 * of it that sit before the line belong to it rather than opening the
 * list.
 */
export function cornersOf(lap: Lap): Corner[] {
  const n = lap.count;
  const c = cornerColumnsOf(lap);

  // A lap with no straight frame anywhere is ONE CONTINUOUS BEND and has
  // no entry at all — a circle is the clean case. It has to be caught
  // before the filter below rather than by it: a segmented scan with
  // nothing to reset on starts counting at the seam, so the frame there
  // reads 1 and would be taken for an entry, cutting the circle at an
  // arbitrary point and inventing a corner nothing turned into.
  let anyStraight = false;
  for (let i = 0; i < n; i++) {
    if (!inCorner(c.radiusW[i])) {
      anyStraight = true;
      break;
    }
  }
  if (!anyStraight) return [];

  const out: Corner[] = [];
  for (let i = 0; i < n; i++) {
    if (c.behind[i * 2] !== 1) continue;
    const len = c.ahead[i * 2];
    // Summed over the WHOLE run, so the direction is set by the corner's
    // deepest part rather than by the frames near the 12W threshold where
    // the sign is noise.
    const turn: 1 | -1 = c.ahead[i * 2 + 1] >= 0 ? 1 : -1;
    let tightest = Number.POSITIVE_INFINITY;
    for (let d = 0; d < len; d++) tightest = Math.min(tightest, c.radiusW[(i + d) % n]);
    out.push({
      entryW: stationOfIndex(lap, i),
      exitW: stationOfIndex(lap, (i + len - 1) % n),
      tightestW: tightest,
      turn,
      // The outside of a right-hander is to the LEFT, and lateral is
      // positive right of travel.
      outside: turn === 1 ? -1 : 1,
      severity: tightest < SEVERITY.sharpW ? "sharp" : "open",
    });
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
