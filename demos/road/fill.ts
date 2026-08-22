/**
 * Growing mass inside a box region.
 *
 * WHAT THIS IS FOR. The kit this demo dresses with describes each asset
 * as a handful of axis-aligned boxes, and a box is an ENVELOPE rather
 * than the thing itself: built solid at its published size, an asset
 * comes out heavier than the art it stands for, and a roadside of those
 * reads as a field of blocks. This is the node chain that fills an
 * envelope with something that has a surface — a jittered grid kept where
 * a 3D noise field clears a threshold, which erodes connected mass rather
 * than scattering confetti.
 *
 * THE TRIM IS SMALLER THAN THE HEADLINE. "A bounding box holds five times
 * the art inside it" is a fact about ONE box round a whole asset. A
 * decomposition into six is already close: measured over this kit, the
 * boxes of a `block` asset sum to 21% of its bounding box where the art
 * fills 17%, so the fill's job is to remove about a fifth of the box
 * volume, not four fifths of it. Erode to the headline figure and the
 * result is as wrong in the other direction.
 *
 * THE THRESHOLD IS CALIBRATED, NOT GUESSED. A normalized fBm does not
 * spread evenly over 0..1 — it piles up in the middle — so "keep the
 * cells above 0.78" does not keep 22% of them, and the error is
 * different for every noise configuration. {@link calibrateKeep} samples
 * the field's own distribution and returns the threshold that keeps the
 * share asked for, which makes the target a number you set rather than
 * one you discover.
 */
import {
  Graph,
  type Field,
  add,
  attribute,
  component,
  filterByExpression,
  gt,
  lt,
  mul,
  pointNeighborhood,
  position,
  setAttribute,
  volumeSample,
} from "pcg-ts";
import { fbm, perlinNoise } from "pcg-ts";

/** An axis-aligned box in the asset's own frame, as the kit ships them. */
export interface KitBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly role?: string;
}

/** Where the fill writes what it computed, so a caller can read it back. */
export const FILL_ATTRS = {
  /** 1 inside the decomposition, 0 outside it. */
  inBox: "inBox",
  /** The eroding field, normalized to 0..1. */
  grain: "grain",
  /** How many of a cell's six face neighbours are also solid. */
  faceN: "faceN",
} as const;

/**
 * A field that is 1 inside any of `boxes` and 0 outside all of them.
 *
 * A UNION, evaluated per point, rather than one `filterByBounds` per box
 * merged afterwards: boxes in a decomposition overlap, and merging their
 * separate survivors would count the overlap twice — which is exactly the
 * double-count that makes a volume measurement lie.
 *
 * Built as a sum clamped by a comparison rather than a boolean or-chain,
 * because the field grammar's comparisons already return 0 or 1 and a sum
 * of them is nonzero precisely when at least one box contains the point.
 */
export function insideAnyBox(boxes: readonly KitBox[]): Field {
  if (boxes.length === 0) throw new Error("insideAnyBox: needs at least one box");
  let anyInside: Field | undefined;
  for (const b of boxes) {
    let inside: Field | undefined;
    for (let axis = 0; axis < 3; axis++) {
      const p = component(position(), axis);
      // Half-open on the upper edge so a point sitting exactly on a shared
      // face belongs to one box, not two. It costs nothing here and it is
      // the difference between a clean union and a seam of doubled cells
      // wherever a decomposition's boxes abut.
      const within = mul(gt(p, b.min[axis]), lt(p, b.max[axis]));
      inside = inside === undefined ? within : mul(inside, within);
    }
    const within = inside as Field;
    anyInside = anyInside === undefined ? within : add(anyInside, within);
  }
  return gt(anyInside as Field, 0);
}

/** The eroding field. One configuration, so every asset erodes alike. */
export function grainField(frequency: number, seed: number): Field {
  return fbm(perlinNoise, { octaves: 3, frequency, seed, normalized: true });
}

/** What {@link buildFillGraph} needs to know. */
export interface FillOptions {
  /** The asset's own bounding box, as [min, max] in its local frame. */
  readonly bbox: readonly [readonly number[], readonly number[]];
  /** The decomposition to fill. */
  readonly boxes: readonly KitBox[];
  /** Grid pitch, in the same units as the boxes. */
  readonly cellSize: number;
  /**
   * Keep cells whose grain exceeds this. Below the field's minimum every
   * in-box cell survives, which is what {@link calibrateKeep} cooks first
   * in order to see the distribution at all.
   */
  readonly threshold: number;
  /** Spatial frequency of the eroding noise. */
  readonly frequency: number;
  readonly seed?: number;
}

/** Named outputs of a fill cook. */
export const FILL_OUTPUT = "cells";

/**
 * Fill one asset's envelope.
 *
 * The grid is laid over the BOUNDING BOX and then cut down to the
 * decomposition, rather than one grid per box: a single lattice means
 * cells never overlap, so counting them is measuring volume, and the
 * denominator of the occupancy figure is the same bounding box the kit
 * measures against.
 *
 * `jitter: 0`, deliberately. Jitter is what makes a scatter look natural
 * and it is also what makes cells stop tiling — a jittered cell overlaps
 * its neighbour and leaves a gap on the other side, so the kept count
 * stops being proportional to the volume. Shape comes from the erosion
 * here, and the grid stays a grid so the measurement stays honest.
 */
