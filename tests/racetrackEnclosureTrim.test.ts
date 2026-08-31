/**
 * L-6's TRIM, ported into the graph, held to the rule it ports.
 *
 * WHAT `writeCoverTrim` IS: ONE PASS of `reduceEnclosure`. That function
 * loops up to six times and re-measures between passes; the stage is the
 * body of that loop, and the loop it lives in is the repair loop. So the
 * subject here is a PASS, and everything in this file is arranged so that a
 * pass can be compared against a pass.
 *
 * THE REFERENCE IS TRANSCRIBED RATHER THAN CALLED, and that is the whole
 * design of this suite. Comparing the stage against `reduceEnclosure`
 * directly would compare a single pass against a fixed point, which cannot
 * be done without either weakening the claim or re-implementing the loop in
 * the assertion. So {@link referencePass} states the rule ONE PASS AT A TIME
 * — the trimmable predicate, the sort, the first affordable run, the lateral
 * — from `tunnels.ts`'s source, and {@link iterateReference} then drives it
 * to a fixed point and is pinned against `reduceEnclosure` itself. That pin
 * is what makes the hand-written pass trustworthy: if the transcription
 * drifted, the fixed point would stop agreeing with the shipped rule, and
 * the port would then be measured against a reference nobody had checked.
 *
 * THE GRAPH IS COOKED TWICE, WITH THE TRIM OFF AND ON, and the comparison is
 * between those two. The trim is the LAST stage of the repair body, so the
 * carry a trim-off round publishes IS the population the trim would have
 * seen — Z-1's laterals, L-1's survivors, L-5's lift, Z-3's mix, all already
 * applied. Running the reference over the list handed to `buildRoundGraph`
 * instead would ask the rule about a population the graph never had, and
 * every disagreement the other four rules produced would be reported as a
 * trim defect. Two cooks are much cheaper than that ambiguity.
 *
 * THE FIXTURE IS CONSTRUCTED, AND IT HAS TO BE. No lap the shipped
 * vocabulary can dress reaches L-6's ceiling — `buildRoundGraph`'s own note
 * measures every seed and density it can draw topping out well under 25% —
 * so a suite that only cooked real laps would be green for a trim that had
 * been deleted. Seed 1's real dressing plus ten wide overhead pieces reaches
 * 34.6%, which is where the rule can be held to anything at all. The last
 * case in this file is the other half of that argument: the same stage over
 * the same lap WITHOUT the band must do nothing, or the trim is not a
 * repair, it is a rule.
 *
 * THE 34.6% USED TO READ 31.3%, and the difference is the dressing rather
 * than the band: Z-3's donor order changed on 2026-08-28, the dressing's
 * overhead landed on different assets, and the incidental enclosure under it
 * moved with them. The band is the same ten pieces it always was. The
 * argument is untouched — the fixture is over the ceiling either way, and by
 * more than before — but the number is a measurement and had to be retaken
 * rather than carried over.
 *
 * AND THERE IS ONE MORE PIECE IN IT THAN THERE WAS: see {@link overEnclosed}
 * for the twin, and for what stopped being true when the dressing moved.
 *
 * THE BAND BREAKS L-4 AND THAT IS FINE. `block-87` has `instances: 1`, so
 * ten copies of it are ten violations of landmark uniqueness. Nothing here
 * asserts anything about landmarks: this is an ENCLOSURE fixture, chosen for
 * the one property that matters, which is that it puts a third of the lap
 * under a roof.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  cook,
  createPointCloud,
  dataInput,
  firstGeometry,
  makeGeometryItem,
  pointsToPath,
  type Geometry,
  type NodeHandle,
} from "pcg-ts";
import {
  DRESS_OUTPUTS,
  PLACEMENT,
  buildRoundGraph,
  type DressGraphInput,
} from "../demos/racetrack/dressGraph.js";
import { TRIM, writeCoverTrim, writeTrimInit } from "../demos/racetrack/enclosureGraph.js";
import { ENCLOSE, reduceEnclosure } from "../demos/racetrack/tunnels.js";
import { measureEnclosure } from "../demos/racetrack/enclosure.js";
import { buildBoxes } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { CORRIDOR, OVERHEAD } from "../demos/racetrack/zones.js";
import { Z3, type PlaceableAsset } from "../demos/racetrack/assets.js";
import { reserveMarkers, type StationedPlacement } from "../demos/racetrack/legibility.js";
import type { Lap } from "../demos/racetrack/lap.js";
import { dressedLapFor } from "./support/lap.js";

/**
 * How long a case here may take.
 *
 * COOKING A LAP IS NOT A FIVE-SECOND OPERATION, which is vitest's default.
 * Every case in this file cooks the road graph (memoized, so once per
 * process), dresses it, then cooks one or two repair rounds — each of which
 * stamps the pose library over three hundred placements and casts six rays
 * from nine hundred frames — and the heaviest also runs `reduceEnclosure` to
 * its fixed point, which is a box rebuild and a full cast per pass.
 *
 * A TIMEOUT IS NOT A TOLERANCE: this is far enough above what was observed
 * that machine load decides nothing, which is the only property a timeout
 * should have.
 */
const LAP_MS = 120_000;

/** The seed every case runs on — the lap `tests/support/lap.ts` memoizes. */
const SEED = 1;

/**
 * The piece the band is built from: `block-87`, 5.10W across.
 *
 * WIDE ON PURPOSE. The ray cast wants three of six rays blocked before it
 * calls a frame covered, and the corridor is 2W across; a piece narrower
 * than that roofs a frame only in company. One wide piece per station is
 * what makes ten of them worth 23.6 points of enclosure share — seed 1's
 * own dressing measures 11.0% and the fixture 34.6% — which is the margin
 * the whole fixture rests on.
 *
 * THE FIGURE USED TO READ 11 POINTS AND THAT WAS ALREADY STALE when it was
 * re-measured on 2026-08-28: the two shares either side of it were 9.1% and
 * 31.3%, a gap of 22.2, so the band has been worth twice what this sentence
 * claimed for some time. Both ends moved again with Z-3's donor order and
 * both were retaken together. What the number is FOR has not changed — it is
 * the headroom that keeps the fixture over L-6's ceiling — and the headroom
 * is larger than the sentence ever promised.
 */
const BAND_PIECE_ID = 161;

/**
 * Where the band sits, in W above the surface.
 *
 * ITS BASE HAS TO CLEAR THE CORRIDOR, AND THAT IS NOT A DETAIL — it is the
 * difference between a fixture and nothing at all. `block-87` is 4.14W tall,
 * so a centre at 3.24W puts its BASE at 1.17W, three hundredths under
 * `CORRIDOR.ceilingW`. Z-1 calls that a corridor conflict, and `block-87` is
 * large art, so the rule stands it off to `1 + across/2` = 3.55W — off the
 * road entirely, before the trim has been reached. Re-measured 2026-08-28:
 * the round then hands the trim a lap at 12.3% enclosure with the band
 * parked on the verge, and the stage correctly does nothing. A fixture that
 * dissolves in the stage ahead of the one being tested is not a fixture.
 *
 * IT READ 10.6% BEFORE Z-3'S DONOR ORDER CHANGED, and the point is that
 * the figure is the DRESSING's own enclosure with the band contributing
 * nothing — so it moved for the same reason the ordinary lap's 11.0% did,
 * and it is still less than half of L-6's ceiling, which is the only thing
 * the sentence asks of it.
 *
 * 3.3W PUTS THE BASE AT 1.2302W, clear of the ceiling by a hundredth, so
 * Z-1 returns it untouched and it arrives at the trim where it was put: over
 * the road, inside `isTrimmable`'s window, roofing the lap. The reference
 * measurements below are taken at this height for the same reason — one
 * fixture, measured once, used by every case here.
 */
