/**
 * The corners of a lap, found by a graph.
 *
 * WHAT THIS REPLACES. `cornersOf` (`corners.ts`) turns the corner model's
 * columns into a list of corners: it filters the frames whose forward run
 * count reads exactly 1 — the first frame of a corner and nothing else —
 * and reads the backward run at that same frame for how long the corner
 * lasts and which way it turns. Only one part of it was never a scan, and
 * that file says so in its own words: "the tightest radius in a run is a
 * MINIMUM, and a segmented running total is a sum". `pathRuns` grew a
 * `reduce` param for exactly that, so the whole derivation is nodes now.
 *
 * THIS PORT DOES NOT RE-BASE, AND THAT IS THE DIFFERENCE FROM THE OTHER
 * TWO. The station process and the asset choice both draw random numbers,
 * and `randomField` keys on point identity rather than on a stream
 * position, so neither could reproduce the lap its TypeScript produced.
 * A corner is geometry: the same frames, the same threshold, the same
 * arithmetic, and no draw anywhere. So this one is checkable against
 * `cornersOf` corner for corner, which is a far stronger test than the
 * distributional gates the other two had to settle for — and the suite
 * makes exactly that comparison.
 *
 * WHAT IS STILL NOT HERE. Where the MARKERS go is a separate stage; this
 * module answers only "where are the corners and what are they like".
 * `placeCornerLanguage`'s convert-or-add is an order-dependent greedy
 * walk over a mutable list — it recomputes which asset is most repeated
 * after every change, and can delete — which is the same class of rule as
 * D-4's coverage repair and wants the same `repeatUntil` treatment. It
 * stays in TypeScript for one more pass.
 */
import {
  type Field,
  type Geometry,
  Graph,
  type NodeHandle,
  add,
  attribute,
  attributeReduce,
  component,
  cook,
  dataInput,
  eq,
  filterByExpression,
  ge,
  gt,
  index,
  lt,
  makeGeometryItem,
  mul,
  pathRuns,
  promoteAttribute,
  select,
  setAttribute,
  sub,
  transferByIndex,
} from "pcg-ts";
import { CORNER_R_W, type Corner, SEVERITY } from "./corners.js";
import { CORNER_MODEL } from "./graph.js";
import type { Lap } from "./lap.js";
import { lapAsPath } from "./stationGraph.js";

/** The columns {@link addCornerStage} writes on the corner cloud. */
export const CORNER = {
  /** Frame index of the corner's first frame, before the filter ran. */
  frame: "cornerFrame",
  /** Station of that frame, in W. */
  entryW: "cornerEntryW",
  /** Station of the corner's LAST frame, in W. May be less than entry. */
  exitW: "cornerExitW",
  /** The run's tightest radius, in W. */
  tightestW: "cornerTightestW",
  /** +1 for a right-hander, -1 for a left-hander. */
  turn: "cornerTurnSign",
  /** Which side is the outside: the sign a placement's lateral takes. */
  outside: "cornerOutside",
  /** 1 where the corner is tighter than `SEVERITY.sharpW`. */
  sharp: "cornerSharp",
  /** 1 where the corner is tighter than `SEVERITY.tightW` — L-3's gate. */
  tight: "cornerTight",
  /** How many frames the run lasts, counting its own. */
  frames: "cornerFrames",
} as const;

/**
 * The radius a frame outside a corner contributes to a segmented minimum.
 *
 * A SENTINEL RATHER THAN INFINITY, and the reason is a rule this library
 * enforces one layer down: `resolveOn` refuses a column a field left
 * non-finite, so a mask that wrote `Infinity` would fail the cook rather
 * than mean "no corner here". The radius column ITSELF is legitimately
 * infinite on a straight — it is written by hand, not by a field, and
 * `corners.ts` argues at length for why infinity is the honest value
 * there — so the mask is only about what may be carried FORWARD.
 *
 * ONE STRAIGHT FRAME IS IN EVERY CORNER'S RUN, which is the thing worth
 * knowing here and which a first draft of this comment got backwards. A
 * BACKWARD run ends at a flagged point INCLUSIVE and reaches back to just
 * after the previous flag, so the run holding a corner's frames also
 * holds the first straight frame AFTER the corner — the one that closed
 * it. That frame is not in the corner: the run COUNT excludes it, because
 * `writeCornerModel` masks the counted column to zero outside a corner,
 * and this mask is the same rule applied to the radius.
 *
 * IT SURVIVES A MINIMUM WITHOUT THE MASK AND WOULD NOT SURVIVE A MAXIMUM.
 * A straight frame's true radius is at or above `CORNER_R_W` and every
 * corner frame's is below it, so an unmasked minimum still answers
 * correctly — the mask buys nothing for the fold this stage actually
 * uses. It is here because the alternative is a column that happens to be
 * right, and because the failure is silent in exactly the direction that
 * matters: swapping this to `max` puts the sentinel in every corner's
 * tightest radius, which the suite catches, whereas an unmasked `max`
 * would answer a plausible 12-point-something and be believed.
 */
