<script lang="ts">
  /**
   * Schema-driven param inspector for the selected node. Widgets derive
   * entirely from the registry's ParamSchema: numbers respect min/max,
   * enums become selects, vecs get one input per component, stringLists
   * are row-editable, items are read-only, and field-capable params get
   * the constant/field toggle (FieldParam).
   *
   * Pure content: the floating card around it — width, backing, scroll,
   * and the narrow-screen drawer — belongs to Editor, which renders this
   * only while a node is selected. There is no empty state here for that
   * reason: "nothing selected" is expressed by the panel not existing.
   */
  import FieldParam from "./FieldParam.svelte";
  import type { EditorController, ParamView } from "./controller.js";
  import type { NodeView } from "./model.js";

  let {
    controller,
    node,
    paramsRev,
    onPlain,
    onFieldApply,
    onDelete,
  }: {
    controller: EditorController;
    /** Never null: Editor renders this panel only when one is selected. */
    node: NodeView;
    paramsRev: number;
    onPlain: (id: string, key: string, value: unknown) => void;
    onFieldApply: (id: string, key: string, text: string) => string | null;
    onDelete: (id: string) => void;
  } = $props();

  const views = $derived.by((): ParamView[] => {
    void paramsRev; // re-derive after any param edit
    return controller.paramViews(node.id, node.type);
  });
  const info = $derived(controller.describeNode(node.id, node.type));

  const asNumbers = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => Number(x)) : typeof v === "number" ? [v] : [];
  const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const asString = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
  const asNumber = (v: unknown): number => (typeof v === "number" ? v : 0);
  const asBool = (v: unknown): boolean => v === true;

  function clampNumber(view: ParamView, raw: number): number {
    let v = raw;
    if (view.schema.type === "i32" || view.schema.type === "u32") v = Math.round(v);
    if (view.schema.type === "u32") v = Math.max(0, v);
    if (view.schema.min !== undefined) v = Math.max(view.schema.min, v);
    if (view.schema.max !== undefined) v = Math.min(view.schema.max, v);
    return v;
  }

  function commitNumber(view: ParamView, e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(raw)) return;
    onPlain(node.id, view.key, clampNumber(view, raw));
  }

  function commitVecComponent(view: ParamView, index: number, e: Event): void {
    const raw = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(raw)) return;
    const next = asNumbers(view.value);
    next[index] = clampNumber(view, raw);
    onPlain(node.id, view.key, next);
  }

  function commitString(view: ParamView, e: Event): void {
    onPlain(node.id, view.key, (e.currentTarget as HTMLInputElement).value);
  }

  function commitEnum(view: ParamView, e: Event): void {
    onPlain(node.id, view.key, (e.currentTarget as HTMLSelectElement).value);
  }

  function commitBool(view: ParamView, e: Event): void {
    onPlain(node.id, view.key, (e.currentTarget as HTMLInputElement).checked);
  }

  function commitListItem(view: ParamView, index: number, e: Event): void {
    const next = asStrings(view.value);
    next[index] = (e.currentTarget as HTMLInputElement).value;
    onPlain(node.id, view.key, next);
  }

  function removeListItem(view: ParamView, index: number): void {
    const next = asStrings(view.value);
    next.splice(index, 1);
    onPlain(node.id, view.key, next);
  }

  function addListItem(view: ParamView): void {
    onPlain(node.id, view.key, [...asStrings(view.value), ""]);
  }
</script>

