/**
 * `CookWorkerPool` — cook serialized graphs off the main thread.
 *
 * N workers (Node `worker_threads` by default; any browser `Worker` via
 * `createWorker`), a FIFO queue with per-cook cancellation, and a
 * per-graph cache on each worker (graph JSON crosses once per worker,
 * then only per-cook param patches). Outputs come back with every typed
 * array on the transfer list and rehydrate into the exact shapes `cook()`
 * returns — byte-identical to a main-thread cook of the same graph and
 * patches, which the determinism suite pins.
 *
 * Cancellation policy (measured choice, documented once): an aborted
 * cook rejects immediately, and if a worker is already mid-cook it is
 * LEFT TO FINISH and the result dropped. Terminating instead would buy
 * back at most one cook's tail (~100 ms for a heavy cell) at the price
 * of a thread respawn, a full library re-import, a graph re-send and
 * re-deserialize, and a stone-cold memo cache — strictly worse for the
 * streaming caller, whose next cook usually wants exactly those warm
 * caches.
 */
import { CookCancelledError, type Graph } from "../graph/index.js";
import { serializeGraph, type SerializedGraph } from "../nodes/serialize.js";
import type { CellCookRequest, CellOutputs, CookBackend, ParamPatch } from "../runtime/types.js";
import {
  decodeError,
  decodeOutputs,
  type MainToWorkerMessage,
  type WorkerCookStats,
  type WorkerToMainMessage,
} from "./protocol.js";

/**
 * The worker surface the pool drives — a structural subset satisfied by
 * both the browser `Worker` and Node's `worker_threads.Worker` (either
 * event style is detected; `on` wins when both exist).
 */
export interface CookWorkerLike {
  postMessage(message: unknown, transfer: readonly ArrayBuffer[]): void;
  terminate(): unknown;
  /** Node event style (`worker.on("message" | "error", ...)`). */
  on?(event: string, listener: (value: never) => void): unknown;
  /** Browser event style (`message` events carry `{ data }`). */
  addEventListener?(event: string, listener: (ev: never) => void): unknown;
}

/** Options for constructing a {@link CookWorkerPool}. */
export interface CookWorkerPoolOptions {
  /**
   * Worker count (integer >= 1). Default: `hardwareConcurrency - 2`,
   * clamped to at least 1 — leave a core for the main thread and one for
   * the rest of the machine.
   */
  workers?: number;
  /**
   * Factory for one worker. Omit it in Node (the pool spawns
   * `worker_threads` workers on the built entry next to this module).
   * REQUIRED in a browser, where no portable default exists — e.g. with
   * Vite: `import CookWorker from "pcg-ts/worker/browser?worker"` and
   * `createWorker: () => new CookWorker()`.
   */
  createWorker?: () => CookWorkerLike | Promise<CookWorkerLike>;
}

/** One pool cook: a serialized graph plus per-cook patches. */
export interface PoolCookRequest {
  /**
   * The serialized graph. Cached per worker BY OBJECT IDENTITY: pass the
   * same object for every cook of the same graph, and the JSON crosses
   * to each worker once. A new object is treated as a new graph (fresh
   * key, fresh worker-side deserialize and caches).
   */
  readonly graph: SerializedGraph;
  /** Param patches applied (in order) before the cook. */
  readonly patches?: readonly ParamPatch[];
  /** Graph seed to set before the cook (u32), when it should change. */
  readonly seed?: number;
  /** Cook only these declared outputs (see `CookOptions.outputs`). */
  readonly outputs?: readonly string[];
  /**
   * Abort this cook: queued, it is dequeued; mid-cook, the result is
   * dropped when it lands. Either way the promise rejects with
   * `CookCancelledError` immediately.
   */
  readonly signal?: AbortSignal;
}

/** Result of one pool cook. */
export interface PoolCookResult {
  /** Rehydrated outputs, shaped exactly like `CookResult.outputs`. */
  readonly outputs: CellOutputs;
  /** Worker-side counters plus this side's decode time. */
  readonly stats: WorkerCookStats & { readonly decodeMs: number };
}

