/**
 * L-5's barrier runs ON A REAL LAP, which is the population the builder's
 * own suite structurally cannot see.
 *
 * WHY A SECOND FILE. `tests/racetrackBarriers.test.ts` cooks barriers on an
 * EMPTY lap: the only placements in it are the pieces it just made, so
 * `edgeRuns` finds one run per planned run and every one of them comes back
 * with |slope| exactly 0. That is a true statement about the builder and it
 * is not a statement about the demo, because a barrier run is parallel only
 * IN ISOLATION. Drop it on a settled lap and `edgeRuns` chains every band
 * member on that side within `gapW = 3W`, so a station-born placement that
 * happens to sit within three half-widths of the line JOINS the run — and
 * the merged run is no longer flat.
 *
 * THE TWO MEASUREMENTS THIS SUITE RE-ASSERTS, both of which were made on
 * this harness (`dressedLapFor`, the shipped vocabulary) before either fix
 * was written:
 *
 *   L-1  barriers placed blind put 11.84% of their pieces (173 of 1461,
 *        8.65 per lap) inside the driver's look-ahead cone. Neither of the
 *        cull's answers is acceptable to a RUN — the per-piece push takes
 *        77 of the 173 pieces it MOVED (44.5%) outside |t| in [1, 2.5],
 *        and run-atomic culling costs 2.05 runs a lap — so the planner asks
 *        `blocksCone` BEFORE accepting a candidate.
 *
 *        THE DENOMINATOR IS `moved` AND IT IS WORTH SPELLING OUT, because
 *        it coincided with `blocking` on that run and the two are not the
 *        same quantity. `cullSightlines` splits its blockers exactly:
 *        `blocking == moved + dropped`, where a piece is dropped when the
 *        caller's `dropRatherThanMove` claims it or when the push ladder
 *        runs out at `maxPushW` still blocked. Only a MOVED piece has a
 *        final lateral, so only `moved` can be the denominator of "landed
 *        outside the band".
 *
 *        AND `dropped == 0` IS A PROPERTY OF THE POPULATION, NOT OF THE
 *        CULL. On the blind sweep below it holds — every one of the twelve
 *        seeds returns `moved == blocking`, 118 and 0 pooled — which is
 *        why the two readings agree here. It does NOT hold on the
 *        dressing: `dress.ts` passes a `dropRatherThanMove` for L-3 and
 *        `racetrackDressGraph.test.ts` asserts a non-zero `dropped` there.
 *        So the figure is wrong the moment it is quoted against `blocking`
 *        on a population that drops.
 *
 *        Both counters are QUOTED, NOT ASSERTED, like every other figure
 *        in this header: the blind branch below reads `blocking` alone,
 *        because what it controls for is that a blind plan blocks at all.
 *        (The one `moved`/`dropped` assertion in this file is on the
 *        AVOIDED plan, where it is entailed by `blocking == 0`.)
 *
 *   L-5  after the merge, 26.7% of the 288 runs clear the 0.02 slope floor
 *        and 7.3% of the barrier-touching ones are accepted by
 *        `isFalseEdge`. Repairing them blind lowers a BARRIER piece in
 *        76.2% of moves, always an interior one — a hole punched in the
 *        middle of the assembled line. Preferring the station-born member
 *        clears every edge with no barrier victims at the same move count.
 *
 * RE-MEASURED HERE OVER SEEDS 1..12, at this file's own piece size, and
 * the figures are quoted rather than asserted for the reason PLAN.md gives
 * — the assertions below are the ones every seed clears:
 *
 *   L-1  blind blocks 118 of 874 pieces (13.50%, 9.83 per lap); the cone
 *        test blocks 0 and still places 12 of 12 runs on every seed, with
 *        the median span moving 8.70W -> 8.17W.
 *   L-5  11 false edges over the sweep, cleared in 12 moves with 0 barrier
 *        victims; the same population repaired blind takes 18 moves and 13
 *        barrier victims, 72.2%.
 *
 * EVERY ONE OF THOSE HAS A CONTROL HERE AND THE CONTROLS MUST FIRE, per
 * PLAN.md's "How to measure a generator": the blind plan is re-run so the
 * cone test is shown to be what fixed the cone, the blind repair is re-run
 * so the preference is shown to be what saved the barriers, and the
 * detector is handed a deliberately tilted run so a green cannot come from
 * a rule that is asleep. A check that cannot be made to fail proves
 * nothing.
 *
 * THE SWEEP MEASURES THE PLAN, NOT A COOK, AND ONE TEST SAYS WHY THAT IS
 * THE SAME POPULATION. Cooking a barrier graph per seed buys nothing the
 * plan does not already fix — `arcTile` draws no random number and spaces
 * its tiles at `lengthW / pieces` — so "the cook is the plan" is asserted
 * once, at the pinned seed, and the sweep then runs on `barrierStations`.
 * `P` stays pinned where it is produced, in the builder's suite.
 */
