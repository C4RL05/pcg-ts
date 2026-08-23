/**
 * The dressing, as point clouds the library's spawner can turn into
 * instances.
 *
 * WHY THIS EXISTS. Until now the page walked `PlacedBox[]` itself and
 * stuffed a `THREE.InstancedMesh` by hand. That works and it is a dead
 * end: there is no place for real art to attach, because nothing in the
 * pipeline ever names an ASSET. Here the dressing becomes what every
 * other pcg-ts spawn is — a point cloud carrying the standard transform
 * attributes plus an `asset` id — and the renderer resolves those ids
 * against an `AssetMap`. Swapping a unit cube for a real mesh is then a
 * change to the asset map and to nothing else.
 *
 * TWO CLOUDS, BECAUSE THERE ARE TWO GRANULARITIES and the demo needs
 * both. A placement is ONE object — a gantry, a grandstand — and that is
 * what a game's art binds to. But the measured kit describes each of
 * those as a handful of boxes, and the boxes are what this page has ever
 * been able to draw. So:
 *
 *   - {@link boxCloud} is one point per BOX. It draws today's picture,
 *     and it will keep drawing it for as long as the boxes are the art.
 *   - {@link placementCloud} is one point per PLACEMENT. It draws nothing
 *     yet, because no asset map has entries for it. It is the seam.
 *
 * They are not alternatives and neither replaces the other: the first is
 * a decomposition of the second, and a page that wants to see whether the
 * decomposition is faithful needs to be able to draw both.
 *
 * NO THREE IMPORT FOR THE CLOUDS THEMSELVES beyond the quaternion, and
 * that one is deliberate — see {@link basisToQuat}.
 */
import { createPointCloud, type Geometry } from "pcg-ts";
import { Matrix4, Quaternion, Vector3 } from "three";
import { frameLookup } from "./dress.js";
import type { PlacedBox } from "./kit.js";
import type { Lap } from "./lap.js";
import type { StationedPlacement } from "./legibility.js";

/** The point attribute every spawn in this demo reads its asset id from. */
export const ASSET_ATTR = "asset";

/**
 * The asset id every point falls back to.
 *
 * `PlacedBox.role` is INFERRED rather than measured (`kit.ts`), so a box
 * whose role could not be worked out arrives as `"mass"` already. Naming
 * the same value here means the fallback and the common case are one
 * entry in the asset map rather than two that must agree.
 */
export const DEFAULT_ASSET = "mass";

/**
 * The roles a box can carry, and therefore the ids an asset map must
 * answer for.
 *
 * A CLOSED SET, DELIBERATELY. `PlacedBox.role` comes from the kit file,
 * which is external measured data this repository does not contain and
 * cannot constrain — so a kit carrying a role nobody anticipated would
 * otherwise reach `toInstancedMeshes` as an unknown asset id and throw,
 * taking the page down over a label. {@link boxAssetId} folds anything
 * unrecognised into `mass`, which is already the value `kit.ts` uses when
 * it cannot infer a role at all. The map stays finite and the failure
 * mode is a box drawn as a plain mass rather than a blank screen.
 */
export const BOX_ROLES = ["panel", "leg", "post", "span", "head", "mass"] as const;

const KNOWN_ROLES: ReadonlySet<string> = new Set(BOX_ROLES);

/**
 * The asset id of one box.
 *
 * COVER IS ITS OWN VOCABULARY, not a flag on the scenery's. A tunnel rib
 * and a verge post can be the same measured box and are not the same
 * thing to look at: one is structure over the racing line, the other is
 * something standing beside it. `legibility.ts` makes exactly this
 * argument for marking cover rather than inferring it, and the id has to
 * carry the distinction or the asset map cannot act on it.
 */
export function boxAssetId(box: PlacedBox): string {
  const role = KNOWN_ROLES.has(box.role) ? box.role : DEFAULT_ASSET;
  return box.cover === true ? `cover:${role}` : role;
}

/** Every id {@link boxAssetId} can return, which is what an asset map owes. */
export function boxAssetIds(): string[] {
  return [...BOX_ROLES, ...BOX_ROLES.map((r) => `cover:${r}`)];
}

/**
 * The asset id of one placement.
 *
 * PREFIXED, BECAUSE THE KIT'S IDS ARE BARE INTEGERS. An asset id is a
 * string an asset map is keyed by, and `"42"` says nothing about where it
 * came from or what would answer for it — while `"kit:42"` says it is the
 * forty-second asset of the measured kit, which is exactly the fact a
 * person binding a mesh to it needs. It also keeps the placement ids in a
 * different namespace from the box roles, so the two maps can never
 * silently answer each other's questions.
 */
