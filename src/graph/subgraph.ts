import { isField } from "../fields/index.js";
import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook, withExclusiveGraph } from "./execute.js";
import type { Graph, NodeHandle } from "./graph.js";
import { defineNode, type NodeDef, type PinDef, type PinKind } from "./node.js";
import { type ParamSchema, type ParamValue, paramValueError } from "./params.js";

/** Maps an outer pin name onto a pin of a node inside the inner graph. */
export interface ExposedPin {
  /** Pin name on the wrapping subgraph node. */
  readonly name: string;
  /** Handle of the inner node the pin maps to. */
  readonly node: NodeHandle;
  /** Pin name on the inner node (input pin for inputs, output pin for outputs). */
  readonly pin: string;
}

/** One inner `(node, param)` slot an exposed param writes into. */
export interface ExposedParamTarget {
  /** Handle of the inner node holding the param. */
  readonly node: NodeHandle;
  /** Param name on that inner node. */
  readonly param: string;
  /**
   * Whether this target's own schema accepts a `Field`. Recorded by
   * whoever resolved the exposed schema (schemas live in the node
   * registry, one layer above this one), so the cook-time check can name
   * which targets take Fields and which take plain values only. Absent
   * means "not known to accept fields".
   *
   * This layer takes the claim ON TRUST — it cannot see the registry, so
   * it cannot tell a derived `true` from an invented one. Produce targets
   * with `resolveExposedParam` (the nodes layer), which derives this flag
   * from the target's registered schema. An invented one is caught no
   * earlier than `serializeGraph`, which re-derives every declaration
   * before writing it.
   */
  readonly acceptsField?: boolean;
}

/**
 * A named param on the wrapping subgraph node, bound to one or more inner
 * params: setting it on an instance writes the value into every target at
 * cook time.
 *
 * **This is the low-level RESOLVED form.** The schema and every target's
 * `acceptsField` arrive already derived from the targets' own registered
 * schemas, and this layer takes those per-target facts on trust: param
 * schemas live in the node registry, one layer above, which the graph
 * layer may not import. Build one with `resolveExposedParam(innerGraph,
 * { name, targets, description })` from `pcg-ts` — the supported door,
 * and the only one that cannot claim a type, a bound or a field
 * capability the inner params do not have. Hand-writing this interface
 * makes that lie representable; the checks it escapes are re-run by
 * `serializeGraph`, which re-derives every declaration against the
 * registry before writing it, so a lying wrapper fails at save time
 * rather than at load time.
 *
 * What this layer does enforce, because it can do so without a registry:
 * every target names a node and a param that exist, no two exposed params
 * write to the same inner slot, a value must satisfy the merged schema,
 * and a `Field` may not reach a target that takes plain values.
 */
