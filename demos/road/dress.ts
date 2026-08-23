/**
 * The whole pipeline, in §9's order.
 *
 * THE ORDER IS THE DESIGN, and getting it wrong makes the rules look
 * incompatible when they are only mis-sequenced:
 *
 *   0. reserve       L-2/L-3's vocabulary, before anything is dressed
 *   1. stations      how many and where along  (D-1, D-5's curve)
 *   2. assets        which asset, from its own measured behaviour
 *   3. corridor      Z-1, by size
 *   4. language      L-2's markers and L-3's rulers
 *   5. landmarks     L-4
 *   6. sightline     L-1's cull — MOVES AND DROPS THINGS
 *   7. coverage      D-4 — closes the gaps the cull opened
 *   8. band mix      Z-3 — fixes the bands the cull moved
 *
 * THE CULL IS SIXTH, NOT FOURTH, and that is a correction. It used to run
 * before the legibility rules, which meant every marker L-2 placed and
 * every asset L-4 swapped in went onto the lap WITHOUT EVER BEING CONE
 * TESTED — a corner marker is a tall object near the racing line and is
 * exactly the kind of thing L-1 exists to catch. §9's step 11 places the
 * markers and then runs the cone test, in that order, and it is right:
 * §7 decides what must exist, and L-1 gets the last word on whether it
 * may stand where it was put.
 *
 * The price is that L-1 can push one mark of a ruler outward and break
 * L-3's "on one line". §9 resolves that by ordering rather than by
 * exemption, so the cull wins and the damage is counted.
 *
 * Seven and eight still come after the cull, for the original reason: a
 * mix repaired before a cull is a mix repaired against a lap that no
 * longer exists.
 *
 * EVERY REPAIR IS MINIMAL AND REPORTS ITS FIRE COUNT. A repair that never
 * runs is indistinguishable from a compliant generator at the assertion
 * level, and a repair that overshoots satisfies every bound while being
 * wrong — so each stage says how much it had to do.
 */
import {
  type CurvatureBucket,
  type PlaceableAsset,
  bucketOf,
  placeAsset,
  Z3,
  repairBandMix,
} from "./assets.js";
import { type Corner, cornersOf, radiusAtW } from "./corners.js";
import type { Kit, PlacedBox } from "./kit.js";
import type { Lap } from "./lap.js";
import { placeAt, poseAt } from "./lap.js";
import {
  type MarkerKit,
  type StationedPlacement,
  brakingRulersSatisfied,
  cornerMarkersSatisfied,
  placeCornerLanguage,
  repairLandmarks,
  reserveMarkers,
} from "./legibility.js";
import { repairFalseEdges } from "./falseEdges.js";
import { type Frame, cullSightlines, defaultEyeStations } from "./sightline.js";
import { LONG_QUANTILE, longCoverBudgetW, placeEnclosure, reduceEnclosure } from "./tunnels.js";
import { measureEnclosure } from "./enclosure.js";
import { makeStationsDetailed, repairPlacementCoverage } from "./stations.js";
import { resolveCorridor } from "./zones.js";

export { radiusAtW };

/**
 * How many times the tail may validate and feed back before giving up.
 *
 * Six is generous: the loop converges in two on every seed measured. It
 * is bounded at all because the four repairs it runs can in principle
 * chase each other — the cull drops what coverage just placed, coverage
 * replaces it, and so on — and a demo that hangs on one seed in a hundred
 * is worse than one that reports it did not settle.
 */
const MAX_REPAIR_ROUNDS = 6;

