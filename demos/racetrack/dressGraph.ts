/**
 * Level 1's rules, as a graph.
 *
 * WHAT LEVEL 1 IS, AND WHY IT HAS TO BECOME NODES. Level 0 decides the
 * placement LIST once per track — a station, an asset, a lateral, a
 * height, and which recorded pose of that asset to draw. Level 1 owns the
 * GEOMETRY: turning each of those rows into oriented boxes, keeping them
 * out of the corridor, and measuring what the result does to the lap.
 * That is the half a game streams per cell, so it is the half that has to
 * cook, cache, partition and lower like everything else in this library
 * rather than being a synchronous pass a page runs once.
 *
 * FIVE STAGES, AND ONE TEST FOR ADMISSION. Z-1, the box build, L-1's
 * sightline cull, L-5's false-edge detector and L-6's enclosure
 * measurement are each a PURE function of the placement list and the lap:
 * every one of them answers from the list it was handed and from nothing
 * another repair wrote, so each is a chain of nodes and the five compose
 * by wiring.
 *
 * L-1 PASSES THAT TEST DESPITE LIVING INSIDE `dressLap`'s REPAIR LOOP, and
 * telling those two things apart is the whole reason a fourth stage was
 * admissible. The cull is in the loop because the OTHER repairs push
 * placements back into the cone — the coverage fill moves a piece into the
 * gap the cull just opened, the mix redraws a placement with a larger
 * asset — not because the cull reads anything they produced. Given a list,
 * it answers; run it twice on its own output and the second run moves
 * nothing. That is what makes it a node rather than a phase.
 *
 * WHAT IS STILL MISSING IS THE LOOP, AND THE STAGES OUTSIDE IT ARE OUT FOR
 * DIFFERENT REASONS. This paragraph used to say they all read a
 * measurement the previous repair invalidated. That is true of the cover
 * tiler and it is FALSE of the rest, which is worth correcting rather than
 * softening, because it is the admission test itself:
 *
 *   - L-6's COVER TILER genuinely reads one. `dress.ts` measures
 *     `buildBoxes` over the list every other repair has already rewritten
 *     this round, and its own comment insists on the placement ("34.2%
 *     before the cull, 24.8% after"). It also draws from `seed + rounds`,
 *     so a second run over its own output places different tunnels from
 *     the same budget. Both halves fail.
 *   - L-5's FALSE-EDGE DETECTOR reads nothing of the kind — only `t`, `h`,
 *     `station` and the lap length — so it is IN, and {@link writeFalseEdges}
 *     is it. It sits in `dressLap`'s loop for L-1's reason: the other
 *     repairs move placements into and out of the edge band. The cull is
 *     the clearest case, and it moves them IN — on these four laps the
 *     detector finds more false edges after L-1 has run than before it,
 *     because pushing a piece off the racing line is exactly how it ends
 *     up in the verge at edge height.
 *   - Z-3's BAND MIX and L-4's LANDMARKS are list arithmetic over the
 *     whole lap, and the plan puts them on the UNBOUNDED level rather than
 *     here — not because they are impure but because a cell cannot see the
 *     lap they are stated over.
 *
 * What is left is the loop, which is a real gap and not a stage: a
 * fixed point is expressible as a graph and it is not expressible as THIS
 * graph, because nothing re-cooks a subgraph until an output settles.
 * `dress.ts` keeps running exactly as it did and nothing calls this but
 * its test.
 *
 * AND THE CULL HERE IS STRICTER THAN THE ONE IN `dress.ts`, IN TWO WAYS
 * THAT ARE WORTH TELLING APART.
 *
 * THE FIRST IS SAMPLING, AND IT IS A FINDING. L-1 requires the next 12W of
 * centreline to be visible FROM ANY STATION. `defaultEyeStations` checks
 * every 2W, which its own comment labels a compromise. `occlusionCull`
 * takes its eyes from the points of the path it is handed, and the path
 * handed to it here is the lap's own frames — 900 of them, about 0.385W
 * apart. On a dressing `dressLap` has already run to CONVERGENCE, that
 * finer eye set still finds 3 to 9 placements per lap standing in the
 * cone, every one of them clearable by a push. Those are real violations
 * the 2W sampling stepped over, and `tests/racetrackDressGraph.test.ts`
 * pins the count so that it fails if it grows rather than passing quietly
 * if it shrinks.
 *
 * THE SECOND IS THE SHAPE OF THE EYE WINDOW, AND IT HAS NOT FIRED YET.
 * `cullSightlines` narrows the eyes it tests by ARC LENGTH — a placement is
 * only checked against eyes within 12W of it along the centreline, wrapped.
 * `occlusionCull` narrows by a EUCLIDEAN radius around the box, which on
 * this lap is about 220 world units, so an eye on a DIFFERENT stretch of
 * circuit that happens to pass close by contributes its whole fan. That is
 * the right answer — the cone is a chord through space and a track that
 * folds back on itself really can be blocked from across the fold, which
 * is the same argument `enclosure.ts` makes when it withdraws a published
 * figure for projecting bounds onto a folded centreline. But it is a
 * superset the reference cull cannot reproduce, so the exact agreement the
 * test measures is evidence that no such case AROSE on these four laps and
 * not that the two windows are equivalent. A circuit that brought two
 * stretches within ~200 units would separate them.
 *
 * THE ENTRY POINT IS SPLIT IN TWO, AND THE SPLIT IS THE ANSWER TO THE
 * STRUCTURAL PROBLEM. The rules `dress.ts` states are synchronous
 * functions over a cooked `Lap`; a graph must be COOKED, which is async.
 * Making the rules async would turn every caller of `resolveCorridor`
 * into an await and break the repair loop, which is the one change that
 * breaks everything at once. So:
 *
 *   - {@link buildDressGraph} is SYNCHRONOUS and returns a `Graph`. The
 *     page already draws a read-only picture of the graph behind it
 *     (`shared/graph/`), and a picture must not require a cook.
 *   - {@link dressLapByGraph} is the only async thing here: it builds,
 *     cooks, and reads the columns back into plain arrays.
 *
 * NOTHING IN `dress.ts` IS IMPORTED AT ALL, which was not true until the
 * frame moved. This file used to reach into it for `frameLookup`, and the
 * paragraph that stood here explained why: each placement arrived already
 * carrying the lap's pose at its own station, because "there is no node
 * that samples a path's frame at a per-point arc length for a foreign
 * cloud, so the interpolation `poseAt` does cannot be stated here", and it
 * was reported rather than worked around.
 *
 * THE REPORT WAS ACTED ON. `transferAlongPath` is that node — its own
 * description opens by naming the operation "the library had no node for"
 * — and {@link sampleTrackFrame} is the demo finally using it. So the pose
 * at a station is no longer a TypeScript loop run at BUILD time over a
 * cooked lap; it is a stage, and a placement now arrives holding track
 * coordinates and nothing else. That is the difference between a graph
 * handed a list of world positions and a graph handed a list of stations,
 * which is the only one of the two a caller could serialize.
 */
import {
  Graph,
  type DataCollection,
  type ExposedPin,
  type Field,
  type Geometry,
  type NodeHandle,
  abs,
  add,
  attribute,
  attributeReduce,
  clamp,
  copyToPoints,
  cook,
  createPointCloud,
  dataInput,
  div,
  dot,
  eq,
  filterByExpression,
  firstGeometry,
  floor,
  ge,
  index,
  gt,
  le,
  lt,
  makeGeometryItem,
  max,
  min,
  mergePoints,
  mod,
  mul,
  occlusionCull,
  orientAlongVector,
  pathCoverage,
  pathScan,
  pointsToPath,
  promoteAttribute,
  quotaRebalance,
  randomField,
  randomFrom,
  removeAttribute,
  repeatUntilNode,
  runFit,
  select,
  transferAlongPath,
  transferAttribute,
  transferByIndex,
  setAttribute,
  sub,
  vec,
} from "pcg-ts";
import { rand } from "./rand.js";
import { TRACK_FRAME } from "./graph.js";
import type { Kit } from "./kit.js";
import type { Lap } from "./lap.js";
import type { MarkerKit, StationedPlacement } from "./legibility.js";
import {
  CORNER_BOOKKEEPING_SCRATCH,
  CORNER_LANGUAGE_OUTPUTS,
  CORNER_LANGUAGE_SCRATCH,
  PLACED,
  VICTIM,
  addCornerBookkeeping,
  addCornerLanguage,
} from "./cornerGraph.js";
import { cornersOf, type Corner } from "./corners.js";
import { FALSE_EDGE } from "./falseEdges.js";
import { SIGHTLINE } from "./sightline.js";
import { SAME_PLACE_W } from "./tolerance.js";
import { BAND_T, Z3, lateralReach, type Band } from "./assets.js";
import {
  ASSET,
  CHOICE,
  addAssetChoiceStage,
  assetCloud,
  quantileField,
} from "./assetGraph.js";
import {
  STATION_LENGTH_ATTR,
  addCoverageRepair,
  addStationStage,
  lapAsPath,
} from "./stationGraph.js";
import type { StationParams } from "./stations.js";
import type { PlaceableAsset } from "./assets.js";
import { CORRIDOR, OVERHEAD, fitsOverhead } from "./zones.js";
import {
  BUDGET,
  COVER_ASSET,
  PIECE,
  PLAN,
  PLAN_PIN,
  TRIM,
  addEnclosurePlan,
  addEnclosureTiles,
  coverCloud,
  coverPoseCloud,
  maxColumns,
  slotCloud,
  writeCornerTests,
  writeCoverBudget,
  writeCoverTrim,
  writeTrimInit,
  type PlanOptions,
} from "./enclosureGraph.js";
import { LONG_QUANTILE, coverCandidates } from "./tunnels.js";

/**
 * The station in WORLD units, which is the only unit `transferAlongPath`
 * gathers in — see {@link sampleTrackFrame}. Scratch: written just before
 * the gather and stripped just after, so it never rides the carry.
 */
const FRAME_ARC_WORLD = "frameArcWorld";

/**
 * How many enclosure candidates the planner builds.
 *
 * REPORTED RATHER THAN HIDDEN, as the param it feeds says: every attempt
 * is a POINT that exists whether or not the loop reaches it. Measured, a
 * lap at a real budget makes 1 to 50 attempts and accepts 1 to 4, so this
 * is five times the worst seen -- and the loop publishes how many it
 * spent, so a plan that ran out of candidates says so.
 */
const L6_ATTEMPTS = 256;

/** Scratch the cover conversion writes and strips again. */
const SCRATCH_POSE = "l6PoseScratch";

/** The named outputs a cook of this graph produces. */
export const DRESS_OUTPUTS = {
  /** One point per placed box: P the world centre, rot the track frame, scale the world extents. */
  boxes: "boxes",
  /**
   * How many rounds the repair loop ran, and whether it settled.
   *
   * VALUE ITEMS RATHER THAN COLUMNS, because neither is a fact about a
   * placement. `rounds` counts cooks of the body; `converged` is false
   * exactly when the last round still moved something and the cap stopped
   * it. `dressLap` reports both in a stat line and this restates them as
   * graph outputs, which is the difference between a bounded repair that
   * says it ran out and one whose caller has to know to look.
   */
  rounds: "rounds",
  converged: "converged",
  /**
   * The same two for the FIRST repair pass -- the one that runs before
   * L-6 has added anything.
   *
   * BOTH PASSES ARE PUBLISHED BECAUSE THEY ANSWER DIFFERENT QUESTIONS, and
   * one number could only answer the second. `rounds` is what the lap that
   * came OUT cost to settle, which is what a caller budgeting a cook wants.
   * These are what the lap cost before enclosure existed, which is the only
   * figure comparable with a reference loop run over the same list -- and
   * that comparison is the one thing that can catch a settle signal
   * counting the wrong thing.
   */
  roundsFirst: "roundsFirst",
  convergedFirst: "convergedFirst",
  /**
   * The list as it ENTERED the first repair pass -- before any rule ran.
   *
   * PUBLISHED BECAUSE THE COUNT STOPPED BEING SOMETHING THE CALLER HAS.
   * `dropped` is how many the cull removed, which is the input count minus
   * the first pass's, and the input count used to be `input.placements.length`
   * -- a number the caller was holding because the caller had built the
   * list. Once the graph can decide the list, nobody outside it knows how
   * long it is, so the graph says.
   *
   * IT IS ALSO THE ONLY WAY TO SEE WHAT THE ASSEMBLY BUILT. Every other
   * placement output is post-repair, so a lap whose stations all drew
   * nothing and a lap whose rules culled everything look identical from
   * outside. These are different failures and they should not read the same.
   */
  placementsInput: "placementsInput",
  /**
   * The settled list BEFORE L-6, one point per surviving placement.
   *
   * THE ONLY OUTPUT COMPARABLE WITH A LOOP THAT HAS NO ENCLOSURE IN IT.
   * `placements` is the lap as it finished -- Z-1, L-1 and L-5 run a second
   * time over a population that now contains tunnels, and a tunnel is an
   * occluder, so the cull's verdict on an ordinary placement legitimately
   * differs from what it was before one was built beside it. That is the
   * rule working, not drift; but it means a reference that never saw cover
   * can only be compared against the pass that had not seen it either.
   */
  placementsFirst: "placementsFirst",
  /**
   * One point per placement, after Z-1 and lifted into the world, before
   * L-1 has removed or moved anything.
   *
   * PUBLISHED SEPARATELY FROM {@link DRESS_OUTPUTS.placements} BECAUSE THE
   * TWO ANSWER DIFFERENT QUESTIONS, and one output could only answer the
   * second. Z-1's verdict is "what did the corridor rule do to the list it
   * was given", and it stops being readable off the final cloud the moment
   * the cull moves a lateral: a placement Z-1 left alone and L-1 shoved
   * half a W outward is indistinguishable, in `trackT` alone, from one
   * Z-1 stood off. This is also what the cull is MEASURED against — the
   * count
   * it removed and the distance it pushed are both differences between
   * these two clouds.
   */
  placed: "placed",
  /** One point per surviving placement, after Z-1 and L-1, before L-5. */
  culled: "culled",
  /**
   * One point per surviving placement, after Z-1, L-1 and L-5.
   *
   * AND IT CARRIES POLYLINE TOPOLOGY, which the other two do not: L-5
   * builds two or three paths over this cloud to scan its runs, and
   * nothing downstream of it removes a point, so the primitives survive to
   * the output. Harmless where it goes — `copyToPoints` documents that a
   * target's own topology is never read — and worth naming, because a
   * consumer that treated this as a bare cloud would be right about the
   * points and wrong about the geometry.
   */
  placements: "placements",
  /** The lap's frames, one column wider: `covered` and `coverHits`. */
  coverage: "coverage",
  /**
   * The same, measured BEFORE L-6 added anything.
   *
   * WHAT ENCLOSURE DID IS A DIFFERENCE and a caller cannot take it from
   * one number. The lap arrives with incidental cover -- overhangs the
   * ordinary dressing happens to produce -- and the rule's whole job is to
   * lift that to a share held in long stretches, so "8.8% of lap" means
   * nothing without the "0.6%" it started from.
   */
  coverageFirst: "coverageFirst",
} as const;

/**
 * L-6's numbers, restated a THIRD time, and the repetition is the point.
 *
 * `enclosure.ts` already argues why its copy is restated rather than
 * imported from `zones.ts`: those are placement rules that may be
 * retuned, this is a measurement whose whole value is that a figure taken
 * today compares with one taken upstream, and a measurement that moves
 * when a rule is tuned measures the tuning. `pathCoverage`'s own `far`
 * description makes the same argument from the library's side — "prefer
 * restating the number here to importing it from whatever placed the
 * boxes".
 *
 * So this file states them again rather than importing `ENCLOSURE`, and
 * `tests/racetrackDressGraph.test.ts` pins the two tables equal. Two
 * independent statements of one measurement that are CHECKED equal is a
 * different thing from one statement read twice: the check is what would
 * catch a hand edit here, and the independence is what keeps a later
 * retune of `zones.ts` from silently moving both.
 *
 * The units are half-widths. `pathCoverage` wants world distances, so
 * every one of them is multiplied by the lap's own half-width where it
 * is wired in — which is also what makes these numbers a statement about
 * any track rather than about this one.
 */
export const COVER = {
  /** Rays span `-corridorW .. +corridorW`. */
  corridorW: 1.5,
  /** How many, endpoints included. */
  rays: 6,
  /** Below this a box is scenery beside the road, not cover over it. */
  floorW: 1.2,
  /** Above this it is sky. Without a ceiling the skybox is a tunnel. */
  ceilingW: 6,
  /** At least half. */
  minHits: 3,
} as const;

/**
 * The detail attribute the repair body publishes and `repeatUntil` reads.
 *
 * Named here rather than left at the node's default so that the body and
 * the wrapper cannot disagree about it: they are wired together in
 * {@link assemble}, and a default that matched by luck would keep matching
 * right up until somebody changed one of them.
 */
const SETTLE_ATTR = "moves";

/**
 * How many rounds the repair may take before it is stopped and told so.
 *
 * TWELVE, WHICH IS `dressLap`'s `MAX_REPAIR_ROUNDS` AND NOT A COINCIDENCE
 * — the two loops have to be able to disagree about the ANSWER without
 * disagreeing about how hard they tried. It is a ceiling and not a
 * schedule: these three repairs settle in one round on the shipped
 * vocabulary and two on one of the four seeds, so the cap has never been
 * approached here. `dressLap` reaches it on the enclosed kit, but on a
 * repair that is not in this body.
 */
const MAX_ROUNDS = 12;

/** The columns this graph reads off the placement cloud it is handed. */
export const PLACEMENT = {
  /** Centreline point at the placement's station, world units. */
  framePos: "framePos",
  /** The three axes there. Named apart from `TRACK_FRAME` on purpose — see below. */
  across: "frameAcross",
  along: "frameAlong",
  up: "frameUp",
  /** Signed lateral in W. Positive RIGHT of travel. */
  t: "trackT",
  /**
   * Z-1's answer for the lateral, before it replaces `trackT`.
   *
   * A COLUMN RATHER THAN A WIRE, because a `setAttribute` chain has no
   * other way to hold a value that must not be visible to the node in
   * between. It survives onto the placement output, where it is harmless
   * and honest: it says what the corridor rule decided, next to what the
   * placement ended up with.
   */
  tNext: "trackTResolved",
  /** Height of the placement's CENTRE above the surface, in W. */
  h: "trackH",
  /** The asset's own extents, in W — what Z-1 resolves the corridor BY. */
  sizeAcross: "sizeAcross",
  sizeAlong: "sizeAlong",
  sizeTall: "sizeTall",
  /** 1 on an L-6 cover piece, which Z-1 must not touch. */
  cover: "cover",
  /** Which entry of the pose library this placement draws its boxes from. */
  pose: "placementPose",
  /**
   * The asset id a spawner keys its batches by. See {@link poseAssetId}.
   *
   * A STRING, AND THE ONLY ONE ON THIS CLOUD, which is affordable here
   * and nowhere downstream. `spawnInstances` groups by a string point
   * attribute, so a per-point id has to be written from a TABLE of them,
   * and this cloud is built once per lap, a few hundred points.
   *
   * THIS USED TO SAY "there is no field that produces one" AND THAT WAS
   * FALSE WHEN IT WAS WRITTEN, which matters because it is the sentence
   * anyone porting the band mix into the repair body will read first.
   * `setAttribute` with `type: "string"` has taken a field-capable INDEX
   * selector into a `values` list since well before this file existed, and
   * `graphs/basics-spawn-by-species.json` ships exactly that straight into
   * `spawnInstances`. So a graph stage CAN rewrite this column, given the
   * kit's ids as a table -- the reason the redraw is still TypeScript is
   * the pose, which is drawn from a library the repair body is not
   * handed, not the string. The conclusion below is unaffected: it rests
   * on the second argument, which is about cost per BOX. The same
   * column on the BOXES would be written once per BOX — five or six times
   * as many writes, every one of them a string intern, to answer a
   * question `placementIndex` already answers by lookup. That asymmetry
   * is the reason the streamed level spawns one instance per PLACEMENT
   * rather than one per box, and it survives per-target source selection:
   * selection cut the number of copies, not the cost of a column that
   * rides every one of them.
   */
  asset: "assetId",
  /**
   * Arc length from the start line, in W.
   *
   * ON THE CLOUD BUT NOT CARRIED ONTO THE BOXES, and the restraint is
   * deliberate: every column named in `targetNames` is written once per
   * COPY. That used to be the whole pose library times the whole
   * placement list and is now the box count, which is three orders
   * smaller and still not a reason to carry it — `placementIndex` names
   * the placement and everything about a placement is one lookup away.
   * The rule did not change when the cost did. It stays here because the
   * placement cloud is an output in its own right and a placement with no
   * station is not a placement.
   */
  station: "stationW",
  /**
   * Where this placement sat in the list the graph was handed.
   *
   * THE CULL IS THE FIRST STAGE THAT REMOVES ANYTHING, and a survivor with
   * no name is a survivor nobody can match to what went in. `copyToPoints`
   * writes a `placementIndex` downstream, but that indexes the SURVIVOR
   * cloud, which is a different list the moment one placement is dropped —
   * so the two columns are not two spellings of one fact and neither can
   * be derived from the other.
   */
  id: "placementId",
  /**
   * 1 on a placement L-1 must DROP rather than push aside.
   *
   * L-3's braking ruler is the case: a row of marks with one shoved out of
   * line reads as a mistake, where the same row two marks shorter still
   * reads as a row. `occlusionCull` spells it as a per-point `pushMax` of
   * zero, which is the same exception `cullSightlines` takes through its
   * `dropRatherThanMove` predicate.
   */
  locked: "placementLocked",
  /**
   * The world position the lift produced, kept so the push can be read back.
   *
   * `occlusionCull` MOVES `P` and says nothing about how far, which is the
   * right contract for a node that knows nothing about tracks — but this
   * demo's lateral is a track coordinate, and a `trackT` left describing a
   * position the placement no longer occupies is worse than no column at
   * all. Recovering the lateral from the moved `P` alone would mean
   * projecting onto `across` and dividing, which picks up `up · across`
   * times the height: the interpolated frame is mutually orthogonal only
   * to about 1.9e-4, so a piece 6W up would come back with its lateral
   * wrong by 1e-3W — ten times `SAME_PLACE_W`, on a column that is
   * supposed to be exact. The DIFFERENCE of the two positions is purely
   * along `across`, so projecting THAT drops the shear term entirely; what
   * it still carries is the f32 rounding of the moved position at the
   * lap's WORLD scale, which is the term `LATERAL_TOL`'s replacement in
   * the test is derived from.
   */
  placedP: "placedP",
  /** How far L-1 pushed this placement along `across`, in W. 0 if it did not. */
  pushW: "conePushW",
  /**
   * `|t|`, which is what L-5 fits its line through rather than `t`.
   *
   * A SIGNED LATERAL WOULD MAKE THE TWO SIDES CANCEL. `falseEdges.ts`
   * fits the magnitude for the same reason it groups by side: a run is a
   * line of objects drifting away from the road, and the left side drifts
   * negative while the right drifts positive. Fitting `t` would give a
   * left-hand barrier a slope of the wrong sign and put it outside the
   * divergence band, so the rule would only ever fire on the right.
   */
  absT: "edgeAbsT",
  /** 1 while this placement sits in L-5's edge band. See {@link writeFalseEdges}. */
  band: "edgeBand",
  /**
   * Which polyline this placement belongs to for the run scan: -1 left of
   * the racing line, +1 right of it, 0 for everything not in the band.
   *
   * THE THIRD GROUP IS WHAT LETS THIS STAGE AVOID A FILTER, and that
   * matters more than it looks. `runFit` reads polylines, so the band
   * members have to be gathered into paths — and the obvious way, a
   * `filterByExpression` into a band branch and a rest branch, would have
   * to put the two back together with `mergePoints`, which CONCATENATES.
   * The placement cloud would come out band-first, `copyToPoints` would
   * lay its boxes out in that order, and `buildBoxes`' order would be gone
   * — with nothing in the library to restore it, since `transferAttribute`
   * maps clouds by proximity and no node sorts a cloud by an attribute.
   *
   * `pointsToPath` builds primitives over the SAME points and permutes
   * nothing, so parking the non-members in a path of their own keeps every
   * placement where it was. Their runs are computed and never read, which
   * costs one least-squares fit over the majority of the cloud and buys
   * the whole ordering problem.
   */
  group: "edgeGroup",
  /** `runFit`'s output columns, read by the drop gate and by the test. */
  slope: "edgeSlope",
  residual: "edgeResidual",
  span: "edgeSpan",
  runIndex: "edgeIndex",
  runCount: "edgeCount",
  /** 1 on the one placement per qualifying run that L-5 lowers. */
  drop: "edgeDrop",
  /**
   * The uniform `poseFor` draws its pose with, carried rather than redrawn.
   *
   * THE ONE PART OF THE REDRAW THAT IS EXACT, and it is exact because of
   * what `poseFor` keys on: `rand(seed, round(station * 97), 0x7053)`,
   * which is a function of the STATION and nothing else. Z-3 never moves a
   * placement along the lap, so this number is known when the cloud is
   * built and does not have to be a field -- which matters, because it is
   * an integer hash rather than `randomField` and no field computes it. A
   * placement that keeps its asset therefore keeps its pose to the bit,
   * and one that changes asset takes the same uniform into a different
   * pose list, which is what the rule does.
   */
  poseU: "posePick",
  /**
   * Which of Z-3's six bands this placement is in, as an INDEX into
   * {@link MIX_BANDS} — the ladder `bandOfPlacement` walks, transcribed.
   *
   * NAMED APART FROM {@link PLACEMENT.band}, which is L-5's edge band and
   * is a 0/1 membership flag rather than a six-valued index. Two rules,
   * two meanings of the word, and one column each.
   */
  mixBand: "mixBand",
  /**
   * 1 on a placement Z-3 may not move: a corner marker or a landmark.
   *
   * AN INPUT COLUMN AND NOT A DERIVED ONE, because what it stands for is
   * a decision two OTHER rules already took. L-2 and L-3 reserve asset
   * ids for the corner language and L-4 holds one asset unique per tenth
   * of the lap; both outrank a distribution, for the reason `dress.ts`
   * gives — a marker moved to balance a band is a corner that no longer
   * announces itself. The graph is told which those are rather than
   * re-deriving them, since re-deriving L-4's set is re-deriving L-4.
   */
  mixPinned: "mixPinned",
  /**
   * Z-3's answer: the band this placement should be redrawn into, or -1
   * where it stays. See {@link writeBandMix}.
   */
  mixTarget: "mixTarget",
  /**
   * 1 where Z-3 has already redrawn this placement on this lap.
   *
   * THE GRAPH'S `failed` SET, AND IT IS WHAT MAKES THE LOOP TERMINATE.
   * `repairBandMix` remembers the (donor, band) pairs it has tried and
   * will not offer the same donor twice, without which "the scan for a
   * donor is a linear `find`, so the same first-in-band placement is
   * chosen every time and the loop spends the whole population budget
   * re-deciding the same thing" — its own words. The graph met the same
   * wall one level up: the mix refills a band, the NEXT round's cull
   * pushes the replacement clear of the racing line, the push changes its
   * band, and the quota — which takes the first eligible member in station
   * order, and that is still this one — marks it again. Measured over
   * twenty seeds without this column, the graph ran out of rounds on two
   * of them where `dressLap` settled on every one.
   *
   * A placement may therefore be redrawn at most ONCE per lap, which
   * bounds the mix by the population exactly as the reference's own pass
   * loop is bounded. It costs nothing on the seeds that already settled:
   * round one does essentially all of the work and never asks twice.
   */
  mixTried: "mixTried",
  /**
   * The start station of the enclosure run a cover piece came from, in W;
   * -1 on everything else.
   *
   * A RUN IS WHAT A READER COUNTS. Sixteen pieces is a fact about tiling
   * and three runs is a fact about the lap, and only one of them is what
   * somebody looking at the track would say. `dressLap` reports the same
   * two numbers side by side for the same reason.
   */
  coverRun: "coverRun",
  /** 1 where Z-1 moved this placement this round. See {@link writeCorridor}. */
  corridorMoved: "corridorMoved",
  /**
   * 1 where ANY repair moved this placement this round — the per-point half
   * of the loop's settle signal.
   *
   * A COLUMN AND NOT A COUNT, because the only thing that can be summed
   * into a geometry-wide number is a per-element attribute. See
   * {@link writeSettleCount} for what it is summed into and for the one
   * thing it deliberately cannot see.
   */
  roundMoved: "roundMoved",
} as const;

/** The columns the pose library carries, one point per box of one pose. */
const BOX = {
  /**
   * Which pose this box belongs to — the SOURCE half of the copy's
   * selection key, matched against `PLACEMENT.pose` by `copyToPoints`
   * itself rather than by a filter downstream of it.
   */
  pose: "boxPose",
  // THE KIT'S ROLE AND THICKNESS ARE NOT CARRIED, and the omission is the
  // same economics `writeBoxes` argues for `cover`. Both were on the pose
  // cloud and nothing read either. A source column rides EVERY copy the
  // node emits, and `role` was a STRING, so each of those was a fresh
  // intern on top of the write. Selection cut the copy count from
  // ~776,000 a lap to ~2,000, which makes the saving smaller and the
  // argument no weaker: `spawn.ts` derives the role it needs from the kit
  // directly, and one lookup still beats a column written per box and
  // thrown away.
  /** Index of the placement this box decomposes, written by `copyToPoints`. */
  placement: "placementIndex",
} as const;

/**
 * The smallest world extent a box may have. `dress.ts`'s own floor.
 *
 * Three quarters of a measured kit is single-sided surface, so a box's
 * depth is frequently exactly zero. A zero extent is a degenerate slab
 * that the ray test answers containment for rather than crossing, and it
 * draws as nothing — so `buildBoxes` floors it, and this has to floor it
 * at the same value or every sheet in the vocabulary lands somewhere else.
 *
 * PRIVATE, AND REACHED ONLY THROUGH {@link poseBoxesW}. Everything that
 * turns a pose into geometry — the point cloud below, the merged mesh in
 * `assets3d.ts` — asks that function for boxes rather than asking here for
 * the number, so there is no second place for the floor to be applied at a
 * different scale or forgotten.
 */
const MIN_EXTENT_WORLD = 1e-3;

/**
 * What {@link dressLapByGraph} answers with, WITH L-6's own figures folded
 * in rather than restated: {@link EnclosureReport} is the one definition of
 * them, and the page reads the same four numbers off a cell.
 */
