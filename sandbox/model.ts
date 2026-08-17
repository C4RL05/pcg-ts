/**
 * Editor-side view model for the graph editor. Node positions and pin
 * views are editor state only — the library's graph JSON never carries
 * them. Everything here is plain, structured-clone-safe data so it can
 * live inside Svelte `$state`; Fields and subgraph internals live on the
 * controller's live Graph.
 */
import { getNodeType, listNodeTypes, type NodeTypeInfo, type PinInfo } from "pcg-ts";
// Type-only, so it is erased: controller.ts imports this module at
// runtime, and a value import back would close the cycle.
import type { ParamView } from "./controller.js";

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
  /**
   * The registry category this node's type belongs to, which the box
   * draws as an icon. Copied onto the view rather than looked up while
   * rendering: the box is redrawn on every pointermove of a drag, and the
   * category cannot change for the life of the node — the type is fixed
   * at creation. `undefined` for a type that declares none (third-party
   * registrations may legally omit it), and the box then draws no icon.
   */
  category?: string;
  x: number;
  y: number;
  inputs: PinView[];
  outputs: PinView[];
}

/**
 * One param as a node box shows it: a short name and a shorter value.
 *
 * The boxes used to be a type, an id and a row of pins — the same picture
 * whether `count` was 350 or 350000. Everything that distinguishes one
 * scatter from another was a click away in the inspector, so reading a
 * graph meant clicking through it node by node. These few characters per
 * box are what let you read the settings off the canvas instead.
 */
export interface ParamPreview {
  readonly key: string;
  readonly value: string;
  /**
   * The param is a Field rather than a constant. Marked because it is a
   * different KIND of answer, not a different value: a field is resolved
   * per point when it lands on a domain, so "0.4" and "ƒ fbm" are not two
   * settings of one knob.
   */
  readonly field: boolean;
}

/** Most rows a box shows before it stops naming them and counts instead. */
const PREVIEW_ROWS = 3;

/** Trim a rendered value to what fits the box at 9px monospace. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // Two places is enough to tell 2.5 from 2.75 and short enough that a
  // vec3 of them still fits the width.
  return String(Number(n.toFixed(2)));
}

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
 *
 * All of them when there are few, and the first few plus a count when
 * there are many — a box that listed twelve params would be taller than
 * the graph it is in, and the twelfth is not the one you were looking for.
 */
export function paramPreviews(views: readonly ParamView[]): ParamPreview[] {
  const shown = views.filter((v) => v.mode !== "items");
  const head = shown.length <= PREVIEW_ROWS + 1 ? shown : shown.slice(0, PREVIEW_ROWS);
  const rows: ParamPreview[] = head.map((v) => ({
    key: clip(v.key, 13),
    value: clip(fmtValue(v), 14),
    field: v.mode === "field",
  }));
  if (shown.length > head.length) {
    rows.push({ key: "", value: `+${shown.length - head.length} more`, field: false });
  }
  return rows;
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
 * The registry category of a node type, or `undefined` when it declares
 * none — which is legal, and which the canvas renders as no icon.
 *
 * Wrapped in a try rather than a registry membership test because
 * `getNodeType` THROWS for an unknown type, and the one caller that can
 * hand it an unknown one is the import path: a graph naming a type this
 * build does not have should fail on the type, with the library's own
 * message, not on the icon it would have drawn.
 */
export function nodeCategory(type: string): string | undefined {
  try {
    return getNodeType(type).info.category;
  } catch {
    return undefined;
  }
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
