<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * One node box on the SVG canvas: header (type + id + delete), input
   * pins on the left, output pins on the right, and a band of param
   * previews under them. Drag/connect gestures are reported to the Canvas
   * via callbacks; hit circles over the pins keep the targets comfortable.
   */
  import {
    HEADER_H,
    ID_Y,
    NODE_W,
    PAD,
    TITLE_Y,
    nodeHeight,
    paramBandY,
    paramRowY,
    pinRowY,
  } from "./layout.js";
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
  <!-- Square. No `rx`, and no halo ring behind it: selection is carried by
       the border's colour alone, so the shape a node has when selected is
       the shape it has the rest of the time. -->
  <rect
    class="body"
    width={NODE_W}
    height={h}
    role="button"
    tabindex="-1"
    aria-label="node {node.id}"
    onpointerdown={(e) => {
      onSelect();
      onBodyDown(e);
    }}
  />
  <line class="sep" x1="0" y1={HEADER_H} x2={NODE_W} y2={HEADER_H} />
  <text class="title" x={PAD} y={TITLE_Y}>{node.label ?? node.type}</text>
  <text class="nodeid" x={PAD} y={ID_Y}>{node.id}</text>
  <!-- Shares the title's baseline rather than being centred on the band:
       two glyphs on one line is what reads as aligned. -->
  <text
    class="close"
    x={NODE_W - PAD}
    y={TITLE_Y}
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
    <line class="sep" x1={PAD} y1={paramBandY(node)} x2={NODE_W - PAD} y2={paramBandY(node)} />
    {#each params as p, i (p.key + p.value)}
      <text class="pkey" x={PAD} y={paramRowY(node, i)}>{p.key}</text>
      <text class="pval" class:field={p.field} x={NODE_W - PAD} y={paramRowY(node, i)}>
        {p.value}
      </text>
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
  /**
   * No UA focus ring on any of these.
   *
   * Every interactive shape in this box carries `tabindex="-1"` — it is
   * focusable by script and by click, and unreachable by Tab. Clicking one
   * still focuses it, and Chrome answers with `outline-style: auto`: its
   * own ring, ROUNDED, and drawn in the browser's colour rather than the
   * one `outline-color` computes to. On a selected node that landed as a
   * white rounded rectangle sitting inside the square green border — two
   * selection indicators disagreeing about both shape and colour.
   *
   * Suppressing it costs no keyboard affordance, because there is no
   * keyboard path to these elements to begin with. The graph's own
   * selection state is the indicator.
   */
  .body:focus,
  .close:focus,
  .pin-hit:focus {
    outline: none;
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
