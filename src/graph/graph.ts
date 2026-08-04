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
   * Remove one matching connection; returns whether one existed. Dirties
   * the target node on success.
   */
  disconnect(from: NodeHandle, fromPin: string, to: NodeHandle, toPin: string): boolean {
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
    this.require(to.id).dirty = true;
    this._version++;
    return true;
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

  /** Current params of a node instance (read-only view). */
  getParams<P>(handle: NodeHandle<P>): Readonly<P> {
    return this.require(handle.id).params as unknown as Readonly<P>;
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

  /** Whether the node has a pending change not yet validated by a cook. */
  isDirty(handle: NodeHandle): boolean {
    return this.require(handle.id).dirty;
  }

  /** @internal Look up node state, throwing on unknown ids. */
  require(id: string): NodeState {
    const node = this._nodes.get(id);
    if (!node) {
      throw new GraphValidationError(`unknown node "${id}" (handle from another graph?)`);
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
