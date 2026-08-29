/**
 * The panel spec: a graph's control panel, authored as a sidecar.
 *
 * WHY THIS IS NOT `ParamSchema`. A {@link ParamSchema} is a fact about a
 * NODE TYPE — what the param means, what it accepts, what it defaults to —
 * and it is the same fact in every graph that uses that type. Whether an
 * address gets a widget at all, what it is called on screen, which section
 * it sits under and how coarsely a slider steps are facts about ONE
 * PRESENTATION of ONE graph: the same `cellSize` belongs under "Scatter" in
 * one graph and under "Terrain" in the next, and the node type cannot know
 * which. So those live here, per graph, and not on the schema. See
 * `src/nodes/graphParams.ts` for the same rule stated from the graph side.
 *
 * WHY IT IS A SIDECAR RATHER THAN PART OF THE GRAPH. Labels and slider
 * ranges are presentation, not generation: the graph cooks identically
 * without them. Keeping them out of the serialized graph keeps THAT format
 * about generation, and lets a panel be added to, or dropped from, any
 * graph without rewriting it.
 *
 * WHAT AUTHORING BUYS. A panel needs no spec to exist: a loaded graph
 * already carries its knobs, and their schemas say enough to render typed
 * boxes. But of the params the shipped primitives expose, only a handful
 * declare both a min and a max, so a panel derived from schemas alone is
 * honest and not tunable — you cannot feel your way to a good value by
 * dragging a number field. A spec supplies exactly what a schema cannot
 * know: a range worth dragging, a human label, a unit, an order, a
 * grouping, and which knobs matter enough to show at all.
 *
 * The types are the format, and {@link parsePanelSpec} is the only thing
 * that turns untrusted JSON into one. Nothing here registers on import or
 * touches a module-level anything: this file is a type plus a pure
 * function, which is why `pcg-ts/panels` is absent from package.json's
 * `sideEffects` array.
 */

/** Errors raised while validating a panel spec. */
export class PanelSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanelSpecError";
  }
}

/**
 * One value a gate may require a knob to hold.
 *
 * The three scalars and no more, because these are exactly what a knob can
 * hold AND a widget can produce: `f32`/`i32`/`u32` give a number, `bool` a
 * boolean, `enum` and `string` a string. A `vec3` is an array, and "this row
 * appears when that vector equals [0, 1, 0]" is not a question a panel has
 * ever wanted to ask — leaving it out costs nothing and un-leaving it later
 * is free, where taking it back would not be.
 */
export type PanelConditionValue = number | string | boolean;

/**
 * What one address must hold for a gated row to be shown: a value, or a
 * NON-EMPTY list meaning "any of these".
 *
 * The list is not sugar for repeating the key — a JSON object cannot hold
 * one key twice — and it is the shape most gates actually want: `caps`
 * applies to the two CLOSED profiles, which is one condition over a set, not
 * two rows or two panels.
 */
export type PanelCondition = PanelConditionValue | readonly PanelConditionValue[];

/**
 * One authored row. `param` names the knob; everything else is
 * presentation.
 */
