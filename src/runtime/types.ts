/**
 * Hierarchical runtime model: grid levels, cells, and the bind contract.
 *
 * By default cells are 2D on the XZ plane: a bounded level partitions the
 * plane into square cells of `cellSize` world units, and a cell covers
 * `[cx*size, (cx+1)*size) x [cz*size, (cz+1)*size)` in X and Z while being
 * unbounded in Y. A level may opt into fully 3D cube cells with
 * `cellMode: "xyz"` (see {@link LevelDef.cellMode}), partitioning Y the
 * same way and addressing cells `[cx, cy, cz]`.
 *
 * A level may also partition ARC LENGTH instead of space, with
 * `cellMode: "path"`: a cell is then a half-open arc range `[sMin, sMax)`
 * along a curve, addressed by a single sector index `[cs]`, and it streams
 * as "the next N metres" rather than as a disc. That is what
 * one-dimensional content — a racetrack, a road, a river — actually wants.
 * Such a level may also state its window DIRECTIONALLY
 * ({@link LevelDef.aheadArc} / {@link LevelDef.behindArc}), because the
 * thing riding a curve is usually going one way along it.
 */
import type { CookResult, Graph } from "../graph/index.js";

/**
 * One serializable param write: "set `param` on the node with id `node`
 * to `value`". The value is plain JSON — a number, string, boolean, a
 * numeric array, or (on a field-capable param) a FieldSpec object as
 * produced by `fieldToJson` — never a live `Field`, `DataItem`, or any
 * other runtime object, because a patch must survive `postMessage` to a
 * cook worker byte-for-byte. Applied by `applyParamPatches`, which
 * validates the value against the target param's registered schema and
 * interprets FieldSpec objects through `fieldFromJson`.
 */
export interface ParamPatch {
  /** Id of the node instance to patch. */
  readonly node: string;
  /** Param name on that node. */
  readonly param: string;
  /** Plain-JSON value (or FieldSpec object on a field-capable param). */
  readonly value: unknown;
}

/**
 * The richer return form of {@link LevelDef.bindPatches}: param patches
 * plus an optional graph seed (the serializable equivalent of calling
 * `graph.setSeed` inside `bind`, with the same caveats documented there).
 */
export interface BindPatches {
  readonly patches: readonly ParamPatch[];
  /** When present, the graph seed is set (u32) before the cell cooks. */
  readonly seed?: number;
}

/** One remote cell cook: the level graph plus this cell's patches. */
export interface CellCookRequest {
  /**
   * The level's graph. A backend serializes it (once per structural
   * version) and cooks the serialized form, so everything in it must
   * survive `serializeGraph`: registered node types only, field params
   * authored via `fieldFromJson`, no live item-list bindings.
   */
  readonly graph: Graph;
  /** Per-cell param patches (see {@link ParamPatch}). */
  readonly patches: readonly ParamPatch[];
  /** Graph seed to set before cooking, when the bind asked for one. */
  readonly seed?: number;
  /** Cook only these declared outputs (see `CookOptions.outputs`). */
  readonly outputs?: readonly string[];
  /** Aborts the cook; the promise rejects with `CookCancelledError`. */
  readonly signal?: AbortSignal;
}

/**
 * Where a `World` sends cell cooks instead of cooking on its own thread —
 * see `WorldOptions.pool`. The shipped implementation is `CookWorkerPool`
 * (`pcg-ts/worker`); anything with this shape works, so a test double or
 * a custom scheduler can stand in.
 *
 * Contract: the returned outputs must be byte-identical to cooking the
 * same graph with the same patches locally (the determinism invariant
 * crosses the thread boundary unchanged), and the promise must reject
 * with `CookCancelledError` when `signal` aborts.
 */
export interface CookBackend {
  cookCell(req: CellCookRequest): Promise<CellOutputs>;
}

/** Integer grid coordinate of a 2D cell on the XZ plane: `[cx, cz]`. */
export type CellCoord2 = readonly [cx: number, cz: number];

/** Integer grid coordinate of a 3D cube cell: `[cx, cy, cz]`. */
export type CellCoord3 = readonly [cx: number, cy: number, cz: number];

/**
 * Integer coordinate of a `"path"` cell: `[cs]`, the sector index along
 * the level's centreline (sector 0 starts at arc length 0).
 */
