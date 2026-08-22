/**
 * Where a cable starts, where it ends, and the curve between them.
 *
 * Geometry only: the two views that draw wires disagree about everything
 * else — the editor's canvas offers a hit target that cuts the edge and a
 * dashed preview of one being pulled, and the read-only view offers
 * neither — but a cable that left the same pin at a different height in
 * the two of them would be the same graph drawn wrong in one of them.
 */
import { NODE_W, pinRowY } from "./layout.js";
import type { EdgeView, NodeView } from "./view.js";

/** The end of one pin, in graph units, or null when it is not there. */
export function pinPos(
  node: NodeView | undefined,
  pinName: string,
  side: "in" | "out",
): { x: number; y: number } | null {
  if (!node) return null;
  const pins = side === "in" ? node.inputs : node.outputs;
  const i = pins.findIndex((p) => p.name === pinName);
  if (i < 0) return null;
  return { x: node.x + (side === "out" ? NODE_W : 0), y: node.y + pinRowY(i) };
}

/** A cable's curve: out of the source rightwards, into the target leftwards. */
export function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(46, Math.min(130, Math.abs(b.x - a.x) * 0.5));
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function edgePath(byId: ReadonlyMap<string, NodeView>, e: EdgeView): string | null {
  const a = pinPos(byId.get(e.from), e.fromPin, "out");
  const b = pinPos(byId.get(e.to), e.toPin, "in");
  return a && b ? curve(a, b) : null;
}

/**
 * The kind a cable CARRIES, read off the output pin it leaves from.
 *
 * The source pin and not the target: a connection is only legal when the
 * two agree (or one is the `any` wildcard), so the source is the side that
 * always names something concrete. The fallback is `any` rather than
 * `geometry` — a cable whose source pin cannot be found is a cable of
 * unknown kind, and guessing the common one would draw a confident answer
 * to a question that failed. It is unreachable in practice: `edgePath`
 * already returns null for a missing endpoint.
 */
export function edgeKind(byId: ReadonlyMap<string, NodeView>, e: EdgeView): string {
  return byId.get(e.from)?.outputs.find((p) => p.name === e.fromPin)?.kind ?? "any";
}
