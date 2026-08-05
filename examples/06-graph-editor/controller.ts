/**
 * The non-reactive half of the editor: owns per-node params (which may
 * hold Fields), subgraph payloads, and a live Graph mirror rebuilt from
 * the editor structure through the library's own serialized format —
 * every structural change round-trips deserializeGraph, so the library
 * validates everything and its error messages surface verbatim. Cooks are
 * debounced and run per declared output so one failing branch doesn't
 * blank the rest of the preview.
 */
import {
  Graph,
  cook,
  deserializeGraph,
  fieldFromJson,
  fieldToJson,
  getNodeType,
  isField,
  serializeGraph,
  type DataItem,
  type FieldSpec,
  type NodeHandle,
  type ParamSchema,
  type SerializedGraph,
  type SerializedNode,
} from "pcg-ts";
import { makeRecooker } from "../shared/recook.js";
import { topoLayout } from "./layout.js";
import {
  autoOutputs,
  pinsFromSerializedNode,
  type NodeView,
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

const COOK_DEBOUNCE_MS = 150;

export class EditorController {
  private readonly hooks: ControllerHooks;
  private mirror = new Graph(0);
  /** Node id → live param record; field-capable entries may hold Fields. */
  private readonly params = new Map<string, Record<string, unknown>>();
  /** Node id → original serialized payload for imported subgraph nodes. */
  private readonly rawSubgraph = new Map<string, SerializedNode>();
  private outputNames: string[] = [];
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
   * Rebuild the Graph mirror from the editor structure by synthesizing the
   * serialized format and running it through deserializeGraph. Returns the
   * library's error message on failure (mirror unchanged), else null.
   */
  sync(structure: StructureModel): string | null {
    const ids = new Set(structure.nodes.map((n) => n.id));
    for (const id of [...this.params.keys()]) if (!ids.has(id)) this.params.delete(id);
    for (const id of [...this.rawSubgraph.keys()]) if (!ids.has(id)) this.rawSubgraph.delete(id);
    for (const n of structure.nodes) {
      if (n.type !== "subgraph" && !this.params.has(n.id)) {
        this.params.set(n.id, this.defaultParamsFor(n.type));
      }
    }
    let json: SerializedGraph;
    try {
      json = this.buildJson(structure);
      this.mirror = deserializeGraph(json);
    } catch (err) {
      return errorMessage(err);
    }
    this.outputNames = json.outputs.map((o) => o.name);
    this.scheduleCook();
    return null;
  }

  /**
   * Attempt a connection on the live mirror — the real graph validation
   * (pins, kinds, occupancy, cycles). Returns the library's error message
   * verbatim, or null on success (commit the edge and call sync after).
   */
  tryConnect(edge: { from: string; fromPin: string; to: string; toPin: string }): string | null {
    try {
      this.mirror.connect({ id: edge.from }, edge.fromPin, { id: edge.to }, edge.toPin);
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  setSeed(seed: number): void {
    this.mirror.setSeed(seed);
    this.scheduleCook();
  }

  // -- params --------------------------------------------------------------

  /** Inspector rows for one node (plain data; Fields become spec text). */
  paramViews(id: string, type: string): ParamView[] {
    if (type === "subgraph") return [];
    const schemas = getNodeType(type).info.params;
    const rec = this.params.get(id) ?? {};
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

  /** Set a plain (non-field) param on the model record and the mirror. */
  setPlainParam(id: string, key: string, value: unknown): void {
    const rec = this.params.get(id);
    if (!rec) return;
    rec[key] = copyPlain(value);
    this.mirror.setParam({ id } as NodeHandle<Record<string, unknown>>, key, rec[key]);
    this.scheduleCook();
  }

  /**
   * Parse a field-expression JSON and set it on a field-capable param.
   * Returns the JSON.parse or fieldFromJson error message verbatim, or
   * null on success.
   */
  applyFieldParam(id: string, key: string, text: string): string | null {
    const rec = this.params.get(id);
    if (!rec) return `unknown node "${id}"`;
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
    rec[key] = field;
    this.mirror.setParam({ id } as NodeHandle<Record<string, unknown>>, key, field);
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
   * rebuild the editor model from the parsed serialized format with a
   * deterministic topological layout. Declared outputs are re-derived by
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
    this.params.clear();
    this.rawSubgraph.clear();
    const nodes: NodeView[] = json.nodes.map((sn) => {
      const pins = pinsFromSerializedNode(sn);
      if (sn.type === "subgraph") {
        this.rawSubgraph.set(sn.id, sn);
      } else {
        const rec = this.defaultParamsFor(sn.type);
        const schemas = getNodeType(sn.type).info.params;
        for (const [key, value] of Object.entries(sn.params ?? {})) {
          const schema = schemas[key];
          if (!schema) continue;
          rec[key] =
            schema.acceptsField === true && isPlainObject(value)
              ? fieldFromJson(value as FieldSpec)
              : copyPlain(value);
        }
        this.params.set(sn.id, rec);
      }
      return { id: sn.id, type: sn.type, x: 0, y: 0, inputs: pins.inputs, outputs: pins.outputs };
    });
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

  private defaultParamsFor(type: string): Record<string, unknown> {
    const rec: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(getNodeType(type).info.params)) {
      rec[key] = copyPlain(schema.default);
    }
    return rec;
  }

  private buildJson(structure: StructureModel): SerializedGraph {
    const nodes: SerializedNode[] = structure.nodes.map((n) => {
      if (n.type === "subgraph") {
        const raw = this.rawSubgraph.get(n.id);
        if (!raw) {
          throw new Error(
            `editor: subgraph node "${n.id}" has no stored payload; subgraph nodes can only enter the editor via import`,
          );
        }
        return raw;
      }
      const schemas = getNodeType(n.type).info.params;
      const rec = this.params.get(n.id) ?? this.defaultParamsFor(n.type);
      const params: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(schemas)) {
        const v = rec[key];
        if (schema.type === "items") params[key] = [];
        else if (isField(v)) params[key] = fieldToJson(v);
        else params[key] = copyPlain(v);
      }
      return { id: n.id, type: n.type, params };
    });
    return {
      formatVersion: 1,
      seed: structure.seed >>> 0,
      nodes,
      connections: structure.edges.map((e) => ({
        from: [e.from, e.fromPin] as const,
        to: [e.to, e.toPin] as const,
      })),
      outputs: autoOutputs(structure),
    };
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
    const names = [...this.outputNames];
    const errors: string[] = [];
    const items: DataItem[] = [];
    let cooked = 0;
    let cached = 0;
    const t0 = performance.now();
    for (const name of names) {
      if (graph !== this.mirror) return; // structure changed mid-pass; a newer cook follows
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
    if (graph === this.mirror) this.hooks.render(items);
    this.hooks.status(status);
    this.listener?.(status);
  }
}
