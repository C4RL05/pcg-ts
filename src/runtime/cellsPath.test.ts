/**
 * `cellMode: "path"` cells: arc-length sectors along a curve, addressed
 * by one sector index, positioned by `UpdateOptions.anchors` rather than
 * by the viewpoint.
 *
 * Everything here runs on TWO NUMBERS — a table length and a closed flag
 * — because that is the whole of what the World needs to cut sectors. No
 * curve appears in this suite, deliberately: if a test needed one, the
 * runtime would have become content-aware.
 */
import { describe, expect, it } from "vitest";
import { Graph } from "../graph/index.js";
import { pointScatterInBounds } from "../nodes/sources.js";
import { hashCombine } from "../random/index.js";
import { childEchoLevel, coordKeys, outputsDiff, scatterLevel } from "./runtime.testsupport.js";
import type { CellContext, LevelDef } from "./types.js";
import { World, WorldValidationError } from "./world.js";

/**
 * A 100-unit table cut into ten 10-unit sectors (0..9). The window is
 * stated either symmetrically (`generationRadius`) or directionally
 * (`aheadArc` + `behindArc`) — never both, which is what the World
 * refuses — so this helper takes them as alternatives too.
 */
function trackLevel(opts: {
  name?: string;
  closed: boolean;
  cellSize?: number;
  length?: number;
  generationRadius?: number;
  retainRadius?: number;
  aheadArc?: number;
  behindArc?: number;
  retainAheadArc?: number;
  retainBehindArc?: number;
  jitter?: boolean;
}): LevelDef {
  return scatterLevel({
    name: opts.name ?? "track",
    cellSize: opts.cellSize ?? 10,
    cellMode: "path",
    path: { length: opts.length ?? 100, closed: opts.closed },
    generationRadius: opts.generationRadius,
    retainRadius: opts.retainRadius,
    aheadArc: opts.aheadArc,
    behindArc: opts.behindArc,
    retainAheadArc: opts.retainAheadArc,
    retainBehindArc: opts.retainBehindArc,
    jitter: opts.jitter,
  }).def;
}

/** A level that only records the contexts it is handed. */
function recordingLevel(opts: {
  name: string;
  cellSize: number;
  length: number;
  closed: boolean;
  generationRadius: number;
  seen: CellContext[];
}): LevelDef {
  const graph = new Graph(1);
  const scatter = graph.add(pointScatterInBounds, {
    count: 2,
    boundsMin: [0, 0, 0],
    boundsMax: [10, 0, 10],
  });
  graph.output(scatter, "out", "points");
  return {
    name: opts.name,
    cellSize: opts.cellSize,
    cellMode: "path",
    path: { length: opts.length, closed: opts.closed },
    generationRadius: opts.generationRadius,
    retainRadius: 1e6,
    graph,
    bind(g, ctx) {
      opts.seen.push(ctx);
      g.setParam(scatter, "seed", ctx.seed);
    },
  };
}

describe("path wanted set", () => {
  it("cooks exactly the hand-computed wanted set on a straight table", async () => {
    // Ten 10-unit sectors, anchor 52, radius 15: the window [37, 67]
    // touches sectors 3..6, at arc distances 12, 2, 0 and 8.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(stats.cooked).sort()).toEqual(["3", "4", "5", "6"]);
    expect(stats.pending).toBe(0);
    expect(stats.evicted).toEqual([]);
  });

  it("cooks nearest-first along the track, with a deterministic sector tie-break", async () => {
    // Anchor exactly on the 40/50 boundary: sectors 4 and 5 are both at
    // arc distance 0 (the lower index wins), then 3 and 6 at 10 each.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 50 } });
    expect(coordKeys(stats.cooked)).toEqual(["4", "5", "3", "6"]);
  });

  it("treats the seam as a hard boundary when the table is open", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    // Anchor 5: the window reaches back past s = 0, and nothing is there.
    // Sector 2 sits exactly 15 away and is kept (the radius is inclusive).
    const near = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(near.cooked)).toEqual(["0", "1", "2"]);

    // Anchor 95: the window runs past the end of the table, and sector 0
    // is 85 units away by arc length, not adjacent.
    const far = await world.update([0, 0, 0], { anchors: { track: 95 } });
    expect(coordKeys(far.cooked)).toEqual(["9", "8"]);
  });

  it("wraps across the seam when the table is closed", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 15 })],
    });
    // Anchor 5 on a closed table: sector 9 ends at the seam, so it is 5
    // units behind — tied with sector 1, and the tie-break orders by
    // sector index.
    const stats = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(stats.cooked)).toEqual(["0", "1", "9", "2"]);
  });

  it("wants every sector exactly once when the window is a full lap", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 60 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 0 } });
    expect(coordKeys(stats.cooked).sort()).toEqual(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].sort(),
    );
    expect(world.cells("track")).toHaveLength(10);
  });

  it("wraps the anchor itself on a closed table", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 15 })],
    });
    // 105 is 5, one lap on: the same wanted set, in the same order.
    const stats = await world.update([0, 0, 0], { anchors: { track: 105 } });
    expect(coordKeys(stats.cooked)).toEqual(["0", "1", "9", "2"]);
  });

  it("rounds cellSize to whole sectors, so the seam lands exactly at s = 0", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 1,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 30,
          length: 100,
          closed: true,
          generationRadius: 100,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 0 } });
    // round(100 / 30) = 3 sectors of 100/3 each, not three 30s plus a
    // 10-unit runt before the seam.
    expect(world.cells("track")).toHaveLength(3);
    const bounds = seen
      .map((ctx) => (ctx.cellMode === "path" ? ([ctx.coord[0], ctx.sMin, ctx.sMax] as const) : null))
      .filter((b): b is readonly [number, number, number] => b !== null)
      .sort((a, b) => a[0] - b[0]);
    expect(bounds[0][1]).toBe(0);
    expect(bounds[2][2]).toBe(100);
    expect(bounds[0][2]).toBe(bounds[1][1]);
    expect(bounds[1][2]).toBe(bounds[2][1]);
  });
});

