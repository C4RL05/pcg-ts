/**
 * L-6's planner, as a graph, checked against L-6 rather than against
 * `planEnclosure`.
 *
 * WHY NOT AGAINST THE REFERENCE, stated once here because it is the whole
 * shape of this suite. `planEnclosure` draws from `rand(seed, k, salt)`,
 * which hashes an array index; the graph draws from `randomFrom(k, salt)`,
 * which hashes an f32's bits. Neither hash is available to the other, so
 * the two plan DIFFERENT stretches from one seed and no amount of care
 * makes them agree. `dressGraph`'s Z-3 redraw reached the same place for
 * the same reason and is checked the same way: on the POSTCONDITION the
 * rule states, which is what anybody actually cares about.
 *
 * So what is pinned here is L-6 itself:
 *
 *   - no stretch begins inside a corner tighter than the rule's threshold;
 *   - none begins within `flareW` before such a corner;
 *   - no two come within `separationW` of each other, ON THE LOOP;
 *   - every length is one the source's own quantiles could have produced;
 *   - the covered total reaches the budget without overshooting it by more
 *     than the clamp allows.
 *
 * And one thing that is NOT a postcondition and is checked anyway: that
 * the length expression agrees with `drawStretchLengthW` to f32. That one
 * IS a function rather than a draw, so it has a right answer and there is
 * no reason to accept less.
 */
import { describe, expect, it } from "vitest";
import {
  Graph,
  cook,
  createPointCloud,
  dataInput,
  evaluateField,
  firstGeometry,
  index,
  makeGeometryItem,
  setAttribute,
  transferByIndex,
  type Geometry,
} from "pcg-ts";
import {
  BUDGET,
  COVER_ASSET,
  HEAVY_W,
  PIECE,
  PLAN,
  PLAN_PIN,
  addEnclosurePlan,
  addEnclosureTiles,
  coverCloud,
  maxColumns,
  slotCloud,
  stretchLengthField,
  writeCornerTests,
  writeCoverBudget,
  type PlanOptions,
} from "../demos/racetrack/enclosureGraph.js";
import {
  ENCLOSE,
  LONG_QUANTILE,
  coverCandidates,
  drawStretchLengthW,
  longCoverBudgetW,
} from "../demos/racetrack/tunnels.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { CORRIDOR } from "../demos/racetrack/zones.js";
import {
  ENCLOSURE,
  enclosureMask,
  measureEnclosure,
} from "../demos/racetrack/enclosure.js";
import { TRACK_FRAME } from "../demos/racetrack/graph.js";
import { poseLibrary } from "../demos/racetrack/dressGraph.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
import { beforeEntryW, cornersOf, radiusAtW } from "../demos/racetrack/corners.js";
import { dressedLapFor } from "./support/lap.js";
import type { Lap } from "../demos/racetrack/lap.js";

const SEEDS = [1, 2, 3, 4] as const;

/** One accepted stretch, read back off the cloud. */
interface Planned {
  readonly startW: number;
  readonly lengthW: number;
  /** The corner verdict the loop had in hand when it accepted this one. */
  readonly cornerOk: number;
}

/** Everything a cook of the planner says, plans and rejections alike. */
interface PlanResult {
  readonly plans: Planned[];
  /** How many attempts the loop spent before it stopped. */
  readonly rounds: number;
  /**
   * How many of the candidates the loop ACTUALLY VISITED were refused by
   * the corner tests.
   *
   * VISITED, not built. The first version counted refusals over the whole
   * 256-candidate pool, which is a fact about the draw and not about the
   * loop: it stayed comfortably above zero when the accept expression was
   * mutated to ignore the corner verdict entirely, so the assertion it
   * fed proved nothing it claimed to.
   */
  readonly cornerRefused: number;
  /** The pool it was given, so an exhausted plan is visible as one. */
  readonly attempts: number;
  readonly coveredW: number;
}

/**
 * Cook the planner over ONE lap at ONE graph seed.
 *
 * THE TWO SEEDS ARE SEPARATE PARAMETERS AND THAT IS THE POINT. The first
 * draft took one `seed` and used it both to seed the graph and to fetch
 * the frames, which is right only while a caller varies them together --
 * and the flare sweep below does not. It passed lap 1 and plan seed 2, got
 * lap 2's frames, and reported a violation against lap 1's corners that
 * was an artefact of the harness rather than a defect in the port. The
 * frames come in explicitly now so the two cannot drift apart again.
 */
