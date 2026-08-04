import { isField } from "../fields/index.js";
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
   * continuing. Cooking always completes unless aborted. Forwarded to
   * nodes (see `NodeExecuteArgs.budgetMs`) so composite nodes can apply
   * the same policy to nested cooks.
   */
  budgetMs?: number;
  /** Abort the cook; checked between nodes and via `checkCancelled` inside them. */
  signal?: AbortSignal;
  /**
   * Called after each node is cooked or served from cache. An exception
   * thrown here propagates and rejects the cook mid-pass (it is not
   * wrapped); the node that just finished keeps its cache.
   */
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

/**
 * Result of a cook: declared outputs by name, plus stats.
 *
 * The returned collections (and the geometry they reference) alias live
 * cache internals — treat them as immutable. Mutating a returned geometry
 * corrupts the cache undetectably; `cloneGeometry` first.
 */
export interface CookResult {
  readonly outputs: Record<string, DataCollection>;
  readonly stats: CookStats;
}

function isDataItemValue(v: object): v is DataItem {
  const it = v as { kind?: unknown; rev?: unknown };
  return (
    (it.kind === "geometry" || it.kind === "value" || it.kind === "instances") &&
    typeof it.rev === "number"
  );
}

const ACCEPTED =
  "primitives, plain objects, arrays, typed arrays, Map, Set, DataItem, and Field values";

/**
 * Stable structural hash of a param tree, as a string. Strict allowlist:
 * primitives (Object.is-aware, so 0 and -0 differ), plain objects (sorted
 * keys), arrays, typed arrays, Map/Set (sorted entries), DataItems (by
 * rev — data is never deep-hashed), and genuine Fields (by their stable
 * `key`). Anything else — Dates, RegExps, class instances, functions —
 * throws GraphValidationError naming the param path: such values have no
 * reliable structural identity and would collide in the memo cache.
 */
function stableValueHash(v: unknown, path: string): string {
  if (v === null) return "z";
  switch (typeof v) {
    case "undefined":
      return "u";
    case "number":
      return Object.is(v, -0) ? "#-0" : `#${v}`;
    case "boolean":
      return v ? "t" : "f";
    case "string":
      return JSON.stringify(v);
    case "bigint":
      return `#${v}n`;
    case "object":
      break;
    default:
      throw new GraphValidationError(
        `param "${path}": a ${typeof v} is not hashable; accepted: ${ACCEPTED}`,
      );
  }
  const obj = v as object;
  if (isField(obj)) return `F(${obj.key})`;
  if (isDataItemValue(obj)) return `I(${obj.rev})`;
  if (Array.isArray(obj)) {
    return `[${obj.map((el, i) => stableValueHash(el, `${path}[${i}]`)).join(",")}]`;
  }
  if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    const arr = obj as unknown as ArrayLike<number>;
    return `T(${obj.constructor.name}:${Array.from(arr).join(",")})`;
  }
  if (obj instanceof Set) {
    return `S{${[...obj]
      .map((el) => stableValueHash(el, `${path}{set}`))
      .sort()
      .join(",")}}`;
  }
  if (obj instanceof Map) {
    const entries = [...obj].map(
      ([k, val]) =>
        `${stableValueHash(k, `${path}{key}`)}=>${stableValueHash(val, `${path}{value}`)}`,
    );
    return `M{${entries.sort().join(",")}}`;
  }
  const proto = Object.getPrototypeOf(obj) as object | null;
  if (proto === Object.prototype || proto === null) {
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableValueHash(rec[k], `${path}.${k}`)}`)
      .join(",")}}`;
  }
  const name = obj.constructor?.name ?? "object";
  throw new GraphValidationError(
    `param "${path}": ${name} instances are not hashable; accepted: ${ACCEPTED}`,
  );
}

