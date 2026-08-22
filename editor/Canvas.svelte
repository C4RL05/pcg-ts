<script lang="ts">
  /**
   * SVG node canvas: renders node boxes and bezier edges, and implements
   * the two drag gestures — moving a node body and pulling a wire from an
   * output pin onto an input pin. Wires commit through the host's
   * onConnect (which asks the real Graph); clicking an edge removes it.
   *
   * The view pans with the right button and zooms on the wheel. It is a
   * transform on a group rather than a scrolled oversized SVG, which is
   * what the canvas used to be: scrollbars cannot zoom, and an SVG sized
   * to the content jumps under the cursor whenever a node is dragged past
   * its edge. Every gesture works in GRAPH coordinates — `toGraph` undoes
   * the view — so node positions stay in the model's own units and a
   * saved graph does not remember where someone had scrolled to.
   *
   * The canvas has no ground of its own: it is drawn over the render, and
   * a grid on top of a scene reads as a screen door rather than as depth.
   */
  import NodeBox from "../shared/graph/NodeBox.svelte";
  import { NODE_W, pinRowY } from "../shared/graph/layout.js";
  import {
    ACTUAL,
    centreAt,
    clampZoom,
    contentBounds,
    fitZoom,
    toGraph as toGraphUnits,
    zoomAt,
    type Bounds,
    type Viewport,
  } from "../shared/graph/viewport.js";
  import { curve, edgeKind as kindOf, edgePath as pathOf } from "../shared/graph/wires.js";
  import type { EdgeView, NodeView, ParamPreview, StructureModel } from "./model.js";

  let {
    model,
    selectedId,
    previews,
    onSelect,
    onMove,
    onConnect,
    onDeleteEdge,
  }: {
    model: StructureModel;
    selectedId: string | null;
    /**
     * Node id → the param rows its box shows. Handed down rather than read
     * here: it is rebuilt once per param revision by the component that
     * owns that revision, and rebuilding it per node per frame would put a
     * walk of the graph inside a drag.
     */
    previews: ReadonlyMap<string, readonly ParamPreview[]>;
    onSelect: (id: string | null) => void;
    onMove: (id: string, x: number, y: number) => void;
    onConnect: (edge: EdgeView) => void;
    onDeleteEdge: (index: number) => void;
  } = $props();

  let svgEl: SVGSVGElement | undefined = $state();
  /** Pan in screen px, and scale. Purely a view: never written to the model. */
  let view = $state<Viewport>({ x: 0, y: 0, z: ACTUAL });
  let panning: { px: number; py: number; ox: number; oy: number } | null = null;
  let dragNode = $state<{ id: string; offX: number; offY: number } | null>(null);
  let wire = $state<{
    from: string;
    fromPin: string;
    /** Kind of the pin it was pulled from, so the wire shows what it carries. */
    kind: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    hover: { to: string; toPin: string } | null;
  } | null>(null);

  /** Pointer position in graph units — the space node x/y live in. */
  function toGraph(e: { clientX: number; clientY: number }): { x: number; y: number } {
    if (!svgEl) return { x: 0, y: 0 };
    return toGraphUnits(view, svgEl.getBoundingClientRect(), e.clientX, e.clientY);
  }

  function onWheel(e: WheelEvent): void {
    if (!svgEl) return;
    e.preventDefault();
    view = zoomAt(view, svgEl.getBoundingClientRect(), e.clientX, e.clientY, e.deltaY);
  }

  function startPan(e: PointerEvent): void {
    panning = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
    svgEl?.setPointerCapture(e.pointerId);
  }

  /** Client px → graph units, for whoever needs to place something there. */
  export function graphPointAt(clientX: number, clientY: number): { x: number; y: number } {
    return toGraph({ clientX, clientY });
  }

  /** How tall each box's param band is — what `contentBounds` measures by. */
  const rowCounts = $derived(new Map([...previews].map(([id, rows]) => [id, rows.length])));

  function bounds(): Bounds | null {
    return contentBounds(model.nodes, rowCounts);
  }

  /**
   * Frame the graph, so a pan that wandered off is one click from home.
   *
   * `preferActual` opens at 1:1 WHEN THE GRAPH FITS THERE, and only falls
   * back to shrinking when it does not. That is what a load wants: most
   * graphs are a handful of nodes and have no business being scaled at
   * all, and a box drawn at the size it was designed at is the one that
   * reads best. The big pipelines still get fitted, because the
   * alternative is opening on a corner of something you cannot navigate.
   *
   * The "fit" button passes nothing and always fits, because a control
   * named fit that declines to fit is a broken control.
   */
  export function resetView(opts: { preferActual?: boolean } = {}): void {
    if (!svgEl) return;
    const b = bounds();
    if (b === null) {
      view = { x: 0, y: 0, z: ACTUAL };
      return;
    }
    const r = svgEl.getBoundingClientRect();
    const fit = fitZoom(b, r);
    // `fit >= ACTUAL` is exactly "the content fits at 1:1 with its padding".
    view =
      opts.preferActual === true && fit >= ACTUAL
        ? centreAt(ACTUAL, b, r)
        : centreAt(clampZoom(fit), b, r);
  }

  /**
   * Back to 1:1, whatever the graph's size. Centred on the content rather
   * than on wherever the view had drifted, so it is a way HOME and not
   * just a scale change — the same promise "fit" makes, at a fixed zoom.
   */
  export function actualSize(): void {
    if (!svgEl) return;
    const b = bounds();
    view =
      b === null ? { x: 0, y: 0, z: ACTUAL } : centreAt(ACTUAL, b, svgEl.getBoundingClientRect());
  }

  /**
   * Indexed rather than scanned. Every edge's path is recomputed on every
   * pointermove of a node drag, and each lookup used to walk the reactive
   * node array — one signal read per node per edge per event. The map
   * reads only `id`, so dragging (which moves x/y) does not rebuild it.
   */
  const byId = $derived(new Map(model.nodes.map((n) => [n.id, n])));

  function edgePath(e: EdgeView): string | null {
    return pathOf(byId, e);
  }

  function edgeKind(e: EdgeView): string {
    return kindOf(byId, e);
  }

  function startBodyDrag(node: NodeView, e: PointerEvent): void {
    const p = toGraph(e);
    dragNode = { id: node.id, offX: p.x - node.x, offY: p.y - node.y };
  }

  function startWire(node: NodeView, pinName: string, index: number, e: PointerEvent): void {
    const x = node.x + NODE_W;
    const y = node.y + pinRowY(index);
    const p = toGraph(e);
    const kind = node.outputs.find((pin) => pin.name === pinName)?.kind ?? "any";
    wire = { from: node.id, fromPin: pinName, kind, x1: x, y1: y, x2: p.x, y2: p.y, hover: null };
  }

  function onPointerMove(e: PointerEvent): void {
    if (panning) {
      view = {
        ...view,
        x: panning.ox + (e.clientX - panning.px),
        y: panning.oy + (e.clientY - panning.py),
      };
      return;
    }
    if (dragNode) {
      /**
       * UNCLAMPED, both axes. These used to be floored at graph
       * coordinate 4, which put a wall along the top and left edges: a
       * node could be dragged down and right forever but never above the
       * first row it was laid out in.
       *
       * The floor made sense when the canvas was a scrolled oversized
       * SVG, where a negative coordinate was genuinely unreachable. It
       * pans and zooms now — the origin is not a corner, it is just a
       * place — so negative coordinates are as visible as any other, and
       * `resetView` measures the real min/max so "fit" frames them.
       */
      const p = toGraph(e);
      onMove(dragNode.id, p.x - dragNode.offX, p.y - dragNode.offY);
    }
    if (wire) {
      const p = toGraph(e);
      wire.x2 = p.x;
      wire.y2 = p.y;
    }
  }

  function onPointerUp(): void {
    panning = null;
    if (wire) {
      if (wire.hover) {
        onConnect({ from: wire.from, fromPin: wire.fromPin, to: wire.hover.to, toPin: wire.hover.toPin });
      }
      wire = null;
    }
    dragNode = null;
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

<svg
  bind:this={svgEl}
  class="canvas"
  role="application"
  aria-label="node graph canvas"
  onwheel={onWheel}
  oncontextmenu={(e) => e.preventDefault()}
  onpointerdown={(e) => {
    // Right button pans from anywhere, including over a node — otherwise
    // a crowded graph has nowhere left to grab.
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.target === svgEl) onSelect(null);
  }}
