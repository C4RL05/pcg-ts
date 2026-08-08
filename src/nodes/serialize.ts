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
import { type FieldSpec, fieldFromJson, fieldToJson } from "./fieldJson.js";
import { getNodeType, hasNodeType, listNodeTypes, standardNode } from "./registry.js";
import { type ExposedParamDecl, resolveExposedParam } from "./subgraphParams.js";

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
 * AUTHORED part only. `type`, `enum` and `acceptsField` are deliberately
 * absent — they are re-derived from the targets' registered schemas on
 * load, so a payload cannot carry a schema that lies about what the inner
 * params accept, and there is no duplicated truth to drift.
 */
export interface SerializedExposedParam {
  /** Param name on the wrapping subgraph node. */
  readonly name: string;
  /** Inner slots the value is written into, in write order. */
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

/** One node instance in a serialized graph. */
export interface SerializedNode {
  readonly id: string;
  /** Registered node type name (see listNodeTypes). */
  readonly type: string;
  /**
   * Param values; field-valued params carry FieldSpec objects. On a
   * `subgraph` node these are its exposed params' values — the
   * declarations live in the `subgraph` payload, the way a standard
   * node's schemas live in the registry.
   */
  readonly params: Record<string, unknown>;
  /** Present on `subgraph` nodes only: the inner graph payload. */
  readonly subgraph?: SerializedSubgraph;
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

function fail(message: string): never {
  throw new GraphSerializationError(message);
}

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
    "Composite node wrapping an inner graph as a single node. Pins and params are per-instance, derived from the exposed inner pins and the exposed inner params, so this registry entry declares none — create instances with subgraphNode(innerGraph, exposedInputs, exposedOutputs, exposedParams) and read an instance's real interface with describeSubgraphPins(def) and describeSubgraphParams(def). A serialized subgraph node carries its exposed-param VALUES in \"params\" and its inner graph plus the exposed pin and param DECLARATIONS in a nested payload under \"subgraph\" ({ graph, inputs, outputs, params }), recursively in the same versioned format.",
  inputs: [],
  outputs: [],
  params: {},
  execute() {
    throw new Error(
      'the registered "subgraph" definition is metadata-only and cannot cook; create subgraph nodes with subgraphNode(innerGraph, exposedInputs, exposedOutputs), or deserialize a graph containing one',
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
  return Array.isArray(plain) ? [...(plain as unknown[])] : plain;
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

/** Serialize one subgraph node as its nested payload; `seen` holds the graphs on the current path. */
function serializeSubgraphNode(
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
    type: "subgraph",
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
  const targets = exposed.targets.map(slotLabel).join(", ");
  if (held.type !== want.type) {
    fail(`${where} declares type "${held.type}", but its targets (${targets}) are ${want.type}; ${door}`);
  }
  if (!sameEnumList(held.enum, want.enum)) {
    fail(
      `${where} declares enum values ${(held.enum ?? []).join(", ") || "(none)"}, but its targets (${targets}) allow ${(want.enum ?? []).join(", ") || "(none)"}; ${door}`,
    );
  }
  if ((held.acceptsField === true) !== (want.acceptsField === true)) {
    fail(
      held.acceptsField === true
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
        nodes.push(serializeSubgraphNode(state.id, state.params, spec, seen));
        continue;
      }
      const type = state.def.type;
      if (type === "subgraph") {
        fail(
          `cannot serialize node "${state.id}": its definition was not created by subgraphNode(...); build subgraph nodes with subgraphNode (or deserializeGraph) so their inner graph can be serialized`,
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
    if (!Array.isArray(e.targets) || e.targets.length === 0) {
      fail(
        `${where}[${i}] ("${e.name}"): "targets" must be a non-empty array of { node, param } objects, got ${JSON.stringify(e.targets)}`,
      );
    }
    const targets = e.targets.map((t: unknown, j: number) => {
      if (!isPlainObject(t) || typeof t.node !== "string" || typeof t.param !== "string") {
        fail(
          `${where}[${i}] ("${e.name}") targets[${j}]: expected { node, param } strings, got ${JSON.stringify(t)}`,
        );
      }
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
 * Rebuild one subgraph node from its nested payload: recursively
 * deserialize the inner graph, then re-wrap it through `subgraphNode` so
 * the instance is indistinguishable from a code-first one. `seenPayloads`
 * guards against self-referencing payload objects.
 */
function addSubgraphNode(
  graph: Graph,
  id: string,
  nodeJson: Record<string, unknown>,
  paramsJson: Record<string, unknown>,
  seenPayloads: Set<object>,
): NodeHandle {
  const payload = nodeJson.subgraph;
  if (!isPlainObject(payload)) {
    fail(
      `node "${id}": a "subgraph" node needs a "subgraph" payload object { graph, inputs, outputs } carrying its inner graph, got ${JSON.stringify(payload)}`,
    );
  }
  if (seenPayloads.has(payload)) {
    fail(
      `node "${id}": its subgraph payload reaches itself (a payload cycle); subgraph nesting must be acyclic`,
    );
  }
  seenPayloads.add(payload);
  let inner: Graph;
  try {
    inner = deserializeGraphRec(payload.graph, seenPayloads);
  } catch (err) {
    if (err instanceof GraphSerializationError) {
      fail(`node "${id}" inner graph: ${err.message}`);
    }
    throw err;
  } finally {
    seenPayloads.delete(payload);
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
  const decls = readExposedParams(payload.params, inner, `node "${id}" subgraph params`);
  let def;
  let exposed: readonly ExposedParam[];
  try {
    exposed = decls.map((decl) => resolveExposedParam(inner, decl));
    def = subgraphNode(inner, inputs, outputs, exposed);
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
        `node "${id}": unknown param "${key}"; this subgraph node exposes: ${[...declared.keys()].join(", ") || "(none)"} (an exposed param must be declared in the node's "subgraph" payload under "params")`,
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
  return deserializeGraphRec(json, new Set());
}

function deserializeGraphRec(json: unknown, seenPayloads: Set<object>): Graph {
  if (!isPlainObject(json)) {
    fail(`deserializeGraph: expected a serialized graph object, got ${JSON.stringify(json)}`);
  }
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
    if (type === "subgraph") {
      handles.set(id, addSubgraphNode(graph, id, nodeJson, paramsJson, seenPayloads));
      return;
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
