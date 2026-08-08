/**
 * Scaffolding shared by the gpu tests and the out-of-process device
 * scenarios. Test-only: no barrel exports it, and nothing here asserts —
 * every caller keeps its own resolver identity, its own detectors, and its
 * own expectations. Only the parts that would otherwise be copied verbatim
 * live here.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateField,
  makeField,
  randomField,
  type Column,
  type EvalContext,
  type Field,
  type GpuCookStats,
} from "../fields/index.js";
import { deviceSpec, specFallbackReason } from "../fields/spec.js";
import type { CookResult } from "../graph/index.js";

/** Optional behavior a caller layers onto {@link cpuResolveField}. */
export interface CpuResolveHooks {
  /**
   * Called with the production reason each time a field is declined, for
   * doubles that record their own declined tally alongside `stats`.
   */
  readonly onFallback?: (reason: "no-spec" | "derived-spec") => void;
  /**
   * Count `stats.dispatches` on success. Default true; a double that only
   * pins run planning sets this false so its dispatch counter stays at
   * whatever its own test expects.
   */
  readonly countDispatches?: boolean;
}

/**
 * CPU-backed per-field resolution behind the PRODUCTION eligibility gate:
 * `deviceSpec` driven by the flag the caller advertises, so a double can
 * never resolve a field the executor did not salt — the property most of
 * these tests exist to pin. Declined fields count the production reason in
 * `stats.fallbacks`; resolved ones return a FRESH column, honoring the
 * same freshness contract a real device readback satisfies.
 */
export function cpuResolveField(
  field: Field,
  ctx: EvalContext,
  stats: GpuCookStats | undefined,
  accept: boolean,
  hooks: CpuResolveHooks = {},
): Promise<Column> | null {
  if (deviceSpec(field, accept) === undefined) {
    const reason = specFallbackReason(field);
    hooks.onFallback?.(reason);
    if (stats !== undefined) stats.fallbacks[reason] = (stats.fallbacks[reason] ?? 0) + 1;
    return null;
  }
  if (stats !== undefined && hooks.countDispatches !== false) stats.dispatches++;
  const column = evaluateField(field, ctx);
  return Promise.resolve({
    data: column.data.slice() as Column["data"],
    tupleSize: column.tupleSize,
  });
}

/**
 * A field no spec can ever name — an arbitrary closure — computing the
 * same bytes as `randomField(key)`, so the two ineligible populations
 * ("indescribable" and "described but code-authored") differ only in
 * provenance and their fallback reason, never in what they evaluate to.
 */
export function opaqueField(key = "authored"): Field<1> {
  return makeField("opaque", 1, (ctx) => evaluateField(randomField(key), ctx));
}

/** How {@link collectSourceFiles} narrows the walk. */
export interface SourceScanOptions {
  /** Include `*.test.ts` files too. Default false. */
  readonly includeTests?: boolean;
  /** Absolute path of one directory to skip entirely. */
  readonly skipDir?: string;
}

/**
 * Every `.ts` file under `dir`, recursively, in directory-entry order.
 * The source-level drift pins that use this each bring their own detector
 * and their own assertions; this only finds the files to run them over.
 */
export function collectSourceFiles(dir: string, opts: SourceScanOptions = {}): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (path !== opts.skipDir) visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        if (opts.includeTests === true || !entry.name.endsWith(".test.ts")) out.push(path);
      }
    }
  };
  visit(dir);
  return out;
}

/** A cook's `out` geometry point attribute, as a Column over live storage. */
export function attrColumn(result: CookResult, name: string): Column {
  const item = result.outputs.out[0];
  if (item.kind !== "geometry") throw new Error("expected a geometry item");
  const attr = item.geo.attrs.point.require(name);
  const n = item.geo.attrs.point.count * attr.tupleSize;
  return { data: attr.data.subarray(0, n) as Column["data"], tupleSize: attr.tupleSize };
}