export interface GraphDressing extends EnclosureReport, RepairReport {
  /** One point per box, in `buildBoxes`' own order: placement, then pose box. */
  readonly boxes: Geometry;
  /** The placement cloud after Z-1 and the lift, before L-1 ran. */
  readonly placed: Geometry;
  /** The same cloud after L-1: the survivors, at the laterals it left them. */
  readonly culled: Geometry;
  /** And after L-5: the same survivors, at the heights it left them. */
  readonly placements: Geometry;
  /**
   * The settled list BEFORE L-6 added anything -- see
   * {@link DRESS_OUTPUTS.placementsFirst}.
   *
   * Published so that what enclosure DID is a difference between two
   * clouds rather than a number this file would otherwise have to report
   * on its own. It is the same argument `placed` and `culled` are here
   * for: a stage's effect is legible when both sides of it are.
   */
  readonly placementsFirst: Geometry;
  /**
   * The list as it ENTERED the first pass -- see
   * {@link DRESS_OUTPUTS.placementsInput}.
   *
   * The only view of what the assembly built, and the count `dropped` is
   * measured against. A caller that handed a list in already has this and
   * one that did not has nowhere else to get it.
   */
  readonly placementsInput: Geometry;
  /**
   * BOTH PASSES' ROUNDS, SUMMED, because that is what the cook actually
   * spent. `RepairReport` publishes the two apart so a caller can tell
   * which half a lap's cost came from; a stat line wants the total.
   */
  readonly rounds: number;
  /**
   * How many copies the box build actually emitted.
   *
   * REPORTED BECAUSE IT USED TO BE THE COST OF A MISSING NODE CAPABILITY
   * and is now the measurement that says the capability is doing its job.
   * It was the pose library times the placement count — one source cloud
   * stamped on every target, with the wrong copies filtered away — and
   * `writeBoxes` records what that cost. With `copyToPoints`'
   * `sourceGroupAttr`/`targetGroupAttr` this is the number of boxes the
   * lap has, so the ratio of this to `boxes.pointCount` is 1 and stays
   * there. A ratio that drifts off 1 means something started stamping
   * again, which is exactly what a number nobody prints is nobody's job
   * to notice.
   */
  readonly stamped: number;
  /** The graph itself, for the page's read-only picture. */
  readonly graph: Graph;
  readonly cookMs: number;
}

/** What the graph needs to be built at all. */
export interface DressGraphInput {
  readonly kit: Kit;
  readonly lap: Lap;
  /**
   * The cooked level-0 frames, as `buildRoadGraph` produced them.
   *
   * HANDED IN RATHER THAN RE-COOKED. `lap` is a READING of this geometry
   * (`readLap`), so cooking the road graph again here would give the
   * enclosure measurement a second copy of the path that agrees with the
   * first only as long as nobody changes a seed. `pathCoverage` wants the
   * path itself — it reads the polyline topology and the published
   * `across` column — so the caller passes the same object it read the
   * lap from and the two cannot drift.
   */
  readonly frames: Geometry;
  /**
   * The list to dress, or ABSENT to have the graph decide it.
   *
   * OPTIONAL, AND THE OPTION IS THE POINT OF THE WHOLE PORT. A list handed
   * in is bound with `dataInput`, which makes the graph a picture of ONE
   * lap: the placements are data in it and the placements are the answer,
   * so it cannot be serialized and re-run against another spline. Left out,
   * {@link addLapPlacements} decides them from the path -- stations, D-4's
   * coverage repair, the asset choice, the assembly -- and nothing about
   * the lap is data any more except the spline.
   *
   * THE TWO PRODUCE THE SAME COLUMNS AND NO STAGE BELOW CAN TELL, which is
   * what keeps the comparison suites meaningful: they hand a list in
   * because they measure a rule against its reference on a KNOWN
   * population, and what they measure is this same graph.
   */
  readonly placements?: readonly StationedPlacement[];
  /** The stream `buildBoxes` draws poses from. Must match, or the boxes do not. */
  readonly seed: number;
  /**
   * Asset ids L-1 must DROP rather than push aside.
   *
   * `dressLap` passes L-3's braking mark here and nothing else. Left out,
   * every blocked ruler element is shoved to the verge instead of removed,
   * which satisfies L-1 and breaks L-3 — the two rules disagree about one
   * asset and the tie is broken by naming it, not by weakening either.
   *
   * REQUIRED, NOT OPTIONAL, EVEN THOUGH AN EMPTY SET IS A PERFECTLY GOOD
   * ANSWER. An omitted lock does not fail; it quietly produces a different
   * dressing, and the caller who omitted it has no way to see that it
   * mattered. Writing `new Set()` says the caller considered the exception
   * and has none, which is a different statement from not having thought
   * about it.
   */
  readonly immovable: ReadonlySet<number>;
  /**
   * Asset ids Z-3 may not move: L-2 and L-3's reserved corner vocabulary,
   * and L-4's landmarks.
   *
   * REQUIRED FOR `immovable`'s REASON — an omitted set does not fail, it
   * quietly produces a different mix — and it is a SNAPSHOT, which is the
   * one place this port is not the rule. `dressLap` rebuilds its protect
   * set every round; the graph is handed one set and holds it for every
   * round.
   *
   * MEASURED ACROSS EIGHT SEEDS, THE SNAPSHOT COSTS NOTHING: running the
   * repair body round by round with the set fixed and again with it
   * recomputed each round gives **0 differing placements** on all eight,
   * compared by asset, station, lateral and height. That is the claim
   * worth making, and it replaces two weaker ones that were here and are
   * both wrong.
   *
   * The first was "`mix` is 0 in round two on every seed of six". It is 0
   * on seeds 1-7 and **1 on seed 8**, so the mix does run after round one
   * and the snapshot is not protected by the loop stopping. The second was
   * the reason given for `dressLap` rebuilding at all — "L-4 re-draws
   * landmarks as the loop runs" — and L-4 moves **0 in every round on all
   * eight seeds**, so on this vocabulary the rebuild answers a question
   * nothing asks.
   *
   * WHAT THE SNAPSHOT ACTUALLY RISKS is narrower than either: the set does
   * drift once (seed 2, round 2, one landmark id in and one out), and the
   * mix does target placements after round one (seeds 4 and 8), but the
   * two never coincided. A seed where they did would diverge. Deriving the
   * set in-graph would close that, and was measured and declined — see
   * `PLAN.md`, "Stretch: `mixPinned` derived in-graph".
   */
  readonly mixPinned: ReadonlySet<number>;
  /**
   * The pool Z-3's redraw picks out of — the kit's placeable assets with
   * L-2 and L-3's reserved vocabulary already removed.
   *
   * HANDED IN RATHER THAN DERIVED, for `Dressing.pool`'s reason:
   * `reserveFor` answers a pool of the same LENGTH for every seed and
   * varies only its membership, so deriving it again here would name a
   * different asset at a couple of dozen placements with every index in
   * range and nothing to see it.
   */
  readonly pool: readonly PlaceableAsset[];
  /**
   * L-2 and L-3's reserved vocabulary, when the graph is to place it.
   *
   * FROM THE SAME `reserveFor` CALL AS `pool`, NECESSARILY, and for that
   * field's own reason: the pool is what is LEFT once these three are held
   * back, so a kit and a seed decide both together and splitting them would
   * let a lap dress from a pool that still contains its own corner markers.
   * `cookLapPlacements` says the same thing about its own `markers`.
   *
   * READ ONLY WHEN `placements` IS ABSENT. A caller handing a list in has
   * already placed the corner language into it -- that is what
   * `placeCornerLanguage` did -- so a kit here would place it twice.
   * Absent with no list, the lap comes out with no corner vocabulary,
   * which is what `dressLap` does when `reserveMarkers` cannot find three
   * verticals to hold back.
   */
  readonly markers?: MarkerKit;
  /**
   * D-1's density, scaled. `1` -- the default -- is the fitted rate.
   *
   * READ ONLY WHEN `placements` IS ABSENT, for `markers`' reason: a list
   * handed in was already laid at some density and rescaling it here would
   * mean re-deciding the stations that produced it.
   *
   * IT IS HERE BECAUSE ITS ABSENCE WAS THE ONE THING BLOCKING THE DEMO
   * PAGE FROM OMITTING THE LIST, and the failure would not have looked
   * like a missing feature. The page has a density slider; it reaches the
   * stations through `cookLapPlacements`, which takes this. Without the
   * same door on this side, a page that stopped handing placements in
   * would keep the slider, keep the readout, and silently dress every lap
   * at x1.00 — a control that moves nothing, which is worse than one that
   * is not there.
   *
   * `StationParams` is NOT exposed alongside it even though
   * {@link addLapPlacements} and `cookLapPlacements` both take one. That
   * option has no caller anywhere, so there is nothing to keep at parity
   * yet; add it when something wants it.
   */
  readonly densityScale?: number;
}

/**
 * One entry of the pose library: the boxes of one recorded instance.
 *
 * A POSE IS THE UNIT, NOT AN ASSET, and that is the whole reason this
 * table exists. The kit format stores no rotation, so an asset carries
 * one representative box set and stamping every copy from it faces every
 * object the same way round the lap. Every recorded INSTANCE carries its
 * own correct boxes, though — on the shipped vocabulary 362 instances
 * give 361 distinct sets — so the yaw the format never stored survives in
 * the shapes, and a placement draws one of them. `buildBoxes` says the
 * same thing at greater length; this restates it because `kitIndex` is
 * private to `dress.ts` and the two derivations have to agree. That they
 * do is what the box comparison in the test actually proves.
 *
 * EXPORTED SO DRAWING CAN BE HANDED THE REAL TABLE. `assets3d.ts` merges a
 * pose into one mesh and needs the same box sets the cloud below is built
 * from; it once declared a narrower shape of its own and relied on
 * structural typing to accept this one, which is a copy that agrees until
 * a column moves.
 */
export interface PoseLibrary {
  /** Asset id -> the pose ids recorded for it, in the kit's own order. */
  readonly posesOf: Map<number, number[]>;
  /** Pose id -> its boxes. Index IS the id. */
  readonly boxes: LooseBoxes[];
}

/**
 * A box set as this file READS one, which is looser than `KitBox`.
 *
 * `KitBox` fixes `min`/`max` as three-tuples, and the catalogue entries a
 * kit may carry alongside its instances are typed only as arrays — the
 * same widening `dress.ts` does at its own kit index. Reading through a
 * shape that asks for no more than the three components are indexed by
 * keeps one `as` at the seam instead of one per use.
 */
export type LooseBoxes = readonly {
  readonly min: ArrayLike<number>;
  readonly max: ArrayLike<number>;
  readonly role?: string;
  readonly thickness?: number;
}[];

export function poseLibrary(kit: Kit): PoseLibrary {
  const posesOf = new Map<number, number[]>();
  const boxes: LooseBoxes[] = [];
  const push = (asset: number, set: LooseBoxes): void => {
    const id = boxes.length;
    boxes.push(set);
    const list = posesOf.get(asset) ?? [];
    list.push(id);
    posesOf.set(asset, list);
  };

  // The kit's own instance order, so pose k here is pose k in `kitIndex`.
  // The order is not cosmetic: `buildBoxes` indexes this list by a hash of
  // the station, so a different order draws different poses and every box
  // on the lap moves.
  for (const pl of kit.placements ?? []) {
    if (!pl.boxes?.length) continue;
    push(pl.asset, pl.boxes);
  }

  // The catalogue's own fallbacks, in `buildBoxes`' order of preference:
  // an asset with recorded instances never reaches these, and one without
  // has only these. Registered under ids of their own so that the pose a
  // placement selects is always one lookup into one table.
  //
  // TWO CATALOGUE ENTRIES SHARING AN ID resolve FIRST-wins here and
  // LAST-wins in `dress.ts`'s `assetById`, which is a difference worth
  // naming and not worth removing: a kit whose asset ids are not unique
  // has no defined meaning on either side, and matching the accident
  // would only make the disagreement harder to notice if one ever mattered.
  for (const a of kit.assets as unknown as {
    id: number;
    boxes?: LooseBoxes;
    poses?: LooseBoxes[];
  }[]) {
    if (posesOf.has(a.id)) continue;
    if (a.poses?.length) for (const set of a.poses) push(a.id, set);
    else if (a.boxes?.length) push(a.id, a.boxes);
  }
  return { posesOf, boxes };
}

/**
 * Which pose a placement draws, as `buildBoxes` draws it.
 *
 * -1 WHEN THE VOCABULARY HAS NOTHING FOR THE ASSET, which is a real case
 * rather than an error: `buildBoxes` falls through to an empty box set and
 * the placement contributes no geometry. No source box carries -1, so the
 * copy-and-select below drops every copy of that placement and the two
 * paths produce the same nothing.
 */
function poseFor(lib: PoseLibrary, p: StationedPlacement, seed: number): number {
  const ids = lib.posesOf.get(p.asset.id);
  if (!ids || ids.length === 0) return -1;
  const k = p.pose ?? Math.floor(rand(seed, Math.round(p.station * 97), 0x7053) * ids.length);
  return ids[k % ids.length];
}

/**
 * The asset id of one placement, keyed by the pose its boxes come from.
 *
 * BY POSE AND NOT BY ASSET, because the pose is what decides the shape.
 * One kit asset can be recorded in several poses with different box
 * decompositions, so `kit:42` names a thing that does not have one
 * geometry and an asset map keyed by it would have to pick. The pose id
 * already answers exactly the question a mesh is the answer to.
 *
 * COVER IS ITS OWN VOCABULARY rather than a flag beside the id, which is
 * `spawn.ts`'s argument for `boxAssetId` and holds unchanged one
 * granularity up: a tunnel rib and a verge post can be the same measured
 * boxes and are not the same thing to look at. The two ids may share a
 * geometry -- they do today -- but they are separate keys, so a map that
 * wants to draw structure differently from scenery can, without this
 * having to change.
 *
 * The prefix keeps these out of the namespaces `spawn.ts` owns: its box
 * ids are bare role names and its placement ids are `kit:<id>`.
 */
export function poseAssetId(pose: number, cover: boolean): string {
  return cover ? `cover:pose:${pose}` : `pose:${pose}`;
}

/** One box of one pose, as everything downstream of the kit wants it. */
export interface PoseBoxW {
  /** The box's midpoint in the kit's track frame, in half-widths. */
  readonly centre: readonly [number, number, number];
  /** Its span in the same units, floored — see {@link MIN_EXTENT_WORLD}. */
  readonly extent: readonly [number, number, number];
}

/**
 * A pose library rewritten as centres and extents — the ONE derivation.
 *
 * THE KIT STORES CORNERS AND NOTHING DRAWS CORNERS. A point cloud wants a
 * position and a scale, a merged mesh wants an offset and a scale, and both
 * want the same floor applied at the same moment; written out twice, the
 * two agree until one of them is edited, and the failure that follows is a
 * merged pose whose sheets sit at a different thickness from the same pose
 * drawn box by box — wrong in a way that reads as noise rather than as a
 * bug. So the conversion happens exactly here and the two callers differ
 * only in what they build out of the answer.
 *
 * INDEXED BY POSE ID, because that is how `PoseLibrary.boxes` is indexed
 * and the id is what a placement carries. A pose with no boxes keeps its
 * empty entry rather than being skipped: a caller keyed by id has to be
 * able to ask about every id the library admits.
 *
 * IN HALF-WIDTHS, which is what makes this a library rather than a fitting:
 * the track's scale arrives downstream on the instance transform, so one
 * conversion dresses a lap of any width. The floor is the exception and has
 * to be divided back out, because `buildBoxes` states it on the WORLD
 * extent — it clamps AFTER multiplying by W, so dividing here lands on the
 * same number once W is multiplied back in, to within the f32 spacing of it.
 */
export function poseBoxesW(lib: PoseLibrary, halfWidth: number): readonly (readonly PoseBoxW[])[] {
  const minExtentW = MIN_EXTENT_WORLD / halfWidth;
  return lib.boxes.map((set) =>
    set.map((b) => ({
      centre: [
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      ] as const,
      extent: [
        Math.max(b.max[0] - b.min[0], minExtentW),
        Math.max(b.max[1] - b.min[1], minExtentW),
        Math.max(b.max[2] - b.min[2], minExtentW),
      ] as const,
    })),
  );
}

/**
 * The pose library as a point cloud — the SOURCE of the copy.
 *
 * Each point is one box of one pose, positioned at that box's centre and
 * scaled to its extents. Both numbers come from {@link poseBoxesW} rather
 * than from the kit corners directly, so the cloud the rules measure and
 * the mesh a placement draws are the same arithmetic and not two readings
 * of it.
 */
function poseCloud(lib: PoseLibrary, halfWidth: number): Geometry {
  const boxesW = poseBoxesW(lib, halfWidth);
  let n = 0;
  for (const set of boxesW) n += set.length;
  const geo = createPointCloud(n);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const scale = pts.require("scale");
  const pose = pts.add(BOX.pose, "f32", 1);

  let i = 0;
  for (let id = 0; id < boxesW.length; id++) {
    for (const b of boxesW[id]) {
      P.setTuple(i, b.centre);
      scale.setTuple(i, b.extent);
      pose.set(i, id);
      i++;
    }
  }
  return geo;
}

/**
 * The placement list as a point cloud — the TARGET of the copy.
 *
 * TRACK COORDINATES AND NOTHING ELSE, which is the whole claim this cloud
 * makes. `stationW`, `trackT` and `trackH` locate a placement on any lap
 * of the right shape; the four frame columns that used to sit beside them
 * located it on ONE, and were a TypeScript lookup per placement run when
 * the graph was BUILT rather than when it was cooked. {@link
 * sampleTrackFrame} is that lookup now, as a stage, so this function no
 * longer takes a `Lap` at all — the sizes it does write are the kit's own
 * half-width-relative extents, which need no lap to state.
 *
 * WHAT THAT BUYS IS THE DIFFERENCE BETWEEN A LIST AND A PICTURE OF ONE. A
 * cloud carrying a frame is an answer about the lap it was built against;
 * a cloud carrying stations is the question, and the graph resolves it
 * against whatever path it is handed. Only the second survives being
 * written to a file.
 */
function placementCloudInTrackCoords(
  placements: readonly StationedPlacement[],
  lib: PoseLibrary,
  seed: number,
  immovable: ReadonlySet<number>,
  mixPinnedIds: ReadonlySet<number>,
): Geometry {
  const geo = createPointCloud(placements.length);
  const pts = geo.attrs.point;
  const t = pts.add(PLACEMENT.t, "f32", 1);
  const h = pts.add(PLACEMENT.h, "f32", 1);
  const sizeAcross = pts.add(PLACEMENT.sizeAcross, "f32", 1);
  const sizeAlong = pts.add(PLACEMENT.sizeAlong, "f32", 1);
  const sizeTall = pts.add(PLACEMENT.sizeTall, "f32", 1);
  const cover = pts.add(PLACEMENT.cover, "f32", 1);
  const pose = pts.add(PLACEMENT.pose, "f32", 1);
  const station = pts.add(PLACEMENT.station, "f32", 1);
  const id = pts.add(PLACEMENT.id, "f32", 1);
  const locked = pts.add(PLACEMENT.locked, "f32", 1);
  const mixPinned = pts.add(PLACEMENT.mixPinned, "f32", 1);
  const poseU = pts.add(PLACEMENT.poseU, "f32", 1);
  // Created here rather than by the stage that sets it: the quota reads
  // it in round one, BEFORE the redraw has run even once.
  pts.add(PLACEMENT.mixTried, "f32", 1);
  // AND THIS ONE SO THAT THE MERGE DOES NOT INVENT A RUN. An ordinary
  // placement belongs to no enclosure run, and a column filled by
  // `mergePoints`' default would say it belongs to the one starting at
  // station zero. -1 is the same "no such thing" this file uses for a
  // pose the kit never recorded.
  const noRun = pts.add(PLACEMENT.coverRun, "f32", 1);
  const asset = pts.add(PLACEMENT.asset, "string", 1);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    t.set(i, p.t);
    h.set(i, p.h);
    sizeAcross.set(i, p.asset.size.across);
    sizeAlong.set(i, p.asset.size.along);
    sizeTall.set(i, p.asset.size.tall);
    const isCover = p.cover === true;
    cover.set(i, isCover ? 1 : 0);
    const posed = poseFor(lib, p, seed);
    pose.set(i, posed);
    // Written from the SAME draw the pose column takes, not from a second
    // call: `poseFor` is seeded, and asking it twice for one placement is
    // two chances to disagree about which mesh this is.
    asset.setString(i, poseAssetId(posed, isCover));
    station.set(i, p.station);
    // EXACT IN f32 AND ONLY WHILE THE LIST IS SHORT, which is a real
    // ceiling rather than a formality: every integer below 2^24 is exact,
    // so this reads back as itself for any list under 16.7 million. A lap
    // carries a few hundred.
    id.set(i, i);
    noRun.set(i, -1);
    locked.set(i, immovable.has(p.asset.id) ? 1 : 0);
    mixPinned.set(i, mixPinnedIds.has(p.asset.id) ? 1 : 0);
    // `poseFor`'s own draw, taken here so the graph can spend it on a
    // different asset's pose list. Same expression, one place.
    poseU.set(i, rand(seed, Math.round(p.station * 97), 0x7053));
  }
  return geo;
}


/**
 * The per-asset columns {@link addPlacementAssembly} gathers by `ASSET.ord`.
 *
 * ITS OWN TABLE AND NOT `mixAssetCloud`'s, WHICH IT USED TO BE. The two
 * answer different questions and the corner language is what made the
 * difference matter. `mixAssetCloud` is the pool Z-3's redraw DRAWS FROM,
 * so it holds exactly the pool and nothing else -- a marker in it would be
 * a marker the mix could scatter round the lap, which is the one thing
 * `reserveFor` exists to prevent. This is the table a placement is LOOKED
 * UP IN, and L-2's markers and L-3's ruler element have to be in it,
 * because a converted placement carries a marker and still needs its
 * extents and its poses.
 *
 * SO THE ORD SPACE IS WIDER THAN THE POOL, and {@link placementAssetRows}
 * is the one definition of it: the pool in its own order, then sharp, open
 * and brake. Every consumer -- this table, the flat pose table, and the
 * arithmetic that turns a `PLACED.row` into an ord -- derives from that one
 * list rather than restating the layout.
 */
export const PLACEMENT_ASSET = {
  across: "paAcross",
  along: "paAlong",
  tall: "paTall",
  /** Where this asset's poses start in the flat table, and how many. */
  poseOff: "paPoseOff",
  poseCount: "paPoseCount",
  /** 1 where L-1 must DROP this asset rather than push it. */
  locked: "paLocked",
  /** 1 where Z-3 may not move it. */
  pinned: "paPinned",
} as const;

/** The flat pose table {@link PLACEMENT_ASSET.poseOff} indexes into. */
const PLACEMENT_POSE = { id: "paPoseId" } as const;

/**
 * The assets a placement can name, in ord order: the pool, then the three
 * reserved markers.
 *
 * ONE DEFINITION OF THE LAYOUT, called by everything that depends on it.
 * The pool comes first and keeps its own indices, so a choice's
 * `ASSET.ord` -- which indexes `assetCloud(pool)` -- means the same thing
 * here without translation. That is the property worth having: the asset
 * choice never learns that the table it picks from is a prefix of a longer
 * one.
 */
export function placementAssetRows(
  pool: readonly PlaceableAsset[],
  markers: MarkerKit | undefined,
): readonly PlaceableAsset[] {
  return markers === undefined ? pool : [...pool, markers.sharp, markers.open, markers.brake];
}

/** The lookup table itself. */
export function placementAssetCloud(
  rows: readonly PlaceableAsset[],
  lib: PoseLibrary,
  immovable: ReadonlySet<number>,
  mixPinned: ReadonlySet<number>,
): Geometry {
  const geo = createPointCloud(Math.max(1, rows.length));
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const across = pts.add(PLACEMENT_ASSET.across, "f32", 1);
  const along = pts.add(PLACEMENT_ASSET.along, "f32", 1);
  const tall = pts.add(PLACEMENT_ASSET.tall, "f32", 1);
  const poseOff = pts.add(PLACEMENT_ASSET.poseOff, "f32", 1);
  const poseCount = pts.add(PLACEMENT_ASSET.poseCount, "f32", 1);
  const locked = pts.add(PLACEMENT_ASSET.locked, "f32", 1);
  const pinned = pts.add(PLACEMENT_ASSET.pinned, "f32", 1);

  let flat = 0;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] as PlaceableAsset;
    // DISTINCT POSITIONS, for `mixAssetCloud`'s reason: a cloud whose
    // points cannot be told apart answers one number for all of them to
    // anything that keys on identity.
    P.setTuple(i, [i, 0, 0]);
    across.set(i, a.size.across);
    along.set(i, a.size.along);
    tall.set(i, a.size.tall);
    const poses = lib.posesOf.get(a.id) ?? [];
    poseOff.set(i, flat);
    poseCount.set(i, poses.length);
    flat += poses.length;
    locked.set(i, immovable.has(a.id) ? 1 : 0);
    pinned.set(i, mixPinned.has(a.id) ? 1 : 0);
  }
  return geo;
}

/** The flat pose table, over the same rows and in the same order. */
export function placementPoseCloud(
  rows: readonly PlaceableAsset[],
  lib: PoseLibrary,
): Geometry {
  const ids: number[] = [];
  for (const a of rows) for (const id of lib.posesOf.get(a.id) ?? []) ids.push(id);
  // A ROW EVEN WHEN THERE ARE NO POSES, for `mixPoseCloud`'s reason: over
  // an EMPTY source `transferByIndex` misses every point under all three
  // settings, and a miss leaves whatever the column held before.
  const geo = createPointCloud(Math.max(1, ids.length));
  const P = geo.attrs.point.require("P");
  const col = geo.attrs.point.add(PLACEMENT_POSE.id, "f32", 1);
  for (let i = 0; i < geo.attrs.point.count; i++) {
    P.setTuple(i, [i, 0, 0]);
    col.set(i, ids.length === 0 ? -1 : (ids[i] as number));
  }
  return geo;
}

/**
 * The placement list, BUILT IN THE GRAPH rather than handed to it.
 *
 * THIS IS WHAT {@link placementCloudInTrackCoords} DOES, WITH NOTHING IN
 * TYPESCRIPT. That function turns a `StationedPlacement[]` into a cloud,
 * and every column it writes is a lookup a caller has already done: the
 * asset's extents, the pose, the two set memberships, the draw. So a graph
 * built around it cannot be serialized and re-run against another spline —
 * the list is DATA in it, and the list is the answer.
 *
 * The choice stage already decides all of it. `addAssetChoiceStage` leaves
 * one point per station that drew an asset, carrying the asset's own row
 * and Z-1's resolved lateral and height; what is missing is only the
 * plumbing — the station value the copy did not carry, the two columns the
 * asset table holds and the choice never needed, and the pose. Each is one
 * gather.
 *
 * THE POSE RE-BASES AND THAT IS THE ONE THING THIS CANNOT TRANSCRIBE.
 * `poseFor` draws from {@link rand}, a 32-bit integer hash of the seed, a
 * rounded station and a salt, and the field vocabulary has no integer
 * arithmetic to state it in. `randomFrom` is the library's answer to the
 * same question — a draw keyed on a VALUE rather than on an element's
 * position, so it survives the list being reordered — and this keys it on
 * the station for the reason the reference did: the pose is a fact about
 * what stands at a place, so two cooks of the same lap must agree about it
 * however the list is ordered. The stream differs, so the POSES differ;
 * `addAssetChoiceStage` re-based all four of its own uniforms on the same
 * argument and its suite says what survives that — the distributional and
 * structural claims, which are the ones a golden file would not have
 * caught either.
 *
 * WHAT IT DOES TRANSCRIBE EXACTLY is the modulo. `poseFor` answers
 * `ids[floor(u * n) % n]`, and the `% n` is not redundant: `u` is closed at
 * the top, so a draw of exactly 1 indexes one past the end. Written out
 * here for the reason `writeCoverPlacements` writes out its own — a bias
 * that belongs to the reference is kept, and one introduced by the port is
 * not.
 *
 * AND ONE BRANCH OF `poseFor` IS DELIBERATELY ABSENT. It takes a placement's
 * OWN `pose` when it has one (`p.pose ?? …`) and draws only otherwise; there
 * is no such column here, because at this point in the lap nothing has set
 * one. L-6's cover is the only thing that does, and it runs after this and
 * writes its pieces' poses itself in {@link writeCoverPlacements}. So the
 * branch is unreachable rather than dropped — but it is a branch of the
 * function this claims to state, so it is named rather than left for a
 * reader to notice missing.
 *
 * THE ORDER IS THE SCATTER'S, NOT THE STATION'S, and that is deliberate
 * rather than tolerated. `pointScatterOnPath` lays stations down in an
 * order that has nothing to do with arc position — measured at 165
 * descents in 329 points — and `cookLapPlacements` sorts its rows in
 * TypeScript afterwards, which is exactly the kind of step this function
 * exists to delete. Nothing downstream needs the permutation: every stage
 * that cares about arc order says so in its own parameters, `pointsToPath`
 * through `orderAttr` and `quotaRebalance` through its priority. That the
 * whole graph is order-free is a MEASUREMENT, not a reading — see "dresses
 * a shuffled list into the same lap" in `tests/racetrackDressGraph.test.ts`,
 * which fails on both of those parameters when either is taken away.
 */
