/**
 * Geometry for the read-only field-expression diagram.
 *
 * Pure TypeScript, no Svelte: `FieldTree.svelte` draws exactly what this
 * returns, the way `NodeBox.svelte` draws what `layout.ts` computes. The
 * split is the same one and for the same reason — the box heights and the
 * row baselines are arithmetic, and arithmetic in a template is arithmetic
 * nobody can read back.
 *
 * The direction matches the node canvas: left-to-right dataflow, so an
 * argument sits to the LEFT of the expression that consumes it and the
 * root of the spec sits at the far right.
 *
 * Children come from `specChildEntries` and from nothing else. The five
 * positions a spec can hang a child off (`args`, `opts.position`,
 * `opts.seed.variant`, `cases`, `default`) are enumerated there once, and
 * a second enumeration here is what that function exists to prevent — so
 * this module never reads `args` or `cases` itself.
 */
import { listFieldFnInfos, specChildEntries, type SpecChild } from "pcg-ts";

/** Box width. 140 is what fits a two-column row inside the modal. */
export const BOX_W = 140;
/** Horizontal distance between one depth and the next, box included. */
export const COL_W = 210;
/** Vertical pitch of the leaf cursor. */
export const ROW_H = 96;
/** Breathing room a box keeps under the one placed before it. */
export const V_GAP = 18;
/** Margin around the whole diagram, so no stroke lands on the edge. */
export const MARGIN = 14;

/** Horizontal inset of the text columns, as `layout.ts` uses `PAD`. */
export const PAD = 8;
/** Baseline of the `fn` title. */
export const TITLE_Y = 15;
/** Where the rule under the title sits, and where the rows start. */
export const HEADER_H = 23;
/** Vertical pitch of one row. */
export const ROW_SPACING = 14;
/** Space under the last row. */
export const PAD_BOTTOM = 6;

/**
 * How deep the walk goes before it stops descending. The JSON is a tree
 * and cannot be cyclic, so this is not cycle handling — it is a bound on
 * malformed input, because a panel that hangs is worse than a panel that
 * says it stopped looking.
 */
const MAX_DEPTH = 64;

/** Longest label and value a row shows before it clips, at 9px mono. */
const MAX_LABEL = 12;
const MAX_VALUE = 13;
/** Longest `fn` a title shows, at 11px sans. */
const MAX_TITLE = 18;

/** One line inside a box: a named position, or one of the node's literals. */
export interface FieldTreeRow {
  /** Left column: the arg name, the case key, or the literal's key. */
  readonly label: string;
  /**
   * Right column, already formatted and clipped — or null when this row
   * is FED BY A WIRE and so carries a pin instead of any text.
   */
  readonly value: string | null;
  /** The row has an input pin on the box's left edge. */
  readonly pin: boolean;
}

/** One box: a spec object, and only ever a spec object. */
export interface FieldTreeNode {
  /**
   * The node's JSON path from the root — `args[0].opts.position`. Unique
   * by construction, which makes it the key, and legible, which makes it
   * the tooltip. The root's own path is the empty string.
   */
  readonly id: string;
  readonly fn: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rows: readonly FieldTreeRow[];
}

