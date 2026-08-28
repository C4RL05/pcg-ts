/**
 * A TEXT syntax for field expressions: a printer and a parser over the
 * spec tree `./fieldJson.ts` already defines.
 *
 * The TREE stays the format. Nothing is ever saved as text — text is an
 * intermediate, bidirectional VIEW, the thing a human types into a box or
 * an agent writes in a sentence, converted to a spec at the edge and back
 * out again for display. That is why the bar here is the same one
 * `spec.test.ts` sets for the two descriptions of one computation:
 * `parseFieldText(printFieldSpec(spec))` must deep-equal `spec` for every
 * spec the corpus contains, or the view lies about the tree it is showing.
 *
 * The syntax reads like the TypeScript combinator API (see README's
 * "## Fields"), because the docs already lead with that and one mental
 * model should serve both: `mul(a, b)` is `a * b`, everything else is
 * `name(args…)`, and object/array literals are ordinary syntax.
 *
 * Two asymmetries are deliberate, and both are the same rule — the printer
 * emits ONE spelling for each tree, so printing is idempotent and no
 * reader is shown a form they did not type:
 *
 * - `&&` and `||` are INPUT-ONLY sugar for `mul` and `max`. The grammar
 *   has no boolean type (a comparison yields 1 or 0, and multiplying two
 *   predicates is their conjunction), so the sugar is real; but a `mul`
 *   prints as `*` whether or not its operands are predicates, because
 *   printing `&&` back for an arbitrary `mul` would show a reader a trap.
 * - unary `-` folds into a number literal where it can (`-1.5`) and
 *   otherwise desugars to `sub(0, x)`, which prints back as `0 - x`.
 *
 * Precedence is JavaScript's, so a reader transliterating from the
 * combinator docs is never surprised: `* /` > `+ -` > `< <= > >=` >
 * `== !=` > `&&` > `||`, all left-associative. The printer emits MINIMAL
 * parentheses — only where precedence or associativity requires them.
 *
 * ## Literals and `constant`
 *
 * A bare literal is the RAW argument form the grammar already admits
 * (`FieldSpecArg`: a number or a number tuple in an argument position),
 * and an explicit `{fn: "constant", value: 3}` node prints as
 * `constant(3)`. The two are semantically identical — `buildArg` wraps the
 * raw form into a constant — but they are DIFFERENT TREES, and the corpus
 * contains both in quantity (230 raw numbers and 105 constant nodes across
 * `graphs/`). Printing them alike would make the round trip rewrite one
 * into the other, which is exactly the silent structural edit a
 * bidirectional view must not perform.
 *
 * ## The one thing text does not preserve
 *
 * An optional key present as an OWN property whose value is `undefined`
 * (`{fn: "randomField", key: undefined}`) prints as though the key were
 * absent, so the round trip returns a spec without it. This is the same
 * normalization `JSON.stringify` performs, and it is why the case cannot
 * arise from a serialized graph or from `getFieldSpec`: every constructor
 * that has an optional key branches on it rather than writing `undefined`
 * (see `attribute` in `./inputs.ts`). It is reachable only by hand-writing
 * the property in JavaScript, and normalizing it is better than refusing
 * to print a spec that means exactly what the version without the key
 * means.
 *
 * ## Shapes
 *
 * Which text position maps to which spec key is derived from the registry
 * (`listFieldFnInfos()`): a fn whose only key is `args` prints its
 * arguments positionally, and the arity comes from the registered argument
 * list. {@link SPECIAL_SHAPES} carries the handful of fns with keys beyond
 * `args`, and {@link shapes} CHECKS each entry against the registry's own
 * `keys`, so a fn that gains or loses a key cannot leave a stale shape
 * behind quietly. Spec-valued positions are never enumerated here at all —
 * `specChildEntries` is the single answer to "what hangs off this spec",
 * and the printer asks it rather than keeping a second list.
 *
 * Errors are API (see `docs/authoring.md`): every parse failure names the
 * offending token, its `line:column` in the source, and the valid
 * alternatives or the fix. They are raised as `FieldJsonError`, the error
 * type the rest of the grammar already raises, so one `catch` covers
 * reading a field from text and reading one from JSON.
 */
import { FieldJsonError, type FieldFnInfo, listFieldFnInfos } from "./fieldJson.js";
import { type FieldSpec, MAX_SPEC_DEPTH, specChildEntries } from "./spec.js";

/**
 * The nesting refusal, worded as `buildSpec` words it — both ends of the
 * text view hold the SAME bound the JSON end does, so a tree too deep to
 * parse as JSON is too deep to print as text, and text a machine generated
 * cannot smuggle past a limit the tree format enforces.
 *
 * Without it the recursion is bounded only by the JavaScript stack, and a
 * hostile or generated input (20000 nested parens, say) raises a bare
 * `RangeError` from somewhere inside the parser instead of an error naming
 * a position — which is the one failure mode `docs/authoring.md` rules
 * out.
 */
