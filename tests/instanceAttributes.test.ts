/**
 * Named per-instance attribute channels: the ABI between a graph and its
 * host, pinned end to end.
 *
 * WHAT THIS FILE IS FOR. `InstanceBatch.attributes` is the only route by
 * which graph-authored per-instance data reaches a renderer — the field
 * grammar has no time input on purpose, so a phase offset, a stable id or
 * an RGBA tint has to leave the graph as DATA on a batch. Four promises
 * ride on that, and a host can check none of them from the outside:
 *
 *   1. `attributes[name]` slot `k` and `transforms` slot `k` are the same
 *      instance, on every path.
 *   2. Item size is DERIVED (`column.length / count`), never carried.
 *   3. Dtype is the point attribute's own, never widened to f32.
 *   4. `batch.colors` is one buffer with two spellings, not a sibling
 *      mechanism, and ABSENT is the default for both.
 *
 * Every one of those is invisible in a picture. A permuted gather renders
 * as instances that are individually plausible and collectively wrong; a
 * u32 id widened to f32 is exact for the first 16.7 million instances and
 * then silently is not. So they are asserted here rather than reasoned
 * about.
 *
 * HOW THE ORDER INVARIANT IS MADE FALSIFIABLE. Most fixtures cannot see a
 * permutation at all: a channel gathered in point order and a channel
 * gathered in batch order agree whenever the two orders agree, and for a
 * single-asset spawn they always do. So `channelCloud` below encodes the
 * point's own INDEX in every value it carries — including its position —
 * and the spawn is multi-asset with an interleaved asset pattern, which
 * is what makes batch order and point order genuinely different lists.
 * `POINT_ORDER_GATHER` states what the wrong implementation would
 * produce. The assertions that catch the bug are the per-batch column
 * equality and the per-slot pairing; the two literals are additionally
 * checked against EACH OTHER, so a later fixture edit cannot quietly
 * remove the gap and leave those two passing for a permuted gather.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER. Device-resident spawning
 * (`src/gpu`) rejects `instanceAttrs` at plan time and falls back to this
 * CPU path, so there is no second producer to compare against; the run
 * planner's rejection is `src/gpu`'s own suite. The three renderer
 * adapters' upload of these channels is `src/three`'s.
 */
import { describe, expect, it } from "vitest";
import {
  type AttrData,
  type GeometryItem,
  Graph,
  INSTANCE_COLOR_CHANNEL,
  type InstanceBatch,
  type InstancesItem,
  cook,
  createPointCloud,
  defineNode,
  type Geometry,
  instanceAttributesOf,
  makeGeometryItem,
  makeInstancesItem,
  pointScatterInBounds,
  randomField,
  setAttribute,
  spawnInstances,
  type SpawnInstancesParams,
} from "../src/index.js";
// By path: the worker protocol is a subpath export (`pcg-ts/worker`), not
// part of the root surface, and this suite drives the codec directly
// rather than standing up a real worker.
import { decodeOutputs, encodeOutputs } from "../src/worker/protocol.js";
// The byte-exact outputs comparator the runtime determinism suites use.
// It already walks `instanceAttributesOf` and compares the CONSTRUCTOR as
// well as the bytes, which is exactly the equality this feature needs.
import { outputsDiff } from "../src/runtime/runtime.testsupport.js";

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

/**
 * Per-point asset ids, interleaved so that batch order and point order are
 * different lists.
 *
 * First-occurrence batch order is therefore ["rock", "tree"], and the
 * stable partition puts points [0, 3, 5, 6] in "rock" and [1, 2, 4, 7] in
 * "tree" — see {@link BATCH_ORDER_GATHER}. A gather that walked the point
 * column instead would hand "rock" the first four points and "tree" the
 * last four ({@link POINT_ORDER_GATHER}), which disagrees in six of the
 * eight slots — only "rock" slot 0 and "tree" slot 3 coincide. That gap is
 * what makes the order test able to fail.
 */
const SPECIES: readonly string[] = [
  "rock",
  "tree",
  "tree",
  "rock",
  "tree",
  "rock",
  "rock",
  "tree",
];