export function addPlacementAssembly(
  g: Graph,
  chosen: { readonly node: NodeHandle; readonly pin: string },
  opts: {
    /** {@link mixPoseIds}, the two-half table the string column indexes. */
    readonly poseIds: readonly string[];
  },
  tag: string,
): {
  readonly out: NodeHandle;
  /** The asset-table gather, whose `source` pin the caller wires. */
  readonly assets: NodeHandle;
  /** The pose-table gather, likewise. */
  readonly poses: NodeHandle;
} {
  // 1. THE STATION, BACK OFF THE CLOUD THE COPIES WERE LAID OVER.
  //    `copyToPoints` composes each copy from the SOURCE's columns and
  //    writes only the target's INDEX, so a copy knows which station it
  //    belongs to and not where that station is. `cookLapPlacements` reads
  //    the arc column off the station cloud and pairs the two lists in
  //    TypeScript for the same reason; this is that pairing as a gather.

  // A RENAME ONLY IF THE NAMES DIFFER. `addStationStage` defaults its arc
  // column to the same `stationW` this file calls `PLACEMENT.station`, so
  // the two agree by construction on every caller today — but the stage
  // takes the name as a param, and a graph that silently dropped the
  // column when a caller renamed it would be wrong in a way no type
  // catches.
  const head: NodeHandle = chosen.node;
  const headPin = chosen.pin;

  // 2. THE ASSET'S OWN ROW — the three facts a choice never needed.
  //    `assetCloud` carries `across` and `tall` because Z-1 resolves the
  //    corridor by them, and the copy has therefore already brought those
  //    two along. The along-track extent and the two set memberships ride
  //    {@link mixAssetCloud}, which is in this graph already for the
  //    redraw, so this is a gather rather than a fourth table.
  const assets = g.add(
    transferByIndex,
    {
      index: attribute(ASSET.ord),
      // THE EXTENTS ARE GATHERED TOO, WHICH THEY DID NOT USED TO BE. They
      // rode the copy for a chosen row, because `assetCloud` carries them
      // and `copyToPoints` composes a copy from the source's columns. A
      // marker row is not a copy of anything -- the corner language emits a
      // station, a lateral and a height, and nothing else -- so the only
      // way both kinds of row can go through one stage is for the stage to
      // look everything up. A row now needs an ord and its own three
      // decided numbers, and nothing else.
      attributes: [
        PLACEMENT_ASSET.across,
        PLACEMENT_ASSET.along,
        PLACEMENT_ASSET.tall,
        PLACEMENT_ASSET.poseOff,
        PLACEMENT_ASSET.poseCount,
        PLACEMENT_ASSET.locked,
        PLACEMENT_ASSET.pinned,
      ],
      outOfRange: "clamp",
    },
    `${tag}Asset`,
  );
  g.connect(head, headPin, assets, "in");

  // 3. THE POSE. The draw, then the asset's own pose list indexed by it —
  //    `writeCoverPlacements` states the same three nodes and its comments
  //    carry the argument for each.
  const drawn = g.add(
    setAttribute,
    {
      name: PLACEMENT.poseU,
      tupleSize: 1,
      value: randomFrom(attribute(PLACEMENT.station), `${tag}.pose`),
    },
    `${tag}PoseU`,
  );
  g.connect(assets, "out", drawn, "in");

  // ROW 0 WHEN THE KIT RECORDED NO POSE, AND THE ANSWER IS FIXED AFTER THE
  // GATHER RATHER THAN BEFORE IT. Sending -1 would rely on how
  // `transferByIndex` treats a negative index under `clamp`, which is a
  // question this file does not need to ask: gather row 0, then throw the
  // value away with a `select` on the count. What must NOT happen is the
  // placement quietly taking row 0's pose — a real pose id belonging to
  // whichever asset the flat table starts with.
  const row = g.add(
    setAttribute,
    {
      name: SCRATCH_POSE,
      tupleSize: 1,
      value: add(
        attribute(PLACEMENT_ASSET.poseOff),
        mod(
          floor(mul(attribute(PLACEMENT.poseU), attribute(PLACEMENT_ASSET.poseCount))),
          max(1, attribute(PLACEMENT_ASSET.poseCount)),
        ),
      ),
    },
    `${tag}PoseRow`,
  );
  g.connect(drawn, "out", row, "in");

  const poses = g.add(
    transferByIndex,
    { index: attribute(SCRATCH_POSE), attributes: [PLACEMENT_POSE.id], outOfRange: "clamp" },
    `${tag}Pose`,
  );
  g.connect(row, "out", poses, "in");

  // 4. THE COLUMNS. Every one of them is what `placementCloudInTrackCoords`
  //    writes, in the same order and for the same stated reasons.
  let out: NodeHandle = poses;
  const writes: [string, Field | number][] = [
    // -1 IS A REAL ANSWER AND NOT AN ERROR. `poseFor` returns it for an
    // asset the vocabulary has nothing for, `buildBoxes` falls through to
    // an empty box set, and the copy-and-select downstream drops every box
    // of that placement. So the two paths produce the same nothing.
    [PLACEMENT.pose, select(le(attribute(PLACEMENT_ASSET.poseCount), 0), -1, attribute(PLACEMENT_POSE.id))],
    [PLACEMENT.t, attribute(CHOICE.t)],
    [PLACEMENT.h, attribute(CHOICE.h)],
    [PLACEMENT.sizeAcross, attribute(PLACEMENT_ASSET.across)],
    [PLACEMENT.sizeAlong, attribute(PLACEMENT_ASSET.along)],
    [PLACEMENT.sizeTall, attribute(PLACEMENT_ASSET.tall)],
    // ORDINARY DRESSING IS NEVER COVER. L-6 is the only thing that builds
    // cover, it runs after this, and it writes its pieces' flag itself.
    [PLACEMENT.cover, 0],
    [PLACEMENT.locked, attribute(PLACEMENT_ASSET.locked)],
    [PLACEMENT.mixPinned, attribute(PLACEMENT_ASSET.pinned)],
    // BEFORE THE REDRAW HAS RUN EVEN ONCE, which is when the quota first
    // reads it — the same reason the TypeScript cloud creates this column
    // rather than leaving it to the stage that sets it.
    [PLACEMENT.mixTried, 0],
    // AND -1 SO THE MERGE DOES NOT INVENT A RUN. An ordinary placement
    // belongs to no enclosure run, and a column filled by `mergePoints`'
    // default would say it belongs to the one starting at station zero.
    [PLACEMENT.coverRun, -1],
    // `PLACEMENT.id` IS NOT WRITTEN HERE, AND IT USED TO BE. It is "where
    // this placement sits in the list", and this stage does not build the
    // list -- it builds one KIND of row. A lap with a corner language runs
    // it twice, once over the chosen rows and once over L-2's and L-3's,
    // and `index()` on each would number both from zero and give every
    // marker the id of an ordinary placement. {@link addLapPlacements}
    // writes the column once, over the merged cloud, which is the first
    // moment the list exists.
  ];
  for (const [name, value] of writes) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}W_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }

  // 5. THE CHOICE'S SCRATCH, GONE -- AND BEFORE THE ID STRING, NOT AFTER.
  //
  //    `ASSET.id` AND `PLACEMENT.asset` ARE THE SAME STRING, "assetId",
  //    and they are two different facts: the kit's own numeric id for the
  //    asset, which the choice carries, and the POSE name a spawner keys
  //    its batches by, which a placement carries. Nothing had ever put
  //    both on one cloud before this stage, so nothing had ever had to
  //    notice. Stripping after the string write deletes the string; the
  //    strip therefore runs first, and the write below lands on a free
  //    name. The first draft had it the other way round and the cloud came
  //    out with no `assetId` at all -- which fails loudly at the first
  //    reader, but only because a spawner requires the column.
  //
  //    WHAT ELSE GOES AND WHY. A placement is a track coordinate and a
  //    thing to draw; the four uniforms, the bracket and the weights are
  //    HOW it was decided, and carrying them would put the pick's working
  //    next to the answer for the rest of the cook. `strict: false` for
  //    `writeCoverPlacements`' reason -- the list is long and a rename
  //    upstream should not take a cook down over a strip.
  const cleaned = g.add(
    removeAttribute,
    {
      names: [
        SCRATCH_POSE,
        PLACEMENT_ASSET.across,
        PLACEMENT_ASSET.along,
        PLACEMENT_ASSET.tall,
        PLACEMENT_ASSET.poseOff,
        PLACEMENT_ASSET.poseCount,
        PLACEMENT_ASSET.locked,
        PLACEMENT_ASSET.pinned,
        PLACEMENT_POSE.id,
        PLACED.stationW,
        PLACED.t,
        PLACED.h,
        PLACED.row,
        PLACED.corner,
        CHOICE.curveK,
        CHOICE.uPick,
        CHOICE.uLat,
        CHOICE.uHgt,
        CHOICE.uSide,
        CHOICE.stationIdx,
        CHOICE.weight,
        CHOICE.cumBelow,
        CHOICE.cumThrough,
        CHOICE.weightTotal,
        CHOICE.draw,
        CHOICE.t,
        CHOICE.h,
        ASSET.ord,
        ASSET.id,
        ASSET.instances,
        ASSET.affStraight,
        ASSET.affEasy,
        ASSET.affMedium,
        ASSET.affTight,
        ASSET.latP10,
        ASSET.latMed,
        ASSET.latP90,
        ASSET.hgtP10,
        ASSET.hgtMed,
        ASSET.hgtP90,
        ASSET.right,
        ASSET.across,
        ASSET.tall,
      ],
      strict: false,
    },
    `${tag}Strip`,
  );
  g.connect(out, "out", cleaned, "in");

  // 6. THE ASSET ID STRING, off the PLAIN half of the table. `poseAssetId`
  //    keys by pose and not by asset, and {@link mixPoseIds} lays the two
  //    vocabularies out as one list with -1 leading each half -- so the
  //    index is `pose + 1` with no branch, and cover's half is the same
  //    expression plus the offset {@link writeCoverPlacements} adds.
  const named = g.add(
    setAttribute,
    {
      name: PLACEMENT.asset,
      tupleSize: 1,
      type: "string",
      values: opts.poseIds as string[],
      value: add(attribute(PLACEMENT.pose), 1),
    },
    `${tag}AssetId`,
  );
  g.connect(cleaned, "out", named, "in");

  return { out: named, assets, poses };
}


/**
 * L-2's markers and L-3's ruler marks, as rows {@link addPlacementAssembly}
 * can take.
 *
 * WHAT THE CORNER LANGUAGE DECIDES IS FOUR NUMBERS PER MARK -- a station,
 * a lateral, a height and which of the three reserved assets it is -- and
 * what the assembly wants is an ord and those same three decided numbers.
 * So this is a rename and one piece of arithmetic, and the arithmetic is
 * `PLACED.row` into the ord space {@link placementAssetRows} lays out.
 *
 * THE TWO CLOUDS MERGE FIRST AND ARE ASSEMBLED ONCE. They carry the same
 * five columns -- `addRulerStage` pins its own row to 2, which is `brake`
 * in both `markerCloud`'s order and `placementAssetRows`' tail -- so there
 * is nothing to tell them apart by the time the assembly sees them, and
 * nothing that needs to. A marker and a ruler mark are both a reserved
 * asset standing at a station.
 *
 * THE ORDER IS L-2 THEN L-3, which is `placeCornerLanguage`'s and is worth
 * keeping even though nothing downstream reads row order: it is the order
 * the reference builds the list in, so a comparison that ever wants to be
 * positional can be.
 */
function addCornerLanguageRows(
  g: Graph,
  language: { readonly markers: NodeHandle; readonly rulers: NodeHandle },
  ordBase: number,
  tag: string,
): NodeHandle {
  const merged = g.add(mergePoints, {}, `${tag}Merge`);
  g.connect(language.markers, "out", merged, "in");
  g.connect(language.rulers, "out", merged, "in");

  let out: NodeHandle = merged;
  const writes: [string, Field][] = [
    // THE ORD, AND THIS IS THE JOIN. `PLACED.row` is 0, 1 or 2 for sharp,
    // open and brake; the reserved three sit at the end of the ord space,
    // in that order, because `placementAssetRows` puts them there. One
    // addition, and a marker is an asset like any other.
    [ASSET.ord, add(ordBase, attribute(PLACED.row))],
    [CHOICE.t, attribute(PLACED.t)],
    [CHOICE.h, attribute(PLACED.h)],
    // NO GATHER FOR THIS ONE, which is why the assembly's station lookup
    // is optional. The corner language measured back from a corner's entry
    // and wrapped into the lap; there is no station cloud these are copies
    // of, and asking for one would mean inventing an index.
    [PLACEMENT.station, attribute(PLACED.stationW)],
  ];
  for (const [name, value] of writes) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}W_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }

  // THE CORNER STAGES' WORKING, DROPPED HERE AND NOT LEFT TO THE MERGE.
  // Resolving a corner model onto the frames and carrying a marker row onto
  // each corner leaves eighteen columns of it, and they all rode into the
  // placement list -- 22 columns onto every placement, through the whole
  // repair loop, with the chosen rows getting 0 for each from the merge's
  // default. Nothing downstream reads a name like `cornerEntryW`, so it was
  // inert; `arcW` is live scratch in three modules and was one rename from
  // meaning two things on one cloud.
  //
  // STRIPPED BEFORE THE ASSEMBLY, so that the two assemblies really do
  // produce identical column sets -- which is the property the merge below
  // rests on, and which was stated here before it was true.
  const cleaned = g.add(
    removeAttribute,
    { names: [...CORNER_LANGUAGE_SCRATCH, ...CORNER_BOOKKEEPING_SCRATCH], strict: false },
    `${tag}Strip`,
  );
  g.connect(out, "out", cleaned, "in");
  return cleaned;
}


/**
 * L-2's convert-or-add and L-3's displacement, APPLIED.
 *
 * `addCornerBookkeeping` decides two columns -- which corner claimed each
 * placement and which tight corner's ruler displaced it -- and changes
 * nothing else. This is the other half: the claimed placements become
 * markers, the displaced ones go, and the corners nobody claimed are the
 * ones whose marker has to be ADDED. `placeCornerLanguage` does all three
 * in one walk over a mutable array; they are three stages here.
 *
 * IT RUNS BEFORE THE ASSEMBLY, WHICH IS WHY THE CONVERSION IS CHEAP. A
 * conversion changes which ASSET a placement holds, and everything that
 * follows from an asset -- the extents, the pose, the id string, the two
 * flags -- is what {@link addPlacementAssembly} looks up. Applying the
 * conversion to the ord BEFORE that lookup means the lookup happens once
 * and is right; applying it after would mean doing the whole lookup a
 * second time for a few dozen rows.
 *
 * THE TWO ORD SPELLINGS MEET HERE, AND ONLY HERE. `VICTIM.assetOrd` says a
 * marker is `-1 - row`, which is `addConvertStage`'s own convention and
 * predates the placement ord space; `placementAssetRows` says a marker is
 * `poolLength + row`. Both are reasonable and they are not the same number,
 * so the translation is one expression in one place rather than a
 * convention change rippling through the file that owns the loops.
 *
 * AND THE CONVERSION IS ALREADY COMPUTED when this runs.
 * `addConvertStage` rewrites `VICTIM.assetOrd` to the marker's ordinal
 * INSIDE the loop -- it has to, because the next corner's histogram must
 * count the marker rather than the asset it replaced -- so what is left
 * here is reading it, not deciding it.
 */
function addCornerBookkeepingApplied(
  g: Graph,
  cloud: { readonly node: NodeHandle; readonly pin: string },
  markerRows: NodeHandle,
  corners: readonly Corner[],
  opts: { readonly lapW: number; readonly ordBase: number },
  tag: string,
): { readonly kept: NodeHandle; readonly unclaimed: NodeHandle } {
  // ---- 1. THE COLUMNS THE LOOPS READ ------------------------------------
  //
  // EVERY ORD IS A POOL ORD AT THIS POINT, which is what makes the straight
  // copy honest: the corner language has not been merged in yet, so there
  // is no marker on this cloud for `addVictimSearch`'s `ge(assetOrd, 0)`
  // guard to exclude. That guard stops a LATER corner re-converting what an
  // earlier one took, and it earns its keep once the loop starts writing
  // marker ordinals.
  let head: NodeHandle = cloud.node;
  let headPin = cloud.pin;
  const init: [string, Field | number][] = [
    [VICTIM.assetOrd, attribute(ASSET.ord)],
    [VICTIM.stationW, attribute(PLACEMENT.station)],
    [VICTIM.t, attribute(CHOICE.t)],
    [VICTIM.claimedBy, -1],
    [VICTIM.displacedBy, -1],
  ];
  for (const [name, value] of init) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}V_${name}`);
    g.connect(head, headPin, n, "in");
    head = n;
    headPin = "out";
  }

  // ---- 2. THE TWO LOOPS --------------------------------------------------
  const booked = addCornerBookkeeping(g, { node: head, pin: headPin }, corners, opts.lapW, tag);

  // ---- 3. THE MARKER EACH CLAIMED PLACEMENT BECOMES ----------------------
  //
  // Its lateral and height come from the corner language's own draw for
  // THAT corner, which is what `placeCornerLanguage` uses too -- the
  // conversion keeps the placement's STATION and takes everything else from
  // the marker. `clamp` never fires: an unclaimed row indexes -1 and the
  // select below throws the gathered values away, so the only thing a
  // clamped row-zero read costs is a column nobody reads.
  const drawn = g.add(
    transferByIndex,
    {
      index: max(0, attribute(VICTIM.claimedBy)),
      attributes: [PLACED.t, PLACED.h],
      outOfRange: "clamp",
    },
    `${tag}Drawn`,
  );
  g.connect(booked.node, booked.pin, drawn, "in");
  g.connect(markerRows, "out", drawn, "source");

  const claimed = ge(attribute(VICTIM.claimedBy), 0);
  let out: NodeHandle = drawn;
  const applied: [string, Field][] = [
    // THE TRANSLATION BETWEEN THE TWO ORD SPELLINGS. `-1 - row` back to
    // `row`, then into the placement ord space.
    [
      ASSET.ord,
      select(
        claimed,
        add(opts.ordBase, sub(-1, attribute(VICTIM.assetOrd))),
        attribute(ASSET.ord),
      ),
    ],
    [CHOICE.t, select(claimed, attribute(PLACED.t), attribute(CHOICE.t))],
    [CHOICE.h, select(claimed, attribute(PLACED.h), attribute(CHOICE.h))],
  ];
  for (const [name, value] of applied) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}A_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }

  // ---- 4. WHAT THE RULERS PAID WITH, REMOVED -----------------------------
  //
  // ONE REMOVAL, AFTER BOTH LOOPS, which is the whole reason the loops mark
  // rather than delete: every index the bookkeeping hands back names the
  // list AS IT ARRIVED, so a removal partway through would renumber the
  // rows a later corner's answer refers to. `placeCornerLanguage` says the
  // same thing at greater length about its own `displaced` set.
  const kept = g.add(
    filterByExpression,
    { predicate: lt(attribute(VICTIM.displacedBy), 0) },
    `${tag}Drop`,
  );
  g.connect(out, "out", kept, "in");

  // ---- 5. WHICH CORNERS NOBODY CLAIMED -----------------------------------
  //
  // THE INVERSE OF A GATHER, and that is what makes it the awkward one. The
  // cloud that KNOWS which corners were claimed is the placements; the
  // cloud that needs to know is the corners. `transferByIndex` runs the
  // other way and there is no scatter.
  //
  // SO THE ANSWER IS LAID OUT AS GEOMETRY AND ASKED FOR BY PROXIMITY --
  // the same move `PLAN.md`'s station ring makes, and for the same reason.
  // Put every placement at `x = claimedBy` and every corner at `x = its own
  // index`, and carry `claimedBy` across with a nearest-point transfer: a
  // claimed corner has a point sitting exactly on it, so it reads back its
  // own index, and an unclaimed one reads back somebody else's.
  //
  // THE GUARD FALLS OUT RATHER THAN BEING ADDED. An unclaimed placement
  // holds -1 and sits at `x = -1`, which is a whole unit from corner 0 and
  // further from the rest -- so it can never be the exact hit, and it never
  // needs filtering out. A lap where nothing was claimed puts every
  // placement at -1 and every corner reads back -1, which equals no corner
  // index. Ties do not matter either: only an exact hit passes the test,
  // and a claimed corner always has one at distance zero.
  // A LAP WITH NOTHING LEFT TO ASK ABOUT would take the cook down here with
  // `transferNearest: source has no points`, which names neither this demo
  // nor the fix. It needs L-3 to displace every surviving placement -- a
  // lap short enough that its tight corners' braking windows cover the
  // whole circuit -- and no lap this demo generates comes near it. Left
  // unguarded and named rather than wrapped, because a guard for an
  // unreachable case is a branch nothing can ever test.
  const asClaims = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: vec(attribute(VICTIM.claimedBy), 0, 0) },
    `${tag}ClaimP`,
  );
  g.connect(kept, "out", asClaims, "in");

  const asCorners = g.add(
    setAttribute,
    { name: "P", tupleSize: 3, value: vec(attribute(PLACED.corner), 0, 0) },
    `${tag}CornerP`,
  );
  g.connect(markerRows, "out", asCorners, "in");

  const asked = g.add(
    transferAttribute,
    { name: VICTIM.claimedBy, mapping: "nearest" },
    `${tag}Ask`,
  );
  g.connect(asCorners, "out", asked, "in");
  g.connect(asClaims, "out", asked, "source");

  // AND THE ANSWER CARRIED BACK ONTO THE ROWS THAT STILL HAVE THEIR OWN `P`.
  //
  // BOTH CLOUDS ABOVE HAD TO HAVE THEIR POSITIONS CLOBBERED for the
  // proximity question to mean anything, and `asCorners` is the marker rows
  // with a corner ORDINAL where their frame position was. Filtering that
  // cloud directly would publish the ordinal: measured, 10 of seed 1's 341
  // placements -- exactly the added markers -- came out with `P` = [corner,
  // 0, 0]. Inert, because `sampleTrackFrame` overwrites `P` from the
  // station before anything reads it, and that is precisely why it would
  // have gone unnoticed.
  //
  // `transferByIndex` ON `index()` IS THE WAY BACK. A `setAttribute` and a
  // nearest transfer both preserve row order and row count, so row i of
  // `asked` is row i of the marker cloud -- the clobbered pair is scratch
  // that never leaves this function.
  const answered = g.add(
    transferByIndex,
    { index: index(), attributes: [VICTIM.claimedBy], outOfRange: "clamp" },
    `${tag}Answer`,
  );
  g.connect(markerRows, "out", answered, "in");
  g.connect(asked, "out", answered, "source");

  // KEPT WHERE THE ANSWER IS NOT ITS OWN INDEX, which is the corner nobody
  // claimed -- so `lt(eq(...), 1)` rather than `eq(...)`, and the direction
  // is worth reading twice because both spellings run and only one is L-2.
  const unclaimed = g.add(
    filterByExpression,
    {
      predicate: lt(eq(attribute(VICTIM.claimedBy), attribute(PLACED.corner)), 1),
    },
    `${tag}Unclaimed`,
  );
  g.connect(answered, "out", unclaimed, "in");

  // ---- 6. AND THE LOOPS' OWN WORKING, DROPPED --------------------------
  //
  // AFTER THE CLAIM CLOUD BRANCHES OFF IT, which is the only ordering
  // constraint here: `asClaims` reads `VICTIM.claimedBy` and both hang off
  // `kept`, so the strip is a third branch rather than something the claim
  // test has to be sequenced around. Twenty-one columns -- a histogram, a
  // running scan, a round counter, a per-corner row -- all of it on the
  // POINT domain because a `repeatUntil` body cannot read a detail
  // attribute, and all of it meaningless one stage later.
  const stripped = g.add(
    removeAttribute,
    { names: [...CORNER_BOOKKEEPING_SCRATCH], strict: false },
    `${tag}Strip`,
  );
  g.connect(kept, "out", stripped, "in");

  return { kept: stripped, unclaimed };
}

/**
 * The whole lap placement list, from a path, as one run of stages.
 *
 * WHAT `cookLapPlacements` COOKS, WITHOUT THE COOK. That function already
 * puts the stations, D-4's coverage repair and the asset choice into one
 * graph — it says so in its own header, and the reason it gives is this
 * one: the endpoint is a lap LEVEL and a level is one graph. What it then
 * does is READ the result back into TypeScript, pair two lists, sort them,
 * and hand them to `dressLap`, which builds a cloud out of them again.
 * This is those four steps deleted: the same three stages, plus
 * {@link addPlacementAssembly}, ending on the cloud the repair loop wants.
 *
 * THE SORT DOES NOT COME WITH IT, and that is the one difference a caller
 * can see. `cookLapPlacements` sorts its rows by station because it is
 * handing back two parallel lists and `dressLap` indexes them in lockstep;
 * a cloud has no such pairing to keep, and nothing downstream reads row
 * order. {@link addPlacementAssembly} carries the measurement.
 *
 * THE TABLES ARE THE CALLER'S, all three of them, for the reason
 * `cookLapPlacements` gives about the pool: a choice is an INDEX into the
 * asset table, and the pose is an index into the flat pose table, so a
 * caller that built either from a different pool would get a lap dressed
 * with different objects and every index still in range. `reserveFor` is
 * the one definition of what that pool is — call it once and build all
 * three from its answer.
 */
export function addLapPlacements(
  g: Graph,
  path: { readonly node: NodeHandle; readonly pin: string },
  tables: {
    /** {@link assetCloud} over the pool — what the choice picks from. */
    readonly assets: { readonly node: NodeHandle; readonly pin: string };
    /**
     * {@link placementAssetCloud} over {@link placementAssetRows} — what a
     * placement is LOOKED UP in, pool and reserved markers together.
     *
     * NOT `mixAssetCloud`. That one is the pool Z-3 DRAWS FROM and must not
     * contain a marker; this one is the table every placement's extents and
     * poses come out of, and a converted placement carries a marker.
     */
    readonly lookup: { readonly node: NodeHandle; readonly pin: string };
    /** {@link placementPoseCloud} over the same rows — the flat pose table. */
    readonly poses: { readonly node: NodeHandle; readonly pin: string };
  },
  opts: {
    readonly halfWidth: number;
    readonly assetCount: number;
    /**
     * How many rows of the asset table are the POOL -- the ord the first
     * reserved marker sits at. Defaults to `assetCount`, which is the same
     * number for every caller today; it is stated apart because
     * `assetCount` is what the CHOICE may pick from and this is where the
     * choice's ord space ends, and a kit that ever reserved from somewhere
     * else would want them to differ.
     */
    readonly poolLength?: number;
    readonly poseIds: readonly string[];
    readonly params?: StationParams;
    readonly densityScale?: number;
    readonly lengthAttr?: string;
    /**
     * Node id prefixes for the three stages this wraps.
     *
     * DEFAULTED TO THE STAGES' OWN DEFAULTS, WHICH IS NOT LAZINESS. A node
     * id is part of what seeds a node, so a stage built under a different
     * prefix draws a different lap -- and `cookLapPlacements` builds these
     * same three stages with no prefix at all. Leaving them alone means
     * this function and that one produce the SAME stations and the SAME
     * choices from one seed, which is what lets the two be compared rather
     * than merely both be plausible. Set them only to put two of these in
     * one graph.
     */
    readonly prefixes?: {
      readonly stations?: string;
      readonly repair?: string;
      readonly choice?: string;
      readonly language?: string;
    };
    /**
     * L-2 and L-3, when the caller has a marker kit and a cooked lap.
     *
     * ONE OPTION HOLDING BOTH, because neither is any use without the
     * other: `addCornerLanguage` reads the corner model off the path and
     * draws from the three reserved assets, so a kit with no lap and a lap
     * with no kit are both half a question. Absent, the lap comes out with
     * no corner vocabulary at all, which is what `dressLap` does when
     * `reserveMarkers` could not find three verticals to hold back.
     */
    readonly language?: {
      readonly markers: MarkerKit;
      readonly lap: Lap;
    };
  },
  tag: string,
): {
  readonly out: NodeHandle;
  /** The repair loop's own report, for a caller that wants to publish it. */
  readonly repair: NodeHandle;
  readonly roundsPin: string;
  readonly convergedPin: string;
} {
  const lengthAttr = opts.lengthAttr ?? STATION_LENGTH_ATTR;
  const stations = addStationStage(g, path, {
    halfWidth: opts.halfWidth,
    params: opts.params,
    densityScale: opts.densityScale,
    lengthAttr,
    prefix: opts.prefixes?.stations,
  });
  const repair = addCoverageRepair(
    g,
    { node: stations.out, pin: "out" },
    {
      halfWidth: opts.halfWidth,
      stationAttr: stations.stationAttr,
      lengthAttr,
      prefix: opts.prefixes?.repair,
    },
  );
  const choice = addAssetChoiceStage(
    g,
    { node: repair.out, pin: "carry" },
    tables.assets,
    path,
    {
      halfWidth: opts.halfWidth,
      assetCount: opts.assetCount,
      stationAttr: stations.stationAttr,
      prefix: opts.prefixes?.choice,
    },
  );
  // ---- THE STATION, BACK OFF THE CLOUD THE COPIES WERE LAID OVER ---------
  //
  // `copyToPoints` composes each copy from the SOURCE's columns and writes
  // only the target's INDEX, so a copy knows which station it belongs to and
  // not where that station is.
  //
  // HERE RATHER THAN INSIDE THE ASSEMBLY, WHICH IS WHERE IT USED TO BE. The
  // corner bookkeeping runs BETWEEN this and the assembly and needs the arc
  // position -- L-2's window is measured back from a corner's entry -- so
  // the gather has to happen first. What that buys is one contract for
  // {@link addPlacementAssembly} instead of two: a row carries an ord, a
  // lateral, a height and a station, and where the station came from stopped
  // being its business.
  //
  // THE REPAIRED CLOUD AND NOT THE RAW ONE. D-4 MOVES stations, and the
  // choice's copies were laid over the moved ones -- reading the arc column
  // off the scatter would give every placement the position its station had
  // before the gaps were closed.
  const located = g.add(
    transferByIndex,
    {
      index: attribute(CHOICE.stationIdx),
      attributes: [stations.stationAttr],
      outOfRange: "clamp",
    },
    `${tag}Station`,
  );
  g.connect(choice.out, "out", located, "in");
  g.connect(repair.out, "carry", located, "source");

  // ---- L-2's CONVERT AND L-3's DISPLACEMENT, IF THERE IS A LANGUAGE ------
  //
  // BEFORE THE ASSEMBLY, so a converted placement's new asset is looked up
  // once rather than twice. See {@link addCornerBookkeepingApplied}.
  let rowsIn: { node: NodeHandle; pin: string } = { node: located, pin: "out" };
  let unclaimedMarkers: NodeHandle | undefined;
  let languageStage: { readonly markers: NodeHandle; readonly rulers: NodeHandle } | undefined;
  if (opts.language) {
    languageStage = addCornerLanguage(
      g,
      path,
      opts.language.markers,
      opts.language.lap,
      // "cl" AND NOT A TAGGED ONE, WHICH IS THE PREFIX RULE AGAIN. A node
      // id is part of what seeds a node, and `cookLapPlacements` adds these
      // same stages under exactly this prefix -- so sharing it is what makes
      // the two produce the SAME corner language from one seed rather than
      // two plausible ones. See `opts.prefixes`.
      opts.prefixes?.language ?? "cl",
    );
    const applied = addCornerBookkeepingApplied(
      g,
      rowsIn,
      languageStage.markers,
      cornersOf(opts.language.lap),
      {
        lapW: opts.language.lap.lengthW,
        ordBase: opts.poolLength ?? opts.assetCount,
      },
      `${tag}Bk`,
    );
    rowsIn = { node: applied.kept, pin: "out" };
    unclaimedMarkers = applied.unclaimed;
  }

  const assembled = addPlacementAssembly(g, rowsIn, { poseIds: opts.poseIds }, `${tag}Asm`);
  g.connect(tables.lookup.node, tables.lookup.pin, assembled.assets, "source");
  g.connect(tables.poses.node, tables.poses.pin, assembled.poses, "source");

  // ---- L-2 AND L-3 -------------------------------------------------------
  //
  // THE SAME ASSEMBLY, RUN A SECOND TIME. A marker is a reserved asset at a
  // station, which is what a chosen placement is; the only difference is
  // where the station came from, and that is the one thing
  // {@link addPlacementAssembly} takes as an option. So the corner language
  // does not get a second spelling of the pose draw, the extents lookup or
  // the id string -- it gets the same nodes, over its own rows.
  //
  // ASSEMBLED APART AND MERGED AFTER, rather than merged and assembled
  // once. `mergePoints` unions columns and fills the gaps with defaults, so
  // a merge before the assembly would give every marker a station INDEX of
  // zero beside its real station, and the gather would then overwrite the
  // station it already knew with whichever one row zero happened to hold.
  // Two assemblies produce two clouds with identical columns, which is the
  // one arrangement the merge cannot get wrong.
  let list: NodeHandle = assembled.out;
  if (languageStage && unclaimedMarkers) {
    const rows = addCornerLanguageRows(
      g,
      // ONLY THE MARKERS NOBODY CLAIMED. A corner whose window held a good
      // victim already has its marker -- the conversion above turned an
      // ordinary placement into it, keeping the station the station process
      // chose. Adding one here too would give that corner two.
      { markers: unclaimedMarkers, rulers: languageStage.rulers },
      opts.poolLength ?? opts.assetCount,
      `${tag}Lang`,
    );
    const marked = addPlacementAssembly(
      g,
      { node: rows, pin: "out" },
      { poseIds: opts.poseIds },
      `${tag}LangAsm`,
    );
    g.connect(tables.lookup.node, tables.lookup.pin, marked.assets, "source");
    g.connect(tables.poses.node, tables.poses.pin, marked.poses, "source");

    const merged = g.add(mergePoints, {}, `${tag}Merge`);
    // ORDINARY DRESSING FIRST, THEN THE LANGUAGE, which is the order
    // `placeCornerLanguage` builds its list in.
    g.connect(list, "out", merged, "in");
    g.connect(marked.out, "out", merged, "in");
    list = merged;
  }

  // ---- AND NOW THE LIST EXISTS, SO IT CAN BE NUMBERED --------------------
  //
  // ONE WRITE, OVER THE WHOLE THING. {@link addPlacementAssembly} used to
  // do this and cannot: it builds one KIND of row, and a lap with a corner
  // language runs it twice, so `index()` there numbers both from zero and
  // gives every marker the id of an ordinary placement. Here it is what the
  // column has always claimed to be -- where this placement sits in the
  // list the graph made.
  const numbered = g.add(
    setAttribute,
    { name: PLACEMENT.id, tupleSize: 1, value: index() },
    `${tag}Id`,
  );
  g.connect(list, "out", numbered, "in");

  return {
    out: numbered,
    repair: repair.out,
    roundsPin: repair.roundsPin,
    convergedPin: repair.convergedPin,
  };
}

