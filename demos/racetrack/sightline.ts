/**
 * L-1: the look-ahead cone, and the cull that enforces it.
 *
 * From any station the next 12W of centreline must be visible from a
 * cockpit eye at h = 0.3W. Placements that occlude it are moved outward
 * or dropped.
 *
 * A THRESHOLD, NOT A DISTRIBUTION. Every rule in §7 is a guarantee to a
 * driver rather than a statistic to reproduce, so none of them can be
 * sampled — the placement happens first and then this checks and repairs
 * it. That is also why the cull runs BEFORE the fill and mix passes:
 * dropping a blocker is exactly what opens a gap the fill then closes,
 * and running them the other way makes the cull and the band mix look
 * incompatible when they are only mis-sequenced.
 *
 * AND IT IS A DECISION TO BE BETTER THAN THE SOURCE. There is no
 * occlusion data behind it — the originals were built by eye and some of
 * their corners are genuinely blind. Same standing as Z-1's corridor,
 * and it has to be labelled that way rather than presented as measured.
 *
 * THE TEST IS A CHORD, NOT A RIBBON ALONG THE CENTRELINE. On a straight
 * the two are the same and a track-space test would do. Through a bend
 * they are not: the sight line cuts across the inside of the corner, so
 * a placement well off the centreline can block it while one sitting at
 * t = 0 further round does not. Since the whole rule is about corners
 * being readable, testing in the space where corners disappear would
 * check the one case that never fails.
 */

/** A pose on the lap — the shape `lap.ts` returns. */
export interface Frame {
  readonly p: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly across: readonly [number, number, number];
}

/** What the cull needs to know about a placement. */
export interface Occluder {
  /** Arc length in W. */
  readonly station: number;
  /** Signed lateral in W, positive right of travel. */
  readonly t: number;
  /** Height of the box CENTRE above the surface, in W. */
  readonly h: number;
  /** Extents in W, along the track frame's three axes. */
  readonly across: number;
  readonly along: number;
  readonly tall: number;
}

/** L-1's numbers. */
export const SIGHTLINE = {
  /** How far ahead must be visible, in W. */
  aheadW: 12,
  /** Cockpit eye height above the surface, in W. */
  eyeW: 0.3,
  /**
   * Samples along the cone. The rule says the next 12W of CENTRELINE, so
   * the test is a fan of chords to points along it rather than one chord
   * to the far end — a placement can leave the far point visible while
   * standing in front of everything between.
   */
  samples: 8,
  /**
   * How far out to push an occluder before giving up and dropping it, in
   * W, and the step. Moving outward is preferred to dropping: it keeps
   * D-1's budget exact and keeps the asset, which is what the rule asks
   * for in that order.
   */
  maxPushW: 6,
  pushStepW: 0.5,
} as const;

const sub3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot3 = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * How little of a segment may lie along a slab axis before the slab is
 * treated as parallel to it — as a FRACTION of the segment's own length,
 * because that is the only thing "little" can be measured against here.
 * Sized for f32, whose relative spacing is 1.2e-7: see the argument in
 * `segmentHitsBox`.
 */
const PARALLEL_FRACTION = 1e-6;

/**
 * Does the segment `from`-`to` pass through the box?
 *
 * The slab method, in the BOX'S OWN FRAME. A placement is axis-aligned in
 * the track frame at its own station, which is not the world frame and
 * not the frame at the eye's station either — so the segment is projected
 * onto the box's three axes and the test runs there.
 */
