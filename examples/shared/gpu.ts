/**
 * WebGPU setup shared by the example pages: acquire a device, offer the
 * cook paths a page can switch between, and render the library's
 * fallback vocabulary.
 *
 * Device acquisition is deliberately NOT in the library. `pcg-ts/gpu` is
 * typed structurally so it needs no WebGPU type dependency, which means
 * it can consume a `GPUDevice` but must not be the thing that asks for
 * one. Every page therefore declares the same small structural view of
 * `navigator.gpu` and does the same three-step probe, which is why it
 * lives here instead of being written out a fourth time.
 */
import type { GpuFieldResolver } from "pcg-ts";
import { GpuFieldEvaluator, type GpuAdapterInfoLike, type GpuDeviceLike } from "pcg-ts/gpu";

// -- device acquisition ----------------------------------------------------

/**
 * Minimal structural view of `navigator.gpu`, kept local so the examples
 * compile with or without an ambient WebGPU type package. A real
 * `GPUDevice` is compile-time assignable to `GpuDeviceLike`.
 */
interface AdapterLike {
  readonly info?: GpuAdapterInfoLike;
  requestDevice(): Promise<GpuDeviceLike>;
}
interface NavigatorGpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

/** A device plus the human-readable adapter label to show in the UI. */
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

// -- cook paths ------------------------------------------------------------

/**
 * Wraps a real evaluator so the executor never fuses: `planRun` returns
 * null — with no fallback counted, because this is a MODE, not a
 * rejection — so every member cooks through the per-node path.
 * `executeRun` is forwarded only because the executor requires *both*
 * run methods before it calls either; with a null plan it is
 * unreachable.
 *
 * `cacheSalt` is the base evaluator's, deliberately. Both paths run on
 * the same device, so claiming different device provenance would be a
 * lie. They still never serve each other's bytes: a fused terminal
 * caches under a run key and a per-node cook under a node key, and the
 * two key formats cannot collide.
 */
export function perNodeOnly(base: GpuFieldEvaluator): GpuFieldResolver {
  return {
    cacheSalt: base.cacheSalt,
    /**
     * Forwarded explicitly, and this line is load-bearing.
     * `acceptDerivedSpecs` is optional on the interface, so a wrapper
     * that drops it typechecks cleanly while telling the executor the
     * base accepts less than it does — which salts memo keys for the
     * authored population while the base resolves the wider one, writing
     * GPU bytes under a CPU key. `src/fields/spec.ts:265-288` closes this
     * inside the library with an internal `resolverView` helper; it is
     * not exported, so a page forwards by hand or not at all.
     */
    acceptDerivedSpecs: base.acceptDerivedSpecs,
    resolveField: (field, ctx, stats) => base.resolveField(field, ctx, stats),
    planRun: () => null,
    executeRun: (plan, input, stats) => base.executeRun(plan, input, stats),
  };
}

/** The cook paths a page can offer. `cpu` passes no resolver at all. */
export type CookPath = "cpu" | "gpu-per-node" | "gpu-fused";

/** Every path, in the order a selector should present them. */
export const COOK_PATHS: readonly CookPath[] = ["cpu", "gpu-per-node", "gpu-fused"];

/** Short label for a path, for a toolbar or a status line. */
export function cookPathLabel(path: CookPath): string {
  return path === "cpu" ? "cpu" : path === "gpu-per-node" ? "gpu · per-node" : "gpu · fused";
}

/**
 * The resolvers for the two device paths, built on one device.
 *
 * `acceptDerivedSpecs` is left at its default. A page that loads
 * SERIALIZED graphs has no derived specs to accept: graph JSON revives
 * every field param through `fieldFromJson`, which stamps it authored.
 * Turning the flag on would change the memo salt and buy nothing.
 */
export interface GpuPaths {
  readonly fused: GpuFieldEvaluator;
  readonly perNode: GpuFieldResolver;
  dispose(): void;
}

export function createGpuPaths(probe: DeviceProbe): GpuPaths {
  const fused = new GpuFieldEvaluator(probe.device, {
    ...(probe.info === undefined ? {} : { adapterInfo: probe.info }),
  });
  return {
    fused,
    perNode: perNodeOnly(fused),
    // Only the pool is released; the evaluator stays usable and its
    // pipeline cache survives, so switching back to a device path does
    // not recompile every kernel.
    dispose: () => fused.dispose(),
  };
}

/**
 * The one reason carried in `fallbacks` that is NOT a fallback: the
 * planner rejected a member, retried the suffix after it, and fused what
 * remained. It reports a partial success rather than a lost run
 * (`src/fields/gpuResolver.ts:50-60`), so a page that prints it under
 * the same heading as `compile-error` is misreporting a win as a loss.
 */
export const PARTIAL_FUSION = "run-partially-fused";

/** Split the record into real fallbacks and the partial-fusion count. */
export function splitFallbacks(fallbacks: Record<string, number>): {
  real: Record<string, number>;
  partial: number;
} {
  const real: Record<string, number> = {};
  let partial = 0;
  for (const [reason, n] of Object.entries(fallbacks)) {
    if (reason === PARTIAL_FUSION) partial += n;
    else real[reason] = n;
  }
  return { real, partial };
}

/** Render `GpuCookStats.fallbacks` — the machine-readable reason vocabulary. */
export function fmtFallbacks(fallbacks: Record<string, number>): string {
  const entries = Object.entries(fallbacks).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "none";
  return entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
}