export type CellCoord1 = readonly [cs: number];

/**
 * Integer grid coordinate of a cell: `[cx, cz]` for `"xz"` levels,
 * `[cx, cy, cz]` for `"xyz"` levels, `[cs]` for `"path"` levels.
 */
export type CellCoord = CellCoord2 | CellCoord3 | CellCoord1;

/** Cell partitioning mode of a level; see {@link LevelDef.cellMode}. */
export type CellMode = "xz" | "xyz" | "path";

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
   * The World's own seed (u32, `WorldOptions.seed`) — identical for every
   * cell of every level, and the coarsest cell-INVARIANT anchor a bind can
   * hand a node.
   *
   * {@link CellContextBase.seed} is per-cell by construction, so a node
   * whose content must not move when the query window moves (a
   * world-anchored source such as `pointScatterInWorld`, or anything
   * deriving a halo from world coordinates) cannot be seeded from it: the
   * same world position would hash differently depending on which cell
   * asked. Bind such a node's seed param from `worldSeed` or
   * {@link CellContextBase.levelSeed} and pass only the query WINDOW per
   * cell.
   */
  readonly worldSeed: number;
  /**
   * Per-level seed (u32): `hashCombine(worldSeed, levelIndex)` — identical
   * for every cell of this level, and the value
   * {@link CellContextBase.seed} is derived from before the coordinates
   * are folded in.
   *
   * Use it where {@link CellContextBase.worldSeed} would work but two
   * levels should not agree: two levels running the same world-anchored
   * graph get unrelated content from `levelSeed` and identical content
   * from `worldSeed`. For an unbounded level (one global cell) `levelSeed`
   * and `seed` are the same number — there are no coordinates to fold.
   */
  readonly levelSeed: number;
  /**
   * Per-cell seed (u32), hash-combined from the world seed, the level
   * index, and every cell coordinate:
   * `hashCombine(worldSeed, levelIndex, cx, cz)` for an `"xz"` cell,
   * `hashCombine(worldSeed, levelIndex, cx, cy, cz)` for an `"xyz"`
   * cell, `hashCombine(worldSeed, levelIndex, cs)` for a `"path"` cell,
   * and `hashCombine(worldSeed, levelIndex)` for an unbounded
   * level. Bind must wire it into every stochastic node (e.g. its `seed`
   * param) so different cells produce different, reproducible content.
   *
   * The chain's length prefix keeps the three coordinate arities
   * structurally distinct, so no 1-, 2- and 3-tuple chains collide.
   *
   * The exception is a world-anchored node, whose whole point is that its
   * content does NOT vary with the cell asking — seed those from
   * {@link CellContextBase.worldSeed} or
   * {@link CellContextBase.levelSeed} instead.
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
  /**
   * {@link min}, moved out by the level's {@link LevelDef.halo} — the
   * QUERY window, where `min`/`max` are the OWNERSHIP window.
   *
   * A level that declares no halo gets `min` back here unchanged, so a
   * bind may read this pair unconditionally. Bind a source's query bounds
   * to these and its ownership clip to `min`/`max`, and the widening
   * becomes the runtime's arithmetic instead of a constant living in the
   * author's module — which is the whole reason the halo is declared: a
   * number the runtime computes is a number the runtime can also CHECK
   * against what the level's graph asks for (`neighborReach`, in
   * `src/runtime/reach.ts`).
   */
  readonly haloMin: readonly [number, number];
  /** {@link max}, moved out by {@link LevelDef.halo}; see {@link haloMin}. */
  readonly haloMax: readonly [number, number];
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
  /**
   * {@link min}, moved out by the level's {@link LevelDef.halo} — the
   * query window to the ownership window `min`/`max`, and equal to `min`
   * on a level that declares no halo. See {@link CellContextXZ.haloMin}.
   */
  readonly haloMin: readonly [number, number, number];
  /** {@link max}, moved out by {@link LevelDef.halo}; see {@link haloMin}. */
  readonly haloMax: readonly [number, number, number];
}

