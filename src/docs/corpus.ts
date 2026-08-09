/**
 * Corpus CI: cooking every example under `examples/graphs/` and reducing
 * what came out to the two things worth asserting on.
 *
 * TWO COMPARISONS, AND THE SPLIT IS THE WHOLE DESIGN.
 *
 * 1. **Against a stored golden — count-level only.** {@link corpusStats}
 *    keeps element counts per domain, attribute presence (name, type and
 *    tuple size), instance batch shape, and the bounds of `P` compared
 *    within a tolerance. It deliberately throws away every float it
 *    computes on the way: a golden holding float dumps fights every
 *    legitimate change — a faster spatial grid, a reassociated sum, a
 *    different rounding in a transform — and a suite that cries wolf on
 *    improvements gets relaxed or deleted. What survives here still
 *    catches the failures that matter: a graph that stopped filtering, a
 *    node that stopped writing its attribute, a cloud that landed in the
 *    wrong place.
 * 2. **Against itself — byte-exact.** {@link corpusFingerprint} hashes
 *    the raw attribute bytes, the topology arrays and the instance
 *    transforms. This is where float-exactness belongs: comparing a run
 *    against a second run of the same build tests determinism, the hard
 *    invariant, and cannot be made stale by an intended change to the
 *    numbers.
 *
 * The module is shared by `scripts/gen-corpus-golden.mjs` (which writes
 * the golden) and `tests/corpus.test.ts` (which checks it), for the same
 * reason node-reference.ts is shared by its generator and its drift
 * test — including {@link cookCorpusGraph}, so the golden can never be
 * recorded under different cook options than the ones it is checked
 * under.
 *
 * THE PRIMITIVES IMPORT BELOW IS LOAD-BEARING. Corpus graphs reference
 * primitives by name, names resolve inside `deserializeGraph` against a
 * global registry, and the registry is populated by importing
 * `../primitives/index.js` for its side effect. It sits here, in the one
 * module both callers go through, rather than in each caller: a caller
 * that forgot it would report an unresolvable name for a graph that is
 * perfectly valid.
 */
import {
  type Attribute,
  type DataCollection,
  type DataItem,
  DOMAINS,
  type Domain,
  type Geometry,
  cook,
  deserializeGraph,
  isDeviceResidentInstances,
} from "../index.js";
import { summarizeItem } from "../cli/summary.js";
// Side effect only: this is what makes `ref: { name }` resolvable.
import "../primitives/index.js";

/**
 * Cooperative yield budget handed to every corpus cook. Not a
 * correctness knob — cooking always completes — but exercising the
 * partitioned path on every example is free here and would otherwise go
 * untested against real graphs.
 */
export const CORPUS_BUDGET_MS = 8;

/**
 * Wall-clock ceiling per example, covering deserialization and the cook.
 * A smoke budget, not a benchmark: the corpus is authored small on
 * purpose (the slowest example runs in well under a tenth of this), so
 * tripping it means something changed by an order of magnitude, which is
 * the only performance claim a test on shared CI hardware can honestly
 * make.
 */
export const CORPUS_TIME_LIMIT_MS = 3000;

/** Decimal places bounds are rounded to before they are stored. */
export const BOUNDS_DECIMALS = 4;

/** Absolute part of the bounds comparison tolerance, in world units. */
export const BOUNDS_ABS_TOL = 1e-3;

/** Relative part of the bounds comparison tolerance, scaled by the golden value. */
export const BOUNDS_REL_TOL = 1e-3;

// ---------------------------------------------------------------------------
// Cooking.
// ---------------------------------------------------------------------------

/** What one corpus cook produced. */
export interface CorpusCookResult {
  readonly outputs: Record<string, DataCollection>;
  /** Wall-clock milliseconds for deserialization plus the cook. */
  readonly elapsedMs: number;
  /** Nodes whose execute ran (a fresh graph has cold caches, so: all of them). */
  readonly cooked: number;
}

/**
 * Deserialize a corpus graph and cook every declared output. Both the
 * golden generator and the corpus test go through here, so the golden is
 * always recorded under the options it is checked under.
 */
export async function cookCorpusGraph(json: unknown): Promise<CorpusCookResult> {
  const started = performance.now();
  const graph = deserializeGraph(json);
  const { outputs, stats } = await cook(graph, { budgetMs: CORPUS_BUDGET_MS });
  return { outputs, elapsedMs: performance.now() - started, cooked: stats.cooked };
}

// ---------------------------------------------------------------------------
// The golden: count-level statistics.
// ---------------------------------------------------------------------------

