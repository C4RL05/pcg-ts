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
  abs,
  add,
  attribute,
  attributeReduce,
  component,
  cook,
  copyToPoints,
  createPointCloud,
  dataInput,
  eq,
  filterByExpression,
  ge,
  gt,
  index,
  le,
  lt,
  makeGeometryItem,
  max,
  mod,
  mul,
  pointLine,
  randomField,
  pathRuns,
  pathScan,
  pointsToPath,
  promoteAttribute,
  select,
  setAttribute,
  sub,
  transferByIndex,
} from "pcg-ts";
import type { PlaceableAsset } from "./assets.js";
import { CORNER_R_W, type Corner, SEVERITY } from "./corners.js";
import {
  BRAKING,
  MARKER,
  type MarkerKit,
  markerCandidates,
} from "./legibility.js";
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

/* ------------------------------------------------------------------ *
 * L-2 and L-3: where the corner language goes.
 * ------------------------------------------------------------------ */

/** The columns the marker table carries, and the stages gather from it. */
export const MARKER_COL = {
  /** Row index: 0 sharp, 1 open, 2 brake. The gather's index. */
  row: "markerRow",
  /** The kit's own id for that asset, so the answer can be checked. */
  id: "markerAssetId",
  latP10: "markerLatP10",
  latMed: "markerLatMed",
  latP90: "markerLatP90",
} as const;

/** The columns the marker and ruler stages write on their placements. */
export const PLACED = {
  /** Station in W, wrapped into [0, lapW). */
  stationW: "markStationW",
  /** Signed offset across the track in W, positive RIGHT of travel. */
  t: "markT",
  /** Height in W. */
  h: "markH",
  /** Which row of the marker table this placement uses. */
  row: "markRow",
  /** Which corner it belongs to, by that corner's own index. */
  corner: "markCorner",
} as const;

/**
 * The four `randomField` keys, replacing L-2's three salts and L-3's one.
 *
 * FOUR NODES, FOUR STREAMS. As with the asset choice, what makes these
 * independent is that they sit on four different `setAttribute` nodes —
 * `randomField` hashes the NODE's derived seed with the key and the
 * point's identity — and the names are for readability and for keeping a
 * later fifth draw from silently meaning one of these.
 */
const MARKER_KEY = {
  /** How far before the entry L-2's marker sits. Was salt 0x2c01. */
  before: "marker.before",
  /** The quantile L-2 draws its lateral magnitude from. Was 0x2c02. */
  lateral: "marker.lateral",
  /** L-2's height in its band. Was 0x2c03. */
  height: "marker.height",
  /** L-3's shared lateral magnitude, one per ruler. Was 0x3b01. */
  ruler: "marker.ruler",
  /** The three draws that reserve the vocabulary. Was 0x4d21. */
  reserve: "marker.reserve",
} as const;

/**
 * The three reserved assets, flattened onto a three-point cloud.
 *
 * ROW ORDER IS THE ROLE, fixed: 0 sharp, 1 open, 2 brake. L-2 chooses
 * between rows 0 and 1 by severity and L-3 always takes row 2, so the
 * choice is a `select` over an index rather than a branch over two
 * different clouds — which is what lets one gather serve both.
 *
 * ONLY THE LATERAL QUANTILES COME ALONG. L-2 draws its magnitude from the
 * marker's own measured lateral and then forces it outside and past
 * `MARKER.minLateralW`; nothing here reads the marker's height
 * distribution, because L-2 fixes the height in a band of its own and
 * `legibility.ts` argues at length for why filtering markers on their
 * measured height median is the same constraint counted twice.
 */
export function markerCloud(markers: MarkerKit): Geometry {
  const geo = createPointCloud(3);
  const row = geo.attrs.point.add(MARKER_COL.row, "i32", 1);
  const id = geo.attrs.point.add(MARKER_COL.id, "i32", 1);
  const p10 = geo.attrs.point.add(MARKER_COL.latP10, "f32", 1);
  const med = geo.attrs.point.add(MARKER_COL.latMed, "f32", 1);
  const p90 = geo.attrs.point.add(MARKER_COL.latP90, "f32", 1);
  const P = geo.attrs.point.require("P");
  const rows = [markers.sharp, markers.open, markers.brake];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    row.set(i, i);
    id.set(i, a.id);
    // A marker candidate always has `where` -- `reserveFor` filters the
    // kit to assets that carry one before `reserveMarkers` ever sees it --
    // so an absent one is a broken kit rather than a case to handle.
    const w = a.where;
    if (!w) {
      throw new Error(
        `markerCloud: the reserved marker "${a.name}" (id ${a.id}) carries no measured placement, and L-2 draws its lateral from exactly that. reserveMarkers picks from assets that have one, so this kit was filtered differently somewhere.`,
      );
    }
    p10.set(i, w.lateral.p10);
    med.set(i, w.lateral.median);
    p90.set(i, w.lateral.p90);
    // DISTINCT POSITIONS, because `randomField` keys on a point's identity
    // and three coincident rows would be one identity. Nothing here draws
    // on the marker cloud today -- every draw happens on the corner, which
    // is the only place it can mean "one value per corner" -- but a table
    // whose rows cannot be told apart is a trap for whoever adds the next
    // stage, and the fix costs three writes.
    P.setTuple(i, [i, 0, 0]);
  }
  return geo;
}

/** One corner's L-2 marker, or one mark of one corner's L-3 ruler. */
export interface MarkPlacement {
  /** Index into the corner list `cookCorners` answers, in racing order. */
  readonly corner: number;
  /** Row of the marker kit: 0 sharp, 1 open, 2 brake. */
  readonly row: number;
  readonly station: number;
  readonly t: number;
  readonly h: number;
}

/** What one cook of the corner language decides. */
export interface CornerLanguagePlacements {
  /** One per corner, in racing order. L-2. */
  readonly markers: readonly MarkPlacement[];
  /** Three per corner tighter than `SEVERITY.tightW`, in racing order. L-3. */
  readonly rulers: readonly MarkPlacement[];
}

