/**
 * What the block fill actually achieves, measured rather than asserted.
 *
 * TWO SUITES, and the split is the point. The first uses synthetic boxes
 * and runs everywhere: it checks that asking for a share of the volume
 * GIVES that share, which is a property of the calibration and needs no
 * outside data. The second runs against a local catalogue and SKIPS when
 * that file is absent, which is the ordinary case: it is an optional
 * local file, and CI has never seen it.
 *
 * The second suite is why this file exists. The catalogue's own geometry
 * asks one question of anything generated to stand in for it — does it
 * have the same emptiness — and a generator that is not measured against
 * that answer is a generator nobody can correct.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { kitPath } from "./support/kits.js";
import {
  FILL_ATTRS,
  FILL_OUTPUT,
  type KitBox,
  buildFillGraph,
  buildShellGraph,
  calibrateKeep,
} from "../demos/racetrack/fill.js";

const KIT_KEY = "street";
const KIT = kitPath(KIT_KEY);

interface KitAsset {
  readonly name: string;
  readonly shape: string;
  readonly capped?: boolean;
  /**
   * The art's surface area over its bounding box's, counted once per
   * triangle. THIS FIELD USED TO BE DECLARED `occupancy` HERE and the kit
   * has no such field — not in any of the three, checked below. The
   * declaration outlived the figure: the occupancy the withdrawn bands
   * were percentiles of was a lattice count, and when it turned out to
   * mean nothing without a pitch the kit was regenerated to publish an
   * area instead. An interface naming a field that is not there is how a
   * suite ends up gating against `undefined`, so it is named for what
   * arrives.
   */
  readonly areaRatio: number;
  readonly size: { across: number; along: number; tall: number };
  readonly centre: readonly number[];
  readonly boxes: readonly KitBox[];
}

/** Nearest-rank, matching the kit's own convention. */
function pct(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Cook a fill and report how many of the grid's cells survived. */
async function fillShare(
  boxes: readonly KitBox[],
  bbox: readonly [readonly number[], readonly number[]],
  cellSize: number,
  threshold: number,
  frequency: number,
): Promise<{ kept: number; total: number; grain: number[] }> {
  const all = buildFillGraph({ bbox, boxes, cellSize, threshold: -Infinity, frequency });
  const allGeo = firstGeometry((await cook(all)).outputs[FILL_OUTPUT] ?? []);
  if (!allGeo) throw new Error("fill produced nothing");
  const g = allGeo.attrs.point.require(FILL_ATTRS.grain);
  const grain: number[] = [];
  for (let i = 0; i < allGeo.pointCount; i++) grain.push(g.data[i]);

  // The denominator is the whole lattice over the bounding box, which is
  // what the kit's occupancy is a share of — not the in-box cells, which
  // would measure how much of the decomposition survived instead.
  const total = Math.max(1, Math.round(bboxCells(bbox, cellSize)));

  if (threshold === -Infinity) return { kept: allGeo.pointCount, total, grain };
  const cut = buildFillGraph({ bbox, boxes, cellSize, threshold, frequency });
  const cutGeo = firstGeometry((await cook(cut)).outputs[FILL_OUTPUT] ?? []);
  return { kept: cutGeo ? cutGeo.pointCount : 0, total, grain };
}

/** How many cells `volumeSample` lays over a box — its own whole-cell rule. */
function bboxCells(bbox: readonly [readonly number[], readonly number[]], cellSize: number): number {
  let n = 1;
  for (let a = 0; a < 3; a++) {
    n *= Math.max(1, Math.floor((bbox[1][a] - bbox[0][a]) / cellSize));
  }
  return n;
}

/**
 * The volume of a union of axis-aligned boxes, EXACTLY and with no pitch.
 *
 * THIS IS THE WHOLE OF THE PITCH-INDEPENDENT TARGET, so it is worth being
 * clear that it is exact rather than sampled. Cut the three axes at every
 * box face, which partitions the bounding box into a lattice of cuboids
 * on which membership is constant, then sum the cuboids whose centre is
 * inside any box. A decomposition here has 5.66 boxes on average and 12 at
 * the most, so the worst case is 24x24x24 cuboids and the typical one is
 * far smaller. (This line said "at most 12x12x12" until it was checked,
 * which was the AVERAGE dressed up as a bound: 87 of this kit's 206 assets
 * carry more than six boxes.)
 *
 * The union rather than the sum, for the same reason `insideAnyBox` is a
 * union: a decomposition's boxes OVERLAP, and summing their volumes would
 * count the overlap twice — against which a lattice count would look too
 * low and the chain would be blamed for the arithmetic.
 *
 * The membership test is strict on both sides, matching `insideAnyBox`'s
 * half-open rule closely enough for a centre that never lands on a face.
 */
function unionVolume(boxes: readonly KitBox[]): number {
  const cuts = (axis: number): number[] => {
    const s = new Set<number>();
    for (const b of boxes) {
      s.add(b.min[axis]);
      s.add(b.max[axis]);
    }
    return [...s].sort((a, b) => a - b);
  };
  const X = cuts(0);
  const Y = cuts(1);
  const Z = cuts(2);
  let v = 0;
  for (let i = 0; i + 1 < X.length; i++) {
    for (let j = 0; j + 1 < Y.length; j++) {
      for (let k = 0; k + 1 < Z.length; k++) {
        const c = [(X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2, (Z[k] + Z[k + 1]) / 2];
        for (const b of boxes) {
          if (
            c[0] > b.min[0] && c[0] < b.max[0] &&
            c[1] > b.min[1] && c[1] < b.max[1] &&
            c[2] > b.min[2] && c[2] < b.max[2]
          ) {
            v += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]) * (Z[k + 1] - Z[k]);
            break;
          }
        }
      }
    }
  }
  return v;
}

