<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * One node box on the SVG canvas: header (type + id + delete), input
   * pins on the left, output pins on the right, and a band of param
   * previews under them. Drag/connect gestures are reported to the Canvas
   * via callbacks; hit circles over the pins keep the targets comfortable.
   */
  import { HEADER_H, NODE_W, nodeHeight, paramBandY, paramRowY, pinRowY } from "./layout.js";
  import type { NodeView, ParamPreview } from "./model.js";

  let {
    node,
    selected,
    params = [],
    onSelect,
    onBodyDown,
    onDelete,
    onOutDown,
    onInEnter,
    onInLeave,
  }: {
    node: NodeView;
    selected: boolean;
    /** What this node's params currently read, as the box shows them. */
    params?: readonly ParamPreview[];
    onSelect: () => void;
    onBodyDown: (e: PointerEvent) => void;
    onDelete: () => void;
    onOutDown: (e: PointerEvent, pinName: string, index: number) => void;
    onInEnter: (pinName: string) => void;
    onInLeave: () => void;
  } = $props();

  const h = $derived(nodeHeight(node, params.length));
</script>

<g transform="translate({node.x}, {node.y})" class:selected>
  <!-- Selection is a HALO, not a heavier border. A thicker stroke changes
       the box's weight, so a selected node reads as a different kind of
       node rather than as the one you happen to be editing; a ring drawn
       outside the shape says "this one" without restating what it is.
       Behind the body and non-interactive, so it never eats a click. -->
  {#if selected}
    <rect class="halo" x="-3" y="-3" width={NODE_W + 6} height={h + 6} rx="10" />
  {/if}
  <rect
    class="body"
    width={NODE_W}
    height={h}
    rx="7"
    role="button"
    tabindex="-1"
    aria-label="node {node.id}"
    onpointerdown={(e) => {
      onSelect();
      onBodyDown(e);
    }}
  />
  <line class="sep" x1="0" y1={HEADER_H} x2={NODE_W} y2={HEADER_H} />
  <text class="title" x="9" y="13">{node.label ?? node.type}</text>
  <text class="nodeid" x="9" y="25">{node.id}</text>
  <text
    class="close"
    x={NODE_W - 9}
    y="14"
    role="button"
    tabindex="-1"
    aria-label="delete node {node.id}"
    onpointerdown={(e) => e.stopPropagation()}
    onclick={(e) => {
      e.stopPropagation();
      onDelete();
    }}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        onDelete();
      }
    }}>✕</text
  >
  {#each node.inputs as pin, i (pin.name)}
    <circle class="pin k-{pin.kind}" cx="0" cy={pinRowY(i)} r="4.5" />
    <circle
      class="pin-hit"
      cx="0"
      cy={pinRowY(i)}
      r="9"
      role="button"
      tabindex="-1"
      aria-label="input pin {pin.name}"
      onpointerenter={() => onInEnter(pin.name)}
      onpointerleave={() => onInLeave()}
    >
      <title>{pin.name} · {pin.kind}{pin.multi ? " · multi" : ""}</title>
    </circle>
    <text class="pinlabel in" x="10" y={pinRowY(i) + 3}>{pin.name}</text>
  {/each}
  {#each node.outputs as pin, i (pin.name)}
    <circle class="pin k-{pin.kind}" cx={NODE_W} cy={pinRowY(i)} r="4.5" />
    <circle
      class="pin-hit out"
      cx={NODE_W}
      cy={pinRowY(i)}
      r="9"
      role="button"
      tabindex="-1"
      aria-label="output pin {pin.name}"
      onpointerdown={(e) => {
        e.stopPropagation();
        onOutDown(e, pin.name, i);
      }}
    >
      <title>{pin.name} · {pin.kind} — drag to an input pin</title>
    </circle>
    <text class="pinlabel out" x={NODE_W - 10} y={pinRowY(i) + 3}>{pin.name}</text>
  {/each}
  {#if params.length > 0}
    <line class="sep" x1="9" y1={paramBandY(node)} x2={NODE_W - 9} y2={paramBandY(node)} />
    {#each params as p, i (p.key + p.value)}
      <text class="pkey" x="9" y={paramRowY(node, i)}>{p.key}</text>
      <text class="pval" class:field={p.field} x={NODE_W - 9} y={paramRowY(node, i)}>{p.value}</text>
    {/each}
  {/if}
</g>

<style>
  .body {
    fill: #131a26;
    stroke: #33405a;
    stroke-width: 1;
    cursor: grab;
  }
  .body:hover {
    stroke: #4a5b7d;
  }
  .selected .body {
    stroke: #4c8dff;
  }
  .halo {
    fill: none;
    stroke: #4c8dff;
    stroke-width: 1.5;
    opacity: 0.35;
    pointer-events: none;
  }
  .sep {
    stroke: #223047;
    stroke-width: 1;
    pointer-events: none;
  }
  .title {
    fill: #eaf1fa;
    font: 600 11px system-ui, sans-serif;
    pointer-events: none;
  }
  .nodeid {
    fill: #6f7c8f;
    font: 9px ui-monospace, monospace;
    pointer-events: none;
  }
  .close {
    fill: #6f7c8f;
    font: 10px system-ui, sans-serif;
    text-anchor: end;
    cursor: pointer;
  }
  .close:hover {
    fill: #ff9ca8;
  }
  .pin {
    stroke: #0d1117;
    stroke-width: 1;
    pointer-events: none;
  }
  .k-geometry {
    fill: #6fb1ff;
  }
  .k-instances {
    fill: #ffb86f;
  }
  .k-value {
    fill: #b8f5c8;
  }
  .k-any {
    fill: #c8c8d8;
  }
  .pin-hit {
    fill: transparent;
    pointer-events: all;
  }
  .pin-hit.out {
    cursor: crosshair;
  }
  .pinlabel {
    fill: #8b98ab;
    font: 9px ui-monospace, monospace;
    pointer-events: none;
  }
  .pinlabel.out {
    text-anchor: end;
  }
  .pkey {
    fill: #6f7c8f;
    font: 9px ui-monospace, monospace;
    pointer-events: none;
  }
  .pval {
    fill: #aeb9c9;
    font: 9px ui-monospace, monospace;
    text-anchor: end;
    pointer-events: none;
  }
  /* A field reads in the pin palette's `value` green — the same colour a
     value pin carries, because it is the same idea arriving by a
     different route. */
  .pval.field {
    fill: #b8f5c8;
  }
</style>