import { describe, expect, it } from "vitest";
import { Graph, cook, dataInput, firstGeometry, makeGeometryItem } from "pcg-ts";
import {
  BARRIER_RUN,
  type BarrierConeTest,
  type BarrierRun,
  type PieceSize,
  barrierStations,
  planBarriers,
  writeBarriers,
} from "../demos/racetrack/barriers.js";
import { frameLookup } from "../demos/racetrack/dress.js";
import {
  type RunPlacement,
  edgeRepairIsMinimal,
  edgeRuns,
  falseEdges,
  isAssembled,
  isFalseEdge,
  repairFalseEdges,
  repairTarget,
  FALSE_EDGE,
} from "../demos/racetrack/falseEdges.js";
import { TRACK_FRAME } from "../demos/racetrack/graph.js";
import type { Lap } from "../demos/racetrack/lap.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { rand } from "../demos/racetrack/rand.js";
import { cullSightlines, defaultEyeStations } from "../demos/racetrack/sightline.js";
import { lapAsPath } from "../demos/racetrack/stationGraph.js";
import { dressedLapFor } from "./support/lap.js";

/** The pinned seed, the same one the builder's suite pins. */
const SEED = 7;
const RUN_COUNT = 12;
const PIECE_COUNT = 6;

/**
 * The stated population: seeds 1..`SWEEP_SEEDS`.
 *
 * A DRESSED lap per seed rather than a bare one, which is what makes this
 * suite cost anything at all — every claim below is about the merge, and
 * there is no merge without the dressing. Twelve is the range every number
 * quoted in this file was re-measured over; the figures in the header come
 * from twenty and are quoted as the finding, not as an assertion.
 */
const SWEEP_SEEDS = 12;

/**
 * The floors the CONE CONTROL clears, per lap and pooled over that sweep.
 *
 * MEASURED, NOT CHOSEN. The per-lap one is what makes this a control: a
 * blind plan puts pieces in the driver's look-ahead cone on EVERY one of
 * these laps, and asserting only that the SUM is non-zero would be cleared
 * by one blocked piece on one seed out of twelve — the state a control that
 * had stopped controlling would also be in. The numbers are in the comment
 * at the assertion.
 */
const BLIND_PER_SEED = 4;
const BLIND_POOLED = 80;

/**
 * What a barrier piece occupies, in W along the track frame's three axes.
 *
 * ONE SIZE FOR THE WHOLE VOCABULARY HERE, because `piece` is an opaque
 * index and this suite is not testing asset resolution. It is on the large
 * side of a verge object on purpose: a piece that occludes nothing would
 * make the cone assertions below true for a reason that has nothing to do
 * with the planner.
 */
const PIECE: PieceSize = { across: 0.4, along: 0.9, tall: 0.5 };

/** A stub asset of the given piece index. Ids well clear of the kit's own. */
function pieceAsset(piece: number): StationedPlacement["asset"] {
  return {
    id: 9000 + piece,
    name: `l5piece${piece}`,
    shape: "box",
    instances: 1,
    size: { across: PIECE.across, along: PIECE.along, tall: PIECE.tall },
  };
}

/** L-1's question, as the planner and the cull both have to ask it. */
function coneFor(lap: Lap): BarrierConeTest {
  return {
    frameAt: frameLookup(lap),
    halfWidth: lap.halfWidth,
    // ONE EYE SET, built once and handed to both. `blocksCone`'s own note
    // says why: a placer asking in advance and a cull asking afterwards
    // must be asking about the same standpoints or the answer they agree
    // on is a coincidence.
    eyes: defaultEyeStations(lap.lengthW),
    pieceSize: () => PIECE,
  };
}

/** The pieces of a plan, as placements that name the run they came from. */
function barrierPlacements(runs: readonly BarrierRun[], lapW: number): RunPlacement[] {
  const out: RunPlacement[] = [];
  for (const r of runs) {
    for (const station of barrierStations(r, lapW)) {
      out.push({ station, t: r.t, h: r.h, runId: r.runId, asset: pieceAsset(r.piece) });
    }
  }
  return out;
}

/** The same pieces as occluders, for the cull to judge. */
function occludersFor(runs: readonly BarrierRun[], lapW: number) {
  return barrierPlacements(runs, lapW).map((p) => ({
    station: p.station,
    t: p.t,
    h: p.h,
    across: PIECE.across,
    along: PIECE.along,
    tall: PIECE.tall,
  }));
}

/**
 * The same population with the run column taken off — the lap the repair
 * saw before this change, and the control every "the preference did it"
 * claim below rests on.
 */
function stripRunId(p: RunPlacement): StationedPlacement {
  const { runId: _assembled, ...rest } = p;
  return rest;
}