/** The same union's surface area, exactly: faces between in and out. */
function unionArea(boxes: readonly KitBox[]): number {
  const cuts = (axis: number): number[] => {
    const s = new Set<number>();
    for (const b of boxes) {
      s.add(b.min[axis]);
      s.add(b.max[axis]);
    }
    return [...s].sort((a, b) => a - b);
  };
  const X = cuts(0);
  const Y = cuts(1);
  const Z = cuts(2);
  const inside = (i: number, j: number, k: number): boolean => {
    if (i < 0 || j < 0 || k < 0) return false;
    if (i + 1 >= X.length || j + 1 >= Y.length || k + 1 >= Z.length) return false;
    const c = [(X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2, (Z[k] + Z[k + 1]) / 2];
    for (const b of boxes) {
      if (
        c[0] > b.min[0] && c[0] < b.max[0] &&
        c[1] > b.min[1] && c[1] < b.max[1] &&
        c[2] > b.min[2] && c[2] < b.max[2]
      ) return true;
    }
    return false;
  };
  let a = 0;
  for (let i = 0; i + 1 < X.length; i++) {
    for (let j = 0; j + 1 < Y.length; j++) {
      for (let k = 0; k + 1 < Z.length; k++) {
        if (!inside(i, j, k)) continue;
        const dx = X[i + 1] - X[i];
        const dy = Y[j + 1] - Y[j];
        const dz = Z[k + 1] - Z[k];
        if (!inside(i - 1, j, k)) a += dy * dz;
        if (!inside(i + 1, j, k)) a += dy * dz;
        if (!inside(i, j - 1, k)) a += dx * dz;
        if (!inside(i, j + 1, k)) a += dx * dz;
        if (!inside(i, j, k - 1)) a += dx * dy;
        if (!inside(i, j, k + 1)) a += dx * dy;
      }
    }
  }
  return a;
}

describe("the fill keeps the share it is asked for", () => {
  const bbox: [number[], number[]] = [
    [-1, -1, -1],
    [1, 1, 1],
  ];
  // One box filling the whole envelope, so the only thing removing cells
  // is the erosion — which is what the calibration is being measured on.
  const boxes: KitBox[] = [{ min: [-1, -1, -1], max: [1, 1, 1] }];

  it.each([0.8, 0.5, 0.25])("hits a target of %s within a cell or two", async (share) => {
    const seen = await fillShare(boxes, bbox, 0.08, -Infinity, 2.5);
    const threshold = calibrateKeep(seen.grain, share);
    const got = await fillShare(boxes, bbox, 0.08, threshold, 2.5);
    // The threshold is a real sample value, so the survivors are the cells
    // strictly above it — one rank short of the requested count at worst.
    expect(got.kept / got.total).toBeCloseTo(share, 2);
  });

  it("counts overlapping boxes once — the decomposition is a union, not a sum", async () => {
    // TWO BOXES THAT OVERLAP DOWN THE MIDDLE and together cover the whole
    // envelope. `insideAnyBox` says it evaluates a union per point rather
    // than merging per-box survivors, and that the difference is the
    // overlap being counted twice; this is the case where the two answers
    // are furthest apart. The boxes sum to 1.5 envelopes, so an
    // implementation that merged would emit 12000 cells for an 8000-cell
    // lattice, with the middle 4000 twice.
    //
    // IT IS HERE RATHER THAN IN THE KIT SUITE BECAUSE THE KIT CANNOT ASK
    // IT. Measured over the uncapped `block` assets the volume gate below
    // uses, the sum of a decomposition's box volumes is a median 1.018
    // times its union, so that gate passes against BOTH targets and proves
    // nothing about the overlap. Real decompositions barely overlap; the
    // rule still has to be right when one does, and here one does by half.
    const wide: [number[], number[]] = [
      [-1, -1, -1],
      [1, 1, 1],
    ];
    const overlapping: KitBox[] = [
      { min: [-1, -1, -1], max: [0.5, 1, 1] },
      { min: [-0.5, -1, -1], max: [1, 1, 1] },
    ];
    const got = await fillShare(overlapping, wide, 0.1, -Infinity, 2.5);
    expect(got.kept).toBe(got.total);

    const geo = firstGeometry(
      (
        await cook(
          buildFillGraph({
            bbox: wide,
            boxes: overlapping,
            cellSize: 0.1,
            threshold: -Infinity,
            frequency: 2.5,
          }),
        )
      ).outputs[FILL_OUTPUT] ?? [],
    );
    if (!geo) throw new Error("no cells");
    const P = geo.attrs.point.require("P");
    // KEYED ON THE LATTICE INDEX, not on the coordinate over the pitch.
    // A cell centre sits half a pitch above the lower bound, so dividing
    // the coordinate straight through lands on a half-integer and
    // `Math.round`'s tie rule merges cells that are a pitch apart — which
    // it did here, collapsing 8000 cells into 2744 and failing a test
    // whose subject was passing. Subtracting the bound and the half cell
    // first makes the value an integer for any pitch.
    const cell = (x: number, lo: number): number => Math.round((x - lo) / 0.1 - 0.5);
    const seen = new Set<string>();
    for (let i = 0; i < geo.pointCount; i++) {
      seen.add(
        `${cell(P.data[i * 3], wide[0][0])},${cell(P.data[i * 3 + 1], wide[0][1])},` +
          `${cell(P.data[i * 3 + 2], wide[0][2])}`,
      );
    }
    // No cell twice, which is the half of the claim a count alone misses:
    // a lattice with a hole and a doubled slab has the right total.
    expect(seen.size).toBe(geo.pointCount);
  });

  it("is not merely a random thinning — the survivors are connected mass", async () => {
    const seen = await fillShare(boxes, bbox, 0.08, -Infinity, 2.5);
    const threshold = calibrateKeep(seen.grain, 0.5);
    const g = buildFillGraph({
      bbox,
      boxes,
      cellSize: 0.08,
      threshold,
      frequency: 2.5,
    });
    const geo = firstGeometry((await cook(g)).outputs[FILL_OUTPUT] ?? []);
    if (!geo) throw new Error("no cells");
    const P = geo.attrs.point.require("P");
    // A coin-flip mask leaves each survivor with about half its six
    // neighbours; a field-eroded one leaves far more, because the field is
    // smooth over the cell pitch. This is the difference between mass and
    // confetti, and it is the only reason to use a field at all.
    const key = (x: number, y: number, z: number): string =>
      `${Math.round(x / 0.08)},${Math.round(y / 0.08)},${Math.round(z / 0.08)}`;
    const live = new Set<string>();
    for (let i = 0; i < geo.pointCount; i++) {
      live.add(key(P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]));
    }
    const OFFSETS = [
      [0.08, 0, 0],
      [-0.08, 0, 0],
      [0, 0.08, 0],
      [0, -0.08, 0],
      [0, 0, 0.08],
      [0, 0, -0.08],
    ] as const;
    const meanNeighbours = (cells: ReadonlySet<string>, pts: readonly number[][]): number => {
      let n = 0;
      for (const [x, y, z] of pts) {
        for (const [dx, dy, dz] of OFFSETS) if (cells.has(key(x + dx, y + dy, z + dz))) n++;
      }
      return n / pts.length;
    };

    const pts: number[][] = [];
    for (let i = 0; i < geo.pointCount; i++) {
      pts.push([P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]]);
    }

    // THE CONTROL, and it is why this test is worth having. A bare
    // threshold on "how many neighbours does a survivor have" would pass
    // for a coin flip too at a high enough keep share, so the same
    // statistic is measured on a RANDOM mask of the same size over the
    // same lattice. The field has to beat it, not merely score well.
    const every = buildFillGraph({ bbox, boxes, cellSize: 0.08, threshold: -Infinity, frequency: 2.5 });
    const everyGeo = firstGeometry((await cook(every)).outputs[FILL_OUTPUT] ?? []);
    if (!everyGeo) throw new Error("no lattice");
    const all: number[][] = [];
    for (let i = 0; i < everyGeo.pointCount; i++) {
      const a = everyGeo.attrs.point.require("P");
      all.push([a.data[i * 3], a.data[i * 3 + 1], a.data[i * 3 + 2]]);
    }
    // A fixed shuffle rather than Math.random: this is a test in a library
    // whose whole claim is determinism, and a control that differs per run
    // is a control that fails per run.
    let h = 0x2545f491;
    const shuffled = [...all].sort(() => {
      h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff;
      return (h & 1) === 0 ? -1 : 1;
    });
    const picked = shuffled.slice(0, pts.length);
    const randomCells = new Set(picked.map(([x, y, z]) => key(x, y, z)));

    const field = meanNeighbours(live, pts);
    const chance = meanNeighbours(randomCells, picked);
    expect(field).toBeGreaterThan(chance * 1.4);
  });
});

