import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Registers the full vocabulary main-side, exactly like the worker host
// does worker-side — the corpus graphs reference registered primitives.
import "../primitives/index.js";
import {
  CookCancelledError,
  Graph,
  GraphSerializationError,
  NodeExecutionError,
  cook,
  deserializeGraph,
  fieldFromJson,
  jitterPoints,
  pointScatterInBounds,
  pointScatterInWorld,
  serializeGraph,
  transformPoints,
  type SerializedGraph,
} from "../index.js";
import { applyParamPatches } from "../runtime/patches.js";
import type { CellOutputs, ParamPatch } from "../runtime/types.js";
import { outputsDiff } from "../runtime/testSupport.js";
import { CookWorkerPool } from "./pool.js";
import { bundleWorkerEntry, type BundledEntry } from "./testSupport.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRAPHS_DIR = join(HERE, "../../examples/graphs");

function loadGraphJson(name: string): SerializedGraph {
  return JSON.parse(readFileSync(join(GRAPHS_DIR, name), "utf8")) as SerializedGraph;
}

/** Cook a serialized graph main-thread with the same patches a pool cook gets. */
async function cookLocally(
  json: SerializedGraph,
  patches: readonly ParamPatch[] = [],
  seed?: number,
): Promise<CellOutputs> {
  const graph = deserializeGraph(json);
  applyParamPatches(graph, patches, "local reference cook");
  if (seed !== undefined) graph.setSeed(seed);
  return (await cook(graph)).outputs;
}

/**
 * Re-window the endless-forest graph to one streaming cell: every
 * world-anchored scatter gets the cell's query window and the terrain
 * plane recenters on it — the exact shape of patch the forest demo's
 * per-cell binds produce.
 */
function forestWindowPatches(json: SerializedGraph, cx: number, cz: number, size: number): ParamPatch[] {
  const min = [cx * size, 0, cz * size];
  const max = [(cx + 1) * size, 0, (cz + 1) * size];
  const patches: ParamPatch[] = [];
  for (const node of json.nodes) {
    if (node.type !== "pointScatterInWorld") continue;
    patches.push(
      { node: node.id, param: "boundsMin", value: min },
      { node: node.id, param: "boundsMax", value: max },
    );
  }
  patches.push(
    { node: "ground", param: "size", value: [size, 0, size] },
    { node: "ground", param: "center", value: [(cx + 0.5) * size, 0, (cz + 0.5) * size] },
    { node: "ground", param: "subdivisions", value: [16, 1, 16] },
  );
  return patches;
}

const FOREST = loadGraphJson("endless-forest.json");

/**
 * A deliberately slow serialized graph (~hundreds of ms: fbm noise over a
 * large scatter), for cancellation tests that need a cook to still be in
 * flight when the abort lands.
 */
function slowGraphJson(): SerializedGraph {
  const graph = new Graph(3);
  const scatter = graph.add(pointScatterInBounds, {
    count: 150_000,
    boundsMin: [0, 0, 0],
    boundsMax: [100, 0, 100],
  });
  const warp = graph.add(transformPoints, {
    translate: fieldFromJson({
      fn: "fbm",
      base: "perlinNoise",
      opts: { seed: 5, frequency: 0.05, octaves: 5 },
    }),
  });
  graph.connect(scatter, "out", warp, "in");
  graph.output(warp, "out", "points");
  return serializeGraph(graph);
}

let entry: BundledEntry;

beforeAll(async () => {
  entry = await bundleWorkerEntry();
}, 120_000);

afterAll(() => {
  entry.cleanup();
});

