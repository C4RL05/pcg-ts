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
 * WHERE THE SPEC FORMAT LIVES. `GraphPanelSpec` and its parts are NOT
 * declared here: they are published as `pcg-ts/panels`, and this module
 * re-exports them so its own consumers keep one import. The format used to
 * be declared in this file, which put it outside `src/` — reachable only
 * through this repo's Vite build, absent from `dist/`, and so unusable by
 * any host outside the repository. That made "panel specs already do
 * grouping and labels" a claim no integrator could act on. The types and
 * the validator moved; the RENDERING below did not, because turning a spec
 * into widgets is this repo's chrome, not the library's promise.
 *
 * WHY IT IS A SIDECAR. Labels and slider ranges are presentation, not
 * graph semantics: the same graph cooks identically without them. Keeping
 * them out of the serialized graph keeps that format about generation,
 * and means a panel can be added to, or dropped from, any corpus graph
 * without rewriting it.
 *
 * They live in `graphs/panels/`, NOT beside the graphs: the
 * corpus loader (`src/docs/graphIndex.ts`) takes every file in
 * `graphs/` whose name starts with a corpus prefix as a graph,
 * and would try to deserialize a panel spec as one.
 */
import type { ParamSchema } from "pcg-ts";
import { type GraphPanelSpec, type PanelControlSpec, parsePanelSpec } from "pcg-ts/panels";
import type { Control, ControlSection, ControlValue } from "./controls.js";

// Re-exported, not redeclared. The editor and the knob suites import the
// spec types from here beside `Knob` and `buildKnobPanel`, and a second
// declaration of a published format is the bug this move exists to remove
// — one definition, in `pcg-ts/panels`, reached by whichever path a caller
// already has.
export type { GraphPanelSpec, PanelControlSpec, PanelSectionSpec } from "pcg-ts/panels";

const PANELS = import.meta.glob("../graphs/panels/*.json", { query: "?raw", import: "default" });

/**
 * The panel spec for a corpus graph, or undefined when it has none.
 *
 * The Vite glob is what makes this repo-internal: it is resolved at BUILD
 * time against `graphs/panels/`, so this function can only ever answer for
 * the shipped corpus. A host outside the repo reads its own file and calls
 * {@link parsePanelSpec} directly — which is exactly what this does, rather
 * than casting, so a corpus panel and an integrator's panel are held to one
 * definition of the format.
 */
