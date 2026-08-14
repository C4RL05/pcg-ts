<script lang="ts">
  /**
   * The node menu: registry-driven, grouped by the registry's `category`
   * metadata (uncategorized types fall back to pin-signature "other"
   * groups), filtered by a substring search.
   *
   * It used to be a column that was always there, which cost width on
   * every graph for a thing you touch when adding a node and never
   * otherwise. Now it is summoned at the pointer with Tab and dismissed
   * by choosing, by Escape, or by clicking away — the interaction the
   * node-graph tools settled on, and the reason a search field beats a
   * list you scroll: you almost always know the name.
   *
   * The highlighted entry is what Enter takes, so the whole gesture is
   * Tab, a few letters, Enter — without the hand leaving the keyboard.
   */
  import { tick } from "svelte";
  import type { PaletteGroup } from "./model.js";

  let {
    groups,
    at,
    onAdd,
    onDismiss,
  }: {
    groups: PaletteGroup[];
    /** Where it was summoned, in client px. Null when it is closed. */
    at: { x: number; y: number } | null;
    onAdd: (type: string) => void;
    onDismiss: () => void;
  } = $props();

  let search = $state("");
  let highlighted = $state(0);
  let searchEl = $state<HTMLInputElement | undefined>();
  let menuEl = $state<HTMLElement | undefined>();

  /**
   * How well an entry answers the query. Searching descriptions as well
   * as names is what lets you find a node by what it does — but a name
   * match has to outrank one, or Enter takes whatever happened to
   * mention the word first. Typing "jitter" must reach `jitterPoints`,
   * not the node whose description says its output is jittered.
   */
  function rank(entry: { type: string; description: string }, q: string): number {
    const type = entry.type.toLowerCase();
    if (type.startsWith(q)) return 0;
    if (type.includes(q)) return 1;
    if (entry.description.toLowerCase().includes(q)) return 2;
    return -1;
  }

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return groups;
    /**
     * Ranked ACROSS groups, then re-grouped, so the best match is the
     * first entry in the list the arrows walk — the grouping is there to
     * read, not to reorder the answer. Ties keep registry order, which is
     * stable between runs.
     */
    const hits = groups
      .flatMap((g) => g.entries.map((e) => ({ group: g.name, entry: e, score: rank(e, q) })))
      .filter((h) => h.score >= 0)
      .sort((a, b) => a.score - b.score);
    const byGroup = new Map<string, typeof groups[number]["entries"]>();
    for (const h of hits) {
      const list = byGroup.get(h.group);
      if (list) list.push(h.entry);
      else byGroup.set(h.group, [h.entry]);
    }
    return [...byGroup.entries()].map(([name, entries]) => ({ name, entries }));
  });

  /** The filtered entries as one list, which is what the arrows walk. */
  const flat = $derived(filtered.flatMap((g) => g.entries));

  /**
   * Opening resets the menu to its first entry and takes focus, so
   * typing lands in the search field rather than wherever focus happened
   * to be — the point of summoning it with a key.
   */
  $effect(() => {
    if (at === null) return;
    search = "";
    highlighted = 0;
    void tick().then(() => searchEl?.focus());
  });

  // A filter that shortens the list must not leave the cursor past its end.
  $effect(() => {
    if (highlighted >= flat.length) highlighted = Math.max(0, flat.length - 1);
  });

  function choose(type: string): void {
    onAdd(type);
    onDismiss();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      highlighted = (highlighted + step + flat.length) % flat.length;
      // Keep the highlight in view when the list is longer than the menu.
      void tick().then(() => {
        menuEl?.querySelector(".entry.on")?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = flat[highlighted];
      if (entry) choose(entry.type);
    }
  }

  /**
   * Dismiss on any pointer press outside. Captured on the window so it
   * fires before the canvas can read the same press as a click on the
   * background, which would otherwise deselect at the same time.
   */
  function onWindowPointerDown(e: PointerEvent): void {
    if (at === null || menuEl === undefined) return;
    if (!menuEl.contains(e.target as Node)) onDismiss();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#if at !== null}
  <!-- Positioned at the pointer, then pulled back inside the viewport so
       a summon near an edge does not open off-screen. -->
  <div
    class="menu"
    bind:this={menuEl}
    role="dialog"
    aria-label="add a node"
    style="left: {Math.min(at.x, Math.max(8, window.innerWidth - 260))}px; top: {Math.min(
      at.y,
      Math.max(8, window.innerHeight - 340),
    )}px"
    onkeydown={onKeydown}
  >
    <input
      class="search"
      type="search"
      placeholder="search nodes…"
      bind:this={searchEl}
      bind:value={search} />
    <div class="list">
      {#each filtered as group (group.name)}
        <div class="group">{group.name}</div>
        {#each group.entries as entry (entry.type)}
          <button
            class="entry"
            class:on={flat[highlighted]?.type === entry.type}
            title={entry.description}
            onclick={() => choose(entry.type)}>{entry.type}</button>
        {/each}
      {/each}
      {#if filtered.length === 0}
        <div class="empty">no node type matches "{search}"</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 20;
    width: 248px;
    max-height: 332px;
    display: flex;
    flex-direction: column;
    padding: 8px;
    box-sizing: border-box;
    background: var(--sb-solid);
    border: 1px solid var(--sb-edge);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
  }
  .list {
    overflow-y: auto;
    min-height: 0;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 6px;
    padding: 4px 8px;
    background: var(--sb-well);
    color: var(--sb-ink);
    border: 1px solid var(--sb-edge);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-sans);
  }
  .group {
    margin: 8px 0 3px;
    color: var(--sb-ink-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .entry {
    display: block;
    width: 100%;
    margin: 2px 0;
    padding: 4px 8px;
    text-align: left;
    background: #131a26;
    color: #cfe0f5;
    border: 1px solid var(--sb-rule);
    border-radius: var(--sb-radius);
    font: var(--sb-t-body) var(--sb-mono);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry:hover,
  .entry.on {
    border-color: #4c8dff;
    background: #16202f;
  }
  .empty {
    margin-top: 10px;
    color: var(--sb-ink-faint);
    font-size: var(--sb-t-meta);
  }
</style>