/**
 * Cell context of a `"path"` level: one half-open ARC RANGE along the
 * level's centreline; see {@link CellContext}.
 *
 * It deliberately carries no `min`/`max`. An arc sector is a curved tube,
 * so a world-space box would be a lie about what the cell covers, and a
 * third `min` under the same name — 2-arity on {@link CellContextXZ},
 * 3-arity on {@link CellContextXYZ} — would let the common
 * `ctx.cellMode === "xyz" ? … : (xz)` else-branch read `min[1]` as z and
 * be silently wrong. Omitting it breaks that pattern at COMPILE time
 * instead: narrow on `cellMode` explicitly.
 */
export interface CellContextPath extends CellContextBase {
  /** Discriminant: this level partitions arc length along a curve. */
  readonly cellMode: "path";
  /** Integer sector index `[cs]`; sector 0 starts at arc length 0. */
  readonly coord: CellCoord1;
  /** Arc length where this sector starts, inclusive. */
  readonly sMin: number;
  /** Arc length where this sector ends, exclusive. */
  readonly sMax: number;
  /**
   * Total arc length of the table this level rides
   * (`LevelDef.path.length`), repeated here so a bind never has to reach
   * back into the level definition to wrap a value.
   */
  readonly pathLength: number;
  /**
   * Whether the centreline joins its own start (`LevelDef.path.closed`),
   * so the last sector is adjacent to sector 0 across the `s = 0` seam.
   */
  readonly closed: boolean;
}

/**
 * Everything a level's {@link LevelDef.bind} callback may derive per-cell
 * params from — a discriminated union on `cellMode` (`"xz"` levels and
 * the unbounded level get {@link CellContextXZ}, `"xyz"` levels get
 * {@link CellContextXYZ}, `"path"` levels get {@link CellContextPath}).
 * For determinism, cell content must be a pure
 * function of this context (plus the level graph's structure and
 * params): bind must not read clocks, `Math.random`, viewpoint position,
 * or any other state.
 */
export type CellContext = CellContextXZ | CellContextXYZ | CellContextPath;

