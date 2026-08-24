/**
 * Which band across the corridor a placement lands in, and how far out.
 *
 * WHAT THIS ANSWERS. Stations decided WHERE ALONG the lap; this decides
 * HOW FAR ACROSS. The two are separate on purpose — the station process
 * has a dispersion curve to match and this has a band mix to match, and
 * nothing in either rule couples them. Coupling them is how a fitted
 * label ends up driving a lap-scale artefact.
 *
 * THE CORRIDOR IS THE ONE HARD RULE. `|t| < 1W` below `h = 1.2W` carries
 * no geometry. That is a decision to be BETTER THAN THE SOURCE rather
 * than a description of it, and it has to be labelled that way: 12.3% of
 * the source's objects have geometry inside 1W at driver height, and the
 * median reaches 0.24W from the centreline. It is not a technique, it is
 * a stray — filtered to furniture small enough for the question to mean
 * anything, 1.2% of objects do it — but the source does do it and a
 * generator that claims otherwise is describing something else.
 *
 * AND IT IS HELD BY SIZE, NOT BY OFFSET. Clamping `|t|` to 1W would be
 * the obvious way and it costs the verge band, because the archetypes
 * that reach inside 1W are the same ones that fill 1.0-1.5W. So the
 * lateral is drawn from its band and the conflict is resolved by what the
 * piece IS: small art rises clear, large art stands off to the corridor
 * edge and no further, keeping the band it was drawn into.
 */
import { rand } from "./rand.js";
import { SAME_PLACE_W } from "./tolerance.js";

/** The bands, in |t| and h. Z1 is the corridor and holds nothing. */
export const ZONES = {
  /** 1.0-1.5W. Kerb wall, barriers, cameras, chevrons, start furniture. */
  verge: { tMin: 1.0, tMax: 1.5 },
  /** 1.5-2.5W. Poles, pipe runs, sign supports, tunnel walls, gravel. */
  near: { tMin: 1.5, tMax: 2.5 },
  /** 2.5-5W. Terrain shells, wall panels, buildings — most of the mass. */
  mid: { tMin: 2.5, tMax: 5 },
  /** 5-13W. Silhouette structures, vegetation fields, billboards. */
  far: { tMin: 5, tMax: 13 },
  /** Beyond 13W. Skyline dressing only. */
  distant: { tMin: 13, tMax: 20 },
  /** |t| < 1.5W, h > 1.2W. Gantries, signs, lamp arms, banners. */
  overhead: { tMin: 0, tMax: 1.5 },
  /** |t| < 1.5W, h < 0. Deck supports, pylons — elevated deck only. */
  under: { tMin: 0, tMax: 1.5 },
} as const;

export type ZoneName = keyof typeof ZONES;

/**
 * The corridor Z-1 protects — a VOLUME, not a half-plane.
 *
 * `|t| < 1W` and `0 <= h < 1.2W`. The floor matters: Z8 is defined as
 * `|t| < 1.5W, h < 0`, deck supports and pylons under an elevated
 * stretch, and those sit inside the corridor's footprint while being
 * nowhere near a driver. A check that read "below the ceiling" rather
 * than "between the deck and the ceiling" would forbid the band the rule
 * explicitly provides.
 */
export const CORRIDOR = { halfWidthW: 1.0, floorW: 0, ceilingW: 1.2 } as const;

/**
 * How high overhead furniture may reach.
 *
 * Z7 IS GANTRIES, SIGNS, LAMP ARMS AND BANNERS — its own description says
 * so — and every one of those is a small thing hung a little way above the
 * road. It is NOT enclosure: a tunnel shell also has |t| < 1.5W and also
 * sits above the corridor, and it belongs to L-6, which places it as a
 * run of repeated pieces rather than as one object in a band.
 *
 * The distinction has to be enforced, because the two are not
 * interchangeable and the failure is silent. An `over` placement takes
 * its height from the band rather than from the asset — it must, since a
 * spanning object's own bounds centre sits in its own empty middle and
 * means nothing. Stand a nine-half-width shell on that floor and it
 * reaches ten half-widths up and twelve across, and the lap acquires a
 * ceiling: every rule still passes, the band mix is exactly on target,
 * and the chase view is a tunnel with the sky bricked over. It was
 * invisible until somebody looked from the driver's seat.
 *
 * Six is the ceiling upstream's enclosure measurement uses, for the same
 * reason: without one, the skybox is a tunnel.
 */
export const OVERHEAD = { ceilingW: 6 } as const;

