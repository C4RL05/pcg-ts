/**
 * Named per-instance attribute channels: which point attributes may cross
 * the spawner, and how one element of each is copied into a batch.
 *
 * This is the host ABI's validation half. The field grammar has no time
 * input by design — a graph produces STRUCTURE and the host animates it —
 * so everything a host needs to drive per-instance behaviour has to leave
 * the graph as data on an instance batch. Before this module the only
 * things that could cross were transforms and RGB, which meant a host
 * animating anything else had to re-derive it from a position and stopped
 * agreeing with the graph that authored it.
 *
 * The rules, in one place because both the error messages and the copy
 * loop depend on them:
 *
 * - **Dtype is preserved.** A channel is a point attribute that crossed
 *   the spawner, carrying the element type it had on the point domain
 *   (`src/data`'s `AttrType` / {@link ATTR_CTORS}, not a second
 *   vocabulary). f32 would be the easy uniform choice and it is the wrong
 *   one: a `u32` instance id past 2^24 does not survive it, and an
 *   instance id is the first channel a host asks for.
 * - **`string` cannot cross.** Its column holds indices into a
 *   per-attribute string table that does not travel with it, so a
 *   renderer would receive integers that mean nothing. Per-point asset
 *   ids — the one string a spawner does route — have their own param
 *   (`assetAttr`), and the message says so.
 * - **`color` is reserved.** A renderer treats instance colour
 *   structurally rather than generically (three hangs it on
 *   `InstancedMesh.instanceColor`, a mesh property that flips the shader
 *   variant, not a geometry attribute), so a generic channel of that name
 *   would be uploaded twice and mean two things. `colorAttr` is the route.
 * - **The channel is named after the attribute.** No renaming, so the
 *   name in the graph and the name the host binds are the same string and
 *   there is nothing to keep in sync.
 *
 * Compare `color.ts`, which owns the RGB convention for the same
 * boundary: this module deliberately does NOT own the *whether*. The
 * spawner carries the attributes a param named and nothing else, for the
 * same reason it carries no colour unless asked — an attribute crossing
 * the spawner costs a buffer and a renderer upload per cook.
 */
import type { AttrData, AttrType, AttributeSet } from "../data/index.js";
// ATTR_CTORS by path, not through `../data/index.js`: the barrel
// deliberately omits it from the package surface (see its opening
// comment), so the direct import IS the internal spelling — the same one
// `src/data/attribute.ts` uses. Reusing it is the point; a second
// constructor table would be a second dtype vocabulary to drift.
import { ATTR_CTORS } from "../data/types.js";
import { INSTANCE_COLOR_CHANNEL } from "../graph/data.js";

/**
 * One resolved channel: the point column it reads and the shape it will
 * write. `tupleSize` is carried through unchanged, so a channel of an
 * `f32x2` attribute is 2 floats per instance and the batch's consumer
 * recovers that as `column.length / count`.
 */
export interface InstanceAttrSource {
  /** Channel name, which is the point attribute's name. */
  readonly name: string;
  /** Element type, preserved from the point domain. Never `"string"`. */
  readonly type: AttrType;
  /** Components per element, preserved from the point domain. */
  readonly tupleSize: number;
  /** The point column, read only. */
  readonly data: AttrData;
}

/** `f32x3`, or just `u32` when the tuple is 1 — the library's spelling. */
function shapeLabel(type: AttrType, tupleSize: number): string {
  return tupleSize === 1 ? type : `${type}x${tupleSize}`;
}

/** Point attributes that could serve as a channel, for a message. */
function channelCandidates(attrs: AttributeSet): string {
  const names = attrs
    .names()
    .filter((name) => attrs.require(name).type !== "string" && name !== INSTANCE_COLOR_CHANNEL);
  return names.length > 0 ? names.join(", ") : "(none)";
}

/**
 * Resolve the named point attributes into channels, or throw naming the
 * node, the param, the offending name and the way out.
 *
 * Refusing rather than skipping is the same rule `requireRgbSource`
 * follows: a param that names an attribute has stated an intent, and a
 * cook that silently produced a batch without the channel a host is about
 * to bind is the plausible-looking failure this library refuses.
 */
