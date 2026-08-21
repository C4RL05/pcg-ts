/**
 * The spline-to-environment-art technique, as a pcg-ts graph.
 *
 * Given a closed centreline, dress it: build a banked moving frame along
 * the lap, classify every frame by how tight the track is under it, draw
 * clustered placements from a curvature-weighted density, push them to
 * the outside of bends, add the legibility furniture a corner needs, fill
 * the gaps, and drop whatever stands in the driver's view.
 *
 * WHAT IS IN THE GRAPH AND WHAT IS NOT. The graph does everything that is
 * a function of the track: frames, corner model, density, clustering,
 * side choice, markers, coverage, sightline. It does NOT do calibration
 * or the closed correction loop, and that is not a gap in the graph
 * system — those measure a SHARE OF THE WHOLE (placements per W, the band
 * mix, the outside-of-bend share) and a cook cannot read its own totals:
 * `attributeReduce` writes the detail domain, and a detail attribute is
 * deliberately not readable from a point-domain field. So the totals are
 * a host's business, they live in `calibrate.ts`, and the graph is
 * rebuilt with corrected counts. That split is the technique's own: it
 * fits the kit BEFORE placing anything and corrects it AFTER measuring.
 *
 * The one structural compromise is `AffinityProfile`: the graph builds
 * one cumulative distribution per profile rather than per archetype, so
 * three scans serve nineteen archetypes. See `kit.ts`.
 */
import {
  type Field,
  type FieldLike,
  type NodeHandle,
  type PointLineParams,
  type SetAttributeParams,
  add,
  atan2,
  attribute,
  byAttribute,
  clamp,
  component,
  copyToPoints,
  cos,
  cross,
  dataInput,
  div,
  dot,
  eq,
  exp,
  filterByExpression,
  floor,
  fract,
  fraction,
  Graph,
  gt,
  index,
  length as vlength,
  lerp,
  log,
  lt,
  max as fmax,
  mergePoints,
  mod,
  mul,
  ne,
  normalize,
  orientAlongVector,
  pathResample,
  pathScan,
  pathSegments,
  pointLine,
  pointsToPath,
  position,
  pow,
  promoteAttribute,
  randomField,
  sampleNearestPoint,
  select,
  setAttribute,
  sign,
  sin,
  spawnInstances,
  sweepProfile,
  sub,
  transferAttribute,
  vec,
  writeCurveFrame,
} from "pcg-ts";
import {
  AFFINITY,
  ALL_ARCHETYPES,
  ARCHETYPES,
  type Archetype,
  CORRIDOR,
  LADDER_P,
  archetypesFor,
  BUCKET_EDGES,
  CORNER_RADIUS_W,
  extentsOf,
  LANDMARK_STRETCHES,
  NO_COMMITTED_STRETCHES,
  PROFILES,
  RULE_ARCHETYPES,
  SIGHTLINE,
  clampNum,
  encodeCommittedStretches,
  type Preset,
} from "./kit.js";

/**
 * What a placement needs off the frame it lands on: its position, frame
 * and severity in four packed columns, plus `uref` — the lap fraction,
 * the lap's length in half-widths, the half-width itself, and the
 * balance pass's committed-lean table.
 */
const LOOKUP_NAMES = ["pack0", "pack1", "pack2", "pack3", "uref"] as const;

/** How far apart the lanes of CDF space sit. Any value above 1 works. */
const LANE = 10;

/**
 * Radius of the lap ring, in the arbitrary units of a lookup space that
 * nothing renders. Only its ratio to the frame spacing matters, and one
 * turn of a thousand units across a few hundred frames leaves every
 * neighbour unambiguous.
 */
const RING_R = 1000;

/**
 * The golden-ratio conjugate. Stepping by it modulo one visits the unit
 * interval about as evenly as a sequence can without knowing in advance
 * how many steps it will take — which is exactly the property the anchor
 * counts need, since they are a knob a host turns after the fact.
 */
const GOLDEN = 0.6180339887498949;

/** The largest cluster the duplication pass can produce. */
const MAX_CLUSTER = 6;

/** Where a corner marker sits before the entry, in W. Spec says 3-6. */
const MARKER_BACK_W = 4.5;

/** Where the braking references sit before a tight corner's entry, in W. */
const BRAKE_OFFSETS_W = [6, 10.5, 15] as const;

/** A corner tighter than this radius in W gets braking references. */
const BRAKE_RADIUS_W = 8;

/**
 * How far INTO a corner its severity and direction are sampled, in W.
 * At the entry the radius has only just crossed the corner threshold, so
 * it reports the loosest radius the corner ever has.
 */
const SEVERITY_PROBE_W = 2;

/** The cockpit eye height the sightline is tested from, in W. */
const EYE_H_W = 0.3;

/** How far ahead the centreline must stay visible, in W. */
const LOOK_AHEAD_W = 12;

/**
 * How many points sample each look-ahead chord.
 *
 * The cull measures the distance to these samples rather than to the
 * chord itself, which OVERSTATES it by up to half the sample spacing —
 * so a sampled cull passes objects a chord test would catch. Twenty-five
 * puts the spacing at half a half-width, and the test below adds the
 * remaining half of that to the obstruction radius, which turns the
 * approximation from optimistic into conservative. That matters because
 * the metric is scored by a separate exact point-to-SEGMENT test, and a
 * cull that leaves work behind is a cull that fails its own metric.
 */
const CHORD_SAMPLES = 25;

/** Half the chord sample spacing, in W: the sampling's own error bound. */
const CHORD_SLACK_W = LOOK_AHEAD_W / (CHORD_SAMPLES - 1) / 2;

/** What the graph needs to know before it can be built. */
export interface TrackDressingOpts {
  readonly preset: Preset;
  /** Track half-width in world units. Every W in the kit scales by this. */
  readonly halfWidth: number;
  /** Control points of the generated centreline. */
  readonly controlPoints: number;
  /** Frames the lap is resampled to. Keep the step near 1W. */
  readonly frames: number;
  /** Nominal lap radius in world units, before the shaping harmonics. */
  readonly lapRadius: number;
  /** Vertical relief of the generated centreline, in world units. */
  readonly relief: number;
  /** How many placements to draw per affinity profile. From calibration. */
  readonly countByProfile: Readonly<Record<string, number>>;
  /** Relative weight of each archetype within its profile. From calibration. */
  readonly weightByArchetype: Readonly<Record<string, number>>;
  /** Additive shift on every archetype's outside-of-bend bias. */
  readonly outsideShift?: number;
  /** Art variants per archetype. One family per variant. */
  readonly variantsByArchetype?: Readonly<Record<string, number>>;
  /** Multiplier on every kit polygon count, to hit the budget per W. */
  readonly polygonScale?: number;
  /** Tenths of the lap committed to a hard lean, and which way. */
  readonly committedStretches?: Readonly<Record<number, number>>;
  /**
   * Take the centreline from a `dataInput` the host fills instead of
   * generating one. The node is `splineIn`; give it a point cloud of
   * control points in lap order and everything else follows from it.
   */
  readonly splineFromHost?: boolean;
  /** Turn the landmark and balance passes on or off. */
  readonly landmarks?: boolean;
  readonly balance?: boolean;
  /**
   * Add a `spawnInstances` terminal, so the lap can be LOOKED AT rather
   * than only measured. Off by default: it is a rendering concern, the
   * metrics read the placement columns and not the batches, and a
   * terminal nothing consumes is cost with no reader.
   */
  readonly spawn?: boolean;
  /**
   * Add a `road` output: the centreline swept into a flat ribbon two
   * half-widths across. Off by default for the same reason `spawn` is —
   * no metric reads it — but a LAYOUT is unreadable without it. The
   * placements are the output; the road is what says where they are.
   */
  readonly ribbon?: boolean;
  readonly seed: number;
  /** Turn the legibility, coverage and sightline passes on or off. */
  readonly legibility?: boolean;
  readonly coverage?: boolean;
  readonly sightline?: boolean;
}

/** tanh, which the field grammar does not carry, from exp, which it does. */
function tanh(x: FieldLike): Field<1> {
  return sub(1, div(2, add(exp(mul(2, x)), 1))) as Field<1>;
}

/**
 * A symmetric triangular draw on [0, 1], as the mean of two uniforms.
 *
 * EVERY ENVELOPE IN THE KIT IS AN INTERQUARTILE RANGE, and sampling one
 * uniformly over-represents both of its ends — half the real instances
 * fall outside an IQR by construction, so the ends are where a uniform
 * draw invents mass the source material does not have. Measured over
 * 400,000 draws, the share of a placement's inboard face landing inside
 * the corridor nearly doubles under a uniform draw for five of the
 * archetypes: ground detail 20.9% against 10.9%, chevron boards 19.8%
 * against 10.5%, wall panels 20.2% against 10.8%.
 *
 * A midpoint-mode triangular is the defensible fit because most of the
 * kit is near-symmetric inside its IQR — the exceptions are the pooled
 * archetypes, which are bimodal rather than skewed and which no
 * single-mode shape describes. The mean of two independent uniforms IS
 * that triangular, exactly, and it costs one add.
 *
 * It also keeps the correlated draw honest: blending two streams at a
 * weight chosen for a target correlation assumes they have EQUAL
 * variance, so the independent stream and the size stream have to be the
 * same shape. Both are this one.
 */
function tri(name: string): Field<1> {
  return mul(0.5, add(randomField(name), randomField(`${name}-b`))) as Field<1>;
}

/** A vec3 field reading three consecutive components of a packed tuple. */
function unpack3(name: string, ts: number): Field {
  const a = attribute(name, ts);
  return vec(component(a, 0), component(a, 1), component(a, 2));
}

/** A per-archetype scalar, as a field switching on the `archetype` column. */
function byArchetype(pick: (id: string) => number, fallback = 0): Field<1> {
  const cases: Record<string, FieldLike> = {};
  for (const a of ALL_ARCHETYPES) cases[a.id] = pick(a.id);
  return byAttribute("archetype", cases, fallback) as Field<1>;
}

