import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook } from "./execute.js";
import type { Graph, NodeHandle } from "./graph.js";
import { defineNode, type NodeDef, type PinDef } from "./node.js";

/** Maps an outer pin name onto a pin of a node inside the inner graph. */
export interface ExposedPin {
  /** Pin name on the wrapping subgraph node. */
  readonly name: string;
  /** Handle of the inner node the pin maps to. */
  readonly node: NodeHandle;
  /** Pin name on the inner node (input pin for inputs, output pin for outputs). */
  readonly pin: string;
}

interface PortalParams {
  items: DataCollection;
}

/**
 * Pass-through source injected into the inner graph for each exposed
 * input. Its `items` param is the outer collection; items keep their revs,
 * so inner memo keys track outer input changes exactly.
 */
const portalDef = defineNode<PortalParams>({
  type: "__subgraphInput",
  inputs: [],
  outputs: [{ name: "out", kind: "any" }],
  defaultParams: { items: [] },
  execute: ({ params }) => ({ out: params.items }),
});

/**
 * Wrap an inner graph as a node. Cooking the node cooks the inner graph
 * with a seed derived from the outer node seed; the inner graph (and its
 * per-node caches) lives on this definition, so inner caching persists
 * across outer cooks. Exposed inputs feed inner input pins via injected
 * portal nodes; exposed outputs become inner output declarations.
 *
 * Direct edits to the wrapped graph (setParam, connect, ...) bump its
 * `version`, which this node folds into its memo key — so an edited inner
 * graph recooks on the next outer cook instead of serving stale output.
 * The node's own plumbing (seed derivation, portal feeding) uses quiet
 * setters and does not count as an edit.
 *
 * The outer cook's signal and budgetMs are forwarded into the inner cook;
 * onNodeDone is deliberately not — inner node completions are an
 * implementation detail of the composite node (and their ids could shadow
 * outer ones).
 *
 * Note: instances of one definition share the inner graph. Two instances
 * get different seeds, so each cook of one invalidates the other's inner
 * caches — create separate definitions when independent caching matters.
 */
export function subgraphNode(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
): NodeDef<Record<string, never>> {
  const inputPins: PinDef[] = [];
  const portals: Array<{ name: string; handle: NodeHandle<PortalParams> }> = [];
  const seenNames = new Set<string>();
  for (const exp of exposedInputs) {
    if (seenNames.has(exp.name)) {
      throw new GraphValidationError(`duplicate exposed input "${exp.name}"`);
    }
    seenNames.add(exp.name);
    const target = inner.require(exp.node.id);
    const pin = target.def.inputs.find((p) => p.name === exp.pin);
    if (!pin) {
      throw new GraphValidationError(
        `exposed input "${exp.name}": node "${target.id}" has no input pin "${exp.pin}"`,
      );
    }
    const handle = inner.add(portalDef, undefined, `__in_${exp.name}`);
    inner.connect(handle, "out", exp.node, exp.pin);
    inputPins.push({ name: exp.name, kind: pin.kind, multi: pin.multi });
    portals.push({ name: exp.name, handle });
  }

  const outputPins: PinDef[] = [];
  seenNames.clear();
  for (const exp of exposedOutputs) {
    if (seenNames.has(exp.name)) {
      throw new GraphValidationError(`duplicate exposed output "${exp.name}"`);
    }
    seenNames.add(exp.name);
    const source = inner.require(exp.node.id);
    const pin = source.def.outputs.find((p) => p.name === exp.pin);
    if (!pin) {
      throw new GraphValidationError(
        `exposed output "${exp.name}": node "${source.id}" has no output pin "${exp.pin}"`,
      );
    }
    inner.output(exp.node, exp.pin, `__out_${exp.name}`);
    outputPins.push({ name: exp.name, kind: pin.kind });
  }

  return defineNode<Record<string, never>>({
    type: "subgraph",
    inputs: inputPins,
    outputs: outputPins,
    defaultParams: {},
    memoKey: () => String(inner.version),
    async execute({ inputs, seed, signal, budgetMs }) {
      // Same outer seed and inputs reproduce the same inner keys, so the
      // persisted inner caches serve unchanged nodes across outer cooks.
      // Quiet setters: plumbing must not bump the inner version, or the
      // memo key above would invalidate this node on every cook.
      inner._setSeedQuiet(hashCombine(seed, hashString("subgraph")));
      for (const portal of portals) {
        inner._setParamQuiet(portal.handle, "items", inputs[portal.name] ?? []);
      }
      const result = await cook(inner, { signal, budgetMs });
      const out: Record<string, DataCollection> = {};
      for (const exp of exposedOutputs) {
        out[exp.name] = result.outputs[`__out_${exp.name}`] ?? [];
      }
      return out;
    },
  });
}
