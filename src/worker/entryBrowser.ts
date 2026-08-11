/**
 * Browser cook worker entry: run inside a module `Worker`. Spawn it from
 * the built file and hand the instance to `CookWorkerPool`:
 *
 * ```ts
 * // With Vite (or any bundler with ?worker imports):
 * import CookWorker from "pcg-ts/worker/browser?worker";
 * const pool = new CookWorkerPool({ createWorker: () => new CookWorker() });
 * // Without a bundler: serve dist/worker/entryBrowser.js and
 * // createWorker: () => new Worker("<url to it>", { type: "module" }).
 * ```
 *
 * All behavior lives in `createCookWorkerHost` — the exact code the Node
 * entry runs and the test suite pins byte-for-byte; this file is the
 * `postMessage` glue for a `DedicatedWorkerGlobalScope`.
 */
import { createCookWorkerHost } from "./host.js";
import type { MainToWorkerMessage } from "./protocol.js";

/** The dedicated-worker global, typed to just the surface used here. */
interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", cb: (ev: MessageEvent) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
if (typeof scope.postMessage !== "function" || typeof scope.addEventListener !== "function") {
  throw new Error(
    "pcg-ts cook worker entry was imported outside a worker scope; load it with new Worker(url, { type: \"module\" }) (or a bundler's ?worker import) and hand the Worker to CookWorkerPool via createWorker",
  );
}
const handle = createCookWorkerHost((msg, transfer) => scope.postMessage(msg, transfer));
scope.addEventListener("message", (ev: MessageEvent) => handle(ev.data as MainToWorkerMessage));
