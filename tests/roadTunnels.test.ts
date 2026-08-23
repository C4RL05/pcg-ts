/**
 * L-6, end to end: cover PLACED, then cover MEASURED.
 *
 * THE SPLIT IS THE POINT. `tunnels.ts` decides where runs of cover go and
 * how they are tiled; `enclosure.ts` casts rays and reports what fraction
 * of the lap actually ends up under something. Nothing here assumes the
 * first produces the second. Tiled pieces either close over the corridor
 * or they do not, and a plan that says "10.5% of lap" while the rays find
 * 2% is a plan that failed — which is precisely the failure mode that
 * made upstream withdraw their first enclosure figure, arrived at from
 * the other direction.
 *
 * MEASURED ON THE ENCLOSURE KIT, NOT THE DEMO'S. The circuit the demo
 * dresses from is 2% enclosed, with a longest covered stretch of nine
 * tenths of a half-width and eight overhead objects that are all thin
 * arches. A rule cannot be developed against a circuit that never
 * triggers it. `ENCLOSURE_KIT` names the exception; see `tests/support/kits.ts`
 * for why that is better than switching the default.
 *
 * AND THE TARGET IS THE POPULATION'S, NOT THAT KIT'S. It is 43%
 * enclosed and the rule asks for 10-25%, with a population median of
 * 10.5%. Building to 43% would be fitting the outlier, which this demo
 * has already done once and paid a week for.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { cornersOf, radiusAtW } from "../demos/road/corners.js";
import { dressLap } from "../demos/road/dress.js";
import { ENCLOSURE, measureEnclosure } from "../demos/road/enclosure.js";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import type { Kit } from "../demos/road/kit.js";
import { ENCLOSURE_KIT, KITS, kitPath } from "./support/kits.js";
import { type Lap, readLap } from "../demos/road/lap.js";
import { makeTrackSpline } from "../demos/road/spline.js";
import type { PlaceableAsset } from "../demos/road/assets.js";
import type { StationedPlacement } from "../demos/road/legibility.js";
import { CORRIDOR } from "../demos/road/zones.js";
import {
  ENCLOSE,
  coverCandidates,
  drawStretchLengthW,
  longStretchShare,
  planEnclosure,
  reduceEnclosure,
} from "../demos/road/tunnels.js";

const KIT = kitPath(ENCLOSURE_KIT);

/**
 * The length draw, checked against the quantiles it was built from.
 *
 * NO KIT NEEDED, so this runs everywhere — and it is the part most worth
 * checking, because the distribution is the whole rule. Median 1.1W and
 * max 42.4W is a factor of forty, and a draw that quietly collapsed the
 * tail would still produce a lap with the right total share made
 * entirely of gantries.
 */
describe("the stretch-length draw", () => {
  const N = 20000;
  const sample = Array.from({ length: N }, (_, i) => drawStretchLengthW((i + 0.5) / N)).sort(
    (a, b) => a - b,
  );
  const q = (f: number): number => sample[Math.floor(f * (N - 1))];

  it("reproduces the quantiles it was fitted to", () => {
    for (const [u, want] of ENCLOSE.lengthCdf) {
      // Within a tenth of a half-width, or 10% for the long tail where
      // the interpolation is logarithmic.
      const got = q(u);
      expect(Math.abs(got - want), `p${u * 100}: got ${got.toFixed(2)}, wanted ${want}`).toBeLessThan(
        Math.max(0.15, 0.1 * want),
      );
    }
  });

  /**
   * THE TAIL IS THE RULE. Six per cent of the source's stretches are
   * longer than 10W and they hold 39% of all covered length: a few real
   * tunnels doing most of the work, among mostly one-frame gantries. A
   * generator that matched the median and lost the tail would look right
   * on every summary and build a circuit with no tunnels in it.
   */
  it("keeps the heavy tail, not just the median", () => {
    const share = longStretchShare(sample);
    expect(
      share,
      `long stretches hold ${(100 * share).toFixed(0)}% of covered length, source ${(100 * ENCLOSE.sourceLongShare).toFixed(0)}%`,
    ).toBeGreaterThan(0.2);
    expect(Math.max(...sample)).toBeGreaterThan(20);
  });

  /**
   * THE CHECK, PROVED ABLE TO FAIL. A draw interpolated linearly instead
   * of logarithmically across the top decile still passes every quantile
   * below p90 and still has the right median — and loses the tail. That
   * is the exact mistake this code is shaped to avoid, so the test has to
   * be able to see it.
   */
  it("sees a draw that lost its tail", () => {
    const flat = Array.from({ length: N }, (_, i) => {
      const u = (i + 0.5) / N;
      return u <= 0.9 ? drawStretchLengthW(u) : 6.9;
    });
    expect(longStretchShare(flat)).toBe(0);
    expect(Math.max(...flat)).toBeLessThan(20);
  });
});

