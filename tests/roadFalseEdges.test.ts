/**
 * L-5: no false edges.
 *
 * THE RULE UPSTREAM EXPECTED TO BE WRONG, and it is the only §7 rule
 * whose mechanism is confirmed from the source rather than assumed. Their
 * instruction was to check whether the exemplar can exercise it at all
 * before concluding anything, because a rule that never fires on the
 * source is a rule about nothing. It fires.
 *
 * WHAT THE SOURCE SHOWS. Seven runs of three or more placements in the
 * band, two of which span far enough to qualify — and both are genuine
 * straight lines, one with a maximum residual of 0.00W over 6.2W, which
 * is a barrier rather than a coincidence. Both are parallel, at 0.001 and
 * 0.015 W per W against the rule's 0.02 threshold. The thing L-5
 * describes exists on the circuit, and the instances of it do not
 * diverge.
 *
 * WHAT IT DOES NOT SHOW, kept here because the temptation is to report
 * the first half. Shuffling which lateral goes with which station inside
 * the band — stations kept, so the run structure is identical — turns 39%
 * of qualifying runs into false edges, with a median |slope| of 0.029,
 * ABOVE the threshold. Zero-of-two against that null is p = 0.37. Two
 * runs cannot demonstrate compliance, and this suite does not claim they
 * do. The straightness is the stronger signal (0.10 real against a null
 * median of 0.22) and it argues these are deliberate lines, not that they
 * were deliberately kept parallel.
 *
 * WHICH IS WHY THE REPAIR EXISTS ANYWAY. The generator draws each
 * lateral independently from its asset's own distribution — that IS the
 * null — so it produces false edges at the null rate unless something
 * stops it.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { dressLap } from "../demos/road/dress.js";
import {
  FALSE_EDGE,
  type EdgeRun,
  edgeRepairIsMinimal,
  edgeRuns,
  falseEdges,
  inEdgeBand,
  isFalseEdge,
  repairFalseEdges,
} from "../demos/road/falseEdges.js";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import type { Kit } from "../demos/road/kit.js";
import { DEFAULT_KIT, KITS } from "../demos/road/kitSource.js";
import type { StationedPlacement } from "../demos/road/legibility.js";
import { type Lap, readLap } from "../demos/road/lap.js";
import { makeTrackSpline } from "../demos/road/spline.js";

const KIT = `<kit-dir>/${KITS[DEFAULT_KIT]}`;

/** A placement stub: the detector reads only station, t, h and size. */
function at(station: number, t: number, h: number): StationedPlacement {
  return {
    station,
    t,
    h,
    asset: {
      id: 1,
      name: "stub",
      shape: "box",
      instances: 1,
      size: { across: 0.4, along: 0.4, tall: 0.4 },
    },
  };
}

/**
 * THE DETECTOR, ON LINES BUILT BY HAND so every answer is known by
 * construction. The generated lap can then be trusted to be asking a
 * right question rather than only to be answering one.
 */
