/**
 * L-1's exemption for L-6's cover, on a population that reaches it.
 *
 * WHY THIS IS ITS OWN FILE AND NOT A LINE IN THE DRESS-GRAPH SUITE. The
 * claim here cannot be checked on a lap the shipped vocabulary produces,
 * and that is the whole reason the exemption was missing for as long as it
 * was. A cover piece's base clears `CORRIDOR.ceilingW` by construction —
 * `coverPlacements` floors its CENTRE at `1.2 + tall/2` and the lowest one
 * over seeds 1-6 sits at 3.6W — while every chord of L-1's cone runs from
 * an eye at `SIGHTLINE.eyeW`, 0.3W, down to a target on the road surface.
 * Nothing in the fan reaches a tunnel, so over seeds 1-6 not one of the 69
 * cover pieces is pushed or dropped, and a test written over those laps
 * would be green for a `writeSightlineCull` with the exemption deleted.
 *
 * SO THE POPULATION IS CONSTRUCTED, AND IT IS CONSTRUCTED THE WAY THE
 * SIBLING CASE FOR L-3's LOCK IS. "drops a locked asset rather than pushing
 * it" in `tests/racetrackDressGraph.test.ts` reaches a branch real data does
 * not by locking an asset that IS among the blockers and watching the
 * verdict flip. This does the same with the other flag: it finds a placement
 * this lap's cone actually blocks, marks it as cover, and requires the
 * verdict to become "not tested" rather than "pushed". Marking an ordinary
 * placement is the honest construction of the three available — lowering
 * the cover would need a kit that cannot state a base under 1.2W, and
 * raising the eye would need `SIGHTLINE` to be a parameter, which it is
 * not — because the exemption IS keyed on the column, so a point carrying
 * the column is exactly the subject of the rule. What it does not claim is
 * that the shipped kit builds such a piece; it claims that if one ever
 * arrives, L-1 leaves it alone.
 *
 * THE PAIRING IS THE TEST. An assertion that a cover piece was not pushed
 * is worth nothing on its own — a cull that pushed nothing at all would
 * satisfy it. So the same placement, at the same station, with the same
 * frame, is cooked twice and the flag is the ONLY difference: without it
 * L-1 moves the piece, with it L-1 does not. Run against the spelling this
 * replaces — `occlusionCull` handed the whole cloud — the second half
 * fails, which is the only reason to believe it is testing anything.
 *
 * AND Z-1 IS HELD OUT OF THE COMPARISON RATHER THAN ASSUMED HARMLESS. The
 * `cover` column is read by two rules: this one and the corridor, where it
 * has meant "leave this alone" since `corridorFields` was written. A
 * placement Z-1 had moved would therefore arrive at L-1 somewhere else once
 * the flag was on, and the comparison would be between two different laps.
 * The subject is picked from the placements Z-1 leaves where they are, and
 * the pre-cull position is then asserted identical across the two cooks —
 * which is what makes the difference in the verdict L-1's alone.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry, type Geometry } from "pcg-ts";
import {
  DRESS_OUTPUTS,
  PLACEMENT,
  buildRoundGraph,
} from "../demos/racetrack/dressGraph.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { reserveMarkers, type StationedPlacement } from "../demos/racetrack/legibility.js";
import { FITTED, makeStationsDetailed } from "../demos/racetrack/stations.js";
import { bucketOf, placeAsset, type PlaceableAsset } from "../demos/racetrack/assets.js";
import { radiusAtW } from "../demos/racetrack/corners.js";
import { SIGHTLINE } from "../demos/racetrack/sightline.js";
import { lapFor } from "./support/lap.js";
import type { Lap } from "../demos/racetrack/lap.js";

/**
 * The seed this runs on.
 *
 * ONE LAP AND NOT FOUR, because what is being checked is a rule and not a
 * distribution: the exemption either holds for a blocked cover piece or it
 * does not, and a second lap would be a second copy of the same yes. The
 * lap has to supply a blocker, which the assertions below require rather
 * than assume.
 */
const SEED = 1;

/** Two cooks of one round each; well inside the default, stated anyway. */
const ROUND_MS = 60_000;

