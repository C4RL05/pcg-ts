/**
 * The racetrack as a streamed World: one lap, then its dressing in arc
 * sectors.
 *
 * WHERE THE CUT FALLS, WHICH IS THE ONLY DECISION IN THIS FILE. The lap
 * level owns the placement LIST and the sectors own the GEOMETRY. Every
 * rule that reads the whole circuit — the station process, the corner
 * language, landmark uniqueness, the band mix, and the Z-1/L-1/L-5 fixed
 * point that reconciles them — runs once, above, on a level with no
 * cells. A sector then takes the settled list, keeps the placements whose
 * arc position it owns, and turns them into instances.
 *
 * THE POINT OF PUTTING IT THERE is that a placement's geometry is a pure
 * function of that placement. No sector reads a neighbour, no sector
 * repairs anything, and there is therefore NO HALO AT ALL: the union of
 * the sectors is the whole lap, box for box, not to a tolerance but by
 * construction. That is a much stronger claim than a windowed repair can
 * make, and it is worth more than the alternative's better streaming
 * profile. `PLAN.md` records the measurement that says what a windowed
 * repair would cost when someone wants it: the shipped spline produces no
 * genuine fold, so an arc window of +/-60W contains every world neighbour
 * within 12W on every seed measured, with the worst case 2.4x clear.
 *
 * WHAT THE LAP LEVEL CANNOT DO, stated because it is the honest limit of
 * this arrangement. Its graph is BUILT from a cooked `Lap` — `dressGraph`
 * turns the placement list into a cloud in TypeScript, through the lap's
 * own frame lookup — so the level cannot be constructed before the road
 * has been cooked and the list decided. The page therefore cooks the road
 * first and hands the result in. A track measured in kilometres would pay
 * that whole prelude at load rather than streaming it, and the way out is
 * to make the station process and the frame lookup nodes, not to move
 * this cut.
 *
 * ONE INSTANCE PER PLACEMENT, NOT PER BOX. `spawnInstances` groups
 * batches by a STRING point attribute and no field produces a string, so
 * a per-point asset id has to be written by whatever builds the cloud in
 * TypeScript. On the placement cloud that is a few hundred writes per
 * lap; on the boxes it would be one per copy of the entire pose library
 * times the entire placement list, which is the cost `writeBoxes` already
 * refuses for a single f32. So the sectors spawn placements and the asset
 * map carries each pose's boxes as one merged mesh — which is also what
 * real art wants, since a gantry is one object rather than seven slabs.
 * The boxes still exist: the lap level builds them, because L-6's
 * coverage is measured against them.
 *
 * EVERYTHING IS IN HALF-WIDTHS. The path table's length, the sector size,
 * the look-ahead and the anchor the page passes are all in W, because
 * `stationW` is the column the sector filter tests and every rule in this
 * demo is stated in W. The alternative — a table in world units and a
 * column in W — puts a multiply by `halfWidth` between two numbers that
 * have to agree exactly about which sector owns a placement.
 */
import {
  Graph,
  type CellContext,
  type LevelDef,
  attribute,
  dataInput,
  filterByExpression,
  ge,
  lt,
  mul,
  setAttribute,
  spawnInstances,
  vec,
} from "pcg-ts";
import { DRESS_OUTPUTS, PLACEMENT, buildDressGraph, poseAssetId } from "./dressGraph.js";
import type { DressGraphInput } from "./dressGraph.js";

/** The level names, which are also the keys `update`'s anchors are given under. */
export const LEVELS = {
  lap: "lap",
  dressing: "dressing",
} as const;

/**
 * How long one sector is, in half-widths.
 *
 * TWENTY W IS 180 WORLD UNITS, about two seconds at the demo's speed, and
 * the lap is 286-443W — so a circuit is 15-22 sectors. The number is a
 * balance between two costs that pull opposite ways: a short sector
 * re-pays the per-cook overhead more often and holds fewer placements
 * than a batch wants, while a long one makes the pop-in at the far end of
 * the window coarser and the retained set heavier. It is not load-bearing
 * for correctness — the sectors do not interact — so it is a knob, and
 * the World rounds it to a whole number of sectors regardless.
 */
export const SECTOR_W = 20;

/** Sectors wanted ahead of the car, and behind it. */
export const AHEAD_SECTORS = 3;
export const BEHIND_SECTORS = 1;

/** What {@link buildRacetrackLevels} returns. */
export interface RacetrackLevels {
  /** Level 0 then level 1, in the order `World` wants them. */
  readonly levels: readonly LevelDef[];
  /** The lap level's graph, so the page can show it. */
  readonly lapGraph: Graph;
  /** The dressing level's graph, likewise. */
  readonly dressingGraph: Graph;
  /**
   * How many sectors the lap was cut into.
   *
   * `maxCellsPerLevel` HAS TO CLEAR THIS. A closed lap cycles every
   * sector once per lap, so a cap below the sector count evicts a sector
   * the car is about to reach again and the whole circuit re-cooks every
   * lap. Above it, the session pays one cook per sector and never again.
   */
  readonly sectorCount: number;
}

export interface RacetrackLevelsInput extends DressGraphInput {
  /** Sector length in W. Defaults to {@link SECTOR_W}. */
  readonly sectorW?: number;
}

