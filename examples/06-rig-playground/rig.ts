/**
 * The rig graph: a box truss along a spline, component parts scattered
 * over it, chains holding it up and cables hanging off it.
 *
 * Kept apart from main.ts so the GENERATION reads on its own — the host
 * owns the renderer and the asset shapes and has nothing to say about
 * where anything goes.
 *
 * Two rules from the library shape most of the ordering below:
 *
 * - Polyline topology is fragile. Every node that can REMOVE points
 *   rebuilds the point domain and drops the primitives with it
 *   (filterBy*, selfPrune, mergePoints, partitionByAttribute). So each
 *   branch filters first and builds its path last.
 * - A curve cannot be drawn. There is no sweep or extrude in the
 *   library, so anything solid — the spine, every cable — ends at
 *   pathSegments, which emits one oriented instance point per segment
 *   for a unit cylinder to land on.
 */
import {
  Graph,
  add,
  attribute,
  component,
  cook,
  copyToPoints,
  connectPoints,
  cos,
  div,
  fbm,
  filterByAttribute,
  filterByDensity,
  firstGeometry,
  forEachNode,
  floor,
  fraction,
  hashCombine,
  hashFloat,
  index,
  jitterPoints,
  lerp,
  mergePoints,
  mul,
  orientAlongVector,
  partitionByAttribute,
  pathPointAt,
  pathResample,
  pathSegments,
  perlinNoise,
  pointLine,
  position,
  pointsToPath,
  randomField,
  setAttribute,
  sin,
  spawnInstances,
  sub,
  transferAttribute,
  transformPoints,
  vec,
  writeCurveFrame,
  type FieldLike,
  type InstanceBatch,
  type InstancesItem,
} from "pcg-ts";

/** A node added to a graph — the handle the branch builders pass around. */
type NodeRef = ReturnType<Graph["add"]>;

