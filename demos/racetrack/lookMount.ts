/**
 * The plain-DOM ↔ Svelte seam for the look playground.
 *
 * THE SAME SEAM `shared/graph/panel.ts` IS, and for the same reason: the
 * demo panels are plain DOM (`shared/overlay.ts` says why), and anything
 * richer than a labelled row is Svelte. Forty controls, a tab bar, a
 * colour picker and two buttons is emphatically the second kind, and none
 * of it belongs in the shared overlay for one page's sake.
 *
 * IT MOUNTS INTO THE BODY RATHER THAN INTO A SLOT, which it did not at
 * first. `Overlay.addSlot` appends, so the playground opened underneath
 * the whole readout column — below the fold on any normal window, on a
 * page whose point was the tweaking. It wears `PanelShell` instead and
 * takes the top-right corner, where there is room for it to be a surface
 * you work on rather than a tail on a list you read.
 *
 * NO UPDATE DOOR, UNLIKE THE GRAPH PANEL. That one needs one because the
 * host re-serializes on every cook; this one is handed the LIVE look and
 * mutates it in place, so there is nothing for the host to push back in.
 */
import { mount, unmount } from "svelte";
import LookPanel from "./LookPanel.svelte";
import type { Look } from "./look.js";

export interface LookPanelHandle {
  /**
   * Re-read the live look, after a change made behind the panel's back.
   *
   * The only such change is `window.pcgRacetrack.setLook`; see the
   * component's own note on why the panel cannot simply mirror the look.
   */
  sync(): void;
  destroy(): void;
}

/** Mount the look playground in its own corner of the page. */
export function attachLookPanel(
  look: Look,
  opts: { onRetint: () => void; onRestyle: () => void },
): LookPanelHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(LookPanel, {
    target: host,
    props: { look, onRetint: opts.onRetint, onRestyle: opts.onRestyle },
  });
  // The component's own export, the same door `shared/graph/panel.ts`
  // uses and for the same reason: a prop cannot carry this without a
  // `$state` object, which outside a component means a `.svelte.ts`
  // module that `tsc --noEmit` cannot read.
  const instance = app as unknown as { sync(): void };
  return {
    sync(): void {
      instance.sync();
    },
    destroy(): void {
      void unmount(app);
      host.remove();
    },
  };
}
