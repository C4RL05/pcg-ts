/**
 * GPU field evaluation plumbing for 04 — infinite world.
 *
 * Two pieces the `World` runtime does not hand you on its own:
 *
 * 1. `requestGpuDevice` — adapter/device acquisition that returns an
 *    explicit reason string on every failure path, so the page can say
 *    what was missing instead of silently rendering the CPU path.
 *
 * 2. `CookStatsTap` — a `GpuFieldResolver` that forwards every call to a
 *    `GpuFieldEvaluator` and keeps a reference to the per-cook
 *    `GpuCookStats` object the executor threads through it.
 *
 * The tap exists because `World` cooks cells internally and drops each
 * cell's `CookStats` on the floor: `onCellReady` hands over outputs
 * only, and neither `UpdateStats` nor `WorldStats` carries a `gpu`
 * field. Intercepting the stats sink is therefore the only way a
 * World-based page can read `CookStats.gpu` at all — and what it reads
 * is not a reconstruction: the object captured here IS the object the
 * executor publishes as `CookStats.gpu` for that cook, so the readouts
 * are that object's own fields.
 *
 * The tap forwards `cacheSalt`, `residentTerminals` and
 * `acceptDerivedSpecs` verbatim. The last one is load-bearing rather
 * than cosmetic: the executor reads that advertisement to decide both
 * memo-key salting and run eligibility, so a wrapper that dropped it
 * would let device-produced bytes be stored under a CPU memo key.
 */
import {
  createGpuCookStats,
  type Column,
  type EvalContext,
  type Field,
  type GpuCookStats,
  type GpuFieldResolver,
  type ResidentMemberDesc,
  type ResidentRunContext,
  type ResidentRunInput,
  type ResidentRunResult,
} from "pcg-ts";
import { GpuFieldEvaluator, type GpuAdapterInfoLike, type GpuDeviceLike } from "pcg-ts/gpu";

// -- device acquisition ----------------------------------------------------

/**
 * Minimal structural view of `navigator.gpu`, kept local so the example
 * compiles with or without an ambient WebGPU type package. A real
 * `GPUDevice` is compile-time assignable to `GpuDeviceLike`.
 */
interface AdapterLike {
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}
interface NavigatorGpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

/** A device plus the human-readable adapter label to show in the panel. */
export interface DeviceProbe {
  readonly device: GpuDeviceLike;
  readonly info: GpuAdapterInfoLike | undefined;
  readonly label: string;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeAdapter(info: GpuAdapterInfoLike | undefined): string {
  // `description` is often an empty string rather than absent, so fall
  // through to `device` on both empty and missing.
  const detail = (info?.description ?? "") !== "" ? info?.description : info?.device;
  return (
    [info?.vendor, info?.architecture, detail]
      .filter((p): p is string => typeof p === "string" && p !== "")
      .join(" · ") || "adapter (no info exposed)"
  );
}

/**
 * Acquire a WebGPU device, or return the specific reason none is
 * available. `onLost` fires if the device is lost later — a lost device
 * never rejects work already in flight (a pending readback simply never
 * settles), so the caller must surface it rather than let the page sit
 * there looking like a library hang.
 */
export async function requestGpuDevice(
  onLost: (detail: string) => void,
): Promise<DeviceProbe | { error: string }> {
  const navGpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
  if (navGpu === undefined) {
    return { error: "navigator.gpu is missing — this browser has no WebGPU." };
  }
  try {
    const adapter = await navGpu.requestAdapter();
    if (adapter === null) {
      return { error: "navigator.gpu.requestAdapter() returned null — no compatible GPU adapter." };
    }
    const info = adapter.info;
    const device = await adapter.requestDevice();
    const lost = (device as { lost?: Promise<{ reason?: string; message?: string }> }).lost;
    if (lost !== undefined) {
      void lost.then((detail) => {
        onLost(`${detail?.reason ?? "unknown"}: ${detail?.message ?? "no detail"}`);
      });
    }
    return { device, info, label: describeAdapter(info) };
  } catch (err) {
    return { error: `requestDevice() failed: ${errText(err)}` };
  }
}

/**
 * Build the evaluator pair this page toggles between. Both sit on one
 * device and differ only in `acceptDerivedSpecs`, which is a constructor
 * option — hence two evaluators rather than one mutable flag.
 *
 * `acceptDerivedSpecs: true` is what makes this page interesting: every
 * field in `levels.ts` is combinator-authored, so with the flag off each
 * one counts a `"derived-spec"` fallback and evaluates on the CPU.
 *
 * These are long-lived: the evaluator owns the pipeline and kernel
 * caches, and `dispose()` only drops the idle buffer pool, so rebuilding
 * them per world would churn compilation for nothing.
 */
export function createEvaluators(probe: DeviceProbe): {
  derived: GpuFieldEvaluator;
  strict: GpuFieldEvaluator;
} {
  const base = probe.info !== undefined ? { adapterInfo: probe.info } : {};
  return {
    derived: new GpuFieldEvaluator(probe.device, { ...base, acceptDerivedSpecs: true }),
    strict: new GpuFieldEvaluator(probe.device, base),
  };
}

// -- stats tap -------------------------------------------------------------

/**
 * A pass-through `GpuFieldResolver` that captures the per-cook
 * `GpuCookStats` objects the executor threads through it. See the file
 * header for why a World-based page needs one.
 */
export class CookStatsTap implements GpuFieldResolver {
  readonly cacheSalt: string;
  readonly residentTerminals: readonly string[] | undefined;
  readonly acceptDerivedSpecs: boolean;

