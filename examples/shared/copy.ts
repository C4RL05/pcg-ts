/**
 * Copy text, and say what happened.
 *
 * The clipboard can refuse — an insecure context, a permission the page
 * was never granted, a window that is not focused. Silently doing nothing
 * looks like a broken button, so every panel that offers a copy also has
 * to offer somewhere to select the text by hand, and label the button
 * with which of the two just happened. That handshake was written twice
 * before it was written here.
 */
export type CopyState = "idle" | "done" | "manual";

/** How long the button holds its outcome before returning to rest. */
const SETTLE_MS = 1600;

export interface Copier {
  /** Current state, for the label. */
  state(): CopyState;
  /**
   * Try the clipboard. `onRefuse` runs only when it says no, and is where
   * a panel reveals the text — the one part that differs per panel.
   */
  copy(text: string, onRefuse: () => void): Promise<CopyState>;
}

/**
 * `onChange` is how a Svelte panel gets its own reactive state updated:
 * this module deliberately holds no runes, so it stays importable from
 * plain TypeScript as well.
 */
export function createCopier(onChange: (state: CopyState) => void): Copier {
  let state: CopyState = "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (next: CopyState): void => {
    state = next;
    onChange(next);
  };
  return {
    state: () => state,
    async copy(text, onRefuse) {
      try {
        await navigator.clipboard.writeText(text);
        set("done");
      } catch {
        onRefuse();
        set("manual");
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => set("idle"), SETTLE_MS);
      return state;
    },
  };
}

/** The button's text for a state. `idle` is the panel's own wording. */
export function copyLabel(state: CopyState, idle: string, manual = "select it below ↓"): string {
  return state === "done" ? "copied!" : state === "manual" ? manual : idle;
}