/**
 * The lap's frame at each placement's station, sampled in the graph.
 *
 * NAMED `sample` RATHER THAN `write` BECAUSE `graph.ts` ALREADY HAS A
 * `writeTrackFrame`, and the two mean different things in one demo: that
 * one writes a path's OWN frame onto its own points, and this one carries
 * an existing frame onto a cloud that is not on the path. A shared name
 * made every `{@link}` in both files ambiguous.
 *
 * THIS IS `poseAt`, AS A STAGE. `dress.ts` answers "where is the lap at
 * station s" with a binary search over the frame table, a componentwise
 * blend of the two straddling samples, and a renormalise of each axis
 * afterwards. `transferAlongPath` is that operation exactly, including
 * the renormalise, which is what its `normalize` param is for and which
 * `lap.ts` argues for in nearly the same words — two unit vectors
 * averaged are not a unit vector, and the shortfall is worst exactly
 * where the track turns hardest.
 *
 * THE UNITS ARE THE TRAP AND THE NODE SAYS SO. A station here is in
 * HALF-WIDTHS, because every rule in this demo is; the node gathers on a
 * WORLD arc length, the chord table its own description pins to the one
 * `pathResample` steps. `placeAt` does this multiplication for the same
 * reason and in the same place — at the boundary, so no rule has to
 * remember which of the two units it is holding.
 *
 * THE AXES ARE RENAMED ON THE PATH, NOT ON THE CLOUD, and that is the
 * only reason this needs three nodes rather than none. A lifted frame is
 * named apart from `TRACK_FRAME`'s deliberately: those columns are a fact
 * about a point OF the lap, and these are the lap's frame carried to a
 * point that is not on it, so one name for both would make a cloud that
 * had been lifted indistinguishable from the path it was lifted off.
 * `transferAlongPath` writes under the SOURCE's names and has no rename
 * of its own — unlike `pathShift`, which needs one because it writes a
 * shifted value that must sit beside the original on the SAME cloud.
 * Here the two clouds are different by construction, so either side can
 * be renamed with `setAttribute` and the library needs no new param. The
 * cost is three nodes over the frames, cooked once and memoized, against
 * a few hundred placements.
 *
 * THERE ARE NOW TWO IMPLEMENTATIONS OF THIS, AND THAT IS THE TRADE. The
 * code this replaced carried the opposite promise -- "the lap's own
 * lookup, not a second one... the frame a box is built in here is the
 * frame it is built in there, to the bit" -- which was true because both
 * sides literally called `frameLookup`. They no longer do: `buildBoxes`
 * still walks `poseAt` and this walks the node, so the two agree by
 * MEASUREMENT rather than by construction, and nothing but a test stops
 * them drifting.
 *
 * That is the same trade every stage in this port has made and it is not
 * a regression -- a rule stated twice and checked equal is what has caught
 * the defects here, where a rule stated once could only ever be
 * self-consistent. But it is a promise that was withdrawn rather than one
 * that was never made, so it is named. `tests/racetrackDressGraph.test.ts`
 * is what holds it: "samples the lap where poseAt does, one f32 station
 * apart" compares the two directly, with the swapped-axis and
 * dropped-normalize faults injected and measured to size its bounds.
 *
 * P LANDS ON THE CENTRELINE, which is a truthful intermediate rather than
 * a placeholder: until the lift runs, a placement is where its station
 * is. `framePos` keeps that value after the lift has moved `P`, because
 * the lift is re-derived from it every round.
 */
function sampleTrackFrame(
  g: Graph,
  frames: NodeHandle,
  cloud: NodeHandle,
  halfWidth: number,
  tag: string,
): NodeHandle {
  let path = frames;
  for (const [src, dst] of [
    [TRACK_FRAME.across, PLACEMENT.across],
    [TRACK_FRAME.up, PLACEMENT.up],
    [TRACK_FRAME.along, PLACEMENT.along],
  ] as const) {
    const n = g.add(
      setAttribute,
      { name: dst, tupleSize: 3, value: attribute(src, 3) },
      `${tag}_frameAs_${dst}`,
    );
    g.connect(path, "out", n, "in");
    path = n;
  }

  const arc = g.add(
    setAttribute,
    { name: FRAME_ARC_WORLD, tupleSize: 1, value: mul(attribute(PLACEMENT.station), halfWidth) },
    `${tag}_frameArc`,
  );
  g.connect(cloud, "out", arc, "in");

  const at = g.add(
    transferAlongPath,
    {
      arcAttr: FRAME_ARC_WORLD,
      // NAMED RATHER THAN LEFT EMPTY, and P is why: the empty list skips
      // the eight bookkeeping columns, and naming one lifts that — which
      // is the whole placement idiom, since sampling P is what puts a
      // station on the road. An empty list here would also drag every
      // other column the frames carry (the corner model's four, the
      // half-width) onto every placement.
      attributes: ["P", PLACEMENT.across, PLACEMENT.up, PLACEMENT.along],
      normalize: [PLACEMENT.across, PLACEMENT.up, PLACEMENT.along],
    },
    `${tag}_frameAt`,
  );
  g.connect(path, "out", at, "path");
  g.connect(arc, "out", at, "at");

  const kept = g.add(
    setAttribute,
    { name: PLACEMENT.framePos, tupleSize: 3, value: attribute("P", 3) },
    `${tag}_framePos`,
  );
  g.connect(at, "out", kept, "in");

  // The scratch goes home. NOT for the reason the other stages strip
  // theirs -- those columns are rewritten every round and this stage runs
  // once, outside the loop -- but because a column nothing reads would
  // otherwise ride every round of the carry and land on all four outputs,
  // where the only thing it could do is be mistaken for a station.
  const cleaned = g.add(removeAttribute, { names: [FRAME_ARC_WORLD] }, `${tag}_frameArcOff`);
  g.connect(kept, "out", cleaned, "in");
  return cleaned;
}

/**
 * Z-1's arithmetic, as field expressions, with no node in it.
 *
 * ONE SPELLING FOR TWO CALLERS, which is the whole reason it is a function
 * rather than two blocks. {@link writeCorridor} applies the rule to the
 * lap once a round; Z-3's redraw applies it to a placement it is about to
 * emit, because `settleIntoBand` does -- "a repair must not emit something
 * another repair has to undo", measured at 56 mix moves against 23
 * corridor fixes over twelve rounds on a lap every rule had already
 * settled. Written twice, the two would agree until one was edited, and
 * `zones.ts` counts three spellings of this rule already.
 *
 * `exempt` is 1 where the rule must not fire at all. L-6's cover is the
 * case: its pieces are placed clear by construction, and standing a tunnel
 * rib off to the corridor edge puts a hole in the roof over the racing
 * line. The redraw passes 0 -- a replacement has no such exemption.
 */
function corridorFields(
  t: Field,
  baseH: Field,
  acrossW: Field,
  tall: Field,
  exempt: Field | number,
): { readonly wantT: Field; readonly wantBase: Field } {
  // EVERY EDGE OF THE VOLUME CARRIES `SAME_PLACE_W`, AND THAT IS A REAL
  // DIFFERENCE FROM `inCorridor`, NOT A TRANSCRIPTION SLIP.
  //
  // `inCorridor` tests `|t| < 1`, `h >= 0` and `h < 1.2` with no
  // tolerance at all, and it is the one boundary test in this demo's
  // ladder without one — its sibling `bandOf`, which asks the same
  // question of an already-placed lateral, spells every rung as
  // `a < limit - SAME_PLACE_W`. `tolerance.ts` states the intent this
  // file is applying: the boundaries here are hit EXACTLY, by
  // construction rather than by luck, and a rule whose own placer lands
  // on its own boundary has to agree with itself.
  //
  // WITHOUT IT THIS GRAPH MOVES EVERY GANTRY OFF THE ROAD, and that is
  // measured rather than feared. Z-3's `over` band takes its height from
  // the band, so an overhead placement's base is EXACTLY the corridor
  // ceiling and it is stored as a centre: `h = 1.2 + tall/2`. Recovering
  // the base as `h - tall/2` in f64 returns 1.2 and `1.2 < 1.2` is false,
  // so the rule correctly leaves a gantry spanning the corridor. In f32
  // the same round trip lands a few parts in ten million BELOW 1.2, the
  // test passes, and the piece is stood off to the verge — on seed 1 that
  // was two placements and six boxes, one of them a 9.6W span moved 5.8W
  // sideways. `moved` cannot catch it, because this is not a phantom
  // no-op fix: it is a phantom REAL one.
  //
  // Each rung is slacked in the direction that keeps the f64 answer for a
  // value sitting exactly on it — `1.2 < 1.2 - eps` is false as `1.2 <
  // 1.2` is, `0 >= -eps` is true as `0 >= 0` is — so on any population
  // where nothing sits INSIDE the slack the two statements agree, and
  // `SAME_PLACE_W` is sized so that nothing does.
  const inCorridor = mul(
    mul(
      lt(abs(t), CORRIDOR.halfWidthW - SAME_PLACE_W),
      ge(baseH, CORRIDOR.floorW - SAME_PLACE_W),
    ),
    lt(baseH, CORRIDOR.ceilingW - SAME_PLACE_W),
  );
  // L-6's cover is placed clear by construction; standing a tunnel rib off
  // to the corridor edge puts a hole in the roof over the racing line.
  const fires = mul(inCorridor, sub(1, exempt));
  // THE SIZE CUT TAKES NO TOLERANCE, and the asymmetry with the volume
  // above is the point rather than an oversight. A height reaches its
  // comparison through `h - tall/2`, a subtraction of two stored values
  // that is not the number either of them started as; an EXTENT is read
  // off the catalogue and stored once, so the only error it carries is
  // the f32 rounding of a single value, six parts in a hundred million.
  // Slack applied where there is no round trip is slack in the rule, and
  // `tolerance.ts` is explicit that these are not that.
  const small = mul(lt(acrossW, 1), lt(tall, 1.5));

  const signT = sub(1, mul(2, lt(t, 0)));
  const standOff = mul(signT, add(CORRIDOR.halfWidthW, div(acrossW, 2)));

  const wantT = select(mul(fires, sub(1, small)), standOff, t);
  const wantBase = select(mul(fires, small), CORRIDOR.ceilingW, baseH);
  return { wantT, wantBase };
}

/**
 * Z-1, as field expressions on the placement cloud.
 *
 * THE RULE RESOLVES TWO WAYS BY SIZE and that is the whole of it: small
 * art rises to the ceiling keeping its lateral, large art stands off to
 * the corridor edge keeping its band. Clamping everything to the edge
 * costs the verge band, because the archetypes that reach inside 1W are
 * the same ones that fill 1.0-1.5W; lifting everything is worse than
 * either. `zones.ts` argues both at length.
 *
 * THE EDGE IS THE OBJECT'S, NOT ITS CENTRE'S. `1 + across/2` puts the
 * near FACE on the corridor edge; `1` would leave half the piece's width
 * over the road, which on a 13W slab is 6.7W of structure across the
 * racing line at whatever height it was.
 *
 * THE COMPARISONS ARE `lt` AND `ge` WHERE `inCorridor` WRITES `<` AND
 * `>=`, rather than the `1 - lt` idiom `graph.ts` argues for. That idiom
 * exists to put a NaN on the side of a threshold where an unmeasurable
 * frame does least harm, and it is the wrong tool for a REPAIR. `graph.ts`
 * is classifying — a NaN there would enter a corner nobody chose and be
 * marked — whereas this rule only ever MOVES something, so the harmless
 * answer for a placement whose lateral failed to compute is to leave it
 * alone rather than to teleport it to a stand-off computed from a NaN.
 * Every comparison against a NaN is false, so `lt`/`ge` give exactly that,
 * and it is also what `resolveCorridor` does — which is the other half of
 * the reason: the graph must not be MORE opinionated than the rule it is
 * mirroring, or the disagreement shows up as a placement that only one of
 * the two paths moved.
 *
 * THE SIGN IS `1 - 2*lt(t, 0)` AND NOT `sign(t)`. The rule reads
 * `Math.sign(t || 1)`, which answers +1 for a lateral of exactly zero —
 * a piece dead on the centreline has to go somewhere and right is as good
 * as left. `sign(0)` is 0, and multiplying the stand-off distance by it
 * would leave that piece exactly where it was, inside the corridor,
 * having been "resolved".
 */
function writeCorridor(g: Graph, tag: string): { head: NodeHandle; tail: NodeHandle } {
  const t = attribute(PLACEMENT.t);
  const h = attribute(PLACEMENT.h);
  const tall = attribute(PLACEMENT.sizeTall);
  const acrossW = attribute(PLACEMENT.sizeAcross);

  // A placement stores its CENTRE height; the corridor is stated on its
  // BASE. The round trip through `base = h - tall/2` and back is the one
  // `moved` warns about — in f32 it leaves about 1e-7 behind, a hundred
  // times the residue the f64 rule was sized against — which is exactly
  // why the no-op gate below is not optional here.
  const baseH = sub(h, div(tall, 2));

  const { wantT, wantBase } = corridorFields(
    t,
    baseH,
    acrossW,
    tall,
    attribute(PLACEMENT.cover),
  );

  // THE NO-OP GATE, and it is a rule about the REPAIR LOOP rather than
  // about the corridor. `dressLap` runs Z-1 once a round and stops when
  // no round moves anything; a fix that cannot recognise its own no-op
  // fires forever. There are only two real fixes and both are jumps —
  // small art rises to the ceiling from wherever under it it was, large
  // art goes from inside 1W to at least half its own width beyond it — so
  // nothing this threshold swallows was ever a fix. See `moved`.
  const moved = max(
    gt(abs(sub(wantT, t)), SAME_PLACE_W),
    gt(abs(sub(wantBase, baseH)), SAME_PLACE_W),
  );

  // THE GATE IS ALSO PUBLISHED, because a repair inside a fixed point has
  // to say whether it fired. `dressLap` keeps this as a local counter it
  // adds up per round; a graph has nowhere to put a local, so the same
  // fact becomes a column and {@link writeSettleCount} reduces it. It is
  // written FIRST in the chain, off the same expression the two fixes read,
  // so it describes the decision rather than its result — recovering it
  // afterwards by comparing `trackT` against what came in would be a
  // second derivation of a value this node already has.

  // THE LATERAL LANDS IN A COLUMN OF ITS OWN AND IS MOVED ACROSS LAST,
  // AND WITHOUT THAT THIS IS A RULE THAT READS ITS OWN OUTPUT.
  //
  // A `setAttribute` chain is sequential: whatever the second node reads
  // is what the first one left. Z-1's two answers are computed from the
  // SAME four inputs — the lateral, the base, the extent and the width —
  // so a node that overwrote `trackT` and then let the height node
  // recompute `inCorridor` would be asking the question of a placement
  // that had already been moved out of the corridor, and would get the
  // answer "nothing to do" for a piece that had only had its lateral
  // fixed. On today's rule that happens to come out right, because the
  // two exits are exclusive and the one that moves the lateral never
  // touches the height — which is exactly the kind of accident that
  // survives until somebody adds a third exit.
  //
  // So the resolved lateral is parked under its own name, the height is
  // written from the ORIGINAL pair, and the lateral is copied over last
  // from a column nothing else reads. Every node then reads inputs no
  // earlier node in this stage has written, which is a property that can
  // be checked by looking rather than by case analysis.
  const fired = g.add(
    setAttribute,
    { name: PLACEMENT.corridorMoved, tupleSize: 1, value: moved },
    `${tag}_corridorFired`,
  );

  const nextT = g.add(
    setAttribute,
    { name: PLACEMENT.tNext, tupleSize: 1, value: select(moved, wantT, t) },
    `${tag}_corridorT`,
  );
  g.connect(fired, "out", nextT, "in");

  // Back to a centre height, through the same `base + tall/2` the rule
  // uses — so a placement the gate found unmoved keeps the `h` it came in
  // with rather than the f32 round trip of it.
  const outH = g.add(
    setAttribute,
    {
      name: PLACEMENT.h,
      tupleSize: 1,
      value: select(moved, add(wantBase, div(tall, 2)), h),
    },
    `${tag}_corridorH`,
  );
  g.connect(nextT, "out", outH, "in");

  const outT = g.add(
    setAttribute,
    { name: PLACEMENT.t, tupleSize: 1, value: attribute(PLACEMENT.tNext) },
    `${tag}_corridorApply`,
  );
  g.connect(outH, "out", outT, "in");
  return { head: fired, tail: outT };
}

/**
 * Track coordinates to a world transform, on the placement cloud.
 *
 * `P` IS `placeAt` WRITTEN AS A FIELD: the centreline point plus the
 * lateral along `across` plus the height along `up`, both scaled out of
 * half-widths by the lap's own half-width. Nothing here is a new
 * derivation — it is the same three lines `lap.ts` runs, evaluated in
 * attribute columns instead of in a loop.
 *
 * `rot` IS `orientAlongVector` WITH AXIS `+y`, WHICH IS NOT A PREFERENCE.
 * The frame a box has to be axis-aligned in is (across, along, up) as the
 * matrix's columns — local X across, local Y along, local Z up — because
 * that is the frame the kit measured its boxes in. `+y` puts the local Y
 * on `direction`, and for the ±y axes the node's own contract is that
 * local +Z takes the up hint. So `direction: along` and `up: up` give
 * exactly those three columns, and the node's up-hint construction
 * recovers `across` as `-(up x along)` rather than reading the stored
 * column: an ORTHONORMAL frame, where the stored triple is orthogonal
 * only to about 1.9e-4 over four laps (`poseAt` renormalizes each axis
 * independently, so a pose interpolated between two frames is a rotation
 * plus a small shear). A quaternion cannot carry a shear, which is the
 * right answer and not a lossy one — `tests/racetrackSpawn.test.ts` found
 * the same difference from the other side, measured it at 1.6e-4 on one
 * of those laps, and pinned it rather than absorbing it into a bound.
 *
 * AND THE PER-POINT `up` COSTS THE DEVICE PATH, WHICH IS A PRICE WORTH
 * NAMING RATHER THAN DISCOVERING. `orientAlongVector` bakes a constant up
 * into its apply kernel, so a FIELD up makes the node ineligible for a
 * device-resident run and the cook reports it under that name in its
 * fallbacks. There is no version of this rule that takes a constant: a
 * lap with relief banks, the road is swept on the surface normal, and a
 * literal [0, 1, 0] here would roll every prop off the road it is
 * standing beside on every banked corner. So level 1 orients on the CPU
 * until the kernel can carry a roll, and the fallback line in the stats
 * is the true reason rather than a mystery.
 *
 * `scale` IS THE ASSET'S OWN WORLD BOX — the extents the catalogue
 * publishes, in W, multiplied out by the half-width. That is what a
 * placement's `scale` MEANS everywhere the library reads one: it is the
 * column `spawnInstances` draws with and the column `occlusionCull` tests
 * against, so the box L-1 culls is the box the renderer would have shown.
 *
 * IT IS OVERWRITTEN LATER, AND THAT IS A LIBRARY GAP RATHER THAN A CHOICE.
 * `copyToPoints` composes `scale = targetScale * sourceScale` and has no
 * separate scale param, so the one column has to carry the TARGET'S SIZE
 * for the cull and the COPY'S SCALE for the stamp. {@link writeCopyScale}
 * swaps it over immediately before `copyToPoints` and nowhere else, which
 * keeps the window in which `scale` means something other than the
 * placement's size down to a single node. A `scaleAttr` on that node —
 * read the copy's scale from a column the author names — would remove the
 * swap entirely, and is the second thing this stage would ask for after
 * per-target source selection.
 */
function writeLift(g: Graph, target: NodeHandle, halfWidth: number, tag: string): NodeHandle {
  const P = g.add(
    setAttribute,
    {
      name: "P",
      tupleSize: 3,
      value: add(
        attribute(PLACEMENT.framePos, 3),
        add(
          mul(attribute(PLACEMENT.across, 3), mul(attribute(PLACEMENT.t), halfWidth)),
          mul(attribute(PLACEMENT.up, 3), mul(attribute(PLACEMENT.h), halfWidth)),
        ),
      ),
    },
    `${tag}_lift`,
  );
  g.connect(target, "out", P, "in");
  return P;
}

function writeWorldTransform(
  g: Graph,
  target: NodeHandle,
  halfWidth: number,
  tag: string,
): NodeHandle {
  const P = writeLift(g, target, halfWidth, tag);

  // The lifted position, kept under a name nothing else writes. L-1 moves
  // `P` and reports nothing; this is what the move is measured against.
  const placed = g.add(
    setAttribute,
    { name: PLACEMENT.placedP, tupleSize: 3, value: attribute("P", 3) },
    `${tag}_placedP`,
  );
  g.connect(P, "out", placed, "in");

  const scale = g.add(
    setAttribute,
    {
      name: "scale",
      tupleSize: 3,
      value: vec(
        mul(attribute(PLACEMENT.sizeAcross), halfWidth),
        mul(attribute(PLACEMENT.sizeAlong), halfWidth),
        mul(attribute(PLACEMENT.sizeTall), halfWidth),
      ),
    },
    `${tag}_assetBox`,
  );
  g.connect(placed, "out", scale, "in");

  const rot = g.add(
    orientAlongVector,
    {
      direction: attribute(PLACEMENT.along, 3),
      up: attribute(PLACEMENT.up, 3),
      axis: "+y",
    },
    `${tag}_frame`,
  );
  g.connect(scale, "out", rot, "in");
  return rot;
}

/**
 * L-1, as one node over the placement cloud.
 *
 * THE SUBJECT IS THE PLACEMENT, NOT THE BOX, and the choice is the rule's
 * rather than the graph's. A gantry is seven boxes and one object; culling
 * per box would clear the cone by deleting a leg and leaving the span
 * hanging over the road, which satisfies L-1 and produces something nobody
 * placed. `cullSightlines` tests a placement's aggregate extents for the
 * same reason, and that is why this stage sits BEFORE the box build even
 * though the boxes are what a driver would actually see.
 *
 * THE SIGHT PATH IS THE LAP'S OWN FRAMES, WHICH FIXES THE EYE SPACING AND
 * THE TARGET RESOLUTION AT ONCE — and `occlusionCull` gives no way to
 * separate them. Its eyes ARE the points of the path it is handed, and its
 * targets are located by arc length along that same polyline, so asking
 * for "eyes every 2W, targets on the full-resolution centreline" is not
 * expressible: a coarser sight path moves the targets too, and a 2W chord
 * cuts `0.5W^2 / R` inside the arc it stands for — 0.016W at this lap's
 * median radius of 31.5W and 0.076W at its p10 of 6.6W, which is the
 * tighter end where L-1 actually bites. Those are two to three orders
 * above the f32 and frame-shear differences the rest of this file is
 * bounded by (`MAX_FRAME_SKEW`, 5e-4), so a coarse sight path would not
 * shift the comparison, it would replace it. Handing the node the frames
 * takes the accurate targets and the fine eye set together. See the file
 * header for what that cost and what it caught.
 *
 * `eyeOffset` IS THE FRAME'S OWN `up`, NOT WORLD UP, for the reason
 * {@link writeCoverage} gives about its rays: this lap has relief and the
 * road banks on the surface normal, so a literal [0, 1, 0] puts the
 * cockpit eye somewhere other than in the cockpit on every banked corner.
 *
 * `pushAxis` IS THE PLACEMENT'S OWN `across`, AND THE SIGN IS THE NODE'S.
 * `cullSightlines` pushes along `Math.sign(t || 1)` — outward from the
 * centreline, in the direction the piece already lies. The node has no
 * centreline: it pushes whichever way takes the point further from the
 * nearest eye it can reach, which is the same direction whenever the
 * nearest eye is the one abreast of the placement, and is the better
 * answer where it is not. Whether the two ever disagree is a measurement
 * in the test rather than a claim here.
 *
 * `pushClearance` IS 0, DELIBERATELY, AND IT IS THE ONE PARAM THAT DECIDES
 * WHETHER THIS STAGE CAN BE PARTITIONED. Above zero the node becomes
 * greedy — where this point settled depends on where that one did — and
 * its own description is explicit that no halo width covers that chain, so
 * a per-cell cook would disagree with a whole-lap one at the seams. At
 * zero every verdict is a function of the sight path alone, which is what
 * makes a level-1 cell exact given a window of `lookAhead + pushMax`
 * around it. `cullSightlines` has no clearance either, so nothing is being
 * given up to buy that.
 */
function writeSightlineCull(
  g: Graph,
  placements: NodeHandle,
  halfWidth: number,
  tag: string,
): { tail: NodeHandle; sight: NodeHandle } {
  const cull = g.add(
    occlusionCull,
    {
      lookAhead: SIGHTLINE.aheadW * halfWidth,
      samples: SIGHTLINE.samples,
      eyeOffset: mul(attribute(TRACK_FRAME.up, 3), SIGHTLINE.eyeW * halfWidth),
      pushAxis: attribute(PLACEMENT.across, 3),
      // Zero for L-3's ruler elements, which is how this node spells "drop
      // rather than move". Everything else gets the rule's own allowance —
      // plus HALF A RUNG, and that half rung is a correctness fix rather
      // than a margin.
      //
      // `occlusionCull` walks `floor(pushMax / pushStep)` rungs, and the
      // search only ever lands on multiples of `pushStep`, so any allowance
      // in [12 rungs, 13 rungs) means exactly the twelve `cullSightlines`
      // walks. Naming the boundary instead — 6W, which IS twelve rungs —
      // asks f32 to hold `6 * halfWidth` exactly, and this param CANNOT be
      // a plain number: the L-3 exception makes it a field, and a field is
      // resolved onto an f32 column (see `scalarPerElement`, whose own doc
      // warns about exactly this). At the default half-width of 9 the
      // product is 54 and f32 holds it, which is why the suite was green;
      // at 7.3 it is 43.799999237 against a step of 3.65, the ratio comes
      // to 11.9999998, and the graph walks ELEVEN rungs where the rule
      // walks twelve. A placement that only clears at the full 6W is then
      // dropped by the graph and kept by the rule. Stating the allowance
      // half a rung clear puts the ratio at 12.5, where no f32 rounding of
      // either number can move the floor.
      pushMax: select(
        attribute(PLACEMENT.locked),
        0,
        (SIGHTLINE.maxPushW + SIGHTLINE.pushStepW / 2) * halfWidth,
      ),
      // The ladder `cullSightlines` walks, in world units. A plain number,
      // so it keeps the f64 the multiplication produced.
      pushStep: SIGHTLINE.pushStepW * halfWidth,
      pushClearance: 0,
    },
    `${tag}_cone`,
  );
  g.connect(placements, "out", cull, "in");
  // The `sight` pin is left UNCONNECTED and handed back, because inside the
  // repair body it is fed by a portal rather than by a node: the lap's
  // frames are the same every round, so `repeatUntil` broadcasts them
  // whole and only the placement cloud is carried forward.

  // HOW FAR IT MOVED, RECOVERED FROM THE TWO POSITIONS RATHER THAN FROM THE
  // MOVED ONE. See `PLACEMENT.placedP`: the difference is purely along
  // `across`, so this projection is exact, where projecting the position
  // itself would carry `up . across` times the height.
  const push = g.add(
    setAttribute,
    {
      name: PLACEMENT.pushW,
      tupleSize: 1,
      value: div(
        dot(
          sub(attribute("P", 3), attribute(PLACEMENT.placedP, 3)),
          attribute(PLACEMENT.across, 3),
        ),
        halfWidth,
      ),
    },
    `${tag}_conePush`,
  );
  g.connect(cull, "out", push, "in");

  // AND THE LATERAL FOLLOWS THE POSITION, because a `trackT` describing
  // where a placement used to be is worse than none: `bandOfPlacement`
  // reads it, Z-3 counts what that returns, and a pushed piece still
  // claiming its old band is counted into the wrong one for the whole lap.
  const lateral = g.add(
    setAttribute,
    {
      name: PLACEMENT.t,
      tupleSize: 1,
      value: add(attribute(PLACEMENT.t), attribute(PLACEMENT.pushW)),
    },
    `${tag}_coneT`,
  );
  g.connect(push, "out", lateral, "in");
  return { tail: lateral, sight: cull };
}

