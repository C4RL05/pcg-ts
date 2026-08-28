/**
 * Corpus CI: cooking every example under `graphs/` and reducing
 * what came out to the two things worth asserting on.
 *
 * TWO COMPARISONS, AND THE SPLIT IS THE WHOLE DESIGN.
 *
 * 1. **Against a stored golden — shape-level only.** {@link graphStats}
 *    keeps element counts per domain, attribute presence (name, type and
 *    tuple size), instance batch shape, each batch's per-instance channels
 *    (see {@link ChannelStats}), the bounds of `P`, and a per-batch
 *    reduction of the instance transforms — every number among them
 *    compared within a tolerance. It deliberately throws away every raw float it computes on
 *    the way: a golden holding float dumps fights every legitimate change —
 *    a faster spatial grid, a reassociated sum, a different rounding in a
 *    transform — and a suite that cries wolf on improvements gets relaxed
 *    or deleted. What survives here still catches the failures that
 *    matter: a graph that stopped filtering, a node that stopped writing
 *    its attribute, a cloud that landed in the wrong place, a whole class
 *    of instances that changed size or orientation.
 *
 *    WHY THE TRANSFORMS ARE STATISTICS AND NOT A HASH. A hash of the
 *    transform bytes would be exact and compact, and it was the obvious
 *    first idea. It is the wrong instrument twice over. Exactness against
 *    a STORED constant is precisely what the paragraph above rejects, and
 *    the reason it gives names this case outright — "a different rounding
 *    in a transform". And a hash fails uninformatively: "the bytes moved"
 *    is not a bug report, whereas "batch 3 \"clamp\" scale mean y 0.9091
 *    (golden 0.4545)" names the batch, the quantity and the direction.
 *    Byte-exactness over transforms already ships in
 *    {@link graphFingerprint} below, where it compares a run against a run
 *    and cannot go stale — but that comparison moves WITH an intended
 *    edit, so it can never notice that a graph's instances all changed. A
 *    stored record is the only thing that can, and this is it.
 * 2. **Against itself — byte-exact.** {@link graphFingerprint} hashes
 *    the raw attribute bytes, the topology arrays and the instance
 *    transforms. This is where float-exactness belongs: comparing a run
 *    against a second run of the same build tests determinism, the hard
 *    invariant, and cannot be made stale by an intended change to the
 *    numbers.
 *
 * The module is shared by `scripts/gen-graphs-golden.mjs` (which writes
 * the golden) and `tests/graphs.test.ts` (which checks it), for the same
 * reason node-reference.ts is shared by its generator and its drift
 * test — including {@link cookGraph}, so the golden can never be
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
  type AttrData,
  type DataCollection,
  type DataItem,
  DOMAINS,
  type Domain,
  type Geometry,
  type InstanceBatch,
  type InstancesItem,
  cook,
  deserializeGraph,
  instanceAttributesOf,
  isDeviceResidentInstances,
} from "../index.js";
import { type BatchSummary, summarizeItem } from "../cli/summary.js";
// Side effect only: this is what makes `ref: { name }` resolvable.
import "../primitives/index.js";

/**
 * Cooperative yield budget handed to every corpus cook. Not a
 * correctness knob — cooking always completes — but exercising the
 * partitioned path on every example is free here and would otherwise go
 * untested against real graphs.
 */
export const GRAPHS_BUDGET_MS = 8;

/**
 * Wall-clock ceiling per example, covering deserialization and the cook.
 * A smoke budget, not a benchmark: tripping it means something changed by
 * an order of magnitude, which is the only performance claim a test on
 * shared CI hardware can honestly make.
 *
 * The ceiling was 3000 and the comment here said the slowest example ran
 * "in well under a tenth of this". That stopped being true as the corpus
 * grew, and the gap is what made this the suite's one flaky assertion.
 * Measured 2026-08-14, cooking every example in one process: the slowest
 * is `examples-gpu-fields.json` at ~1020ms, 7.7x the next (~130ms) and a
 * third of the old ceiling on its own — and a full parallel suite run
 * inflates it to ~2300ms, leaving under a quarter of the budget. It
 * tripped roughly one run in five and passed every targeted rerun, which
 * reads as a mystery rather than as a slow machine, exactly as the old
 * message claimed it could not be.
 *
 * So: sized against what the corpus actually costs. 10s is ~4x the worst
 * observed under load and ~75x the median, which still catches a hang or
 * an order-of-magnitude regression while leaving the scheduler room to be
 * unfair to one worker. Re-measure this rather than nudging it if it
 * starts tripping again — a ceiling nobody has measured is how it got
 * flaky the first time.
 */
