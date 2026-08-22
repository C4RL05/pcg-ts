<script lang="ts" generics="P extends Record<string, unknown>">
  /**
   * Renders a list of {@link ControlSection}s and reports every edit as a
   * {@link ControlCommit}. The panel decides what a commit means; this
   * component only knows how a knob looks and when it has moved.
   *
   * A PURE VIEW. `values` is the panel's own record and this component
   * holds no copy of it: it renders what it is given and hands edits
   * back. Two callbacks rather than one, because a drag and a release
   * are different events to whoever is listening — `onInput` fires for
   * every tick of a gesture and is where the readout comes from,
   * `onCommit` fires once when the user is done and is where a recook
   * belongs. `applyCommit` in controls.ts is the body of both.
   *
   * It also owns the control CSS. `PanelShell` deliberately kept rows,
   * sliders and readouts out of the shell because Svelte scopes styles
   * to the component that renders the markup — which was right while
   * every panel wrote its own rows. Now that the markup is shared, the
   * styles come with it.
   */
  import type { Snippet } from "svelte";
  import NumberBox from "./NumberBox.svelte";
  import {
    clampToRange,
    formatNumber,
    type Control,
    type ControlCommit,
    type ControlSection,
    type FlagGridControl,
    type FlagsControl,
    type FlagKey,
    type NumberControl,
    type NumberGridControl,
    type SelectControl,
    type SliderControl,
    type TextControl,
    type VectorControl,
  } from "./controls.js";

  let {
    sections,
    values,
    onInput,
    onCommit,
    tab = $bindable(""),
    tabbed = false,
    extra,
  }: {
    sections: readonly ControlSection<P>[];
    /** The panel's live values record. Rendered, never copied. */
    values: P;
    /** Every tick of an edit, including mid-drag. */
    onInput: (commit: ControlCommit<P>) => void;
    /** The edit is settled — act on it. */
    onCommit: (commit: ControlCommit<P>) => void;
    /**
     * Active section title. Bindable so a panel can steer it — the rig's
     * clipboard fallback switches to the tab showing the JSON.
     */
    tab?: string;
    /**
     * Show a tab bar and render one section at a time. Off by default: a
     * panel with a handful of controls gains nothing from tabs. Fifty
     * knobs in one scroll is the case that wants them.
     */
    tabbed?: boolean;
    /** Extra content for a section, rendered above its controls. */
    extra?: Snippet<[string]>;
  } = $props();

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  const asNumber = (key: string): number => (typeof values[key] === "number" ? values[key] : 0);
  const asString = (key: string): string => (typeof values[key] === "string" ? values[key] : "");
  const asFlag = (key: string): boolean => values[key] === true;
  const asNumbers = (key: string): Record<string, number> =>
    isRecord(values[key]) ? (values[key] as Record<string, number>) : {};
  const asFlags = (key: string): Record<string, boolean> =>
    isRecord(values[key]) ? (values[key] as Record<string, boolean>) : {};
  const asVector = (key: string): number[] =>
    Array.isArray(values[key]) ? (values[key] as number[]) : [];

  /**
   * A drag moves the readout; the host hears about it on release, so one
   * gesture is one commit rather than one per pixel. `live` controls opt
   * out — see the flag's comment in controls.ts.
   */
  function slide(control: SliderControl<P>, raw: string, settled: boolean): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const commit: ControlCommit<P> = { kind: "slider", control, key: control.key, value };
    onInput(commit);
    if (settled || control.live === true) onCommit(commit);
  }

  function typeNumber(control: NumberControl<P>, entered: number): void {
    if (!Number.isFinite(entered)) return;
    const value = clampToRange(
      entered,
      control.min ?? -Infinity,
      control.max ?? Infinity,
      control.step ?? 0,
    );
    const commit: ControlCommit<P> = { kind: "number", control, key: control.key, value };
    onInput(commit);
    onCommit(commit);
  }

  function typeText(control: TextControl<P>, value: string): void {
    const commit: ControlCommit<P> = { kind: "text", control, key: control.key, value };
    onInput(commit);
    onCommit(commit);
  }

  /** One component changes; the commit carries the whole vector. */
  function typeVector(control: VectorControl<P>, index: number, entered: number): void {
    if (!Number.isFinite(entered)) return;
    const value = [...asVector(control.key)];
    value[index] = clampToRange(
      entered,
      control.min ?? -Infinity,
      control.max ?? Infinity,
      control.step ?? 0,
    );
    const commit: ControlCommit<P> = { kind: "vector", control, key: control.key, value };
    onInput(commit);
    onCommit(commit);
  }

  function choose(control: SelectControl<P>, value: string): void {
    const commit: ControlCommit<P> = { kind: "select", control, key: control.key, value };
    onInput(commit);
    onCommit(commit);
  }

  function flag(control: FlagsControl<P>, key: FlagKey<P>, value: boolean): void {
    const commit: ControlCommit<P> = { kind: "flag", control, key, value };
    onInput(commit);
    onCommit(commit);
  }

  function flagGrid(control: FlagGridControl<P>, item: string, value: boolean): void {
    const commit: ControlCommit<P> = { kind: "flagGrid", control, key: control.key, item, value };
    onInput(commit);
    onCommit(commit);
  }

  function numberGrid(control: NumberGridControl<P>, item: string, entered: number): void {
    if (!Number.isFinite(entered)) return;
    const value = clampToRange(entered, control.min, control.max, control.step);
    const commit: ControlCommit<P> = { kind: "numberGrid", control, key: control.key, item, value };
    onInput(commit);
    onCommit(commit);
  }

  /**
   * How much of the track is filled, as a percentage.
   *
   * A native range keeps its value out of CSS reach — there is no
   * `::-webkit-slider-progress`, and `::-moz-range-progress` exists on
   * one engine only — so the fill is a background layer on the input
   * sized from this custom property. Set on the element because that is
   * the only place the value exists. Clamped: a param whose value has
   * drifted outside its own min/max (a graph edited by hand, a spec
   * loosened after the fact) would otherwise paint past the track.
   */
  function fillPercent(control: SliderControl<P>): string {
    const span = control.max - control.min;
    if (span <= 0) return "0%";
    const t = (asNumber(control.key) - control.min) / span;
    return `${Math.min(1, Math.max(0, t)) * 100}%`;
  }

  /** Stable per-control key for the {#each} blocks. */
  function idOf(control: Control<P>, index: number): string {
    return control.kind === "flags" ? `flags:${index}` : `${control.kind}:${control.key}`;
  }