/**
 * Draw from a per-archetype LADDER at quantile field `u`: the measured
 * value at each of `LADDER_P`, interpolated between the bracketing pair.
 *
 * Twelve `select`s over twelve `lerp`s, with one `byArchetype` chain per
 * percentile behind them. That is more graph than a two-point envelope
 * costs and it buys the only thing a bounded shape cannot give: the
 * tails. See `lateralLadder` in the kit for what lives out there and why
 * the verge band is unreachable without it.
 *
 * Archetypes with no ladder fall back to `fb`, and the caller discards
 * that branch — the two draws are blended on a 0/1 flag rather than
 * branched, because the grammar has no branch.
 */
function ladderByArchetype(
  pick: (a: Archetype) => readonly number[] | undefined,
  fb: (a: Archetype) => number,
  u: Field<1>,
): Field<1> {
  const at = (k: number): Field<1> =>
    byArchetype((x) => {
      const ladder = pick(arch(x));
      return ladder ? ladder[k] : fb(arch(x));
    }, 0);
  const pts = LADDER_P.map((_, k) => at(k));
  let out: Field<1> = pts[LADDER_P.length - 1];
  for (let k = LADDER_P.length - 2; k >= 0; k--) {
    const span = LADDER_P[k + 1] - LADDER_P[k];
    const f = div(sub(u, LADDER_P[k]), span) as Field<1>;
    out = select(lt(u, LADDER_P[k + 1]), lerp(pts[k], pts[k + 1], f), out) as Field<1>;
  }
  return out;
}

/** A per-archetype pair, as one tuple-2 field. */
function rangeByArchetype(pick: (id: string) => readonly [number, number]): Field {
  const cases: Record<string, FieldLike> = {};
  for (const a of ALL_ARCHETYPES) cases[a.id] = [...pick(a.id)];
  return byAttribute("archetype", cases, [0, 0]);
}

/**
 * Build the whole pipeline. Returns the graph plus the handles a caller
 * needs to read intermediate stages, because a metric that scores the
 * lap has to see the frames as well as the placements.
 */
