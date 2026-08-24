/**
 * What the block fill actually achieves, measured rather than asserted.
 *
 * TWO SUITES, and the split is the point. The first uses synthetic boxes
 * and runs everywhere: it checks that asking for a share of the volume
 * GIVES that share, which is a property of the calibration and needs no
 * outside data. The second measures against the real kit and SKIPS when
 * that file is absent — it is derived measurements of a copyrighted game,
 * lives outside both repositories, and CI has never seen it.
 *
 * The second suite is why this file exists. The upstream measurement of
 * the original art asks one question of anything generated to stand in
 * for it — does it have the same emptiness — and a generator that is not
 * measured against that answer is a generator nobody can correct.
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
  readonly occupancy: number;
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

describe.skipIf(!KIT)("against the measured kit", () => {
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
   * This is the diagnostic upstream used to find that three quarters of
   * the source art has no interior at all, applied to what this side
   * generates. It needs no target and cannot drift with anyone's pitch,
   * which is exactly why it is the thing left standing.
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
   * as the solid. Measured below: the median box of every non-panel class
   * is one and a half cells thick on its thinnest axis at resolution 24 —
   * which is one voxel of the resolution-16 grid the kit was decomposed
   * on, exactly.
   *
   * That is the same discovery upstream made by sweeping the pitch, seen
   * from the geometry instead of from a count: the decomposition has no
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
   * NO BAND GATES HERE, deliberately, and this note is the reason.
   *
   * This suite gated the block fill's median inside the kit's published
   * 8-36% band and the shell's inside 11-30%. Those bands were withdrawn:
   * they were counted on a lattice at resolution 16, three quarters of
   * the source art turns out to be open surfaces with no interior, and so
   * the figures scale as 1/resolution and are a property of the grid
   * rather than of the art. Re-gating on a converging target is the right
   * thing to do and cannot happen until there is one.
   *
   * The gates above are what survives the withdrawal without needing it:
   * whether each chain makes the KIND of thing it claims to.
   */
  it.todo("gate the achieved occupancy once a pitch-independent target exists");
});
