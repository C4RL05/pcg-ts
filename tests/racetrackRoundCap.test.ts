/**
 * The repair loop's round cap, gated against the vocabulary the page ships.
 *
 * WHY THIS SUITE EXISTS, and it is a false-pass postmortem rather than a
 * new rule. `dressLap`'s cap was twelve; a seed of the shipped vocabulary
 * needed thirteen, so the published page shipped `converged: false` on one
 * visitor's lap and nothing went red. Every dressing gate in the suite was
 * green throughout, because every one of them sweeps three to twelve seeds
 * — `racetrackVocabulary` already asserts `stats.converged` on the shipped
 * kit, at SEED 1 ALONE. The assertion was right and its population was too
 * small to contain the defect. This file is that same assertion over a
 * population that does.
 *
 * AND THEN IT HAPPENED AGAIN, WHICH IS WHY THE WIDTH IS 1024 AND NOT 256.
 * This suite was written at 256 seeds, with a header arguing at length that
 * 256 was "the width the finding was made at" and "not negotiable
 * downward". It was not wide enough either. At 1024 seeds the same
 * measurement found **seed 656 needing twenty-four rounds** against the cap
 * of 20 that had just been raised to clear the seed found at 256 — so the
 * page went on shipping `converged: false`, past a green suite, for a
 * second time. The cause was not the cap at all: `repairBandMix` had no
 * latch, so the cull and the mix could pass one placement back and forth
 * without bound. See `AssetPlacement.mixTried`, `MAX_REPAIR_ROUNDS`'s
 * comment, and PLAN.md, "An unlatched band mix chases without bound".
 *
 * THE LESSON THIS FILE IS NOW CARRYING is therefore not "sweep 256" and
 * not "sweep 1024". It is that a green sweep means the population was
 * clean, never that the sweep was long enough — and that a defect this
 * suite CAN see is worth more width than it costs, because the two seeds
 * that found the two defects were one in 256 and one in 1024.
 *
 * WHAT IS ASSERTED IS CONVERGENCE, NOT A ROUND COUNT, which is
 * `tests/racetrackDress.test.ts`'s position and holds here for its reason:
 * a threshold on rounds is a number fitted to this kit, this spline and
 * this machine. The observed maximum is REPORTED — a regression that
 * doubles it while still settling is worth a human seeing — and asserted
 * on only through the cap itself, which is what `converged` already means.
 *
 * THE COST, STATED: a fresh road cook and a dressing per seed, minutes.
 * That buys the one property nothing cheaper can: that the page settles
 * for every visitor, not for the first few.
 */
import { describe, expect, it } from "vitest";
import { dressLap } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

/**
 * The population, and it is the one the cap was measured over.
 *
 * See the header: 256 was argued to be enough and was not, so this is not a
 * budget to be trimmed when the suite gets slow. Trimming it back to 256
 * would restore a sweep that is KNOWN to pass against a broken cap, which
 * is the one property a regression test may not have.
 */
const SWEEP_SEEDS = 1024;

/**
 * The seeds that are run by name as well as swept, and what each is for.
 *
 * NAMED SO THE GUARD DOES NOT DEPEND ON THE SWEEP'S WIDTH SURVIVING A
 * FUTURE EDIT, and so a bisect gets its answer in a second rather than in
 * minutes. Between them they cover both defects and the current worst
 * case, so all three of the things that have gone wrong here are pinned
 * individually:
 *
 * - **656** is the chase. Unlatched it runs 24 rounds — ramp 2, then 22 of
 *   `cull=1 mix=1` — which no cap this loop would tolerate can absorb. It
 *   is the seed that proves the latch is present, not the cap.
 * - **242** is the one found at 256 seeds, and it is a mixed case: ramp 7
 *   plus chase 6 unlatched, 8 rounds and pure ramp with the latch. It was
 *   recorded as "a genuine L-6 ramp rather than a chase", which is what
 *   sent the first fix after the cap instead of after the mechanism.
 * - **3072** is the worst lap known anywhere, from a 4096-seed sweep, at 11
 *   rounds of pure L-6 ramp with the mix silent from round two. It sits
 *   outside the swept range on purpose: it is the lap the cap's five rounds
 *   of headroom are measured against, and a change that eats that headroom
 *   should fail here first.
 */
const NAMED: readonly { seed: number; why: string }[] = [
  { seed: 656, why: "the chase — 24 rounds with repairBandMix unlatched, 4 with the latch" },
  { seed: 242, why: "the seed found at 256 seeds — ramp 7 + chase 6 unlatched, 8 with the latch" },
  { seed: 3072, why: "the worst lap in 4096 seeds — 11 rounds, and all of it L-6 ramp" },
];

/** Long enough that machine load decides nothing. A TIMEOUT IS NOT A TOLERANCE. */
const SWEEP_MS = 1_800_000;

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
          `DO NOT REACH FOR MAX_REPAIR_ROUNDS FIRST: that was done twice, at 12 and at 20, and ` +
          `both times the number was being fitted to a mechanism failure. Run the seed with ` +
          `ROAD_TRACE=1 and read the per-round counters. Rounds that ADD placements (cover += ` +
          `non-zero) are L-6 ramping against a rising budget; they terminate, and more rounds is ` +
          `what they want. Rounds flat at cull=1 mix=1 are the cull and the mix trading — but ` +
          `NOTE THAT A FEW OF THOSE ARE NORMAL AND ARE NOT THE OLD DEFECT: seeds 367 and 554 ` +
          `each run five of them and settle, because AssetPlacement.mixTried retires one ` +
          `placement per round. That latch already exists, so do not "fix" this by adding it. ` +
          `What would be the old defect is MANY such rounds on one seed, which means the latch ` +
          `is being lost — check that the mix still writes it on commit, and that dressLap's ` +
          `re-assert after L-4 still fires, since repairLandmarks rebuilds its victim wholesale ` +
          `and drops the flag. See PLAN.md, "An unlatched band mix chases without bound".`,
      ).toEqual([]);
      console.log(
        `shipped vocabulary settles on all ${SWEEP_SEEDS} seeds; ` +
          `worst is seed ${worst.seed} at ${worst.rounds} rounds`,
      );
    },
    SWEEP_MS,
  );

  it.each(NAMED)("settles seed $seed — $why", async ({ seed, why }) => {
    const { lap } = await lapFor(seed);
    const { rounds, converged } = dressLap(kit, lap, seed, {}).stats;
    expect(
      converged,
      `seed ${seed} ran out of rounds at ${rounds}. It is here because it is ${why}. ` +
        `Read MAX_REPAIR_ROUNDS' comment before changing the cap — this seed has been used to ` +
        `justify raising it once already, on a reading of its trace that was wrong.`,
    ).toBe(true);
  });
});
