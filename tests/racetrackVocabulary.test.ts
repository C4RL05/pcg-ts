/**
 * The vocabulary the demo PUBLISHES with.
 *
 * WHY THIS IS THE MOST IMPORTANT SUITE IN THE DEMO. Every other road test
 * loads a local catalogue from outside the repository and skips when it is
 * absent — which is almost everywhere, including CI. So the entire rule
 * set could be green on this machine and silently do nothing on the live
 * page, and for a while it did exactly that: the published build drew
 * placeholder boxes and reported "rules idle" while six rules sat behind
 * it.
 *
 * These tests need no kit. They run wherever the repository runs, and
 * they check the thing a visitor actually sees.
 *
 * THE GATE IS THAT EVERY RULE FIRES, not merely that it passes. A rule
 * with no vocabulary to act on reports zero and passes every threshold —
 * the vacuous green this demo has already been caught by twice. So each
 * assertion below is that a repair COUNTED something, and the report
 * prints what each one did.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { mixInsideRule } from "../demos/racetrack/assets.js";
import { dressLap, frameLookup } from "../demos/racetrack/dress.js";
import { ENCLOSE } from "../demos/racetrack/tunnels.js";
import { measureEnclosure } from "../demos/racetrack/enclosure.js";
import { falseEdges } from "../demos/racetrack/falseEdges.js";
import { OUTPUTS, buildRoadGraph } from "../demos/racetrack/graph.js";
import { type Lap, readLap } from "../demos/racetrack/lap.js";
import {
  landmarksSatisfied,
  markerCandidates,
  reserveMarkers,
} from "../demos/racetrack/legibility.js";
import { defaultEyeStations, occludes } from "../demos/racetrack/sightline.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";
import { COVERAGE, coverage } from "../demos/racetrack/stations.js";
import { buildVocabulary, shippedVocabulary, syntheticKit } from "../demos/racetrack/vocabulary.js";

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

describe("the published vocabulary", () => {
  it("is deterministic, and changes with the seed", () => {
    expect(JSON.stringify(buildVocabulary(1))).toBe(JSON.stringify(buildVocabulary(1)));
    expect(JSON.stringify(buildVocabulary(1))).not.toBe(JSON.stringify(buildVocabulary(2)));
  });

  /**
   * EACH OF THESE EXISTS BECAUSE A RULE NEEDS IT. A catalogue that fails
   * any one of them leaves a rule green and unrun on the live page, which
   * is the failure this whole suite is here to prevent.
   */
  it("carries what each rule needs to act on", () => {
    const v = buildVocabulary(1);

    // L-2 and L-3 reserve three slender verticals, and want a real choice.
    const verticals = markerCandidates(v as never);
    expect(verticals.length, "L-2/L-3 have no marker vocabulary").toBeGreaterThanOrEqual(6);

    // L-6 tiles cover from pieces that sit above the corridor and reach
    // across it.
    const cover = v.filter(
      (a) => a.where.height.median > 1.2 && Math.abs(a.where.lateral.median) - a.size.across / 2 < 1.5,
    );
    expect(cover.length, "L-6 has nothing to build cover from").toBeGreaterThanOrEqual(8);

    // Z-1's corridor resolution is only reachable if some asset's own
    // lateral distribution reaches inside 1W. This is the rule that was
    // green and unreachable for a week.
    const reaching = v.filter((a) => a.where.lateral.p10 < 1);
    expect(reaching.length, "Z-1's corridor rule is unreachable").toBeGreaterThan(0);

    // L-4 draws landmarks from assets the lap has not used, which needs a
    // long tail of rare pieces rather than an evenly-used catalogue.
    const oneOffs = v.filter((a) => a.instances === 1);
    expect(oneOffs.length / v.length, "L-4 has no tail to draw landmarks from").toBeGreaterThan(0.3);

    // L-5 needs pieces that can sit in Z2-Z3 at edge height.
    const edgeable = v.filter(
      (a) => a.where.lateral.median >= 1 && a.where.lateral.median <= 2.5 && a.where.height.p10 < 0.6,
    );
    expect(edgeable.length, "L-5 cannot be triggered").toBeGreaterThan(0);

    console.log(
      `vocabulary: ${v.length} assets — ${verticals.length} slender verticals, ${cover.length} cover-capable, ` +
        `${reaching.length} reaching inside the corridor, ${oneOffs.length} one-offs, ${edgeable.length} edge-band`,
    );
  });

  it("gives the corner language three distinct assets to reserve", () => {
    const { markers, pool } = reserveMarkers(buildVocabulary(1) as never, 1);
    expect(markers).toBeDefined();
    expect(new Set([markers!.sharp.id, markers!.open.id, markers!.brake.id]).size).toBe(3);
    expect(pool.length).toBe(buildVocabulary(1).length - 3);
  });
});

