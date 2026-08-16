import { describe, expect, it } from "vitest";
import type { Geometry } from "../data/index.js";
import { Graph, cook } from "../graph/index.js";
import {
  deserializeGraph,
  pointGrid,
  pointLine,
  pointScatterInBounds,
  pointScatterInWorld,
  type PointScatterInWorldParams,
} from "./index.js";
import { firstGeo, positionsOf, runNode, snapshotGeometry } from "./nodes.testsupport.js";

describe("pointGrid", () => {
  it("lays out origin + spacing with X fastest", async () => {
    const out = await runNode(pointGrid, {
      countX: 2,
      countY: 2,
      countZ: 1,
      spacing: [1, 2, 3],
      origin: [10, 20, 30],
    });
    const geo = firstGeo(out.out);
    expect(positionsOf(geo)).toEqual([
      [10, 20, 30],
      [11, 20, 30],
      [10, 22, 30],
      [11, 22, 30],
    ]);
    // Standard attrs present, per-point seeds distinct.
    const seeds = geo.attrs.point.require("seed");
    expect(new Set([seeds.get(0), seeds.get(1), seeds.get(2), seeds.get(3)]).size).toBe(4);
    expect(geo.attrs.point.require("density").get(0)).toBe(1);
  });
});

/** The stored bytes of P, read out of the exact geometry snapshot. */
function snapshotP(geo: Geometry): number[] {
  const point = snapshotGeometry(geo).point as {
    attrs: { name: string; data: number[] }[];
  };
  const P = point.attrs.find((a) => a.name === "P");
  if (!P) throw new Error("snapshot has no P attribute");
  return P.data;
}

/**
 * The pre-`mode` pointLine executor, transcribed, and rounded through f32
 * exactly as the attribute store rounds it. The byte-identity claim needs
 * a reference the node cannot move with it: comparing two runs of the
 * same code proves only that the code agrees with itself.
 */
function legacyLineP(
  count: number,
  start: readonly number[],
  end: readonly number[],
  includeEnd: boolean,
): number[] {
  const P = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = includeEnd ? (count === 1 ? 0 : i / (count - 1)) : i / count;
    for (let k = 0; k < 3; k++) P[i * 3 + k] = start[k] + (end[k] - start[k]) * t;
  }
  return Array.from(P);
}

