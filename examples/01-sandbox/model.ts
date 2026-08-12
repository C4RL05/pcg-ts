/**
 * Editor-side view model for the graph editor. Node positions and pin
 * views are editor state only — the library's graph JSON never carries
 * them. Everything here is plain, structured-clone-safe data so it can
 * live inside Svelte `$state`; Fields and subgraph internals live on the
 * controller's live Graph.
 */
import { getNodeType, listNodeTypes, type NodeTypeInfo, type PinInfo } from "pcg-ts";

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
  /**
   * What the box is titled with, when that differs from `type` — a
   * subgraph node shows the primitive it references, because "subgraph"
   * is true of every one of them and so identifies none. `type` stays the
   * registered type name, since that is what the registry is keyed by.
   */
  label?: string;
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
 * Palette groups driven by the registry's `category` metadata: every
 * categorized type lands under its category name, categories ordered by
 * first registration. Uncategorized types (e.g. third-party
 * registrations, which may legally omit `category`) fall back to the old
 * pin-signature heuristic, clearly separated in trailing
 * `other · <bucket>` groups. The metadata-only `subgraph` composite is
 * excluded — instances exist only via import.
 */
export function paletteGroups(): PaletteGroup[] {
  const categorized = new Map<string, PaletteEntry[]>();
  const fallback = new Map<string, PaletteEntry[]>();
  const bucket = (info: NodeTypeInfo): string => {
    if (info.outputs.some((p) => p.kind === "instances")) return "spawners";
    if (info.outputs.length > 0 && info.outputs.every((p) => p.kind === "value")) return "values";
    if (info.inputs.length === 0) return "sources";
    return "operators";
  };
  const push = (groups: Map<string, PaletteEntry[]>, name: string, entry: PaletteEntry): void => {
    let list = groups.get(name);
    if (!list) groups.set(name, (list = []));
    list.push(entry);
  };
  for (const info of listNodeTypes()) {
    if (info.type === "subgraph") continue;
    const entry = { type: info.type, description: info.description };
    if (info.category !== undefined) push(categorized, info.category, entry);
    else push(fallback, `other · ${bucket(info)}`, entry);
  }
  return [...categorized.entries(), ...fallback.entries()].map(([name, entries]) => ({
    name,
    entries,
  }));
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
