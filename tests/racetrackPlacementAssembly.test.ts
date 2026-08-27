/**
 * The placement list, built in the graph — and whether it is the list.
 *
 * WHAT THIS REPLACES AND WHY IT IS THE LAST PIECE. `dressLap` decides a
 * lap's dressing in TypeScript and `placementCloudInTrackCoords` turns the
 * answer into a cloud; `buildDressGraph` then binds that cloud in with
 * `dataInput`. Every rule downstream of it has been a graph stage for
 * weeks, so what stops a game generating a track from a serialized graph
 * and a spline is no longer a missing rule — it is that the LIST is data
 * in the graph rather than something the graph decides.
 *
 * `addLapPlacements` is the graph deciding it. The stations, D-4's
 * coverage repair and the asset choice were already stages and already
 * cooked together; what is new is {@link addPlacementAssembly}, which
 * writes the placement columns straight onto the choice's own output
 * instead of reading it back into TypeScript and building a cloud from the
 * result.
 *
 * SO THIS SUITE ASKS ONE QUESTION: is the cloud the graph builds the same
 * cloud `placementsBeforeLanguage` describes? That function is the
 * reference on purpose — it is exported precisely so that a caller cooking
 * a graph and `dressLap` computing the list again get the SAME list rather
 * than a similar one, and it ends exactly where the assembly ends, after
 * stations, assets and Z-1 and before the corner language.
 *
 * ONE COLUMN CANNOT BE COMPARED AND IT IS THE POSE. `poseFor` draws from a
 * 32-bit integer hash that the field vocabulary cannot state, so the
 * assembly re-bases onto `randomFrom` — the same re-basing
 * `addAssetChoiceStage` made for all four of its uniforms, and the same
 * consequence: the claim available is STRUCTURAL (the pose is one the kit
 * recorded for THIS asset, and the id string names it) rather than an
 * equality. Everything else is compared exactly.
 */
import { describe, expect, it } from "vitest";
import { Graph, cook, dataInput, makeGeometryItem, type Geometry } from "pcg-ts";
import { ASSET, assetCloud, cookLapPlacements } from "../demos/racetrack/assetGraph.js";
import { lapAsPath } from "../demos/racetrack/stationGraph.js";
import {
  PLACEMENT,
  addLapPlacements,
  mixPoseIds,
  placementAssetCloud,
  placementAssetRows,
  placementPoseCloud,
  poseAssetId,
  poseLibrary,
  dressLapByGraph,
  type PoseLibrary,
} from "../demos/racetrack/dressGraph.js";
import {
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  type StationedPlacement,
} from "../demos/racetrack/legibility.js";
import { SEVERITY, cornersOf } from "../demos/racetrack/corners.js";
import { BRAKING, placeCornerLanguage } from "../demos/racetrack/legibility.js";
import { cookCornerBookkeeping, type VictimPlacement } from "../demos/racetrack/cornerGraph.js";
import { placementsBeforeLanguage, reserveFor } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { lapFor } from "./support/lap.js";

const SEEDS = [1, 2, 3, 4] as const;

/** Four laps, each cooked twice — see `FOUR_LAP_MS` in the dress-graph suite. */
const FOUR_LAP_MS = 60_000;

/**
 * An assembled cloud against the list `placementsBeforeLanguage` describes.
 *
 * A FUNCTION BECAUSE TWO CALLERS BUILD THE SAME CLOUD TWO WAYS. The first
 * case below wires {@link addLapPlacements} itself; the third lets
 * `assemble` wire it, from inside `dressLapByGraph`, with no list handed in.
 * Those are different call sites with different arguments -- the pose table,
 * the pool table and the id vocabulary are all passed again -- and a
 * comparison that only ran on one of them would leave the other checked by
 * its station column alone. Measured: reversing `poseIds` at `assemble`'s
 * call site leaves every station bit-identical and every asset id wrong.
 *
 * `drawn` accumulates which poses were actually taken, per asset the kit
 * recorded several for. See the spread check at the end of the first case:
 * membership alone is satisfied by a draw that never happened.
 */