/**
 * L-2's marker for every corner: where it goes, and which archetype.
 *
 * THREE DRAWS PER CORNER, one per quantity, exactly as `placeCornerLanguage`
 * makes them off three salts. What this stage does NOT decide is whether
 * the marker takes over an existing placement's slot or is added beside
 * it — that is a greedy walk over the whole placement list, it recomputes
 * which asset is most repeated after every change, and it stays in
 * TypeScript for now. When it converts, it keeps the victim's station and
 * this stage's station is discarded; when it adds, this one is used.
 */
function addMarkerStage(
  g: Graph,
  corners: { readonly node: NodeHandle; readonly pin: string },
  table: { readonly node: NodeHandle; readonly pin: string },
  lapW: number,
  pre: string,
): NodeHandle {
  // WHICH ARCHETYPE, as an index rather than a branch: row 0 for a corner
  // tighter than `SEVERITY.sharpW` and row 1 for the rest, which is
  // `cornersOf`'s severity split spelled as the gather's argument.
  const row = put(
    g,
    corners,
    PLACED.row,
    select(attribute(CORNER.sharp), 0, 1),
    `${pre}Row`,
  );

  // WHICH CORNER, recorded before anything filters, because a caller pairs
  // these against the corner list by index and `filterByExpression` does
  // not renumber what it keeps -- it just keeps fewer.
  const which = put(g, { node: row, pin: "out" }, PLACED.corner, index(), `${pre}Which`);

  const gathered = g.add(
    transferByIndex,
    {
      index: attribute(PLACED.row),
      attributes: [MARKER_COL.latP10, MARKER_COL.latMed, MARKER_COL.latP90],
      outOfRange: "clamp",
    },
    `${pre}Gather`,
  );
  g.connect(which, "out", gathered, "in");
  g.connect(table.node, table.pin, gathered, "source");

  // The window is measured BACK from the entry, so a larger `before` is
  // further upstream of the corner.
  const beforeW = add(
    MARKER.windowW[0],
    mul(randomField(MARKER_KEY.before), MARKER.windowW[1] - MARKER.windowW[0]),
  );
  const stationed = put(
    g,
    { node: gathered, pin: "out" },
    PLACED.stationW,
    wrapTo(sub(attribute(CORNER.entryW), beforeW), lapW),
    `${pre}Station`,
  );

  // ITS OWN LATERAL, FORCED OUTSIDE AND PAST THE CORRIDOR. The `max` is
  // why Z-1 never has to move a marker, and the `abs` is why an asset
  // whose quantiles extrapolate negative still lands on the outside
  // rather than having its side decided by the sign of a draw.
  const magnitude = max(
    MARKER.minLateralW,
    abs(
      quantileField(
        attribute(MARKER_COL.latP10),
        attribute(MARKER_COL.latMed),
        attribute(MARKER_COL.latP90),
        randomField(MARKER_KEY.lateral),
      ),
    ),
  );
  const lateral = put(
    g,
    { node: stationed, pin: "out" },
    PLACED.t,
    mul(attribute(CORNER.outside), magnitude),
    `${pre}Lateral`,
  );

  return put(
    g,
    { node: lateral, pin: "out" },
    PLACED.h,
    add(
      MARKER.heightW[0],
      mul(randomField(MARKER_KEY.height), MARKER.heightW[1] - MARKER.heightW[0]),
    ),
    `${pre}Height`,
  );
}

/**
 * L-3's ruler: three marks before every corner tighter than 8 W.
 *
 * EXACTLY EVEN, SPANNING THE WINDOW END TO END, and the stations carry no
 * draw at all: 6, 10.5 and 15 W before the entry, which is `rulerStations`
 * arithmetic and nothing else. Spacing CV is zero by construction.
 *
 * ONE LATERAL FOR ALL THREE — they are a line, not a scatter — and that is
 * why the draw happens on the CORNER and is carried onto the copies
 * rather than being drawn per mark. `copyToPoints` gives each copy its own
 * identity, so a `randomField` read after the copy would give three
 * different magnitudes and the ruler would not be a ruler. The asset
 * choice learned the same lesson about its uniforms; this is the case
 * where getting it wrong is visible rather than merely wrong.
 */
function addRulerStage(
  g: Graph,
  corners: { readonly node: NodeHandle; readonly pin: string },
  lapW: number,
  pre: string,
): NodeHandle {
  const which = put(g, corners, PLACED.corner, index(), `${pre}Which`);

  // The shared magnitude, drawn once per corner and before the copy.
  const mag = put(
    g,
    { node: which, pin: "out" },
    RULER_MAG,
    add(
      BRAKING.lateralW[0],
      mul(randomField(MARKER_KEY.ruler), BRAKING.lateralW[1] - BRAKING.lateralW[0]),
    ),
    `${pre}Mag`,
  );

  const tightOnly = g.add(
    filterByExpression,
    { predicate: attribute(CORNER.tight), topology: "drop" },
    `${pre}Tight`,
  );
  g.connect(mag, "out", tightOnly, "in");

  // THE TEMPLATE'S POINTS ARE SPREAD, not coincident, for the reason
  // `stationGraph`'s slot template gives: `copyToPoints` offsets each copy
  // by its template point, and two copies at one position with one seed
  // are ONE identity to everything downstream.
  const template = g.add(
    pointLine,
    {
      mode: "endpoints",
      count: BRAKING.count,
      start: [0, 0, 0],
      end: [BRAKING.count - 1, 0, 0],
      includeEnd: true,
    },
    `${pre}Marks`,
  );

  const copies = g.add(
    copyToPoints,
    {
      targetNames: [CORNER.entryW, CORNER.outside, PLACED.corner, RULER_MAG],
      topology: "drop",
    },
    `${pre}Copies`,
  );
  g.connect(template, "out", copies, "source");
  g.connect(tightOnly, "out", copies, "target");

  // Copy `s` of target `t` lands at output index `t * count + s`, so a
  // mark's rank within its own ruler is `index() mod count` -- the same
  // arithmetic the station clusters use, and no second column for it.
  const k = mod(index(), BRAKING.count);
  const span = BRAKING.windowW[1] - BRAKING.windowW[0];
  const beforeW = add(BRAKING.windowW[0], mul(k, span / (BRAKING.count - 1)));

  const stationed = put(
    g,
    { node: copies, pin: "out" },
    PLACED.stationW,
    wrapTo(sub(attribute(CORNER.entryW), beforeW), lapW),
    `${pre}Station`,
  );
  const lateral = put(
    g,
    { node: stationed, pin: "out" },
    PLACED.t,
    mul(attribute(CORNER.outside), attribute(RULER_MAG)),
    `${pre}Lateral`,
  );
  const heighted = put(
    g,
    { node: lateral, pin: "out" },
    PLACED.h,
    MARKER.heightW[0],
    `${pre}Height`,
  );
  // Every mark is row 2, the brake archetype. Written rather than assumed
  // so the two stages hand back the same shape and a reader of the output
  // never has to know which stage produced a row.
  return put(g, { node: heighted, pin: "out" }, PLACED.row, 2, `${pre}Row`);
}

