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
 * a host's business, they live in `trackCalibrate.ts`, and the graph is
 * rebuilt with corrected counts. That split is the technique's own: it
 * fits the kit BEFORE placing anything and corrects it AFTER measuring.
 *
 * The one structural compromise is `AffinityProfile`: the graph builds
 * one cumulative distribution per profile rather than per archetype, so
 * three scans serve nineteen archetypes. See `trackKit.ts`.
 */
import {
  type Field,
  type FieldLike,
  add,
  attribute,
  byAttribute,
  clamp,
  cos,
  cross,
  div,
  dot,
  eq,
  exp,
  floor,
  gt,
  index,
  length as vlength,
  lerp,
  log,
  lt,
  max as fmax,
  mod,
  mul,
  ne,
  normalize,
  position,
  randomField,
  select,
  sign,
  sin,
  sub,
  vec,
  component,
} from "../../src/fields/index.js";
import { Graph, type NodeHandle } from "../../src/graph/index.js";
import {
  copyToPoints,
  filterByExpression,
  mergePoints,
  orientAlongVector,
  pathResample,
  pathScan,
  pathSegments,
  pointLine,
  pointsToPath,
  promoteAttribute,
  sampleNearestPoint,
  setAttribute,
  transferAttribute,
  writeCurveFrame,
} from "../../src/nodes/index.js";
import {
  AFFINITY,
  ALL_ARCHETYPES,
  ARCHETYPES,
  BUCKET_EDGES,
  CORNER_RADIUS_W,
  LANDMARK_STRETCHES,
  PROFILES,
  RULE_ARCHETYPES,
  type Preset,
} from "./trackKit.js";