/** Points in the fixture cloud. */
const N = SPECIES.length;

/** Source point index per instance slot, per batch — the correct gather. */
const BATCH_ORDER_GATHER: readonly (readonly number[])[] = [
  [0, 3, 5, 6],
  [1, 2, 4, 7],
];

/**
 * What a gather that read the point column sequentially would produce
 * instead: batch `j` taking the next `count` points in ascending index.
 * Stated as data so the order test can assert it is NOT the output —
 * an assertion nobody has to re-derive when reading the file.
 */
const POINT_ORDER_GATHER: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
];

/**
 * Base of the `bigId` channel: the first odd integer above 2^24, so every
 * value it carries is a u32 that f32 CANNOT represent. Widening the
 * channel — the easy uniform choice this ABI refuses — corrupts it, and
 * the dtype test asserts that directly rather than trusting the comment.
 */
const BIG_ID_BASE = 16_777_217;

/** The `bigId` value point `i` carries. Odd, so f32-lossy at every point. */
function bigIdAt(i: number): number {
  return BIG_ID_BASE + 2 * i;
}

/**
 * The fixture: `N` points where EVERY value a point carries — its
 * position included — is a function of the point's own index, so any
 * instance slot can be traced back to exactly one source point.
 *
 * `P` is `[i, 10i, 100i]`. The three components are checked together
 * ({@link sourceIndexOf}), so a slot cannot be attributed to the wrong
 * point by coincidence: only point `i` has both x = i and z = 100i. Every
 * value is a small integer or a f32-exact fraction, so nothing here can
 * fail for a rounding reason instead of an ordering one.
 *
 * The channels span the dtype vocabulary a host can ask for (`f32`,
 * `i32`, `u32`, `bool`), both tuple shapes (scalar and `f32x2`), and the
 * two things a spawner refuses (`species`, a string; and the reserved
 * `color`, which `createPointCloud` already supplies).
 */
function channelCloud(): Geometry {
  const geo = createPointCloud(N);
  const points = geo.attrs.point;
  const P = points.require("P");
  const pid = points.add("pid", "u32", 1, 0);
  const phase = points.add("phase", "f32", 1, 0);
  const bias = points.add("bias", "i32", 1, 0);
  const bigId = points.add("bigId", "u32", 1, 0);
  const flag = points.add("flag", "bool", 1, 0);
  const uv = points.add("uv", "f32", 2, [0, 0]);
  const tint = points.add("tint", "f32", 4, [0, 0, 0, 0]);
  const species = points.add("species", "string", 1, "");
  for (let i = 0; i < N; i++) {
    P.setTuple(i, [i, 10 * i, 100 * i]);
    pid.set(i, i);
    // 0.1 * i is not exact in f32; the assertions compare against the
    // stored column rather than against the arithmetic, which is the
    // comparison the ABI actually promises.
    phase.set(i, 0.1 * i);
    // Below -2^24: f32 would lose the per-point difference entirely.
    bias.set(i, -2_000_000_000 + i);
    bigId.set(i, bigIdAt(i));
    flag.set(i, i % 2);
    uv.setTuple(i, [0.1 * i, 1 - 0.1 * i]);
    // Alpha is deliberately not 1: `colorAttr` drops it, and the colour
    // test asserts three components rather than four.
    tint.setTuple(i, [0.1 * i, 0.25, 0.5, 0.75]);
    species.setString(i, SPECIES[i]);
  }
  return geo;
}

// ---------------------------------------------------------------------------
// Cooking helpers
// ---------------------------------------------------------------------------

/** Source emitting one fixed geometry item (stable rev across cooks). */
function sourceOf(item: GeometryItem) {
  return defineNode<Record<string, never>>({
    type: "testSource",
    inputs: [],
    outputs: [{ name: "out", kind: "geometry" }],
    defaultParams: {},
    execute: () => ({ out: [item] }),
  });
}

/** The instances item of a cook's `instances` output, narrowed. */
function instancesOf(collection: readonly { kind: string }[], where: string): InstancesItem {
  const item = collection[0];
  if (item === undefined || item.kind !== "instances") {
    throw new Error(`${where}: expected one instances item, got ${item?.kind ?? "nothing"}`);
  }
  return item as InstancesItem;
}