</script>

{#if tabbed}
  <div class="tabs" role="tablist" aria-label="controls">
    {#each sections as section (section.title)}
      <button
        class="tab"
        class:on={tab === section.title}
        role="tab"
        aria-selected={tab === section.title}
        onclick={() => (tab = section.title)}>{section.title}</button>
    {/each}
  </div>
{/if}

{#each sections as section (section.title)}
  <div class="group" hidden={tabbed && tab !== section.title}>
    <!-- Untabbed, the title has nowhere else to go: the tab bar is what
         normally carries it, so without one a section would be an
         unlabelled run of rows. A panel that wants no heading gives the
         section an empty title. -->
    {#if !tabbed && section.title !== ""}
      <h2>{section.title}</h2>
    {/if}
    {@render extra?.(section.title)}

    {#each section.controls as control, index (idOf(control, index))}
      {#if control.kind === "slider"}
        <label class="row" title={control.description}>
          <span>{control.label}</span>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={asNumber(control.key)}
            style="--p: {fillPercent(control)}"
            oninput={(e) => slide(control, e.currentTarget.value, false)}
            onchange={(e) => slide(control, e.currentTarget.value, true)} />
          <em>{formatNumber(asNumber(control.key), control.step, control.unit)}</em>
        </label>
      {:else if control.kind === "number"}
        <label class="row" title={control.description}>
          <span>{control.label}</span>
          <NumberBox
            min={control.min}
            max={control.max}
            step={control.step ?? "any"}
            value={asNumber(control.key)}
            ariaLabel={control.label}
            onCommit={(v) => typeNumber(control, v)} />
          {#if control.unit !== undefined}<em class="unit">{control.unit}</em>{/if}
        </label>
      {:else if control.kind === "text"}
        <label class="row" title={control.description}>
          <span>{control.label}</span>
          <input
            class="num"
            type="text"
            value={asString(control.key)}
            onchange={(e) => typeText(control, e.currentTarget.value)} />
        </label>
      {:else if control.kind === "vector"}
        <div class="row" title={control.description}>
          <span>{control.label}</span>
          <div class="vec">
            {#each asVector(control.key) as component, i (i)}
              <NumberBox
                min={control.min}
                max={control.max}
                step={control.step ?? "any"}
                value={component}
                ariaLabel="{control.label} {i}"
                onCommit={(v) => typeVector(control, i, v)} />
            {/each}
          </div>
        </div>
      {:else if control.kind === "select"}
        <label class="row" title={control.description}>
          <span>{control.label}</span>
          <select
            value={asString(control.key)}
            onchange={(e) => choose(control, e.currentTarget.value)}>
            {#each control.options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      {:else if control.kind === "flags"}
        <div class="row" title={control.description}>
          <span>{control.label}</span>
          {#each control.items as item (item.key)}
            <label class="check">
              <input
                type="checkbox"
                checked={asFlag(item.key)}
                onchange={(e) => flag(control, item.key, e.currentTarget.checked)} />
              <span>{item.label}</span>
            </label>
          {/each}
        </div>
      {:else if control.kind === "flagGrid"}
        <div class="row stack" title={control.description}>
          <span>{control.label}</span>
          <div class="checks" style="--columns: {control.columns ?? 2}">
            {#each control.items as item (item.item)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={asFlags(control.key)[item.item] === true}
                  onchange={(e) => flagGrid(control, item.item, e.currentTarget.checked)} />
                <span>{item.label}</span>
              </label>
            {/each}
          </div>
        </div>
      {:else if control.kind === "numberGrid"}
        <div class="grid" title={control.description}>
          {#if control.note !== undefined}<div class="gridhead">{control.note}</div>{/if}
          <div class="gridrow" style="--columns: {control.columns ?? 4}">
            {#each control.items as item (item.item)}
              <label class="cell">
                <span>{item.label}</span>
                <NumberBox
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={asNumbers(control.key)[item.item] ?? control.min}
                  ariaLabel={item.label}
                  onCommit={(v) => numberGrid(control, item.item, v)} />
              </label>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
{/each}

<style>
  /**
   * Colours are `var(--ed-*, <literal>)` throughout. The literal is what
   * every demo has always rendered and is what still renders — only a
   * page that DEFINES these names changes, which today is the greyscale
   * editor and nothing else. It was `accent-color` that forced the
   * pattern — a parent cannot tint it, so an undeclared name meant a
   * bright blue thumb on an otherwise hueless page. The slider no longer
   * has a thumb to tint, but the checkboxes still do, and the fallbacks
   * are what keep this component renderable off a page that declares
   * none of these names.
   */
  .group {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--ed-rule, var(--ed-rule));
  }
  h2 {
    margin: 0 0 4px;
    color: var(--ed-ink, var(--ed-ink));
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  /* The tab bar sits directly above the groups, so the group that
     follows it drops its own rule — two lines a few pixels apart read
     as a mistake. */
  .tabs + .group {
    border-top: none;
    padding-top: 2px;
    margin-top: 4px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--ed-rule, var(--ed-rule));
  }
  .tab {
    flex: 1 1 auto;
    padding: 4px 7px;
    font: inherit;
    font-size: 11px;
    color: var(--ed-ink-dim, var(--ed-ink-mid));
    background: var(--ed-tab, var(--ed-well));
    border: 1px solid var(--ed-rule, var(--ed-rule));
    border-radius: var(--ed-radius, 0);
    cursor: pointer;
  }
  .tab:hover {
    color: var(--ed-ink, var(--ed-ink));
  }
  .tab.on {
    color: var(--ed-ink-hi, var(--ed-ink-hi));
    background: var(--ed-tab-on, var(--ed-raised));
    border-color: var(--ed-tab-on-edge, var(--ed-raised-hi));
  }
  .tab:focus-visible {
    outline: 2px solid var(--ed-focus, var(--ed-accent));
    outline-offset: 1px;
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
    color: var(--ed-ink-mid, var(--ed-ink-mid));
    font-size: 12px;
  }
  .row > em {
    flex: 0 0 56px;
    text-align: right;
    font-style: normal;
    color: var(--ed-figure, var(--ed-figure));
    font: 12px ui-monospace, monospace;
  }
  /**
   * The slider: a solid bar, and no thumb.
   *
   * Both layers are painted on the INPUT rather than on either engine's
   * track pseudo-element, and both tracks are blanked, because that is
   * the only way Chrome and Firefox draw the same picture — Firefox has
   * `::-moz-range-progress` for the fill and Chrome has nothing like it,
   * so neither engine's own parts can express this. The fill's width
   * comes from `--p`, set per element in the markup above.
   *
   * The thumb is not hidden, it is TRANSPARENT and one pixel wide: a
   * zero-width thumb drops the grab target on WebKit, and `display:
   * none` takes the drag with it. What the eye tracks is the edge of the
   * fill, which is where the thumb is. `accent-color` is gone with it —
   * it tints the parts this rule replaces, so it now says nothing.
   */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 16px;
    margin: 0;
    background-color: transparent;
    background-image: linear-gradient(
        var(--ed-slider-fill, #bfbfbf),
        var(--ed-slider-fill, #bfbfbf)
      ),
      linear-gradient(var(--ed-slider-track, #1f1f1f), var(--ed-slider-track, #1f1f1f));
    background-repeat: no-repeat;
    background-position:
      left center,
      left center;
    background-size:
      var(--p, 0%) 8px,
      100% 8px;
    cursor: ew-resize;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 100%;
    background: none;
    border: 0;
  }
  input[type="range"]::-moz-range-track {
    height: 100%;
    background: none;
    border: 0;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1px;
    height: 8px;
    margin-top: 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  input[type="range"]::-moz-range-thumb {
    width: 1px;
    height: 8px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  /* The default ring follows the thumb, which is now invisible and a
     pixel wide — so it is replaced by one around the whole track. */
  input[type="range"]:focus {
    outline: none;
  }
  input[type="range"]:focus-visible {
    outline: 1px solid var(--ed-focus, var(--ed-accent));
    outline-offset: 3px;
  }
  input[type="range"]:hover {
    filter: brightness(1.45);
  }
  /* `.num` is the TEXT field only. Every number on this panel is a
     NumberBox, which carries its own copy of this recipe because Svelte
     scopes styles to whoever renders the markup — see that component. */
  select,
  .num {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: var(--ed-well, var(--ed-well));
    color: var(--ed-ink, var(--ed-ink));
    border: 1px solid var(--ed-edge, var(--ed-edge));
    border-radius: var(--ed-radius, 0);
    font: 12px system-ui, sans-serif;
  }
  .num {
    font-family: ui-monospace, monospace;
  }
  /* A unit beside a typed box, where a slider would put its readout. It
     is a suffix, not a value, so it does not reserve the readout column's
     width. */
  .row > em.unit {
    flex: 0 0 auto;
    text-align: left;
  }
  .vec {
    display: flex;
    flex: 1;
    gap: 4px;
    min-width: 0;
  }
  .grid {
    margin: 6px 0 10px;
    padding: 8px;
    background: var(--ed-grid-bg, var(--ed-well));
    border: 1px solid var(--ed-rule, var(--ed-rule));
    border-radius: var(--ed-radius, 0);
  }
  .gridhead {
    margin-bottom: 6px;
    color: var(--ed-ink-dim, var(--ed-ink-dim));
    font-size: 11.5px;
  }
  .gridrow {
    display: grid;
    grid-template-columns: repeat(var(--columns, 4), 1fr);
    gap: 6px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .cell > span {
    color: var(--ed-ink-mid, var(--ed-ink-mid));
    font-size: 11px;
  }
  .check {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    color: var(--ed-ink-mid, var(--ed-ink-mid));
    font-size: 12px;
    cursor: pointer;
  }
  .checks {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(var(--columns, 2), 1fr);
    gap: 4px 10px;
  }
  input[type="checkbox"] {
    margin: 0;
    accent-color: var(--ed-accent, var(--ed-accent));
  }
</style>
