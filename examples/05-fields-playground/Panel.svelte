<script lang="ts">
  /**
   * Svelte 5 (runes) control panel for the fields playground: edits the
   * noise parameters, derives the FieldSpec JSON live, and reports every
   * change to the host via `onSpec`.
   */
  import PanelShell from "../shared/PanelShell.svelte";
  import { NOISE_OPTIONS, buildSpec, isFbm, type PlaygroundParams } from "./spec.js";

  let { onSpec }: { onSpec: (spec: object) => void } = $props();

  /** Desktop width of the card; the shell handles everything else. */
  const PANEL_WIDTH = 320;

  let noise = $state("fbm-perlin");
  let frequency = $state(0.35);
  let octaves = $state(4);
  let outMin = $state(0);
  let outMax = $state(1);
  let seed = $state(1);

  const params = $derived<PlaygroundParams>({ noise, frequency, octaves, outMin, outMax, seed });
  const spec = $derived(buildSpec(params));
  const json = $derived(JSON.stringify(spec, null, 2));

  $effect(() => {
    onSpec(spec);
  });

  let copied = $state(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(json);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<PanelShell title="05 · fields playground" width={PANEL_WIDTH}>
  <p class="info">
    Compose a field as declarative JSON, build it with <code>fieldFromJson</code>, and watch it
    evaluate over a 192×192 grid.
  </p>

  <label class="row">
    <span>noise</span>
    <select bind:value={noise}>
      {#each NOISE_OPTIONS as opt (opt.id)}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>
  </label>

  <label class="row">
    <span>frequency</span>
    <input type="range" min="0.05" max="1.5" step="0.01" bind:value={frequency} />
    <em>{frequency.toFixed(2)}</em>
  </label>

  <label class="row" class:disabled={!isFbm(noise)}>
    <span>octaves</span>
    <input type="range" min="1" max="8" step="1" disabled={!isFbm(noise)} bind:value={octaves} />
    <em>{octaves}</em>
  </label>

  <div class="row">
    <span>out range</span>
    <input class="num" type="number" step="0.5" bind:value={outMin} />
    <input class="num" type="number" step="0.5" bind:value={outMax} />
  </div>

  <label class="row">
    <span>seed</span>
    <input class="num" type="number" step="1" bind:value={seed} />
  </label>

  <div class="json-head">
    <span>FieldSpec JSON</span>
    <button onclick={copy}>{copied ? "copied!" : "copy"}</button>
  </div>
  <pre>{json}</pre>

  <p class="note">
    Paste this spec into <code>fieldFromJson(spec)</code> anywhere — node params, density fields,
    terrain heights — and it evaluates identically.
  </p>
</PanelShell>

<style>
  /* Chrome (the card, the title bar, the narrow-screen bottom sheet) lives
     in ../shared/PanelShell.svelte; what follows styles this panel's own
     controls only. */
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
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }
  .row.disabled {
    opacity: 0.45;
  }
  .row > span {
    flex: 0 0 78px;
    color: #aeb9c9;
    font-size: 12px;
  }
  .row > em {
    flex: 0 0 40px;
    text-align: right;
    font-style: normal;
    color: #8fd0ff;
    font: 12px ui-monospace, monospace;
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
  .json-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #223047;
    color: #aeb9c9;
    font-size: 12px;
  }
  button {
    padding: 2px 10px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
  button:hover {
    background: #24334c;
  }
  pre {
    margin: 8px 0 0;
    padding: 8px;
    max-height: 300px;
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
