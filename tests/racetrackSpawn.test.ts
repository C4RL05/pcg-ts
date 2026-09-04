/**
 * The spawn seam: the dressing, as clouds the library's spawner consumes.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR. `demos/racetrack` used to compose one
 * `THREE.Matrix4` per box by hand and stuff a single `InstancedMesh`. It
 * now writes the same boxes as a point cloud carrying the standard
 * transform attributes plus an `asset` id, and lets `buildInstanceBatches`
 * compose the matrices. Those are two independent implementations of the
 * same transform, and the ONLY thing that makes the swap safe is checking
 * one against the other — a comment claiming "same convention" would have
 * been just as convincing while being wrong about, say, whether the frame
 * axes are the matrix's rows or its columns.
 *
 * AND THE TWO DO NOT AGREE EXACTLY, FOR A REASON WORTH KNOWING. Writing
 * this suite found it: the old path used the track frame's three axes
 * DIRECTLY as the matrix's columns, and those axes are not quite
 * orthogonal. `poseAt` (`lap.ts`) lerps each of `across`, `along` and
 * `up` between two frames and renormalises each one INDEPENDENTLY — so
 * every axis is unit to 2e-16, and the triple is mutually orthogonal only
 * to about 1.6e-4, worst exactly where the track turns hardest and the
 * two blended frames are furthest apart. A matrix built from those
 * columns is a rotation plus a small shear.
 *
 * The spawner cannot reproduce that and should not: it carries the frame
 * as a QUATERNION, which can only express a rotation, so the shear is
 * projected away. On this lap that moves a box corner by at most
 * `maxExtent * 1.6e-4` — under two centimetres on a nine-unit half-width,
 * invisible — and it makes every instance a true rigid transform, which
 * the old path did not guarantee.
 *
 * So the comparison here is against the legacy matrix WITH ITS SHEAR
 * PROJECTED OUT, at a tolerance tight enough to catch a real convention
 * error (a swapped axis, rows for columns), and the shear itself is
 * measured separately rather than absorbed into a loose bound. A single
 * "within 1e-3" check over the raw matrices would have passed while
 * saying nothing about either.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { buildInstanceBatches, cook, firstGeometry } from "pcg-ts";
import { dressLap, frameLookup } from "../demos/racetrack/dress.js";
import { dressedLapFor } from "./support/lap.js";
import type { PlacedBox } from "../demos/racetrack/kit.js";
import {
  ASSET_ATTR,
  DEFAULT_ASSET,
  boxAssetId,
  boxAssetIds,
  boxCloud,
  placementAssetId,
  placementCloud,
} from "../demos/racetrack/spawn.js";
import { makeAssetMap } from "../demos/racetrack/assets3d.js";
import { LOOK } from "../demos/racetrack/look.js";

/**
 * How far apart two matrix elements may be, once the shear is out.
 *
 * f32 storage of a translation a few thousand units from the origin is
 * itself worth ~3e-4, which sets the floor here; 1e-3 clears it with room
 * and is still four orders below any axis-convention mistake, which moves
 * a whole extent.
 */
const MATRIX_TOL = 1e-3;

/**
 * The largest mutual non-orthogonality the track frame is allowed.
 *
 * Measured at 1.62e-4 over 1985 boxes on seed 1. This is not a tolerance
 * for the comparison below — it is a claim about `poseAt`'s
 * per-axis-independent renormalisation, and it fails loudly if that
 * changes for the worse rather than quietly widening a bound somewhere.
 */
const MAX_FRAME_SKEW = 5e-4;

/** The old hand-written composition, kept here as the thing to match. */
function legacyMatrix(b: PlacedBox): Matrix4 {
  const basis = new Matrix4();
  const local = new Matrix4();
  basis.set(
    b.basis.across[0], b.basis.along[0], b.basis.up[0], b.centre[0],
    b.basis.across[1], b.basis.along[1], b.basis.up[1], b.centre[1],
    b.basis.across[2], b.basis.along[2], b.basis.up[2], b.centre[2],
    0, 0, 0, 1,
  );
  local.makeScale(b.size[0], b.size[1], b.size[2]);
  return basis.multiply(local);
}

/**
 * The same transform with its shear projected out — a true `T*R*S`.
 *
 * `decompose` reads the scale off the column lengths (exact here, since
 * each column is a unit axis times an extent) and then takes the
 * quaternion of what is left, which is the nearest rotation. Recomposing
 * gives the rigid transform the sheared one was approximating, and that
 * is what the spawner necessarily produces.
 */
function withoutShear(m: Matrix4): Matrix4 {
  const t = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(t, q, s);
  return new Matrix4().compose(t, q, s);
}

const dot3 = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The shared fixture, memoized across the whole suite — see
 * `tests/support/lap.ts`. Every caller here wants seed 1, which is why the
 * default this replaced had five callers and no argument between them.
 */
const dressOnce = (): ReturnType<typeof dressedLapFor> => dressedLapFor(1);

