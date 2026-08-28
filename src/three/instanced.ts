/**
 * Instance batches → THREE.InstancedMesh. The renderer-side half of the
 * core spawner protocol.
 */
import {
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type Mesh,
} from "three";
import type { AttrData } from "../data/index.js";
import { INSTANCE_COLOR_CHANNEL, instanceAttributesOf, type InstanceBatch } from "../graph/data.js";
import { attempt, type TeardownFailure } from "./teardown.js";

/** One renderable asset shared by every instance of an asset id. */
export interface InstancedAsset {
  readonly geometry: BufferGeometry;
  readonly material: Material | Material[];
}

/** Asset id → renderable, the lookup instance batches resolve against. */
export type AssetMap = Record<string, InstancedAsset>;

/**
 * Clone an asset's material slot for one mesh.
 *
 * Every mesh gets its OWN material instance on purpose, and the reason is
 * three's renderer bookkeeping, not appearance: `WebGPURenderer` keys an
 * instanced mesh's render state (its `RenderObject`, built shaders,
 * pipeline and uniform buffers) per mesh — `RenderObject.
 * getMaterialCacheKey()` appends `object.uuid` for instanced meshes — and
 * releases ALL of it through exactly one signal, the `dispose` event of
 * the material that mesh rendered with. A shared asset material never
 * fires that event mid-session, so in a streaming world every evicted
 * mesh's render state would stay cached forever (measured: three's
 * program count climbing ~15 per cooked cell and never returning).
 * A per-mesh clone gives each mesh a material whose `dispose()` releases
 * precisely that mesh's render state and nobody else's. The clone is
 * shallow where it matters: textures and node graphs are shared by
 * reference, so no GPU resource is duplicated.
 *
 * `renderStateRelease.test.ts` pins the three internals this leans on.
 */
export function cloneAssetMaterial(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material) ? material.map((m) => m.clone()) : material.clone();
}

/** A mesh's material slot as a list, whichever shape it has. */
export function materialListOf(material: Material | Material[]): readonly Material[] {
  return Array.isArray(material) ? material : [material];
}

/**
 * `userData` flag marking a mesh whose geometry is a PER-BATCH CLONE it
 * owns, not the asset map's shared geometry.
 *
 * A flag rather than an identity comparison against the asset map,
 * because the code that disposes a mesh is often not the code that built
 * it and may not hold the map any more (`WorldThreeBinding` tears a cell
 * down long after the build).
 */
const OWNED_GEOMETRY_FLAG = "pcgOwnsGeometry";

/**
 * Does this mesh own its geometry, so that disposing the mesh must
 * dispose the geometry too?
 *
 * FALSE for the ordinary mesh, which draws the asset map's shared
 * geometry by reference — disposing that would break every other mesh
 * using the same asset, and it belongs to the caller's asset map. TRUE
 * exactly for a mesh built from a batch carrying NAMED per-instance
 * channels: those become `InstancedBufferAttribute`s on the GEOMETRY, so
 * the mesh cannot share one (see {@link toInstancedMeshes}' ownership
 * notes) and gets a clone that lives and dies with it.
 *
 * Read it on every teardown path. A silent per-batch clone that nothing
 * disposes is how a leak shows up six months out, in a streaming world,
 * as memory that only ever climbs.
 */
export function ownsGeometry(mesh: Mesh): boolean {
  return mesh.userData[OWNED_GEOMETRY_FLAG] === true;
}

/**
 * Geometry attribute names three (or a standard material) already means
 * something by. A channel of one of these names would overwrite the
 * asset's own vertex data — `position` most destructively — and the mesh
 * would draw nothing or draw garbage, with no error anywhere.
 *
 * `color` is not here because it never reaches this check: it is the
 * reserved instance-colour channel, handled before the loop.
 *
 * An ARRAY and not a `Set`, deliberately: `new Set([...])` is a call at
 * module scope, which makes this module impure and would force
 * `dist/three/index.js` into package.json's `sideEffects` — the one entry
 * deliberately omitted, so that a WebGL app importing `pcg-ts/three` can
 * tree-shake what it does not use. `tests/packaging.test.ts` enforces it.
 * Eleven entries scanned once per channel per batch costs nothing a Set
 * would save.
 */
const RESERVED_GEOMETRY_ATTRS: readonly string[] = [
  "position",
  "normal",
  "tangent",
  "uv",
  "uv1",
  "uv2",
  "uv3",
  "skinIndex",
  "skinWeight",
  "instanceMatrix",
  "instanceColor",
];

/** Largest itemSize a vertex attribute can carry on either three backend. */
const MAX_CHANNEL_ITEM_SIZE = 4;

