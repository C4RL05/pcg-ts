/**
 * Shared types between the demo host (main.ts) and the Svelte panel:
 * the host pushes immutable view snapshots through the bridge, the
 * panel calls back through `PanelHost` on user input.
 */

/** Which resolver path the next cook uses. */
export type CookMode = "cpu" | "gpu";

/** Per-mode cook results (wall time + output hash). */
export interface ModeReport {
  /** Wall ms of the last cook that actually recooked nodes. */
  lastMs?: number;
  /** Best (lowest) wall ms seen for the current seed/count. */
  bestMs?: number;
  /** FNV-1a over the cooked tint+size column bytes. */
  hash?: string;
}

/** GPU counters mirrored verbatim from `CookStats.gpu`. */
export interface GpuStatsView {
  dispatches: number;
  pipelinesCompiled: number;
  pipelineCacheHits: number;
  fallbacks: Record<string, number>;
}

/** Live CPU-vs-GPU comparison over a sample window. */
export interface DeviationView {
  /** max |cpu - gpu| over the window, absolute. */
  maxAbs: number;
  /** The same error in range-ULP units: maxAbs / (2^-23 * max|cpu|). */
  rangeUlp: number;
  /** Elements compared (first N of the point domain). */
  window: number;
}

/** Snapshot the host pushes into the panel after every state change. */
export interface PanelView {
  gpuAvailable: boolean;
  /** Why WebGPU is unavailable ("" when it is available). */
  gpuReason: string;
  /** Adapter description (vendor / architecture / device). */
  adapter: string;
  mode: CookMode;
  count: number;
  seed: number;
  frequency: number;
  cooking: boolean;
  fps: string;
  /** Points in the last cooked geometry. */
  points: number;
  /** Nodes cooked / served from cache in the last cook. */
  nodes: string;
  cpu: ModeReport;
  gpu: ModeReport;
  gpuStats?: GpuStatsView;
  deviation?: DeviationView;
  /** Tint FieldSpec JSON (the exact spec that cooks). */
  specJson: string;
  error?: string;
}

/** Control callbacks the panel invokes on the host. */
export interface PanelHost {
  setMode(mode: CookMode): void;
  setCount(count: number): void;
  setSeed(seed: number): void;
  setFrequency(frequency: number): void;
  /** Rebuild the graph from scratch (cold caches) and recook — the determinism check. */
  rebuild(): void;
}

/** The panel assigns `publish` on mount; the host calls it to update the view. */
export interface PanelBridge {
  publish?: (view: PanelView) => void;
}

/** Selectable point counts (all under the 4.19M single-dispatch limit). */
export const COUNT_OPTIONS = [100_000, 500_000, 1_000_000, 2_000_000] as const;