export function buildTrackDressingGraph(opts: TrackDressingOpts): {
  graph: Graph;
  /**
   * The handles a host needs to RE-AIM this graph without rebuilding it:
   * the spline it reads, the per-profile anchor counts and kit mixes that
   * calibration produces, and the one place the track's scale is written.
   * Returned rather than looked up by id because a handle is what
   * `Graph.setParam` takes, and the alternative is spelling node ids in
   * two files and finding out at run time when they disagree.
   */
  nodes: {
    splineIn: NodeHandle<{ items: unknown[] }>;
    halfWidth: NodeHandle<SetAttributeParams>;
    leanCode: NodeHandle<SetAttributeParams>;
    anchors: Record<string, NodeHandle<PointLineParams>>;
    anchorKind: Record<string, NodeHandle<SetAttributeParams>>;
  };
  /** Which archetypes each profile's weight list is indexed by, in order. */
  archetypesByProfile: Record<string, string[]>;
} {
  const {
    preset,
    halfWidth: W,
    controlPoints,
    frames: FRAMES,
    lapRadius,
    relief,
    countByProfile,
    weightByArchetype,
    seed,
  } = opts;
  const outsideShift = opts.outsideShift ?? 0;
  const variants = opts.variantsByArchetype ?? {};
  const polygonScale = opts.polygonScale ?? 1;
  const committed = opts.committedStretches ?? {};
  const landmarks = opts.landmarks ?? true;
  const balance = opts.balance ?? true;
  const spawn = opts.spawn ?? false;
  const ribbon = opts.ribbon ?? false;
  const legibility = opts.legibility ?? true;
  const coverage = opts.coverage ?? true;
  const sightline = opts.sightline ?? true;
  const g = new Graph(seed);

  // ---------------------------------------------------------------- //
  // 0. The centreline, and the moving frame on it.
  // ---------------------------------------------------------------- //

  // A closed loop built from INTEGER harmonics of the lap angle, so it
  // closes exactly. A noise would not: it would leave a seam at the start
  // line, which is the failure this technique warns about twice.
  // WHERE THE CENTRELINE COMES FROM. `dataInput` when the host has a
  // spline of its own — the technique's actual input, an ordered array of
  // points round a closed lap — and a generated loop otherwise, so the
  // graph is runnable on its own. Only these first nodes differ; every
  // rule downstream reads the resampled path and knows nothing about
  // which one it came from.
  const spine = g.add(pointLine, { count: controlPoints, includeEnd: false }, "spine");
  const angle = mul(div(index(), controlPoints), Math.PI * 2);
  // The harmonics are chosen for the CORNER STATISTICS they produce, not
  // for how the loop looks from above. A radial harmonic of order k and
  // amplitude a tightens the radius of curvature by roughly a * k^2, so
  // the low orders set the lap's overall shape and the high ones are what
  // put real corners in it. With one gentle harmonic the lap came out with
  // a median radius of 41W and two corners in it; the technique's own
  // measurements want half the lap tighter than 25W and fifteen to thirty
  // corners, which needs orders this high.
  const radius = mul(
    lapRadius,
    add(
      1,
      add(
        add(mul(0.17, sin(mul(3, angle))), mul(0.115, sin(add(mul(7, angle), 1.2)))),
        mul(0.065, sin(add(mul(11, angle), 2.3))),
      ),
    ),
  );
  const spineShape = g.add(
    setAttribute,
    {
      name: "P",
      tupleSize: 3,
      value: vec(
        mul(cos(angle), radius),
        mul(relief, sin(add(mul(2, angle), 0.7))),
        mul(sin(angle), radius),
      ),
    },
    "spineShape",
  );
  g.connect(spine, "out", spineShape, "in");
  const spineSource: NodeHandle = opts.splineFromHost
    ? g.add(dataInput, { items: [] }, "splineIn")
    : spineShape;
  const spinePath = g.add(pointsToPath, { closed: true }, "spinePath");
  // 'count' rather than 'spacing': a closed path resampled by spacing
  // closes on a REMAINDER segment, and a remainder at the start line is
  // exactly the seam the periodic envelope exists to avoid.
  //
  // Both REPORTS are asked for, and they are what makes this graph a tool
  // rather than a rendering: `lengthAttr` is how long the lap actually is
  // and `stepAttr` is how far apart the frames landed. Everything below
  // that used to need a build-time constant reads them instead.
  const centre = g.add(
    pathResample,
    { mode: "count", count: FRAMES, lengthAttr: "lapLen", stepAttr: "stepLen" },
    "centre",
  );
  const frames = g.add(writeCurveFrame, { curvatureName: "curvature" }, "frames");
  const lapLenPt = g.add(
    promoteAttribute,
    { name: "lapLen", from: "primitive", to: "point", mode: "average" },
    "lapLenPt",
  );
  const stepLenPt = g.add(
    promoteAttribute,
    { name: "stepLen", from: "primitive", to: "point", mode: "average" },
    "stepLenPt",
  );
  g.connect(spineSource, "out", spinePath, "in");
  g.connect(spinePath, "out", centre, "in");
  g.connect(centre, "out", frames, "in");
  g.connect(frames, "out", lapLenPt, "in");
  g.connect(lapLenPt, "out", stepLenPt, "in");

  // THE ONE PLACE THE TRACK'S SCALE IS WRITTEN DOWN.
  //
  // The half-width is the unit every rule in the kit is stated in, and it
  // is the only number here that is not derivable from the spline. As a
  // node param it is a single addressable knob — `halfWidthN.value` — so
  // a shipped graph can be re-scaled without being rebuilt. It used to be
  // a build-time constant multiplied into forty-one field expressions,
  // which meant a graph could only ever dress the track it was compiled
  // for.
  const halfWidthN = g.add(
    setAttribute,
    { name: "halfWidth", value: W },
    "halfWidthN",
  );
  g.connect(stepLenPt, "out", halfWidthN, "in");
  const HW = attribute("halfWidth");
  // Lap length and frame spacing in half-widths, and the frame step as a
  // FRACTION of the lap — the three derived scales the passes below read
  // instead of closing over a number from the build.
  const scaleN = g.add(
    setAttribute,
    { name: "lapW", value: div(attribute("lapLen"), HW) },
    "lapWN",
  );
  g.connect(halfWidthN, "out", scaleN, "in");
  const stepUN = g.add(
    setAttribute,
    { name: "stepU", value: div(attribute("stepLen"), attribute("lapLen")) },
    "stepUN",
  );
  g.connect(scaleN, "out", stepUN, "in");
  // The balance pass's whole table, as one addressable number. See
  // `encodeCommittedStretches` for why it is packed rather than spelled
  // out, and `leanCodeN.value` is the address a host turns.
  const leanCodeN = g.add(
    setAttribute,
    {
      name: "leanCode",
      value: balance ? encodeCommittedStretches(committed) : NO_COMMITTED_STRETCHES,
    },
    "leanCodeN",
  );
  g.connect(stepUN, "out", leanCodeN, "in");

  // Station in W, the coordinate every distance ALONG the lap is in.
  const stationN = g.add(
    setAttribute,
    { name: "stationW", value: div(mul(attribute("curveU"), attribute("lapLen")), HW) },
    "stationN",
  );
  // The LEVEL frame, before banking: right = forward x worldUp.
  const rightN = g.add(
    setAttribute,
    { name: "rightV", tupleSize: 3, value: normalize(cross(attribute("tangent", 3), [0, 1, 0])) },
    "rightN",
  );
  const upN = g.add(
    setAttribute,
    {
      name: "upV",
      tupleSize: 3,
      value: cross(attribute("rightV", 3), attribute("tangent", 3)),
    },
    "upN",
  );
  // Signed curvature: the curvature VECTOR points at the centre of the
  // turn, so its component along `right` is positive turning right. This
  // is the one place the sign of a bend is decided, and every rule keyed
  // to "outside" reads it.
  const kSignN = g.add(
    setAttribute,
    { name: "kSigned", value: dot(attribute("curvature", 3), attribute("rightV", 3)) },
    "kSignN",
  );
  const radN = g.add(
    setAttribute,
    { name: "radiusW", value: div(1, mul(fmax(vlength(attribute("curvature", 3)), 1e-9), HW)) },
    "radN",
  );
  const R = attribute("radiusW");
  const bucketN = g.add(
    setAttribute,
    {
      name: "bucket",
      type: "i32",
      value: sub(3, add(add(gt(R, BUCKET_EDGES.tight), gt(R, BUCKET_EDGES.medium)), gt(R, BUCKET_EDGES.easy))),
    },
    "bucketN",
  );
  const cornerN = g.add(
    setAttribute,
    { name: "isCorner", value: lt(R, CORNER_RADIUS_W) },
    "cornerN",
  );
  // Banking: peak roll reached asymptotically, leaning INTO the turn, so
  // a right-hand bend (positive curvature) rolls negative.
  const bankN = g.add(
    setAttribute,
    {
      name: "bankRad",
      value: mul(
        mul(sign(attribute("kSigned")), -(preset.bankMaxDeg * Math.PI) / 180),
        tanh(mul(vlength(attribute("curvature", 3)), mul(preset.referenceRadiusW, HW))),
      ),
    },
    "bankN",
  );
  const bank = attribute("bankRad");
  const rightB = g.add(
    setAttribute,
    {
      name: "rightB",
      tupleSize: 3,
      value: add(
        mul(attribute("rightV", 3), cos(bank)),
        mul(attribute("upV", 3), sin(bank)),
      ),
    },
    "rightB",
  );
  const upB = g.add(
    setAttribute,
    {
      name: "upB",
      tupleSize: 3,
      value: sub(
        mul(attribute("upV", 3), cos(bank)),
        mul(attribute("rightV", 3), sin(bank)),
      ),
    },
    "upB",
  );
  chain(g, [leanCodeN, stationN, rightN, upN, kSignN, radN, bucketN, cornerN, bankN, rightB, upB]);

  // ---------------------------------------------------------------- //
  // 1. Intensity and its cumulative distribution, one per profile.
  // ---------------------------------------------------------------- //

  // The density envelope: three harmonics of the LAP, so it is exactly
  // periodic and the lap has no seam. A per-profile phase keeps different
  // kinds of thing from peaking together.
  const u = attribute("curveU");
  const envelopeFor = (phase: number): Field<1> =>
    add(
      1,
      mul(
        preset.envelope,
        div(
          add(
            add(sin(add(mul(u, Math.PI * 2), phase)), mul(0.6, sin(add(mul(u, Math.PI * 4), phase * 1.7)))),
            mul(0.4, sin(add(mul(u, Math.PI * 6), phase * 2.3))),
          ),
          2,
        ),
      ),
    ) as Field<1>;
  const bucketPick = (row: readonly [number, number, number, number]): Field<1> => {
    const b = attribute("bucket");
    return select(
      eq(b, 0),
      row[0],
      select(eq(b, 1), row[1], select(eq(b, 2), row[2], row[3])),
    ) as Field<1>;
  };
  const intensityN = g.add(
    setAttribute,
    {
      name: "intensity",
      tupleSize: 3,
      value: vec(
        ...PROFILES.map((p, i) =>
          // Floored above zero: a bucket a profile suppresses to nothing
          // would make the distribution flat there and the inverse
          // transform ambiguous across the dead stretch.
          fmax(mul(envelopeFor(i * 1.9), bucketPick(AFFINITY[p])), 0.02),
        ),
      ),
    },
    "intensityN",
  );
  const cdfN = g.add(
    pathScan,
    { name: "intensity", outName: "cdfRaw", mode: "exclusive", totalAttr: "cdfTot" },
    "cdfN",
  );
  const cdfTotPt = g.add(
    promoteAttribute,
    { name: "cdfTot", from: "primitive", to: "point", mode: "average" },
    "cdfTotPt",
  );
  const cdfNorm = g.add(
    setAttribute,
    {
      name: "cdf",
      tupleSize: 3,
      value: div(attribute("cdfRaw", 3), attribute("cdfTot", 3)),
    },
    "cdfNorm",
  );
  chain(g, [upB, intensityN, cdfN, cdfTotPt, cdfNorm]);

  // Everything a placement needs from its frame, packed into four tuple-4
  // columns. transferAttribute moves ONE attribute per node, so packing
  // turns twelve lookups into four.
  const pack0 = g.add(
    setAttribute,
    { name: "pack0", tupleSize: 4, value: vec(position(), attribute("stationW")) },
    "pack0",
  );
  const pack1 = g.add(
    setAttribute,
    { name: "pack1", tupleSize: 4, value: vec(attribute("rightB", 3), attribute("radiusW")) },
    "pack1",
  );
  const pack2 = g.add(
    setAttribute,
    { name: "pack2", tupleSize: 4, value: vec(attribute("upB", 3), attribute("kSigned")) },
    "pack2",
  );
  const pack3 = g.add(
    setAttribute,
    { name: "pack3", tupleSize: 4, value: vec(attribute("tangent", 3), attribute("bucket")) },
    "pack3",
  );
  // WHERE A PLACEMENT GETS ITS SCALE FROM. Every lookup already transfers
  // the lap fraction; carrying the lap's length and the half-width in the
  // same column makes them travel for free, and it is why nothing
  // downstream has to be handed a number from the build. Replaces a bare
  // `curveU` transfer, so it costs no extra node anywhere.
  const uref = g.add(
    setAttribute,
    {
      name: "uref",
      tupleSize: 4,
      value: vec(
        attribute("curveU"),
        attribute("lapW"),
        attribute("halfWidth"),
        attribute("leanCode"),
      ),
    },
    "uref",
  );
  chain(g, [cdfNorm, pack0, pack1, pack2, pack3, uref]);

  // ---------------------------------------------------------------- //
  // 2. Inverse-transform sampling, in lanes.
  // ---------------------------------------------------------------- //
  //
  // Each profile's frames are re-embedded at (its own CDF, its lane, 0)
  // and the three lanes merged into one lookup cloud. Anchors sit at
  // (u, their lane, 0), so ONE nearest-point transfer serves all three
  // profiles: the lanes are further apart than any CDF distance, so a
  // nearest neighbour can never cross one.
  const laneNodes: NodeHandle[] = [];
  PROFILES.forEach((p, i) => {
    const lane = g.add(
      setAttribute,
      {
        name: "P",
        tupleSize: 3,
        value: vec(component(attribute("cdf", 3), i), i * LANE, 0),
      },
      `lane_${p}`,
    );
    g.connect(uref, "out", lane, "in");
    laneNodes.push(lane);
  });
  const lanes = mergeAll(g, laneNodes, "lanes");

  // The anchors. One cloud per profile, each with an EXACT count, so the
  // kit's mix is a property of the graph rather than of a random draw.
  const anchorNodes: NodeHandle[] = [];
  const anchorByProfile: Record<string, NodeHandle<PointLineParams>> = {};
  const kindByProfile: Record<string, NodeHandle<SetAttributeParams>> = {};
  const archetypesByProfile: Record<string, string[]> = {};
  PROFILES.forEach((p, i) => {
    const n = Math.max(1, Math.round(countByProfile[p] ?? 0));
    // The preset's OWN vocabulary, not the union. The two kits describe
    // different eras' art and drawing from both would dress one lap from
    // two of them.
    const members = archetypesFor(preset.vocabulary).filter((a) => a.profile === p);
    // A profile a vocabulary does not use gets no cloud at all. The
    // geometry kit has nothing on the `clustered` curve — nothing in it
    // rises with tightness the way that curve does — and an anchor cloud
    // with an empty archetype table is not an empty cloud, it is a
    // `select` with nothing to select among.
    if (members.length === 0) {
      archetypesByProfile[p] = [];
      return;
    }
    const line = g.add(pointLine, { count: n, includeEnd: false }, `anchors_${p}`);
    // A HASHED UNIFORM through CDF space — deliberately random, not
    // equidistributed.
    //
    // CLUMP, DO NOT SPACE. This used to be a golden-ratio sequence, whose
    // whole purpose is low discrepancy, and a low-discrepancy sequence is
    // the mathematical opposite of what the source material does. Measured
    // against the originals, every repeating family has a gap CV of
    // 1.5–2.5 with a median around 2.0; a family placed evenly reads as
    // wallpaper and the originals never do it. The golden sequence put us
    // at 1.09 overall and 0.68 on the most numerous archetype in the kit
    // — regular enough to be visible as a rhythm nothing in the source has.
    //
    // N independent uniforms in CDF space IS a Poisson process conditioned
    // on N, which is the exponential-gap anchor process the ruleset names;
    // the geometric cluster size below is the other half of it, and the
    // two together are what reproduce the measured signature.
    //
    // The count lesson the golden sequence was brought in for still holds
    // and this keeps it: before either, the draw was a stratified sample
    // permuted by a stride coprime with the count, which baked the count
    // into the expression twice and made it a knob that could be turned
    // but not honoured — raising it sent `mod(index * stride, nOld)`
    // wrapping and the last archetype in each list took everything.
    // A hashed uniform needs to know no count at all.
    const uAnchor = randomField("anchorU");
    const place = g.add(
      setAttribute,
      { name: "P", tupleSize: 3, value: vec(uAnchor, i * LANE, 0) },
      `anchorU_${p}`,
    );
    // Exact per-archetype counts: `select` spreads the weighted table
    // across the domain in order, so each archetype gets its own
    // contiguous block whose size is its share, rounded once.
    const kind = g.add(
      setAttribute,
      {
        name: "archetype",
        type: "string",
        values: members.map((a) => a.id),
        // `weights` are whole COUNTS of repeated table rows, so the
        // calibration's real-valued rates are quantised to a common
        // denominator here. Only the ratio matters, and a thousandth of
        // the largest rate is finer than any of them are known to.
        weights: wholeWeights(members.map((a) => weightByArchetype[a.id] ?? a.rate)),
        // `fraction()`, not index/count: it spans the domain whatever the
        // domain turns out to be, so the kit mix survives a change of
        // count. Exact blocks still, because it is monotone in the index.
        select: fraction(),
      },
      `anchorKind_${p}`,
    );
    g.connect(line, "out", place, "in");
    g.connect(place, "out", kind, "in");
    anchorNodes.push(kind);
    anchorByProfile[p] = line;
    kindByProfile[p] = kind;
    archetypesByProfile[p] = members.map((a) => a.id);
  });
  const anchors = mergeAll(g, anchorNodes, "anchors");

  // The lookup itself. Five transfers: four packs and the lap fraction.
  const cursor = transferChain(g, anchors, lanes, LOOKUP_NAMES, "xfer");

  // ---------------------------------------------------------------- //
  // 3. Clustering: a geometric group size, realised by duplication.
  // ---------------------------------------------------------------- //

  const clusterMean = fmax(
    mul(byArchetype((id) => arch(id).cluster, 1), preset.clusterMean / 1.6),
    1.0001,
  );
  // size = 1 + floor(log(r) / log(1 - 1/mean)), the inverse CDF of a
  // geometric distribution, clamped to what the duplication can realise.
  const clusterN = g.add(
    setAttribute,
    {
      name: "clusterSize",
      value: clamp(
        add(
          1,
          floor(
            div(
              log(fmax(randomField("cluster"), 1e-6)),
              log(sub(1, div(1, clusterMean))),
            ),
          ),
        ),
        1,
        MAX_CLUSTER,
      ),
    },
    "clusterN",
  );
  g.connect(cursor, "out", clusterN, "in");

  const memberLine = g.add(pointLine, { count: MAX_CLUSTER, includeEnd: false }, "memberLine");
  // The source of a copyToPoints contributes its POSITION to every copy,
  // so it has to sit at the origin or every cluster would be dragged off
  // its anchor by the line this index came from.
  const memberIdx = g.add(
    setAttribute,
    { name: "member", value: index() },
    "memberIdx",
  );
  const memberAtOrigin = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: vec(0, 0, 0) },
    "memberAtOrigin",
  );
  g.connect(memberLine, "out", memberIdx, "in");
  g.connect(memberIdx, "out", memberAtOrigin, "in");

  const copies = g.add(
    copyToPoints,
    {
      targetNames: [...LOOKUP_NAMES, "archetype", "clusterSize"],
    },
    "copies",
  );
  g.connect(memberAtOrigin, "out", copies, "source");
  g.connect(clusterN, "out", copies, "target");
  // MAX_CLUSTER copies were made of every anchor; this is where all but
  // the group's own members are dropped.
  const keep = g.add(
    filterByExpression,
    { predicate: lt(attribute("member"), attribute("clusterSize")) },
    "keepMembers",
  );
  g.connect(copies, "out", keep, "in");

  // ---------------------------------------------------------------- //
  // 4. Placement: track coordinates resolved through the banked frame.
  // ---------------------------------------------------------------- //

  const placed = placeFromPack(g, keep, {
    id: "density",
    preset,
    outsideShift,
    variants,
    polygonScale,
    memberOffset: true,
  });

  // ---------------------------------------------------------------- //
  // 5. Legibility: the furniture a corner needs to be readable.
  // ---------------------------------------------------------------- //

  // Stations, laid out on a ring, are what the rule-placed passes look up
  // against. Built once and shared: it is the frames, re-embedded.
  const ring = stationRing(g, uref);

  const parts: NodeHandle[] = [placed];
  if (legibility) {
    const entries = cornerEntries(g, uref, ring);
    parts.push(
      ruleFurniture(g, entries, ring, {
        id: "marker",
        preset,
        outsideShift,
        variants,
        polygonScale,
        backW: MARKER_BACK_W,
        archetype: "corner-marker",
        gate: null,
        variantFrom: "severity",
      }),
    );
    BRAKE_OFFSETS_W.forEach((off, i) => {
      parts.push(
        ruleFurniture(g, entries, ring, {
          id: `brake${i}`,
          preset,
          outsideShift,
          variants,
          polygonScale,
          backW: off,
          archetype: "braking-reference",
          gate: BRAKE_RADIUS_W,
        }),
      );
    });
  }

  if (landmarks) {
    parts.push(
      landmarkPass(g, ring, {
        preset,
        outsideShift,
        variants,
        polygonScale,
        }),
    );
  }

  let merged = mergeAll(g, parts, "allPlacements");

  // ---------------------------------------------------------------- //
  // 6. Coverage fill, then the sightline cull.
  // ---------------------------------------------------------------- //
  //
  // The technique culls BEFORE it fills and then culls again, because
  // dropping a blocker is what opens a coverage hole. Here the fills are
  // added first and one cull runs over everything, which is the same
  // fixed point reached in one pass rather than two: the cull is a pure
  // predicate on a placement, so a fill it would reject is rejected
  // whether it arrives before or after.
  if (coverage) {
    // THE GAP IS ALONG THE LAP, not through space.
    //
    // The placements are re-embedded on a ring scaled so that arc length
    // IS station in half-widths, then pathed in station order. The
    // distance between two consecutive samples is then their station
    // difference and nothing else — where measuring it in world space
    // conflates a real longitudinal gap with two neighbours that merely
    // sit far apart across the track. That was not a theoretical
    // complaint: leaning one placement sideways in the balance pass
    // changed which gaps looked wide, so the coverage pass answered
    // differently depending on a decision that has nothing to do with
    // coverage.
    //
    // The seam comes free. On a ring the last placement and the first are
    // neighbours, and the chord under-reads the arc by g^2/(24 R^2) —
    // four parts in ten thousand at the gap sizes this fires on.
    // The same ring, scaled so its circumference IS the lap in half-widths
    // — which is what makes a segment length a station difference.
    const stationSpace = g.add(
      setAttribute,
      {
        name: "P",
        tupleSize: 3,
        value: ringPos(
          component(attribute("uref", 4), 0),
          div(component(attribute("uref", 4), 1), Math.PI * 2),
        ),
      },
      "stationSpace",
    );
    g.connect(merged, "out", stationSpace, "in");
    const ordered = g.add(
      pointsToPath,
      { closed: true, orderAttr: "stationW" },
      "byStation",
    );
    g.connect(stationSpace, "out", ordered, "in");
    // pathSegments drops point attributes and carries PRIMITIVE ones, so
    // the scale is promoted onto the path before the segments are taken.
    // Without it the gap threshold would be the last build-time constant
    // in the graph, and one is as disqualifying as forty-one.
    const orderedScale = g.add(
      promoteAttribute,
      { name: "uref", from: "point", to: "primitive", mode: "average" },
      "gapScale",
    );
    g.connect(ordered, "out", orderedScale, "in");
    const segs = g.add(pathSegments, { axis: "+y", radius: 1 }, "gaps");
    g.connect(orderedScale, "out", segs, "in");
    // pathSegments puts the segment's LENGTH on the chosen axis of
    // `scale` — here, in half-widths along the lap, because that is what
    // the ring was scaled to.
    const wide = g.add(
      filterByExpression,
      { predicate: gt(component(attribute("scale", 3), 1), preset.maxFillGapW) },
      "wideGaps",
    );
    g.connect(segs, "out", wide, "in");
    // The fill's archetype is DERIVED, not named. Hard-coding
    // "terrain-shell" quietly injected a named-kit archetype into a lap
    // dressed from the geometry kit — one vocabulary's art appearing in
    // the other's era, which is the one thing the two are separated to
    // prevent. The highest-rate archetype in the preset's own vocabulary
    // is the background mass by construction, and for the named kit it
    // resolves to exactly the archetype that used to be written here.
    const fillId = [...archetypesFor(preset.vocabulary)].sort((a, b) => b.rate - a.rate)[0].id;
    const named = g.add(
      setAttribute,
      { name: "archetype", type: "string", stringValue: fillId },
      "fillKind",
    );
    g.connect(wide, "out", named, "in");
    // The midpoint sits on the station ring, so its angle IS the lap
    // fraction it fills — read back with atan2 and wrapped, then looked
    // up on the frame ring like every other rule-placed thing.
    const midU = g.add(
      setAttribute,
      {
        name: "fillU",
        value: wrapU(
          div(atan2(component(position(), 1), component(position(), 0)), Math.PI * 2),
        ),
      },
      "fillU",
    );
    g.connect(named, "out", midU, "in");
    const fillCursor = lookupAtStation(g, midU, ring, attribute("fillU"), "fillLook", LOOKUP_NAMES);
    const fills = placeFromPack(g, fillCursor, {
      id: "fill",
      // Placed where a gap was, not where the density asked. It still
      // leans with its stretch, so it is not `rulePlaced`.
      byRule: true,
      preset,
      outsideShift,
      variants,
      polygonScale,
      // Fills lean with their stretch too. The technique runs balance
      // AFTER the fills for exactly this reason: a fill lands wherever the
      // lap happened to be thin, which is a side the density pass never
      // chose, and leaving it out puts objects in a committed stretch that
      // the commitment does not cover. Flipping one costs nothing —
      // coverage is measured along the lap, not across it.
      memberOffset: false,
    });
    merged = mergeAll(g, [merged, fills], "withFills");
  }

  if (sightline) {
    merged = cullSightline(g, merged, uref, ring);
  }

  // Spawn-ready transforms, and the reporting columns the metrics read.
  const facing = g.add(
    setAttribute,
    {
      name: "faceDir",
      tupleSize: 3,
      value: add(
        mul(unpack3("pack3", 4), cos(attribute("yaw"))),
        mul(unpack3("pack1", 4), sin(attribute("yaw"))),
      ),
    },
    "facing",
  );
  g.connect(merged, "out", facing, "in");
  const oriented = g.add(
    orientAlongVector,
    { direction: attribute("faceDir", 3), up: unpack3("pack2", 4), axis: "+z" },
    "oriented",
  );
  g.connect(facing, "out", oriented, "in");
  const scaled = g.add(
    setAttribute,
    {
      name: "scale",
      tupleSize: 3,
      value: vec(
        mul(attribute("footprintW"), component(attribute("uref", 4), 2)),
        mul(attribute("tallnessW"), component(attribute("uref", 4), 2)),
        mul(attribute("footprintW"), component(attribute("uref", 4), 2)),
      ),
    },
    "scaled",
  );
  g.connect(oriented, "out", scaled, "in");

  g.output(scaled, "out", "placements");
  g.output(uref, "out", "frames");

  if (ribbon) {
    // The road surface, from the frames chain rather than from a second
    // curve: `width` is field-capable on the input points and reads the
    // SAME `halfWidth` attribute every placement rule is stated in, so a
    // host that turns `halfWidthN.value` moves the ribbon and the rules
    // together. `frame: "curveFrame"` reads the `curveNormal` that
    // `writeCurveFrame` already wrote, which is what makes the ribbon
    // inherit the lap's bank instead of lying flat through the corners.
    //
    // The colour is the corner model made visible, and it is written on
    // the FRAMES rather than on the swept surface: the sweep copies point
    // attributes around each ring, so one value per frame paints the
    // whole band. Component by component rather than a `select` between
    // two vec3s, because these are scalar ramps and a scalar `isCorner`
    // choosing between two tuples is a broadcast this does not need.
    const k = attribute("isCorner");
    const roadColor = g.add(
      setAttribute,
      {
        name: "color",
        tupleSize: 3,
        value: vec(add(0.22, mul(0.48, k)), add(0.24, mul(0.14, k)), add(0.29, mul(-0.16, k))),
      },
      "roadColor",
    );
    g.connect(uref, "out", roadColor, "in");
    // `frame: "upHint"` with the technique's OWN banked up, not
    // `curveFrame`. `writeCurveFrame` carries a rotation-minimizing frame
    // along the lap, which is the right thing for a tube and the wrong
    // thing for a road: it is free to roll, and by a third of the way
    // round this lap its normal has drifted about twenty degrees off
    // vertical — so a ribbon swept on it banks where the track does not
    // and, given a long enough circuit, ends up standing on edge. `upB`
    // is the banked up the corner model computed, which is the same
    // vector the placements are oriented against.
    const road = g.add(
      sweepProfile,
      { profile: "ribbon", width: mul(2, HW), frame: "upHint", up: attribute("upB", 3) },
      "road",
    );
    g.connect(roadColor, "out", road, "in");
    g.output(road, "out", "road");
  }

  if (spawn) {
    // Every archetype onto the nearest placeholder shape the preview
    // knows. This is the technique's "bind art to the template" step in
    // its cheapest possible form: the kit says what each family IS and
    // how big, and one asset per family is what art would model. A box at
    // the right footprint and tallness is enough to read the COMPOSITION,
    // which is the thing this generates — the assets are not the output.
    const asset = g.add(
      setAttribute,
      {
        name: "asset",
        type: "string",
        values: [...ASSET_TABLE],
        value: byAttribute(
          "archetype",
          Object.fromEntries(ALL_ARCHETYPES.map((a) => [a.id, ASSET_TABLE.indexOf(assetFor(a.id))])),
          0,
        ),
      },
      "assetName",
    );
    g.connect(scaled, "out", asset, "in");
    const batches = g.add(spawnInstances, { assetAttr: "asset" }, "spawned");
    g.connect(asset, "out", batches, "in");
    g.output(batches, "instances", "instances");
  }

  return {
    graph: g,
    nodes: {
      splineIn: spineSource as NodeHandle<{ items: unknown[] }>,
      halfWidth: halfWidthN,
      leanCode: leanCodeN,
      anchors: anchorByProfile,
      anchorKind: kindByProfile,
    },
    archetypesByProfile,
  };
}

