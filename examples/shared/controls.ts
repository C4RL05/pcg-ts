/**
 * Control specs as DATA: what a panel's knobs are, not how they are
 * written out. `Controls.svelte` renders these; a panel supplies the
 * list and a commit handler.
 *
 * The rig playground got here first — fifty knobs is fifty chances for a
 * label, a range and a param name to disagree, so it listed them instead
 * of writing them out. This is that idea generalised over the params
 * object, which is what lets the same renderer serve a panel whose knobs
 * are not known until a graph is loaded.
 *
 * WHY THE SPECS STAY PLAIN DATA. A control names its param by KEY and
 * carries no functions, so the same shape survives a trip through JSON.
 * That is the whole point: the sandbox reads its sections out of a
 * `<graph>.ui.json` sidecar, and anything callable here would have to be
 * invented again on the other side of that file. Routing a key to
 * whatever consumes it is the panel's job, not the spec's.
 *
 * Keys are checked against the params type, so a typo or a slider aimed
 * at a string param fails to compile rather than silently binding to
 * nothing.
 */

/** Everything a control can hold. Records back the grid controls. */
export type ControlValue =
  | number
  | string
  | boolean
  | readonly number[]
  | Record<string, number>
  | Record<string, boolean>;

/**
 * Keys of `P` whose value type is assignable to `T`.
 *
 * An open record (`Record<string, ControlValue>`, which is what a panel
 * built from a graph's own params at runtime has to be) would filter to
 * `never`, because its one key type maps to the whole union. Detect that
 * case — `string extends keyof P` holds only for a string index
 * signature — and let any key through. A panel typed against a real
 * params interface keeps the precise union, and with it the check that a
 * slider is not pointed at a string.
 */
type KeysOfType<P, T> = string extends keyof P
  ? string
  : { [K in keyof P]-?: P[K] extends T ? K : never }[keyof P] & string;

export type NumberKey<P> = KeysOfType<P, number>;
export type ChoiceKey<P> = KeysOfType<P, string>;
export type FlagKey<P> = KeysOfType<P, boolean>;
export type VectorKey<P> = KeysOfType<P, readonly number[]>;
export type NumberMapKey<P> = KeysOfType<P, Record<string, number>>;
export type FlagMapKey<P> = KeysOfType<P, Record<string, boolean>>;

export interface SliderControl<P> {
  kind: "slider";
  key: NumberKey<P>;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Suffix shown after the readout, e.g. "m". */
  unit?: string;
  /**
   * Commit on every input event rather than on release. Off by default:
   * a knob that recooks wants the drag coalesced into one commit. Turn
   * it on for knobs whose effect is cheap enough to follow the thumb.
   */
  live?: boolean;
}

/**
 * A single numeric box. The unbounded sibling of {@link SliderControl},
 * and the one a schema-derived panel reaches for most: of the 126 params
 * the shipped primitives expose, seven declare both a min and a max, so
 * "drag between two ends" is the exception. Supplying a range in a panel
 * spec is what promotes one to a slider.
 */
export interface NumberControl<P> {
  kind: "number";
  key: NumberKey<P>;
  label: string;
  min?: number;
  max?: number;
  /** Absent means "any" — a float box with no quantisation. */
  step?: number;
  unit?: string;
}

export interface TextControl<P> {
  kind: "text";
  key: ChoiceKey<P>;
  label: string;
}

