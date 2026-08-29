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
  import { onMount, tick, untrack } from "svelte";
  import Canvas from "./Canvas.svelte";
  import Inspector from "./Inspector.svelte";
  import Modal from "./Modal.svelte";
  import Overview from "./Overview.svelte";
  import Palette from "./Palette.svelte";
  import Toolbar from "./Toolbar.svelte";
  import { narrowScreen } from "../shared/mobile.js";
  import {
    knobValues,
    loadPanelSpec,
    type GraphPanelSpec,
    type KnobPatch,
    type KnobValues,
  } from "../shared/graphUi.js";
  import { findPreset, loadPresetText } from "../shared/presets.js";
  import type { CookPath } from "../shared/gpu.js";
  import type { GpuState } from "./main.js";
  import type { CookStatus, EditorController } from "./controller.js";
  import { autoLayout } from "../shared/graph/autoLayout.js";
  import {
    STARTER_GRAPH_TEXT,
    allocateId,
    nodeCategory,
    paletteGroups,
    paramPreviews,
    type EdgeView,
    type ParamPreview,
    type StructureModel,
  } from "./model.js";

  let {
    controller,
    bridge,
  }: {
    controller: EditorController;
    /**
     * The host publishes readouts it owns (fps, what was drawn) here, and
     * hangs its re-frame control off it. The scene belongs to the host,
     * but the keyboard belongs to this component — it is the one that
     * knows whether a keystroke is a command or a character.
     */
    bridge: {
      publish?: (s: {
        fps: string;
        drew: string;
        gpu: GpuState;
        shading: "lit" | "normals";
      }) => void;
      frame?: () => void;
      setCookPath?: (path: CookPath) => void;
      setShading?: (mode: "lit" | "normals") => void;
    };
  } = $props();

  let host = $state<{ fps: string; drew: string; gpu: GpuState; shading: "lit" | "normals" }>({
    fps: "–",
    drew: "–",
    gpu: { path: "cpu", ready: false, label: "", error: null },
    shading: "lit",
  });
  untrack(() => {
    bridge.publish = (s) => (host = s);
  });

  /**
   * What is on screen: two LAYERS, and the three states they can be in.
   * The useful question is not "graph or no graph" but whether the scene
   * is behind it — all of it while you place nodes against what they
   * make, none of it when the graph IS the work.
   *
   * THREE ROWS, NOT FOUR. The bar drives these with two independent
   * toggles, and the pair may never both be off: a page showing neither
   * layer is a blank screen with no way back onto it. That invariant is
   * this table's SHAPE rather than a check somewhere — "neither" is not a
   * row here, so no code has to notice it happening and undo it. See
   * `toggleLayer` for the one rule that gets you between them.
   *
   * The scrim is not listed beside the layers any more: it IS
   * `scene ? 0 : 1`, and two fields saying one thing can disagree.
   *
   * `graph` hides the CANVAS AND THE SIDEBAR, never the toolbar. The bar
   * carries the graph picker, the seed, the cook path and the whole
   * readout line — none of which stop being useful when you are looking
   * at the render, and one of which is how you get back. Hiding the
   * overlay wholesale meant the only way out of the scene view was the
   * space bar, with nothing on screen to say so.
   */
  const VIEWS = [
    { id: "scene", scene: true, graph: false },
    { id: "both", scene: true, graph: true },
    { id: "graph", scene: false, graph: true },
  ] as const;

  /**
   * Shift hands the mouse to the render while both are on screen. The
   * graph keeps it otherwise, which is the common case; holding a key is
   * how you reach past it to fly the scene without leaving the view.
   *
   * Only in `scene + graph`: with the scene covered there is nothing
   * behind the canvas to reach.
   */
  let shiftHeld = $state(false);
  let viewIndex = $state(1);
  const view = $derived(VIEWS[viewIndex]);
  // Declared after `view`, which it reads. A `$derived` is lazy, so the
  // original order happened to work — but it read a block-scoped binding
  // from above its declaration, which is a TDZ error the moment anything
  // evaluates it eagerly.
  const sceneHasPointer = $derived(shiftHeld && view.id === "both");

  /**
   * HOW FAR THE RENDER IS PUSHED BACK SO THE GRAPH CAN BE READ.
   *
   * The combined view is the only one where the two layers compete, and
   * what loses is not the node boxes — their fill is opaque #0e0e0e, so a
   * title and a param row stay readable over anything. It is the CABLES.
   * A connection is a 1.6px curve at 55% over a 4px black casing, and
   * against a dense high-frequency render (the rig under `normals` is the
   * worst the page can produce) it is untraceable within about fifty
   * pixels of the pin it leaves. Reading how nodes CONNECT is the whole
   * point of the view, so a graph whose boxes all read and whose wires do
   * not is still a lost view.
   *
   * Zero by default, which is what the combined view has always shown:
   * the slider starts where the VIEWS table already put it, so nobody who
   * never touches it sees a change.
   */
  let legibility = $state(0);
  /** The combined view — the only one where the slider means anything. */
  const combined = $derived(view.id === "both");
  /**
   * The view still decides the scrim everywhere else. `scene` has no graph
   * to help and `graph` has nothing left to push back, so neither hands
   * this over: it is one control for the one view that needs it, not a
   * global brightness knob.
   */
  const scrimOpacity = $derived(combined ? legibility : view.scene ? 0 : 1);
  /** Step is always ±1 — never wired straight to a click, whose event
      argument would land here as the step and make the index NaN. */
  function cycleView(step: 1 | -1 = 1): void {
    viewIndex = (viewIndex + step + VIEWS.length) % VIEWS.length;
  }
  /**
   * What the bar's two toggles do, in one rule: turning a layer OFF lands
   * on the view where the other one is alone, and turning one ON lands on
   * both. Nothing here special-cases the last layer standing, because
   * that case is not special — clicking the only layer that is on is
   * "turn it off", and the view where the other one is alone is where
   * that goes. The result is a SWAP rather than a blank screen, and it
   * falls out of the rule instead of correcting it.
   *
   * `other` doubles as a view id: the two single-layer views are named
   * after the layer they show, which is what lets this be a lookup rather
   * than a table of six transitions.
   */
  function toggleLayer(layer: "scene" | "graph"): void {
    const other = layer === "scene" ? "graph" : "scene";
    viewIndex = VIEWS.findIndex((v) => v.id === (view[layer] ? other : "both"));
  }

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
  // `paramsRev` above is the one revision counter: anything that changes
  // what either param view should show bumps it — a different graph, a
  // node added or deleted, a param written from either side.
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
   * What every node box prints in its param band, rebuilt once per
   * revision. Here rather than in the boxes because `paramViews` reads
   * the live graph: per box it would be one walk per node per render, and
   * renders happen on every pointermove of a drag.
   *
   * It reads each node's `id` and `type` and nothing else, so MOVING a
   * node — which writes x and y — does not invalidate it. That is the
   * whole reason dragging stays free.
   */
  const previews = $derived.by((): Map<string, readonly ParamPreview[]> => {
    void paramsRev;
    return new Map(
      model.nodes.map((n) => [n.id, paramPreviews(controller.paramViews(n.id, n.type))]),
    );
  });

  /**
   * Narrow-screen treatment (viewing-grade, not a mobile editor): the
   * overlay collapses to the toolbar's first row, and the palette and
   * param columns become slide-over drawers so the node canvas gets the
   * full width. All of it is media-query-gated — at desktop widths these
   * flags exist but style nothing. Entering the narrow range collapses,
   * leaving it clears the collapse, so rotating a phone never strands the
   * overlay in a stale state.
   */
  /** Canvas component ref, for the toolbar's "fit" button and node placement. */
  let canvas = $state<
    | {
        resetView: (opts?: { preferActual?: boolean }) => void;
        actualSize: () => void;
        graphPointAt: (x: number, y: number) => { x: number; y: number };
      }
    | undefined
  >();

  /**
   * Where the node menu is open, in client px, or null. It is summoned at
   * the pointer, so the last position is tracked rather than asked for —
   * a keystroke carries no coordinates.
   */
  let menuAt = $state<{ x: number; y: number } | null>(null);
  let pointer = { x: 0, y: 0 };

  /**
   * Refit when the canvas appears: it was not measurable while hidden.
   * Leaving the graph closes the node menu with it — it is summoned at the
   * pointer and floats above everything, so a menu left open would hang
   * over the bare scene with nothing to add a node to.
   */
  $effect(() => {
    if (view.graph) frameGraph();
    else menuAt = null;
  });

  let collapsed = $state(narrowScreen().matches);
  /**
   * Narrow screens only: the floating panels would cover a phone's whole
   * canvas, so there they are a drawer rather than an overlay. At desktop
   * widths this styles nothing and both panels are simply up.
   */
  let panelsOpen = $state(false);

  /**
   * The node panel appears BECAUSE something is selected — there is no
   * separate "which panel" state to keep in step any more. Clearing the
   * selection takes the panel away with it.
   */
  function select(id: string | null): void {
    selectedId = id;
  }

  $effect(() => {
    const mql = narrowScreen();
    const onChange = (e: MediaQueryListEvent): void => {
      collapsed = e.matches;
      // Leaving the narrow range also resets the drawer, so one left open
      // does not silently reappear the next time the range is entered.
      if (!e.matches) panelsOpen = false;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

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

    // A `?graph=` in the URL wins, so a link opens the editor on the
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
    // editor one. The starter stays in the picker.
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
    select(null);
    paramsRev++;
    captureBaseline();
    frameGraph();
  }

  /**
   * Frame the whole graph after a load. The canvas pans and zooms rather
   * than scrolling, so without this a graph wider than the view opens
   * with its tail off-screen and no scrollbar to say so. Deferred a tick:
   * the fit measures the canvas, which has not laid out the new nodes yet.
   */
  function frameGraph(): void {
    void tick().then(() => canvas?.resetView({ preferActual: true }));
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
    try {
      text = await loadPresetText(name);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      return;
    }
    // The PANEL is loaded separately, and its failure is not the graph's.
    // Both used to sit in one `try` that returned before `applyImport`, so a
    // hand-edited sidecar the validator refused took the whole graph down
    // with it — a presentation file deciding whether generation happens,
    // which is the one thing the sidecar split exists to prevent. A refused
    // spec now says so and leaves the graph open with the panel derived
    // from its schemas, which is what a graph with no sidecar at all gets.
    let spec: GraphPanelSpec | undefined;
    try {
      spec = await loadPanelSpec(name);
    } catch (err) {
      spec = undefined;
      showToast(
        `${err instanceof Error ? err.message : String(err)} — showing the panel derived from the graph's own params instead.`,
        "error",
      );
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
    // Where the menu was summoned, in graph units: a node appears under
    // the pointer that asked for it rather than at a corner.
    const n = model.nodes.length;
    const spot = menuAt !== null ? canvas?.graphPointAt(menuAt.x, menuAt.y) : undefined;
    const category = nodeCategory(type);
    model.nodes.push({
      id,
      type,
      ...(category !== undefined ? { category } : {}),
      x: spot ? Math.round(spot.x) : 48 + (n % 4) * 36,
      y: spot ? Math.round(spot.y) : 40 + (n % 6) * 32,
      inputs: res.inputs,
      outputs: res.outputs,
    });
    select(id);
    paramsRev++;
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
    if (selectedId === id) select(null);
    paramsRev++;
  }

  function setSeed(seed: number): void {
    model.seed = seed >>> 0;
    controller.setSeed(model.seed);
  }

  function relayout(): void {
    // The row heights the boxes actually have — a column stacked on the
    // pre-preview height would tuck each box into the one below it.
    autoLayout(
      model.nodes,
      model.edges,
      new Map([...previews].map(([id, rows]) => [id, rows.length])),
    );
    frameGraph();
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
    select(null);
    importLabel = label;
    awaitingImportCook = true;
    paramsRev++;
    frameGraph();
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

  function onPlainParam(id: string, key: string, value: unknown): string | null {
    const err = controller.setPlainParam(id, key, value);
    paramsRev++;
    return err;
  }

  function onFieldParam(id: string, key: string, text: string): string | null {
    const err = controller.applyFieldParam(id, key, text);
    if (err === null) paramsRev++;
    return err;
  }

  /** Somewhere a keystroke means a character, not a command. */
  function isTyping(t: HTMLElement | null): boolean {
    return (
      t !== null &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    );
  }

  function onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    /**
     * The space bar cycles the view; shift-space walks it back. A live
     * view has to be switchable without looking away from it, and space
     * is the key nothing else on this page wants — except a focused
     * button, which space is supposed to press, and a text field, where
     * it is a character. Both keep it; a modal keeps it too.
     */
    if (e.key === " " && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (modal !== null || isTyping(target) || target?.tagName === "BUTTON") return;
      e.preventDefault();
      cycleView(e.shiftKey ? -1 : 1);
      return;
    }
    /**
     * Tab summons the node menu at the pointer, and closes it again. It
     * only means that while the graph is up — with the scene alone on
     * screen there is nothing to add a node to, and Tab goes back to
     * being the browser's.
     */
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (modal !== null || isTyping(target) || !view.graph) return;
      e.preventDefault();
      menuAt = menuAt === null ? { ...pointer } : null;
      return;
    }
    /**
     * F re-frames the scene on what the graph made. The camera is placed
     * automatically when a graph loads and then left alone, so this is
     * the way back after flying off, or after a knob has grown the
     * content past the pose it was framed at.
     */
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (modal !== null || isTyping(target)) return;
      e.preventDefault();
      bridge.frame?.();
      return;
    }
    /**
     * Ctrl+0 (Cmd+0) puts the GRAPH back to 100%, the chord that resets a
     * page's zoom everywhere else. `preventDefault` is what stops the
     * browser doing its own reset on top; if the chord ever stops being
     * preventable, the "100%" button is the same action.
     *
     * No `isTyping` guard, unlike the bare keys above: Ctrl+0 means
     * nothing inside a text field, so there is nothing to yield to and
     * the shortcut should still work with focus in a param box. A modal
     * hands it back to the browser, and so does the scene view, where
     * there is no graph to zoom.
     */
    if (e.key === "0" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (modal !== null || !view.graph) return;
      e.preventDefault();
      canvas?.actualSize();
      return;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (modal !== null) return;
    if (isTyping(target)) return;
    if (selectedId !== null) {
      e.preventDefault();
      deleteNode(selectedId);
    }
  }
</script>

<!-- Shift is read off every event that carries it rather than tracked as
     a keypress alone: a window that gains focus with the key already down
     never sees its keydown, and a lost keyup would otherwise leave the
     canvas dead until the next press. -->
<svelte:window
  onkeydown={(e) => {
    shiftHeld = e.shiftKey;
    onKeydown(e);
  }}
  onkeyup={(e) => (shiftHeld = e.shiftKey)}
  onblur={() => (shiftHeld = false)}
  onpointermove={(e) => {
    shiftHeld = e.shiftKey;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }} />

<!-- Behind the overlay, in front of the scene: how much of the render
     shows through is a property of the VIEW, not of the graph, so it is
     one element rather than an opacity smeared over the editor's parts.
     In the combined view the reader sets it instead — see `legibility`,
     which starts at the 0 the table already declared there. -->
<div class="scrim" style="opacity: {scrimOpacity}" aria-hidden="true"></div>

<div class="editor" class:collapsed class:bare={!view.graph}>
  <Toolbar
    seed={model.seed}
    {status}
    {collapsed}
    {preset}
    onPreset={(name) => void openPreset(name, { updateUrl: true })}
    onSeed={setSeed}
    onExport={openExport}
    onImport={() => (modal = "import")}
    onLayout={relayout}
    onFit={() => canvas?.resetView()}
    onActual={() => canvas?.actualSize()}
    onFrame={() => bridge.frame?.()}
    onCookPath={(p) => bridge.setCookPath?.(p)}
    onShading={(m) => bridge.setShading?.(m)}
    {legibility}
    legibilityApplies={combined}
    onLegibility={(v) => (legibility = v)}
    sceneOn={view.scene}
    graphOn={view.graph}
    onToggleLayer={toggleLayer}
    {host}
    onToggle={() => {
      collapsed = !collapsed;
      /* Refit, because on a phone this is a resize: the bar's other rows
         are ~170px of a 740px screen, and the canvas grows and shrinks
         from the top, so a graph framed against one of the two states
         hangs off the bottom in the other. Narrow screens only — at
         desktop widths nothing here changes size, and refitting a view
         someone panned deliberately would be a bug rather than a
         courtesy. */
      if (view.graph && narrowScreen().matches) frameGraph();
    }}
  />
  {#if status && status.errors.length > 0}
    <div class="cook-errors">
      {#each status.errors as err}
        <div>{err}</div>
      {/each}
    </div>
  {/if}
  <!-- The graph half. Hidden in the scene view, which is also what stops
       it taking the pointer: `display: none` cannot be clicked, so the
       render underneath orbits normally with no click-through needed. -->
  <div class="body" hidden={!view.graph}>
    <div class="canvas-wrap" class:through={sceneHasPointer}>
      <Canvas
        bind:this={canvas}
        {model}
        {selectedId}
        {previews}
        onSelect={select}
        onMove={moveNode}
        onConnect={connectEdge}
        onDeleteEdge={deleteEdge}
      />
    </div>
    <!-- Two floating cards over the canvas rather than one docked column.
         The graph's knobs are always up, because a graph always has some;
         the node's params only exist when a node is selected, and a panel
         that is empty most of the time is a panel asking for the width
         back. Left and right so they cannot collide, and inset from the
         edges so each reads as sitting ON the canvas rather than as
         another edge of the window. -->
    <div class="panel graph" class:open={panelsOpen}>
      <Overview
        {controller}
        rev={paramsRev}
        spec={panelSpec}
        title={graphTitle}
        {baseline}
        seed={model.seed}
        {loadedSeed}
        onEdit={() => paramsRev++}
        onReset={resetKnobs}
        {shareUrl} />
    </div>
    {#if selectedNode}
      <div class="panel node" class:open={panelsOpen}>
        <Inspector
          {controller}
          node={selectedNode}
          {paramsRev}
          onPlain={onPlainParam}
          onFieldApply={onFieldParam}
          onDelete={deleteNode} />
      </div>
    {/if}
    <!-- Narrow-screen drawer toggle for the param column, floating over
         the canvas edge. display: none outside the media query. The label
         "params" is chosen to dodge the capture tooling's
         click-button-by-substring needles. -->
    <button
      class="drawer-tab right"
      aria-label="toggle the param drawer"
      aria-expanded={panelsOpen}
      onclick={() => (panelsOpen = !panelsOpen)}
    >
      params
    </button>
  </div>
  <Palette
    {groups}
    at={menuAt}
    onAdd={addNode}
    onDismiss={() => (menuAt = null)} />
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
  /**
   * A full-bleed overlay over the live render rather than a panel beside
   * it. Its parts carry their own backing; the space between them is the
   * scene, dimmed by the scrim to whatever the current view asks for — or,
   * in the combined view, to whatever the reader asked for instead.
   */
  .editor {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    color: var(--ed-ink);
    font: 13px/1.45 var(--ed-sans);
    pointer-events: none;
  }
  /* Only the parts take the pointer; the overlay itself is a frame, and
     so is the row inside it — otherwise the row would swallow whatever
     the canvas declined, which is exactly what an earlier attempt at
     click-through got wrong. */
  .editor > :global(*) {
    pointer-events: auto;
  }
  .body {
    pointer-events: none;
  }
  .body > :global(*) {
    pointer-events: auto;
  }
  /* Shift held, scene visible: the canvas and its wrapper both stand
     aside so the wheel and the buttons reach the renderer beneath. The
     columns beside it never do, so a knob is still turnable mid-flight. */
  .canvas-wrap.through {
    pointer-events: none;
  }
  /**
   * WHO OWNS THE WHEEL AND THE RIGHT BUTTON. Both gestures mean "move the
   * view" to the graph and to the scene's orbit controls, and the overlay
   * covers the render completely — so whenever the graph is up it takes
   * them, and the scene is flown from the view where the graph is not.
   *
   * An earlier version tried to split them by state, making the SVG
   * click-through so the render could be orbited underneath. It did not
   * work: the canvas wrapper and `.body` still took the events, so they
   * reached neither the graph nor the scene. Splitting input by state
   * would mean making a hole through three elements, for a pairing one
   * press of the space bar already gives.
   */

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 9;
    /* Pure black, and it has to be: at opacity 1 this IS the background of
       the graph-only view, so any tint here would be the one colour left
       on the page — and it would be the largest surface on it. */
    background: #000000;
    pointer-events: none;
    transition: opacity 0.18s ease;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    /* Anchors the narrow-screen drawers and their toggle tabs below the
       toolbar. Visually inert at desktop widths. */
    position: relative;
  }
  /* `display: flex` above would otherwise beat the [hidden] default. */
  .body[hidden] {
    display: none;
  }
  /* No scrollbars: the canvas pans and zooms itself. */
  .canvas-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  /**
   * A floating card over the canvas. AUTO HEIGHT — it is as tall as what
   * is in it, capped at the viewport so a forty-knob graph scrolls inside
   * its own card rather than running off the bottom of the window.
   *
   * Absolute against `.body`, which is the region below the toolbar, so a
   * panel can never ride up over the bar. Inset from the edges rather than
   * flush: the gap is what makes it read as sitting ON the canvas instead
   * of being another edge of the window.
   */
  .panel {
    position: absolute;
    top: 12px;
    z-index: 12;
    width: 300px;
    max-height: calc(100% - 24px);
    box-sizing: border-box;
    overflow-y: auto;
    padding: 10px 12px 12px;
    background: var(--ed-panel);
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius-lg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
  }
  .panel.graph {
    left: 12px;
  }
  .panel.node {
    right: 12px;
  }
  .cook-errors {
    max-height: 64px;
    overflow-y: auto;
    padding: 4px 12px;
    border-bottom: 1px solid var(--ed-edge-err);
    background: var(--ed-alert-bg);
    color: var(--ed-danger);
    font: var(--ed-t-meta) / 1.5 var(--ed-mono);
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
    border-radius: var(--ed-radius-lg);
    font-size: var(--ed-t-body);
    line-height: 1.4;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
  }
  /* The two toasts differ by BORDER BRIGHTNESS and by face, not by hue:
     an error is bordered white and set in monospace at a smaller size, an
     acknowledgement is bordered mid-grey and set in the body face. That
     second cue matters more than usual here — with the greens and reds
     gone, a border alone would be a thin thing to tell them apart by. */
  .toast.info {
    background: var(--ed-alert-bg);
    border: 1px solid var(--ed-edge-ok);
    color: var(--ed-ink);
  }
  .toast.error {
    background: var(--ed-alert-bg);
    border: 1px solid var(--ed-edge-err);
    color: #ffffff;
    font-family: var(--ed-mono);
    font-size: var(--ed-t-meta);
  }
  /* Desktop: the drawer tabs do not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .drawer-tab {
    display: none;
  }
  @media (max-width: 700px), (max-height: 500px) {
    /* keep in sync with NARROW_MEDIA_QUERY in shared/mobile.ts */
    /**
     * THE OVERLAY STAYS A FRAME, not a docked card.
     *
     * This block used to set `height: 50dvh` and `bottom: 0` against the
     * `inset: 0` above, which cannot dock anything: with `top` set and a
     * height given, `bottom` is what gets dropped. So the "sheet" was a
     * strip along the TOP all along — and the toolbar's six wrapped rows
     * took 181px of it, which is what left the node canvas as a 241px
     * band with a whole empty screen underneath.
     *
     * Left as a frame, the toolbar is a bar and the canvas gets every
     * pixel below it, with the scene showing through both exactly as it
     * does at desktop widths. The collapse is the TOOLBAR's business now
     * (see Toolbar.svelte), which is where it always belonged: it is the
     * bar deciding what it can carry, not the overlay changing shape.
     */
    .drawer-tab {
      display: block;
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      /* Above the drawers (z-index 15) so a second tap can close them. */
      z-index: 16;
      padding: 14px 8px;
      background: rgba(26, 26, 26, 0.94);
      color: var(--ed-action);
      border: 1px solid var(--ed-edge);
      font: var(--ed-t-meta) var(--ed-sans);
      cursor: pointer;
    }
    .drawer-tab.right {
      right: 0;
      border-right: none;
      border-radius: var(--ed-radius) 0 0 var(--ed-radius);
    }
    /**
     * A phone has no room for two cards floating beside a canvas, so the
     * panels stop floating and become one full-width drawer that the
     * "params" tab slides in. They stack — graph first, then the node if
     * one is selected — and share the height rather than overlapping.
     */
    .panel {
      left: 8px;
      /* Clear of the tab, which is the drawer's close control and sits
         above it in the stack: at `right: 8px` the panel slid under the
         tab and lost its last chip to it. */
      right: 40px;
      width: auto;
      z-index: 15;
      max-height: calc(50% - 16px);
      transform: translateX(105%);
      /* Hidden when closed so the off-screen panel can't take focus or
         intercept hit-testing. */
      visibility: hidden;
      /* The drawer scrolls; the canvas behind it must not scroll with it. */
      overscroll-behavior: contain;
      transition:
        transform 0.2s ease,
        visibility 0.2s;
    }
    .panel.node {
      top: auto;
      bottom: calc(8px + env(safe-area-inset-bottom));
    }
    .panel.open {
      transform: none;
      visibility: visible;
    }
  }
</style>
