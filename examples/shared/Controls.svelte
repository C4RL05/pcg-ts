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

  function typeNumber(control: NumberControl<P>, raw: string): void {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = clampToRange(
      parsed,
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
  function typeVector(control: VectorControl<P>, index: number, raw: string): void {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = [...asVector(control.key)];
    value[index] = clampToRange(
      parsed,
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

  function numberGrid(control: NumberGridControl<P>, item: string, raw: string): void {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const value = clampToRange(parsed, control.min, control.max, control.step);
    const commit: ControlCommit<P> = { kind: "numberGrid", control, key: control.key, item, value };
    onInput(commit);
    onCommit(commit);
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
        <label class="row">
          <span>{control.label}</span>
          <input
            type="range"
            min={control.min}
            max={control.max}
            step={control.step}
            value={asNumber(control.key)}
            oninput={(e) => slide(control, e.currentTarget.value, false)}
            onchange={(e) => slide(control, e.currentTarget.value, true)} />
          <em>{formatNumber(asNumber(control.key), control.step, control.unit)}</em>
        </label>
      {:else if control.kind === "number"}
        <label class="row">
          <span>{control.label}</span>
          <input
            class="num"
            type="number"
            min={control.min}
            max={control.max}
            step={control.step ?? "any"}
            value={asNumber(control.key)}
            onchange={(e) => typeNumber(control, e.currentTarget.value)} />
          {#if control.unit !== undefined}<em class="unit">{control.unit}</em>{/if}
        </label>
      {:else if control.kind === "text"}
        <label class="row">
          <span>{control.label}</span>
          <input
            class="num"
            type="text"
            value={asString(control.key)}
            onchange={(e) => typeText(control, e.currentTarget.value)} />
        </label>
      {:else if control.kind === "vector"}
        <div class="row">
          <span>{control.label}</span>
          <div class="vec">
            {#each asVector(control.key) as component, i (i)}
              <input
                class="num"
                type="number"
                min={control.min}
                max={control.max}
                step={control.step ?? "any"}
                value={component}
                onchange={(e) => typeVector(control, i, e.currentTarget.value)} />
            {/each}
          </div>
        </div>
      {:else if control.kind === "select"}
        <label class="row">
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
        <div class="row">
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
        <div class="row stack">
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
        <div class="grid">
          {#if control.note !== undefined}<div class="gridhead">{control.note}</div>{/if}
          <div class="gridrow" style="--columns: {control.columns ?? 4}">
            {#each control.items as item (item.item)}
              <label class="cell">
                <span>{item.label}</span>
                <input
                  class="num"
                  type="number"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={asNumbers(control.key)[item.item] ?? control.min}
                  onchange={(e) => numberGrid(control, item.item, e.currentTarget.value)} />
              </label>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
{/each}

<style>
  .group {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  h2 {
    margin: 0 0 4px;
    color: #cfe0f5;
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
    border-top: 1px solid #223047;
  }
  .tab {
    flex: 1 1 auto;
    padding: 4px 7px;
    font: inherit;
    font-size: 11px;
    color: #8fa3bf;
    background: #131c2b;
    border: 1px solid #223047;
    border-radius: 4px;
    cursor: pointer;
  }
  .tab:hover {
    color: #d6e2f2;
  }
  .tab.on {
    color: #eaf1fa;
    background: #24344d;
    border-color: #35507a;
  }
  .tab:focus-visible {
    outline: 2px solid #4d7fd1;
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
  .vec .num {
    min-width: 0;
  }
  .grid {
    margin: 6px 0 10px;
    padding: 8px;
    background: #111823;
    border: 1px solid #223047;
    border-radius: 6px;
  }
  .gridhead {
    margin-bottom: 6px;
    color: #8b98ab;
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
    color: #aeb9c9;
    font-size: 11px;
  }
  .cell .num {
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
    grid-template-columns: repeat(var(--columns, 2), 1fr);
    gap: 4px 10px;
  }
  input[type="checkbox"] {
    margin: 0;
    accent-color: #4c8dff;
  }
</style>