describe("path directional window", () => {
  it("wants the hand-computed asymmetric set, and only it", async () => {
    // Ten 10-unit sectors, anchor 52, 25 ahead and 5 behind: the window
    // [47, 77]. Sector 5 holds the anchor; 6 starts 8 ahead and 7 starts
    // 18 ahead, both inside 25; 8 starts 28 ahead and is out. Sector 4
    // ends 2 behind and is inside 5; sector 3 ends 12 behind and is out.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, aheadArc: 25, behindArc: 5 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(stats.cooked).sort()).toEqual(["4", "5", "6", "7"]);
    expect(stats.pending).toBe(0);

    // The symmetric window that reaches as far ahead wants five more
    // sectors, every one of them behind the car — the disc this mode
    // exists to stop paying for.
    const disc = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 25 })],
    });
    const discStats = await disc.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(discStats.cooked).sort()).toEqual(["2", "3", "4", "5", "6", "7"]);
  });

  it("cooks nearest as a fraction of its own half, not nearest in raw arc", async () => {
    // Anchor 45 (inside sector 4), 40 ahead and 10 behind. Ranks are the
    // gap over that half's depth: 4 is 0; 5 starts 5 ahead (5/40 = .125);
    // 6 starts 15 ahead (.375); 3 ends 5 BEHIND (5/10 = .5); 7 (25/40 =
    // .625); 8 (35/40 = .875). Sector 9 starts 45 ahead and 2 ends 15
    // behind: both out.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, aheadArc: 40, behindArc: 10 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 45 } });
    // Raw arc distance would have put sector 3 (5 away) second. It cooks
    // fourth, behind sector 6 which is fifteen units further off: the car
    // will be at 60 in a moment and will not see 35 again this lap.
    expect(coordKeys(stats.cooked)).toEqual(["4", "5", "6", "3", "7", "8"]);
  });

  it("is exactly the symmetric window when both halves are equal", async () => {
    // The claim generationRadius makes on a "path" level, pinned: it is
    // aheadArc = behindArc = generationRadius, same set and same order.
    const symmetric = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 15 })],
    });
    const spelledOut = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, aheadArc: 15, behindArc: 15 })],
    });
    const a = await symmetric.update([0, 0, 0], { anchors: { track: 5 } });
    const b = await spelledOut.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(a.cooked)).toEqual(["0", "1", "9", "2"]);
    expect(coordKeys(b.cooked)).toEqual(coordKeys(a.cooked));
  });

  it("wants only the anchor's own sector and the road ahead when behindArc is 0", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, aheadArc: 20, behindArc: 0 })],
    });
    // The anchor is INSIDE sector 5, so its gap is zero on both sides and
    // a zero-depth half still wants it. Sector 4 ends 2 behind — a real
    // gap against a half of depth 0 — and is not wanted.
    const stats = await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(stats.cooked)).toEqual(["5", "6", "7"]);

    // retainBehind is 0 * 1.25 = 0, so a sector evicts the moment the
    // anchor leaves it. That is the config saying what it means.
    const next = await world.update([0, 0, 0], { anchors: { track: 62 } });
    expect(coordKeys(next.evicted)).toEqual(["5"]);
    expect(coordKeys(world.cells("track")).sort()).toEqual(["6", "7", "8"]);
  });

  it("clamps a window longer than the lap to the lap, wanting each sector once", async () => {
    // 90 ahead + 30 behind = 120 on a 100-unit closed table. The two
    // halves overlap round the back; the wanted set is keyed by sector,
    // so each is wanted once, claimed by whichever half reaches it in
    // fewer arc units — which is also the order they cook in.
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, aheadArc: 90, behindArc: 30 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 25 } });
    const keys = coordKeys(stats.cooked);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["2", "3", "1", "4", "5", "6", "0", "7", "8", "9"]);
    expect(world.cells("track")).toHaveLength(10);

    // Widening past a lap buys nothing: the same sectors in the same
    // order, because every rank scaled by the same factor.
    const wider = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, aheadArc: 900, behindArc: 300 })],
    });
    const widerStats = await wider.update([0, 0, 0], { anchors: { track: 25 } });
    expect(coordKeys(widerStats.cooked)).toEqual(keys);
  });

  it("lets an over-long window run off both ends of an open table", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, aheadArc: 200, behindArc: 200 })],
    });
    const stats = await world.update([0, 0, 0], { anchors: { track: 50 } });
    const keys = coordKeys(stats.cooked);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice().sort()).toEqual(
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].sort(),
    );
  });
});

