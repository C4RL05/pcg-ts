/**
 * Level definitions for the GPU-world harness.
 *
 * The whole point is that the fine level's chain is device-resident end
 * to end, so every node after the scatter is a fusable run member:
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
 *   WGSL kernel and handed to the renderer as a GPU buffer.
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

/** Tallest instance half-extent, folded into each cell's bounding sphere. */
export const MAX_INSTANCE_RADIUS = 3.2;

/** Per-axis scale (tuple 3) from two noise bands plus a per-point hash. */
function scaleSpec(seed: number): FieldSpec {
  const band = (s: number, frequency: number): FieldSpec => ({
    fn: "remap",
    args: [
      { fn: "perlinNoise", opts: { seed: s, frequency, normalized: true } },
      0,
      1,
      0.35,
      1.45,
    ],
  });
  const jitter: FieldSpec = {
    fn: "remap",
    args: [{ fn: "randomField", key: "size" }, 0, 1, 0.6, 1.3],
  };
  const wide: FieldSpec = { fn: "mul", args: [band(seed, 0.017), jitter] };
  const tall: FieldSpec = {
    fn: "mul",
    args: [{ fn: "mul", args: [band(hashCombine(seed, 5), 0.031), jitter] }, 1.9],
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
 * instances of a single asset (single-asset is the v0.7 resident
 * spawner's supported shape; `assetAttr` falls back to the CPU path).
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
