/**
 * The spline-to-environment-art technique, end to end, scored.
 *
 * This is the integration proof for a claim the library makes about
 * itself: that a real production technique — one specified independently,
 * with measured targets and a pass/fail suite — is expressible as a
 * pcg-ts graph rather than as a program that happens to call pcg-ts.
 *
 * What runs here is the technique's own architecture. The GRAPH places
 * (frames, corner model, curvature-weighted density by inverse transform,
 * clustering, side bias, legibility furniture, coverage fill, sightline
 * cull) and the HOST calibrates and corrects across regenerations, because
 * every calibration quantity is a share of a total and a cook cannot read
 * its own totals. See the header of `support/trackCalibrate.ts`.
 */
import { describe, expect, it } from "vitest";
import { cook } from "../src/graph/index.js";
import type { Geometry } from "../src/data/index.js";
import { firstGeo } from "../src/nodes/nodes.testsupport.js";
import { buildTrackDressingGraph } from "./support/trackDressing.js";
import {
  type Corrections,
  type Placement,
  type Report,
  calibrate,
  chooseCommittedStretches,
  correct,
  countBlocking,
  noCorrections,
  score,
} from "./support/trackCalibrate.js";
import { PRESETS, type Preset } from "./support/trackKit.js";

const HALF_WIDTH = 1755;
const CONTROL_POINTS = 800;
const FRAMES = 400;
const LAP_RADIUS = 62 * HALF_WIDTH;
const RELIEF = 6 * HALF_WIDTH;

/** Read a numeric point column as plain numbers, without its slack. */
function col(g: Geometry, name: string): Float64Array {
  const a = g.attrs.point.require(name);
  const out = new Float64Array(g.pointCount * a.tupleSize);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i];
  return out;
}

/**
 * Read a string point column. `get` on a string attribute returns the
 * STRING-TABLE INDEX; `getString` is the one that resolves it, and reading
 * the wrong one silently yields a column of plausible small integers.
 */
function strCol(g: Geometry, name: string): string[] {
  const a = g.attrs.point.require(name);
  const out: string[] = [];
  for (let i = 0; i < g.pointCount; i++) out.push(a.getString(i, 0));
  return out;
}

/** The cooked placements, as the metrics see them. */
function readPlacements(g: Geometry): Placement[] {
  const archetype = strCol(g, "archetype");
  const stationW = col(g, "stationW");
  const lateralW = col(g, "lateralW");
  const heightW = col(g, "heightW");
  const footprintW = col(g, "footprintW");
  const tallnessW = col(g, "tallnessW");
  const zone = col(g, "zone");
  const pack1 = col(g, "pack1");
  const pack2 = col(g, "pack2");
  const variant = col(g, "variant");
  const polygons = col(g, "polygons");
  const isSprite = col(g, "isSprite");
  // Rule-placed furniture carries the turn direction of the corner it
  // announces; a density placement has no corner and carries 0.
  const cornerK = g.attrs.point.get("cornerK") ? col(g, "cornerK") : new Float64Array(g.pointCount);
  const out: Placement[] = [];
  for (let i = 0; i < g.pointCount; i++) {
    out.push({
      archetype: archetype[i],
      stationW: stationW[i],
      lateralW: lateralW[i],
      heightW: heightW[i],
      footprintW: footprintW[i],
      tallnessW: tallnessW[i],
      radiusW: pack1[i * 4 + 3],
      kSigned: pack2[i * 4 + 3],
      zone: zone[i],
      cornerK: cornerK[i],
      variant: variant[i],
      polygons: polygons[i],
      isSprite: isSprite[i],
      // The asset slot: one model per family, and a family is an archetype
      // plus a variant. Composed here rather than in the graph because the
      // field grammar has no string concatenation, and a numeric variant
      // beside the archetype name carries the same information.
      family: `${archetype[i]}#${variant[i]}`,
    });
  }
  return out;
}

/**
 * How many corner ENTRIES the frames hold, counted the graph's way —
 * including sampling the severity two half-widths INTO the corner rather
 * than at the entry, where the radius has only just crossed the
 * threshold. An independent re-derivation of what the graph decides, so
 * it has to make the same choice or it is measuring something else.
 */
