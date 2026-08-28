/**
 * Summarizing cooked data for the CLI: element counts per domain,
 * per-attribute statistics, bounds, and sample rows. Pure and
 * deterministic — the same geometry always summarizes to the same
 * numbers, in attribute insertion order.
 */
import {
  type Attribute,
  type AttrData,
  type AttrType,
  DOMAINS,
  type DataItem,
  type DataValue,
  type Domain,
  type Geometry,
  type InstanceBatch,
  type DeviceInstanceBatch,
  deviceInstanceAttributesOf,
  instanceAttributesOf,
  isDeviceResidentInstances,
  primitiveTypeCounts,
} from "../index.js";
import { fmtStat, plural } from "./format.js";

/** Statistics for one attribute column. */
export interface AttrStats {
  readonly name: string;
  readonly type: AttrType;
  readonly tupleSize: number;
  /** Per-component minimum over finite values; absent when there are none. */
  readonly min?: readonly number[];
  readonly max?: readonly number[];
  readonly mean?: readonly number[];
  /** Scalar slots that were not finite (NaN or +-Infinity). */
  readonly nonFinite?: number;
  /** String attributes: how many distinct values are actually used. */
  readonly distinct?: number;
  /** String attributes: the first few distinct values, in table order. */
  readonly values?: readonly string[];
}

/** How many distinct string values `inspect` lists before truncating. */
const MAX_STRING_VALUES = 8;

/** Compute statistics for one attribute over its first `count` elements. */
export function attributeStats(attr: Attribute, count: number): AttrStats {
  const ts = attr.tupleSize;
  const base = { name: attr.name, type: attr.type, tupleSize: ts };
  if (attr.type === "string") {
    const used = new Set<number>();
    for (let i = 0; i < count * ts; i++) used.add(attr.data[i]);
    const values: string[] = [];
    for (let idx = 0; idx < attr.stringTable.length && values.length < MAX_STRING_VALUES; idx++) {
      if (used.has(idx)) values.push(attr.stringTable[idx]);
    }
    return { ...base, distinct: used.size, values };
  }
  if (count === 0) return { ...base, nonFinite: 0 };
  const min = new Array<number>(ts).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(ts).fill(Number.NEGATIVE_INFINITY);
  const sum = new Array<number>(ts).fill(0);
  const finite = new Array<number>(ts).fill(0);
  let nonFinite = 0;
  for (let i = 0; i < count; i++) {
    const offset = i * ts;
    for (let c = 0; c < ts; c++) {
      const v = attr.data[offset + c];
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
      sum[c] += v;
      finite[c]++;
    }
  }
  const anyFinite = finite.some((n) => n > 0);
  if (!anyFinite) return { ...base, nonFinite };
  return {
    ...base,
    min: min.map((v, c) => (finite[c] > 0 ? v : Number.NaN)),
    max: max.map((v, c) => (finite[c] > 0 ? v : Number.NaN)),
    mean: sum.map((v, c) => (finite[c] > 0 ? v / finite[c] : Number.NaN)),
    nonFinite,
  };
}

/** One domain of a geometry. */
export interface DomainSummary {
  readonly domain: Domain;
  readonly count: number;
  readonly attrs: readonly AttrStats[];
}

/** A whole geometry item. */
export interface GeometrySummary {
  readonly points: number;
  readonly vertices: number;
  readonly primitives: number;
  readonly domains: readonly DomainSummary[];
  /** Axis-aligned bounds of the point positions (`P`), when present and finite. */
  readonly bounds?: { readonly min: readonly number[]; readonly max: readonly number[] };
  /**
   * `P` slots excluded from {@link bounds} because they were not finite,
   * when there were any. Present means the box does NOT contain every
   * point, and every rendering of the bounds has to say so — a box
   * printed as if it were complete is worse than no box at all.
   */
  readonly boundsExcluded?: number;
  /**
   * Primitive counts per `primtype` value. Absent when the geometry
   * carries no such column, when the column is not a string, and — the
   * case worth stating — when the column exists over ZERO primitives,
   * which a primitive filter that kept nothing produces. `primitives: 0`
   * already says that, so an empty record would only be a second way to
   * say it.
   */
  readonly primTypes?: Readonly<Record<string, number>>;
}