  private readonly base: GpuFieldEvaluator;
  /**
   * Distinct per-cook stats objects seen since the last `drain`. Keyed
   * by identity rather than summed on arrival: the executor mutates each
   * object for the life of its cook, so summing is only correct once the
   * cooks that own them have finished.
   */
  private readonly seen = new Set<GpuCookStats>();

  constructor(base: GpuFieldEvaluator) {
    this.base = base;
    this.cacheSalt = base.cacheSalt;
    this.residentTerminals = base.residentTerminals;
    this.acceptDerivedSpecs = base.acceptDerivedSpecs;
  }

  resolveField(field: Field, ctx: EvalContext, stats?: GpuCookStats): Promise<Column> | null {
    if (stats !== undefined) this.seen.add(stats);
    return this.base.resolveField(field, ctx, stats);
  }

  planRun(
    members: readonly ResidentMemberDesc[],
    ctx: ResidentRunContext,
    stats?: GpuCookStats,
  ): object | null {
    if (stats !== undefined) this.seen.add(stats);
    return this.base.planRun(members, ctx, stats);
  }

  executeRun(
    plan: object,
    input: ResidentRunInput,
    stats?: GpuCookStats,
  ): Promise<ResidentRunResult> {
    if (stats !== undefined) this.seen.add(stats);
    return this.base.executeRun(plan, input, stats);
  }

  /**
   * Sum the `CookStats.gpu` objects captured since the last call and
   * start a fresh window. Returns `undefined` when no cook in the window
   * touched the device at all (a fully cached update), which the caller
   * shows as "counters unchanged" rather than as zeros.
   *
   * Call this only when the cooks in the window have settled — from an
   * `update()` continuation, not mid-frame.
   */
  drain(): GpuCookStats | undefined {
    if (this.seen.size === 0) return undefined;
    const total = createGpuCookStats();
    for (const s of this.seen) {
      total.dispatches += s.dispatches;
      total.pipelinesCompiled += s.pipelinesCompiled;
      total.pipelineCacheHits += s.pipelineCacheHits;
      total.residentRuns += s.residentRuns;
      total.fusedNodes += s.fusedNodes;
      total.readbacksSaved += s.readbacksSaved;
      for (const [reason, n] of Object.entries(s.fallbacks)) {
        total.fallbacks[reason] = (total.fallbacks[reason] ?? 0) + n;
      }
    }
    this.seen.clear();
    return total;
  }
}
// Deliberately no `dispose()`: a tap owns nothing but its own stats
// window, and the evaluator it wraps is shared with every other tap on
// the device. Forwarding a dispose here would tear down the shared
// buffer pool on every world rebuild.

/** Render `GpuCookStats.fallbacks` the way 02 and 08 render it. */
export function fmtFallbacks(fallbacks: Record<string, number>): string {
  const entries = Object.entries(fallbacks).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
}