const BAND_H = 3.3;

/** Ten pieces, evenly spaced — enough roof to clear the ceiling by 9.6 points. */
const BAND_COUNT = 10;

/**
 * The bound on a lateral the two sides computed independently.
 *
 * The graph stores `trackT` f32 and the reference computes it f64. The move
 * is `1.5 + across/2`, which for the band is 4.05W, where the f32 spacing is
 * about 5e-7. 1e-5 clears that by twenty times and is four orders below
 * `ENCLOSE.coverW` — so no value this bound admits could be a placement on
 * the wrong side of the cover span, which is the only thing the number is
 * ever asked.
 */
const TRACK_TOL = 1e-5;

/**
 * How far apart two run lengths may be and still be ONE choice to the graph.
 *
 * THE ONE PLACE THE PORT AND THE RULE CAN DIVERGE, MEASURED. The trim takes
 * the SHORTEST covered run, and the two sides compute a run's length by
 * different arithmetic: `measureEnclosure` sums each frame's arc in f64 over
 * a list it builds in racing order, and the stage sums an f32 column with
 * `pathRuns`, forward and backward, and subtracts the frame counted twice.
 * On the third trimming round of the chained case below that put two runs at
 * 2.697621W and 2.697623W — a gap of 1.72e-6W, about seven f32 ulps at that
 * magnitude — and the f32 sums ordered them the other way round. The
 * reference opened the run at station 15.80, holding placement 10; the graph
 * opened the one at 53.95, holding placement 42.
 *
 * NEITHER ANSWER IS WRONG AND THE TIE-BREAK IS NOT THE CULPRIT. Both stages
 * break an exact tie by the earlier start, and both did; what differs is
 * which run is shorter, and the rule's own reason for asking — "take what
 * costs least" — cannot distinguish two runs whose lengths agree to seven
 * significant figures and which hold one trimmable piece each. So this bound
 * says what the port actually guarantees: not the reference's run, but A
 * shortest run.
 *
 * 1e-4W IS FORTY TIMES THE OBSERVED GAP AND A FIFTIETH OF THE SHORTEST RUN
 * ON THIS LAP (0.385W, one frame pitch). A run genuinely shorter than
 * another is shorter by a frame, so nothing this bound admits could be a
 * different RUN — only a different rounding of the same length.
 */
const RUN_TIE_W = 1e-4;

/** One covered stretch, as `measureEnclosure` reports it. */
interface Run {
  readonly startW: number;
  readonly endW: number;
  readonly lengthW: number;
}

/** What a pass needs to know about the lap it is trimming. */
interface Report {
  readonly share: number;
  readonly stretches: readonly Run[];
}

/**
 * `reduceEnclosure`'s `isTrimmable`, transcribed.
 *
 * INCIDENTAL OVERHEAD AND NOTHING ELSE: not L-6's own deliberate cover
 * (`!cover`), over the span the roof has to reach (`|t| < coverW`), and
 * standing in the band between the corridor's ceiling and the overhead one.
 * Every comparison is the reference's, strict where it is strict — the `>=`
 * at the bottom and the `<` at the top are not interchangeable, and a
 * transcription that swapped them would still pass on any population that
 * did not land exactly on a boundary.
 */
const isTrimmable = (p: StationedPlacement): boolean =>
  !p.cover &&
  Math.abs(p.t) < ENCLOSE.coverW &&
  p.h >= CORRIDOR.ceilingW &&
  p.h < OVERHEAD.ceilingW;

/**
 * `tunnels.ts`'s own `inRun`, transcribed — including the wrap.
 *
 * `endW` is the station of the first frame PAST the run, so both ends are
 * inclusive here and a run whose `endW` is below its `startW` is one that
 * crosses the start line. Both halves matter: on this lap the fixture's
 * shortest run is often the one at the line.
 */
const inRun = (station: number, run: Run): boolean =>
  run.startW <= run.endW
    ? station >= run.startW && station <= run.endW
    : station >= run.startW || station <= run.endW;

/** What one pass did, and why it stopped if it did nothing. */
interface Pass {
  /** The list the pass leaves behind. */
  readonly placements: StationedPlacement[];
  /** Indices into the list the pass was handed — the run it took. */
  readonly moved: number[];
  /** Z-3's floor turned a candidate away and nothing else was available. */
  readonly blocked: boolean;
  /** There was never a candidate: no incidental overhead inside a run. */
  readonly nothing: boolean;
  /** The share the pass measured before it decided anything. */
  readonly share: number;
}

/**
 * ONE PASS of `reduceEnclosure`, written out from its source.
 *
 * IT DOES NOT CALL THE RULE, deliberately — a reference that delegates to
 * the thing it is checking checks nothing. What it transcribes is the body
 * of that function's `for` loop: measure, refuse to act below the ceiling,
 * count the incidental overhead, sort the stretches SHORTEST FIRST, and take
 * the first one that has a member and that Z-3's floor can afford. The
 * lateral is the rule's — out to the far edge of the cover span, keeping the
 * side it was on, with `|| 1` sending a piece exactly on the centreline to
 * the right rather than nowhere.
 *
 * THE SORT IS STABLE AND HAS TO BE. `Array.prototype.sort` has been stable
 * by specification since ES2019, and `measureEnclosure` builds its stretches
 * in racing order — so equal lengths resolve to the earlier start, which is
 * exactly the tie the graph breaks with its second argmin over the run key.
 * Two runs of identical length are not a hypothetical on a lap whose frames
 * are uniformly spaced.
 */
function referencePass(
  list: readonly StationedPlacement[],
  reportOf: (ps: readonly StationedPlacement[]) => Report,
  keepOverhead: number,
): Pass {
  const report = reportOf(list);
  const out = [...list];
  const idle = { placements: out, moved: [] as number[], share: report.share };

  // The reference's loop condition: below the ceiling it never looks at a
  // run, so nothing may be chosen.
  if (report.share <= ENCLOSE.ruleShare[1]) {
    return { ...idle, blocked: false, nothing: false };
  }

  const overheadCount = out.filter(isTrimmable).length;
  if (overheadCount === 0) return { ...idle, blocked: false, nothing: true };
  if (overheadCount <= keepOverhead) return { ...idle, blocked: true, nothing: false };

  const runs = [...report.stretches].sort((a, b) => a.lengthW - b.lengthW);
  let refused = false;
  for (const run of runs) {
    const over: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i] as StationedPlacement;
      if (isTrimmable(p) && inRun(p.station, run)) over.push(i);
    }
    if (over.length === 0) continue;
    if (overheadCount - over.length < keepOverhead) {
      refused = true;
      continue;
    }
    for (const i of over) {
      const p = out[i] as StationedPlacement;
      out[i] = { ...p, t: Math.sign(p.t || 1) * (ENCLOSE.coverW + p.asset.size.across / 2) };
    }
    return { ...idle, moved: over, blocked: false, nothing: false };
  }
  // Nothing was taken, so this is where it ends — and which of the two
  // reasons applies is exactly whether the floor turned a candidate away.
  return { ...idle, blocked: refused, nothing: !refused };
}

/**
 * {@link referencePass} driven to a fixed point — `reduceEnclosure`'s loop.
 *
 * SIX PASSES, WHICH IS THE RULE'S OWN `maxPasses`. The cap is not a guard
 * here: it is the number the shipped function stops at, and a reference that
 * ran further would disagree with it on any lap that needed a seventh.
 */
