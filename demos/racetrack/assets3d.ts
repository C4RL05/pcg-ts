/**
 * What each asset id draws — the socket the real art plugs into.
 *
 * TODAY EVERY ID IS THE SAME UNIT CUBE, and that is the point rather than
 * a shortcut. The output of this technique is a COMPOSITION — what is
 * where, at what size, facing which way — and a wireframe box reads as
 * the measurement it is, where a shaded prop would read as bad art (see
 * `main.ts`' header, which has argued this since before the rules
 * landed). So the map exists not to make the picture different but to
 * make the picture ADDRESSABLE: `panel` and `cover:span` are separate
 * entries drawing identical geometry, and giving one of them a real mesh
 * is an edit to this file and to nothing else.
 *
 * ONE GEOMETRY, MANY ENTRIES. The cube is shared by reference across
 * every id and across both palettes, so a lap of thousands of boxes
 * uploads one vertex buffer. `toInstancedMeshes` clones each mesh's
 * MATERIAL — which is how three releases that mesh's cached render state
 * on dispose — but never its geometry, so ownership is: dispose the mesh
 * and its material together, dispose the geometry with the map.
 *
 * TWO PALETTES, NOT TWO GEOMETRIES. The generated dressing and the
 * measured reference must be told apart at a glance and must otherwise be
 * drawn by exactly the same renderer, because the whole question this page
 * asks is whether the generated one reads like the measured one. A
 * different colour is the smallest difference that answers "which am I
 * looking at"; a different mesh would be a different picture and would
 * make the comparison worthless.
 */
import type { AssetMap } from "pcg-ts/three";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Material,
  MeshBasicMaterial,
} from "three";
import { type PoseBoxW, type PoseLibrary, poseAssetId, poseBoxesW } from "./dressGraph.js";
import { boxAssetIds } from "./spawn.js";

/**
 * The unit box every placed box is scaled from.
 *
 * Module-level and shared, exactly as the renderer this replaces kept it:
 * a recook replaces every mesh, and re-uploading a buffer that never
 * changes was measurable enough that the old dispose path special-cased
 * it by name. Here the sharing is structural instead — the asset map owns
 * it, meshes only borrow it — so there is nothing for a dispose loop to
 * get wrong.
 */
const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** How the two populations are told apart. Colour only; see the header. */
export const PALETTE = {
  /** The generated dressing — the thing this page is about. */
  generated: { color: 0x404040, opacity: 0.95 },
  /** The measured kit, drawn beside it as a reference and not a target. */
  reference: { color: 0x999999, opacity: 0.85 },
} as const;

export type Population = keyof typeof PALETTE;

/**
 * An asset map for one population.
 *
 * ITS MATERIALS ARE TEMPLATES AND NOTHING ELSE. `toInstancedMeshes`
 * clones each asset's material per mesh — that clone is what renders, and
 * its `dispose()` is the one signal three uses to release that mesh's
 * cached render state — so the originals here are never uploaded and are
 * dead the moment the meshes exist. The caller disposes this map
 * immediately after building from it (see {@link disposeAssetMap}, which
 * is inert bookkeeping rather than GPU work), and from then on every live
 * material is owned by exactly one mesh. That single-ownership rule is
 * what makes the page's dispose loop correct without a special case.
 */
export function makeAssetMap(population: Population): AssetMap {
  const { color, opacity } = PALETTE[population];
  const map: Record<string, { geometry: BoxGeometry; material: MeshBasicMaterial }> = {};
  for (const id of boxAssetIds()) {
    map[id] = {
      geometry: UNIT_BOX,
      material: new MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity,
      }),
    };
  }
  return map;
}

/**
 * Release a map's template materials.
 *
 * NOT ITS GEOMETRY. Every entry points at the one shared {@link UNIT_BOX},
 * so disposing "the geometry of everything in the map" would throw the
 * same buffer away once per id and force a re-upload — the precise bug the
 * hand-written renderer carried a named special case to avoid. The cube
 * outlives every cook and is never disposed; the process ending is what
 * releases it.
 */
export function disposeAssetMap(map: AssetMap): void {
  for (const id of Object.keys(map)) {
    const m = map[id].material;
    for (const one of Array.isArray(m) ? m : [m]) one.dispose();
  }
}

