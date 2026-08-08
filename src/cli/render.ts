/**
 * Deterministic top-down SVG of a cooked collection — the agent's eyes on
 * the output, and diffable in git because the same data always produces
 * the same bytes: fixed decimal formatting, color groups emitted in
 * sorted order, no timestamps, no version stamps, no randomness.
 *
 * Projection: world x runs right, world z runs down (looking down -y),
 * which is the ordinary top view of a y-up scene.
 *
 * Coordinate space: the document is written in PIXEL space. The
 * world-to-pixel transform is computed here, the `viewBox` is always
 * `0 0 <width> <height>`, and every coordinate, radius and stroke width
 * in the file is already in pixels. That is what makes the fixed 3
 * decimals honest — a thousandth of a pixel, whatever the world scale —
 * and it is why a collection one thousandth of a unit wide draws exactly
 * like one a thousand units wide instead of collapsing to `r="0"` and a
 * blank frame. {@link RenderResult.bounds} stays in WORLD units: it is
 * data about the cook, not about the image.
 */
import type { Attribute, DataCollection, Geometry } from "../index.js";
import { hashString } from "../index.js";
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

/** Stroke width for primitive paths, in pixels. */
const STROKE_WIDTH = "1.2";

/** Knobs for {@link renderSvg}; every one has a deterministic default. */
export interface RenderOptions {
  /** Image width in pixels, >= 1 (height follows the data's aspect ratio). */
  readonly width?: number;
  /**
   * Point attribute to color by: scalars through a sequential ramp,
   * tuple-3-or-wider as RGB in [0, 1], strings categorically. Omitted,
   * every point draws in one color — deliberately, because the standard
   * `color` attribute defaults to white and auto-adopting it would draw
   * an invisible picture for every graph that never set it.
   *
   * The scalar ramp is normalized over every geometry in the collection
   * that carries the attribute, so one picture has one legend. A geometry
   * that does not carry it is an error naming that item.
   */
  readonly attr?: string;
  /** Point radius in pixels, > 0. */
  readonly radius?: number;
  /**
   * Cap on drawn circles (geometry points plus instance transforms)
   * across the WHOLE collection; above it, every k-th one is drawn. Must
   * be an integer >= 1 — `0` is a mistake, not "unlimited".
   */
  readonly maxPoints?: number;
  /**
   * Cap on drawn primitives across the WHOLE collection; above it, every
   * k-th one is drawn. Must be an integer >= 1.
   */
  readonly maxPrimitives?: number;
}

/** What a render drew, for the command's report. */
export interface RenderResult {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** Geometry points drawn as circles. */
  readonly points: number;
  readonly pointsTotal: number;
  /** Primitives drawn as paths; a primitive with nothing drawable is not one. */
  readonly primitives: number;
  readonly primitivesTotal: number;
  /** Instance transforms drawn as circles. */
  readonly instances: number;
  readonly instancesTotal: number;
  /**
   * Instances that were not drawn because their transforms live in GPU
   * buffers and were never composed on the CPU (a device-resident
   * spawner run). Reported rather than silently dropped: a blank frame
   * with `0 instances` is exactly the failure the data layer's throwing
   * `batches` accessor exists to prevent.
   */
  readonly deviceInstances: number;
  /** Elements skipped because their position was not finite. */
  readonly skipped: number;
  /** Attribute the colors came from, when any. */
  readonly colorAttr?: string;
  /** Drawn extent in WORLD units, as [x, z] pairs. Covers drawn content only. */
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

/**
 * Reject option values that would produce a corrupt document. `renderSvg`
 * is exported from `pcg-ts/cli`, so its caller is not necessarily the
 * command line that already validated these flags.
 */
function checkOptions(opts: RenderOptions): void {
  const bad = (name: string, expected: string, got: unknown): never => {
    throw new CliError(`renderSvg: option "${name}" must be ${expected}, got ${String(got)}`);
  };
  if (opts.width !== undefined && !(Number.isFinite(opts.width) && opts.width >= 1)) {
    bad("width", "a finite number >= 1 (the image width in pixels)", opts.width);
  }
  if (opts.radius !== undefined && !(Number.isFinite(opts.radius) && opts.radius > 0)) {
    bad("radius", "a finite number > 0 (the point radius in pixels)", opts.radius);
  }
  for (const name of ["maxPoints", "maxPrimitives"] as const) {
    const value = opts[name];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1)) {
      bad(name, 'an integer >= 1 (0 is a cap of zero, not "no cap"; omit the option for the default)', value);
    }
  }
}

/**
 * Lowest and highest finite value of component 0 of `attrName` over every
 * geometry in the collection that carries it as a scalar. One ramp over
 * the whole collection means one color means one value in the picture.
 */
