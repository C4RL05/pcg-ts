/**
 * Automatic placement for the canvas: what column a node lands in, what
 * order the nodes in a column sit in, and what height each one sits at.
 *
 * SEPARATE FROM `layout.ts` ON PURPOSE. That file answers "how big is a
 * box and where inside it does the third pin sit" — measured numbers about
 * one node, which this module consumes and never changes. This one answers
 * "where does the box go", which is a question about the whole graph. They
 * were one file while placement was six lines; they are two now that it is
 * three passes.
 *
 * The three passes are the standard layered-drawing decomposition, and
 * they are in this order because each one needs the previous one's answer:
 *
 * 1. **Layering** — which column. Longest-path from the sources, then
 *    relaxed to minimise total horizontal edge span.
 * 2. **Ordering** — the sequence within a column, chosen to reduce
 *    crossings. Edges that skip columns get a placeholder in each column
 *    they cross, so a long edge is ordered against the boxes it passes
 *    rather than ignored by them.
 * 3. **Coordinates** — the actual y of each box, pulled toward the pins it
 *    connects to without letting any two boxes touch.
 *
 * DETERMINISTIC, like everything else in this library: every sort carries
 * an explicit tiebreak on model order, so the same graph lays out the same
 * way on every machine and every run. That is not decoration — the layout
 * runs on import, and a graph that opened differently each time would make
 * every screenshot and every "it looked like this yesterday" a lie.
 */
import type { EdgeView, NodeView } from "./view.js";
import { NODE_W, nodeHeight, pinRowY } from "./layout.js";

/** Horizontal gap between columns. */
const COL_GAP = 72;
/** Minimum vertical gap between two boxes in a column. */
const ROW_GAP = 26;
/**
 * Vertical gap around an edge lane — the space a column reserves for a
 * long edge passing through it. Much tighter than `ROW_GAP` because what
 * it separates is a curve and not a box: a lane wide enough to read is
 * about a stroke plus its glow, where two boxes need enough air to read as
 * two boxes.
 */
const LANE_GAP = 13;
const MARGIN_X = 36;
const MARGIN_Y = 28;

/**
 * Sweeps of the ordering heuristic. Four down-up rounds is where the
 * measured crossing count on the corpus' largest graphs stops improving;
 * the best ordering seen across all rounds is the one kept, so extra
 * rounds cost time and can never cost quality.
 */
const ORDER_ROUNDS = 4;
/** Down-up rounds of the coordinate pass. Same shape of argument. */
const COORD_ROUNDS = 4;
/** How many of those rounds are the two-sided kind. See `assignY`. */
const BALANCE_ROUNDS = 2;

/**
 * One item occupying a slot in a column: either a node box, or a
 * placeholder standing in for an edge passing through.
 *
 * The placeholders are the reason long edges stopped cutting through
 * boxes. An edge from column 1 to column 8 is not a fact about columns 1
 * and 8 — it is a line drawn across the six columns between them, and a
 * layout that only orders the boxes it starts and ends at will happily
 * stack a box exactly where it has to pass. Giving it a zero-height seat
 * in each column it crosses makes it something the other passes can see.
 */
interface Slot {
  /** The node this stands for, or `null` for an edge placeholder. */
  readonly node: NodeView | null;
  readonly layer: number;
  /** Height reserved. Zero for a placeholder: a curve is not a box. */
  readonly height: number;
  /** Model order, or the source node's, so ties break deterministically. */
  readonly key: number;
  /** Position within the column. Rewritten by the ordering pass. */
  order: number;
  y: number;
  /** Higher wins when two slots want the same y. */
  priority: number;
}

/** One column-to-column link: a real edge, or one hop of a split edge. */
interface Link {
  readonly from: Slot;
  readonly to: Slot;
  /** Pin offset from the top of `from`'s box, or 0 for a placeholder. */
  readonly fromY: number;
  readonly toY: number;
}

// -- pass 1: layering ------------------------------------------------------

