/**
 * The assembled pipeline.
 *
 * WHY THIS FILE EXISTS. Every rule in this demo had a test of its own and
 * the thing that runs them had none. That is how the sightline cull came
 * to run BEFORE the legibility rules and stay there: each stage was
 * correct in isolation, the ORDER was wrong, and no test looked at the
 * order. It is also how stage 7 came to be documented in the pipeline's
 * own comment for weeks without existing in its code — a lap could finish
 * with a 42W hole in it while the stat line read zero repairs.
 *
 * So the gates here are on the FINISHED lap, and they are the rules
 * themselves rather than proxies for them: after everything has run, does
 * D-4 hold, does the cone stay clear, is every tenth of the lap
 * navigable, is the band mix inside Z-3. A stage that is correct but
 * mis-sequenced fails here and nowhere else.
 *
 * WHAT IS ASSERTED AND WHAT IS ONLY REPORTED. §9 gives L-1 the last word:
 * it runs after the legibility pass and may move or drop a marker that
 * L-2 placed correctly. So L-2 and L-3 are REPORTED after the cull, not
 * asserted — asserting them would be asserting that two rules the source
 * document deliberately ordered never conflict, which is not something
 * this pipeline promises or should.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { mixInsideRule } from "../demos/road/assets.js";
import { dressLap, frameLookup } from "../demos/road/dress.js";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import type { Kit } from "../demos/road/kit.js";
import { DEFAULT_KIT, KITS } from "../demos/road/kitSource.js";
import { type Lap, readLap } from "../demos/road/lap.js";
import {
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  landmarksPerStretch,
  landmarksSatisfied,
} from "../demos/road/legibility.js";
import { defaultEyeStations, occludes } from "../demos/road/sightline.js";
import { makeTrackSpline } from "../demos/road/spline.js";
import { COVERAGE, coverage } from "../demos/road/stations.js";

const KIT = `<kit-dir>/${KITS[DEFAULT_KIT]}`;

describe.skipIf(!existsSync(KIT))("the assembled pipeline", () => {
  const kit = JSON.parse(readFileSync(KIT, "utf8")) as Kit;

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

  const SEEDS = [1, 2, 3, 4];

  it("holds D-4 on the lap the cull left behind", async () => {
    const l = await theLap();
    for (const seed of SEEDS) {
      const d = dressLap(kit, l, seed);
      const stations = d.placements.map((p) => p.station).sort((a, b) => a - b);
      const c = coverage(stations, l.lengthW);
      expect(
        c.longestGapW,
        `seed ${seed}: longest gap ${c.longestGapW.toFixed(1)}W, limit ${COVERAGE.maxGapW}`,
      ).toBeLessThanOrEqual(COVERAGE.maxGapW + 1e-6);
      // The stat the page shows must agree with the lap it describes.
      expect(d.stats.worstGapW).toBeCloseTo(c.longestGapW, 6);
    }
  }, 300_000);

  it("leaves the look-ahead cone clear", async () => {
    const l = await theLap();
    const frameAt = frameLookup(l);
    const eyes = defaultEyeStations(l.lengthW);
    for (const seed of [1, 2]) {
      const d = dressLap(kit, l, seed);
      // EVERY placement, including the ones L-2, L-4 and D-4 put there
      // after the general pass. Checking only what the cull saw would
      // pass the exact bug this file was written for.
      const offenders = d.placements.filter((p) =>
        eyes.some((s) =>
          occludes(
            {
              station: p.station,
              t: p.t,
              h: p.h,
              across: p.asset.size.across,
              along: p.asset.size.along,
              tall: p.asset.size.tall,
            },
            s,
            frameAt,
            l.halfWidth,
          ),
        ),
      );
      expect(
        offenders.length,
        `seed ${seed}: ${offenders.length} placements block the cone after everything ran`,
      ).toBe(0);
    }
  }, 600_000);

  it("keeps every tenth of the lap navigable", async () => {
    const l = await theLap();
    for (const seed of SEEDS) {
      const d = dressLap(kit, l, seed);
      expect(
        landmarksSatisfied(d.placements, l.lengthW),
        `seed ${seed}: per tenth ${landmarksPerStretch(d.placements, l.lengthW).join(",")}`,
      ).toBe(true);
    }
  }, 300_000);

  it("finishes inside Z-3's band mix", async () => {
    const l = await theLap();
    for (const seed of SEEDS) {
      const d = dressLap(kit, l, seed);
      expect(mixInsideRule(d.placements), `seed ${seed}`).toBe(true);
    }
  }, 300_000);

  /**
   * DETERMINISM, which is the library's one hard invariant and which this
   * demo can break in a way the library cannot: the pipeline has eight
   * stages, several of which sort, filter and splice, and any one of them
   * reading an unstable order would produce a different lap from the same
   * seed. Compared on the BOXES rather than the placements, because the
   * boxes are what a viewer sees and what a capture would diff.
   */
  it("gives the same lap for the same seed, and a different one otherwise", async () => {
    const l = await theLap();
    const a = dressLap(kit, l, 1);
    const b = dressLap(kit, l, 1);
    expect(a.boxes.length).toBe(b.boxes.length);
    expect(JSON.stringify(a.boxes)).toBe(JSON.stringify(b.boxes));

    // The negative control: a comparison that cannot tell two laps apart
    // would pass the line above no matter what the pipeline did.
    const c = dressLap(kit, l, 2);
    expect(JSON.stringify(a.boxes)).not.toBe(JSON.stringify(c.boxes));
  }, 300_000);

  /**
   * WHAT L-1 TAKES FROM §7, reported rather than asserted.
   *
   * The cull runs last and wins, so a marker can be placed correctly and
   * still be moved off the outside or dropped. That is §9's resolution of
   * the conflict, not a defect — but the size of it is a number somebody
   * needs, and a silent conflict is how a rule quietly stops holding.
   */
  it("reports every stage, and what the cull took from the corner language", async () => {
    const l = await theLap();
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const d = dressLap(kit, l, seed);
      const s = d.stats;
      const marks = d.markers
        ? cornerMarkersSatisfied(d.placements, d.corners, d.markers, l.lengthW)
        : { missing: [] };
      const rulers = d.markers
        ? brakingRulersSatisfied(d.placements, d.corners, d.markers, l.lengthW)
        : { failures: [] };
      rows.push(
        `  seed ${seed}: ${s.placed} placements in ${s.cookMs.toFixed(0)}ms | ` +
          `corners ${s.corners}/${s.tightCorners} tight | ` +
          `L-2 ${s.markersConverted}c+${s.markersAdded}a | L-3 ${s.brakeMarks}-${s.brakeDisplaced} | ` +
          `corridor ${s.corridorFixes} | cull ${s.blocked} (${s.pushedOut} out, ${s.dropped} cut) | ` +
          `D-4 ${s.stationGapRepairs}+${s.coverageMoves} (worst ${s.worstGapW.toFixed(1)}W) | ` +
          `L-4 ${s.landmarkFixes} | Z-3 ${s.mixMoves} | ` +
          `${s.rounds} round${s.rounds === 1 ? "" : "s"}${s.converged ? "" : " (NOT CONVERGED)"} || ` +
          `after everything: ${marks.missing.length} corners unmarked, ` +
          `${rulers.failures.length} rulers broken`,
      );
    }
    console.log(["the assembled pipeline, §9's order:", ...rows].join("\n"));
    expect(rows.length).toBe(SEEDS.length);
  }, 300_000);

  /**
   * THE PIPELINE MUST FIRE. Eight stages that all report zero is what a
   * pipeline looks like when it is not wired in, and this demo has
   * already shipped one stage that was documented and absent and another
   * that was green and unreachable.
   */
  it("runs every stage rather than passing vacuously", async () => {
    const l = await theLap();
    const s = dressLap(kit, l, 1).stats;
    expect(s.placed).toBeGreaterThan(100);
    expect(s.corners).toBeGreaterThan(0);
    expect(s.markersConverted + s.markersAdded).toBe(s.corners);
    expect(s.brakeMarks).toBeGreaterThan(0);
    expect(s.corridorFixes).toBeGreaterThan(0);
    expect(s.blocked).toBeGreaterThan(0);
    expect(s.mixMoves).toBeGreaterThan(0);
    // And the tail must have SETTLED. A lap that ran out of rounds is
    // still breaking a threshold somewhere, and every number above would
    // look exactly the same.
    expect(s.converged, `tail did not settle in ${s.rounds} rounds`).toBe(true);
  }, 300_000);
});
