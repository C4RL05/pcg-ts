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
 * be, and is deliberately the one part written to be thrown away once a
 * rule has an opinion about where things go.
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
  /** Prop stations per lap, per side. A flat count: nothing varies it yet. */
  readonly propStations?: number;
  /** Gap between the road edge and the first row of dressing, in world units. */
  readonly verge?: number;
  /** Seed for anything random. Nothing uses it yet. */
  readonly seed?: number;
}

/** The named outputs a cook of this graph produces. */
export const OUTPUTS = {
  /** The resampled centreline, carrying its moving frame. Drawn as the spline. */
  frames: "frames",
  /** The road surface swept along it. */
  road: "road",
  /** Roadside dressing — points today, instances once a rule picks what stands. */
  props: "props",
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
 * The vocabulary the dressing rules read states `lateral` as positive to
 * the RIGHT of travel, so the operands are this way round and must stay
 * this way round. Getting it backwards mirrors every placement about the
 * centreline, which on a symmetric-looking lap is a silent failure: it
 * costs nothing to read and everything to notice.
 */
const ACROSS = normalize(cross(attribute("tangent", 3), vec(0, 1, 0)));

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
  opts: { stations: number; offset: number },
): NodeHandle {
  // 'count' rather than 'spacing': a closed path resampled by spacing
  // closes on a REMAINDER segment, and a remainder at the start line is a
  // visible double-up in every one of this page's passes.
  const row = g.add(pathResample, { mode: "count", count: opts.stations }, "propRow");
  g.connect(frames, "out", row, "in");

  // The sign IS the vocabulary's `lateral`: positive is right of travel, because
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
        value: add(position(), mul(sign * opts.offset, ACROSS)),
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
  const verge = opts.verge ?? 3;
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

  // The two reports land on the PRIMITIVE domain, being facts about a
  // path; promoted here so a per-point rule can read them without a
  // second lookup.
  const lapLen = g.add(
    promoteAttribute,
    { name: "lapLen", from: "primitive", to: "point", mode: "average" },
    "lapLenPt",
  );
  g.connect(frames, "out", lapLen, "in");
  const stepLen = g.add(
    promoteAttribute,
    { name: "stepLen", from: "primitive", to: "point", mode: "average" },
    "stepLenPt",
  );
  g.connect(lapLen, "out", stepLen, "in");

  // The road. `frame: "upHint"` with world up rather than `curveFrame`,
  // for the reason ACROSS is what it is: a rotation-minimizing frame
  // banks a road wherever the curve happens to twist, and given a long
  // enough circuit stands it on edge.
  const road = g.add(
    sweepProfile,
    { profile: "ribbon", width: 2 * spline.halfWidth, frame: "upHint", up: [0, 1, 0] },
    "road",
  );
  g.connect(stepLen, "out", road, "in");

  const props = dressVerges(g, stepLen, {
    stations,
    offset: spline.halfWidth + verge,
  });

  g.output(stepLen, "out", OUTPUTS.frames);
  g.output(road, "out", OUTPUTS.road);
  g.output(props, "out", OUTPUTS.props);
  return g;
}
