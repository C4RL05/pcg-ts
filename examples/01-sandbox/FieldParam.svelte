<script lang="ts">
  /**
   * Widget for a field-capable param: toggle between a constant value
   * (number / vec inputs) and a field-expression JSON textarea. The
   * textarea applies through fieldFromJson in the controller; parse and
   * validation errors are shown verbatim below it.
   */
  import { paramNamesOf, type FieldSpec } from "pcg-ts";
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

  /**
   * The `{ fn: "param" }` names the edited spec reads, so the widget says
   * where the value would come from before the cook does. A param is
   * supplied by an ENCLOSING wrapper's exposed param of the same name;
   * this graph's own knobs are not that scope, so a spec typed here that
   * reads one builds and then fails at cook. Parsing is best-effort:
   * half-typed JSON simply annotates nothing.
   */
  const readNames = $derived.by((): readonly string[] => {
    try {
      return paramNamesOf(JSON.parse(text) as FieldSpec);
    } catch {
      return [];
    }
  });

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
    {#if readNames.length > 0}
      <div class="reads">
        reads {readNames.map((n) => `"${n}"`).join(", ")} — supplied by an exposed param of that
        name on an enclosing subgraph, never by this graph's own knobs
      </div>
    {/if}
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
    background: #131a26;
    color: #8b98ab;
    border: 1px solid #223047;
    border-radius: 5px;
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
  .modes button.active {
    background: #1d2a3f;
    color: #9ecbff;
    border-color: #33405a;
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
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px ui-monospace, monospace;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 6px;
    background: #0a0e14;
    color: #9ecbff;
    border: 1px solid #223047;
    border-radius: 5px;
    font: 11px/1.5 ui-monospace, monospace;
  }
  .apply-row {
    margin-top: 4px;
    text-align: right;
  }
  .apply {
    padding: 2px 10px;
    background: #16321f;
    color: #b8f5c8;
    border: 1px solid #2f9e5f;
    border-radius: 5px;
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
  .reads {
    margin-top: 4px;
    padding: 4px 7px;
    background: #131a26;
    border: 1px solid #223047;
    border-radius: 5px;
    color: #8b98ab;
    font: 10px/1.5 ui-monospace, monospace;
  }
  .error {
    margin-top: 4px;
    padding: 5px 7px;
    background: #33161c;
    border: 1px solid #a04455;
    border-radius: 5px;
    color: #ffb9c2;
    font: 10px/1.5 ui-monospace, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
