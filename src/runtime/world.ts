/**
 * Viewpoint-driven hierarchical generation: a `World` streams grid cells
 * per level around a viewpoint, cooking each level's graph once per cell
 * with budgeted, cancellable, deterministic scheduling.
 */
import { CookCancelledError, cook, type Graph } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import type {
  CellContext,
  CellCoord,
  CellCoord3,
  CellMode,
  CellOutputs,
  LevelDef,
  ParentCellRef,
} from "./types.js";

/** A World configuration failed validation (levels, radii, caps). */
export class WorldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldValidationError";
  }
}

/** Options for constructing a {@link World}. */
export interface WorldOptions {
  /** World seed all per-cell seeds derive from (interpreted as u32). */
  seed: number;
  /** Levels ordered coarse to fine; see {@link LevelDef} for the rules. */
  levels: readonly LevelDef[];
  /**
   * Per-level LRU cap (default 256): after each update, a level keeps at
   * most this many cells, evicting least-recently-wanted first. A cap
   * smaller than a level's wanted set thrashes (cells evict right after
   * cooking); size it above the worst-case wanted count.
   */
  maxCellsPerLevel?: number;
  /** Called after a cell cooks (or recooks) with its declared outputs. */
  onCellReady?: (level: string, coord: CellCoord, outputs: CellOutputs) => void;
  /** Called when a cell is evicted (radius exit or LRU trim). */
  onCellEvicted?: (level: string, coord: CellCoord) => void;
}

/** Options for one {@link World.update} pass. */
export interface UpdateOptions {
  /**
   * Soft time budget for the whole update, in ms (finite, >= 0): once
   * elapsed time reaches it, no further cell cooks start (the in-flight
   * cell completes) and remaining work is reported as `pending`. A budget
   * of 0 cooks nothing. Also forwarded to each cell cook as its yield
   * budget.
   */
  budgetMs?: number;
  /**
   * Aborts the update: the in-flight cell cook cancels and `update`
   * rejects with `CookCancelledError`. Cells that finished cooking stay
   * stored; the next update resumes the remaining work.
   */
  signal?: AbortSignal;
  /**
   * Hard cap on the number of cell cooks in this update (non-negative
   * integer). 0 cooks nothing: every missing or stale wanted cell is
   * reported as `pending`.
   */
  maxCooksPerUpdate?: number;
}

/** One cell identified by its level name and coordinate. */
export interface CellId {
  readonly level: string;
  readonly coord: CellCoord;
}

/** Result of one {@link World.update} pass. */
export interface UpdateStats {
  /** Cells cooked this update, in cook order (deterministic). */
  readonly cooked: readonly CellId[];
  /** Cells evicted this update, in eviction order (deterministic). */
  readonly evicted: readonly CellId[];
  /** Wanted cells left uncooked (budget/cap exhausted or parent missing). */
  readonly pending: number;
  readonly elapsedMs: number;
}

/** A stored cell as returned by {@link World.getCell} / {@link World.cells}. */
export interface CellSnapshot {
  readonly coord: CellCoord;
  /** Declared outputs of the cell's last cook; treat as immutable. */
  readonly outputs: CellOutputs;
  /** World-monotonic cook counter value stamped when the cell last cooked. */
  readonly cookedAt: number;
}

/** Summary counters returned by {@link World.stats}. */
export interface WorldStats {
  readonly levels: readonly { readonly name: string; readonly cellCount: number }[];
  /** Total cell cooks over the world's lifetime. */
  readonly totalCooked: number;
  /** Total cell evictions over the world's lifetime. */
  readonly totalEvicted: number;
}

/** @internal Stored per-cell state. */
interface CellRecord {
  readonly coord: CellCoord;
  outputs: CellOutputs;
  /** Needs a recook next time it is wanted (edit, invalidate, or parent recook). */
  stale: boolean;
  cookedAt: number;
  /** LRU recency: bumped when the cell is wanted by an update or cooked. */
  lastUsed: number;
}

