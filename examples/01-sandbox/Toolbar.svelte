<script lang="ts">
  /** Top strip: graph picker, seed control, layout/export/import, and the live cook status line. */
  import { PRESET_GROUPS, PRESETS } from "../shared/presets.js";
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
    dock,
    onDock,
    onFit,
    onToggle,
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
    /** Which edge the dock sits on. */
    dock: "bottom" | "left" | "right";
    onDock: (dock: "bottom" | "left" | "right") => void;
    /** Frame every node in the canvas. */
    onFit: () => void;
    /** Collapse/expand the dock; wired to the title on narrow screens. */
    onToggle: () => void;
  } = $props();

  const byGroup = $derived(
    PRESET_GROUPS.map((group) => ({ group, items: PRESETS.filter((p) => p.group === group) })),
  );

  const statusText = $derived(
    status === null
      ? "cooking…"
      : `cook ${status.elapsedMs.toFixed(1)} ms · ${status.cooked} cooked / ${status.cached} cached · ` +
          `${status.points} pts · ${status.instances} inst · hash ${status.hash}` +
          (status.errors.length > 0 ? ` · ${status.errors.length} error(s)` : ""),
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
  <span class="dock" role="group" aria-label="dock position">
    {#each [["left", "◧"], ["bottom", "▤"], ["right", "◨"]] as [side, glyph] (side)}
      <button
        class="side"
        class:on={dock === side}
        aria-pressed={dock === side}
        title="dock {side}"
        onclick={() => onDock(side as "bottom" | "left" | "right")}>{glyph}</button>
    {/each}
  </span>
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
  .dock {
    display: flex;
    gap: 2px;
  }
  .side {
    padding: 3px 7px;
    font-size: 13px;
    line-height: 1;
  }
  .side.on {
    background: #24344d;
    border-color: #35507a;
    color: #eaf1fa;
  }
  .status {
    flex: 1;
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