/** The pool `dressLap` reserves at this seed — membership varies, length does not. */
function poolFor(seed: number): PlaceableAsset[] {
  const kit = shippedVocabulary();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  return reserveMarkers(all, seed).pool;
}

/**
 * `dressLap`'s steps 0 to 2, which is the list Z-1 and L-1 have not seen.
 *
 * THE SETTLED LIST WOULD MEASURE NOTHING. A lap that has been through the
 * repair loop is one where L-1 has no work left, so the cull run over it
 * pushes nothing and there is no blocker to mark. This rebuilds the list
 * from the same exported pieces `dressLap` calls, which is the same thing
 * `beforeCorridor` does in the dress-graph suite and for the same reason.
 */
function beforeRepairs(lap: Lap, seed: number): StationedPlacement[] {
  const pool = poolFor(seed);
  const st = makeStationsDetailed(lap.lengthW, seed, FITTED);
  const out: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const p = placeAsset(pool, bucketOf(radiusAtW(lap, s)), seed, i);
    if (p) out.push({ ...p, station: s });
  }
  return out;
}

/** Every placement's row, keyed on the id it came in with. */
interface Row {
  readonly t: number;
  readonly push: number;
  readonly placedP: [number, number, number];
}

function byId(geo: Geometry): Map<number, Row> {
  const pts = geo.attrs.point;
  const id = pts.require(PLACEMENT.id);
  const t = pts.require(PLACEMENT.t);
  const placedP = pts.require(PLACEMENT.placedP);
  const push = pts.has(PLACEMENT.pushW) ? pts.require(PLACEMENT.pushW) : undefined;
  const out = new Map<number, Row>();
  for (let i = 0; i < pts.count; i++) {
    out.set(id.get(i), {
      t: t.get(i),
      push: push === undefined ? 0 : push.get(i),
      placedP: [placedP.get(i, 0), placedP.get(i, 1), placedP.get(i, 2)],
    });
  }
  return out;
}

