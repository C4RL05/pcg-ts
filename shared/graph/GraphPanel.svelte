<script lang="ts">
  /**
   * The graph behind a demo, as a corner thumbnail that opens.
   *
   * A demo shows what its graph PRODUCED and never the graph, which makes
   * the interesting half of the library invisible on the pages built to
   * show it off. The thumbnail is there to say "this came from a graph,
   * and here is its shape"; the expanded view is there for reading the
   * shape you just saw the silhouette of.
   *
   * IT IS READ-ONLY, and not because editing was cut for time. A demo's
   * graph is built in TypeScript by the page around it — the racetrack
   * calibrates its counts against a measured lap and rebuilds the graph
   * three times before it draws anything — so a param changed here would
   * be overwritten by the next cook, or worse, would not be, and the page
   * would then disagree with its own readouts. The editor is where a graph
   * is edited, and it opens the corpus for exactly that.
   *
   * THE THUMBNAIL FITS WHAT IT CAN AND CROPS THE REST. Containing the
   * whole graph was the first answer and it was wrong for the graph that
   * needed it most: the racetrack's is 14.5 to 1, and contained in the
   * card it is a three-pixel smear — every node present and nothing
   * legible. {@link THUMB_FLOOR} stops the fit before that, so a big graph
   * shows a slab of itself at a scale where a box reads as a box. The node
   * count in the caption carries what the crop no longer says.
   */
  import { onMount } from "svelte";
  import GraphView from "./GraphView.svelte";
  import { readGraph, type GraphPicture } from "./fromSerialized.js";
  import type { SerializedGraph } from "pcg-ts";

  let {
    initial,
    title = "graph",
  }: {
    /** The graphs this page cooks, in the order it wants them offered. */
    initial: readonly { readonly name: string; readonly json: SerializedGraph }[];
    /** Thumbnail caption. The demo's own name reads better than "graph". */
    title?: string;
  } = $props();

  /**
   * The graphs, as STATE seeded from a prop rather than as the prop.
   *
   * A demo rebuilds its graph when its seed or its preset changes, and the
   * panel has to follow — but the host that does the rebuilding is plain
   * DOM (`panel.ts`), so there is no reactive prop for it to write. It
   * calls {@link setGraphs} instead, which is why this is a component
   * export and not a `$derived` of `initial`: reassigning here must WIN
   * over the prop, and a derived one would be recomputed back.
   */
  // svelte-ignore state_referenced_locally -- seeded once, then owned here
  let graphs = $state(initial);
  /**
   * How far the thumbnail will shrink before it starts cropping instead.
   *
   * 0.09 draws a node box 15px wide — enough to read the card as boxes
   * joined by cables, which is the whole job. Every graph in the demos
   * fits above this except the racetrack's, and that one is the reason
   * the floor exists.
   */
  const THUMB_FLOOR = 0.09;

  let open = $state(false);
  let selected = $state(0);

  /** Show a different set of graphs. Called by the plain-DOM host. */
  export function setGraphs(
    next: readonly { readonly name: string; readonly json: SerializedGraph }[],
  ): void {
    graphs = next;
    if (selected >= next.length) selected = 0;
    read();
  }

  /**
   * Read once on mount, and then kept.
   *
   * This used to wait for `requestIdleCallback`, on the reasoning that
   * laying out 238 nodes is work the page should not do on the frame it
   * mounts. THAT WAS A BUG, and a nasty one: an idle callback with no
   * timeout is a request, not a promise, and every page this panel sits on
   * runs a render loop that streams and cooks. Throttled to a machine 8x
   * slower than the one it was written on, the card sat BLACK for six
   * seconds waiting for an idle window the demo never left it — and there
   * is no bound on that, only the speed of the box you happen to test on.
   *
   * Reading synchronously costs 22ms median (52ms cold) once, for the
   * biggest graph in the repository, and under a millisecond for the other
   * five — against a first cook of 200ms that has already happened by the
   * time this mounts. So the scheduling bought nothing it was not already
   * getting, and cost the card six seconds of black on a slow machine:
   * the usual shape of an optimisation nobody measured.
   */
  let pictures = $state<(GraphPicture | null)[]>([]);

  const current = $derived(pictures[Math.min(selected, pictures.length - 1)] ?? null);
  const currentName = $derived(graphs[Math.min(selected, graphs.length - 1)]?.name ?? "");

  function read(): void {
    pictures = graphs.map((g) => {
      try {
        return readGraph(g.json);
      } catch {
        // A graph this view cannot lay out is one missing thumbnail, not
        // a broken demo. The card says so and the page carries on.
        return null;
      }
    });
  }

  onMount(read);

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      open = false;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- `pcg-graph-panel` is the hook `scripts/capture-demos.mjs` hides before
     it shoots: the committed screenshots are of the demos, and a graph in
     the corner of every one of them would be four pictures of the same
     card. -->
