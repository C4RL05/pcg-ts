<script lang="ts">
  /**
   * Svelte 5 (runes) panel for the GPU fields demo: mode toggle, point
   * count, seed, frequency — plus the live cook report the host pushes
   * through the bridge (wall times, CookStats.gpu counters, per-path
   * output hashes, and the CPU-vs-GPU deviation readout).
   */
  import { COUNT_OPTIONS, type CookMode, type PanelBridge, type PanelHost, type PanelView } from "./view.js";

  let {
    host,
    bridge,
    initial,
  }: { host: PanelHost; bridge: PanelBridge; initial: PanelView } = $props();

  let view = $state(initial);
  bridge.publish = (v: PanelView) => {
    view = v;
  };

  function fmtCount(n: number): string {
    return n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}k`;
  }
  function fmtMs(v: number | undefined): string {
    return v === undefined ? "–" : `${v.toFixed(1)} ms`;
  }
  function fmtReport(r: { lastMs?: number; bestMs?: number }): string {
    return `${fmtMs(r.lastMs)} · best ${fmtMs(r.bestMs)}`;
  }
  function fmtFallbacks(f: Record<string, number>): string {
    const parts = Object.entries(f).map(([reason, n]) => `${reason}×${n}`);
    return parts.length > 0 ? parts.join(", ") : "none";
  }

  function pickMode(m: CookMode): void {
    if (m === view.mode || view.cooking) return;
    host.setMode(m);
  }

  let seedInput = $state(initial.seed);
  function commitSeed(): void {
    const v = Math.floor(Number(seedInput));
    if (Number.isFinite(v)) host.setSeed(v >>> 0);
  }

  const speedup = $derived(
    view.cpu.bestMs !== undefined && view.gpu.bestMs !== undefined && view.gpu.bestMs > 0
      ? (view.cpu.bestMs / view.gpu.bestMs).toFixed(1)
      : undefined,
  );
</script>

<div class="panel">
  <h1>08 · gpu fields</h1>
  <p class="info">
    pointScatterInBounds → setAttribute ×2, whose JSON field expressions compile to WGSL compute
    kernels when the cook is handed a <code>GpuFieldEvaluator</code>. Toggle the path — same graph,
    same seed; the CPU is the bit-exact reference. Expect a CPU cook at 1M+ points to block for
    seconds — that contrast is the demo.
  </p>

  {#if !view.gpuAvailable}
    <div class="notice">
      CPU-only: {view.gpuReason === "" ? "detecting WebGPU…" : view.gpuReason}
    </div>
  {/if}

  <div class="row">
    <span>cook path</span>
    <div class="seg">
      <button class:active={view.mode === "cpu"} onclick={() => pickMode("cpu")}>CPU</button>
      <button
        class:active={view.mode === "gpu"}
        disabled={!view.gpuAvailable}
        onclick={() => pickMode("gpu")}>GPU</button>
    </div>
  </div>

  <label class="row">
    <span>points</span>
    <select
      value={view.count}
      onchange={(e) => host.setCount(Number(e.currentTarget.value))}>
      {#each COUNT_OPTIONS as n (n)}
        <option value={n}>{fmtCount(n)}</option>
      {/each}
    </select>
  </label>

  <label class="row">
    <span>seed</span>
    <input
      class="num"
      type="number"
      step="1"
      bind:value={seedInput}
      onchange={commitSeed} />
  </label>

  <label class="row">
    <span>frequency</span>
    <input
      type="range"
      min="0.02"
      max="0.14"
      step="0.005"
      value={view.frequency}
      onchange={(e) => host.setFrequency(Number(e.currentTarget.value))} />
    <em>{view.frequency.toFixed(3)}</em>
  </label>

  <div class="row">
    <span>determinism</span>
    <button class="wide" disabled={view.cooking} onclick={() => host.rebuild()}>
      recook from cold caches
    </button>
  </div>

  <div class="stats">
    <div class="stat"><span>adapter</span><b>{view.adapter}</b></div>
    <div class="stat"><span>points</span><b>{view.points.toLocaleString()}</b></div>
    <div class="stat"><span>fps</span><b>{view.fps}</b></div>
    <div class="stat">
      <span>cook</span>
      <b>{view.cooking ? "cooking…" : "idle"}</b>
    </div>
    <div class="stat"><span>nodes cooked / cached</span><b>{view.nodes}</b></div>
    <div class="stat"><span>CPU cook wall</span><b>{fmtReport(view.cpu)}</b></div>
    <div class="stat"><span>GPU cook wall</span><b>{fmtReport(view.gpu)}</b></div>
    {#if speedup !== undefined}
      <div class="stat"><span>GPU speedup (best/best)</span><b>×{speedup}</b></div>
    {/if}
    {#if view.gpuStats !== undefined}
      <div class="stat"><span>gpu dispatches</span><b>{view.gpuStats.dispatches}</b></div>
      <div class="stat">
        <span>pipelines compiled / cache hits</span>
        <b>{view.gpuStats.pipelinesCompiled} / {view.gpuStats.pipelineCacheHits}</b>
      </div>
      <div class="stat"><span>gpu fallbacks</span><b>{fmtFallbacks(view.gpuStats.fallbacks)}</b></div>
    {/if}
    <div class="stat"><span>CPU output hash</span><b>{view.cpu.hash ?? "–"}</b></div>
    <div class="stat"><span>GPU output hash</span><b>{view.gpu.hash ?? "–"}</b></div>
    {#if view.deviation !== undefined}
      <div class="stat">
        <span>max |cpu−gpu| ({view.deviation.window.toLocaleString()} pts)</span>
        <b>{view.deviation.maxAbs.toExponential(2)} · {view.deviation.rangeUlp.toFixed(1)} range-ULP</b>
      </div>
    {/if}
    {#if view.error !== undefined}
      <div class="error">{view.error}</div>
    {/if}
  </div>

  <details>
    <summary>tint FieldSpec JSON (what actually cooks)</summary>
    <pre>{view.specJson}</pre>
  </details>

  <p class="note">
    Hashes are FNV-1a over the cooked tint+size bytes. The CPU and GPU hashes differ (float ops
    carry documented per-op budgets; hash/random streams are bit-exact) but each path is
    deterministic: recook from cold caches and the same hash comes back. The deviation line is the
    live parity measurement on this adapter.
  </p>
</div>

<style>
  .panel {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10;
    width: 340px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 14px 16px;
    background: rgba(13, 17, 23, 0.9);
    border: 1px solid #2a3548;
    border-radius: 10px;
    color: #dbe4f0;
    font: 13px/1.45 system-ui, sans-serif;
    backdrop-filter: blur(6px);
  }
  h1 {
    margin: 0 0 2px;
    font-size: 15px;
    font-weight: 600;
    color: #f0f4fa;
  }
  .info {
    margin: 0 0 10px;
    color: #8b98ab;
    font-size: 12px;
  }
  code {
    color: #9ecbff;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .notice {
    margin: 8px 0;
    padding: 8px 10px;
    background: #2b2113;
    border: 1px solid #6b5320;
    border-radius: 6px;
    color: #f0c869;
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }
  .row > span {
    flex: 0 0 84px;
    color: #aeb9c9;
    font-size: 12px;
  }
  .row > em {
    flex: 0 0 44px;
    text-align: right;
    font-style: normal;
    color: #8fd0ff;
    font: 12px ui-monospace, monospace;
  }
  .seg {
    display: flex;
    flex: 1;
    gap: 0;
  }
  .seg button {
    flex: 1;
    padding: 4px 0;
    background: #161d29;
    color: #aeb9c9;
    border: 1px solid #33405a;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  .seg button:first-child {
    border-radius: 5px 0 0 5px;
  }
  .seg button:last-child {
    border-radius: 0 5px 5px 0;
    border-left: none;
  }
  .seg button.active {
    background: #1d3a63;
    color: #cde5ff;
  }
  .seg button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  input[type="range"] {
    flex: 1;
    min-width: 0;
    accent-color: #4c8dff;
  }
  select,
  .num {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
  }
  .num {
    font-family: ui-monospace, monospace;
  }
  button.wide {
    flex: 1;
    padding: 4px 8px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  button.wide:hover:enabled {
    background: #24334c;
  }
  button.wide:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stats {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  .stat {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 2px 0;
  }
  .stat span {
    color: #8b98ab;
    font-size: 12px;
  }
  .stat b {
    color: #b8f5c8;
    font: 12px ui-monospace, monospace;
    font-weight: 400;
    text-align: right;
  }
  .error {
    margin-top: 6px;
    padding: 6px 8px;
    background: #2b1516;
    border: 1px solid #6b2a2e;
    border-radius: 6px;
    color: #ff9ba3;
    font: 11px ui-monospace, monospace;
    white-space: pre-wrap;
  }
  details {
    margin-top: 10px;
    border-top: 1px solid #223047;
    padding-top: 8px;
  }
  summary {
    cursor: pointer;
    color: #aeb9c9;
    font-size: 12px;
    user-select: none;
  }
  pre {
    margin: 8px 0 0;
    padding: 8px;
    max-height: 260px;
    overflow: auto;
    background: #0a0e14;
    border: 1px solid #223047;
    border-radius: 6px;
    color: #9ecbff;
    font: 11px/1.5 ui-monospace, monospace;
  }
  .note {
    margin: 10px 0 0;
    color: #6f7c8f;
    font-size: 11px;
  }
</style>