async function planOf(
  lap: Lap,
  frames: Geometry,
  seed: number,
  budgetW: number,
  attempts = 256,
): Promise<PlanResult> {
  const opts: PlanOptions = {
    lapW: lap.lengthW,
    halfWidth: lap.halfWidth,
    budgetAttr: BUDGET.budgetW,
    minQuantile: LONG_QUANTILE,
    attempts,
  };
  const g = new Graph(seed);
  const framesIn = g.add(dataInput, {}, "frames");
  g.setParam(framesIn, "items", [makeGeometryItem(frames)]);
  // THE BUDGET AS A COLUMN, which is how the assembly supplies it — from
  // `writeCoverBudget`, off a coverage measurement in the same graph. A
  // constant here is the same shape with the measurement stood in for, so
  // these tests exercise the path the demo uses rather than a second one.
  const withBudget = g.add(
    setAttribute,
    { name: BUDGET.budgetW, tupleSize: 1, value: budgetW },
    "budget",
  );
  g.connect(framesIn, "out", withBudget, "in");
  const out = addEnclosurePlan(g, withBudget, opts, "l6");
  g.output(out, PLAN_PIN, "plan");

  const geo = firstGeometry((await cook(g)).outputs["plan"]);
  expect(geo, `seed ${seed}: the planner produced no geometry`).toBeDefined();
  const pts = geo!.attrs.point;
  const acc = pts.require(PLAN.accepted);
  const start = pts.require(PLAN.startW);
  const len = pts.require(PLAN.lengthW);
  const corner = pts.require(PLAN.cornerOk);
  const round = pts.require(PLAN.round);
  const covered = pts.require(PLAN.coveredW);

  const plans: Planned[] = [];
  let cornerRefused = 0;
  const rounds = round.get(0);
  for (let i = 0; i < pts.count; i++) {
    const visited = pts.require(PLAN.attempt).get(i) < rounds;
    if (visited && corner.get(i) === 0) cornerRefused++;
    if (acc.get(i) > 0) {
      plans.push({ startW: start.get(i), lengthW: len.get(i), cornerOk: corner.get(i) });
    }
  }
  return {
    plans,
    rounds,
    cornerRefused,
    attempts: pts.count,
    coveredW: covered.get(0),
  };
}

/** The reference's own three-way overlap test, on the loop. */
function clashes(a: Planned, b: Planned, lapW: number): boolean {
  const sep = ENCLOSE.separationW;
  const ov = (x0: number, x1: number, y0: number, y1: number): boolean => x0 < y1 && y0 < x1;
  const a0 = a.startW;
  const a1 = a.startW + a.lengthW + sep;
  const b0 = b.startW;
  const b1 = b.startW + b.lengthW + sep;
  return (
    ov(a0, a1, b0, b1) || ov(a0 + lapW, a1 + lapW, b0, b1) || ov(a0, a1, b0 + lapW, b1 + lapW)
  );
}

