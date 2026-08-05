import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection } from "./data.js";
import { GraphCycleError, GraphValidationError } from "./errors.js";
import type { NodeDef, PinDef } from "./node.js";

/**
 * Reference to a node instance in a graph. Carries the param type of its
 * definition so `setParam` stays typed.
 */
export interface NodeHandle<P = unknown> {
  readonly id: string;
  /** @internal Phantom marker preserving the param type; never set. */
  readonly _params?: P;
}

/** @internal One connection between two node pins. */
export interface Connection {
  readonly from: string;
  readonly fromPin: string;
  readonly to: string;
  readonly toPin: string;
}

/** @internal A declared terminal output of a graph. */
export interface OutputDecl {
  readonly name: string;
  readonly node: string;
  readonly pin: string;
}

/** @internal Memoized result of one node cook. */
export interface NodeCache {
  readonly key: string;
  readonly outputs: Record<string, DataCollection>;
}

/** @internal Per-node state stored by the graph. */
export interface NodeState {
  readonly id: string;
  readonly def: NodeDef<Record<string, unknown>>;
  params: Record<string, unknown>;
  /** Advisory flag; correctness comes from the executor's memo key. */
  dirty: boolean;
  cache: NodeCache | undefined;
}

function findPin(pins: readonly PinDef[], name: string): PinDef | undefined {
  return pins.find((p) => p.name === name);
}

function listPins(pins: readonly PinDef[]): string {
  return pins.map((p) => `"${p.name}"`).join(", ") || "(none)";
}

/**
 * @internal Seed the executor derives for one node instance (graph seed
 * combined with the node id). Shared between the executor and
 * {@link Graph.describe} so the reported seed always matches the seed
 * `execute` receives.
 */
export function deriveNodeSeed(graphSeed: number, nodeId: string): number {
  return hashCombine(graphSeed, hashString(nodeId));
}

/** One node instance in a {@link GraphDescription} snapshot. */
export interface DescribedNode {
  readonly id: string;
  /** Seed the executor passes to this node's execute (graph seed + id). */
  readonly seed: number;
  /**
   * The definition's declared type string — for graphs built from
   * registered defs this is the registered type name serialization uses;
   * ad-hoc defs report whatever type string they declare. `undefined`
   * (never a throw) when a def carries no usable type string.
   */
  readonly defType: string | undefined;
}

/** One connection in a {@link GraphDescription} snapshot. */
export interface DescribedConnection {
  /** Source endpoint: [nodeId, outputPin]. */
  readonly from: readonly [string, string];
  /** Target endpoint: [nodeId, inputPin]. */
  readonly to: readonly [string, string];
}

/** One declared terminal output in a {@link GraphDescription} snapshot. */
export interface DescribedOutput {
  readonly id: string;
  readonly pin: string;
  readonly name: string;
}

/**
 * Read-only structural snapshot of a live graph; see {@link Graph.describe}.
 */
export interface GraphDescription {
  /** Node instances in insertion order. */
  readonly nodes: readonly DescribedNode[];
  /** Connections in creation order (per-pin order is order in this list). */
  readonly connections: readonly DescribedConnection[];
  /** Declared terminal outputs in declaration order. */
  readonly outputs: readonly DescribedOutput[];
}

/**
 * Code-first node graph: add node instances, connect pins, declare
 * terminal outputs, then cook with `cook(graph)`. Connections are
 * validated eagerly (pins, kinds, single-pin occupancy, cycles).
 */
export class Graph {
  /** @internal Node instances in insertion order. */
  readonly _nodes = new Map<string, NodeState>();
  /** @internal All connections; per-pin order is order in this list. */
  readonly _connections: Connection[] = [];
  /** @internal Incoming connections per target node id, in connection order. */
  readonly _inTo = new Map<string, Connection[]>();
  /** @internal Outgoing connections per source node id, in connection order. */
  readonly _outFrom = new Map<string, Connection[]>();
  /** @internal Declared terminal outputs in declaration order. */
  readonly _outputs: OutputDecl[] = [];

  private _seed: number;
  private _version = 0;
  private readonly typeCounts = new Map<string, number>();

  constructor(seed = 0) {
    this._seed = seed >>> 0;
  }

  /** The graph seed all node seeds derive from. */
  get seed(): number {
    return this._seed;
  }