/**
 * L-5, as a run scan over the placement cloud.
 *
 * THE RULE IS A SHAPE, NOT A COUNT. A line of objects in the verge, evenly
 * spaced and drifting slowly away from the road, reads to a driver as the
 * track's edge — so it has to be broken, and `falseEdges.ts` breaks it by
 * dropping ONE member below the band rather than by moving the run away.
 * A run qualifies on four measurements at once: at least three members, a
 * span of at least 4W, every member within 0.3W of the common line, and a
 * divergence between 0.02 and 0.3 W of lateral per W of lap. `runFit`
 * computes three of those four directly and the fourth from its own member
 * count, which is what makes this stage a gate rather than an algorithm.
 *
 * AND THE RULE IS INVENTED, WHICH THIS FILE MUST NOT LAUNDER. `falseEdges.ts`
 * says so at length: the divergence band in particular survived a test that
 * REFUTED its other half — 5 of 17 measured runs diverge, at p = 0.264 —
 * so `[0.02, 0.3]` is a choice about what a driver misreads and not a fact
 * about the source. Stating it as nodes makes it cook; it does not make it
 * measured.
 *
 * THE SEAM IS A RING, WHICH IS WHY `wrap` IS ON AND `period` IS STATED.
 * `edgeRuns` scans each side as one closed ring — a run that straddles the
 * start line is one run — and `runFit` reproduces that exactly, down to the
 * rotation onto the first real gap. It REFUSES a wrapping path whose arc
 * comes from an attribute without a period, which is the right refusal:
 * the default period is the path's measured length in WORLD units, and
 * `stationW` is in half-widths, so the seam gap would be inflated ninefold
 * and a run crossing the line would quietly become two.
 *
 * WHAT THIS STAGE IS NOT IS THE REPAIR LOOP. `repairFalseEdges` runs the
 * detector up to eight times, because lowering the middle member of an
 * eight-member run splits it into two fours that can each still qualify.
 * This is ONE pass, and on these four laps a second pass finds something
 * on one of them — so the test compares against `repairFalseEdges(..., 1)`
 * and says which. A subgraph that re-cooks until an output settles is the
 * missing capability, and it is the same one L-6 and the whole tail need.
 */
function writeFalseEdges(g: Graph, target: NodeHandle, lapW: number, tag: string): NodeHandle {
  const t = attribute(PLACEMENT.t);
  const h = attribute(PLACEMENT.h);

  const absT = g.add(
    setAttribute,
    { name: PLACEMENT.absT, tupleSize: 1, value: abs(t) },
    `${tag}_absT`,
  );
  g.connect(target, "out", absT, "in");

  // EVERY RUNG SLACKED OUTWARD BY `SAME_PLACE_W`, and here that is not a
  // precaution but a repair of a collision this demo builds by hand. Z-1
  // stands large art off at exactly `1 + across/2`, which lands on the
  // band's lower bound for a piece of no width and on its upper bound for
  // one exactly 3W wide; Z-3's bands take their heights from the table, so
  // an `h` of exactly 0.2 or 0.6 is constructed rather than stumbled on.
  // `writeCorridor` measures its own `h` round trip at about 1e-7 in f32,
  // which is two to seven times the spacing at those heights — so an
  // untoleranced membership test would put the same placement in the band
  // on one path and out of it on the other, and the disagreement would
  // surface as a whole run appearing or vanishing.
  const inBand = mul(
    mul(
      ge(attribute(PLACEMENT.absT), FALSE_EDGE.lateralW[0] - SAME_PLACE_W),
      le(attribute(PLACEMENT.absT), FALSE_EDGE.lateralW[1] + SAME_PLACE_W),
    ),
    mul(
      ge(h, FALSE_EDGE.heightW[0] - SAME_PLACE_W),
      le(h, FALSE_EDGE.heightW[1] + SAME_PLACE_W),
    ),
  );
  const band = g.add(
    setAttribute,
    { name: PLACEMENT.band, tupleSize: 1, value: inBand },
    `${tag}_band`,
  );
  g.connect(absT, "out", band, "in");

  // `1 - 2*lt(t, 0)` rather than `sign(t)`, the idiom `writeCorridor`
  // argues for: `Math.sign(0)` is 0 and the rule reads `Math.sign(t || 1)`,
  // so a placement dead on the centreline belongs to the right-hand side
  // rather than to a third one. i32 because a group key is an identity and
  // `pointsToPath` refuses a fractional one.
  const side = sub(1, mul(2, lt(t, 0)));
  const group = g.add(
    setAttribute,
    {
      name: PLACEMENT.group,
      tupleSize: 1,
      type: "i32",
      value: mul(attribute(PLACEMENT.band), side),
    },
    `${tag}_group`,
  );
  g.connect(band, "out", group, "in");

  // CLOSED, BECAUSE `runFit` TAKES ITS WRAP FROM THE TOPOLOGY, AND
  // `shortGroups: "skip"` BECAUSE A SIDE MAY NOT HAVE ENOUGH TO CLOSE.
  //
  // `wrap: true` only reaches a path that is structurally closed, and a
  // closed path needs three points. How many band members a side carries
  // is DATA — fifteen at the thinnest over these four laps, and nothing
  // says a sparser seed, a lower density or a streamed cell could not
  // hand this stage two. Without the skip that is a failed cook rather
  // than a lap with no false edges on one side, which is the correct
  // answer and the one nothing else in this graph would refuse to give.
  // The node used to have no way to say so; it does now, and this stage
  // is why.
  //
  // Skipping leaves those points in the cloud carrying no primitive, and
  // `runFit` states what that means rather than leaving it to be found
  // out: a point in no polyline keeps the column defaults, which are -1
  // for the id and the index and 0 everywhere else. So a skipped side
  // reads `runCount` 0 and fails `ge(runCount, 3)`, and reads `runIndex`
  // -1 which cannot equal any midpoint. Both terms of the gate refuse it
  // independently, and neither was added for this case — the count term
  // is there because a two-member run fits a line exactly.
  const paths = g.add(
    pointsToPath,
    {
      closed: true,
      groupAttr: PLACEMENT.group,
      orderAttr: PLACEMENT.station,
      shortGroups: "skip",
    },
    `${tag}_sides`,
  );
  g.connect(group, "out", paths, "in");

  const runs = g.add(
    runFit,
    {
      arcAttr: PLACEMENT.station,
      valueAttr: PLACEMENT.absT,
      gap: FALSE_EDGE.gapW,
      // In half-widths, matching `arcAttr`. See the header note.
      period: lapW,
      wrap: true,
      slopeAttr: PLACEMENT.slope,
      residualAttr: PLACEMENT.residual,
      spanAttr: PLACEMENT.span,
      indexAttr: PLACEMENT.runIndex,
      countAttr: PLACEMENT.runCount,
    },
    `${tag}_runs`,
  );
  g.connect(paths, "out", runs, "in");

  // THE MEMBER COUNT IS REDUNDANT HERE, AND IT IS KEPT ANYWAY — stated,
  // because a term nobody can justify is a term somebody deletes.
  //
  // A two-member run fits a line through two points, so its residual is 0
  // (or the rounding noise left of one, which `runFit` puts at ~1e-16 of
  // the values' own size) and its slope is whatever the pair makes. That
  // sounds like the reason for this term and it is not: every consecutive
  // gap in a run is below `gapW`, so a k-member run spans less than
  // 3(k-1), and a PAIR spans less than 3 — already refused by
  // `ge(span, 4)`. There is no population on which this term changes the
  // answer, short of a member whose `|t|` is not finite (see the midpoint
  // note below).
  //
  // It stays because `minMembers` is one of the four things the rule SAYS,
  // and a graph that satisfies a rule by arithmetic coincidence is a graph
  // that stops satisfying it the moment `gapW` or `minSpanW` is retuned.
  const slope = abs(attribute(PLACEMENT.slope));
  const qualifies = mul(
    mul(
      mul(
        ge(attribute(PLACEMENT.runCount), FALSE_EDGE.minMembers),
        ge(attribute(PLACEMENT.span), FALSE_EDGE.minSpanW),
      ),
      le(attribute(PLACEMENT.residual), FALSE_EDGE.straightW),
    ),
    mul(ge(slope, FALSE_EDGE.divergence[0]), le(slope, FALSE_EDGE.divergence[1])),
  );
  // THE MIDDLE MEMBER, AND IT HAS TO BE THE SAME MIDDLE. `repairFalseEdges`
  // takes `members[floor(n/2)]` of a run whose members are in walk order
  // from the rotation point — and `runFit`'s `indexAttr` counts from that
  // same rotation, which is the whole reason the node reports an index at
  // all rather than leaving the caller to derive one from the station.
  //
  // AND THE TWO COLUMNS COUNT DIFFERENT POPULATIONS, WHICH IS A
  // PRECONDITION THIS STAGE MEETS RATHER THAN CHECKS. `indexAttr` numbers
  // every member of the run; `countAttr` reports how many were FITTED,
  // which excludes any whose `valueAttr` is NaN — a member with no value
  // keeps its place along the arc but contributes nothing to the line. The
  // TypeScript has one array for both, so on a run holding a NaN the two
  // spellings would pick different middles, or the graph would pick none.
  // It cannot arise here: `edgeAbsT` is `abs(trackT)`, `trackT` is a lift
  // of finite catalogue values, and a NaN would already have taken Z-1's
  // leave-it-alone branch and the cull's. Stated so that a future stage
  // writing a computed lateral knows what it has to keep true.
  const isMiddle = eq(
    attribute(PLACEMENT.runIndex),
    floor(div(attribute(PLACEMENT.runCount), 2)),
  );
  const drop = g.add(
    setAttribute,
    {
      name: PLACEMENT.drop,
      tupleSize: 1,
      // The band term is what keeps the non-member path out: its points
      // carry runs too, computed and never meant to be read.
      value: mul(mul(attribute(PLACEMENT.band), qualifies), isMiddle),
    },
    `${tag}_drop`,
  );
  g.connect(runs, "out", drop, "in");

  // BELOW THE BAND, NOT OUTSIDE IT. The rule lowers the member to
  // `heightW[0] - 0.05` rather than pushing it past 2.5W, because moving
  // it laterally would take it out of the verge entirely — the run breaks
  // because one of its members is no longer at edge height, which is the
  // cheapest thing that stops a driver reading a line.
  const lower = g.add(
    setAttribute,
    {
      name: PLACEMENT.h,
      tupleSize: 1,
      value: select(attribute(PLACEMENT.drop), FALSE_EDGE.heightW[0] - 0.05, h),
    },
    `${tag}_lower`,
  );
  g.connect(drop, "out", lower, "in");
  return lower;
}

/**
 * Z-3's six bands, in the order `quotaRebalance` indexes them.
 *
 * THE ORDER IS THE API. A share band list is positional — entry 3 of
 * `min` is the floor of whatever category 3 means — so this array is the
 * only statement of what an index stands for, and the ladder below and
 * the reader in `cookBandMix` both take it from here. `Object.keys(Z3)`
 * would give the same six today and would move the day someone reorders
 * a literal.
 */
export const MIX_BANDS: readonly Band[] = ["over", "verge", "near", "mid", "far", "distant"];

/** What {@link MIX_BANDS} says a placement outside every band index is. */
const MIX_STAYS = -1;

/**
 * `bandOfPlacement`'s ladder, as a field, on the CENTRE datum.
 *
 * A SELECT CHAIN AND NOT SIX COMPARISONS, because the ladder is ordered
 * and the first match wins: `|t| < 1` is `over` whatever its height, and
 * only a placement that got past that line is asked about the verge. The
 * grammar has no `or`, so the two-sided height test is spelled as a
 * `max` of two comparisons — both are 0 or 1, so their max is their
 * disjunction.
 *
 * THE TOLERANCES POINT IN OPPOSITE DIRECTIONS AND THAT IS THE RULE, not
 * a symmetry someone forgot. Every lateral edge is pulled IN by
 * `SAME_PLACE_W` so that a placement landing exactly on a boundary
 * belongs to the OUTER band, and both height edges are pushed OUT by it
 * so that a base sitting exactly on the corridor ceiling is not "above"
 * it. `assets.ts` measured what happens without them: the mix sets an
 * `over` replacement to exactly `1.2 + tall/2`, the round trip back to a
 * base misses 1.2 for 96 of 229 assets, and a strict comparison then
 * split one situation two ways on which direction the last bit rounded.
 * In f32 — which is what these columns are — that sliver is ~1e-7 rather
 * than ~1e-16, so the toss would be between COOKS rather than between
 * assets, and Z-3's shares, this repair and its move count all follow it.
 */
function bandField(tW: Field, hW: Field): Field {
  const a = abs(tW);
  const h = hW;
  const inside = (limit: number): Field => lt(a, limit - SAME_PLACE_W);
  const pushedOut = max(
    gt(h, CORRIDOR.ceilingW + SAME_PLACE_W),
    lt(h, CORRIDOR.floorW - SAME_PLACE_W),
  );
  return select(
    inside(CORRIDOR.halfWidthW),
    0,
    select(
      inside(1.5),
      select(pushedOut, 0, 1),
      select(inside(2.5), 2, select(inside(5), 3, select(inside(13), 4, 5))),
    ),
  );
}

/**
 * What the mix's redraw needs on the pool that a choice does not.
 *
 * A CHOICE PICKS FOR A STATION AND A REDRAW PICKS FOR A BAND, which is a
 * different question of the same pool. `assetCloud` answers the first: the
 * affinities a curvature bucket weighs by, and the quantiles a lateral is
 * drawn from. The second also has to know whether an asset can REACH the
 * band being filled, whether the corner language reserved it, and which
 * recorded poses it has — none of which a station cares about, and all of
 * which are properties of the POOL rather than of any placement, so they
 * are computed once here and never in the graph.
 */
export const MIX_ASSET = {
  /** The |t| range this asset's own instances actually reach. */
  reachLo: "mixReachLo",
  reachHi: "mixReachHi",
  /** Its along-track extent, which a choice never needed and a swap does. */
  along: "mixAlong",
  /** Where its poses start in the flat table, and how many there are. */
  poseOff: "mixPoseOff",
  poseCount: "mixPoseCount",
  /** 0 where the corner language reserved this asset, or it has no `where`. */
  free: "mixAssetFree",
  /**
   * The two per-asset flags a placement carries, as columns.
   *
   * SEPARATE FROM {@link MIX_ASSET.free}, WHICH IS NOT A THIRD SPELLING OF
   * `pinned`. `free` is written inside the `where` guard, so an asset the
   * kit never placed anywhere comes out 0 -- excluded from the redraw's
   * pool, which is right, because a pool entry with no distribution has
   * nothing to draw. `pinned` is the protect set and nothing else, and an
   * asset with no `where` is not in it. Deriving one from the other would
   * mark every unplaceable asset as protected, which is a different claim.
   *
   * BOTH ARE SET MEMBERSHIPS AND NEITHER IS DERIVABLE FROM THE POOL, which
   * is why they ride the asset table rather than being recomputed: they are
   * the caller's answer to `immovable` and `mixPinned`, and
   * {@link DressGraphInput} argues at length why those are required rather
   * than optional.
   */
  locked: "mixAssetLocked",
  pinned: "mixAssetPinned",
} as const;

/** The flat pose table: one point per (asset, pose), in pool order. */
const MIX_POSE = { id: "mixPoseId" } as const;

/** Scratch the redraw writes on the copies, the survivors and the carry. */
const MIX = {
  targetIdx: "mixTargetIdx",
  uPick: "mixUPick",
  uLat: "mixULat",
  uHgt: "mixUHgt",
  uSide: "mixUSide",
  weight: "mixWeight",
  cumLo: "mixCumLo",
  cumHi: "mixCumHi",
  total: "mixTotal",
  draw: "mixDraw",
  newT: "mixNewT",
  newH: "mixNewH",
  newAcross: "mixNewAcross",
  newAlong: "mixNewAlong",
  newTall: "mixNewTall",
  newPose: "mixNewPose",
  commit: "mixCommit",
} as const;

/**
 * The pool as the redraw reads it: {@link assetCloud} plus the six columns
 * above, and a position so the points have distinct identities.
 *
 * THE POSITION IS NOT DECORATION. `assetCloud` leaves `P` at the origin for
 * every asset, which makes the whole cloud ONE identity as far as this
 * library is concerned — harmless there, because every uniform that stage
 * draws is drawn on the STATION and carried onto the copies. This cloud is
 * broadcast into a repair body where a later author might reasonably reach
 * for `randomField` on it, and a cloud whose points cannot be told apart
 * answers one number for all of them. `cornerGraph.ts` sets `P = [i, 0, 0]`
 * on its own draw cloud for exactly this reason.
 */
export function mixAssetCloud(
  pool: readonly PlaceableAsset[],
  lib: PoseLibrary,
  protect: ReadonlySet<number>,
  immovable: ReadonlySet<number>,
): Geometry {
  const geo = assetCloud(pool);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const reachLo = pts.add(MIX_ASSET.reachLo, "f32", 1);
  const reachHi = pts.add(MIX_ASSET.reachHi, "f32", 1);
  const along = pts.add(MIX_ASSET.along, "f32", 1);
  const poseOff = pts.add(MIX_ASSET.poseOff, "f32", 1);
  const poseCount = pts.add(MIX_ASSET.poseCount, "f32", 1);
  const free = pts.add(MIX_ASSET.free, "f32", 1);
  const locked = pts.add(MIX_ASSET.locked, "f32", 1);
  const pinned = pts.add(MIX_ASSET.pinned, "f32", 1);

  let flat = 0;
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i] as PlaceableAsset;
    P.setTuple(i, [i, 0, 0]);
    along.set(i, a.size.along);
    const poses = lib.posesOf.get(a.id) ?? [];
    poseOff.set(i, flat);
    poseCount.set(i, poses.length);
    flat += poses.length;
    // ABOVE THE `where` GUARD, DELIBERATELY. See the two columns' own note:
    // an asset the kit never placed is still either in these sets or not,
    // and the guard below is about having a distribution to draw from.
    locked.set(i, immovable.has(a.id) ? 1 : 0);
    pinned.set(i, protect.has(a.id) ? 1 : 0);
    const w = a.where;
    if (!w) continue;
    const reach = lateralReach(w);
    reachLo.set(i, reach[0]);
    reachHi.set(i, reach[1]);
    free.set(i, protect.has(a.id) ? 0 : 1);
  }
  return geo;
}

/** The flat pose table {@link MIX_ASSET.poseOff} indexes into. */
export function mixPoseCloud(
  pool: readonly PlaceableAsset[],
  lib: PoseLibrary,
): Geometry {
  const ids: number[] = [];
  for (const a of pool) for (const id of lib.posesOf.get(a.id) ?? []) ids.push(id);
  // A pool with no recorded pose anywhere still needs a row: over an EMPTY
  // source `transferByIndex` misses every point under all three settings,
  // and a miss leaves the destination's PRIOR value — which here would be
  // a pose belonging to the asset the placement is no longer using.
  const geo = createPointCloud(Math.max(1, ids.length));
  const P = geo.attrs.point.require("P");
  const col = geo.attrs.point.add(MIX_POSE.id, "f32", 1);
  for (let i = 0; i < geo.attrs.point.count; i++) {
    P.setTuple(i, [i, 0, 0]);
    // -1 is what `poseFor` answers for an asset the vocabulary has nothing
    // for, and it is what the commit gate refuses on.
    col.set(i, ids.length === 0 ? -1 : (ids[i] as number));
  }
  return geo;
}

/**
 * Which bands this pool can actually refill, decided once.
 *
 * THE GRAPH CANNOT DISCOVER AN EMPTY POOL IN TIME, and that is the whole
 * reason this is a TypeScript function. The bracket that picks an asset
 * keeps the one copy whose cumulative range contains the draw, so a
 * placement whose entire candidate pool weighs zero keeps NO copy — and the
 * survivor cloud is then SHORTER than the cloud it is written back onto,
 * which does not fail: it silently lines every later placement up against
 * somebody else's asset. The candidate pool is a pure function of the pool,
 * the protect set and the band, so the six answers are computed here and
 * baked into the stage as literals. A band with nothing to offer simply
 * does not mark, and its placements are left where they are.
 */
export function mixBandPools(
  pool: readonly PlaceableAsset[],
  lib: PoseLibrary,
  protect: ReadonlySet<number>,
): boolean[] {
  // AND THE POOL ITSELF HAS TO BE WIDE ENOUGH TO BE A PATH. The bracket
  // groups the copies of one placement into a polyline, and `pointsToPath`
  // emits no primitive for a group of fewer than two points — so a pool of
  // one asset produces no primitives at all and `pathScan` refuses the
  // cook. It fails loudly rather than misaligning, which is the good half;
  // the bad half is that this function's whole job is to make the survivor
  // count safe BY CONSTRUCTION, so the one precondition it does not state
  // is the one nobody would look for.
  if (pool.length < 2) {
    throw new Error(
      `mixBandPools: the redraw needs a pool of at least 2 assets to bracket a weighted pick, got ${pool.length}; a one-asset pool has nothing to choose between, so switch Z-3 off by pinning it instead`,
    );
  }
  return MIX_BANDS.map((band) => {
    const [blo, bhi] = BAND_T[band];
    return pool.some((a) => {
      if (protect.has(a.id)) return false;
      const w = a.where;
      if (!w) return false;
      if ((lib.posesOf.get(a.id) ?? []).length === 0) return false;
      if (band === "over" && !fitsOverhead(a.size.tall)) return false;
      const [rlo, rhi] = lateralReach(w);
      if (!(rhi >= blo && rlo < bhi)) return false;
      return Math.max(0, a.instances) * Math.max(0, w.affinity.straight) > 0;
    });
  });
}

/**
 * A six-way `select` on the band index, for anything `BAND_T` keys.
 *
 * The grammar has no table lookup and six is small, so the table becomes a
 * ladder of comparisons — one per band, the last of which is unconditional
 * because a band index outside 0..5 cannot reach here (`quotaRebalance`
 * writes -1 or a valid index, and -1 is gated out upstream of every use).
 */
function perBand(dst: Field, of: (band: Band) => number): Field {
  const at = (i: number): Field | number =>
    i === MIX_BANDS.length - 1
      ? of(MIX_BANDS[i] as Band)
      : select(eq(dst, i), of(MIX_BANDS[i] as Band), at(i + 1));
  return at(0) as Field;
}

/**
 * Z-3's redraw: what a placement BECOMES in the band it was sent to.
 *
 * THE HALF `quotaRebalance` DELIBERATELY DOES NOT DO. The quota names the
 * placements that must change band; this draws each of them a new asset
 * from the pool, a lateral and a height from that asset's own measured
 * distribution, and a recorded pose to give it a shape. Every one of those
 * is a pure function of one placement and the pool, which is why it can be
 * a chain of nodes at all — and why it had to wait for the decision, which
 * is a fact about the whole lap and could not.
 *
 * IT IS NOT BIT-IDENTICAL TO `repairBandMix` AND CANNOT BE, which is the
 * one thing to know before comparing them. The reference draws from
 * `rand(seed, index, salt)`, keyed on the donor's ARRAY INDEX and on the
 * pass number of a greedy loop; a field draws from `randomField`, keyed on
 * point IDENTITY. Neither is available to the other — an array index is not
 * a property of a point, and a pass number does not exist here at all,
 * because the quota decides every move in one pass. So the two draw
 * different assets, and what can be compared is the POSTCONDITION they
 * share: every redrawn placement lands in the band it was sent to, holding
 * an asset whose own instances reach there. `PLAN.md` reaches the same
 * conclusion about the station port, for the same reason.
 *
 * THE POSE IS THE EXCEPTION AND IT IS EXACT. `poseFor` keys its draw on the
 * STATION, and a redraw never moves a placement along the lap, so that
 * uniform rides in as a column (see {@link PLACEMENT.poseU}). What the
 * graph does with it is the same arithmetic against a different asset's
 * pose list.
 *
 * EVERY TARGET GETS EXACTLY ONE SURVIVOR, INCLUDING THE ONES NOT MOVING,
 * and that is what lets the answer be written back by ordinal. The stamp
 * would otherwise drop the unmarked placements — they have no band to draw
 * for — and the survivor cloud would be shorter than the carry, so
 * `index()` would line every later placement up against somebody else's
 * asset. An unmarked target draws from the whole pool instead, at the cost
 * of a pick nobody reads, and the commit gate throws it away.
 *
 * THE ONE DRAW IS NOT A SIMPLIFICATION OF THE REFERENCE'S EIGHT. Measured
 * across eight seeds, all 224 committed mix moves landed on the FIRST of
 * `MIX_DRAW_ATTEMPTS`, so the other seven are unexercised on this
 * vocabulary. Where a draw does miss its band the commit gate refuses it,
 * the placement stays where it was, and the next round of the repair loop
 * draws again — with different numbers, because the lift has rewritten its
 * position and a point's identity is its position. That is the retry, one
 * round later instead of one iteration later.
 */