function expectAssembled(
  geo: Geometry,
  reference: readonly StationedPlacement[],
  lib: PoseLibrary,
  seed: number | string,
  drawn: Map<number, Set<number>>,
): { matched: number; multiPose: number } {
  let matched = 0;
  let multiPose = 0;
    // THE POPULATION FIRST. A cloud short by one is a pairing bug in the
    // gather, and every column comparison below would still pass on the
    // rows that did line up.
    expect(
      geo.attrs.point.count,
      `seed ${seed}: the graph built ${geo.attrs.point.count} placements, the reference ${reference.length}`,
    ).toBe(reference.length);
    expect(reference.length, `seed ${seed}: an empty lap compares nothing`).toBeGreaterThan(200);

    // AND THE COLUMN SET, WHICH NO PER-COLUMN COMPARISON CAN CHECK. A
    // column the strip forgot rides every downstream stage carrying the
    // pick's working; a column the strip took by mistake fails three
    // stages later with a name nobody recognises. Both are invisible to a
    // loop that only looks at the columns it already knows to look at.
    //
    // STATED RATHER THAN DERIVED, because the thing it is being compared
    // against is a private function -- `placementCloudInTrackCoords`, the
    // TypeScript cloud this replaces -- and exporting it to test its own
    // replacement widens the surface for a check that wants to be exact.
    // The eight standard point attributes come from `createPointCloud`;
    // the rest are that function's, in the order it adds them. If either
    // side gains a column this fails, which is the point: the two are one
    // cloud spelled twice and have to move together.
    expect(
      [...geo.attrs.point.names()].sort(),
      `seed ${seed}: the assembled cloud does not carry the columns the reference cloud does`,
    ).toEqual([...PLACEMENT_COLUMNS].sort());

    const names = [
      PLACEMENT.station,
      PLACEMENT.t,
      PLACEMENT.h,
      PLACEMENT.sizeAcross,
      PLACEMENT.sizeAlong,
      PLACEMENT.sizeTall,
      PLACEMENT.cover,
      PLACEMENT.locked,
      PLACEMENT.mixPinned,
      PLACEMENT.mixTried,
      PLACEMENT.coverRun,
      PLACEMENT.pose,
      PLACEMENT.id,
    ];
    const cols = columns(geo, names);
    const assetCol = geo.attrs.point.require(PLACEMENT.asset);

    // `PLACEMENT.id` IS A PERMUTATION OF THE ROWS, which is the whole of
    // what the column promises once the list is the graph's own. A
    // duplicate would make two placements name one row and is exactly
    // what a mis-written `index()` produces.
    const ids = [...(cols.get(PLACEMENT.id) as number[])].sort((a, b) => a - b);
    expect(ids, `seed ${seed}: placementId is not 0..n-1`).toEqual(
      reference.map((_, i) => i),
    );

    // MATCHED BY STATION AND NOT BY ROW. The graph's cloud comes out in
    // the scatter's order and the reference in the station's, so pairing
    // by position would compare unrelated placements — and would do it
    // silently, since both lists hold plausible placements throughout.
    // Two placements can never share a station: `cookLapPlacements`
    // refuses a station that kept two assets.
    const byStation = new Map<number, number>();
    const stationCol = cols.get(PLACEMENT.station) as number[];
    for (let i = 0; i < stationCol.length; i++) byStation.set(stationCol[i], i);
    expect(
      byStation.size,
      `seed ${seed}: two placements share a station, so the pairing below is ambiguous`,
    ).toBe(stationCol.length);

    for (const p of reference) {
      const row = byStation.get(p.station);
      expect(row, `seed ${seed}: no placement at station ${p.station}`).toBeDefined();
      if (row === undefined) continue;

      const at = (name: string): number => (cols.get(name) as number[])[row];
      const same: [string, number, number][] = [
        // EXACT, NOT WITHIN A BOUND. Both sides read the same cooked f32
        // columns -- the reference through `cookLapPlacements`' readback
        // and the graph through the gather -- so a difference of one ulp
        // is a different value having been fetched, not rounding.
        [PLACEMENT.t, at(PLACEMENT.t), p.t],
        [PLACEMENT.h, at(PLACEMENT.h), p.h],
        [PLACEMENT.sizeAcross, at(PLACEMENT.sizeAcross), p.asset.size.across],
        [PLACEMENT.sizeAlong, at(PLACEMENT.sizeAlong), p.asset.size.along],
        [PLACEMENT.sizeTall, at(PLACEMENT.sizeTall), p.asset.size.tall],
        [PLACEMENT.cover, at(PLACEMENT.cover), 0],
        // NOTHING IS LOCKED OR PINNED HERE, because both sets were handed
        // in empty -- which is the case that proves the columns come from
        // the TABLE rather than from a constant. The other polarity is
        // measured in the case below.
        [PLACEMENT.locked, at(PLACEMENT.locked), 0],
        [PLACEMENT.mixPinned, at(PLACEMENT.mixPinned), 0],
        [PLACEMENT.mixTried, at(PLACEMENT.mixTried), 0],
        [PLACEMENT.coverRun, at(PLACEMENT.coverRun), -1],
      ];
      for (const [name, got, want] of same) {
        // AGAINST THE f32 OF THE REFERENCE VALUE, WHICH IS NOT A
        // TOLERANCE. Every column here is f32, and three of them -- the
        // extents -- come from the kit's JSON as f64: 0.2322 is not an
        // f32, and no column can hold it. `Math.fround` names the value
        // the column DOES hold, so the comparison stays an equality
        // rather than becoming an epsilon nobody can size. It is the
        // identity on the other columns, whose values were read back out
        // of f32 storage on both sides, so it weakens nothing there.
        expect(got, `seed ${seed}: station ${p.station} differs in ${name}`).toBe(
          Math.fround(want),
        );
      }

      // THE POSE IS THE RE-BASED COLUMN, so what is checked is that it
      // belongs to THIS asset. A draw that indexed the flat table without
      // the asset's own offset would land on a real pose id belonging to
      // somebody else, and every size above would still match, because
      // the sizes come from the asset row and not from the pose.
      const poses = lib.posesOf.get(p.asset.id) ?? [];
      const pose = at(PLACEMENT.pose);
      if (poses.length === 0) {
        expect(pose, `seed ${seed}: station ${p.station} drew a pose for an unrecorded asset`)
          .toBe(-1);
      } else {
        expect(
          poses,
          `seed ${seed}: station ${p.station} drew pose ${pose}, which the kit records for a different asset`,
        ).toContain(pose);
        if (poses.length > 1) {
          multiPose++;
          let seen = drawn.get(p.asset.id);
          if (!seen) {
            seen = new Set();
            drawn.set(p.asset.id, seen);
          }
          seen.add(pose);
        }
      }
      // AND THE STRING NAMES THAT POSE. It is written from a `values`
      // table indexed by `pose + 1`, so an off-by-one in the half-table
      // offset would name the neighbouring pose -- or, past the halfway
      // mark, the COVER vocabulary, which is a different key entirely.
      expect(
        assetCol.getString(row),
        `seed ${seed}: station ${p.station}'s asset id does not name its pose`,
      ).toBe(poseAssetId(pose, false));
      matched++;
    }
  return { matched, multiPose };
}

/**
 * The columns a placement cloud carries, whoever built it.
 *
 * STATED IN ONE PLACE BECAUSE THREE CASES DEPEND ON IT. It is the eight
 * standard point attributes plus the fifteen `placementCloudInTrackCoords`
 * adds, and what makes it worth asserting rather than assuming is that
 * every stage which BUILDS a placement has to produce exactly this: a
 * column one of them forgets rides every later stage carrying somebody's
 * working, and a column one of them adds is a name nobody downstream
 * recognises. The corner language leaked 22 of the latter before anything
 * looked.
 */