/** What each stage had to do, so a page can show it. */
export interface DressStats {
  readonly placed: number;
  /** D-4 closed at step 1, on the stations, before anything was culled. */
  readonly stationGapRepairs: number;
  /** D-4 closed again at step 7, on the lap the cull left behind. */
  readonly coverageMoves: number;
  /** And what the longest gap is once it has. */
  readonly worstGapW: number;
  readonly corridorFixes: number;
  readonly corners: number;
  readonly tightCorners: number;
  readonly markersConverted: number;
  readonly markersAdded: number;
  readonly brakeMarks: number;
  readonly brakeDisplaced: number;
  readonly blocked: number;
  readonly pushedOut: number;
  readonly dropped: number;
  /** L-6: runs of cover placed, and the pieces they are tiled from. */
  readonly coverStretches: number;
  readonly coverPieces: number;
  /** The share of lap the top-up intended. What it ACHIEVES is measured. */
  readonly plannedEnclosure: number;
  /** Overhead pieces moved out to bring an over-enclosed lap under. */
  readonly enclosureTrims: number;
  /** And how many whole covered runs those pieces made up. */
  readonly enclosureRunsTrimmed: number;
  /** L-6 left unsatisfied because trimming further would break Z-3. */
  readonly enclosureBlocked: boolean;
  /** L-5: lines in Z2-Z3 that a driver could mistake for the track edge. */
  readonly falseEdges: number;
  readonly edgeMoves: number;
  /** Enclosure the ORDINARY dressing already produced, before L-6 ran. */
  readonly enclosureBefore: number;
  /** And what the finished lap measures. L-6's only real claim. */
  readonly enclosureAfter: number;
  /** How many validate-and-feed-back rounds the tail needed. */
  readonly rounds: number;
  /** Whether it reached a fixed point, or ran out of rounds still repairing. */
  readonly converged: boolean;
  /** Corners whose marker the cull moved off the outside or dropped. */
  readonly markersLostToCull: number;
  /** Rulers the cull broke — L-1 wins, and this is what that costs. */
  readonly rulersLostToCull: number;
  readonly landmarkFixes: number;
  readonly mixMoves: number;
  readonly cookMs: number;
}

export interface Dressing {
  readonly boxes: PlacedBox[];
  readonly stats: DressStats;
  /**
   * The placements the boxes were built from, and the corner model they
   * were built against.
   *
   * RETURNED SO THE ASSEMBLED PIPELINE CAN BE CHECKED. Every rule here
   * had a test of its own and the pipeline that runs them had none, which
   * is how the cull came to run before the legibility rules for as long
   * as it did: each stage was correct and the ORDER was not, and nothing
   * looked at the order. A gate on the finished lap is the only thing
   * that can see that class of defect.
   */
  readonly placements: StationedPlacement[];
  readonly corners: Corner[];
  readonly markers?: MarkerKit;
}

/** The lap's own frame lookup, shared by every stage that needs one. */
export function frameLookup(lap: Lap): (s: number, t: number, h: number) => Frame {
  return (s, t, h) => {
    const pose = poseAt(lap, s * lap.halfWidth);
    return {
      p: placeAt(lap, { station: s, lateral: t, height: h }).p,
      dir: pose.dir,
      up: pose.up,
      across: pose.across,
    };
  };
}


/**
 * Each placement's own box decomposition, put on the lap.
 *
 * A FUNCTION BECAUSE IT RUNS TWICE. L-6 has to know how much of the lap
 * the dressing ALREADY covers before it can decide how much to add, and
 * that is a question about boxes rather than about placements — a
 * placement is a point, and whether something spans the corridor is a
 * fact about its geometry.
 */
function buildBoxes(kit: Kit, lap: Lap, placements: readonly StationedPlacement[]): PlacedBox[] {
  const W = lap.halfWidth;
  const frameAt = frameLookup(lap);
  const boxes: PlacedBox[] = [];
  for (const p of placements) {
    const frame = frameAt(p.station, p.t, p.h);
    const kitAsset = kit.assets.find((a) => (a as unknown as PlaceableAsset).id === p.asset.id) as
      | { boxes?: { min: number[]; max: number[]; role?: string; thickness?: number }[] }
      | undefined;
    for (const b of kitAsset?.boxes ?? []) {
      const c = [
        ((b.min[0] + b.max[0]) / 2) * W,
        ((b.min[1] + b.max[1]) / 2) * W,
        ((b.min[2] + b.max[2]) / 2) * W,
      ];
      boxes.push({
        centre: [
          frame.p[0] + frame.across[0] * c[0] + frame.dir[0] * c[1] + frame.up[0] * c[2],
          frame.p[1] + frame.across[1] * c[0] + frame.dir[1] * c[1] + frame.up[1] * c[2],
          frame.p[2] + frame.across[2] * c[0] + frame.dir[2] * c[1] + frame.up[2] * c[2],
        ],
        size: [
          Math.max((b.max[0] - b.min[0]) * W, 1e-3),
          Math.max((b.max[1] - b.min[1]) * W, 1e-3),
          Math.max((b.max[2] - b.min[2]) * W, 1e-3),
        ],
        basis: { across: frame.across, along: frame.dir, up: frame.up },
        role: b.role ?? "mass",
        cover: p.cover === true,
        thickness: b.thickness ?? 0,
      });
    }
  }
  return boxes;
}