/** Wire a straight run of single-input single-output nodes. */
function chain(g: Graph, nodes: readonly NodeHandle[]): void {
  for (let i = 1; i < nodes.length; i++) g.connect(nodes[i - 1], "out", nodes[i], "in");
}

/** Concatenate several clouds, or pass a lone one straight through. */
function mergeAll(g: Graph, nodes: readonly NodeHandle[], id: string): NodeHandle {
  if (nodes.length === 1) return nodes[0];
  const merged = g.add(mergePoints, {}, id);
  for (const n of nodes) g.connect(n, "out", merged, "in");
  return merged;
}

/**
 * Pull `names` off the nearest point of `source`, one transfer each.
 *
 * `transferAttribute` moves exactly one attribute per node, so every
 * lookup in this file is a chain of them against one source. Written once
 * here rather than at each site, so the sites differ only in what they
 * look up and where from.
 */
function transferChain(
  g: Graph,
  dest: NodeHandle,
  source: NodeHandle,
  names: readonly string[],
  id: string,
): NodeHandle {
  let cursor = dest;
  for (const name of names) {
    const t = g.add(transferAttribute, { name, mapping: "nearest" }, `${id}_${name}`);
    g.connect(cursor, "out", t, "in");
    g.connect(source, "out", t, "source");
    cursor = t;
  }
  return cursor;
}