describe("what counts as a false edge", () => {
  const lapW = 300;

  it("sees a straight line drifting away from the track", () => {
    // Six pieces, 2W apart, drifting from 1.2W to 1.7W over 10W: a slope
    // of 0.05 W per W, inside the rule's 0.02-0.3 divergence band.
    const line = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4));
    const runs = edgeRuns(line, lapW);
    expect(runs.length).toBe(1);
    expect(runs[0].slope).toBeCloseTo(0.05, 3);
    expect(runs[0].residualW).toBeLessThan(1e-6);
    expect(isFalseEdge(runs[0])).toBe(true);
  });

  it("permits the same line when it runs parallel", () => {
    // THE DISTINCTION THE WHOLE RULE TURNS ON, and the thing the source
    // actually does: a continuous line at the same height in the same
    // band is fine as long as it keeps its distance. A detector that
    // flagged this would forbid barriers.
    const line = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 1.4, 0.4));
    const runs = edgeRuns(line, lapW);
    expect(runs.length).toBe(1);
    expect(Math.abs(runs[0].slope)).toBeLessThan(FALSE_EDGE.divergence[0]);
    expect(isFalseEdge(runs[0])).toBe(false);
  });

  it("permits a drift too steep to be mistaken for the edge", () => {
    // Above 0.3 W per W it is visibly a diagonal, not an edge running
    // alongside. The rule bounds divergence from both sides and a
    // detector with only a floor would flag every radial arrangement.
    //
    // THE STEEP CASE HAS TO STAY INSIDE THE BAND TO TEST ANYTHING. My
    // first version drifted at 0.5 W per W from 1.0W, which leaves
    // |t| = 2.5W after three half-widths — so most members fell outside
    // the band, no run formed, and the test passed for the wrong reason.
    // 1.0W to 2.4W over 4W is 0.35, steep enough and still in Z2-Z3.
    const line = Array.from({ length: 5 }, (_, i) => at(20 + i, 1.0 + 0.35 * i, 0.4));
    const runs = edgeRuns(line, lapW);
    expect(runs.length).toBe(1);
    expect(runs[0].members.length).toBe(5);
    expect(runs[0].spanW).toBeGreaterThanOrEqual(FALSE_EDGE.minSpanW);
    expect(Math.abs(runs[0].slope)).toBeGreaterThan(FALSE_EDGE.divergence[1]);
    expect(isFalseEdge(runs[0])).toBe(false);
  });

  it("permits a scatter that happens to drift", () => {
    // Same trend, but the members sit up to 0.5W off the line. A driver
    // reads a hedge, not an edge.
    const line = [
      at(20, 1.2, 0.4),
      at(22, 1.9, 0.4),
      at(24, 1.3, 0.4),
      at(26, 2.0, 0.4),
      at(28, 1.5, 0.4),
      at(30, 2.2, 0.4),
    ];
    const runs = edgeRuns(line, lapW);
    expect(runs[0].residualW).toBeGreaterThan(FALSE_EDGE.straightW);
    expect(isFalseEdge(runs[0])).toBe(false);
  });

  it("ignores a line too short to read as an edge", () => {
    const line = Array.from({ length: 3 }, (_, i) => at(20 + i, 1.2 + 0.05 * i, 0.4));
    const runs = edgeRuns(line, lapW);
    expect(runs[0].spanW).toBeLessThan(FALSE_EDGE.minSpanW);
    expect(isFalseEdge(runs[0])).toBe(false);
  });

  it("ignores a line outside the band it would be mistaken in", () => {
    // Too low to be an edge, and too far out to be one.
    const low = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 1.2 + 0.05 * (2 * i), 0.1));
    expect(low.some(inEdgeBand)).toBe(false);
    expect(falseEdges(low, lapW).length).toBe(0);

    const far = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 4 + 0.05 * (2 * i), 0.4));
    expect(far.some(inEdgeBand)).toBe(false);
    expect(falseEdges(far, lapW).length).toBe(0);
  });

  it("does not join the two verges into one line", () => {
    // Alternating sides, each side drifting. A run that mixed them would
    // invent an edge out of ordinary two-sided dressing — and would read
    // a zigzag as a straight line, because it fits |t|.
    const both: StationedPlacement[] = [];
    for (let i = 0; i < 6; i++) {
      both.push(at(20 + 2 * i, (i % 2 === 0 ? 1 : -1) * (1.2 + 0.05 * (2 * i)), 0.4));
    }
    const runs = edgeRuns(both, lapW);
    for (const r of runs) expect(r.members.length).toBeLessThan(FALSE_EDGE.minMembers);
  });

  it("measures divergence away from the track on BOTH sides", () => {
    // The same defect mirrored. Fitting the SIGNED lateral would give
    // these opposite slopes and the threshold would only catch one.
    const right = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4));
    const left = right.map((p) => ({ ...p, t: -p.t }));
    expect(isFalseEdge(edgeRuns(right, lapW)[0])).toBe(true);
    expect(isFalseEdge(edgeRuns(left, lapW)[0])).toBe(true);
  });
});