describe("path directional retention", () => {
  /** 40 ahead, 10 behind: retain bands of 50 and 12.5, each half's own. */
  function directionalWorld(): World {
    return new World({
      seed: 1,
      levels: [trackLevel({ closed: false, aheadArc: 40, behindArc: 10 })],
    });
  }

  it("keeps a sector parked just past the behind boundary, and drops it past the band", async () => {
    const world = directionalWorld();
    const first = await world.update([0, 0, 0], { anchors: { track: 45 } });
    expect(coordKeys(first.cooked).sort()).toEqual(["3", "4", "5", "6", "7", "8"]);

    // Anchor 52: sector 3 ends 12 behind. That is outside the 10-unit
    // generation half — it is not re-cooked — and inside the 12.5 retain
    // band, so it stays. This is the parked-just-past-a-boundary case:
    // without a band of its own, the behind half would cook and evict
    // sector 3 on alternate updates as the car crept over 50.
    const second = await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(coordKeys(second.cooked)).toEqual(["9"]);
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("track")).sort()).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);

    // Half a unit further and it is 13 behind, past 12.5, gone.
    const third = await world.update([0, 0, 0], { anchors: { track: 53 } });
    expect(coordKeys(third.evicted)).toEqual(["3"]);
    expect(third.cooked).toEqual([]);
  });

  it("gives the ahead half its own, longer band", async () => {
    const world = directionalWorld();
    await world.update([0, 0, 0], { anchors: { track: 45 } });

    // Backing up to 30 leaves sector 8 starting 50 ahead: outside the
    // 40-unit generation half, exactly on its own 50-unit band, kept —
    // the ahead comparison is inclusive because sMin belongs to the
    // sector. Sector 2 ends exactly at the anchor and joins; sector 1
    // ends exactly 10 behind, which the half-open range makes a miss.
    const second = await world.update([0, 0, 0], { anchors: { track: 30 } });
    expect(coordKeys(second.cooked)).toEqual(["2"]);
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("track")).sort()).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);

    // One more unit back and sector 8 is 51 ahead, past 50. Sector 7, 41
    // ahead, is out of the generation half but inside the band — the two
    // halves are measured separately and so is every cell in them.
    const third = await world.update([0, 0, 0], { anchors: { track: 29 } });
    expect(coordKeys(third.evicted)).toEqual(["8"]);
    expect(coordKeys(third.cooked)).toEqual(["1"]);
    expect(coordKeys(world.cells("track"))).toContain("7");
  });

  it("scales each half from its own depth, which one scalar cannot do", async () => {
    // The two bands the defaults produce are 50 and 12.5 — a factor of
    // four apart, because the halves are. Pin both boundaries at once by
    // parking exactly on each: the ahead 50 keeps sector 8 at anchor 30
    // (previous test) while the behind 12.5 drops sector 3 at anchor 53.
    // A single scalar has to be one number: 50 would have kept sector 3
    // four times deeper than asked, 12.5 would have evicted sector 8 in
    // the same update that cooked it.
    const single = new World({
      seed: 1,
      // The symmetric spelling sized for the AHEAD half, run through the
      // same anchors: it keeps everything the directional world dropped.
      levels: [trackLevel({ closed: false, generationRadius: 40, retainRadius: 50 })],
    });
    await single.update([0, 0, 0], { anchors: { track: 45 } });
    await single.update([0, 0, 0], { anchors: { track: 53 } });
    expect(coordKeys(single.cells("track"))).toContain("3");
    // And it wanted three sectors entirely behind the car to begin with.
    expect(coordKeys(single.cells("track")).sort()).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
  });

  it("honors explicit per-half bands", async () => {
    const world = new World({
      seed: 1,
      levels: [
        trackLevel({
          closed: false,
          aheadArc: 40,
          behindArc: 10,
          retainAheadArc: 40,
          retainBehindArc: 35,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 45 } });
    // retainBehind 35 keeps sector 3 at 13 behind, where the default 12.5
    // evicted it in the test above — same anchors, different half.
    const second = await world.update([0, 0, 0], { anchors: { track: 53 } });
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("track"))).toContain("3");

    // retainAhead 40 is no band at all: sector 8 starts 41 ahead of 39
    // and goes the moment it leaves the generation half, while sector 9
    // (51 ahead) goes with it.
    const third = await world.update([0, 0, 0], { anchors: { track: 39 } });
    expect(coordKeys(third.evicted)).toEqual(["8", "9"]);
    expect(coordKeys(third.cooked)).toEqual(["2"]);
  });
});

