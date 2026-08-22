<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * One node box on the SVG canvas: header (type + id), input pins on the
   * left, output pins on the right, and a band of param previews under
   * them. Drag/connect gestures are reported to the Canvas via callbacks;
   * hit circles over the pins keep the targets comfortable.
   *
   * THE GESTURES ARE OPTIONAL, and a box drawn without them is not a
   * disabled box — it is a box with nothing to disable. The read-only view
   * the demos show passes none, and then the hit circles are not rendered
   * at all rather than rendered inert: an invisible 9-unit target that
   * answers nothing is a place the pointer changes shape over for no
   * reason, and on a thumbnail it is most of the box.
   *
   * There is no delete affordance ON the box. Deleting has two homes
   * already — the button in the node panel and the Delete key over a
   * selection — and a third one, a 10px glyph sitting in the corner of a
   * draggable target, was the only one you could hit by accident.
   */
  import { CATEGORY_ICONS } from "./icons.js";
  import {
    HEADER_H,
    ICON_SIZE,
    ICON_X,
    ICON_Y,
    ID_Y,
    NODE_RADIUS,
    NODE_W,
    PAD,
    TEXT_X,
    TITLE_Y,
    nodeHeight,
    paramBandY,
    paramRowY,
    pinRowY,
  } from "./layout.js";
  import type { NodeView, ParamPreview } from "./view.js";

  let {
    node,
    selected = false,
    params = [],
    onSelect,
    onBodyDown,
    onOutDown,
    onInEnter,
    onInLeave,
  }: {
    node: NodeView;
    selected?: boolean;
    /** What this node's params currently read, as the box shows them. */
    params?: readonly ParamPreview[];
    /**
     * The editing gestures. All five together or none of them: a canvas
     * that can move a node can also wire it, and one that can do neither
     * is the read-only view. `onBodyDown` is the one tested for, because
     * it is the one every other gesture starts from.
     */
    onSelect?: () => void;
    onBodyDown?: (e: PointerEvent) => void;
    onOutDown?: (e: PointerEvent, pinName: string, index: number) => void;
    onInEnter?: (pinName: string) => void;
    onInLeave?: () => void;
  } = $props();

  const interactive = $derived(onBodyDown !== undefined);

  const h = $derived(nodeHeight(node, params.length));
  /**
   * The category glyph, or nothing. Two ways to get nothing: a type that
   * declares no category, and a category with no icon assigned — both
   * draw a blank corner rather than a placeholder, because a blank reads
   * as "no category" and a question mark reads as "the icon broke".
   */
  const icon = $derived(node.category === undefined ? undefined : CATEGORY_ICONS[node.category]);
  /** 256-unit Phosphor coordinates down to the box's `ICON_SIZE`. */
  const ICON_SCALE = ICON_SIZE / 256;
</script>

