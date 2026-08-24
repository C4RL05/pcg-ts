/**
 * The graph: a given spline in, a road and its dressing out.
 *
 * WHAT THIS GRAPH OWNS. The spline seam, the moving frame, the road
 * ribbon, and the CORNER MODEL — what any roadside rule has to be stated
 * against. Every one of them reads a REPORT off the resample rather than
 * a build-time constant, so nothing downstream has to be retyped when the
 * sampling changes.
 *
 * WHAT IT DOES NOT OWN. The placement rules. They run as plain TypeScript
 * over the cooked lap (`dress.ts`), reading the frame this graph writes.
 * A row of evenly spaced verge points used to stand here as a placeholder
 * for them; it outlived its purpose the moment the rules landed, and drew
 * placeholder nodes into the graph picture the page puts on screen.
 *
 * THE CORNER MODEL MOVED IN, and that is the first of those rules to
 * cross the line. It used to be a TypeScript pass over the cooked lap
 * that differenced the tangents a second time to get curvature, and
 * walked the frames a second time to find the runs. Both of those are
 * things the library already does — `writeCurveFrame` writes dT/ds from
 * the same central difference over the same arc tables it framed the
 * curve with, and `pathRuns` is a segmented scan that knows a closed
 * path's seam is not a run boundary. Stating the model here means it
 * cooks, caches, partitions and lowers with everything else, and means a
 * COOKED lap has one derivation of a corner rather than two that can
 * drift. `corners.ts` keeps a TypeScript statement of the same rule for
 * the laps that were never cooked — the synthetic ones its own suite is
 * built on — and its header argues why that one earns its keep.
 *
 * THE SPLINE ARRIVES AS DATA, not as a generated loop. `dataInput` is the
 * seam: the host builds the centreline (`spline.ts`), wraps it in a
 * geometry item, and binds it here. That is what makes this a technique
 * you can point at your own track rather than a picture of one.
 */
import {
  Graph,
  type NodeHandle,
  attribute,
  cross,
  dataInput,
  div,
  dot,
  length,
  lt,
  makeGeometryItem,
  mul,
  normalize,
  pathResample,
  pathRuns,
  promoteAttribute,
  setAttribute,
  sub,
  sweepProfile,
  vec,
  writeCurveFrame,
  createPolyline,
} from "pcg-ts";
// The threshold, not the model: `corners.ts` states what a corner IS —
// upstream's cut at R = 12W, with the argument for keeping a crude
// definition — and this graph is where that cut is applied. Importing it
// rather than restating the 12 is the point: a demo with the number
// written down twice is a demo where the boundary the runs are cut at and
// the boundary the rules filter on can quietly disagree. The dependency
// only runs this way; `corners.ts` imports nothing from here.
import { CORNER_R_W } from "./corners.js";
import type { Spline } from "./spline.js";

/** What the page can turn without rebuilding the graph's shape. */
export interface RoadOptions {
  /** The centreline the whole page is about. */
  readonly spline: Spline;
  /** Frames placed around the lap — the resolution every rule reads. */
  readonly frames?: number;
  /** Seed for anything random. Nothing uses it yet. */
  readonly seed?: number;
}

/** The named outputs a cook of this graph produces. */
export const OUTPUTS = {
  /**
   * The resampled centreline, carrying its moving frame and the corner
   * model built on it. Drawn as the spline.
   */
  frames: "frames",
  /** The road surface swept along it. */
  road: "road",
} as const;