export function resolveInstanceAttrs(
  attrs: AttributeSet,
  names: readonly string[],
  nodeType: string,
  param: string,
): InstanceAttrSource[] {
  const sources: InstanceAttrSource[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (name === "") {
      throw new Error(
        `${nodeType}: ${param} contains an empty name. Every entry must name a point attribute; ` +
          `remove the empty entry, or clear ${param} entirely to carry no instance attributes.`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `${nodeType}: ${param} names "${name}" twice. A channel is named after its attribute, so ` +
          `a repeat would be one channel listed twice; list each attribute once.`,
      );
    }
    seen.add(name);
    if (name === INSTANCE_COLOR_CHANNEL) {
      throw new Error(
        `${nodeType}: ${param} cannot carry "${INSTANCE_COLOR_CHANNEL}" — that channel name is ` +
          `reserved for per-instance RGB, which a renderer binds structurally (three's ` +
          `InstancedMesh.instanceColor) rather than as a generic attribute. Use the colorAttr ` +
          `param to carry it, or copy the attribute to another name upstream with setAttribute ` +
          `and name that here (which is also how RGBA reaches a host: colorAttr drops alpha, a ` +
          `channel does not).`,
      );
    }
    const attr = attrs.get(name);
    if (!attr) {
      throw new Error(
        `${nodeType}: ${param} "${name}" not found on the point domain; point attributes that ` +
          `can become channels: ${channelCandidates(attrs)}. Write it upstream with setAttribute, ` +
          `or take it out of ${param}.`,
      );
    }
    if (attr.type === "string") {
      throw new Error(
        `${nodeType}: ${param} "${name}" is a string attribute, and a string cannot cross the ` +
          `spawner — its column holds indices into a per-attribute string table that does not ` +
          `travel with it, so the renderer would receive integers that mean nothing. For ` +
          `per-point asset ids use the assetAttr param, which resolves the table into batch ids. ` +
          `Otherwise encode the choice as a number (u32 or i32) upstream and name that here.`,
      );
    }
    sources.push({ name, type: attr.type, tupleSize: attr.tupleSize, data: attr.data });
  }
  return sources;
}

/**
 * Allocate one destination column per channel, `count * tupleSize`
 * elements each, in the channel's own dtype.
 *
 * Returned as the mutable record the batch will freeze into place; the
 * caller fills it through {@link readInstanceAttr} inside the transform
 * loop. Insertion order follows the param's order, so the channel record
 * enumerates the way the author wrote it — with the one exception JS
 * imposes on every object: an integer-like key ("0", "12") is hoisted
 * ahead of the string ones. Deterministic either way, which is what the
 * invariant actually needs; just not always the author's order.
 */
export function allocInstanceAttrs(
  sources: readonly InstanceAttrSource[],
  count: number,
): Record<string, AttrData> {
  const out: Record<string, AttrData> = {};
  for (const src of sources) out[src.name] = new ATTR_CTORS[src.type](count * src.tupleSize);
  return out;
}

/**
 * Copy element `i` of `src` into instance slot `k` of `out`, all
 * components.
 *
 * Per element rather than per column, exactly like {@link readRgb} and
 * for the same reason: the spawner already walks its instances once, in
 * batch order, and a bulk variant would be a SECOND traversal that could
 * fall out of step with the first. With one loop and one source index
 * there is no index arithmetic to keep in sync — which is what makes
 * `attributes[name][k]` and `transforms[k]` the same instance by
 * construction rather than by agreement.
 */
export function readInstanceAttr(
  out: AttrData,
  k: number,
  src: InstanceAttrSource,
  i: number,
): void {
  const ts = src.tupleSize;
  const dst = k * ts;
  const base = i * ts;
  for (let c = 0; c < ts; c++) out[dst + c] = src.data[base + c];
}

/** The shape a channel writes, as an error message spells it. */
export function instanceAttrShape(src: InstanceAttrSource): string {
  return shapeLabel(src.type, src.tupleSize);
}