/**
 * THE COMMITTED VOCABULARY, which is what a visitor actually dresses
 * from — and therefore the one that has to be gated hardest.
 *
 * The generated catalogue below it is a second, independent vocabulary
 * kept for a different claim: that the rules do not depend on ANY
 * particular catalogue. Both run without a kit, so CI sees both.
 */
describe("the committed vocabulary", () => {
  const kit = shippedVocabulary();

  it("carries dimensions and statistics, and no layout or identifiers", () => {
    const assets = kit.assets as unknown as {
      name: string;
      shape: string;
      instances: number;
      size: { across: number; along: number; tall: number };
      where: unknown;
    }[];
    expect(assets.length).toBeGreaterThan(150);

    // THE RECORDED INSTANCES SHIP, and they do two jobs: the reference
    // layer beside the generated dressing, and the pose library that
    // stops every copy of an object facing the same way.
    //
    // They are not a level. A layout only means anything paired with the
    // track it was authored on, and this demo generates its own spline —
    // a different length with corners in different places — so the
    // sequence lands on geometry it was never made for. What IS dropped
    // is the pair of fields that described that track rather than the
    // art: the curvature and bank of that centreline at each
    // station, which 362 samples of would have profiled its shape.
    expect(kit.placements.length).toBeGreaterThan(300);
    for (const pl of kit.placements as unknown as Record<string, unknown>[]) {
      expect(Object.keys(pl).sort()).toEqual(["asset", "boxes", "height", "lateral", "station"]);
    }

    // NO SOURCE IDENTIFIERS. Names are this project's own shape
    // classification, which is why they all match this shape.
    for (const a of assets) {
      expect(a.name, `"${a.name}" is not a generated name`).toMatch(
        /^(block|frame|panel|post|shell)-\d{2,}$/,
      );
    }

    // AND THE STRUCTURE THAT MAKES A PLACEMENT READ AS SCENERY. The
    // generated catalogue managed 1.7 boxes per placement and looked like
    // a row of crates; this is the figure that fixed it.
    const boxes = (kit.placements as unknown as { boxes: unknown[] }[]).reduce(
      (n, pl) => n + pl.boxes.length,
      0,
    );
    expect(boxes / kit.placements.length, "not enough internal structure").toBeGreaterThan(3);

    // POSES, NOT COPIES. If every instance of an asset carried the same
    // boxes there would be no yaw variety and the whole point of shipping
    // them would be lost.
    const sigs = new Set(
      (kit.placements as unknown as { boxes: unknown[] }[]).map((pl) => JSON.stringify(pl.boxes)),
    );
    expect(sigs.size / kit.placements.length, "instances are copies, not poses").toBeGreaterThan(0.9);
    console.log(
      `committed vocabulary: ${assets.length} assets, ${kit.placements.length} recorded poses, ` +
        `${boxes} boxes (${(boxes / kit.placements.length).toFixed(1)}/pose), ` +
        `${sigs.size} distinct`,
    );
  });

  it("dresses a lap that satisfies every rule", async () => {
    const l = await theLap();
    const d = dressLap(kit, l, 1);
    expect(d.stats.converged).toBe(true);
    expect(landmarksSatisfied(d.placements, l.lengthW), "L-4").toBe(true);
    expect(falseEdges(d.placements, l.lengthW).length, "L-5").toBe(0);
    expect(
      mixInsideRule(d.placements, "centre", (p) => p.cover === true),
      "Z-3",
    ).toBe(true);
    expect(measureEnclosure(l, d.boxes).share, "L-6").toBeLessThanOrEqual(
      ENCLOSE.ruleShare[1] + 0.02,
    );
    expect(
      coverage(
        d.placements.map((p) => p.station).sort((a, b) => a - b),
        l.lengthW,
      ).longestGapW,
      "D-4",
    ).toBeLessThanOrEqual(COVERAGE.maxGapW + 1e-6);
    console.log(
      `committed vocabulary dresses: ${d.stats.placed} placements, ${d.boxes.length} boxes ` +
        `(${(d.boxes.length / d.stats.placed).toFixed(1)}/placement), ${d.stats.rounds} rounds`,
    );
  }, 900_000);
});