const TOO_DEEP = `field spec nesting deeper than ${MAX_SPEC_DEPTH} levels; flatten the expression`;

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

/** Precedence of a call, a literal, or a parenthesized expression. */
const PRIMARY = 7;

/**
 * One infix operator: its text, the fn it stands for, its precedence, and
 * whether the PRINTER may emit it.
 *
 * `print: false` marks input-only sugar. `&&` and `||` are the entire
 * population: they parse to `mul` and `max`, and the printer emits `*` and
 * `max(…)` for those trees instead — see the module doc.
 *
 * Order matters: the lexer takes the first match, so two-character
 * operators are listed before the one-character ones they start with.
 */
const INFIX: readonly {
  readonly text: string;
  readonly fn: string;
  readonly prec: number;
  readonly print: boolean;
}[] = [
  { text: "||", fn: "max", prec: 1, print: false },
  { text: "&&", fn: "mul", prec: 2, print: false },
  { text: "==", fn: "eq", prec: 3, print: true },
  { text: "!=", fn: "ne", prec: 3, print: true },
  { text: "<=", fn: "le", prec: 4, print: true },
  { text: ">=", fn: "ge", prec: 4, print: true },
  { text: "<", fn: "lt", prec: 4, print: true },
  { text: ">", fn: "gt", prec: 4, print: true },
  { text: "+", fn: "add", prec: 5, print: true },
  { text: "-", fn: "sub", prec: 5, print: true },
  { text: "*", fn: "mul", prec: 6, print: true },
  { text: "/", fn: "div", prec: 6, print: true },
];

/** The operator text (and precedence) each fn PRINTS as, sugar excluded. */
const PRINT_OPS = new Map<string, { readonly text: string; readonly prec: number }>(
  INFIX.filter((op) => op.print).map((op) => [op.fn, { text: op.text, prec: op.prec }]),
);

// ---------------------------------------------------------------------------
// Shapes: which text position carries which spec key
// ---------------------------------------------------------------------------

/**
 * One positional slot of a fn's text form.
 *
 * - `args` — the `args` array, spread across `arity` positions (or all the
 *   remaining ones when the registered argument list is variadic).
 * - `key` — one spec key, written positionally: `attribute("t", 3)`.
 * - `bag` — several INDEPENDENTLY OPTIONAL keys collapsed into one object
 *   literal. Only `param` needs it: written positionally, `min` without
 *   `value` would leave a hole nothing can spell.
 */
type Slot =
  | { readonly kind: "args"; readonly arity: number | "variadic" }
  | { readonly kind: "key"; readonly key: string; readonly optional: boolean }
  | { readonly kind: "bag"; readonly keys: readonly string[] };

interface Shape {
  readonly fn: string;
  readonly slots: readonly Slot[];
  /** Every spec key this shape can write, for the printer's key check. */
  readonly keys: ReadonlySet<string>;
}

const req = (key: string): Slot => ({ kind: "key", key, optional: false });
const opt = (key: string): Slot => ({ kind: "key", key, optional: true });
const NOISE_SHAPE: readonly Slot[] = [opt("opts")];

/**
 * The fns whose text form is not "its `args`, positionally". Checked
 * against the registry in {@link shapes}: the key names here must be
 * exactly the fn's registered `keys`, so this table cannot drift into
 * describing a fn the grammar no longer has.
 */
const SPECIAL_SHAPES: Readonly<Record<string, readonly Slot[]>> = {
  // `constant(3)`, and NOT a bare `3`: see the module doc.
  constant: [req("value")],
  attribute: [req("name"), opt("tupleSize")],
  attributeIs: [req("name"), req("value")],
  byAttribute: [req("name"), req("cases"), req("default")],
  component: [{ kind: "args", arity: 1 }, req("index")],
  ramp: [{ kind: "args", arity: 1 }, req("stops")],
  randomField: [opt("key")],
  randomFrom: [{ kind: "args", arity: 1 }, opt("key")],
  // `base` names a noise fn and prints BARE (`fbm(perlinNoise, …)`), the
  // one position where an identifier is a value rather than a call.
  fbm: [req("base"), opt("opts")],
  param: [req("name"), { kind: "bag", keys: ["value", "min", "max", "description"] }],
  valueNoise: NOISE_SHAPE,
  perlinNoise: NOISE_SHAPE,
  simplexNoise: NOISE_SHAPE,
  worleyNoise: NOISE_SHAPE,
};

/** The one bare-identifier position in the syntax; see {@link SPECIAL_SHAPES}. */
const BARE_NAME_KEY = "base";

function slotKeys(slots: readonly Slot[]): Set<string> {
  const keys = new Set<string>();
  for (const slot of slots) {
    if (slot.kind === "args") keys.add("args");
    else if (slot.kind === "key") keys.add(slot.key);
    else for (const key of slot.keys) keys.add(key);
  }
  return keys;
}

/**
 * The shape of a fn the table says nothing about: its `args` (if it has
 * any) positionally, then whatever other keys it registered, in order.
 * A fn added to the grammar later therefore gets a text form for free
 * rather than an error — and one that matches what its usage sketch shows.
 */
