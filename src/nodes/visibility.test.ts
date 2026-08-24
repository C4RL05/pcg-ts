/**
 * occlusionCull: the fan, the push-then-drop escalation, and the two
 * properties the node's description promises and nothing else can check —
 * that its answer is a function of the POINTS rather than of the array they
 * arrived in, and that a degenerate box is read as no box rather than as a
 * unit one.
 *
 * THE GEOMETRY IS PINNED SEPARATELY FROM THE RULE, the way
 * `tests/racetrackSightline.test.ts` pins the slab test apart from the cull
 * that uses it: every fixture here is a straight run along +Z with the eyes
 * on the plane x = 0, so which boxes reach a chord is arithmetic anyone can
 * redo on paper rather than a number that came out of a cook.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud, setPolylineTopology, type Geometry } from "../data/index.js";
import { attribute } from "../fields/index.js";
import { makeGeometryItem } from "../graph/index.js";
import { hashCombine, hashFloat } from "../random/index.js";
import { occlusionCull, type OcclusionCullParams } from "./visibility.js";
import {
  firstGeo,
  permutePoints,
  pointRecords,
  positionsOf,
  runNode,
  shuffledOrder,
} from "./nodes.testsupport.js";

/** A point cloud at the given positions, with the standard attributes. */
function cloudAt(positions: number[][]): Geometry {
  const geo = createPointCloud(positions.length);
  const P = geo.attrs.point.require("P");
  positions.forEach((p, i) => P.setTuple(i, p));
  return geo;
}

/**
 * `cloudAt` plus a genuine per-point `seed`, which is half of a point's
 * identity: a cloud straight out of createPointCloud has every seed at 0
 * and rests its identity on position alone.
 */
function seededCloudAt(positions: number[][]): Geometry {
  const geo = cloudAt(positions);
  const seed = geo.attrs.point.require("seed");
  for (let i = 0; i < positions.length; i++) seed.set(i, hashCombine(0x5eed, i));
  return geo;
}

/** Boxes: a seeded cloud whose `scale` column carries one full size per point. */
function boxesAt(positions: number[][], sizes: number[][]): Geometry {
  const geo = seededCloudAt(positions);
  const scale = geo.attrs.point.require("scale");
  sizes.forEach((s, i) => scale.setTuple(i, s));
  return geo;
}

/** The sight input: an open polyline up the +Z axis at x = 0, y = 0. */
function sightPath(zs: number[]): Geometry {
  const geo = cloudAt(zs.map((z) => [0, 0, z]));
  setPolylineTopology(
    geo,
    zs.map((_, i) => i),
    [0],
    [zs.length],
  );
  return geo;
}

