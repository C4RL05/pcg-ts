/**
 * L-6's enclosure planner, as a graph.
 *
 * WHAT `planEnclosure` IS, STATED BEFORE IT IS PORTED, because the shape
 * decides the port. It is a bounded REJECTION SAMPLER: draw a start and a
 * length, throw the draw away if it begins inside a tight corner, or too
 * soon before one, or if it overlaps a stretch already accepted; keep
 * going until the lap holds its budget of cover or the tries run out.
 *
 * THAT DOES NOT COLLAPSE, AND THE MEASUREMENT SAYS SO. Z-3's band mix
 * looked like a greedy search and turned out to be a closed-form quota
 * fill once the (source -> destination) pairs were traced, so its loop was
 * never needed. This one was measured the same way and is not the same: on
 * the shipped vocabulary a lap accepts one to four stretches, and forced
 * to budgets that want more, the overlap test rejects 2 draws at 80W and
 * 33 at 160W. The predicate reads the set of stretches already accepted,
 * and there is no closed form for that.
 *
 * SO IT IS A LOOP, AND WHAT MAKES A LOOP POSSIBLE IS `randomFrom`. A
 * rejection sampler needs a DIFFERENT draw every attempt. `repeatUntil`
 * deliberately does not rotate its body's seed, and a body cannot see its
 * own iteration index -- which is what made this look unportable. It needs
 * neither: THE CARRY CAN COUNT. A column incremented once per round is an
 * iteration index, and `randomFrom` keyed on it draws a fresh uniform
 * every round with the seed held perfectly still. That is the node's whole
 * purpose -- a draw keyed on a VALUE the graph computes rather than on
 * where an element is -- and the racetrack's pose was only the case that
 * found it.
 *
 * THE DRAWS DO NOT MATCH THE REFERENCE AND CANNOT. `rand(seed, k, salt)`
 * hashes an array index through a different function than `randomFrom(k,
 * salt)` hashes an f32's bits, so the two plan different stretches from
 * one seed. Z-3's redraw made exactly this trade and is checked on its
 * POSTCONDITION instead; so is this. What must hold is what L-6 actually
 * says: no stretch starts inside a corner tighter than
 * `noStartTighterThanW` or within `flareW` before one, no two come within
 * `separationW`, every length is a draw from the source's own quantiles,
 * and the covered total lands inside one draw of the budget.
 *
 * WHY THE CANDIDATES ARE BUILT UP FRONT. Only the CLASH test needs the
 * accepted set; the draw, the length, the start and both corner tests are
 * functions of the attempt number alone. Computing them once for every
 * attempt leaves the body the small sequential remainder -- "does
 * candidate k clash, and is there budget left" -- and the corner tests,
 * which are a path sample each, are then paid once for the whole plan
 * rather than once per round.
 */
import {
  Graph,
  type ExposedPin,
  type Field,
  type Geometry,
  type NodeHandle,
  abs,
  add,
  arcTile,
  attribute,
  attributeReduce,
  component,
  copyToPoints,
  createPointCloud,
  div,
  floor,
  eq,
  exp,
  filterByExpression,
  ge,
  gt,
  index,
  le,
  lt,
  max,
  mergePoints,
  min,
  mod,
  mul,
  pathRuns,
  pathScan,
  pointGrid,
  pathShift,
  pointsToPath,
  promoteAttribute,
  ramp,
  removeAttribute,
  randomFrom,
  repeatUntilNode,
  select,
  setAttribute,
  sign,
  sub,
  transferByIndex,
  transferAlongPath,
} from "pcg-ts";
import { CORNER_MODEL, TRACK_FRAME } from "./graph.js";
import type { PlaceableAsset } from "./assets.js";
import { CORRIDOR, OVERHEAD } from "./zones.js";
import { ENCLOSE } from "./tunnels.js";

/**
 * The columns the planner writes.
 *
 * `round` and `coveredW` are the LOOP's state and they sit on the POINT
 * domain holding the same value on every point, which is deliberate and
 * worth the redundancy. A detail attribute is not readable from a
 * point-domain field -- `attributeReduce`'s own description says so, and a
 * probe confirmed it throws "attribute not found" rather than
 * broadcasting -- so loop state kept on the detail domain could not be
 * read by any of the expressions that need it. Broadcast across the
 * candidates it costs one f32 per attempt, and every field can see it.
 */
export const PLAN = {
  /** The attempt number this candidate stands for: 0, 1, 2 ... */
  attempt: "l6Attempt",
  /** Where the stretch would start, in W from the line. */
  startW: "l6StartW",
  /** The length the draw asks for, BEFORE the budget clamps it. */
  rawLengthW: "l6RawLengthW",
  /** And after -- written only on an attempt that was accepted. */
  lengthW: "l6LengthW",
  /**
   * How much of the arc around the start sits inside a tight corner: 0 if
   * neither straddling frame does, 1 if both do, a fraction between.
   *
   * A DECISION SAMPLED, NOT A RADIUS SAMPLED, for two reasons. The first
   * is that `CORNER_MODEL.radius` is INFINITE on a straight and
   * `transferAlongPath` interpolates linearly, so between two infinite
   * frames it computes `Inf + (Inf - Inf) * t`, which is NaN -- and a NaN
   * radius fails a `< tight` test, letting a stretch begin anywhere on any
   * straight, silently, over most of the lap.
   *
   * The second is what the first draft's fix got wrong. Sampling `1/R`
   * dodges the NaN and is finite everywhere, but it INTERPOLATES the
   * curvature where `radiusAtW` -- the rule, and the reference -- reads
   * the NEAREST frame. Measured over 4096 candidates a seed, 0.05 to 0.27%
   * of starts passed the interpolated test while their nearest frame was
   * inside a tight corner: rare enough that 234 accepted plans never hit
   * one, and a latent violation all the same. Interpolating the DECISION
   * cannot do that -- a start whose nearest frame is tight has a tight
   * frame on one side of it, so this reads above zero and is refused.
   * That makes the port strictly MORE conservative than the rule rather
   * than occasionally looser, which is the direction to err in.
   */
  tightAtStart: "l6TightAtStart",
  /** Distance ahead to the next qualifying corner's ENTRY, in W. */
  beforeTightW: "l6BeforeTightW",
  /** 1 where both of L-6's corner tests pass. */
  cornerOk: "l6CornerOk",
  /** 1 on the attempts that became plans. */
  accepted: "l6Accepted",
  /** The loop's attempt counter, the same on every point. */
  round: "l6Round",
  /** How much lap the accepted stretches hold, the same on every point. */
  coveredW: "l6CoveredW",
} as const;

/** Scratch the body writes and the next round writes again. */
const SCRATCH = {
  /** Whichever value is being broadcast off attempt k this round. */
  pick: "l6Pick",
  bcast: "l6Bcast",
  startK: "l6StartK",
  rawK: "l6RawK",
  cornerK: "l6CornerK",
  runMin: "l6RunMin",
  lengthK: "l6LengthK",
  clash: "l6Clash",
  clashes: "l6Clashes",
  going: "l6Going",
} as const;

/**
 * What `enclosure.ts` calls a long stretch, restated here.
 *
 * `dressGraph.ts` argues for this repetition and `pathCoverage`'s own
 * description argues for it from the library's side: a measurement whose
 * whole value is that today's figure compares with one taken upstream must
 * not move when a placement rule is retuned. The suite pins the two equal.
 */
export const HEAVY_W = 10;

/** The detail attribute `repeatUntil` reads to decide whether to run again. */
export const PLAN_SETTLE = "l6Working";

/**
 * The output pin {@link addEnclosurePlan} publishes on.
 *
 * NOT "out", WHICH IS WHY IT IS A CONSTANT. `repeatUntil` names its output
 * pins after the BODY's exposed outputs, and this body's carry is called
 * "carry" -- so every consumer has to know a name that comes from three
 * files away. Naming it here means one place is wrong if it ever changes,
 * rather than each caller discovering it as a validation error.
 */
export const PLAN_PIN = "carry";

/**
 * The cover vocabulary as a table, one point per candidate.
 *
 * NAMED `COVER_ASSET` RATHER THAN `COVER` because `dressGraph.ts` already
 * has a `COVER`, and it means something else: the ray-cast MEASUREMENT's
 * numbers -- how far up to look, how many rays, how many must hit. These
 * are the pieces the tiling is built from. The two would sit in one scope
 * the moment this stage is wired into that graph, which is exactly when a
 * shared name stops being a nuisance and starts being a bug.
 *
 * EVERYTHING HERE IS A PURE FUNCTION OF THE ASSET, which is why it is
 * built once in TypeScript rather than per tile in the graph.
 * `coverCandidates` is already a filter over the kit -- what the source
 * put above the corridor and wide enough to reach across it -- and the
 * floors, the base height and the column count are each one line of
 * arithmetic over one asset. Computing them here makes the graph side a
 * gather of six columns instead of six expressions repeated per piece.
 */
export const COVER_ASSET = {
  /** Pool index, so a placement can name the asset it was tiled from. */
  ord: "coverOrd",
  /** The kit's own asset id. */
  id: "coverId",
  /** Tiling pitch: the piece's length along the road, floored. */
  alongW: "coverAlongW",
  /** Its width across, floored -- what the columns are spread by. */
  acrossW: "coverAcrossW",
  /** Its height, which the base clearance is computed from. */
  tallW: "coverTallW",
  /**
   * Where its CENTRE sits so that its BASE clears the corridor.
   *
   * `max(measured median, ceilingW + tall/2)` -- the reference's
   * expression, and its comment is the reason it is not just the measured
   * height: a piece whose centre sits at 1.4W and is 0.6W thick reaches
   * down to 1.1W, inside the protected volume, and Z-1 would then stand it
   * off to the corridor edge and put a hole in the roof exactly where the
   * driver looks. Raising it here is what makes cover exempt from Z-1
   * honest -- it is exempt because it is already clear, not because it is
   * special.
   */
  baseH: "coverBaseH",
  /** How many copies sit side by side to span the corridor. */
  columns: "coverColumns",
  /**
   * The asset's RAW extents, unfloored.
   *
   * BESIDE THE FLOORED ONES AND NOT INSTEAD OF THEM, because the two are
   * asked different questions. `alongW` and `acrossW` carry the floors the
   * tiling needs -- an asset measured at zero along would tile for ever --
   * while a PLACEMENT carries what the asset actually measures, which is
   * what its boxes are built from. Floor the placement's extents and every
   * cover piece narrower than 0.2W is drawn wider than it is.
   */
  rawAcross: "coverRawAcross",
  rawAlong: "coverRawAlong",
  /** Where this asset's recorded poses begin in the flat pose table. */
  poseOff: "coverPoseOff",
  /** And how many it has. Zero where the kit recorded none. */
  poseCount: "coverPoseCount",
  /** The flat table's own column: one recorded pose id per row. */
  poseId: "coverPoseId",
} as const;

/** What the tiler writes onto each piece. */
export const PIECE = {
  /** Which column of its run this piece is, 0-based. */
  slot: "l6Slot",
  /** Its index along the run, 0-based, restarting per run. */
  tile: "l6Tile",
  /** How many tiles its run has -- what the pitch is derived from. */
  tiles: "l6Tiles",
  /** The flare ramp: 1 at the nearer mouth, 0 at `flareW` inside. */
  ramp: "l6Ramp",
} as const;

/**
 * The weighted pick's cumulative table, and the field that reads it.
 *
 * THE REFERENCE SUBTRACTS UNTIL IT GOES NEGATIVE -- `u -= max(1,
 * instances); if (u <= 0) take it` -- which is a linear search with state
 * and has no direct spelling as a field. It does not need one: that loop
 * picks the FIRST index whose inclusive cumulative weight reaches `u`, so
 * the index is simply HOW MANY cumulative weights `u` has already passed.
 * Summing one comparison per candidate says that in a single expression.
 *
 * The weights are the kit's and never change, so the cumulative table is
 * built here and the graph carries only the comparisons. `max(1,
 * instances)` is the reference's floor, so an asset the source placed
 * once and an asset it never placed still get a chance.
 */
function pickIndexField(u: Field, weights: readonly number[]): Field {
  let total = 0;
  for (const w of weights) total += Math.max(1, w);
  let cum = 0;
  let idx: Field | number = 0;
  // The LAST candidate needs no comparison: the reference's loop ends
  // there whatever `u` is, and adding one would let a `u` of exactly
  // `total` index past the end of the table.
  for (let i = 0; i < weights.length - 1; i++) {
    cum += Math.max(1, weights[i] as number);
    idx = add(idx, gt(mul(u, total), cum));
  }
  return idx as Field;
}