/** The ruler's shared lateral magnitude, drawn per corner. */
const RULER_MAG = "rulerMag";

/** A station wrapped into [0, modulus), for a negative value too. */
function wrapTo(value: Field, modulus: number): Field {
  return mod(add(mod(value, modulus), modulus), modulus);
}

/**
 * `drawQuantile`, as a field — two lines, not four.
 *
 * The same derivation `assetGraph` sets out: the outer two branches of
 * the TypeScript are their neighbours evaluated outside their range, so
 * the piecewise-linear inverse CDF has exactly two pieces meeting at the
 * median. Restated here rather than imported because `assetGraph`'s copy
 * is private to the asset draw and a shared helper between two modules
 * that happen to need the same two lines is a coupling neither wants;
 * `racetrackCornerLanguage` checks this one against `drawQuantile`
 * directly, so a divergence is a failing test rather than a surprise.
 */
function quantileField(p10: Field, median: Field, p90: Field, u: Field): Field {
  const lower = add(p10, mul(mul(sub(u, 0.1), 2.5), sub(median, p10)));
  const upper = add(median, mul(mul(sub(u, 0.5), 2.5), sub(p90, median)));
  return select(le(u, 0.5), lower, upper);
}

/** What {@link addCornerLanguage} leaves behind. */
export interface CornerLanguageStage {
  /** One point per corner. L-2. */
  readonly markers: NodeHandle;
  /** Three per corner tighter than `SEVERITY.tightW`. L-3. */
  readonly rulers: NodeHandle;
}

/**
 * L-2 and L-3's placements, added to a graph that already holds the lap.
 *
 * TAKES THE PATH, NOT THE CORNERS, so a caller need not have built the
 * corner stage itself -- and so that when one has, the two share it:
 * `Graph` memoizes per node, so adding this beside the asset choice on
 * the same `lapPath` resamples nothing again and reads the corner model
 * once.
 */
export function addCornerLanguage(
  g: Graph,
  path: { readonly node: NodeHandle; readonly pin: string },
  markers: MarkerKit,
  lap: Lap,
  pre: string,
): CornerLanguageStage {
  const tableIn = g.add(dataInput, {}, `${pre}Table`);
  g.setParam(tableIn, "items", [makeGeometryItem(markerCloud(markers))]);
  const stage = addCornerStage(g, path, { halfWidth: lap.halfWidth, prefix: `${pre}Cn` });
  return {
    markers: addMarkerStage(
      g,
      { node: stage.out, pin: "out" },
      { node: tableIn, pin: "out" },
      lap.lengthW,
      `${pre}L2`,
    ),
    rulers: addRulerStage(g, { node: stage.out, pin: "out" }, lap.lengthW, `${pre}L3`),
  };
}

/** The output names {@link addCornerLanguage}'s two clouds publish under. */
export const CORNER_LANGUAGE_OUTPUTS = { markers: "l2", rulers: "l3" } as const;

/** Read the two clouds {@link addCornerLanguage} published back. */
export function readCornerLanguage(cooked: {
  readonly outputs: Record<string, readonly unknown[]>;
}): CornerLanguagePlacements {
  const read = (name: string): MarkPlacement[] => {
    const geo = (cooked.outputs[name][0] as { geo: Geometry }).geo;
    const col = (n: string): number[] => {
      const c = geo.attrs.point.require(n);
      const out: number[] = [];
      for (let i = 0; i < geo.attrs.point.count; i++) out.push(c.get(i) as number);
      return out;
    };
    const corner = col(PLACED.corner);
    const row = col(PLACED.row);
    const station = col(PLACED.stationW);
    const t = col(PLACED.t);
    const h = col(PLACED.h);
    return corner.map((c, i) => ({
      corner: c,
      row: row[i],
      station: station[i],
      t: t[i],
      h: h[i],
    }));
  };
  return {
    markers: read(CORNER_LANGUAGE_OUTPUTS.markers),
    rulers: read(CORNER_LANGUAGE_OUTPUTS.rulers),
  };
}

/**
 * Run L-2 and L-3's placements as a graph of their own.
 *
 * A COOK OF ITS OWN, FOR THE SUITES AND FOR A CALLER WHO WANTS ONLY THIS.
 * The page does not use it: `cookLapPlacements` adds the same two stages
 * to the graph that already holds the stations and the asset choice,
 * because the endpoint is a lap LEVEL and a level is one graph.
 *
 * WHAT COMES BACK IS WHERE THINGS GO, NOT THE DRESSED LAP.
 * `placeCornerLanguage` still owns the convert-or-add and the
 * displacement, because both are greedy walks over a mutable list that
 * recompute a lap-wide histogram after every change. This decides the
 * three quantities L-2 draws and the one L-3 draws -- the half that
 * re-bases -- and hands them over.
 */
export async function cookCornerLanguage(opts: {
  readonly lap: Lap;
  readonly seed: number;
  readonly markers: MarkerKit;
}): Promise<CornerLanguagePlacements> {
  const { lap, seed, markers } = opts;
  if (!lap.corner) {
    throw new Error(
      "cookCornerLanguage: this lap carries no corner model, and L-2 and L-3 are placed relative to corner entries. Cook the lap through buildRoadGraph first, or use placeCornerLanguage, which states the same rules in TypeScript for a lap that was never cooked.",
    );
  }
  const g = new Graph(seed);
  const pathIn = g.add(dataInput, {}, "lapPath");
  g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
  const stage = addCornerLanguage(g, { node: pathIn, pin: "out" }, markers, lap, "cl");
  g.output(stage.markers, "out", CORNER_LANGUAGE_OUTPUTS.markers);
  g.output(stage.rulers, "out", CORNER_LANGUAGE_OUTPUTS.rulers);
  return readCornerLanguage(await cook(g));
}