describe("pointLine", () => {
  it("places count points from start to end inclusive", async () => {
    const geo = firstGeo(
      (await runNode(pointLine, { count: 3, start: [0, 0, 0], end: [4, 2, 0] })).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [2, 1, 0],
      [4, 2, 0],
    ]);
  });

  it("count 1 places a single point at start", async () => {
    const geo = firstGeo(
      (await runNode(pointLine, { count: 1, start: [5, 5, 5], end: [9, 9, 9] })).out,
    );
    expect(positionsOf(geo)).toEqual([[5, 5, 5]]);
  });

  it("defaults to includeEnd, matching an explicit true", async () => {
    // The default is the shipped behavior: adding the param must not move
    // a single position, so the two runs are compared to each other AND to
    // the endpoint-inclusive layout.
    const implicit = firstGeo(
      (await runNode(pointLine, { count: 5, start: [0, 0, 0], end: [4, 0, 0] })).out,
    );
    const explicit = firstGeo(
      (
        await runNode(pointLine, {
          count: 5,
          start: [0, 0, 0],
          end: [4, 0, 0],
          includeEnd: true,
        })
      ).out,
    );
    expect(pointLine.defaultParams.includeEnd).toBe(true);
    expect(snapshotGeometry(implicit)).toEqual(snapshotGeometry(explicit));
    expect(positionsOf(implicit)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ]);
  });

  it("includeEnd false stops one step short of end", async () => {
    // Four samples over [0, 4) step by 4/4 = 1 and never reach 4, so the
    // count is the number of DISTINCT positions a wrapping sweep gets.
    const geo = firstGeo(
      (
        await runNode(pointLine, {
          count: 4,
          start: [0, 0, 0],
          end: [4, 0, 0],
          includeEnd: false,
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
  });

  it("exclusive count n covers the same positions as inclusive count n + 1, minus the seam", async () => {
    // The relationship the ring rewiring depends on: dropping the seam
    // point is exactly what the exclusive mode does, so a primitive no
    // longer needs an extra filter node to do it.
    const closed = firstGeo(
      (
        await runNode(pointLine, {
          count: 7,
          start: [0, 0, 0],
          end: [1, 0, 0],
          includeEnd: false,
        })
      ).out,
    );
    const openWithSeam = firstGeo(
      (await runNode(pointLine, { count: 8, start: [0, 0, 0], end: [1, 0, 0] })).out,
    );
    expect(closed.pointCount).toBe(7);
    expect(positionsOf(closed)).toEqual(positionsOf(openWithSeam).slice(0, 7));
  });

  it("count 1 places a single point at start under both modes", async () => {
    // Degenerate: one sample has no step to take, so there is nothing for
    // the excluded endpoint to be short of. Both modes emit start.
    for (const includeEnd of [true, false]) {
      const geo = firstGeo(
        (
          await runNode(pointLine, { count: 1, start: [5, 5, 5], end: [9, 9, 9], includeEnd })
        ).out,
      );
      expect(positionsOf(geo), `includeEnd ${includeEnd}`).toEqual([[5, 5, 5]]);
    }
  });

  it("count 0 emits an empty point cloud under both modes", async () => {
    // Below the schema minimum of 1, so unreachable through a validated
    // graph — pinned anyway because the executor must stay total rather
    // than divide by zero or emit a stray point.
    for (const includeEnd of [true, false]) {
      const geo = firstGeo(
        (
          await runNode(pointLine, { count: 0, start: [0, 0, 0], end: [1, 0, 0], includeEnd })
        ).out,
      );
      expect(geo.pointCount, `includeEnd ${includeEnd}`).toBe(0);
      expect(positionsOf(geo), `includeEnd ${includeEnd}`).toEqual([]);
    }
  });

  it("defaults to 'endpoints' and reproduces the pre-mode node byte for byte", async () => {
    // THE compatibility claim, measured rather than assumed: every
    // existing graph in the corpus omits `mode`, so the default path must
    // still emit the bytes it emitted before the param existed. Compared
    // against a transcription of the old executor, not against a second
    // run of the new one — the second only proves self-consistency.
    expect(pointLine.defaultParams.mode).toBe("endpoints");
    const lines: [readonly number[], readonly number[]][] = [
      // The rig's carrier line, where 15 is count - 1 restated by hand.
      [
        [0, 0, 0],
        [15, 0, 0],
      ],
      // And a line on which nothing divides evenly, so a drifted step
      // shows up in the low bits rather than cancelling.
      [
        [-1.5, 0.25, 3],
        [7.5, -2, 11.25],
      ],
      // Every component of this one crosses zero at a sample, which is
      // where two ALGEBRAICALLY IDENTICAL spellings of the interpolation
      // (a + (b - a) * t versus a * (1 - t) + b * t) stop agreeing in the
      // last bit. Chosen deliberately: without a line like it this
      // control passes on a rewrite that does move bytes.
      [
        [3, -1.5, 0.25],
        [-2, 0.25, -1.5],
      ],
    ];
    for (const [start, end] of lines) {
      for (const count of [1, 2, 5, 7, 16, 17]) {
        for (const includeEnd of [true, false]) {
          const geo = firstGeo(
            (await runNode(pointLine, { count, start, end, includeEnd })).out,
          );
          expect(
            snapshotP(geo),
            `${JSON.stringify(start)} -> ${JSON.stringify(end)} count ${count} includeEnd ${includeEnd}`,
          ).toEqual(legacyLineP(count, start, end, includeEnd));
        }
      }
    }
  });

  it("carries the new params inertly: spacing moves nothing in the default mode", async () => {
    // The other half of compatibility — not just that the default agrees
    // with the old node, but that a stray `spacing` cannot reach it.
    const base = { count: 16, start: [0, 0, 0], end: [15, 0, 0] };
    const implicit = firstGeo((await runNode(pointLine, base)).out);
    const explicit = firstGeo(
      (await runNode(pointLine, { ...base, mode: "endpoints", spacing: 7.25 })).out,
    );
    expect(snapshotGeometry(implicit)).toEqual(snapshotGeometry(explicit));
  });

  it("'spacing' mode steps exactly `spacing` units along the direction start -> end", async () => {
    // end is 4 units out and the run is 5 points half a unit apart, so
    // the last point lands at 2 — the endpoint is DERIVED and `end` only
    // said which way to go.
    const geo = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 5,
          start: [0, 0, 0],
          end: [0, 0, 4],
          spacing: 0.5,
        })
      ).out,
    );
    expect(positionsOf(geo)).toEqual([
      [0, 0, 0],
      [0, 0, 0.5],
      [0, 0, 1],
      [0, 0, 1.5],
      [0, 0, 2],
    ]);
    // Off-axis, on a 3-4-5 direction so the unit step is exact in binary
    // and the step can be asserted as positions rather than a tolerance.
    const diagonal = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 3,
          start: [1, 1, 1],
          end: [4, 5, 1],
          spacing: 5,
        })
      ).out,
    );
    expect(positionsOf(diagonal)).toEqual([
      [1, 1, 1],
      [4, 5, 1],
      [7, 9, 1],
    ]);
  });

  it("reads end's DIRECTION and not its distance in 'spacing' mode", async () => {
    // Pins the documented meaning of the param that changes between
    // modes: two graphs whose ends sit 1 and 999 units out are the same
    // graph here, so nobody can read the emitted line off `end`.
    const near = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 4,
          start: [1, 0, 0],
          end: [2, 0, 0],
          spacing: 3,
        })
      ).out,
    );
    const far = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 4,
          start: [1, 0, 0],
          end: [1000, 0, 0],
          spacing: 3,
        })
      ).out,
    );
    expect(snapshotGeometry(near)).toEqual(snapshotGeometry(far));
    expect(positionsOf(near)).toEqual([
      [1, 0, 0],
      [4, 0, 0],
      [7, 0, 0],
      [10, 0, 0],
    ]);
  });

  it("appends when the count rises in 'spacing' mode, where 'endpoints' re-spaces the whole line", async () => {
    // The property the rig needs, and the measurement gap 3 is written
    // from: the carrier line's count is a panel knob ("wraps"), and the
    // forEach item key downstream is derived from the point's position,
    // so a point that moves re-keys and re-seeds everything hanging off
    // it. 16 -> 17 wraps, both modes, same line.
    const carrier = { start: [0, 0, 0], end: [15, 0, 0] };
    const spaced = { ...carrier, mode: "spacing", spacing: 1 };
    const stepped16 = positionsOf(firstGeo((await runNode(pointLine, { ...spaced, count: 16 })).out));
    const stepped17 = positionsOf(firstGeo((await runNode(pointLine, { ...spaced, count: 17 })).out));
    expect(stepped17).toHaveLength(17);
    // Every existing point, at its existing index, and one genuinely new.
    expect(stepped17.slice(0, 16)).toEqual(stepped16);
    expect(stepped17[16]).toEqual([16, 0, 0]);

    // The opposite, asserted here so the difference is visible in one
    // place rather than claimed about somewhere else. With both ends
    // pinned, exactly one INDEX still holds its position (0, on start),
    // and exactly two positions survive anywhere in the new line (start
    // and end — the only two the mode pins).
    const pinned16 = positionsOf(firstGeo((await runNode(pointLine, { ...carrier, count: 16 })).out));
    const pinned17 = positionsOf(firstGeo((await runNode(pointLine, { ...carrier, count: 17 })).out));
    const key = (p: readonly number[]): string => p.join(",");
    expect(pinned16.filter((p, i) => key(p) === key(pinned17[i]))).toEqual([[0, 0, 0]]);
    const stillThere = new Set(pinned17.map(key));
    expect(pinned16.filter((p) => stillThere.has(key(p)))).toEqual([
      [0, 0, 0],
      [15, 0, 0],
    ]);
    // Same comparison run against the stepped line, so the two claims are
    // made by the same measurement: all sixteen survive, not two.
    const steppedStillThere = new Set(stepped17.map(key));
    expect(stepped16.filter((p) => steppedStillThere.has(key(p)))).toHaveLength(16);
  });

  it("stays total in 'spacing' mode at counts that take no step", async () => {
    const one = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 1,
          start: [5, 5, 5],
          end: [9, 9, 9],
          spacing: 2,
        })
      ).out,
    );
    expect(positionsOf(one)).toEqual([[5, 5, 5]]);
    const none = firstGeo(
      (
        await runNode(pointLine, {
          mode: "spacing",
          count: 0,
          start: [5, 5, 5],
          end: [9, 9, 9],
          spacing: 2,
        })
      ).out,
    );
    expect(none.pointCount).toBe(0);
    // The guards fire at those counts all the same: `count` is a knob, so
    // a spacing that is wrong at ten points is wrong at one, and finding
    // out later is finding out from the wrong node.
    await expect(
      runNode(pointLine, {
        mode: "spacing",
        count: 1,
        start: [5, 5, 5],
        end: [9, 9, 9],
        spacing: 0,
      }),
    ).rejects.toThrow(/spacing must be a finite number > 0/);
  });

  it("refuses the settings that name no line, stating the fix", async () => {
    const line = { count: 5, start: [0, 0, 0], end: [4, 0, 0] };
    await expect(runNode(pointLine, { ...line, mode: "step" })).rejects.toThrow(
      /unknown mode "step"; valid modes: endpoints, spacing/,
    );
    for (const spacing of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      await expect(
        runNode(pointLine, { ...line, mode: "spacing", spacing }),
        `spacing ${spacing}`,
      ).rejects.toThrow(/pointLine: spacing must be a finite number > 0 in 'spacing' mode, got/);
    }
    await expect(
      runNode(pointLine, { ...line, mode: "spacing", spacing: 0 }),
    ).rejects.toThrow(/switch mode to 'endpoints'/);
    // No direction to step along: the degenerate this mode adds.
    await expect(
      runNode(pointLine, { mode: "spacing", count: 5, start: [2, 3, 4], end: [2, 3, 4], spacing: 1 }),
    ).rejects.toThrow(/start \[2, 3, 4\] and end \[2, 3, 4\] are the same position/);
    await expect(
      runNode(pointLine, { mode: "spacing", count: 5, start: [2, 3, 4], end: [2, 3, 4], spacing: 1 }),
    ).rejects.toThrow(/move end off start/);
    // And the setting that would sit in the graph file moving nothing.
    // A vacuous bool is invisible to a fingerprint and to a reader, which
    // is the class of hazard this mode exists to remove — so it is an
    // error rather than a no-op, and the default (true) still passes.
    await expect(
      runNode(pointLine, { ...line, mode: "spacing", spacing: 1, includeEnd: false }),
    ).rejects.toThrow(/includeEnd false is not available in 'spacing' mode/);
    await expect(
      runNode(pointLine, { ...line, mode: "spacing", spacing: 1, includeEnd: false }),
    ).rejects.toThrow(/switch mode to 'endpoints' to sample the half-open range/);
    await expect(
      runNode(pointLine, { ...line, mode: "spacing", spacing: 1, includeEnd: true }),
    ).resolves.toBeTruthy();
  });

  it("cooks from serialized JSON, the way an agent reaches the mode", async () => {
    // The enum has to survive graph validation, not just a direct call.
    const graph = deserializeGraph({
      formatVersion: 1,
      seed: 3,
      nodes: [
        {
          id: "carriers",
          type: "pointLine",
          params: { mode: "spacing", count: 17, start: [0, 0, 0], end: [1, 0, 0], spacing: 1 },
        },
      ],
      connections: [],
      outputs: [{ id: "carriers", pin: "out", name: "pts" }],
    });
    const result = await cook(graph);
    expect(positionsOf(firstGeo(result.outputs.pts))).toEqual(
      Array.from({ length: 17 }, (_, i) => [i, 0, 0]),
    );
  });
});

