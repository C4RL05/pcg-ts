#!/usr/bin/env node
/**
 * gen-road-vocabulary.mjs — build `demos/road/vocabulary.json` from a
 * measured kit.
 *
 * Usage: node scripts/gen-road-vocabulary.mjs [path-to-kit.json]
 *
 * WHAT THIS SHIPS AND WHAT IT DELIBERATELY DOES NOT.
 *
 * The road demo places art by rule, and every rule reads the same four
 * things about an asset: how big it is, where its instances sat across
 * the track, how high, and how often it appeared. Those are DIMENSIONS
 * AND STATISTICS — measurements of objects, not the objects — and the box
 * list is a median of FOUR axis-aligned boxes per asset, which is a
 * bounding decomposition and not a model. A palm tree is four boxes. You
 * cannot recover a mesh, a silhouette, a texture or anything visually
 * distinctive from it; what you can do is use it as a guide for
 * generating an asset, which is exactly what the demo does with it.
 *
 * Two things in the source kit are NOT carried across, because neither is
 * a measurement of an object and neither is needed:
 *
 *   - `placements`. Three hundred-odd entries of station, lateral, height
 *     and bank for every object around a real circuit. That is a LEVEL
 *     LAYOUT — a record of where a designer put things — rather than a
 *     fact about a box, and the generated dressing never reads it. It
 *     feeds only the optional reference overlay, which stays a local
 *     affordance.
 *   - `name` and `aliases`. Verbatim identifiers from the source's own
 *     data files. Nothing reads them. Assets are renamed here from the
 *     SHAPE CLASSIFICATION THIS PROJECT ASSIGNED THEM — block, frame,
 *     panel, post, shell — which is our categorisation and not theirs.
 *
 * Ids are renumbered sequentially for the same reason.
 *
 * The result is a vocabulary a procedural system builds on top of, which
 * is the only use it has ever been put to here.
 *
 * The input lives outside this repository and most checkouts will not
 * have it — that is expected. The output is committed, so the demo needs
 * this script only when the vocabulary is regenerated.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = process.argv[2] ?? "<kit-dir>/vegetation-kit.json";
const out = join(root, "demos", "road", "vocabulary.json");

/** Round hard: four decimals of a half-width is a tenth of a millimetre. */
const r = (x, n = 4) => Number(x.toFixed(n));

const kit = JSON.parse(readFileSync(src, "utf8"));

// Only assets the rules can actually place: one without `where` has no
// measured behaviour and would sit in the catalogue doing nothing.
const source = kit.assets.filter((a) => a.where);

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
    boxes: (a.boxes ?? []).map((b) => ({
      min: b.min.map((v) => r(v, 3)),
      max: b.max.map((v) => r(v, 3)),
      ...(b.role ? { role: b.role } : {}),
      ...(b.thickness ? { thickness: r(b.thickness, 3) } : {}),
    })),
  };
});

const doc = {
  note:
    "Dimensional vocabulary for demos/road: per-asset bounding-box " +
    "decompositions and the placement statistics the rules read. " +
    "Measurements of objects, not the objects. No level layout and no " +
    "source identifiers — see scripts/gen-road-vocabulary.mjs.",
  units: {
    length: "track half-widths (W)",
    axes: "across (right of travel), along (racing direction), up (surface normal)",
    origin: "each asset's own bounds centre; boxes are relative to it",
  },
  lapLengthW: r(kit.track.lapLengthW, 3),
  assets,
};

writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`, "utf8");

const boxes = assets.reduce((n, a) => n + a.boxes.length, 0);
const shapes = [...perShape.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
console.log(
  `gen-road-vocabulary: ${assets.length} assets, ${boxes} boxes ` +
    `(${(boxes / assets.length).toFixed(1)}/asset) — ${shapes}\n` +
    `  wrote ${out}`,
);