/** Element counts per domain. */
export type DomainCounts = { readonly [K in Domain]: number };

/** One cooked item, reduced to what the golden pins. */
export interface CorpusItemStats {
  readonly kind: "geometry" | "value" | "instances";
  readonly tags: readonly string[];
  /** Geometry: element counts per domain. */
  readonly counts?: DomainCounts;
  /** Geometry: attribute presence per domain, as `name:type` or `name:typexN`. Empty domains are omitted. */
  readonly attrs?: Readonly<Record<string, readonly string[]>>;
  /** Geometry: bounds of `P`, rounded, compared within a tolerance. */
  readonly bounds?: { readonly min: readonly number[]; readonly max: readonly number[] };
  /** Instances: whether the transforms live on the host or on the GPU device. */
  readonly residency?: "cpu" | "device";
  /** Instances: total across batches. */
  readonly instances?: number;
  /** Instances: one entry per asset id, in batch order. */
  readonly batches?: readonly { readonly assetId: string; readonly count: number }[];
  /** Value items: the emitted value. */
  readonly value?: unknown;
}

/** One example's cooked outputs, reduced. */
export interface CorpusExampleStats {
  readonly outputs: Readonly<Record<string, readonly CorpusItemStats[]>>;
}

/** The golden file's shape. */
export interface CorpusGolden {
  readonly formatVersion: 1;
  readonly boundsTolerance: { readonly absolute: number; readonly relative: number };
  readonly examples: Readonly<Record<string, CorpusExampleStats>>;
}

/** Round for storage, and normalize `-0` to `0` so the bytes are stable. */
function round(v: number): number {
  if (!Number.isFinite(v)) return v;
  const factor = 10 ** BOUNDS_DECIMALS;
  const r = Math.round(v * factor) / factor;
  return r === 0 ? 0 : r;
}

/** `P:f32x3`, `density:f32`, `seed:u32` — name, type, and tuple size when it is not 1. */
function attrSignature(a: { name: string; type: string; tupleSize: number }): string {
  return `${a.name}:${a.type}${a.tupleSize > 1 ? `x${a.tupleSize}` : ""}`;
}

/**
 * Reduce one cooked item to its count-level statistics.
 *
 * It goes through the CLI's `summarizeItem`, which computes per-attribute
 * minima, maxima and means — and then drops all of them but the `P`
 * bounds. Reusing the summarizer keeps one implementation of "what is in
 * this geometry" behind both `pcg inspect` and the golden; discarding
 * most of its output is the point of a count-level golden.
 */
function itemStats(item: DataItem): CorpusItemStats {
  const summary = summarizeItem(item);
  if (summary.kind === "geometry") {
    const g = summary.geometry;
    const counts: Record<string, number> = {};
    const attrs: Record<string, readonly string[]> = {};
    for (const d of g.domains) {
      counts[d.domain] = d.count;
      if (d.attrs.length > 0) attrs[d.domain] = d.attrs.map(attrSignature);
    }
    return {
      kind: "geometry",
      tags: summary.tags,
      counts: {
        point: counts.point ?? 0,
        vertex: counts.vertex ?? 0,
        primitive: counts.primitive ?? 0,
        detail: counts.detail ?? 0,
      },
      attrs,
      ...(g.bounds !== undefined
        ? { bounds: { min: g.bounds.min.map(round), max: g.bounds.max.map(round) } }
        : {}),
    };
  }
  if (summary.kind === "value") {
    return { kind: "value", tags: summary.tags, value: summary.value };
  }
  return {
    kind: "instances",
    tags: summary.tags,
    residency: summary.residency,
    instances: summary.instances,
    batches: summary.batches.map((b) => ({ assetId: b.assetId, count: b.count })),
  };
}

/** Reduce a whole cook to the golden's count-level statistics. */
export function corpusStats(outputs: Record<string, DataCollection>): CorpusExampleStats {
  const reduced: Record<string, readonly CorpusItemStats[]> = {};
  for (const name of Object.keys(outputs).sort()) {
    reduced[name] = (outputs[name] ?? []).map(itemStats);
  }
  return { outputs: reduced };
}

/**
 * Render the golden file.
 *
 * Deterministic by the mechanisms the doc generators use, and the
 * regeneration script depends on all of them: examples are keyed by file
 * name and inserted in sorted order, output names are sorted in
 * {@link corpusStats}, object keys are emitted in the fixed order of the
 * literals above, bounds are rounded to {@link BOUNDS_DECIMALS} places
 * with `-0` normalized away, and the file ends in a single LF. Nothing
 * carries a timestamp, so regenerating an unchanged corpus rewrites the
 * same bytes.
 */
