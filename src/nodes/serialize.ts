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
  getSubgraphPlumbing,
  getSubgraphSpec,
  paramValueError,
  subgraphNode,
  type ExposedParam,
  type ExposedPin,
  type GraphMeta,
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  type SubgraphSpec,
} from "../graph/index.js";
import { ITERATED_PIN_NAMES, type WrapperKind } from "../graph/subgraph.js";
import { type FieldSpec, fieldFromJson, fieldToJson } from "../fields/fieldJson.js";
import { forEachNode } from "./forEach.js";
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

/** The stable, versioned graph interchange format. */
export interface SerializedGraph {
  readonly formatVersion: 1;
  readonly seed: number;
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
 * node — a near-miss, silently. A future format field therefore arrives
 * with a `formatVersion` bump rather than riding along unnoticed.
 *
 * The rule holds at EVERY object position, not only the outer ones — a
 * lenient nested object is the same near-miss one level down, and the
 * nested positions are where the plausible typos live (`enum` or
 * `acceptsField` on an exposed param, `description` on a declared output).
 */
const GRAPH_KEYS = ["formatVersion", "seed", "meta", "nodes", "connections", "outputs"] as const;
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
    try {
      return fieldToJson(value);
    } catch (err) {
      fail(`${where}: ${err instanceof Error ? err.message : String(err)}`);
    }
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
  const at = negZero(value)
    ? ""
    : Array.isArray(value)
      ? (() => {
          const i = value.findIndex(negZero);
          return i === -1 ? undefined : `[${i}]`;
        })()
      : undefined;
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
  const declared = new Map(spec.params.map((p) => [p.name, p]));
  for (const key of Object.keys(nodeParams)) {
    if (!declared.has(key)) {
      fail(
        `cannot serialize node "${id}": param "${key}" is not an exposed param of this subgraph node; exposed params: ${[...declared.keys()].join(", ") || "(none)"}`,
      );
    }
  }
  const params: Record<string, unknown> = {};
  for (const [name, exposed] of declared) {
    params[name] = serializeParamValue(
      exposed.schema,
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
      if (type === "subgraph" || type === "forEach") {
        fail(
          `cannot serialize node "${state.id}": its definition was not created by ${
            type === "forEach" ? "forEachNode(...)" : "subgraphNode(...)"
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
    return buildSubgraphNode(graph, id, payload, paramsJson, ctx, undefined, wrapper);
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
): NodeHandle {
  checkKeys(payload, SUBGRAPH_PAYLOAD_KEYS, `node "${id}" subgraph payload`, NO_ANNOTATION_KEY);
  let inner: Graph;
  try {
    inner = deserializeGraphRec(payload.graph, ctx);
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
  // one item where the author expected K. Checked HERE rather than in
  // `subgraphNode`, because a forEach body is a perfectly good thing to
  // REGISTER — the registry canonicalizes every recipe through a probe
  // typed "subgraph", so refusing at construction would make such a body
  // unregisterable. What is refused is the confusion, not the body.
  if (wrapper === "subgraph") {
    const iterated = inputs.filter((e) => ITERATED_PIN_NAMES.has(e.name));
    if (iterated.length > 0) {
      fail(
        `node "${id}": a "subgraph" node cannot expose ${iterated
          .map((e) => `"${e.name}"`)
          .join(" or ")} — those names are reserved for the pin a "forEach" iterates, and this body is ` +
          `written to be looped over. As a "subgraph" it would cook ONCE over the whole collection and ` +
          `emit one result where K were meant. Change this node's "type" to "forEach"${
            ref === undefined ? "" : ` (the recipe "${ref.name}" itself is fine — the type is the mistake)`
          }, or rename the exposed input if a single cook is what you want.`,
      );
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
        : subgraphNode(inner, inputs, outputs, exposed);
  } catch (err) {
    fail(`node "${id}": ${err instanceof Error ? err.message : String(err)}`);
  }
  // Values, validated against the schemas just derived — exactly the
  // treatment a standard node's params get, including field capability.
  const declared = new Map(exposed.map((p) => [p.name, p.schema]));
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
      try {
        params[key] = fieldFromJson(value as FieldSpec);
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
  const handles = new Map<string, NodeHandle>();
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
    if (type === "subgraph" || type === "forEach") {
      handles.set(id, addSubgraphNode(graph, id, nodeJson, paramsJson, ctx, type));
      return;
    }
    // Both keys are inner-graph plumbing. Carried by any other type they
    // are a mistake — and one that used to be ignored, which is exactly how
    // a graph cooks something other than what it says.
    for (const key of ["subgraph", "ref"] as const) {
      if (nodeJson[key] !== undefined) {
        fail(
          `node "${id}": type "${type}" wraps no inner graph, so it cannot carry "${key}"; only "subgraph" and "forEach" nodes wrap one (inline under "subgraph", or by name under "ref")`,
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
        try {
          params[key] = fieldFromJson(value as FieldSpec);
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
