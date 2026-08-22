/**
 * The view model a node graph is DRAWN from — and nothing about editing
 * one.
 *
 * Node positions and pin views are presentation: the library's graph JSON
 * carries neither, and two different readers invent them the same way. The
 * editor builds these from a live mirror it can also mutate; the demos
 * build them from a graph they only ever show. Everything here is plain,
 * structured-clone-safe data so it can live inside Svelte `$state`, and
 * nothing here knows which of those two callers it is serving.
 *
 * It moved out of `editor/model.ts` when the demos grew a read-only graph
 * view, for the reason `shared/draw.ts` and `shared/frame.ts` moved out of
 * the editor before it: a second page needed the same picture. What stayed
 * behind is what only an editor has — the palette, and the adapter from
 * the controller's live `ParamView` to a {@link ParamPreview}.
 */
import { getNodeType, type PinInfo } from "pcg-ts";

/** One pin as the canvas renders it. */
export interface PinView {
  readonly name: string;
  readonly kind: string;
  readonly multi: boolean;
}

/** One node box on the canvas. Position is view-only state. */
export interface NodeView {
  id: string;
  type: string;
  /**
   * What the box is titled with, when that differs from `type` — a
   * subgraph node shows the primitive it references, because "subgraph"
   * is true of every one of them and so identifies none. `type` stays the
   * registered type name, since that is what the registry is keyed by.
   */
  label?: string;
  /**
   * The registry category this node's type belongs to, which the box
   * draws as an icon. Copied onto the view rather than looked up while
   * rendering: the box is redrawn on every pointermove of a drag, and the
   * category cannot change for the life of the node — the type is fixed
   * at creation. `undefined` for a type that declares none (third-party
   * registrations may legally omit it), and the box then draws no icon.
   */
  category?: string;
  x: number;
  y: number;
  inputs: PinView[];
  outputs: PinView[];
}

/** One connection in the view model (mirrors a graph connection). */
export interface EdgeView {
  from: string;
  fromPin: string;
  to: string;
  toPin: string;
}

/** A whole graph as the canvas draws it (params live beside it). */
export interface StructureModel {
  seed: number;
  nodes: NodeView[];
  edges: EdgeView[];
}

/**
 * One param as a node box shows it: a short name and a shorter value.
 *
 * The boxes used to be a type, an id and a row of pins — the same picture
 * whether `count` was 350 or 350000. Everything that distinguishes one
 * scatter from another was a click away in the inspector, so reading a
 * graph meant clicking through it node by node. These few characters per
 * box are what let you read the settings off the canvas instead.
 */
export interface ParamPreview {
  readonly key: string;
  readonly value: string;
  /**
   * The param is a Field rather than a constant. Marked because it is a
   * different KIND of answer, not a different value: a field is resolved
   * per point when it lands on a domain, so "0.4" and "ƒ fbm" are not two
   * settings of one knob.
   */
  readonly field: boolean;
}

/** Most rows a box shows before it stops naming them and counts instead. */
const PREVIEW_ROWS = 3;

/** Trim a rendered value to what fits the box at 9px monospace. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // Two places is enough to tell 2.5 from 2.75 and short enough that a
  // vec3 of them still fits the width.
  return String(Number(n.toFixed(2)));
}

/** A param row before it has been fitted to the box. */
export interface PreviewRow {
  readonly key: string;
  readonly value: string;
  readonly field: boolean;
}

/**
 * Fit a node's param rows to its box: all of them when there are few, and
 * the first few plus a count when there are many — a box that listed
 * twelve params would be taller than the graph it is in, and the twelfth
 * is not the one you were looking for.
 *
 * The two readers differ only in where a row's text comes from — the
 * editor renders a live `ParamView`, the read-only view renders serialized
 * JSON — so only the text is theirs and the fitting is shared. It has to
 * be: the fitted height is what {@link autoLayout} spaces the columns by,
 * and two spellings of "how many rows" would lay a graph out at one height
 * and draw it at another.
 */
export function previewRows(rows: readonly PreviewRow[]): ParamPreview[] {
  const head = rows.length <= PREVIEW_ROWS + 1 ? rows : rows.slice(0, PREVIEW_ROWS);
  const out: ParamPreview[] = head.map((r) => ({
    key: clip(r.key, 13),
    value: clip(r.value, 14),
    field: r.field,
  }));
  if (rows.length > head.length) {
    out.push({ key: "", value: `+${rows.length - head.length} more`, field: false });
  }
  return out;
}

function pinViews(pins: readonly PinInfo[]): PinView[] {
  return pins.map((p) => ({ name: p.name, kind: p.kind, multi: p.multi }));
}

/** Pin views for a registered node type. */
export function nodePinsForType(type: string): { inputs: PinView[]; outputs: PinView[] } {
  const info = getNodeType(type).info;
  return { inputs: pinViews(info.inputs), outputs: pinViews(info.outputs) };
}

/**
 * The registry category of a node type, or `undefined` when it declares
 * none — which is legal, and which the canvas renders as no icon.
 *
 * Wrapped in a try rather than a registry membership test because
 * `getNodeType` THROWS for an unknown type, and the one caller that can
 * hand it an unknown one is the import path: a graph naming a type this
 * build does not have should fail on the type, with the library's own
 * message, not on the icon it would have drawn.
 */
export function nodeCategory(type: string): string | undefined {
  try {
    return getNodeType(type).info.category;
  } catch {
    return undefined;
  }
}
