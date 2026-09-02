/**
 * L-5's barrier runs, BUILT.
 *
 * WHAT THIS IS AND WHY IT IS SEPARATE FROM `falseEdges.ts`. That file
 * DETECTS a false edge and lowers one member out of the band, and its own
 * header says why that is half the job: "build the lines the way the
 * catalogue does, and add the non-divergence yourself, knowing it is
 * yours." This is the other half. It places the runs `BARRIER` describes —
 * repeated pieces at a fixed offset over a station range — so a lap can
 * HAVE assembled verge lines rather than only be checked for accidental
 * ones.
 *
 * THE PREDICTION IN `falseEdges.ts` IS SETTLED AND THIS IS WHAT SETTLED
 * IT. One primitive, and it had already shipped: `arcTile` lays a repeated
 * piece over arc ranges and `enclosureGraph.ts` already wires it as L-6's
 * tiler. So there is NO NEW NODE here and there is no new param — this file
 * is a CALLER, which is the thing L-5 was actually missing. What `arcTile`
 * does not do is place OFF the curve, and that is `copyToPoints`: it
 * composes `P = targetP + targetRot * (targetScale * sourceP)`, and
 * `arcTile`'s `rot` IS the path frame, so a source point at the local
 * offset is the barrier standing beside the road. L-6 stamps N points
 * across the span with the same node; L-5 stamps one beside it.
 *
 * NOTHING HERE DRAWS INSIDE A RUN, AND THAT IS A MEASUREMENT RATHER THAN A
 * SHORTCUT. `BARRIER.spacingW.cv` of 0.37 is POOLED over runs of differing
 * pitches, so it was worth checking whether it needs a within-run wobble
 * before asking `arcTile` for a `jitter` it deliberately does not have. It
 * does not: a set of INTERNALLY UNIFORM runs at the observed pitch spread
 * already pools to 0.29-0.33 with every gap inside a run identical, and
 * 0.37 sits inside the band seventeen such runs draw from — p10 0.21,
 * p90 0.43 on the widest reconstruction of the unmeasured lower tail, and
 * roughly the p90 of the narrowest. So the honest claim is "not
 * distinguishable from zero jitter", not "the same number". The assembly
 * signature is the BETWEEN-run spread. The pitch is therefore drawn once
 * per run and `arcTile` keeps its "emits no randomness of its own"
 * property.
 *
 * WHAT THIS FILE ITSELF POOLS TO IS LOWER — 0.235 at the suite's own seed,
 * with a median of 0.255 over seeds 1-40 and a spread of 0.083 to 0.353
 * across them, twelve runs to a lap — and the two figures are not in
 * disagreement: 0.29-0.33 reconstructs the CATALOGUE's pitch distribution,
 * while the clamp in {@link planBarriers} ties the piece count to the
 * pitch to keep the span inside the published length band, and a
 * correlation between the two narrows the pooled spread. Both are an order
 * away from C-1's 1.5-2.5, which is the contrast the CV was reported for
 * and the only thing it was ever a target of. The low end of that spread
 * is a seed drawing twelve similar pitches and not a change of behaviour,
 * which is why `tests/racetrackBarriers.test.ts` pins a floor UNDER the
 * whole swept range rather than a figure near the median: the number to
 * quote is the median, and the number to assert is the one every seed
 * clears.
 *
 * AND NOTHING WOBBLES THE LATERAL EITHER, WHICH IS THE INVENTED HALF BEING
 * INVENTED ON PURPOSE. The catalogue's own runs sit 0.063W off their
 * fitted line at the median, and reproducing that with an independent draw
 * per piece brings back the thing L-5 exists to forbid. Measured: a 0.05W
 * per-piece wobble on a five-member run over 6.5W lands the worst residual
 * at 0.057W — the catalogue's own figure, so that IS the right size of
 * wobble — and puts the FITTED SLOPE's spread at 0.0097, half of
 * `FALSE_EDGE.divergence[0]`. About one such run in twenty-five then comes
 * back a false edge by the rule's own definition, out of the wobble alone.
 * Note that this is well short of the 5-in-17 `falseEdges.ts` measured on
 * the catalogue, so the wobble does not even explain the catalogue's
 * divergence — it only reintroduces some of it. Which makes the trade
 * one-sided: a residual nothing downstream reads, bought with the defect
 * the rule is named after. One lateral per run, held all the way along, is
 * the non-divergence being added deliberately and for a stated reason,
 * which is exactly what `falseEdges.ts` asks a generator to do.
 *
 * IT IS NOT WIRED INTO THE DRESSING. `dressGraph.ts` cooks the lap the
 * demo shows, and dropping a new source of placements into it moves the
 * golden and the order-invariance suites. This file is the builder and
 * `tests/racetrackBarriers.test.ts` is the proof, checked on L-5's OWN
 * detector: the runs it makes come back through `edgeRuns` parallel and
 * tight, and `isFalseEdge` refuses every one of them.
 *
 * IT AVOIDS L-1's CONE RATHER THAN BEING REPAIRED BY IT, and that is a
 * measurement and not a preference. Placed blind on the shipped dressing,
 * 11.84% of barrier pieces (8.65 per lap over 1461 pieces) stand in the
 * driver's look-ahead cone. Neither repair is acceptable to a RUN: the
 * per-piece push `cullSightlines` performs put 77 of the 173 pieces it
 * MOVED (44.5%) outside `|t| ∈ [1, 2.5]`, so the line loses members from
 * the band it lives in, and culling whole runs instead costs 2.05 runs a
 * lap.
 *
 * THE DENOMINATOR IS `moved`, NOT `blocking`. They are different counters
 * and the difference is not cosmetic: `cullSightlines` answers a blocker
 * either by pushing it clear (`moved`) or by giving up on it (`dropped`)
 * — because the caller's `dropRatherThanMove` claimed it, or because the
 * ladder reached `maxPushW` still blocked. Only a `moved` piece HAS a
 * final lateral, so only `moved` can be the denominator of "landed outside
 * the band"; a dropped piece is not somewhere else, it is gone.
 * `blocking === moved + dropped` exactly, so the two coincide precisely
 * when `dropped` is 0 — which is what the run above reported: 173 blocked,
 * 173 moved, 0 dropped, so the same 173 pieces answer to either name and
 * the figure reads the same against both.
 *
 * THAT IS A PROPERTY OF THAT RUN AND NOT OF THE CULL, which is why it is
 * spelled out rather than left to coincidence. The DRESSING's own call
 * does pass a `dropRatherThanMove` (see `dress.ts`), and
 * `racetrackDressGraph.test.ts` asserts a non-zero `dropped` on that
 * population. Quote 44.5% against `blocking` there and it is simply the
 * wrong number.
 *
 * Adding `blocksCone` to the rejection test above places 12 of 12 runs on
 * every seed at about 24 attempts a lap out of 2000, with the span
 * distribution unchanged and nothing left blocking — and it still does at
 * a deliberately oversized 2.0x1.1x2.5W piece, at about 52. The sampler
 * stays BOUNDED: a lap that cannot fit a run degrades to fewer runs, the
 * way it already did.
 *
 * `tests/racetrackBarrierMerge.test.ts` RE-MEASURES THAT AT ITS OWN PIECE
 * SIZE and gets 13.50% (9.83 a lap) blind against 0 avoided, with the
 * median span moving 8.70W to 8.17W. The blocked fraction is a property of
 * how big a piece is, so the two figures are the same finding at two
 * sizes rather than a disagreement; what does not move is that the blind
 * number is an eighth of the pieces and the avoided one is zero.
 *
 * AND A PIECE SAYS WHICH RUN ASSEMBLED IT. `runId` is `falseEdges.ts`'
 * column, carried from the plan through `rangeNames` onto every tile,
 * because L-5's repair has to be able to tell an assembled member from a
 * station-born one: a barrier run is parallel in isolation and a stray
 * scattered placement within `gapW` of it joins the run and tilts it. The
 * joiner is the offending element, and without the id the repair punches
 * the hole in the barrier instead. See {@link BARRIER_RUN.runId} for why
 * it is not the same number as `run`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No flare: `arcTile`'s two-mouth ramp
 * is a tunnel's business and a barrier has no mouth, so `flare` is left at
 * its default rather than set to zero for emphasis. No taper, for the same
 * reason. No asset resolution: `piece` is an opaque index the caller's
 * vocabulary owns, carried atomically and never interpreted here, because
 * the run's SHAPE is what L-5 is about and which strip of the catalogue
 * fills it is not. And no `P` of its own once this is wired in — see the
 * note on {@link writeBarriers}.
 */
