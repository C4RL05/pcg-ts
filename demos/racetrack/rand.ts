import { hashCombine, hashFloat, hashString } from "pcg-ts";

/**
 * The placement stream's hash.
 *
 * ITS OWN MODULE BECAUSE EVERY RULE DRAWS FROM ONE STREAM. A second
 * generator would make a marker's position depend on which module asked
 * for it, and the whole demo is a determinism claim. It lived in
 * `assets.ts` and was then copied verbatim into `zones.ts` — which
 * `assets.ts` imports, so the copy could not simply be deleted in favour
 * of an import without closing a cycle. Sitting below both, it can be the
 * one definition the comment above always claimed it was.
 *
 * NOT `hashCombine`/`hashFloat` from the library, though it should be.
 * Those are the right primitives and `stations.ts` already uses them; the
 * swap is deferred only because their mix differs from this one, so every
 * generated layout would move and every measured figure in the suite with
 * it. That is a re-baselining, not a cleanup.
 *
 * RE-CONFIRMED 2026-08-27, WITH THE SIZE OF IT. Both claims above still
 * hold — `src/random/hash.ts` exports both functions and
 * `stations.ts:31` imports `hashCombine` from the package — and there are
 * 57 `rand()` call sites across `assets.ts`, `zones.ts` and
 * `dressGraph.ts`. EVERY ONE feeds a placement decision, so the swap
 * moves every lap on every seed, and the suite's figures are not round
 * numbers to be re-typed: they are measured counts (placement totals,
 * covered stretches, corner-mark tallies, enclosure percentages) that
 * several comments reason ABOUT. Re-baselining them means re-deriving the
 * arguments, not just the numbers.
 *
 * THE END CONDITION, so this is a decision and not an open sore: swap it
 * when something ELSE forces a re-baseline anyway — a change to the
 * station process, the kit, or the fitted density — and take the hash
 * with it in the same commit. Doing it alone buys a cleaner import and
 * costs a day of re-reading; doing it alongside costs the diff. Until
 * then this hash IS the demo's stream, and that is the tradeoff on
 * purpose.
 *
 * THE 2026-08-28 RE-BASELINE WAS ONE OF THOSE OCCASIONS AND THE SWAP WAS
 * MEASURED AND DECLINED, which is a different answer from "not yet" and is
 * recorded here so nobody re-opens it from the paragraph above. Z-3's
 * donor order changed (see {@link mixDonorPriority}), which does
 * re-baseline every measured asset identity on the lap. It does NOT
 * re-baseline the stream: placement COUNT, station set and band shares all
 * came out identical on every seed, because the donor order decides WHICH
 * placement is redrawn and not how many or where. Swapping `rand` would
 * have moved all three as well — every station, every asset draw, every
 * corner mark — which is a strictly larger re-baseline bolted onto a
 * behaviour change the owner approved on the FRAMES. The two would then be
 * indistinguishable in the diff and in the suite: a figure that moved
 * could not be attributed to either. So the end condition above stands
 * with one clause added — the occasion must also be one where the swap's
 * blast radius is not WIDER than the change it is riding on.
 */