/**
 * One level of the hierarchical runtime: a graph cooked once per cell.
 *
 * Levels are ordered coarse to fine: at most one `unbounded` level is
 * allowed and it must come first, and bounded `cellSize`s must strictly
 * decrease WITHIN a mode family — the world-space modes (`"xz"`,
 * `"xyz"`) compare against each other and `"path"` levels against each
 * other, because an arc length and a world length are not comparable
 * quantities. Each level's `generationRadius` should be at least as large
 * as every finer level's, so a wanted cell's parent is also wanted —
 * a cell whose parent cell was never cooked stays pending. That rule
 * applies PER HALF to a directional `"path"` window: a child wanting 400
 * units ahead under a parent wanting 200 leaves the far half of the
 * child's window pending forever, exactly as an oversized radius would.
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
   * - `"path"`: ARC LENGTH along a curve, addressed by one sector index
   *   `[cs]`. The level's {@link LevelDef.path} table is split into
   *   `round(length / cellSize)` equal sectors — so the seam falls
   *   exactly at `s = 0` — and a cell is the half-open arc range
   *   `[sMin, sMax)`. Position comes from `UpdateOptions.anchors`
   *   (keyed by level name), not from the viewpoint, and the radii are
   *   arc distances to the sector's nearest bound, so a `"path"` level
   *   streams "the next N metres" rather than a disc. Cells are neither
   *   generated nor retained by any world-space measure. The window may
   *   be symmetric ({@link generationRadius}) or directional
   *   ({@link aheadArc} + {@link behindArc}) — one spelling per level,
   *   and the second is refused alongside the first.
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
   * - `"path"` under `"path"`: both levels ride ONE table (same
   *   `path.length` and `path.closed`, enforced at construction) and the
   *   parent is the sector containing this sector's arc midpoint.
   * - `"path"` under a bounded `"xz"`/`"xyz"` parent, and `"xz"`/`"xyz"`
   *   under a bounded `"path"` parent, are both rejected at World
   *   construction: an arc sector is a tube along a curve, so no square
   *   cell contains it and it contains no square cell — the same
   *   argument that rejects `"xz"` under `"xyz"`.
   * - An unbounded parent (one global cell) accepts any mode below.
   *
   * Ignored for an unbounded level (a single global cell partitions
   * nothing) — including `"path"`, which needs sectors to mean anything.
   */
  readonly cellMode?: CellMode;
  /**
   * The arc-length table a `"path"` level partitions: the centreline's
   * total `length` and whether it `closed`s on itself. Required when
   * {@link cellMode} is `"path"`, rejected otherwise. `length` must be a
   * positive finite number, `closed` a boolean.
   *
   * Two numbers, and no geometry: `length` + `closed` + `cellSize` is
   * everything the wanted set needs, so the World never becomes
   * content-aware — it does not know, or need, where the curve goes.
   *
   * It is deliberately STATIC and cannot come from a parent level's
   * outputs. `World.update` builds the wanted set before it consults any
   * parent cell (parent outputs only exist at bind time), so a table
   * sourced from a parent would make wanted-set membership a function of
   * cook state: nothing would be wanted on the first update, and the
   * "same result whatever the cook order" invariant would no longer
   * hold. A level whose centreline is generated upstream still declares
   * the table's length here — as configuration, matching the curve it
   * will be handed.
   */
  readonly path?: {
    /** Total arc length of the centreline (positive, finite). */
    readonly length: number;
    /** True when the centreline joins its own start at `s = 0`. */
    readonly closed: boolean;
  };
  /**
   * Cells generate when their center enters this radius around the
   * viewpoint: distance in XZ for `"xz"` levels, in XYZ for `"xyz"`
   * levels (both in world units). For `"path"` levels it is instead an
   * ARC distance, in the same units as `path.length`, from the level's
   * anchor to the sector's nearest bound — the SYMMETRIC spelling of the
   * window {@link aheadArc} / {@link behindArc} state directionally, and
   * exactly equivalent to `aheadArc = behindArc = generationRadius`.
   * Required for bounded levels (a positive finite number), except a
   * `"path"` level that states the directional pair instead, where it is
   * refused. Optional for an unbounded level: omit it, or pass a value
   * and it is accepted and ignored — both spellings are valid, so configs
   * written before it became optional keep working unchanged.
   */
  readonly generationRadius?: number;
  /**
   * Hysteresis: a generated cell is kept until its center exits this
   * radius (same distance metric and units as `generationRadius`, so arc
   * length for a `"path"` level). Defaults to `generationRadius * 1.25`;
   * must be >= `generationRadius`. Ignored for an unbounded level, and
   * refused on a `"path"` level with a directional window, which uses
   * {@link retainAheadArc} / {@link retainBehindArc} instead — see the
   * argument there for why one scalar cannot serve two unequal halves.
   */
  readonly retainRadius?: number;
  /**
   * How far AHEAD of the anchor a `"path"` level wants sectors, in the
   * units of {@link path}`.length`. Its partner {@link behindArc} states
   * the other half; together they REPLACE {@link generationRadius} on
   * this level, which is refused alongside them. Finite and >= 0.
   *
   * WHY A WINDOW RATHER THAN A RADIUS. A radius is the right shape for a
   * viewpoint that may turn around: every direction is equally likely, so
   * the want-set is a disc. A car at racing speed is the opposite case.
   * It will be four hundred metres further down the road in a few seconds
   * and will not revisit the hundred metres behind it this lap, so a
   * symmetric window spends half its cell budget on road already spent
   * and still runs out of road in front. `aheadArc: 400, behindArc: 100`
   * keeps the same 500 units of track resident as
   * `generationRadius: 250` and puts four fifths of it where the car is
   * going. That is not a tuning preference, it is the reason
   * `cellMode: "path"` exists: content on a curve is consumed in one
   * direction, and a disc is the shape that ignores that.
   *
   * "AHEAD" NEEDS NO HEADING INPUT. The table has its own direction —
   * increasing arc IS ahead, by the same convention that puts sector 0 at
   * `s = 0` — so a level travelled the other way states its window
   * mirrored (`aheadArc: 100, behindArc: 400`) rather than passing a
   * reverse flag. A flag would have to be one of two things, and both are
   * worse: static configuration, in which case the mirrored window
   * already IS it under a shorter name, or per-update state, in which
   * case which sectors are wanted becomes a function of the frame that
   * asked and the cook schedule stops being reproducible from
   * configuration plus anchor path.
   *
   * IT IS POLICY, WHICH IS WHY IT LIVES HERE AND NOT ON `update`. The
   * anchor is a COORDINATE and moves every frame; the window is the same
   * kind of thing as `generationRadius` and `maxCellsPerLevel` — a
   * standing statement of how much of the world this level keeps
   * resident. The runtime already draws that line, and a per-frame window
   * would cross it: two runs feeding the same anchors would want
   * different sets, and "same result whatever the cook order" would no
   * longer be checkable.
   *
   * ZERO IS LEGAL, unlike `generationRadius`, which must be positive.
   * `behindArc: 0` wants the sector the anchor is standing in — the
   * anchor is inside it, so its gap is zero on both sides — and nothing
   * further back. A level that never looks behind is the limit case of
   * the feature, not a misconfiguration.
   *
   * A WINDOW LONGER THAN THE TABLE CLAMPS TO THE TABLE. On a closed
   * table, `aheadArc + behindArc >= path.length` wants every sector
   * exactly once (each claimed by whichever half reaches it in fewer arc
   * units, which is also the order they cook in); widening further
   * changes nothing, and the two halves never fight over a sector because
   * the wanted set is keyed by sector index. It is deliberately not an
   * error: a short circuit with a long look-ahead is a real
   * configuration — "keep the whole lap resident" — and refusing it would
   * turn an edit to `path.length` into a breakage. On an open table the
   * overflow simply runs off the ends, where no sectors exist.
   */
  readonly aheadArc?: number;
  /**
   * How far BEHIND the anchor a `"path"` level wants sectors (decreasing
   * arc), in the units of {@link path}`.length`. The other half of
   * {@link aheadArc} — see there for the whole argument, including why
   * both halves must be stated, why 0 is legal, and what an over-long
   * window means. Finite and >= 0.
   */
  readonly behindArc?: number;
  /**
   * Hysteresis for the AHEAD half of a directional `"path"` window: a
   * generated sector is kept until it lies more than this many arc units
   * ahead of the anchor. Defaults to `aheadArc * 1.25` — the same 1.25
   * {@link retainRadius} applies, applied to this half alone — and must
   * be finite and >= `aheadArc`.
   *
   * WHY EACH HALF SCALES INDEPENDENTLY. A single retain scalar across
   * both halves is not a simpler version of this rule, it is a different
   * and worse one, and it fails in both directions. Take
   * `aheadArc: 400, behindArc: 100`. One retain of 500 keeps a sector
   * that is 480 units BEHIND — the behind half silently grows to five
   * times the depth that was asked for, until the LRU cap starts
   * arbitrating what the window was supposed to. One retain of 125 strips
   * the ahead half's band instead: a sector 130 ahead is wanted, cooked,
   * and evicted in the same update, and wanted again on the next one —
   * the exact thrash the band exists to prevent, for a car parked just
   * past a boundary. There is no third value that serves both halves,
   * because the halves are unequal by construction. So `retainRadius` is
   * REFUSED alongside a directional window rather than quietly applied to
   * both: the config that cannot express the intent should not typecheck
   * into the one that gets it wrong.
   */
  readonly retainAheadArc?: number;
  /**
   * Hysteresis for the BEHIND half of a directional `"path"` window; the
   * partner of {@link retainAheadArc}, defaulting to `behindArc * 1.25`
   * and required to be finite and >= `behindArc`. See there for why the
   * two halves carry their own bands instead of sharing one scalar.
   */
  readonly retainBehindArc?: number;
  /**
   * How far outside its own rectangle this level's cells QUERY, in world
   * units. `"xz"` and `"xyz"` levels only, and optional.
   *
   * This is not a streaming window like {@link generationRadius} — those
   * say which cells stay resident — it is the width of the band of
   * neighbouring content each cell must generate and then throw away so
   * that the points it KEEPS get the same answers they would get in one
   * unpartitioned cook. Declaring it does two things:
   *
   *   - The runtime hands each bind the widened box as
   *     {@link CellContextXZ.haloMin}/`haloMax` alongside the unwidened
   *     `min`/`max`, so the arithmetic that used to live as a `const` in
   *     the author's module is done once, by the runtime, from the number
   *     the level declares.
   *   - `World` CHECKS it, at construction, against what this level's
   *     graph asks for. A node querying neighbours within R inside a cell
   *     given a halo of H < R receives a truncated neighbour set and
   *     writes an answer that differs from the unstreamed one at every
   *     seam — deterministically, and without throwing. That is the bug
   *     this field exists to make loud.
   *
   * WHAT THE CHECK PROVES, AND WHAT IT DOES NOT. It proves `halo` is at
   * least every neighbour-query reach the graph states as a literal
   * number. It cannot prove the converse — three reaches are invisible to
   * any static read, and `neighborReach` (`src/runtime/reach.ts`, not on
   * the package's public surface yet) reports each of them by name
   * rather than passing them over: a radius that is a `Field` (whose
   * bound is the global maximum the expression can return anywhere in the
   * world, derived by the author and unmeasurable from a clipped cell),
   * the unlimited sentinels (`sampleNearestPoint.maxDistance` of 0 means
   * unlimited, not zero, and `transferAttribute`'s DEFAULT mapping caps
   * nothing at all), and the nodes whose reach comes out of upstream
   * geometry rather than a param (`occlusionCull`, `pathCoverage`).
   *
   * The widest gap is the one that produces no entry at all: a node type
   * the reader has no table for is SILENT, and the whole-input family —
   * `transferAlongPath`, `pathScan`, `pathRuns`, `runFit`,
   * `attributeReduce`, `quotaRebalance`, `mergePoints` — reads what it
   * was given rather than a neighbourhood, so a cell holding a fraction
   * of the input computes a different answer and no halo is the fix.
   * Passing this check says nothing about them.
   *
   * It is also a check on the graph AS BUILT, which leaves two things a
   * bind can do to it invisible: a bind that ignores `haloMin`/`haloMax`
   * and widens by its own constant, and a bind that RAISES a reach per
   * cell (`g.setParam(count, "radius", 40)` under a declared halo of 2).
   * Both type-check and cook. Derive bind's params from `ctx` and static
   * configuration, as the determinism contract above already requires,
   * and neither arises.
   *
   * The declaration is worth having anyway — a wrong number the runtime
   * reads is checkable, and a right number that only a comment knows is
   * not — but read it as a floor, never as a certificate.
   *
   * REFUSED on an unbounded level (one global cell has no neighbour to
   * borrow from) and on a `"path"` level (a sector is measured in ARC
   * LENGTH while every reach in the graph is a world distance, and the
   * two do not convert without the centreline, which the World never
   * sees — the same reason `cellSize` is only ever compared within a mode
   * family).
   */
  readonly halo?: number;
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
   * channel through which cell data enters the graph. Every level defines
   * exactly one of `bind` (imperative, in-place) or {@link bindPatches}
   * (declarative, serializable). Typical bindings:
   * `graph.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]])`,
   * `graph.setParam(scatter, "seed", ctx.seed)`, or injecting
   * `ctx.parent.outputs` through a `dataInput` node's `items` param. A
   * `"path"` cell has no world box to read: narrow on `ctx.cellMode`
   * and bind its arc range (`ctx.sMin` / `ctx.sMax`) instead.
   *
   * Determinism contract: set params derived only from `ctx` and static
   * configuration, and fold `ctx.seed` into every stochastic node's seed
   * param (vary it per node with `hashCombine(ctx.seed, n)`). Cell content
   * then depends only on (world seed, level index, coord, graph
   * structure+params, parent cell content) — never on cook order,
   * viewpoint path, or eviction history.
   *
   * World-anchored nodes invert that rule and bind must respect it: a
   * source whose positions are a function of world coordinates (see
   * `pointScatterInWorld`) is seamless across cells only while its seed is
   * the SAME in every cell, so bind passes it `ctx.worldSeed` or
   * `ctx.levelSeed` and varies only its query window (`boundsMin` /
   * `boundsMax` from `ctx.min` / `ctx.max`). Binding the per-cell
   * `ctx.seed` there turns such a node back into a per-cell scatter:
   * content stays deterministic, but a widened query no longer reproduces
   * a neighbour's points, so halos and seams stop agreeing.
   *
   * Reseeding the whole graph per cell is also sanctioned:
   * `graph.setSeed(hashCombine(ctx.seed, salt))` inside bind
   * deterministically re-derives every node's seed (memo keys include the
   * seed, so caching stays correct), and the runtime counts bind-time
   * writes — `setSeed` and `setParam` alike — as its own, never as user
   * edits, so no phantom staleness results. It cannot de-anchor
   * `pointScatterInWorld`, whose lattice is a function of its own `seed`
   * param and never of the graph seed. It CAN move anything downstream
   * that draws on its node seed — a probabilistic `filterByDensity`,
   * `jitterPoints`, any field param resolving `randomField` or
   * `nodeSeed` (including a noise whose `opts.position` folds one in) —
   * and that
   * lands one node later exactly where de-anchoring the source used to:
   * the halo and the neighbour disagree, deterministically and silently.
   * A level whose anchored content feeds such a node should seed its
   * nodes explicitly (cell-invariantly where the result must agree across
   * a seam) rather than reseed the graph.
   *
   * Aliasing contract: arrays bound into params (e.g. a `dataInput`
   * node's `items`) are captured by reference and end up aliased by the
   * stored cell outputs. Treat them as frozen after binding — mutating
   * one in place changes stored content with no staleness signal. To
   * change data, bind a fresh array (fresh item revs) or invalidate the
   * affected cells.
   */
  bind?(graph: Graph, ctx: CellContext): void;
  /**
   * The serializable alternative to {@link bind}: instead of mutating the
   * graph, return the param patches (and optionally a graph seed) that
   * express this cell's binding as plain JSON. Every level defines exactly
   * one of the two forms.
   *
   * Same determinism contract as `bind` — derive patches only from `ctx`
   * and static configuration — plus one addition: the callback must not
   * touch the graph at all. The runtime applies the patches itself (or
   * ships them to `WorldOptions.pool`), and a graph edit made in here
   * would read as a user edit and recook the level forever.
   *
   * Why it exists: patches cross a `postMessage` boundary, so a level
   * that binds this way can cook on a worker (`WorldOptions.pool`)
   * instead of the main thread. Without a pool the runtime applies the
   * patches to the local graph and cooks exactly as `bind` would — the
   * two paths produce byte-identical cells, and that equivalence is
   * pinned by tests.
   *
   * Limits, stated rather than discovered: values must be plain JSON
   * (field params take FieldSpec objects, see {@link ParamPatch}), so a
   * live-item binding — injecting `ctx.parent.outputs` through a
   * `dataInput` node — cannot be expressed as a patch. A level that
   * consumes parent items keeps `bind` (and cooks locally); a patched
   * level that needs cross-cell agreement re-derives it world-anchored,
   * exactly as the halo/seam guidance on {@link bind} describes.
   */
  bindPatches?(ctx: CellContext): readonly ParamPatch[] | BindPatches;
}