/**
 * The MAP pass's material for each asset id.
 *
 * A PLAIN RECORD RATHER THAN A SECOND ASSET MAP, because nothing spawns
 * from it. The page draws two views over each other and swaps each mesh
 * between a PAIR of pre-built materials rather than re-colouring one
 * twice a frame, so the swap costs a pointer; the second half of that
 * pair is looked up by `mesh.name`, which `toInstancedMeshes` sets to the
 * batch's asset id. Exactly one mesh exists per id per population, so
 * each material here ends up owned by exactly one layer and is disposed
 * with it.
 *
 * TAKES THE IDS THAT ACTUALLY SPAWNED, not every id an asset map owes an
 * answer for. A lap uses a handful of the twelve, and minting the rest
 * would leave materials that no mesh ever claims and no dispose loop ever
 * reaches — a small leak, but one that grows once per recook and is
 * exactly the class of bug the old renderer's comment records having been
 * caught by.
 *
 * The map pass drops transparency: from above, a lap of overlapping
 * translucent boxes reads as a smear of density rather than as a layout,
 * and the layout is the only thing the map view is for.
 */
export function makeMapMaterials(
  population: Population,
  ids: readonly string[],
): Record<string, MeshBasicMaterial> {
  const { color } = PALETTE[population];
  const out: Record<string, MeshBasicMaterial> = {};
  for (const id of ids) {
    out[id] = new MeshBasicMaterial({ color, wireframe: true });
  }
  return out;
}

/**
 * ONE map-pass material for a whole STREAMED population.
 *
 * THE COUNTERPART TO {@link makeMapMaterials}, and the difference is how
 * many names the population has. That function mints one material per
 * asset id because a lap uses a handful of the twelve box ids and each
 * ends up owned by exactly one mesh. A pose library has hundreds of ids,
 * they arrive and leave with the sectors rather than with the cook, and
 * the map pass is a flat overhead view that wants one flat colour — so a
 * per-id table there would be hundreds of materials, all the same colour,
 * minted and freed on a schedule nothing needs to track.
 *
 * ONE MATERIAL IS SAFE HERE FOR THE REASON THE PER-ID TABLE IS NOT: it is
 * BORROWED rather than owned. The streamed meshes belong to the world
 * binding, which disposes each mesh's own material with it; this one is
 * lent to them for the length of the map pass and handed back, and the
 * page disposes it with the world that built it.
 */
export function makeStreamedMapMaterial(population: Population): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: PALETTE[population].color, wireframe: true });
}

// ------------------------------------------------------------------ //
// One instance per PLACEMENT: a pose drawn as a single merged mesh.
// ------------------------------------------------------------------ //

/**
 * NOTHING ABOUT A POSE IS DECIDED HERE, and that is the whole arrangement.
 *
 * `dressGraph.ts` owns the pose library, the corners-to-centre-and-extent
 * conversion ({@link poseBoxesW}) and the id a placement is keyed by
 * ({@link poseAssetId}), because it is the file the RULES read, and the
 * page's only claim is that the mesh drawn here is the boxes those rules
 * measured. Each of those three was written out a second time in this file
 * once. None of them was wrong; all three were a copy that agrees until
 * one side is edited, and the failure mode is silent — a lap that is nearly
 * the lap beside it. Importing them makes the two paths the same arithmetic
 * rather than two readings of it, and leaves this file with the one job it
 * should have: turning numbers into vertices.
 *
 * It costs an import from a module that never touches three, which is the
 * direction that was always safe: `dressGraph.ts` is cooked headlessly in
 * the tests and must not gain a renderer dependency, and this direction
 * cannot give it one.
 */

/** {@link UNIT_BOX}'s six faces, read once as plain arrays. */
interface UnitFaces {
  /** 3 floats per vertex, the cube's corners at ±0.5. */
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Triangle indices into those vertices. */
  readonly index: Uint16Array;
  readonly vertexCount: number;
}

