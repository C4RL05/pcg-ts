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
    fill: #0e0e0e;
    stroke: var(--sb-edge);
    stroke-width: 1;
    cursor: grab;
  }
  .body:hover {
    stroke: #5e5e5e;
  }
  .selected .body {
    stroke: var(--sb-select);
  }
  .halo {
    fill: none;
    stroke: var(--sb-select);
    stroke-width: 1.5;
    opacity: 0.4;
    pointer-events: none;
  }
  .sep {
    stroke: var(--sb-rule);
    stroke-width: 1;
    pointer-events: none;
  }
  .title {
    fill: var(--sb-ink-hi);
    font: 600 11px var(--sb-sans);
    pointer-events: none;
  }
  .nodeid {
    fill: var(--sb-ink-faint);
    font: 9px var(--sb-mono);
    pointer-events: none;
  }
  .close {
    fill: var(--sb-ink-faint);
    font: 10px var(--sb-sans);
    text-anchor: end;
    cursor: pointer;
  }
  /* Nothing red left to warn with, so the delete target goes to full
     white on hover — the brightest thing on the box, which is the same
     "this one, and it is serious" the colour used to carry. */
  .close:hover {
    fill: #ffffff;
  }
  .pin {
    stroke: #000000;
    stroke-width: 1;
    pointer-events: none;
  }
  /* Kind by LIGHTNESS now. Instances are brightest: they are what a graph
     is usually built to produce, and the pin you look for first. */
  .k-geometry {
    fill: var(--sb-k-geometry);
  }
  .k-instances {
    fill: var(--sb-k-instances);
  }
  .k-value {
    fill: var(--sb-k-value);
  }
  .k-any {
    fill: var(--sb-k-any);
  }
  .pin-hit {
    fill: transparent;
    pointer-events: all;
  }
  .pin-hit.out {
    cursor: crosshair;
  }
  .pinlabel {
    fill: var(--sb-ink-dim);
    font: 9px var(--sb-mono);
    pointer-events: none;
  }
  .pinlabel.out {
    text-anchor: end;
  }
  .pkey {
    fill: var(--sb-ink-faint);
    font: 9px var(--sb-mono);
    pointer-events: none;
  }
  .pval {
    fill: var(--sb-ink-mid);
    font: 9px var(--sb-mono);
    text-anchor: end;
    pointer-events: none;
  }
  /* A field is white where a constant is grey. It used to be the value
     pin's green; with hue gone, the contrast has to come from brightness
     — and a field is the more notable of the two, so it takes the top. */
  .pval.field {
    fill: #ffffff;
  }
</style>
