/**
 * L-2's markers and L-3's rulers, as a graph.
 *
 * WHAT CAN AND CANNOT BE COMPARED HERE, and it is a mix this time. The
 * ruler STATIONS carry no draw — 6, 10.5 and 15 W before the entry — so
 * they are checkable against `rulerStations` to the bit, and that is the
 * strongest claim in the file because it is the one the shipped gate
 * `brakingRulersSatisfied` depends on: it looks for a mark AT each of
 * those stations, so a graph half a W off would fail every ruler on the
 * lap. Everything DRAWN re-bases, for the reason the station port set out:
 * `randomField` keys on point identity rather than on a stream position.
 * So the drawn quantities are judged by their ranges, their independence
 * and their per-corner constancy, and the arithmetic around them is
 * judged exactly.
 *
 * THE ONE THAT WOULD BE INVISIBLE. L-3's three marks must share ONE
 * lateral — "they are a line, not a scatter" — and the way to get that
 * wrong in a graph is to draw the magnitude after `copyToPoints` instead
 * of before it, because a copy has its own identity and `randomField`
 * would then answer three different numbers. Every count still passes, the
 * gate's own spread check is the only thing that would notice, and the
 * lap reads as a scatter of three. It has its own test below.
 */
import { describe, expect, it } from "vitest";
import {
  cookCornerLanguage,
  cookReserveMarkers,
  markerCloud,
} from "../demos/racetrack/cornerGraph.js";
import { cookCorners } from "../demos/racetrack/cornerGraph.js";
import {
  BRAKING,
  MARKER,
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  markerCandidates,
  placeCornerLanguage,
  reserveMarkers,
  rulerStations,
} from "../demos/racetrack/legibility.js";
import { SEVERITY } from "../demos/racetrack/corners.js";
import { type PlaceableAsset, drawQuantile } from "../demos/racetrack/assets.js";
import { reserveFor } from "../demos/racetrack/dress.js";
import { shippedVocabulary } from "../demos/racetrack/vocabulary.js";
import { SAME_PLACE_W, SAME_STATION_W } from "../demos/racetrack/tolerance.js";
import { cookLapPlacements } from "../demos/racetrack/assetGraph.js";
import { dressLap } from "../demos/racetrack/dress.js";
import { lapFor } from "./support/lap.js";

const KIT = shippedVocabulary();

