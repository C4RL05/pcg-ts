/**
 * Does the coordinate contract actually transfer?
 *
 * THE ONE END-TO-END CHECK. Everything else in this collaboration rests
 * on one claim: that a station, a signed lateral and a height mean the
 * same thing on both sides. Every occupancy figure exchanged so far could
 * have been right while that claim was false, and a mirrored axis already
 * shipped once on this side without being visible in any render.
 *
 * So: take 442 placements measured on a real circuit, drop them onto a
 * spline they were never measured from, and ask whether the result reads
 * as a track or as a cloud. The tests below are that question, split into
 * the ways it can fail — placements too far from the road, placements
 * scattered rather than sequenced, both sides of the road empty.
 *
 * SKIPS WITHOUT THE KIT, which lives outside both repositories and is not
 * ours to commit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cook, firstGeometry } from "pcg-ts";
import { OUTPUTS, buildRoadGraph } from "../demos/road/graph.js";
import { type Lap, placeAt, poseAt, readLap } from "../demos/road/lap.js";
import { makeTrackSpline } from "../demos/road/spline.js";
import { type Kit, type PlacedBox, placeKit } from "../demos/road/kit.js";
import { kitPath } from "./support/kits.js";

const KIT = kitPath("street");

function pct(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function readTheLap(): Promise<Lap> {
  const spline = makeTrackSpline({ seed: 1 });
  const out = (await cook(buildRoadGraph({ spline, seed: 1 }))).outputs;
  const frames = firstGeometry(out[OUTPUTS.frames] ?? []);
  if (!frames) throw new Error("no frames");
  return readLap(frames);
}

/** The frame lookup `placeKit` wants, built from the host's own pose. */
function frameAt(lap: Lap) {
  return (station: number, lateral: number, height: number) => {
    const pose = poseAt(lap, station * lap.halfWidth);
    const { p } = placeAt(lap, { station, lateral, height });
    return { p, across: pose.across, along: pose.dir, up: pose.up };
  };
}

