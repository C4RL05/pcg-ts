/**
 * Level definitions for the GPU world.
 *
 * The point of the shape below is that the fine level's chain can be
 * device-resident end to end, so every node after the scatter is a
 * fusable run member:
 *
 *   pointScatterInBounds → setAttribute("scale") → orientAlongVector
 *                        → spawnInstances            (terminal)
 *
 * - `pointScatterInBounds` changes the point count, so it is never a run
 *   member — the run is exactly the three nodes after it.
 * - Both Field params are built with `fieldFromJson`, which is the
 *   precondition for `pcg-ts/gpu` to lower them into the run's kernels.
 *   A code-authored field (`remap(randomField(...))`) carries no spec and
 *   would drop the node — and everything after it — off the run.
 * - `spawnInstances` closes the run as a device-resident terminal, so P,
 *   rot and scale are never read back: the 4x4 matrices are composed in a
 *   WGSL kernel and handed to the renderer as a GPU buffer. Build the
 *   evaluator without `deviceInstances` and the very same graph ends on
 *   the CPU instead — that is the comparison the page's toggle makes.
 *
 * Determinism contract (see LevelDef.bind): every stochastic node's seed
 * derives from ctx.seed, and the graph seed is re-derived per cell.
 */
import {
  Graph,
  fieldFromJson,
  hashCombine,
  orientAlongVector,
  pointScatterInBounds,
  setAttribute,
  spawnInstances,
  type FieldSpec,
  type LevelDef,
} from "pcg-ts";

/** Fine level cell edge length in world units. */
export const FINE_CELL = 24;

// -- scale limits ----------------------------------------------------------
//
// The remap targets below are the only thing that sets how large an
// instance can get, so they are named rather than inlined: the cell
// bounding spheres in main.ts are derived from them, and a sphere that
// is too small culls geometry that is on screen.

/** `remap` target of each noise band: `perlinNoise(normalized)` → this. */
const BAND_MIN = 0.35;
const BAND_MAX = 1.45;
/** `remap` target of the per-point hash: `randomField` → this. */
const JITTER_MIN = 0.6;
const JITTER_MAX = 1.3;
/** How much taller than wide a spire may get. */
const TALL_GAIN = 1.9;

/**
 * Largest per-axis scale `scaleSpec` can produce. Both sources are
 * normalized to [0, 1] before the remap, so the product of the two
 * upper targets is the bound (`wide = band * jitter`,
 * `tall = band * jitter * TALL_GAIN`). Consumers should round the
 * derived extent up — a normalized noise band can overshoot 1 by a
 * hair, and over-covering a bounding sphere is the harmless direction.
 */
export const MAX_SCALE_WIDE = BAND_MAX * JITTER_MAX; // 1.885
export const MAX_SCALE_TALL = MAX_SCALE_WIDE * TALL_GAIN; // 3.5815

/** Per-axis scale (tuple 3) from two noise bands plus a per-point hash. */
function scaleSpec(seed: number): FieldSpec {
  const band = (s: number, frequency: number): FieldSpec => ({
    fn: "remap",
    args: [
      { fn: "perlinNoise", opts: { seed: s, frequency, normalized: true } },
      0,
      1,
      BAND_MIN,
      BAND_MAX,
    ],
  });
  const jitter: FieldSpec = {
    fn: "remap",
    args: [{ fn: "randomField", key: "size" }, 0, 1, JITTER_MIN, JITTER_MAX],
  };
  const wide: FieldSpec = { fn: "mul", args: [band(seed, 0.017), jitter] };
  const tall: FieldSpec = {
    fn: "mul",
    args: [{ fn: "mul", args: [band(hashCombine(seed, 5), 0.031), jitter] }, TALL_GAIN],
  };
  return { fn: "vec", args: [wide, tall, wide] };
}

/**
 * Lean direction (tuple 3): mostly up, pushed around by a low-frequency
 * curl-ish pair of noise bands so whole regions lean together.
 */
function leanSpec(seed: number): FieldSpec {
  const tilt = (s: number): FieldSpec => ({
    fn: "remap",
    args: [
      { fn: "perlinNoise", opts: { seed: s, frequency: 0.011, normalized: true } },
      0,
      1,
      -0.55,
      0.55,
    ],
  });
  return { fn: "vec", args: [tilt(seed), 1, tilt(hashCombine(seed, 17))] };
}

/**
 * Fine bounded level: one device-resident run per cell, `count`
 * instances of a single asset.
 *
 * Single-asset is this level's choice, not the spawner's limit. Since
 * v0.8 a spawn driven by `assetAttr` is device-resident too — the host
 * plans the grouping from the (necessarily host-resident) string column,
 * uploads a permutation, and the device composes one buffer and one
 * dispatch per asset, so a cell then arrives as N device batches instead
 * of one. `graphs/examples-forest.json` is that shape. A constant `assetId` keeps
 * this level's per-cell accounting and its single bounding sphere as
 * simple as the rest of the page.
 */
export function makeSpireLevel(
  worldSeed: number,
  generationRadius: number,
  count: number,
): LevelDef {
  const graph = new Graph();
  const scatter = graph.add(pointScatterInBounds, { count });
  const size = graph.add(setAttribute, {
    name: "scale",
    tupleSize: 3,
    value: fieldFromJson(scaleSpec(hashCombine(worldSeed, 101))),
  });
  const lean = graph.add(orientAlongVector, {
    direction: fieldFromJson(leanSpec(hashCombine(worldSeed, 202))),
    axis: "+y",
  });
  const spawn = graph.add(spawnInstances, { assetId: "spire" });
  graph.connect(scatter, "out", size, "in");
  graph.connect(size, "out", lean, "in");
  graph.connect(lean, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");
  return {
    name: "spires",
    cellSize: FINE_CELL,
    generationRadius,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
      g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      g.setParam(scatter, "seed", ctx.seed);
      g.setSeed(hashCombine(ctx.seed, 3));
    },
  };
}
