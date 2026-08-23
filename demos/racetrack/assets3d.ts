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
import { BoxGeometry, MeshBasicMaterial } from "three";
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
