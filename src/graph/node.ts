import type { GpuFieldResolver } from "../fields/index.js";
import type { DataCollection } from "./data.js";

/** What a pin carries; `any` is a wildcard compatible with every other kind. */
export type PinKind = "geometry" | "value" | "instances" | "any";

/** One input or output pin of a node definition. */
export interface PinDef {
  readonly name: string;
  readonly kind: PinKind;
  /**
   * Input pins only: accept multiple connections; their collections are
   * concatenated in connection order.
   */
  readonly multi?: boolean;
}

/** What execute returns: one collection per declared output pin. */
export type NodeOutputs = Record<string, DataCollection>;

/**
 * Arguments passed to a node's execute.
 *
 * There is deliberately no runtime context here — no cell coordinate, no
 * level, no world. A node's outputs must be a pure function of
 * `(params, seed, inputs)`, which is exactly what the executor memoizes
 * on; a node that could read which cell was asking would produce
 * different bytes for the same key, and a world-anchored source would
 * become unreproducible across query windows. Runtime facts reach a node
 * only as params, written by `LevelDef.bind` from the cell context —
 * including the cell-invariant anchors (`ctx.worldSeed`, `ctx.levelSeed`)
 * a world-anchored node needs.
 */
export interface NodeExecuteArgs<P> {
  /**
   * One collection per input pin (empty when unconnected; multi pins
   * concatenate their connections in connection order). Inputs are
   * immutable: a node transforming geometry must clone it first (see
   * `cloneGeometry`) — upstream caches hold these same objects.
   */
  readonly inputs: Record<string, DataCollection>;
  /**
   * Node params. Params may hold `Field` values — resolve them with the
   * fields API (`resolveField`/`evaluateField`) when applying to geometry.
   */
  readonly params: P;
  /** Seed already derived for this node instance (graph seed + node id). */
  readonly seed: number;
  /** Cook-scoped abort signal, when the cook was given one. */
  readonly signal?: AbortSignal;
  /**
   * Soft time budget of the enclosing cook, when one was set. Composite
   * nodes (e.g. subgraphs) forward it to nested cooks so inner work
   * yields on the same policy.
   */
  readonly budgetMs?: number;
  /**
   * GPU field resolver of the enclosing cook, when one was passed via
   * `CookOptions.gpu` (already wrapped so its counters land in this
   * cook's `CookStats.gpu`). Nodes that adopt GPU resolution try it for
   * spec'd Field params and fall back to the synchronous CPU evaluation
   * when it returns null; composite nodes (subgraphs) forward it to
   * nested cooks. Absent on CPU-only cooks — behavior and bytes are then
   * exactly the pre-GPU ones.
   */
  readonly gpu?: GpuFieldResolver;
  /**
   * Throws `CookCancelledError` if the cook was aborted. Nodes doing long
   * loops should call it periodically so cancellation stays responsive.
   */
  checkCancelled(): void;
}

/**
 * Declares that a node type can be fused into a device-resident run: a
 * linear chain of such nodes whose intermediate geometry stays on the
 * GPU, with a single readback at the chain's terminal. Purely
 * declarative — core never contains device code; a resolver that
 * implements the optional run methods (see `GpuFieldResolver.planRun`)
 * receives the `kind` string and decides whether it can compile the
 * node's semantics. Unknown kinds simply fail planning and fall back to
 * the per-node path, so third-party nodes may declare kinds a future
 * resolver understands.
 *
 * A resident-capable node must be element-count-preserving on its
 * single geometry input → single geometry output, and its semantics for
 * a given `kind` must match the CPU `execute` exactly (the CPU path
 * remains the bit-exact reference).
 */
