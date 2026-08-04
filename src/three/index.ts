/**
 * three.js interop for pcg-ts, exported as `pcg-ts/three`. This is the
 * only module of the package allowed to import `three` (an optional peer
 * dependency); the core stays renderer-agnostic.
 */
export { fromBufferGeometry, fromCurve } from "./convert.js";
export { toInstancedMeshes, type AssetMap, type InstancedAsset } from "./instanced.js";
export { toPointsObject, type ToPointsOptions } from "./debug.js";
export { WorldThreeBinding, type WorldThreeBindingOptions } from "./worldBinding.js";
