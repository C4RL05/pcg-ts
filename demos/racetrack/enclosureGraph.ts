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
  type NodeHandle,
  add,
  attribute,
  attributeReduce,
  component,
  eq,
  exp,
  ge,
  index,
  le,
  lt,
  max,
  min,
  mul,
  pathRuns,
  pathScan,
  pointGrid,
  pathShift,
  pointsToPath,
  promoteAttribute,
  ramp,
  randomFrom,
  repeatUntilNode,
  select,
  setAttribute,
  sub,
  transferAlongPath,
} from "pcg-ts";
import { CORNER_MODEL, TRACK_FRAME } from "./graph.js";
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

/** The detail attribute `repeatUntil` reads to decide whether to run again. */
export const PLAN_SETTLE = "l6Working";

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
  /** How much lap to put under cover, in W: `longCoverBudgetW`'s answer. */
  readonly budgetW: number;
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
    { arcAttr: SCRATCH.bcast, attributes: [PLAN.tightAtStart, PLAN.beforeTightW] },
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
  const { lapW, budgetW, attempts } = opts;
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
