import {
  createGpuCookStats,
  isField,
  type GpuCookStats,
  type GpuFieldResolver,
  type ResidentAttrDesc,
  type ResidentMemberDesc,
} from "../fields/index.js";
import { getFieldSpec } from "../nodes/fieldJson.js";
import { makeGeometryItem, type DataCollection, type DataItem } from "./data.js";
import { CookCancelledError, GraphCycleError, GraphValidationError, NodeExecutionError } from "./errors.js";
import { deriveNodeSeed, type Graph, type NodeState, type OutputDecl } from "./graph.js";

/**
 * Progress callback payload: one entry per node visited by a cook.
 * Nodes fused into a device-resident run report once per member in
 * chain order when the run completes (or is served from cache):
 * interior members carry elapsedMs 0 and the run's terminal carries
 * the whole run's elapsed time.
 */
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
  /**
   * GPU field resolver (see `GpuFieldResolver`; the concrete
   * `GpuFieldEvaluator` lives in `pcg-ts/gpu`). When present, nodes that
   * adopt GPU resolution evaluate eligible spec'd Field params on the
   * device and fall back to the CPU otherwise, `CookStats.gpu` reports
   * the counters, and adopting nodes' memo keys gain the resolver's
   * cache salt (so bytes never mix across devices or with CPU-only
   * cooks). Resolvers that additionally implement the optional run
   * methods (`planRun`/`executeRun`) get maximal linear chains of
   * resident-capable nodes fused into device-resident runs with a
   * single readback at each run's terminal; resolvers without them
   * degrade cleanly to the per-node behavior. Omitted: cook behavior
   * and every produced byte are identical to a build without GPU
   * support.
   */
  gpu?: GpuFieldResolver;
}

/**
 * Counters for one cook pass. Nodes fused into a device-resident run
 * count member-wise: every member counts in `cooked` when its run
 * executes and in `cached` when the run is served from the terminal's
 * cache, so `cooked + cached` always equals the number of visited
 * nodes.
 */