/** @internal Normalized transport over either worker event style. */
interface Transport {
  post(msg: MainToWorkerMessage, transfer?: readonly ArrayBuffer[]): void;
  onMessage(cb: (msg: WorkerToMainMessage) => void): void;
  onError(cb: (err: Error) => void): void;
  terminate(): Promise<void>;
}

/** @internal One queued or in-flight cook. */
interface Task {
  readonly id: number;
  readonly key: string;
  readonly graph: SerializedGraph;
  readonly patches: readonly ParamPatch[];
  readonly seed: number | undefined;
  readonly outputs: readonly string[] | undefined;
  readonly signal: AbortSignal | undefined;
  abortCleanup: (() => void) | undefined;
  settled: boolean;
  resolve(result: PoolCookResult): void;
  reject(err: Error): void;
}

/** @internal One live worker. */
interface Slot {
  /** Undefined until the (possibly async) factory has produced a worker. */
  transport: Transport | undefined;
  /** Graph keys this worker has been sent. */
  readonly sentKeys: Set<string>;
  /** The in-flight task, if any. */
  busy: Task | undefined;
  dead: boolean;
}

function adaptWorker(w: CookWorkerLike): Transport {
  if (typeof w.on === "function") {
    const on = w.on.bind(w) as (ev: string, cb: (v: unknown) => void) => unknown;
    return {
      post: (msg, transfer) => w.postMessage(msg, transfer ?? []),
      onMessage: (cb) => on("message", (v) => cb(v as WorkerToMainMessage)),
      onError: (cb) => on("error", (v) => cb(v instanceof Error ? v : new Error(String(v)))),
      terminate: async () => {
        await w.terminate();
      },
    };
  }
  if (typeof w.addEventListener === "function") {
    const listen = w.addEventListener.bind(w) as (ev: string, cb: (v: unknown) => void) => unknown;
    return {
      post: (msg, transfer) => w.postMessage(msg, transfer ?? []),
      onMessage: (cb) => listen("message", (ev) => cb((ev as MessageEvent).data as WorkerToMainMessage)),
      onError: (cb) =>
        listen("error", (ev) => {
          const e = ev as { message?: string; error?: unknown };
          cb(e.error instanceof Error ? e.error : new Error(e.message ?? "worker error"));
        }),
      terminate: async () => {
        await w.terminate();
      },
    };
  }
  throw new Error(
    "CookWorkerPool: createWorker returned an object with neither .on (node worker_threads) nor .addEventListener (browser Worker); return one of those",
  );
}

/**
 * The default Node factory: spawn `worker_threads` on the entry built
 * beside this module. Import is dynamic and environment-guarded so a
 * browser bundle of this module carries no `node:` dependency — browser
 * callers pass `createWorker` (the error says how).
 */
async function defaultCreateWorker(): Promise<CookWorkerLike> {
  const isNode =
    typeof process !== "undefined" &&
    (process as { versions?: { node?: string } }).versions?.node !== undefined;
  if (!isNode) {
    throw new Error(
      'CookWorkerPool has no default worker outside Node: pass createWorker — with Vite, `import CookWorker from "pcg-ts/worker/browser?worker"` then `createWorker: () => new CookWorker()`; without a bundler, serve dist/worker/entryBrowser.js and spawn `new Worker(url, { type: "module" })`',
    );
  }
  const { Worker } = await import(/* @vite-ignore */ "node:worker_threads");
  return new Worker(new URL("./entryNode.js", import.meta.url)) as unknown as CookWorkerLike;
}

let nextGraphKey = 0;
/** Pool-process-unique keys for serialized graphs, by object identity. */
const graphKeys = new WeakMap<SerializedGraph, string>();

function keyFor(graph: SerializedGraph): string {
  let key = graphKeys.get(graph);
  if (key === undefined) {
    key = `g${nextGraphKey++}`;
    graphKeys.set(graph, key);
  }
  return key;
}

/**
 * A pool of cook workers; see the module doc for the full contract. Also
 * a `CookBackend`, so it plugs straight into `WorldOptions.pool`.
 */