/**
 * A stretch length from the source's own quantiles: `drawStretchLengthW`
 * as one expression.
 *
 * INTERPOLATED IN LOG SPACE ABOVE THE MEDIAN, which is the reference's
 * rule and its reason: the tail spans a factor of forty, and interpolating
 * p90 to the maximum linearly would make every long stretch nearly the
 * same length. A log-linear interpolation of a value IS a linear
 * interpolation of its logarithm, so the whole tail is one `ramp` through
 * the logged stops with an `exp` over it.
 *
 * THE FIRST SEGMENT IS LINEAR AND IS KEPT SO. The reference switches on
 * `l1 / l0 > 1.5`, and 1.1/0.9 does not clear it, so 0.1 to 0.5
 * interpolates in the value. The difference is half a percent, on a
 * segment the racetrack never draws from -- `LONG_QUANTILE` is 0.92 -- but
 * a port that quietly straightens a curve it was asked to reproduce is a
 * port that cannot be compared, so the `select` stays.
 */
export function stretchLengthField(u: Field | number): Field {
  const cdf = ENCLOSE.lengthCdf as readonly (readonly [number, number])[];
  const logStops: [number, number][] = cdf.map(([q, l]) => [q, Math.log(l)]);
  // Above the median: linear in log(length). `ramp` clamps at both ends,
  // so above the last quantile this holds 42.4 -- the reference's final
  // `return`, spelled as a clamp instead of a fall-through.
  const tail = exp(ramp(u, logStops.slice(1)));
  // Below it: linear in the length itself, clamped to 0.9 below the first
  // stop, which is the reference's first branch.
  const head = ramp(u, [
    [cdf[0][0], cdf[0][1]],
    [cdf[1][0], cdf[1][1]],
  ]);
  return max(ENCLOSE.minLengthW, select(le(u, cdf[1][0]), head, tail));
}

/**
 * The two corner columns L-6 tests, written onto the lap's frames.
 *
 * BOTH ARE PATH QUESTIONS AND NEITHER IS A CANDIDATE'S. "How tight is the
 * lap here" and "how far ahead is the next tight corner" are facts about a
 * station, so they belong on the frames, computed once, and a candidate
 * reads them with one gather. The alternative -- testing every candidate
 * against every corner -- is a cross product and a grouped scan for an
 * answer the path already holds.
 *
 * `pathRuns` BACKWARD IS THE SECOND ONE, and the node's own description
 * names this case: "'backward' accumulates against the walk order, so a
 * point reads what lies AHEAD of it up to the next boundary -- the query a
 * marker rule wants".
 *
 * THE BOUNDARY IS A CORNER'S ENTRY AND NOT A TIGHT FRAME, which is where
 * the first draft was wrong, and wrong in the accepting direction. It made
 * the boundary "radius < 8W" on the theory that this was the same thing.
 * It is not: `cornersOf` calls a corner a run of `radius < 12W` and only
 * THEN asks whether its tightest point is under 8, so a corner's ENTRY is
 * its first frame under twelve and the first frame under eight comes
 * later -- measured at 0 to 4.6W later, against a `flareW` of 2.5. The two
 * exclusion zones are often disjoint, and the port accepted a start 0.8W
 * before the entry of a corner whose tightest was 7.1W.
 *
 * So the boundary is built the way `cornersOf` builds a corner. The frames
 * already carry `CORNER_MODEL.behind`, whose first component reads 1 at an
 * entry "and it is the only thing that reads 1"; a `pathRuns` with
 * `reduce: "min"` over those same runs puts each run's tightest radius on
 * its entry. An entry whose corner reaches under eight is a boundary, and
 * nothing else is.
 */
export function writeCornerTests(
  g: Graph,
  frames: NodeHandle,
  lapW: number,
  tag: string,
): NodeHandle {
  // Is this FRAME inside a corner tighter than L-6 will start in? Sampled
  // as a decision rather than as a radius -- see {@link PLAN.tightAtStart}.
  const tight = g.add(
    setAttribute,
    {
      name: PLAN.tightAtStart,
      tupleSize: 1,
      value: lt(attribute(CORNER_MODEL.radius), ENCLOSE.noStartTighterThanW),
    },
    `${tag}_tight`,
  );
  g.connect(frames, "out", tight, "in");

  // THE TIGHTEST RADIUS IN THIS FRAME'S CORNER, read at its entry.
  // `inclusive` and `backward` together mean a frame holds the minimum
  // from itself to the end of its run, so the entry -- the only frame this
  // is ever read on -- holds the whole corner's.
  const runMin = g.add(
    pathRuns,
    {
      name: CORNER_MODEL.radius,
      boundary: CORNER_MODEL.straight,
      outName: SCRATCH.runMin,
      reduce: "min",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_runMin`,
  );
  g.connect(tight, "out", runMin, "in");

  // `cornersOf` plus the `tightestW` filter, as one flag: the first frame
  // of a corner whose tightest point is under the threshold.
  const entry = g.add(
    setAttribute,
    {
      name: SCRATCH.pick,
      tupleSize: 1,
      value: mul(
        eq(component(attribute(CORNER_MODEL.behind, 2), 0), 1),
        lt(attribute(SCRATCH.runMin), ENCLOSE.noStartTighterThanW),
      ),
    },
    `${tag}_entry`,
  );
  g.connect(runMin, "out", entry, "in");

  // WHAT ACCUMULATES IS EACH FRAME'S OWN ARC, measured rather than
  // assumed. The first draft summed a CONSTANT pitch on the grounds that
  // the centreline is resampled uniformly -- and it is, to a tenth of a
  // percent, because `pathResample` spaces along the CURVE while the arc
  // table sums CHORDS, and a chord is shorter than its arc by the corner
  // it cuts. A tenth of a percent of a lap is a third of a half-width,
  // against a `flareW` of 2.5: it would not have broken the rule, and it
  // would have been an assumption nothing checked.
  //
  // `pathShift` names this exact case in its own description -- "shift
  // each station's arc coordinate by +1 and subtract, and every point
  // holds the distance to the next station" -- so the assumption is not
  // relaxed, it is deleted.
  const next = g.add(
    pathShift,
    {
      attributes: [TRACK_FRAME.station],
      outNames: [SCRATCH.bcast],
      offset: 1,
      // A lap is a ring: the last frame's neighbour is the first.
      outOfRange: "wrap",
    },
    `${tag}_next`,
  );
  g.connect(entry, "out", next, "in");

  const own = g.add(
    setAttribute,
    {
      name: SCRATCH.bcast,
      tupleSize: 1,
      // Across the start line the difference comes out negative, which is
      // the seam rather than a defect: one lap forward is one lap.
      value: (() => {
        const d = sub(attribute(SCRATCH.bcast), attribute(TRACK_FRAME.station));
        return select(lt(d, 0), add(d, lapW), d);
      })(),
    },
    `${tag}_own`,
  );
  g.connect(next, "out", own, "in");

  const before = g.add(
    pathRuns,
    {
      name: SCRATCH.bcast,
      boundary: SCRATCH.pick,
      outName: PLAN.beforeTightW,
      reduce: "sum",
      mode: "exclusive",
      direction: "backward",
      // A lap is a loop and a corner across the line is one corner, which
      // is the rule `cornersOf` needs and the same word for it.
      wrap: true,
    },
    `${tag}_beforeTight`,
  );
  g.connect(own, "out", before, "in");
  return before;
}

/** What the planner needs to know about the lap it is planning on. */
export interface PlanOptions {
  readonly lapW: number;
  readonly halfWidth: number;
  /**
   * The FRAMES column holding how much lap to put under cover, in W.
   *
   * A COLUMN AND NOT A NUMBER, because the budget is `longCoverBudgetW`'s
   * answer and that is a function of what the lap already carries -- which
   * is only known once the rays have been cast, and the rays are cast in
   * the same graph. A number here would mean building the planner after
   * cooking the dressing, which is the shape this whole port exists to
   * get rid of. {@link writeCoverBudget} writes it; the candidates gather
   * it alongside the two corner columns, at no extra node.
   */
  readonly budgetAttr: string;
  /** The lowest quantile a length may be drawn from. */
  readonly minQuantile: number;
  /**
   * How many attempts to build.
   *
   * NOT THE REFERENCE'S 2000, AND THE DIFFERENCE IS REPORTED RATHER THAN
   * HIDDEN. Every attempt is a POINT that exists whether or not the loop
   * reaches it, so the pool is a real cost here where the reference's
   * bound is only a ceiling. Measured, a lap at a real budget makes 1 to
   * 50 attempts and accepts 1 to 4, so 256 is five times the worst seen --
   * and the counter rides out on the cloud, so a plan that ran out of
   * candidates says so rather than being inferred from a short answer.
   */
  readonly attempts: number;
}

/**
 * Every attempt's draw, start, length and corner verdict -- everything
 * about a candidate that does not depend on the candidates before it.
 */
export function addEnclosureCandidates(
  g: Graph,
  frames: NodeHandle,
  opts: PlanOptions,
  tag: string,
): NodeHandle {
  const { lapW, halfWidth, minQuantile, attempts } = opts;

  // ONE POINT PER ATTEMPT, laid out along X so no two share a position.
  // `randomFrom` does not care -- it keys on the value it is handed -- but
  // a cloud whose points sit on top of one another is ONE identity to
  // anything that keys on P, and leaving that trap set for the next author
  // costs nothing to avoid here.
  const pool = g.add(
    pointGrid,
    { countX: attempts, countY: 1, countZ: 1, spacing: [1, 1, 1] },
    `${tag}_attempts`,
  );

  let out: NodeHandle = g.add(
    setAttribute,
    { name: PLAN.attempt, tupleSize: 1, value: index() },
    `${tag}_k`,
  );
  g.connect(pool, "out", out, "in");

  const k = attribute(PLAN.attempt);
  // TWO KEYS ON ONE VALUE, which is what `randomFrom`'s `key` is for and
  // the same arrangement `assetGraph` uses for its four station draws. Two
  // nodes each drawing once would still share the cooking node's seed, so
  // the salt is what separates the streams either way.
  const draws: [string, Field][] = [
    [PLAN.startW, mul(randomFrom(k, "l6.start"), lapW)],
    [
      PLAN.rawLengthW,
      stretchLengthField(add(minQuantile, mul(randomFrom(k, "l6.len"), 1 - minQuantile))),
    ],
  ];
  for (const [name, value] of draws) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }

  // The corner columns, gathered at each candidate's own start. The arc is
  // in WORLD units because that is the only unit `transferAlongPath`
  // gathers in; the multiplication happens here for `placeAt`'s reason --
  // at the boundary, so no rule has to remember which unit it holds.
  const arc = g.add(
    setAttribute,
    { name: SCRATCH.bcast, tupleSize: 1, value: mul(attribute(PLAN.startW), halfWidth) },
    `${tag}_arc`,
  );
  g.connect(out, "out", arc, "in");

  const sampled = g.add(
    transferAlongPath,
    {
      arcAttr: SCRATCH.bcast,
      // THE BUDGET RIDES IN ON THE SAME GATHER. It is constant along the
      // path, so where a candidate samples it does not matter -- and one
      // more name in this list is cheaper than a second traversal.
      attributes: [PLAN.tightAtStart, PLAN.beforeTightW, opts.budgetAttr],
    },
    `${tag}_atStart`,
  );
  g.connect(frames, "out", sampled, "path");
  g.connect(arc, "out", sampled, "at");

  // L-6's two refusals, as one flag. Never START inside a corner tighter
  // than the threshold -- entering cover mid-corner takes the sky away
  // exactly where the driver is reading the exit -- and never so close
  // before one that the flare is still opening inside it.
  const ok = g.add(
    setAttribute,
    {
      name: PLAN.cornerOk,
      tupleSize: 1,
      value: mul(
        le(attribute(PLAN.tightAtStart), 0),
        ge(attribute(PLAN.beforeTightW), ENCLOSE.flareW),
      ),
    },
    `${tag}_cornerOk`,
  );
  g.connect(sampled, "out", ok, "in");

  // The loop's state at its starting values: nothing accepted, nothing
  // covered, attempt zero.
  let state: NodeHandle = ok;
  for (const [name, value] of [
    [PLAN.accepted, 0],
    [PLAN.lengthW, 0],
    [PLAN.round, 0],
    [PLAN.coveredW, 0],
  ] as [string, number][]) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_init_${name}`);
    g.connect(state, "out", n, "in");
    state = n;
  }

  // ONE POLYLINE OVER THE WHOLE POOL, BUILT ONCE. Every broadcast in the
  // body is a `pathScan` with `totalAttr`, and a scan needs topology --
  // but the topology never changes, because nothing in the loop adds or
  // removes an attempt. Building it here rather than in the body saves a
  // rebuild per round and, more to the point, makes it impossible for two
  // rounds to disagree about the walk.
  const path = g.add(pointsToPath, { closed: false }, `${tag}_walk`);
  g.connect(state, "out", path, "in");
  return path;
}