function defaultShape(info: FieldFnInfo): readonly Slot[] {
  const slots: Slot[] = [];
  if (info.keys.includes("args")) {
    const args = info.args ?? [];
    // A trailing `…` in an argument NAME is how the registry marks a
    // repeated position (`vec`'s components); see `FieldFnInfo.args`.
    const variadic = args.some((a) => a.name.endsWith("…"));
    slots.push({ kind: "args", arity: variadic ? "variadic" : args.length });
  }
  for (const key of info.keys) {
    if (key !== "args") slots.push(req(key));
  }
  return slots;
}

let SHAPES: Map<string, Shape> | undefined;

/**
 * Every fn's text shape, built once from the registry.
 *
 * Built lazily rather than at module load so a mismatch surfaces as a
 * thrown error from a call somebody made, not as an import that fails.
 */
function shapes(): Map<string, Shape> {
  if (SHAPES !== undefined) return SHAPES;
  const built = new Map<string, Shape>();
  for (const info of listFieldFnInfos()) {
    const slots = SPECIAL_SHAPES[info.fn] ?? defaultShape(info);
    const keys = slotKeys(slots);
    const registered = new Set(info.keys);
    const missing = [...registered].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !registered.has(k));
    if (missing.length > 0 || extra.length > 0) {
      throw new FieldJsonError(
        `field text: the text shape of fn "${info.fn}" disagrees with its registration` +
          (missing.length > 0 ? `; registered keys it cannot write: ${missing.join(", ")}` : "") +
          (extra.length > 0 ? `; keys it writes that are not registered: ${extra.join(", ")}` : "") +
          ` — registered keys are ${info.keys.join(", ") || "(none)"}; fix SPECIAL_SHAPES in src/fields/fieldText.ts`,
      );
    }
    // A variadic `args` slot swallows every remaining position, so nothing
    // can follow it. Checked rather than assumed: `vec` is the only
    // variadic fn today, and it has no other keys.
    const variadicAt = slots.findIndex((s) => s.kind === "args" && s.arity === "variadic");
    if (variadicAt >= 0 && variadicAt !== slots.length - 1) {
      throw new FieldJsonError(
        `field text: fn "${info.fn}" puts a variadic "args" before another position, which no text form can spell`,
      );
    }
    built.set(info.fn, { fn: info.fn, slots, keys });
  }
  SHAPES = built;
  return built;
}

/** Levenshtein distance, for "did you mean" on an unknown fn name. */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, sub);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] as number;
  }
  return prev[b.length] as number;
}

/** The registered fn names closest to `name`, nearest first, at most three. */
function closestFns(name: string): string[] {
  const lower = name.toLowerCase();
  const limit = Math.max(2, Math.floor(name.length / 3));
  return [...shapes().keys()]
    .map((fn) => ({ fn, d: editDistance(lower, fn.toLowerCase()) }))
    .filter((s) => s.d <= limit)
    .sort((a, b) => a.d - b.d || a.fn.localeCompare(b.fn))
    .slice(0, 3)
    .map((s) => s.fn);
}

/**
 * Names an author reaches for that are not fns, mapped to what they meant.
 *
 * `P` earns its entry: it is the standard position attribute everywhere
 * else in the library, and the sentence that prompted this whole syntax
 * was written `length(P) < 20`. It is deliberately NOT accepted as sugar
 * — `position()` is what the TypeScript API is called and what the
 * printer emits, and a bare `P` meaning a CALL while `attribute("P")`
 * means something spelled differently is the kind of near-synonym that
 * costs more than it saves. So the parser refuses it and the error
 * teaches the spelling instead, which is the trade this file makes
 * everywhere: one way to write a thing, and a message that names it.
 */
const MEANT_INSTEAD = new Map<string, string>([
  ["P", "position()"],
  ["pos", "position()"],
  ["i", "index()"],
  ["u", "fraction()"],
  ["rand", 'randomField("key")'],
  ["random", 'randomField("key")'],
]);

/**
 * `named` means the CALLER already quoted the word, so neither branch
 * below says it a second time — both drop the name, not just the first
 * one. `failBareWord` is the caller that sets it: its sentence opens with
 * `"P" is not a value;`, and a message that repeated the word after that
 * would read `"P" is not a value; unknown field fn "P"`.
 */
