/**
 * Loading a graph from JSON and getting data out of it: the two steps
 * every feedback command shares. `inspect` and `render` can target any
 * node's output pin, not just a declared output, by declaring a temporary
 * one, cooking exactly that induced subgraph, and undeclaring it again —
 * so pointing the CLI at an interior node costs nothing structural and
 * leaves the graph as it was found.
 */
import {
  type CookOptions,
  type CookResult,
  type DataCollection,
  type Graph,
  cook,
  deserializeGraph,
} from "../index.js";
import { CliError } from "./errors.js";
import type { CliIo } from "./io.js";

/** A graph read from disk, with the parsed JSON it came from. */
export interface LoadedGraph {
  readonly graph: Graph;
  readonly json: Record<string, unknown>;
  readonly path: string;
}

/**
 * Read and deserialize a graph file. File and JSON problems are named by
 * the CLI (it knows the path); everything the library rejects propagates
 * with the library's own message.
 */
export function loadGraph(io: CliIo, path: string): LoadedGraph {
  let text: string;
  try {
    text = io.readFile(path);
  } catch (err) {
    throw new CliError(
      `cannot read graph file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let json: unknown;
  try {
    // Editors and PowerShell redirection write UTF-8 with a BOM; JSON.parse
    // rejects it with a message about an invisible character, which is a
    // uselessly confusing way to fail on a file that is otherwise fine.
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new CliError(
      `"${path}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const graph = deserializeGraph(json);
  return { graph, json: json as Record<string, unknown>, path };
}

/** Where a command should read data from. */
export interface TargetOptions {
  /** Node id to read an output pin from; omit to use declared outputs. */
  readonly node?: string;
  /** Output pin on `node`; omit to use its first output pin. */
  readonly pin?: string;
  /** Declared output name to read; omit to take every declared output. */
  readonly output?: string;
}

/** What a target resolved to, and the data it produced. */
export interface Target {
  /** Human label, e.g. `node "scatter_0" pin "out"` or `output "points"`. */
  readonly label: string;
  readonly collection: DataCollection;
  readonly result: CookResult;
}

/**
 * Output pins of a node instance. Reads the live node state rather than
 * the registry because subgraph nodes derive their pins per instance from
 * the exposed inner pins — the registry entry declares none.
 */
function outputPins(graph: Graph, nodeId: string): readonly string[] {
  const state = graph._nodes.get(nodeId);
  if (state === undefined) {
    const ids = [...graph._nodes.keys()];
    throw new CliError(
      `unknown node "${nodeId}"; nodes in this graph: ${ids.length === 0 ? "(none)" : ids.join(", ")}`,
    );
  }
  return state.def.outputs.map((pin) => pin.name);
}

/** Resolve `--node`/`--pin` to a concrete pin, naming the alternatives on a miss. */
export function resolvePin(graph: Graph, nodeId: string, pin?: string): string {
  const pins = outputPins(graph, nodeId);
  if (pins.length === 0) {
    throw new CliError(`node "${nodeId}" has no output pins, so there is nothing to read from it`);
  }
  if (pin === undefined) return pins[0];
  if (!pins.includes(pin)) {
    throw new CliError(
      `node "${nodeId}" has no output pin "${pin}"; its output pins: ${pins.join(", ")}`,
    );
  }
  return pin;
}

/** A temporary output name that cannot collide with a declared one. */
function tempOutputName(graph: Graph): string {
  const declared = new Set(graph.describe().outputs.map((o) => o.name));
  let name = "__pcg_cli";
  for (let n = 1; declared.has(name); n++) name = `__pcg_cli_${n}`;
  return name;
}

/**
 * Cook the requested target and return its collection. With `node`, a
 * temporary output is declared, cooked alone (so only its upstream
 * subgraph runs), and removed again — including when the cook throws.
 */
export async function cookTarget(
  graph: Graph,
  target: TargetOptions,
  opts: CookOptions = {},
): Promise<Target> {
  if (target.node !== undefined) {
    const pin = resolvePin(graph, target.node, target.pin);
    const name = tempOutputName(graph);
    graph.output({ id: target.node }, pin, name);
    try {
      const result = await cook(graph, { ...opts, outputs: [name] });
      return {
        label: `node "${target.node}" pin "${pin}"`,
        collection: result.outputs[name] ?? [],
        result,
      };
    } finally {
      graph.removeOutput(name);
    }
  }

  const declared = graph.describe().outputs;
  if (declared.length === 0) {
    throw new CliError(
      'this graph declares no outputs; add one to the JSON ("outputs": [{ "id": ..., "pin": ..., "name": ... }]) or target a node directly with --node <id>',
    );
  }
  if (target.output !== undefined) {
    if (!declared.some((o) => o.name === target.output)) {
      throw new CliError(
        `unknown output "${target.output}"; declared outputs: ${declared.map((o) => o.name).join(", ")}`,
      );
    }
    const result = await cook(graph, { ...opts, outputs: [target.output] });
    return {
      label: `output "${target.output}"`,
      collection: result.outputs[target.output] ?? [],
      result,
    };
  }
  const result = await cook(graph, opts);
  const collection = declared.flatMap((o) => result.outputs[o.name] ?? []);
  return {
    label: declared.length === 1 ? `output "${declared[0].name}"` : "all declared outputs",
    collection,
    result,
  };
}