export function placementAssetId(id: number): string {
  return `kit:${id}`;
}

/**
 * A quaternion from the track frame's three axes.
 *
 * THROUGH THREE'S OWN CONSTRUCTION, ON PURPOSE. The library has this as
 * `quatFromBasis` (`src/nodes/util.ts`), written to mirror three's trace
 * branches for exactly this reason — but it is not exported from
 * `pcg-ts`, and exporting it is a public-API decision this page has no
 * business forcing. Nor will it need one: the moment the frame is
 * written by the graph, `orientAlongVector` sets `rot` from a direction
 * and an up hint and no basis conversion happens on this side at all.
 *
 * The axes are the matrix's COLUMNS — across, along, up, in that order —
 * which is what `makeBasis` takes and what the hand-written renderer this
 * replaces built with `Matrix4.set`. Getting the order wrong yaws every
 * prop by ninety degrees, which is visible immediately and is why there
 * is a test pinning it against the old path rather than a comment
 * claiming it.
 */
function basisToQuat(
  out: Quaternion,
  across: readonly [number, number, number],
  along: readonly [number, number, number],
  up: readonly [number, number, number],
): Quaternion {
  BASIS.makeBasis(
    AX.set(across[0], across[1], across[2]),
    AY.set(along[0], along[1], along[2]),
    AZ.set(up[0], up[1], up[2]),
  );
  return out.setFromRotationMatrix(BASIS);
}

// Scratch, because this runs once per box and a lap carries thousands.
const BASIS = new Matrix4();
const AX = new Vector3();
const AY = new Vector3();
const AZ = new Vector3();
const Q = new Quaternion();

/**
 * One point per placed box.
 *
 * `P` is the box's world centre, `scale` its world extents along the
 * frame's three axes, and `rot` the frame itself. That triple composes to
 * `T(P) * R(rot) * S(scale)` at the spawner, which is the same matrix the
 * hand-written renderer built — see `tests/racetrackSpawn.test.ts`, which
 * checks it rather than asserting it here.
 *
 * THE UNIT THE SCALE IS IN. `PlacedBox.size` is the box's FULL extent in
 * world units, and the asset it scales is a unit cube, so the two match
 * with no factor of two anywhere. That stops being true the moment a real
 * mesh takes the cube's place — a prop carries its own size, and `scale`
 * then has to mean "fit this asset to that box" rather than "this box's
 * extents". Noted here because it is the one thing about this file that
 * changes when the art arrives.
 */
export function boxCloud(boxes: readonly PlacedBox[]): Geometry {
  const geo = createPointCloud(boxes.length);
  const points = geo.attrs.point;
  const P = points.require("P");
  const rot = points.require("rot");
  const scale = points.require("scale");
  const asset = points.add(ASSET_ATTR, "string", 1);

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    P.setTuple(i, b.centre);
    scale.setTuple(i, b.size);
    basisToQuat(Q, b.basis.across, b.basis.along, b.basis.up);
    rot.setTuple(i, [Q.x, Q.y, Q.z, Q.w]);
    asset.setString(i, boxAssetId(b));
  }
  return geo;
}

/**
 * One point per placement — the seam real art binds to.
 *
 * ONE OBJECT, NOT ITS BOXES. `asset` is the kit's own asset id, `P` and
 * `rot` are the track frame at the placement's own (station, t, h), and
 * `scale` is left at 1 because a real prop carries its own size and being
 * scaled to a measured bounding box is precisely what would make it
 * wrong.
 *
 * IT DRAWS NOTHING TODAY, and that is not a defect. The asset map has no
 * entry for any kit asset id, because the assets do not exist yet. What
 * this cloud does is make the population addressable BEFORE they do, so
 * that binding them later is an asset-map change rather than a rewrite of
 * everything upstream of the renderer.
 */
export function placementCloud(
  placements: readonly StationedPlacement[],
  lap: Lap,
): Geometry {
  const geo = createPointCloud(placements.length);
  const points = geo.attrs.point;
  const P = points.require("P");
  const rot = points.require("rot");
  const asset = points.add(ASSET_ATTR, "string", 1);
  const frameAt = frameLookup(lap);

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const f = frameAt(p.station, p.t, p.h);
    P.setTuple(i, f.p);
    basisToQuat(Q, f.across, f.dir, f.up);
    rot.setTuple(i, [Q.x, Q.y, Q.z, Q.w]);
    asset.setString(i, placementAssetId(p.asset.id));
  }
  return geo;
}