/**
 * Broadcast attempt k's value of one column onto every point.
 *
 * THE ONLY WAY A FIELD CAN READ ONE ELEMENT'S VALUE. A field lands on a
 * domain and sees that domain, so "what does point k hold" has no direct
 * spelling: what it has is a REDUCTION. Zero everywhere but k, summed, is
 * k's value -- which is the same trick this demo already uses to put a
 * weight total beside every station.
 *
 * AND IT TAKES TWO NODES, NOT ONE, because `pathScan` writes its
 * `totalAttr` onto the PRIMITIVE domain -- the total is a fact about the
 * polyline, not about any point of it -- so a point-domain field cannot
 * read it until it is promoted back down. `writeBandRedraw` does exactly
 * this pair for its weight total; leaving the promote out here cost a
 * cook and an "attribute not found" three nodes later.
 */
function broadcastFromK(
  g: Graph,
  source: string,
  outName: string,
  tag: string,
): { head: NodeHandle; tail: NodeHandle } {
  const masked = g.add(
    setAttribute,
    {
      name: SCRATCH.pick,
      tupleSize: 1,
      value: mul(eq(attribute(PLAN.attempt), attribute(PLAN.round)), attribute(source)),
    },
    `${tag}_mask`,
  );

  const scanned = g.add(
    pathScan,
    {
      name: SCRATCH.pick,
      outName: SCRATCH.bcast,
      reduce: "sum",
      mode: "inclusive",
      totalAttr: outName,
    },
    `${tag}_bcast`,
  );
  g.connect(masked, "out", scanned, "in");

  const down = g.add(
    promoteAttribute,
    { name: outName, from: "primitive", to: "point", mode: "first" },
    `${tag}_down`,
  );
  g.connect(scanned, "out", down, "in");
  return { head: masked, tail: down };
}

/** `x0 < y1 && y0 < x1`, the reference's own overlap test. */
const overlaps = (x0: Field, x1: Field, y0: Field, y1: Field): Field =>
  mul(lt(x0, y1), lt(y0, x1));

/**
 * One attempt: does candidate k clash with what has been accepted, and is
 * there budget left for it.
 *
 * THE BODY IS THE WHOLE SEQUENTIAL REMAINDER and nothing else, which is
 * why it is this short. Everything a candidate can know on its own was
 * settled before the loop started.
 */
export function buildPlanBody(opts: PlanOptions): {
  graph: Graph;
  inputs: ExposedPin[];
  outputs: ExposedPin[];
} {
  const { lapW, budgetAttr, attempts } = opts;
  // The body's seed is never rotated per round -- see `repeatUntil` -- and
  // it does not need to be. Every draw this loop makes was made BEFORE it
  // started, keyed on an attempt number, which is exactly the arrangement
  // that lets a sampler live inside a loop whose seed is held still.
  const b = new Graph(1);

  // Candidate k's three facts, each put on every point. Chained, so the
  // first one's `in` is the pin `repeatUntil` feeds the carry to.
  const kStart = broadcastFromK(b, PLAN.startW, SCRATCH.startK, "kStart");
  const kRaw = broadcastFromK(b, PLAN.rawLengthW, SCRATCH.rawK, "kRaw");
  b.connect(kStart.tail, "out", kRaw.head, "in");
  const kCorner = broadcastFromK(b, PLAN.cornerOk, SCRATCH.cornerK, "kCorner");
  b.connect(kRaw.tail, "out", kCorner.head, "in");

  // THE BUDGET CLAMP, WHICH IS NOT A TIDY-UP. A single draw from the tail
  // is 10 to 42W and will sail past a budget of twelve; the lap then
  // finishes over-enclosed with nothing able to fix it, because the
  // reduction never touches L-6's own runs. The reference measured one
  // overshooting draw taking a lap to 26.3% against a 25% ceiling, and
  // this is that clamp, transcribed.
  const budgetW = attribute(budgetAttr);
  const room = max(ENCLOSE.minLengthW, sub(budgetW, attribute(PLAN.coveredW)));
  const lenK = b.add(
    setAttribute,
    {
      name: SCRATCH.lengthK,
      tupleSize: 1,
      value: min(max(ENCLOSE.minLengthW, attribute(SCRATCH.rawK)), room),
    },
    "lengthK",
  );
  b.connect(kCorner.tail, "out", lenK, "in");

  // DOES CANDIDATE k OVERLAP THIS ACCEPTED STRETCH? Compared as arcs on a
  // LOOP rather than as an interval difference: a stretch that starts near
  // the end of the lap wraps, and the wrapped copy has to be tested
  // against both neighbours. That is the reference's three-way test,
  // unchanged -- and it is the only part of this rule that reads anything
  // but the candidate itself, which is the entire reason there is a loop.
  const a0 = attribute(SCRATCH.startK);
  const a1 = add(a0, add(attribute(SCRATCH.lengthK), ENCLOSE.separationW));
  const b0 = attribute(PLAN.startW);
  const b1 = add(b0, add(attribute(PLAN.lengthW), ENCLOSE.separationW));
  const clash = b.add(
    setAttribute,
    {
      name: SCRATCH.clash,
      tupleSize: 1,
      value: mul(
        attribute(PLAN.accepted),
        max(
          overlaps(a0, a1, b0, b1),
          max(
            overlaps(add(a0, lapW), add(a1, lapW), b0, b1),
            overlaps(a0, a1, add(b0, lapW), add(b1, lapW)),
          ),
        ),
      ),
    },
    "clash",
  );
  b.connect(lenK, "out", clash, "in");

  const counted = b.add(
    pathScan,
    {
      name: SCRATCH.clash,
      outName: SCRATCH.bcast,
      reduce: "sum",
      mode: "inclusive",
      totalAttr: SCRATCH.clashes,
    },
    "clashCount",
  );
  b.connect(clash, "out", counted, "in");

  // Down to the points, for `broadcastFromK`'s reason: a scan's total is
  // a fact about the polyline and lives on the primitive.
  const clashCount = b.add(
    promoteAttribute,
    { name: SCRATCH.clashes, from: "primitive", to: "point", mode: "first" },
    "clashDown",
  );
  b.connect(counted, "out", clashCount, "in");

  // THE VERDICT, and it is the loop's own condition as much as the
  // candidate's: the reference tests `covered < budgetW` at the top of
  // every iteration, so a round that begins already full accepts nothing
  // however good the draw is.
  const accept = mul(
    attribute(SCRATCH.cornerK),
    mul(eq(attribute(SCRATCH.clashes), 0), lt(attribute(PLAN.coveredW), budgetW)),
  );
  const isK = eq(attribute(PLAN.attempt), attribute(PLAN.round));

  let tail: NodeHandle = clashCount;
  const writes: [string, Field][] = [
    // The accepted flag and the length land on attempt k ALONE, which is
    // what `isK` is for; every other point keeps what it had.
    [PLAN.accepted, max(attribute(PLAN.accepted), mul(isK, accept))],
    [PLAN.lengthW, select(mul(isK, accept), attribute(SCRATCH.lengthK), attribute(PLAN.lengthW))],
    // These two are the loop's state and move on EVERY point together.
    [PLAN.coveredW, add(attribute(PLAN.coveredW), mul(accept, attribute(SCRATCH.lengthK)))],
    [PLAN.round, add(attribute(PLAN.round), 1)],
  ];
  for (const [name, value] of writes) {
    const n = b.add(setAttribute, { name, tupleSize: 1, value }, `write_${name}`);
    b.connect(tail, "out", n, "in");
    tail = n;
  }

  // WHETHER TO RUN AGAIN, WHICH IS NOT "DID ANYTHING MOVE". Every other
  // loop in this demo settles when a round changes nothing, and this one
  // must not: a round that REJECTS its candidate changes nothing and is
  // the ordinary case -- 33 of them in a row at a budget of 160W. So the
  // signal is the reference's own `for` condition instead, and the loop
  // stops when the lap holds its budget or the candidates run out.
  const going = b.add(
    setAttribute,
    {
      name: SCRATCH.going,
      tupleSize: 1,
      value: mul(
        lt(attribute(PLAN.coveredW), budgetW),
        lt(attribute(PLAN.round), attempts),
      ),
    },
    "going",
  );
  b.connect(tail, "out", going, "in");

  const settle = b.add(
    attributeReduce,
    { name: SCRATCH.going, domain: "point", mode: "max", outName: PLAN_SETTLE },
    "settle",
  );
  b.connect(going, "out", settle, "in");

  return {
    graph: b,
    inputs: [{ name: "carry", node: kStart.head, pin: "in" }],
    outputs: [{ name: "carry", node: settle, pin: "out" }],
  };
}

/**
 * The planner, end to end: candidates, then the loop that walks them.
 *
 * ONE OUTPUT AND NOT TWO, deliberately. Every attempt survives to the end
 * carrying whether it was accepted, so a caller that wants the plans
 * filters on `PLAN.accepted` and one that wants to know how hard the lap
 * was reads the same cloud -- the counter says how many attempts the loop
 * spent, and the corner flag says how many of them the corners refused.
 * Publishing the plans alone would answer the first question and destroy
 * the second, and the second is the one that says whether `attempts` was
 * set high enough.
 */
export function addEnclosurePlan(
  g: Graph,
  frames: NodeHandle,
  opts: PlanOptions,
  tag: string,
): NodeHandle {
  const withTests = writeCornerTests(g, frames, opts.lapW, `${tag}_frames`);
  const candidates = addEnclosureCandidates(g, withTests, opts, tag);
  const body = buildPlanBody(opts);
  const loop = g.add(
    repeatUntilNode(body.graph, body.inputs, body.outputs),
    // ONE ROUND PER ATTEMPT AND NOT ONE PER PLAN. The loop settles itself
    // when the budget is met or the candidates run out, so this cap is a
    // backstop rather than the mechanism -- but it has to clear the number
    // of attempts, or a lap that needs its last candidate is cut off by
    // the wrapper instead of by its own condition.
    { maxRounds: opts.attempts, settleAttr: PLAN_SETTLE },
    `${tag}_plan`,
  );
  g.connect(candidates, "out", loop, "carry");
  return loop;
}

/**
 * The cover vocabulary as a point cloud, ready to gather from.
 *
 * The positions are `[i, 0, 0]` for `mixAssetCloud`'s reason: a cloud
 * whose points all sit at the origin is ONE identity to anything that
 * keys on P, and leaving that trap set costs nothing to avoid.
 */
