<script lang="ts">
  /**
   * Svelte 5 (runes) control panel for the rig playground. Same host↔panel
   * split as 04-gpu-fields: the host pushes immutable `PanelView`
   * snapshots through the bridge, the panel calls back through
   * `PanelHost`. Nothing here knows what a graph is.
   *
   * The knobs are rendered by `../shared/Controls.svelte` from the list
   * in view.ts, so a new knob is a line there and neither this file nor
   * the renderer changes. What is left here is only what is this demo's
   * own: the seed row, the settings patch, the stats, and `commit` —
   * which routes an edit to one of the three places a rig knob can go.
   */
  import { hashCombine } from "pcg-ts";
  import { untrack } from "svelte";
  import Controls from "../shared/Controls.svelte";
  import {
    adoptChanged,
    applyCommit,
    snapshotValues,
    type ControlCommit,
  } from "../shared/controls.js";
  import PanelShell from "../shared/PanelShell.svelte";
  import {
    DEFAULT_PARAMS,
    PART_KINDS,
    RIG_GROUPS,
    type PartKind,
    type RigGroup,
    type RigParams,
  } from "./rig.js";
  import {
    CONTROL_SECTIONS,
    DISPLAY_KEYS,
    GROUP_LABEL,
    type DisplayKey,
    type EnumParam,
    type NumericParam,
    type PanelBridge,
    type PanelHost,
    type PanelView,
    type RigControls,
    type Shading,
  } from "./view.js";

  let {
    host,
    bridge,
    initial,
  }: { host: PanelHost; bridge: PanelBridge; initial: PanelView } = $props();

  /**
   * `initial` and `bridge` are setup-time reads, not tracked inputs: the
   * host hands over one starting snapshot and one callback slot, then
   * drives the panel through `publish` for the rest of the page's life.
   * `untrack` states that intent where the compiler can see it — capture
   * now, never resubscribe — instead of reading a prop reactively and
   * discarding the reactivity. It is also what keeps the seeding below
   * honest: every local control starts from this one frozen snapshot.
   */
  const initialView = untrack(() => initial);

  let view = $state(initialView);

  /**
   * The knobs have three destinations behind this panel — graph params,
   * asset proportions, view state — but a control names a key and
   * nothing else, so they are flattened into one record here and routed
   * back out in `commit`.
   */
  function flatten(v: PanelView): RigControls {
    return {
      ...v.params,
      weights: { ...v.params.weights },
      ...v.display,
      shading: v.shading,
      wireframe: v.wireframe,
      grid: v.grid,
      visible: { ...v.visible },
    };
  }

  let controls = $state<RigControls>(flatten(initialView));

  /** Previous host snapshot, for the host-changed diff. Never read in markup. */
  let previous: RigControls = snapshotValues(flatten(initialView));

  let seedInput = $state(initialView.params.seed);

  untrack(() => {
    bridge.publish = (v: PanelView) => {
      view = v;
      const next = flatten(v);
      // The seed box holds text mid-entry, so it only follows a seed the
      // HOST moved — a randomize click, not the digits being typed.
      const seedMoved = !Object.is(next.seed, previous.seed);
      previous = adoptChanged(controls, next, previous);
      if (seedMoved) seedInput = controls.seed;
    };
  });

  /** Desktop width of the card; the shell handles everything else. */
  const PANEL_WIDTH = 340;

  /**
   * Tabs, because the knobs outgrew one scroll: five generation groups
   * plus display is roughly fifty controls, and hunting for one of them
   * in a single column is the whole problem.
   *
   * Stats sit OUTSIDE the tabs: they are the readout you check while
   * turning a knob, so hiding them behind a tab would mean losing sight
   * of the thing a knob is meant to change.
   */
  let tab = $state(CONTROL_SECTIONS[0].title);

  const isDisplayKey = (key: string): key is DisplayKey =>
    (DISPLAY_KEYS as readonly string[]).includes(key);

  /** Mid-gesture: move the readout, tell the host nothing. */
  function input(commit: ControlCommit<RigControls>): void {
    applyCommit(controls, commit);
  }

  /**
   * A settled edit. The switch is the whole routing layer: which host
   * call a knob makes is a property of the demo, not of the knob, so it
   * lives here rather than in the spec — which is what keeps the spec
   * plain data that could have come out of a JSON file.
   */
  function commit(c: ControlCommit<RigControls>): void {
    applyCommit(controls, c);
    switch (c.kind) {
      case "slider":
        if (isDisplayKey(c.key)) host.setDisplayNumber(c.key, c.value);
        else host.setNumber(c.key as NumericParam, c.value);
        break;
      case "select":
        if (c.key === "shading") host.setShading(c.value as Shading);
        else host.setChoice(c.key as EnumParam, c.value);
        break;
      case "flag":
        if (c.key === "wireframe") host.setWireframe(c.value);
        else host.setGrid(c.value);
        break;
      case "flagGrid":
        host.setVisible(c.item as RigGroup, c.value);
        break;
      case "numberGrid":
        host.setWeight(c.item as PartKind, c.value);
        break;
    }
  }

  /**
   * The current settings as a PATCH — only what differs from the
   * defaults, plus the seed. A full dump would be eighty lines of mostly
   * defaults; a patch is short enough to paste into a conversation and
   * is exactly the shape window.__rigSet and the capture script's
   * --params flag already take, so a copied setting can be replayed
   * without editing it.
   */
  const patch = $derived.by(() => {
    const out: Record<string, unknown> = { seed: controls.seed };
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof RigParams)[]) {
      if (key === "seed" || key === "weights") continue;
      if (controls[key] !== DEFAULT_PARAMS[key]) out[key] = controls[key];
    }
    const w: Record<string, number> = {};
    for (const kind of PART_KINDS) {
      if (controls.weights[kind] !== DEFAULT_PARAMS.weights[kind]) w[kind] = controls.weights[kind];
    }
    if (Object.keys(w).length > 0) out.weights = { ...controls.weights };
    const d: Record<string, number> = {};
    for (const key of DISPLAY_KEYS) {
      if (controls[key] !== initialView.display[key]) d[key] = controls[key];
    }
    if (Object.keys(d).length > 0) out.display = d;
    return JSON.stringify(out, null, 2);
  });

  let copyState = $state<"idle" | "done" | "manual">("idle");
  async function copyPatch(): Promise<void> {
    try {
      await navigator.clipboard.writeText(patch);
      copyState = "done";
    } catch {
      // The clipboard can refuse — an insecure context, or a permission
      // the page was never granted. Silently doing nothing would look
      // like a broken button, so fall back to showing the JSON where it
      // can be selected by hand and say that is what happened.
      tab = "display";
      copyState = "manual";
    }
    setTimeout(() => (copyState = "idle"), 1600);
  }
  const copyLabel = $derived(
    copyState === "done" ? "copied!" : copyState === "manual" ? "select it below ↓" : "copy params",
  );

  function fmtInt(n: number): string {
    return n.toLocaleString();
  }

  function applySeed(seed: number): void {
    controls.seed = seed;
    seedInput = seed;
    host.setSeed(seed);
  }
  function commitSeed(): void {
    const n = Math.floor(Number(seedInput));
    if (Number.isFinite(n)) applySeed(n >>> 0);
  }
  function randomizeSeed(): void {
    // Nothing in this repo calls Math.random — a fresh seed comes from the
    // library's own hash, mixed with the clock so two clicks differ. Kept
    // to four digits so it stays readable in the field, and nudged off the
    // current seed on a collision so the button is never a no-op.
    const next = hashCombine(controls.seed, Date.now() >>> 0) % 10_000;
    applySeed(next === controls.seed ? (next + 1) % 10_000 : next);
  }