function scalarRange(
  collection: DataCollection,
  attrName: string,
): { readonly lo: number; readonly hi: number } | undefined {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const item of collection) {
    if (item.kind !== "geometry") continue;
    const attr = item.geo.attrs.point.get(attrName);
    if (attr === undefined || attr.type === "string" || attr.tupleSize >= 3) continue;
    const stats = attributeStats(attr, item.geo.attrs.point.count);
    const min = stats.min?.[0];
    const max = stats.max?.[0];
    if (min !== undefined && Number.isFinite(min) && min < lo) lo = min;
    if (max !== undefined && Number.isFinite(max) && max > hi) hi = max;
  }
  return lo <= hi ? { lo, hi } : undefined;
}

/** Per-point color for one geometry, from the chosen attribute. */
function colorizer(
  geo: Geometry,
  attrName: string | undefined,
  itemIndex: number,
  range: { readonly lo: number; readonly hi: number } | undefined,
): { color: (i: number) => string; used?: string } {
  let attr: Attribute | undefined;
  if (attrName !== undefined) {
    attr = geo.attrs.point.get(attrName);
    if (attr === undefined) {
      const names = [...geo.attrs.point].map((a) => a.name);
      throw new CliError(
        `item ${itemIndex} has no point attribute "${attrName}" to color by; item ${itemIndex} point attributes: ${names.length === 0 ? "(none)" : names.join(", ")}`,
      );
    }
  }
  if (attr === undefined) return { color: () => POINT_COLOR };

  const column = attr;
  const ts = column.tupleSize;
  if (column.type === "string") {
    // The color comes from a hash of the string VALUE, never from its
    // string-table index: interning order is an accident of the cook, and
    // keying on it recolors every category the moment one value first
    // appears somewhere else.
    const byIndex = column.stringTable.map((s) => PALETTE[hashString(s) % PALETTE.length]);
    return {
      color: (i) => byIndex[column.data[i * ts]] ?? PALETTE[0],
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
  const lo = range?.lo ?? 0;
  const hi = range?.hi ?? 0;
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

/** A drawn primitive: one or more runs of flat world `[x, y, x, y, ...]`. */
type Subpaths = readonly (readonly number[])[];

/**
 * Draw a cooked collection as a top-down SVG. Geometry points become
 * circles, primitives become paths (polylines open, polygons closed), and
 * instance batches contribute their transforms' translations — one color
 * per batch. Non-finite positions are skipped and counted rather than
 * poisoning the bounds, and a non-finite vertex breaks its primitive into
 * separate subpaths rather than splicing a segment that is in no input.
 */
export function renderSvg(collection: DataCollection, opts: RenderOptions = {}): RenderResult {
  checkOptions(opts);
  const width = Math.round(opts.width ?? 800);
  const radiusPx = opts.radius ?? 1.5;
  const maxPoints = opts.maxPoints ?? 50000;
  const maxPrimitives = opts.maxPrimitives ?? 20000;

  // Pass 1 — survey. The caps are a budget over the whole collection, so
  // the stride cannot be chosen one geometry at a time: three geometries
  // under a cap of ten must still draw ten circles, not thirty.
  let pointsTotal = 0;
  let primitivesTotal = 0;
  let instancesTotal = 0;
  let deviceInstances = 0;
  for (const item of collection) {
    if (item.kind === "instances") {
      if (item.deviceBatches !== undefined) {
        for (const batch of item.deviceBatches) deviceInstances += batch.count;
      } else {
        for (const batch of item.batches) instancesTotal += batch.count;
      }
      continue;
    }
    if (item.kind !== "geometry") continue;
    const P = item.geo.attrs.point.get("P");
    if (P === undefined || P.type === "string" || P.tupleSize < 2) continue;
    pointsTotal += item.geo.pointCount;
    primitivesTotal += item.geo.primitiveCount;
  }
  const circleStride = strideFor(pointsTotal + instancesTotal, maxPoints);
  const primStride = strideFor(primitivesTotal, maxPrimitives);
  const range = opts.attr === undefined ? undefined : scalarRange(collection, opts.attr);

  /** color -> flat world [x, y, x, y, ...] */
  const dots = new Map<string, number[]>();
  const openPaths: Subpaths[] = [];
  const closedPaths: Subpaths[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let points = 0;
  let primitives = 0;
  let instances = 0;
  let skipped = 0;
  let colorAttr: string | undefined;
  // Element counters run across the whole collection, so the stride is a
  // budget rather than a per-geometry allowance.
  let circleIndex = 0;
  let primIndex = 0;

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

  // Pass 2 — draw.
  for (let index = 0; index < collection.length; index++) {
    const item = collection[index];
    if (item.kind === "instances") {
      // Device-resident batches were counted in pass 1 and reported as
      // `deviceInstances`; reading `item.batches` here would throw.
      if (item.deviceBatches !== undefined) continue;
      item.batches.forEach((batch, b) => {
        const color = PALETTE[b % PALETTE.length];
        for (let i = 0; i < batch.count; i++) {
          if (circleIndex++ % circleStride !== 0) continue;
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
    if (geo.primitiveCount > 0) {
      const primType = geo.attrs.primitive.get("primtype");
      for (let p = 0; p < geo.primitiveCount; p++) {
        if (primIndex++ % primStride !== 0) continue;
        const start = geo.primVertexStart[p];
        const count = geo.primVertexCount[p];
        // A non-finite vertex ENDS the current run: the next finite vertex
        // starts a fresh `M`. Continuing the run instead would draw a
        // segment that is in no input.
        const subpaths: number[][] = [];
        let run: number[] = [];
        for (let v = 0; v < count; v++) {
          const point = geo.vertexToPoint[start + v];
          const x = px(point);
          const y = py(point);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            skipped++;
            if (run.length >= 4) subpaths.push(run);
            run = [];
            continue;
          }
          run.push(x, y);
        }
        if (run.length >= 4) subpaths.push(run);
        // Nothing with two usable vertices in a row: nothing is emitted,
        // so it is not a drawn primitive and it does not move the bounds.
        if (subpaths.length === 0) continue;
        for (const sub of subpaths) {
          for (let k = 0; k < sub.length; k += 2) track(sub[k], sub[k + 1]);
        }
        const isPolyline = primType !== undefined && primType.type === "string"
          ? primType.getString(p) === "polyline"
          : false;
        (isPolyline ? openPaths : closedPaths).push(subpaths);
        primitives++;
      }
    }

    const { color, used } = colorizer(geo, opts.attr, index, range);
    if (used !== undefined) colorAttr = used;
    for (let i = 0; i < geo.pointCount; i++) {
      if (circleIndex++ % circleStride !== 0) continue;
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
  const bounds = drewSomething
    ? { min: [minX, minY] as const, max: [maxX, maxY] as const }
    : undefined;
  if (!drewSomething) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const extentX = maxX - minX;
  const extentY = maxY - minY;
  const pad = Math.max(extentX, extentY) * 0.04 || 0.5;
  // The world rectangle the image covers, and the uniform world -> pixel
  // scale that maps it onto the image. Everything emitted below is in
  // pixels; nothing downstream sees a world coordinate.
  const boxX = minX - pad;
  const boxY = minY - pad;
  const boxW = extentX + pad * 2;
  const boxH = extentY + pad * 2;
  const ratio = boxH / boxW;
  const height = Number.isFinite(ratio) && ratio > 0 ? Math.max(1, Math.round(width * ratio)) : width;
  // An extent too small to divide (a world span near the bottom of the
  // double range) would make the scale infinite; falling back to 1 keeps
  // every number in the document finite.
  const rawScale = width / boxW;
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  const sx = (x: number): string => fmtCoord((x - boxX) * scale);
  const sy = (y: number): string => fmtCoord((y - boxY) * scale);
  const r = fmtCoord(radiusPx);

  const pathData = (subpaths: Subpaths, closed: boolean): string =>
    subpaths
      .map((sub) => {
        let d = "";
        for (let k = 0; k < sub.length; k += 2) {
          d += `${k === 0 ? "M" : "L"}${sx(sub[k])} ${sy(sub[k + 1])}`;
        }
        return closed ? `${d}Z` : d;
      })
      .join("");

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  lines.push(
    `<!-- pcg render: ${points} points, ${instances} instances, ${primitives} primitives${
      deviceInstances > 0 ? `, ${deviceInstances} device-resident instances not drawn` : ""
    }; x right, z down (top-down view) -->`,
  );
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${BACKGROUND}"/>`);
  if (closedPaths.length > 0) {
    lines.push(`<g fill="none" stroke="${POLY_COLOR}" stroke-width="${STROKE_WIDTH}">`);
    for (const sub of closedPaths) lines.push(`<path d="${pathData(sub, true)}"/>`);
    lines.push("</g>");
  }
  if (openPaths.length > 0) {
    lines.push(
      `<g fill="none" stroke="${POLYLINE_COLOR}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const sub of openPaths) lines.push(`<path d="${pathData(sub, false)}"/>`);
    lines.push("</g>");
  }
  // Sorted so the group order depends only on the colors present, never
  // on iteration or insertion accidents.
  for (const color of [...dots.keys()].sort()) {
    const flat = dots.get(color) as number[];
    lines.push(`<g fill="${color}">`);
    for (let i = 0; i < flat.length; i += 2) {
      lines.push(`<circle cx="${sx(flat[i])}" cy="${sy(flat[i + 1])}" r="${r}"/>`);
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
    instancesTotal,
    deviceInstances,
    skipped,
    ...(colorAttr !== undefined ? { colorAttr } : {}),
    ...(bounds !== undefined ? { bounds } : {}),
  };
}