export function coverCloud(
  cover: readonly PlaceableAsset[],
  /**
   * Each candidate's recorded pose ids, parallel to `cover`.
   *
   * PASSED IN RATHER THAN LOOKED UP, and the reason is a cycle: the pose
   * library lives in `dressGraph`, which is the module that will import
   * this one to wire L-6 into the placement list. Handing the ids over as
   * plain arrays keeps the rule independent of the graph that consumes it.
   */
  poses: readonly (readonly number[])[],
): Geometry {
  const geo = createPointCloud(Math.max(1, cover.length));
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const ord = pts.add(COVER_ASSET.ord, "f32", 1);
  const id = pts.add(COVER_ASSET.id, "i32", 1);
  const along = pts.add(COVER_ASSET.alongW, "f32", 1);
  const across = pts.add(COVER_ASSET.acrossW, "f32", 1);
  const tall = pts.add(COVER_ASSET.tallW, "f32", 1);
  const baseH = pts.add(COVER_ASSET.baseH, "f32", 1);
  const columns = pts.add(COVER_ASSET.columns, "f32", 1);
  const rawAcross = pts.add(COVER_ASSET.rawAcross, "f32", 1);
  const rawAlong = pts.add(COVER_ASSET.rawAlong, "f32", 1);
  const poseOff = pts.add(COVER_ASSET.poseOff, "f32", 1);
  const poseCount = pts.add(COVER_ASSET.poseCount, "f32", 1);
  let flat = 0;

  for (let i = 0; i < cover.length; i++) {
    const a = cover[i] as PlaceableAsset;
    P.setTuple(i, [i, 0, 0]);
    ord.set(i, i);
    id.set(i, a.id);
    // The two floors are the reference's, and they are floors rather than
    // guards: an asset measured at zero along would tile for ever.
    const alongW = Math.max(0.3, a.size.along);
    const acrossW = Math.max(0.2, a.size.across);
    along.set(i, alongW);
    across.set(i, acrossW);
    rawAcross.set(i, a.size.across);
    rawAlong.set(i, a.size.along);
    poseOff.set(i, flat);
    poseCount.set(i, (poses[i] ?? []).length);
    flat += (poses[i] ?? []).length;
    tall.set(i, a.size.tall);
    baseH.set(i, Math.max(a.where?.height.median ?? 2, CORRIDOR.ceilingW + a.size.tall / 2));
    // ONE MORE COLUMN THAN THE SPAN STRICTLY NEEDS, and only for a piece
    // narrower than the corridor. Pieces laid edge to edge across it leave
    // seams the rays find -- the same failure the tile count rounds up to
    // avoid, one axis over. A piece already at least as wide as the
    // corridor spans it alone and gets no extra.
    columns.set(
      i,
      Math.max(1, Math.ceil((2 * ENCLOSE.coverW) / acrossW)) +
        (a.size.across < 2 * ENCLOSE.coverW ? 1 : 0),
    );
  }
  return geo;
}

/**
 * The cover candidates' recorded poses, flattened -- what
 * {@link COVER_ASSET.poseOff} indexes into.
 *
 * A ROW EVEN WHEN THERE IS NOTHING TO PUT IN IT: over an EMPTY source
 * `transferByIndex` misses every point under all three settings, and a
 * miss leaves the destination's PRIOR value, which here would be a pose
 * belonging to whatever the column last held. `mixPoseCloud` carries the
 * same single-row floor for the same reason.
 */
export function coverPoseCloud(poses: readonly (readonly number[])[]): Geometry {
  const ids: number[] = [];
  for (const list of poses) for (const id of list) ids.push(id);
  const geo = createPointCloud(Math.max(1, ids.length));
  const P = geo.attrs.point.require("P");
  const col = geo.attrs.point.add(COVER_ASSET.poseId, "f32", 1);
  for (let i = 0; i < geo.attrs.point.count; i++) {
    P.setTuple(i, [i, 0, 0]);
    // A pose of -1 is `poseFor`'s answer when the vocabulary has nothing,
    // and it is what `poseAssetId` turns into a name a map can refuse.
    col.set(i, ids[i] ?? -1);
  }
  return geo;
}

/**
 * The column slots a tile is stamped across: one point per possible
 * column, carrying its own index.
 *
 * A FIXED CLOUD FOR A VARIABLE COUNT, and the filter downstream is what
 * makes that correct. `copyToPoints` stamps the same source onto every
 * target, so the widest asset's column count decides the size and each
 * run then drops the slots it does not use. The alternative is a per-
 * target count, which the node does not offer.
 */
export function slotCloud(maxColumns: number): Geometry {
  const geo = createPointCloud(Math.max(1, maxColumns));
  const P = geo.attrs.point.require("P");
  const slot = geo.attrs.point.add(PIECE.slot, "f32", 1);
  for (let i = 0; i < geo.attrs.point.count; i++) {
    P.setTuple(i, [0, i, 0]);
    slot.set(i, i);
  }
  return geo;
}

/** The widest column count any candidate needs, for {@link slotCloud}. */
export function maxColumns(cover: readonly PlaceableAsset[]): number {
  let most = 1;
  for (const a of cover) {
    const acrossW = Math.max(0.2, a.size.across);
    most = Math.max(
      most,
      Math.max(1, Math.ceil((2 * ENCLOSE.coverW) / acrossW)) +
        (a.size.across < 2 * ENCLOSE.coverW ? 1 : 0),
    );
  }
  return most;
}

/**
 * The accepted stretches, tiled into pieces: `coverPlacements`.
 *
 * `arcTile` IS THIS OPERATION and says so -- its description calls itself
 * "the tile-a-tunnel-out-of-one-rib operation" and states the principle
 * this rule is built on, that "ENCLOSURE IS A PATTERN, NOT AN ASSET". Two
 * things had to be arranged for it to be the reference's tiling rather
 * than merely a similar one.
 *
 * THE TILE COUNT. The node takes `max(1, ceil(L / spacing))` tiles and the
 * reference takes `ceil(L / alongW) + 1` -- one MORE than the length
 * strictly needs, deliberately, because "rounding to nearest leaves a gap
 * whenever the run is not a whole number of pieces long, and a gap is not
 * a near-miss: the ray cast needs three of six rays blocked, so one
 * missing piece cuts a covered stretch in two". A planned 15W run was
 * closing 9.6W. The node's own answer to overlap is a spacing SMALLER than
 * the piece, and because `spacing` is a FIELD resolved per range the exact
 * count is available rather than approximated: ask for
 * `L / (ceil(L / alongW) + 1)` and `ceil(L / spacing)` is that count by
 * construction.
 *
 * THE FLARE. The reference lifts the roof toward each mouth by
 * `flareRiseW * (1 - toMouth / flareW)`, and that factor IS the node's
 * ramp -- 1 at the mouth falling to 0 at `flare` inside, taken from the
 * nearer end. So `flareAttr` carries it out and the lift is one multiply,
 * which is what that param is for: "WHAT a mouth does is the asset's
 * business and not this node's ... lifting the roof ... is a field or a
 * setAttribute reading this column".
 *
 * WHAT IS NOT TAKEN IS THE POSITION. `arcTile` puts each tile on the path
 * and orients it; every placement in this demo instead carries track
 * coordinates and goes through the one shared lift, so the station is
 * recomputed from the tile index and `P` is left for that lift to write.
 * Using the node for its tiling and not for its placement is the same
 * split the rest of the demo makes.
 */
export function addEnclosureTiles(
  g: Graph,
  frames: NodeHandle,
  plan: NodeHandle,
  cover: NodeHandle,
  slots: NodeHandle,
  opts: PlanOptions,
  weights: readonly number[],
  tag: string,
): NodeHandle {
  const { lapW, halfWidth } = opts;

  // Only the accepted attempts are runs; the rest are rejected draws.
  const kept = g.add(
    filterByExpression,
    { predicate: gt(attribute(PLAN.accepted), 0) },
    `${tag}_accepted`,
  );
  g.connect(plan, PLAN_PIN, kept, "in");

  // THE ASSET, DRAWN HERE AND NOT IN THE LOOP, which is the reference's
  // order too: `planEnclosure` picks the piece only once a candidate has
  // survived both corner tests and the clash, so a rejected draw never
  // spends one. Keyed on the attempt number, so which piece a run gets
  // does not depend on how many draws were rejected before it.
  const picked = g.add(
    setAttribute,
    {
      name: SCRATCH.pick,
      tupleSize: 1,
      value: pickIndexField(randomFrom(attribute(PLAN.attempt), "l6.asset"), weights),
    },
    `${tag}_pick`,
  );
  g.connect(kept, "out", picked, "in");

  const withAsset = g.add(
    transferByIndex,
    {
      index: attribute(SCRATCH.pick),
      attributes: [
        COVER_ASSET.ord,
        COVER_ASSET.id,
        COVER_ASSET.alongW,
        COVER_ASSET.acrossW,
        COVER_ASSET.tallW,
        COVER_ASSET.baseH,
        COVER_ASSET.columns,
        COVER_ASSET.rawAcross,
        COVER_ASSET.rawAlong,
        COVER_ASSET.poseOff,
        COVER_ASSET.poseCount,
      ],
      outOfRange: "clamp",
    },
    `${tag}_asset`,
  );
  g.connect(picked, "out", withAsset, "in");
  g.connect(cover, "out", withAsset, "source");

  // `ceil` HAS NO FIELD, and this is the identity that stands in for it:
  // -floor(-x). Exact for every finite value, integers included, which a
  // `floor(x) + (x > floor(x))` spelling is not obliged to be.
  const ceilOf = (x: Field): Field => mul(-1, floor(mul(-1, x)));

  const tiles = g.add(
    setAttribute,
    {
      name: PIECE.tiles,
      tupleSize: 1,
      value: add(ceilOf(div(attribute(PLAN.lengthW), attribute(COVER_ASSET.alongW))), 1),
    },
    `${tag}_tiles`,
  );
  g.connect(withAsset, "out", tiles, "in");

  // The range in the world units `arcTile` tiles in, and the tile count
  // spelled as a spacing -- see this function's own note.
  let range: NodeHandle = tiles;
  for (const [name, value] of [
    [SCRATCH.startK, mul(attribute(PLAN.startW), halfWidth)],
    [SCRATCH.rawK, mul(attribute(PLAN.lengthW), halfWidth)],
    // HALF A TILE OF MARGIN, and it is not slack. `arcTile` takes
    // `ceil(L / spacing)` tiles, so asking for exactly `L / n` sits on a
    // ceiling boundary: in f32 the round trip can land a hair ABOVE n and
    // the run comes back with n + 1 pieces -- measured, on the run at
    // 324.0W, which asked for 5 and got 6. Dividing by `n - 0.5` puts the
    // quotient in the middle of the interval that ceils to n, which is
    // exact for every n >= 1 and cannot be nudged out of it. The PITCH is
    // unaffected: the node spaces its tiles as `L / count` whatever
    // spacing produced the count, so this changes the count's robustness
    // and nothing about where the pieces land.
    [
      SCRATCH.lengthK,
      div(mul(attribute(PLAN.lengthW), halfWidth), sub(attribute(PIECE.tiles), 0.5)),
    ],
  ] as [string, Field][]) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_range_${name}`);
    g.connect(range, "out", n, "in");
    range = n;
  }

  const tiled = g.add(
    arcTile,
    {
      startAttr: SCRATCH.startK,
      lengthAttr: SCRATCH.rawK,
      spacing: attribute(SCRATCH.lengthK),
      flare: ENCLOSE.flareW * halfWidth,
      flareAttr: PIECE.ramp,
      tileIndexAttr: PIECE.tile,
      rangeNames: [
        PLAN.startW,
        PLAN.lengthW,
        PIECE.tiles,
        COVER_ASSET.ord,
        COVER_ASSET.id,
        COVER_ASSET.alongW,
        COVER_ASSET.acrossW,
        COVER_ASSET.tallW,
        COVER_ASSET.baseH,
        COVER_ASSET.columns,
        COVER_ASSET.rawAcross,
        COVER_ASSET.rawAlong,
        COVER_ASSET.poseOff,
        COVER_ASSET.poseCount,
      ],
    },
    `${tag}_tile`,
  );
  g.connect(frames, "out", tiled, "path");
  g.connect(range, "out", tiled, "ranges");

  // ONE COPY PER COLUMN, then the ones a piece does not have are dropped.
  // `arcTile` tiles ALONG an arc and the columns go ACROSS it, so the
  // second axis is a stamp rather than a second tiling -- and the stamp is
  // a fixed slot cloud because a per-target count is not something
  // `copyToPoints` offers. The cost is the widest asset's column count
  // times the tiles, filtered down to what each run actually needs.
  const spread = g.add(
    copyToPoints,
    {
      targetNames: [
        PLAN.startW,
        PLAN.lengthW,
        PIECE.tiles,
        PIECE.tile,
        PIECE.ramp,
        COVER_ASSET.ord,
        COVER_ASSET.id,
        COVER_ASSET.acrossW,
        COVER_ASSET.tallW,
        COVER_ASSET.baseH,
        COVER_ASSET.columns,
        COVER_ASSET.rawAcross,
        COVER_ASSET.rawAlong,
        COVER_ASSET.poseOff,
        COVER_ASSET.poseCount,
      ],
      topology: "drop",
    },
    `${tag}_columns`,
  );
  g.connect(slots, "out", spread, "source");
  g.connect(tiled, "out", spread, "target");

  const trimmed = g.add(
    filterByExpression,
    { predicate: lt(attribute(PIECE.slot), attribute(COVER_ASSET.columns)) },
    `${tag}_trim`,
  );
  g.connect(spread, "out", trimmed, "in");

  // TRACK COORDINATES, which is what a placement is. The station comes
  // back from the tile INDEX rather than from the position `arcTile`
  // wrote, so it is the reference's `(startW + (i + 0.5) * lengthW /
  // steps) % lapW` exactly, in half-widths, with no world round trip.
  const along = mul(
    add(attribute(PIECE.tile), 0.5),
    div(attribute(PLAN.lengthW), attribute(PIECE.tiles)),
  );
  const columns = attribute(COVER_ASSET.columns);
  const acrossW = attribute(COVER_ASSET.acrossW);
  let out: NodeHandle = trimmed;
  for (const [name, value] of [
    [TRACK_FRAME.station, mod(add(attribute(PLAN.startW), along), lapW)],
    // Centred on the corridor and spread to span it edge to edge. A run
    // one piece wide sits on the centreline; any wider divides what is
    // left of the span after one piece's width between the gaps.
    [
      "trackT",
      select(
        le(columns, 1),
        0,
        add(
          add(-ENCLOSE.coverW, div(acrossW, 2)),
          div(
            mul(attribute(PIECE.slot), sub(mul(2, ENCLOSE.coverW), acrossW)),
            max(1, sub(columns, 1)),
          ),
        ),
      ),
    ],
    ["trackH", add(attribute(COVER_ASSET.baseH), mul(ENCLOSE.flareRiseW, attribute(PIECE.ramp)))],
  ] as [string, Field][]) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_track_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }
  return out;
}