/**
 * Create one `THREE.InstancedMesh` per batch, resolving each batch's
 * `assetId` in `assets` (unknown ids throw, listing the known ids).
 * Batch transforms are already in `Matrix4.elements` layout, so they are
 * copied straight into `instanceMatrix`. Each mesh is named after its
 * asset id and gets its bounding sphere computed over the instances so
 * frustum culling is correct.
 *
 * The batch's per-instance channels are read through
 * `instanceAttributesOf` — one record, colour included — and land in two
 * places, because three binds instance colour structurally and everything
 * else generically:
 *
 * - The reserved `color` channel becomes `mesh.instanceColor`, which
 *   three multiplies into the material's own colour with no material
 *   change needed (`instanceColor !== null` is what defines
 *   `USE_INSTANCING_COLOR` for the program). A batch WITHOUT colour
 *   leaves `instanceColor` at `null`, so a spawn that never asked for
 *   colour draws through exactly the shader variant it always did.
 * - Every OTHER channel becomes an `InstancedBufferAttribute` of its own
 *   name on the geometry, with the batch column's dtype and its item size
 *   (`column.length / count`) intact — so a `u32` id arrives as a `uint`
 *   in the shader rather than as an f32 that lost its low bits. A
 *   material has to declare it to use it (an `onBeforeCompile` patch, a
 *   `ShaderMaterial`, or a TSL `attribute()` node); nothing here writes
 *   the shader, because the whole point of the channel is that the HOST
 *   decides what the data drives.
 *
 * Ownership, in three parts:
 *
 * - Each mesh's MATERIAL is a per-mesh clone of the asset's (see
 *   {@link cloneAssetMaterial} for why: it is the one lever that lets
 *   three's renderer release the mesh's cached render state).
 * - **A batch carrying NAMED channels also gets its own GEOMETRY clone,
 *   and that clone is disposed with the mesh.** An
 *   `InstancedBufferAttribute` lives on the geometry, so a mesh that sets
 *   one cannot share the asset's — it would publish this batch's ids to
 *   every other mesh drawing the same asset, and the last cook would win.
 *   The clone is shallow where it matters: three's `BufferGeometry.clone`
 *   copies attribute ARRAYS but not GPU buffers, and index/groups/bounds
 *   come along. {@link ownsGeometry} is how a teardown path tells the two
 *   apart, and the flag is set on the mesh rather than inferred, because
 *   whoever disposes a mesh usually no longer holds the asset map.
 * - The asset GEOMETRY of an unchannelled batch (and any textures the
 *   material references) stays shared by reference — dispose those with
 *   the asset map, never per mesh. Instance COLOUR alone does not force a
 *   clone: `instanceColor` is a property of the MESH, not the geometry,
 *   so a coloured spawn shares geometry exactly as it always has.
 *
 * Dispose a mesh with all three parts:
 *
 * ```ts
 * mesh.dispose(); // per-mesh GPU state (the instance-matrix buffer)
 * for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
 * if (ownsGeometry(mesh)) mesh.geometry.dispose(); // ONLY the per-batch clone
 * ```
 *
 * `WorldThreeBinding` does exactly this on every release path. If a batch
 * mid-list fails validation, the materials and geometry clones already
 * minted for earlier batches are disposed before the error propagates, so
 * a throwing build mints nothing that outlives it.
 */
