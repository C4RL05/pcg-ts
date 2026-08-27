/**
 * Z-1's corridor resolution, as a field.
 *
 * THE LAST PURELY PER-PLACEMENT RULE, and so the last one checkable
 * against its TypeScript by pure equality on the same input: it reads one
 * placement's lateral, height and extents and answers from those alone,
 * with no draw and nothing about the lap entering it.
 *
 * WHY IT WAS WORTH PORTING AND L-4 WAS NOT. Measured across eight seeds,
 * Z-1 fires 19 to 33 times a lap; L-4 fires once in eight laps, and L-5
 * and D-4's second pass never fire at all on this vocabulary. A port of a
 * rule that does not run has no end-to-end behaviour to check.
 */
import { describe, expect, it } from "vitest";
import { cookLapPlacements } from "../demos/racetrack/assetGraph.js";
import { CORRIDOR, inCorridor, resolveCorridor } from "../demos/racetrack/zones.js";
import { SAME_PLACE_W } from "../demos/racetrack/tolerance.js";
import type { PlaceableAsset } from "../demos/racetrack/assets.js";
import { reserveFor } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { dressLapByGraph, PLACEMENT } from "../demos/racetrack/dressGraph.js";
import { dressedLapFor, lapFor } from "./support/lap.js";

const KIT = shippedVocabulary();

describe("corridorGraph: Z-1 in the lap cook", () => {
  it.each([1, 2, 3, 4])(
    "leaves every placement where resolveCorridor would (seed %i)",
    async (seed) => {
      const { lap } = await lapFor(1);
      const { markers, pool } = reserveFor(KIT, seed);
      const decided = await cookLapPlacements({ lap, seed, pool, markers });

      let inside = 0;
      let worstT = 0;
      let worstH = 0;
      for (const ch of decided.choices) {
        if (!ch) continue;
        const a = pool[ch.assetIndex];
        // THE COOK ALREADY RESOLVED, so running `resolveCorridor` over its
        // answer must be a no-op -- which is the claim, and it is a
        // stronger one than "the two agree on some input" because it is
        // made on the output the page actually dresses from.
        const baseH = ch.h - a.size.tall / 2;
        const again = resolveCorridor(ch.t, baseH, a.size.across, a.size.tall);
        worstT = Math.max(worstT, Math.abs(again.t - ch.t));
        worstH = Math.max(worstH, Math.abs(again.baseH + a.size.tall / 2 - ch.h));
        if (inCorridor(ch.t, baseH)) inside++;
      }
      // eslint-disable-next-line no-console
      console.log(
        `seed ${seed}: ${inside} left inside the corridor, worst re-resolve dt ${worstT.toExponential(2)} dh ${worstH.toExponential(2)}`,
      );
      expect(inside).toBe(0);
      expect(worstT).toBeLessThan(1e-4);
      expect(worstH).toBeLessThan(1e-4);
    },
  );

  it("agrees with resolveCorridor on a sweep that reaches both exits", async () => {
    // THE COOK'S OWN OUTPUT CANNOT PROVE THE SMALL BRANCH FIRES, because a
    // vocabulary might hold no small piece that draws inside. So the two
    // exits are exercised directly on the rule the field transcribes, and
    // the lap test above then says the field is the one being used.
    const small = { across: 0.5, tall: 1.0 };
    const large = { across: 4, tall: 6 };
    let rose = 0;
    let stoodOff = 0;
    for (let k = 0; k <= 40; k++) {
      const t = -1.5 + (3 * k) / 40;
      for (let j = 0; j <= 10; j++) {
        const baseH = (CORRIDOR.ceilingW * j) / 10;
        const s = resolveCorridor(t, baseH, small.across, small.tall);
        const l = resolveCorridor(t, baseH, large.across, large.tall);
        if (s.baseH !== baseH) rose++;
        if (l.t !== t) stoodOff++;
        // Whatever the exit, the answer must be OUT of the corridor --
        // which is the only thing Z-1 actually promises.
        expect(inCorridor(s.t, s.baseH)).toBe(false);
        expect(inCorridor(l.t, l.baseH)).toBe(false);
      }
    }
    expect(rose).toBeGreaterThan(0);
    expect(stoodOff).toBeGreaterThan(0);
    // A large piece stands off far enough that its NEAR FACE clears the
    // edge, not its centre -- the mistake `zones.ts` says this demo made
    // five times.
    const l = resolveCorridor(0.2, 0.5, large.across, large.tall);
    expect(Math.abs(l.t)).toBeCloseTo(CORRIDOR.halfWidthW + large.across / 2, 6);
  });

  it("stands a placement at exactly zero lateral off to the right", async () => {
    // `Math.sign(t || 1)` is 1, so a piece with no side stands off right.
    // The field spells it as `t >= 0`, which is the same answer by a
    // different route -- and this is where the two would part if it were
    // spelled as a plain `Math.sign`.
    const at = resolveCorridor(0, 0.5, 4, 6);
    expect(at.t).toBeGreaterThan(0);
    expect(Math.abs(at.t)).toBeCloseTo(CORRIDOR.halfWidthW + 2, 6);
  });

  it("leaves a placement on the corridor edge alone", async () => {
    // The epsilon is what stops the rule firing on the pieces it has
    // already moved: a placement sitting exactly on an edge is OUTSIDE.
    const onEdge = resolveCorridor(CORRIDOR.halfWidthW, 0.5, 4, 6);
    expect(onEdge.t).toBe(CORRIDOR.halfWidthW);
    const justInside = resolveCorridor(CORRIDOR.halfWidthW - 2 * SAME_PLACE_W, 0.5, 4, 6);
    expect(Math.abs(justInside.t)).toBeGreaterThan(CORRIDOR.halfWidthW);
  });

  it("reports no corridor work left for dressLap to do", async () => {
    // THE OBSERVABLE CONSEQUENCE, and the reason this port is worth
    // making at all: `dressLap` runs Z-1 again over what it is handed,
    // and now finds nothing. A stat that used to read 19 to 33 reads 0,
    // which is the rule having moved rather than having stopped.
    const { lap } = await lapFor(1);
    const reservation = reserveFor(KIT, 1);
    const decided = await cookLapPlacements({
      lap,
      seed: 1,
      pool: reservation.pool,
      markers: reservation.markers,
    });
    const { dressLap } = await import("../demos/racetrack/dress.js");
    const dressed = dressLap(KIT, lap, 1, {
      reservation,
      stations: decided.stations,
      choices: decided.choices,
      language: decided.language,
    });
    // eslint-disable-next-line no-console
    console.log(`corridorFixes with the cook's placements: ${dressed.stats.corridorFixes}`);
    expect(dressed.stats.corridorFixes).toBe(0);
  });
});