export function segmentHitsBox(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  centre: readonly [number, number, number],
  axes: { across: readonly number[]; along: readonly number[]; up: readonly number[] },
  half: readonly [number, number, number],
): boolean {
  const o = sub3(from, centre);
  const d = sub3(to, from);
  const lo = [dot3(o, axes.across), dot3(o, axes.along), dot3(o, axes.up)];
  const ld = [dot3(d, axes.across), dot3(d, axes.along), dot3(d, axes.up)];

  // PARALLEL IS A RATIO, NOT A LENGTH. The guard below asks whether the
  // segment has any extent along this axis before it divides by that
  // extent, and "any" only means anything relative to the segment itself:
  // the same 1e-9 of projection is a dead-parallel ray on a look-ahead
  // segment tens of units long and a perfectly ordinary crossing on a
  // segment that short.
  //
  // It was an absolute 1e-12, which is below what f32 can even hold at
  // world scale — one part in 10^12 of a segment of length 30 is a
  // hundred thousand times finer than the f32 spacing there, so the
  // branch would never be taken and a grazing ray would divide by
  // something indistinguishable from zero. `t1` and `t2` come back at
  // 1e12 and the slab arithmetic that follows is meaningless.
  //
  // A relative threshold of `PARALLEL_FRACTION` is about eight f32
  // spacings, and it changes nothing in f64: for a near-parallel ray the
  // two branches already AGREE in the limit — outside the slab, the two
  // enormous roots share a sign and fail `tMin > tMax`, which is the
  // parallel branch's `return false`; inside it they straddle and leave
  // `tMin` and `tMax` alone, which is its `continue`. This just computes
  // that answer instead of arriving at it through 1e12. `<=` rather than
  // `<` so that a degenerate zero-length segment — a point — still takes
  // the parallel branch on all three axes and is tested for containment,
  // which is what the absolute guard did for it.
  const parallel = PARALLEL_FRACTION * Math.hypot(d[0], d[1], d[2]);

  let tMin = 0;
  let tMax = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) <= parallel) {
      // Parallel to this slab: a miss here is a miss overall.
      if (lo[a] < -half[a] || lo[a] > half[a]) return false;
      continue;
    }
    let t1 = (-half[a] - lo[a]) / ld[a];
    let t2 = (half[a] - lo[a]) / ld[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Does this placement block the cone from `station`?
 *
 * `frameAt` is the lap's own pose lookup, in W — the same one the
 * placements were built through, so the cull and the placement cannot
 * disagree about where anything is.
 */
export function occludes(
  o: Occluder,
  station: number,
  frameAt: (stationW: number, lateralW: number, heightW: number) => Frame,
  halfWidth: number,
): boolean {
  const at = frameAt(o.station, o.t, o.h);
  const centre = at.p;
  // THE EXTENTS ARE IN W AND THE FRAME IS IN WORLD UNITS. The axes are
  // unit vectors either way, so projecting a world-space offset onto them
  // gives world units — which have to be compared against world half
  // extents, not against the W ones the kit publishes. Getting this wrong
  // scales every box by the half-width and makes nothing ever occlude on
  // a wide track, or everything on a narrow one.
  const half: [number, number, number] = [
    (o.across / 2) * halfWidth,
    (o.along / 2) * halfWidth,
    (o.tall / 2) * halfWidth,
  ];
  const eye = frameAt(station, 0, SIGHTLINE.eyeW).p;
  // `dir` IS the along axis: the frame calls it that because a camera
  // reads it as a direction, and the box calls it `along` because the kit
  // does. One vector, two names, mapped once here — HOISTED, because the
  // occluder's own axes do not vary with the sample being tested.
  const axes = { across: at.across, along: at.dir, up: at.up };
  for (let i = 1; i <= SIGHTLINE.samples; i++) {
    const target = frameAt(station + (SIGHTLINE.aheadW * i) / SIGHTLINE.samples, 0, 0).p;
    if (segmentHitsBox(eye, target, centre, axes, half)) return true;
  }
  return false;
}

/**
 * Would the cull find this box standing in the cone?
 *
 * THE CULL'S OWN TEST, LIFTED SO A PLACER CAN ASK IT BEFORE PLACING. It
 * was the `blocks` closure inside {@link cullSightlines} and nothing else
 * could reach it, so a rule that wanted to avoid the cone rather than be
 * repaired by it had to restate the question — the narrowing, the wrap,
 * the `some` over the fan — and a second statement of "blocked" that
 * disagrees with the cull's is the one defect this demo keeps finding.
 * The cull now calls this for its own verdict and for every rung of its
 * push ladder, so there is one definition and a caller asking in advance
 * gets exactly the answer it would have got afterwards.
 *
 * `eyes` IS PASSED IN RATHER THAN DEFAULTED, because the caller that
 * matters here is a repair loop that already built the set once and a
 * placer that must use the SAME set: `defaultEyeStations` allocates the
 * whole lap's worth per call, and asking it per candidate lateral per
 * mark would rebuild it a few hundred times a lap for no change in the
 * answer.
 */
export function blocksCone(
  o: Occluder,
  lapW: number,
  frameAt: (stationW: number, lateralW: number, heightW: number) => Frame,
  halfWidth: number,
  eyes: readonly number[],
): boolean {
  for (const s of eyes) {
    // Only the eyes that could see this placement at all: the cone
    // reaches 12W, so an eye more than that behind it cannot be blocked
    // by it, and one ahead of it never was.
    let d = o.station - s;
    while (d < -lapW / 2) d += lapW;
    while (d > lapW / 2) d -= lapW;
    if (d < -o.along / 2 || d > SIGHTLINE.aheadW + o.along / 2) continue;
    if (occludes(o, s, frameAt, halfWidth)) return true;
  }
  return false;
}

/** What the cull did. Reported, and logged for the minimality check. */
export interface CullResult<T extends Occluder> {
  readonly kept: T[];
  /** Occluders pushed outward until they cleared the cone. */
  readonly moved: number;
  /** Occluders that could not be cleared by pushing, and were dropped. */
  readonly dropped: number;
  /** How many were occluding before anything was done. */
  readonly blocking: number;
}

/**
 * Enforce L-1: move blockers outward, drop the ones that cannot clear.
 *
 * MOVED BEFORE DROPPED, which is the rule's own order and not an
 * optimisation. Dropping costs D-1's budget and costs the asset; pushing
 * costs only the lateral, which the asset's `where` distribution has a
 * tail for anyway.
 *
 * The station of each eye point is every placement's own station plus a
 * sweep between them, so a blocker between two placements is not missed:
 * the cone is checked FROM stations, and a gap in the checked set is a
 * stretch of lap nobody looked ahead from.
 */
export function cullSightlines<T extends Occluder>(
  placements: readonly T[],
  lapW: number,
  frameAt: (stationW: number, lateralW: number, heightW: number) => Frame,
  halfWidth: number,
  eyeStations?: readonly number[],
  /**
   * Occluders that must be DROPPED rather than pushed outward.
   *
   * For L-3's braking marks. A ruler with one mark shoved out of line
   * reads as a mistake; a ruler with two marks reads as a shorter ruler,
   * which is still a ruler. The rule the cull enforces does not change —
   * L-1 still wins — only what winning looks like for a piece whose whole
   * value is being in line with its neighbours.
   */
  dropRatherThanMove?: (o: T) => boolean,
): CullResult<T> {
  const eyes = eyeStations ?? defaultEyeStations(lapW);
  const kept: T[] = [];
  let moved = 0;
  let dropped = 0;
  let blocking = 0;

  for (const o of placements) {
    // THE NARROWING MOVED INTO {@link blocksCone} AND IS NO LONGER HOISTED
    // PER PLACEMENT. It used to be a `filter` computed once and closed
    // over by every rung of the ladder below, on the argument that "the
    // same eye set has to serve every candidate" — which is still true and
    // is why nothing changes: a pushed candidate differs from `o` only in
    // `t`, and the window is a function of `station` and `along` alone, so
    // recomputing it per rung recomputes the SAME set. What that costs is
    // a walk of the eye list per rung instead of one allocation per
    // placement; what it buys is that a placer asking "would this be
    // blocked" ahead of time cannot reach a different answer, because
    // there is now only one place the question is written down.
    const blocks = (cand: T): boolean =>
      blocksCone(cand, lapW, frameAt, halfWidth, eyes);

    if (!blocks(o)) {
      kept.push(o);
      continue;
    }
    blocking++;

    if (dropRatherThanMove?.(o)) {
      dropped++;
      continue;
    }

    let fixed: T | undefined;
    const sign = o.t >= 0 ? 1 : -1;
    for (let push = SIGHTLINE.pushStepW; push <= SIGHTLINE.maxPushW; push += SIGHTLINE.pushStepW) {
      const cand = { ...o, t: o.t + sign * push } as T;
      if (!blocks(cand)) {
        fixed = cand;
        break;
      }
    }
    if (fixed) {
      kept.push(fixed);
      moved++;
    } else {
      dropped++;
    }
  }
  return { kept, moved, dropped, blocking };
}

/**
 * Where to stand while looking ahead.
 *
 * EVERY 2W, not at every placement. The rule says "from any station", and
 * checking only where something was placed would leave the stretches
 * between them unchecked — which is where a driver spends most of the lap
 * and where a blocker is most likely to be the only thing in view.
 */
export function defaultEyeStations(lapW: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < lapW; s += 2) out.push(s);
  return out;
}
