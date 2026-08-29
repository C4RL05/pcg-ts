<script lang="ts">
  /**
   * The loaded graph at a glance — its title, what it is for, and the
   * knobs worth turning. Named for the job rather than for the widgets,
   * because it is half prose: this is the pane you READ to learn what a
   * graph does, and the node inspector behind the other tab is the one
   * you OPEN to edit a single node.
   *
   * `Knob` stays the word for one tunable param (`shared/graphUi.ts`) —
   * the data, not the pane.
   *
   * It used to be a floating card, which worked until the overlay went
   * full-bleed and translucent: anything behind that canvas shows through
   * it, and a card of controls came out as ghost text under the nodes.
   * Pure content now — Sidebar owns the backing that makes it legible and
   * the scroll it rides. Rendered by the shared spec-driven renderer,
   * which is what that renderer was generalised for.
   *
   * The rows are the exposed params of the graph's subgraph nodes, laid
   * out by a panel spec when the graph ships one and grouped by node when
   * it does not. Writing one is `setParam` on the wrapping node, the same
   * call the inspector makes — so the two views of a knob cannot drift.
   */
  import Controls from "../shared/Controls.svelte";
  import { untrack } from "svelte";
  import { copyLabel, createCopier, type CopyState } from "../shared/copy.js";
  import {
    adoptChanged,
    applyCommit,
    snapshotValues,
    visibleSections,
    type ControlCommit,
  } from "../shared/controls.js";
  import {
    buildKnobPanel,
    knobPatch,
    knobTargets,
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
   * ONE walk of the graph per rev. `knobs()` rebuilds a description of
   * every node and a record per param, so the panel, the routing table
   * and the patch all read this rather than asking again — three walks of
   * a forty-node graph per keystroke was the cost of asking three times.
   */
  const knobs = $derived.by(() => {
    void rev;
    return controller.knobs();
  });

  /**
   * Rebuilt from the live graph on every rev rather than kept as local
   * state: unlike the demo panels, this one's SHAPE changes under it — a
   * different graph has different knobs — so there is nothing stable to
   * hold.
   */
  const panel = $derived(buildKnobPanel(knobs, spec));

  /**
   * Key → the slot it writes, so no key has to be re-split. A key is three
   * parts once a knob reaches into a field spec, and the node id it starts
   * with may itself contain dots — carrying the parts is what keeps that
   * from ever being anybody's problem.
   *
   * Derived by the library module rather than rebuilt here, because this
   * component rebuilt it inline once and dropped a field when the type
   * gained one. Nothing in the build reads `.svelte`.
   */
  const targets = $derived(knobTargets(knobs));

  /**
   * Merged rather than replaced. Swapping the whole record in invalidates
   * every row's read of it, so one slider commit re-rendered every row of
   * every section; `adoptChanged` copies across only what the graph
   * actually moved. A different graph has different keys, so that case
   * still takes the wholesale swap.
   */
  let values = $state<KnobValues>({});
  let previous: KnobValues = {};
  $effect(() => {
    const next = panel.values;
    untrack(() => {
      if (sameShape(values, next)) previous = adoptChanged(values, next, previous);
      else {
        values = next;
        previous = snapshotValues(next);
      }
    });
  });

  const sameShape = (a: KnobValues, b: KnobValues): boolean => {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b);
  };

  /**
   * The sections that have a row left after this panel's gates are applied.
   *
   * `Controls` filters internally, but this component has its own questions
   * to answer about the same list — whether to raise a tab bar, and what to
   * say when there is nothing to draw — and reading `panel.sections.length`
   * for those was reading a count a gate can change. It got both wrong the
   * same way: a two-section panel with one section gated off drew a
   * one-entry tab bar, and a panel with every row gated off drew its
   * "curated for this graph" preamble and the share buttons above no
   * widgets at all, with nothing on screen saying why.
   */
  const shown = $derived(visibleSections(panel.sections, values));

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
    const key = String(c.key);
    const target = targets.get(key);
    if (target === undefined) return;
    // A row may stand for several params — four chord tubes are one
    // "chord" setting. The writes are separate, but scheduleCook is
    // debounced, so they still cost one cook.
    for (const k of [key, ...(panel.mirrors[key] ?? [])]) {
      const t = targets.get(k);
      if (t !== undefined) controller.setKnob(t, c.value);
    }
    onEdit();
  }

  /**
   * What has moved since the graph loaded — read from the graph rather
   * than from this panel's own values, so a knob turned in the node
   * inspector, or one the spec chose not to surface, is still in it.
   */
  const patch = $derived(
    knobPatch(knobValues(knobs), baseline, { current: seed, loaded: loadedSeed }),
  );
  const patchText = $derived(JSON.stringify(patch, null, 2));
  const changed = $derived(Object.keys(patch).length);

  /** Whether the link and the patch are revealed below the buttons. */
  let showPatch = $state(false);

  let copyState = $state<CopyState>("idle");
  const copier = createCopier((next) => (copyState = next));
  const label = $derived(copyLabel(copyState, "copy link"));
  /** A refused clipboard reveals the link, which is the point of the button. */
  const copyLink = (): Promise<CopyState> => copier.copy(shareUrl(patch), () => (showPatch = true));

  /**
   * Select the whole link when the input takes focus, so copying it by hand
   * is one gesture — which is why it is an `<input readonly>` rather than a
   * `<pre>` in the first place.
   *
   * It was referenced and never defined: the handler named a function that
   * did not exist, so focusing the field did nothing and the fallback for a
   * refused clipboard quietly did not work. Nothing in the build read
   * `.svelte`, so nothing said so.
   */
  const selectAll = (event: FocusEvent): void => {
    (event.currentTarget as HTMLInputElement | null)?.select();
  };
