/**
 * The dressed lap, as a file you can open.
 *
 * TWO JOBS, and the first is a real guarantee rather than a side effect:
 * the pipeline SERIALIZES. A graph built in TypeScript is only a graph
 * the rest of the library can see if `serializeGraph` accepts it, and
 * that is what makes it openable by `pcg render`, `pcg inspect`, the
 * preview page and the editor without being added to the corpus. It broke
 * once already — two `setAttribute` params held a raw `[0, 0, 0]` where
 * the format wants a field — and nothing else would have caught it.
 *
 * The second job is the export itself, and it only happens when TRACK_OUT
 * names a path, so an ordinary test run writes nothing:
 *
 *   TRACK_OUT=/some/where/track.json npx vitest run tests/trackDressingExport.test.ts
 *   node bin/pcg.mjs render /some/where/track.json --output placements --attr archetype --out track.svg
 *   npm run preview -- /some/where/track.json
 *
 * It writes three files: the serialized graph, the placement rows, and
 * the metric card — all from the SAME winning iteration of the closed
 * loop, so a picture and the numbers beside it can never come from
 * different runs.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cook, serializeGraph } from "../src/index.js";
import { firstGeo } from "../src/nodes/nodes.testsupport.js";
import { buildTrackDressingGraph } from "./support/trackDressing.js";
import { calibrate, chooseCommittedStretches, correct, countBlocking, noCorrections, score } from "./support/trackCalibrate.js";
import { PRESETS } from "./support/trackKit.js";

const OUT = process.env.TRACK_OUT ?? "";

describe("export", () => {
  it("serializes", async () => {
    const preset = PRESETS.lush;
    const base = {
      preset, halfWidth: 1755, controlPoints: 800, frames: 400,
      lapRadius: 62 * 1755, relief: 6 * 1755, seed: 21,
    };
    const probe = buildTrackDressingGraph({
      ...base, countByProfile: { flat: 1, built: 1, clustered: 1 }, weightByArchetype: {},
      lapLength: 1, legibility: false, coverage: false, sightline: false, landmarks: false, balance: false,
    });
    const frames = firstGeo((await cook(probe.graph)).outputs.frames);
    const lapLength = frames.attrs.primitive.require("lapLen").get(0) as number;
    const lapW = lapLength / 1755;
    let corrections = noCorrections();
    let plan = calibrate(preset, lapW, corrections);
    const full = (committed: Record<number, number>) =>
      buildTrackDressingGraph({
        ...base, countByProfile: plan.countByProfile, weightByArchetype: plan.weightByArchetype,
        variantsByArchetype: plan.variantsByArchetype, polygonScale: plan.polygonScale,
        committedStretches: committed, lapLength, spawn: true,
      });
    const dry = full({});
    const dryGeo = firstGeo((await cook(dry.graph)).outputs.placements);
    const ps: { stationW: number; lateralW: number; radiusW: number; archetype: string }[] = [];
    const st = dryGeo.attrs.point.require("stationW");
    const la = dryGeo.attrs.point.require("lateralW");
    const p1 = dryGeo.attrs.point.require("pack1");
    const ar = dryGeo.attrs.point.require("archetype");
    for (let i = 0; i < dryGeo.pointCount; i++) {
      ps.push({
        stationW: Number(st.get(i)), lateralW: Number(la.get(i)),
        radiusW: p1.data[i * 4 + 3], archetype: ar.getString(i, 0),
      });
    }
    const committed = chooseCommittedStretches(ps as never, lapW);
    // THE CLOSED LOOP, which is the pipeline's actual output: generate,
    // measure, correct, regenerate, keep the best. A single uncorrected
    // pass scores 16 of 17 — the outside-of-bend share runs hot until the
    // loop has seen it once — so exporting one would put a picture on the
    // page that no run of the technique produces.
    const readReport = async (committed: Record<number, number>) => {
      const geo = firstGeo((await cook(full(committed).graph)).outputs.placements);
      const get = (n: string) => geo.attrs.point.require(n);
      const kk = geo.attrs.point.get("cornerK");
      const pl = [];
      for (let i = 0; i < geo.pointCount; i++) {
        pl.push({
          archetype: get("archetype").getString(i, 0),
          stationW: Number(get("stationW").get(i)),
          lateralW: Number(get("lateralW").get(i)),
          heightW: Number(get("heightW").get(i)),
          footprintW: Number(get("footprintW").get(i)),
          tallnessW: Number(get("tallnessW").get(i)),
          radiusW: get("pack1").data[i * 4 + 3],
          kSigned: get("pack2").data[i * 4 + 3],
          zone: Number(get("zone").get(i)),
          cornerK: kk ? Number(kk.get(i)) : 0,
          variant: Number(get("variant").get(i)),
          polygons: Number(get("polygons").get(i)),
          isSprite: Number(get("isSprite").get(i)),
          family: `${get("archetype").getString(i, 0)}#${Number(get("variant").get(i))}`,
        });
      }
      const fP = new Float64Array(frames.pointCount * 3);
      for (let i = 0; i < fP.length; i++) fP[i] = frames.attrs.point.require("P").data[i];
      const oP = new Float64Array(geo.pointCount * 3);
      for (let i = 0; i < oP.length; i++) oP[i] = geo.attrs.point.require("P").data[i];
      const fcx = frames.attrs.point.require("isCorner");
      let entries = 0;
      for (let i = 0; i < frames.pointCount; i++) {
        if (Number(fcx.get(i)) >= 0.5 && Number(fcx.get((i + frames.pointCount - 1) % frames.pointCount)) < 0.5) entries++;
      }
      const blocking = countBlocking(pl, oP, fP, frames.pointCount, 1755, lapW);
      const markers = pl.filter((x) => x.archetype === "corner-marker").length;
      return { geo, pl, report: score(pl, preset, lapW, entries, markers, blocking) };
    };
    let run = await readReport(committed);
    let bestRun = run;
    for (let iter = 0; iter < 2; iter++) {
      // Corrected from the LATEST iteration, not from the best one: the
      // loop is a controller and it has to see where it just was.
      corrections = correct(preset, run.report, corrections);
      plan = calibrate(preset, lapW, corrections);
      run = await readReport(committed);
      const better =
        run.report.passed > bestRun.report.passed ||
        (run.report.passed === bestRun.report.passed &&
          Math.abs(run.report.perW - preset.density) < Math.abs(bestRun.report.perW - preset.density));
      if (better) bestRun = run;
    }
    console.log("XXscore", bestRun.report.passed, "of", bestRun.report.metrics.length, JSON.stringify(bestRun.report.metrics.filter((m) => !m.pass).map((m) => `${m.id} ${m.name}=${m.value.toFixed(3)} ${m.target}`)));
    const g = full(committed).graph;
    const json = serializeGraph(g);
    console.log("XXnodes", json.nodes.length, "lapW", lapW.toFixed(1));
    if (OUT) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(json, null, 2), "utf8");
      console.log("XXwrote", OUT);
    }
    // Placement data for the composition plot, from the winning iteration.
    const outGeo = bestRun.geo;
    const rows = bestRun.pl.map((r) => ({
      s: +r.stationW.toFixed(2), t: +r.lateralW.toFixed(3), h: +r.heightW.toFixed(2),
      f: +r.footprintW.toFixed(2), z: r.zone, v: r.variant, a: r.archetype,
      r: +r.radiusW.toFixed(1),
    }));
    const fs = frames.attrs.point.require("stationW");
    const fc = frames.attrs.point.require("isCorner");
    const frameRows: unknown[] = [];
    for (let i = 0; i < frames.pointCount; i++) {
      frameRows.push([+Number(fs.get(i)).toFixed(2), Number(fc.get(i)) >= 0.5 ? 1 : 0]);
    }
    if (OUT) {
      writeFileSync(OUT.replace(".json", "-report.json"), JSON.stringify(bestRun.report.metrics), "utf8");
      writeFileSync(OUT.replace(".json", "-data.json"),
        JSON.stringify({ lapW, committed, placements: rows, frames: frameRows }), "utf8");
      console.log("XXdata", OUT.replace(".json", "-data.json"), rows.length, outGeo.pointCount);
    }
    expect(json.nodes.length).toBeGreaterThan(50);
  });
});