/**
 * Cook `geo` through a real `spawnInstances` node and hand back its
 * batches.
 *
 * REFUSES AN EMPTY BATCH LIST, which is this file's shared non-vacuity
 * guard. Almost every assertion below lives inside `for (const batch of
 * batches)`, so a spawner that returned nothing would run zero of them
 * and every test would pass green while testing nothing. One check here
 * covers all of them, and it belongs here rather than repeated per test:
 * no caller in this file has a legitimate empty spawn.
 */
async function spawnBatches(
  geo: Geometry,
  params: Partial<SpawnInstancesParams>,
): Promise<readonly InstanceBatch[]> {
  const graph = new Graph(7);
  const src = graph.add(sourceOf(makeGeometryItem(geo)));
  const spawn = graph.add(spawnInstances, params);
  graph.connect(src, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");
  const result = await cook(graph);
  const batches = instancesOf(result.outputs.instances, "spawnBatches").batches;
  if (batches.length === 0) {
    throw new Error(
      `spawnBatches produced no batches for ${JSON.stringify(params)}; every check in this ` +
        "file loops over them, so an empty spawn would pass vacuously",
    );
  }
  return batches;
}

/** One named channel of a batch, or a message naming what IS there. */
function channelOf(batch: InstanceBatch, name: string): AttrData {
  const attrs = batch.attributes;
  if (attrs === undefined) {
    throw new Error(`batch "${batch.assetId}" carries no attributes at all; expected "${name}"`);
  }
  const column = attrs[name];
  if (column === undefined) {
    throw new Error(
      `batch "${batch.assetId}" has no channel "${name}"; channels present: ` +
        `${Object.keys(attrs).join(", ") || "(none)"}`,
    );
  }
  return column;
}

/** A point attribute's storage, for comparing a channel against its source. */
function pointColumn(geo: Geometry, name: string): AttrData {
  return geo.attrs.point.require(name).data;
}

/**
 * The source point of instance slot `k`, read off the TRANSFORM.
 *
 * The anchor has to be the transform and not a channel: the claim under
 * test is that the channels agree with the transform, so identifying the
 * point from a channel would make the whole check circular — a
 * consistently permuted gather would satisfy it. All three components are
 * checked, so `k` cannot be attributed to the wrong point by coincidence.
 */
function sourceIndexOf(batch: InstanceBatch, k: number): number {
  const base = k * 16;
  const i = batch.transforms[base + 12];
  const where = `instance ${k} of batch "${batch.assetId}"`;
  expect(i, `${where}: P.x is not a point index`).toBe(Math.trunc(i));
  expect(batch.transforms[base + 13], `${where}: P.y does not corroborate P.x`).toBe(10 * i);
  expect(batch.transforms[base + 14], `${where}: P.z does not corroborate P.x`).toBe(100 * i);
  return i;
}

/** Every instance slot of every batch, as (batch index, slot, source point). */
function* slots(
  batches: readonly InstanceBatch[],
): Generator<{ j: number; batch: InstanceBatch; k: number; i: number }> {
  for (let j = 0; j < batches.length; j++) {
    const batch = batches[j];
    for (let k = 0; k < batch.count; k++) {
      yield { j, batch, k, i: sourceIndexOf(batch, k) };
    }
  }
}

// ---------------------------------------------------------------------------
// 1. The order invariant
// ---------------------------------------------------------------------------

describe("instance order is the invariant every channel rests on", () => {
  it("gathers channels in BATCH order, slot for slot with the transforms", async () => {
    const geo = channelCloud();
    const batches = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: ["pid"],
    });

    // The premise: the spawn really did permute. Without this the test
    // could pass on a fixture where the two orders coincide.
    expect(batches.map((b) => b.assetId)).toEqual(["rock", "tree"]);
    expect(batches.map((b) => b.count)).toEqual([4, 4]);

    // The FIXTURE's discriminating power, checked once and on the literals
    // themselves. An asset pattern that grouped the points contiguously
    // (all "rock", then all "tree") would make the two gathers the same
    // list, and every assertion below would hold just as well for a
    // point-order gather. This guards that; it is not what catches the bug.
    expect(BATCH_ORDER_GATHER, "the fixture no longer permutes").not.toEqual(POINT_ORDER_GATHER);

    for (let j = 0; j < batches.length; j++) {
      // The channel is the identity of the source point, so the whole
      // gather is one list per batch — and THIS is the assertion that
      // catches the bug: read the point column sequentially instead of
      // through the grouping permutation and the column becomes exactly
      // POINT_ORDER_GATHER[j], which is not this.
      expect(Array.from(channelOf(batches[j], "pid")), `batch ${j} "pid" column`).toEqual(
        BATCH_ORDER_GATHER[j],
      );
    }

    // And the pairing itself, per slot: the point the channel names is the
    // point whose position landed in the same slot's transform.
    let checked = 0;
    for (const { batch, k, i } of slots(batches)) {
      expect(channelOf(batch, "pid")[k], `slot ${k} of "${batch.assetId}"`).toBe(i);
      checked++;
    }
    expect(checked).toBe(N);
  });

  it("REDDENS if a channel is read from the wrong slot (control)", async () => {
    // The comparison above is only worth something if it can fail. Shift
    // one batch's column by a slot — the exact damage a second traversal
    // falling out of step would do — and the per-slot check must reject it.
    const batches = await spawnBatches(channelCloud(), {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: ["pid"],
    });
    const batch = batches[0];
    const shifted = Uint32Array.from(channelOf(batch, "pid"));
    shifted.copyWithin(0, 1);
    let disagreements = 0;
    for (let k = 0; k < batch.count; k++) {
      if (shifted[k] !== sourceIndexOf(batch, k)) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism
// ---------------------------------------------------------------------------

/**
 * A seeded graph whose channels are actually random: a scatter, a
 * `randomField` phase, a weighted string draw feeding `assetAttr`, and
 * the standard per-point `seed` (u32, and routinely above 2^24) carried
 * as a channel of its own.
 *
 * Built fresh each call, with EXPLICIT node ids: a node's seed is
 * `hashCombine(graphSeed, hashString(nodeId))`, so pinning the ids is
 * what makes two independently constructed graphs the same graph rather
 * than two graphs that happen to look alike.
 */
function seededSpawnGraph(graphSeed = 20_260_828): Graph {
  const graph = new Graph(graphSeed);
  const scatter = graph.add(
    pointScatterInBounds,
    { count: 96, boundsMin: [-8, -8, -8], boundsMax: [8, 8, 8] },
    "scatter",
  );
  const phase = graph.add(
    setAttribute,
    { name: "phase", type: "f32", value: randomField("phase") },
    "phase",
  );
  const tint = graph.add(
    setAttribute,
    { name: "tint", type: "f32", tupleSize: 3, value: randomField("tint") },
    "tint",
  );
  const kind = graph.add(
    setAttribute,
    {
      name: "kind",
      type: "string",
      values: ["rock", "tree", "bush"],
      weights: [3, 2, 1],
      select: randomField("kind"),
    },
    "kind",
  );
  const spawn = graph.add(
    spawnInstances,
    {
      assetId: "fallback",
      assetAttr: "kind",
      colorAttr: "tint",
      instanceAttrs: ["seed", "phase"],
    },
    "spawn",
  );
  graph.connect(scatter, "out", phase, "in");
  graph.connect(phase, "out", tint, "in");
  graph.connect(tint, "out", kind, "in");
  graph.connect(kind, "out", spawn, "in");
  graph.output(spawn, "instances", "instances");
  graph.output(spawn, "points", "points");
  return graph;
}

describe("channels are byte-identical across cooks and cook orders", () => {
  it("two independent cooks of the same seed agree, values and dtypes", async () => {
    // Two graphs, not two cooks of one: a second cook of the same object
    // is served from the memo cache and would compare an item with itself.
    const first = await cook(seededSpawnGraph());
    const second = await cook(seededSpawnGraph());

    // Non-vacuity, stated before the equality. An empty spawn, a
    // single-asset spawn or an all-zero channel would make the comparison
    // below true for the wrong reasons.
    const batches = instancesOf(first.outputs.instances, "first cook").batches;
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.reduce((n, b) => n + b.count, 0)).toBe(96);
    const seeds = batches.flatMap((b) => Array.from(channelOf(b, "seed")));
    expect(new Set(seeds).size).toBeGreaterThan(1);
    // The u32 channel really is carrying values f32 could not hold, so
    // this equality is testing the dtype promise and not just the bytes.
    expect(seeds.some((s) => Math.fround(s) !== s)).toBe(true);

    expect(outputsDiff(first.outputs, second.outputs)).toBeNull();
  });

  it("a selected, one-output-at-a-time cook and a starved budget agree with the whole", async () => {
    // Three cook ORDERS over the same graph. `outputs` visits only the
    // induced upstream subgraph (and in the graph's declaration order,
    // not the selection's), and `budgetMs: 0` yields to the event loop
    // between nodes — maximum partitioning in time. Neither may move a
    // byte of a channel.
    const whole = await cook(seededSpawnGraph());

    const selected = seededSpawnGraph();
    await cook(selected, { outputs: ["points"] });
    const afterPoints = await cook(selected, { outputs: ["instances"] });

    const starved = await cook(seededSpawnGraph(), { budgetMs: 0 });

    expect(
      outputsDiff({ instances: whole.outputs.instances }, { instances: afterPoints.outputs.instances }),
      "cooking `points` first changed the instances",
    ).toBeNull();
    expect(outputsDiff(whole.outputs, starved.outputs), "budgetMs 0 changed the cook").toBeNull();
  });

  it("reports a channel difference when there is one (comparator control)", () => {
    // The equalities above are worth exactly what the comparator can see.
    // `outputsDiff` is the runtime suites' comparator and it learned about
    // channels when they shipped; these three cases prove it looks at
    // them — a value, and a dtype whose values would compare equal
    // element-wise for every number under 2^24.
    const transforms = (): Float32Array => {
      const t = new Float32Array(16);
      t[15] = 1;
      return t;
    };
    const item = (id: AttrData): InstancesItem =>
      makeInstancesItem([
        { assetId: "a", count: 1, transforms: transforms(), attributes: { bigId: id } },
      ]);

    const left = item(Uint32Array.of(BIG_ID_BASE));
    expect(outputsDiff({ x: [left] }, { x: [item(Uint32Array.of(BIG_ID_BASE))] })).toBeNull();
    expect(outputsDiff({ x: [left] }, { x: [item(Uint32Array.of(BIG_ID_BASE + 2))] })).not.toBeNull();
    expect(
      String(outputsDiff({ x: [left] }, { x: [item(Float32Array.of(BIG_ID_BASE))] })),
    ).toMatch(/dtype/);
  });
});

// ---------------------------------------------------------------------------
// 3. Dtype preservation
// ---------------------------------------------------------------------------

describe("a channel keeps the point attribute's own dtype", () => {
  it("carries f32, i32, u32 and bool as their own array classes, exactly", async () => {
    const geo = channelCloud();
    const names = ["phase", "bias", "bigId", "flag"] as const;
    const batches = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: [...names],
    });

    const expected = {
      phase: Float32Array,
      bias: Int32Array,
      bigId: Uint32Array,
      // `bool` is a byte, not a widened float and not a bitfield.
      flag: Uint8Array,
    } as const;
    for (const batch of batches) {
      for (const name of names) {
        expect(channelOf(batch, name), `channel "${name}"`).toBeInstanceOf(expected[name]);
      }
    }

    // Values, against the SOURCE column rather than against the
    // arithmetic that produced it: the promise is that the bytes the
    // point domain held are the bytes the host receives.
    const src = {
      phase: pointColumn(geo, "phase"),
      bias: pointColumn(geo, "bias"),
      bigId: pointColumn(geo, "bigId"),
      flag: pointColumn(geo, "flag"),
    };
    for (const { batch, k, i } of slots(batches)) {
      for (const name of names) {
        expect(channelOf(batch, name)[k], `channel "${name}" slot ${k} <- point ${i}`).toBe(
          src[name][i],
        );
      }
    }
  });

  it("returns a u32 above 2^24 exactly — the case f32 would silently corrupt", async () => {
    const geo = channelCloud();
    // The premise: these values are genuinely outside f32's integer range,
    // so "it came back exactly" is a statement about the dtype and not a
    // number that would have survived anything.
    for (let i = 0; i < N; i++) {
      expect(Math.fround(bigIdAt(i)), `bigId at point ${i} is f32-representable`).not.toBe(
        bigIdAt(i),
      );
    }

    const batches = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: ["bigId"],
    });
    for (const { batch, k, i } of slots(batches)) {
      const column = channelOf(batch, "bigId");
      expect(column).toBeInstanceOf(Uint32Array);
      expect(column[k], `bigId slot ${k} <- point ${i}`).toBe(bigIdAt(i));
    }
    // Spelled out once as a literal, so the exact integer is in the file
    // and not only in a generator: point 0 is the first odd u32 above 2^24.
    expect(channelOf(batches[0], "bigId")[0]).toBe(16_777_217);
  });
});

