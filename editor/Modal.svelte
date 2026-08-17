<script lang="ts">
  /**
   * Export/import modal: export shows the serializeGraph JSON with a copy
   * button; import takes pasted JSON and surfaces deserializeGraph errors
   * verbatim below the textarea.
   */
  let {
    title,
    initial,
    mode,
    onApply,
    onClose,
  }: {
    title: string;
    initial: string;
    mode: "export" | "import";
    onApply?: (text: string) => string | null;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally -- the modal deliberately captures the text it opened with
  let text = $state(initial);
  let error = $state<string | null>(null);
  let copied = $state(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  function apply(): void {
    if (!onApply) return;
    error = onApply(text);
    if (error === null) onClose();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="modal" role="dialog" aria-label={title}>
    <div class="head">
      <span>{title}</span>
      <div class="buttons">
        {#if mode === "export"}
          <button onclick={copy}>{copied ? "copied!" : "copy"}</button>
        {:else}
          <button class="primary" onclick={apply}>import</button>
        {/if}
        <button onclick={onClose}>close</button>
      </div>
    </div>
    <textarea
      rows="18"
      spellcheck="false"
      readonly={mode === "export"}
      placeholder={mode === "import" ? "paste serialized graph JSON here…" : ""}
      bind:value={text}
    ></textarea>
    {#if error !== null}
      <div class="error">{error}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.72);
  }
  .modal {
    width: min(680px, calc(100vw - 48px));
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    background: #000000;
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius-lg);
    color: var(--ed-ink);
    font: 13px var(--ed-sans);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  button {
    padding: var(--ed-btn-pad);
    background: var(--ed-raised);
    color: var(--ed-action);
    border: 1px solid var(--ed-edge);
    border-radius: var(--ed-radius);
    font: var(--ed-t-body) var(--ed-sans);
    cursor: pointer;
  }
  /* The button that commits the paste, solid white against the outlined
     ones — same rule as FieldParam's apply. */
  button.primary {
    background: #ffffff;
    color: #000000;
    border-color: #ffffff;
  }
  button:hover {
    filter: brightness(1.25);
  }
  textarea {
    flex: 1;
    min-height: 220px;
    resize: vertical;
    padding: 8px;
    background: #0a0a0a;
    color: var(--ed-ink);
    border: 1px solid var(--ed-rule);
    border-radius: var(--ed-radius);
    font: var(--ed-t-meta) / 1.5 var(--ed-mono);
    white-space: pre;
  }
  .error {
    margin-top: 8px;
    max-height: 120px;
    overflow-y: auto;
    padding: 6px 8px;
    background: var(--ed-alert-bg);
    border: 1px solid var(--ed-edge-err);
    border-radius: var(--ed-radius);
    color: #ffffff;
    font: 11px/1.5 ui-monospace, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
