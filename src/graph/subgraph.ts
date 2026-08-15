import { type Field, isField } from "../fields/index.js";
import { type FieldSpec, isDerivedSpec, peekFieldSpec } from "../fields/spec.js";
// The field grammar's parser, reached by MODULE and not through
// `../nodes/index.js`. It imports only `../fields` and `../noise`, so
// there is no cycle to break here and no registry crossing the layer
// boundary: this is the grammar itself, which the graph layer needs
// because a body's field expressions are rebuilt against a wrapper's
// exposed values at cook time and building is the only door a value has.
import { type FieldBindings, fieldFromJson, paramNamesOf } from "../fields/fieldJson.js";
import { hashCombine, hashString } from "../random/index.js";
import type { DataCollection } from "./data.js";
import { GraphValidationError } from "./errors.js";
import { cook, withExclusiveGraph } from "./execute.js";
import type { Graph, NodeHandle } from "./graph.js";
import { defineNode, type NodeDef, type PinDef, type PinKind } from "./node.js";
import {
  type ParamSchema,
  type ParamType,
  type ParamValue,
  liveParamValueError,
} from "./params.js";
// The spec map lives one module over so `graph.ts` can read it without
// importing this one back; see subgraphLink.ts.
import { subgraphSpecs } from "./subgraphLink.js";

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
 * A named param on the wrapping subgraph node, bound to zero or more
 * inner params: setting it on an instance writes the value into every
 * target at cook time.
 *
 * The name is ALSO in scope for the body's field expressions: any
 * `{"fn": "param", "name": "…"}` inside a field a body node holds reads
 * this param's value, substituted at cook time. So `targets` is optional
 * fan-out rather than the point — a declaration with none is legal
 * precisely when a body field reads the name, and is how a value reaches
 * somewhere no param slot exists.
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
  /**
   * Inner slots written at cook time, in declaration order. May be empty,
   * and then a body field expression must read the name instead — see the
   * note above.
   */
  readonly targets: readonly ExposedParamTarget[];
  /** Merged schema over the targets; the wrapping node's `defaultParams` takes its `default`. */
  readonly schema: ParamSchema;
}

/** @internal Params of the injected pass-through source. */
export interface PortalParams {
  items: DataCollection;
}

/**
 * The two node types built on the inner-graph machinery below.
 *
 * `subgraph` cooks its body once, forwarding each pin's whole collection.
 * `forEach` cooks it once per element of one designated pin, broadcasting
 * the rest. They share everything except that loop, which is why they share
 * a spec, a payload shape and a construction path.
 */
export type WrapperKind = "subgraph" | "forEach";

/**
 * Exposed-input names reserved for the iterated pin of a `forEach`.
 *
 * Reserved GLOBALLY rather than only meaningful on a forEach, because a
 * registered recipe records a body and its exposed pins and nothing about
 * which wrapper cooks them — so without this, a body authored to be
 * iterated could be referenced from a `subgraph` node and cook once over
 * the concatenated collection. That is the same wrong-but-well-formed
 * answer the writer's type discriminator closes, reached through the
 * registry instead.
 */
export const ITERATED_PIN_NAMES: ReadonlySet<string> = new Set(["each", "eachPoint"]);

/**
 * The recorded composition of a def created by {@link subgraphNode}: the
 * wrapped inner graph and the exposed pin mappings, exactly as passed in
 * (detached copies). Serialization reads this to emit the nested payload;
 * it is also the sanctioned way to reach a deserialized subgraph node's
 * inner graph for further edits (which invalidate the wrapping node via
 * its memo key, same as code-first wrapping).
 */