describe("path retention", () => {
  it("keeps sectors inside the arc hysteresis band and evicts beyond it", async () => {
    const evictedLog: string[] = [];
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 5, retainRadius: 20 })],
      onCellEvicted: (_level, coord) => evictedLog.push(String(coord[0])),
    });

    const first = await world.update([0, 0, 0], { anchors: { track: 25 } });
    expect(coordKeys(first.cooked)).toEqual(["2", "3"]);

    // Anchor 55: sector 2 ends 25 arc units back (outside retain 20),
    // sector 3 only 15 (inside) — one evicts, one is kept.
    const second = await world.update([0, 0, 0], { anchors: { track: 55 } });
    expect(coordKeys(second.cooked)).toEqual(["5", "6"]);
    expect(coordKeys(second.evicted)).toEqual(["2"]);
    expect(coordKeys(world.cells("track"))).toEqual(["3", "5", "6"]);

    // Anchor 85: sectors 3 (45 back) and 5 (25 back) exit retain, 6 (15)
    // stays.
    const third = await world.update([0, 0, 0], { anchors: { track: 85 } });
    expect(coordKeys(third.cooked)).toEqual(["8", "9"]);
    expect(coordKeys(third.evicted)).toEqual(["3", "5"]);
    expect(evictedLog).toEqual(["2", "3", "5"]);
    expect(coordKeys(world.cells("track"))).toEqual(["6", "8", "9"]);
  });

  it("retains across the seam on a closed table, by the same cyclic metric", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: true, generationRadius: 4, retainRadius: 20 })],
    });
    const first = await world.update([0, 0, 0], { anchors: { track: 95 } });
    expect(coordKeys(first.cooked)).toEqual(["9"]);

    // Anchor 5 is 5 arc units past the seam: sector 9 is 5 behind, well
    // inside retain, and would have been 85 away without wrapping.
    const second = await world.update([0, 0, 0], { anchors: { track: 5 } });
    expect(coordKeys(second.cooked)).toEqual(["0"]);
    expect(second.evicted).toEqual([]);
    expect(coordKeys(world.cells("track"))).toEqual(["9", "0"]);
  });
});

describe("path per-cell seeds", () => {
  it("hashes the sector through the documented one-tuple chain", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 7,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 10,
          length: 100,
          closed: false,
          generationRadius: 15,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 52 } });
    const seeds = new Map(seen.map((ctx) => [ctx.coord.join(","), ctx.seed]));

    // Exact chain: hashCombine(worldSeed, levelIndex, cs).
    expect(seeds.get("3")).toBe(hashCombine(7, 0, 3));
    expect(seeds.get("4")).toBe(hashCombine(7, 0, 4));
    expect(seeds.get("5")).toBe(hashCombine(7, 0, 5));
    expect(seeds.get("3")).not.toBe(seeds.get("4"));

    // The chain's length prefix keeps arities apart for free: the sector
    // chain never collides with the 2D or 3D chain at the same numbers.
    expect(hashCombine(7, 0, 3)).not.toBe(hashCombine(7, 0, 3, 0));
    expect(hashCombine(7, 0, 3)).not.toBe(hashCombine(7, 0, 3, 0, 0));
  });

  it("exposes the table's own facts on every cell context", async () => {
    const seen: CellContext[] = [];
    const world = new World({
      seed: 3,
      levels: [
        recordingLevel({
          name: "track",
          cellSize: 10,
          length: 100,
          closed: true,
          generationRadius: 2,
          seen,
        }),
      ],
    });
    await world.update([0, 0, 0], { anchors: { track: 33 } });
    expect(world.cells("track")).toHaveLength(1);
    const ctx = seen[0];
    expect(ctx.cellMode).toBe("path");
    if (ctx.cellMode !== "path") throw new Error("expected a path cell context");
    expect(ctx.coord).toEqual([3]);
    expect(ctx.sMin).toBe(30);
    expect(ctx.sMax).toBe(40);
    expect(ctx.pathLength).toBe(100);
    expect(ctx.closed).toBe(true);
    expect(ctx.levelSeed).toBe(hashCombine(3, 0));
    expect(ctx.worldSeed).toBe(3);
  });
});