/** How far apart the lanes of CDF space sit. Any value above 1 works. */
const LANE = 10;

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
  /** Lap length in world units, measured by a previous cook. */
  readonly lapLength: number;
  /** Additive shift on every archetype's outside-of-bend bias. */
  readonly outsideShift?: number;
  /** Art variants per archetype. One family per variant. */
  readonly variantsByArchetype?: Readonly<Record<string, number>>;
  /** Multiplier on every kit polygon count, to hit the budget per W. */
  readonly polygonScale?: number;
  /** Tenths of the lap committed to a hard lean, and which way. */
  readonly committedStretches?: Readonly<Record<number, number>>;
  /** Turn the landmark and balance passes on or off. */
  readonly landmarks?: boolean;
  readonly balance?: boolean;
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
  outputs: { placements: string; frames: string };
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
    lapLength,
    seed,
  } = opts;
  const outsideShift = opts.outsideShift ?? 0;
  const variants = opts.variantsByArchetype ?? {};
  const polygonScale = opts.polygonScale ?? 1;
  const committed = opts.committedStretches ?? {};
  const landmarks = opts.landmarks ?? true;
  const balance = opts.balance ?? true;
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
  const spinePath = g.add(pointsToPath, { closed: true }, "spinePath");
  // 'count' rather than 'spacing': a closed path resampled by spacing
  // closes on a REMAINDER segment, and a remainder at the start line is
  // exactly the seam the periodic envelope exists to avoid.
  const centre = g.add(
    pathResample,
    { mode: "count", count: FRAMES, lengthAttr: "lapLen" },
    "centre",
  );
  const frames = g.add(writeCurveFrame, { curvatureName: "curvature" }, "frames");
  const lapLenPt = g.add(
    promoteAttribute,
    { name: "lapLen", from: "primitive", to: "point", mode: "average" },
    "lapLenPt",
  );
  g.connect(spine, "out", spineShape, "in");
  g.connect(spineShape, "out", spinePath, "in");
  g.connect(spinePath, "out", centre, "in");
  g.connect(centre, "out", frames, "in");
  g.connect(frames, "out", lapLenPt, "in");

  // Station in W, the coordinate every distance ALONG the lap is in.
  const stationN = g.add(
    setAttribute,
    { name: "stationW", value: div(mul(attribute("curveU"), attribute("lapLen")), W) },
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
    { name: "radiusW", value: div(1, mul(fmax(vlength(attribute("curvature", 3)), 1e-9), W)) },
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
        tanh(mul(vlength(attribute("curvature", 3)), preset.referenceRadiusW * W)),
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
  chain(g, [lapLenPt, stationN, rightN, upN, kSignN, radN, bucketN, cornerN, bankN, rightB, upB]);

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
  chain(g, [cdfNorm, pack0, pack1, pack2, pack3]);

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
    g.connect(pack3, "out", lane, "in");
    laneNodes.push(lane);
  });
  const lanes = g.add(mergePoints, {}, "lanes");
  for (const l of laneNodes) g.connect(l, "out", lanes, "in");

  // The anchors. One cloud per profile, each with an EXACT count, so the
  // kit's mix is a property of the graph rather than of a random draw.
  const anchorNodes: NodeHandle[] = [];
  PROFILES.forEach((p, i) => {
    const n = Math.max(1, Math.round(countByProfile[p] ?? 0));
    const members = ARCHETYPES.filter((a) => a.profile === p);
    const line = g.add(pointLine, { count: n, includeEnd: false }, `anchors_${p}`);
    // A stratified sample of CDF space, PERMUTED by a stride coprime with
    // the count. Stratification keeps the count exact and the spacing
    // even; the permutation is what stops the archetype assignment below
    // — which reads the same index — from correlating with position, so
    // the first archetype does not occupy the first stretch of the lap.
    const stride = coprimeStride(n);
    const uAnchor = div(add(mod(mul(index(), stride), n), 0.5), n);
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
        select: div(add(index(), 0.5), n),
      },
      `anchorKind_${p}`,
    );
    g.connect(line, "out", place, "in");
    g.connect(place, "out", kind, "in");
    anchorNodes.push(kind);
  });
  const anchors = g.add(mergePoints, {}, "anchors");
  for (const a of anchorNodes) g.connect(a, "out", anchors, "in");

  // The lookup itself. Five transfers: four packs and the lap fraction.
  let cursor: NodeHandle = anchors;
  for (const name of ["pack0", "pack1", "pack2", "pack3", "curveU"]) {
    const t = g.add(transferAttribute, { name, mapping: "nearest" }, `xfer_${name}`);
    g.connect(cursor, "out", t, "in");
    g.connect(lanes, "out", t, "source");
    cursor = t;
  }

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
    { name: "P", tupleSize: 3, value: [0, 0, 0] },
    "memberAtOrigin",
  );
  g.connect(memberLine, "out", memberIdx, "in");
  g.connect(memberIdx, "out", memberAtOrigin, "in");

  const copies = g.add(
    copyToPoints,
    {
      targetNames: ["pack0", "pack1", "pack2", "pack3", "curveU", "archetype", "clusterSize"],
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
    W,
    preset,
    outsideShift,
    lapW: lapLength / W,
    variants,
    polygonScale,
    spriteShare: preset.spriteShare,
    committed: balance ? committed : {},
    lapU: attribute("curveU", 1),
    memberOffset: true,
  });

  // ---------------------------------------------------------------- //
  // 5. Legibility: the furniture a corner needs to be readable.
  // ---------------------------------------------------------------- //

  // Stations, laid out on a ring, are what the rule-placed passes look up
  // against. Built once and shared: it is the frames, re-embedded.
  const lapW = lapLength / W;
  const ring = stationRing(g, pack3, lapW);

  const parts: NodeHandle[] = [placed];
  if (legibility) {
    const entries = cornerEntries(g, pack3, ring, FRAMES, lapW);
    parts.push(
      ruleFurniture(g, entries, ring, {
        id: "marker",
        W,
        lapW,
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
          W,
          lapW,
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
        W,
        lapW,
        preset,
        outsideShift,
        variants,
        polygonScale,
      }),
    );
  }

  let merged: NodeHandle;
  if (parts.length === 1) {
    merged = parts[0];
  } else {
    merged = g.add(mergePoints, {}, "allPlacements");
    for (const p of parts) g.connect(p, "out", merged, "in");
  }

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
    const ordered = g.add(
      pointsToPath,
      { closed: true, orderAttr: "stationW" },
      "byStation",
    );
    g.connect(merged, "out", ordered, "in");
    const segs = g.add(pathSegments, { axis: "+y", radius: 1 }, "gaps");
    g.connect(ordered, "out", segs, "in");
    // pathSegments puts the segment's LENGTH on the chosen axis of
    // `scale`, which is the gap between two consecutive placements.
    const wide = g.add(
      filterByExpression,
      { predicate: gt(component(attribute("scale", 3), 1), preset.maxFillGapW * W) },
      "wideGaps",
    );
    g.connect(segs, "out", wide, "in");
    const named = g.add(
      setAttribute,
      { name: "archetype", type: "string", stringValue: "terrain-shell" },
      "fillKind",
    );
    g.connect(wide, "out", named, "in");
    // A gap midpoint is a chord between two placements, so it is near the
    // track rather than on it: the frame is looked up from the world
    // position, which is what the frames cloud is indexed by.
    let fillCursor: NodeHandle = named;
    for (const name of ["pack0", "pack1", "pack2", "pack3", "curveU"]) {
      const t = g.add(transferAttribute, { name, mapping: "nearest" }, `fillXfer_${name}`);
      g.connect(fillCursor, "out", t, "in");
      g.connect(pack3, "out", t, "source");
      fillCursor = t;
    }
    const fills = placeFromPack(g, fillCursor, {
      id: "fill",
      W,
      preset,
      outsideShift,
      lapW: lapLength / W,
      variants,
      polygonScale,
      spriteShare: preset.spriteShare,
      committed: {},
      lapU: attribute("curveU", 1),
      memberOffset: false,
    });
    const withFills = g.add(mergePoints, {}, "withFills");
    g.connect(merged, "out", withFills, "in");
    g.connect(fills, "out", withFills, "in");
    merged = withFills;
  }

  if (sightline) {
    merged = cullSightline(g, merged, pack3, ring, W, lapW);
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
        mul(attribute("footprintW"), W),
        mul(attribute("tallnessW"), W),
        mul(attribute("footprintW"), W),
      ),
    },
    "scaled",
  );
  g.connect(oriented, "out", scaled, "in");

  g.output(scaled, "out", "placements");
  g.output(pack3, "out", "frames");
  return { graph: g, outputs: { placements: "placements", frames: "frames" } };
}

