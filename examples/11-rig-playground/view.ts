/**
 * Shared types between the host (main.ts) and the Svelte panel: the host
 * pushes immutable view snapshots through the bridge, the panel calls
 * back through `PanelHost` on user input. Same split as 08-gpu-fields.
 *
 * The control layout lives here as DATA rather than as markup in the
 * panel. Eighteen knobs written out by hand is eighteen chances for a
 * label, a range and a param name to disagree; as a list, adding a knob
 * is one line and the panel never changes.
 */
import type { PartKind, RigGroup, RigParams } from "./rig.js";

/** How the geometry is shaded. Both are unlit — there are no lights. */
export type Shading = "normal" | "flat";

export const SHADING_LABEL: Record<Shading, string> = {
  normal: "normal (form)",
  flat: "flat by type",
};

/** Numeric params a slider can drive (everything but `weights`). */
export type NumericParam = {
  [K in keyof RigParams]: RigParams[K] extends number ? K : never;
}[keyof RigParams];

/** One slider: the param it drives and how it is presented. */
export interface SliderSpec {
  key: NumericParam;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Suffix shown after the value, e.g. "m". */
  unit?: string;
}

/** Params a slider cannot drive: a choice from a fixed set. */
export type EnumParam = {
  [K in keyof RigParams]: RigParams[K] extends string ? K : never;
}[keyof RigParams];

/** One select: the param it drives and the options it offers. */
export interface SelectSpec {
  key: EnumParam;
  label: string;
  options: readonly { value: string; label: string }[];
}

export interface Section {
  title: string;
  sliders: SliderSpec[];
  selects?: SelectSpec[];
}

/**
 * Every noise gets the same three knobs. `variant` is the one worth
 * explaining in the UI: noise is a pure function of its own seed and the
 * sample position, so it does NOT move when the graph seed moves —
 * variant is what re-rolls one shape while every other number holds
 * still. The library's own primitives expose exactly this knob for
 * exactly this reason.
 */
export const SECTIONS: readonly Section[] = [
  {
    title: "spine",
    sliders: [
      { key: "span", label: "span", min: 8, max: 60, step: 1, unit: "m" },
      { key: "height", label: "height", min: 2, max: 14, step: 0.1, unit: "m" },
      { key: "wanderV", label: "wander ↕", min: 0, max: 8, step: 0.1, unit: "m" },
      { key: "wanderH", label: "wander ↔", min: 0, max: 12, step: 0.1, unit: "m" },
      { key: "wanderFreq", label: "wander noise freq", min: 0.005, max: 0.3, step: 0.005 },
      { key: "wanderOctaves", label: "wander octaves", min: 1, max: 6, step: 1 },
      { key: "wanderVariant", label: "wander variant", min: 0, max: 20, step: 1 },
      { key: "spineRadius", label: "radius", min: 0.04, max: 0.6, step: 0.01, unit: "m" },
      { key: "spineSamples", label: "samples", min: 20, max: 400, step: 5 },
    ],
  },
  {
    title: "components",
    sliders: [
      { key: "partDensity", label: "density", min: 20, max: 3000, step: 20 },
      { key: "clusterFreq", label: "cluster noise freq", min: 0.5, max: 40, step: 0.5 },
      { key: "clusterOctaves", label: "cluster octaves", min: 1, max: 6, step: 1 },
      { key: "clusterVariant", label: "cluster variant", min: 0, max: 20, step: 1 },
      { key: "clusterThreshold", label: "cluster cut", min: 0, max: 1, step: 0.01 },
      { key: "radialSpread", label: "radial fan", min: 0, max: 1, step: 0.02, unit: "turn" },
      { key: "scatterJitter", label: "scatter", min: 0, max: 4, step: 0.05, unit: "×gap" },
      { key: "partSize", label: "size", min: 0.2, max: 3, step: 0.05, unit: "x" },
      { key: "sizeJitter", label: "size jitter", min: 0, max: 0.9, step: 0.05 },
    ],
  },
  {
    title: "suspension",
    sliders: [
      { key: "chainCount", label: "chains", min: 0, max: 40, step: 1 },
      { key: "ceilingHeight", label: "ceiling", min: 4, max: 30, step: 0.5, unit: "m" },
      { key: "chainLinks", label: "links per chain", min: 2, max: 80, step: 1 },
    ],
  },
  {
    title: "cables",
    selects: [
      {
        key: "drapeMode",
        label: "drape net",
        options: [
          { value: "radius", label: "radius — every near pair" },
          { value: "relativeNeighborhood", label: "relative neighbourhood" },
        ],
      },
    ],
    sliders: [
      { key: "danglerCount", label: "danglers", min: 0, max: 600, step: 5 },
      { key: "danglerBundle", label: "bundling", min: 0, max: 1, step: 0.02 },
      { key: "danglerBundleFreq", label: "bundle count", min: 1, max: 30, step: 1 },
      { key: "danglerLength", label: "drop", min: 0.2, max: 10, step: 0.1, unit: "m" },
      { key: "dropVariation", label: "drop variation", min: 0, max: 0.95, step: 0.05 },
      { key: "danglerCurl", label: "curl", min: 0, max: 3, step: 0.05, unit: "m" },
      { key: "curlFreq", label: "curl noise freq", min: 0.02, max: 3, step: 0.02 },
      { key: "curlOctaves", label: "curl octaves", min: 1, max: 5, step: 1 },
      { key: "curlVariant", label: "cable variant", min: 0, max: 20, step: 1 },
      { key: "drapeCount", label: "drape anchors", min: 0, max: 120, step: 2 },
      { key: "drapeReach", label: "drape reach", min: 1, max: 20, step: 0.5, unit: "m" },
      { key: "drapeMinLength", label: "drop chords under", min: 0, max: 20, step: 0.25, unit: "m" },
      { key: "drapeKeep", label: "hang fraction", min: 0, max: 1, step: 0.02 },
      { key: "drapeSlack", label: "slack", min: 0, max: 2, step: 0.05 },
      { key: "slackJitter", label: "slack variation", min: 0, max: 1, step: 0.05 },
      { key: "cableRadius", label: "cable radius", min: 0.005, max: 0.2, step: 0.005, unit: "m" },
    ],
  },
];

/** Group visibility labels, in draw order. */
export const GROUP_LABEL: Record<RigGroup, string> = {
  chains: "chains",
  spine: "spine",
  parts: "components",
  danglers: "danglers",
  drapes: "drapes",
};

/** Snapshot the host pushes into the panel after every state change. */
export interface PanelView {
  params: RigParams;
  shading: Shading;
  wireframe: boolean;
  grid: boolean;
  visible: Record<RigGroup, boolean>;
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
}

/** The panel assigns `publish` on mount; the host calls it to update. */
export interface PanelBridge {
  publish?: (view: PanelView) => void;
}