export const GRAPHS_TIME_LIMIT_MS = 10000;

/** Decimal places every recorded number is rounded to before it is stored. */
export const ROUND_DECIMALS = 4;

/**
 * Absolute part of the comparison tolerance, in the quantity's own units.
 *
 * ONE TOLERANCE, GOVERNING EVERY NUMBER THE GOLDEN COMPARES: the bounds of
 * `P` and the instance-transform statistics. It was introduced with the
 * golden itself and has never been tuned, and its stated adversary is our
 * OWN intended change — a reassociated sum, a faster spatial grid, a
 * different rounding in a transform — not machine-to-machine float drift,
 * which no commit in this repository has ever reported. That is why it is
 * three orders of magnitude wider than f32 noise: it is sized for
 * reformulation, not for ulps.
 */
export const TOLERANCE_ABS = 1e-3;

/** Relative part of the comparison tolerance, scaled by the golden value. */
export const TOLERANCE_REL = 1e-3;

// ---------------------------------------------------------------------------
// Cooking.
// ---------------------------------------------------------------------------

/** What one corpus cook produced. */
export interface GraphCookResult {
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
export async function cookGraph(json: unknown): Promise<GraphCookResult> {
  const started = performance.now();
  const graph = deserializeGraph(json);
  const { outputs, stats } = await cook(graph, { budgetMs: GRAPHS_BUDGET_MS });
  return { outputs, elapsedMs: performance.now() - started, cooked: stats.cooked };
}

// ---------------------------------------------------------------------------
// The golden: shape-level statistics.
// ---------------------------------------------------------------------------

/** Element counts per domain. */
export type DomainCounts = { readonly [K in Domain]: number };

/** min / max / mean of a per-axis quantity over a batch's instances. */
export interface AxisStats {
  readonly min: readonly number[];
  readonly max: readonly number[];
  readonly mean: readonly number[];
}

/** min / max / mean of a scalar quantity over a batch's instances. */
export interface ScalarStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
}

/**
 * One instance batch, reduced.
 *
 * The three statistics are the three factors the batch is DEFINED by —
 * `InstanceBatch.transforms` documents each block as `T(P) * R(rot) *
 * S(scale)` — so the golden records the composition in the same terms the
 * protocol states it, rather than sixteen anonymous matrix entries a
 * reader would have to re-derive meaning from.
 *
 * `min`/`max` catch anything that moves the extremes; `mean` is what
 * catches a change confined to the INTERIOR of the batch, where the
 * extremes hold still — half the instances shifting is invisible to a
 * range and immediate in a mean.
 *
 * All three are ABSENT on a device-resident batch, whose transforms were
 * never composed on the host; see {@link batchStats}.
 */
/**
 * One per-instance channel of a batch, reduced.
 *
 * WHY THE GOLDEN RECORDS THESE AT ALL. A channel is the ABI between a
 * graph and its host (`spawnInstances`' `instanceAttrs`, plus the
 * reserved `"color"` entry a `colorAttr` writes), and it contributes no
 * element count, no `P` bounds and no transform statistic. Before this
 * existed, a regression that dropped every channel in the corpus — the
 * spawner skipping the write, a param stopping being read, an adapter
 * seam losing the record — regenerated a BYTE-IDENTICAL golden. There
 * was no assertion in this file that could fail for it.
 *
 * `name`, `type` and `itemSize` catch the channel disappearing, being
 * renamed, or losing its dtype to a widening; `values` catches the
 * column still being there and holding the wrong numbers. The item size
 * is the DERIVED one (`column.length / count`) rather than a stored
 * field, because the batch carries no stored one to record.
 */
