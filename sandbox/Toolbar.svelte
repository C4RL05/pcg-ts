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
    /** Name of the current view, and the control that cycles it. */
    viewLabel: string;
    onCycleView: () => void;
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
   * not after a clause about scrims. The visible word is `read`, which
   * says what it buys you; the tooltip is where the longer name and the
   * caveat live.
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
  >sandbox<span class="chevron" class:flip={collapsed}>▾</span></span>

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

  <!-- The render group: where the camera points, which view, and how the
       geometry is shaded. `shade` belongs here and not beside `cook`
       because it changes nothing about the cook — it is a redraw of the
       same result, judged by eye like the other two. -->
  <div class="grp">
    <button onclick={onFrame} title="point the camera at what the graph made (F) — done automatically whenever a graph loads">frame</button>
    <!-- The view button is also the view READOUT, so the name is set
         apart and bright: it is the part that changes. It used to be a
         green button, which made the loudest thing on the bar a control
         you press three times a session. -->
    <button class="view" onclick={onCycleView} title="cycle the view (space, shift-space to go back) — hold shift to fly the scene through the graph"
      ><span class="k">view</span>{viewLabel}</button>
    <!-- `.shade` is not decoration: the capture tooling selects
         `.toolbar .path.shade select` to shoot the sandbox in both modes.
         Renaming it silently changes what ships in docs/. -->
    <label class="path shade" title="how the geometry is shaded — normals read volume and overlap where a single key light flattens them into one silhouette. A redraw, not a recook; vertex colours only show under `lit`.">
      shade
      <select value={host.shading} onchange={(e) => onShading(e.currentTarget.value as "lit" | "normals")}>
        <option value="lit">lit</option>
        <option value="normals">normals</option>
      </select>
    </label>
    <!-- Acts on the OVERLAY rather than on the render, and still belongs
         in this group: what it changes is how much of the render reaches
         the eye, which is the question the other three controls here ask.

         Deliberately NOT a `.path`. That selector was ambiguous once
         before, the day a second `.path` appeared, and the capture tooling
         still drives `.path.shade select` and `.path.cook select` by
         those two-class names. A range is also not `input[type="number"]`,
         which the same script uses to find the seed box.

         NAMED, like everything else on this bar. `graph`, `seed`, `view`,
         `shade` and `cook` all wear their word, and a lone unlabelled
         slider among them is a control you have to hover to identify —
         discoverable only to someone who already knows it is there. The
         word was briefly dropped to give the track 34 more pixels; the bar
         measured the same height either way, so that bought nothing that
         was scarce and cost the one thing that was.

         A `label` wraps it, which also gives the word a click target. The
         `title` sits on the LABEL rather than the input because a disabled
         input dispatches no mouse events and shows no tooltip of its own —
         and outside the combined view, the reason this does nothing is
         exactly what a reader needs. -->
    <label class="legibility" class:off={!legibilityApplies} title={legibilityTitle}>
      read
      <input
        type="range"
        min="0"
        max={LEGIBILITY_MAX}
        step="0.05"
        value={legibility}
        disabled={!legibilityApplies}
        aria-label="how far the scene is pushed back so the graph can be read over it"
        oninput={(e) => onLegibility(e.currentTarget.valueAsNumber)}
      />
    </label>
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
     to stay visible for its tooltip to carry the reason there is none.
     `legibility` outside the combined view is the same case, and it has a
     second reason — the capture tooling cycles the view between shots, and
     a control that came and went would reflow the bar underneath it. */
  .path.off,
  .legibility.off {
    opacity: 0.55;
  }
  /* Layout comes from the base `label` rule — flex, centred, a 6px gap and
     the muted ink every other named control on this bar wears. Being a
     `label` rather than a `span` is what earns that. */

  /* Measured rather than chosen: the first row has 130px of slack at
     1454px, the width the docs assets are shot at, and `cook` wraps to a
     second row the moment this control plus its gap exceeds it. The word
     costs 34 of those pixels, which leaves the track at 76 — wide enough
     to aim at, and the constraint is the bar, not the aiming. A version
     that dropped the word to buy the track 104px measured the same bar
     height and cost the only thing that was actually scarce, which is a
     reader knowing what the slider does without hovering it. */
  .legibility input {
    width: 76px;
    accent-color: var(--sb-accent);
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
    /* keep in sync with NARROW_MEDIA_QUERY in shared/mobile.ts */
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