<div class="pcg-graph-panel">
  <button
    class="thumb"
    type="button"
    aria-label="show the {currentName || title} graph"
    onclick={() => (open = true)}
  >
    <span class="cap">
      <span class="name">{currentName || title}</span>
      <span class="count">
        {#if current}{current.nodes.length} nodes{:else}…{/if}
      </span>
    </span>
    <span class="frame">
      {#if current}
        <GraphView
          nodes={current.nodes}
          edges={current.edges}
          previews={current.previews}
          interactive={false}
          floor={THUMB_FLOOR}
          label="{currentName} graph, thumbnail"
        />
      {/if}
    </span>
  </button>
</div>

{#if open}
  <!-- The backdrop closes on its own click only: a click that started on
       the graph and ended out here is the end of a pan, not a dismissal. -->
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={(e) => e.target === e.currentTarget && (open = false)}
  >
    <div class="sheet" role="dialog" aria-modal="true" aria-label="{currentName} graph">
      <header>
        {#if graphs.length > 1}
          <div class="tabs" role="tablist" aria-label="graphs">
            {#each graphs as g, i (g.name)}
              <button
                type="button"
                role="tab"
                aria-selected={i === selected}
                class:on={i === selected}
                onclick={() => (selected = i)}>{g.name}</button
              >
            {/each}
          </div>
        {:else}
          <span class="heading">{currentName}</span>
        {/if}
        <span class="meta">
          {#if current}{current.nodes.length} nodes · {current.edges.length} connections{/if}
        </span>
        <button class="close" type="button" aria-label="close" onclick={() => (open = false)}
          >✕</button
        >
      </header>
      <div class="body">
        {#if current}
          <GraphView
            nodes={current.nodes}
            edges={current.edges}
            previews={current.previews}
            label="{currentName} graph"
          />
        {:else}
          <p class="empty">This graph could not be laid out.</p>
        {/if}
      </div>
      <!-- The gestures, said once. Read-only is not self-evident from a
           picture of a node graph — every other one you have used could be
           dragged — so the footer says what this one does instead of
           leaving you to discover what it does not. -->
      <footer>scroll to zoom · drag to pan · double-click to fit · read-only</footer>
    </div>
  </div>
{/if}

<style>
  .pcg-graph-panel {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 10;
  }
  /* Below the shared breakpoint the overlay becomes a full-width bottom
     sheet and owns this corner. See `shared/mobile.ts` — a Svelte <style>
     cannot interpolate the constant, so the query is spelled out. */
  @media (max-width: 700px), (max-height: 500px) {
    .pcg-graph-panel {
      display: none;
    }
  }
  .thumb {
    display: block;
    width: 220px;
    padding: 0;
    background: rgba(13, 17, 23, 0.88);
    border: 1px solid #2a3548;
    border-radius: 10px;
    color: #dbe4f0;
    font: 13px/1.45 system-ui, sans-serif;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    backdrop-filter: blur(6px);
  }
  .thumb:hover {
    border-color: #4c8dff;
  }
  .cap {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 6px 10px;
  }
  .name {
    font-size: 12px;
    color: #f0f4fa;
  }
  .count {
    font: 11px ui-monospace, monospace;
    color: #8b98ab;
  }
  .frame {
    display: block;
    height: 118px;
    border-top: 1px solid #223047;
    background: #05070a;
    /* A cropped thumbnail has to say it is cropped, or it reads as the
       whole graph with three nodes in it. The fade is the only cue that
       survives at this size — a border says "edge of the card", a fade
       says "edge of what fits". It costs nothing on a graph that fits,
       because there is nothing out there to fade. */
    mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.72);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    /* FULL WIDTH, no maximum. It was capped at 1400px, which on a 2560px
       monitor left 580px of bare backdrop down each side — 45% of the
       screen that looks like part of the graph view and swallows the
       wheel, because the wheel belongs to the SVG and the SVG stops at the
       cap. It read as "zoom does not work". A node graph has no reason to
       want less canvas than it is given, so there is nothing to trade off:
       the sheet takes the screen and the dead zone is gone with it. */
    width: 100%;
    height: 100%;
    background: #05070a;
    border: 1px solid #2a3548;
    border-radius: 10px;
    overflow: hidden;
    color: #dbe4f0;
    font: 13px/1.45 system-ui, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-bottom: 1px solid #223047;
  }
  .heading,
  .tabs {
    flex: 1 1 auto;
    min-width: 0;
  }
  .heading {
    color: #f0f4fa;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tabs button {
    padding: 3px 10px;
    background: #161d29;
    color: #aeb9c9;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  .tabs button.on {
    background: #26344a;
    color: #f0f4fa;
  }
  .meta {
    font: 11px ui-monospace, monospace;
    color: #8b98ab;
    white-space: nowrap;
  }
  .close {
    padding: 3px 8px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
  }
  .empty {
    margin: 24px;
    color: #8b98ab;
  }
  footer {
    padding: 6px 10px;
    border-top: 1px solid #223047;
    font: 11px ui-monospace, monospace;
    color: #8b98ab;
  }
</style>