>
  <!-- A HAIRLINE FLOOR, in graph units, inherited by everything below.
       Strokes here are authored in graph units and so scale with the
       view: a 1-unit node border is 1 screen px at 100% and 0.2 of one at
       the 0.2 zoom floor, which is not a faint line but no line at all —
       the boxes lose their edges exactly when a big graph is zoomed out
       far enough that the silhouette is all you have left to read.

       `max(1, 1/z)` is a floor and nothing more: at and above 100% it is
       1 unit and the border scales with everything else, and below it
       grows in graph units at just the rate that keeps it one screen
       pixel. A custom property rather than a prop because it has to reach
       every NodeBox and every rule inside one, and CSS variables inherit
       through the SVG tree for free. -->
  <g
    transform="translate({view.x} {view.y}) scale({view.z})"
    style="--hairline: {Math.max(1, 1 / view.z)}"
  >
  {#each model.edges as edge, i}
    {@const d = edgePath(edge)}
    {#if d}
      <g class="edge">
        <path
          class="edge-hit"
          {d}
          role="button"
          tabindex="-1"
          aria-label="disconnect {edge.from}.{edge.fromPin} → {edge.to}.{edge.toPin}"
          onclick={() => onDeleteEdge(i)}
          onkeydown={(e) => e.key === "Enter" && onDeleteEdge(i)}
        >
          <title>{edge.from}.{edge.fromPin} → {edge.to}.{edge.toPin} — click to disconnect</title>
        </path>
        <!-- Casing under the line, painted first so the line sits on it. -->
        <path class="edge-casing" {d} />
        <path class="edge-line k-{edgeKind(edge)}" {d} />
      </g>
    {/if}
  {/each}
  {#if wire}
    {@const wd = curve({ x: wire.x1, y: wire.y1 }, { x: wire.x2, y: wire.y2 })}
    <path class="edge-casing" d={wd} />
    <path class="wire k-{wire.kind}" class:live={wire.hover !== null} d={wd} />
  {/if}
  {#each model.nodes as node (node.id)}
    <NodeBox
      {node}
      selected={node.id === selectedId}
      params={previews.get(node.id)}
      onSelect={() => onSelect(node.id)}
      onBodyDown={(e) => startBodyDrag(node, e)}
      onOutDown={(e, pinName, i) => startWire(node, pinName, i, e)}
      onInEnter={(pinName) => {
        if (wire) wire.hover = { to: node.id, toPin: pinName };
      }}
      onInLeave={() => {
        if (wire) wire.hover = null;
      }}
    />
  {/each}
  </g>
  <!-- Outside the view transform: an empty canvas has no content to be
       positioned relative to, and a hint that pans away from the viewport
       is a hint nobody reads. -->
  {#if model.nodes.length === 0}
    <text class="blank" x="50%" y="50%">press Tab to add a node</text>
  {/if}
</svg>

<style>
  .canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The right button pans, so the browser menu would fire on release of
       every pan. `oncontextmenu` cancels it; this stops the drag being
       read as a text selection on the way. */
    user-select: none;
    touch-action: none;
  }
  /**
   * A cable takes the colour of the KIND it carries, from the same four
   * `--ed-k-*` tokens the pin dots use — one vocabulary, so the dot you
   * drag from and the line you drag out of it are the same colour.
   *
   * IT IS INERT TODAY, AND THAT IS A MEASUREMENT, NOT AN OVERSIGHT.
   * Every input pin in the shipped library is `geometry` (39 of 39), and
   * the three other kinds appear only on outputs: `instances` and `value`
   * are terminal — no input accepts them, so they can never BE a cable —
   * and `any` is declared by exactly one node, `dataInput`, which no
   * graph in the corpus uses. `any` is the only one of the three that a
   * cable could ever carry, and it can reach one more way than that count
   * suggests: `subgraph` and `forEach` derive their pins from the nodes
   * they wrap, so a wrapper around a `dataInput` exposes an `any` output
   * too. Still nothing in the corpus. Measured over `graphs/`, resolving
   * the wrappers' derived pins rather than their empty declared ones: 445
   * edges, 445 of them geometry->geometry. So every cable is grey, and
   * the two hues below only ever reach the canvas through the pin dots,
   * and through the wire being dragged out of one.
   *
   * The mapping is kept anyway because it costs one class per path and it
   * is the thing that would otherwise be missing on the day an input pin
   * stops being geometry — but do not read a coloured graph into it, and
   * do not spend a hue on `geometry` to make the feature "show up". The
   * substrate is not a mark.
   */
  /**
   * A black casing under every wire, so a cable stays readable where it
   * crosses something bright.
   *
   * The graph is drawn OVER the live render, and the render is white
   * points on black — so a mid-grey cable is legible over the empty parts
   * of the scene and disappears the moment it passes through the scatter.
   * Two strokes of the same path, the wider dark one painted first, is the
   * trick a map uses to keep a label off its own coastline.
   *
   * It costs nothing where it is not needed: black on the black page is
   * invisible, so the casing only shows up against bright content.
   */
  .edge-casing {
    fill: none;
    stroke: #000000;
    stroke-width: 4;
    pointer-events: none;
  }
  /* Keep pace with the line, which thickens to 2.4 under the pointer. */
  .edge:hover .edge-casing {
    stroke-width: 5;
  }
  /* The opacity composites against the CASING now, not against whatever
     the wire happens to be crossing — so a cable is one colour along its
     whole length instead of washing out over the bright half. */
  .edge-line {
    fill: none;
    stroke: var(--ed-k-geometry);
    stroke-width: 1.6;
    opacity: 0.55;
    pointer-events: none;
  }
  /* The kinds that are not the substrate. `k-geometry` and `k-any` are
     deliberately absent: both resolve to the grey the base rule already
     paints, and a rule that restates its default is one more place for
     the two to drift apart. */
  .edge-line.k-instances,
  .wire.k-instances {
    stroke: var(--ed-k-instances);
  }
  .edge-line.k-value,
  .wire.k-value {
    stroke: var(--ed-k-value);
  }
  .edge-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: pointer;
  }
  /* Same reasoning as the node box's: `tabindex="-1"`, so clicking focuses
     it and Chrome paints its rounded `outline: auto` ring along the wire,
     and no keyboard path exists that the ring would serve. */
  .edge-hit:focus {
    outline: none;
  }
  /* Hovering an edge offers to CUT it. That used to be a red; with hue
     gone it is white and noticeably thicker, so the signal is weight
     rather than warmth. */
  .edge:hover .edge-line {
    stroke: #ffffff;
    stroke-width: 2.4;
    opacity: 1;
  }
  .wire {
    fill: none;
    stroke: var(--ed-ink-dim);
    stroke-width: 1.6;
    stroke-dasharray: 5 4;
    opacity: 0.55;
    pointer-events: none;
  }
  /* Over a pin it will actually connect to. Dashed-and-faint means "going
     nowhere yet"; solid, white and full strength means releasing here
     makes the connection. */
  .wire.live {
    stroke: #ffffff;
    stroke-dasharray: none;
    stroke-width: 2.4;
    opacity: 1;
  }
  .blank {
    fill: var(--ed-ink-ghost);
    font: var(--ed-t-body) var(--ed-sans);
    text-anchor: middle;
    pointer-events: none;
  }
</style>