/* ------------------------------------------------------------------ *
 * Reserving the corner language's three assets.
 * ------------------------------------------------------------------ */

/** The columns the candidate cloud carries through the three draws. */
export const CANDIDATE = {
  /** Index into the candidate list this cloud was built from. */
  ord: "candOrd",
  /** `max(1, instances)` — the weight a draw sees. */
  weight: "candWeight",
  /** 1 once a round has taken this candidate. */
  taken: "candTaken",
  /** Which round took it: 0, 1, 2, or -1 for untaken. */
  round: "candRound",
} as const;

/**
 * The candidates, flattened — verticals only, in ascending id.
 *
 * THE ID ORDER IS LOAD-BEARING and is `markerCandidates`' own, not a
 * convenience: the weighted walk consumes the list in order, so two
 * orderings give two different picks from the same uniform. Sorting here
 * rather than trusting the caller is what makes the graph's answer a
 * function of the KIT rather than of however the kit happened to be
 * assembled.
 *
 * `max(1, instances)` IS THE WEIGHT, transcribed. `reserveMarkers` argues
 * for weighting by how often the source used the asset rather than
 * uniformly — L-2 puts its marker at every corner of a severity, so
 * whatever is chosen becomes one of the most repeated objects on the lap,
 * and promoting a one-off to that is a bigger departure from the source
 * than L-2 intends. The floor of 1 is what keeps a never-used candidate
 * reachable at all.
 */
export function candidateCloud(candidates: readonly PlaceableAsset[]): Geometry {
  const geo = createPointCloud(candidates.length);
  const ord = geo.attrs.point.add(CANDIDATE.ord, "i32", 1);
  const weight = geo.attrs.point.add(CANDIDATE.weight, "f32", 1);
  geo.attrs.point.add(CANDIDATE.taken, "f32", 1);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < candidates.length; i++) {
    ord.set(i, i);
    weight.set(i, Math.max(1, candidates[i].instances));
    // Distinct positions, so `randomField` can tell the rows apart -- the
    // same rule `markerCloud` follows and for the same reason.
    P.setTuple(i, [i, 0, 0]);
  }
  return geo;
}

/**
 * The three uniforms the three rounds draw with, on their own cloud.
 *
 * A SEPARATE THREE-POINT CLOUD, and this is the part of the port that
 * needed a mechanism rather than a transcription. `reserveMarkers` draws
 * `rand(seed, k, 0x4d21)` — ONE number per round, indexed by the round.
 * `randomField` answers one number per POINT, so reading it on the
 * candidates would give a different uniform to every candidate, which is
 * not a draw from anything. Three points with three identities give three
 * numbers, and `transferByIndex` at a constant index hands round k's
 * number to every candidate at once.
 */
function drawCloud(): Geometry {
  const geo = createPointCloud(RESERVE_ROUNDS);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < RESERVE_ROUNDS; i++) P.setTuple(i, [i, 0, 0]);
  return geo;
}

/**
 * How many assets the corner language reserves.
 *
 * THREE, NOT TWO, and `reserveMarkers` gives the argument: L-2 asks for a
 * distinct object per severity and L-3 for a ruler, so if the ruler were
 * one of the two markers the marker would stop being distinct. It is a
 * constant rather than a parameter because {@link MarkerKit} has exactly
 * three fields — a fourth would have nowhere to go.
 */
const RESERVE_ROUNDS = 3;

/** The uniform column the draw cloud carries. */
const DRAW_U = "reserveU";

/** Running weight below and through each candidate, this round. */
const RESERVE_CUM_LO = "reserveCumLo";
const RESERVE_CUM_HI = "reserveCumHi";
const RESERVE_TOTAL = "reserveTotal";
const RESERVE_DRAW = "reserveDraw";

/**
 * One weighted draw from the candidates that no earlier round has taken.
 *
 * THE LOOP IS UNROLLED RATHER THAN RUN IN `repeatUntil`, and that is a
 * decision rather than an omission. A `repeatUntil` body cannot see its
 * own iteration index, so it could not reach round k's uniform — the one
 * quantity here that is indexed BY the round. Three is a constant that
 * `MarkerKit`'s own shape fixes, so three stages is the honest spelling
 * and it costs no mechanism to read later.
 *
 * THE BRACKET IS TWO SCANS, as everywhere else in this campaign: scanning
 * one column exclusive and inclusive gives bounds that are the same f64
 * partial sum rounded at the same place, so every bracket's top IS its
 * successor's bottom and exactly one candidate survives.
 *
 * A TAKEN CANDIDATE IS MASKED TO ZERO WEIGHT rather than removed, which
 * is the same thing said in a language that has no `splice`: a zero
 * weight makes a bracket of width zero, and a bracket of width zero can
 * contain nothing.
 */