/** @internal Runtime state of one level. */
interface LevelState {
  readonly def: LevelDef;
  readonly index: number;
  /** Resolved cell mode ("xz" for unbounded levels — one global cell). */
  readonly mode: CellMode;
  /** Validated generation radius (Infinity for an unbounded level, unused). */
  readonly genRadius: number;
  /** Resolved retain radius (Infinity for an unbounded level). */
  readonly retainRadius: number;
  /** Stored cells in insertion order, keyed by the joined coordinate. */
  readonly cells: Map<string, CellRecord>;
  /**
   * Staleness baseline: the graph version right after the runtime's own
   * last bind. Binds bump the version, so the runtime re-baselines after
   * each of its own writes; any other version change at the start of an
   * update is a user edit and marks every stored cell of the level stale
   * (then re-baselines, so the edit is charged exactly once).
   */
  baselineVersion: number | undefined;
}

/** @internal A wanted cell with its squared distance to the viewpoint. */
interface WantedCell {
  readonly coord: CellCoord;
  readonly distSq: number;
}

function cellKey(coord: CellCoord): string {
  return coord.join(",");
}

/** Normalize -0 (a Math.ceil/floor artifact) to +0 in cell coordinates. */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Deterministic component-wise coordinate ordering (cx, then cz for 2D;
 * cx, cy, cz for 3D). Only ever compares coords of one level, so both
 * sides share a length.
 */