import {
  type Field,
  type Geometry,
  type Graph,
  type NodeHandle,
  add,
  arcTile,
  attribute,
  copyToPoints,
  createPointCloud,
  dataInput,
  div,
  makeGeometryItem,
  mod,
  mul,
  setAttribute,
} from "pcg-ts";
import { BARRIER, FALSE_EDGE } from "./falseEdges.js";
import { TRACK_FRAME } from "./graph.js";
import { rand } from "./rand.js";
import { type Frame, blocksCone } from "./sightline.js";

/**
 * The columns a barrier run carries.
 *
 * PREFIXED WITH THE RULE, like every other rule-scoped column in this
 * demo, and UNPREFIXED for the three that are the shared track contract —
 * `stationW`, `trackT` and `trackH` are what a placement IS here and are
 * spelled the same way by every stage that makes one.
 */
export const BARRIER_RUN = {
  /** Where the range begins, arc from the start line, in W. */
  startW: "l5StartW",
  /** The range the pieces are laid over, in W. It is `pieces * pitch`. */
  lengthW: "l5LengthW",
  /** How many pieces the range holds. */
  pieces: "l5Pieces",
  /**
   * Which piece of the caller's vocabulary the WHOLE run is made of.
   *
   * THE ATOMIC ONE. It is chosen on the range, where there is exactly one
   * element per run to choose on, and `arcTile`'s `rangeNames` copies it
   * onto every tile unchanged. A per-tile draw would be a different
   * barrier every two metres.
   */
  piece: "l5Piece",
  /**
   * Which run a piece came from — `arcTile`'s `rangeIndexAttr`, and the
   * key `copyToPoints` selects that run's own offset by.
   */
  run: "l5Run",
  /** 0-based position within the run — `arcTile`'s `tileIndexAttr`. */
  tile: "l5Tile",
  /**
   * The run's own identity, as `falseEdges.ts`' `runId` column reads it.
   *
   * NOT THE SAME COLUMN AS {@link BARRIER_RUN.run}, and the difference is
   * load-bearing. `run` is `arcTile`'s `rangeIndexAttr` — a POSITION in
   * the ranges cloud, which is what `copyToPoints` has to key on because
   * that is the key the node itself writes. `runId` is what the plan
   * decided, carried through `rangeNames` unchanged, so it survives the
   * cloud being handed over in a different order. They are equal for a
   * plan passed in the order {@link planBarriers} returned it, which is
   * every caller; they stop being equal exactly when something shuffles,
   * and that is when the distinction earns its keep.
   */
  runId: "l5RunId",
  /**
   * The same range in WORLD units, which is what `arcTile` tiles in.
   *
   * Three columns rather than a multiply downstream because the node reads
   * them off the ranges cloud, and this cloud is built in TypeScript where
   * the multiply is free and exact. `enclosureGraph.ts` spells the same
   * conversion as `setAttribute` nodes only because its ranges are cooked.
   */
  startK: "l5StartK",
  lengthK: "l5LengthK",
  pitchK: "l5PitchK",
} as const;