/** 2–4 numeric components living in one array-valued key (a vec3 param). */
export interface VectorControl<P> {
  kind: "vector";
  key: VectorKey<P>;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SelectControl<P> {
  kind: "select";
  key: ChoiceKey<P>;
  label: string;
  options: readonly { value: string; label: string }[];
}

/**
 * A labelled row of independent flags, each its own top-level key —
 * "draw: [x] wireframe [x] grid". Use {@link FlagGridControl} when the
 * flags are members of one record instead.
 */
export interface FlagsControl<P> {
  kind: "flags";
  label: string;
  items: readonly { key: FlagKey<P>; label: string }[];
}

/** A grid of flags that all live in ONE record-valued key. */
export interface FlagGridControl<P> {
  kind: "flagGrid";
  key: FlagMapKey<P>;
  label: string;
  items: readonly { item: string; label: string }[];
  /** Columns in the grid (default 2). */
  columns?: number;
}

/** A grid of numbers that all live in ONE record-valued key. */
export interface NumberGridControl<P> {
  kind: "numberGrid";
  key: NumberMapKey<P>;
  /** Caption above the grid; the grid has no label column of its own. */
  note?: string;
  items: readonly { item: string; label: string }[];
  min: number;
  max: number;
  step: number;
  /** Columns in the grid (default 4). */
  columns?: number;
}

export type Control<P> =
  | SliderControl<P>
  | NumberControl<P>
  | TextControl<P>
  | VectorControl<P>
  | SelectControl<P>
  | FlagsControl<P>
  | FlagGridControl<P>
  | NumberGridControl<P>;

/**
 * One group of controls. The title is the section heading and, when the
 * renderer is showing tabs, the tab label — so titles must be unique
 * within a panel.
 */
export interface ControlSection<P> {
  title: string;
  controls: readonly Control<P>[];
}

/**
 * What the renderer hands back on every edit. Discriminated by `kind`
 * rather than by the control's own type so a panel can switch on it
 * exhaustively, and carrying the control itself so a handler that needs
 * the range or the unit has it without a second lookup.
 */
export type ControlCommit<P> =
  | { kind: "slider"; control: SliderControl<P>; key: NumberKey<P>; value: number }
  | { kind: "number"; control: NumberControl<P>; key: NumberKey<P>; value: number }
  | { kind: "text"; control: TextControl<P>; key: ChoiceKey<P>; value: string }
  | {
      kind: "vector";
      control: VectorControl<P>;
      key: VectorKey<P>;
      /** The whole vector, not the edited component. */
      value: readonly number[];
    }
  | { kind: "select"; control: SelectControl<P>; key: ChoiceKey<P>; value: string }
  | { kind: "flag"; control: FlagsControl<P>; key: FlagKey<P>; value: boolean }
  | {
      kind: "flagGrid";
      control: FlagGridControl<P>;
      key: FlagMapKey<P>;
      item: string;
      value: boolean;
    }
  | {
      kind: "numberGrid";
      control: NumberGridControl<P>;
      key: NumberMapKey<P>;
      item: string;
      value: number;
    };

/**
 * Write a commit into the values record. Every panel's input handler is
 * this line, so it is here rather than copied per demo — a panel's own
 * handler is then only the part that is actually its own: what to tell
 * the host, and when.
 */
export function applyCommit<P extends Record<string, unknown>>(
  values: P,
  commit: ControlCommit<P>,
): void {
  const record = values as Record<string, unknown>;
  if (commit.kind === "flagGrid" || commit.kind === "numberGrid") {
    const map = record[commit.key];
    if (isRecord(map)) map[commit.item] = commit.value;
    return;
  }
  record[commit.key] = commit.value;
}

/** Shallow copy, one level into the record- and array-valued keys. */
export function snapshotValues<P extends Record<string, unknown>>(values: P): P {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = Array.isArray(value) ? [...value] : isRecord(value) ? { ...value } : value;
  }
  return out as P;
}

/**
 * Resync the panel's values from a host snapshot, copying across ONLY
 * the keys the host changed since its previous snapshot, and return that
 * snapshot to diff the next one against.
 *
 * Panels cannot simply mirror what the host publishes. Hosts republish
 * on every frame (an fps readout moves), so mirroring would retype a
 * half-entered number under the user and snap a slider back to whatever
 * was last cooked. A value the host merely echoed back is already what
 * the user set, so leaving it alone is both correct and quiet — while a
 * value the host actually moved (a preset load, a randomized seed) still
 * lands.
 */
export function adoptChanged<P extends Record<string, unknown>>(
  values: P,
  next: P,
  previous: P,
): P {
  const local = values as Record<string, unknown>;
  const before = previous as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (Array.isArray(value)) {
      // Compared elementwise: a host that rebuilds its vectors every
      // publish hands over a fresh array each time, and identity would
      // read every one of them as a change and stomp what the user typed.
      const seen = before[key];
      const same =
        Array.isArray(seen) &&
        seen.length === value.length &&
        value.every((v, i) => Object.is(v, seen[i]));
      if (!same) local[key] = [...value];
    } else if (isRecord(value)) {
      // A grid's record is compared per item, so a host change to one
      // member does not drag its siblings back from under the user.
      const current = local[key];
      const seen = before[key];
      if (!isRecord(current) || !isRecord(seen)) {
        local[key] = { ...value };
        continue;
      }
      for (const [item, member] of Object.entries(value)) {
        if (!Object.is(member, seen[item])) current[item] = member;
      }
    } else if (!Object.is(value, before[key])) {
      local[key] = value;
    }
  }
  return snapshotValues(next);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Decimals to show, read off the step so a readout never claims more
 * precision than the control can produce.
 */
export function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** A slider's readout: the value at the step's precision, plus its unit. */
export function formatNumber(value: number, step: number, unit?: string): string {
  return `${value.toFixed(decimalsOf(step))}${unit ?? ""}`;
}

/**
 * Clamp a typed or dragged number into a control's range. Integer steps
 * round, because a grid of "relative weights" that accepts 2.7 is
 * offering a precision the thing behind it does not have.
 */
export function clampToRange(raw: number, min: number, max: number, step: number): number {
  const rounded = step >= 1 ? Math.round(raw) : raw;
  return Math.min(max, Math.max(min, rounded));
}
