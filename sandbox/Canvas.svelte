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
  import NodeBox from "./NodeBox.svelte";
  import { NODE_W, nodeHeight, pinRowY } from "./layout.js";
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
  let view = $state({ x: 0, y: 0, z: 1 });
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

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2.5;
  /** One graph unit to one screen pixel — the size the boxes were drawn at. */
  const ACTUAL = 1;
  /** Breathing room between the framed content and the viewport edge. */
  const PAD = 40;

  /** Pointer position in graph units — the space node x/y live in. */
  function toGraph(e: { clientX: number; clientY: number }): { x: number; y: number } {
    if (!svgEl) return { x: 0, y: 0 };
    const r = svgEl.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.z, y: (e.clientY - r.top - view.y) / view.z };
  }

  /**
   * Zoom about the pointer: the graph point under the cursor is the one
   * that must not move, which is what makes a wheel feel like a lens
   * rather than a scrollbar.
   */
  function onWheel(e: WheelEvent): void {
    if (!svgEl) return;
    e.preventDefault();
    const r = svgEl.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.z * Math.exp(-e.deltaY * 0.0015)));
    const k = next / view.z;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.z = next;
  }

  function startPan(e: PointerEvent): void {
    panning = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y };
    svgEl?.setPointerCapture(e.pointerId);
  }

  /** Client px → graph units, for whoever needs to place something there. */
  export function graphPointAt(clientX: number, clientY: number): { x: number; y: number } {
    return toGraph({ clientX, clientY });
  }

  /** The nodes' bounding box in graph units, or null when there are none. */
  function contentBounds(): { minX: number; minY: number; w: number; h: number } | null {
    if (model.nodes.length === 0) return null;
    const minX = Math.min(...model.nodes.map((n) => n.x));
    const minY = Math.min(...model.nodes.map((n) => n.y));
    const maxX = Math.max(...model.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(
      ...model.nodes.map((n) => n.y + nodeHeight(n, previews.get(n.id)?.length ?? 0)),
    );
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }

  /** Put the content in the middle of the viewport at zoom `z`. */
  function centreAt(
    z: number,
    b: { minX: number; minY: number; w: number; h: number },
    r: DOMRect,
  ): void {
    view = { z, x: (r.width - b.w * z) / 2 - b.minX * z, y: (r.height - b.h * z) / 2 - b.minY * z };
  }

  /** The zoom at which the whole graph just fits, ignoring the clamps. */
  function fitZoom(b: { w: number; h: number }, r: DOMRect): number {
    return Math.min((r.width - PAD * 2) / b.w, (r.height - PAD * 2) / b.h);
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
    const b = contentBounds();
    if (b === null) {
      view = { x: 0, y: 0, z: ACTUAL };
      return;
    }
    const r = svgEl.getBoundingClientRect();
    const fit = fitZoom(b, r);
    // `fit >= ACTUAL` is exactly "the content fits at 1:1 with its padding".
    if (opts.preferActual === true && fit >= ACTUAL) {
      centreAt(ACTUAL, b, r);
      return;
    }
    centreAt(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit)), b, r);
  }

  /**
   * Back to 1:1, whatever the graph's size. Centred on the content rather
   * than on wherever the view had drifted, so it is a way HOME and not
   * just a scale change — the same promise "fit" makes, at a fixed zoom.
   */
  export function actualSize(): void {
    if (!svgEl) return;
    const b = contentBounds();
    if (b === null) {
      view = { x: 0, y: 0, z: ACTUAL };
      return;
    }
    centreAt(ACTUAL, b, svgEl.getBoundingClientRect());
  }

  /**
   * Indexed rather than scanned. Every edge's path is recomputed on every
   * pointermove of a node drag, and each lookup used to walk the reactive
   * node array — one signal read per node per edge per event. The map
   * reads only `id`, so dragging (which moves x/y) does not rebuild it.
   */
  const byId = $derived(new Map(model.nodes.map((n) => [n.id, n])));

  function nodeById(id: string): NodeView | undefined {
    return byId.get(id);
  }

  function pinPos(id: string, pinName: string, side: "in" | "out"): { x: number; y: number } | null {
    const node = nodeById(id);
    if (!node) return null;
    const pins = side === "in" ? node.inputs : node.outputs;
    const i = pins.findIndex((p) => p.name === pinName);
    if (i < 0) return null;
    return { x: node.x + (side === "out" ? NODE_W : 0), y: node.y + pinRowY(i) };
  }

  function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
    const dx = Math.max(46, Math.min(130, Math.abs(b.x - a.x) * 0.5));
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  function edgePath(e: EdgeView): string | null {
    const a = pinPos(e.from, e.fromPin, "out");
    const b = pinPos(e.to, e.toPin, "in");
    return a && b ? curve(a, b) : null;
  }

  /**
   * The kind a cable CARRIES, read off the output pin it leaves from.
   *
   * The source pin and not the target: a connection is only legal when
   * the two agree (or one is the `any` wildcard), so the source is the
   * side that always names something concrete. The fallback is `any`
   * rather than `geometry` — a cable whose source pin cannot be found is
   * a cable of unknown kind, and guessing the common one would draw a
   * confident answer to a question that failed. It is unreachable in
   * practice: `edgePath` already returns null for a missing endpoint.
   */
  function edgeKind(e: EdgeView): string {
    return nodeById(e.from)?.outputs.find((p) => p.name === e.fromPin)?.kind ?? "any";
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
      view.x = panning.ox + (e.clientX - panning.px);
      view.y = panning.oy + (e.clientY - panning.py);
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
  <g transform="translate({view.x} {view.y}) scale({view.z})">
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
   * `--sb-k-*` tokens the pin dots use — one vocabulary, so the dot you
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
    stroke: var(--sb-k-geometry);
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
    stroke: var(--sb-k-instances);
  }
  .edge-line.k-value,
  .wire.k-value {
    stroke: var(--sb-k-value);
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
    stroke: var(--sb-ink-dim);
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
    fill: var(--sb-ink-ghost);
    font: var(--sb-t-body) var(--sb-sans);
    text-anchor: middle;
    pointer-events: none;
  }
</style>