function unknownFnMessage(name: string, named = false): string {
  const meant = MEANT_INSTEAD.get(name);
  if (meant !== undefined) {
    return named
      ? `did you mean ${meant}? — the full list is listFieldFns()`
      : `"${name}" is not a field fn; did you mean ${meant}? — the full list is listFieldFns()`;
  }
  const near = closestFns(name);
  const unknown = named ? "unknown field fn" : `unknown field fn "${name}"`;
  return near.length > 0
    ? `${unknown}; closest: ${near.join(", ")} — the full list is listFieldFns()`
    : `${unknown}; the full list is listFieldFns()`;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

function printFail(message: string): never {
  throw new FieldJsonError(`printFieldSpec: ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A number as text that re-parses to the IDENTICAL double.
 * `String` already produces the shortest such spelling for every finite
 * double; the two exceptions it does not cover are handled here — a
 * non-finite number is not in the grammar at all, and `-0` would otherwise
 * print as `0`, which is a different column (see `isSpecNumber`).
 */
function printNumber(n: number): string {
  if (!Number.isFinite(n)) {
    printFail(`the number ${String(n)} is not finite, and the field grammar admits only finite numbers`);
  }
  return Object.is(n, -0) ? "-0" : String(n);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function printKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function describeForPrint(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

/**
 * The spec-valued positions of one node, by object IDENTITY.
 *
 * `specChildEntries` is the single answer to "what hangs off this spec" —
 * `args` entries, `opts.position`, `opts.seed.variant`, `cases` values and
 * `default` — so the printer asks it instead of keeping a second list of
 * the places an expression may appear. Objects reached while printing a
 * node's literal structure are expressions exactly when they are in here,
 * which is also why an `opts` object literal can carry a full expression
 * under `position` without the printer having to know that key by name.
 *
 * Values that are not objects (a raw number in `args`) are skipped: they
 * print as literals, which is what they are.
 */
function specPositions(node: Record<string, unknown>): Map<object, string> {
  const out = new Map<object, string>();
  for (const child of specChildEntries(node)) {
    if (typeof child.value === "object" && child.value !== null && !Array.isArray(child.value)) {
      out.set(child.value, child.path);
    }
  }
  return out;
}

/**
 * A literal, or a nested expression where `specPos` says one belongs.
 *
 * `minPrec` is the precedence the enclosing context binds at, passed
 * straight through to {@link printExpr} when the value turns out to be an
 * expression. It defaults to 0 — no enclosing operator — which is what
 * every literal position (an array element, an object value, a call
 * argument) is; only the two operand positions in {@link printExpr} pass
 * anything else.
 */
function printValue(v: unknown, specPos: Map<object, string>, minPrec = 0): string {
  if (typeof v === "number") return printNumber(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((e) => printValue(e, specPos)).join(", ")}]`;
  if (isPlainObject(v)) {
    const path = specPos.get(v);
    if (path !== undefined) {
      if (typeof v.fn !== "string") {
        printFail(`${path} is a field-expression position but its value has no string "fn" key`);
      }
      return printExpr(v as FieldSpec, minPrec);
    }
    const entries = Object.entries(v);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, val]) => `${printKey(k)}: ${printValue(val, specPos)}`).join(", ")} }`;
  }
  printFail(`cannot print ${describeForPrint(v)}; the field grammar holds numbers, strings, booleans, arrays, objects and specs`);
}

function shapeOf(node: FieldSpec): Shape {
  if (typeof node.fn !== "string") {
    printFail(`a field spec must have a string "fn" key, got ${describeForPrint(node.fn)}`);
  }
  const shape = shapes().get(node.fn);
  if (shape === undefined) printFail(unknownFnMessage(node.fn));
  for (const key of Object.keys(node)) {
    if (key !== "fn" && !shape.keys.has(key)) {
      printFail(
        `unknown key "${key}" for fn "${node.fn}"; allowed keys: ${["fn", ...shape.keys].join(", ")}`,
      );
    }
  }
  return shape;
}

/** One printed positional, and whether the node actually carried it. */
interface Positional {
  readonly text: string;
  readonly present: boolean;
}

function printCall(node: FieldSpec, shape: Shape, specPos: Map<object, string>): string {
  const out: Positional[] = [];
  for (const slot of shape.slots) {
    if (slot.kind === "args") {
      const args = node.args;
      if (!Array.isArray(args)) {
        printFail(`fn "${node.fn}" needs an "args" array, got ${describeForPrint(args)}`);
      }
      if (slot.arity !== "variadic" && args.length !== slot.arity) {
        printFail(
          `fn "${node.fn}" expects exactly ${slot.arity} arg${slot.arity === 1 ? "" : "s"}, got ${args.length}`,
        );
      }
      // Refused rather than printed: `vec()` is text nothing can parse
      // back, and a printer that emits it makes the round trip a lie for
      // one spec the grammar rejects anyway.
      if (slot.arity === "variadic" && args.length < 1) {
        printFail(`fn "${node.fn}" requires at least 1 arg, got 0`);
      }
      for (const a of args) out.push({ text: printValue(a, specPos), present: true });
    } else if (slot.kind === "key") {
      const v = node[slot.key];
      if (v === undefined && !slot.optional) {
        // Same reason as the variadic check above: printed, this would be
        // a call the parser refuses, so the two ends would disagree about
        // a spec instead of both rejecting it.
        printFail(`fn "${node.fn}" requires a "${slot.key}" — usage: ${usageOf(shape)}`);
      }
      if (v === undefined) out.push({ text: "", present: false });
      else if (slot.key === BARE_NAME_KEY && typeof v === "string") {
        // The one identifier-valued position; quoted would also parse, but
        // `fbm(perlinNoise, …)` is how the combinator API reads.
        out.push({ text: IDENTIFIER.test(v) ? v : JSON.stringify(v), present: true });
      } else out.push({ text: printValue(v, specPos), present: true });
    } else {
      const parts = slot.keys
        .filter((k) => node[k] !== undefined)
        .map((k) => `${printKey(k)}: ${printValue(node[k], specPos)}`);
      out.push({ text: `{ ${parts.join(", ")} }`, present: parts.length > 0 });
    }
  }
  // Trailing absences are simply not written; a HOLE is a malformed spec —
  // there is no way to spell "no second argument, but a third".
  let end = out.length;
  while (end > 0 && !(out[end - 1] as Positional).present) end--;
  const written = out.slice(0, end);
  const hole = written.findIndex((p) => !p.present);
  if (hole >= 0) {
    const slot = shape.slots[hole];
    const key = slot?.kind === "key" ? slot.key : "a position";
    printFail(
      `fn "${node.fn}" has no "${key}" but has a later one, and the text form writes positions in order — supply it, or drop what follows it`,
    );
  }
  return `${node.fn}(${written.map((p) => p.text).join(", ")})`;
}

/**
 * `node` as text, parenthesized only where an enclosing operator of
 * precedence `minPrec` would otherwise bind it away.
 */
/** Nesting level {@link printExpr} is currently at; see {@link TOO_DEEP}. */
let printDepth = 0;

function printExpr(node: FieldSpec, minPrec: number): string {
  // Counted in the levels `MAX_SPEC_DEPTH` counts (a leaf is 1), so a spec
  // `fieldFromJson` accepts always prints.
  printDepth++;
  try {
    if (printDepth > MAX_SPEC_DEPTH) printFail(TOO_DEEP);
    const shape = shapeOf(node);
    const specPos = specPositions(node as Record<string, unknown>);
    const op = PRINT_OPS.get(node.fn);
    const args = node.args;
    if (op !== undefined && Array.isArray(args) && args.length === 2) {
      // Left-associative, all of them: the left operand tolerates an equal
      // precedence, the right one does not — which is what keeps the
      // parens in `a - (b - c)` and drops them from `a - b - c`.
      const left = printValue(args[0], specPos, op.prec);
      const right = printValue(args[1], specPos, op.prec + 1);
      const text = `${left} ${op.text} ${right}`;
      return minPrec > op.prec ? `(${text})` : text;
    }
    return printCall(node, shape, specPos);
  } finally {
    printDepth--;
  }
}

/**
 * A field spec as text.
 *
 * The inverse of {@link parseFieldText} on every spec the grammar admits:
 * `parseFieldText(printFieldSpec(spec))` deep-equals `spec`, and printing
 * is idempotent — `printFieldSpec(parseFieldText(text))` returns `text`
 * unchanged for any text this function produced.
 *
 * Throws `FieldJsonError` naming the offending fn, key or value when the
 * spec is one the grammar would reject anyway (an unknown fn, an unknown
 * key, a non-finite number).
 */
export function printFieldSpec(spec: FieldSpec): string {
  if (!isPlainObject(spec)) {
    printFail(`expected a field spec object, got ${describeForPrint(spec)}`);
  }
  return printExpr(spec, 0);
}

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

type TokenKind = "number" | "string" | "name" | "op" | "punct" | "eof";

interface Token {
  readonly kind: TokenKind;
  /** The source text of the token, for the error messages. */
  readonly text: string;
  readonly num?: number;
  readonly str?: string;
  readonly index: number;
  readonly line: number;
  readonly col: number;
}

const PUNCT = ["(", ")", "[", "]", "{", "}", ",", ":"];

function parseFail(tok: Token, message: string): never {
  throw new FieldJsonError(`parseFieldText ${tok.line}:${tok.col}: ${message}`);
}

function describeToken(tok: Token): string {
  return tok.kind === "eof" ? "end of input" : `"${tok.text}"`;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const at = (index: number): { line: number; col: number } => ({ line, col: index - lineStart + 1 });
  const push = (kind: TokenKind, text: string, index: number, extra?: { num?: number; str?: string }): void => {
    const { line: l, col } = at(index);
    out.push({ kind, text, index, line: l, col, ...extra });
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (c === "\n") {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    const start = i;
    // Number: no leading sign — a `-` is always an operator token, and the
    // parser folds it into the literal (see `parseUnary`), so `a - -1`
    // lexes without the lexer having to know what came before it.
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      while (i < src.length && /[0-9]/.test(src[i] as string)) i++;
      if (src[i] === ".") {
        i++;
        while (i < src.length && /[0-9]/.test(src[i] as string)) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        const save = i;
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        if (/[0-9]/.test(src[i] ?? "")) {
          while (i < src.length && /[0-9]/.test(src[i] as string)) i++;
        } else i = save;
      }
      const text = src.slice(start, i);
      push("number", text, start, { num: Number(text) });
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let value = "";
      for (;;) {
        if (i >= src.length || src[i] === "\n") {
          const { line: l, col } = at(start);
          throw new FieldJsonError(
            `parseFieldText ${l}:${col}: unterminated string starting at ${quote}; close it with ${quote}`,
          );
        }
        const ch = src[i] as string;
        if (ch === quote) {
          i++;
          break;
        }
        if (ch === "\\") {
          const esc = src[i + 1] ?? "";
          if (esc === "u") {
            const hex = src.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              const { line: l, col } = at(i);
              throw new FieldJsonError(
                `parseFieldText ${l}:${col}: bad escape "\\u${hex}" in a string; \\u takes four hex digits`,
              );
            }
            value += String.fromCharCode(Number.parseInt(hex, 16));
            i += 6;
            continue;
          }
          const mapped = ESCAPES[esc];
          if (mapped === undefined) {
            const { line: l, col } = at(i);
            throw new FieldJsonError(
              `parseFieldText ${l}:${col}: unknown escape "\\${esc}" in a string; valid escapes are \\" \\' \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX`,
            );
          }
          value += mapped;
          i += 2;
          continue;
        }
        value += ch;
        i++;
      }
      push("string", src.slice(start, i), start, { str: value });
      continue;
    }
    if (IDENTIFIER.test(c)) {
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i] as string)) i++;
      push("name", src.slice(start, i), start);
      continue;
    }
    const op = INFIX.find((o) => src.startsWith(o.text, i));
    if (op !== undefined) {
      i += op.text.length;
      push("op", op.text, start);
      continue;
    }
    if (PUNCT.includes(c)) {
      i++;
      push("punct", c, start);
      continue;
    }
    const { line: l, col } = at(start);
    // `=` and `&`/`|` alone are the near-misses worth naming: they are what
    // a hand reaching for `==`, `&&` or `||` actually types.
    const hint =
      c === "=" ? ` — did you mean "=="?` : c === "&" ? ` — did you mean "&&"?` : c === "|" ? ` — did you mean "||"?` : "";
    throw new FieldJsonError(
      `parseFieldText ${l}:${col}: unexpected character "${c}"${hint}`,
    );
  }
  const { line: endLine, col: endCol } = at(i);
  out.push({ kind: "eof", text: "", index: i, line: endLine, col: endCol });
  return out;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * A bare identifier that is not a call. Legal in exactly one position —
 * `fbm`'s `base` — and a mistake everywhere else, where it is nearly
 * always a call missing its parentheses. Carried as a marker rather than
 * silently becoming a string so the error can say which it was.
 */
