/**
 * L-5's barrier runs WIRED INTO THE DRESS GRAPH, which is the population
 * neither of the two suites either side of it can see.
 *
 * WHY A THIRD FILE. `tests/racetrackBarriers.test.ts` cooks the builder
 * against a bare path: true about the tiler, silent about the lap.
 * `tests/racetrackBarrierMerge.test.ts` drops a plan onto a settled lap and
 * measures the RULES layer — `planBarriers` against `cullSightlines`,
 * `repairTarget` against `repairFalseEdges` — but it never cooks a graph,
 * so every claim in it is about TypeScript. What is left, and what is here,
 * is the wiring: the splice, the columns a spliced piece has to carry, the
 * graph's own L-5 deciding which member of a run to lower, and the lap the
 * three of them produce.
 *
 * THE GATE IS OFF EVERYWHERE ELSE AND THAT IS THE POINT OF IT. Four
 * whole-lap assertions in `tests/racetrackDressGraph.test.ts` pin an exact
 * population against a reference with no barriers in it — the first pass's
 * survivor count, the box count against `buildBoxes`, L-5's own population,
 * and the bound on what L-6 may add. A stage that always ran would move all
 * four, so `DressGraphInput.barriers` is absent by default and this is the
 * only file that names it. The first case below asserts that absence rather
 * than trusting it.
 *
 * WHAT THE GRAPH'S L-5 PORTS, because it decides what the comparison in the
 * middle of this file can honestly claim. `falseEdges.ts`' `repairTarget`
 * picks the station-born member nearest the middle THAT BREAKS THE RUN,
 * re-asking `edgeRuns` over the members that would be left.
 * {@link writeEdgeTarget} ports BOTH halves — the preference and the filter
 * — so this file holds the stage to `repairTarget` itself, member for
 * member, and not to a second spelling of half of it.
 *
 * IT USED TO PORT ONLY THE PREFERENCE, and the sentence that said why was
 * wrong in a way worth recording: the filter "needs neighbour stations, and
 * no shift operator exists in the field grammar". A FIELD cannot read a
 * neighbour — every prefix fold includes its own element — but a NODE can,
 * and `pathShift` is that node. {@link preferredTarget} stays below as the
 * CONTROL: it is the rule the stage used to implement, it disagrees with
 * `repairTarget` on 2 of these 9 runs, and printing that difference is what
 * says the filter is doing something rather than being inert.
 *
 * ONE TERM OF `isFalseEdge` IS STILL NOT EXPRESSIBLE — the WORST residual
 * of a run minus one member, which is a different fitted line per candidate
 * and so recoverable from no sum. Leaving it out makes the stage's "this
 * candidate breaks the run" strictly HARDER to satisfy, so the stage can
 * only ever decline a candidate the reference accepted; it can never lower
 * one the reference refused. Measured over seeds 1..24 with Z-3 off and on
 * — 48 populations, 50 qualifying runs, 90 station-born candidates — the
 * residual conjunct never changes an answer, and the graph and
 * `repairTarget` name the same member on all 50.
 *
 * AND THAT INCLUDES `repairTarget`'s FALLBACK, WHICH TAKES A BARRIER PIECE.
 * A qualifying run in which no station-born member breaks the line has
 * nothing to prefer, so the rule lowers the middle whatever the middle is
 * and pays the hole — `falseEdges.ts` says so at length, and the loop's
 * termination argument is why it has to. On the same 48 populations both
 * rules do it on the same 4 of those 50 runs — two runs, one on seed 13 and
 * one on seed 18, each seen once with Z-3 off and once with it on, and the
 * graph names the same station as the rule on all four. The stage reaches that
 * branch by exactly one route and there is no other: an assembled member
 * scores `EDGE_NO_CANDIDATE`, so `edgeScore <= edgeBest` can only hold for
 * one when `edgeBest` is the sentinel too — which is "this run has no
 * candidate at all" and nothing else.
 */
import { describe, expect, it } from "vitest";
import { World, cook, firstGeometry, type DataItem, type Geometry } from "pcg-ts";
import {
  BARRIER_RUN,
  barrierStations,
  planBarriers,
  type BarrierConeTest,
  type BarrierRun,
} from "../demos/racetrack/barriers.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
import { frameLookup } from "../demos/racetrack/dress.js";
import {
  DRESS_OUTPUTS,
  PLACEMENT,
  buildDressGraph,
  buildRoundGraph,
  dressLapByGraph,
  poseLibrary,
  type BarrierDressOptions,
  type DressGraphInput,
} from "../demos/racetrack/dressGraph.js";
import {
  FALSE_EDGE,
  STATION_BORN,
  edgeRuns,
  falseEdges,
  isAssembled,
  repairTarget,
  type EdgeRun,
  type RunPlacement,
} from "../demos/racetrack/falseEdges.js";
import type { Lap } from "../demos/racetrack/lap.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { LEVELS, SECTOR_W, buildRacetrackLevels } from "../demos/racetrack/levels.js";
import { cullSightlines, defaultEyeStations, type Occluder } from "../demos/racetrack/sightline.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { dressedLapFor } from "./support/lap.js";

const SEEDS = [1, 2, 3, 4, 5, 6] as const;
/**
 * The sweep the L-5 comparison runs over, and it is wider than the rest for
 * one measured reason: false edges on a barriered lap are THIN. Over seeds
 * 1..6 the graph's own cull leaves four of them, which is too few a sample
 * to say anything about which member two rules pick.
 * `tests/racetrackBarrierMerge.test.ts` measures eleven over twelve seeds
 * on its own population and this file matches that range.
 */
const L5_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const SIX_LAP_MS = 180_000;
const LAP_MS = 120_000;

/** What every case here asks the planner for. Twelve is `barriers.ts`' own figure. */
const RUN_COUNT = 12;

/**
 * The floors the CONE CONTROL clears, per lap and pooled, over the three
 * seeds it runs on.
 *
 * MEASURED, NOT CHOSEN, and the per-lap one is the one that does the work.
 * A blind plan — same seed, same draws, no cone test — puts pieces in the
 * driver's look-ahead cone on every one of these laps, and the numbers are
 * filled in beside the assertion. A `> 0` on the SUM is cleared by one
 * blocked piece on one lap out of three, which is exactly the shape of a
 * control that has stopped controlling: the zeros it is there to justify
 * are per-piece and per-lap, so its own evidence has to be too.
 */
const BLIND_PER_SEED = 4;
const BLIND_POOLED = 20;

/**
 * The vocabulary a barrier piece is drawn from: the four SMALLEST assets in
 * the lap's own pool.
 *
 * FROM THE KIT AND NOT INVENTED, which is `BarrierDressOptions.pieces`'
 * whole argument: `tests/racetrackVocabulary.test.ts` pins an exhaustive
 * set of asset name stems, so a barrier with a name of its own would be a
 * new stem and a barrier reusing the kit's adds none.
 *
 * NARROW FIRST AND SMALL SECOND, and the width is the one that is a
 * correctness condition rather than a preference. A piece stands at `|t|`
 * as low as 1.05W and Z-1 stands anything overhanging the corridor off to
 * `1 + across/2`. That push is harmless to the LINE — one piece index per
 * run means every member takes the same offset, so the run translates and
 * stays parallel — but past `2 * (lateralW[1] - 1)` it walks the run out of
 * the band entirely, and a barrier outside L-5's band is invisible to the
 * rule this whole file is about. {@link PIECE_MAX_ACROSS} is half of that
 * allowance, so the premise has an order of margin rather than sitting on
 * its own boundary.
 */
const PIECE_MAX_ACROSS = FALSE_EDGE.lateralW[1] - 1;

function barrierPieces(pool: readonly PlaceableAsset[]): PlaceableAsset[] {
  const volume = (a: PlaceableAsset): number => a.size.across * a.size.along * a.size.tall;
  return pool
    .filter((a) => a.size.across <= PIECE_MAX_ACROSS)
    .sort((a, b) => volume(a) - volume(b) || a.id - b.id)
    .slice(0, 4);
}

/**
 * L-1's cone as the GRAPH asks it, which is not the same set `dressLap`
 * asks it on.
 *
 * THE FRAME STATIONS AND NOT `defaultEyeStations`. `writeSightlineCull`
 * hands `occlusionCull` the lap's frames as its sight path, so the graph's
 * eyes are ~0.385W apart where the rule's are 2W apart — and
 * `racetrackDressGraph.test.ts` measures that difference at 27 blockers the
 * coarse set steps over. A planner that cleared the coarse cone and handed
 * the pieces to the fine one would be answering a question nobody asked.
 */