/**
 * The cube's faces, pulled out of the shared geometry rather than typed in.
 *
 * DERIVED, SO THE TWO PATHS DRAW THE SAME CUBE. A merged pose is stamped
 * from this and a single box is drawn from {@link UNIT_BOX} itself, and
 * the page's whole claim is that the coarse path draws what the fine one
 * drew. A hand-written vertex table would be a second cube that agrees
 * until three changes its own — and it is not only the corners that would
 * have to agree: `wireframe` derives its edges from the INDEX, so a
 * different triangulation of the same corners is a visibly different box.
 *
 * Read through `getX`/`getY`/`getZ` because that is the accessor both an
 * interleaved and a plain attribute answer, and the sequential fallback
 * covers a cube that arrives without an index. Neither costs anything: it
 * runs once, over 24 vertices, at module load.
 */
function readUnitFaces(): UnitFaces {
  const position = UNIT_BOX.getAttribute("position");
  const normal = UNIT_BOX.getAttribute("normal");
  const index = UNIT_BOX.getIndex();
  const vertexCount = position.count;
  const pos = new Float32Array(vertexCount * 3);
  const nrm = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    pos[i * 3] = position.getX(i);
    pos[i * 3 + 1] = position.getY(i);
    pos[i * 3 + 2] = position.getZ(i);
    nrm[i * 3] = normal.getX(i);
    nrm[i * 3 + 1] = normal.getY(i);
    nrm[i * 3 + 2] = normal.getZ(i);
  }
  const idx = new Uint16Array(index === null ? vertexCount : index.count);
  for (let i = 0; i < idx.length; i++) idx[i] = index === null ? i : index.getX(i);
  return { position: pos, normal: nrm, index: idx, vertexCount };
}

const UNIT_FACES = readUnitFaces();

/**
 * One pose's boxes as a single geometry, in the library's own units.
 *
 * TAKES CENTRES AND EXTENTS, NOT CORNERS, so the arithmetic that produced
 * them is `poseBoxesW`'s and the fine path's per-box points are stamped
 * from the same values. Half-widths throughout: the track's scale arrives
 * on the INSTANCE transform, so one merged pose dresses a lap of any width.
 *
 * Normals are copied unchanged rather than transformed. A box's normals
 * only ever point down an axis and every extent is floored strictly above
 * zero, so a positive per-axis scale leaves them axis-aligned and unit —
 * the inverse-transpose a general mesh would need has nothing to do here.
 * The wireframe material never reads them; carrying them means giving a
 * pose a shaded material is an edit to the material and nothing else,
 * which is the same promise this file's header makes about the cube.
 */