describe("path nesting", () => {
  it("maps a child sector to the parent sector containing its arc midpoint", async () => {
    const table = { length: 100, closed: false };
    const parent = scatterLevel({
      name: "track",
      cellSize: 20,
      cellMode: "path",
      path: table,
      generationRadius: 30,
      retainRadius: 1000,
      count: 3,
    });
    const child = childEchoLevel({
      name: "dressing",
      cellSize: 5,
      cellMode: "path",
      path: table,
      generationRadius: 3,
      retainRadius: 1000,
    });
    const world = new World({ seed: 9, levels: [parent.def, child.def] });
    const stats = await world.update([0, 0, 0], {
      anchors: { track: 37.5, dressing: 37.5 },
    });
    expect(stats.pending).toBe(0);
    expect(coordKeys(stats.cooked.filter((c) => c.level === "dressing"))).toEqual(["7", "6", "8"]);

    // Sectors 6 ([30, 35)) and 7 ([35, 40)) have midpoints 32.5 and 37.5,
    // both inside parent sector 1 ([20, 40)); sector 8's midpoint 42.5
    // falls in parent sector 2.
    const p1 = world.getCell("track", [1])?.outputs.points;
    const p2 = world.getCell("track", [2])?.outputs.points;
    expect(world.getCell("dressing", [6])?.outputs.parentEcho[0]).toBe(p1?.[0]);
    expect(world.getCell("dressing", [7])?.outputs.parentEcho[0]).toBe(p1?.[0]);
    expect(world.getCell("dressing", [8])?.outputs.parentEcho[0]).toBe(p2?.[0]);
  });

  it("streams a path level under an unbounded parent from one update call", async () => {
    const world = new World({
      seed: 5,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def,
        childEchoLevel({
          name: "track",
          cellSize: 10,
          cellMode: "path",
          path: { length: 100, closed: true },
          generationRadius: 4,
        }).def,
      ],
    });
    // One call: the world point drives the unbounded level, the anchor
    // drives the path level.
    const stats = await world.update([12, 0, -8], { anchors: { track: 25 } });
    expect(stats.cooked[0]).toEqual({ level: "planet", coord: [0, 0] });
    expect(coordKeys(stats.cooked.filter((c) => c.level === "track"))).toEqual(["2"]);
    expect(stats.pending).toBe(0);
    const planetPoints = world.getCell("planet", [0, 0])?.outputs.points;
    expect(world.getCell("track", [2])?.outputs.parentEcho[0]).toBe(planetPoints?.[0]);
  });
});

