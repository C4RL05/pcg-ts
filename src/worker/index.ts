/**
 * `pcg-ts/worker` — cooking off the main thread.
 *
 * Its own subpath export (like `pcg-ts/primitives`), not part of the
 * root import: `import "pcg-ts"` must not carry worker plumbing, and the
 * pool's default factory resolves its Node worker entry RELATIVE TO THIS
 * MODULE's built location (`dist/worker/entryNode.js`), which only holds
 * while this code stays in the `dist/worker/` entry rather than a shared
 * chunk.
 *
 * ```ts
 * import { CookWorkerPool } from "pcg-ts/worker";
 * const pool = new CookWorkerPool();            // Node: worker_threads
 * const world = new World({ seed, levels, pool }); // levels with bindPatches cook off-thread
 * ```
 *
 * The worker entries themselves ship as `pcg-ts/worker/node`
 * (`worker_threads`, what the default factory spawns) and
 * `pcg-ts/worker/browser` (module `Worker`; see `CookWorkerPoolOptions.createWorker`).
 */
export {
  CookWorkerPool,
  type CookWorkerLike,
  type CookWorkerPoolOptions,
  type PoolCookRequest,
  type PoolCookResult,
} from "./pool.js";
export {
  decodeError,
  decodeOutputs,
  encodeError,
  encodeOutputs,
  type EncodedAttr,
  type EncodedDataItem,
  type EncodedDomain,
  type EncodedError,
  type EncodedGeometryItem,
  type EncodedInstanceBatch,
  type EncodedInstancesItem,
  type EncodedOutputs,
  type EncodedValueItem,
  type MainToWorkerMessage,
  type WorkerCookStats,
  type WorkerToMainMessage,
} from "./protocol.js";
// host.js is deliberately NOT exported here: importing it REGISTERS the
// whole vocabulary (standard nodes + primitives), which is the worker
// entries' business. A pool user importing `pcg-ts/worker` on the main
// thread must not pick up that side effect (the same reasoning that keeps
// `pcg-ts/primitives` out of the root import).
