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

/**
 * The domains a picture can take color from, and the marks each one
 * colors. Vertex and detail are not here: a vertex is drawn as part of
 * its primitive's path rather than on its own, and a detail attribute has
 * one value for the whole geometry, which is a caption and not a color.
 */
export type ColorDomain = "point" | "primitive";

/** Canonical order, so reports and lookups never depend on a Set's order. */
const COLOR_DOMAINS = ["point", "primitive"] as const;

/** Stroke width for primitive paths, in pixels. */
const STROKE_WIDTH = "1.2";

/** Knobs for {@link renderSvg}; every one has a deterministic default. */
export interface RenderOptions {
  /** Image width in pixels, >= 1 (height follows the data's aspect ratio). */
  readonly width?: number;
  /**
   * Attribute to color by: scalars through a sequential ramp,
   * tuple-3-or-wider as RGB in [0, 1], strings categorically. Omitted,
   * everything draws in its default color — deliberately, because the
   * standard `color` attribute defaults to white and auto-adopting it
   * would draw an invisible picture for every graph that never set it.
   *
   * The name is looked up on BOTH colorable domains, and they never
   * compete for one mark: the POINT column colors the circles, the
   * PRIMITIVE column colors the paths. So a road network that carries
   * `width` on its roads and on its junctions colors both, and a value
   * that lives only on the primitives — the only place a per-edge value
   * can live — is visible instead of unreachable. Points of a geometry
   * whose only copy is on the primitive domain keep the flat default
   * color: a point shared by three roads has three candidate values and
   * inventing one of them would be a picture of nothing in the data.
   * {@link attrDomain} narrows the lookup to one domain.
   *
   * The scalar ramp is normalized over every geometry and every domain
   * read, so one picture has one legend. A geometry that carries the name
   * on neither domain is an error naming that item.
   */
  readonly attr?: string;
  /**
   * Read {@link attr} from this domain only, instead of from both. Worth
   * reaching for when one name means different things on points and
   * primitives, since the shared ramp would otherwise span both ranges.
   * Ignored — and refused — without `attr`.
   */
  readonly attrDomain?: ColorDomain;
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
  /**
   * Which domains {@link colorAttr} was actually found on, in canonical
   * order. Reported rather than assumed: the same name can live on the
   * points, on the primitives, or on both, and a reader who is not told
   * which one a picture came from cannot know what it means.
   */
  readonly colorDomains?: readonly ColorDomain[];
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
  if (opts.attrDomain !== undefined) {
    if (!(COLOR_DOMAINS as readonly string[]).includes(opts.attrDomain)) {
      bad(
        "attrDomain",
        '"point" or "primitive" (circles are colored from the point domain, paths from the primitive domain; vertex and detail draw no mark of their own)',
        opts.attrDomain,
      );
    }
    if (opts.attr === undefined) {
      throw new CliError(
        'renderSvg: option "attrDomain" narrows which domain "attr" is read from, so on its own it colors nothing — pass "attr" as well, or drop "attrDomain"',
      );
    }
  }
}

/**
 * Lowest and highest finite value of component 0 of `attrName` over every
 * geometry in the collection that carries it as a scalar, on every domain
 * being read. One ramp over the whole collection means one color means
 * one value in the picture — including across the two domains, so a road
 * and the junction it ends at are comparable by eye.
 */
function scalarRange(
  collection: DataCollection,
  attrName: string,
  domains: readonly ColorDomain[],
): { readonly lo: number; readonly hi: number } | undefined {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const item of collection) {
    if (item.kind !== "geometry") continue;
    for (const domain of domains) {
      const set = item.geo.attrs[domain];
      const attr = set.get(attrName);
      if (attr === undefined || attr.type === "string" || attr.tupleSize >= 3) continue;
      const stats = attributeStats(attr, set.count);
      const min = stats.min?.[0];
      const max = stats.max?.[0];
      if (min !== undefined && Number.isFinite(min) && min < lo) lo = min;
      if (max !== undefined && Number.isFinite(max) && max > hi) hi = max;
    }
  }
  return lo <= hi ? { lo, hi } : undefined;
}

/** Comma-listed attribute names of one domain, for a diagnostic. */
function attrNames(geo: Geometry, domain: ColorDomain): string {
  const names = [...geo.attrs[domain]].map((a) => a.name);
  return names.length === 0 ? "(none)" : names.join(", ");
}

/**
 * The columns one geometry contributes to the coloring, by domain. Both
 * are consulted unless `want` narrows it, because they color different
 * marks; carrying the name on neither is the error, and it names the item
 * and both domains' attributes so the caller can see what it could have
 * asked for instead.
 */
function resolveColorColumns(
  geo: Geometry,
  attrName: string,
  itemIndex: number,
  want: ColorDomain | undefined,
): { point?: Attribute; primitive?: Attribute } {
  const found: { point?: Attribute; primitive?: Attribute } = {};
  for (const domain of COLOR_DOMAINS) {
    if (want !== undefined && want !== domain) continue;
    const attr = geo.attrs[domain].get(attrName);
    if (attr !== undefined) found[domain] = attr;
  }
  if (found.point !== undefined || found.primitive !== undefined) return found;
  if (want === undefined) {
    throw new CliError(
      `item ${itemIndex} has no attribute "${attrName}" to color by on the point or the primitive domain; item ${itemIndex} point attributes: ${attrNames(geo, "point")}; primitive attributes: ${attrNames(geo, "primitive")}`,
    );
  }
  const other: ColorDomain = want === "point" ? "primitive" : "point";
  const elsewhere = geo.attrs[other].get(attrName) !== undefined;
  throw new CliError(
    `item ${itemIndex} has no ${want} attribute "${attrName}" to color by${
      elsewhere
        ? `, but item ${itemIndex} carries it on the ${other} domain — pass attrDomain "${other}", or drop attrDomain to color from both`
        : ""
    }; item ${itemIndex} ${want} attributes: ${attrNames(geo, want)}`,
  );
}