describe("path determinism", () => {
  function makeWorld(): World {
    return new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 12, retainRadius: 1000, jitter: true })],
    });
  }

  it("different anchor paths produce byte-identical sectors", async () => {
    const a = makeWorld();
    const b = makeWorld();
    // A walks forward over the seam; B arrives from the other direction.
    await a.update([0, 0, 0], { anchors: { track: 5 } });
    await a.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 105 } });

    const coordsA = coordKeys(a.cells("track")).sort();
    expect(coordsA).toEqual(coordKeys(b.cells("track")).sort());
    expect(coordsA).toHaveLength(6);
    for (const cell of a.cells("track")) {
      const other = b.getCell("track", cell.coord);
      expect(other, `sector ${cell.coord.join(",")} missing in B`).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });

  it("an evicted then regenerated sector is byte-identical", async () => {
    const world = new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 5, retainRadius: 5, jitter: true })],
    });
    await world.update([0, 0, 0], { anchors: { track: 25 } });
    const before = world.getCell("track", [2])?.outputs;
    expect(before).toBeDefined();

    await world.update([0, 0, 0], { anchors: { track: 75 } });
    expect(world.getCell("track", [2])).toBeUndefined();

    await world.update([0, 0, 0], { anchors: { track: 25 } });
    const after = world.getCell("track", [2])?.outputs;
    expect(outputsDiff(before ?? {}, after ?? {})).toBeNull();
  });

  it("different anchor paths produce byte-identical sectors under an asymmetric window", async () => {
    // The anchor chooses WHICH sectors are wanted; nothing about the
    // window may reach a sector's contents. An asymmetric window is the
    // sharper version of that claim, because the two worlds below reach
    // the same ten sectors by opposite routes and through halves of
    // different depths.
    function asymmetricWorld(): World {
      return new World({
        seed: 42,
        levels: [
          trackLevel({
            closed: true,
            aheadArc: 30,
            behindArc: 10,
            retainAheadArc: 1000,
            retainBehindArc: 1000,
            jitter: true,
          }),
        ],
      });
    }
    const a = asymmetricWorld();
    const b = asymmetricWorld();
    await a.update([0, 0, 0], { anchors: { track: 5 } });
    await a.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 55 } });
    await b.update([0, 0, 0], { anchors: { track: 105 } });

    const coordsA = coordKeys(a.cells("track")).sort();
    expect(coordsA).toEqual(coordKeys(b.cells("track")).sort());
    expect(coordsA).toHaveLength(10);
    for (const cell of a.cells("track")) {
      const other = b.getCell("track", cell.coord);
      expect(other, `sector ${cell.coord.join(",")} missing in B`).toBeDefined();
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }

    // And identical to what the symmetric spelling produces for the same
    // sectors: the window picks the set, never the bytes.
    const symmetric = new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 60, retainRadius: 1000, jitter: true })],
    });
    await symmetric.update([0, 0, 0], { anchors: { track: 5 } });
    for (const cell of a.cells("track")) {
      const other = symmetric.getCell("track", cell.coord);
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });

  it("a partial cook resumes to the same bytes a whole one produces", async () => {
    const budgeted = new World({
      seed: 42,
      levels: [trackLevel({ closed: true, generationRadius: 12, retainRadius: 1000, jitter: true })],
    });
    const whole = makeWorld();
    const first = await budgeted.update([0, 0, 0], {
      anchors: { track: 5 },
      maxCooksPerUpdate: 1,
    });
    expect(coordKeys(first.cooked)).toEqual(["0"]);
    expect(first.pending).toBe(2);
    await budgeted.update([0, 0, 0], { anchors: { track: 5 } });
    await whole.update([0, 0, 0], { anchors: { track: 5 } });

    expect(coordKeys(budgeted.cells("track")).sort()).toEqual(
      coordKeys(whole.cells("track")).sort(),
    );
    for (const cell of whole.cells("track")) {
      const other = budgeted.getCell("track", cell.coord);
      expect(outputsDiff(cell.outputs, other?.outputs ?? {})).toBeNull();
    }
  });
});

