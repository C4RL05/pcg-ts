import {
  createGpuCookStats,
  isField,
  type DeviceTransformsHandle,
  type GpuCookStats,
  type GpuFieldResolver,
  type ResidentAttrDesc,
  type ResidentMemberDesc,
  type ResidentRunResult,
} from "../fields/index.js";
import { acceptsDerivedSpecs, deviceSpec, resolverView } from "../fields/spec.js";
import {
  makeDeviceInstancesItem,
  makeGeometryItem,
  type DataCollection,
  type DataItem,
  type GeometryItem,
} from "./data.js";
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
   *
   * A resolver may additionally advertise `residentTerminals`, letting
   * spawner-style terminals end a run with DEVICE-RESIDENT outputs (an
   * instances item whose transforms live in a GPU buffer). Those items
   * are delivered but never memoized — the cook's caller owns every
   * handle it receives and must dispose it, and the graph refuses to
   * pin device memory on its behalf, so a node that produced one always
   * recooks. Everything else about the cook is unchanged.
   *
   * A resolver advertising `acceptDerivedSpecs` widens which Field params
   * are eligible from "authored via `fieldFromJson`" to "describable at
   * all", which includes every combinator expression. The executor reads
   * that advertisement to decide both which nodes are salted and which
   * may fuse, and folds it into the salt itself, so cooks under the two
   * settings never serve each other's bytes. Absent or false — the
   * default — every produced byte and every memo key is the CPU
   * reference's.
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
 * Does the param tree hold at least one genuine Field the resolver would
 * accept (`deviceSpec`)? Only such fields can ever be GPU-resolved, so
 * only they make a node's output depend on the resolver. Walks the same
 * containers `stableValueHash` accepts; other values cannot contain
 * Fields (or fail hashing first).
 *
 * `acceptDerived` is the resolver's own `acceptDerivedSpecs`
 * advertisement, threaded in rather than re-derived: this predicate,
 * `paramsFieldsAllSpecd`, the evaluator's per-field gate and the
 * resident-run planner are ONE decision, and they ask it through one
 * function with the flag as a required argument. Counting a field here
 * that the resolver then declines (or the reverse) would salt a memo key
 * for a node that resolved on the CPU (or leave a device-resolved node
 * unsalted) — the one way this becomes a stale-cache bug.
 */
function paramsHaveSpecField(v: unknown, acceptDerived: boolean): boolean {
  if (typeof v !== "object" || v === null) return false;
  if (isField(v)) return deviceSpec(v, acceptDerived) !== undefined;
  // Recursion is written as explicit short-circuiting loops rather than
  // `.some((el) => walk(el, acceptDerived))`: this runs per node per cook,
  // and a callback form allocates one closure (and, for Set/Map, one
  // spread array) at EVERY container level of every param tree.
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (paramsHaveSpecField(v[i], acceptDerived)) return true;
    }
    return false;
  }
  if (v instanceof Set) {
    for (const el of v) {
      if (paramsHaveSpecField(el, acceptDerived)) return true;
    }
    return false;
  }
  if (v instanceof Map) {
    for (const el of v.values()) {
      if (paramsHaveSpecField(el, acceptDerived)) return true;
    }
    return false;
  }
  const proto = Object.getPrototypeOf(v) as object | null;
  if (proto === Object.prototype || proto === null) {
    const rec = v as Record<string, unknown>;
    for (const k in rec) {
      if (Object.hasOwn(rec, k) && paramsHaveSpecField(rec[k], acceptDerived)) return true;
    }
    return false;
  }
  return false;
}

/**
 * The sink a resolver view's counts REALLY land in, which is not always
 * the one it was constructed with: wrapping a view drops the new sink
 * (see {@link gpuStatsView}), so an inner cook's counts go to the
 * outermost cook's stats.
 *
 * The executor has to know which one, because since the suffix retry it
 * both writes counters ({@link PARTIAL_FUSION}) and un-writes them (a
 * rejection that a narrowed run supersedes). Reading or repairing the
 * inner cook's discarded sink would leave the real one saying a chain
 * fused nothing while `fusedNodes` said otherwise — the exact lie the
 * retry's accounting exists to avoid, hidden one subgraph deep where no
 * top-level test would see it.
 */