function addReserveRound(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  draws: { readonly node: NodeHandle; readonly pin: string },
  round: number,
  pre: string,
): NodeHandle {
  const tag = `${pre}R${round}`;

  // This round's uniform, the same number on every candidate.
  const drawn = g.add(
    transferByIndex,
    { index: round, attributes: [DRAW_U], outOfRange: "clamp" },
    `${tag}Draw`,
  );
  g.connect(from.node, from.pin, drawn, "in");
  g.connect(draws.node, draws.pin, drawn, "source");

  // What this round may still take.
  const live = put(
    g,
    { node: drawn, pin: "out" },
    LIVE_WEIGHT,
    mul(attribute(CANDIDATE.weight), sub(1, attribute(CANDIDATE.taken))),
    `${tag}Live`,
  );

  // ONE PATH OVER EVERY CANDIDATE, because the draw is over the whole
  // remaining list. `shortGroups` never applies -- there is one group and
  // `reserveMarkers` has already refused a candidate list below three.
  const path = g.add(pointsToPath, { closed: false }, `${tag}Path`);
  g.connect(live, "out", path, "in");

  const below = g.add(
    pathScan,
    { name: LIVE_WEIGHT, outName: RESERVE_CUM_LO, mode: "exclusive" },
    `${tag}CumLo`,
  );
  g.connect(path, "out", below, "in");
  const through = g.add(
    pathScan,
    {
      name: LIVE_WEIGHT,
      outName: RESERVE_CUM_HI,
      mode: "inclusive",
      totalAttr: RESERVE_TOTAL,
    },
    `${tag}CumHi`,
  );
  g.connect(below, "out", through, "in");
  const total = g.add(
    promoteAttribute,
    { name: RESERVE_TOTAL, from: "primitive", to: "point", mode: "first" },
    `${tag}Total`,
  );
  g.connect(through, "out", total, "in");

  const scaled = put(
    g,
    { node: total, pin: "out" },
    RESERVE_DRAW,
    mul(attribute(DRAW_U), attribute(RESERVE_TOTAL)),
    `${tag}Scaled`,
  );

  // WHICH CANDIDATE THIS ROUND TOOK, as a flag rather than a filter: the
  // cloud has to survive intact into the next round, so nothing is
  // dropped and `taken` simply grows by one.
  //
  // THE BOUNDARY DIFFERS FROM THE TYPESCRIPT BY ONE ULP AND ONLY THERE.
  // `reserveMarkers` subtracts weights and takes the first candidate
  // whose running total reaches the draw (`u <= 0` after subtracting), so
  // a draw landing EXACTLY on a boundary goes to the lower candidate;
  // this bracket is half-open upward, so it goes to the upper one. The
  // draw is a float times a sum of integers and the port re-bases anyway,
  // so the disagreement is a measure-zero event on a lap that already
  // differs -- but it is the kind of thing that is invisible until
  // somebody builds a fixture with weights of 1 and asks why.
  const x = attribute(RESERVE_DRAW);
  const hit = mul(
    le(attribute(RESERVE_CUM_LO), x),
    lt(x, attribute(RESERVE_CUM_HI)),
  );
  const marked = put(
    g,
    { node: scaled, pin: "out" },
    CANDIDATE.taken,
    max(attribute(CANDIDATE.taken), hit),
    `${tag}Taken`,
  );
  return put(
    g,
    { node: marked, pin: "out" },
    CANDIDATE.round,
    select(hit, round, attribute(CANDIDATE.round)),
    `${tag}Round`,
  );
}

/** The masked weight a round's scan actually runs over. */
const LIVE_WEIGHT = "candLive";

/**
 * Reserve three of the candidates, by three weighted draws without
 * replacement.
 *
 * WHAT COMES BACK IS THREE INDICES, NOT A `MarkerKit`. Assigning the
 * roles is `reserveMarkers`' own rule -- sharp is the tallest of the
 * three, open the second, brake the shortest -- and it is an ordering of
 * three objects rather than a decision about the lap. It stays with the
 * caller, which also means there is no role column here for nothing to
 * read: this campaign has twice now written a column the consuming
 * TypeScript quietly ignored, and the cheapest way not to do it a third
 * time is not to write one.
 */
export function addReserveStage(
  g: Graph,
  candidates: { readonly node: NodeHandle; readonly pin: string },
  draws: { readonly node: NodeHandle; readonly pin: string },
  pre: string,
): NodeHandle {
  let at = put(g, candidates, CANDIDATE.round, -1, `${pre}Round0`);
  for (let k = 0; k < RESERVE_ROUNDS; k++) {
    at = addReserveRound(g, { node: at, pin: "out" }, draws, k, pre);
  }
  return at;
}

/**
 * Run `reserveMarkers` as a graph, and answer what it answers.
 *
 * A DROP-IN FOR `reserveMarkers`, including its refusal to reserve
 * anything when a kit has fewer than three verticals -- which it reports
 * rather than throwing, because `dressLap` already answers a missing kit
 * by placing no corner language at all.
 *
 * IT RE-BASES. `reserveMarkers` draws from `rand(seed, k, 0x4d21)` and
 * this draws from `randomField` on a three-point cloud, so the two pick
 * different assets from the same kit and seed. Everything downstream of
 * the reservation moves with it, which on this vocabulary means the
 * corner language speaks with different objects -- the same rule, a
 * different vocabulary.
 */
export async function cookReserveMarkers(opts: {
  readonly assets: readonly PlaceableAsset[];
  readonly seed: number;
}): Promise<{ markers?: MarkerKit; pool: PlaceableAsset[] }> {
  const { assets, seed } = opts;
  const cands = markerCandidates(assets);
  if (cands.length < RESERVE_ROUNDS) return { pool: [...assets] };

  const g = new Graph(seed);
  const candsIn = g.add(dataInput, {}, "candidates");
  g.setParam(candsIn, "items", [makeGeometryItem(candidateCloud(cands))]);
  const drawsIn = g.add(dataInput, {}, "draws");
  g.setParam(drawsIn, "items", [makeGeometryItem(drawCloud())]);
  const u = put(
    g,
    { node: drawsIn, pin: "out" },
    DRAW_U,
    randomField(MARKER_KEY.reserve),
    "reserveU",
  );

  const stage = addReserveStage(
    g,
    { node: candsIn, pin: "out" },
    { node: u, pin: "out" },
    "rv",
  );
  g.output(stage, "out", "candidates");

  const cooked = await cook(g);
  const geo = (cooked.outputs.candidates[0] as { geo: Geometry }).geo;
  const ordCol = geo.attrs.point.require(CANDIDATE.ord);
  const roundCol = geo.attrs.point.require(CANDIDATE.round);
  const picked: PlaceableAsset[] = [];
  for (let k = 0; k < RESERVE_ROUNDS; k++) {
    let found = -1;
    for (let i = 0; i < geo.attrs.point.count; i++) {
      if ((roundCol.get(i) as number) === k) {
        found = ordCol.get(i) as number;
        break;
      }
    }
    if (found < 0) {
      throw new Error(
        `cookReserveMarkers: no candidate of ${cands.length} is marked as round ${k}'s, out of ${RESERVE_ROUNDS} rounds. The likeliest cause is a round taking a candidate an earlier round already took: a second hit overwrites that candidate's round marker, so the earlier round's pick disappears rather than showing up as a duplicate. Check that each round masks the already-taken weight to zero.`,
      );
    }
    picked.push(cands[found]);
  }

  // TALLEST FIRST, which is `reserveMarkers`' rule and not this graph's:
  // ordering three objects by a measurement they already carry is not a
  // decision about the lap, and putting it here keeps the graph from
  // publishing a role column that nothing would check.
  const bySize = [...picked].sort((a, b) => b.size.tall - a.size.tall);
  const reserved = new Set(picked.map((a) => a.id));
  return {
    markers: { sharp: bySize[0], open: bySize[1], brake: bySize[2] },
    pool: assets.filter((a) => !reserved.has(a.id)),
  };
}


