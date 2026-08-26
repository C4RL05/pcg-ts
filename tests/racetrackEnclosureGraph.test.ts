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
  makeGeometryItem,
  type Geometry,
} from "pcg-ts";
import {
  PLAN,
  addEnclosurePlan,
  stretchLengthField,
  type PlanOptions,
} from "../demos/racetrack/enclosureGraph.js";
import { ENCLOSE, LONG_QUANTILE, drawStretchLengthW } from "../demos/racetrack/tunnels.js";
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
    budgetW,
    minQuantile: LONG_QUANTILE,
    attempts,
  };
  const g = new Graph(seed);
  const framesIn = g.add(dataInput, {}, "frames");
  g.setParam(framesIn, "items", [makeGeometryItem(frames)]);
  const out = addEnclosurePlan(g, framesIn, opts, "l6");
  // `repeatUntil` names its output pins after the body's exposed
  // outputs, so this one is "carry" rather than "out".
  g.output(out, "carry", "plan");

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
