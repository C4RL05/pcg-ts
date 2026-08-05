<script lang="ts">
  /**
   * Schema-driven param inspector for the selected node. Widgets derive
   * entirely from the registry's ParamSchema: numbers respect min/max,
   * enums become selects, vecs get one input per component, stringLists
   * are row-editable, items are read-only, and field-capable params get
   * the constant/field toggle (FieldParam).
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
    node: NodeView | null;
    paramsRev: number;
    onPlain: (id: string, key: string, value: unknown) => void;
    onFieldApply: (id: string, key: string, text: string) => string | null;
    onDelete: (id: string) => void;
  } = $props();

  const views = $derived.by((): ParamView[] => {
    void paramsRev; // re-derive after any param edit
    return node ? controller.paramViews(node.id, node.type) : [];
  });
  const description = $derived(node ? controller.typeDescription(node.type) : "");

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
    if (!node) return;
    const raw = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(raw)) return;
    onPlain(node.id, view.key, clampNumber(view, raw));
  }

  function commitVecComponent(view: ParamView, index: number, e: Event): void {
    if (!node) return;
    const raw = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(raw)) return;
    const next = asNumbers(view.value);
    next[index] = clampNumber(view, raw);
    onPlain(node.id, view.key, next);
  }

  function commitString(view: ParamView, e: Event): void {
    if (!node) return;
    onPlain(node.id, view.key, (e.currentTarget as HTMLInputElement).value);
  }

  function commitEnum(view: ParamView, e: Event): void {
    if (!node) return;
    onPlain(node.id, view.key, (e.currentTarget as HTMLSelectElement).value);
  }

  function commitBool(view: ParamView, e: Event): void {
    if (!node) return;
    onPlain(node.id, view.key, (e.currentTarget as HTMLInputElement).checked);
  }

  function commitListItem(view: ParamView, index: number, e: Event): void {
    if (!node) return;
    const next = asStrings(view.value);
    next[index] = (e.currentTarget as HTMLInputElement).value;
    onPlain(node.id, view.key, next);
  }

  function removeListItem(view: ParamView, index: number): void {
    if (!node) return;
    const next = asStrings(view.value);
    next.splice(index, 1);
    onPlain(node.id, view.key, next);
  }

  function addListItem(view: ParamView): void {
    if (!node) return;
    onPlain(node.id, view.key, [...asStrings(view.value), ""]);
  }
</script>

<div class="inspector">
  {#if node === null}
    <div class="hint">select a node to edit its params — pins connect left (in) to right (out)</div>
  {:else}
    {#key node.id}
      <div class="head">
        <div>
          <div class="type">{node.type}</div>
          <div class="id">{node.id}</div>
        </div>
        <button class="danger" onclick={() => node && onDelete(node.id)}>delete</button>
      </div>
      <p class="desc">{description}</p>
      {#if node.type === "subgraph"}
        <div class="hint">
          opaque composite (imported): its inner graph travels in the serialized payload and is not
          editable here
        </div>
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
              onPlain={(value) => node && onPlain(node.id, view.key, value)}
              onField={(text) => (node ? onFieldApply(node.id, view.key, text) : null)}
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
  {/if}
</div>

<style>
  .inspector {
    flex: 0 0 250px;
    overflow-y: auto;
    padding: 10px;
    border-left: 1px solid #223047;
  }
  .hint {
    color: #6f7c8f;
    font-size: 11px;
    line-height: 1.5;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .type {
    font-weight: 600;
    color: #eaf1fa;
  }
  .id {
    color: #6f7c8f;
    font: 10px ui-monospace, monospace;
  }
  .danger {
    padding: 2px 10px;
    background: #33161c;
    color: #ffb9c2;
    border: 1px solid #a04455;
    border-radius: 5px;
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
  .desc {
    margin: 6px 0 10px;
    color: #8b98ab;
    font-size: 11px;
    line-height: 1.45;
    max-height: 78px;
    overflow-y: auto;
  }
  .param {
    margin: 9px 0;
    padding-top: 7px;
    border-top: 1px solid #1b2536;
  }
  .label {
    margin-bottom: 4px;
    color: #aeb9c9;
    font: 12px ui-monospace, monospace;
    cursor: help;
  }
  .ptype {
    color: #55617a;
    font-size: 10px;
  }
  .readonly {
    color: #6f7c8f;
    font-size: 11px;
    font-style: italic;
  }
  input[type="number"],
  input[type="text"],
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 3px 6px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px ui-monospace, monospace;
  }
  input[type="checkbox"] {
    accent-color: #4c8dff;
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
    padding: 2px 8px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 11px system-ui, sans-serif;
    cursor: pointer;
  }
</style>