const PLACEMENT_COLUMNS: readonly string[] = [
        "P",
        "rot",
        "scale",
        "density",
        "boundsMin",
        "boundsMax",
        "color",
        "seed",
        PLACEMENT.t,
        PLACEMENT.h,
        PLACEMENT.sizeAcross,
        PLACEMENT.sizeAlong,
        PLACEMENT.sizeTall,
        PLACEMENT.cover,
        PLACEMENT.pose,
        PLACEMENT.station,
        PLACEMENT.id,
        PLACEMENT.locked,
        PLACEMENT.mixPinned,
        PLACEMENT.poseU,
        PLACEMENT.mixTried,
        PLACEMENT.coverRun,
        PLACEMENT.asset,
];

/** Every scalar column of a cloud, as plain arrays. */
function columns(geo: Geometry, names: readonly string[]): Map<string, number[]> {
  const pts = geo.attrs.point;
  const out = new Map<string, number[]>();
  for (const name of names) {
    const col = pts.require(name);
    const vals: number[] = [];
    for (let i = 0; i < pts.count; i++) vals.push(col.get(i) as number);
    out.set(name, vals);
  }
  return out;
}

describe("the lap's placement list, as a graph", () => {
  it("builds the list placementsBeforeLanguage describes", async () => {
    let matched = 0;
    let multiPose = 0;
    /** Which poses were actually DRAWN, per asset the kit recorded several for. */
    const drawn = new Map<number, Set<number>>();

    for (const seed of SEEDS) {
      const { lap } = await lapFor(seed);
      const kit = shippedVocabulary();
      // ONE `reserveFor` CALL FOR BOTH SIDES. It answers a pool of the same
      // LENGTH for every seed and varies only its membership, so a pool
      // from a second call would name a different asset at a couple of
      // dozen placements with every index still in range.
      const { pool } = reserveFor(kit, seed);
      const lib = poseLibrary(kit);

      // The reference: the same cook `dressLap` would do, read back and
      // paired in TypeScript.
      const cooked = await cookLapPlacements({ lap, seed, pool });
      const reference = placementsBeforeLanguage(lap, seed, pool, {
        stations: cooked.stations,
        choices: cooked.choices,
      }).placements;

      // The graph: the same three stages plus the assembly, ending on a
      // cloud rather than on two lists.
      const g = new Graph(seed);
      const pathIn = g.add(dataInput, {}, "lapPath");
      g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
      const assetsIn = g.add(dataInput, {}, "assetTable");
      g.setParam(assetsIn, "items", [makeGeometryItem(assetCloud(pool))]);
      const rows = placementAssetRows(pool, undefined);
      const lookupIn = g.add(dataInput, {}, "placementAssets");
      g.setParam(lookupIn, "items", [
        makeGeometryItem(placementAssetCloud(rows, lib, new Set(), new Set())),
      ]);
      const posesIn = g.add(dataInput, {}, "placementPoses");
      g.setParam(posesIn, "items", [makeGeometryItem(placementPoseCloud(rows, lib))]);
      const built = addLapPlacements(
        g,
        { node: pathIn, pin: "out" },
        {
          assets: { node: assetsIn, pin: "out" },
          lookup: { node: lookupIn, pin: "out" },
          poses: { node: posesIn, pin: "out" },
        },
        { halfWidth: lap.halfWidth, assetCount: pool.length, poseIds: mixPoseIds(lib) },
        "lap",
      );
      g.output(built.out, "out", "placements");
      const geo = ((await cook(g)).outputs.placements[0] as { geo: Geometry }).geo;

      const counts = expectAssembled(geo, reference, lib, seed, drawn);
      matched += counts.matched;
      multiPose += counts.multiPose;
    }

    // THE PREMISE FOR THE POSE CLAIM, AND THE FIRST VERSION OF IT WAS TOO
    // WEAK TO BE ONE.
    //
    // Membership is all the re-based column allows -- "this pose is one the
    // kit recorded for this asset" -- and membership alone is satisfied by a
    // draw that never happened. An implementation that dropped the modulo
    // and took `poseOff` every time would give every placement its asset's
    // FIRST pose, which is a member, and pass every assertion above. It was
    // measured passing: 329 of 329 rows at seed 1, with 152 of them on
    // multi-pose assets, so counting placements-on-multi-pose-assets did not
    // exclude it either. It changes 122 placements a lap.
    //
    // What excludes it is the SPREAD: at least one asset the kit recorded
    // several poses for must have been drawn in more than one of them. A
    // constant draw gives every such asset a spread of exactly 1.
    let spread = 0;
    let widest = 0;
    for (const seen of drawn.values()) {
      if (seen.size > 1) spread++;
      widest = Math.max(widest, seen.size);
    }
    expect(
      multiPose,
      "no placement drew from an asset with more than one recorded pose, " +
        "so the pose assertions cannot tell a real draw from a constant",
    ).toBeGreaterThan(0);
    expect(
      spread,
      `every multi-pose asset was drawn in exactly one pose (${drawn.size} such assets), ` +
        "so the pose column could be a constant and these assertions would not know",
    ).toBeGreaterThan(0);
    console.log(
      `lap placements: ${matched} matched across ${SEEDS.length} laps, ` +
        `${multiPose} of them on assets with several poses; ` +
        `${spread} of ${drawn.size} such assets drew more than one pose, widest ${widest}`,
    );
  }, FOUR_LAP_MS);

  /**
   * The two set memberships, with something actually in the sets.
   *
   * SEPARATE FROM THE CASE ABOVE BECAUSE IT NEEDS THE OTHER POLARITY. That
   * one hands both sets in empty, so a `locked` column hard-wired to 0
   * passes it on every row. These are the columns L-1 reads to decide
   * whether to drop a placement rather than push it, and the ones Z-3 reads
   * to decide what it may not take — a stage that lost them would leave
   * both rules quietly weaker, on a lap that still looks right.
   */
  it("carries the immovable and pinned sets off the asset table", async () => {
    const seed = 1;
    const { lap } = await lapFor(seed);
    const kit = shippedVocabulary();
    const { pool } = reserveFor(kit, seed);
    const lib = poseLibrary(kit);

    // A THIRD OF THE POOL IN EACH, OVERLAPPING BY DESIGN. The two sets are
    // independent questions about one asset, so a stage that wrote one
    // column from the other's answer must fail here rather than on a
    // fixture where they happen to agree.
    const immovable = new Set(pool.filter((_, i) => i % 3 === 0).map((a) => a.id));
    const pinned = new Set(pool.filter((_, i) => i % 2 === 0).map((a) => a.id));

    const g = new Graph(seed);
    const pathIn = g.add(dataInput, {}, "lapPath");
    g.setParam(pathIn, "items", [makeGeometryItem(lapAsPath(lap))]);
    const assetsIn = g.add(dataInput, {}, "assetTable");
    g.setParam(assetsIn, "items", [makeGeometryItem(assetCloud(pool))]);
    const rows = placementAssetRows(pool, undefined);
    const lookupIn = g.add(dataInput, {}, "placementAssets");
    g.setParam(lookupIn, "items", [
      makeGeometryItem(placementAssetCloud(rows, lib, immovable, pinned)),
    ]);
    const posesIn = g.add(dataInput, {}, "placementPoses");
    g.setParam(posesIn, "items", [makeGeometryItem(placementPoseCloud(rows, lib))]);
    const built = addLapPlacements(
      g,
      { node: pathIn, pin: "out" },
      {
        assets: { node: assetsIn, pin: "out" },
        lookup: { node: lookupIn, pin: "out" },
        poses: { node: posesIn, pin: "out" },
      },
      { halfWidth: lap.halfWidth, assetCount: pool.length, poseIds: mixPoseIds(lib) },
      "lap",
    );
    // THE ASSET ORD IS KEPT HERE AND STRIPPED IN THE GRAPH, which is the
    // one thing this case needs that a placement does not: to check a
    // membership it has to know which asset the row holds. `addLapPlacements`
    // strips it because a placement is a track coordinate and a thing to
    // draw, so the id is read off the choice instead, one stage earlier.
    g.output(built.out, "out", "placements");
    const geo = ((await cook(g)).outputs.placements[0] as { geo: Geometry }).geo;
    const pts = geo.attrs.point;
    const locked = pts.require(PLACEMENT.locked);
    const pinnedCol = pts.require(PLACEMENT.mixPinned);
    const asset = pts.require(PLACEMENT.asset);

    // The asset behind each row, recovered through the pose: the string is
    // `pose:<id>` and the library maps an asset to its poses, so inverting
    // that map names the asset without the graph having to carry its ord.
    const assetOfPose = new Map<number, number>();
    for (const [id, poses] of lib.posesOf) for (const p of poses) assetOfPose.set(p, id);

    let lockedSeen = 0;
    let freeSeen = 0;
    let pinnedSeen = 0;
    let unpinnedSeen = 0;
    let disagree = 0;
    for (let i = 0; i < pts.count; i++) {
      const pose = Number(asset.getString(i).slice("pose:".length));
      const id = assetOfPose.get(pose);
      if (id === undefined) continue;
      const wantLocked = immovable.has(id) ? 1 : 0;
      const wantPinned = pinned.has(id) ? 1 : 0;
      expect(locked.get(i), `row ${i}: asset ${id} locked`).toBe(wantLocked);
      expect(pinnedCol.get(i), `row ${i}: asset ${id} pinned`).toBe(wantPinned);
      if (wantLocked) lockedSeen++;
      else freeSeen++;
      if (wantPinned) pinnedSeen++;
      else unpinnedSeen++;
      if (wantLocked !== wantPinned) disagree++;
    }

    // BOTH POLARITIES OF BOTH COLUMNS, AND ROWS WHERE THEY DISAGREE. A
    // column stuck at either value passes half of this, and a column
    // written from the OTHER set's answer passes all of it until the two
    // sets differ somewhere.
    expect(lockedSeen, "no placement drew a locked asset").toBeGreaterThan(0);
    expect(freeSeen, "every placement drew a locked asset").toBeGreaterThan(0);
    expect(pinnedSeen, "no placement drew a pinned asset").toBeGreaterThan(0);
    expect(unpinnedSeen, "every placement drew a pinned asset").toBeGreaterThan(0);
    expect(disagree, "the two sets agree on every drawn asset, so neither column is pinned down")
      .toBeGreaterThan(0);
    console.log(
      `lap placements, sets: ${lockedSeen} locked / ${freeSeen} free, ` +
        `${pinnedSeen} pinned / ${unpinnedSeen} not, ${disagree} rows where the two disagree`,
    );
  }, FOUR_LAP_MS);
});

