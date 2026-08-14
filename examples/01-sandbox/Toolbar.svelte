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
    viewLabel,
    onCycleView,
    onFit,
    onActual,
    host,
    onToggle,
    onFrame,
    onCookPath,
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
    /** Name of the current view, and the control that cycles it. */
    viewLabel: string;
    onCycleView: () => void;
    /** Readouts the host owns rather than the cook: frame rate, what drew, the device. */
    host: { fps: string; drew: string; gpu: GpuState };
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
  >01 · sandbox<span class="chevron" class:flip={collapsed}>▾</span></span>

  <!-- Grouped by what a control acts ON — the loaded graph, the node
       canvas, the render, the cook — with a hairline between groups.
       Everything used to sit in one undifferentiated run, so "fit" (which
       moves the canvas) and "frame" (which moves the camera) read as a
       pair of the same thing when they are opposites. -->
  <div class="grp">
    <label class="graph">
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
    <button onclick={onExport} title="serializeGraph → JSON">export</button>
    <button onclick={onImport} title="paste JSON → deserializeGraph">import</button>
  </div>

  <div class="grp" title="the node canvas">
    <button onclick={onLayout} title="re-run the deterministic topological layout">layout</button>
    <button onclick={onActual} title="back to 1:1, centred on the graph (ctrl+0) — the zoom a graph opens at whenever it fits there">100%</button>
    <button onclick={onFit} title="zoom out until every node is on screen, however small. The canvas pans with the right button and zooms on the wheel">fit</button>
  </div>

  <div class="grp">
    <button onclick={onFrame} title="point the camera at what the graph made (F) — done automatically whenever a graph loads">frame</button>
    <!-- The view button is also the view READOUT, so the name is set
         apart and bright: it is the part that changes. It used to be a
         green button, which made the loudest thing on the bar a control
         you press three times a session. -->
    <button class="view" onclick={onCycleView} title="cycle the view (space, shift-space to go back) — hold shift to fly the scene through the graph"
      ><span class="k">view</span>{viewLabel}</button>
  </div>

  <label class="path grp" class:off={!host.gpu.ready} title={gpuTitle}>
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
    background: var(--sb-panel);
    border-bottom: 1px solid var(--sb-rule);
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
  .title {
    font-weight: 600;
    color: var(--sb-ink-hi);
    white-space: nowrap;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--sb-ink-mid);
    font-size: var(--sb-t-body);
  }
  input[type="number"] {
    width: 78px;
    padding: 3px 6px;
    background: var(--sb-well);
    color: var(--sb-ink);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-mono);
  }
  select {
    max-width: 260px;
    padding: 3px 6px;
    background: var(--sb-well);
    color: var(--sb-ink);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-sans);
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
     to stay visible for its tooltip to carry the reason there is none. */
  .path.off {
    opacity: 0.55;
  }
  button {
    padding: var(--sb-btn-pad);
    background: var(--sb-raised);
    color: var(--sb-action);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-sans);
    cursor: pointer;
  }
  button:hover {
    background: var(--sb-raised-hi);
  }
  /* Label inside the button, so the changing half stands out from the
     word that never changes. */
  .view .k {
    margin-right: 7px;
    color: var(--sb-ink-faint);
  }
  .view {
    color: var(--sb-ink);
  }
  /**
   * The readouts. `flex: 1 1 100%` puts them on their own row under the
   * controls at every width, which is what lets them be a table of pairs
   * rather than a sentence squeezed into whatever the controls left over.
   */
  .status {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px 16px;
    min-width: 0;
    font: var(--sb-t-meta) var(--sb-mono);
  }
  .stat {
    white-space: nowrap;
  }
  .stat b {
    color: var(--sb-figure);
    font-weight: 400;
  }
  /* The word that names the figure, set back so the figure carries the
     line. This is the whole trick: same information, one level of
     contrast between what changes and what labels it. */
  .stat i {
    color: var(--sb-ink-ghost);
    font-style: normal;
  }
  /* A warning is dimmer than a figure, an error is the same white but its
     LABEL comes up to meet it — so the pair reads as one loud unit rather
     than one loud half. Hue used to do this; brightness does it now. */
  .stat.warn b {
    color: var(--sb-ink-mid);
  }
  .stat.err b {
    color: var(--sb-danger);
  }
  /* A cook that errored brightens the labels too — at that point the whole
     line is reporting a failed cook, not one bad figure in a good one. */
  .status.err .stat i {
    color: var(--sb-ink-dim);
  }
  /* Desktop: the chevron does not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .chevron {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in examples/shared/mobile.ts */
    .toolbar {
      /* Seed, buttons, and status wrap to fit a phone width. */
      flex-wrap: wrap;
    }
    /* Collapsed, the bar shows only the title — clipping the wrapped rows
       at the dock's 44px would leave a sliver of the second row visible.
       display: none keeps the elements in the DOM, so the capture
       tooling's readiness probe (`.toolbar .status` textContent) still
       reads; captures also never run at narrow widths. */
    .toolbar.collapsed label,
    .toolbar.collapsed button,
    .toolbar.collapsed .grp,
    .toolbar.collapsed .status {
      display: none;
    }
    /* The groups' hairlines would otherwise stack into a row of stray
       rules once the bar wraps onto four lines of two controls each. */
    .grp {
      padding-left: 0;
      border-left: none;
    }
    .title {
      cursor: pointer;
    }
    .chevron {
      display: inline-block;
      margin-left: 6px;
      color: var(--sb-ink-dim);
      transition: transform 0.2s;
    }
    .chevron.flip {
      transform: rotate(180deg);
    }
  }
</style>
