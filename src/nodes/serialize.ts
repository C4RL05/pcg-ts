/**
 * Graph JSON serialization: a stable, versioned format referencing
 * registered node types by name. Params are validated against the
 * registry's param schemas; field-valued params serialize as declarative
 * FieldSpecs (see fieldJson.ts). Every validation error names the node,
 * param, or pin at fault and states what would be valid.
 */
import { isField } from "../fields/index.js";
import { Graph, type NodeHandle } from "../graph/index.js";
import { type FieldSpec, fieldFromJson, fieldToJson } from "./fieldJson.js";
import { type ParamSchema, getNodeType, hasNodeType, listNodeTypes } from "./registry.js";

/** Errors raised while serializing or deserializing graphs. */
export class GraphSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphSerializationError";
  }
}

/** One node instance in a serialized graph. */
export interface SerializedNode {
  readonly id: string;
  /** Registered node type name (see listNodeTypes). */
  readonly type: string;
  /** Param values; field-valued params carry FieldSpec objects. */
  readonly params: Record<string, unknown>;
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
  readonly nodes: readonly SerializedNode[];
  readonly connections: readonly SerializedConnection[];
  readonly outputs: readonly SerializedOutput[];
}

const FORMAT_VERSION = 1;

function fail(message: string): never {
  throw new GraphSerializationError(message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a plain (non-field) param value against its schema. `where`
 * names the node and param for error messages.
 */
function checkParamValue(schema: ParamSchema, value: unknown, where: string): void {
  const expectNumber = (label: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(`${where}: expected ${label}, got ${JSON.stringify(value)}`);
    }
    return value as number;
  };
  const checkBounds = (nums: readonly number[]): void => {
    for (const v of nums) {
      if (schema.min !== undefined && v < schema.min) {
        fail(`${where}: ${v} is below the minimum ${schema.min}`);
      }
      if (schema.max !== undefined && v > schema.max) {
        fail(`${where}: ${v} is above the maximum ${schema.max}`);
      }
    }
  };
  switch (schema.type) {
    case "f32":
      checkBounds([expectNumber("a finite number")]);
      break;
    case "i32": {
      const v = expectNumber("an integer");
      if (!Number.isInteger(v)) fail(`${where}: expected an integer, got ${v}`);
      checkBounds([v]);
      break;
    }
    case "u32": {
      const v = expectNumber("a non-negative integer");
      if (!Number.isInteger(v) || v < 0) {
        fail(`${where}: expected a non-negative integer, got ${v}`);
      }
      checkBounds([v]);
      break;
    }
    case "bool":
      if (typeof value !== "boolean") {
        fail(`${where}: expected a boolean, got ${JSON.stringify(value)}`);
      }
      break;
    case "string":
      if (typeof value !== "string") {
        fail(`${where}: expected a string, got ${JSON.stringify(value)}`);
      }
      break;
    case "enum": {
      const valid = schema.enum ?? [];
      if (typeof value !== "string" || !valid.includes(value)) {
        fail(
          `${where}: expected one of ${valid.map((v) => `"${v}"`).join(", ")}, got ${JSON.stringify(value)}`,
        );
      }
      break;
    }
    case "vec3":
    case "vec4": {
      const size = schema.type === "vec3" ? 3 : 4;
      if (
        !Array.isArray(value) ||
        value.length !== size ||
        !value.every((v) => typeof v === "number" && Number.isFinite(v))
      ) {
        fail(`${where}: expected an array of ${size} finite numbers, got ${JSON.stringify(value)}`);
      }
      checkBounds(value as number[]);
      break;
    }
  }
}

/**
 * Serialize a graph to the versioned JSON format. Every node's type must
 * be registered (via standardNode) and its params must match the
 * registered schemas; field-valued params must originate from
 * fieldFromJson so they carry a serializable spec.
 */
export function serializeGraph(graph: Graph): SerializedGraph {
  const nodes: SerializedNode[] = [];
  for (const state of graph._nodes.values()) {
    const type = state.def.type;
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
      const value = state.params[key];
      const where = `node "${state.id}" param "${key}"`;
      if (isField(value)) {
        if (schema.acceptsField !== true) {
          fail(`${where}: holds a Field but the param is not field-capable`);
        }
        try {
          params[key] = fieldToJson(value);
        } catch (err) {
          fail(`${where}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Field-capable vec params accept a runtime-legal scalar (tuple-1
        // broadcast); canonicalize it to the vec arity so the serialized
        // form always matches the schema. Broadcast semantics make the
        // cooked output identical.
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
        params[key] = Array.isArray(plain) ? [...(plain as number[])] : plain;
      }
    }
    nodes.push({ id: state.id, type, params });
  }
  return {
    formatVersion: FORMAT_VERSION,
    seed: graph.seed,
    nodes,
    connections: graph._connections.map((c) => ({
      from: [c.from, c.fromPin] as const,
      to: [c.to, c.toPin] as const,
    })),
    outputs: graph._outputs.map((o) => ({ id: o.node, pin: o.pin, name: o.name })),
  };
}

function checkEndpoint(v: unknown, label: string): [string, string] {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || typeof v[1] !== "string") {
    fail(`${label}: expected [nodeId, pinName], got ${JSON.stringify(v)}`);
  }
  return [v[0], v[1]];
}

/**
 * Rebuild a Graph from the serialized JSON format. Validates the format
 * version, that every node type is registered, that params match their
 * schemas (type, enum membership, bounds, no unknown keys), and that
 * every connection and output references existing nodes and pins —
 * errors name the offending node id, param, or pin and list what would
 * be valid.
 */
export function deserializeGraph(json: unknown): Graph {
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
    const reg = getNodeType(type);
    const paramsJson = nodeJson.params ?? {};
    if (!isPlainObject(paramsJson)) {
      fail(`node "${id}": params must be an object, got ${JSON.stringify(nodeJson.params)}`);
    }
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
        params[key] = Array.isArray(value) ? [...(value as number[])] : value;
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
    for (const [nodeId, pins, pin, side] of [
      [fromId, getNodeType(graph.require(fromId).def.type).info.outputs, fromPin, "output"],
      [toId, getNodeType(graph.require(toId).def.type).info.inputs, toPin, "input"],
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
    const outPins = getNodeType(graph.require(id).def.type).info.outputs;
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
