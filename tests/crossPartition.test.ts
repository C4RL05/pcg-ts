/**
 * Cross-partition foundations: the three kinds of test phase 42 exists to
 * establish, over the world-anchored source and the identity keying that
 * came with it.
 *
 * 1. PERMUTATION EQUIVARIANCE. Reorder the input points and cook again:
 *    the output must be the SAME OUTPUT, permuted the same way — not
 *    merely the same number of points. This is the direct test of keying
 *    per-point randomness on identity instead of array index, and it is
 *    the property every other one here rests on, because a halo, a
 *    filter and a cell boundary are all reorderings.
 * 2. SPLIT WITH HALO EQUALS WHOLE. Cook a region as one piece, then as
 *    cells that each derive a halo from world coordinates, clip each cell
 *    to what it owns, stitch, and compare. This is the direct test of
 *    anchoring: it fails the moment a point's position, its survival, or
 *    a measurement over its neighbours depends on the query window.
 * 3. TWO-CELL SEAM AGREEMENT. Both sides of a boundary must agree on who
 *    owns a point that lies exactly ON it, so the boundary point is
 *    emitted EXACTLY ONCE — never twice, never not at all.
 *
 * Each kind ships with its negative control, in the file, cooked every
 * run: an index-keyed field, a halo of zero, an inclusive clip and a
 * gapped one. A test that has never been seen to fail is worth nothing,
 * and these four are the failures the three kinds are supposed to catch.
 *
 * NO `budgetMs` ANYWHERE HERE, deliberately. The executor yields AFTER
 * `cookNode` returns, so a node body is atomic under a budget and a
 * budget cannot reorder anything a node sees — partitioning in TIME is
 * `tests/corpus.test.ts`'s subject. These suites partition in SPACE,
 * which is a different axis and the one the runtime pillar actually
 * claims. Budgeting them would buy nothing and cost a timer clamp
 * (~15 ms per node on Windows) per cook.
 */
import { describe, expect, it } from "vitest";
import {
  type CellContext,
  type Geometry,
  Graph,
  type LevelDef,
  type NodeHandle,
  Pcg32,
  World,
  attribute,
  cook,
  dataInput,
  filterByBounds,
  filterByDensity,
  fraction,
  jitterPoints,
  makeGeometryItem,
  pointNeighborhood,
  pointScatterInWorld,
  type PointScatterInWorldParams,
  randomField,
  setAttribute,
} from "../src/index.js";
import { firstGeo } from "../src/nodes/testSupport.js";
import { gatherPoints } from "../src/nodes/util.js";
import {
  formatPartitionReport,
  multisetDiff,
  partitionReport,
  pointKeys,
  pointRows,
} from "./support/pointMultiset.js";

/** Graph seed shared by every cook here: node seeds must not move. */
const GRAPH_SEED = 7331;
const WORLD_SEED = 90210;
/** The source's own lattice spacing — never a level's cellSize. */
const LATTICE = 4;
/** Points per square world unit. */
const DENSITY = 0.06;
/** Neighbourhood radius, in world units. */
const RADIUS = 3;
/** Per-axis jitter, applied on X and Z only. */
const JITTER = 0.5;
/**
 * How far outside its own box a cell must look. A neighbour at RADIUS can
 * be pulled toward a point by both jitters, each up to JITTER on X and on
 * Z, so up to JITTER * sqrt(2) of distance each. Anything wider is also
 * correct; anything narrower is the negative control below.
 */
const HALO = RADIUS + 2 * JITTER * Math.SQRT2;

// ---------------------------------------------------------------------------
// The graph under test

/** A window on the XZ plane: [min, max) on both axes. */
interface Box {
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
}

/** Where a cook's points come from: a live cloud, or the world itself. */
type Head =
  | { readonly kind: "items"; readonly geo: Geometry }
  | ({ readonly kind: "world" } & Box);