  /**
   * Monotonic edit counter: bumps on every mutating call (add, connect,
   * disconnect, setParam, setSeed, output). A subgraph node folds its
   * inner graph's version into its memo key, so direct edits to a wrapped
   * graph invalidate the wrapping node's cache.
   */
  get version(): number {
    return this._version;
  }

  /**
   * Add a node instance. `params` shallow-merges over the definition's
   * defaults. Omitting `id` assigns a deterministic `type_N` id.
   */
  add<P>(def: NodeDef<P>, params?: Partial<P>, id?: string): NodeHandle<P> {
    let nodeId: string;
    if (id !== undefined) {
      if (this._nodes.has(id)) {
        throw new GraphValidationError(`node id "${id}" already exists`);
      }
      nodeId = id;
    } else {
      let n = this.typeCounts.get(def.type) ?? 0;
      do {
        nodeId = `${def.type}_${n}`;
        n++;
      } while (this._nodes.has(nodeId));
      this.typeCounts.set(def.type, n);
    }
    const merged = {
      ...(def.defaultParams as object),
      ...(params as object | undefined),
    } as Record<string, unknown>;
    this._nodes.set(nodeId, {
      id: nodeId,
      def: def as unknown as NodeDef<Record<string, unknown>>,
      params: merged,
      dirty: true,
      cache: undefined,
    });
    this._version++;
    return { id: nodeId };
  }

  /**
   * Connect an output pin to an input pin. Validates that both pins exist,
   * kinds are compatible (`any` matches either), the input pin is free
   * unless `multi`, and no cycle is created. Dirties the target node.
   */
  connect(from: NodeHandle, fromPin: string, to: NodeHandle, toPin: string): void {
    const src = this.require(from.id);
    const dst = this.require(to.id);
    const out = findPin(src.def.outputs, fromPin);
    if (!out) {
      throw new GraphValidationError(`node "${src.id}" has no output pin "${fromPin}"`);
    }
    const inp = findPin(dst.def.inputs, toPin);
    if (!inp) {
      throw new GraphValidationError(`node "${dst.id}" has no input pin "${toPin}"`);
    }
    if (out.kind !== "any" && inp.kind !== "any" && out.kind !== inp.kind) {
      throw new GraphValidationError(
        `cannot connect ${src.id}.${fromPin} (${out.kind}) to ${dst.id}.${toPin} (${inp.kind})`,
      );
    }
    if (
      inp.multi !== true &&
      (this._inTo.get(dst.id) ?? []).some((c) => c.toPin === toPin)
    ) {
      throw new GraphValidationError(
        `input pin ${dst.id}.${toPin} is already connected (declare it multi to allow several)`,
      );
    }
    if (src.id === dst.id || this.reaches(dst.id, src.id)) {
      throw new GraphCycleError(
        `connecting ${src.id}.${fromPin} to ${dst.id}.${toPin} would create a cycle`,
      );
    }
    const conn: Connection = { from: src.id, fromPin, to: dst.id, toPin };
    this._connections.push(conn);
    let into = this._inTo.get(dst.id);
    if (!into) this._inTo.set(dst.id, (into = []));
    into.push(conn);
    let outOf = this._outFrom.get(src.id);
    if (!outOf) this._outFrom.set(src.id, (outOf = []));
    outOf.push(conn);
    dst.dirty = true;
    this._version++;
  }

  /**
   * Remove one matching connection; returns whether one existed (a
   * missing connection between valid endpoints is not an error, and does
   * not bump the version). Unknown nodes or pins throw, naming the
   * offender and listing the valid pins. Dirties the target node on
   * success. On a `multi` input the remaining connections keep their
   * original insertion order — order is part of determinism.
   *
   * Cache contract: the target's next memo key sees the changed input
   * revs, so it (and anything downstream of it) recooks on the next
   * cook; untouched branches keep serving their caches.
   */
  disconnect(from: NodeHandle, fromPin: string, to: NodeHandle, toPin: string): boolean {
    const src = this.require(from.id);
    const dst = this.require(to.id);
    if (!findPin(src.def.outputs, fromPin)) {
      throw new GraphValidationError(
        `node "${src.id}" has no output pin "${fromPin}"; output pins: ${listPins(src.def.outputs)}`,
      );
    }
    if (!findPin(dst.def.inputs, toPin)) {
      throw new GraphValidationError(
        `node "${dst.id}" has no input pin "${toPin}"; input pins: ${listPins(dst.def.inputs)}`,
      );
    }
    const idx = this._connections.findIndex(
      (c) => c.from === from.id && c.fromPin === fromPin && c.to === to.id && c.toPin === toPin,
    );
    if (idx < 0) return false;
    const conn = this._connections[idx];
    this._connections.splice(idx, 1);
    const into = this._inTo.get(conn.to);
    if (into) into.splice(into.indexOf(conn), 1);
    const outOf = this._outFrom.get(conn.from);
    if (outOf) outOf.splice(outOf.indexOf(conn), 1);
    dst.dirty = true;
    this._version++;
    return true;
  }

