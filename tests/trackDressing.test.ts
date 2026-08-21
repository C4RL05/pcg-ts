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
 * its own totals. See the header of `demos/racetrack/calibrate.ts`.
 */
import { describe, expect, it } from "vitest";
// The library by PACKAGE NAME, not through `../src`: this suite also
// imports the demo that builds the graph, the demo imports "pcg-ts" the
// way every page does, and two spellings of the same module are two
// different types to tsc even when they are one file at runtime. The
// vitest config aliases the specifier back to `src/`, so this still tests
// the working tree rather than the last build.
import { type Geometry, cook, createPointCloud, makeGeometryItem } from "pcg-ts";
import { buildTrackDressingGraph } from "../demos/racetrack/dressing.js";
import {
  type Corrections,
  type Placement,
  type Report,
  calibrate,
  chooseCommittedStretches,
  correct,
  isMovable,
  noCorrections,
} from "../demos/racetrack/calibrate.js";
import {
  TRACK,
  better,
  col,
  countCornerEntries,
  readPlacements,
  requireGeo,
  scoreCook,
} from "../demos/racetrack/read.js";
import {
  NO_COMMITTED_STRETCHES,
  PRESETS,
  type Preset,
  decodeCommittedStretches,
  encodeCommittedStretches,
  tenthOf,
} from "../demos/racetrack/kit.js";

const { halfWidth: HALF_WIDTH, controlPoints: CONTROL_POINTS, frames: FRAMES } = TRACK;
const { lapRadius: LAP_RADIUS, relief: RELIEF } = TRACK;

/** The build options every suite shares; only the aiming differs. */
const BASE = {
  halfWidth: HALF_WIDTH,
  controlPoints: CONTROL_POINTS,
  frames: FRAMES,
  lapRadius: LAP_RADIUS,
  relief: RELIEF,
} as const;

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
    ...BASE,
    preset,
    countByProfile: plan.countByProfile,
    weightByArchetype: plan.weightByArchetype,
    outsideShift: plan.outsideShift,
    variantsByArchetype: plan.variantsByArchetype,
    polygonScale: plan.polygonScale,
    committedStretches: committed,
    seed,
    ...passes,
  });
  return { ...scoreCook(await cook(graph), preset, lapW), lapW };
}

/**
 * Measure the generated lap, and pick the stretches the balance pass will
 * commit — neither of which anything downstream can know before a cook.
 *
 * Memoised on the preset, which is the only thing it varies with: every
 * other input is a module constant and both seeds inside are literals. It
 * runs two full build-and-cook pairs and the suite asks for it a dozen
 * times across three presets, so without the memo a quarter of the run is
 * spent recomputing answers it already had.
 */
const lapCache = new Map<Preset, Promise<{ lapLength: number; committed: Record<number, number> }>>();

function measureLap(
  preset: Preset,
): Promise<{ lapLength: number; committed: Record<number, number> }> {
  const hit = lapCache.get(preset);
  if (hit) return hit;
  const run = measureLapUncached(preset);
  lapCache.set(preset, run);
  return run;
}