/**
 * Can this piece hang over the road as furniture, rather than enclose it?
 *
 * THE CUT DECIDES A VOCABULARY, NOT A POSITION, so a piece within an f32
 * spacing of it must not change families between cooks. A `tall` of
 * exactly 4.8W reaches exactly the ceiling and is furniture; computed in
 * f32 the same sum lands a few parts in ten million above 6 and the piece
 * becomes a shell, which takes it out of the `over` pool the mix draws
 * from and changes what the band is filled with. The tolerance keeps the
 * f64 answer for a piece sitting on the cut. On the three measured kits
 * the nearest asset to it is 1.5e-2W away, so nothing real is near enough
 * to be moved by it.
 */
export function fitsOverhead(tallW: number): boolean {
  return CORRIDOR.ceilingW + tallW <= OVERHEAD.ceilingW + SAME_PLACE_W;
}

/** Is this position inside the protected volume? */
export function inCorridor(t: number, h: number): boolean {
  return Math.abs(t) < CORRIDOR.halfWidthW && h >= CORRIDOR.floorW && h < CORRIDOR.ceilingW;
}

/**
 * Resolve a corridor conflict by what the piece IS.
 *
 * SEPARATE FROM THE BAND SAMPLER because the band sampler cannot produce
 * a conflict: Z2 starts at exactly 1.0W, so a lateral drawn from a band
 * never reaches inside. The measured DISTRIBUTION does — 9.3% of the
 * reference circuit's placements sit inside 1W — and that distribution
 * arrives with the assets, whose own `where.lateral` is what a later
 * stage draws from. So this is the rule stated where it can be exercised
 * on its own, rather than dead code behind a sampler that never calls it.
 *
 * The two exits are DIFFERENT, and that is the whole rule. Clamping
 * everything to the corridor edge satisfies Z-1 and costs the verge band,
 * because the archetypes reaching inside 1W are the same ones filling
 * 1.0-1.5W. Lifting everything is worse than either: it moves 4-11% of
 * placements across a band boundary and collapses the verge, since
 * roughly half of them would have drawn high on their own.
 *
 * WHAT THE REFERENCE CIRCUIT SAYS ABOUT THE SMALL CASE: nothing. All 41
 * of its inside-1W placements are large, at a median height of 3.19W —
 * gantries and spanning shells recorded at their centres. The small-art
 * figures (53% of small objects inside 1W sit above the ceiling, against
 * 26% of large ones) are the whole source population, not this circuit.
 */
export function resolveCorridor(
  t: number,
  baseH: number,
  acrossW: number,
  tallW: number,
): { t: number; baseH: number } {
  if (!inCorridor(t, baseH)) return { t, baseH };
  const small = acrossW < 1 && tallW < 1.5;
  if (small) {
    // SMALL ART RISES, keeping its lateral.
    return { t, baseH: CORRIDOR.ceilingW };
  }
  // LARGE ART STANDS OFF, to the edge and no further, keeping its band.
  //
  // ITS EDGE GOES TO THE CORRIDOR EDGE, NOT ITS CENTRE. Moving the centre
  // to |t| = 1W leaves half the object's width still over the road, and
  // the wider the piece the worse it is: a 13.4W slab stood off this way
  // hangs 6.7W of itself across the racing line, at whatever height it
  // was already at. Reported from the driver's seat as a structure
  // looming over the road, and it is the same bounds-centre mistake as
  // the raised shells, the `over` band and the grass bank — the fifth
  // time in this demo that a centre has been used where an extent was
  // meant.
  //
  // "To the edge and no further" is a statement about the OBJECT, so the
  // object's near face is what lands on the edge.
  return { t: Math.sign(t || 1) * (CORRIDOR.halfWidthW + acrossW / 2), baseH };
}

/**
 * Z-3's band mix, as share of all placements.
 *
 * The bands are the RULE's ranges; the aim points are their centres. The
 * source's own figures are 15 / 8 / 29 / 35 / 13 / 0.5 for
 * over / verge / near / mid / far / distant, which is the LATE era and
 * not the earlier one — the difference between the two is the largest in
 * the whole ruleset, the near band nearly doubling and the far band
 * halving as the mass came in off the horizon to where a driver can read
 * it at speed.
 *
 * `over` covers Z7 and Z8 together, which is how the rule states it.
 */
export const BAND_MIX: Record<"over" | "verge" | "near" | "mid" | "far" | "distant", {
  aim: number;
  lo: number;
  hi: number;
}> = {
  over: { aim: 0.15, lo: 0.1, hi: 0.21 },
  verge: { aim: 0.08, lo: 0.04, hi: 0.12 },
  near: { aim: 0.29, lo: 0.23, hi: 0.35 },
  mid: { aim: 0.35, lo: 0.28, hi: 0.4 },
  far: { aim: 0.13, lo: 0.07, hi: 0.19 },
  distant: { aim: 0.005, lo: 0, hi: 0.03 },
};

