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
  import type { EdgeView, NodeView, StructureModel } from "./model.js";

  let {
    model,
    selectedId,
    onSelect,
    onMove,
    onConnect,
    onDeleteEdge,
    onDeleteNode,
  }: {
    model: StructureModel;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onMove: (id: string, x: number, y: number) => void;
    onConnect: (edge: EdgeView) => void;
    onDeleteEdge: (index: number) => void;
    onDeleteNode: (id: string) => void;
  } = $props();

  let svgEl: SVGSVGElement | undefined = $state();
  /** Pan in screen px, and scale. Purely a view: never written to the model. */
  let view = $state({ x: 0, y: 0, z: 1 });
  let panning: { px: number; py: number; ox: number; oy: number } | null = null;
  let dragNode = $state<{ id: string; offX: number; offY: number } | null>(null);
  let wire = $state<{
    from: string;
    fromPin: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    hover: { to: string; toPin: string } | null;
  } | null>(null);

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2.5;

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

  /** Frame every node, so a pan that wandered off is one click from home. */
  export function resetView(): void {
    if (!svgEl || model.nodes.length === 0) {
      view = { x: 0, y: 0, z: 1 };
      return;
    }
    const r = svgEl.getBoundingClientRect();
    const minX = Math.min(...model.nodes.map((n) => n.x));
    const minY = Math.min(...model.nodes.map((n) => n.y));
    const maxX = Math.max(...model.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...model.nodes.map((n) => n.y + nodeHeight(n)));
    const pad = 40;
    const z = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY))),
    );
    view = {
      z,
      x: (r.width - (maxX - minX) * z) / 2 - minX * z,
      y: (r.height - (maxY - minY) * z) / 2 - minY * z,
    };
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

  function startBodyDrag(node: NodeView, e: PointerEvent): void {
    const p = toGraph(e);
    dragNode = { id: node.id, offX: p.x - node.x, offY: p.y - node.y };
  }

  function startWire(node: NodeView, pinName: string, index: number, e: PointerEvent): void {
    const x = node.x + NODE_W;
    const y = node.y + pinRowY(index);
    const p = toGraph(e);
    wire = { from: node.id, fromPin: pinName, x1: x, y1: y, x2: p.x, y2: p.y, hover: null };
  }

  function onPointerMove(e: PointerEvent): void {
    if (panning) {
      view.x = panning.ox + (e.clientX - panning.px);
      view.y = panning.oy + (e.clientY - panning.py);
      return;
    }
    if (dragNode) {
      const p = toGraph(e);
      onMove(dragNode.id, Math.max(4, p.x - dragNode.offX), Math.max(4, p.y - dragNode.offY));
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
        <path class="edge-line" {d} />
      </g>
    {/if}
  {/each}
  {#if wire}
    <path class="wire" class:live={wire.hover !== null} d={curve({ x: wire.x1, y: wire.y1 }, { x: wire.x2, y: wire.y2 })} />
  {/if}
  {#each model.nodes as node (node.id)}
    <NodeBox
      {node}
      selected={node.id === selectedId}
      onSelect={() => onSelect(node.id)}
      onBodyDown={(e) => startBodyDrag(node, e)}
      onDelete={() => onDeleteNode(node.id)}
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
  .edge-line {
    fill: none;
    stroke: #4c8dff;
    stroke-width: 1.6;
    opacity: 0.85;
    pointer-events: none;
  }
  .edge-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: pointer;
  }
  .edge:hover .edge-line {
    stroke: #ff9ca8;
  }
  .wire {
    fill: none;
    stroke: #8b98ab;
    stroke-width: 1.6;
    stroke-dasharray: 5 4;
    pointer-events: none;
  }
  .wire.live {
    stroke: #b8f5c8;
  }
</style>
