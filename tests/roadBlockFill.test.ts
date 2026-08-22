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
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import {
  FILL_ATTRS,
  FILL_OUTPUT,
  type KitBox,
  buildFillGraph,
  calibrateKeep,
} from "../demos/road/fill.js";

/** Where the derived kit lives. Outside both repos, by design. */
const KIT = "<kit-dir>/street-kit.json";

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

describe.skipIf(!existsSync(KIT))("against the measured kit", () => {
  const kit = existsSync(KIT)
    ? (JSON.parse(readFileSync(KIT, "utf8")) as { assets: KitAsset[] })
    : { assets: [] };

  it("reports the occupancy the block fill achieves", async () => {
    const blocks = kit.assets.filter((a) => a.shape === "block" && !a.capped);
    expect(blocks.length).toBeGreaterThan(30);

    const bboxOf = (a: KitAsset): [number[], number[]] => {
      const h = [a.size.across / 2, a.size.along / 2, a.size.tall / 2];
      const c = a.centre;
      return [
        [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
        [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
      ];
    };
    // The kit's own voxel pitch is the longest axis over 16, so measuring
    // at the same pitch keeps the two numbers comparable rather than
    // merely similar.
    const pitchOf = (a: KitAsset): number =>
      Math.max(a.size.across, a.size.along, a.size.tall) / 16;

    // ONE threshold for every asset, calibrated once. A PER-ASSET
    // calibration would hit any target by construction, prove nothing,
    // and — worse — flatten the spread to zero, when the spread is the
    // part that carries the shape.
    const sample = blocks.slice(0, 12);
    const pooled: number[] = [];
    for (const a of sample) {
      const seen = await fillShare(a.boxes, bboxOf(a), pitchOf(a), -Infinity, 2.5);
      pooled.push(...seen.grain);
    }

    // How much of each envelope the DECOMPOSITION occupies once it is on a
    // lattice — the fill's ceiling, before any erosion.
    const unEroded: number[] = [];
    for (const a of blocks) {
      const got = await fillShare(a.boxes, bboxOf(a), pitchOf(a), -Infinity, 2.5);
      unEroded.push(got.kept / got.total);
    }

    // THE KEEP SHARE IS SOLVED, NOT SET. The erosion is linear in the
    // share kept, so the share landing the POPULATION MEDIAN on the kit's
    // median is one division rather than a search — and solving on the
    // median leaves every asset's own box volume driving its own
    // occupancy, which is where the kit's spread comes from too.
    //
    // Worth saying why the un-eroded number is not already the answer. A
    // centre-sampled voxel counts whole wherever its centre lands inside a
    // box, so a lattice at the kit's own pitch OVERSTATES the
    // decomposition it approximates — the same rounding that produced the
    // figures upstream withdrew, arriving here from the other direction.
    // The boxes sum to about 21% of the envelope and the lattice reads
    // more, so a keep share derived from box volume alone lands hot.
    const TARGET = 0.17;
    const keep = Math.min(1, TARGET / pct(unEroded, 0.5));
    const threshold = calibrateKeep(pooled, keep);

    const achieved: number[] = [];
    for (const a of blocks) {
      const got = await fillShare(a.boxes, bboxOf(a), pitchOf(a), threshold, 2.5);
      achieved.push(got.kept / got.total);
    }

    console.log(
      [
        `block fill over ${blocks.length} uncapped block assets`,
        `  lattice ceiling, no erosion:  median ${(100 * pct(unEroded, 0.5)).toFixed(0)}%`,
        `  keep share solved for ${(100 * TARGET).toFixed(0)}%:  ${(100 * keep).toFixed(0)}%`,
        `  achieved   p10 ${(100 * pct(achieved, 0.1)).toFixed(0)}%` +
          `  median ${(100 * pct(achieved, 0.5)).toFixed(0)}%` +
          `  p90 ${(100 * pct(achieved, 0.9)).toFixed(0)}%`,
        `  kit        p10 8%  median 17%  p90 36%`,
      ].join("\n"),
    );

    // The band the kit publishes for this class, not a point target: the
    // spread is the part that carries the shape, and landing the median
    // inside p10..p90 is the claim worth gating.
    const median = pct(achieved, 0.5);
    expect(median).toBeGreaterThan(0.08);
    expect(median).toBeLessThan(0.36);
  }, 120_000);
});