/**
 * Reachable nodes from the declared outputs, upstream-first (topological).
 * Deterministic: outputs in declaration order, inputs in connection order.
 * Iterative (explicit stack) so arbitrarily deep chains cannot overflow
 * the call stack.
 */
function topoOrder(graph: Graph): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const stack: Array<{ id: string; entered: boolean }> = [];
  for (let i = graph._outputs.length - 1; i >= 0; i--) {
    stack.push({ id: graph._outputs[i].node, entered: false });
  }
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.entered) {
      stack.pop();
      state.set(frame.id, 2);
      order.push(frame.id);
      continue;
    }
    const s = state.get(frame.id);
    if (s === 2) {
      stack.pop();
      continue;
    }
    if (s === 1) {
      // Defensive: connect() rejects cycles, so this should be unreachable.
      throw new GraphCycleError(`cycle detected through node "${frame.id}"`);
    }
    state.set(frame.id, 1);
    frame.entered = true;
    const incoming = graph._inTo.get(frame.id);
    if (incoming) {
      for (let i = incoming.length - 1; i >= 0; i--) {
        stack.push({ id: incoming[i].from, entered: false });
      }
    }
  }
  return order;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Last cook (settled-safe) per graph, for serializing overlapping cooks. */
const inFlight = new WeakMap<Graph, Promise<unknown>>();

/**
 * Cook the graph: pull-based from its declared outputs, topological order,
 * sequential. Each node is memoized on (type, param hash, node seed, input
 * item revs, optional `NodeDef.memoKey`) — an unchanged key serves the
 * cached outputs, and unchanged outputs keep their revs so cleanliness
 * propagates downstream. Aborting rejects with {@link CookCancelledError}
 * but keeps completed nodes' caches, so a re-cook resumes where the
 * cancelled one left off.
 *
 * Overlapping cooks of the same graph are serialized: a call waits for the
 * in-flight cook to settle before starting, so each node executes at most
 * once per pass and both callers get consistent results.
 *
 * The result's collections alias live cache internals and must be treated
 * as immutable (see {@link CookResult}). Mutating the graph (setParam,
 * connect, ...) while awaiting a cook is safe but that pass may return a
 * torn mix of old and new state; the next cook sees the edits via memo
 * keys and heals.
 */
export function cook(graph: Graph, opts: CookOptions = {}): Promise<CookResult> {
  const prev = inFlight.get(graph);
  const run = prev === undefined ? cookRun(graph, opts) : prev.then(() => cookRun(graph, opts));
  inFlight.set(
    graph,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function cookRun(graph: Graph, opts: CookOptions): Promise<CookResult> {
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
    const incoming = graph._inTo.get(id) ?? [];
    for (const pin of def.inputs) {
      const items: DataItem[] = [];
      for (const c of incoming) {
        if (c.toPin !== pin.name) continue;
        const upstream = graph.require(c.from).cache?.outputs[c.fromPin];
        if (upstream) items.push(...upstream);
      }
      inputs[pin.name] = items;
      inputSig.push(`${pin.name}=${items.map((it) => it.rev).join(",")}`);
    }

    const seed = hashCombine(graph.seed, hashString(id));
    const extra = def.memoKey?.() ?? "";
    const key = `${def.type}|s${seed}|p${stableValueHash(node.params, "params")}|i${inputSig.join(
      ";",
    )}|x${extra}`;

    if (node.cache !== undefined && node.cache.key === key) {
      node.dirty = false;
      stats.cached++;
      onNodeDone?.({ id, type: def.type, cached: true, elapsedMs: performance.now() - nodeStart });
    } else {
      let outputs: Record<string, DataCollection>;
      try {
        outputs = await def.execute({
          inputs,
          params: node.params,
          seed,
          signal,
          budgetMs,
          checkCancelled,
        });
      } catch (err) {
        // A CookCancelledError only counts as cancellation when the signal
        // actually aborted; a node throwing it spontaneously is a failure.
        if (err instanceof CookCancelledError && signal?.aborted) throw err;
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