/**
 * The whole dress graph, deciding its own list.
 *
 * THIS IS THE CAMPAIGN'S POINT, so it is worth saying exactly what it does
 * and does not yet prove. `dressLapByGraph` with no `placements` builds the
 * stations, D-4's repair, the asset choice and the assembly from the road
 * graph's own frames, then runs every rule over the result. Nothing about
 * the lap is data in the graph any more except the spline.
 *
 * WHAT IS STILL MISSING IS THE CORNER LANGUAGE. `dressLap` merges L-2's
 * markers and L-3's ruler marks into the list at its step 4, and
 * `addLapPlacements` stops before that -- so a lap decided here carries no
 * corner vocabulary. The language IS already a graph (`addCornerLanguage`,
 * which `cookLapPlacements` cooks in the same graph as the stations); what
 * is missing is the merge. That is the next unit, and until it lands this
 * suite must not pretend otherwise, which is why nothing below counts a
 * marker.
 */
describe("the dress graph, deciding its own list", () => {
  const SEEDS_E2E = [1, 2, 3] as const;

  it("decides the same list cookLapPlacements decides, and dresses it", async () => {
    let built = 0;

    for (const seed of SEEDS_E2E) {
      const { lap, frames } = await lapFor(seed);
      const kit = shippedVocabulary();
      const { pool } = reserveFor(kit, seed);

      const got = await dressLapByGraph({
        kit,
        lap,
        frames,
        // NO `placements`. That is the whole test.
        seed,
        immovable: new Set(),
        mixPinned: new Set(),
        pool,
      });

      // THE LIST IS THE SAME LIST, station for station. `assemble` runs the
      // stations on the road graph's FRAMES and `cookLapPlacements` runs
      // them on a polyline rebuilt from the `Lap` -- two different geometry
      // objects, which agree only if `lapAsPath`'s claim holds that the two
      // chord tables measure the same curve. The node ids are shared, so
      // the seeds are, so this is the one remaining thing that could make
      // them differ. Asserted rather than assumed.
      const cooked = await cookLapPlacements({ lap, seed, pool });
      const reference = placementsBeforeLanguage(lap, seed, pool, {
        stations: cooked.stations,
        choices: cooked.choices,
      }).placements;

      const inputCol = got.placementsInput.attrs.point.require(PLACEMENT.station);
      const mine: number[] = [];
      for (let i = 0; i < got.placementsInput.pointCount; i++) mine.push(inputCol.get(i) as number);
      expect(
        mine.slice().sort((a, b) => a - b),
        `seed ${seed}: the graph decided a different list from the one cookLapPlacements decides`,
      ).toEqual(reference.map((p) => p.station).sort((a, b) => a - b));
      expect(mine.length, `seed ${seed}: an empty lap proves nothing`).toBeGreaterThan(200);
      built += mine.length;

      // AND EVERY COLUMN OF IT, THROUGH THE SAME COMPARISON THE FIRST CASE
      // RUNS. The station list above pins one column, and `assemble` wires
      // this stage at its OWN call site -- the pose table, the pool table
      // and the id vocabulary are all passed again there. Reversing
      // `poseIds` was measured to leave every station bit-identical and
      // every asset id wrong, which is exactly the kind of mis-wiring a
      // one-column check cannot see.
      expectAssembled(
        got.placementsInput,
        reference,
        poseLibrary(kit),
        `${seed} (self-decided)`,
        new Map(),
      );

      // AND THE RULES RAN OVER IT. Every claim below is about the DRESSED
      // lap rather than the list, because a graph that decided a perfect
      // list and then failed to dress it would satisfy everything above.
      expect(got.converged, `seed ${seed}: the lap did not settle`).toBe(true);
      expect(got.stamped, `seed ${seed}: nothing was stamped`).toBeGreaterThan(0);

      // AND L-6 FIRED, which is the last stage in the chain and the one
      // that reads a measurement of everything before it. A lap that
      // settled and stamped but built no cover would mean the assembly's
      // cloud reached the boxes and not the enclosure measurement.
      const pts = got.placements.attrs.point;
      const cover = pts.require(PLACEMENT.cover);
      let coverPieces = 0;
      for (let i = 0; i < pts.count; i++) if (cover.get(i) > 0) coverPieces++;
      expect(coverPieces, `seed ${seed}: enclosure built nothing`).toBeGreaterThan(0);

      // AND ITS PIECES ARE NUMBERED APART FROM THE LIST, which nothing else
      // in the repo exercises: the order-invariance case in
      // `racetrackDressGraph.test.ts` was written for this and never
      // reaches it -- measured, L-6 adds ZERO pieces under its
      // configuration on all four of its seeds. So this is the only place
      // a cover id is ever looked at.
      //
      // THE ID USED TO BE `inputCount + index()` and needed the input
      // list's length at graph-build time, which is a number nobody has
      // once the graph decides the list. Counting down from -2 needs
      // nothing and cannot be mistaken for a row of the input list. What
      // has to hold is that the two vocabularies do not overlap: a piece
      // sharing a number with a placement would make the cull's accounting
      // name the wrong one, silently.
      const idCol = pts.require(PLACEMENT.id);
      const pieceIds = new Set<number>();
      let placementIds = 0;
      for (let i = 0; i < pts.count; i++) {
        const id = idCol.get(i) as number;
        if (cover.get(i) > 0) {
          expect(id, `seed ${seed}: a cover piece has id ${id}, which names a row of the list`)
            .toBeLessThan(0);
          expect(pieceIds.has(id), `seed ${seed}: two cover pieces share id ${id}`).toBe(false);
          pieceIds.add(id);
        } else {
          expect(id, `seed ${seed}: a placement has a negative id`).toBeGreaterThanOrEqual(0);
          placementIds++;
        }
      }
      expect(pieceIds.size, `seed ${seed}: no cover piece to check an id on`).toBe(coverPieces);
      expect(placementIds, `seed ${seed}: every row is cover`).toBeGreaterThan(0);

      // THERE IS NO Z-1 ASSERTION HERE, AND THE FIRST DRAFT HAD ONE. It
      // counted placements sitting inside the corridor and expected zero,
      // and three of seed 1's 340 do. They are not this stage's doing: a
      // lap dressed from a HANDED-IN list has the same thing at the same
      // rate -- 3, 7 and 4 of ~350 against 3, 5 and 3 here -- so what the
      // assertion found is a property of the dressed lap in both modes,
      // and not a difference between them. L-5 is not the cause either
      // (`edgeDrop` is 0 on every one of them). It belongs to whatever
      // rule puts them there, with a reference to compare against; a
      // suite about where the LIST comes from is the wrong place to
      // discover it, and a bound tuned to make it pass here would bury
      // it. Recorded in PLAN.md instead.
    }

    console.log(
      `dress graph, self-decided: ${built} placements over ${SEEDS_E2E.length} laps, ` +
        "no list handed in",
    );
  }, FOUR_LAP_MS);

  /**
   * D-1's density, through the door the page's slider needs.
   *
   * THE COMPARISON IS THE TEST AND THE COUNT IS WHAT THE COMPARISON CANNOT
   * SEE. `cookLapPlacements` takes `densityScale` and so does
   * {@link addLapPlacements}; the equality below fails the moment
   * `assemble` stops forwarding it, because the reference would thin and
   * the graph would not. What it would NOT catch is the option going inert
   * in both at once -- a rename inside `addStationStage`, say -- which
   * reads as two lists agreeing perfectly at the fitted rate. So the count
   * is asserted to have MOVED as well, and in the direction asked for.
   *
   * IT IS VERY NEARLY HALF, WHICH WAS NOT THE EXPECTED ANSWER. D-4's
   * coverage repair runs after the stations and adds back wherever the
   * thinning opened a gap wider than it allows, so a lap at x0.5 could
   * reasonably have come out well above half; measured, seed 1 lays 165
   * against 329, which is 0.501. So the repair is not what decides this
   * population's size at either rate, and the band below is asserted
   * rather than a bare direction -- a lap that came back at 0.8 would be
   * D-4 having become the binding constraint, which is a real finding and
   * not a tolerance to widen.
   *
   * THE LAP HERE CARRIES NO CORNER LANGUAGE (no `markers`), and that is
   * why the proportion is this clean. L-2 and L-3 place per CORNER, not
   * per station, so a lap with a marker kit thins by less than its rate.
   */
  it("takes the density scale the page's slider sets", async () => {
    const seed = 1;
    const { lap, frames } = await lapFor(seed);
    const kit = shippedVocabulary();
    const { pool } = reserveFor(kit, seed);
    const densityScale = 0.5;

    const got = await dressLapByGraph({
      kit,
      lap,
      frames,
      seed,
      immovable: new Set(),
      mixPinned: new Set(),
      pool,
      densityScale,
    });

    const cooked = await cookLapPlacements({ lap, seed, pool, densityScale });
    const reference = placementsBeforeLanguage(lap, seed, pool, {
      stations: cooked.stations,
      choices: cooked.choices,
    }).placements;

    const col = got.placementsInput.attrs.point.require(PLACEMENT.station);
    const mine: number[] = [];
    for (let i = 0; i < got.placementsInput.pointCount; i++) mine.push(col.get(i) as number);
    expect(
      mine.slice().sort((a, b) => a - b),
      "the graph ignored densityScale, or scaled by something else",
    ).toEqual(reference.map((p) => p.station).sort((a, b) => a - b));

    const full = await cookLapPlacements({ lap, seed, pool });
    const fullCount = placementsBeforeLanguage(lap, seed, pool, {
      stations: full.stations,
      choices: full.choices,
    }).placements.length;
    const ratio = mine.length / fullCount;
    expect(
      ratio,
      `x${densityScale} laid ${mine.length} placements against x1.00's ${fullCount}, ` +
        `a ratio of ${ratio.toFixed(3)} where 0.5 is asked for`,
    ).toBeGreaterThan(0.4);
    expect(
      ratio,
      `x${densityScale} laid ${mine.length} placements against x1.00's ${fullCount}, ` +
        `a ratio of ${ratio.toFixed(3)}: the scale moved little or nothing`,
    ).toBeLessThan(0.6);

    console.log(
      `density scale: x${densityScale} -> ${mine.length} placements, x1.00 -> ${fullCount}`,
    );
  }, FOUR_LAP_MS);
});