export interface ExposedParam {
  /** Param name on the wrapping subgraph node. */
  readonly name: string;
  /** Inner slots written at cook time, in declaration order. */
  readonly targets: readonly ExposedParamTarget[];
  /** Merged schema over the targets; the wrapping node's `defaultParams` takes its `default`. */
  readonly schema: ParamSchema;
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
  /**
   * Exposed params of the wrapping node (empty when it declares none).
   * Values live in each INSTANCE's own `params` record — never here — so
   * two instances of one def can carry different values and each hashes
   * into its own memo key.
   */
  readonly params: readonly ExposedParam[];
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

/** One exposed param in a {@link describeSubgraphParams} description. */
export interface DescribedSubgraphParam {
  /** Param name on the subgraph node (the exposed name). */
  readonly name: string;
  /** Merged schema, as resolved from the inner targets at wrap time. */
  readonly schema: ParamSchema;
  /** Inner slots the value is written into, in declaration order. */
  readonly targets: readonly { readonly node: string; readonly param: string }[];
}

/**
 * Per-instance param description of a def created by {@link subgraphNode}:
 * the exposed param names in exposure order, each with the schema resolved
 * from the inner params it binds and the inner targets it writes to. The
 * sibling of {@link describeSubgraphPins}, and the whole reason an agent
 * can drive a subgraph node it did not author: `listNodeTypes()` reports
 * the `subgraph` type as pinless and paramless (pins and params are
 * per-instance), so this is where a wrapped graph's real interface lives.
 *
 * Returns a frozen snapshot; returns `undefined` for any def not created
 * by `subgraphNode` (consistent with {@link getSubgraphSpec}). Throws a
 * `GraphValidationError` naming the exposed param and the inner target
 * when a later edit removed the node or param it binds.
 */
export function describeSubgraphParams<P>(def: NodeDef<P>): readonly DescribedSubgraphParam[] | undefined {
  const spec = subgraphSpecs.get(def);
  if (spec === undefined) return undefined;
  return Object.freeze(
    spec.params.map((exp) =>
      Object.freeze({
        name: exp.name,
        schema: exp.schema,
        targets: Object.freeze(
          exp.targets.map((t) => {
            const state = spec.graph._nodes.get(t.node.id);
            if (state === undefined) {
              throw new GraphValidationError(
                `describeSubgraphParams: exposed param "${exp.name}" writes to inner node "${t.node.id}", which no longer exists in the wrapped graph — removing a bound inner node breaks the wrapper and is not supported`,
              );
            }
            if (!(t.param in (state.def.defaultParams as object))) {
              throw new GraphValidationError(
                `describeSubgraphParams: exposed param "${exp.name}" writes to param "${t.param}" of inner node "${state.id}", which no longer has it; params: ${Object.keys(state.def.defaultParams as object).join(", ") || "(none)"}`,
              );
            }
            return Object.freeze({ node: t.node.id, param: t.param });
          }),
        ),
      }),
    ),
  );
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

/** Array defaults are copied so no two instances share one mutable list. */
function copyParamDefault(v: ParamValue): ParamValue {
  return Array.isArray(v) ? ([...v] as ParamValue) : v;
}

/** Detached copy of one exposed param: handles become bare ids, arrays are copied. */
function detachParam(exp: ExposedParam): ExposedParam {
  return {
    name: exp.name,
    targets: exp.targets.map((t) => ({
      node: { id: t.node.id },
      param: t.param,
      ...(t.acceptsField !== undefined ? { acceptsField: t.acceptsField } : {}),
    })),
    schema: { ...exp.schema, default: copyParamDefault(exp.schema.default) },
  };
}

/** Names the exposed param, the targets that refuse Fields, and the ones that take them. */
function fieldNotAcceptedMessage(exp: ExposedParam): string {
  const label = (t: ExposedParamTarget): string => `"${t.node.id}".${t.param}`;
  const plain = exp.targets.filter((t) => t.acceptsField !== true).map(label);
  const capable = exp.targets.filter((t) => t.acceptsField === true).map(label);
  return [
    `subgraph exposed param "${exp.name}" holds a Field, but it is not field-capable: `,
    `inner ${plain.length === 1 ? "target" : "targets"} ${plain.join(", ")} `,
    `${plain.length === 1 ? "takes" : "take"} plain values only; `,
    `field-capable targets of "${exp.name}": ${capable.join(", ") || "(none)"}; `,
    `set a plain ${exp.schema.type} value, or bind the field-capable targets to an exposed param of their own`,
  ].join("");
}

/**
 * First way a plain (non-field) value fails the merged schema, or
 * `undefined` when it is legal. Two runtime-only exemptions match what
 * serialization already treats as legal, so the cook accepts exactly the
 * values a native node accepts: `items` holds live DataItems injected per
 * cook (the schema's "must be empty" rule is a SERIALIZATION rule), and a
 * field-capable vec param takes a scalar that broadcasts to its arity.
 */
function exposedValueError(schema: ParamSchema, value: unknown): string | undefined {
  if (schema.type === "items") return undefined;
  if (
    (schema.type === "vec3" || schema.type === "vec4") &&
    schema.acceptsField === true &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return undefined;
  }
  return paramValueError(schema, value);
}

/** Names the exposed param, the violation, and the inner slots it drives. */
function valueRejectedMessage(exp: ExposedParam, bad: string): string {
  const targets = exp.targets.map((t) => `"${t.node.id}".${t.param}`).join(", ");
  return `subgraph exposed param "${exp.name}": ${bad}; it writes to ${targets}`;
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
 * Exposed params (the optional fourth argument) give the wrapping node
 * its own params, each bound to one or more inner `(node, param)` slots.
 * Their values live in the wrapping INSTANCE's params record — so two
 * instances of one def can be tuned differently, and the executor's
 * existing param hashing keys each instance's cache on its own values —
 * and are written inward at cook time with quiet setters, inside the same
 * exclusive section as the inner cook, then RESTORED before that section
 * ends: a cook leaves the shared inner graph exactly as it found it.
 *
 * That fourth argument is the LOW-LEVEL RESOLVED form (see
 * {@link ExposedParam}). Its schema and its targets' `acceptsField` flags
 * are taken on trust — this layer cannot see the node registry where param
 * schemas live, so it cannot tell a derived claim from an invented one.
 * Build the argument with `resolveExposedParam(innerGraph, { name,
 * targets, description })` from the nodes layer, the supported door and
 * the only one that derives instead of trusting; `serializeGraph`
 * re-derives every declaration against the registry, so a hand-written
 * lie fails at save time. What this function checks itself is what it can:
 * every exposed name is unique, every target names a node and a param that
 * exist, and no two exposed params claim the same inner slot.
 *
 * Defs created here carry a recorded spec (see {@link getSubgraphSpec}),
 * so graphs containing subgraph nodes serialize: the payload holds the
 * wrapped graph (minus the injected plumbing) plus the exposed pin
 * mappings and param declarations, and deserialization re-wraps through
 * this function.
 */
export function subgraphNode(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
  exposedParams: readonly ExposedParam[] = [],
): NodeDef<Record<string, unknown>> {
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

  // Exposed params. Every target is checked against the live inner graph
  // here — the one validation this layer can do without a registry — so a
  // typo names the node and lists what it does have instead of silently
  // creating a param on an inner node at cook time.
  const paramNames = new Set<string>();
  // Which exposed param already claimed each inner `(node, param)` slot.
  // Two claims on one slot are rejected outright: cooking writes them in
  // declaration order, so the later one would win every cook while the
  // earlier stayed a live-looking knob whose every change forces a recook
  // that provably cannot alter the output.
  const slotOwners = new Map<string, string>();
  const defaultParams: Record<string, unknown> = {};
  for (const exp of exposedParams) {
    if (paramNames.has(exp.name)) {
      throw new GraphValidationError(
        `duplicate exposed param "${exp.name}"; each exposed param needs its own name (bind several inner params to ONE exposed param by listing them all in its targets)`,
      );
    }
    paramNames.add(exp.name);
    if (exp.targets.length === 0) {
      throw new GraphValidationError(
        `exposed param "${exp.name}": needs at least one inner target { node, param } — an exposed param that writes nowhere cannot affect the cook`,
      );
    }
    for (const target of exp.targets) {
      const state = inner._nodes.get(target.node.id);
      if (state === undefined) {
        throw new GraphValidationError(
          `exposed param "${exp.name}": unknown inner node "${target.node.id}"; inner nodes: ${[...inner._nodes.keys()].join(", ") || "(none)"}`,
        );
      }
      if (!(target.param in (state.def.defaultParams as object))) {
        throw new GraphValidationError(
          `exposed param "${exp.name}": node "${state.id}" (type "${state.def.type}") has no param "${target.param}"; params: ${Object.keys(state.def.defaultParams as object).join(", ") || "(none)"}`,
        );
      }
      // NUL-separated: node ids and param names are arbitrary strings, so
      // a printable separator could make two distinct slots collide.
      const slot = JSON.stringify([target.node.id, target.param]);
      const owner = slotOwners.get(slot);
      if (owner === exp.name) {
        throw new GraphValidationError(
          `exposed param "${exp.name}" lists the inner slot "${target.node.id}".${target.param} twice; each target is written once per cook, so the repeat does nothing — list it once`,
        );
      }
      if (owner !== undefined) {
        throw new GraphValidationError(
          `exposed params "${owner}" and "${exp.name}" both write to the inner slot "${target.node.id}".${target.param}; one slot holds one value, so "${exp.name}" would win every cook and "${owner}" would be a dead knob forcing recooks it cannot affect — bind them to different inner params, or expose that slot once and let the one param drive it`,
        );
      }
      slotOwners.set(slot, exp.name);
    }
    defaultParams[exp.name] = copyParamDefault(exp.schema.default);
  }
  const paramList = exposedParams.map(detachParam);

  const def = defineNode<Record<string, unknown>>({
    type: "subgraph",
    inputs: inputPins,
    outputs: outputPins,
    defaultParams,
    // The outer cook's resolver is forwarded into the inner cook, so the
    // wrapper's memo key must carry GPU provenance whenever a resolver
    // is present — the wrapper cannot see which inner nodes adopt, so
    // "always" over-invalidates conservatively (inner nodes apply their
    // own precise "fields" rule inside the nested cook).
    gpu: "always",
    memoKey: () => transitiveVersionKey(inner, new Set()),
    async execute({ inputs, params, seed, signal, budgetMs, gpu }) {
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
        // Values are checked BEFORE the first write, so a bad one fails
        // naming the exposed param and its targets instead of surfacing as
        // "[object Object]" (a Field) or as an inner node's own complaint
        // about a value the author never set there (a plain value out of
        // range) — and leaves the inner graph exactly as it found it.
        for (const exp of paramList) {
          const value = params[exp.name];
          if (isField(value)) {
            if (exp.schema.acceptsField !== true) {
              throw new GraphValidationError(fieldNotAcceptedMessage(exp));
            }
            continue;
          }
          const bad = exposedValueError(exp.schema, value);
          if (bad !== undefined) {
            throw new GraphValidationError(valueRejectedMessage(exp, bad));
          }
        }
        // Same outer seed and inputs reproduce the same inner keys, so the
        // persisted inner caches serve unchanged nodes across outer cooks.
        // Quiet setters: plumbing must not bump the inner version, or the
        // memo key above would invalidate this node on every cook.
        inner._setSeedQuiet(hashCombine(seed, hashString("subgraph")));
        for (const portal of portals) {
          inner._setParamQuiet(portal.handle, "items", inputs[portal.name] ?? []);
        }
        // Exposed values, written inward here and only here. Wrap time is
        // too early (the values do not exist yet) and setParam time is
        // wrong twice over: a loud write would invalidate every other
        // instance of this def, and a quiet one would let the last writer
        // decide what all of them cook.
        //
        // Every one of these writes is undone before the section ends, so
        // a cook LEAVES THE INNER GRAPH EXACTLY AS IT FOUND IT. The inner
        // graph is shared — by the instances of this def, and by anyone
        // reaching it through getSubgraphSpec(def).graph — and it is what
        // serializeGraph reads to emit the nested payload. Without the
        // restore, the payload records whichever value cooked last: bytes
        // that depend on cook history, on which OTHER outer graph cooked,
        // and a failed cook that wedges the graph unserializable with no
        // way back. The inner seed is the same hazard, solved the other
        // way (SubgraphSpec.seed, emitted instead of the live value);
        // params are restored because the graph itself is the shared
        // object an author can hold.
        const saved: Array<{
          handle: NodeHandle<Record<string, unknown>>;
          param: string;
          value: unknown;
        }> = [];
        try {
          for (const exp of paramList) {
            const value = params[exp.name];
            for (const target of exp.targets) {
              // The handle is untyped here by construction — targets name
              // params of arbitrary inner node types, checked above against
              // the live graph rather than by the type system.
              const handle = target.node as NodeHandle<Record<string, unknown>>;
              saved.push({
                handle,
                param: target.param,
                value: inner.require(handle.id).params[target.param],
              });
              inner._setParamQuiet(handle, target.param, value);
            }
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
        } finally {
          // Reverse order, so the first write of a slot is the last undone
          // — the restore is exact even if a future change lets two writes
          // land on one slot. Quiet both ways: restoring must no more bump
          // the inner version than writing did, or the memo key above would
          // invalidate this node on every cook.
          for (let i = saved.length - 1; i >= 0; i--) {
            const slot = saved[i];
            // A node removed mid-cook has nothing to restore; letting
            // `require` throw here would mask the error already in flight.
            if (inner._nodes.has(slot.handle.id)) {
              inner._setParamQuiet(slot.handle, slot.param, slot.value);
            }
          }
        }
      });
    },
  });
  const detach = (e: ExposedPin): ExposedPin => ({ name: e.name, node: { id: e.node.id }, pin: e.pin });
  subgraphSpecs.set(def, {
    graph: inner,
    seed: inner.seed,
    inputs: exposedInputs.map(detach),
    outputs: exposedOutputs.map(detach),
    params: paramList,
  });
  return def;
}