describe("CookWorkerPool", () => {
  it("cooks a corpus of example graphs byte-identically to the main thread", async () => {
    const pool = new CookWorkerPool({ workers: 2, createWorker: entry.createWorker });
    try {
      const names = [
        "basics-scatter-in-bounds.json", // plain point cloud
        "basics-spawn-by-species.json", // instances with per-species batches
        "basics-partition-by-attribute.json", // string attrs, multi-item outputs
        "basics-points-to-path.json", // polyline topology
        "basics-subgraph-exposed-params.json", // subgraph node with exposed params
      ];
      for (const name of names) {
        const json = loadGraphJson(name);
        const remote = await pool.cook({ graph: json });
        const local = await cookLocally(json);
        expect(outputsDiff(local, remote.outputs), name).toBeNull();
      }
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("cooks re-windowed endless-forest cells byte-identically (the real consumer's shape)", async () => {
    const pool = new CookWorkerPool({ workers: 2, createWorker: entry.createWorker });
    try {
      const windows: readonly (readonly [number, number])[] = [
        [0, 0],
        [-1, 2],
      ];
      for (const [cx, cz] of windows) {
        const patches = forestWindowPatches(FOREST, cx, cz, 40);
        const remote = await pool.cook({ graph: FOREST, patches });
        const local = await cookLocally(FOREST, patches);
        expect(outputsDiff(local, remote.outputs), `window ${cx},${cz}`).toBeNull();
        // A forest cell is not trivially empty: the equality above must
        // be about real content.
        const trees = remote.outputs["trees"];
        expect(trees.some((i) => i.kind === "instances" && i.batches.length > 0)).toBe(true);
      }
    } finally {
      await pool.close();
    }
  }, 120_000);

  it("produces identical bytes across pool sizes and submission orders", async () => {
    const graph = new Graph(7);
    const scatter = graph.add(pointScatterInBounds, { count: 64 });
    const jitter = graph.add(jitterPoints, { amount: [0.5, 0, 0.5] });
    graph.connect(scatter, "out", jitter, "in");
    graph.output(jitter, "out", "points");
    const json = serializeGraph(graph);
    const cells = [0, 1, 2, 3].map((i) => ({
      patches: [
        { node: scatter.id, param: "boundsMin", value: [i * 10, 0, 0] },
        { node: scatter.id, param: "boundsMax", value: [(i + 1) * 10, 0, 10] },
        { node: scatter.id, param: "seed", value: 100 + i },
      ] satisfies ParamPatch[],
    }));

    const reference: CellOutputs[] = [];
    for (const cell of cells) reference.push(await cookLocally(json, cell.patches));

    for (const workers of [1, 3]) {
      const pool = new CookWorkerPool({ workers, createWorker: entry.createWorker });
      try {
        // Submit in reverse to decorrelate submission order from cell
        // order; results must not care which worker cooked what, when.
        const results = await Promise.all(
          [...cells.keys()]
            .reverse()
            .map(async (i) => [i, (await pool.cook({ graph: json, patches: cells[i].patches })).outputs] as const),
        );
        for (const [i, outputs] of results) {
          expect(outputsDiff(reference[i], outputs), `pool(${workers}) cell ${i}`).toBeNull();
        }
      } finally {
        await pool.close();
      }
    }
  }, 60_000);

  it("reuses the worker-side graph cache across cooks of one graph object", async () => {
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const json = loadGraphJson("basics-scatter-in-bounds.json");
      const first = await pool.cook({ graph: json });
      const second = await pool.cook({ graph: json });
      // Same graph key, unchanged params: the second cook is served from
      // the worker's warm memo cache.
      expect(second.stats.cached).toBeGreaterThan(0);
      expect(second.stats.cooked).toBe(0);
      expect(outputsDiff(first.outputs, second.outputs)).toBeNull();
      // After release the graph is re-sent and re-deserialized; bytes hold.
      pool.release(json);
      const third = await pool.cook({ graph: json });
      expect(outputsDiff(first.outputs, third.outputs)).toBeNull();
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("cancels a queued cook without touching the in-flight one", async () => {
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const slow = slowGraphJson();
      const inFlight = pool.cook({ graph: slow });
      const controller = new AbortController();
      const small = loadGraphJson("basics-scatter-in-bounds.json");
      const queued = pool.cook({ graph: small, signal: controller.signal });
      controller.abort();
      await expect(queued).rejects.toBeInstanceOf(CookCancelledError);
      const done = await inFlight;
      expect(outputsDiff(await cookLocally(slow), done.outputs)).toBeNull();
    } finally {
      await pool.close();
    }
  }, 120_000);

  it("rejects a mid-cook abort immediately and keeps the worker usable", async () => {
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const controller = new AbortController();
      const aborted = pool.cook({ graph: slowGraphJson(), signal: controller.signal });
      // Give the dispatch a beat so the cook is genuinely in flight (the
      // slow graph runs hundreds of ms; see slowGraphJson).
      await new Promise((r) => setTimeout(r, 30));
      controller.abort();
      await expect(aborted).rejects.toBeInstanceOf(CookCancelledError);
      // The worker was left to finish and its result dropped; the next
      // cook on the same pool must land normally.
      const json = loadGraphJson("basics-scatter-in-bounds.json");
      const after = await pool.cook({ graph: json });
      expect(outputsDiff(await cookLocally(json), after.outputs)).toBeNull();
    } finally {
      await pool.close();
    }
  }, 120_000);

  it("rejects immediately when the signal is already aborted", async () => {
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(
        pool.cook({ graph: FOREST, signal: controller.signal }),
      ).rejects.toBeInstanceOf(CookCancelledError);
    } finally {
      await pool.close();
    }
  });

  it("propagates a mid-cook node failure with the node-naming message intact", async () => {
    const graph = new Graph(1);
    // A window spanning more lattice cells than the node's hard limit:
    // valid JSON, valid params, deterministic throw inside execute.
    const pts = graph.add(
      pointScatterInWorld,
      {
        cellSize: 1,
        density: 0.001,
        boundsMin: [-100_000, 0, -100_000],
        boundsMax: [100_000, 0, 100_000],
      },
      "huge-window",
    );
    graph.output(pts, "out", "points");
    const json = serializeGraph(graph);
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const failure = pool.cook({ graph: json });
      await expect(failure).rejects.toBeInstanceOf(NodeExecutionError);
      const err = (await failure.catch((e: unknown) => e)) as NodeExecutionError;
      expect(err.nodeId).toBe("huge-window");
      expect(err.message).toContain('"huge-window"');
      expect(err.message).toContain("lattice cells");
      // The library's stated fix survives the boundary too.
      expect(err.message).toContain("raise cellSize or query a smaller window");
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("surfaces a deserialization failure as that cook's rejection", async () => {
    const bad = {
      formatVersion: 1,
      seed: 0,
      nodes: [{ id: "x", type: "noSuchNodeType", params: {} }],
      connections: [],
      outputs: [],
    } as unknown as SerializedGraph;
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const failure = pool.cook({ graph: bad });
      await expect(failure).rejects.toBeInstanceOf(GraphSerializationError);
      const err = (await failure.catch((e: unknown) => e)) as Error;
      expect(err.message).toContain('unknown node type "noSuchNodeType"');
      expect(err.message).toContain("registered types:");
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("applies a per-cook seed on the worker exactly like setSeed locally", async () => {
    const graph = new Graph(1);
    const scatter = graph.add(pointScatterInBounds, { count: 32 });
    graph.output(scatter, "out", "points");
    const json = serializeGraph(graph);
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    try {
      const remote = await pool.cook({ graph: json, seed: 4242 });
      const local = await cookLocally(json, [], 4242);
      expect(outputsDiff(local, remote.outputs)).toBeNull();
      // And a different seed produces different bytes, so the seed
      // genuinely crossed the boundary.
      const other = await pool.cook({ graph: json, seed: 1 });
      expect(outputsDiff(remote.outputs, other.outputs)).not.toBeNull();
    } finally {
      await pool.close();
    }
  }, 60_000);

  it("close() rejects outstanding cooks and refuses new ones", async () => {
    const pool = new CookWorkerPool({ workers: 1, createWorker: entry.createWorker });
    const hanging = pool.cook({ graph: slowGraphJson() });
    await pool.close();
    await expect(hanging).rejects.toBeInstanceOf(CookCancelledError);
    await expect(pool.cook({ graph: FOREST })).rejects.toThrow(/closed/);
  }, 60_000);

  it("fails loudly (with the fix) when no worker can boot", async () => {
    const pool = new CookWorkerPool({
      workers: 1,
      createWorker: () => {
        throw new Error("boot went sideways");
      },
    });
    try {
      const attempt = pool.cook({ graph: loadGraphJson("basics-scatter-in-bounds.json") });
      await expect(attempt).rejects.toThrow(/no live workers/);
      await expect(attempt).rejects.toThrow(/createWorker/);
    } finally {
      await pool.close();
    }
  });

  it("validates the workers option", () => {
    expect(() => new CookWorkerPool({ workers: 0, createWorker: entry.createWorker })).toThrow(
      /workers must be an integer >= 1/,
    );
  });
});