const viewSinks = new WeakMap<GpuFieldResolver, GpuCookStats>();

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
  const effective = viewSinks.get(base) ?? sink;
  const view: Omit<{ -readonly [K in keyof GpuFieldResolver]: GpuFieldResolver[K] }, "acceptDerivedSpecs"> = {
    cacheSalt: base.cacheSalt,
    resolveField: (field, ctx) => base.resolveField(field, ctx, sink),
  };
  if (base.planRun !== undefined && base.executeRun !== undefined) {
    view.planRun = (members, ctx) => base.planRun!(members, ctx, sink);
    view.executeRun = (plan, input) => base.executeRun!(plan, input, sink);
    // Terminal advertisement is part of what the resolver can fuse, so
    // it must survive the view (a nested cook sees the same set).
    if (base.residentTerminals !== undefined) view.residentTerminals = base.residentTerminals;
  }
  // `acceptDerivedSpecs` is NOT copied here — `resolverView` copies it,
  // and typing it `never` in the view argument makes writing it by hand a
  // compile error. Unlike `residentTerminals` above it is unconditional:
  // it governs the per-field seam, which run-less resolvers have too, and
  // dropping it would leave the executor salting memo keys for the
  // authored set while the resolver resolved the wider one — GPU bytes
  // under a CPU key.
  const made = resolverView(base, view);
  viewSinks.set(made, effective);
  return made;
}

/**
 * Version prefix of the fused-run memo key format. Bump when the key
 * composition itself changes so stale run entries can never be served
 * across library versions (device/kernel byte changes are covered by
 * the resolver's own `cacheSalt`).
 */
const RUN_KEY_VERSION = "run1";

/**
 * Fallback reason for a chain that fused only its TAIL: the resolver
 * rejected the whole chain, {@link narrowRun} found a suffix that plans,
 * and the members ahead of it cooked per-node.
 *
 * It is a reason of its own rather than a `"run-plan-failed"` because
 * that reason's documented meaning is "every member of this run then
 * cooks on the per-node path" (see `GpuCookStats`), which is exactly what
 * stops being true when a suffix fuses. Counting a partial fusion there
 * would make the one counter that reports lost fusion overstate it, and
 * silently: the cook would look identical to a total fallback while
 * `residentRuns` and `fusedNodes` said otherwise. Counted once per chain
 * per cook, cold or warm, so it stays a property of the GRAPH rather than
 * of the cache state. `fusedNodes` then says how much of the chain the
 * retry recovered — but only on the cook that executed it: a warm cook
 * reports this reason with `fusedNodes: 0`, because the run was served
 * from its terminal's memo entry and did no device work, exactly as
 * `residentRuns` documents. Read the two together, never one as a
 * restatement of the other.
 */
const PARTIAL_FUSION = "run-partially-fused";

/**
 * The one rejection reason {@link narrowRun} is NOT offered for: the run
 * was well-formed and merely did not fit the resolver's resident memory
 * bound.
 *
 * Two reasons, and both are about not moving bytes nobody asked to move.
 * Narrowing from the front does not target whatever made the run large —
 * it just makes it shorter — so the suffix that happens to fit is
 * arbitrary rather than chosen. And `maxResidentBytes` documents an
 * over-budget run as one the per-node path serves WHOLE: cooks that lower
 * it to force the fallback (the graceful-degradation path, and the way a
 * fused chain is bisected when it misbehaves) get per-node bytes back
 * today, and a partial fusion would quietly withdraw that — a memory knob
 * would start deciding output bits. A modelling rejection carries no such
 * promise, and narrowing from the front is exactly the right search for
 * it: the members it drops are the ones that made the tail unplannable.
 */
const RESOURCE_REJECTION = "run-too-large";

/**
 * Reasons a `planRun` call just counted, as a delta against the snapshot
 * taken immediately before it. Reading the sink is how the executor
 * learns WHY a plan was rejected: the resolver contract returns a bare
 * `null` and the reason travels only through this counter. A resolver
 * that counts nothing reports no reason, which is not a size complaint.
 */
function countedSince(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): string[] {
  const names: string[] = [];
  for (const [name, n] of Object.entries(after)) {
    if (n > (before[name] ?? 0)) names.push(name);
  }
  return names;
}

/**
 * Are all Fields in the param tree ones the resolver would accept
 * (`deviceSpec`)? A Field the run planner would decline forces a CPU
 * fallback inside a fused run, so nodes carrying one never join a run.
 * Trees without any Field are trivially true — plain values compile as
 * constants. Reads the same predicate, with the same flag, as
 * {@link paramsHaveSpecField}; see the note there.
 */
