<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * One node box on the SVG canvas: header (type + id + delete), input
   * pins on the left, output pins on the right. Drag/connect gestures are
   * reported to the Canvas via callbacks; hit circles over the pins keep
   * the targets comfortable.
   */
  import { HEADER_H, NODE_W, nodeHeight, pinRowY } from "./layout.js";
  import type { NodeView } from "./model.js";

  let {
    node,
    selected,
    onSelect,
    onBodyDown,
    onDelete,
    onOutDown,
    onInEnter,
    onInLeave,
  }: {
    node: NodeView;
    selected: boolean;
    onSelect: () => void;
    onBodyDown: (e: PointerEvent) => void;
    onDelete: () => void;
    onOutDown: (e: PointerEvent, pinName: string, index: number) => void;
    onInEnter: (pinName: string) => void;
    onInLeave: () => void;
  } = $props();

  const h = $derived(nodeHeight(node));
</script>

<g transform="translate({node.x}, {node.y})">
  <rect
    class="body"
    class:selected
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
</g>

<style>
  .body {
    fill: #131a26;
    stroke: #33405a;
    stroke-width: 1;
    cursor: grab;
  }
  .body.selected {
    stroke: #4c8dff;
    stroke-width: 1.5;
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
</style>