function iterateReference(
  list: readonly StationedPlacement[],
  reportOf: (ps: readonly StationedPlacement[]) => Report,
  keepOverhead: number,
): { placements: StationedPlacement[]; moves: number; runsTrimmed: number } {
  let out = [...list];
  let moves = 0;
  let runsTrimmed = 0;
  for (let pass = 0; pass < 6; pass++) {
    const step = referencePass(out, reportOf, keepOverhead);
    if (step.moved.length === 0) break;
    out = step.placements;
    moves += step.moved.length;
    runsTrimmed++;
  }
  return { placements: out, moves, runsTrimmed };
}

/**
 * The measurement BOTH sides are scored against.
 *
 * THE SAME ONE THE GATE USES, which is `reduceEnclosure`'s own requirement
 * for the callback it takes: "a reduction scored against its own private
 * estimate of enclosure is a reduction that stops when it thinks it is
 * done." It is also the measurement `pathCoverage` restates inside the
 * graph, and `tests/racetrackDressGraph.test.ts` is what pins those two
 * equal — so this suite is entitled to use the TypeScript one on the
 * reference side and read the graph's verdict on the other.
 */
function reporterFor(lap: Lap): (ps: readonly StationedPlacement[]) => Report {
  const kit = shippedVocabulary();
  return (ps) => measureEnclosure(lap, buildBoxes(kit, lap, ps, SEED));
}

/**
 * How far ABOVE the piece it doubles the twin sits, in W.
 *
 * THE HEIGHT AND NOT THE STATION, which is the whole reason this constant
 * needs a comment. The twin has to be a second POINT — nothing in the
 * library is defined for two points at one position, because the identity
 * tiebreak every order-free node takes is the bits of the stored position,
 * and two placements sharing them would make an arbitrary order arbitrary in
 * a second way. Moving it along the lap would do that and would also move
 * the END of the covered run by the same amount, which is enough to reorder
 * a set of runs whose shortest members differ by hundredths of a W: measured,
 * a 0.02W step along the station pushed the twinned run behind two others
 * and the round that took two pieces was not the first one. A lift changes
 * the position and not the shadow, so the run keeps its exact extent and
 * simply holds one more piece.
 *
 * 0.01W IS ABOUT A TENTH OF A WORLD UNIT ON THIS LAP, four orders above the
 * f32 spacing at the lap's world scale, so the two points are distinct by a
 * wide margin. It is also small enough that the twin stays inside
 * `isTrimmable`'s height window wherever the original was — checked rather
 * than assumed, in the loop below.
 */
const TWIN_LIFT_W = 0.01;

/**
 * The over-enclosed lap: seed 1's real dressing, one doubled overhead piece,
 * and ten wide roofs.
 *
 * THE TWIN IS WHAT MAKES THE WHOLE-RUN CLAIM TESTABLE, and it is here
 * because relying on the dressing for it turned out to be relying on luck.
 * L-6's trim takes covered runs SHORTEST FIRST and Z-3's floor allows only a
 * handful of them per lap, so what it actually reaches are the shortest runs
 * on the lap — which on this circuit are single-frame shadows cast by one
 * incidental piece each. Whether any run holding TWO pieces is short enough
 * to be reached is a property of where the dressing happened to put its
 * overhead, and on 2026-08-28 it stopped being true: Z-3's donor order
 * changed, the dressing's overhead moved, and "takes a shortest run, WHOLE"
 * was being asserted over four rounds that each took exactly one piece. The
 * rule was not wrong and the fixture had quietly stopped exercising it.
 *
 * SO THE SECOND MEMBER IS PUT THERE ON PURPOSE. The shortest run that holds
 * exactly one trimmable piece gets a copy of that piece, {@link TWIN_LIFT_W}
 * higher — same asset, same lateral, same STATION, so the same shadow and
 * the same run, now with two members in it and still the shortest thing the
 * trim will look at. That is the file's own standing lesson applied to
 * itself: a fixture chosen for one property will silently fail to exercise
 * the rules that depend on the others.
 */
async function overEnclosed(): Promise<{
  lap: Lap;
  frames: Geometry;
  placements: StationedPlacement[];
  /** Where the band starts in the list, so a case can single it out. */
  bandFrom: number;
}> {
  const { lap, frames, dressing } = await dressedLapFor(SEED);
  const assets = shippedVocabulary().assets as unknown as PlaceableAsset[];
  const piece = assets.find((a) => a.id === BAND_PIECE_ID);
  if (!piece) throw new Error(`the shipped vocabulary has no asset ${BAND_PIECE_ID}`);
  const band: StationedPlacement[] = Array.from({ length: BAND_COUNT }, (_, k) => ({
    asset: piece,
    t: 0,
    h: BAND_H,
    station: (k * lap.lengthW) / BAND_COUNT,
    pose: 0,
  }));

  // THE RUNS ARE MEASURED OVER THE WHOLE FIXTURE, band included, because
  // the band changes which stretches are covered and the trim will be
  // choosing among these same runs.
  const withBand = [...dressing.placements, ...band];
  const runs = [...reporterFor(lap)(withBand).stretches].sort((a, b) => a.lengthW - b.lengthW);
  let twin: StationedPlacement | undefined;
  for (const run of runs) {
    const members = withBand.filter((p) => isTrimmable(p) && inRun(p.station, run));
    if (members.length !== 1) continue;
    const only = members[0] as StationedPlacement;
    const lifted = { ...only, h: only.h + TWIN_LIFT_W };
    // STILL A CANDIDATE OR IT IS NOT A TWIN. A piece sitting within
    // `TWIN_LIFT_W` of the top of the overhead window would leave it, and
    // the fixture would then carry an extra piece the trim never looks at
    // — the silent failure this whole block exists to end.
    if (!isTrimmable(lifted)) continue;
    twin = lifted;
    break;
  }
  if (!twin) {
    throw new Error(
      "overEnclosed: no covered run on this fixture holds exactly one trimmable piece, so there " +
        "is nothing to double; the lap changed shape and the whole-run case needs re-deriving",
    );
  }

  return {
    lap,
    frames,
    placements: [...dressing.placements, twin, ...band],
    bandFrom: dressing.placements.length + 1,
  };
}

/**
 * The round's input, with Z-3 switched off through its own parameter.
 *
 * PINNING THE POOL IS HOW THE MIX IS SILENCED, and it is the idiom
 * `tests/racetrackDressGraph.test.ts` already uses: `mixPinned` is the set
 * Z-3 may not take a donor from, so pinning everything leaves it nothing to
 * move. It matters here for one reason — the redraw REPLACES an asset, and a
 * placement whose asset changed mid-round is a different placement, which
 * would show up as a trim disagreement about a piece the trim never saw. The
 * band's own asset is pinned alongside the pool because it is not in it.
 */
function roundInput(
  lap: Lap,
  frames: Geometry,
  placements: readonly StationedPlacement[],
): DressGraphInput {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const pool = reserveMarkers(all, SEED).pool;
  return {
    kit,
    lap,
    frames,
    placements,
    seed: SEED,
    // Nothing is locked: L-3's braking mark is not what these cases are
    // about, and stating the empty set says the exception was considered.
    immovable: new Set(),
    mixPinned: new Set([...pool.map((a) => a.id), BAND_PIECE_ID]),
    pool,
  };
}

/** One round's placement cloud, as columns a case can read. */
interface RoundRead {
  /** The survivors' indices into the list the graph was handed. */
  readonly ids: number[];
  readonly t: number[];
  readonly h: number[];
  readonly moved: number[];
  readonly trimmed: number[];
  readonly runsTrimmed: number[];
  readonly blocked: number[];
  readonly nothing: number[];
}