/**
 * Real-valued shares as whole counts, which is what `setAttribute`'s
 * weighted string table takes: a weight stands for the repeated table
 * rows it replaces, so it cannot be fractional. Ratios are preserved to
 * three figures, and anything the calibration kept at all keeps at least
 * one row — an archetype rounded to zero would vanish from the kit.
 */
function wholeWeights(rates: readonly number[]): number[] {
  const top = Math.max(...rates, 0);
  if (!(top > 0)) return rates.map(() => 1);
  return rates.map((r) => (r > 0 ? Math.max(1, Math.round((r / top) * 1000)) : 0));
}

/** Every archetype by id. Built once; `arch` is called from inside loops
 * over the whole kit, so a scan here is a scan per scan. */
const BY_ID = new Map(ALL_ARCHETYPES.map((a) => [a.id, a]));

/** The archetype record for an id, which the kit guarantees exists. */
function arch(id: string) {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`racetrack: unknown archetype ${JSON.stringify(id)}`);
  return a;
}

/**
 * Resolve track coordinates into the world through the banked frame, and
 * write every column a placement carries.
 */
function placeFromPack(
  g: Graph,
  input: NodeHandle,
  o: {
    id: string;
    preset: Preset;
    outsideShift: number;
    variants: Readonly<Record<string, number>>;
    polygonScale: number;
    memberOffset: boolean;
    /** How this archetype picks its art variant. */
    variantFrom?: "random" | "severity" | "index";
    /** Read the side from `cornerK` rather than from the local frame. */
    sideFromCorner?: boolean;
    /** Placed by a rule, so never mirrored by the balance pass. */
    rulePlaced?: boolean;
    /**
     * Was this placement put here by a RULE rather than drawn from the
     * density?
     *
     * Separate from `rulePlaced`, which decides whether the balance pass
     * may lean it — two different questions that happen to agree for the
     * legibility furniture and disagree for the coverage fill. A fill
     * leans with its stretch like anything else, so it is movable; but it
     * is placed where a gap was, not where the density asked, so the
     * rhythm metrics must not read it as decoration.
     */
    byRule?: boolean;
  },
): NodeHandle {
  const { preset, id } = o;
  // The three scales, read off the placement rather than closed over.
  const lapU = component(attribute("uref", 4), 0);
  const HW = component(attribute("uref", 4), 2);
  const base = unpack3("pack0", 4);
  const rightB = unpack3("pack1", 4);
  const upB = unpack3("pack2", 4);
  const tangent = unpack3("pack3", 4);
  const stationW = component(attribute("pack0", 4), 3);
  const radiusW = component(attribute("pack1", 4), 3);
  const kSigned = component(attribute("pack2", 4), 3);

  // Which side. Inside a bend the archetype's own bias decides, against
  // the OUTSIDE — which is the side away from the centre of the turn, so
  // the opposite sign to the curvature. On a straight there is no outside,
  // and a slow drift gives the lap stretches that lean one way without
  // ever being one-sided overall.
  const outside = mul(-1, sign(kSigned));
  // The calibration's additive shift, clamped: an additive step preserves
  // the ORDERING of the biases, so the one archetype that leans INSIDE a
  // bend stays the one that leans inside.
  //
  // RULE-PLACED furniture is exempt from both the shift and the clamp. A
  // corner marker is a language rather than a decoration — the same
  // object always means the same kind of corner, and a player learns it
  // in one lap and brakes on it in the second — so one that turns up on
  // the inside is not a nudged statistic, it is a lie about the corner.
  // The clamp exists to keep the DENSITY pass's biases apart from each
  // other, and it has no business reaching this.
  const ruled = new Set(RULE_ARCHETYPES.map((a) => a.id));
  const bias = byArchetype(
    (x) =>
      ruled.has(x)
        ? arch(x).outsideBias
        : clampNum(arch(x).outsideBias + o.outsideShift, 0.25, 0.92),
    0.5,
  );
  const inBendPick = select(lt(randomField(`${id}-side`), bias), outside, mul(-1, outside));
  const drift = mul(0.45, sin(add(mul(lapU, Math.PI * 4), 0.9)));
  const straightPick = select(gt(add(randomField(`${id}-drift`), drift), 0.5), 1, -1);
  const side = o.sideFromCorner
    // `select` rather than `-sign`: sign(0) is 0, and a side of ZERO is
    // not a side — it puts the object on the centreline, in the one band
    // the zone model forbids anything to occupy. A corner whose curvature
    // probe reads exactly zero takes a side rather than none.
    ? select(gt(attribute("cornerK"), 0), -1, 1)
    : select(lt(radiusW, CORNER_RADIUS_W), inBendPick, straightPick);

  // WIDE THINGS SIT FURTHER OUT, and the two draws have to know it.
  //
  // Measured on the source material, an archetype's lateral offset and
  // its across extent are positively correlated — 0.80 on chevron boards,
  // 0.60 on terrain shells — because a wide piece was pushed outboard and
  // a narrow one tucked in, keeping the near face clear at either size.
  // Two independent uniforms manufacture the pairing that was never made:
  // wide and near.
  //
  // The mixing is a linear blend between an independent stream and the
  // size stream. THE BLEND WEIGHT IS NOT THE CORRELATION, which is the
  // trap here: blending two independent equal-variance streams at weight
  // w yields a correlation of w / sqrt(w^2 + (1-w)^2), so passing r
  // straight in overshoots — 0.6 lands at 0.83 and 0.8 at 0.97, which
  // pushes wide pieces further out than the source material does and
  // flatters every corridor measurement taken afterwards. Inverting it is
  // one line of host arithmetic: k = r / sqrt(1 - r^2), w = k / (1 + k).
  //
  // It is still an APPROXIMATION — the spec states a correlation rather
  // than a sampling model, and this is the simplest draw that reproduces
  // the stated statistic. At r = 0 it is bit-identical to the independent
  // draw it replaces.
  // SIGN MATTERS. Four archetypes correlate NEGATIVELY within a family —
  // wall panels, billboards, overhead signs and lamp arms sit closer as
  // they get wider — and three of those flip sign between the overall and
  // within-family figures, which is why the kit carries the within-family
  // one. A negative r is the same blend against the size stream REVERSED,
  // so the weight is computed from |r| and the flag picks `u` or `1 - u`.
  const uAcross = tri(`${id}-across`);
  const wOf = byArchetype((x) => {
    const r = clampNum(Math.abs(arch(x).offsetSizeR ?? 0), 0, 0.999);
    if (r === 0) return 0;
    const k = r / Math.sqrt(1 - r * r);
    return k / (1 + k);
  }, 0);
  const negOf = byArchetype((x) => ((arch(x).offsetSizeR ?? 0) < 0 ? 1 : 0), 0);
  // `neg ? 1 - u : u`, without a branch: at neg = 0 it is u, at 1 it is 1 - u.
  const uToward = add(negOf, mul(sub(1, mul(2, negOf)), uAcross));
  const uLat = lerp(tri(`${id}-lat`), uToward, wOf);
  const lat = rangeByArchetype((x) => arch(x).lateralW);
  // TWO DRAWS, BLENDED ON A 0/1 FLAG, because the two kits are measured
  // differently and one shape cannot serve both. A row with only an
  // interquartile pair is drawn triangularly across it, for the reason
  // `tri` gives. A row with a ladder is drawn UNIFORMLY IN `u` and the
  // ladder carries the shape, because it is the distribution rather than
  // a model of it.
  //
  // Neither triangular nor uniform over a bounded envelope reaches the
  // verge band, and that is a fact about the source rather than about
  // tuning: measured over this kit, a triangular draw across the
  // quartiles puts 0.7% of placements in the verge, across p10–p90 1.7%,
  // uniform across p10–p90 3.9%, and the ladder 7.5% against a measured
  // 8.1%. An A/B between the two bounded shapes read as a wash here for a
  // second reason worth remembering: the host's correction loop was
  // absorbing most of the error, so it compared two already-corrected
  // results. Sample a draw with the loop OFF before believing it.
  //
  // Separate streams from the triangular ones on purpose. No archetype
  // uses both branches, so a row without a ladder draws exactly what it
  // drew before the ladders arrived.
  const uLatL = randomField(`${id}-lat-ladder`);
  const uAcrossL = randomField(`${id}-across-ladder`);
  const hasLatLadder = byArchetype((x) => (arch(x).lateralLadder ? 1 : 0), 0);
  const hasAcrossLadder = byArchetype((x) => (arch(x).acrossLadder ? 1 : 0), 0);
  const latLadder = ladderByArchetype(
    (a) => a.lateralLadder,
    (a) => (a.lateralW[0] + a.lateralW[1]) / 2,
    uLatL,
  );
  const acrossLadder = ladderByArchetype(
    (a) => a.acrossLadder,
    (a) => (extentsOf(a).across[0] + extentsOf(a).across[1]) / 2,
    uAcrossL,
  );
  const hgt = rangeByArchetype((x) => arch(x).heightW);
  // Seating, for the three archetypes where the measurement and the
  // published envelope disagree. See `baseW` in the kit.
  const seatBase = rangeByArchetype((x) => arch(x).baseW ?? [0, 0]);
  const seated = byArchetype((x) => (arch(x).baseW ? 1 : 0), 0);
  const fp = rangeByArchetype((x) => arch(x).footprintW);
  // The two horizontal extents, carried BESIDE `footprintW` rather than
  // replacing it: the metrics are stated on the published footprint and
  // must keep reading it, while anything that has to know how much room a
  // placement actually takes — drawing it, testing the corridor against
  // its geometry, seating a user's asset — needs the pair. Unmeasured
  // archetypes fall back to the square the kit described before they were
  // separated, so nothing moves until the measurement arrives.
  const along = rangeByArchetype((x) => extentsOf(arch(x)).along);
  const across = rangeByArchetype((x) => extentsOf(arch(x)).across);
  const tall = rangeByArchetype((x) => arch(x).tallnessW);
  const push = byArchetype((x) => preset.lateralPush[x] ?? 1, 1);

  // THE BALANCE PASS. Two stretches of the lap commit to a hard lean each
  // way, so the dressing has somewhere it deliberately favours a side
  // rather than being evenly grey everywhere. Two things are never
  // mirrored, and both matter: anything INSIDE a bend, because which side
  // of a corner an object sits on carries meaning, and rule-placed
  // furniture, because that meaning is the whole reason it exists.
  // Binned by where the object ENDS UP, not by where its anchor sat. A
  // cluster member is offset along the lap from the anchor it was copied
  // from, so near a tenth boundary the two disagree — and the placement
  // then lands in one stretch while being leaned by the rules of another.
  // Two placements out of 450, which is exactly the size of bug that
  // survives a metric and dies to an exact assertion.
  const ownU = o.memberOffset
    ? mod(add(add(lapU, div(mul(attribute("member"), 0.55), component(attribute("uref", 4), 1))), 1), 1)
    : lapU;
  const tenth = floor(mul(ownU, 10));
  // Unpacked from the code the frames carry: digit `tenth`, base 3,
  // shifted so 0/1/2 reads as left/neutral/right. Ten literals used to sit
  // here in a `select` chain, which meant the one pass a host could not
  // re-aim was the one that decides where the lap leans.
  const lean = sub(
    mod(floor(div(component(attribute("uref", 4), 3), pow(3, tenth))), 3),
    1,
  );
  // Rule-placed is its own flag. It used to be inferred from
  // `variantFrom`, which a landmark also sets — so landmarks were treated
  // as legibility furniture and silently exempted from the lean they
  // should take. Two different questions, and one of them was answering
  // the other.
  const movable = o.rulePlaced ? 0 : gt(radiusW, CORNER_RADIUS_W);
  const leaned = select(mul(movable, ne(lean, 0)), lean, side);

  /** One `lerp` between an archetype range's two ends, as a node. */
  const fromRange = (attr: string, range: Field, tag: string, nodeId: string): NodeHandle =>
    g.add(
      setAttribute,
      { name: attr, value: lerp(component(range, 0), component(range, 1), tri(`${id}-${tag}`)) },
      `${id}${nodeId}`,
    );

  const latN = g.add(
    setAttribute,
    {
      name: "lateralW",
      // The push is INSIDE the clamp, not outside it: a preset that pulls
      // an archetype inboard must not be able to pull a clamped piece
      // back onto the racing line.
      value: mul(
        leaned,
        // SMALL ART IS LIFTED, LARGE ART IS MOVED ASIDE, and the split is
        // the source's own: a piece narrower than one half-width and
        // shorter than one and a half is small enough for "inside the
        // corridor" to describe it, and those are the pieces the material
        // puts over the track — cameras, signs, the gantries they hang
        // from. Anything bigger whose bounds centre lands on the racing
        // line is a wall across it, which no source circuit has and no
        // lap should read as. See where `heightW` is set for the lift.
        //
        // Aside means to the corridor's edge and no further, so the piece
        // stays in the verge band it was drawn into rather than being
        // pushed out of the mix.
        fmax(
          mul(
            push,
            lerp(lerp(component(lat, 0), component(lat, 1), uLat), latLadder, hasLatLadder),
          ),
          mul(
            mul(
              byArchetype((x) => (arch(x).zone === "Z7" || arch(x).zone === "Z8" ? 0 : 1), 1),
              sub(1, mul(lt(attribute("acrossW"), 1), lt(attribute("tallnessW"), 1.5))),
            ),
            CORRIDOR.halfWidthW,
          ),
        ),
      ),
    },
    `${id}Lat`,
  );
  const byRuleN = g.add(
    setAttribute,
    { name: "byRule", type: "i32", value: (o.byRule ?? o.rulePlaced) ? 1 : 0 },
    `${id}ByRule`,
  );
  // HEIGHT IS DRAWN AFTER TALLNESS, and the order is load-bearing: a
  // seated archetype's centre is its base plus half its own height, so
  // the height draw has to be able to read the tallness draw. `lerp` on a
  // 0/1 flag rather than a branch — the grammar has no branch, and the
  // two expressions are cheap enough that evaluating both costs less than
  // a select over tuples would.
  const drawnHeight = lerp(
    lerp(component(hgt, 0), component(hgt, 1), tri(`${id}-h`)),
    add(
      lerp(component(seatBase, 0), component(seatBase, 1), tri(`${id}-base`)),
      div(attribute("tallnessW"), 2),
    ),
    seated,
  );
  // THE CORRIDOR IS DEFENDED BY HEIGHT, NOT BY OFFSET, and that is the
  // source's own answer rather than ours. An earlier version floored the
  // lateral envelope at the corridor's edge, which keeps anchors out of
  // the driver's way by moving them aside; the material moves them up.
  // `micro-detail` inside `|t|` of 1W has a median base 1.76W above the
  // deck against 0.95W for the same archetype outboard — it rises as it
  // comes inboard. Of the archetypes whose geometry reaches over the
  // corridor, the ones that belong there clear the ceiling and the
  // ground-hugging ones are merely beside it.
  //
  // It is not a cosmetic difference. `micro-detail` is the single largest
  // contributor to the verge band, and a lateral floor throws away
  // exactly the mass below 1W that puts it there. Lifting instead keeps
  // the offset distribution measured and still gives Z-1 what it asks
  // for: no anchor over the track at driving height, ever.
  //
  // Z7 and Z8 are exempt because being over or under the track is what
  // those bands MEAN — a tunnel bore is anchored on the racing line
  // because a bore surrounds it. The lift is by the deficit, so anything
  // already clear of the ceiling is untouched.
  //
  // WHAT IT COSTS, MEASURED, because it is the largest deliberate
  // distortion in this pipeline. Between 4.4% and 10.8% of placements are
  // anchored inside one half-width depending on the preset, and about
  // half of those would draw below the ceiling on their own. Every one of
  // them is lifted, and the band model reads anything above the ceiling
  // inside 1.5W as over-track rather than verge — so the rule transfers
  // roughly 2 to 6 points from verge to over. With the lift switched off
  // the late preset reproduces all six bands to within half a point
  // (over 15.7 against 15.7, verge 8.2 against 8.1); with it on, over
  // reads 17.9 and verge 6.0.
  //
  // KEPT ANYWAY, and the reason is the same one that keeps the sightline
  // cull. The source does put a little art low over the track — 47
  // objects of 7,371, on half the circuits — so this rule is stricter
  // than the material, exactly like the look-ahead guarantee. What it
  // buys is that no lap ever centres a mass archetype on the racing line
  // at deck height, which for a demo about whether a layout READS is
  // worth more than two points of a band. The alternative is not a
  // cheaper lift: it is large art in the driver's way, about fifteen
  // pieces a lap.
  //
  // The narrower rule is a joint distribution rather than a rule at all.
  // The source's objects inside one half-width are mostly high because
  // they are gantries, overhead signs and the cameras mounted on them,
  // and a marginal ladder cannot express that. Lifting is the crude
  // stand-in for the joint, and it over-applies by roughly the half that
  // would have drawn high anyway.
  const overTrack = mul(
    mul(
      lt(fmax(attribute("lateralW"), mul(-1, attribute("lateralW"))), CORRIDOR.halfWidthW),
      byArchetype((x) => (arch(x).zone === "Z7" || arch(x).zone === "Z8" ? 0 : 1), 1),
    ),
    mul(lt(attribute("acrossW"), 1), lt(attribute("tallnessW"), 1.5)),
  );
  const deficit = fmax(
    sub(add(CORRIDOR.ceilingW, div(attribute("tallnessW"), 2)), drawnHeight),
    0,
  );
  const hN = g.add(
    setAttribute,
    { name: "heightW", value: add(drawnHeight, mul(overTrack, deficit)) },
    `${id}Height`,
  );
  const fpN = fromRange("footprintW", fp, "fp", "Foot");
  // Drawn from their own streams, so adding them moved no other column.
  const alongN = fromRange("alongW", along, "along", "Along");
  // The across extent's own draw, named because the lateral offset reads
  // it too — see `uAcross` below.
  const acrossN = g.add(
    setAttribute,
    {
      name: "acrossW",
      value: lerp(
        lerp(component(across, 0), component(across, 1), uAcross),
        acrossLadder,
        hasAcrossLadder,
      ),
    },
    `${id}Across`,
  );
  const tallN = fromRange("tallnessW", tall, "tall", "Tall");
  // A sprite is a camera-facing quad and costs one polygon; a preset that
  // asks for none rebuilds every sprite archetype AS GEOMETRY at 22, which
  // is a change of kit rather than of ratio — the same silhouettes, built
  // rather than drawn. The scale on top is the polygon budget: a hardware
  // decision, applied to the kit's counts, never to the placement count,
  // which is a composition decision.
  const spriteLive = (x: string): boolean => preset.spriteShare > 0 && arch(x).kind === "sprite";
  const polyN = g.add(
    setAttribute,
    {
      name: "polygons",
      type: "i32",
      value: byArchetype(
        (x) =>
          Math.max(
            1,
            Math.round((spriteLive(x) ? arch(x).polygons : Math.max(arch(x).polygons, arch(x).kind === "sprite" ? 22 : 0)) * o.polygonScale),
          ),
        1,
      ),
    },
    `${id}Poly`,
  );
  const spriteN = g.add(
    setAttribute,
    { name: "isSprite", type: "i32", value: byArchetype((x) => (spriteLive(x) ? 1 : 0), 0) },
    `${id}Sprite`,
  );
  // The art variant, which is what a FAMILY is: one asset per family, and
  // a family is an archetype plus a variant. Corner markers key theirs to
  // the corner's SEVERITY, so the same object always means the same kind
  // of corner and a player learns the language in one lap; landmarks take
  // one each, because a landmark sharing a family with another landmark
  // is not a landmark.
  const severity = select(
    lt(attribute("cornerR"), BUCKET_EDGES.tight),
    2,
    select(lt(attribute("cornerR"), BUCKET_EDGES.medium), 1, 0),
  );
  const variantValue =
    o.variantFrom === "severity"
      ? severity
      : o.variantFrom === "index"
        ? index()
        : floor(
            mul(randomField(`${id}-variant`), byArchetype((x) => Math.max(1, o.variants[x] ?? 1), 1)),
          );
  const variantN = g.add(
    setAttribute,
    { name: "variant", type: "i32", value: variantValue },
    `${id}Variant`,
  );
  const zoneN = g.add(
    setAttribute,
    { name: "zone", type: "i32", value: byArchetype((x) => Number(arch(x).zone.slice(1)), 0) },
    `${id}Zone`,
  );
  const stationN = g.add(
    setAttribute,
    {
      name: "stationW",
      value: o.memberOffset
        ? add(stationW, mul(attribute("member"), 0.55))
        : stationW,
    },
    `${id}Station`,
  );
  // Signage, markers and roadside furniture face the oncoming driver;
  // everything else takes a free rotation, which is what keeps repeated
  // instances of one asset from reading as a stamped row.
  const facesDriver = byArchetype(
    (x) => (["overhead-sign", "banner", "chevron-board", "camera-post", "corner-marker", "braking-reference", "billboard"].includes(x) ? 1 : 0),
    0,
  );
  const yawN = g.add(
    setAttribute,
    {
      name: "yaw",
      value: select(
        gt(facesDriver, 0.5),
        add(Math.PI, mul(sub(randomField(`${id}-yawj`), 0.5), 0.36)),
        mul(randomField(`${id}-yaw`), Math.PI * 2),
      ),
    },
    `${id}Yaw`,
  );
  const posN = g.add(
    setAttribute,
    {
      name: "P",
      tupleSize: 3,
      value: add(
        add(
          base,
          o.memberOffset
            ? mul(tangent, mul(mul(attribute("member"), 0.55), HW))
            : mul(tangent, 0),
        ),
        add(mul(rightB, mul(attribute("lateralW"), HW)), mul(upB, mul(attribute("heightW"), HW))),
      ),
    },
    `${id}Pos`,
  );
  // ORDER IS LOAD-BEARING HERE. Tallness and the across extent are drawn
  // FIRST because two later columns read them: the height draw seats a
  // seated archetype from its own tallness, and both the corridor rule
  // and the offset need to know how much room the piece takes before
  // they can decide whether it belongs on the racing line.
  chain(g, [input, tallN, acrossN, latN, byRuleN, hN, fpN, alongN, polyN, spriteN, variantN, zoneN, stationN, yawN, posN]);
  return posN;
}