// ---------------------------------------------------------------------------
// 4. Item size derivation
// ---------------------------------------------------------------------------

describe("item size is derived from the column, never carried", () => {
  it("a f32x2 channel packs count * 2 elements, component for component", async () => {
    const geo = channelCloud();
    const batches = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: ["uv", "pid"],
    });
    const src = pointColumn(geo, "uv");

    for (const batch of batches) {
      const uv = channelOf(batch, "uv");
      // The consumer's whole recovery rule, asserted AS the rule: nothing
      // on the batch states the item size, so this division IS the ABI.
      // Spelled once — `uv.length === batch.count * 2` is the same claim
      // rearranged and could not fail independently of it.
      expect(uv.length / batch.count, `batch "${batch.assetId}" uv item size`).toBe(2);
      // ...and a scalar channel on the same batch recovers 1, so the
      // division is per channel and not per batch.
      expect(channelOf(batch, "pid").length / batch.count).toBe(1);
    }

    for (const { batch, k, i } of slots(batches)) {
      const uv = channelOf(batch, "uv");
      expect(uv[k * 2], `uv.u slot ${k} <- point ${i}`).toBe(src[i * 2]);
      expect(uv[k * 2 + 1], `uv.v slot ${k} <- point ${i}`).toBe(src[i * 2 + 1]);
    }
    // The two components are not the same number, so a channel that wrote
    // component 0 twice (or transposed the pair) would be caught above.
    expect(src[2]).not.toBe(src[3]);
  });
});

