/**
 * L-5's barrier runs, checked on L-5's OWN detector.
 *
 * WHY THAT IS THE POSTCONDITION AND NOT A GOLDEN. `falseEdges.ts` already
 * ships the thing that decides whether a line on the verge is assembled or
 * accidental: `edgeRuns` groups the band members per side, fits a line
 * through each run, and `isFalseEdge` says whether the result reads as the
 * track edge. `barriers.ts` builds runs out of `arcTile` and
 * `copyToPoints` and never sees that detector. So the interesting question
 * is not "did the nodes emit what I told them to" — it is whether the
 * runs, handed back to the rule that describes them, come back as RUNS:
 * found at all, parallel, and tight.
 *
 * WHAT IS PINNED:
 *
 *   - every planned run is found again by `edgeRuns`, one for one;
 *   - each comes back with |slope| under `FALSE_EDGE.divergence[0]` and a
 *     worst residual no worse than `BARRIER.residualW.median`, so none of
 *     them is a false edge by the rule's own definition;
 *   - the piece count and the run length land inside `BARRIER`'s p10..p90;
 *   - ONE piece choice per run, on every tile of it — the atomicity
 *     `arcTile`'s `rangeNames` exists to deliver;
 *   - the pitch is EXACTLY uniform inside a run and spread between them,
 *     which is the G3 measurement: the pooled spacing CV is a between-run
 *     figure and needs no within-run jitter to produce. The spread is
 *     claimed over seeds 1..`SWEEP_SEEDS` and not over the pinned one,
 *     because a bound that only holds on the pin is a statement about the
 *     pin;
 *   - `copyToPoints` actually moved the pieces off the curve, checked
 *     against `arcTile`'s own documented frame rather than against the
 *     road's, since the two disagree on a banked corner;
 *   - the same seed cooks the same runs, and shuffling the ranges cloud's
 *     order changes nothing about where a piece lands — where "where"
 *     includes the WORLD POSITION and not only the track coordinates,
 *     since `P` is what this builder actually produces.
 *
 * THE BUILDER IS NOT WIRED INTO THE DRESSING and this suite is why it does
 * not need to be: it cooks the barrier graph on the reference lap by
 * itself, so nothing here moves when `dressGraph.ts` does.
 */
import { describe, expect, it } from "vitest";
import { Graph, cook, dataInput, firstGeometry, makeGeometryItem, type Geometry } from "pcg-ts";
import {
  BARRIER_RUN,
  type BarrierRun,
  planBarriers,
  writeBarriers,
} from "../demos/racetrack/barriers.js";
import { BARRIER, FALSE_EDGE, edgeRuns, inEdgeBand, isFalseEdge } from "../demos/racetrack/falseEdges.js";
import { TRACK_FRAME } from "../demos/racetrack/graph.js";
import type { Lap } from "../demos/racetrack/lap.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { rand } from "../demos/racetrack/rand.js";
import { lapAsPath } from "../demos/racetrack/stationGraph.js";
import { lapFor } from "./support/lap.js";

const SEED = 7;
const RUN_COUNT = 12;
const PIECE_COUNT = 6;

/**
 * How many seeds the between-run spread is claimed over: 1..`SWEEP_SEEDS`.
 *
 * A STATED POPULATION, because a pooled statistic without one is the thing
 * PLAN.md's "How to measure a generator" was written against. Every number
 * this suite quotes for the spacing CV carries this range with it.
 */
const SWEEP_SEEDS = 40;

/**
 * The floor the pooled spacing CV clears on EVERY seed of that sweep.
 *
 * Measured, not chosen: 0.083 at seed 29 is the worst of the forty, and
 * the median is 0.255. This sits under the whole observed range rather
 * than against its edge, so the assertion fails when the spread collapses
 * and not when a seed lands low.
 */
const SPACING_CV_FLOOR = 0.05;

/** A placement stub: the detector reads only station, t, h and size. */
function placementAt(station: number, t: number, h: number): StationedPlacement {
  return {
    station,
    t,
    h,
    asset: {
      id: 1,
      name: "stub",
      shape: "box",
      instances: 1,
      size: { across: 0.4, along: 0.4, tall: 0.4 },
    },
  };
}