describe("racetrack enclosure, as a graph", () => {
  it("draws the same stretch length drawStretchLengthW does", () => {
    // A FUNCTION, NOT A DRAW, so this one is exact to f32 and there is no
    // reason to accept a postcondition instead. Swept across the whole
    // unit interval rather than the tail the racetrack uses, because the
    // expression carries both branches and only one of them is exercised
    // in production — which is precisely how the other one rots.
    let worst = 0;
    let worstU = 0;
    const geo = createPointCloud(1);
    for (let i = 0; i <= 1000; i++) {
      const u = i / 1000;
      const got = evaluateField(stretchLengthField(u), { geo, domain: "point", seed: 1 })
        .data[0] as number;
      const want = drawStretchLengthW(u);
      const d = Math.abs(got - want) / Math.max(1, Math.abs(want));
      if (d > worst) {
        worst = d;
        worstU = u;
      }
    }
    // f32 storage of a value reaching 42.4, through an exp of a ramp of a
    // log: a handful of spacings, and nothing like the half-percent a
    // straightened first segment would cost.
    expect(worst, `worst at u=${worstU}`).toBeLessThan(1e-5);
    console.log(`L-6 length field: worst relative error ${worst.toExponential(2)} at u=${worstU}`);
  });

  it("plans stretches that satisfy L-6, at the budget the rule asks for", async () => {
    let totalPlans = 0;
    let totalRounds = 0;
    let totalRefused = 0;

    for (const seed of SEEDS) {
      const { lap, frames } = await dressedLapFor(seed);
      // A budget that wants several stretches, so the clash test is
      // exercised rather than merely present. `longCoverBudgetW` returns
      // 10-40W on a real lap; 80 is deliberately past that.
      const budgetW = 80;
      const corners = cornersOf(lap);
      const r = await planOf(lap, frames, seed, budgetW);
      totalPlans += r.plans.length;
      totalRounds += r.rounds;
      totalRefused += r.cornerRefused;

      expect(r.plans.length, `seed ${seed}: planned nothing at a budget of ${budgetW}W`)
        .toBeGreaterThan(0);
      // THE POOL WAS BIG ENOUGH, which is the claim `attempts` has to make
      // for any of the rest to mean anything. A loop that ran out of
      // candidates stops for the wrong reason and reports a short plan.
      expect(r.rounds, `seed ${seed}: the candidate pool was exhausted`).toBeLessThan(r.attempts);

      for (const [i, p] of r.plans.entries()) {
        // L-6: never START inside a tight corner.
        expect(
          radiusAtW(lap, p.startW),
          `seed ${seed} plan ${i} at ${p.startW.toFixed(1)}W starts inside a corner`,
        ).toBeGreaterThanOrEqual(ENCLOSE.noStartTighterThanW);

        // AND NOT SO CLOSE BEFORE ONE THAT THE FLARE IS STILL OPENING IN
        // IT, which is L-6's second refusal and which this suite claimed
        // to pin while asserting nothing about it. That omission hid a
        // real defect: the port measured to the first frame under 8W and
        // the rule measures to a corner's ENTRY, which is its first frame
        // under 12W and comes up to 4.6W earlier -- so starts 0.8W before
        // the entry of a 7.1W corner were being accepted. Asserted here
        // against `cornersOf` and `beforeEntryW`, which are the functions
        // the rule is written in.
        for (const c of corners) {
          if (c.tightestW >= ENCLOSE.noStartTighterThanW) continue;
          const before = beforeEntryW(p.startW, c.entryW, lap.lengthW);
          expect(
            before,
            `seed ${seed} plan ${i} at ${p.startW.toFixed(1)}W starts ${before.toFixed(2)}W ` +
              `before the entry of a corner whose tightest is ${c.tightestW.toFixed(2)}W`,
          ).toBeGreaterThanOrEqual(ENCLOSE.flareW);
        }

        // AND THE LOOP CONSULTED THE VERDICT rather than merely computing
        // it. Every candidate carries `cornerOk` whether or not `accept`
        // reads it, so the counts below can look healthy while the gate
        // does nothing -- measured, with a mutant that dropped the term.
        // An accepted plan carrying a 0 says so directly.
        expect(p.cornerOk, `seed ${seed} plan ${i}: accepted against its own corner verdict`)
          .toBe(1);

        // And a length the source's quantiles could have produced, above
        // the tail the racetrack draws from.
        expect(p.lengthW, `seed ${seed} plan ${i}: length below the floor`).toBeGreaterThanOrEqual(
          ENCLOSE.minLengthW,
        );
        expect(p.lengthW, `seed ${seed} plan ${i}: length past the observed maximum`)
          .toBeLessThanOrEqual(drawStretchLengthW(1) + 1e-4);

        // And separated from every other, on the loop.
        for (const [j, q] of r.plans.entries()) {
          if (i >= j) continue;
          expect(
            clashes(p, q, lap.lengthW),
            `seed ${seed}: plans ${i} and ${j} are within ${ENCLOSE.separationW}W`,
          ).toBe(false);
        }
      }

      // THE BUDGET IS REACHED AND NOT BLOWN. The clamp means the last
      // stretch is cut to what is left, so the total lands ON the budget
      // rather than past it — the failure the clamp exists to prevent took
      // a lap to 26.3% against a 25% ceiling.
      // THE OVERSHOOT THE CLAMP ALLOWS IS `minLengthW` AND NOT ZERO, which
      // is the rule rather than slack in this test: the clamp floors the
      // room at `minLengthW`, so a lap with 0.1W left still places a 0.5W
      // stretch rather than a 0.1W sliver. A bound of `budgetW + 1e-3`
      // passed on the four seeds here and failed at seed 1 / budget 120
      // (120.42) and seed 4 / budget 50 (50.33) -- a latent failure this
      // suite would have hit the first time anybody changed a number.
      const sum = r.plans.reduce((a, p) => a + p.lengthW, 0);
      expect(sum, `seed ${seed}: overshot the budget`).toBeLessThanOrEqual(
        budgetW + ENCLOSE.minLengthW + 1e-3,
      );
      expect(Math.abs(sum - r.coveredW), `seed ${seed}: the running total disagrees with the plans`)
        .toBeLessThan(1e-3);
    }

    // BOTH BRANCHES HAVE TO HAVE RUN or the comparison proved nothing: a
    // planner that accepted every draw would satisfy every check above.
    // Counted over the candidates the loop VISITED -- see
    // `PlanResult.cornerRefused` for why the pool-wide count did not.
    expect(totalRefused, "the corner tests never refused a visited candidate").toBeGreaterThan(0);
    console.log(
      `L-6 graph plan: ${totalPlans} stretches over ${SEEDS.length} seeds — ` +
        `${totalRounds} attempts, ${totalRefused} refused by the corner tests`,
    );
  }, 120000);

  it("never starts a stretch inside the flare of a tight corner, swept", async () => {
    // A SWEEP, BECAUSE FOUR SEEDS AT ONE BUDGET DO NOT REACH THE RULE.
    // The flare refusal was asserted above from the moment it was written
    // and the assertion passed against the BROKEN boundary — the four
    // laps at 80W simply never drew a start in the 0-4.6W window where
    // the two definitions of "corner entry" disagree. The violations sit
    // at other budgets and other draws, so this varies both.
    //
    // THE LAP SEED AND THE PLAN SEED ARE INDEPENDENT, which is what makes
    // this affordable: a lap costs a full dressing to cook and a plan
    // costs a cook of this graph alone, so sweeping the plan seed over a
    // handful of laps buys far more draws per second than sweeping laps.
    let plans = 0;
    let closest = Infinity;
    for (const seed of SEEDS) {
      const { lap, frames } = await dressedLapFor(seed);
      const corners = cornersOf(lap).filter((c) => c.tightestW < ENCLOSE.noStartTighterThanW);
      expect(corners.length, `seed ${seed}: no tight corner to test against`).toBeGreaterThan(0);
      for (const planSeed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        for (const budgetW of [40, 80, 120]) {
          const r = await planOf(lap, frames, planSeed, budgetW, 512);
          for (const p of r.plans) {
            plans++;
            for (const c of corners) {
              const before = beforeEntryW(p.startW, c.entryW, lap.lengthW);
              closest = Math.min(closest, before);
              expect(
                before,
                `lap ${seed} plan seed ${planSeed} budget ${budgetW}: start ` +
                  `${p.startW.toFixed(3)}W is ${before.toFixed(3)}W before the entry of a ` +
                  `corner whose tightest is ${c.tightestW.toFixed(2)}W`,
              ).toBeGreaterThanOrEqual(ENCLOSE.flareW);
            }
          }
        }
      }
    }
    expect(plans, "the sweep planned nothing").toBeGreaterThan(200);
    console.log(
      `L-6 flare sweep: ${plans} plans, closest approach to a tight entry ` +
        `${closest.toFixed(3)}W against a flare of ${ENCLOSE.flareW}W`,
    );
  }, 300000);

  it("places a whole minimum stretch when the budget is smaller than one", async () => {
    // THE FLOOR ON THE CLAMP'S ROOM, which nothing else here reaches. The
    // clamp is `min(max(m, drawn), max(m, budget - covered))` and the
    // SECOND `max` is a branch that only fires while `0 < budget - covered
    // < minLengthW` -- a sliver of budget, which the ordinary seeds step
    // straight over. A mutant that dropped it survived the whole suite.
    //
    // A budget below `minLengthW` puts the lap in that state on the very
    // first attempt, so the rule is forced: the stretch comes out at the
    // floor rather than at the budget, and the lap is deliberately left a
    // little over rather than holding something too short to be a stretch
    // at all. `tunnels.ts` calls anything shorter "a rounding error".
    const { lap, frames } = await dressedLapFor(1);
    const budgetW = 0.2;
    expect(budgetW, "the budget must be under the floor for this to test anything").toBeLessThan(
      ENCLOSE.minLengthW,
    );
    const r = await planOf(lap, frames, 1, budgetW);
    expect(r.plans.length, "a sliver of budget still buys one stretch").toBe(1);
    expect(r.plans[0].lengthW).toBeCloseTo(ENCLOSE.minLengthW, 5);
  }, 60000);

  it("refuses to overlap, which is the only thing the loop is for", async () => {
    // THE CLASH TEST, FORCED. At a budget this large the planner wants far
    // more stretches than the lap can hold apart, so the overlap rejection
    // is the binding constraint rather than an occasional one — and if it
    // did nothing, the stretches would pile on top of each other and the
    // pairwise check above would fail here rather than pass everywhere.
    const { lap, frames } = await dressedLapFor(1);
    const budgetW = 0.25 * lap.lengthW;
    const r = await planOf(lap, frames, 1, budgetW, 512);
    expect(r.plans.length).toBeGreaterThan(2);
    for (const [i, p] of r.plans.entries()) {
      for (const [j, q] of r.plans.entries()) {
        if (i >= j) continue;
        expect(clashes(p, q, lap.lengthW), `plans ${i} and ${j} overlap`).toBe(false);
      }
    }
    // The loop worked for it: more attempts than plans, by a margin.
    expect(r.rounds).toBeGreaterThan(r.plans.length);
    console.log(
      `L-6 graph clash: budget ${budgetW.toFixed(0)}W -> ${r.plans.length} stretches ` +
        `in ${r.rounds} attempts`,
    );
  }, 120000);
});

