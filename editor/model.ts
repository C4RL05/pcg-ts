/**
 * What only an EDITOR has, on top of the shared graph view model.
 *
 * The types and the drawing kit live in `shared/graph/` — the demos show
 * a graph too, read-only, and a second drawing of the same boxes would be
 * a second thing to keep in step. What is left here needs the editor to
 * mean anything: the palette (there is nothing to add a node to in a
 * read-only view), the id allocator, the starter graph, and the adapter
 * from the controller's live `ParamView` to the box's `ParamPreview`.
 */
import { listNodeTypes, type NodeTypeInfo } from "pcg-ts";
import {
  fmtNumber,
  previewRows,
  type ParamPreview,
  type PreviewRow,
} from "../shared/graph/view.js";
// Type-only, so it is erased: controller.ts imports this module at
// runtime, and a value import back would close the cycle.
import type { ParamView } from "./controller.js";

/**
 * The types the editor shares with the read-only view, re-exported so an
 * editor component names ONE module. They are defined in
 * `shared/graph/view.ts`; nothing may add a definition here.
 */
export type {
  EdgeView,
  NodeView,
  ParamPreview,
  PinView,
  PreviewRow,
  StructureModel,
} from "../shared/graph/view.js";
export { nodeCategory, nodePinsForType } from "../shared/graph/view.js";

/**
 * The three node types that wrap an inner graph. They serialize to the
 * same payload and reach the editor by the same route; only the cook
 * differs (`forEach` runs the body once per element, `repeatUntil` runs it
 * until a detail scalar says it settled), which is nothing this editor has
 * to know. Checking the SET rather than the word "subgraph" is what keeps a
 * wrapper from being treated as an ordinary registered node — whose
 * registry entry declares no pins and cannot cook. A wrapper missing from
 * here fails at import with "node <id> has no input pin <name>", because
 * the pins it is asked to connect are per-instance and the registry entry
 * has none, and it is OFFERED in the palette below, where dropping it
 * builds the metadata-only def and errors on the next cook.
 *
 * It lives here rather than in `controller.ts` because both files need it
 * and the import may only run one way: the controller imports this module
 * at runtime, so a value import back would close a cycle.
 */
export const WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "subgraph",
  "forEach",
  "repeatUntil",
]);

function fmtValue(view: ParamView): string {
  if (view.mode === "field") {
    /**
     * The EXPRESSION, clipped to the row. This used to dig the outermost
     * `"fn"` out of the pretty-printed JSON and show `ƒ mul`, which named
     * the root and said nothing about the rest; `specText` is printed
     * text now, so the row can carry the thing itself. A bare "ƒ" is left
     * for a spec the printer refused.
     */
    if (view.specText === null) return "ƒ";
    return `ƒ ${view.specText.replace(/\s+/g, " ")}`;
  }
  const v = view.value;
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "boolean") return String(v);
  // An en dash for "set to nothing", so an unset string param is a row
  // that reads as empty rather than a key with a blank where its value
  // should be — which looks like the box failed to render one.
  if (typeof v === "string") return v === "" ? "–" : v;
  if (Array.isArray(v)) {
    return v.length === 0
      ? "–"
      : v.map((x) => (typeof x === "number" ? fmtNumber(x) : String(x))).join(", ");
  }
  return v === undefined || v === null ? "–" : String(v);
}

/**
 * The rows one node box shows. `items` params are dropped: they are
 * runtime-injected DataItems with nothing to print, the same reason the
 * inspector renders them as a read-only note.
 */
export function paramPreviews(views: readonly ParamView[]): ParamPreview[] {
  const rows: PreviewRow[] = views
    .filter((v) => v.mode !== "items")
    .map((v) => ({ key: v.key, value: fmtValue(v), field: v.mode === "field" }));
  return previewRows(rows);
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


/**
 * Palette groups driven by the registry's `category` metadata: every
 * categorized type lands under its category name, categories ordered by
 * first registration. Uncategorized types (e.g. third-party
 * registrations, which may legally omit `category`) fall back to the old
 * pin-signature heuristic, clearly separated in trailing
 * `other · <bucket>` groups. The metadata-only wrapper composites are
 * excluded — every one of them declares no pins and cannot cook, so
 * instances exist only via import.
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
    if (WRAPPER_TYPES.has(info.type)) continue;
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