/**
 * THE TRACK-RELATIVE FRAME, and the reason it is worth a named contract.
 *
 * A placement rule that says "a barrier 1.2 across, 30 apart" is a rule
 * about ONE track. Said in half-widths and arc length it is a rule about
 * every track, which is the whole reason a kit measured off one circuit
 * can dress a spline that circuit never had. So the centreline publishes
 * the coordinate system rather than leaving each rule to derive it, and
 * every consumer — the host's placement lookup in `lap.ts`, the rules in
 * `dress.ts`, and whatever reads the reference log — reads these four
 * columns instead of recomputing them from P and hoping.
 *
 * The axes are (across, along, up): across is RIGHT of travel, along is
 * the racing direction, up is the surface normal. `along` is not written
 * because `writeCurveFrame` already wrote it as `tangent` and a second
 * copy is a second thing to keep in step.
 *
 * `stationW` wraps at the lap length rather than normalising to 0..1: a
 * rule stating a spacing has to mean the same distance on a long lap and
 * a short one, and a fraction cannot say that.
 */
export const TRACK_FRAME = {
  /** Arc length from the start line, in half-widths. Wraps at the lap. */
  station: "stationW",
  /** The half-width itself, in world units — the scale everything divides by. */
  halfWidth: "halfWidth",
  /** Unit axis right of travel. */
  across: "across",
  /** Unit surface normal. */
  up: "up",
  /** Unit racing direction — written by `writeCurveFrame`, not by us. */
  along: "tangent",
} as const;

/**
 * THE CORNER MODEL, published as columns on the frames.
 *
 * L-2 marks every corner's ENTRY, L-3 puts a braking ruler before every
 * corner tighter than R = 8W, and L-6 may not begin enclosure inside one.
 * All three need the same few numbers per corner, and all three used to
 * get them from a TypeScript pass that re-differenced the tangents and
 * re-walked the lap. These columns are that pass, done by the library.
 *
 * WHY A RADIUS AND A SIGNED TURN AND NOT ONE CURVATURE COLUMN.
 * `writeCurveFrame` already writes the curvature VECTOR dT/ds, and both
 * of these are functions of it — but the two functions are the ones every
 * rule actually asks for, and one of them can only be answered here.
 * "How tight" is `1 / length(curvature)` over the half-width, which
 * anybody could take. "Which way" is that vector dotted with the axis you
 * mean by RIGHT, and the only place that axis exists is beside it in
 * `TRACK_FRAME.across`: a consumer left to pick its own right vector is a
 * consumer that can pick the mirrored one, which is the exact defect the
 * lateral axis had once.
 *
 * WHY THE RUNS ARE HERE TOO. A corner is a maximal run of frames under
 * the threshold, and the start/finish line is an arbitrary cut in a loop —
 * so a run that straddles it is ONE corner, and a scan that closes its
 * runs at the end of an array reports two, giving the second a false entry
 * at station zero that L-2 would then dutifully mark. `pathRuns` with
 * `wrap` is that rule, written once in the library instead of once per
 * demo, and it is the node whose own description names this case.
 */
export const CORNER_MODEL = {
  /** Local corner radius in half-widths. Infinite on a straight. */
  radius: "cornerRadiusW",
  /** Signed curvature in 1/W. Positive turns RIGHT, matching `across`. */
  turn: "cornerTurn",
  /** 1 where the frame is NOT in a corner — what delimits the runs. */
  straight: "cornerStraight",
  /** What the runs accumulate: [1 in a corner else 0, that frame's turn]. */
  run: "cornerRun",
  /** Forward run totals: [frames into this corner counting this one, turn so far]. */
  behind: "cornerBehind",
  /** Backward run totals: [frames left counting this one, turn remaining]. */
  ahead: "cornerAhead",
} as const;