interface ChainOptions {
  /** Include the probabilistic filter (changes the point COUNT). */
  readonly filter?: boolean;
  /**
   * Where `density` comes from. "identity" is `randomField`, keyed on the
   * point's own identity. "index" is `fraction`, which ranks a point by
   * its slot in the array — the defect kind 1 has to catch.
   */
  readonly density?: "identity" | "index";
  /** Include the jitter (moves points, so it changes their identity). */
  readonly jitter?: boolean;
  /** Include the neighbourhood measure (reads points OUTSIDE the cell). */
  readonly measure?: boolean;
  /**
   * Append a half-open `filterByBounds` on this box — the tiling pattern
   * `docs/authoring.md` recommends, where a cell queries its own box and
   * clips to it again at the end. It is redundant by construction and
   * that is the point: the source's clip and the filter's clip must agree
   * about every point, on the value the cloud actually stores.
   */
  readonly clip?: Box;
}

/** A built graph, with the source handle a `World` level needs to bind. */
interface Built {
  readonly graph: Graph;
  readonly source: NodeHandle<PointScatterInWorldParams>;
}

/**
 * The chain every suite cooks. Node ids are explicit and identical in
 * every variant: a node's seed is `hashCombine(graphSeed, hashString(id))`,
 * so a cell graph and a whole-region graph that named their nodes
 * differently would be different worlds and none of this would compare.
 *
 * `P0` is the point's position BEFORE the jitter, which is what every
 * ownership decision here is taken on. Clipping on the jittered position
 * would let a point drift across a cell boundary and be claimed twice or
 * not at all — a real hazard, but a property of the clip and not of the
 * anchoring these suites are about.
 */
function buildGraph(head: Head, opts: ChainOptions = {}): Built {
  const g = new Graph(GRAPH_SEED);
  // The scatter is added either way, so both heads produce the same node
  // ids and therefore the same node seeds. With injected items it is left
  // unconnected on a one-unit window and nothing downstream reads it.
  const box: Box = head.kind === "world" ? head : { min: [0, 0], max: [1, 1] };
  const scatter = g.add(
    pointScatterInWorld,
    {
      density: DENSITY,
      cellSize: LATTICE,
      latticeMode: "xz",
      height: 0,
      boundsMin: [box.min[0], 0, box.min[1]],
      boundsMax: [box.max[0], 0, box.max[1]],
      seed: WORLD_SEED,
    },
    "source",
  );
  let node: NodeHandle =
    head.kind === "items"
      ? g.add(dataInput, { items: [makeGeometryItem(head.geo)] }, "injected")
      : scatter;
  const connect = (next: NodeHandle): NodeHandle => {
    g.connect(node, "out", next, "in");
    node = next;
    return next;
  };
  connect(
    g.add(setAttribute, { name: "P0", type: "f32", tupleSize: 3, value: attribute("P", 3) }, "origin"),
  );
  if (opts.filter === true) {
    connect(
      g.add(
        setAttribute,
        {
          name: "density",
          type: "f32",
          value: opts.density === "index" ? fraction() : randomField("thin"),
        },
        "density",
      ),
    );
    connect(g.add(filterByDensity, { mode: opts.density === "index" ? "threshold" : "probabilistic", threshold: 0.5, seed: 5 }, "thin"));
  }
  if (opts.jitter === true) {
    connect(g.add(jitterPoints, { amount: [JITTER, 0, JITTER], seed: 9 }, "jitter"));
  }
  if (opts.measure === true) {
    connect(
      g.add(
        pointNeighborhood,
        { radius: RADIUS, countAttr: "nbrCount", averageAttr: "P", averageOutAttr: "nbrAvg" },
        "crowd",
      ),
    );
  }
  if (opts.clip !== undefined) {
    const { min, max } = opts.clip;
    connect(
      g.add(
        filterByBounds,
        {
          mode: "inside",
          boundary: "halfOpen",
          boundsMin: [min[0], -Infinity, min[1]],
          boundsMax: [max[0], Infinity, max[1]],
        },
        "clip",
      ),
    );
  }
  g.output(node, "out", "points");
  return { graph: g, source: scatter };
}

/** Cook one built graph and take its single point cloud. */
async function cookPoints(built: Built): Promise<Geometry> {
  return firstGeo((await cook(built.graph)).outputs.points);
}

