import type { DataCollection } from "./data.js";

/** What a pin carries; `any` is a wildcard compatible with either kind. */
export type PinKind = "geometry" | "value" | "any";

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

/** Arguments passed to a node's execute. */
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
   * Throws `CookCancelledError` if the cook was aborted. Nodes doing long
   * loops should call it periodically so cancellation stays responsive.
   */
  checkCancelled(): void;
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
}

/** Identity helper that preserves the param type `P` of a node definition. */
export function defineNode<P>(def: NodeDef<P>): NodeDef<P> {
  return def;
}
