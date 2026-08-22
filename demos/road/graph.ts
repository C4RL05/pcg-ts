/**
 * The graph: a given spline in, a road and its dressing out.
 *
 * WHAT IS SCAFFOLD AND WHAT IS NOT. The spline seam, the moving frame,
 * the road ribbon and the verge geometry are settled — they are what any
 * roadside rule has to be stated against, and every one of them reads a
 * REPORT off the resample rather than a build-time constant, so nothing
 * downstream has to be retyped when the sampling changes. The PLACEMENT
 * RULES are not settled: `dressVerges` below places one row per side at
 * an even spacing, which is the least interesting thing a roadside can
 * be, and is deliberately the one part written to be thrown away when the
 * spec lands.
 *
 * THE SPLINE ARRIVES AS DATA, not as a generated loop. `dataInput` is the
 * seam: the host builds the centreline (`spline.ts`), wraps it in a
 * geometry item, and binds it here. That is what makes this a technique
 * you can point at your own track rather than a picture of one.
 */
import {
  Graph,
  type NodeHandle,
  add,
  attribute,
  cross,
  dataInput,
  div,
  makeGeometryItem,
  mergePoints,
  mul,
  normalize,
  pathResample,
  position,
  promoteAttribute,
  setAttribute,
  sweepProfile,
  vec,
  writeCurveFrame,
  createPolyline,
} from "pcg-ts";
import type { Spline } from "./spline.js";

/** What the page can turn without rebuilding the graph's shape. */
export interface RoadOptions {
  /** The centreline the whole page is about. */
  readonly spline: Spline;
  /** Frames placed around the lap — the resolution every rule reads. */
  readonly frames?: number;
  /** Prop stations per lap, per side. Placeholder until the spec lands. */
  readonly propStations?: number;
  /**
   * Gap between the road edge and the first row of dressing, in HALF-WIDTHS.
   *
   * W, not world units, because that is the unit the kit's placement rules
   * are written in — see {@link TRACK_FRAME}. A demo knob stated in metres
   * would be the one quantity on the page that does not transfer to another
   * spline.
   */
  readonly vergeW?: number;
  /** Seed for anything random. Nothing uses it yet. */
  readonly seed?: number;
}

/** The named outputs a cook of this graph produces. */
export const OUTPUTS = {
  /** The resampled centreline, carrying its moving frame. Drawn as the spline. */
  frames: "frames",
  /** The road surface swept along it. */
  road: "road",
  /** Roadside dressing — points today, instances once the spec lands. */
  props: "props",
} as const;

/**
 * THE TRACK-RELATIVE FRAME, and the reason it is worth a named contract.
 *
 * A placement rule that says "a barrier 1.2 across, 30 apart" is a rule
 * about ONE track. Said in half-widths and arc length it is a rule about
 * every track, which is the whole reason a kit measured off one circuit
 * can dress a spline that circuit never had. So the centreline publishes
 * the coordinate system rather than leaving each rule to derive it, and
 * every consumer — the verge placeholder here, the host's placement
 * lookup in `lap.ts`, and whatever reads the reference log — reads these
 * four columns instead of recomputing them from P and hoping.
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
 * One row of dressing down one side of the road.
 *
 * PLACEHOLDER. Even spacing at a fixed offset is what you get before any
 * rule has an opinion — no reaction to corners, no variety, no clearance
 * check. It exists so the page has something to draw on the verge and so
 * the seam between "where the road is" and "what stands beside it" is
 * already cut when the real rules arrive.
 */
function dressVerges(
  g: Graph,
  frames: NodeHandle,
  opts: { stations: number; offset: number; halfWidth: number },
): NodeHandle {
  // 'count' rather than 'spacing': a closed path resampled by spacing
  // closes on a REMAINDER segment, and a remainder at the start line is a
  // visible double-up in every one of this page's passes.
  const resampled = g.add(pathResample, { mode: "count", count: opts.stations }, "propRow");
  g.connect(frames, "out", resampled, "in");
  // The row is a NEW path and carries none of the centreline's point
  // attributes, so it gets the frame written onto it rather than
  // inheriting one it cannot have.
  const row = writeTrackFrame(g, resampled, opts.halfWidth, "prop");

  // The sign IS the kit's `lateral`: positive is right of travel, because
  // ACROSS points right. `side` is written with that sign rather than a
  // left/right word, so the placeholder already speaks the coordinate the
  // real rules are stated in.
  const sides: NodeHandle[] = [];
  for (const [name, sign] of [
    ["right", 1],
    ["left", -1],
  ] as const) {
    const moved = g.add(
      setAttribute,
      {
        name: "P",
        tupleSize: 3,
        // The PUBLISHED axis, not `ACROSS` again: one definition of
        // "right of travel" for the road, the verges and the host, so
        // they cannot drift apart in the way a mirrored axis already
        // proved they can.
        value: add(position(), mul(sign * opts.offset, attribute(TRACK_FRAME.across, 3))),
      },
      `prop_${name}_P`,
    );
    g.connect(row, "out", moved, "in");
    // Which side a prop is on is a fact a rule will want to read (a sign
    // that flips with the camera, a barrier that only faces the track),
    // so it is written now rather than re-derived from the position.
    const tagged = g.add(
      setAttribute,
      { name: "side", tupleSize: 1, value: sign },
      `prop_${name}_side`,
    );
    g.connect(moved, "out", tagged, "in");
    sides.push(tagged);
  }

  // `mergePoints` drops topology, which is correct here and worth saying
  // out loud: these stop being a path the moment they are merged, and
  // anything wanting per-side path order has to branch above this node.
  const both = g.add(mergePoints, {}, "props");
  for (const s of sides) g.connect(s, "out", both, "in");
  return both;
}

/** Build the graph, with the host's spline already bound into it. */
export function buildRoadGraph(opts: RoadOptions): Graph {
  const { spline } = opts;
  const frameCount = opts.frames ?? 900;
  const stations = opts.propStations ?? 260;
  const vergeW = opts.vergeW ?? 0.35;
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

  // Stated in W and converted once, here, at the edge of the graph: the
  // rule is "one half-width to the road edge, plus the verge".
  const props = dressVerges(g, up, {
    stations,
    offset: (1 + vergeW) * spline.halfWidth,
    halfWidth: spline.halfWidth,
  });

  g.output(up, "out", OUTPUTS.frames);
  g.output(road, "out", OUTPUTS.road);
  g.output(props, "out", OUTPUTS.props);
  return g;
}