/** Cook one repair round and read the placement cloud it settles. */
async function cookRound(
  input: DressGraphInput,
  trim: boolean,
): Promise<RoundRead> {
  const g = buildRoundGraph(input, { trim });
  const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placements] })).outputs;
  const cloud = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
  if (!cloud) throw new Error("the round graph produced no placements");
  const col = (name: string): number[] => {
    const a = cloud.attrs.point.require(name);
    return Array.from({ length: cloud.pointCount }, (_, i) => a.get(i));
  };
  return {
    ids: col(PLACEMENT.id),
    t: col(PLACEMENT.t),
    h: col(PLACEMENT.h),
    moved: col(TRIM.moved),
    trimmed: col(TRIM.trimmed),
    runsTrimmed: col(TRIM.runsTrimmed),
    blocked: col(TRIM.blocked),
    nothing: col(TRIM.nothing),
  };
}

/**
 * The population the trim saw, rebuilt from a trim-OFF round.
 *
 * THE ASSET AND THE POSE COME FROM THE ORIGINAL LIST AND THE GEOMETRY FROM
 * THE CLOUD, which is the only combination that reproduces what the stage
 * was handed. `trackT` and `trackH` are the four rules' answers and have to
 * be read; the asset is unchanged because Z-3 is pinned off; and the pose
 * has to be the original object's, because `buildBoxes` draws from the same
 * library the graph's box stamp does and a pose drawn twice differently
 * would move every box on the lap.
 */
function preTrimList(
  read: RoundRead,
  src: readonly StationedPlacement[],
): StationedPlacement[] {
  return read.ids.map((id, i) => ({
    ...(src[id] as StationedPlacement),
    t: read.t[i] as number,
    h: read.h[i] as number,
  }));
}