/** Which component shapes exist, and the asset id each spawns. */
export const PART_KINDS = ["rod", "bar", "panel", "clamp"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/**
 * Everything the panel can turn.
 *
 * Every noise in here is exposed as the same three knobs — frequency,
 * octaves, variant — because that is the shape the library's own
 * primitives use. `variant` matters more than it looks: noise is a pure
 * function of its OWN seed and the sample position, and the graph seed
 * does not move it, so two rigs with different graph seeds would wander
 * along identical noise unless something salts it. Variant is that salt,
 * and it is what re-rolls a shape while every other number stays put.
 */
export interface RigParams {
  seed: number;
  // spine
  span: number;
  height: number;
  /** Vertical amplitude of the wander, in metres. */
  wanderV: number;
  /** Horizontal amplitude of the wander, in metres. */
  wanderH: number;
  wanderFreq: number;
  wanderOctaves: number;
  wanderVariant: number;
  spineSamples: number;
  // truss — the spine is a box truss, not a pipe
  /** Side of the square section, in metres. */
  trussWidth: number;
  /** Bays along the spine. One station per bay boundary. */
  trussStations: number;
  /** Tube radius of the four corner chords. */
  trussChord: number;
  /** Tube radius of the diagonal bracing — thinner than the chords. */
  trussBrace: number;
  /** Square cross-section frames every N bays. 0 leaves them out. */
  trussFrameEvery: number;
  // components
  weights: Record<PartKind, number>;
  partDensity: number;
  clusterFreq: number;
  clusterOctaves: number;
  clusterVariant: number;
  clusterThreshold: number;
  /**
   * How much of the full turn around the spine the components fan
   * across. 0 puts them all on one side, 1 is a complete fan.
   */
  radialSpread: number;
  /** Scatter off the even resample, as a fraction of the sample spacing. */
  scatterJitter: number;
  /**
   * How far out toward a chord each component is mounted, as a fraction
   * of the corner radius. 0 leaves everything on the truss axis.
   */
  partMount: number;
  partSize: number;
  sizeJitter: number;
  // suspension
  /** Chains from the ceiling down to the spine. 0 leaves it floating. */
  chainCount: number;
  /** Height the chains rise to, in metres. */
  ceilingHeight: number;
  /** Links per chain. Each link is sized to its own segment, so this
   *  sets how fine the chain is rather than how long. */
  chainLinks: number;
  // cables wrapped around the truss
  /** How many cables snake along the truss. 0 leaves it bare. */
  wrapCount: number;
  /** Points along one wrap. A spiral with too few reads as a polygon. */
  wrapSegments: number;
  /** Radius of the tightest wrap, as a multiple of the corner radius. */
  wrapRadius: number;
  /** How much looser the loosest wrap is than the tightest. */
  wrapSlack: number;
  /** Fewest and most turns a wrap makes over the whole run. */
  wrapTurnsMin: number;
  wrapTurnsMax: number;
  /** Noise pushed into the radius, in metres. This is the mess. */
  wrapWobble: number;
  wrapVariant: number;
  // cables
  danglerCount: number;
  /**
   * How far the anchors slide toward their bundle's centre. 0 is a
   * regular fringe; 1 collapses each bundle onto a single point. Nothing
   * is removed, so the cable count is exactly `danglerCount` throughout.
   */
  danglerBundle: number;
  /** How many bundles along the curve. */
  danglerBundleFreq: number;
  danglerLength: number;
  /** Segments down one dangler. More is a smoother curl, more instances. */
  danglerSegments: number;
  /** How short the shortest dangler is, as a fraction of the longest. */
  dropVariation: number;
  danglerCurl: number;
  curlFreq: number;
  curlOctaves: number;
  curlVariant: number;
  drapeCount: number;
  /** How the chords are chosen: "radius" or "relativeNeighborhood". */
  drapeMode: string;
  drapeReach: number;
  /** Chords shorter than this are dropped entirely, in metres. */
  drapeMinLength: number;
  /**
   * Fraction of the surviving chords actually hung, chosen per chord.
   * 1 hangs every candidate, which is what makes a lattice; below that
   * the same chords become an irregular scatter of swags.
   */
  drapeKeep: number;
  drapeSlack: number;
  /** Segments across one drape. Too few and the sag reads as a tent. */
  drapeSegments: number;
  /** How much the sag varies from chord to chord. */
  slackJitter: number;
  cableRadius: number;
}

export const DEFAULT_PARAMS: RigParams = {
  seed: 3,
  span: 34,
  height: 7,
  wanderV: 1.2,
  wanderH: 2.4,
  wanderFreq: 0.035,
  wanderOctaves: 3,
  wanderVariant: 0,
  spineSamples: 130,
  trussWidth: 0.85,
  trussStations: 46,
  trussChord: 0.055,
  trussBrace: 0.03,
  trussFrameEvery: 4,
  weights: { rod: 4, bar: 2, panel: 1, clamp: 2 },
  partDensity: 900,
  clusterFreq: 14,
  clusterOctaves: 2,
  clusterVariant: 0,
  clusterThreshold: 0.46,
  radialSpread: 1,
  scatterJitter: 0.5,
  partMount: 1,
  partSize: 1,
  sizeJitter: 0.45,
  chainCount: 7,
  ceilingHeight: 13,
  chainLinks: 34,
  wrapCount: 16,
  wrapSegments: 150,
  wrapRadius: 1.1,
  wrapSlack: 0.55,
  wrapTurnsMin: 0.4,
  wrapTurnsMax: 3.5,
  wrapWobble: 0.14,
  wrapVariant: 0,
  danglerCount: 200,
  danglerBundle: 0.8,
  danglerBundleFreq: 7,
  danglerLength: 3.2,
  danglerSegments: 16,
  dropVariation: 0.45,
  danglerCurl: 0.5,
  curlFreq: 0.5,
  curlOctaves: 2,
  curlVariant: 0,
  drapeCount: 34,
  drapeMode: "radius",
  drapeReach: 20,
  drapeMinLength: 4,
  drapeKeep: 0.16,
  drapeSlack: 0.45,
  drapeSegments: 22,
  slackJitter: 0.8,
  cableRadius: 0.035,
};

/**
 * The seed for one named noise. Salted by both the rig seed and the
 * noise's own variant, so the seed field re-rolls everything at once and
 * a variant re-rolls exactly one shape.
 */
function noiseSeed(params: RigParams, salt: number, variant: number): number {
  return hashCombine(params.seed, hashCombine(salt, Math.round(variant)));
}

/**
 * Distance from the truss axis out to a chord. The corners sit at 45,
 * 135, 225 and 315 degrees, so it is half the DIAGONAL of the section
 * and not half the side. Shared, because the truss and anything mounted
 * to it disagreeing by a hair puts every fixture inside the tube.
 */
function trussCornerRadius(params: RigParams): number {
  return (params.trussWidth / 2) * Math.SQRT2;
}

/** Corners the wander is built from, before the arc-length evening. */
const SPINE_CORNERS = 97;

/**
 * The `values` list for the part selector, weighted BY REPETITION —
 * that is how the library's string setAttribute expresses a
 * distribution, and it is why the weights are integers. An all-zero set
 * would leave the list empty, which makes the attribute a constant empty
 * string and every point fall back to the spawner's own assetId, so it
 * is guarded here rather than in the panel.
 */
export function partValues(weights: Record<PartKind, number>): string[] {
  const values: string[] = [];
  for (const kind of PART_KINDS) {
    const n = Math.max(0, Math.round(weights[kind]));
    for (let i = 0; i < n; i++) values.push(kind);
  }
  return values;
}

/** True when the component branch would draw nothing. */
export function noPartsEnabled(weights: Record<PartKind, number>): boolean {
  return partValues(weights).length === 0;
}

/** Build the whole rig. Returned uncooked so params can be set live. */
export function buildRigGraph(params: RigParams): Graph {
  const graph = new Graph(params.seed);
  const half = params.span / 2;

  // -- spine ----------------------------------------------------------
  // A straight line pushed off itself by two independent noise fields,
  // one for the rise and fall and one for the side-to-side. Both read
  // world position, so the wander has a wavelength in metres rather
  // than a wavelength per point.
  const line = graph.add(pointLine, {
    count: SPINE_CORNERS,
    start: [-half, params.height, 0],
    end: [half, params.height, 0],
    includeEnd: true,
  }, "spineLine");
  const wanderOpts = {
    frequency: params.wanderFreq,
    octaves: Math.max(1, Math.round(params.wanderOctaves)),
  };
  const wander = graph.add(transformPoints, {
    translate: vec(
      0,
      // Two SEPARATE noises rather than two axes of one: a single field
      // would make the rise and the sideways swing the same curve, and
      // the spine would travel on a diagonal plane instead of snaking.
      mul(
        params.wanderV,
        fbm(perlinNoise, {
          ...wanderOpts,
          seed: noiseSeed(params, 11, params.wanderVariant),
        }),
      ),
      mul(
        params.wanderH,
        fbm(perlinNoise, {
          ...wanderOpts,
          seed: noiseSeed(params, 29, params.wanderVariant),
        }),
      ),
    ),
  }, "spineWander");
  const spinePath = graph.add(pointsToPath, { closed: false }, "spineSpinePath");
  // Displacing a line sideways stretches its segments where the wander
  // is steep, so the spacing is evened out again before anything is
  // placed along it — otherwise everything bunches on the straight runs.
  const spine = graph.add(pathResample, { mode: "count", count: params.spineSamples }, "spineSpine");
  graph.connect(line, "out", wander, "in");
  graph.connect(wander, "out", spinePath, "in");
  graph.connect(spinePath, "out", spine, "in");
  buildTruss(graph, params, spine);

  // -- components -----------------------------------------------------
  // Dense even samples, thinned by a noise field read along the curve
  // parameter so the survivors arrive in clusters rather than evenly.
  const dense = graph.add(pathResample, { mode: "count", count: params.partDensity }, "partDense");
  // The frame goes AFTER the dense resample, not before: pathResample
  // builds new points and does not carry the input's POINT attributes,
  // so a frame written upstream would be dropped right here. It has to
  // be computed on the points that survive to the end.
  const frame = graph.add(writeCurveFrame, {}, "partFrame");
  const density = graph.add(setAttribute, {
    name: "density",
    domain: "point",
    type: "f32",
    tupleSize: 1,
    // 1D noise ALONG the curve: position is the curve parameter, so the
    // clusters follow the spine rather than the world axes, and they
    // stay put when the spine wanders somewhere else.
    value: fbm(perlinNoise, {
      seed: noiseSeed(params, 47, params.clusterVariant),
      frequency: params.clusterFreq,
      octaves: Math.max(1, Math.round(params.clusterOctaves)),
      normalized: true,
      position: vec(attribute("curveU", 1), 0, 0),
    }),
  }, "partDensity");
  const cluster = graph.add(filterByDensity, {
    mode: "threshold",
    threshold: params.clusterThreshold,
  }, "partCluster");
  // Thresholding an EVEN resample leaves the survivors on a regular
  // lattice, which reads as a comb rather than a cluster. The jitter is
  // about half the sample spacing.
  const spacing = params.span / Math.max(1, params.partDensity);
  const jitter = spacing * params.scatterJitter;
  const scatter = graph.add(jitterPoints, {
    amount: [jitter, jitter, jitter],
    // jitterPoints keys its draw on point IDENTITY (position bits plus
    // the seed attribute), not the index, so this seed is what re-rolls
    // the scatter without moving anything else.
    seed: hashCombine(5, Math.round(params.clusterVariant)),
  }, "partScatter");
  // Which shape each point spawns. The selector is floored and clamped
  // into the values list, so a 0..1 random scaled by the list length
  // picks one entry, and repeated entries are simply more likely.
  const values = partValues(params.weights);
  const part = graph.add(setAttribute, {
    name: "part",
    domain: "point",
    type: "string",
    values: values.length > 0 ? values : ["rod"],
    value: mul(randomField("part"), Math.max(1, values.length)),
  }, "partPart");
  // Local +Z runs along the spine, so a Z-long bar or collar lies along
  // it and a Y-long rod sticks out sideways. WHICH sideways is the roll,
  // and for axis ±z the roll is exactly what the `up` hint sets — so
  // aiming the fan needs no change to the direction at all, only a
  // per-point up spun around the curve's own frame.
  //
  // cos(a) * curveNormal + sin(a) * curveBinormal is the unit vector at
  // angle `a` in the plane perpendicular to the tangent. A constant
  // world up cannot express it, which is the whole reason `up` is
  // field-capable and writeCurveFrame exists.
  // The fan angle is STORED before anything moves, and read back from
  // the attribute afterwards. randomField keys on point IDENTITY — the
  // stored position bits together with the seed — so drawing it a second
  // time AFTER the mount below has moved the point yields a DIFFERENT
  // number, and the chord a fixture sits on would disagree with the way
  // it points. One draw, one column, read twice.
  const angleAttr = graph.add(setAttribute, {
    name: "radialAngle",
    domain: "point",
    type: "f32",
    tupleSize: 1,
    value: mul(randomField("radial"), Math.PI * 2 * params.radialSpread),
  }, "partAngleAttr");
  const angle = attribute("radialAngle", 1);

  // Mount to the nearest CHORD rather than to the axis: snap the fan
  // angle to the closest corner and step out there. The fixture still
  // points along its own fan angle, so it fans as before — it just
  // leaves from the tube it would really be clamped to.
  const mount = graph.add(transformPoints, {
    translate: (() => {
      const reach = trussCornerRadius(params) * params.partMount;
      // round(x) as floor(x + 0.5); the corners are a quarter turn apart
      // starting at an eighth.
      const k = floor(add(div(sub(angle, Math.PI / 4), Math.PI / 2), 0.5));
      const corner = add(mul(Math.PI / 2, k), Math.PI / 4);
      return add(
        mul(mul(reach, cos(corner)), attribute("curveNormal", 3)),
        mul(mul(reach, sin(corner)), attribute("curveBinormal", 3)),
      );
    })(),
  }, "partMount");

  const orient = graph.add(orientAlongVector, {
    direction: attribute("tangent", 3),
    up: add(
      mul(cos(angle), attribute("curveNormal", 3)),
      mul(sin(angle), attribute("curveBinormal", 3)),
    ),
    axis: "+z",
  }, "partOrient");
  const size = graph.add(setAttribute, {
    name: "scale",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: (() => {
      const s = mul(
        params.partSize,
        lerp(1 - params.sizeJitter, 1 + params.sizeJitter, randomField("size")),
      );
      return vec(s, s, s);
    })(),
  }, "partSize");
  const partSpawn = graph.add(spawnInstances, { assetId: "rod", assetAttr: "part" }, "partPartSpawn");
  graph.connect(spine, "out", dense, "in");
  graph.connect(dense, "out", frame, "in");
  graph.connect(frame, "out", density, "in");
  graph.connect(density, "out", cluster, "in");
  graph.connect(cluster, "out", scatter, "in");
  graph.connect(scatter, "out", angleAttr, "in");
  graph.connect(angleAttr, "out", mount, "in");
  graph.connect(mount, "out", part, "in");
  graph.connect(part, "out", orient, "in");
  graph.connect(orient, "out", size, "in");
  graph.connect(size, "out", partSpawn, "in");
  graph.output(partSpawn, "instances", "parts");

  // -- hanging cables, kind 1: danglers -------------------------------
  // Skipped entirely below 2 anchors rather than clamped: pathResample
  // needs at least 2 samples to still be a path and throws otherwise, so
  // "0 danglers" has to mean no branch, not a branch with 0 in it. The
  // output simply is not declared, and cookRig tolerates that.
  if (params.wrapCount >= 1) buildWraps(graph, params, spine);
  if (params.chainCount >= 2) buildChains(graph, params, spine);
  if (params.danglerCount >= 2) buildDanglers(graph, params, spine);
  if (params.drapeCount >= 3) buildDrapes(graph, params, spine);

  // The spine points, for the stats line.
  graph.output(spine, "out", "spinePoints");
  return graph;
}

/**
 * The spine as a BOX TRUSS rather than a pipe: four chords running
 * parallel to the curve at the corners of a square section, with thinner
 * diagonal bracing zigzagging across each of the four faces so every bay
 * is triangulated.
 *
 * Every member is the same one move — take the framed spine and push it
 * sideways by `h * (cos a * curveNormal + sin a * curveBinormal)`, the
 * unit vector at angle `a` in the plane perpendicular to the tangent.
 * transformPoints preserves topology, so a displaced path is still a
 * path and goes straight to pathSegments. This is the whole reason the
 * frame exists: without a normal carried ALONG the curve there is no
 * stable "corner 1" to run a chord down, and the section would spin.
 *
 * A chord holds its angle; a brace alternates between two adjacent
 * corners as it advances, which is what makes the triangles. That
 * alternation is station parity, and because parity is 0 or 1 the two
 * angles can be reached by lerping their cosines and sines rather than
 * by evaluating trigonometry per point.
 */
function buildTruss(graph: Graph, params: RigParams, spine: NodeRef): void {
  const stations = Math.max(2, Math.round(params.trussStations));
  // Corners sit at 45, 135, 225 and 315 degrees, so the distance from
  // the axis is half the DIAGONAL, not half the side.
  const h = trussCornerRadius(params);
  const cells = graph.add(pathResample, { mode: "count", count: stations }, "trussCells");
  const frame = graph.add(writeCurveFrame, {}, "trussFrame");
  graph.connect(spine, "out", cells, "in");
  graph.connect(cells, "out", frame, "in");

  const N = attribute("curveNormal", 3);
  const B = attribute("curveBinormal", 3);
  /** Station index parity, without a modulo combinator. */
  const parity = (() => {
    const i = index();
    return sub(i, mul(2, floor(div(i, 2))));
  })();

  /** One member: displace the framed spine, then make it solid. */
  let members = 0;
  const member = (translate: FieldLike, radius: number, into: NodeRef): NodeRef => {
    const n = members++;
    const move = graph.add(transformPoints, { translate }, `trussMove${n}`);
    const solid = graph.add(pathSegments, { axis: "+y", radius, extend: radius }, `trussSolid${n}`);
    graph.connect(frame, "out", move, "in");
    graph.connect(move, "out", solid, "in");
    graph.connect(solid, "out", into, "in");
    return move;
  };

  const chords = graph.add(mergePoints, undefined, "trussChords");
  const braces = graph.add(mergePoints, undefined, "trussBraces");
  // The four chords again, as POINTS this time. Ringing the corners at
  // one station needs the corners, not the tubes between them.
  const corners = graph.add(mergePoints, undefined, "trussCorners");
  for (let c = 0; c < 4; c++) {
    const a = Math.PI / 4 + (c * Math.PI) / 2;
    // A chord's angle is constant, so its sine and cosine are numbers and
    // no field arithmetic is needed at all.
    const chord = member(
      add(mul(h * Math.cos(a), N), mul(h * Math.sin(a), B)),
      params.trussChord,
      chords,
    );
    graph.connect(chord, "out", corners, "in");

    // A brace runs between corner c and corner c + 1, swapping every
    // station. At parity 1 the angle advances a quarter turn, which
    // takes cos to -sin and sin to cos — so lerping between those pairs
    // lands exactly on the two corners.
    const cosA = lerp(Math.cos(a), -Math.sin(a), parity);
    const sinA = lerp(Math.sin(a), Math.cos(a), parity);
    member(add(mul(mul(h, cosA), N), mul(mul(h, sinA), B)), params.trussBrace, braces);
  }

  const chordSpawn = graph.add(spawnInstances, { assetId: "tube" }, "trussChordSpawn");
  const braceSpawn = graph.add(spawnInstances, { assetId: "tube" }, "trussBraceSpawn");
  graph.connect(chords, "out", chordSpawn, "in");
  graph.connect(braces, "out", braceSpawn, "in");
  graph.output(chordSpawn, "instances", "truss");
  graph.output(braceSpawn, "instances", "braces");

  // -- cross-section frames -------------------------------------------
  // A square ring joining the four chords, every `trussFrameEvery` bays.
  //
  // The ring is a REGROUPING of points that already exist rather than
  // new geometry. mergePoints concatenated the four chords in connection
  // order, so a point's index is chord * stations + station: the station
  // is the index modulo the station count, and grouping by it collects
  // one point from each chord — in ascending chord order, which walks
  // the square rather than crossing it.
  const every = Math.max(1, Math.round(params.trussFrameEvery));
  if (params.trussFrameEvery > 0) {
    const stationId = graph.add(setAttribute, {
      name: "stationId",
      domain: "point",
      type: "i32",
      tupleSize: 1,
      value: (() => {
        const i = index();
        return sub(i, mul(stations, floor(div(i, stations))));
      })(),
    }, "trussStationId");
    // Frames at every station read as a solid tube rather than a truss,
    // so most stations are dropped. The keep test is a modulo written as
    // a remainder, thresholded — filterByAttribute compares against a
    // constant and has no modulo of its own.
    const phase = graph.add(setAttribute, {
      name: "framePhase",
      domain: "point",
      type: "f32",
      tupleSize: 1,
      value: (() => {
        const k = attribute("stationId", 1);
        return sub(k, mul(every, floor(div(k, every))));
      })(),
    }, "trussPhase");
    const keep = graph.add(filterByAttribute, {
      attribute: "framePhase",
      comparison: "lt",
      value: 0.5,
    }, "trussKeep");
    // Closed, so the fourth corner joins back to the first.
    const ring = graph.add(pointsToPath, { closed: true, groupAttr: "stationId" }, "trussRing");
    const solid = graph.add(pathSegments, {
      axis: "+y",
      radius: params.trussBrace,
      extend: params.trussBrace,
    }, "trussSolid");
    const spawn = graph.add(spawnInstances, { assetId: "tube" }, "trussSpawn");
    graph.connect(corners, "out", stationId, "in");
    graph.connect(stationId, "out", phase, "in");
    graph.connect(phase, "out", keep, "in");
    graph.connect(keep, "out", ring, "in");
    graph.connect(ring, "out", solid, "in");
    graph.connect(solid, "out", spawn, "in");
    graph.output(spawn, "instances", "frames");
  }
}

/**
 * Cables snaking along the truss, each orbiting it as it goes.
 *
 * A wrap is the spine curve again, displaced by
 * `r(u) * (cos t(u) * curveNormal + sin t(u) * curveBinormal)` — the
 * same move the truss chords make, except the angle ADVANCES with `u`
 * instead of holding still, which turns a parallel chord into a helix.
 * Per cable, three numbers decide the character and all three are drawn
 * in TypeScript rather than as fields, because they are constant along
 * one cable: where it starts, how many turns it makes over the run, and
 * how far out it rides. A cable at 0.4 turns lies almost straight along
 * a face; one at 5 winds tightly round and round.
 *
 * The mess is a noise pushed into the RADIUS rather than into the
 * position. Displacing position moves a cable off the structure in a
 * way that reads as floating; varying the radius makes it lift off the
 * truss and settle back onto it, which is what a real cable does when
 * it is neither tied down nor hanging free.
 */
function buildWraps(graph: Graph, params: RigParams, spine: NodeRef): void {
  const count = Math.max(1, Math.round(params.wrapCount));
  const h = trussCornerRadius(params);
  const cells = graph.add(pathResample, {
    mode: "count",
    count: Math.max(2, Math.round(params.wrapSegments)),
  }, "wrapCells");
  const frame = graph.add(writeCurveFrame, {}, "wrapFrame");
  graph.connect(spine, "out", cells, "in");
  graph.connect(cells, "out", frame, "in");

  // ONE body, cooked once per cable, instead of `count` hand-built
  // branches. The four scalars that made each cable its own — where it
  // starts, how many turns it makes, how far off the truss it swings, and
  // which part of the wobble noise it reads — used to be computed here in
  // TypeScript, which is exactly why this branch could not be a saved
  // graph: its NODE COUNT was a param.
  //
  // Inside a forEach they are written on the CARRIER — a one-point cloud
  // whose position is its own, so `randomField` over it gives four values
  // that belong to this cable and no other — and then transferred onto
  // the frame, where the fields that shape the cable can read them.
  // `nearest` from a single source point assigns that point's value to
  // every destination point, which is a broadcast; and transfer clones,
  // so the frame keeps the polyline topology `pathSegments` needs.
  const body = new Graph(0);
  const names = ["wphase", "wturns", "wspread", "wofs"] as const;
  let carrier: NodeRef | undefined;
  let carrierHead: NodeRef | undefined;
  for (const name of names) {
    const write = body.add(setAttribute, {
      name,
      domain: "point",
      type: "f32",
      tupleSize: 1,
      value: randomField(name),
    }, `wrapPick_${name}`);
    if (carrier !== undefined) body.connect(carrier, "out", write, "in");
    else carrierHead = write;
    carrier = write;
  }
  let tail: NodeRef | undefined;
  let frameHead: NodeRef | undefined;
  for (const name of names) {
    const onto = body.add(transferAttribute, { name, mapping: "nearest" }, `wrapOnto_${name}`);
    body.connect(carrier as NodeRef, "out", onto, "source");
    if (tail !== undefined) body.connect(tail, "out", onto, "in");
    else frameHead = onto;
    tail = onto;
  }

  const N = attribute("curveNormal", 3);
  const B = attribute("curveBinormal", 3);
  const u = attribute("curveU", 1);
  const phase = mul(attribute("wphase", 1), Math.PI * 2);
  const turns = lerp(params.wrapTurnsMin, params.wrapTurnsMax, attribute("wturns", 1));
  // Squared, so most cables hug the truss and a few swing wide — uniform
  // slack spreads them into an even shell instead of a tangle.
  const spreadT = mul(attribute("wspread", 1), attribute("wspread", 1));
  const base = mul(h, add(params.wrapRadius, mul(spreadT, params.wrapSlack)));
  const theta = add(phase, mul(mul(turns, Math.PI * 2), u));
  const radius = add(
    base,
    mul(
      params.wrapWobble,
      fbm(perlinNoise, {
        seed: noiseSeed(params, 173, params.wrapVariant),
        frequency: 0.35,
        octaves: 2,
        // The noise SEED is a literal in the serialized spec and therefore
        // the same for every iteration, so the cables would all wobble
        // alike. Sliding each one's sample position by its own constant is
        // what separates them — the one place a per-iteration value has to
        // reach inside a noise rather than beside it.
        position: add(position(), vec(mul(attribute("wofs", 1), 1000), 0, 0)),
      }),
    ),
  );
  const move = body.add(transformPoints, {
    translate: add(mul(mul(radius, cos(theta)), N), mul(mul(radius, sin(theta)), B)),
  }, "wrapMove");
  const solid = body.add(pathSegments, { axis: "+y", radius: params.cableRadius }, "wrapSolid");
  body.connect(tail as NodeRef, "out", move, "in");
  body.connect(move, "out", solid, "in");

  const each = forEachNode(
    body,
    [
      // The carrier is what the loop runs over — one per cable, each with
      // its own identity. The frame is the same geometry every time, so it
      // is broadcast rather than iterated.
      { name: "each", node: carrierHead as NodeRef, pin: "in" },
      { name: "frame", node: frameHead as NodeRef, pin: "in" },
    ],
    [{ name: "out", node: solid, pin: "out" }],
  );

  const carriers = buildCarriers(graph, count, "wrap");
  const wraps = graph.add(each, undefined, "wrapWraps");
  graph.connect(carriers, "out", wraps, "each");
  graph.connect(frame, "out", wraps, "frame");

  const merged = graph.add(mergePoints, undefined, "wrapMerged");
  graph.connect(wraps, "out", merged, "in");
  const spawn = graph.add(spawnInstances, { assetId: "tube" }, "wrapSpawn");
  graph.connect(merged, "out", spawn, "in");
  graph.output(spawn, "instances", "wraps");
}

/**
 * `n` single-point geometries, each with its own identity, for a forEach
 * to iterate when what is wanted is REPLICATION rather than treatment of
 * data that already exists.
 *
 * `pointLine` is the only generator whose point order is defined by its
 * own params, which is what makes `index()` a safe thing to write here —
 * the same trick on a scattered or filtered cloud reintroduces the
 * array-index bug identity keying exists to prevent. `partitionByAttribute`
 * is then the one way in the library to explode one geometry into many
 * items.
 */
function buildCarriers(graph: Graph, n: number, tag: string): NodeRef {
  const line = graph.add(pointLine, {
    count: n,
    start: [0, 0, 0],
    // Spaced a unit apart so no two carriers share a position: two items
    // agreeing on position, seed and tags are ONE item to a forEach, and
    // it refuses the collection rather than emit the same cable twice.
    end: [n - 1, 0, 0],
  }, `${tag}CarrierLine`);
  const id = graph.add(setAttribute, {
    name: `${tag}Id`,
    domain: "point",
    type: "i32",
    tupleSize: 1,
    value: index(),
  }, `${tag}CarrierId`);
  const split = graph.add(partitionByAttribute, { name: `${tag}Id` }, `${tag}Carriers`);
  graph.connect(line, "out", id, "in");
  graph.connect(id, "out", split, "in");
  return split;
}

/**
 * Chains from the ceiling down to the spine — what the whole rig hangs
 * from, and the one place a per-link roll actually matters.
 *
 * A chain link is a ring whose plane CONTAINS the chain direction, and
 * consecutive links sit a quarter turn apart. Both fall out of aiming
 * the torus rather than rolling it: `orientAlongVector` puts local +Z —
 * a torus's axis — onto a HORIZONTAL direction, which leaves the ring's
 * plane containing the vertical chain, and alternating that direction
 * between +X and +Z gives the quarter turn. One geometry, one draw call,
 * no second asset to keep in step.
 */
function buildChains(graph: Graph, params: RigParams, spine: NodeRef): void {
  const links = Math.max(2, Math.round(params.chainLinks));
  // A unit strand pointing UP; the anchor's scale stretches it to reach.
  const strand = graph.add(pointLine, {
    count: links + 1,
    start: [0, 0, 0],
    end: [0, 1, 0],
    includeEnd: true,
  }, "chainStrand");
  const anchors = graph.add(pathResample, {
    mode: "count",
    count: Math.max(2, Math.round(params.chainCount)),
  }, "chainAnchors");
  // Each chain reaches the SAME ceiling from a different height, so the
  // stretch is per anchor: copyToPoints multiplies the target's scale
  // into the source positions, and the strand is one unit long, so
  // scale.y is the gap the chain has to span. The spine wanders, so this
  // has to be read from the anchor's own Y rather than assumed.
  const reach = graph.add(setAttribute, {
    name: "scale",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: vec(1, sub(params.ceilingHeight, component(position(), 1)), 1),
  }, "chainReach");
  const copies = graph.add(copyToPoints, undefined, "chainCopies");
  const chainId = graph.add(setAttribute, {
    name: "chainId",
    domain: "point",
    type: "i32",
    tupleSize: 1,
    value: floor(div(index(), links + 1)),
  }, "chainChainId");
  const chainPath = graph.add(pointsToPath, { closed: false, groupAttr: "chainId" }, "chainChainPath");
  const segments = graph.add(pathSegments, { axis: "+y", radius: 1 }, "chainSegments");
  // Size each link to its own segment: chains span different gaps, so a
  // fixed link size would leave gaps on the long ones and pile up on the
  // short. pathSegments already wrote the segment length into scale.y —
  // reading it back is exact, and setAttribute guards the aliasing.
  const linkSize = graph.add(setAttribute, {
    name: "scale",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: (() => {
      // 1.3 so consecutive links overlap and interlock rather than
      // meeting exactly end to end, which reads as a dotted line.
      const s = mul(1.3, component(attribute("scale", 3), 1));
      return vec(s, s, s);
    })(),
  }, "chainLinkSize");
  const alternate = graph.add(orientAlongVector, {
    // index mod 2, without a modulo combinator: i - 2 * floor(i / 2).
    direction: (() => {
      const i = index();
      const parity = sub(i, mul(2, floor(div(i, 2))));
      return vec(sub(1, parity), 0, parity);
    })(),
    up: attribute("tangent", 3),
    axis: "+z",
  }, "chainAlternate");
  const spawn = graph.add(spawnInstances, { assetId: "chainLink" }, "chainSpawn");
  graph.connect(spine, "out", anchors, "in");
  graph.connect(anchors, "out", reach, "in");
  graph.connect(strand, "out", copies, "source");
  graph.connect(reach, "out", copies, "target");
  graph.connect(copies, "out", chainId, "in");
  graph.connect(chainId, "out", chainPath, "in");
  graph.connect(chainPath, "out", segments, "in");
  graph.connect(segments, "out", linkSize, "in");
  graph.connect(linkSize, "out", alternate, "in");
  graph.connect(alternate, "out", spawn, "in");
  graph.output(spawn, "instances", "chains");
}

/** One vertical strand per attachment point, curled toward its free end. */
function buildDanglers(graph: Graph, params: RigParams, spine: NodeRef): void {
  // Points, not segments: a strand of N segments walks N + 1 points, and
  // the group id below divides by the POINT count. The two are derived
  // from one number here precisely so they cannot drift apart.
  const points = Math.max(2, Math.round(params.danglerSegments) + 1);
  // One vertical strand per attachment point. copyToPoints is
  // target-major (output index is t * sourceCount + s) and tiles the
  // SOURCE attributes onto every copy, which is what makes both of the
  // tricks below work: cableU rides along from the source, and the
  // per-cable group id falls straight out of the point index.
  const strand = graph.add(pointLine, {
    count: points,
    start: [0, 0, 0],
    end: [0, -1, 0],
    includeEnd: true,
  }, "danglerStrand");
  const strandU = graph.add(setAttribute, {
    name: "cableU",
    domain: "point",
    type: "f32",
    tupleSize: 1,
    value: fraction(),
  }, "danglerStrandU");
  // Bundling GATHERS the anchors instead of deleting some of them: each
  // one slides along the curve toward the middle of its own bundle, so
  // the cables leave in fat clumps with bare runs between.
  //
  // Thinning by a noise threshold was the first attempt and was worse in
  // two ways that only showed up when measured. The cable count did not
  // hold still — normalized fbm is bell-shaped, not uniform, so the
  // fraction surviving a rising cut collapses rather than falling with
  // it, and no fixed oversample cancels that. Worse, a high enough cut
  // removes EVERY anchor, and an empty cloud reaches pointsToPath as a
  // path with no points and throws — a crash reachable by dragging a
  // slider. Sliding points cannot delete one, so the count is exactly
  // what the slider says and the failure cannot happen.
  //
  // The slide is a re-evaluation of the curve at the new parameter, so
  // the anchors land ON the spine however hard it bends. This used to
  // step along the tangent by the arc-length difference and accept the
  // error, which is what pathPointAt was added to stop doing.
  const bundle = Math.min(1, Math.max(0, params.danglerBundle));
  const anchors = graph.add(pathResample, {
    mode: "count",
    count: Math.max(2, Math.round(params.danglerCount)),
  }, "danglerAnchors");
  const bundling = graph.add(pathPointAt, {
    mode: "fraction",
    // Each anchor slides `bundle` of the way from where it is to the
    // centre of its own bin — the idiom pathPointAt's `parameter` is
    // built for, a move expressed relative to the point's own curveU.
    parameter: (() => {
      const u = attribute("curveU", 1);
      if (bundle <= 0) return u;
      const bins = Math.max(1, Math.round(params.danglerBundleFreq));
      const centre = div(add(floor(mul(u, bins)), 0.5), bins);
      return lerp(u, centre, bundle);
    })(),
  }, "danglerBundling");
  // The attachment's SCALE is the strand's length: copyToPoints applies
  // the target's scale to the source positions, and the unit strand is
  // 1 long, so scale.y IS the drop in metres. Its rot is left identity
  // on purpose — a cable hangs straight down whatever the spine does
  // underneath it, and the anchors come off pathResample unrotated.
  const drop = graph.add(setAttribute, {
    name: "scale",
    domain: "point",
    type: "f32",
    tupleSize: 3,
    value: vec(
      1,
      mul(
        params.danglerLength,
        lerp(1 - params.dropVariation, 1, randomField(`drop${Math.round(params.curlVariant)}`)),
      ),
      1,
    ),
  }, "danglerDrop");
  const copies = graph.add(copyToPoints, undefined, "danglerCopies");
  const cableId = graph.add(setAttribute, {
    name: "cableId",
    domain: "point",
    type: "i32",
    tupleSize: 1,
    value: floor(div(index(), points)),
  }, "danglerCableId");
  // The curl grows toward the free end: at the anchor cableU is 0 and
  // the cable is where it was attached, at the tip it is 1 and free.
  const curl = graph.add(transformPoints, {
    translate: (() => {
      const u = attribute("cableU", 1);
      const amount = mul(params.danglerCurl, mul(u, u));
      const opts = {
        frequency: params.curlFreq,
        octaves: Math.max(1, Math.round(params.curlOctaves)),
      };
      return vec(
        mul(
          amount,
          fbm(perlinNoise, { ...opts, seed: noiseSeed(params, 71, params.curlVariant) }),
        ),
        0,
        mul(
          amount,
          fbm(perlinNoise, { ...opts, seed: noiseSeed(params, 97, params.curlVariant) }),
        ),
      );
    })(),
  }, "danglerCurl");
  const danglerPath = graph.add(pointsToPath, { closed: false, groupAttr: "cableId" }, "danglerDanglerPath");
  const danglerTube = graph.add(pathSegments, { axis: "+y", radius: params.cableRadius }, "danglerDanglerTube");
  const danglerSpawn = graph.add(spawnInstances, { assetId: "tube" }, "danglerDanglerSpawn");
  graph.connect(strand, "out", strandU, "in");
  graph.connect(spine, "out", anchors, "in");
  graph.connect(anchors, "out", bundling, "in");
  graph.connect(bundling, "out", drop, "in");
  graph.connect(strandU, "out", copies, "source");
  graph.connect(drop, "out", copies, "target");
  graph.connect(copies, "out", cableId, "in");
  graph.connect(cableId, "out", curl, "in");
  graph.connect(curl, "out", danglerPath, "in");
  graph.connect(danglerPath, "out", danglerTube, "in");
  graph.connect(danglerTube, "out", danglerSpawn, "in");
  graph.output(danglerSpawn, "instances", "danglers");
}

/** Loops swinging between two points on the spine. */
function buildDrapes(graph: Graph, params: RigParams, spine: NodeRef): void {
  // connectPoints gives the chords and their lengths; the sag is a
  // parabola applied as a field, which at these slacks is
  // indistinguishable from a catenary and needs no solve.
  const drapeAnchors = graph.add(pathResample, { mode: "count", count: params.drapeCount }, "drapeDrapeAnchors");
  // A reach shorter than the gap between neighbouring anchors finds NO
  // edges, and the resample downstream then fails with "no polyline
  // primitives" — the whole rig disappears because one slider went too
  // low. Floored at just over the anchor spacing so there is always a
  // chain to hang, and free above that.
  const spacing = params.span / Math.max(1, params.drapeCount - 1);
  const chords = graph.add(connectPoints, {
    // BOTH modes read the same radius neighbourhood; 'relativeNeighborhood'
    // then applies the lune test on top, keeping a pair only when no third
    // point is closer to both endpoints. On points strung along a curve
    // that is a strong thinner — the intermediate anchors block most
    // long chords — so it wants a much larger reach than radius mode to
    // find anything at all.
    mode: params.drapeMode,
    radius: Math.max(params.drapeReach, spacing * 1.05),
    lengthAttr: "edgeLength",
  }, "drapeChords");
  // One random number per CHORD, written on the primitive domain. On any
  // domain but `point`, randomField hashes the element index rather than
  // a point identity — and connectPoints emits its edges in a canonical
  // order fixed by the points themselves, so that index is stable and
  // this value belongs to the chord rather than to the order it was
  // built in. It rides the primitive domain down to the segments beside
  // `edgeLength`, which is what lets a whole chord be kept or dropped.
  const pick = graph.add(setAttribute, {
    name: "chordPick",
    domain: "primitive",
    type: "f32",
    tupleSize: 1,
    value: randomField(`chord${Math.round(params.curlVariant)}`),
  }, "drapePick");
  // pathResample carries the primitive attributes onto every sample and
  // writes curveU, so both halves of the parabola are readable as
  // fields on the points it just made.
  const drapeEven = graph.add(pathResample, {
    mode: "count",
    count: Math.max(2, Math.round(params.drapeSegments) + 1),
  }, "drapeDrapeEven");
  const sag = graph.add(transformPoints, {
    translate: (() => {
      const u = attribute("curveU", 1);
      // 4 * u * (1 - u) peaks at 1 in the middle and is 0 at both ends.
      const bulge = mul(4, mul(u, sub(1, u)));
      // Per-chord slack variation is awkward to express: a random keyed
      // on point identity would vary WITHIN a chord and tear it, and
      // there is no per-primitive random to reach for. A low-frequency
      // noise over world position is nearly constant across any one
      // chord but differs from chord to chord — and the small amount it
      // does vary along a chord makes the curve slightly asymmetric,
      // which is what a real cable does anyway.
      const slack = add(
        params.drapeSlack,
        mul(
          params.drapeSlack * params.slackJitter,
          fbm(perlinNoise, {
            seed: noiseSeed(params, 131, params.curlVariant),
            frequency: 0.06,
            octaves: 1,
          }),
        ),
      );
      return vec(0, mul(-1, mul(slack, mul(attribute("edgeLength", 1), bulge))), 0);
    })(),
  }, "drapeSag");
  const drapeTube = graph.add(pathSegments, { axis: "+y", radius: params.cableRadius }, "drapeDrapeTube");
  const drapeSpawn = graph.add(spawnInstances, { assetId: "tube" }, "drapeDrapeSpawn");
  graph.connect(spine, "out", drapeAnchors, "in");
  graph.connect(drapeAnchors, "out", chords, "in");
  graph.connect(chords, "out", pick, "in");
  graph.connect(pick, "out", drapeEven, "in");
  graph.connect(drapeEven, "out", sag, "in");
  graph.connect(sag, "out", drapeTube, "in");

  // Both chord filters run on the TUBE SEGMENTS, not on the chords —
  // which sounds backwards and is the only place they fit. No filter in
  // this library selects primitives by an attribute
  // (filterPrimitivesByBounds goes by bounds), and every point filter
  // destroys topology, which a chord still needs at that stage. Once
  // pathSegments has run the topology has served its purpose and the
  // segments are plain instance points — each carrying its chord's
  // `edgeLength` and `chordPick`, having ridden the primitive domain the
  // whole way down. Every segment of one chord shares those values, so a
  // threshold takes whole chords and never half of one.
  //
  // Length alone thins the net but leaves what survives REGULAR: every
  // pair over the threshold is hung, and a complete graph of long chords
  // is a lattice. The random pick is what turns it into a scatter.
  let tail: NodeRef = drapeTube;
  if (params.drapeMinLength > 0) {
    const long = graph.add(filterByAttribute, {
      attribute: "edgeLength",
      comparison: "ge",
      value: params.drapeMinLength,
    }, "drapeLong");
    graph.connect(tail, "out", long, "in");
    tail = long;
  }
  if (params.drapeKeep < 1) {
    const some = graph.add(filterByAttribute, {
      attribute: "chordPick",
      comparison: "lt",
      value: params.drapeKeep,
    }, "drapeSome");
    graph.connect(tail, "out", some, "in");
    tail = some;
  }
  graph.connect(tail, "out", drapeSpawn, "in");
  graph.output(drapeSpawn, "instances", "drapes");
}

/** Instance batches per named output, plus what the stats line shows. */
export interface RigResult {
  readonly groups: Record<string, readonly InstanceBatch[]>;
  readonly counts: Record<string, number>;
  readonly elapsedMs: number;
}

/** The graph's output names that carry instances, in draw order. */
export const RIG_GROUPS = ["chains", "truss", "braces", "frames", "wraps", "parts", "danglers", "drapes"] as const;
export type RigGroup = (typeof RIG_GROUPS)[number];

/** Cook a rig graph and collect its batches by group. */
export async function cookRig(graph: Graph): Promise<RigResult> {
  const result = await cook(graph);
  const groups: Record<string, InstanceBatch[]> = {};
  const counts: Record<string, number> = {};
  for (const name of RIG_GROUPS) {
    const batches: InstanceBatch[] = [];
    for (const item of result.outputs[name] ?? []) {
      if (item.kind === "instances") batches.push(...(item as InstancesItem).batches);
    }
    groups[name] = batches;
    counts[name] = batches.reduce((sum, b) => sum + b.count, 0);
  }
  counts.spinePoints = firstGeometry(result.outputs.spinePoints)?.pointCount ?? 0;
  return { groups, counts, elapsedMs: result.stats.elapsedMs };
}
