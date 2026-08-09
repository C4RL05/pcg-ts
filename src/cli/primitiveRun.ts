/**
 * What `pcg run` needs besides cooking: the wrapper graph it synthesizes
 * around a registered primitive, the schema-directed parse of `--param
 * k=v`, and the value-item binding `--in data.json` performs.
 *
 * Two decisions here are observable contract rather than implementation.
 *
 * **The wrapper is pinned.** Its graph seed is 0, the primitive's node id
 * is `main`, and one output is declared per exposed output pin, named
 * after it. Those constants decide what cooks: a node's seed is
 * `deriveNodeSeed(graphSeed, nodeId)`, so renaming the node or changing
 * the default seed would silently change every point `pcg run` produces.
 * They are asserted in the tests, and `pcg run <name>` is required to cook
 * byte-identically to a hand-written one-node `ref` graph of the same
 * shape — which is why the wrapper is built as JSON and handed to
 * `deserializeGraph`, the one construction route, instead of assembling a
 * `Graph` in code.
 *
 * **`--in` binds through the wrapper, never into the primitive.** Items
 * land on synthesized `dataInput` nodes wired to the primitive's exposed
 * input pins. Reaching into `getSubgraphSpec(def).graph` to bind an inner
 * `dataInput` would bump the inner graph's version, move the wrapper's
 * memo key, and break the encapsulation the exposed-pin contract exists to
 * provide.
 */
import {
  type DataItem,
  type ParamSchema,
  type SerializedConnection,
  type SerializedGraph,
  type SerializedNode,
  type SerializedOutput,
  makeValueItem,
} from "../index.js";
import { CliUsageError, parseNumberValue } from "./args.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

/** Node id the primitive instance takes in the synthesized wrapper. */
export const WRAPPER_NODE_ID = "main";

/** Graph seed the wrapper starts at, before any `--seed` override. */
export const WRAPPER_SEED = 0;

/** Node id of the `dataInput` synthesized for exposed input pin `pin`. */
export function inputNodeId(pin: string): string {
  return `in_${pin}`;
}