// ---------------------------------------------------------------------------
// 5. `colors` is sugar over the reserved channel
// ---------------------------------------------------------------------------

describe("colors is one buffer with two spellings", () => {
  it("is the same object as the reserved channel, under both readers", async () => {
    const batches = await spawnBatches(channelCloud(), {
      assetId: "fallback",
      assetAttr: "species",
      colorAttr: "tint",
      instanceAttrs: ["pid"],
    });
    expect(INSTANCE_COLOR_CHANNEL).toBe("color");
    for (const batch of batches) {
      const colors = batch.colors;
      if (colors === undefined) throw new Error(`batch "${batch.assetId}" carries no colours`);
      // toBe, not toEqual: two buffers holding equal bytes would be two
      // uploads per cook and two things to keep in step. There is one.
      expect(batch.attributes?.[INSTANCE_COLOR_CHANNEL]).toBe(colors);
      expect(instanceAttributesOf(batch)[INSTANCE_COLOR_CHANNEL]).toBe(colors);
      // The reserved channel sits in the SAME record as the general ones,
      // which is what lets an adapter loop one record and special-case one
      // name rather than serve two mechanisms.
      expect(Object.keys(instanceAttributesOf(batch)).sort()).toEqual(["color", "pid"]);
    }
  });

  it("carries the source RGB with alpha dropped, unchanged by adding channels", async () => {
    const geo = channelCloud();
    const tint = pointColumn(geo, "tint");
    const bare = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      colorAttr: "tint",
    });
    const withChannels = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      colorAttr: "tint",
      instanceAttrs: ["pid", "bigId"],
    });

    for (const { j, batch, k, i } of slots(bare)) {
      const colors = batch.colors;
      if (colors === undefined) throw new Error(`batch "${batch.assetId}" carries no colours`);
      // Three floats, not four: components 0-2 of the f32x4 source.
      expect(colors.length).toBe(batch.count * 3);
      expect(colors[k * 3], `red slot ${k} <- point ${i}`).toBe(tint[i * 4]);
      expect(colors[k * 3 + 1]).toBe(tint[i * 4 + 1]);
      expect(colors[k * 3 + 2]).toBe(tint[i * 4 + 2]);
      // Alpha needs no assertion of its own: the length above is 3 per
      // instance and each of those three is pinned to a named source
      // component, so a carried alpha has nowhere to be.
      //
      // The colour a spawn produces does not depend on what else it was
      // asked to carry: naming channels beside it changes no byte.
      expect(Array.from(colors), `batch ${j} colours moved when channels were added`).toEqual(
        Array.from(withChannels[j].colors ?? []),
      );
    }
  });

  it("lifts a hand-built legacy batch's plain colors into the reserved channel", () => {
    // The shape a host (or a pre-channel consumer) writes by hand: no
    // `attributes` at all, `colors` a plain property. `instanceAttributesOf`
    // is what makes it take the identical adapter path.
    const colors = Float32Array.of(1, 0, 0, 0, 1, 0);
    const legacy: InstanceBatch = {
      assetId: "legacy",
      count: 2,
      transforms: new Float32Array(32),
      colors,
    };
    // No assertion that `legacy.attributes` is undefined: the literal
    // three lines up is the one that would have to say otherwise, so it
    // would be this test checking its own fixture.
    const lifted = instanceAttributesOf(legacy);
    expect(Object.keys(lifted)).toEqual([INSTANCE_COLOR_CHANNEL]);
    // Lifted, not copied: the adapter uploads the array the caller built.
    expect(lifted[INSTANCE_COLOR_CHANNEL]).toBe(colors);
  });
});

