<script lang="ts">
  /** Top strip: graph picker, seed control, layout/export/import, and the live cook status line. */
  import { PRESET_GROUPS, PRESETS } from "../shared/presets.js";
  import {
    COOK_PATHS,
    cookPathLabel,
    fmtFallbacks,
    splitFallbacks,
    type CookPath,
  } from "../shared/gpu.js";
  import type { GpuState } from "./main.js";
  import type { CookStatus } from "./controller.js";

  let {
    seed,
    status,
    collapsed,
    preset,
    onPreset,
    onSeed,
    onExport,
    onImport,
    onLayout,
    viewLabel,
    onCycleView,
    onFit,
    host,
    onToggle,
    onFrame,
    onCookPath,
  }: {
    seed: number;
    status: CookStatus | null;
    /** Whether the dock is collapsed to this bar (narrow screens only). */
    collapsed: boolean;
    /** Loaded corpus graph, or "" for the built-in starter. */
    preset: string;
    onPreset: (name: string) => void;
    onSeed: (seed: number) => void;
    onExport: () => void;
    onImport: () => void;
    onLayout: () => void;
    /** Name of the current view, and the control that cycles it. */
    viewLabel: string;
    onCycleView: () => void;
    /** Readouts the host owns rather than the cook: frame rate, what drew, the device. */
    host: { fps: string; drew: string; gpu: GpuState };
    /** Choose the cook path. The graph is unchanged; only how it cooks moves. */
    onCookPath: (path: CookPath) => void;
    /** Frame every node in the canvas. */
    onFit: () => void;
    /** Frame the SCENE camera on what the graph made — the other half of `onFit`. */
    onFrame: () => void;
    /** Collapse/expand the dock; wired to the title on narrow screens. */
    onToggle: () => void;
  } = $props();

  const byGroup = $derived(
    PRESET_GROUPS.map((group) => ({ group, items: PRESETS.filter((p) => p.group === group) })),
  );

  /**
   * One line rather than the floating stats card the page used to carry.
   * Everything on it was already here except the frame rate and what the
   * outputs drew, and a card that has to be hidden whenever the graph is
   * up is a card in the wrong place.
   */
  /**
   * Device counters, appended only on a GPU path. `stats.gpu` is present
   * exactly when a resolver cooked, so its absence is the CPU path
   * rather than a device that did nothing — worth keeping distinct,
   * because "no dispatches" is a real and interesting GPU result.
   */
  const gpuText = $derived.by(() => {
    const g = status?.gpu;
    if (!g) return "";
    const { real, partial } = splitFallbacks(g.fallbacks);
    const fallbacks = fmtFallbacks(real);
    return (
      ` · ${g.dispatches} disp · ${g.residentRuns} run / ${g.fusedNodes} fused · ` +
      `${g.readbacksSaved} readbacks saved` +
      // Reported apart from the fallbacks, because it is not one: the
      // planner dropped a member and fused the suffix after it.
      (partial > 0 ? ` · ${partial}× suffix-fused` : "") +
      (fallbacks === "none" ? "" : ` · fell back: ${fallbacks}`)
    );
  });

  const statusText = $derived(
    status === null
      ? "cooking…"
      : `${host.fps} fps · cook ${status.elapsedMs.toFixed(1)} ms · ${status.cooked} cooked / ${status.cached} cached · ` +
          `${status.outputs} out · ${status.points} pts · ${status.instances} inst · ${host.drew} · hash ${status.hash}` +
          gpuText +
          (status.errors.length > 0 ? ` · ${status.errors.length} error(s)` : ""),
  );

  /**
   * Why a device path is unavailable, or which adapter is behind it.
   * The reason is shown verbatim: "no WebGPU" and "requestDevice() threw"
   * are different problems and the page should not flatten them.
   */
  const gpuTitle = $derived(
    host.gpu.error !== null
      ? `no device — ${host.gpu.error}`
      : host.gpu.ready
        ? `${host.gpu.label} — the two device paths agree bit for bit, so the hash holds across them. ` +
          `The CPU hash differs: GPU floats are not byte-identical to CPU floats.`
        : "probing for a WebGPU adapter…",
  );

  function commitSeed(e: Event): void {
    const v = Math.floor((e.currentTarget as HTMLInputElement).valueAsNumber);
    if (Number.isFinite(v)) onSeed(v >>> 0);
  }

  function onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }
</script>