const NOT_A_CORNER_W = 1e6;

/** Write one scalar column and return the node, to keep the chain flat. */
function put(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  name: string,
  value: Field | number,
  id: string,
  tupleSize = 1,
): NodeHandle {
  const n = g.add(setAttribute, { name, tupleSize, value }, id);
  g.connect(from.node, from.pin, n, "in");
  return n;
}

/** What {@link addCornerStage} leaves behind. */
export interface CornerStage {
  /** One point per corner, at its entry frame, carrying {@link CORNER}. */
  readonly out: NodeHandle;
}

export interface CornerStageOptions {
  /** World units per half-width — the scale a station's W is measured in. */
  readonly halfWidth: number;
  /** Node id prefix, so two stages can share one graph. */
  readonly prefix?: string;
}

/**
 * Every corner on the lap, as one point per corner.
 *
 * THE ENTRY TEST IS A FILTER, NOT A SCAN WITH STATE, which is
 * `cornersOf`'s own finding and the thing that makes this portable at
 * all. The forward segmented run counts 1 at a corner's first frame and
 * nowhere else — a straight frame reads 0 because its own contribution is
 * masked away, every later frame of a corner reads 2 or more — so the
 * entries are the frames reading exactly 1.
 *
 * A LAP WITH NO STRAIGHT FRAME ANYWHERE HAS NO CORNERS, and it has to be
 * caught rather than discovered. A segmented scan with nothing to reset
 * on starts counting at the seam, so the frame there reads 1 and would be
 * taken for an entry — cutting a circle at an arbitrary point and
 * inventing a corner nothing turned into. `cornersOf` tests for it before
 * its filter; this ANDs the same test into the predicate, which is the
 * same rule with no second branch to keep in step.
 */
