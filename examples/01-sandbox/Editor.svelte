<script lang="ts">
  /**
   * Root editor panel (Svelte 5 runes): owns the reactive structure model
   * (nodes, edges, positions, seed), selection, toasts, and the modal.
   * All graph semantics live in the controller, which applies every edit
   * to the live graph through the mutation API (add/connect/disconnect/
   * removeNode — no rebuild, so untouched branches keep their cook
   * caches); the panel commits an edit to its view model only after the
   * controller accepted it.
   */
  import { onMount } from "svelte";
  import Canvas from "./Canvas.svelte";
  import Inspector from "./Inspector.svelte";
  import Modal from "./Modal.svelte";
  import Palette from "./Palette.svelte";
  import Toolbar from "./Toolbar.svelte";
  import Knobs from "./Knobs.svelte";
  import { narrowScreen } from "../shared/mobile.js";
  import {
    knobPatch,
    knobValues,
    loadPanelSpec,
    type GraphPanelSpec,
    type KnobPatch,
    type KnobValues,
  } from "../shared/graphUi.js";
  import { findPreset, loadPresetText } from "../shared/presets.js";
  import type { CookStatus, EditorController } from "./controller.js";
  import { topoLayout } from "./layout.js";
  import {
    STARTER_GRAPH_TEXT,
    allocateId,
    paletteGroups,
    type EdgeView,
    type StructureModel,
  } from "./model.js";

  let { controller }: { controller: EditorController } = $props();

  /**
   * What the page opens on when the URL names nothing. A corpus graph
   * that ships a panel spec, so the first thing on screen is a scene with
   * knobs that turn it — the starter graph is four plain nodes and
   * exposes none.
   */
  const DEFAULT_PRESET = "basics-compose-primitives";

  let model = $state<StructureModel>({ seed: 1, nodes: [], edges: [] });
  let selectedId = $state<string | null>(null);
  let status = $state<CookStatus | null>(null);
  let paramsRev = $state(0);
  let toast = $state<{ text: string; kind: "error" | "info" } | null>(null);
  let modal = $state<"export" | "import" | null>(null);
  let exportText = $state("");
  let hashBeforeImport = $state<string | null>(null);
  let awaitingImportCook = $state(false);
  /** How the pending import got here, for its toast ("imported", a title). */
  let importLabel = $state("imported");
  /**
   * Why the pending import is a FALLBACK. The load that follows a bad
   * `?graph=` publishes its own cheerful hash toast a moment later, which
   * would bury the reason the link did not work; this makes the failure
   * the message that survives, since it is the one worth reading.
   */
  let importError = $state<string | null>(null);
  /** Loaded corpus graph, or "" for the built-in starter. */
  let preset = $state("");
  /** The loaded graph's panel spec, when it ships one. */
  let panelSpec = $state<GraphPanelSpec | undefined>(undefined);
  /**
   * Bumped by anything that changes what the knobs panel should show —
   * a different graph, a node added or deleted, a param written from
   * either view. Both counters only ever increase, so their sum is a
   * change signal without either having to know about the other.
   */
  let graphRev = $state(0);
  const knobRev = $derived(graphRev + paramsRev);
  /**
   * The knob values the graph loaded with, and the seed it loaded with.
   * A patch is what has moved SINCE — see knobPatch in graphUi.ts for why
   * the baseline is the loaded graph rather than the primitives' defaults.
   */
  let baseline = $state<KnobValues>({});
  let loadedSeed = $state(0);
  /** A patch carried in the URL, applied once the graph it names is in. */
  let pendingPatch: KnobPatch | null = null;
  const graphTitle = $derived(
    preset === "" ? "starter graph" : (findPreset(preset)?.title ?? preset),
  );

  const groups = paletteGroups();
  const selectedNode = $derived(model.nodes.find((n) => n.id === selectedId) ?? null);

  /**
   * Narrow-screen treatment (viewing-grade, not a mobile editor): the dock
   * becomes a full-width bottom sheet collapsed to the toolbar's first
   * row, and the palette/inspector columns become slide-over drawers so
   * the node canvas gets the full width. All of it is media-query-gated —
   * at desktop widths these flags exist but style nothing. Entering the
   * narrow range collapses the dock, leaving it clears the collapse, so
   * rotating a phone never strands the dock in a stale state.
   */
  let dockCollapsed = $state(narrowScreen().matches);
  let paletteOpen = $state(false);
  let inspectorOpen = $state(false);

  $effect(() => {
    const mql = narrowScreen();
    const onChange = (e: MediaQueryListEvent): void => {
      dockCollapsed = e.matches;
      // Leaving the narrow range also resets the drawers, so one left open
      // does not silently reappear the next time the range is entered.
      if (!e.matches) {
        paletteOpen = false;
        inspectorOpen = false;
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  // Opening one drawer closes the other so they never stack over the canvas.
  function togglePalette(): void {
    paletteOpen = !paletteOpen;
    if (paletteOpen) inspectorOpen = false;
  }
  function toggleInspector(): void {
    inspectorOpen = !inspectorOpen;
    if (inspectorOpen) paletteOpen = false;
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string, kind: "error" | "info" = "info"): void {
    toast = { text, kind };
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), kind === "error" ? 7000 : 3500);
  }

  onMount(() => {
    controller.setStatusListener((s) => {
      status = s;
      if (awaitingImportCook) {
        awaitingImportCook = false;
        if (importError !== null) {
          showToast(importError, "error");
          importError = null;
          return;
        }
        const before = hashBeforeImport;
        if (before !== null) {
          showToast(
            s.hash === before
              ? `${importLabel}: output hash ${s.hash} — identical to the pre-import cook`
              : `${importLabel}: output hash ${s.hash} (was ${before})`,
          );
        } else {
          showToast(`${importLabel}: output hash ${s.hash}`);
        }
      }
    });

    // A `?graph=` in the URL wins, so a link opens the sandbox on the
    // graph it names. An unknown name says so and falls back rather than
    // leaving the canvas empty.
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("p");
    if (raw !== null && raw !== "") {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("expected a JSON object of knob values");
        }
        pendingPatch = parsed as KnobPatch;
      } catch (err) {
        // Held, not shown: the graph has not loaded yet, and its own
        // toast would bury this one a moment later.
        importError = `settings in the link could not be read (${
          err instanceof Error ? err.message : String(err)
        })`;
      }
    }
    const wanted = params.get("graph");
    if (wanted !== null && wanted !== "") {
      if (findPreset(wanted) === undefined) {
        importError = `no graph named "${wanted}" in the corpus — opened the default instead`;
      } else {
        void openPreset(wanted, { updateUrl: false });
        return;
      }
    }
    // Otherwise a real graph with real knobs, not the empty-ish starter:
    // landing on something already working is most of what makes a
    // sandbox one. The starter stays in the picker.
    if (findPreset(DEFAULT_PRESET) !== undefined) {
      void openPreset(DEFAULT_PRESET, { updateUrl: false });
      return;
    }
    loadStarter();
  });

  function loadStarter(): void {
    const res = controller.importText(STARTER_GRAPH_TEXT);
    if ("error" in res) {
      showToast(res.error, "error");
      return;
    }
    model = res.structure;
    selectedId = null;
    graphRev++;
    captureBaseline();
  }

  /**
   * The graph as loaded becomes the thing a patch is measured against.
   * Called after every load, so switching graphs never leaves a patch
   * describing the previous one.
   */
  function captureBaseline(): void {
    baseline = knobValues(controller.knobs());
    loadedSeed = model.seed;
  }

  /**
   * Load one corpus graph through the same path a pasted import takes —
   * deserializeGraph validates it, the mirror is rebuilt, and the
   * structure comes back with a deterministic layout. A preset is not a
   * special kind of graph; it is the import with the paste step removed.
   */
  async function openPreset(name: string, opts: { updateUrl: boolean }): Promise<void> {
    if (name === "") {
      preset = "";
      panelSpec = undefined;
      loadStarter();
      if (opts.updateUrl) syncUrl("");
      return;
    }
    let text: string;
    let spec: GraphPanelSpec | undefined;
    try {
      text = await loadPresetText(name);
      spec = await loadPanelSpec(name);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      return;
    }
    const err = applyImport(text, findPreset(name)?.title ?? name);
    if (err !== null) {
      showToast(err, "error");
      return;
    }
    preset = name;
    panelSpec = spec;
    captureBaseline();
    if (pendingPatch !== null) {
      const patch = pendingPatch;
      pendingPatch = null;
      applyPatch(patch, "link");
    }
    if (opts.updateUrl) syncUrl(name);
  }

  /**
   * Apply a patch and report what did not land. `applied` edits schedule
   * one cook between them, so a twelve-knob link is still one recook.
   */
  function applyPatch(patch: KnobPatch, source: "link" | "reset"): void {
    const { applied, problems } = controller.applyKnobPatch(patch);
    if (patch.seed !== undefined && typeof patch.seed === "number") model.seed = patch.seed >>> 0;
    paramsRev++;
    if (problems.length === 0) return;
    const message = `${source === "link" ? "shared settings" : "reset"}: applied ${applied}, could not apply ${problems.length} — ${problems.join("; ")}`;
    // A patch from a link lands mid-import, and the import's own hash
    // toast is still to come — hand the message to that, or it is shown
    // and buried within the same second.
    if (awaitingImportCook) importError = message;
    else showToast(message, "error");
  }

  /**
   * Put every knob — and the seed — back to what the graph loaded with.
   * The seed has to be in here explicitly: it is part of what a patch
   * reports, so leaving it out would make "reset" land on a state that
   * still reads as changed.
   */
  function resetKnobs(): void {
    applyPatch({ ...baseline, seed: loadedSeed }, "reset");
  }

  /** The link that reopens what is on screen: the graph, plus the patch. */
  function shareUrl(patch: KnobPatch): string {
    const url = new URL(window.location.href);
    url.searchParams.delete("graph");
    url.searchParams.delete("p");
    if (preset !== "") url.searchParams.set("graph", preset);
    if (Object.keys(patch).length > 0) url.searchParams.set("p", JSON.stringify(patch));
    return url.toString();
  }

  /** Keep the address bar on the loaded graph, so the tab is linkable. */
  function syncUrl(name: string): void {
    const url = new URL(window.location.href);
    if (name === "") url.searchParams.delete("graph");
    else url.searchParams.set("graph", name);
    window.history.replaceState(null, "", url);
  }

  // -- actions -------------------------------------------------------------

  function addNode(type: string): void {
    const used = new Set(model.nodes.map((n) => n.id));
    const id = allocateId(type, used);
    const res = controller.addNode(id, type);
    if ("error" in res) {
      showToast(res.error, "error");
      return;
    }
    const n = model.nodes.length;
    model.nodes.push({
      id,
      type,
      x: 48 + (n % 4) * 36,
      y: 40 + (n % 6) * 32,
      inputs: res.inputs,
      outputs: res.outputs,
    });
    selectedId = id;
    graphRev++;
    // On narrow screens the palette is a drawer covering the canvas; close
    // it after a successful add so the new node is visible. No-op on
    // desktop, where `open` has no styled effect.
    paletteOpen = false;
  }

  function moveNode(id: string, x: number, y: number): void {
    const node = model.nodes.find((n) => n.id === id);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  function connectEdge(edge: EdgeView): void {
    const err = controller.connectEdge(edge);
    if (err) {
      showToast(err, "error");
      return;
    }
    model.edges.push(edge);
  }

  function deleteEdge(index: number): void {
    const edge = model.edges[index];
    if (!edge) return;
    const err = controller.disconnectEdge({
      from: edge.from,
      fromPin: edge.fromPin,
      to: edge.to,
      toPin: edge.toPin,
    });
    if (err) {
      showToast(err, "error");
      return;
    }
    model.edges.splice(index, 1);
  }

  function deleteNode(id: string): void {
    const err = controller.deleteNode(id);
    if (err) {
      showToast(err, "error");
      return;
    }
    model.nodes = model.nodes.filter((n) => n.id !== id);
    model.edges = model.edges.filter((e) => e.from !== id && e.to !== id);
    if (selectedId === id) selectedId = null;
    graphRev++;
  }

  function setSeed(seed: number): void {
    model.seed = seed >>> 0;
    controller.setSeed(model.seed);
  }

  function relayout(): void {
    topoLayout(model.nodes, model.edges);
  }

  function openExport(): void {
    exportText = controller.exportText();
    modal = "export";
  }

  function applyImport(text: string, label = "imported"): string | null {
    hashBeforeImport = status?.hash ?? null;
    const res = controller.importText(text);
    if ("error" in res) return res.error;
    model = res.structure;
    selectedId = null;
    importLabel = label;
    awaitingImportCook = true;
    graphRev++;
    return null;
  }

  /**
   * A pasted graph is nobody's preset any more, so the picker and the URL
   * stop claiming it is one — otherwise a shared link would reopen the
   * corpus graph rather than what the sender was actually looking at.
   */
  function applyPastedImport(text: string): string | null {
    const err = applyImport(text);
    if (err !== null) return err;
    preset = "";
    panelSpec = undefined;
    captureBaseline();
    syncUrl("");
    return null;
  }

  function onPlainParam(id: string, key: string, value: unknown): void {
    controller.setPlainParam(id, key, value);
    paramsRev++;
  }

  function onFieldParam(id: string, key: string, text: string): string | null {
    const err = controller.applyFieldParam(id, key, text);
    if (err === null) paramsRev++;
    return err;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (modal !== null) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
    ) {
      return;
    }
    if (selectedId !== null) {
      e.preventDefault();
      deleteNode(selectedId);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Over the viewport, not in the dock: these are the knobs of the thing
     on screen, and the dock is about how it is wired. -->
<Knobs
  {controller}
  rev={knobRev}
  spec={panelSpec}
  title={graphTitle}
  {baseline}
  seed={model.seed}
  {loadedSeed}
  onEdit={() => paramsRev++}
  onReset={resetKnobs}
  {shareUrl} />

<div class="editor" class:collapsed={dockCollapsed}>
  <Toolbar
    seed={model.seed}
    {status}
    collapsed={dockCollapsed}
    {preset}
    onPreset={(name) => void openPreset(name, { updateUrl: true })}
    onSeed={setSeed}
    onExport={openExport}
    onImport={() => (modal = "import")}
    onLayout={relayout}
    onToggle={() => (dockCollapsed = !dockCollapsed)}
  />
  {#if status && status.errors.length > 0}
    <div class="cook-errors">
      {#each status.errors as err}
        <div>{err}</div>
      {/each}
    </div>
  {/if}
  <div class="body">
    <Palette {groups} onAdd={addNode} open={paletteOpen} />
    <div class="canvas-wrap">
      <Canvas
        {model}
        {selectedId}
        onSelect={(id) => (selectedId = id)}
        onMove={moveNode}
        onConnect={connectEdge}
        onDeleteEdge={deleteEdge}
        onDeleteNode={deleteNode}
      />
    </div>
    <Inspector
      {controller}
      node={selectedNode}
      {paramsRev}
      open={inspectorOpen}
      onPlain={onPlainParam}
      onFieldApply={onFieldParam}
      onDelete={deleteNode}
    />
    <!-- Narrow-screen drawer toggles, floating over the canvas edges.
         display: none outside the media query. The labels "nodes" and
         "params" are chosen to dodge the capture tooling's
         click-button-by-substring needles. -->
    <button
      class="drawer-tab left"
      aria-label="toggle the node palette drawer"
      aria-expanded={paletteOpen}
      onclick={togglePalette}
    >
      nodes
    </button>
    <button
      class="drawer-tab right"
      aria-label="toggle the param inspector drawer"
      aria-expanded={inspectorOpen}
      onclick={toggleInspector}
    >
      params
    </button>
  </div>
  {#if toast}
    <div class="toast {toast.kind}">{toast.text}</div>
  {/if}
</div>

{#if modal === "export"}
  <Modal
    title="export — serializeGraph JSON"
    initial={exportText}
    mode="export"
    onClose={() => (modal = null)}
  />
{:else if modal === "import"}
  <Modal
    title="import — paste serialized graph JSON"
    initial=""
    mode="import"
    onApply={applyPastedImport}
    onClose={() => (modal = null)}
  />
{/if}

<style>
  .editor {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    height: 46vh;
    min-height: 320px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    background: rgba(13, 17, 23, 0.92);
    border: 1px solid #2a3548;
    border-radius: 10px;
    color: #dbe4f0;
    font: 13px/1.45 system-ui, sans-serif;
    backdrop-filter: blur(6px);
    overflow: hidden;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    /* Anchors the narrow-screen drawers and their toggle tabs below the
       toolbar. Visually inert at desktop widths. */
    position: relative;
  }
  .canvas-wrap {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background:
      linear-gradient(rgba(34, 48, 71, 0.28) 1px, transparent 1px),
      linear-gradient(90deg, rgba(34, 48, 71, 0.28) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .cook-errors {
    max-height: 64px;
    overflow-y: auto;
    padding: 4px 12px;
    border-bottom: 1px solid #402734;
    background: #1c1218;
    color: #ff9ca8;
    font: 11px/1.5 ui-monospace, monospace;
    white-space: pre-wrap;
  }
  .toast {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    max-width: 70%;
    max-height: 110px;
    overflow-y: auto;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
  }
  .toast.info {
    background: #16321f;
    border: 1px solid #2f9e5f;
    color: #b8f5c8;
  }
  .toast.error {
    background: #33161c;
    border: 1px solid #a04455;
    color: #ffb9c2;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  /* Desktop: the drawer tabs do not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .drawer-tab {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in examples/shared/mobile.ts */
    .editor {
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: 12px 12px 0 0;
      height: 50vh;
      height: 50dvh; /* dvh where supported; vh fallback above */
      min-height: 0;
      transition: height 0.25s ease;
    }
    /* Collapse clips to the toolbar's first row via height + overflow,
       never {#if}: the capture tooling's readiness probe scrapes
       `.toolbar .status` and needs it rendered either way. */
    .editor.collapsed {
      height: 44px;
      overflow: hidden;
    }
    .drawer-tab {
      display: block;
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      /* Above the drawers (z-index 15) so a second tap can close them. */
      z-index: 16;
      padding: 10px 6px;
      background: rgba(29, 42, 63, 0.92);
      color: #9ecbff;
      border: 1px solid #33405a;
      font: 11px system-ui, sans-serif;
      cursor: pointer;
    }
    .drawer-tab.left {
      left: 0;
      border-left: none;
      border-radius: 0 6px 6px 0;
    }
    .drawer-tab.right {
      right: 0;
      border-right: none;
      border-radius: 6px 0 0 6px;
    }
    /* The collapsed dock is a title bar only; the tabs would otherwise
       poke into it, because .body still has a few clipped pixels and the
       tabs anchor to its vertical center. */
    .editor.collapsed .drawer-tab {
      display: none;
    }
  }
</style>
