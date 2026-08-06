<script lang="ts">
  /**
   * Svelte 5 (runes) panel for the GPU fields demo: cook-path selector
   * (CPU / GPU per-node / GPU fused), point count, seed, frequency, and
   * the fused path's resident budget — plus the live cook report the
   * host pushes through the bridge (per-path cold wall times, output
   * hashes, `CookStats.gpu` counters including the resident-run ones,
   * and the CPU-vs-GPU deviation readout).
   */
  import {
    COOK_PATHS,
    COUNT_OPTIONS,
    PATH_LABEL,
    TIGHT_RESIDENT_BYTES,
    type CookPath,
    type PanelBridge,
    type PanelHost,
    type PanelView,
    type ResidentBudget,
  } from "./view.js";

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
  function fmtFallbacks(f: Record<string, number>): string {
    const parts = Object.entries(f).map(([reason, n]) => `${reason}×${n}`);
    return parts.length > 0 ? parts.join(", ") : "none";
  }
  function speedup(p: CookPath): string | undefined {
    const base = view.reports.cpu.bestMs;
    const mine = view.reports[p].bestMs;
    if (p === "cpu" || base === undefined || mine === undefined || mine <= 0) return undefined;
    return `×${(base / mine).toFixed(1)}`;
  }
  function available(p: CookPath): boolean {
    return p === "cpu" || view.gpuAvailable;
  }

  function pickPath(p: CookPath): void {
    if (p === view.path || view.cooking || !available(p)) return;
    host.setPath(p);
  }

  let seedInput = $state(initial.seed);
  function commitSeed(): void {
    const v = Math.floor(Number(seedInput));
    if (Number.isFinite(v)) host.setSeed(v >>> 0);
  }

  const active = $derived(view.reports[view.path]);
  /**
   * Counters to display. The CPU path has none, and "cook all paths"
   * deliberately ends on CPU (its main-thread block can cost the page
   * its device, so it must not run before the GPU measurements) — so
   * fall back to the most recently measured GPU path rather than
   * blanking the block that carries the whole fusion story.
   */
  const shownGpu = $derived(
    active.gpu ?? view.reports["gpu-fused"].gpu ?? view.reports["gpu-node"].gpu,
  );
  const shownGpuPath = $derived(
    active.gpu !== undefined
      ? undefined
      : view.reports["gpu-fused"].gpu !== undefined
        ? "gpu fused"
        : view.reports["gpu-node"].gpu !== undefined
          ? "gpu per-node"
          : undefined,
  );
  const tightMiB = TIGHT_RESIDENT_BYTES / (1024 * 1024);
</script>

