/**
 * A serialized graph, read as a picture of itself.
 *
 * This is the whole read-only path. The editor builds its view model out
 * of a live mirror `Graph` because it has to be able to change one — a
 * param write has to land somewhere real, and a new connection has to be
 * refused by the same code that would refuse it at cook time. Nothing here
 * can change anything, so nothing here needs a mirror: the serialized form
 * already carries every value, and building a second Graph to read them
 * back out of would cost the demos a full graph construction to draw a
 * thumbnail.
 *
 * It follows that this reader NEVER VALIDATES. A graph reaching it has
 * already been built and cooked by the page showing it, so a param it
 * cannot classify is a param it prints plainly rather than an error it
 * raises — the picture degrades one row at a time, and a demo does not
 * fail to load because one node's value did not fit a category.
 */
import { printFieldSpec, type SerializedGraph, type SerializedNode } from "pcg-ts";
import { autoLayout } from "./autoLayout.js";
import {
  fmtNumber,
  nodeCategory,
  nodePinsForType,
  previewRows,
  type EdgeView,
  type NodeView,
  type ParamPreview,
  type PinView,
  type PreviewRow,
} from "./view.js";

/** A graph laid out and ready to draw. */
export interface GraphPicture {
  readonly nodes: NodeView[];
  readonly edges: EdgeView[];
  readonly previews: ReadonlyMap<string, readonly ParamPreview[]>;
}

/** A field-valued param, as the serialized form carries one. */
function isFieldSpec(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "fn" in v;
}

function fmtParam(v: unknown): string {
  if (isFieldSpec(v)) {
    try {
      return `ƒ ${printFieldSpec(v as never).replace(/\s+/g, " ")}`;
    } catch {
      // A spec the printer refused. The box still says WHICH KIND of
      // answer this is, which is the part that changes how the node
      // behaves; the expression is the part it cannot show.
      return "ƒ";
    }
  }
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return v === "" ? "–" : v;
  if (Array.isArray(v)) {
    return v.length === 0
      ? "–"
      : v.map((x) => (typeof x === "number" ? fmtNumber(x) : String(x))).join(", ");
  }
  return v === undefined || v === null ? "–" : "…";
}

/**
 * The pins a node draws.
 *
 * The registry knows them for every standard node type. It does NOT know
 * them for a `subgraph` or `forEach` node, whose pins come from the graph
 * it wraps — the editor resolves those through the live def it built, and
 * there is no live def here. So a wrapper falls back to the pins the
 * CONNECTIONS prove it has, which is exactly the set that has anything
 * drawn to it: an unwired pin on a wrapper would be a name with no cable,
 * and this view has no way to offer it one.
 */
function pinsFor(node: SerializedNode, used: UsedPins): { inputs: PinView[]; outputs: PinView[] } {
  try {
    return nodePinsForType(node.type);
  } catch {
    const derived = (names: ReadonlySet<string> | undefined): PinView[] =>
      [...(names ?? [])].map((name) => ({ name, kind: "any", multi: false }));
    return { inputs: derived(used.inputs.get(node.id)), outputs: derived(used.outputs.get(node.id)) };
  }
}

interface UsedPins {
  readonly inputs: Map<string, Set<string>>;
  readonly outputs: Map<string, Set<string>>;
}

function usedPins(json: SerializedGraph): UsedPins {
  const inputs = new Map<string, Set<string>>();
  const outputs = new Map<string, Set<string>>();
  const note = (into: Map<string, Set<string>>, id: string, pin: string): void => {
    let set = into.get(id);
    if (!set) into.set(id, (set = new Set()));
    set.add(pin);
  };
  for (const c of json.connections ?? []) {
    note(outputs, c.from[0], c.from[1]);
    note(inputs, c.to[0], c.to[1]);
  }
  // A declared output is a pin too, and on a wrapper it may be the only
  // evidence the terminal node has one.
  for (const o of json.outputs ?? []) note(outputs, o.id, o.pin);
  return { inputs, outputs };
}

/**
 * Lay a serialized graph out and describe every box in it.
 *
 * Positions are invented here, the same way the editor invents them on
 * import: the format carries none, and the same {@link autoLayout} run
 * against the same node order gives the same picture every time — so two
 * pages showing one graph show it identically, and a demo's thumbnail
 * does not reshuffle between reloads.
 */
export function readGraph(json: SerializedGraph): GraphPicture {
  const used = usedPins(json);
  const previews = new Map<string, readonly ParamPreview[]>();
  const nodes: NodeView[] = json.nodes.map((sn) => {
    const pins = pinsFor(sn, used);
    const category = nodeCategory(sn.type);
    const rows: PreviewRow[] = Object.entries(sn.params).map(([key, v]) => ({
      key,
      value: fmtParam(v),
      field: isFieldSpec(v),
    }));
    previews.set(sn.id, previewRows(rows));
    return {
      id: sn.id,
      type: sn.type,
      ...(sn.ref !== undefined ? { label: sn.ref.name } : {}),
      ...(category !== undefined ? { category } : {}),
      x: 0,
      y: 0,
      inputs: pins.inputs,
      outputs: pins.outputs,
    };
  });
  const edges: EdgeView[] = (json.connections ?? []).map((c) => ({
    from: c.from[0],
    fromPin: c.from[1],
    to: c.to[0],
    toPin: c.to[1],
  }));
  // Laid out at the height the boxes will actually be drawn at. Measuring
  // them as bare boxes lays a column out shorter than it renders, and the
  // param bands then overlap the box below.
  autoLayout(nodes, edges, new Map([...previews].map(([id, rows]) => [id, rows.length])));
  return { nodes, edges, previews };
}
