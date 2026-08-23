/**
 * L-6's measurement: how much of the lap runs under cover, and in what
 * lengths. NOT the placement — this only ever reads a lap and a set of
 * boxes and answers questions about them.
 *
 * THE DEFINITION IS UPSTREAM'S AND IS NOT NEGOTIABLE. A frame is enclosed
 * when art spans the corridor above it: six vertical rays, spread evenly
 * across `-1.5W .. +1.5W`, cast from `h = 1.2W` up to a ceiling at
 * `h = 6W`, and at least half of them have to hit something.
 *
 * WHY IT IS SHAPED LIKE THAT, so nobody "improves" it into a different
 * quantity. Three cheaper proxies were tried first and all three were
 * withdrawn: binning an object at its bounds centre gave 7.9%, projecting
 * its bounds corners to the centreline gave 32.3%, and taking its lateral
 * reach in the track frame gave 50.3% — for the same circuit. None of them
 * estimated the same number as the others; each traded one artefact for
 * another. The 32.3% figure was published and has now been withdrawn: it
 * came from a single object near a hairpin claiming 78W of lap for 6W of
 * geometry, because a bounds projection onto a folded centreline cannot
 * tell "above the road here" from "near the road twice". The ray cast is
 * the first method that CONVERGES — 10.5% at a 6W ceiling, 10.7% at 12W —
 * which is the property the other three lacked.
 *
 * THE CEILING IS LOAD-BEARING. With no ceiling the answer is 100%, because
 * the skybox is a box. `zones.ts` picks the same 6W for `OVERHEAD` and the
 * same 1.2W for the corridor's ceiling, and they agree on purpose — but
 * the numbers are restated here rather than imported, because those two
 * are placement rules that may be retuned and this is a measurement whose
 * whole value is that a figure taken today can be compared with one taken
 * upstream. A measurement that moves when a rule is tuned measures the
 * tuning.
 *
 * PER FRAME, NOT PER BIN. The median real covered stretch is 1.1W, so
 * binning the lap at 1W would quantise the distribution being measured
 * into nothing. A stretch's length here is arc length off the lap's own
 * `s` table.
 */
import type { PlacedBox } from "./kit.js";
import { type Lap, placeAt } from "./lap.js";
import { segmentHitsBox } from "./sightline.js";

type Vec3 = [number, number, number];

/** L-6's numbers. Upstream's, restated rather than imported. */
export const ENCLOSURE = {
  /** Rays span `-corridorW .. +corridorW`, in half-widths. */
  corridorW: 1.5,
  /** How many, endpoints included. */
  rays: 6,
  /** Below this a box is scenery beside the road, not cover over it. */
  floorW: 1.2,
  /** Above this it is sky. Without a ceiling the skybox is a tunnel. */
  ceilingW: 6,
  /** At least half. */
  minHits: 3,
  /**
   * What counts as a long stretch, for the heavy tail. Not part of the
   * enclosed/not decision — only of how the report describes the runs.
   */
  heavyW: 10,
} as const;

/**
 * Where the rays stand, in half-widths.
 *
 * INCLUSIVE OF BOTH EDGES: `-1.5, -0.9, -0.3, +0.3, +0.9, +1.5`. Six rays
 * over three half-widths spaced any other way would either miss the
 * corridor edges — where a shell's legs are — or double up on the middle,
 * where a single spanning panel already answers for everything.
 */
export const RAY_LATERALS_W: readonly number[] = Array.from(
  { length: ENCLOSURE.rays },
  (_, k) => -ENCLOSURE.corridorW + (2 * ENCLOSURE.corridorW * k) / (ENCLOSURE.rays - 1),
);

/**
 * A ray's world endpoints at one frame.
 *
 * Through `placeAt`, which is the mapping from track coordinates to world
 * that the placements themselves were built through (`frameLookup` in
 * `dress.ts` is the same call). A second mapping here is a second chance
 * to disagree with the geometry being measured, and the disagreement would
 * look like a plausible number rather than like a bug.
 */