export interface PanelControlSpec {
  /**
   * The knob's address:
   *
   * - `"<nodeId>.<paramName>"` — a param on one node.
   * - `"<nodeId>.<paramName>.<fieldParamName>"` — a literal named inside
   *   that param's field expression.
   * - `"$<name>"` — a graph-scoped param, fanned out by the graph layer to
   *   every expression that reads the name.
   *
   * NOTHING SPLITS IT at read time: a consumer looks the whole string up in
   * a map keyed by the same addresses, so a node id containing a dot stays
   * addressable. Where it must be read apart, read from the RIGHT — a
   * field-spec param name is dot-free and so is a node param name, so
   * everything left over is the node id.
   */
  readonly param: string;
  /**
   * Further addresses this row writes with the same value.
   *
   * One knob standing for several params is the library's own idea: a
   * subgraph's exposed param already declares `targets` as a list. This is
   * that idea for a graph of plain nodes, where a thing an author thinks of
   * as one setting is spread over several. A box truss has four chord
   * tubes; "chord" is one number, not four sliders that have to be dragged
   * into agreement.
   *
   * The row reads the PRIMARY's value, so a mirror moved on its own reads
   * as the graph's until this row is next turned.
   */
  readonly also?: readonly string[];
  /**
   * When this row is shown at all: knob address → the value that knob must
   * currently hold. Absent means always.
   *
   * EVERY ENTRY MUST HOLD (and), and a list value means ANY OF (or). So
   * `{"skin.profile": ["circle", "square"], "skin.joint": "miter"}` reads
   * "a closed profile, mitred". One key is the common case; the object is
   * what makes two independent conditions expressible without inventing a
   * grammar.
   *
   * WHAT IT IS FOR, AND WHAT IT IS NOT. Several shipped params document
   * themselves as ignored in some mode — `sides` means nothing to a ribbon,
   * `miterLimit` means nothing to a perpendicular joint. That fact is in the
   * schema's prose, where a reader finds it only after turning a knob that
   * does nothing. A gate moves it into the panel. It is PRESENTATION and
   * nothing else: a hidden row still holds its value, the graph still cooks
   * with it, and hiding a row never changes what the graph produces. A
   * param that must not be SET in some mode is a validation rule and belongs
   * on the node, not here.
   *
   * The addresses are the same three forms {@link PanelControlSpec.param}
   * takes, and they need not be rows of this panel — a gate may read a knob
   * the spec chose not to surface, or one this host does not have at all. A
   * host that cannot resolve one SHOWS the row: a mistyped gate must never
   * silently swallow a knob. (The shipped corpus holds itself to the
   * stricter rule that a gate names a row of the same panel, so every
   * shipped panel can be driven from the panel alone — that is a policy of
   * `graphs/panels/`, enforced by `tests/panelSpec.test.ts`, not a rule of
   * the format.)
   *
   * A row may not gate on its own `param` or on anything in its own `also`.
   * Both drive the value they would be reading, so turning the row hides the
   * row, with nothing left on screen to turn it back.
   */
  readonly visibleWhen?: Readonly<Record<string, PanelCondition>>;
  /** The row's name on screen. Defaults to the param name. */
  readonly label?: string;
  /**
   * Hover text, OVERRIDING the schema's. Both kinds of knob carry one
   * already — a node param from its registered schema, a field-spec param
   * from the `description` written beside its inline value — so this is
   * where one presentation says it differently, not where the graph says it
   * at all. A row that omits it keeps the graph's.
   */
  readonly description?: string;
  /**
   * Bounds, overriding the schema's. Both present from EITHER source is
   * what promotes a typed box to a slider; one alone bounds the box on that
   * side.
   */
  readonly min?: number;
  readonly max?: number;
  /** Slider/box quantum. Must be positive. Defaults from the bounds. */
  readonly step?: number;
  /** Suffix shown after the value, e.g. `"m"`. */
  readonly unit?: string;
  /** An authoring note. Carried by the format and read by nothing. */
  readonly _comment?: string;
}

/**
 * One titled group of rows, in the order they should be shown.
 *
 * NO `visibleWhen` HERE, deliberately. A section is its rows: gate them all
 * and the section has nothing left to show, so "hide this whole group"
 * already has a spelling. Giving the section its own gate would add a second
 * one that can DISAGREE with the first — a shown row inside a hidden section
 * — and the format would then owe every author a precedence rule to
 * remember. One place decides whether a row is on screen, and a host
 * implements the rule once.
 *
 * The cost is real and is the trade: a five-row section that all turns on
 * one mode repeats that gate five times. Should that repetition start
 * showing up across the corpus, a section gate can be added then — adding a
 * key is free where taking one back is breaking, which is the same stance
 * `src/spatial` takes about being exported.
 */
export interface PanelSectionSpec {
  readonly title: string;
  readonly controls: readonly PanelControlSpec[];
  /** An authoring note. Carried by the format and read by nothing. */
  readonly _comment?: string;
}

/** A whole panel: the sections, in order. */
export interface GraphPanelSpec {
  readonly sections: readonly PanelSectionSpec[];
  /** An authoring note. Carried by the format and read by nothing. */
  readonly _comment?: string;
}