describe("racetrack L-6 trim, as a graph stage", () => {
  it("reproduces reduceEnclosure when the hand-written pass is iterated", async () => {
    const { lap, placements } = await overEnclosed();
    const reportOf = reporterFor(lap);

    const before = reportOf(placements);
    // THE FIXTURE'S OWN PRECONDITION, ASSERTED RATHER THAN ASSUMED. Every
    // claim below is about a rule that only runs above the ceiling, so a
    // fixture that quietly fell under it would make this whole file pass
    // while measuring nothing.
    expect(before.share, "the fixture is not over-enclosed").toBeGreaterThan(
      ENCLOSE.ruleShare[1],
    );
    expect(placements.filter(isTrimmable).length, "no incidental overhead to trim")
      .toBeGreaterThan(0);

    // KEEP-OVERHEAD ZERO ON BOTH SIDES, which is what isolates the pass
    // transcription from Z-3's floor. The floor gets its own case below;
    // folding it in here would mean a failure could be either a wrong rule
    // or a wrong floor and the assertion could not say which.
    const shipped = reduceEnclosure(placements, reportOf, 0);
    const mine = iterateReference(placements, reportOf, 0);

    expect(mine.moves, "the transcription and the rule took different numbers of moves").toBe(
      shipped.moves,
    );
    expect(mine.runsTrimmed, "the transcription and the rule took different runs").toBe(
      shipped.runsTrimmed,
    );
    // PLACEMENT FOR PLACEMENT AND NOT AS A SET. Two reductions that moved
    // the same COUNT of pieces to the same laterals can still have moved
    // different pieces, and that is precisely the failure a hand-written
    // reference is prone to — an off-by-one in `inRun`'s wrap moves the
    // neighbouring run and keeps every summary statistic.
    expect(mine.placements.length).toBe(shipped.placements.length);
    for (let i = 0; i < mine.placements.length; i++) {
      const a = mine.placements[i] as StationedPlacement;
      const b = shipped.placements[i] as StationedPlacement;
      expect(a.t, `placement ${i}: the transcription put it somewhere else`).toBe(b.t);
      expect(a.h, `placement ${i}: the transcription changed a height`).toBe(b.h);
      expect(a.asset.id, `placement ${i}: the transcription changed an asset`).toBe(b.asset.id);
    }

    console.log(
      `L-6 trim reference: ${(before.share * 100).toFixed(1)}% -> ` +
        `${(shipped.after * 100).toFixed(1)}% in ${shipped.moves} moves over ` +
        `${shipped.runsTrimmed} runs, ${before.stretches.length} stretches, ` +
        `${placements.filter(isTrimmable).length} trimmable of ${placements.length}`,
    );
  }, LAP_MS);

  it("takes the same run the reference pass takes, on the same population", async () => {
    const { lap, frames, placements } = await overEnclosed();
    const input = roundInput(lap, frames, placements);

    // THE TRIM-OFF ROUND FIRST, because its carry is the population the
    // trim-on round's stage was handed — see this file's header. Cooking
    // them in this order is not required; reading the reference off the
    // first one is.
    const pre = await cookRound(input, false);
    expect(pre.moved.reduce((a, b) => a + b, 0), "the trim ran in a round built without it")
      .toBe(0);

    const got = await cookRound(input, true);
    // THE TWO ROUNDS MUST DESCRIBE THE SAME SURVIVORS, or the comparison is
    // between two different laps. The trim is the last stage and moves a
    // lateral, so it cannot add, drop or reorder a placement — and a
    // failure here would say the port had reached back into the four rules
    // ahead of it, which is a much larger defect than a wrong run.
    expect(got.ids, "the trim changed which placements survived the round").toEqual(pre.ids);

    const list = preTrimList(pre, placements);
    // Z-3's FLOOR AS THE STAGE COMPUTES IT: `ceil(keepShare * count)` over
    // the list the stage was handed, which is the post-cull survivors and
    // not the list handed to `buildRoundGraph`. There is no way to pass
    // `keepOverhead` in, so the reference has to derive the same number
    // from the same two facts.
    const keepOverhead = Math.ceil(Z3.over.rule[0] * list.length);
    const want = referencePass(list, reporterFor(lap), keepOverhead);

    // THE FIXTURE HAS TO SURVIVE THE FOUR RULES AHEAD OF THE TRIM, and this
    // is the assertion that says so. It is not a formality: at a band height
    // of 3.24W — which puts the piece's base a hundredth under the corridor
    // ceiling — Z-1 stands all ten pieces off to 3.55W before the trim is
    // reached, the lap arrives at 12.3% enclosure, and every claim below is
    // vacuously satisfied by a stage that does nothing. See {@link BAND_H},
    // which carries the same figure and what it used to read.
    const seen = reporterFor(lap)(list);
    expect(
      seen.share,
      "the round's other four rules took the fixture apart before the trim saw it",
    ).toBeGreaterThan(ENCLOSE.ruleShare[1]);
    expect(want.moved.length, "the reference pass chose nothing, so the case proves nothing")
      .toBeGreaterThan(0);

    const wantIds = new Set(want.moved.map((i) => pre.ids[i] as number));
    const gotIds = new Set(
      got.ids.filter((_, i) => (got.moved[i] as number) > 0),
    );
    // THE SET, AND THE SET IS THE WHOLE CLAIM. Everything else in the round
    // moves placements too, so "the laterals agree" would be satisfied by a
    // trim that had done nothing and a Z-1 that had done the same thing.
    // What is being checked is which run the stage CHOSE, and that is
    // exactly the set its own `moved` column flags.
    expect([...gotIds].sort((a, b) => a - b), "the graph trimmed a different run").toEqual(
      [...wantIds].sort((a, b) => a - b),
    );

    // And then the lateral, on the rows both sides agree were moved.
    let worst = 0;
    for (let i = 0; i < got.ids.length; i++) {
      const id = got.ids[i] as number;
      const wantT = (want.placements[pre.ids.indexOf(id)] as StationedPlacement).t;
      const d = Math.abs((got.t[i] as number) - wantT);
      worst = Math.max(worst, d);
      expect(d, `placement ${id}: lateral after the trim`).toBeLessThan(TRACK_TOL);
    }

    // The two accumulating columns, which are what a multi-round loop reads.
    // One round that trimmed is one run, and every moved placement is
    // trimmed for ever after — it is outside the cover span, so
    // `isTrimmable` refuses it and the running OR is also the count.
    for (let i = 0; i < got.ids.length; i++) {
      expect(got.trimmed[i], `placement ${got.ids[i]}: the ever-trimmed flag`).toBe(got.moved[i]);
      expect(got.runsTrimmed[i], "one round that trimmed is one run").toBe(1);
    }
    expect(got.blocked.every((v) => v === 0), "a round that trimmed reported itself blocked")
      .toBe(true);
    expect(got.nothing.every((v) => v === 0), "a round that trimmed reported nothing to trim")
      .toBe(true);

    console.log(
      `L-6 trim port: ${got.ids.length} survivors at ${(seen.share * 100).toFixed(1)}% ` +
        `over ${seen.stretches.length} stretches, ${list.filter(isTrimmable).length} trimmable, ` +
        `keepOverhead ${keepOverhead} — ${gotIds.size} moved ` +
        `(ids ${[...gotIds].sort((a, b) => a - b).join(", ")}), ` +
        `worst |dt| ${worst.toExponential(2)}W`,
    );
  }, LAP_MS);

  it("takes a shortest run, whole, over successive rounds", async () => {
    // ONE ROUND IS ONE PASS, WHICH IS ALSO THE WEAKNESS OF THE CASE ABOVE.
    // The rule takes the SHORTEST stretch first, and the shortest stretch on
    // this lap holds a single trimmable piece — so "the same set" is a claim
    // about a set of one, and a port that moved a run's first member instead
    // of the whole run would pass it. Chaining the rounds is what reaches a
    // run with several members in it, and it is also the claim the stage's
    // own note makes: "a lap that needs three runs taken out has them taken
    // out over three repair rounds, each one re-measured by the ray cast at
    // the top of the body."
    //
    // AND IT IS THE CASE THAT FOUND THE ONE PLACE THE TWO CAN DIVERGE — see
    // {@link RUN_TIE_W}. What is asserted is therefore the rule's
    // postcondition rather than the reference's exact answer: the graph took
    // a WHOLE run, it took one no longer than the reference's own choice
    // (within the f32 resolution of a run length), and it respected Z-3's
    // floor. The exact-answer claim lives in the case above, where the
    // population is the one the fixture was measured on.
    const { lap, frames, placements } = await overEnclosed();
    const reportOf = reporterFor(lap);
    let list: StationedPlacement[] = [...placements];
    const sizes: number[] = [];
    let ties = 0;
    let worstTie = 0;

    for (let round = 0; round < 4; round++) {
      const input = roundInput(lap, frames, list);
      // The trim-off carry again, for the reason the case above states: the
      // reference has to be asked about the population the stage was handed
      // and not the one the round began with.
      const pre = await cookRound(input, false);
      const seen = preTrimList(pre, list);
      const keepOverhead = Math.ceil(Z3.over.rule[0] * seen.length);
      const want = referencePass(seen, reportOf, keepOverhead);

      const got = await cookRound(input, true);
      const gotIds = got.ids.filter((_, i) => (got.moved[i] as number) > 0).sort((a, b) => a - b);
      const wantIds = want.moved.map((j) => pre.ids[j] as number).sort((a, b) => a - b);
      // A round in which the reference stops and the graph does not, or the
      // other way about, is not a tie — it is the two disagreeing about
      // whether L-6 is satisfied, and no tolerance covers that.
      expect(
        gotIds.length > 0,
        `round ${round}: one side trimmed and the other stopped`,
      ).toBe(wantIds.length > 0);
      if (gotIds.length === 0) break;

      const runs = reportOf(seen).stretches;
      const membersOf = (r: Run): number[] =>
        seen
          .map((p, j) => ({ p, id: pre.ids[j] as number }))
          .filter(({ p }) => isTrimmable(p) && inRun(p.station, r))
          .map(({ id }) => id)
          .sort((a, b) => a - b);

      if (gotIds.join() !== wantIds.join()) {
        // THE ONLY DIVERGENCE ALLOWED, AND IT IS CHECKED RATHER THAN
        // TOLERATED: the graph must still have taken a whole covered run,
        // and that run must tie the reference's for shortest.
        const gotRun = runs.find((r) => membersOf(r).join() === gotIds.join());
        expect(
          gotRun,
          `round ${round}: the graph moved [${gotIds}] which is not one whole covered run`,
        ).toBeDefined();
        const wantRun = runs.find((r) => membersOf(r).join() === wantIds.join());
        expect(wantRun, `round ${round}: the reference's own choice is not a run`).toBeDefined();
        const gap = (gotRun as Run).lengthW - (wantRun as Run).lengthW;
        worstTie = Math.max(worstTie, Math.abs(gap));
        expect(
          gap,
          `round ${round}: the graph took a run ${gap.toFixed(6)}W longer than the shortest`,
        ).toBeLessThan(RUN_TIE_W);
        expect(
          seen.filter(isTrimmable).length - gotIds.length,
          `round ${round}: the graph took a run Z-3's floor forbids`,
        ).toBeGreaterThanOrEqual(keepOverhead);
        ties++;
      }
      // EVERY ROUND HERE STARTS ITS ACCUMULATORS AT ZERO, and pinning that
      // is what keeps the accumulator case honest. `buildRoundGraph` calls
      // `writeTrimInit` on the carry it binds, so cooking it three times is
      // three FIRST rounds — `trimmed` can only ever equal `moved` and
      // `runsTrimmed` can only ever be 1. The columns are asked to
      // accumulate where rounds really are rounds: two stages in one graph,
      // in "accumulates the trimmed flag and the run tally across rounds".
      for (let i = 0; i < got.ids.length; i++) {
        expect(got.trimmed[i], `round ${round}: the carry was not re-initialised`).toBe(
          got.moved[i],
        );
      }
      expect(
        got.runsTrimmed.every((v) => v === 1),
        `round ${round}: the run tally is not this round's alone`,
      ).toBe(true);
      sizes.push(gotIds.length);
      list = preTrimList(got, list);
    }

    // BOTH HALVES MATTER. More than one round says the chain is real rather
    // than a first round that happened to settle; a round that took more than
    // one piece says the whole-run claim was ever about more than one piece.
    expect(sizes.length, "the trim settled in one round; the chain proves nothing").toBeGreaterThan(
      1,
    );
    expect(
      Math.max(...sizes),
      "every run the trim took held one piece; the whole-run claim was never exercised",
    ).toBeGreaterThan(1);
    console.log(
      `L-6 trim rounds: ${sizes.length} rounds trimmed, sizes ${sizes.join(", ")}, ` +
        `${ties} f32 tie(s), worst tie gap ${worstTie.toExponential(2)}W`,
    );
  }, LAP_MS);

  it("says NOTHING TO TRIM when every candidate is L-6's own cover", async () => {
    const { lap, frames, placements } = await overEnclosed();
    // MARKING THEM COVER IS HOW THE BRANCH IS REACHED, and it is the branch's
    // real-world case rather than a contrivance: a lap whose overhead is all
    // deliberate tunnel has nothing this pass may touch. It leaves the
    // MEASUREMENT alone — a cover piece roofs the road exactly as it did —
    // so the lap is still over the ceiling and the stage still runs. That is
    // the whole point: the flag has to distinguish "over the ceiling with
    // nothing allowed" from "not over the ceiling", and both of the other
    // cases here would pass with the two collapsed.
    const covered = placements.map((p) => (isTrimmable(p) ? { ...p, cover: true } : p));
    expect(covered.filter(isTrimmable).length, "the fixture still has a candidate").toBe(0);

    const got = await cookRound(roundInput(lap, frames, covered), true);
    expect(got.moved.reduce((a, b) => a + b, 0), "the trim moved something it was not allowed to")
      .toBe(0);
    expect(got.nothing.every((v) => v === 1), "the trim did not report nothing to trim").toBe(true);
    // AND THE OTHER FLAG MUST BE OFF. The two answers send a reader to
    // different places — one says the vocabulary cannot make a lap this
    // open, the other says the band mix is binding — so reporting both, or
    // the wrong one, is the defect `reduceEnclosure` split them to avoid.
    expect(got.blocked.every((v) => v === 0), "the trim blamed Z-3 for a rule never consulted")
      .toBe(true);
    expect(got.runsTrimmed.every((v) => v === 0)).toBe(true);
  }, LAP_MS);

  it("says BLOCKED when Z-3's floor refuses the only run available", async () => {
    const { lap, frames, placements, bandFrom } = await overEnclosed();
    // THE FLOOR IS `ceil(0.1 * count)` AND CANNOT BE PASSED IN, so the only
    // way to make it bind is to build a list where the arithmetic bites:
    // leave the ten band pieces as the ONLY incidental overhead and mark
    // every other candidate as cover. The floor then wants 37 overhead
    // survivors out of a list of ~364, the trim has 10, and no run it could
    // take leaves enough behind — which is `overheadCount <= keepOverhead`,
    // the early refusal, reached on a lap that is genuinely over the
    // ceiling. The band still roofs the road, so `over` holds and the stage
    // is not merely idle.
    const only = placements.map((p, i) =>
      i < bandFrom && isTrimmable(p) ? { ...p, cover: true } : p,
    );
    const candidates = only.filter(isTrimmable).length;
    expect(candidates, "the band is no longer the only candidate").toBe(BAND_COUNT);

    const got = await cookRound(roundInput(lap, frames, only), true);
    expect(
      Math.ceil(Z3.over.rule[0] * got.ids.length),
      "the floor no longer binds; the case would pass for the wrong reason",
    ).toBeGreaterThan(candidates);

    expect(got.moved.reduce((a, b) => a + b, 0), "the trim spent a run the floor forbade").toBe(0);
    expect(got.blocked.every((v) => v === 1), "the trim did not report the floor").toBe(true);
    expect(got.nothing.every((v) => v === 0), "the trim reported no candidate when it had ten")
      .toBe(true);
    expect(got.runsTrimmed.every((v) => v === 0)).toBe(true);
  }, LAP_MS);

  it("is inert on an ordinary lap, and is not inert on the over-enclosed one", async () => {
    // THE CONTROL, AND IT IS TWO CLAIMS IN ONE CASE BECAUSE EITHER ALONE IS
    // SATISFIED BY A DELETED STAGE. "It moves nothing below the ceiling" is
    // true of no stage at all; "it moves something above it" is true of a
    // stage that trims unconditionally. The pair is what says the trim is a
    // REPAIR: it fires when L-6 is breached and never otherwise.
    const { lap, frames, dressing } = await dressedLapFor(SEED);
    const ordinary = await cookRound(
      roundInput(lap, frames, dressing.placements),
      true,
    );
    expect(
      ordinary.moved.reduce((a, b) => a + b, 0),
      "the trim fired on a lap that is under the ceiling",
    ).toBe(0);
    expect(ordinary.blocked.every((v) => v === 0), "a lap under the ceiling reported blocked")
      .toBe(true);
    expect(ordinary.nothing.every((v) => v === 0), "a lap under the ceiling reported nothing")
      .toBe(true);
    expect(ordinary.runsTrimmed.every((v) => v === 0)).toBe(true);
    expect(ordinary.trimmed.every((v) => v === 0)).toBe(true);

    const fixture = await overEnclosed();
    const enclosed = await cookRound(
      roundInput(fixture.lap, fixture.frames, fixture.placements),
      true,
    );
    const movedCount = enclosed.moved.reduce((a, b) => a + b, 0);
    expect(movedCount, "the trim did nothing on a lap 6 points over the ceiling")
      .toBeGreaterThan(0);

    console.log(
      `L-6 trim control: ordinary lap ${dressing.placements.length} placements, 0 moved; ` +
        `over-enclosed lap ${fixture.placements.length} placements, ${movedCount} moved`,
    );
  }, LAP_MS);
});