export interface ChannelStats {
  readonly name: string;
  /** `f32` / `i32` / `u32` / `bool` — preserved from the point attribute, never widened. */
  readonly type: string;
  /** Components per instance, derived as `column.length / count`. */
  readonly itemSize: number;
  /**
   * Per-component min / max / mean over the batch's instances, compared
   * within the same tolerance as everything else here.
   *
   * Absent on an empty batch (nothing to reduce) and on a device-resident
   * one (the column is in GPU memory and was never composed on the host),
   * exactly as the transform statistics are. A component with no finite
   * value at all records `NaN`, which JSON writes as `null` and the
   * comparison then reports as a difference — loudly, which is the right
   * outcome for a corpus channel that has gone non-finite.
   */
  readonly values?: AxisStats;
}

export interface BatchStats {
  readonly assetId: string;
  readonly count: number;
  /**
   * Per-instance channels, in the order the spawner wrote them. Absent —
   * never empty — when the batch carries none, which is most of the
   * corpus; see {@link ChannelStats}.
   */
  readonly channels?: readonly ChannelStats[];
  /** World position of each instance: column 3 of its matrix. */
  readonly translation?: AxisStats;
  /** Per-axis scale: the length of each basis column. */
  readonly scale?: AxisStats;
  /**
   * Rotation MAGNITUDE in radians, scale divided out; 0 is unrotated.
   *
   * A magnitude and not an orientation, which is the one blind spot worth
   * knowing about: re-aiming every instance about a different axis through
   * the same angle leaves this untouched. A full orientation record would
   * be a quaternion whose sign and basis conventions a reader would have
   * to hold in their head to diff, and the failures this gate exists for —
   * a spawner that stopped orienting, an orient node reading the wrong
   * attribute, a whole part kind falling through to an unrotated default —
   * all move the magnitude.
   */
  readonly rotation?: ScalarStats;
}

/** One cooked item, reduced to what the golden pins. */
export interface GraphItemStats {
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
  /** Instances: one entry per batch, in batch order. */
  readonly batches?: readonly BatchStats[];
  /** Value items: the emitted value. */
  readonly value?: unknown;
}

/** One example's cooked outputs, reduced. */
export interface GraphStats {
  readonly outputs: Readonly<Record<string, readonly GraphItemStats[]>>;
}

/**
 * The golden file's shape.
 *
 * `formatVersion` went to 2 when instance batches gained their transform
 * statistics: a reader holding a version-1 file would find batches with no
 * transforms and conclude the corpus had none, which is the one wrong
 * answer available. It went to 3 when they gained their per-instance
 * channels, for exactly that reason a second time — a version-2 file
 * records no channel anywhere, and a reader cannot tell that from a
 * corpus that spawns none. Nothing migrates old files — the golden is
 * derived, and `npm run graphs:golden` re-derives it.
 */
export interface GraphsGolden {
  readonly formatVersion: 3;
  /** The tolerance every compared number in the file is checked within. */
  readonly tolerance: { readonly absolute: number; readonly relative: number };
  readonly examples: Readonly<Record<string, GraphStats>>;
}

/** Round for storage, and normalize `-0` to `0` so the bytes are stable. */
function round(v: number): number {
  if (!Number.isFinite(v)) return v;
  const factor = 10 ** ROUND_DECIMALS;
  const r = Math.round(v * factor) / factor;
  return r === 0 ? 0 : r;
}

