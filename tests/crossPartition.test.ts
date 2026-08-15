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
 * `tests/graphs.test.ts`'s subject. These suites partition in SPACE,
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
  connectPoints,
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
import { firstGeo } from "../src/nodes/nodes.testsupport.js";
import { gatherPoints } from "../src/nodes/util.js";
import {
  edgeKeys,
  edgeMultisetDiff,
  edgeRecords,
  orientedEdgeKeys,
} from "./support/edgeMultiset.js";
import {
  formatPartitionReport,
  keyPartitionReport,
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
/**
 * Source density for the EDGE suites, and the one constant they do not
 * share with the point suites. Points scale with density; edges scale
 * with its SQUARE, because an edge needs two points to land within
 * `RADIUS` of each other — at `DENSITY` a 48-unit seam has about three
 * edges crossing it, which is not a population an agreement test can say
 * anything about. This is chosen so the probabilistic filter still halves
 * the cloud to roughly `4 * DENSITY` and every seam below carries dozens
 * of crossings.
 */
const EDGE_DENSITY = 8 * DENSITY;

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

/** How the edge network at the end of the chain is built, when there is one. */
interface EdgeOptions {
  /** `connectPoints` mode. Both are halo-exact at `haloWidth >= radius`. */
  readonly mode?: "radius" | "relativeNeighborhood";
  /**
   * Write each point's DEGREE. Legal only where every cook sees the whole
   * cloud: a point sitting in a cell's HALO has its degree truncated by
   * the halo's own edge, correctly — it is not that cell's point to
   * report on — so a partition suite that put degree in an endpoint's key
   * would be comparing two different questions.
   */
  readonly degree?: boolean;
}

interface ChainOptions {
  /** The source's density. Defaults to `DENSITY`; the edge suites raise it. */
  readonly sourceDensity?: number;
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
  /**
   * Append `connectPoints`, turning the cloud into a network. Last in the
   * chain on purpose: every point-removing node in this library rebuilds
   * the point domain and drops topology with it, so a `clip` placed after
   * this would delete exactly what the edge suites are here to compare.
   */
  readonly edges?: EdgeOptions;
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
      density: opts.sourceDensity ?? DENSITY,
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
  if (opts.edges !== undefined) {
    connect(
      g.add(
        connectPoints,
        {
          mode: opts.edges.mode ?? "radius",
          radius: RADIUS,
          degreeAttr: opts.edges.degree === true ? "degree" : "",
          lengthAttr: "edgeLength",
        },
        "edges",
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

/**
 * The half-open ownership test for `box`, as a predicate on a point index.
 * Built once per cloud rather than per point, and shared by the point clip
 * below and the PRIMITIVE-level edge clip in suite 5 — the two rules have
 * to agree on the same coordinate or a cell would own a point but not the
 * edges that point anchors.
 */
function ownershipTest(geo: Geometry, { min, max }: Box): (i: number) => boolean {
  const p0 = geo.attrs.point.require("P0");
  return (i: number): boolean => {
    const x = p0.get(i, 0);
    const z = p0.get(i, 2);
    return x >= min[0] && x < max[0] && z >= min[1] && z < max[1];
  };
}

/** Points whose PRE-JITTER position lies in [min, max) on X and Z. */
function ownedBy(geo: Geometry, box: Box): Geometry {
  const owns = ownershipTest(geo, box);
  const keep: number[] = [];
  for (let i = 0; i < geo.pointCount; i++) if (owns(i)) keep.push(i);
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

// ---------------------------------------------------------------------------
// 5. Edges: the same three questions, one domain up

/**
 * Phase 43's `connectPoints` gives a partitioned cook a SECOND thing to
 * conserve, and the four suites above cannot see it. They compare point
 * multisets; delete every edge and all four still pass. What has to
 * survive a partition now is an EDGE SET at the primitive domain, and the
 * comparator for it is `tests/support/edgeMultiset.ts` — an edge named by
 * its two endpoints' full point records, because a primitive index and a
 * point index are both facts about one cook's arrays.
 *
 * NOT a duplicate of `src/nodes/topology.test.ts`, which asks the same
 * three questions of the NODE, over hand-built lattice clouds and a
 * decimal-position edge name. These ask them of a real graph: a
 * world-anchored source, an identity-keyed probabilistic filter that
 * shifts every index, an identity-keyed jitter that moves the very
 * positions the edge test measures, `cook`, and edge names carrying every
 * point attribute float-exact. A node can be right and a chain still be
 * wrong.
 *
 * THE OWNERSHIP CLIP IS PRIMITIVE-LEVEL, AND HAS TO BE. The obvious way
 * to trim a cell's halo — append `filterByBounds` — routes through
 * `gatherPoints` and rebuilds the point domain, which drops topology
 * outright: the cell would come back with the right points and NO edges,
 * and an edge comparison against an empty set is not a test. So the clip
 * lives here, as the rule the node's own description states: a window
 * emits an edge iff the edge's FIRST vertex — `connectPoints` writes the
 * lower-keyed endpoint there — lies in the window's half-open owned
 * rectangle. One named endpoint decides, so a tiling can neither
 * double-count nor gap; the negative controls below are exactly the two
 * ways to get that wrong.
 */

/** How a window decides which of the edges it can see are ITS edges. */
type Ownership =
  /** The rule: the lower-keyed endpoint, which `connectPoints` writes first. */
  | "first"
  /** The double-emitting mistake: any endpoint inside the box. */
  | "either"
  /** The gapping mistake: every endpoint inside the box. */
  | "both";

/** The canonical keys of the edges `box` owns out of `geo`, under `rule`. */
function ownedEdgeKeys(geo: Geometry, box: Box, who: string, rule: Ownership = "first"): string[] {
  const owns = ownershipTest(geo, box);
  const keep: string[] = [];
  for (const e of edgeRecords(geo, who)) {
    const a = owns(e.firstPoint);
    const b = owns(e.secondPoint);
    const mine = rule === "first" ? a : rule === "either" ? a || b : a && b;
    if (mine) keep.push(e.key);
  }
  return keep;
}

/** Edges of `geo` with one endpoint in `a` and the other in `b`. */
function crossingEdgeKeys(geo: Geometry, who: string, a: Box, b: Box): string[] {
  const inA = ownershipTest(geo, a);
  const inB = ownershipTest(geo, b);
  return edgeRecords(geo, who)
    .filter(
      (e) => (inA(e.firstPoint) && inB(e.secondPoint)) || (inB(e.firstPoint) && inA(e.secondPoint)),
    )
    .map((e) => e.key);
}

/**
 * Edges `outer` owns that are not wholly inside `a` or wholly inside `b` —
 * exactly what a "both endpoints" ownership rule over that pair of boxes
 * would drop. Wider than {@link crossingEdgeKeys} by the edges that reach
 * out of `outer` altogether, which the network genuinely holds and which
 * no window would then claim either.
 */
function unpairedEdgeKeys(geo: Geometry, who: string, outer: Box, a: Box, b: Box): string[] {
  const inOuter = ownershipTest(geo, outer);
  const inA = ownershipTest(geo, a);
  const inB = ownershipTest(geo, b);
  return edgeRecords(geo, who)
    .filter(
      (e) =>
        inOuter(e.firstPoint) &&
        !((inA(e.firstPoint) && inA(e.secondPoint)) || (inB(e.firstPoint) && inB(e.secondPoint))),
    )
    .map((e) => e.key);
}

/** Cook `box` widened by `halo` on every side. */
const edgeWindow = (box: Box, halo: number, opts: ChainOptions): Promise<Geometry> =>
  cookWindow([box.min[0] - halo, box.min[1] - halo], [box.max[0] + halo, box.max[1] + halo], opts);

/** The chain the edge suites cook, with and without the jitter. */
const edgeChain = (mode: "radius" | "relativeNeighborhood", jitter: boolean): ChainOptions => ({
  sourceDensity: EDGE_DENSITY,
  filter: true,
  jitter,
  edges: { mode },
});

const EDGE_MODES = ["radius", "relativeNeighborhood"] as const;

// ---------------------------------------------------------------------------

describe("edge permutation equivariance", () => {
  // Cooked once and permuted by every test. Tagged, so an endpoint's key
  // carries the point's ORIGINAL slot: an edge that quietly re-attached
  // itself to a different point would still be an edge of the same length
  // between the same coordinates, and only the tag would notice.
  const basePromise = cookWindow([0, 0], [32, 32], { sourceDensity: EDGE_DENSITY }).then(tagged);

  /** The chain plus edges, over a permutation of the base cloud. */
  const connected = async (geo: Geometry, order?: Uint32Array): Promise<Geometry> =>
    cookPoints(
      buildGraph(
        { kind: "items", geo: order === undefined ? geo : gatherPoints(geo, order) },
        { filter: true, jitter: true, edges: { degree: true } },
      ),
    );

  // One straight cook and one shuffled cook, shared by both tests: the
  // positive claim and its negative control are two readings of the SAME
  // pair of outputs, which is also the cheapest way to run them.
  const pairPromise = (async (): Promise<{ straight: Geometry; shuffled: Geometry }> => {
    const base = await basePromise;
    const order = shuffleOrder(base.pointCount, 3607);
    return { straight: await connected(base), shuffled: await connected(base, order) };
  })();

  it("emits the same edges in the same SEQUENCE, orientation included", async () => {
    // The strongest form available, and it is available because
    // `connectPoints` orders edges by a key made of the POINTS (identity,
    // then position bits, then seed) rather than by the order its scan
    // reached them: a shuffle may not merely permute the output, it must
    // leave it alone. Degrees are in the key too — every cook here sees
    // the whole cloud, so a truncated degree would be a real error.
    const { straight, shuffled } = await pairPromise;

    // Non-vacuous: there is a network, and it is not a handful of edges.
    expect(straight.primitiveCount).toBeGreaterThan(200);
    expect(shuffled.primitiveCount).toBe(straight.primitiveCount);

    expect(orientedEdgeKeys(shuffled, "shuffled")).toEqual(orientedEdgeKeys(straight, "straight"));

    // ...and the input really was reordered: the stored index pairs moved,
    // so the sequence above held still across a genuine relabelling.
    const pairs = (geo: Geometry, who: string): string[] =>
      edgeRecords(geo, who).map((e) => `${e.firstPoint}-${e.secondPoint}`);
    expect(pairs(shuffled, "shuffled")).not.toEqual(pairs(straight, "straight"));
  });

  it("REDDENS when the edge order is keyed on the array index", async () => {
    // The negative control for the sequence claim above, and the one
    // mutation a SET comparison provably cannot catch: reordering the
    // output leaves the edge set untouched. Both halves are asserted.
    const { straight, shuffled } = await pairPromise;

    // The set survives the mutation — so `edgeMultisetDiff` stays null,
    // and the strong assertion above is the only thing standing here.
    expect(edgeMultisetDiff(straight, shuffled, "straight", "shuffled")).toBeNull();

    // The sequence does not. This is the output an index-keyed sort would
    // have produced: the same edges, ordered by their endpoints' slots in
    // the array instead of by the points themselves.
    const byArrayIndex = (geo: Geometry, who: string): string[] =>
      [...edgeRecords(geo, who)]
        .sort(
          (p, q) =>
            Math.min(p.firstPoint, p.secondPoint) - Math.min(q.firstPoint, q.secondPoint) ||
            Math.max(p.firstPoint, p.secondPoint) - Math.max(q.firstPoint, q.secondPoint),
        )
        .map((e) => e.key);
    expect(byArrayIndex(shuffled, "shuffled")).not.toEqual(byArrayIndex(straight, "straight"));
  });
});

// ---------------------------------------------------------------------------

describe("edges: split with halo equals whole", () => {
  const REGION: Box = { min: [0, 0], max: [32, 32] };
  const SPLIT = 16;

  const cellBoxes = (): (Box & { label: string })[] => {
    const boxes: (Box & { label: string })[] = [];
    for (let cz = REGION.min[1]; cz < REGION.max[1]; cz += SPLIT) {
      for (let cx = REGION.min[0]; cx < REGION.max[0]; cx += SPLIT) {
        boxes.push({ min: [cx, cz], max: [cx + SPLIT, cz + SPLIT], label: `cell(${cx},${cz})` });
      }
    }
    return boxes;
  };

  /** Cook `box` with `halo`, keep the edges `box` owns. */
  const pieceOf = async (
    box: Box,
    halo: number,
    opts: ChainOptions,
    label: string,
    rule: Ownership = "first",
  ): Promise<string[]> => ownedEdgeKeys(await edgeWindow(box, halo, opts), box, label, rule);

  for (const mode of EDGE_MODES) {
    it(`is exact at haloWidth == radius (${mode})`, async () => {
      // THE BOUND ITSELF, at equality and not one unit clear of it. With
      // the jitter out of the chain a point's ownership coordinate IS the
      // position the distance test reads, so `haloWidth == RADIUS` is
      // exactly `connectPoints`'s documented contract with no slack hiding
      // an off-by-one: an owned `A` sits in [min, max), a neighbour is
      // STRICTLY within RADIUS of it, so it lands strictly inside
      // [min - RADIUS, max + RADIUS) and the half-open halo cannot cut it.
      //
      // `relativeNeighborhood` is here on the same bound and not a wider
      // one because its lune witness is closer to `A` than `B` is, hence
      // inside `A`'s own radius neighbourhood — the mode thins the network
      // without widening what a cell has to see.
      const opts = edgeChain(mode, false);
      const whole = await pieceOf(REGION, RADIUS, opts, "whole");
      expect(whole.length).toBeGreaterThan(100);

      const boxes = cellBoxes();
      expect(boxes.length).toBe(4);
      const parts = [];
      for (const box of boxes) {
        parts.push({ label: box.label, keys: await pieceOf(box, RADIUS, opts, box.label) });
      }
      for (const part of parts) expect(part.keys.length).toBeGreaterThan(20);

      expect(
        formatPartitionReport(
          keyPartitionReport(parts, whole),
          `the cells do not reproduce the ${mode} network cooked whole`,
          "edge",
        ),
      ).toBeNull();
    });

    it(`stitches back through the jitter, on the suite's halo (${mode})`, async () => {
      // The same question over the chain the point suites cook, so the two
      // compose rather than each carrying its own convention. `HALO` is
      // `RADIUS` plus the widest a pair of jitters can pull two points
      // together (2 * JITTER * sqrt(2) of distance, and 2 * JITTER on any
      // one axis), which is what ownership deciding on P0 while the
      // distance test reads the jittered P costs.
      const opts = edgeChain(mode, true);
      const whole = await pieceOf(REGION, HALO, opts, "whole");
      expect(whole.length).toBeGreaterThan(100);

      const parts = [];
      for (const box of cellBoxes()) {
        parts.push({ label: box.label, keys: await pieceOf(box, HALO, opts, box.label) });
      }
      for (const part of parts) expect(part.keys.length).toBeGreaterThan(20);

      expect(
        formatPartitionReport(
          keyPartitionReport(parts, whole),
          `a jittered ${mode} split does not reproduce the region cooked whole`,
          "edge",
        ),
      ).toBeNull();
    });

    it(`REDDENS on a halo narrower than the radius (${mode})`, async () => {
      // The negative control, and the reason the bound above is a claim
      // rather than a coincidence. Positions, survival and the jitter are
      // all pure functions of world coordinates, so a narrow halo leaves
      // every OWNED POINT exactly where it was — the point suites' own
      // question stays green — and takes away only the neighbours a cell
      // needed to see. Edges near a seam simply stop existing, which is
      // invisible to every comparator this file had before phase 43.
      //
      // A THIRD of the radius rather than one unit under it, because the
      // two modes have very different margins here and the control has to
      // bite in both. Measured: at `RADIUS - 1` the radius network loses
      // 13 edges and the relative-neighbourhood one loses 1 — the lune
      // test throws away exactly the LONG pairs, which are the pairs a
      // narrow halo can cut, so its surviving edges are short and hard to
      // reach. One is a real catch and not a flaky one (every fixture
      // here is seeded), but it is too thin a margin to keep as the
      // standing guard.
      const opts = edgeChain(mode, false);
      const whole = await pieceOf(REGION, RADIUS, opts, "whole");
      const parts = [];
      for (const box of cellBoxes()) {
        parts.push({ label: box.label, keys: await pieceOf(box, RADIUS / 3, opts, box.label) });
      }

      const report = keyPartitionReport(parts, whole);
      expect(report.missing.length).toBeGreaterThan(5);
      expect(report.duplicated).toEqual([]);
      expect(
        formatPartitionReport(report, "a narrow halo should not reproduce the whole", "edge"),
      ).not.toBeNull();
    });
  }

  it("holds no pair at exactly the radius, so STRICTNESS is out of this file's reach", async () => {
    // The mutation these suites CANNOT catch, measured rather than argued,
    // because "no test here covers that" is a claim that rots silently.
    //
    // An inclusive `d <= radius` test differs from the strict one on
    // exactly one population: pairs at EXACTLY the radius. Over a jittered
    // f32 cloud that population is empty, so swapping the predicate is a
    // no-op on every fixture in this file and no partition report here can
    // redden. It is pinned where the pair can be placed by construction —
    // `src/nodes/topology.test.ts`, "the STRICT predicate, and what it
    // buys", which builds the knife-edge pair and the window that cuts it.
    // (PLAN records the same conclusion from the other direction: under
    // half-open ownership the two half-open rules cancel, so even a
    // knife-edge pair does not break a partition. Strict ships because it
    // survives an ownership rule CLOSED at the max face, which is not a
    // configuration this file cooks.)
    const geo = await edgeWindow(REGION, RADIUS, edgeChain("radius", true));
    const P = geo.attrs.point.require("P");
    const limit = RADIUS * RADIUS;
    let near = 0;
    let onTheKnife = 0;
    for (let i = 0; i < geo.pointCount; i++) {
      const x = P.get(i, 0);
      const y = P.get(i, 1);
      const z = P.get(i, 2);
      for (let j = i + 1; j < geo.pointCount; j++) {
        const dx = P.get(j, 0) - x;
        const dy = P.get(j, 1) - y;
        const dz = P.get(j, 2) - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 4 * limit) near++;
        if (d2 === limit) onTheKnife++;
      }
    }
    // Non-vacuous: thousands of pairs were in a position to land on it.
    expect(near).toBeGreaterThan(1000);
    expect(onTheKnife).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("edges: two-cell seam agreement", () => {
  const STRIP: Box = { min: [0, 0], max: [32, 32] };
  const SEAM = 16;
  const LEFT: Box = { min: [0, 0], max: [SEAM, 32] };
  const RIGHT: Box = { min: [SEAM, 0], max: [32, 32] };
  const CHAIN = edgeChain("radius", true);

  // Three cooks, shared by every test here: the strip whole, and each side
  // of the seam deriving its own halo from world coordinates.
  const seamPromise = (async (): Promise<{
    whole: Geometry;
    left: Geometry;
    right: Geometry;
    crossing: string[];
    unpaired: string[];
  }> => {
    const whole = await edgeWindow(STRIP, HALO, CHAIN);
    return {
      whole,
      left: await edgeWindow(LEFT, HALO, CHAIN),
      right: await edgeWindow(RIGHT, HALO, CHAIN),
      crossing: crossingEdgeKeys(whole, "strip", LEFT, RIGHT),
      unpaired: unpairedEdgeKeys(whole, "strip", STRIP, LEFT, RIGHT),
    };
  })();

  it("emits every edge across the boundary exactly once", async () => {
    const { whole, left, right, crossing } = await seamPromise;
    const wholeKeys = ownedEdgeKeys(whole, STRIP, "strip");
    expect(wholeKeys.length).toBeGreaterThan(200);

    // Non-vacuous, and this is the whole point of the suite: dozens of
    // edges have one end on each side of the seam, so both windows can
    // SEE them and only the ownership rule decides.
    expect(crossing.length).toBeGreaterThan(20);
    expect(new Set(crossing).size).toBe(crossing.length);

    expect(
      formatPartitionReport(
        keyPartitionReport(
          [
            { label: "left", keys: ownedEdgeKeys(left, LEFT, "left") },
            { label: "right", keys: ownedEdgeKeys(right, RIGHT, "right") },
          ],
          wholeKeys,
        ),
        "two abutting windows do not partition the network",
        "edge",
      ),
    ).toBeNull();
  });

  it("REDDENS on an either-endpoint rule, and on a both-endpoints one", async () => {
    // The two ways to get a primitive-level clip wrong, and they are
    // opposite bugs: `either` emits every seam-crossing edge from BOTH
    // sides, `both` emits it from NEITHER, and a comparison of totals
    // would pass on the pair of them applied together. That is why the
    // report separates `duplicated` from `missing`, and why the rule
    // names ONE endpoint rather than testing the pair.
    //
    // Each mistake is identified exactly, not merely detected: the
    // duplicates ARE the crossing edges, and the gaps are every edge not
    // wholly inside one side — which is the crossing edges plus the ones
    // reaching out of the strip, since `both` refuses those too.
    const { whole, left, right, crossing, unpaired } = await seamPromise;
    const wholeKeys = ownedEdgeKeys(whole, STRIP, "strip");

    const doubled = keyPartitionReport(
      [
        { label: "left", keys: ownedEdgeKeys(left, LEFT, "left", "either") },
        { label: "right", keys: ownedEdgeKeys(right, RIGHT, "right", "either") },
      ],
      wholeKeys,
    );
    expect(doubled.duplicated.map((d) => d.key).sort()).toEqual([...crossing].sort());
    expect(doubled.duplicated[0].parts).toEqual(["left", "right"]);
    expect(doubled.missing).toEqual([]);

    const gapped = keyPartitionReport(
      [
        { label: "left", keys: ownedEdgeKeys(left, LEFT, "left", "both") },
        { label: "right", keys: ownedEdgeKeys(right, RIGHT, "right", "both") },
      ],
      wholeKeys,
    );
    expect(new Set(unpaired).size).toBe(unpaired.length);
    expect(unpaired.length).toBeGreaterThanOrEqual(crossing.length);
    expect([...gapped.missing].sort()).toEqual([...unpaired].sort());
    expect(gapped.duplicated).toEqual([]);
  });

  it("measures the edges the two sides SHARE identically, not merely alike", async () => {
    // The seam's other half. Agreement about WHICH edges exist is only
    // part of it: each window's halo reaches RADIUS past the seam, so a
    // band that wide is built by both, and an edge's key carries its
    // length and both endpoints' every attribute — a value that moved by
    // an ulp in one window is a DIFFERENT edge here, not a near miss.
    const { left, right } = await seamPromise;
    const shared = new Set(edgeKeys(left, "left"));
    const both = edgeKeys(right, "right").filter((k) => shared.has(k));
    expect(both.length).toBeGreaterThan(20);
  });
});
