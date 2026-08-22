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
 * the source era's objects have geometry inside 1W at driver height, and the
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
 * 26% of large ones) are the source era across circuits, not this one.
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
  return { t: Math.sign(t || 1) * CORRIDOR.halfWidthW, baseH };
}

/**
 * Z-3's band mix, as share of all placements.
 *
 * The bands are the RULE's ranges; the aim points are their centres. The
 * source's own figures are 15 / 8 / 29 / 35 / 13 / 0.5 for
 * over / verge / near / mid / far / distant, which is the source era and NOT
 * the earlier games — the difference between the eras is the largest in
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

/**
 * Deterministic uniform in [0, 1) for `(seed, index, salt)`.
 *
 * Hashed per element rather than drawn from a running stream, so a
 * placement's band does not depend on how many placements came before it
 * — which is what lets a caller assign one station's zone without
 * generating the others.
 */
function rand(seed: number, index: number, salt: number): number {
  let h = (seed * 0x9e3779b1 + index * 0x85ebca6b + salt * 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
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

/** Which band an already-placed lateral belongs to, for scoring a result. */
export function bandOf(t: number, h: number): "over" | "verge" | "near" | "mid" | "far" | "distant" {
  const a = Math.abs(t);
  if (a < 1.5 && (h > CORRIDOR.ceilingW || h < 0)) return "over";
  if (a < 1.5) return "verge";
  if (a < 2.5) return "near";
  if (a < 5) return "mid";
  if (a < 13) return "far";
  return "distant";
}
