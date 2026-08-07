/**
 * three.js interop for pcg-ts, exported as `pcg-ts/three`. This is the
 * only module of the package allowed to import `three` (an optional peer
 * dependency); the core stays renderer-agnostic.
 */
export { fromBufferGeometry, fromCurve } from "./convert.js";
export { toInstancedMeshes, type AssetMap, type InstancedAsset } from "./instanced.js";
export { toPointsObject, type ToPointsOptions } from "./debug.js";
export {
  WorldThreeBinding,
  type DeviceCellBounds,
  type DeviceInstanceAdapter,
  type DeviceInstanceBinding,
  type DeviceInstanceContext,
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