export async function loadPanelSpec(name: string): Promise<GraphPanelSpec | undefined> {
  const load = PANELS[`../graphs/panels/${name}.json`];
  if (load === undefined) return undefined;
  const text = (await load()) as string;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `panel spec "${name}.json" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parsePanelSpec(parsed, { source: `panel spec "${name}.json"` });
}

/**
 * Section title for knobs belonging to the graph rather than to a node.
 * Doubles as the grouping key, which is safe because a node id is a node
 * id and this is not one — the sigil the address uses for the same reason.
 */
const GRAPH_SECTION = "$graph";

/**
 * Everything a WRITE needs to find the slot: the node, the param on it,
 * and — when the knob addresses a literal inside that param's field
 * expression — which literal.
 *
 * Split out from {@link Knob} because the panel keeps a key → target map
 * and nothing else of a knob survives to the commit; carrying the parts is
 * what lets the key stay an opaque handle instead of a thing to re-split.
 */
export type KnobTarget = NodeKnobTarget | GraphKnobTarget;

/** A write that lands on one node's param. */
export interface NodeKnobTarget {
  readonly scope: "node";
  readonly node: string;
  /** The NODE param this knob writes — the field spec's own param when {@link NodeKnobTarget.fieldParam} is set. */
  readonly name: string;
  /**
   * Set when this knob addresses a `param` node carrying an inline value
   * INSIDE the field spec `name` holds, rather than `name` itself. Writing
   * it rewrites that literal in the spec and sets the rebuilt field.
   */
  readonly fieldParam?: string;
  /**
   * Set when a graph param with `targets` DRIVES this slot. The address is
   * still listed — the inspector should show what the node holds — but a
   * write to it is refused, because the declaration wins on load and a
   * disagreeing literal now makes the graph refuse to open.
   */
  readonly drivenBy?: string;
}

/**
 * A write that lands on the GRAPH: one declared value, fanned out by the
 * graph layer to every expression that reads its name. The panel does not
 * know or care which slots those are — that is the point of declaring it
 * once rather than mirroring it with `also`.
 */
export interface GraphKnobTarget {
  readonly scope: "graph";
  /** The declared name, without the address's `$`. */
  readonly name: string;
}

/**
 * One addressable param, as the controller reports it: a {@link KnobTarget}
 * (which of the two kinds of write it is) plus everything a panel needs to
 * render it.
 *
 * An intersection over the union rather than an interface extending it,
 * because `KnobTarget` is now two shapes — narrowing a Knob on `scope`
 * narrows its target half with it, which is what keeps the write path
 * honest.
 */
export type Knob = KnobTarget & KnobDisplay;

/** The presentation half of a {@link Knob}. */
export interface KnobDisplay {
  /**
   * `"<nodeId>.<paramName>"`, `"<nodeId>.<paramName>.<fieldParamName>"` for
   * a literal inside an expression, or `"$<name>"` for a graph-scoped param
   * — unique within a graph, and the spec's handle.
   *
   * NOTHING SPLITS IT. Every consumer looks a whole key up in a map built
   * from this list, and the parts each knob needs are the fields beside it,
   * so a node id containing dots stays addressable and the three-part shape
   * costs no parser. Where a key must be read apart, read it from the RIGHT:
   * a field-spec param name is dot-free (`fieldJson.ts` refuses one) and so
   * is a node param key (`standardNode` refuses one), so everything left
   * over is the node id.
   */
  readonly key: string;
  /** The primitive's registered name, for the default section title. */
  readonly nodeLabel: string;
  readonly schema: ParamSchema;
  readonly value: unknown;
  /** Holds a Field, so no constant widget can represent it. */
  readonly isField: boolean;
  /**
   * Declared tunable, so a panel with nothing else to go on shows it: a
   * subgraph's exposed param, a field-spec `param` carrying its own value,
   * or a graph-scoped declaration. All three are an author saying this
   * number is worth turning — by naming it on the wrapper, by writing it
   * into the expression, or by hoisting it to the graph. Standard-node
   * params are not, and appear only when a panel spec names one.
   */
  readonly exposed: boolean;
}

/** The flat record the renderer edits, keyed by {@link Knob.key}. */
export type KnobValues = Record<string, ControlValue>;

export interface KnobPanel {
  readonly sections: ControlSection<KnobValues>[];
  readonly values: KnobValues;
  /**
   * Primary knob key → the other keys its row writes, from
   * {@link PanelControlSpec.also}. Empty for a panel with no spec.
   */
  readonly mirrors: Record<string, readonly string[]>;
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
  // A field-spec knob's `name` is the node param HOLDING the expression,
  // which several of them can share, so the literal's own name has to be in
  // the label or two rows read identically.
  const label =
    spec?.label ??
    (knob.scope === "graph"
      ? knob.name
      : knob.fieldParam === undefined
        ? knob.name
        : `${knob.name}.${knob.fieldParam}`);
  const schema = knob.schema;
  const min = spec?.min ?? schema.min;
  const max = spec?.max ?? schema.max;
  // Falls back to the schema for the same reason the bounds do, and it was
  // the omission that made a panel file the only place a field-spec param
  // could be described. The schema is where a param says what it MEANS —
  // registered for a node param, written beside the value for an inline one
  // — and a panel is one presentation of it, so a panel that says nothing
  // must not erase what the graph says.
  const described = spec?.description ?? schema.description;
  const note = described !== undefined ? { description: described } : {};

  switch (schema.type) {
    case "f32":
    case "i32":
    case "u32": {
      if (min !== undefined && max !== undefined) {
        return {
          kind: "slider",
          key,
          label,
          ...note,
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
        ...note,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
        ...(spec?.unit !== undefined ? { unit: spec.unit } : {}),
      };
    }
    case "bool":
      // The name goes in the row's label column like every other row; the
      // checkbox is the value, so it carries no text of its own.
      return { kind: "flags", label, ...note, items: [{ key, label: "" }] };
    case "enum":
      return {
        kind: "select",
        key,
        label,
        ...note,
        options: (schema.enum ?? []).map((value) => ({ value, label: value })),
      };
    case "string":
      return { kind: "text", key, label, ...note };
    case "vec3":
    case "vec4":
      return {
        kind: "vector",
        key,
        label,
        ...note,
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
 * The WRITE half of a knob: what a commit needs to find the slot, without
 * the presentation half it does not.
 *
 * It lives here, in a plain module, rather than inside the panel component
 * that consumes it — and the reason is a bug this file now exists to
 * prevent. The panel used to rebuild this object inline in `.svelte`, and
 * when `KnobTarget` gained `scope` the inline copy silently kept the old
 * shape: every graph-scoped write went down the NODE path with an
 * undefined node id. `tsc --noEmit` does not read `.svelte` files, so
 * nothing caught it — 3880 tests passed and the panel was broken in the
 * browser. Whatever a component derives from library types belongs where a
 * test can call it and the compiler can check it.
 */
export function knobTarget(knob: Knob): KnobTarget {
  return knob.scope === "graph"
    ? { scope: "graph", name: knob.name }
    : {
        scope: "node",
        node: knob.node,
        name: knob.name,
        ...(knob.fieldParam !== undefined ? { fieldParam: knob.fieldParam } : {}),
        // Carried, because the WRITE is what this decides: a driven slot
        // is refused rather than written, and a target rebuilt without the
        // mark would send the write down the ordinary path — the same
        // dropped-field bug this helper exists to have prevented once.
        ...(knob.drivenBy !== undefined ? { drivenBy: knob.drivenBy } : {}),
      };
}

/** Key → the slot it writes, so no consumer re-splits a key. */
export function knobTargets(knobs: readonly Knob[]): Map<string, KnobTarget> {
  return new Map(knobs.map((k) => [k.key, knobTarget(k)]));
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
  const mirrors: Record<string, readonly string[]> = {};
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
        const also = mirrorsFor(row, knob, byKey, skipped, unknown);
        if (also.length > 0) mirrors[knob.key] = also;
        controls.push(control);
      }
      if (controls.length > 0) sections.push({ title: section.title, controls });
    }
    return { sections, values, mirrors, skipped, unknown, authored: true };
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
    // A graph-scoped knob belongs to no node, so it groups under the GRAPH
    // — one section, first, the way it reads in `pcg validate --params`.
    // Grouping it under a node would have to pick one of its readers, and
    // the whole point of declaring it once is that there is no such one.
    const group = knob.scope === "graph" ? GRAPH_SECTION : knob.node;
    let list = grouped.get(group);
    if (!list) {
      grouped.set(group, (list = []));
      // The node id is what the canvas labels the box with, so it is what
      // connects a row here to a node over there; the primitive's name
      // says what it IS.
      titles.set(
        group,
        knob.scope === "graph"
          ? GRAPH_SECTION
          : knob.nodeLabel === ""
            ? knob.node
            : `${knob.node} · ${knob.nodeLabel}`,
      );
    }
    list.push(control);
  }
  const sections = [...grouped.entries()]
    // Graph-scoped first: the knobs several nodes share are the ones a
    // reader wants before any one node's.
    .sort((a, b) => (a[0] === GRAPH_SECTION ? -1 : b[0] === GRAPH_SECTION ? 1 : 0))
    .map(([node, controls]) => ({
      title: titles.get(node) ?? node,
      controls,
    }));
  return { sections, values, mirrors, skipped, unknown, authored: false };
}

/**
 * The keys a row writes besides its own, checked against the graph.
 *
 * A mirror that does not exist, holds a field, or is a different type is
 * reported the same way a bad primary is — writing a value nothing reads,
 * or writing a float into an enum, is the failure that would otherwise be
 * silent, because the row would keep moving and only some of the truss
 * would follow.
 */
function mirrorsFor(
  row: PanelControlSpec,
  primary: Knob,
  byKey: ReadonlyMap<string, Knob>,
  skipped: { key: string; reason: string }[],
  unknown: string[],
): string[] {
  const also: string[] = [];
  for (const key of row.also ?? []) {
    const knob = byKey.get(key);
    if (knob === undefined) {
      unknown.push(key);
      continue;
    }
    if (knob.isField) {
      skipped.push({ key, reason: `mirrored by ${primary.key}, but holds a field` });
      continue;
    }
    if (knob.schema.type !== primary.schema.type) {
      skipped.push({
        key,
        reason: `mirrored by ${primary.key}, which is ${primary.schema.type}, not ${knob.schema.type}`,
      });
      continue;
    }
    also.push(key);
  }
  return also;
}
