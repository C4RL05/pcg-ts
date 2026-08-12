<script lang="ts">
  /**
   * The graph's knobs, as a column of the editor overlay. It used to be a
   * floating card, which worked until the overlay went full-bleed and
   * translucent: anything behind that canvas shows through it, and a card
   * of controls came out as ghost text under the nodes. In the column it
   * is legible, it scrolls with its own bar, and the scene is still right
   * there behind the overlay. Rendered by the shared spec-driven
   * renderer, which is what that renderer was generalised for.
   *
   * The rows are the exposed params of the graph's subgraph nodes, laid
   * out by a panel spec when the graph ships one and grouped by node when
   * it does not. Writing one is `setParam` on the wrapping node, the same
   * call the inspector makes — so the two views of a knob cannot drift.
   */
  import Controls from "../shared/Controls.svelte";
  import { applyCommit, type ControlCommit } from "../shared/controls.js";
  import {
    buildKnobPanel,
    knobPatch,
    knobValues,
    type GraphPanelSpec,
    type KnobPatch,
    type KnobValues,
  } from "../shared/graphUi.js";
  import type { EditorController } from "./controller.js";

  let {
    controller,
    rev,
    spec,
    title,
    baseline,
    seed,
    loadedSeed,
    onEdit,
    onReset,
    shareUrl,
  }: {
    controller: EditorController;
    /** Bumped by the editor whenever the graph or its params changed. */
    rev: number;
    /** The loaded graph's panel spec, when it ships one. */
    spec: GraphPanelSpec | undefined;
    title: string;
    /** Knob values the graph loaded with — what the patch measures against. */
    baseline: KnobValues;
    seed: number;
    loadedSeed: number;
    /** Report a write so the node inspector re-reads the same param. */
    onEdit: () => void;
    onReset: () => void;
    shareUrl: (patch: KnobPatch) => string;
  } = $props();

  /**
   * Rebuilt from the live graph on every rev rather than kept as local
   * state: unlike the demo panels, this one's SHAPE changes under it — a
   * different graph has different knobs — so there is nothing stable to
   * hold. Every edit bumps rev, so the values here are the graph's.
   */
  const panel = $derived.by(() => {
    void rev;
    return buildKnobPanel(controller.knobs(), spec);
  });

  /** Key → the node and param it writes, so no key has to be re-split. */
  const targets = $derived(
    new Map(controller.knobs().map((k) => [k.key, { node: k.node, name: k.name }])),
  );

  let values = $state<KnobValues>({});
  let shown = -1;
  $effect(() => {
    // A fresh values object per rebuild; `panel.values` is already a copy
    // of what the graph holds.
    if (shown !== rev) {
      shown = rev;
      values = panel.values;
    }
  });

  let tab = $state("");
  $effect(() => {
    const titles = panel.sections.map((s) => s.title);
    if (!titles.includes(tab)) tab = titles[0] ?? "";
  });

  function input(commit: ControlCommit<KnobValues>): void {
    applyCommit(values, commit);
  }

  function commit(c: ControlCommit<KnobValues>): void {
    applyCommit(values, c);
    const target = targets.get(String(c.key));
    if (target === undefined) return;
    controller.setPlainParam(target.node, target.name, c.value);
    onEdit();
  }

  /**
   * What has moved since the graph loaded — read from the graph rather
   * than from this panel's own values, so a knob turned in the node
   * inspector, or one the spec chose not to surface, is still in it.
   */
  const patch = $derived.by(() => {
    void rev;
    return knobPatch(knobValues(controller.knobs()), baseline, { current: seed, loaded: loadedSeed });
  });
  const patchText = $derived(JSON.stringify(patch, null, 2));
  const changed = $derived(Object.keys(patch).length);

  let copyState = $state<"idle" | "done" | "manual">("idle");
  let showPatch = $state(false);
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareUrl(patch));
      copyState = "done";
    } catch {
      // The clipboard can refuse — an insecure context, or a permission
      // the page was never granted. Silently doing nothing would look
      // like a broken button, so show the link where it can be selected
      // by hand and say that is what happened.
      showPatch = true;
      copyState = "manual";
    }
    setTimeout(() => (copyState = "idle"), 1600);
  }
  function selectAll(e: FocusEvent): void {
    (e.currentTarget as HTMLInputElement).select();
  }

  const copyLabel = $derived(
    copyState === "done" ? "copied!" : copyState === "manual" ? "select it below ↓" : "copy link",
  );
