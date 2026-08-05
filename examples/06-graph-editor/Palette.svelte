<script lang="ts">
  /**
   * Node palette: registry-driven, grouped by pin signature, filtered by
   * a substring search. Clicking an entry adds a node to the canvas.
   */
  import type { PaletteGroup } from "./model.js";

  let { groups, onAdd }: { groups: PaletteGroup[]; onAdd: (type: string) => void } = $props();

  let search = $state("");

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return groups;
    return groups
      .map((g) => ({
        name: g.name,
        entries: g.entries.filter(
          (e) => e.type.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.entries.length > 0);
  });
</script>

<div class="palette">
  <input class="search" type="search" placeholder="search nodes…" bind:value={search} />
  {#each filtered as group (group.name)}
    <div class="group">{group.name}</div>
    {#each group.entries as entry (entry.type)}
      <button class="entry" title={entry.description} onclick={() => onAdd(entry.type)}>
        {entry.type}
      </button>
    {/each}
  {/each}
  {#if filtered.length === 0}
    <div class="empty">no node type matches "{search}"</div>
  {/if}
</div>

<style>
  .palette {
    flex: 0 0 168px;
    overflow-y: auto;
    padding: 8px;
    border-right: 1px solid #223047;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 6px;
    padding: 4px 8px;
    background: #161d29;
    color: #dbe4f0;
    border: 1px solid #33405a;
    border-radius: 5px;
    font: 12px system-ui, sans-serif;
  }
  .group {
    margin: 8px 0 3px;
    color: #6f7c8f;
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
    border: 1px solid #223047;
    border-radius: 5px;
    font: 12px ui-monospace, monospace;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry:hover {
    border-color: #4c8dff;
    background: #16202f;
  }
  .empty {
    margin-top: 10px;
    color: #6f7c8f;
    font-size: 11px;
  }
</style>
