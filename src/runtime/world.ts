/**
 * Viewpoint-driven hierarchical generation: a `World` streams grid cells
 * per level around a viewpoint, cooking each level's graph once per cell
 * with budgeted, cancellable, deterministic scheduling.
 */
import type { GpuFieldResolver } from "../fields/index.js";
import { CookCancelledError, cook, type Graph } from "../graph/index.js";
import { hashCombine } from "../random/index.js";
import { applyParamPatches } from "./patches.js";
import type {
  BindPatches,
  CellContext,
  CellCoord,
  CellCoord1,
  CellCoord2,
  CellCoord3,
  CellMode,
  CellOutputs,
  CookBackend,
  LevelDef,
  ParamPatch,
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
  /**
   * GPU field resolver passed to every cell cook (`CookOptions.gpu`):
   * adopting nodes resolve eligible spec'd fields on the device, and
   * cell memo provenance keeps device and CPU bytes apart. Overridable
   * per update via `UpdateOptions.gpu` (the update's value wins). Omit
   * for CPU-only cooking, byte-identical to a build without GPU support.
   * Never reaches pool-cooked levels (see {@link WorldOptions.pool}).
   */
  gpu?: GpuFieldResolver;
  /**
   * Opt-in off-thread cooking (e.g. `CookWorkerPool` from
   * `pcg-ts/worker`). Levels that bind with {@link LevelDef.bindPatches}
   * send their cell cooks here instead of cooking on this thread;
   * `bind` levels are untouched, and with no pool every level cooks
   * locally exactly as before (bindPatches levels via the local patch
   * fallback) — the bytes are identical either way.
   *
   * Semantics that shift with a pool, stated plainly:
   * - `UpdateOptions.budgetMs` bounds SCHEDULING, not cook wall time:
   *   dispatching a cell to the pool is what consumes budget, the cooks
   *   themselves run elsewhere, and `update()` resolves once this
   *   update's dispatched cells have landed (the main thread is free
   *   while it waits).
   * - Pool cooks are CPU-only: a worker has no render device, so a GPU
   *   resolver (`WorldOptions.gpu` / `UpdateOptions.gpu`) applies only
   *   to locally cooked levels, and pooled instance outputs are always
   *   CPU batches.
   * - Staleness, eviction, parent gating, and per-cell seeds are
   *   unchanged; cells land in deterministic (nearest-first) order
   *   regardless of which worker finishes when.
   */
  pool?: CookBackend;
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
  /**
   * GPU field resolver for this update's cell cooks, overriding
   * `WorldOptions.gpu` when both are set. See that option for semantics.
   */
  gpu?: GpuFieldResolver;
  /**
   * Arc anchor of each `"path"` level, in the units of that level's
   * `path.length`, keyed by LEVEL NAME.
   *
   * Keyed by name rather than shared, because two `"path"` levels may
   * ride different centrelines at different `cellSize`s and be at
   * different arc positions. A mixed World therefore streams in one
   * call: the world point drives the `"xz"` and `"xyz"` levels, each
   * entry here drives its own `"path"` level.
   *
   * Every `"path"` level must have a finite entry — the anchor is the
   * only way such a level gets a position — and a non-finite value, an
   * unknown level name, or a name that is not a `"path"` level throws
   * `WorldValidationError`, exactly like a non-finite viewpoint. On a
   * closed table the anchor wraps, so any real number is in range;
   * on an open one it is used as given.
   */
  readonly anchors?: Readonly<Record<string, number>>;
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
  /** "path" levels: the table's total arc length (0 for other modes). */
  readonly pathLength: number;
  /** "path" levels: whether the table closes on itself. */
  readonly pathClosed: boolean;
  /** "path" levels: `round(length / cellSize)` sectors, at least 1. */
  readonly sectorCount: number;
  /** "path" levels: arc length of one sector (`pathLength / sectorCount`). */
  readonly sectorSize: number;
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

/**
 * Sector count of a `"path"` level: `round(length / cellSize)` equal
 * sectors, so the seam falls exactly at `s = 0` rather than leaving a
 * short remainder sector before it. At least one — a table shorter than
 * half a cell is still one cell, not zero.
 */
function sectorCountOf(length: number, cellSize: number): number {
  return Math.max(1, Math.round(length / cellSize));
}

/**
 * Arc length at sector boundary `i` (0..n). The last boundary is the
 * table length itself rather than `n * sectorSize`, so on a closed table
 * the final sector meets sector 0 exactly at the seam.
 */
function sectorBound(i: number, n: number, sectorSize: number, length: number): number {
  return i >= n ? length : i * sectorSize;
}

/**
 * Arc distance from `a` to sector `sec`'s half-open range `[sMin, sMax)`
 * — zero when `a` is inside it, otherwise the gap to its nearest bound.
 *
 * WRAPPING follows `pathRuns`: the seam at `s = 0` is not a boundary on a
 * CLOSED table, where sector `n-1` is adjacent to sector 0 and the
 * distance is cyclic; on an OPEN table the seam is a hard boundary and
 * the two ends of the table are as far apart as their arc lengths say.
 * `a` is expected already wrapped into `[0, length)` on a closed table.
 */
function sectorArcDist(
  a: number,
  sec: number,
  n: number,
  sectorSize: number,
  length: number,
  closed: boolean,
): number {
  const sMin = sectorBound(sec, n, sectorSize, length);
  const sMax = sectorBound(sec + 1, n, sectorSize, length);
  const direct = Math.max(sMin - a, a - sMax, 0);
  if (!closed) return direct;
  // The same sector one lap behind and one lap ahead: on a closed table
  // whichever copy is nearest is the true distance.
  return Math.min(
    direct,
    Math.max(sMin - length - a, a - (sMax - length), 0),
    Math.max(sMin + length - a, a - (sMax + length), 0),
  );
}

/** Wrap an arc position into `[0, length)`. */
function wrapArc(s: number, length: number): number {
  const m = s % length;
  return m < 0 ? m + length : m;
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

/** Normalize either return form of {@link LevelDef.bindPatches}. */
function normalizeBindPatches(bound: readonly ParamPatch[] | BindPatches): BindPatches {
  return Array.isArray(bound) ? { patches: bound } : (bound as BindPatches);
}

/**
 * Attach no-op rejection handlers to in-flight pooled cooks the update is
 * abandoning (abort, or an earlier cell's failure): their outcomes are
 * irrelevant now, but an unobserved rejection would crash the process.
 */
function settleQuietly(dispatched: readonly { result: Promise<unknown> }[]): void {
  for (const d of dispatched) {
    d.result.catch(() => undefined);
  }
}

/**
 * Viewpoint-driven hierarchical cell streamer.
 *
 * Each level partitions the XZ plane into square cells (default), space
 * into cube cells (`cellMode: "xyz"`), ARC LENGTH along a curve into
 * sectors (`cellMode: "path"`), or is a single unbounded cell.
 * `update(viewpoint)` cooks, per level from coarse to fine, every
 * missing or stale cell whose center lies within the level's
 * `generationRadius` of the viewpoint — nearest first — then evicts cells
 * whose center left `retainRadius` and LRU-trims each level to
 * `maxCellsPerLevel` (the unbounded cell never evicts). A `"path"` level
 * measures both radii as arc distance from its own anchor
 * (`UpdateOptions.anchors`) instead, so "nearest first" reads as nearest
 * along the track.
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
  private readonly gpu: GpuFieldResolver | undefined;
  private readonly pool: CookBackend | undefined;
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
    // Coarse-to-fine is checked per MODE FAMILY: "path" cellSizes are arc
    // lengths and "xz"/"xyz" cellSizes are world lengths, so comparing one
    // against the other would compare two different quantities.
    const prevBounded = new Map<"world" | "path", { name: string; size: number }>();
    levels.forEach((def, i) => {
      const label = `level ${i} ("${def.name}")`;
      if (typeof def.name !== "string" || def.name === "") {
        throw new WorldValidationError(`level ${i}: name must be a non-empty string`);
      }
      if (seen.has(def.name)) {
        throw new WorldValidationError(`duplicate level name "${def.name}"; level names must be unique`);
      }
      seen.add(def.name);
      if (
        def.cellMode !== undefined &&
        def.cellMode !== "xz" &&
        def.cellMode !== "xyz" &&
        def.cellMode !== "path"
      ) {
        throw new WorldValidationError(
          `${label}: cellMode must be "xz", "xyz" or "path", got ${String(def.cellMode)}`,
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
      // The arc table: required by "path", meaningless (and so refused)
      // anywhere else, because a square cell has no arc length to split.
      const mode = def.cellMode ?? "xz";
      if (mode === "path") {
        if (def.path === undefined) {
          throw new WorldValidationError(
            `${label}: cellMode "path" requires a path table; add path: { length: <total arc length of the centreline>, closed: true | false } to the level — length and closed are all the World needs to cut sectors, and it must be static configuration rather than something a parent level produces`,
          );
        }
        if (!Number.isFinite(def.path.length) || def.path.length <= 0) {
          throw new WorldValidationError(
            `${label}: path.length must be a positive finite number (the centreline's total arc length), got ${String(def.path.length)}`,
          );
        }
        if (typeof def.path.closed !== "boolean") {
          throw new WorldValidationError(
            `${label}: path.closed must be a boolean — true when the centreline joins its own start, so the last sector is adjacent to sector 0 across the s = 0 seam; got ${String(def.path.closed)}`,
          );
        }
      } else if (def.path !== undefined) {
        throw new WorldValidationError(
          `${label}: has a path table but cellMode is "${mode}", which partitions space rather than arc length; set cellMode: "path" to stream sectors along the centreline, or remove the path field`,
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
      const family = mode === "path" ? "path" : "world";
      const prev = prevBounded.get(family);
      if (prev !== undefined && def.cellSize >= prev.size) {
        throw new WorldValidationError(
          family === "path"
            ? `levels must be ordered coarse to fine: ${label} cellSize ${def.cellSize} (arc length) must be strictly smaller than "path" level "${prev.name}" cellSize ${prev.size}`
            : `levels must be ordered coarse to fine: ${label} cellSize ${def.cellSize} must be strictly smaller than "${prev.name}" cellSize ${prev.size}`,
        );
      }
      prevBounded.set(family, { name: def.name, size: def.cellSize });
    });
    // Nesting across cell modes: a 2D ("xz") level cannot sit under a 3D
    // ("xyz") bounded parent — a 2D column crosses every Y layer of the
    // parent, so no single parent cell contains it (see LevelDef.cellMode).
    // The same containment argument rejects mixing "path" with either
    // world-space mode in both directions: an arc sector is a tube along a
    // curve, so no square cell contains it and it contains no square cell.
    for (let i = 1; i < levels.length; i++) {
      const parentDef = levels[i - 1];
      const childDef = levels[i];
      if (parentDef.cellSize === "unbounded") continue;
      const parentMode = parentDef.cellMode ?? "xz";
      const childMode = childDef.cellMode ?? "xz";
      if (parentMode === "xyz" && childMode === "xz") {
        throw new WorldValidationError(
          `level ${i} ("${childDef.name}") uses 2D "xz" cells under the 3D "xyz" parent "${parentDef.name}": a 2D column spans every Y layer of the parent, so no single parent cell contains it; set the parent's cellMode to "xz" or this level's to "xyz"`,
        );
      }
      if (childMode === "path" && parentMode !== "path") {
        throw new WorldValidationError(
          `level ${i} ("${childDef.name}") uses "path" cells under the "${parentMode}" parent "${parentDef.name}": an arc sector is a tube along a curve, so no single square parent cell contains it; make the parent "path" with the same centreline, or make this level "${parentMode}"`,
        );
      }
      if (parentMode === "path" && childMode !== "path") {
        throw new WorldValidationError(
          `level ${i} ("${childDef.name}") uses "${childMode}" cells under the "path" parent "${parentDef.name}": an arc sector is a tube along a curve, so it contains no whole square cell; make this level "path" with the same centreline, or make the parent "${childMode}"`,
        );
      }
      if (
        childMode === "path" &&
        parentMode === "path" &&
        childDef.path !== undefined &&
        parentDef.path !== undefined &&
        (childDef.path.length !== parentDef.path.length ||
          childDef.path.closed !== parentDef.path.closed)
      ) {
        throw new WorldValidationError(
          `level ${i} ("${childDef.name}") declares path { length: ${childDef.path.length}, closed: ${childDef.path.closed} } but its "path" parent "${parentDef.name}" declares { length: ${parentDef.path.length}, closed: ${parentDef.path.closed} }: nested "path" levels ride ONE table, and the parent sector of a sector is found by arc length alone; give both levels the same path table (they may still differ in cellSize)`,
        );
      }
    }
    // Exactly one binding form per level: bind (imperative, in-place) or
    // bindPatches (serializable; poolable). Zero or both is ambiguous
    // about which one a cook would honor, so it is refused with the fix.
    levels.forEach((def, i) => {
      const hasBind = typeof def.bind === "function";
      const hasPatches = typeof def.bindPatches === "function";
      if (hasBind && hasPatches) {
        throw new WorldValidationError(
          `level ${i} ("${def.name}") defines both bind and bindPatches; keep exactly one — bind mutates the graph in place (always cooks locally), bindPatches returns serializable patches (cooks on WorldOptions.pool when one is set, locally otherwise)`,
        );
      }
      if (!hasBind && !hasPatches) {
        throw new WorldValidationError(
          `level ${i} ("${def.name}") defines neither bind nor bindPatches; add bind(graph, ctx) to wire cell context in place, or bindPatches(ctx) to return it as serializable param patches`,
        );
      }
    });
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
    this.gpu = opts.gpu;
    this.pool = opts.pool;
    this.levels = levels.map((def, index) => {
      const mode: CellMode = def.cellSize === "unbounded" ? "xz" : def.cellMode ?? "xz";
      // Sectors are derived once: a "path" level's cellSize is a TARGET
      // arc length, rounded to a whole number of equal sectors so the
      // seam lands exactly at s = 0.
      const pathLength = mode === "path" ? (def.path?.length ?? 0) : 0;
      const sectorCount =
        mode === "path" ? sectorCountOf(pathLength, def.cellSize as number) : 0;
      return {
        def,
        index,
        mode,
        genRadius: def.generationRadius ?? Infinity,
        retainRadius:
          def.cellSize === "unbounded"
            ? Infinity
            : def.retainRadius ?? (def.generationRadius ?? 0) * 1.25,
        pathLength,
        pathClosed: mode === "path" && def.path?.closed === true,
        sectorCount,
        sectorSize: sectorCount > 0 ? pathLength / sectorCount : 0,
        cells: new Map<string, CellRecord>(),
        baselineVersion: undefined,
      };
    });
  }

  /**
   * Stream cells around `viewpoint` (`[x, y, z]`; `"xz"` levels use only
   * X and Z, `"xyz"` levels use all three axes). A `"path"` level ignores
   * the viewpoint entirely and streams around its arc anchor from
   * `opts.anchors` instead, so a mixed World updates in one call.
   * Levels are processed coarse to fine,
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
    // The anchors are the viewpoint of every "path" level, so they are
    // validated with the same strictness and before any cell cooks.
    const anchors = this.resolveAnchors(opts.anchors);
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
      for (const w of this.wantedCells(level, vx, vy, vz, anchors[level.index])) {
        const rec = level.cells.get(cellKey(w.coord));
        if (rec !== undefined) rec.lastUsed = ++this.useCounter;
        if (rec === undefined || rec.stale) queue.push(w);
      }
      queue.sort((a, b) => a.distSq - b.distSq || coordCompare(a.coord, b.coord));

      if (level.def.bindPatches !== undefined && this.pool !== undefined) {
        // Pooled level: dispatch every affordable cell to the backend,
        // then land results in queue (nearest-first) order — completion
        // order is wall-clock and must not leak into storage, callback,
        // or stats order.
        pending += await this.cookLevelPooled(level, queue, this.pool, opts, start, cooked);
        continue;
      }
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
          if (this.centerDistSq(level, rec.coord, vx, vy, vz, anchors[level.index]) > rr2) {
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

  /**
   * Per-level arc anchor for this update, indexed by level index: the
   * validated `UpdateOptions.anchors` entry of each `"path"` level
   * (wrapped into `[0, length)` on a closed table), and 0 — never read —
   * for every other level.
   *
   * Every anchor is checked before any cell cooks, so a typo cannot
   * half-stream a World.
   */
  private resolveAnchors(anchors: Readonly<Record<string, number>> | undefined): number[] {
    if (anchors !== undefined) {
      for (const name of Object.keys(anchors)) {
        const level = this.levels.find((l) => l.def.name === name);
        if (level === undefined) {
          throw new WorldValidationError(
            `anchors names unknown level "${name}"; levels: ${this.levels.map((l) => l.def.name).join(", ")}`,
          );
        }
        if (level.mode !== "path") {
          throw new WorldValidationError(
            `anchors names level "${name}", which uses "${level.mode}" cells and follows the viewpoint; an arc anchor only positions a level with cellMode: "path", so drop this entry or give that level cellMode: "path"`,
          );
        }
      }
    }
    return this.levels.map((level) => {
      if (level.mode !== "path") return 0;
      const raw = anchors?.[level.def.name];
      if (raw === undefined) {
        throw new WorldValidationError(
          `level ${level.index} ("${level.def.name}") uses "path" cells and has no arc anchor: pass update(viewpoint, { anchors: { "${level.def.name}": s } }) with s the arc length along its centreline`,
        );
      }
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new WorldValidationError(
          `anchors["${level.def.name}"] must be a finite number (an arc length along the level's centreline), got ${String(raw)}`,
        );
      }
      return level.pathClosed ? wrapArc(raw, level.pathLength) : raw;
    });
  }

  /**
   * Cells whose center is within the level's generation radius
   * (inclusive) — or, for a `"path"` level, whose arc range comes within
   * that many arc units of the level's anchor.
   */
  private wantedCells(
    level: LevelState,
    vx: number,
    vy: number,
    vz: number,
    anchor: number,
  ): WantedCell[] {
    if (level.def.cellSize === "unbounded") return [{ coord: [0, 0], distSq: 0 }];
    if (level.mode === "path") return this.wantedPathCells(level, anchor);
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
   * Sectors of a `"path"` level within `generationRadius` ARC units of
   * the anchor — "the next N metres" rather than a disc.
   *
   * Candidates come from the sector indices the window `[a - r, a + r]`
   * spans; on a closed table those indices are taken modulo the sector
   * count, so a window straddling the `s = 0` seam wraps onto the far end
   * of the table, and a window at least a full lap wide collapses to
   * every sector exactly once.
   */
  private wantedPathCells(level: LevelState, anchor: number): WantedCell[] {
    const n = level.sectorCount;
    const ss = level.sectorSize;
    const len = level.pathLength;
    const r = level.genRadius;
    const closed = level.pathClosed;
    const out: WantedCell[] = [];
    let iMin = Math.floor((anchor - r) / ss);
    let iMax = Math.floor((anchor + r) / ss);
    if (closed) {
      if (iMax - iMin + 1 >= n) {
        iMin = 0;
        iMax = n - 1;
      }
    } else {
      // The seam is a hard boundary on an open table: nothing exists
      // before sector 0 or after the last one.
      iMin = Math.max(0, iMin);
      iMax = Math.min(n - 1, iMax);
    }
    const seen = new Set<number>();
    for (let i = iMin; i <= iMax; i++) {
      const sec = closed ? ((i % n) + n) % n : i;
      if (seen.has(sec)) continue;
      seen.add(sec);
      const d = sectorArcDist(anchor, sec, n, ss, len, closed);
      if (d <= r) out.push({ coord: [sec], distSq: d * d });
    }
    return out;
  }

  /**
   * Squared distance from the viewpoint to a bounded cell's center, in
   * the level's own metric: XZ for `"xz"` levels, XYZ for `"xyz"`, and
   * squared ARC distance from the anchor to the sector's nearest bound
   * for `"path"` — the same metric `wantedCells` applies in each case, so
   * generation and retention agree.
   */
  private centerDistSq(
    level: LevelState,
    coord: CellCoord,
    vx: number,
    vy: number,
    vz: number,
    anchor: number,
  ): number {
    if (level.mode === "path") {
      const d = sectorArcDist(
        anchor,
        coord[0],
        level.sectorCount,
        level.sectorSize,
        level.pathLength,
        level.pathClosed,
      );
      return d * d;
    }
    const size = level.def.cellSize as number;
    const dx = (coord[0] + 0.5) * size - vx;
    if (level.mode === "xyz") {
      const c = coord as CellCoord3;
      const dy = (c[1] + 0.5) * size - vy;
      const dz = (c[2] + 0.5) * size - vz;
      return dx * dx + dy * dy + dz * dz;
    }
    const c = coord as CellCoord2;
    const dz = (c[1] + 0.5) * size - vz;
    return dx * dx + dz * dz;
  }

  /**
   * Coordinate of the parent-level cell containing this cell's center.
   * Modes map as documented on {@link LevelDef.cellMode}: like under
   * like contains the center; a 3D child under a 2D parent maps to the
   * XZ column cell; a `"path"` child maps to the parent SECTOR containing
   * its arc midpoint (both levels ride one table, enforced at
   * construction); 2D under 3D, and any mix of `"path"` with a
   * world-space mode, were rejected at construction.
   */
  private parentCoordOf(level: LevelState, coord: CellCoord): CellCoord {
    const parent = this.levels[level.index - 1];
    if (parent.def.cellSize === "unbounded") return [0, 0];
    const size = level.def.cellSize as number;
    const psize = parent.def.cellSize;
    if (level.mode === "path") {
      const n = level.sectorCount;
      const sMid =
        (sectorBound(coord[0], n, level.sectorSize, level.pathLength) +
          sectorBound(coord[0] + 1, n, level.sectorSize, level.pathLength)) /
        2;
      // Against the PARENT's sector size, not its cellSize: cellSize is a
      // target that round() turned into whole sectors, so only the
      // parent's own sector size addresses its cells. The clamp catches
      // the last sector, whose midpoint can land on the table length.
      const pi = Math.floor(sMid / parent.sectorSize);
      return [Math.min(Math.max(pi, 0), parent.sectorCount - 1)];
    }
    if (level.mode === "xyz") {
      const c = coord as CellCoord3;
      const px = nz(Math.floor(((c[0] + 0.5) * size) / psize));
      const pz = nz(Math.floor(((c[2] + 0.5) * size) / psize));
      return parent.mode === "xyz"
        ? [px, nz(Math.floor(((c[1] + 0.5) * size) / psize)), pz]
        : [px, pz];
    }
    const c2 = coord as CellCoord2;
    return [
      nz(Math.floor(((c2[0] + 0.5) * size) / psize)),
      nz(Math.floor(((c2[1] + 0.5) * size) / psize)),
    ];
  }

  /** Reject a coordinate whose arity does not match the level's mode. */
  private checkCoordArity(level: LevelState, coord: CellCoord): void {
    const expected = level.mode === "xyz" ? 3 : level.mode === "path" ? 1 : 2;
    if (coord.length !== expected) {
      const shape =
        level.mode === "xyz"
          ? `3D "xyz" cells addressed [cx, cy, cz]`
          : level.mode === "path"
            ? `"path" cells addressed [cs] (one sector index)`
            : `2D "xz" cells addressed [cx, cz]`;
      throw new WorldValidationError(
        `level "${level.def.name}" uses ${shape}; got a ${coord.length}-component coordinate`,
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

  /** Build the {@link CellContext} handed to a cell's bind/bindPatches. */
  private cellContext(
    level: LevelState,
    coord: CellCoord,
    parent: ParentCellRef | undefined,
  ): CellContext {
    const def = level.def;
    const idx = level.index;
    // Cell-invariant anchors, handed to bind alongside the per-cell seed:
    // the world seed as configured, and the level seed the per-cell seed
    // is itself derived from. See CellContextBase.worldSeed.
    const worldSeed = this.worldSeed;
    const levelSeed = hashCombine(worldSeed, idx);
    let ctx: CellContext;
    if (def.cellSize === "unbounded") {
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "xz",
        coord: [0, 0],
        min: [-Infinity, -Infinity],
        max: [Infinity, Infinity],
        worldSeed,
        levelSeed,
        // One global cell has no coordinates to fold: the per-cell seed IS
        // the level seed, and the two are documented as equal here.
        seed: levelSeed,
        ...(parent !== undefined ? { parent } : {}),
      };
    } else if (level.mode === "path") {
      const c = coord as CellCoord1;
      const n = level.sectorCount;
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "path",
        coord: c,
        sMin: sectorBound(c[0], n, level.sectorSize, level.pathLength),
        sMax: sectorBound(c[0] + 1, n, level.sectorSize, level.pathLength),
        pathLength: level.pathLength,
        closed: level.pathClosed,
        worldSeed,
        levelSeed,
        seed: hashCombine(worldSeed, idx, c[0]),
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
        worldSeed,
        levelSeed,
        seed: hashCombine(worldSeed, idx, c[0], c[1], c[2]),
        ...(parent !== undefined ? { parent } : {}),
      };
    } else {
      const s = def.cellSize;
      const c = coord as CellCoord2;
      ctx = {
        levelIndex: idx,
        levelName: def.name,
        cellMode: "xz",
        coord: [c[0], c[1]],
        min: [c[0] * s, c[1] * s],
        max: [(c[0] + 1) * s, (c[1] + 1) * s],
        worldSeed,
        levelSeed,
        seed: hashCombine(worldSeed, idx, c[0], c[1]),
        ...(parent !== undefined ? { parent } : {}),
      };
    }
    return ctx;
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
    const ctx = this.cellContext(level, coord, parent);
    // A version change since the level's last baseline means user code
    // edited the graph mid-update (e.g. inside onCellReady): charge it
    // now, so cells cooked earlier this update recook next update instead
    // of silently keeping pre-edit content.
    if (level.baselineVersion !== undefined && def.graph.version !== level.baselineVersion) {
      for (const rec of level.cells.values()) rec.stale = true;
    }
    if (def.bind !== undefined) {
      def.bind(def.graph, ctx);
    } else {
      // bindPatches without a pool: the local fallback. The SAME
      // application code the cook worker host runs (applyParamPatches),
      // so the two paths cannot drift — a patched level cooks to the
      // same bytes with and without WorldOptions.pool.
      const { patches, seed } = normalizeBindPatches(
        (def.bindPatches as NonNullable<LevelDef["bindPatches"]>)(ctx),
      );
      applyParamPatches(def.graph, patches, `level "${def.name}" bindPatches`);
      if (seed !== undefined) def.graph.setSeed(seed);
    }
    // Re-baseline after the runtime's own writes: only user edits leave
    // version and baseline disagreeing at the next check.
    level.baselineVersion = def.graph.version;
    const result = await cook(def.graph, {
      signal: opts.signal,
      budgetMs: opts.budgetMs,
      outputs: def.cookOutputs,
      // Update-level resolver wins over the world-level one; both absent
      // means a CPU-only cook (byte-identical to pre-GPU behavior).
      gpu: opts.gpu ?? this.gpu,
    });
    this.storeCell(level, coord, result.outputs, cooked);
  }

  /**
   * Dispatch a pooled level's cook queue to the backend, then land the
   * results in queue order. Dispatching is what the update budget and
   * cook cap meter here (the cooks run off-thread); landing stores each
   * cell, cascades staleness to its stored children, and fires
   * `onCellReady` — in the same deterministic order a local cook loop
   * would have. Returns the pending count.
   */
  private async cookLevelPooled(
    level: LevelState,
    queue: readonly WantedCell[],
    pool: CookBackend,
    opts: UpdateOptions,
    start: number,
    cooked: CellId[],
  ): Promise<number> {
    const { budgetMs, signal, maxCooksPerUpdate } = opts;
    const def = level.def;
    let pending = 0;
    // bindPatches must not touch the graph, so the runtime writes nothing
    // here: baseline now, and any version movement seen later is a user
    // edit (charged by the level-start check next update).
    level.baselineVersion = def.graph.version;
    const dispatched: { coord: CellCoord; result: Promise<CellOutputs> }[] = [];
    for (const w of queue) {
      if (signal?.aborted) {
        settleQuietly(dispatched);
        throw new CookCancelledError();
      }
      if (
        (maxCooksPerUpdate !== undefined && cooked.length + dispatched.length >= maxCooksPerUpdate) ||
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
      const ctx = this.cellContext(level, w.coord, parent);
      const { patches, seed } = normalizeBindPatches(
        (def.bindPatches as NonNullable<LevelDef["bindPatches"]>)(ctx),
      );
      dispatched.push({
        coord: w.coord,
        result: pool.cookCell({
          graph: def.graph,
          patches,
          ...(seed !== undefined ? { seed } : {}),
          ...(def.cookOutputs !== undefined ? { outputs: def.cookOutputs } : {}),
          ...(signal !== undefined ? { signal } : {}),
        }),
      });
    }
    for (let i = 0; i < dispatched.length; i++) {
      let outputs: CellOutputs;
      try {
        outputs = await dispatched[i].result;
      } catch (err) {
        // Keep the later results from becoming unhandled rejections;
        // their cells simply recook next update (nothing was stored).
        settleQuietly(dispatched.slice(i + 1));
        throw err;
      }
      this.storeCell(level, dispatched[i].coord, outputs, cooked);
    }
    return pending;
  }

  /** Store a cooked cell's outputs and run the post-cook bookkeeping. */
  private storeCell(
    level: LevelState,
    coord: CellCoord,
    outputs: CellOutputs,
    cooked: CellId[],
  ): void {
    const key = cellKey(coord);
    let rec = level.cells.get(key);
    if (rec === undefined) {
      rec = {
        coord,
        outputs,
        stale: false,
        cookedAt: ++this.cookCounter,
        lastUsed: ++this.useCounter,
      };
      level.cells.set(key, rec);
    } else {
      rec.outputs = outputs;
      rec.stale = false;
      rec.cookedAt = ++this.cookCounter;
      rec.lastUsed = ++this.useCounter;
    }

    // Parent content flows into children at their bind time, so a (re)cook
    // here may change what stored children consumed: mark them stale. They
    // recook when next wanted (child levels are processed after this one,
    // so a same-update child recook already sees the new outputs).
    const childLevel = this.levels[level.index + 1];
    if (childLevel !== undefined) {
      for (const childRec of childLevel.cells.values()) {
        const pc = this.parentCoordOf(childLevel, childRec.coord);
        if (coordsEqual(pc, coord)) childRec.stale = true;
      }
    }

    this.totalCooked++;
    cooked.push({ level: level.def.name, coord: rec.coord });
    this.onCellReady?.(level.def.name, rec.coord, rec.outputs);
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
