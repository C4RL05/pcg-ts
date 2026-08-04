import type { AttrType, Domain, Geometry } from "../data/index.js";
import { resolveField } from "./inputs.js";
import { type EvalContext, type FieldLike, evaluateField } from "./types.js";

/** Prefix of anonymous attributes created by {@link capture}. */
export const ANON_ATTR_PREFIX = "__anon_";

/**
 * Evaluate a field over a domain and store the result as a hidden
 * anonymous attribute, returning its name (readable back through
 * `attribute(name)`). Names are `__anon_<n>` with the smallest free
 * counter — deterministic for a deterministic call sequence.
 */
export function capture(geo: Geometry, domain: Domain, field: FieldLike, seed = 0): string {
  const ctx: EvalContext = { geo, domain, seed };
  const column = evaluateField(resolveField(field), ctx);
  const set = geo.attrs[domain];
  let i = 0;
  let name = `${ANON_ATTR_PREFIX}${i}`;
  while (set.has(name)) name = `${ANON_ATTR_PREFIX}${++i}`;
  const type: AttrType =
    column.data instanceof Float32Array ? "f32" : column.data instanceof Int32Array ? "i32" : "u32";
  const attr = set.add(name, type, column.tupleSize);
  attr.data.set(column.data);
  return name;
}