</script>

<!-- The cook flag rides in the shell's title bar, beside the title and
     ahead of the chevron — written on one line so no whitespace text node
     lands in front of the span's own 8px gap. -->
{#snippet cookFlag()}{#if view.cooking}<span class="cooking">cooking…</span>{/if}{/snippet}

<!-- The settings block heads the display tab. It is not a control, so it
     arrives through the renderer's `extra` slot rather than the spec. -->
{#snippet extra(section: string)}
  {#if section === "display"}
    <h2>settings</h2>
    <p class="hint">Everything that differs from the defaults. Paste it back to replay a rig.</p>
    <pre class="patch">{patch}</pre>
    <h2>display</h2>
  {/if}
{/snippet}

<PanelShell title="11 · rig playground" width={PANEL_WIDTH} badge={cookFlag}>
  <p class="info">
    One graph: a box <b>truss</b> along a spline pushed around by noise, <b>components</b>
    scattered over it in noise clusters, <b>chains</b> holding it up, cables <b>wrapped</b> around
    it, and two kinds hanging off it. Every knob recooks the whole rig; the same seed always
    rebuilds the same rig.
  </p>

  <div class="row">
    <span>seed</span>
    <input class="num" type="number" step="1" bind:value={seedInput} onchange={commitSeed} />
    <button class="wide" onclick={randomizeSeed}>randomize</button>
  </div>

  <div class="row">
    <span>settings</span>
    <button class="wide" onclick={copyPatch}>{copyLabel}</button>
  </div>

  <Controls
    sections={CONTROL_SECTIONS}
    values={controls}
    onInput={input}
    onCommit={commit}
    bind:tab
    tabbed
    {extra} />

  <!-- `busy` fades the stats while a cook is in flight; it sits on this
       block rather than on the panel so the rule stays scoped to the
       component that renders the numbers. -->
  <div class="group stats" class:busy={view.cooking}>
    <h2>stats</h2>
    <div class="stat"><span>fps</span><b>{view.fps}</b></div>
    <div class="stat"><span>instances</span><b>{fmtInt(view.total)}</b></div>
    {#each RIG_GROUPS as group (group)}
      <div class="stat"><span>{GROUP_LABEL[group]}</span><b>{fmtInt(view.counts[group] ?? 0)}</b></div>
    {/each}
    <div class="stat"><span>spine points</span><b>{fmtInt(view.counts.spinePoints ?? 0)}</b></div>
    <div class="stat">
      <span>cook</span>
      <b>{view.cooking ? "cooking…" : `${view.cookMs.toFixed(1)} ms`}</b>
    </div>
    <div class="stat"><span>draw calls</span><b>{fmtInt(view.drawCalls)}</b></div>
    {#if view.notice !== undefined}
      <p class="note">{view.notice}</p>
    {/if}
    {#if view.error !== undefined}
      <div class="error">{view.error}</div>
    {/if}
  </div>
</PanelShell>

<style>
  /* Chrome (the card, the title bar, the narrow-screen bottom sheet) lives
     in ../shared/PanelShell.svelte, and the knobs' own rows, sliders and
     grids in ../shared/Controls.svelte. What follows styles the parts
     this panel still renders itself: the two header rows, the settings
     patch, and the stats. */
  h2 {
    margin: 0 0 4px;
    color: #cfe0f5;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .cooking {
    margin-left: 8px;
    color: #f0c869;
    font: 11px ui-monospace, monospace;
    font-weight: 400;
  }
  .info {
    margin: 0 0 10px;
    color: #8b98ab;
    font-size: 12px;
  }
  .info b {
    color: #b8c6d8;
    font-weight: 600;
  }
  .group {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #223047;
  }
  .patch {
    margin: 4px 0 8px;
    padding: 6px 8px;
    max-height: 150px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.45;
    color: #9fd0b0;
    background: #0e1621;
    border: 1px solid #223047;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hint {
    margin: 2px 0 0;
    font-size: 11px;
    color: #7d8ea6;
  }
  /* The two header rows above the tab bar. The knob rows look the same
     but are the renderer's, and Svelte scopes styles to the component
     that renders the markup — so these few rules are duplicated on
     purpose rather than reached for across the boundary. */
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }
  .row > span {
    flex: 0 0 84px;
    color: #aeb9c9;
    font-size: 12px;
  }
  .num {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px ui-monospace, monospace;
  }
  button.wide {
    flex: 0 0 auto;
    padding: 4px 10px;
    background: #1d2a3f;
    color: #9ecbff;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
    cursor: pointer;
  }
  button.wide:hover {
    background: #24334c;
  }
  /* A cook in flight fades the numbers it is about to replace, so a stale
     readout never reads as a settled one. */
  .stats.busy {
    opacity: 0.55;
  }
  .stat {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin: 2px 0;
  }
  .stat span {
    color: #8b98ab;
    font-size: 12px;
  }
  .stat b {
    color: #b8f5c8;
    font: 12px ui-monospace, monospace;
    font-weight: 400;
    text-align: right;
  }
  .note {
    margin: 8px 0 0;
    color: #6f7c8f;
    font-size: 11px;
  }
  .error {
    margin-top: 6px;
    padding: 6px 8px;
    background: #2b1516;
    border: 1px solid #6b2a2e;
    border-radius: 6px;
    color: #ff9ba3;
    font: 11px ui-monospace, monospace;
    white-space: pre-wrap;
  }
</style>