describe("path validation", () => {
  it("requires a path table when cellMode is path, and states the fix", () => {
    const def = scatterLevel({ name: "track", cellSize: 10, generationRadius: 8 }).def;
    const bad: LevelDef = { ...def, cellMode: "path" };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): cellMode "path" requires a path table; add path: \{ length: <total arc length of the centreline>, closed: true \| false \}/,
    );
  });

  it("refuses a path table on a level that partitions space", () => {
    const def = scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def;
    const bad: LevelDef = { ...def, path: { length: 100, closed: false } };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("chunk"\): has a path table but cellMode is "xz".*set cellMode: "path".*or remove the path field/,
    );
  });

  it("rejects a non-positive or non-finite path length", () => {
    const base = trackLevel({ closed: false, generationRadius: 8 });
    for (const length of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad: LevelDef = { ...base, path: { length, closed: false } };
      expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
        /level 0 \("track"\): path\.length must be a positive finite number/,
      );
    }
  });

  it("rejects a non-boolean path.closed, saying what closed means", () => {
    const base = trackLevel({ closed: false, generationRadius: 8 });
    const bad: LevelDef = {
      ...base,
      path: { length: 100, closed: "yes" as unknown as boolean },
    };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): path\.closed must be a boolean.*adjacent to sector 0 across the s = 0 seam; got yes/,
    );
  });

  it("rejects a path level under a bounded square parent, naming both", () => {
    const levels = [
      scatterLevel({ name: "region", cellSize: 100, generationRadius: 80 }).def,
      scatterLevel({
        name: "dressing",
        cellSize: 10,
        cellMode: "path",
        path: { length: 100, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) uses "path" cells under the "xz" parent "region": an arc sector is a tube along a curve, so no single square parent cell contains it; make the parent "path" with the same centreline, or make this level "xz"/,
    );
  });

  it("rejects a square level under a bounded path parent, naming both", () => {
    const levels = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({ name: "dressing", cellSize: 10, generationRadius: 8 }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) uses "xz" cells under the "path" parent "track": an arc sector is a tube along a curve, so it contains no whole square cell; make this level "path" with the same centreline, or make the parent "xz"/,
    );
  });

  it("rejects nested path levels that do not ride the same table", () => {
    const levels = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({
        name: "dressing",
        cellSize: 5,
        cellMode: "path",
        path: { length: 120, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels })).toThrow(
      /level 1 \("dressing"\) declares path \{ length: 120, closed: false \} but its "path" parent "track" declares \{ length: 100, closed: false \}.*give both levels the same path table/,
    );
  });

  it("compares cellSize coarse-to-fine within a mode family, not across", () => {
    // Two path levels are comparable: 40 under 20 is out of order.
    const outOfOrder = [
      trackLevel({ name: "track", closed: false, cellSize: 20, generationRadius: 30 }),
      scatterLevel({
        name: "dressing",
        cellSize: 40,
        cellMode: "path",
        path: { length: 100, closed: false },
        generationRadius: 8,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels: outOfOrder })).toThrow(
      /levels must be ordered coarse to fine: level 1 \("dressing"\) cellSize 40 \(arc length\) must be strictly smaller than "path" level "track" cellSize 20/,
    );

    // An arc length and a world length are not comparable, so a larger
    // arc cellSize under a smaller world one is refused for the REASON it
    // is actually wrong — the nesting — not by a meaningless comparison.
    const crossFamily = [
      scatterLevel({ name: "region", cellSize: 100, generationRadius: 80 }).def,
      scatterLevel({
        name: "dressing",
        cellSize: 500,
        cellMode: "path",
        path: { length: 5000, closed: false },
        generationRadius: 800,
      }).def,
    ];
    expect(() => new World({ seed: 1, levels: crossFamily })).toThrow(
      /uses "path" cells under the "xz" parent "region"/,
    );
  });

  it("refuses both spellings of the window on one level, naming both fixes", () => {
    const bad: LevelDef = {
      ...trackLevel({ closed: false, aheadArc: 40, behindArc: 10 }),
      generationRadius: 25,
    };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): declares generationRadius \(25\) as well as a directional window \(aheadArc 40, behindArc 10\).*generationRadius IS the symmetric window.*Drop generationRadius to stream 40 ahead and 10 behind, or drop aheadArc\/behindArc to stream 25 in both directions/,
    );
  });

  it("refuses a half-stated window, naming the missing half", () => {
    const onlyAhead = trackLevel({ closed: false, aheadArc: 40 });
    expect(() => new World({ seed: 1, levels: [onlyAhead] })).toThrow(
      /level 0 \("track"\): a directional window states both halves, and behindArc is missing \(this level sets aheadArc\).*behindArc: 0 is legal/,
    );
    const onlyRetain = trackLevel({ closed: false, retainAheadArc: 40 });
    expect(() => new World({ seed: 1, levels: [onlyRetain] })).toThrow(
      /aheadArc and behindArc are missing \(this level sets retainAheadArc\)/,
    );
  });

  it("refuses one retain scalar across two unequal halves, naming the pair", () => {
    const bad: LevelDef = {
      ...trackLevel({ closed: false, aheadArc: 40, behindArc: 10 }),
      retainRadius: 50,
    };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): declares retainRadius \(50\) alongside a directional window \(aheadArc 40, behindArc 10\); one hysteresis scalar cannot describe two halves of different depths.*Use retainAheadArc and retainBehindArc, which default to aheadArc \* 1\.25 and behindArc \* 1\.25/,
    );
  });

  it("refuses a directional window on a level that partitions space", () => {
    const def = scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def;
    const bad: LevelDef = { ...def, aheadArc: 40, behindArc: 10 };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("chunk"\): a directional window \(aheadArc, behindArc\) describes travel along a centreline and applies only to cellMode: "path"; a "xz" cell is wanted by distance from the viewpoint in every direction at once, so it has no ahead/,
    );
  });

  it("rejects a negative or non-finite half, saying that 0 is not one", () => {
    for (const [name, level] of [
      ["aheadArc", trackLevel({ closed: false, aheadArc: -1, behindArc: 10 })],
      ["behindArc", trackLevel({ closed: false, aheadArc: 40, behindArc: Number.NaN })],
    ] as const) {
      expect(() => new World({ seed: 1, levels: [level] })).toThrow(
        new RegExp(
          `level 0 \\("track"\\): ${name} must be a finite number >= 0 \\(arc units along the centreline; 0 wants only the sector the anchor is standing in, on that side\\)`,
        ),
      );
    }
    // 0 itself is legal on either half and builds without complaint.
    expect(
      () => new World({ seed: 1, levels: [trackLevel({ closed: false, aheadArc: 40, behindArc: 0 })] }),
    ).not.toThrow();
  });

  it("rejects a retain band shorter than its own half", () => {
    const bad = trackLevel({
      closed: false,
      aheadArc: 40,
      behindArc: 10,
      retainBehindArc: 4,
    });
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): retainBehindArc \(4\) must be a finite number >= behindArc \(10\); the retain band is hysteresis AROUND its own half of the generation window, not a shorter window inside it/,
    );
  });

  it("refuses a directional window on an unbounded level rather than dropping it", () => {
    // cellMode and generationRadius are accepted and ignored up here, for
    // a backward-compatibility reason that cannot apply to a window this
    // new. Silence would be the failure its own error messages argue
    // against: a number present, apparently live, never read.
    const def = scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def;
    const bad: LevelDef = { ...def, aheadArc: 400, behindArc: 100 };
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(WorldValidationError);
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("planet"\): a directional window \(aheadArc, behindArc\) on an unbounded level, which is one global cell and partitions no arc length, so there is no sector for the window to choose between; remove aheadArc, behindArc, or give this level a finite cellSize with cellMode: "path" and a path table/,
    );
    // The band fields alone are refused by the same rule, not just the pair.
    expect(
      () => new World({ seed: 1, levels: [{ ...def, retainBehindArc: 50 }] }),
    ).toThrow(/a directional window \(retainBehindArc\) on an unbounded level/);
    // And an unbounded level with none of them still builds, unchanged.
    expect(() => new World({ seed: 1, levels: [def] })).not.toThrow();
  });

  it("tells a windowless path level about both spellings", () => {
    const bad = trackLevel({ closed: false });
    expect(() => new World({ seed: 1, levels: [bad] })).toThrow(
      /level 0 \("track"\): a bounded level requires a window: generationRadius \(a positive finite number\) for the symmetric one, or aheadArc and behindArc together \(finite, >= 0\) for a directional one; only an unbounded level may omit both/,
    );
  });

  it("rejects a coordinate arity mismatch in the accessors", async () => {
    const world = new World({
      seed: 1,
      levels: [trackLevel({ closed: false, generationRadius: 15 })],
    });
    await world.update([0, 0, 0], { anchors: { track: 52 } });
    expect(() => world.getCell("track", [0, 0])).toThrow(
      /level "track" uses "path" cells addressed \[cs\] \(one sector index\); got a 2-component coordinate/,
    );
    expect(() => world.invalidate("track", [0, 0, 0])).toThrow(WorldValidationError);
    expect(world.getCell("track", [5])).toBeDefined();
  });
});

