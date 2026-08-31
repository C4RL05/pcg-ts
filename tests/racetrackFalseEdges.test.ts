/**
 * L-5: no false edges.
 *
 * THE RULE THAT WAS EXPECTED TO BE WRONG. Half of it is confirmed and
 * half of it is refuted, and the refuted half is the half I first
 * reported from two runs on one circuit — which is exactly why the
 * pooled sweep was worth asking for.
 *
 * ACROSS THE WHOLE CATALOGUE, seventeen qualifying runs, against a
 * null that keeps the stations and shuffles the offsets:
 *
 *   worst residual   0.063W real vs 0.237W null   p < 0.002
 *   |slope|          0.004 vs 0.012               p = 0.008
 *   diverging        5 of 17 vs 7 of 17           p = 0.264
 *
 * The lines are real and deliberately assembled. THE NON-DIVERGENCE IS
 * NOT: a third of the catalogue's own verge lines are false edges by L-5's own
 * definition. Seventeen runs at a 41% null rate would have given
 * p = 0.0006 had none diverged, so this is a test that could have
 * confirmed the rule and did not — not an underpowered one.
 *
 * MY EARLIER READING WAS WRONG AND IS KEPT HERE AS A CAUTION. Two runs
 * showing 0.001 and 0.015 looked like a rule being obeyed. It was a
 * sample of two. The residual was the statistic worth trusting and it is
 * the one that survived pooling; the divergence count was the one I
 * should not have read anything into, and I said so at the time without
 * quite believing it enough.
 *
 * WHICH IS WHY THE REPAIR EXISTS ANYWAY. The generator draws each
 * lateral independently from its asset's own distribution — that IS the
 * null — so it produces false edges at the null rate unless something
 * stops it.
 */
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { dressLap } from "../demos/racetrack/dress.js";
import {
  BARRIER,
  FALSE_EDGE,
  type EdgeRun,
  edgeRepairIsMinimal,
  edgeRuns,
  falseEdges,
  inEdgeBand,
  isFalseEdge,
  repairFalseEdges,
} from "../demos/racetrack/falseEdges.js";
import { OUTPUTS, buildRoadGraph } from "../demos/racetrack/graph.js";
import type { Kit } from "../demos/racetrack/kit.js";
import { DEFAULT_KIT, kitOrAbsent, kitPath } from "./support/kits.js";
import type { StationedPlacement } from "../demos/racetrack/legibility.js";
import { type Lap, readLap } from "../demos/racetrack/lap.js";
import { makeTrackSpline } from "../demos/racetrack/spline.js";

const KIT_KEY = DEFAULT_KIT;
const KIT = kitPath(KIT_KEY);

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

  /**
   * THE START LINE IS NOT A BREAK IN THE LAP.
   *
   * `edgeRuns` took `lapW` and discarded it, scanning the station-sorted
   * list straight through — so a line laid across station 0 was read as
   * two runs, one at the end of the lap and one at the beginning, each
   * too short to be a false edge. The detector was blind at exactly one
   * place on every lap, and the same blindness reached the repair, which
   * cannot fix what it is not shown.
   *
   * Built as ONE line of six, then rotated onto the seam: the answer is
   * known by construction and is the same answer either way.
   */
  it("reads a line laid across the start line as one run", () => {
    const line = Array.from({ length: 6 }, (_, i) =>
      at((lapW - 5 + 2 * i + lapW) % lapW, 1.2 + 0.05 * (2 * i), 0.4),
    );
    const runs = edgeRuns(line, lapW);
    expect(runs.length).toBe(1);
    expect(runs[0].members.length).toBe(6);
    // The same 10W span and the same 0.05 slope the unrotated line has.
    expect(runs[0].spanW).toBeCloseTo(10, 6);
    expect(runs[0].slope).toBeCloseTo(0.05, 3);
    expect(runs[0].residualW).toBeLessThan(1e-6);
    expect(isFalseEdge(runs[0])).toBe(true);
  });

  it("gives a wrapped line the same verdict as the identical unwrapped one", () => {
    // The control for the test above: rotating a line around the lap is
    // not supposed to change anything about it, so the two readings must
    // agree on every reported figure.
    const straight = Array.from({ length: 6 }, (_, i) =>
      at(40 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4),
    );
    const wrapped = Array.from({ length: 6 }, (_, i) =>
      at((lapW - 5 + 2 * i) % lapW, 1.2 + 0.05 * (2 * i), 0.4),
    );
    const a = edgeRuns(straight, lapW)[0];
    const b = edgeRuns(wrapped, lapW)[0];
    expect(b.members.length).toBe(a.members.length);
    expect(b.spanW).toBeCloseTo(a.spanW, 6);
    expect(b.slope).toBeCloseTo(a.slope, 6);
    expect(isFalseEdge(b)).toBe(isFalseEdge(a));
  });

  it("still breaks a run where the lap really does have a gap", () => {
    // And the other direction: closing the seam must not weld together
    // two lines that are genuinely far apart. Two groups of four, a
    // third of a lap between them.
    const near = Array.from({ length: 4 }, (_, i) => at(10 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4));
    const far = Array.from({ length: 4 }, (_, i) => at(110 + 2 * i, 1.2 + 0.05 * (2 * i), 0.4));
    const runs = edgeRuns([...near, ...far], lapW);
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.members.length === 4)).toBe(true);
  });

  it("permits the same line when it runs parallel", () => {
    // THE DISTINCTION THE WHOLE RULE TURNS ON, and the thing the catalogue
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
    // other rule here draws laterals from the vocabulary.
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

describe.skipIf(!KIT)("false edges on a generated lap", () => {
  const kit = kitOrAbsent<Kit>(KIT_KEY);
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
        `What a real barrier is: ${BARRIER.piecesPerRun.median} pieces at ` +
          `${BARRIER.spacingW.median}W spacing, CV ${BARRIER.spacingW.cv} — against C-1's ` +
          `${BARRIER.furnitureCv[0]}-${BARRIER.furnitureCv[1]} for scattered furniture. ` +
          `A barrier is a REGULAR RUN, not dense furniture, and this demo builds neither: ` +
          `it declines to produce a diverging line rather than producing an assembled one.`,
        `L-5, in Z2-Z3 at h ${FALSE_EDGE.heightW[0]}-${FALSE_EDGE.heightW[1]}W. ` +
          `Pooled over the catalogue's own placements: 17 qualifying runs. Residual 0.063W real vs 0.237W ` +
          `null (p<0.002) — the lines are real. Diverging 5 of 17 vs 7 expected (p=0.264) — ` +
          `the non-divergence is NOT the catalogue's, it is ours.`,
        ...rows,
      ].join("\n"),
    );
    expect(rows.length).toBe(4);
  }, 900_000);
});
