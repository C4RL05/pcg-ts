<script lang="ts">
  /** Top strip: seed control, layout/export/import, and the live cook status line. */
  import type { CookStatus } from "./controller.js";

  let {
    seed,
    status,
    onSeed,
    onExport,
    onImport,
    onLayout,
  }: {
    seed: number;
    status: CookStatus | null;
    onSeed: (seed: number) => void;
    onExport: () => void;
    onImport: () => void;
    onLayout: () => void;
  } = $props();

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
</script>

<div class="toolbar">
  <span class="title">06 · graph editor</span>
  <label>
    seed
    <input type="number" step="1" min="0" value={seed} onchange={commitSeed} />
  </label>
  <button onclick={onLayout} title="re-run the deterministic topological layout">layout</button>
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
</style>
