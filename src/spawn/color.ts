/**
 * The colour convention at the renderer boundary, in ONE implementation.
 *
 * Two consumers turn a point attribute into colours a three object can
 * draw: the spawner ({@link buildInstanceBatches}, one instance at a
 * time) and the debug point renderer (`src/three/debug.ts`, one point at
 * a time). Both read components 0-2 of an f32 column of tuple size 3 or
 * more, and **alpha is dropped** — three's instance-colour and
 * vertex-colour paths are both RGB, so a fourth component has nowhere to
 * go. The rule lives here rather than at each call site so the two cannot
 * describe the same behaviour differently, and so the standard f32x4
 * `color` attribute and a hand-written f32x3 `tint` are read identically.
 *
 * What is NOT here, deliberately: any decision about *whether* to carry
 * colour. The debug renderer picks `color` up automatically (it is a
 * debug view — showing what is there is the whole job), while the spawner
 * only carries the attribute a param named, because writing per-instance
 * colour flips the renderer's shader variant and every point cloud in the
 * library already carries `color` at [1,1,1,1]. Same extraction, opposite
 * defaults; the two policies stay with their callers.
 */
import type { Attribute, AttributeSet } from "../data/index.js";

/**
 * A colour column: an f32 attribute whose components 0-2 are read as RGB.
 * Structural rather than an `Attribute` so a caller can hand over any
 * equivalent view, and readonly because nothing here ever writes back.
 */
export interface RgbSource {
  readonly data: ArrayLike<number>;
  readonly tupleSize: number;
}

/** The shape rule, one place: f32 with at least three components. */
function isRgbShape(attr: Attribute): boolean {
  return attr.type === "f32" && attr.tupleSize >= 3;
}

/** `f32x3`, or just `u32` when the tuple is 1 — the library's spelling. */
function shapeLabel(attr: Attribute): string {
  return attr.tupleSize === 1 ? attr.type : `${attr.type}x${attr.tupleSize}`;
}

/** Names on `attrs` that could serve as a colour source, for a message. */
function rgbCandidates(attrs: AttributeSet): string {
  const names = attrs.names().filter((name) => isRgbShape(attrs.require(name)));
  return names.length > 0 ? names.join(", ") : "(none)";
}

/**
 * The attribute as a colour source, or `undefined` when its shape cannot
 * serve as one. For the caller that treats colour as optional; a caller
 * that was *asked* for a named attribute wants
 * {@link requireRgbSource} instead, which explains the refusal.
 */
export function rgbSourceOf(attr: Attribute | undefined): RgbSource | undefined {
  return attr !== undefined && isRgbShape(attr) ? attr : undefined;
}

/**
 * Resolve a named colour source, or throw naming the node, the param, the
 * attribute and the way out. Refusing a mis-shaped attribute rather than
 * ignoring it is the same rule the reporting-slot params follow
 * (`requireReportSlot` in `src/nodes/util.ts`): a param that names an
 * attribute has stated an intent, and silently producing an uncoloured
 * cook is the plausible-looking failure this library refuses. The
 * difference is direction — this one READS the column, so nothing is at
 * risk of being deleted and the shape is checked to be *usable* rather
 * than to be free.
 */
export function requireRgbSource(
  attrs: AttributeSet,
  name: string,
  nodeType: string,
  param: string,
): RgbSource {
  const attr = attrs.get(name);
  if (!attr) {
    throw new Error(
      `${nodeType}: ${param} "${name}" not found on the point domain; point attributes with a ` +
        `colour-compatible shape (f32, tupleSize >= 3): ${rgbCandidates(attrs)}. Write it ` +
        `upstream with setAttribute (type "f32", tupleSize 3 or 4 — the standard "color" ` +
        `attribute is f32x4), or leave ${param} empty to carry no colour at all.`,
    );
  }
  if (!isRgbShape(attr)) {
    throw new Error(
      `${nodeType}: ${param} "${name}" is ${shapeLabel(attr)} on the point domain, but a colour ` +
        `source must be f32 with tupleSize >= 3 — components 0-2 are read as RGB and alpha is ` +
        `dropped. Point attributes with a colour-compatible shape: ${rgbCandidates(attrs)}. ` +
        `Name one of those, or leave ${param} empty to carry no colour at all.`,
    );
  }
  return attr;
}

/**
 * Copy element `i`'s RGB out of `src` into `out` at `outOffset`, reading
 * components 0-2 whatever the tuple size — alpha is dropped.
 *
 * Per element rather than per column on purpose: both callers already
 * walk their elements once (the spawner permutes them into batch order,
 * the debug renderer takes them in point order), and a bulk variant would
 * be a SECOND traversal that could fall out of step with the first. There
 * is no index arithmetic to keep in sync because there is only one loop.
 */
export function readRgb(
  out: Float32Array,
  outOffset: number,
  src: RgbSource,
  i: number,
): void {
  const base = i * src.tupleSize;
  out[outOffset] = src.data[base];
  out[outOffset + 1] = src.data[base + 1];
  out[outOffset + 2] = src.data[base + 2];
}
