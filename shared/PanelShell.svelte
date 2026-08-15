<script lang="ts">
  /**
   * The chrome every Svelte example panel wears: the fixed side card, its
   * scroll behaviour, the title bar, and the `NARROW_MEDIA_QUERY`
   * bottom-sheet treatment. Extracted at the third copy (05, 08, 12),
   * which is what the comments in the first two asked for.
   *
   * Only the shell lives here. Rows, sliders, selects and readouts are
   * `Controls.svelte`'s, which renders them from a spec and carries their
   * CSS with them — Svelte scopes styles to the component that renders
   * the markup, so the styles could only follow the markup, and they did.
   * A panel that still writes a row by hand (the rig's seed box) styles
   * that row itself, for the same reason.
   *
   * The DOM contract the capture tooling depends on is unchanged: one
   * `.panel` element wrapping the whole card, with the demo's content as
   * its direct children (`scripts/capture-demos.mjs` scrapes
   * `.panel .stat`).
   */
  import type { Snippet } from "svelte";
  import { narrowScreen } from "./mobile.js";

  let {
    title,
    width,
    badge,
    children,
  }: {
    /** Title-bar text. Doubles as the bottom sheet's collapse toggle. */
    title: string;
    /** Desktop card width in px. Ignored below the narrow breakpoint,
        where the card spans the viewport — hence a custom property the
        stylesheet reads, not an inline `width` that would outrank it. */
    width: number;
    /** Optional inline status beside the title, e.g. a cooking flag. */
    badge?: Snippet;
    children: Snippet;
  } = $props();

  /**
   * On narrow screens the fixed side panel becomes a full-width bottom
   * sheet, collapsed to its 48px title bar by default so the 3D content
   * keeps the screen. Entering the narrow range collapses, leaving it
   * clears the collapse, so rotating a phone never strands the panel in a
   * stale state.
   */
  let collapsed = $state(narrowScreen().matches);

  $effect(() => {
    const mql = narrowScreen();
    const onChange = (e: MediaQueryListEvent): void => {
      collapsed = e.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  function toggleCollapsed(): void {
    collapsed = !collapsed;
  }
  function onTitleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      collapsed = !collapsed;
    }
  }
</script>

<div class="panel" class:collapsed style="--panel-width: {width}px">
  <!-- The title doubles as the bottom sheet's collapse toggle on narrow
       screens; it stays a plain heading visually on desktop. Deliberately
       not a <button>: the capture tooling clicks buttons by substring, and
       its readiness probe scrapes `.panel .stat` — which is why collapse
       clips via CSS instead of {#if}-ing any content away. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <h1
    role="button"
    tabindex="0"
    aria-expanded={!collapsed}
    onclick={toggleCollapsed}
    onkeydown={onTitleKeydown}
  >
    {title}{@render badge?.()}<span class="chevron">▾</span>
  </h1>
  {@render children()}
</div>

<style>
  .panel {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10;
    width: var(--panel-width);
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 14px 16px;
    background: rgba(13, 17, 23, 0.9);
    border: 1px solid #2a3548;
    border-radius: 10px;
    color: #dbe4f0;
    font: 13px/1.45 system-ui, sans-serif;
    backdrop-filter: blur(6px);
  }
  h1 {
    margin: 0 0 2px;
    font-size: 15px;
    font-weight: 600;
    color: #f0f4fa;
  }
  /* Desktop: the chevron does not exist. This rule must precede the media
     block so the narrow-screen rule wins the cascade at equal specificity. */
  .chevron {
    display: none;
  }
  @media (max-width: 700px) {
    /* keep in sync with NARROW_MEDIA_QUERY in shared/mobile.ts */
    .panel {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      z-index: 12;
      max-height: 50vh;
      max-height: 50dvh; /* dvh where supported; vh fallback above */
      border-radius: 12px 12px 0 0;
      border-width: 1px 0 0 0;
      padding: 0 16px calc(10px + env(safe-area-inset-bottom));
      transition: max-height 0.25s ease;
      overscroll-behavior: contain;
    }
    .panel h1 {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0 -16px;
      padding: 13px 16px;
      line-height: 22px; /* 13 + 22 + 13 = the 48px collapsed bar */
      background: rgba(13, 17, 23, 0.96);
      cursor: pointer;
    }
    .chevron {
      display: inline-block;
      float: right;
      color: #8b98ab;
      transition: transform 0.2s;
    }
    /* Collapse clips via max-height + overflow, never {#if}: the capture
       tooling's readiness probe scrapes `.panel .stat` textContent and
       needs the stats rendered whether the sheet is open or shut. */
    .panel.collapsed {
      max-height: calc(48px + env(safe-area-inset-bottom));
      overflow: hidden;
    }
    .panel.collapsed .chevron {
      transform: rotate(180deg);
    }
  }
</style>
