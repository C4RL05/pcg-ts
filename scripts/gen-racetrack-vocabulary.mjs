#!/usr/bin/env node
/**
 * gen-racetrack-vocabulary.mjs — write `demos/racetrack/vocabulary.json`.
 *
 * Usage: node scripts/gen-racetrack-vocabulary.mjs [path-to-catalogue.json]
 *
 * WHAT THE OUTPUT HOLDS. DIMENSIONS AND STATISTICS, NOT GEOMETRY. Every
 * placement rule in the demo reads the same four things about an asset:
 * how big it is, where it sits across the track, how high, and how often
 * it stands. A box list is a bounding decomposition rather than a model —
 * one to twelve axis-aligned boxes, five at the median — and what it is
 * good for is guiding the generation of an asset, which is what the demo
 * does with it.
 *
 * THE FIELDS:
 *
 *   - `note` — what the file is, in one line.
 *   - `units` — the length unit (track half-widths, W), the axis
 *     convention (across is right of travel, along is the racing
 *     direction, up is the surface normal), and the origin the boxes are
 *     stated relative to.
 *   - `lapLengthW` — the lap length the placement stations run along.
 *   - `assets[]` — `id`, `name`, `shape`, `instances` (its count in the
 *     vocabulary), `size` as across / along / tall, and `where`:
 *     `lateral` and `height` as median / p10 / p90, plus
 *     `rightOfTravel`, `gapCv`, and an `affinity` over straight / easy /
 *     medium / tight corners.
 *   - `placements[]` — `asset`, `station` along the lap, `lateral`,
 *     `height`, and the `boxes` that placement stands as.
 *
 * WHAT THE TRANSFORMATION COMPUTES:
 *
 *   - Only assets carrying a `where` block are emitted: a rule places by
 *     `where` and has nothing to read without it.
 *   - Ids are renumbered sequentially, and every asset is named from the
 *     SHAPE CLASSIFICATION THIS PROJECT ASSIGNS IT — block, frame, panel,
 *     post, shell — numbered within its shape: `post-01`, `post-02`.
 *   - Sizes, laterals, heights and affinities round to four decimals; box
 *     corners and the scalar statistics round to three.
 *   - Boxes ship on the placements, never on the assets, so the shapes a
 *     rule dresses with vary down the lap: 362 placements, 361 distinct
 *     box sets.
 *
 * The output is committed, so the demo needs this script only when the
 * vocabulary is regenerated.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * The catalogue to read: an explicit path, or the one
 * `road-kits.local.json` names. No path is tracked in the repository —
 * see `tests/support/kits.ts` for the manifest's shape.
 */
function readInput() {
  if (process.argv[2]) return process.argv[2];
  const at = process.env.ROAD_KITS ?? join(root, "road-kits.local.json");
  if (!existsSync(at)) {
    console.error(
      "no kit to read. Pass a path, or write road-kits.local.json — see tests/support/kits.ts.",
    );
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(at, "utf8"));
  const file = m.vegetation;
  return m.dir && !isAbsolute(file) ? join(m.dir, file) : file;
}

const src = readInput();
const out = join(root, "demos", "racetrack", "vocabulary.json");

/** Round hard: four decimals of a half-width is a tenth of a millimetre. */
const r = (x, n = 4) => Number(x.toFixed(n));

const kit = JSON.parse(readFileSync(src, "utf8"));

// Only assets the rules can actually place: one without `where` has no
// placement statistics and would sit in the catalogue doing nothing.
const source = kit.assets.filter((a) => a.where);

/** Round a box list to three decimals, keeping `role` and `thickness`. */
const trim = (boxes) =>
  (boxes ?? []).map((b) => ({
    min: b.min.map((v) => r(v, 3)),
    max: b.max.map((v) => r(v, 3)),
    ...(b.role ? { role: b.role } : {}),
    ...(b.thickness ? { thickness: r(b.thickness, 3) } : {}),
  }));

const idOf = new Map(source.map((a, i) => [a.id, i]));
const perShape = new Map();
const assets = source.map((a, i) => {
  const shape = a.shape ?? "block";
  const n = (perShape.get(shape) ?? 0) + 1;
  perShape.set(shape, n);
  return {
    id: i,
    name: `${shape}-${String(n).padStart(2, "0")}`,
    shape,
    instances: a.instances,
    size: {
      across: r(a.size.across),
      along: r(a.size.along),
      tall: r(a.size.tall),
    },
    where: {
      lateral: {
        median: r(a.where.lateral.median),
        p10: r(a.where.lateral.p10),
        p90: r(a.where.lateral.p90),
      },
      height: {
        median: r(a.where.height.median),
        p10: r(a.where.height.p10),
        p90: r(a.where.height.p90),
      },
      rightOfTravel: r(a.where.rightOfTravel, 3),
      gapCv: r(a.where.gapCv, 3),
      affinity: {
        straight: r(a.where.affinity.straight, 3),
        easy: r(a.where.affinity.easy, 3),
        medium: r(a.where.affinity.medium, 3),
        tight: r(a.where.affinity.tight, 3),
      },
    },
    // NO BOXES ON THE ASSET. One box list per asset would stamp the same
    // shape at the same yaw all the way round a lap. Every box list ships
    // on a placement instead, where it describes that placement's own
    // footprint: 362 placements, 361 distinct box sets.
  };
});

/**
 * The placements: which asset, where it stands, and its own boxes.
 *
 * A placement is `asset`, a `station` along the lap in W, a `lateral`
 * across it, a `height`, and the boxes that placement stands as. Only
 * placements that carry boxes are emitted — the boxes are the whole
 * reason the list ships.
 *
 * THE STATIONS ARE COORDINATES IN A TRACK FRAME, not world positions.
 * The demo generates its own spline, of a different length with corners
 * in different places, so a placement list read against that lap is the
 * whole test of the track-frame contract.
 */
const placements = (kit.placements ?? [])
  .filter((pl) => pl.boxes?.length)
  .map((pl) => ({
    asset: idOf.get(pl.asset) ?? 0,
    station: r(pl.station, 3),
    lateral: r(pl.lateral, 3),
    height: r(pl.height, 3),
    boxes: trim(pl.boxes),
  }));

const doc = {
  note:
    "Dimensional vocabulary for demos/racetrack: per-asset bounding-box " +
    "decompositions and the placement statistics the rules read. " +
    "Dimensions and placement statistics, not geometry " +
    "— see scripts/gen-racetrack-vocabulary.mjs.",
  units: {
    length: "track half-widths (W)",
    axes: "across (right of travel), along (racing direction), up (surface normal)",
    origin: "each asset's own bounds centre; boxes are relative to it",
  },
  lapLengthW: r(kit.track.lapLengthW, 3),
  assets,
  placements,
};

writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`, "utf8");

const boxes = placements.reduce((n, p) => n + p.boxes.length, 0);
const shapes = [...perShape.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
console.log(
  `gen-racetrack-vocabulary: ${assets.length} assets, ${boxes} boxes ` +
    `(${(boxes / assets.length).toFixed(1)}/asset) — ${shapes}\n` +
    `  wrote ${out}`,
);