// ---------------------------------------------------------------------------
// 6. The worker wire
// ---------------------------------------------------------------------------

describe("channels survive the worker wire", () => {
  it("round-trips mixed dtypes, values and instance order through the codec", async () => {
    const geo = channelCloud();
    const names = ["pid", "bigId", "phase", "uv", "flag"] as const;
    const batches = await spawnBatches(geo, {
      assetId: "fallback",
      assetAttr: "species",
      colorAttr: "tint",
      instanceAttrs: [...names],
    });
    const before = makeInstancesItem(batches, ["veg"]);

    const { encoded, transfer } = encodeOutputs({ instances: [before] });

    // ONE BUFFER PER DISTINCT COLUMN, PLUS ONE FOR THE TRANSFORMS. Colour
    // is the reserved channel rather than a second output, so a batch
    // carrying 5 named channels plus colour posts 7 buffers, not 8.
    //
    // THE COUNT IS THE WHOLE GUARD, and it has to be: the encoder slices
    // every column, so a colour encoded twice would put two DISTINCT
    // buffers on the list and any identity or Set check would pass it.
    // 7 rather than 8 per batch is the only thing that says colour
    // crossed once.
    const perBatch = 1 + names.length + 1;
    expect(transfer.length, "a column crossed the wire more than once").toBe(
      batches.length * perBatch,
    );

    const wire = encoded.instances[0];
    if (wire.kind !== "instances") throw new Error("expected an encoded instances item");
    for (const b of wire.batches) {
      expect(Object.keys(b.attributes ?? {}).sort()).toEqual(
        [...names, INSTANCE_COLOR_CHANNEL].sort(),
      );
      // `colors` has no wire form of its own; encoding one would be the
      // double transfer the count above rules out.
      expect(Object.hasOwn(b, "colors")).toBe(false);
    }

    const after = instancesOf(decodeOutputs(encoded).instances, "decodeOutputs").batches;
    expect(after.map((b) => b.assetId)).toEqual(batches.map((b) => b.assetId));
    expect(after.map((b) => b.count)).toEqual(batches.map((b) => b.count));

    // Instance order, values and dtypes, checked against the SOURCE points
    // on the far side of the wire — not against the pre-encode batches, so
    // a codec that permuted both consistently would still be caught.
    const src: Record<string, AttrData> = {
      pid: pointColumn(geo, "pid"),
      bigId: pointColumn(geo, "bigId"),
      phase: pointColumn(geo, "phase"),
      uv: pointColumn(geo, "uv"),
      flag: pointColumn(geo, "flag"),
    };
    const tint = pointColumn(geo, "tint");
    let checked = 0;
    for (const { batch, k, i } of slots(after)) {
      for (const name of names) {
        const column = channelOf(batch, name);
        const ts = column.length / batch.count;
        expect(column.constructor, `decoded "${name}" dtype`).toBe(src[name].constructor);
        for (let c = 0; c < ts; c++) {
          expect(column[k * ts + c], `decoded "${name}"[${c}] slot ${k} <- point ${i}`).toBe(
            src[name][i * ts + c],
          );
        }
      }
      // The accessor is reinstalled on decode, over the same one buffer.
      const colors = batch.colors;
      if (colors === undefined) throw new Error("decoded batch lost its colours");
      expect(colors).toBe(batch.attributes?.[INSTANCE_COLOR_CHANNEL]);
      expect(colors[k * 3], `decoded red slot ${k} <- point ${i}`).toBe(tint[i * 4]);
      checked++;
    }
    expect(checked).toBe(N);
  });
});

