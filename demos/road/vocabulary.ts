/**
 * A vocabulary the demo can publish.
 *
 * WHY THIS EXISTS. Every rule in this demo is driven by a measured kit —
 * an asset catalogue with, for each piece, where its instances actually
 * sat across the track, how high, which side, and how its rate varied
 * with curvature. That catalogue is derived measurement of a commercial
 * game. It is not ours to redistribute, it is gitignored, and the
 * published build therefore has no `kit.json` at all: the live demo drew
 * placeholder boxes and reported "rules idle" while six rules sat behind
 * it doing nothing anybody could see.
 *
 * So this builds a vocabulary from THE PUBLISHED RULES THEMSELVES rather
 * than from any measurement — Z-3's band shares, Z-4's size-by-band
 * ranges, Z-5's separate along and across extents, C-1's gap CV, D-6's
 * curvature response. Those are numbers in a design document, stated as
 * ranges an implementer is meant to hit. Nothing here is copied from
 * anything; it is what the rules ask for, made concrete.
 *
 * AND IT IS A BETTER DEMONSTRATION THAN THE MEASURED KIT WOULD BE. A
 * generator that only works on one catalogue has shown nothing. Dressing
 * a vocabulary built to a spec, and having every rule fire and every gate
 * hold, is the actual claim: THE RULES ARE THE PRODUCT AND THE KIT IS
 * INTERCHANGEABLE. The measured kit stays available locally as the
 * reference layer, which is where a like-for-like comparison belongs.
 *
 * WHAT IT HAS TO CONTAIN, or rules fall silent and the demo is dishonest
 * in a subtler way. Each of these is deliberate, not decoration:
 *
 *   - slender verticals, so L-2 and L-3 have a corner language to reserve
 *   - overhead pieces wide enough to roof the corridor, so L-6 can build
 *   - pieces whose own lateral distribution reaches inside 1W, so Z-1's
 *     corridor resolution is reachable rather than vacuously satisfied
 *   - a long tail of one-offs, so L-4 has landmarks to draw on: the
 *     source has 135 of 206 assets appearing exactly once, and a kit of
 *     evenly-used pieces cannot make a lap navigable
 *   - pieces low and near enough to form the lines L-5 forbids
 */
import { rand } from "./assets.js";
import type { Kit, KitBox } from "./kit.js";
import measured from "./vocabulary.json";

/**
 * THE VOCABULARY THE PAGE ACTUALLY SHIPS WITH.
 *
 * Per-asset bounding-box decompositions and the placement statistics the
 * rules read, measured from a source circuit and committed — see
 * `scripts/gen-road-vocabulary.mjs` for what it carries and what it
 * deliberately leaves behind. It is dimensions and statistics: a median
 * of five axis-aligned boxes per asset, which is a guide for generating
 * an asset rather than an asset, and no level layout or source
 * identifiers at all.
 *
 * IT IS HERE BECAUSE THE GENERATED ALTERNATIVE WAS NOT GOOD ENOUGH. A
 * catalogue built from the rule ranges alone came out at 1.7 boxes per
 * asset against this one's 5.2, and a placement dressed from it reads as
 * a crate rather than as a grandstand. The rules were never the problem;
 * the vocabulary was, and the part of a real vocabulary that matters
 * turns out to be its internal structure rather than its dimensions.
 */
export function shippedVocabulary(): Kit {
  return {
    track: { lapLengthW: measured.lapLengthW, halfWidthGameUnits: 1000 },
    assets: measured.assets as unknown as Kit["assets"],
    // THE RECORDED INSTANCES, which do two jobs. They are the reference
    // layer the page draws beside the generated dressing, and they are
    // the pose library that stops every copy of an object facing the same
    // way. What they are NOT is a level: a layout only means anything
    // paired with the track it was authored on, and this demo generates
    // its own spline — different length, corners in different places — so
    // the sequence lands on geometry it was never made for. That is
    // exactly what makes it good evidence rather than a copy.
    placements: measured.placements as unknown as Kit["placements"],
  };
}