describe("breaking a false edge", () => {
  const lapW = 300;
  const line = Array.from({ length: 6 }, (_, i) => at(20 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4));

  it("breaks it, and reports that it had something to break", () => {
    const r = repairFalseEdges(line, lapW);
    expect(r.before).toBe(1);
    expect(r.moves).toBeGreaterThan(0);
    expect(r.after).toBe(0);
  });

  it("drops the piece below the band rather than moving it sideways", () => {
    // The rule names its own fix: diverging ground detail sits below
    // h = 0.2W or beyond |t| = 2.5W. Straightening the line instead would
    // put a placement at a lateral its own asset never sat at, and every
    // other rule here draws laterals from measurement.
    const r = repairFalseEdges(line, lapW);
    const moved = r.log.map((m) => r.placements[m.index]);
    for (const p of moved) {
      expect(p.h).toBeLessThan(FALSE_EDGE.heightW[0]);
      expect(Math.abs(p.t)).toBeCloseTo(Math.abs(line[0].t) + 0, 0);
    }
  });

  it("makes no move it did not need, and settles", () => {
    const r = repairFalseEdges(line, lapW);
    const { minimal, removable } = edgeRepairIsMinimal(r, lapW);
    expect(minimal, `${removable.length} of ${r.moves} moves unnecessary`).toBe(true);
    expect(repairFalseEdges(r.placements, lapW).moves).toBe(0);
  });

  /**
   * BREAKING IN THE MIDDLE IS NOT ARBITRARY — but it does not make a long
   * line cost one move, and my first version of this test asserted that
   * it did. A 22W line split in half leaves two 10W lines, each still
   * long enough to read as an edge, so the repair fires again on both.
   * That is correct behaviour: the rule is about what a driver sees, and
   * two ten-half-width edges are two edges.
   *
   * What the middle DOES buy is that each move halves what is left rather
   * than shortening it by one piece, so the cost is logarithmic in the
   * line's length instead of linear. Twelve members need four moves, not
   * ten.
   */
  it("breaks a long line into pieces too short to read, and no more", () => {
    const long = Array.from({ length: 12 }, (_, i) => at(20 + 2 * i, 1.0 + 0.03 * (2 * i), 0.4));
    const r = repairFalseEdges(long, lapW);
    expect(r.before).toBe(1);
    expect(r.after).toBe(0);
    // Far short of eroding it one member at a time.
    expect(r.moves).toBeLessThan(long.length / 2);
    const { minimal, removable } = edgeRepairIsMinimal(r, lapW);
    expect(minimal, `${removable.length} of ${r.moves} moves unnecessary`).toBe(true);
  });
});

describe.skipIf(!existsSync(KIT))("false edges on a generated lap", () => {
  const kit = JSON.parse(readFileSync(KIT, "utf8")) as Kit;
  let lap: Lap | undefined;
  async function theLap(): Promise<Lap> {
    if (!lap) {
      const frames = firstGeometry(
        (await cook(buildRoadGraph({ spline: makeTrackSpline({ seed: 1 }), seed: 1 })))
          .outputs[OUTPUTS.frames] ?? [],
      );
      if (!frames) throw new Error("no frames");
      lap = readLap(frames);
    }
    return lap;
  }

  it("leaves none on the finished lap", async () => {
    const l = await theLap();
    for (const seed of [1, 2, 3, 4]) {
      const d = dressLap(kit, l, seed);
      const bad = falseEdges(d.placements, l.lengthW);
      expect(
        bad.length,
        `seed ${seed}: ${bad.map((r: EdgeRun) => `${r.startW.toFixed(0)}W span ${r.spanW.toFixed(1)} slope ${r.slope.toFixed(3)}`).join("; ")}`,
      ).toBe(0);
    }
  }, 900_000);

  /**
   * AND THE RULE MUST HAVE HAD SOMETHING TO DO. A lap with no false edges
   * because the generator never makes one is a different claim from a lap
   * with none because they were repaired, and only the stat line can tell
   * them apart. If this ever reads zero on every seed, L-5 is costing
   * nothing and protecting nothing, and that is worth knowing rather than
   * celebrating.
   */
  it("reports how many it found and what breaking them cost", async () => {
    const l = await theLap();
    const rows: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const s = dressLap(kit, l, seed).stats;
      rows.push(`  seed ${seed}: ${s.falseEdges} found, ${s.edgeMoves} pieces dropped below the band`);
    }
    console.log(
      [
        `L-5, in Z2-Z3 at h ${FALSE_EDGE.heightW[0]}-${FALSE_EDGE.heightW[1]}W. ` +
          `Source exemplar: 7 runs of ${FALSE_EDGE.minMembers}+, 2 spanning ${FALSE_EDGE.minSpanW}W+, ` +
          `both parallel (slopes 0.001 and 0.015) and both straight (residuals 0.00 and 0.10W). ` +
          `Null with laterals shuffled: 39% of qualifying runs diverge.`,
        ...rows,
      ].join("\n"),
    );
    expect(rows.length).toBe(4);
  }, 900_000);
});