function coneFor(lap: Lap, pieces: readonly PlaceableAsset[]): BarrierConeTest {
  const eyes: number[] = [];
  for (let i = 0; i < lap.count; i++) eyes.push(lap.s[i] / lap.halfWidth);
  return {
    frameAt: frameLookup(lap),
    halfWidth: lap.halfWidth,
    eyes,
    pieceSize: (piece) => {
      const a = pieces[Math.min(pieces.length - 1, Math.max(0, piece))];
      return { across: a.size.across, along: a.size.along, tall: a.size.tall };
    },
  };
}

/** The gate, built the way the page would build it. */
function barrierOptions(lap: Lap, pool: readonly PlaceableAsset[]): BarrierDressOptions {
  const pieces = barrierPieces(pool);
  return { count: RUN_COUNT, pieces, cone: coneFor(lap, pieces) };
}

/** The dress input every case here shares, minus the gate. */
async function inputFor(seed: number): Promise<DressGraphInput & { readonly lap: Lap }> {
  const { lap, frames, dressing } = await dressedLapFor(seed);
  return {
    kit: shippedVocabulary(),
    lap,
    frames,
    placements: dressing.placements,
    seed,
    immovable: new Set<number>(),
    mixPinned: dressing.mixPinned,
    pool: dressing.pool,
  };
}

/**
 * ONE SETTLED LAP FOR THE FOUR TAG CASES, built at most once.
 *
 * `dressedLapFor` memoizes the cook, which is not what this is for:
 * {@link inputFor} builds a fresh kit and a fresh input object every call,
 * and the four cases below want the SAME list, so that an index a refusal
 * names is the same row in all of them.
 */
let taggableLap: Promise<DressGraphInput & { readonly lap: Lap }> | undefined;
function tagFixture(): Promise<DressGraphInput & { readonly lap: Lap }> {
  if (!taggableLap) taggableLap = inputFor(SEEDS[0]);
  return taggableLap;
}

/**
 * What a call threw, or the empty string if it returned.
 *
 * NOT `expect(...).toThrow`, because the claim is about the MESSAGE and not
 * about the throw: a door that refuses without saying which row it refused
 * hands a caller with a five-hundred-entry array nothing to act on, and
 * `toThrow` with a pattern reports "did not match" rather than what was
 * actually said. The empty string is a distinguishable failure — it means
 * the call RETURNED — so a door that stopped refusing reads differently
 * from one that refused with the wrong words.
 */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
}

/** Every scalar column of a cloud this file reads, by name. */
function col(geo: Geometry, name: string): (i: number) => number {
  const c = geo.attrs.point.require(name);
  return (i) => c.get(i) as number;
}

/** A placement's identity, independent of where it sits in an array. */
const placeKey = (p: { station: number; t: number; h: number }): string =>
  `${p.station.toFixed(4)}|${p.t.toFixed(4)}|${p.h.toFixed(4)}`;

/**
 * THE RULE THE STAGE USED TO IMPLEMENT, kept as a CONTROL and not as a
 * reference: the nearest station-born member to the middle, ties to the
 * lower position, and the middle where there is no station-born member at
 * all — `repairTarget` with its `breaksRun` filter deleted.
 *
 * WHY IT IS STILL HERE NOW THAT THE FILTER IS PORTED. "The graph agrees
 * with `repairTarget`" is worth nothing if the two rules cannot disagree on
 * this population: a filter that never rejects a candidate is a filter that
 * was not tested. This is the same population judged without it, and the
 * count of runs where the two part company is what says the port does
 * something. Measured at 2 of 9 over the twelve seeds below.
 */
function preferredTarget(run: EdgeRun, placements: readonly RunPlacement[]): number {
  const n = run.members.length;
  const mid = Math.floor(n / 2);
  for (let d = 0; d < n; d++) {
    for (const k of d === 0 ? [mid] : [mid - d, mid + d]) {
      if (k < 0 || k >= n) continue;
      if (!isAssembled(placements[run.members[k]])) return run.members[k];
    }
  }
  return run.members[mid];
}

/** The pieces of a plan, as a list the dress graph can be handed. */
function barrierPlacements(
  runs: readonly BarrierRun[],
  lapW: number,
  pieces: readonly PlaceableAsset[],
): (StationedPlacement & { readonly runId: number })[] {
  const out: (StationedPlacement & { readonly runId: number })[] = [];
  for (const r of runs) {
    const asset = pieces[Math.min(pieces.length - 1, Math.max(0, r.piece))];
    for (const station of barrierStations(r, lapW)) {
      out.push({ station, t: r.t, h: r.h, runId: r.runId, asset });
    }
  }
  return out;
}

