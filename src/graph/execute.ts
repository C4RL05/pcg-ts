import { isField } from "../fields/index.js";
import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection, DataItem } from "./data.js";
import { CookCancelledError, GraphCycleError, GraphValidationError, NodeExecutionError } from "./errors.js";
import type { Graph, OutputDecl } from "./graph.js";

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
  /**
   * Cook only these declared outputs (by name): the pass visits just the
   * induced upstream subgraph, and the result contains exactly these
   * names. Nodes outside the selection are untouched — their caches are
   * neither recooked nor invalidated, so cooking output A and then
   * output B reuses every shared upstream result via the normal memo
   * cache. Selection order does not matter (cooking follows the graph's
   * declaration order), duplicates are ignored, and an empty array cooks
   * nothing. An unknown name rejects with `GraphValidationError` listing
   * the declared outputs. Omit to cook every declared output (the
   * default, byte-identical to the pre-option behavior).
   */
  outputs?: readonly string[];
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
 * Resolve the outputs a cook pulls from: all declared outputs, or —
 * when `names` is given — the declared subset carrying those names, in
 * declaration order (so the visit order never depends on the order the
 * caller listed them). Unknown names throw a GraphValidationError that
 * states the valid alternatives.
 */
function selectOutputs(graph: Graph, names: readonly string[] | undefined): readonly OutputDecl[] {
  if (names === undefined) return graph._outputs;
  const wanted = new Set(names);
  for (const name of wanted) {
    if (!graph._outputs.some((o) => o.name === name)) {
      if (graph._outputs.length === 0) {
        throw new GraphValidationError(
          `unknown output "${name}": this graph declares no outputs; declare one with graph.output(node, pin, name) before cooking`,
        );
      }
      throw new GraphValidationError(
        `unknown output "${name}"; declared outputs: ${graph._outputs
          .map((o) => `"${o.name}"`)
          .join(", ")}`,
      );
    }
  }
  return graph._outputs.filter((o) => wanted.has(o.name));
}

/**
 * Reachable nodes from the given output declarations, upstream-first
 * (topological). Deterministic: outputs in declaration order, inputs in
 * connection order. Iterative (explicit stack) so arbitrarily deep
 * chains cannot overflow the call stack.
 */
function topoOrder(graph: Graph, decls: readonly OutputDecl[]): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const stack: Array<{ id: string; entered: boolean }> = [];
  for (let i = decls.length - 1; i >= 0; i--) {
    stack.push({ id: decls[i].node, entered: false });
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
 * Cook the graph: pull-based from its declared outputs (or the subset
 * selected via `opts.outputs`), topological order, sequential. Each node
 * is memoized on (type, param hash, node seed, input item revs, optional
 * `NodeDef.memoKey`) — an unchanged key serves the cached outputs, and
 * unchanged outputs keep their revs so cleanliness propagates
 * downstream. Because content is a pure function of the memo key,
 * partial cooks compose deterministically: cooking output A then B
 * yields the same bytes as B then A or one full cook. Aborting rejects
 * with {@link CookCancelledError} but keeps completed nodes' caches, so
 * a re-cook resumes where the cancelled one left off.
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

  const decls = selectOutputs(graph, opts.outputs);
  const order = topoOrder(graph, decls);

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
  for (const decl of decls) {
    outputs[decl.name] = graph.require(decl.node).cache?.outputs[decl.pin] ?? [];
  }
  stats.elapsedMs = performance.now() - start;
  return { outputs, stats };
}