/**
 * How far a run must clear the next run ON ITS OWN SIDE, in W.
 *
 * `gapW` IS THE RUN DEFINITION, so two runs closer than that are ONE run
 * to `edgeRuns` — with two different laterals in it, which is a diverging
 * line built out of two parallel ones. The margin above it is not slack
 * for its own sake: the ranges are what is separated here and the PIECES
 * sit half a pitch inside their range at each end, so the real clearance
 * between the nearest two members is this plus a pitch. Separating the
 * ranges is the conservative statement and it is the one that is easy to
 * be sure of.
 */
export const BARRIER_SEPARATION_W = FALSE_EDGE.gapW + 1;

/**
 * How far inside each band bound a run is kept, in W.
 *
 * The lateral and the height must land where `inEdgeBand` looks, and that
 * predicate is written in f64 while the columns are f32. `SAME_PLACE_W`
 * would be enough to make the two spellings agree; this is larger because
 * the point is not to sit ON a rung at all. A run drawn onto the boundary
 * is a run whose membership depends on a rounding mode, and L-5's whole
 * postcondition is about what the detector finds.
 */
const BAND_MARGIN_W = 0.05;

/**
 * How close to `gapW` a pitch may be drawn, in W.
 *
 * A pitch AT the gap threshold is not a long run, it is two runs — and the
 * value the graph carries is f32, so a pitch written as exactly `gapW`
 * could come back either side of it. The draw stops short instead.
 */
const PITCH_CEILING_W = FALSE_EDGE.gapW - 0.1;

/** One planned barrier run, before it is a cloud. */
export interface BarrierRun {
  /**
   * The run's identity, and what a piece of it carries as `runId`.
   *
   * ASSIGNED AFTER THE SORT, so it is the run's position in the returned
   * plan. It is never negative, which is what keeps it clear of
   * `STATION_BORN` (-1) and of L-6's `-2 - index()` cover ids.
   */
  readonly runId: number;
  /** Arc from the start line to the start of the RANGE, in W. */
  readonly startW: number;
  /** The range, in W: `pieces * pitchW`. */
  readonly lengthW: number;
  /** First piece to last, in W: `(pieces - 1) * pitchW`. What `BARRIER.runLengthW` measures. */
  readonly spanW: number;
  /** The distance between consecutive pieces, in W. One number for the whole run. */
  readonly pitchW: number;
  /** How many pieces. */
  readonly pieces: number;
  /** Signed lateral, in W. Positive right of travel, like every other `trackT` here. */
  readonly t: number;
  /** Height of a piece's centre above the surface, in W. */
  readonly h: number;
  /** An index into the caller's vocabulary. Opaque here. */
  readonly piece: number;
}

