/**
 * Editor-side view model for the graph editor. Node positions and pin
 * views are editor state only — the library's graph JSON never carries
 * them. Everything here is plain, structured-clone-safe data so it can
 * live inside Svelte `$state`; Fields and subgraph payloads stay in the
 * controller.
 */
import {
  getNodeType,
  hasNodeType,
  listNodeTypes,
  type NodeTypeInfo,
  type PinInfo,
  type SerializedGraph,
  type SerializedNode,
  type SerializedOutput,
} from "pcg-ts";

/** One pin as the canvas renders it. */
export interface PinView {
  readonly name: string;
  readonly kind: string;
  readonly multi: boolean;
}

/** One node box on the canvas. Position is editor-only state. */
export interface NodeView {
  id: string;
  type: string;
  x: number;
  y: number;
  inputs: PinView[];
  outputs: PinView[];
}

/** One connection in the editor model (mirrors a graph connection). */
export interface EdgeView {
  from: string;
  fromPin: string;
  to: string;
  toPin: string;
}

/** The whole editable structure (params live in the controller). */
export interface StructureModel {
  seed: number;
  nodes: NodeView[];
  edges: EdgeView[];
}

/** One palette row. */
export interface PaletteEntry {
  readonly type: string;
  readonly description: string;
}

/** One palette section. */
export interface PaletteGroup {
  readonly name: string;
  readonly entries: PaletteEntry[];
}

function pinViews(pins: readonly PinInfo[]): PinView[] {
  return pins.map((p) => ({ name: p.name, kind: p.kind, multi: p.multi }));
}

/** Pin views for a registered node type. */
export function nodePinsForType(type: string): { inputs: PinView[]; outputs: PinView[] } {
  const info = getNodeType(type).info;
  return { inputs: pinViews(info.inputs), outputs: pinViews(info.outputs) };
}

/**
 * Pin views for a serialized node. Standard types read the registry;
 * `subgraph` nodes derive per-instance pins from their payload's exposed
 * pin mappings (kind looked up on the inner node when it is a registered
 * standard type, otherwise `any`).
 */
export function pinsFromSerializedNode(sn: SerializedNode): {
  inputs: PinView[];
  outputs: PinView[];
} {
  if (sn.type !== "subgraph") return nodePinsForType(sn.type);
  const payload = sn.subgraph;
  if (!payload) return { inputs: [], outputs: [] };
  const kindOf = (graph: SerializedGraph, nodeId: string, pin: string, side: "in" | "out"): string => {
    const inner = graph.nodes.find((n) => n.id === nodeId);
    if (!inner || inner.type === "subgraph" || !hasNodeType(inner.type)) return "any";
    const info = getNodeType(inner.type).info;
    const pins = side === "in" ? info.inputs : info.outputs;
    return pins.find((p) => p.name === pin)?.kind ?? "any";
  };
  return {
    inputs: payload.inputs.map((e) => ({
      name: e.name,
      kind: kindOf(payload.graph, e.node, e.pin, "in"),
      multi: false,
    })),
    outputs: payload.outputs.map((e) => ({
      name: e.name,
      kind: kindOf(payload.graph, e.node, e.pin, "out"),
      multi: false,
    })),
  };
}

/**
 * Palette groups derived from registry pin metadata (the registry has no
 * category field, so grouping is a pin-signature heuristic): spawners
 * emit instances, values emit only value items, sources have no inputs,
 * everything else is an operator. The metadata-only `subgraph` composite
 * is excluded — instances exist only via import.
 */
export function paletteGroups(): PaletteGroup[] {
  const groups: Record<string, PaletteEntry[]> = {
    sources: [],
    operators: [],
    spawners: [],
    values: [],
  };
  const bucket = (info: NodeTypeInfo): string => {
    if (info.outputs.some((p) => p.kind === "instances")) return "spawners";
    if (info.outputs.length > 0 && info.outputs.every((p) => p.kind === "value")) return "values";
    if (info.inputs.length === 0) return "sources";
    return "operators";
  };
  for (const info of listNodeTypes()) {
    if (info.type === "subgraph") continue;
    groups[bucket(info)].push({ type: info.type, description: info.description });
  }
  return Object.entries(groups)
    .filter(([, entries]) => entries.length > 0)
    .map(([name, entries]) => ({ name, entries }));
}

/** First free `type_N` id (deterministic counter, no randomness). */
export function allocateId(type: string, used: ReadonlySet<string>): string {
  let n = 0;
  let id = `${type}_${n}`;
  while (used.has(id)) {
    n++;
    id = `${type}_${n}`;
  }
  return id;
}

/**
 * Automatic terminal outputs: every output pin with no outgoing edge is
 * declared as a graph output named `<nodeId>.<pin>`. Deterministic in
 * model order, so an export → import round trip re-derives the same set.
 */
export function autoOutputs(model: StructureModel): SerializedOutput[] {
  const outs: SerializedOutput[] = [];
  for (const node of model.nodes) {
    for (const pin of node.outputs) {
      const connected = model.edges.some((e) => e.from === node.id && e.fromPin === pin.name);
      if (!connected) outs.push({ id: node.id, pin: pin.name, name: `${node.id}.${pin.name}` });
    }
  }
  return outs;
}

/**
 * Starter graph, expressed in the library's serialized format and loaded
 * through the same import path as pasted JSON: scatter in bounds → jitter
 * by an fbm field → orient +y along a noise flow field → spawn cones.
 */
export const STARTER_GRAPH_TEXT: string = JSON.stringify(
  {
    formatVersion: 1,
    seed: 1,
    nodes: [
      {
        id: "scatter",
        type: "pointScatterInBounds",
        params: { count: 350, boundsMin: [-12, 0, -12], boundsMax: [12, 0, 12], seed: 0 },
      },
      {
        id: "jitter",
        type: "jitterPoints",
        params: {
          amount: {
            fn: "mul",
            args: [
              {
                fn: "remap",
                args: [
                  { fn: "fbm", base: "perlinNoise", opts: { frequency: 0.18, octaves: 4 } },
                  -1, 1, 0, 1,
                ],
              },
              1.4,
            ],
          },
          seed: 0,
        },
      },
      {
        id: "orient",
        type: "orientAlongVector",
        params: {
          direction: {
            fn: "normalize",
            args: [
              {
                fn: "vec",
                args: [
                  { fn: "perlinNoise", opts: { frequency: 0.15 } },
                  0.9,
                  { fn: "perlinNoise", opts: { frequency: 0.15, offset: [37.7, 11.3, 0] } },
                ],
              },
            ],
          },
          up: [0, 1, 0],
          axis: "+y",
        },
      },
      { id: "spawn", type: "spawnInstances", params: { assetId: "cone", assetAttr: "" } },
    ],
    connections: [
      { from: ["scatter", "out"], to: ["jitter", "in"] },
      { from: ["jitter", "out"], to: ["orient", "in"] },
      { from: ["orient", "out"], to: ["spawn", "in"] },
    ],
    outputs: [
      { id: "spawn", pin: "instances", name: "spawn.instances" },
      { id: "spawn", pin: "points", name: "spawn.points" },
    ],
  },
  null,
  2,
);