/** One wire, from a child box's right edge to its consumer's row pin. */
export interface FieldTreeEdge {
  /** Id of the child box the wire leaves. */
  readonly from: string;
  /** Id of the consuming box the wire enters. */
  readonly to: string;
  /** The consuming row's label — what this wire feeds. */
  readonly label: string;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export interface FieldTreeLayout {
  readonly nodes: readonly FieldTreeNode[];
  readonly edges: readonly FieldTreeEdge[];
  readonly width: number;
  readonly height: number;
}

/** Full height of a box holding `rows` rows. */
export function boxHeight(rows: number): number {
  return HEADER_H + rows * ROW_SPACING + PAD_BOTTOM;
}

/** Vertical centre of row `index`, relative to the box's top edge. */
export function rowCenterY(index: number): number {
  return HEADER_H + index * ROW_SPACING + ROW_SPACING / 2;
}

/** Baseline of row `index`. Three units under the centre reads level. */
export function rowBaselineY(index: number): number {
  return rowCenterY(index) + 3;
}

/** Trim a rendered value to what fits the box, as `model.ts` does. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(2)));
}

/** Whatever sits in a literal position, as one short string. */
function fmtLiteral(v: unknown): string {
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return `[${v.map((x) => (typeof x === "number" ? fmtNumber(x) : String(x))).join(", ")}]`;
  }
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A value that becomes a BOX. Only a spec object does; a number in an
 * `args` slot is a literal and renders inline on its consumer's row.
 */
export function isSpecObject(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && typeof v.fn === "string";
}

/** A literal worth showing on a row: a scalar, or a tuple of them. */
function isShowableLiteral(v: unknown): boolean {
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return true;
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

/**
 * Registered argument names by `fn`, read once and kept. The grammar's
 * `specChildEntries` names positions from STRUCTURE alone — `args[0]`,
 * never `edge` — because it sits below the registry; the registry is
 * where the names live, and this is the join between the two.
 */
let argNamesByFn: Map<string, readonly string[]> | null = null;

function argName(fn: string, child: SpecChild & { kind: "arg" }): string {
  if (argNamesByFn === null) {
    argNamesByFn = new Map(
      listFieldFnInfos().map((info) => [info.fn, (info.args ?? []).map((a) => a.name)] as const),
    );
  }
  const names = argNamesByFn.get(fn);
  // A VARIADIC position publishes ONE name for all of its arguments and
  // marks it with a trailing ellipsis — `vec` declares `components…` and
  // nothing else. Every argument from that name onward belongs to the
  // run, so they are numbered instead of named: three rows reading
  // `components…`, `a1`, `a2` claim the last two are other positions,
  // and `components[0]`/`[1]`/`[2]` is too wide for the label column and
  // clips to `components[…`, which says less than the bare index does.
  // The box header already carries the only name there is.
  const runStart = names !== undefined && names.length > 0 && names[names.length - 1].endsWith("…")
    ? names.length - 1
    : Infinity;
  if (child.index >= runStart) return `[${child.index}]`;
  const name = names?.[child.index];
  // An unregistered `fn` has no names at all. Fall back to the position
  // the grammar itself gave us, which is at least true.
  return name ?? child.path;
}

function rowLabel(fn: string, child: SpecChild): string {
  switch (child.kind) {
    case "arg":
      return argName(fn, child);
    case "position":
      return "position";
    case "variant":
      return "variant";
    case "case":
      return child.key;
    case "default":
      return "default";
  }
}

/** Spec keys that are structure, not content — the child positions. */
const STRUCTURAL_KEYS = new Set(["fn", "args", "opts", "cases", "default"]);

interface Built {
  readonly id: string;
  readonly fn: string;
  readonly depth: number;
  readonly rows: FieldTreeRow[];
  readonly kids: { readonly row: number; readonly node: Built }[];
}

function build(spec: Record<string, unknown>, id: string, depth: number): Built {
  const fn = String(spec.fn);
  const rows: FieldTreeRow[] = [];
  const kids: { row: number; node: Built }[] = [];

  // The named positions first, so the pins sit under the title the way a
  // NodeBox's pins sit above its param band.
  for (const child of specChildEntries(spec)) {
    const label = clip(rowLabel(fn, child), MAX_LABEL);
    if (isSpecObject(child.value)) {
      if (depth + 1 >= MAX_DEPTH) {
        // Deeper than anything real. Say the position is filled rather
        // than descending forever into malformed input.
        rows.push({ label, value: "…", pin: false });
        continue;
      }
      rows.push({ label, value: null, pin: true });
      const path = id === "" ? child.path : `${id}.${child.path}`;
      kids.push({ row: rows.length - 1, node: build(child.value, path, depth + 1) });
    } else {
      rows.push({ label, value: clip(fmtLiteral(child.value), MAX_VALUE), pin: false });
    }
  }

  // Then the node's own literals — `name` on an attribute, `value` on a
  // constant, `base` on an fbm. Read off the object rather than enumerated
  // per fn: a table of "which key identifies which fn" is a second copy of
  // the grammar, and it would be missing the next fn added to it.
  for (const [key, value] of Object.entries(spec)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (!isShowableLiteral(value)) continue;
    rows.push({ label: clip(key, MAX_LABEL), value: clip(fmtLiteral(value), MAX_VALUE), pin: false });
  }
  // `opts` is structure at the top level and content one level in: the
  // noise settings (`frequency`, `octaves`, `normalized`) are what tell
  // two noises apart. `position` is a child position and is already a row;
  // an object `seed` holds its `variant` the same way.
  const opts = spec.opts;
  if (isPlainObject(opts)) {
    for (const [key, value] of Object.entries(opts)) {
      if (key === "position") continue;
      if (key === "seed" && isPlainObject(value)) continue;
      if (!isShowableLiteral(value)) continue;
      rows.push({
        label: clip(key, MAX_LABEL),
        value: clip(fmtLiteral(value), MAX_VALUE),
        pin: false,
      });
    }
  }

  return { id, fn, depth, rows, kids };
}

interface Placed {
  readonly built: Built;
  /** Mutable: the per-column separation sweep pushes boxes down. */
  cy: number;
  readonly h: number;
}

/**
 * Lay a parsed field spec out as boxes and wires.
 *
 * Returns an empty layout for anything that is not a spec object — a bare
 * number, a string, `null`. The caller says so in a line of text; there is
 * nothing here to draw.
 */
export function layoutFieldTree(root: unknown): FieldTreeLayout {
  if (!isSpecObject(root)) return { nodes: [], edges: [], width: 0, height: 0 };

  const tree = build(root, "", 0);

  // Post-order: a childless box takes the next free row, and a box with
  // box-children is centred between the first and the last of them. The
  // cursor is what keeps a tall box from landing on the one above it —
  // `ROW_H` alone assumes every box is the same height, and a noise with
  // five settings is not.
  const placed = new Map<string, Placed>();
  let row = 0;
  let cursor = 0;
  let maxDepth = 0;

  function place(node: Built): number {
    if (node.depth > maxDepth) maxDepth = node.depth;
    const h = boxHeight(node.rows.length);
    let cy: number;
    if (node.kids.length === 0) {
      const top = Math.max(row * ROW_H, cursor);
      cy = top + h / 2;
      row += 1;
      cursor = top + h + V_GAP;
    } else {
      const centers = node.kids.map((kid) => place(kid.node));
      cy = (centers[0] + centers[centers.length - 1]) / 2;
    }
    placed.set(node.id, { built: node, cy, h });
    return cy;
  }
  place(tree);

  // The cursor above separates LEAVES, and leaves are not the only thing
  // that can collide: a parent is centred on its children, and two
  // parents in the SAME COLUMN know nothing about each other, so an fbm
  // with five settings lands on the worleyNoise beside it. Boxes only
  // ever overlap within a column — the columns are a fixed pitch apart —
  // so one sweep per column, in order, pushing each box clear of the one
  // above it, is the whole fix.
  //
  // This costs a parent its exact centring, which is the same trade every
  // tidy-tree layout makes: overlapping boxes are unreadable, a parent
  // sitting a few pixels off its children's midpoint is not.
  const columns = new Map<number, Placed[]>();
  for (const p of placed.values()) {
    const column = columns.get(p.built.depth);
    if (column === undefined) columns.set(p.built.depth, [p]);
    else column.push(p);
  }
  for (const column of columns.values()) {
    column.sort((a, b) => a.cy - b.cy);
    let bottom = -Infinity;
    for (const p of column) {
      const top = Math.max(p.cy - p.h / 2, bottom);
      p.cy = top + p.h / 2;
      bottom = top + p.h + V_GAP;
    }
  }

  // Centring a parent on its children can push it above the topmost leaf,
  // so the diagram is normalised to the margin rather than assumed to
  // start at zero.
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const p of placed.values()) {
    minTop = Math.min(minTop, p.cy - p.h / 2);
    maxBottom = Math.max(maxBottom, p.cy + p.h / 2);
  }
  const shift = MARGIN - minTop;

  const nodes: FieldTreeNode[] = [];
  const byId = new Map<string, FieldTreeNode>();
  for (const p of placed.values()) {
    const node: FieldTreeNode = {
      id: p.built.id,
      fn: clip(p.built.fn, MAX_TITLE),
      x: MARGIN + (maxDepth - p.built.depth) * COL_W,
      y: p.cy - p.h / 2 + shift,
      w: BOX_W,
      h: p.h,
      rows: p.built.rows,
    };
    nodes.push(node);
    byId.set(node.id, node);
  }

  const edges: FieldTreeEdge[] = [];
  for (const p of placed.values()) {
    const parent = byId.get(p.built.id);
    if (parent === undefined) continue;
    for (const kid of p.built.kids) {
      const child = byId.get(kid.node.id);
      if (child === undefined) continue;
      edges.push({
        from: child.id,
        to: parent.id,
        label: parent.rows[kid.row].label,
        ax: child.x + child.w,
        ay: child.y + child.h / 2,
        bx: parent.x,
        by: parent.y + rowCenterY(kid.row),
      });
    }
  }

  return {
    nodes,
    edges,
    width: MARGIN * 2 + maxDepth * COL_W + BOX_W,
    height: MARGIN * 2 + (maxBottom - minTop),
  };
}
