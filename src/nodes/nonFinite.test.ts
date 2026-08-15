/**
 * The non-finite guard at the node seam: the two demonstrated failures of
 * `PLAN-finiteness.md` section 5 that no shipped primitive reaches, the
 * four params that are deliberately EXEMPT from it, and the `isField` gate
 * that decides which values it looks at at all.
 *
 * `src/primitives/nonFinite.test.ts` covers the other six demonstrations at
 * the surface an author touches. These two — `sweepProfile.radius` and
 * `pathSegments.radius` — have no primitive recipe behind them, so the
 * knob and the guarded param are the same param, and the graph is built
 * from the nodes themselves.
 */
import { describe, expect, it } from "vitest";
import { type Field, div, vec } from "../fields/index.js";
import { Graph, NodeExecutionError, cook } from "../graph/index.js";
import {
  GraphSerializationError,
  deserializeGraph,
  filterByExpression,
  pathSegments,
  pointLine,
  pointScatterInBounds,
  pointsToPath,
  selfPrune,
  setAttribute,
  sweepProfile,
  transformPoints,
} from "./index.js";

/**
 * `1 / 0` and `0 / 0` as fields. Written as a division rather than as
 * `constant(Infinity)` because the grammar refuses a non-finite CONSTANT
 * where it is written — which is exactly why this guard has to exist: a
 * recipe that COMPUTES one has no literal to refuse.
 */
function infinity(): Field {
  return div(1, 0);
}
function notANumber(): Field {
  return div(0, 0);
}

/** Points in the message of every refusal below that resolves on a cloud. */
const CLOUD_POINTS = 20;

/** Points on the polyline the two path nodes are handed. */
const PATH_POINTS = 6;

/** A straight open polyline, and the graph holding it. */
function pathGraph() {
  const graph = new Graph(5);
  const line = graph.add(pointLine, { count: PATH_POINTS, start: [0, 0, 0], end: [5, 0, 0] }, "line");
  const path = graph.add(pointsToPath, { closed: false }, "path");
  graph.connect(line, "out", path, "in");
  return { graph, path };
}

/** A flat scatter, and the graph holding it. */
function cloudGraph() {
  const graph = new Graph(5);
  const src = graph.add(
    pointScatterInBounds,
    { count: CLOUD_POINTS, boundsMin: [0, 0, 0], boundsMax: [10, 0, 10] },
    "src",
  );
  return { graph, src };
}

/** Cook, returning whatever it threw (or `undefined` when it did not). */
async function attempt(graph: Graph): Promise<unknown> {
  return await cook(graph).then(
    () => undefined,
    (err: unknown) => err,
  );
}

/** The whole refusal, asserted — see `src/primitives/nonFinite.test.ts`. */
function expectRefusal(
  err: unknown,
  expected: {
    nodeId: string;
    nodeType: string;
    param: string;
    spelling: "NaN" | "+Infinity" | "-Infinity";
    elements: number;
  },
): void {
  expect(err).toBeInstanceOf(NodeExecutionError);
  expect((err as NodeExecutionError).nodeId).toBe(expected.nodeId);
  // Two halves rather than one string: a vec param names the offending
  // COMPONENT between them ("at element 0, component 1"), which the
  // callers of this helper do not carry.
  expect((err as Error).message).toContain(
    `${expected.nodeType}: param "${expected.param}" resolved to ${expected.spelling} at element 0`,
  );
  expect((err as Error).message).toContain(
    `${expected.elements} of ${expected.elements} elements are non-finite.`,
  );
  expect((err as Error).message).toContain("A FIELD param is not range-checked");
}

// ---------------------------------------------------------------------------
// Demonstrations 4 and 5
// ---------------------------------------------------------------------------

