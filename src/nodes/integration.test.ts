import { describe, expect, it } from "vitest";
import { Graph, cook } from "../graph/index.js";
import {
  copyToPoints,
  fieldFromJson,
  filterByDensity,
  jitterPoints,
  mergePoints,
  pointGrid,
  pointLine,
  selfPrune,
  setAttribute,
  transformPoints,
  volumeSample,
} from "./index.js";
import { firstGeo, snapshotGeometry } from "./testSupport.js";

/**
 * A whole-library pipeline (9 nodes): grid -> density noise -> filter ->
 * jitter -> prune -> transform as scatter targets; a small line cloud
 * copied onto them; merged with a jittered volume grid.
 */
function buildPipeline(seed: number): Graph {
  const g = new Graph(seed);
  const grid = g.add(pointGrid, { countX: 20, countY: 1, countZ: 20, spacing: [0.5, 1, 0.5] }, "grid");
  const den = g.add(
    setAttribute,
    {
      name: "density",
      value: fieldFromJson({
        fn: "remap",
        args: [
          { fn: "fbm", base: "simplexNoise", opts: { seed: 9, frequency: 0.4, octaves: 3 } },
          -1.5,
          1.5,
          0,
          1,
        ],
      }),
    },
    "den",
  );
  const filter = g.add(filterByDensity, { mode: "probabilistic" }, "filter");
  const jit = g.add(jitterPoints, { amount: [0.2, 0, 0.2] }, "jit");
  const prune = g.add(selfPrune, { minDistance: 0.45 }, "prune");
  const xf = g.add(transformPoints, { translate: [0, 1, 0] }, "xf");
  const template = g.add(pointLine, { count: 3, start: [0, 0, 0], end: [0, 0.4, 0] }, "template");
  const copies = g.add(copyToPoints, {}, "copies");
  const vol = g.add(
    volumeSample,
    { boundsMin: [0, 0, 0], boundsMax: [3, 1, 3], cellSize: 1, jitter: 0.8 },
    "vol",
  );
  const merged = g.add(mergePoints, {}, "merged");
  g.connect(grid, "out", den, "in");
  g.connect(den, "out", filter, "in");
  g.connect(filter, "out", jit, "in");
  g.connect(jit, "out", prune, "in");
  g.connect(prune, "out", xf, "in");
  g.connect(template, "out", copies, "source");
  g.connect(xf, "out", copies, "target");
  g.connect(copies, "out", merged, "in");
  g.connect(vol, "out", merged, "in");
  g.output(merged, "out", "world");
  return g;
}

describe("whole-library determinism", () => {
  it("cooks the same pipeline byte-identically from fresh graphs", async () => {
    const a = await cook(buildPipeline(2024));
    const b = await cook(buildPipeline(2024));
    const geoA = firstGeo(a.outputs.world);
    const geoB = firstGeo(b.outputs.world);
    expect(geoA.pointCount).toBeGreaterThan(20);
    expect(snapshotGeometry(geoA)).toEqual(snapshotGeometry(geoB));
    expect(a.stats.cooked).toBe(10);
  });

  it("re-cooking the same graph serves caches and identical data", async () => {
    const g = buildPipeline(555);
    const first = await cook(g);
    const again = await cook(g);
    expect(again.stats.cooked).toBe(0);
    expect(again.stats.cached).toBe(10);
    expect(snapshotGeometry(firstGeo(again.outputs.world))).toEqual(
      snapshotGeometry(firstGeo(first.outputs.world)),
    );
  });

  it("a different graph seed produces different output", async () => {
    const a = await cook(buildPipeline(1));
    const b = await cook(buildPipeline(2));
    expect(snapshotGeometry(firstGeo(a.outputs.world))).not.toEqual(
      snapshotGeometry(firstGeo(b.outputs.world)),
    );
  });

  it("copy counts multiply through the pipeline", async () => {
    const g = buildPipeline(77);
    const result = await cook(g);
    const world = firstGeo(result.outputs.world);
    // merged = copies (3 * pruned) + volume (9 cells).
    const pruned = firstGeo((await cook(g)).outputs.world); // cached; same object
    expect(pruned.pointCount).toBe(world.pointCount);
    expect((world.pointCount - 9) % 3).toBe(0);
  });
});
