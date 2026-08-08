/**
 * Deterministic top-down SVG of a cooked collection — the agent's eyes on
 * the output, and diffable in git because the same data always produces
 * the same bytes: fixed decimal formatting, color groups emitted in
 * sorted order, no timestamps, no version stamps, no randomness.
 *
 * Projection: world x runs right, world z runs down (looking down -y),
 * which is the ordinary top view of a y-up scene.
 */
import type { Attribute, DataCollection, Geometry } from "../index.js";
import { CliError } from "./errors.js";
import { fmtCoord } from "./format.js";
import { attributeStats } from "./summary.js";

/** Sequential ramp for scalar attributes (8 stops, dark to light). */
const RAMP = [
  "#440154",
  "#46327e",
  "#365c8d",
  "#277f8e",
  "#1fa187",
  "#4ac16d",
  "#a0da39",
  "#fde725",
] as const;

/** Categorical palette for string attributes and instance batches. */
const PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
] as const;

const POINT_COLOR = "#1f2937";
const POLYLINE_COLOR = "#2563eb";
const POLY_COLOR = "#9ca3af";
const BACKGROUND = "#ffffff";

/** Knobs for {@link renderSvg}; every one has a deterministic default. */
export interface RenderOptions {
  /** Image width in pixels (height follows the data's aspect ratio). */
  readonly width?: number;
  /**
   * Point attribute to color by: scalars through a sequential ramp,
   * tuple-3-or-wider as RGB in [0, 1], strings categorically. Omitted,
   * every point draws in one color — deliberately, because the standard
   * `color` attribute defaults to white and auto-adopting it would draw
   * an invisible picture for every graph that never set it.
   */
  readonly attr?: string;
  /** Point radius in pixels. */
  readonly radius?: number;
  /** Cap on drawn points per geometry; above it, every k-th point is drawn. */
  readonly maxPoints?: number;
  /** Cap on drawn primitives per geometry; above it, every k-th primitive is drawn. */
  readonly maxPrimitives?: number;
}

/** What a render drew, for the command's report. */
export interface RenderResult {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly points: number;
  readonly pointsTotal: number;
  readonly primitives: number;
  readonly primitivesTotal: number;
  readonly instances: number;
  /** Elements skipped because their position was not finite. */
  readonly skipped: number;
  /** Attribute the colors came from, when any. */
  readonly colorAttr?: string;
  /** Drawn extent in world units, as [x, z] pairs. */
  readonly bounds?: { readonly min: readonly [number, number]; readonly max: readonly [number, number] };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

function hex2(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Per-point color for one geometry, from the chosen attribute. */
function colorizer(
  geo: Geometry,
  attrName: string | undefined,
): { color: (i: number) => string; used?: string } {
  let attr: Attribute | undefined;
  if (attrName !== undefined) {
    attr = geo.attrs.point.get(attrName);
    if (attr === undefined) {
      const names = [...geo.attrs.point].map((a) => a.name);
      throw new CliError(
        `no point attribute "${attrName}" to color by; point attributes: ${names.length === 0 ? "(none)" : names.join(", ")}`,
      );
    }
  }
  if (attr === undefined) return { color: () => POINT_COLOR };

  const column = attr;
  const ts = column.tupleSize;
  if (column.type === "string") {
    return {
      color: (i) => PALETTE[column.data[i * ts] % PALETTE.length],
      used: column.name,
    };
  }
  if (ts >= 3) {
    return {
      color: (i) =>
        `#${hex2(column.data[i * ts])}${hex2(column.data[i * ts + 1])}${hex2(column.data[i * ts + 2])}`,
      used: column.name,
    };
  }
  const stats = attributeStats(column, geo.attrs.point.count);
  const lo = stats.min?.[0] ?? 0;
  const hi = stats.max?.[0] ?? 0;
  const span = hi - lo;
  return {
    color: (i) => {
      const v = column.data[i * ts];
      if (!Number.isFinite(v) || span <= 0) return RAMP[0];
      const bucket = Math.floor(((v - lo) / span) * RAMP.length);
      return RAMP[bucket < 0 ? 0 : bucket >= RAMP.length ? RAMP.length - 1 : bucket];
    },
    used: column.name,
  };
}

/** Stride that keeps at most `max` of `total` elements. */
function strideFor(total: number, max: number): number {
  return total > max && max > 0 ? Math.ceil(total / max) : 1;
}

/**
 * Draw a cooked collection as a top-down SVG. Geometry points become
 * circles, primitives become paths (polylines open, polygons closed), and
 * instance batches contribute their transforms' translations — one color
 * per batch. Non-finite positions are skipped and counted rather than
 * poisoning the bounds.
 */
export function renderSvg(collection: DataCollection, opts: RenderOptions = {}): RenderResult {
  const width = Math.max(1, Math.round(opts.width ?? 800));
  const radiusPx = opts.radius ?? 1.5;
  const maxPoints = opts.maxPoints ?? 50000;
  const maxPrimitives = opts.maxPrimitives ?? 20000;

  /** color -> flat [x, y, x, y, ...] */
  const dots = new Map<string, number[]>();
  const openPaths: string[] = [];
  const closedPaths: string[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let points = 0;
  let pointsTotal = 0;
  let primitives = 0;
  let primitivesTotal = 0;
  let instances = 0;
  let skipped = 0;
  let colorAttr: string | undefined;

  const track = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const addDot = (color: string, x: number, y: number): void => {
    let flat = dots.get(color);
    if (flat === undefined) dots.set(color, (flat = []));
    flat.push(x, y);
    track(x, y);
  };

  for (const item of collection) {
    if (item.kind === "instances") {
      const batches = item.deviceBatches !== undefined ? [] : item.batches;
      batches.forEach((batch, b) => {
        const color = PALETTE[b % PALETTE.length];
        const stride = strideFor(batch.count, maxPoints);
        for (let i = 0; i < batch.count; i += stride) {
          const x = batch.transforms[i * 16 + 12];
          const y = batch.transforms[i * 16 + 14];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            skipped++;
            continue;
          }
          addDot(color, x, y);
          instances++;

        }
      });
      continue;
    }
    if (item.kind !== "geometry") continue;

    const geo = item.geo;
    const P = geo.attrs.point.get("P");
    if (P === undefined || P.type === "string" || P.tupleSize < 2) continue;
    const ts = P.tupleSize;
    const yc = ts >= 3 ? 2 : 1;
    const px = (i: number): number => P.data[i * ts];
    const py = (i: number): number => P.data[i * ts + yc];

    // Primitives first, so points draw on top of the shapes they belong to.
    primitivesTotal += geo.primitiveCount;
    if (geo.primitiveCount > 0) {
      const primType = geo.attrs.primitive.get("primtype");
      const stride = strideFor(geo.primitiveCount, maxPrimitives);
      for (let p = 0; p < geo.primitiveCount; p += stride) {
        const start = geo.primVertexStart[p];
        const count = geo.primVertexCount[p];
        const parts: string[] = [];
        for (let v = 0; v < count; v++) {
          const point = geo.vertexToPoint[start + v];
          const x = px(point);
          const y = py(point);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            skipped++;
            continue;
          }
          track(x, y);
          parts.push(`${parts.length === 0 ? "M" : "L"}${fmtCoord(x)} ${fmtCoord(y)}`);
        }
        if (parts.length < 2) continue;
        const isPolyline = primType !== undefined && primType.type === "string"
          ? primType.getString(p) === "polyline"
          : false;
        (isPolyline ? openPaths : closedPaths).push(parts.join(""));
        primitives++;
      }
    }

    pointsTotal += geo.pointCount;
    const { color, used } = colorizer(geo, opts.attr);
    if (used !== undefined) colorAttr = used;
    const stride = strideFor(geo.pointCount, maxPoints);
    for (let i = 0; i < geo.pointCount; i += stride) {
      const x = px(i);
      const y = py(i);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        skipped++;
        continue;
      }
      addDot(color(i), x, y);
      points++;
    }
  }

