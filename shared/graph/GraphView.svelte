<script lang="ts">
  /**
   * A node graph you can LOOK at: the same boxes and cables the editor
   * draws, with the wheel and the drag, and nothing that changes the
   * graph.
   *
   * It is not the editor's canvas with its gestures switched off. The
   * canvas spends most of itself on the two things this cannot do — moving
   * a node and pulling a wire onto a pin — and a flag through the middle
   * of that would leave every gesture asking whether it was allowed to
   * happen. What the two genuinely share is underneath both: the boxes
   * (`NodeBox.svelte`), the cable geometry (`wires.ts`), the lens
   * (`viewport.ts`) and the layout. So the shared parts are shared, and
   * this component is only the read-only assembly of them.
   *
   * THE LEFT BUTTON PANS HERE, where the canvas reserves it for selection
   * and gives panning to the right. Nothing here is selectable, so the
   * button a pointer reaches for first is free, and a view that needed a
   * right-drag to move would read as broken. The right button is left to
   * the browser's own menu.
   */
  import NodeBox from "./NodeBox.svelte";
  import "./tokens.css";
  import {
    ACTUAL,
    centreAt,
    contentBounds,
    framed,
    toGraph,
    zoomAt,
    zoomFloor,
    type Viewport,
  } from "./viewport.js";
  import type { EdgeView, NodeView, ParamPreview } from "./view.js";
  import { edgeKind, edgePath } from "./wires.js";

  let {
    nodes,
    edges,
    previews = new Map(),
    interactive = true,
    floor,
    label = "node graph",
  }: {
    nodes: readonly NodeView[];
    edges: readonly EdgeView[];
    /** Node id → the param rows its box shows. */
    previews?: ReadonlyMap<string, readonly ParamPreview[]>;
    /**
     * Whether the wheel zooms and the pointer pans.
     *
     * `false` is the THUMBNAIL, which holds still: one that scrolled would
     * eat the page's wheel every time the pointer crossed it, and one that
     * panned would be a 220px window you could lose the graph inside of.
     */
    interactive?: boolean;
    /**
     * How far out this view may zoom, as a floor under the fit.
     *
     * An interactive view leaves it unset and gets {@link zoomFloor} — far
     * enough out to see the whole graph and no further. A thumbnail sets
     * one, because the honest fit for a wide graph in a small card draws
     * nothing at all; see {@link framed}.
     */
    floor?: number;
    label?: string;
  } = $props();

  let svgEl: SVGSVGElement | undefined = $state();
  let view = $state<Viewport>({ x: 0, y: 0, z: ACTUAL });
  let panning: { px: number; py: number; ox: number; oy: number } | null = null;

  const rowCounts = $derived(new Map([...previews].map(([id, rows]) => [id, rows.length])));
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));

  /** The floor in force right now: the caller's, or the whole graph. */
  function floorFor(b: ReturnType<typeof contentBounds>, r: DOMRect): number {
    return floor ?? zoomFloor(b, r);
  }

  /**
   * Frame the graph. Re-runs when the nodes change, so switching which
   * graph is shown opens on the new one rather than on where the old one
   * had been panned to.
   */
  export function fit(): void {
    if (!svgEl) return;
    const r = svgEl.getBoundingClientRect();
    // A zero-sized box measures nothing: the element is in the tree but
    // not laid out yet (a modal in the frame it opens). Framing against
    // it would strand the view at a scale derived from zero, so it waits
    // for the ResizeObserver below, which fires as soon as it has a size.
    if (r.width === 0 || r.height === 0) return;
    const b = contentBounds(nodes, rowCounts);
    // `preferActual` for an interactive view only. A graph that fits at 1:1
    // opens at 1:1, because the boxes were drawn at that size and a
    // three-node graph blown up to fill a 1340px panel reads as a mistake.
    // A thumbnail never wants it: 1:1 in a 220px card is one node.
    view = framed(b, r, { floor: floorFor(b, r), preferActual: interactive });
  }

  /** Back to 1:1, centred on the content rather than on wherever it drifted. */
  export function actualSize(): void {
    if (!svgEl) return;
    const b = contentBounds(nodes, rowCounts);
    view =
      b === null ? { x: 0, y: 0, z: ACTUAL } : centreAt(ACTUAL, b, svgEl.getBoundingClientRect());
  }

  $effect(() => {
    // Read what should re-frame the view, so the effect subscribes to it.
    void nodes;
    void floor;
    void interactive;
    fit();
  });

  $effect(() => {
    const el = svgEl;
    if (!el) return;
    // A thumbnail is sized by its card and a modal by the window, and
    // neither reports through a prop. Reframing on resize is also what
    // gets the first frame right: the element is measured as zero until
    // it is laid out, and this fires the moment it is not.
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  });

  function onWheel(e: WheelEvent): void {
    if (!interactive || !svgEl) return;
    e.preventDefault();
    const r = svgEl.getBoundingClientRect();
    // The same floor the fit used, so a wheel-out lands exactly on the
    // framing `fit()` gives and stops there rather than short of it.
    const floorNow = floorFor(contentBounds(nodes, rowCounts), r);
    view = zoomAt(view, r, e.clientX, e.clientY, e.deltaY, floorNow);
  }

  function onPointerDown(e: PointerEvent): void {
    if (!interactive || e.button !== 0) return;
    panning = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
    svgEl?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!panning) return;
    view = {
      ...view,
      x: panning.ox + (e.clientX - panning.px),
      y: panning.oy + (e.clientY - panning.py),
    };
  }

  function onPointerUp(): void {
    panning = null;
  }

  /**
   * Double-click frames the graph again. The only way home that needs no
   * chrome — a thumbnail has no room for a button and a modal should not
   * need one to undo a scroll.
   */
  function onDoubleClick(): void {
    if (interactive) fit();
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

<svg
  bind:this={svgEl}
  class="view"
  class:interactive
  role="img"
  aria-label={label}
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  ondblclick={onDoubleClick}
>
  <!-- `--hairline` keeps a node's border one screen pixel wide however far
       out the view is zoomed: the border is the box's silhouette, and a
       silhouette that vanishes at 0.2 zoom vanishes exactly when it is the
       only thing left to read. See the same note on the editor's canvas. -->
  <g
    transform="translate({view.x} {view.y}) scale({view.z})"
    style="--hairline: {Math.max(1, 1 / view.z)}"
  >
    {#each edges as edge (`${edge.from}.${edge.fromPin}->${edge.to}.${edge.toPin}`)}
      {@const d = edgePath(byId, edge)}
      {#if d}
        <!-- Casing under the line, painted first so the line sits on it. -->
        <path class="edge-casing" {d} />
        <path class="edge-line k-{edgeKind(byId, edge)}" {d} />
      {/if}
    {/each}
    {#each nodes as node (node.id)}
      <NodeBox {node} params={previews.get(node.id)} />
    {/each}
  </g>
</svg>

<style>
  .view {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
  }
  /* Only an interactive view takes the pointer. A thumbnail must let the
     click through to the card that opens it, and must not swallow the
     page's wheel. */
  .view.interactive {
    touch-action: none;
    cursor: grab;
  }
  .view.interactive:active {
    cursor: grabbing;
  }
  /**
   * A black casing under every cable, so it stays readable where it
   * crosses something bright — the graph is drawn over a live render, and
   * a mid-grey line is legible over the empty parts of a scene and
   * disappears the moment it passes through the scatter. Two strokes of
   * one path, the wider dark one first, is the trick a map uses to keep a
   * label off its own coastline.
   */
  .edge-casing {
    fill: none;
    stroke: #000000;
    stroke-width: 4;
  }
  .edge-line {
    fill: none;
    stroke: var(--ed-k-geometry);
    stroke-width: 1.6;
    opacity: 0.55;
  }
  /* The kinds that are not the substrate. `k-geometry` and `k-any` are
     deliberately absent: both resolve to the grey the base rule already
     paints. Measured across the graph corpus every edge is geometry to
     geometry, so these two rules are provision, not decoration — see the
     long note on the editor's canvas for the count. */
  .edge-line.k-instances {
    stroke: var(--ed-k-instances);
  }
  .edge-line.k-value {
    stroke: var(--ed-k-value);
  }
</style>