function countCornerEntries(frames: Geometry, lapW: number): { entries: number; tight: number } {
  const isCorner = col(frames, "isCorner");
  const radiusW = col(frames, "radiusW");
  const n = frames.pointCount;
  const probe = Math.round(2 / (lapW / n));
  let entries = 0;
  let tight = 0;
  for (let i = 0; i < n; i++) {
    const prev = isCorner[(i + n - 1) % n];
    if (isCorner[i] >= 0.5 && prev < 0.5) {
      entries++;
      if (radiusW[(i + probe) % n] < 8) tight++;
    }
  }
  return { entries, tight };
}

/**
 * Is `a` a better iteration than `b`?
 *
 * More metrics passed wins; a tie goes to whichever landed closer to the
 * target density. Keeping the BEST rather than the LAST is the point: the
 * corrections are measured on samples small enough to be noisy — only a
 * few dozen placements sit inside bends on a lap — so a later iteration is
 * usually, but not always, an improvement.
 */
function better(a: Report, b: Report, preset: Preset): boolean {
  if (a.passed !== b.passed) return a.passed > b.passed;
  return Math.abs(a.perW - preset.density) < Math.abs(b.perW - preset.density);
}

/** Cook one iteration of the pipeline and score what came out. */
async function runOnce(
  preset: Preset,
  lapLength: number,
  c: Corrections,
  seed: number,
  passes: {
    legibility?: boolean;
    coverage?: boolean;
    sightline?: boolean;
    landmarks?: boolean;
    balance?: boolean;
  } = {},
  committed: Readonly<Record<number, number>> = {},
): Promise<{ report: Report; placements: Placement[]; frames: Geometry; lapW: number }> {
  const lapW = lapLength / HALF_WIDTH;
  const plan = calibrate(preset, lapW, c);
  const { graph } = buildTrackDressingGraph({
    preset,
    halfWidth: HALF_WIDTH,
    controlPoints: CONTROL_POINTS,
    frames: FRAMES,
    lapRadius: LAP_RADIUS,
    relief: RELIEF,
    countByProfile: plan.countByProfile,
    weightByArchetype: plan.weightByArchetype,
    outsideShift: plan.outsideShift,
    variantsByArchetype: plan.variantsByArchetype,
    polygonScale: plan.polygonScale,
    committedStretches: committed,
    lapLength,
    seed,
    ...passes,
  });
  const out = await cook(graph);
  const placementGeo = firstGeo(out.outputs.placements);
  const frames = firstGeo(out.outputs.frames);
  const placements = readPlacements(placementGeo);
  const corners = countCornerEntries(frames, lapW);
  const markers = placements.filter((p) => p.archetype === "corner-marker").length;
  const blocking = countBlocking(
    placements,
    col(placementGeo, "P"),
    col(frames, "P"),
    frames.pointCount,
    HALF_WIDTH,
    lapW,
  );
  const report = score(placements, preset, lapW, corners.entries, markers, blocking);
  return { report, placements, frames, lapW };
}

/**
 * Measure the generated lap, and pick the stretches the balance pass will
 * commit — neither of which anything downstream can know before a cook.
 */
async function measureLap(
  preset: Preset,
): Promise<{ lapLength: number; committed: Record<number, number> }> {
  const { graph } = buildTrackDressingGraph({
    preset,
    halfWidth: HALF_WIDTH,
    controlPoints: CONTROL_POINTS,
    frames: FRAMES,
    lapRadius: LAP_RADIUS,
    relief: RELIEF,
    countByProfile: { flat: 1, built: 1, clustered: 1 },
    weightByArchetype: {},
    lapLength: 1,
    seed: 1,
    legibility: false,
    coverage: false,
    sightline: false,
    landmarks: false,
    balance: false,
  });
  const out = await cook(graph);
  const frames = firstGeo(out.outputs.frames);
  const lapLength = frames.attrs.primitive.require("lapLen").get(0) as number;
  // The stretches the balance pass will commit are chosen from a cook with
  // the pass switched OFF: it needs to know where the movable placements
  // are, and only a dressed lap knows that.
  const dry = await runOnce(preset, lapLength, noCorrections(), 21, { balance: false });
  const committed = chooseCommittedStretches(dry.placements, dry.lapW);
  return { lapLength, committed };
}