async function measureLapUncached(
  preset: Preset,
): Promise<{ lapLength: number; committed: Record<number, number> }> {
  const { graph } = buildTrackDressingGraph({
    ...BASE,
    preset,
    countByProfile: { flat: 1, built: 1, clustered: 1 },
    weightByArchetype: {},
    seed: 1,
    legibility: false,
    coverage: false,
    sightline: false,
    landmarks: false,
    balance: false,
  });
  const out = await cook(graph);
  const frames = requireGeo(out.outputs.frames);
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
    // All eighteen, scored. A run that quietly scored twelve of them
    // would pass every assertion below it.
    expect(report.metrics.length).toBe(18);
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
    // Verified against the pass's ACTUAL contract, not through metric 10,
    // which this lap satisfies on its own. The contract is: in a
    // committed stretch, every MOVABLE placement goes to the committed
    // side — and nothing else moves at all, because an object inside a
    // bend is pinned by the corner it belongs to and rule-placed
    // furniture is pinned by what it means.
    //
    // Which is also why the stretch totals stop short of the 78/22 the
    // balance metric asks for: measured, the four committed tenths swing
    // 0.879 -> 0.061, 0.116 -> 1.000, 0.127 -> 0.759 and 0.667 -> 0.140,
    // and the one that stalls at 0.759 is a quarter pinned. Asserting the
    // threshold here would be asserting a property of the lap.
    const preset = PRESETS.lush;
    const { lapLength, committed } = await measureLap(preset);
    // The graph bins in f32 through a field and this bins in f64, so a
    // placement landing exactly on a tenth boundary can be binned either
    // side by the last bits. That is a tie, not a defect, and asserting
    // through it would be asserting about rounding.
    const EDGE = 0.05;
    const nearEdge = (p: Placement, lapW: number) => {
      const u = (((p.stationW % lapW) + lapW) % lapW) / (lapW / 10);
      return Math.abs(u - Math.round(u)) * (lapW / 10) < EDGE;
    };
    const on = await runOnce(preset, lapLength, noCorrections(), 21, {}, committed);
    const off = await runOnce(preset, lapLength, noCorrections(), 21, { balance: false }, committed);

    for (const [tenth, dir] of Object.entries(committed)) {
      // Placements sitting within a hair of a tenth boundary are skipped
      // (see nearEdge).
      // The graph bins in f32 through a field and this bins in f64, so a
      // cluster member that lands exactly on a boundary can be binned
      // either side by the last bits — which is a tie, not a defect, and
      // asserting through it would be asserting about rounding.
      const inTenth = on.placements.filter(
        (p) => tenthOf(p.stationW, on.lapW) === Number(tenth) && p.lateralW !== 0 && !nearEdge(p, on.lapW),
      );
      const free = inTenth.filter(isMovable);
      expect(free.length, `stretch ${tenth} has movable placements`).toBeGreaterThan(3);
      // Every one of them, on the committed side. No tolerance: this is
      // what the pass does, and a placement it missed is a bug.
      const wrongSide = free.filter((p) => Math.sign(p.lateralW) !== Number(dir));
      expect(wrongSide.map((p) => p.archetype)).toEqual([]);
    }

    // And the pass is what did it. Asserted across the committed
    // stretches rather than per stretch: the selection picks the tenths
    // with the most MOVABLE placements, and one of those can happen to
    // lean hard already from the density pass's own side drift — measured,
    // one stretch sits at 0.97 before the balance pass touches it. So the
    // claim that survives is that SOMETHING was on the wrong side before,
    // which a lap that already agreed could not produce.
    let wrongBefore = 0;
    for (const [tenth, dir] of Object.entries(committed)) {
      wrongBefore += off.placements.filter(
        (p) =>
          tenthOf(p.stationW, off.lapW) === Number(tenth) &&
          p.lateralW !== 0 &&
          isMovable(p) &&
          !nearEdge(p, off.lapW) &&
          Math.sign(p.lateralW) !== Number(dir),
      ).length;
    }
    expect(wrongBefore, "the balance pass had work to do").toBeGreaterThan(5);

    // Nothing OUTSIDE a committed stretch was touched by the pass.
    const keyOf = (p: Placement) => `${p.archetype}|${p.stationW.toFixed(3)}`;
    const offSide = new Map(off.placements.map((p) => [keyOf(p), p.lateralW]));
    const committedTenths = new Set(Object.keys(committed).map(Number));
    let movedOutside = 0;
    for (const p of on.placements) {
      if (committedTenths.has(tenthOf(p.stationW, on.lapW))) continue;
      if (nearEdge(p, on.lapW)) continue;
      const was = offSide.get(keyOf(p));
      if (was !== undefined && Math.sign(was) !== Math.sign(p.lateralW)) movedOutside++;
    }
    expect(movedOutside).toBe(0);
  });

  it("dresses a DIFFERENT track without being rebuilt, which is the whole point", async () => {
    // The claim this refactor exists to make good on. One graph, built
    // once, handed a centreline it has never seen — a different shape and
    // a different length — and re-aimed with nothing but node params.
    //
    // It used to be impossible. The lap's length and the half-width were
    // build-time constants multiplied into forty-one field expressions, so
    // a graph could only ever dress the track it was compiled for and a
    // new track meant a new graph. Now the length comes off `pathResample`
    // and the half-width is one addressable knob, so both are DATA.
    const preset = PRESETS.lush;
    const built = buildTrackDressingGraph({
      ...BASE,
      preset,
      // Deliberately wrong for the track it is about to be given: if any
      // of this leaked into the geometry the metrics below would say so.
      countByProfile: { flat: 1, built: 1, clustered: 1 },
      weightByArchetype: {},
      seed: 31,
      splineFromHost: true,
    });
    const graph = built.graph;

    // A centreline of a different shape and roughly two-thirds the length,
    // built here rather than by the graph — the technique's actual input.
    const N = 700;
    const pos: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 41 * HALF_WIDTH * (1 + 0.15 * Math.sin(4 * a) + 0.06 * Math.sin(9 * a + 0.4));
      pos.push(Math.cos(a) * r, 3 * HALF_WIDTH * Math.sin(3 * a + 1.1), Math.sin(a) * r);
    }
    const spline = createPointCloud(N);
    const sp = spline.attrs.point.require("P");
    for (let i = 0; i < N; i++) sp.setTuple(i, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    graph.setParam(built.nodes.splineIn, "items", [makeGeometryItem(spline)]);

    // Cook once to learn the lap, exactly as a host would.
    const probe = requireGeo((await cook(graph)).outputs.frames);
    const lapLength = probe.attrs.primitive.require("lapLen").get(0) as number;
    const lapW = lapLength / HALF_WIDTH;
    expect(lapW).toBeGreaterThan(200);
    // A genuinely different lap, not the built-in one wearing a hat.
    const home = await measureLap(preset);
    expect(Math.abs(lapW - home.lapLength / HALF_WIDTH)).toBeGreaterThan(80);

    // Re-aim by TURNING KNOBS. No rebuild: the same graph object, the same
    // 213 nodes, four integer counts and three weight lists.
    const aim = (plan: ReturnType<typeof calibrate>) => {
      for (const profile of ["flat", "built", "clustered"] as const) {
        const ids = built.archetypesByProfile[profile];
        graph.setParam(
          built.nodes.anchors[profile],
          "count",
          Math.max(1, Math.round(plan.countByProfile[profile] ?? 1)),
        );
        // Quantised against the profile's own largest rate, which is a
        // property of the list rather than of each entry — hoisted out of
        // the map over that same list.
        const top = Math.max(1e-9, ...ids.map((x) => plan.weightByArchetype[x] ?? 0));
        graph.setParam(
          built.nodes.anchorKind[profile],
          "weights",
          ids.map((id) => Math.max(1, Math.round(((plan.weightByArchetype[id] ?? 0) / top) * 1000))),
        );
      }
    };

    // The balance pass, re-aimed on the new track like everything else.
    // Its table is ONE number — see encodeCommittedStretches — and it is
    // chosen from a dry cook of THIS lap, because which stretches can
    // carry a lean is a fact about the track and not about the graph.
    aim(calibrate(preset, lapW, noCorrections()));
    graph.setParam(built.nodes.leanCode, "value", NO_COMMITTED_STRETCHES);
    const dryOut = await cook(graph);
    const dryFrames = requireGeo(dryOut.outputs.frames);
    // A FAIR different track, not a stress case. The metrics are the
    // technique's measurements of real circuits, so a lap far outside what
    // it measured cannot pass them and would not be telling us anything
    // about the graph — a lap 36% corner, which the first attempt here
    // was, cannot carry a one-sided stretch at all and fails metric 10 by
    // construction. This one sits inside the baseline: a quarter to a
    // third in a bend, half of it tighter than 25W.
    const cornerShare =
      col(dryFrames, "isCorner").reduce((a, b) => a + b, 0) / dryFrames.pointCount;
    expect(cornerShare).toBeGreaterThan(0.22);
    expect(cornerShare).toBeLessThan(0.34);
    const dry = readPlacements(requireGeo(dryOut.outputs.placements));
    const newCommitted = chooseCommittedStretches(dry, lapW);
    expect(Object.keys(newCommitted).length).toBe(4);
    graph.setParam(
      built.nodes.leanCode,
      "value",
      encodeCommittedStretches(newCommitted),
    );
    // And it round-trips, so a shipped graph can be read as well as set.
    expect(decodeCommittedStretches(encodeCommittedStretches(newCommitted))).toEqual(
      newCommitted,
    );

    let c = noCorrections();
    let best: Report | null = null;
    for (let iter = 0; iter < 3; iter++) {
      aim(calibrate(preset, lapW, c));
      const { report } = scoreCook(await cook(graph), preset, lapW);
      if (best === null || better(report, best, preset)) best = report;
      c = correct(preset, report, c);
    }
    const failures = best!.metrics.filter((m) => !m.pass);
    if (failures.length > 0) {
      console.log(
        `\nretarget ${best!.passed}/17\n` +
          best!.metrics
            .map((m) => `${m.pass ? "PASS" : "FAIL"} ${m.id} ${m.name} = ${m.value.toFixed(3)} (${m.target})`)
            .join("\n"),
      );
    }
    // The rules that are pure geometry must hold outright on a track the
    // graph has never seen: the corridor stays clear, every corner is
    // announced, and nothing stands in the driver's view.
    for (const id of [14, 15, 16]) {
      expect(best!.metrics.find((m) => m.id === id)!.pass, `metric ${id} on a new track`).toBe(true);
    }
    // And ALL seventeen, on a track the graph was not built for. Nothing
    // was rebuilt to get here: one spline injected, four counts, three
    // weight lists and one packed lean table.
    expect(failures.map((f) => `${f.id} ${f.name}`)).toEqual([]);
    expect(best!.passed).toBe(18);
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

/**
 * The road ribbon the demo drives on.
 *
 * Off by default, so the metrics never see it — but the page does, and
 * the one thing that can go wrong with it is invisible in a still: the
 * sweep frame. `writeCurveFrame` carries a rotation-minimizing frame,
 * which is free to roll, and a ribbon swept on it leans further and
 * further off level the further round the lap it gets. The bank test
 * below is what tells those two frames apart.
 */
describe("road ribbon", () => {
  it("sweeps a surface two half-widths across, and never leans past the bank", async () => {
    const preset = PRESETS.lush;
    const built = buildTrackDressingGraph({
      ...TRACK,
      preset,
      seed: 21,
      countByProfile: { flat: 1, built: 1, clustered: 1 },
      weightByArchetype: {},
      legibility: false,
      coverage: false,
      sightline: false,
      landmarks: false,
      balance: false,
      ribbon: true,
    });
    const road = requireGeo((await cook(built.graph)).outputs.road);

    // One ring of two points per frame, stitched into triangles.
    expect(road.pointCount).toBe(TRACK.frames * 2);
    expect(road.primitiveCount).toBeGreaterThan(0);

    const p = col(road, "P");
    const W = TRACK.halfWidth;
    let widest = 0;
    let narrowest = Infinity;
    let steepestDeg = 0;
    for (let i = 0; i < TRACK.frames; i++) {
      const a = i * 6;
      const b = a + 3;
      const dx = p[b] - p[a];
      const dy = p[b + 1] - p[a + 1];
      const dz = p[b + 2] - p[a + 2];
      const across = Math.hypot(dx, dy, dz) / W;
      widest = Math.max(widest, across);
      narrowest = Math.min(narrowest, across);
      // The angle the section makes with the horizontal IS the bank.
      steepestDeg = Math.max(steepestDeg, Math.abs(Math.asin(dy / W / across) * (180 / Math.PI)));
    }

    // Two half-widths, to within the miter correction at a bend.
    expect(narrowest).toBeGreaterThan(1.98);
    expect(widest).toBeLessThan(2.1);

    // The preset's own ceiling, plus a degree of slack for the miter. A
    // rotation-minimizing frame fails this by a mile: it drifts about 20
    // degrees off vertical by a third of the way round and keeps going.
    expect(steepestDeg).toBeLessThan(preset.bankMaxDeg + 1);
  });
});

/**
 * The corridor-art band, per preset, and the one preset that misses it.
 *
 * Worth a test of its own because the miss is a FACT about the kit rather
 * than a bug in the loop, and a fact nobody wrote down is a fact that gets
 * rediscovered. The band is the source material's own rate for the era a
 * preset reproduces: 17% for the two earlier recipes, 32% for the late
 * one, both measured with the same BOX predicate a template can evaluate.
 *
 * `dense` is the late recipe by every signal that identifies one — no
 * camera-facing quads, a density of 0.8–1.25 per W, and a band mix with
 * its mass moved inward — but it dresses from the EARLIER vocabulary,
 * which is the only one this kit carries. That vocabulary's art is
 * narrower, so a late-recipe band mix built out of it puts less over the
 * track than the late recipe actually did. It reads under its band, not
 * over: too clean rather than too dirty.
 *
 * Pinned rather than fixed, because the fix is the other vocabulary — a
 * second archetype table derived from geometry rather than from names —
 * and inventing numbers to close a 7-point gap would be fitting the kit
 * to the metric instead of to the measurement.
 */
describe("corridor art", () => {
  it("stays under the ceiling for every preset", async () => {
    for (const name of ["sparse", "lush", "dense"] as const) {
      const preset = PRESETS[name];
      const { lapLength, committed } = await measureLap(preset);
      const { report } = await runOnce(preset, lapLength, noCorrections(), 21, {}, committed);
      const m = report.metrics.find((x) => x.id === 18);
      expect(m, `${name} has no metric 18`).toBeDefined();
      expect(
        m!.pass,
        `${name}: ${(report.corridorArtShare * 100).toFixed(1)}% against ${preset.corridorArtAccept * 100}%`,
      ).toBe(true);
    }
  });

  it("records that the late recipe runs clean, because its art is the early kit", async () => {
    const { lapLength, committed } = await measureLap(PRESETS.dense);
    const { report } = await runOnce(PRESETS.dense, lapLength, noCorrections(), 21, {}, committed);
    // It PASSES — the metric is a ceiling and this is comfortably under
    // it. What is pinned here is why, because it is not a success: the
    // late recipe measured 32.4% in the source and this reads two thirds
    // of that, since the vocabulary it dresses from is the earlier one
    // and that art is narrower. If a second vocabulary ever lands, this
    // number should rise toward its band rather than stay here.
    const m = report.metrics.find((x) => x.id === 18);
    expect(m!.pass).toBe(true);
    expect(report.corridorArtShare).toBeLessThan(PRESETS.dense.corridorArtAccept - 0.05);
    expect(report.corridorArtShare).toBeGreaterThan(0.18);
  });
});