/** Wire a straight run of single-input single-output nodes. */
function chain(g: Graph, nodes: readonly NodeHandle[]): void {
  for (let i = 1; i < nodes.length; i++) g.connect(nodes[i - 1], "out", nodes[i], "in");
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

/** The archetype record for an id, which the kit guarantees exists. */
function arch(id: string) {
  const a = ALL_ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`trackDressing: unknown archetype ${JSON.stringify(id)}`);
  return a;
}

/**
 * A stride coprime with `n`, for permuting a stratified sample. Walking
 * up from a seventh of n finds one within a few steps for every n, and
 * the result is a pure function of n, so the permutation is part of the
 * graph rather than of the run.
 */
function coprimeStride(n: number): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  for (let s = Math.max(1, Math.floor(n / 7)); s < n + 7; s++) {
    if (gcd(s, n) === 1) return s;
  }
  return 1;
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
    W: number;
    preset: Preset;
    outsideShift: number;
    lapW: number;
    variants: Readonly<Record<string, number>>;
    polygonScale: number;
    spriteShare: number;
    /** Tenths committed to a hard lean. Empty leaves every side as drawn. */
    committed: Readonly<Record<number, number>>;
    lapU: FieldLike;
    memberOffset: boolean;
    /** How this archetype picks its art variant. */
    variantFrom?: "random" | "severity" | "index";
    /** Read the side from `cornerK` rather than from the local frame. */
    sideFromCorner?: boolean;
  },
): NodeHandle {
  const { W, preset, id } = o;
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
        : Math.min(0.92, Math.max(0.25, arch(x).outsideBias + o.outsideShift)),
    0.5,
  );
  const inBendPick = select(lt(randomField(`${id}-side`), bias), outside, mul(-1, outside));
  const drift = mul(0.45, sin(add(mul(o.lapU, Math.PI * 4), 0.9)));
  const straightPick = select(gt(add(randomField(`${id}-drift`), drift), 0.5), 1, -1);
  const side = o.sideFromCorner
    // `select` rather than `-sign`: sign(0) is 0, and a side of ZERO is
    // not a side — it puts the object on the centreline, in the one band
    // the zone model forbids anything to occupy. A corner whose curvature
    // probe reads exactly zero takes a side rather than none.
    ? select(gt(attribute("cornerK"), 0), -1, 1)
    : select(lt(radiusW, CORNER_RADIUS_W), inBendPick, straightPick);

  const lat = rangeByArchetype((x) => arch(x).lateralW);
  const hgt = rangeByArchetype((x) => arch(x).heightW);
  const fp = rangeByArchetype((x) => arch(x).footprintW);
  const tall = rangeByArchetype((x) => arch(x).tallnessW);
  const push = byArchetype((x) => preset.lateralPush[x] ?? 1, 1);

  // THE BALANCE PASS. Two stretches of the lap commit to a hard lean each
  // way, so the dressing has somewhere it deliberately favours a side
  // rather than being evenly grey everywhere. Two things are never
  // mirrored, and both matter: anything INSIDE a bend, because which side
  // of a corner an object sits on carries meaning, and rule-placed
  // furniture, because that meaning is the whole reason it exists.
  const tenth = floor(mul(div(stationW, o.lapW), 10));
  let lean: FieldLike = 0;
  for (const [k, dir] of Object.entries(o.committed)) {
    lean = select(eq(tenth, Number(k)), dir, lean);
  }
  const movable = o.variantFrom ? 0 : gt(radiusW, CORNER_RADIUS_W);
  const leaned = select(mul(movable, ne(lean, 0)), lean, side);

  const latN = g.add(
    setAttribute,
    {
      name: "lateralW",
      value: mul(
        mul(leaned, push),
        lerp(component(lat, 0), component(lat, 1), randomField(`${id}-lat`)),
      ),
    },
    `${id}Lat`,
  );
  const hN = g.add(
    setAttribute,
    {
      name: "heightW",
      value: lerp(component(hgt, 0), component(hgt, 1), randomField(`${id}-h`)),
    },
    `${id}Height`,
  );
  const fpN = g.add(
    setAttribute,
    {
      name: "footprintW",
      value: lerp(component(fp, 0), component(fp, 1), randomField(`${id}-fp`)),
    },
    `${id}Foot`,
  );
  const tallN = g.add(
    setAttribute,
    {
      name: "tallnessW",
      value: lerp(component(tall, 0), component(tall, 1), randomField(`${id}-tall`)),
    },
    `${id}Tall`,
  );
  // A sprite is a camera-facing quad and costs one polygon; a preset that
  // asks for none rebuilds every sprite archetype AS GEOMETRY at 22, which
  // is a change of kit rather than of ratio — the same silhouettes, built
  // rather than drawn. The scale on top is the polygon budget: a hardware
  // decision, applied to the kit's counts, never to the placement count,
  // which is a composition decision.
  const spriteLive = (x: string): boolean => o.spriteShare > 0 && arch(x).kind === "sprite";
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
  const zoneCases: Record<string, FieldLike> = {};
  for (const a of ALL_ARCHETYPES) zoneCases[a.id] = Number(a.zone.slice(1));
  const zoneN = g.add(
    setAttribute,
    { name: "zone", type: "i32", value: byAttribute("archetype", zoneCases, 0) },
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
          o.memberOffset ? mul(tangent, mul(attribute("member"), 0.55 * W)) : mul(tangent, 0),
        ),
        add(mul(rightB, mul(attribute("lateralW"), W)), mul(upB, mul(attribute("heightW"), W))),
      ),
    },
    `${id}Pos`,
  );
  chain(g, [input, latN, hN, fpN, tallN, polyN, spriteN, variantN, zoneN, stationN, yawN, posN]);
  return posN;
}