/**
 * Interpolate a quantile function, log-linear once the values separate.
 *
 * THE SAME RULE `drawStretchLengthW` USES, and for its reason: a quantile
 * table whose upper leg spans a factor of several is describing a
 * multiplicative spread, and interpolating it linearly makes almost every
 * draw in that leg land near the top of it. Below a factor of 1.5 the two
 * are indistinguishable and the linear form is used.
 */
function fromQuantiles(cdf: readonly (readonly [number, number])[], u: number): number {
  if (u <= cdf[0][0]) return cdf[0][1];
  for (let i = 1; i < cdf.length; i++) {
    const [u0, v0] = cdf[i - 1];
    const [u1, v1] = cdf[i];
    if (u <= u1) {
      const f = (u - u0) / (u1 - u0);
      if (v1 / v0 > 1.5) return v0 * Math.exp(f * Math.log(v1 / v0));
      return v0 + f * (v1 - v0);
    }
  }
  return cdf[cdf.length - 1][1];
}

/**
 * The pitch of one run, in W, from `BARRIER.spacingW`.
 *
 * THE CENSORED FIGURE IS NEVER READ. `falseEdges.ts` states that the
 * spacing p90 of 2.93W is the 3W run definition showing through rather
 * than a finding, so this table holds the p10 and the median — the two it
 * calls usable — and takes its TOP from the definition itself. That is not
 * the same number arrived at sideways: `gapW` is a rule and 2.93 is an
 * observation of that rule, and building to the rule is honest where
 * building to the observation is circular.
 *
 * NOTHING BELOW THE p10 IS INVENTED EITHER. The tenth percentile is the
 * floor of the draw rather than the start of a made-up tail, because a
 * tail nobody measured would be the one part of the pitch spread that came
 * from this file rather than from the catalogue — and the pitch spread is
 * the whole finding.
 */
export function drawBarrierPitchW(u: number): number {
  return fromQuantiles(
    [
      [0.1, BARRIER.spacingW.p10],
      [0.5, BARRIER.spacingW.median],
      [1, PITCH_CEILING_W],
    ],
    u,
  );
}

/**
 * How many pieces one run holds, from `BARRIER.piecesPerRun`.
 *
 * DRAWN OUT OF THE CENTRAL EIGHTY PERCENT AND NOT THE TAILS. The published
 * maxima — 15 pieces, 40.6W — are single observations out of seventeen
 * runs, and a generator that reaches for them is reproducing one run
 * somebody happened to measure rather than the population. The `u` this
 * takes is therefore mapped onto `[0.1, 0.9]` by its caller, so every draw
 * lands between the p10 and the p90 by construction.
 */
export function drawBarrierPieces(u: number): number {
  return Math.round(
    fromQuantiles(
      [
        [0.1, BARRIER.piecesPerRun.p10],
        [0.5, BARRIER.piecesPerRun.median],
        [0.9, BARRIER.piecesPerRun.p90],
      ],
      u,
    ),
  );
}

/** Extents in W, along the track frame's three axes. What a piece occupies. */
export interface PieceSize {
  readonly across: number;
  readonly along: number;
  readonly tall: number;
}

/**
 * Everything {@link planBarriers} needs to ask L-1's question in advance.
 *
 * `eyes` IS PASSED IN, for `blocksCone`'s own stated reason: the placer
 * must ask the SAME set the cull will, and `defaultEyeStations` allocates
 * a lap's worth per call. One list, built once by the caller, read by
 * both — which is also what makes "planned clear" and "culled clear" the
 * same claim rather than two that happen to agree.
 *
 * `pieceSize` IS A FUNCTION OF THE PIECE because `piece` is an opaque
 * index this file never interprets. The caller's vocabulary owns what a
 * piece is; it also owns how big one is, and the cone test is the first
 * thing here that has to know.
 */
export interface BarrierConeTest {
  /** The lap's own frame lookup, in W — `dress.ts`' `frameLookup(lap)`. */
  readonly frameAt: (stationW: number, lateralW: number, heightW: number) => Frame;
  /** Half the road width in world units, which is what `blocksCone` scales the extents by. */
  readonly halfWidth: number;
  /** Where the cull will stand. `defaultEyeStations(lapW)`, built once. */
  readonly eyes: readonly number[];
  /** How big a piece of the given index is, in W. */
  readonly pieceSize: (piece: number) => PieceSize;
}