/** Options for {@link parsePanelSpec}. */
export interface ParsePanelSpecOptions {
  /**
   * What to call this spec in an error — a file name, a URL, whatever the
   * caller can act on. Every message is prefixed with it, so the reader
   * knows WHICH panel is wrong before knowing what about it is. Defaults to
   * `"panel spec"`.
   */
  readonly source?: string;
}

const ROOT_KEYS = ["sections", "_comment"] as const;
const SECTION_KEYS = ["title", "controls", "_comment"] as const;
const CONTROL_KEYS = [
  "param",
  "also",
  "visibleWhen",
  "label",
  "description",
  "min",
  "max",
  "step",
  "unit",
  "_comment",
] as const;

/**
 * How an address is spelled, said once so the parser and the error agree.
 * Quoted in full whenever a `param` is rejected, because "that is not an
 * address" is only actionable next to the three that are.
 */
const ADDRESS_FORMS =
  'Use "<nodeId>.<paramName>" for a node param, ' +
  '"<nodeId>.<paramName>.<fieldParamName>" for a literal inside that param\'s field ' +
  'expression, or "$<name>" for a graph-scoped param.';

/**
 * What the walk carries: what to call this panel, and the claims rows make
 * about each other.
 *
 * The claims have to be ACCUMULATED rather than checked where they are
 * read, because either side can come first in the file: an `also` entry may
 * mirror a param that a later row declares, so the collision between them
 * is not decidable at the moment either one is parsed. Both lists are
 * filled during the walk and settled once at the end.
 */
interface Ctx {
  readonly source: string;
  /** Address → path of the row whose `param` it is. */
  readonly params: Map<string, string>;
  /** Every `also` entry, with the path of the entry that listed it. */
  readonly mirrors: { readonly key: string; readonly path: string }[];
}

/**
 * The message shape: the panel, then the address of the fault inside it,
 * then what is wrong with it.
 *
 * The source is a PREFIX and not the root of the path, which is the whole
 * reason `path` can be empty. A caller naming a file gets
 * `panel spec "x.json": sections[0].controls[1].min: …` rather than a path
 * glued onto the end of a file extension.
 */
function fail(ctx: Ctx, path: string, message: string): never {
  throw new PanelSpecError(
    path === "" ? `${ctx.source}: ${message}` : `${ctx.source}: ${path}: ${message}`,
  );
}

/** `sections[0]` + `title` → `sections[0].title`; `""` + `sections` → `sections`. */
function child(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reject any key the format does not define, naming the ones it does. */
function checkKeys(
  ctx: Ctx,
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(
        ctx,
        path,
        `unknown key ${JSON.stringify(key)}; allowed keys: ${allowed.join(", ")}. Presentation ` +
          "the format does not carry belongs in the host that renders the panel, not in the spec.",
      );
    }
  }
}

function requireObject(
  ctx: Ctx,
  v: unknown,
  path: string,
  what: string,
): Record<string, unknown> {
  if (!isPlainObject(v)) fail(ctx, path, `expected ${what}, got ${describeValue(v)}`);
  return v;
}

/**
 * A string with something in it, or a stated reason it is not one.
 *
 * BLANK COUNTS AS EMPTY. A title of three spaces groups nothing and a label
 * of three spaces names nothing, so the reason `""` is refused refuses
 * those too — and a blank is the harder one to see in a diff.
 */
function requireText(ctx: Ctx, v: unknown, path: string, omittable: boolean): string {
  if (typeof v !== "string") fail(ctx, path, `expected a string, got ${describeValue(v)}`);
  if (v.trim() === "") {
    fail(
      ctx,
      path,
      `expected a non-empty string, got ${JSON.stringify(v)}` +
        (omittable ? "; omit the key instead of giving it a blank value" : ""),
    );
  }
  return v;
}

/** The same, for a key that may simply be absent. */
function optionalText(
  ctx: Ctx,
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  return requireText(ctx, v, child(path, key), true);
}