export function toInstancedMeshes(
  batches: readonly InstanceBatch[],
  assets: AssetMap,
): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  try {
    for (const batch of batches) {
      const asset = assets[batch.assetId];
      if (!asset) {
        const known = Object.keys(assets).sort().join(", ");
        throw new Error(
          `toInstancedMeshes: unknown assetId "${batch.assetId}"; known assets: ` +
            (known === "" ? "(none)" : known),
        );
      }
      if (batch.transforms.length !== batch.count * 16) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${batch.transforms.length} transform ` +
            `floats, expected count * 16 = ${batch.count * 16}`,
        );
      }
      // One record, colour included; a batch carrying only a legacy plain
      // `colors` is lifted into the reserved channel, so it takes this
      // exact path with nothing special-cased for it.
      const channels = instanceAttributesOf(batch);
      const colors = channels[INSTANCE_COLOR_CHANNEL];
      if (colors && colors.length !== batch.count * 3) {
        throw new Error(
          `toInstancedMeshes: batch "${batch.assetId}" has ${colors.length} colour ` +
            `floats, expected count * 3 = ${batch.count * 3} (rgb per instance; alpha is dropped ` +
            `at the spawner)`,
        );
      }
      // Every channel is validated BEFORE anything is minted, so a bad
      // one throws with no half-built mesh, geometry clone or material
      // clone behind it. Item size is derived, never carried — see
      // `InstanceAttributes`.
      const custom: { name: string; column: AttrData; itemSize: number }[] = [];
      for (const [name, column] of Object.entries(channels)) {
        if (name === INSTANCE_COLOR_CHANNEL) continue;
        if (RESERVED_GEOMETRY_ATTRS.includes(name)) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" carries a per-instance channel named ` +
              `"${name}", which is a geometry attribute three already means something by — ` +
              `setting it would overwrite the asset's own vertex data and the mesh would draw ` +
              `nothing or draw garbage, with no error. Rename the point attribute upstream ` +
              `(setAttribute) and name the new one in spawnInstances' instanceAttrs. Reserved: ` +
              `${[...RESERVED_GEOMETRY_ATTRS].sort().join(", ")}.`,
          );
        }
        if (batch.count === 0) {
          if (column.length !== 0) {
            throw new Error(
              `toInstancedMeshes: batch "${batch.assetId}" declares 0 instances but its ` +
                `"${name}" channel has ${column.length} elements. A channel is ` +
                `count * itemSize elements, and at count 0 the item size cannot be recovered ` +
                `(there is nothing to divide by), so a zero-instance batch's channels must be ` +
                `empty. Give the batch its real instance count, or drop the channel.`,
            );
          }
          // No instances means no recoverable item size (it is
          // `length / count`), and no attribute worth binding either.
          continue;
        }
        if (column.length % batch.count !== 0) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" channel "${name}" has ${column.length} ` +
              `elements, which is not a whole number per instance for ${batch.count} instances ` +
              `— a channel is count * itemSize elements and its item size is recovered as ` +
              `length / count`,
          );
        }
        const itemSize = column.length / batch.count;
        if (itemSize > MAX_CHANNEL_ITEM_SIZE) {
          throw new Error(
            `toInstancedMeshes: batch "${batch.assetId}" channel "${name}" is ${itemSize} ` +
              `components per instance; a vertex attribute carries at most ` +
              `${MAX_CHANNEL_ITEM_SIZE}. Split the point attribute into several narrower ones ` +
              `upstream and name each in instanceAttrs.`,
          );
        }
        custom.push({ name, column, itemSize });
      }
      // A channel is an attribute of the GEOMETRY, so a channelled batch
      // cannot share the asset's — see the ownership notes above. Colour
      // alone still shares: `instanceColor` hangs on the mesh.
      const owned = custom.length > 0;
      const geometry = owned ? asset.geometry.clone() : asset.geometry;
      const mesh = new InstancedMesh(geometry, cloneAssetMaterial(asset.material), batch.count);
      if (owned) mesh.userData[OWNED_GEOMETRY_FLAG] = true;
      // Listed the moment it owns anything, not once it is finished:
      // everything below can still throw (`colors.slice()` on a huge
      // batch, `computeBoundingSphere`), and the unwind below can only
      // dispose what this array holds. The ownership flag above is set
      // first for the same reason — it is what tells the unwind whether
      // the geometry is this mesh's clone or the asset map's.
      meshes.push(mesh);
      (mesh.instanceMatrix.array as Float32Array).set(batch.transforms);
      mesh.instanceMatrix.needsUpdate = true;
      if (colors) {
        // Copied, like the transforms: the batch belongs to a cached graph
        // item that may back several meshes, and three writes through
        // `setColorAt` into whatever array it is given.
        mesh.instanceColor = new InstancedBufferAttribute(colors.slice(), 3);
        mesh.instanceColor.needsUpdate = true;
      }
      for (const { name, column, itemSize } of custom) {
        // `.slice()` for the same reason the transforms are copied, and
        // the DTYPE IS PRESERVED by it: `slice` on a typed array returns
        // its own class, so a u32 id stays a Uint32Array and reaches the
        // shader as an integer instead of an f32 that lost its low bits.
        geometry.setAttribute(name, new InstancedBufferAttribute(column.slice(), itemSize));
      }
      mesh.name = batch.assetId;
      mesh.computeBoundingSphere();
    }
  } catch (err) {
    // A later batch's validation failure discards the earlier batches'
    // meshes — they are local to this call and the caller never sees
    // them, so their material clones (and geometry clones) must not
    // outlive it. None has been rendered yet, so disposal here is inert
    // bookkeeping, not GPU work.
    //
    // Guarded step by step (see ./teardown.ts) even though three's own
    // classes cannot throw here, and both halves of that are worth
    // stating. They cannot: `Material.dispose` and
    // `BufferGeometry.dispose` only dispatch a `dispose` event,
    // `InstancedMesh.dispose` dispatches and frees a `morphTexture` this
    // function never sets, and `dispatchEvent` returns immediately when
    // nothing is listening — which nothing is, since both renderers
    // attach their listeners only when the renderer first PROCESSES an
    // object (`WebGLObjects.update`, `getProgram`, the `RenderObject`
    // constructor on the WebGPU backend) and every mesh here was minted
    // in the loop above, never escaped this function and was never
    // rendered. But the CLASS is the caller's: the material and geometry
    // are `.clone()`s of whatever the asset map holds, so a host
    // subclass may override `dispose` (or override `copy` to carry
    // `_listeners` across from a rendered source, which three's own copy
    // implementations do not). Nothing unrecoverable is stranded if one
    // throws — these are CPU objects with no GPU state behind them, not
    // the device buffers `worldBinding.disposeEntry` is the last owner
    // of — but an escape would replace the ACTIONABLE error (`unknown
    // assetId "rock"`) with a teardown symptom, and the error message is
    // the whole diagnosis for the caller.
    let failure: TeardownFailure = { err };
    for (const mesh of meshes) {
      failure = attempt(failure, () => mesh.dispose());
      for (const material of materialListOf(mesh.material)) {
        failure = attempt(failure, () => material.dispose());
      }
      if (ownsGeometry(mesh)) failure = attempt(failure, () => mesh.geometry.dispose());
    }
    // Always the build error, by the seeding above; the `??` is only
    // there because the helper's type admits an unseeded start.
    throw failure?.err ?? err;
  }
  return meshes;
}