export interface CookStats {
  /** Nodes whose execute ran. */
  cooked: number;
  /** Nodes served from their memo cache. */
  cached: number;
  elapsedMs: number;
  /**
   * GPU counters, present exactly when the cook was given
   * `CookOptions.gpu`. Includes work done by nested cooks this cook
   * spawned (subgraph nodes) — their forwarding views report into the
   * outermost cook's sink.
   */
  gpu?: GpuCookStats;
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
 * Does the param tree hold at least one genuine Field carrying a
 * serializable spec (`getFieldSpec`)? Only such fields can ever be
 * GPU-resolved, so only they make a node's output depend on the
 * resolver. Walks the same containers `stableValueHash` accepts; other
 * values cannot contain Fields (or fail hashing first).
 */
function paramsHaveSpecField(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  if (isField(v)) return getFieldSpec(v) !== undefined;
  if (Array.isArray(v)) return v.some(paramsHaveSpecField);
  if (v instanceof Set) return [...v].some(paramsHaveSpecField);
  if (v instanceof Map) return [...v.values()].some(paramsHaveSpecField);
  const proto = Object.getPrototypeOf(v) as object | null;
  if (proto === Object.prototype || proto === null) {
    return Object.values(v as Record<string, unknown>).some(paramsHaveSpecField);
  }
  return false;
}

/**
 * Per-cook view of a resolver: same salt and resolution, but counters
 * land in this cook's sink. The view deliberately ignores sinks passed
 * by its own callers — a nested cook (subgraph) wraps this view with its
 * own (discarded) sink, and dropping it here routes all counts to the
 * outermost cook that owns a real `CookStats.gpu`. The optional run
 * methods are forwarded with the same sink binding (and only when the
 * base implements both), so nested cooks fuse resident runs too and
 * their counters land in the outermost sink.
 */
function gpuStatsView(base: GpuFieldResolver, sink: GpuCookStats): GpuFieldResolver {
  const view: GpuFieldResolver = {
    cacheSalt: base.cacheSalt,
    resolveField: (field, ctx) => base.resolveField(field, ctx, sink),
  };
  if (base.planRun !== undefined && base.executeRun !== undefined) {
    view.planRun = (members, ctx) => base.planRun!(members, ctx, sink);
    view.executeRun = (plan, input) => base.executeRun!(plan, input, sink);
  }
  return view;
}

/**
 * Version prefix of the fused-run memo key format. Bump when the key
 * composition itself changes so stale run entries can never be served
 * across library versions (device/kernel byte changes are covered by
 * the resolver's own `cacheSalt`).
 */
const RUN_KEY_VERSION = "run1";

/**
 * Are all Fields in the param tree spec'd (`getFieldSpec`)? A spec-less
 * (code-authored) Field would force a CPU fallback inside a fused run,
 * so nodes carrying one never join a run. Trees without any Field are
 * trivially true — plain values compile as constants.
 */
function paramsFieldsAllSpecd(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  if (isField(v)) return getFieldSpec(v) !== undefined;
  if (Array.isArray(v)) return v.every(paramsFieldsAllSpecd);
  if (ArrayBuffer.isView(v)) return true;
  if (v instanceof Set) return [...v].every(paramsFieldsAllSpecd);
  if (v instanceof Map) return [...v.values()].every(paramsFieldsAllSpecd);
  const proto = Object.getPrototypeOf(v) as object | null;
  if (proto === Object.prototype || proto === null) {
    return Object.values(v as Record<string, unknown>).every(paramsFieldsAllSpecd);
  }
  return true;
}

/**
 * May this node join a device-resident run? Declarative gate only —
 * whether the resolver can actually compile the member is decided by
 * `planRun` at cook time. Requirements: a `resident` descriptor whose
 * `eligible` predicate (when present) accepts the live params, exactly
 * one non-multi geometry input pin and one geometry output pin (the
 * linear-chain shape), and every Field param spec'd.
 */
function isFusable(node: NodeState): boolean {
  const def = node.def;
  if (def.resident === undefined) return false;
  if (
    def.inputs.length !== 1 ||
    def.inputs[0].kind !== "geometry" ||
    def.inputs[0].multi === true ||
    def.outputs.length !== 1 ||
    def.outputs[0].kind !== "geometry"
  ) {
    return false;
  }
  if (def.resident.eligible !== undefined && !def.resident.eligible(node.params)) return false;
  return paramsFieldsAllSpecd(node.params);
}

/** One detected device-resident run: member node ids in chain order. */
interface ResidentRun {
  readonly members: readonly string[];
  readonly terminal: string;
}

/**
 * Detect maximal device-resident runs over the induced cooked subgraph
 * (`order`). A run is a linear chain of fusable nodes where each
 * member's sole geometry input is the previous member's output and
 * every interior member has exactly one consumer and no declared
 * output; any violation (external tap, declared output, non-fusable or
 * out-of-selection consumer) ends the run at that boundary — the
 * boundary node becomes the run's terminal with a readback. Runs of a
 * single node are not runs: they cook on the (identical-cost) per-node
 * path, keeping their phase-independent memo keys.
 *
 * Maximality: `order` is topological, so a chain's earliest fusable
 * node is visited before its downstream members; the first un-membered
 * fusable node therefore starts its chain's maximal run.
 */
function detectResidentRuns(graph: Graph, order: readonly string[]): Map<string, ResidentRun> {
  const byFirst = new Map<string, ResidentRun>();
  const inOrder = new Set(order);
  const membered = new Set<string>();
  const hasOutputDecl = (id: string): boolean => graph._outputs.some((o) => o.node === id);
  for (const id of order) {
    if (membered.has(id)) continue;
    if (!isFusable(graph.require(id))) continue;
    const chain: string[] = [id];
    let tail = id;
    for (;;) {
      const outgoing = graph._outFrom.get(tail) ?? [];
      if (outgoing.length !== 1) break; // multi-consumer tap (or dead end)
      if (hasOutputDecl(tail)) break; // interior members must not be declared outputs
      const next = outgoing[0].to;
      if (!inOrder.has(next)) break; // consumer outside this cook's selection
      const nextNode = graph.require(next);
      if (!isFusable(nextNode)) break;
      const incoming = graph._inTo.get(next) ?? [];
      if (incoming.length !== 1 || incoming[0].from !== tail) break; // sole input must be the chain
      chain.push(next);
      tail = next;
    }
    if (chain.length >= 2) {
      const run: ResidentRun = { members: chain, terminal: tail };
      byFirst.set(id, run);
      for (const m of chain) membered.add(m);
    }
  }
  return byFirst;
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
  const gpuStats = opts.gpu !== undefined ? createGpuCookStats() : undefined;
  const gpu =
    opts.gpu !== undefined && gpuStats !== undefined ? gpuStatsView(opts.gpu, gpuStats) : undefined;
  const stats: CookStats = { cooked: 0, cached: 0, elapsedMs: 0 };
  if (gpuStats !== undefined) stats.gpu = gpuStats;
  const checkCancelled = (): void => {
    if (signal?.aborted) throw new CookCancelledError();
  };
  checkCancelled();

  const decls = selectOutputs(graph, opts.outputs);
  const order = topoOrder(graph, decls);

  // Device-resident runs exist only when the resolver implements both
  // optional run methods; otherwise (including CPU-only cooks and
  // v0.5-style resolvers) every code path below is exactly the per-node
  // one and produced bytes and memo keys are unchanged.
  const runsByFirst =
    gpu !== undefined && gpu.planRun !== undefined && gpu.executeRun !== undefined
      ? detectResidentRuns(graph, order)
      : undefined;
  const handled = runsByFirst !== undefined && runsByFirst.size > 0 ? new Set<string>() : undefined;

  /** Inputs (multi pins concatenate in connection order) + rev signature. */
  const assembleInputs = (
    id: string,
    def: NodeState["def"],
  ): { inputs: Record<string, DataCollection>; inputSig: string[] } => {
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
    return { inputs, inputSig };
  };

  /** The unchanged per-node cook: memoize on the node key, else execute. */
  const cookNode = async (id: string): Promise<void> => {
    const node = graph.require(id);
    const def = node.def;
    const nodeStart = performance.now();
    const { inputs, inputSig } = assembleInputs(id, def);

    const seed = deriveNodeSeed(graph.seed, id);
    const extra = def.memoKey?.() ?? "";
    // GPU provenance: when this cook carries a resolver and the node
    // declares adoption, fold the device identity into the key — see
    // NodeDef.gpu for the "fields" vs "always" rule. Without a resolver
    // (or for non-adopting nodes) the key is byte-identical to before.
    const gpuMark =
      gpu !== undefined &&
      (def.gpu === "always" || (def.gpu === "fields" && paramsHaveSpecField(node.params)))
        ? `|gpu:${gpu.cacheSalt}`
        : "";
    const key = `${def.type}|s${seed}|p${stableValueHash(node.params, "params")}|i${inputSig.join(
      ";",
    )}|x${extra}${gpuMark}`;

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
          gpu,
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
  };

  /**
   * Cook a detected run fused: memoize on the composite run key (which
   * caches ONLY the terminal's output — interior members get no cache
   * entries while fused, so any interior change recooks the whole run),
   * else plan + execute on the device. Returns false when fusion cannot
   * proceed this cook (plan rejected, no/empty input geometry) — the
   * caller then cooks every member on the per-node path, which surfaces
   * identical bytes and identical errors.
   *
   * Stats/progress semantics (pinned by tests): every member counts in
   * `stats.cooked` when the run executes and in `stats.cached` when the
   * run is served from the terminal's cache, so cooked + cached still
   * equals the number of visited nodes. `onNodeDone` fires once per
   * member in chain order at run completion; interior members report
   * elapsedMs 0 and the terminal carries the run's total time.
   */
  const cookResidentRun = async (run: ResidentRun): Promise<boolean> => {
    const first = graph.require(run.members[0]);
    const terminal = graph.require(run.terminal);
    const runStart = performance.now();
    const { inputs, inputSig } = assembleInputs(run.members[0], first.def);

    // Composite run memo key: run-format version + device salt + the
    // first member's input signature + ordered member tuples
    // (type | seed | param hash | def memoKey). The per-node and run
    // key formats can never collide (distinct prefixes), so a CPU-only
    // or run-less cook never serves run-cached bytes and vice versa.
    const memberKeys: string[] = [];
    const memberDescs: ResidentMemberDesc[] = [];
    for (const id of run.members) {
      const node = graph.require(id);
      const seed = deriveNodeSeed(graph.seed, id);
      const extra = node.def.memoKey?.() ?? "";
      memberKeys.push(
        `[${node.def.type}|s${seed}|p${stableValueHash(node.params, "params")}|x${extra}]`,
      );
      memberDescs.push({
        id,
        type: node.def.type,
        kind: node.def.resident!.kind,
        params: node.params,
        seed,
      });
    }
    const key = `${RUN_KEY_VERSION}|gpu:${gpu!.cacheSalt}|i${inputSig.join(";")}|m${memberKeys.join("")}`;

    if (terminal.cache !== undefined && terminal.cache.key === key) {
      const elapsed = performance.now() - runStart;
      for (const id of run.members) {
        const node = graph.require(id);
        // Terminal-only caching: an interior member must hold NO entry
        // while fused. It can still carry one from an earlier per-node
        // cook (gpu off, or a cook where planning was rejected); drop it
        // so the contract holds literally and the retained geometry is
        // released instead of living on unreadable.
        if (id !== run.terminal) node.cache = undefined;
        node.dirty = false;
        stats.cached++;
        onNodeDone?.({
          id,
          type: node.def.type,
          cached: true,
          elapsedMs: id === run.terminal ? elapsed : 0,
        });
      }
      return true;
    }

    // Plan against the input geometry's point layout. Planning is
    // synchronous and device-free. No geometry connected or an empty
    // cloud skips fusion: the per-node path is trivially cheap there
    // and surfaces the identical CPU error for missing inputs.
    let geo;
    for (const item of inputs[first.def.inputs[0].name]) {
      if (item.kind === "geometry") {
        geo = item.geo;
        break;
      }
    }
    if (geo === undefined || geo.attrs.point.count === 0) return false;
    const attributes: Record<string, ResidentAttrDesc> = {};
    for (const attr of geo.attrs.point) {
      attributes[attr.name] = { type: attr.type, tupleSize: attr.tupleSize };
    }
    const plan = gpu!.planRun!(memberDescs, { attributes, count: geo.attrs.point.count });
    if (plan === null) return false;

    let resultGeo;
    try {
      resultGeo = (await gpu!.executeRun!(plan, { geo, signal, budgetMs })).geo;
    } catch (err) {
      // Post-plan failures are errors, never silent fallbacks — except
      // genuine cancellation, which propagates as such.
      if (err instanceof CookCancelledError && signal?.aborted) throw err;
      throw new NodeExecutionError(run.terminal, err);
    }
    terminal.cache = {
      key,
      outputs: { [terminal.def.outputs[0].name]: [makeGeometryItem(resultGeo)] },
    };
    const elapsed = performance.now() - runStart;
    for (const id of run.members) {
      const node = graph.require(id);
      // Terminal-only caching (see the cache-hit branch above).
      if (id !== run.terminal) node.cache = undefined;
      node.dirty = false;
      stats.cooked++;
      onNodeDone?.({
        id,
        type: node.def.type,
        cached: false,
        elapsedMs: id === run.terminal ? elapsed : 0,
      });
    }
    return true;
  };

  for (const id of order) {
    checkCancelled();
    if (handled !== undefined && handled.has(id)) continue;
    const run = runsByFirst?.get(id);
    let fused = false;
    if (run !== undefined) {
      fused = await cookResidentRun(run);
      if (fused) {
        for (const m of run.members) handled!.add(m);
      }
      // Not fused: fall through — this member (and, at their own loop
      // positions, the rest of the chain) cooks on the per-node path.
    }
    if (!fused) await cookNode(id);

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