/**
 * A position on the lap, embedded on a RING.
 *
 * Every "look up the frame at station s" in the passes below is a
 * nearest-point transfer, and a nearest-point transfer needs the thing it
 * searches to be a position. Laying positions out on a LINE would work
 * everywhere except across the start line, where 0 and 1 are the same
 * place and the furthest apart on the line — so a marker for a corner
 * that spans the seam would look up a frame half a lap away. On a ring
 * the seam is not a special case at all.
 *
 * Parameterised by LAP FRACTION rather than by station, and the radius is
 * an arbitrary constant of the lookup space rather than anything about
 * the track. That is what keeps the lap's length out of it: a cloud that
 * knows only "seven tenths of the way round" can be placed on this ring,
 * where one placed by station would have to be told how long the lap is
 * first. The frames convert once, from what they already carry; nothing
 * else has to.
 *
 * This is the same move the density pass makes with its CDF lanes: give a
 * scalar coordinate a geometry so that "nearest" can answer questions
 * about it.
 */
function ringPos(lapFraction: FieldLike, radius: FieldLike = RING_R): Field {
  const a = mul(lapFraction, Math.PI * 2);
  return vec(mul(cos(a), radius), mul(sin(a), radius), 0);
}

/**
 * Wrap a lap FRACTION into [0, 1). Distances along the lap arrive in
 * half-widths and are converted by the caller, which is the only place
 * that needs to know how long the lap is.
 */