function paramsFieldsAllSpecd(v: unknown, acceptDerived: boolean): boolean {
  if (typeof v !== "object" || v === null) return true;
  if (isField(v)) return deviceSpec(v, acceptDerived) !== undefined;
  // Loops rather than `.every((el) => walk(el, acceptDerived))`, for the
  // allocation reason in {@link paramsHaveSpecField}. Deliberately a
  // second explicit walker and not a shared generator: the two gate the
  // memo salt, they disagree on the empty case (no Field at all is
  // "false" here and "true" there), and a generator would allocate on the
  // very path this avoids allocating on.
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!paramsFieldsAllSpecd(v[i], acceptDerived)) return false;
    }
    return true;
  }
  if (ArrayBuffer.isView(v)) return true;
  if (v instanceof Set) {
    for (const el of v) {
      if (!paramsFieldsAllSpecd(el, acceptDerived)) return false;
    }
    return true;
  }
  if (v instanceof Map) {
    for (const el of v.values()) {
      if (!paramsFieldsAllSpecd(el, acceptDerived)) return false;
    }
    return true;
  }
  const proto = Object.getPrototypeOf(v) as object | null;
  if (proto === Object.prototype || proto === null) {
    const rec = v as Record<string, unknown>;
    for (const k in rec) {
      if (Object.hasOwn(rec, k) && !paramsFieldsAllSpecd(rec[k], acceptDerived)) return false;
    }
    return true;
  }
  return true;
}

/**
 * Is this node's pin shape a resident-run CHAIN shape — exactly one
 * non-multi geometry input and exactly one output, which is geometry?
 * Such a node can be an interior member (its output feeds the next
 * member's input) or a terminal.
 */
function isChainShape(def: NodeState["def"]): boolean {
  return (
    def.inputs.length === 1 &&
    def.inputs[0].kind === "geometry" &&
    def.inputs[0].multi !== true &&
    def.outputs.length === 1 &&
    def.outputs[0].kind === "geometry"
  );
}

/**
 * Is this node's pin shape a resident-run TERMINAL-ONLY shape — one
 * non-multi geometry input, exactly one geometry output, and any number
 * of NON-geometry outputs (e.g. spawnInstances' `instances` + `points`)?
 *
 * Why admitting these is safe, stated as the rule the detector relies
 * on: (1) a chain edge is always a geometry pin, and a terminal-only
 * node has exactly one, so "which output continues the chain" stays
 * unambiguous; (2) `detectResidentRuns` never continues a chain THROUGH
 * such a node, so no member's input can come from a pin the run does not
 * model; (3) the run executor produces the terminal's whole output map,
 * and the resolver only accepts `resident.kind`s whose extra pins it
 * models — an unknown kind fails planning and every member cooks
 * per-node. A node with two GEOMETRY outputs is still rejected (a run
 * materializes one geometry), and so is any multi-output node that has
 * not opted in via `resident.terminal`, which is exactly the set that
 * was unfusable before.
 */
function isTerminalShape(def: NodeState["def"]): boolean {
  if (def.resident?.terminal !== true) return false;
  if (def.inputs.length !== 1 || def.inputs[0].kind !== "geometry" || def.inputs[0].multi === true) {
    return false;
  }
  return def.outputs.filter((pin) => pin.kind === "geometry").length === 1;
}

/**
 * May this node join a device-resident run, and if not for an
 * author-actionable reason, which? Declarative gate only — whether the
 * resolver can actually compile the member is decided by `planRun` at
 * cook time.
 *
 * Requirements: a `resident` descriptor; then EITHER the plain chain pin
 * shape (see {@link isChainShape}) for an ordinary member, OR — for a
 * node declaring `resident.terminal` — the terminal pin shape (see
 * {@link isTerminalShape}) together with the resolver advertising this
 * `kind` in `residentTerminals`. Plus the `eligible` predicate (when
 * present) accepting the live params, and every Field param spec'd.
 *
 * Returns `true`, `false`, or the machine-readable reason string
 * `eligible` returned — which the caller counts in `stats.gpu.fallbacks`.
 */
function fusability(
  node: NodeState,
  residentTerminals: ReadonlySet<string>,
  acceptDerived: boolean,
): boolean | string {
  const def = node.def;
  if (def.resident === undefined) return false;
  if (def.resident.terminal === true) {
    if (!isTerminalShape(def)) return false;
    // Terminal fusion is opt-in per resolver, without exception: a
    // resolver that does not advertise the kind gets the pre-existing
    // behavior exactly, and the node cooks on its normal path.
    if (!residentTerminals.has(def.resident.kind)) return false;
  } else if (!isChainShape(def)) {
    return false;
  }
  if (def.resident.eligible !== undefined) {
    const verdict = def.resident.eligible(node.params);
    if (verdict !== true) return typeof verdict === "string" && verdict !== "" ? verdict : false;
  }
  return paramsFieldsAllSpecd(node.params, acceptDerived);
}

