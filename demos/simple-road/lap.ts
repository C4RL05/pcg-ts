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

/** A pose on the lap: where, which way, and which way is up. */
export interface Pose {
  readonly p: [number, number, number];
  readonly dir: [number, number, number];
  readonly up: [number, number, number];
}

/** The lap, in the form the cameras read it. */
export interface Lap {
  readonly count: number;
  /** Positions, xyz per frame. */
  readonly p: Float64Array;
  /** Unit tangents, xyz per frame. */
  readonly tangent: Float64Array;
  /** Running distance to each frame, plus the total at [count]. */
  readonly s: Float64Array;
  /** Total lap length in world units. */
  readonly length: number;
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
  const tangent = col(frames, "tangent");
  const s = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const dx = p[j * 3] - p[i * 3];
    const dy = p[j * 3 + 1] - p[i * 3 + 1];
    const dz = p[j * 3 + 2] - p[i * 3 + 2];
    s[i + 1] = s[i] + Math.hypot(dx, dy, dz);
  }
  return { count, p, tangent, s, length: s[count] };
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

  const p: [number, number, number] = [0, 0, 0];
  const dir: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    p[a] = lap.p[i * 3 + a] + (lap.p[j * 3 + a] - lap.p[i * 3 + a]) * t;
    dir[a] = lap.tangent[i * 3 + a] + (lap.tangent[j * 3 + a] - lap.tangent[i * 3 + a]) * t;
  }
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  dir[0] /= dl;
  dir[1] /= dl;
  dir[2] /= dl;

  // The up the CAR uses, not the curve's: world up made perpendicular to
  // the direction. See `ACROSS` in graph.ts — a transported frame rolls,
  // and a rolling camera on a flat track is the artifact you notice
  // first.
  const dotY = dir[1];
  const up: [number, number, number] = [-dir[0] * dotY, 1 - dir[1] * dotY, -dir[2] * dotY];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up[0] /= ul;
  up[1] /= ul;
  up[2] /= ul;

  return { p, dir, up };
}