function wrapU(u: FieldLike): Field<1> {
  return mod(add(u, 1), 1) as Field<1>;
}

/**
 * The frames laid out on the station ring, which is what every station
 * lookup in the passes below transfers FROM.
 */
function stationRing(g: Graph, packed: NodeHandle): NodeHandle {
  const ring = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: ringPos(attribute("curveU")) },
    "stationRing",
  );
  g.connect(packed, "out", ring, "in");
  return ring;
}

/**
 * Move `dest` onto the lap ring at `lapFraction` and pull `names` off the
 * frame that lands nearest. Returns the last transfer.
 */
function lookupAtStation(
  g: Graph,
  dest: NodeHandle,
  ring: NodeHandle,
  lapFraction: FieldLike,
  id: string,
  names: readonly string[],
): NodeHandle {
  const at = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: ringPos(lapFraction) },
    `${id}At`,
  );
  g.connect(dest, "out", at, "in");
  return transferChain(g, at, ring, names, id);
}

/**
 * The frames where a corner BEGINS, with the corner's own severity and
 * turn direction carried out of it.
 *
 * A corner entry is a NEIGHBOUR comparison — not a corner here, a corner
 * one frame on — and a field resolves each element from that element
 * alone, so no expression in the grammar can reach it. The move that
 * makes it expressible is the station ring: put every frame at its own
 * station, ask each one for the frame a step further round, and the
 * neighbour arrives as an ordinary transferred attribute.
 *
 * Two things are read from INSIDE the corner rather than at the entry,
 * and both were wrong when read locally. Its DIRECTION: a marker stands
 * several half-widths before the bend, on straight track, and a side
 * chosen from the frame under it is a coin toss. Its SEVERITY: the entry
 * is where the radius has just crossed the corner threshold, so it
 * reports the loosest radius the corner ever has — read there, "tighter
 * than 8W" was never true and the braking references never appeared.
 */
function cornerEntries(g: Graph, packed: NodeHandle, ring: NodeHandle): NodeHandle {
  const here = g.add(
    setAttribute,
    { name: "isCornerHere", value: attribute("isCorner") },
    "cornerHere",
  );
  g.connect(packed, "out", here, "in");
  // The frame one step on. Exactly one step: the ring is parameterised in
  // stations, so the step is the frame spacing by construction rather than
  // a distance that has to agree with an arc length measured elsewhere.
  // Exactly one frame on, in the parameterisation the frames were placed
  // in: `stepU` is the resampler's own step divided by its own length, so
  // no count and no arc length from the build enters it.
  const oneOn = wrapU(add(attribute("curveU"), attribute("stepU")));
  const ahead = lookupAtStation(g, here, ring, oneOn, "flagAhead", ["isCorner"]);
  const entryStation = g.add(
    setAttribute,
    { name: "entryU", value: oneOn },
    "entryStation",
  );
  g.connect(ahead, "out", entryStation, "in");
  // Only the entries, from here on. Everything after this runs on a
  // handful of points rather than every frame.
  const only = g.add(
    filterByExpression,
    { predicate: mul(sub(1, attribute("isCornerHere")), attribute("isCorner")) },
    "cornerOnly",
  );
  g.connect(entryStation, "out", only, "in");
  // The corner itself, probed a fixed distance in.
  const probe = lookupAtStation(
    g,
    only,
    ring,
    wrapU(add(attribute("entryU"), div(SEVERITY_PROBE_W, attribute("lapW")))),
    "bendProbe",
    ["pack1", "pack2"],
  );
  const cornerK = g.add(
    setAttribute,
    { name: "cornerK", value: component(attribute("pack2", 4), 3) },
    "cornerK",
  );
  g.connect(probe, "out", cornerK, "in");
  const cornerR = g.add(
    setAttribute,
    { name: "cornerR", value: component(attribute("pack1", 4), 3) },
    "cornerR",
  );
  g.connect(cornerK, "out", cornerR, "in");
  return cornerR;
}