describe("a lap dressed from the published vocabulary", () => {
  const SEEDS = [1, 2, 3];

  it("satisfies every rule the local catalogue is gated on", async () => {
    const l = await theLap();
    const frameAt = frameLookup(l);
    const eyes = defaultEyeStations(l.lengthW);
    for (const seed of SEEDS) {
      const d = dressLap(syntheticKit(l.lengthW, 1000, seed), l, seed);

      // D-4.
      const c = coverage(
        d.placements.map((p) => p.station).sort((a, b) => a - b),
        l.lengthW,
      );
      expect(c.longestGapW, `seed ${seed}: D-4`).toBeLessThanOrEqual(COVERAGE.maxGapW + 1e-6);

      // L-1.
      const blocked = d.placements.filter((p) =>
        eyes.some((st) =>
          occludes(
            {
              station: p.station,
              t: p.t,
              h: p.h,
              across: p.asset.size.across,
              along: p.asset.size.along,
              tall: p.asset.size.tall,
            },
            st,
            frameAt,
            l.halfWidth,
          ),
        ),
      );
      expect(blocked.length, `seed ${seed}: L-1`).toBe(0);

      // L-4, L-5, Z-3 and the settling of the whole tail.
      expect(landmarksSatisfied(d.placements, l.lengthW), `seed ${seed}: L-4`).toBe(true);
      expect(falseEdges(d.placements, l.lengthW).length, `seed ${seed}: L-5`).toBe(0);
      expect(
        mixInsideRule(d.placements, "centre", (p) => p.cover === true),
        `seed ${seed}: Z-3`,
      ).toBe(true);
      expect(d.stats.converged, `seed ${seed}: tail did not settle`).toBe(true);

      // L-6.
      const share = measureEnclosure(l, d.boxes).share;
      expect(share, `seed ${seed}: L-6 at ${(100 * share).toFixed(1)}%`).toBeLessThanOrEqual(
        ENCLOSE.ruleShare[1] + 0.02,
      );
    }
  }, 900_000);

  /**
   * THE DENSITY KNOB, which is the one rule parameter the page exposes.
   *
   * D-1 is a distribution with a threshold hidden in its floor: 0.6 to
   * 1.2 placements per W is the accepted band, and "under 0.6" means
   * unfinished rather than sparse. So the knob has to do three things and
   * each is checked here — scale the count, report where the lap actually
   * landed in D-1's own units, and still produce a lap the other rules
   * hold on, because every one of them is a share or a threshold over the
   * population rather than an absolute.
   */
  it("scales the lap with density, and says where D-1 puts it", async () => {
    const l = await theLap();
    const kit = syntheticKit(l.lengthW, 1000, 1);
    const rows: string[] = [];
    let last = 0;
    for (const density of [0.5, 1, 2]) {
      const d = dressLap(kit, l, 1, { density });
      // MONOTONIC. A knob that does not move the thing it names is worse
      // than no knob, because the panel then reports a number the slider
      // cannot change.
      expect(d.stats.placed, `density ${density} did not raise the count`).toBeGreaterThan(last);
      last = d.stats.placed;
      // The reported figure must describe the lap it came from.
      expect(d.stats.perW).toBeCloseTo(d.stats.placed / l.lengthW, 6);
      // And the rest of the rules still hold at every setting.
      expect(landmarksSatisfied(d.placements, l.lengthW), `L-4 at density ${density}`).toBe(true);
      expect(falseEdges(d.placements, l.lengthW).length, `L-5 at density ${density}`).toBe(0);
      expect(d.stats.converged, `tail did not settle at density ${density}`).toBe(true);
      rows.push(
        `  x${density.toFixed(2)}: ${d.stats.placed} placements, ${d.stats.perW.toFixed(2)}/W ` +
          `(D-1 accepts 0.6-1.2), ${d.stats.rounds} rounds`,
      );
    }
    console.log(["the density knob:", ...rows].join("\n"));

    // THE BAND IS REACHABLE FROM BOTH SIDES, or the readout that names it
    // is decoration: the slider must be able to leave D-1 in either
    // direction, which is the whole reason the panel states a verdict
    // rather than only a number.
    expect(dressLap(kit, l, 1, { density: 0.4 }).stats.perW).toBeLessThan(0.6);
    expect(dressLap(kit, l, 1, { density: 3 }).stats.perW).toBeGreaterThan(1.2);
  }, 900_000);

  /**
   * AND EVERY RULE MUST HAVE HAD SOMETHING TO DO.
   *
   * This is the assertion that would have caught the published build
   * drawing placeholders: not that the rules pass, but that they ran. A
   * lap where every repair reports zero is a lap no rule touched, and it
   * satisfies every threshold above.
   */
  it("runs every rule rather than passing vacuously", async () => {
    const l = await theLap();
    const rows: string[] = [];
    let sawCover = false;
    let sawEdge = false;
    for (const seed of SEEDS) {
      const s = dressLap(syntheticKit(l.lengthW, 1000, seed), l, seed).stats;
      expect(s.placed, `seed ${seed}: nothing placed`).toBeGreaterThan(100);
      expect(s.corners, `seed ${seed}: no corner model`).toBeGreaterThan(0);
      expect(s.markersConverted + s.markersAdded, `seed ${seed}: L-2 idle`).toBe(s.corners);
      expect(s.brakeMarks, `seed ${seed}: L-3 idle`).toBeGreaterThan(0);
      expect(s.corridorFixes, `seed ${seed}: Z-1 idle`).toBeGreaterThan(0);
      expect(s.blocked, `seed ${seed}: L-1 idle`).toBeGreaterThan(0);
      expect(s.mixMoves, `seed ${seed}: Z-3 idle`).toBeGreaterThan(0);
      if (s.coverPieces > 0 || s.enclosureTrims > 0) sawCover = true;
      if (s.falseEdges > 0) sawEdge = true;
      rows.push(
        `  seed ${seed}: ${s.placed} placements, ${s.rounds} rounds, ${s.cookMs.toFixed(0)}ms | ` +
          `L-2 ${s.markersConverted}+${s.markersAdded} over ${s.corners} corners | L-3 ${s.brakeMarks} | ` +
          `Z-1 ${s.corridorFixes} | L-1 ${s.blocked} | D-4 ${s.stationGapRepairs}+${s.coverageMoves} | ` +
          `L-4 ${s.landmarkFixes} | L-5 ${s.falseEdges} | ` +
          `L-6 ${(100 * s.enclosureBefore).toFixed(1)}%->${(100 * s.enclosureAfter).toFixed(1)}% ` +
          `(+${s.coverPieces} pieces, -${s.enclosureTrims}) | Z-3 ${s.mixMoves}`,
      );
    }
    console.log(["what the published demo actually runs:", ...rows].join("\n"));
    // L-5 and L-6 are conditional on the lap, so they are gated across
    // the seeds rather than on each: a rule that never fires on ANY of
    // them is a rule the live page does not demonstrate.
    expect(sawCover, "L-6 never placed or trimmed anything on any seed").toBe(true);
    expect(sawEdge, "L-5 never found a false edge on any seed").toBe(true);
  }, 900_000);
});