/* ------------------------------------------------------------------ *
 * L-2's convert-or-add, and L-3's displacement.
 * ------------------------------------------------------------------ */

/** The columns the victim search reads and writes on the placements. */
export const VICTIM = {
  /**
   * Which asset this placement carries.
   *
   * NON-NEGATIVE IS AN INDEX INTO THE POOL and negative is a MARKER, as
   * `-1 - row` for the three reserved rows. One column rather than two
   * because the histogram groups by it and the corner language's own
   * "never convert a marker" is then `ord < 0` -- a test that stays true
   * as L-2 converts, which a column written once before any conversion
   * would not.
   */
  assetOrd: "vAssetOrd",
  /** Station in W. */
  stationW: "vStationW",
  /** Signed lateral in W. */
  t: "vT",
  /** How many placements on the lap carry this placement's asset. */
  count: "vCount",
  /** Which corner converted this placement, or -1. */
  claimedBy: "vClaimedBy",
  /** Which tight corner's ruler displaced it, or -1. */
  displacedBy: "vDisplacedBy",
} as const;

/**
 * The largest placement index, standing in for "no victim".
 *
 * A CEILING RATHER THAN AN INFINITY, for the reason `stationGraph` gives
 * about its own `LOSES`: `resolveOn` refuses a column a field left
 * non-finite, so a sentinel that has to survive a `setAttribute` cannot
 * be `Infinity`. Any value above every real point index does.
 */
const NO_VICTIM = 1e9;

/**
 * How many copies an asset must have on the lap before it may be taken.
 *
 * `placeCornerLanguage` spells this as `victimCount = 1` with a strict
 * `>`, which reads as a loop initialiser and IS a rule: an asset with one
 * copy on the whole lap is never converted and never displaced, so L-4's
 * landmarks -- which are exactly the assets appearing once -- are safe
 * from L-2 and L-3 by construction rather than by a protect set. Named
 * here so the next reader need not derive it from an initial value.
 */
const MIN_REPEATS_TO_TAKE = 1;

const HIST_ONE = "vHistOne";
const HIST_TOTAL = "vHistTotal";
const ELIGIBLE = "vEligible";
const VICTIM_SCORE = "vScore";
const VICTIM_INDEX = "vIndex";
const BEST_COUNT = "vBest";
const CHOSEN_INDEX = "vChosen";

/** The marker ord for a row of the marker kit: 0 sharp, 1 open, 2 brake. */
function markerOrdOf(row: number): number {
  return -1 - row;
}

/**
 * The lap-wide count of each asset, back onto every placement.
 *
 * THE GROUPED REDUCTION `pathScan`'s `reduce` WAS ADDED FOR, and the only
 * way this library can spell one: `attributeReduce` collapses a whole
 * domain into the detail domain and cannot group at all. One path per
 * distinct asset ord, a scan of a constant 1 reported through
 * `totalAttr`, and a promote back onto the points.
 *
 * `alive` MASKS WHAT IS NO LONGER THERE. L-3 displaces placements by
 * removing them, and `repeats()` is recomputed over the list AFTER each
 * removal -- so a displaced placement must stop counting towards its own
 * asset's total. It is masked rather than filtered because the point has
 * to keep its index: every later stage names a victim by index, and a
 * filter would renumber the lap under them.
 */
function addHistogram(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  tag: string,
): NodeHandle {
  const one = put(
    g,
    from,
    HIST_ONE,
    eq(attribute(VICTIM.displacedBy), -1),
    `${tag}One`,
  );
  const grouped = g.add(
    pointsToPath,
    { groupAttr: VICTIM.assetOrd, closed: false, shortGroups: "skip" },
    `${tag}Group`,
  );
  g.connect(one, "out", grouped, "in");
  const scanned = g.add(
    pathScan,
    { name: HIST_ONE, outName: "vHistScan", mode: "inclusive", totalAttr: HIST_TOTAL },
    `${tag}Scan`,
  );
  g.connect(grouped, "out", scanned, "in");
  const promoted = g.add(
    promoteAttribute,
    { name: HIST_TOTAL, from: "primitive", to: "point", mode: "first" },
    `${tag}Promote`,
  );
  g.connect(scanned, "out", promoted, "in");
  // A GROUP OF ONE IS SKIPPED BY `shortGroups` AND READS THE FOLD'S
  // IDENTITY, which for a sum is zero -- so the total is floored at its
  // own contribution. A live placement is one copy of its own asset, and
  // a count of zero would say the lap does not contain something it does.
  return put(
    g,
    { node: promoted, pin: "out" },
    VICTIM.count,
    max(attribute(HIST_ONE), attribute(HIST_TOTAL)),
    `${tag}Count`,
  );
}

/** Broadcast a whole-cloud reduction back onto every point. */
function broadcastOver(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  column: string,
  mode: "min" | "max" | "sum",
  outName: string,
  tag: string,
): NodeHandle {
  const reduced = g.add(
    attributeReduce,
    { name: column, domain: "point", mode, outName },
    `${tag}Reduce`,
  );
  g.connect(from.node, from.pin, reduced, "in");
  const promoted = g.add(
    promoteAttribute,
    { name: outName, from: "detail", to: "point", mode: "first" },
    `${tag}Bcast`,
  );
  g.connect(reduced, "out", promoted, "in");
  return promoted;
}

/** `Math.sign` of a column, with zero staying zero as it does in JS. */
function signOf(name: string): Field {
  return select(gt(attribute(name), 0), 1, select(lt(attribute(name), 0), -1, 0));
}

/**
 * The most repeated placement a window holds, chosen and marked.
 *
 * ONE SEARCH, TWO CALLERS. L-2's conversion and L-3's displacement differ  only
 * in their window, whether they test the side, and what they do with the
 * answer -- so the search itself is written once and the differences are
 * arguments. Two copies of a two-reduction tie-break is exactly how two
 * rules end up breaking ties differently.
 *
 * THE TIE-BREAK IS TWO REDUCTIONS, as D-4's donor search is: the first
 * pass finds the extreme VALUE and the second the SMALLEST INDEX holding
 * it, so a tie breaks to the lower index here and in the TypeScript alike
 * rather than to whichever the reduction happened to see first.
 */