describe("pointScatterInBounds", () => {
  it("keeps every point inside the box", async () => {
    const geo = firstGeo(
      (
        await runNode(pointScatterInBounds, {
          count: 200,
          boundsMin: [-2, 0, 5],
          boundsMax: [-1, 3, 6],
        })
      ).out,
    );
    expect(geo.pointCount).toBe(200);
    for (const [x, y, z] of positionsOf(geo)) {
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(-1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(3 + 1e-6);
      expect(z).toBeGreaterThanOrEqual(5);
      expect(z).toBeLessThan(6 + 1e-6);
    }
  });

  it("is deterministic per seed and differs across seeds", async () => {
    const a = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 9)).out);
    const b = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 9)).out);
    const c = firstGeo((await runNode(pointScatterInBounds, { count: 50 }, {}, 10)).out);
    const d = firstGeo(
      (await runNode(pointScatterInBounds, { count: 50, seed: 1 }, {}, 9)).out,
    );
    expect(snapshotGeometry(a)).toEqual(snapshotGeometry(b));
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(c));
    expect(snapshotGeometry(a)).not.toEqual(snapshotGeometry(d));
  });

  it("moves every point when the box moves — the flaw pointScatterInWorld exists to fix", async () => {
    // The negative control for the world-anchored suite below: widening
    // the box to form a halo re-lays the whole scatter, so no point of the
    // narrow query survives in the wide one. Nothing here is wrong; it is
    // what "positions are a function of the bounds" means, and it is why a
    // second source node was needed rather than a fix to this one.
    const narrow = positionsOf(
      firstGeo(
        (await runNode(pointScatterInBounds, { count: 40, boundsMax: [10, 0, 10] }, {}, 4)).out,
      ),
    );
    const wide = positionsOf(
      firstGeo(
        (await runNode(pointScatterInBounds, { count: 40, boundsMax: [20, 0, 20] }, {}, 4)).out,
      ),
    );
    const wideKeys = new Set(wide.map((p) => p.join(",")));
    expect(narrow.filter((p) => wideKeys.has(p.join(",")))).toEqual([]);
  });
});

