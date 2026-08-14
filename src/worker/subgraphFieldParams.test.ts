/**
 * A value read by a body's field expression, travelling to a worker.
 *
 * The claim under test is that it needs no protocol at all: an exposed
 * param with no targets is an ordinary param on an ordinary node, so it
 * rides the existing `ParamPatch` — `{node, param, value}` — and the
 * worker's own `applyParamPatches` resolves its schema through the
 * instance's exposed params exactly as the main thread does. If any of
 * that were untrue the two cooks would disagree in bytes, which is what
 * `outputsDiff` reports.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Graph, cook, deserializeGraph, serializeGraph, subgraphNode } from "../index.js";
import { fieldFromJson, pointGrid, setAttribute, type SerializedGraph } from "../index.js";
import { resolveExposedParam } from "../nodes/subgraphParams.js";
import { applyParamPatches } from "../runtime/patches.js";
import { outputsDiff } from "../runtime/runtime.testsupport.js";
import type { CellOutputs, ParamPatch } from "../runtime/types.js";
import { CookWorkerPool } from "./pool.js";
import { bundleWorkerEntry, type BundledEntry } from "./worker.testsupport.js";

/**
 * A graph whose one subgraph node exposes `amp` with NO targets: the
 * body's `setAttribute` reads it inside a field expression, which is the
 * only place the value goes.
 */
function rampGraphJson(): SerializedGraph {
  const inner = new Graph(11);
  const grid = inner.add(pointGrid, { countX: 4, countY: 1, countZ: 4 }, "grid");
  const sa = inner.add(
    setAttribute,
    {
      name: "amp",
      value: fieldFromJson({
        fn: "mul",
        args: [{ fn: "param", name: "amp" }, { fn: "randomField" }],
      }),
    },
    "sa",
  );
  inner.connect(grid, "out", sa, "in");
  const def = subgraphNode(inner, [], [{ name: "out", node: sa, pin: "out" }], [
    resolveExposedParam(inner, {
      name: "amp",
      targets: [],
      description: "Scale on the per-point random value.",
      default: 1,
    }),
  ]);
  const graph = new Graph(7);
  graph.output(graph.add(def, { amp: 1 }, "sub"), "out", "out");
  return serializeGraph(graph);
}

async function cookLocally(json: SerializedGraph, patches: readonly ParamPatch[]): Promise<CellOutputs> {
  const graph = deserializeGraph(json);
  applyParamPatches(graph, patches, "local reference cook");
  return (await cook(graph)).outputs;
}

let entry: BundledEntry;

beforeAll(async () => {
  entry = await bundleWorkerEntry();
}, 120_000);

afterAll(() => {
  entry.cleanup();
});

describe("a body field expression's value through the worker pool", () => {
  it("rides an ordinary ParamPatch and cooks byte-identically", async () => {
    const json = rampGraphJson();
    const pool = new CookWorkerPool({ workers: 2, createWorker: entry.createWorker });
    try {
      for (const amp of [1, 2.5, 0.25]) {
        const patches: ParamPatch[] = [{ node: "sub", param: "amp", value: amp }];
        const remote = await pool.cook({ graph: json, patches });
        const local = await cookLocally(json, patches);
        expect(outputsDiff(local, remote.outputs), `amp ${amp}`).toBeNull();
      }
      // Two different values must not produce the same bytes, or the
      // comparison above would pass on a patch that did nothing.
      const one = await pool.cook({ graph: json, patches: [{ node: "sub", param: "amp", value: 1 }] });
      const two = await pool.cook({ graph: json, patches: [{ node: "sub", param: "amp", value: 2 }] });
      expect(outputsDiff(one.outputs, two.outputs)).not.toBeNull();
    } finally {
      await pool.close();
    }
  }, 60_000);
});