interface Word {
  readonly word: string;
  readonly tok: Token;
}

const WORD = Symbol("pcg-ts.fieldText.word");

function isWord(v: unknown): v is Word & { [WORD]: true } {
  return typeof v === "object" && v !== null && WORD in v;
}

function makeWord(word: string, tok: Token): unknown {
  return { [WORD]: true, word, tok };
}

/** Assign safely, so a case key of `__proto__` becomes an own property. */
function setKey(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

class Parser {
  private pos = 0;
  /** Sub-expression nesting reached so far; see {@link TOO_DEEP}. */
  private depth = 0;

  private readonly toks: Token[];

  // NOT a parameter property. This file is loaded as SOURCE by a child
  // process in `src/cli/render.test.ts`, which strips types rather than
  // compiling them, and a parameter property EMITS code instead of only
  // erasing a type — node refuses it with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private peek(): Token {
    return this.toks[this.pos] as Token;
  }

  private next(): Token {
    const t = this.toks[this.pos] as Token;
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private eat(kind: TokenKind, text: string): boolean {
    const t = this.peek();
    if (t.kind === kind && t.text === text) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(kind: TokenKind, text: string, what: string): Token {
    const t = this.peek();
    if (t.kind !== kind || t.text !== text) {
      parseFail(t, `expected "${text}" ${what}, got ${describeToken(t)}`);
    }
    return this.next();
  }

  /** The whole text: one expression, then nothing. */
  parseProgram(): FieldSpec {
    const first = this.peek();
    if (first.kind === "eof") {
      parseFail(first, "the field text is empty; write an expression such as position() or attribute(\"density\") * 2");
    }
    const value = this.parseExpr(0);
    const rest = this.peek();
    if (rest.kind !== "eof") {
      parseFail(rest, `unexpected ${describeToken(rest)} after the expression; one expression per field text`);
    }
    if (isWord(value)) this.failBareWord(value);
    if (!isPlainObject(value)) {
      parseFail(
        first,
        `a field expression must be a constructor call or an operator expression, and ${describeForPrint(value)} is a plain value — wrap it as constant(${first.text}) or combine it, as in position() * ${first.text}`,
      );
    }
    return value as FieldSpec;
  }

  private failBareWord(w: Word): never {
    const known = shapes().has(w.word);
    parseFail(
      w.tok,
      known
        ? `"${w.word}" is a field constructor, not a value; call it as ${w.word}()`
        : `"${w.word}" is not a value; ${unknownFnMessage(w.word, true)}`,
    );
  }

  private parseExpr(minPrec: number): unknown {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "op") break;
      const op = INFIX.find((o) => o.text === t.text);
      if (op === undefined || op.prec < minPrec) break;
      this.next();
      if (isWord(left)) this.failBareWord(left);
      // Left-associative: the right operand must bind tighter, so it is
      // parsed at one level up. Right-associating here is what would make
      // `a - b - c` mean `a - (b - c)`.
      const right = this.parseExpr(op.prec + 1);
      if (isWord(right)) this.failBareWord(right);
      const spec: Record<string, unknown> = { fn: op.fn, args: [left, right] };
      left = spec;
    }
    return left;
  }

  /**
   * Every recursive descent in this parser passes through here — a
   * parenthesized group, an array element, an object value and a call
   * argument all reach a sub-expression via `parseExpr` → `parseUnary` —
   * so this is the one place the nesting bound has to be enforced.
   */
  private parseUnary(): unknown {
    this.depth++;
    try {
      if (this.depth > MAX_SPEC_DEPTH) parseFail(this.peek(), TOO_DEEP);
      return this.parseUnaryInner();
    } finally {
      this.depth--;
    }
  }

  private parseUnaryInner(): unknown {
    const t = this.peek();
    if (t.kind === "op" && t.text === "-") {
      this.next();
      const operand = this.parseUnary();
      if (typeof operand === "number") return -operand;
      if (isWord(operand)) this.failBareWord(operand);
      if (!isPlainObject(operand)) {
        parseFail(t, `unary "-" takes a number or an expression, not ${describeForPrint(operand)}`);
      }
      // Input-only sugar, exactly as `&&` is: there is no negate fn in the
      // grammar, and this prints back as `0 - x`.
      return { fn: "sub", args: [0, operand] };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const t = this.next();
    if (t.kind === "number") return t.num as number;
    if (t.kind === "string") return t.str as string;
    if (t.kind === "punct" && t.text === "(") {
      const inner = this.parseExpr(0);
      this.expect("punct", ")", `to close the group opened at ${t.line}:${t.col}`);
      return inner;
    }
    if (t.kind === "punct" && t.text === "[") return this.parseArray(t);
    if (t.kind === "punct" && t.text === "{") return this.parseObject(t);
    if (t.kind === "name") {
      if (t.text === "true") return true;
      if (t.text === "false") return false;
      if (this.eat("punct", "(")) return this.parseCall(t);
      return makeWord(t.text, t);
    }
    parseFail(
      t,
      `unexpected ${describeToken(t)}; expected a value here — a number, a string, "[", "{", "(", or a constructor call such as position()`,
    );
  }

  private parseArray(open: Token): unknown[] {
    const out: unknown[] = [];
    if (this.eat("punct", "]")) return out;
    for (;;) {
      const value = this.parseExpr(0);
      if (isWord(value)) this.failBareWord(value);
      out.push(value);
      if (this.eat("punct", ",")) {
        if (this.eat("punct", "]")) return out;
        continue;
      }
      this.expect("punct", "]", `to close the array opened at ${open.line}:${open.col}`);
      return out;
    }
  }

  private parseObject(open: Token): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this.eat("punct", "}")) return out;
    for (;;) {
      const keyTok = this.next();
      let key: string;
      if (keyTok.kind === "name") key = keyTok.text;
      else if (keyTok.kind === "string") key = keyTok.str as string;
      else {
        parseFail(
          keyTok,
          `expected an object key, got ${describeToken(keyTok)}; a key is a name or a quoted string, as in { frequency: 0.05 }`,
        );
      }
      if (Object.hasOwn(out, key)) {
        parseFail(keyTok, `duplicate key "${key}" in this object literal`);
      }
      this.expect("punct", ":", `after the key "${key}"`);
      const value = this.parseExpr(0);
      if (isWord(value)) this.failBareWord(value);
      setKey(out, key, value);
      if (this.eat("punct", ",")) {
        if (this.eat("punct", "}")) return out;
        continue;
      }
      this.expect("punct", "}", `to close the object opened at ${open.line}:${open.col}`);
      return out;
    }
  }

  /** `name(` already consumed; read the arguments and map them to keys. */
  private parseCall(nameTok: Token): Record<string, unknown> {
    const shape = shapes().get(nameTok.text);
    if (shape === undefined) parseFail(nameTok, unknownFnMessage(nameTok.text));
    const values: { value: unknown; tok: Token }[] = [];
    const closing = `to close the call to "${nameTok.text}" opened at ${nameTok.line}:${nameTok.col}`;
    if (!this.eat("punct", ")")) {
      for (;;) {
        const tok = this.peek();
        const value = this.parseExpr(0);
        values.push({ value, tok });
        if (this.eat("punct", ",")) {
          if (this.eat("punct", ")")) break;
          continue;
        }
        this.expect("punct", ")", closing);
        break;
      }
    }
    // Every path out of the region above consumed the `)` — the empty
    // call, the trailing comma, and `expect`, which throws otherwise — so
    // the token just read IS the close, and there is no path on which it
    // has to be tracked as the loop goes.
    const close = this.toks[this.pos - 1] as Token;
    return this.assignSlots(nameTok, close, shape, values);
  }

  private assignSlots(
    nameTok: Token,
    closeTok: Token,
    shape: Shape,
    values: readonly { value: unknown; tok: Token }[],
  ): Record<string, unknown> {
    const spec: Record<string, unknown> = { fn: shape.fn };
    let i = 0;
    // Reported at the `)` that closed the call too early — that is the
    // token in the wrong place — while still naming where the call opened,
    // which is the only thing that locates it in a long expression.
    const shortfall = (need: string): never =>
      parseFail(
        closeTok,
        `fn "${shape.fn}" needs ${need}, got ${values.length} argument${values.length === 1 ? "" : "s"} in the call opened at ${nameTok.line}:${nameTok.col} — usage: ${usageOf(shape)}`,
      );
    for (const slot of shape.slots) {
      if (slot.kind === "args") {
        const take = slot.arity === "variadic" ? values.length - i : slot.arity;
        if (slot.arity === "variadic" && take < 1) {
          shortfall("at least one argument");
        }
        if (i + take > values.length) {
          shortfall(`${String(slot.arity)} argument${slot.arity === 1 ? "" : "s"}`);
        }
        spec.args = values.slice(i, i + take).map((v) => {
          if (isWord(v.value)) this.failBareWord(v.value);
          return v.value;
        });
        i += take;
      } else if (slot.kind === "key") {
        const got = values[i];
        if (got === undefined) {
          if (!slot.optional) shortfall(`a "${slot.key}"`);
          continue;
        }
        i++;
        if (isWord(got.value)) {
          if (slot.key === BARE_NAME_KEY) setKey(spec, slot.key, got.value.word);
          else this.failBareWord(got.value);
        } else setKey(spec, slot.key, got.value);
      } else {
        const got = values[i];
        if (got === undefined) continue;
        i++;
        if (!isPlainObject(got.value) || isWord(got.value)) {
          parseFail(
            got.tok,
            `fn "${shape.fn}" takes its ${slot.keys.join("/")} as one object, as in ${shape.fn}("name", { ${slot.keys[0] as string}: 1 })`,
          );
        }
        for (const [key, value] of Object.entries(got.value)) {
          if (!slot.keys.includes(key)) {
            parseFail(
              got.tok,
              `unknown key "${key}" for fn "${shape.fn}"; allowed keys in this object: ${slot.keys.join(", ")}`,
            );
          }
          setKey(spec, key, value);
        }
      }
    }
    if (i < values.length) {
      parseFail(
        (values[i] as { tok: Token }).tok,
        `fn "${shape.fn}" takes at most ${i} argument${i === 1 ? "" : "s"}, got ${values.length} — usage: ${usageOf(shape)}`,
      );
    }
    return spec;
  }
}