function writeBandRedraw(
  g: Graph,
  target: NodeHandle,
  halfWidth: number,
  bandPools: readonly boolean[],
  poseIds: readonly string[],
  tag: string,
): { readonly tail: NodeHandle; readonly assets: NodeHandle; readonly poses: NodeHandle } {
  // FOUR NODES FOR FOUR DRAWS, not one node and four keys. `randomField`
  // hashes (the NODE's derived seed, the key, the point's identity), so two
  // keys on one node share a seed; `assetGraph.ts` draws its four this way
  // and measured them at r = -0.0009.
  let chain = target;
  for (const [name, key] of [
    [MIX.uPick, "mix.pick"],
    [MIX.uLat, "mix.lateral"],
    [MIX.uHgt, "mix.height"],
    [MIX.uSide, "mix.side"],
  ] as const) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value: randomField(key) }, `${tag}_${name}`);
    g.connect(chain, "out", n, "in");
    chain = n;
  }

  const stamped = g.add(
    copyToPoints,
    {
      targetNames: [PLACEMENT.mixTarget, PLACEMENT.poseU, MIX.uPick, MIX.uLat, MIX.uHgt, MIX.uSide],
      targetIndexAttr: MIX.targetIdx,
      topology: "drop",
    },
    `${tag}_stamp`,
  );
  // `source` IS LEFT DANGLING ON PURPOSE and exposed as a body input, the
  // way `writeSightlineCull` leaves its `sight` pin: the pool is one cloud
  // broadcast whole to every round, not something a round computes.
  g.connect(chain, "out", stamped, "target");

  const dst = attribute(PLACEMENT.mixTarget);
  const blo = perBand(dst, (b) => BAND_T[b][0]);
  const bhi = perBand(dst, (b) => BAND_T[b][1]);
  // Marked, and its band has something to offer. See {@link mixBandPools}.
  const usable = mul(ge(dst, 0), perBand(dst, (b) => (bandPools[MIX_BANDS.indexOf(b)] ? 1 : 0)));

  // The candidate pool, transcribed: reserved assets are out, an asset with
  // no recorded pose is out, `over` additionally refuses anything that
  // would not fit under the overhead ceiling, and what is left has to REACH
  // the band — its measured laterals must overlap it, or the clamp below
  // would put the piece where its own instances never sat.
  const reachLo = attribute(MIX_ASSET.reachLo);
  const reachHi = attribute(MIX_ASSET.reachHi);
  const overhead = le(
    add(CORRIDOR.ceilingW, attribute(ASSET.tall)),
    OVERHEAD.ceilingW + SAME_PLACE_W,
  );
  const eligible = mul(
    mul(attribute(MIX_ASSET.free), gt(attribute(MIX_ASSET.poseCount), 0)),
    mul(mul(ge(reachHi, blo), lt(reachLo, bhi)), select(eq(dst, 0), overhead, 1)),
  );
  // `weightAt` at the STRAIGHT bucket, which is what the reference asks
  // for: the mix is refilling a band rather than dressing a corner, so it
  // draws with the curvature bucket hard-coded.
  const natural = mul(attribute(ASSET.instances), attribute(ASSET.affStraight));
  const weighed = g.add(
    setAttribute,
    { name: MIX.weight, tupleSize: 1, value: select(usable, mul(natural, eligible), natural) },
    `${tag}_weight`,
  );
  g.connect(stamped, "out", weighed, "in");

  // The inverse-CDF bracket, spelled as the asset choice spells it: two
  // scans, so every bracket's top IS its successor's bottom bit for bit and
  // no draw falls between two of them.
  const grouped = g.add(
    pointsToPath,
    { groupAttr: MIX.targetIdx, closed: false, shortGroups: "skip" },
    `${tag}_perPlacement`,
  );
  g.connect(weighed, "out", grouped, "in");
  const below = g.add(
    pathScan,
    { name: MIX.weight, outName: MIX.cumLo, mode: "exclusive" },
    `${tag}_cumLo`,
  );
  g.connect(grouped, "out", below, "in");
  const through = g.add(
    pathScan,
    { name: MIX.weight, outName: MIX.cumHi, mode: "inclusive", totalAttr: MIX.total },
    `${tag}_cumHi`,
  );
  g.connect(below, "out", through, "in");
  const total = g.add(
    promoteAttribute,
    { name: MIX.total, from: "primitive", to: "point", mode: "first" },
    `${tag}_total`,
  );
  g.connect(through, "out", total, "in");
  const drawn = g.add(
    setAttribute,
    { name: MIX.draw, tupleSize: 1, value: mul(attribute(MIX.uPick), attribute(MIX.total)) },
    `${tag}_draw`,
  );
  g.connect(total, "out", drawn, "in");
  const x = attribute(MIX.draw);
  const picked = g.add(
    filterByExpression,
    {
      predicate: mul(le(attribute(MIX.cumLo), x), lt(x, attribute(MIX.cumHi))),
      topology: "drop",
    },
    `${tag}_pick`,
  );
  g.connect(drawn, "out", picked, "in");

  // ---- one survivor per placement, in placement order: what it becomes --

  const tall = attribute(ASSET.tall);
  const acrossW = attribute(ASSET.across);
  const tMag = quantileField(
    attribute(ASSET.latP10),
    attribute(ASSET.latMed),
    attribute(ASSET.latP90),
    attribute(MIX.uLat),
  );
  const rightward = lt(attribute(MIX.uSide), attribute(ASSET.right));
  const drawnT = select(rightward, abs(tMag), mul(-1, abs(tMag)));
  const drawnH = quantileField(
    attribute(ASSET.hgtP10),
    attribute(ASSET.hgtMed),
    attribute(ASSET.hgtP90),
    attribute(MIX.uHgt),
  );

  // THE BAND DECIDES THE LATERAL, WITHIN WHAT THE ASSET REACHES. The draw
  // comes from the asset's whole distribution and the band is a slice of
  // it, so most draws miss — arithmetic rather than bad luck. What the rule
  // wants is a placement of THIS asset in THAT band, and the asset was
  // chosen because its own instances are observed there, so the lateral is
  // clamped into the intersection. The band's top belongs to the band ABOVE
  // it, so the ceiling is approached and never touched.
  const clampLo = max(blo, reachLo);
  const clampHi = min(sub(bhi, 2 * SAME_PLACE_W), reachHi);
  const signT = sub(1, mul(2, lt(drawnT, 0)));
  const settledT = select(
    ge(clampHi, clampLo),
    mul(signT, clamp(abs(drawnT), clampLo, clampHi)),
    drawnT,
  );

  // AN `over` PLACEMENT SPANS THE CORRIDOR; IT DOES NOT SIT IN IT, so its
  // height comes from the BAND. Every other band gets Z-1 applied at the
  // point of drawing, because a repair must not emit something another
  // repair has to undo — measured at 56 mix moves against 23 corridor fixes
  // over twelve rounds on a lap every rule had already settled.
  const fixed = corridorFields(settledT, sub(drawnH, div(tall, 2)), acrossW, tall, 0);
  const isOver = eq(dst, 0);
  const finalT = select(isOver, settledT, fixed.wantT);
  const finalH = select(isOver, add(CORRIDOR.ceilingW, div(tall, 2)), add(fixed.wantBase, div(tall, 2)));

  // The pose, from the same uniform `poseFor` would have spent, against
  // this asset's own list. `u` is in [0, 1) so the floor is below the
  // count and the reference's `% ids.length` is a no-op.
  const poseSlot = add(
    attribute(MIX_ASSET.poseOff),
    floor(mul(attribute(PLACEMENT.poseU), attribute(MIX_ASSET.poseCount))),
  );
  const posed = g.add(
    transferByIndex,
    { index: poseSlot, attributes: [MIX_POSE.id], outOfRange: "clamp" },
    `${tag}_pose`,
  );
  g.connect(picked, "out", posed, "in");

  // WHERE IT LANDED, WHICH IS THE COMMIT GATE. The reference draws up to
  // eight times and commits only a draw whose settled band IS the band it
  // was drawn for; anything else leaves the donor alone and is not counted
  // as a move. The same test, once — see the header for why once.
  let answer: NodeHandle = posed;
  for (const [name, value] of [
    [MIX.newT, finalT],
    [MIX.newH, finalH],
    [MIX.newAcross, acrossW],
    [MIX.newAlong, attribute(MIX_ASSET.along)],
    [MIX.newTall, tall],
    [MIX.newPose, attribute(MIX_POSE.id)],
    [
      MIX.commit,
      // `poseId >= 0` IS THE BACKSTOP AND NOT THE GUARD, which is worth
      // saying because it reads like the guard. An asset with no recorded
      // pose has `floor(u * 0) = 0`, so its slot is the NEXT asset's first
      // pose — a perfectly valid id, and `outOfRange: "clamp"` never
      // engages. What actually keeps such an asset out of the draw is
      // `eligible`'s `poseCount > 0`, upstream in the weight. This term
      // catches only the case where the whole pool has no pose anywhere,
      // which is the single -1 row `mixPoseCloud` inserts to keep
      // `transferByIndex` off an empty source.
      mul(
        mul(usable, eq(bandField(finalT, finalH), dst)),
        ge(attribute(MIX_POSE.id), 0),
      ),
    ],
  ] as const) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_${name}`);
    g.connect(answer, "out", n, "in");
    answer = n;
  }

  // ---- back onto the carry, by ordinal ---------------------------------

  // THE GATE IS CLEARED BEFORE IT IS GATHERED INTO, which is not
  // belt-and-braces. `transferByIndex` over an empty source MISSES every
  // destination point and a miss leaves the prior value — and `MIX.commit`
  // is the one scratch column that survives the round, because the settle
  // count reads it. A stale 1 would apply a row of zeros: a placement
  // teleported to the centreline with no extents and no pose, silently.
  // The other transferred columns are stripped each round and so come back
  // at their defaults; this one has to be written.
  const cleared = g.add(
    setAttribute,
    { name: MIX.commit, tupleSize: 1, value: 0 },
    `${tag}_clearCommit`,
  );
  g.connect(chain, "out", cleared, "in");

  const gathered = g.add(
    transferByIndex,
    {
      index: index(),
      attributes: [
        MIX.newT,
        MIX.newH,
        MIX.newAcross,
        MIX.newAlong,
        MIX.newTall,
        MIX.newPose,
        MIX.commit,
      ],
      outOfRange: "clamp",
    },
    `${tag}_gather`,
  );
  g.connect(cleared, "out", gathered, "in");
  g.connect(answer, "out", gathered, "source");

  const apply = attribute(MIX.commit);
  // Recorded BEFORE the columns it gates, so that a reader of this stage's
  // output sees a flag that describes the whole lap so far rather than
  // this round alone. It never returns to 0.
  const tried = g.add(
    setAttribute,
    {
      name: PLACEMENT.mixTried,
      tupleSize: 1,
      value: max(attribute(PLACEMENT.mixTried), apply),
    },
    `${tag}_tried`,
  );
  g.connect(gathered, "out", tried, "in");
  let out: NodeHandle = tried;
  for (const [name, next, prev] of [
    [PLACEMENT.t, MIX.newT, PLACEMENT.t],
    [PLACEMENT.h, MIX.newH, PLACEMENT.h],
    [PLACEMENT.sizeAcross, MIX.newAcross, PLACEMENT.sizeAcross],
    [PLACEMENT.sizeAlong, MIX.newAlong, PLACEMENT.sizeAlong],
    [PLACEMENT.sizeTall, MIX.newTall, PLACEMENT.sizeTall],
    [PLACEMENT.pose, MIX.newPose, PLACEMENT.pose],
  ] as const) {
    const n = g.add(
      setAttribute,
      { name, tupleSize: 1, value: select(apply, attribute(next), attribute(prev)) },
      `${tag}_apply_${name}`,
    );
    g.connect(out, "out", n, "in");
    out = n;
  }

  // THE ASSET ID, WHICH IS A STRING AND IS WRITTEN BY A FIELD, and this is
  // the node this file's own comment said did not exist. `setAttribute`
  // takes a table of strings and a field-capable INDEX into it, so the id
  // is re-derived from the pose column every round rather than transferred
  // — which also means it cannot drift from the pose, because there is
  // nowhere for the two to disagree. Cover pieces never move (the mix
  // excludes them), so their half of the table is written from the same
  // pose it always had.
  const half = poseIds.length / 2;
  const idIndex = add(
    add(attribute(PLACEMENT.pose), 1),
    mul(attribute(PLACEMENT.cover), half),
  );
  const named = g.add(
    setAttribute,
    {
      name: PLACEMENT.asset,
      tupleSize: 1,
      type: "string",
      values: poseIds as string[],
      value: idIndex,
    },
    `${tag}_assetId`,
  );
  g.connect(out, "out", named, "in");

  // The scratch goes home. `stationGraph.ts` strips its own for the same
  // reason: every column here rides the carry into the next round, where
  // the stage that wrote it writes it again.
  const cleaned = g.add(
    removeAttribute,
    {
      names: [
        MIX.uPick,
        MIX.uLat,
        MIX.uHgt,
        MIX.uSide,
        MIX.newT,
        MIX.newH,
        MIX.newAcross,
        MIX.newAlong,
        MIX.newTall,
        MIX.newPose,
      ],
      strict: false,
    },
    `${tag}_scratch`,
  );
  g.connect(named, "out", cleaned, "in");

  // P AND `scale` ARE DERIVED COLUMNS AND THIS STAGE JUST INVALIDATED
  // THEM. The lift turns (t, h) into a world position and the box write
  // turns the asset's extents into a world scale; both ran BEFORE the
  // mix, so a committed redraw leaves a placement whose position is where
  // its old asset stood and whose scale is that asset's size. Measured
  // before this was added: 27 to 46 placements a round carrying a P up to
  // 113 world units from where the rule had put them. Inside the loop the
  // next round happens to repair it, which is worse than not repairing it
  // — the damage only escapes on the round the loop stops, so it looked
  // fine until a seed converged at the wrong moment.
  const lifted = writeLift(g, cleaned, halfWidth, `${tag}_relift`);
  const rescaled = g.add(
    setAttribute,
    {
      name: "scale",
      tupleSize: 3,
      value: vec(
        mul(attribute(PLACEMENT.sizeAcross), halfWidth),
        mul(attribute(PLACEMENT.sizeAlong), halfWidth),
        mul(attribute(PLACEMENT.sizeTall), halfWidth),
      ),
    },
    `${tag}_rescale`,
  );
  g.connect(lifted, "out", rescaled, "in");
  return { tail: rescaled, assets: stamped, poses: posed };
}

/**
 * Every asset id a pose can name, in the order {@link writeBandRedraw}
 * indexes them: `pose:-1` first, then one per pose, then the same again
 * under the `cover:` prefix.
 *
 * A TABLE RATHER THAN A FORMULA because a string is not a number and no
 * field concatenates one. -1 leads because it is a real answer — `poseFor`
 * returns it for an asset the vocabulary has nothing for — and putting it
 * at index 0 makes the index a plain `pose + 1` with no branch.
 */
export function mixPoseIds(lib: PoseLibrary): string[] {
  const plain: string[] = [];
  const cover: string[] = [];
  for (let pose = -1; pose < lib.boxes.length; pose++) {
    plain.push(poseAssetId(pose, false));
    cover.push(poseAssetId(pose, true));
  }
  return [...plain, ...cover];
}

/**
 * Z-3's band mix, as far as a graph can take it: the DECISION.
 *
 * WHAT IT DOES AND WHAT IT POINTEDLY DOES NOT. `quotaRebalance` reads
 * every placement's band and Z-3's six share bands and writes down the
 * smallest set of placements that must change band, and which band each
 * should join. It does not redraw anything — the asset, the lateral and
 * the height a placement would take in its new band come from a draw over
 * the pool, and the pool, the pose library and the asset id STRING are
 * all outside this body. So the column this leaves is an instruction and
 * `dressLap` is still the one that carries it out.
 *
 * WHY THAT SPLIT IS THE RIGHT ONE AND NOT A HALF-MEASURE. The half of
 * Z-3 that cannot be done per cell is the SHARES: a share is a fact about
 * the whole lap, and a sector holding thirty placements cannot even
 * represent a band aimed at 0.005 with a 0.03 ceiling. That half is now
 * a node. The half that is left is a pure per-placement function of one
 * placement and a pool, which is the shape every stage in this file
 * already is — so what remains is portable and what has moved is the part
 * that never could be.
 *
 * THE PRIORITY IS THE STATION, WHICH IS THE REFERENCE'S ORDER AND NOT A
 * GOOD ONE. `repairBandMix` finds its donor with a linear `find` over a
 * list held in station order, so it always takes the first eligible
 * member of the over-full band — and since a band's members are spread
 * over the whole circuit, "the first k" is a CONTIGUOUS STRETCH of track.
 * Every replacement lands in the first tenth of the lap and the shares
 * come out exactly right. It is transcribed here because a port that
 * quietly improves the rule cannot be checked against it; `quotaRebalance`
 * takes the order as a param precisely so that changing it later is one
 * expression rather than a new node.
 */
function writeBandMix(g: Graph, target: NodeHandle, tag: string): NodeHandle {
  const band = g.add(
    setAttribute,
    {
      name: PLACEMENT.mixBand,
      tupleSize: 1,
      value: bandField(attribute(PLACEMENT.t), attribute(PLACEMENT.h)),
    },
    `${tag}_band`,
  );
  g.connect(target, "out", band, "in");

  const mix = g.add(
    quotaRebalance,
    {
      category: attribute(PLACEMENT.mixBand),
      min: MIX_BANDS.map((b) => Z3[b].rule[0] as number),
      max: MIX_BANDS.map((b) => Z3[b].rule[1] as number),
      // L-6's cover is STRUCTURE AND NOT DRESSING, so it leaves the
      // denominator as well as the pool. A lap can carry forty cover
      // pieces, all `over` by geometry, which would take that band from a
      // tenth of the population to a quarter and make Z-3 unsatisfiable on
      // any circuit that has a tunnel — and the share Z-3 states was
      // measured on dressing.
      include: sub(1, attribute(PLACEMENT.cover)),
      // A marker or a landmark STAYS IN THE DENOMINATOR and off the
      // table, which is the other exclusion and the opposite arithmetic:
      // it is part of the population the mix is stated over, and no
      // rebalance may move it. So does a placement this rule has already
      // redrawn once — see {@link PLACEMENT.mixTried} for why that is the
      // difference between a loop that settles and one that runs out.
      eligible: mul(
        sub(1, attribute(PLACEMENT.mixPinned)),
        sub(1, attribute(PLACEMENT.mixTried)),
      ),
      priority: attribute(PLACEMENT.station),
      targetAttr: PLACEMENT.mixTarget,
    },
    `${tag}_mix`,
  );
  g.connect(band, "out", mix, "in");
  return mix;
}

/**
 * THE SETTLE SIGNAL: how many placements this round moved.
 *
 * `repeatUntil` re-cooks its body until a named DETAIL attribute reads
 * zero, so a repair that wants to be iterated has to publish whether it
 * fired. `dressLap` keeps eight local counters and tests them all at the
 * bottom of the round; this is the same fact, in the only place a graph
 * has to put a number about a whole geometry.
 *
 * THREE FLAGS, OR-ED, THEN SUMMED. Z-1 writes {@link PLACEMENT.corridorMoved}
 * off its own gate, L-1 leaves a non-zero {@link PLACEMENT.pushW} on
 * anything it shoved, and L-5 sets {@link PLACEMENT.drop} on the member it
 * lowered. `max` rather than `add` so a placement two rules touched counts
 * once — the number is "how many placements moved", not "how many rules
 * fired", and the loop only ever compares it against zero anyway.
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT. It counts SURVIVORS, so a round in
 * which L-1 dropped a placement and nothing else moved reports zero and
 * the loop stops. `dressLap` runs one more round there, because its test
 * is `cull.blocking === 0` and a dropped placement was blocking.
 *
 * THE REASON IS THAT NOTHING IS LEFT TO DO, and it is worth stating on its
 * own because a first draft of this comment gave two reasons and the
 * second one was false. A drop cannot make another placement move in THIS
 * body: `occlusionCull` runs at `pushClearance: 0`, where every point's
 * verdict is a function of the sight path alone and of nothing another
 * point did, and L-5 saw the shortened list inside the same round. The
 * round `dressLap` adds is a confirming one that moves nothing.
 *
 * IT IS A CHOICE AND NOT A LIMITATION, WHICH IS WHAT THE FIRST DRAFT GOT
 * WRONG. That draft claimed the count could not be taken at all — that a
 * point filter always drops the detail domain and that a field cannot read
 * a detail attribute. Both are false, and both were concluded from one
 * experiment in which the attribute had already been dropped for a
 * different reason. What is actually true:
 *
 *   - A point filter drops the detail domain only under `topology: "drop"`;
 *     the `"keep"` arm copies it. `occlusionCull` is the unconditional
 *     case, because it always rebuilds through `gatherPoints` — which is a
 *     fact about this stage's own node and not about filters.
 *   - A field evaluated ON the detail domain reads detail attributes
 *     normally, and `promoteAttribute` broadcasts a detail value onto every
 *     point, where it survives any filter. So the before-and-after count IS
 *     reachable: reduce, promote, filter, reduce again.
 *
 * The count is left out because the semantics above are right, not because
 * the library cannot express it. Anything relying on the opposite should
 * check first.
 */
function writeSettleCount(g: Graph, target: NodeHandle, tag: string, trimmed = false): NodeHandle {
  const flags = g.add(
    setAttribute,
    {
      name: PLACEMENT.roundMoved,
      tupleSize: 1,
      // Z-3'S COMMIT IS IN HERE AND HAS TO BE. A round whose only event
      // was a band being refilled is a round that moved something, and a
      // loop that cannot see it reports `converged` over a lap it has just
      // changed — measured, before this term was added, as two seeds in
      // twenty shipping a placement whose boxes were built up to 17 world
      // units from where the rule had just put it.
      // L-6'S TRIM IS IN HERE TOO WHEN IT RAN, and it has to be for the
      // reason Z-3's commit is: a round whose only event was a covered run
      // being opened is a round that moved something, and a loop that
      // cannot see it stops with the lap still over the ceiling and calls
      // that converged. It is conditional because the column exists only
      // on a body built with the trim in it.
      value: (() => {
        const rules = max(
          max(attribute(PLACEMENT.corridorMoved), attribute(MIX.commit)),
          max(gt(abs(attribute(PLACEMENT.pushW)), 0), attribute(PLACEMENT.drop)),
        );
        return trimmed ? max(rules, attribute(TRIM.moved)) : rules;
      })(),
    },
    `${tag}_moved`,
  );
  g.connect(target, "out", flags, "in");

  const total = g.add(
    attributeReduce,
    {
      name: PLACEMENT.roundMoved,
      domain: "point",
      mode: "sum",
      outName: SETTLE_ATTR,
    },
    `${tag}_settle`,
  );
  g.connect(flags, "out", total, "in");
  return total;
}

/**
 * The repair body: one round of the rules that have a fixed point.
 *
 * THREE OF THE EIGHT, AND THE OTHER FIVE ARE NOT NEAR-MISSES. `dressLap`
 * iterates Z-1, L-1, L-6's top-up, L-6's trim, D-4, L-4, L-5 and Z-3. Of
 * those, exactly Z-1, L-1 and L-5 answer from the list they were handed:
 * the two L-6 halves and Z-3 and L-4 all read a lap-wide measurement of
 * the dressing every earlier repair rewrote, and three of them draw from
 * `seed + rounds`, which is worth naming precisely — a body whose seed
 * varies with the round number is a DIFFERENT FUNCTION each round, so it
 * does not have a fixed point to find. D-4 is pure but rewrites `station`
 * against the gap ring of the whole lap, which is the unbounded level's
 * business rather than a cell's.
 *
 * SO THE LOOP HERE IS SMALLER THAN `dressLap`'s AND IS NOT A SUBSET OF IT
 * IN BEHAVIOUR — it is the sub-loop those three would run on their own.
 * The test compares it against exactly that, and not against `dressLap`.
 *
 * MEASURED, THE THREE BARELY NEED EACH OTHER — one round on the shipped
 * vocabulary, sometimes two. That is not an argument against the loop: it
 * is the same argument `dressLap` makes for having one, which is that a
 * single pass CANNOT be shown to be enough without running the second.
 */
export function buildRepairBody(
  lap: Lap,
  mix: { readonly bandPools: readonly boolean[]; readonly poseIds: readonly string[] },
  /**
   * Run L-6's TRIM at the end of every round.
   *
   * OFF FOR THE FIRST PASS AND ON FOR THE SECOND, which is where the port
   * differs from `dressLap` on purpose. The trim is a ceiling repair on a
   * FINISHED lap, and the first pass settles a lap that has no enclosure in
   * it yet -- so trimming there would move incidental overhead before the
   * budget that is sized from it has been computed, and the top-up would
   * then spend a budget measured from a lap it had already changed.
   *
   * IT COSTS A RAY CAST PER ROUND, which is what kept L-6's other half out
   * of this body. Measured: a coverage pass is ~25 ms against a ~950 ms lap
   * cook, and the second pass settles in one round or two on the shipped
   * vocabulary, so the honest price is 2.5-5% of a lap. That is affordable
   * where the budget's own measurement -- which has to be taken once,
   * between the passes, on a population neither pass has changed -- was
   * not.
   */
  trim = false,
): {
  graph: Graph;
  inputs: ExposedPin[];
  outputs: ExposedPin[];
} {
  // The body's own seed is never rotated per round — see `repeatUntil`.
  // It carries no randomness at all: all three repairs are arithmetic and
  // a deterministic search, so the round is a pure function of its input
  // and the fixed point is a pure function of the list that went in.
  const b = new Graph(1);

  const z1 = writeCorridor(b, "z1");
  const oriented = writeWorldTransform(b, z1.tail, lap.halfWidth, "z1");
  const seen = writeSightlineCull(b, oriented, lap.halfWidth, "l1");
  const edged = writeFalseEdges(b, seen.tail, lap.lengthW, "l5");
  const settled = writeLift(b, edged, lap.halfWidth, "l5");
  // Z-3 LAST, WHICH IS `dressLap`'s ORDER AND IS LOAD-BEARING. The mix has
  // to see the lap the other repairs left: a mix balanced before the cull
  // is balanced against a population the cull is about to change, and L-5
  // lowers a placement out of the verge band, so the shares the mix reads
  // are only the lap's once both have run.
  const mixed = writeBandMix(b, settled, "z3");
  const redrawn = writeBandRedraw(b, mixed, lap.halfWidth, mix.bandPools, mix.poseIds, "z3");
  // L-6's TRIM, LAST, WHICH IS `dressLap`'s ORDER FOR THE SAME REASON Z-3
  // IS LAST. The trim reads a lap-wide measurement of the dressing, so it
  // has to see the lap the other repairs left: a run measured before the
  // cull is a run the cull is about to open, and trimming it would spend a
  // move on cover that was going away anyway.
  //
  // THE BOXES ARE A BRANCH, not the carry. `writeCopyScale` overwrites
  // `scale` with the track's half-width, which is what `copyToPoints`
  // wants and is NOT what a placement carries -- the carry keeps the
  // asset's own extents, exactly as `assemble` keeps them outside the loop.
  //
  // AND IT MEASURES THE LAP THE OTHER REPAIRS LEFT, which is the point of
  // running last: the ray cast is over `redrawn.tail`, so a run this round
  // trims is a run that survived the cull, not one the cull was about to
  // open anyway.
  //
  // A TRIMMED PLACEMENT'S `P` IS ONE ROUND STALE, and the loop is what
  // makes that harmless. `writeWorldTransform` runs near the top of the
  // body, off the lateral Z-1 resolved; the trim rewrites that lateral
  // afterwards, so the position on the cloud this round hands back is the
  // one the piece had BEFORE it was moved. It is corrected on the next
  // round -- and there is always a next round, because the move is in the
  // settle count below, so a round that trims cannot be the round that
  // settles. The one exception is `maxRounds` truncating the loop mid-trim,
  // and that comes back as `converged: false`, which is the caller's
  // signal that the lap is not finished rather than a quietly wrong `P`.
  let settling: NodeHandle = redrawn.tail;
  let trimBoxes: NodeHandle | undefined;
  let trimCover: NodeHandle | undefined;
  if (trim) {
    const scaled = writeCopyScale(b, redrawn.tail, lap.halfWidth, "l6trim", "out");
    trimBoxes = writeBoxes(b, null, scaled, "l6trim");
    trimCover = writeCoverage(b, null, trimBoxes, lap.halfWidth, "l6trim");
    settling = writeCoverTrim(
      b,
      trimCover,
      redrawn.tail,
      {
        lapW: lap.lengthW,
        coveredAttr: "covered",
        stationAttr: PLACEMENT.station,
        tAttr: PLACEMENT.t,
        hAttr: PLACEMENT.h,
        acrossAttr: PLACEMENT.sizeAcross,
        coverAttr: PLACEMENT.cover,
        keepShare: Z3.over.rule[0],
      },
      "l6trim",
    );
  }

  const counted = writeSettleCount(b, settling, "round", trim);

  return {
    graph: b,
    inputs: [
      // The name `repeatUntil` reserves for the pin it feeds back.
      { name: "carry", node: z1.head, pin: "in" },
      // Broadcast whole to every round: the lap's frames never change.
      { name: "sight", node: seen.sight, pin: "sight" },
      // Nor does the pool Z-3 redraws out of, nor its pose table.
      { name: "mixAssets", node: redrawn.assets, pin: "source" },
      { name: "mixPoses", node: redrawn.poses, pin: "source" },
      // The trim's two, when it is in. The frames arrive TWICE -- once for
      // L-1's sight path and once for the ray cast -- because an exposed
      // input names one (node, pin) and these are two pins on two nodes.
      // The wrapper feeds both from the same handle, so it is one cloud
      // broadcast to two readers rather than two copies of a lap.
      ...(trimBoxes !== undefined && trimCover !== undefined
        ? [
            { name: "trimPoses", node: trimBoxes, pin: "source" },
            { name: "coverPath", node: trimCover, pin: "path" },
          ]
        : []),
    ],
    // THE TWO INTERMEDIATES ARE PUBLISHED AS WELL AS THE CARRY, and that
    // is what keeps the individual rules testable once they are inside a
    // loop. A wrapper hides everything its body computes, so a graph that
    // only returned the settled cloud would make Z-1's verdict and L-1's
    // unreadable from outside — and worse, unreadable in the one place
    // they can still be checked cheaply, which is a single round.
    // `repeatUntil` hands back its LAST round's outputs, so these are the
    // final round's, and a test that wants a rule's answer on a population
    // it has not already settled cooks the body once instead.
    outputs: [
      { name: "carry", node: counted, pin: "out" },
      { name: "placed", node: oriented, pin: "out" },
      { name: "culled", node: seen.tail, pin: "out" },
    ],
  };
}

/**
 * The track's scale, written over the asset's box for `copyToPoints`.
 *
 * ONE NODE, IMMEDIATELY BEFORE THE STAMP, and {@link writeWorldTransform}
 * argues why it exists at all: `copyToPoints` reads the copy's scale from
 * the target's `scale` column and offers no param for it, so the column has
 * to mean two things at two points in the chain. Keeping the swap to a
 * single node keeps the window in which `scale` is not the placement's own
 * size down to one wire.
 *
 * It is also the one place the half-width enters the box build: the pose
 * library is in half-widths, the copy multiplies the source's offset and
 * extents by this, and the boxes come out in world units. That is why the
 * same library dresses a lap of any width.
 */
function writeCopyScale(
  g: Graph,
  target: NodeHandle,
  halfWidth: number,
  tag: string,
  // Named because the repair loop's carried output is not called "out":
  // a wrapper's pins are the names its body exposed.
  pin = "out",
): NodeHandle {
  const scale = g.add(
    setAttribute,
    { name: "scale", tupleSize: 3, value: vec(halfWidth, halfWidth, halfWidth) },
    `${tag}_trackScale`,
  );
  g.connect(target, pin, scale, "in");
  return scale;
}

/**
 * The box build: each placement takes the boxes of the pose it recorded.
 *
 * WHY IT IS A SELECTION RATHER THAN A LOOKUP, which is the one thing
 * about this file that should not be copied without reading this
 * paragraph. `copyToPoints` composes exactly the transform `buildBoxes`
 * writes by hand — `P = targetP + targetRot * (targetScale * sourceP)`,
 * `rot = targetRot * sourceRot`, `scale = targetScale * sourceScale` —
 * with the target the placement and the source its boxes. What it could
 * not express until `sourceGroupAttr`/`targetGroupAttr` shipped is that
 * DIFFERENT TARGETS TAKE DIFFERENT SOURCES: the source pin was one cloud,
 * stamped on every target, and neither `forEach` (whose non-iterated pins
 * broadcast, so it cannot pair the k-th pose with the k-th group of
 * placements) nor a pre-trimmed library on the host could say otherwise
 * inside the graph. So the whole vocabulary was stamped and the wrong
 * copies were filtered away.
 *
 * The pair says it directly now: `boxPose` is what each library box IS
 * and `placementPose` is what each placement ASKED FOR, and the node
 * emits only the copies where those agree. The ORDER is unchanged, which
 * is what made the swap safe — the copies still come out in contiguous
 * per-target blocks, in source order within a block, which is
 * `buildBoxes`' order exactly, and a copy's identity (its position bits
 * and `hashCombine(sourceSeed, targetSeed)`) does not know whether the
 * copies beside it were emitted.
 *
 * WHAT IT BOUGHT, MEASURED — the same two variants cooked in ONE process
 * over the same pose cloud and the same settled placement list, ten
 * rounds each, interleaved A/B/A/B with a fresh graph per round so
 * nothing was memoised. Seed 1: 2,200 library boxes, 354 placements.
 *
 *   broadcast + filter   778,800 intermediate points   98ms
 *   selection                1,984 points               0.8ms
 *
 * Both produce the same 1,984 boxes. The broadcast built 392 copies for
 * every one it kept; the selection builds the 1,984 and stops, at about
 * 1/120th of the time — and the whole level-1 dress cook fell from 651ms
 * to 193ms over four laps with nothing else changed. The stage is now
 * LINEAR IN THE ANSWER rather than in the product of the vocabulary and
 * the placement list, which is what a cell was paying for: every asset in
 * the kit it does not use. The numbers stay here rather than in a commit
 * message because the ratio is the whole argument for the node change,
 * and a ratio nobody prints is a ratio nobody notices coming back.
 */
function writeBoxes(
  g: Graph,
  // NULL WHEN THE CALLER IS EXPOSING THE PIN RATHER THAN FEEDING IT. A
  // `repeatUntil` body names its inputs as (node, pin) pairs on nodes it
  // already built, so a body that wants the pose library broadcast to it
  // has to leave `source` unconnected for the wrapper to fill.
  poses: NodeHandle | null,
  placements: NodeHandle,
  tag: string,
): NodeHandle {
  const copies = g.add(
    copyToPoints,
    {
      // NO CARRIED COLUMNS AT ALL NOW, and dropping the last one is the
      // second thing selection bought. `PLACEMENT.pose` was carried only
      // because the filter's predicate needed both sides of the
      // comparison on the same cloud; the node makes that comparison
      // itself and writes nothing for it. `cover` was proposed here too,
      // on the reasoning that a box has to know whether it is structure or
      // scenery before an asset map can name it — and that is true and is
      // still not a reason to carry it, for the reason `PLACEMENT.station`
      // is not carried either: it is a fact about the PLACEMENT,
      // `placementIndex` names the placement, and a column written once
      // per copy costs a write per copy.
      //
      // WHICH PLACEMENT A BOX BELONGS TO, written by the node that
      // already knows. `spawn.ts` argues that the placement is the
      // granularity real art binds to and the boxes are a decomposition
      // of it; a decomposition that cannot say what it decomposed is a
      // cloud. It is also what lets anything downstream regroup the boxes
      // of one object — `pointsToPath`'s `groupAttr` and
      // `partitionByAttribute` both key on exactly this column. Under
      // selection a placement whose pose the library does not carry
      // simply contributes no boxes and its index never appears, which is
      // the empty block the node documents rather than a hole to guard.
      targetIndexAttr: BOX.placement,
      // THE SELECTION. Both columns hold whole-number pose ids in f32,
      // which the node accepts and `pointsToPath`'s `groupAttr` accepts
      // for the same reason: ids run to a few hundred, every integer below
      // 2^24 is exact in f32, so this is an identity test and not a
      // tolerance. A fractional value in either column is refused by name
      // rather than grouped.
      sourceGroupAttr: BOX.pose,
      targetGroupAttr: PLACEMENT.pose,
      topology: "drop",
    },
    `${tag}_stamp`,
  );
  if (poses !== null) g.connect(poses, "out", copies, "source");
  g.connect(placements, "out", copies, "target");
  return copies;
}

/**
 * L-6's measurement: how much of the lap runs under cover.
 *
 * SIX VERTICAL RAYS FROM 1.2W TO 6W ACROSS -1.5W..+1.5W, AT LEAST HALF OF
 * THEM HITTING. `pathCoverage` is that definition as a node, down to the
 * default ray count and threshold, and its own description carries the
 * argument for why it has to be world-space rays: three cheaper proxies
 * gave 7.9%, 32.3% and 50.3% for one circuit, and the 32.3% was published
 * and withdrawn because a bounds projection onto a folded centreline
 * cannot tell "above the road here" from "near the road twice".
 *
 * `direction` IS THE FRAME'S OWN `up`, NOT WORLD UP. This lap has relief
 * and the road banks on the surface normal the placements hang off; a
 * literal [0, 1, 0] would ask what is vertically above a banked frame,
 * which is not what is over the road there.
 *
 * `acrossAttr` IS THE PUBLISHED COLUMN FOR THE SAME REASON THE RAYS ARE
 * BUILT THROUGH `placeAt` IN THE TYPESCRIPT. Left empty the node derives
 * across from the path's polyline topology, which is a second way of
 * computing the axis the boxes were placed along — and the node's own
 * description says it: a second derivation is a second chance to disagree
 * with the geometry being measured, and the disagreement reads as a
 * plausible number rather than as a bug.
 */
function writeCoverage(
  g: Graph,
  /** Null when the caller exposes the pin -- see {@link writeBoxes}. */
  path: NodeHandle | null,
  boxes: NodeHandle,
  halfWidth: number,
  tag: string,
): NodeHandle {
  const cover = g.add(
    pathCoverage,
    {
      direction: attribute(TRACK_FRAME.up, 3),
      near: COVER.floorW * halfWidth,
      far: COVER.ceilingW * halfWidth,
      rayCount: COVER.rays,
      spread: COVER.corridorW * halfWidth,
      minHits: COVER.minHits,
      acrossAttr: TRACK_FRAME.across,
      // The boxes arrive as unit cubes scaled to their extents, which is
      // what `boxCloud` produces and what the default asks for: the world
      // half-extent is 0.5 * boxSize * scale, so leaving boxSize at
      // [1, 1, 1] means `scale` IS the size. Scaling twice reports a
      // tunnel over the whole lap and forgetting `scale` reports no cover
      // anywhere, and both finish cleanly.
      coveredAttr: "covered",
      hitsAttr: "coverHits",
    },
    `${tag}_enclosure`,
  );
  if (path !== null) g.connect(path, "out", cover, "path");
  g.connect(boxes, "out", cover, "boxes");
  return cover;
}

/**
 * The placement list, for the three entry points that cannot decide one.
 *
 * `DressGraphInput.placements` IS OPTIONAL FOR EXACTLY ONE CALLER. The
 * whole dress graph can decide its own list, because it is handed the path
 * the stations are scattered on; these three cook ONE STAGE over a list
 * that already exists, which is what makes them comparable against the
 * rule they port -- there is no path in them to decide anything from, and
 * a stage's verdict on a population nobody chose is not a measurement.
 *
 * A THROW RATHER THAN A NARROWER TYPE, and it is a real trade. Splitting
 * the interface in two would catch this at compile time and would also
 * split every helper that builds one; these three are the minority case
 * and the error can say the whole of what is wrong, which a type cannot.
 */
function requireList(
  placements: readonly StationedPlacement[] | undefined,
  who: string,
): readonly StationedPlacement[] {
  if (placements !== undefined) return placements;
  throw new Error(
    `${who}: needs a placement list and was handed none. \`DressGraphInput.placements\` is ` +
      "optional only for `buildDressGraph` and `dressLapByGraph`, which are given the lap's path " +
      "and can decide the list themselves through `addLapPlacements`. This cooks a single stage " +
      "over a KNOWN list so that its answer can be compared against the rule it ports, and it has " +
      "no path to decide one from. Pass `placements`, or cook the whole graph with " +
      "`dressLapByGraph` and read the stage's column off its output.",
  );
}