describe("L-1 and L-6's cover", () => {
  it("leaves a cover piece that blocks the cone where it is", async () => {
    const { lap, frames } = await lapFor(SEED);
    const kit = shippedVocabulary();
    const pool = poolFor(SEED);
    // Z-3 OFF, THE WAY THE DRESS-GRAPH SUITE SWITCHES IT OFF — through the
    // rule's own parameter. Pinning the whole pool leaves the mix no donor,
    // so the round reduces to Z-1, L-1 and L-5, and a redraw cannot change
    // the subject's asset between the two cooks.
    const noMix = new Set(pool.map((a) => a.id));
    const round = (placements: readonly StationedPlacement[]) =>
      cook(
        buildRoundGraph({
          kit,
          lap,
          frames,
          placements,
          seed: SEED,
          immovable: new Set<number>(),
          mixPinned: noMix,
          pool,
        }),
        { outputs: [DRESS_OUTPUTS.placed, DRESS_OUTPUTS.placements] },
      );

    const src = beforeRepairs(lap, SEED);
    expect(src.length, "this lap placed nothing to cull").toBeGreaterThan(0);
    expect(
      src.some((p) => p.cover),
      "the assembled list already carries cover, so the flag is not this test's to set",
    ).toBe(false);

    const open = (await round(src)).outputs;
    const openBefore = firstGeometry(open[DRESS_OUTPUTS.placed] ?? []);
    const openAfter = firstGeometry(open[DRESS_OUTPUTS.placements] ?? []);
    if (!openBefore || !openAfter) throw new Error("the round graph produced no placements");
    const beforeRow = byId(openBefore);
    const afterRow = byId(openAfter);

    // A BLOCKER Z-1 DID NOT TOUCH, which is the pair of conditions the
    // header argues for: it has to be something L-1 acts on, and something
    // the corridor rule leaves alone, or the flag would change two rules at
    // once and the comparison would be between two laps.
    const stillWhereItWas = (id: number): boolean => {
      const b = beforeRow.get(id);
      return b !== undefined && b.t === Math.fround(src[id].t);
    };
    const pushed = [...afterRow.entries()]
      .filter(([id, r]) => r.push !== 0 && stillWhereItWas(id))
      .map(([id]) => id);
    expect(
      pushed.length,
      "L-1 pushed nothing Z-1 had left alone, so there is no blocker to mark as cover",
    ).toBeGreaterThan(0);
    const subject = pushed[0];
    const wasPushed = afterRow.get(subject);
    if (wasPushed === undefined) throw new Error("unreachable");

    // THE FLAG, AND NOTHING ELSE. Same station, same asset, same pose draw
    // — `placementCloudInTrackCoords` keys the pose on the station, so a
    // piece that keeps its station keeps its mesh.
    const marked = src.map((p, i) => (i === subject ? { ...p, cover: true } : p));
    const shut = (await round(marked)).outputs;
    const shutBefore = firstGeometry(shut[DRESS_OUTPUTS.placed] ?? []);
    const shutAfter = firstGeometry(shut[DRESS_OUTPUTS.placements] ?? []);
    if (!shutBefore || !shutAfter) throw new Error("the round graph produced no placements");
    const shutBeforeRow = byId(shutBefore);
    const shutAfterRow = byId(shutAfter);

    // THE POPULATION L-1 SAW IS THE SAME POPULATION, asserted rather than
    // reasoned about: if Z-1 had moved the piece once the flag was on, the
    // cull would be answering a different question and every line below
    // would be measuring that instead.
    const arrivedOpen = beforeRow.get(subject);
    const arrivedShut = shutBeforeRow.get(subject);
    if (arrivedOpen === undefined || arrivedShut === undefined) {
      throw new Error("the subject is missing from a pre-cull cloud");
    }
    expect(arrivedShut.placedP, "the flag moved the piece before L-1 ever saw it").toEqual(
      arrivedOpen.placedP,
    );

    // AND THE VERDICT FLIPS. Not "was not dropped" and not "was not pushed
    // far" — the piece is where it arrived, to the bit, and `conePushW`
    // says so, which is the same number a placement L-1 cleared reports.
    const kept = shutAfterRow.get(subject);
    expect(kept, `L-1 dropped the cover piece at ${src[subject].station.toFixed(1)}W`).toBeDefined();
    if (kept === undefined) throw new Error("unreachable");
    expect(kept.push, "L-1 pushed a cover piece, which puts a hole in the roof").toBe(0);
    expect(kept.t, "the cover piece's lateral moved").toBe(arrivedShut.t);

    // THE BOUND MOVED ASIDE. Without the flag the same placement, from the
    // same list, was pushed — so the assertions above are about the
    // exemption and not about a cone that never fires.
    expect(
      Math.abs(wasPushed.push),
      "the unmarked subject was not pushed, so the pair proves nothing",
    ).toBeGreaterThan(0);
    console.log(
      `L-1 cover exemption: placement ${subject} at ${src[subject].station.toFixed(1)}W is ` +
        `pushed ${wasPushed.push.toFixed(2)}W of ${SIGHTLINE.maxPushW}W as dressing and ` +
        `${kept.push}W as cover`,
    );

    // AND THE EXEMPTION IS NOT A BLANKET PASS ON THE ROUND. Every other
    // placement's verdict is unchanged, which is what `pushClearance: 0`
    // guarantees and what the split has to preserve: taking one point out
    // of the cull's input may not move any point left in it.
    for (const [id, row] of afterRow) {
      if (id === subject) continue;
      const now = shutAfterRow.get(id);
      expect(now, `placement ${id} survived without the flag and not with it`).toBeDefined();
      if (now === undefined) continue;
      expect(now.push, `placement ${id}: L-1's verdict moved with someone else's flag`).toBe(
        row.push,
      );
      expect(now.t, `placement ${id}: lateral moved with someone else's flag`).toBe(row.t);
    }
    // The subject was PUSHED rather than dropped without the flag, so it is
    // in both survivor sets and the two counts are the same number. Stated
    // as a count because the loop above only walks the open run's ids: a
    // placement the marked run kept and the open one dropped would slip
    // past it.
    expect(
      shutAfterRow.size,
      "marking one placement as cover changed how many survived",
    ).toBe(afterRow.size);
  }, ROUND_MS);
});