/**
 * Narrow a cell context to its `"xz"` form, or say why it is not one.
 *
 * WHY A HELPER RATHER THAN A CAST. Every `bind` on a square-cell level
 * wants the same two things — `ctx.min` and `ctx.max`, the cell's world
 * rectangle — to set a scatter's bounds or to clip a halo back. Only a
 * world-space context has them: {@link CellContextPath} is an arc range
 * and carries no box, deliberately, so that a 2D bind handed one fails to
 * COMPILE instead of reading a 1-tuple's `min[1]` as a z that was never
 * there. That is the right trade, and it leaves every such bind needing
 * one narrowing. Three demo levels and the runtime's own test support all
 * wrote it; this is that line, once, with an error worth reading.
 *
 * A LEVEL'S BIND ALREADY KNOWS ITS OWN MODE — it declared it — so
 * reaching here with anything else is a wiring mistake rather than a case
 * to handle, and throwing is the honest response. Use it as
 * `const { min, max } = xzCell(ctx)` at the top of a bind.
 */
export function xzCell(ctx: CellContext): CellContextXZ {
  if (ctx.cellMode !== "xz") {
    throw new Error(
      `xzCell: expected an "xz" cell context (one with a world rectangle), got cellMode ` +
        `"${ctx.cellMode}". A "path" cell is an arc range [sMin, sMax) along a centreline and ` +
        `has no min/max box; read ctx.sMin and ctx.sMax instead, or declare this level ` +
        `cellMode: "xz"`,
    );
  }
  return ctx;
}