interface Built {
  readonly lap: Lap;
  readonly runs: BarrierRun[];
  readonly geo: Geometry;
}

/** Plan, cook and read back. `order` may permute the ranges cloud. */
async function build(seed: number, order?: (runs: BarrierRun[]) => BarrierRun[]): Promise<Built> {
  const { lap } = await lapFor(seed);
  const planned = planBarriers(lap.lengthW, seed, {
    count: RUN_COUNT,
    pieceCount: PIECE_COUNT,
  });
  const runs = order ? order([...planned]) : planned;
  const g = new Graph(seed);
  const pathIn = g.add(dataInput, {}, "lapPath");
  g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
  const out = writeBarriers(
    g,
    pathIn,
    runs,
    { lapW: lap.lengthW, halfWidth: lap.halfWidth },
    "l5",
  );
  g.output(out, "out", "barriers");
  const geo = firstGeometry((await cook(g)).outputs["barriers"] ?? []);
  if (!geo) throw new Error("the barrier graph produced no geometry");
  return { lap, runs, geo };
}

interface Piece {
  readonly station: number;
  readonly t: number;
  readonly h: number;
  readonly run: number;
  /** The PLAN's id for the run, which is not the same column as `run`. */
  readonly runId: number;
  readonly tile: number;
  readonly piece: number;
  readonly P: number[];
}

function readPieces(geo: Geometry): Piece[] {
  const p = geo.attrs.point;
  const station = p.require(TRACK_FRAME.station);
  const t = p.require("trackT");
  const h = p.require("trackH");
  const run = p.require(BARRIER_RUN.run);
  const runId = p.require(BARRIER_RUN.runId);
  const tile = p.require(BARRIER_RUN.tile);
  const piece = p.require(BARRIER_RUN.piece);
  const P = p.require("P");
  const out: Piece[] = [];
  for (let i = 0; i < p.count; i++) {
    out.push({
      station: station.get(i),
      t: t.get(i),
      h: h.get(i),
      run: run.get(i),
      runId: runId.get(i),
      tile: tile.get(i),
      piece: piece.get(i),
      P: P.getTuple(i),
    });
  }
  return out;
}

/** The pieces of one run, in tile order. */
function byRun(pieces: readonly Piece[]): Map<number, Piece[]> {
  const out = new Map<number, Piece[]>();
  for (const q of pieces) {
    const list = out.get(q.run) ?? [];
    list.push(q);
    out.set(q.run, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.tile - b.tile);
  return out;
}

const cv = (xs: readonly number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v) / m;
};

/**
 * A key that says WHERE a piece is, to the precision the columns hold.
 *
 * `P` IS IN IT, AND THAT IS THE POINT OF IT. The track coordinates are
 * what a rule downstream reads, but the world position is what this
 * builder PRODUCES — `copyToPoints` composing the tile's frame with the
 * run's offset — and a key without it cannot see a piece move. It could
 * not, in one specific way that is not hypothetical: `barrierOffsets`
 * writes its source cloud in run order, so an offset that depended on a
 * point's INDEX in that cloud rather than on its run would survive a
 * shuffle in `station`, `t` and `h` and land the piece somewhere else.
 * The key was blind to it and now is not; see the note on the
 * order-invariance test.
 *
 * Four decimals for `P` as for everything else, and they mean the same
 * thing here: determinism in this repo is bit-exact, so two cooks that
 * agree at all agree exactly, and the rounding is what keeps a printed
 * key readable rather than a tolerance being spent.
 *
 * `runId` IS IN IT AND `run` IS NOT, which is the distinction the two
 * columns exist for. `run` is `arcTile`'s range index — a POSITION in the
 * ranges cloud, so it MUST move when the cloud is shuffled and a key
 * carrying it would fail the order-invariance test for being correct.
 * `runId` is what the plan decided, so it must NOT move, and the same
 * shuffle is what proves it does not.
 */
const rowKey = (q: Piece): string =>
  `${q.station.toFixed(4)}|${q.t.toFixed(4)}|${q.h.toFixed(4)}|${q.piece}|${q.tile}|${q.runId}|` +
  q.P.map((v) => v.toFixed(4)).join(",");