/**
 * L-2 and L-3, placed by the graph.
 *
 * WHAT THIS UNIT DOES AND WHAT IT POINTEDLY DOES NOT. `placeCornerLanguage`
 * does four things with the corner language: it CONVERTS an ordinary
 * placement into a marker where the window holds a good victim, ADDS a
 * marker where it does not, places L-3's three ruler marks per tight
 * corner, and DISPLACES what those marks pay for. Two of the four are pure
 * placement and are what `addLapPlacements` does now: every corner gets its
 * marker and every tight corner gets its three marks.
 *
 * THE OTHER TWO ARE THE BOOKKEEPING and are not wired yet. `buildCornerBookkeeping`
 * already decides both -- which placement each corner claims, and which
 * each ruler displaces -- as columns on the placement cloud; what is
 * missing is applying them. So a lap from this path carries MORE
 * placements than the reference: a conversion becomes an addition, and
 * nothing is removed to pay for a ruler. That is a difference this suite
 * states rather than tolerates, and the count is asserted in the direction
 * it must be wrong in, so that wiring the bookkeeping is visible here as a
 * change rather than as continued silence.
 */
describe("the corner language, placed by the graph", () => {
  it("marks every corner and rules every tight one", async () => {
    const kit = shippedVocabulary();
    let markersPlaced = 0;
    let rulerMarks = 0;
    let converted = 0;
    let displaced = 0;

    for (const seed of [1, 2, 3] as const) {
      const { lap, frames } = await lapFor(seed);
      const { pool, markers } = reserveFor(kit, seed);
      expect(markers, `seed ${seed}: the shipped kit reserved no markers`).toBeDefined();
      if (!markers) continue;
      const lib = poseLibrary(kit);
      const corners = cornersOf(lap);

      const got = await dressLapByGraph({
        kit,
        lap,
        frames,
        seed,
        immovable: new Set([markers.brake.id]),
        mixPinned: new Set([markers.sharp.id, markers.open.id, markers.brake.id]),
        pool,
        markers,
      });

      // THE CLOUD BACK INTO THE SHAPE THE RULE'S OWN GATES TAKE. A
      // placement's asset is recovered through its pose, because the cloud
      // carries the pose name and not the kit id -- `poseAssetId` keys by
      // pose deliberately, and inverting the library is what turns that
      // back into an asset. Cover pieces are skipped: they are L-6's and
      // carry no kit asset of the pool's.
      const rows = placementAssetRows(pool, markers);
      const assetOfPose = new Map<number, (typeof rows)[number]>();
      for (const a of rows) for (const p of lib.posesOf.get(a.id) ?? []) assetOfPose.set(p, a);

      const pts = got.placementsInput.attrs.point;
      const pose = pts.require(PLACEMENT.pose);
      const station = pts.require(PLACEMENT.station);
      const t = pts.require(PLACEMENT.t);
      const h = pts.require(PLACEMENT.h);
      const list: StationedPlacement[] = [];
      for (let i = 0; i < pts.count; i++) {
        const a = assetOfPose.get(pose.get(i) as number);
        if (!a) continue;
        list.push({
          asset: a,
          station: station.get(i) as number,
          t: t.get(i) as number,
          h: h.get(i) as number,
        });
      }
      expect(
        list.length,
        `seed ${seed}: no placement's pose named an asset, so nothing below is checked`,
      ).toBeGreaterThan(200);

      // EVERY CORNER CARRIES ITS MARKER, by the rule's own gate -- right
      // archetype for the severity, on the outside, inside the window.
      const marked = cornerMarkersSatisfied(list, corners, markers, lap.lengthW);
      expect(
        marked.missing,
        `seed ${seed}: ${marked.missing.length} of ${corners.length} corners have no marker`,
      ).toEqual([]);
      markersPlaced += corners.length;

      // AND EVERY TIGHT CORNER ITS THREE MARKS, evenly spaced end to end
      // across the braking window and sharing one lateral. That last part
      // is what `brakingRulersSatisfied` is really for: three marks drawn
      // per MARK rather than per corner is the one way to get L-3 wrong
      // that every count survives.
      const ruled = brakingRulersSatisfied(list, corners, markers, lap.lengthW);
      expect(
        ruled.failures,
        `seed ${seed}: ${ruled.failures.length} braking rulers do not hold`,
      ).toEqual([]);
      const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW);
      expect(tight.length, `seed ${seed}: no tight corner, so L-3 placed nothing`).toBeGreaterThan(
        0,
      );
      rulerMarks += list.filter((p) => p.asset.id === markers.brake.id).length;

      // THE SAME COLUMNS, WHICH IS WHAT THE MERGE RESTS ON. Two assemblies
      // feed it, and a column on one side and not the other is filled by a
      // default -- silently, on every row of the other kind. The corner
      // stages resolve a whole corner model onto their clouds and it all
      // rode in: 45 columns instead of 23, through the repair loop, until
      // this assertion existed. The no-marker case checks the same list, so
      // between them both branches are pinned.
      expect(
        [...got.placementsInput.attrs.point.names()].sort(),
        `seed ${seed}: the corner language changed the placement cloud's columns`,
      ).toEqual([...PLACEMENT_COLUMNS].sort());

      // AND THE LIST IS NUMBERED ONCE, WHICH IS THE OTHER THING THIS UNIT
      // CHANGED. `PLACEMENT.id` used to be written inside the assembly,
      // and the assembly runs TWICE on a lap with a corner language -- once
      // over the chosen rows and once over L-2's and L-3's -- so `index()`
      // there numbers both from zero and gives every marker the id of an
      // ordinary placement. The no-marker case cannot see that: it runs one
      // assembly. This is the only place the defect the move fixed is
      // reachable.
      const idCol = pts.require(PLACEMENT.id);
      const ids: number[] = [];
      for (let i = 0; i < pts.count; i++) ids.push(idCol.get(i) as number);
      expect(
        [...ids].sort((a, b) => a - b),
        `seed ${seed}: the merged list is not numbered 0..n-1`,
      ).toEqual(ids.map((_, i) => i));

      // THE MARKERS ARE PROTECTED, AND THIS IS THE ASSERTION THAT SAYS SO.
      // The case hands in `immovable` and `mixPinned` and the columns are
      // what carry them: L-3's brake mark must be DROPPED rather than
      // shoved out of line, and all three reserved assets must be off
      // limits to Z-3's redraw.
      const lockedCol = pts.require(PLACEMENT.locked);
      const pinnedCol = pts.require(PLACEMENT.mixPinned);
      let brakeRows = 0;
      let markerRows = 0;
      for (let i = 0; i < pts.count; i++) {
        const a = assetOfPose.get(pose.get(i) as number);
        if (!a) continue;
        const reserved =
          a.id === markers.sharp.id || a.id === markers.open.id || a.id === markers.brake.id;
        if (!reserved) continue;
        markerRows++;
        expect(pinnedCol.get(i), `seed ${seed}: a reserved asset is not pinned against Z-3`).toBe(1);
        if (a.id === markers.brake.id) {
          brakeRows++;
          expect(lockedCol.get(i), `seed ${seed}: a brake mark is not locked against L-1`).toBe(1);
        }
      }
      expect(markerRows, `seed ${seed}: no reserved asset on the lap to check`).toBeGreaterThan(0);
      expect(brakeRows, `seed ${seed}: no brake mark to check`).toBeGreaterThan(0);

      // AND THEY SURVIVE THE LOOP, which is the only thing that makes the
      // pinning worth anything. Every assertion above reads
      // `placementsInput`, the list BEFORE any rule ran -- so a Z-3 that
      // redrew half the markers into ordinary scenery would leave all of it
      // green. Measured with the two sets emptied: seed 3 comes out of the
      // loop holding 19 of its 25 markers, and nothing else in this case
      // notices.
      const finalPts = got.placements.attrs.point;
      const finalPose = finalPts.require(PLACEMENT.pose);
      let survivingMarkers = 0;
      let survivingBrake = 0;
      for (let i = 0; i < finalPts.count; i++) {
        const a = assetOfPose.get(finalPose.get(i) as number);
        if (!a) continue;
        if (a.id === markers.sharp.id || a.id === markers.open.id) survivingMarkers++;
        if (a.id === markers.brake.id) survivingBrake++;
      }
      expect(
        survivingMarkers,
        `seed ${seed}: the repair loop lost ${corners.length - survivingMarkers} of ${corners.length} corner markers`,
      ).toBe(corners.length);
      // L-1 MAY DROP A BRAKE MARK AND THAT IS THE RULE WORKING -- `locked`
      // means "drop rather than push", so a mark whose sightline is blocked
      // goes. What must not happen is losing most of them, which is what a
      // marker treated as ordinary scenery would look like.
      expect(
        survivingBrake,
        `seed ${seed}: only ${survivingBrake} of ${tight.length * BRAKING.count} brake marks survived`,
      ).toBeGreaterThanOrEqual(tight.length * BRAKING.count - 2);

      // AND THE LIST IS THE LIST `placeCornerLanguage` BUILDS. This
      // replaced a count identity -- chosen plus one per corner plus three
      // per tight corner -- which was exactly right while only the
      // PLACEMENTS were wired and is exactly wrong now that the bookkeeping
      // is: a conversion replaces an addition and a displacement removes a
      // row, so seed 1 went from 375 to 341 the moment the loops were
      // applied. That assertion did its job by failing.
      //
      // WHAT THIS COMPARISON CAN AND CANNOT CATCH, WHICH IS WORTH STATING
      // BECAUSE IT LOOKS LIKE MORE THAN IT IS. The reference below is
      // `placeCornerLanguage` fed `booked` from `cookCornerBookkeeping` --
      // which runs the SAME `addVictimSearch` this graph does. So a defect
      // in the victim search moves both sides and this stays green:
      // measured, flipping the station rank from min to max leaves this
      // case failing only on its own premise assertion, and for the wrong
      // reason. What owns the search is
      // `tests/racetrackCornerBookkeeping.test.ts`, which compares against a
      // hand-written TypeScript `reference()` -- an independent
      // implementation -- and does catch that flip.
      //
      // WHAT THIS OWNS IS THE APPLICATION: given a claim and a
      // displacement, does the right placement become the right marker,
      // does the right row go, and does an unclaimed corner get its marker
      // added. Those are all in `dressGraph` and the reference does them
      // in TypeScript, so the two sides really are independent there.
      //
      // THE REFERENCE IS THE RULE RUN WITH BOTH GRAPH ANSWERS HANDED TO IT.
      // `placeCornerLanguage` takes `drawn` (where the marks go) and
      // `booked` (who was claimed, who was displaced) precisely so a caller
      // that cooked those can compare; given both it does nothing but the
      // bookkeeping, which is what this stage does too.
      const cooked = await cookLapPlacements({ lap, seed, pool, markers });
      const chosen = placementsBeforeLanguage(lap, seed, pool, {
        stations: cooked.stations,
        choices: cooked.choices,
      }).placements;
      const victims: VictimPlacement[] = [];
      for (let i = 0; i < cooked.stations.stations.length; i++) {
        const ch = cooked.choices[i];
        if (!ch) continue;
        victims.push({ assetOrd: ch.assetIndex, station: cooked.stations.stations[i], t: ch.t });
      }
      const booked = await cookCornerBookkeeping({
        placements: victims,
        corners,
        lapW: lap.lengthW,
      });
      const reference = placeCornerLanguage(
        chosen,
        corners,
        markers,
        lap.lengthW,
        seed,
        cooked.language,
        booked,
      );
      expect(
        got.placementsInput.pointCount,
        `seed ${seed}: the graph built ${got.placementsInput.pointCount} placements where ` +
          `placeCornerLanguage builds ${reference.placements.length}`,
      ).toBe(reference.placements.length);

      // AND PLACEMENT FOR PLACEMENT, NOT JUST COUNT FOR COUNT. A count
      // survives any mutation that moves a row rather than adding or
      // removing one -- converting the wrong victim, giving a marker the
      // wrong corner's lateral, displacing a different placement. Every one
      // of those keeps the total and changes the lap.
      //
      // KEYED ON (station, asset), WHICH IS WHAT IDENTIFIES A PLACEMENT
      // HERE. The row ORDER differs by construction -- the graph's cloud is
      // in the scatter's order and the reference's list is in station order
      // -- so position would compare unrelated rows. A conversion keeps the
      // victim's station and changes its asset, so the pair moves exactly
      // when a conversion lands somewhere else.
      // THE LATERAL AND THE HEIGHT ARE IN THE KEY, and they are not padding.
      // Without them, SWAPPING the drawn lateral and height between two
      // conversions whose corners share severity and side is invisible to
      // this entire case: the multiset is byte-identical, and both rule
      // gates still pass, because `cornerMarkersSatisfied` checks only the
      // SIGN of the lateral and that the height is in the marker band --
      // and every marker's height is drawn from that same band. Seeds 1, 2
      // and 3 each have such a pair (corners 1/15, 1/7 and 3/12). So a
      // gather that fetched the wrong corner's row for a whole class of
      // pairs would have read as correct.
      const key = (station: number, id: number, t: number, h: number): string =>
        `${station.toFixed(4)}:${id}:${t.toFixed(4)}:${h.toFixed(4)}`;
      const wantKeys = reference.placements
        .map((p) => key(p.station, p.asset.id, p.t, p.h))
        .sort();
      const gotKeys: string[] = [];
      for (let i = 0; i < pts.count; i++) {
        const a = assetOfPose.get(pose.get(i) as number);
        if (!a) continue;
        gotKeys.push(
          key(station.get(i) as number, a.id, t.get(i) as number, h.get(i) as number),
        );
      }
      gotKeys.sort();
      expect(
        gotKeys.length,
        `seed ${seed}: ${pts.count - gotKeys.length} placements have a pose no asset owns`,
      ).toBe(reference.placements.length);
      expect(
        gotKeys,
        `seed ${seed}: the graph's lap is not the lap placeCornerLanguage builds`,
      ).toEqual(wantKeys);

      // AND THE FIXTURE EXERCISES BOTH HALVES, which a count comparison
      // cannot show on its own: a lap where nothing converted and nothing
      // displaced agrees with a stage that applied neither.
      expect(
        reference.converted,
        `seed ${seed}: no corner converted a placement, so CONVERT is untested here`,
      ).toBeGreaterThan(0);
      expect(
        reference.brakeDisplaced,
        `seed ${seed}: no ruler displaced anything, so DISPLACE is untested here`,
      ).toBeGreaterThan(0);
      converted += reference.converted;
      displaced += reference.brakeDisplaced;

      // AND THE LAP STILL SETTLES WITH THE LANGUAGE IN IT. The markers are
      // pinned against Z-3 and the brake marks are locked against L-1, so
      // the repair loop has two populations it may not move -- which is the
      // one thing about this arrangement that could fail to converge.
      expect(got.converged, `seed ${seed}: the lap did not settle`).toBe(true);
    }

    console.log(
      `corner language in the graph: ${markersPlaced} corners marked, ` +
        `${rulerMarks} ruler marks over 3 laps; ` +
        `${converted} converted, ${displaced} displaced`,
    );
  }, FOUR_LAP_MS);
});
