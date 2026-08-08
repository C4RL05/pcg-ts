import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook, withExclusiveGraph } from "./execute.js";
import type { Graph, NodeHandle } from "./graph.js";
import { defineNode, type NodeDef, type PinDef, type PinKind } from "./node.js";

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
 * The recorded composition of a def created by {@link subgraphNode}: the
 * wrapped inner graph and the exposed pin mappings, exactly as passed in
 * (detached copies). Serialization reads this to emit the nested payload;
 * it is also the sanctioned way to reach a deserialized subgraph node's
 * inner graph for further edits (which invalidate the wrapping node via
 * its memo key, same as code-first wrapping).
 */
export interface SubgraphSpec {
  /** The wrapped inner graph (the live object, not a copy). */
  readonly graph: Graph;
  /**
   * The inner graph's seed at wrap time. Every cook overwrites the live
   * inner seed with one derived from the outer node seed, so the live
   * value is transient plumbing state; serialization emits this recorded
   * seed instead, keeping the serialized form canonical — identical
   * before and after cooks.
   */
  readonly seed: number;
  /** Exposed input pins of the wrapping node. */
  readonly inputs: readonly ExposedPin[];
  /** Exposed output pins of the wrapping node. */
  readonly outputs: readonly ExposedPin[];
}

/**
 * @internal Plumbing {@link subgraphNode} injected into a wrapped graph:
 * portal node ids (one per exposed input) and `__out_*` output names (one
 * per exposed output). Serialization excludes exactly these, so subgraph
 * payloads carry only user content; re-wrapping on deserialization
 * re-injects them. Sets are merged across multiple wraps of one graph.
 */
export interface SubgraphPlumbing {
  readonly portalIds: ReadonlySet<string>;
  readonly outputNames: ReadonlySet<string>;
}

const subgraphSpecs = new WeakMap<object, SubgraphSpec>();
const plumbingByGraph = new WeakMap<Graph, { portalIds: Set<string>; outputNames: Set<string> }>();

function plumbingOf(graph: Graph): { portalIds: Set<string>; outputNames: Set<string> } {
  let p = plumbingByGraph.get(graph);
  if (!p) {
    p = { portalIds: new Set(), outputNames: new Set() };
    plumbingByGraph.set(graph, p);
  }
  return p;
}

/**
 * The {@link SubgraphSpec} recorded for a def created by
 * {@link subgraphNode}; `undefined` for any other def.
 */
export function getSubgraphSpec<P>(def: NodeDef<P>): SubgraphSpec | undefined {
  return subgraphSpecs.get(def);
}

/** @internal See {@link SubgraphPlumbing}. `undefined` for unwrapped graphs. */
export function getSubgraphPlumbing(graph: Graph): SubgraphPlumbing | undefined {
  return plumbingByGraph.get(graph);
}

/** One pin in a {@link SubgraphPins} description. */
export interface DescribedSubgraphPin {
  /** Pin name on the subgraph node (the exposed name). */
  readonly name: string;
  /** Kind of the exposed inner pin, resolved through nested subgraphs. */
  readonly kind: PinKind;
}

/**
 * Frozen per-instance pin description of a subgraph def; see
 * {@link describeSubgraphPins}.
 */
export interface SubgraphPins {
  readonly inputs: readonly DescribedSubgraphPin[];
  readonly outputs: readonly DescribedSubgraphPin[];
}

/**
 * Resolve the kind of one exposed pin against the live wrapped graph. When
 * the exposed target is itself a subgraph instance, follow its recorded
 * spec (the exposed pin of the nested wrapper) until a concrete pin is
 * reached. `path` is the set of specs on the current resolution path,
 * guarding against adversarial cyclic nesting.
 */
function resolveExposedKind(
  spec: SubgraphSpec,
  exp: ExposedPin,
  side: "input" | "output",
  path: Set<SubgraphSpec>,
): PinKind {
  const state = spec.graph._nodes.get(exp.node.id);
  if (state === undefined) {
    throw new GraphValidationError(
      `describeSubgraphPins: exposed ${side} "${exp.name}" maps to inner node "${exp.node.id}", which no longer exists in the wrapped graph — removing an exposed inner node breaks the wrapper and is not supported`,
    );
  }
  const nested = subgraphSpecs.get(state.def);
  if (nested !== undefined) {
    if (path.has(nested)) {
      throw new GraphValidationError(
        `describeSubgraphPins: exposed ${side} "${exp.name}" resolves through a cycle of nested subgraphs; subgraph nesting must be acyclic`,
      );
    }
    const exposedList = side === "input" ? nested.inputs : nested.outputs;
    const innerExp = exposedList.find((e) => e.name === exp.pin);
    if (innerExp === undefined) {
      throw new GraphValidationError(
        `describeSubgraphPins: exposed ${side} "${exp.name}" maps to pin "${exp.pin}" of subgraph node "${state.id}", which exposes no such ${side}; exposed ${side}s: ${exposedList.map((e) => `"${e.name}"`).join(", ") || "(none)"}`,
      );
    }
    path.add(nested);
    const kind = resolveExposedKind(nested, innerExp, side, path);
    path.delete(nested);
    return kind;
  }
  const pins = side === "input" ? state.def.inputs : state.def.outputs;
  const pin = pins.find((p) => p.name === exp.pin);
  if (pin === undefined) {
    throw new GraphValidationError(
      `describeSubgraphPins: exposed ${side} "${exp.name}" maps to pin "${exp.pin}" of inner node "${state.id}", which has no such ${side} pin; ${side} pins: ${pins.map((p) => `"${p.name}"`).join(", ") || "(none)"}`,
    );
  }
  return pin.kind;
}

