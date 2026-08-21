/**
 * Reading a cooked lap back out, and scoring it.
 *
 * The half of the driver that touches pcg-ts. It is a separate file from
 * `calibrate.ts` on purpose: that one is the technique's numerics —
 * iterative proportional fitting, the seventeen metrics, the correction
 * loop — and it imports nothing from the library, so it ports to a project
 * that has never heard of pcg-ts. Everything that knows what a `Geometry`
 * is lives here instead, and the split is the difference between "you can
 * take the technique" and "you can take the technique if you also take the
 * engine".
 */
import { type CookResult, type DataCollection, type Geometry, firstGeometry } from "pcg-ts";
import { type Placement, type Report, countBlocking, score } from "./calibrate.js";
import { type Preset } from "./kit.js";

/**
 * The first geometry of a named output, or a throw.
 *
 * `firstGeometry` answers `undefined` for a collection that holds none,
 * and every caller below has already required the output to be there — so
 * the check is worth exactly one copy, here.
 */
export function requireGeo(collection: DataCollection | undefined): Geometry {
  const geo = collection ? firstGeometry(collection) : undefined;
  if (!geo) throw new Error("expected a geometry output");
  return geo;
}

/** The track the suites dress, in world units and frame counts. */
export const TRACK = {
  halfWidth: 1755,
  controlPoints: 800,
  frames: 400,
  lapRadius: 62 * 1755,
  relief: 6 * 1755,
} as const;

/**
 * Read a numeric point column as plain numbers.
 *
 * Sliced to pointCount * tupleSize on purpose: `data` is the backing store
 * and carries spare CAPACITY past the live elements, so reading it whole
 * compares against slack.
 */
export function col(g: Geometry, name: string): Float64Array {
  const a = g.attrs.point.require(name);
  const n = g.pointCount * a.tupleSize;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a.data[i];
  return out;
}

/**
 * Read a string point column. `get` on a string attribute returns the
 * STRING-TABLE INDEX; `getString` is the one that resolves it, and reading
 * the wrong one silently yields a column of plausible small integers.
 */
export function strCol(g: Geometry, name: string): string[] {
  const a = g.attrs.point.require(name);
  const out: string[] = [];
  for (let i = 0; i < g.pointCount; i++) out.push(a.getString(i, 0));
  return out;
}

/**
 * The cooked placements, as the metrics see them.
 *
 * Every column is resolved ONCE and then indexed, rather than re-resolved
 * per point: the schema is thirteen columns wide and a lap carries a few
 * hundred placements, so the naive form is thousands of attribute lookups
 * for one read.
 */
export function readPlacements(g: Geometry): Placement[] {
  const archetype = strCol(g, "archetype");
  const stationW = col(g, "stationW");
  const lateralW = col(g, "lateralW");
  const heightW = col(g, "heightW");
  const footprintW = col(g, "footprintW");
  const alongW = col(g, "alongW");
  const acrossW = col(g, "acrossW");
  const tallnessW = col(g, "tallnessW");
  const zone = col(g, "zone");
  const variant = col(g, "variant");
  const polygons = col(g, "polygons");
  const isSprite = col(g, "isSprite");
  const pack1 = col(g, "pack1");
  const pack2 = col(g, "pack2");
  // Rule-placed furniture carries the turn direction of the corner it
  // announces; a density placement has no corner and carries 0.
  const cornerK = g.attrs.point.get("cornerK")
    ? col(g, "cornerK")
    : new Float64Array(g.pointCount);
  const out: Placement[] = [];
  for (let i = 0; i < g.pointCount; i++) {
    out.push({
      archetype: archetype[i],
      stationW: stationW[i],
      lateralW: lateralW[i],
      heightW: heightW[i],
      footprintW: footprintW[i],
      alongW: alongW[i],
      acrossW: acrossW[i],
      tallnessW: tallnessW[i],
      radiusW: pack1[i * 4 + 3],
      kSigned: pack2[i * 4 + 3],
      zone: zone[i],
      cornerK: cornerK[i],
      variant: variant[i],
      polygons: polygons[i],
      isSprite: isSprite[i],
      // The asset slot: one model per family, and a family is an archetype
      // plus a variant. Composed here rather than in the graph because the
      // field grammar has no string concatenation, and a numeric variant
      // beside the archetype name carries the same information.
      family: `${archetype[i]}#${variant[i]}`,
    });
  }
  return out;
}

/**
 * How many corner ENTRIES the frames hold, counted the graph's way —
 * including sampling the severity two half-widths INTO the corner rather
 * than at the entry, where the radius has only just crossed the threshold.
 * An independent re-derivation of what the graph decides, so it has to
 * make the same choice or it is measuring something else.
 */
export function countCornerEntries(
  frames: Geometry,
  lapW: number,
): { entries: number; tight: number } {
  const isCorner = col(frames, "isCorner");
  const radiusW = col(frames, "radiusW");
  const n = frames.pointCount;
  const probe = Math.round(2 / (lapW / n));
  let entries = 0;
  let tight = 0;
  for (let i = 0; i < n; i++) {
    const prev = isCorner[(i + n - 1) % n];
    if (isCorner[i] >= 0.5 && prev < 0.5) {
      entries++;
      if (radiusW[(i + probe) % n] < 8) tight++;
    }
  }
  return { entries, tight };
}

/**
 * Score one cook.
 *
 * Both suites need this and neither should own it: the difference between
 * them is how the graph got there — one rebuilds it, the other re-aims one
 * with `setParam` — and everything after the cook is the same reading.
 */
export function scoreCook(
  out: CookResult,
  preset: Preset,
  lapW: number,
): { placements: Placement[]; frames: Geometry; report: Report } {
  const placementGeo = requireGeo(out.outputs.placements);
  const frames = requireGeo(out.outputs.frames);
  const placements = readPlacements(placementGeo);
  const corners = countCornerEntries(frames, lapW);
  const markers = placements.filter((p) => p.archetype === "corner-marker").length;
  const blocking = countBlocking(
    placements,
    col(placementGeo, "P"),
    col(frames, "P"),
    TRACK.halfWidth,
    lapW,
  );
  return { placements, frames, report: score(placements, preset, lapW, corners.entries, markers, blocking) };
}

/**
 * Is `a` a better iteration than `b`?
 *
 * More metrics passed wins; a tie goes to whichever landed closer to the
 * target density. Keeping the BEST rather than the LAST is the point: the
 * corrections are measured on samples small enough to be noisy — only a
 * few dozen placements sit inside bends on a lap — so a later iteration is
 * usually, but not always, an improvement.
 */
export function better(a: Report, b: Report, preset: Preset): boolean {
  if (a.passed !== b.passed) return a.passed > b.passed;
  return Math.abs(a.perW - preset.density) < Math.abs(b.perW - preset.density);
}