  /**
   * Remove a node. Documented cascade: every connection touching the
   * node and every declared output on it are removed too, and each
   * former downstream target is marked dirty. Bumps the version once.
   * Unknown handles (another graph's, or already removed) throw.
   *
   * Cache contract: former downstream nodes see changed input revs in
   * their next memo key and recook on the next cook; nodes on untouched
   * branches keep serving their caches. The removed node's memoized
   * outputs live on its per-node state, which this call drops — eviction
   * is immediate and nothing else retains it (the executor keys its
   * in-flight guard per graph, not per node), so repeated add/remove
   * cycles cannot accumulate cached data.
   *
   * Removed auto-assigned ids are not reused (the per-type counter only
   * advances); an explicit id can be reused by passing it to `add` again.
   *
   * Subgraph notes: removing a subgraph *instance* leaves its definition
   * and the wrapped inner graph intact — other instances (and re-adding
   * the def) keep working, and the def's recorded spec/plumbing are
   * WeakMap-keyed, so they are reclaimed with the def. Removing plumbing
   * the wrapper injected *inside* a wrapped graph (portal nodes) breaks
   * that wrapper and is not supported.
   *
   * Removing a node while a cook of this graph is in flight may reject
   * that pass (the cook can no longer resolve the node); the graph stays
   * consistent and the next cook is correct.
   */
  removeNode(handle: NodeHandle): void {
    const node = this.require(handle.id);
    const id = node.id;
    for (let i = this._connections.length - 1; i >= 0; i--) {
      const conn = this._connections[i];
      if (conn.from !== id && conn.to !== id) continue;
      this._connections.splice(i, 1);
      if (conn.from !== id) {
        const outOf = this._outFrom.get(conn.from);
        if (outOf) outOf.splice(outOf.indexOf(conn), 1);
      }
      if (conn.to !== id) {
        const into = this._inTo.get(conn.to);
        if (into) into.splice(into.indexOf(conn), 1);
        const dst = this._nodes.get(conn.to);
        if (dst) dst.dirty = true;
      }
    }
    this._inTo.delete(id);
    this._outFrom.delete(id);
    for (let i = this._outputs.length - 1; i >= 0; i--) {
      if (this._outputs[i].node === id) this._outputs.splice(i, 1);
    }
    this._nodes.delete(id);
    this._version++;
  }

  /** Set one param and mark the node dirty. */
  setParam<P, K extends keyof P & string>(handle: NodeHandle<P>, key: K, value: P[K]): void {
    this._setParamQuiet(handle, key, value);
    this._version++;
  }

  /**
   * @internal Param write that does not count as a user edit (no version
   * bump) — used by subgraph plumbing, whose effects are already covered
   * by the wrapping node's memo key (outer seed and input revs).
   */
  _setParamQuiet<P, K extends keyof P & string>(
    handle: NodeHandle<P>,
    key: K,
    value: P[K],
  ): void {
    const node = this.require(handle.id);
    node.params[key] = value;
    node.dirty = true;
  }

  /**
   * Current params of a node instance, as a frozen shallow copy taken at
   * call time (later `setParam` calls are not reflected — call again for
   * fresh values). Freezing the snapshot means no returned object offers
   * a mutation path that bypasses version bumps. Nested values are the
   * live values by reference — Fields are immutable by contract, and
   * arrays/items follow the library-wide aliasing rule (cook results,
   * `dataInput` items): treat them as frozen, and change params only
   * through `setParam`.
   */
  getParams<P>(handle: NodeHandle<P>): Readonly<P> {
    return Object.freeze({ ...this.require(handle.id).params }) as unknown as Readonly<P>;
  }