/** One tiled piece, read back off the cloud. */
interface Piece {
  readonly stationW: number;
  readonly t: number;
  readonly h: number;
  readonly slot: number;
  readonly tile: number;
  readonly tiles: number;
  readonly ord: number;
  readonly startW: number;
  readonly lengthW: number;
  readonly acrossW: number;
  readonly baseH: number;
  readonly columns: number;
}

async function tilesOf(
  lap: Lap,
  frames: Geometry,
  seed: number,
  budgetW: number,
  attempts = 256,
): Promise<Piece[]> {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const cover = coverCandidates(all);
  const opts: PlanOptions = {
    lapW: lap.lengthW,
    halfWidth: lap.halfWidth,
    budgetAttr: BUDGET.budgetW,
    minQuantile: LONG_QUANTILE,
    attempts,
  };
  const g = new Graph(seed);
  const framesIn = g.add(dataInput, {}, "frames");
  g.setParam(framesIn, "items", [makeGeometryItem(frames)]);
  const coverIn = g.add(dataInput, {}, "cover");
  // The pose ids the kit recorded for each candidate — the same lookup
  // `poseLibrary` builds, which this suite reaches through its own copy
  // rather than importing the graph that will consume this stage.
  const lib = poseLibrary(shippedVocabulary());
  const poses = cover.map((a) => lib.posesOf.get(a.id) ?? []);
  g.setParam(coverIn, "items", [makeGeometryItem(coverCloud(cover, poses))]);
  const slotsIn = g.add(dataInput, {}, "slots");
  g.setParam(slotsIn, "items", [makeGeometryItem(slotCloud(maxColumns(cover)))]);

  const withBudget = g.add(
    setAttribute,
    { name: BUDGET.budgetW, tupleSize: 1, value: budgetW },
    "budget",
  );
  g.connect(framesIn, "out", withBudget, "in");
  const withTests = writeCornerTests(g, withBudget, lap.lengthW, "f");
  const plan = addEnclosurePlan(g, withBudget, opts, "l6");
  const out = addEnclosureTiles(
    g,
    withTests,
    plan,
    coverIn,
    slotsIn,
    opts,
    cover.map((a) => a.instances),
    "l6t",
  );
  g.output(out, "out", "tiles");

  const geo = firstGeometry((await cook(g)).outputs["tiles"]);
  expect(geo, "the tiler produced no geometry").toBeDefined();
  const p = geo!.attrs.point;
  const num = (n: string) => p.require(n);
  const st = num(TRACK_FRAME.station);
  const t = num("trackT");
  const h = num("trackH");
  const slot = num(PIECE.slot);
  const tile = num(PIECE.tile);
  const tiles = num(PIECE.tiles);
  const ord = num(COVER_ASSET.ord);
  const startW = num(PLAN.startW);
  const lengthW = num(PLAN.lengthW);
  const acrossW = num(COVER_ASSET.acrossW);
  const baseH = num(COVER_ASSET.baseH);
  const columns = num(COVER_ASSET.columns);
  const out2: Piece[] = [];
  for (let i = 0; i < p.count; i++) {
    out2.push({
      stationW: st.get(i),
      t: t.get(i),
      h: h.get(i),
      slot: slot.get(i),
      tile: tile.get(i),
      tiles: tiles.get(i),
      ord: ord.get(i),
      startW: startW.get(i),
      lengthW: lengthW.get(i),
      acrossW: acrossW.get(i),
      baseH: baseH.get(i),
      columns: columns.get(i),
    });
  }
  return out2;
}

