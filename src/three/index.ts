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
 * `ownsGeometry` ships beside `toInstancedMeshes` because it is half of
 * that function's disposal contract: a batch carrying named per-instance
 * channels gets a geometry CLONE (a channel is a geometry attribute and
 * cannot be shared), and the caller that disposes the mesh is the only
 * one that can dispose the clone. A caller writing its own teardown
 * instead of using `WorldThreeBinding` needs to ask.
 */
export { ownsGeometry, toInstancedMeshes, type AssetMap, type InstancedAsset } from "./instanced.js";
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