function rayAt(lap: Lap, i: number, k: number): { from: Vec3; to: Vec3 } {
  const station = lap.s[i] / lap.halfWidth;
  const lateral = RAY_LATERALS_W[k];
  return {
    from: placeAt(lap, { station, lateral, height: ENCLOSURE.floorW }).p,
    to: placeAt(lap, { station, lateral, height: ENCLOSURE.ceilingW }).p,
  };
}

/**
 * How far from a frame's origin any point of any of its rays can be, in
 * WORLD units.
 *
 * The offset is `lateral * across + height * up` with orthonormal axes, so
 * its length is `W * hypot(lateral, height)`, maximised at the corridor
 * edge and the ceiling.
 */
function rayReach(lap: Lap): number {
  return lap.halfWidth * Math.hypot(ENCLOSURE.corridorW, ENCLOSURE.ceilingW);
}

/**
 * A box's half-extents, in world units.
 *
 * THE UNITS TRAP `sightline.ts` WARNS ABOUT, from the other side.
 * `Occluder` carries extents in half-widths and has to be scaled by the
 * half-width before it meets `segmentHitsBox`; `PlacedBox.size` is ALREADY
 * world (`placeKit` multiplies by W when it resolves a box), so scaling it
 * again would inflate every box by the half-width and report a tunnel over
 * the whole lap. Both mistakes produce a test that passes.
 */
function halfExtents(b: PlacedBox): Vec3 {
  return [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
}

/**
 * Which boxes could possibly be above which frame.
 *
 * THE CORRECTNESS ARGUMENT, which is the only reason this is allowed to
 * exist at all. Let `p` be a frame's origin, `c` a box's centre and
 * `R = |size| / 2` the radius of the sphere around `c` that contains the
 * box. If a ray at that frame hits that box, some point `x` lies in both,
 * so `|p - c| <= |p - x| + |x - c| <= D + R`, with `D = rayReach`. The
 * prefilter keeps exactly the pairs satisfying that inequality, so no
 * hitting pair can be discarded. The grid is the same bound one step
 * coarser: cells are `2D` wide and every binned box has `R <= D`, so a
 * hitting box's cell differs from the frame's by at most one in each of x
 * and z — three cells each way covers it. Boxes too big for that bound
 * (`R > D`: a grandstand shell, the skybox) are not binned at all and are
 * tested at every frame.
 *
 * IT IS A WORLD-SPACE BOUND, NOT A STATION ONE, and that is deliberate.
 * Bucketing by station and widening by the box's own extent is unsound
 * exactly where the track folds back on itself: at a hairpin two stations
 * tens of W apart are metres apart in world space, so a station window
 * either misses cover or claims lap the geometry never spanned — which is
 * the artefact that inflated the withdrawn 32.3% figure.
 */
interface BoxIndex {
  /** Per box: the radius of its bounding sphere, world units. */
  readonly reach: Float64Array;
  /** Grid pitch in world units, `2 * rayReach`. */
  readonly cell: number;
  /** Cell key -> box indices, keyed on world x and z only. */
  readonly bins: Map<string, number[]>;
  /** Boxes too large to bin, tested at every frame. */
  readonly large: number[];
}

const cellKey = (ix: number, iz: number): string => `${ix}|${iz}`;

function buildIndex(lap: Lap, boxes: readonly PlacedBox[]): BoxIndex {
  const reach = new Float64Array(boxes.length);
  const D = rayReach(lap);
  // A degenerate half-width would make the pitch zero and every floor()
  // infinite; the grid is only an accelerator, so fall back to a pitch
  // that puts everything in one cell rather than failing.
  const cell = Math.max(2 * D, 1e-6);
  const bins = new Map<string, number[]>();
  const large: number[] = [];

  for (let b = 0; b < boxes.length; b++) {
    const s = boxes[b].size;
    reach[b] = 0.5 * Math.hypot(s[0], s[1], s[2]);
    if (!(reach[b] <= D)) {
      large.push(b);
      continue;
    }
    const c = boxes[b].centre;
    const key = cellKey(Math.floor(c[0] / cell), Math.floor(c[2] / cell));
    const bin = bins.get(key);
    if (bin) bin.push(b);
    else bins.set(key, [b]);
  }
  return { reach, cell, bins, large };
}

/** Candidate box indices for a frame, into `out` (cleared first). */
function candidatesAt(index: BoxIndex, px: number, pz: number, out: number[]): void {
  out.length = 0;
  for (const b of index.large) out.push(b);
  const ix = Math.floor(px / index.cell);
  const iz = Math.floor(pz / index.cell);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bin = index.bins.get(cellKey(ix + dx, iz + dz));
      if (!bin) continue;
      // Pushed one at a time rather than spread: a bin holding a whole
      // circuit's worth of boxes would blow the argument limit.
      for (const b of bin) out.push(b);
    }
  }
}