/**
 * The dressing level's graph: keep what this sector owns, then spawn it.
 *
 * THE FILTER IS THE OWNERSHIP RULE AND IT IS HALF-OPEN. A placement
 * belongs to the sector whose `[sMin, sMax)` contains its own arc
 * position — one owner, no interval bookkeeping, and the seam at s = 0 is
 * where the World already puts it. `sMax` is exclusive so a placement
 * landing exactly on a boundary is claimed once rather than twice.
 *
 * THE BOUNDS ARE ROUNDED TO f32 BEFORE THEY ARE COMPARED. `stationW` is
 * an f32 column and `ctx.sMin`/`sMax` are f64, so a bound that is not
 * representable in f32 is a bound the comparison never sees: the field
 * resolves into an f32 column and the two sides land on different numbers.
 * `Math.fround` here makes the two sectors either side of a boundary
 * agree about it exactly, which is what "exactly one owner" needs to be
 * true rather than nearly true.
 */
export function buildDressingGraph(opts: {
  readonly seed: number;
  readonly halfWidth: number;
}): { graph: Graph; bind: (g: Graph, ctx: CellContext) => void } {
  const { seed, halfWidth } = opts;
  // The fallback a point with an empty id would take. Nothing writes an
  // empty id -- the column is filled for every placement -- so this is
  // unreachable rather than a default, and it names a real pose because
  // an asset map is entitled to refuse an id it was never given.
  const defaultAssetId = poseAssetId(0, false);
  const g = new Graph(seed);

  const placementsIn = g.add(dataInput, {}, "placements");

  const mine = g.add(filterByExpression, {}, "sector");
  g.connect(placementsIn, "out", mine, "in");

  // The merged pose meshes are modelled in the same W-relative units
  // `poseCloud` writes, so the instance transform supplies the whole
  // conversion to world. The cloud arrives carrying the ASSET's extents
  // in `scale` — that is what it means for the output to be a placement
  // rather than an argument to `copyToPoints` — and this replaces them.
  const scaled = g.add(
    setAttribute,
    { name: "scale", tupleSize: 3, value: vec(halfWidth, halfWidth, halfWidth) },
    "trackScale",
  );
  g.connect(mine, "out", scaled, "in");

  const spawn = g.add(
    spawnInstances,
    { assetId: defaultAssetId, assetAttr: PLACEMENT.asset },
    "spawn",
  );
  g.connect(scaled, "out", spawn, "in");
  g.output(spawn, "instances", "instances");

  const bind = (bg: Graph, ctx: CellContext): void => {
    if (ctx.cellMode !== "path") {
      throw new Error(
        `racetrack dressing level: expected a "path" cell context, got cellMode "${ctx.cellMode}". ` +
          `The level must be declared with cellMode: "path" and a path table.`,
      );
    }
    // THE PARENT'S OUTPUT, NOT A SECOND COPY OF IT. Every sector reads
    // the same settled cloud the lap level cooked once; `dataInput`
    // aliases the bound array rather than copying it, so this is a
    // pointer per cell.
    bg.setParam(placementsIn, "items", ctx.parent?.outputs[DRESS_OUTPUTS.placements] ?? []);
    const sMin = Math.fround(ctx.sMin);
    const sMax = Math.fround(ctx.sMax);
    bg.setParam(
      mine,
      "predicate",
      mul(ge(attribute(PLACEMENT.station), sMin), lt(attribute(PLACEMENT.station), sMax)),
    );
  };

  return { graph: g, bind };
}

/**
 * The two levels, built from an already-cooked lap and its placement list.
 *
 * The lap level needs no `bind`: its graph carries the frames, the pose
 * library and the placement list as bound data already, and an unbounded
 * level has exactly one cell, so there is nothing left for a bind to vary.
 */
export function buildRacetrackLevels(input: RacetrackLevelsInput): RacetrackLevels {
  const { lap, seed } = input;
  const sectorW = input.sectorW ?? SECTOR_W;

  const lapGraph = buildDressGraph(input);
  const dressing = buildDressingGraph({ seed, halfWidth: lap.halfWidth });

  // What the World will actually cut, computed the way the runtime
  // computes it, so that anything sized off this number agrees with the
  // sectors that exist rather than with the ones that were asked for.
  const sectorCount = Math.round(lap.lengthW / sectorW);

  const levels: LevelDef[] = [
    {
      name: LEVELS.lap,
      cellSize: "unbounded",
      generationRadius: Infinity,
      graph: lapGraph,
      // EMPTY, AND DECLARED ANYWAY. The World requires every level to
      // state how a cell is wired, and the honest answer for this one is
      // "it is not": the graph already carries the frames, the pose
      // library and the placement list as bound data, and an unbounded
      // level has exactly one cell, so there is no context left to vary.
      // Saying so here is better than the alternative reading of a
      // missing bind, which is that someone forgot.
      bind() {},
    },
    {
      name: LEVELS.dressing,
      cellSize: sectorW,
      cellMode: "path",
      path: { length: lap.lengthW, closed: true },
      // DIRECTIONAL, BECAUSE A CAR CONSUMES A TRACK IN ONE DIRECTION.
      // A symmetric window would spend a quarter of its budget cooking
      // road that is already behind the mirror. Retention takes the
      // defaults, which widen each half by 1.25 independently — one
      // scalar would thrash for a car parked just past a boundary.
      aheadArc: AHEAD_SECTORS * sectorW,
      behindArc: BEHIND_SECTORS * sectorW,
      graph: dressing.graph,
      bind: dressing.bind,
    },
  ];

  return { levels, lapGraph, dressingGraph: dressing.graph, sectorCount };
}