/** Everything the wrapper needs to know about the run being set up. */
export interface WrapperShape {
  /** Registered subgraph name, referenced by `ref` rather than embedded. */
  readonly name: string;
  /** Exposed input pins to feed from a synthesized `dataInput`. */
  readonly boundInputs: readonly string[];
  /** Exposed output pins, each declared as an output of the same name. */
  readonly outputs: readonly string[];
  /** Exposed-param values, already parsed into their serialized form. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The wrapper graph, as the JSON a caller could have written by hand.
 * Nothing about it is derived from the primitive's contents — only from
 * its exposed interface — so an unregistered name fails at
 * `deserializeGraph` with the registry's own message.
 */
export function buildWrapperGraph(shape: WrapperShape): SerializedGraph {
  const nodes: SerializedNode[] = [
    { id: WRAPPER_NODE_ID, type: "subgraph", params: { ...shape.params }, ref: { name: shape.name } },
  ];
  const connections: SerializedConnection[] = [];
  for (const pin of shape.boundInputs) {
    // Item lists are empty in JSON by contract; the live items are bound
    // with graph.setParam after deserialization, exactly as the World
    // binds parent-cell outputs.
    nodes.push({ id: inputNodeId(pin), type: "dataInput", params: { items: [] } });
    connections.push({ from: [inputNodeId(pin), "out"], to: [WRAPPER_NODE_ID, pin] });
  }
  const outputs: SerializedOutput[] = shape.outputs.map((pin) => ({
    id: WRAPPER_NODE_ID,
    pin,
    name: pin,
  }));
  return { formatVersion: 1, seed: WRAPPER_SEED, nodes, connections, outputs };
}

// ---------------------------------------------------------------------------
// --param k=v
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function paramList(names: readonly string[]): string {
  return names.length === 0 ? "(none)" : names.join(", ");
}

/** Parse a JSON field spec from a literal or an `@file.json` reference. */
function readFieldSpec(io: CliIo, name: string, raw: string): unknown {
  let text = raw;
  if (raw.startsWith("@")) {
    const path = raw.slice(1);
    if (path === "") {
      throw new CliUsageError(
        `run: --param ${name}=@ needs a file name after the "@" (--param ${name}=@field.json)`,
      );
    }
    try {
      text = io.readFile(path);
    } catch (err) {
      throw new CliUsageError(
        `run: --param ${name}=@${path}: cannot read the field spec file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch (err) {
    throw new CliUsageError(
      `run: --param ${name}: not valid JSON: ${err instanceof Error ? err.message : String(err)}; a field-valued param takes a JSON field spec ({"fn":"perlinNoise","opts":{...}}) or @file.json holding one — see pcg fields`,
    );
  }
  if (!isPlainObject(spec)) {
    throw new CliUsageError(
      `run: --param ${name}: a field spec must be a JSON object with an "fn" key, got ${JSON.stringify(spec)}; see pcg fields for every constructor`,
    );
  }
  return spec;
}

function parseNumberParam(name: string, raw: string, label: string): number {
  const n = parseNumberValue(raw);
  if (n === undefined) {
    throw new CliUsageError(
      `run: --param ${name}=${raw} expects ${label}; write plain decimal digits with an optional sign, fraction and exponent (12, -4, 1.5, 1e3)`,
    );
  }
  return n;
}

function parseVec(name: string, raw: string, size: number): readonly number[] {
  if (raw.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new CliUsageError(
        `run: --param ${name}: not valid JSON: ${err instanceof Error ? err.message : String(err)}; a vec${size} takes ${size} comma-separated numbers (1,0,2.5) or a JSON array ([1,0,2.5])`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length !== size || !parsed.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new CliUsageError(
        `run: --param ${name}=${raw} expects an array of ${size} finite numbers`,
      );
    }
    return parsed as readonly number[];
  }
  const parts = raw.split(",");
  // A bare scalar fills every component. It is the spelling a uniform
  // scale or an isotropic jitter wants, and writing "0.2,0.2,0.2" to say
  // it is noise, not precision.
  if (parts.length === 1) {
    return new Array<number>(size).fill(parseNumberParam(name, parts[0], "a finite number"));
  }
  if (parts.length !== size) {
    throw new CliUsageError(
      `run: --param ${name}=${raw} expects ${size} comma-separated numbers (or one, broadcast to all ${size}), got ${parts.length}`,
    );
  }
  return parts.map((p) => parseNumberParam(name, p, "a finite number"));
}

/**
 * One `--param` value, parsed under its own schema. Typing is
 * schema-directed rather than guessed from the text, so `count=010` is the
 * number 10 and `name=010` is the string "010"; nothing here has to
 * inspect a value to decide what it might have meant.
 *
 * The result is a SERIALIZED param value — a plain number, boolean,
 * string, array or field spec — which the wrapper JSON carries and
 * `deserializeGraph` validates against the same schema through
 * `checkParamValue`. There is deliberately no second validator: this
 * function decides only what the text spells, never whether the value is
 * legal.
 */
export function parseParamValue(
  io: CliIo,
  name: string,
  schema: ParamSchema,
  raw: string,
): unknown {
  if (schema.type === "items") {
    throw new CliUsageError(
      `run: --param ${name} cannot be set from the command line: it is an item list (live DataItems), and text cannot spell one. Bind items to an exposed INPUT PIN with --in <data.json> instead.`,
    );
  }
  // The "@" and "{" spellings are honoured on field-capable params only,
  // so a string param still takes "@home" and "{a}" as the literal text
  // they are.
  if (schema.acceptsField === true && (raw.startsWith("{") || raw.startsWith("@"))) {
    return readFieldSpec(io, name, raw);
  }
  switch (schema.type) {
    case "f32":
      return parseNumberParam(name, raw, "a finite number");
    case "i32":
      return parseNumberParam(name, raw, "an integer");
    case "u32":
      return parseNumberParam(name, raw, "a non-negative integer");
    case "bool":
      if (raw !== "true" && raw !== "false") {
        throw new CliUsageError(
          `run: --param ${name}=${raw} expects "true" or "false" — exactly those two spellings, so that "1", "yes" and "on" cannot mean something the graph format does not`,
        );
      }
      return raw === "true";
    case "enum": {
      const valid = schema.enum ?? [];
      if (!valid.includes(raw)) {
        throw new CliUsageError(
          `run: --param ${name}=${raw} is not one of its values: ${valid.join(", ")}`,
        );
      }
      return raw;
    }
    case "vec3":
      return parseVec(name, raw, 3);
    case "vec4":
      return parseVec(name, raw, 4);
    case "stringList":
      // "" is the empty list, not a list holding one empty string: an
      // empty string is not a name anything downstream can use.
      return raw === "" ? [] : raw.split(",");
    case "string":
      return raw;
  }
  return raw;
}

/**
 * Every `--param k=v` occurrence, parsed against the primitive's exposed
 * schemas and collected into the wrapper's params object.
 *
 * An unknown param NAME is exit 1 — a named thing that does not exist,
 * like an unknown node type — and lists what the primitive does expose. A
 * malformed VALUE is exit 2, the class the CLI already uses for a flag
 * value of the wrong shape. A repeated key is exit 2 too: last-wins would
 * silently discard one of two values the caller deliberately typed.
 */
export function parseParamAssignments(
  io: CliIo,
  primitive: string,
  schemas: readonly { readonly name: string; readonly schema: ParamSchema }[],
  raw: readonly string[],
): Record<string, unknown> {
  const byName = new Map(schemas.map((p) => [p.name, p.schema]));
  const params: Record<string, unknown> = {};
  for (const assignment of raw) {
    const eq = assignment.indexOf("=");
    if (eq <= 0) {
      throw new CliUsageError(
        `run: --param takes an assignment "<param>=<value>", got ${JSON.stringify(assignment)}; the primitive "${primitive}" exposes: ${paramList(schemas.map((p) => p.name))}`,
      );
    }
    const name = assignment.slice(0, eq);
    const value = assignment.slice(eq + 1);
    const schema = byName.get(name);
    if (schema === undefined) {
      throw new CliError(
        `unknown param "${name}" on primitive "${primitive}"; it exposes: ${paramList(schemas.map((p) => p.name))}`,
      );
    }
    if (name in params) {
      throw new CliUsageError(
        `run: --param ${name} was given more than once; pass each param once — a silent last-wins would cook with a value you also typed something else for`,
      );
    }
    params[name] = parseParamValue(io, name, schema, value);
  }
  return params;
}

// ---------------------------------------------------------------------------
// --in data.json
// ---------------------------------------------------------------------------

/** Items to bind to one exposed input pin. */
export interface InputBinding {
  readonly pin: string;
  readonly items: readonly DataItem[];
}

const ITEM_KEYS = ["kind", "value", "tags"];

/**
 * Why a geometry item cannot be read from a file. Stated once, and stated
 * fully: the alternative is a flag that looks like it accepts a point
 * cloud and quietly does not.
 */
const NO_GEOMETRY =
  'geometry has no JSON representation in this format — Geometry is SoA typed arrays and nothing in the library reads or writes it as JSON, so --in can carry VALUE items only ({ "kind": "value", "value": ... }). Build geometry inside a graph (pointGrid, pointScatterInBounds, ...) and cook that graph with `pcg cook`, or drive the primitive from a graph file that produces its input.';

function itemFail(path: string, where: string, message: string): never {
  throw new CliError(`--in "${path}": ${where}: ${message}`);
}

function readItem(path: string, where: string, raw: unknown): DataItem {
  if (!isPlainObject(raw)) {
    itemFail(path, where, `expected an item object { "kind": "value", "value": ... }, got ${JSON.stringify(raw)}`);
  }
  const kind = raw.kind;
  if (kind === "geometry" || kind === "instances") {
    itemFail(path, where, `asks for a ${kind} item, but ${NO_GEOMETRY}`);
  }
  if (kind !== "value") {
    itemFail(
      path,
      where,
      `unknown item kind ${JSON.stringify(kind)}; --in binds value items only ("kind": "value") — ${NO_GEOMETRY}`,
    );
  }
  for (const key of Object.keys(raw)) {
    if (!ITEM_KEYS.includes(key)) {
      itemFail(path, where, `unknown key ${JSON.stringify(key)}; a value item has: ${ITEM_KEYS.join(", ")}`);
    }
  }
  const value = raw.value;
  const legal =
    typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "string" ||
        typeof value === "boolean" ||
        (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v)));
  if (!legal) {
    itemFail(
      path,
      where,
      `"value" must be a number, a finite number array, a string or a boolean (DataValue), got ${JSON.stringify(value)}`,
    );
  }
  const tags = raw.tags;
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === "string"))) {
    itemFail(path, where, `"tags" must be an array of strings, got ${JSON.stringify(tags)}`);
  }
  return makeValueItem(
    value as number | readonly number[] | string | boolean,
    tags as readonly string[] | undefined,
  );
}

/**
 * Read `--in data.json` into per-pin item lists. The file is an object
 * keyed by EXPOSED INPUT PIN name — the primitive's public interface, not
 * its inner node ids — so a key naming something the primitive does not
 * expose is a hard error listing what it does.
 */
export function readInputBindings(
  io: CliIo,
  path: string,
  primitive: string,
  exposedInputs: readonly string[],
): readonly InputBinding[] {
  let text: string;
  try {
    text = io.readFile(path);
  } catch (err) {
    throw new CliError(
      `cannot read --in file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new CliError(
      `--in "${path}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isPlainObject(json)) {
    throw new CliError(
      `--in "${path}" must be an object keyed by exposed input pin, e.g. { "points": [ { "kind": "value", "value": 3.5 } ] }; got ${JSON.stringify(json)}`,
    );
  }
  if (exposedInputs.length === 0) {
    throw new CliError(
      `--in "${path}" has nothing to bind to: primitive "${primitive}" exposes no input pins, so it takes no incoming data`,
    );
  }
  const bindings: InputBinding[] = [];
  for (const [pin, raw] of Object.entries(json)) {
    if (!exposedInputs.includes(pin)) {
      throw new CliError(
        `--in "${path}": key "${pin}" is not an exposed input pin of primitive "${primitive}"; its input pins: ${exposedInputs.join(", ")}`,
      );
    }
    if (!Array.isArray(raw)) {
      throw new CliError(
        `--in "${path}": "${pin}" must be an array of data items, got ${JSON.stringify(raw)}`,
      );
    }
    bindings.push({
      pin,
      items: raw.map((item, i) => readItem(path, `"${pin}"[${i}]`, item)),
    });
  }
  return bindings;
}