<g transform="translate({node.x}, {node.y})" class:selected>
  <!-- No halo ring behind it: selection is carried by the border's colour
       alone, so the shape a node has when selected is the shape it has the
       rest of the time. -->
  {#if interactive}
    <rect
      class="body"
      width={NODE_W}
      height={h}
      rx={NODE_RADIUS}
      role="button"
      tabindex="-1"
      aria-label="node {node.id}"
      onpointerdown={(e) => {
        onSelect?.();
        onBodyDown?.(e);
      }}
    />
  {:else}
    <rect class="body inert" width={NODE_W} height={h} rx={NODE_RADIUS} />
  {/if}
  <line class="sep" x1="0" y1={HEADER_H} x2={NODE_W} y2={HEADER_H} />
  {#if icon !== undefined}
    <!-- A `g` with a scale rather than a nested `svg`: a nested viewport
         would clip, and there is nothing here to clip against. The path
         is Phosphor's own fill data, so it needs no stroke width scaled
         alongside it.

         Deliberately inert (`pointer-events: none`, no `<title>`): it
         sits on top of the body rect, and anything that swallowed events
         here would put a 12-unit dead patch in the corner you grab the
         box by. The category is named in full by the node menu, which
         groups by it — that is where the set is learned, not here. -->
    <g class="icon" transform="translate({ICON_X}, {ICON_Y}) scale({ICON_SCALE})">
      <path d={icon} />
    </g>
  {/if}
  <text class="title" x={TEXT_X} y={TITLE_Y}>{node.label ?? node.type}</text>
  <text class="nodeid" x={TEXT_X} y={ID_Y}>{node.id}</text>
  {#each node.inputs as pin, i (pin.name)}
    <circle class="pin k-{pin.kind}" cx="0" cy={pinRowY(i)} r="4.5" />
    {#if interactive}
      <circle
        class="pin-hit"
        cx="0"
        cy={pinRowY(i)}
        r="9"
        role="button"
        tabindex="-1"
        aria-label="input pin {pin.name}"
        onpointerenter={() => onInEnter?.(pin.name)}
        onpointerleave={() => onInLeave?.()}
      >
        <title>{pin.name} · {pin.kind}{pin.multi ? " · multi" : ""}</title>
      </circle>
    {/if}
    <text class="pinlabel in" x="10" y={pinRowY(i) + 3}>{pin.name}</text>
  {/each}
  {#each node.outputs as pin, i (pin.name)}
    <circle class="pin k-{pin.kind}" cx={NODE_W} cy={pinRowY(i)} r="4.5" />
    {#if interactive}
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
          onOutDown?.(e, pin.name, i);
        }}
      >
        <title>{pin.name} · {pin.kind} — drag to an input pin</title>
      </circle>
    {/if}
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
    stroke: var(--ed-edge);
    /* Never thinner than one screen pixel. `--hairline` is set by the
       canvas from the live zoom (see the transformed group there); the
       `1` fallback is what this was, and is what applies to any NodeBox
       rendered outside that group. The border is the node's silhouette,
       and a silhouette that disappears when you zoom out to see the whole
       graph disappears exactly when it is the only thing still legible. */
    stroke-width: var(--hairline, 1);
    cursor: grab;
  }
  .body:hover {
    stroke: #5e5e5e;
  }
  /* Nothing to grab and nothing to hover, so it says neither. The pan
     gesture belongs to the surface underneath, and a box that took the
     pointer here would be a hole in it. */
  .body.inert {
    cursor: inherit;
    pointer-events: none;
  }
  .selected .body {
    stroke: var(--ed-select);
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
  .pin-hit:focus {
    outline: none;
  }
  .sep {
    stroke: var(--ed-rule);
    stroke-width: 1;
    pointer-events: none;
  }
  /**
   * MONO, like everything else in the header. One step under the title's
   * white rather than equal to it: this is a solid fill where the title
   * is a run of strokes, so at the same value it would carry more mass
   * than the name it belongs to and read as the louder of the two. The
   * category is context; the name is the thing.
   */
  .icon {
    fill: var(--ed-ink-mid);
    pointer-events: none;
  }
  .title {
    fill: var(--ed-ink-hi);
    font: 600 11px var(--ed-sans);
    pointer-events: none;
  }
  .nodeid {
    fill: var(--ed-ink-faint);
    font: 9px var(--ed-mono);
    pointer-events: none;
  }
  .pin {
    stroke: #000000;
    stroke-width: 1;
    pointer-events: none;
  }
  /**
   * The pin dots are where the four kinds ACTUALLY differ, and so where
   * the two kind hues are the only ones that ever land on the canvas.
   * Every cable is geometry (445 of 445 across the graph corpus — see the
   * note in `Canvas.svelte`), so a cable is always grey; these dots are
   * not. `instances` and `value` occur on one node type each, which is
   * what makes a hue on them a MARK rather than a tint. `geometry` is the
   * substrate and `any` is a wildcard, so both stay grey.
   */
  .k-geometry {
    fill: var(--ed-k-geometry);
  }
  .k-instances {
    fill: var(--ed-k-instances);
  }
  .k-value {
    fill: var(--ed-k-value);
  }
  .k-any {
    fill: var(--ed-k-any);
  }
  .pin-hit {
    fill: transparent;
    pointer-events: all;
  }
  .pin-hit.out {
    cursor: crosshair;
  }
  .pinlabel {
    fill: var(--ed-ink-dim);
    font: 9px var(--ed-mono);
    pointer-events: none;
  }
  .pinlabel.out {
    text-anchor: end;
  }
  .pkey {
    fill: var(--ed-ink-faint);
    font: 9px var(--ed-mono);
    pointer-events: none;
  }
  .pval {
    fill: var(--ed-ink-mid);
    font: 9px var(--ed-mono);
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