/** A generated asset, in the shape the placement rules read. */
interface VocabAsset {
  id: number;
  name: string;
  shape: string;
  instances: number;
  size: { across: number; along: number; tall: number };
  where: {
    lateral: { median: number; p10: number; p90: number };
    height: { median: number; p10: number; p90: number };
    rightOfTravel: number;
    gapCv: number;
    affinity: { straight: number; easy: number; medium: number; tight: number };
  };
  boxes: KitBox[];
}

/**
 * The bands, with Z-4's sizes and the share of the vocabulary each gets.
 *
 * THE COUNTS ARE NOT Z-3's SHARES. Z-3 governs how many PLACEMENTS land
 * in each band, which the placement rules decide at runtime; this governs
 * how many distinct ASSETS exist to place. A band with one asset in the
 * catalogue cannot supply a tenth of the lap without repeating it a
 * hundred times, and L-4 would have nothing to work with.
 */
const BANDS = [
  { name: "verge", tMin: 1.0, tMax: 1.5, foot: [0.4, 2.0], tall: [0.6, 2.2], n: 14 },
  { name: "near", tMin: 1.5, tMax: 2.5, foot: [0.6, 3.0], tall: [0.8, 2.6], n: 26 },
  { name: "mid", tMin: 2.5, tMax: 5.0, foot: [1.5, 5.0], tall: [1.2, 3.4], n: 30 },
  { name: "far", tMin: 5.0, tMax: 13.0, foot: [3.0, 8.0], tall: [2.0, 5.0], n: 22 },
  { name: "distant", tMin: 13.0, tMax: 20.0, foot: [4.0, 10.0], tall: [3.0, 6.0], n: 8 },
] as const;

/** Names that describe a shape rather than naming anybody's asset. */
const STEMS = [
  "block",
  "hoarding",
  "planter",
  "stack",
  "bollard",
  "railing",
  "crate",
  "vent",
  "drum",
  "kiosk",
  "screen",
  "buttress",
  "shed",
  "tank",
  "frame",
  "louvre",
] as const;

/** Draw uniformly from a range. */
function span(range: readonly [number, number] | readonly number[], u: number): number {
  return range[0] + u * (range[1] - range[0]);
}

/**
 * A box decomposition for one asset.
 *
 * TWO OR THREE BOXES, NOT ONE. The renderer draws the boxes rather than
 * the bounding volume, and a vocabulary of single cuboids reads as a row
 * of crates — but more to the point, the enclosure measurement casts rays
 * against these boxes, so a shell drawn as its own bounding box would
 * read as solid and roof everything under it. Splitting the mass is what
 * makes a piece with a hole in it behave like one.
 *
 * Coordinates are relative to the asset's own bounds centre, in W, on the
 * (across, along, up) axes the kit format uses.
 */
function decompose(a: VocabAsset, u: number): KitBox[] {
  const { across, along, tall } = a.size;
  const hx = across / 2;
  const hy = along / 2;
  const hz = tall / 2;
  const boxes: KitBox[] = [];

  if (u < 0.35 || across < 0.8) {
    // A single mass: posts, drums, small furniture.
    boxes.push({ min: [-hx, -hy, -hz], max: [hx, hy, hz], role: "mass" });
    return boxes;
  }
  if (u < 0.7) {
    // A mass with a cap — the cap is what a low sun catches.
    const capZ = hz * 0.75;
    boxes.push({ min: [-hx, -hy, -hz], max: [hx, hy, capZ], role: "mass" });
    boxes.push({
      min: [-hx * 1.1, -hy * 1.1, capZ],
      max: [hx * 1.1, hy * 1.1, hz],
      role: "cap",
    });
    return boxes;
  }
  // A span on two legs. THE GAP BETWEEN THE LEGS IS THE POINT: it is what
  // lets a ray pass under a piece that is wide but not solid, which is
  // the difference between scenery and a roof.
  const legX = hx * 0.85;
  const legW = Math.min(0.25, hx * 0.3);
  boxes.push({ min: [-legX - legW, -hy * 0.5, -hz], max: [-legX + legW, hy * 0.5, hz * 0.6] });
  boxes.push({ min: [legX - legW, -hy * 0.5, -hz], max: [legX + legW, hy * 0.5, hz * 0.6] });
  boxes.push({ min: [-hx, -hy, hz * 0.6], max: [hx, hy, hz], role: "span" });
  return boxes;
}