/**
 * Reduce one batch's packed transforms to translation, scale and rotation
 * statistics. `undefined` when the batch holds no instances — a batch with
 * nothing in it has no distribution, and recording `Infinity` extremes
 * would only be a rounding hazard.
 *
 * The block layout is the one `InstanceBatch.transforms` commits to: 16
 * floats per instance, column-major, columns 0-2 the basis (rotation
 * times scale) and offsets 12-14 the translation. Scale comes back as each
 * basis column's length; dividing it out of the diagonal leaves the
 * rotation's trace, and `acos((trace - 1) / 2)` turns that into the angle
 * of the rotation regardless of which axis it is about.
 *
 * TWO DEGENERACIES, BOTH DELIBERATE. A zero-length column has no direction
 * to recover, so it contributes nothing to the trace — the same batch's
 * `scale` min reports the degeneracy in terms a reader can act on, which
 * an `undefined` angle would not. And a column length cannot be negative,
 * so a MIRRORED basis reads as unmirrored scale plus a rotation the sign
 * convention did not intend; nothing in this library composes one (the
 * spawner builds `T*R*S` from a quaternion and a non-negative scale), and
 * a golden is the wrong place to discover that it started.
 *
 * Accumulated in f64 over instances in index order, which is the order the
 * spawner wrote them: the sums are therefore as deterministic as the cook.
 * `Math.hypot` and `Math.acos` are only implementation-DEFINED in their
 * precision, so a different engine may land an ulp away — which is the
 * second reason these are compared within a tolerance rather than hashed.
 * `acos` is ill-conditioned at its endpoint and most corpus batches sit
 * near an angle of 0, but the amplification is `sqrt`: an ulp of trace
 * disagreement surfaces around 1e-8 radians, five orders inside the
 * tolerance and below the fourth decimal this is stored at.
 */
function batchTransformStats(
  assetId: string,
  transforms: Float32Array,
  count: number,
): { translation: AxisStats; scale: AxisStats; rotation: ScalarStats } | undefined {
  if (count <= 0) return undefined;
  // Not a defensive `min`: a short array against a declared count is a
  // broken batch, and reducing the prefix would record confident statistics
  // for instances that do not exist.
  if (transforms.length < count * 16) {
    throw new Error(
      `instance batch "${assetId}" declares ${count} instance(s) but carries ` +
        `${transforms.length} float(s); InstanceBatch.transforms is 16 floats per instance, ` +
        `so this batch needs ${count * 16}. Fix the spawner that produced it.`,
    );
  }
  const n = count;

  const tMin = [Infinity, Infinity, Infinity];
  const tMax = [-Infinity, -Infinity, -Infinity];
  const tSum = [0, 0, 0];
  const sMin = [Infinity, Infinity, Infinity];
  const sMax = [-Infinity, -Infinity, -Infinity];
  const sSum = [0, 0, 0];
  let rMin = Infinity;
  let rMax = -Infinity;
  let rSum = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 16;
    let trace = 0;
    for (let axis = 0; axis < 3; axis++) {
      const c = o + axis * 4;
      const x = transforms[c]!;
      const y = transforms[c + 1]!;
      const z = transforms[c + 2]!;
      const length = Math.hypot(x, y, z);
      if (length > 0) trace += transforms[c + axis]! / length;
      if (length < sMin[axis]!) sMin[axis] = length;
      if (length > sMax[axis]!) sMax[axis] = length;
      sSum[axis]! += length;

      const t = transforms[o + 12 + axis]!;
      if (t < tMin[axis]!) tMin[axis] = t;
      if (t > tMax[axis]!) tMax[axis] = t;
      tSum[axis]! += t;
    }
    const angle = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
    if (angle < rMin) rMin = angle;
    if (angle > rMax) rMax = angle;
    rSum += angle;
  }

  const mean = (sum: readonly number[]): number[] => sum.map((v) => round(v / n));
  return {
    translation: { min: tMin.map(round), max: tMax.map(round), mean: mean(tSum) },
    scale: { min: sMin.map(round), max: sMax.map(round), mean: mean(sSum) },
    rotation: { min: round(rMin), max: round(rMax), mean: round(rSum / n) },
  };
}

/**
 * Per-batch statistics, transforms included.
 *
 * THIS READS THE ITEM AND NOT ITS SUMMARY BECAUSE OF DEVICE RESIDENCY. A
 * device-resident item's `batches` accessor THROWS by design (see
 * `makeDeviceInstancesItem`): its transforms were written straight into
 * GPU buffers and never composed on the host, so there is nothing here to
 * reduce and no way to ask for it. Such a batch records its shape and no
 * transform statistics, and `residency` in the same entry is what tells a
 * reader why they are absent. The corpus cooks without a GPU, so this is a
 * guard rather than a path — but the golden generator is exactly the kind
 * of caller that would otherwise trip it.
 */
