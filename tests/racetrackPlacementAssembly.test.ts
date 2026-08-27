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
  mixAssetCloud,
  mixPoseCloud,
  mixPoseIds,
  poseAssetId,
  poseLibrary,
  dressLapByGraph,
  type PoseLibrary,
} from "../demos/racetrack/dressGraph.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
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
    ).toEqual(
      [
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
      ].sort(),
    );

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
      const mixAssetsIn = g.add(dataInput, {}, "mixAssets");
      g.setParam(mixAssetsIn, "items", [
        makeGeometryItem(mixAssetCloud(pool, lib, new Set(), new Set())),
      ]);
      const mixPosesIn = g.add(dataInput, {}, "mixPoses");
      g.setParam(mixPosesIn, "items", [makeGeometryItem(mixPoseCloud(pool, lib))]);
      const built = addLapPlacements(
        g,
        { node: pathIn, pin: "out" },
        {
          assets: { node: assetsIn, pin: "out" },
          mixAssets: { node: mixAssetsIn, pin: "out" },
          mixPoses: { node: mixPosesIn, pin: "out" },
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
    const mixAssetsIn = g.add(dataInput, {}, "mixAssets");
    g.setParam(mixAssetsIn, "items", [
      makeGeometryItem(mixAssetCloud(pool, lib, pinned, immovable)),
    ]);
    const mixPosesIn = g.add(dataInput, {}, "mixPoses");
    g.setParam(mixPosesIn, "items", [makeGeometryItem(mixPoseCloud(pool, lib))]);
    const built = addLapPlacements(
      g,
      { node: pathIn, pin: "out" },
      {
        assets: { node: assetsIn, pin: "out" },
        mixAssets: { node: mixAssetsIn, pin: "out" },
        mixPoses: { node: mixPosesIn, pin: "out" },
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
});
