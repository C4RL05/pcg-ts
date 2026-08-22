<script lang="ts">
  /** Top strip: graph picker, seed control, layout/export/import, and the live cook status line. */
  import { PRESET_GROUPS, PRESETS } from "../shared/presets.js";
  import {
    COOK_PATHS,
    cookPathLabel,
    fmtFallbacks,
    splitFallbacks,
    type CookPath,
  } from "../shared/gpu.js";
  import { ICON_VIEWBOX, TOOLBAR_ICONS } from "../shared/graph/icons.js";
  import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from "../shared/wordmark.js";
  import type { GpuState } from "./main.js";
  import type { CookStatus } from "./controller.js";

  let {
    seed,
    status,
    collapsed,
    preset,
    onPreset,
    onSeed,
    onExport,
    onImport,
    onLayout,
    sceneOn,
    graphOn,
    onToggleLayer,
    onFit,
    onActual,
    host,
    onToggle,
    onFrame,
    onCookPath,
    onShading,
    legibility,
    legibilityApplies,
    onLegibility,
  }: {
    seed: number;
    status: CookStatus | null;
    /** Whether the dock is collapsed to this bar (narrow screens only). */
    collapsed: boolean;
    /** Loaded corpus graph, or "" for the built-in starter. */
    preset: string;
    onPreset: (name: string) => void;
    onSeed: (seed: number) => void;
    onExport: () => void;
    onImport: () => void;
    onLayout: () => void;
    /**
     * Which of the two layers are on, and the control that toggles one.
     * Never both false: the caller's state has three values and none of
     * them is empty, so this pair cannot arrive here as a blank screen.
     */
    sceneOn: boolean;
    graphOn: boolean;
    onToggleLayer: (layer: "scene" | "graph") => void;
    /** Readouts the host owns rather than the cook: frame rate, what drew, the device, the look. */
    host: { fps: string; drew: string; gpu: GpuState; shading: "lit" | "normals" };
    /** Choose how geometry is shaded. A redraw, not a recook. */
    onShading: (mode: "lit" | "normals") => void;
    /** How far the render is pushed back behind the graph, 0 to {@link LEGIBILITY_MAX}. */
    legibility: number;
    /** False outside the combined view, where the control does nothing. */
    legibilityApplies: boolean;
    onLegibility: (value: number) => void;
    /** Choose the cook path. The graph is unchanged; only how it cooks moves. */
    onCookPath: (path: CookPath) => void;
    /** Frame every node in the canvas, at whatever zoom that takes. */
    onFit: () => void;
    /** Back to 1:1, centred on the graph. */
    onActual: () => void;
    /** Frame the SCENE camera on what the graph made — the other half of `onFit`. */
    onFrame: () => void;
    /** Collapse/expand the dock; wired to the title on narrow screens. */
    onToggle: () => void;
  } = $props();

  const byGroup = $derived(
    PRESET_GROUPS.map((group) => ({ group, items: PRESETS.filter((p) => p.group === group) })),
  );

  /**
   * The top of the range, and it is not 1.
   *
   * At 1 the scrim IS the graph-only view, which the space bar already
   * gives — so the last of the travel would spend itself reproducing a
   * view rather than serving this one. What is left at 0.9 is a tenth of
   * the render: enough to see WHERE the content is while you read the
   * wires over it, which is the only reason to be in the combined view at
   * all.
   *
   * The number is measured, not chosen, and the CABLES set it: the node
   * boxes are opaque #0e0e0e and read at every level, so they never were
   * the constraint. Against the worst case the page can make — the rig
   * under `normals`, in `scene + graph`: a dense multicoloured render at
   * high spatial frequency — mean frame luminance falls 26.2 → 7.1 across
   * the range, against 5.6 for the graph-only view. A wire is half
   * traceable at 0.6, reliably traceable pin to pin from about 0.75, and
   * at 0.9 it reads as it does with the scene gone entirely.
   */
  const LEGIBILITY_MAX = 0.9;

  /**
   * Leads with the name rather than the mechanism: a reader who hovered to
   * ask "what is this" should have the answer in the first three words,
   * not after a clause about scrims. That matters more than it would
   * otherwise, because this control carries no visible word — the tooltip
   * and the `aria-label` are the only places it is named at all.
   */
  const legibilityTitle = $derived(
    legibilityApplies
      ? "graph legibility — how far the scene is pushed back so the graph can be read over it. " +
        "At 0 the render is untouched; by the top of the range a cable is traceable from its " +
        "output pin to its input across a dense one. The node boxes were never the problem; " +
        "the wires are. An overlay redraw: it changes nothing about the render, and nothing " +
        "about the cook."
      : "graph legibility — only in `scene + graph`. The scene view has no graph to read, and " +
        "the graph view has no render left to push back.",
  );

  /**
   * One line rather than the floating stats card the page used to carry.
   * Everything on it was already here except the frame rate and what the
   * outputs drew, and a card that has to be hidden whenever the graph is
   * up is a card in the wrong place.
   *
   * STRUCTURED, not interpolated. It was one monospace run joined by
   * middle dots, which meant every figure on it — a frame rate, a
   * millisecond count, an eight-character hash — carried the same weight
   * and you had to read the whole line to find any of it. As pairs the
   * number can be bright and the word that names it dim, which is what
   * makes a readout scannable at a glance rather than legible on
   * inspection. Nothing was dropped: this is a debug line, and the value
   * of a debug line is that it says everything.
   */
  interface Stat {
    /** The figure. Bright, monospace. */
    readonly value: string;
    /** What it is. Dim, and set beside rather than under. */
    readonly label: string;
    /**
     * Which side the word goes on. A UNIT follows its number — "60 fps",
     * "523 pts" — and a NOUN precedes it: "cook 20.9 ms", "hash 6f8d3476".
     * Set it the other way and the line still contains everything and
     * still reads wrong.
     */
    readonly labelFirst?: boolean;
    readonly tone?: "err" | "warn";
  }

  /**
   * Thousands separated with a THIN space. A scatter that reaches six
   * digits is the case this line exists to report, and `523000` is a
   * number you have to count the digits of. Thin rather than a comma,
   * which reads as a decimal point to half the world, and rather than a
   * full space, which at 11px reads as two separate figures.
   */
  function group(n: number): string {
    return n.toLocaleString("en-US").replaceAll(",", " ");
  }

  /**
   * Device counters, present only on a GPU path. `stats.gpu` is present
   * exactly when a resolver cooked, so its absence is the CPU path rather
   * than a device that did nothing — worth keeping distinct, because "no
   * dispatches" is a real and interesting GPU result.
   */
  const gpuStats = $derived.by((): Stat[] => {
    const g = status?.gpu;
    if (!g) return [];
    const { real, partial } = splitFallbacks(g.fallbacks);
    const fallbacks = fmtFallbacks(real);
    return [
      { value: group(g.dispatches), label: "disp" },
      { value: `${g.residentRuns} / ${g.fusedNodes}`, label: "run / fused" },
      { value: group(g.readbacksSaved), label: "readbacks saved" },
      // Reported apart from the fallbacks, because it is not one: the
      // planner dropped a member and fused the suffix after it.
      ...(partial > 0 ? [{ value: `${partial}×`, label: "suffix-fused" }] : []),
      ...(fallbacks === "none" ? [] : [{ value: fallbacks, label: "fell back", tone: "warn" as const }]),
    ];
  });

  const stats = $derived.by((): Stat[] => {
    if (status === null) return [{ value: "cooking…", label: "" }];
    return [
      { value: host.fps, label: "fps" },
      { value: `${status.elapsedMs.toFixed(1)} ms`, label: "cook", labelFirst: true },
      { value: `${group(status.cooked)} / ${group(status.cached)}`, label: "cooked / cached" },
      { value: group(status.outputs), label: "out" },
      { value: group(status.points), label: "pts" },
      { value: group(status.instances), label: "inst" },
      { value: host.drew, label: "drew", labelFirst: true },
      ...gpuStats,
      ...(status.errors.length > 0
        ? [{ value: String(status.errors.length), label: "error(s)", tone: "err" as const }]
        : []),
      // Label first, and the wording is load-bearing: the capture
      // tooling's readiness probe scrapes this line for /hash [0-9a-f]{8}/
      // to know the first cook has landed. It also happens to be how you
      // would say it — "hash 6f8d3476", not "6f8d3476 hash".
      { value: status.hash, label: "hash", labelFirst: true },
    ];
  });

  /**
   * Why a device path is unavailable, or which adapter is behind it.
   * The reason is shown verbatim: "no WebGPU" and "requestDevice() threw"
   * are different problems and the page should not flatten them.
   */
  const gpuTitle = $derived(
    host.gpu.error !== null
      ? `no device — ${host.gpu.error}`
      : host.gpu.ready
        ? `${host.gpu.label} — the two device paths agree bit for bit, so the hash holds across them. ` +
          `The CPU hash differs: GPU floats are not byte-identical to CPU floats.`
        : "probing for a WebGPU adapter…",
  );

  function commitSeed(e: Event): void {
    const v = Math.floor((e.currentTarget as HTMLInputElement).valueAsNumber);
    if (Number.isFinite(v)) onSeed(v >>> 0);
  }

  function onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }
</script>

<!-- One `<svg>` per icon button, written once. `aria-hidden`, because the
     glyph is not the name: every button below carries its word in `title`
     and in `aria-label`, and a screen reader should hear the word rather
     than a shape it cannot see. -->
{#snippet icon(d: string)}
  <svg class="ic" viewBox={ICON_VIEWBOX} aria-hidden="true"><path {d} /></svg>
{/snippet}

<div class="toolbar" class:collapsed>
  <!-- The title doubles as the dock's collapse toggle on narrow screens.
       Deliberately not a <button>: the capture tooling clicks buttons by
       substring, and the chevron is display: none at desktop widths so
       the bar stays pixel-identical there. -->
  <span
    class="title"
    role="button"
    tabindex="0"
    aria-expanded={!collapsed}
    onclick={onToggle}
    onkeydown={onTitleKeydown}
  ><!-- The pcg-ts wordmark. The geometry lives in `shared/wordmark.ts`,
       which the demos draw from too; see that file for why it is inline
       rather than a `src`, and for the two standalone SVGs it has to stay
       in agreement with. -->
    <svg
      class="mark"
      viewBox={WORDMARK_VIEWBOX}
      aria-hidden="true"
      focusable="false">{@html WORDMARK_PATHS}</svg
    >Editor<span class="chevron" class:flip={collapsed}>▾</span></span>

  <!-- Grouped by LAYER, with a hairline between groups. The two middle
       groups are the two things on screen — the render and the node
       canvas — and each LEADS with the toggle that puts its own layer up,
       then holds the controls that act on it. The group is the answer to
       "what does this touch", which is the question the bar kept getting
       wrong: `frame` points the SCENE camera and `fit` zooms the NODE
       CANVAS, and while they sat side by side they read as a pair of the
       same thing when they are the same verb on opposite subjects.
       The graph picker, the seed, export/import and `cook` are in neither
       group, because they belong to neither layer: they are the graph you
       loaded and how it cooks. -->
  <div class="grp on-bar">
    <label class="graph on-bar">
      graph
      <select value={preset} onchange={(e) => onPreset(e.currentTarget.value)}>
        <option value="">starter graph</option>
        {#each byGroup as { group, items } (group)}
          <optgroup label={group}>
            {#each items as p (p.name)}
              <option value={p.name} title={p.description}>{p.title}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label>
      seed
      <input type="number" step="1" min="0" value={seed} onchange={commitSeed} />
    </label>
    <!-- Icons from here on, and the WORD IS NOT GONE: every one of these
         keeps its name in `title` for the pointer and in `aria-label` for
         a screen reader. These are conventional verbs, which is what
         makes a glyph readable here at all — an icon nobody has a
         convention for is a control you learn by clicking it. -->
    <button onclick={onExport} aria-label="export" title="export — serializeGraph → JSON"
      >{@render icon(TOOLBAR_ICONS.export)}</button>
    <button onclick={onImport} aria-label="import" title="import — paste JSON → deserializeGraph"
      >{@render icon(TOOLBAR_ICONS.import)}</button>
  </div>

  <!-- THE RENDER. Its own switch first, then the three controls that act
       on it: where the camera points, how the geometry is shaded, and how
       far the whole thing is pushed back behind the graph. `shade` is
       here rather than beside `cook` because it changes nothing about the
       cook — it is a redraw of the same result, judged by eye. -->
  <div class="grp on-bar" title="the render">
    <!-- TWO TOGGLES, not one cycler, and each one leads the group for the
         layer it switches. The view is two independent layers, so the bar
         shows two switches and each says whether its own layer is up — a
         cycler could only ever name the state it was about to leave. They
         are also the view READOUT, which is what `aria-pressed` and the
         lit treatment carry.
         Clicking the only layer that is on SWAPS to the other rather than
         clearing the page; the rule lives in Editor.svelte's three-state
         VIEWS table, which has no row for "neither".
         `.view.scene` and `.view.graph` are capture hooks of the same kind
         as `.path.shade` and `.path.cook` below: scripts/capture-demos.mjs
         clicks `.toolbar button.view.graph` to shoot the rig against the
         scene alone. Two classes, like those two, because the first says
         what the control IS and the second says which one — and renaming
         either silently changes what ships in docs/. Which GROUP a hook
         sits in is not part of any of those selectors, so the two toggles
         living in different groups costs the tooling nothing. -->
    <button
      class="view scene on-bar"
      class:on={sceneOn}
      aria-pressed={sceneOn}
      aria-label="scene"
      onclick={() => onToggleLayer("scene")}
      title="scene — the render. Turning it off leaves the graph alone on screen, never nothing. Hold shift over `scene + graph` to fly the scene through the graph."
      >{@render icon(TOOLBAR_ICONS.scene)}</button>
    <!-- Inert while the scene is hidden, like everything else in this
         group: pointing a camera nobody can see is a control that appears
         to do nothing, which is worse than one that says it does nothing.
         Dimmed rather than removed, for the reason `.path.cook` is — the
         tooltip has to stay reachable to explain the absence. -->
    <button
      class:off={!sceneOn}
      disabled={!sceneOn}
      onclick={onFrame}
      aria-label="frame"
      title={sceneOn
        ? "frame — point the camera at what the graph made (F) — done automatically whenever a graph loads"
        : "frame — only while the scene is on. There is no camera to point at anything you can see."}
      >{@render icon(TOOLBAR_ICONS.frame)}</button>
    <!-- `.shade` is not decoration: the capture tooling selects
         `.toolbar .path.shade select` to shoot the editor in both modes.
         Renaming it silently changes what ships in docs/; MOVING it does
         not, since that is a descendant selector and the bar is its
         ancestor either way. -->
    <label
      class="path shade"
      class:off={!sceneOn}
      title={sceneOn
        ? "how the geometry is shaded — normals read volume and overlap where a single key light flattens them into one silhouette. A redraw, not a recook; vertex colours only show under `lit`."
        : "shade — only while the scene is on. Nothing is being drawn for it to decide the look of."}
    >
      <select
        value={host.shading}
        disabled={!sceneOn}
        aria-label="shade"
        onchange={(e) => onShading(e.currentTarget.value as "lit" | "normals")}
      >
        <option value="lit">lit</option>
        <option value="normals">normals</option>
      </select>
    </label>
    <!-- Acts on the SCENE — it pushes the render back — even though what
         it buys lands on the graph, and that is what puts it in this group
         rather than the next one: a control goes where its SUBJECT is, not
         where its benefit shows up.

         Deliberately NOT a `.path`. That selector was ambiguous once
         before, the day a second `.path` appeared, and the capture tooling
         still drives `.path.shade select` and `.path.cook select` by
         those two-class names. A range is also not `input[type="number"]`,
         which the same script uses to find the seed box.

         NAMED, like every other control on this bar that is not a button.
         `graph`, `seed`, `shade` and `cook` all wear their word — the
         icon buttons keep theirs in `title` and `aria-label` instead —
         and a lone unlabelled slider among them, with no glyph either, is
         a control identified by its shape and its position rather than
         by a word: the one slider on a bar of buttons and selects, sitting
         with the controls that decide what the render looks like.

         The `title` sits on the WRAPPER rather than the input because a
         disabled input dispatches no mouse events and shows no tooltip of
         its own — and outside the combined view, the reason this does
         nothing is exactly what a reader needs. With no text left to
         label, the wrapper is kept for that alone. -->
    <label class="legibility" class:off={!legibilityApplies} title={legibilityTitle}>
      <input
        type="range"
        min="0"
        max={LEGIBILITY_MAX}
        step="0.05"
        value={legibility}
        style="--p: {(Math.min(LEGIBILITY_MAX, Math.max(0, legibility)) / LEGIBILITY_MAX) * 100}%"
        disabled={!legibilityApplies}
        aria-label="how far the scene is pushed back so the graph can be read over it"
        oninput={(e) => onLegibility(e.currentTarget.valueAsNumber)}
      />
    </label>
  </div>

  <!-- THE NODE CANVAS, built the same way: its own switch, then what acts
       on it. Both zooms and the relayout move BOXES, never the camera —
       which is the whole reason `fit` is here and `frame` is in the group
       above, two groups apart instead of two buttons apart. -->
  <div class="grp on-bar" title="the node canvas">
    <!-- The other half of the pair — see the scene toggle above for the
         invariant these two keep and for why their classes are hooks. -->
    <button
      class="view graph on-bar"
      class:on={graphOn}
      aria-pressed={graphOn}
      aria-label="graph"
      onclick={() => onToggleLayer("graph")}
      title="graph — the node canvas. Turning it off leaves the render alone on screen, never nothing. Space cycles the three views, shift-space goes back."
      >{@render icon(TOOLBAR_ICONS.graph)}</button>
    <!-- One pill, because these two are one question asked twice: what
         zoom is the canvas at. `fit` takes whatever zoom shows everything
         and `100%` takes exactly 1:1, so they are two answers to it and
         not two separate actions — joining them says so before either
         tooltip is read. Everything else in this group does something
         other than zoom. -->
    <!-- Inert while the canvas is hidden, the mirror of what `frame` and
         `shade` do without the scene: zooming and relaying out something
         nobody can see are controls that appear to do nothing. -->
    <span class="pill">
      <button
        class:off={!graphOn}
        disabled={!graphOn}
        onclick={onFit}
        aria-label="fit"
        title={graphOn
          ? "fit — zoom out until every node is on screen, however small. The canvas pans with the right button and zooms on the wheel"
          : "fit — only while the graph is on. There is no canvas on screen to zoom."}
        >{@render icon(TOOLBAR_ICONS.fit)}</button>
      <button
        class:off={!graphOn}
        disabled={!graphOn}
        onclick={onActual}
        aria-label="100%, actual size"
        title={graphOn
          ? "100% — actual size: back to 1:1, centred on the graph (ctrl+0) — the zoom a graph opens at whenever it fits there"
          : "100% — only while the graph is on. There is no canvas on screen to zoom."}
        >{@render icon(TOOLBAR_ICONS.actual)}</button>
    </span>
    <button
      class:off={!graphOn}
      disabled={!graphOn}
      onclick={onLayout}
      aria-label="layout"
      title={graphOn
        ? "layout — re-run the deterministic topological layout"
        : "layout — only while the graph is on. The nodes would be rearranged out of sight."}
      >{@render icon(TOOLBAR_ICONS.layout)}</button>
  </div>

  <!-- `cook` is the same kind of hook as `.shade` above: the capture
       tooling drives `.toolbar .path.cook select` to shoot the GPU
       manual asset. The class arrived with that script, after this
       branch's regrouping was written, so it has to be re-added here
       rather than assumed — without it the GPU capture silently shoots
       the CPU path. -->
  <label class="path cook grp" class:off={!host.gpu.ready} title={gpuTitle}>
    cook
    <select
      value={host.gpu.path}
      onchange={(e) => onCookPath(e.currentTarget.value as CookPath)}
    >
      {#each COOK_PATHS as p (p)}
        <option value={p} disabled={p !== "cpu" && !host.gpu.ready}>{cookPathLabel(p)}</option>
      {/each}
    </select>
  </label>

  <!-- The `{" "}` between the pairs is for READERS OF THE TEXT, not for
       the layout: the flex gap is what separates them on screen, and
       without a real character the scraped textContent runs the pairs
       together as "60 fpscook 21.4 ms". A whitespace-only node between
       flex items is not itself a flex item, so it costs no layout. -->
  <span class="status" class:err={status !== null && status.errors.length > 0}>
    {#each stats as s (s.label + s.value)}<span class="stat {s.tone ?? ''}"
      >{#if s.labelFirst}<i>{s.label}</i>{" "}<b>{s.value}</b>{:else}<b>{s.value}</b>{#if s.label !== ""}{" "}<i
          >{s.label}</i
        >{/if}{/if}</span
    >{" "}{/each}
  </span>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px 14px;
    padding: 8px 12px;
    background: var(--ed-panel);
    border-bottom: 1px solid var(--ed-rule);
    backdrop-filter: blur(6px);
    flex: 0 0 auto;
    /* Wraps at ANY width, not just on phones. A side dock is 420-640px
       wide and the dock is `overflow: hidden` — without this the row runs
       past the edge and the controls at its end are simply gone, which
       included the buttons for getting back out of a side dock. */
    flex-wrap: wrap;
  }
  /* One group of controls, and the hairline before the next. The rule is
     drawn as a border on the group rather than as a separate element so
     that a group wrapping to the next row takes its divider with it.

     `flex-wrap` is not optional: the bar wraps at ANY width because a
     side dock is 420-640px and the dock clips, and a group that cannot
     wrap INSIDE itself just runs off the edge taking its last controls
     with it — which is how export and import disappeared at phone
     widths the moment these groups were introduced. */
  .grp {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-left: 14px;
    border-left: 1px solid #333333;
  }
  /* The first group follows the title, which is its own separator. */
  .title + .grp {
    border-left: none;
    padding-left: 0;
  }
  /* A WORDMARK, so height is the only dimension set and the 8.24:1 box
     decides the rest — pinning a width would letterbox or stretch it.
     11px rather than the title's own size: it reads as the product name
     the page belongs to, with `editor` as the louder word for which page
     that is, so the mark sits one step down rather than competing. */
  .mark {
    height: 11px;
    width: auto;
    flex: 0 0 auto;
  }
  .title {
    display: flex;
    align-items: center;
    /* Wider than the 6px the bar uses between siblings, because these two
       are not siblings: the mark is a logotype and the word is a heading,
       and set at a sibling's distance they read as one run of letters
       rather than a product followed by which page of it you are on. */
    gap: 12px;
    font-weight: 600;
    color: var(--ed-ink-hi);
    white-space: nowrap;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ed-ink-mid);
    font-size: var(--ed-t-body);
  }
  input[type="number"] {
    width: 78px;
    padding: 3px 6px;
    background: var(--ed-well);
    color: var(--ed-ink);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-mono);
  }
  select {
    max-width: 260px;
    padding: 3px 6px;
    background: var(--ed-well);
    color: var(--ed-ink);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-sans);
  }
  /* The picker is the bar's primary control, but it may not force the bar
     wider than the dock: `min-width: 0` lets its select shrink, and the
     select's own max-width keeps it from hogging a desktop bar. */
  .graph {
    flex: 0 1 auto;
    min-width: 0;
  }
  .graph select {
    min-width: 0;
  }
  .path select {
    max-width: none;
  }
  /* Dimmed rather than hidden while there is no device: the control has
     to stay visible for its tooltip to carry the reason there is none.
     `legibility` outside the combined view is the same case, and it has a
     second reason — the capture tooling cycles the view between shots, and
     a control that came and went would reflow the bar underneath it. */
  .path.off,
  .legibility.off,
  button.off {
    opacity: 0.55;
  }
  /* A disabled button keeps the arrow rather than showing the "not
     allowed" slash: this is a control that is temporarily out of scope,
     not one being refused, and the tooltip already says which. */
  button:disabled {
    cursor: default;
  }
  /* Two buttons reading as one control: the outer corners keep the shared
     radius, the meeting edge loses its rounding, and the seam is ONE
     border rather than two abutting ones — `margin-left: -1px` on the
     second is what stops the join looking twice as heavy as every other
     edge on the bar. The hovered half is raised above its neighbour so
     its full outline draws over the shared seam rather than under it. */
  .pill {
    display: flex;
  }
  .pill button {
    border-radius: 0;
  }
  .pill button:first-child {
    border-top-left-radius: var(--ed-radius);
    border-bottom-left-radius: var(--ed-radius);
  }
  .pill button:last-child {
    border-top-right-radius: var(--ed-radius);
    border-bottom-right-radius: var(--ed-radius);
    margin-left: -1px;
  }
  .pill button:hover {
    position: relative;
    z-index: 1;
  }
  /* Layout comes from the base `label` rule — flex, centred, a 6px gap and
     the muted ink every other named control on this bar wears. Being a
     `label` rather than a `span` is what earns that. */

  /* Measured rather than chosen: the first row has 211px of slack at
     1454px, the width the docs assets are shot at, and `cook` wraps to a
     second row the moment this control plus its gap exceeds it. The
     figure read 130px when this comment was written and had drifted to 15
     by the time the buttons wore words for the last time — measured on
     the shipped build. Icons gave those 196 back; the regrouping spent
     none of it, having moved controls between groups rather than adding
     one. 76px is what the track had while the word `read` sat in front of
     it; the word is gone now and the width is simply left where it was,
     because the slack is no longer the binding constraint and a wider
     track was never the reason to drop it. */
  /* The knob panel's slider, at toolbar width: a solid bar filled to the
     value, no thumb, the same rule as `shared/Controls.svelte` and
     `shared/overlay.ts` carry. The bar is 6px here rather than 8 — it
     shares a 24px-tall row with icon buttons, and the panel's height
     would sit taller than the glyphs beside it. `accent-color` is gone
     with the thumb it used to tint. */
  .legibility input {
    -webkit-appearance: none;
    appearance: none;
    width: 76px;
    height: 16px;
    margin: 0;
    background-color: transparent;
    background-image: linear-gradient(var(--ed-slider-fill), var(--ed-slider-fill)),
      linear-gradient(var(--ed-slider-track), var(--ed-slider-track));
    background-repeat: no-repeat;
    background-position:
      left center,
      left center;
    background-size:
      var(--p, 0%) 6px,
      100% 6px;
    cursor: ew-resize;
  }
  .legibility input::-webkit-slider-runnable-track {
    height: 100%;
    background: none;
    border: 0;
  }
  .legibility input::-moz-range-track {
    height: 100%;
    background: none;
    border: 0;
  }
  .legibility input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1px;
    height: 6px;
    margin-top: 5px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .legibility input::-moz-range-thumb {
    width: 1px;
    height: 6px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .legibility input:focus {
    outline: none;
  }
  .legibility input:focus-visible {
    outline: 1px solid var(--ed-focus);
    outline-offset: 3px;
  }
  /* Not while it is disabled: out of the combined view this control does
     nothing, and a bar that lights under the pointer says otherwise. */
  .legibility:not(.off) input:hover {
    filter: brightness(1.45);
  }
  /* Every button on this bar is an icon now, so the padding is square
     rather than the text token's 3px 10px — a glyph in a wide slab reads
     as a button with something missing from it. `--ed-btn-pad` still
     rules the text buttons everywhere else. */
  button {
    display: flex;
    padding: 4px 6px;
    background: var(--ed-raised);
    color: var(--ed-action);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-sans);
    cursor: pointer;
  }
  button:hover {
    background: var(--ed-raised-hi);
  }
  .ic {
    width: 15px;
    height: 15px;
    fill: currentColor;
  }
  /* The two view toggles read as STATES, not actions, so they wear the
     tab treatment the panel tabs use rather than the raised button one:
     lit and white when the layer is up, sunken and faint when it is not.

     QUALIFIED WITH `button`, and each state qualified again, so the
     cascade is decided by SPECIFICITY rather than by where these rules
     happen to sit in the file. Two collisions make that worth the extra
     token: `.view.graph` shares its second class with the `graph` label
     around the picker above, whose `flex: 0 1 auto; min-width: 0` exists
     to let a SELECT shrink and has no business squeezing a 15px glyph;
     and the plain `button:hover` above would otherwise tie with the
     resting toggle rule. A rule that only wins because it is written
     second is one edit away from losing. */
  button.view {
    flex: 0 0 auto;
    background: var(--ed-tab);
    color: var(--ed-ink-faint);
  }
  button.view:hover {
    background: var(--ed-raised-hi);
    color: var(--ed-ink);
  }
  button.view.on {
    background: var(--ed-tab-on);
    border-color: var(--ed-tab-on-edge);
    color: var(--ed-ink-hi);
  }
  /* An `on` toggle is still a button you can press, so it answers the
     pointer too — without this the lit state outranks every hover rule
     above and the control goes dead under the cursor. */
  button.view.on:hover {
    background: var(--ed-raised-hi);
  }
  /**
   * The readouts. `flex-basis: auto` rather than `100%`, so they ride the
   * SAME row as the controls whenever their natural width fits in what
   * the controls left over, and take a row of their own when it does not.
   * It used to be `1 1 100%`, which claims a whole line unconditionally —
   * correct while the controls wore words and left 15px of slack, and
   * simply wasteful now icons leave over 200.
   *
   * `flex-shrink: 0` is what makes the wrap CLEAN. Allowed to shrink, the
   * readouts squeeze into the leftover space and then wrap internally,
   * growing the bar to three lines rather than two; refusing to shrink
   * means they either fit beside the controls or move down whole.
   */
  .status {
    display: flex;
    flex: 1 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px 16px;
    min-width: 0;
    font: var(--ed-t-meta) var(--ed-mono);
  }
  .stat {
    white-space: nowrap;
  }
  .stat b {
    color: var(--ed-figure);
    font-weight: 400;
  }
  /* The word that names the figure, set back so the figure carries the
     line. This is the whole trick: same information, one level of
     contrast between what changes and what labels it. */
  .stat i {
    color: var(--ed-ink-ghost);
    font-style: normal;
  }
  /* A warning is dimmer than a figure, an error is the same white but its
     LABEL comes up to meet it — so the pair reads as one loud unit rather
     than one loud half. Hue used to do this; brightness does it now. */
  .stat.warn b {
    color: var(--ed-ink-mid);
  }
  .stat.err b {
    color: var(--ed-danger);
  }
  /* A cook that errored brightens the labels too — at that point the whole
     line is reporting a failed cook, not one bad figure in a good one. */
  .status.err .stat i {
    color: var(--ed-ink-dim);
  }
  /* Desktop: the chevron does not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .chevron {
    display: none;
  }
  @media (max-width: 700px), (max-height: 500px) {
    /* keep in sync with NARROW_MEDIA_QUERY in shared/mobile.ts */
    .toolbar {
      gap: 6px 10px;
      /* Clear of a notch, and tighter than the desktop bar: at 360px the
         padding is competing with the graph picker for width. */
      padding: max(8px, env(safe-area-inset-top)) 10px 8px;
    }
    /**
     * THE BAR IS ONE ROW, and `on-bar` in the markup says which controls
     * earn a place on it: which graph you are looking at, and which of
     * the two layers is up. Everything else — seed, import and export,
     * the camera, shade, exposure, fit, layout, the cook path and the
     * status line — is one tap away on the title, and none of it is
     * something you reach for before deciding what to look at.
     *
     * Wrapping instead, which is what this used to do, spent 181px of an
     * 844px phone on six rows of controls and left the node canvas 241px.
     * `display: none` rather than `{#if}` throughout, so the capture
     * tooling's readiness probe still reads `.toolbar .status`.
     */
    .toolbar.collapsed {
      flex-wrap: nowrap;
    }
    .toolbar.collapsed > :not(.title):not(.on-bar),
    .toolbar.collapsed .grp > :not(.on-bar) {
      display: none;
    }
    /* The picker takes the slack and truncates, rather than pushing the
       layer toggles off the end of a 360px bar. */
    .toolbar.collapsed .graph {
      flex: 1 1 auto;
      min-width: 0;
      /* The word "graph" goes with the wordmark, and for the same reason:
         50px of a 360px bar spent naming a control that is the only
         dropdown on it. `font-size: 0` because the label is a bare text
         node beside its select — there is no element to hide — and the
         select is immune, its `font` shorthand setting a size of its own. */
      font-size: 0;
    }
    .toolbar.collapsed .graph select {
      width: 100%;
      min-width: 0;
      /* Free to use whatever the flex line grants it; the desktop cap is
         there to stop one long title dominating a wide bar, which is not
         a risk when the bar is 360px and this is the only thing on it. */
      max-width: none;
    }
    /* Expanded, the rest arrives as wrapped rows — and stops at half the
       screen, scrolling rather than pushing the canvas off the bottom. */
    .toolbar:not(.collapsed) {
      max-height: 50dvh;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    /* The groups' hairlines would otherwise stack into a row of stray
       rules once the bar wraps onto four lines of two controls each. */
    .grp {
      padding-left: 0;
      border-left: none;
    }
    /* The wordmark is the first thing to go: it is a quarter of a 360px
       bar and it is not a control. The word stays, because the chevron
       needs something to hang off and the pair is the way back to the
       controls the bar just dropped. */
    .mark {
      display: none;
    }
    .title {
      cursor: pointer;
      gap: 6px;
      flex: 0 0 auto;
    }
    .chevron {
      display: inline-block;
      margin-left: 2px;
      color: var(--ed-ink-dim);
      transition: transform 0.2s;
    }
    .chevron.flip {
      transform: rotate(180deg);
    }
    /* The readout takes its own row and wraps inside it. `flex: 1 0 auto`
       above gives it max-content width and no shrink, which on a 360px bar
       means the last two counters are simply off the edge. */
    .status {
      flex: 1 1 100%;
      justify-content: flex-start;
    }
    /* Touch targets. A 24px-high button is a miss on a phone, and these
       sit shoulder to shoulder. */
    button {
      padding: 8px 10px;
    }
    select,
    input {
      min-height: 32px;
    }
  }
</style>
