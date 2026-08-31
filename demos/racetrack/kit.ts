/**
 * Reading a catalogue of placements, and putting them on THIS spline.
 *
 * WHAT THIS IS FOR, and it is the check everything else rests on. A
 * catalogue states environment art in track-relative coordinates — arc
 * length, a signed lateral offset, a height, all in half-widths. If those
 * coordinates mean the same thing on both sides, dropping 442 of them
 * onto a spline they were never placed on produces something that reads
 * as a track. If either side has a convention backwards it produces a
 * cloud, and no amount of agreement about occupancy figures would have
 * caught it.
 *
 * IT IS A REFERENCE, NOT A TARGET. Nothing generated here is fitted to
 * these placements. They are drawn beside generated output so a person
 * can see whether the generated one reads, which is the only test that
 * matters in the end and the one no statistic replaced.
 *
 * THE FILE IS OPTIONAL AND IS NOT IN THIS REPOSITORY. The demo fetches
 * `/kit.json` if someone has put one there — gitignored — and does
 * without when nobody has, which is almost everyone.
 */

/** One axis-aligned box of a placement, in the track frame, in W. */
export interface KitBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** panel / leg / post / span / head / mass — inferred, not stated. */
  readonly role?: string;
  /**
   * RMS departure of this box's geometry from its own best-fit plane, in
   * W. Analytic, so unlike every other size here it carries no grid.
   *
   * NEAR ZERO MEANS A SHEET — not a thin wall, and not a wall too thin
   * for a grid to resolve. Three quarters of this catalogue is
   * single-sided surface. For those, depth is a number this side invents
   * and owns; there is nothing to recover.
   */
  readonly thickness?: number;
}

/** One instance of an asset, placed on the reference lap. */
export interface KitPlacement {
  readonly asset: number;
  readonly name: string;
  /** Arc length from the start line, in W. */
  readonly station: number;
  /** Signed offset across the track, positive RIGHT of travel, in W. */
  readonly lateral: number;
  /** Height above the local surface, in W. */
  readonly height: number;
  readonly curvature: number;
  readonly bank: number;
  readonly boxes: readonly KitBox[];
  readonly coverage?: number;
  readonly capped?: boolean;
}

export interface Kit {
  readonly track: { readonly lapLengthW: number; readonly halfWidthUnits: number };
  readonly assets: readonly { readonly name: string; readonly shape: string }[];
  readonly placements: readonly KitPlacement[];
}

/**
 * Load the kit if one has been made available, or answer undefined.
 *
 * NOT AN ERROR WHEN ABSENT. The page's own content is generated and owes
 * nothing to this file; the reference layer is an extra that most people
 * running the demo will not have. A throw here would turn "you do not
 * have the optional comparison data" into "the demo is broken".
 */
export async function loadKit(url = "/kit.json"): Promise<Kit | undefined> {
  // NOT EVEN REQUESTED WHEN IT CANNOT BE THERE. The published build has
  // no kit — the file is a local-only extra — so asking for it on the
  // live site buys a 404 in every visitor's console for a file that is
  // deliberately absent. Worse, it is an error a headless capture cannot
  // distinguish from a real one, and it failed the screenshot run.
  //
  // THE DISCRIMINATOR IS THE BUILD, NOT THE HOST, and it took two
  // attempts. Gating on localhost is wrong twice over: the capture serves
  // a PRODUCTION build from 127.0.0.1, and someone self-hosting the
  // published site locally would get a reference layer they should not.
  // Gating on
  // `import.meta.env?.DEV` failed too — the optional chain stops the
  // build-time substitution, so the guard survived as a runtime test and
  // then folded the wrong way.
  //
  // `import.meta.hot` is the dev server's own hallmark: defined when it
  // is serving, statically undefined in every build. It is exactly the
  // condition under which a kit at the repository root can be served.
  const dev = import.meta.hot !== undefined;
  const asked =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("kit");
  if (asked) url = asked;
  else if (!dev) return undefined;

  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const kit = (await res.json()) as Kit;
    if (!Array.isArray(kit.placements)) return undefined;
    return kit;
  } catch {
    return undefined;
  }
}

/** One box of one placement, resolved to a world-space box. */
export interface PlacedBox {
  /** World centre of the box. */
  readonly centre: [number, number, number];
  /** World-space extents along the track frame's three axes. */
  readonly size: [number, number, number];
  /** The frame the box is axis-aligned in: across, along, up. */
  readonly basis: {
    readonly across: readonly [number, number, number];
    readonly along: readonly [number, number, number];
    readonly up: readonly [number, number, number];
  };
  readonly role: string;
  /** Part of an L-6 cover run rather than dressing. */
  readonly cover?: boolean;
  readonly thickness: number;
}

/**
 * Put a kit's placements on a lap.
 *
 * THE STATION IS SCALED, not wrapped by the caller. A kit whose own
 * reference lap is 403 W, dropped onto a lap of a different length, has
 * to decide what "station 200" means: the same DISTANCE (so a shorter lap runs out
 * and the rest wraps on top of itself) or the same FRACTION (so the
 * spacing stretches). Fraction, because the thing being checked is
 * whether the layout reads — and a layout doubled over itself for the
 * back half of the lap would fail that for a reason that has nothing to
 * do with the coordinates being right.
 *
 * `scaleToLap: false` asks for the other reading, which is what to use
 * when the two laps are close in length and the true spacing matters.
 */
export function placeKit(
  kit: Kit,
  lap: { lengthW: number; halfWidth: number },
  at: (station: number, lateral: number, height: number) => {
    p: [number, number, number];
    across: [number, number, number];
    along: [number, number, number];
    up: [number, number, number];
  },
  opts: { scaleToLap?: boolean } = {},
): PlacedBox[] {
  const scale = opts.scaleToLap === false ? 1 : lap.lengthW / kit.track.lapLengthW;
  const W = lap.halfWidth;
  const out: PlacedBox[] = [];

  for (const pl of kit.placements) {
    const frame = at(pl.station * scale, pl.lateral, pl.height);
    for (const b of pl.boxes) {
      // The box is axis-aligned in the TRACK frame, so its centre is an
      // offset along the same three axes the placement was located with —
      // not a world-space offset, and not world axes. This is
      // the one line where getting `across` backwards would mirror every
      // asset about its own anchor as well as about the road.
      const c: [number, number, number] = [
        ((b.min[0] + b.max[0]) / 2) * W,
        ((b.min[1] + b.max[1]) / 2) * W,
        ((b.min[2] + b.max[2]) / 2) * W,
      ];
      out.push({
        centre: [
          frame.p[0] + frame.across[0] * c[0] + frame.along[0] * c[1] + frame.up[0] * c[2],
          frame.p[1] + frame.across[1] * c[0] + frame.along[1] * c[1] + frame.up[1] * c[2],
          frame.p[2] + frame.across[2] * c[0] + frame.along[2] * c[1] + frame.up[2] * c[2],
        ],
        size: [
          Math.max((b.max[0] - b.min[0]) * W, 1e-4),
          Math.max((b.max[1] - b.min[1]) * W, 1e-4),
          Math.max((b.max[2] - b.min[2]) * W, 1e-4),
        ],
        basis: { across: frame.across, along: frame.along, up: frame.up },
        role: b.role ?? "mass",
        thickness: b.thickness ?? 0,
      });
    }
  }
  return out;
}