describe("racetrack enclosure tiling, as a graph", () => {
  it("tiles a run the way coverPlacements does", async () => {
    // SWEPT UNTIL BOTH PIECES HAVE BEEN USED, and that is not tidiness.
    // The shipped vocabulary has exactly two cover candidates and they
    // exercise different halves of this stage: one is 13.4W across and
    // spans the corridor alone (columns 1), the other is 1.4W and needs
    // four side by side. A single seed draws whichever it draws -- seed 1
    // at 80W took the wide one every time -- so the column stamp and its
    // filter were dead to the test, and a mutant that pinned every run to
    // ONE column passed the whole suite.
    const { lap, frames } = await dressedLapFor(1);
    const pieces: Piece[] = [];
    for (const planSeed of [1, 2, 3, 4, 5, 6]) {
      pieces.push(...(await tilesOf(lap, frames, planSeed, 80)));
    }
    expect(pieces.length, "tiled nothing").toBeGreaterThan(20);
    const ords = new Set(pieces.map((p) => p.ord));
    expect(ords.size, "the sweep used only one of the two cover pieces").toBeGreaterThan(1);
    expect(
      Math.max(...pieces.map((p) => p.columns)),
      "no run needed more than one column, so the stamp was never tested",
    ).toBeGreaterThan(1);

    // Group the pieces back into the runs they came from. `startW` is the
    // run's identity here — two runs cannot share one, because the clash
    // test keeps them `separationW` apart.
    // Keyed on the start AND the piece, because the sweep pools several
    // plans and two of them may legitimately begin at the same station
    // with different assets.
    const runs = new Map<string, Piece[]>();
    for (const p of pieces) {
      const key = `${p.startW}|${p.ord}|${p.tiles}`;
      const held = runs.get(key) ?? [];
      held.push(p);
      runs.set(key, held);
    }
    expect(runs.size, "every piece landed in one run").toBeGreaterThan(0);

    let widest = 0;
    for (const [key, run] of runs) {
      const first = run[0] as Piece;
      const alongW = Math.max(0.3, (coverCandidates(
        (shippedVocabulary().assets as unknown as PlaceableAsset[]).filter((a) => a.where),
      )[first.ord] as PlaceableAsset).size.along);

      // THE TILE COUNT IS THE REFERENCE'S, which is the whole reason
      // `spacing` is a field rather than a constant: one MORE tile than
      // the length needs, so pieces overlap instead of abutting.
      const want = Math.max(1, Math.ceil(first.lengthW / alongW) + 1);
      expect(first.tiles, `run ${key}: tile count`).toBe(want);

      // EVERY TILE PRESENT, EXACTLY ONCE PER COLUMN. A tiler that dropped
      // its last piece would still satisfy a pitch check.
      const seen = new Map<number, number>();
      for (const p of run) seen.set(p.tile, (seen.get(p.tile) ?? 0) + 1);
      expect(seen.size, `run ${key}: missing tiles`).toBe(want);
      for (const [tile, count] of seen) {
        expect(count, `run ${key} tile ${tile}: column count`).toBe(
          first.columns,
        );
      }

      // AND EACH SITS WHERE THE REFERENCE PUTS IT.
      for (const p of run) {
        const along = (p.tile + 0.5) * (p.lengthW / p.tiles);
        const want = (p.startW + along) % lap.lengthW;
        expect(p.stationW, `run ${key} tile ${p.tile}: station`).toBeCloseTo(
          want,
          3,
        );

        // The flare, from the nearer mouth, exactly as the rule states it.
        const toMouth = Math.min(along, p.lengthW - along);
        const lift =
          toMouth >= ENCLOSE.flareW ? 0 : ENCLOSE.flareRiseW * (1 - toMouth / ENCLOSE.flareW);
        expect(p.h, `run ${key} tile ${p.tile}: height`).toBeCloseTo(
          p.baseH + lift,
          3,
        );

        // The column's lateral, likewise.
        const wantT =
          p.columns === 1
            ? 0
            : -ENCLOSE.coverW +
              p.acrossW / 2 +
              (p.slot * (2 * ENCLOSE.coverW - p.acrossW)) / (p.columns - 1);
        expect(p.t, `run ${key} tile ${p.tile} slot ${p.slot}: lateral`)
          .toBeCloseTo(wantT, 4);
        widest = Math.max(widest, Math.abs(p.t) + p.acrossW / 2);
      }
    }

    // THE POINT OF THE COLUMNS: the run spans the corridor it is meant to
    // cover. A single column on a narrow piece would pass every check
    // above and leave the road open to the sky.
    expect(widest, "the pieces do not reach across the corridor").toBeGreaterThanOrEqual(
      ENCLOSE.coverW - 1e-6,
    );
    console.log(
      `L-6 graph tiling: ${runs.size} runs, ${pieces.length} pieces, reach ${widest.toFixed(2)}W ` +
        `against a corridor half-span of ${ENCLOSE.coverW}W`,
    );
  }, 120000);

  it("clears the corridor ceiling under every piece", async () => {
    // COVER IS EXEMPT FROM Z-1 BECAUSE IT IS ALREADY CLEAR, which is a
    // claim about the base and not about the centre — `coverCandidates`
    // argues it at length and `coverPlacements` is where it has to hold.
    // A piece whose base dipped under the ceiling would be stood off by
    // Z-1 and put a hole in the roof exactly over the racing line.
    const { lap, frames } = await dressedLapFor(2);
    const pieces = await tilesOf(lap, frames, 2, 80);
    expect(pieces.length).toBeGreaterThan(20);
    const kit = shippedVocabulary();
    const cover = coverCandidates(
      (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where),
    );
    let lowest = Infinity;
    for (const p of pieces) {
      const tall = (cover[p.ord] as PlaceableAsset).size.tall;
      lowest = Math.min(lowest, p.h - tall / 2);
    }
    expect(lowest, "a piece reaches below the corridor ceiling").toBeGreaterThanOrEqual(
      CORRIDOR.ceilingW - 1e-4,
    );
    console.log(
      `L-6 graph tiling: lowest base ${lowest.toFixed(3)}W against a ceiling of ${CORRIDOR.ceilingW}W`,
    );
  }, 120000);
});

