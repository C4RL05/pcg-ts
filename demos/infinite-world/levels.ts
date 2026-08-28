/**
 * Level definitions for the infinite-world example: renderer-free, so
 * they can also run headless (the graphs only produce instance batches).
 *
 * The fine level is built on `pointScatterInWorld`, the world-anchored
 * source. Its points are a pure function of (`seed` param, lattice mode,
 * its own cellSize) and the lattice cell they fall in — never of the
 * query window, and deliberately NOT of the node or graph seed, so that
 * a per-cell `graph.setSeed` in `bind` cannot silently de-anchor them.
 * Here `seed` is bound from `ctx.worldSeed`, which is cell-invariant. So:
 *
 * - the same world position always yields the same rock, whichever cell
 *   asks for it and however the world is partitioned;
 * - a HALO is just a wider query. Each rock is SIZED by how crowded its
 *   surroundings are, which is a measurement that does not stop at a cell
 *   border. So the level asks for its cell grown by {@link HALO} on every
 *   side, measures over that, and only then clips back to the cell. Both
 *   sides of a boundary derive the same points in the overlap and measure
 *   the same neighbourhood, so a rock is the same size whichever cell
 *   produced it. Turn the halo off and every border grows a visible band
 *   of undersized rocks — the neighbourhood ran out of world.
 *
 * Determinism contract (see LevelDef.bind): every stochastic node's seed
 * is derived from the cell context. Which field of the context depends on
 * what the node promises:
 *
 * - `ctx.worldSeed` (cell-INVARIANT) for the anchored source and for
 *   everything downstream that must agree with a neighbour about a shared
 *   point. `filterByDensity`, `pointNeighborhood` and `randomField` key
 *   their randomness and their orderings on point IDENTITY (position bits
 *   plus the per-point `seed` attribute), not on array index, so with a
 *   cell-invariant salt a rock survives, is measured and is sized
 *   identically in every cell that derives it — however many points were
 *   filtered out upstream, and in whatever order they arrived.
 * - `ctx.seed` (per-cell) only where content is meant to differ per cell.
 *
 * NOTHING here calls `graph.setSeed` in bind. A per-cell whole-graph
 * reseed reaches every node — including the anchored source, whose
 * positions depend on its node seed — and silently turns it back into a
 * per-cell scatter: still deterministic, but a widened query stops
 * reproducing a neighbour's points, so halos and seams stop agreeing.
 * Per-node `seed` params (`setAttribute` has one for exactly this) say
 * which nodes vary per cell and which do not.
 */
import {
  Graph,
  attribute,
  clamp,
  fbm,
  filterByBounds,
  filterByDensity,
  hashCombine,
  mul,
  perlinNoise,
  pointNeighborhood,
  pointScatterInBounds,
  pointScatterInWorld,
  randomField,
  remap,
  setAttribute,
  spawnInstances,
  vec,
  xzCell,
  type LevelDef,
  type NodeHandle,
} from "pcg-ts";

/** Default fine-level cell edge length in world units (the page can change it). */
export const DEFAULT_FINE_CELL = 20;

/**
 * The scatter's OWN lattice spacing, in world units — deliberately not a
 * divisor of any cell size the page offers. It controls clumping, not
 * population, and tying it to a World cellSize would make the content a
 * function of the runtime's partitioning, which is the whole property
 * this page exists to show.
 */
export const SCATTER_CELL = 7;

/** Candidate rocks per square world unit, before the density field thins them. */
const SCATTER_DENSITY = 0.35;

/**
 * Radius, in world units, over which each rock counts its neighbours —
 * the measurement its size comes from.
 */
export const NEIGHBOR_RADIUS = 4;

/**
 * How far outside its own cell a cell queries, in world units. Exactly
 * {@link NEIGHBOR_RADIUS} is the whole requirement and not a safety
 * margin: a neighbour count depends on the points within that radius and
 * on nothing else, so a window grown by it holds every point that could
 * change an answer inside the cell. (A greedy op — `selfPrune`, whose
 * verdict for one point depends on verdicts for others — would have no
 * such finite width; that is why the size here is measured rather than
 * competed for.)
 */
export const HALO = NEIGHBOR_RADIUS;

/**
 * Seed of the terrain function — the large-scale field that decides where
 * rocks are dense and where they are bare. A noise field is a pure
 * function of world position and is therefore anchored by construction;
 * its seed lives inside the FIELD spec rather than in a node param, so it
 * is authored once here instead of being bound per cell. That is also the
 * only correct thing to do: it has to be identical in every cell.
 */
const TERRAIN_SEED = 777;

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
      // One global cell, so ctx.seed === ctx.levelSeed here: there are no
      // coordinates to fold in. This level is NOT world-anchored — an
      // unbounded cell's window is infinite, and a lattice source needs a
      // bounded window to know which cells to visit — so its landmarks
      // stop at the box above.
      g.setParam(scatter, "seed", ctx.seed);
      // randomField in the scale attr draws from the evaluation context's
      // seed; setAttribute's own `seed` param folds a value in per node,
      // which is what a whole-graph reseed used to do far too bluntly.
      g.setParam(size, "seed", hashCombine(ctx.seed, 9));
    },
  };
}

