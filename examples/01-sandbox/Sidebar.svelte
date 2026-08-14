<script lang="ts">
  /**
   * The editor's right column, and the only one: the graph's knobs and the
   * selected node's params are two TABS of one panel rather than two
   * columns side by side.
   *
   * They were columns because they answer different questions — what does
   * this graph do, what does this node do — and both answers deserve to be
   * readable. But the node column is empty whenever nothing is selected,
   * which is most of the time, and between them they took a third of the
   * width from the thing the sandbox exists to show. One column at 320px
   * hands ~230px back to the render and loses nothing that was being read:
   * you are turning a graph knob or you are editing a node, never both in
   * the same gesture. Selecting a node switches the tab, so the panel is
   * already on the answer by the time you look at it.
   *
   * Both panes stay MOUNTED and are hidden with `display: none`, never
   * `{#if}` — a tab is a change of view, and remounting would throw away
   * each pane's scroll position and the graph pane's revealed link every
   * time you glanced at a node.
   *
   * This component owns the column's chrome — width, backing, scroll,
   * border — so the panes inside it are pure content. That backing is the
   * point of putting it in one place: the overlay is drawn over a live
   * render, and a pane without one comes out as ghost text over the scene.
   */
  import Inspector from "./Inspector.svelte";
  import Overview from "./Overview.svelte";
  import type { GraphPanelSpec, KnobPatch, KnobValues } from "../shared/graphUi.js";
  import type { EditorController } from "./controller.js";
  import type { NodeView } from "./model.js";

  let {
    controller,
    node,
    paramsRev,
    spec,
    title,
    baseline,
    seed,
    loadedSeed,
    tab = $bindable("graph"),
    open = false,
    onEdit,
    onReset,
    shareUrl,
    onPlain,
    onFieldApply,
    onDelete,
  }: {
    controller: EditorController;
    /** The selected node, or null. Also what the node tab is enabled by. */
    node: NodeView | null;
    paramsRev: number;
    spec: GraphPanelSpec | undefined;
    title: string;
    baseline: KnobValues;
    seed: number;
    loadedSeed: number;
    /** Which pane is up. Bindable: selecting a node steers it from outside. */
    tab?: "graph" | "node";
    /**
     * On narrow screens the column is a slide-over drawer and `open`
     * slides it in from the right. At desktop widths it styles nothing.
     */
    open?: boolean;
    onEdit: () => void;
    onReset: () => void;
    shareUrl: (patch: KnobPatch) => string;
    onPlain: (id: string, key: string, value: unknown) => void;
    onFieldApply: (id: string, key: string, text: string) => string | null;
    onDelete: (id: string) => void;
  } = $props();

  /**
   * The node tab names what it holds. A tab reading "node" tells you
   * nothing you did not already know from clicking one; the id is the
   * thing you are actually keeping track of across a dozen boxes that
   * share a type.
   */
  const nodeLabel = $derived(node === null ? "node" : node.id);
</script>

<div class="sidebar" class:open>
  <div class="tabs" role="tablist" aria-label="panel">
    <button
      class="tab"
      class:on={tab === "graph"}
      role="tab"
      aria-selected={tab === "graph"}
      onclick={() => (tab = "graph")}>graph</button>
    <!-- Never disabled, even with nothing selected: the pane behind it
         explains what selecting does, which is exactly what someone who
         has not selected anything needs to read. -->
    <button
      class="tab"
      class:on={tab === "node"}
      class:empty={node === null}
      role="tab"
      aria-selected={tab === "node"}
      onclick={() => (tab = "node")}>{nodeLabel}</button>
  </div>

  <div class="pane" hidden={tab !== "graph"}>
    <Overview
      {controller}
      rev={paramsRev}
      {spec}
      {title}
      {baseline}
      {seed}
      {loadedSeed}
      {onEdit}
      {onReset}
      {shareUrl} />
  </div>
  <div class="pane" hidden={tab !== "node"}>
    <Inspector {controller} {node} {paramsRev} {onPlain} {onFieldApply} {onDelete} />
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    flex: 0 0 320px;
    min-height: 0;
    box-sizing: border-box;
    /* Opaque enough to read against a bright render, blurred so the scene
       behind it still reads as depth rather than as a wall. */
    background: var(--sb-panel);
    border-left: 1px solid var(--sb-rule);
    backdrop-filter: blur(6px);
  }
  .tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 3px;
    padding: 8px 12px 0;
  }
  .tab {
    flex: 1 1 0;
    min-width: 0;
    padding: 5px 8px;
    background: #131c2b;
    color: #8fa3bf;
    border: 1px solid var(--sb-rule);
    border-radius: var(--sb-radius) var(--sb-radius) 0 0;
    border-bottom-color: transparent;
    font: var(--sb-t-meta) var(--sb-mono);
    /* A node id is longer than the tab; clip it rather than let it widen
       the tab and shove the other one off its half. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--sb-ink);
  }
  .tab.on {
    color: var(--sb-ink-hi);
    background: #24344d;
    border-color: #35507a;
    border-bottom-color: transparent;
  }
  /* The node tab with nothing in it. Dimmed rather than disabled — see
     the markup. */
  .tab.empty:not(.on) {
    color: var(--sb-ink-ghost);
  }
  .tab:focus-visible {
    outline: 2px solid #4d7fd1;
    outline-offset: 1px;
  }
  /* The line the tabs sit on, drawn by the pane so the active tab's own
     missing bottom border reads as a notch in it. */
  .pane {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px 14px;
    border-top: 1px solid var(--sb-rule);
    margin-top: -1px;
  }
  /* [hidden] loses to the flex rule above without this. */
  .pane[hidden] {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in examples/shared/mobile.ts */
    .sidebar {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 15;
      flex-basis: auto;
      width: min(78vw, 300px);
      background: var(--sb-solid);
      transform: translateX(100%);
      /* Hidden when closed so the off-screen drawer can't take focus or
         intercept hit-testing. */
      visibility: hidden;
      transition:
        transform 0.2s ease,
        visibility 0.2s;
    }
    .sidebar.open {
      transform: none;
      visibility: visible;
    }
  }
</style>
