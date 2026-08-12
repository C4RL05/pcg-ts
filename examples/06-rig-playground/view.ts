/**
 * Shared types between the host (main.ts) and the Svelte panel: the host
 * pushes immutable view snapshots through the bridge, the panel calls
 * back through `PanelHost`. Same split as 04-gpu-fields.
 *
 * The control layout lives here as DATA rather than as markup in the
 * panel. Fifty knobs written out by hand is fifty chances for a label, a
 * range and a param name to disagree; as a list, adding a knob is one
 * line and the panel never changes.
 *
 * The spec types themselves are `../shared/controls.js` — this file only
 * says which knobs this demo has. Everything that knows how a slider
 * looks lives in `../shared/Controls.svelte`.
 */
import type { ControlSection } from "../shared/controls.js";
import { PART_KINDS, RIG_GROUPS, type PartKind, type RigGroup, type RigParams } from "./rig.js";

/** How the geometry is shaded. Both are unlit — there are no lights. */
export type Shading = "normal" | "flat";

export const SHADING_LABEL: Record<Shading, string> = {
  normal: "normal (form)",
  flat: "flat by type",
};

/**
 * Numbers that change how an asset's GEOMETRY IS BUILT rather than where
 * the graph puts it. They are named apart from RigParams because they
 * never reach the graph: turning one rebuilds the asset map and
 * re-instances the meshes, and the cook is untouched.
 */
export type DisplayKey = "linkWidth" | "linkThickness";

export const DISPLAY_KEYS: readonly DisplayKey[] = ["linkWidth", "linkThickness"];

/**
 * Everything the panel's controls bind to, flattened into one record.
 * The knobs have three different destinations behind the panel — graph
 * params, asset proportions, view state — but a control names a key and
 * nothing else, so the routing is the panel's job (`commit` in
 * Panel.svelte) and the spec stays plain data.
 */
export type RigControls = RigParams & {
  [K in DisplayKey]: number;
} & {
  shading: Shading;
  wireframe: boolean;
  grid: boolean;
  visible: Record<RigGroup, boolean>;
};

/** Numeric params a slider can drive (everything but `weights`). */
export type NumericParam = {
  [K in keyof RigParams]: RigParams[K] extends number ? K : never;
}[keyof RigParams];

/** Params a slider cannot drive: a choice from a fixed set. */
export type EnumParam = {
  [K in keyof RigParams]: RigParams[K] extends string ? K : never;
}[keyof RigParams];

/** Highest weight a part kind can carry. 0 drops it from the mix. */
const MAX_WEIGHT = 8;

/** Group visibility labels, in draw order. */
export const GROUP_LABEL: Record<RigGroup, string> = {
  chains: "chains",
  truss: "chords",
  braces: "braces",
  frames: "frames",
  wraps: "wraps",
  parts: "components",
  danglers: "danglers",
  drapes: "drapes",
};

/**
 * Every noise gets the same three knobs. `variant` is the one worth
 * explaining in the UI: noise is a pure function of its own seed and the
 * sample position, so it does NOT move when the graph seed moves —
 * variant is what re-rolls one shape while every other number holds
 * still. The library's own primitives expose exactly this knob for
 * exactly this reason.
 *
 * The last section is `display`, which is why the panel can render this
 * one list as its whole tab strip: a tab is a section title.
 */
