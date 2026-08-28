/**
 * The renderer-side seam for device-resident instance batches: what an
 * adapter is asked to build, what it is told about where the batch came
 * from, and the standalone builder for a caller holding batches but no
 * World.
 *
 * It is its own module because both of its users sit downstream of it.
 * `worldBinding.ts` DRIVES the seam from a hierarchical World and
 * `webgpuInstances.ts` IMPLEMENTS it against `THREE.WebGPURenderer`;
 * neither of them is the seam. Housing it in either points the
 * dependency the wrong way — the protocol importing one of its
 * implementations, or the World's module owning the argument type every
 * adapter has to satisfy — and since those two already read each other's
 * types, a third home is also what keeps that from closing into a cycle.
 * `worldBinding.ts` re-exports the three types, so an existing import of
 * them from there still resolves.
 */
import type { Object3D } from "three";
import type { DeviceInstanceBatch } from "../fields/index.js";
import type { CellCoord } from "../runtime/types.js";
import { attempt, type TeardownFailure } from "./teardown.js";

/**
 * Bounding sphere for a batch, supplied out of band because a
 * device-resident batch has no CPU instance matrices to compute one
 * from (`InstancedMesh.computeBoundingSphere()` reads
 * `instanceMatrix.array`, which no longer holds the transforms).
 *
 * Centre and radius are in the coordinate space of the object's parent
 * — the same space `World` cell bounds are expressed in — because
 * three applies `matrixWorld` to the sphere before testing the frustum.
 * Under a World, derive it from `CellContext.min`/`max`: the cell AABB's
 * centre, and half its diagonal plus the radius of the asset being
 * drawn, so instances straddling the cell border are not culled while
 * still on screen. A cell can hold several assets and the sphere is
 * asked for per asset, so that padding is the *drawn* asset's radius,
 * not the largest one in the map — see `DeviceInstanceBinding.bounds`
 * and `toDeviceInstanceObjects`.
 */
export interface DeviceCellBounds {
  /** Sphere centre `[x, y, z]`. */
  readonly center: readonly [number, number, number];
  /** Sphere radius; must cover every instance the batch draws. */
  readonly radius: number;
}

/**
 * What the builder knows about where a device batch came from.
 *
 * EVERY FIELD IS OPTIONAL, because a World is one caller and not the
 * only one. `WorldThreeBinding` fills all three; a caller going straight
 * from a resident spawner's batches to scene objects through
 * {@link toDeviceInstanceObjects} has no level and no cell to name and
 * passes `{}`, or bounds alone. `levelName` and `coord` are diagnostics
 * — they identify the cell in an adapter's error messages and nothing
 * reads them otherwise — so omitting them costs a less specific error
 * message and nothing else.
 */
export interface DeviceInstanceContext {
  /** Level the batch's cell belongs to; absent outside a World. */
  readonly levelName?: string;
  /**
   * Grid coordinate of the batch's cell; absent outside a World. Its
   * arity follows the level's `cellMode` (`[cx, cz]`, `[cx, cy, cz]` or
   * a one-tuple sector index), so treat it as a list, not as `[x, z]`.
   */
  readonly coord?: CellCoord;
  /**
   * Bounds for **this batch's asset**, or undefined when none was
   * supplied — in which case the adapter must disable frustum culling
   * rather than guess, since a wrong sphere culls visible instances
   * silently.
   *
   * One context is built per batch, so a cell holding several assets can
   * give each its own sphere; see `DeviceInstanceBinding.bounds`.
   */
  readonly bounds?: DeviceCellBounds;
}

/**
 * Renderer-side half of the device-resident spawner protocol: turns one
 * {@link DeviceInstanceBatch} into a scene object that draws its
 * instances straight from the batch's GPU buffer.
 *
 * Ownership split, exactly: the ADAPTER owns the three-side objects it
 * creates (material clone, attributes) and frees them in {@link release};
 * the CALLER owns EVERY `DeviceTransformsHandle` the batch carries — its
 * `transforms`, and its `colors` when the spawner was asked for colour.
 * Under a World that caller is `WorldThreeBinding`, which reference-counts
 * the handles and disposes each when no live cell references it any more.
 * An adapter must never call `handle.dispose()`.
 *
 * See `createWebGpuInstanceAdapter` for the WebGPU implementation.
 */