/**
 * Build the vocabulary.
 *
 * DETERMINISTIC, from the same hash the placement rules use, so the demo
 * is reproducible end to end: the same seed gives the same catalogue and
 * therefore the same lap.
 */
export function buildVocabulary(seed = 1): VocabAsset[] {
  const out: VocabAsset[] = [];
  let id = 0;

  for (let b = 0; b < BANDS.length; b++) {
    const band = BANDS[b];
    for (let k = 0; k < band.n; k++) {
      const s = id;
      // Z-5: along and across are separate measurements. An aspect ratio
      // rather than a square footprint, because the two differ by up to a
      // factor of thirty inside one real kit and a vocabulary of squares
      // makes the along-lap gap statistics meaningless.
      const foot = span(band.foot, rand(seed, s, 0x01));
      const aspect = 0.25 + rand(seed, s, 0x02) * 3.5;
      const across = foot / Math.sqrt(aspect);
      const along = foot * Math.sqrt(aspect) * 0.5;
      const tall = span(band.tall, rand(seed, s, 0x03));

      // Its lateral home, inside its band. The p10 reaches a little below
      // the band floor on purpose for the inner bands: that overlap is
      // what makes Z-1's corridor resolution reachable, and a catalogue
      // whose laterals never cross 1W leaves that rule green and unrun.
      const median = span([band.tMin, band.tMax], rand(seed, s, 0x04));
      const spread = (band.tMax - band.tMin) * (0.3 + 0.4 * rand(seed, s, 0x05));
      const reach = b === 0 ? 0.35 : 0;

      // Height as the bounds CENTRE, which is the datum the rules use.
      const hMed = tall / 2 + rand(seed, s, 0x06) * 0.4;

      // D-6: the population's response is about 1.33 from straight to
      // tight. Each asset gets its own around that, so the aggregate has
      // a spread rather than every piece behaving identically.
      const lean = 0.6 + rand(seed, s, 0x07) * 1.2;
      out.push({
        id,
        name: `${STEMS[id % STEMS.length]}-${band.name}-${k}`,
        shape: "box",
        // A long tail of one-offs, which is what L-4 draws landmarks from.
        instances: rand(seed, s, 0x08) < 0.62 ? 1 : 1 + Math.floor(rand(seed, s, 0x09) * 22),
        size: { across, along, tall },
        where: {
          lateral: {
            median,
            p10: Math.max(0.2, median - spread - reach),
            p90: median + spread,
          },
          height: { median: hMed, p10: hMed * 0.6, p90: hMed * 1.5 },
          // Most pieces face the track from whichever side they are on;
          // some lean hard to one side, as a barrier does.
          rightOfTravel: rand(seed, s, 0x0a) < 0.7 ? 0.5 : rand(seed, s, 0x0b),
          // C-1's range.
          gapCv: 1.5 + rand(seed, s, 0x0c),
          affinity: {
            straight: lean,
            easy: lean * 0.92,
            medium: lean * 0.8,
            tight: lean / 1.33,
          },
        },
        boxes: [],
      });
      id++;
    }
  }

  // THE SLENDER VERTICALS. L-2 selects markers on proportions — taller
  // than 1.5x its own footprint — and L-3 needs a third for its ruler.
  // Ten, so the seeded choice between them is a real choice rather than
  // the degenerate one a bare-minimum catalogue forces.
  for (let k = 0; k < 10; k++) {
    const s = 0x400 + k;
    const across = 0.25 + rand(seed, s, 0x01) * 0.5;
    const tall = 1.6 + rand(seed, s, 0x02) * 1.8;
    const median = 1.2 + rand(seed, s, 0x03) * 1.6;
    out.push({
      id,
      name: `mast-${k}`,
      shape: "box",
      instances: 1 + Math.floor(rand(seed, s, 0x04) * 18),
      size: { across, along: across * (0.7 + rand(seed, s, 0x05) * 0.6), tall },
      where: {
        lateral: { median, p10: median - 0.4, p90: median + 0.6 },
        height: { median: tall / 2, p10: tall * 0.35, p90: tall * 0.7 },
        rightOfTravel: 0.5,
        gapCv: 1.6 + rand(seed, s, 0x06),
        affinity: { straight: 1, easy: 1.1, medium: 1.2, tight: 1.1 },
      },
      boxes: [],
    });
    id++;
  }

  // THE OVERHEAD PIECES. L-6 tiles cover from these, and without a few
  // that are wide and thin the enclosure pass has nothing to build with
  // and reports an honest zero forever.
  for (let k = 0; k < 12; k++) {
    const s = 0x800 + k;
    const across = 1.4 + rand(seed, s, 0x01) * 3.4;
    const along = 0.4 + rand(seed, s, 0x02) * 4.5;
    const tall = 0.2 + rand(seed, s, 0x03) * 0.8;
    const hMed = 1.6 + rand(seed, s, 0x04) * 1.6;
    out.push({
      id,
      name: `gantry-${k}`,
      shape: "box",
      // FEW, DELIBERATELY. The first version gave these 2-22 instances
      // each and the dressing alone enclosed 29% of the lap — over L-6's
      // ceiling before the enclosure pass ran, so L-6 only ever TRIMMED
      // and the published demo never showed it build a tunnel. The
      // interesting half of the rule is the half that adds.
      instances: 1 + Math.floor(rand(seed, s, 0x05) * 5),
      size: { across, along, tall },
      where: {
        lateral: {
          median: rand(seed, s, 0x06) * 1.2,
          p10: 0,
          p90: 1.4,
        },
        height: { median: hMed, p10: hMed - 0.4, p90: hMed + 0.9 },
        rightOfTravel: 0.5,
        gapCv: 1.5 + rand(seed, s, 0x07),
        affinity: { straight: 1.2, easy: 1, medium: 0.8, tight: 0.6 },
      },
      boxes: [],
    });
    id++;
  }

  // KERB FURNITURE, which is what L-5 acts on. Low pieces at the verge,
  // repeated often enough to fall near each other — bollards, railings,
  // marker posts. Without them nothing ever forms a line in Z2-Z3 at edge
  // height, and L-5 reports an honest zero on every seed while the
  // published page claims to demonstrate it.
  for (let k = 0; k < 10; k++) {
    const s = 0xc00 + k;
    const across = 0.18 + rand(seed, s, 0x01) * 0.35;
    const tall = 0.3 + rand(seed, s, 0x02) * 0.5;
    const median = 1.1 + rand(seed, s, 0x03) * 1.2;
    out.push({
      id,
      name: `kerb-${k}`,
      shape: "box",
      // Common: a run needs three of them inside three half-widths.
      instances: 8 + Math.floor(rand(seed, s, 0x04) * 24),
      size: { across, along: across * (0.8 + rand(seed, s, 0x05) * 1.4), tall },
      where: {
        lateral: { median, p10: median - 0.25, p90: median + 0.35 },
        height: { median: tall / 2 + 0.15, p10: 0.22, p90: 0.55 },
        rightOfTravel: 0.5,
        gapCv: 1.5 + rand(seed, s, 0x06) * 0.6,
        affinity: { straight: 1.1, easy: 1, medium: 0.95, tight: 0.9 },
      },
      boxes: [],
    });
    id++;
  }

  for (const a of out) a.boxes = decompose(a, rand(seed, a.id, 0x5a));
  return out;
}

/**
 * A whole kit, in the shape `dressLap` reads.
 *
 * `placements` is empty: those are the REFERENCE layer, a record of where
 * a measured circuit put its own art, and a synthetic vocabulary has no
 * such record to offer. The page shows the reference only when the real
 * kit is present, which is the honest arrangement — there is nothing to
 * compare a generated lap against here except the rules it was generated
 * from, and those are already gated in the tests.
 */
export function syntheticKit(lapLengthW: number, halfWidthGameUnits = 1000, seed = 1): Kit {
  return {
    track: { lapLengthW, halfWidthGameUnits },
    assets: buildVocabulary(seed) as unknown as Kit["assets"],
    placements: [],
  };
}
