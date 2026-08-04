import type { Field } from "../fields/index.js";
import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection, DataItem } from "./data.js";
import { CookCancelledError, GraphCycleError, GraphValidationError, NodeExecutionError } from "./errors.js";
import type { Graph } from "./graph.js";

/** Progress callback payload: one entry per node visited by a cook. */
export interface NodeDoneInfo {
  readonly id: string;
  readonly type: string;
  /** True when the node's memo key was unchanged and its cache was reused. */
  readonly cached: boolean;
  readonly elapsedMs: number;
}

/** Options for {@link cook}. */
export interface CookOptions {
  /**
   * Soft time budget: after a node completes, if more than this many ms
   * ran since the last yield, the cook yields to the event loop before
   * continuing. Cooking always completes unless aborted.
   */
  budgetMs?: number;
  /** Abort the cook; checked between nodes and via `checkCancelled` inside them. */
  signal?: AbortSignal;
  /** Called after each node is cooked or served from cache. */
  onNodeDone?: (info: NodeDoneInfo) => void;
}

/** Counters for one cook pass. */
export interface CookStats {
  /** Nodes whose execute ran. */
  cooked: number;
  /** Nodes served from their memo cache. */
  cached: number;
  elapsedMs: number;
}

/** Result of a cook: declared outputs by name, plus stats. */
export interface CookResult {
  readonly outputs: Record<string, DataCollection>;
  readonly stats: CookStats;
}

function isFieldValue(v: object): v is Field {
  const f = v as { key?: unknown; evaluate?: unknown };
  return typeof f.key === "string" && typeof f.evaluate === "function";
}

function isDataItemValue(v: object): v is DataItem {
  const it = v as { kind?: unknown; rev?: unknown };
  return (it.kind === "geometry" || it.kind === "value") && typeof it.rev === "number";
}

/**
 * Stable structural hash of a param tree, as a string. Objects hash with
 * sorted keys; Fields hash by their stable `key` identity; DataItems hash
 * by rev (data is never deep-hashed). Functions are rejected — wrap
 * behavior in a Field instead.
 */
function stableValueHash(v: unknown): string {
  if (v === null) return "z";
  switch (typeof v) {
    case "undefined":
      return "u";
    case "number":
      return `#${v}`;
    case "boolean":
      return v ? "t" : "f";
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return `#${v}n`;
    case "object": {
      const obj = v as object;
      if (isFieldValue(obj)) return `F(${obj.key})`;
      if (isDataItemValue(obj)) return `I(${obj.rev})`;
      if (Array.isArray(obj)) return `[${obj.map(stableValueHash).join(",")}]`;
      if (ArrayBuffer.isView(obj)) {
        const arr = obj as unknown as ArrayLike<number>;
        return `T(${obj.constructor.name}:${Array.from(arr).join(",")})`;
      }
      if (obj instanceof Set) {
        return `S{${[...obj].map(stableValueHash).sort().join(",")}}`;
      }
      if (obj instanceof Map) {
        const entries = [...obj].map(([k, val]) => `${stableValueHash(k)}=>${stableValueHash(val)}`);
        return `M{${entries.sort().join(",")}}`;
      }
      const rec = obj as Record<string, unknown>;
      const keys = Object.keys(rec).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableValueHash(rec[k])}`).join(",")}}`;
    }
    default:
      throw new GraphValidationError(
        `params must be structurally hashable; a ${typeof v} is not (wrap behavior in a Field)`,
      );
  }
}

/**
 * Reachable nodes from the declared outputs, upstream-first (topological).
 * Deterministic: outputs in declaration order, inputs in connection order.
 */
function topoOrder(graph: Graph): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new GraphCycleError(`cycle detected through node "${id}"`);
    state.set(id, 1);
    for (const c of graph._connections) {
      if (c.to === id) visit(c.from);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const decl of graph._outputs) visit(decl.node);
  return order;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Cook the graph: pull-based from its declared outputs, topological order,
 * sequential. Each node is memoized on (type, param hash, node seed, input
 * item revs) — an unchanged key serves the cached outputs, and unchanged
 * outputs keep their revs so cleanliness propagates downstream. Aborting
 * rejects with {@link CookCancelledError} but keeps completed nodes'
 * caches, so a re-cook resumes where the cancelled one left off.
 */
export async function cook(graph: Graph, opts: CookOptions = {}): Promise<CookResult> {
  const { budgetMs, signal, onNodeDone } = opts;
  const start = performance.now();
  let sliceStart = start;
  const stats: CookStats = { cooked: 0, cached: 0, elapsedMs: 0 };
  const checkCancelled = (): void => {
    if (signal?.aborted) throw new CookCancelledError();
  };
  checkCancelled();

  const order = topoOrder(graph);

  for (const id of order) {
    checkCancelled();
    const node = graph.require(id);
    const def = node.def;
    const nodeStart = performance.now();

    // Assemble inputs (multi pins concatenate in connection order) and the
    // input part of the memo key from item revs.
    const inputs: Record<string, DataCollection> = {};
    const inputSig: string[] = [];
    for (const pin of def.inputs) {
      const items: DataItem[] = [];
      for (const c of graph._connections) {
        if (c.to !== id || c.toPin !== pin.name) continue;
        const upstream = graph.require(c.from).cache?.outputs[c.fromPin];
        if (upstream) items.push(...upstream);
      }
      inputs[pin.name] = items;
      inputSig.push(`${pin.name}=${items.map((it) => it.rev).join(",")}`);
    }

    const seed = hashCombine(graph.seed, hashString(id));
    const key = `${def.type}|s${seed}|p${stableValueHash(node.params)}|i${inputSig.join(";")}`;

    if (node.cache !== undefined && node.cache.key === key) {
      node.dirty = false;
      stats.cached++;
      onNodeDone?.({ id, type: def.type, cached: true, elapsedMs: performance.now() - nodeStart });
    } else {
      let outputs: Record<string, DataCollection>;
      try {
        outputs = await def.execute({ inputs, params: node.params, seed, signal, checkCancelled });
      } catch (err) {
        if (err instanceof CookCancelledError) throw err;
        throw new NodeExecutionError(id, err);
      }
      for (const pin of def.outputs) {
        if (!(pin.name in outputs)) {
          throw new NodeExecutionError(
            id,
            undefined,
            `node "${id}" did not produce declared output pin "${pin.name}"`,
          );
        }
      }
      node.cache = { key, outputs };
      node.dirty = false;
      stats.cooked++;
      onNodeDone?.({ id, type: def.type, cached: false, elapsedMs: performance.now() - nodeStart });
    }

    if (budgetMs !== undefined && performance.now() - sliceStart > budgetMs) {
      await yieldToEventLoop();
      checkCancelled();
      sliceStart = performance.now();
    }
  }

  const outputs: Record<string, DataCollection> = {};
  for (const decl of graph._outputs) {
    outputs[decl.name] = graph.require(decl.node).cache?.outputs[decl.pin] ?? [];
  }
  stats.elapsedMs = performance.now() - start;
  return { outputs, stats };
}