describe("a node param bound to a field that divides by zero", () => {
  it('4: refuses sweepProfile "radius", which no primitive exposes', async () => {
    const { graph, path } = pathGraph();
    const sweep = graph.add(sweepProfile, { radius: infinity() }, "sweep");
    graph.connect(path, "out", sweep, "in");
    graph.output(sweep, "out", "out");
    // Refused at the param, BEFORE the surface is built: an infinite radius
    // would otherwise become a ring of non-finite points per path point,
    // stitched into triangles nothing can draw or bound.
    expectRefusal(await attempt(graph), {
      nodeId: "sweep",
      nodeType: "sweepProfile",
      param: "radius",
      spelling: "+Infinity",
      elements: PATH_POINTS,
    });
  });

  it('5: refuses pathSegments "radius", resolved on the input points', async () => {
    const { graph, path } = pathGraph();
    const tubes = graph.add(pathSegments, { radius: infinity() }, "tubes");
    graph.connect(path, "out", tubes, "in");
    graph.output(tubes, "out", "out");
    // The count in the message is the INPUT points, not the segments: this
    // param resolves on the domain the path has, and the node averages the
    // two endpoints of each segment afterwards.
    expectRefusal(await attempt(graph), {
      nodeId: "tubes",
      nodeType: "pathSegments",
      param: "radius",
      spelling: "+Infinity",
      elements: PATH_POINTS,
    });
  });
});

// ---------------------------------------------------------------------------
// The opt-outs
// ---------------------------------------------------------------------------

/** A param whose non-finite values are DATA, and the meaning that survives. */
interface OptOut {
  readonly what: string;
  readonly build: () => Graph;
}

const OPT_OUTS: readonly OptOut[] = [
  {
    // NaN means DROP THIS POINT, in the node's own description.
    what: 'filterByExpression "predicate"',
    build: () => {
      const { graph, src } = cloudGraph();
      const filter = graph.add(filterByExpression, { predicate: notANumber() }, "filter");
      graph.connect(src, "out", filter, "in");
      graph.output(filter, "out", "out");
      return graph;
    },
  },
  {
    // The selector's floor+clamp is TOTAL: NaN and -Infinity select entry 0,
    // +Infinity the last, never a per-element throw.
    what: 'setAttribute "value" in string value-list mode',
    build: () => {
      const { graph, src } = cloudGraph();
      const attr = graph.add(
        setAttribute,
        { name: "species", type: "string", values: ["oak", "pine"], value: notANumber() },
        "attr",
      );
      graph.connect(src, "out", attr, "in");
      graph.output(attr, "out", "out");
      return graph;
    },
  },
  {
    // A NaN radius claims nothing: every distance comparison against it is
    // false, which is the spatial index's documented tolerance.
    what: 'selfPrune "minDistance"',
    build: () => {
      const { graph, src } = cloudGraph();
      const prune = graph.add(selfPrune, { minDistance: notANumber() }, "prune");
      graph.connect(src, "out", prune, "in");
      graph.output(prune, "out", "out");
      return graph;
    },
  },
  {
    // A NaN rank loses every contest and falls through to the identity
    // tiebreak, so it ranks last rather than deciding anything.
    what: 'selfPrune "priority"',
    build: () => {
      const { graph, src } = cloudGraph();
      const prune = graph.add(selfPrune, { minDistance: 1, priority: notANumber() }, "prune");
      graph.connect(src, "out", prune, "in");
      graph.output(prune, "out", "out");
      return graph;
    },
  },
];

