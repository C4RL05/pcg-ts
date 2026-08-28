// Named rather than `export *`: types.ts also exports FIELD_BRAND, the
// symbol `makeField` stamps and `isField` reads. Hand-authoring a Field
// IS supported (see docs/authoring.md, "Hand-authoring a field"), and the
// brand is not part of that path — `makeField` stamps it for you and
// `isField` is the supported check, so the two uses of the symbol are
// both inside its own file. Exported, it would invite the one spelling
// that breaks: a literal `{ key, tupleSize, evaluate, [FIELD_BRAND]: true }`
// that skips `makeField` and freezes the brand's representation.
// See publicSurface.test.ts.
export {
  type Column,
  type ColumnData,
  type EvalContext,
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  isField,
  keyNum,
  keyRef,
  makeField,
} from "./types.js";
export * from "./inputs.js";
export * from "./combinators.js";
// Named rather than `export *`: capture.ts also exports ANON_ATTR_PREFIX,
// the "__anon_" marker anonymous attributes are named with. That prefix is
// an internal encoding — nothing outside this module reads it — and
// `export *` published it as API, where a consumer could come to depend on
// the literal and freeze it. See publicSurface.test.ts.
export { capture, captureAsync } from "./capture.js";
// Named rather than `export *`: gpuResolver.ts also exports
// `makeDeviceInstanceBatch`, and the package must not promise it. It
// exists to install `DeviceInstanceBatch.colors` as an accessor over the
// reserved `"color"` channel on the batches the RESIDENT RUN mints, so
// that the older spelling and the channel can never hold different
// handles. A caller building a batch of its own has nothing to gain from
// it — write the object literal the `DeviceInstanceBatch` type documents,
// with `attributes`, and read it back through
// `deviceInstanceAttributesOf`, which lifts a plain `colors` into the
// reserved channel so both shapes take one path. Published, it would
// invite a caller to mint batches through a constructor whose only job is
// backward compatibility with a spelling they are not using.
// `makeInstanceBatch` is withheld from `src/graph/index.ts` for exactly
// this reason; see the comment there. It remains exported from
// ./gpuResolver.js, which is what src/gpu imports. See publicSurface.test.ts.
export {
  createGpuCookStats,
  type DeviceInstanceAttrType,
  type DeviceInstanceAttribute,
  type DeviceInstanceAttributeLayout,
  deviceInstanceAttributeLayout,
  type DeviceInstanceBatch,
  deviceInstanceAttributesOf,
  type DeviceTransformsHandle,
  type GpuCookStats,
  type GpuFieldResolver,
  type NonFiniteReport,
  type ResidentAttrDesc,
  type ResidentMemberDesc,
  type ResidentRunContext,
  type ResidentRunInput,
  type ResidentRunResult,
} from "./gpuResolver.js";