/** One detected device-resident run: member node ids in chain order. */
interface ResidentRun {
  readonly members: readonly string[];
  readonly terminal: string;
  /**
   * True when this run is a SUFFIX of a longer detected chain whose plan
   * the resolver rejected — the members ahead of it cook per-node. Read
   * only for accounting: see {@link PARTIAL_FUSION}.
   */
  readonly narrowed?: boolean;
}

/** What {@link detectResidentRuns} found: runs plus per-node opt-out reasons. */
interface ResidentDetection {
  readonly runs: Map<string, ResidentRun>;
  /** Node id → the reason its `eligible` gave for staying off the device. */
  readonly optOuts: Map<string, string>;
}

/**
 * Detect maximal device-resident runs over the induced cooked subgraph
 * (`order`). A run is a linear chain of fusable nodes where each
 * member's sole geometry input is the previous member's output and
 * every interior member has exactly one consumer and no declared
 * output; any violation (external tap, declared output, non-fusable or
 * out-of-selection consumer) ends the run at that boundary — the
 * boundary node becomes the run's terminal with a readback.
 *
 * A chain never continues through a TERMINAL-ONLY node (see
 * {@link isTerminalShape}): reaching one closes the run.
 *
 * Runs of a single node are not runs — they cook on the
 * (identical-cost) per-node path, keeping their phase-independent memo
 * keys — with one exception: a lone terminal-only node IS a run,
 * because there the two paths are not equivalent. Its fused form is the
 * only way to produce device-resident outputs at all, so skipping
 * fusion would not be a cheaper route to the same bytes, it would be a
 * different result.
 *
 * Maximality: `order` is topological, so a chain's earliest fusable
 * node is visited before its downstream members; the first un-membered
 * fusable node therefore starts its chain's maximal run.
 */
function detectResidentRuns(
  graph: Graph,
  order: readonly string[],
  residentTerminals: ReadonlySet<string>,
  acceptDerived: boolean,
): ResidentDetection {
  const byFirst = new Map<string, ResidentRun>();
  const optOuts = new Map<string, string>();
  const inOrder = new Set(order);
  const membered = new Set<string>();
  const hasOutputDecl = (id: string): boolean => graph._outputs.some((o) => o.node === id);
  /** Fusability, recording an author-actionable opt-out reason once per node. */
  const fusable = (node: NodeState): boolean => {
    const verdict = fusability(node, residentTerminals, acceptDerived);
    if (typeof verdict === "string") {
      optOuts.set(node.id, verdict);
      return false;
    }
    return verdict;
  };
  for (const id of order) {
    if (membered.has(id)) continue;
    const node = graph.require(id);
    if (!fusable(node)) continue;
    const chain: string[] = [id];
    let tail = id;
    while (!isTerminalShape(graph.require(tail).def)) {
      const outgoing = graph._outFrom.get(tail) ?? [];
      if (outgoing.length !== 1) break; // multi-consumer tap (or dead end)
      if (hasOutputDecl(tail)) break; // interior members must not be declared outputs
      const next = outgoing[0].to;
      if (!inOrder.has(next)) break; // consumer outside this cook's selection
      const nextNode = graph.require(next);
      if (!fusable(nextNode)) break;
      const incoming = graph._inTo.get(next) ?? [];
      if (incoming.length !== 1 || incoming[0].from !== tail) break; // sole input must be the chain
      chain.push(next);
      tail = next;
    }
    if (chain.length >= 2 || isTerminalShape(graph.require(tail).def)) {
      const run: ResidentRun = { members: chain, terminal: tail };
      byFirst.set(id, run);
      for (const m of chain) membered.add(m);
    }
  }
  return { runs: byFirst, optOuts };
}