/**
 * Per-instance pin description of a def created by {@link subgraphNode}:
 * the exposed pin names in exposure order, each with the kind of the
 * inner pin it maps to — read live from the wrapped graph via the
 * recorded {@link SubgraphSpec}, never guessed. An exposed pin that maps
 * onto another subgraph instance's pin resolves recursively through that
 * instance's spec until a concrete pin is reached, so nested subgraphs
 * report exact kinds.
 *
 * Returns a frozen snapshot; returns `undefined` for any def not created
 * by `subgraphNode` (consistent with {@link getSubgraphSpec}). Throws a
 * `GraphValidationError` naming the pin and inner node when a wrapper was
 * broken by later edits (an exposed inner node or pin no longer exists).
 */
export function describeSubgraphPins<P>(def: NodeDef<P>): SubgraphPins | undefined {
  const spec = subgraphSpecs.get(def);
  if (spec === undefined) return undefined;
  const resolveSide = (
    exposed: readonly ExposedPin[],
    side: "input" | "output",
  ): readonly DescribedSubgraphPin[] =>
    Object.freeze(
      exposed.map((exp) =>
        Object.freeze({
          name: exp.name,
          kind: resolveExposedKind(spec, exp, side, new Set([spec])),
        }),
      ),
    );
  return Object.freeze({
    inputs: resolveSide(spec.inputs, "input"),
    outputs: resolveSide(spec.outputs, "output"),
  });
}

/**
 * Combined edit-version key of a graph and, transitively, of every graph
 * wrapped by subgraph nodes it contains, at any depth — so an edit to the
 * innermost graph of nested subgraphs changes the outermost memo key and
 * invalidates its cache. Computed fresh on every call (versions must be
 * read live; caching the walk would itself go stale). `seen` is the
 * current recursion path: adversarial cyclic wiring must terminate here
 * even though serialization (and cooking) reject it.
 */
function transitiveVersionKey(graph: Graph, seen: Set<Graph>): string {
  if (seen.has(graph)) return "cycle";
  seen.add(graph);
  let key = String(graph.version);
  for (const state of graph._nodes.values()) {
    const spec = subgraphSpecs.get(state.def);
    if (spec !== undefined) key += `/${transitiveVersionKey(spec.graph, seen)}`;
  }
  seen.delete(graph);
  return key;
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
 * `version`, which this node folds into its memo key — transitively
 * through nested subgraph nodes, so an edit to the innermost graph of a
 * nested chain recooks the outermost node instead of serving stale output.
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
 *
 * Defs created here carry a recorded spec (see {@link getSubgraphSpec}),
 * so graphs containing subgraph nodes serialize: the payload holds the
 * wrapped graph (minus the injected plumbing) plus the exposed pin
 * mappings, and deserialization re-wraps through this function.
 */
export function subgraphNode(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
): NodeDef<Record<string, never>> {
  const inputPins: PinDef[] = [];
  const portals: Array<{ name: string; handle: NodeHandle<PortalParams> }> = [];
  const plumbing = plumbingOf(inner);
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
    plumbing.portalIds.add(handle.id);
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
    plumbing.outputNames.add(`__out_${exp.name}`);
    outputPins.push({ name: exp.name, kind: pin.kind });
  }

  const def = defineNode<Record<string, never>>({
    type: "subgraph",
    inputs: inputPins,
    outputs: outputPins,
    defaultParams: {},
    // The outer cook's resolver is forwarded into the inner cook, so the
    // wrapper's memo key must carry GPU provenance whenever a resolver
    // is present — the wrapper cannot see which inner nodes adopt, so
    // "always" over-invalidates conservatively (inner nodes apply their
    // own precise "fields" rule inside the nested cook).
    gpu: "always",
    memoKey: () => transitiveVersionKey(inner, new Set()),
    async execute({ inputs, seed, signal, budgetMs, gpu }) {
      // The writes and the cook are ONE indivisible step. One inner graph
      // can back several wrapper instances — the same def used twice, or,
      // once primitives are named, the same primitive referenced from two
      // graphs — and those wrappers can be cooked concurrently. Preparing
      // outside the guard let a second wrapper overwrite the seed and
      // portal items after the first had written them and before its cook
      // had read them, so the first cook finished against the second's
      // seed: same graph, same seed, an output that depended on
      // scheduling.
      return withExclusiveGraph(inner, async () => {
        // Same outer seed and inputs reproduce the same inner keys, so the
        // persisted inner caches serve unchanged nodes across outer cooks.
        // Quiet setters: plumbing must not bump the inner version, or the
        // memo key above would invalidate this node on every cook.
        inner._setSeedQuiet(hashCombine(seed, hashString("subgraph")));
        for (const portal of portals) {
          inner._setParamQuiet(portal.handle, "items", inputs[portal.name] ?? []);
        }
        // gpu forwards like signal/budgetMs: the inner cook applies the
        // same policy (its per-cook stats view reports into the outer
        // cook's sink; see gpuStatsView in execute.ts).
        const result = await cook(inner, { signal, budgetMs, gpu });
        const out: Record<string, DataCollection> = {};
        for (const exp of exposedOutputs) {
          out[exp.name] = result.outputs[`__out_${exp.name}`] ?? [];
        }
        return out;
      });
    },
  });
  const detach = (e: ExposedPin): ExposedPin => ({ name: e.name, node: { id: e.node.id }, pin: e.pin });
  subgraphSpecs.set(def, {
    graph: inner,
    seed: inner.seed,
    inputs: exposedInputs.map(detach),
    outputs: exposedOutputs.map(detach),
  });
  return def;
}