<div class="panel">
  <h1>08 · gpu fields</h1>
  <p class="info">
    <code>setAttribute(wobble) → jitterPoints → transformPoints → setAttribute(tint) →
    setAttribute(psize)</code> over a million-point scatter. All five are fusable node kinds in a
    straight line, so with the plain evaluator the whole chain becomes <b>one device-resident
    run</b>: columns stay in storage buffers and only the terminal reads back. Compare it against
    the same graph cooked per-node on the same device, and against the CPU — the bit-exact
    reference.
  </p>

  {#if !view.gpuAvailable}
    <div class="notice">
      CPU-only: {view.gpuReason === "" ? "detecting WebGPU…" : view.gpuReason}
    </div>
  {/if}

  <div class="row">
    <span>cook path</span>
    <div class="seg">
      {#each COOK_PATHS as p (p)}
        <button
          class:active={view.path === p}
          disabled={!available(p)}
          onclick={() => pickPath(p)}>{PATH_LABEL[p]}</button>
      {/each}
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

  <label class="row">
    <span>resident cap</span>
    <select
      value={view.residentBudget}
      disabled={!view.gpuAvailable}
      onchange={(e) => host.setResidentBudget(e.currentTarget.value as ResidentBudget)}>
      <option value="default">512 MiB (default)</option>
      <option value="tight">{tightMiB} MiB — force run-too-large</option>
    </select>
  </label>

  <div class="row">
    <span>measure</span>
    <button class="wide" disabled={view.cooking} onclick={() => host.measureAll()}>
      cook all paths (cold)
    </button>
  </div>

  <div class="row">
    <span>recook</span>
    <button class="wide" disabled={view.cooking} onclick={() => host.rebuild()}>cold</button>
    <button class="wide" disabled={view.cooking} onclick={() => host.cookWarm()}>warm</button>
  </div>

  <div class="paths">
    {#each COOK_PATHS as p (p)}
      <div class="pathrow" class:sel={view.path === p} class:off={!available(p)}>
        <div class="pl">
          <b>{PATH_LABEL[p]}</b>
          {#if speedup(p) !== undefined}<i>{speedup(p)} vs CPU</i>{/if}
        </div>
        <div class="pv">{fmtMs(view.reports[p].lastMs)} · best {fmtMs(view.reports[p].bestMs)}</div>
        <div class="pm">
          hash {view.reports[p].hash ?? "–"} · nodes {view.reports[p].nodes ?? "–"}
          {#if view.reports[p].warmMs !== undefined}· warm {fmtMs(view.reports[p].warmMs)}{/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="stats">
    <div class="stat"><span>adapter</span><b>{view.adapter}</b></div>
    <div class="stat"><span>points</span><b>{view.points.toLocaleString()}</b></div>
    <div class="stat"><span>fps</span><b>{view.fps}</b></div>
    <div class="stat"><span>cook</span><b>{view.cooking ? "cooking…" : "idle"}</b></div>
    {#if shownGpu !== undefined}
      {#if shownGpuPath !== undefined}
        <div class="stat"><span>counters from</span><b>{shownGpuPath}</b></div>
      {/if}
      <div class="stat">
        <span>resident runs / fused nodes</span>
        <b>{shownGpu.residentRuns} / {shownGpu.fusedNodes}</b>
      </div>
      <div class="stat"><span>readbacks saved</span><b>{shownGpu.readbacksSaved}</b></div>
      <div class="stat"><span>dispatches (member kernels)</span><b>{shownGpu.dispatches}</b></div>
      <div class="stat">
        <span>pipelines compiled / cache hits</span>
        <b>{shownGpu.pipelinesCompiled} / {shownGpu.pipelineCacheHits}</b>
      </div>
      <div class="stat"><span>gpu fallbacks</span><b>{fmtFallbacks(shownGpu.fallbacks)}</b></div>
    {/if}
    {#if view.deviation !== undefined}
      <div class="stat">
        <span>max |cpu−{PATH_LABEL[view.deviation.path]}| ({view.deviation.window.toLocaleString()} pts)</span>
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
    Every wall time is a <b>cold-cache</b> cook (fresh graph). That is deliberate: the terminal node
    holds one memo slot, and a fused cook stores under a run key while a per-node cook stores under
    a node key — so flipping the path always recooks the chain, by design. <code>dispatches</code>
    counts member kernels, not <code>dispatchWorkgroups</code> calls (a chunked kernel still counts
    once). The three hashes differ (float ops carry documented per-op budgets; hash/random streams
    are bit-exact) but each path is deterministic: recook cold and the same hash comes back. A warm
    recook reports <code>nodes 0 / 6</code> in ~0 ms and does no device work at all — the fused run
    comes back from its terminal's single memo entry — so the counters above stay the cold ones. The
    fused chain's three constant <code>transformPoints</code> params each still cost a device column
    and a dispatch, which is why a constant-heavy chain can trail per-node GPU.
  </p>
</div>

<style>
  .panel {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10;
    width: 356px;
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
  .info b {
    color: #b8c6d8;
    font-weight: 600;
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
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
  .seg button:first-child {
    border-radius: 5px 0 0 5px;
  }
  .seg button:last-child {
    border-radius: 0 5px 5px 0;
  }
  .seg button + button {
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
  .paths {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  .pathrow {
    padding: 5px 7px;
    margin: 3px 0;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .pathrow.sel {
    background: #131c2b;
    border-color: #2c3d5c;
  }
  .pathrow.off {
    opacity: 0.4;
  }
  .pl {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .pl b {
    color: #cfe0f5;
    font-size: 12px;
    font-weight: 600;
  }
  .pl i {
    color: #8fd0ff;
    font: 11px ui-monospace, monospace;
    font-style: normal;
  }
  .pv {
    color: #b8f5c8;
    font: 12px ui-monospace, monospace;
  }
  .pm {
    color: #6f7c8f;
    font: 10.5px ui-monospace, monospace;
    word-break: break-all;
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
  .note b {
    color: #8b98ab;
  }
</style>