/**
 * A LAP WITH INTEGER STATIONS, WHICH IS THE ONLY WAY THE ENDS CAN BE TESTED.
 *
 * Everything above runs on a real lap, and a real lap cannot exercise an
 * EXACT station tie: its frames sit at f32 arc lengths nothing lands on, so
 * `inRun`'s two inclusive ends are never reached and a port that got either
 * of them wrong would be green on every seed. An independent check found
 * exactly that — the lower end was exclusive where the rule's is inclusive —
 * and the defect is unreachable from a dressed lap by construction.
 *
 * So these cases drive {@link writeCoverTrim} DIRECTLY, on frames at unit
 * pitch with a coverage mask written by hand. No Z-1, no cull, no ray cast,
 * no vocabulary: a station of exactly 5 is exactly 5, a run is exactly the
 * frames named, and a membership claim is a claim rather than a tolerance.
 *
 * IT IS THE STAGE AND NOT A COPY OF IT — the same function `buildRepairBody`
 * wires in, given the same two clouds it is given there. What is synthetic
 * is the lap, which is the point: the rule is being asked about cases the
 * shipped vocabulary cannot produce, not about a lap.
 */
interface SyntheticRow {
  readonly station: number;
  readonly t?: number;
  readonly h?: number;
  readonly across?: number;
  readonly cover?: boolean;
}

/** Every column the stage writes, working ones included — see {@link probeOf}. */
interface SyntheticOut {
  readonly station: number[];
  readonly t: number[];
  readonly runKey: number[];
  readonly runW: number[];
  readonly runCount: number[];
  readonly overhead: number[];
  readonly listCount: number[];
  readonly moved: number[];
  readonly trimmed: number[];
  readonly runsTrimmed: number[];
  readonly blocked: number[];
  readonly nothing: number[];
}

/**
 * The stage's last node BEFORE it drops its working columns.
 *
 * A HANDLE BUILT FROM A KNOWN ID, and it is the only way to read
 * `TRIM.runKey`, `TRIM.runW` and `TRIM.runCount` at all: the stage removes
 * them on its way out — rightly, since a column nothing reads still rides
 * every round of a `repeatUntil` — so nothing downstream can see the
 * membership it decided. A `NodeHandle` is `{ id }` and `Graph.output` takes
 * one, so naming the node the stage built from its own `tag` is enough.
 *
 * IT IS DELIBERATELY BRITTLE. If the stage renames that node the cook fails
 * with `unknown node "…"`, which is the right failure: this reads an
 * internal, and an internal that moved should say so rather than silently
 * measure something else.
 */
const probeOf = (tag: string): NodeHandle => ({ id: `${tag}_runTally` });

/** Frames at unit pitch, with the coverage mask written by hand. */
function syntheticFrames(count: number, covered: readonly (readonly [number, number])[]): Geometry {
  const geo = createPointCloud(count);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const station = pts.add("stationW", "f32", 1);
  const cov = pts.add("covered", "f32", 1);
  for (let i = 0; i < count; i++) {
    P.setTuple(i, [i, 0, 0]);
    station.set(i, i);
    cov.set(i, covered.some(([a, b]) => i >= a && i <= b) ? 1 : 0);
  }
  return geo;
}

