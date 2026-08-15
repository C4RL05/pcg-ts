/**
 * Canvas geometry: node box sizing, pin row positions, and the
 * deterministic topological column layout used for imports and the
 * "layout" button (the serialized graph format carries no positions).
 */
import type { EdgeView, NodeView } from "./model.js";

/** Node box width in canvas units. */
export const NODE_W = 168;

/**
 * Corner radius of a node box, matching the 4px the graph panel's section
 * tabs use — the boxes and those buttons are the two things on screen at
 * roughly the same size, so they are the pair that has to agree.
 *
 * In GRAPH units, so it is 4px at 100% zoom and scales with everything
 * else after that. That is right for canvas content: a corner that stayed
 * 4 screen px while the box shrank would round a small node into a pill.
 */
export const NODE_RADIUS = 4;

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
 * The unit over `PAD` is an optical correction: a band of text wants
 * slightly more air above it than beside it to look even.
 */
export const PAD_TOP = 9;

/** Cap height of the 11px title face, and of the 9px id face below it. */
const TITLE_CAP = 8;
/** Leading between the title baseline and the id baseline. */
const TITLE_TO_ID = 12;

/** Baseline of the type name. Its cap top lands `PAD_TOP` from the top. */
export const TITLE_Y = PAD_TOP + TITLE_CAP;
/** Baseline of the node id, one line under the title. */
export const ID_Y = TITLE_Y + TITLE_TO_ID;

/**
 * The category icon in the header's top-right corner.
 *
 * 12 units, which is one more than the 11px title face — the icon is a
 * filled silhouette where the title is a run of strokes, so matching them
 * by nominal size makes the icon read SMALLER than the word beside it.
 *
 * MEASURED, not hoped for: at the zoom a 78-node graph fits the viewport
 * at — about 0.5, which is the zoom you read a big pipeline's shape at —
 * the silhouettes are still told apart, and so is the 11px title. Below
 * roughly 0.3 they both go, along with the box outlines; at the 0.2 floor
 * the whole canvas is a grey mush and nothing carries. So this does NOT
 * outlive the text, and no amount of size would make it: what gives out
 * first is the box, not the glyph inside it.
 *
 * What it buys instead is a SECOND channel at the readable zooms — a
 * column of eleven boxes reads as "these are all attribute nodes" from
 * the repeated shape, before any of the names have been read one by one.
 * Carried by shape and not colour because the canvas' colour budget is
 * committed elsewhere, and because there are ten categories and nowhere
 * near ten usable hues on a black page.
 */
export const ICON_SIZE = 12;
/**
 * Left edge of the icon, sitting against the RIGHT gutter — the same
 * `PAD` everything else in the box measures from, mirrored.
 *
 * On the right rather than the left so the header reads name-first: the
 * type name is what you scan a column of boxes for, and an icon ahead of
 * it puts a glyph between the eye and the word on every single node. As
 * a right-hand mark it lands in the empty space most titles leave, and
 * the column of glyphs still lines up because the box width is fixed.
 */
export const ICON_X = NODE_W - PAD - ICON_SIZE;
/**
 * Top edge, centred on the two-line header BLOCK (the title's cap top at
 * `PAD_TOP` down to the id's baseline) rather than on the title alone.
 * Aligned to the first line it reads as the title's bullet; centred on the
 * block it reads as the header's mark, which is what it is — the category
 * is a fact about the node, not about its name.
 */
export const ICON_Y = Math.round(PAD_TOP + (ID_Y - PAD_TOP - ICON_SIZE) / 2);
/**
 * Left edge of the header text — the box's own gutter, since the icon no
 * longer sits in front of it.
 *
 * THE TITLE'S BUDGET IS TIGHT, and moving the icon from left to right did
 * not loosen it: the text runs from here to 6 short of the icon, which is
 * the same 134 units it had as an indent, mirrored. (6 rather than `PAD`
 * because the icon's ink runs to its own edge while a glyph carries side
 * bearing of its own, so an equal measured gap looks wider beside the
 * icon than it does at the border.)
 *
 * The box does NOT clip: a title that does not fit spills out over the
 * canvas. Measured against the whole vocabulary, the longest names are 27
 * characters (`filterPrimitivesByAttribute`, and two primitives that a
 * subgraph box titles itself with) at about 129 units rendered, so the
 * margin is roughly five units — one character. Widening the icon,
 * widening that gap, or registering a 28-character type name are all the
 * same bug, and the fix for any of them is to clip the header rather than
 * to shave a unit off here.
 */
export const TEXT_X = PAD;

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
