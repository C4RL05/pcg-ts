/**
 * Graph JSON serialization: a stable, versioned format referencing
 * registered node types by name. Params are validated against the
 * registry's param schemas; field-valued params serialize as declarative
 * FieldSpecs (see fieldJson.ts). Every validation error names the node,
 * param, or pin at fault and states what would be valid.
 */
import { isField } from "../fields/index.js";
import {
  Graph,
  validateGraphMeta,
  getSubgraphSpec,
  subgraphNode,
  type ExposedParam,
  type ExposedPin,
  type GraphMeta,
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  type SubgraphSpec,
  type GraphParam,
  graphParamBindings,
} from "../graph/index.js";
// Reached by MODULE, like `../graph/subgraph.js` above: the validator is
// the graph layer's own, not package API, and the reader needs the same one
// the live setter uses so a value refused by one is refused by both.
import { graphParamError, paramValueError } from "../graph/params.js";
import {
  CARRIED_PIN_NAMES,
  ITERATED_PIN_NAMES,
  getSubgraphPlumbing,
  type WrapperKind,
} from "../graph/subgraph.js";
import {
  type FieldSpec,
  fieldFromJson,
  fieldToJson,
  inlineParamValuesOf,
} from "../fields/fieldJson.js";
import { forEachNode } from "./forEach.js";
import { REPEAT_UNTIL_PARAM_SCHEMAS, repeatUntilNode } from "./repeatUntil.js";
import { getNodeType, hasNodeType, listNodeTypes, standardNode } from "./registry.js";
import { type ExposedParamDecl, resolveExposedParam } from "./subgraphParams.js";
// Import cycle, deliberate and safe: the registry stores serialized
// recipes (so it needs this module's writer and reader) and this module
// must resolve names (so it needs the registry's lookups). Neither module
// touches the other at evaluation time — only function declarations cross
// the edge, and they are hoisted.
import {
  _registeredSubgraphKey,
  _subgraphKey,
  getRegisteredSubgraph,
  hasRegisteredSubgraph,
  unknownSubgraphMessage,
} from "./subgraphRegistry.js";

/** Errors raised while serializing or deserializing graphs. */
export class GraphSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphSerializationError";
  }
}

/** One exposed pin mapping in a serialized subgraph payload. */
export interface SerializedExposedPin {
  /** Pin name on the wrapping subgraph node. */
  readonly name: string;
  /** Id of the inner node the pin maps to. */
  readonly node: string;
  /** Pin name on the inner node (input pin for inputs, output pin for outputs). */
  readonly pin: string;
}

/**
 * One exposed-param declaration in a serialized subgraph payload: the
 * AUTHORED part only. `type`, `enum`, `acceptsField` and `acceptsInfinite`
 * are deliberately
 * absent — they are re-derived from the targets' registered schemas on
 * load, so a payload cannot carry a schema that lies about what the inner
 * params accept, and there is no duplicated truth to drift.
 */
export interface SerializedExposedParam {
  /** Param name on the wrapping subgraph node. */
  readonly name: string;
  /**
   * Inner slots the value is written into, in write order. EMPTY for a
   * param the body's field expressions read by name — the value then
   * reaches the cook by substitution into those expressions, and the
   * schema is derived from `default`'s shape (a number is f32, a 3-number
   * array vec3, a 4-number array vec4) since there is no inner param to
   * borrow one from. A reader also accepts the key being absent.
   */
  readonly targets: readonly { readonly node: string; readonly param: string }[];
  /** Agent-facing description, authored at the exposed level. */
  readonly description: string;
  /** Value a fresh instance starts with. */
  readonly default: unknown;
  /** Inclusive lower bound, when the merged schema has one. */
  readonly min?: number;
  /** Inclusive upper bound, when the merged schema has one. */
  readonly max?: number;
}

/**
 * Nested payload of a serialized `subgraph` node: the inner graph
 * (recursively serialized, without the wrapper's injected plumbing), the
 * exposed pin mappings, and the exposed-param declarations (omitted when
 * the node declares none). Deserialization rebuilds the inner graph and
 * re-wraps it through `subgraphNode`, so the result behaves exactly like
 * a code-first subgraph node.
 */
export interface SerializedSubgraph {
  readonly graph: SerializedGraph;
  readonly inputs: readonly SerializedExposedPin[];
  readonly outputs: readonly SerializedExposedPin[];
  readonly params?: readonly SerializedExposedParam[];
}

/**
 * A `subgraph` node's reference to a registered subgraph (see
 * `registerSubgraph`), carried instead of an embedded `subgraph` payload.
 */
export interface SerializedSubgraphRef {
  /** Registered subgraph name; resolved at load time. */
  readonly name: string;
  /**
   * OPTIONAL content hash (see `subgraphContentHash`). Absent — the
   * default — means "whatever the registry currently holds", so a
   * primitive can be improved under saved graphs. Present means the author
   * asked to be pinned, and a mismatch is a hard error rather than a
   * warning that lets a near-miss cook.
   */
  readonly hash?: string;
}

/** One node instance in a serialized graph. */
export interface SerializedNode {
  readonly id: string;
  /** Registered node type name (see listNodeTypes). */
  readonly type: string;
  /**
   * Param values; field-valued params carry FieldSpec objects. On a
   * `subgraph` node these are its exposed params' values — the
   * declarations live in the `subgraph` payload (or, for a reference, in
   * the registered recipe), the way a standard node's schemas live in the
   * registry.
   */
  readonly params: Record<string, unknown>;
  /** Present on `subgraph` nodes only: the inner graph payload. */
  readonly subgraph?: SerializedSubgraph;
  /**
   * Present on `subgraph` nodes only, and mutually exclusive with
   * {@link SerializedNode.subgraph}: a reference to a registered subgraph
   * by name.
   */
  readonly ref?: SerializedSubgraphRef;
}

/** One connection: [nodeId, pinName] to [nodeId, pinName]. */
export interface SerializedConnection {
  readonly from: readonly [string, string];
  readonly to: readonly [string, string];
}

/** One declared terminal output. */
export interface SerializedOutput {
  readonly id: string;
  readonly pin: string;
  readonly name: string;
}

/**
 * One graph-scoped param: a value declared once at the top level and read
 * by name from any node's field expression (`{"fn":"param","name":…}`).
 *
 * The keys are the inline `param` spec node's keys minus `fn`, because a
 * graph-scoped param IS an inline value hoisted out of one expression so
 * several can share it — same vocabulary, same validation, same derived
 * schema. Deliberately not the exposed-param vocabulary: `targets` means
 * nothing without a wrapper, and `default` is what a fresh INSTANCE starts
 * with, where a graph has no instances and the value it holds is its value.
 */