/**
 * One rule-placed object per corner, `backW` before the entry.
 *
 * Rule-placed rather than drawn from a density: the corner decides where
 * it goes. A marker that is sometimes absent is worse than no marker
 * language at all, which is why this is a pass and not a weighting.
 */
function ruleFurniture(
  g: Graph,
  entries: NodeHandle,
  ring: NodeHandle,
  o: {
    id: string;
    preset: Preset;
    backW: number;
    archetype: string;
    gate: number | null;
    outsideShift: number;
    variants: Readonly<Record<string, number>>;
    polygonScale: number;
    variantFrom?: "random" | "severity" | "index";
  },
): NodeHandle {
  const { id } = o;
  const gated =
    o.gate === null
      ? null
      : g.add(
          filterByExpression,
          { predicate: lt(attribute("cornerR"), o.gate) },
          `${id}Gate`,
        );
  let cursor: NodeHandle = entries;
  if (gated) {
    g.connect(entries, "out", gated, "in");
    cursor = gated;
  }
  const named = g.add(
    setAttribute,
    { name: "archetype", type: "string", stringValue: o.archetype },
    `${id}Kind`,
  );
  g.connect(cursor, "out", named, "in");
  const target = wrapU(sub(attribute("entryU"), div(o.backW, attribute("lapW"))));
  const stationN = g.add(
    setAttribute,
    { name: "furnitureU", value: target },
    `${id}FurnitureStation`,
  );
  g.connect(named, "out", stationN, "in");
  const looked = lookupAtStation(
    g,
    stationN,
    ring,
    attribute("furnitureU"),
    `${id}Look`,
    LOOKUP_NAMES,
  );
  return placeFromPack(g, looked, {
    id,
    preset: o.preset,
    outsideShift: o.outsideShift,
    variants: o.variants,
    polygonScale: o.polygonScale,
    memberOffset: false,
    sideFromCorner: true,
    rulePlaced: true,
    variantFrom: o.variantFrom ?? "random",
  });
}

/**
 * Drop what stands in the driver's view.
 *
 * The test is the CHORD from here to twelve half-widths ahead, not a
 * cone: on a bend the sightline cuts across the INSIDE of the corner,
 * which is exactly the band the rest of the ruleset works to keep open.
 * The far end of each chord is another station lookup, and the chord is
 * densified into points because a nearest-point distance to a sampled
 * segment approximates the distance to the segment to within half the
 * sample spacing.
 */
function cullSightline(
  g: Graph,
  placements: NodeHandle,
  packed: NodeHandle,
  ring: NodeHandle,
): NodeHandle {
  const from = g.add(
    setAttribute,
    { name: "chordFrom", tupleSize: 3, value: position() },
    "chordFrom",
  );
  g.connect(packed, "out", from, "in");
  const ahead = lookupAtStation(
    g,
    from,
    ring,
    wrapU(add(attribute("curveU"), div(LOOK_AHEAD_W, attribute("lapW")))),
    "chordTo",
    ["pack0"],
  );
  const qLine = g.add(pointLine, { count: CHORD_SAMPLES, includeEnd: true }, "chordQ");
  const qAttr = g.add(
    setAttribute,
    { name: "q", value: div(index(), CHORD_SAMPLES - 1) },
    "chordQVal",
  );
  const qOrigin = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: vec(0, 0, 0) },
    "chordQAtOrigin",
  );
  chain(g, [qLine, qAttr, qOrigin]);
  const chordPts = g.add(
    copyToPoints,
    { targetNames: ["chordFrom", "pack0"] },
    "chordPoints",
  );
  g.connect(qOrigin, "out", chordPts, "source");
  g.connect(ahead, "out", chordPts, "target");
  // Both ends read from carried columns rather than from position(): the
  // target's own position is a point on the station ring by now, not a
  // place on the track.
  const chordPos = g.add(
    setAttribute,
    {
      name: "P",
      tupleSize: 3,
      value: lerp(attribute("chordFrom", 3), unpack3("pack0", 4), attribute("q")),
    },
    "chordSpread",
  );
  g.connect(chordPts, "out", chordPos, "in");

  const near = g.add(sampleNearestPoint, { distanceAttr: "chordDist" }, "chordDistance");
  g.connect(placements, "out", near, "in");
  g.connect(chordPos, "out", near, "source");

  // An object's obstruction radius is its half-footprint capped at 2W: a
  // terrain shell nine half-widths across is a backdrop whose near edge is
  // what a driver sees, not a four-and-a-half-wide pillar on the racing
  // line.
  // In half-widths throughout, then converted once — the placements carry
  // their own scale, so nothing here needs to have been told it.
  const hw = component(attribute("uref", 4), 2);
  const cappedW = clamp(div(attribute("footprintW"), 2), 0, SIGHTLINE.maxRadiusW);
  // Plus the sampling's own error bound, so the cull is conservative
  // rather than optimistic. See CHORD_SAMPLES.
  const capped = mul(add(cappedW, CHORD_SLACK_W), hw);
  const blocks = mul(
    mul(lt(attribute("chordDist"), capped), gt(attribute("footprintW"), 2)),
    mul(
      // Exempt: overhead, under-deck and skyline work has no business in
      // the corridor test, and anything entirely above the driver's head
      // or entirely below the eye point cannot stand in the view.
      //
      // Z2, THE VERGE, IS ALSO EXEMPT, for the reason the technique gives
      // for capping a terrain shell's radius rather than believing its
      // footprint. Verge work is barriers, rails and kerb furniture: its
      // footprint is a length ALONG the verge, not a radius across it, so
      // an obstruction DISC of that size is a category error — it reports
      // a four-half-width rail lying beside the track as a
      // four-half-width pillar standing in it. Measured: without this the
      // cull removes the verge band outright, 0.2% achieved against a 6%
      // target, while every other band lands. The corridor rule is what
      // protects the racing line at that offset, and it is scored
      // separately as metric 14.
      mul(lt(attribute("zone"), 6), gt(attribute("zone"), 2)),
      mul(
        gt(add(attribute("heightW"), attribute("tallnessW")), EYE_H_W),
        lt(attribute("heightW"), 3),
      ),
    ),
  );
  const kept = g.add(filterByExpression, { predicate: sub(1, blocks) }, "sightlineCull");
  g.connect(near, "out", kept, "in");
  return kept;
}

/**
 * One landmark in every tenth of the lap, each under a family of its own.
 *
 * The technique adds one only where a stretch has nothing unique in it;
 * this adds one everywhere, which is a superset and reaches the same rule
 * — every tenth of the lap has something in it that is nowhere else. What
 * makes it read as a landmark is that it is BIGGER than its neighbours,
 * not that it is a shape nothing else uses, which is why it is an ordinary
 * Z5 silhouette at an inflated size rather than a special asset.
 */
function landmarkPass(
  g: Graph,
  ring: NodeHandle,
  o: {
    preset: Preset;
    outsideShift: number;
    variants: Readonly<Record<string, number>>;
    polygonScale: number;
  },
): NodeHandle {
  const line = g.add(pointLine, { count: LANDMARK_STRETCHES, includeEnd: false }, "landmarkLine");
  const named = g.add(
    setAttribute,
    { name: "archetype", type: "string", stringValue: "landmark" },
    "landmarkKind",
  );
  g.connect(line, "out", named, "in");
  // Somewhere in its own tenth, but not at the same place in each: an
  // even spacing would read as a row of ten rather than as ten landmarks.
  // In lap FRACTION, which is the one coordinate a fresh point cloud can
  // state without being told anything about the track it is going onto.
  const station = g.add(
    setAttribute,
    {
      name: "landmarkU",
      value: div(
        add(index(), add(0.2, mul(randomField("landmark-place"), 0.6))),
        LANDMARK_STRETCHES,
      ),
    },
    "landmarkStationN",
  );
  g.connect(named, "out", station, "in");
  const looked = lookupAtStation(
    g,
    station,
    ring,
    attribute("landmarkU"),
    "landmarkLook",
    LOOKUP_NAMES,
  );
  // `cornerK` is what `sideFromCorner` reads, and a landmark has no corner
  // — it takes the side its own frame suggests, through the ordinary path.
  return placeFromPack(g, looked, {
    id: "landmark",
    preset: o.preset,
    outsideShift: o.outsideShift,
    variants: o.variants,
    polygonScale: o.polygonScale,
    // A landmark leans with its stretch. It is decoration rather than
    // language — nothing about which side it sits on tells a driver
    // anything — so the two exemptions from mirroring do not cover it,
    // and it reads the same committed-lean table everything else does.
    memberOffset: false,
    variantFrom: "index",
  });
}

/** The placeholder shapes the preview page knows, in table order. */
const ASSET_TABLE = [
  "box",
  "cone",
  "sphere",
  "pine",
  "bush",
  "boulder",
  "house",
  "hall",
  "post",
  "lamp",
  "panel",
  "tube",
] as const;

/** Which placeholder stands in for an archetype, for looking at it. */
function assetFor(id: string): (typeof ASSET_TABLE)[number] {
  switch (id) {
    case "terrain-shell":
    case "ground-detail":
      return "boulder";
    case "bush":
      return "bush";
    case "tree-group":
    case "tree":
      return "pine";
    case "set-piece":
    case "tower":
      return "house";
    case "wall-panel":
      return "hall";
    case "overhead-sign":
    case "banner":
    case "billboard":
      return "panel";
    case "chevron-board":
    case "corner-marker":
    case "braking-reference":
      return "post";
    case "pipe-run":
    case "enclosure-shell":
      return "tube";
    case "lamp-arm":
      return "lamp";
    case "camera-post":
      return "post";
    case "dome":
      return "sphere";
    case "skyline":
    case "landmark":
      return "house";
    case "verge-rail":
      return "box";
    default:
      return "box";
  }
}
