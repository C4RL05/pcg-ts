/**
 * The non-reactive half of the editor: owns the live Graph mirror. Since
 * phase 16/17 the mirror is mutated in place through the graph API —
 * add/connect for creation, removeNode/disconnect for deletion — with no
 * rebuild through the serialized format, so node caches on untouched
 * branches survive every structural edit (the cook stats prove it).
 * Params live on the graph itself (getParams/setParam; field-capable
 * entries may hold Fields), subgraph pins come from describeSubgraphPins,
 * and declared outputs are the file's own plus the auto policy (every
 * unconnected output pin), applied via output/removeOutput deltas.
 * Import validates and rebuilds via
 * deserializeGraph — the one place a fresh graph replaces the mirror —
 * and export reads serializeGraph. Cooks are debounced and run per
 * declared output so one failing branch doesn't blank the rest of the
 * preview.
 */
import {
  Graph,
  applyGraphParamTargets,
  cook,
  createGpuCookStats,
  describeGraphParams,
  describeSubgraphPins,
  deserializeGraph,
  fieldFromJson,
  fieldToJson,
  forEachNode,
  getFieldSpec,
  getNodeType,
  getRegisteredSubgraph,
  graphParamBindings,
  isField,
  resolveExposedParam,
  serializeGraph,
  subgraphNode,
  withInlineParamValue,
  type DataItem,
  type ExposedParam,
  type ExposedPin,
  type Field,
  type FieldSpec,
  type GpuCookStats,
  type GpuFieldResolver,
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  type SerializedExposedPin,
  type SerializedGraph,
  type SerializedNode,
  type SerializedSubgraph,
  parseFieldText,
  printFieldSpec,
} from "pcg-ts";
import { PARTIAL_FUSION } from "../shared/gpu.js";
import type { Knob, KnobPatch, KnobTarget } from "../shared/graphUi.js";
import { makeRecooker } from "../shared/recook.js";
import { autoLayout } from "./autoLayout.js";
import {
  nodeCategory,
  nodePinsForType,
  paramPreviews,
  type NodeView,
  type PinView,
  type StructureModel,
} from "./model.js";

/** Outcome of one debounced cook pass, for the toolbar and overlay. */
export interface CookStatus {
  /** Per-output cook errors, verbatim from the library. */
  readonly errors: string[];
  readonly cooked: number;
  readonly cached: number;
  readonly elapsedMs: number;
  readonly points: number;
  readonly instances: number;
  readonly outputs: number;
  /** FNV-1a hash (hex) over every output payload — round-trip proof. */
  readonly hash: string;
  /**
   * Device counters, summed over the pass, when a GPU path cooked it.
   * Absent on the CPU path — `cook` populates `stats.gpu` exactly when a
   * resolver was passed, so absent and "all zeroes" mean different
   * things and are worth keeping apart.
   */
  readonly gpu?: GpuCookStats;
}

/** One param as the inspector renders it (plain data only). */
export interface ParamView {
  readonly key: string;
  readonly schema: ParamSchema;
  readonly mode: "constant" | "field" | "items";
  /** Plain value for constant mode (arrays copied). */
  readonly value: unknown;
  /** Pretty JSON of the FieldSpec for field mode. */
  readonly specText: string | null;
}

/**
 * The two node types that wrap an inner graph. They serialize to the same
 * payload and reach the editor by the same route; only the cook differs
 * (`forEach` runs the body once per element), which is nothing this editor
 * has to know. Checking the pair rather than the word "subgraph" is what
 * keeps a forEach from being treated as an ordinary registered node —
 * whose registry entry declares no pins and cannot cook.
 */
const WRAPPER_TYPES = new Set(["subgraph", "forEach"]);

/** What one wrapper node exposes, resolved from its payload at import. */
export interface SubgraphView {
  /** Exposed params, in declaration order — the node's whole param surface. */
  readonly params: readonly ExposedParam[];
  /** Registered name for a `ref` node ("shape/ring"); absent when inline. */
  readonly ref?: string;
  /** The primitive's own description, for the inspector's help line. */
  readonly description: string;
}

/** One structural edge, as the canvas reports it. */
export interface EdgeRef {
  readonly from: string;
  readonly fromPin: string;
  readonly to: string;
  readonly toPin: string;
}

/** What produced the cook being rendered. */
export interface RenderInfo {
  /**
   * The graph itself was replaced — a preset load or a paste — rather
   * than re-cooked after an edit. The host frames the camera on a fresh
   * graph and leaves it alone otherwise: re-framing on every cook would
   * yank the view out from under whoever is turning a knob.
   */
  readonly fresh: boolean;
  /**
   * Which declared output each item came from, parallel to `items`.
   *
   * The items arrive flattened because a cook returns a COLLECTION per
   * output and most hosts want the lot, but "which output is this" is not
   * recoverable from a `DataItem` — and it is what a viewer colours by.
   * One output can contribute many items (the rig's cable wraps are
   * sixteen), so the name repeats rather than indexing outputs.
   */
  readonly outputs: readonly string[];
}