function addVictimSearch(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  opts: {
    readonly entryW: number;
    readonly windowW: readonly [number, number];
    readonly outside?: number;
    readonly lapW: number;
    readonly tag: string;
  },
): { readonly out: NodeHandle; readonly isVictim: Field } {
  const { entryW, windowW, outside, lapW, tag } = opts;
  const counted = addHistogram(g, from, tag);

  // `beforeEntryW`, transcribed: the distance BACK from the entry, always
  // positive, because on a loop a placement at station 4 for an entry at
  // station 2 is a lap early rather than two W late.
  const before = wrapTo(sub(entryW, attribute(VICTIM.stationW)), lapW);
  // L-2 tests the side and L-3 does not, which is not an oversight in
  // either: a marker announces a corner from its outside, and a ruler
  // pays for itself out of the whole window.
  //
  // `Math.sign(0)` IS 0 AND MATCHES NEITHER SIDE, so a placement at
  // exactly zero lateral can never be converted. Spelled as an equality
  // against the sign rather than as a product of comparisons, so that
  // zero keeps failing rather than quietly passing.
  const side = outside === undefined ? 1 : eq(signOf(VICTIM.t), outside);
  const eligible = put(
    g,
    { node: counted, pin: "out" },
    ELIGIBLE,
    mul(
      mul(ge(before, windowW[0]), le(before, windowW[1])),
      mul(
        mul(side, ge(attribute(VICTIM.assetOrd), 0)),
        mul(
          gt(attribute(VICTIM.count), MIN_REPEATS_TO_TAKE),
          mul(
            eq(attribute(VICTIM.claimedBy), -1),
            eq(attribute(VICTIM.displacedBy), -1),
          ),
        ),
      ),
    ),
    `${tag}Eligible`,
  );

  const scored = put(
    g,
    { node: eligible, pin: "out" },
    VICTIM_SCORE,
    select(attribute(ELIGIBLE), attribute(VICTIM.count), -1),
    `${tag}Score`,
  );
  const best = broadcastOver(
    g,
    { node: scored, pin: "out" },
    VICTIM_SCORE,
    "max",
    BEST_COUNT,
    `${tag}Best`,
  );
  const ranked = put(
    g,
    { node: best, pin: "out" },
    VICTIM_INDEX,
    select(
      mul(attribute(ELIGIBLE), eq(attribute(VICTIM.count), attribute(BEST_COUNT))),
      index(),
      NO_VICTIM,
    ),
    `${tag}Rank`,
  );
  const chosen = broadcastOver(
    g,
    { node: ranked, pin: "out" },
    VICTIM_INDEX,
    "min",
    CHOSEN_INDEX,
    `${tag}Chosen`,
  );

  // Read off the SCORE rather than off the index, because `victimCount`
  // starting at 1 with a strict `>` is what says "no victim" -- the index
  // sentinel would have to be compared as well and says nothing the score
  // does not.
  return {
    out: chosen,
    isVictim: mul(
      eq(index(), attribute(CHOSEN_INDEX)),
      gt(attribute(BEST_COUNT), MIN_REPEATS_TO_TAKE),
    ),
  };
}

/**
 * ONE CORNER'S convert-or-add.
 *
 * THE CORNER'S OWN NUMBERS ARE CONSTANTS HERE, and that is what makes the
 * rule expressible without a join at all. `cookCorners` has already run,
 * so `entryW` and `outside` are ordinary JavaScript numbers by the time
 * this graph is built -- the eligibility test is a field expression over
 * the placements alone, with no `copyToPoints` stamping every corner onto
 * every placement and no grouped reduction to undo it afterwards.
 *
 * WHICH IS ALSO WHY THE LOOP IS UNROLLED. A `repeatUntil` body cannot see
 * its own iteration index, so it could not know which corner it was
 * handling; it would have to carry the corner cloud, join it to the
 * placements every round, and reduce per group to get back to the one
 * number this already has. `repeatUntil` also carries exactly one pin,
 * and this needs two populations.
 *
 * AND IT IS EXACT RATHER THAN APPROXIMATE. The histogram is rebuilt at
 * every stage, so corner k+1 sees the conversion corner k made -- which
 * is what `placeCornerLanguage` does, and it is the part a parallel pick
 * would have had to give up. Measured before this was built: freezing the
 * histogram moves the victim on 0 to 3 corners of 19, and lets two
 * corners name the SAME placement on 0 to 1 of them, converting it twice
 * and silently leaving one corner with no marker while the converted and
 * added counts still sum correctly. Sequential stages make both
 * impossible rather than unlikely.
 */
function addConvertStage(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  corner: Corner,
  cornerIndex: number,
  lapW: number,
  pre: string,
): NodeHandle {
  const tag = `${pre}C${cornerIndex}`;
  const search = addVictimSearch(g, from, {
    entryW: corner.entryW,
    windowW: MARKER.windowW as unknown as readonly [number, number],
    outside: corner.outside,
    lapW,
    tag,
  });
  const claimed = put(
    g,
    { node: search.out, pin: "out" },
    VICTIM.claimedBy,
    select(search.isVictim, cornerIndex, attribute(VICTIM.claimedBy)),
    `${tag}Claim`,
  );
  // THE CONVERSION IS APPLIED HERE, not after the last stage, and that is
  // the whole reason this is exact: the next corner's histogram has to
  // count the marker rather than the asset it replaced.
  return put(
    g,
    { node: claimed, pin: "out" },
    VICTIM.assetOrd,
    select(
      search.isVictim,
      markerOrdOf(corner.severity === "sharp" ? 0 : 1),
      attribute(VICTIM.assetOrd),
    ),
    `${tag}Convert`,
  );
}

/**
 * ONE MARK'S WORTH of L-3's payment.
 *
 * PAY FIRST, AND UP TO THREE TIMES. `placeCornerLanguage` displaces the
 * most repeated ordinary placement in the braking window, up to
 * `BRAKING.count` of them, BEFORE it adds the ruler -- so the displaced
 * placements cannot be the marks just added, and a window with nothing to
 * give still gets its ruler.
 *
 * IT BREAKS RATHER THAN CONTINUES when a round finds nothing, which
 * unrolled is simply what happens: a stage with no eligible placement
 * marks none, and the next stage over the same window finds none either.
 */