describe("L-5 barriers, spliced into the dress graph", () => {
  it("names the tag once, so the tiler's column and the placement's are one string", () => {
    // THE MERGE RESTS ON THIS AND NOTHING ELSE CHECKS IT. A barrier piece
    // arrives from `arcTile` already carrying `BARRIER_RUN.runId`; the
    // settled list is tagged with `PLACEMENT.runId`. If the two strings
    // ever drift apart, `mergePoints` unions them into TWO columns and
    // fills each side's missing one with a default — which for an i32 is
    // 0, a real run id. Every barrier would read as station-born and every
    // placement as a member of run 0, and nothing would fail.
    expect(PLACEMENT.runId, "the tag is spelled two ways").toBe(BARRIER_RUN.runId);
    // And -1 is not a value the tiler can produce: `planBarriers` numbers
    // its runs from 0 after the sort.
    expect(STATION_BORN).toBe(-1);
  });

  it(
    "calls every negative scattered, so a second assembler's sentinel is not a run",
    async () => {
      // THE PREDICATE ON A REAL ROW RATHER THAN ON A LITERAL. `isAssembled`
      // is handed whole placements by `repairTarget`, off the settled list,
      // so a hand-built object would be pinning the rule against a shape
      // this demo does not produce. This is the lap's own first placement
      // with a tag spread onto it, which is exactly how the tag arrives.
      const base = await tagFixture();
      const list = base.placements ?? [];
      expect(list.length, "the shared lap settled no placement to tag").toBeGreaterThan(8);
      const p = list[0];

      expect(
        isAssembled({ ...p, runId: STATION_BORN }),
        "a station-born placement read as assembled",
      ).toBe(false);
      // -2 IS THE CASE THAT CHANGED AND IT IS THE REASON THIS CASE EXISTS.
      // The reference arm asked `!== STATION_BORN` until now, so -2 came
      // back TRUE and read as membership of a run numbered -2 — which no
      // plan in this repo numbers, because a run id is a ROW of a plan and
      // rows count from 0. Every negative is therefore somebody's SENTINEL,
      // and the moment a second assembler wants one it cannot have -1: it
      // reaches for -2, and the old predicate silently enrolled its
      // placements in L-5's runs. The graph arm never had that reading —
      // `ge(attribute(PLACEMENT.runId), 0)` has always called -2 scattered —
      // so the two arms answered a DIFFERENT FIRST QUESTION while every
      // comparison in this file held them to each other member for member.
      expect(
        isAssembled({ ...p, runId: -2 }),
        "a second assembler's sentinel read as run membership",
      ).toBe(false);
      // A lap that carries no tag at all: the column is optional so that a
      // dressing nobody assembled reads as all-scattered rather than as
      // run 0.
      expect(isAssembled({ ...p }), "an untagged placement read as assembled").toBe(false);
      expect(isAssembled({ ...p, runId: 0 }), "run 0 read as scattered").toBe(true);
      expect(isAssembled({ ...p, runId: 7 }), "run 7 read as scattered").toBe(true);
    },
    LAP_MS,
  );

  it(
    "asks the reference arm's question in the graph arm's own words",
    async () => {
      // THE TWO ARMS HELD TO EACH OTHER AT THEIR FIRST QUESTION, WHICH IS
      // THE ONE NO COMPARISON IN THIS FILE CAN CATCH. "The graph lowered
      // the same member `repairTarget` did" is a statement about two rules
      // reading ONE population — and if the two spellings of "who assembled
      // this" disagree, they are reading two different populations and
      // agreeing about the wrong thing. `dressGraph.ts` spells it
      // `ge(attribute(PLACEMENT.runId), 0)`; this pins the TypeScript side
      // to that inequality rather than to any particular value.
      //
      // AND IT COOKS NOTHING. The graph arm's spelling is a source line and
      // the cases below already cook it at length; what was missing is the
      // statement that the reference arm asks the same thing, and that is
      // arithmetic over the values an i32 column can hold.
      const base = await tagFixture();
      const p = (base.placements ?? [])[0];
      const values: readonly (number | undefined)[] = [
        undefined,
        STATION_BORN,
        -2,
        -3,
        -0x80000000,
        0,
        1,
        RUN_COUNT - 1,
        0x7fffffff,
      ];
      for (const runId of values) {
        expect(
          isAssembled({ ...p, runId }),
          `runId ${runId}: the reference arm's predicate is not the graph arm's >= 0`,
        ).toBe(runId !== undefined && runId >= 0);
      }
    },
    LAP_MS,
  );

  it(
    "refuses a caller's run id the column would truncate, and says which row",
    async () => {
      // THE ONE RUN ID THE LIBRARY DID NOT ASSIGN. Every other value in
      // this column is `STATION_BORN` or a row of a plan built in
      // `dressGraph.ts`, and `barrierAssetCloud` range-checks its own;
      // `buildRoundGraph`'s `runIds` is the only way a number from outside
      // reaches an i32 attribute column.
      //
      // AND IT HAS TO BE CHECKED RATHER THAN TRUSTED BECAUSE THE FAILURE IS
      // SILENT AND LOOKS LIKE SUCCESS. `col.set` truncates to i32 without
      // saying so, so a bad number does not arrive as a bad number — it
      // arrives as a PERFECTLY GOOD one, and the reference arm then reads
      // the value the caller passed while the graph reads its truncation,
      // which is the last way left for the two spellings above to disagree.
      // Value by value, measured against a real `Int32Array` rather than
      // reasoned about: everything in `(-1, 0)` truncates TOWARD ZERO onto
      // 0, so -0.5 joins NaN and 0.5 in landing on a REAL RUN, and a
      // settled placement then reads as a member of somebody's line and
      // L-5 refuses to lower it; 3e9 and 2**31 wrap NEGATIVE and read as
      // sentinels; -2 survives the write intact and is still not a run id,
      // the exact value the predicate above changed its mind about.
      //
      // -1.5 IS REFUSED WITHOUT SPLITTING THE ARMS, and it is here to say
      // so. It lands on -1, which both arms call scattered — it split them
      // only while the reference arm asked `!== STATION_BORN`. A door is
      // allowed to refuse more than the divergence needs; what it must not
      // do is let a value through that the two arms would read apart.
      //
      // ON A NON-ZERO INDEX FOR ALL BUT ONE OF THEM, because the index is
      // half of what the message is for: a caller handed a five-hundred-row
      // array needs the row, and a check that only ever failed at 0 would
      // pass for a message that hard-coded it.
      const base = await tagFixture();
      const list = base.placements ?? [];
      expect(list.length, "the shared lap settled no placement to tag").toBeGreaterThan(8);

      const refused: readonly (readonly [number, number])[] = [
        [0, -2],
        [3, -1.5],
        [1, 3e9],
        [7, NaN],
        [2, 0.5],
        [5, 2 ** 31],
        [6, -0.5],
      ];
      for (const [at, v] of refused) {
        const runIds = list.map(() => STATION_BORN);
        runIds[at] = v;
        const msg = messageOf(() => buildRoundGraph(base, { runIds }));
        expect(
          msg,
          `runIds[${at}] = ${v}: the door wrote a value the column cannot hold`,
        ).not.toBe("");
        expect(msg, `runIds[${at}] = ${v}: the refusal does not name the row`).toContain(
          `runIds[${at}]`,
        );
        expect(msg, `runIds[${at}] = ${v}: the refusal does not name the value`).toContain(
          `is ${v}`,
        );
      }
    },
    LAP_MS,
  );

  it(
    "takes every run id the column can hold, and fills the rows the caller left out",
    async () => {
      // THE OTHER HALF OF A DOOR, AND WITHOUT IT THE REFUSALS ABOVE ARE
      // SATISFIED BY A FUNCTION THAT THROWS ON EVERYTHING. Each of these is
      // a shape the tag arrives in today: the L-5 comparison in this file
      // hands an all-`STATION_BORN` prefix followed by a plan's own rows,
      // and the inert case hands nothing but `STATION_BORN`.
      //
      // THE ENDS OF THE RANGE ARE HERE ON PURPOSE. 0 is the first row of
      // every plan and is the value NaN, 0.5 and -0.5 all truncate TO, so a
      // guard written as `v > 0` would pass the refusals above and lock out
      // run 0;
      // 2147483647 is the largest id the column holds and is what `2 ** 31`
      // is one past, so a guard written with the wrong comparison there
      // fails here rather than in a year.
      //
      // AND A SHORT ARRAY IS VALID, NOT MERELY TOLERATED. An absent entry
      // means "nothing assembled this row", which is the same statement as
      // `STATION_BORN` and the same as the column's own default — so a
      // caller who knows only about the rows an assembler touched need not
      // pad the array out to the population.
      //
      // CONSTRUCTION ONLY. The door is in `buildRoundGraph` itself, so
      // cooking these would be measuring the round rather than the door,
      // and the round is measured at length further down.
      const base = await tagFixture();
      const list = base.placements ?? [];
      const accepted: readonly (readonly [string, readonly number[]])[] = [
        ["a lap where nothing assembled anything", list.map(() => STATION_BORN)],
        ["a plan's own rows", list.map((_, i) => i % RUN_COUNT)],
        ["run 0 on every row", list.map(() => 0)],
        [
          "the largest id an i32 holds",
          list.map((_, i) => (i === 4 ? 0x7fffffff : STATION_BORN)),
        ],
        ["a short array, the rest of the lap unassembled", [0, 1, 2]],
      ];
      for (const [what, runIds] of accepted) {
        expect(
          messageOf(() => buildRoundGraph(base, { runIds })),
          `${what}: the door refused a run id it has to take`,
        ).toBe("");
      }
    },
    LAP_MS,
  );

  it(
    "is absent unless it is asked for, and present when it is",
    async () => {
      const seed = SEEDS[0];
      const base = await inputFor(seed);

      // THE GATE OFF. No tag on the cloud at all — not a tag set to
      // `STATION_BORN`, which would be a column every downstream stage has
      // to know about on every lap. A rule that can stand aside stands
      // aside completely.
      const off = (
        await cook(buildDressGraph(base), { outputs: [DRESS_OUTPUTS.placements] })
      ).outputs;
      const bare = firstGeometry(off[DRESS_OUTPUTS.placements] ?? []);
      if (!bare) throw new Error("the dress graph produced no placements");
      //
      // AND THAT IS ALL FOUR OF THEM, not only the tag. `runFit`'s `idAttr`
      // is the one a gate is easy to get wrong on: it is a param on a node
      // the bare lap builds anyway, so asking for it unconditionally would
      // ship an extra i32 column on every lap in the repo and no existing
      // assertion would notice — the two column-set checks that exist are
      // on `placementsInput`, upstream of L-5. The node's empty default
      // writes nothing and is byte-identical to a cook without the param,
      // which is the property this pins.
      for (const gated of [
        PLACEMENT.runId,
        PLACEMENT.edgeRunId,
        PLACEMENT.edgeScore,
        PLACEMENT.edgeBest,
      ]) {
        expect(
          bare.attrs.point.get(gated),
          `${gated} rode a lap that asked for no barriers`,
        ).toBeUndefined();
      }

      const on = (
        await cook(buildDressGraph({ ...base, barriers: barrierOptions(base.lap, base.pool) }), {
          outputs: [DRESS_OUTPUTS.placements, DRESS_OUTPUTS.placementsInput],
        })
      ).outputs;
      const dressed = firstGeometry(on[DRESS_OUTPUTS.placements] ?? []);
      const listIn = firstGeometry(on[DRESS_OUTPUTS.placementsInput] ?? []);
      if (!dressed || !listIn) throw new Error("the barrier graph produced no placements");

      // AND THE SPLICE IS ON THE FAR SIDE OF `placementsInput`, which is
      // the output `tests/racetrackPlacementAssembly.test.ts` pins as an
      // exact population and an exact column set. What the graph is handed
      // is the list; what it then assembles onto the lap is a different
      // statement and belongs on the other side of the wire.
      expect(
        listIn.pointCount,
        "the barrier stage reached the input list",
      ).toBe(base.placements?.length);
      expect(
        listIn.attrs.point.get(PLACEMENT.runId),
        "the barrier tag reached the input list",
      ).toBeUndefined();

      const runId = col(dressed, PLACEMENT.runId);
      let assembled = 0;
      for (let i = 0; i < dressed.pointCount; i++) if (runId(i) >= 0) assembled++;
      expect(assembled, "the gate was on and no barrier reached the lap").toBeGreaterThan(0);
      expect(
        dressed.pointCount,
        "the lap did not grow by what the barriers added",
      ).toBeGreaterThan(bare.pointCount);

      // EXACTLY WHAT THE GATE ADDS, AS A SET RATHER THAN A DENYLIST. A
      // named-columns check can only refuse the leaks somebody thought of;
      // this refuses every one, in both directions, which is the same
      // instrument `tests/racetrackPlacementAssembly.test.ts` points at the
      // input list.
      //
      // AND IT IS EXACTLY ONE COLUMN. `writeEdgeTarget` writes fifteen —
      // two `pathShift` destinations and a hit flag, five derived columns,
      // three scan outputs, three promoted totals and `runFit`'s `idAttr` —
      // and every one of them is working the stage consumes and takes off
      // again. Four of them used to survive to here (`edgeRun`, `edgeScore`,
      // `edgeBest` and the tag), which is the failure the strip's own
      // comment names: a column that starts riding along is found three
      // stages downstream by somebody who has to work out what it means.
      // `PLACEMENT.runId` is the one deliberate add — a barrier piece has to
      // say which run assembled it — and it is the whole list.
      const gateAdds = [PLACEMENT.runId];
      expect(
        [...dressed.attrs.point.names()].sort(),
        "the barrier gate changed the placement cloud's columns by more than its own",
      ).toEqual([...new Set([...bare.attrs.point.names(), ...gateAdds])].sort());
      // BOTH DOMAINS. Three of the fifteen are `pathScan` TOTALS, and a
      // total is a fact about a path, so it lands on the primitive domain —
      // where a check written against `attrs.point` cannot see it and would
      // pass with the leak in place. This is that check.
      expect(
        [...dressed.attrs.primitive.names()].sort(),
        "the barrier gate left a run total on the placement cloud's primitives",
      ).toEqual([...bare.attrs.primitive.names()].sort());
    },
    LAP_MS,
  );

  it(
    "builds a piece no stage can tell from a station-born placement",
    async () => {
      const seed = SEEDS[0];
      const base = await inputFor(seed);
      const opts = barrierOptions(base.lap, base.pool);
      // THE PREMISE OF `barrierPieces`: narrow enough that Z-1's stand-off
      // cannot walk a run out of the band it is supposed to live in, and
      // there is more than one of them, so `BARRIER_RUN.piece` is a real
      // choice rather than a constant.
      expect(opts.pieces.length, "the pool has no piece narrow enough to be a barrier")
        .toBeGreaterThan(1);
      for (const a of opts.pieces) {
        expect(
          1 + a.size.across / 2,
          `piece ${a.name}: Z-1 would stand it outside L-5's band`,
        ).toBeLessThan(FALSE_EDGE.lateralW[1]);
      }

      const got = await dressLapByGraph({ ...base, barriers: opts });
      const p = got.placements.attrs.point;
      const runId = col(got.placements, PLACEMENT.runId);
      const id = col(got.placements, PLACEMENT.id);
      const cover = col(got.placements, PLACEMENT.cover);
      const pinned = col(got.placements, PLACEMENT.mixPinned);
      const locked = col(got.placements, PLACEMENT.locked);
      const coverRun = col(got.placements, PLACEMENT.coverRun);
      const station = col(got.placements, PLACEMENT.station);
      const sizeAcross = col(got.placements, PLACEMENT.sizeAcross);
      const sizeAlong = col(got.placements, PLACEMENT.sizeAlong);
      const sizeTall = col(got.placements, PLACEMENT.sizeTall);
      const pose = col(got.placements, PLACEMENT.pose);
      const mixTried = col(got.placements, PLACEMENT.mixTried);
      const asset = p.require(PLACEMENT.asset);
      // The tuple columns a forgotten write leaves at the origin or at a
      // zero quaternion, read whole rather than component by component.
      const tuple = (name: string): ((i: number) => number[]) => {
        const c = p.require(name);
        return (i) => c.getTuple(i).map(Number);
      };
      const P = tuple("P");
      const scale = tuple("scale");
      const rot = tuple("rot");
      const frames = [PLACEMENT.along, PLACEMENT.across, PLACEMENT.up].map(tuple);
      const framePos = tuple(PLACEMENT.framePos);
      const len = (v: readonly number[]): number => Math.hypot(...v);

      // What the vocabulary makes available, as the cloud would hold it:
      // f32, so the comparison is against the value that was stored rather
      // than against the catalogue's f64.
      const sizes = new Set(
        opts.pieces.map(
          (a) =>
            `${Math.fround(a.size.across)}|${Math.fround(a.size.along)}|` +
            `${Math.fround(a.size.tall)}`,
        ),
      );
      const lib = poseLibrary(shippedVocabulary());
      const poses = new Set(opts.pieces.flatMap((a) => lib.posesOf.get(a.id) ?? []));
      expect(poses.size, "the piece vocabulary carries no pose at all").toBeGreaterThan(0);

      const ids = new Set<number>();
      let pieces = 0;
      for (let i = 0; i < got.placements.pointCount; i++) {
        // `PLACEMENT.id` IS A SET KEY AND THE BLOCKS MUST NOT COLLIDE. The
        // list numbers itself 0..n-1, L-6 counts down from -2, and barriers
        // from -100000. `racetrackDressGraph.test.ts` builds a Map on this
        // column, so a collision drops a row silently and fails elsewhere.
        expect(ids.has(id(i)), `two placements share id ${id(i)}`).toBe(false);
        ids.add(id(i));
        if (runId(i) < 0) continue;
        pieces++;
        // THE FLAG PAIR. Dressing, so it counts toward Z-3's shares; never
        // redrawn, because the piece was chosen once per run.
        expect(cover(i), "a barrier borrowed L-6's cover flag").toBe(0);
        expect(pinned(i), "a barrier is not pinned against the mix").toBe(1);
        expect(locked(i), "a barrier is pushable rather than droppable").toBe(1);
        expect(coverRun(i), "a barrier claims an enclosure run").toBe(-1);
        expect(id(i), "a barrier is in L-6's id block").toBeLessThan(-2);
        // The NON-cover half of the pose table. Getting this wrong throws
        // in `toInstancedMeshes` by name, which is the good failure.
        expect(asset.getString(i), "a barrier wears a cover asset id").toMatch(/^pose:\d+$/);
        // By the World's own half-open convention, a station at exactly
        // `length` is inside no sector but the last.
        expect(station(i)).toBeGreaterThanOrEqual(0);
        expect(station(i)).toBeLessThanOrEqual(base.lap.lengthW);
        // THE COLUMNS A FORGOTTEN WRITE WOULD LEAVE AT A DEFAULT, CHECKED
        // BY VALUE, AND THERE IS NO SET COMPARISON THAT COULD STAND IN FOR
        // THIS. Attribute storage is per CLOUD, not per point, so the two
        // populations in this cloud have the same columns by construction:
        // `mergePoints` unions the two sides' names and fills whichever side
        // lacks one with its DEFAULT. A barrier that never wrote its own
        // extents therefore comes out carrying the settled list's column at
        // 0, and the column set is byte-for-byte what it would have been.
        // "The two populations carry the same columns" is a statement about
        // SoA and cannot fail on any input, so it is not written here and
        // must not be mistaken for evidence. (The set comparison in the case
        // above is a different claim and CAN fail: it holds one COOK against
        // another, a barriered lap against a bare one.)
        //
        // SO THE LIST IS THE COLUMNS THAT DECIDE WHETHER THE PIECE IS DRAWN
        // AND WHERE. Zero extents are a placement L-1 cannot cull and
        // `spawnInstances` draws as nothing; a zero `scale` is the same
        // failure one stage later; a zero quaternion is not a rotation; and
        // a piece left at the origin is a piece in the middle of the world
        // rather than on the verge.
        expect(sizeAcross(i), "a barrier piece has no width").toBeGreaterThan(0);
        expect(sizeAlong(i), "a barrier piece has no length").toBeGreaterThan(0);
        expect(sizeTall(i), "a barrier piece has no height").toBeGreaterThan(0);
        for (const [k, v] of scale(i).entries()) {
          expect(v, `a barrier piece has a zero world scale on axis ${k}`).toBeGreaterThan(0);
        }
        // A UNIT QUATERNION AND NOT MERELY A NON-ZERO ONE: the default fill
        // is (0,0,0,0), whose length is 0, and anything `orientQuat` writes
        // is normalized. This is the one check that tells "never written"
        // from "written wrong".
        expect(len(rot(i)), `a barrier piece at ${station(i).toFixed(1)}W carries no rotation`)
          .toBeCloseTo(1, 4);
        // AND THE TRACK FRAME IT WAS PLACED IN. `writeLift` rebuilds `P`
        // from these three axes and the centreline point, so a barrier whose
        // frame never got sampled would be lifted to the origin — and the
        // three axes are orthonormal wherever they were.
        //
        // ALL FOUR WERE PERTURBED TO PROVE THEY BIND, each column read back
        // as the default `mergePoints` would have filled it with: `scale`
        // (0,0,0) fails on axis 0, `rot` (0,0,0,0) fails the unit-length
        // check, a zero frame axis fails the same way, and a `P` equal to
        // its own `framePos` — the piece never lifted off the centreline —
        // fails the last. One run each, since the first failure ends the
        // case.
        for (const [k, axis] of frames.entries()) {
          expect(len(axis(i)), `a barrier piece's track frame axis ${k} is not a unit vector`)
            .toBeCloseTo(1, 3);
        }
        expect(
          Math.hypot(...P(i).map((v, k) => v - framePos(i)[k])),
          "a barrier piece sits on the centreline point it was sampled at",
        ).toBeGreaterThan(0);
        expect(
          sizes.has(`${sizeAcross(i)}|${sizeAlong(i)}|${sizeTall(i)}`),
          `a barrier piece carries extents no piece of the vocabulary has`,
        ).toBe(true);
        // And a pose from the piece's own asset, not row 0 of the table.
        expect(poses.has(pose(i)), "a barrier wears a pose its asset does not have").toBe(true);
        expect(mixTried(i), "a barrier arrived already redrawn").toBe(0);
      }
      expect(pieces, "no barrier piece survived to the finished lap").toBeGreaterThan(0);

      // AND THE LAP STILL SETTLES, which is not a formality. Sixty-odd
      // immovable pieces landing in the verge and near bands is a real
      // share shift, and Z-3 answers a share it cannot meet by moving
      // other placements round the lap until it runs out of rounds. An
      // unsettled lap comes back as `converged: false` rather than as a
      // named failure, so the flag is asserted rather than printed.
      expect(got.converged, "the barriered lap ran out of repair rounds").toBe(true);

      // AND NONE OF THE TILER'S WORKING RODE ALONG. `mergePoints` unions
      // columns, so a name the strip forgot lands on every settled
      // placement as a default and is then somebody's to explain.
      for (const stray of [
        BARRIER_RUN.run,
        BARRIER_RUN.tile,
        BARRIER_RUN.startW,
        BARRIER_RUN.lengthW,
        BARRIER_RUN.pieces,
        BARRIER_RUN.piece,
        BARRIER_RUN.startK,
        BARRIER_RUN.lengthK,
        BARRIER_RUN.pitchK,
        "tangent",
        "curveU",
      ]) {
        expect(p.get(stray), `the tiler's ${stray} rode onto the placement list`).toBeUndefined();
      }

      console.log(
        `L-5 barriers on seed ${seed}: ${pieces} pieces on a lap of ${got.placements.pointCount}, ` +
          `${got.rounds} rounds, converged ${got.converged}`,
      );
    },
    LAP_MS,
  );

  it(
    "plans no piece into the cone the graph's own cull asks about",
    async () => {
      let planned = 0;
      let survived = 0;
      let coarseBlocking = 0;
      let steppedByBarriers = 0;
      let blindBlocking = 0;
      let blindPieces = 0;
      const blindPerSeed: number[] = [];

      for (const seed of SEEDS.slice(0, 3)) {
        const base = await inputFor(seed);
        const opts = barrierOptions(base.lap, base.pool);
        const cone = coneFor(base.lap, opts.pieces);
        const runs = planBarriers(base.lap.lengthW, seed, {
          count: RUN_COUNT,
          pieceCount: opts.pieces.length,
          avoidCone: cone,
        });
        expect(runs.length, `seed ${seed}: the cone test cost the lap a run`).toBe(RUN_COUNT);
        const wanted = runs.reduce((n, r) => n + r.pieces, 0);
        planned += wanted;

        const got = await dressLapByGraph({ ...base, barriers: opts });
        const runId = col(got.placements, PLACEMENT.runId);
        const station = col(got.placements, PLACEMENT.station);
        const t = col(got.placements, PLACEMENT.t);
        const h = col(got.placements, PLACEMENT.h);
        const across = col(got.placements, PLACEMENT.sizeAcross);
        const along = col(got.placements, PLACEMENT.sizeAlong);
        const tall = col(got.placements, PLACEMENT.sizeTall);

        const all: Occluder[] = [];
        const isBarrier: boolean[] = [];
        for (let i = 0; i < got.placements.pointCount; i++) {
          all.push({
            station: station(i),
            t: t(i),
            h: h(i),
            across: across(i),
            along: along(i),
            tall: tall(i),
          });
          isBarrier.push(runId(i) >= 0);
        }
        const mine = isBarrier.filter(Boolean).length;
        survived += mine;

        // THE CULL DID NOT HAVE TO REPAIR ONE, which is the claim the
        // planner's rejection test exists to make and the only one that
        // says the avoidance held THROUGH Z-1. Z-1 stands a piece off
        // outward, which takes it further from the racing line rather than
        // nearer, so it cannot create a blocker — but it is a measurement
        // and not an argument, and `locked` means the cull's answer to a
        // blocked barrier is to DELETE it.
        expect(
          mine,
          `seed ${seed}: the lap lost ${wanted - mine} of ${wanted} barrier pieces`,
        ).toBe(wanted);

        // AND NOTHING BLOCKS, ON BOTH EYE SETS. The coarse one is
        // `dressLap`'s and is a hard zero; the fine one is the graph's own
        // sight path, where `racetrackDressGraph.test.ts` measures blockers
        // the coarse set steps over. Barriers must contribute none to
        // either — they were planned against the fine set.
        const coarse = cullSightlines(
          all,
          base.lap.lengthW,
          cone.frameAt,
          base.lap.halfWidth,
          defaultEyeStations(base.lap.lengthW),
        );
        coarseBlocking += coarse.blocking;
        expect(coarse.blocking, `seed ${seed}: a placement blocks the 2W cone`).toBe(0);

        for (let i = 0; i < all.length; i++) {
          if (!isBarrier[i]) continue;
          const blocked = cullSightlines(
            [all[i]],
            base.lap.lengthW,
            cone.frameAt,
            base.lap.halfWidth,
            cone.eyes,
          );
          steppedByBarriers += blocked.blocking;
        }
        expect(
          steppedByBarriers,
          `seed ${seed}: a barrier piece stands in the frame-station cone`,
        ).toBe(0);

        // THE CONTROL, AND WITHOUT IT THE ZERO ABOVE IS WORTH NOTHING. Same
        // seed, same draws, no cone test — and the pieces it plans must
        // block, or the assertion is about a cone nothing on this lap could
        // ever stand in. It runs on the PLAN rather than on a cook, which
        // costs no lap: `barrierStations` is the station `writeBarriers`
        // builds, asserted as such in `tests/racetrackBarrierMerge.test.ts`.
        const blind = planBarriers(base.lap.lengthW, seed, {
          count: RUN_COUNT,
          pieceCount: opts.pieces.length,
        });
        const blindOcc: Occluder[] = [];
        for (const r of blind) {
          const size = cone.pieceSize(r.piece);
          for (const s of barrierStations(r, base.lap.lengthW)) {
            blindOcc.push({ station: s, t: r.t, h: r.h, ...size });
          }
        }
        const blindCull = cullSightlines(
          blindOcc,
          base.lap.lengthW,
          cone.frameAt,
          base.lap.halfWidth,
          cone.eyes,
        );
        blindBlocking += blindCull.blocking;
        blindPieces += blindOcc.length;
        blindPerSeed.push(blindCull.blocking);
      }
      // THE CONTROL HAS TO FIRE ON EVERY SEED, NOT SOMEWHERE. `> 0` on a
      // sum over three seeds is cleared by one blocked piece on one lap,
      // and a regression that left every other piece in the clear would
      // read as a working control. The floor is measured rather than
      // chosen: over seeds 1..3 the blind plan blocks 7, 11 and 10 pieces
      // per lap, so {@link BLIND_PER_SEED} sits under the whole observed
      // range with room to move, and the pooled floor of 20 sits under the
      // measured 28 of 217 (12.9%) the same way. What both pin is the weak
      // claim that is nevertheless the one that matters: the cone this lap
      // has is a cone a barrier can stand in, in quantity, so the zeros
      // above are the planner's doing.
      for (const [i, n] of blindPerSeed.entries()) {
        expect(
          n,
          `seed ${SEEDS[i]}: a blind plan put ${n} pieces in the cone, so the cone test is ` +
            `not what cleared it on this lap`,
        ).toBeGreaterThanOrEqual(BLIND_PER_SEED);
      }
      expect(
        blindBlocking,
        `a blind plan blocked ${blindBlocking} of ${blindPieces} pieces over seeds ` +
          `${SEEDS.slice(0, 3).join(", ")}; the cone test is not what cleared the cone`,
      ).toBeGreaterThanOrEqual(BLIND_POOLED);

      console.log(
        `L-5 barriers vs L-1 over ${SEEDS.slice(0, 3).length} seeds: ${survived} of ${planned} ` +
          `pieces survived the cull, ${coarseBlocking} coarse blockers, ` +
          `${steppedByBarriers} barrier blockers on the frame stations; a blind plan puts ` +
          `${blindBlocking} of ${blindPieces} pieces in that same cone ` +
          `(${blindPerSeed.join(", ")} per lap)`,
      );
    },
    SIX_LAP_MS,
  );

  it(
    "picks the same member of the same run the rule does",
    async () => {
      // THE COMPARISON NOBODY HAD. `tests/racetrackDressGraph.test.ts`
      // holds the graph's L-5 to `repairFalseEdges` on an UNTAGGED lap,
      // where both rules reduce to `members[floor(n/2)]` and the tag is
      // invisible. This runs one round over a TAGGED population and asks
      // the question the tag was added for.
      //
      // ONE ROUND AND NOT A LAP, for `buildRoundGraph`'s own stated reason:
      // `assemble` decides the barrier plan from the seed, so a whole-lap
      // comparison would measure the planner and the stage at once, and
      // the reference would have to be handed a population it did not
      // build. Here the caller tags the list and both sides read the same
      // one.
      let runsSeen = 0;
      let agreed = 0;
      let barrierVictims = 0;
      let refBarrierVictims = 0;
      const perSeed: string[] = [];

      for (const seed of L5_SEEDS) {
        const { lap, frames, dressing } = await dressedLapFor(seed);
        const pool = dressing.pool;
        const pieces = barrierPieces(pool);
        const runs = planBarriers(lap.lengthW, seed, {
          count: RUN_COUNT,
          pieceCount: pieces.length,
          avoidCone: coneFor(lap, pieces),
        });
        const bars = barrierPlacements(runs, lap.lengthW, pieces);
        const list: StationedPlacement[] = [...dressing.placements, ...bars];
        const runIds = [
          ...dressing.placements.map(() => STATION_BORN),
          ...bars.map((b) => b.runId),
        ];

        const g = buildRoundGraph(
          {
            kit: shippedVocabulary(),
            lap,
            frames,
            placements: list,
            seed,
            immovable: new Set<number>(),
            // Z-3 OFF: this case measures L-5, and a mix that redraws a
            // placement mid-comparison is a different lap rather than
            // noise. Pinning the whole pool leaves the mix nothing to move.
            mixPinned: new Set(pool.map((a) => a.id)),
            pool,
          },
          { runIds },
        );
        const out = (
          await cook(g, { outputs: [DRESS_OUTPUTS.culled, DRESS_OUTPUTS.placements] })
        ).outputs;
        const culled = firstGeometry(out[DRESS_OUTPUTS.culled] ?? []);
        const after = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
        if (!culled || !after) throw new Error("the round graph produced no placements");

        // THE LIST L-5 WAS HANDED, TAKEN OFF THE GRAPH'S OWN ANSWER FOR THE
        // STAGE BEFORE — the discipline every rule comparison in this repo
        // follows, so this measures L-5 alone and not L-1 as well.
        const cId = col(culled, PLACEMENT.id);
        const cT = col(culled, PLACEMENT.t);
        const cH = col(culled, PLACEMENT.h);
        const cStation = col(culled, PLACEMENT.station);
        const input: RunPlacement[] = [];
        for (let i = 0; i < culled.pointCount; i++) {
          const src = list[cId(i)];
          input.push({
            ...src,
            station: cStation(i),
            t: cT(i),
            h: cH(i),
            runId: runIds[cId(i)],
          });
        }

        const bad = falseEdges(input, lap.lengthW);
        perSeed.push(`${seed}:${bad.length}`);
        runsSeen += bad.length;

        // WHICH MEMBERS THE GRAPH LOWERED, by identity rather than by row:
        // `edgeDrop` marks one member per qualifying run.
        const drop = col(after, PLACEMENT.drop);
        const aStation = col(after, PLACEMENT.station);
        const aT = col(after, PLACEMENT.t);
        const aRunId = col(after, PLACEMENT.runId);
        const got = new Set<string>();
        for (let i = 0; i < after.pointCount; i++) {
          if (drop(i) === 0) continue;
          got.add(`${aStation(i).toFixed(4)}|${aT(i).toFixed(4)}`);
          if (aRunId(i) >= 0) barrierVictims++;
        }

        // `repairTarget` ITSELF, EXACTLY. One member per qualifying run, and
        // the same one — the whole function now, filter included, rather
        // than a second spelling of the preference.
        const want = new Set<string>();
        for (const run of bad) {
          const k = repairTarget(run, input, lap.lengthW).index;
          want.add(`${input[k].station.toFixed(4)}|${input[k].t.toFixed(4)}`);
        }
        expect(
          [...got].sort(),
          `seed ${seed}: the graph lowered different members than repairTarget`,
        ).toEqual([...want].sort());

        // AND THE CONTROL: the same population judged WITHOUT the filter. It
        // must disagree somewhere, or the equality above is about a filter
        // that never rejects anything.
        for (const run of bad) {
          const mine = preferredTarget(run, input);
          const theirs = repairTarget(run, input, lap.lengthW).index;
          expect(
            run.members.includes(theirs) && run.members.includes(mine),
            `seed ${seed}: a target is not a member of the run it was chosen for`,
          ).toBe(true);
          if (isAssembled(input[theirs])) refBarrierVictims++;
          if (mine === theirs) agreed++;
        }
      }

      // THE RULE HAS TO HAVE FIRED. A tagged lap with no false edge on it
      // proves nothing about which member either rule picks.
      expect(runsSeen, `no false edge formed on any tagged lap (${perSeed.join(", ")})`)
        .toBeGreaterThan(0);
      // THE PROPERTY THE WHOLE TAG WAS ADDED FOR, on this population: the
      // rule takes no piece of an assembled line here, so neither may the
      // graph. It is asserted on BOTH sides rather than on the graph alone
      // because the graph is now held to the rule exactly — a green here
      // that came from the rule having changed its mind would otherwise be
      // invisible. (The rule's documented fallback CAN take one, on a run
      // where no station-born member breaks the line. It does not on these
      // twelve seeds; it does on seeds 13 and 18, and the graph does it
      // there too. See the file header.)
      expect(barrierVictims, "the graph lowered a piece of an assembled line").toBe(0);
      expect(refBarrierVictims, "the rule lowered a piece of an assembled line").toBe(0);
      // THE FILTER IS NOT INERT, AND THIS IS THE ONLY THING THAT SAYS SO.
      // `preferredTarget` is the stage as it was before `breaksRun` was
      // ported; if it agreed with `repairTarget` everywhere on this
      // population then the equality above would hold with the filter
      // deleted and would be evidence of nothing. Measured at 2 of 9 over
      // these twelve seeds — seed 7's six-member run and seed 11's — and
      // asserted as a floor of 1 rather than as the exact 2, because the
      // claim is "they can disagree here", not "they disagree twice".
      expect(
        runsSeen - agreed,
        "the unfiltered rule agrees with repairTarget on every run here, so the " +
          "filter comparison above cannot fail and proves nothing",
      ).toBeGreaterThanOrEqual(1);
      console.log(
        `dress graph L-5 with runs: ${runsSeen} false edges over ${L5_SEEDS.length} seeds ` +
          `(${perSeed.join(", ")}), the graph chose repairTarget's own member on ` +
          `${runsSeen}/${runsSeen}; the unfiltered rule would have agreed on ` +
          `${agreed}/${runsSeen}, 0 barrier victims either way`,
      );
    },
    SIX_LAP_MS,
  );

  it(
    "is inert on a tagged lap with nothing assembled on it",
    async () => {
      // THE NO-OP, AND IT IS STRUCTURAL. With every member station-born the
      // middle scores 0, 0 is the minimum of the run, and the rule picks
      // exactly the member `members[floor(n/2)]` names. Asserted by cooking
      // ONE POPULATION twice — once with the tag on every row set to
      // `STATION_BORN`, once with no tag at all — and requiring the two
      // clouds to be identical to the bit.
      //
      // THE POPULATION IS THE BARRIERED ONE WITH THE TAG THROWN AWAY, and
      // it has to be: a settled lap on its own carries no false edge, so
      // both arms would lower nothing and the equality would be about a
      // rule that never ran. This is the merged lap with every row claiming
      // to be scattered — which is the lap the rule saw before the tag
      // existed, and the exact control the claim needs.
      const seed = SEEDS[0];
      const { lap, frames, dressing } = await dressedLapFor(seed);
      const pieces = barrierPieces(dressing.pool);
      const runs = planBarriers(lap.lengthW, seed, {
        count: RUN_COUNT,
        pieceCount: pieces.length,
        avoidCone: coneFor(lap, pieces),
      });
      const list: StationedPlacement[] = [
        ...dressing.placements,
        ...barrierPlacements(runs, lap.lengthW, pieces),
      ];
      const shared = {
        kit: shippedVocabulary(),
        lap,
        frames,
        placements: list,
        seed,
        immovable: new Set<number>(),
        mixPinned: new Set(dressing.pool.map((a) => a.id)),
        pool: dressing.pool,
      };
      const bare = buildRoundGraph(shared);
      const tagged = buildRoundGraph(shared, {
        runIds: list.map(() => STATION_BORN),
      });
      const read = async (g: ReturnType<typeof buildRoundGraph>): Promise<Geometry> => {
        const out = (await cook(g, { outputs: [DRESS_OUTPUTS.placements] })).outputs;
        const geo = firstGeometry(out[DRESS_OUTPUTS.placements] ?? []);
        if (!geo) throw new Error("the round graph produced no placements");
        return geo;
      };
      const a = await read(bare);
      const b = await read(tagged);
      expect(b.pointCount, "the tag changed the population").toBe(a.pointCount);

      const names = [PLACEMENT.station, PLACEMENT.t, PLACEMENT.h, PLACEMENT.drop];
      let lowered = 0;
      for (const name of names) {
        const ca = col(a, name);
        const cb = col(b, name);
        for (let i = 0; i < a.pointCount; i++) {
          expect(cb(i), `${name} at ${i}: the tag changed a lap that has no runs on it`).toBe(
            ca(i),
          );
        }
      }
      const drop = col(a, PLACEMENT.drop);
      for (let i = 0; i < a.pointCount; i++) if (drop(i) !== 0) lowered++;
      // The premise: L-5 had something to do, so the equality above is
      // about a rule that ran rather than one that was asleep.
      expect(lowered, "L-5 lowered nothing, so the no-op claim is vacuous").toBeGreaterThan(0);
      console.log(`dress graph L-5 inert: ${lowered} lowered, identical with and without the tag`);
    },
    LAP_MS,
  );

  it(
    "settles the same lap twice, with P in the key",
    async () => {
      const seed = SEEDS[1];
      const base = await inputFor(seed);
      const input = { ...base, barriers: barrierOptions(base.lap, base.pool) };
      const a = await dressLapByGraph(input);
      const b = await dressLapByGraph(input);
      expect(b.placements.pointCount, "the same input settled two populations").toBe(
        a.placements.pointCount,
      );

      // `P` IS IN THE KEY HERE AND NOT IN THE MERGE SUITE'S, and the
      // difference is what this file is for: that one never cooks a
      // position. `arcTile` leaves a `P` in its own frame and `writeLift`
      // rewrites it from the track coordinates, so a barrier's position is
      // the graph's answer and has to be pinned as one.
      const keyOf = (geo: Geometry): string[] => {
        const P = geo.attrs.point.require("P");
        const station = col(geo, PLACEMENT.station);
        const t = col(geo, PLACEMENT.t);
        const h = col(geo, PLACEMENT.h);
        const runId = col(geo, PLACEMENT.runId);
        const asset = geo.attrs.point.require(PLACEMENT.asset);
        const out: string[] = [];
        for (let i = 0; i < geo.pointCount; i++) {
          out.push(
            `${P.get(i, 0)}|${P.get(i, 1)}|${P.get(i, 2)}|${station(i)}|${t(i)}|${h(i)}|` +
              `${runId(i)}|${asset.getString(i)}`,
          );
        }
        return out;
      };
      expect(keyOf(b.placements), "two cooks of one graph disagree").toEqual(keyOf(a.placements));

      // AND THE ORDER THE LIST ARRIVED IN IS NOT PART OF THE ANSWER. The
      // plan is a pure function of the lap length and the seed, so a
      // shuffle cannot move a barrier; what it CAN move is which settled
      // placement joins which run, and that is what the shuffle is here to
      // catch. Compared as a multiset, since a shuffle renumbers every row.
      const shuffled = [...(base.placements ?? [])];
      for (let i = shuffled.length - 1; i > 0; i--) {
        // This demo's own hash, never `Math.random`, so the shuffle is part
        // of the fixture rather than a source of flake.
        const j = Math.floor(((Math.imul(seed + i, 0x9e3779b1) >>> 8) / 0x1000000) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(
        shuffled.slice(0, 32).map(placeKey),
        "the shuffle left the order alone",
      ).not.toEqual((base.placements ?? []).slice(0, 32).map(placeKey));

      const jumbled = await dressLapByGraph({ ...input, placements: shuffled });
      expect(
        keyOf(jumbled.placements).sort(),
        "the order the list arrived in changed the lap",
      ).toEqual(keyOf(a.placements).sort());
    },
    SIX_LAP_MS,
  );

  it(
    "leaves the sectors partitioning the lap exactly",
    async () => {
      // A BARRIER RUN IS LAP-GLOBAL AND ITS PIECES ARE NOT. `arcTile` emits
      // one point per PIECE, each with its own station, so a run straddling
      // a 20W seam is split piece by piece by a scalar half-open test on
      // one column — never claimed twice and never dropped. That is L-6's
      // cover tiler's property too, and this asserts the barriers inherit
      // it rather than assuming they do.
      //
      // ON IDENTITY AND NOT ON A COUNT, WHICH IS THE WHOLE DIFFERENCE. This
      // compared the summed instance count against the settled placement
      // count, and those are two different quantities that happen to be
      // equal: a partition that DROPS one piece in sector A and CLAIMS
      // another twice in sector B has the same total as the right one, on
      // any seed, and the equality reports nothing. What a partition
      // actually claims is that the union of the sectors is the lap, piece
      // for piece — so the key is the piece: its asset id and where in the
      // world it stands, which together are what a sector was asked to
      // produce and what a renderer will draw.
      //
      // AND THE LAP'S OWN ANSWER IS THE REFERENCE, not the count of it.
      // `dressLapByGraph` cooks the same settled cloud the parent level
      // publishes, so its `P` and its asset id are exactly the transform
      // and the batch the sectors have to reproduce. Distinctness catches
      // the double claim; the set equality catches the drop; neither can be
      // satisfied by a total that balances.
      //
      // THREE MILLIMETRES OF ROUNDING IN THE KEY, on a lap whose half-width
      // is order ten world units and whose pieces stand a metre apart: the
      // instance transform and the placement column hold the same f32, so
      // this is a readable key rather than a tolerance being spent.
      //
      // PERTURBED TO PROVE IT BINDS, AND THE PERTURBATION WAS CHOSEN TO BE
      // THE ONE THE OLD CHECK CANNOT SEE. `buildDressingGraph`'s sector
      // predicate was shifted by one `SECTOR_W` on sector 9 ALONE, so
      // sector 9 claims its neighbour's arc: its own 13 pieces are claimed
      // by nobody and sector 10's 13 are claimed twice. On seed 1 those two
      // sectors hold the same count, so the total came back at exactly 424
      // against 424 placements and THE OLD COUNT ASSERTION PASSED GREEN —
      // with 411 distinct keys, 13 duplicates and 13 placements missing
      // from the union. The three assertions below all go red on it and
      // name the pieces. (Seeds 2 and 3 have no such balanced pair, so
      // there the total moved too — 399 against 409, 407 against 423 — and
      // the old check would have caught those. One seed and a count is what
      // made it a false pass; the sweep and the identity are the fix, and
      // both were needed.) Restored before commit.
      for (const seed of SEEDS.slice(0, 3)) {
        const base = await inputFor(seed);
        const input = { ...base, barriers: barrierOptions(base.lap, base.pool) };

        const whole = await dressLapByGraph(input);
        const built = buildRacetrackLevels(input);
        expect(built.sectorCount).toBe(Math.max(1, Math.round(base.lap.lengthW / SECTOR_W)));

        // Keyed per sector and OVERWRITTEN rather than appended: a cell is
        // reported ready every time the anchor sweeps back over it, and the
        // second report is the same cook rather than a second population.
        const bySector = new Map<number, string[]>();
        const world = new World({
          seed,
          levels: built.levels,
          maxCellsPerLevel: built.sectorCount + 8,
          onCellReady(levelName, coord, outputs) {
            if (levelName !== LEVELS.dressing) return;
            const items = (outputs["instances"] ?? []) as DataItem[];
            const here: string[] = [];
            for (const item of items) {
              if (item.kind !== "instances") continue;
              for (const batch of item.batches) {
                for (let i = 0; i < batch.count; i++) {
                  const o = i * 16;
                  here.push(
                    `${batch.assetId}|${batch.transforms[o + 12].toFixed(3)}|` +
                      `${batch.transforms[o + 13].toFixed(3)}|` +
                      `${batch.transforms[o + 14].toFixed(3)}`,
                  );
                }
              }
            }
            bySector.set(coord[0], here);
          },
        });
        const steps = built.sectorCount * 2;
        for (let i = 0; i < steps; i++) {
          await world.update([0, 0, 0], {
            anchors: { [LEVELS.dressing]: (i / steps) * base.lap.lengthW },
          });
        }
        expect(bySector.size, `seed ${seed}: a sector was never asked for`).toBe(
          built.sectorCount,
        );

        const P = whole.placements.attrs.point.require("P");
        const assetOf = whole.placements.attrs.point.require(PLACEMENT.asset);
        const want: string[] = [];
        for (let i = 0; i < whole.placements.pointCount; i++) {
          const v = P.getTuple(i);
          want.push(
            `${assetOf.getString(i)}|${Number(v[0]).toFixed(3)}|` +
              `${Number(v[1]).toFixed(3)}|${Number(v[2]).toFixed(3)}`,
          );
        }
        // THE PREMISE, AND IT IS NOT FREE: two placements of one asset at
        // one position would be one key for two pieces, and the
        // distinctness assertion below would then be asserting a collision
        // rather than a partition.
        expect(
          new Set(want).size,
          `seed ${seed}: two settled placements share an identity, so the key is not one`,
        ).toBe(want.length);

        const keys = [...bySector.values()].flat();
        expect(
          keys.length,
          `seed ${seed}: the sectors produced ${keys.length} instances for ` +
            `${want.length} placements`,
        ).toBe(want.length);
        expect(
          new Set(keys).size,
          `seed ${seed}: two sectors claimed the same piece`,
        ).toBe(keys.length);
        expect(
          [...new Set(keys)].sort(),
          `seed ${seed}: the union of the sectors is not the lap`,
        ).toEqual([...want].sort());

        const runId = col(whole.placements, PLACEMENT.runId);
        let pieces = 0;
        for (let i = 0; i < whole.placements.pointCount; i++) if (runId(i) >= 0) pieces++;
        expect(pieces, `seed ${seed}: there were no barriers to partition`).toBeGreaterThan(0);
        console.log(
          `L-5 barriers across sectors, seed ${seed}: ${keys.length} instance identities over ` +
            `${built.sectorCount} sectors, all distinct and covering the lap's ${want.length} ` +
            `placements, ${pieces} of them barrier pieces`,
        );
      }
    },
    SIX_LAP_MS,
  );

  it("finds the runs it built, and does not call them false edges", async () => {
    // THE DETECTOR CONTROL, ON THE COOKED LAP. A run the graph built has to
    // come back through `edgeRuns` as a run — otherwise every claim above
    // about L-5 and barriers is about a population L-5 cannot see — and it
    // has to come back parallel, which is the property `planBarriers`
    // exists to produce.
    const seed = SEEDS[0];
    const base = await inputFor(seed);
    const got = await dressLapByGraph({ ...base, barriers: barrierOptions(base.lap, base.pool) });
    const runId = col(got.placements, PLACEMENT.runId);
    const station = col(got.placements, PLACEMENT.station);
    const t = col(got.placements, PLACEMENT.t);
    const h = col(got.placements, PLACEMENT.h);
    const list: RunPlacement[] = [];
    for (let i = 0; i < got.placements.pointCount; i++) {
      list.push({
        station: station(i),
        t: t(i),
        h: h(i),
        runId: runId(i),
        asset: base.pool[0],
      });
    }

    const found = edgeRuns(list, base.lap.lengthW);
    const touching = found.filter((r) => r.members.some((i) => isAssembled(list[i])));
    expect(touching.length, "no detected run contains a barrier piece").toBeGreaterThan(0);

    // AND THE FINISHED LAP CARRIES NO FALSE EDGE AT ALL, which is L-5's own
    // postcondition and the thing the repair loop settles to.
    const bad = falseEdges(list, base.lap.lengthW);
    expect(bad.length, "the settled lap still holds a false edge").toBe(0);

    // AND ALMOST NO BARRIER PIECE SITS BELOW THE BAND, which is what the
    // repair does to a member it lowers. This used to be a hard zero and
    // that was a property of the STAGE BEFORE `breaksRun` WAS PORTED rather
    // than a property of the rule.
    //
    // `repairTarget` ITSELF PAYS THIS, AND SAYS SO. A qualifying run in
    // which no station-born member breaks the line has no joiner to blame,
    // so the rule lowers the middle whatever the middle is — the loop's
    // termination argument is that every pass takes at least one member out
    // of the band, so declining to move would spin. `falseEdges.ts` writes
    // that fallback out at length and calls the hole its honest cost.
    //
    // AND THE STAGE REACHES IT BY EXACTLY ONE ROUTE. An assembled member
    // scores `EDGE_NO_CANDIDATE`, and `isTarget` compares `edgeScore <=
    // edgeBest` only while `edgeBest < EDGE_NO_CANDIDATE` — so no assembled
    // member can win that comparison, and the only way one is dropped is
    // the OTHER branch, where the run's best is the sentinel too. That is
    // "this run has no candidate at all", which is the fallback and nothing
    // else. Measured beside it: over seeds 1..24 with Z-3 off and on, the
    // graph and `repairTarget` take an assembled member on the same 4 of 50
    // qualifying runs — one run on seed 13 and one on seed 18, each counted
    // in both mix settings — and they name the same station every time.
    //
    // PINNED AT THE MEASURED COUNT so that it fails if it GROWS. One piece
    // on this lap, out of 70 placed and across four repair rounds — run 2
    // at 92.7W. The stage without the filter lowered none here, which is
    // the trade the port makes: agreeing with the rule means paying what
    // the rule pays.
    const floorW = FALSE_EDGE.heightW[0] - 0.05;
    const lowered = list.filter((p) => isAssembled(p) && Math.abs(p.h - floorW) <= 1e-4);
    expect(
      lowered.map((p) => `run ${p.runId} at ${p.station.toFixed(2)}W`),
      "more barrier pieces were lowered than the rule's fallback accounts for",
    ).toHaveLength(1);
    console.log(
      `L-5 barriers detected on seed ${seed}: ${found.length} runs, ${touching.length} of them ` +
        `holding a barrier piece, 0 false edges, ${lowered.length} barrier piece(s) taken by ` +
        `repairTarget's no-candidate fallback (${lowered
          .map((p) => `run ${p.runId} at ${p.station.toFixed(1)}W`)
          .join(", ")})`,
    );
  }, LAP_MS);
});