function batchStats(item: InstancesItem, shapes: readonly BatchSummary[]): BatchStats[] {
  if (isDeviceResidentInstances(item)) {
    return (item.deviceBatches ?? []).map((b, i) => ({
      assetId: b.assetId,
      count: b.count,
      // Shape only: a device channel's bytes are in GPU memory, so there
      // is nothing here to reduce — the same reason the transforms carry
      // no statistics on this residency.
      ...channelShapes(shapes[i]),
    }));
  }
  return item.batches.map((b, i) => ({
    assetId: b.assetId,
    count: b.count,
    ...channelStats(b, shapes[i]),
    ...batchTransformStats(b.assetId, b.transforms, b.count),
  }));
}

/**
 * Per-component min / max / mean of one channel column, in the same
 * terms — and the same tolerance class — as the transform statistics.
 *
 * `undefined` for an empty batch, which has no distribution, matching
 * {@link batchTransformStats}. Only finite values accumulate; a
 * component with none records `NaN` rather than an `Infinity` extreme
 * that rounding would turn into a number.
 */
function columnStats(column: AttrData, count: number, itemSize: number): AxisStats | undefined {
  if (count <= 0 || itemSize <= 0) return undefined;
  const min = new Array<number>(itemSize).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(itemSize).fill(Number.NEGATIVE_INFINITY);
  const sum = new Array<number>(itemSize).fill(0);
  const finite = new Array<number>(itemSize).fill(0);
  for (let k = 0; k < count; k++) {
    const offset = k * itemSize;
    for (let c = 0; c < itemSize; c++) {
      const v = column[offset + c]!;
      if (!Number.isFinite(v)) continue;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
      sum[c]! += v;
      finite[c]!++;
    }
  }
  return {
    min: min.map((v, c) => (finite[c]! > 0 ? round(v) : Number.NaN)),
    max: max.map((v, c) => (finite[c]! > 0 ? round(v) : Number.NaN)),
    mean: sum.map((v, c) => (finite[c]! > 0 ? round(v / finite[c]!) : Number.NaN)),
  };
}

/** The channel shapes a summary already worked out, or nothing to add. */
function channelShapes(shape: BatchSummary | undefined): { channels?: ChannelStats[] } {
  if (shape === undefined || shape.channels.length === 0) return {};
  return {
    channels: shape.channels.map((c) => ({ name: c.name, type: c.type, itemSize: c.itemSize })),
  };
}

/**
 * A CPU batch's channels, shape and statistics together.
 *
 * The shapes come from the CLI summary for the same reason the geometry
 * attribute signatures do — one implementation of "what is on this
 * batch" behind both `pcg inspect` and the golden — and the columns are
 * read off the batch here, because the summary deliberately does not
 * carry bytes.
 */
function channelStats(
  batch: InstanceBatch,
  shape: BatchSummary | undefined,
): { channels?: ChannelStats[] } {
  const shaped = channelShapes(shape);
  if (shaped.channels === undefined) return {};
  const columns = instanceAttributesOf(batch);
  return {
    channels: shaped.channels.map((c) => {
      const column = columns[c.name];
      const values = column === undefined ? undefined : columnStats(column, batch.count, c.itemSize);
      return values === undefined ? c : { ...c, values };
    }),
  };
}

/** `P:f32x3`, `density:f32`, `seed:u32` — name, type, and tuple size when it is not 1. */
function attrSignature(a: { name: string; type: string; tupleSize: number }): string {
  return `${a.name}:${a.type}${a.tupleSize > 1 ? `x${a.tupleSize}` : ""}`;
}

/**
 * Reduce one cooked item to its shape-level statistics.
 *
 * It goes through the CLI's `summarizeItem`, which computes per-attribute
 * minima, maxima and means — and then drops all of them but the `P`
 * bounds. Reusing the summarizer keeps one implementation of "what is in
 * this geometry" behind both `pcg inspect` and the golden; discarding
 * most of its output is the point of a shape-level golden.
 */