/** Summarize every domain of a geometry, plus bounds and primitive types. */
export function geometrySummary(geo: Geometry): GeometrySummary {
  const domains = DOMAINS.map((domain): DomainSummary => {
    const set = geo.attrs[domain];
    const attrs: AttrStats[] = [];
    for (const attr of set) attrs.push(attributeStats(attr, set.count));
    return { domain, count: set.count, attrs };
  });
  const summary: {
    points: number;
    vertices: number;
    primitives: number;
    domains: DomainSummary[];
    bounds?: { min: number[]; max: number[] };
    boundsExcluded?: number;
    primTypes?: Record<string, number>;
  } = {
    points: geo.pointCount,
    vertices: geo.vertexCount,
    primitives: geo.primitiveCount,
    domains,
  };
  const p = geo.attrs.point.get("P");
  if (p !== undefined && p.type !== "string" && p.tupleSize >= 3) {
    const stats = attributeStats(p, geo.pointCount);
    if (stats.min !== undefined && stats.max !== undefined) {
      summary.bounds = {
        min: [...stats.min].slice(0, 3),
        max: [...stats.max].slice(0, 3),
      };
      if (stats.nonFinite !== undefined && stats.nonFinite > 0) {
        summary.boundsExcluded = stats.nonFinite;
      }
    }
  }
  // Absent rather than empty when the geometry carries no tag, so the
  // rendered summary keeps saying nothing instead of saying "none".
  const primTypes = primitiveTypeCounts(geo);
  if (Object.keys(primTypes).length > 0) summary.primTypes = primTypes;
  return summary;
}

/**
 * One per-instance channel of an instance batch — what `spawnInstances`'
 * `instanceAttrs` carried across the spawner, plus the reserved `"color"`
 * entry a `colorAttr` produces.
 *
 * SHAPE AND NOT STATISTICS, deliberately. What an author needs back from
 * `pcg inspect` is the one thing they cannot see anywhere else: that the
 * channel they named actually crossed, under the name and the dtype they
 * wrote it with. A channel that was dropped, renamed, or silently widened
 * to f32 is exactly what this makes visible, and none of those show up in
 * a minimum or a mean.
 */
export interface ChannelSummary {
  readonly name: string;
  /** Element type, preserved from the point attribute. Never `"string"` — the spawner refuses those. */
  readonly type: AttrType;
  /**
   * Components per instance. DERIVED as `column.length / count`, because
   * the batch never carries it; `0` when the batch holds no instances,
   * where there is nothing to divide by and nothing to describe.
   */
  readonly itemSize: number;
}

/** One instance batch, reduced to its asset, its size and its channels. */
export interface BatchSummary {
  readonly assetId: string;
  readonly count: number;
  /** In the order the spawner wrote them, which is the order `instanceAttrs` named them. */
  readonly channels: readonly ChannelSummary[];
}

/** A cooked item, whatever its kind. */
export type ItemSummary =
  | { readonly kind: "geometry"; readonly tags: readonly string[]; readonly geometry: GeometrySummary }
  | { readonly kind: "value"; readonly tags: readonly string[]; readonly value: DataValue }
  | {
      readonly kind: "instances";
      readonly tags: readonly string[];
      readonly residency: "cpu" | "device";
      readonly batches: readonly BatchSummary[];
      readonly instances: number;
    };

/**
 * The {@link AttrType} a CPU channel's array class stands for. `string`
 * cannot occur — `instanceAttrs` refuses a string attribute at the
 * spawner, since its column is indices into a table that does not cross
 * with it — so `Uint32Array` is unambiguously `u32`.
 */
function channelType(column: AttrData): AttrType {
  if (column instanceof Float32Array) return "f32";
  if (column instanceof Int32Array) return "i32";
  if (column instanceof Uint8Array) return "bool";
  return "u32";
}

/**
 * A CPU batch's channels, read through `instanceAttributesOf` rather than
 * off `batch.attributes` — that is the one form that is always right, and
 * it lifts a hand-built batch's plain `colors` into the reserved channel
 * so both spellings report identically.
 */
function cpuChannels(batch: InstanceBatch): ChannelSummary[] {
  const channels: ChannelSummary[] = [];
  for (const [name, column] of Object.entries(instanceAttributesOf(batch))) {
    channels.push({
      name,
      type: channelType(column),
      itemSize: batch.count > 0 ? column.length / batch.count : 0,
    });
  }
  return channels;
}

/**
 * A device batch's channels. The device twin carries its own `type` and
 * `itemSize`, so nothing is derived here: the buffer PADS an itemSize of
 * 3 to four slots and carries a `bool` as u32 words, and reporting the
 * padded width would describe the buffer rather than the channel the
 * author asked for.
 */
function deviceChannels(batch: DeviceInstanceBatch): ChannelSummary[] {
  const channels: ChannelSummary[] = [];
  for (const [name, channel] of Object.entries(deviceInstanceAttributesOf(batch))) {
    channels.push({ name, type: channel.type, itemSize: channel.itemSize });
  }
  return channels;
}

