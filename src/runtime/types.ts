/**
 * Hierarchical runtime model: grid levels, cells, and the bind contract.
 *
 * By default cells are 2D on the XZ plane: a bounded level partitions the
 * plane into square cells of `cellSize` world units, and a cell covers
 * `[cx*size, (cx+1)*size) x [cz*size, (cz+1)*size)` in X and Z while being
 * unbounded in Y. A level may opt into fully 3D cube cells with
 * `cellMode: "xyz"` (see {@link LevelDef.cellMode}), partitioning Y the
 * same way and addressing cells `[cx, cy, cz]`.
 */
import type { CookResult, Graph } from "../graph/index.js";

/** Integer grid coordinate of a 2D cell on the XZ plane: `[cx, cz]`. */
export type CellCoord2 = readonly [cx: number, cz: number];

/** Integer grid coordinate of a 3D cube cell: `[cx, cy, cz]`. */
export type CellCoord3 = readonly [cx: number, cy: number, cz: number];

/**
 * Integer grid coordinate of a cell: `[cx, cz]` for `"xz"` levels,
 * `[cx, cy, cz]` for `"xyz"` levels.
 */
export type CellCoord = CellCoord2 | CellCoord3;

/** Cell partitioning mode of a level; see {@link LevelDef.cellMode}. */
export type CellMode = "xz" | "xyz";

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

/** Fields shared by both cell-context shapes; see {@link CellContext}. */
export interface CellContextBase {
  /** Index of the level in `WorldOptions.levels` (0 = coarsest). */
  readonly levelIndex: number;
  /** Name of the level. */
  readonly levelName: string;
  /**
   * Per-cell seed (u32), hash-combined from the world seed, the level
   * index, and every cell coordinate:
   * `hashCombine(worldSeed, levelIndex, cx, cz)` for an `"xz"` cell,
   * `hashCombine(worldSeed, levelIndex, cx, cy, cz)` for an `"xyz"`
   * cell, and `hashCombine(worldSeed, levelIndex)` for an unbounded
   * level. Bind must wire it into every stochastic node (e.g. its `seed`
   * param) so different cells produce different, reproducible content.
   */
  readonly seed: number;
  /**
   * The containing cell of the level above, when one exists. Present for
   * every level except the first: a cell below the top level only cooks
   * after its parent cell has cooked.
   */
  readonly parent?: ParentCellRef;
}

/** Cell context of an `"xz"` (or unbounded) level; see {@link CellContext}. */
export interface CellContextXZ extends CellContextBase {
  /** Discriminant: this level uses 2D XZ cells. */
  readonly cellMode: "xz";
  /** Integer cell coordinate (`[0, 0]` for an unbounded level). */
  readonly coord: CellCoord2;
  /** World-space cell rectangle minimum `[x, z]` (-Infinity when unbounded). */
  readonly min: readonly [number, number];
  /** World-space cell rectangle maximum `[x, z]` (+Infinity when unbounded). */
  readonly max: readonly [number, number];
}

/** Cell context of an `"xyz"` level; see {@link CellContext}. */
export interface CellContextXYZ extends CellContextBase {
  /** Discriminant: this level uses 3D cube cells. */
  readonly cellMode: "xyz";
  /** Integer cell coordinate `[cx, cy, cz]`. */
  readonly coord: CellCoord3;
  /** World-space cell cube minimum `[x, y, z]`. */
  readonly min: readonly [number, number, number];
  /** World-space cell cube maximum `[x, y, z]`. */
  readonly max: readonly [number, number, number];
}

/**
 * Everything a level's {@link LevelDef.bind} callback may derive per-cell
 * params from — a discriminated union on `cellMode` (`"xz"` levels and
 * the unbounded level get {@link CellContextXZ}, `"xyz"` levels get
 * {@link CellContextXYZ}). For determinism, cell content must be a pure
 * function of this context (plus the level graph's structure and
 * params): bind must not read clocks, `Math.random`, viewpoint position,
 * or any other state.
 */
export type CellContext = CellContextXZ | CellContextXYZ;

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
   * Cell partitioning mode (default `"xz"`).
   *
   * - `"xz"` (default): square cells on the XZ plane, unbounded in Y,
   *   addressed `[cx, cz]` — the original behavior, bit-identical for
   *   existing configs.
   * - `"xyz"`: cube cells partitioning all three axes, addressed
   *   `[cx, cy, cz]`. The generation/retain radii use the Euclidean XYZ
   *   distance from the viewpoint to the cell center (the same metric
   *   the `"xz"` mode applies in XZ), and the per-cell seed hashes all
   *   three coordinates (see {@link CellContextBase.seed}).
   *
   * Nesting rules (the parent is the level above):
   * - `"xz"` under `"xz"`: the parent is the XZ cell containing this
   *   cell's center (original behavior).
   * - `"xyz"` under `"xyz"`: the parent is the cube containing this
   *   cell's center.
   * - `"xyz"` under `"xz"`: the parent is the XZ column cell containing
   *   this cell's XZ center (a 2D parent cell spans every Y).
   * - `"xz"` under `"xyz"` is rejected at World construction: a 2D
   *   column crosses every Y layer of a 3D parent, so no single parent
   *   cell contains it — make the parent `"xz"` or the child `"xyz"`.
   * - An unbounded parent (one global cell) accepts either mode below.
   *
   * Ignored for an unbounded level (a single global cell partitions
   * nothing).
   */
  readonly cellMode?: CellMode;
  /**
   * Cells generate when their center enters this radius (world units)
   * around the viewpoint: distance in XZ for `"xz"` levels, in XYZ for
   * `"xyz"` levels. Required for bounded levels (a positive finite
   * number). Optional for an unbounded level: omit it, or pass a value
   * and it is accepted and ignored — both spellings are valid, so
   * configs written before it became optional keep working unchanged.
   */
  readonly generationRadius?: number;
  /**
   * Hysteresis: a generated cell is kept until its center exits this
   * radius (same distance metric as `generationRadius`). Defaults to
   * `generationRadius * 1.25`; must be >= `generationRadius`. Ignored
   * for an unbounded level.
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
   * Cook only these declared outputs of {@link graph} per cell (the
   * per-output cooking of `CookOptions.outputs`): cell outputs then
   * contain exactly these names and only their upstream subgraph cooks,
   * so a terminal branch that is not relevant to this level costs
   * nothing. Names are validated against the graph's declared outputs at
   * World construction. Omit to cook every declared output (the
   * default).
   */
  readonly cookOutputs?: readonly string[];
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
   *
   * Reseeding the whole graph per cell is also sanctioned:
   * `graph.setSeed(hashCombine(ctx.seed, salt))` inside bind
   * deterministically re-derives every node's seed (memo keys include the
   * seed, so caching stays correct), and the runtime counts bind-time
   * writes — `setSeed` and `setParam` alike — as its own, never as user
   * edits, so no phantom staleness results.
   *
   * Aliasing contract: arrays bound into params (e.g. a `dataInput`
   * node's `items`) are captured by reference and end up aliased by the
   * stored cell outputs. Treat them as frozen after binding — mutating
   * one in place changes stored content with no staleness signal. To
   * change data, bind a fresh array (fresh item revs) or invalidate the
   * affected cells.
   */
  bind(graph: Graph, ctx: CellContext): void;
}