/** How the fine level's points are sourced. */
export interface RockLevelOptions {
  /** World cell edge length — the STREAMING partition, not the content's scale. */
  readonly cellSize: number;
  readonly generationRadius: number;
  /**
   * `true` (the default behaviour of this page) sources rocks from
   * `pointScatterInWorld`, anchored to world coordinates. `false` uses
   * the pre-anchoring `pointScatterInBounds` over the same window, whose
   * positions are a function OF the window — the comparison the page's
   * "world-anchored" switch runs.
   */
  readonly anchored: boolean;
  /**
   * Query the cell grown by {@link HALO} (`true`) or exactly the cell
   * (`false`). With it off, every neighbour count near a border is
   * measured against a world that stops at the border, and the page grows
   * a visible lattice of undersized rocks.
   */
  readonly halo: boolean;
}

/** The window params both sources share, so bind can treat them alike. */
interface WindowParams {
  boundsMin: readonly number[];
  boundsMax: readonly number[];
  seed: number;
}

/**
 * Fine bounded level: rocks over an anchored lattice, thinned by a
 * world-space density field and sized by a neighbourhood measured over a
 * halo.
 */
export function makeRockLevel(opts: RockLevelOptions): LevelDef {
  const { cellSize, generationRadius, anchored } = opts;
  const halo = opts.halo ? HALO : 0;
  const graph = new Graph();

  // The two sources, side by side. Only the anchored one promises that a
  // point is a function of its world position; the other one is here so
  // the page can show what that buys.
  const scatter: NodeHandle<WindowParams> = anchored
    ? graph.add(pointScatterInWorld, {
        density: SCATTER_DENSITY,
        cellSize: SCATTER_CELL,
        latticeMode: "xz",
        height: 0,
      })
    : graph.add(pointScatterInBounds, {
        // Match the anchored source's expected population over the same
        // (haloed) window, so the two modes differ in ANCHORING alone and
        // not in how many rocks they put down.
        count: Math.round(SCATTER_DENSITY * (cellSize + 2 * halo) ** 2),
      });

  // One world-space terrain field, sampled at each point's position. It
  // was already seamless before anchoring existed — noise is a function
  // of position — which is precisely why it could not make the SOURCE
  // seamless on its own.
  const density = graph.add(setAttribute, {
    name: "density",
    tupleSize: 1,
    value: remap(
      fbm(perlinNoise, { seed: TERRAIN_SEED, frequency: 0.02, octaves: 3 }),
      -1,
      1,
      0,
      1,
    ),
  });
  const thin = graph.add(filterByDensity, { mode: "probabilistic" });
  // The measurement that needs the halo. It runs on the WIDE cloud: a
  // rock one unit inside the border has most of its neighbourhood in the
  // cell next door, and the answer has to be the same on both sides.
  const crowding = graph.add(pointNeighborhood, {
    radius: NEIGHBOR_RADIUS,
    countAttr: "nbrCount",
  });
  // ... and only now is the halo thrown away. Bounds here are inclusive
  // on both faces, so a point landing EXACTLY on a shared face would be
  // kept twice; the lattice places points at hashed fractions of its own
  // cell, so that is a measure-zero case rather than a partition rule.
  const clip = graph.add(filterByBounds, { mode: "inside" });
  const size = graph.add(setAttribute, {
    name: "scale",
    tupleSize: 3,
    value: (() => {
      // Crowded rocks are boulders, lonely ones are pebbles — a size that
      // is a measurement of the surroundings rather than a private roll,
      // so it is only correct if the surroundings were fully in view.
      const crowd = remap(clamp(attribute("nbrCount"), 2, 16), 2, 16, 0.4, 1.35);
      const s = mul(crowd, remap(randomField("rock"), 0, 1, 0.85, 1.15));
      return vec(s, s, s);
    })(),
  });
  const spawn = graph.add(spawnInstances, { assetId: "rock" });
  graph.connect(scatter, "out", density, "in");
  graph.connect(density, "out", thin, "in");
  graph.connect(thin, "out", crowding, "in");
  graph.connect(crowding, "out", clip, "in");
  graph.connect(clip, "out", size, "in");
  graph.connect(size, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");

  return {
    name: "rocks",
    cellSize,
    generationRadius,
    graph,
    bind(g, ctx) {
      const { min, max } = xzCell(ctx);
      // The query WINDOW is the only thing that varies per cell in
      // anchored mode: the cell, grown by the halo.
      g.setParam(scatter, "boundsMin", [min[0] - halo, 0, min[1] - halo]);
      g.setParam(scatter, "boundsMax", [max[0] + halo, 0, max[1] + halo]);
      // Cell-invariant salt for the anchored source (worldSeed), per-cell
      // for the unanchored one — which is all ctx.seed was ever good for
      // here, and exactly what makes its points move when the window does.
      const salt = anchored ? ctx.worldSeed : ctx.seed;
      g.setParam(scatter, "seed", salt);
      g.setParam(thin, "seed", hashCombine(salt, 1));
      g.setParam(size, "seed", hashCombine(salt, 2));
      // The clip is the cell itself. Y is generous: every point sits at 0.
      g.setParam(clip, "boundsMin", [min[0], -1, min[1]]);
      g.setParam(clip, "boundsMax", [max[0], 1, max[1]]);
    },
  };
}
