<script lang="ts">
  /**
   * A number field with a horizontal stepper: minus and plus, square,
   * the full height of the field, at its right edge, revealed on hover.
   *
   * WHY A COMPONENT AND NOT CSS. The platform's spinner is two stacked
   * half-height arrows a few pixels wide — a target you aim at rather
   * than hit, and the wrong shape for a panel drawn in squares. It also
   * cannot be reshaped: `::-webkit-inner-spin-button` is one box for
   * both arrows and Firefox exposes nothing at all, so a horizontal pair
   * is not a restyle of the native control. It is a replacement, and a
   * replacement needs markup.
   *
   * The field's own look lives here too, not just the buttons. Every
   * call site used to repeat the same recipe (`--ed-well`, `--ed-edge`,
   * mono at `--ed-t-body`, 3px 6px) and Svelte scopes styles to the
   * component that renders the markup — so once the input moved in here
   * those rules could no longer reach it. Carrying the whole field is
   * what makes this one number box rather than a decoration applied to
   * five different ones.
   *
   * SIZING IS THE PARENT'S. The root fills the slot it is given, so a
   * flex row spreads it, a grid cell fits it, and a caller that wants a
   * fixed width wraps it in one. Nothing here reaches out.
   */
  let {
    value,
    min,
    max,
    step,
    onCommit,
    ariaLabel,
  }: {
    value: number;
    min?: number;
    max?: number;
    /** `"any"` means unconstrained, and the buttons then move by 1. */
    step?: number | "any";
    /**
     * The edit is settled. The field's own `valueAsNumber`, so an empty
     * or unparseable field arrives as NaN rather than as 0 — a cleared
     * box is not a zero, and only the caller knows what to do with the
     * difference.
     */
    onCommit: (value: number) => void;
    ariaLabel?: string;
  } = $props();

  let input: HTMLInputElement;

  /** Press-and-hold: one step, a pause, then a run. */
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let runTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * `stepUp`/`stepDown` are the browser's own arithmetic — they honour
   * min, max and the step base, and they round a hand-typed value onto
   * the step grid the way the keyboard arrows do. They throw when the
   * step is `"any"` or the field holds something unparseable, which is
   * why the fallback below exists rather than a pre-check: the set of
   * inputs they reject is theirs to define, not ours to predict.
   */
  function nudge(direction: 1 | -1): void {
    try {
      if (direction > 0) input.stepUp();
      else input.stepDown();
    } catch {
      const by = typeof step === "number" && step > 0 ? step : 1;
      const next = (Number(input.value) || 0) + by * direction;
      const lo = min ?? -Infinity;
      const hi = max ?? Infinity;
      input.value = String(Math.min(hi, Math.max(lo, next)));
    }
    onCommit(input.valueAsNumber);
  }

  function startHold(e: PointerEvent, direction: 1 | -1): void {
    /* Keep the caret where it was: a step is not a focus change, and
       taking focus off the field mid-edit would commit it twice. */
    e.preventDefault();
    nudge(direction);
    holdTimer = setTimeout(() => {
      runTimer = setInterval(() => nudge(direction), 60);
    }, 400);
  }

  function endHold(): void {
    clearTimeout(holdTimer);
    clearInterval(runTimer);
    holdTimer = undefined;
    runTimer = undefined;
  }
</script>

<span class="numbox">
  <input
    bind:this={input}
    type="number"
    {min}
    {max}
    step={step ?? "any"}
    {value}
    aria-label={ariaLabel}
    onchange={(e) => onCommit(e.currentTarget.valueAsNumber)} />
  <!-- `tabindex="-1"`: the field's own arrow keys already do this, so
       putting two more stops in the tab order for every number on the
       panel would cost more than it gives. -->
  <span class="steps">
    <button
      type="button"
      tabindex="-1"
      aria-label="decrease"
      onpointerdown={(e) => startHold(e, -1)}
      onpointerup={endHold}
      onpointerleave={endHold}
      onpointercancel={endHold}>−</button>
    <button
      type="button"
      tabindex="-1"
      aria-label="increase"
      onpointerdown={(e) => startHold(e, 1)}
      onpointerup={endHold}
      onpointerleave={endHold}
      onpointercancel={endHold}>+</button>
  </span>
</span>

<style>
  .numbox {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
    width: 100%;
  }
  input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 3px 6px;
    background: var(--ed-well, #0c0c0c);
    color: var(--ed-ink, #e8e8e8);
    border: 1px solid var(--ed-edge, #3f3f3f);
    border-radius: var(--ed-radius, 0);
    font: var(--ed-t-body, 12px) var(--ed-mono, ui-monospace, monospace);
  }
  /* The native spinner goes, on both engines. Without this the two sit
     side by side and the field is narrower than it looks. */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  /* Inset by the border rather than laid over it, so the buttons stop
     where the field's own edge starts and the frame stays unbroken. */
  .steps {
    position: absolute;
    top: 1px;
    right: 1px;
    bottom: 1px;
    display: flex;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.08s;
  }
  /* `focus-within` as well as hover: reached by keyboard the buttons
     have to be visible, or the field grows a control that only exists
     for a pointer. */
  .numbox:hover .steps,
  .numbox:focus-within .steps {
    opacity: 1;
    pointer-events: auto;
  }
  /* Square by construction: full height of the field's interior, and a
     width that follows it. The pair overlays the right end of the value
     rather than reserving room for itself — the digits start at the
     left, and reserving would cost every narrow field (a vec3 row is
     three of them) the space permanently to spend it only on hover.

     AT REST IT IS ONLY THE GLYPH. No plate, no dividing line: the box
     these sit in already has a border, and drawing two more inside it
     puts three frames within four pixels of each other. The fill arrives
     under the pointer, where it says which of the two you are about to
     hit — which is the only moment it carries information. */
  .steps button {
    height: 100%;
    aspect-ratio: 1;
    padding: 0;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--ed-ink-mid, #b6b6b6);
    border: 0;
    border-radius: 0;
    font: var(--ed-t-body, 12px) var(--ed-sans, system-ui, sans-serif);
    line-height: 1;
    cursor: pointer;
    user-select: none;
  }
  /* The hovered plate has to clear the WELL it sits on (#0c0c0c), not
     the panel — a button tint chosen against the panel disappears
     inside a field. `--ed-raised-hi` is the button-under-the-pointer
     value, which is exactly what this is. */
  .steps button:hover {
    background: var(--ed-raised-hi, #2e2e2e);
    color: var(--ed-ink-hi, #ffffff);
  }
  .steps button:active {
    background: var(--ed-edge, #3f3f3f);
  }
</style>