describe("racetrack spawn seam", () => {
  it("composes the same instance transforms the hand-written renderer did", async () => {
    const { dressing } = await dressOnce();
    expect(dressing.boxes.length).toBeGreaterThan(100);

    const batches = buildInstanceBatches(boxCloud(dressing.boxes), {
      defaultAssetId: DEFAULT_ASSET,
      assetAttr: ASSET_ATTR,
    });

    // The spawner GROUPS by asset id, so batch order is not box order.
    // Rebuild the correspondence the way the renderer's own grouping
    // does — first-occurrence order of the ids — rather than assuming it.
    const byId = new Map<string, PlacedBox[]>();
    for (const b of dressing.boxes) {
      const id = boxAssetId(b);
      const list = byId.get(id);
      if (list) list.push(b);
      else byId.set(id, [b]);
    }

    let checked = 0;
    let worst = 0;
    let worstShear = 0;
    for (const batch of batches) {
      const boxes = byId.get(batch.assetId);
      expect(boxes, `batch "${batch.assetId}" matches no box`).toBeDefined();
      expect(batch.count).toBe(boxes?.length);
      for (let i = 0; i < batch.count; i++) {
        const box = (boxes as PlacedBox[])[i];
        const legacy = legacyMatrix(box);
        const want = withoutShear(legacy).elements;
        for (let e = 0; e < 16; e++) {
          const got = batch.transforms[i * 16 + e];
          worst = Math.max(worst, Math.abs(got - want[e]));
          worstShear = Math.max(worstShear, Math.abs(legacy.elements[e] - want[e]));
          expect(
            Math.abs(got - want[e]),
            `batch "${batch.assetId}" instance ${i} element ${e}: ${got} vs ${want[e]}`,
          ).toBeLessThan(MATRIX_TOL);
        }
        checked++;
      }
    }
    expect(checked).toBe(dressing.boxes.length);
    // Both reported, because they answer different questions: the first
    // is "did the spawner reproduce the transform", the second is "how
    // much did dropping the shear actually move anything".
    console.log(
      `spawn seam: ${checked} instances, worst element delta ${worst.toExponential(2)}, ` +
        `worst shear dropped ${worstShear.toExponential(2)} world units`,
    );
  });

  it("pins the frame skew the shear comes from", async () => {
    const { dressing } = await dressOnce();
    let skew = 0;
    let unitErr = 0;
    for (const b of dressing.boxes) {
      const { across, along, up } = b.basis;
      skew = Math.max(
        skew,
        Math.abs(dot3(across, along)),
        Math.abs(dot3(across, up)),
        Math.abs(dot3(along, up)),
      );
      unitErr = Math.max(
        unitErr,
        Math.abs(Math.hypot(...across) - 1),
        Math.abs(Math.hypot(...along) - 1),
        Math.abs(Math.hypot(...up) - 1),
      );
    }
    // Each axis is renormalised on its own, so unit length is exact...
    expect(unitErr).toBeLessThan(1e-12);
    // ...and mutual orthogonality is not, which is the whole finding.
    expect(skew).toBeGreaterThan(0);
    expect(skew).toBeLessThan(MAX_FRAME_SKEW);
    console.log(`track frame: max |axis·axis| = ${skew.toExponential(3)}`);
  });

  it("emits an asset id the asset map can answer for, whatever the kit says", async () => {
    const { dressing } = await dressOnce();
    const assets = makeAssetMap(LOOK, "generated");
    const seen = new Set<string>();
    for (const b of dressing.boxes) seen.add(boxAssetId(b));
    expect(seen.size).toBeGreaterThan(0);
    for (const id of seen) {
      expect(assets[id], `no asset for id "${id}"`).toBeDefined();
    }
    // And the map answers for every id the function can produce, not just
    // the ones this lap happened to use — a different kit uses others.
    for (const id of boxAssetIds()) expect(assets[id]).toBeDefined();
  });

  it("folds an unrecognised role into the default rather than minting an id", () => {
    const box = {
      centre: [0, 0, 0],
      size: [1, 1, 1],
      basis: { across: [1, 0, 0], along: [0, 1, 0], up: [0, 0, 1] },
      role: "not-a-role-any-kit-declares",
      thickness: 0,
    } as unknown as PlacedBox;
    expect(boxAssetId(box)).toBe(DEFAULT_ASSET);
    expect(boxAssetId({ ...box, cover: true } as PlacedBox)).toBe(`cover:${DEFAULT_ASSET}`);
  });

  it("keeps cover in its own vocabulary", () => {
    const base = {
      centre: [0, 0, 0],
      size: [1, 1, 1],
      basis: { across: [1, 0, 0], along: [0, 1, 0], up: [0, 0, 1] },
      role: "span",
      thickness: 0,
    } as unknown as PlacedBox;
    expect(boxAssetId(base)).toBe("span");
    expect(boxAssetId({ ...base, cover: true } as PlacedBox)).toBe("cover:span");
  });

  it("gives the placement cloud one point per placement, named by kit asset id", async () => {
    const { lap, dressing } = await dressOnce();
    const cloud = placementCloud(dressing.placements, lap);
    expect(cloud.pointCount).toBe(dressing.placements.length);

    const asset = cloud.attrs.point.require(ASSET_ATTR);
    const ids = new Set<string>();
    for (let i = 0; i < cloud.pointCount; i++) ids.add(asset.getString(i));
    const known = new Set(dressing.placements.map((p) => placementAssetId(p.asset.id)));
    for (const id of ids) expect(known.has(id)).toBe(true);

    // The placement's P must be the frame at its own track coordinate —
    // not the centroid of the boxes it expands into, which is what a
    // renderer would reach for and which drifts with the decomposition.
    const frameAt = frameLookup(lap);
    const P = cloud.attrs.point.require("P");
    for (let i = 0; i < Math.min(32, cloud.pointCount); i++) {
      const p = dressing.placements[i];
      const f = frameAt(p.station, p.t, p.h);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(P.get(i, c) - f.p[c])).toBeLessThan(MATRIX_TOL);
      }
    }
  });

  it("leaves placement scale at 1, because a real prop carries its own size", async () => {
    const { lap, dressing } = await dressOnce();
    const cloud = placementCloud(dressing.placements, lap);
    const scale = cloud.attrs.point.require("scale");
    for (let i = 0; i < cloud.pointCount; i++) {
      for (let c = 0; c < 3; c++) expect(scale.get(i, c)).toBe(1);
    }
  });
});