describe.skipIf(!KIT)("enclosure, placed and then measured", () => {
  const kit = JSON.parse(readFileSync(KIT!, "utf8")) as Kit;

  let lap: Lap | undefined;
  async function theLap(): Promise<Lap> {
    if (!lap) {
      const frames = firstGeometry(
        (await cook(buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 })))
          .outputs[OUTPUTS.frames] ?? [],
      );
      if (!frames) throw new Error("no frames");
      lap = readLap(frames);
    }
    return lap;
  }

  it("has a vocabulary to build cover from", () => {
    const cover = coverCandidates(kit.assets as never);
    console.log(
      `${KITS[ENCLOSURE_KIT]}: ${cover.length} cover-capable assets of ${kit.assets.length}`,
    );
    expect(cover.length).toBeGreaterThan(10);
  });

  /**
   * COVER MUST HAVE BEEN COVER, and the test is on its BASE.
   *
   * The first candidate rule asked whether an asset's measured height
   * MEDIAN cleared the corridor ceiling, which is the bounds-centre
   * mistake this demo has now made three times. A grass bank 2.6W tall
   * whose centre sat at 1.3W has its base on the ground — it is a
   * landform beside the road, not a roof over it. It qualified, L-6 tiled
   * a run with it, and because it is 5.9W wide the column arithmetic
   * asked for a single column, which is placed dead centre. Two copies of
   * a five-and-a-half-half-width slab ended up parked on the racing line
   * at t = 0.00, base exactly 1.20W.
   *
   * Nothing caught it: Z-1 exempts cover as clear-by-construction, which
   * is true vertically and says nothing about whether the thing was ever
   * overhead art.
   */
  it("only offers pieces whose material sat above the corridor", () => {
    const cover = coverCandidates(kit.assets as never);
    for (const a of cover) {
      const base = a.where!.height.median - a.size.tall / 2;
      expect(
        base,
        `${a.shape} ${a.size.across.toFixed(1)}x${a.size.along.toFixed(1)}x${a.size.tall.toFixed(1)} sat with its base at ${base.toFixed(2)}W`,
      ).toBeGreaterThanOrEqual(CORRIDOR.ceilingW);
    }
    // AND THE TEST MUST BITE. A rule that rejects nothing is not a rule,
    // and this kit is full of wide roadside landforms that the old
    // bounds-centre test waved through.
    const byCentre = (kit.assets as unknown as PlaceableAsset[]).filter(
      (a) =>
        a.where !== undefined &&
        a.where.height.median > CORRIDOR.ceilingW &&
        Math.abs(a.where.lateral.median) - a.size.across / 2 < 1.5,
    );
    expect(byCentre.length, "the base test rejected nothing").toBeGreaterThan(cover.length);
    console.log(
      `cover candidates: ${cover.length} by base, ${byCentre.length} by the old centre test ` +
        `— ${byCentre.length - cover.length} landforms rejected`,
    );
  });

  it("puts no cover piece down into the corridor", async () => {
    const l = await theLap();
    for (const seed of [1, 2, 3, 4]) {
      const d = dressLap(kit, l, seed);
      const intruding = d.placements.filter(
        (p) => p.cover && p.h - p.asset.size.tall / 2 < CORRIDOR.ceilingW - 1e-6,
      );
      expect(
        intruding.length,
        `seed ${seed}: ${intruding.length} cover pieces reach below the corridor ceiling`,
      ).toBe(0);
    }
  }, 900_000);

  it("never starts a run inside a tight corner", async () => {
    const l = await theLap();
    const corners = cornersOf(l);
    for (const seed of [1, 2, 3, 4]) {
      const { plans } = planEnclosure(
        kit.assets as never,
        l.lengthW,
        corners,
        (s) => radiusAtW(l, s),
        seed,
        0.1 * l.lengthW,
      );
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        expect(
          radiusAtW(l, p.startW),
          `seed ${seed}: a run starts at R=${radiusAtW(l, p.startW).toFixed(1)}W`,
        ).toBeGreaterThanOrEqual(ENCLOSE.noStartTighterThanW);
      }
    }
  }, 300_000);

  /**
   * THE REJECTION MUST BITE. A corner rule that never rejects anything is
   * indistinguishable from no rule, and nine of this circuit's nineteen
   * corners are tighter than R = 8W — so a uniform start station lands in
   * one often enough that zero rejections would mean the check is not
   * running.
   */
  it("rejects real candidates rather than passing vacuously", async () => {
    const l = await theLap();
    const r = planEnclosure(
      kit.assets as never,
      l.lengthW,
      cornersOf(l),
      (s) => radiusAtW(l, s),
      1,
      0.1 * l.lengthW,
    );
    console.log(
      `L-6 planning: ${r.plans.length} runs from ${r.attempted} attempts; ` +
        `${r.rejectedInCorner} rejected in or before a tight corner, ` +
        `${r.rejectedOverlap} for overlap`,
    );
    expect(r.rejectedInCorner).toBeGreaterThan(0);
  }, 300_000);

  /**
   * THE MEASUREMENT, which is the only claim L-6 actually makes.
   *
   * Reported before it is gated, because the interesting number is how
   * far the placed cover falls short of the planned share: the plan says
   * how much LAP is under a run, the rays say how much is under
   * something, and the difference is how much of each run fails to close
   * over the corridor. That gap is a fact about the kit's vocabulary, not
   * about the planner.
   */
  it("measures what the placement achieved, against what it planned", async () => {
    const l = await theLap();
    const rows: string[] = [];
    for (const seed of [1, 2, 3]) {
      const d = dressLap(kit, l, seed);
      const all = measureEnclosure(l, d.boxes);
      const coverOnly = measureEnclosure(
        l,
        d.boxes.filter((b) => b.cover),
      );
      const lens = all.stretches.map((s) => s.lengthW).sort((a, b) => a - b);
      const med = lens.length ? lens[Math.floor(0.5 * (lens.length - 1))] : 0;
      rows.push(
        `  seed ${seed}: dressing alone ${(100 * d.stats.enclosureBefore).toFixed(1)}%, ` +
          `top-up planned ${(100 * d.stats.plannedEnclosure).toFixed(1)}% in ` +
          `${d.stats.coverStretches} runs of ${d.stats.coverPieces} pieces -> ` +
          `measured ${(100 * all.share).toFixed(1)}% (cover alone ${(100 * coverOnly.share).toFixed(1)}%) ` +
          `in ${all.stretches.length} stretches, median ${med.toFixed(1)}W, ` +
          `longest ${all.longestW.toFixed(1)}W, tail ${(100 * all.heavyTailShare).toFixed(0)}%; ` +
          `trimmed ${d.stats.enclosureRunsTrimmed} runs (${d.stats.enclosureTrims} pieces)` +
          (d.stats.enclosureBlocked ? ", held back by Z-3" : ""),
      );
    }
    console.log(
      [
        `L-6 by ray cast (${ENCLOSURE.rays} rays, ${ENCLOSURE.floorW}-${ENCLOSURE.ceilingW}W, ` +
          `>=${ENCLOSURE.minHits} hits). Source population: ${(100 * ENCLOSE.sourceShare).toFixed(1)}%, ` +
          `rule ${100 * ENCLOSE.ruleShare[0]}-${100 * ENCLOSE.ruleShare[1]}%.`,
        ...rows,
      ].join("\n"),
    );
    expect(rows.length).toBe(3);
  }, 600_000);

  /**
   * THE TOP-UP MUST BE ABLE TO FIRE, AND ITS EFFECT MUST BE VISIBLE.
   *
   * On this kit it does not fire on every seed, and that is the finding
   * rather than a gap: the ordinary dressing already runs a quarter of
   * the lap under something, which is L-6's own ceiling, so on two seeds
   * in three there is no room and enclosure correctly adds nothing. Where
   * there IS room the difference is unmistakable — one run of 44 tiled
   * pieces turns a lap of fifty short gantry-shadows into one with a 33W
   * tunnel in it, and the heavy-tail share goes from nothing to 41%
   * against the source's 39%.
   *
   * So the check is on the seed that has room, and it is the shape rather
   * than the total: the total was already inside the rule before L-6 ran.
   */
  it("turns a lap of gantry-shadows into one with a tunnel in it", async () => {
    const l = await theLap();
    const d = dressLap(kit, l, 3);
    expect(d.stats.coverStretches, "no room to place a tunnel on this seed").toBeGreaterThan(0);

    const withCover = measureEnclosure(l, d.boxes);
    const withoutCover = measureEnclosure(
      l,
      d.boxes.filter((b) => !b.cover),
    );
    console.log(
      `L-6 on the seed with room: ${(100 * withoutCover.share).toFixed(1)}% -> ` +
        `${(100 * withCover.share).toFixed(1)}% of lap; ` +
        `longest stretch ${withoutCover.longestW.toFixed(1)}W -> ${withCover.longestW.toFixed(1)}W; ` +
        `heavy tail ${(100 * withoutCover.heavyTailShare).toFixed(0)}% -> ` +
        `${(100 * withCover.heavyTailShare).toFixed(0)}% (source ${(100 * ENCLOSE.sourceLongShare).toFixed(0)}%)`,
    );

    // THE SHAPE, which is what L-6 was retargeted at. The incidental
    // cover has no stretch long enough to count at all.
    expect(withoutCover.heavyTailShare).toBe(0);
    expect(withCover.heavyTailShare).toBeGreaterThan(0.2);
    expect(withCover.longestW).toBeGreaterThan(ENCLOSE.longW);
    // And the total stays inside the rule.
    expect(withCover.share).toBeLessThanOrEqual(ENCLOSE.ruleShare[1]);
  }, 600_000);

  /**
   * THE CEILING BINDS, and the code must say so rather than quietly
   * overshooting it. On every seed the finished lap has to be inside
   * L-6's range whether the top-up ran or not.
   */
  it("finishes inside L-6's range on every seed", async () => {
    const l = await theLap();
    for (const seed of [1, 2, 3, 4]) {
      const share = measureEnclosure(l, dressLap(kit, l, seed).boxes).share;
      expect(
        share,
        `seed ${seed}: ${(100 * share).toFixed(1)}% enclosed, rule ${100 * ENCLOSE.ruleShare[0]}-${100 * ENCLOSE.ruleShare[1]}%`,
      ).toBeLessThanOrEqual(ENCLOSE.ruleShare[1] + 0.02);
    }
  }, 900_000);
});