/** How many corners are still correctly marked, and how many rulers hold. */
function legibilityHealth(
  placements: readonly StationedPlacement[],
  corners: readonly Corner[],
  markers: MarkerKit | undefined,
  lapW: number,
): { unmarked: number; brokenRulers: number } {
  if (!markers) return { unmarked: 0, brokenRulers: 0 };
  return {
    unmarked: cornerMarkersSatisfied(placements, corners, markers, lapW).missing.length,
    brokenRulers: brakingRulersSatisfied(placements, corners, markers, lapW).failures.length,
  };
}

/**
 * Dress a lap from a measured kit.
 *
 * The output is the same `PlacedBox` shape the reference log produces, so
 * a page can draw generated dressing and measured dressing with one
 * renderer — which is the only way a viewer can compare them fairly.
 */
export function dressLap(kit: Kit, lap: Lap, seed: number): Dressing {
  const t0 = performance.now();
  const all = (kit.assets as unknown as PlaceableAsset[]).filter((a) => a.where);
  const frameAt = frameLookup(lap);
  const corners = cornersOf(lap);

  // 0. Reserve L-2 and L-3's vocabulary BEFORE anything is dressed. An
  //    object that also appears sixty times as scenery cannot announce a
  //    corner, so exclusivity is established by construction rather than
  //    hoped for afterwards.
  const { markers, pool } = reserveMarkers(all, seed);
  const reserved = new Set(
    markers ? [markers.sharp.id, markers.open.id, markers.brake.id] : [],
  );

  // 1. Stations.
  const st = makeStationsDetailed(lap.lengthW, seed);

  // 2. An asset per station, from its own measured behaviour, weighted by
  //    the curvature THERE. This is the only place curvature enters.
  let placements: StationedPlacement[] = [];
  for (let i = 0; i < st.stations.length; i++) {
    const s = st.stations[i];
    const bucket: CurvatureBucket = bucketOf(radiusAtW(lap, s));
    const p = placeAsset(pool, bucket, seed, i);
    if (p) placements.push({ ...p, station: s });
  }

  // 3. Z-1, by size. The asset's own lateral distribution reaches inside
  //    the corridor for some assets, which is what makes this reachable.
  let corridorFixes = 0;
  placements = placements.map((p) => {
    // Cover is placed clear of the corridor by construction — see
    // `coverPlacements`. Standing a tunnel rib off to the corridor edge
    // puts a hole in the roof over the racing line.
    if (p.cover) return p;
    const baseH = p.h - p.asset.size.tall / 2;
    const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
    if (fixed.t === p.t && fixed.baseH === baseH) return p;
    corridorFixes++;
    return { ...p, t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
  });

  // 4. L-2 and L-3. Markers land outside the corridor by construction, so
  //    they do not need step 3 run again over them.
  const lang = placeCornerLanguage(placements, corners, markers, lap.lengthW, seed);
  placements = lang.placements;

  // 5. L-4, which may not touch the reserved vocabulary.
  const marks = repairLandmarks(placements, pool, lap.lengthW, seed, reserved);
  placements = marks.placements;

  const before = legibilityHealth(placements, corners, markers, lap.lengthW);

  // 6-9. §9's step 12: VALIDATE, AND FEED EACH FAILURE BACK INTO THE PASS
  //      THAT OWNS IT. Run once through, these four repairs undo one
  //      another. The cull opens gaps, so coverage moves a placement into
  //      one — possibly into the cone the cull just cleared. The mix
  //      re-draws a placement with an asset from another band, which can
  //      be larger than the one it replaced and can block. Both change
  //      which assets appear exactly once, which is the whole of L-4. A
  //      single pass left 31 placements blocking the cone and a bare
  //      tenth of the lap, with every individual stage behaving
  //      correctly.
  //
  //      So the tail is a fixed point rather than a sequence. It is
  //      bounded, and whether it converged is reported rather than
  //      assumed: a repair loop that silently ran out of rounds would
  //      leave a lap breaking a threshold with a stat line full of
  //      plausible numbers.
  const eyes = defaultEyeStations(lap.lengthW);
  let rounds = 0;
  let blocked = 0;
  let pushedOut = 0;
  let dropped = 0;
  let coverageMoves = 0;
  let landmarkFixes = 0;
  let mixMoves = 0;
  let worstGapW = 0;
  let coverStretches = 0;
  let coverPieces = 0;
  let plannedEnclosure = 0;
  let enclosureBefore = -1;
  let enclosureTrims = 0;
  let enclosureRunsTrimmed = 0;
  let enclosureBlocked = false;
  let edgeMoves = 0;
  let edgesFound = 0;
  let converged = false;
  while (rounds < MAX_REPAIR_ROUNDS) {
    rounds++;
    // Z-1 FIRST, OVER WHAT THE PREVIOUS ROUND'S MIX DREW. The `over` band is |t| < 1W,
    // which is the corridor — so satisfying Z-3's floor for it means
    // deliberately drawing assets whose own lateral sits there, and
    // `placeAsset` then gives them their own measured HEIGHT, which for
    // most of them is about half a half-width. That is an object in the
    // middle of the road at knee height. Z-1 ran at step 3 and never saw
    // them, because they did not exist yet; nine per lap survived to the
    // finished dressing, sitting on the racing line.
    //
    // `over` does not mean "in the corridor", it means SPANNING it, and
    // resolving them here is what makes that true.
    //
    // IT RUNS BEFORE THE CULL, and the order is the whole of it. Z-1
    // stands a large piece off to the corridor EDGE and no further, by
    // rule — but half its width still overhangs the corridor, so the
    // cone can still be blocked. Running Z-1 after the cull put the two
    // rules in a loop: the cull pushed a piece clear, Z-1 pulled it back
    // to the edge, and the lap finished with eight objects on the racing
    // line and a repair count that had settled. §9 gives L-1 the last
    // word, so L-1 goes last.
    let fixedThisRound = 0;
    placements = placements.map((p) => {
      if (p.cover) return p;
      const baseH = p.h - p.asset.size.tall / 2;
      const fixed = resolveCorridor(p.t, baseH, p.asset.size.across, p.asset.size.tall);
      if (fixed.t === p.t && fixed.baseH === baseH) return p;
      fixedThisRound++;
      return { ...p, t: fixed.t, h: fixed.baseH + p.asset.size.tall / 2 };
    });
    corridorFixes += fixedThisRound;


    const cull = cullSightlines(
      placements.map((p) => ({
        station: p.station,
        t: p.t,
        h: p.h,
        across: p.asset.size.across,
        along: p.asset.size.along,
        tall: p.asset.size.tall,
        src: p,
      })),
      lap.lengthW,
      frameAt,
      lap.halfWidth,
      eyes,
      (o) => markers !== undefined && o.src.asset.id === markers.brake.id,
    );
    placements = cull.kept.map((o) => ({ ...o.src, t: o.t, h: o.h, station: o.station }));
    blocked += cull.blocking;
    pushedOut += cull.moved;
    dropped += cull.dropped;

    // L-6, AS A TOP-UP AND AFTER THE CULL.
    //
    // §9 puts enclosure at step 5 and places it before anything else is
    // dressed, which assumes cover comes only from the enclosure pass. It
    // does not: measured by ray cast, the ordinary dressing on an
    // overhead-rich kit already runs a fifth to a third of the lap under
    // something, from nothing but the per-asset placement of a vocabulary
    // that happens to be half overhead pieces.
    //
    // AND IT HAS TO BE MEASURED HERE RATHER THAN BEFORE THE CULL. Before
    // it the same lap reads 34.2%; after it, 24.8% — L-1 pushes overhead
    // pieces outward and takes nine points of enclosure with them.
    // Topping up against the pre-cull figure adds nothing and then
    // watches the cull open the roof, which is the same mistake as
    // repairing coverage against a lap the cull has not run on yet.
    //
    // WHAT IT SUPPLIES IS THE TAIL, NOT THE TOTAL. That incidental cover
    // is fifty-odd SHORT stretches with a heavy-tail share of ZERO, where
    // the source holds 39% of its covered length in the few longer than
    // 10W. The total can be right while the shape is wrong: what the
    // dressing never produces on its own is a tunnel.
    const already = measureEnclosure(lap, buildBoxes(kit, lap, placements));
    if (enclosureBefore < 0) enclosureBefore = already.share;
    const coveredW = already.share * lap.lengthW;
    const budgetW = longCoverBudgetW(coveredW, already.heavyTailShare * coveredW, lap.lengthW);
    let addedCover = 0;
    if (budgetW > 0) {
      const add = placeEnclosure(
        all,
        lap.lengthW,
        corners,
        (st) => radiusAtW(lap, st),
        seed + rounds,
        budgetW,
        LONG_QUANTILE,
      );
      placements = [...placements, ...add.placements.map((p) => ({ ...p, cover: true as const }))];
      coverStretches += add.plans.length;
      coverPieces += add.placements.length;
      plannedEnclosure += add.plannedShare;
      addedCover = add.plans.length;
    }

    // And the other end of the range. See `reduceEnclosure`: on a kit
    // whose vocabulary is half overhead pieces the dressing sails past
    // L-6's ceiling with no enclosure pass having run at all, and no
    // amount of adding fixes a lap that already has too much roof.
    const reduce = reduceEnclosure(
      placements,
      (ps) => measureEnclosure(lap, buildBoxes(kit, lap, ps)),
      Math.ceil(Z3.over.rule[0] * placements.length),
    );
    placements = reduce.placements;
    enclosureTrims += reduce.moves;
    enclosureRunsTrimmed += reduce.runsTrimmed;
    if (reduce.blockedByBandMix) enclosureBlocked = true;

    // D-4, on the lap the cull actually left. The station process
    // enforces coverage too, but at step 1 — before a single one of the
    // gaps it is meant to close has been opened. It matters: under a
    // UNIFORM thinning D-4 barely ever breaks, but this cull is not
    // uniform, it empties contiguous stretches, and against a 26W
    // emptied stretch the limit is breached on every lap of eight by up
    // to 17W.
    //
    // Markers are protected. A marker moved to close a gap is a corner
    // that no longer announces itself, and there are three hundred other
    // placements to move instead.
    const cov = repairPlacementCoverage(placements, lap.lengthW, {
      protect: (p) => reserved.has(p.asset.id) || p.cover === true,
    });
    placements = cov.placements;
    coverageMoves += cov.moves;
    worstGapW = cov.worstGapAfterW;

    // L-4 after them, because both change which assets appear once.
    const marks = repairLandmarks(placements, pool, lap.lengthW, seed + rounds, reserved);
    placements = marks.placements;
    landmarkFixes += marks.moves;

    // L-5, before the mix, because breaking an edge lowers a placement
    // out of the verge band and Z-3 has to see the lap that leaves.
    const edges = repairFalseEdges(placements, lap.lengthW);
    placements = edges.placements;
    edgeMoves += edges.moves;
    edgesFound += edges.before;

    // Z-3 next, against the lap that actually exists.
    const mix = repairBandMix(
      placements,
      pool,
      seed + rounds,
      "centre",
      reserved,
      (p) => p.cover === true,
    );
    placements = mix.placements.filter((p): p is StationedPlacement => p !== undefined);
    mixMoves += mix.moves;

    if (
      cull.blocking === 0 &&
      cov.moves === 0 &&
      marks.moves === 0 &&
      mix.moves === 0 &&
      edges.moves === 0 &&
      fixedThisRound === 0 &&
      addedCover === 0 &&
      reduce.moves === 0
    ) {
      converged = true;
      break;
    }
  }

  const after = legibilityHealth(placements, corners, markers, lap.lengthW);

  const boxes = buildBoxes(kit, lap, placements);

  return {
    boxes,
    placements,
    corners,
    markers,
    stats: {
      placed: placements.length,
      stationGapRepairs: st.gapRepairs,
      coverageMoves,
      worstGapW,
      corridorFixes,
      corners: lang.corners,
      tightCorners: lang.tightCorners,
      markersConverted: lang.converted,
      markersAdded: lang.added,
      brakeMarks: lang.brakeAdded,
      brakeDisplaced: lang.brakeDisplaced,
      blocked,
      pushedOut,
      dropped,
      rounds,
      converged,
      markersLostToCull: Math.max(0, after.unmarked - before.unmarked),
      rulersLostToCull: Math.max(0, after.brokenRulers - before.brokenRulers),
      coverStretches,
      coverPieces,
      plannedEnclosure,
      enclosureTrims,
      enclosureRunsTrimmed,
      enclosureBlocked,
      falseEdges: edgesFound,
      edgeMoves,
      enclosureBefore: Math.max(0, enclosureBefore),
      enclosureAfter: measureEnclosure(lap, boxes).share,
      landmarkFixes: marks.moves + landmarkFixes,
      mixMoves,
      cookMs: performance.now() - t0,
    },
  };
}