  const drewSomething = minX <= maxX && minY <= maxY;
  if (!drewSomething) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const extentX = maxX - minX;
  const extentY = maxY - minY;
  const pad = Math.max(extentX, extentY) * 0.04 || 0.5;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = extentX + pad * 2;
  const vbH = extentY + pad * 2;
  const height = Math.max(1, Math.round((width * vbH) / vbW));
  const perPixel = vbW / width;
  const r = fmtCoord(radiusPx * perPixel);
  const strokeWidth = fmtCoord(1.2 * perPixel);

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${fmtCoord(vbX)} ${fmtCoord(vbY)} ${fmtCoord(vbW)} ${fmtCoord(vbH)}">`,
  );
  lines.push(
    `<!-- pcg render: ${points} points, ${instances} instances, ${primitives} primitives; x right, z down (top-down view) -->`,
  );
  lines.push(
    `<rect x="${fmtCoord(vbX)}" y="${fmtCoord(vbY)}" width="${fmtCoord(vbW)}" height="${fmtCoord(vbH)}" fill="${BACKGROUND}"/>`,
  );
  if (closedPaths.length > 0) {
    lines.push(`<g fill="none" stroke="${POLY_COLOR}" stroke-width="${strokeWidth}">`);
    for (const d of closedPaths) lines.push(`<path d="${d}Z"/>`);
    lines.push("</g>");
  }
  if (openPaths.length > 0) {
    lines.push(
      `<g fill="none" stroke="${POLYLINE_COLOR}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const d of openPaths) lines.push(`<path d="${d}"/>`);
    lines.push("</g>");
  }
  // Sorted so the group order depends only on the colors present, never
  // on iteration or insertion accidents.
  for (const color of [...dots.keys()].sort()) {
    const flat = dots.get(color) as number[];
    lines.push(`<g fill="${color}">`);
    for (let i = 0; i < flat.length; i += 2) {
      lines.push(`<circle cx="${fmtCoord(flat[i])}" cy="${fmtCoord(flat[i + 1])}" r="${r}"/>`);
    }
    lines.push("</g>");
  }
  lines.push("</svg>");

  return {
    svg: lines.join("\n") + "\n",
    width,
    height,
    points,
    pointsTotal,
    primitives,
    primitivesTotal,
    instances,
    skipped,
    ...(colorAttr !== undefined ? { colorAttr } : {}),
    ...(drewSomething
      ? { bounds: { min: [minX, minY] as const, max: [maxX, maxY] as const } }
      : {}),
  };
}