/**
 * The horizontal axis across the road at each frame, pointing RIGHT of
 * travel.
 *
 * NOT `curveBinormal`. `writeCurveFrame` transports a rotation-minimizing
 * frame along the curve, which is the right thing for a tube and the
 * wrong thing for a road: it is free to roll, and a lap this long ends up
 * with its normal well off vertical, so anything placed on the binormal
 * drifts under the road and then over it. The tangent crossed with world
 * up is the axis a driver would call "across", and it is stable for as
 * long as the track is not vertical — which a racetrack is not.
 *
 * THE ORDER OF THE CROSS IS THE CONTRACT, not a preference. `cross(up,
 * tangent)` points LEFT of travel in a right-handed Y-up frame — check it
 * with tangent +Z and up +Y and you get +X, which is the driver's left.
 * The kit this demo is built to dress states `lateral` as positive to the
 * RIGHT of travel, so the operands are this way round and must stay this
 * way round. Getting it backwards mirrors every placement about the
 * centreline, which on a symmetric-looking lap is a silent failure: it
 * costs nothing to read and everything to notice.
 */
const ACROSS = normalize(cross(attribute("tangent", 3), vec(0, 1, 0)));

/**
 * Write the track frame onto a path.
 *
 * A FUNCTION OF A PATH, not a step in one pipeline, because
 * `pathResample` does not carry point attributes across: the moment a
 * rule resamples the centreline at its own spacing it has a path with a
 * `tangent` and a `curveU` and none of the frame. Re-deriving the axes
 * there by hand is how the two copies drift, so the derivation lives
 * here and every path that needs the frame calls this.
 *
 * The input must carry `curveU` and `tangent` (every `pathResample`
 * output does) and a PRIMITIVE `lapLen` — which is carried across a
 * resample in both directions, so one measurement at the top of the graph
 * reaches every path below it.
 */
function writeTrackFrame(g: Graph, path: NodeHandle, halfWidth: number, tag: string): NodeHandle {
  // The length report lands on the PRIMITIVE domain, being a fact about a
  // path; promoted so a per-point expression can divide by it.
  const lapLen = g.add(
    promoteAttribute,
    { name: "lapLen", from: "primitive", to: "point", mode: "average" },
    `${tag}_lapLen`,
  );
  g.connect(path, "out", lapLen, "in");

  const halfW = g.add(
    setAttribute,
    { name: TRACK_FRAME.halfWidth, tupleSize: 1, value: halfWidth },
    `${tag}_halfWidth`,
  );
  g.connect(lapLen, "out", halfW, "in");

  // Arc length in half-widths, from the MEASURED lap length rather than
  // from the frame count: `curveU` is the fraction of the path a sample
  // sits at and `lapLen` is what that path actually measures, so the
  // product is a distance whatever the resampling was asked for. Turning
  // the frame count no longer moves any station.
  const station = g.add(
    setAttribute,
    {
      name: TRACK_FRAME.station,
      tupleSize: 1,
      value: mul(attribute("curveU"), div(attribute("lapLen"), halfWidth)),
    },
    `${tag}_stationW`,
  );
  g.connect(halfW, "out", station, "in");

  const across = g.add(
    setAttribute,
    { name: TRACK_FRAME.across, tupleSize: 3, value: ACROSS },
    `${tag}_across`,
  );
  g.connect(station, "out", across, "in");

  // up = across x along, which CLOSES the frame rather than restating
  // world up: the three axes are then orthonormal by construction, and a
  // banked track only has to move `across` for the other two to follow.
  const up = g.add(
    setAttribute,
    {
      name: TRACK_FRAME.up,
      tupleSize: 3,
      value: normalize(cross(attribute(TRACK_FRAME.across, 3), attribute(TRACK_FRAME.along, 3))),
    },
    `${tag}_up`,
  );
  g.connect(across, "out", up, "in");
  return up;
}

/**
 * Write the corner model onto a framed path. See `CORNER_MODEL`.
 *
 * The input must carry `curvature` — the opt-in fourth column
 * `writeCurveFrame` writes — and the track frame's `across`. It must also
 * still BE a path: the two `pathRuns` walk the polyline, so anything that
 * drops topology has to come after this and not before it.
 */