describe.skipIf(!KIT)("the kit's coordinates on our spline", () => {
  const kit = JSON.parse(readFileSync(KIT!, "utf8")) as Kit;

  it("places every box within reach of the road", async () => {
    const lap = await readTheLap();
    const placed = placeKit(kit, lap, frameAt(lap));
    expect(placed.length).toBeGreaterThan(500);

    // Distance from each box centre to the nearest centreline frame,
    // in half-widths. The kit's own laterals run to about 9 W and its
    // heights to about 10, so nothing should sit much past those — and a
    // convention error would show here as a tail running to the lap
    // radius rather than to the road's shoulder.
    const offs = placed.map((b) => {
      let best = Infinity;
      for (let i = 0; i < lap.count; i += 3) {
        const d = dist(b.centre, [lap.p[i * 3], lap.p[i * 3 + 1], lap.p[i * 3 + 2]]);
        if (d < best) best = d;
      }
      return best / lap.halfWidth;
    });
    console.log(
      `box offset from the centreline, W:  median ${pct(offs, 0.5).toFixed(1)}` +
        `  p90 ${pct(offs, 0.9).toFixed(1)}  max ${pct(offs, 1).toFixed(1)}`,
    );
    // Generous, because this is a shape test and not a tolerance: the
    // point is that the tail stops at the roadside rather than running
    // out to the lap's own radius, which is 60 W away.
    expect(pct(offs, 1)).toBeLessThan(20);
  }, 120_000);

  /**
   * A TRACK, NOT A CLOUD, and this is the test that phrase means.
   *
   * Sort the placements by station and walk them. On a real layout each
   * one is near the last, because station is arc length and arc length is
   * continuous. Under a broken convention the same walk jumps across the
   * circuit every step, and the median hop goes from a few half-widths to
   * a sizeable fraction of the lap.
   */
  it("sequences along the lap rather than scattering across it", async () => {
    const lap = await readTheLap();
    const byStation = [...kit.placements].sort((a, b) => a.station - b.station);
    const pts = byStation.map((pl) => frameAt(lap)(pl.station * (lap.lengthW / kit.track.lapLengthW), pl.lateral, pl.height).p);

    const hops: number[] = [];
    for (let i = 1; i < pts.length; i++) hops.push(dist(pts[i - 1], pts[i]) / lap.halfWidth);

    // The control, and the reason this is not a bare threshold: the same
    // statistic over the same points in a DIFFERENT order. A cloud scores
    // the same either way; a sequence does not.
    const shuffledHops: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const j = (i * 7919) % pts.length;
      const k = ((i + 1) * 7919) % pts.length;
      shuffledHops.push(dist(pts[j], pts[k]) / lap.halfWidth);
    }
    console.log(
      `hop between station-ordered placements, W:  median ${pct(hops, 0.5).toFixed(1)}` +
        `   shuffled control: ${pct(shuffledHops, 0.5).toFixed(1)}`,
    );
    expect(pct(hops, 0.5)).toBeLessThan(pct(shuffledHops, 0.5) / 5);
  }, 120_000);

  it("uses both sides of the road", async () => {
    const lap = await readTheLap();
    const at = frameAt(lap);
    let right = 0;
    let left = 0;
    for (const pl of kit.placements) {
      const here = poseAt(lap, pl.station * (lap.lengthW / kit.track.lapLengthW) * lap.halfWidth);
      const p = at(pl.station * (lap.lengthW / kit.track.lapLengthW), pl.lateral, pl.height).p;
      const side =
        (p[0] - here.p[0]) * here.across[0] +
        (p[1] - here.p[1]) * here.across[1] +
        (p[2] - here.p[2]) * here.across[2];
      if (side > 0) right++;
      else left++;
    }
    console.log(`placements right of travel: ${right}, left: ${left}`);
    // The kit reads 191 right and 251 left in its own coordinates. Both
    // sides populated is the weak claim; the strong one is that the SPLIT
    // survives the transfer, because a flipped `across` would swap these
    // two numbers and nothing else in the render would look wrong.
    expect(right).toBeGreaterThan(100);
    expect(left).toBeGreaterThan(100);
    expect(left).toBeGreaterThan(right);
  }, 120_000);

  /**
   * The transfer is a rotation and a UNIFORM scale, so every shape it
   * carries has to arrive unchanged.
   *
   * Comparing the aspect before and after rather than testing the aspect
   * against a number: an absolute threshold would be measuring the KIT
   * (how flat its boxes are, which is a fact about the source grid and
   * upstream's business) instead of measuring the transfer. Applying a
   * half-width to two axes of three, or mapping across/along/up onto the
   * wrong three, changes this ratio and nothing else here would notice.
   */
  it("carries every box's shape across unchanged", async () => {
    const lap = await readTheLap();
    const placed: PlacedBox[] = placeKit(kit, lap, frameAt(lap));

    const before: number[] = [];
    for (const pl of kit.placements) {
      for (const b of pl.boxes) {
        const e = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
        before.push(Math.min(...e) / Math.max(...e));
      }
    }
    expect(placed.length).toBe(before.length);

    let worst = 0;
    for (let i = 0; i < placed.length; i++) {
      const after = Math.min(...placed[i].size) / Math.max(...placed[i].size);
      worst = Math.max(worst, Math.abs(after - before[i]));
    }
    const sheets = placed.filter((b) => b.thickness < 0.01);
    console.log(
      `${placed.length} boxes, ${sheets.length} of them sheets (thickness < 0.01 W); ` +
        `worst aspect change across the transfer: ${worst.toExponential(1)}`,
    );
    // The floor on `size` guards a degenerate scale matrix, so an exactly
    // zero-extent axis is the one case that legitimately moves.
    expect(worst).toBeLessThan(1e-3);
  }, 120_000);
});
