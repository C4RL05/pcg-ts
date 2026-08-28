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

/** One titled group of rows, in the order they should be shown. */
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