/** Eleven eyes every 2 units, the fixture most cases here run against. */
function denseRun(): Geometry {
  return sightPath([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
}

/** Cook the node over one box cloud and one sight geometry. */
async function cull(
  boxes: Geometry,
  sight: Geometry,
  params: Partial<OcclusionCullParams> = {},
): Promise<Geometry> {
  const out = await runNode(
    occlusionCull,
    { eyeOffset: [0, 1, 0], ...params },
    { in: [makeGeometryItem(boxes)], sight: [makeGeometryItem(sight)] },
  );
  return firstGeo(out.out);
}

/** The refusal `cull` raises, as a string. */
async function refusal(
  boxes: Geometry | undefined,
  sight: Geometry | undefined,
  params: Partial<OcclusionCullParams> = {},
): Promise<string> {
  const inputs: Record<string, ReturnType<typeof makeGeometryItem>[]> = {};
  if (boxes) inputs.in = [makeGeometryItem(boxes)];
  if (sight) inputs.sight = [makeGeometryItem(sight)];
  try {
    await runNode(occlusionCull, { eyeOffset: [0, 1, 0], ...params }, inputs);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected occlusionCull to refuse this input, but it cooked");
}

describe("occlusionCull: what blocks and what does not", () => {
  /**
   * The two boxes are identical in every way except x: one stands on the
   * line of sight and one stands ten units off it. Anything that culled
   * both, or neither, would be reading something other than where they are.
   */
  it("drops a box on the sight line and keeps one beside it", async () => {
    const boxes = boxesAt(
      [
        [0, 0.5, 5],
        [10, 0.5, 5],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    const out = await cull(boxes, denseRun());
    expect(positionsOf(out)).toEqual([[10, 0.5, 5]]);
  });

  /**
   * THE FAN, and the reason `samples` is not a performance knob.
   *
   * One eye at the start of a 20-unit run. The box sits low at z = 3: the
   * chord to the far end of the look-ahead passes well above it (y = 0.75
   * there), while the chord to arc 3 dives through it (y = 0.167 at the
   * box's near face). With samples 1 only the far chord exists and the box
   * survives; with the default 8 it is found.
   */
  it("finds a box that hides between the eye and the far end of the look-ahead", async () => {
    const boxes = boxesAt([[0, 0.1, 3]], [[2, 0.4, 1]]);
    const run = sightPath([0, 20]);
    expect((await cull(boxes, run, { samples: 1 })).pointCount).toBe(1);
    expect((await cull(boxes, run, { samples: 8 })).pointCount).toBe(0);
  });

  /**
   * The box is tested in ITS OWN frame. Same centre, same extents: a slab
   * 0.2 wide and 8 long, standing two units off the line. Left alone it is
   * a fence post beside the road; turned a quarter turn it is a barrier
   * across it.
   */
  it("reads the box's own axes rather than its world-aligned hull", async () => {
    const half = Math.SQRT1_2;
    const upright = boxesAt([[2, 0.5, 5]], [[0.2, 4, 8]]);
    const turned = boxesAt([[2, 0.5, 5]], [[0.2, 4, 8]]);
    // A quarter turn about +Y: the slab's long local +Z lies along world +X.
    turned.attrs.point.require("rot").setTuple(0, [0, half, 0, half]);
    expect((await cull(upright, denseRun())).pointCount).toBe(1);
    expect((await cull(turned, denseRun())).pointCount).toBe(0);
  });

  /** No eye means no line of sight, and a run of one point is not a run. */
  it("keeps everything when the sight input defines no line", async () => {
    const boxes = boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    expect((await cull(boxes, cloudAt([[0, 0, 0]]))).pointCount).toBe(1);
    expect((await cull(boxes, cloudAt([]))).pointCount).toBe(1);
  });

  /** An empty cloud is an empty result, not a failure. */
  it("cooks an empty input to an empty cloud", async () => {
    const out = await cull(createPointCloud(0), denseRun());
    expect(out.pointCount).toBe(0);
    expect(out.attrs.point.names()).toContain("P");
  });

  /** A bare point cloud on the sight pin is read in point order. */
  it("reads a sight input with no primitives as one run through its points", async () => {
    const boxes = boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    const loose = cloudAt([
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, 20],
    ]);
    expect((await cull(boxes, loose)).pointCount).toBe(0);
  });
});

describe("occlusionCull: degenerate boxes", () => {
  /**
   * The same point three ways. It blocks with a real size; it blocks
   * nothing with a zero size; and it blocks nothing with no `scale` column
   * at all — which is the reading the node's description argues for, since
   * assuming a unit box would delete a point on the strength of a size
   * nobody wrote.
   */
  it("treats a zero extent, and a missing scale column, as no box", async () => {
    const sized = boxesAt([[0.5, 0.5, 5]], [[2, 2, 2]]);
    expect((await cull(sized, denseRun())).pointCount).toBe(0);

    const flat = boxesAt([[0.5, 0.5, 5]], [[0, 0, 0]]);
    expect((await cull(flat, denseRun())).pointCount).toBe(1);

    const unsized = boxesAt([[0.5, 0.5, 5]], [[2, 2, 2]]);
    unsized.attrs.point.remove("scale");
    expect((await cull(unsized, denseRun())).pointCount).toBe(1);
  });

  /** A missing `rot` column is the identity rotation, not a refusal. */
  it("treats a missing rot column as an unrotated box", async () => {
    const boxes = boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    boxes.attrs.point.remove("rot");
    expect((await cull(boxes, denseRun())).pointCount).toBe(0);
  });

  /** An unnormalized quaternion means the rotation it points at. */
  it("normalizes rot rather than reading it as a scaled basis", async () => {
    const boxes = boxesAt([[2, 0.5, 5]], [[0.2, 4, 8]]);
    // The same quarter turn about +Y as above, at four times the length.
    boxes.attrs.point.require("rot").setTuple(0, [0, 4 * Math.SQRT1_2, 0, 4 * Math.SQRT1_2]);
    expect((await cull(boxes, denseRun())).pointCount).toBe(0);
  });

  /** A zero quaternion has no rotation in it and falls back to identity. */
  it("falls back to identity for an all-zero quaternion", async () => {
    const boxes = boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    boxes.attrs.point.require("rot").setTuple(0, [0, 0, 0, 0]);
    expect((await cull(boxes, denseRun())).pointCount).toBe(0);
  });
});

describe("occlusionCull: push before drop", () => {
  /**
   * The escalation, in three cooks over ONE fixture. With no allowance the
   * blocker is dropped and the population falls to one; with two steps'
   * worth it moves aside and the population is still two, which is the
   * whole reason the push exists. The middle case is the one that proves
   * the search is a search: one step is not enough to clear the box (its
   * far face still reaches the sight plane) so the point is dropped anyway.
   */
  it("pushes when it can, drops when it cannot, and a push keeps the count", async () => {
    const fixture = (): Geometry =>
      boxesAt(
        [
          [0, 0.5, 5],
          [10, 0.5, 5],
        ],
        [
          [2, 2, 2],
          [2, 2, 2],
        ],
      );
    const dropped = await cull(fixture(), denseRun(), { pushMax: 0 });
    expect(dropped.pointCount).toBe(1);

    const tooShort = await cull(fixture(), denseRun(), { pushMax: 1, pushStep: 1 });
    expect(tooShort.pointCount).toBe(1);
    expect(positionsOf(tooShort)).toEqual([[10, 0.5, 5]]);

    const pushed = await cull(fixture(), denseRun(), { pushMax: 6, pushStep: 1 });
    expect(pushed.pointCount).toBe(2);
    expect(positionsOf(pushed)).toEqual([
      [2, 0.5, 5],
      [10, 0.5, 5],
    ]);
  });

  /**
   * The search stops at the FIRST rung that clears, so a finer step lands
   * the point closer to where it started. Nothing else about the cook
   * changes.
   */
  it("moves a point the least it can rather than the most it may", async () => {
    const boxes = (): Geometry => boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    const coarse = await cull(boxes(), denseRun(), { pushMax: 6, pushStep: 1 });
    const fine = await cull(boxes(), denseRun(), { pushMax: 6, pushStep: 0.25 });
    expect(positionsOf(coarse)[0][0]).toBe(2);
    expect(positionsOf(fine)[0][0]).toBe(1.25);
  });

  /**
   * The sign is the node's to choose, and it chooses AWAY from the path.
   * Two identical blockers either side of the line come out either side of
   * it, from one axis and no per-point sign.
   */
  it("pushes away from the nearest eye, on both sides of the path", async () => {
    const boxes = boxesAt(
      [
        [0.4, 0.5, 5],
        [-0.4, 0.5, 15],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    const out = await cull(boxes, denseRun(), { pushMax: 6, pushStep: 1 });
    const xs = positionsOf(out).map((p) => p[0]);
    expect(xs[0]).toBeGreaterThan(0.4);
    expect(xs[1]).toBeLessThan(-0.4);
  });

  /** A point with no direction to move in is dropped the moment it blocks. */
  it("drops a point whose push axis is zero", async () => {
    const boxes = boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);
    const out = await cull(boxes, denseRun(), {
      pushMax: 6,
      pushStep: 1,
      pushAxis: [0, 0, 0],
    });
    expect(out.pointCount).toBe(0);
  });

  /**
   * `pushClearance` is what stops a cull from making a heap. Four blockers
   * along the run, all shoved the same way: with no clearance they settle
   * at the same offset, with one they have to keep climbing past each
   * other.
   */
  it("makes a pushed point find room among the points already settled", async () => {
    const positions = [
      [0, 0.5, 4],
      [0, 0.5, 4.6],
      [0, 0.5, 5.2],
      [0, 0.5, 5.8],
    ];
    const sizes = positions.map(() => [2, 2, 2]);
    const packed = await cull(boxesAt(positions, sizes), denseRun(), {
      pushMax: 12,
      pushStep: 1,
    });
    const spread = await cull(boxesAt(positions, sizes), denseRun(), {
      pushMax: 12,
      pushStep: 1,
      pushClearance: 2.5,
    });
    expect(packed.pointCount).toBe(4);
    expect(spread.pointCount).toBe(4);
    const packedXs = new Set(positionsOf(packed).map((p) => p[0]));
    const spreadXs = positionsOf(spread).map((p) => p[0]);
    // Every blocker lands on the same rung without a clearance...
    expect(packedXs.size).toBe(1);
    // ...and no two land within the clearance of each other with one.
    for (let i = 0; i < spreadXs.length; i++) {
      for (let j = i + 1; j < spreadXs.length; j++) {
        const dz = positionsOf(spread)[i][2] - positionsOf(spread)[j][2];
        const dx = spreadXs[i] - spreadXs[j];
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(2.5);
      }
    }
  });
});

describe("occlusionCull: field-capable params", () => {
  /**
   * A per-point `pushMax` IS the "drop rather than move" exception: the
   * first blocker carries an allowance and steps aside, the second carries
   * zero and is removed, from one cook and one param.
   */
  it("reads pushMax per point, so 0 means this one may not move", async () => {
    const boxes = boxesAt(
      [
        [0, 0.5, 5],
        [0, 0.5, 15],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    const allow = boxes.attrs.point.add("allow", "f32", 1, 0);
    allow.set(0, 6);
    allow.set(1, 0);
    const out = await cull(boxes, denseRun(), {
      pushMax: attribute("allow"),
      pushStep: 1,
    });
    expect(positionsOf(out)).toEqual([[2, 0.5, 5]]);
  });

  /**
   * A per-point `pushAxis` is the form the param is really for — and the
   * second blocker shows the sign rule from the other side: told to move
   * vertically, it goes DOWN, because the eyes are a unit above the path
   * and down is where "away from the nearest eye" points. The author
   * chooses the axis; the node chooses which end of it.
   */
  it("reads pushAxis per point, so each blocker moves the way it was told", async () => {
    const boxes = boxesAt(
      [
        [0, 0.5, 5],
        [0, 0.5, 15],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    const push = boxes.attrs.point.add("push", "f32", 3, [0, 0, 0]);
    push.setTuple(0, [1, 0, 0]);
    push.setTuple(1, [0, 1, 0]);
    const out = await cull(boxes, denseRun(), {
      pushMax: 6,
      pushStep: 1,
      pushAxis: attribute("push"),
    });
    expect(positionsOf(out)).toEqual([
      [2, 0.5, 5],
      [0, -1.5, 15],
    ]);
  });

  /** A per-eye `lookAhead` is read on the SIGHT input's points. */
  it("reads lookAhead per eye, on the sight input's own domain", async () => {
    const boxes = boxesAt([[0, 0.1, 3]], [[2, 0.4, 1]]);
    const run = sightPath([0, 20]);
    const reach = run.attrs.point.add("reach", "f32", 1, 0);
    reach.set(0, 12);
    reach.set(1, 12);
    expect((await cull(boxes, run, { lookAhead: attribute("reach") })).pointCount).toBe(0);
    // The same graph with the near eye blinded: nothing reaches the box.
    reach.set(0, 0);
    expect((await cull(boxes, run, { lookAhead: attribute("reach") })).pointCount).toBe(1);
  });
});

describe("occlusionCull: determinism", () => {
  /**
   * A deterministic scatter through the corridor, thick enough that the
   * cull has real work to do — some blockers clear by pushing, some do not,
   * and with a clearance set the pushed ones have to settle around each
   * other, which is what makes the visit order matter at all. The WIDTHS
   * vary on purpose: with one size and a generous allowance every blocker
   * clears, and a fixture where nothing is ever dropped tests only half the
   * node.
   */
  function corridorBoxes(seed: number, count = 40): Geometry {
    const positions = Array.from({ length: count }, (_, i) => [
      hashFloat(hashCombine(seed, i, 0)) * 6 - 3,
      0.5,
      hashFloat(hashCombine(seed, i, 1)) * 20,
    ]);
    return boxesAt(
      positions,
      positions.map((_, i) => [1 + 5 * hashFloat(hashCombine(seed, i, 2)), 2, 1]),
    );
  }

  const GREEDY: Partial<OcclusionCullParams> = {
    pushMax: 2,
    pushStep: 0.5,
    pushClearance: 1.5,
  };

  /**
   * THE PROPERTY THIS NODE EXISTS TO KEEP. Shuffle the input and the same
   * points come back, at the same places — not the same COUNT, which a
   * broken cull could match by accident, but the same multiset of full
   * point records.
   */
  it("returns the identical survivor set whatever order the points arrive in", async () => {
    const cloud = corridorBoxes(7);
    const straight = await cull(cloud, denseRun(), GREEDY);
    for (const seed of [1, 2, 3]) {
      const shuffled = permutePoints(cloud, shuffledOrder(cloud.pointCount, seed));
      const out = await cull(shuffled, denseRun(), GREEDY);
      expect(pointRecords(out).sort()).toEqual(pointRecords(straight).sort());
    }
  });

  /**
   * AND IT MUST NOT PASS VACUOUSLY. A cull that never fired, or one that
   * never moved anything, would satisfy the shuffle test trivially — the
   * same failure the racetrack's own corridor rule had, where a rule that
   * could not fire passed every assertion it had.
   */
  it("actually drops and actually moves points in that fixture", async () => {
    const cloud = corridorBoxes(7);
    const before = positionsOf(cloud);
    const out = await cull(cloud, denseRun(), GREEDY);
    expect(out.pointCount).toBeGreaterThan(0);
    expect(out.pointCount).toBeLessThan(cloud.pointCount);
    const startX = new Set(before.map((p) => `${p[0]},${p[2]}`));
    const moved = positionsOf(out).filter((p) => !startX.has(`${p[0]},${p[2]}`));
    expect(moved.length).toBeGreaterThan(0);
  });

  /** Order independence holds on the non-greedy path too. */
  it("is order independent with no clearance, where nothing chains", async () => {
    const cloud = corridorBoxes(11, 24);
    const straight = await cull(cloud, denseRun(), { pushMax: 5, pushStep: 0.5 });
    const shuffled = permutePoints(cloud, shuffledOrder(cloud.pointCount, 5));
    const out = await cull(shuffled, denseRun(), { pushMax: 5, pushStep: 0.5 });
    expect(pointRecords(out).sort()).toEqual(pointRecords(straight).sort());
  });

  /** Survivors come out in ascending INPUT index order, never visit order. */
  it("emits survivors in input order", async () => {
    const boxes = boxesAt(
      [
        [8, 0.5, 2],
        [0, 0.5, 5],
        [9, 0.5, 12],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    const out = await cull(boxes, denseRun());
    expect(positionsOf(out)).toEqual([
      [8, 0.5, 2],
      [9, 0.5, 12],
    ]);
  });

  /** The input's topology does not survive: this node moves points. */
  it("outputs a point cloud and keeps no primitives", async () => {
    const boxes = boxesAt(
      [
        [8, 0.5, 2],
        [9, 0.5, 12],
      ],
      [
        [2, 2, 2],
        [2, 2, 2],
      ],
    );
    setPolylineTopology(boxes, [0, 1], [0], [2]);
    const out = await cull(boxes, denseRun());
    expect(out.pointCount).toBe(2);
    expect(out.primitiveCount).toBe(0);
  });
});

describe("occlusionCull: refusals", () => {
  const boxes = (): Geometry => boxesAt([[0, 0.5, 5]], [[2, 2, 2]]);

  it("names the pin when no boxes are connected", async () => {
    expect(await refusal(undefined, denseRun())).toContain(
      'occlusionCull: input pin "in" has no geometry connected',
    );
  });

  it("names the pin when no sight geometry is connected", async () => {
    expect(await refusal(boxes(), undefined)).toContain(
      'occlusionCull: input pin "sight" has no geometry connected',
    );
  });

  it("refuses a push search that cannot advance", async () => {
    const message = await refusal(boxes(), denseRun(), { pushStep: 0 });
    expect(message).toContain("occlusionCull: pushStep must be greater than 0, got 0");
    expect(message).toContain("set pushMax to 0");
  });

  it("refuses a fan that is not a fan", async () => {
    expect(await refusal(boxes(), denseRun(), { samples: 0 })).toContain(
      "occlusionCull: samples must be an integer of at least 1, got 0",
    );
    expect(await refusal(boxes(), denseRun(), { samples: 1.5 })).toContain(
      "occlusionCull: samples must be an integer of at least 1, got 1.5",
    );
  });

  it("refuses a rot column of the wrong shape", async () => {
    const cloud = boxes();
    cloud.attrs.point.remove("rot");
    cloud.attrs.point.add("rot", "f32", 3, [0, 0, 0]);
    const message = await refusal(cloud, denseRun());
    expect(message).toContain('occlusionCull: point attribute "rot" is f32x3');
    expect(message).toContain("a quaternion (f32, tupleSize 4)");
  });

  it("refuses a scale column of the wrong shape", async () => {
    const cloud = boxes();
    cloud.attrs.point.remove("scale");
    cloud.attrs.point.add("scale", "f32", 4, [1, 1, 1, 1]);
    const message = await refusal(cloud, denseRun());
    expect(message).toContain('occlusionCull: point attribute "scale" is f32x4');
    expect(message).toContain("three extents (f32, tupleSize 3)");
  });

  it("refuses a plain vec3 param written with fewer than three components", async () => {
    const message = await refusal(boxes(), denseRun(), { pushAxis: [1, 0] });
    expect(message).toContain(
      'occlusionCull: param "pushAxis" needs three components [x, y, z], got 2 components',
    );
    expect(message).toContain("vec(x, y, z)");
  });

  it("refuses more chords than it will allocate", async () => {
    const long = cloudAt(Array.from({ length: 1100 }, (_, i) => [0, 0, i * 0.1]));
    const message = await refusal(boxes(), long, { samples: 1024 });
    expect(message).toContain("occlusionCull: 1100 eyes at samples 1024 is 1126400 chords");
    expect(message).toContain("over the ceiling of 1048576");
    expect(message).toContain("pathResample");
  });

  it("refuses a push ladder with more rungs than the ceiling", async () => {
    const message = await refusal(boxes(), denseRun(), { pushMax: 5000, pushStep: 1 });
    expect(message).toContain("occlusionCull: pushMax 5000 at pushStep 1 is 5000 attempts");
    expect(message).toContain("over the ceiling of 4096");
  });

  it("names the pin when a cloud has lost its positions", async () => {
    const cloud = boxes();
    cloud.attrs.point.remove("P");
    expect(await refusal(cloud, denseRun())).toContain(
      'occlusionCull: input "in" has no point attribute "P"',
    );
  });

  it("refuses a sight geometry whose primitives are not polylines", async () => {
    const geo = cloudAt([
      [0, 0, 0],
      [0, 0, 10],
    ]);
    geo.setTopology(new Uint32Array([0]), new Uint32Array([0]), new Uint32Array([1]));
    expect(await refusal(boxes(), geo)).toContain(
      "occlusionCull: input has no polyline primitives",
    );
  });

  it("refuses a field param that resolves to the wrong width", async () => {
    const cloud = boxes();
    const message = await refusal(cloud, denseRun(), { pushMax: attribute("scale") });
    expect(message).toContain('occlusionCull: param "pushMax" must evaluate to ONE number per point');
  });
});