function optionalNumber(
  ctx: Ctx,
  obj: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  const at = child(path, key);
  if (typeof v !== "number") fail(ctx, at, `expected a number, got ${describeValue(v)}`);
  if (!Number.isFinite(v)) fail(ctx, at, `expected a finite number, got ${String(v)}`);
  return v;
}

/**
 * Whether a string can address a knob at all.
 *
 * Deliberately NOT a count of dots. A node id may itself contain one, so
 * `a.b.c.d` is a legal two-part address on a node called `a.b.c`, and a
 * rule fitted to the shipped corpus — which happens to hold only one- and
 * two-dot addresses — would reject a graph the library accepts. What IS
 * always true of a key the graph can mint:
 *
 * - a graph-scoped address is `$` followed by a dot-free name;
 * - any other address is two or more dot-separated segments, none of them
 *   empty, since `a..b` names nothing between the dots;
 * - and neither carries surrounding whitespace or a control character.
 *   Those cannot occur in a node id or a param name, so an address holding
 *   one matches no knob — and the panel would quietly file the row under
 *   "names a param this graph does not expose" instead of saying the
 *   address was mistyped, which is the failure worth naming here.
 */
function isAddress(s: string): boolean {
  if (s !== s.trim() || /[\u0000-\u001f\u007f]/.test(s)) return false;
  if (s.startsWith("$")) return s.length > 1 && !s.includes(".");
  const parts = s.split(".");
  return parts.length >= 2 && parts.every((p) => p !== "");
}

function requireAddress(ctx: Ctx, v: unknown, path: string): string {
  if (typeof v !== "string") fail(ctx, path, `expected a string, got ${describeValue(v)}`);
  if (v === "") fail(ctx, path, `expected a knob address, got an empty string. ${ADDRESS_FORMS}`);
  if (!isAddress(v)) {
    fail(ctx, path, `${JSON.stringify(v)} is not a knob address. ${ADDRESS_FORMS}`);
  }
  return v;
}

/**
 * One scalar a gate may require, or a stated reason it is not one.
 *
 * Non-finite is refused for the reason a bound is: `NaN` and `Infinity`
 * survive no JSON round trip, and no knob in a cooked graph holds one — so a
 * gate on either could never be satisfied and the row would be gone for
 * good, which is a spelling of "delete the row" nobody means.
 */
function parseConditionValue(ctx: Ctx, v: unknown, path: string): PanelConditionValue {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      fail(
        ctx,
        path,
        `expected a finite number, got ${String(v)}. No knob holds ${String(v)}, so this gate ` +
          "could never hold and the row would never be shown.",
      );
    }
    return v;
  }
  if (typeof v === "string" || typeof v === "boolean") return v;
  fail(
    ctx,
    path,
    `expected a number, string or boolean, got ${describeValue(v)}. A gate names ONE value the ` +
      "knob must hold, or a list of the values any of which will do.",
  );
}

/** A gate's right-hand side: one value, or a non-empty list of them. */
function parseCondition(ctx: Ctx, raw: unknown, at: string): PanelCondition {
  if (!Array.isArray(raw)) return parseConditionValue(ctx, raw, at);
  if (raw.length === 0) {
    fail(
      ctx,
      at,
      "expected at least one value; an empty list matches nothing, so the row could never be " +
        "shown. Name the value the knob must hold, or delete the row.",
    );
  }
  const values: PanelConditionValue[] = [];
  // An INDEX loop, not `forEach`, which skips holes. A sparse array reaches
  // here from a host building a spec in JS rather than parsing one, and
  // `forEach` would drop the holes silently: `[ , ]` would normalize to the
  // empty list this function has just refused, and the row it gates would
  // then be hidden for good. Read as `undefined` instead, and rejected by
  // the same rule that rejects a null.
  for (let i = 0; i < raw.length; i++) {
    const value = parseConditionValue(ctx, raw[i], `${at}[${i}]`);
    // Harmless to match twice, but it is the shape of a half-finished edit
    // — and `also` already refuses the same slip for the same reason.
    if (values.includes(value)) {
      fail(ctx, `${at}[${i}]`, `${JSON.stringify(value)} is listed twice; list it once.`);
    }
    values.push(value);
  }
  return values;
}

