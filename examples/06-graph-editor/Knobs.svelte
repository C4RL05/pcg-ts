<script lang="ts">
  /**
   * The graph's knobs, as a card over the viewport rather than a fourth
   * column in the dock — this is the control surface a visitor reaches
   * for first, and it belongs beside the thing it changes, not beside the
   * wiring. It wears the same shell as the other demos' panels and is
   * rendered by the same spec-driven renderer, which is what that
   * renderer was generalised for.
   *
   * The rows are the exposed params of the graph's subgraph nodes, laid
   * out by a panel spec when the graph ships one and grouped by node when
   * it does not. Writing one is `setParam` on the wrapping node, the same
   * call the inspector makes — so the two views of a knob cannot drift.
   */
  import PanelShell from "../shared/PanelShell.svelte";
  import Controls from "../shared/Controls.svelte";
  import { applyCommit, type ControlCommit } from "../shared/controls.js";
  import { buildKnobPanel, type GraphPanelSpec, type KnobValues } from "../shared/graphUi.js";
  import type { EditorController } from "./controller.js";

  let {
    controller,
    rev,
    spec,
    title,
    onEdit,
  }: {
    controller: EditorController;
    /** Bumped by the editor whenever the graph or its params changed. */
    rev: number;
    /** The loaded graph's panel spec, when it ships one. */
    spec: GraphPanelSpec | undefined;
    title: string;
    /** Report a write so the node inspector re-reads the same param. */
    onEdit: () => void;
  } = $props();

  const PANEL_WIDTH = 300;

  /**
   * Rebuilt from the live graph on every rev rather than kept as local
   * state: unlike the demo panels, this one's SHAPE changes under it — a
   * different graph has different knobs — so there is nothing stable to
   * hold. Every edit bumps rev, so the values here are the graph's.
   */
  const panel = $derived.by(() => {
    void rev;
    return buildKnobPanel(controller.knobs(), spec);
  });

  /** Key → the node and param it writes, so no key has to be re-split. */
  const targets = $derived(
    new Map(controller.knobs().map((k) => [k.key, { node: k.node, name: k.name }])),
  );

  let values = $state<KnobValues>({});
  let shown = -1;
  $effect(() => {
    // A fresh values object per rebuild; `panel.values` is already a copy
    // of what the graph holds.
    if (shown !== rev) {
      shown = rev;
      values = panel.values;
    }
  });

  let tab = $state("");
  $effect(() => {
    const titles = panel.sections.map((s) => s.title);
    if (!titles.includes(tab)) tab = titles[0] ?? "";
  });

  function input(commit: ControlCommit<KnobValues>): void {
    applyCommit(values, commit);
  }

  function commit(c: ControlCommit<KnobValues>): void {
    applyCommit(values, c);
    const target = targets.get(String(c.key));
    if (target === undefined) return;
    controller.setPlainParam(target.node, target.name, c.value);
    onEdit();
  }
</script>

<PanelShell {title} width={PANEL_WIDTH}>
  {#if panel.sections.length === 0}
    <p class="note">
      This graph exposes no knobs. Params live on its nodes — select one on the canvas to edit it.
    </p>
  {:else}
    <p class="note">
      {#if panel.authored}
        Curated for this graph.
      {:else}
        Derived from the graph's exposed params, grouped by the node that exposes each one.
      {/if}
      Every edit is a <code>setParam</code> on the wrapping node, then a recook.
    </p>
    <Controls
      sections={panel.sections}
      {values}
      onInput={input}
      onCommit={commit}
      bind:tab
      tabbed={panel.sections.length > 1} />
  {/if}

  {#if panel.unknown.length > 0}
    <p class="warn">
      panel spec names {panel.unknown.length} param(s) this graph does not expose: {panel.unknown.join(
        ", ",
      )}
    </p>
  {/if}
  {#if panel.skipped.length > 0}
    <details class="skipped">
      <summary>{panel.skipped.length} not shown</summary>
      {#each panel.skipped as s (s.key)}
        <div><b>{s.key}</b> — {s.reason}</div>
      {/each}
    </details>
  {/if}
</PanelShell>

<style>
  .note {
    margin: 0 0 6px;
    color: #8b98ab;
    font-size: 12px;
  }
  code {
    color: #9ecbff;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .warn {
    margin: 8px 0 0;
    padding: 6px 8px;
    background: #33261a;
    border: 1px solid #7a5a2e;
    border-radius: 6px;
    color: #f0c869;
    font-size: 11px;
  }
  .skipped {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
    color: #6f7c8f;
    font-size: 11px;
  }
  .skipped summary {
    cursor: pointer;
    color: #8b98ab;
  }
  .skipped div {
    margin-top: 4px;
  }
  .skipped b {
    color: #aeb9c9;
    font-family: ui-monospace, monospace;
    font-weight: 400;
  }
</style>