/** The placement list, as the columns the stage reads off it. */
function syntheticPlacements(rows: readonly SyntheticRow[]): Geometry {
  const geo = createPointCloud(rows.length);
  const pts = geo.attrs.point;
  const P = pts.require("P");
  const station = pts.add(PLACEMENT.station, "f32", 1);
  const t = pts.add(PLACEMENT.t, "f32", 1);
  const h = pts.add(PLACEMENT.h, "f32", 1);
  const across = pts.add(PLACEMENT.sizeAcross, "f32", 1);
  const cover = pts.add(PLACEMENT.cover, "f32", 1);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as SyntheticRow;
    P.setTuple(i, [0, i, 0]);
    station.set(i, r.station);
    t.set(i, r.t ?? 0);
    // The default height sits in `isTrimmable`'s window: at or above the
    // corridor ceiling of 1.2W and below the overhead ceiling of 6W.
    h.set(i, r.h ?? 3);
    across.set(i, r.across ?? 1);
    cover.set(i, r.cover ? 1 : 0);
  }
  return geo;
}

/**
 * Run the stage `stages` times over one synthetic lap.
 *
 * CHAINED STAGES ARE WHAT ROUNDS ARE. `writeTrimInit` runs once, outside,
 * exactly as `buildRoundGraph` puts it outside the body — so two stages in
 * series are two rounds of the repair loop, and that is the only arrangement
 * in which `TRIM.trimmed` and `TRIM.runsTrimmed` can be seen to accumulate.
 * Cooking `buildRoundGraph` twice cannot show it: that entry point calls
 * `writeTrimInit` on every build, so both columns come back describing one
 * round however many times it is called.
 */
async function trimSynthetic(opts: {
  lapW: number;
  frames: number;
  covered: readonly (readonly [number, number])[];
  rows: readonly SyntheticRow[];
  keepShare: number;
  stages?: number;
}): Promise<SyntheticOut> {
  const g = new Graph(1);
  const framesIn = g.add(dataInput, {}, "frames");
  g.setParam(framesIn, "items", [makeGeometryItem(syntheticFrames(opts.frames, opts.covered))]);
  // The frames have to be a POLYLINE: every run scan in the stage is a
  // `pathShift` or a `pathRuns`, and both read topology. On a real lap the
  // road graph has already built it.
  const path = g.add(pointsToPath, { closed: true }, "framesPath");
  g.connect(framesIn, "out", path, "in");

  const listIn = g.add(dataInput, {}, "list");
  g.setParam(listIn, "items", [makeGeometryItem(syntheticPlacements(opts.rows))]);

  let cloud: NodeHandle = writeTrimInit(g, listIn, "init");
  let last = "";
  for (let s = 0; s < (opts.stages ?? 1); s++) {
    last = `trim${s}`;
    cloud = writeCoverTrim(
      g,
      path,
      cloud,
      {
        lapW: opts.lapW,
        coveredAttr: "covered",
        stationAttr: PLACEMENT.station,
        tAttr: PLACEMENT.t,
        hAttr: PLACEMENT.h,
        acrossAttr: PLACEMENT.sizeAcross,
        coverAttr: PLACEMENT.cover,
        keepShare: opts.keepShare,
      },
      last,
    );
  }
  g.output(probeOf(last), "out", "raw");

  const out = (await cook(g, { outputs: ["raw"] })).outputs;
  const geo = firstGeometry(out["raw"] ?? []);
  if (!geo) throw new Error("the synthetic trim produced no cloud");
  const col = (name: string): number[] => {
    const a = geo.attrs.point.require(name);
    return Array.from({ length: geo.pointCount }, (_, i) => a.get(i));
  };
  return {
    station: col(PLACEMENT.station),
    t: col(PLACEMENT.t),
    runKey: col(TRIM.runKey),
    runW: col(TRIM.runW),
    runCount: col(TRIM.runCount),
    overhead: col(TRIM.overhead),
    listCount: col(TRIM.listCount),
    moved: col(TRIM.moved),
    trimmed: col(TRIM.trimmed),
    runsTrimmed: col(TRIM.runsTrimmed),
    blocked: col(TRIM.blocked),
    nothing: col(TRIM.nothing),
  };
}

/**
 * The lateral a default synthetic row lands on when the trim takes it.
 *
 * `sign(t || 1) * (coverW + across/2)` with `t = 0` and `across = 1`: out to
 * the RIGHT, because the `|| 1` is what sends a piece sitting exactly on the
 * centreline somewhere rather than nowhere.
 */
const SYNTHETIC_MOVED_T = ENCLOSE.coverW + 0.5;

/**
 * ONE COVERED RUN, frames 5 to 10 of twenty at unit pitch.
 *
 * `stretchesOf` would call this `{ startW: 5, endW: 11, lengthW: 6 }` — the
 * end being "the station of the first frame PAST the run" — so `inRun`
 * admits exactly `5 <= station <= 11`, and 6 of 20 covered is a share of
 * 30%, over L-6's 25% ceiling with nothing else needed to put it there.
 */
const ONE_RUN = { lapW: 20, frames: 20, covered: [[5, 10]] as const };

