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
  cook,
  createGpuCookStats,
  describeSubgraphPins,
  deserializeGraph,
  fieldFromJson,
  fieldToJson,
  getNodeType,
  getRegisteredSubgraph,
  isField,
  resolveExposedParam,
  serializeGraph,
  subgraphNode,
  type DataItem,
  type ExposedParam,
  type ExposedPin,
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
} from "pcg-ts";
import { PARTIAL_FUSION } from "../shared/gpu.js";
import type { Knob, KnobPatch } from "../shared/graphUi.js";
import { makeRecooker } from "../shared/recook.js";
import { topoLayout } from "./layout.js";
import {
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

/** What one subgraph node exposes, resolved from its payload at import. */
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
    if (type === "subgraph") {
      const view = this.subgraphs.get(id);
      return { label: view?.ref ?? "subgraph", description: view?.description ?? "" };
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
    if (type === "subgraph") {
      return {
        error:
          'the registered "subgraph" type is metadata-only; subgraph nodes enter the editor via import (their inner graph travels in the serialized payload)',
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
    // A subgraph's schemas are not in the node-type registry — they were
    // resolved from its payload at import and kept in `subgraphs`.
    const schemas: Readonly<Record<string, ParamSchema>> =
      type === "subgraph"
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
        let specText: string | null = null;
        try {
          specText = JSON.stringify(fieldToJson(v), null, 2);
        } catch {
          specText = null;
        }
        return { key, schema, mode: "field", value: null, specText };
      }
      return { key, schema, mode: "constant", value: copyPlain(v), specText: null };
    });
  }

  /**
   * Every param of every node, in node insertion order.
   *
   * `exposed` separates the two kinds. A subgraph's exposed params are
   * knobs by construction — someone decided each was worth turning and
   * gave it a name at the primitive's level of abstraction — so a panel
   * with nothing else to go on shows exactly those. A standard node's
   * params are mostly wiring, and showing all of them by default would
   * bury the handful that matter; but a panel spec naming one knows what
   * it is asking for, so it gets it.
   *
   * `items` params are omitted throughout: they are runtime-injected
   * DataItems, never serialized and never authored.
   */
  knobs(): Knob[] {
    const out: Knob[] = [];
    for (const n of this.mirror.describe().nodes) {
      const view = this.subgraphs.get(n.id);
      let rec: Readonly<Record<string, unknown>>;
      try {
        rec = this.mirror.getParams({ id: n.id } as NodeHandle<Record<string, unknown>>);
      } catch {
        continue; // node vanished between describe() and read
      }
      let entries: { name: string; schema: ParamSchema }[];
      if (view !== undefined) {
        entries = view.params.map((p) => ({ name: p.name, schema: p.schema }));
      } else {
        // An ad-hoc def can report a type string the registry never saw;
        // `describe()` promises no lookup will succeed.
        const type = n.defType;
        if (type === undefined) continue;
        try {
          entries = Object.entries(getNodeType(type).info.params).map(([name, schema]) => ({
            name,
            schema,
          }));
        } catch {
          continue;
        }
      }
      for (const { name, schema } of entries) {
        if (schema.type === "items") continue;
        const value = rec[name];
        out.push({
          key: `${n.id}.${name}`,
          node: n.id,
          nodeLabel: view?.ref ?? n.defType ?? "",
          name,
          schema,
          value: copyPlain(value),
          isField: isField(value),
          exposed: view !== undefined,
        });
      }
    }
    return out;
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
        // Straight to the mirror rather than through setPlainParam: that
        // one swallows a rejection, and here the rejection is the report.
        this.mirror.setParam(
          { id: knob.node } as NodeHandle<Record<string, unknown>>,
          knob.name,
          copyPlain(value),
        );
        applied++;
      } catch (err) {
        problems.push(`${key}: ${errorMessage(err)}`);
      }
    }
    if (applied > 0) this.scheduleCook();
    return { applied, problems };
  }

  /** Set a plain (non-field) param on the live graph. */
  setPlainParam(id: string, key: string, value: unknown): void {
    try {
      this.mirror.setParam({ id } as NodeHandle<Record<string, unknown>>, key, copyPlain(value));
    } catch {
      return; // node vanished between UI event and commit
    }
    this.scheduleCook();
  }

  /**
   * Parse a field-expression JSON and set it on a field-capable param.
   * Returns the JSON.parse or fieldFromJson error message verbatim, or
   * null on success.
   */
  applyFieldParam(id: string, key: string, text: string): string | null {
    let spec: unknown;
    try {
      spec = JSON.parse(text);
    } catch (err) {
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
    const pins = new Map<string, { inputs: PinView[]; outputs: PinView[] }>();
    const subgraphs = new Map<string, SubgraphView>();
    const nodes: NodeView[] = [];
    try {
      for (const sn of json.nodes) {
        const view = this.addImportedNode(mirror, sn, subgraphs);
        pins.set(sn.id, view);
        const copy = copyPinViews(view);
        nodes.push({
          id: sn.id,
          type: sn.type,
          ...(sn.ref !== undefined ? { label: sn.ref.name } : {}),
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
    topoLayout(
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
  ): { inputs: PinView[]; outputs: PinView[] } {
    if (sn.type === "subgraph") {
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
      const def = subgraphNode(
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
            ? fieldFromJson(value as FieldSpec)
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
          ? fieldFromJson(value as FieldSpec)
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
          if (col) items.push(...col);
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
      this.hooks.render(items, { fresh });
    }
    this.hooks.status(status);
    this.listener?.(status);
  }
}
