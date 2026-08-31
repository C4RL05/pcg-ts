/**
 * Reading the cooked lap back, and driving a camera round it.
 *
 * The half of the page that touches pcg-ts data. It is separate from
 * `main.ts` because what it produces — a position, a direction and an up
 * at a distance travelled — is what BOTH views need and neither owns: the
 * chase camera rides it, and the map marker is the same pose flattened.
 *
 * ARC LENGTH, NOT FRAME INDEX. The frames are evenly spaced along the
 * curve, so indexing them would very nearly work — and "very nearly" is
 * how a lap counter ends up drifting a whole frame per lap. The running
 * distance is measured from the positions themselves, so a station is a
 * distance in world units and the car moves at the speed it is given.
 */
import { type Geometry } from "pcg-ts";
import { CORNER_MODEL, TRACK_FRAME } from "./graph.js";

/** A pose on the lap: where, and the three axes of the track frame there. */
export interface Pose {
  readonly p: [number, number, number];
  /** `along` — the racing direction. */
  readonly dir: [number, number, number];
  /** `up` — the surface normal. */
  readonly up: [number, number, number];
  /** `across` — right of travel. */
  readonly across: [number, number, number];
}

/** A place on the track, in the coordinates every placement rule uses. */
export interface TrackCoord {
  /** Arc length from the start line, in half-widths. Wraps at the lap. */
  readonly station: number;
  /** Signed offset across the track, positive RIGHT of travel, in half-widths. */
  readonly lateral: number;
  /** Height above the road surface, in half-widths. */
  readonly height: number;
}

/**
 * The corner model, as the graph cooked it. See `CORNER_MODEL`.
 *
 * Four columns rather than a list of corners, because that is the shape a
 * point attribute has: the graph answers per frame, and assembling the
 * frames into corners is `cornersOf`'s job. Reading them costs one pass
 * and saves every consumer from differencing the tangents again.
 */
export interface CornerColumns {
  /** Local corner radius in W, per frame. Infinite on a straight. */
  readonly radiusW: Float64Array;
  /** Signed curvature in 1/W, per frame. Positive turns RIGHT. */
  readonly turnK: Float64Array;
  /** Per frame, xy: frames into this corner counting this one, and the turn so far. */
  readonly behind: Float64Array;
  /** Per frame, xy: frames left counting this one, and the turn remaining. */
  readonly ahead: Float64Array;
}

/** The lap, in the form the cameras and the placement lookup read it. */
export interface Lap {
  readonly count: number;
  /** Positions, xyz per frame. */
  readonly p: Float64Array;
  /** Unit tangents, xyz per frame — the frame's `along`. */
  readonly tangent: Float64Array;
  /** Unit axis right of travel, xyz per frame. */
  readonly across: Float64Array;
  /** Unit surface normal, xyz per frame. */
  readonly up: Float64Array;
  /** Running distance to each frame, plus the total at [count]. */
  readonly s: Float64Array;
  /** Total lap length in world units. */
  readonly length: number;
  /** Half the road width, in world units — the scale W is measured in. */
  readonly halfWidth: number;
  /** Total lap length in half-widths, which is what a station wraps at. */
  readonly lengthW: number;
  /**
   * The cooked corner model, when the frames carried one.
   *
   * OPTIONAL BECAUSE A LAP NEED NOT HAVE BEEN COOKED. The corner suites
   * build laps by hand out of stated positions and stated tangents — a
   * circle whose radius is known by construction, a stadium with exactly
   * two bends — precisely so the model can be checked against arithmetic
   * rather than against itself, and there is no graph in that. `corners.ts`
   * reads these columns when they are here and states the same rule in
   * TypeScript when they are not; see its header for why that second
   * statement is worth its keep rather than being a duplicate to delete.
   */
  readonly corner?: CornerColumns;
}

/** Read a numeric point column as plain numbers, live elements only. */
function col(g: Geometry, name: string): Float64Array {
  const a = g.attrs.point.require(name);
  const n = g.pointCount * a.tupleSize;
  const out = new Float64Array(n);
  // Sliced deliberately: `data` is the backing store and carries spare
  // CAPACITY past the live elements, so reading it whole reads slack.
  for (let i = 0; i < n; i++) out[i] = a.data[i];
  return out;
}