export class CookWorkerPool implements CookBackend {
  private readonly slots: Slot[] = [];
  private readonly queue: Task[] = [];
  private readonly requestedWorkers: number;
  private nextTaskId = 0;
  private closed = false;
  /** The boot error every future cook reports once no worker survived. */
  private bootError: Error | undefined;
  /** Serialized form of live Graphs, refreshed when their version moves. */
  private readonly liveGraphs = new WeakMap<
    Graph,
    { version: number; serialized: SerializedGraph }
  >();

  constructor(opts: CookWorkerPoolOptions = {}) {
    const cores =
      typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
        ? navigator.hardwareConcurrency
        : 4;
    const workers = opts.workers ?? Math.max(1, cores - 2);
    if (!Number.isInteger(workers) || workers < 1) {
      throw new Error(
        `CookWorkerPool: workers must be an integer >= 1, got ${String(opts.workers)}`,
      );
    }
    this.requestedWorkers = workers;
    const create = opts.createWorker ?? defaultCreateWorker;
    for (let i = 0; i < workers; i++) void this.spawn(create);
  }

  /** Live (non-crashed) worker count; starts at the requested count. */
  get workerCount(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  /** Requested pool size (workers that were asked for at construction). */
  get size(): number {
    return this.requestedWorkers;
  }

  private async spawn(
    create: () => CookWorkerLike | Promise<CookWorkerLike>,
  ): Promise<void> {
    const slot: Slot = {
      transport: undefined,
      sentKeys: new Set(),
      busy: undefined,
      dead: true, // not schedulable until the transport exists
    };
    this.slots.push(slot);
    try {
      const transport = adaptWorker(await create());
      slot.transport = transport;
      transport.onMessage((msg) => this.onWorkerMessage(slot, msg));
      transport.onError((err) => this.onWorkerError(slot, err));
      if (this.closed) {
        void transport.terminate();
        return;
      }
      slot.dead = false;
      this.dispatch();
    } catch (err) {
      this.onWorkerError(slot, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onWorkerMessage(slot: Slot, msg: WorkerToMainMessage): void {
    const task = slot.busy;
    if (task === undefined || task.id !== msg.id) return; // stale/foreign message
    slot.busy = undefined;
    if (!task.settled) {
      task.settled = true;
      task.abortCleanup?.();
      if (msg.t === "ok") {
        const t0 = performance.now();
        const outputs = decodeOutputs(msg.outputs);
        task.resolve({
          outputs,
          stats: { ...msg.stats, decodeMs: performance.now() - t0 },
        });
      } else {
        task.reject(decodeError(msg.error));
      }
    }
    // An aborted task's result lands here too: dropped, worker freed.
    this.dispatch();
  }

  private onWorkerError(slot: Slot, err: Error): void {
    slot.dead = true;
    const task = slot.busy;
    slot.busy = undefined;
    if (task !== undefined && !task.settled) {
      task.settled = true;
      task.abortCleanup?.();
      task.reject(
        new Error(
          `cook worker crashed mid-cook: ${err.message}; the pool keeps running on its remaining workers`,
        ),
      );
    }
    if (this.workerCount === 0 && !this.closed) {
      // Every worker is gone (typically a boot failure: bad entry URL,
      // missing build). Fail loudly and permanently rather than queueing
      // forever.
      this.bootError = new Error(
        `CookWorkerPool has no live workers (last error: ${err.message}); if the pool was constructed without createWorker, the built entry dist/worker/entryNode.js must exist — run the package build, or pass createWorker pointing at a worker entry`,
      );
      for (const t of this.queue.splice(0)) {
        if (!t.settled) {
          t.settled = true;
          t.abortCleanup?.();
          t.reject(this.bootError);
        }
      }
    } else {
      this.dispatch();
    }
  }

  private dispatch(): void {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.dead || slot.busy !== undefined || slot.transport === undefined) continue;
      const transport = slot.transport;
      let task: Task | undefined;
      while ((task = this.queue.shift()) !== undefined && task.settled) {
        /* skip tasks aborted while queued */
      }
      if (task === undefined) return;
      slot.busy = task;
      if (!slot.sentKeys.has(task.key)) {
        transport.post({ t: "graph", key: task.key, graph: task.graph });
        slot.sentKeys.add(task.key);
      }
      transport.post({
        t: "cook",
        id: task.id,
        key: task.key,
        patches: task.patches,
        ...(task.seed !== undefined ? { seed: task.seed } : {}),
        ...(task.outputs !== undefined ? { outputs: task.outputs } : {}),
      });
    }
  }

  /**
   * Cook a serialized graph on the pool. FIFO; resolves with rehydrated
   * outputs, rejects with the worker's error rehydrated into its library
   * class (node-naming message intact), or with `CookCancelledError`
   * when `signal` aborts first.
   */
  cook(req: PoolCookRequest): Promise<PoolCookResult> {
    if (this.closed) {
      return Promise.reject(
        new Error("CookWorkerPool is closed; construct a new pool to cook again"),
      );
    }
    if (this.bootError !== undefined) return Promise.reject(this.bootError);
    if (req.signal?.aborted === true) {
      return Promise.reject(new CookCancelledError());
    }
    return new Promise<PoolCookResult>((resolve, reject) => {
      const task: Task = {
        id: this.nextTaskId++,
        key: keyFor(req.graph),
        graph: req.graph,
        patches: req.patches ?? [],
        seed: req.seed,
        outputs: req.outputs,
        signal: req.signal,
        abortCleanup: undefined,
        settled: false,
        resolve,
        reject,
      };
      if (req.signal !== undefined) {
        const signal = req.signal;
        const onAbort = (): void => {
          if (task.settled) return;
          task.settled = true;
          task.abortCleanup?.();
          // Queued: it is skipped at dispatch. Mid-cook: the worker is
          // left to finish and the landing result is dropped (see the
          // module doc for why not terminate).
          const idx = this.queue.indexOf(task);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new CookCancelledError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
        task.abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }
      this.queue.push(task);
      this.dispatch();
    });
  }

  /**
   * `CookBackend` for `WorldOptions.pool`: serialize the live graph
   * (re-serializing when its edit version moved, releasing the workers'
   * stale copy), cook with the cell's patches, return the outputs.
   */
  async cookCell(req: CellCookRequest): Promise<CellOutputs> {
    let entry = this.liveGraphs.get(req.graph);
    if (entry === undefined || entry.version !== req.graph.version) {
      if (entry !== undefined) this.release(entry.serialized);
      entry = { version: req.graph.version, serialized: serializeGraph(req.graph) };
      this.liveGraphs.set(req.graph, entry);
    }
    const result = await this.cook({
      graph: entry.serialized,
      patches: req.patches,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.outputs !== undefined ? { outputs: req.outputs } : {}),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    });
    return result.outputs;
  }

  /**
   * Drop a graph from every worker's cache (deserialized graph, memo
   * caches, and the JSON). Automatic for `cookCell` graphs when their
   * version moves; call it for long-lived pools whose `cook` graphs
   * churn. In-flight cooks of the graph are unaffected.
   */
  release(graph: SerializedGraph): void {
    const key = graphKeys.get(graph);
    if (key === undefined) return;
    for (const slot of this.slots) {
      if (slot.dead || slot.transport === undefined || !slot.sentKeys.has(key)) continue;
      slot.sentKeys.delete(key);
      slot.transport.post({ t: "release", key });
    }
  }

  /**
   * Terminate every worker. Queued and in-flight cooks reject with
   * `CookCancelledError`; the pool cannot be reused.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const pending = [...this.queue.splice(0)];
    for (const slot of this.slots) {
      if (slot.busy !== undefined) pending.push(slot.busy);
      slot.busy = undefined;
    }
    for (const t of pending) {
      if (!t.settled) {
        t.settled = true;
        t.abortCleanup?.();
        t.reject(new CookCancelledError());
      }
    }
    await Promise.all(
      this.slots.map(async (slot) => {
        if (slot.dead || slot.transport === undefined) return;
        slot.dead = true;
        await slot.transport.terminate();
      }),
    );
  }
}