function mergePose(boxes: readonly PoseBoxW[]): BufferGeometry {
  const perBox = UNIT_FACES.vertexCount;
  const perBoxIndices = UNIT_FACES.index.length;
  const position = new Float32Array(boxes.length * perBox * 3);
  const normal = new Float32Array(boxes.length * perBox * 3);
  // A pose of more than ~2730 boxes overflows a 16-bit index. The shipped
  // vocabulary is nowhere near that, and picking the width from the count
  // costs one comparison against a whole class of silently wrapped
  // geometry on a kit nobody has measured yet.
  const vertices = boxes.length * perBox;
  const index =
    vertices > 65535
      ? new Uint32Array(boxes.length * perBoxIndices)
      : new Uint16Array(boxes.length * perBoxIndices);

  let base = 0;
  let at = 0;
  for (const b of boxes) {
    const [cx, cy, cz] = b.centre;
    const [sx, sy, sz] = b.extent;
    for (let i = 0; i < perBox; i++) {
      const from = i * 3;
      const to = (base + i) * 3;
      position[to] = UNIT_FACES.position[from] * sx + cx;
      position[to + 1] = UNIT_FACES.position[from + 1] * sy + cy;
      position[to + 2] = UNIT_FACES.position[from + 2] * sz + cz;
      normal[to] = UNIT_FACES.normal[from];
      normal[to + 1] = UNIT_FACES.normal[from + 1];
      normal[to + 2] = UNIT_FACES.normal[from + 2];
    }
    for (let i = 0; i < perBoxIndices; i++) index[at + i] = base + UNIT_FACES.index[i];
    base += perBox;
    at += perBoxIndices;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(position, 3));
  geo.setAttribute("normal", new BufferAttribute(normal, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  // Frustum culling reads it, and a merged pose is not a unit cube any
  // more: its radius is the pose's own reach, which is the number the
  // renderer has no other way to know.
  geo.computeBoundingSphere();
  return geo;
}

/**
 * An asset map keyed by POSE, for the one-instance-per-placement path.
 *
 * THE COARSE PATH, AND IT IS A DIFFERENT PICTURE OF THE SAME NUMBERS. The
 * box map draws one instance per box and can colour a rib differently from
 * a post; this draws one per PLACEMENT, so a lap costs instances in the
 * hundreds rather than the thousands and the smallest thing addressable is
 * the pose. Both are wanted — the fine one to ask what a box is, the
 * coarse one to ask what the lap looks like — and neither replaces the
 * other, which is why this is an addition and not a rewrite.
 *
 * ONE GEOMETRY PER POSE, TWO ENTRIES. `cover:pose:17` and `pose:17` draw
 * the same merged boxes and share the geometry BY REFERENCE, exactly as
 * the twelve box ids share the cube: the ids exist so the two can be told
 * apart and given different art later, not because they are different art
 * today. The materials follow {@link makeAssetMap} — one per id,
 * templates that `toInstancedMeshes` clones per mesh and that are dead the
 * moment the meshes exist.
 *
 * EVERY POSE IN THE LIBRARY GETS AN ENTRY, including one whose box set is
 * empty. An empty pose draws nothing, which is what the fine path does
 * with it too; leaving the id out instead would make the same lap throw
 * `unknown assetId` out of `toInstancedMeshes` the first time a placement
 * selected it.
 */
export function makePoseAssetMap(
  lib: PoseLibrary,
  halfWidth: number,
  population: Population,
): AssetMap {
  const { color, opacity } = PALETTE[population];
  const posed = poseBoxesW(lib, halfWidth);
  const map: Record<string, { geometry: BufferGeometry; material: MeshBasicMaterial }> = {};
  for (let pose = 0; pose < posed.length; pose++) {
    const geometry = mergePose(posed[pose]);
    for (const cover of [false, true]) {
      map[poseAssetId(pose, cover)] = {
        geometry,
        material: new MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity,
        }),
      };
    }
  }
  return map;
}

/**
 * Release a pose map's geometry AND its materials.
 *
 * THE OPPOSITE OF {@link disposeAssetMap}, and the difference is
 * ownership rather than taste. That map's entries all point at the one
 * module-level cube, which outlives every cook and belongs to nobody; the
 * geometries here were merged for this map alone, so nothing else can free
 * them and leaving them is a leak that grows by a whole vocabulary per
 * recook.
 *
 * WHICH MEANS THE CALL SITE IS DIFFERENT TOO. `disposeAssetMap` is called
 * the moment the meshes are built, because by then only the dead template
 * materials are left. This map's geometry is the geometry those meshes
 * DRAW — `toInstancedMeshes` hands it to them BY REFERENCE (these poses
 * carry no named per-instance channels, which is the one thing that would
 * make it clone instead) — so this waits until the meshes are gone.
 *
 * AND IT WOULD STILL WAIT IF THAT CHANGED. A channelled batch gets a
 * geometry CLONE of its own, flagged `ownsGeometry` and disposed with the
 * mesh; the map's original is not that clone and is still nobody else's
 * to free. Either way the rule from `src/three/instanced.ts` is the one
 * that decides here: an asset map's geometry is disposed WITH THE MAP,
 * never per mesh.
 *
 * A SET BECAUSE THE ENTRIES OVERLAP. Two ids answer with the same merged
 * geometry, so a loop over the keys would dispose each one twice: the
 * second call re-fires three's `dispose` event on a buffer that has
 * already been released, which is the same double-free the box map's
 * comment records the hand-written renderer carrying a named special case
 * to avoid. Collecting distinct objects first says it once, and says it
 * for the materials on the same pass so a later decision to share those
 * too cannot reintroduce the bug.
 */
export function disposePoseAssetMap(map: AssetMap): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  for (const id of Object.keys(map)) {
    geometries.add(map[id].geometry);
    const m = map[id].material;
    for (const one of Array.isArray(m) ? m : [m]) materials.add(one);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