/** What {@link planBarriers} is allowed to do. */
export interface BarrierPlanOptions {
  /** How many runs to place. The lap may not fit them all; see the return. */
  readonly count: number;
  /** How many pieces the caller's vocabulary offers. `piece` indexes it. */
  readonly pieceCount: number;
  /** Bounded, like `planEnclosure`'s. A lap that cannot hold `count` runs stops early. */
  readonly maxTries?: number;
  /**
   * L-1's cone, so a run is never PLANNED into it.
   *
   * OPTIONAL BECAUSE A CALLER MAY HAVE NO LAP TO ASK. The builder's own
   * suite cooks barriers against a path and nothing else; a caller with a
   * dressing has `frameLookup` and the eye set already. Left out, this is
   * the sampler that shipped.
   */
  readonly avoidCone?: BarrierConeTest;
}

/**
 * Where the pieces of a planned run stand, in W of arc from the start line.
 *
 * THE SAME ARITHMETIC {@link writeBarriers} WRITES AS A FIELD, and it has
 * to be: a station computed one way here and another way there would let
 * the planner clear a cone the built piece stands in. `arcTile` places its
 * tiles at sub-interval centres, so the i-th of `pieces` over a range of
 * `lengthW` sits half a pitch in.
 */
export function barrierStations(run: BarrierRun, lapW: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < run.pieces; i++) {
    out.push((run.startW + ((i + 0.5) * run.lengthW) / run.pieces) % lapW);
  }
  return out;
}

/**
 * Would ANY piece of this run stand in the driver's cone?
 *
 * RUN-ATOMIC, AND THAT IS THE WHOLE POINT OF ASKING EARLY. The measured
 * alternatives both cost the run: per-piece pushing (what `cullSightlines`
 * does) put 77 of the 173 pieces it MOVED (44.5%) outside `|t| ∈ [1, 2.5]`,
 * which takes them out of the band the line lives in and leaves a line with
 * a hole in it; run-atomic culling AFTER the fact threw away 2.05 runs per
 * lap. `moved` is the denominator and not `blocking`: the two counters
 * coincide only where `dropped` is 0, as it was on that run and is NOT on
 * the dressing. The file header works through why.
 *
 * Rejecting the CANDIDATE costs a draw. Measured over the shipped dressing:
 * barriers placed blind put 11.84% of pieces (8.65 per lap) in the cone,
 * and this test places 12 of 12 runs on every seed at about 24 attempts per
 * lap out of 2000, spans unchanged (median 8.29W → 8.23W).
 */