/** Host callbacks: scene rendering and stats display. */
export interface ControllerHooks {
  render(items: readonly DataItem[], info: RenderInfo): void;
  status(s: CookStatus): void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fold one cook's device counters into a running total.
 *
 * The work counters sum cleanly: a memoized node does no device work, so
 * cooking output B after output A adds only what B actually dispatched.
 * `run-partially-fused` does NOT, because it is counted once per chain
 * per COOK CALL — including on a memo hit — and this page makes one call
 * per declared output so one narrowed chain would report itself once per
 * output. Neither summing nor taking the max is exact once several
 * outputs hold DIFFERENT narrowed chains; the max is the one that cannot
 * contradict the run counters sitting beside it in the status line,
 * which is what a reader would notice.
 */
function addGpuStats(into: GpuCookStats, from: GpuCookStats): void {
  into.dispatches += from.dispatches;
  into.pipelinesCompiled += from.pipelinesCompiled;
  into.pipelineCacheHits += from.pipelineCacheHits;
  into.residentRuns += from.residentRuns;
  into.fusedNodes += from.fusedNodes;
  into.readbacksSaved += from.readbacksSaved;
  for (const [reason, n] of Object.entries(from.fallbacks)) {
    const prior = into.fallbacks[reason] ?? 0;
    into.fallbacks[reason] = reason === PARTIAL_FUSION ? Math.max(prior, n) : prior + n;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function copyPlain(v: unknown): unknown {
  return Array.isArray(v) ? [...v] : v;
}

function isNumberArray(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number");
}

/**
 * Bring a typed number inside what the schema declares, so a param editor
 * commits a value the graph will take.
 *
 * `Graph.setParam` refuses an out-of-range or non-integer value now — it
 * names the node, the param and the bound, which is right for an API and
 * wrong for a number box, where the same keystroke is on its way somewhere
 * legal. Every numeric widget in this editor clamps through here first, so
 * the refusal is the last line rather than the first.
 */
export function clampToSchema(schema: ParamSchema, raw: number): number {
  let v = raw;
  if (schema.type === "i32" || schema.type === "u32") v = Math.round(v);
  if (schema.type === "u32") v = Math.max(0, v);
  if (schema.min !== undefined) v = Math.max(schema.min, v);
  if (schema.max !== undefined) v = Math.min(schema.max, v);
  return v;
}

function copyPinViews(pins: { inputs: PinView[]; outputs: PinView[] }): {
  inputs: PinView[];
  outputs: PinView[];
} {
  return {
    inputs: pins.inputs.map((p) => ({ ...p })),
    outputs: pins.outputs.map((p) => ({ ...p })),
  };
}

const COOK_DEBOUNCE_MS = 150;

export class EditorController {
  private readonly hooks: ControllerHooks;
  private mirror = new Graph(0);
  /** Node id → pin views (registry pins; describeSubgraphPins for subgraphs). */
  private readonly pins = new Map<string, { inputs: PinView[]; outputs: PinView[] }>();
  /**
   * Node id → what a subgraph node exposes. Kept because a subgraph's
   * param schemas do NOT live in the node-type registry the way a
   * standard node's do: they are resolved from the payload at wrap time,
   * so the only copy is the one built during import. Without it the
   * inspector has nothing to render and the node reads as opaque.
   */
  private readonly subgraphs = new Map<string, SubgraphView>();
  /**
   * Outputs the LOADED FILE declared, by output name. Kept because the
   * auto policy cannot re-derive them: it declares unconnected pins, and
   * a file is free to declare a pin that feeds something.
   */
  private imported = new Map<string, { id: string; pin: string }>();
  /** Declared output names in canonical (node insertion) order. */
  private outputNames: string[] = [];
  /** Bumped on every structural edit, so a stale cook pass abandons itself. */
  private structureRev = 0;
  /**
   * Set when a whole new graph arrives, cleared by the render that first
   * carries it. Held as a flag rather than passed along the import call
   * because the cook is debounced: by the time there is anything to
   * render, the import that caused it has long since returned.
   */
  private freshGraph = false;
  /**
   * The cook path's resolver, or undefined for the CPU. Held rather than
   * passed per cook because the cook is debounced: whoever flips the
   * toolbar is not the caller that eventually runs.
   */
  private gpu: GpuFieldResolver | undefined;
  /**
   * Rejects the cook pass currently in flight. Held because a lost
   * device does NOT reject the work already on it — a pending readback
   * simply never settles — so without a way out the pass never returns,
   * the recooker's gate never opens, and every later edit is swallowed
   * for the life of the page. An abort signal is not enough: the
   * executor checks one between nodes, and the stuck await is inside a
   * node.
   */
  private bail: ((err: Error) => void) | undefined;
  private cookTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly recook: () => void;
  private listener: ((s: CookStatus) => void) | undefined;

  constructor(hooks: ControllerHooks) {
    this.hooks = hooks;
    this.recook = makeRecooker(() => this.cookAll());
  }

  /**
   * Choose the cook path. `undefined` is the CPU — `cook` populates
   * `stats.gpu` exactly when a resolver is passed, so passing none is
   * how the CPU path stays byte-for-byte what it always was.
   *
   * Recooks, because the whole point of switching is to see the same
   * graph come back the same on a different path.
   */
  setGpuResolver(resolver: GpuFieldResolver | undefined): void {
    if (this.gpu === resolver) return;
    this.gpu = resolver;
    this.scheduleCook();
  }

  /**
   * Abandon the pass in flight, surfacing `reason` as a cook error.
   *
   * Called when the device under the current resolver is gone. The pass
   * would otherwise sit on a readback that will never settle; letting it
   * reject instead lets the pass finish, which is what releases the
   * recooker so the CPU recook behind it can actually run.
   */
  abandonCook(reason: string): void {
    this.bail?.(new Error(reason));
  }

  /** The UI's status subscription (the hooks get every status too). */
  setStatusListener(cb: (s: CookStatus) => void): void {
    this.listener = cb;
  }

  /**
   * How the inspector heads a node. A subgraph node answers with the
   * primitive it references rather than the bare word "subgraph", which
   * is true of every subgraph node and therefore tells you nothing.
   */
  describeNode(id: string, type: string): { label: string; description: string } {
    if (WRAPPER_TYPES.has(type)) {
      const view = this.subgraphs.get(id);
      return { label: view?.ref ?? type, description: view?.description ?? "" };
    }
    return { label: type, description: getNodeType(type).info.description };
  }

  // -- structure -----------------------------------------------------------

  /**
   * Add a node instance to the live graph (graph.add with the registered
   * def — defaults come from the registry schemas). Returns the pin views
   * for the canvas, or the library's error message verbatim. No rebuild:
   * every other node keeps its cache.
   */
  addNode(id: string, type: string): { inputs: PinView[]; outputs: PinView[] } | { error: string } {
    if (WRAPPER_TYPES.has(type)) {
      return {
        error: `the registered "${type}" type is metadata-only; ${type} nodes enter the editor via import (their inner graph travels in the serialized payload)`,
      };
    }
    try {
      this.mirror.add(getNodeType(type).def, undefined, id);
    } catch (err) {
      return { error: errorMessage(err) };
    }
    const view = nodePinsForType(type);
    this.pins.set(id, view);
    this.afterStructuralEdit();
    return copyPinViews(view);
  }

  /**
   * Connect two pins on the live graph — the real validation (pins,
   * kinds, occupancy, cycles) with the library's error message verbatim,
   * or null on success (commit the edge to the view model after).
   */
  connectEdge(edge: EdgeRef): string | null {
    try {
      this.mirror.connect({ id: edge.from }, edge.fromPin, { id: edge.to }, edge.toPin);
    } catch (err) {
      return errorMessage(err);
    }
    this.afterStructuralEdit();
    return null;
  }

  /**
   * Remove one connection via graph.disconnect — no rebuild, so only the
   * former target (and downstream) recooks; untouched branches serve
   * their caches on the next cook. Returns an error message or null.
   */
  disconnectEdge(edge: EdgeRef): string | null {
    let removed: boolean;
    try {
      removed = this.mirror.disconnect({ id: edge.from }, edge.fromPin, { id: edge.to }, edge.toPin);
    } catch (err) {
      return errorMessage(err);
    }
    if (removed) this.afterStructuralEdit();
    return null;
  }

  /**
   * Remove a node via graph.removeNode (cascade: its connections and
   * declared outputs go with it; former downstream targets are dirtied).
   * No rebuild — every untouched branch keeps its cache, which the next
   * cook's cooked/cached stats make visible. Returns an error message or
   * null.
   */
  deleteNode(id: string): string | null {
    try {
      this.mirror.removeNode({ id });
    } catch (err) {
      return errorMessage(err);
    }
    this.pins.delete(id);
    this.subgraphs.delete(id);
    this.afterStructuralEdit();
    return null;
  }

  setSeed(seed: number): void {
    this.mirror.setSeed(seed);
    this.scheduleCook();
  }

  // -- params --------------------------------------------------------------

  /**
   * Inspector rows for one node, read straight from the live graph
   * (graph.getParams) — the graph is the single source of truth; Fields
   * become spec text.
   */
  paramViews(id: string, type: string): ParamView[] {
    // A wrapper's schemas are not in the node-type registry — they were
    // resolved from its payload at import and kept in `subgraphs`.
    const schemas: Readonly<Record<string, ParamSchema>> =
      WRAPPER_TYPES.has(type)
        ? Object.fromEntries((this.subgraphs.get(id)?.params ?? []).map((p) => [p.name, p.schema]))
        : getNodeType(type).info.params;
    let rec: Readonly<Record<string, unknown>>;
    try {
      rec = this.mirror.getParams({ id } as NodeHandle<Record<string, unknown>>);
    } catch {
      rec = {};
    }
    return Object.entries(schemas).map(([key, schema]) => {
      const v = rec[key];
      if (schema.type === "items") {
        return { key, schema, mode: "items", value: null, specText: null };
      }
      if (isField(v)) {
        // The TEXT view, not the tree. The tree is still the format —
         // this parses straight back to it — but nothing in the editor
         // shows JSON any more, which is the whole point of having a
         // printer. A spec the printer refuses falls back to null and the
         // widget says so, rather than showing half an expression.
        let specText: string | null = null;
        try {
          specText = printFieldSpec(fieldToJson(v));
        } catch {
          specText = null;
        }
        return { key, schema, mode: "field", value: null, specText };
      }
      return { key, schema, mode: "constant", value: copyPlain(v), specText: null };
    });
  }

  /**
   * Every param of every node, in node insertion order, as the panel's own
   * vocabulary.
   *
   * The addresses, schemas and `exposed` flags are the LIBRARY's
   * (`describeGraphParams`), not this editor's: a panel file, a shared link
   * and `pcg validate --params` all have to spell a knob the same way, and
   * two derivations of one address is how they would stop. What is added
   * here is presentation the library has no business knowing — the node's
   * label, which is the primitive's registered name rather than its type,
   * and a live re-read of a field-valued param so the inspector has the
   * Field itself.
   *
   * `exposed` separates the two kinds. A subgraph's exposed params are
   * knobs by construction — someone decided each was worth turning and
   * gave it a name at the primitive's level of abstraction — so a panel
   * with nothing else to go on shows exactly those, along with every
   * literal an author named inside a field expression. A standard node's
   * params are mostly wiring, and showing all of them by default would
   * bury the handful that matter; but a panel spec naming one knows what
   * it is asking for, so it gets it.
   */
  knobs(): Knob[] {
    const labels = new Map(
      this.mirror.describe().nodes.map((n) => [n.id, this.subgraphs.get(n.id)?.ref ?? n.defType ?? ""]),
    );
    return describeGraphParams(this.mirror).map((p) =>
      p.scope === "graph"
        ? {
            key: p.key,
            scope: "graph" as const,
            // No node, and no node LABEL: a value ten nodes read belongs to
            // none of them, and naming one of its readers here would be a
            // guess the panel then prints as a fact.
            nodeLabel: "",
            name: p.name,
            schema: p.schema,
            value: copyPlain(p.value),
            isField: false,
            exposed: p.exposed,
          }
        : {
            key: p.key,
            scope: "node" as const,
            // A DRIVEN slot is still listed, because the inspector should
            // show what the node holds — but it is marked, and the write
            // path refuses it. Editing one used to produce a graph that
            // will no longer LOAD: the declaration wins on load, and a
            // node literal disagreeing with its driver is now refused
            // outright, so the edit would have travelled as far as the
            // next open and then failed.
            ...(p.scope === "driven" ? { drivenBy: p.driver } : {}),
            node: p.node,
            nodeLabel: labels.get(p.node) ?? "",
            name: p.param,
            ...(p.fieldParam !== undefined ? { fieldParam: p.fieldParam } : {}),
            schema: p.schema,
            // A field-valued param reports no plain value, and the inspector
            // wants the Field itself — the panel never reads this one (it
            // skips `isField` knobs), but the node editor does.
            value: p.holdsField ? this.paramValue(p.node, p.param) : copyPlain(p.value),
            isField: p.holdsField,
            exposed: p.exposed,
          },
    );
  }

  /** One live param value, or undefined if the node or param has gone. */
  private paramValue(node: string, param: string): unknown {
    try {
      return this.mirror.getParams({ id: node } as NodeHandle<Record<string, unknown>>)[param];
    } catch {
      return undefined;
    }
  }

  /**
   * Apply a knob patch to the live graph, reporting what it could not do
   * rather than refusing the whole patch. A shared link naming one knob
   * that has since been renamed should still open the graph with the rest
   * of the settings applied and say which one it dropped — the failure
   * mode a link outlives its graph by.
   */
  applyKnobPatch(patch: KnobPatch): { applied: number; problems: string[] } {
    const known = new Map(this.knobs().map((k) => [k.key, k]));
    const problems: string[] = [];
    let applied = 0;
    for (const [key, value] of Object.entries(patch)) {
      if (key === "seed") {
        if (typeof value === "number" && Number.isFinite(value)) {
          this.setSeed(value >>> 0);
          applied++;
        } else {
          problems.push(`seed: expected a number, got ${JSON.stringify(value)}`);
        }
        continue;
      }
      const knob = known.get(key);
      if (knob === undefined) {
        problems.push(`${key}: this graph exposes no such knob`);
        continue;
      }
      try {
        // Straight to the write, not through setKnob: that one swallows a
        // rejection into a returned string, and here the rejection is the
        // report — and it must not cook per key when the patch is a dozen.
        this.writeKnob(knob, value);
        applied++;
      } catch (err) {
        problems.push(`${key}: ${errorMessage(err)}`);
      }
    }
    if (applied > 0) this.scheduleCook();
    return { applied, problems };
  }

  /**
   * Write one knob's value, whichever of the two kinds it is, and cook.
   * Returns what the graph refused, or null on success.
   *
   * The panel routes every commit through here rather than switching on the
   * kind itself: which of the two a key is, is a fact about the knob, and
   * the knob already carries it.
   */
  setKnob(knob: KnobTarget, value: unknown): string | null {
    try {
      this.writeKnob(knob, value);
    } catch (err) {
      return errorMessage(err);
    }
    this.scheduleCook();
    return null;
  }

  /**
   * The write itself, throwing — shared by {@link setKnob} and the patch
   * path, which report a refusal differently and must not cook differently.
   *
   * A field-spec knob rewrites the literal inside the spec the param holds
   * and sets the rebuilt field, which is the write path the field-param
   * editor already takes: read the spec off the live Field, edit the JSON,
   * `fieldFromJson`, `setParam`. The value is substituted into `Field.key`
   * at construction, so the new field hashes differently and the node's
   * memo misses exactly as it would for a plain param.
   */
  private writeKnob(knob: KnobTarget, value: unknown): void {
    if (knob.scope === "node" && knob.drivenBy !== undefined) {
      throw new Error(
        `"${knob.node}".${knob.name} is driven by the graph param "$${knob.drivenBy}", so a value written here would be overwritten the next time the graph is opened — and the graph would refuse to open, because a node literal that disagrees with its driver is an error. Turn "$${knob.drivenBy}" instead; it moves every slot it drives.`,
      );
    }
    if (knob.scope === "graph") {
      // The graph layer owns the fan-out: one declared value, rebound into
      // every expression that reads the name. No spec rewrite here and no
      // per-slot loop — which is the whole difference between declaring a
      // value once and mirroring it with a panel's `also`.
      if (typeof value !== "number" && !isNumberArray(value)) {
        throw new Error(
          `graph param "${knob.name}" takes a number or an array of numbers, got ${JSON.stringify(value)}`,
        );
      }
      this.mirror.setGraphParam(knob.name, value);
      return;
    }
    const handle = { id: knob.node } as NodeHandle<Record<string, unknown>>;
    if (knob.fieldParam === undefined) {
      this.mirror.setParam(handle, knob.name, copyPlain(value));
      return;
    }
    const held = this.mirror.getParams(handle)[knob.name];
    const spec = isField(held) ? getFieldSpec(held) : undefined;
    if (spec === undefined) {
      throw new Error(
        `param "${knob.name}" of node "${knob.node}" no longer holds a field expression, so its ` +
          `"${knob.fieldParam}" value has nowhere to be written — reopen the graph`,
      );
    }
    if (typeof value !== "number" && !isNumberArray(value)) {
      throw new Error(
        `field-spec param "${knob.fieldParam}" takes a number or an array of numbers, got ` +
          JSON.stringify(value),
      );
    }
    let built: Field;
    try {
      // The BUILD is inside too, not just the rewrite. A `param` that
      // declares its own `min`/`max` refuses a value outside them, and the
      // widget can offer one — a panel row may declare a wider range than
      // the graph does, and two references to one name may declare
      // different ones. The grammar names the param and the bound it broke;
      // only this frame knows which node's spec it was writing.
      built = fieldFromJson(withInlineParamValue(spec, knob.fieldParam, value));
    } catch (err) {
      // Also reached when the spec has moved under the panel — edited in the
      // field editor between the knob being listed and the slider being
      // released.
      throw new Error(`node "${knob.node}" param "${knob.name}": ${errorMessage(err)}`);
    }
    this.mirror.setParam(handle, knob.name, built);
  }

  /**
   * Set a plain (non-field) param on the live graph, returning what the
   * graph refused or null on success.
   *
   * It used to swallow the throw, on the reading that the only way to get
   * one was a node vanishing between the UI event and the commit. That is
   * no longer the only way — `setParam` checks the value against the param
   * schema — and a silently dropped write leaves a widget showing a number
   * the graph does not have. So it reports, and the caller decides where
   * to put it.
   */
  setPlainParam(id: string, key: string, value: unknown): string | null {
    try {
      this.mirror.setParam({ id } as NodeHandle<Record<string, unknown>>, key, copyPlain(value));
    } catch (err) {
      return errorMessage(err);
    }
    this.scheduleCook();
    return null;
  }

  /**
   * Parse a field EXPRESSION and set it on a field-capable param.
   *
   * Text, not JSON: `parseFieldText` on the way in and `printFieldSpec`
   * on the way out (see `specText` above), so nothing in the editor
   * shows the serialization. The tree is still the format — this parses
   * straight to it and the graph file is unchanged — and the JSON that
   * remains in this file is the GRAPH's, moved by import and export.
   *
   * Returns the parser's or `fieldFromJson`'s message verbatim, or null
   * on success. The parser's carries the offending token and its
   * line:col; `fieldFromJson`'s still speaks in tree paths
   * (`$.opts.seed.variant`), which is the one place a reader can still
   * meet the shape of the tree — a spec that parses but does not build.
   */
  applyFieldParam(id: string, key: string, text: string): string | null {
    let spec: unknown;
    try {
      spec = parseFieldText(text);
    } catch (err) {
      // The parser's message already carries the offending token and its
      // line:col, so it is shown verbatim exactly as the JSON error was.
      return errorMessage(err);
    }
    let field;
    try {
      field = fieldFromJson(spec as FieldSpec);
    } catch (err) {
      return errorMessage(err);
    }
    try {
      this.mirror.setParam({ id } as NodeHandle<Record<string, unknown>>, key, field);
    } catch (err) {
      return errorMessage(err);
    }
    this.scheduleCook();
    return null;
  }

  // -- serialize round-trip --------------------------------------------------

  /** The mirror through the library's serializer, pretty-printed. */
  exportText(): string {
    return JSON.stringify(serializeGraph(this.mirror), null, 2);
  }

  /**
   * Validate pasted JSON with deserializeGraph (errors verbatim), then
   * build a fresh mirror from it: standard nodes from their registered
   * defs, subgraph nodes re-wrapped through subgraphNode with pins read
   * from describeSubgraphPins (exact kinds, nested subgraphs resolved —
   * no payload guessing). The editor model comes back with a
   * deterministic topological layout; declared outputs are re-derived by
   * the auto policy (every unconnected output pin), which reproduces the
   * editor's own exports exactly.
   */
  importText(text: string): { structure: StructureModel } | { error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { error: errorMessage(err) };
    }
    try {
      deserializeGraph(parsed);
    } catch (err) {
      return { error: errorMessage(err) };
    }
    const json = parsed as SerializedGraph;
    const mirror = new Graph(json.seed >>> 0);
    // Declared before the first node, because binding substitutes at BUILD
    // time and a node built without them holds an unbound reference that
    // refuses to evaluate. `deserializeGraph` above has already validated
    // the block; this mirror is the editor's own copy of the same graph.
    mirror.setGraphParams(json.params ?? []);
    const bindings = graphParamBindings(mirror.graphParams);
    const pins = new Map<string, { inputs: PinView[]; outputs: PinView[] }>();
    const subgraphs = new Map<string, SubgraphView>();
    const nodes: NodeView[] = [];
    try {
      for (const sn of json.nodes) {
        const view = this.addImportedNode(mirror, sn, subgraphs, bindings);
        pins.set(sn.id, view);
        const copy = copyPinViews(view);
        const category = nodeCategory(sn.type);
        nodes.push({
          id: sn.id,
          type: sn.type,
          ...(sn.ref !== undefined ? { label: sn.ref.name } : {}),
          ...(category !== undefined ? { category } : {}),
          x: 0,
          y: 0,
          inputs: copy.inputs,
          outputs: copy.outputs,
        });
      }
      for (const c of json.connections ?? []) {
        mirror.connect({ id: c.from[0] }, c.from[1], { id: c.to[0] }, c.to[1]);
      }
    } catch (err) {
      return { error: errorMessage(err) };
    }
    // The targets, after every node exists. `deserializeGraph` does this
    // for the graph it builds; this editor builds its OWN mirror, so it has
    // to do it too — and skipping it left a driven slot showing the file's
    // literal while the declaration that owns it said something else.
    // Empty `authored` map: this path cannot tell an authored value from a
    // registry default, and the disagreement error is not its to raise.
    try {
      mirror.setGraphParams(applyGraphParamTargets(mirror, mirror.graphParams, new Map()));
    } catch (err) {
      return { error: errorMessage(err) };
    }
    this.mirror = mirror;
    this.pins.clear();
    for (const [id, view] of pins) this.pins.set(id, view);
    this.subgraphs.clear();
    for (const [id, view] of subgraphs) this.subgraphs.set(id, view);
    this.imported = new Map(
      (json.outputs ?? []).map((o) => [o.name, { id: o.id, pin: o.pin }] as const),
    );
    this.freshGraph = true;
    this.afterStructuralEdit();
    const edges = (json.connections ?? []).map((c) => ({
      from: c.from[0],
      fromPin: c.from[1],
      to: c.to[0],
      toPin: c.to[1],
    }));
    // Laid out at the height the boxes will actually be drawn at. The
    // mirror is live by now, so the preview rows can be counted here
    // rather than left for the editor to correct on the next relayout —
    // otherwise every imported graph opens with its columns overlapping.
    autoLayout(
      nodes,
      edges,
      new Map(nodes.map((n) => [n.id, paramPreviews(this.paramViews(n.id, n.type)).length])),
    );
    return { structure: { seed: json.seed >>> 0, nodes, edges } };
  }

  // -- internals -------------------------------------------------------------

  /** Add one serialized node to a fresh mirror; returns its pin views. */
  private addImportedNode(
    mirror: Graph,
    sn: SerializedNode,
    subgraphs: Map<string, SubgraphView>,
    bindings: Readonly<Record<string, number | readonly number[]>>,
  ): { inputs: PinView[]; outputs: PinView[] } {
    if (WRAPPER_TYPES.has(sn.type)) {
      /**
       * Two flavours, mutually exclusive in the format: a `ref` naming a
       * registered subgraph, or an inline `subgraph` payload. This editor
       * writes the inline kind, which is why it only ever read that one —
       * but the corpus is almost entirely refs (primitives are
       * registered, not embedded), so a graph picked from the menu is the
       * case that never worked.
       */
      const payload: SerializedSubgraph | undefined =
        sn.ref !== undefined ? getRegisteredSubgraph(sn.ref.name).subgraph : sn.subgraph;
      if (!payload) {
        // Unreachable: deserializeGraph validated the payload above.
        throw new Error(`node "${sn.id}": subgraph node with neither a payload nor a ref`);
      }
      const toExposed = (e: SerializedExposedPin): ExposedPin => ({
        name: e.name,
        node: { id: e.node },
        pin: e.pin,
      });
      const inner = deserializeGraph(payload.graph);
      /**
       * The exposed params have to be rebuilt alongside the pins. A node
       * wrapped without their declarations has nowhere to put the values
       * the file carries, so it silently cooks the primitive's own
       * defaults — a ring at the wrong radius, and no error anywhere.
       */
      const exposed: ExposedParam[] = (payload.params ?? []).map((p) =>
        resolveExposedParam(inner, {
          name: p.name,
          targets: p.targets.map((t) => ({ node: { id: t.node }, param: t.param })),
          description: p.description,
          default: p.default as ParamValue,
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
        }),
      );
      const def =
        sn.type === "forEach"
          ? forEachNode(inner, payload.inputs.map(toExposed), payload.outputs.map(toExposed), exposed)
          : subgraphNode(
              inner,
              payload.inputs.map(toExposed),
              payload.outputs.map(toExposed),
              exposed,
            );
      const params: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sn.params ?? {})) {
        const schema = exposed.find((e) => e.name === key)?.schema;
        params[key] =
          schema?.acceptsField === true && isPlainObject(value)
            ? fieldFromJson(value as FieldSpec, bindings)
            : copyPlain(value);
      }
      mirror.add(def, params, sn.id);
      subgraphs.set(sn.id, {
        params: exposed,
        ...(sn.ref !== undefined ? { ref: sn.ref.name } : {}),
        description:
          (sn.ref !== undefined ? getRegisteredSubgraph(sn.ref.name).meta?.description : undefined) ??
          payload.graph.meta?.description ??
          "",
      });
      const described = describeSubgraphPins(def);
      const toView = (p: { name: string; kind: string }): PinView => ({
        name: p.name,
        kind: p.kind,
        multi: false,
      });
      return {
        inputs: (described?.inputs ?? []).map(toView),
        outputs: (described?.outputs ?? []).map(toView),
      };
    }
    const reg = getNodeType(sn.type);
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sn.params ?? {})) {
      const schema = reg.info.params[key];
      if (!schema) continue; // unreachable: deserializeGraph validated
      params[key] =
        schema.acceptsField === true && isPlainObject(value)
          ? // The graph's declared params bind HERE, because this editor
            // builds its own mirror rather than keeping the one
            // `deserializeGraph` made — and a value binds when the field is
            // BUILT or never. Same call, same record, same substitution the
            // library performs, so the mirror cooks what the file says.
            fieldFromJson(value as FieldSpec, bindings)
          : copyPlain(value);
    }
    mirror.add(reg.def, params, sn.id);
    return nodePinsForType(sn.type);
  }

  private afterStructuralEdit(): void {
    this.structureRev++;
    this.reconcileOutputs();
    this.scheduleCook();
  }

  /**
   * Diff the declared outputs against the auto policy (one output named
   * `<nodeId>.<pin>` per unconnected output pin, in node insertion order)
   * using the graph's own describe() snapshot, and apply the delta via
   * output/removeOutput. Neither call touches node caches, so this keeps
   * cache survival intact across structural edits.
   */
  private reconcileOutputs(): void {
    const d = this.mirror.describe();
    const connected = (id: string, pin: string): boolean =>
      d.connections.some((c) => c.from[0] === id && c.from[1] === pin);
    /**
     * Keyed by PIN, not by output name. The file may call `spawn`'s
     * instances pin "instances" while the auto policy would call it
     * "spawn.instances" — two names for one pin, and declaring both
     * cooks and draws it twice. The file's name wins, so an export
     * round-trips to the names its author chose.
     */
    const desired = new Map<string, { id: string; pin: string; name: string }>();
    for (const [name, { id, pin }] of this.imported) {
      if (this.pins.get(id)?.outputs.some((p) => p.name === pin) !== true) continue;
      desired.set(`${id}.${pin}`, { id, pin, name });
    }
    for (const n of d.nodes) {
      for (const p of this.pins.get(n.id)?.outputs ?? []) {
        const key = `${n.id}.${p.name}`;
        if (connected(n.id, p.name) || desired.has(key)) continue;
        desired.set(key, { id: n.id, pin: p.name, name: key });
      }
    }
    const names = new Map([...desired.values()].map((o) => [o.name, o] as const));
    const have = new Set<string>();
    for (const o of d.outputs) {
      if (names.has(o.name)) have.add(o.name);
      else this.mirror.removeOutput(o.name);
    }
    for (const [name, { id, pin }] of names) {
      if (!have.has(name)) this.mirror.output({ id }, pin, name);
    }
    this.outputNames = [...names.keys()];
  }

  private scheduleCook(): void {
    if (this.cookTimer !== undefined) clearTimeout(this.cookTimer);
    this.cookTimer = setTimeout(() => {
      this.cookTimer = undefined;
      this.recook();
    }, COOK_DEBOUNCE_MS);
  }

  /**
   * Cook every declared output individually (shared upstream results come
   * from the memo cache), collecting failures instead of aborting the
   * whole pass, then hash and hand the payloads to the host.
   */
  private async cookAll(): Promise<void> {
    const graph = this.mirror;
    const rev = this.structureRev;
    const names = [...this.outputNames];
    const stale = (): boolean => graph !== this.mirror || rev !== this.structureRev;
    const errors: string[] = [];
    const items: DataItem[] = [];
    /** The output each item came from, kept parallel to `items`. */
    const owners: string[] = [];
    let cooked = 0;
    let cached = 0;
    /**
     * Summed across the per-output loop rather than taken from the last
     * cook: this page cooks each declared output separately, so a graph
     * with three outputs runs three passes and the device counters of
     * the first two would otherwise be thrown away.
     */
    const resolver = this.gpu;
    const gpu = resolver === undefined ? undefined : createGpuCookStats();
    // One escape hatch for the whole pass. Rejected rather than resolved
    // so the race lands in the same catch as any other cook failure, and
    // pre-rejected for every output after the first, which is what makes
    // the rest of the loop fall through immediately.
    const escape = new Promise<never>((_, reject) => {
      this.bail = reject;
    });
    escape.catch(() => {}); // a rejection nobody raced is not an error
    const t0 = performance.now();
    try {
      for (const name of names) {
        if (stale()) return; // structure changed mid-pass; a newer cook follows
        try {
          const r = await Promise.race([
            cook(graph, {
              outputs: [name],
              ...(resolver === undefined ? {} : { gpu: resolver }),
            }),
            escape,
          ]);
          cooked += r.stats.cooked;
          cached += r.stats.cached;
          if (gpu !== undefined && r.stats.gpu !== undefined) addGpuStats(gpu, r.stats.gpu);
          const col = r.outputs[name];
          if (col) {
            items.push(...col);
            for (let i = 0; i < col.length; i++) owners.push(name);
          }
        } catch (err) {
          errors.push(errorMessage(err));
        }
      }
    } finally {
      this.bail = undefined;
    }
    const elapsedMs = performance.now() - t0;

    let points = 0;
    let instances = 0;
    let h = 0x811c9dc5;
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    const mix = (x: number): void => {
      h = Math.imul(h ^ (x >>> 0), 0x01000193);
    };
    const mixF = (v: number): void => {
      f32[0] = v;
      mix(u32[0]);
    };
    const mixS = (s: string): void => {
      for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    };
    for (const item of items) {
      if (item.kind === "geometry") {
        const n = item.geo.pointCount;
        points += n;
        mix(n);
        const P = item.geo.attrs.point.get("P");
        if (P) {
          const len = n * P.tupleSize;
          for (let i = 0; i < len; i++) mixF(P.data[i] as number);
        }
      } else if (item.kind === "instances") {
        for (const b of item.batches) {
          instances += b.count;
          mixS(b.assetId);
          mix(b.count);
          for (let i = 0; i < b.transforms.length; i++) mixF(b.transforms[i]);
        }
      } else {
        mixS(JSON.stringify(item.value));
      }
    }
    const status: CookStatus = {
      errors,
      cooked,
      cached,
      elapsedMs,
      points,
      instances,
      outputs: names.length,
      hash: (h >>> 0).toString(16).padStart(8, "0"),
      ...(gpu === undefined ? {} : { gpu }),
    };
    // The flag is cleared only by a render that actually happened: a cook
    // abandoned as stale never reached the host, so the graph it loaded
    // is still waiting to be framed.
    if (!stale()) {
      const fresh = this.freshGraph;
      this.freshGraph = false;
      this.hooks.render(items, { fresh, outputs: owners });
    }
    this.hooks.status(status);
    this.listener?.(status);
  }
}