export interface ResidentDesc<P = Record<string, unknown>> {
  /**
   * Machine-readable semantic identity of the node's device-resident
   * form (e.g. `"setAttribute"`, `"transformPoints"`). The resolver's
   * planner maps this to an apply kernel.
   */
  readonly kind: string;
  /**
   * Optional param-dependent gate: return false for param combinations
   * whose execute takes a path the resident kind does not model (e.g.
   * setAttribute's string modes). Ineligible nodes cook on the normal
   * per-node path and never join a run. Must be cheap and pure.
   *
   * Returning a non-empty STRING means the same thing as `false` — the
   * node does not fuse — but additionally names the reason, which the
   * executor counts once per cook in `CookStats.gpu.fallbacks` under
   * exactly that key. Use it for the cases an author can act on — a
   * param setting they could change to get the device path — and plain
   * `false` for combinations that are simply not this kind's business.
   * No standard node declares one today.
   */
  eligible?(params: P): boolean | string;
  /**
   * Declares the node a run TERMINAL: it may be the LAST member of a
   * device-resident run and a chain never continues through it. Only
   * terminal nodes may declare output pins beyond the single geometry
   * one (the run executor produces the terminal's whole output map, so
   * a resolver must model every extra pin of the kinds it accepts);
   * every other node still needs exactly one geometry output to fuse.
   *
   * Terminal fusion is opt-in at the device seam as well: a terminal
   * node joins a run only when the cook's resolver lists its `kind` in
   * `GpuFieldResolver.residentTerminals`. Without that it is inert and
   * the node cooks exactly as it always has.
   */
  readonly terminal?: boolean;
}

/**
 * A node type: typed pins, default params, and a pure execute function.
 *
 * Purity contract: execute must treat its inputs as immutable and derive
 * all randomness from `seed`. Same (params, seed, inputs) must produce the
 * same outputs — the executor memoizes on exactly that.
 */
export interface NodeDef<P = Record<string, unknown>> {
  /** Node type name (also the auto-id prefix for instances). */
  readonly type: string;
  readonly inputs: readonly PinDef[];
  readonly outputs: readonly PinDef[];
  /** Params a fresh instance starts with (shallow-merged with overrides). */
  readonly defaultParams: P;
  /** Produce one collection per output pin; may be async. */
  execute(args: NodeExecuteArgs<P>): NodeOutputs | Promise<NodeOutputs>;
  /**
   * Declares how the node participates in GPU field resolution, for memo
   * key provenance: when a cook carries a `gpu` resolver, the executor
   * appends the resolver's cache salt to this node's memo key so bytes
   * cooked with and without (or with a different) device never serve
   * each other. `"fields"` (adopting nodes like setAttribute) appends
   * only when a live param holds a Field carrying a serializable spec —
   * params without spec'd fields cook identically either way and keep
   * their cache across the toggle. `"always"` (composite nodes that
   * forward the resolver into an inner cook, i.e. subgraphs) appends
   * whenever a resolver is present — deliberately conservative
   * over-invalidation, since the wrapper cannot see which inner nodes
   * adopt. Omit for nodes that never touch GPU resolution: their memo
   * keys ignore the resolver entirely.
   */
  readonly gpu?: "fields" | "always";
  /**
   * Declares the node fusable into device-resident runs; see
   * {@link ResidentDesc}. Only consulted when a cook's resolver
   * implements the optional run methods; otherwise (and on CPU-only
   * cooks) it is inert and behavior is byte-identical to a build
   * without it. Structural requirements checked by the executor:
   * exactly one non-multi geometry input pin, and exactly one geometry
   * output pin — plus, for a `terminal` node only, any number of
   * non-geometry output pins.
   */
  readonly resident?: ResidentDesc<P>;
  /**
   * Optional extra memo-key component, read before each cook of an
   * instance. Use it to fold state living outside params into the cache
   * key (e.g. a wrapped inner graph's edit version): an unchanged string
   * lets the cache be served, a changed one forces a recook.
   */
  memoKey?(): string;
}

/** Identity helper that preserves the param type `P` of a node definition. */
export function defineNode<P>(def: NodeDef<P>): NodeDef<P> {
  return def;
}