export function runBlocksCone(run: BarrierRun, lapW: number, cone: BarrierConeTest): boolean {
  const size = cone.pieceSize(run.piece);
  for (const station of barrierStations(run, lapW)) {
    if (
      blocksCone(
        {
          station,
          t: run.t,
          h: run.h,
          across: size.across,
          along: size.along,
          tall: size.tall,
        },
        lapW,
        cone.frameAt,
        cone.halfWidth,
        cone.eyes,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where the barrier runs go.
 *
 * A BOUNDED REJECTION SAMPLER, the same shape as `planEnclosure`, because
 * the accept test reads the set of runs already accepted and there is no
 * closed form for that. It rejects on TWO predicates — a run may not come
 * within {@link BARRIER_SEPARATION_W} of another run on its own side,
 * measured on the loop so a run across the start line is tested against
 * both of its neighbours; and, when the caller hands over a lap to ask on,
 * no piece of it may stand in L-1's look-ahead cone.
 *
 * THE CONE TEST IS LAST BECAUSE IT IS THE EXPENSIVE ONE. Separation is a
 * walk of the accepted list; the cone is a fan of chords per piece per eye
 * in range. Ordering them the other way would pay for the geometry on
 * every candidate the cheap test was going to refuse anyway. Neither
 * predicate draws a random number, so the order changes the cost and not
 * the plan — every draw is made before either runs, and a rejected attempt
 * consumes its draws either way.
 *
 * THE PITCH AND THE PIECE COUNT ARE NOT INDEPENDENT AND MUST NOT BE. The
 * three published marginals cannot all hold at once — a median run of 5
 * pieces at the median 2.59W pitch spans 10.4W, and the published median
 * span is 6.5W — because they are pooled marginals of seventeen different
 * runs rather than a description of one. Two of the three are therefore
 * chosen and the third follows: the pitch and the piece count are drawn,
 * and the count is then clamped to whatever keeps the span inside
 * `BARRIER.runLengthW`'s own p10..p90. That clamp is the real correlation
 * showing up rather than a fudge — a tight pitch needs more pieces to make
 * a run of a given length, and a run stops being a run at all once the
 * pitch reaches `gapW`.
 *
 * EVERY DRAW IS `rand(seed, index, salt)`, this demo's own hash, so a
 * plan is a pure function of its seed and re-planning cannot move a run
 * that was already there.
 */
export function planBarriers(
  lapW: number,
  seed: number,
  opts: BarrierPlanOptions,
): BarrierRun[] {
  const { count, pieceCount } = opts;
  const maxTries = opts.maxTries ?? 2000;
  const out: BarrierRun[] = [];

  for (let attempt = 0; attempt < maxTries && out.length < count; attempt++) {
    const pitchW = drawBarrierPitchW(0.1 + 0.8 * rand(seed, attempt, 0x5b17));
    // The piece count the catalogue would give, then the count this pitch
    // can actually carry inside the published length band. The lower bound
    // wins where they disagree, so a run is never shorter than the
    // catalogue's own p10.
    const wanted = drawBarrierPieces(0.1 + 0.8 * rand(seed, attempt, 0x5b18));
    const least = Math.max(
      BARRIER.piecesPerRun.p10,
      Math.ceil(BARRIER.runLengthW.p10 / pitchW) + 1,
    );
    const most = Math.max(
      least,
      Math.min(BARRIER.piecesPerRun.p90, Math.floor(BARRIER.runLengthW.p90 / pitchW) + 1),
    );
    const pieces = Math.min(most, Math.max(least, wanted));

    const lengthW = pieces * pitchW;
    const spanW = (pieces - 1) * pitchW;
    const startW = rand(seed, attempt, 0x5b19) * lapW;
    const side = rand(seed, attempt, 0x5b1a) < 0.5 ? -1 : 1;
    const t =
      side *
      (FALSE_EDGE.lateralW[0] +
        BAND_MARGIN_W +
        rand(seed, attempt, 0x5b1b) *
          (FALSE_EDGE.lateralW[1] - FALSE_EDGE.lateralW[0] - 2 * BAND_MARGIN_W));
    const h =
      FALSE_EDGE.heightW[0] +
      BAND_MARGIN_W +
      rand(seed, attempt, 0x5b1c) *
        (FALSE_EDGE.heightW[1] - FALSE_EDGE.heightW[0] - 2 * BAND_MARGIN_W);
    const piece = Math.min(pieceCount - 1, Math.floor(rand(seed, attempt, 0x5b1d) * pieceCount));

    // ON THE LOOP, AND BOTH WRAPPED COPIES, exactly as `planEnclosure`
    // tests its overlaps: a run ending at 358W and one starting at 2W are
    // four apart, not three hundred and fifty-six.
    let clear = true;
    for (const other of out) {
      if (Math.sign(other.t) !== side) continue;
      const d = Math.abs(startW - other.startW);
      const gap = Math.min(d, lapW - d);
      if (gap < Math.max(lengthW, other.lengthW) + BARRIER_SEPARATION_W) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;

    // `runId` IS PROVISIONAL HERE and rewritten below the sort. A run
    // needs one to be asked about at all, and the id it ends up with is
    // its place in the finished plan.
    const cand: BarrierRun = {
      runId: out.length,
      startW,
      lengthW,
      spanW,
      pitchW,
      pieces,
      t,
      h,
      piece,
    };

    // L-1, ASKED BEFORE THE RUN EXISTS RATHER THAN AFTER. `blocksCone` is
    // the cull's own verdict, lifted for exactly this, so a run this
    // accepts is one `cullSightlines` will not touch.
    if (opts.avoidCone && runBlocksCone(cand, lapW, opts.avoidCone)) continue;

    out.push(cand);
  }
  // In station order, which is the order everything downstream reads a lap
  // in and costs nothing to give here.
  out.sort((a, b) => a.startW - b.startW);
  // And the ids follow the sort, so `runId` is the run's position in what
  // this returns — which is the ranges cloud's own index for any caller
  // that does not reorder the plan.
  for (let i = 0; i < out.length; i++) out[i] = { ...out[i], runId: i };
  return out;
}

/**
 * The ranges `arcTile` tiles: one point per run.
 *
 * ONE POINT PER RUN IS THE WHOLE MODEL. Every decision a run makes — its
 * pitch, its length, its piece — is made HERE, on the one element that
 * exists per run, and `rangeNames` copies it onto every tile. That is what
 * makes a barrier a barrier instead of a dense scatter, and it is the
 * property `arcTile`'s own description was written around.
 *
 * THE SPACING IS THE COUNT, SPELLED AS A CEILING, and half a tile of
 * margin goes into it for the reason `enclosureGraph.ts` records: the node
 * takes `ceil(L / spacing)` tiles, so asking for exactly `L / n` sits on a
 * ceiling boundary and the f32 round trip can come back with `n + 1`. The
 * pitch is unaffected — the node spaces its tiles as `L / count` whatever
 * spacing produced the count.
 */
export function barrierRanges(runs: readonly BarrierRun[], halfWidth: number): Geometry {
  const geo = createPointCloud(runs.length);
  const p = geo.attrs.point;
  const startW = p.add(BARRIER_RUN.startW, "f32", 1);
  const lengthW = p.add(BARRIER_RUN.lengthW, "f32", 1);
  const pieces = p.add(BARRIER_RUN.pieces, "f32", 1);
  const piece = p.add(BARRIER_RUN.piece, "i32", 1);
  const runId = p.add(BARRIER_RUN.runId, "i32", 1);
  const startK = p.add(BARRIER_RUN.startK, "f32", 1);
  const lengthK = p.add(BARRIER_RUN.lengthK, "f32", 1);
  const pitchK = p.add(BARRIER_RUN.pitchK, "f32", 1);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    startW.set(i, r.startW);
    lengthW.set(i, r.lengthW);
    pieces.set(i, r.pieces);
    piece.set(i, r.piece);
    // FROM THE RUN, NOT FROM `i`. The position is `arcTile`'s business
    // and it writes that itself; this column is the plan's own answer, so
    // a reordered cloud carries the same ids to the same pieces.
    runId.set(i, r.runId);
    startK.set(i, r.startW * halfWidth);
    lengthK.set(i, r.lengthW * halfWidth);
    pitchK.set(i, (r.lengthW * halfWidth) / (r.pieces - 0.5));
  }
  return geo;
}

/**
 * The offsets `copyToPoints` stamps: one point per run, at that run's own
 * place beside the road.
 *
 * THE SOURCE CLOUD IS THE OFF-CURVE HALF OF THE OPERATION and it is one
 * point, not a slot cloud. L-6 needs N pieces ACROSS the span and pays for
 * a fixed-width stamp it filters down; L-5 needs exactly one beside the
 * path, and per-target source selection — `sourceGroupAttr` against
 * `arcTile`'s `rangeIndexAttr` — hands each tile its own run's offset with
 * no over-production at all. This is the capability `enclosureGraph.ts`
 * names as the thing it wished the node had; it has it, and a run placer
 * is what it is for.
 *
 * `P` IS IN WORLD UNITS AND `x` IS NEGATED. `copyToPoints` composes
 * `P = targetP + targetRot * (targetScale * sourceP)`, so this point is
 * read in the TILE's frame, and `arcTile` builds that frame with
 * `orientQuat(..., up = [0, 1, 0], axis = "+z")` — whose local `+x` is
 * `up x forward`, which is LEFT of travel, not right. `trackT` is positive
 * to the right everywhere in this demo, so it enters negated. The height
 * needs no such care: local `+y` is the frame's up.
 *
 * `trackT` AND `trackH` RIDE ALONG AS ORDINARY SOURCE COLUMNS, which is
 * not a coincidence worth hiding — the offset and the track coordinate are
 * the same decision written twice, once for the geometry and once for
 * every rule downstream that reads a placement.
 */
export function barrierOffsets(runs: readonly BarrierRun[], halfWidth: number): Geometry {
  const geo = createPointCloud(runs.length);
  const p = geo.attrs.point;
  const P = p.require("P");
  const run = p.add(BARRIER_RUN.run, "i32", 1);
  const t = p.add("trackT", "f32", 1);
  const h = p.add("trackH", "f32", 1);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    P.setTuple(i, [-r.t * halfWidth, r.h * halfWidth, 0]);
    run.set(i, i);
    t.set(i, r.t);
    h.set(i, r.h);
  }
  return geo;
}

/** What {@link writeBarriers} needs to know about the lap it is tiling. */
export interface BarrierOptions {
  /** Total lap length in half-widths — what a station wraps at. */
  readonly lapW: number;
  /** Half the road width in world units, the scale W is measured in. */
  readonly halfWidth: number;
}

/**
 * The barrier runs, as graph nodes: tile, offset, and say where it is.
 *
 * `path` IS A CLOSED SINGLE-POLYLINE LAP — `lapAsPath`'s output, or a
 * stage carrying it. `arcTile` needs no `pathAttr` for one polyline, and
 * it wraps a range across the start line on a closed path, which is the
 * same seam rule `edgeRuns` applies when it looks for the run again.
 *
 * WHAT IS NOT TAKEN IS THE POSITION, EVENTUALLY. The `P` this leaves on
 * the cloud is a real world position — the piece standing beside the road
 * in `arcTile`'s own frame — and it is what makes this module checkable
 * with nothing else cooked. But `arcTile` builds its frame on a fixed
 * `[0, 1, 0]` up hint while the road is swept on the SURFACE normal, so on
 * a banked corner the two disagree; when this is wired into the dressing,
 * `writeLift` rewrites `P` from `(stationW, trackT, trackH)` like every
 * other placement in this demo and the track coordinates below are what
 * survives. Using the nodes for their tiling and their offset and not for
 * their final placement is the same split the rest of the demo makes.
 *
 * THE STATION COMES BACK FROM THE TILE INDEX, not from the position, so it
 * is `(startW + (i + 0.5) * lengthW / pieces) % lapW` in half-widths
 * exactly, with no world round trip to lose digits in. `arcTile` writes a
 * `curveU` that would answer the same question, and it is not used: it is
 * a fraction of the whole lap in f32, which is the one place a station
 * this demo compares against a 3W gap should not be computed.
 */
export function writeBarriers(
  g: Graph,
  path: NodeHandle,
  runs: readonly BarrierRun[],
  opts: BarrierOptions,
  tag: string,
): NodeHandle {
  const { lapW, halfWidth } = opts;

  const ranges = g.add(dataInput, {}, `${tag}_ranges`);
  g.setParam(ranges, "items", [makeGeometryItem(barrierRanges(runs, halfWidth))]);
  const offsets = g.add(dataInput, {}, `${tag}_offsets`);
  g.setParam(offsets, "items", [makeGeometryItem(barrierOffsets(runs, halfWidth))]);

  // NO FLARE AND NO TAPER, and they are left at their defaults rather than
  // written as zero: a mouth that opens is a tunnel's business, and
  // spelling "this barrier does not flare" as a param would imply the
  // question was live.
  const tiled = g.add(
    arcTile,
    {
      startAttr: BARRIER_RUN.startK,
      lengthAttr: BARRIER_RUN.lengthK,
      spacing: attribute(BARRIER_RUN.pitchK),
      rangeIndexAttr: BARRIER_RUN.run,
      tileIndexAttr: BARRIER_RUN.tile,
      // THE ATOMIC CARRY. One piece for the whole run, chosen upstream on
      // the range point and copied here unchanged.
      rangeNames: [
        BARRIER_RUN.startW,
        BARRIER_RUN.lengthW,
        BARRIER_RUN.pieces,
        BARRIER_RUN.piece,
        BARRIER_RUN.runId,
      ],
    },
    `${tag}_tile`,
  );
  g.connect(path, "out", tiled, "path");
  g.connect(ranges, "out", tiled, "ranges");

  // ONE OFFSET PER RUN, SELECTED BY THE RUN. `arcTile` puts the pieces ON
  // the curve and L-5's barrier stands BESIDE it, which is the one thing
  // that node does not do and the one thing this one does. The source key
  // is `arcTile`'s own range index, so a tile can only ever receive the
  // offset of the run it came from, and every tile receives exactly one.
  const offset = g.add(
    copyToPoints,
    {
      targetNames: [
        BARRIER_RUN.startW,
        BARRIER_RUN.lengthW,
        BARRIER_RUN.pieces,
        BARRIER_RUN.piece,
        BARRIER_RUN.tile,
        BARRIER_RUN.runId,
      ],
      sourceGroupAttr: BARRIER_RUN.run,
      targetGroupAttr: BARRIER_RUN.run,
      topology: "drop",
    },
    `${tag}_offset`,
  );
  g.connect(offsets, "out", offset, "source");
  g.connect(tiled, "out", offset, "target");

  // TRACK COORDINATES, which is what a placement is here. Only the station
  // is computed: `trackT` and `trackH` arrived on the source cloud and
  // rode onto the copies, because the offset that placed the piece and the
  // lateral a rule reads are the same number.
  const along: Field = mul(
    add(attribute(BARRIER_RUN.tile), 0.5),
    div(attribute(BARRIER_RUN.lengthW), attribute(BARRIER_RUN.pieces)),
  );
  const station = g.add(
    setAttribute,
    {
      name: TRACK_FRAME.station,
      tupleSize: 1,
      value: mod(add(attribute(BARRIER_RUN.startW), along), lapW),
    },
    `${tag}_station`,
  );
  g.connect(offset, "out", station, "in");
  return station;
}