export function addCornerStage(
  g: Graph,
  path: { readonly node: NodeHandle; readonly pin: string },
  opts: CornerStageOptions,
): CornerStage {
  const pre = opts.prefix ?? "cn";
  const { halfWidth } = opts;
  if (!(halfWidth > 0) || !Number.isFinite(halfWidth)) {
    throw new Error(
      `addCornerStage: halfWidth must be a finite number > 0, got ${halfWidth}. It is the world-unit scale a corner's radius and station are measured in.`,
    );
  }

  // ---- 1. the boundary, and the frame's own index ----------------------
  // WRITTEN AS `1 - lt` RATHER THAN `ge` OR `step`, character for
  // character as `writeCornerModel` writes it, and the difference is NaN:
  // both of those answer 0 for a NaN because every comparison with one is
  // false, so an unmeasurable frame would come out flagged as a CORNER
  // and enter at a station nothing chose. Negating the strict less-than
  // puts NaN on the straight side, where a measurement that failed
  // belongs. It is restated here rather than carried because the two run
  // columns were computed against it upstream and this stage needs it as
  // an attribute for `pathRuns` to reset on.
  const straight = put(
    g,
    path,
    CORNER_MODEL.straight,
    sub(1, lt(attribute(CORNER_MODEL.radius), CORNER_R_W)),
    `${pre}Straight`,
  );

  // The frame's own index, recorded BEFORE the filter, because after it
  // `index()` counts corners rather than frames — and the exit station is
  // gathered from the frame `entry + frames - 1`, which is a fact about
  // the frame numbering the filter is about to destroy.
  const framed = put(g, { node: straight, pin: "out" }, CORNER.frame, index(), `${pre}Frame`);

  // ---- 2. the tightest radius in each run ------------------------------
  const masked = put(
    g,
    { node: framed, pin: "out" },
    MASKED_RADIUS,
    select(attribute(CORNER_MODEL.straight), NOT_A_CORNER_W, attribute(CORNER_MODEL.radius)),
    `${pre}MaskR`,
  );

  // BACKWARD AND INCLUSIVE, so a corner's ENTRY frame reads the minimum
  // over the whole corner: backward accumulates what lies ahead up to the
  // next boundary, and the next boundary ahead of an entry is the first
  // straight frame after the corner. `wrap` keeps a corner that straddles
  // the start line one corner, which is the case a closed lap always has
  // and the one that would otherwise invent an extra corner with a false
  // entry at station zero.
  const tightest = g.add(
    pathRuns,
    {
      name: MASKED_RADIUS,
      boundary: CORNER_MODEL.straight,
      outName: CORNER.tightestW,
      reduce: "min",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${pre}Tightest`,
  );
  g.connect(masked, "out", tightest, "in");

  // ---- 3. is there a straight frame at all ----------------------------
  const anyStraight = g.add(
    attributeReduce,
    { name: CORNER_MODEL.straight, domain: "point", mode: "sum", outName: STRAIGHT_TOTAL },
    `${pre}AnyStraightReduce`,
  );
  g.connect(tightest, "out", anyStraight, "in");
  const broadcast = g.add(
    promoteAttribute,
    { name: STRAIGHT_TOTAL, from: "detail", to: "point", mode: "first" },
    `${pre}AnyStraightBcast`,
  );
  g.connect(anyStraight, "out", broadcast, "in");

  // ---- 4. the entries ---------------------------------------------------
  // Exact equality against 1 on an f32 column, which is the one comparison
  // f32 makes safe: the run count is a whole number below 2^24, so every
  // value is exact and this is an identity test rather than a tolerance.
  const entries = g.add(
    filterByExpression,
    {
      predicate: mul(
        eq(component(attribute(CORNER_MODEL.behind, 2), 0), 1),
        gt(attribute(STRAIGHT_TOTAL), 0),
      ),
      topology: "drop",
    },
    `${pre}Entries`,
  );
  g.connect(broadcast, "out", entries, "in");

  return { out: addCornerFacts(g, { node: entries, pin: "out" }, path, pre, halfWidth) };
}

/** The masked radius column the segmented minimum reduces. */
const MASKED_RADIUS = "cornerRadiusMasked";

/** The lap-wide count of straight frames, broadcast onto every frame. */
const STRAIGHT_TOTAL = "cornerAnyStraight";

/**
 * The per-corner facts, once the entries have been filtered out.
 *
 * SPLIT OUT SO THE FILTER IS THE SEAM. Everything above runs on FRAMES
 * and everything here runs on CORNERS, and a reader who loses track of
 * which domain a column lives on will write an expression that is quietly
 * about the wrong population — the run columns mean one thing per frame
 * and the turn sign means one thing per corner.
 */
function addCornerFacts(
  g: Graph,
  entries: { readonly node: NodeHandle; readonly pin: string },
  path: { readonly node: NodeHandle; readonly pin: string },
  pre: string,
  halfWidth: number,
): NodeHandle {
  // How many frames the run lasts, and which way it turns. Both come off
  // the BACKWARD run at the entry, which already holds the whole corner:
  // x is the frame count and y is the total turn.
  const frames = put(
    g,
    entries,
    CORNER.frames,
    attribute(CORNER_MODEL.ahead, 2),
    `${pre}Frames`,
    2,
  );

  // SUMMED OVER THE WHOLE RUN, so the direction is set by the corner's
  // deepest part rather than by the frames near the 12 W threshold where
  // the sign is noise. `>= 0` is a right-hander, matching `cornersOf`:
  // a corner that somehow totalled exactly zero turn is called right, and
  // that tie has to break the same way in both or a lap will differ on
  // one corner in a way no count would show.
  const turnSign = put(
    g,
    { node: frames, pin: "out" },
    CORNER.turn,
    select(ge(component(attribute(CORNER.frames, 2), 1), 0), 1, -1),
    `${pre}Turn`,
  );

  // The outside of a right-hander is to the LEFT, and lateral is positive
  // right of travel — so the outside is the turn negated.
  const outside = put(
    g,
    { node: turnSign, pin: "out" },
    CORNER.outside,
    mul(-1, attribute(CORNER.turn)),
    `${pre}Outside`,
  );

  const entryW = put(
    g,
    { node: outside, pin: "out" },
    CORNER.entryW,
    mul(1 / halfWidth, attribute(ARC_ATTR)),
    `${pre}EntryW`,
  );

  // WHICH FRAME THE CORNER ENDS ON, gathered rather than computed: the
  // exit is `entry + frames - 1` in FRAME numbering, and a station is not
  // a linear function of a frame index on a resampled curve. `wrap` is
  // Euclidean here, which is what a lap needs — a corner that runs off the
  // end of the frame array continues at the start of it, because those
  // are the same place.
  const exitFrame = put(
    g,
    { node: entryW, pin: "out" },
    EXIT_FRAME,
    sub(add(attribute(CORNER.frame), component(attribute(CORNER.frames, 2), 0)), 1),
    `${pre}ExitFrame`,
  );
  const exitArc = g.add(
    transferByIndex,
    {
      index: attribute(EXIT_FRAME),
      attributes: [ARC_ATTR],
      outOfRange: "wrap",
    },
    `${pre}ExitArc`,
  );
  g.connect(exitFrame, "out", exitArc, "in");
  g.connect(path.node, path.pin, exitArc, "source");

  const exitW = put(
    g,
    { node: exitArc, pin: "out" },
    CORNER.exitW,
    mul(1 / halfWidth, attribute(ARC_ATTR)),
    `${pre}ExitW`,
  );

  // L-2's severity split and L-3's gate, as columns rather than as two
  // thresholds every consumer remembers for itself.
  const sharp = put(
    g,
    { node: exitW, pin: "out" },
    CORNER.sharp,
    lt(attribute(CORNER.tightestW), SEVERITY.sharpW),
    `${pre}Sharp`,
  );
  return put(
    g,
    { node: sharp, pin: "out" },
    CORNER.tight,
    lt(attribute(CORNER.tightestW), SEVERITY.tightW),
    `${pre}Tight`,
  );
}

/** The world-unit arc column the frames carry, and the exit gathers. */
const ARC_ATTR = "arcW";

/** The frame index a corner ends on, before it is gathered. */
const EXIT_FRAME = "cornerExitFrame";


/**
 * Run the corner model as a graph and hand back what `cornersOf` hands
 * back.
 *
 * A DROP-IN, AND HERE THAT PHRASE MEANS SOMETHING STRONGER than it did
 * for the stations. `cookStations` returns the same SHAPE as the process
 * it replaces and a different lap; this returns the same CORNERS. There
 * is no draw anywhere in the derivation, so the two can be compared
 * corner for corner, and the suite does exactly that on every lap it can
 * build.
 *
 * ASYNC, LIKE EVERY OTHER COOK, which is why `dressLap` takes this as an
 * option rather than calling it — the same argument
 * `DressOptions.stations` makes, and for the same reason.
 */
export async function cookCorners(opts: {
  readonly lap: Lap;
  readonly seed?: number;
}): Promise<Corner[]> {
  const { lap } = opts;
  if (!lap.corner) {
    throw new Error(
      "cookCorners: this lap carries no corner model, and the corners are derived from its columns rather than re-measured here. Cook the lap through buildRoadGraph (which writes cornerRadiusW and the two run columns) first, or use cornersOf, which states the same rule in TypeScript for a lap that was never cooked.",
    );
  }
  const g = new Graph(opts.seed ?? 1);
  const pathIn = g.add(dataInput, {}, "lapPath");
  g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
  const stage = addCornerStage(g, { node: pathIn, pin: "out" }, { halfWidth: lap.halfWidth });
  g.output(stage.out, "out", "corners");

  const cooked = await cook(g);
  const geo = (cooked.outputs.corners[0] as { geo: Geometry }).geo;
  const col = (name: string): number[] => {
    const c = geo.attrs.point.require(name);
    const out: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) out.push(c.get(i) as number);
    return out;
  };
  const entryW = col(CORNER.entryW);
  const exitW = col(CORNER.exitW);
  const tightestW = col(CORNER.tightestW);
  const turn = col(CORNER.turn);
  // READ, NOT RE-DERIVED FROM THE TURN, and that distinction cost a
  // falsification. The first version of this bridge computed `outside` as
  // `turn >= 0 ? -1 : 1` here in TypeScript, which meant the graph's own
  // `cornerOutside` column was written and never read — so MIRRORING it
  // in the graph passed the whole suite. `corners.ts`' header names that
  // exact failure: "a mirrored turn direction produces a lap where every
  // marker is on the wrong side while every count, share and distance
  // still passes". A column nothing reads is a column nothing tests.
  const outside = col(CORNER.outside);
  const sharp = col(CORNER.sharp);
  const frame = col(CORNER.frame);

  // SORTED BY FRAME, because `cornersOf` answers in frame order and that
  // is racing order from the start line — and because a corner that
  // straddles the line has the HIGHEST entry frame, so it comes last
  // rather than opening the list. `filterByExpression` preserves order,
  // so this sort is a no-op today; it is here because the ordering is
  // part of the contract, and nothing downstream should have to know
  // which node happens to preserve it.
  const order = frame.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
  return order.map(({ i }) => ({
    entryW: entryW[i],
    exitW: exitW[i],
    tightestW: tightestW[i],
    turn: turn[i] >= 0 ? 1 : -1,
    outside: outside[i] >= 0 ? 1 : -1,
    severity: sharp[i] !== 0 ? "sharp" : "open",
  }));
}