</script>

<div class="knobs">
  <h2 class="graph-title">{title}</h2>
  {#if panel.sections.length === 0}
    <p class="note">
      This graph exposes no knobs. Params live on its nodes — select one on the canvas to edit it.
    </p>
  {:else}
    <p class="note">
      {#if panel.authored}
        Curated for this graph.
      {:else}
        Derived from the graph's exposed params, grouped by the node that exposes each one.
      {/if}
      Every edit is a <code>setParam</code> on the node that holds it, then a recook.
    </p>
    <Controls
      sections={panel.sections}
      {values}
      onInput={input}
      onCommit={commit}
      bind:tab
      tabbed={panel.sections.length > 1} />
  {/if}

  {#if panel.sections.length > 0}
    <div class="share">
      <button onclick={copyLink}>{copyLabel}</button>
      <button disabled={changed === 0} onclick={onReset}>reset</button>
      <button
        class="link"
        aria-expanded={showPatch}
        onclick={() => (showPatch = !showPatch)}>{changed} changed</button>
    </div>
    {#if showPatch}
      <!-- The link itself, because the button offering to copy it can be
           refused — an insecure context, an unfocused window — and a
           "copy link" that quietly does nothing leaves you with no link.
           Readonly input rather than a <pre>: select-all is one gesture. -->
      <input class="url" type="text" readonly value={shareUrl(patch)} onfocus={selectAll} />
      <!-- The patch is the readable half of that link, and the shape the
           `p=` parameter carries. -->
      <pre class="patch">{patchText}</pre>
      <p class="hint">
        The link reopens this graph with these values. Everything else comes from the graph itself.
      </p>
    {/if}
  {/if}

  {#if panel.unknown.length > 0}
    <p class="warn">
      panel spec names {panel.unknown.length} param(s) this graph does not expose: {panel.unknown.join(
        ", ",
      )}
    </p>
  {/if}
  {#if panel.skipped.length > 0}
    <details class="skipped">
      <summary>{panel.skipped.length} not shown</summary>
      {#each panel.skipped as s (s.key)}
        <div><b>{s.key}</b> — {s.reason}</div>
      {/each}
    </details>
  {/if}
</div>

<style>
  .knobs {
    flex: 0 0 296px;
    min-height: 0;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 10px 12px;
    background: rgba(13, 17, 23, 0.94);
    border-left: 1px solid #223047;
    backdrop-filter: blur(6px);
  }
  .graph-title {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    color: #f0f4fa;
    line-height: 1.3;
  }
  .note {
    margin: 0 0 6px;
    color: #8b98ab;
    font-size: 12px;
  }
  code {
    color: #9ecbff;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .share {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  .share button {
    padding: 3px 10px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  .share button:hover:not(:disabled) {
    background: #24334c;
  }
  .share button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .share button.link {
    margin-left: auto;
    padding: 3px 4px;
    background: none;
    border: none;
    color: #6f7c8f;
    font-size: 11px;
  }
  .share button.link:hover {
    color: #aeb9c9;
    background: none;
  }
  .url {
    width: 100%;
    box-sizing: border-box;
    margin-top: 6px;
    padding: 4px 6px;
    background: #161d29;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 11px ui-monospace, monospace;
  }
  .patch {
    margin: 6px 0 0;
    padding: 6px 8px;
    max-height: 160px;
    overflow: auto;
    background: #0e1621;
    border: 1px solid #223047;
    border-radius: 4px;
    color: #9fd0b0;
    font: 11px/1.45 ui-monospace, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hint {
    margin: 6px 0 0;
    color: #6f7c8f;
    font-size: 11px;
  }
  .warn {
    margin: 8px 0 0;
    padding: 6px 8px;
    background: #33261a;
    border: 1px solid #7a5a2e;
    border-radius: 6px;
    color: #f0c869;
    font-size: 11px;
  }
  .skipped {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
    color: #6f7c8f;
    font-size: 11px;
  }
  .skipped summary {
    cursor: pointer;
    color: #8b98ab;
  }
  .skipped div {
    margin-top: 4px;
  }
  .skipped b {
    color: #aeb9c9;
    font-family: ui-monospace, monospace;
    font-weight: 400;
  }
</style>
