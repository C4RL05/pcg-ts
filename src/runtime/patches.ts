/**
 * Applying serializable param patches (see `ParamPatch`) to a live graph.
 *
 * This is the ONE implementation of the `bindPatches` semantics: the
 * local fallback (a `World` without a pool) and the cook worker host both
 * call it, so a patch cannot mean one thing on the main thread and
 * another on a worker — byte-identity between the two paths starts here.
 */
import {
  GraphValidationError,
  getSubgraphSpec,
  liveParamValueError,
  type Graph,
  type NodeHandle,
  type ParamSchema,
} from "../graph/index.js";
import { fieldFromJson, type FieldSpec } from "../fields/fieldJson.js";
import { getNodeType, hasNodeType } from "../nodes/registry.js";
import type { ParamPatch } from "./types.js";

function fail(message: string): never {
  throw new GraphValidationError(message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The registered schema of one node param — from the node type registry
 * for standard nodes, from the instance's exposed params for subgraph
 * nodes. Errors name the node, the param, and what would be valid.
 */
function schemaFor(graph: Graph, patch: ParamPatch, where: string): ParamSchema {
  let state;
  try {
    state = graph.require(patch.node);
  } catch {
    fail(
      `${where}: unknown node "${patch.node}"; this graph has: ${[...graph._nodes.keys()].join(", ")}`,
    );
  }
  const spec = getSubgraphSpec(state.def);
  if (spec !== undefined) {
    const exposed = spec.params.find((p) => p.name === patch.param);
    if (exposed === undefined) {
      fail(
        `${where}: node "${patch.node}" exposes no param "${patch.param}"; exposed params: ${
          spec.params.map((p) => p.name).join(", ") || "(none)"
        }`,
      );
    }
    return exposed.schema;
  }
  const type = state.def.type;
  if (!hasNodeType(type)) {
    fail(
      `${where}: node "${patch.node}" has unregistered type "${type}"; patches resolve param schemas through the registry, so a patched graph must be built from registered node defs (the same rule serializeGraph applies)`,
    );
  }
  const reg = getNodeType(type);
  if (reg.def !== state.def) {
    fail(
      `${where}: node "${patch.node}" was not built from the registered "${type}" definition; build graphs from the registered node defs so patches (and serialization) can trust the registered schemas`,
    );
  }
  const schema = reg.info.params[patch.param];
  if (schema === undefined) {
    fail(
      `${where}: node "${patch.node}" (type "${type}") has no param "${patch.param}"; valid params: ${Object.keys(reg.info.params).join(", ")}`,
    );
  }
  return schema;
}

/**
 * Apply patches to `graph` in order via `graph.setParam`. Each value is
 * validated against the target param's registered schema first; on a
 * field-capable param a plain object is interpreted as a FieldSpec
 * (`fieldFromJson`), and a bare number on a field-capable vec param is
 * broadcast to the vec arity — the same two conveniences the graph JSON
 * reader and writer apply, so a value that serializes is a value that
 * patches.
 *
 * `items` params are refused: they hold live DataItems, which have no
 * plain-JSON form and cannot cross a worker boundary — a level that
 * injects items (e.g. parent-cell outputs through `dataInput`) binds them
 * with `LevelDef.bind` instead.
 *
 * Every rejected patch throws `GraphValidationError` naming the node, the
 * param, and the fix; nothing is applied silently. Patches that apply
 * bump the graph version exactly like the `setParam` calls they stand for.
 */
export function applyParamPatches(
  graph: Graph,
  patches: readonly ParamPatch[],
  where = "applyParamPatches",
): void {
  for (const patch of patches) {
    const schema = schemaFor(graph, patch, where);
    const at = `${where}: node "${patch.node}" param "${patch.param}"`;
    if (schema.type === "items") {
      fail(
        `${at}: "items" params hold live DataItems, which have no plain-JSON patch form; bind them in-place with LevelDef.bind (such a level cooks locally, not on a pool)`,
      );
    }
    let value = patch.value;
    if (schema.acceptsField === true && isPlainObject(value)) {
      try {
        value = fieldFromJson(value as FieldSpec);
      } catch (err) {
        fail(`${at}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Field-capable vec params accept a runtime-legal scalar broadcast;
      // canonicalize exactly the way serialization does.
      if (
        (schema.type === "vec3" || schema.type === "vec4") &&
        schema.acceptsField === true &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        value = new Array<number>(schema.type === "vec3" ? 3 : 4).fill(value);
      }
      // `liveParamValueError`, the rule `Graph.setParam` applies — NOT the
      // serialization rule.
      //
      // This used to be `paramValueError`, on the reasoning that "a patch
      // is JSON that must survive `postMessage`, and
      // `JSON.stringify(Infinity)` is `null`". The second half is true and
      // the first is not: a patch is never stringified. It rides
      // `postMessage`, which uses STRUCTURED CLONE, and structured clone
      // carries ±Infinity exactly — measured through a `MessageChannel`,
      // `[0, -Infinity, 0]` arrives as `[0, -Infinity, 0]` where
      // `JSON.stringify` would have made it `[0, null, 0]`.
      //
      // So the file rule was being applied to a transport that does not
      // need it, and the cost was specific: `filterByBounds` declares
      // `acceptsInfinite` for exactly the case a partitioned level wants —
      // a `halfOpen` ownership clip over an `xz` column, unbounded in Y —
      // and that, the CANONICAL partition recipe, was the one thing a
      // serializable bind could not express. A level written the textbook
      // way could not reach a worker pool.
      //
      // What a patch still may not carry is what the LIVE rule refuses,
      // and `items` above, which structured clone would happily copy but
      // which holds live handles a worker cannot use. A `CookBackend` that
      // transports patches by JSON text rather than by structured clone
      // must reject infinities itself; the contract already requires it to
      // produce bytes identical to a local cook, and a transport that
      // rewrites its inputs cannot.
      const bad = liveParamValueError(schema, value);
      if (bad !== undefined) fail(`${at}: ${bad}`);
      if (Array.isArray(value)) value = [...(value as unknown[])];
    }
    const handle: NodeHandle<Record<string, unknown>> = { id: patch.node };
    graph.setParam(handle, patch.param, value);
  }
}