/**
 * The row's gate, checked against the row itself.
 *
 * `param` and `also` are passed in because the two rules worth enforcing are
 * about THIS row: a gate on a knob the row writes is a row that hides itself
 * the moment it is turned. Everything else about a gate — whether the graph
 * has such a knob at all — the parser cannot know: it resolves no addresses
 * and imports nothing that could.
 */
function parseVisibleWhen(
  ctx: Ctx,
  obj: Record<string, unknown>,
  path: string,
  param: string,
  also: readonly string[],
): Record<string, PanelCondition> | undefined {
  const raw = obj.visibleWhen;
  if (raw === undefined) return undefined;
  const at = child(path, "visibleWhen");
  if (!isPlainObject(raw)) {
    fail(
      ctx,
      at,
      "expected an object mapping a knob address to the value it must hold, got " +
        describeValue(raw),
    );
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    fail(
      ctx,
      at,
      "expected at least one condition; a `visibleWhen` with none gates on nothing, so the row " +
        "is always shown. Omit the key.",
    );
  }

  const gates: Record<string, PanelCondition> = {};
  for (const key of keys) {
    // Bracketed and quoted rather than dotted, because an address holds dots
    // of its own: `visibleWhen.skin.profile` cannot be read back apart, and
    // the path is the half of the message a reader acts on.
    const keyAt = `${at}[${JSON.stringify(key)}]`;
    requireAddress(ctx, key, keyAt);
    if (key === param) {
      fail(
        ctx,
        keyAt,
        `${JSON.stringify(key)} is this row's own param. A row that gates on its own value hides ` +
          "itself the moment it is turned, and nothing is left on screen to turn it back; gate " +
          "on another knob.",
      );
    }
    if (also.includes(key)) {
      fail(
        ctx,
        keyAt,
        `${JSON.stringify(key)} is mirrored by this row's \`also\`, so it holds whatever this ` +
          "row last wrote — gating on it is gating on this row's own value, which hides the row " +
          "with no way back; gate on another knob.",
      );
    }
    gates[key] = parseCondition(ctx, raw[key], keyAt);
  }
  return gates;
}