export function renderCorpusGolden(
  entries: readonly { readonly file: string; readonly stats: CorpusExampleStats }[],
): string {
  const examples: Record<string, CorpusExampleStats> = {};
  for (const e of entries.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    examples[e.file] = e.stats;
  }
  const golden: CorpusGolden = {
    formatVersion: 1,
    boundsTolerance: { absolute: BOUNDS_ABS_TOL, relative: BOUNDS_REL_TOL },
    examples,
  };
  return JSON.stringify(golden, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Comparing against the golden.
// ---------------------------------------------------------------------------

function within(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return Object.is(actual, expected);
  return Math.abs(actual - expected) <= BOUNDS_ABS_TOL + BOUNDS_REL_TOL * Math.abs(expected);
}

function listDiff(actual: readonly string[], expected: readonly string[]): string | undefined {
  const missing = expected.filter((e) => !actual.includes(e));
  const added = actual.filter((a) => !expected.includes(a));
  if (missing.length === 0 && added.length === 0) {
    return actual.join(", ") === expected.join(", ") ? undefined : "reordered";
  }
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
  if (added.length > 0) parts.push(`unexpected ${added.join(", ")}`);
  return parts.join("; ");
}

const AXES = ["x", "y", "z"];

function diffItem(where: string, actual: CorpusItemStats, expected: CorpusItemStats): string[] {
  const out: string[] = [];
  if (actual.kind !== expected.kind) {
    return [`${where}: kind "${actual.kind}" (golden "${expected.kind}")`];
  }
  const tagDiff = listDiff(actual.tags, expected.tags);
  if (tagDiff !== undefined) out.push(`${where}: tags ${tagDiff}`);

  const actualCounts = actual.counts;
  const expectedCounts = expected.counts;
  if (expectedCounts !== undefined && actualCounts !== undefined) {
    for (const domain of DOMAINS) {
      const a = actualCounts[domain];
      const e = expectedCounts[domain];
      if (a !== e) out.push(`${where}: ${domain} count ${a} (golden ${e})`);
    }
  }

  const expectedAttrs = expected.attrs ?? {};
  const actualAttrs = actual.attrs ?? {};
  if (expected.attrs !== undefined || actual.attrs !== undefined) {
    for (const domain of new Set([...Object.keys(expectedAttrs), ...Object.keys(actualAttrs)])) {
      const diff = listDiff(actualAttrs[domain] ?? [], expectedAttrs[domain] ?? []);
      if (diff !== undefined) out.push(`${where}: ${domain} attributes ${diff}`);
    }
  }

  if (expected.bounds !== undefined && actual.bounds !== undefined) {
    for (const side of ["min", "max"] as const) {
      const a = actual.bounds[side];
      const e = expected.bounds[side];
      for (let i = 0; i < Math.max(a.length, e.length); i++) {
        const av = a[i] ?? Number.NaN;
        const ev = e[i] ?? Number.NaN;
        if (!within(av, ev)) {
          out.push(
            `${where}: bounds ${side} ${AXES[i] ?? i} ${av} (golden ${ev}, tolerance ${(
              BOUNDS_ABS_TOL +
              BOUNDS_REL_TOL * Math.abs(ev)
            ).toPrecision(3)})`,
          );
        }
      }
    }
  } else if ((expected.bounds === undefined) !== (actual.bounds === undefined)) {
    out.push(`${where}: bounds ${actual.bounds === undefined ? "absent" : "present"} (golden the opposite)`);
  }

  if (expected.kind === "instances") {
    if (actual.instances !== expected.instances) {
      out.push(`${where}: ${actual.instances} instances (golden ${expected.instances})`);
    }
    if (actual.residency !== expected.residency) {
      out.push(`${where}: residency "${actual.residency}" (golden "${expected.residency}")`);
    }
    const a = (actual.batches ?? []).map((b) => `${b.assetId}=${b.count}`);
    const e = (expected.batches ?? []).map((b) => `${b.assetId}=${b.count}`);
    const diff = listDiff(a, e);
    if (diff !== undefined) out.push(`${where}: batches ${diff}`);
  }

  if (expected.kind === "value" && !Object.is(actual.value, expected.value)) {
    out.push(`${where}: value ${JSON.stringify(actual.value)} (golden ${JSON.stringify(expected.value)})`);
  }

  return out;
}

/**
 * Every way `actual` departs from the golden, as lines a reader can act
 * on. Empty means they agree. The caller names the file; each line names
 * the output, the item and the quantity, because "expected 512 to be
 * 284" is not a bug report.
 */
export function diffCorpusStats(
  actual: CorpusExampleStats,
  expected: CorpusExampleStats,
): string[] {
  const out: string[] = [];
  const names = new Set([...Object.keys(expected.outputs), ...Object.keys(actual.outputs)]);
  for (const name of [...names].sort()) {
    const a = actual.outputs[name];
    const e = expected.outputs[name];
    if (e === undefined) {
      out.push(`output "${name}": present, not in the golden`);
      continue;
    }
    if (a === undefined) {
      out.push(`output "${name}": missing (the golden has ${e.length} item(s))`);
      continue;
    }
    if (a.length !== e.length) {
      out.push(`output "${name}": ${a.length} item(s) (golden ${e.length})`);
    }
    for (let i = 0; i < Math.min(a.length, e.length); i++) {
      out.push(...diffItem(`output "${name}" item ${i}`, a[i]!, e[i]!));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The determinism fingerprint: byte-exact, run against run.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * A 64-bit hash of a byte range, as 16 hex characters: two independent
 * FNV-1a streams over the same bytes. One 32-bit stream would collide
 * once in four billion, which is a poor bet to make against a
 * determinism invariant that is checked on every run.
 */
function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ byte, 0x9e3779b1) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The used prefix of an attribute's storage, as bytes. Capacity beyond `count` is not data. */
function attributeBytes(attr: Attribute, count: number): Uint8Array {
  const used = count * attr.tupleSize;
  const data = attr.data;
  return new Uint8Array(data.buffer, data.byteOffset, used * data.BYTES_PER_ELEMENT);
}

function hashAttribute(attr: Attribute, count: number): string {
  const value = hashBytes(attributeBytes(attr, count));
  if (attr.type !== "string") return value;
  // Indices alone say nothing: two runs agree on index 3 while disagreeing
  // on what index 3 spells.
  return value + ":" + hashBytes(encoder.encode(attr.stringTable.join(" ")));
}

function hashTypedArray(array: Uint32Array): string {
  return hashBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

function geometryFingerprint(geo: Geometry): Record<string, unknown> {
  const domains: Record<string, Record<string, string>> = {};
  for (const domain of DOMAINS) {
    const set = geo.attrs[domain];
    const columns: Record<string, string> = {};
    for (const attr of set) columns[attr.name] = hashAttribute(attr, set.count);
    domains[domain] = columns;
  }
  return {
    counts: {
      point: geo.pointCount,
      vertex: geo.vertexCount,
      primitive: geo.primitiveCount,
      detail: geo.attrs.detail.count,
    },
    attrs: domains,
    topology: {
      vertexToPoint: hashTypedArray(geo.vertexToPoint),
      primVertexStart: hashTypedArray(geo.primVertexStart),
      primVertexCount: hashTypedArray(geo.primVertexCount),
    },
  };
}

/**
 * A float-exact fingerprint of a whole cook: every attribute column, the
 * topology arrays, and every instance transform, hashed. Two cooks of the
 * same graph on the same build must produce the identical structure —
 * that is the determinism invariant, and unlike the golden it compares a
 * run against a run, so an intended change to the numbers can never make
 * it stale.
 */
export function corpusFingerprint(outputs: Record<string, DataCollection>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(outputs).sort()) {
    result[name] = (outputs[name] ?? []).map((item): Record<string, unknown> => {
      if (item.kind === "geometry") {
        return { kind: "geometry", tags: [...item.tags].sort(), ...geometryFingerprint(item.geo) };
      }
      if (item.kind === "value") {
        return { kind: "value", tags: [...item.tags].sort(), value: item.value };
      }
      if (isDeviceResidentInstances(item)) {
        // Device transforms live in GPU memory and reading them throws;
        // the corpus never cooks with a GPU, so this is a guard, not a path.
        return {
          kind: "instances",
          tags: [...item.tags].sort(),
          residency: "device",
          batches: (item.deviceBatches ?? []).map((b) => ({ assetId: b.assetId, count: b.count })),
        };
      }
      return {
        kind: "instances",
        tags: [...item.tags].sort(),
        residency: "cpu",
        batches: item.batches.map((b) => ({
          assetId: b.assetId,
          count: b.count,
          transforms: hashBytes(
            new Uint8Array(b.transforms.buffer, b.transforms.byteOffset, b.transforms.byteLength),
          ),
        })),
      };
    });
  }
  return result;
}
