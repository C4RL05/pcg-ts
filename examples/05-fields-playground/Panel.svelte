<script lang="ts">
  /**
   * Svelte 5 (runes) control panel for the fields playground: edits the
   * noise parameters, derives the FieldSpec JSON live, and reports every
   * change to the host via `onSpec`.
   */
  import { narrowScreen } from "../shared/mobile.js";
  import { NOISE_OPTIONS, buildSpec, isFbm, type PlaygroundParams } from "./spec.js";

  let { onSpec }: { onSpec: (spec: object) => void } = $props();

  /**
   * On narrow screens the fixed side panel becomes a full-width bottom
   * sheet, collapsed to its 48px title bar by default so the 3D content
   * keeps the screen. The same treatment is duplicated in
   * 08-gpu-fields/Panel.svelte on purpose — two copies are cheaper than a
   * shared component's indirection, but a third panel should trigger
   * extraction. Entering the narrow range collapses, leaving it clears the
   * collapse, so rotating a phone never strands the panel in a stale state.
   */
  let collapsed = $state(narrowScreen().matches);

  $effect(() => {
    const mql = narrowScreen();
    const onChange = (e: MediaQueryListEvent): void => {
      collapsed = e.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  function toggleCollapsed(): void {
    collapsed = !collapsed;
  }
  function onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      collapsed = !collapsed;
    }
  }

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

<div class="panel" class:collapsed>
  <!-- The title doubles as the bottom sheet's collapse toggle on narrow
       screens; it stays a plain heading visually on desktop. Deliberately
       not a <button>: the capture tooling clicks buttons by substring. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <h1
    role="button"
    tabindex="0"
    aria-expanded={!collapsed}
    onclick={toggleCollapsed}
    onkeydown={onTitleKeydown}
  >
    05 · fields playground<span class="chevron">▾</span>
  </h1>
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
</div>

<style>
  .panel {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10;
    width: 320px;
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
  /* Desktop: the chevron does not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .chevron {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in examples/shared/mobile.ts */
    .panel {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      z-index: 12;
      max-height: 50vh;
      max-height: 50dvh; /* dvh where supported; vh fallback above */
      border-radius: 12px 12px 0 0;
      border-width: 1px 0 0 0;
      padding: 0 16px calc(10px + env(safe-area-inset-bottom));
      transition: max-height 0.25s ease;
      overscroll-behavior: contain;
    }
    .panel h1 {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0 -16px;
      padding: 13px 16px;
      line-height: 22px; /* 13 + 22 + 13 = the 48px collapsed bar */
      background: rgba(13, 17, 23, 0.96);
      cursor: pointer;
    }
    .chevron {
      display: inline-block;
      float: right;
      color: #8b98ab;
      transition: transform 0.2s;
    }
    /* Collapse clips via max-height + overflow, never {#if}: the capture
       tooling's readiness probes scrape panel text and need the DOM
       rendered whether the sheet is open or shut. */
    .panel.collapsed {
      max-height: calc(48px + env(safe-area-inset-bottom));
      overflow: hidden;
    }
    .panel.collapsed .chevron {
      transform: rotate(180deg);
    }
  }
</style>
