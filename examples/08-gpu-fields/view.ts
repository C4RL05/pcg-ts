/**
 * Shared types between the demo host (main.ts) and the Svelte panel:
 * the host pushes immutable view snapshots through the bridge, the
 * panel calls back through `PanelHost` on user input.
 */

/**
 * Which cook path the next cook uses:
 *
 * - `cpu` — no resolver at all. The bit-exact reference.
 * - `gpu-node` — the real evaluator for field resolution, but fusion
 *   disabled (`planRun` returns null), so every node clones the
 *   geometry, reads its field column back, and applies it on the CPU.
 * - `gpu-fused` — the plain evaluator: the whole chain becomes one
 *   device-resident run with a single readback at its terminal.
 */
export type CookPath = "cpu" | "gpu-node" | "gpu-fused";

export const COOK_PATHS = ["cpu", "gpu-node", "gpu-fused"] as const;

export const PATH_LABEL: Record<CookPath, string> = {
  cpu: "CPU",
  "gpu-node": "GPU per-node",
  "gpu-fused": "GPU fused",
};

/** Resident working-set bound handed to the fused path's evaluator. */
export type ResidentBudget = "default" | "tight";

/**
 * Deliberately far below what this chain needs at any selectable count,
 * so picking it makes `planRun` reject with `run-too-large` and the
 * fused path degrade to per-node cooking — the graceful-degradation
 * story, visible in the fallbacks line.
 */
export const TIGHT_RESIDENT_BYTES = 8 * 1024 * 1024;

/** GPU counters mirrored verbatim from `CookStats.gpu`. */
export interface GpuStatsView {
  /**
   * Compute kernels executed — one per resolved field column plus one
   * apply kernel per fused member, except a multi-asset spawner
   * terminal, which dispatches once per (member, asset): it composes one
   * buffer per asset over that asset's own element range, and each of
   * those counts. NOT a `dispatchWorkgroups` count: a kernel split
   * across chunks still counts once. (This chain has no spawner, so here
   * the count is exactly one per field column plus one per member.)
   */
  dispatches: number;
  pipelinesCompiled: number;
  pipelineCacheHits: number;
  /** Device-resident runs actually executed (a cached run counts nothing). */
  residentRuns: number;
  /** Total member nodes across those runs. */
  fusedNodes: number;
  /** `fusedNodes - residentRuns` — readbacks fusion avoided. */
  readbacksSaved: number;
  fallbacks: Record<string, number>;
}

/** Per-path cook results. */
export interface PathReport {
  /** Wall ms of the last cold cook (fresh graph, empty caches). */
  lastMs?: number;
  /** Best (lowest) cold wall ms seen for the current seed/count/frequency. */
  bestMs?: number;
  /** Wall ms of the last warm recook (same graph, caches populated). */
  warmMs?: number;
  /** FNV-1a over the cooked tint+size column bytes. */
  hash?: string;
  /** Nodes cooked / served from cache in the last cook on this path. */
  nodes?: string;
  /** `CookStats.gpu` from the last cook on this path (absent on the CPU path). */
  gpu?: GpuStatsView;
}

/** Live CPU-vs-GPU comparison over a sample window. */
export interface DeviationView {
  /** max |cpu - gpu| over the window, absolute. */
  maxAbs: number;
  /** The same error in range-ULP units: maxAbs / (2^-23 * max|cpu|). */
  rangeUlp: number;
  /** Elements compared (first N of the point domain). */
  window: number;
  /** Which path produced the bytes being compared. */
  path: CookPath;
}

/** Snapshot the host pushes into the panel after every state change. */
export interface PanelView {
  gpuAvailable: boolean;
  /** Why WebGPU is unavailable ("" when it is available). */
  gpuReason: string;
  /** Adapter description (vendor / architecture / device). */
  adapter: string;
  path: CookPath;
  count: number;
  seed: number;
  frequency: number;
  residentBudget: ResidentBudget;
  cooking: boolean;
  fps: string;
  /** Points in the last cooked geometry. */
  points: number;
  reports: Record<CookPath, PathReport>;
  deviation?: DeviationView;
  /** Tint FieldSpec JSON (the exact spec that cooks). */
  specJson: string;
  error?: string;
}

/** Control callbacks the panel invokes on the host. */
export interface PanelHost {
  setPath(path: CookPath): void;
  setCount(count: number): void;
  setSeed(seed: number): void;
  setFrequency(frequency: number): void;
  setResidentBudget(budget: ResidentBudget): void;
  /** Cold-cache cook of every available path back to back — the timing comparison. */
  measureAll(): void;
  /** Rebuild the graph from scratch (cold caches) and recook — the determinism check. */
  rebuild(): void;
  /** Recook the SAME graph — every node should come from cache in ~0 ms. */
  cookWarm(): void;
}

/** The panel assigns `publish` on mount; the host calls it to update the view. */
export interface PanelBridge {
  publish?: (view: PanelView) => void;
}

/**
 * Selectable point counts. There is no dispatch-size ceiling any more
 * (kernels chunk automatically); the practical ceiling here is the
 * fused run's working set, which grows linearly with the count and is
 * bounded by the evaluator's `maxResidentBytes`.
 */
export const COUNT_OPTIONS = [100_000, 500_000, 1_000_000, 2_000_000] as const;