/**
 * A station, embedded on a RING whose circumference is the lap.
 *
 * Every "look up the frame at station s" in the passes below is a
 * nearest-point transfer, and a nearest-point transfer needs the thing it
 * searches to be a position. Laying stations out on a LINE would work
 * everywhere except across the start line, where station 0 and station
 * lapW are the same place and the furthest apart on the line — so a
 * marker for a corner that spans the seam would look up a frame half a
 * lap away. On a ring of radius lapW / 2pi the arc length between two
 * stations IS their station difference, the seam is not a special case,
 * and the chord-versus-arc error over the half-frame that resolution
 * actually needs is five parts in a million.
 *
 * This is the same move the density pass makes with its CDF lanes: give a
 * scalar coordinate a geometry so that "nearest" can answer questions
 * about it.
 */
function ringPos(station: FieldLike, lapW: number): Field {
  const r = lapW / (Math.PI * 2);
  const a = mul(station, (Math.PI * 2) / lapW);
  return vec(mul(cos(a), r), mul(sin(a), r), 0);
}

/**
 * The frames laid out on the station ring, which is what every station
 * lookup in the passes below transfers FROM.
 */
function stationRing(g: Graph, packed: NodeHandle, lapW: number): NodeHandle {
  const ring = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: ringPos(attribute("stationW"), lapW) },
    "stationRing",
  );
  g.connect(packed, "out", ring, "in");
  return ring;
}

/**
 * Move `dest` onto the station ring at `station` and pull `names` off the
 * frame that lands nearest. Returns the last transfer.
 */
