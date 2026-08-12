/**
 * The non-reactive half of the editor: owns the live Graph mirror. Since
 * phase 16/17 the mirror is mutated in place through the graph API —
 * add/connect for creation, removeNode/disconnect for deletion — with no
 * rebuild through the serialized format, so node caches on untouched
 * branches survive every structural edit (the cook stats prove it).
 * Params live on the graph itself (getParams/setParam; field-capable
 * entries may hold Fields), subgraph pins come from describeSubgraphPins,
 * and declared outputs follow the auto policy (every unconnected output
 * pin) via output/removeOutput deltas. Import validates and rebuilds via
 * deserializeGraph — the one place a fresh graph replaces the mirror —
 * and export reads serializeGraph. Cooks are debounced and run per
 * declared output so one failing branch doesn't blank the rest of the
 * preview.
 */
import {
  Graph,
  cook,
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
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  type SerializedExposedPin,
  type SerializedGraph,
  type SerializedNode,
  type SerializedSubgraph,
} from "pcg-ts";
import { makeRecooker } from "../shared/recook.js";
import { topoLayout } from "./layout.js";
import {
  nodePinsForType,
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

/** One structural edge, as the canvas reports it. */
export interface EdgeRef {
  readonly from: string;
  readonly fromPin: string;
  readonly to: string;
  readonly toPin: string;
}

/** Host callbacks: scene rendering and stats display. */
export interface ControllerHooks {
  render(items: readonly DataItem[]): void;
  status(s: CookStatus): void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  /** Declared output names in canonical (node insertion) order. */
  private outputNames: string[] = [];
  /** Bumped on every structural edit, so a stale cook pass abandons itself. */
  private structureRev = 0;
  private cookTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly recook: () => void;
  private listener: ((s: CookStatus) => void) | undefined;

  constructor(hooks: ControllerHooks) {
    this.hooks = hooks;
    this.recook = makeRecooker(() => this.cookAll());
  }

  /** The UI's status subscription (the hooks get every status too). */
  setStatusListener(cb: (s: CookStatus) => void): void {
    this.listener = cb;
  }

  /** Registry description for a node type (used as inspector help text). */
  typeDescription(type: string): string {
    return getNodeType(type).info.description;
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
    if (type === "subgraph") return [];
    const schemas = getNodeType(type).info.params;
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
    const nodes: NodeView[] = [];
    try {
      for (const sn of json.nodes) {
        const view = this.addImportedNode(mirror, sn);
        pins.set(sn.id, view);
        const copy = copyPinViews(view);
        nodes.push({ id: sn.id, type: sn.type, x: 0, y: 0, inputs: copy.inputs, outputs: copy.outputs });
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
    this.afterStructuralEdit();
    const edges = (json.connections ?? []).map((c) => ({
      from: c.from[0],
      fromPin: c.from[1],
      to: c.to[0],
      toPin: c.to[1],
    }));
    topoLayout(nodes, edges);
    return { structure: { seed: json.seed >>> 0, nodes, edges } };
  }

  // -- internals -------------------------------------------------------------

  /** Add one serialized node to a fresh mirror; returns its pin views. */
  private addImportedNode(
    mirror: Graph,
    sn: SerializedNode,
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
    const desired = new Map<string, { id: string; pin: string }>();
    for (const n of d.nodes) {
      for (const p of this.pins.get(n.id)?.outputs ?? []) {
        if (!connected(n.id, p.name)) desired.set(`${n.id}.${p.name}`, { id: n.id, pin: p.name });
      }
    }
    const have = new Set<string>();
    for (const o of d.outputs) {
      if (desired.has(o.name)) have.add(o.name);
      else this.mirror.removeOutput(o.name);
    }
    for (const [name, { id, pin }] of desired) {
      if (!have.has(name)) this.mirror.output({ id }, pin, name);
    }
    this.outputNames = [...desired.keys()];
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
    const t0 = performance.now();
    for (const name of names) {
      if (stale()) return; // structure changed mid-pass; a newer cook follows
      try {
        const r = await cook(graph, { outputs: [name] });
        cooked += r.stats.cooked;
        cached += r.stats.cached;
        const col = r.outputs[name];
        if (col) items.push(...col);
      } catch (err) {
        errors.push(errorMessage(err));
      }
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
    };
    if (!stale()) this.hooks.render(items);
    this.hooks.status(status);
    this.listener?.(status);
  }
}
