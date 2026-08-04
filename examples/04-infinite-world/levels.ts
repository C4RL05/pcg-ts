/**
 * Level definitions for the infinite-world example: renderer-free, so
 * they can also run headless (the graphs only produce instance batches).
 *
 * Determinism contract (see LevelDef.bind): every stochastic node's seed
 * param is derived from ctx.seed, and the graph seed itself is re-derived
 * per cell so field-level randomness (randomField in setAttribute) varies
 * with the world too. Cell content is a pure function of (world seed,
 * level, cell coord).
 */
import {
  Graph,
  fbm,
  filterByDensity,
  hashCombine,
  mul,
  perlinNoise,
  pointScatterInBounds,
  randomField,
  remap,
  setAttribute,
  spawnInstances,
  vec,
  type LevelDef,
} from "pcg-ts";

/** Fine level cell edge length in world units. */
export const FINE_CELL = 20;

/** Coarse unbounded level: sparse mega-rocks over a huge fixed area. */
export function makeLandmarkLevel(): LevelDef {
  const graph = new Graph();
  const scatter = graph.add(pointScatterInBounds, {
    count: 170,
    boundsMin: [-800, 0, -800],
    boundsMax: [800, 0, 800],
  });
  const size = graph.add(setAttribute, {
    name: "scale",
    tupleSize: 3,
    value: (() => {
      const s = remap(randomField("mega"), 0, 1, 5, 13);
      return vec(s, mul(s, 1.6), s);
    })(),
  });
  const spawn = graph.add(spawnInstances, { assetId: "megarock" });
  graph.connect(scatter, "out", size, "in");
  graph.connect(size, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");
  return {
    name: "landmarks",
    cellSize: "unbounded",
    generationRadius: Infinity,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "seed", ctx.seed);
      // randomField in the scale attr draws from node seeds, which derive
      // from the graph seed — fold ctx.seed in so it varies with the world.
      g.setSeed(hashCombine(ctx.seed, 9));
    },
  };
}

/** Fine bounded level: dense small rocks, density from shared noise. */
export function makeRockLevel(worldSeed: number, generationRadius: number): LevelDef {
  const graph = new Graph();
  const scatter = graph.add(pointScatterInBounds, { count: 220 });
  // One world-space noise field shared by every cell (its seed derives
  // from the world seed, not the cell), so density is seamless across
  // cell borders.
  const density = graph.add(setAttribute, {
    name: "density",
    tupleSize: 1,
    value: remap(
      fbm(perlinNoise, { seed: hashCombine(worldSeed, 777), frequency: 0.02, octaves: 3 }),
      -1,
      1,
      0,
      1,
    ),
  });
  const filter = graph.add(filterByDensity, { mode: "probabilistic" });
  const size = graph.add(setAttribute, {
    name: "scale",
    tupleSize: 3,
    value: (() => {
      const s = remap(randomField("rock"), 0, 1, 0.35, 1.15);
      return vec(s, s, s);
    })(),
  });
  const spawn = graph.add(spawnInstances, { assetId: "rock" });
  graph.connect(scatter, "out", density, "in");
  graph.connect(density, "out", filter, "in");
  graph.connect(filter, "out", size, "in");
  graph.connect(size, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");
  return {
    name: "rocks",
    cellSize: FINE_CELL,
    generationRadius,
    graph,
    bind(g, ctx) {
      g.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
      g.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
      g.setParam(scatter, "seed", ctx.seed);
      g.setParam(filter, "seed", hashCombine(ctx.seed, 1));
      g.setSeed(hashCombine(ctx.seed, 2));
    },
  };
}