function parseControl(ctx: Ctx, raw: unknown, path: string): PanelControlSpec {
  const obj = requireObject(ctx, raw, path, 'a control object with a "param"');
  checkKeys(ctx, obj, CONTROL_KEYS, path);

  const paramAt = child(path, "param");
  const param = requireAddress(ctx, obj.param, paramAt);
  const already = ctx.params.get(param);
  if (already !== undefined) {
    fail(
      ctx,
      paramAt,
      `${JSON.stringify(param)} is already the param of ${already}. One address is one row: two ` +
        "rows writing the same knob would show the same value twice and disagree the moment " +
        "either is turned. Use `also` if you meant one row driving several params.",
    );
  }
  ctx.params.set(param, path);

  const also: string[] = [];
  if (obj.also !== undefined) {
    const alsoAt = child(path, "also");
    if (!Array.isArray(obj.also)) {
      fail(ctx, alsoAt, `expected an array of knob addresses, got ${describeValue(obj.also)}`);
    }
    obj.also.forEach((entry: unknown, i: number) => {
      const at = `${alsoAt}[${i}]`;
      const key = requireAddress(ctx, entry, at);
      if (key === param) {
        fail(
          ctx,
          at,
          `${JSON.stringify(key)} is this row's own param. \`also\` lists the OTHER addresses the ` +
            "row writes; drop it from the list.",
        );
      }
      if (also.includes(key)) {
        fail(ctx, at, `${JSON.stringify(key)} is listed twice; list it once.`);
      }
      also.push(key);
      // Settled at the end, against every row's `param` and every other
      // row's mirrors — neither of which is known yet.
      ctx.mirrors.push({ key, path: at });
    });
  }

  // After `param` and `also`, both of which it is checked against.
  const visibleWhen = parseVisibleWhen(ctx, obj, path, param, also);

  const label = optionalText(ctx, obj, "label", path);
  const description = optionalText(ctx, obj, "description", path);
  const unit = optionalText(ctx, obj, "unit", path);
  const comment = optionalText(ctx, obj, "_comment", path);
  const min = optionalNumber(ctx, obj, "min", path);
  const max = optionalNumber(ctx, obj, "max", path);
  const step = optionalNumber(ctx, obj, "step", path);

  if (min !== undefined && max !== undefined) {
    if (min > max) {
      fail(
        ctx,
        child(path, "min"),
        `min ${min} is greater than max ${max}; a slider spanning [min, max] has no positions. ` +
          "Swap them, or drop the bound that is wrong.",
      );
    }
    if (min === max) {
      fail(
        ctx,
        child(path, "min"),
        `min and max are both ${min}, so the row has one value and nothing to drag. Widen the ` +
          "range, or drop both bounds to get a typed box.",
      );
    }
  }
  if (step !== undefined) {
    if (!(step > 0)) {
      fail(
        ctx,
        child(path, "step"),
        `expected a positive number, got ${step}. A step of ${step} quantises every value to the ` +
          "same one; omit `step` to take the default derived from the bounds.",
      );
    }
    if (min !== undefined && max !== undefined && step > max - min) {
      fail(
        ctx,
        child(path, "step"),
        `step ${step} is wider than the range [${min}, ${max}] it quantises, so the row can only ` +
          `reach ${min} and ${max}. Omit \`step\` to take the default derived from the bounds.`,
      );
    }
  }

  return {
    param,
    ...(also.length > 0 ? { also } : {}),
    ...(visibleWhen !== undefined ? { visibleWhen } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(comment !== undefined ? { _comment: comment } : {}),
  };
}

function parseSection(ctx: Ctx, raw: unknown, path: string): PanelSectionSpec {
  const obj = requireObject(
    ctx,
    raw,
    path,
    'a section object with a "title" and a "controls" array',
  );
  checkKeys(ctx, obj, SECTION_KEYS, path);
  // Before the walk into `controls`: a scalar this level got wrong should
  // not be reported after a fault three levels down that the reader would
  // then fix first.
  const comment = optionalText(ctx, obj, "_comment", path);

  if (obj.title === undefined) {
    fail(ctx, path, 'missing "title". Every section is titled: the title is what groups the rows.');
  }
  const title = requireText(ctx, obj.title, child(path, "title"), false);

  if (obj.controls === undefined) {
    fail(ctx, path, 'missing "controls". A section carries the rows it groups; give it an array.');
  }
  const controlsAt = child(path, "controls");
  if (!Array.isArray(obj.controls)) {
    fail(ctx, controlsAt, `expected an array of controls, got ${describeValue(obj.controls)}`);
  }
  if (obj.controls.length === 0) {
    fail(
      ctx,
      controlsAt,
      "expected at least one control; a section with no rows renders nothing. Delete the section.",
    );
  }
  const controls = obj.controls.map((c: unknown, i: number) =>
    parseControl(ctx, c, `${controlsAt}[${i}]`),
  );
  return { title, controls, ...(comment !== undefined ? { _comment: comment } : {}) };
}

/**
 * Every claim one row makes about another, checked once the whole spec has
 * been read.
 *
 * These CANNOT be checked during the walk. `also` mirrors an address that
 * some other row may own, and that row may be later in the file — so a
 * single pass would catch the collision only when the file happened to be
 * written in one of the two orders. Both failures are the same one: a knob
 * written from two places, with nothing saying which write wins.
 */
/**
 * A row may not depend, through any chain of gates, on itself.
 *
 * The self-gate rule refuses the one-step case with "nothing is left on
 * screen to turn it back". That reason does not stop at one step: two rows
 * gating each other reach a state — turn A out of B's range, then B out of
 * A's — where neither is drawn and neither can be reached to undo it. The
 * one-step rule alone would have refused the obvious spelling of the trap
 * and accepted the spelling an author is more likely to write by accident.
 *
 * ONLY ROWS PARTICIPATE. A gate naming an address this panel gives no row
 * is driven from somewhere else — the node inspector, another panel, the
 * graph — so it is never part of a cycle this file can create, and it is
 * exactly the case that makes an otherwise-cyclic pair recoverable.
 *
 * Settled after the walk for the same reason `also` is: the row a gate
 * names may be later in the file than the gate.
 */
function settleGates(ctx: Ctx, sections: readonly PanelSectionSpec[]): void {
  /** Row param → the row params its gates read, with where each was written. */
  const edges = new Map<string, { readonly to: string; readonly path: string }[]>();
  sections.forEach((section, s) => {
    section.controls.forEach((control, c) => {
      if (control.visibleWhen === undefined) return;
      const from = control.param;
      const at = `sections[${s}].controls[${c}].visibleWhen`;
      for (const address of Object.keys(control.visibleWhen)) {
        if (!ctx.params.has(address)) continue;
        const list = edges.get(from);
        const edge = { to: address, path: `${at}[${JSON.stringify(address)}]` };
        if (list) list.push(edge);
        else edges.set(from, [edge]);
      }
    });
  });

  const done = new Set<string>();
  const stack: string[] = [];
  const walk = (node: string, via: string): void => {
    if (done.has(node)) return;
    const at = stack.indexOf(node);
    if (at >= 0) {
      const loop = [...stack.slice(at), node].map((p) => JSON.stringify(p)).join(" → ");
      fail(
        ctx,
        via,
        `this gate closes a loop: ${loop}. Every row in it is hidden by another row in it, so ` +
          "the panel can reach a state where none of them is drawn and none can be turned to " +
          "bring the others back. Gate the chain on a knob no row in it writes.",
      );
    }
    stack.push(node);
    for (const edge of edges.get(node) ?? []) walk(edge.to, edge.path);
    stack.pop();
    done.add(node);
  };
  for (const from of edges.keys()) walk(from, "");
}

function settleClaims(ctx: Ctx, sections: readonly PanelSectionSpec[]): void {
  const titles = new Map<string, number>();
  sections.forEach((section, i) => {
    const first = titles.get(section.title);
    if (first !== undefined) {
      fail(
        ctx,
        `sections[${i}].title`,
        `${JSON.stringify(section.title)} is already the title of sections[${first}]. Two ` +
          "sections under one title read as one section split in half; merge them, or say what " +
          "makes this one different.",
      );
    }
    titles.set(section.title, i);
  });

  settleGates(ctx, sections);

  const mirrored = new Map<string, string>();
  for (const { key, path } of ctx.mirrors) {
    const owner = ctx.params.get(key);
    if (owner !== undefined) {
      fail(
        ctx,
        path,
        `${JSON.stringify(key)} is the param of ${owner}, which already gives it a row of its ` +
          "own. A knob driven by one row and mirrored by another is written from two places with " +
          "no rule for which wins; drop it from `also`, or delete the row that owns it.",
      );
    }
    const first = mirrored.get(key);
    if (first !== undefined) {
      fail(
        ctx,
        path,
        `${JSON.stringify(key)} is already mirrored by ${first}. Two rows writing one knob ` +
          "through `also` disagree the moment either is turned; mirror it from one row only.",
      );
    }
    mirrored.set(key, path);
  }
}

/**
 * Validate untrusted JSON as a {@link GraphPanelSpec}, or throw a
 * {@link PanelSpecError} naming the panel, the section, the control and the
 * field that is wrong.
 *
 * The result is a fresh, normalized object that shares no structure with
 * the input: absent optionals are absent rather than `undefined`, so a spec
 * that round-trips through here compares and serializes the same way twice.
 *
 * @param value Already-parsed JSON (this does not call `JSON.parse`).
 * @param opts `source` names the panel in every message.
 */
export function parsePanelSpec(value: unknown, opts?: ParsePanelSpecOptions): GraphPanelSpec {
  const ctx: Ctx = { source: opts?.source ?? "panel spec", params: new Map(), mirrors: [] };
  const obj = requireObject(ctx, value, "", 'an object with a "sections" array');
  checkKeys(ctx, obj, ROOT_KEYS, "");
  const comment = optionalText(ctx, obj, "_comment", "");

  if (obj.sections === undefined) {
    fail(ctx, "", 'missing "sections". A panel spec is its sections, in the order they are shown.');
  }
  if (!Array.isArray(obj.sections)) {
    fail(ctx, "sections", `expected an array of sections, got ${describeValue(obj.sections)}`);
  }
  if (obj.sections.length === 0) {
    fail(
      ctx,
      "sections",
      "expected at least one section; a spec with none hides every knob. Delete the spec instead " +
        "— a graph with no panel file gets the panel derived from its schemas.",
    );
  }

  const sections = obj.sections.map((s: unknown, i: number) =>
    parseSection(ctx, s, `sections[${i}]`),
  );
  settleClaims(ctx, sections);
  return { sections, ...(comment !== undefined ? { _comment: comment } : {}) };
}

/**
 * Whether one knob value satisfies one {@link PanelCondition}: equal to it,
 * or to any member of a list.
 *
 * STRICTLY, WITH NO COERCION. `1` does not satisfy `"1"` and `1` does not
 * satisfy `true`. A mode is an enum and a count is a number, so a gate that
 * matched across types would be gating on something other than what it says
 * — and the failure would be a row that appears in the wrong mode, which
 * looks like a bug in the graph rather than a typo in the panel.
 *
 * Exported because matching is the FORMAT, not the presentation. A host that
 * reads `pcg-ts/panels` for the shape of a gate must not have to guess what
 * satisfying it means, or an authored panel would hide different rows in
 * every host that renders it.
 */
export function panelConditionHolds(condition: PanelCondition, value: unknown): boolean {
  return Array.isArray(condition)
    ? condition.some((c) => c === value)
    : condition === (value as PanelConditionValue);
}

/**
 * Whether a value is one a gate could be compared against at all.
 *
 * The three scalars, and nothing else — a vector, a list, a `null`, an
 * absent knob. Exported because it is half the rule: a host that treated
 * "the knob holds a vec3" as a gate that FAILED would hide the row, where
 * the format says an unanswerable gate leaves it shown.
 */
export function isPanelConditionValue(value: unknown): value is PanelConditionValue {
  const t = typeof value;
  return t === "number" || t === "string" || t === "boolean";
}

/**
 * Whether a `visibleWhen` record is satisfied. `undefined` gates — a row
 * that declares none — are always satisfied.
 *
 * The whole rule in one place, so {@link panelRowVisible} and any host that
 * keys its values differently (a renderer holding `Control` specs rather
 * than `PanelControlSpec`s, say) cannot end up with two answers.
 */
export function panelGateHolds(
  gates: Readonly<Record<string, PanelCondition>> | undefined,
  valueAt: (address: string) => unknown,
): boolean {
  if (gates === undefined) return true;
  for (const [address, condition] of Object.entries(gates)) {
    const value = valueAt(address);
    // UNANSWERABLE, not false. `undefined` is a host with no such knob;
    // anything that is not a scalar is a knob whose value a gate cannot be
    // compared against — a vector, a list, a param holding a field. Reading
    // either as a failed gate would hide the row, and the whole point of the
    // shown-by-default rule is that a gate nobody can answer must not
    // silently remove a knob from the panel.
    if (!isPanelConditionValue(value)) continue;
    if (!panelConditionHolds(condition, value)) return false;
  }
  return true;
}

/**
 * Whether a row should be on screen right now.
 *
 * `valueAt` answers with the knob's current value, or `undefined` when this
 * host has no such knob — which is not only a mistyped address: a knob
 * holding a field has no constant value to compare, and a knob of a type no
 * widget represents was never read.
 *
 * AN UNANSWERABLE GATE LEAVES THE ROW SHOWN. The alternative silently
 * removes a knob from the panel because of a typo somewhere else in the
 * file, and the author's evidence is a row that is not there. Shown, the
 * gate is merely inert, and the host is free to say so out loud beside the
 * panel — which is what this repo's editor does.
 *
 * Every entry must hold; a row with no `visibleWhen` is always shown.
 */
export function panelRowVisible(
  control: PanelControlSpec,
  valueAt: (address: string) => unknown,
): boolean {
  return panelGateHolds(control.visibleWhen, valueAt);
}
