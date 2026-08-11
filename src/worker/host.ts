/**
 * The cook worker's brain, transport-agnostic: give it a `post` function
 * and feed it `MainToWorkerMessage`s. The Node (`entryNode`) and browser
 * (`entryBrowser`) entries are thin glue around it, so both environments
 * run exactly this code.
 *
 * Importing this module REGISTERS the shipped vocabulary — the full
 * standard node library plus every primitive — the same side-effect
 * imports the CLI entry performs, and for the same reason: names are
 * resolved inside `deserializeGraph` against a global registry, so a
 * worker that forgot them would reject every graph it was sent. It never
 * imports `three` (a worker cannot touch the render device; its instance
 * outputs are CPU batches by design).
 */
import "../index.js";
import "../primitives/index.js";
import { cook, type Graph } from "../graph/index.js";
import { deserializeGraph, type SerializedGraph } from "../nodes/serialize.js";
import { applyParamPatches } from "../runtime/patches.js";
import {
  encodeError,
  encodeOutputs,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
} from "./protocol.js";

interface GraphEntry {
  readonly json: SerializedGraph;
  /** Deserialized lazily on first cook, so a bad graph fails a COOK (with the full library error) rather than a fire-and-forget register. */
  graph?: Graph;
}

/**
 * Create the message handler for one worker. `post` sends a message back
 * to the pool; its second argument is the transfer list (already-sliced
 * buffers — see `encodeOutputs`).
 *
 * Cooks are processed strictly in arrival order on a serial chain: the
 * pool sends one cook at a time per worker, and the chain keeps even a
 * misbehaving caller from interleaving two cooks on one graph instance.
 */
export function createCookWorkerHost(
  post: (msg: WorkerToMainMessage, transfer: ArrayBuffer[]) => void,
): (msg: MainToWorkerMessage) => void {
  const graphs = new Map<string, GraphEntry>();
  let chain: Promise<void> = Promise.resolve();

  async function handleCook(
    msg: Extract<MainToWorkerMessage, { t: "cook" }>,
  ): Promise<void> {
    try {
      const entry = graphs.get(msg.key);
      if (entry === undefined) {
        throw new Error(
          `cook worker: no graph is registered under key "${msg.key}"; send a { t: "graph" } message carrying the serialized graph before cooking it (CookWorkerPool does this automatically — seeing this from the pool is a bug worth reporting)`,
        );
      }
      if (entry.graph === undefined) entry.graph = deserializeGraph(entry.json);
      const graph = entry.graph;
      applyParamPatches(graph, msg.patches, "cook patches");
      if (msg.seed !== undefined) graph.setSeed(msg.seed);
      const t0 = performance.now();
      // No yield budget: the cook owns this thread, and yielding would
      // only stretch the wall time. Cancellation is the pool's business
      // (an aborted cook's result is dropped on the main side).
      const result = await cook(graph, msg.outputs !== undefined ? { outputs: msg.outputs } : {});
      const t1 = performance.now();
      const { encoded, transfer } = encodeOutputs(result.outputs);
      const encodeMs = performance.now() - t1;
      post(
        {
          t: "ok",
          id: msg.id,
          outputs: encoded,
          stats: {
            cooked: result.stats.cooked,
            cached: result.stats.cached,
            cookMs: t1 - t0,
            encodeMs,
          },
        },
        transfer,
      );
    } catch (err) {
      post({ t: "err", id: msg.id, error: encodeError(err) }, []);
    }
  }

  return (msg: MainToWorkerMessage): void => {
    if (msg.t === "graph") {
      graphs.set(msg.key, { json: msg.graph });
    } else if (msg.t === "release") {
      graphs.delete(msg.key);
    } else {
      chain = chain.then(() => handleCook(msg));
    }
  };
}