describe("anchor validation", () => {
  function pathWorld(): World {
    return new World({ seed: 1, levels: [trackLevel({ closed: false, generationRadius: 15 })] });
  }

  it("requires an anchor for every path level, showing the call that supplies it", async () => {
    await expect(pathWorld().update([0, 0, 0])).rejects.toThrow(
      /level 0 \("track"\) uses "path" cells and has no arc anchor: pass update\(viewpoint, \{ anchors: \{ "track": s \} \}\) with s the arc length along its centreline/,
    );
    await expect(pathWorld().update([0, 0, 0], { anchors: {} })).rejects.toThrow(
      WorldValidationError,
    );
  });

  it("rejects a non-finite anchor, naming the level", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(pathWorld().update([0, 0, 0], { anchors: { track: bad } })).rejects.toThrow(
        /anchors\["track"\] must be a finite number \(an arc length along the level's centreline\)/,
      );
    }
  });

  it("rejects an anchor naming an unknown level, listing the levels", async () => {
    await expect(
      pathWorld().update([0, 0, 0], { anchors: { track: 5, trak: 5 } }),
    ).rejects.toThrow(/anchors names unknown level "trak"; levels: track/);
  });

  it("rejects an anchor on a level that follows the viewpoint", async () => {
    const world = new World({
      seed: 1,
      levels: [scatterLevel({ name: "chunk", cellSize: 10, generationRadius: 8 }).def],
    });
    await expect(world.update([0, 0, 0], { anchors: { chunk: 5 } })).rejects.toThrow(
      /anchors names level "chunk", which uses "xz" cells and follows the viewpoint.*drop this entry or give that level cellMode: "path"/,
    );
  });

  it("validates every anchor before any cell cooks", async () => {
    const world = new World({
      seed: 1,
      levels: [
        scatterLevel({ name: "planet", cellSize: "unbounded", count: 3 }).def,
        childEchoLevel({
          name: "track",
          cellSize: 10,
          cellMode: "path",
          path: { length: 100, closed: false },
          generationRadius: 5,
        }).def,
      ],
    });
    await expect(world.update([0, 0, 0])).rejects.toThrow(WorldValidationError);
    // The unbounded level is coarser and would otherwise have cooked
    // before the path level's missing anchor was noticed.
    expect(world.cells("planet")).toHaveLength(0);
  });
});