export interface SubgraphSpec {
  /**
   * Which factory built the def, and therefore what the node MEANS.
   *
   * Load-bearing for serialization, not decoration. Both wrappers record a
   * spec here and the writer dispatches on the spec's presence, so without
   * this a `forEach` would be written out as a plain `subgraph` node: it
   * would round-trip, validate and cook — one pass over the concatenated
   * collection instead of one pass per item. A wrong answer that saves
   * cleanly is the worst shape a bug can take, so the discriminator travels
   * with the spec rather than being inferred at the emit site.
   */
  readonly wrapper: WrapperKind;
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
export function transitiveVersionKey(graph: Graph, seen: Set<Graph>): string {
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

/** One body param slot whose field expression reads exposed params by name. */
interface BodyFieldRef {
  /** Id of the inner node holding the field. */
  readonly node: string;
  /** Param name on that inner node. */
  readonly param: string;
  /**
   * The spec the field was built from. Kept because binding SUBSTITUTES:
   * a value reaches the expression only by rebuilding the field from this
   * spec, which is what puts the value in `Field.key` and so in the body
   * node's memo key. `fieldFromJson` clones it and stamps the clone on the
   * rebuilt field, so the reference — not the value it stood for — is
   * still what a re-scan (or a save) sees while a rebuild is installed.
   */
  readonly spec: FieldSpec;
  /** Names this spec references, sorted and deduplicated. */
  readonly names: readonly string[];
}

/** What one body's field expressions read, as of one {@link Graph.version}. */
interface BodyScan {
  readonly version: number;
  /** Slots holding an AUTHORED spec: the ones a cook rebuilds. */
  readonly refs: readonly BodyFieldRef[];
  /**
   * Slots reading a name through a DERIVED spec, which cannot be rebuilt
   * (see {@link bodyScan}) and so are refused rather than bound.
   */
  readonly derivedRefs: readonly BodyFieldRef[];
  /** Every name any of `refs` reads. */
  readonly names: ReadonlySet<string>;
}

const bodyScans = new WeakMap<Graph, BodyScan>();

/**
 * What `body` reads by name, computed once per edit of it.
 *
 * Version-keyed rather than frozen at wrap time, because the body is not
 * frozen at wrap time: `getSubgraphSpec(def).graph` is the sanctioned door
 * back to it, and setting a field on an inner node after wrapping is an
 * ordinary edit. Every such edit bumps {@link Graph.version} (the quiet
 * writes this module makes deliberately do not), and that same counter is
 * already in the wrapper's `memoKey` through `transitiveVersionKey` — so a
 * body whose scan moved is a body whose wrapper recooks anyway.
 *
 * Keyed per GRAPH rather than per def: one body can back several wrappers,
 * and what it reads is a fact about the body alone.
 *
 * Only AUTHORED specs are BOUND. A field composed in TypeScript on top of
 * one — `mul(fieldFromJson(spec), 3)` — carries a DERIVED spec, and
 * rebuilding from that would hand the field an authored spec it never had,
 * moving it onto the device for a graph that never asked (see
 * `deviceSpec`). Those are collected separately and refused when they read
 * a name this wrapper declares (see {@link checkDerivedReaders}); one
 * reading a name nothing declares is left alone, since it can only be a
 * value an author already baked in.
 */
function bodyScan(body: Graph): BodyScan {
  const cached = bodyScans.get(body);
  if (cached !== undefined && cached.version === body.version) return cached;
  const refs: BodyFieldRef[] = [];
  const derivedRefs: BodyFieldRef[] = [];
  const names = new Set<string>();
  for (const state of body._nodes.values()) {
    for (const [param, value] of Object.entries(state.params)) {
      if (!isField(value)) continue;
      const spec = peekFieldSpec(value);
      if (spec === undefined) continue;
      const read = paramNamesOf(spec);
      if (read.length === 0) continue;
      const ref: BodyFieldRef = { node: state.id, param, spec, names: read };
      if (isDerivedSpec(spec)) {
        derivedRefs.push(ref);
        continue;
      }
      refs.push(ref);
      for (const name of read) names.add(name);
    }
  }
  const scan: BodyScan = { version: body.version, refs, derivedRefs, names };
  bodyScans.set(body, scan);
  return scan;
}

/** `"nodeId".param`, the way these errors name a body slot. */
function refLabel(ref: BodyFieldRef): string {
  return `"${ref.node}".${ref.param}`;
}

/** The body slots reading `name`, for a message. */
function readersOf(scan: BodyScan, name: string): string {
  return scan.refs
    .filter((ref) => ref.names.includes(name))
    .map(refLabel)
    .join(", ");
}

function quotedList(names: Iterable<string>): string {
  return (
    [...names]
      .sort()
      .map((n) => `"${n}"`)
      .join(", ") || "(none)"
  );
}

/**
 * Param types a field expression can read. Binding substitutes a literal,
 * and the grammar's literals are a number or a numeric tuple — so a
 * `string`, `bool`, `enum`, `items` or `stringList` param has nothing to
 * substitute.
 */
const BINDABLE_PARAM_TYPES: ReadonlySet<ParamType> = new Set<ParamType>([
  "f32",
  "i32",
  "u32",
  "vec3",
  "vec4",
]);

/**
 * Types a param with NO targets may carry: what deriving a schema from a
 * default's shape produces (`resolveExposedParam` in the nodes layer). A
 * narrower set than {@link BINDABLE_PARAM_TYPES}, deliberately —
 * `i32`/`u32` are legal to READ (a real inner param can be one) but not to
 * derive, because a field expression has no integers.
 */
const TARGETLESS_PARAM_TYPES: ReadonlySet<ParamType> = new Set<ParamType>(["f32", "vec3", "vec4"]);

/**
 * The value `name` binds as, or `undefined` when it cannot bind at all.
 * Finite throughout, because that is what the grammar's literals are: a
 * NaN reaching a spec would fail one layer in, where the message can no
 * longer say which exposed param it came from.
 *
 * A `Field` binds as itself. It is the one binding that is not a literal:
 * `fieldFromJson` splices it into the expression where the reference
 * stands, so the value can vary per element instead of only per cook —
 * which is what a knob driving a noise-shaped amount needs, and what the
 * per-point attribute column this replaces used to buy at the cost of
 * three nodes and a storage buffer.
 */
function bindingValue(value: unknown): number | readonly number[] | Field | undefined {
  if (isField(value)) return value;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (finite(value)) return value;
  if (Array.isArray(value) && value.length > 0 && value.every(finite)) {
    return value as readonly number[];
  }
  return undefined;
}

/**
 * Refuse a body field that reads a name nothing declares.
 *
 * Checked at wrap time, where the declarations are, rather than left to
 * the unbound-param failure the field itself would raise when it lands on
 * a domain: this one runs before a single node cooks, names the slot
 * holding the expression, and lists what the wrapper does declare, so a
 * typo shows its near-miss.
 *
 * Re-checked per cook because the body can be edited afterwards.
 */
function checkBodyReferences(scan: BodyScan, declared: ReadonlySet<string>): void {
  for (const ref of scan.refs) {
    for (const name of ref.names) {
      if (declared.has(name)) continue;
      throw new GraphValidationError(
        `the body's field expression at ${refLabel(ref)} reads {"fn": "param", "name": ${JSON.stringify(name)}}, ` +
          `but this wrapper exposes no param "${name}" to supply it; exposed params: ${quotedList(declared)} — ` +
          `declare "${name}" as an exposed param (its "targets" may be empty: a declaration with none exists exactly to feed a field expression), or correct the name`,
      );
    }
  }
}

/**
 * Refuse a body field that reads a DECLARED name through a spec the
 * constructors composed rather than one `fieldFromJson` authored.
 *
 * Such a field cannot be rebuilt — see {@link bodyScan} — so it would
 * keep whatever value it was built with while every authored expression
 * in the same body took the instance's. Two expressions reading one name
 * and disagreeing is a wrong cook with nothing to show for it, which is
 * the one outcome worth refusing outright.
 *
 * A derived spec reading a name this wrapper does NOT declare is left
 * alone: nothing here would have bound it, so there is nothing to
 * disagree with, and an unbound one still fails at evaluate.
 */
function checkDerivedReaders(scan: BodyScan, declared: ReadonlySet<string>): void {
  for (const ref of scan.derivedRefs) {
    for (const name of ref.names) {
      if (!declared.has(name)) continue;
      throw new GraphValidationError(
        `the body's field at ${refLabel(ref)} reads the exposed param "${name}", but it was COMPOSED with the field constructors (mul(fieldFromJson(…), 3)) rather than authored as one JSON spec — ` +
          `only an authored spec is rebuilt against an exposed value, so this expression would silently keep what it was built with while the rest of the body took "${name}"; ` +
          "write the whole expression as a single fieldFromJson spec, or read a name this wrapper does not expose",
      );
    }
  }
}

/**
 * Refuse an exposed param whose target IS the slot holding a field that
 * reads exposed names. Both writes land on one slot in one cook, so one of
 * them provably does nothing: the fan-out would overwrite the whole
 * expression, or the rebuilt expression would overwrite the fan-out.
 */
function checkSlotConflicts(scan: BodyScan, paramList: readonly ExposedParam[]): void {
  if (scan.refs.length === 0) return;
  for (const exp of paramList) {
    for (const target of exp.targets) {
      const ref = scan.refs.find((r) => r.node === target.node.id && r.param === target.param);
      if (ref === undefined) continue;
      throw new GraphValidationError(
        `exposed param "${exp.name}" writes to the inner slot ${refLabel(ref)}, which holds a field expression reading ${quotedList(ref.names)} — ` +
          `the write would replace the whole expression, so one of the two provably does nothing; drop that target and let the expression read "${exp.name}" by name, or move the expression to a slot nothing fans out into`,
      );
    }
  }
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
 * Names the exposed param, the body slots that read it, and the way out,
 * for a Field handed to a name whose SCHEMA does not admit one.
 *
 * The read route itself can carry a Field — it is spliced into the
 * expression where the reference stands — so the refusal is about the
 * declaration rather than the mechanism: a schema that says "plain values
 * only" is what a saved graph and a UI panel both act on, and honouring a
 * Field it does not advertise would make the two disagree.
 */
function fieldNotBindableMessage(exp: ExposedParam, readers: string): string {
  return (
    `subgraph exposed param "${exp.name}" holds a Field, and the body's field expression at ${readers} reads it by name, but its schema does not accept one: ` +
    `set a plain ${exp.schema.type} value, or declare the param field-capable — build it with resolveExposedParam, which derives the capability (a param with no targets is always field-capable, since a Field splices into the expression exactly where a number would)`
  );
}

/**
 * First way a plain (non-field) value fails the merged schema, or
 * `undefined` when it is legal. The shared live-graph rule, which carries
 * the two runtime-only exemptions this seam needs — an `items` param
 * holding live DataItems, and a field-capable vec param taking a scalar
 * broadcast — so an exposed param accepts exactly what `Graph.setParam`
 * accepts on the inner node it writes to.
 */
const exposedValueError = liveParamValueError;

/**
 * Names the exposed param, the violation, and what the value drives —
 * either route, since a param with no targets is driving field
 * expressions and saying "it writes to " would name nothing at all.
 */
function valueRejectedMessage(exp: ExposedParam, bad: string, readers: string): string {
  const targets = exp.targets.map((t) => `"${t.node.id}".${t.param}`).join(", ");
  const drives = [
    targets === "" ? "" : `writes to ${targets}`,
    readers === "" ? "" : `is read by the body's field expression at ${readers}`,
  ]
    .filter((part) => part !== "")
    .join(", and ");
  return `subgraph exposed param "${exp.name}": ${bad}; it ${drives}`;
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
 * its own params, each bound to zero or more inner `(node, param)` slots
 * and, by name, to the body's field expressions: a field a body node holds
 * reads one as `{"fn": "param", "name": "…"}`, which is how a value
 * reaches inside an expression, where no param slot exists. A declaration
 * needs one route or the other; `targets` alone is no longer the point.
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
  const parts = prepareWrapper(inner, exposedInputs, exposedOutputs, exposedParams);
  const { portals, paramList } = parts;

  const def = defineNode<Record<string, unknown>>({
    type: "subgraph",
    inputs: parts.inputPins,
    outputs: parts.outputPins,
    defaultParams: parts.defaultParams,
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
        checkExposedValues(inner, paramList, params);
        // Same outer seed and inputs reproduce the same inner keys, so the
        // persisted inner caches serve unchanged nodes across outer cooks.
        // Quiet setters: plumbing must not bump the inner version, or the
        // memo key above would invalidate this node on every cook.
        inner._setSeedQuiet(hashCombine(seed, hashString("subgraph")));
        for (const portal of portals) {
          inner._setParamQuiet(portal.handle, "items", inputs[portal.name] ?? []);
        }
        return withExposedParams(inner, paramList, params, async () => {
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
      });
    },
  });
  recordWrapperSpec(def, "subgraph", inner, exposedInputs, exposedOutputs, paramList);
  return def;
}

/**
 * @internal Validate one wrapper's exposed interface and inject its
 * plumbing, returning what the definition needs.
 *
 * Shared by {@link subgraphNode} and `forEachNode` because the interface is
 * the same construction in both: the two differ only in how often the body
 * cooks, which is the execute body and nothing here.
 */
export function prepareWrapper(
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
  exposedParams: readonly ExposedParam[],
): {
  inputPins: PinDef[];
  outputPins: PinDef[];
  portals: Array<{ name: string; handle: NodeHandle<PortalParams> }>;
  paramList: ExposedParam[];
  defaultParams: Record<string, unknown>;
} {
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
  //
  // A param reaches the body by two routes, and the checks below cover
  // both: `targets` writes it into inner param slots, and the NAME is in
  // scope for the body's field expressions, which read it as
  // {"fn": "param", "name": …}. Each route is optional on its own; a
  // declaration with neither is the one thing that cannot affect a cook.
  const scan = bodyScan(inner);
  // Ahead of everything else, so a body reading a declared name through a
  // spec that cannot be rebuilt is named as itself rather than as a
  // declaration that reads nothing.
  checkDerivedReaders(scan, new Set(exposedParams.map((exp) => exp.name)));
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
    const readByBody = scan.names.has(exp.name);
    if (exp.targets.length === 0) {
      if (!readByBody) {
        throw new GraphValidationError(
          `exposed param "${exp.name}": needs at least one inner target { node, param } to write into, or a field expression in the body reading it as {"fn": "param", "name": "${exp.name}"} — ` +
            `an exposed param that does neither cannot affect the cook; names the body's field expressions do read: ${quotedList(scan.names)}`,
        );
      }
      // With no targets there is no inner schema to have come from, so the
      // schema must be exactly what deriving one from a default's SHAPE
      // produces (`resolveExposedParam`, the supported door). Anything else
      // wraps and cooks but can never be saved: `serializeGraph` re-derives
      // the declaration and would refuse it.
      if (!TARGETLESS_PARAM_TYPES.has(exp.schema.type)) {
        throw new GraphValidationError(
          `exposed param "${exp.name}" has no targets and type "${exp.schema.type}"; a targetless param's schema is derived from the SHAPE of its default, which yields ${[...TARGETLESS_PARAM_TYPES].join(", ")} and nothing else — ` +
            "give it an inner target to derive that type from, or declare it as one of those",
        );
      }
      // A targetless param IS field-capable, and there is nothing here to
      // check: its one route into the body is substitution into a field
      // expression, and a Field substitutes there as readily as a number
      // — it is spliced in where the reference stands rather than written
      // as a literal. The capability is derived from that fact rather
      // than authored (`resolveExposedParam`), so a declaration reaching
      // this layer without it merely under-claims: it cooks, refusing
      // Fields, and `serializeGraph` refuses to SAVE it, naming the
      // resolver that would have derived it.
    }
    if (readByBody && !BINDABLE_PARAM_TYPES.has(exp.schema.type)) {
      throw new GraphValidationError(
        `exposed param "${exp.name}" is read by the body's field expression at ${readersOf(scan, exp.name)}, but its type "${exp.schema.type}" cannot be substituted into one: ` +
          `a field expression takes a number or a numeric tuple, so only ${[...BINDABLE_PARAM_TYPES].join(", ")} params can be read by name`,
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
  checkBodyReferences(scan, paramNames);
  checkSlotConflicts(scan, exposedParams);
  const paramList = exposedParams.map(detachParam);
  return { inputPins, outputPins, portals, paramList, defaultParams };
}

/**
 * @internal Record what a wrapper def is made of, so it serializes.
 *
 * Both wrappers land here, and `wrapper` is the field that keeps them
 * apart at the emit site — see {@link SubgraphSpec.wrapper}. Registering
 * here is also what puts a def in front of `checkNoWrapCycle`: a wrapper
 * missing from this map is a wrapper whose self-nesting is not refused at
 * `add` time and hangs at cook time instead.
 */
export function recordWrapperSpec(
  def: NodeDef<Record<string, unknown>>,
  wrapper: WrapperKind,
  inner: Graph,
  exposedInputs: readonly ExposedPin[],
  exposedOutputs: readonly ExposedPin[],
  paramList: readonly ExposedParam[],
): void {
  const detach = (e: ExposedPin): ExposedPin => ({ name: e.name, node: { id: e.node.id }, pin: e.pin });
  subgraphSpecs.set(def, {
    wrapper,
    graph: inner,
    seed: inner.seed,
    inputs: exposedInputs.map(detach),
    outputs: exposedOutputs.map(detach),
    params: paramList,
  });
}

/**
 * @internal Check every exposed value BEFORE the first write, so a bad one
 * fails naming the exposed param and its targets instead of surfacing as
 * "[object Object]" (a Field) or as an inner node's own complaint about a
 * value the author never set there (a plain value out of range) — and
 * leaves the inner graph exactly as it found it.
 */
export function checkExposedValues(
  inner: Graph,
  paramList: readonly ExposedParam[],
  params: Record<string, unknown>,
): void {
  const scan = bodyScan(inner);
  for (const exp of paramList) {
    const value = params[exp.name];
    const readByBody = scan.names.has(exp.name);
    if (isField(value)) {
      // Both routes carry a Field now — `targets` write it into inner
      // slots that accept one, the read route splices it into the body's
      // expression — so what is left to check is the SCHEMA, which is
      // what a saved graph, a panel and an agent all read. The message
      // differs by route because the fix does: a target list that refuses
      // fields is a different problem from a declaration that under-claims.
      if (exp.schema.acceptsField !== true) {
        throw new GraphValidationError(
          readByBody && exp.targets.length === 0
            ? fieldNotBindableMessage(exp, readersOf(scan, exp.name))
            : fieldNotAcceptedMessage(exp),
        );
      }
      continue;
    }
    const bad = exposedValueError(exp.schema, value);
    if (bad !== undefined) {
      throw new GraphValidationError(
        valueRejectedMessage(exp, bad, readByBody ? readersOf(scan, exp.name) : ""),
      );
    }
    if (readByBody && bindingValue(value) === undefined) {
      throw new GraphValidationError(
        `subgraph exposed param "${exp.name}" holds ${JSON.stringify(value) ?? String(value)}, which cannot be substituted into the field expression at ${readersOf(scan, exp.name)} that reads it; ` +
          "a field expression takes a number, a non-empty numeric tuple, or a Field",
      );
    }
  }
}

/**
 * @internal Write the exposed values inward, run `fn`, and restore them.
 *
 * Two routes in, both undone by the one `finally`: the declared `targets`
 * take the value into inner param slots, and every body field expression
 * reading an exposed name is REBUILT from its authored spec against the
 * current values. The rebuild is not an optimization of a write — a field
 * built with the value in it carries that value in `Field.key`, which is
 * what the executor hashes, so substituting at build time is the only
 * spelling under which a changed value moves a body node's memo key.
 *
 * A value that is itself a `Field` binds through the same rebuild, and
 * that is the whole of what makes a bound name able to VARY per element:
 * `fieldFromJson` splices the bound field in where the reference stands,
 * so the expression comes out as the author would have written it around
 * a noise. Its key composes in exactly as a number's value does, so
 * invalidation is no less exact for it.
 *
 * Written here and only here. Wrap time is too early (the values do not
 * exist yet) and setParam time is wrong twice over: a loud write would
 * invalidate every other instance of this def, and a quiet one would let
 * the last writer decide what all of them cook.
 *
 * Every write is undone before this returns, so a cook LEAVES THE INNER
 * GRAPH EXACTLY AS IT FOUND IT. The inner graph is shared — by the
 * instances of this def, and by anyone reaching it through
 * `getSubgraphSpec(def).graph` — and it is what `serializeGraph` reads to
 * emit the nested payload. Without the restore, the payload records
 * whichever value cooked last: bytes that depend on cook history, on which
 * OTHER outer graph cooked, and a failed cook that wedges the graph
 * unserializable with no way back. The inner seed is the same hazard,
 * solved the other way (`SubgraphSpec.seed`, emitted instead of the live
 * value); params are restored because the graph itself is the shared
 * object an author can hold.
 *
 * A `forEach` wraps its WHOLE loop in one of these rather than one per
 * iteration: the values do not vary between iterations, and restoring K
 * times would be K chances to leave the graph dirty for one that is
 * enough.
 */
export async function withExposedParams<T>(
  inner: Graph,
  paramList: readonly ExposedParam[],
  params: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Array<{
    handle: NodeHandle<Record<string, unknown>>;
    param: string;
    value: unknown;
  }> = [];
  // BEFORE the target writes, not after. The scan is memoized per body
  // version, so a cold cache here would scan a body that this call has
  // already substituted into — and a param-bearing Field written into a
  // target slot would then read back as a body reader and refuse the cook.
  // Both current callers happen to warm it first via `checkExposedValues`;
  // depending on that would make this function correct only by luck.
  const scan = bodyScan(inner);
  try {
    for (const exp of paramList) {
      const value = params[exp.name];
      for (const target of exp.targets) {
        // The handle is untyped here by construction — targets name params
        // of arbitrary inner node types, checked in prepareWrapper against
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
    // The other route in: a body field expression reading exposed names.
    // It is REBUILT rather than written, because binding substitutes — the
    // value has to be there when the field is constructed or it never
    // reaches `Field.key`, and a value outside that key is a value the
    // executor's memo cannot see (it would serve the previous one's bytes).
    // The rebuilt field goes into the same `saved` list as any other write,
    // so the restore below covers it on every path out, cancellation
    // included.
    if (scan.refs.length > 0 || scan.derivedRefs.length > 0) {
      // Re-run per cook, because the body can be edited after wrapping —
      // these are the same three refusals `prepareWrapper` makes, against
      // the same scan, for a body that has moved since.
      const declared = new Set(paramList.map((exp) => exp.name));
      checkDerivedReaders(scan, declared);
      checkBodyReferences(scan, declared);
      checkSlotConflicts(scan, paramList);
      const bindings: Record<string, FieldBindings[string]> = {};
      for (const exp of paramList) {
        if (!scan.names.has(exp.name)) continue;
        const bound = bindingValue(params[exp.name]);
        // `checkExposedValues` has already refused anything unbindable and
        // runs before every cook; this is the belt to its braces, and keeps
        // this function correct when called on its own.
        if (bound === undefined) {
          throw new GraphValidationError(
            `subgraph exposed param "${exp.name}" cannot be substituted into the field expression at ${readersOf(scan, exp.name)} that reads it; a field expression takes a number, a non-empty numeric tuple, or a Field`,
          );
        }
        bindings[exp.name] = bound;
      }
      for (const ref of scan.refs) {
        const handle: NodeHandle<Record<string, unknown>> = { id: ref.node };
        saved.push({
          handle,
          param: ref.param,
          value: inner.require(handle.id).params[ref.param],
        });
        // A build failure here is an arity mismatch between a value and
        // the position it was substituted into ("add: incompatible tuple
        // sizes 3 and 2"). `fieldFromJson` names the bindings it was
        // given; only this frame knows WHICH body slot held the
        // expression, and without that the author is left grepping.
        let rebuilt: unknown;
        try {
          rebuilt = fieldFromJson(ref.spec, bindings);
        } catch (err) {
          throw new GraphValidationError(
            `the body's field expression at ${refLabel(ref)} cannot be built with the exposed values it reads (${quotedList(ref.names)}): ${
              err instanceof Error ? err.message : String(err)
            }`,
            { cause: err },
          );
        }
        inner._setParamQuiet(handle, ref.param, rebuilt);
      }
    }
    return await fn();
  } finally {
    // Reverse order, so the first write of a slot is the last undone — the
    // restore is exact even if a future change lets two writes land on one
    // slot. Quiet both ways: restoring must no more bump the inner version
    // than writing did, or the memo key would invalidate on every cook.
    for (let i = saved.length - 1; i >= 0; i--) {
      const slot = saved[i];
      // A node removed mid-cook has nothing to restore; letting `require`
      // throw here would mask the error already in flight.
      if (inner._nodes.has(slot.handle.id)) {
        inner._setParamQuiet(slot.handle, slot.param, slot.value);
      }
    }
  }
}