// ---------------------------------------------------------------------------
// 7. Absent is the default
// ---------------------------------------------------------------------------

describe("naming no channel allocates nothing", () => {
  it("leaves attributes and colors absent, not empty", async () => {
    const batches = await spawnBatches(channelCloud(), {
      assetId: "fallback",
      assetAttr: "species",
    });
    expect(batches.length).toBe(2);
    for (const batch of batches) {
      expect(batch.attributes).toBeUndefined();
      expect(batch.colors).toBeUndefined();
      // Absent, not present-and-undefined: a key would make an adapter
      // that iterates the batch see a property it has to skip, and would
      // survive a structured clone as one.
      expect(Object.keys(batch).sort()).toEqual(["assetId", "count", "transforms"]);
      expect(Object.keys(instanceAttributesOf(batch))).toEqual([]);
    }
  });

  it("installs the colors accessor only when a colour was asked for", async () => {
    const batches = await spawnBatches(channelCloud(), {
      assetId: "fallback",
      assetAttr: "species",
      instanceAttrs: ["pid"],
    });
    for (const batch of batches) {
      expect(batch.attributes).toBeDefined();
      expect(Object.hasOwn(batch, "colors")).toBe(false);
      expect(batch.colors).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The refusals the reserved channel and the sugar depend on
// ---------------------------------------------------------------------------

describe("instanceAttrs refuses what cannot cross, naming the way out", () => {
  it("refuses the reserved name, a string, a missing attribute and a repeat", async () => {
    const spawn = (instanceAttrs: readonly string[]): Promise<readonly InstanceBatch[]> =>
      spawnBatches(channelCloud(), { assetId: "fallback", instanceAttrs });
    // The reserved name is what makes `colors` sugar rather than a rival
    // spelling: without this refusal a graph could put a second buffer
    // under the same key.
    await expect(spawn(["color"])).rejects.toThrow(/cannot carry "color"/);
    await expect(spawn(["color"])).rejects.toThrow(/colorAttr/);
    // A string's column is indices into a table that does not travel.
    // Matched on the diagnosis AND on the route out, so a message that
    // merely mentions `assetAttr` in passing would not satisfy it.
    await expect(spawn(["species"])).rejects.toThrow(/"species" is a string attribute/);
    await expect(spawn(["species"])).rejects.toThrow(/assetAttr/);
    await expect(spawn(["nope"])).rejects.toThrow(/instanceAttrs "nope" not found/);
    await expect(spawn(["pid", "pid"])).rejects.toThrow(/names "pid" twice/);
  });
});