<div class="inspector">
  {#key node.id}
    <div class="head">
      <div class="who">
        <div class="type">{info.label}</div>
        <div class="id">{node.id}</div>
      </div>
      <button class="danger" onclick={() => onDelete(node.id)}>delete</button>
    </div>
    <p class="desc">{info.description}</p>
    {#if node.type === "subgraph"}
      <p class="note">
        composite: its inner graph is not editable here, but the params it exposes are — each one
        writes into the inner nodes it was declared over
      </p>
    {/if}
    {#each views as view (view.key)}
      <div class="param">
        <div class="label" title={view.schema.description}>
          {view.key}
          <span class="ptype">{view.schema.type}{view.schema.acceptsField ? " · field" : ""}</span>
        </div>
        {#if view.mode === "items"}
          <div class="readonly">runtime-injected (bound via graph.setParam; never serialized)</div>
        {:else if view.schema.acceptsField}
          <FieldParam
            {view}
            onPlain={(value) => onPlain(node.id, view.key, value)}
            onField={(text) => onFieldApply(node.id, view.key, text)}
          />
        {:else if view.schema.type === "f32" || view.schema.type === "i32" || view.schema.type === "u32"}
          <input
            type="number"
            value={asNumber(view.value)}
            min={view.schema.min}
            max={view.schema.max}
            step={view.schema.type === "f32" ? "any" : 1}
            onchange={(e) => commitNumber(view, e)}
          />
        {:else if view.schema.type === "bool"}
          <input type="checkbox" checked={asBool(view.value)} onchange={(e) => commitBool(view, e)} />
        {:else if view.schema.type === "enum"}
          <select value={asString(view.value)} onchange={(e) => commitEnum(view, e)}>
            {#each view.schema.enum ?? [] as opt (opt)}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        {:else if view.schema.type === "string"}
          <input type="text" value={asString(view.value)} onchange={(e) => commitString(view, e)} />
        {:else if view.schema.type === "vec3" || view.schema.type === "vec4"}
          <div class="vec">
            {#each asNumbers(view.value) as comp, i}
              <input
                type="number"
                step="any"
                value={comp}
                onchange={(e) => commitVecComponent(view, i, e)}
              />
            {/each}
          </div>
        {:else if view.schema.type === "stringList"}
          <div class="list">
            {#each asStrings(view.value) as item, i}
              <div class="list-row">
                <input type="text" value={item} onchange={(e) => commitListItem(view, i, e)} />
                <button onclick={() => removeListItem(view, i)}>✕</button>
              </div>
            {/each}
            <button class="add" onclick={() => addListItem(view)}>+ add</button>
          </div>
        {/if}
      </div>
    {/each}
  {/key}
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  /* The name has to be allowed to shrink, or a long node id widens the
     row and pushes "delete" off the column. */
  .who {
    min-width: 0;
  }
  .type {
    font-weight: 600;
    color: var(--sb-ink-hi);
    overflow-wrap: anywhere;
  }
  .id {
    color: var(--sb-ink-faint);
    font: 10px var(--sb-mono);
    overflow-wrap: anywhere;
  }
  /* The one destructive control in the column. It reads as such by being
     the only outlined-white button on the page — the red is gone, so the
     weight has to say it. */
  .danger {
    flex: 0 0 auto;
    padding: var(--sb-btn-pad);
    background: var(--sb-alert-bg);
    color: #ffffff;
    border: 1px solid var(--sb-edge-err);
    border-radius: var(--sb-radius);
    font: var(--sb-t-meta) var(--sb-sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .danger:hover {
    background: #ffffff;
    color: #000000;
  }
  /**
   * Set in full, with no scroller of its own. It used to be capped at 78px
   * with `overflow-y: auto`, which cut the sentence mid-word behind a
   * native scrollbar and stranded the note under it — a description is the
   * registry telling you what the node is for, and half of one is worse
   * than the space it saves. The column scrolls; this rides it.
   */
  .desc {
    margin: 6px 0 10px;
    color: var(--sb-ink-dim);
    font-size: var(--sb-t-body);
    line-height: 1.5;
  }
  .note {
    margin: 0 0 10px;
    padding: 6px 8px;
    background: #101010;
    border-left: 2px solid var(--sb-edge);
    border-radius: 0 4px 4px 0;
    color: var(--sb-ink-dim);
    font-size: var(--sb-t-meta);
    line-height: 1.5;
  }
  .param {
    margin: 9px 0;
    padding-top: 7px;
    border-top: 1px solid var(--sb-rule-soft);
  }
  .label {
    margin-bottom: 4px;
    color: var(--sb-ink-mid);
    font: var(--sb-t-body) var(--sb-mono);
    cursor: help;
  }
  .ptype {
    color: var(--sb-ink-ghost);
    font-size: 10px;
  }
  .readonly {
    color: var(--sb-ink-faint);
    font-size: var(--sb-t-meta);
    font-style: italic;
  }
  input[type="number"],
  input[type="text"],
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 3px 6px;
    background: var(--sb-well);
    color: var(--sb-ink);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-mono);
  }
  input[type="checkbox"] {
    accent-color: #ffffff;
  }
  .vec {
    display: flex;
    gap: 4px;
  }
  .vec input {
    min-width: 0;
  }
  .list-row {
    display: flex;
    gap: 4px;
    margin: 3px 0;
  }
  .list-row button,
  .add {
    padding: var(--sb-btn-pad);
    background: var(--sb-raised);
    color: var(--sb-action);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-meta) var(--sb-sans);
    cursor: pointer;
  }
  .list-row button:hover,
  .add:hover {
    background: var(--sb-raised-hi);
  }
</style>
