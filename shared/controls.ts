/**
 * Control specs as DATA: what a panel's knobs are, not how they are
 * written out. `Controls.svelte` renders these; a panel supplies the
 * list and a commit handler.
 *
 * The rig demo got here first — fifty knobs is fifty chances for a
 * label, a range and a param name to disagree, so it listed them instead
 * of writing them out. That demo has since become a corpus graph, but
 * the idea outlived it: generalised over the params object, it is what
 * lets one renderer serve a panel whose knobs are not known until a
 * graph is loaded.
 *
 * WHY THE SPECS STAY PLAIN DATA. A control names its param by KEY and
 * carries no functions, so the same shape survives a trip through JSON.
 * That is the whole point: the editor reads its sections out of a
 * `<graph>.ui.json` sidecar, and anything callable here would have to be
 * invented again on the other side of that file. Routing a key to
 * whatever consumes it is the panel's job, not the spec's.
 *
 * Keys are checked against the params type, so a typo or a slider aimed
 * at a string param fails to compile rather than silently binding to
 * nothing.
 */
import { panelGateHolds, type PanelCondition } from "pcg-ts/panels";

/**
 * What a gated row requires of another key: one value, or any of a list.
 *
 * The library's own {@link PanelCondition}, aliased rather than declared
 * again. A panel spec's `visibleWhen` arrives here verbatim, so the two must
 * agree on what a gate MEANS — a second declaration would be a second set of
 * matching rules waiting to drift, and the rows that appear would depend on
 * which of them ran.
 */
export type ControlCondition = PanelCondition;

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

/**
 * Presentation every control kind shares.
 *
 * A `label` says what the row IS in two words; a `description` says what
 * turning it does, and there is no room for that on the row itself, so the
 * renderer hangs it off the row as hover text. Optional everywhere: a
 * panel derived from param schemas alone has nothing to put here.
 */
export interface ControlNote {
  description?: string;
  /**
   * When this row is on screen at all: another key in the same params
   * record → the value it must currently hold. Every entry must hold, and
   * a list value means any of. Absent means always.
   *
   * STILL PLAIN DATA, which is the reason it is a record of values rather
   * than the predicate it would obviously be in a hand-written panel: a
   * panel spec carries these through a JSON file, and a function could not
   * survive the trip. {@link controlVisible} is what evaluates one.
   *
   * The keys are read out of the values record the renderer already has, so
   * a gate follows an edit within the same frame — the row that vanishes is
   * the one whose mode you just changed, not the one you change next.
   */
  visibleWhen?: Readonly<Record<string, ControlCondition>>;
}

