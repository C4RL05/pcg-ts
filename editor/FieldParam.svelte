<script lang="ts">
  /**
   * Widget for a field-capable param: toggle between a constant value
   * (number / vec inputs) and a field EXPRESSION, written as text.
   *
   * No JSON is shown here any more. The tree is still the format and is
   * still what the graph file holds — this prints it on the way in and
   * parses it on the way out — but a reader never meets the
   * serialization, which is the whole reason `printFieldSpec` exists.
   * Parse and validation errors are shown verbatim below the box; the
   * parser's carry the offending token and its line:col.
   */
  import { paramNamesOf, parseFieldText, printFieldSpec, type FieldSpec } from "pcg-ts";
  import { clampToSchema } from "./controller.js";
  import type { ParamView } from "./controller.js";
  import FieldTree from "./FieldTree.svelte";
  import NumberBox from "../shared/NumberBox.svelte";

  /**
   * Move the overlay to `<body>`, WITHOUT which it is not an overlay.
   *
   * This widget lives inside `.panel`, which carries
   * `backdrop-filter: blur(6px)` (Editor.svelte). A filter — backdrop or
   * otherwise — makes an element the containing block for its `position:
   * fixed` descendants, so `inset: 0` resolves to the 300px inspector
   * rather than the viewport and the diagram renders as a sliver down the
   * right-hand edge. Type-checks clean; visibly wrong.
   *
   * Reparenting is the fix that leaves `.panel` alone: dropping the blur
   * would change every panel in the editor to repair one overlay.
   */
  function toBody(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

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
  let text = $state(view.specText ?? defaultText());

  /** The starting expression for a param switched from constant to field. */
  function defaultText(): string {
    try {
      return printFieldSpec({ fn: "constant", value: view.schema.default } as FieldSpec);
    } catch {
      return "0";
    }
  }
  let error = $state<string | null>(null);
  /** The read-only diagram of the spec in the textarea, when open. */
  let diagram = $state(false);

  /**
   * The textarea's text as a spec, or null when it does not parse.
   *
   * ONE parse per keystroke, and everything that needs the spec reads it
   * from here: `bind:value` re-runs this on every character typed, and a
   * failed parse is not free — the parser runs an edit-distance search
   * over every registered fn to offer a "did you mean". Parsing twice to
   * answer two questions paid for that twice.
   */
  const parsed = $derived.by((): FieldSpec | null => {
    try {
      return parseFieldText(text);
    } catch {
      return null;
    }
  });

  /**
   * Whether the textarea currently holds a parseable expression. The
   * diagram button is disabled when it does not: there is nothing to
   * draw, and the textarea's own error already says why.
   */
  const parses = $derived(parsed !== null);

  /**
   * The `{ fn: "param" }` names the edited spec reads, so the widget says
   * where the value would come from before the cook does. A param is
   * supplied by an ENCLOSING wrapper's exposed param of the same name;
   * this graph's own knobs are not that scope, so a spec typed here that
   * reads one builds and then fails at cook. Parsing is best-effort: a
   * half-typed expression simply annotates nothing.
   */
  const readNames = $derived(parsed === null ? [] : paramNamesOf(parsed));

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

  function commitScalar(v: number): void {
    // Clamped before it is committed: `min`/`max` on the input element are
    // advisory (typing is not constrained), and setParam refuses what the
    // schema does not admit.
    if (Number.isFinite(v)) error = onPlain(clampToSchema(view.schema, v));
  }

  function commitComponent(index: number, v: number): void {
    if (!Number.isFinite(v)) return;
    const next = [...components];
    next[index] = clampToSchema(view.schema, v);
    error = onPlain(next);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (diagram && e.key === "Escape") diagram = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fieldparam">
  <div class="modes">
    <button class:active={mode === "constant"} onclick={toConstant}>constant</button>
    <button class:active={mode === "field"} onclick={toField}>field</button>
  </div>
  {#if mode === "constant"}
    {#if view.schema.type === "vec3" || view.schema.type === "vec4"}
      <div class="vec">
        {#each components as comp, i}
          <NumberBox
            step="any"
            min={view.schema.min}
            max={view.schema.max}
            value={comp}
            ariaLabel="{view.key} {i}"
            onCommit={(v) => commitComponent(i, v)} />
        {/each}
      </div>
    {:else}
      <NumberBox
        step="any"
        min={view.schema.min}
        max={view.schema.max}
        value={typeof view.value === "number" ? view.value : Number(view.schema.default)}
        ariaLabel={view.key}
        onCommit={commitScalar} />
    {/if}
  {:else}
    <textarea rows="7" spellcheck="false" bind:value={text}></textarea>
    <div class="apply-row">
      <button class="diagram" disabled={!parses} onclick={() => (diagram = true)}>diagram</button>
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
    {#if diagram}
      <!-- The diagram's own chrome rather than `Modal.svelte`: that
           component IS its textarea — title, buttons and a text box, with
           no slot for anything else — so hosting an SVG in it would mean
           changing what it is. The surface here is deliberately identical
           to it: same backdrop, same panel, same head. -->
      <div
        class="ft-backdrop"
        use:toBody
        role="presentation"
        onclick={(e) => e.target === e.currentTarget && (diagram = false)}
      >
        <div class="ft-modal" role="dialog" aria-label="field expression diagram">
          <div class="ft-head">
            <span>field expression — read-only</span>
            <button onclick={() => (diagram = false)}>close</button>
          </div>
          <div class="ft-scroll">
            <FieldTree spec={parsed} />
          </div>
        </div>
      </div>
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
    color: var(--ed-ink-dim);
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) var(--ed-sans);
    cursor: pointer;
  }
  .modes button.active {
    background: var(--ed-raised);
    color: var(--ed-action);
    border-color: var(--ed-edge);
  }
  .vec {
    display: flex;
    gap: 4px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 6px;
    background: #0a0e14;
    color: var(--ed-action);
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) / 1.5 var(--ed-mono);
  }
  .apply-row {
    margin-top: 4px;
    text-align: right;
  }
  /* The mode buttons' outlined style, at the apply row's height: this
     OPENS a view where the button beside it CHANGES the graph, and the
     two must not read as equals. */
  .diagram {
    margin-right: 4px;
    padding: var(--ed-btn-pad);
    background: #101010;
    color: var(--ed-ink-dim);
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) var(--ed-sans);
    cursor: pointer;
  }
  .diagram:disabled {
    color: var(--ed-ink-ghost);
    cursor: default;
  }
  /* The commit control: solid white, so the one button that CHANGES the
     graph is the brightest thing in the row. */
  .apply {
    padding: var(--ed-btn-pad);
    background: #ffffff;
    color: #000000;
    border: 1px solid #ffffff;
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) var(--ed-sans);
    cursor: pointer;
  }
  .reads {
    margin-top: 4px;
    padding: 4px 7px;
    background: #131a26;
    border: 1px solid #223047;
    border-radius: var(--ed-radius);
    color: #8b98ab;
    font: 10px/1.5 ui-monospace, monospace;
  }
  /* Modal.svelte's surface, repeated for the one thing it cannot host.
     Kept to its look on purpose — the editor has ONE modal appearance,
     and a second one a few pixels off would read as a bug. The WIDTH is
     the one deliberate departure: Modal wraps a textarea and 680px is
     right for prose, while a diagram of the corpus's largest expression
     is 1638px wide, and at 680 it is a keyhole. It still scrolls, but it
     should not have to for anything ordinary. */
  .ft-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.72);
  }
  .ft-modal {
    /* Shrink to the diagram rather than holding one width: most specs are
       three deep and would sit in a third of the panel with the rest
       empty, and the big ones still cap and scroll. */
    width: max-content;
    max-width: min(1180px, calc(100vw - 48px));
    min-width: min(420px, calc(100vw - 48px));
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    background: #000000;
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius-lg);
    color: var(--ed-ink);
    font: 13px var(--ed-sans);
  }
  .ft-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .ft-head button {
    padding: var(--ed-btn-pad);
    background: var(--ed-raised);
    color: var(--ed-action);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-sans);
    cursor: pointer;
  }
  .ft-head button:hover {
    filter: brightness(1.25);
  }
  /* The diagram is routinely wider than the panel — it grows one column
     per level of nesting — so it scrolls in both axes rather than being
     scaled down to fit and made unreadable. */
  .ft-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px;
    background: #0a0a0a;
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
  }
  .error {
    margin-top: 4px;
    padding: 5px 7px;
    background: var(--ed-alert-bg);
    border: 1px solid var(--ed-edge-err);
    border-radius: var(--ed-radius);
    color: #ffffff;
    font: 10px/1.5 var(--ed-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