export interface SerializedGraphParam {
  readonly name: string;
  /**
   * A finite number or a numeric tuple when the param has no `targets`;
   * anything the targets' merged schema admits when it does.
   */
  readonly value: ParamValue;
  /**
   * Node params this writes into, in write order. Omitted for a param that
   * only field expressions read by name — which is every param that can
   * reach a number and no param that can reach an `i32`, a `bool`, a
   * `string` or an `enum`, since those are unreachable from an expression.
   */
  readonly targets?: readonly { readonly node: string; readonly param: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly description?: string;
}

/** The stable, versioned graph interchange format. */
export interface SerializedGraph {
  readonly formatVersion: 1;
  readonly seed: number;
  /**
   * Optional graph-scoped params, in declaration order. Written only when
   * the graph declares one, so a graph that has none serializes
   * byte-identically to before this key existed. An ARRAY rather than an
   * object keyed by name because `JSON.parse` collapses duplicate object
   * keys before any reader sees them — the trap `byAttribute`'s `cases`
   * had to concede — and here a repeated name is detectable, so it is
   * detected.
   */
  readonly params?: readonly SerializedGraphParam[];
  /**
   * Optional descriptive block ({@link GraphMeta}): title, description,
   * tags. Written only when the graph declares one, ignored by cooking,
   * and — being purely additive — read by every formatVersion-1 reader
   * that predates it, so the version stays 1.
   */
  readonly meta?: GraphMeta;
  readonly nodes: readonly SerializedNode[];
  readonly connections: readonly SerializedConnection[];
  readonly outputs: readonly SerializedOutput[];
}

const FORMAT_VERSION = 1;

/**
 * The complete key sets of the format. Anything else is a hard error, not
 * a silently ignored extra.
 *
 * **This closes the additive-extension door, on purpose.** `meta` could be
 * added to a graph in v0.9 and still be read by every earlier v1 reader,
 * because unknown keys were ignored. That leniency is now spent: a reader
 * that ignores what it does not recognize cannot tell a new field from a
 * typo, and `"refs"` for `"ref"` would have cooked as an ordinary subgraph
 * node — a near-miss, silently. A future field an old reader could MISREAD
 * therefore arrives with a `formatVersion` bump rather than riding along
 * unnoticed.
 *
 * That is narrower than "a future format field", and the narrowing is the
 * honest statement of what the rule protects. An added key an old reader
 * REFUSES — which is every added key, since this list is closed — cannot be
 * misread: `meta` was added under exactly this reasoning, the inline `value`
 * on a `param` spec node after it, and `params` here. The bump is not free
 * either: `hashableGraph` covers `formatVersion`, so moving it moves every
 * subgraph content hash and breaks every pinned `ref` in the corpus. Spend
 * it on a change that alters what an EXISTING key means, not on an addition
 * the closed list already polices.
 *
 * The rule holds at EVERY object position, not only the outer ones — a
 * lenient nested object is the same near-miss one level down, and the
 * nested positions are where the plausible typos live (`enum` or
 * `acceptsField` on an exposed param, `description` on a declared output).
 */
const GRAPH_KEYS = [
  "formatVersion",
  "seed",
  "meta",
  "params",
  "nodes",
  "connections",
  "outputs",
] as const;
const GRAPH_PARAM_KEYS = ["name", "value", "targets", "min", "max", "description"] as const;
const NODE_KEYS = ["id", "type", "params", "subgraph", "ref"] as const;
const SUBGRAPH_PAYLOAD_KEYS = ["graph", "inputs", "outputs", "params"] as const;
const SUBGRAPH_REF_KEYS = ["name", "hash"] as const;
const CONNECTION_KEYS = ["from", "to"] as const;
const OUTPUT_KEYS = ["id", "pin", "name"] as const;
const EXPOSED_PIN_KEYS = ["name", "node", "pin"] as const;
const EXPOSED_PARAM_KEYS = ["name", "targets", "description", "default", "min", "max"] as const;
const EXPOSED_PARAM_TARGET_KEYS = ["node", "param"] as const;

/**
 * Keys refused with a reason of their own rather than as plain unknowns.
 *
 * An exposed param's `type`, `enum` and `acceptsField` are real
 * {@link ParamSchema} field names, so an author or an agent will reach for
 * them — but the schema is RE-DERIVED from the targets' registered
 * schemas, never read from the payload. Accepting them would let a payload
 * claim a type or a field capability the inner params do not have;
 * ignoring them would drop an author's stated intent without a word. So
 * they are named, with the reason.
 */
const DERIVED_EXPOSED_PARAM_KEYS: Readonly<Record<string, string>> = {
  type: "derived from the targets' registered schemas; remove it",
  enum: "derived from the targets' registered schemas; remove it",
  acceptsField: "derived from the targets' registered schemas; remove it",
  acceptsInfinite: "derived from the targets' registered schemas; remove it",
};

function fail(message: string): never {
  throw new GraphSerializationError(message);
}

/**
 * Refuse any key outside `valid`, naming the offender and listing them.
 *
 * `refused` names keys that are not merely unrecognized but deliberately
 * not authorable, and says why — a near-miss an author would otherwise
 * repeat.
 */
function checkKeys(
  obj: Record<string, unknown>,
  valid: readonly string[],
  where: string,
  note: string,
  refused: Readonly<Record<string, string>> = {},
): void {
  for (const key of Object.keys(obj)) {
    if (valid.includes(key)) continue;
    const reason = Object.prototype.hasOwnProperty.call(refused, key) ? refused[key] : undefined;
    if (reason !== undefined) {
      fail(
        `${where}: key ${JSON.stringify(key)} cannot be authored — it is ${reason}. Valid keys: ${valid.join(", ")}`,
      );
    }
    fail(`${where}: unknown key ${JSON.stringify(key)}; valid keys: ${valid.join(", ")}${note}`);
  }
}

/** Shared tail of both unknown-key messages: why there is no escape hatch. */
const NO_ANNOTATION_KEY =
  '. The format is closed — an unrecognized key is a typo, not an extension, so a future field arrives with a formatVersion bump. There is no annotation key: descriptive text belongs in the graph\'s "meta" block ({ title, description, tags })';

/**
 * Same statement for exposed-param declarations, which DO have a place for
 * prose — their own `description` — so pointing at the graph's `meta` block
 * would be the wrong instruction here.
 */
const EXPOSED_PARAM_NO_ANNOTATION_KEY =
  '. The format is closed — an unrecognized key is a typo, not an extension, so a future field arrives with a formatVersion bump. Prose about this param belongs in its "description"';

/**
 * Registry entry for the subgraph composite. Metadata-only: instances are
 * created by `subgraphNode(innerGraph, exposedInputs, exposedOutputs,
 * exposedParams)` (or by deserializing a graph containing one), and both
 * their pins and their params are per-instance, so this entry declares
 * neither and its def cannot be instantiated directly.
 */
standardNode<Record<string, never>>({
  type: "subgraph",
  category: "composite",
  // Metadata-only entries carry this for the same reason they carry a
  // description: the def here cannot cook, and the def that CAN is built
  // per instance by `subgraphNode`. A catalog reader has only this entry,
  // so the fact has to be on it — and `selfMetered.test.ts` pins the two
  // together so they cannot drift.
  selfMetered: true,
  description:
    "Composite node wrapping an inner graph as a single node. Pins and params are per-instance, derived from the exposed inner pins and the exposed inner params, so this registry entry declares none — create instances with subgraphNode(innerGraph, exposedInputs, exposedOutputs, exposedParams) and read an instance's real interface with describeSubgraphPins(def) and describeSubgraphParams(def). A serialized subgraph node carries its exposed-param VALUES in \"params\" and its inner graph plus the exposed pin and param DECLARATIONS either inline under \"subgraph\" ({ graph, inputs, outputs, params }), recursively in the same versioned format, or by reference under \"ref\" ({ name, hash? }) to a subgraph registered with registerSubgraph. \"subgraph\" and \"ref\" are mutually exclusive; a ref's \"hash\" is optional, and pins the reference to that exact content (a mismatch is an error, never a warning).",
  inputs: [],
  outputs: [],
  params: {},
  execute() {
    throw new Error(
      'the registered "subgraph" definition is metadata-only and cannot cook; create subgraph nodes with subgraphNode(innerGraph, exposedInputs, exposedOutputs), or deserialize a graph containing one',
    );
  },
});

/**
 * Registry entry for the for-each composite. Metadata-only for the same
 * reason as `subgraph` above, and carrying the same payload — a forEach IS
 * a subgraph plus a loop, and the loop is named by a reserved exposed-input
 * name inside that payload rather than by a field of its own.
 *
 * The entry exists at all because `deserializeGraph` checks `hasNodeType`
 * before it dispatches on the wrapper types, so an unregistered `forEach`
 * would be refused as an unknown type before it ever reached its reader.
 */
standardNode<Record<string, never>>({
  type: "forEach",
  category: "composite",
  // See the `subgraph` entry above.
  selfMetered: true,
  description:
    "Composite node that cooks an inner graph ONCE PER ELEMENT instead of once. Exactly one exposed input must be named \"each\" (one iteration per item of the collection on that pin) or \"eachPoint\" (one iteration per point of the one geometry on that pin, the body seeing a one-point cloud); every other exposed input is broadcast whole to every iteration. Each iteration's outputs are concatenated onto the matching output pin in the iterated collection's own order, and carry the iterated item's tags. Every iteration is seeded on its element's CONTENT — position bits, the seed attribute and the tags — never on its position in the collection, so reordering the input reorders the output without re-rolling any of it. Pins and params are per-instance exactly as for \"subgraph\", and the serialized form is the same payload: create instances with forEachNode(innerGraph, exposedInputs, exposedOutputs, exposedParams), or deserialize a graph containing one. The body gets no memo reuse between iterations, by construction — each rotates the inner seed, and a node holds one cache slot.",
  inputs: [],
  outputs: [],
  params: {},
  execute() {
    throw new Error(
      'the registered "forEach" definition is metadata-only and cannot cook; create forEach nodes with forEachNode(innerGraph, exposedInputs, exposedOutputs), or deserialize a graph containing one',
    );
  },
});

/**
 * Registry entry for the repeat-until composite. Metadata-only for the same
 * reason as the two above, and carrying the same payload — a repeatUntil IS
 * a subgraph plus a feedback loop, and the loop is named by a reserved
 * exposed-pin name inside that payload rather than by a field of its own.
 *
 * Unlike the other two it DOES declare params here, because these two are
 * not the body's: `maxRounds` and `settleAttr` belong to the loop itself,
 * exist on every instance regardless of what the body exposes, and are the
 * two knobs an agent reading the catalog has to know about to drive one.
 * They round-trip through the node's own `params` object beside the exposed
 * ones; see {@link REPEAT_UNTIL_PARAM_SCHEMAS}, which is the single
 * definition both the factory and this entry read.
 */
standardNode<{ maxRounds: number; settleAttr: string }>({
  type: "repeatUntil",
  category: "composite",
  // See the `subgraph` entry above.
  selfMetered: true,
  description:
    'Composite node that cooks an inner graph REPEATEDLY, feeding each round\'s output back into its own input until the body stops changing anything — a bounded fixed point, in a graph where a cycle cannot be wired. Exactly one exposed input AND exactly one exposed output must be named "carry": round 1 gets the outer "carry" input, round k+1 gets round k\'s "carry" output, and every other exposed input is broadcast whole to every round. This is the loop that relaxation needs and that "forEach" cannot express, because the number of rounds is not known before the first one runs: push overlapping props apart and a new pair now overlaps; snap a dangling edge and the snap creates another dangler. TERMINATION is a scalar the body publishes on the DETAIL domain of the carried geometry, named by "settleAttr" — attributeReduce is what normally writes it. All zero means settled: the loop stops and that round counts. Absent is REFUSED by name rather than read as zero, because reading it as zero turns a typo into "converged on round one". Two synthetic outputs the body never declared report what happened: "rounds" (how many cooks) and "converged" (did the settle signal reach zero, or did it hit maxRounds), both value items. THE SEED IS NOT ROTATED PER ROUND, and that is the design: a fixed point exists only if the body is the SAME function every round, so a body whose seed varies with the round number is a different function each time and has no fixed point to converge to — it re-rolls whatever the last round settled, runs the full budget every time, and reports converged false forever, with no error to say why. Pass a constant seed and let the DATA change between rounds. The payoff is the mirror of forEach\'s cost: a constant inner seed means inner nodes whose inputs did not change between rounds serve their caches, so a broadcast branch is computed once for the whole loop. Pins are per-instance exactly as for "subgraph" and the serialized form is the same payload plus this node\'s own two params: create instances with repeatUntilNode(innerGraph, exposedInputs, exposedOutputs, exposedParams), or deserialize a graph containing one.',
  inputs: [],
  outputs: [],
  params: {
    maxRounds: REPEAT_UNTIL_PARAM_SCHEMAS.maxRounds,
    settleAttr: REPEAT_UNTIL_PARAM_SCHEMAS.settleAttr,
  },
  execute() {
    throw new Error(
      'the registered "repeatUntil" definition is metadata-only and cannot cook; create repeatUntil nodes with repeatUntilNode(innerGraph, exposedInputs, exposedOutputs), or deserialize a graph containing one',
    );
  },
});

/**
 * The factory that builds each wrapper kind, for the writer's refusal when
 * a def of a wrapper type carries no recorded spec. A map rather than a
 * chain of ternaries so a fourth wrapper is a compile error here (the
 * record is total over {@link WrapperKind}) instead of silently being
 * described as a subgraph.
 */
const WRAPPER_FACTORIES: Readonly<Record<WrapperKind, string>> = {
  subgraph: "subgraphNode(...)",
  forEach: "forEachNode(...)",
  repeatUntil: "repeatUntilNode(...)",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate and copy the optional `meta` block. Absent is fine; present
 * and malformed is a hard error naming the offending key and listing the
 * valid ones — a near-miss like "titel" must not cook silently.
 *
 * The rules live in `validateGraphMeta`, shared with `Graph.setMeta`, so
 * the writer cannot accept what the reader refuses. Only the error TYPE
 * is translated here, because everything deserialization rejects raises
 * `GraphSerializationError`.
 */
function readGraphMeta(v: unknown, where: string): GraphMeta | undefined {
  if (v === undefined) return undefined;
  try {
    return validateGraphMeta(v, where);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Refuse an inline `param` VALUE for a name the graph declares.
 *
 * Under the existing precedence — binding > spliced field > inline value —
 * the graph-scoped value would arrive as a binding and silently win, and
 * the author would be looking at a number in the spec that nothing uses.
 * That precedence is right for the case it was written for and stays: a
 * SUBGRAPH binding a BODY is two documents, where the body must also stand
 * alone and its inline value is its standalone answer. A graph-scoped param
 * is the same document as the expression that reads it, so there is no
 * second reader to keep working and no reason to prefer one number over the
 * other — only a choice about which one is dead.
 *
 * A value-free reference is untouched: that is the ordinary way to read a
 * declared name.
 */
function checkNoShadowedGraphParam(
  spec: FieldSpec,
  declared: ReadonlySet<string>,
  where: string,
): void {
  if (declared.size === 0) return;
  for (const name of Object.keys(inlineParamValuesOf(spec))) {
    if (!declared.has(name)) continue;
    fail(
      `${where}: {"fn": "param", "name": ${JSON.stringify(name)}} carries its own "value", but the graph declares "${name}" in its top-level "params" — the graph's value would win and the inline one would be a number nothing reads. Drop the inline "value" to read the graph's, or rename one of the two`,
    );
  }
}

/**
 * Read the optional top-level `params` block into the graph's declared
 * params, refusing what a reader could otherwise misunderstand.
 *
 * Nested payloads are refused outright. A body's names are bound by its
 * WRAPPER's exposed params, and two binders that can disagree is the
 * failure `checkDerivedReaders` refuses one level up; the harder reason is
 * that `hashableGraph` covers a payload verbatim, so admitting a key there
 * would move every pinned `ref` hash in the corpus.
 */
function readGraphParams(v: unknown, nested: boolean): readonly GraphParam[] {
  if (v === undefined) return [];
  if (nested) {
    fail(
      `a subgraph payload's graph cannot declare "params": a body's names are bound by its wrapper's exposed params, which is the one binder a body has. Declare it under the payload's "params" (an exposed param with no targets reads a name the body's expressions use), or hoist the value to the OUTER graph's "params" and pass it in through the wrapper's own param slot`,
    );
  }
  if (!Array.isArray(v)) {
    fail(
      `"params" must be an array of { name, value, min?, max?, description? }, got ${JSON.stringify(v)}. It is an array rather than an object so a repeated name is detectable: JSON.parse collapses duplicate object keys before any reader sees them`,
    );
  }
  const seen = new Set<string>();
  const out: GraphParam[] = [];
  v.forEach((raw: unknown, i: number) => {
    if (!isPlainObject(raw)) {
      fail(`params[${i}]: expected an object { name, value, ... }, got ${JSON.stringify(raw)}`);
    }
    checkKeys(raw, GRAPH_PARAM_KEYS, `params[${i}]`, NO_ANNOTATION_KEY);
    const name = raw.name;
    if (typeof name !== "string" || name === "") {
      fail(`params[${i}]: "name" must be a non-empty string, got ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) {
      fail(
        `params[${i}]: duplicate graph param "${name}"; declare each name once (a second declaration cannot be a redefinition, because a reference names one value)`,
      );
    }
    seen.add(name);
    for (const key of ["min", "max"] as const) {
      const bound = raw[key];
      if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) {
        fail(`params[${i}] ("${name}"): "${key}" must be a finite number, got ${JSON.stringify(bound)}`);
      }
    }
    if (raw.description !== undefined && typeof raw.description !== "string") {
      fail(
        `params[${i}] ("${name}"): "description" must be a string, got ${JSON.stringify(raw.description)}`,
      );
    }
    const targets = readGraphParamTargets(raw.targets, `params[${i}] ("${name}")`);
    const param: GraphParam = {
      name,
      value: raw.value as ParamValue,
      ...(targets !== undefined ? { targets } : {}),
      ...(raw.min !== undefined ? { min: raw.min as number } : {}),
      ...(raw.max !== undefined ? { max: raw.max as number } : {}),
      ...(raw.description !== undefined ? { description: raw.description as string } : {}),
    };
    // A TARGETED param's value is judged later, against the schema its
    // targets merge into — which cannot be read until the nodes exist. This
    // pass checks only what is knowable now: the name, and (for a targetless
    // param) the numeric shape.
    const error = graphParamError(param, `params[${i}]`);
    if (error !== undefined) fail(error);
    out.push(param);
  });
  return out;
}




/** Value equality for a param: numbers, strings, bools, and flat lists. */
function sameParamValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    );
  }
  return a === b;
}

/**
 * Resolve every targeted graph param against the nodes it drives, WRITE its
 * value into them, and hand back the params carrying their merged schemas.
 *
 * EXPORTED because `deserializeGraph` is not the only thing that builds a
 * graph from a `SerializedGraph`: the editor rebuilds its own mirror node
 * by node, and skipping this step left every driven slot holding whatever
 * the file said instead of what its declaration says. That is the second
 * time a hand-rolled rebuild has missed a step this function performs, so
 * the function is the thing both call rather than a shape both imitate.
 * `authored` may be empty — it only decides whether a DISAGREEING literal
 * is refused, and a caller that cannot tell an authored value from a
 * default should not be raising that error.
 *
 * The resolver is `resolveExposedParam`, unchanged and deliberately: a
 * subgraph's exposed param answers the same question — "one name, several
 * inner param slots, what may it hold?" — and its merge rules are the
 * soundness argument, not a convenience. Types and enum sets must agree
 * across targets, `acceptsField` and `acceptsInfinite` are ANDed, bounds
 * intersect, and an author may only narrow them. A declaration therefore
 * cannot claim a capability the params it drives do not have, which is the
 * whole reason this reaches `i32` and `enum` safely.
 *
 * WRITING is where this differs from the subgraph form, and the difference
 * is that there is nothing to restore. `withExposedParams` writes into a
 * body at cook time and puts it back, because one body is shared between
 * wrapper instances and by `serializeGraph`. A top-level graph has exactly
 * one set of values and one owner, so the write is permanent and the node
 * simply holds what the declaration says.
 *
 * The consequence worth stating: a node param that a graph param drives is
 * NOT independently editable — the declaration wins on every load, the same
 * way a wrapper's value wins over what its body happens to hold.
 */
export function applyGraphParamTargets(
  graph: Graph,
  params: readonly GraphParam[],
  authored: ReadonlyMap<string, ReadonlySet<string>>,
): GraphParam[] {
  // Which declaration owns which slot. A slot with two owners has no
  // defined value — measured before this guard, two params targeting one
  // `countX` simply let the LAST one win, 90 points against 40, with
  // nothing said. `resolveExposedParam` has refused exactly this for
  // subgraph params since it shipped ("two exposed params binding the same
  // inner slot… is a hard error naming the params and the slot"), and the
  // two mechanisms must not disagree about a question they both answer.
  const owner = new Map<string, string>();
  return params.map((param) => {
    const targets = param.targets;
    if (targets === undefined || targets.length === 0) return param;
    let resolved;
    try {
      resolved = resolveExposedParam(graph, {
        name: param.name,
        targets: targets.map((t) => ({ node: { id: t.node }, param: t.param })),
        // `description` is optional on a graph param and REQUIRED by the
        // resolver, so the fallback says where the missing sentence goes —
        // the same answer `inlineParamSchema` gives for an undocumented
        // inline value, in the same voice.
        description:
          param.description ??
          `Graph param "${param.name}", driving ${targets.map((t) => `"${t.node}".${t.param}`).join(", ")}. The graph says nothing else about it — write "description" beside the value to say what turning it does.`,
        default: param.value,
        ...(param.min !== undefined ? { min: param.min } : {}),
        ...(param.max !== undefined ? { max: param.max } : {}),
      });
    } catch (err) {
      fail(`graph param "${param.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
    const withSchema: GraphParam = { ...param, schema: resolved.schema };
    const bad = graphParamError(withSchema, "params");
    if (bad !== undefined) fail(bad);
    for (const t of targets) {
      // A target holding a FIELD is refused rather than overwritten.
      // Writing the value would leave the authored expression in the FILE
      // and dead in the COOK — measured: a `translate` of
      // `mul(position, 2)` under a declared 3 cooks a flat 3, while the
      // JSON still shows the expression. That is the hazard this session
      // keeps closing: a graph that does something its own text does not
      // say. Both readings are defensible, so neither is chosen silently.
      const slot = `"${t.node}".${t.param}`;
      const claimed = owner.get(slot);
      if (claimed !== undefined) {
        fail(
          claimed === param.name
            ? `graph param "${param.name}" lists ${slot} twice; name each slot once — writing it twice cannot mean anything a single write does not`
            : `graph params "${claimed}" and "${param.name}" both target ${slot}, so the slot has two declared values and takes whichever is applied last. Drive it from one of them, or split the slot into two params`,
        );
      }
      owner.set(slot, param.name);
      const held = graph.getParams({ id: t.node } as NodeHandle<Record<string, unknown>>)[t.param];
      if (isField(held)) {
        fail(
          `graph param "${param.name}" targets "${t.node}".${t.param}, which holds a FIELD EXPRESSION. Writing the declared value there would leave that expression in the file and dead in the cook, so it is refused rather than chosen for you: either drop the expression from that param (the declaration then drives it), or drop the target and have the expression READ the name instead — a `+"`param`"+` reference inside it binds to the same declared value.`,
        );
      }
      // A literal that DISAGREES with its driver is a hand edit that would
      // be silently discarded: the declaration wins on every load, so the
      // number in the file would sit there meaning nothing. Serialization
      // writes the driven value back, so a round-tripped graph always
      // agrees and never reaches this — only a file somebody edited does,
      // which is exactly when it is worth saying.
      const wasAuthored = authored.get(t.node)?.has(t.param) === true;
      if (wasAuthored && held !== undefined && !isField(held) && !sameParamValue(held, param.value)) {
        fail(
          `node "${t.node}" param "${t.param}" is ${JSON.stringify(held)}, but graph param "${param.name}" drives it to ${JSON.stringify(param.value)}. The declaration wins on every load, so the value written on the node would be discarded silently: change the declaration, or drop the target and let the node keep its own value`,
        );
      }
      try {
        graph.setParam({ id: t.node } as NodeHandle<Record<string, unknown>>, t.param, param.value as never);
      } catch (err) {
        fail(
          `graph param "${param.name}" cannot write "${t.node}".${t.param}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return withSchema;
  });
}

/** Read a graph param's optional `targets`, or undefined when it has none. */
function readGraphParamTargets(
  v: unknown,
  where: string,
): readonly { node: string; param: string }[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    fail(`${where}: "targets" must be an array of { node, param }, got ${JSON.stringify(v)}`);
  }
  const out: { node: string; param: string }[] = [];
  v.forEach((raw: unknown, i: number) => {
    if (!isPlainObject(raw)) {
      fail(`${where}: targets[${i}] must be an object { node, param }, got ${JSON.stringify(raw)}`);
    }
    checkKeys(raw, EXPOSED_PARAM_TARGET_KEYS, `${where} targets[${i}]`, NO_ANNOTATION_KEY);
    const node = raw.node;
    const param = raw.param;
    if (typeof node !== "string" || node === "") {
      fail(`${where}: targets[${i}].node must be a non-empty string, got ${JSON.stringify(node)}`);
    }
    if (typeof param !== "string" || param === "") {
      fail(`${where}: targets[${i}].param must be a non-empty string, got ${JSON.stringify(param)}`);
    }
    out.push({ node, param });
  });
  // An empty list means the same as no list — the expressions are the only
  // readers — and is admitted rather than refused, because the exposed-param
  // form it borrows from admits it and says so.
  return out.length === 0 ? undefined : out;
}

/**
 * Validate a plain (non-field) param value against its schema. `where`
 * names the node and param for error messages. The rules themselves live
 * in the graph layer beside {@link ParamSchema}, so the exposed-param
 * resolver applies exactly the same ones.
 */
function checkParamValue(schema: ParamSchema, value: unknown, where: string): void {
  const bad = paramValueError(schema, value);
  if (bad !== undefined) fail(`${where}: ${bad}`);
}

/**
 * One param value in its serialized form: item lists become `[]`, Fields
 * become FieldSpecs (and are rejected on a param that is not
 * field-capable), a field-capable vec param's scalar broadcast is
 * canonicalized to the vec arity, and everything else is validated
 * against the schema and copied. Shared by standard nodes and by subgraph
 * nodes' exposed params so the two cannot diverge.
 */
function serializeParamValue(
  schema: ParamSchema,
  key: string,
  value: unknown,
  where: string,
): unknown {
  if (schema.type === "items") {
    if (!Array.isArray(value)) {
      fail(
        `${where}: expected an array of DataItems, got ${JSON.stringify(value)}; bind items with graph.setParam(node, "${key}", [...])`,
      );
    }
    // Contract: live DataItems are runtime-injected (e.g. bound per cell
    // by the World at bind time) and are not part of the serialized form
    // — the serialized graph carries an empty list.
    return [];
  }
  if (isField(value)) {
    if (schema.acceptsField !== true) {
      fail(`${where}: holds a Field but the param is not field-capable`);
    }
    let spec: unknown;
    try {
      spec = fieldToJson(value);
    } catch (err) {
      fail(`${where}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Through the SAME guard the plain path takes. This branch used to
    // return straight from `fieldToJson`, so every number inside a field
    // spec skipped the -0 check — `{fn:"constant",value:-0}` saved as
    // `0` and cooked different bytes on reload, which is the one thing
    // that check exists to prevent. A field is a param like any other and
    // the numbers inside it are param numbers.
    refuseNegativeZero(spec, where);
    return spec;
  }
  // Field-capable vec params accept a runtime-legal scalar (tuple-1
  // broadcast); canonicalize it to the vec arity so the serialized form
  // always matches the schema. Broadcast semantics make the cooked output
  // identical.
  let plain = value;
  if (
    (schema.type === "vec3" || schema.type === "vec4") &&
    schema.acceptsField === true &&
    typeof plain === "number" &&
    Number.isFinite(plain)
  ) {
    plain = new Array<number>(schema.type === "vec3" ? 3 : 4).fill(plain);
  }
  checkParamValue(schema, plain, where);
  refuseNegativeZero(plain, where);
  return Array.isArray(plain) ? [...(plain as unknown[])] : plain;
}

/**
 * Refuse -0 in a serialized param, because JSON cannot carry it:
 * `JSON.stringify(-0)` is `"0"`, so a graph saved with one loads with the
 * sign gone and cooks different bytes from the graph that was saved.
 *
 * This is the same stance `constant()` already takes when it withholds a
 * spec for -0 — a form that cannot be parsed back must never be produced —
 * moved to the one place every param value passes through. It matters most
 * for a param an expression READS by name (`{"fn":"param"}`), where the
 * sign reaches `Field.key` and therefore the memo: in memory -0 is exact,
 * and on the GPU it is strictly better than a baked literal, which a WGSL
 * front end may flush to +0. None of that survives a save, so the save is
 * what gets refused rather than the value.
 */
function refuseNegativeZero(value: unknown, where: string): void {
  const negZero = (n: unknown): boolean => typeof n === "number" && Object.is(n, -0);
  // Walks the whole value, because a param may BE a field spec: a tree of
  // objects whose `value`, `args` and `opts` hold the numbers. Checking
  // only the top level and one array deep — which is all this did — let
  // `{fn:"constant",value:-0}` through, and then the inline `value` on a
  // `param` node gave it a second way in. Both reload as +0 and cook
  // different bytes, which is exactly what this function exists to stop,
  // so it has to go as deep as the numbers do.
  const find = (v: unknown, path: string): string | undefined => {
    if (negZero(v)) return path;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = find(v[i], `${path}[${i}]`);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    if (typeof v === "object" && v !== null) {
      for (const [k, child] of Object.entries(v)) {
        const hit = find(child, `${path}.${k}`);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  };
  const at = find(value, "");
  if (at === undefined) return;
  fail(
    `${where}${at}: holds -0, which JSON cannot represent — it would reload as 0 and cook different bytes. ` +
      `Use 0 if the sign does not matter, or keep the graph in memory if it does`,
  );
}

/**
 * Serialize a graph to the versioned JSON format. Every node's type must
 * be registered (via standardNode) and its params must match the
 * registered schemas; field-valued params must originate from
 * fieldFromJson so they carry a serializable spec.
 *
 * Subgraph nodes (created by `subgraphNode`) serialize recursively: their
 * inner graph becomes a nested payload in the same format, excluding the
 * plumbing the wrapper injected (portal nodes, `__out_*` outputs).
 * Subgraph nesting must be acyclic — an inner graph reaching a graph
 * already being serialized is an error naming the offending node.
 *
 * Item-list params (`items` schema type) hold live, runtime-injected
 * DataItems; the serialized form always carries an empty list.
 */
export function serializeGraph(graph: Graph): SerializedGraph {
  return serializeGraphRec(graph, new Set());
}

/**
 * @internal Reference recorded against a def materialized from a `ref`, so
 * serialization writes the reference back out instead of re-embedding the
 * primitive. Keyed on the def, which is created fresh per reference (see
 * `registerSubgraph`), so two references never share a record.
 */
const subgraphRefs = new WeakMap<object, SerializedSubgraphRef>();

/** @internal Remember the reference a materialized def came from. */
function recordSubgraphRef(def: object, ref: SerializedSubgraphRef): void {
  subgraphRefs.set(def, ref);
}

/**
 * Serialize one subgraph node: as a `ref` when its def was materialized
 * from one, as an embedded payload otherwise. `seen` holds the graphs on
 * the current path.
 *
 * The embedded payload is built either way. It is what the node's own
 * `params` are validated against, and comparing it with the registered
 * recipe is what keeps a reference honest: an edit made through
 * `getSubgraphSpec(def).graph` would otherwise vanish the moment the graph
 * was saved, since writing `ref` back out writes the REGISTRY's content,
 * not the edited graph's.
 */
function serializeSubgraphNode(
  id: string,
  nodeParams: Record<string, unknown>,
  spec: SubgraphSpec,
  seen: Set<Graph>,
  def: object,
): SerializedNode {
  const embedded = buildEmbeddedSubgraphNode(id, nodeParams, spec, seen);
  const ref = subgraphRefs.get(def);
  if (ref === undefined) return embedded;
  const registered = _registeredSubgraphKey(ref.name);
  if (registered === undefined) {
    fail(
      `cannot serialize node "${id}": it was loaded from the registered subgraph "${ref.name}", which is no longer registered; register it again before serializing, or rebuild the node from an embedded "subgraph" payload`,
    );
  }
  // `embedded.subgraph` is always present: buildEmbeddedSubgraphNode sets it.
  if (_subgraphKey(embedded.subgraph as SerializedSubgraph) !== registered) {
    fail(
      `cannot serialize node "${id}": it references the registered subgraph "${ref.name}", but its inner graph no longer matches the registered recipe — writing the reference back out would silently discard the edit. Edit a referenced primitive by registering it under a new name, or drop the reference by rebuilding the node from an embedded "subgraph" payload`,
    );
  }
  return { id, type: spec.wrapper, params: embedded.params, ref };
}

/** Serialize one subgraph node as its nested payload; `seen` holds the graphs on the current path. */
function buildEmbeddedSubgraphNode(
  id: string,
  nodeParams: Record<string, unknown>,
  spec: SubgraphSpec,
  seen: Set<Graph>,
): SerializedNode {
  if (seen.has(spec.graph)) {
    fail(
      `cannot serialize node "${id}": its inner graph reaches a graph that is already being serialized (a subgraph cycle); subgraph nesting must be acyclic — wrap an independent graph instead`,
    );
  }
  let inner: SerializedGraph;
  try {
    inner = serializeGraphRec(spec.graph, seen);
  } catch (err) {
    if (err instanceof GraphSerializationError) {
      fail(`node "${id}" inner graph: ${err.message}`);
    }
    throw err;
  }
  // Canonical-seed invariant: cooking overwrites the inner graph's live
  // seed (derived from the outer node seed on every cook), so the live
  // value is transient. The nested payload always carries the wrap-time
  // seed recorded in the spec — serializing before and after a cook emits
  // identical JSON, and deserialization seeds the rebuilt inner graph from
  // the payload and re-wraps, recording the same canonical value again.
  inner = { ...inner, seed: spec.seed };
  const pin = (e: ExposedPin): SerializedExposedPin => ({
    name: e.name,
    node: e.node.id,
    pin: e.pin,
  });
  // Exposed params split the way native ones do: VALUES on the node,
  // DECLARATIONS in the payload. A value set on a param this node does
  // not expose is an error, not a silent drop — the reader rejects the
  // same data, and a writer that quietly discards what the reader refuses
  // is how a tuned graph loses its tuning between save and load.
  const declared = new Map<string, ParamSchema>(spec.params.map((p) => [p.name, p.schema]));
  // A `repeatUntil` also carries two params of its OWN — the loop's, not
  // the body's — so they sit in the same `params` object beside the exposed
  // ones and round-trip through the same code path. Read from the single
  // schema definition the factory uses, so a saved graph can never load
  // under a different bound than it was authored with.
  if (spec.wrapper === "repeatUntil") {
    for (const [name, schema] of Object.entries(REPEAT_UNTIL_PARAM_SCHEMAS)) {
      declared.set(name, schema);
    }
  }
  for (const key of Object.keys(nodeParams)) {
    if (!declared.has(key)) {
      fail(
        `cannot serialize node "${id}": param "${key}" is not an exposed param of this subgraph node; exposed params: ${[...declared.keys()].join(", ") || "(none)"}`,
      );
    }
  }
  const params: Record<string, unknown> = {};
  for (const [name, schema] of declared) {
    params[name] = serializeParamValue(
      schema,
      name,
      nodeParams[name],
      `node "${id}" param "${name}"`,
    );
  }
  return {
    id,
    // From the spec, never a literal. Both wrappers record a spec and the
    // caller dispatches on the spec's PRESENCE, so a hardcoded "subgraph"
    // here would write a forEach out as a plain subgraph: it would
    // round-trip, validate, and cook one pass over the concatenated
    // collection instead of one pass per item. A wrong answer that saves
    // cleanly is the worst shape a bug can take.
    type: spec.wrapper,
    params,
    subgraph: {
      graph: inner,
      inputs: spec.inputs.map(pin),
      outputs: spec.outputs.map(pin),
      // Omitted entirely when the node exposes no params, so every graph
      // written before exposed params existed serializes byte-identically.
      ...(spec.params.length > 0
        ? {
            params: spec.params.map((p) => {
              const decl = serializeExposedParam(id, p);
              checkExposedParamDeclaration(id, spec.graph, p, decl);
              return decl;
            }),
          }
        : {}),
    },
  };
}

/**
 * One exposed-param declaration, authored part only. Bounds come from the
 * merged schema rather than from a separately remembered "what the author
 * narrowed": merging intersects, so re-intersecting an already-merged
 * bound on load is a no-op and the round trip is a fixed point.
 */
function serializeExposedParam(id: string, exposed: ExposedParam): SerializedExposedParam {
  const schema = exposed.schema;
  return {
    name: exposed.name,
    targets: exposed.targets.map((t) => ({ node: t.node.id, param: t.param })),
    description: schema.description,
    default: serializeParamValue(
      schema,
      exposed.name,
      schema.default,
      `node "${id}" exposed param "${exposed.name}" default`,
    ),
    ...(schema.min !== undefined ? { min: schema.min } : {}),
    ...(schema.max !== undefined ? { max: schema.max } : {}),
  };
}

/** `"nodeId".param`, the way the declaration errors name an inner slot. */
function slotLabel(target: { readonly node: { readonly id: string }; readonly param: string }): string {
  return `"${target.node.id}".${target.param}`;
}

function sameEnumList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Re-derive the declaration about to be written and check the def's own
 * schema against it. `subgraphNode`'s fourth argument takes an ALREADY
 * RESOLVED schema, and the graph layer cannot audit its per-target claims
 * — param schemas live in this layer's registry, which the graph layer may
 * not import — so a hand-written declaration can assert a type, a bound or
 * a field capability the inner targets do not have.
 *
 * `deserializeGraph` re-derives every declaration through
 * `resolveExposedParam` and refuses such a payload, so without this check
 * the writer emits what the reader rejects: a graph that saves fine and
 * cannot be reopened, which is the worst outcome available. This is the
 * same writer/reader symmetry already applied to the graph `meta` block
 * and to values set on params the node does not expose.
 */
function checkExposedParamDeclaration(
  id: string,
  inner: Graph,
  exposed: ExposedParam,
  decl: SerializedExposedParam,
): void {
  const where = `cannot serialize node "${id}": exposed param "${exposed.name}"`;
  const door =
    'build exposed params with resolveExposedParam(innerGraph, { name, targets, description }), which derives the schema from the registry instead of asserting it';
  let resolved: ExposedParam;
  try {
    resolved = resolveExposedParam(inner, {
      name: decl.name,
      targets: decl.targets.map((t) => ({ node: { id: t.node }, param: t.param })),
      description: decl.description,
      default: decl.default as ParamValue,
      ...(decl.min !== undefined ? { min: decl.min } : {}),
      ...(decl.max !== undefined ? { max: decl.max } : {}),
    });
  } catch (err) {
    // resolveExposedParam already prefixes `exposed param "x": `.
    fail(
      `cannot serialize node "${id}": ${err instanceof Error ? err.message : String(err)}; ${door}`,
    );
  }
  const held = exposed.schema;
  const want = resolved.schema;
  // "(none)" when the param has no targets: its schema is then derived
  // from the default's shape, and saying so is what makes a type
  // disagreement readable ("its targets ((none)) are f32").
  const targets = exposed.targets.map(slotLabel).join(", ") || "(none)";
  if (held.type !== want.type) {
    fail(
      exposed.targets.length === 0
        ? `${where} declares type "${held.type}", but it has no targets, so its type is derived from the shape of its default and comes out ${want.type}; ${door}`
        : `${where} declares type "${held.type}", but its targets (${targets}) are ${want.type}; ${door}`,
    );
  }
  if (!sameEnumList(held.enum, want.enum)) {
    fail(
      `${where} declares enum values ${(held.enum ?? []).join(", ") || "(none)"}, but its targets (${targets}) allow ${(want.enum ?? []).join(", ") || "(none)"}; ${door}`,
    );
  }
  if ((held.acceptsField === true) !== (want.acceptsField === true)) {
    fail(
      exposed.targets.length === 0
        ? // No targets means the value's only route into the body is
          // substitution into a field expression — which takes a Field as
          // readily as a number, splicing it in where the reference
          // stands. So a targetless param is ALWAYS field-capable and the
          // only way to fail here is to record less than that.
          `${where} is recorded as taking plain values only, but it has no targets: its value reaches the body by substitution into a field expression, where a Field is spliced in exactly as a number would be, so reloading this graph would derive a field-capable param and the saved node and the loaded one would not behave alike — ${door}`
        : held.acceptsField === true
          ? `${where} claims to be field-capable, but not every target is: field-capable targets are ${resolved.targets.filter((t) => t.acceptsField === true).map(slotLabel).join(", ") || "(none)"}; a Field set on it would reach a target that takes plain values only — ${door}`
          : `${where} is recorded as taking plain values only, but every one of its targets (${targets}) accepts a Field; reloading this graph would derive a field-capable param, so the saved node and the loaded one would not behave alike — ${door}`,
    );
  }
  for (const bound of ["min", "max"] as const) {
    if (held[bound] !== want[bound]) {
      fail(
        `${where} ${held[bound] === undefined ? `omits a ${bound} bound its targets declare (${want[bound]})` : `declares ${bound} ${held[bound]}, but its targets merge to ${want[bound] ?? "no bound"}`}; an exposed bound may only NARROW its targets' own — ${door}`,
      );
    }
  }
  for (let i = 0; i < exposed.targets.length; i++) {
    const target = exposed.targets[i];
    const derived = resolved.targets[i];
    if ((target.acceptsField === true) !== (derived.acceptsField === true)) {
      fail(
        `${where} records target ${slotLabel(target)} as ${target.acceptsField === true ? "field-capable" : "taking plain values only"}, but its registered schema says otherwise; the cook-time Field check reads this flag, so a wrong one lets a Field reach a param that cannot resolve it — ${door}`,
      );
    }
  }
}

function serializeGraphRec(graph: Graph, seen: Set<Graph>): SerializedGraph {
  seen.add(graph);
  try {
    const plumbing = getSubgraphPlumbing(graph);
    const isPortal = (id: string): boolean => plumbing?.portalIds.has(id) === true;
    const nodes: SerializedNode[] = [];
    for (const state of graph._nodes.values()) {
      if (isPortal(state.id)) continue;
      const spec = getSubgraphSpec(state.def);
      if (spec !== undefined) {
        nodes.push(serializeSubgraphNode(state.id, state.params, spec, seen, state.def));
        continue;
      }
      const type = state.def.type;
      if (type === "subgraph" || type === "forEach" || type === "repeatUntil") {
        fail(
          `cannot serialize node "${state.id}": its definition was not created by ${
            WRAPPER_FACTORIES[type]
          }; build ${type} nodes with that factory (or deserializeGraph) so their inner graph can be serialized`,
        );
      }
      if (!hasNodeType(type)) {
        fail(
          `cannot serialize node "${state.id}": type "${type}" is not registered; only node types registered via standardNode can be serialized`,
        );
      }
      const reg = getNodeType(type);
      if (reg.def !== state.def) {
        fail(
          `cannot serialize node "${state.id}": its definition is not the registered definition for type "${type}"; build graphs from the registered node defs`,
        );
      }
      const schemas = reg.info.params;
      for (const key of Object.keys(state.params)) {
        if (!(key in schemas)) {
          fail(
            `cannot serialize node "${state.id}": param "${key}" is not in the schema of type "${type}"; valid params: ${Object.keys(schemas).join(", ")}`,
          );
        }
      }
      const params: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(schemas)) {
        params[key] = serializeParamValue(
          schema,
          key,
          state.params[key],
          `node "${state.id}" param "${key}"`,
        );
      }
      nodes.push({ id: state.id, type, params });
    }
    return {
      formatVersion: FORMAT_VERSION,
      seed: graph.seed,
      // Optional: omitted entirely when the graph declares no metadata, so
      // a graph that never used it serializes byte-identically to before.
      // `setMeta` already validated and froze it, so it is emitted as held.
      ...(graph.meta !== undefined ? { meta: graph.meta } : {}),
      // Same rule, same reason: a graph declaring none writes no key. The
      // values were validated by `setGraphParams` and are emitted as held,
      // with the optional keys omitted rather than written as undefined.
      ...(graph.graphParams.length > 0
        ? {
            params: graph.graphParams.map((p) => ({
              name: p.name,
              value: Array.isArray(p.value) ? [...p.value] : p.value,
              // The declaration, not the resolved schema: the schema is
              // DERIVED from these targets on every load, so writing it out
              // would be a second copy of a truth the registry already owns
              // — the same reason a subgraph payload omits an exposed
              // param's `type` and `acceptsField`.
              ...(p.targets !== undefined ? { targets: p.targets.map((t) => ({ ...t })) } : {}),
              ...(p.min !== undefined ? { min: p.min } : {}),
              ...(p.max !== undefined ? { max: p.max } : {}),
              ...(p.description !== undefined ? { description: p.description } : {}),
            })),
          }
        : {}),
      nodes,
      connections: graph._connections
        .filter((c) => !isPortal(c.from) && !isPortal(c.to))
        .map((c) => ({
          from: [c.from, c.fromPin] as const,
          to: [c.to, c.toPin] as const,
        })),
      outputs: graph._outputs
        .filter((o) => plumbing?.outputNames.has(o.name) !== true)
        .map((o) => ({ id: o.node, pin: o.pin, name: o.name })),
    };
  } finally {
    seen.delete(graph);
  }
}

function checkEndpoint(v: unknown, label: string): [string, string] {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || typeof v[1] !== "string") {
    fail(`${label}: expected [nodeId, pinName], got ${JSON.stringify(v)}`);
  }
  return [v[0], v[1]];
}

/** Read and validate the exposed-pin list of a subgraph payload. */
function readExposedPins(v: unknown, inner: Graph, where: string): ExposedPin[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    fail(`${where}: expected an array of { name, node, pin } objects, got ${JSON.stringify(v)}`);
  }
  return v.map((e: unknown, i: number): ExposedPin => {
    if (
      !isPlainObject(e) ||
      typeof e.name !== "string" ||
      typeof e.node !== "string" ||
      typeof e.pin !== "string"
    ) {
      fail(`${where}[${i}]: expected { name, node, pin } strings, got ${JSON.stringify(e)}`);
    }
    checkKeys(e, EXPOSED_PIN_KEYS, `${where}[${i}]`, NO_ANNOTATION_KEY);
    if (!inner._nodes.has(e.node)) {
      fail(
        `${where}[${i}] ("${e.name}"): unknown inner node "${e.node}"; inner nodes: ${[...inner._nodes.keys()].join(", ")}`,
      );
    }
    return { name: e.name, node: { id: e.node }, pin: e.pin };
  });
}

/**
 * Read and validate the exposed-param declarations of a subgraph payload.
 * Only the authored fields are read: the schema is re-derived from the
 * targets by `resolveExposedParam`, so a payload claiming a type or a
 * field capability the inner params do not have is not representable.
 */
function readExposedParams(v: unknown, inner: Graph, where: string): ExposedParamDecl[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    fail(
      `${where}: expected an array of { name, targets, description, default } objects, got ${JSON.stringify(v)}`,
    );
  }
  return v.map((e: unknown, i: number): ExposedParamDecl => {
    if (!isPlainObject(e) || typeof e.name !== "string" || typeof e.description !== "string") {
      fail(
        `${where}[${i}]: expected { name, targets, description, default } with string name and description, got ${JSON.stringify(e)}`,
      );
    }
    checkKeys(
      e,
      EXPOSED_PARAM_KEYS,
      `${where}[${i}] ("${e.name}")`,
      EXPOSED_PARAM_NO_ANNOTATION_KEY,
      DERIVED_EXPOSED_PARAM_KEYS,
    );
    // Absent and empty both mean "writes nowhere", which is legal exactly
    // when a field expression in the body reads the name instead — the
    // wrapper checks that, since only it can see the body.
    if (e.targets !== undefined && !Array.isArray(e.targets)) {
      fail(
        `${where}[${i}] ("${e.name}"): "targets" must be an array of { node, param } objects — empty or absent for a param the body's field expressions read by name — got ${JSON.stringify(e.targets)}`,
      );
    }
    const declaredTargets: readonly unknown[] = e.targets === undefined ? [] : (e.targets as unknown[]);
    const targets = declaredTargets.map((t: unknown, j: number) => {
      if (!isPlainObject(t) || typeof t.node !== "string" || typeof t.param !== "string") {
        fail(
          `${where}[${i}] ("${e.name}") targets[${j}]: expected { node, param } strings, got ${JSON.stringify(t)}`,
        );
      }
      checkKeys(
        t,
        EXPOSED_PARAM_TARGET_KEYS,
        `${where}[${i}] ("${e.name}") targets[${j}]`,
        NO_ANNOTATION_KEY,
      );
      if (!inner._nodes.has(t.node)) {
        fail(
          `${where}[${i}] ("${e.name}") targets[${j}]: unknown inner node "${t.node}"; inner nodes: ${[...inner._nodes.keys()].join(", ")}`,
        );
      }
      return { node: { id: t.node }, param: t.param };
    });
    for (const bound of ["min", "max"] as const) {
      const b = e[bound];
      if (b !== undefined && (typeof b !== "number" || !Number.isFinite(b))) {
        fail(
          `${where}[${i}] ("${e.name}"): "${bound}" must be a finite number when present, got ${JSON.stringify(b)}`,
        );
      }
    }
    return {
      name: e.name,
      targets,
      description: e.description,
      // A schema default is always a plain value — a Field is set as a
      // VALUE on an instance, never as a default — so there is no
      // FieldSpec to interpret here. resolveExposedParam validates it
      // against the schema it derives.
      ...(e.default !== undefined ? { default: e.default as ParamValue } : {}),
      ...(typeof e.min === "number" ? { min: e.min } : {}),
      ...(typeof e.max === "number" ? { max: e.max } : {}),
    };
  });
}

/**
 * @internal Threaded through deserialization: both acyclicity guards.
 */
interface ReadContext {
  /** Payload objects on the current path, by object identity. */
  readonly seenPayloads: Set<object>;
  /**
   * Registered subgraph names on the current resolution path, in order.
   * Object identity cannot see a NAME cycle — "a" referencing "b"
   * referencing "a" involves three distinct payload objects — so names
   * need a guard of their own.
   */
  readonly seenNames: Set<string>;
  /**
   * True inside a subgraph payload's graph, where a top-level `params`
   * block is refused. A body's names are bound by its WRAPPER's exposed
   * params, and two binders that can disagree is the failure
   * `checkDerivedReaders` refuses one level up — but the load-bearing
   * reason is narrower: `hashableGraph` covers a payload verbatim, so a
   * key admitted there would move every pinned `ref` hash in the corpus.
   */
  readonly nested?: boolean;
}

/** Read and validate a node's `ref` object. */
function readSubgraphRef(id: string, v: unknown): SerializedSubgraphRef {
  if (!isPlainObject(v)) {
    fail(
      `node "${id}": "ref" must be an object { name, hash? } naming a registered subgraph, got ${JSON.stringify(v)}`,
    );
  }
  checkKeys(
    v,
    SUBGRAPH_REF_KEYS,
    `node "${id}" ref`,
    " (a reference carries the registered name and, when it pins itself, that content hash — nothing else)",
  );
  if (typeof v.name !== "string" || v.name === "") {
    fail(
      `node "${id}": "ref".name must be a non-empty string naming a registered subgraph, got ${JSON.stringify(v.name)}`,
    );
  }
  if (v.hash !== undefined && typeof v.hash !== "string") {
    fail(
      `node "${id}": "ref".hash must be a string when present (the hash registerSubgraph reported), got ${JSON.stringify(v.hash)}`,
    );
  }
  return { name: v.name, ...(typeof v.hash === "string" ? { hash: v.hash } : {}) };
}

/**
 * Rebuild one subgraph node, from a registered name (`ref`) or from an
 * embedded payload (`subgraph`) — never both. Either way the node is built
 * by the same code below, so a reference and an embedded copy of the same
 * recipe produce the same def, the same memo key and the same cooked bytes.
 */
function addSubgraphNode(
  graph: Graph,
  id: string,
  nodeJson: Record<string, unknown>,
  paramsJson: Record<string, unknown>,
  ctx: ReadContext,
  wrapper: WrapperKind,
  bindings: Readonly<Record<string, number | readonly number[]>>,
  declaredParams: ReadonlySet<string>,
): NodeHandle {
  const refJson = nodeJson.ref;
  const payload = nodeJson.subgraph;
  if (refJson !== undefined && payload !== undefined) {
    fail(
      `node "${id}": carries both "ref" and "subgraph"; a subgraph node either references a registered subgraph by name ("ref") or embeds its inner graph ("subgraph"), never both — remove whichever is not intended`,
    );
  }
  if (refJson !== undefined) {
    const ref = readSubgraphRef(id, refJson);
    if (ctx.seenNames.has(ref.name)) {
      fail(
        `node "${id}": subgraph reference cycle ${[...ctx.seenNames, ref.name].map((n) => JSON.stringify(n)).join(" -> ")}; named subgraph references must be acyclic — resolving one would resolve itself forever`,
      );
    }
    if (!hasRegisteredSubgraph(ref.name)) {
      fail(`node "${id}": ${unknownSubgraphMessage(ref.name)}`);
    }
    const entry = getRegisteredSubgraph(ref.name);
    // A pin is opt-in, and a mismatch is a hard error: the author who
    // wrote a hash asked to cook exactly what they authored against. A
    // ref WITHOUT one follows the registry, so improving a primitive
    // never breaks a saved graph. Neither mode warns — a library warning
    // reaches nobody, which makes it indistinguishable from cooking the
    // near-miss silently.
    if (ref.hash !== undefined && ref.hash !== entry.hash) {
      fail(
        `node "${id}": subgraph "${ref.name}" is pinned to content hash ${ref.hash}, but the registered one hashes ${entry.hash} — the primitive changed since this graph was written. Re-save the graph to adopt the new version, or remove "hash" from the ref to follow the registry.`,
      );
    }
    ctx.seenNames.add(ref.name);
    try {
      return buildSubgraphNode(
        graph,
        id,
        entry.subgraph as unknown as Record<string, unknown>,
        paramsJson,
        ctx,
        ref,
        wrapper,
        bindings,
        declaredParams,
      );
    } finally {
      ctx.seenNames.delete(ref.name);
    }
  }
  if (!isPlainObject(payload)) {
    fail(
      `node "${id}": a "${wrapper}" node needs a "subgraph" payload object { graph, inputs, outputs } carrying its inner graph, or a "ref" { name } naming a registered one, got ${JSON.stringify(payload)}`,
    );
  }
  if (ctx.seenPayloads.has(payload)) {
    fail(
      `node "${id}": its subgraph payload reaches itself (a payload cycle); subgraph nesting must be acyclic`,
    );
  }
  ctx.seenPayloads.add(payload);
  try {
    return buildSubgraphNode(
      graph,
      id,
      payload,
      paramsJson,
      ctx,
      undefined,
      wrapper,
      bindings,
      declaredParams,
    );
  } finally {
    ctx.seenPayloads.delete(payload);
  }
}

/**
 * The one construction route: recursively deserialize the inner graph,
 * then re-wrap it through `subgraphNode` so the instance is
 * indistinguishable from a code-first one. `ref`, when present, is
 * recorded against the def so serialization writes the reference back out.
 */
function buildSubgraphNode(
  graph: Graph,
  id: string,
  payload: Record<string, unknown>,
  paramsJson: Record<string, unknown>,
  ctx: ReadContext,
  ref: SerializedSubgraphRef | undefined,
  wrapper: WrapperKind,
  bindings: Readonly<Record<string, number | readonly number[]>>,
  declaredParams: ReadonlySet<string>,
): NodeHandle {
  checkKeys(payload, SUBGRAPH_PAYLOAD_KEYS, `node "${id}" subgraph payload`, NO_ANNOTATION_KEY);
  let inner: Graph;
  try {
    inner = deserializeGraphRec(payload.graph, { ...ctx, nested: true });
  } catch (err) {
    if (err instanceof GraphSerializationError) {
      fail(`node "${id}" inner graph: ${err.message}`);
    }
    throw err;
  }
  const inputs = readExposedPins(payload.inputs, inner, `node "${id}" subgraph inputs`);
  const outputs = readExposedPins(payload.outputs, inner, `node "${id}" subgraph outputs`);
  // Re-wrapping injects plumbing under reserved names ("__in_<name>"
  // portal nodes, "__out_<name>" outputs); detect collisions with the
  // payload's own content up front so the error states the mechanism and
  // the fix instead of a bare duplicate-id failure from Graph.add.
  for (const exp of inputs) {
    const portalId = `__in_${exp.name}`;
    if (inner._nodes.has(portalId)) {
      fail(
        `node "${id}": inner node id "${portalId}" collides with the portal node injected for exposed input "${exp.name}" — ids "__in_<name>" and "__out_<name>" are reserved for subgraph plumbing; rename the inner node or the exposed pin`,
      );
    }
  }
  for (const exp of outputs) {
    const outName = `__out_${exp.name}`;
    if (inner._outputs.some((o) => o.name === outName)) {
      fail(
        `node "${id}": inner output "${outName}" collides with the output injected for exposed output "${exp.name}" — ids "__in_<name>" and "__out_<name>" are reserved for subgraph plumbing; rename the inner output or the exposed pin`,
      );
    }
  }
  // A recipe records a body and its exposed pins and NOTHING about which
  // wrapper cooks them, so the kind lives only in the referencing node's
  // `type`. That leaves one way to reach the wrong answer through
  // well-formed JSON: point a `subgraph` node at a body written to be
  // iterated, and it cooks once over the concatenated collection and emits
  // one item where the author expected K. What is refused is the
  // confusion, not the body: a forEach body is a perfectly good thing to
  // write and to REGISTER, and `registerSubgraph` probes one as a forEach
  // (its canonicalizing probe reads the kind off these same reserved names
  // through `inferWrapperKind`), so nothing here makes such a body
  // unregisterable.
  //
  // Checked HERE rather than in `subgraphNode` because the mistake being
  // caught only EXISTS in the serialized form. A code-first author picked a
  // constructor — `forEachNode` or `subgraphNode` — and cannot have paired
  // the wrong one with a body silently; a JSON author wrote a `type` key
  // beside a payload, and those two can disagree. Only the loader holds
  // both halves plus the node id and the `ref` name the message has to
  // quote, which is why the refusal can say "the type is the mistake" at
  // all.
  const recipeNote =
    ref === undefined ? "" : ` (the recipe "${ref.name}" itself is fine — the type is the mistake)`;
  if (wrapper !== "forEach") {
    const iterated = inputs.filter((e) => ITERATED_PIN_NAMES.has(e.name));
    if (iterated.length > 0) {
      fail(
        `node "${id}": a "${wrapper}" node cannot expose ${iterated
          .map((e) => `"${e.name}"`)
          .join(" or ")} — those names are reserved for the pin a "forEach" iterates, and this body is ` +
          `written to be looped over. As a "${wrapper}" it would cook over the whole collection and ` +
          `emit one result where K were meant. Change this node's "type" to "forEach"${recipeNote}, or ` +
          "rename the exposed input if that is not what the body means.",
      );
    }
  }
  // The same refusal for the other loop's reserved name, on BOTH sides —
  // `repeatUntil` matches its carried output to its carried input by name,
  // so a body written for it says so at both ends. A `subgraph` carrying
  // one would cook exactly ONE relaxation pass where the author wrote
  // "until it settles": well-formed, saves cleanly, and wrong.
  if (wrapper !== "repeatUntil") {
    for (const [side, pins] of [
      ["input", inputs],
      ["output", outputs],
    ] as const) {
      const carried = pins.filter((e) => CARRIED_PIN_NAMES.has(e.name));
      if (carried.length > 0) {
        fail(
          `node "${id}": a "${wrapper}" node cannot expose ${side} ${carried
            .map((e) => `"${e.name}"`)
            .join(" or ")} — that name is reserved for the pin a "repeatUntil" feeds back into itself, and ` +
            `this body is written to be relaxed to a fixed point. As a "${wrapper}" it would cook ONE pass ` +
            `where "until it settles" was meant. Change this node's "type" to "repeatUntil"${recipeNote}, ` +
            `or rename the exposed ${side} if a single pass is what you want.`,
        );
      }
    }
  }
  const decls = readExposedParams(payload.params, inner, `node "${id}" subgraph params`);
  let def;
  let exposed: readonly ExposedParam[];
  try {
    exposed = decls.map((decl) => resolveExposedParam(inner, decl));
    // The one place the two wrappers part company on the way in. Both read
    // the same payload — a forEach is a subgraph plus a loop, and the loop
    // is named by a reserved exposed-input name inside `inputs`, so the
    // payload needs no field to say which this is.
    def =
      wrapper === "forEach"
        ? forEachNode(inner, inputs, outputs, exposed)
        : wrapper === "repeatUntil"
          ? repeatUntilNode(inner, inputs, outputs, exposed)
          : subgraphNode(inner, inputs, outputs, exposed);
  } catch (err) {
    fail(`node "${id}": ${err instanceof Error ? err.message : String(err)}`);
  }
  // Values, validated against the schemas just derived — exactly the
  // treatment a standard node's params get, including field capability.
  const declared = new Map(exposed.map((p) => [p.name, p.schema]));
  // The loop's own two params, for a `repeatUntil`. Not exposed from the
  // body and so absent from `exposed`, but present on every instance and
  // written by the writer, so the reader has to know them or a saved
  // `maxRounds` would come back as "unknown param".
  if (wrapper === "repeatUntil") {
    for (const [name, schema] of Object.entries(REPEAT_UNTIL_PARAM_SCHEMAS)) {
      declared.set(name, schema);
    }
  }
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paramsJson)) {
    const schema = declared.get(key);
    if (schema === undefined) {
      fail(
        `node "${id}": unknown param "${key}"; this subgraph node exposes: ${[...declared.keys()].join(", ") || "(none)"} (an exposed param must be declared under "params" ${ref === undefined ? 'in the node\'s "subgraph" payload' : `in the registered recipe of "${ref.name}"`})`,
      );
    }
    const where = `node "${id}" param "${key}"`;
    if (schema.acceptsField === true && isPlainObject(value)) {
      // The wrapper's OWN slot lives in the outer graph, so the outer
      // graph's params bind it — this is the one hop by which a
      // graph-scoped value reaches a body, `withExposedParams` substituting
      // it the rest of the way at cook time.
      checkNoShadowedGraphParam(value as FieldSpec, declaredParams, where);
      try {
        params[key] = fieldFromJson(value as FieldSpec, bindings);
      } catch (err) {
        fail(`${where}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      checkParamValue(schema, value, where);
      params[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
    }
  }
  // Recorded per DEF, and a def is created fresh for every reference (a
  // live graph can be wrapped exactly once), so no two references share
  // this record and serialization can write each one back out as it came.
  if (ref !== undefined) recordSubgraphRef(def as object, ref);
  return graph.add(def, params, id);
}

/**
 * Rebuild a Graph from the serialized JSON format. Validates the format
 * version, that every node type is registered, that params match their
 * schemas (type, enum membership, bounds, no unknown keys), and that
 * every connection and output references existing nodes and pins —
 * errors name the offending node id, param, or pin and list what would
 * be valid.
 *
 * The key sets are closed at EVERY object position — the graph, a node, a
 * `subgraph` payload, a `ref`, a connection, a declared output, an
 * exposed-pin or exposed-param declaration, an exposed-param target — so
 * an unrecognized key is named rather than ignored.
 *
 * The optional `meta` block ({ title?, description?, tags? }) is read
 * onto {@link Graph.setMeta}; an unknown key inside it is an error, not a
 * warning. Absent meta leaves the graph without any.
 *
 * `subgraph` nodes are rebuilt recursively from their nested payload and
 * re-wrapped through `subgraphNode`, so they behave exactly like
 * code-first subgraph nodes (including inner-edit invalidation).
 * Item-list params must be empty in the JSON — live DataItems are bound
 * at runtime (e.g. by the World) after deserialization.
 */
export function deserializeGraph(json: unknown): Graph {
  return deserializeGraphRec(json, { seenPayloads: new Set(), seenNames: new Set() });
}

function deserializeGraphRec(json: unknown, ctx: ReadContext): Graph {
  if (!isPlainObject(json)) {
    fail(`deserializeGraph: expected a serialized graph object, got ${JSON.stringify(json)}`);
  }
  checkKeys(json, GRAPH_KEYS, "deserializeGraph", NO_ANNOTATION_KEY);
  if (json.formatVersion !== FORMAT_VERSION) {
    fail(
      `unsupported formatVersion ${JSON.stringify(json.formatVersion)}; this build reads formatVersion ${FORMAT_VERSION}`,
    );
  }
  if (typeof json.seed !== "number" || !Number.isFinite(json.seed)) {
    fail(`graph seed must be a finite number, got ${JSON.stringify(json.seed)}`);
  }
  const nodesJson = json.nodes;
  if (!Array.isArray(nodesJson)) fail(`"nodes" must be an array`);
  const connectionsJson = json.connections ?? [];
  if (!Array.isArray(connectionsJson)) fail(`"connections" must be an array`);
  const outputsJson = json.outputs ?? [];
  if (!Array.isArray(outputsJson)) fail(`"outputs" must be an array`);

  const graph = new Graph(json.seed);
  graph.setMeta(readGraphMeta(json.meta, `"meta"`));
  // Declared BEFORE any node is read, because every field-valued param
  // below is built against these values: binding substitutes at BUILD time
  // (the only moment a value reaches `Field.key`, and so the only moment it
  // reaches a memo key), and deserialize is the earliest build that has
  // them.
  const graphParams = readGraphParams(json.params, ctx.nested === true);
  // Only the BINDINGS are needed before the nodes: a targetless param
  // substitutes into expressions at build time. A targeted one is resolved
  // and applied after, because its schema comes from params that do not
  // exist yet — see `applyGraphParamTargets`.
  const bindings = graphParamBindings(graphParams);
  const declaredParams = new Set(graphParams.map((p) => p.name));
  const handles = new Map<string, NodeHandle>();
  // Which param keys each node's JSON ACTUALLY carried. `getParams` merges
  // the registry defaults, so it cannot tell "the author wrote 2" from
  // "the author wrote nothing and the default is 10" — and only the first
  // is worth objecting to when a graph param drives that slot.
  const authoredParamKeys = new Map<string, ReadonlySet<string>>();
  const knownIds = (): string => [...handles.keys()].join(", ");

  nodesJson.forEach((nodeJson: unknown, i: number) => {
    if (!isPlainObject(nodeJson)) {
      fail(`nodes[${i}]: expected a node object, got ${JSON.stringify(nodeJson)}`);
    }
    const id = nodeJson.id;
    if (typeof id !== "string" || id === "") {
      fail(`nodes[${i}]: node id must be a non-empty string, got ${JSON.stringify(id)}`);
    }
    if (handles.has(id)) {
      fail(`nodes[${i}]: duplicate node id "${id}"`);
    }
    checkKeys(nodeJson, NODE_KEYS, `node "${id}"`, NO_ANNOTATION_KEY);
    const type = nodeJson.type;
    if (typeof type !== "string") {
      fail(`node "${id}": type must be a string, got ${JSON.stringify(type)}`);
    }
    if (!hasNodeType(type)) {
      fail(
        `node "${id}": unknown node type "${type}"; registered types: ${listNodeTypes()
          .map((t) => t.type)
          .sort()
          .join(", ")}`,
      );
    }
    const paramsJson = nodeJson.params ?? {};
    if (!isPlainObject(paramsJson)) {
      fail(`node "${id}": params must be an object, got ${JSON.stringify(nodeJson.params)}`);
    }
    authoredParamKeys.set(id, new Set(Object.keys(paramsJson)));
    if (type === "subgraph" || type === "forEach" || type === "repeatUntil") {
      handles.set(
        id,
        addSubgraphNode(graph, id, nodeJson, paramsJson, ctx, type, bindings, declaredParams),
      );
      return;
    }
    // Both keys are inner-graph plumbing. Carried by any other type they
    // are a mistake — and one that used to be ignored, which is exactly how
    // a graph cooks something other than what it says.
    for (const key of ["subgraph", "ref"] as const) {
      if (nodeJson[key] !== undefined) {
        fail(
          `node "${id}": type "${type}" wraps no inner graph, so it cannot carry "${key}"; only "subgraph", "forEach" and "repeatUntil" nodes wrap one (inline under "subgraph", or by name under "ref")`,
        );
      }
    }
    const reg = getNodeType(type);
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(paramsJson)) {
      const schema = reg.info.params[key];
      if (!schema) {
        fail(
          `node "${id}": unknown param "${key}" for type "${type}"; valid params: ${Object.keys(reg.info.params).join(", ")}`,
        );
      }
      const where = `node "${id}" param "${key}"`;
      if (schema.acceptsField === true && isPlainObject(value)) {
        checkNoShadowedGraphParam(value as FieldSpec, declaredParams, where);
        try {
          params[key] = fieldFromJson(value as FieldSpec, bindings);
        } catch (err) {
          fail(`${where}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        checkParamValue(schema, value, where);
        params[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
      }
    }
    handles.set(id, graph.add(reg.def, params, id));
  });

  // Now that every node exists, a targeted param can merge its schema from
  // the params it drives and write its value into them.
  graph.setGraphParams(applyGraphParamTargets(graph, graphParams, authoredParamKeys));

  connectionsJson.forEach((connJson: unknown, i: number) => {
    if (!isPlainObject(connJson)) {
      fail(`connections[${i}]: expected a connection object, got ${JSON.stringify(connJson)}`);
    }
    checkKeys(connJson, CONNECTION_KEYS, `connections[${i}]`, NO_ANNOTATION_KEY);
    const [fromId, fromPin] = checkEndpoint(connJson.from, `connections[${i}].from`);
    const [toId, toPin] = checkEndpoint(connJson.to, `connections[${i}].to`);
    const from = handles.get(fromId);
    if (!from) fail(`connections[${i}]: unknown source node "${fromId}"; known nodes: ${knownIds()}`);
    const to = handles.get(toId);
    if (!to) fail(`connections[${i}]: unknown target node "${toId}"; known nodes: ${knownIds()}`);
    // Pins come from the instance's own def: for standard nodes that is
    // the registered def, for subgraph nodes the per-instance exposed pins.
    for (const [nodeId, pins, pin, side] of [
      [fromId, graph.require(fromId).def.outputs, fromPin, "output"],
      [toId, graph.require(toId).def.inputs, toPin, "input"],
    ] as const) {
      if (!pins.some((p) => p.name === pin)) {
        fail(
          `connections[${i}]: node "${nodeId}" has no ${side} pin "${pin}"; valid ${side} pins: ${pins.map((p) => p.name).join(", ") || "(none)"}`,
        );
      }
    }
    try {
      graph.connect(from, fromPin, to, toPin);
    } catch (err) {
      fail(`connections[${i}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  outputsJson.forEach((outJson: unknown, i: number) => {
    if (!isPlainObject(outJson)) {
      fail(`outputs[${i}]: expected an output object, got ${JSON.stringify(outJson)}`);
    }
    checkKeys(outJson, OUTPUT_KEYS, `outputs[${i}]`, NO_ANNOTATION_KEY);
    const { id, pin, name } = outJson;
    if (typeof id !== "string" || typeof pin !== "string" || typeof name !== "string") {
      fail(`outputs[${i}]: expected { id, pin, name } strings, got ${JSON.stringify(outJson)}`);
    }
    const handle = handles.get(id);
    if (!handle) fail(`outputs[${i}]: unknown node "${id}"; known nodes: ${knownIds()}`);
    const outPins = graph.require(id).def.outputs;
    if (!outPins.some((p) => p.name === pin)) {
      fail(
        `outputs[${i}]: node "${id}" has no output pin "${pin}"; valid output pins: ${outPins.map((p) => p.name).join(", ")}`,
      );
    }
    try {
      graph.output(handle, pin, name);
    } catch (err) {
      fail(`outputs[${i}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return graph;
}