export function rand(seed: number, index: number, salt: number): number {
  let h = (seed * 0x9e3779b1 + index * 0x85ebca6b + salt * 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * The key {@link mixDonorPriority} draws under, and the key the graph
 * spells into `randomFrom`. One constant so the two cannot drift.
 */
export const MIX_DONOR_KEY = "z3.mixDonor";

/** Hoisted: `hashString` walks the key on every call otherwise. */
const MIX_DONOR_KEY_HASH = hashString(MIX_DONOR_KEY);

/**
 * Scratch for reading a number's f32 BITS, which is what the field hashes.
 * Module-level because this runs once per placement per pass.
 */
const F32 = new Float32Array(1);
const F32_BITS = new Uint32Array(F32.buffer);

/**
 * Z-3's donor order: a uniform per STATION, and THE ONE STREAM IN THIS
 * DEMO THAT IS THE LIBRARY'S HASH RATHER THAN `rand` ABOVE.
 *
 * WHY IT HAS TO BE. This number is computed twice, in two languages, and
 * the two answers have to be equal to the bit. `repairBandMix` calls this
 * function; `writeBandMix` spells `randomFrom(attribute(PLACEMENT.station),
 * MIX_DONOR_KEY)` into `quotaRebalance`'s `priority`, and `randomFrom` is
 * `hashFloat(hashCombine(ctx.seed, keyHash, f32 bits of the value))`. No
 * field computes `rand`'s mix — it is `Math.imul` and three xorshifts, and
 * the grammar has no bit operators at all — so the choice was never
 * between two hashes. It was between using the library's hash here and
 * having no shared order, and no shared order is the one outcome the
 * comparison suite exists to rule out.
 *
 * `ctx.seed` IS ZERO AND THAT IS A PROPERTY OF THE NODE, NOT A GUESS.
 * `quotaRebalance` resolves every field param at seed 0 on purpose — it
 * has no seed param, decides nothing at random, and says so at the call
 * (`src/nodes/quotas.ts`, `scalarPerPoint`). So the priority a placement
 * gets does not depend on the graph's seed, on the node's name, or on
 * where in the graph the stage sits, and this function can reproduce it
 * from the station alone. If that ever changes, `bandMix: the decision`
 * fails on every seed — which is the right place to hear about it.
 *
 * THE STATION AND NOT THE ROW INDEX, WHICH IS THE WHOLE OF WHY THIS TAKES
 * A FLOAT. A hash of `PLACEMENT.id` would spread the donors just as well
 * and would break something the graph is measured on: the id is the ROW a
 * placement arrived on, and `tests/racetrackDressGraph.test.ts` asserts
 * that a shuffled input list dresses into the identical lap. That is not
 * tidiness — the in-graph assembly feeds the repair loop straight off
 * `pointScatterOnPath`, whose stations come out in scatter order (measured
 * at 165 descents in 329 points), so a priority keyed on the row would let
 * the scatter's internal ordering pick the donors. The station is a
 * PROPERTY OF THE PLACEMENT and survives any permutation, which is the
 * same reason `pointsToPath` is handed it as an `orderAttr`.
 *
 * HASHING IT IS WHAT MAKES IT USABLE. The station used to be the priority
 * RAW, and ascending arc length put every conversion in the first two
 * tenths of the lap. Passing the same number through the hash keeps the
 * order-free property and throws away the monotonicity, which is exactly
 * the trade `quotaRebalance`'s own `priority` documentation describes.
 *
 * THE f32 ROUNDING IS THE AGREEMENT, not a hazard. `PLACEMENT.station` is
 * an f32 column and `randomFrom` hashes the value's f32 BITS, so writing
 * the caller's double into `F32` here reproduces the column's rounding
 * before the hash sees it. The two paths therefore hash the same 32 bits
 * for the same placement.
 *
 * THE ORDER IS SEED-INDEPENDENT GIVEN THE STATIONS, AND THE LAP IS NOT,
 * which is worth stating because it looks like a determinism hole and is
 * the opposite of one. Two laps with the same station in them rank that
 * station the same way; the seed decides where the stations ARE, which
 * asset stands at each, what band it lands in and whether that band is
 * over quota. So two seeds convert different placements and one seed
 * converts the same ones on every run, which is the promise the demo
 * makes.
 *
 * TIES ARE POSSIBLE IN PRINCIPLE AND DO NOT ARISE. Two placements at the
 * same station would draw the same priority; D-1 puts one asset at a
 * station and the corner language's marks are measured to their own, so
 * the lap does not carry a pair. Both paths break a tie the same way in
 * practice anyway — this file takes the lower index, `quotaRebalance`
 * takes point identity — but that agreement is not something to rely on,
 * and it is named here rather than assumed.
 */
export function mixDonorPriority(stationW: number): number {
  F32[0] = stationW;
  return hashFloat(hashCombine(0, MIX_DONOR_KEY_HASH, F32_BITS[0] as number));
}