/**
 * The run to try after this one's plan was rejected: the same chain
 * minus its first member, or null when no suffix is worth fusing. The
 * caller registers it under that member's id, so it is attempted at that
 * member's own loop position — where the members ahead of it have cooked
 * per-node and the suffix's input geometry therefore EXISTS. A suffix
 * cannot be planned ahead of time: planning needs the real attribute
 * layout and point count entering its first member.
 *
 * SUFFIX, NEVER PREFIX, and the direction is the whole safety argument
 * rather than an implementation convenience. A rejected plan always
 * leaves a fusable prefix available too (the members before the
 * rejecting one), and fusing that is the tempting half. It is also the
 * unsafe half, and precisely the one `specKeysOnIdentity` (src/gpu/run.ts)
 * exists to prevent: the rejection that costs the most fusion in practice
 * is an identity-keyed member behind a P write, and fusing the prefix
 * would put exactly the P arithmetic on the device, hand the drifted bits
 * to the identity-keyed node one node later instead of one kernel later,
 * and reproduce the divergence with only the boundary moved. Dropping
 * members from the FRONT pushes the P arithmetic back onto the CPU —
 * which is what that rule is for — and leaves a tail that planned against
 * a CPU-exact P free to fuse.
 *
 * ONE MEMBER AT A TIME, REPEATEDLY, rather than one jump to the rejecting
 * member. The executor sees `planRun`'s `null` and not the index it
 * failed at (the resolver contract carries no index), but the repeated
 * form is not merely what the seam allows — it is strictly more capable.
 * Jumping to the rejecting member k answers "does [k..] plan?" once, and
 * on the shipped 04-gpu-fields chain the answer is no twice over: wobble
 * → jitter → xform → tint → psize narrows three times ([jitter..] and
 * [xform..] each still write P ahead of the identity-keyed tint) before
 * [tint, psize] plans. Scanning from the longest suffix down stops at the
 * FIRST suffix that plans, which is the maximal fusable one by
 * construction, and costs at most one extra plan attempt per member —
 * planning is synchronous, device-free and allocates nothing on the
 * device.
 *
 * The suffix inherits every structural property {@link detectResidentRuns}
 * established, so nothing is re-detected: an interior member of a suffix
 * is an interior member of the original (one consumer, no declared
 * output), the terminal is unchanged, and the suffix's first member's
 * sole geometry input is the member now cooking per-node ahead of it. The
 * detector's "a lone chain node is not a run" rule is the one thing that
 * must be re-applied, which is the length check below.
 */
