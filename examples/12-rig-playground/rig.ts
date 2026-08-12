/**
 * The rig graph: a spline spine, component parts scattered along it, and
 * cables hanging off it. One pcg-ts graph, four branches, four spawners.
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
  cook,
  copyToPoints,
  connectPoints,
  cos,
  div,
  fbm,
  filterByAttribute,
  filterByDensity,
  firstGeometry,
  floor,
  fraction,
  hashCombine,
  index,
  jitterPoints,
  lerp,
  mul,
  orientAlongVector,
  pathResample,
  pathSegments,
  perlinNoise,
  pointLine,
  pointsToPath,
  randomField,
  setAttribute,
  sin,
  spawnInstances,
  sub,
  transformPoints,
  vec,
  writeCurveFrame,
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
  spineRadius: number;
  spineSamples: number;
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
  partSize: number;
  sizeJitter: number;
  // cables
  danglerCount: number;
  danglerLength: number;
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
  spineRadius: 0.22,
  spineSamples: 130,
  weights: { rod: 4, bar: 2, panel: 1, clamp: 2 },
  partDensity: 320,
  clusterFreq: 9,
  clusterOctaves: 2,
  clusterVariant: 0,
  clusterThreshold: 0.52,
  radialSpread: 1,
  scatterJitter: 0.5,
  partSize: 1,
  sizeJitter: 0.45,
  danglerCount: 150,
  danglerLength: 3.2,
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

/** Corners the wander is built from, before the arc-length evening. */
const SPINE_CORNERS = 97;
/** Points down one hanging cable. More = smoother curl, more instances. */
const DANGLER_POINTS = 9;
/** Samples across one drape, so its sag reads as a curve and not a tent. */
const DRAPE_POINTS = 11;

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
  });
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
  });
  const spinePath = graph.add(pointsToPath, { closed: false });
  // Displacing a line sideways stretches its segments where the wander
  // is steep, so the spacing is evened out again before anything is
  // placed along it — otherwise everything bunches on the straight runs.
  const spine = graph.add(pathResample, { mode: "count", count: params.spineSamples });
  const spineTube = graph.add(pathSegments, {
    axis: "+y",
    radius: params.spineRadius,
    extend: params.spineRadius,
  });
  const spineSpawn = graph.add(spawnInstances, { assetId: "tube" });
  graph.connect(line, "out", wander, "in");
  graph.connect(wander, "out", spinePath, "in");
  graph.connect(spinePath, "out", spine, "in");
  graph.connect(spine, "out", spineTube, "in");
  graph.connect(spineTube, "out", spineSpawn, "in");
  graph.output(spineSpawn, "instances", "spine");

  // -- components -----------------------------------------------------
  // Dense even samples, thinned by a noise field read along the curve
  // parameter so the survivors arrive in clusters rather than evenly.
  const dense = graph.add(pathResample, { mode: "count", count: params.partDensity });
  // The frame goes AFTER the dense resample, not before: pathResample
  // builds new points and does not carry the input's POINT attributes,
  // so a frame written upstream would be dropped right here. It has to
  // be computed on the points that survive to the end.
  const frame = graph.add(writeCurveFrame, {});
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
  });
  const cluster = graph.add(filterByDensity, {
    mode: "threshold",
    threshold: params.clusterThreshold,
  });
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
  });
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
  });
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
  const angle = mul(randomField("radial"), Math.PI * 2 * params.radialSpread);
  const orient = graph.add(orientAlongVector, {
    direction: attribute("tangent", 3),
    up: add(
      mul(cos(angle), attribute("curveNormal", 3)),
      mul(sin(angle), attribute("curveBinormal", 3)),
    ),
    axis: "+z",
  });
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
  });
  const partSpawn = graph.add(spawnInstances, { assetId: "rod", assetAttr: "part" });
  graph.connect(spine, "out", dense, "in");
  graph.connect(dense, "out", frame, "in");
  graph.connect(frame, "out", density, "in");
  graph.connect(density, "out", cluster, "in");
  graph.connect(cluster, "out", scatter, "in");
  graph.connect(scatter, "out", part, "in");
  graph.connect(part, "out", orient, "in");
  graph.connect(orient, "out", size, "in");
  graph.connect(size, "out", partSpawn, "in");
  graph.output(partSpawn, "instances", "parts");

  // -- hanging cables, kind 1: danglers -------------------------------
  // Skipped entirely below 2 anchors rather than clamped: pathResample
  // needs at least 2 samples to still be a path and throws otherwise, so
  // "0 danglers" has to mean no branch, not a branch with 0 in it. The
  // output simply is not declared, and cookRig tolerates that.
  if (params.danglerCount >= 2) buildDanglers(graph, params, spine);
  if (params.drapeCount >= 3) buildDrapes(graph, params, spine);

  // The spine points, for the stats line.
  graph.output(spine, "out", "spinePoints");
  return graph;
}

/** One vertical strand per attachment point, curled toward its free end. */
function buildDanglers(graph: Graph, params: RigParams, spine: NodeRef): void {
  // One vertical strand per attachment point. copyToPoints is
  // target-major (output index is t * sourceCount + s) and tiles the
  // SOURCE attributes onto every copy, which is what makes both of the
  // tricks below work: cableU rides along from the source, and the
  // per-cable group id falls straight out of the point index.
  const strand = graph.add(pointLine, {
    count: DANGLER_POINTS,
    start: [0, 0, 0],
    end: [0, -1, 0],
    includeEnd: true,
  });
  const strandU = graph.add(setAttribute, {
    name: "cableU",
    domain: "point",
    type: "f32",
    tupleSize: 1,
    value: fraction(),
  });
  const anchors = graph.add(pathResample, { mode: "count", count: params.danglerCount });
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
  });
  const copies = graph.add(copyToPoints);
  const cableId = graph.add(setAttribute, {
    name: "cableId",
    domain: "point",
    type: "i32",
    tupleSize: 1,
    value: floor(div(index(), DANGLER_POINTS)),
  });
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
  });
  const danglerPath = graph.add(pointsToPath, { closed: false, groupAttr: "cableId" });
  const danglerTube = graph.add(pathSegments, { axis: "+y", radius: params.cableRadius });
  const danglerSpawn = graph.add(spawnInstances, { assetId: "tube" });
  graph.connect(strand, "out", strandU, "in");
  graph.connect(spine, "out", anchors, "in");
  graph.connect(anchors, "out", drop, "in");
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
  const drapeAnchors = graph.add(pathResample, { mode: "count", count: params.drapeCount });
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
  });
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
  });
  // pathResample carries the primitive attributes onto every sample and
  // writes curveU, so both halves of the parabola are readable as
  // fields on the points it just made.
  const drapeEven = graph.add(pathResample, { mode: "count", count: DRAPE_POINTS });
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
  });
  const drapeTube = graph.add(pathSegments, { axis: "+y", radius: params.cableRadius });
  const drapeSpawn = graph.add(spawnInstances, { assetId: "tube" });
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
    });
    graph.connect(tail, "out", long, "in");
    tail = long;
  }
  if (params.drapeKeep < 1) {
    const some = graph.add(filterByAttribute, {
      attribute: "chordPick",
      comparison: "lt",
      value: params.drapeKeep,
    });
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
export const RIG_GROUPS = ["spine", "parts", "danglers", "drapes"] as const;
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