export interface SliderControl<P> extends ControlNote {
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
export interface NumberControl<P> extends ControlNote {
  kind: "number";
  key: NumberKey<P>;
  label: string;
  min?: number;
  max?: number;
  /** Absent means "any" — a float box with no quantisation. */
  step?: number;
  unit?: string;
}

export interface TextControl<P> extends ControlNote {
  kind: "text";
  key: ChoiceKey<P>;
  label: string;
}

/** 2–4 numeric components living in one array-valued key (a vec3 param). */
export interface VectorControl<P> extends ControlNote {
  kind: "vector";
  key: VectorKey<P>;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SelectControl<P> extends ControlNote {
  kind: "select";
  key: ChoiceKey<P>;
  label: string;
  options: readonly { value: string; label: string }[];
}

/**
 * A colour swatch.
 *
 * THE VALUE IS A PACKED `0xRRGGBB` NUMBER, NOT A CSS STRING. That is what
 * three.js takes (`setHex`, and every `Color` constructor that is not a
 * parser) and what the demo palettes already hold, so a string here would
 * buy one readable spec line and charge for it at every mesh that reads the
 * value — a parse per instance, per cook, to get back to the number the
 * panel started from. It is also why the key is a {@link NumberKey}: a
 * colour IS a number to everything downstream, and only the renderer ever
 * needs to see `#rrggbb`. {@link hexToCss} and {@link cssToHex} are that
 * one hop, and nothing else should be writing it.
 *
 * No `min`/`max`, because a colour has no range to clamp: every one of the
 * 24 bits is in range by construction. Nothing runs this through
 * {@link clampToRange} or {@link formatNumber} — a colour rounded to a
 * step, or printed to two decimals, would be neither.
 */
export interface ColorControl<P> extends ControlNote {
  kind: "color";
  key: NumberKey<P>;
  label: string;
}

/**
 * A packed colour as CSS, zero-padded to six digits.
 *
 * The padding is the whole job: `0x0088ff` renders as `88ff` unpadded, and
 * an `<input type="color">` handed a value it cannot parse does not
 * complain — it shows black. A swatch silently disagreeing with the value
 * behind it is the bug this prevents.
 *
 * `& 0xffffff` is the coercion as well as the mask: it is `ToInt32` first,
 * so a NaN, an infinity or a fraction arrives as something six digits can
 * hold rather than reaching `toString(16)` and producing "nan".
 */
export function hexToCss(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * `#rrggbb` back to a packed number. The `#` is optional, because a value
 * pasted or read out of a palette does not always carry one.
 *
 * ZERO ON GARBAGE, NEVER NaN. A NaN colour is not an error anyone gets to
 * see: it lands in a material, comes out black, and the hunt starts at the
 * mesh rather than at the string that caused it. Black is wrong too, but it
 * is wrong identically every time, which is the difference between a bug
 * with a first suspect and one without.
 *
 * Six digits exactly — no `#rgb` shorthand. Nothing in the panel path
 * produces it (a colour input always hands back the long form), so
 * accepting it would only widen what counts as valid on the way IN, where
 * the strict answer is the useful one.
 */
export function cssToHex(s: string): number {
  const digits = s.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(digits) ? parseInt(digits, 16) : 0;
}

/**
 * A labelled row of independent flags, each its own top-level key —
 * "draw: [x] wireframe [x] grid". Use {@link FlagGridControl} when the
 * flags are members of one record instead.
 */
export interface FlagsControl<P> extends ControlNote {
  kind: "flags";
  label: string;
  items: readonly { key: FlagKey<P>; label: string }[];
}

/** A grid of flags that all live in ONE record-valued key. */
export interface FlagGridControl<P> extends ControlNote {
  kind: "flagGrid";
  key: FlagMapKey<P>;
  label: string;
  items: readonly { item: string; label: string }[];
  /** Columns in the grid (default 2). */
  columns?: number;
}

/** A grid of numbers that all live in ONE record-valued key. */
export interface NumberGridControl<P> extends ControlNote {
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
  | ColorControl<P>
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
 * Whether a control's gate holds against the values record as it stands.
 *
 * The rule is the LIBRARY's, called rather than reimplemented: an authored
 * panel and a hand-written one must hide the same rows, and two copies of
 * "what satisfies a gate" is two answers waiting to disagree. A key the
 * record cannot answer leaves the row SHOWN — a gate naming a key nothing
 * writes is inert, rather than a knob that quietly went missing.
 *
 * `hasOwn` rather than a bare index, so a gate can never be answered by
 * something off `Object.prototype`. No legal address is spelled like a
 * prototype member, which makes this belt to the format's braces.
 */
export function controlVisible<P extends Record<string, unknown>>(
  control: Control<P>,
  values: P,
): boolean {
  const record = values as Record<string, unknown>;
  return panelGateHolds(control.visibleWhen, (key) =>
    Object.hasOwn(record, key) ? record[key] : undefined,
  );
}

/**
 * The rows of `section` whose gates hold right now, in order.
 *
 * A section that comes back EMPTY renders nothing at all — no heading and no
 * tab. A titled group with no rows under it is a heading that leads
 * nowhere, and in a tabbed panel it is worse than that: a tab that opens on
 * blank space.
 */
export function visibleControls<P extends Record<string, unknown>>(
  section: ControlSection<P>,
  values: P,
): readonly Control<P>[] {
  return section.controls.filter((control) => controlVisible(control, values));
}

/**
 * The panel as it stands: each section paired with the rows whose gates
 * hold, sections with none left dropped.
 *
 * Here rather than in the component, because two things need the same
 * answer: the renderer, to draw it, and the panel around it, to decide
 * whether there is anything to draw AT ALL — whether to raise a tab bar,
 * and what to say when a gate has emptied the whole panel. Those read
 * `sections.length` once and were a section behind the moment a gate could
 * change it.
 */
export function visibleSections<P extends Record<string, unknown>>(
  sections: readonly ControlSection<P>[],
  values: P,
): { readonly section: ControlSection<P>; readonly controls: readonly Control<P>[] }[] {
  return sections
    .map((section) => ({ section, controls: visibleControls(section, values) }))
    .filter((group) => group.controls.length > 0);
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
  /** Packed `0xRRGGBB`, straight to the key — see {@link ColorControl}. */
  | { kind: "color"; control: ColorControl<P>; key: NumberKey<P>; value: number }
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