/**
 * How the `over` share splits between overhead and under.
 *
 * ALL OF IT OVERHEAD, for now, because Z8 is "only where the deck is
 * elevated" and this spline has relief but no elevated sections — it is a
 * ribbon on the ground everywhere. Placing pylons under a deck that is
 * not raised would put girders through the terrain. When the spline grows
 * elevated stretches this becomes a function of the station rather than a
 * constant, which is why it is named rather than inlined as 1.
 */
export const UNDER_SHARE = 0;

/** A placement's position across the corridor. */
export interface Lateral {
  readonly zone: ZoneName;
  /** Signed offset in W. Positive is RIGHT of travel. */
  readonly t: number;
  /** Height of the placement's BASE above the local surface, in W. */
  readonly baseH: number;
}


/** The mix as a cumulative table over concrete zones, built once. */
const ZONE_WEIGHTS: readonly (readonly [ZoneName, number])[] = (() => {
  const over = BAND_MIX.over.aim;
  const rows: [ZoneName, number][] = [
    ["overhead", over * (1 - UNDER_SHARE)],
    ["under", over * UNDER_SHARE],
    ["verge", BAND_MIX.verge.aim],
    ["near", BAND_MIX.near.aim],
    ["mid", BAND_MIX.mid.aim],
    ["far", BAND_MIX.far.aim],
    ["distant", BAND_MIX.distant.aim],
  ];
  const total = rows.reduce((s, r) => s + r[1], 0);
  return rows.map(([n, w]) => [n, w / total] as const);
})();

/**
 * Pick a band for one placement.
 *
 * SAMPLED RATHER THAN QUOTA'D. A quota — take exactly 35% and deal them
 * out — would hit the mix on the nose every lap, which no real circuit
 * does and which would hide the fact that the mix is a band rather than a
 * point. Sampling lands inside Z-3's ranges with the variation a lap
 * actually has.
 */
export function zoneFor(seed: number, index: number): ZoneName {
  const u = rand(seed, index, 0x2a);
  let acc = 0;
  for (const [name, w] of ZONE_WEIGHTS) {
    acc += w;
    if (u < acc) return name;
  }
  return "mid";
}

/** Which band a zone counts toward in Z-3's six-way split. */
export function bandOfZone(z: ZoneName): keyof typeof BAND_MIX {
  return z === "overhead" || z === "under" ? "over" : z;
}

/**
 * A whole lap's bands, sampled and then REPAIRED into Z-3's ranges.
 *
 * Z-3 IS A THRESHOLD RULE WEARING A DISTRIBUTION'S CLOTHES, which is the
 * same distinction D-4 turned out to have against D-5. Sampling at the
 * source's own share puts `mid` at 40.6% on one lap in eight against a
 * stated ceiling of 40 — and a lap that exceeds the range has broken the
 * rule, however faithfully the sampler was aimed. So the mix is sampled
 * for its variation and then corrected until every band is inside, which
 * is what a threshold wants and what no amount of re-aiming provides.
 *
 * The correction MOVES a placement from the fullest over-range band to
 * the emptiest under-range one — the same shape as D-4's repair, and for
 * the same reason: it keeps the total exact and takes from where there is
 * most to spare.
 */
export function zonesForLap(count: number, seed: number): ZoneName[] {
  return zonesForLapDetailed(count, seed).zones;
}

/** What {@link zonesForLap} had to repair. See `StationStats` for why. */
export interface ZoneStats {
  readonly zones: ZoneName[];
  /** Placements moved between bands to bring the mix inside Z-3. */
  readonly mixRepairs: number;
}

