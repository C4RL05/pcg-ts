/// <reference types="vite/client" />
/**
 * Turn a graph's params into a control panel.
 *
 * A loaded graph already carries its knobs: every subgraph node exposes
 * named params with a resolved {@link ParamSchema}, and that schema says
 * enough to render a widget — type, bounds, enum values, description. So
 * the panel needs no authoring to exist at all, and with none it shows
 * exactly those. A spec may additionally name any standard node's params,
 * which is how a graph built from plain nodes gets a panel.
 *
 * WHAT AUTHORING BUYS. Of the 126 params the shipped primitives expose,
 * seven declare both a min and a max. A panel derived from schemas alone
 * is therefore mostly typed boxes, which is honest but not tunable: you
 * cannot feel your way to a good value by dragging a number field. A
 * panel spec supplies exactly what the schema cannot know — a range worth
 * dragging, a human label, a unit, an order, a grouping, and which knobs
 * matter enough to show at all.
 *
 * WHY IT IS A SIDECAR. Labels and slider ranges are presentation, not
 * graph semantics: the same graph cooks identically without them. Keeping
 * them out of the serialized graph keeps that format about generation,
 * and means a panel can be added to, or dropped from, any corpus graph
 * without rewriting it.
 *
 * They live in `examples/graphs/panels/`, NOT beside the graphs: the
 * corpus loader (`src/docs/examples.ts`) takes every file in
 * `examples/graphs/` whose name starts with a corpus prefix as a graph,
 * and would try to deserialize a panel spec as one.
 */
import type { ParamSchema } from "pcg-ts";
import type { Control, ControlSection, ControlValue } from "./controls.js";

/** One authored row. `param` names the knob; the rest is presentation. */
export interface PanelControlSpec {
  /** `"<nodeId>.<paramName>"`, the same key {@link Knob.key} carries. */
  readonly param: string;
  readonly label?: string;
  /** Supplying both promotes a typed box to a slider. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface PanelSectionSpec {
  readonly title: string;
  readonly controls: readonly PanelControlSpec[];
}

export interface GraphPanelSpec {
  readonly sections: readonly PanelSectionSpec[];
}

const PANELS = import.meta.glob("../graphs/panels/*.json", { query: "?raw", import: "default" });

/** The panel spec for a corpus graph, or undefined when it has none. */
export async function loadPanelSpec(name: string): Promise<GraphPanelSpec | undefined> {
  const load = PANELS[`../graphs/panels/${name}.json`];
  if (load === undefined) return undefined;
  const parsed: unknown = JSON.parse((await load()) as string);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as GraphPanelSpec).sections)
  ) {
    throw new Error(`panel spec "${name}": expected an object with a "sections" array`);
  }
  return parsed as GraphPanelSpec;
}

/** One param of one node, as the controller reports it. */
export interface Knob {
  /** `"<nodeId>.<paramName>"` — unique within a graph, and the spec's handle. */
  readonly key: string;
  readonly node: string;
  /** The primitive's registered name, for the default section title. */
  readonly nodeLabel: string;
  readonly name: string;
  readonly schema: ParamSchema;
  readonly value: unknown;
  /** Holds a Field, so no constant widget can represent it. */
  readonly isField: boolean;
  /**
   * A subgraph's exposed param — a knob by construction. Standard-node
   * params are not, and appear only when a panel spec names one.
   */
  readonly exposed: boolean;
}

/** The flat record the renderer edits, keyed by {@link Knob.key}. */
export type KnobValues = Record<string, ControlValue>;

export interface KnobPanel {
  readonly sections: ControlSection<KnobValues>[];
  readonly values: KnobValues;
  /** Knobs no widget could represent, and why — never dropped silently. */
  readonly skipped: { key: string; reason: string }[];
  /** Spec rows naming a param this graph does not expose. */
  readonly unknown: string[];
  /** Whether the layout came from a spec or from the schemas. */
  readonly authored: boolean;
}

/**
 * A knob patch: what a graph's knobs were changed TO, keyed the same way
 * the panel keys them, plus `seed` when that moved.
 *
 * The baseline is the graph AS LOADED, not the primitives' schema
 * defaults. That is what makes a patch replayable by name: "open this
 * corpus graph, then turn these" is a complete instruction, where "these
 * differ from the primitive's defaults" would silently also undo whatever
 * the graph's author had tuned.
 *
 * Knob keys always contain a dot (`<nodeId>.<param>`), so the bare `seed`
 * key cannot collide with one.
 */
export type KnobPatch = Record<string, ControlValue>;

/** Whether two control values are the same, comparing vectors elementwise. */
function sameValue(a: ControlValue | undefined, b: ControlValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  return Object.is(a, b);
}

/** Everything in `values` that differs from `baseline`. */
export function knobPatch(
  values: KnobValues,
  baseline: KnobValues,
  seed?: { current: number; loaded: number },
): KnobPatch {
  const patch: KnobPatch = {};
  if (seed !== undefined && seed.current !== seed.loaded) patch.seed = seed.current;
  for (const [key, value] of Object.entries(values)) {
    if (!sameValue(value, baseline[key])) patch[key] = value;
  }
  return patch;
}

/** Step for a slider spanning [min, max]: ~200 stops, rounded to a decade. */
function stepFor(schema: ParamSchema, min: number, max: number): number {
  if (schema.type === "i32" || schema.type === "u32") return 1;
  const span = Math.abs(max - min);
  if (!(span > 0)) return 0.01;
  const raw = span / 200;
  const decade = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const mult of [1, 2, 5]) {
    if (raw <= mult * decade) return mult * decade;
  }
  return 10 * decade;
}