/**
 * How many of the frame's rays hit at least one box.
 *
 * Counted per RAY, not per box: two boxes over the same ray are one hit,
 * which is what "art spans the corridor" means. A ray that has already hit
 * is skipped, and the loop stops once every ray has.
 */
function coveringRays(
  lap: Lap,
  i: number,
  boxes: readonly PlacedBox[],
  index: BoxIndex,
  cand: readonly number[],
): number {
  if (cand.length === 0) return 0;
  const rays = Array.from({ length: ENCLOSURE.rays }, (_, k) => rayAt(lap, i, k));
  const px = lap.p[i * 3];
  const py = lap.p[i * 3 + 1];
  const pz = lap.p[i * 3 + 2];
  const D = rayReach(lap);

  const hit = new Array<boolean>(rays.length).fill(false);
  let n = 0;
  for (const b of cand) {
    const box = boxes[b];
    const dx = box.centre[0] - px;
    const dy = box.centre[1] - py;
    const dz = box.centre[2] - pz;
    const lim = D + index.reach[b];
    if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
    const half = halfExtents(box);
    for (let r = 0; r < rays.length; r++) {
      if (hit[r]) continue;
      if (segmentHitsBox(rays[r].from, rays[r].to, box.centre, box.basis, half)) {
        hit[r] = true;
        n++;
      }
    }
    if (n === rays.length) break;
  }
  return n;
}

/**
 * Is this frame under cover?
 *
 * Single-frame, so it builds the box index it needs and throws it away:
 * that is `O(boxes)` per call. Use `enclosureMask` for a whole lap.
 */
export function enclosedAtFrame(lap: Lap, i: number, boxes: readonly PlacedBox[]): boolean {
  if (boxes.length === 0) return false;
  const index = buildIndex(lap, boxes);
  const cand: number[] = [];
  candidatesAt(index, lap.p[i * 3], lap.p[i * 3 + 2], cand);
  return coveringRays(lap, i, boxes, index, cand) >= ENCLOSURE.minHits;
}

/** Per-frame cover flags for the whole lap, one per frame of `lap`. */
export function enclosureMask(lap: Lap, boxes: readonly PlacedBox[]): boolean[] {
  const mask = new Array<boolean>(lap.count).fill(false);
  if (boxes.length === 0) return mask;
  const index = buildIndex(lap, boxes);
  const cand: number[] = [];
  for (let i = 0; i < lap.count; i++) {
    candidatesAt(index, lap.p[i * 3], lap.p[i * 3 + 2], cand);
    mask[i] = coveringRays(lap, i, boxes, index, cand) >= ENCLOSURE.minHits;
  }
  return mask;
}

