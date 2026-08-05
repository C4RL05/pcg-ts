<script lang="ts">
  /**
   * Root editor panel (Svelte 5 runes): owns the reactive structure model
   * (nodes, edges, positions, seed), selection, toasts, and the modal.
   * All graph semantics live in the controller; the panel only mirrors
   * structure into it and displays what comes back.
   */
  import { onMount } from "svelte";
  import Canvas from "./Canvas.svelte";
  import Inspector from "./Inspector.svelte";
  import Modal from "./Modal.svelte";
  import Palette from "./Palette.svelte";
  import Toolbar from "./Toolbar.svelte";
  import type { CookStatus, EditorController } from "./controller.js";
  import { topoLayout } from "./layout.js";
  import {
    STARTER_GRAPH_TEXT,
    allocateId,
    nodePinsForType,
    paletteGroups,
    type EdgeView,
    type StructureModel,
  } from "./model.js";

  let { controller }: { controller: EditorController } = $props();

  let model = $state<StructureModel>({ seed: 1, nodes: [], edges: [] });
  let selectedId = $state<string | null>(null);
  let status = $state<CookStatus | null>(null);
  let paramsRev = $state(0);
  let toast = $state<{ text: string; kind: "error" | "info" } | null>(null);
  let modal = $state<"export" | "import" | null>(null);
  let exportText = $state("");
  let hashBeforeImport = $state<string | null>(null);
  let awaitingImportCook = $state(false);

  const groups = paletteGroups();
  const selectedNode = $derived(model.nodes.find((n) => n.id === selectedId) ?? null);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string, kind: "error" | "info" = "info"): void {
    toast = { text, kind };
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), kind === "error" ? 7000 : 3500);
  }

  function syncStructure(): void {
    const err = controller.sync($state.snapshot(model) as StructureModel);
    if (err) showToast(err, "error");
  }

  onMount(() => {
    controller.setStatusListener((s) => {
      status = s;
      if (awaitingImportCook) {
        awaitingImportCook = false;
        const before = hashBeforeImport;
        if (before !== null) {
          showToast(
            s.hash === before
              ? `imported: output hash ${s.hash} — identical to the pre-import cook`
              : `imported: output hash ${s.hash} (was ${before})`,
          );
        } else {
          showToast(`imported: output hash ${s.hash}`);
        }
      }
    });
    const res = controller.importText(STARTER_GRAPH_TEXT);
    if ("error" in res) {
      showToast(res.error, "error");
    } else {
      model = res.structure;
      syncStructure();
    }
  });

  // -- actions -------------------------------------------------------------

  function addNode(type: string): void {
    const used = new Set(model.nodes.map((n) => n.id));
    const id = allocateId(type, used);
    const pins = nodePinsForType(type);
    const n = model.nodes.length;
    model.nodes.push({
      id,
      type,
      x: 48 + (n % 4) * 36,
      y: 40 + (n % 6) * 32,
      inputs: pins.inputs,
      outputs: pins.outputs,
    });
    selectedId = id;
    syncStructure();
  }

  function moveNode(id: string, x: number, y: number): void {
    const node = model.nodes.find((n) => n.id === id);
    if (node) {
      node.x = x;
      node.y = y;
    }
  }

  function connectEdge(edge: EdgeView): void {
    const err = controller.tryConnect(edge);
    if (err) {
      showToast(err, "error");
      return;
    }
    model.edges.push(edge);
    syncStructure();
  }

  function deleteEdge(index: number): void {
    model.edges.splice(index, 1);
    syncStructure();
  }

  function deleteNode(id: string): void {
    model.nodes = model.nodes.filter((n) => n.id !== id);
    model.edges = model.edges.filter((e) => e.from !== id && e.to !== id);
    if (selectedId === id) selectedId = null;
    syncStructure();
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

  function applyImport(text: string): string | null {
    hashBeforeImport = status?.hash ?? null;
    const res = controller.importText(text);
    if ("error" in res) return res.error;
    model = res.structure;
    selectedId = null;
    awaitingImportCook = true;
    syncStructure();
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

<div class="editor">
  <Toolbar
    seed={model.seed}
    {status}
    onSeed={setSeed}
    onExport={openExport}
    onImport={() => (modal = "import")}
    onLayout={relayout}
  />
  {#if status && status.errors.length > 0}
    <div class="cook-errors">
      {#each status.errors as err}
        <div>{err}</div>
      {/each}
    </div>
  {/if}
  <div class="body">
    <Palette {groups} onAdd={addNode} />
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
      onPlain={onPlainParam}
      onFieldApply={onFieldParam}
      onDelete={deleteNode}
    />
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
    onApply={applyImport}
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
</style>
