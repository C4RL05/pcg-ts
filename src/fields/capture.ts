import type { AttrType, Domain, Geometry } from "../data/index.js";
import type { GpuCookStats, GpuFieldResolver } from "./gpuResolver.js";
import { resolveField } from "./inputs.js";
import {
  type Column,
  type EvalContext,
  type FieldLike,
  evaluateField,
} from "./types.js";

/** Prefix of anonymous attributes created by {@link capture}. */
export const ANON_ATTR_PREFIX = "__anon_";

/** Store a column as a fresh anonymous attribute; returns its name. */
function storeColumn(geo: Geometry, domain: Domain, column: Column): string {
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

/**
 * Evaluate a field over a domain and store the result as a hidden
 * anonymous attribute, returning its name (readable back through
 * `attribute(name)`). Names are `__anon_<n>` with the smallest free
 * counter — deterministic for a deterministic call sequence.
 */
export function capture(geo: Geometry, domain: Domain, field: FieldLike, seed = 0): string {
  const ctx: EvalContext = { geo, domain, seed };
  const column = evaluateField(resolveField(field), ctx);
  return storeColumn(geo, domain, column);
}

/**
 * Async variant of {@link capture} that resolves the field on a GPU when
 * a resolver is given and the field is eligible (it carries a
 * serializable spec compatible with the geometry's attribute layout —
 * see `GpuFieldResolver`), falling back to the CPU evaluation otherwise.
 * Without a resolver it is byte-identical to `capture`. This is the
 * graph-free entry point for GPU field evaluation: any spec'd field can
 * be evaluated over a geometry directly. `stats`, when given, receives
 * the resolver's dispatch/pipeline/fallback counters.
 */
export async function captureAsync(
  geo: Geometry,
  domain: Domain,
  field: FieldLike,
  seed = 0,
  gpu?: GpuFieldResolver,
  stats?: GpuCookStats,
): Promise<string> {
  const resolved = resolveField(field);
  const ctx: EvalContext = { geo, domain, seed };
  let column: Column | null = null;
  if (gpu !== undefined) {
    const pending = gpu.resolveField(resolved, ctx, stats);
    if (pending !== null) column = await pending;
  }
  if (column === null) column = evaluateField(resolved, ctx);
  return storeColumn(geo, domain, column);
}
