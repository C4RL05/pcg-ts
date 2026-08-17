<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * A field expression drawn as boxes and wires, READ-ONLY.
   *
   * The textarea in `FieldParam.svelte` stays the edit surface; this is
   * the view you open to see the shape of what you typed. Nothing here is
   * draggable, selectable or editable, which is why there are no hit
   * targets over the pins and no hit path under the wires — the whole
   * diagram is inert.
   *
   * The chrome around it (backdrop, panel, scroll) belongs to
   * `FieldParam.svelte`: this component is `namespace="svg"` like
   * `NodeBox.svelte`, so every element it renders is an SVG element and a
   * wrapping `<div>` could not live here.
   *
   * It takes the raw TEXT rather than a parsed spec so that the two ways
   * of having nothing to draw — text that is not JSON, and JSON that is
   * not a field expression — are both answered in the same place, in one
   * line, instead of leaving an empty canvas open.
   */
  import { parseFieldText } from "pcg-ts";
  import {
    HEADER_H,
    PAD,
    TITLE_Y,
    layoutFieldTree,
    rowBaselineY,
    rowCenterY,
    type FieldTreeEdge,
  } from "./fieldTreeLayout.js";

  let { text }: { text: string } = $props();

  const parsed = $derived.by((): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: parseFieldText(text) as unknown };
    } catch {
      return { ok: false };
    }
  });

  const tree = $derived(parsed.ok ? layoutFieldTree(parsed.value) : null);

  /**
   * The one line shown in place of a diagram, or null.
   *
   * The parse failure is deliberately terse: the textarea already reports
   * the parser's own message, and repeating it here would be the same
   * error twice in two voices.
   */
  const note = $derived.by((): string | null => {
    if (tree === null) return "this is not valid JSON — the editor below says where";
    if (tree.nodes.length === 0) return 'no field expression here: the JSON has no "fn"';
    return null;
  });

  /**
   * The canvas' own cable shape, so a wire in the diagram and a wire on
   * the graph are the same curve.
   */
  function curve(e: FieldTreeEdge): string {
    const dx = Math.max(46, Math.min(130, Math.abs(e.bx - e.ax) * 0.5));
    return `M ${e.ax} ${e.ay} C ${e.ax + dx} ${e.ay}, ${e.bx - dx} ${e.by}, ${e.bx} ${e.by}`;
  }
</script>

<svg
  class="fieldtree"
  width={note === null && tree !== null ? tree.width : 420}
  height={note === null && tree !== null ? tree.height : 30}
  role="img"
  aria-label="field expression diagram"
>
  {#if note !== null}
    <text class="note" x={PAD} y="19">{note}</text>
  {:else if tree !== null}
    <!-- Wires under the boxes, as on the canvas: a cable that crossed a
         box would read as passing THROUGH it. -->
    {#each tree.edges as e (e.from)}
      <path class="wire-casing" d={curve(e)} />
      <path class="wire" d={curve(e)}><title>{e.label}</title></path>
    {/each}
    {#each tree.nodes as n (n.id)}
      <g transform="translate({n.x}, {n.y})">
        <title>{n.fn} — {n.id === "" ? "root" : n.id}</title>
        <rect class="body" width={n.w} height={n.h} rx="4" />
        <line class="sep" x1="0" y1={HEADER_H} x2={n.w} y2={HEADER_H} />
        <text class="title" x={PAD} y={TITLE_Y}>{n.fn}</text>
        {#each n.rows as r, i (r.label + i)}
          <text class="rkey" x={PAD} y={rowBaselineY(i)}>{r.label}</text>
          {#if r.value !== null}
            <text class="rval" x={n.w - PAD} y={rowBaselineY(i)}>{r.value}</text>
          {/if}
          {#if r.pin}
            <circle class="pin" cx="0" cy={rowCenterY(i)} r="4.5" />
          {/if}
        {/each}
        {#if n.id !== ""}
          <!-- The output side. Only the root has no consumer, and so no
               dot: a pin with no wire on it would promise one. -->
          <circle class="pin" cx={n.w} cy={n.h / 2} r="4.5" />
        {/if}
      </g>
    {/each}
  {/if}
</svg>

<style>
  .fieldtree {
    display: block;
  }
  /* Straight off NodeBox: the diagram is the same material as the canvas,
     and a second box style would say it was something else. */
  .body {
    fill: #0e0e0e;
    stroke: var(--sb-edge);
    stroke-width: var(--hairline, 1);
  }
  .sep {
    stroke: var(--sb-rule);
    stroke-width: 1;
  }
  .title {
    fill: var(--sb-ink-hi);
    font: 600 11px var(--sb-sans);
  }
  .rkey {
    fill: var(--sb-ink-dim);
    font: 9px var(--sb-mono);
  }
  .rval {
    fill: var(--sb-ink-mid);
    font: 9px var(--sb-mono);
    text-anchor: end;
  }
  /* Every pin here carries a VALUE — a field expression has no other kind
     — so the value hue is the only one this view can spend. */
  .pin {
    fill: var(--sb-k-value);
    stroke: #000000;
    stroke-width: 1;
  }
  .wire-casing {
    fill: none;
    stroke: #000000;
    stroke-width: 4;
  }
  .wire {
    fill: none;
    stroke: var(--sb-k-value);
    stroke-width: 1.6;
    opacity: 0.55;
  }
  .note {
    fill: var(--sb-ink-dim);
    font: 11px var(--sb-mono);
  }
</style>