export const CONTROL_SECTIONS: readonly ControlSection<RigControls>[] = [
  {
    title: "spine",
    controls: [
      { kind: "slider", key: "span", label: "span", min: 8, max: 60, step: 1, unit: "m" },
      { kind: "slider", key: "height", label: "height", min: 2, max: 14, step: 0.1, unit: "m" },
      { kind: "slider", key: "wanderV", label: "wander ↕", min: 0, max: 8, step: 0.1, unit: "m" },
      { kind: "slider", key: "wanderH", label: "wander ↔", min: 0, max: 12, step: 0.1, unit: "m" },
      { kind: "slider", key: "wanderFreq", label: "wander noise freq", min: 0.005, max: 0.3, step: 0.005 },
      { kind: "slider", key: "wanderOctaves", label: "wander octaves", min: 1, max: 6, step: 1 },
      { kind: "slider", key: "wanderVariant", label: "wander variant", min: 0, max: 20, step: 1 },
      { kind: "slider", key: "spineSamples", label: "samples", min: 20, max: 400, step: 5 },
    ],
  },
  {
    title: "truss",
    controls: [
      { kind: "slider", key: "trussWidth", label: "width", min: 0.2, max: 3, step: 0.05, unit: "m" },
      { kind: "slider", key: "trussStations", label: "bays", min: 2, max: 160, step: 1 },
      { kind: "slider", key: "trussChord", label: "chord radius", min: 0.01, max: 0.2, step: 0.005, unit: "m" },
      { kind: "slider", key: "trussBrace", label: "brace radius", min: 0.005, max: 0.12, step: 0.005, unit: "m" },
      { kind: "slider", key: "trussFrameEvery", label: "frame every", min: 0, max: 20, step: 1, unit: " bays" },
    ],
  },
  {
    title: "components",
    controls: [
      {
        kind: "numberGrid",
        key: "weights",
        note: "mix — relative weights, 0 disables",
        items: PART_KINDS.map((kind: PartKind) => ({ item: kind, label: kind })),
        min: 0,
        max: MAX_WEIGHT,
        step: 1,
      },
      { kind: "slider", key: "partDensity", label: "density", min: 20, max: 3000, step: 20 },
      { kind: "slider", key: "clusterFreq", label: "cluster noise freq", min: 0.5, max: 40, step: 0.5 },
      { kind: "slider", key: "clusterOctaves", label: "cluster octaves", min: 1, max: 6, step: 1 },
      { kind: "slider", key: "clusterVariant", label: "cluster variant", min: 0, max: 20, step: 1 },
      { kind: "slider", key: "clusterThreshold", label: "cluster cut", min: 0, max: 1, step: 0.01 },
      { kind: "slider", key: "radialSpread", label: "radial fan", min: 0, max: 1, step: 0.02, unit: "turn" },
      { kind: "slider", key: "scatterJitter", label: "scatter", min: 0, max: 4, step: 0.05, unit: "×gap" },
      { kind: "slider", key: "partMount", label: "mount to chord", min: 0, max: 1.4, step: 0.05 },
      { kind: "slider", key: "partSize", label: "size", min: 0.2, max: 3, step: 0.05, unit: "x" },
      { kind: "slider", key: "sizeJitter", label: "size jitter", min: 0, max: 0.9, step: 0.05 },
    ],
  },
  {
    title: "suspension",
    controls: [
      { kind: "slider", key: "chainCount", label: "chains", min: 0, max: 40, step: 1 },
      { kind: "slider", key: "ceilingHeight", label: "ceiling", min: 4, max: 30, step: 0.5, unit: "m" },
      { kind: "slider", key: "chainLinks", label: "links per chain", min: 2, max: 80, step: 1 },
    ],
  },
  {
    title: "wraps",
    controls: [
      { kind: "slider", key: "wrapCount", label: "cables", min: 0, max: 120, step: 1 },
      { kind: "slider", key: "wrapRadius", label: "tightest", min: 0.6, max: 3, step: 0.05, unit: "×corner" },
      { kind: "slider", key: "wrapSlack", label: "loosest extra", min: 0, max: 6, step: 0.1, unit: "×corner" },
      { kind: "slider", key: "wrapTurnsMin", label: "turns min", min: 0, max: 8, step: 0.1 },
      { kind: "slider", key: "wrapTurnsMax", label: "turns max", min: 0, max: 20, step: 0.5 },
      { kind: "slider", key: "wrapWobble", label: "wobble", min: 0, max: 2, step: 0.05, unit: "m" },
      { kind: "slider", key: "wrapSegments", label: "wrap segments", min: 8, max: 400, step: 2 },
      { kind: "slider", key: "wrapVariant", label: "wrap variant", min: 0, max: 20, step: 1 },
    ],
  },
  {
    title: "cables",
    controls: [
      {
        kind: "select",
        key: "drapeMode",
        label: "drape net",
        options: [
          { value: "radius", label: "radius — every near pair" },
          { value: "relativeNeighborhood", label: "relative neighbourhood" },
        ],
      },
      { kind: "slider", key: "danglerCount", label: "danglers", min: 0, max: 600, step: 5 },
      { kind: "slider", key: "danglerBundle", label: "bundling", min: 0, max: 1, step: 0.02 },
      { kind: "slider", key: "danglerBundleFreq", label: "bundle count", min: 1, max: 30, step: 1 },
      { kind: "slider", key: "danglerLength", label: "drop", min: 0.2, max: 10, step: 0.1, unit: "m" },
      { kind: "slider", key: "danglerSegments", label: "dangler segments", min: 2, max: 64, step: 1 },
      { kind: "slider", key: "dropVariation", label: "drop variation", min: 0, max: 0.95, step: 0.05 },
      { kind: "slider", key: "danglerCurl", label: "curl", min: 0, max: 3, step: 0.05, unit: "m" },
      { kind: "slider", key: "curlFreq", label: "curl noise freq", min: 0.02, max: 3, step: 0.02 },
      { kind: "slider", key: "curlOctaves", label: "curl octaves", min: 1, max: 5, step: 1 },
      { kind: "slider", key: "curlVariant", label: "cable variant", min: 0, max: 20, step: 1 },
      { kind: "slider", key: "drapeCount", label: "drape anchors", min: 0, max: 120, step: 2 },
      { kind: "slider", key: "drapeReach", label: "drape reach", min: 1, max: 20, step: 0.5, unit: "m" },
      { kind: "slider", key: "drapeMinLength", label: "drop chords under", min: 0, max: 20, step: 0.25, unit: "m" },
      { kind: "slider", key: "drapeKeep", label: "hang fraction", min: 0, max: 1, step: 0.02 },
      { kind: "slider", key: "drapeSlack", label: "slack", min: 0, max: 2, step: 0.05 },
      { kind: "slider", key: "drapeSegments", label: "drape segments", min: 2, max: 64, step: 1 },
      { kind: "slider", key: "slackJitter", label: "slack variation", min: 0, max: 1, step: 0.05 },
      { kind: "slider", key: "cableRadius", label: "cable radius", min: 0.005, max: 0.2, step: 0.005, unit: "m" },
    ],
  },
  {
    title: "display",
    controls: [
      {
        kind: "select",
        key: "shading",
        label: "shading",
        // The label map's own keys are the option list, so the select can
        // never drift from the type.
        options: (Object.keys(SHADING_LABEL) as Shading[]).map((value) => ({
          value,
          label: SHADING_LABEL[value],
        })),
      },
      {
        kind: "flags",
        label: "draw",
        items: [
          { key: "wireframe", label: "wireframe" },
          { key: "grid", label: "grid" },
        ],
      },
      // Both are fractions of a link's LENGTH, which is itself set by the
      // chain segment it spans — so a link keeps its proportions whatever
      // the chain length or link count. They rebuild an asset rather than
      // recooking, which is cheap enough to follow the thumb.
      { kind: "slider", key: "linkWidth", label: "link width", min: 0.2, max: 1, step: 0.02, live: true },
      { kind: "slider", key: "linkThickness", label: "link thickness", min: 0.01, max: 0.2, step: 0.005, live: true },
      {
        kind: "flagGrid",
        key: "visible",
        label: "show",
        items: RIG_GROUPS.map((group: RigGroup) => ({ item: group, label: GROUP_LABEL[group] })),
      },
    ],
  },
];

/** Snapshot the host pushes into the panel after every state change. */
export interface PanelView {
  params: RigParams;
  shading: Shading;
  wireframe: boolean;
  grid: boolean;
  visible: Record<RigGroup, boolean>;
  display: Record<DisplayKey, number>;
  cooking: boolean;
  fps: string;
  /** Instances per group, plus `spinePoints`. */
  counts: Record<string, number>;
  total: number;
  cookMs: number;
  drawCalls: number;
  /** Set when the component branch would draw nothing. */
  notice?: string;
  error?: string;
}

/** Control callbacks the panel invokes on the host. */
export interface PanelHost {
  setNumber(key: NumericParam, value: number): void;
  setChoice(key: EnumParam, value: string): void;
  setWeight(kind: PartKind, weight: number): void;
  setSeed(seed: number): void;
  setShading(shading: Shading): void;
  setWireframe(on: boolean): void;
  setGrid(on: boolean): void;
  setVisible(group: RigGroup, on: boolean): void;
  setDisplayNumber(key: DisplayKey, value: number): void;
}

/** The panel assigns `publish` on mount; the host calls it to update. */
export interface PanelBridge {
  publish?: (view: PanelView) => void;
}