interface Merged {
  readonly lap: Lap;
  readonly cone: BarrierConeTest;
  readonly runs: BarrierRun[];
  readonly settled: readonly RunPlacement[];
  readonly merged: RunPlacement[];
  /** The first index in `merged` that is a barrier piece. */
  readonly firstBarrier: number;
}

/** A settled lap with barriers dropped onto it. */
async function mergedFor(seed: number, avoid: boolean): Promise<Merged> {
  const { lap, dressing } = await dressedLapFor(seed);
  const cone = coneFor(lap);
  const runs = planBarriers(lap.lengthW, seed, {
    count: RUN_COUNT,
    pieceCount: PIECE_COUNT,
    ...(avoid ? { avoidCone: cone } : {}),
  });
  // COPIED, NOT ALIASED. `dressedLapFor` memoizes its dressing for the
  // process and every consumer treats it as read-only.
  const settled: RunPlacement[] = [...dressing.placements];
  const merged = [...settled, ...barrierPlacements(runs, lap.lengthW)];
  return { lap, cone, runs, settled, merged, firstBarrier: settled.length };
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/** WHICH placement was moved, independent of where it sat in the array. */
const movedKey = (p: RunPlacement): string =>
  `${p.station.toFixed(4)}|${p.t.toFixed(4)}|${p.h.toFixed(4)}|${p.runId ?? "-"}`;

describe("L-5 barriers merged onto a settled lap", () => {
  it("cooks the population this suite measures, so the plan stands in for it", async () => {
    // WHAT LETS THE SWEEP SKIP THE COOK. `arcTile` places its tiles at
    // sub-interval centres of `lengthW / pieces` and emits no randomness,
    // so `barrierStations` is the built station exactly — and `trackT`,
    // `trackH` and the new `l5RunId` ride onto the copies untouched. If
    // this ever stops being true the sweep below is measuring a
    // population the demo does not build, and this is the assertion that
    // says so.
    const { lap } = await dressedLapFor(SEED);
    const runs = planBarriers(lap.lengthW, SEED, {
      count: RUN_COUNT,
      pieceCount: PIECE_COUNT,
      avoidCone: coneFor(lap),
    });
    const g = new Graph(SEED);
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
    const p = geo.attrs.point;
    const station = p.require(TRACK_FRAME.station);
    const t = p.require("trackT");
    const h = p.require("trackH");
    const runId = p.require(BARRIER_RUN.runId);

    const want = barrierPlacements(runs, lap.lengthW);
    expect(p.count, "the cook and the plan disagree on how many pieces there are").toBe(
      want.length,
    );
    const cooked: string[] = [];
    for (let i = 0; i < p.count; i++) {
      cooked.push(
        `${station.get(i).toFixed(3)}|${t.get(i).toFixed(4)}|${h.get(i).toFixed(4)}|${runId.get(i)}`,
      );
    }
    const planned = want.map(
      (q) => `${q.station.toFixed(3)}|${q.t.toFixed(4)}|${q.h.toFixed(4)}|${q.runId}`,
    );
    expect(cooked.sort(), "a cooked piece is not where the plan put it").toEqual(planned.sort());
    // And the new column is a real id rather than a constant.
    expect(new Set(cooked.map((k) => k.split("|")[3])).size, "one runId for every run").toBe(
      runs.length,
    );
  });

  it("plans no barrier piece into the cone, where a blind plan puts them there", async () => {
    let blindBlocking = 0;
    let blindPieces = 0;
    let laps = 0;
    const blindPerSeed: number[] = [];
    const avoidedSpans: number[] = [];
    const blindSpans: number[] = [];

    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      const { lap } = await dressedLapFor(seed);
      const cone = coneFor(lap);
      const shared = { count: RUN_COUNT, pieceCount: PIECE_COUNT };

      const avoided = planBarriers(lap.lengthW, seed, { ...shared, avoidCone: cone });
      expect(
        avoided.length,
        `seed ${seed}: the cone test cost the lap a run — ${avoided.length} of ${RUN_COUNT}`,
      ).toBe(RUN_COUNT);
      // JUDGED BY THE CULL, not by the planner's own predicate: the claim
      // is that `cullSightlines` has nothing to do, and the only way to
      // say that is to run it.
      //
      // AND IT IS NEARLY A TAUTOLOGY, WHICH IS WORTH SAYING OUT LOUD. The
      // cull re-asks `blocksCone` over the same eyes, the same stations
      // and the same constant `pieceSize` the planner asked with, so what
      // this pair of assertions really pins is that `barrierStations`
      // agrees with `writeBarriers` and that the planner tested EVERY
      // piece rather than some of them — a run-atomic reject spelled
      // per-piece would fail here. It is not independent evidence that
      // the cone test works. The control below is; read the two together.
      const kept = cullSightlines(
        occludersFor(avoided, lap.lengthW),
        lap.lengthW,
        cone.frameAt,
        lap.halfWidth,
        cone.eyes,
      );
      expect(kept.blocking, `seed ${seed}: a planned barrier piece stands in the cone`).toBe(0);
      expect(kept.moved + kept.dropped, `seed ${seed}: the cull had to repair a barrier`).toBe(0);
      for (const r of avoided) avoidedSpans.push(r.spanW);

      // THE CONTROL. Same seed, same draws, no cone test — and it must
      // block, or the assertion above is about a cone nothing could ever
      // stand in.
      const blind = planBarriers(lap.lengthW, seed, shared);
      const blindOcc = occludersFor(blind, lap.lengthW);
      const blindCull = cullSightlines(
        blindOcc,
        lap.lengthW,
        cone.frameAt,
        lap.halfWidth,
        cone.eyes,
      );
      blindBlocking += blindCull.blocking;
      blindPieces += blindOcc.length;
      blindPerSeed.push(blindCull.blocking);
      laps++;
      for (const r of blind) blindSpans.push(r.spanW);
    }

    // THE CONTROL FIRES ON EVERY LAP, NOT SOMEWHERE IN TWELVE. `> 0` on a
    // sum over the sweep is cleared by one blocked piece on one seed, which
    // is exactly the state a broken control would be in — and the zeros it
    // justifies are per-seed. Measured over seeds 1..12: 7 blocked pieces
    // on the thinnest lap and 118 of 874 pooled (13.50%, 9.83 a lap), so
    // the per-lap floor sits under the whole observed range and the pooled
    // one well under the total.
    for (const [i, n] of blindPerSeed.entries()) {
      expect(
        n,
        `seed ${i + 1}: a blind plan put ${n} pieces in the cone, so the cone test is not ` +
          `what fixed the cone on this lap`,
      ).toBeGreaterThanOrEqual(BLIND_PER_SEED);
    }
    expect(
      blindBlocking,
      `a blind plan blocked ${blindBlocking} of ${blindPieces} pieces over seeds ` +
        `1..${SWEEP_SEEDS}; the cone test is not what fixed the cone`,
    ).toBeGreaterThanOrEqual(BLIND_POOLED);
    // THE SPANS ARE UNCHANGED, which is the other half of the finding: a
    // rejection sampler that clears the cone by only ever accepting short
    // runs would pass every assertion above and quietly stop building
    // barriers. Measured 8.29W -> 8.23W; asserted as a fifth, which is far
    // wider than anything observed and still fails a collapse.
    const a = median(avoidedSpans);
    const b = median(blindSpans);
    expect(
      Math.abs(a - b) / b,
      `the cone test moved the span distribution: ${b.toFixed(2)}W -> ${a.toFixed(2)}W`,
    ).toBeLessThan(0.2);
    console.log(
      `L-1 on barriers over seeds 1..${SWEEP_SEEDS}: blind blocks ${blindBlocking} of ` +
        `${blindPieces} pieces (${((100 * blindBlocking) / blindPieces).toFixed(2)}%, ` +
        `${(blindBlocking / laps).toFixed(2)} per lap, thinnest ` +
        `${Math.min(...blindPerSeed)}), avoided blocks 0; ` +
        `median span ${b.toFixed(2)}W -> ${a.toFixed(2)}W`,
    );
  });

  it("stays bounded, and degrades to fewer runs rather than looping", async () => {
    // THE ATTEMPT CEILING IS THE ONLY THING STOPPING THE SAMPLER and the
    // cone test does not change that. Asked for twelve runs in one
    // attempt, it returns at most one and returns.
    const { lap } = await dressedLapFor(SEED);
    const starved = planBarriers(lap.lengthW, SEED, {
      count: RUN_COUNT,
      pieceCount: PIECE_COUNT,
      maxTries: 1,
      avoidCone: coneFor(lap),
    });
    expect(starved.length, "a one-attempt plan placed more than one run").toBeLessThanOrEqual(1);

    // AND THE COST IS NOWHERE NEAR THE CEILING, even for a piece far
    // larger than anything on a verge: 2.0 x 1.1 x 2.5W was measured at
    // about 52 attempts a lap against a 2000 ceiling, so a 400 budget is
    // an order of margin. This is the observable stand-in for the attempt
    // count — the planner reports runs, not tries.
    const huge = coneFor(lap);
    const oversized: BarrierConeTest = {
      ...huge,
      pieceSize: () => ({ across: 2, along: 1.1, tall: 2.5 }),
    };
    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      const l = (await dressedLapFor(seed)).lap;
      const cone: BarrierConeTest = { ...coneFor(l), pieceSize: oversized.pieceSize };
      const runs = planBarriers(l.lengthW, seed, {
        count: RUN_COUNT,
        pieceCount: PIECE_COUNT,
        maxTries: 400,
        avoidCone: cone,
      });
      expect(
        runs.length,
        `seed ${seed}: an oversized piece cost the lap a run inside a 400-attempt budget`,
      ).toBe(RUN_COUNT);
    }
  });

  it("clears every false edge on the merged lap without lowering one barrier piece", async () => {
    let edgesFound = 0;
    let moves = 0;
    let blindVictims = 0;
    let blindMoves = 0;
    let sameCount = 0;

    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      const m = await mergedFor(seed, true);
      const rep = repairFalseEdges(m.merged, m.lap.lengthW);
      edgesFound += rep.before;
      moves += rep.moves;

      expect(rep.after, `seed ${seed}: a false edge survived the repair`).toBe(0);
      for (const move of rep.log) {
        expect(
          isAssembled(move.before),
          `seed ${seed}: the repair lowered a barrier piece of run ` +
            `${move.before.runId} at ${move.before.station.toFixed(2)}W`,
        ).toBe(false);
      }
      const { minimal, removable } = edgeRepairIsMinimal(rep, m.lap.lengthW);
      expect(minimal, `seed ${seed}: ${removable.length} moves could be put back`).toBe(true);

      // THE CONTROL. The identical population with the run column taken
      // off is the lap the old rule saw, and it must take barrier pieces
      // — otherwise the preference above is fixing something that was
      // never broken.
      const blind = repairFalseEdges(m.merged.map(stripRunId), m.lap.lengthW);
      expect(
        blind.before,
        `seed ${seed}: the two rules disagree about how many edges there are`,
      ).toBe(rep.before);
      blindMoves += blind.moves;
      if (blind.moves === rep.moves) sameCount++;
      for (const move of blind.log) if (move.index >= m.firstBarrier) blindVictims++;
    }

    expect(
      edgesFound,
      "the merge formed no false edge at all, so nothing above was tested",
    ).toBeGreaterThan(0);
    expect(
      blindVictims,
      "the blind repair took no barrier piece, so the preference fixed nothing",
    ).toBeGreaterThan(0);
    // AND IT COSTS NO EXTRA MOVES, which is what makes this a preference
    // and not a weaker rule.
    //
    // IT COSTS FEWER, AND THE REASON IS THE SPLIT FILTER RATHER THAN THE
    // PREFERENCE. The measured counterfactual for a bare "prefer the
    // station-born member" was the SAME move count; requiring the chosen
    // member to actually break the line — which `edgeRepairIsMinimal`
    // forces, see `repairTarget` — also declines the middles that leave
    // the line whole and cost a second pass. Measured over seeds 1..12:
    // 11 false edges, 12 moves and 0 barrier victims against the blind
    // rule's 18 moves and 13 victims (72.2%), with the two rules agreeing
    // on the count on 7 of the 12 seeds. Asserted as "no more", because
    // "fewer" is a property of these seeds and "no more" is the claim.
    expect(moves, "preferring the joiner cost extra moves").toBeLessThanOrEqual(blindMoves);
    console.log(
      `L-5 merged over seeds 1..${SWEEP_SEEDS}: ${edgesFound} false edges, ${moves} moves, ` +
        `0 barrier victims, same move count on ${sameCount}/${SWEEP_SEEDS} seeds ` +
        `(blind: ${blindMoves} moves, ${blindVictims} barrier victims, ` +
        `${((100 * blindVictims) / Math.max(1, blindMoves)).toFixed(1)}%)`,
    );
  });

  it("is judged on the merged lap by a detector that can still say yes", async () => {
    // THE DETECTOR CONTROL, on the MERGED population rather than on the
    // builder's isolated one. One barrier run is tilted into exactly the
    // defect L-5 forbids and the same call on the same lap must come back
    // with it.
    //
    // THE TILT IS AGAINST THE STATION AND SIZED TO STAY IN THE BAND, the
    // two traps `tests/racetrackBarriers.test.ts` records: a per-piece
    // tilt is a slope divided by the pitch and lands under the floor, and
    // a tilt that walks past `lateralW[1]` takes its members out of the
    // band so the run stops existing rather than diverging.
    // THE VICTIM MUST BE A RUN THE MERGE LEFT ALONE, and finding that out
    // is itself a measurement. A barrier run that DID pick up joiners
    // comes back with the joiners' own laterals scattered around the
    // tilted line: at the pinned seed, tilting one such run gives a
    // 15-member run of span 19.1W with |slope| 0.036 — inside the
    // divergence band — and a residual of 0.674W, which `isFalseEdge`
    // rejects on `straightW` (0.3). That is the detector working, not
    // sleeping, but it tests the joiners rather than the tilt. So the
    // control runs on a barrier run whose detected run is exactly its own
    // pieces, where the residual after tilting is 0 by construction and
    // the ONLY thing being judged is the slope.
    let picked: { seed: number; runId: number; members: number[] } | undefined;
    let lapW = 0;
    let population: RunPlacement[] = [];
    for (let seed = SEED; seed <= SEED + SWEEP_SEEDS && !picked; seed++) {
      const m = await mergedFor(seed, true);
      const repaired = repairFalseEdges(m.merged, m.lap.lengthW).placements;
      expect(
        falseEdges(repaired, m.lap.lengthW).length,
        `seed ${seed}: the lap was not clean to begin with`,
      ).toBe(0);
      for (const r of edgeRuns(repaired, m.lap.lengthW)) {
        const ids = new Set(r.members.map((i) => repaired[i].runId));
        if (ids.size !== 1) continue;
        const only = [...ids][0];
        if (only === undefined || only < 0) continue;
        // Not across the start line: the tilt is written against the raw
        // station column, which wraps.
        const st = r.members.map((i) => repaired[i].station);
        if (st.some((v, k) => k > 0 && v <= st[k - 1])) continue;
        if (r.spanW < FALSE_EDGE.minSpanW) continue;
        if (!picked || r.members.length > picked.members.length) {
          picked = { seed, runId: only, members: r.members };
          lapW = m.lap.lengthW;
          population = repaired;
        }
      }
    }
    expect(picked, "no barrier run survived the merge un-joined, so there is nothing to tilt")
      .toBeDefined();
    if (!picked) return;

    const members = picked.members;
    const base = FALSE_EDGE.lateralW[0] + 0.1;
    const origin = population[members[0]].station;
    const spanW = population[members[members.length - 1]].station - origin;
    const rate = Math.min(0.05, (FALSE_EDGE.lateralW[1] - 0.1 - base) / spanW);
    expect(rate, "the run is too long to tilt inside the band").toBeGreaterThan(
      FALSE_EDGE.divergence[0],
    );

    const tilted = [...population];
    for (const i of members) {
      const p = population[i];
      tilted[i] = { ...p, t: Math.sign(p.t) * (base + rate * (p.station - origin)) };
    }
    const bad = falseEdges(tilted, lapW);
    expect(bad.length, "the tilted run was not caught, so the rule is asleep").toBeGreaterThan(0);
    const caught = new Set(bad.flatMap((r) => r.members));
    expect(
      members.every((i) => caught.has(i)),
      "the run that was tilted is not the one that was caught",
    ).toBe(true);
    // AND THE REPAIR ACTS ON IT, which is the other half of the control:
    // a detector that fires into a repair that does nothing is the same
    // false pass one step later. Every member is assembled, so this is
    // the documented fallback and it DOES take a barrier piece.
    const rep = repairFalseEdges(tilted, lapW);
    expect(rep.after, "the tilted run was found and not repaired").toBe(0);
    expect(rep.moves, "the tilted run was repaired by doing nothing").toBeGreaterThan(0);
    console.log(
      `L-5 control: tilting run ${picked.runId} of seed ${picked.seed} ` +
        `(${members.length} pieces, ${spanW.toFixed(1)}W) at ${rate.toFixed(3)} W/W produced ` +
        `${bad.length} false edge(s), repaired in ${rep.moves} move(s)`,
    );
  });

  it("is inert on a lap with no barriers on it", async () => {
    // THE NO-OP, AND IT IS STRUCTURAL RATHER THAN INCIDENTAL. Nothing on a
    // settled lap carries a `runId`, so every member of every run is
    // station-born and `repairTarget` reduces to `members[floor(n/2)]` —
    // the rule that shipped, and the one `dressGraph.ts` spells as
    // `runIndex == floor(runCount / 2)`. Asserted over every run the
    // detector finds, not only over the ones it condemns, so the claim
    // does not depend on the lap happening to be clean.
    //
    // AND THE LAP IS CLEAN, which is the second half of the control: a
    // settled lap ALONE has no false edge on it, so everything the test
    // above repairs came out of the merge.
    let runs = 0;
    let clean = 0;
    for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
      const { lap, dressing } = await dressedLapFor(seed);
      const found = falseEdges(dressing.placements, lap.lengthW);
      expect(found.length, `seed ${seed}: the settled lap alone has a false edge`).toBe(0);
      clean++;
      for (const run of edgeRuns(dressing.placements, lap.lengthW)) {
        const target = repairTarget(run, dressing.placements, lap.lengthW);
        expect(
          target.index,
          `seed ${seed}: a run of ${run.members.length} at ${run.startW.toFixed(1)}W ` +
            `picked a different member than the old middle`,
        ).toBe(run.members[Math.floor(run.members.length / 2)]);
        expect(target.stationBorn, "a settled placement read as assembled").toBe(true);
        runs++;
      }
    }
    // The premise: there were runs to be inert over.
    expect(runs, "no run was found, so the no-op claim is vacuous").toBeGreaterThan(0);
    console.log(
      `L-5 settled lap over seeds 1..${SWEEP_SEEDS}: 0 false edges on ${clean}/${SWEEP_SEEDS}, ` +
        `old middle chosen on ${runs}/${runs} runs`,
    );
  });

  it("takes the candidate that leaves NO run behind, not the nearest one that leaves a short one", () => {
    // THE EMPTY REMAINDER, AND WHY IT HAS TO BE VACUOUSLY TRUE.
    // `breaksRun` asks whether lowering the k-th member leaves the run
    // with no false edge in it, and answers by folding `edgeRuns` over the
    // sub-population with `.every((r) => !isFalseEdge(r))`. Lowering a
    // member can leave fragments so short that `edgeRuns` returns NOTHING
    // — both sides of the hole under `minMembers` — and "no false edge
    // remains" is then true because there is nothing left that could be
    // one. That is the BEST outcome the filter can report, not an absent
    // one: the line was broken so thoroughly that the detector no longer
    // sees a line at all.
    //
    // WHICH IS WHY THE FOLD IS `every` AND NOT `some`. `every([])` is
    // true, `some([])` is false. The `some` spelling therefore rejects
    // exactly the member that cleared the run completely and walks on to a
    // nearer, weaker one that merely leaves a non-diverging remainder —
    // and both spellings agree on every other shape, which is what let it
    // hide.
    //
    // REPORTED DOWNSTREAM, and this is their minimal repro. A consumer's
    // mutation run found `every` -> `some` survived this suite along with
    // eleven other mutations, while diverging from the reference on 4.16%
    // of 25,000 random clouds. Confirmed here before the fixture was
    // written: with the mutation applied, all 365 racetrack tests passed.
    const lapW = 360;
    // [station, t, h, runId] — the ends assembled, the middle three
    // station-born, so `repairTarget` takes the joiner branch and has
    // candidates to walk.
    const all: RunPlacement[] = (
      [
        [10, 1.25, 0.4, 7],
        [12, 1.85, 0.4, -1],
        [14, 2.05, 0.4, -1],
        [16, 2.25, 0.4, -1],
        [18, 2.1, 0.4, 7],
      ] as const
    ).map(([station, t, h, runId]) => ({ station, t, h, runId, asset: pieceAsset(0) }));

    // THE PREMISE. One run, and one the detector condemns — a fixture that
    // stopped being a false edge would make every assertion below vacuous.
    const found = edgeRuns(all, lapW);
    expect(found.length, "the hand-built run was not found as one run").toBe(1);
    expect(isFalseEdge(found[0]), "the hand-built run is not a false edge").toBe(true);
    expect(found[0].members, "the run did not take every placement").toEqual([0, 1, 2, 3, 4]);

    // THE SHAPE THAT SEPARATES THE TWO SPELLINGS, asserted directly rather
    // than inferred from the choice. Lowering member 2 leaves a PAIR on
    // each side of the hole, both under `minMembers`, so `edgeRuns` returns
    // nothing at all.
    const lowered = (k: number): RunPlacement[] =>
      all.map((p, i) => (i === k ? { ...p, h: FALSE_EDGE.heightW[0] - 0.05 } : p));
    expect(
      edgeRuns(lowered(2), lapW).length,
      "lowering the middle no longer empties the run, so this fixture no longer " +
        "exercises the vacuous case",
    ).toBe(0);

    // AND THE CONTROL THAT MAKES THE CHOICE BIND. Member 1 is where the
    // `some` spelling goes instead, so it must be a member `some` would
    // ACCEPT — one remaining run, not a false edge. Without this the test
    // would pass against a rule that rejected both.
    const after1 = edgeRuns(lowered(1), lapW);
    expect(after1.length, "lowering member 1 no longer leaves exactly one run").toBe(1);
    expect(
      after1.some((r) => isFalseEdge(r)),
      "member 1 no longer clears the run, so the `some` spelling has nowhere to go",
    ).toBe(false);

    // THE RULE. Both members clear the run, the walk starts at the middle,
    // and the middle wins because `every` reports the empty remainder as
    // the clearance it is.
    const target = repairTarget(found[0], all, lapW);
    expect(
      target.index,
      "the repair passed over the member that emptied the run and took a nearer one — " +
        "the empty remainder was read as 'no answer' rather than as 'no false edge'",
    ).toBe(2);
    expect(target.stationBorn, "the chosen member is not station-born").toBe(true);

    // WHAT THIS DOES NOT PIN, since the answer here happens to BE the
    // middle: a `repairTarget` with the candidate walk deleted altogether,
    // returning `members[mid]` unconditionally, passes everything below.
    // The walk's own worth — preferring the joiner over the middle — is
    // pinned by the "0 barrier victims" sweep above, not here. This
    // fixture is aimed at one thing, which is that the empty remainder
    // counts as a clearance.
    //
    // END TO END, because the move count alone cannot tell the two apart:
    // both spellings clear the lap in one move and only the VICTIM differs.
    const rep = repairFalseEdges(all, lapW);
    expect(rep.before, "the repair did not see the edge").toBe(1);
    expect(rep.after, "the repair did not clear the edge").toBe(0);
    expect(rep.moves, "the repair did not terminate in one move").toBe(1);
    expect(rep.log[0].index, "the repair lowered a different member").toBe(2);
    expect(rep.log[0].before.station, "the repair lowered a different station").toBe(14);
  });

  it("falls back to the middle when the run has no joiner in it", async () => {
    // THE DOCUMENTED FALLBACK. A run whose every member is assembled has
    // nothing to blame, and the loop's termination argument is that each
    // pass lowers at least one member OUT of the band — so declining to
    // move would spin. It takes the old middle and pays the hole.
    //
    // `planBarriers` CANNOT PRODUCE THIS, which is why it is built by
    // hand: one lateral per run puts the slope at exactly 0, and
    // `BARRIER_SEPARATION_W` keeps two runs on a side from chaining. The
    // fallback exists for the shape of the argument, not for a case the
    // demo reaches.
    //
    // FIVE MEMBERS AT A 2W PITCH, so lowering the middle leaves two PAIRS
    // — under `minMembers` and under `minSpanW` both. Seven at the same
    // pitch does not: it leaves two triples of exactly 4W each, which are
    // still false edges, and the repair correctly costs three moves. That
    // is the right behaviour and the wrong fixture for testing a
    // single-move fallback.
    const lapW = 360;
    const n = 5;
    const all: RunPlacement[] = [];
    for (let i = 0; i < n; i++) {
      all.push({
        station: 10 + i * 2,
        t: 1.2 + 0.05 * (i * 2),
        h: 0.4,
        runId: 3,
        asset: pieceAsset(0),
      });
    }
    const found = edgeRuns(all, lapW);
    expect(found.length, "the hand-built run was not found").toBe(1);
    expect(isFalseEdge(found[0]), "the hand-built run is not a false edge").toBe(true);

    // THE "TWO PAIRS" ABOVE, ASSERTED RATHER THAN ONLY DESCRIBED. This
    // path never reaches `breaksRun` — every member is assembled, so the
    // candidate walk skips them all and the fallback takes the middle
    // unconditionally — but it lands on the SAME empty remainder the
    // filter's vacuous case turns on, and the one-move claim below is only
    // interesting because of it. `moves === 1` alone does not say so: a
    // remainder holding one run that merely fails `isFalseEdge` would also
    // finish in one move. See the test above for the case where the
    // distinction is load-bearing.
    const mid = Math.floor(n / 2);
    const holed = all.map((p, i) => (i === mid ? { ...p, h: FALSE_EDGE.heightW[0] - 0.05 } : p));
    expect(
      edgeRuns(holed, lapW).length,
      "lowering the middle left a run behind, so this is no longer the two-pairs fixture",
    ).toBe(0);

    const target = repairTarget(found[0], all, lapW);
    expect(target.stationBorn, "an all-assembled run reported a station-born target").toBe(false);
    expect(target.index, "the fallback did not take the old middle").toBe(found[0].members[mid]);

    const rep = repairFalseEdges(all, lapW);
    expect(rep.before, "the repair did not see the edge").toBe(1);
    expect(rep.after, "the fallback did not clear the edge").toBe(0);
    expect(rep.moves, "the fallback did not terminate in one move").toBe(1);
    expect(isAssembled(rep.log[0].before), "the fallback moved something else").toBe(true);
  });

  it("repairs the same placements whatever order the merged lap arrives in", async () => {
    // DETERMINISM AND ORDER INVARIANCE ON THE RULES LAYER. `P` is not in
    // this key because this suite never cooks a position — it is pinned in
    // `tests/racetrackBarriers.test.ts`, on the builder that produces it.
    // What is in the key is WHICH placement moved, keyed on the placement
    // and not on its index, since a shuffle renumbers every index by
    // construction.
    const m = await mergedFor(SEED, true);
    const a = repairFalseEdges(m.merged, m.lap.lengthW);
    const again = repairFalseEdges(m.merged, m.lap.lengthW);
    const keys = (log: typeof a.log): string[] => log.map((e) => movedKey(e.before)).sort();
    expect(keys(again.log), "the same lap repaired differently twice").toEqual(keys(a.log));

    // A local Fisher-Yates on this demo's own `rand`, never `Math.random`,
    // so the shuffle is part of the fixture rather than a source of flake.
    const shuffled = [...m.merged];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand(SEED, i, 0x51de) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // The premise: the shuffle really did move the list.
    expect(
      shuffled.map(movedKey).slice(0, 32),
      "the shuffle left the order alone",
    ).not.toEqual(m.merged.map(movedKey).slice(0, 32));

    const b = repairFalseEdges(shuffled, m.lap.lengthW);
    expect(b.moves, "the order changed how much was repaired").toBe(a.moves);
    expect(keys(b.log), "the order changed WHICH placement was repaired").toEqual(keys(a.log));
  });
});
