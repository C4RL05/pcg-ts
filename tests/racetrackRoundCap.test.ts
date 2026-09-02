/**
 * The repair loop's round cap, gated against the vocabulary the page ships.
 *
 * WHY THIS SUITE EXISTS, and it is a false-pass postmortem rather than a
 * new rule. `dressLap`'s cap was twelve; seed 242 of the shipped
 * vocabulary needs thirteen, so the published page shipped
 * `converged: false` on one visitor's lap in 256 and nothing went red.
 * Every dressing gate in the suite was green throughout, because every
 * one of them sweeps three to twelve seeds — `racetrackVocabulary` already
 * asserts `stats.converged` on the shipped kit, at SEED 1 ALONE. The
 * assertion was right and its population was too small to contain the
 * defect. This file is that same assertion over a population that does.
 *
 * SO THE WIDTH IS THE WHOLE POINT AND IS NOT NEGOTIABLE DOWNWARD. A sweep
 * of 1..64 or 1..128 passes today, would have passed against the twelve
 * that was broken, and would teach exactly the lesson that produced this:
 * that a green sweep means the population is clean rather than that the
 * sweep was short. 256 is the width the finding was made at, and it
 * contains seed 242 by construction.
 *
 * WHAT IS ASSERTED IS CONVERGENCE, NOT A ROUND COUNT, which is
 * `tests/racetrackDress.test.ts`'s position and holds here for its reason:
 * a threshold on rounds is a number fitted to this kit, this spline and
 * this machine. The observed maximum is REPORTED — a regression that
 * doubles it while still settling is worth a human seeing — and asserted
 * on only through the cap itself, which is what `converged` already means.
 *
 * THE COST, STATED: a fresh road cook and a dressing per seed, tens of
 * seconds. That buys the one property nothing cheaper can: that the page
 * settles for every visitor, not for the first few.
 */
import { describe, expect, it } from "vitest";
import { dressLap } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

/**
 * The population, and it is the one the cap was measured over.
 *
 * See the header: narrower is a false pass waiting to happen, and this
 * number is not a budget to be trimmed when the suite gets slow.
 */
const SWEEP_SEEDS = 256;

/**
 * The seed that found it.
 *
 * NAMED AND RUN ALONE AS WELL AS IN THE SWEEP, so the guard does not
 * depend on the sweep's width surviving a future edit, and so a bisect
 * gets its answer in a second rather than in a minute. It needs thirteen
 * rounds where 255 of its 256 neighbours need two to eight.
 */
const RAMP_SEED = 242;

/** Long enough that machine load decides nothing. A TIMEOUT IS NOT A TOLERANCE. */
const SWEEP_MS = 900_000;

describe("the repair loop's round cap", () => {
  const kit = shippedVocabulary();

  it(
    `settles every lap in the shipped vocabulary, seeds 1..${SWEEP_SEEDS}`,
    async () => {
      const unconverged: { seed: number; rounds: number }[] = [];
      let worst = { seed: 0, rounds: 0 };
      for (let seed = 1; seed <= SWEEP_SEEDS; seed++) {
        const { lap } = await lapFor(seed);
        const { rounds, converged } = dressLap(kit, lap, seed, {}).stats;
        if (!converged) unconverged.push({ seed, rounds });
        if (rounds > worst.rounds) worst = { seed, rounds };
      }
      expect(
        unconverged,
        `the shipped vocabulary did not settle on ${unconverged.length} of ${SWEEP_SEEDS} seeds — ` +
          `${unconverged.map((u) => `seed ${u.seed} still repairing after ${u.rounds}`).join(", ")}. ` +
          `Raising dressLap's MAX_REPAIR_ROUNDS is the fix ONLY if these are L-6 ramps like seed ` +
          `${RAMP_SEED}'s; run with ROAD_TRACE=1 and read the per-round counters first. A seed ` +
          `whose rounds are flat in placements with cull and mix both moving is a chase, and the ` +
          `cap is the wrong instrument for it — see PLAN.md, "Raising the round cap does not ` +
          `reach the street kit".`,
      ).toEqual([]);
      console.log(
        `shipped vocabulary settles on all ${SWEEP_SEEDS} seeds; ` +
          `worst is seed ${worst.seed} at ${worst.rounds} rounds`,
      );
    },
    SWEEP_MS,
  );

  it(`settles seed ${RAMP_SEED}, the L-6 ramp the cap was raised for`, async () => {
    const { lap } = await lapFor(RAMP_SEED);
    const { rounds, converged } = dressLap(kit, lap, RAMP_SEED, {}).stats;
    expect(
      converged,
      `seed ${RAMP_SEED} ran out of rounds at ${rounds}. This is the exact case that shipped ` +
        `converged: false when MAX_REPAIR_ROUNDS was 12 — it needs 13, and the cap is 20 so that ` +
        `a ramp longer than this one still fits.`,
    ).toBe(true);
  });
});