/** One emitted point, flattened for order- and byte-exact comparison. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
}

/** Run pointScatterInWorld and read back its points in emission order. */
async function scatterWorld(
  params: Partial<PointScatterInWorldParams>,
  nodeSeed = 7,
): Promise<WorldPoint[]> {
  const geo = firstGeo((await runNode(pointScatterInWorld, params, {}, nodeSeed)).out);
  const P = geo.attrs.point.require("P");
  const s = geo.attrs.point.require("seed");
  const out: WorldPoint[] = [];
  for (let i = 0; i < geo.pointCount; i++) {
    out.push({ x: P.get(i, 0), y: P.get(i, 1), z: P.get(i, 2), seed: s.get(i) });
  }
  return out;
}

const keyOf = (p: WorldPoint): string => `${p.x},${p.y},${p.z},${p.seed}`;
const sortedKeys = (pts: readonly WorldPoint[]): string[] => pts.map(keyOf).sort();

/** Shared world parameters; cellSize 4 so the windows below cut cells. */
const WORLD = {
  density: 0.05,
  cellSize: 4,
  latticeMode: "xz",
  height: 2,
  seed: 11,
} as const;

describe("pointScatterInWorld", () => {
  it("returns byte-identical points for a region under any query window", async () => {
    // THE property. Three windows over the same lattice: one aligned to
    // the lattice, one offset and unaligned on every face, one 400x
    // larger. Restricted to a region all three cover, the emitted point
    // sequences must agree exactly — same positions, same per-point seeds,
    // same order. Anything less and a halo reproduces nothing.
    const aligned = await scatterWorld({
      ...WORLD,
      boundsMin: [0, 0, 0],
      boundsMax: [40, 0, 40],
    });
    const unaligned = await scatterWorld({
      ...WORLD,
      boundsMin: [-3.5, 0, 7.25],
      boundsMax: [61.75, 0, 52.5],
    });
    const huge = await scatterWorld({
      ...WORLD,
      boundsMin: [-400, 0, -400],
      boundsMax: [400, 0, 400],
    });
    // A region strictly inside all three and off every lattice boundary,
    // applied to the STORED positions, so the three filters see the same
    // numbers if and only if the node produced the same numbers.
    const inRegion = (p: WorldPoint): boolean =>
      p.x >= 8.3 && p.x < 33.7 && p.z >= 9.1 && p.z < 34.9;
    const fromAligned = aligned.filter(inRegion);
    expect(fromAligned.length).toBeGreaterThan(20);
    expect(unaligned.filter(inRegion)).toEqual(fromAligned);
    expect(huge.filter(inRegion)).toEqual(fromAligned);
  });

  it("makes a halo a strictly wider query: the tile's points are unmoved inside it", async () => {
    const tile = await scatterWorld({ ...WORLD, boundsMin: [0, 0, 0], boundsMax: [20, 0, 20] });
    const haloed = await scatterWorld({
      ...WORLD,
      boundsMin: [-6, 0, -6],
      boundsMax: [26, 0, 26],
    });
    const inTile = (p: WorldPoint): boolean => p.x >= 0 && p.x < 20 && p.z >= 0 && p.z < 20;
    expect(haloed.filter(inTile)).toEqual(tile);
    // The halo is real content, not padding: the ring holds points the
    // tile query never saw, derived from world coordinates alone.
    expect(haloed.length).toBeGreaterThan(tile.length);
  });

  it("splits into tiles that partition the whole, with an unaligned seam", async () => {
    // Split-equals-whole, and the seam deliberately falls between lattice
    // boundaries so the agreement cannot be an artifact of cell alignment.
    const whole = await scatterWorld({ ...WORLD, boundsMin: [0, 0, 0], boundsMax: [40, 0, 40] });
    const tiles: WorldPoint[] = [];
    const cuts: readonly [number, number][] = [
      [0, 13.7],
      [13.7, 40],
    ];
    for (const [x0, x1] of cuts) {
      for (const [z0, z1] of cuts) {
        tiles.push(
          ...(await scatterWorld({ ...WORLD, boundsMin: [x0, 0, z0], boundsMax: [x1, 0, z1] })),
        );
      }
    }
    // Exactly once each: half-open clipping means no seam duplicate and no
    // seam gap, so the counts match before the contents are compared.
    expect(tiles.length).toBe(whole.length);
    expect(sortedKeys(tiles)).toEqual(sortedKeys(whole));
  });

  it("two windows meeting on a face agree on who owns a point", async () => {
    // The seam contract at its smallest: one boundary, checked in both
    // directions. A point on the face belongs to the window whose MIN it
    // is — filterByBounds' inclusive-on-both-sides test would emit it
    // twice here.
    const left = await scatterWorld({ ...WORLD, boundsMin: [0, 0, 0], boundsMax: [16, 0, 24] });
    const right = await scatterWorld({ ...WORLD, boundsMin: [16, 0, 0], boundsMax: [32, 0, 24] });
    const both = await scatterWorld({ ...WORLD, boundsMin: [0, 0, 0], boundsMax: [32, 0, 24] });
    const shared = new Set(left.map(keyOf));
    expect(right.filter((p) => shared.has(keyOf(p)))).toEqual([]);
    expect(sortedKeys([...left, ...right])).toEqual(sortedKeys(both));
  });

  it("emits a point lying EXACTLY on a seam once, to the window whose min it is", async () => {
    // The case that decides whether a clip can be used as an ownership
    // rule, and the one a randomly placed seam never reaches. cellSize 1
    // with a single-cell window puts every coordinate in [0, 1) — where a
    // 24-bit hashed fraction is exactly representable in f32 — so the seam
    // taken from an emitted point IS a point's coordinate, not a value
    // near one. An inclusive-on-both-sides test emits it twice here.
    const oneCell = {
      ...WORLD,
      cellSize: 1,
      density: 8,
      boundsMin: [0, 0, 0],
      boundsMax: [1, 0, 1],
    };
    const cell = await scatterWorld(oneCell);
    expect(cell.length).toBe(8);
    const seam = cell[3].x;
    const left = await scatterWorld({ ...oneCell, boundsMax: [seam, 0, 1] });
    const right = await scatterWorld({ ...oneCell, boundsMin: [seam, 0, 0] });
    expect(left.some((p) => p.x === seam)).toBe(false);
    expect(right.some((p) => p.x === seam)).toBe(true);
    expect(left.length + right.length).toBe(cell.length);
    expect(sortedKeys([...left, ...right])).toEqual(sortedKeys(cell));
  });

  it("populates a window at exactly density * area", async () => {
    // lambda = density * cellSize^2 = 0.5 * 4 = 2 exactly (both factors are
    // exact binary fractions), so every cell holds exactly two points and
    // the population is not merely an expectation.
    const pts = await scatterWorld({
      ...WORLD,
      density: 0.5,
      cellSize: 2,
      boundsMin: [0, 0, 0],
      boundsMax: [20, 0, 20],
    });
    expect(pts.length).toBe(0.5 * 20 * 20);
    // And with a fractional lambda the count still tracks density * area:
    // 0.02 * 200 * 200 = 800 expected.
    const fractional = await scatterWorld({
      ...WORLD,
      density: 0.02,
      cellSize: 3,
      boundsMin: [0, 0, 0],
      boundsMax: [200, 0, 200],
    });
    expect(Math.abs(fractional.length - 800)).toBeLessThan(80);
  });

  it("adds points when density rises without moving the ones already there", async () => {
    const base = { ...WORLD, cellSize: 2, boundsMin: [0, 0, 0], boundsMax: [20, 0, 20] };
    const sparse = await scatterWorld({ ...base, density: 0.5 });
    const dense = await scatterWorld({ ...base, density: 0.75 });
    expect(sparse.length).toBe(200);
    expect(dense.length).toBe(300);
    const present = new Set(dense.map(keyOf));
    expect(sparse.every((p) => present.has(keyOf(p)))).toBe(true);
  });

  it("xz mode ignores the query's Y and plants every point at height", async () => {
    const pts = await scatterWorld({
      ...WORLD,
      height: 2.5,
      boundsMin: [0, -Infinity, 0],
      boundsMax: [20, Infinity, 20],
    });
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => p.y === 2.5)).toBe(true);
    // A finite Y that excludes `height` changes nothing: Y is not read.
    const boxed = await scatterWorld({
      ...WORLD,
      height: 2.5,
      boundsMin: [0, 100, 0],
      boundsMax: [20, 101, 20],
    });
    expect(boxed).toEqual(pts);
  });

  it("xyz mode clips Y from the lattice and is an independent point set", async () => {
    const params = {
      ...WORLD,
      latticeMode: "xyz",
      density: 0.01,
      cellSize: 4,
      boundsMin: [0, 0, 0],
      boundsMax: [20, 12, 20],
    };
    const pts = await scatterWorld(params);
    expect(pts.every((p) => p.y >= 0 && p.y < 12)).toBe(true);
    // Volume 20*12*20 = 4800, density 0.01 -> 48 expected.
    expect(Math.abs(pts.length - 48)).toBeLessThan(20);
    // Same window, same seed, other mode: unrelated content, not a slice.
    const flat = await scatterWorld({ ...params, latticeMode: "xz" });
    const flatKeys = new Set(flat.map((p) => `${p.x},${p.z}`));
    expect(pts.filter((p) => flatKeys.has(`${p.x},${p.z}`))).toEqual([]);
    // The same anchoring property holds in 3D.
    const wider = await scatterWorld({ ...params, boundsMin: [-8, -8, -8], boundsMax: [28, 20, 28] });
    const inBox = (p: WorldPoint): boolean =>
      p.x >= 0 && p.x < 20 && p.y >= 0 && p.y < 12 && p.z >= 0 && p.z < 20;
    expect(wider.filter(inBox)).toEqual(pts);
  });

  it("re-rolls on its OWN seed param, and on nothing else — not the node seed", async () => {
    // The one node in the library whose randomness does not descend from
    // the graph seed, and the reason is the anchoring guarantee: a node
    // seed is hashCombine(graphSeed, nodeId), so anything that moves the
    // graph seed — an author reseeding a level graph per cell, a CLI
    // --seed override, a rename — would silently re-roll the lattice and
    // leave every window still self-consistent, still deterministic, and
    // no longer agreeing with its neighbours. It cannot, because the node
    // seed is not an input.
    const win = { ...WORLD, boundsMin: [0, 0, 0], boundsMax: [24, 0, 24] };
    const a = await scatterWorld(win, 5);
    const again = await scatterWorld(win, 5);
    const otherNodeSeed = await scatterWorld(win, 6);
    const farNodeSeed = await scatterWorld(win, 0xdeadbeef);
    const otherParamSeed = await scatterWorld({ ...win, seed: 12 }, 5);
    expect(a.length).toBeGreaterThan(10);
    expect(again).toEqual(a);
    expect(otherNodeSeed).toEqual(a);
    expect(farNodeSeed).toEqual(a);
    expect(otherParamSeed).not.toEqual(a);
  });

  it("gives two nodes in ONE graph the same world when their params match", async () => {
    // The surprising half, pinned so it reads as a decision and not a
    // bug: this node is a FIELD in source clothing. Two perlinNoise
    // fields with one spec are one field, and two anchored scatters with
    // one spec are one scatter — which is exactly what lets two graphs,
    // two levels or two cells agree on a world. Two real nodes in one
    // graph, so the node id (which used to separate them through the seed
    // chain) is genuinely different here.
    const graph = new Graph(77);
    const win = {
      density: WORLD.density,
      cellSize: WORLD.cellSize,
      latticeMode: WORLD.latticeMode,
      height: WORLD.height,
      boundsMin: [0, 0, 0],
      boundsMax: [24, 0, 24],
      seed: WORLD.seed,
    };
    graph.output(graph.add(pointScatterInWorld, win, "trees"), "out", "trees");
    graph.output(graph.add(pointScatterInWorld, win, "rocks"), "out", "rocks");
    // A third layer that says so, which is how two layers are separated
    // now that the id cannot do it.
    graph.output(
      graph.add(pointScatterInWorld, { ...win, seed: WORLD.seed + 1 }, "grass"),
      "out",
      "grass",
    );
    const result = await cook(graph);
    const readBack = (name: string): unknown =>
      snapshotGeometry(firstGeo(result.outputs[name]));
    expect(firstGeo(result.outputs.trees).pointCount).toBeGreaterThan(10);
    expect(readBack("rocks")).toEqual(readBack("trees"));
    expect(readBack("grass")).not.toEqual(readBack("trees"));
  });

  it("names the offending param and the fix on invalid input", async () => {
    await expect(scatterWorld({ ...WORLD, cellSize: 0 })).rejects.toThrow(
      /cellSize must be a positive finite number, got 0/,
    );
    await expect(scatterWorld({ ...WORLD, cellSize: 0 })).rejects.toThrow(
      /never from a World level's cellSize/,
    );
    await expect(scatterWorld({ ...WORLD, density: -1 })).rejects.toThrow(
      /density must be a finite number >= 0, got -1/,
    );
    await expect(scatterWorld({ ...WORLD, latticeMode: "yz" })).rejects.toThrow(
      /latticeMode must be "xz" or "xyz", got "yz"/,
    );
    await expect(
      scatterWorld({ ...WORLD, boundsMin: [-Infinity, 0, 0], boundsMax: [10, 0, 10] }),
    ).rejects.toThrow(/boundsMin\/boundsMax x must be finite in "xz" mode/);
    // xyz reads Y, so the Y that "xz" ignores is an error there.
    await expect(
      scatterWorld({
        ...WORLD,
        latticeMode: "xyz",
        boundsMin: [0, -Infinity, 0],
        boundsMax: [10, Infinity, 10],
      }),
    ).rejects.toThrow(/boundsMin\/boundsMax y must be finite in "xyz" mode/);
    // Guards, which bound the work rather than the model: both name the
    // measured number, the limit, and which param to move.
    await expect(
      scatterWorld({ ...WORLD, cellSize: 0.001, boundsMin: [0, 0, 0], boundsMax: [1e5, 0, 1e5] }),
    ).rejects.toThrow(/lattice cells .*over the 4194304 limit; raise cellSize/);
    await expect(
      scatterWorld({ ...WORLD, density: 1e6, boundsMin: [0, 0, 0], boundsMax: [100, 0, 100] }),
    ).rejects.toThrow(/points before clipping, over the 4194304 limit; lower density/);
  });

  it("cooks from serialized JSON with no runtime input", async () => {
    // The node has to be reachable the way an agent reaches it: a graph
    // file with params only, no dataInput and no host-side wiring.
    const graph = deserializeGraph({
      formatVersion: 1,
      seed: 3,
      nodes: [
        {
          id: "world",
          type: "pointScatterInWorld",
          params: {
            density: 0.5,
            cellSize: 2,
            latticeMode: "xz",
            height: 1,
            boundsMin: [0, 0, 0],
            boundsMax: [10, 0, 10],
            seed: 4,
          },
        },
      ],
      connections: [],
      outputs: [{ id: "world", pin: "out", name: "pts" }],
    });
    const result = await cook(graph);
    const geo = firstGeo(result.outputs.pts);
    expect(geo.pointCount).toBe(0.5 * 10 * 10);
    expect(geo.attrs.point.require("P").get(0, 1)).toBe(1);
  });
});