describe("racetrack enclosure budget, as a graph", () => {
  it("restates enclosure.ts's long-stretch threshold without changing it", () => {
    // Two independent statements of one measurement, CHECKED equal — the
    // same arrangement `dressGraph` pins for the ray numbers, and for the
    // same reason: the check is what catches a hand edit, and the
    // independence is what keeps a retune of one from silently moving the
    // other.
    expect(HEAVY_W).toBe(ENCLOSURE.heavyW);
  });

  it("measures the coverage and the budget measureEnclosure does", async () => {
    // AGAINST THE RAY CAST'S OWN OUTPUT, which is the only fair
    // comparison. `measureEnclosure` decides which FRAMES are covered by
    // casting rays at boxes; this stage takes that decision as given and
    // does the arithmetic over it. Feeding the graph the same covered mask
    // the reference computed isolates the arithmetic, which is the part
    // that was ported — a graph that re-cast the rays would be comparing
    // two ray casts and calling the difference a budget error.
    let worstCovered = 0;
    let worstLong = 0;
    let worstBudget = 0;
    let nonZero = 0;
    let zero = 0;

    for (const seed of SEEDS) {
      const { lap, frames, dressing } = await dressedLapFor(seed);
     for (const bare of [false, true]) {
      // TWO INPUTS PER LAP, BECAUSE THE RULE HAS TWO ANSWERS. A dressed
      // lap already holds L-6's own cover, so the budget it asks for is
      // ZERO -- correct, and the first draft of this test asserted the
      // opposite and failed. A lap with NOTHING covered is the other
      // branch and the one the rule was written for: it asks for the
      // population's median share of long stretches, about 14W here. A
      // stage returning zero always would pass one of these and not both.
      const mask = bare
        ? (enclosureMask(lap, dressing.boxes).map(() => false) as boolean[])
        : enclosureMask(lap, dressing.boxes);
      const report = bare
        ? { share: 0, heavyTailShare: 0 }
        : measureEnclosure(lap, dressing.boxes);

      // THE MASK COMES IN BY INDEX rather than being written onto the
      // frames, because the frames are a fixture shared across this whole
      // suite and adding a column to them would reach every other test.
      // One point per frame carrying the ray cast's verdict, gathered at
      // the frame's own ordinal, is the same value with nothing mutated.
      const maskCloud = createPointCloud(mask.length);
      const maskCol = maskCloud.attrs.point.add("covered", "f32", 1);
      const maskP = maskCloud.attrs.point.require("P");
      for (let i = 0; i < mask.length; i++) {
        maskP.setTuple(i, [i, 0, 0]);
        maskCol.set(i, mask[i] ? 1 : 0);
      }

      const g = new Graph(seed);
      const framesIn = g.add(dataInput, {}, "frames");
      g.setParam(framesIn, "items", [makeGeometryItem(frames)]);
      const maskIn = g.add(dataInput, {}, "mask");
      g.setParam(maskIn, "items", [makeGeometryItem(maskCloud)]);
      const withMask = g.add(
        transferByIndex,
        { index: index(), attributes: ["covered"], outOfRange: "clamp" },
        "maskGather",
      );
      g.connect(framesIn, "out", withMask, "in");
      g.connect(maskIn, "out", withMask, "source");
      const out = writeCoverBudget(g, withMask, "covered", lap.lengthW, "b");
      g.output(out, "out", "budget");
      const cooked = firstGeometry((await cook(g)).outputs["budget"])!;
      const pts = cooked.attrs.point;

      const gotCovered = pts.require(BUDGET.coveredW).get(0);
      const gotLong = pts.require(BUDGET.longW).get(0);
      const gotBudget = pts.require(BUDGET.budgetW).get(0);

      const wantCovered = report.share * lap.lengthW;
      const wantLong = report.heavyTailShare * wantCovered;
      const wantBudget = longCoverBudgetW(wantCovered, wantLong, lap.lengthW);

      worstCovered = Math.max(worstCovered, Math.abs(gotCovered - wantCovered));
      worstLong = Math.max(worstLong, Math.abs(gotLong - wantLong));
      worstBudget = Math.max(worstBudget, Math.abs(gotBudget - wantBudget));
      if (wantBudget > 0) nonZero++;
      else zero++;
      expect(gotBudget > 0, `seed ${seed} bare=${bare}: budget sign`).toBe(wantBudget > 0);
     }
    }

    // THE BOUND IS THE SUMMATION, and nothing else. Both sides add one
    // frame's arc per covered frame over a lap of ~900 frames, in a
    // different order and through f32 columns on one side; a covered arc
    // reaches ~35W, where f32 spacing is 4e-6, so a few hundred additions
    // carry a few thousandths at the very worst.
    const TOL = 5e-2;
    expect(worstCovered, "covered arc").toBeLessThan(TOL);
    expect(worstLong, "long-stretch arc").toBeLessThan(TOL);
    expect(worstBudget, "budget").toBeLessThan(TOL);

    // BOTH ANSWERS HAVE TO HAVE APPEARED. Zero is a legal budget and so
    // is fourteen half-widths; a stage stuck on either would satisfy every
    // bound above, so the test that both occur is separate from the test
    // that each is right.
    expect(nonZero, "no input asked for cover").toBeGreaterThan(0);
    expect(zero, "no input was already satisfied").toBeGreaterThan(0);
    console.log(
      `L-6 graph budget: worst |dCovered| ${worstCovered.toExponential(2)}W, ` +
        `|dLong| ${worstLong.toExponential(2)}W, |dBudget| ${worstBudget.toExponential(2)}W ` +
        `over ${SEEDS.length} seeds (${nonZero} asked for cover, ${zero} already satisfied)`,
    );
  }, 120000);
});