describe.skipIf(!KIT)("against the local catalogue", () => {
  const kit = !!KIT
    ? (JSON.parse(readFileSync(KIT!, "utf8")) as { assets: KitAsset[] })
    : { assets: [] };

  const bboxOf = (a: KitAsset): [number[], number[]] => {
    const h = [a.size.across / 2, a.size.along / 2, a.size.tall / 2];
    const c = a.centre;
    return [
      [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
      [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
    ];
  };
  /** Pitch as the longest axis over `res`, which is the kit's own rule. */
  const pitchAt = (a: KitAsset, res: number): number =>
    Math.max(a.size.across, a.size.along, a.size.tall) / res;

  const classOf = (shape: string): KitAsset[] =>
    kit.assets.filter((a) => a.shape === shape && !a.capped);

  /**
   * THE ONLY OCCUPANCY QUESTION THAT ANSWERS ITSELF.
   *
   * "What share of the envelope does this fill occupy" has no answer
   * without a pitch: measured on a lattice, an OPEN SURFACE reads
   * area/pitch and so halves every time the lattice doubles, while a
   * SOLID holds its value. So the ratio between two resolutions is not a
   * detail of the measurement — it is the measurement. A ratio near 1
   * says the fill made volume; near 2 says it made surface.
   *
   * This is the diagnostic that found three quarters of the catalogue's
   * art has no interior at all, applied to what this side generates. It
   * needs no target and cannot drift with anyone's pitch,
   * which is exactly why it was the thing left standing when the bands
   * were withdrawn.
   *
   * IT IS NO LONGER THE ONLY THING STANDING, and this paragraph used to
   * say it was. "The achieved occupancy IS the decomposition's own volume
   * fraction, at every pitch" below gates the same chain against an exact
   * target computed from the box coordinates, which is strictly the
   * stronger statement — a two-point ratio near 1 is consistent with
   * converging to the wrong number, and that test says which number. This
   * one is kept because it is the CHEAP form and because it is what the
   * shell chain, which has no such target, can still be held to.
   */
  const convergence = async (
    assets: readonly KitAsset[],
    fill: (a: KitAsset, pitch: number) => Promise<number>,
  ): Promise<{ lo: number[]; hi: number[]; ratio: number[] }> => {
    const lo: number[] = [];
    const hi: number[] = [];
    const ratio: number[] = [];
    for (const a of assets) {
      const atCoarse = await fill(a, pitchAt(a, 12));
      const atFine = await fill(a, pitchAt(a, 24));
      lo.push(atCoarse);
      hi.push(atFine);
      ratio.push(atFine > 0 ? atCoarse / atFine : NaN);
    }
    return { lo, hi, ratio: ratio.filter((r) => Number.isFinite(r)) };
  };

  const report = (label: string, r: { lo: number[]; hi: number[]; ratio: number[] }): void => {
    console.log(
      [
        label,
        `  at res 12   p10 ${(100 * pct(r.lo, 0.1)).toFixed(0)}%` +
          `  median ${(100 * pct(r.lo, 0.5)).toFixed(0)}%` +
          `  p90 ${(100 * pct(r.lo, 0.9)).toFixed(0)}%`,
        `  at res 24   p10 ${(100 * pct(r.hi, 0.1)).toFixed(0)}%` +
          `  median ${(100 * pct(r.hi, 0.5)).toFixed(0)}%` +
          `  p90 ${(100 * pct(r.hi, 0.9)).toFixed(0)}%`,
        `  coarse/fine ratio  median ${pct(r.ratio, 0.5).toFixed(2)}` +
          `  (1.00 = volume, 2.00 = open surface)`,
      ].join("\n"),
    );
  };

  it("the block fill makes VOLUME — its occupancy holds as the pitch halves", async () => {
    const blocks = classOf("block").slice(0, 24);
    expect(blocks.length).toBeGreaterThan(15);
    const r = await convergence(blocks, async (a, pitch) => {
      const got = await fillShare(a.boxes, bboxOf(a), pitch, -Infinity, 2.5);
      return got.kept / got.total;
    });
    report(`block fill, ${blocks.length} uncapped block assets`, r);
    // A solid holds its share. Some drift is expected — the boxes' faces
    // do not land on cell boundaries — but nothing like the doubling an
    // open surface shows.
    expect(pct(r.ratio, 0.5)).toBeLessThan(1.35);
  }, 300_000);

  /**
   * THE SHELL CHAIN CANNOT DO ANYTHING TO THIS KIT, and the reason is a
   * fact about the boxes rather than about the chain.
   *
   * Carving a wall means finding cells with an exposed face and dropping
   * the ones without. A box under two cells thick has NO cell without an
   * exposed face, so the carve removes nothing and the shell comes back
   * as the solid. Measured below: the median `shell` box is 1.45 cells
   * thick on its thinnest axis at resolution 24, and the median `block`
   * box 1.47 — roughly one voxel of the resolution-16 grid the kit was
   * decomposed on. (This line said "every non-panel class" until it was
   * checked, and that is wrong in both directions worth knowing: `post`
   * runs 1.85 and `frame` 2.20, so the two classes with a carveable
   * interior are the two this test does not measure.)
   *
   * That is the same discovery the pitch sweep made, seen from the
   * geometry instead of from a count: the decomposition has no
   * interior to carve because its thin axis is pinned at the grid that
   * produced it. So this test asserts the DIAGNOSIS rather than a shell
   * behaviour there is no data to show.
   */
  it("cannot carve a shell from boxes thinner than two cells", async () => {
    const shells = classOf("shell").slice(0, 24);
    expect(shells.length).toBeGreaterThan(15);

    const thinness: number[] = [];
    for (const a of shells) {
      const pitch = pitchAt(a, 24);
      for (const b of a.boxes) {
        thinness.push(
          Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / pitch,
        );
      }
    }
    const underTwo = thinness.filter((t) => t < 2).length / thinness.length;
    console.log(
      [
        `shell-class box thinness, ${shells.length} assets / ${thinness.length} boxes, res 24`,
        `  thinnest axis in cells   p10 ${pct(thinness, 0.1).toFixed(2)}` +
          `  median ${pct(thinness, 0.5).toFixed(2)}` +
          `  p90 ${pct(thinness, 0.9).toFixed(2)}`,
        `  under two cells: ${(100 * underTwo).toFixed(0)}%  (a carve removes nothing from these)`,
      ].join("\n"),
    );
    expect(underTwo).toBeGreaterThan(0.6);

    const r = await convergence(shells, async (a, pitch) => {
      const g = buildShellGraph({
        bbox: bboxOf(a),
        boxes: a.boxes,
        cellSize: pitch,
        threshold: -Infinity,
        frequency: 2.5,
      });
      const geo = firstGeometry((await cook(g)).outputs[FILL_OUTPUT] ?? []);
      const total = Math.max(1, Math.round(bboxCells(bboxOf(a), pitch)));
      return (geo ? geo.pointCount : 0) / total;
    });
    report(`one-cell shell, ${shells.length} uncapped shell assets`, r);
    // And so it scales like the solid it is failing to hollow, not like
    // the surface it is meant to make. When a decomposition arrives that
    // can express a wall, this is the number that will move.
    expect(pct(r.ratio, 0.5)).toBeLessThan(1.5);
  }, 300_000);

  /**
   * THE PITCH-INDEPENDENT TARGET, AND WHY IT IS NOT THE ART'S NUMBER.
   *
   * This suite once gated the block fill's median inside the kit's
   * published 8-36% band and the shell's inside 11-30%, and withdrew both
   * because they were lattice counts at resolution 16 over art that is
   * three quarters open surface, so they scaled as 1/resolution and
   * described the grid rather than the art. The note that replaced them
   * said re-gating needed a target that converges. This is that target,
   * and finding it turned on separating two questions the withdrawn band
   * had merged.
   *
   * WHAT THE FILL IS ASKED FOR IS A SHARE OF A DECOMPOSITION, and the
   * decomposition is a union of solid boxes — a quantity with an exact
   * volume and no pitch anywhere in it. So the target is
   * `share * unionVolume(boxes) / bboxVolume`, computed from the box
   * coordinates alone, and the claim is that the cooked lattice count
   * lands on it AT EVERY PITCH. Measured over 23 of the first 24 uncapped
   * `block` assets — the twenty-fourth has no volume at all, see the
   * partition below — median achieved / target:
   *
   *     res     12     16     24     32     40
   *     solid  0.950  1.054  0.899  1.044  0.967
   *     0.50   0.937  1.039  0.897  1.043  0.967
   *     0.25   0.930  1.031  0.894  1.039  0.966
   *
   * Over all 50 uncapped blocks (49 with a volume) the solid row is 0.964
   * 1.082 0.956 1.049 0.968, so the figure is not an artefact of the 24
   * taken. It does not
   * drift with pitch, it OSCILLATES about 1 — the sawtooth is the
   * whole-cell floor in `bboxCells` and the boxes' faces not landing on
   * cell boundaries — and a 3.3x pitch sweep moves the median by 17%
   * where a surface-scaling quantity would move it by 3.3x. That
   * separation is what the gate below is sized on.
   *
   * THE THREE SHARE ROWS ARE THE POINT AS MUCH AS THE FIRST. They agree
   * to within 0.005, which says the calibration composes with the volume:
   * asking for a quarter of a decomposition gives a quarter of its
   * volume, not a quarter of something else. That is the two halves of
   * this file's first suite and this one joined into one statement.
   *
   * BELOW RESOLUTION 12 IT STOPS HOLDING, and the reason is the sibling
   * test's: the median is 0.793 at res 8 with a p10 of 0.249, because a
   * box thinner than a cell has no cell centre in it and vanishes. The
   * shell test measures the same fact from the other side — 87% of shell
   * boxes are under two cells thick at res 24. So the target is honest
   * about the pitch it needs, which is not the same as depending on one.
   *
   * WHAT THE BAND CAN AND CANNOT CATCH, measured by handing it wrong
   * targets rather than assumed. A target 25% too high is rejected at
   * every pitch in the sweep (dividing the medians above by 1.25 gives
   * 0.719 to 0.843, and 0.843 is the one that decides it — the margin is
   * 0.007, not the comfortable one a glance at the low end suggests). One
   * 20% too low is rejected at res 12, 16, 32 and 40 and squeaks through
   * at res 24 (1.124), which is the pitch where the sawtooth happens to
   * dip. So the resolving power is about a fifth, and the gate is not a
   * substitute for the exactness of `unionVolume` — it is a check that
   * the chain lands on it. What it does NOT catch is the union: over these
   * assets the sum of a decomposition's box volumes is a median 1.018
   * times its union — 1.8% of double-counting, 13% at the worst asset — so
   * a target built from the sum sits well inside the band and passes here
   * too. The synthetic overlap case in the first suite is where that claim
   * is actually tested, and it is there because this kit cannot ask it.
   */
  const RES = [12, 16, 24, 32, 40] as const;
  const SHARES = [1, 0.5, 0.25] as const;

  const bboxVolume = (a: KitAsset): number => a.size.across * a.size.along * a.size.tall;
  const bboxArea = (a: KitAsset): number =>
    2 *
    (a.size.across * a.size.along + a.size.across * a.size.tall + a.size.along * a.size.tall);

  it("the achieved occupancy IS the decomposition's own volume fraction, at every pitch", async () => {
    const candidates = classOf("block").slice(0, 24);
    expect(candidates.length).toBeGreaterThan(15);

    // THE PARTITION, AND IT IS ONE ASSET RATHER THAN A CLASS. "Split the
    // kit into what has an interior and what does not" was the obvious
    // shape for this gate and it is not what the data wanted: every
    // uncapped `block` here has a decomposition with real volume in it
    // EXCEPT one, `GRID2_1_9MULTIP`, whose bounding box is flat — a sheet
    // filed under `block`. Its volume fraction is 0/0, so the target does
    // not exist for it rather than being hard to hit, and no tolerance
    // covers that. It is dropped by the only test that can be justified,
    // namely whether the quantity is defined, and the count is asserted
    // so the drop cannot quietly grow into a filter that removes whatever
    // fails.
    const blocks = candidates.filter((a) => bboxVolume(a) > 0);
    expect(candidates.length - blocks.length).toBe(1);
    expect(candidates.filter((a) => bboxVolume(a) === 0).map((a) => a.name)).toEqual([
      "GRID2_1_9MULTIP",
    ]);

    // The target, computed once per asset from the box coordinates. No
    // pitch is involved in producing it, which is the whole property
    // under test — the same number is the target at every resolution.
    const target = blocks.map((a) => unionVolume(a.boxes) / bboxVolume(a));
    expect(Math.min(...target)).toBeGreaterThan(0);

    const rows: string[] = [
      `achieved / (share * union volume fraction), ${blocks.length} uncapped blocks` +
        ` of ${candidates.length}`,
    ];
    const medians: number[] = [];
    /** Keyed `res:share`, so the three shares can be compared at one pitch. */
    const byCell = new Map<string, number>();

    for (const share of SHARES) {
      for (const res of RES) {
        const ratios: number[] = [];
        for (let i = 0; i < blocks.length; i++) {
          const a = blocks[i];
          const bbox = bboxOf(a);
          const pitch = pitchAt(a, res);
          let threshold = -Infinity;
          if (share < 1) {
            const seen = await fillShare(a.boxes, bbox, pitch, -Infinity, 2.5);
            threshold = calibrateKeep(seen.grain, share);
          }
          const got = await fillShare(a.boxes, bbox, pitch, threshold, 2.5);
          ratios.push(got.kept / got.total / (share * target[i]));
        }
        const med = pct(ratios, 0.5);
        medians.push(med);
        byCell.set(`${res}:${share}`, med);
        rows.push(
          `  share ${share.toFixed(2)}  res ${String(res).padStart(2)}` +
            `   p10 ${pct(ratios, 0.1).toFixed(3)}  median ${med.toFixed(3)}` +
            `  p90 ${pct(ratios, 0.9).toFixed(3)}`,
        );

        // THE GATE, AND IT IS THE SAME BAND AT EVERY PITCH. A band that
        // had to be widened for the coarse end would be the withdrawn
        // band again under a new name.
        expect(med).toBeGreaterThan(0.85);
        expect(med).toBeLessThan(1.15);

        // The per-asset spread at the two finest pitches, so the gate is
        // not satisfied by a median sitting on top of a scatter. Left off
        // the coarse end deliberately: at res 12 the assets whose
        // thinnest box is near one cell are still losing it.
        if (res >= 32) {
          expect(pct(ratios, 0.1)).toBeGreaterThan(0.75);
          expect(pct(ratios, 0.9)).toBeLessThan(1.3);
        }
      }
    }
    console.log(rows.join("\n"));

    // PITCH-INDEPENDENCE, STATED AS THE THING IT HAS TO BEAT. Over res 12
    // to 40 a quantity that scales as 1/pitch changes by 3.33x. These
    // medians span 1.179x — the excess over 1 is a thirteenth of the
    // excess a scaling quantity shows, and the spans differ by 2.8x — and
    // that gap is the difference between a target and a reading of the
    // grid. (This comment said "a sixth of that" before the arithmetic was
    // checked; no reading of the printed numbers gives a sixth.)
    const spread = Math.max(...medians) / Math.min(...medians);
    expect(spread).toBeLessThan(1.25);
    expect(RES[RES.length - 1] / RES[0]).toBeGreaterThan(3);

    // And the calibration composes: the same ratio at every share.
    for (const res of RES) {
      const solid = byCell.get(`${res}:1`) as number;
      for (const share of SHARES) {
        expect(Math.abs((byCell.get(`${res}:${share}`) as number) - solid)).toBeLessThan(0.03);
      }
    }
  }, 300_000);

  /**
   * WHY NO BAND AGAINST THE ART, AND THIS IS THE MEASUREMENT SO THE NEXT
   * READER DOES NOT REDO IT.
   *
   * The withdrawn bands were percentiles of a per-asset occupancy. The
   * kit no longer publishes one — asserted below, in all three kits — and
   * that is not an omission. What it publishes instead is `areaRatio`:
   * the art's triangle area over its bounding box's closed surface area,
   * counted ONCE per triangle. Two ratios of areas, so it is
   * dimensionless and has no pitch in it, which is exactly the property
   * an occupancy of an open surface could not have.
   *
   * THE NUMERATOR IS VERIFIED BELOW; THE DENOMINATOR IS NOT, and the
   * difference is worth stating because a first draft of this paragraph
   * claimed both. Take the assets that are a single box filling their own
   * bounding box with a thin axis under 2% of the long one — a flat
   * sheet. A sheet's two faces have the area of one face of the
   * degenerate box, and the box's closed area is two of those, so a
   * once-counted area gives exactly 0.5 and a twice-counted one gives
   * 1.0. Measured: 27 such assets in this kit, maximum 0.4992; the same
   * cut gives 0.4908 and 0.3311 in the other two. That pins the COUNTING.
   * The stronger version of the same argument is that of all 670 assets
   * in the three kits exactly one exceeds 1.0, and by 0.42% — 1.0 is the
   * saturation point of a once-counted area over a closed bbox, and the
   * twice-counted analogue at 2.0 is nowhere approached.
   *
   * WHAT IT DOES NOT PIN is what the area is divided BY. Every asset in
   * that evidence is a single box filling its bbox, and for exactly those
   * `bboxArea`, `unionArea(boxes)` and the convex hull's area are the
   * same number. "Art over bbox closed area", "art over the
   * decomposition's own surface area" and "art over hull area" are
   * therefore indistinguishable here, and they differ on every multi-box
   * asset — the two diverge by a median factor of 0.783 on this kit's own
   * blocks and shells, which is not small. Nothing below rests on the
   * choice, because the conclusion is that the fill's figure and the
   * art's are incommensurable whichever denominator is meant.
   *
   * (The `enclosed` kit's one asset above 1.0, `POLY1_2SCENE247`, was
   * cited here as "a closed box whose art wraps the whole envelope". It
   * is not: it is a single box 2.677 x 0.160 x 1.041 W, a 1:17 slab, and
   * its two large faces are 82.4% of the closed bbox area — so a
   * twice-counted sheet would read 0.824, not 1.0042. It rules out
   * `areaRatio` saturating at 0.5 by construction, and nothing more.)
   *
   * SO THE TWO FIGURES ARE NOT COMPARABLE, and no arithmetic makes them
   * so. The fill's lattice has no way to count a face once: a wall one
   * cell thick exposes both of its sides and contributes twice what the
   * art's convention would. Halving it is not a fix either, because the
   * fill is not standing in for the art's surface — it is filling the
   * ENVELOPE, and this kit's envelopes carry 2.7x the art's area. That
   * factor is measured here rather than left as a claim.
   *
   * WHAT WOULD MAKE A BAND POSSIBLE. Either the kit publishes a volume
   * the art actually encloses — which for an open surface means a
   * thickness per box, and the `thickness` column is 0 on 46% of this
   * kit's boxes and 41-43% of the other two, so it is a large minority
   * missing rather than the majority an earlier draft of this line said —
   * or the fill grows a surface whose area is measured the art's way and
   * the target becomes `areaRatio` directly. The second is the smaller
   * step and the shell chain is where it would land, once a
   * decomposition arrives that can express a wall. Until then the gate
   * above is the honest one: it measures the fill against the data it
   * was actually given.
   */
  it("the kit publishes an AREA, not an occupancy — which is why no band is coming back", () => {
    // No kit has an occupancy field. The `KitAsset` declaration used to
    // say otherwise; this is what keeps the two in step.
    for (const key of ["vegetation", "street", "enclosed"] as const) {
      const at = kitPath(key);
      if (!at) continue;
      const other = JSON.parse(readFileSync(at, "utf8")) as { assets: Record<string, unknown>[] };
      expect(other.assets.length).toBeGreaterThan(0);
      expect(other.assets.some((a) => "occupancy" in a)).toBe(false);
      expect(other.assets.every((a) => typeof a.areaRatio === "number")).toBe(true);
    }

    // The convention, on the assets that can only mean one thing.
    const sheets = kit.assets.filter((a) => {
      if (a.boxes.length !== 1) return false;
      const b = a.boxes[0];
      const d = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
      const boxArea = 2 * (d[0] * d[1] + d[0] * d[2] + d[1] * d[2]);
      const long = Math.max(a.size.across, a.size.along, a.size.tall);
      const thin = Math.min(a.size.across, a.size.along, a.size.tall);
      return Math.abs(boxArea / bboxArea(a) - 1) < 0.02 && thin < 0.02 * long;
    });
    expect(sheets.length).toBeGreaterThan(10);
    const sheetMax = Math.max(...sheets.map((a) => a.areaRatio));
    // A twice-counted area would read 1.0 here, not 0.5.
    expect(sheetMax).toBeLessThan(0.501);
    expect(sheetMax).toBeGreaterThan(0.49);

    // And how far the envelope is from the art it stands for.
    // ZERO-AREA ASSETS ARE DROPPED, and the reason is a limit of
    // `unionArea` rather than a fact about them. Its cuboid centres have
    // to satisfy `c > min && c < max`, so a box with a zero-extent axis
    // contains no centre and the union comes back as 0 — the same
    // degenerate assets the volume gate drops, arriving here as a
    // spurious 0 rather than as a missing entry. Leaving them in dragged
    // the printed factor from 2.71 down to 2.48, which is a third of the
    // way to the 1.8 gate on a number nobody had checked.
    const envelope: number[] = [];
    const art: number[] = [];
    let degenerate = 0;
    for (const shape of ["block", "shell"] as const) {
      for (const a of classOf(shape).slice(0, 24)) {
        const e = unionArea(a.boxes) / bboxArea(a);
        if (e <= 0) {
          degenerate++;
          continue;
        }
        envelope.push(e);
        art.push(a.areaRatio);
      }
    }
    expect(degenerate).toBe(1);
    const factor = pct(envelope, 0.5) / pct(art, 0.5);
    console.log(
      [
        `the kit's own convention, ${sheets.length} flat single-box sheets`,
        `  areaRatio of a flat sheet   max ${sheetMax.toFixed(4)}  (0.50 = counted once, 1.00 = twice)`,
        `  decomposition area / bbox area   median ${pct(envelope, 0.5).toFixed(3)}`,
        `  the art's areaRatio              median ${pct(art, 0.5).toFixed(3)}`,
        `  the envelope carries ${factor.toFixed(2)}x the art's surface`,
      ].join("\n"),
    );
    // Not a tuned number — the claim is only that the gap is large enough
    // that no convention argument closes it.
    expect(factor).toBeGreaterThan(1.8);
  });
});
