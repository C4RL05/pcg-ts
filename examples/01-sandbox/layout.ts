/**
 * Canvas geometry: node box sizing, pin row positions, and the
 * deterministic topological column layout used for imports and the
 * "layout" button (the serialized graph format carries no positions).
 */
import type { EdgeView, NodeView } from "./model.js";

/** Node box width in canvas units. */
export const NODE_W = 168;
/** Header band height (type name + id). */
export const HEADER_H = 30;
/** Vertical spacing between pin rows. */
export const PIN_SPACING = 20;
/** Padding below the last pin row. */
export const PAD_BOTTOM = 8;

/** Full height of a node box. */
export function nodeHeight(node: NodeView): number {
  const rows = Math.max(node.inputs.length, node.outputs.length, 1);
  return HEADER_H + rows * PIN_SPACING + PAD_BOTTOM;
}

/** Vertical center of pin row `index`, relative to the node's top edge. */
export function pinRowY(index: number): number {
  return HEADER_H + index * PIN_SPACING + PIN_SPACING / 2;
}

const COL_GAP = 72;
const ROW_GAP = 26;
const MARGIN_X = 36;
const MARGIN_Y = 28;

/**
 * Deterministic layout: longest-path depth from the sources assigns each
 * node a column; nodes stack top-to-bottom within a column in model
 * order. Mutates node x/y in place. Edges always describe a DAG (they
 * come from validated graphs), but leftovers are still placed defensively.
 */
export function topoLayout(nodes: NodeView[], edges: EdgeView[]): void {
  const depth = new Map<string, number>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const e of edges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);

  const queue: string[] = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const d = depth.get(id) ?? 0;
    for (const e of edges) {
      if (e.from !== id) continue;
      depth.set(e.to, Math.max(depth.get(e.to) ?? 0, d + 1));
      const remaining = (indegree.get(e.to) ?? 0) - 1;
      indegree.set(e.to, remaining);
      if (remaining === 0) queue.push(e.to);
    }
  }

  const columns = new Map<number, NodeView[]>();
  for (const n of nodes) {
    const col = depth.get(n.id) ?? 0;
    let list = columns.get(col);
    if (!list) columns.set(col, (list = []));
    list.push(n);
  }
  for (const [col, list] of columns) {
    let y = MARGIN_Y;
    for (const n of list) {
      n.x = MARGIN_X + col * (NODE_W + COL_GAP);
      n.y = y;
      y += nodeHeight(n) + ROW_GAP;
    }
  }
}