/**
 * Assign each node a column.
 *
 * Longest-path depth from the sources is where this starts and is where it
 * used to stop. That rule places every node as EARLY as it possibly can,
 * which is the right answer for a node on the critical path and the wrong
 * one for everything else: a `pointLine` feeding a `copyToPoints` seven
 * columns later gets pinned to column 0 and the edge becomes a diagonal
 * across the whole drawing. On the rig graph that was five sweeps of over
 * a thousand units each, and they were the first thing you saw.
 *
 * So the depths are then relaxed. Total horizontal span — the sum of
 * `column(to) - column(from)` over the edges — falls by `d * (in - out)`
 * when a node moves `d` columns right, so the move that helps is: shift a
 * node right when more edges leave it than arrive, left when more arrive
 * than leave, and leave it alone when they balance. Each move strictly
 * lowers a non-negative integer, so this terminates on its own; the
 * iteration cap is a belt on top of braces.
 *
 * Every move stays inside the node's own slack — one past its latest
 * predecessor, one before its earliest successor — so the result is always
 * a legal layering and no edge ever points backwards.
 */
function assignLayers(
  nodes: NodeView[],
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
): Map<string, number> {
  const layer = new Map<string, number>();
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, preds.get(n.id)?.length ?? 0);

  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  const topo: string[] = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string;
    topo.push(id);
    const d = layer.get(id) ?? 0;
    for (const s of succs.get(id) ?? []) {
      layer.set(s, Math.max(layer.get(s) ?? 0, d + 1));
      const remaining = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, remaining);
      if (remaining === 0) queue.push(s);
    }
  }
  // A cycle would leave nodes unvisited. The editor's graphs are validated
  // DAGs, but a defensive column 0 beats an undefined position.
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, 0);

  const order = topo.length === nodes.length ? topo : nodes.map((n) => n.id);
  for (let round = 0; round < 32; round++) {
    let moved = false;
    for (const id of order) {
      const p = preds.get(id) ?? [];
      const s = succs.get(id) ?? [];
      if (s.length === 0) continue;
      const lo = p.reduce((acc, q) => Math.max(acc, (layer.get(q) ?? 0) + 1), 0);
      const hi = s.reduce((acc, q) => Math.min(acc, (layer.get(q) ?? 0) - 1), Infinity);
      // A tie is cost-NEUTRAL, not a reason to stay put, and treating it as
      // one is what stranded a `pointLine → setAttribute → …` chain in
      // column 0 with a five-column edge hanging off it: every node in a
      // chain has one edge in and one out, so nothing in the chain ever
      // had a majority to move on and the whole run sat where the longest
      // path put it. Ties go RIGHT, which walks a chain up against the
      // node that consumes it and lets the columns it vacates close up.
      // Rightward only, so a tie can never undo a move that paid.
      const want = s.length >= p.length ? hi : lo;
      if (!Number.isFinite(want)) continue;
      const next = Math.max(lo, Math.min(hi, want));
      if (next !== layer.get(id)) {
        layer.set(id, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

// -- pass 2: ordering ------------------------------------------------------

/** Crossings among links whose endpoints both sit in ordered columns. */
function countCrossings(links: Link[]): number {
  let total = 0;
  for (let i = 0; i < links.length; i++) {
    const a = links[i] as Link;
    for (let j = i + 1; j < links.length; j++) {
      const b = links[j] as Link;
      if (a.from.layer !== b.from.layer) continue;
      const du = a.from.order - b.from.order;
      const dl = a.to.order - b.to.order;
      if (du * dl < 0) total++;
    }
  }
  return total;
}

/** Median of the neighbour positions, or -1 when there are none. */
function median(positions: number[]): number {
  if (positions.length === 0) return -1;
  positions.sort((a, b) => a - b);
  const m = positions.length >> 1;
  if (positions.length % 2 === 1) return positions[m] as number;
  // The weighted median of Gansner et al.: with an even count, lean toward
  // whichever side is tighter, so a node between one close neighbour and
  // one distant one sits near the close one instead of splitting the
  // difference and lining up with neither.
  const lo = positions[m - 1] as number;
  const hi = positions[m] as number;
  const left = lo - (positions[0] as number);
  const right = (positions[positions.length - 1] as number) - hi;
  if (left + right === 0) return (lo + hi) / 2;
  return (lo * right + hi * left) / (left + right);
}

function reindex(column: Slot[]): void {
  column.sort((a, b) => a.order - b.order || a.key - b.key);
  for (let i = 0; i < column.length; i++) (column[i] as Slot).order = i;
}

/**
 * Order each column to reduce crossings: alternating down and up sweeps of
 * the median heuristic, each followed by an adjacent-swap pass that takes
 * any exchange the medians missed. The best ordering seen is kept, so a
 * sweep that makes things worse costs nothing but the time.
 */
function orderColumns(columns: Slot[][], links: Link[]): void {
  const inLinks = new Map<Slot, Slot[]>();
  const outLinks = new Map<Slot, Slot[]>();
  for (const l of links) {
    let a = outLinks.get(l.from);
    if (!a) outLinks.set(l.from, (a = []));
    a.push(l.to);
    let b = inLinks.get(l.to);
    if (!b) inLinks.set(l.to, (b = []));
    b.push(l.from);
  }

  for (const column of columns) reindex(column);
  let best = columns.map((c) => c.map((s) => s.order));
  let bestScore = countCrossings(links);

  const sweep = (down: boolean): void => {
    const range = down
      ? Array.from({ length: columns.length - 1 }, (_, i) => i + 1)
      : Array.from({ length: columns.length - 1 }, (_, i) => columns.length - 2 - i);
    for (const li of range) {
      const column = columns[li] as Slot[];
      const neighbours = down ? inLinks : outLinks;
      for (const slot of column) {
        const m = median((neighbours.get(slot) ?? []).map((n) => n.order));
        if (m >= 0) slot.order = m;
      }
      reindex(column);
    }
  };

  /** Swap adjacent pairs while it pays. Counts both sides of the column. */
  const transpose = (): void => {
    for (let guard = 0; guard < 8; guard++) {
      let improved = false;
      for (const column of columns) {
        for (let i = 0; i + 1 < column.length; i++) {
          const v = column[i] as Slot;
          const w = column[i + 1] as Slot;
          const before = pairCrossings(v, w, inLinks, outLinks);
          v.order = i + 1;
          w.order = i;
          const after = pairCrossings(w, v, inLinks, outLinks);
          if (after < before) {
            column[i] = w;
            column[i + 1] = v;
            improved = true;
          } else {
            v.order = i;
            w.order = i + 1;
          }
        }
      }
      if (!improved) break;
    }
  };

  for (let round = 0; round < ORDER_ROUNDS; round++) {
    sweep(true);
    transpose();
    sweep(false);
    transpose();
    const score = countCrossings(links);
    if (score < bestScore) {
      bestScore = score;
      best = columns.map((c) => c.map((s) => s.order));
    }
  }
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i] as Slot[];
    const saved = best[i] as number[];
    for (let j = 0; j < column.length; j++) (column[j] as Slot).order = saved[j] as number;
    reindex(column);
  }
}

/** Crossings between the links of two column-neighbours, `v` above `w`. */
function pairCrossings(
  v: Slot,
  w: Slot,
  inLinks: Map<Slot, Slot[]>,
  outLinks: Map<Slot, Slot[]>,
): number {
  let total = 0;
  for (const side of [inLinks, outLinks]) {
    const a = side.get(v) ?? [];
    const b = side.get(w) ?? [];
    for (const p of a) for (const q of b) if (p.order > q.order) total++;
  }
  return total;
}

// -- pass 3: coordinates ---------------------------------------------------

/**
 * Minimum gap between two slots.
 *
 * `ROW_GAP` is what two BOXES need, and it is a number about reading: two
 * boxes closer than that stop reading as two boxes. A lane is a curve, and
 * what a curve needs is clearance — enough not to graze the outline it
 * passes. So any pair involving a lane gets the smaller number, whether the
 * other side is a curve or a box. Charging a lane the full row gap on both
 * sides made every edge crossing a column cost as much vertical space as a
 * whole node, which is what the height was going on.
 */
function separation(a: Slot, b: Slot): number {
  return a.node === null || b.node === null ? LANE_GAP : ROW_GAP;
}

/** Stack a column downward from its first slot, closing overlaps only. */
function compactDown(column: Slot[], from: number): void {
  for (let i = Math.max(1, from); i < column.length; i++) {
    const prev = column[i - 1] as Slot;
    const cur = column[i] as Slot;
    const floor = prev.y + prev.height + separation(prev, cur);
    if (cur.y < floor) cur.y = floor;
  }
}

/** The same upward, for a slot that moved up into the one above it. */
function compactUp(column: Slot[], from: number): void {
  for (let i = Math.min(column.length - 2, from); i >= 0; i--) {
    const next = column[i + 1] as Slot;
    const cur = column[i] as Slot;
    const ceiling = next.y - separation(cur, next) - cur.height;
    if (cur.y > ceiling) cur.y = ceiling;
  }
}

/**
 * Move one slot toward `want`, pushing lower-priority neighbours out of the
 * way and stopping dead at the first one that outranks it.
 *
 * The priority is what keeps a long edge straight through a crowded
 * column. Placeholders outrank every box, so a box that wants the lane's y
 * yields and the edge stays a horizontal line; two boxes settle it by
 * degree, because the one with more connections has more edges to bend if
 * it loses.
 */
function shiftTo(column: Slot[], index: number, want: number): void {
  const slot = column[index] as Slot;
  const delta = want - slot.y;
  if (Math.abs(delta) < 0.5) return;
  if (delta > 0) {
    let limit = Infinity;
    let room = 0;
    for (let i = index + 1; i < column.length; i++) {
      const other = column[i] as Slot;
      room += separation(column[i - 1] as Slot, other) + (column[i - 1] as Slot).height;
      if (other.priority >= slot.priority) {
        limit = other.y - slot.y - room;
        break;
      }
    }
    slot.y += Math.min(delta, Math.max(0, limit));
    compactDown(column, index + 1);
  } else {
    let limit = Infinity;
    let room = 0;
    for (let i = index - 1; i >= 0; i--) {
      const other = column[i] as Slot;
      room += separation(other, column[i + 1] as Slot) + other.height;
      if (other.priority >= slot.priority) {
        limit = slot.y - other.y - room;
        break;
      }
    }
    slot.y -= Math.min(-delta, Math.max(0, limit));
    compactUp(column, index - 1);
  }
}

/**
 * Choose the y of every slot.
 *
 * Alternating sweeps: going right, each slot is pulled so its own pin lines
 * up with the median of the pins feeding it; going left, so it lines up
 * with what it feeds. Aligning PINS rather than box tops is the whole
 * point — an edge is horizontal when the two ports agree, and two boxes
 * with their tops level have their third pins twenty units apart.
 *
 * Slots are moved in descending priority so the ones that matter claim
 * their y first and the rest fit around them.
 */
function assignY(columns: Slot[][], links: Link[]): void {
  const into = new Map<Slot, Link[]>();
  const outOf = new Map<Slot, Link[]>();
  for (const l of links) {
    let a = outOf.get(l.from);
    if (!a) outOf.set(l.from, (a = []));
    a.push(l);
    let b = into.get(l.to);
    if (!b) into.set(l.to, (b = []));
    b.push(l);
  }

  for (const column of columns) {
    let y = 0;
    for (const slot of column) {
      slot.y = y;
      y += slot.height + ROW_GAP;
    }
  }

  /**
   * `sided` sweeps look one way only — right-going aligns a box with what
   * feeds it, left-going with what it feeds. Alternating them is what makes
   * a chain straight. But a one-sided sweep also has no reason to come
   * back: a box follows whichever side it is currently listening to, and
   * the drawing keeps growing outward. The last rounds are two-sided, where
   * a box answers to everything it touches at once, which pulls the
   * stragglers back in and takes about a tenth off the total height.
   */
  const settle = (li: number, sided: "down" | "up" | "both"): void => {
    const column = columns[li] as Slot[];
    const byPriority = column
      .map((slot, index) => ({ slot, index }))
      .sort((a, b) => b.slot.priority - a.slot.priority || a.index - b.index);
    for (const { slot, index } of byPriority) {
      const wants: number[] = [];
      if (sided !== "up") {
        for (const l of into.get(slot) ?? []) wants.push(l.from.y + l.fromY - l.toY);
      }
      if (sided !== "down") {
        for (const l of outOf.get(slot) ?? []) wants.push(l.to.y + l.toY - l.fromY);
      }
      if (wants.length > 0) shiftTo(column, index, median(wants));
    }
    compactDown(column, 1);
  };

  for (let round = 0; round < COORD_ROUNDS; round++) {
    const both = round >= COORD_ROUNDS - BALANCE_ROUNDS;
    for (let li = 0; li < columns.length; li++) settle(li, both ? "both" : "down");
    for (let li = columns.length - 1; li >= 0; li--) settle(li, both ? "both" : "up");
  }

  let min = Infinity;
  for (const column of columns) for (const slot of column) min = Math.min(min, slot.y);
  const shift = MARGIN_Y - min;
  for (const column of columns) for (const slot of column) slot.y += shift;
}

// -- entry -----------------------------------------------------------------

/**
 * Place every node. Mutates `x`/`y` in place, because the serialized graph
 * format carries no positions and the editor's model is the only place
 * they live.
 *
 * `paramRows` reports how tall each box's preview band is. Omitted, every
 * box is measured as if it had none — right for a caller that renders none,
 * and a column of boxes tucked into each other for one that does.
 */
export function autoLayout(
  nodes: NodeView[],
  edges: EdgeView[],
  paramRows?: ReadonlyMap<string, number>,
): void {
  if (nodes.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const real = edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of real) {
    let p = preds.get(e.to);
    if (!p) preds.set(e.to, (p = []));
    p.push(e.from);
    let s = succs.get(e.from);
    if (!s) succs.set(e.from, (s = []));
    s.push(e.to);
  }

  const layer = assignLayers(nodes, preds, succs);
  const width = Math.max(...nodes.map((n) => (layer.get(n.id) ?? 0) + 1));
  const columns: Slot[][] = Array.from({ length: width }, () => []);

  const slotOf = new Map<string, Slot>();
  for (const n of nodes) {
    const li = layer.get(n.id) ?? 0;
    const slot: Slot = {
      node: n,
      layer: li,
      height: nodeHeight(n, paramRows?.get(n.id) ?? 0),
      key: index.get(n.id) ?? 0,
      order: 0,
      y: 0,
      priority: (preds.get(n.id)?.length ?? 0) + (succs.get(n.id)?.length ?? 0),
    };
    slotOf.set(n.id, slot);
    (columns[li] as Slot[]).push(slot);
  }

  /** Pin row offset, or the middle of a placeholder's non-existent box. */
  const portY = (slot: Slot, pin: string, side: "in" | "out"): number => {
    if (slot.node === null) return 0;
    const pins = side === "in" ? slot.node.inputs : slot.node.outputs;
    const i = pins.findIndex((p) => p.name === pin);
    return pinRowY(i < 0 ? 0 : i);
  };

  const links: Link[] = [];
  for (let ei = 0; ei < real.length; ei++) {
    const e = real[ei] as EdgeView;
    const a = slotOf.get(e.from) as Slot;
    const b = slotOf.get(e.to) as Slot;
    const fromY = portY(a, e.fromPin, "out");
    const toY = portY(b, e.toPin, "in");
    if (b.layer - a.layer <= 1) {
      links.push({ from: a, to: b, fromY, toY });
      continue;
    }
    // Skips columns: seat a placeholder in each one it passes through, so
    // the ordering and coordinate passes route around it instead of
    // stacking a box across it.
    let prev = a;
    let prevY = fromY;
    for (let li = a.layer + 1; li < b.layer; li++) {
      const lane: Slot = {
        node: null,
        layer: li,
        height: 0,
        // Keyed off the source so a column's placeholders start out in the
        // same relative order as the boxes they came from; the edge index
        // keeps two lanes from the same node apart.
        key: (index.get(e.from) ?? 0) + ei / (real.length + 1),
        order: 0,
        y: 0,
        // Above every box: a box has one bend to pay, a lane has two.
        priority: Number.MAX_SAFE_INTEGER,
      };
      (columns[li] as Slot[]).push(lane);
      links.push({ from: prev, to: lane, fromY: prevY, toY: 0 });
      prev = lane;
      prevY = 0;
    }
    links.push({ from: prev, to: b, fromY: prevY, toY });
  }

  for (const column of columns) {
    column.sort((a, b) => a.key - b.key);
    for (let i = 0; i < column.length; i++) (column[i] as Slot).order = i;
  }

  orderColumns(columns, links);
  assignY(columns, links);

  for (const n of nodes) {
    const slot = slotOf.get(n.id) as Slot;
    n.x = MARGIN_X + slot.layer * (NODE_W + COL_GAP);
    n.y = Math.round(slot.y);
  }
}