function itemStats(item: DataItem): GraphItemStats {
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
  // `summarizeItem` reports the batch SHAPE for either residency and stops
  // there, so the transforms it does not carry are read off the item — and
  // `batchStats` needs the item anyway, to reach `deviceBatches`. The
  // summary's kind mirrors the item's, but the summary union does not carry
  // that correspondence, so the narrowing happens here. Loudly: a silent
  // empty list would record a spawner's output as spawning nothing.
  if (item.kind !== "instances") {
    throw new Error(
      `graphGolden: summarizeItem reported an "instances" summary for a "${item.kind}" item`,
    );
  }
  return {
    kind: "instances",
    tags: summary.tags,
    residency: summary.residency,
    instances: summary.instances,
    batches: batchStats(item, summary.batches),
  };
}

/** Reduce a whole cook to the golden's shape-level statistics. */
export function graphStats(outputs: Record<string, DataCollection>): GraphStats {
  const reduced: Record<string, readonly GraphItemStats[]> = {};
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
 * {@link graphStats}, object keys are emitted in the fixed order of the
 * literals above, every recorded number is rounded to
 * {@link ROUND_DECIMALS} places with `-0` normalized away, and the file
 * ends in a single LF. Nothing carries a timestamp, so regenerating an
 * unchanged corpus rewrites the same bytes.
 */
export function renderGraphsGolden(
  entries: readonly { readonly file: string; readonly stats: GraphStats }[],
): string {
  const examples: Record<string, GraphStats> = {};
  for (const e of entries.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    examples[e.file] = e.stats;
  }
  const golden: GraphsGolden = {
    formatVersion: 3,
    tolerance: { absolute: TOLERANCE_ABS, relative: TOLERANCE_REL },
    examples,
  };
  return JSON.stringify(golden, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Comparing against the golden.
// ---------------------------------------------------------------------------

function within(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return Object.is(actual, expected);
  return Math.abs(actual - expected) <= TOLERANCE_ABS + TOLERANCE_REL * Math.abs(expected);
}

/** The window `expected` was allowed, rendered for the failure line. */
function toleranceOf(expected: number): string {
  return (TOLERANCE_ABS + TOLERANCE_REL * Math.abs(expected)).toPrecision(3);
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

const STATS = ["min", "max", "mean"] as const;

/**
 * Compare one per-axis statistic. Every line names the batch, the
 * quantity, which of min/max/mean moved and along which axis, because
 * "the transforms differ" is not something a reader can act on.
 */
function diffAxisStats(
  where: string,
  quantity: string,
  actual: AxisStats | undefined,
  expected: AxisStats | undefined,
  out: string[],
): void {
  if (actual === undefined && expected === undefined) return;
  if (actual === undefined || expected === undefined) {
    out.push(
      `${where} ${quantity} statistics ${actual === undefined ? "absent" : "present"} (golden the ` +
        "opposite); an empty batch and a device-resident one both record none, so check `count` and `residency`",
    );
    return;
  }
  for (const stat of STATS) {
    const a = actual[stat];
    const e = expected[stat];
    for (let i = 0; i < Math.max(a.length, e.length); i++) {
      const av = a[i] ?? Number.NaN;
      const ev = e[i] ?? Number.NaN;
      if (!within(av, ev)) {
        out.push(
          `${where} ${quantity} ${stat} ${AXES[i] ?? i} ${av} (golden ${ev}, tolerance ${toleranceOf(ev)})`,
        );
      }
    }
  }
}

/** Compare one scalar statistic; see {@link diffAxisStats}. */
function diffScalarStats(
  where: string,
  quantity: string,
  actual: ScalarStats | undefined,
  expected: ScalarStats | undefined,
  out: string[],
): void {
  if (actual === undefined && expected === undefined) return;
  if (actual === undefined || expected === undefined) {
    out.push(
      `${where} ${quantity} statistics ${actual === undefined ? "absent" : "present"} (golden the ` +
        "opposite); an empty batch and a device-resident one both record none, so check `count` and `residency`",
    );
    return;
  }
  for (const stat of STATS) {
    if (!within(actual[stat], expected[stat])) {
      out.push(
        `${where} ${quantity} ${stat} ${actual[stat]} (golden ${expected[stat]}, tolerance ${toleranceOf(
          expected[stat],
        )})`,
      );
    }
  }
}

/** `color:f32x3` — the signature a channel is matched on. */
function channelSignature(c: ChannelStats): string {
  return `${c.name}:${c.type}${c.itemSize > 1 ? `x${c.itemSize}` : ""}`;
}

/**
 * Compare one batch's channels: first that the same channels are there
 * under the same names, types and item sizes, then what each holds.
 *
 * The list diff is the one that catches the failure this record exists
 * for — a spawner that stopped writing the channels — so it names the
 * mechanism, because "channels missing color:f32x3" is only actionable
 * if a reader knows which param puts it there.
 */
function diffChannels(
  where: string,
  actual: readonly ChannelStats[] | undefined,
  expected: readonly ChannelStats[] | undefined,
  out: string[],
): void {
  const a = actual ?? [];
  const e = expected ?? [];
  const diff = listDiff(a.map(channelSignature), e.map(channelSignature));
  if (diff !== undefined) {
    out.push(
      `${where} channels ${diff}; a channel comes from spawnInstances' instanceAttrs, or from ` +
        'colorAttr, which writes the reserved "color" one',
    );
  }
  for (const channel of e) {
    const mine = a.find((c) => c.name === channel.name);
    // A channel that is gone, or is no longer the same shape, is already
    // reported above; comparing its numbers would bury that line.
    if (mine === undefined || channelSignature(mine) !== channelSignature(channel)) continue;
    diffAxisStats(`${where} channel "${channel.name}"`, "value", mine.values, channel.values, out);
  }
}

function diffItem(where: string, actual: GraphItemStats, expected: GraphItemStats): string[] {
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
            `${where}: bounds ${side} ${AXES[i] ?? i} ${av} (golden ${ev}, tolerance ${toleranceOf(ev)})`,
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
    const actualBatches = actual.batches ?? [];
    const expectedBatches = expected.batches ?? [];
    const a = actualBatches.map((b) => `${b.assetId}=${b.count}`);
    const e = expectedBatches.map((b) => `${b.assetId}=${b.count}`);
    const diff = listDiff(a, e);
    if (diff !== undefined) out.push(`${where}: batches ${diff}`);

    for (let i = 0; i < Math.min(actualBatches.length, expectedBatches.length); i++) {
      const ab = actualBatches[i]!;
      const eb = expectedBatches[i]!;
      // A batch that is no longer the same batch is already reported by the
      // shape diff above; comparing one asset's transforms against another
      // asset's would bury that line under statistics nobody asked for.
      if (ab.assetId !== eb.assetId) continue;
      const at = `${where}: batch ${i} "${eb.assetId}"`;
      diffChannels(at, ab.channels, eb.channels, out);
      diffAxisStats(at, "translation", ab.translation, eb.translation, out);
      diffAxisStats(at, "scale", ab.scale, eb.scale, out);
      diffScalarStats(at, "rotation", ab.rotation, eb.rotation, out);
    }
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
export function diffGraphStats(
  actual: GraphStats,
  expected: GraphStats,
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
  return value + ":" + hashBytes(encoder.encode(attr.stringTable.join("\u0000")));
}

/**
 * A CPU batch's channels as one hash per channel, keyed by name; absent
 * when the batch carries none, so a channel-less corpus fingerprints
 * exactly as it did before channels existed.
 */
function channelFingerprint(batch: InstanceBatch): { channels?: Record<string, string> } {
  const columns = instanceAttributesOf(batch);
  const names = Object.keys(columns);
  if (names.length === 0) return {};
  const channels: Record<string, string> = {};
  for (const name of names) {
    const column = columns[name]!;
    channels[name] = hashBytes(
      new Uint8Array(column.buffer, column.byteOffset, column.byteLength),
    );
  }
  return { channels };
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
export function graphFingerprint(outputs: Record<string, DataCollection>): Record<string, unknown> {
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
          // Channels are cook output like any other, so they belong in the
          // determinism hash too — a channel whose values moved between two
          // runs of one build is the same class of bug as a transform that
          // did. Read through the normalizer so a batch spelling its colour
          // as a plain `colors` hashes identically to one spelling it as the
          // reserved channel.
          ...channelFingerprint(b),
        })),
      };
    });
  }
  return result;
}