export interface DeviceInstanceAdapter {
  /**
   * Build the scene object for `batch`. Throwing is allowed and safe:
   * every caller in this package releases what it already built for the
   * partial run and rethrows, leaving nothing half-owned behind.
   */
  build(batch: DeviceInstanceBatch, ctx: DeviceInstanceContext): Object3D;
  /** Free the three-side resources of an object {@link build} returned. */
  release(object: Object3D): void;
}

/**
 * Create one scene object per device-resident batch through `adapter` —
 * the device counterpart of `toInstancedMeshes`, and the whole path for
 * a caller that has batches from a resident spawner and no World at all.
 *
 * The adapter is a parameter rather than something built here because it
 * is also what frees the objects again, and because building one is not
 * free: `createWebGpuInstanceAdapter` probes three's adoption seam and
 * carries the live counters, so it is made once and reused for the life
 * of the renderer, exactly as an `AssetMap` is.
 *
 * ```ts
 * const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
 * const objects = toDeviceInstanceObjects(batches, adapter);
 * for (const object of objects) scene.add(object);
 * ```
 *
 * `bounds` is asked once per batch and gives that batch's object its
 * bounding sphere. There are no CPU matrices to compute one from, so a
 * batch with no bounds draws with frustum culling switched OFF rather
 * than with a guessed sphere — drawing too much is recoverable, culling
 * visible geometry is not. Passing no callback therefore draws
 * everything unculled, which is the right default for batches that are
 * not partitioned in space to begin with.
 *
 * Ownership, split three ways:
 *
 * - The ADAPTER owns the objects. Free each with
 *   `adapter.release(object)`, never `mesh.dispose()` on its own —
 *   that leaves the per-mesh material clone alive, and with it the
 *   renderer's cached render state for that mesh.
 * - The CALLER owns the batches' `DeviceTransformsHandle`s. Nothing here
 *   disposes one and neither does the adapter, because releasing an
 *   object says nothing about whether some other object still draws from
 *   the same buffer.
 * - The asset GEOMETRY (and any textures the material references) stays
 *   shared by reference — dispose those with the asset map, never per
 *   object.
 *
 * If a batch mid-list fails validation, the objects already built for
 * earlier batches are released before the error propagates, so a
 * throwing build mints nothing that outlives it.
 */
export function toDeviceInstanceObjects(
  batches: readonly DeviceInstanceBatch[],
  adapter: DeviceInstanceAdapter,
  bounds?: (assetId: string) => DeviceCellBounds | undefined,
): Object3D[] {
  const objects: Object3D[] = [];
  try {
    for (const batch of batches) {
      // No `levelName`, no `coord`: there is no cell here to name. The
      // adapter's errors say so rather than inventing one.
      objects.push(adapter.build(batch, { bounds: bounds?.(batch.assetId) }));
    }
  } catch (err) {
    // A later batch's failure discards the earlier batches' objects —
    // they are local to this call and the caller never sees them, so the
    // adapter must not keep owning them.
    //
    // Each release is its OWN `attempt` (see ./teardown.ts), for the
    // reason `worldBinding.ts` guards the identical loop in
    // `disposeEntry`: these objects are
    // already unreachable from everywhere but this local array, so one
    // throwing `release` mid-list would abandon every LATER object with
    // nothing left in the process that could ever free it — the
    // adapter's material clones and its live-instance meter, permanently
    // high, for a failure in a batch that has nothing to do with them.
    // Seeding the carry-forward with the build failure is what makes
    // that failure the one that propagates: `attempt` keeps the FIRST,
    // and the build error is both first and the one with a live cause.
    let failure: TeardownFailure = { err };
    for (const object of objects) failure = attempt(failure, () => adapter.release(object));
    // Always the build error, by the seeding above; the `??` is only
    // there because the helper's type admits an unseeded start.
    throw failure?.err ?? err;
  }
  return objects;
}