function addDisplaceStage(
  g: Graph,
  from: { readonly node: NodeHandle; readonly pin: string },
  corner: Corner,
  tightIndex: number,
  mark: number,
  lapW: number,
  pre: string,
): NodeHandle {
  const tag = `${pre}D${tightIndex}_${mark}`;
  const search = addVictimSearch(g, from, {
    entryW: corner.entryW,
    windowW: BRAKING.windowW as unknown as readonly [number, number],
    lapW,
    tag,
  });
  return put(
    g,
    { node: search.out, pin: "out" },
    VICTIM.displacedBy,
    select(search.isVictim, tightIndex, attribute(VICTIM.displacedBy)),
    `${tag}Displace`,
  );
}

/** One placement, as the victim search reads and answers it. */
export interface VictimPlacement {
  /** Index into the pool, or `-1 - row` once L-2 has made it a marker. */
  readonly assetOrd: number;
  readonly station: number;
  readonly t: number;
}

/** What the convert-or-add decided, per placement of the input list. */
export interface CornerBookkeeping {
  /** Which corner converted placement `i`, or -1. Parallel to the input. */
  readonly claimedBy: readonly number[];
  /** Which tight corner displaced placement `i`, or -1. */
  readonly displacedBy: readonly number[];
  /** Corner indices whose marker found no victim and must be ADDED. */
  readonly added: readonly number[];
}

/** The columns {@link cookCornerBookkeeping} builds its cloud from. */
function bookkeepingCloud(placements: readonly VictimPlacement[]): Geometry {
  const geo = createPointCloud(placements.length);
  const ord = geo.attrs.point.add(VICTIM.assetOrd, "i32", 1);
  const st = geo.attrs.point.add(VICTIM.stationW, "f32", 1);
  const t = geo.attrs.point.add(VICTIM.t, "f32", 1);
  const claimed = geo.attrs.point.add(VICTIM.claimedBy, "i32", 1);
  const displaced = geo.attrs.point.add(VICTIM.displacedBy, "i32", 1);
  const P = geo.attrs.point.require("P");
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    ord.set(i, p.assetOrd);
    st.set(i, p.station);
    t.set(i, p.t);
    claimed.set(i, -1);
    displaced.set(i, -1);
    // POSITIONS ARE THE PLACEMENT'S OWN, so two placements at one station
    // on opposite sides are two points rather than one identity. Nothing
    // here draws a random number, so this is not the `randomField` rule --
    // it is that a cloud whose points coincide is a cloud whose points
    // cannot be told apart by anything downstream that ever might.
    P.setTuple(i, [p.station, 0, p.t]);
  }
  return geo;
}

/**
 * Run L-2's convert-or-add and L-3's displacement as a graph.
 *
 * WHAT THIS DECIDES AND WHAT IT DOES NOT. It answers, per placement,
 * which corner converted it and which tight corner's ruler displaced it,
 * and which corners found no victim and must have their marker ADDED
 * instead. It does not build the resulting list: `placeCornerLanguage`
 * still owns that, because the marker's own asset, lateral and height
 * come from the language cook and the ruler's three marks are exact
 * arithmetic that never needed porting.
 *
 * THE CORNERS COME IN COOKED. Their entries and sides are constants in
 * the graph this builds, which is what lets every stage be a whole-cloud
 * reduction rather than a join -- see `addConvertStage`. So a caller runs
 * `cookCorners` first, and this is the second cook, exactly as the
 * reservation is.
 */
export async function cookCornerBookkeeping(opts: {
  readonly placements: readonly VictimPlacement[];
  readonly corners: readonly Corner[];
  readonly lapW: number;
  readonly seed?: number;
}): Promise<CornerBookkeeping> {
  const { placements, corners, lapW } = opts;
  // AN EMPTY LAP IS ANSWERED WITHOUT COOKING, and it is a real answer
  // rather than a dodge: with nothing to convert every corner's marker is
  // ADDED, which is what `placeCornerLanguage` does when its victim
  // search finds nothing. The graph cannot say it -- the histogram groups
  // the placements into paths and `pathScan` refuses a cloud that has
  // none, correctly, because a scan over no path is a question with no
  // subject. Guarding here rather than teaching every stage to tolerate
  // an empty cloud keeps the emptiness in one place.
  if (placements.length === 0) {
    return { claimedBy: [], displacedBy: [], added: corners.map((_, ci) => ci) };
  }
  const g = new Graph(opts.seed ?? 1);
  const inCloud = g.add(dataInput, {}, "placements");
  g.setParam(inCloud, "items", [makeGeometryItem(bookkeepingCloud(placements))]);

  // L-2 FIRST, EVERY CORNER, THEN L-3. That order is
  // `placeCornerLanguage`'s and it is load-bearing: L-3's histogram sees
  // the markers L-2 made, so a ruler pays for itself out of a lap that
  // already speaks the corner language rather than one that is about to.
  let at: NodeHandle = inCloud;
  for (let ci = 0; ci < corners.length; ci++) {
    at = addConvertStage(g, { node: at, pin: "out" }, corners[ci], ci, lapW, "bk");
  }
  const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW);
  for (let ti = 0; ti < tight.length; ti++) {
    for (let k = 0; k < BRAKING.count; k++) {
      at = addDisplaceStage(g, { node: at, pin: "out" }, tight[ti], ti, k, lapW, "bk");
    }
  }
  g.output(at, "out", "placements");

  const cooked = await cook(g);
  const geo = (cooked.outputs.placements[0] as { geo: Geometry }).geo;
  const col = (name: string): number[] => {
    const c = geo.attrs.point.require(name);
    const out: number[] = [];
    for (let i = 0; i < geo.attrs.point.count; i++) out.push(c.get(i) as number);
    return out;
  };
  const claimedBy = col(VICTIM.claimedBy);
  const displacedBy = col(VICTIM.displacedBy);
  const converted = new Set(claimedBy.filter((v) => v >= 0));
  const added: number[] = [];
  for (let ci = 0; ci < corners.length; ci++) if (!converted.has(ci)) added.push(ci);
  return { claimedBy, displacedBy, added };
}