describe("the four params a non-finite value is DATA on", () => {
  /**
   * The opt-out itself, pinned once. What each of the four MEANS by NaN is
   * pinned where it belongs — `filterByExpression.test.ts`,
   * `attributes.test.ts` ("applies the total floor+clamp selector") and
   * `filtering.test.ts` ("ranks NaN lowest", "treats 0, negative and NaN
   * radii as claiming nothing") — and none of that is repeated here. This
   * test exists so that deleting an opt-out fails by NAME, in one place,
   * instead of scattering unexplained failures across four suites.
   *
   * The control half is what makes it a test of the GUARD and not merely of
   * four cooks: the same NaN field, on params that have not earned an
   * exemption, is refused. Delete the guard and the second loop fails.
   */
  it("takes NaN without a word, while their guarded neighbours refuse it", async () => {
    for (const optOut of OPT_OUTS) {
      const err = await attempt(optOut.build());
      expect(`${optOut.what}: ${err === undefined ? "cooked" : (err as Error).message}`).toBe(
        `${optOut.what}: cooked`,
      );
    }

    // The sharpest pairing in the library: the SAME node and the SAME param
    // as the second opt-out above, differing only in the mode. `value` is a
    // selector into a string list there and a number to write here, and
    // finiteness is a property of what the param MEANS, not of the number.
    const { graph: numeric, src: numericSrc } = cloudGraph();
    const attr = numeric.add(setAttribute, { name: "density", value: notANumber() }, "attr");
    numeric.connect(numericSrc, "out", attr, "in");
    numeric.output(attr, "out", "out");
    expectRefusal(await attempt(numeric), {
      nodeId: "attr",
      nodeType: "setAttribute",
      param: "value",
      spelling: "NaN",
      elements: CLOUD_POINTS,
    });

    // And a neighbour of the other two: the same field, on a param with no
    // documented meaning for NaN, moves every point nowhere in particular.
    const { graph: moved, src: movedSrc } = cloudGraph();
    const move = moved.add(transformPoints, { translate: vec(notANumber(), 0, 0) }, "move");
    moved.connect(movedSrc, "out", move, "in");
    moved.output(move, "out", "out");
    expectRefusal(await attempt(moved), {
      nodeId: "move",
      nodeType: "transformPoints",
      param: "translate",
      spelling: "NaN",
      elements: CLOUD_POINTS,
    });
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe("the isField gate", () => {
  /**
   * The guard scans a resolved column only when the param held a FIELD, and
   * the gate is deliberate rather than an oversight: `constant()`
   * materializes a full `count * tupleSize` column, so scanning plain values
   * here would cost several times more for no coverage — a plain value's
   * finiteness is decidable from the 1-4 raw numbers it is made of, and
   * `paramValueError` (`src/graph/params.ts`) already decides it at every
   * boundary that has a schema. The third assertion below is that boundary,
   * refusing the very value the first one lets through.
   *
   * What the first assertion pins is therefore a HOLE, not a feature:
   * `Graph.setParam` validates nothing, so a plain non-finite value patched
   * straight onto a node still reaches a column. That is a known defect in
   * the PLAIN-value story and wants its own fix at `setParam`; a full column
   * scan standing in for one would be the wrong shape and the wrong cost.
   */
  it("ignores a plain non-finite param, refuses the same value as a field", async () => {
    const { graph, src } = cloudGraph();
    const move = graph.add(transformPoints, {}, "move");
    // Straight past every schema boundary — this is the setParam hole.
    graph.setParam(move, "translate", [Number.POSITIVE_INFINITY, 0, 0]);
    graph.connect(src, "out", move, "in");
    graph.output(move, "out", "out");
    const result = await cook(graph);
    const item = result.outputs.out?.[0];
    expect(item?.kind).toBe("geometry");
    // Not refused, and not clamped either: the value arrives in the column
    // exactly as it was set.
    const P = item?.kind === "geometry" ? item.geo.attrs.point.require("P").data : new Float32Array();
    expect(P[0]).toBe(Number.POSITIVE_INFINITY);

    // The same number, arrived at by a field on the same param: refused.
    // This is the half that fails if the guard is removed, so the gate
    // cannot be widened OR deleted without a named failure here.
    const { graph: viaField, src: fieldSrc } = cloudGraph();
    const moveField = viaField.add(transformPoints, { translate: vec(infinity(), 0, 0) }, "move");
    viaField.connect(fieldSrc, "out", moveField, "in");
    viaField.output(moveField, "out", "out");
    expectRefusal(await attempt(viaField), {
      nodeId: "move",
      nodeType: "transformPoints",
      param: "translate",
      spelling: "+Infinity",
      elements: CLOUD_POINTS,
    });

    // Where the plain value IS checked: the serialization boundary, which
    // names the node and the param and never needs a column to do it.
    let boundary: unknown;
    try {
      deserializeGraph({
        formatVersion: 1,
        seed: 5,
        nodes: [
          {
            id: "move",
            type: "transformPoints",
            params: {
              scale: [1, 1, 1],
              rotateEuler: [0, 0, 0],
              translate: [Number.POSITIVE_INFINITY, 0, 0],
            },
          },
        ],
        connections: [],
        outputs: [{ id: "move", pin: "out", name: "out" }],
      });
    } catch (err) {
      boundary = err;
    }
    expect(boundary).toBeInstanceOf(GraphSerializationError);
    expect((boundary as Error).message).toContain(
      'node "move" param "translate": expected an array of 3 finite numbers',
    );
  });
});