/**
 * The repair body as a graph that runs it ONCE, over a bound placement list.
 *
 * WHY A SECOND ENTRY POINT EXISTS AT ALL. Wrapping the three repairs in
 * `repeatUntil` makes their intermediates invisible from outside — a
 * wrapper publishes what its body exposes and nothing else, and what it
 * publishes is the LAST round's, which on a settled lap is a round in
 * which every rule did nothing. That is the right answer for the loop and
 * it is useless for checking a rule: "Z-1 moved nothing" is what Z-1 is
 * supposed to report once the lap has settled, so a test reading it would
 * pass for a Z-1 that had been deleted.
 *
 * So the rules are checked one round at a time, against the population
 * that actually exercises them, and the LOOP is checked separately for the
 * thing only a loop can be wrong about — whether it settles, in how many
 * rounds, and on the same answer as the TypeScript's own loop. Two
 * subjects, two entry points, and neither one re-implements the other:
 * both call {@link buildRepairBody}.
 *
 * `rounds` and `converged` are not published here. One round is one round;
 * a number that can only be 1 is not a measurement.
 */
export function buildRoundGraph(
  input: DressGraphInput,
  /**
   * Build the round with L-6's TRIM in it.
   *
   * THE ONLY WAY THE TRIM IS CHECKABLE AT ALL, and it is worth saying why
   * rather than leaving it as a convenience. No lap the shipped vocabulary
   * can dress reaches the ceiling -- measured, seeds 1-8 at density 1, 2
   * and 3 top out at 20.0% against 25% -- so the rule never fires through
   * `assemble`, and a suite that only cooked whole laps would be green for
   * a trim that had been deleted. One round over a CONSTRUCTED
   * over-enclosed list is where the rule can be held to its reference,
   * which is the same argument this function already makes for Z-1 and L-1.
   */
  opts: { readonly trim?: boolean } = {},
): Graph {
  // A BODY OF ITS OWN, not the one `assemble` built. Wrapping a body
  // CONNECTS its exposed input pins to the portals the wrapper injects, so
  // reusing that body here would find `carry` already wired and refuse —
  // which is the machinery telling the truth: a body belongs to one
  // wrapper, and running it bare is a different graph rather than the same
  // graph with the loop switched off.
  const { kit, lap, seed, immovable, mixPinned, pool } = input;
  const placements = requireList(input.placements, "buildRoundGraph");
  const lib = poseLibrary(kit);
  const body = buildRepairBody(
    lap,
    {
      bandPools: mixBandPools(pool, lib, mixPinned),
      poseIds: mixPoseIds(lib),
    },
    opts.trim ?? false,
  );
  const g = body.graph;

  // The portals `repeatUntil` would have injected, added by hand — which
  // is all a wrapper does to an input pin, minus the loop.
  const carry = g.add(dataInput, {}, "roundCarry");
  g.setParam(carry, "items", [
    makeGeometryItem(placementCloudInTrackCoords(placements, lib, seed, immovable, mixPinned)),
  ]);
  const sight = g.add(dataInput, {}, "roundSight");
  g.setParam(sight, "items", [makeGeometryItem(input.frames)]);
  // The frame, before the body rather than inside it: it is a function of
  // the STATION alone and a repair never moves a placement along the lap,
  // so lifting it per round would recompute a constant. `assemble` puts it
  // in the same place for the same reason -- outside `repeatUntil`, on the
  // cloud that becomes the first round's carry.
  const carried = sampleTrackFrame(g, sight, carry, lap.halfWidth, "round");
  const mixAssets = g.add(dataInput, {}, "roundMixAssets");
  g.setParam(mixAssets, "items", [makeGeometryItem(mixAssetCloud(pool, lib, mixPinned, immovable))]);
  const mixPoses = g.add(dataInput, {}, "roundMixPoses");
  g.setParam(mixPoses, "items", [makeGeometryItem(mixPoseCloud(pool, lib))]);

  // NAMED RATHER THAN POSITIONAL, and it is worth the four lines: the
  // ternary this replaced sent every pin that was not "carry" to the sight
  // path, so adding an input to the body wired it to the frames and the
  // failure arrived as a missing column three nodes later.
  // The pose library, for the trim's boxes. Built whether or not the trim
  // is on: it is the same cloud `assemble` binds, and an unread
  // `dataInput` cooks to nothing.
  const trimPoses = g.add(dataInput, {}, "roundTrimPoses");
  g.setParam(trimPoses, "items", [makeGeometryItem(poseCloud(lib, lap.halfWidth))]);

  const portals: Record<string, NodeHandle> = {
    // THE TRIM'S RUNNING TOTALS ARE THE CARRY'S, which is why they are
    // started here and not in the body -- see {@link writeTrimInit}. Doing
    // it unconditionally keeps one carry shape for both kinds of round.
    carry: writeTrimInit(g, carried, "roundTrim"),
    sight,
    mixAssets,
    mixPoses,
    trimPoses,
    // The frames a second time: L-1 reads them as a sight path and the
    // trim casts rays down them. One cloud, two readers.
    coverPath: sight,
  };
  for (const pin of body.inputs) {
    const from = portals[pin.name];
    if (from === undefined) {
      throw new Error(
        `buildRoundGraph: the repair body exposes an input "${pin.name}" that this function has no portal for; add a dataInput for it beside the others`,
      );
    }
    g.connect(from, "out", pin.node, pin.pin);
  }
  for (const pin of body.outputs) {
    g.output(pin.node, pin.pin, pin.name === "carry" ? DRESS_OUTPUTS.placements : pin.name);
  }
  return g;
}

/**
 * Build the graph, with the lap and the placement list already bound in.
 *
 * A GRAPH WITH ITS DATA IN IT COSTS WHAT THE DATA COSTS, which is worth
 * knowing before this is called to draw a picture. `dataInput` binds real
 * geometry, so building carries the whole pose library into a cloud
 * whether or not anything is ever cooked. It no longer takes a frame
 * lookup per placement -- that was the other half of this paragraph until
 * {@link sampleTrackFrame} made it a stage, and a lookup that happens when
 * the graph is COOKED is a lookup a budget can interrupt and a cache can
 * skip, which is not true of one that happens when the graph is BUILT.
 * The pose library is still real, so a page that wants the picture beside
 * the result should build once and keep it rather than rebuild per frame.
 */
export function buildDressGraph(input: DressGraphInput): Graph {
  return assemble(input).graph;
}

/**
 * The graph.
 *
 * IT USED TO REPORT A SECOND NUMBER — `libraryBoxes`, how many points the
 * copy's SOURCE carries — because the broadcast in {@link writeBoxes}
 * cost that TIMES the placement count in intermediate points, and a cost
 * that is a product of two numbers only one of which anyone can see is a
 * cost nobody measures. Per-target source selection made the product stop
 * being the cost, so the number stopped being worth publishing: what the
 * stage emits is now the box count, which `GraphDressing.stamped` reports
 * off the output itself rather than deriving from two inputs.
 */
function assemble(input: DressGraphInput): { graph: Graph } {
  const { kit, lap, frames, placements, seed, immovable, mixPinned, pool } = input;
  const g = new Graph(seed);

  const lib = poseLibrary(kit);
  const library = poseCloud(lib, lap.halfWidth);

  // L-6 DRAWS FROM THE WHOLE KIT, NOT FROM THE POOL. `dressLap` passes
  // `all` to `placeEnclosure` -- every asset the source placed somewhere --
  // where the ordinary dressing draws from `pool`, which has had L-2 and
  // L-3's corner vocabulary reserved out of it. Cover is a different
  // question from scenery and a marker's exclusion from one says nothing
  // about the other.
  const coverPool = coverCandidates(
    (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where),
  );
  const coverPoses = coverPool.map((a) => lib.posesOf.get(a.id) ?? []);

  const posesIn = g.add(dataInput, {}, "poseLibrary");
  g.setParam(posesIn, "items", [makeGeometryItem(library)]);

  const framesIn = g.add(dataInput, {}, "lap");
  g.setParam(framesIn, "items", [makeGeometryItem(frames)]);

  // Z-1 FIRST, IN TRACK COORDINATES, AND THAT ORDERING IS THE RULE. The
  // corridor is stated in half-widths about a centreline; resolving it
  // after the lift would mean recovering a lateral from a world position,
  // which on a lap that folds back on itself has no single answer.
  // THE THREE REPAIRS RUN TO A FIXED POINT, NOT ONCE EACH. Z-1, L-1 and
  // L-5 are inside one `repeatUntil` because each undoes the others' work:
  // the cull moves a placement laterally, which is what decides edge-band
  // membership, and L-5 lowers a height, which moves a box, which changes
  // what blocks the cone. Running them once in sequence answers a
  // DIFFERENT QUESTION — it gives a lap on which each rule has been
  // APPLIED, not one on which all three HOLD — and that distinction is the
  // whole reason `dressLap` has a loop at all.
  //
  // The order inside the body is `dressLap`'s and is load-bearing twice
  // over. See {@link buildRepairBody}.
  const mixAssetsIn = g.add(dataInput, {}, "mixAssets");
  g.setParam(mixAssetsIn, "items", [
    makeGeometryItem(mixAssetCloud(pool, lib, mixPinned, immovable)),
  ]);
  const mixPosesIn = g.add(dataInput, {}, "mixPoses");
  g.setParam(mixPosesIn, "items", [makeGeometryItem(mixPoseCloud(pool, lib))]);

  // ---- WHERE THE LIST COMES FROM -----------------------------------------
  //
  // TWO WAYS IN, AND THE DIFFERENCE IS THE WHOLE CAMPAIGN. Handed a list,
  // this binds it with `dataInput` and the graph is a picture of ONE lap:
  // the placements are data in it, and the placements are the answer.
  // Handed none, {@link addLapPlacements} decides them from the path --
  // stations, D-4's coverage repair, the asset choice, the assembly -- and
  // the graph becomes a thing that can be serialized and re-run against
  // another spline, which is the only version of it a game could ship.
  //
  // NOT A MODE, AND THE STAGES BELOW CANNOT TELL. Both branches end on a
  // cloud carrying exactly the same columns -- asserted, in
  // `tests/racetrackPlacementAssembly.test.ts` -- so nothing downstream
  // takes a branch, and the rules do not acquire a second spelling. That is
  // the property that makes the comparison suites still worth anything:
  // they hand a list in, and what they measure is the same graph.
  //
  // THE STATIONS RUN ON `lapAsPath`, NOT ON THE FRAMES, AND THE FIRST DRAFT
  // HAD IT THE OTHER WAY.
  //
  // The frames ARE the path -- the road graph's own output, which `readLap`
  // reads the lap out of -- so scattering on them looked like one fewer
  // reconstruction. It was not the same path in the one respect the
  // stations care about: `lapLen`. `pathResample` reported the length of
  // the CURVE it sampled while `lap.s` and `createPolyline` measure the
  // POLYLINE through those samples, shorter by the chord-versus-arc deficit
  // -- 3121.533 against 3121.365 on seed 1, 0.0054%. That difference was
  // not in the noise: `lapLen` decides the station POPULATIONS, so a length
  // 0.0054% out re-lays the whole scatter, and every station came out
  // 0.018585W from where `cookLapPlacements` puts it.
  //
  // THE LENGTHS AGREE NOW, AND THE REASON IS A LIBRARY FIX RATHER THAN A
  // WORKAROUND. `pathResample` publishes `resampledLengthAttr` and
  // `sampleArcAttr` -- the chord length of the polyline it emits, and each
  // sample's own arc along it -- and `graph.ts` takes both, so the frames'
  // `lapLen` IS `lap.lengthW` and their `stationW` IS `lap.s / halfWidth`.
  //
  // AND `lapAsPath` STAYS ANYWAY, WHICH IS WORTH SAYING SO NOBODY REMOVES
  // IT EXPECTING THE ABOVE TO COVER IT. `cookCorners` takes a bare `Lap`,
  // and `tests/racetrackCornerGraph.test.ts` builds circle and stadium laps
  // out of raw arrays with no cook behind them -- there are no frames to
  // hand it. What the fix removed is the DISAGREEMENT, not the
  // reconstruction: this stage could now scatter on `framesIn` directly,
  // and the only thing it would buy is one `dataInput`, at the price of
  // naming the frames' sample arc `arcW` -- which is live scratch in three
  // modules and one rename from meaning two things on one cloud.
  //
  // AND A PATH `dataInput` IS NOT WHAT THIS PORT IS TRYING TO REMOVE.
  // `graph.ts` opens by saying the spline arrives as DATA; a lap the graph
  // is handed is the question, and the placements were the answer. Binding
  // the first has never been the problem.
  let placementsIn: NodeHandle;
  if (placements === undefined) {
    const assetsIn = g.add(dataInput, {}, "assetTable");
    g.setParam(assetsIn, "items", [makeGeometryItem(assetCloud(pool))]);
    const pathIn = g.add(dataInput, {}, "lapPath");
    g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
    // THE LOOKUP TABLE IS THE POOL PLUS THE RESERVED THREE, and it is not
    // `mixAssetsIn`. See `AddLapPlacements`' `tables.lookup`: the redraw's
    // pool must not contain a marker and a converted placement must be able
    // to find one.
    const rows = placementAssetRows(pool, input.markers);
    const lookupIn = g.add(dataInput, {}, "placementAssets");
    g.setParam(lookupIn, "items", [
      makeGeometryItem(placementAssetCloud(rows, lib, immovable, mixPinned)),
    ]);
    const lookupPosesIn = g.add(dataInput, {}, "placementPoses");
    g.setParam(lookupPosesIn, "items", [makeGeometryItem(placementPoseCloud(rows, lib))]);
    placementsIn = addLapPlacements(
      g,
      { node: pathIn, pin: "out" },
      {
        assets: { node: assetsIn, pin: "out" },
        lookup: { node: lookupIn, pin: "out" },
        poses: { node: lookupPosesIn, pin: "out" },
      },
      {
        halfWidth: lap.halfWidth,
        assetCount: pool.length,
        poseIds: mixPoseIds(lib),
        densityScale: input.densityScale,
        language: input.markers ? { markers: input.markers, lap } : undefined,
      },
      "lap",
    ).out;
  } else {
    const handed = g.add(dataInput, {}, "placements");
    g.setParam(handed, "items", [
      makeGeometryItem(
        placementCloudInTrackCoords(placements, lib, seed, immovable, input.mixPinned),
      ),
    ]);
    placementsIn = handed;
  }

  g.output(placementsIn, "out", DRESS_OUTPUTS.placementsInput);

  const body = buildRepairBody(lap, {
    bandPools: mixBandPools(pool, lib, mixPinned),
    poseIds: mixPoseIds(lib),
  });
  const repair = g.add(
    repeatUntilNode(body.graph, body.inputs, body.outputs),
    { maxRounds: MAX_ROUNDS, settleAttr: SETTLE_ATTR },
    "repair",
  );
  // THE FRAME IS LIFTED ONCE, OUTSIDE THE LOOP, because it is a function
  // of the station and no repair moves a placement along the lap. Inside
  // the body it would be a constant recomputed a dozen times over a
  // thousand-frame path.
  g.connect(sampleTrackFrame(g, framesIn, placementsIn, lap.halfWidth, "dress"), "out", repair, "carry");
  g.connect(framesIn, "out", repair, "sight");
  g.connect(mixAssetsIn, "out", repair, "mixAssets");
  g.connect(mixPosesIn, "out", repair, "mixPoses");

  // THE FIRST PASS'S BOXES, which are what L-6 measures against. Named
  // apart from the final ones because they are not the same lap: enclosure
  // has not been added yet, and the whole point of measuring here is to
  // find out how much of it to add.
  const firstBoxes = writeBoxes(
    g,
    posesIn,
    writeCopyScale(g, repair, lap.halfWidth, "dressFirst", "carry"),
    "dressFirst",
  );
  const firstCoverage = writeCoverage(g, framesIn, firstBoxes, lap.halfWidth, "l6first");

  // ---- L-6, BETWEEN THE TWO PASSES ---------------------------------------
  //
  // OUTSIDE THE LOOP AND NOT INSIDE IT, which `buildRepairBody` already
  // argued and this arrangement honours: `placeEnclosure` draws from `seed
  // + rounds`, and a body whose seed varies per round has no fixed point.
  // `PLAN.md` priced the split at one mix move and one cull move per lap on
  // two seeds of six.
  //
  // AND A SECOND REPAIR PASS AFTER IT, because `dressLap` adds cover INSIDE
  // its loop and the rounds that follow repair what it added. Running the
  // loop again over the extended list is that, rescheduled: the same body,
  // the same fixed point, with the cover pieces now in the population the
  // cull and the mix can see. Z-1 leaves them alone on its own -- that is
  // what `PLACEMENT.cover` is for -- so what the second pass actually buys
  // is the cull's verdict on a lap that has tunnels in it.
  const budget = writeCoverBudget(g, firstCoverage, "covered", lap.lengthW, "l6budget");
  const l6Frames = writeCornerTests(g, budget, lap.lengthW, "l6frames");
  const planOpts: PlanOptions = {
    lapW: lap.lengthW,
    halfWidth: lap.halfWidth,
    budgetAttr: BUDGET.budgetW,
    minQuantile: LONG_QUANTILE,
    attempts: L6_ATTEMPTS,
  };
  const coverIn = g.add(dataInput, {}, "coverAssets");
  g.setParam(coverIn, "items", [makeGeometryItem(coverCloud(coverPool, coverPoses))]);
  const coverPosesIn = g.add(dataInput, {}, "coverPoses");
  g.setParam(coverPosesIn, "items", [makeGeometryItem(coverPoseCloud(coverPoses))]);
  const slotsIn = g.add(dataInput, {}, "coverSlots");
  g.setParam(slotsIn, "items", [makeGeometryItem(slotCloud(maxColumns(coverPool)))]);

  const plan = addEnclosurePlan(g, l6Frames, planOpts, "l6");
  const tiled = addEnclosureTiles(
    g,
    l6Frames,
    plan,
    coverIn,
    slotsIn,
    planOpts,
    coverPool.map((a) => a.instances),
    "l6tile",
  );
  const pieces = writeCoverPlacements(g, tiled, mixPoseIds(lib), "l6place");
  g.connect(coverPosesIn, "out", pieces.poses, "source");
  // The frame, on the pieces, exactly as the placement list got it: they
  // arrive holding a station and nothing about the world, which is the
  // whole claim `placementCloudInTrackCoords` makes about a placement.
  const placedPieces = sampleTrackFrame(g, framesIn, pieces.tail, lap.halfWidth, "l6place");

  const merged = g.add(mergePoints, {}, "l6merge");
  // ORDER MATTERS AND IT IS THIS ONE: `mergePoints` concatenates, so the
  // settled placements keep the indices they had and the pieces follow.
  // Nothing downstream depends on that today -- the numbering is redone
  // below -- but a list whose original members move when cover is added
  // would make every before-and-after comparison read as churn.
  g.connect(repair, "carry", merged, "in");
  g.connect(placedPieces, "out", merged, "in");


  // A SECOND BODY, NOT THE SAME ONE TWICE. `repeatUntilNode` injects its
  // portal nodes INTO the graph it is handed, so wrapping one body twice
  // collides on the id it gives the carry pin. Two builds of the same
  // function are the same rules either way -- the body carries no state
  // and no randomness, which `buildRepairBody` says in its own words.
  const secondBody = buildRepairBody(
    lap,
    {
      bandPools: mixBandPools(pool, lib, mixPinned),
      poseIds: mixPoseIds(lib),
    },
    // L-6's TRIM, IN THE SECOND PASS AND NOT THE FIRST. The first settles a
    // lap with no enclosure in it, and the budget the top-up spends is
    // measured from exactly that lap -- so a trim there would move the
    // incidental overhead the budget is sized from, and the top-up would
    // spend a figure describing a lap that no longer existed. This pass is
    // the one that sees the finished list, which is what the ceiling is a
    // statement about.
    true,
  );
  const second = g.add(
    repeatUntilNode(secondBody.graph, secondBody.inputs, secondBody.outputs),
    { maxRounds: MAX_ROUNDS, settleAttr: SETTLE_ATTR },
    "repairWithCover",
  );
  // THE TRIM'S RUNNING TOTALS, STARTED OUTSIDE THE LOOP. A `repeatUntil`
  // body reads them on its first round, before anything has written them;
  // it cannot initialise its own carry, so the wrapper's caller does.
  g.connect(writeTrimInit(g, merged, "l6trim"), "out", second, "carry");
  g.connect(framesIn, "out", second, "sight");
  g.connect(mixAssetsIn, "out", second, "mixAssets");
  g.connect(mixPosesIn, "out", second, "mixPoses");
  // The pose library for the trim's own boxes, and the frames a second
  // time for its ray cast. Both are the clouds this graph already holds.
  g.connect(posesIn, "out", second, "trimPoses");
  g.connect(framesIn, "out", second, "coverPath");

  const boxes = writeBoxes(
    g,
    posesIn,
    writeCopyScale(g, second, lap.halfWidth, "dress", "carry"),
    "dress",
  );
  const coverage = writeCoverage(g, framesIn, boxes, lap.halfWidth, "l6");

  g.output(boxes, "out", DRESS_OUTPUTS.boxes);
  // THE FULLY REPAIRED CLOUD, WHOSE `scale` IS STILL THE ASSET'S OWN BOX.
  // The copy scale is written on a branch of its own so that what this
  // output publishes is a placement — position, orientation, size —
  // rather than an argument to `copyToPoints`.
  //
  // EVERY ONE OF THESE IS THE SECOND PASS'S, and that is the point of
  // there being a second pass: the first one settles a lap that has no
  // enclosure in it yet, so its verdicts are about a population L-6 is
  // still about to change. What a caller wants is the lap as it finished.
  g.output(second, "carry", DRESS_OUTPUTS.placements);
  // The final round's intermediates, which are a settled lap's and so say
  // what the rules did LAST rather than what they did at all. A test that
  // wants a rule's verdict on an unsettled population cooks the body once.
  g.output(second, "placed", DRESS_OUTPUTS.placed);
  g.output(second, "culled", DRESS_OUTPUTS.culled);
  // WHETHER IT SETTLED, AND IN HOW MANY ROUNDS. `dressLap` reports the
  // same two in a stat line; here they are graph outputs, which is the
  // difference between a bounded repair that says it ran out and one whose
  // caller has to know to look.
  //
  // THE COUNT IS THE SECOND PASS'S ALONE and is therefore a FLOOR on the
  // work, not the whole of it -- the first pass's rounds are spent before
  // L-6 has said anything and are not published. `converged` has no such
  // caveat: it is a claim about the lap that came out, and that lap is
  // this one.
  g.output(second, "rounds", DRESS_OUTPUTS.rounds);
  g.output(second, "converged", DRESS_OUTPUTS.converged);
  g.output(repair, "rounds", DRESS_OUTPUTS.roundsFirst);
  g.output(repair, "converged", DRESS_OUTPUTS.convergedFirst);
  g.output(repair, "carry", DRESS_OUTPUTS.placementsFirst);
  g.output(coverage, "out", DRESS_OUTPUTS.coverage);
  g.output(firstCoverage, "out", DRESS_OUTPUTS.coverageFirst);
  return { graph: g };
}

/** What {@link cookBandMix} reads back, one entry per placement. */
export interface BandMixDecision {
  /** The band each placement is in, as the graph's ladder decided. */
  readonly band: Band[];
  /** The band Z-3 says it should join, or undefined where it stays. */
  readonly target: (Band | undefined)[];
}

/**
 * The lap's frames as a graph input, for the two stage cookers.
 *
 * They cook ONE stage rather than the whole graph, so neither has an
 * `assemble` to have added the frames already — and both need them, for
 * {@link sampleTrackFrame}'s reason rather than for their own.
 */
function framesOf(g: Graph, input: DressGraphInput): NodeHandle {
  const n = g.add(dataInput, {}, "lap");
  g.setParam(n, "items", [makeGeometryItem(input.frames)]);
  return n;
}

/**
 * Cook {@link writeBandMix} on its own, over one placement list.
 *
 * THE STAGE RUNS INSIDE A `repeatUntil` BODY AND SO CANNOT BE READ THERE,
 * which is what this exists for. `repeatUntil` hands back its LAST round's
 * outputs, and by the last round a settled lap has nothing left for the
 * mix to say — so a test that read `mixTarget` off the loop would be
 * reading a column of -1 and calling it agreement. Cooking the stage over
 * a list that has NOT been mixed is the only way to compare its verdict
 * against `repairBandMix`'s on the same input.
 *
 * It is also the shape every other decision in this demo is checked in:
 * `cookCorners`, `cookReserveMarkers` and `cookLapPlacements` all cook one
 * stage and read its columns back as plain arrays.
 */
export async function cookBandMix(input: DressGraphInput): Promise<BandMixDecision> {
  const { kit, lap, seed, immovable, mixPinned } = input;
  const placements = requireList(input.placements, "cookBandMix");
  const g = new Graph(seed);
  const cloud = g.add(dataInput, {}, "placements");
  g.setParam(cloud, "items", [
    makeGeometryItem(
      placementCloudInTrackCoords(placements, poseLibrary(kit), seed, immovable, mixPinned),
    ),
  ]);
  // THE DECISION READS NO FRAME -- a band is a fact about a lateral and a
  // height -- and the lift runs anyway so that this cloud has the same
  // COLUMNS the loop's does, and so that its points have distinct
  // identities rather than all sitting at the origin.
  //
  // IT IS NOT THE SAME CLOUD THE LOOP SEES, and the difference is worth
  // naming rather than implying: in the body `P` has been through the
  // lift twice by the time the mix reads it, so it holds a world position
  // and not a centreline one. Nothing here depends on which -- the
  // decision is a function of `trackT` and `trackH` -- but any draw keyed
  // on identity would differ, which is exactly what {@link cookBandRedraw}
  // says about its own.
  const cloud2 = sampleTrackFrame(g, framesOf(g, input), cloud, lap.halfWidth, "z3");
  const mix = writeBandMix(g, cloud2, "z3");
  g.output(mix, "out", "mix");
  const out = (await cook(g)).outputs;
  const geo = requireGeo(out["mix"], "mix");
  const bandCol = geo.attrs.point.require(PLACEMENT.mixBand);
  const targetCol = geo.attrs.point.require(PLACEMENT.mixTarget);
  const band: Band[] = [];
  const target: (Band | undefined)[] = [];
  for (let i = 0; i < placements.length; i++) {
    band.push(MIX_BANDS[bandCol.get(i)] as Band);
    const t = targetCol.get(i);
    target.push(t >= 0 ? (MIX_BANDS[t] as Band) : undefined);
  }
  return { band, target };
}

