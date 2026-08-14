/**
 * Canvas geometry: node box sizing, pin row positions, and the
 * deterministic topological column layout used for imports and the
 * "layout" button (the serialized graph format carries no positions).
 */
import type { EdgeView, NodeView } from "./model.js";

/** Node box width in canvas units. */
export const NODE_W = 168;

/**
 * Inner padding on the left, the right and the bottom.
 *
 * SVG text is positioned by its BASELINE, not by its box, so "8 from the
 * top" is not `y = 8` — it is 8 plus the cap height of the face, and
 * getting that wrong is what had the title sitting 5px under the edge
 * while everything beside it sat 9 from the left. The baselines below are
 * derived from these constants rather than typed in.
 */
export const PAD = 8;

/**
 * Space above the title, a little more than `PAD`.
 *
 * Its own constant partly because it is a different measurement — this
 * one runs to the top of the CAPS while the side padding runs to the edge
 * of a glyph — and partly because it is the one that gets tuned by eye.
 * The two units over `PAD` are an optical correction: a band of text
 * wants slightly more air above it than beside it to look even.
 */
export const PAD_TOP = 10;

/** Cap height of the 11px title face, and of the 9px id face below it. */
const TITLE_CAP = 8;
/** Leading between the title baseline and the id baseline. */
const TITLE_TO_ID = 12;

/** Baseline of the type name. Its cap top lands `PAD_TOP` from the top. */
export const TITLE_Y = PAD_TOP + TITLE_CAP;
/** Baseline of the node id, one line under the title. */
export const ID_Y = TITLE_Y + TITLE_TO_ID;

/**
 * Header band height (type name + id).
 *
 * `PAD + 2` below the id's BASELINE rather than PAD: descenders drop
 * about two units past it, so measuring from the baseline alone would
 * leave the gap under a "spawn" or a "yaw" visibly tighter than the gap
 * above the title.
 */
export const HEADER_H = ID_Y + PAD + 2;

/** Vertical spacing between pin rows. */
export const PIN_SPACING = 20;
/**
 * Padding below the last row. Its own constant rather than `PAD` even
 * though the two currently agree: this one is measured from a text
 * BASELINE and the side padding is measured to the edge of a glyph, so
 * they answer different questions and only happen to land on the same
 * number.
 */
export const PAD_BOTTOM = 8;
/** Vertical spacing between param preview rows. */
export const PARAM_SPACING = 13;
/** Gap between the last pin row and the first param row. */
export const PARAM_GAP = 6;

/**
 * Height of the pins band alone — everything above the param preview.
 * Split out because that boundary is where the preview starts, and two
 * places computing it from the same three constants is how they drift.
 */
function pinsHeight(node: NodeView): number {
  const rows = Math.max(node.inputs.length, node.outputs.length, 1);
  return HEADER_H + rows * PIN_SPACING;
}

/**
 * Full height of a node box.
 *
 * `paramRows` is a parameter rather than a property of the node because
 * params are not IN the node view — they live on the controller's graph,
 * and the editor reads them once per revision and hands the count down.
 * Zero is the honest default: a caller with no preview to show gets the
 * box the node had before previews existed.
 */
export function nodeHeight(node: NodeView, paramRows = 0): number {
  const params = paramRows === 0 ? 0 : PARAM_GAP + paramRows * PARAM_SPACING;
  return pinsHeight(node) + params + PAD_BOTTOM;
}

/** Vertical center of pin row `index`, relative to the node's top edge. */
export function pinRowY(index: number): number {
  return HEADER_H + index * PIN_SPACING + PIN_SPACING / 2;
}

/** Where the rule above the param band sits. */
export function paramBandY(node: NodeView): number {
  return pinsHeight(node) + PARAM_GAP / 2;
}

/** Baseline of param preview row `index`. */
export function paramRowY(node: NodeView, index: number): number {
  return pinsHeight(node) + PARAM_GAP + index * PARAM_SPACING + PARAM_SPACING - 3;
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
 *
 * `paramRows` reports how tall each box's preview band is, so a column of
 * boxes stacks without overlapping. Omitted, every box is measured as if
 * it had no preview — which is right for a caller that renders none, and
 * would tuck boxes into each other for one that does.
 */
export function topoLayout(
  nodes: NodeView[],
  edges: EdgeView[],
  paramRows?: ReadonlyMap<string, number>,
): void {
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
      y += nodeHeight(n, paramRows?.get(n.id) ?? 0) + ROW_GAP;
    }
  }
}
