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
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { mixInsideRule } from "../demos/racetrack/assets.js";
import { dressLap, frameLookup } from "../demos/racetrack/dress.js";
import { OUTPUTS, buildRoadGraph } from "../demos/racetrack/graph.js";
import { type Kit, type PlacedBox, placeKit } from "../demos/racetrack/kit.js";
import { DEFAULT_KIT, ENCLOSURE_KIT, kitOrAbsent, kitPath } from "./support/kits.js";
import { type Lap, readLap } from "../demos/racetrack/lap.js";
import {
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  landmarksPerStretch,
  landmarksSatisfied,
} from "../demos/racetrack/legibility.js";
import { defaultEyeStations, occludes } from "../demos/racetrack/sightline.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";
import { COVERAGE, coverage } from "../demos/racetrack/stations.js";

const KIT_KEY = DEFAULT_KIT;
const KIT = kitPath(KIT_KEY);

describe.skipIf(!KIT)("the assembled pipeline", () => {
  const kit = kitOrAbsent<Kit>(KIT_KEY);

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
      // The same exclusion the repair uses. Scoring a different
      // population from the one that was balanced is a gate that fails on
      // correct output, which is worse than one that passes on wrong.
      expect(mixInsideRule(d.placements, "centre", (p) => p.cover === true), `seed ${seed}`).toBe(
        true,
      );
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

const ENCLOSED = kitPath(ENCLOSURE_KIT);

/**
 * THE WHOLE LOOP, ON THE KIT THAT CAN STOP IT TURNING.
 *
 * `runs every stage rather than passing vacuously` already asserts that
 * the tail settles — on the vegetation circuit, which settles in two or
 * three rounds and settled in two or three rounds throughout the entire
 * life of a bug that made the enclosed circuit run all twelve and finish
 * `converged: false` on every seed. The stat line said so, in the demo's
 * own reporting, and nothing failed.
 *
 * WHY THIS KIT AND NOT THAT ONE, stated once here because it is the
 * general form of the mistake rather than a fact about tunnels: the mix
 * repair re-draws a placement from an asset whose measured laterals reach
 * into the band being filled, and whether that draw LANDS in the band is a
 * property of how wide the kit's distributions are. The vegetation kit's
 * are narrow, so the repair worked there under a rule that could not work
 * anywhere else, and the suite that gated it was measuring the exemplar.
 * The enclosed kit is 43% covered against a population median of 10.5%,
 * its overhead pieces put a third of the raw lap in `over` against a
 * ceiling of 21%, and its laterals are wide enough that a draw misses its
 * own band more often than it hits — so the repair has to actually work.
 *
 * WHAT IS ASSERTED IS CONVERGENCE, not a round count. The number of rounds
 * is reported because somebody needs it and because a regression that
 * doubles it while still settling is worth seeing, but a threshold on it
 * would be a number fitted to this kit, this spline and this machine.
 * `converged` is the property: the loop reached a fixed point rather than
 * running out of rounds with repairs still outstanding.
 */
describe.skipIf(!ENCLOSED)("the assembled pipeline, on the enclosed circuit", () => {
  const kit = kitOrAbsent<Kit>(ENCLOSURE_KIT);

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

  it(
    "reaches a fixed point on the circuit whose band mix is overhead-heavy",
    async () => {
      const l = await theLap();
      // Every seed is dressed and REPORTED before anything is asserted. A
      // failure here is a claim about the loop's behaviour across seeds,
      // and one that prints only the first bad seed's numbers is a bug
      // report with its evidence deleted.
      const runs = SEEDS.map((seed) => ({ seed, s: dressLap(kit, l, seed).stats }));
      console.log(
        [
          `the tail on ${ENCLOSURE_KIT}:`,
          ...runs.map(
            ({ seed, s }) =>
              `  seed ${seed}: ${s.rounds} round${s.rounds === 1 ? "" : "s"}` +
              `${s.converged ? "" : " (NOT CONVERGED)"} | ` +
              `Z-3 ${s.mixMoves} moves over ${s.placed} placements | ` +
              `L-6 +${s.coverStretches} runs (${s.coverPieces} pieces), -${s.enclosureTrims} trimmed, ` +
              `${(100 * s.enclosureBefore).toFixed(0)}%->${(100 * s.enclosureAfter).toFixed(0)}% covered`,
          ),
        ].join("\n"),
      );

      // THE CLAIM FIRST, THE GUARDS AFTER IT — an ordering that was
      // chosen from what happened when this test was run against the
      // broken repair. A loop that never settles produces a DIFFERENT
      // LAP, not merely an unsettled one: with the spin in place seed 1
      // finished with no cover placed and none trimmed, so a vacuity
      // guard standing in front of the convergence check reported "L-6
      // neither placed nor trimmed cover" and the twelve unconverged
      // rounds — the actual defect, printed two lines above — never
      // reached an assertion at all. The first failure a reader sees
      // should name the thing the test is for.
      for (const { seed, s } of runs) {
        expect(
          s.converged,
          `seed ${seed}: tail did not settle in ${s.rounds} rounds ` +
            `(Z-3 made ${s.mixMoves} moves over ${s.placed} placements)`,
        ).toBe(true);
      }

      for (const { seed, s } of runs) {
        // THE PAIRED HALF, and it is not decoration. A loop that settles
        // because its mix repair never attempts anything settles just as
        // convincingly as one that settles because the mix is right —
        // and a fix for a repair that spun is exactly the kind of change
        // that could produce it. So the settling claim is only made
        // alongside the claim that the mix had work and did it.
        expect(s.mixMoves, `seed ${seed}: Z-3 never moved anything`).toBeGreaterThan(0);
        // AND THAT THIS IS GENUINELY THE ENCLOSED CASE. If L-6 did
        // nothing at all, this is the vegetation test again with a
        // different file behind it — the vegetation circuit is 2%
        // covered and its longest covered stretch is nine tenths of a
        // half-width, so L-6 is inert there.
        //
        // EITHER DIRECTION COUNTS, and asserting on runs PLACED was
        // wrong: L-6 tops a lap up to its share and also trims a lap
        // that is over it, and on this kit the ordinary dressing already
        // arrives enclosed. Seed 2 came in at 28% — past the rule's own
        // 25% ceiling before L-6 saw it — so L-6 correctly placed no
        // cover and trimmed instead. A gate that demands a top-up is
        // asserting the kit is under-enclosed, which this one is not.
        expect(
          s.coverStretches + s.enclosureTrims,
          `seed ${seed}: L-6 neither placed nor trimmed cover, at ` +
            `${(100 * s.enclosureBefore).toFixed(0)}% covered before it ran`,
        ).toBeGreaterThan(0);
      }
    },
    // Stated rather than left to the default, and derived from the
    // neighbours rather than from a stopwatch. One graph cook and four
    // full dressings, each running the seven-stage repair loop up to its
    // twelve-round cap — the same shape of work the gate above allows
    // 300s for, plus L-6, which only runs on this kit and tiles or trims
    // cover on every round. Measured here at 1.5s against that gate's
    // 0.5s, so the same ratio of headroom is twice the same allowance.
    // The margin is deliberately absurd: what this test measures is
    // whether the loop reaches a fixed point, and a slow machine must
    // fail it for that reason or not at all.
    600_000,
  );
});

/**
 * THE SILHOUETTE, which is the only gate here a viewer could have
 * written.
 *
 * Every other check in this file asks whether a rule holds. This one asks
 * whether the result LOOKS like its source — and it exists because a lap
 * passed every rule while being visibly wrong, and nothing caught it
 * except opening the page and looking down the road from the driver's
 * seat.
 *
 * WHAT WENT WRONG, because the shape of the bug is the shape of the test.
 * Z-3's `over` band is |t| < 1W, which is the corridor, so its members
 * have to take their height from the band rather than from the asset: a
 * spanning object's measured height is its bounds centre, and a shell's
 * bounds centre sits in its own empty middle, which on this kit reads
 * 0.49W — the middle of the road at knee height. Correct so far. But the
 * band's pool was every asset whose lateral sat there, INCLUDING TUNNEL
 * SHELLS, and standing a nine-half-width shell on the corridor ceiling
 * puts it ten half-widths up and twelve across. The lap acquired a roof.
 * Band mix: exactly on target. Corridor: clear. Cone: clear. Every
 * repair: settled. The sky: bricked over.
 *
 * So the comparison is against the REFERENCE's own profile, measured the
 * same way on the same lap with the same renderer, which is the fairest
 * available standard and the one the page itself puts on screen beside
 * it. Heights, longest edges and volumes, at quantiles rather than means,
 * because a canopy is a tail event: it moves p99 and max and leaves the
 * mean alone.
 */
function boxProfile(
  lap: Lap,
  boxes: readonly { centre: number[]; size: number[] }[],
): { h: number[]; edge: number[]; volume: number[] } {
  const W = lap.halfWidth;
  const dot = (a: readonly number[], b: readonly number[]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const h: number[] = [];
  const edge: number[] = [];
  const volume: number[] = [];
  for (const b of boxes) {
    // Nearest frame, then decompose onto its up axis. World Y will not do:
    // the circuit has 26 units of relief, which is three half-widths of
    // elevation change, and it swamps the quantity being measured.
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < lap.count; i++) {
      const dd =
        (b.centre[0] - lap.p[i * 3]) ** 2 +
        (b.centre[1] - lap.p[i * 3 + 1]) ** 2 +
        (b.centre[2] - lap.p[i * 3 + 2]) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    const v = [
      b.centre[0] - lap.p[best * 3],
      b.centre[1] - lap.p[best * 3 + 1],
      b.centre[2] - lap.p[best * 3 + 2],
    ];
    h.push(dot(v, [lap.up[best * 3], lap.up[best * 3 + 1], lap.up[best * 3 + 2]]) / W);
    edge.push(Math.max(...b.size) / W);
    volume.push((b.size[0] * b.size[1] * b.size[2]) / (W * W * W));
  }
  return { h, edge, volume };
}

/**
 * The DRESSING, without L-6's cover.
 *
 * The silhouette is compared against the reference circuit's own
 * placements, and that circuit is 2% enclosed — its longest covered
 * stretch is nine tenths of a half-width. A generator building the
 * POPULATION's 10.5% therefore cannot match it on anything that counts
 * overhead structure, and should not be asked to: it would mean either
 * dropping enclosure or reproducing an exemplar that upstream has now
 * warned about three times. So scenery is compared with scenery, and the
 * enclosure share is gated separately, by measurement, against the
 * population figure it actually comes from.
 */
function scenery(boxes: readonly PlacedBox[]): PlacedBox[] {
  return boxes.filter((b) => !b.cover);
}

function quantile(xs: readonly number[], f: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(f * (s.length - 1))];
}

describe.skipIf(!KIT)("the silhouette", () => {
  const kit = kitOrAbsent<Kit>(KIT_KEY);

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

  async function reference(): Promise<PlacedBox[]> {
    const l = await theLap();
    const fa = frameLookup(l);
    return placeKit(kit, l, (st, lat, h) => {
      const f = fa(st, lat, h);
      return {
        p: [...f.p] as [number, number, number],
        across: [...f.across] as [number, number, number],
        along: [...f.dir] as [number, number, number],
        up: [...f.up] as [number, number, number],
      };
    });
  }

  it("stands at the same height as the dressing it was measured from", async () => {
    const l = await theLap();
    const gen = boxProfile(l, scenery(dressLap(kit, l, 1).boxes));
    const ref = boxProfile(l, await reference());

    // p99 AND max, not the median alone. The canopy left the median
    // exactly where it was and moved only the top percentile, which is
    // what a tail event does and why a mean would have missed it.
    for (const f of [0.5, 0.9, 0.99]) {
      const g = quantile(gen.h, f);
      const r = quantile(ref.h, f);
      expect(
        Math.abs(g - r),
        `height p${f * 100}: generated ${g.toFixed(2)}W against reference ${r.toFixed(2)}W`,
      ).toBeLessThan(1);
    }
    // Nothing may stand more than a half-width above the tallest thing
    // the source itself put on this circuit.
    expect(Math.max(...gen.h)).toBeLessThan(Math.max(...ref.h) + 1);
  }, 300_000);

  it("is built from pieces the same size as the source's", async () => {
    const l = await theLap();
    const gen = boxProfile(l, scenery(dressLap(kit, l, 1).boxes));
    const ref = boxProfile(l, await reference());
    for (const f of [0.5, 0.9]) {
      expect(Math.abs(quantile(gen.edge, f) - quantile(ref.edge, f))).toBeLessThan(0.5);
    }
    // And the same amount of material overall, within a quarter.
    const gv = gen.volume.reduce((a, b) => a + b, 0);
    const rv = ref.volume.reduce((a, b) => a + b, 0);
    expect(Math.abs(gv - rv) / rv, `${gv.toFixed(0)} against ${rv.toFixed(0)} W3`).toBeLessThan(
      0.25,
    );
  }, 300_000);

  /**
   * THE CHECK, PROVED ABLE TO FAIL — on the exact defect it was written
   * for, reproduced by lifting the dressing rather than by regenerating
   * it. Lifting is the right forgery: it changes nothing a rule looks at.
   */
  it("sees a lap with a roof on it", async () => {
    const l = await theLap();
    const gen = scenery(dressLap(kit, l, 1).boxes);
    const ref = boxProfile(l, await reference());
    // Every box raised four half-widths: the canopy, in one line.
    const raised = gen.map((b) => ({
      ...b,
      centre: [b.centre[0], b.centre[1] + 4 * l.halfWidth, b.centre[2]] as [number, number, number],
    }));
    const lifted = boxProfile(l, raised);
    expect(Math.abs(quantile(lifted.h, 0.5) - quantile(ref.h, 0.5))).toBeGreaterThan(1);
    expect(Math.max(...lifted.h)).toBeGreaterThan(Math.max(...ref.h) + 1);
  }, 300_000);

  it("reports both profiles, so a reader can see how close they are", async () => {
    const l = await theLap();
    const gen = boxProfile(l, scenery(dressLap(kit, l, 1).boxes));
    const ref = boxProfile(l, await reference());
    const row = (n: string, p: ReturnType<typeof boxProfile>): string =>
      `  ${n.padEnd(10)} n=${String(p.h.length).padStart(5)} | ` +
      `h above road: med=${quantile(p.h, 0.5).toFixed(2)} p90=${quantile(p.h, 0.9).toFixed(2)} ` +
      `p99=${quantile(p.h, 0.99).toFixed(2)} max=${Math.max(...p.h).toFixed(2)} | ` +
      `longest edge: med=${quantile(p.edge, 0.5).toFixed(2)} p90=${quantile(p.edge, 0.9).toFixed(2)} | ` +
      `volume: total=${p.volume.reduce((a, b) => a + b, 0).toFixed(0)}W3`;
    console.log(["the silhouette, in half-widths:", row("generated", gen), row("reference", ref)].join("\n"));
    expect(gen.h.length).toBeGreaterThan(0);
  }, 300_000);
});