describe("racetrack L-6 trim, on a lap with exact stations", () => {
  it("admits a placement at either exact end of a run, and nothing in the gap", async () => {
    // THE TWO ENDS ARE NOT ONE PROBLEM SOLVED TWICE. The stage merges the
    // placements and the frames into one walk ordered by station, and
    // `pointsToPath` breaks an equal order key to the lower point index —
    // which buys the UPPER end (a placement at 11 sorts before the frame
    // that ends the run and stays inside it) and loses the LOWER one (a
    // placement at 5 sorts before the frame that OPENS the run and lands in
    // the gap behind it). One merge order cannot have both, which is why
    // the lower end is repaired after the fold, and why 5 is the case that
    // matters here: it is the one that was wrong.
    const rows: SyntheticRow[] = [
      { station: 5 }, // the lower end, exactly
      { station: 11 }, // the upper end, exactly — `endW`, past the last frame
      { station: 8 }, // strictly inside
      { station: 10.5 }, // between the last covered frame and `endW`
      { station: 15 }, // outside, well clear
      { station: 4.5 }, // in the gap BEFORE the run, half a pitch short of it
    ];
    const got = await trimSynthetic({ ...ONE_RUN, rows, keepShare: 0 });

    const member = [true, true, true, true, false, false];
    for (let i = 0; i < rows.length; i++) {
      const at = `station ${(rows[i] as SyntheticRow).station}`;
      // THE KEY IS THE RUN'S START FRAME INDEX PLUS ONE, which is 6 for the
      // run opening at frame 5. It is an index rather than a station
      // because `pointsToPath` groups on it and refuses a fractional key;
      // the `+ 1` is what keeps frame 0 from reading as "no run".
      expect(got.runKey[i], `${at}: run key`).toBe(member[i] ? 6 : 0);
      expect(got.runW[i], `${at}: run length`).toBe(member[i] ? 6 : 0);
      // AND THE COUNT IS THE REPAIRED MEMBERSHIP'S, not the walk's. It is
      // recomputed by grouping on the key after the lower end is fixed, so
      // a placement that adopted its run is counted in it — which matters
      // because Z-3's floor is tested against this number.
      //
      // ONLY ON A MEMBER. Key 0 means "in no run", and the regrouping puts
      // every such point in one group, so a non-member's `runCount` is the
      // population of everything outside a run rather than a run's — a
      // number nothing reads, since `candidate` requires `runKey > 0`.
      // Asserting it would be pinning an artefact of the grouping.
      if (member[i]) expect(got.runCount[i], `${at}: run population`).toBe(4);
      expect(got.moved[i], `${at}: moved`).toBe(member[i] ? 1 : 0);
      expect(got.t[i], `${at}: lateral`).toBeCloseTo(member[i] ? SYNTHETIC_MOVED_T : 0, 6);
    }
    expect(got.overhead[0], "every row is incidental overhead here").toBe(6);
    expect(got.runsTrimmed[0], "one run taken").toBe(1);
    expect(got.blocked[0]).toBe(0);
    expect(got.nothing[0]).toBe(0);
  }, LAP_MS);

  it("does not let a placement in a gap adopt the run ahead of it", async () => {
    // THE CONTROL FOR THE LOWER-END REPAIR. That repair carries the NEXT
    // covered run's key backwards over every point up to it, and a
    // placement adopts it only when its station equals that run's start
    // EXACTLY. The failure it must not have is adopting on "is ahead of",
    // which would swallow the whole gap into the run in front of it — so
    // this asks about a placement strictly between two run starts, where
    // the answer is unambiguous and the wrong rule is loudest.
    const rows: SyntheticRow[] = [
      { station: 6 }, // inside the first run, [5, 8]
      { station: 11 }, // strictly between the two run starts, in neither run
      { station: 16 }, // inside the second run, [15, 18]
    ];
    const got = await trimSynthetic({
      lapW: 40,
      frames: 40,
      covered: [
        [5, 7],
        [15, 17],
      ],
      rows,
      keepShare: 0,
    });
    expect(got.runKey[1], "a placement in the gap adopted a run").toBe(0);
    expect(got.moved[1], "a placement in the gap was trimmed").toBe(0);
    expect(got.t[1], "a placement in the gap was moved").toBe(0);
    // The two real members did get keys, or the case proved only that
    // nothing at all was happening.
    expect(got.runKey[0], "the first run's member lost its key").toBe(6);
    expect(got.runKey[2], "the second run's member lost its key").toBe(16);
  }, LAP_MS);

  it("falls through a run Z-3's floor refuses to a longer one it can afford", async () => {
    // THE PER-RUN REFUSAL, WHICH THE GLOBAL ONE DOES NOT COVER. The rule
    // walks the stretches shortest first and CONTINUES past one whose
    // removal would take the overhead population under Z-3's floor — so a
    // port that only tested the whole list against the floor would take the
    // short run here and be wrong, and one that stopped at the first
    // refusal would take nothing and be wrong differently.
    //
    // Five members in a 3W run and one in a 10W run, six placements, a
    // floor of `ceil(0.5 * 6) = 3`: the short run leaves 1 behind and is
    // refused, the long run leaves 5 and is taken. The global test does not
    // fire, since 6 overhead is above a floor of 3.
    const rows: SyntheticRow[] = [
      { station: 5 },
      { station: 6 },
      { station: 6.5 },
      { station: 7 },
      { station: 7.5 },
      { station: 25 },
    ];
    const got = await trimSynthetic({
      lapW: 40,
      frames: 40,
      covered: [
        [5, 7],
        [20, 29],
      ],
      rows,
      keepShare: 0.5,
    });

    expect(got.overhead[0]).toBe(6);
    expect(got.listCount[0]).toBe(6);
    expect(got.runCount.slice(0, 5), "the short run's population").toEqual([5, 5, 5, 5, 5]);
    expect(got.runCount[5], "the long run's population").toBe(1);
    expect(got.moved, "the trim did not fall through to the affordable run").toEqual([
      0, 0, 0, 0, 0, 1,
    ]);
    expect(got.t[5]).toBeCloseTo(SYNTHETIC_MOVED_T, 6);
    // AND `blocked` MUST BE ZERO. A run was refused, but a later one was
    // taken — the flag says why the reduction STOPPED, not that a refusal
    // ever happened, which is a distinction `reduceEnclosure` makes with a
    // per-pass variable and this stage makes with `anyMoved`.
    expect(got.blocked[0], "a round that trimmed reported itself blocked").toBe(0);
    expect(got.nothing[0]).toBe(0);
    expect(got.runsTrimmed[0]).toBe(1);
  }, LAP_MS);

  it("tells the two global refusals apart", async () => {
    // THREE REFUSALS AND NOT ONE, which is `reduceEnclosure`'s shape: it
    // tests the WHOLE LIST before it looks at a single run. No incidental
    // overhead at all is "nothing to trim"; overhead that exists but cannot
    // clear Z-3's floor is "held back by the band mix" — a refusal with no
    // run involved. Reporting the second as the first was the second defect
    // an independent check found, and it is exactly the confusion the two
    // flags exist to prevent.
    const rows: SyntheticRow[] = [
      { station: 6 },
      { station: 7 },
      { station: 8 },
      { station: 9 },
      { station: 10 },
      { station: 15 },
    ];

    // (a) Nothing is a candidate: every piece is L-6's own cover.
    const none = await trimSynthetic({
      ...ONE_RUN,
      rows: rows.map((r) => ({ ...r, cover: true })),
      keepShare: 0,
    });
    expect(none.overhead[0], "the fixture still has a candidate").toBe(0);
    expect(none.nothing.every((v) => v === 1), "no candidate did not report nothing").toBe(true);
    expect(none.blocked.every((v) => v === 0), "no candidate blamed Z-3").toBe(true);

    // (b) Candidates exist and the floor swallows all of them. A
    // `keepShare` of 1 makes the floor the whole list, which no run can
    // leave behind — the global refusal, reached before any run is looked
    // at, and the case that used to answer "nothing to trim".
    const floored = await trimSynthetic({ ...ONE_RUN, rows, keepShare: 1 });
    expect(floored.overhead[0], "the floor case has no candidates to refuse").toBe(6);
    expect(floored.moved.every((v) => v === 0), "the trim spent a run the floor forbade").toBe(
      true,
    );
    expect(floored.blocked.every((v) => v === 1), "the floor case did not report blocked").toBe(
      true,
    );
    expect(floored.nothing.every((v) => v === 0), "the floor case reported no candidate").toBe(
      true,
    );
  }, LAP_MS);

  it("accumulates the trimmed flag and the run tally across rounds", async () => {
    // TWO STAGES IN SERIES ARE TWO ROUNDS, and this is the only place in
    // the suite where the accumulators are asked for more than one — see
    // {@link trimSynthetic}. Round one takes the 3W run; round two finds
    // its members outside the cover span and therefore no longer trimmable,
    // and takes the 10W one. The coverage mask is static here, which is
    // what lets the second round reach a second run rather than stopping:
    // on a real lap the ray cast re-measures and the lap falls under the
    // ceiling instead, which is the same mechanism arriving at the right
    // answer by a different route.
    const rows: SyntheticRow[] = [{ station: 6 }, { station: 7 }, { station: 25 }];
    const shape = {
      lapW: 40,
      frames: 40,
      covered: [
        [5, 7],
        [20, 29],
      ] as const,
      rows,
      keepShare: 0,
    };

    const one = await trimSynthetic({ ...shape, stages: 1 });
    expect(one.moved, "round one did not take the shorter run").toEqual([1, 1, 0]);
    expect(one.trimmed).toEqual([1, 1, 0]);
    expect(one.runsTrimmed.every((v) => v === 1), "round one is one run").toBe(true);

    const two = await trimSynthetic({ ...shape, stages: 2 });
    // `moved` IS THIS ROUND'S AND `trimmed` IS EVERY ROUND'S, which is the
    // whole reason there are two columns: the settle count reads the first,
    // and a loop reading the second would never stop.
    expect(two.moved, "round two did not take the longer run").toEqual([0, 0, 1]);
    expect(two.trimmed, "the ever-trimmed flag did not accumulate").toEqual([1, 1, 1]);
    expect(two.runsTrimmed.every((v) => v === 2), "the run tally did not accumulate").toBe(true);
    expect(two.t[0]).toBeCloseTo(SYNTHETIC_MOVED_T, 6);
    expect(two.t[2]).toBeCloseTo(SYNTHETIC_MOVED_T, 6);

    console.log(
      `L-6 trim accumulators: round 1 moved ${one.moved.join("")}, ` +
        `round 2 moved ${two.moved.join("")}, trimmed ${two.trimmed.join("")}, ` +
        `runs ${two.runsTrimmed[0]}`,
    );
  }, LAP_MS);
});