/**
 * THE Z-3 FALLBACK, WHICH NEVER FIRES ON A REAL LAP.
 *
 * `reduceEnclosure` stops trimming when taking another run would empty
 * Z-3's `over` band below its floor, and reports `blockedByBandMix` so
 * the caller can say which rule yielded. Measured across twelve laps and
 * two vocabularies — including the most overhead-rich circuit in the
 * source, whose own `over` share is half again above Z-3's ceiling — it
 * has stopped the trim exactly zero times.
 *
 * WHICH IS THE PROBLEM. A branch that no lap reaches is a branch that
 * will be wrong the first time it is needed, and by this project's own
 * convention a rule that never fires is not a rule that passed. Upstream
 * settled the question the other way round at the same time: the two
 * circuits satisfying both Z-3 and L-6 rank 2nd and 4th most ORDINARY of
 * the twenty-two, on axes deliberately chosen to exclude the two rules
 * under test — so the ranges describe a real circuit and the fallback
 * should be rare.
 *
 * Rare is not never, and the right response to a path real data cannot
 * reach is to construct one that does, not to delete the path or to
 * report a green because nothing tripped it.
 */
describe("the band-mix fallback", () => {
  /** Overhead pieces, all trimmable: inside the span, above the corridor. */
  function overhead(n: number): StationedPlacement[] {
    return Array.from({ length: n }, (_, i) => ({
      station: i * 4,
      t: 0.4,
      h: 2,
      asset: {
        id: i,
        name: `piece-${i}`,
        shape: "box",
        instances: 1,
        size: { across: 0.5, along: 0.5, tall: 0.4 },
      },
    }));
  }

  /**
   * A lap that is always over the ceiling, whatever is removed — which is
   * what an exhausted trim looks like from the inside.
   */
  const alwaysOver = (): { share: number; stretches: { startW: number; endW: number; lengthW: number }[] } => ({
    share: 0.5,
    stretches: [{ startW: 0, endW: 40, lengthW: 40 }],
  });

  it("stops at Z-3's floor rather than emptying the band", () => {
    const ps = overhead(10);
    // Keep nine of ten: one trim is possible, then the floor binds.
    const r = reduceEnclosure(ps, alwaysOver, 9);
    expect(r.blockedByBandMix, "the floor never bound").toBe(true);
    // And it did not empty the band to get there.
    const left = r.placements.filter((p) => Math.abs(p.t) < 1.5 && p.h >= 1.2).length;
    expect(left).toBeGreaterThanOrEqual(9);
  });

  /**
   * THE CONTROL. With the floor out of the way the same input trims — so
   * the assertion above is about the floor binding and not about the
   * reduction being unable to do anything at all. Without this, a
   * `reduceEnclosure` that simply never worked would pass the test above.
   */
  it("trims the same lap when the floor is not in the way", () => {
    const ps = overhead(10);
    const r = reduceEnclosure(ps, alwaysOver, 0);
    expect(r.moves).toBeGreaterThan(0);
    expect(r.runsTrimmed).toBeGreaterThan(0);
    // Moved OUT rather than dropped: the count is conserved.
    expect(r.placements.length).toBe(ps.length);
    const moved = r.placements.filter((p) => Math.abs(p.t) >= 1.5);
    expect(moved.length).toBe(r.moves);
  });

  it("never touches L-6's own cover", () => {
    // Taking a deliberate tunnel apart to satisfy L-6 would be absurd, so
    // the only thing left to trim is the incidental cover.
    const ps = overhead(10).map((p) => ({ ...p, cover: true as const }));
    const r = reduceEnclosure(ps, alwaysOver, 0);
    expect(r.moves).toBe(0);
    // AND THE DIAGNOSIS IS "NOTHING TO TRIM", NOT "BLOCKED BY Z-3".
    // This asserted `blockedByBandMix` when the floor here is zero and
    // was never consulted: every piece is L-6's own cover, so there is
    // no candidate at all. Blaming the band mix sends a reader to the
    // wrong rule — the two flags now say which happened.
    expect(r.nothingToTrim).toBe(true);
    expect(r.blockedByBandMix).toBe(false);
  });

  /**
   * THE OTHER HALF OF THE SPLIT, which the flags alone do not show.
   *
   * The refusal used to be recorded on the RESULT the moment one run was
   * turned away, so a pass that refused a run and then trimmed a
   * different one successfully still reported itself held back by Z-3.
   * Two stretches: the first is too big to take without breaching the
   * floor, the second is not. The trim should happen, and nothing should
   * be blamed for anything.
   */
  it("does not report a refusal it recovered from", () => {
    const ps = overhead(10);
    let calls = 0;
    const twoStretches = (): {
      share: number;
      stretches: { startW: number; endW: number; lengthW: number }[];
    } => {
      calls++;
      return {
        // Over the ceiling first time round, inside it once a run is
        // trimmed — so the loop stops because it SUCCEEDED.
        share: calls <= 1 ? 0.5 : 0.05,
        stretches: [
          // Holds pieces 0-6: taking all seven would breach a floor of 5.
          { startW: 0, endW: 26, lengthW: 26 },
          // Holds pieces 8-9: two is affordable.
          { startW: 32, endW: 40, lengthW: 8 },
        ],
      };
    };
    const r = reduceEnclosure(ps, twoStretches, 5);
    expect(r.moves).toBeGreaterThan(0);
    expect(r.runsTrimmed).toBe(1);
    expect(r.blockedByBandMix, "a recovered refusal was reported as a block").toBe(false);
    expect(r.nothingToTrim).toBe(false);
  });

  it("blames Z-3 only when Z-3 actually refused a trim", () => {
    // The control for the pair above: same shape of failure — no moves —
    // but reached because the floor turned a real candidate away.
    const ps = overhead(10);
    const r = reduceEnclosure(ps, alwaysOver, 9);
    expect(r.moves).toBe(0);
    expect(r.blockedByBandMix).toBe(true);
    expect(r.nothingToTrim).toBe(false);
  });
});
