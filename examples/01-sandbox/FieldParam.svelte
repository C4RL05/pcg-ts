<script lang="ts">
  /**
   * Widget for a field-capable param: toggle between a constant value
   * (number / vec inputs) and a field-expression JSON textarea. The
   * textarea applies through fieldFromJson in the controller; parse and
   * validation errors are shown verbatim below it.
   */
  import type { ParamView } from "./controller.js";

  let {
    view,
    onPlain,
    onField,
  }: {
    view: ParamView;
    onPlain: (value: unknown) => void;
    onField: (text: string) => string | null;
  } = $props();

  // svelte-ignore state_referenced_locally -- local editing state deliberately seeds from the
  // initial view; the component is re-keyed per node so it resets on selection change
  let mode = $state<"constant" | "field">(view.mode === "field" ? "field" : "constant");
  // svelte-ignore state_referenced_locally
  let text = $state(
    view.specText ?? JSON.stringify({ fn: "constant", value: view.schema.default }, null, 2),
  );
  let error = $state<string | null>(null);

  const asNumbers = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Number(x)) : typeof v === "number" ? [v] : [];

  function toField(): void {
    mode = "field";
    error = null;
  }

  function toConstant(): void {
    mode = "constant";
    error = null;
    const current = view.mode === "constant" ? view.value : undefined;
    const d = view.schema.default;
    const value = current !== undefined && current !== null ? current : Array.isArray(d) ? [...d] : d;
    onPlain(value);
  }

  function apply(): void {
    error = onField(text);
  }

  function commitScalar(e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) onPlain(v);
  }

  function commitComponent(index: number, e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(v)) return;
    const next = asNumbers(view.value);
    next[index] = v;
    onPlain(next);
  }
</script>

<div class="fieldparam">
  <div class="modes">
    <button class:active={mode === "constant"} onclick={toConstant}>constant</button>
    <button class:active={mode === "field"} onclick={toField}>field</button>
  </div>
  {#if mode === "constant"}
    {#if view.schema.type === "vec3" || view.schema.type === "vec4"}
      <div class="vec">
        {#each asNumbers(view.value ?? view.schema.default) as comp, i}
          <input type="number" step="any" value={comp} onchange={(e) => commitComponent(i, e)} />
        {/each}
      </div>
    {:else}
      <input
        type="number"
        step="any"
        min={view.schema.min}
        max={view.schema.max}
        value={typeof view.value === "number" ? view.value : Number(view.schema.default)}
        onchange={commitScalar}
      />
    {/if}
  {:else}
    <textarea rows="7" spellcheck="false" bind:value={text}></textarea>
    <div class="apply-row">
      <button class="apply" onclick={apply}>apply field</button>
    </div>
    {#if error !== null}
      <div class="error">{error}</div>
    {/if}
  {/if}
</div>

<style>
  .modes {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .modes button {
    flex: 1;
    padding: 2px 0;
    background: #101010;
    color: var(--sb-ink-dim);
    border: 1px solid var(--sb-rule);
    border-radius: var(--sb-radius);
    font: var(--sb-t-meta) var(--sb-sans);
    cursor: pointer;
  }
  .modes button.active {
    background: var(--sb-raised);
    color: var(--sb-action);
    border-color: var(--sb-edge);
  }
  .vec {
    display: flex;
    gap: 4px;
  }
  input[type="number"] {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 3px 6px;
    background: var(--sb-well);
    color: var(--sb-ink);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-mono);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 6px;
    background: #0a0e14;
    color: var(--sb-action);
    border: 1px solid var(--sb-rule);
    border-radius: var(--sb-radius);
    font: var(--sb-t-meta) / 1.5 var(--sb-mono);
  }
  .apply-row {
    margin-top: 4px;
    text-align: right;
  }
  /* The commit control: solid white, so the one button that CHANGES the
     graph is the brightest thing in the row. */
  .apply {
    padding: var(--sb-btn-pad);
    background: #ffffff;
    color: #000000;
    border: 1px solid #ffffff;
    border-radius: var(--sb-radius);
    font: var(--sb-t-meta) var(--sb-sans);
    cursor: pointer;
  }
  .error {
    margin-top: 4px;
    padding: 5px 7px;
    background: var(--sb-alert-bg);
    border: 1px solid var(--sb-edge-err);
    border-radius: var(--sb-radius);
    color: #ffffff;
    font: 10px/1.5 var(--sb-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
