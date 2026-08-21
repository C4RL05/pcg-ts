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
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// By PACKAGE NAME rather than through `../src` — see the note in
// `trackDressing.test.ts`.
import { cook, serializeGraph } from "pcg-ts";
import { buildTrackDressingGraph } from "../demos/racetrack/dressing.js";
import {
  calibrate,
  chooseCommittedStretches,
  correct,
  noCorrections,
} from "../demos/racetrack/calibrate.js";
import { TRACK, better, col, requireGeo, scoreCook } from "../demos/racetrack/read.js";
import { PRESETS } from "../demos/racetrack/kit.js";

const OUT = process.env.TRACK_OUT ?? "";

describe("export", () => {
  it("serializes", async () => {
    const preset = PRESETS.lush;
    const base = { ...TRACK, preset, seed: 21 };
    const probe = buildTrackDressingGraph({
      ...base,
      countByProfile: { flat: 1, built: 1, clustered: 1 },
      weightByArchetype: {},
      legibility: false,
      coverage: false,
      sightline: false,
      landmarks: false,
      balance: false,
    });
    const frames = requireGeo((await cook(probe.graph)).outputs.frames);
    const lapLength = frames.attrs.primitive.require("lapLen").get(0) as number;
    const lapW = lapLength / TRACK.halfWidth;

    let corrections = noCorrections();
    let plan = calibrate(preset, lapW, corrections);
    const build = (committed: Record<number, number>) =>
      buildTrackDressingGraph({
        ...base,
        countByProfile: plan.countByProfile,
        weightByArchetype: plan.weightByArchetype,
        variantsByArchetype: plan.variantsByArchetype,
        polygonScale: plan.polygonScale,
        committedStretches: committed,
        spawn: true,
      });

    // Which stretches can carry a lean is a fact about the dressed lap, so
    // it takes a cook with the balance pass switched off.
    const dry = await run({});
    const committed = chooseCommittedStretches(dry.placements, lapW);

    // THE CLOSED LOOP, which is the pipeline's actual output: generate,
    // measure, correct, regenerate, keep the best. A single uncorrected
    // pass scores 16 of 17 — the outside-of-bend share runs hot until the
    // loop has seen it once — so exporting one would put a picture on the
    // page that no run of the technique produces.
    let current = await run(committed);
    let best = current;
    for (let iter = 0; iter < 2; iter++) {
      // Corrected from the LATEST iteration, not from the best one: the
      // loop is a controller and it has to see where it just was.
      corrections = correct(preset, current.report, corrections);
      plan = calibrate(preset, lapW, corrections);
      current = await run(committed);
      if (better(current.report, best.report, preset)) best = current;
    }
    expect(best.report.passed).toBe(18);

    async function run(committedStretches: Record<number, number>) {
      const graph = build(committedStretches).graph;
      const out = await cook(graph);
      return { ...scoreCook(out, preset, lapW), graph, out };
    }

    // The graph that produced the winning iteration, not a fresh build of
    // the last plan — serializing one while reporting the other's metrics
    // is how a page ends up describing a run nobody made.
    const json = serializeGraph(best.graph);
    expect(json.nodes.length).toBeGreaterThan(50);

    if (!OUT) return;
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(json, null, 2), "utf8");
    writeFileSync(
      OUT.replace(".json", "-report.json"),
      JSON.stringify(best.report.metrics),
      "utf8",
    );
    const stationW = col(best.frames, "stationW");
    const isCorner = col(best.frames, "isCorner");
    writeFileSync(
      OUT.replace(".json", "-data.json"),
      JSON.stringify({
        lapW,
        committed,
        placements: best.placements.map((p) => ({
          s: +p.stationW.toFixed(2),
          t: +p.lateralW.toFixed(3),
          h: +p.heightW.toFixed(2),
          f: +p.footprintW.toFixed(2),
          z: p.zone,
          v: p.variant,
          a: p.archetype,
          r: +p.radiusW.toFixed(1),
        })),
        frames: Array.from(stationW, (s, i) => [+s.toFixed(2), isCorner[i] >= 0.5 ? 1 : 0]),
      }),
      "utf8",
    );
  });
});