/** A one-line usage sketch in the TEXT syntax, from the fn's shape. */
function usageOf(shape: Shape): string {
  const parts = shape.slots.flatMap((slot) => {
    if (slot.kind === "args") {
      return slot.arity === "variadic"
        ? ["arg…"]
        : Array.from({ length: slot.arity }, (_v, n) => `arg${n}`);
    }
    if (slot.kind === "key") return [slot.optional ? `${slot.key}?` : slot.key];
    return [`{ ${slot.keys.map((k) => `${k}?`).join(", ")} }`];
  });
  return `${shape.fn}(${parts.join(", ")})`;
}

/**
 * A field expression written as text, as the spec tree it describes.
 *
 * The syntax reads like the TypeScript combinator API: `attribute("y") *
 * 2 + 1`, `select(randomField() < 0.3, 1, 0)`,
 * `perlinNoise({ frequency: 0.05 })`. `mul`, `add`, `sub`, `div` and the
 * six comparisons may be written infix with JavaScript's precedence, and
 * `&&` / `||` are accepted as input-only sugar for `mul` and `max` — the
 * grammar has no boolean type, so a conjunction of predicates IS their
 * product. {@link printFieldSpec} prints those back as `*` and `max(…)`.
 *
 * A bare number or number tuple in an argument position stays the raw
 * argument form the grammar admits; `constant(3)` builds the explicit
 * node. They evaluate alike and are different trees, so text preserves
 * whichever was written.
 *
 * Throws `FieldJsonError` on a syntax error, naming the offending token,
 * its `line:column`, and the valid alternatives or the fix. The result is
 * a spec, not a field: hand it to `fieldFromJson` to build one, which is
 * also what checks the arguments' types and ranges.
 */
export function parseFieldText(text: string): FieldSpec {
  return new Parser(tokenize(text)).parseProgram();
}