/**
 * One continuous covered run, in half-widths.
 *
 * `endW` is where the cover ENDS — the station of the first frame past the
 * run — so that `lengthW` is always `endW - startW` around the loop. It is
 * wrapped into `[0, lapW)`, so `endW < startW` means the run crosses the
 * start line. A lap covered end to end reports `startW = endW = 0` with
 * `lengthW = lapW`, which the length distinguishes from an empty run.
 */
export interface EnclosureStretch {
  readonly startW: number;
  readonly endW: number;
  readonly lengthW: number;
}

export interface EnclosureReport {
  /** Covered arc length over lap length. */
  readonly share: number;
  readonly stretches: EnclosureStretch[];
  readonly longestW: number;
  /** Share of the COVERED length held by stretches longer than `heavyW`. */
  readonly heavyTailShare: number;
}

/** How much lap a frame owns: to the next frame, off the lap's own table. */
function ownW(lap: Lap, i: number): number {
  return (lap.s[i + 1] - lap.s[i]) / lap.halfWidth;
}

/**
 * The covered runs, in racing order from the first run start.
 *
 * A RUN THAT WRAPS THE START LINE IS ONE STRETCH, not two — the same
 * problem `cornersOf` solves for corner runs, solved the same way. The
 * scan begins at a frame that BEGINS a run, so no run can be cut in half
 * by where the array happens to start; splitting at the cut would invent a
 * second stretch, give it a false start at station zero, and halve the
 * measured length of the real one. The start line is an arbitrary cut in a
 * loop and no measurement may depend on where it fell.
 *
 * If nothing is covered there are no runs. If EVERYTHING is covered there
 * is no run start either, and the two cases are not the same answer — so
 * the fully covered lap is recognised explicitly and reported as one
 * stretch the length of the lap.
 */
function stretchesOf(lap: Lap, mask: readonly boolean[]): EnclosureStretch[] {
  const n = lap.count;
  let covered = 0;
  for (let i = 0; i < n; i++) if (mask[i]) covered++;
  if (covered === 0) return [];
  if (covered === n) return [{ startW: 0, endW: 0, lengthW: lap.lengthW }];

  let start = -1;
  for (let i = 0; i < n; i++) {
    if (mask[i] && !mask[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  // Unreachable: a partly covered loop always has a frame whose
  // predecessor is uncovered. Answering rather than throwing keeps a
  // measurement from taking a page down.
  if (start < 0) return [];

  const out: EnclosureStretch[] = [];
  let i = 0;
  while (i < n) {
    const at = (start + i) % n;
    if (!mask[at]) {
      i++;
      continue;
    }
    let len = 0;
    let arc = 0;
    while (len < n && mask[(start + i + len) % n]) {
      arc += ownW(lap, (start + i + len) % n);
      len++;
    }
    const startW = lap.s[(start + i) % n] / lap.halfWidth;
    let endW = (startW + arc) % lap.lengthW;
    if (endW < 0) endW += lap.lengthW;
    out.push({ startW, endW, lengthW: arc });
    i += len;
  }
  return out;
}

/** Summarise runs into the published figures. */
function summarise(lap: Lap, stretches: EnclosureStretch[]): EnclosureReport {
  let covered = 0;
  let longestW = 0;
  let heavy = 0;
  for (const s of stretches) {
    covered += s.lengthW;
    longestW = Math.max(longestW, s.lengthW);
    if (s.lengthW > ENCLOSURE.heavyW) heavy += s.lengthW;
  }
  return {
    share: covered / lap.lengthW,
    stretches,
    longestW,
    // Of the COVERED length, not of the lap: the question is whether the
    // cover is a few tunnels or a scatter of overhangs, and dividing by
    // the lap would only restate `share` twice.
    heavyTailShare: covered > 0 ? heavy / covered : 0,
  };
}

/** What the lap's cover adds up to. */
export function measureEnclosure(lap: Lap, boxes: readonly PlacedBox[]): EnclosureReport {
  return summarise(lap, stretchesOf(lap, enclosureMask(lap, boxes)));
}