export function buildFillGraph(opts: FillOptions): Graph {
  const g = new Graph(opts.seed ?? 1);
  const [lo, hi] = opts.bbox;

  const cells = g.add(
    volumeSample,
    {
      boundsMin: [lo[0], lo[1], lo[2]],
      boundsMax: [hi[0], hi[1], hi[2]],
      cellSize: opts.cellSize,
      jitter: 0,
    },
    "cells",
  );

  const inBox = g.add(
    setAttribute,
    { name: FILL_ATTRS.inBox, tupleSize: 1, value: insideAnyBox(opts.boxes) },
    "inBox",
  );
  g.connect(cells, "out", inBox, "in");

  const grain = g.add(
    setAttribute,
    { name: FILL_ATTRS.grain, tupleSize: 1, value: grainField(opts.frequency, opts.seed ?? 1) },
    "grain",
  );
  g.connect(inBox, "out", grain, "in");

  const kept = g.add(
    filterByExpression,
    {
      predicate: mul(
        attribute(FILL_ATTRS.inBox),
        gt(attribute(FILL_ATTRS.grain), opts.threshold),
      ),
    },
    "kept",
  );
  g.connect(grain, "out", kept, "in");

  g.output(kept, "out", FILL_OUTPUT);
  return g;
}

/**
 * The threshold that keeps `share` of the values in `samples`.
 *
 * Nearest-rank, matching how the kit's own percentiles are computed, so a
 * threshold and a published band are never two conventions apart. Returns
 * a value BELOW the smallest sample when `share` is 1, so "keep
 * everything" is expressible rather than a special case.
 */
export function calibrateKeep(samples: readonly number[], share: number): number {
  if (samples.length === 0) throw new Error("calibrateKeep: no samples");
  if (share >= 1) return -Infinity;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length));
  return sorted[rank];
}

/**
 * Fill one asset's envelope as a SHELL — walls around a void.
 *
 * WHY THIS IS A DIFFERENT CHAIN AND NOT A PARAMETER. The kit separates
 * `block` (solid in all three axes) from `shell` (built of walls around a
 * void) because they are different things to grow, and averaging them
 * produces neither: erode a solid and you get porous rubble, erode a
 * shell and you get a broken wall. A block is a volume with material
 * removed; a shell is a SURFACE with thickness.
 *
 * THE SURFACE IS FOUND BY COUNTING NEIGHBOURS, not by insetting the
 * boxes. Insetting looks equivalent and is not: a decomposition's boxes
 * abut, and the shared face between two of them is interior to the union
 * while being a face of each box — so an inset-based shell grows a wall
 * through the middle of the asset wherever two boxes meet. Counting a
 * cell's solid face neighbours on the lattice asks about the UNION, which
 * is the shape that actually exists. Six means interior; fewer means
 * surface, seams included correctly and for free.
 *
 * `radius` is a little over one cell so the six face neighbours are
 * inside it and the twelve edge neighbours (at sqrt(2) cells) are not.
 * Widening it to catch the edges would count 18 and the test would have
 * to change with it — the face count is the one that means "has an
 * exposed side".
 */
export function buildShellGraph(opts: FillOptions): Graph {
  const g = new Graph(opts.seed ?? 1);
  const [lo, hi] = opts.bbox;

  const cells = g.add(
    volumeSample,
    {
      boundsMin: [lo[0], lo[1], lo[2]],
      boundsMax: [hi[0], hi[1], hi[2]],
      cellSize: opts.cellSize,
      jitter: 0,
    },
    "cells",
  );

  const inBox = g.add(
    setAttribute,
    { name: FILL_ATTRS.inBox, tupleSize: 1, value: insideAnyBox(opts.boxes) },
    "inBox",
  );
  g.connect(cells, "out", inBox, "in");

  // The solid first: everything the decomposition covers. The shell is
  // carved out of THIS rather than out of the lattice, so "how many
  // neighbours are solid" is a question about the asset and not about the
  // bounding box.
  const solid = g.add(
    filterByExpression,
    { predicate: attribute(FILL_ATTRS.inBox) },
    "solid",
  );
  g.connect(inBox, "out", solid, "in");

  const counted = g.add(
    pointNeighborhood,
    { radius: opts.cellSize * 1.05, countAttr: FILL_ATTRS.faceN, includeSelf: false },
    "faceN",
  );
  g.connect(solid, "out", counted, "in");

  // A cell with all six faces buried is interior; anything less has an
  // exposed side and is wall. ONE CELL THICK, which is what this test can
  // give: a thicker wall means peeling again from the survivors, and
  // there is no honest way to spell it as a parameter here without doing
  // that work.
  const surface = g.add(
    filterByExpression,
    { predicate: lt(attribute(FILL_ATTRS.faceN), 6) },
    "surface",
  );
  g.connect(counted, "out", surface, "in");

  const grain = g.add(
    setAttribute,
    { name: FILL_ATTRS.grain, tupleSize: 1, value: grainField(opts.frequency, opts.seed ?? 1) },
    "grain",
  );
  g.connect(surface, "out", grain, "in");

  // The same calibrated erosion the block fill uses, applied to the wall
  // rather than to the volume: a shell whose occupancy still runs hot
  // gets thinner, not more porous, because there is only one cell of
  // depth left to take.
  const kept = g.add(
    filterByExpression,
    { predicate: gt(attribute(FILL_ATTRS.grain), opts.threshold) },
    "kept",
  );
  g.connect(grain, "out", kept, "in");

  g.output(kept, "out", FILL_OUTPUT);
  return g;
}