function narrowRun(graph: Graph, run: ResidentRun): ResidentRun | null {
  const members = run.members.slice(1);
  if (members.length === 0) return null;
  if (members.length === 1 && !isTerminalShape(graph.require(run.terminal).def)) return null;
  return { members, terminal: run.terminal, narrowed: true };
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
 * Graphs whose exclusive section is held right now; see
 * {@link withExclusiveGraph}. Read by {@link cook} so the section holder's
 * own cook does not queue behind itself.
 */
const exclusive = new WeakSet<Graph>();

/**
 * @internal Run `fn` with exclusive access to `graph`, queued on the same
 * per-graph chain as {@link cook}, so nothing else cooks or prepares it
 * until `fn` settles.
 *
 * This exists because preparing a graph and cooking it must be ONE
 * indivisible step. A subgraph wrapper writes the inner graph's seed and
 * portal inputs and then awaits a cook of it; serializing only the cook
 * leaves the writes outside the guard, so a second wrapper sharing that
 * inner graph can overwrite them mid-flight and the first cook finishes
 * against the second's seed — same graph, same seed, different output
 * depending on scheduling, which is precisely what this library promises
 * cannot happen.
 *
 * Deadlock-free by the same rule that makes subgraph nesting sound: a
 * section for graph G is only ever entered from a cook of some OTHER
 * graph, and nesting is acyclic. A graph that (transitively) wraps
 * ITSELF is the exception — it already hung before this existed, and is
 * rejected at construction time rather than here, where a nested call
 * and a concurrent one are indistinguishable.
 */
export function withExclusiveGraph<T>(graph: Graph, fn: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(graph);
  const run = (prev ?? Promise.resolve()).then(async () => {
    exclusive.add(graph);
    try {
      return await fn();
    } finally {
      exclusive.delete(graph);
    }
  });
  inFlight.set(
    graph,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

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
  // Re-entrant for the holder of an exclusive section: it is already the
  // only task allowed to touch this graph, so queuing behind the chain
  // its own section owns would deadlock against itself.
  if (exclusive.has(graph)) return cookRun(graph, opts);
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
  // The sink this cook's GPU counters ACTUALLY reach: `gpuStats` at the
  // top level, the outermost cook's sink inside a subgraph (see viewSinks).
  const countSink = gpu === undefined ? undefined : (viewSinks.get(gpu) ?? gpuStats);
  // Read ONCE per cook, from the view the nodes will actually be handed,
  // and passed to every eligibility question below. A second read (or a
  // second interpretation of "absent means false") is how the memo-key
  // salt and the resolver's acceptance drift apart.
  const acceptDerived = acceptsDerivedSpecs(gpu);
  /**
   * The device identity folded into memo keys. `acceptDerivedSpecs`
   * belongs in it, not only in the eligibility decision: two resolvers on
   * the SAME adapter carry the same `cacheSalt`, yet one that accepts
   * derived specs produces different bytes for the same node — a node
   * holding one authored and one code-authored Field param is salted
   * either way but resolves one field or two, and a `gpu: "always"` node
   * (a subgraph) is salted either way while its inner cook changes
   * entirely. Without this suffix those cooks would share a key and serve
   * each other's bytes.
   *
   * Empty suffix when the flag is off, so a cook without the flag keys
   * exactly as a cook that never knew about it.
   */
  const gpuSalt = gpu === undefined ? "" : `${gpu.cacheSalt}${acceptDerived ? "+derived" : ""}`;
  const stats: CookStats = { cooked: 0, cached: 0, elapsedMs: 0 };
  if (gpuStats !== undefined) stats.gpu = gpuStats;
  const checkCancelled = (): void => {
    if (signal?.aborted) throw new CookCancelledError();
  };
  checkCancelled();

  const decls = selectOutputs(graph, opts.outputs);
  const order = topoOrder(graph, decls);

  // Device-resident runs exist only when the resolver implements both
  // optional run methods; otherwise (including CPU-only cooks, and any
  // resolver implementing neither) every code path below is exactly the
  // per-node one and produced bytes and memo keys are unchanged.
  const detection =
    gpu !== undefined && gpu.planRun !== undefined && gpu.executeRun !== undefined
      ? detectResidentRuns(graph, order, new Set(gpu.residentTerminals ?? []), acceptDerived)
      : undefined;
  const runsByFirst = detection?.runs;
  // Author-actionable opt-outs (a resident node whose `eligible`
  // returned a reason) count once per cook, whether or not a run formed
  // around the node — the reason is about the node, not the run. Into
  // `countSink` like every other fallback: a nested cook's own sink is
  // discarded, so counting these there dropped a subgraph's opt-out
  // reasons on the floor while its run reasons reached the caller.
  if (detection !== undefined && countSink !== undefined) {
    for (const reason of detection.optOuts.values()) {
      countSink.fallbacks[reason] = (countSink.fallbacks[reason] ?? 0) + 1;
    }
  }
  const handled = runsByFirst !== undefined && runsByFirst.size > 0 ? new Set<string>() : undefined;

  /**
   * Device-resident handles this cook minted, in production order. The
   * cook OWNS every one of them until it hands it to its caller inside
   * the returned collections; ownership transfers only on delivery.
   * Anything still owned when the cook settles is disposed here, because
   * nothing else can ever reach it:
   *
   * - the cook threw (cancelled, a later node failed, the terminal
   *   declared no instances pin) — the caller receives nothing, so every
   *   handle produced so far is unreachable;
   * - the cook succeeded but a handle is in no delivered collection (the
   *   terminal's instances pin is neither a selected output nor read by
   *   any node in this cook) — nobody was ever given it.
   *
   * Handles that DID reach the result are left alone: from that instant
   * the caller owns them, exactly as `DeviceTransformsHandle` documents.
   * Disposal is idempotent, so a handle a consumer already disposed
   * costs nothing here.
   */
  const produced: DeviceTransformsHandle[] = [];
  const disposeUndelivered = (delivered: Record<string, DataCollection> | undefined): void => {
    if (produced.length === 0) return;
    const kept = new Set<DeviceTransformsHandle>();
    if (delivered !== undefined) {
      for (const collection of Object.values(delivered)) {
        for (const item of collection) {
          if (item.kind !== "instances" || item.deviceBatches === undefined) continue;
          for (const batch of item.deviceBatches) kept.add(batch.transforms);
        }
      }
    }
    for (const handle of produced) {
      if (!kept.has(handle)) handle.dispose();
    }
  };

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
      (def.gpu === "always" ||
        (def.gpu === "fields" && paramsHaveSpecField(node.params, acceptDerived)))
        ? `|gpu:${gpuSalt}`
        : "";
    const key = `${def.type}|s${seed}|p${stableValueHash(node.params, "params")}|i${inputSig.join(
      ";",
    )}|x${extra}${gpuMark}`;

    if (node.cache !== undefined && node.cache.key === key && node.cache.volatile !== true) {
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
   * else plan + execute on the device. Returns false when this run cannot
   * proceed this cook (plan rejected, no/empty input geometry) — the
   * caller then cooks THIS member on the per-node path, which surfaces
   * identical bytes and identical errors. A rejected plan does not
   * condemn the rest of the chain: a shorter run over the members behind
   * it is registered for its own loop position (see {@link narrowRun}),
   * so the tail still fuses when only the head was the problem.
   *
   * Stats/progress semantics (pinned by tests): every member counts in
   * `stats.cooked` when the run executes and in `stats.cached` when the
   * run is served from the terminal's cache, so cooked + cached still
   * equals the number of visited nodes. `onNodeDone` fires once per
   * member in chain order at run completion; interior members report
   * elapsedMs 0 and the terminal carries the run's total time.
   *
   * Device-resident outputs are never memoized: a run whose result
   * carries device batches writes a `volatile` cache entry, which
   * delivers this cook's items and is then refused by the hit path
   * above, so the next cook re-executes and produces fresh handles. See
   * `NodeCache.volatile` for why owning one would be wrong.
   */
  /**
   * Count a chain that fused only its tail, once, at the moment the
   * narrowed run is served (executed or memo-hit). See
   * {@link PARTIAL_FUSION}.
   */
  const countPartialFusion = (run: ResidentRun): void => {
    if (run.narrowed !== true || countSink === undefined) return;
    countSink.fallbacks[PARTIAL_FUSION] = (countSink.fallbacks[PARTIAL_FUSION] ?? 0) + 1;
  };

  const cookResidentRun = async (run: ResidentRun): Promise<boolean> => {
    const first = graph.require(run.members[0]);
    const terminal = graph.require(run.terminal);
    const runStart = performance.now();
    const { inputs, inputSig } = assembleInputs(run.members[0], first.def);
    const geoPin = terminal.def.outputs.find((pin) => pin.kind === "geometry")!;
    // Does anything read the terminal's geometry? A pin that is neither
    // connected nor declared as a graph output need not be materialized
    // at all — the run can then skip its readback entirely. Deliberately
    // conservative: a connection leaving this cook's selection still
    // counts as needed.
    const needsGeometry =
      (graph._outFrom.get(run.terminal) ?? []).some((c) => c.fromPin === geoPin.name) ||
      graph._outputs.some((o) => o.node === run.terminal && o.pin === geoPin.name);

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
    const key = `${RUN_KEY_VERSION}|gpu:${gpuSalt}|i${inputSig.join(";")}|m${memberKeys.join("")}`;

    if (terminal.cache !== undefined && terminal.cache.key === key && terminal.cache.volatile !== true) {
      countPartialFusion(run);
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
    //
    // SEVERAL geometries connected skips fusion for the same reason.
    // Fusing would read the head's first item and drop the rest before
    // any member `execute` runs, so the multi-item diagnostic the nodes
    // now raise would be unreachable exactly when a GPU resolver is
    // present — a cook that throws on the CPU and silently truncates on
    // the GPU. Declining here keeps fusion an optimization and never a
    // change in meaning.
    //
    // Neither guard counts a fallback, and for a NARROWED run that rests
    // on an invariant worth naming: a resident member neither changes the
    // point count nor the item count, so a suffix sees the same one
    // non-empty cloud its full chain saw when it reached planning. Break
    // that — a future resident kind that filters points, or emits two
    // items — and a narrowed run could bail out here after its chain's
    // rejection was already rolled back, leaving a cook that fused
    // nothing and reported no reason at all.
    const inputItems = inputs[first.def.inputs[0].name].filter(
      (item): item is GeometryItem => item.kind === "geometry",
    );
    if (inputItems.length !== 1) return false;
    const inputItem = inputItems[0];
    if (inputItem.geo.attrs.point.count === 0) return false;
    const geo = inputItem.geo;
    const attributes: Record<string, ResidentAttrDesc> = {};
    for (const attr of geo.attrs.point) {
      attributes[attr.name] = { type: attr.type, tupleSize: attr.tupleSize };
    }
    // The resolver counts its rejection reason on the spot, and that
    // count asserts the whole run fell back. Snapshot first: when a
    // narrowed run follows, the chain has NOT fallen back yet and the
    // count would be a lie until the last attempt settles it.
    const fallbacksBefore = countSink === undefined ? undefined : { ...countSink.fallbacks };
    const plan = gpu!.planRun!(memberDescs, {
      attributes,
      count: geo.attrs.point.count,
      needsGeometry,
    });
    if (plan === null) {
      // A run that merely did not FIT is not narrowed; see
      // RESOURCE_REJECTION. Its reason stands, and the whole chain cooks
      // per-node exactly as it did before.
      const counted =
        fallbacksBefore === undefined || countSink === undefined
          ? []
          : countedSince(fallbacksBefore, countSink.fallbacks);
      if (counted.length === 1 && counted[0] === RESOURCE_REJECTION) return false;
      const next = narrowRun(graph, run);
      // Nothing left to narrow to: this chain fuses nothing, so the
      // reason the resolver just counted stands, meaning exactly what it
      // has always meant.
      if (next === null) return false;
      // Try the tail as its own, shorter run when the cook reaches its
      // first member. This member cooks per-node below, as it would have
      // under a total fallback.
      runsByFirst!.set(next.members[0], next);
      // Roll the reason back. Exactly one attempt per chain ever reports:
      // the last one, which either rejects with no suffix left (the
      // reason above) or fuses and reports PARTIAL_FUSION. `planRun` is
      // synchronous, so nothing else can have touched the sink in
      // between, and restoring by value (rather than decrementing a name
      // this code guessed) keeps that true for any resolver — including
      // one that counts nothing.
      if (countSink !== undefined && fallbacksBefore !== undefined) {
        for (const name of Object.keys(countSink.fallbacks)) {
          if (!(name in fallbacksBefore)) delete countSink.fallbacks[name];
        }
        for (const [name, n] of Object.entries(fallbacksBefore)) countSink.fallbacks[name] = n;
      }
      return false;
    }

    let result: ResidentRunResult;
    try {
      result = await gpu!.executeRun!(plan, { geo, signal, budgetMs });
    } catch (err) {
      // Post-plan failures are errors, never silent fallbacks — except
      // genuine cancellation, which propagates as such.
      if (err instanceof CookCancelledError && signal?.aborted) throw err;
      throw new NodeExecutionError(run.terminal, err);
    }
    // Take ownership of every handle the run minted BEFORE anything else
    // can throw, so no failure between here and delivery strands one.
    if (result.deviceBatches !== undefined) {
      for (const batch of result.deviceBatches) produced.push(batch.transforms);
    }
    // Tags the CPU chain would have produced: every resident CHAIN node
    // emits an untagged item, so a multi-member run's outputs carry no
    // tags (unchanged behavior); a lone terminal-only member is the one
    // case where the node's own execute would have passed the input
    // item's tags through, so it does.
    const outTags = run.members.length === 1 ? inputItem.tags : undefined;
    const outputs: Record<string, DataCollection> = {};
    if (result.geo !== undefined) outputs[geoPin.name] = [makeGeometryItem(result.geo, outTags)];
    if (result.deviceBatches !== undefined) {
      const instancesPin = terminal.def.outputs.find((pin) => pin.kind === "instances");
      if (instancesPin === undefined) {
        throw new NodeExecutionError(
          run.terminal,
          undefined,
          `node "${run.terminal}" (${terminal.def.type}) terminated a device-resident run that ` +
            "produced device instance batches, but the node declares no output pin of kind " +
            `"instances" to carry them; declared outputs: ${terminal.def.outputs
              .map((pin) => `"${pin.name}" (${pin.kind})`)
              .join(", ")}`,
        );
      }
      outputs[instancesPin.name] = [makeDeviceInstancesItem(result.deviceBatches, outTags)];
    }
    terminal.cache =
      result.deviceBatches !== undefined ? { key, outputs, volatile: true } : { key, outputs };
    countPartialFusion(run);
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

  const outputs: Record<string, DataCollection> = {};
  try {
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
        // Not fused: fall through — this member cooks on the per-node
        // path. The rest of the chain does the same at its own loop
        // positions, except that a narrowed run may have been registered
        // for one of them (see narrowRun), in which case the tail fuses
        // there instead.
      }
      if (!fused) await cookNode(id);

      if (budgetMs !== undefined && performance.now() - sliceStart > budgetMs) {
        await yieldToEventLoop();
        checkCancelled();
        sliceStart = performance.now();
      }
    }

    for (const decl of decls) {
      outputs[decl.name] = graph.require(decl.node).cache?.outputs[decl.pin] ?? [];
    }
  } catch (err) {
    // Nothing is delivered on a failed cook, so every device handle this
    // pass minted is unreachable — free it rather than strand it.
    disposeUndelivered(undefined);
    throw err;
  }
  disposeUndelivered(outputs);
  stats.elapsedMs = performance.now() - start;
  return { outputs, stats };
}