  /** Set the graph seed and mark every node dirty. */
  setSeed(seed: number): void {
    this._setSeedQuiet(seed);
    this._version++;
  }

  /** @internal Seed write without a version bump; see {@link Graph._setParamQuiet}. */
  _setSeedQuiet(seed: number): void {
    this._seed = seed >>> 0;
    for (const node of this._nodes.values()) node.dirty = true;
  }

  /**
   * Declare a terminal output: cooking pulls from these (and cooks only
   * what they reach). `name` defaults to `"<nodeId>.<pin>"` and keys the
   * collection in the cook result.
   */
  output(handle: NodeHandle, pin: string, name?: string): void {
    const node = this.require(handle.id);
    if (!findPin(node.def.outputs, pin)) {
      throw new GraphValidationError(`node "${node.id}" has no output pin "${pin}"`);
    }
    const outName = name ?? `${node.id}.${pin}`;
    if (this._outputs.some((o) => o.name === outName)) {
      throw new GraphValidationError(`output "${outName}" is already declared`);
    }
    this._outputs.push({ name: outName, node: node.id, pin });
    this._version++;
  }

  /**
   * Undeclare the named terminal output. Cooking afterwards no longer
   * produces it (and per-output cooking rejects the name); the name is
   * free to redeclare. Bumps the version. Node caches are untouched —
   * removing an output changes what a cook pulls, not any memo key, so
   * the next cook serves every unchanged node from cache. Unknown names
   * throw, listing the declared outputs.
   */
  removeOutput(name: string): void {
    const idx = this._outputs.findIndex((o) => o.name === name);
    if (idx < 0) {
      if (this._outputs.length === 0) {
        throw new GraphValidationError(
          `unknown output "${name}": this graph declares no outputs`,
        );
      }
      throw new GraphValidationError(
        `unknown output "${name}"; declared outputs: ${this._outputs
          .map((o) => `"${o.name}"`)
          .join(", ")}`,
      );
    }
    this._outputs.splice(idx, 1);
    this._version++;
  }

  /** Whether the node has a pending change not yet validated by a cook. */
  isDirty(handle: NodeHandle): boolean {
    return this.require(handle.id).dirty;
  }

  /**
   * Read-only snapshot of the live structure: nodes (insertion order),
   * connections (creation order), and declared outputs (declaration
   * order) — deterministic and stable across calls. Every object in the
   * snapshot is freshly built and frozen, so nothing it exposes can
   * mutate the graph behind the version counter; per-node param values
   * are served separately by {@link Graph.getParams}. Cheap enough to
   * call per UI frame on editor-sized graphs (no geometry or param
   * copies). The structure is reported verbatim — for a graph wrapped by
   * `subgraphNode` that includes the wrapper's injected plumbing (portal
   * nodes, `__out_*` outputs), which serialization excludes.
   */
  describe(): GraphDescription {
    const nodes: DescribedNode[] = [];
    for (const state of this._nodes.values()) {
      const type = state.def.type;
      nodes.push(
        Object.freeze({
          id: state.id,
          seed: deriveNodeSeed(this._seed, state.id),
          defType: typeof type === "string" && type !== "" ? type : undefined,
        }),
      );
    }
    const connections = this._connections.map((c) =>
      Object.freeze({
        from: Object.freeze([c.from, c.fromPin] as const),
        to: Object.freeze([c.to, c.toPin] as const),
      }),
    );
    const outputs = this._outputs.map((o) =>
      Object.freeze({ id: o.node, pin: o.pin, name: o.name }),
    );
    return Object.freeze({
      nodes: Object.freeze(nodes),
      connections: Object.freeze(connections),
      outputs: Object.freeze(outputs),
    });
  }

  /** @internal Look up node state, throwing on unknown ids. */
  require(id: string): NodeState {
    const node = this._nodes.get(id);
    if (!node) {
      throw new GraphValidationError(
        `unknown node "${id}" (removed from this graph, or a handle from another graph?)`,
      );
    }
    return node;
  }

  /** Is `target` reachable downstream from `start`? */
  private reaches(start: string, target: string): boolean {
    const stack = [start];
    const seen = new Set<string>([start]);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === target) return true;
      const outgoing = this._outFrom.get(id);
      if (!outgoing) continue;
      for (const c of outgoing) {
        if (!seen.has(c.to)) {
          seen.add(c.to);
          stack.push(c.to);
        }
      }
    }
    return false;
  }
}