/** {@link zonesForLap}, with the count of corrections it applied. */
export function zonesForLapDetailed(count: number, seed: number): ZoneStats {
  const zones: ZoneName[] = [];
  for (let i = 0; i < count; i++) zones.push(zoneFor(seed, i));

  const bands = Object.keys(BAND_MIX) as (keyof typeof BAND_MIX)[];
  const countOf = (): Record<string, number> => {
    const c: Record<string, number> = {};
    for (const b of bands) c[b] = 0;
    for (const z of zones) c[bandOfZone(z)]++;
    return c;
  };
  /** A band's default zone, for a placement moved into it. */
  const zoneOfBand: Record<string, ZoneName> = {
    over: "overhead",
    verge: "verge",
    near: "near",
    mid: "mid",
    far: "far",
    distant: "distant",
  };

  // Bounded by the number of placements: each pass moves exactly one, and
  // a mix that cannot be repaired in that many is a broken rule table
  // rather than a slow convergence.
  let mixRepairs = 0;
  for (let pass = 0; pass < count; pass++) {
    const c = countOf();
    let from: keyof typeof BAND_MIX | undefined;
    let to: keyof typeof BAND_MIX | undefined;
    let worstOver = 0;
    let worstUnder = 0;
    for (const b of bands) {
      const share = c[b] / count;
      const over = share - BAND_MIX[b].hi;
      const under = BAND_MIX[b].lo - share;
      if (over > worstOver) {
        worstOver = over;
        from = b;
      }
      if (under > worstUnder) {
        worstUnder = under;
        to = b;
      }
    }
    if (from === undefined) break;
    // Nothing is under its floor, so give the surplus to whichever band
    // sits furthest below its own aim — the least disruptive home for it.
    if (to === undefined) {
      let slack = -Infinity;
      for (const b of bands) {
        if (b === from) continue;
        const room = BAND_MIX[b].aim - c[b] / count;
        if (room > slack) {
          slack = room;
          to = b;
        }
      }
    }
    if (to === undefined) break;
    const idx = zones.findIndex((z) => bandOfZone(z) === from);
    if (idx < 0) break;
    zones[idx] = zoneOfBand[to];
    mixRepairs++;
  }
  return { zones, mixRepairs };
}

/**
 * Where across the corridor, given a band and the piece's own extents.
 *
 * `acrossW` and `tallW` are the asset's, in W, and they are what resolves
 * a corridor conflict — see the header. Pass zeroes for a placement whose
 * asset is not chosen yet and it is treated as small, which is the safe
 * reading: small art rises, and a raised base is never wrong for
 * something that turns out to be large.
 */
export function lateralFor(
  zone: ZoneName,
  seed: number,
  index: number,
  acrossW = 0,
  tallW = 0,
): Lateral {
  const band = ZONES[zone];
  const u = rand(seed, index, 0x51);
  // Uniform across the band rather than centred: the bands are already
  // narrow and the source's own laterals fill them, so a bell would
  // hollow out each boundary for no reason the measurement supports.
  let t = band.tMin + u * (band.tMax - band.tMin);

  // Which side. Even, because the population is: the reference circuit
  // reads 191 right against 251 left, and an asset's own lean lives in
  // its `rightOfTravel` rather than here.
  const right = rand(seed, index, 0x77) < 0.5;

  let baseH = 0;
  if (zone === "overhead") {
    // Above the ceiling by construction — this band is DEFINED by height,
    // so there is no conflict to resolve.
    baseH = CORRIDOR.ceilingW + rand(seed, index, 0x91) * 2.4;
  } else if (zone === "under") {
    baseH = -0.5 - rand(seed, index, 0x91) * 2;
  } else {
    // Z-1's conflict, resolved by {@link resolveCorridor}. A lateral drawn
    // from a band never triggers it — Z2 starts at exactly 1.0W — but the
    // call is here rather than at the caller so that a band whose extent
    // is later widened toward the measured distribution is covered
    // without anyone having to remember to add it.
    const fixed = resolveCorridor(t, baseH, acrossW, tallW);
    t = fixed.t;
    baseH = fixed.baseH;
  }

  return { zone, t: right ? t : -t, baseH };
}

/**
 * Which band an already-placed lateral belongs to, for scoring a result.
 *
 * `|t| < 1W` is `over` whatever its height: Z2's verge is 1.0-1.5W and Z1
 * holds nothing, so anything anchored inside the corridor is spanning it
 * rather than standing in it. See `bandOfPlacement` in assets.ts for the
 * seven points this cost before it was caught.
 */
export function bandOf(t: number, h: number): "over" | "verge" | "near" | "mid" | "far" | "distant" {
  // THE SAME LADDER AS `bandOfPlacement`, AND THAT IS A LIABILITY WORTH
  // NAMING. This one takes a base height directly where that one derives
  // it from a centre and a size, which is the only difference between
  // them — so the two are one rule written twice, and the boundary
  // tolerances have to move together or they become one rule with two
  // answers. `racetrackZones` pins that they agree across a sweep; read
  // `bandOfPlacement` for why each edge is nudged the way it is.
  const a = Math.abs(t);
  const inside = (limit: number): boolean => a < limit - SAME_PLACE_W;
  if (inside(CORRIDOR.halfWidthW)) return "over";
  if (inside(1.5) && (h > CORRIDOR.ceilingW + SAME_PLACE_W || h < -SAME_PLACE_W)) return "over";
  if (inside(1.5)) return "verge";
  if (inside(2.5)) return "near";
  if (inside(5)) return "mid";
  if (inside(13)) return "far";
  return "distant";
}