<div class="toolbar" class:collapsed>
  <!-- The title doubles as the dock's collapse toggle on narrow screens.
       Deliberately not a <button>: the capture tooling clicks buttons by
       substring, and the chevron is display: none at desktop widths so
       the bar stays pixel-identical there. -->
  <span
    class="title"
    role="button"
    tabindex="0"
    aria-expanded={!collapsed}
    onclick={onToggle}
    onkeydown={onTitleKeydown}
  >01 · sandbox<span class="chevron" class:flip={collapsed}>▾</span></span>
  <label class="graph">
    graph
    <select value={preset} onchange={(e) => onPreset(e.currentTarget.value)}>
      <option value="">starter graph</option>
      {#each byGroup as { group, items } (group)}
        <optgroup label={group}>
          {#each items as p (p.name)}
            <option value={p.name} title={p.description}>{p.title}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </label>
  <label>
    seed
    <input type="number" step="1" min="0" value={seed} onchange={commitSeed} />
  </label>
  <button onclick={onLayout} title="re-run the deterministic topological layout">layout</button>
  <button onclick={onFit} title="frame every node (the canvas pans with the right button and zooms on the wheel)">fit</button>
  <button onclick={onFrame} title="point the camera at what the graph made (F) — done automatically whenever a graph loads">frame</button>
  <button class="view" onclick={onCycleView} title="cycle the view (space, shift-space to go back) — hold shift to fly the scene through the graph"
    >view · {viewLabel}</button>
  <label class="path" class:off={!host.gpu.ready} title={gpuTitle}>
    cook
    <select
      value={host.gpu.path}
      onchange={(e) => onCookPath(e.currentTarget.value as CookPath)}
    >
      {#each COOK_PATHS as p (p)}
        <option value={p} disabled={p !== "cpu" && !host.gpu.ready}>{cookPathLabel(p)}</option>
      {/each}
    </select>
  </label>
  <button onclick={onExport} title="serializeGraph → JSON">export</button>
  <button onclick={onImport} title="paste JSON → deserializeGraph">import</button>
  <span class="status" class:err={status !== null && status.errors.length > 0}>{statusText}</span>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #223047;
    flex: 0 0 auto;
    /* Wraps at ANY width, not just on phones. A side dock is 420-640px
       wide and the dock is `overflow: hidden` — without this the row runs
       past the edge and the controls at its end are simply gone, which
       included the buttons for getting back out of a side dock. */
    flex-wrap: wrap;
  }
  .title {
    font-weight: 600;
    color: #f0f4fa;
    white-space: nowrap;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #aeb9c9;
    font-size: 12px;
  }
  input[type="number"] {
    width: 78px;
    padding: 3px 6px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px ui-monospace, monospace;
  }
  select {
    max-width: 260px;
    padding: 3px 6px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
  }
  /* The picker is the bar's primary control, so it keeps its width while
     the status line (flex: 1) absorbs the slack. */
  .graph {
    flex: 0 0 auto;
  }
  .path select {
    max-width: none;
  }
  /* Dimmed rather than hidden while there is no device: the control has
     to stay visible for its tooltip to carry the reason there is none. */
  .path.off {
    opacity: 0.55;
  }
  button {
    padding: 3px 12px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  button:hover {
    background: #24334c;
  }
  .view {
    color: #b8f5c8;
    border-color: #2f4a3c;
    background: #16241d;
  }
  .view:hover {
    background: #1d3126;
  }
  .status {
    flex: 1 1 100%;
    min-width: 0;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #8fd0ff;
    font: 11px ui-monospace, monospace;
  }
  .status.err {
    color: #ff9ca8;
  }
  /* Desktop: the chevron does not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .chevron {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in examples/shared/mobile.ts */
    .toolbar {
      /* Seed, buttons, and status wrap to fit a phone width. */
      flex-wrap: wrap;
    }
    /* Collapsed, the bar shows only the title — clipping the wrapped rows
       at the dock's 44px would leave a sliver of the second row visible.
       display: none keeps the elements in the DOM, so the capture
       tooling's readiness probe (`.toolbar .status` textContent) still
       reads; captures also never run at narrow widths. */
    .toolbar.collapsed label,
    .toolbar.collapsed button,
    .toolbar.collapsed .status {
      display: none;
    }
    .title {
      cursor: pointer;
    }
    .chevron {
      display: inline-block;
      margin-left: 6px;
      color: #8b98ab;
      transition: transform 0.2s;
    }
    .chevron.flip {
      transform: rotate(180deg);
    }
  }
</style>
