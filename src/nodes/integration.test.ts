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
import { firstGeo, snapshotGeometry } from "./nodes.testsupport.js";

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

/**
 * The seed box and a frozen noise. A serialized field expression bakes
 * its numbers, so `opts.seed` is a LITERAL and moving the graph's seed
 * re-rolls every scatter and jitter while leaving the noise exactly
 * where it was. `opts.seed` holds an integer or the tagged
 * `{"from":"node"}` form and no other spec; `opts.position` is an
 * ordinary argument position and holds any — so `{"fn":"nodeSeed"}`
 * folded into the sample position is what closes it for a noise still
 * carrying a literal.
 *
 * Both halves are cooked here, because the gap is only visible against
 * its control: the same graph written without the fold has to stay
 * still, or the "fixed" one proves nothing.
 */
function seedableNoiseGraph(seed: number, opts: { fold: boolean }): Graph {
  const g = new Graph(seed);
  const grid = g.add(pointGrid, { countX: 12, countY: 1, countZ: 12, spacing: [1, 1, 1] }, "grid");
  // Scaled down hard: a node seed is a full uint32, and adding one to a
  // position raw would push the sample point past the range where an f32
  // still resolves a lattice cell. 1e-6 lands the offset in [0, 4295],
  // and the lattice period here is 1/0.06 ≈ 17 units — so a typical seed
  // walks a couple of hundred cells from the origin, and two seeds land
  // that far from each other.
  const off = (k: number) => ({
    fn: "mul" as const,
    args: [{ fn: "nodeSeed" }, k],
  });
  const position = opts.fold
    ? {
        fn: "add",
        args: [{ fn: "position" }, { fn: "vec", args: [off(1e-6), 0, off(3.1e-6)] }],
      }
    : { fn: "position" };
  const h = g.add(
    setAttribute,
    {
      name: "h",
      value: fieldFromJson({
        fn: "perlinNoise",
        opts: { seed: 5, frequency: 0.06, normalized: true, position },
      }),
    },
    "h",
  );
  g.connect(grid, "out", h, "in");
  g.output(h, "out", "pts");
  return g;
}

/** The `h` column, trimmed to the live count — storage is capacity-backed. */
const heights = (result: Awaited<ReturnType<typeof cook>>): number[] => {
  const geo = firstGeo(result.outputs.pts);
  return Array.from(geo.attrs.point.require("h").data.subarray(0, geo.pointCount));
};

describe("nodeSeed: a saved noise that moves with the graph seed", () => {
  it("a literal noise seed is deaf to the graph seed — the gap", async () => {
    const a = heights(await cook(seedableNoiseGraph(1, { fold: false })));
    const b = heights(await cook(seedableNoiseGraph(2, { fold: false })));
    expect(a).toEqual(b);
  });

  it("folding nodeSeed into the sample position makes it move", async () => {
    const a = heights(await cook(seedableNoiseGraph(1, { fold: true })));
    const b = heights(await cook(seedableNoiseGraph(2, { fold: true })));
    expect(a.length).toBe(144);
    expect(a).not.toEqual(b);
    // Moved, not merely perturbed: an offset of thousands of lattice
    // cells decorrelates, so most lanes differ by a visible amount
    // rather than by a rounding step.
    const moved = a.filter((v, i) => Math.abs(v - b[i]) > 0.05).length;
    expect(moved).toBeGreaterThan(100);
  });

  it("is deterministic and memoized: same seed same bytes, setSeed recooks", async () => {
    const g = seedableNoiseGraph(7, { fold: true });
    const first = await cook(g);
    const again = await cook(g);
    expect(again.stats.cooked).toBe(0);
    expect(heights(again)).toEqual(heights(first));
    // The seed is deliberately NOT in `Field.key` — it arrives at
    // evaluation, while the key is fixed at construction. Invalidation
    // is exact anyway because the executor's node memo key carries the
    // node seed verbatim, so this recooks with no help from the field.
    g.setSeed(8);
    const moved = await cook(g);
    expect(moved.stats.cooked).toBe(2);
    expect(heights(moved)).not.toEqual(heights(first));
    // ...and coming back is not a new answer.
    g.setSeed(7);
    expect(heights(await cook(g))).toEqual(heights(first));
  });

  it("a fully partitioned cook gives the same bytes as a straight-through one", async () => {
    // The node seed cannot move mid-cook — `graph.seed` is read once per
    // node, and a budget only decides WHEN a node runs, never with what.
    // Asserted rather than argued, because it is the invariant a field
    // that reads the context would be the first thing to break.
    const straight = heights(await cook(seedableNoiseGraph(3, { fold: true })));
    const yielded = heights(
      await cook(seedableNoiseGraph(3, { fold: true }), { budgetMs: 0 }),
    );
    expect(yielded).toEqual(straight);
  });
});
