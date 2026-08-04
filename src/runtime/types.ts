/**
 * Hierarchical runtime model: grid levels, cells, and the bind contract.
 *
 * Cells are 2D on the XZ plane: a bounded level partitions the plane into
 * square cells of `cellSize` world units, and a cell covers
 * `[cx*size, (cx+1)*size) x [cz*size, (cz+1)*size)` in X and Z while being
 * unbounded in Y. Fully 3D (Y-partitioned) cells are future work.
 */
import type { CookResult, Graph } from "../graph/index.js";

/** Integer grid coordinate of a cell on the XZ plane: `[cx, cz]`. */
export type CellCoord = readonly [cx: number, cz: number];

/** Declared outputs of one cooked cell, keyed by output name. */
export type CellOutputs = CookResult["outputs"];

/**
 * The containing, already-cooked cell of the level above (levels are
 * ordered coarse to fine). Its outputs alias live cook caches — treat
 * them as immutable, exactly like a {@link CookResult}.
 */
export interface ParentCellRef {
  /** Coordinate of the parent cell (`[0, 0]` for an unbounded parent). */
  readonly coord: CellCoord;
  /** The parent cell's declared outputs. */
  readonly outputs: CellOutputs;
}

/**
 * Everything a level's {@link LevelDef.bind} callback may derive per-cell
 * params from. For determinism, cell content must be a pure function of
 * this context (plus the level graph's structure and params): bind must
 * not read clocks, `Math.random`, viewpoint position, or any other state.
 */
export interface CellContext {
  /** Index of the level in `WorldOptions.levels` (0 = coarsest). */
  readonly levelIndex: number;
  /** Name of the level. */
  readonly levelName: string;
  /** Integer cell coordinate (`[0, 0]` for an unbounded level). */
  readonly coord: CellCoord;
  /** World-space cell rectangle minimum `[x, z]` (-Infinity when unbounded). */
  readonly min: readonly [number, number];
  /** World-space cell rectangle maximum `[x, z]` (+Infinity when unbounded). */
  readonly max: readonly [number, number];
  /**
   * Per-cell seed (u32): `hashCombine(worldSeed, levelIndex, cx, cz)`, or
   * `hashCombine(worldSeed, levelIndex)` for an unbounded level. Bind must
   * wire it into every stochastic node (e.g. its `seed` param) so
   * different cells produce different, reproducible content.
   */
  readonly seed: number;
  /**
   * The containing cell of the level above, when one exists. Present for
   * every level except the first: a cell below the top level only cooks
   * after its parent cell has cooked.
   */
  readonly parent?: ParentCellRef;
}

/**
 * One level of the hierarchical runtime: a graph cooked once per cell.
 *
 * Levels are ordered coarse to fine: at most one `unbounded` level is
 * allowed and it must come first, and bounded `cellSize`s must strictly
 * decrease. Each level's `generationRadius` should be at least as large
 * as every finer level's, so a wanted cell's parent is also wanted —
 * a cell whose parent cell was never cooked stays pending.
 */
export interface LevelDef {
  /** Unique level name, used in stats, callbacks, and accessors. */
  readonly name: string;
  /** Cell edge length in world units, or `"unbounded"` (one global cell). */
  readonly cellSize: number | "unbounded";
  /**
   * Cells generate when their center enters this radius (world units)
   * around the viewpoint's XZ position. Ignored for an unbounded level.
   */
  readonly generationRadius: number;
  /**
   * Hysteresis: a generated cell is kept until its center exits this
   * radius. Defaults to `generationRadius * 1.25`; must be >=
   * `generationRadius`. Ignored for an unbounded level.
   */
  readonly retainRadius?: number;
  /**
   * The graph cooked for each cell of this level. It is shared across the
   * level's cells: before each cell cook the runtime calls {@link bind},
   * which mutates per-cell params, then cooks the graph and stores its
   * declared outputs. Do not edit the graph while a `World.update` is in
   * flight; edits between updates are detected and recook the level.
   */
  readonly graph: Graph;
  /**
   * Wire one cell's context into the graph before it cooks — the only
   * channel through which cell data enters the graph. Typical bindings:
   * `graph.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]])`,
   * `graph.setParam(scatter, "seed", ctx.seed)`, or injecting
   * `ctx.parent.outputs` through a `dataInput` node's `items` param.
   *
   * Determinism contract: set params derived only from `ctx` and static
   * configuration, and fold `ctx.seed` into every stochastic node's seed
   * param (vary it per node with `hashCombine(ctx.seed, n)`). Cell content
   * then depends only on (world seed, level index, coord, graph
   * structure+params, parent cell content) — never on cook order,
   * viewpoint path, or eviction history.
   */
  bind(graph: Graph, ctx: CellContext): void;
}