function lookupAtStation(
  g: Graph,
  dest: NodeHandle,
  ring: NodeHandle,
  station: FieldLike,
  lapW: number,
  id: string,
  names: readonly string[],
): NodeHandle {
  const at = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: ringPos(station, lapW) },
    `${id}At`,
  );
  g.connect(dest, "out", at, "in");
  let cursor: NodeHandle = at;
  for (const name of names) {
    const t = g.add(transferAttribute, { name, mapping: "nearest" }, `${id}_${name}`);
    g.connect(cursor, "out", t, "in");
    g.connect(ring, "out", t, "source");
    cursor = t;
  }
  return cursor;
}

/** Wrap a station into [0, lapW), which is what a lap that closes needs. */
function wrapStation(station: FieldLike, lapW: number): Field<1> {
  return mod(add(station, lapW), lapW) as Field<1>;
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
function cornerEntries(
  g: Graph,
  packed: NodeHandle,
  ring: NodeHandle,
  frameCount: number,
  lapW: number,
): NodeHandle {
  const stepW = lapW / frameCount;
  const here = g.add(
    setAttribute,
    { name: "isCornerHere", value: attribute("isCorner") },
    "cornerHere",
  );
  g.connect(packed, "out", here, "in");
  // The frame one step on. Exactly one step: the ring is parameterised in
  // stations, so the step is the frame spacing by construction rather than
  // a distance that has to agree with an arc length measured elsewhere.
  const ahead = lookupAtStation(
    g,
    here,
    ring,
    add(attribute("stationW"), stepW),
    lapW,
    "flagAhead",
    ["isCorner"],
  );
  const entryStation = g.add(
    setAttribute,
    { name: "entryStation", value: wrapStation(add(attribute("stationW"), stepW), lapW) },
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
    wrapStation(add(attribute("entryStation"), SEVERITY_PROBE_W), lapW),
    lapW,
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
    W: number;
    lapW: number;
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
  const { id, W, lapW } = o;
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
  const target = wrapStation(sub(attribute("entryStation"), o.backW), lapW);
  const stationN = g.add(
    setAttribute,
    { name: "furnitureStation", value: target },
    `${id}FurnitureStation`,
  );
  g.connect(named, "out", stationN, "in");
  const looked = lookupAtStation(
    g,
    stationN,
    ring,
    attribute("furnitureStation"),
    lapW,
    `${id}Look`,
    ["pack0", "pack1", "pack2", "pack3", "curveU"],
  );
  return placeFromPack(g, looked, {
    id,
    W,
    preset: o.preset,
    outsideShift: o.outsideShift,
    lapW,
    variants: o.variants,
    polygonScale: o.polygonScale,
    spriteShare: o.preset.spriteShare,
    committed: {},
    lapU: attribute("curveU", 1),
    memberOffset: false,
    sideFromCorner: true,
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
  W: number,
  lapW: number,
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
    wrapStation(add(attribute("stationW"), LOOK_AHEAD_W), lapW),
    lapW,
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
    { name: "P", tupleSize: 3, value: [0, 0, 0] },
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
  const radius = mul(fmax(div(attribute("footprintW"), 2), 0), W);
  const cappedRaw = select(gt(radius, 2 * W), 2 * W, radius);
  // Plus the sampling's own error bound, so the cull is conservative
  // rather than optimistic. See CHORD_SAMPLES.
  const capped = add(cappedRaw, CHORD_SLACK_W * W);
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
    W: number;
    lapW: number;
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
  const station = g.add(
    setAttribute,
    {
      name: "landmarkStation",
      value: mul(
        div(add(index(), add(0.2, mul(randomField("landmark-place"), 0.6))), LANDMARK_STRETCHES),
        o.lapW,
      ),
    },
    "landmarkStationN",
  );
  g.connect(named, "out", station, "in");
  const looked = lookupAtStation(
    g,
    station,
    ring,
    attribute("landmarkStation"),
    o.lapW,
    "landmarkLook",
    ["pack0", "pack1", "pack2", "pack3", "curveU"],
  );
  // `cornerK` is what `sideFromCorner` reads, and a landmark has no corner
  // — it takes the side its own frame suggests, through the ordinary path.
  return placeFromPack(g, looked, {
    id: "landmark",
    W: o.W,
    preset: o.preset,
    outsideShift: o.outsideShift,
    lapW: o.lapW,
    variants: o.variants,
    polygonScale: o.polygonScale,
    spriteShare: o.preset.spriteShare,
    committed: {},
    lapU: attribute("curveU", 1),
    memberOffset: false,
    variantFrom: "index",
  });
}