/** Summarize one data item. */
export function summarizeItem(item: DataItem): ItemSummary {
  const tags = [...item.tags].sort();
  if (item.kind === "geometry") {
    return { kind: "geometry", tags, geometry: geometrySummary(item.geo) };
  }
  if (item.kind === "value") {
    return { kind: "value", tags, value: item.value };
  }
  // Device-resident batches keep their transforms in GPU memory and
  // reading `batches` throws by design; report the shape either way.
  const device = isDeviceResidentInstances(item);
  const batches: BatchSummary[] = device
    ? (item.deviceBatches ?? []).map((b) => ({
        assetId: b.assetId,
        count: b.count,
        channels: deviceChannels(b),
      }))
    : item.batches.map((b) => ({
        assetId: b.assetId,
        count: b.count,
        channels: cpuChannels(b),
      }));
  return {
    kind: "instances",
    tags,
    residency: device ? "device" : "cpu",
    batches,
    instances: batches.reduce((n, b) => n + b.count, 0),
  };
}

/** Attribute names with their types, e.g. `P(f32x3), density(f32)`. */
export function attrListText(attrs: readonly AttrStats[]): string {
  if (attrs.length === 0) return "(none)";
  return attrs
    .map((a) => `${a.name}(${a.type}${a.tupleSize > 1 ? `x${a.tupleSize}` : ""})`)
    .join(", ");
}

/**
 * A batch's channels as ` [phase(f32), plantId(u32)]`, spelled like
 * {@link attrListText} because a channel IS a point attribute that
 * crossed the spawner. Empty string — not `(none)` — when there are no
 * channels: most batches have none, and a per-batch "(none)" would push
 * the asset list off the line to say nothing.
 */
export function channelListText(channels: readonly ChannelSummary[]): string {
  if (channels.length === 0) return "";
  const list = channels
    .map((c) => `${c.name}(${c.type}${c.itemSize > 1 ? `x${c.itemSize}` : ""})`)
    .join(", ");
  return ` [${list}]`;
}

/** One dense line describing an item — the `cook` and `validate` listing form. */
export function itemLine(summary: ItemSummary): string {
  if (summary.kind === "value") {
    return `value      ${JSON.stringify(summary.value)}`;
  }
  if (summary.kind === "instances") {
    const assets = summary.batches
      .map((b) => `${b.assetId} x${b.count}${channelListText(b.channels)}`)
      .join(", ");
    return `instances  ${plural(summary.instances, "instance")} in ${plural(
      summary.batches.length,
      "batch",
      "batches",
    )} (${summary.residency})${assets === "" ? "" : ` — ${assets}`}`;
  }
  const g = summary.geometry;
  const point = g.domains.find((d) => d.domain === "point");
  const bounds =
    g.bounds === undefined
      ? ""
      : `  bounds ${g.bounds.min.map(fmtStat).join(",")} .. ${g.bounds.max.map(fmtStat).join(",")}${
          g.boundsExcluded === undefined
            ? ""
            : ` (excludes ${plural(g.boundsExcluded, "non-finite P value")})`
        }`;
  return (
    `geometry   points ${g.points}  vertices ${g.vertices}  primitives ${g.primitives}` +
    `${bounds}  point attrs: ${attrListText(point?.attrs ?? [])}`
  );
}

/** Column headers and rows for the first `count` elements of one domain. */
export interface SampleRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Elements in the domain (rows may be fewer). */
  readonly total: number;
}

/** Format the first `limit` elements of a domain as text rows. */
export function sampleRows(geo: Geometry, domain: Domain, limit: number): SampleRows {
  const set = geo.attrs[domain];
  const attrs: Attribute[] = [...set];
  const total = set.count;
  const rows: string[][] = [];
  const shown = Math.max(0, Math.min(limit, total));
  for (let i = 0; i < shown; i++) {
    const row = [String(i)];
    for (const attr of attrs) {
      if (attr.type === "string") {
        row.push(
          attr.tupleSize === 1
            ? JSON.stringify(attr.getString(i))
            : `[${Array.from({ length: attr.tupleSize }, (_, c) => JSON.stringify(attr.getString(i, c))).join(", ")}]`,
        );
        continue;
      }
      const tuple = attr.getTuple(i);
      row.push(tuple.length === 1 ? fmtStat(tuple[0]) : `[${tuple.map(fmtStat).join(", ")}]`);
    }
    rows.push(row);
  }
  return { columns: ["#", ...attrs.map((a) => a.name)], rows, total };
}