/** What {@link writeCoverBudget} measures off a coverage-carrying path. */
export const BUDGET = {
  /** Arc each frame owns, in W. */
  ownW: "l6OwnW",
  /**
   * 1 where coverage CHANGES -- the boundary the runs are cut on.
   *
   * EVERY TRANSITION AND NOT JUST THE COVERED ONES, which is the whole
   * difference between a stretch and a stretch plus the gap behind it.
   * `pathRuns` cuts a run at each boundary and carries it to the NEXT
   * one, so marking only where cover begins makes one run out of a covered
   * stretch and the uncovered lap after it -- measured, the long total
   * came out 7.3W high. Cutting at both ends makes every run homogeneous,
   * and masking by `covered` then keeps the ones that are cover.
   */
  runStart: "l6RunStart",
  /**
   * 1 on the LAST frame of each run -- the boundary the backward scan needs.
   *
   * A SECOND BOUNDARY, BECAUSE THE TWO DIRECTIONS DO NOT SHARE ONE.
   * `pathRuns` forward makes a boundary frame the FIRST of its run and
   * backward makes it the LAST, so one flag run through both directions
   * describes two run sets offset by a frame -- measured on a synthetic
   * path, where a run of four read 1,2,3,4 forward and 1,4,3,2 backward,
   * the backward figures reaching one frame into the next run. Adding the
   * arcs from both directions then overcounts by exactly one frame, which
   * on the lap was a long total 0.385W high: one frame pitch, and it took
   * a probe on ten points to see rather than a stare at the lap.
   *
   * Shifting the start flag one place forward marks each run's last frame,
   * and the backward scan cut on THAT describes the same runs the forward
   * scan does.
   */
  runEnd: "l6RunEnd",
  /** How long this frame's covered run is, in W. 0 on an uncovered frame. */
  runW: "l6RunW",
  /** Covered arc over the whole lap, in W, the same on every frame. */
  coveredW: "l6CoveredTotalW",
  /** Covered arc held by runs longer than `heavyW`, in W, likewise. */
  longW: "l6LongTotalW",
  /** `longCoverBudgetW`'s answer, in W, likewise. */
  budgetW: "l6BudgetW",
} as const;

/**
 * `longCoverBudgetW`, off the coverage the rays already measured.
 *
 * WHAT THE RULE ASKS FOR IS THE TAIL, NOT THE TOTAL, and that is why this
 * takes two numbers rather than one. The ordinary dressing on an
 * overhead-rich kit already runs a fifth of the lap under something -- but
 * in fifty-odd SHORT stretches, where the source holds 39% of its covered
 * length in the few longer than 10W. The total can be right while the
 * shape is wrong, and what enclosure supplies is the long stretches the
 * incidental cover never produces.
 *
 * BOTH NUMBERS ARE PATH SCANS AND NEITHER IS A NEW IDEA HERE. The covered
 * total is a sum of each frame's own arc over the covered frames. The long
 * total is the same sum restricted to frames whose RUN is long, and a
 * run's length reaches every frame of it by adding what lies behind to
 * what lies ahead and removing the double-counted middle -- the two
 * directions `pathRuns` offers, which its own description says "are not
 * each other's complement without the run's total".
 *
 * A RUN THAT WRAPS THE START LINE IS ONE RUN, which is `wrap` and is the
 * same rule `cornersOf` needs; a scan that closed its runs at the end of
 * the array would report two and call neither of them long.
 */
export function writeCoverBudget(
  g: Graph,
  frames: NodeHandle,
  coveredAttr: string,
  lapW: number,
  tag: string,
): NodeHandle {
  const out0 = writeCoverRuns(g, frames, coveredAttr, lapW, tag);
  return writeBudgetFromRuns(g, out0, coveredAttr, lapW, tag);
}

/**
 * The covered runs of a lap, as columns on its frames.
 *
 * SPLIT OUT OF {@link writeCoverBudget} BECAUSE THE TRIM WANTS THE SAME
 * RUNS. L-6's two halves ask different questions of one decomposition --
 * the top-up wants the totals to size a budget, the trim wants to pick a
 * run and take it out -- and a second scan would be a second definition of
 * "a covered stretch" for two rules that have to agree about which
 * stretches exist. Every column below is the one the budget already used.
 *
 * `ownW`, `runStart` and `runEnd` are the machinery; {@link BUDGET.runW} is
 * the answer -- each covered frame carries the length of the run it belongs
 * to, and an uncovered frame carries 0.
 */
