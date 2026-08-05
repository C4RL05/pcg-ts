<script lang="ts">
  /**
   * SVG node canvas: renders node boxes and bezier edges, and implements
   * the two drag gestures — moving a node body and pulling a wire from an
   * output pin onto an input pin. Wires commit through the host's
   * onConnect (which asks the real Graph); clicking an edge removes it.
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

  const width = $derived(Math.max(1400, ...model.nodes.map((n) => n.x + NODE_W + 140)));
  const height = $derived(Math.max(520, ...model.nodes.map((n) => n.y + nodeHeight(n) + 90)));

  function local(e: PointerEvent): { x: number; y: number } {
    if (!svgEl) return { x: 0, y: 0 };
    const r = svgEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function nodeById(id: string): NodeView | undefined {
    return model.nodes.find((n) => n.id === id);
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
    const p = local(e);
    dragNode = { id: node.id, offX: p.x - node.x, offY: p.y - node.y };
  }

  function startWire(node: NodeView, pinName: string, index: number, e: PointerEvent): void {
    const x = node.x + NODE_W;
    const y = node.y + pinRowY(index);
    const p = local(e);
    wire = { from: node.id, fromPin: pinName, x1: x, y1: y, x2: p.x, y2: p.y, hover: null };
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragNode) {
      const p = local(e);
      onMove(dragNode.id, Math.max(4, p.x - dragNode.offX), Math.max(4, p.y - dragNode.offY));
    }
    if (wire) {
      const p = local(e);
      wire.x2 = p.x;
      wire.y2 = p.y;
    }
  }

  function onPointerUp(): void {
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
  {width}
  {height}
  class="canvas"
  role="application"
  aria-label="node graph canvas"
  onpointerdown={(e) => {
    if (e.target === svgEl) onSelect(null);
  }}
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
</svg>

<style>
  .canvas {
    display: block;
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
