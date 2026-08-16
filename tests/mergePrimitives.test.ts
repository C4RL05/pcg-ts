/**
 * A UNION OF NETWORKS IS THE UNION OF THEIR EDGES — the claim
 * `mergePrimitives` exists to make, checked where it can actually be
 * checked: on the edge multiset.
 *
 * Counting primitives would pass on a merge that renumbered a vertex
 * wrongly, because the count survives any renumbering; the edges would
 * silently join the wrong points. `tests/support/edgeMultiset.ts` names
 * each edge by its two endpoints' full point records — position bits,
 * `seed`, every attribute — plus the edge's own primitive attributes, so
 * an edge that landed on another point is a different edge and shows up
 * as one missing and one extra. That is the comparator this file needs,
 * and it lives in `tests/` rather than beside the node for the same
 * reason `crossPartition.test.ts` does: the support module is a test
 * fixture the library must never reach.
 *
 * The negative control is at the bottom: the same two networks through
 * `mergePoints`, which keeps the points and drops the topology. It must
 * fail the same comparison, because a suite whose comparator has never
 * been seen to reject anything proves nothing.
 */
import { describe, expect, it } from "vitest";
import {
  type DataCollection,
  type Geometry,
  Graph,
  connectPoints,
  cook,
  firstGeometry,
  mergePoints,
  mergePrimitives,
  pointScatterInBounds,
} from "../src/index.js";
import { edgeKeys } from "./support/edgeMultiset.js";
import { keyMultisetDiff } from "./support/pointMultiset.js";

/** Scatter → connectPoints, as one branch of the graph under test. */
function network(
  g: Graph,
  id: string,
  seed: number,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): ReturnType<Graph["add"]> {
  const src = g.add(
    pointScatterInBounds,
    { count: 40, seed, boundsMin, boundsMax },
    `${id}Points`,
  );
  const net = g.add(connectPoints, { mode: "radius", radius: 6 }, id);
  g.connect(src, "out", net, "in");
  return net;
}

/** The two branches and a merge of them, cooked in one graph. */
async function cookBranches(
  merger: typeof mergePrimitives | typeof mergePoints,
): Promise<{ a: Geometry; b: Geometry; merged: Geometry }> {
  const g = new Graph(4242);
  const a = network(g, "a", 1, [-15, 0, -15], [15, 0, 15]);
  const b = network(g, "b", 2, [40, 0, -15], [70, 0, 15]);
  const m = g.add(merger, {}, "merged");
  g.connect(a, "out", m, "in");
  g.connect(b, "out", m, "in");
  g.output(a, "out", "a");
  g.output(b, "out", "b");
  g.output(m, "out", "merged");
  const { outputs } = await cook(g);
  return { a: only(outputs, "a"), b: only(outputs, "b"), merged: only(outputs, "merged") };
}

/** The geometry on one cooked output, naming it when there is none. */
function only(outputs: Record<string, DataCollection>, name: string): Geometry {
  const geo = firstGeometry(outputs[name]);
  if (geo === undefined) throw new Error(`output "${name}" carried no geometry`);
  return geo;
}

describe("mergePrimitives over two networks", () => {
  it("emits exactly the union of the two inputs' edges", async () => {
    const { a, b, merged } = await cookBranches(mergePrimitives);
    // Both branches have to hold edges, or the union below is a
    // comparison of two empty sets.
    expect(edgeKeys(a, "branch a").length).toBeGreaterThan(0);
    expect(edgeKeys(b, "branch b").length).toBeGreaterThan(0);
    const diff = keyMultisetDiff(
      [...edgeKeys(a, "branch a"), ...edgeKeys(b, "branch b")],
      edgeKeys(merged, "merged"),
      "the two branches",
      "mergePrimitives",
      "edges",
    );
    expect(diff, diff ?? "").toBeNull();
  });

  it("NEGATIVE CONTROL: mergePoints fails the same comparison", async () => {
    // The comparator must be able to say no. mergePoints keeps every
    // point and drops the topology, so the merged geometry holds no
    // primitives at all — and `edgeKeys` reports zero against the
    // branches' many rather than agreeing with them.
    const { a, b, merged } = await cookBranches(mergePoints);
    expect(merged.primitiveCount).toBe(0);
    const diff = keyMultisetDiff(
      [...edgeKeys(a, "branch a"), ...edgeKeys(b, "branch b")],
      edgeKeys(merged, "merged"),
      "the two branches",
      "mergePoints",
      "edges",
    );
    expect(diff).not.toBeNull();
  });
});
