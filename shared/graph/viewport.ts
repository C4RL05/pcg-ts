/**
 * Pan and zoom over a node graph, as arithmetic rather than as state.
 *
 * Two components draw a graph — the editor's canvas, which also edits it,
 * and the read-only view the demos show — and both need the same lens: a
 * wheel that zooms about the pointer, a drag that pans, and a way home
 * that frames the content. Only the lens is shared. Each component owns
 * its own `$state` holding the {@link Viewport}, because that is the part
 * Svelte has to track and it belongs to the component that renders the
 * transform.
 *
 * It is a TRANSFORM ON A GROUP rather than a scrolled oversized SVG,
 * which is what the editor's canvas used to be: scrollbars cannot zoom,
 * and an SVG sized to its content jumps under the cursor whenever a node
 * is dragged past the edge. Every gesture works in GRAPH coordinates — so
 * node positions stay in the model's own units, and a saved graph does
 * not remember where someone had scrolled to.
 */
import { NODE_W, nodeHeight } from "./layout.js";
import type { NodeView } from "./view.js";

/** Pan in screen px, and scale. Purely a view: never written to a model. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How far out an interactive view may zoom BY DEFAULT.
 *
 * A floor rather than a limit on the content: below about a fifth, a node
 * box is a 34px tile with no legible text on it, and a view zoomed out
 * past that is one you then have to navigate blind. Callers that have a
 * better answer pass their own floor — see {@link zoomFloor}.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;
/** One graph unit to one screen pixel — the size the boxes were drawn at. */
export const ACTUAL = 1;
/**
 * Breathing room between the framed content and the viewport edge, as a
 * fraction of the smaller side and never more than {@link PAD_MAX}.
 *
 * A flat 40px was right for the only viewport this had when it was written
 * — a full-bleed canvas — and absurd in the one it grew: 40 a side in a
 * 220px thumbnail is 64% of the card spent on margin, which shrinks the
 * graph to a third of the space it was given. A fraction keeps the margin
 * reading the same at both sizes, and the cap keeps a large canvas exactly
 * where it was.
 */
export const PAD_FRACTION = 0.06;
export const PAD_MAX = 40;

export function padFor(rect: DOMRect): number {
  return Math.min(PAD_MAX, Math.min(rect.width, rect.height) * PAD_FRACTION);
}

/** The nodes' bounding box in graph units, or null when there are none. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly w: number;
  readonly h: number;
}

export function clampZoom(z: number, floor: number = MIN_ZOOM): number {
  return Math.min(MAX_ZOOM, Math.max(floor, z));
}

/**
 * The zoom floor for a view of THIS graph in THIS viewport: far enough out
 * to see all of it, and never further.
 *
 * {@link MIN_ZOOM} alone is wrong for a graph bigger than the floor can
 * show. The racetrack's is 23208 units wide, which fits a 1340px panel at
 * 0.054 — a quarter of the flat floor. Framing it opens on the whole
 * pipeline and the first wheel-out then snaps to 0.2, four times closer,
 * with no way back: the view has a home it refuses to return to. Deriving
 * the floor from the content makes "everything at once" the furthest out a
 * graph can go, whatever size it is, and leaves the flat floor in charge
 * for every graph small enough that it bites first.
 */
export function zoomFloor(b: Bounds | null, rect: DOMRect): number {
  if (b === null || rect.width === 0 || rect.height === 0) return MIN_ZOOM;
  return Math.min(MIN_ZOOM, fitZoom(b, rect));
}

/** Pointer position in graph units — the space node x/y live in. */
export function toGraph(
  view: Viewport,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - rect.left - view.x) / view.z, y: (clientY - rect.top - view.y) / view.z };
}

/**
 * Zoom about the pointer: the graph point under the cursor is the one
 * that must not move, which is what makes a wheel feel like a lens rather
 * than a scrollbar.
 */
export function zoomAt(
  view: Viewport,
  rect: DOMRect,
  clientX: number,
  clientY: number,
  deltaY: number,
  floor: number = MIN_ZOOM,
): Viewport {
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const next = clampZoom(view.z * Math.exp(-deltaY * 0.0015), floor);
  const k = next / view.z;
  return { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, z: next };
}

/**
 * The box the boxes occupy. `rows` reports each node's param-band height
 * the same way {@link autoLayout} takes it, so the framed extent matches
 * what is drawn rather than what an unadorned box would measure.
 */
export function contentBounds(
  nodes: readonly NodeView[],
  rows?: ReadonlyMap<string, number>,
): Bounds | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...nodes.map((n) => n.y + nodeHeight(n, rows?.get(n.id) ?? 0)));
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

/** Put the content in the middle of the viewport at zoom `z`. */
export function centreAt(z: number, b: Bounds, rect: DOMRect): Viewport {
  return {
    z,
    x: (rect.width - b.w * z) / 2 - b.minX * z,
    y: (rect.height - b.h * z) / 2 - b.minY * z,
  };
}

/** The zoom at which the whole graph just fits, ignoring the clamps. */
export function fitZoom(b: Bounds, rect: DOMRect): number {
  const pad = padFor(rect);
  return Math.min((rect.width - pad * 2) / b.w, (rect.height - pad * 2) / b.h);
}

/**
 * Frame the graph, so a pan that wandered off is one gesture from home.
 *
 * `preferActual` opens at 1:1 WHEN THE GRAPH FITS THERE, and only falls
 * back to shrinking when it does not. That is what a load wants: most
 * graphs are a handful of nodes and have no business being scaled at all,
 * and a box drawn at the size it was designed at is the one that reads
 * best. The big pipelines still get fitted, because the alternative is
 * opening on a corner of something you cannot navigate.
 *
 * A "fit" control passes nothing and always fits, because a control named
 * fit that declines to fit is a broken control.
 *
 * `floor` is what stops a fit from becoming a hairline. A wide graph in a
 * small frame fits at a scale that draws nothing: the racetrack's is 14.5
 * to 1, and contained in a 220px card it is a smear three pixels tall —
 * technically the whole graph and legible as nothing at all. Passing a
 * floor makes the fit CROP instead of vanish, which is the trade a
 * thumbnail wants and an interactive view does not. See {@link zoomFloor}
 * for the floor a full view should pass.
 */
export function framed(
  b: Bounds | null,
  rect: DOMRect,
  opts: { preferActual?: boolean; floor?: number } = {},
): Viewport {
  if (b === null || rect.width === 0 || rect.height === 0) return { x: 0, y: 0, z: ACTUAL };
  const fit = fitZoom(b, rect);
  // `fit >= ACTUAL` is exactly "the content fits at 1:1 with its padding".
  if (opts.preferActual === true && fit >= ACTUAL) return centreAt(ACTUAL, b, rect);
  return centreAt(clampZoom(fit, opts.floor ?? MIN_ZOOM), b, rect);
}