/** The full chain over a world window. */
const cookWindow = (
  min: readonly [number, number],
  max: readonly [number, number],
  opts: ChainOptions,
): Promise<Geometry> => cookPoints(buildGraph({ kind: "world", min, max }, opts));

/** The source alone over a world window — no ops, nothing to blame but the clip. */
const scatterOnly = (
  min: readonly [number, number],
  max: readonly [number, number],
): Promise<Geometry> => cookWindow(min, max, {});

// ---------------------------------------------------------------------------
// Test-local helpers

/**
 * A deterministic shuffle of `0..n-1` (Fisher-Yates driven by PCG32 —
 * there is no `Math.random` in this library, tests included).
 */
function shuffleOrder(n: number, seed: number): Uint32Array {
  const rng = new Pcg32(seed);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.range(0, i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

/** A copy of `geo` whose points carry their own index as "srcIndex". */
function tagged(geo: Geometry): Geometry {
  const attr = geo.attrs.point.add("srcIndex", "u32", 1, 0);
  for (let i = 0; i < geo.pointCount; i++) attr.set(i, i);
  return geo;
}

/** The "srcIndex" tags of `geo`, in emission order. */
function tagsOf(geo: Geometry): number[] {
  const attr = geo.attrs.point.require("srcIndex");
  return Array.from({ length: geo.pointCount }, (_, i) => attr.get(i));
}

/** Points whose PRE-JITTER position lies in [min, max) on X and Z. */
function ownedBy(geo: Geometry, { min, max }: Box): Geometry {
  const p0 = geo.attrs.point.require("P0");
  const keep: number[] = [];
  for (let i = 0; i < geo.pointCount; i++) {
    const x = p0.get(i, 0);
    const z = p0.get(i, 2);
    if (x >= min[0] && x < max[0] && z >= min[1] && z < max[1]) keep.push(i);
  }
  return gatherPoints(geo, keep);
}

// Doubles as their bit patterns, so the seam suite can bisect over the
// representable values between two coordinates rather than over a made-up
// epsilon. Every value here is finite and positive, where the bit order
// and the numeric order agree.
const F64 = new Float64Array(1);
const F64_BITS = new BigUint64Array(F64.buffer);

function doubleBits(x: number): bigint {
  F64[0] = x;
  return F64_BITS[0];
}

function fromDoubleBits(bits: bigint): number {
  F64_BITS[0] = bits;
  return F64[0];
}

/** The smallest double strictly greater than `x` (finite, x > 0 here). */
function nextUp(x: number): number {
  return fromDoubleBits(doubleBits(x) + 1n);
}

// ---------------------------------------------------------------------------
// 1. Permutation equivariance

describe("permutation equivariance", () => {
  // One base cloud, cooked once and reused: every test below permutes it.
  // It comes out of the world-anchored source, so its points carry
  // distinct positions AND distinct per-point seeds — a cloud of
  // coincident zero-seed points would make every identity-keyed claim
  // here vacuously true.
  const basePromise = scatterOnly([0, 0], [64, 64]).then(tagged);

  it("hands the same points back in the permuted order, value for value", async () => {
    // The 1:1 case, stated in its strongest form: no filter, so output
    // point i of the shuffled cook must be output point order[i] of the
    // straight one — every attribute, float-exact, element for element.
    const base = await basePromise;
    expect(base.pointCount).toBeGreaterThan(120);
    const order = shuffleOrder(base.pointCount, 2024);
    const opts: ChainOptions = { jitter: true, measure: true };
    const straight = await cookPoints(buildGraph({ kind: "items", geo: base }, opts));
    const shuffled = await cookPoints(
      buildGraph({ kind: "items", geo: gatherPoints(base, order) }, opts),
    );

    const rows = pointRows(straight);
    expect(pointRows(shuffled)).toEqual(Array.from(order, (src) => rows[src]));
  });

  it("keeps a filter's survivors a set of POINTS, not a set of slots", async () => {
    // With a filter the count changes, so equivariance is a multiset
    // claim plus an ordering claim. Both matter: the multiset says the
    // same points survived, the ordering says the output followed its
    // input rather than some order of the node's own.
    const base = await basePromise;
    const order = shuffleOrder(base.pointCount, 4711);
    const opts: ChainOptions = { filter: true, jitter: true, measure: true };
    const straight = await cookPoints(buildGraph({ kind: "items", geo: base }, opts));
    const shuffled = await cookPoints(
      buildGraph({ kind: "items", geo: gatherPoints(base, order) }, opts),
    );

    // Non-vacuous: the filter really did remove points, and left some.
    expect(straight.pointCount).toBeGreaterThan(20);
    expect(straight.pointCount).toBeLessThan(base.pointCount);
    expect(shuffled.pointCount).toBe(straight.pointCount);

    // The same points, with the same values, in whatever order.
    expect(multisetDiff(straight, shuffled, "straight", "shuffled")).toBeNull();

    // And permuted the SAME way, not just permuted: a filter preserves
    // input order, so the survivors come out in input order both times.
    const survived = tagsOf(straight);
    expect(survived).toEqual([...survived].sort((a, b) => a - b));
    expect(tagsOf(shuffled)).toEqual([...order].filter((tag) => survived.includes(tag)));
  });

  it("REDDENS when the same chain draws from an index-keyed field", async () => {
    // The negative control. `fraction` ranks a point by its slot in the
    // array — the shape of every bug the identity keying was introduced
    // to remove — so thresholding on it keeps the second half of the
    // ARRAY rather than half of the POINTS, and a shuffle keeps a
    // different set. Same harness, same assertions, opposite verdict.
    const base = await basePromise;
    const order = shuffleOrder(base.pointCount, 4711);
    const opts: ChainOptions = { filter: true, density: "index", jitter: true, measure: true };
    const straight = await cookPoints(buildGraph({ kind: "items", geo: base }, opts));
    const shuffled = await cookPoints(
      buildGraph({ kind: "items", geo: gatherPoints(base, order) }, opts),
    );

    // Same count — which is exactly why counting is not a test.
    expect(shuffled.pointCount).toBe(straight.pointCount);
    expect(straight.pointCount).toBeGreaterThan(20);
    expect(multisetDiff(straight, shuffled, "straight", "shuffled")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Split with halo equals whole

describe("split with halo equals whole", () => {
  /** The region cooked both ways, and the cell grid it is split into. */
  const REGION_MIN = 0;
  const REGION_MAX = 96;
  const SPLIT = 32;

  const REGION: Box = { min: [REGION_MIN, REGION_MIN], max: [REGION_MAX, REGION_MAX] };

  const cellBoxes = (): (Box & { label: string })[] => {
    const boxes: (Box & { label: string })[] = [];
    for (let cz = REGION_MIN; cz < REGION_MAX; cz += SPLIT) {
      for (let cx = REGION_MIN; cx < REGION_MAX; cx += SPLIT) {
        boxes.push({ min: [cx, cz], max: [cx + SPLIT, cz + SPLIT], label: `cell(${cx},${cz})` });
      }
    }
    return boxes;
  };

  const FULL: ChainOptions = { filter: true, jitter: true, measure: true };

  /** Cook `box` widened by `halo`, then keep only what `box` owns. */
  async function pieceOf(box: Box, halo: number): Promise<Geometry> {
    const wide = await cookWindow(
      [box.min[0] - halo, box.min[1] - halo],
      [box.max[0] + halo, box.max[1] + halo],
      FULL,
    );
    return ownedBy(wide, box);
  }

  it("stitches back to the single-query result, measurements included", async () => {
    const whole = await pieceOf(REGION, HALO);
    expect(whole.pointCount).toBeGreaterThan(150);

    const boxes = cellBoxes();
    expect(boxes.length).toBe(9);
    const parts = [];
    for (const box of boxes) parts.push({ label: box.label, geo: await pieceOf(box, HALO) });
    // Every cell contributed: a partition of nine empty cells and one
    // full one would satisfy the comparison and prove nothing.
    for (const part of parts) expect(part.geo.pointCount).toBeGreaterThan(5);

    const message = formatPartitionReport(
      partitionReport(parts, whole, "split"),
      "the cells do not reproduce the region cooked whole",
    );
    expect(message).toBeNull();
  });

  it("REDDENS when a cell derives no halo", async () => {
    // The negative control. Positions, survival and jitter are all pure
    // functions of world coordinates, so they survive a halo of zero
    // untouched — but `pointNeighborhood` has to SEE outside the cell,
    // and without a halo every point near a cell edge measures a
    // truncated neighbourhood. Nothing is duplicated and nothing is
    // dropped; the values are simply wrong, which is precisely the
    // failure a count-based comparison misses.
    const whole = await pieceOf(REGION, HALO);
    const parts = [];
    for (const box of cellBoxes()) parts.push({ label: box.label, geo: await pieceOf(box, 0) });

    const report = partitionReport(parts, whole, "split-no-halo");
    // Same population: the cells hold exactly the points they should.
    const total = parts.reduce((n, p) => n + p.geo.pointCount, 0);
    expect(total).toBe(whole.pointCount);
    // And still wrong, in both directions at once — each edge point
    // appears with a value the whole region does not hold.
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.extra.length).toBeGreaterThan(0);
    expect(
      formatPartitionReport(report, "a haloless split should not reproduce the whole"),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Two-cell seam agreement

describe("two-cell seam agreement", () => {
  /**
   * A point that lies EXACTLY on the seam plane, and the plane itself.
   *
   * The plane is recovered by bisection on the double rather than read
   * off the point, and the two agreeing is itself the assertion. The
   * largest B for which the window [B, ...) still emits the point IS the
   * threshold the source's clip compares against, whatever that is; the
   * point's stored X is what a downstream node — `filterByBounds`, a
   * cell's own ownership test — will compare instead. The source clips on
   * the f32 it is about to WRITE, so the two are one number, and the
   * first test below pins that. They were not always: clipping the wider
   * intermediate and storing its rounding put the threshold half an ulp
   * off the stored value, which is invisible near the origin and drops
   * points at a seam once the f32 spacing grows (suite 4).
   *
   * Every window below is therefore a true boundary case — the point sits
   * on the plane bit for bit, both sides generate it (its lattice cell is
   * visited by both), and nothing but the half-open clip decides who
   * keeps it.
   *
   * `cells3d.test.ts` pins that a cell's content does not depend on which
   * neighbours exist, but no point in it is a candidate for two cells at
   * all, so it is silent about agreement. These are candidates.
   */
  const seamPromise = (async (): Promise<{
    x: number;
    z: number;
    key: string;
    stored: number;
  }> => {
    const probe = await scatterOnly([0, 0], [64, 64]);
    const P = probe.attrs.point.require("P");
    const keys = pointKeys(probe, "seam probe");
    // The leftmost point past x = 24: far enough out to serve as a World
    // cellSize below, and chosen by a rule rather than by an index.
    let pick = -1;
    for (let i = 0; i < probe.pointCount; i++) {
      const x = P.get(i, 0);
      if (x >= 24 && (pick === -1 || x < P.get(pick, 0))) pick = i;
    }
    if (pick === -1) throw new Error("no probe point past x = 24 — the fixture moved");
    const storedX = P.get(pick, 0);
    const z = P.get(pick, 2);
    const key = keys[pick];

    // Does a window starting at `min` still emit this point? Monotone in
    // `min`, which is what makes the bisection valid. The window is a
    // couple of lattice cells wide, so each probe costs nothing.
    const emittedFrom = async (min: number): Promise<boolean> => {
      const emitted = await scatterOnly([min, z - LATTICE], [storedX + LATTICE, z + LATTICE]);
      return pointKeys(emitted, "seam probe").includes(key);
    };
    // A bracket far wider than the half-ulp the true coordinate can sit
    // from the stored one, so the invariant holds at both ends.
    let lo = doubleBits(storedX * (1 - 1e-6));
    let hi = doubleBits(storedX * (1 + 1e-6));
    if (!(await emittedFrom(fromDoubleBits(lo)))) throw new Error("seam bracket lost the point");
    if (await emittedFrom(fromDoubleBits(hi))) throw new Error("seam bracket never drops the point");
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if (await emittedFrom(fromDoubleBits(mid))) lo = mid;
      else hi = mid;
    }
    return { x: fromDoubleBits(lo), z, key, stored: storedX };
  })();

  it("gives a point ON the boundary to exactly one of the two windows", async () => {
    const seam = await seamPromise;
    expect(seam.x).toBeGreaterThan(24);
    expect(seam.x).toBeLessThan(48);

    // CLIP THE BYTES YOU KEEP. The threshold the source decides on and
    // the coordinate it stores are the same number, so a downstream box
    // and the source's own window can never disagree about a point. This
    // is a claim about the source, checked where it is cheapest to check:
    // near the origin an f32 and its f64 preimage differ by a whisker, so
    // only an exact comparison sees it at all.
    expect(seam.x).toBe(seam.stored);

    const whole = await scatterOnly([0, 0], [64, 48]);
    const left = await scatterOnly([0, 0], [seam.x, 48]);
    const right = await scatterOnly([seam.x, 0], [64, 48]);

    // Non-vacuous three times over: the point exists, the lower window
    // GENERATES it (a hair wider max keeps it, so only the clip removed
    // it), and the clip alone hands it to the upper window.
    expect(pointKeys(whole, "whole")).toContain(seam.key);
    expect(pointKeys(await scatterOnly([0, 0], [nextUp(seam.x), 48]), "left+")).toContain(seam.key);
    expect(pointKeys(left, "left")).not.toContain(seam.key);
    expect(pointKeys(right, "right")).toContain(seam.key);

    // And the two windows partition the region: every point once, values
    // float-exact, nothing invented at the seam.
    expect(left.pointCount + right.pointCount).toBe(whole.pointCount);
    expect(
      formatPartitionReport(
        partitionReport([{ label: "left", geo: left }, { label: "right", geo: right }], whole, "seam"),
        "two abutting windows do not partition the region",
      ),
    ).toBeNull();
  });

  it("REDDENS on an inclusive clip, and on a gapped one", async () => {
    // The two negative controls, and the reason `duplicated` and
    // `missing` are separate fields: an inclusive max and a gapped min
    // are opposite bugs at the same boundary, and a comparison of totals
    // alone would pass on the pair of them taken together.
    const seam = await seamPromise;
    const whole = await scatterOnly([0, 0], [64, 48]);
    const left = await scatterOnly([0, 0], [seam.x, 48]);
    const right = await scatterOnly([seam.x, 0], [64, 48]);

    // Inclusive max: the lower window keeps the seam point too.
    const leftInclusive = await scatterOnly([0, 0], [nextUp(seam.x), 48]);
    expect(leftInclusive.pointCount).toBe(left.pointCount + 1);
    const duplicating = partitionReport(
      [
        { label: "left", geo: leftInclusive },
        { label: "right", geo: right },
      ],
      whole,
      "seam-inclusive",
    );
    expect(duplicating.duplicated.map((d) => d.key)).toEqual([seam.key]);
    expect(duplicating.duplicated[0].parts).toEqual(["left", "right"]);
    expect(duplicating.missing).toEqual([]);

    // Gapped min: neither window keeps it. Same size of error, opposite sign.
    const rightGapped = await scatterOnly([nextUp(seam.x), 0], [64, 48]);
    expect(rightGapped.pointCount).toBe(right.pointCount - 1);
    const dropping = partitionReport(
      [
        { label: "left", geo: left },
        { label: "right", geo: rightGapped },
      ],
      whole,
      "seam-gapped",
    );
    expect(dropping.missing).toEqual([seam.key]);
    expect(dropping.duplicated).toEqual([]);
  });

  it("makes two adjacent World cells agree on a point on their shared face", async () => {
    // The same seam, through the real runtime. The level's cellSize is
    // the seam point's own coordinate, so the plane between cells 0 and 1
    // passes exactly through it. That choice is only available because
    // the content is anchored: repartitioning the world does not move a
    // point, so a test may pick the partition to put a real point on a
    // real cell boundary.
    const seam = await seamPromise;
    const size = seam.x;
    const built = buildGraph({ kind: "world", min: [0, 0], max: [1, 1] });
    const level: LevelDef = {
      name: "ground",
      cellSize: size,
      generationRadius: size * 1.6,
      graph: built.graph,
      bind(g, ctx: CellContext) {
        if (ctx.cellMode !== "xz") throw new Error("expected an xz level");
        g.setParam(built.source, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
        g.setParam(built.source, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
        // The sanctioned route for a cell-invariant seed: `ctx.worldSeed`,
        // never the per-cell `ctx.seed`, which would make each cell an
        // unrelated world and the seam question meaningless.
        g.setParam(built.source, "seed", ctx.worldSeed);
      },
    };
    const world = new World({ seed: WORLD_SEED, levels: [level] });
    await world.update([size, 0, seam.z]);

    const cz = Math.floor(seam.z / size);
    const lower = world.getCell("ground", [0, cz]);
    const upper = world.getCell("ground", [1, cz]);
    // Both sides cooked: an agreement one party never turned up to is not
    // an agreement.
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    const lowerGeo = firstGeo(lower?.outputs.points);
    const upperGeo = firstGeo(upper?.outputs.points);

    // One cell claims the boundary point, the other declines it.
    expect(pointKeys(lowerGeo, "cell(0)")).not.toContain(seam.key);
    expect(pointKeys(upperGeo, "cell(1)")).toContain(seam.key);

    // And the pair partitions the strip they cover between them.
    const strip = await scatterOnly([0, cz * size], [2 * size, (cz + 1) * size]);
    expect(strip.pointCount).toBeGreaterThan(10);
    expect(
      formatPartitionReport(
        partitionReport(
          [
            { label: "cell(0)", geo: lowerGeo },
            { label: "cell(1)", geo: upperGeo },
          ],
          strip,
          "world-seam",
        ),
        "two adjacent cells do not partition the strip they cover",
      ),
    ).toBeNull();

    // Nothing anywhere in the cooked block is claimed twice: the seam
    // above is one boundary, and every cell in the block shares three more.
    const all = world.cells("ground").map((c) => ({
      label: c.coord.join(","),
      geo: firstGeo(c.outputs.points),
    }));
    expect(all.length).toBeGreaterThan(3);
    expect(partitionReport(all, strip, "world-block").duplicated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Ten million units from the origin

/**
 * The same three questions, asked where floating point can answer them
 * differently.
 *
 * Every fixture above lives within ±100 of the origin, where an f32 holds
 * roughly five decimal places to spare and the gap between a coordinate
 * and its stored rounding is invisible to any test that does not go
 * looking for it. That is a coverage hole shaped exactly like a bug: a
 * world does not stay near its origin, and the arithmetic changes as it
 * leaves.
 *
 * `BASE` is chosen so the change is not subtle. 2^23 <= 1e7 < 2^24, so the
 * spacing between adjacent f32 values there is EXACTLY 1 world unit — a
 * quarter of `LATTICE`, and twice `JITTER`. Rounding a position into the
 * f32 column the cloud stores it in can therefore move it by up to half a
 * unit, which is enough to carry it across a cell face and out of the
 * lattice cell that generated it. Near the origin the same rounding moves
 * a coordinate by about a hundredth of a millionth of a unit and nothing
 * downstream can tell.
 *
 * `BASE` and every tile face below are integers under 2^24, so they are
 * exactly representable in f32: the boxes themselves are not a source of
 * error, only the points.
 */
describe("far from the origin", () => {
  const BASE = 1e7;
  const TILE = 64;
  const COLS = 3;
  const ROWS = 2;

  const REGION: Box = {
    min: [BASE, BASE],
    max: [BASE + COLS * TILE, BASE + ROWS * TILE],
  };

  const tileBoxes = (): (Box & { label: string })[] => {
    const boxes: (Box & { label: string })[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const min: [number, number] = [BASE + c * TILE, BASE + r * TILE];
        boxes.push({ min, max: [min[0] + TILE, min[1] + TILE], label: `tile(${c},${r})` });
      }
    }
    return boxes;
  };

  it("stores every point inside the window it was asked for", async () => {
    // The primitive claim the node's own description makes, tested on the
    // coordinate an author can read back rather than on the one the node
    // computed internally. A point emitted for a window and stored
    // outside it is lost the moment anything downstream re-tests the box,
    // and it is lost silently — the cook succeeds and the count looks
    // plausible.
    let total = 0;
    const offenders: string[] = [];
    for (const box of tileBoxes()) {
      const geo = await scatterOnly(box.min, box.max);
      const P = geo.attrs.point.require("P");
      total += geo.pointCount;
      for (let i = 0; i < geo.pointCount; i++) {
        const x = P.get(i, 0);
        const z = P.get(i, 2);
        if (x < box.min[0] || x >= box.max[0] || z < box.min[1] || z >= box.max[1]) {
          offenders.push(`${box.label} stored (${x}, ${z}) outside [${box.min}, ${box.max})`);
        }
      }
    }
    // Non-vacuous: the tiles are populated, so "no offenders" is a
    // property of the clip and not of an empty world.
    expect(total).toBeGreaterThan(500);
    expect(offenders.slice(0, 4)).toEqual([]);
  });

  it("tiles the region with no gap and no duplicate, ten million units out", async () => {
    // The pattern `docs/authoring.md` recommends for a tiled cook, taken
    // literally: each tile queries its own box AND clips to the same box
    // half-open on the way out. The second clip is redundant only if the
    // source's clip agreed with it on the stored coordinate — when it did
    // not, this configuration silently dropped points that lay near a
    // tile face, in a way no count of any single tile would show.
    const whole = await scatterOnly(REGION.min, REGION.max);
    expect(whole.pointCount).toBeGreaterThan(500);

    const parts = [];
    for (const box of tileBoxes()) {
      parts.push({
        label: box.label,
        geo: await cookWindow(box.min, box.max, { clip: box }),
      });
    }
    for (const part of parts) expect(part.geo.pointCount).toBeGreaterThan(20);

    // `whole` has no "P0", so compare against the same chain over the
    // whole region rather than against the bare source.
    const wholeChain = await cookWindow(REGION.min, REGION.max, { clip: REGION });
    expect(wholeChain.pointCount).toBe(whole.pointCount);
    expect(
      formatPartitionReport(
        partitionReport(parts, wholeChain, "far-tiles"),
        "abutting tiles ten million units out do not partition the region",
      ),
    ).toBeNull();
  });

  it("stitches a haloed split back to the whole, ten million units out", async () => {
    // Suite 2's question at a scale where the f32 grid is coarser than
    // the jitter. Positions, survival, jitter and the neighbourhood
    // measure all have to come out bit-identical from a cell that derived
    // its own halo — including the rounding, which is now part of what a
    // window decides on rather than something applied after it.
    //
    // Stated plainly, since a test's value is what it can catch: this one
    // passes against the defect the two above catch, and it is here as a
    // companion rather than as the guard. A halo of ~4.4 units swallows a
    // half-unit rounding error whole — the point is still generated, and
    // `ownedBy` re-decides ownership on the STORED position, which is the
    // same number in both cooks. It is the UNHALOED tiling above that the
    // error reaches, which is worth knowing on its own: the pattern that
    // looked cheapest was the one that lost points.
    const FULL: ChainOptions = { filter: true, jitter: true, measure: true };
    const pieceOf = async (box: Box): Promise<Geometry> =>
      ownedBy(
        await cookWindow(
          [box.min[0] - HALO, box.min[1] - HALO],
          [box.max[0] + HALO, box.max[1] + HALO],
          FULL,
        ),
        box,
      );

    const whole = await pieceOf(REGION);
    expect(whole.pointCount).toBeGreaterThan(200);

    const parts = [];
    for (const box of tileBoxes()) parts.push({ label: box.label, geo: await pieceOf(box) });
    for (const part of parts) expect(part.geo.pointCount).toBeGreaterThan(20);

    expect(
      formatPartitionReport(
        partitionReport(parts, whole, "far-split"),
        "a haloed split ten million units out does not reproduce the region cooked whole",
      ),
    ).toBeNull();
  });
});
