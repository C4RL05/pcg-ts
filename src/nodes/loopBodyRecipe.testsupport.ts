/**
 * Registered recipes whose bodies were written for a LOOP wrapper, for the
 * suites that check what happens when something materializes them.
 *
 * They exist because the shipped vocabulary contains no such primitive.
 * Two consumers materialized every recipe as a plain `subgraph` and nothing
 * went red, because the only way to reach that bug is to register a body
 * the corpus does not contain — so the fixture has to be BUILT rather than
 * found. It lives here, rather than beside either suite, because both
 * `src/cli` and `src/docs` must import it: their two call sites had the
 * identical bug, and a fix demonstrated through one of them is half a
 * demonstration.
 *
 * Both bodies are shipped node types only, so they genuinely round-trip
 * through `serializeGraph` → `registerSubgraph` and genuinely cook. The
 * registry is global module state with no unregister, so every name here
 * is under `test/` and each caller registers into its own module registry
 * (vitest gives each test FILE one), which is what keeps these invisible
 * to the catalog drift check.
 */
import { Graph } from "../graph/index.js";
import { attributeReduce } from "./attributes.js";
import { forEachNode } from "./forEach.js";
import { transformPoints } from "./pointOps.js";
import { repeatUntilNode } from "./repeatUntil.js";
import { serializeGraph, type SerializedSubgraph } from "./serialize.js";
import { registerSubgraph, type RegisteredSubgraph } from "./subgraphRegistry.js";

/**
 * Lift the recipe payload out of an embedded wrapper node, which is how a
 * recipe is authored in practice: build the loop in code, serialize, and
 * register what the writer emitted. Going through the writer rather than
 * hand-writing the payload is the point — it proves the pins the wrapper
 * actually declares are the ones the inference later reads.
 */
function payloadOf(graph: ReturnType<typeof serializeGraph>, nodeId: string): SerializedSubgraph {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (node?.subgraph === undefined) {
    throw new Error(`loopBodyRecipe: node "${nodeId}" carries no subgraph payload`);
  }
  return node.subgraph;
}

function register(name: string, payload: SerializedSubgraph): RegisteredSubgraph {
  return registerSubgraph(name, {
    graph: payload.graph,
    inputs: payload.inputs,
    outputs: payload.outputs,
    params: payload.params,
  });
}

/**
 * A `forEach` body: it exposes the iterated pin `each`, which is reserved
 * globally, so probing it as a plain `subgraph` is refused outright.
 */
export function registerForEachBody(name: string): RegisteredSubgraph {
  const inner = new Graph(5);
  const xf = inner.add(transformPoints, { translate: [1, 0, 0] }, "xf");
  const def = forEachNode(
    inner,
    [{ name: "each", node: xf, pin: "in" }],
    [{ name: "out", node: xf, pin: "out" }],
  );
  const g = new Graph(9);
  const fe = g.add(def, {}, "fe");
  g.output(fe, "out", "result");
  return register(name, payloadOf(serializeGraph(g), "fe"));
}

/**
 * A `repeatUntil` body: it exposes `carry` on BOTH sides, the name the
 * loop matches its fed-back output to its input by. Reserved on both
 * sides, so this one is refused as a plain `subgraph` too — and refused by
 * a different message than the forEach body, which is why both are here.
 */
export function registerRepeatUntilBody(name: string): RegisteredSubgraph {
  const inner = new Graph(5);
  const t = inner.add(transformPoints, { translate: [1, 0, 0] }, "t");
  const r = inner.add(
    attributeReduce,
    { name: "", domain: "point", mode: "count", outName: "moves" },
    "r",
  );
  inner.connect(t, "out", r, "in");
  const def = repeatUntilNode(
    inner,
    [{ name: "carry", node: t, pin: "in" }],
    [{ name: "carry", node: r, pin: "out" }],
  );
  const g = new Graph(9);
  const loop = g.add(def, { maxRounds: 3, settleAttr: "moves" }, "loop");
  g.output(loop, "carry", "result");
  return register(name, payloadOf(serializeGraph(g), "loop"));
}

/** A recipe with no reserved name anywhere: the control. */
export function registerPlainBody(name: string): RegisteredSubgraph {
  const inner = new Graph(5);
  const xf = inner.add(transformPoints, { translate: [1, 0, 0] }, "xf");
  return register(name, {
    graph: serializeGraph(inner),
    inputs: [{ name: "pts", node: "xf", pin: "in" }],
    outputs: [{ name: "out", node: "xf", pin: "out" }],
    params: [],
  });
}
