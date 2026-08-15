<script lang="ts">
  /**
   * Widget for a field-capable param: toggle between a constant value
   * (number / vec inputs) and a field-expression JSON textarea. The
   * textarea applies through fieldFromJson in the controller; parse and
   * validation errors are shown verbatim below it.
   */
  import { paramNamesOf, type FieldSpec } from "pcg-ts";
  import { clampToSchema } from "./controller.js";
  import type { ParamView } from "./controller.js";

  let {
    view,
    onPlain,
    onField,
  }: {
    view: ParamView;
    /** Returns what the graph refused, or null — shown in the error slot. */
    onPlain: (value: unknown) => string | null;
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
    error = onPlain(value);
  }

  function apply(): void {
    error = onField(text);
  }

  /**
   * The vector this param currently stands for, always at the schema's
   * arity. A field-capable vec param legally holds a SCALAR — it broadcasts
   * across the tuple — so reading its components straight off the value
   * gives one box for a vec3, and editing that one box used to commit a
   * 1-long array. Expand the broadcast instead: what is shown and what is
   * committed then both have the arity the schema declares.
   */
  const arity = $derived(view.schema.type === "vec4" ? 4 : 3);
  const components = $derived.by((): number[] => {
    const n = asNumbers(view.value ?? view.schema.default);
    if (n.length === arity) return n;
    return new Array<number>(arity).fill(n.length === 1 ? n[0] : 0);
  });

  function commitScalar(e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    // Clamped before it is committed: `min`/`max` on the input element are
    // advisory (typing is not constrained), and setParam refuses what the
    // schema does not admit.
    if (Number.isFinite(v)) error = onPlain(clampToSchema(view.schema, v));
  }

  function commitComponent(index: number, e: Event): void {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(v)) return;
    const next = [...components];
    next[index] = clampToSchema(view.schema, v);
    error = onPlain(next);
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
        {#each components as comp, i}
          <input
            type="number"
            step="any"
            min={view.schema.min}
            max={view.schema.max}
            value={comp}
            onchange={(e) => commitComponent(i, e)}
          />
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
    background: var(--sb-alert-bg);
    border: 1px solid var(--sb-edge-err);
    border-radius: var(--sb-radius);
    color: #ffffff;
    font: 10px/1.5 var(--sb-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