function coordCompare(a: CellCoord, b: CellCoord): number {
  const aa = a as readonly number[];
  const bb = b as readonly number[];
  for (let i = 0; i < aa.length; i++) {
    const d = aa[i] - (bb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Component-wise coordinate equality across either arity. */
function coordsEqual(a: CellCoord, b: CellCoord): boolean {
  const aa = a as readonly number[];
  const bb = b as readonly number[];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/**
 * Viewpoint-driven hierarchical cell streamer.
 *
 * Each level partitions the XZ plane into square cells (default), space
 * into cube cells (`cellMode: "xyz"`), or is a single unbounded cell.
 * `update(viewpoint)` cooks, per level from coarse to fine, every
 * missing or stale cell whose center lies within the level's
 * `generationRadius` of the viewpoint — nearest first — then evicts cells
 * whose center left `retainRadius` and LRU-trims each level to
 * `maxCellsPerLevel` (the unbounded cell never evicts).
 *
 * Determinism: cell content depends only on (world seed, level index,
 * cell coord, level graph structure+params, parent cell content) — see
 * {@link LevelDef.bind} for the contract that guarantees it. Cook order,
 * viewpoint path, evictions, and recooks never change the bytes a cell
 * produces.
 *
 * Staleness: a user edit to a level's graph between updates marks all of
 * that level's stored cells stale (detected via the graph's edit version
 * against the level baseline; see the mechanism note on the level state).
 * A cell recook also marks its stored child cells stale, so invalidation
 * propagates down the hierarchy. Stale cells recook only when wanted; a
 * stale cell in the hysteresis band keeps its old data until it is wanted
 * again, and while a parent cell is stale its wanted children stay
 * pending rather than cooking against outdated parent content. Evicting
 * a parent cell does not evict its children — they keep their generated
 * data.
 */
export class World {
  private readonly worldSeed: number;
  private readonly levels: LevelState[];
  private readonly maxCellsPerLevel: number;
  private readonly onCellReady: WorldOptions["onCellReady"];
  private readonly onCellEvicted: WorldOptions["onCellEvicted"];
  private cookCounter = 0;
  private useCounter = 0;
  private totalCooked = 0;
  private totalEvicted = 0;
  /** Last update (settled-safe), for serializing overlapping updates. */
  private inFlightUpdate: Promise<unknown> = Promise.resolve();

  constructor(opts: WorldOptions) {
    // Guard on a separate `unknown` alias: Array.isArray-narrowing a
    // readonly array intersects it with any[], which would silently strip
    // LevelDef typing from the whole constructor body.
    const levelsInput: unknown = opts.levels;
    if (!Array.isArray(levelsInput) || levelsInput.length === 0) {
      throw new WorldValidationError("World requires at least one level in `levels`");
    }
    const levels = opts.levels;
    const seen = new Set<string>();
    let prevBounded: { name: string; size: number } | undefined;
    levels.forEach((def, i) => {
      const label = `level ${i} ("${def.name}")`;
      if (typeof def.name !== "string" || def.name === "") {
        throw new WorldValidationError(`level ${i}: name must be a non-empty string`);
      }
      if (seen.has(def.name)) {
        throw new WorldValidationError(`duplicate level name "${def.name}"; level names must be unique`);
      }
      seen.add(def.name);
      if (def.cellMode !== undefined && def.cellMode !== "xz" && def.cellMode !== "xyz") {
        throw new WorldValidationError(
          `${label}: cellMode must be "xz" or "xyz", got ${String(def.cellMode)}`,
        );
      }
      if (def.cellSize === "unbounded") {
        if (i !== 0) {
          throw new WorldValidationError(
            levels[0].cellSize === "unbounded"
              ? `only one unbounded level is allowed ("${levels[0].name}" is already unbounded); give ${label} a finite cellSize`
              : `unbounded ${label} must be the first (coarsest) level`,
          );
        }
        return;
      }
      if (typeof def.cellSize !== "number" || !Number.isFinite(def.cellSize) || def.cellSize <= 0) {
        throw new WorldValidationError(
          `${label}: cellSize must be a positive finite number or "unbounded", got ${String(def.cellSize)}`,
        );
      }
      if (def.generationRadius === undefined) {
        throw new WorldValidationError(
          `${label}: a bounded level requires generationRadius (a positive finite number); only an unbounded level may omit it`,
        );
      }
      if (!Number.isFinite(def.generationRadius) || def.generationRadius <= 0) {
        throw new WorldValidationError(
          `${label}: generationRadius must be a positive finite number, got ${String(def.generationRadius)}`,
        );
      }
      if (
        def.retainRadius !== undefined &&
        (!Number.isFinite(def.retainRadius) || def.retainRadius < def.generationRadius)
      ) {
        throw new WorldValidationError(
          `${label}: retainRadius (${String(def.retainRadius)}) must be a finite number >= generationRadius (${def.generationRadius})`,
        );
      }
      if (prevBounded !== undefined && def.cellSize >= prevBounded.size) {
        throw new WorldValidationError(
          `levels must be ordered coarse to fine: ${label} cellSize ${def.cellSize} must be strictly smaller than "${prevBounded.name}" cellSize ${prevBounded.size}`,
        );
      }
      prevBounded = { name: def.name, size: def.cellSize };
    });
    // Nesting across cell modes: a 2D ("xz") level cannot sit under a 3D
    // ("xyz") bounded parent — a 2D column crosses every Y layer of the
    // parent, so no single parent cell contains it (see LevelDef.cellMode).
    for (let i = 1; i < levels.length; i++) {
      const parentDef = levels[i - 1];
      const childDef = levels[i];
      if (parentDef.cellSize === "unbounded") continue;
      if ((parentDef.cellMode ?? "xz") === "xyz" && (childDef.cellMode ?? "xz") === "xz") {
        throw new WorldValidationError(
          `level ${i} ("${childDef.name}") uses 2D "xz" cells under the 3D "xyz" parent "${parentDef.name}": a 2D column spans every Y layer of the parent, so no single parent cell contains it; set the parent's cellMode to "xz" or this level's to "xyz"`,
        );
      }
    }
    // cookOutputs must name declared outputs of the level's graph.
    levels.forEach((def, i) => {
      if (def.cookOutputs === undefined) return;
      if (def.cookOutputs.length === 0) {
        throw new WorldValidationError(
          `level ${i} ("${def.name}"): cookOutputs is an empty list, so every cell would cook nothing and store no outputs; omit cookOutputs to cook all declared outputs, or name at least one`,
        );
      }
      const declared = def.graph._outputs.map((o) => o.name);
      for (const name of def.cookOutputs) {
        if (!declared.includes(name)) {
          throw new WorldValidationError(
            `level ${i} ("${def.name}"): cookOutputs names unknown output "${name}"; the level graph declares: ${
              declared.length > 0 ? declared.map((n) => `"${n}"`).join(", ") : "(none)"
            }`,
          );
        }
      }
    });
    // Staleness tracking (baseline versions) is per level, so two levels
    // must never share one Graph instance: each would see the other's
    // binds as phantom user edits and recook everything forever.
    const graphOwners = new Map<Graph, string>();
    for (const def of levels) {
      const owner = graphOwners.get(def.graph);
      if (owner !== undefined) {
        throw new WorldValidationError(
          `levels "${owner}" and "${def.name}" share one Graph instance; give each level its own graph (staleness tracking is per level)`,
        );
      }
      graphOwners.set(def.graph, def.name);
    }
    const max = opts.maxCellsPerLevel ?? 256;
    if (!Number.isInteger(max) || max < 1) {
      throw new WorldValidationError(`maxCellsPerLevel must be an integer >= 1, got ${String(max)}`);
    }
    this.worldSeed = opts.seed >>> 0;
    this.maxCellsPerLevel = max;
    this.onCellReady = opts.onCellReady;
    this.onCellEvicted = opts.onCellEvicted;
    this.levels = levels.map((def, index) => ({
      def,
      index,
      mode: def.cellSize === "unbounded" ? "xz" : def.cellMode ?? "xz",
      genRadius: def.generationRadius ?? Infinity,
      retainRadius:
        def.cellSize === "unbounded"
          ? Infinity
          : def.retainRadius ?? (def.generationRadius ?? 0) * 1.25,
      cells: new Map<string, CellRecord>(),
      baselineVersion: undefined,
    }));
  }

  /**
   * Stream cells around `viewpoint` (`[x, y, z]`; `"xz"` levels use only
   * X and Z, `"xyz"` levels use all three axes). Levels are processed
   * coarse to fine,
   * so a cell's parent cooks earlier in the same update; a wanted cell
   * whose parent cell is not yet cooked (or is stale awaiting a recook)
   * stays pending instead of cooking with missing or outdated parent
   * data. Rejects with `CookCancelledError` when `opts.signal` aborts
   * (the store keeps every completed cell and the next update resumes),
   * and with `WorldValidationError` on a non-finite viewpoint or invalid
   * options.
   *
   * Overlapping calls are serialized per World: a call waits for the
   * in-flight update to settle before starting, so binds and cooks of
   * different updates never interleave — fire-and-forget per-frame
   * updates are safe.
   */
  update(
    viewpoint: readonly [number, number, number],
    opts: UpdateOptions = {},
  ): Promise<UpdateStats> {
    const run = this.inFlightUpdate.then(() => this.updateRun(viewpoint, opts));
    this.inFlightUpdate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async updateRun(
    viewpoint: readonly [number, number, number],
    opts: UpdateOptions,
  ): Promise<UpdateStats> {
    const { budgetMs, signal, maxCooksPerUpdate } = opts;
    for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(viewpoint[i])) {
        throw new WorldValidationError(
          `viewpoint ${"xyz"[i]} must be a finite number, got ${String(viewpoint[i])}`,
        );
      }
    }
    if (budgetMs !== undefined && (!Number.isFinite(budgetMs) || budgetMs < 0)) {
      throw new WorldValidationError(
        `budgetMs must be a finite number >= 0, got ${String(budgetMs)}`,
      );
    }
    if (
      maxCooksPerUpdate !== undefined &&
      (!Number.isInteger(maxCooksPerUpdate) || maxCooksPerUpdate < 0)
    ) {
      throw new WorldValidationError(
        `maxCooksPerUpdate must be a non-negative integer, got ${String(maxCooksPerUpdate)}`,
      );
    }
    const start = performance.now();
    if (signal?.aborted) throw new CookCancelledError();
    const vx = viewpoint[0];
    const vy = viewpoint[1];
    const vz = viewpoint[2];
    const cooked: CellId[] = [];
    const evicted: CellId[] = [];
    let pending = 0;

    for (const level of this.levels) {
      // A version change the runtime didn't cause is a user edit: mark all
      // stored cells stale, once (see LevelState.baselineVersion).
      const graph = level.def.graph;
      if (level.baselineVersion !== undefined && graph.version !== level.baselineVersion) {
        for (const rec of level.cells.values()) rec.stale = true;
        level.baselineVersion = graph.version;
      }

      // Wanted set, LRU touch, and the cook queue (missing or stale cells),
      // nearest first with a deterministic component-wise coord tie-break.
      const queue: WantedCell[] = [];
      for (const w of this.wantedCells(level, vx, vy, vz)) {
        const rec = level.cells.get(cellKey(w.coord));
        if (rec !== undefined) rec.lastUsed = ++this.useCounter;
        if (rec === undefined || rec.stale) queue.push(w);
      }
      queue.sort((a, b) => a.distSq - b.distSq || coordCompare(a.coord, b.coord));

      for (const w of queue) {
        if (signal?.aborted) throw new CookCancelledError();
        if (
          (maxCooksPerUpdate !== undefined && cooked.length >= maxCooksPerUpdate) ||
          (budgetMs !== undefined && performance.now() - start >= budgetMs)
        ) {
          pending++;
          continue;
        }
        const parent = this.parentFor(level, w.coord);
        if (parent === "missing") {
          pending++;
          continue;
        }
        await this.cookCell(level, w.coord, parent, opts, cooked);
      }
    }

    // Eviction: radius exit first, then LRU trim to the per-level cap.
    // The unbounded level's single cell never evicts.
    for (const level of this.levels) {
      if (level.def.cellSize !== "unbounded") {
        const rr2 = level.retainRadius * level.retainRadius;
        for (const rec of [...level.cells.values()]) {
          if (this.centerDistSq(level, rec.coord, vx, vy, vz) > rr2) {
            this.evict(level, rec, evicted);
          }
        }
        if (level.cells.size > this.maxCellsPerLevel) {
          const excess = [...level.cells.values()]
            .sort((a, b) => a.lastUsed - b.lastUsed)
            .slice(0, level.cells.size - this.maxCellsPerLevel);
          for (const rec of excess) this.evict(level, rec, evicted);
        }
      }
    }

    return { cooked, evicted, pending, elapsedMs: performance.now() - start };
  }

  /** The stored cell at `coord`, if present. Outputs are immutable. */
  getCell(levelName: string, coord: CellCoord): Omit<CellSnapshot, "coord"> | undefined {
    const level = this.requireLevel(levelName);
    this.checkCoordArity(level, coord);
    const rec = level.cells.get(cellKey(coord));
    return rec === undefined ? undefined : { outputs: rec.outputs, cookedAt: rec.cookedAt };
  }

  /** All stored cells of a level, in insertion order (deterministic). */
  cells(levelName: string): CellSnapshot[] {
    return [...this.requireLevel(levelName).cells.values()].map((rec) => ({
      coord: rec.coord,
      outputs: rec.outputs,
      cookedAt: rec.cookedAt,
    }));
  }

  /**
   * Force a recook: of every cell (no args), one level's cells, or one
   * cell. Marked cells keep their data and recook on the next update in
   * which they are wanted; recooking a cell also marks its stored child
   * cells, so invalidation cascades down.
   */
  invalidate(levelName?: string, coord?: CellCoord): void {
    if (levelName === undefined) {
      for (const level of this.levels) {
        for (const rec of level.cells.values()) rec.stale = true;
      }
      return;
    }
    const level = this.requireLevel(levelName);
    if (coord === undefined) {
      for (const rec of level.cells.values()) rec.stale = true;
      return;
    }
    this.checkCoordArity(level, coord);
    const rec = level.cells.get(cellKey(coord));
    if (rec !== undefined) rec.stale = true;
  }

  /** Per-level cell counts and lifetime cook/eviction totals. */
  stats(): WorldStats {
    return {
      levels: this.levels.map((l) => ({ name: l.def.name, cellCount: l.cells.size })),
      totalCooked: this.totalCooked,
      totalEvicted: this.totalEvicted,
    };
  }

  /** Cells whose center is within the level's generation radius (inclusive). */
  private wantedCells(level: LevelState, vx: number, vy: number, vz: number): WantedCell[] {
    if (level.def.cellSize === "unbounded") return [{ coord: [0, 0], distSq: 0 }];
    const s = level.def.cellSize;
    const r = level.genRadius;
    const r2 = r * r;
    const cxMin = Math.ceil((vx - r) / s - 0.5);
    const cxMax = Math.floor((vx + r) / s - 0.5);
    const czMin = Math.ceil((vz - r) / s - 0.5);
    const czMax = Math.floor((vz + r) / s - 0.5);
    const out: WantedCell[] = [];
    if (level.mode === "xyz") {
      const cyMin = Math.ceil((vy - r) / s - 0.5);
      const cyMax = Math.floor((vy + r) / s - 0.5);
      for (let cz = czMin; cz <= czMax; cz++) {
        for (let cy = cyMin; cy <= cyMax; cy++) {
          for (let cx = cxMin; cx <= cxMax; cx++) {
            const dx = (cx + 0.5) * s - vx;
            const dy = (cy + 0.5) * s - vy;
            const dz = (cz + 0.5) * s - vz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2) out.push({ coord: [nz(cx), nz(cy), nz(cz)], distSq: d2 });
          }
        }
      }
      return out;
    }
    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const dx = (cx + 0.5) * s - vx;
        const dz = (cz + 0.5) * s - vz;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) out.push({ coord: [nz(cx), nz(cz)], distSq: d2 });
      }
    }
    return out;
  }

  /**
   * Squared distance from the viewpoint to a bounded cell's center, in
   * the level's own metric: XZ for `"xz"` levels, XYZ for `"xyz"` — the
   * same metric `wantedCells` applies, so generation and retention agree.
   */
  private centerDistSq(
    level: LevelState,
    coord: CellCoord,
    vx: number,
    vy: number,
    vz: number,
  ): number {
    const size = level.def.cellSize as number;
    const dx = (coord[0] + 0.5) * size - vx;
    if (level.mode === "xyz") {
      const c = coord as CellCoord3;
      const dy = (c[1] + 0.5) * size - vy;
      const dz = (c[2] + 0.5) * size - vz;
      return dx * dx + dy * dy + dz * dz;
    }
    const dz = (coord[1] + 0.5) * size - vz;
    return dx * dx + dz * dz;
  }

  /**
   * Coordinate of the parent-level cell containing this cell's center.
   * Modes map as documented on {@link LevelDef.cellMode}: like under
   * like contains the center; a 3D child under a 2D parent maps to the
   * XZ column cell; 2D under 3D was rejected at construction.
   */
  private parentCoordOf(level: LevelState, coord: CellCoord): CellCoord {
    const parent = this.levels[level.index - 1];
    if (parent.def.cellSize === "unbounded") return [0, 0];
    const size = level.def.cellSize as number;
    const psize = parent.def.cellSize;
    if (level.mode === "xyz") {
      const c = coord as CellCoord3;
      const px = nz(Math.floor(((c[0] + 0.5) * size) / psize));
      const pz = nz(Math.floor(((c[2] + 0.5) * size) / psize));
      return parent.mode === "xyz"
        ? [px, nz(Math.floor(((c[1] + 0.5) * size) / psize)), pz]
        : [px, pz];
    }
    return [
      nz(Math.floor(((coord[0] + 0.5) * size) / psize)),
      nz(Math.floor(((coord[1] + 0.5) * size) / psize)),
    ];
  }

  /** Reject a coordinate whose arity does not match the level's mode. */
  private checkCoordArity(level: LevelState, coord: CellCoord): void {
    const expected = level.mode === "xyz" ? 3 : 2;
    if (coord.length !== expected) {
      throw new WorldValidationError(
        level.mode === "xyz"
          ? `level "${level.def.name}" uses 3D "xyz" cells addressed [cx, cy, cz]; got a ${coord.length}-component coordinate`
          : `level "${level.def.name}" uses 2D "xz" cells addressed [cx, cz]; got a ${coord.length}-component coordinate`,
      );
    }
  }

  /**
   * The cooked parent cell for a cell of `level`: undefined for the top
   * level, "missing" when the parent cell has not been cooked yet. A
   * stale parent (e.g. edited while parked in its hysteresis band) also
   * counts as missing: children wait for the recook rather than cooking
   * against outdated parent content.
   */
  private parentFor(level: LevelState, coord: CellCoord): ParentCellRef | "missing" | undefined {
    if (level.index === 0) return undefined;
    const pcoord = this.parentCoordOf(level, coord);
    const rec = this.levels[level.index - 1].cells.get(cellKey(pcoord));
    return rec === undefined || rec.stale
      ? "missing"
      : { coord: pcoord, outputs: rec.outputs };
  }

  /** Bind the cell context, cook the level graph, and store the outputs. */
  private async cookCell(
    level: LevelState,
    coord: CellCoord,
    parent: ParentCellRef | undefined,
    opts: UpdateOptions,
    cooked: CellId[],
  ): Promise<void> {
    const def = level.def;
    const idx = level.index;
    let ctx: CellContext;
    if (def.cellSize === "unbounded") {
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "xz",
        coord: [0, 0],
        min: [-Infinity, -Infinity],
        max: [Infinity, Infinity],
        seed: hashCombine(this.worldSeed, idx),
        ...(parent !== undefined ? { parent } : {}),
      };
    } else if (level.mode === "xyz") {
      const s = def.cellSize;
      const c = coord as CellCoord3;
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "xyz",
        coord: c,
        min: [c[0] * s, c[1] * s, c[2] * s],
        max: [(c[0] + 1) * s, (c[1] + 1) * s, (c[2] + 1) * s],
        seed: hashCombine(this.worldSeed, idx, c[0], c[1], c[2]),
        ...(parent !== undefined ? { parent } : {}),
      };
    } else {
      const s = def.cellSize;
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "xz",
        coord: [coord[0], coord[1]],
        min: [coord[0] * s, coord[1] * s],
        max: [(coord[0] + 1) * s, (coord[1] + 1) * s],
        seed: hashCombine(this.worldSeed, idx, coord[0], coord[1]),
        ...(parent !== undefined ? { parent } : {}),
      };
    }
    // A version change since the level's last baseline means user code
    // edited the graph mid-update (e.g. inside onCellReady): charge it
    // now, so cells cooked earlier this update recook next update instead
    // of silently keeping pre-edit content.
    if (level.baselineVersion !== undefined && def.graph.version !== level.baselineVersion) {
      for (const rec of level.cells.values()) rec.stale = true;
    }
    def.bind(def.graph, ctx);
    // Re-baseline after the runtime's own writes: only user edits leave
    // version and baseline disagreeing at the next check.
    level.baselineVersion = def.graph.version;
    const result = await cook(def.graph, {
      signal: opts.signal,
      budgetMs: opts.budgetMs,
      outputs: def.cookOutputs,
    });

    const key = cellKey(coord);
    let rec = level.cells.get(key);
    if (rec === undefined) {
      rec = {
        coord,
        outputs: result.outputs,
        stale: false,
        cookedAt: ++this.cookCounter,
        lastUsed: ++this.useCounter,
      };
      level.cells.set(key, rec);
    } else {
      rec.outputs = result.outputs;
      rec.stale = false;
      rec.cookedAt = ++this.cookCounter;
      rec.lastUsed = ++this.useCounter;
    }

    // Parent content flows into children at their bind time, so a (re)cook
    // here may change what stored children consumed: mark them stale. They
    // recook when next wanted (child levels are processed after this one,
    // so a same-update child recook already sees the new outputs).
    const childLevel = this.levels[idx + 1];
    if (childLevel !== undefined) {
      for (const childRec of childLevel.cells.values()) {
        const pc = this.parentCoordOf(childLevel, childRec.coord);
        if (coordsEqual(pc, coord)) childRec.stale = true;
      }
    }

    this.totalCooked++;
    cooked.push({ level: def.name, coord: rec.coord });
    this.onCellReady?.(def.name, rec.coord, rec.outputs);
  }

  private evict(level: LevelState, rec: CellRecord, evicted: CellId[]): void {
    level.cells.delete(cellKey(rec.coord));
    this.totalEvicted++;
    evicted.push({ level: level.def.name, coord: rec.coord });
    this.onCellEvicted?.(level.def.name, rec.coord);
  }

  private requireLevel(name: string): LevelState {
    const level = this.levels.find((l) => l.def.name === name);
    if (level === undefined) {
      throw new WorldValidationError(
        `unknown level "${name}"; levels: ${this.levels.map((l) => l.def.name).join(", ")}`,
      );
    }
    return level;
  }
}