function writeCornerModel(g: Graph, path: NodeHandle, halfWidth: number, tag: string): NodeHandle {
  // |dT/ds| is 1/R in world units, so the radius in half-widths is the
  // reciprocal of it times the half-width. A straight measures dT/ds
  // exactly zero and this divides by it deliberately: Infinity is the
  // honest answer and it compares correctly against every threshold
  // below, where a sentinel like -1 or 1e30 would have to be remembered
  // by each of them and would sort as the TIGHTEST corner on the lap if
  // one forgot.
  const radius = g.add(
    setAttribute,
    {
      name: CORNER_MODEL.radius,
      tupleSize: 1,
      value: div(1, mul(length(attribute("curvature", 3)), halfWidth)),
    },
    `${tag}_cornerRadius`,
  );
  g.connect(path, "out", radius, "in");

  // The curvature vector against the frame's own right axis, scaled to
  // 1/W so it is the reciprocal of the radius column and not of some
  // other unit. A right-hander reads POSITIVE — the centre of the turn is
  // to the right, dT/ds points at that centre, and `across` is right.
  const turn = g.add(
    setAttribute,
    {
      name: CORNER_MODEL.turn,
      tupleSize: 1,
      value: mul(dot(attribute("curvature", 3), attribute(TRACK_FRAME.across, 3)), halfWidth),
    },
    `${tag}_cornerTurn`,
  );
  g.connect(radius, "out", turn, "in");

  // "Not under the threshold" — 1 exactly where the frame is NOT in a
  // corner. A straight's Infinity is above every threshold and lands
  // here, which is the whole point of leaving it infinite.
  //
  // WRITTEN AS `1 - lt` RATHER THAN `ge` OR `step`, and the difference is
  // NaN. Both of those answer 0 for a NaN, because every comparison with
  // one is false — so an unmeasurable frame would come out flagged as a
  // CORNER, entering at a station nothing chose, and L-2 would dutifully
  // mark it. Negating the strict less-than puts NaN on the straight side
  // instead, which is where a measurement that failed belongs and what
  // the reader in `corners.ts` does with the same column.
  //
  // It is a column of its own rather than an expression used twice
  // because `pathRuns` needs the flag as an attribute anyway, and one
  // column is one place for "is this a corner" to be answered.
  const straight = g.add(
    setAttribute,
    {
      name: CORNER_MODEL.straight,
      tupleSize: 1,
      value: sub(1, lt(attribute(CORNER_MODEL.radius), CORNER_R_W)),
    },
    `${tag}_cornerStraight`,
  );
  g.connect(turn, "out", straight, "in");

  // What the runs carry, as one tuple so ONE segmented scan answers both
  // questions and the two answers cannot come from different runs: a
  // count, and the signed turn. Both are MASKED to zero outside a corner,
  // which is what lets the scan run inclusively — a straight frame opens
  // its own run, contributes nothing to it, and so reads zero, leaving a
  // count of 1 to mean "the first frame of a corner" and nothing else.
  const inCorner = sub(1, attribute(CORNER_MODEL.straight));
  const run = g.add(
    setAttribute,
    {
      name: CORNER_MODEL.run,
      tupleSize: 2,
      value: vec(inCorner, mul(inCorner, attribute(CORNER_MODEL.turn))),
    },
    `${tag}_cornerRun`,
  );
  g.connect(straight, "out", run, "in");

  // Forward: how far INTO its corner each frame is. A frame reading 1 is
  // an entry, and it is the only thing that reads 1, which is what makes
  // finding the corners a filter rather than a scan with state.
  const behind = g.add(
    pathRuns,
    {
      name: CORNER_MODEL.run,
      boundary: CORNER_MODEL.straight,
      outName: CORNER_MODEL.behind,
      mode: "inclusive",
      direction: "forward",
      wrap: true,
    },
    `${tag}_cornerBehind`,
  );
  g.connect(run, "out", behind, "in");

  // Backward: how much of its corner is still AHEAD of each frame. At an
  // entry that is the whole corner — its length in frames and its total
  // turn — so the run's extent and which way it turns are both read off
  // the entry frame itself. The turn is summed over the WHOLE run rather
  // than taken at the entry because the frames near the threshold are
  // where the sign is noise; the deep middle of the corner outvotes them.
  //
  // `wrap` on both, and it is not decoration. It rotates the walk onto
  // the first straight frame, so the corner that straddles the start line
  // is one run with one entry. Off, it would be two corners on roughly
  // one lap in `corners`, and the invented one would enter at station
  // zero.
  const ahead = g.add(
    pathRuns,
    {
      name: CORNER_MODEL.run,
      boundary: CORNER_MODEL.straight,
      outName: CORNER_MODEL.ahead,
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_cornerAhead`,
  );
  g.connect(behind, "out", ahead, "in");
  return ahead;
}

/** Build the graph, with the host's spline already bound into it. */
export function buildRoadGraph(opts: RoadOptions): Graph {
  const { spline } = opts;
  const frameCount = opts.frames ?? 900;
  const g = new Graph(opts.seed ?? 1);

  // THE SEAM. The centreline is the caller's, handed in whole.
  const splineIn = g.add(dataInput, {}, "spline");
  g.setParam(splineIn, "items", [
    makeGeometryItem(createPolyline(spline.positions, { closed: spline.closed })),
  ]);

  // Both REPORTS are asked for, and they are what makes this a tool
  // rather than a rendering: `lapLen` is how long the lap actually is and
  // `stepLen` is how far apart the frames landed. Anything sized in units
  // of the sampling reads those instead of restating the count.
  const centre = g.add(
    pathResample,
    { mode: "count", count: frameCount, lengthAttr: "lapLen", stepAttr: "stepLen" },
    "centre",
  );
  g.connect(splineIn, "out", centre, "in");

  const frames = g.add(writeCurveFrame, { curvatureName: "curvature" }, "frames");
  g.connect(centre, "out", frames, "in");

  // `stepLen` promoted here; `lapLen` is promoted inside writeTrackFrame,
  // which needs it to divide by. Both land on the PRIMITIVE domain first,
  // being facts about a path.
  const stepLen = g.add(
    promoteAttribute,
    { name: "stepLen", from: "primitive", to: "point", mode: "average" },
    "stepLenPt",
  );
  g.connect(frames, "out", stepLen, "in");

  // The coordinate system every rule is stated in. See TRACK_FRAME.
  const up = writeTrackFrame(g, stepLen, spline.halfWidth, "centre");

  // The corner model hangs off the frame as a BRANCH rather than sitting
  // in front of the sweep, and that is deliberate on both counts. The
  // road is a ribbon of the centreline and nothing about it depends on
  // where the corners are, so putting six attribute nodes between the two
  // would carry six columns onto every vertex of the road surface to be
  // read by nobody. Branching also draws the picture the page shows the
  // way the thing actually is: one frame, two things made from it.
  const corners = writeCornerModel(g, up, spline.halfWidth, "centre");

  // The road. `frame: "upHint"` with world up rather than `curveFrame`,
  // for the reason ACROSS is what it is: a rotation-minimizing frame
  // banks a road wherever the curve happens to twist, and given a long
  // enough circuit stands it on edge.
  // `up: attribute(...)` rather than a literal [0, 1, 0]: the ribbon now
  // banks on the SAME surface normal the placements are hung off, so
  // "above the road" means one thing on this page. A literal here is how
  // a road and the things beside it end up disagreeing about which way is
  // up on a banked corner.
  const road = g.add(
    sweepProfile,
    {
      profile: "ribbon",
      width: 2 * spline.halfWidth,
      frame: "upHint",
      up: attribute(TRACK_FRAME.up, 3),
    },
    "road",
  );
  g.connect(up, "out", road, "in");

  g.output(corners, "out", OUTPUTS.frames);
  g.output(road, "out", OUTPUTS.road);
  return g;
}
