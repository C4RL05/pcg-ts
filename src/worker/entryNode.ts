/**
 * Node cook worker entry: run inside a `worker_threads.Worker`. This is
 * what `CookWorkerPool`'s default factory spawns
 * (`new URL("./entryNode.js", import.meta.url)`, resolving to the built
 * `dist/worker/entryNode.js`). All behavior lives in `createCookWorkerHost`;
 * this file only wires `parentPort`.
 */
import { parentPort } from "node:worker_threads";
import { createCookWorkerHost } from "./host.js";
import type { MainToWorkerMessage } from "./protocol.js";

if (parentPort === null) {
  throw new Error(
    "pcg-ts cook worker entry was imported on a main thread; it only runs inside a worker_threads Worker — spawn it via CookWorkerPool (pcg-ts/worker) or new Worker(new URL(...))",
  );
}
const port = parentPort;
const handle = createCookWorkerHost((msg, transfer) => port.postMessage(msg, transfer));
port.on("message", (msg: MainToWorkerMessage) => handle(msg));
