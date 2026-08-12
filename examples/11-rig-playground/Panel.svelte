<script lang="ts">
  /**
   * Svelte 5 (runes) control panel for the rig playground. Same host↔panel
   * split as 08-gpu-fields: the host pushes immutable `PanelView`
   * snapshots through the bridge, the panel calls back through
   * `PanelHost`. Nothing here knows what a graph is.
   *
   * The sliders are rendered from `SECTIONS` rather than written out, so
   * a new knob is a line in view.ts and this file never changes.
   */
  import { hashCombine } from "pcg-ts";
  import { untrack } from "svelte";
  import PanelShell from "../shared/PanelShell.svelte";
  import { PART_KINDS, RIG_GROUPS, type PartKind, type RigGroup, type RigParams } from "./rig.js";
  import {
    DISPLAY_SLIDERS,
    GROUP_LABEL,
    SECTIONS,
    SHADING_LABEL,
    type PanelBridge,
    type PanelHost,
    type PanelView,
    type SelectSpec,
    type Shading,
    type SliderSpec,
  } from "./view.js";

  let {
    host,
    bridge,
    initial,
  }: { host: PanelHost; bridge: PanelBridge; initial: PanelView } = $props();

  /**
   * `initial` and `bridge` are setup-time reads, not tracked inputs: the
   * host hands over one starting snapshot and one callback slot, then
   * drives the panel through `publish` for the rest of the page's life.
   * `untrack` states that intent where the compiler can see it — capture
   * now, never resubscribe — instead of reading a prop reactively and
   * discarding the reactivity. It is also what keeps the seeding below
   * honest: every local control starts from this one frozen snapshot.
   */
  const initialView = untrack(() => initial);

  let view = $state(initialView);

  /**
   * Control values are held locally instead of read straight off `view`.
   * The host republishes on every frame (the fps readout moves), so
   * mirroring the snapshot would retype a half-entered seed under the
   * user and snap a slider back to whatever was last cooked.
   *
   * Pushed changes still land: `adopt` copies across only the fields the
   * HOST changed since its previous snapshot. A value it merely echoed
   * back is already what the user set, so leaving it alone is both
   * correct and quiet.
   */
  let params = $state<RigParams>({
    ...initialView.params,
    weights: { ...initialView.params.weights },
  });
  let seedInput = $state(initialView.params.seed);
  let shading = $state<Shading>(initialView.shading);
  let wireframe = $state(initialView.wireframe);
  let grid = $state(initialView.grid);
  let display = $state<Record<DisplayKey, number>>({ ...initialView.display });
  let visible = $state<Record<RigGroup, boolean>>({ ...initialView.visible });

  /** Previous snapshot, for the host-changed diff. Never read in markup. */
  let last: PanelView = initialView;

  function adopt(v: PanelView): void {
    for (const section of SECTIONS) {
      for (const spec of section.sliders) {
        if (v.params[spec.key] !== last.params[spec.key]) params[spec.key] = v.params[spec.key];
      }
      for (const spec of section.selects ?? []) {
        if (v.params[spec.key] !== last.params[spec.key]) params[spec.key] = v.params[spec.key];
      }
    }
    if (v.params.seed !== last.params.seed) {
      params.seed = v.params.seed;
      seedInput = v.params.seed;
    }
    for (const kind of PART_KINDS) {
      if (v.params.weights[kind] !== last.params.weights[kind]) {
        params.weights[kind] = v.params.weights[kind];
      }
    }
    for (const spec of DISPLAY_SLIDERS) {
      if (v.display[spec.key] !== last.display[spec.key]) display[spec.key] = v.display[spec.key];
    }
    if (v.shading !== last.shading) shading = v.shading;
    if (v.wireframe !== last.wireframe) wireframe = v.wireframe;
    if (v.grid !== last.grid) grid = v.grid;
    for (const group of RIG_GROUPS) {
      if (v.visible[group] !== last.visible[group]) visible[group] = v.visible[group];
    }
    last = v;
  }

  untrack(() => {
    bridge.publish = (v: PanelView) => {
      view = v;
      adopt(v);
    };
  });

  /** Desktop width of the card; the shell handles everything else. */
  const PANEL_WIDTH = 340;

  /** Highest weight a part kind can carry. 0 drops it from the mix. */
  const MAX_WEIGHT = 8;

  /**
   * The contract keys sections by title only, so the mix block anchors on
   * that title — and renders standalone if the title ever moves, because
   * a control that silently disappears is worse than one out of place.
   */
  const MIX_SECTION = "components";
  /** A choice from a fixed set — no drag phase, so it commits at once. */
  function applyChoice(spec: SelectSpec, value: string): void {
    params[spec.key] = value as RigParams[typeof spec.key];
    host.setChoice(spec.key, value);
  }

  const mixHasHome = SECTIONS.some((s) => s.title === MIX_SECTION);

  /** Decimals to show, read off the step so the readout never over-reports. */
  function decimals(step: number): number {
    if (step >= 1) return 0;
    const text = String(step);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
  }
  function fmtValue(spec: SliderSpec): string {
    return `${params[spec.key].toFixed(decimals(spec.step))}${spec.unit ?? ""}`;
  }
  function fmtInt(n: number): string {
    return n.toLocaleString();
  }

  /** Dragging only moves the readout; the host is told on release. */
  function dragNumber(spec: SliderSpec, text: string): void {
    const n = Number(text);
    if (Number.isFinite(n)) params[spec.key] = n;
  }
  function commitNumber(spec: SliderSpec, text: string): void {
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    params[spec.key] = n;
    host.setNumber(spec.key, n);
  }

  function applySeed(seed: number): void {
    params.seed = seed;
    seedInput = seed;
    host.setSeed(seed);
  }
  function commitSeed(): void {
    const n = Math.floor(Number(seedInput));
    if (Number.isFinite(n)) applySeed(n >>> 0);
  }
  function randomizeSeed(): void {
    // Nothing in this repo calls Math.random — a fresh seed comes from the
    // library's own hash, mixed with the clock so two clicks differ. Kept
    // to four digits so it stays readable in the field, and nudged off the
    // current seed on a collision so the button is never a no-op.
    const next = hashCombine(params.seed, Date.now() >>> 0) % 10_000;
    applySeed(next === params.seed ? (next + 1) % 10_000 : next);
  }

  function commitWeight(kind: PartKind, text: string): void {
    const n = Math.min(MAX_WEIGHT, Math.max(0, Math.round(Number(text))));
    if (!Number.isFinite(n)) return;
    params.weights[kind] = n;
    host.setWeight(kind, n);
  }

  function applyShading(next: Shading): void {
    shading = next;
    host.setShading(next);
  }
  function applyWireframe(on: boolean): void {
    wireframe = on;
    host.setWireframe(on);
  }
  /** Geometry proportions: no drag phase to coalesce, so commit live. */
  function applyDisplay(spec: DisplaySliderSpec, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    display[spec.key] = value;
    host.setDisplayNumber(spec.key, value);
  }

  function applyGrid(on: boolean): void {
    grid = on;
    host.setGrid(on);
  }
  function applyVisible(group: RigGroup, on: boolean): void {
    visible[group] = on;
    host.setVisible(group, on);
  }

  // The contract exports the label map but no order array; its own keys
  // are the option list, so the select can never drift from the type.
  const SHADING_OPTIONS = Object.keys(SHADING_LABEL) as Shading[];