/** What {@link cookBandRedraw} reads back, one entry per placement. */
export interface BandRedrawResult extends BandMixDecision {
  /** True where the redraw committed — the draw landed in the band asked for. */
  readonly applied: boolean[];
  /** The lateral, height, extents, pose and asset id each placement ended with. */
  readonly t: number[];
  readonly h: number[];
  readonly tall: number[];
  readonly pose: number[];
  readonly asset: string[];
}

/**
 * Cook the decision AND the redraw over one placement list.
 *
 * SEPARATE FROM {@link cookBandMix} BECAUSE THEY ANSWER DIFFERENT
 * QUESTIONS, and the decision's is the one that can be compared against
 * `repairBandMix` exactly. The redraw draws from `randomField` where the
 * reference draws from an integer hash of an array index, so the two pick
 * different assets by construction; what this exists to read back is the
 * POSTCONDITION — that every placement the quota marked came out of the
 * stage in the band it was sent to, holding an asset that reaches there.
 */
export async function cookBandRedraw(input: DressGraphInput): Promise<BandRedrawResult> {
  const { kit, lap, seed, immovable, mixPinned, pool } = input;
  const placements = requireList(input.placements, "cookBandRedraw");
  const lib = poseLibrary(kit);
  const g = new Graph(seed);
  const cloud = g.add(dataInput, {}, "placements");
  g.setParam(cloud, "items", [
    makeGeometryItem(placementCloudInTrackCoords(placements, lib, seed, immovable, mixPinned)),
  ]);
  // NOT OPTIONAL HERE. The redraw's four uniforms are `randomField`, which
  // keys on a point's IDENTITY -- its position -- so over a cloud that has
  // never been lifted every placement draws the same asset.
  const cloud2 = sampleTrackFrame(g, framesOf(g, input), cloud, lap.halfWidth, "z3");
  const mixed = writeBandMix(g, cloud2, "z3");
  const redraw = writeBandRedraw(
    g,
    mixed,
    lap.halfWidth,
    mixBandPools(pool, lib, mixPinned),
    mixPoseIds(lib),
    "z3",
  );
  const assetsIn = g.add(dataInput, {}, "mixAssets");
  g.setParam(assetsIn, "items", [makeGeometryItem(mixAssetCloud(pool, lib, mixPinned, immovable))]);
  g.connect(assetsIn, "out", redraw.assets, "source");
  const posesIn = g.add(dataInput, {}, "mixPoses");
  g.setParam(posesIn, "items", [makeGeometryItem(mixPoseCloud(pool, lib))]);
  g.connect(posesIn, "out", redraw.poses, "source");
  g.output(redraw.tail, "out", "mix");

  const geo = requireGeo((await cook(g)).outputs["mix"], "mix");
  const pts = geo.attrs.point;
  const bandCol = pts.require(PLACEMENT.mixBand);
  const targetCol = pts.require(PLACEMENT.mixTarget);
  const commit = pts.require(MIX.commit);
  const tCol = pts.require(PLACEMENT.t);
  const hCol = pts.require(PLACEMENT.h);
  const tallCol = pts.require(PLACEMENT.sizeTall);
  const poseCol = pts.require(PLACEMENT.pose);
  const assetCol = pts.require(PLACEMENT.asset);
  const band: Band[] = [];
  const target: (Band | undefined)[] = [];
  const applied: boolean[] = [];
  const t: number[] = [];
  const h: number[] = [];
  const tall: number[] = [];
  const pose: number[] = [];
  const asset: string[] = [];
  for (let i = 0; i < placements.length; i++) {
    band.push(MIX_BANDS[bandCol.get(i)] as Band);
    const d = targetCol.get(i);
    target.push(d >= 0 ? (MIX_BANDS[d] as Band) : undefined);
    applied.push(commit.get(i) !== 0);
    t.push(tCol.get(i));
    h.push(hCol.get(i));
    tall.push(tallCol.get(i));
    pose.push(poseCol.get(i));
    asset.push(assetCol.getString(i));
  }
  return { band, target, applied, t, h, tall, pose, asset };
}

/** L-6's numbers, as {@link readEnclosure} reads them off a cook. */
export interface EnclosureReport {
  /** Per lap frame: is it under cover? */
  readonly covered: boolean[];
  /** Per lap frame: how many of the six rays hit anything. */
  readonly hits: Uint32Array;
  /** Covered arc length over lap length. */
  readonly share: number;
  /** The same, before L-6 added anything -- see `DRESS_OUTPUTS.coverageFirst`. */
  readonly shareBefore: number;
  /** How many cover pieces L-6 built, and how many runs they tile. */
  readonly coverPieces: number;
  readonly coverStretches: number;
  /**
   * L-6's TRIM: how many placements it moved, and off how many runs.
   *
   * THE OTHER HALF OF THE RULE, and the one that reports zero on every lap
   * the shipped vocabulary can dress -- measured, seeds 1-8 at density 1,
   * 2 and 3 reach at most 20.0% against a 25% ceiling, so the trim has
   * nothing to do. It is reported anyway, because a rule that is only ever
   * seen not firing is a rule nobody can tell from a rule that is missing.
   */
  readonly trims: number;
  readonly runsTrimmed: number;
  /**
   * Why the trim stopped, as the last repair round left it.
   *
   * BOTH FALSE IS THE ORDINARY ANSWER and means the ceiling was never
   * breached. `blocked` means Z-3's floor refused a run the trim wanted;
   * `nothingToTrim` means there was no candidate at all -- the lap's
   * overhead is all L-6's own deliberate cover, or there is none. The two
   * send a reader to different places, which is why `reduceEnclosure`
   * splits them and why this does too.
   */
  readonly blocked: boolean;
  readonly nothingToTrim: boolean;
}

/**
 * L-6's numbers, given the outputs of a cook of this graph.
 *
 * EXPORTED BECAUSE THE PAGE DOES NOT COOK THIS GRAPH -- IT STREAMS IT.
 * {@link dressLapByGraph} cooks and returns, so its caller has the figures
 * on the next line; `demos/racetrack/main.ts` hands the SAME graph to a
 * `World` as the lap LEVEL and gets its outputs back in `onCellReady`,
 * later and on another turn. Both want the same four numbers out of the
 * same three outputs, so the reading lives here rather than in either
 * caller -- a page that re-derived it would be a second definition of
 * "covered arc over lap length", and the whole value of the before/after
 * pair is that a figure read off the panel is comparable with one read off
 * a test. `tests/racetrackLevels.test.ts` pins the two schedules equal.
 *
 * IT READS THE RECORD AND THE LAP AND NOTHING ELSE, which is what makes it
 * usable from a cell. A caller holding `CellOutputs` has no
 * {@link DressGraphInput} to fall back on, so anything this needed from the
 * input would be a number the page could not produce.
 */
export function readEnclosure(
  outputs: Readonly<Record<string, DataCollection | undefined>>,
  lap: Lap,
): EnclosureReport {
  const coverage = requireGeo(outputs[DRESS_OUTPUTS.coverage], DRESS_OUTPUTS.coverage);
  const coverageFirst = requireGeo(
    outputs[DRESS_OUTPUTS.coverageFirst],
    DRESS_OUTPUTS.coverageFirst,
  );
  const placements = requireGeo(outputs[DRESS_OUTPUTS.placements], DRESS_OUTPUTS.placements);

  const coveredAttr = coverage.attrs.point.require("covered");
  const hitsAttr = coverage.attrs.point.require("coverHits");
  const covered = new Array<boolean>(lap.count);
  const hits = new Uint32Array(lap.count);
  for (let i = 0; i < lap.count; i++) {
    covered[i] = coveredAttr.get(i) !== 0;
    hits[i] = hitsAttr.get(i);
  }

  // COVERED ARC OVER LAP LENGTH, summed in frame order.
  //
  // `measureEnclosure` sums the same lengths GROUPED INTO RUNS, because
  // it also reports how long each run is and how much of the cover sits
  // in the heavy tail. The two totals are the same numbers added in a
  // different order, so they agree to a few f64 ulps and not exactly —
  // which is worth knowing rather than worth chasing, since the quantity
  // is a share of a lap and nobody reads its sixteenth digit. What is NOT
  // an ordering difference is the mask, and that is compared frame by
  // frame in the test.
  let arcW = 0;
  for (let i = 0; i < lap.count; i++) {
    if (covered[i]) arcW += (lap.s[i + 1] - lap.s[i]) / lap.halfWidth;
  }

  // THE SAME SUM OVER THE PASS BEFORE ENCLOSURE, so that what L-6 did is
  // a difference rather than a number a reader has to take on trust.
  const firstCoveredAttr = coverageFirst.attrs.point.require("covered");
  let arcBeforeW = 0;
  for (let i = 0; i < lap.count; i++) {
    if (firstCoveredAttr.get(i) !== 0) arcBeforeW += (lap.s[i + 1] - lap.s[i]) / lap.halfWidth;
  }

  // AND WHAT IT BUILT: pieces, and the runs they were tiled from. A run is
  // identified by its start station, which is unique because the planner
  // keeps runs `separationW` apart.
  const coverCol = placements.attrs.point.require(PLACEMENT.cover);
  const runCol = placements.attrs.point.require(PLACEMENT.coverRun);
  const runs = new Set<number>();
  let coverPieces = 0;
  for (let i = 0; i < placements.attrs.point.count; i++) {
    if (coverCol.get(i) <= 0) continue;
    coverPieces++;
    runs.add(runCol.get(i));
  }

  // AND WHAT THE TRIM DID. `trimmed` is a per-placement flag and
  // `runsTrimmed` is a broadcast -- the same number on every point -- so
  // one is a sum and the other is a read. Both are written by every round
  // of the second repair pass, so what survives here is the last round's,
  // which is the finished lap's.
  const trimmedCol = placements.attrs.point.require(TRIM.trimmed);
  let trims = 0;
  for (let i = 0; i < placements.attrs.point.count; i++) {
    if (trimmedCol.get(i) !== 0) trims++;
  }
  // A LAP WITH NO PLACEMENTS HAS NO BROADCAST TO READ, which is not a
  // failure: the three below are facts about a trim that never ran.
  const any = placements.attrs.point.count > 0;

  return {
    covered,
    hits,
    share: arcW / lap.lengthW,
    shareBefore: arcBeforeW / lap.lengthW,
    coverPieces,
    coverStretches: runs.size,
    trims,
    runsTrimmed: any ? placements.attrs.point.require(TRIM.runsTrimmed).get(0) : 0,
    blocked: any && placements.attrs.point.require(TRIM.blocked).get(0) !== 0,
    nothingToTrim: any && placements.attrs.point.require(TRIM.nothing).get(0) !== 0,
  };
}

/**
 * Which poses belong to L-2's markers and which to L-3's ruler mark.
 *
 * THE PLACEMENT CLOUD CARRIES NO ASSET ORD, only {@link PLACEMENT.pose}
 * and a pose-keyed string, so a caller counting a vocabulary has to come
 * at it from the library. `posesOf` is asset -> poses; this is the two
 * sets that inversion is wanted for, built once per lap rather than per
 * placement.
 *
 * L-2 IS TWO ASSETS AND L-3 IS ONE, which is the whole reason they are
 * separate sets rather than one: the panel line says what each rule
 * placed, and a marker and a braking mark are different claims about the
 * lap. `reserveMarkers` holds back exactly these three.
 */
export function languagePoses(
  lib: PoseLibrary,
  markers: MarkerKit,
): { readonly markerPoses: ReadonlySet<number>; readonly rulerPoses: ReadonlySet<number> } {
  const of = (id: number): number[] => lib.posesOf.get(id) ?? [];
  return {
    markerPoses: new Set([...of(markers.sharp.id), ...of(markers.open.id)]),
    rulerPoses: new Set(of(markers.brake.id)),
  };
}

/** What the repairs did, as {@link readRepairs} can honestly report it. */
export interface RepairReport {
  /**
   * How many rounds each repair pass ran, and whether the second settled.
   *
   * THESE REPLACED A `pushed` AND A `lowered` THAT WERE ALWAYS ZERO, and
   * the reason is worth keeping because the fields looked perfectly
   * reasonable. Both were counts of a per-placement flag on the finished
   * carry -- `PLACEMENT.pushW` where L-1 shoved something,
   * `PLACEMENT.drop` where L-5 lowered it. But `writeSettleCount` stops
   * the loop exactly when `max(corridorMoved, mixCommit, pushW != 0,
   * drop)` sums to zero over every point, and both columns are REWRITTEN
   * unconditionally each round rather than accumulated. So on a lap that
   * converged, the last round moved nothing, and the two counts are zero
   * BY CONSTRUCTION -- they carried exactly the one bit `converged`
   * already carries, and read on the panel as "L-1 pushed nothing", which
   * is false about the lap.
   *
   * THE ROUND COUNTS ARE WHAT A REPAIR LINE ACTUALLY WANTS. They are
   * synthesized by `repeatUntil` itself rather than folded out of the
   * body's columns, which is why they survive the same argument: the body
   * cannot see how many times it has run, so nothing in it can overwrite
   * them. `converged` false is not a failed cook -- it means some rule is
   * still unsatisfied and the cap stopped the search, which is a fact the
   * caller decides what to do with.
   *
   * BOTH PASSES, APART. The first runs before L-6 has added anything and
   * is the only figure comparable with a reference loop over the same
   * list; the second is what the lap that came OUT cost to settle.
   */
  readonly roundsFirst: number;
  readonly roundsSecond: number;
  readonly converged: boolean;
  /**
   * How many the cull removed, EXACTLY, across every round.
   *
   * THIS ONE IS A TOTAL AND NEEDS NO CARRY, because it is a difference
   * between two published lists rather than a flag: the first pass only
   * ever shrinks, so the count that entered it minus the count that left
   * it is the whole of what L-1 dropped however many rounds it took.
   */
  readonly dropped: number;
  /** The list as the assembly built it, and as the first pass left it. */
  readonly assembled: number;
  readonly settledFirst: number;
  /**
   * L-2's markers and L-3's marks: how many were PLACED, and how many
   * survived the cull.
   *
   * COUNTED OFF THE CLOUDS RATHER THAN REPORTED BY THE STAGE, and that is
   * a better measurement than the one it replaces. `dressLap` derives its
   * equivalent by running `legibilityHealth` before and after the loop and
   * subtracting -- a check of whether every corner still HAS a marker,
   * which answers "is the rule satisfied" and only approximates "how many
   * went". This counts the vocabulary on the two lists, which is the
   * quantity the panel line claims to be showing.
   *
   * WHAT IT CANNOT SAY is L-2's converted/added split. A conversion and an
   * addition leave the same marker on the same list; the difference lives
   * in the bookkeeping stage and not in the cloud it produces. The panel
   * prints the total and does not pretend to the split.
   *
   * ZERO WITH NO {@link MarkerKit}, which is a real lap and not a missing
   * reading: `reserveMarkers` reports no kit when the vocabulary has fewer
   * than three verticals to hold back, and such a lap has no corner
   * language on it to count.
   */
  readonly markersPlaced: number;
  readonly markersKept: number;
  readonly rulersPlaced: number;
  readonly rulersKept: number;
}

/**
 * The repairs' numbers, off the same outputs {@link readEnclosure} reads.
 *
 * EXPORTED FOR THAT FUNCTION'S REASON, WHICH IS SCHEDULING. The page does
 * not cook this graph, it streams it, so every figure on its panel has to
 * be derivable from a cell's outputs. Anything the page derived for itself
 * would be a second definition of a number a test also reads, and the
 * point of publishing them at all is that the two are comparable.
 *
 * IT IS ALSO WHAT MAKES THE PRELUDE DELETABLE. The two panel lines that
 * still read `DressStats` are the last thing on this page that needs
 * `dressLap` to have run, and most of `DressStats` cannot come back: five
 * of its fields are rules this graph does not contain (D-4's second pass,
 * L-4) and the per-round counters are not what `repeatUntil` publishes.
 * What CAN be said honestly is this, and the fields say which is which.
 */
export function readRepairs(
  outputs: Readonly<Record<string, DataCollection | undefined>>,
  language?: {
    readonly markerPoses: ReadonlySet<number>;
    readonly rulerPoses: ReadonlySet<number>;
  },
): RepairReport {
  const placementsFirst = requireGeo(
    outputs[DRESS_OUTPUTS.placementsFirst],
    DRESS_OUTPUTS.placementsFirst,
  );
  const placementsInput = requireGeo(
    outputs[DRESS_OUTPUTS.placementsInput],
    DRESS_OUTPUTS.placementsInput,
  );

  const count = (geo: Geometry, poses: ReadonlySet<number>): number => {
    if (poses.size === 0) return 0;
    const poseCol = geo.attrs.point.require(PLACEMENT.pose);
    let n = 0;
    for (let i = 0; i < geo.pointCount; i++) {
      if (poses.has(poseCol.get(i))) n++;
    }
    return n;
  };
  const none: ReadonlySet<number> = new Set<number>();
  const markerPoses = language?.markerPoses ?? none;
  const rulerPoses = language?.rulerPoses ?? none;

  return {
    roundsFirst: requireNumber(outputs[DRESS_OUTPUTS.roundsFirst], DRESS_OUTPUTS.roundsFirst),
    roundsSecond: requireNumber(outputs[DRESS_OUTPUTS.rounds], DRESS_OUTPUTS.rounds),
    converged: requireNumber(outputs[DRESS_OUTPUTS.converged], DRESS_OUTPUTS.converged) !== 0,
    // AGAINST THE PASS THAT ONLY EVER SHRANK. Measuring this against the
    // FINAL list gave a NEGATIVE count once L-6 was wired in -- -11 to -16
    // on a bare lap -- because the final list has enclosure ADDED to it,
    // and no arithmetic over a list that grew can say how much of it went.
    dropped: placementsInput.pointCount - placementsFirst.pointCount,
    assembled: placementsInput.pointCount,
    settledFirst: placementsFirst.pointCount,
    // PLACED IS COUNTED ON THE INPUT LIST AND KEPT ON THE FIRST PASS, not
    // on the final one, for `dropped`'s reason: L-6 adds pieces after it,
    // and a marker cannot be one -- but the pass boundary is where the
    // cull's verdict was reached, and taking both counts from the same
    // side of it is what makes the difference mean "the cull took these".
    markersPlaced: count(placementsInput, markerPoses),
    markersKept: count(placementsFirst, markerPoses),
    rulersPlaced: count(placementsInput, rulerPoses),
    rulersKept: count(placementsFirst, rulerPoses),
  };
}

/** The one async thing here: build, cook, and read the columns back. */
export async function dressLapByGraph(input: DressGraphInput): Promise<GraphDressing> {
  const t0 = performance.now();
  const { graph } = assemble(input);
  const out = (await cook(graph)).outputs;

  const boxes = requireGeo(out[DRESS_OUTPUTS.boxes], DRESS_OUTPUTS.boxes);
  const placed = requireGeo(out[DRESS_OUTPUTS.placed], DRESS_OUTPUTS.placed);
  const culled = requireGeo(out[DRESS_OUTPUTS.culled], DRESS_OUTPUTS.culled);
  const placements = requireGeo(out[DRESS_OUTPUTS.placements], DRESS_OUTPUTS.placements);
  const placementsFirst = requireGeo(
    out[DRESS_OUTPUTS.placementsFirst],
    DRESS_OUTPUTS.placementsFirst,
  );
  const placementsInput = requireGeo(
    out[DRESS_OUTPUTS.placementsInput],
    DRESS_OUTPUTS.placementsInput,
  );
  // L-6, THROUGH THE SAME READER THE PAGE USES. Everything it reports is
  // in the outputs, so this is a call rather than fifty lines a level
  // consumer would have to keep its own copy of.
  const enclosure = readEnclosure(out, input.lap);

  // THE SAME READING THE PAGE TAKES OFF ITS CELL. `pushed`, `dropped` and
  // `lowered` were derived here by hand until the panel needed them from a
  // stream; they are {@link readRepairs} now for {@link readEnclosure}'s
  // reason, so a figure read off the panel is comparable with one read off
  // a test rather than merely resembling it.
  //
  // NO `language` HERE, so the four corner-language counts come back zero.
  // That is not a reading this function is refusing to take: the marker
  // POSES are what the count needs and `input.markers` is optional, so a
  // caller wanting them passes them to {@link readRepairs} itself. Nothing
  // in the suites asks `dressLapByGraph` for them.
  const repairs = readRepairs(out);

  return {
    boxes,
    placed,
    culled,
    placements,
    ...enclosure,
    ...repairs,
    // BOTH PASSES, SUMMED, because that is what the cook actually spent.
    // The two are published apart so a caller can tell which half a lap's
    // cost came from; a stat line wants the total.
    placementsFirst,
    placementsInput,
    rounds: repairs.roundsFirst + repairs.roundsSecond,
    stamped: boxes.pointCount,
    graph,
    cookMs: performance.now() - t0,
  };
}

/**
 * One number off a value output.
 *
 * The loop reports `rounds` and `converged` as value items rather than as
 * columns, because neither is a fact about a placement — see
 * {@link DRESS_OUTPUTS}. `converged` arrives as 0 or 1: a value item holds
 * a number, and a boolean that travelled as a number is still the answer.
 */
function requireNumber(collection: DataCollection | undefined, name: string): number {
  for (const item of collection ?? []) {
    if (item.kind === "value" && typeof item.value === "number") return item.value;
  }
  throw new Error(`dressGraph: output "${name}" carried no number`);
}

function requireGeo(collection: DataCollection | undefined, name: string): Geometry {
  const geo = firstGeometry(collection ?? []);
  if (!geo) throw new Error(`dressGraph: output "${name}" carried no geometry`);
  return geo;
}

/**
 * L-6's pieces, given the columns that make them placements.
 *
 * WHAT A TILE IS SHORT OF, and it is not much: the tiler already writes a
 * station, a lateral and a height, which is where a placement sits. What
 * it does not carry is the bookkeeping every other placement has -- the
 * asset's own extents, the flags the repairs read, and the asset id
 * string a spawner groups by.
 *
 * THE COVER FLAG IS THE WHOLE OF THE SPECIAL CASE, which is worth saying
 * because it looks as though there should be more. Setting it to 1 makes
 * Z-1 leave the piece alone (it is already clear of the corridor by
 * construction, which is what `coverBaseH` computed), keeps the band mix
 * from redrawing it, and selects the `cover:` half of the asset id table.
 * Three rules, one column, and none of them needed a branch adding for
 * enclosure.
 *
 * THE POSE IS DRAWN ONCE PER RUN, not once per piece, and that is a rule
 * rather than an economy: "a tunnel is the same segment repeated; varying
 * the shape along it reopens the seams the overlap was added to close",
 * measured at a 17W covered stretch falling back to 8W when poses were
 * drawn per piece. Keyed on the run's own start, so every piece of one run
 * draws the same number and two runs draw independently.
 */
function writeCoverPlacements(
  g: Graph,
  tiles: NodeHandle,
  poseIds: readonly string[],
  tag: string,
): { readonly tail: NodeHandle; readonly poses: NodeHandle } {
  // The raw draw, then the asset's own pose list indexed by it. This is
  // `poseFor`'s arithmetic -- `ids[k % ids.length]` -- with the modulo
  // written out, and it is the same shape Z-3's redraw uses to give a
  // replacement a pose from a different asset's list.
  //
  // `floor(u * 1024) % n` IS BIASED WHENEVER n DOES NOT DIVIDE 1024, and
  // it is kept because it is the REFERENCE's bias rather than one
  // introduced here: `coverPlacements` draws `floor(rand * 1024)` into
  // `p.pose` and `poseFor` then answers `ids[p.pose % ids.length]`. Drawing
  // `floor(u * n)` would be uniform and would be a different rule. Inert on
  // the shipped kit, where every cover candidate has exactly one pose.
  const drawn = g.add(
    setAttribute,
    {
      name: SCRATCH_POSE,
      tupleSize: 1,
      value: floor(mul(randomFrom(attribute(PLAN.startW), "l6.pose"), 1024)),
    },
    `${tag}_poseDraw`,
  );
  g.connect(tiles, "out", drawn, "in");

  const row = g.add(
    setAttribute,
    {
      name: SCRATCH_POSE,
      tupleSize: 1,
      // A CANDIDATE THE KIT RECORDED NO POSE FOR IS SENT TO ROW -1, not to
      // its own offset. The first draft floored the count at one and let
      // the modulo produce 0, which indexes `poseOff` exactly -- the NEXT
      // candidate's first pose, a real pose id belonging to a different
      // asset, drawn at this one's extents. The comment claimed it was
      // "refused downstream by name" and nothing refused it. Unreachable on
      // the shipped kit, where both candidates have one pose each, and a
      // silent wrong answer on any kit where it is not.
      //
      // Row -1 misses the gather under `clamp` and leaves `poseId` at the
      // table's own -1 default, which `poseAssetId` turns into
      // `cover:pose:-1` -- a name no asset map has, so it fails loudly.
      value: select(
        le(attribute(COVER_ASSET.poseCount), 0),
        -1,
        add(
          attribute(COVER_ASSET.poseOff),
          mod(attribute(SCRATCH_POSE), max(1, attribute(COVER_ASSET.poseCount))),
        ),
      ),
    },
    `${tag}_poseRow`,
  );
  g.connect(drawn, "out", row, "in");

  const posed = g.add(
    transferByIndex,
    { index: attribute(SCRATCH_POSE), attributes: [COVER_ASSET.poseId], outOfRange: "clamp" },
    `${tag}_pose`,
  );
  g.connect(row, "out", posed, "in");

  let out: NodeHandle = posed;
  const writes: [string, Field | number][] = [
    [PLACEMENT.pose, attribute(COVER_ASSET.poseId)],
    // THE ASSET'S OWN EXTENTS, not the floored ones the tiling used.
    [PLACEMENT.sizeAcross, attribute(COVER_ASSET.rawAcross)],
    [PLACEMENT.sizeAlong, attribute(COVER_ASSET.rawAlong)],
    [PLACEMENT.sizeTall, attribute(COVER_ASSET.tallW)],
    [PLACEMENT.cover, 1],
    // NOT LOCKED AND NOT PINNED: the first is L-3's braking mark and the
    // second is the mix's protect set, and cover is neither -- it is
    // excluded from the mix by its own flag, which is a different thing
    // from being protected within it.
    [PLACEMENT.locked, 0],
    [PLACEMENT.mixPinned, 0],
    [PLACEMENT.mixTried, 0],
    // WHICH RUN THIS PIECE BELONGS TO, kept rather than stripped with the
    // rest of the planner's columns. A run is a fact about a piece and not
    // scratch: it is what lets a caller say "three tunnels" instead of
    // "forty-one pieces", which is the number a reader of the lap cares
    // about. Its value is the run's start station, which is unique because
    // the clash test keeps runs `separationW` apart.
    [PLACEMENT.coverRun, attribute(PLAN.startW)],
    // `PLACEMENT.poseU` IS DELIBERATELY NOT HERE, and it is the one column
    // a piece lacks that the body reads. It arrives 0 through the merge's
    // default and is consumed only where `mixTarget >= 0`, which cover
    // never reaches -- the mix's `include` excludes it. So it is inert
    // today and it is the single thing to write first if cover is ever
    // made mix-eligible.
    // A NEGATIVE ID, COUNTING DOWN FROM -2, and the first draft renumbered
    // the MERGED list instead, which was a real defect. `PLACEMENT.id` is
    // "where this placement sat in the list the graph was handed" -- that
    // is what the cull's own reporting subtracts against -- and rewriting
    // it after a pass that has already dropped members makes every
    // surviving placement name the wrong entry. Measured on seed 5, 337 of
    // the survivors pointed at the wrong input row, the worst 9.4W away,
    // and it happened on laps where L-6 added nothing at all. So the
    // originals keep the numbers they came in with.
    //
    // WHAT CHANGED IS THE NUMBER A PIECE GETS. It used to be
    // `inputCount + index()`, the next one after the list -- which needed
    // the list's LENGTH at graph-build time, and once the list is something
    // the graph decides there is no such number to have. Counting down from
    // -2 needs nothing: it is unique, it is ordered, and it is read the only
    // way this column is ever read, as set membership -- the accounting in
    // `readDressing` asks WHO survived, never what the number is worth.
    //
    // AND IT IS THE MORE TRUTHFUL OF THE TWO. `inputCount + index()` looks
    // like a row of the input list and is not one; -2 cannot be mistaken for
    // a row of anything. -1 is left alone because this file already spends
    // it on "no such thing" in three other columns.
    [PLACEMENT.id, sub(-2, index())],
  ];
  for (const [name, value] of writes) {
    const n = g.add(setAttribute, { name, tupleSize: 1, value }, `${tag}_w_${name}`);
    g.connect(out, "out", n, "in");
    out = n;
  }

  const half = poseIds.length / 2;
  const named = g.add(
    setAttribute,
    {
      name: PLACEMENT.asset,
      tupleSize: 1,
      type: "string",
      values: poseIds as string[],
      // The cover half, chosen by the same expression the redraw uses --
      // `pose + 1` past the -1 row, plus the half-table offset.
      //
      // AND THE REDRAW IS WHAT ACTUALLY LANDS. `writeBandRedraw` re-derives
      // this column from the pose on EVERY round, for every point, so what
      // this write does is make the merge well-formed -- give the pieces
      // the column the settled side has, so a piece is never nameless even
      // for one stage -- rather than name them. Mutating it is invisible;
      // mutating the redraw's is caught. Kept because a column filled by a
      // default is a column somebody will read before the loop one day,
      // and stated because an untestable write looks like a defect.
      value: add(add(attribute(PLACEMENT.pose), 1), half),
    },
    `${tag}_assetId`,
  );
  g.connect(out, "out", named, "in");

  const cleaned = g.add(
    removeAttribute,
    {
      names: [
        SCRATCH_POSE,
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
        COVER_ASSET.poseId,
        PIECE.slot,
        PIECE.tile,
        PIECE.tiles,
        PIECE.ramp,
        PLAN.startW,
        PLAN.lengthW,
      ],
      // A tile carries every one of these, but the list is long and a
      // rename upstream should not take a cook down over a strip.
      strict: false,
    },
    `${tag}_strip`,
  );
  g.connect(named, "out", cleaned, "in");
  return { tail: cleaned, poses: posed };
}
