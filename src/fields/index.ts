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
export * from "./gpuResolver.js";