void (undefined as unknown as PlaceableAsset);

/**
 * Z-1 ON A LAP THAT HAS SETTLED, which nothing asserted until now.
 *
 * THE GAP THIS CLOSES. Z-1 is compared against `resolveCorridor` in two
 * suites and agrees in both -- but BOTH compare a cloud the cull has not
 * run on. Every rule after Z-1 can move a placement: L-1 pushes one
 * aside, L-5 lowers one, Z-3 redraws one for a different asset with
 * different extents. "Z-1 resolved correctly" and "the finished lap has
 * nothing on the racing line" are different claims, and only the second
 * is what the demo promises. `PLAN.md` recorded the second as unchecked
 * and suspected it was also untrue; it is checked now, and it holds.
 *
 * IT IS THE RULE'S OWN PREDICATE AND NOT A RESTATEMENT OF IT, which is
 * the whole reason this passes where a hand-written version did not.
 * `PLAN.md` reported 3 to 5 violations a lap from `|t| < 1 && base <
 * 1.2`, and they were the test's: Z-3's `over` fill stores `h = 1.2 +
 * tall/2` so that the base IS the ceiling, and recovering it as `h -
 * tall/2` lands an ulp under. `inCorridor` carries `SAME_PLACE_W` for
 * exactly that round trip. A restatement without it measures the
 * arithmetic instead of the rule, which is what `zones.ts` says at
 * length and what this file is now the end-to-end evidence for.
 *
 * BOTH PATHS, ON THE SAME LAP, and the shared population is the point
 * rather than a shortcut. The cook below hands `dressLap`'s settled
 * placements straight to `dressLapByGraph` — it does NOT take the branch
 * where the graph decides its own list — so the two rules answer the same
 * question about the same objects and any disagreement is the rule, not
 * the lap. That is what isolates a transcription error, which is what
 * this file is for; a comparison across two different laps could not tell
 * a wrong rung from a different population.
 *
 * SO THIS FILE DOES NOT COVER THE GRAPH-DECIDED LIST, said plainly
 * because an earlier version of this paragraph claimed it did. That path
 * is `racetrackPlacementAssembly.test.ts`, which omits `placements`; here
 * it would cost the comparison its whole diagnostic power.
 */
describe("corridorGraph: the corridor on a lap that has settled", () => {
  it.each([1, 2, 3])(
    "leaves nothing inside the protected volume (seed %i)",
    async (seed) => {
      const { lap, frames, dressing } = await dressedLapFor(seed);

      // COVER IS EXEMPT AND ONLY COVER. L-6's pieces are placed clear of
      // the corridor by construction and Z-1 is told to leave them alone,
      // so they are not evidence either way; everything else on the lap
      // is what the rule is about.
      const offenders = dressing.placements
        .filter((pl) => pl.cover !== true && inCorridor(pl.t, pl.h - pl.asset.size.tall / 2))
        .map((pl) => ({ t: pl.t, base: pl.h - pl.asset.size.tall / 2, asset: pl.asset.id }));
      expect(offenders, `seed ${seed}: dressLap left geometry on the racing line`).toEqual([]);

      const got = await dressLapByGraph({
        kit: KIT,
        lap,
        frames,
        placements: dressing.placements,
        seed,
        immovable: new Set<number>(),
        mixPinned: dressing.mixPinned,
        pool: dressing.pool,
      });
      const pts = got.placements.attrs.point;
      const t = pts.require(PLACEMENT.t);
      const h = pts.require(PLACEMENT.h);
      const tall = pts.require(PLACEMENT.sizeTall);
      const cover = pts.require(PLACEMENT.cover);
      const bad: { t: number; base: number }[] = [];
      for (let i = 0; i < pts.count; i++) {
        if (cover.get(i) > 0) continue;
        const base = h.get(i) - tall.get(i) / 2;
        if (inCorridor(t.get(i), base)) bad.push({ t: t.get(i), base });
      }
      expect(bad, `seed ${seed}: the lap graph left geometry on the racing line`).toEqual([]);
    },
    120000,
  );
});