/**
 * Color for element `i` of one column: scalars through the ramp, tuple-3
 * and wider as RGB, strings categorically. Domain-agnostic — the index is
 * a point index or a primitive index depending on where the column lives.
 */
function columnColorizer(
  column: Attribute,
  range: { readonly lo: number; readonly hi: number } | undefined,
): (i: number) => string {
  const ts = column.tupleSize;
  if (column.type === "string") {
    // The color comes from a hash of the string VALUE, never from its
    // string-table index: interning order is an accident of the cook, and
    // keying on it recolors every category the moment one value first
    // appears somewhere else.
    const byIndex = column.stringTable.map((s) => PALETTE[hashString(s) % PALETTE.length]);
    return (i) => byIndex[column.data[i * ts]] ?? PALETTE[0];
  }
  if (ts >= 3) {
    return (i) =>
      `#${hex2(column.data[i * ts])}${hex2(column.data[i * ts + 1])}${hex2(column.data[i * ts + 2])}`;
  }
  const lo = range?.lo ?? 0;
  const hi = range?.hi ?? 0;
  const span = hi - lo;
  return (i) => {
    const v = column.data[i * ts];
    if (!Number.isFinite(v) || span <= 0) return RAMP[0];
    const bucket = Math.floor(((v - lo) / span) * RAMP.length);
    return RAMP[bucket < 0 ? 0 : bucket >= RAMP.length ? RAMP.length - 1 : bucket];
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
 *
 * {@link RenderOptions.attr} colors the circles from the point domain and
 * the paths from the primitive domain, so a per-edge value has a mark of
 * its own to land on.
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
  const rangeDomains = opts.attrDomain === undefined ? COLOR_DOMAINS : [opts.attrDomain];
  const range =
    opts.attr === undefined ? undefined : scalarRange(collection, opts.attr, rangeDomains);

  /** color -> flat world [x, y, x, y, ...] */
  const dots = new Map<string, number[]>();
  /** color -> the paths drawn in it, in collection order. */
  const openPaths = new Map<string, Subpaths[]>();
  const closedPaths = new Map<string, Subpaths[]>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let points = 0;
  let primitives = 0;
  let instances = 0;
  let skipped = 0;
  let colorAttr: string | undefined;
  const colorDomains = new Set<ColorDomain>();
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
  const addPath = (into: Map<string, Subpaths[]>, color: string, sub: Subpaths): void => {
    let group = into.get(color);
    if (group === undefined) into.set(color, (group = []));
    group.push(sub);
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

    // Resolved before anything is drawn, and only for a geometry that
    // survived the `P` check above — an item with no usable positions
    // draws nothing, so it is not asked to carry the color attribute.
    let pointColor: (i: number) => string = () => POINT_COLOR;
    let primColor: ((p: number) => string) | undefined;
    if (opts.attr !== undefined) {
      const found = resolveColorColumns(geo, opts.attr, index, opts.attrDomain);
      if (found.point !== undefined) {
        pointColor = columnColorizer(found.point, range);
        colorAttr = found.point.name;
        colorDomains.add("point");
      }
      if (found.primitive !== undefined) {
        primColor = columnColorizer(found.primitive, range);
        colorAttr = found.primitive.name;
        colorDomains.add("primitive");
      }
    }

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
        // Without a primitive column the stroke is the kind's default, so
        // an uncolored render is byte-for-byte the one it always was.
        const stroke = primColor?.(p) ?? (isPolyline ? POLYLINE_COLOR : POLY_COLOR);
        addPath(isPolyline ? openPaths : closedPaths, stroke, subpaths);
        primitives++;
      }
    }

    for (let i = 0; i < geo.pointCount; i++) {
      if (circleIndex++ % circleStride !== 0) continue;
      const x = px(i);
      const y = py(i);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        skipped++;
        continue;
      }
      addDot(pointColor(i), x, y);
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
  // Path groups are sorted by color for the same reason the dot groups
  // are: the document must depend on the colors present, never on which
  // primitive happened to be drawn first.
  for (const color of [...closedPaths.keys()].sort()) {
    lines.push(`<g fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}">`);
    for (const sub of closedPaths.get(color) as Subpaths[]) {
      lines.push(`<path d="${pathData(sub, true)}"/>`);
    }
    lines.push("</g>");
  }
  for (const color of [...openPaths.keys()].sort()) {
    lines.push(
      `<g fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const sub of openPaths.get(color) as Subpaths[]) {
      lines.push(`<path d="${pathData(sub, false)}"/>`);
    }
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
    ...(colorAttr !== undefined
      ? { colorAttr, colorDomains: COLOR_DOMAINS.filter((d) => colorDomains.has(d)) }
      : {}),
    ...(bounds !== undefined ? { bounds } : {}),
  };
}
