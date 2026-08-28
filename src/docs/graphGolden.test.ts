/**
 * The corpus golden's per-instance channel record.
 *
 * WHY THIS FILE EXISTS. An instances output contributes no per-domain
 * count and no `P` bounds, so the golden's only leverage over one is what
 * `batchStats` chooses to record. Until it recorded channels, a
 * regression that dropped every channel in the corpus — the spawner
 * skipping the write, `instanceAttrs`/`colorAttr` stopping being read, a
 * seam losing the record — regenerated a BYTE-IDENTICAL golden. There was
 * no assertion anywhere that could fail for it, which is the same hole
 * the transform statistics were added to close a version earlier.
 *
 * So the tests here are deliberately about FALSIFIABILITY rather than
 * about values: each one mutates a recorded golden and asserts that the
 * comparison notices. A test that only ever confirms agreement cannot
 * tell a working gate from a gate that returns the empty list.
 */
import { describe, expect, it } from "vitest";
import { makeInstancesItem } from "../index.js";
import { type GraphStats, diffGraphStats, graphStats } from "./graphGolden.js";

/** One instances output holding one batch with the given channels. */
function statsFor(attributes: Record<string, ArrayLike<number>> | undefined): GraphStats {
  const columns: Record<string, Float32Array | Uint32Array> = {};
  for (const [name, values] of Object.entries(attributes ?? {})) {
    columns[name] = name === "id" ? Uint32Array.from(values) : Float32Array.from(values);
  }
  const item = makeInstancesItem([
    {
      assetId: "reed",
      count: 2,
      // Two identity matrices: the transforms are not what is under test,
      // but they have to be well-formed or `batchStats` refuses the batch.
      transforms: Float32Array.from([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1,
      ]),
      ...(attributes === undefined ? {} : { attributes: columns }),
    },
  ]);
  return graphStats({ out: [item] });
}

/** The one batch of the one item of the one output. */
function batchOf(stats: GraphStats): Record<string, unknown> {
  const items = stats.outputs.out;
  const batches = items?.[0]?.batches;
  if (batches === undefined || batches[0] === undefined) throw new Error("no batch recorded");
  return JSON.parse(JSON.stringify(batches[0])) as Record<string, unknown>;
}

/** A golden built from `stats`, with its single batch replaced. */
function goldenWithBatch(stats: GraphStats, batch: unknown): GraphStats {
  const clone = JSON.parse(JSON.stringify(stats)) as {
    outputs: Record<string, { batches?: unknown[] }[]>;
  };
  clone.outputs.out![0]!.batches = [batch];
  return clone as unknown as GraphStats;
}

describe("graphStats — per-instance channels", () => {
  it("records name, dtype and derived item size, and omits the key entirely when there are none", () => {
    const withChannels = batchOf(statsFor({ phase: [0.25, 0.75], id: [17, 99] }));
    expect(withChannels.channels).toEqual([
      { name: "phase", type: "f32", itemSize: 1, values: { min: [0.25], max: [0.75], mean: [0.5] } },
      { name: "id", type: "u32", itemSize: 1, values: { min: [17], max: [99], mean: [58] } },
    ]);

    // Absent rather than empty, so a channel-less corpus records exactly
    // what it always did and the diff of this change stays readable.
    const without = batchOf(statsFor(undefined));
    expect(Object.hasOwn(without, "channels")).toBe(false);
  });

  it("records a hand-built batch's plain colors under the reserved channel name", () => {
    const item = makeInstancesItem([
      {
        assetId: "bush",
        count: 1,
        transforms: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        colors: Float32Array.from([0.5, 0.25, 0.125]),
      },
    ]);
    const batch = batchOf(graphStats({ out: [item] }));
    expect(batch.channels).toEqual([
      {
        name: "color",
        type: "f32",
        itemSize: 3,
        values: { min: [0.5, 0.25, 0.125], max: [0.5, 0.25, 0.125], mean: [0.5, 0.25, 0.125] },
      },
    ]);
  });
});

describe("diffGraphStats — the golden can fail for a channel", () => {
  const actual = statsFor({ phase: [0.25, 0.75], id: [17, 99] });

  /** Sanity: the comparison is silent when nothing moved. */
  it("reports nothing against an unmutated golden", () => {
    expect(diffGraphStats(actual, actual)).toEqual([]);
  });

  it("reports a channel the cook stopped producing", () => {
    // THE FAILURE THIS RECORD EXISTS FOR. The golden holds both channels;
    // a build that dropped them must not compare equal.
    const dropped = statsFor(undefined);
    const diffs = diffGraphStats(dropped, actual);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("channels missing phase:f32, id:u32");
    expect(diffs[0]).toContain("instanceAttrs");
  });

  it("reports a renamed channel from both sides", () => {
    const golden = goldenWithBatch(actual, {
      ...batchOf(actual),
      channels: [
        { name: "wobble", type: "f32", itemSize: 1, values: { min: [0.25], max: [0.75], mean: [0.5] } },
        { name: "id", type: "u32", itemSize: 1, values: { min: [17], max: [99], mean: [58] } },
      ],
    });
    const diffs = diffGraphStats(actual, golden);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("missing wobble:f32");
    expect(diffs[0]).toContain("unexpected phase:f32");
  });

  it("reports a dtype widened to f32, which is the whole point of preserving it", () => {
    const golden = goldenWithBatch(actual, {
      ...batchOf(actual),
      channels: [
        { name: "phase", type: "f32", itemSize: 1, values: { min: [0.25], max: [0.75], mean: [0.5] } },
        { name: "id", type: "f32", itemSize: 1, values: { min: [17], max: [99], mean: [58] } },
      ],
    });
    const diffs = diffGraphStats(actual, golden);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("missing id:f32");
    expect(diffs[0]).toContain("unexpected id:u32");
  });

  it("reports a channel whose values moved past the tolerance, naming the component", () => {
    const shifted = statsFor({ phase: [0.25, 0.75], id: [17, 999] });
    const diffs = diffGraphStats(shifted, actual);
    // `max` and `mean` both move; `min` does not.
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.join("\n")).toContain('channel "id" value max');
    expect(diffs.join("\n")).toContain('channel "id" value mean');
    expect(diffs.join("\n")).not.toContain('channel "id" value min');
  });

  it("does not compare the values of a channel whose shape already differs", () => {
    // One line about the shape is actionable; the same failure restated as
    // three per-component numbers is not, and would bury it.
    const golden = goldenWithBatch(actual, {
      ...batchOf(actual),
      channels: [
        { name: "phase", type: "f32", itemSize: 2, values: { min: [9, 9], max: [9, 9], mean: [9, 9] } },
        { name: "id", type: "u32", itemSize: 1, values: { min: [17], max: [99], mean: [58] } },
      ],
    });
    const diffs = diffGraphStats(actual, golden);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("channels");
  });
});