/** Build the drivable table from the cooked frames geometry. */
export function readLap(frames: Geometry): Lap {
  const count = frames.pointCount;
  const p = col(frames, "P");
  // The PUBLISHED axes, not axes re-derived here. The graph and the host
  // reading the same three columns is the whole point of TRACK_FRAME —
  // a second derivation is a second chance to mirror one of them.
  const tangent = col(frames, TRACK_FRAME.along);
  const across = col(frames, TRACK_FRAME.across);
  const up = col(frames, TRACK_FRAME.up);
  const halfWidth = frames.attrs.point.require(TRACK_FRAME.halfWidth).data[0];
  const s = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const dx = p[j * 3] - p[i * 3];
    const dy = p[j * 3 + 1] - p[i * 3 + 1];
    const dz = p[j * 3 + 2] - p[i * 3 + 2];
    s[i + 1] = s[i] + Math.hypot(dx, dy, dz);
  }
  const length = s[count];
  return {
    count,
    p,
    tangent,
    across,
    up,
    s,
    length,
    halfWidth,
    lengthW: length / halfWidth,
    corner: readCorner(frames),
  };
}

/**
 * The corner columns, if the graph that cooked these frames wrote them.
 *
 * TOLERANT OF THEIR ABSENCE ON PURPOSE. `readLap` is the reader for any
 * framed centreline, and the corner model is an opt-in branch off the
 * frame — a graph that only wants a camera to ride has no reason
 * to pay for them. Requiring the columns here would make every such graph
 * fail at the read rather than at the rule that actually wanted a corner.
 */
function readCorner(frames: Geometry): CornerColumns | undefined {
  if (!frames.attrs.point.get(CORNER_MODEL.radius)) return undefined;
  return {
    radiusW: col(frames, CORNER_MODEL.radius),
    turnK: col(frames, CORNER_MODEL.turn),
    behind: col(frames, CORNER_MODEL.behind),
    ahead: col(frames, CORNER_MODEL.ahead),
  };
}

/**
 * The pose at a distance travelled, wrapping at the lap length.
 *
 * A BINARY SEARCH rather than a scan from zero, because this is called
 * several times per frame — the camera, its look-ahead target and the map
 * marker are three different stations — and a scan makes the cost of a
 * frame depend on where in the lap the car is.
 */
export function poseAt(lap: Lap, station: number): Pose {
  const len = lap.length;
  let d = station % len;
  if (d < 0) d += len;

  let lo = 0;
  let hi = lap.count;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (lap.s[mid] <= d) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const j = (i + 1) % lap.count;
  const span = lap.s[i + 1] - lap.s[i];
  const t = span > 0 ? (d - lap.s[i]) / span : 0;

  const p = lerp3(lap.p, i, j, t);
  // The frame's OWN axes, interpolated — not world up made perpendicular
  // to the tangent, which is how the host used to get an up and is a
  // second definition of the same thing. Reading the published columns
  // means a banked track banks the camera without anyone changing this.
  const dir = unit(lerp3(lap.tangent, i, j, t));
  const up = unit(lerp3(lap.up, i, j, t));
  const across = unit(lerp3(lap.across, i, j, t));
  return { p, dir, up, across };
}

/** Linear blend of an xyz column between two frames. */
function lerp3(a: Float64Array, i: number, j: number, t: number): [number, number, number] {
  return [
    a[i * 3] + (a[j * 3] - a[i * 3]) * t,
    a[i * 3 + 1] + (a[j * 3 + 1] - a[i * 3 + 1]) * t,
    a[i * 3 + 2] + (a[j * 3 + 2] - a[i * 3 + 2]) * t,
  ];
}

/**
 * Renormalize after a blend.
 *
 * Two unit vectors averaged are not a unit vector, and the shortfall is a
 * function of the angle between them — so it is worst exactly where the
 * track turns hardest, which is where a placement being slightly off its
 * offset would show.
 */
function unit(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Track coordinates to a world position — the lookup a placement log
 * needs, and the inverse of the coordinates the vocabulary states.
 *
 * `station` is in HALF-WIDTHS and wraps, matching the contract; the
 * conversion to the arc length `poseAt` wants happens here so no caller
 * has to remember which of the two units it is holding.
 */
export function placeAt(lap: Lap, at: TrackCoord): { p: [number, number, number]; pose: Pose } {
  const pose = poseAt(lap, at.station * lap.halfWidth);
  const lateral = at.lateral * lap.halfWidth;
  const height = at.height * lap.halfWidth;
  return {
    p: [
      pose.p[0] + pose.across[0] * lateral + pose.up[0] * height,
      pose.p[1] + pose.across[1] * lateral + pose.up[1] * height,
      pose.p[2] + pose.across[2] * lateral + pose.up[2] * height,
    ],
    pose,
  };
}