export function writeCoverRuns(
  g: Graph,
  frames: NodeHandle,
  coveredAttr: string,
  lapW: number,
  tag: string,
): NodeHandle {
  // Each frame's own arc, measured rather than assumed -- `pathShift`'s
  // own gap-ring case, for the reason {@link writeCornerTests} gives.
  const next = g.add(
    pathShift,
    {
      attributes: [TRACK_FRAME.station],
      outNames: [SCRATCH.bcast],
      offset: 1,
      outOfRange: "wrap",
    },
    `${tag}_next`,
  );
  g.connect(frames, "out", next, "in");

  const own = g.add(
    setAttribute,
    {
      name: BUDGET.ownW,
      tupleSize: 1,
      value: (() => {
        const d = sub(attribute(SCRATCH.bcast), attribute(TRACK_FRAME.station));
        return select(lt(d, 0), add(d, lapW), d);
      })(),
    },
    `${tag}_own`,
  );
  g.connect(next, "out", own, "in");

  // A run boundary is any frame whose coverage differs from the frame
  // before it -- both ends of every stretch.
  const prev = g.add(
    pathShift,
    { attributes: [coveredAttr], outNames: [SCRATCH.pick], offset: -1, outOfRange: "wrap" },
    `${tag}_prev`,
  );
  g.connect(own, "out", prev, "in");

  const starts = g.add(
    setAttribute,
    {
      name: BUDGET.runStart,
      tupleSize: 1,
      value: sub(1, eq(gt(attribute(coveredAttr), 0), gt(attribute(SCRATCH.pick), 0))),
    },
    `${tag}_starts`,
  );
  g.connect(prev, "out", starts, "in");

  // The run's length, at every frame of it: what lies behind me plus what
  // lies ahead of me, less the arc I was counted for twice.
  // The other end of every run: the frame whose SUCCESSOR starts a new
  // one. See {@link BUDGET.runEnd}.
  const ends = g.add(
    pathShift,
    {
      attributes: [BUDGET.runStart],
      outNames: [BUDGET.runEnd],
      offset: 1,
      outOfRange: "wrap",
    },
    `${tag}_ends`,
  );
  g.connect(starts, "out", ends, "in");

  const behind = g.add(
    pathRuns,
    {
      name: BUDGET.ownW,
      boundary: BUDGET.runStart,
      outName: SCRATCH.startK,
      reduce: "sum",
      mode: "inclusive",
      direction: "forward",
      wrap: true,
    },
    `${tag}_behind`,
  );
  g.connect(ends, "out", behind, "in");

  const ahead = g.add(
    pathRuns,
    {
      name: BUDGET.ownW,
      boundary: BUDGET.runEnd,
      outName: SCRATCH.rawK,
      reduce: "sum",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_ahead`,
  );
  g.connect(behind, "out", ahead, "in");

  const runW = g.add(
    setAttribute,
    {
      name: BUDGET.runW,
      tupleSize: 1,
      value: mul(
        gt(attribute(coveredAttr), 0),
        sub(add(attribute(SCRATCH.startK), attribute(SCRATCH.rawK)), attribute(BUDGET.ownW)),
      ),
    },
    `${tag}_runW`,
  );
  g.connect(ahead, "out", runW, "in");
  return runW;
}

/** The budget half, off the runs {@link writeCoverRuns} already cut. */
function writeBudgetFromRuns(
  g: Graph,
  runW: NodeHandle,
  coveredAttr: string,
  lapW: number,
  tag: string,
): NodeHandle {
  // The two totals, each a masked sum broadcast off its own scan. `runs.ts`
  // calls a stretch long above `heavyW`, and the comparison is STRICT
  // there, so it is strict here.
  let out: NodeHandle = runW;
  for (const [mask, name] of [
    [gt(attribute(coveredAttr), 0), BUDGET.coveredW],
    [mul(gt(attribute(coveredAttr), 0), gt(attribute(BUDGET.runW), HEAVY_W)), BUDGET.longW],
  ] as [Field, string][]) {
    const m = g.add(
      setAttribute,
      { name: SCRATCH.pick, tupleSize: 1, value: mul(mask, attribute(BUDGET.ownW)) },
      `${tag}_mask_${name}`,
    );
    g.connect(out, "out", m, "in");
    const scan = g.add(
      pathScan,
      {
        name: SCRATCH.pick,
        outName: SCRATCH.bcast,
        reduce: "sum",
        mode: "inclusive",
        totalAttr: name,
      },
      `${tag}_sum_${name}`,
    );
    g.connect(m, "out", scan, "in");
    const down = g.add(
      promoteAttribute,
      { name, from: "primitive", to: "point", mode: "first" },
      `${tag}_down_${name}`,
    );
    g.connect(scan, "out", down, "in");
    out = down;
  }

  // TWO TARGETS, AND THE FIRST DRAFT OF THE RULE COLLAPSED THEM INTO ONE.
  // L-6 asks for a total (10-25% of lap, population median 10.5%) and the
  // measurement behind it carries a shape (39% of covered length in
  // stretches longer than 10W). Solving only for the shape gives
  // `(f*total - long)/(1 - f)`, which is correct arithmetic and wrong: on
  // a lap with NO cover it returns zero, because 39% of nothing is
  // nothing, and a bare circuit would have got no tunnels at all with the
  // formula looking right. So the total target comes first and the shape
  // target is a fraction of THAT.
  const covered = attribute(BUDGET.coveredW);
  const targetTotal = mul(
    min(ENCLOSE.ruleShare[1], max(ENCLOSE.sourceShare, div(covered, lapW))),
    lapW,
  );
  const room = sub(ENCLOSE.ruleShare[1] * lapW, covered);
  const want = min(sub(mul(ENCLOSE.sourceLongShare, targetTotal), attribute(BUDGET.longW)), room);
  const budget = g.add(
    setAttribute,
    {
      name: BUDGET.budgetW,
      tupleSize: 1,
      // ZERO WHERE THERE IS NO ROOM FOR EVEN ONE LONG STRETCH. Half a
      // half-width of budget cannot buy a 10W tunnel, and spending it
      // anyway would overshoot the ceiling by twenty times the budget.
      value: mul(ge(want, ENCLOSE.longW), want),
    },
    `${tag}_budget`,
  );
  g.connect(out, "out", budget, "in");
  return budget;
}

/**
 * What L-6's TRIM writes, and what survives the round it ran in.
 *
 * THE FIRST FIVE RIDE THE CARRY and are the rule's answer; the rest are
 * working columns this stage drops before it hands the cloud back, for the
 * reason the corner language learned the hard way -- a column nothing reads
 * still rides every round of a `repeatUntil` and lands on every output,
 * where the only thing it can do is be mistaken for something.
 */
export const TRIM = {
  /** 1 on the placements THIS round moved. Feeds the settle count. */
  moved: "l6TrimMoved",
  /** 1 on every placement the trim has EVER moved. Accumulates. */
  trimmed: "l6Trimmed",
  /** How many runs the trim has taken, so far, on every point. Accumulates. */
  runsTrimmed: "l6TrimRuns",
  /**
   * Why the trim stopped, on every point, as the LAST round left them.
   *
   * TWO FLAGS AND NOT ONE, which is `reduceEnclosure`'s own split and its
   * argument: a lap whose overhead is all L-6's deliberate cover has
   * nothing this pass may touch, and saying "held back by Z-3" of it blames
   * a rule that was never consulted. One says the vocabulary cannot make a
   * lap this open, the other says the band mix is binding.
   */
  blocked: "l6TrimBlocked",
  nothing: "l6TrimNothing",

  /** Working: is this placement incidental overhead the trim may move? */
  trimmable: "l6Trimmable",
  /** Working: the covered run containing it -- start station + 1, or 0. */
  runKey: "l6TrimRunKey",
  /** Working: that run's length in W. */
  runW: "l6TrimRunW",
  /** Working: how many trimmable placements share that run. */
  runCount: "l6TrimRunCount",
  /** Working: the lap's covered arc in W, the same on every point. */
  coveredW: "l6TrimCoveredW",
  /** Working: how many trimmable placements the whole list holds. */
  overhead: "l6TrimOverhead",
  /** Working: how long the list is, for Z-3's floor. */
  listCount: "l6TrimListCount",
} as const;

/** The working columns, dropped from the cloud this stage hands back. */
const TRIM_WORKING = [
  TRIM.trimmable,
  TRIM.runKey,
  TRIM.runW,
  TRIM.runCount,
  TRIM.coveredW,
  TRIM.overhead,
  TRIM.listCount,
];

/**
 * Scratch that exists only on the merged frames-and-placements cloud.
 *
 * Never reaches a placement: the merged cloud is a side branch whose only
 * product is three numbers, gathered back by ordinal. Named anyway, because
 * two `pathRuns` over one boundary column is exactly the kind of thing a
 * later reader renames without noticing the second one.
 */
const MERGED = {
  /** 1 on a point that came from the placements. */
  isPlacement: "l6TmIsPlacement",
  /** The frames' run boundary, and the same flag one point further along. */
  boundary: "l6TmBoundary",
  boundaryEnd: "l6TmBoundaryEnd",
  /**
   * The run key at a covered run's FIRST frame, 0 everywhere else.
   *
   * THE FRAME'S INDEX AND NOT ITS STATION, which is a requirement rather
   * than a preference: `pointsToPath` refuses a fractional `groupAttr` --
   * "a group key is an IDENTITY, and a fractional one cannot be trusted to
   * be equal to itself" -- and the recount below groups on it. A frame
   * index is whole, unique to the run that starts there, and MONOTONIC in
   * station, so the argmin that breaks a length tie by taking the smallest
   * key still takes the run that starts earliest, which is the racing order
   * `reduceEnclosure`'s stable sort resolves ties in.
   */
  keySeed: "l6TmKeySeed",
  /**
   * The same run's START STATION, carried separately.
   *
   * The key stopped being the station when it had to be whole, and the
   * lower-end repair below needs the station itself -- it asks whether a
   * placement sits exactly ON a run's first frame, which is a question
   * about arc position and not about identity. -1 where there is no run
   * start, so the maximum over a window holding one is that one.
   */
  stationSeed: "l6TmStationSeed",
  /** The same, spread to every point up to that start. */
  nextStation: "l6TmNextStation",
  /** The run LENGTH at every covered frame, before the fold spreads it. */
  lenSeed: "l6TmLenSeed",
  /** The two directions of the trimmable count, before they are combined. */
  behind: "l6TmBehind",
  ahead: "l6TmAhead",
  /** 1 at a frame that OPENS a covered run -- the backward fold's boundary. */
  startFlag: "l6TmStartFlag",
  /** The next covered run at or after me: its key. */
  nextKey: "l6TmNextKey",
  /** Whether this point adopts that run -- a COLUMN, deliberately. */
  adopts: "l6TmAdopts",
} as const;

/** A sentinel no run length or run key can reach, for the two argmins. */
const NO_PICK = 1e30;

export interface CoverTrimOptions {
  readonly lapW: number;
  /** The column `pathCoverage` wrote on the frames. */
  readonly coveredAttr: string;
  /**
   * The arc column BOTH clouds carry.
   *
   * `TRACK_FRAME.station` and `PLACEMENT.station` are the same string,
   * `"stationW"`, which is why the merge below needs no renaming and why
   * `pointsToPath` can order the two populations against each other at all.
   */
  readonly stationAttr: string;
  /** The placement columns the rule reads. */
  readonly tAttr: string;
  readonly hAttr: string;
  readonly acrossAttr: string;
  readonly coverAttr: string;
  /**
   * Z-3's `over` floor as a share of the list: `keepOverhead` is
   * `ceil(keepShare * count)`, which is `dressLap`'s own expression.
   */
  readonly keepShare: number;
}

/**
 * L-6's TRIM: bring an over-enclosed lap back under the ceiling, BY RUN.
 *
 * THE PORT OF `reduceEnclosure`, ONE PASS OF IT. That function loops up to
 * six times, re-measuring between passes; this is the body of that loop,
 * and the loop is the repair loop it sits in -- so a lap that needs three
 * runs taken out has them taken out over three repair rounds, each one
 * re-measured by the ray cast at the top of the body. The two are the same
 * fixed point reached by the same steps, and the graph's is if anything
 * more conservative: every round it trims, the sightline cull and the band
 * mix see the result before the next one is chosen.
 *
 * WHY IT TAKES A WHOLE STRETCH RATHER THAN THE MOST CENTRAL PIECES is
 * `reduceEnclosure`'s own finding and worth restating, because the
 * arithmetic below looks like it could shave: of the enclosure exemplar's
 * 124 covered frames only 11 are roofed by a SINGLE object, the median has
 * three holders and the p90 has six. TILED COVER IS REDUNDANT COVER, so
 * removing one piece costs a placement and opens no sky nine times in ten.
 * Taking the whole run actually opens it.
 *
 * THE SHORTEST RUN FIRST -- take what costs least, and it happens to be
 * what L-6 wants, since the long stretches are the tunnels and the tail is
 * the part of the distribution the rule is hardest to satisfy on.
 *
 * IT MOVES RATHER THAN DROPS, so D-1's count is untouched, and it never
 * takes L-6's own cover: dismantling a deliberate tunnel to satisfy L-6
 * would be absurd. What it takes is the cover the dressing produced without
 * meaning to.
 *
 * ---
 *
 * HOW A PLACEMENT LEARNS WHICH RUN IT IS IN, which is the whole of the
 * difficulty and has one exact answer. `inRun` tests a placement's station
 * against a stretch's `[startW, endW]`, and `endW` is defined by
 * `enclosure.ts` as "the station of the first frame PAST the run" -- so a
 * placement lying between a run's last covered frame and the next uncovered
 * one is INSIDE that run. There is no node that reads a discrete value at
 * an arc position: `transferAlongPath` interpolates and lands everything as
 * f32, so a run identity taken through it arrives blended, and
 * `transferAttribute`'s nearest mapping asks its question in space, where a
 * hairpin puts the far side of the corner within reach.
 *
 * So the two populations are MERGED into one path ordered by station, and
 * `pathRuns` propagates each run's identity across it. A placement carries
 * no boundary flag, so it never cuts a run; it simply inherits the one it
 * falls inside. That reproduces `inRun` exactly, including its inclusive
 * upper end -- and including the tie, because `mergePoints` concatenates in
 * connection order and `pointsToPath` breaks an equal `orderAttr` to the
 * LOWER point index, so with the placements merged FIRST a placement whose
 * station is exactly a boundary frame's sorts before that frame and lands
 * in the run that is ending. Which is what `station <= endW` says.
 *
 * ---
 *
 * IT IS NOT BIT-IDENTICAL TO `reduceEnclosure`, AND THE REASON IS THE ARC
 * ARITHMETIC RATHER THAN THE RULE. `measureEnclosure` sums a run's frame
 * arcs in f64; every column here is f32 -- `pathRuns` writes f32 whatever
 * it reads -- so two runs' lengths agree to about 1e-6 W and their ORDER
 * can disagree. Measured on the suite's fixture: two runs at 2.697621 W
 * and 2.697623 W, a gap of seven f32 ulps, which the f64 sum orders one
 * way and the f32 sum the other, so the reference opened the run at
 * station 15.80 and this stage opened the one at 53.95.
 *
 * THAT IS A DIFFERENT RUN AND NOT A WRONG ONE, which is the distinction
 * worth holding. Both are shortest to within a quarter of a frame pitch,
 * both are whole runs, both respect Z-3's floor, and the loop re-measures
 * -- so the lap converges under the ceiling either way and the rule's
 * claim ("take the stretch that costs least, whole") is satisfied by
 * both. What is NOT guaranteed is that the two implementations move the
 * same pieces on a lap where two runs are that close, and no amount of
 * tie-breaking fixes it: the two do not disagree about a TIE, they
 * disagree about which is shorter. `PLAN.md` makes the same argument for
 * the station port at greater length.
 *
 * The suite pins the strong claim where it holds -- one round against one
 * reference pass, exact -- and the postcondition where it does not.
 *
 * A FULLY COVERED LAP IS THE ONE PLACE THIS DELIBERATELY DIFFERS.
 * `stretchesOf` special-cases it to a single stretch `{startW: 0, endW: 0,
 * lengthW: lapW}`, and `inRun` reads that as `0 <= station <= 0` -- so the
 * reference trims a placement at station 0 and NOTHING else on a lap that
 * is roofed end to end. Here there is no coverage TRANSITION anywhere, so
 * no frame opens a run, no placement gets a key, and the trim reports
 * "nothing to trim". Both answers are defensible and neither is reachable
 * on a real lap; this one is written down rather than reproduced, because
 * reproducing it would mean porting an artefact of how the stretch list
 * spells "all of it" rather than porting the rule.
 *
 * ---
 *
 * THE MERGED CLOUD IS A SIDE BRANCH AND NOTHING COMES BACK ON IT. Its
 * product is three numbers per placement, gathered onto the real cloud by
 * ordinal with `transferByIndex` -- the placements were merged first, so
 * they hold indices 0..n-1, and `filterByExpression` preserves relative
 * order. Doing it that way rather than filtering the merged cloud back down
 * is what keeps the placements' own topology, which L-5 built and
 * `DRESS_OUTPUTS.placements` publishes: `mergePoints` drops topology and
 * the detail domain, and a filter would hand back a cloud whose polylines
 * were the merged walk's.
 */
export function writeCoverTrim(
  g: Graph,
  frames: NodeHandle,
  placements: NodeHandle,
  opts: CoverTrimOptions,
  tag: string,
): NodeHandle {
  const { lapW, coveredAttr, stationAttr } = opts;

  // ---- 1. the runs, off the same scan the budget uses --------------------
  // A TAG OF ITS OWN, because the run scan names nodes this function also
  // wants to name -- `_ends`, `_behind`, `_ahead` are the same three ideas
  // on the frames and on the merged walk, and a graph refuses a duplicate
  // id rather than letting two stages quietly share one.
  const runs = writeCoverRuns(g, frames, coveredAttr, lapW, `${tag}_runs`);

  // The lap's covered arc, so the ceiling can be tested. Summed here rather
  // than taken from `BUDGET.coveredW`, which belongs to the budget half and
  // is not computed on this path.
  const maskedOwn = g.add(
    setAttribute,
    {
      name: TRIM.coveredW,
      tupleSize: 1,
      value: mul(gt(attribute(coveredAttr), 0), attribute(BUDGET.ownW)),
    },
    `${tag}_ownMask`,
  );
  g.connect(runs, "out", maskedOwn, "in");
  const coveredTotal = g.add(
    attributeReduce,
    { name: TRIM.coveredW, domain: "point", mode: "sum", outName: TRIM.coveredW },
    `${tag}_coveredSum`,
  );
  g.connect(maskedOwn, "out", coveredTotal, "in");
  const coveredDown = g.add(
    promoteAttribute,
    { name: TRIM.coveredW, from: "detail", to: "point", mode: "first" },
    `${tag}_coveredDown`,
  );
  g.connect(coveredTotal, "out", coveredDown, "in");

  // The run key, seeded only at a COVERED run's first frame so that the max
  // fold below carries the run's own start rather than its largest station
  // -- which would be the last frame on an ordinary run and the wrong one
  // entirely on the run that crosses the start line. `+ 1` keeps station 0
  // from reading as "no run" under a fold whose identity is 0.
  const seeded = g.add(
    setAttribute,
    {
      name: MERGED.keySeed,
      tupleSize: 1,
      value: mul(
        mul(gt(attribute(BUDGET.runStart), 0), gt(attribute(coveredAttr), 0)),
        add(index(), 1),
      ),
    },
    `${tag}_keySeed`,
  );
  g.connect(coveredDown, "out", seeded, "in");

  const seededAt = g.add(
    setAttribute,
    {
      name: MERGED.stationSeed,
      tupleSize: 1,
      value: select(
        mul(gt(attribute(BUDGET.runStart), 0), gt(attribute(coveredAttr), 0)),
        attribute(stationAttr),
        -1,
      ),
    },
    `${tag}_stationSeed`,
  );
  g.connect(seeded, "out", seededAt, "in");

  const framesBoundary = g.add(
    setAttribute,
    { name: MERGED.boundary, tupleSize: 1, value: attribute(BUDGET.runStart) },
    `${tag}_fBoundary`,
  );
  g.connect(seededAt, "out", framesBoundary, "in");
  const framesRunW = g.add(
    setAttribute,
    { name: MERGED.lenSeed, tupleSize: 1, value: attribute(BUDGET.runW) },
    `${tag}_fRunW`,
  );
  g.connect(framesBoundary, "out", framesRunW, "in");
  const framesSide = g.add(
    setAttribute,
    { name: MERGED.isPlacement, tupleSize: 1, value: 0 },
    `${tag}_fSide`,
  );
  g.connect(framesRunW, "out", framesSide, "in");

  // ---- 2. the placements' own half --------------------------------------
  //
  // `isTrimmable`, transcribed: not L-6's own cover, inside the cover span,
  // and standing in the band between the corridor's ceiling and the
  // overhead one. Every comparison is the reference's, strict where it is
  // strict.
  const trimmable = g.add(
    setAttribute,
    {
      name: TRIM.trimmable,
      tupleSize: 1,
      value: mul(
        mul(
          sub(1, gt(attribute(opts.coverAttr), 0)),
          lt(abs(attribute(opts.tAttr)), ENCLOSE.coverW),
        ),
        mul(
          ge(attribute(opts.hAttr), CORRIDOR.ceilingW),
          lt(attribute(opts.hAttr), OVERHEAD.ceilingW),
        ),
      ),
    },
    `${tag}_trimmable`,
  );
  g.connect(placements, "out", trimmable, "in");

  // How many there are, and how long the list is: Z-3's floor is a share of
  // the SECOND, which is `dressLap`'s own `ceil(Z3.over.rule[0] * length)`.
  const overheadSum = g.add(
    attributeReduce,
    { name: TRIM.trimmable, domain: "point", mode: "sum", outName: TRIM.overhead },
    `${tag}_overheadSum`,
  );
  g.connect(trimmable, "out", overheadSum, "in");
  const overheadDown = g.add(
    promoteAttribute,
    { name: TRIM.overhead, from: "detail", to: "point", mode: "first" },
    `${tag}_overheadDown`,
  );
  g.connect(overheadSum, "out", overheadDown, "in");
  const listCount = g.add(
    attributeReduce,
    { name: "", domain: "point", mode: "count", outName: TRIM.listCount },
    `${tag}_listCount`,
  );
  g.connect(overheadDown, "out", listCount, "in");
  const listDown = g.add(
    promoteAttribute,
    { name: TRIM.listCount, from: "detail", to: "point", mode: "first" },
    `${tag}_listDown`,
  );
  g.connect(listCount, "out", listDown, "in");

  // -1 ON THIS SIDE TOO, RATHER THAN THE MERGE'S DEFAULT. `mergePoints`
  // fills a column the other side lacks with its DEFAULT, which is 0 --
  // and 0 is a legal station, so a placement at the start line would have
  // compared equal to it. Harmless today because the backward maximum
  // still lands on the real start, and exactly the kind of accident that
  // stops being harmless when a sentinel changes.
  const placementAt = g.add(
    setAttribute,
    { name: MERGED.stationSeed, tupleSize: 1, value: -1 },
    `${tag}_pStation`,
  );
  g.connect(listDown, "out", placementAt, "in");

  const placementSide = g.add(
    setAttribute,
    { name: MERGED.isPlacement, tupleSize: 1, value: 1 },
    `${tag}_pSide`,
  );
  g.connect(placementAt, "out", placementSide, "in");

  // ---- 3. one path over both, ordered by station ------------------------
  //
  // THE PLACEMENTS ARE CONNECTED FIRST and it is load-bearing, not
  // cosmetic: it is what puts them at the low indices the gather below
  // spends, and it is what makes an exact station tie resolve into the run
  // that is ENDING rather than the gap that follows -- `inRun`'s inclusive
  // upper end, arrived at through `pointsToPath`'s lower-index tie-break.
  const merged = g.add(mergePoints, {}, `${tag}_merge`);
  g.connect(placementSide, "out", merged, "in");
  g.connect(framesSide, "out", merged, "in");

  const walk = g.add(
    pointsToPath,
    { closed: true, orderAttr: stationAttr },
    `${tag}_walk`,
  );
  g.connect(merged, "out", walk, "in");

  // THE BACKWARD SCAN NEEDS ITS OWN BOUNDARY, one point along. `pathRuns`
  // forward makes a flagged point the FIRST of its run and backward makes
  // it the LAST, so one flag run through both directions describes two run
  // sets offset by a point -- `writeCoverBudget` hit this on the frames and
  // the merged walk is the same shape with more points in it.
  const ends = g.add(
    pathShift,
    {
      attributes: [MERGED.boundary],
      outNames: [MERGED.boundaryEnd],
      offset: 1,
      outOfRange: "wrap",
    },
    `${tag}_ends`,
  );
  g.connect(walk, "out", ends, "in");

  // The identity and the length, carried from each run's first frame to
  // everything inside it. `max` over a column that is zero everywhere but
  // the seed is a propagation; there is no "first" reduce to say it more
  // directly.
  const key = g.add(
    pathRuns,
    {
      name: MERGED.keySeed,
      boundary: MERGED.boundary,
      outName: TRIM.runKey,
      reduce: "max",
      mode: "inclusive",
      direction: "forward",
      wrap: true,
    },
    `${tag}_key`,
  );
  g.connect(ends, "out", key, "in");
  // And the run's trimmable population, at every member of it: what lies
  // behind me plus what lies ahead, less the one I was counted for twice.
  const behind = g.add(
    pathRuns,
    {
      name: TRIM.trimmable,
      boundary: MERGED.boundary,
      outName: MERGED.behind,
      reduce: "sum",
      mode: "inclusive",
      direction: "forward",
      wrap: true,
    },
    `${tag}_behind`,
  );
  g.connect(key, "out", behind, "in");
  const ahead = g.add(
    pathRuns,
    {
      name: TRIM.trimmable,
      boundary: MERGED.boundaryEnd,
      outName: MERGED.ahead,
      reduce: "sum",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_ahead`,
  );
  g.connect(behind, "out", ahead, "in");
  // ---- THE RUN'S LOWER END, WHICH THE WALK ORDER GETS WRONG -------------
  //
  // `inRun` is inclusive at BOTH ends and one merge order can only buy one
  // of them. Placements first gives the upper end -- a placement whose
  // station is exactly `endW` sorts before the frame that ends the run and
  // stays inside it -- and pays for it at the lower end, where a placement
  // whose station is exactly `startW` sorts before the frame that OPENS the
  // run and lands in the gap behind it. Frames first would swap the two.
  // Nudging the order key by an epsilon would buy both and turn an
  // exact-equality error into a half-ulp-band one, which is a different
  // wrong answer rather than a right one.
  //
  // SO THE LOWER END IS REPAIRED AFTER THE FOLD, exactly. A backward run
  // cut AT the covered-run starts puts the NEXT such start's key on every
  // point up to it; a placement that landed in a gap and whose station is
  // exactly that start's belongs to it, which is what `startW <= station`
  // says. Nothing else can match: a placement strictly inside a gap is
  // strictly between two run starts, so its station equals neither.
  const starts = g.add(
    setAttribute,
    {
      name: MERGED.startFlag,
      tupleSize: 1,
      value: gt(attribute(MERGED.keySeed), 0),
    },
    `${tag}_startFlag`,
  );
  g.connect(ahead, "out", starts, "in");
  const nextKey = g.add(
    pathRuns,
    {
      name: MERGED.keySeed,
      boundary: MERGED.startFlag,
      outName: MERGED.nextKey,
      reduce: "max",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_nextKey`,
  );
  g.connect(starts, "out", nextKey, "in");
  const nextAt = g.add(
    pathRuns,
    {
      name: MERGED.stationSeed,
      boundary: MERGED.startFlag,
      outName: MERGED.nextStation,
      reduce: "max",
      mode: "inclusive",
      direction: "backward",
      wrap: true,
    },
    `${tag}_nextAt`,
  );
  g.connect(nextKey, "out", nextAt, "in");

  // A COLUMN AND NOT A SHARED FIELD, and the difference cost a real
  // defect. A `Field` is an expression evaluated wherever it lands, not a
  // snapshot of the cloud it was written against: the first draft built
  // `adopts` once and spent it in two consecutive `setAttribute` nodes,
  // the first of which REWRITES `TRIM.runKey` -- so by the second node the
  // `eq(runKey, 0)` term was false for exactly the points that had just
  // adopted, and the run length they should have taken stayed 0. The stage
  // then trimmed a single placement instead of the whole run, which is the
  // one guarantee the rule makes. Materialising the test settles what it
  // is asking about at the moment it is asked.
  const adopting = g.add(
    setAttribute,
    {
      name: MERGED.adopts,
      tupleSize: 1,
      value: mul(
        eq(attribute(TRIM.runKey), 0),
        eq(attribute(stationAttr), attribute(MERGED.nextStation)),
      ),
    },
    `${tag}_adopts`,
  );
  g.connect(nextAt, "out", adopting, "in");
  const fixedKey = g.add(
    setAttribute,
    {
      name: TRIM.runKey,
      tupleSize: 1,
      value: select(
        attribute(MERGED.adopts),
        attribute(MERGED.nextKey),
        attribute(TRIM.runKey),
      ),
    },
    `${tag}_fixKey`,
  );
  g.connect(adopting, "out", fixedKey, "in");

  // ---- AND THE COUNT IS TAKEN FROM THE MEMBERSHIP THAT SURVIVED ---------
  //
  // The two folds above counted against the WALK's runs, which the repair
  // has just changed: a placement that adopted the run ahead of it is a
  // member the forward-and-backward sum never saw, and Z-3's floor is
  // tested against that count. So the count is taken again, by GROUPING on
  // the key rather than by scanning the walk -- which is also the simpler
  // statement of what it is, since a run's population does not depend on
  // the order its members are visited in.
  //
  // THE FRAMES ARE STILL IN THE CLOUD AND THAT IS WHY THIS IS SAFE. They
  // carry `trimmable` 0, so they add nothing to any sum, and they put at
  // least one point in every group -- so `shortGroups: "skip"` can only
  // drop a group that no placement is in, whose count nothing reads.
  const grouped = g.add(
    pointsToPath,
    { closed: false, groupAttr: TRIM.runKey, orderAttr: stationAttr, shortGroups: "skip" },
    `${tag}_group`,
  );
  g.connect(fixedKey, "out", grouped, "in");
  const tally = g.add(
    pathScan,
    {
      name: TRIM.trimmable,
      outName: MERGED.behind,
      reduce: "sum",
      mode: "inclusive",
      totalAttr: TRIM.runCount,
    },
    `${tag}_tally`,
  );
  g.connect(grouped, "out", tally, "in");
  const counted = g.add(
    promoteAttribute,
    { name: TRIM.runCount, from: "primitive", to: "point", mode: "first" },
    `${tag}_runCount`,
  );
  g.connect(tally, "out", counted, "in");

  // AND THE LENGTH COMES OFF THE SAME GROUPING, for the same reason and
  // through the same mechanism. It used to ride a fold of its own -- one
  // forward over the walk and one backward for the adopters -- which meant
  // the length and the membership were computed by two different means and
  // could disagree about which run a placement was in. They cannot now: a
  // run's frames all carry its length in `lenSeed`, so the maximum over the
  // group is that length, taken from exactly the population the key
  // defines. Uncovered frames carry 0, so the gap group answers 0 and its
  // members are non-candidates anyway.
  const spanned = g.add(
    pathScan,
    {
      name: MERGED.lenSeed,
      outName: MERGED.ahead,
      reduce: "max",
      mode: "inclusive",
      totalAttr: TRIM.runW,
    },
    `${tag}_span`,
  );
  g.connect(counted, "out", spanned, "in");
  const runCount = g.add(
    promoteAttribute,
    { name: TRIM.runW, from: "primitive", to: "point", mode: "first" },
    `${tag}_runW`,
  );
  g.connect(spanned, "out", runCount, "in");

  // The lap's covered arc reaches the placements the same way: it is on
  // every frame and zero on every placement, so the run-independent maximum
  // over the merged cloud is it.
  const coverMax = g.add(
    attributeReduce,
    { name: TRIM.coveredW, domain: "point", mode: "max", outName: TRIM.coveredW },
    `${tag}_coverMax`,
  );
  g.connect(runCount, "out", coverMax, "in");
  const coverOnAll = g.add(
    promoteAttribute,
    { name: TRIM.coveredW, from: "detail", to: "point", mode: "first" },
    `${tag}_coverAll`,
  );
  g.connect(coverMax, "out", coverOnAll, "in");

  // ---- 4. back onto the real cloud, by ordinal --------------------------
  const answers = g.add(
    filterByExpression,
    { predicate: gt(attribute(MERGED.isPlacement), 0) },
    `${tag}_answers`,
  );
  g.connect(coverOnAll, "out", answers, "in");

  const gathered = g.add(
    transferByIndex,
    {
      index: index(),
      attributes: [TRIM.runKey, TRIM.runW, TRIM.runCount, TRIM.coveredW],
      // EVERY POINT LANDS BY CONSTRUCTION -- the filter kept exactly the
      // placements and kept them in order, so index i is placement i --
      // and `clamp` is named rather than `miss` so that a future change
      // which broke that correspondence would produce a wrong answer at the
      // ends rather than a silent prior value everywhere.
      outOfRange: "clamp",
    },
    `${tag}_gather`,
  );
  g.connect(placementSide, "out", gathered, "in");
  g.connect(answers, "out", gathered, "source");

  // ---- 5. WHICH RUN, WHICH IS TWO ARGMINS AND NOT ONE --------------------
  //
  // There is no argmin node. The idiom is a masked minimum reduced to the
  // detail domain, broadcast back, and compared -- which keeps EVERY tie,
  // so the tie has to be broken by a second one. `reduceEnclosure` sorts
  // its stretches by length with a stable sort over a list built in racing
  // order, so equal lengths resolve to the earlier start; the second
  // minimum is that, taken over the run key, which IS the start station.
  //
  // The gate is the reference's `after > ceiling`: below the ceiling the
  // loop breaks before it looks at a run, and nothing here may be chosen.
  const keep = mul(-1, floor(mul(-opts.keepShare, attribute(TRIM.listCount))));
  const over = gt(div(attribute(TRIM.coveredW), lapW), ENCLOSE.ruleShare[1]);
  const candidate = mul(attribute(TRIM.trimmable), gt(attribute(TRIM.runKey), 0));
  const affordable = ge(sub(attribute(TRIM.overhead), attribute(TRIM.runCount)), keep);
  const eligible = mul(mul(candidate, affordable), over);

  const byLength = g.add(
    setAttribute,
    {
      name: PICK.lengthKey,
      tupleSize: 1,
      value: select(eligible, attribute(TRIM.runW), NO_PICK),
    },
    `${tag}_lenKey`,
  );
  g.connect(gathered, "out", byLength, "in");
  const shortest = g.add(
    attributeReduce,
    { name: PICK.lengthKey, domain: "point", mode: "min", outName: PICK.shortest },
    `${tag}_shortest`,
  );
  g.connect(byLength, "out", shortest, "in");
  const shortestDown = g.add(
    promoteAttribute,
    { name: PICK.shortest, from: "detail", to: "point", mode: "first" },
    `${tag}_shortestDown`,
  );
  g.connect(shortest, "out", shortestDown, "in");

  const byStart = g.add(
    setAttribute,
    {
      name: PICK.startKey,
      tupleSize: 1,
      value: select(
        mul(eligible, eq(attribute(TRIM.runW), attribute(PICK.shortest))),
        attribute(TRIM.runKey),
        NO_PICK,
      ),
    },
    `${tag}_startKey`,
  );
  g.connect(shortestDown, "out", byStart, "in");
  const earliest = g.add(
    attributeReduce,
    { name: PICK.startKey, domain: "point", mode: "min", outName: PICK.earliest },
    `${tag}_earliest`,
  );
  g.connect(byStart, "out", earliest, "in");
  const earliestDown = g.add(
    promoteAttribute,
    { name: PICK.earliest, from: "detail", to: "point", mode: "first" },
    `${tag}_earliestDown`,
  );
  g.connect(earliest, "out", earliestDown, "in");

  const chosen = g.add(
    setAttribute,
    {
      name: TRIM.moved,
      tupleSize: 1,
      value: mul(
        eligible,
        mul(
          eq(attribute(TRIM.runW), attribute(PICK.shortest)),
          eq(attribute(TRIM.runKey), attribute(PICK.earliest)),
        ),
      ),
    },
    `${tag}_chosen`,
  );
  g.connect(earliestDown, "out", chosen, "in");

  // ---- 6. THE MOVE, which is a lateral and nothing else ------------------
  //
  // Out to the far edge of the cover span, keeping the side it was on --
  // `Math.sign(p.t || 1)`, where the `|| 1` is what sends a piece sitting
  // exactly on the centreline to the right rather than nowhere. The
  // placement keeps its station and its height: the run stops being roofed
  // because the piece is no longer over the road, not because it left.
  const moved = g.add(
    setAttribute,
    {
      name: opts.tAttr,
      tupleSize: 1,
      value: select(
        attribute(TRIM.moved),
        mul(
          sign(select(eq(attribute(opts.tAttr), 0), 1, attribute(opts.tAttr))),
          add(ENCLOSE.coverW, div(attribute(opts.acrossAttr), 2)),
        ),
        attribute(opts.tAttr),
      ),
    },
    `${tag}_move`,
  );
  g.connect(chosen, "out", moved, "in");

  // ---- 7. WHAT HAPPENED, AND WHY IT STOPPED -----------------------------
  //
  // The two flags are read off the LAST round, which is the round that
  // stopped -- so they have to be false whenever the ceiling was the reason
  // rather than the rule, and `over` is in both.
  const refusedFlag = g.add(
    setAttribute,
    {
      name: PICK.refused,
      tupleSize: 1,
      value: mul(mul(candidate, sub(1, affordable)), over),
    },
    `${tag}_refusedFlag`,
  );
  g.connect(moved, "out", refusedFlag, "in");

  let tail: NodeHandle = refusedFlag;
  for (const [src, dst] of [
    [TRIM.moved, PICK.anyMoved],
    [PICK.refused, PICK.anyRefused],
  ] as const) {
    const any = g.add(
      attributeReduce,
      { name: src, domain: "point", mode: "max", outName: dst },
      `${tag}_any_${dst}`,
    );
    g.connect(tail, "out", any, "in");
    const down = g.add(
      promoteAttribute,
      { name: dst, from: "detail", to: "point", mode: "first" },
      `${tag}_anyDown_${dst}`,
    );
    g.connect(any, "out", down, "in");
    tail = down;
  }

  // THREE REFUSALS AND NOT ONE, which is `reduceEnclosure`'s own shape and
  // was the defect an independent check found here. The reference tests the
  // whole list BEFORE it looks at a single run: no overhead at all is
  // "nothing to trim", and overhead that exists but does not clear Z-3's
  // floor is "held back by Z-3" -- a global refusal with no run involved.
  // Reading `blocked` only off a per-run refusal reported the second case
  // as the first, which is exactly the confusion the two flags exist to
  // prevent: one says the vocabulary cannot make a lap this open, the other
  // says the band mix is binding.
  const globalBlock = mul(
    gt(attribute(TRIM.overhead), 0),
    le(attribute(TRIM.overhead), keep),
  );
  // The per-run refusal is only REACHED when the global one did not fire,
  // which is what `else if` means and what this multiplication says.
  const refusedSomewhere = max(
    globalBlock,
    mul(sub(1, globalBlock), attribute(PICK.anyRefused)),
  );
  const stalled = mul(over, sub(1, attribute(PICK.anyMoved)));

  // AND THEY ACCUMULATE, because `dressLap` accumulates them: it ORs each
  // round's answer into one flag for the whole dressing, so a lap held back
  // in an early round says so even if a later one stopped for another
  // reason. Reporting only the last round's would be a quieter answer than
  // the rule gives.
  const flags = g.add(
    setAttribute,
    {
      name: TRIM.blocked,
      tupleSize: 1,
      value: max(attribute(TRIM.blocked), mul(stalled, refusedSomewhere)),
    },
    `${tag}_blocked`,
  );
  g.connect(tail, "out", flags, "in");
  const nothing = g.add(
    setAttribute,
    {
      name: TRIM.nothing,
      tupleSize: 1,
      value: max(attribute(TRIM.nothing), mul(stalled, sub(1, refusedSomewhere))),
    },
    `${tag}_nothing`,
  );
  g.connect(flags, "out", nothing, "in");

  // The two running totals. A placement the trim has moved is outside the
  // cover span, so `isTrimmable` refuses it for ever after and no placement
  // can be counted twice; the running OR is therefore also the count.
  const everTrimmed = g.add(
    setAttribute,
    {
      name: TRIM.trimmed,
      tupleSize: 1,
      value: max(attribute(TRIM.trimmed), attribute(TRIM.moved)),
    },
    `${tag}_everTrimmed`,
  );
  g.connect(nothing, "out", everTrimmed, "in");
  const runTally = g.add(
    setAttribute,
    {
      name: TRIM.runsTrimmed,
      tupleSize: 1,
      value: add(attribute(TRIM.runsTrimmed), attribute(PICK.anyMoved)),
    },
    `${tag}_runTally`,
  );
  g.connect(everTrimmed, "out", runTally, "in");

  // AND THE WORKING COLUMNS GO HOME. They are recomputed from scratch every
  // round, so carrying them costs a column per round on every output for
  // nothing -- and `l6TrimRunKey` riding a settled lap is a number that
  // means something only during the round that wrote it.
  const cleaned = g.add(
    removeAttribute,
    { names: [...TRIM_WORKING, ...PICK_WORKING, MERGED.isPlacement] },
    `${tag}_clean`,
  );
  g.connect(runTally, "out", cleaned, "in");
  return cleaned;
}

/**
 * The two argmins' scratch, and the two "did anything happen" broadcasts.
 *
 * Apart from {@link TRIM} because none of it survives the stage: these are
 * the reduction slots, and a reduction's `outName` may not be the column it
 * reduces.
 */
const PICK = {
  lengthKey: "l6TmLenKey",
  shortest: "l6TmShortest",
  startKey: "l6TmStartKey",
  earliest: "l6TmEarliest",
  refused: "l6TmRefused",
  anyMoved: "l6TmAnyMoved",
  anyRefused: "l6TmAnyRefused",
} as const;

const PICK_WORKING = [
  PICK.lengthKey,
  PICK.shortest,
  PICK.startKey,
  PICK.earliest,
  PICK.refused,
  PICK.anyMoved,
  PICK.anyRefused,
];

/**
 * The columns a caller must put on the cloud BEFORE the loop that trims it.
 *
 * `TRIM.trimmed` and `TRIM.runsTrimmed` accumulate across rounds, so the
 * body reads them on its first round -- when nothing has written them yet.
 * A `repeatUntil` body cannot initialise its own carry, so the wrapper's
 * caller does, and this is the one definition of what "not yet trimmed"
 * looks like.
 */
export function writeTrimInit(g: Graph, cloud: NodeHandle, tag: string): NodeHandle {
  let out = cloud;
  for (const name of [TRIM.trimmed, TRIM.runsTrimmed, TRIM.moved, TRIM.blocked, TRIM.nothing]) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value: 0 }, `${tag}_init_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }
  return out;
}