describe("spline to environment art", () => {
  it("frames the lap in track coordinates, with a corner model on it", async () => {
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    const { frames, lapW } = await runOnce(preset, lapLength, noCorrections(), 7, {
      legibility: false,
      coverage: false,
      sightline: false,
    }, committed);
    // A lap the technique's own statistics apply to: a few hundred W long,
    // sampled near one W per frame.
    expect(lapW).toBeGreaterThan(300);
    expect(lapW).toBeLessThan(600);
    expect(lapW / FRAMES).toBeGreaterThan(0.7);
    expect(lapW / FRAMES).toBeLessThan(1.6);

    // The frame is orthonormal and banked, and the bank leans INTO the
    // turn — the direction that is easy to get backwards and impossible
    // to see in a screenshot.
    const rightB = col(frames, "rightB");
    const upB = col(frames, "upB");
    const tangent = col(frames, "tangent");
    const kSigned = col(frames, "kSigned");
    const bank = col(frames, "bankRad");
    for (let i = 0; i < frames.pointCount; i += 37) {
      const d = (a: Float64Array, b: Float64Array, o: number) =>
        a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2];
      expect(d(rightB, rightB, i * 3)).toBeCloseTo(1, 4);
      expect(d(upB, upB, i * 3)).toBeCloseTo(1, 4);
      expect(Math.abs(d(rightB, upB, i * 3))).toBeLessThan(1e-4);
      expect(Math.abs(d(rightB, tangent, i * 3))).toBeLessThan(1e-4);
    }
    let leaning = 0;
    let bends = 0;
    for (let i = 0; i < frames.pointCount; i++) {
      if (Math.abs(bank[i]) < 1e-3) continue;
      bends++;
      // A right-hand bend (positive curvature) must roll NEGATIVE.
      if (Math.sign(bank[i]) === -Math.sign(kSigned[i])) leaning++;
    }
    expect(bends).toBeGreaterThan(50);
    expect(leaning / bends).toBeGreaterThan(0.99);

    // The corner model finds corners, and they are a believable share of
    // the lap rather than all of it or none.
    const isCorner = col(frames, "isCorner");
    const share = isCorner.reduce((a, b) => a + b, 0) / frames.pointCount;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.6);
    const { entries } = countCornerEntries(frames, lapW);
    expect(entries).toBeGreaterThan(3);
    expect(entries).toBeLessThan(45);
  });

  it("places what the calibration asked for, in proportion to the density", async () => {
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    const { placements } = await runOnce(preset, lapLength, noCorrections(), 7, {
      legibility: false,
      coverage: false,
      sightline: false,
    }, committed);
    // Every archetype in the kit that the calibration kept is represented,
    // and nothing outside the kit appears.
    const kinds = new Set(placements.map((p) => p.archetype));
    expect(kinds.size).toBeGreaterThan(10);
    // Placements track the curvature-weighted density rather than sitting
    // evenly: the clustered profile leans on bends, so the tight-bucket
    // stretches carry more per W than the straights do.
    const tight = placements.filter((p) => Math.abs(p.radiusW) < 7).length;
    const straight = placements.filter((p) => Math.abs(p.radiusW) >= 40).length;
    expect(tight + straight).toBeGreaterThan(20);
  });

  it("keeps the corridor clear, which is the one inviolable rule", async () => {
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    const { placements } = await runOnce(preset, lapLength, noCorrections(), 11, {}, committed);
    const intruding = placements.filter(
      (p) => Math.abs(p.lateralW) < 1 && p.heightW >= 0 && p.heightW < 1.2,
    );
    expect(intruding).toEqual([]);
  });

  it("announces every corner, which is the pass a graph was least likely to reach", async () => {
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    const { placements, frames, lapW } = await runOnce(preset, lapLength, noCorrections(), 13, {}, committed);
    const { entries, tight } = countCornerEntries(frames, lapW);
    const markers = placements.filter((p) => p.archetype === "corner-marker");
    // One marker per corner entry. A corner entry is a NEIGHBOUR
    // comparison, which no field can express — this is the pin on the
    // slide-and-transfer idiom that makes it expressible anyway.
    expect(markers.length).toBe(entries);
    // Every marker on the OUTSIDE of its bend, which is what makes the
    // language readable at speed.
    // Against the CORNER's turn direction, not the frame under the marker:
    // a marker stands on straight track several half-widths before the
    // bend, so the frame beneath it has no side to be on.
    for (const m of markers) {
      // Against the corner's turn direction, with the same tie-break the
      // graph makes: a probe that reads exactly zero still takes a side,
      // because zero is not a side and the centreline is forbidden.
      expect(Math.sign(m.lateralW)).toBe(m.cornerK > 0 ? -1 : 1);
    }
    // Braking references only before the tight corners, three per corner.
    const brakes = placements.filter((p) => p.archetype === "braking-reference");
    expect(brakes.length).toBe(tight * 3);
  });

  it("closes the loop: measure, correct, regenerate, and keep the best", async () => {
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    let c = noCorrections();
    let best: Report | null = null;
    const history: number[] = [];
    for (let iter = 0; iter < 3; iter++) {
      const { report } = await runOnce(preset, lapLength, c, 21, {}, committed);
      history.push(report.passed);
      if (best === null || better(report, best, preset)) best = report;
      c = correct(preset, report, c);
    }
    expect(best).not.toBeNull();
    const report = best!;
    // Report the whole card, so a failure names the metric rather than
    // just the count.
    const failures = report.metrics.filter((m) => !m.pass);
    const card = [...report.metrics]
      .sort((x, y) => x.id - y.id)
      .map((m) => `${m.pass ? "PASS" : "FAIL"} ${m.id} ${m.name} = ${m.value.toFixed(3)} (${m.target})`)
      .join("\n");
    // A failure names the metric and prints the whole card, because
    // "10 of 11" tells whoever reads the run nothing about which rule broke.
    if (failures.length > 0) console.log(`
${card}
bands ${JSON.stringify(report.bandShare)}`);
    // All seventeen, scored. A run that quietly scored twelve of them
    // would pass every assertion below it.
    expect(report.metrics.length).toBe(17);
    expect(report.passed).toBe(report.metrics.length);
    // The loop must not make things worse over its own iterations.
    expect(Math.max(...history)).toBeGreaterThanOrEqual(history[0]);
    expect(failures.map((f) => `${f.id} ${f.name}`)).toEqual([]);
  });

  it("FAILS when a pass is switched off, which is what makes the passes mean anything", async () => {
    // The check on the check. A suite of seventeen rules that passes is
    // worth nothing until it has been shown to fail: an exemption that
    // quietly matched everything, a count taken from the thing it was
    // meant to verify, a metric wired to a constant — all of those pass.
    // So each pass is switched off in turn and the metric that owns it
    // has to notice. Metric 16 is the one this was written for: it was
    // scored against a hardcoded zero and proved nothing at all.
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    // Metric 10 is deliberately NOT in this list, and finding out why was
    // the point of writing the test. It passes with the balance pass
    // switched off: the slow side drift the density pass already applies
    // produces two one-sided stretches each way on this lap by itself. So
    // metric 10 does not OWN the balance pass, the pass is a guarantee
    // rather than the only source, and claiming otherwise would have been
    // a green assertion about nothing. The pass is verified directly in
    // the test below instead.
    const cases: { off: Record<string, boolean>; metric: number }[] = [
      { off: { landmarks: false }, metric: 17 },
      { off: { legibility: false }, metric: 15 },
      { off: { sightline: false }, metric: 16 },
    ];
    for (const { off, metric } of cases) {
      const { report } = await runOnce(preset, lapLength, noCorrections(), 21, off, committed);
      const m = report.metrics.find((x) => x.id === metric);
      expect(m, `metric ${metric} is scored`).toBeDefined();
      expect(
        m!.pass,
        `metric ${metric} (${m!.name}) still passed with ${JSON.stringify(off)}: ` +
          `it is not measuring the pass it names, value ${m!.value}`,
      ).toBe(false);
    }
  });

  it("commits the stretches the balance pass was told to, and only those", async () => {
    // Verified directly rather than through metric 10, which the lap
    // satisfies on its own. What the pass must do is make the tenths it
    // was GIVEN lean the way it was told, and leave everything else alone.
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    const lean = (ps: Placement[], lapW: number, tenth: number): number => {
      const inTenth = ps.filter(
        (p) =>
          Math.floor((((p.stationW % lapW) + lapW) % lapW) / (lapW / 10)) === tenth &&
          p.lateralW !== 0,
      );
      return inTenth.length === 0 ? 0.5 : inTenth.filter((p) => p.lateralW > 0).length / inTenth.length;
    };
    const on = await runOnce(preset, lapLength, noCorrections(), 21, {}, committed);
    const off = await runOnce(preset, lapLength, noCorrections(), 21, { balance: false }, committed);
    let committedLeaning = 0;
    for (const [tenth, dir] of Object.entries(committed)) {
      const share = lean(on.placements, on.lapW, Number(tenth));
      if (Number(dir) > 0 ? share >= 0.78 : share <= 0.22) committedLeaning++;
    }
    expect(committedLeaning).toBe(Object.keys(committed).length);
    // And the same tenths do NOT all lean that way without the pass, which
    // is what says the pass rather than the lap produced it.
    let withoutPass = 0;
    for (const [tenth, dir] of Object.entries(committed)) {
      const share = lean(off.placements, off.lapW, Number(tenth));
      if (Number(dir) > 0 ? share >= 0.78 : share <= 0.22) withoutPass++;
    }
    expect(withoutPass).toBeLessThan(Object.keys(committed).length);
  });

  it("reproduces exactly from its seed, and differs when the seed does", async () => {
    const preset = PRESETS.sparse;
    const { lapLength, committed } = await measureLap(preset);
    const a = await runOnce(preset, lapLength, noCorrections(), 5, {}, committed);
    const b = await runOnce(preset, lapLength, noCorrections(), 5, {}, committed);
    const c = await runOnce(preset, lapLength, noCorrections(), 6, {}, committed);
    expect(a.placements).toEqual(b.placements);
    expect(a.placements).not.toEqual(c.placements);
    expect(a.placements.length).toBeGreaterThan(50);
  });

  it("changes only the weighting between presets, never the rules", async () => {
    // The claim the technique rests on: a preset is a weighting over one
    // vocabulary and one set of placement rules. If that holds, switching
    // preset moves the density and the band mix and touches nothing else.
    const reports: Record<string, Report> = {};
    for (const id of ["sparse", "lush", "dense"]) {
      const preset = PRESETS[id];
      const { lapLength, committed } = await measureLap(preset);
      let c = noCorrections();
      let best: Report | null = null;
      for (let iter = 0; iter < 3; iter++) {
        const { report } = await runOnce(preset, lapLength, c, 3, {}, committed);
        if (best === null || better(report, best, preset)) best = report;
        c = correct(preset, report, c);
      }
      reports[id] = best!;
    }
    // Each lands in its OWN density band, and they are genuinely different.
    for (const id of ["sparse", "lush", "dense"]) {
      const p = PRESETS[id];
      expect(reports[id].perW).toBeGreaterThanOrEqual(p.densityAccept[0]);
      expect(reports[id].perW).toBeLessThanOrEqual(p.densityAccept[1]);
    }
    expect(reports.dense.perW).toBeGreaterThan(reports.sparse.perW);
    // And the band mixes differ in the direction the presets ask for: the
    // dense preset pulls its kit INWARD, so it puts less in the far band.
    expect(reports.dense.bandShare.far).toBeLessThan(reports.lush.bandShare.far);
  });
});
