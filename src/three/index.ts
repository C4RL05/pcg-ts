/**
 * three.js interop for pcg-ts, exported as `pcg-ts/three`. This is the
 * only module of the package allowed to import `three` (an optional peer
 * dependency); the core stays renderer-agnostic.
 */
export {
  fromBufferGeometry,
  fromCurve,
  toBufferGeometry,
  toLineGeometry,
  type ToBufferGeometryOptions,
  type ToThreeGeometryOptions,
} from "./convert.js";
/**
 * `ownsGeometry`, `ownsMaterial` and `materialListOf` ship beside
 * `toInstancedMeshes` because together they ARE that function's disposal
 * contract, and a caller writing its own teardown instead of using
 * `WorldThreeBinding` has to be able to run it:
 *
 * - `ownsGeometry` — a batch carrying named per-instance channels gets a
 *   geometry CLONE (a channel is a geometry attribute and cannot be
 *   shared), and the caller that disposes the mesh is the only one that
 *   can dispose the clone.
 * - `materialListOf` — `mesh.material` is `Material | Material[]`, and a
 *   host that casts the union away to call `dispose()` disposes slot 0
 *   and leaks every other slot of a multi-material asset. The docs have
 *   told hosts to walk the slots through this function since the
 *   per-mesh clone shipped; it was never actually exported, which is the
 *   defect this closes.
 * - `ownsMaterial` — false exactly for a material the caller supplied
 *   through `ToInstancedMeshesOptions.materialFor`, which the library
 *   must never dispose. Absence means owned, so an old teardown keeps
 *   disposing exactly what it always did.
 *
 * `ToInstancedMeshesOptions` carries the two opt-ins. `requireChannels`
 * states the channel names the caller's materials declare, so a batch
 * missing one is refused by name instead of drawn as zeros
 * (`toInstancedMeshes` binds what the batch carries and never sees the
 * material, so the two can disagree with nothing malformed on either
 * side). `materialFor` supplies a batch's material directly, suppressing
 * the per-mesh clone and transferring its lifetime to the caller.
 * Exported because a host assembles both beside its asset map, and a
 * value stored in a variable needs a name for its type.
 */
export {
  materialListOf,
  ownsGeometry,
  ownsMaterial,
  toInstancedMeshes,
  type AssetMap,
  type InstancedAsset,
  type ToInstancedMeshesOptions,
} from "./instanced.js";
export { toPointsObject, type ToPointsOptions } from "./debug.js";
/**
 * The device-instancing seam, published from the module that defines it
 * rather than from `worldBinding.js`: a World drives it, but nothing
 * about it requires one — `toDeviceInstanceObjects` is the device
 * counterpart of `toInstancedMeshes` and needs no World at all.
 */
export {
  toDeviceInstanceObjects,
  type DeviceCellBounds,
  type DeviceInstanceAdapter,
  type DeviceInstanceContext,
} from "./deviceInstances.js";
export {
  WorldThreeBinding,
  type DeviceInstanceBinding,
  type WorldThreeBindingOptions,
} from "./worldBinding.js";
/**
 * Device-resident instancing (opt-in). `three/webgpu` is loaded lazily
 * by the factory, so importing `pcg-ts/three` in a WebGL app costs
 * nothing extra.
 */
export {
  checkAdoptionSeam,
  createWebGpuInstanceAdapter,
  type WebGpuInstanceAdapter,
  type WebGpuInstanceAdapterOptions,
  type WebGpuInstanceAdapterStats,
  type WebGpuRendererLike,
} from "./webgpuInstances.js";