/**
 * The widget for one knob. `spec` overrides what the schema cannot know;
 * a min/max pair from either source is what makes a slider.
 */
function controlFor(knob: Knob, spec?: PanelControlSpec): Control<KnobValues> | undefined {
  const key = knob.key;
  const label = spec?.label ?? knob.name;
  const schema = knob.schema;
  const min = spec?.min ?? schema.min;
  const max = spec?.max ?? schema.max;

  switch (schema.type) {
    case "f32":
    case "i32":
    case "u32": {
      if (min !== undefined && max !== undefined) {
        return {
          kind: "slider",
          key,
          label,
          min,
          max,
          step: spec?.step ?? stepFor(schema, min, max),
          ...(spec?.unit !== undefined ? { unit: spec.unit } : {}),
        };
      }
      // An integer param steps by 1 unless the spec says otherwise; a
      // float box stays unquantised ("any").
      const step = spec?.step ?? (schema.type === "f32" ? undefined : 1);
      return {
        kind: "number",
        key,
        label,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
        ...(spec?.unit !== undefined ? { unit: spec.unit } : {}),
      };
    }
    case "bool":
      // The name goes in the row's label column like every other row; the
      // checkbox is the value, so it carries no text of its own.
      return { kind: "flags", label, items: [{ key, label: "" }] };
    case "enum":
      return {
        kind: "select",
        key,
        label,
        options: (schema.enum ?? []).map((value) => ({ value, label: value })),
      };
    case "string":
      return { kind: "text", key, label };
    case "vec3":
    case "vec4":
      return {
        kind: "vector",
        key,
        label,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(spec?.step !== undefined ? { step: spec.step } : {}),
      };
    default:
      // `items` is runtime-injected and never authored; `stringList` is
      // row-editing work the node inspector already does properly.
      return undefined;
  }
}

/**
 * Every knob's current value, whether or not a panel spec shows it.
 * The patch is computed against this rather than against the panel's own
 * values: a knob edited in the node inspector, or one the spec chose not
 * to surface, is still part of what the graph currently is.
 */
export function knobValues(knobs: readonly Knob[]): KnobValues {
  const values: KnobValues = {};
  for (const knob of knobs) {
    if (knob.isField) continue;
    const value = valueOf(knob);
    if (value !== undefined) values[knob.key] = value;
  }
  return values;
}

function valueOf(knob: Knob): ControlValue | undefined {
  const v = knob.value;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return [...(v as number[])];
  return undefined;
}

/**
 * Build the panel. Without a spec every knob is shown, grouped by the
 * node that exposes it — usable immediately on any graph, and the thing
 * an author edits down into a spec.
 */
export function buildKnobPanel(knobs: readonly Knob[], spec?: GraphPanelSpec): KnobPanel {
  const values: KnobValues = {};
  const skipped: { key: string; reason: string }[] = [];
  const unknown: string[] = [];
  const byKey = new Map(knobs.map((k) => [k.key, k]));

  /** Register one knob's value; false when it cannot be shown. */
  const admit = (knob: Knob): boolean => {
    if (knob.isField) {
      skipped.push({ key: knob.key, reason: "holds a field — edit it in the node inspector" });
      return false;
    }
    const value = valueOf(knob);
    if (value === undefined) {
      skipped.push({ key: knob.key, reason: `no widget for ${knob.schema.type}` });
      return false;
    }
    values[knob.key] = value;
    return true;
  };

  if (spec !== undefined) {
    const sections: ControlSection<KnobValues>[] = [];
    for (const section of spec.sections) {
      const controls: Control<KnobValues>[] = [];
      for (const row of section.controls) {
        const knob = byKey.get(row.param);
        if (knob === undefined) {
          unknown.push(row.param);
          continue;
        }
        if (!admit(knob)) continue;
        const control = controlFor(knob, row);
        if (control === undefined) {
          skipped.push({ key: knob.key, reason: `no widget for ${knob.schema.type}` });
          delete values[knob.key];
          continue;
        }
        controls.push(control);
      }
      if (controls.length > 0) sections.push({ title: section.title, controls });
    }
    return { sections, values, skipped, unknown, authored: true };
  }

  const grouped = new Map<string, Control<KnobValues>[]>();
  const titles = new Map<string, string>();
  for (const knob of knobs) {
    // With no spec to curate, only the params a primitive's author chose
    // to expose. Every param of every node would bury them.
    if (!knob.exposed) continue;
    if (!admit(knob)) continue;
    const control = controlFor(knob);
    if (control === undefined) {
      skipped.push({ key: knob.key, reason: `no widget for ${knob.schema.type}` });
      delete values[knob.key];
      continue;
    }
    let list = grouped.get(knob.node);
    if (!list) {
      grouped.set(knob.node, (list = []));
      // The node id is what the canvas labels the box with, so it is what
      // connects a row here to a node over there; the primitive's name
      // says what it IS.
      titles.set(knob.node, knob.nodeLabel === "" ? knob.node : `${knob.node} · ${knob.nodeLabel}`);
    }
    list.push(control);
  }
  const sections = [...grouped.entries()].map(([node, controls]) => ({
    title: titles.get(node) ?? node,
    controls,
  }));
  return { sections, values, skipped, unknown, authored: false };
}