</script>

<div class="overview">
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
    {#if shown.length === 0}
      <!-- Every row this panel carries is gated off by the values the graph
           currently holds. Without this the pane is a heading, a paragraph
           and three buttons over blank space — the one state where the
           panel cannot explain itself, because the knob that would bring a
           row back is a row too. -->
      <p class="note">
        Every row in this panel is hidden by the values the graph currently holds. Change one on the
        canvas — select a node and edit it in the inspector — to bring the rows back.
      </p>
    {/if}
    <Controls
      sections={panel.sections}
      {values}
      onInput={input}
      onCommit={commit}
      bind:tab
      tabbed={shown.length > 1} />
  {/if}

  {#if panel.sections.length > 0}
    <div class="share">
      <button onclick={copyLink}>{label}</button>
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
  .graph-title {
    margin: 0 0 4px;
    font-size: var(--ed-t-title);
    font-weight: 600;
    color: var(--ed-ink-hi);
    line-height: 1.3;
  }
  .note {
    margin: 0 0 6px;
    color: var(--ed-ink-dim);
    font-size: var(--ed-t-body);
    line-height: 1.5;
  }
  code {
    color: var(--ed-action);
    font-family: var(--ed-mono);
    font-size: var(--ed-t-meta);
  }
  .share {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--ed-rule);
  }
  .share button {
    padding: var(--ed-btn-pad);
    background: var(--ed-raised);
    color: var(--ed-action);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-sans);
    cursor: pointer;
  }
  .share button:hover:not(:disabled) {
    background: var(--ed-raised-hi);
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
    color: var(--ed-ink-faint);
    font-size: var(--ed-t-meta);
  }
  .share button.link:hover {
    color: var(--ed-ink-mid);
    background: none;
  }
  .url {
    width: 100%;
    box-sizing: border-box;
    margin-top: 6px;
    padding: 4px 6px;
    background: var(--ed-well);
    color: var(--ed-action);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) var(--ed-mono);
  }
  .patch {
    margin: 6px 0 0;
    padding: 6px 8px;
    max-height: 160px;
    overflow: auto;
    background: #0a0a0a;
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
    color: var(--ed-ink-mid);
    font: var(--ed-t-meta) / 1.45 var(--ed-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--ed-ink-faint);
    font-size: var(--ed-t-meta);
  }
  .warn {
    margin: 8px 0 0;
    padding: 6px 8px;
    background: var(--ed-alert-bg);
    border: 1px solid var(--ed-edge-warn);
    border-radius: var(--ed-radius);
    color: var(--ed-ink);
    font-size: var(--ed-t-meta);
  }
  .skipped {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--ed-rule);
    color: var(--ed-ink-faint);
    font-size: var(--ed-t-meta);
  }
  .skipped summary {
    cursor: pointer;
    color: var(--ed-ink-dim);
  }
  .skipped div {
    margin-top: 4px;
  }
  .skipped b {
    color: var(--ed-ink-mid);
    font-family: var(--ed-mono);
    font-weight: 400;
  }
</style>