describe("L-5 barrier runs, built", () => {
  it("come back through L-5's own detector as parallel, tight runs", async () => {
    const { lap, runs, geo } = await build(SEED);
    const pieces = readPieces(geo);
    expect(runs.length, "the lap held the runs it was asked for").toBeGreaterThanOrEqual(8);

    // EVERY PIECE IS IN THE BAND THE DETECTOR LOOKS IN, checked before the
    // runs are, because a run the detector never sees would make the
    // assertions below vacuously true.
    const placements = pieces.map((q) => placementAt(q.station, q.t, q.h));
    for (const p of placements) {
      expect(inEdgeBand(p), `a piece at t=${p.t} h=${p.h} is outside the edge band`).toBe(true);
    }

    const found = edgeRuns(placements, lap.lengthW);
    expect(found.length, "one detected run per planned run").toBe(runs.length);

    let worstSlope = 0;
    let worstResidual = 0;
    for (const r of found) {
      worstSlope = Math.max(worstSlope, Math.abs(r.slope));
      worstResidual = Math.max(worstResidual, r.residualW);
      expect(
        Math.abs(r.slope),
        `a built run diverges: slope ${r.slope} at ${r.startW}W`,
      ).toBeLessThan(FALSE_EDGE.divergence[0]);
      // AT LEAST AS TIGHT AS THE CATALOGUE, and in practice exactly zero.
      // The catalogue's 0.063W median is a wobble, and reproducing it with
      // a per-piece draw would reproduce the divergence rate it comes with
      // — see `barriers.ts` for the arithmetic. One lateral per run is the
      // non-divergence being added deliberately, which is what
      // `falseEdges.ts` asks a generator to do.
      expect(
        r.residualW,
        `a built run is looser than the catalogue's median: ${r.residualW}W`,
      ).toBeLessThanOrEqual(BARRIER.residualW.median);
      expect(isFalseEdge(r), `a built run reads as a false edge at ${r.startW}W`).toBe(false);
    }
    // The runs are long enough to have been judged. A run under
    // `minSpanW` fails `isFalseEdge` on its length alone, which would
    // make the assertion above say nothing.
    for (const r of found) {
      expect(r.spanW, "a run too short to be judged as an edge").toBeGreaterThanOrEqual(
        FALSE_EDGE.minSpanW,
      );
    }
    console.log(
      `L-5 built: ${runs.length} runs, ${pieces.length} pieces, ` +
        `worst |slope| ${worstSlope.toExponential(2)} (limit ${FALSE_EDGE.divergence[0]}), ` +
        `worst residual ${worstResidual.toExponential(2)}W ` +
        `(catalogue median ${BARRIER.residualW.median}W)`,
    );
  });

  it("is judged by a detector that can still say yes", async () => {
    // THE CONTROL, and without it the test above is worth nothing: a
    // detector that never fires would pass it on any input at all. So one
    // built run is TILTED into exactly the defect L-5 forbids — its
    // lateral walked outward at a fixed rate per W of lap, landing the
    // slope in the middle of `FALSE_EDGE.divergence` — and the same call
    // on the same population must come back with that run, and only that
    // run, classified.
    //
    // THE FIRST SPELLING OF THIS DID NOT FIRE, and the reason is worth
    // keeping: a tilt written per PIECE is a slope divided by the pitch,
    // which came to 0.012 and sat under the threshold, and it walked the
    // far end of the run past `lateralW[1]` so the members left the band
    // and the run stopped existing. Both are ways for a control to look
    // like a passing rule. The tilt is written against the STATION and
    // sized to stay in the band for that reason.
    const { lap, geo } = await build(SEED);
    const pieces = readPieces(geo);
    const groups = byRun(pieces);
    const victim = [...groups.keys()].sort(
      (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0),
    )[0];
    const members = groups.get(victim) ?? [];
    const base = FALSE_EDGE.lateralW[0] + 0.1;
    const spanW = members[members.length - 1].station - members[0].station;
    const rate = Math.min(0.05, (FALSE_EDGE.lateralW[1] - 0.1 - base) / spanW);
    expect(rate, "the run is too long to tilt inside the band").toBeGreaterThan(
      FALSE_EDGE.divergence[0],
    );
    const tilted = pieces.map((q) =>
      placementAt(
        q.station,
        q.run === victim
          ? Math.sign(q.t) * (base + rate * (q.station - members[0].station))
          : q.t,
        q.h,
      ),
    );
    // Still in the band, or the run would vanish rather than diverge.
    for (const p of tilted) {
      expect(inEdgeBand(p), `the tilt pushed a member out of the band at t=${p.t}`).toBe(true);
    }
    const bad = edgeRuns(tilted, lap.lengthW).filter(isFalseEdge);
    expect(bad.length, "the tilted run was not caught, so the rule is asleep").toBe(1);
    expect(bad[0].members.length, "a different run was caught").toBe(members.length);
  });

  it("cooks a lap with no barriers on it to nothing, rather than refusing", async () => {
    // A LAP MAY HAVE NO BARRIERS AND THAT IS AN ANSWER. The clouds are one
    // point per run, so an empty plan is an empty cloud — and `arcTile`
    // refuses a range of zero length, so padding the cloud to one point
    // would turn "nothing to build" into a failed cook.
    const { lap } = await lapFor(SEED);
    const g = new Graph(SEED);
    const pathIn = g.add(dataInput, {}, "lapPath");
    g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
    const out = writeBarriers(
      g,
      pathIn,
      [],
      { lapW: lap.lengthW, halfWidth: lap.halfWidth },
      "l5empty",
    );
    g.output(out, "out", "barriers");
    const geo = firstGeometry((await cook(g)).outputs["barriers"] ?? []);
    expect(geo?.attrs.point.count ?? 0, "an empty plan built something").toBe(0);
  });

  it("stays inside the catalogue's published bands", async () => {
    const { runs, geo } = await build(SEED);
    const groups = byRun(readPieces(geo));
    expect(groups.size, "one group per run").toBe(runs.length);

    for (const [r, list] of groups) {
      const planned = runs[r];
      expect(list.length, `run ${r} emitted a different count than it planned`).toBe(
        planned.pieces,
      );
      expect(list.length, `run ${r} has too few pieces`).toBeGreaterThanOrEqual(
        BARRIER.piecesPerRun.p10,
      );
      expect(list.length, `run ${r} has too many pieces`).toBeLessThanOrEqual(
        BARRIER.piecesPerRun.p90,
      );
      // Measured on what came out, not on what was planned: the span is
      // first piece to last, which is what `BARRIER.runLengthW` reports.
      const span = (list.length - 1) * planned.pitchW;
      expect(span, `run ${r} is shorter than the catalogue's p10`).toBeGreaterThanOrEqual(
        BARRIER.runLengthW.p10 - 1e-6,
      );
      expect(span, `run ${r} is longer than the catalogue's p90`).toBeLessThanOrEqual(
        BARRIER.runLengthW.p90 + 1e-6,
      );
    }
  });

  it("chooses its piece ONCE per run, not once per tile", async () => {
    // THE ATOMICITY `rangeNames` EXISTS FOR. The choice is made on the
    // range point, where there is exactly one element per run, and copied
    // onto every tile. A per-tile draw would be uniform only by accident,
    // and the run would stop looking like one object repeated.
    const { runs, geo } = await build(SEED);
    const groups = byRun(readPieces(geo));
    for (const [r, list] of groups) {
      const distinct = new Set(list.map((q) => q.piece));
      expect(distinct.size, `run ${r} used ${distinct.size} pieces`).toBe(1);
      expect([...distinct][0], `run ${r} carries the wrong piece`).toBe(runs[r].piece);
      // The lateral and the height are atomic for the same reason, and
      // theirs is the one the DIVERGENCE test above rests on.
      expect(new Set(list.map((q) => q.t.toFixed(6))).size, `run ${r} wandered laterally`).toBe(1);
      expect(new Set(list.map((q) => q.h.toFixed(6))).size, `run ${r} wandered in height`).toBe(1);
    }
    // More than one piece is in play, so "one per run" is a finding rather
    // than a vocabulary of size one.
    expect(new Set([...groups.values()].map((l) => l[0].piece)).size).toBeGreaterThan(1);
  });

  it("names the run that assembled each piece, on a column that is not its place in the cloud", async () => {
    // WHY A PIECE HAS TO SAY THIS AT ALL. `falseEdges.ts`' repair reads
    // one column to tell an ASSEMBLED member from a station-born one,
    // because a barrier run is parallel only in isolation: on a real lap
    // a stray placement within `gapW` joins the run and tilts it, and the
    // repair lowering the tilted line's middle punches a hole in the
    // barrier instead of moving the joiner. See
    // `tests/racetrackBarrierMerge.test.ts` for that measurement; this is
    // only the claim that the column exists and carries the plan's answer.
    const { runs, geo } = await build(SEED);
    // Zero-based, in station order, no gaps — and never negative, since
    // `STATION_BORN` is -1 and L-6's cover ids are `-2 - index()`. All
    // three are read off one column and none of them may collide.
    expect(
      runs.map((r) => r.runId),
      "the plan's ids are not its own positions",
    ).toEqual(runs.map((_, i) => i));
    for (const q of readPieces(geo)) {
      expect(q.runId, "a piece carries an id no run has").toBe(runs[q.run].runId);
      expect(q.runId, "a barrier piece read as station-born").toBeGreaterThanOrEqual(0);
    }

    // AND THE TWO COLUMNS COME APART UNDER A SHUFFLE, which is the whole
    // reason they are two. `run` is `arcTile`'s `rangeIndexAttr` and has
    // to be the cloud's position, because that is the key `copyToPoints`
    // pairs the offsets on. `runId` is the plan's, and travels with the
    // run. Without the perturbation "they agree" would be a statement
    // about one being a copy of the other.
    const shuffled = await build(SEED, (rs) => rs.reverse());
    const pieces = readPieces(shuffled.geo);
    expect(
      pieces.some((q) => q.run !== q.runId),
      "the shuffle did not separate the two columns, so nothing was tested",
    ).toBe(true);
    for (const q of pieces) {
      expect(q.runId, "a shuffled piece took the id of whoever sat in its slot").toBe(
        shuffled.runs[q.run].runId,
      );
    }
  });

  it("has no jitter inside a run and all of its spread between them", async () => {
    // THE G3 MEASUREMENT, AS AN ASSERTION. `BARRIER.spacingW.cv` of 0.37
    // is pooled over runs of DIFFERENT pitches. Nothing inside a run
    // varies here — `arcTile` draws no random number — and the pooled
    // figure still lands nowhere near C-1's 1.5-2.5 for scattered
    // furniture, which is the contrast the CV was reported for.
    //
    // THE GAPS ARE TAKEN ON THE LOOP, like every other station difference
    // in this demo. A run may cross the start line and the station column
    // wraps at `lapW`, so a raw difference inside such a run is a large
    // NEGATIVE number — which would sail under the `gapW` check and drag
    // the pooled CV to nonsense. Seed 7 has no wrapping run and seed 1
    // does: read raw, seed 1 pools to -14.
    const { lap, runs, geo } = await build(SEED);
    const groups = byRun(readPieces(geo));
    const pooled: number[] = [];
    for (const [r, list] of groups) {
      const gaps: number[] = [];
      for (let i = 1; i < list.length; i++) {
        const d = list[i].station - list[i - 1].station;
        gaps.push(d < 0 ? d + lap.lengthW : d);
      }
      // Within a run: identical to the f32 the station column holds.
      const spread = Math.max(...gaps) - Math.min(...gaps);
      expect(spread, `run ${r} has a jittered pitch`).toBeLessThan(1e-3);
      for (const g of gaps) {
        expect(g, `run ${r} has a gap that would end it`).toBeLessThan(FALSE_EDGE.gapW);
        pooled.push(g);
      }
    }
    const pooledCv = cv(pooled);
    expect(pooledCv, "this is assembly, not scattered furniture").toBeLessThan(
      BARRIER.furnitureCv[0],
    );

    // THE COOKED FIGURE IS THE PLANNED ONE, and this is the assertion that
    // says so. `arcTile` spaces its tiles at `lengthW / pieces` and draws
    // no random number, so every pooled gap is its own run's planned
    // pitch. That is what lets the sweep below measure the PLAN — where
    // there is no start-line seam to re-derive and no cook to pay for —
    // and still be a statement about what gets built.
    const fromPlan: number[] = [];
    for (const r of runs) for (let i = 1; i < r.pieces; i++) fromPlan.push(r.pitchW);
    expect(fromPlan.length, "the plan and the cook disagree on how many gaps there are").toBe(
      pooled.length,
    );
    expect(cv(fromPlan), "the cooked spacing is not the planned spacing").toBeCloseTo(pooledCv, 5);
    console.log(
      `L-5 spacing: pooled CV ${pooledCv.toFixed(3)} over ${pooled.length} gaps, ` +
        `within-run CV 0 by construction (catalogue ${BARRIER.spacingW.cv}, ` +
        `furniture ${BARRIER.furnitureCv[0]}-${BARRIER.furnitureCv[1]})`,
    );
  });

  it("keeps its between-run spread on every seed of the sweep, not just the pinned one", async () => {
    // WHY THIS IS A SWEEP AND THE TEST ABOVE IS NOT. "The pooled CV is
    // bounded away from zero" is a claim about the BUILDER, and the test
    // above could only ever have been a claim about seed 7: it asserted
    // `> 0.1` on one pinned seed, and seed 29 pools to 0.083. A bound that
    // holds on the pin and not on the population is a false pass whatever
    // number is written in it, so the fix is the population and not the
    // constant. Loosening `0.1` until seed 29 fitted under it would have
    // hidden exactly the thing worth knowing.
    //
    // WHAT THE FLOOR IS AND IS NOT. It is not a target and nothing was
    // tuned to it: over seeds 1..40 the pooled CV runs 0.083 to 0.353 with
    // a median of 0.255, and {@link SPACING_CV_FLOOR} sits under the whole
    // observed range with room to move. The claim it pins is the weak one
    // the CV was ever for — a set of runs at ONE pitch would pool to zero,
    // and these do not — while the upper bound is the one with the
    // finding in it.
    const seen: number[] = [];
    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      const { lap } = await lapFor(seed);
      const planned = planBarriers(lap.lengthW, seed, {
        count: RUN_COUNT,
        pieceCount: PIECE_COUNT,
      });
      const pooled: number[] = [];
      for (const r of planned) for (let i = 1; i < r.pieces; i++) pooled.push(r.pitchW);
      const c = cv(pooled);
      seen.push(c);
      expect(
        c,
        `seed ${seed} of the swept 1..${SWEEP_SEEDS}: pooled CV ${c.toFixed(3)} says ` +
          `these runs are all at one pitch`,
      ).toBeGreaterThan(SPACING_CV_FLOOR);
      expect(
        c,
        `seed ${seed} of the swept 1..${SWEEP_SEEDS}: pooled CV ${c.toFixed(3)} is ` +
          `scattered furniture, not assembly`,
      ).toBeLessThan(BARRIER.furnitureCv[0]);
    }
    const sorted = [...seen].sort((a, b) => a - b);
    const median = (sorted[SWEEP_SEEDS / 2 - 1] + sorted[SWEEP_SEEDS / 2]) / 2;
    console.log(
      `L-5 spacing over seeds 1..${SWEEP_SEEDS}: pooled CV median ${median.toFixed(3)}, ` +
        `range ${sorted[0].toFixed(3)}-${sorted[SWEEP_SEEDS - 1].toFixed(3)} ` +
        `(floor ${SPACING_CV_FLOOR}, catalogue ${BARRIER.spacingW.cv})`,
    );
  });

  it("stands the pieces off the curve, in arcTile's own frame", async () => {
    // WHAT `copyToPoints` ACTUALLY DID. `arcTile` places ON the path; the
    // barrier stands beside it. The expected position is rebuilt here from
    // the polyline alone — `orientQuat`'s right is `up x forward` with the
    // fixed `[0, 1, 0]` hint, which is LEFT of travel, so `trackT` enters
    // negated — rather than from the road's own `across`, because the road
    // is swept on the surface normal and the two frames disagree wherever
    // the lap banks.
    const { lap, geo } = await build(SEED);
    const pieces = readPieces(geo);
    let worst = 0;
    for (const q of pieces) {
      const arc = q.station * lap.halfWidth;
      let k = 0;
      while (k + 1 < lap.count && lap.s[k + 1] <= arc) k++;
      const next = (k + 1) % lap.count;
      const segLen = (k + 1 < lap.count ? lap.s[k + 1] : lap.length) - lap.s[k];
      const f = segLen > 0 ? (arc - lap.s[k]) / segLen : 0;
      const a = [lap.p[k * 3], lap.p[k * 3 + 1], lap.p[k * 3 + 2]];
      const b = [lap.p[next * 3], lap.p[next * 3 + 1], lap.p[next * 3 + 2]];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const dl = Math.hypot(d[0], d[1], d[2]);
      const fwd = [d[0] / dl, d[1] / dl, d[2] / dl];
      const on = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
      // right = up x forward, the vector `orientQuat` puts on local +x.
      let rx = fwd[2];
      let ry = 0;
      let rz = -fwd[0];
      const rl = Math.hypot(rx, ry, rz);
      rx /= rl;
      ry /= rl;
      rz /= rl;
      // u = forward x right, local +y.
      const ux = fwd[1] * rz - fwd[2] * ry;
      const uy = fwd[2] * rx - fwd[0] * rz;
      const uz = fwd[0] * ry - fwd[1] * rx;
      const lateral = -q.t * lap.halfWidth;
      const height = q.h * lap.halfWidth;
      const want = [
        on[0] + rx * lateral + ux * height,
        on[1] + ry * lateral + uy * height,
        on[2] + rz * lateral + uz * height,
      ];
      worst = Math.max(
        worst,
        Math.hypot(q.P[0] - want[0], q.P[1] - want[1], q.P[2] - want[2]),
      );
      // And it is a real offset rather than a rounding difference: the
      // piece is a lateral and a height away from the curve.
      const off = Math.hypot(q.P[0] - on[0], q.P[1] - on[1], q.P[2] - on[2]);
      expect(off, "a piece is sitting on the centreline").toBeGreaterThan(
        0.5 * lap.halfWidth,
      );
    }
    // The tolerance is the segment the station lands on: this rebuilds the
    // interpolation in f64 from an f32 station column, so it is the
    // station's own precision and not the node's.
    expect(worst, "a piece is not where the composed transform puts it").toBeLessThan(
      0.02 * lap.halfWidth,
    );
    console.log(
      `L-5 offset: worst disagreement with the composed transform ` +
        `${worst.toExponential(2)} world units on a half-width of ${lap.halfWidth.toFixed(2)}`,
    );
  });

  it("cooks the same runs twice, and does not care what order they arrive in", async () => {
    // THE KEY INCLUDES `P`, AND IT WAS CHECKED THAT IT HAS TO. Without it
    // the comparison was station, lateral, height, piece and tile — every
    // column except the one this file exists to produce. Perturbed to
    // prove the strengthening binds: `barrierOffsets` writing
    // `-r.t * halfWidth + i * 0.01`, an offset keyed on a point's INDEX in
    // the source cloud instead of on its run, moves every piece in the
    // world and leaves station, `trackT` and `trackH` untouched. The
    // shuffle then re-indexes the cloud and the pieces land somewhere
    // else. With `P` in the key the order-invariance assertion below goes
    // red; with the old key the SAME broken builder passes green. That is
    // the difference the column makes, and it is why a determinism test
    // over a derived coordinate is not one over the output.
    const first = await build(SEED);
    const again = await build(SEED);
    const a = readPieces(first.geo).map(rowKey).sort();
    const b = readPieces(again.geo).map(rowKey).sort();
    expect(b, "the same seed cooked a different lap of barriers").toEqual(a);

    // ORDER INVARIANCE, the same shape the dress graph's suite uses: a
    // local Fisher-Yates driven by this demo's own `rand`, never
    // `Math.random`, so the shuffle is part of the fixture rather than a
    // source of flake.
    const shuffled = await build(SEED, (runs) => {
      for (let i = runs.length - 1; i > 0; i--) {
        const j = Math.floor(rand(SEED, i, 0x51de) * (i + 1));
        [runs[i], runs[j]] = [runs[j], runs[i]];
      }
      return runs;
    });
    // The premise: the shuffle really did move the ranges cloud.
    expect(
      shuffled.runs.map((r) => r.startW),
      "the shuffle left the order alone",
    ).not.toEqual(first.runs.map((r) => r.startW));
    const c = readPieces(shuffled.geo).map(rowKey).sort();
    expect(c, "a piece moved when its run changed places in the cloud").toEqual(a);
  });
});