/** The reserved three for a seed, the way `dressLap` gets them. */
function markersFor(seed: number) {
  const pool = (KIT.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const { markers } = reserveMarkers(pool, seed);
  if (!markers) throw new Error("racetrackCornerLanguage: this kit reserved no markers");
  return markers;
}

describe("cornerLanguage: what the graph decides", () => {
  it("puts a ruler's three marks exactly where rulerStations puts them", async () => {
    // THE CLAIM THE SHIPPED GATE RESTS ON. `brakingRulersSatisfied` looks
    // for a mark AT each station `rulerStations` names, within
    // SAME_STATION_W, so a graph that computed the window differently
    // would fail every ruler on the lap rather than drift quietly.
    const { lap } = await lapFor(1);
    const corners = await cookCorners({ lap });
    const tight = corners.filter((c) => c.tightestW < SEVERITY.tightW);
    const out = await cookCornerLanguage({ lap, seed: 1, markers: markersFor(1) });
    expect(out.rulers.length).toBe(tight.length * BRAKING.count);
    let worst = 0;
    for (let ti = 0; ti < tight.length; ti++) {
      const want = rulerStations(tight[ti], lap.lengthW);
      for (let k = 0; k < BRAKING.count; k++) {
        const got = out.rulers[ti * BRAKING.count + k];
        expect(got.corner, `ruler ${ti} mark ${k} names its corner`).toBe(
          corners.indexOf(tight[ti]),
        );
        const d = Math.abs(got.station - want[k]) % lap.lengthW;
        worst = Math.max(worst, Math.min(d, lap.lengthW - d));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`ruler stations vs rulerStations: worst ${worst.toExponential(2)} W`);
    expect(worst).toBeLessThan(SAME_STATION_W);
  });

  it("gives all three marks of a ruler ONE lateral, because they are a line", async () => {
    // The failure that hides: draw the magnitude after `copyToPoints` and
    // `randomField` answers three different numbers, because a copy has
    // its own identity. Counts, stations and windows all still pass.
    const { lap } = await lapFor(1);
    const out = await cookCornerLanguage({ lap, seed: 3, markers: markersFor(3) });
    expect(out.rulers.length).toBeGreaterThan(0);
    let worstSpread = 0;
    for (let i = 0; i < out.rulers.length; i += BRAKING.count) {
      const three = out.rulers.slice(i, i + BRAKING.count).map((m) => m.t);
      worstSpread = Math.max(worstSpread, Math.max(...three) - Math.min(...three));
    }
    // eslint-disable-next-line no-console
    console.log(`ruler lateral spread: worst ${worstSpread.toExponential(2)} W`);
    expect(worstSpread).toBeLessThan(SAME_PLACE_W);

    // And the rulers are not all on ONE lateral either, which is the
    // other way to pass the check above: a constant would give a spread of
    // zero and no variety at all.
    const perCorner = new Set(
      out.rulers.filter((_, i) => i % BRAKING.count === 0).map((m) => m.t.toFixed(4)),
    );
    expect(perCorner.size).toBeGreaterThan(1);
  });

  it("draws every quantity inside the band its rule states", async () => {
    const { lap } = await lapFor(2);
    const corners = await cookCorners({ lap });
    const out = await cookCornerLanguage({ lap, seed: 2, markers: markersFor(2) });
    expect(out.markers.length).toBe(corners.length);

    for (let ci = 0; ci < corners.length; ci++) {
      const m = out.markers[ci];
      const c = corners[ci];
      const at = `marker ${ci}`;
      // In the window, measured back from the entry the way every rule
      // here measures it.
      let d = (c.entryW - m.station) % lap.lengthW;
      if (d < 0) d += lap.lengthW;
      expect(d, `${at} window`).toBeGreaterThanOrEqual(MARKER.windowW[0] - SAME_STATION_W);
      expect(d, `${at} window`).toBeLessThanOrEqual(MARKER.windowW[1] + SAME_STATION_W);
      // In the height band.
      expect(m.h, `${at} height`).toBeGreaterThanOrEqual(MARKER.heightW[0] - SAME_PLACE_W);
      expect(m.h, `${at} height`).toBeLessThanOrEqual(MARKER.heightW[1] + SAME_PLACE_W);
      // On the outside, and out past the corridor -- the `max` that is
      // why Z-1 never has to move a marker.
      expect(Math.sign(m.t), `${at} side`).toBe(c.outside);
      expect(Math.abs(m.t), `${at} pushed clear`).toBeGreaterThanOrEqual(
        MARKER.minLateralW - SAME_PLACE_W,
      );
      // The archetype, by severity.
      expect(m.row, `${at} archetype`).toBe(c.severity === "sharp" ? 0 : 1);
    }

    for (const m of out.rulers) {
      expect(Math.abs(m.t)).toBeGreaterThanOrEqual(BRAKING.lateralW[0] - SAME_PLACE_W);
      expect(Math.abs(m.t)).toBeLessThanOrEqual(BRAKING.lateralW[1] + SAME_PLACE_W);
      expect(m.h).toBe(MARKER.heightW[0]);
      expect(m.row).toBe(2);
    }
  });

  it("draws the lateral from the marker's own quantiles, agreeing with drawQuantile", async () => {
    // THE GATHER IS THE PART THAT COULD SILENTLY BE WRONG: L-2 reads the
    // lateral distribution of the asset it CHOSE, so a gather that always
    // read row 0 would give every open corner the sharp marker's spread
    // and nothing above would notice. Checked by reconstructing the
    // magnitude the two-line inverse CDF must have produced: for every
    // marker there has to be a uniform that yields it from ITS OWN row.
    const { lap } = await lapFor(1);
    const corners = await cookCorners({ lap });
    const markers = markersFor(1);
    const out = await cookCornerLanguage({ lap, seed: 1, markers });
    const rows = [markers.sharp, markers.open, markers.brake];

    let checked = 0;
    for (let ci = 0; ci < corners.length; ci++) {
      const m = out.markers[ci];
      const q = rows[m.row].where?.lateral;
      if (!q) continue;
      const mag = Math.abs(m.t);
      // The clamp swallows the draw when it bites, so only the markers
      // ABOVE the floor carry recoverable evidence of their quantile.
      if (mag <= MARKER.minLateralW + SAME_PLACE_W) continue;
      // Invert the two-line CDF over a fine sweep and keep the closest.
      let best = Infinity;
      for (let k = 0; k <= 2000; k++) {
        const u = k / 2000;
        best = Math.min(best, Math.abs(Math.abs(drawQuantile(q, u)) - mag));
      }
      expect(best, `marker ${ci} is reachable from row ${m.row}`).toBeLessThan(1e-2);
      checked++;
    }
    // eslint-disable-next-line no-console
    console.log(`markers above the lateral floor, checked against their own row: ${checked}`);
    expect(checked).toBeGreaterThan(0);
  });

  it("gives the same placements twice, from the same seed", async () => {
    const { lap } = await lapFor(1);
    const a = await cookCornerLanguage({ lap, seed: 7, markers: markersFor(7) });
    const b = await cookCornerLanguage({ lap, seed: 7, markers: markersFor(7) });
    expect(b).toEqual(a);
    const c = await cookCornerLanguage({ lap, seed: 8, markers: markersFor(8) });
    expect(c.markers.map((m) => m.station)).not.toEqual(a.markers.map((m) => m.station));
  });

  it("refuses a lap with no corner model, naming the fix", async () => {
    const { lap } = await lapFor(1);
    const bare = { ...lap, corner: undefined };
    await expect(
      cookCornerLanguage({ lap: bare, seed: 1, markers: markersFor(1) }),
    ).rejects.toThrow(/carries no corner model/);
  });
});

describe("cornerLanguage: through the rules that consume it", () => {
  it("satisfies L-2 and L-3's own gates on a dressed lap", async () => {
    // THE TEST THAT MATTERS. `cornerMarkersSatisfied` and
    // `brakingRulersSatisfied` are the shipped gates -- the same ones the
    // page reports against -- and they check the window, the side, the
    // height band, the exact ruler stations and the one-line spread. If
    // the graph's draws are wrong in any of those, these fail.
    const { lap } = await lapFor(1);
    const corners = await cookCorners({ lap });
    const { markers, pool } = reserveFor(KIT, 1);
    if (!markers) throw new Error("racetrackCornerLanguage: no markers reserved");
    const drawn = await cookCornerLanguage({ lap, seed: 1, markers });

    // A lap of ordinary placements to put the language onto -- stations
    // spread evenly, each an ordinary asset, so there is something for
    // the convert-or-add to find and something for the ruler to displace.
    const base = Array.from({ length: 300 }, (_, i) => ({
      asset: pool[i % pool.length],
      t: (i % 2 === 0 ? 1 : -1) * 2,
      h: 0.5,
      station: ((i + 0.5) / 300) * lap.lengthW,
    }));

    const out = placeCornerLanguage(base, corners, markers, lap.lengthW, 1, drawn);
    expect(out.converted + out.added).toBe(corners.length);
    expect(out.brakeAdded).toBe(out.tightCorners * BRAKING.count);

    const l2 = cornerMarkersSatisfied(out.placements, corners, markers, lap.lengthW);
    const l3 = brakingRulersSatisfied(out.placements, corners, markers, lap.lengthW);
    // eslint-disable-next-line no-console
    console.log(
      `L-2 ${out.converted}+${out.added} on ${corners.length} corners, L-3 ${out.brakeAdded}-${out.brakeDisplaced} on ${out.tightCorners}; gates ${l2.satisfied ? "ok" : l2.missing.join(",")} / ${l3.satisfied ? "ok" : l3.failures.join("; ")}`,
    );
    expect(l2.satisfied).toBe(true);
    expect(l3.satisfied).toBe(true);
  });

  it("leaves the TypeScript draws alone when nothing is handed in", async () => {
    // The other half of the seam: omitting `drawn` must run the process
    // that every suite without a graph still measures.
    const { lap } = await lapFor(1);
    const corners = await cookCorners({ lap });
    const { markers, pool } = reserveFor(KIT, 1);
    if (!markers) throw new Error("racetrackCornerLanguage: no markers reserved");
    const base = Array.from({ length: 300 }, (_, i) => ({
      asset: pool[i % pool.length],
      t: (i % 2 === 0 ? 1 : -1) * 2,
      h: 0.5,
      station: ((i + 0.5) / 300) * lap.lengthW,
    }));
    const a = placeCornerLanguage(base, corners, markers, lap.lengthW, 1);
    const b = placeCornerLanguage(base, corners, markers, lap.lengthW, 1);
    expect(b.placements).toEqual(a.placements);
    expect(
      cornerMarkersSatisfied(a.placements, corners, markers, lap.lengthW).satisfied,
    ).toBe(true);
  });
});

describe("cornerLanguage: the marker table", () => {
  it("refuses a marker with no measured placement, naming which", () => {
    const bad = {
      ...markersFor(1),
      open: { ...markersFor(1).open, where: undefined },
    };
    expect(() => markerCloud(bad)).toThrow(/carries no measured placement/);
  });

  it("gives its three rows distinct identities", () => {
    // `randomField` keys on position and seed, so three coincident rows
    // would be ONE identity to anything that later draws on this cloud.
    const geo = markerCloud(markersFor(1));
    const P = geo.attrs.point.require("P");
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) seen.add(P.getTuple(i).join(","));
    expect(seen.size).toBe(3);
  });
});

describe("cornerLanguage: through the one lap graph the page cooks", () => {
  it("decides the language in the SAME graph as the stations and the assets", async () => {
    // THE ENDPOINT IS A LAP LEVEL AND A LEVEL IS ONE GRAPH, so the corner
    // language is added beside the asset choice rather than cooked
    // separately. This checks the two routes agree -- the same lap, the
    // same seed, the same markers -- because if they ever did not, the
    // page and every suite here would be measuring different laps.
    const { lap } = await lapFor(1);
    const { pool, markers } = reserveFor(KIT, 1);
    if (!markers) throw new Error("racetrackCornerLanguage: no markers reserved");
    const whole = await cookLapPlacements({ lap, seed: 1, pool, markers });
    const alone = await cookCornerLanguage({ lap, seed: 1, markers });
    expect(whole.language).toBeDefined();
    expect(whole.language?.markers).toEqual(alone.markers);
    expect(whole.language?.rulers).toEqual(alone.rulers);
  });

  it("answers no language when the kit reserved no markers", async () => {
    // `reserveMarkers` reports rather than throws when a kit has fewer
    // than three verticals, and `dressLap` already answers that by
    // placing none. The cook has to be able to say the same thing.
    const { lap } = await lapFor(1);
    const { pool } = reserveFor(KIT, 1);
    const out = await cookLapPlacements({ lap, seed: 1, pool });
    expect(out.language).toBeUndefined();
  });

  it("dresses a whole lap from one cook, and both gates hold", async () => {
    const { lap } = await lapFor(1);
    const { pool, markers } = reserveFor(KIT, 1);
    const decided = await cookLapPlacements({ lap, seed: 1, pool, markers });
    const dressed = dressLap(KIT, lap, 1, {
      stations: decided.stations,
      choices: decided.choices,
      language: decided.language,
    });
    const corners = await cookCorners({ lap });
    if (!markers) throw new Error("racetrackCornerLanguage: no markers reserved");
    const l2 = cornerMarkersSatisfied(dressed.placements, corners, markers, lap.lengthW);
    const l3 = brakingRulersSatisfied(dressed.placements, corners, markers, lap.lengthW);
    // eslint-disable-next-line no-console
    console.log(
      `one cook: ${dressed.stats.placed} placed, L-2 ${dressed.stats.markersConverted}+${dressed.stats.markersAdded}, L-3 ${dressed.stats.brakeMarks} marks; gates ${l2.satisfied ? "ok" : "FAILED"} / ${l3.satisfied ? "ok" : "FAILED"}`,
    );
    // THE CULL GETS THE LAST WORD, so a marker it dropped is a legitimate
    // miss rather than a broken port -- `dressLap` counts those in
    // `markersLostToCull`. The claim is that nothing is lost to anything
    // ELSE, which is what comparing against that count says.
    expect(l2.missing.length).toBeLessThanOrEqual(dressed.stats.markersLostToCull);
    expect(l3.failures.length).toBeLessThanOrEqual(dressed.stats.rulersLostToCull);
  });
});

describe("cornerLanguage: reserving the vocabulary", () => {
  const POOL = (KIT.assets as unknown as PlaceableAsset[]).filter((a) => a.where);

  it("reserves three distinct verticals, and takes them out of the pool", async () => {
    const cands = markerCandidates(POOL);
    // eslint-disable-next-line no-console
    console.log(`${cands.length} vertical candidates of ${POOL.length} placeable assets`);
    for (let seed = 1; seed <= 6; seed++) {
      const { markers, pool } = await cookReserveMarkers({ assets: POOL, seed });
      expect(markers, `seed ${seed}`).toBeDefined();
      if (!markers) continue;
      const ids = [markers.sharp.id, markers.open.id, markers.brake.id];
      // WITHOUT REPLACEMENT is the whole difference between this and three
      // independent draws, and it is what makes the corner language
      // legible: two roles sharing an asset would leave a severity with
      // nothing distinct to announce it.
      expect(new Set(ids).size, `seed ${seed} distinct`).toBe(3);
      for (const a of ids) expect(cands.some((c) => c.id === a)).toBe(true);
      expect(pool.length).toBe(POOL.length - 3);
      expect(pool.some((a) => ids.includes(a.id))).toBe(false);
    }
  });

  it("assigns the roles tallest first, which is what makes sharp sharp", async () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { markers } = await cookReserveMarkers({ assets: POOL, seed });
      if (!markers) continue;
      expect(markers.sharp.size.tall).toBeGreaterThanOrEqual(markers.open.size.tall);
      expect(markers.open.size.tall).toBeGreaterThanOrEqual(markers.brake.size.tall);
    }
  });

  it("weights by how often the source used the asset, not uniformly", async () => {
    // THE MECHANISM `reserveMarkers` ARGUES FOR. L-2 puts its marker at
    // every corner of a severity, so whatever is chosen becomes one of the
    // most repeated objects on the lap -- and promoting a one-off to that
    // is a bigger departure from the source than L-2 intends. Measured as
    // the mean `instances` of what is picked against the mean over all
    // candidates, over enough seeds for the difference to mean something.
    const cands = markerCandidates(POOL);
    const flat = cands.reduce((n, a) => n + Math.max(1, a.instances), 0) / cands.length;
    let picked = 0;
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { markers } = await cookReserveMarkers({ assets: POOL, seed });
      if (!markers) continue;
      for (const a of [markers.sharp, markers.open, markers.brake]) {
        picked += Math.max(1, a.instances);
        n++;
      }
    }
    const mean = picked / n;
    // eslint-disable-next-line no-console
    console.log(
      `mean instances: picked ${mean.toFixed(2)} against a flat ${flat.toFixed(2)} over ${n} draws`,
    );
    // Three of `cands.length` are taken every time, so the mean cannot run
    // far from flat -- but a weighted draw must sit ABOVE it, and a
    // uniform one would sit on it.
    expect(mean).toBeGreaterThan(flat);
  });

  it("gives the same three twice, and different three for a different seed", async () => {
    const a = await cookReserveMarkers({ assets: POOL, seed: 5 });
    const b = await cookReserveMarkers({ assets: POOL, seed: 5 });
    expect(b.markers?.sharp.id).toBe(a.markers?.sharp.id);
    expect(b.markers?.open.id).toBe(a.markers?.open.id);
    expect(b.markers?.brake.id).toBe(a.markers?.brake.id);
    const ids = (r: typeof a) =>
      [r.markers?.sharp.id, r.markers?.open.id, r.markers?.brake.id].join(",");
    let differs = false;
    for (let seed = 6; seed <= 20 && !differs; seed++) {
      differs = ids(await cookReserveMarkers({ assets: POOL, seed })) !== ids(a);
    }
    expect(differs, "some seed picks a different vocabulary").toBe(true);
  });

  it("draws the three rounds independently, and reaches the vocabulary they allow", async () => {
    // THE ONE THAT NEEDED A MEASUREMENT TO STATE. `reserveMarkers` draws
    // `rand(seed, k, 0x4d21)` -- one number PER ROUND -- and the graph
    // reads round k's uniform off a three-point cloud, because
    // `randomField` answers per point and a uniform read on the
    // candidates would give every candidate a different one.
    //
    // The obvious way to get that wrong is to hand every round the SAME
    // uniform, and it is nearly invisible: the picks are still distinct
    // (masking the taken weight shifts the CDF), still weighted, still
    // deterministic, and every other test in this file passes. What
    // collapses is the SPACE -- three degrees of freedom become one, and
    // the second pick can only ever land at or before the first, because
    // removing a candidate shrinks the total that the same uniform is
    // scaled against.
    //
    // Measured over 120 seeds on this kit's 8 verticals, which allow 56
    // distinct sets of three: three uniforms reach 28 of them, one
    // uniform reaches 8. So this bound is a real discriminator rather
    // than a restatement of the sample -- the failing variant was run to
    // confirm it fails.
    const sets = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const { markers } = await cookReserveMarkers({ assets: POOL, seed });
      if (!markers) continue;
      sets.add(
        [markers.sharp.id, markers.open.id, markers.brake.id]
          .sort((a, b) => a - b)
          .join(","),
      );
    }
    // eslint-disable-next-line no-console
    console.log(`${sets.size} distinct vocabularies over 120 seeds`);
    expect(sets.size).toBeGreaterThan(15);
  });

  it("reserves nothing when a kit has fewer than three verticals", async () => {
    // REPORTED RATHER THAN THROWN, which is `reserveMarkers`' own answer:
    // `dressLap` handles a missing kit by placing no corner language, and
    // a throw here would turn "this kit is too small for L-2" into "the
    // demo is broken".
    const two = markerCandidates(POOL).slice(0, 2);
    const out = await cookReserveMarkers({ assets: two, seed: 1 });
    expect(out.markers).toBeUndefined();
    expect(out.pool.length).toBe(two.length);
  });

  it("dresses a whole lap from a graph-reserved vocabulary", async () => {
    // The reservation re-bases, so this is a range claim rather than an
    // equality: a different three speak the corner language, and both
    // gates still have to hold.
    const { lap } = await lapFor(1);
    const reservation = await cookReserveMarkers({ assets: POOL, seed: 1 });
    const { markers, pool } = reservation;
    if (!markers) throw new Error("racetrackCornerLanguage: no markers reserved");
    const decided = await cookLapPlacements({ lap, seed: 1, pool, markers });
    // THE RESERVATION HAS TO GO IN TOO, and an earlier version of this
    // test did not pass it -- `dressLap` then re-derived a TypeScript
    // reservation, so the choices were indices into a pool it did not
    // have. It passed anyway, because at this one seed the two
    // reservations happened to agree; deliberately changing the graph's
    // draw made them diverge and `fromChoice`'s carried-id guard caught
    // it. A test that passes by coincidence is the thing that guard was
    // added for.
    const dressed = dressLap(KIT, lap, 1, {
      reservation,
      stations: decided.stations,
      choices: decided.choices,
      language: decided.language,
    });
    const corners = await cookCorners({ lap });
    const l2 = cornerMarkersSatisfied(dressed.placements, corners, markers, lap.lengthW);
    const l3 = brakingRulersSatisfied(dressed.placements, corners, markers, lap.lengthW);
    // eslint-disable-next-line no-console
    console.log(
      `graph-reserved: sharp ${markers.sharp.name}, open ${markers.open.name}, brake ${markers.brake.name}; L-2 ${l2.satisfied ? "ok" : l2.missing.length + " missing"} / L-3 ${l3.satisfied ? "ok" : l3.failures.length + " failed"}`,
    );
    expect(l2.missing.length).toBeLessThanOrEqual(dressed.stats.markersLostToCull);
    expect(l3.failures.length).toBeLessThanOrEqual(dressed.stats.rulersLostToCull);
  });
});