</script>

<!-- The part mix lives in a snippet because it renders in one of two
     places: inside the components section, or on its own if that section
     is ever renamed. -->
{#snippet mix()}
  <div class="mix">
    <div class="mixhead">mix — relative weights, 0 disables</div>
    <div class="mixrow">
      {#each PART_KINDS as kind (kind)}
        <label class="weight">
          <span>{kind}</span>
          <input
            class="num"
            type="number"
            min="0"
            max={MAX_WEIGHT}
            step="1"
            value={params.weights[kind]}
            onchange={(e) => commitWeight(kind, e.currentTarget.value)} />
        </label>
      {/each}
    </div>
  </div>
{/snippet}

<!-- The cook flag rides in the shell's title bar, beside the title and
     ahead of the chevron — written on one line so no whitespace text node
     lands in front of the span's own 8px gap. -->
{#snippet cookFlag()}{#if view.cooking}<span class="cooking">cooking…</span>{/if}{/snippet}

<PanelShell title="11 · rig playground" width={PANEL_WIDTH} badge={cookFlag}>
  <p class="info">
    One graph, five branches: a spline <b>spine</b> pushed around by noise, <b>components</b>
    scattered along it in noise clusters, <b>chains</b> holding it up, and two kinds of hanging
    <b>cable</b>. Every knob recooks the whole rig; the same seed always rebuilds the same rig.
  </p>

  <div class="row">
    <span>seed</span>
    <input class="num" type="number" step="1" bind:value={seedInput} onchange={commitSeed} />
    <button class="wide" onclick={randomizeSeed}>randomize</button>
  </div>

  {#each SECTIONS as section (section.title)}
    <div class="group">
      <h2>{section.title}</h2>

      {#if section.title === MIX_SECTION}{@render mix()}{/if}

      {#each section.selects ?? [] as spec (spec.key)}
        <label class="row">
          <span>{spec.label}</span>
          <select
            value={params[spec.key]}
            onchange={(e) => applyChoice(spec, e.currentTarget.value)}>
            {#each spec.options as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
      {/each}

      {#each section.sliders as spec (spec.key)}
        <label class="row">
          <span>{spec.label}</span>
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={params[spec.key]}
            oninput={(e) => dragNumber(spec, e.currentTarget.value)}
            onchange={(e) => commitNumber(spec, e.currentTarget.value)} />
          <em>{fmtValue(spec)}</em>
        </label>
      {/each}
    </div>
  {/each}

  {#if !mixHasHome}
    <div class="group">
      <h2>mix</h2>
      {@render mix()}
    </div>
  {/if}

  <div class="group">
    <h2>display</h2>

    <label class="row">
      <span>shading</span>
      <select
        value={shading}
        onchange={(e) => applyShading(e.currentTarget.value as Shading)}>
        {#each SHADING_OPTIONS as opt (opt)}
          <option value={opt}>{SHADING_LABEL[opt]}</option>
        {/each}
      </select>
    </label>

    <div class="row">
      <span>draw</span>
      <label class="check">
        <input
          type="checkbox"
          checked={wireframe}
          onchange={(e) => applyWireframe(e.currentTarget.checked)} />
        <span>wireframe</span>
      </label>
      <label class="check">
        <input type="checkbox" checked={grid} onchange={(e) => applyGrid(e.currentTarget.checked)} />
        <span>grid</span>
      </label>
    </div>

    {#each DISPLAY_SLIDERS as spec (spec.key)}
      <label class="row">
        <span>{spec.label}</span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={display[spec.key]}
          oninput={(e) => applyDisplay(spec, e.currentTarget.value)} />
        <em>{display[spec.key].toFixed(spec.step < 0.01 ? 3 : 2)}{spec.unit ?? ""}</em>
      </label>
    {/each}

    <div class="row stack">
      <span>show</span>
      <div class="checks">
        {#each RIG_GROUPS as group (group)}
          <label class="check">
            <input
              type="checkbox"
              checked={visible[group]}
              onchange={(e) => applyVisible(group, e.currentTarget.checked)} />
            <span>{GROUP_LABEL[group]}</span>
          </label>
        {/each}
      </div>
    </div>
  </div>

  <!-- `busy` fades the stats while a cook is in flight; it sits on this
       block rather than on the panel so the rule stays scoped to the
       component that renders the numbers. -->
  <div class="group stats" class:busy={view.cooking}>
    <h2>stats</h2>
    <div class="stat"><span>fps</span><b>{view.fps}</b></div>
    <div class="stat"><span>instances</span><b>{fmtInt(view.total)}</b></div>
    {#each RIG_GROUPS as group (group)}
      <div class="stat"><span>{GROUP_LABEL[group]}</span><b>{fmtInt(view.counts[group] ?? 0)}</b></div>
    {/each}
    <div class="stat"><span>spine points</span><b>{fmtInt(view.counts.spinePoints ?? 0)}</b></div>
    <div class="stat">
      <span>cook</span>
      <b>{view.cooking ? "cooking…" : `${view.cookMs.toFixed(1)} ms`}</b>
    </div>
    <div class="stat"><span>draw calls</span><b>{fmtInt(view.drawCalls)}</b></div>
    {#if view.notice !== undefined}
      <p class="note">{view.notice}</p>
    {/if}
    {#if view.error !== undefined}
      <div class="error">{view.error}</div>
    {/if}
  </div>
</PanelShell>

<style>
  /* Chrome (the card, the title bar, the narrow-screen bottom sheet) lives
     in ../shared/PanelShell.svelte; what follows styles this panel's own
     controls only. */
  h2 {
    margin: 0 0 4px;
    color: #cfe0f5;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .cooking {
    margin-left: 8px;
    color: #f0c869;
    font: 11px ui-monospace, monospace;
    font-weight: 400;
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
  .group {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }
  .row.stack {
    align-items: flex-start;
  }
  .row > span {
    flex: 0 0 84px;
    color: #aeb9c9;
    font-size: 12px;
  }
  .row > em {
    flex: 0 0 56px;
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
  button.wide {
    flex: 0 0 auto;
    padding: 4px 10px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  button.wide:hover {
    background: #24334c;
  }
  .mix {
    margin: 6px 0 10px;
    padding: 8px;
    background: #111823;
    border: 1px solid #223047;
    border-radius: 6px;
  }
  .mixhead {
    margin-bottom: 6px;
    color: #8b98ab;
    font-size: 11.5px;
  }
  .mixrow {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .weight {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .weight > span {
    color: #aeb9c9;
    font-size: 11px;
  }
  .weight .num {
    flex: 0 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .check {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    color: #aeb9c9;
    font-size: 12px;
    cursor: pointer;
  }
  .checks {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 10px;
  }
  input[type="checkbox"] {
    margin: 0;
    accent-color: #4c8dff;
  }
  /* A cook in flight fades the numbers it is about to replace, so a stale
     readout never reads as a settled one. */
  .stats.busy {
    opacity: 0.55;
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
  .note {
    margin: 8px 0 0;
    color: #6f7c8f;
    font-size: 11px;
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
</style>
