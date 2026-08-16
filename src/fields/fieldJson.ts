/**
 * Declarative field expressions as JSON, so serialized graphs can carry
 * field-valued params. A FieldSpec names a field constructor (`fn`) plus
 * its arguments; `fieldFromJson` builds the equivalent Field and attaches
 * the original spec so `fieldToJson` can serialize it back losslessly.
 *
 * Spec forms (args entries may be nested specs, numbers, or number
 * arrays — plain values wrap into `constant`):
 * - `{ fn: "constant", value: 1 | [1, 2, 3] }`
 * - `{ fn: "attribute", name: "density", tupleSize?: 1 }`
 * - `{ fn: "attributeIs", name: "species", value: "pine" }` — 1 where the
 *   STRING attribute equals the literal, 0 elsewhere; a literal the
 *   geometry's string table does not hold is all zeros rather than an
 *   error (see {@link attributeIs})
 * - `{ fn: "byAttribute", name: "part", cases: { "rod": 1, "panel": [1, 0.7, 1] },
 *   default: 1 }` — the N-way form: the case whose KEY equals the string
 *   attribute's value, or `default` where none does. Case values are full
 *   argument positions (spec, number, or tuple) and broadcast against each
 *   other like any other combinator's. The `default` is REQUIRED — naming
 *   the fall-through is the point of the fn — and a case key the
 *   geometry's table does not hold matches nothing and takes it, for the
 *   same partition-independence reason {@link attributeIs} yields zeros
 * - `{ fn: "position" }` / `{ fn: "index" }`
 * - `{ fn: "fraction" }` — normalized index, `index / (count - 1)`:
 *   exactly 0 on the first element and exactly 1 on the last (a lone
 *   element gives 0)
 * - `{ fn: "nodeSeed" }` — the cooking node's own seed (`ctx.seed`), the
 *   same number `randomField` hashes, constant over the domain. To make a
 *   saved noise re-roll with the graph seed, write
 *   `opts.seed: {from: "node", variant: N}` rather than folding this into
 *   `opts.position`; the fold is what older graphs contain (see
 *   {@link nodeSeed})
 * - `{ fn: "randomField", key?: 0 | "salt" }`
 * - `{ fn: "param", name: "amplitude", value?: 0.5, min?: 0, max?: 4,
 *   description?: "..." }` — the value bound to that name, substituted at
 *   build time as if the literal had been written; a binding may also be a
 *   `Field`, and is then spliced in where the reference stands (see
 *   {@link fieldFromJson}'s `bindings`). The optional `value` is the spec's
 *   OWN fallback, taken when nothing binds the name — which is what makes a
 *   plain node's expression tunable without a subgraph wrapped around it
 *   purely to carry the number. `min`/`max`/`description` describe that
 *   value the way a `ParamSchema` describes a node param, and are read by
 *   {@link inlineParamMetaOf} (see it for why they live in the graph)
 * - `{ fn: "add", args: [a, b] }` — likewise sub, mul, div, min, max,
 *   lt, le, gt, ge, eq, ne, dot, atan2 (2 args); abs, floor, length,
 *   normalize, sin, cos, tan, asin, acos, atan (1 arg); clamp, lerp,
 *   select (3); remap (5); vec (1+)
 * - `{ fn: "component", args: [a], index: 0 }`
 * - `{ fn: "ramp", args: [a], stops: [[0, 0], [1, 1]] }`
 * - `{ fn: "valueNoise" | "perlinNoise" | "simplexNoise", opts?: { seed?,
 *   frequency?, offset?: [x,y,z], position?: spec, normalized?: false } }`
 * - `{ fn: "worleyNoise", opts?: { ...noise opts, output?: "f1" | "f2" | "f2-f1",
 *   exact?: false } }`
 * - `{ fn: "fbm", base: "perlinNoise", opts?: { ...noise opts, octaves?,
 *   lacunarity?, gain? } }`
 *
 * `opts.seed` is an integer, or `{ from: "node", variant: 3 }` — the one
 * non-numeric form, resolving to `hashCombine(the cooking node's seed,
 * variant)` in u32 integer math, so a SAVED noise re-rolls with the
 * graph's seed box instead of only its scatters moving. `variant` picks
 * which independent draw off that node and may itself be an inline
 * `param` (an integer knob, and the only spec admitted there). Every
 * other noise option is a literal; `position` is the one that takes a
 * field, and it is also how a per-element FREQUENCY is written —
 * `{"position": mul(<pos>, F), "frequency": 1}` samples the same point.
 *
 * It lives in `src/fields` because a parsed spec IS a field, and nothing
 * about it is a node. The cost is that naming the noises means importing
 * `src/noise`, which is itself built on `src/fields` — so the two
 * directories reference each other. That stays acyclic because the edge
 * lands on modules that never come back: `src/fields/index.ts` does not
 * re-export this file (the package publishes it through
 * `src/nodes/index.ts`), so nothing `src/noise` imports can reach the
 * grammar.
 */
import {
  type Field,
  type FieldLike,
  abs,
  acos,
  add,
  asin,
  atan,
  atan2,
  attribute,
  attributeIs,
  byAttribute,
  clamp,
  component,
  constant,
  cos,
  div,
  dot,
  eq,
  evaluateField,
  floor,
  fraction,
  ge,
  gt,
  index,
  isField,
  le,
  length,
  lerp,
  lt,
  makeField,
  max,
  min,
  mul,
  ne,
  nodeSeed,
  normalize,
  position,
  ramp,
  randomField,
  remap,
  select,
  sin,
  sub,
  tan,
  vec,
} from "./index.js";
import {
  type FieldBindingValue,
  type FieldSpec,
  MAX_SPEC_DEPTH,
  attachAuthoredSpec,
  attachOpaqueParam,
  attachParamSpec,
  attachParamValue,
  attachSpec,
  carrySpec,
  isDerivedSpec,
  paramSpecOf,
  peekFieldSpec,
  recordSplicedProvenance,
  recordWithheld,
  specChildren,
  splicedProvenance,
  withheldOver,
  withheldReason,
} from "./spec.js";
import { NOISE_BASES, WORLEY_OUTPUTS } from "../noise/bases.js";
import {
  type FbmOpts,
  type NodeSeedRef,
  type NoiseOpts,
  type WorleyNoiseOpts,
  fbm,
  worleyNoise,
} from "../noise/index.js";
// By path, not through `src/noise/index.ts`: the range bound and the
// discriminator are the parser's business, not the package's surface.
import { MAX_SEED_VARIANT } from "../noise/util.js";

/** Errors raised while converting fields to or from JSON specs. */
export class FieldJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldJsonError";
  }
}

// The spec type and its accessors live beside this module in `spec.ts`,
// which the field constructors import to derive specs from their inputs'
// specs — a module the grammar can depend on without depending on the
// grammar. Re-exported here unchanged: this module is still where the
// public spec API is documented and imported from.
export { type FieldBindingValue, type FieldSpec, type FieldSpecArg, getFieldSpec } from "./spec.js";

/**
 * Whether a fn introduces per-element variation OF ITS OWN: `"per-element"`
 * for the ones whose value can differ between two elements of the same
 * domain (the leaves that read an element — position, index, fraction, an
 * attribute, a per-element draw — and the noises, which sample one), and
 * `"uniform"` for the ones that only combine what they are given.
 *
 * Read by the domain-constant fold in `fold.ts`, which evaluates a
 * subexpression once instead of once per element when its own fn
 * introduces no variation and every argument is likewise uniform. That is
 * why it is a property of the fn and not of a call: the classification is
 * what licenses evaluating the expression against a one-element geometry,
 * so it must be answerable without looking at what it computes over.
 */
export type FnVariation = "per-element" | "uniform";

interface FnDef {
  /** Spec keys allowed besides `fn`. */
  readonly keys: readonly string[];
  /**
   * REQUIRED, and required rather than defaulted on purpose: a default
   * would silently classify the next fn somebody registers, and if the
   * default were "uniform" that is a wrong answer no test asks about —
   * a field folded to one value for a whole domain. See
   * {@link FnVariation}, and the completeness test in fieldJson.test.ts.
   */
  readonly variation: FnVariation;
  /** Usage sketch shown in errors. */
  readonly usage: string;
  build(spec: Record<string, unknown>, path: string): Field;
}

const FNS = new Map<string, FnDef>();

function fail(path: string, message: string): never {
  throw new FieldJsonError(`${path}: ${message}`);
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Build a Field from an argument position (spec | number | number[]). */
function buildArg(v: unknown, path: string): Field {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail(path, "numbers must be finite");
    return constant(v);
  }
  if (isNumberArray(v)) return constant(v);
  if (isPlainObject(v)) return buildSpec(v, path);
  fail(path, `expected a field spec, number, or number array, got ${describeValue(v)}`);
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

function checkKeys(spec: Record<string, unknown>, def: FnDef, path: string): void {
  const allowed = new Set<string>(["fn", ...def.keys]);
  for (const key of Object.keys(spec)) {
    if (!allowed.has(key)) {
      fail(
        path,
        `unknown key "${key}" for fn "${String(spec.fn)}"; allowed keys: ${[...allowed].join(", ")} — usage: ${def.usage}`,
      );
    }
  }
}

function requireArgs(spec: Record<string, unknown>, path: string, arity: number | "variadic"): unknown[] {
  const args = spec.args;
  if (!Array.isArray(args)) {
    fail(path, `fn "${String(spec.fn)}" requires an "args" array`);
  }
  if (arity === "variadic") {
    if (args.length < 1) fail(path, `fn "${String(spec.fn)}" requires at least 1 arg, got 0`);
  } else if (args.length !== arity) {
    fail(path, `fn "${String(spec.fn)}" expects exactly ${arity} arg${arity === 1 ? "" : "s"}, got ${args.length}`);
  }
  return args;
}

/** Spec objects currently being built, for cycle detection (see buildSpec). */
const inProgress = new Set<object>();

/**
 * Deepest nesting level reached by the current `fieldFromJson` call — the
 * authored spec's own depth, handed to `attachAuthoredSpec` so that
 * constructors building on top of the field keep counting from where the
 * author's tree ended. Measured here because `buildSpec` already walks
 * exactly the levels {@link MAX_SPEC_DEPTH} counts.
 */
let deepestLevel = 0;

function buildSpec(spec: Record<string, unknown>, path: string): Field {
  if (inProgress.has(spec)) {
    fail(path, "cyclic field spec: this spec object contains itself (directly or through its args)");
  }
  const level = inProgress.size + 1;
  if (level > MAX_SPEC_DEPTH) {
    fail(path, `field spec nesting deeper than ${MAX_SPEC_DEPTH} levels; flatten the expression`);
  }
  if (level > deepestLevel) deepestLevel = level;
  inProgress.add(spec);
  try {
    const fn = spec.fn;
    if (typeof fn !== "string") {
      fail(path, `spec must have a string "fn" key; valid fns: ${listFieldFns().join(", ")}`);
    }
    const def = FNS.get(fn);
    if (!def) {
      fail(path, `unknown field fn "${fn}"; valid fns: ${listFieldFns().join(", ")}`);
    }
    checkKeys(spec, def, path);
    return def.build(spec, path);
  } finally {
    inProgress.delete(spec);
  }
}

function register(
  name: string,
  variation: FnVariation,
  keys: readonly string[],
  usage: string,
  build: FnDef["build"],
): void {
  FNS.set(name, { keys, variation, usage, build });
}

/**
 * `variation` is named at every call site rather than assumed from the
 * shape: an elementwise combinator over its arguments is uniform, but
 * nothing about "fixed arity" says so, and a per-element fn registered
 * through here would otherwise inherit a classification nobody chose.
 */
function registerFixed(
  name: string,
  variation: FnVariation,
  arity: number,
  make: (fields: Field[]) => Field,
): void {
  const argNames = Array.from({ length: arity }, (_, i) => `arg${i}`).join(", ");
  register(name, variation, ["args"], `{ fn: "${name}", args: [${argNames}] }`, (spec, path) => {
    const args = requireArgs(spec, path, arity);
    return make(args.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
  });
}

/**
 * @internal How a registered fn varies across a domain, or undefined for
 * a name the grammar does not know. The fold in `fold.ts` treats an
 * unknown name the way it treats a per-element one — it can only fold
 * what the registry vouches for.
 */
export function fnVariation(fn: string): FnVariation | undefined {
  return FNS.get(fn)?.variation;
}

// -- inputs ----------------------------------------------------------------

register("constant", "uniform", ["value"], `{ fn: "constant", value: 1 | [1, 2, 3] }`, (spec, path) => {
  const v = spec.value;
  if (typeof v === "number" && Number.isFinite(v)) return constant(v);
  if (isNumberArray(v)) return constant(v);
  fail(`${path}.value`, "constant requires a finite number or non-empty number array");
});

register(
  "attribute",
  "per-element",
  ["name", "tupleSize"],
  `{ fn: "attribute", name: "density", tupleSize?: 1 }`,
  (spec, path) => {
    if (typeof spec.name !== "string" || spec.name === "") {
      fail(`${path}.name`, "attribute requires a non-empty string name");
    }
    if (spec.tupleSize === undefined) return attribute(spec.name);
    if (typeof spec.tupleSize !== "number" || !Number.isInteger(spec.tupleSize) || spec.tupleSize < 1) {
      fail(`${path}.tupleSize`, "tupleSize must be a positive integer");
    }
    return attribute(spec.name, spec.tupleSize);
  },
);

// Per-element like `attribute`, and for the same reason: it reads a
// column. The value it compares against is fixed, but which elements
// match is not.
register(
  "attributeIs",
  "per-element",
  ["name", "value"],
  `{ fn: "attributeIs", name: "species", value: "pine" }`,
  (spec, path) => {
    if (typeof spec.name !== "string" || spec.name === "") {
      fail(`${path}.name`, "attributeIs requires a non-empty string name");
    }
    // The empty string is a legal literal (it is the default entry every
    // string table interns at index 0), so only the TYPE is checked here.
    if (typeof spec.value !== "string") {
      fail(
        `${path}.value`,
        `attributeIs requires a string value; to compare a numeric attribute write { fn: "eq", args: [{ fn: "attribute", name: "${spec.name}" }, <number>] }`,
      );
    }
    return attributeIs(spec.name, spec.value);
  },
);

// Per-element for the same reason `attributeIs` is, and the reason is
// stronger here rather than weaker: even when every case VALUE is uniform,
// which case fires is read from a column, so two elements of one domain
// can differ.
register(
  "byAttribute",
  "per-element",
  ["name", "cases", "default"],
  `{ fn: "byAttribute", name: "part", cases: { "rod": 1, "panel": [1, 0.7, 1] }, default: 1 }`,
  (spec, path) => {
    if (typeof spec.name !== "string" || spec.name === "") {
      fail(`${path}.name`, "byAttribute requires a non-empty string name");
    }
    if (!isPlainObject(spec.cases)) {
      fail(
        `${path}.cases`,
        `byAttribute requires a "cases" object keyed by the string values of ${JSON.stringify(spec.name)}, got ${describeValue(spec.cases)}`,
      );
    }
    const keys = Object.keys(spec.cases);
    if (keys.length === 0) {
      fail(
        `${path}.cases`,
        "byAttribute requires at least one case; a case set with no cases is its default written the long way",
      );
    }
    // Required, and the message says why rather than only reporting the
    // missing key: an unnamed fall-through is the defect this fn exists to
    // remove, so defaulting it here would reinstate the defect one level
    // down, under a value nobody wrote.
    if (spec.default === undefined) {
      fail(
        `${path}.default`,
        `byAttribute requires a "default": an element whose ${JSON.stringify(spec.name)} matches no case has to ` +
          "resolve to something, and naming it here is the point of this fn — write a number, a " +
          "tuple, or a spec, or add a case for every value you expect. Note that a case key this " +
          "geometry's string table does not hold matches nothing and takes the default, so the " +
          "default is reachable even when every value you expect has a case",
      );
    }
    // Null-prototype, because a case key is an author's string and
    // `"__proto__"` is among the strings they may write. `JSON.parse`
    // creates a real own property for it, but assigning it onto a PLAIN
    // object runs `Object.prototype`'s setter instead, so the case would
    // vanish here while the GPU compiler — which reads `Object.keys` off
    // the raw spec — still allocated a slot for it. That is a silent
    // CPU/GPU disagreement in the one place this fn promises exactness.
    // Same reasoning, same fix as `foldOnce` in `./fold.ts`.
    const cases: Record<string, Field> = Object.create(null) as Record<string, Field>;
    for (const k of keys) {
      cases[k] = buildArg(spec.cases[k], `${path}.cases[${JSON.stringify(k)}]`);
    }
    return byAttribute(spec.name, cases, buildArg(spec.default, `${path}.default`));
  },
);

/**
 * A private copy of a leaf field the library hands out as a process-wide
 * singleton (`position()`, `index()`).
 *
 * `fieldFromJson` stamps an AUTHORED spec on whatever it built, and
 * provenance is what device eligibility turns on. Handing back the
 * singleton would therefore stamp it: one `fieldFromJson({fn:"position"})`
 * anywhere in a process would make EVERY later `position()` look authored
 * — device eligibility would depend on module load order, which is not a
 * property a deterministic library may have.
 *
 * The copy is indistinguishable in everything the library keys on: same
 * `key`, same `tupleSize`, and evaluation delegates through
 * `evaluateField`, so within one context it shares the singleton's
 * memoized column rather than recomputing it — the same bytes, the same
 * object. It carries the same derived spec, so a copy nested inside a
 * larger expression composes exactly as the singleton would.
 */
function detachedLeaf<N extends number>(shared: Field<N>, spec: FieldSpec): Field<N> {
  const copy = makeField<N>(shared.key, shared.tupleSize, (ctx) => evaluateField(shared, ctx));
  attachSpec(copy, spec, 1);
  return copy;
}

register("position", "per-element", [], `{ fn: "position" }`, () =>
  detachedLeaf(position(), { fn: "position" }),
);
register("index", "per-element", [], `{ fn: "index" }`, () =>
  detachedLeaf(index(), { fn: "index" }),
);
register("fraction", "per-element", [], `{ fn: "fraction" }`, () =>
  detachedLeaf(fraction(), { fn: "fraction" }),
);
// UNIFORM, and the only leaf that is: the node seed is one number for the
// whole cook, which is exactly what makes the seed-shift idiom built on it
// worth folding.
register("nodeSeed", "uniform", [], `{ fn: "nodeSeed" }`, () =>
  detachedLeaf(nodeSeed(), { fn: "nodeSeed" }),
);

/**
 * Bindings for the `fieldFromJson` call currently building, read by the
 * `param` handler. Module state for the same reason {@link deepestLevel}
 * is: `FnDef.build` takes a spec and a path, and threading a bindings
 * argument through every one of the ~45 constructors to serve one of them
 * would put the feature in every signature in the file.
 */
let currentBindings: FieldBindings | undefined;

/**
 * A private stand-in for a field bound to a `param` name, for exactly the
 * reason {@link detachedLeaf} makes one for a shared singleton: this call
 * ends by STAMPING its authored spec on whatever it built, and when the
 * whole spec is one bare `{fn: "param"}` the thing it built is the
 * caller's own field. Handing it back would overwrite that field's spec
 * with the REFERENCE — so `fieldToJson` on the caller's field would
 * return `{fn: "param", name}`, a spec that reloads as an unbound param
 * and refuses to evaluate. The value a caller holds must not be edited by
 * being read.
 *
 * Indistinguishable in everything the library keys on: same `key` (so the
 * composed key is the same string either way), same `tupleSize`, the same
 * spec object carried across unchanged (so composition structure-shares
 * it and its provenance is untouched), and evaluation delegates through
 * `evaluateField`, which memoizes per context — so several references to
 * one name share the bound field's column rather than recomputing it.
 */
/**
 * The value a bound field stands for when its whole spec is one
 * `constant`, or undefined when it is a real expression. Copied for the
 * same reason a tuple binding is: the record must be as immutable as the
 * key computed from it.
 */
function constantSpecValue(spec: FieldSpec): number | readonly number[] | undefined {
  if (spec.fn !== "constant") return undefined;
  const v = spec.value;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isNumberArray(v)) return [...v];
  return undefined;
}

function detachedBinding(bound: Field): Field {
  const copy = makeField(bound.key, bound.tupleSize, (ctx) => evaluateField(bound, ctx));
  const spec = peekFieldSpec(bound);
  if (spec === undefined) recordWithheld(copy, withheldOver(bound));
  else carrySpec(copy, spec);
  return copy;
}

/**
 * The refusal an UNBOUND `param` evaluates to. Buildable but not
 * evaluable is the point: the structural key and the WGSL kernel need
 * only the name (the GPU lowers a param to a uniform slot, so it compiles
 * the same expression whatever the value), while producing a COLUMN
 * needs the value and there is none.
 */
function unboundParam(name: string): Field {
  const quoted = JSON.stringify(name);
  return makeField(`param(${quoted})`, undefined, () => {
    throw new FieldJsonError(
      `param ${quoted}: nothing bound this name, so the field has no value to evaluate. ` +
        `Build it with fieldFromJson(spec, { ${JSON.stringify(name)}: <number | number[] | Field> }); ` +
        "an unbound param is buildable — its key and its GPU kernel need only the name — but never evaluable",
    );
  });
}

/**
 * Whether the build in flight must IGNORE the inline value a `param` node
 * carries. Module state for the same reason {@link currentBindings} is,
 * and read at exactly one place — see {@link fieldFromJsonValueFree} for
 * the one caller that needs it and why nothing else does.
 */
let ignoreInlineValues = false;

/**
 * A `param` node's inline value, or undefined when it carries none. Total:
 * it reads, it does not validate, so the stamping walk in
 * {@link fieldFromJson} can ask the same question of an already-parsed
 * node without a path to blame.
 *
 * The tuple is COPIED for the reason a binding's is (see the stamping walk
 * in {@link fieldFromJson}): the field's key is fixed from these numbers at
 * construction, and a spec object a caller still holds a reference to must
 * not be able to move them afterwards.
 */
function readInlineValue(v: unknown): FieldBindingValue | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isNumberArray(v)) return [...v];
  return undefined;
}

/**
 * The validating half of {@link readInlineValue}: the same value, but a
 * `value` key the grammar cannot read is a hard error naming the path
 * rather than a silently ignored key.
 *
 * The admitted shapes are `constant`'s, because that is what an inline
 * value IS — the literal an author would otherwise have written in this
 * position, moved inside the reference so the name survives for a binder
 * to override.
 */
function inlineParamValue(
  spec: Record<string, unknown>,
  path: string,
): FieldBindingValue | undefined {
  if (spec.value === undefined) return undefined;
  const value = readInlineValue(spec.value);
  if (value !== undefined) return value;
  fail(
    `${path}.value`,
    `param ${JSON.stringify(spec.name)}: an inline value must be a finite number (which stands as a ` +
      "scalar) or a non-empty array of finite numbers (which stands as the matching vector) — the same " +
      "shapes a binding takes; omit the key entirely for a param that only a binder supplies",
  );
}

/**
 * The presentation metadata an inline `param` may carry beside its value:
 * the subset of `ParamSchema` (`src/graph/params.ts`) that means anything
 * for a named literal inside an expression.
 *
 * `type` and `default` are not here because the value already answers both
 * — its shape picks the widget and it IS the default. `step` is not here
 * because `ParamSchema` has no such field, and a second vocabulary for
 * "how far one drag moves it" is exactly what a panel file is for.
 */
export interface InlineParamMeta {
  /** Inclusive lower bound, componentwise for a tuple value. */
  readonly min?: number;
  /** Inclusive upper bound, componentwise for a tuple value. */
  readonly max?: number;
  /** What the value does: semantics, units, what turning it changes. */
  readonly description?: string;
}

/**
 * The metadata half of {@link readInlineValue}: the same total, validation-free
 * read, for the three optional keys an inline `param` may carry.
 */
function readInlineMeta(node: Record<string, unknown>): InlineParamMeta | undefined {
  const min = typeof node.min === "number" && Number.isFinite(node.min) ? node.min : undefined;
  const max = typeof node.max === "number" && Number.isFinite(node.max) ? node.max : undefined;
  const description =
    typeof node.description === "string" && node.description.trim() !== ""
      ? node.description
      : undefined;
  if (min === undefined && max === undefined && description === undefined) return undefined;
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * The validating half of {@link readInlineMeta}, run on every build for the
 * reason {@link inlineParamValue} is: a range nothing can satisfy is a fact
 * about the spec, and a graph that parses only while a binder happens to
 * override it breaks the day the override goes away.
 *
 * Every refusal names the param, because by the time a knob renders there is
 * nothing left to name it with. The rules are `paramSchemaError`'s, applied
 * to the one value this node carries: bounds must be finite and ordered, a
 * description must say something, and the value must be inside the range it
 * declares — componentwise for a tuple, exactly as `ParamSchema.min` means
 * it for a vec.
 *
 * Metadata with NO `value` is refused rather than ignored. It describes a
 * control, and a reference that supplies no value has none: standing alone it
 * is the loud refusal its author chose, and inside a wrapper it is the
 * wrapper's exposed param that carries the prose. Admitting it would create
 * a second home for the same sentence, which is the thing this feature exists
 * to remove.
 */
function checkInlineParamMeta(
  spec: Record<string, unknown>,
  inline: FieldBindingValue | undefined,
  path: string,
): void {
  const named = `param ${JSON.stringify(spec.name)}`;
  const present = (["min", "max", "description"] as const).filter(
    (k) => spec[k] !== undefined,
  );
  if (present.length === 0) return;
  if (inline === undefined) {
    fail(
      `${path}.${present[0]}`,
      `${named}: ${present.join(", ")} ${present.length === 1 ? "describes" : "describe"} an ` +
        "inline value, and this reference carries none. Add a \"value\" beside them, or move the " +
        "prose to whatever binds the name (a subgraph's exposed param declares its own " +
        "description, min and max)",
    );
  }
  for (const bound of ["min", "max"] as const) {
    const b = spec[bound];
    if (b === undefined) continue;
    if (typeof b !== "number" || !Number.isFinite(b)) {
      fail(`${path}.${bound}`, `${named}: ${bound} must be a finite number, got ${describeValue(b)}`);
    }
  }
  const min = spec.min as number | undefined;
  const max = spec.max as number | undefined;
  if (min !== undefined && max !== undefined && min > max) {
    fail(
      `${path}.min`,
      `${named}: min ${min} is above max ${max}, so no value is legal — swap them`,
    );
  }
  const components = typeof inline === "number" ? [inline] : (inline as readonly number[]);
  for (const c of components) {
    if (min !== undefined && c < min) {
      fail(`${path}.value`, `${named}: the inline value ${c} is below its own min ${min}`);
    }
    if (max !== undefined && c > max) {
      fail(`${path}.value`, `${named}: the inline value ${c} is above its own max ${max}`);
    }
  }
  const description = spec.description;
  if (description !== undefined && (typeof description !== "string" || description.trim() === "")) {
    fail(
      `${path}.description`,
      `${named}: description must be a non-empty string saying what turning this value does, got ` +
        `${describeValue(description)}; omit the key rather than writing an empty one`,
    );
  }
}

// A named value standing where a literal would: the value is
// SUBSTITUTED here, so the field this returns is the field the literal
// would have produced, key included. That is not an optimization but the
// memoization contract — `Field.key` is computed at construction and is
// what `stableValueHash` hashes a field as, so a value arriving later
// (an `EvalContext` variable, say) would never move a node's param hash
// and the node would serve stale bytes for the new value.
//
// A FIELD binds the same way, one level up: the bound field takes the
// reference's place, so the expression comes out as if it had been
// written around it. Its key composes into this field's key exactly as a
// literal's value does, so invalidation stays as exact for a field
// binding as for a number — and what stands in is a private copy that
// delegates to it (see `detachedBinding`), so several references to one
// name still share its per-context column.
//
// PER-ELEMENT, conservatively and necessarily: a binding may be a FIELD
// spliced in where the reference stands, and that field may be a noise or
// a position. The classification is a property of the fn, decided before
// any binding is in hand, so the only sound answer is the one that holds
// for every value the name can take.
register(
  "param",
  "per-element",
  ["name", "value", "min", "max", "description"],
  `{ fn: "param", name: "amplitude", value?: 0.5, min?: 0, max?: 4, description?: "..." }`,
  (spec, path) => {
    const name = spec.name;
    if (typeof name !== "string" || name === "") {
      fail(`${path}.name`, "param requires a non-empty string name");
    }
    if (name.includes(".")) {
      fail(
        `${path}.name`,
        `param name ${JSON.stringify(name)} contains a "."; a knob addresses a field-spec param as ` +
          `"<nodeId>.<paramKey>.<fieldParamName>", so a dot inside the name itself would split that ` +
          "address in a place nothing can put back together — rename the param without a dot",
      );
    }
    // Read (and validated) on EVERY build, bound or not: a malformed
    // inline value is a fact about the spec, and a spec that parses only
    // while something happens to override it is a graph that breaks the
    // day the override goes away.
    const inline = inlineParamValue(spec, path);
    // Checked here and NOWHERE in what the handler returns: the range and
    // the prose describe the value, they are not part of it, so they never
    // reach the field. See `checkInlineParamMeta` for why an unsatisfiable
    // range is refused now rather than at the widget.
    checkInlineParamMeta(spec, inline, path);
    if (currentBindings === undefined || !Object.hasOwn(currentBindings, name)) {
      // Nothing bound in THIS call, but the node may still carry the spec
      // of a field a previous one spliced here (see `fieldFromJson`). That
      // is the value-free rebuild `specKernelKey` performs to key a kernel:
      // a spliced field decides the emitted WGSL, so it must be rebuilt,
      // where a spliced literal must not.
      const bound = paramSpecOf(spec as unknown as FieldSpec);
      if (bound !== undefined) return buildSpec(bound as Record<string, unknown>, `${path}<${name}>`);
      // The spec's own value, and last of the three: an outer binding wins
      // over it, and so does a field an outer binding already spliced
      // here. Substituted exactly as a binding is — `constant` and not a
      // named stand-in — because that is what puts the value in
      // `Field.key`, and two knob positions that key alike would be handed
      // each other's columns by `evaluateField`'s per-context memo.
      if (inline !== undefined && !ignoreInlineValues) return constant(inline);
      return unboundParam(name);
    }
    const value = currentBindings[name];
    if (isField(value)) return detachedBinding(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        fail(`${path}.name`, `param ${JSON.stringify(name)} is bound to ${String(value)}; a binding must be finite`);
      }
      return constant(value);
    }
    if (isNumberArray(value)) return constant(value);
    fail(
      `${path}.name`,
      `param ${JSON.stringify(name)} is bound to ${describeValue(value)}; a binding must be a finite ` +
        "number (which binds as a scalar), a non-empty array of finite numbers (which binds as the matching " +
        "vector), or a Field (which is spliced in where the reference stands)",
    );
  },
);

register("randomField", "per-element", ["key"], `{ fn: "randomField", key?: 0 | "salt" }`, (spec, path) => {
  const key = spec.key;
  if (key === undefined) return randomField();
  if (typeof key === "number" || typeof key === "string") return randomField(key);
  fail(`${path}.key`, "key must be a number or string");
});

// -- combinators -----------------------------------------------------------

// All UNIFORM: an elementwise combinator's value at an element is a
// function of its arguments' values at that element and of nothing else,
// so it varies exactly as much as they do — which is what makes "every
// argument is uniform" a sufficient test for the whole subtree.
registerFixed("add", "uniform", 2, (f) => add(f[0], f[1]));
registerFixed("sub", "uniform", 2, (f) => sub(f[0], f[1]));
registerFixed("mul", "uniform", 2, (f) => mul(f[0], f[1]));
registerFixed("div", "uniform", 2, (f) => div(f[0], f[1]));
registerFixed("min", "uniform", 2, (f) => min(f[0], f[1]));
registerFixed("max", "uniform", 2, (f) => max(f[0], f[1]));
registerFixed("abs", "uniform", 1, (f) => abs(f[0]));
registerFixed("floor", "uniform", 1, (f) => floor(f[0]));
registerFixed("clamp", "uniform", 3, (f) => clamp(f[0], f[1], f[2]));
registerFixed("lerp", "uniform", 3, (f) => lerp(f[0], f[1], f[2]));
registerFixed("remap", "uniform", 5, (f) => remap(f[0], f[1], f[2], f[3], f[4]));
registerFixed("select", "uniform", 3, (f) => select(f[0], f[1], f[2]));
registerFixed("lt", "uniform", 2, (f) => lt(f[0], f[1]));
registerFixed("le", "uniform", 2, (f) => le(f[0], f[1]));
registerFixed("gt", "uniform", 2, (f) => gt(f[0], f[1]));
registerFixed("ge", "uniform", 2, (f) => ge(f[0], f[1]));
registerFixed("eq", "uniform", 2, (f) => eq(f[0], f[1]));
registerFixed("ne", "uniform", 2, (f) => ne(f[0], f[1]));
registerFixed("dot", "uniform", 2, (f) => dot(f[0], f[1]));
registerFixed("length", "uniform", 1, (f) => length(f[0]));
registerFixed("normalize", "uniform", 1, (f) => normalize(f[0]));
registerFixed("sin", "uniform", 1, (f) => sin(f[0]));
registerFixed("cos", "uniform", 1, (f) => cos(f[0]));
registerFixed("tan", "uniform", 1, (f) => tan(f[0]));
registerFixed("asin", "uniform", 1, (f) => asin(f[0]));
registerFixed("acos", "uniform", 1, (f) => acos(f[0]));
registerFixed("atan", "uniform", 1, (f) => atan(f[0]));
registerFixed("atan2", "uniform", 2, (f) => atan2(f[0], f[1]));

register("vec", "uniform", ["args"], `{ fn: "vec", args: [x, y, z] }`, (spec, path) => {
  const args = requireArgs(spec, path, "variadic");
  return vec(...args.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
});

register(
  "component",
  "uniform",
  ["args", "index"],
  `{ fn: "component", args: [tupleField], index: 0 }`,
  (spec, path) => {
    const args = requireArgs(spec, path, 1);
    const idx = spec.index;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
      fail(`${path}.index`, "component requires a non-negative integer index");
    }
    return component(buildArg(args[0], `${path}.args[0]`), idx);
  },
);

register(
  "ramp",
  "uniform",
  ["args", "stops"],
  `{ fn: "ramp", args: [scalarField], stops: [[0, 0], [1, 1]] }`,
  (spec, path) => {
    const args = requireArgs(spec, path, 1);
    const stops = spec.stops;
    if (
      !Array.isArray(stops) ||
      stops.length === 0 ||
      !stops.every(
        (s) =>
          Array.isArray(s) &&
          s.length === 2 &&
          typeof s[0] === "number" &&
          Number.isFinite(s[0]) &&
          typeof s[1] === "number" &&
          Number.isFinite(s[1]),
      )
    ) {
      fail(`${path}.stops`, "ramp requires a non-empty array of [position, value] number pairs");
    }
    return ramp(
      buildArg(args[0], `${path}.args[0]`),
      (stops as Array<[number, number]>).map((s) => [s[0], s[1]] as const),
    );
  },
);

// -- noise -----------------------------------------------------------------

// The base names and worley outputs come from `src/noise/bases.ts`, the
// one table this parser and the spec derivers share. A local copy could
// accept a name derivation never emits (dead grammar) or — the real
// hazard — reject one it does, which is a graph that saves and cannot be
// reopened.
const NOISE_FACTORIES = NOISE_BASES;

const NOISE_OPT_KEYS = ["seed", "frequency", "offset", "position", "normalized"] as const;

/** Keys a node-seed ref may carry, for the unknown-key refusal. */
const SEED_REF_KEYS = ["from", "variant"] as const;

/**
 * The two legal shapes of `opts.seed`, named together because every
 * refusal in this position has to say which one the author wanted. An
 * agent reading only the message must be able to write the fix.
 */
const SEED_FORMS =
  "seed must be an integer, or the tagged form " +
  `{"from": "node", "variant": <integer 0 to ${MAX_SEED_VARIANT}>} — which derives the seed as ` +
  "hashCombine(the cooking node's own seed, variant), so the graph's seed box re-rolls this " +
  "noise instead of moving only the scatters. `variant` picks WHICH independent draw off that " +
  "node (it stands where the old literal seed stood) and defaults to 0";

/**
 * The integer a node-seed ref's `variant` stands for.
 *
 * A bare integer is part of the spec text, so it is baked into the kernel
 * key and the WGSL. A `param` must not be: two bindings of one name
 * produce the same spec text and therefore the same kernel key, so baking
 * the value would serve the second binding a pipeline compiled for the
 * first. It rides a uniform const slot like every other `param` instead,
 * which is why the value-free rebuild reads 0 here — one kernel serves
 * every variant.
 *
 * Resolution order is the `param` fn's own: an outer binding, then the
 * node's inline value. A reference with neither is refused rather than
 * defaulted, because unlike an ordinary param there is nowhere to defer
 * to — the seed decides `Field.key`, which is fixed at construction.
 */
function parseSeedVariantParam(node: Record<string, unknown>, path: string): number {
  const name = node.name;
  if (typeof name !== "string" || name === "") {
    fail(`${path}.name`, "param requires a non-empty string name");
  }
  if (name.includes(".")) {
    fail(
      `${path}.name`,
      `param name ${JSON.stringify(name)} contains a "."; a knob addresses a field-spec param as ` +
        `"<nodeId>.<paramKey>.<fieldParamName>", so a dot inside the name itself would split that ` +
        "address in a place nothing can put back together — rename the param without a dot",
    );
  }
  const inline = inlineParamValue(node, path);
  checkInlineParamMeta(node, inline, path);
  // Presence, not truthiness — the `param` fn's own rule. An explicit
  // `{name: undefined}` IS a binding, and a wrong one; falling through to
  // the inline value would let a binder silently miss and the graph cook
  // a different noise than the one it asked for.
  const bindings = currentBindings;
  const isBound = bindings !== undefined && Object.hasOwn(bindings, name);
  const bound = isBound ? bindings[name] : undefined;
  if (isField(bound)) {
    fail(
      `${path}.name`,
      `param ${JSON.stringify(name)} stands at a noise seed's variant and is bound to a Field. A ` +
        "seed is resolved in u32 integer math with no float anywhere in it, so it has no " +
        "per-element form — bind an integer, or drive what you meant to vary through " +
        "opts.position instead",
    );
  }
  // Value-free rebuild (`specKernelKey`): binding-free by construction,
  // so the 0 stands for "whatever the slot will carry" and keeps the
  // variant out of the kernel's identity.
  if (!isBound && ignoreInlineValues) return 0;
  const value = isBound ? bound : inline;
  if (value === undefined) {
    fail(
      `${path}.value`,
      `param ${JSON.stringify(name)} stands at a noise seed's variant ${
        isBound
          ? "and is bound to undefined"
          : 'with no "value" of its own and nothing bound to it'
      }. A seed is fixed when the field is built, so there is no later moment to supply it — ` +
        'give the reference a "value", or bind the name to an integer',
    );
  }
  if (typeof value !== "number") {
    fail(
      `${path}.value`,
      `param ${JSON.stringify(name)} stands at a noise seed's variant and is ${
        Array.isArray(value) ? `a ${value.length}-tuple` : describeValue(value)
      }; ${SEED_FORMS}`,
    );
  }
  checkSeedVariant(value, `${path}.value`);
  return value;
}

/** The range rules `NodeSeedRef.variant` is parsed against, wherever it is written. */
function checkSeedVariant(variant: number, path: string): void {
  if (!Number.isInteger(variant)) {
    fail(path, `variant must be an integer, got ${variant}; ${SEED_FORMS}`);
  }
  if (variant < 0) {
    fail(
      path,
      `variant must be 0 or greater, got ${variant}. The derivation reads it as a u32 here and ` +
        "may read it back through an f32 uniform slot on the GPU, where a negative conversion is " +
        "not defined to agree — number the draws off a node from 0",
    );
  }
  if (variant > MAX_SEED_VARIANT) {
    fail(
      path,
      `variant must be at most ${MAX_SEED_VARIANT} (2^24), got ${variant}. Above that an f32 no ` +
        "longer holds every integer, so the CPU and the GPU would derive different seeds. A " +
        "variant is a slot number, not a seed",
    );
  }
}

/**
 * `opts.seed`: an integer, unchanged and byte-identical, or the one
 * tagged form. Nothing else — and deliberately not an arbitrary spec.
 * A seed has no tolerance: a field column is f32, so a seed read through
 * one arrives rounded to 24 bits, and a one-ULP disagreement in a seed is
 * not a rounding error in the output but `hashCombine` avalanching to an
 * unrelated u32 and the node cooking a different noise on the two paths.
 * The safe subset is not checkable from the spec either — it depends on
 * VALUES, which arrive at evaluation — so the position stays closed.
 */
function parseNoiseSeed(raw: unknown, path: string): number | NodeSeedRef {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) fail(path, `${SEED_FORMS}; got ${raw}`);
    return raw;
  }
  if (!isPlainObject(raw)) fail(path, `${SEED_FORMS}; got ${describeValue(raw)}`);
  for (const key of Object.keys(raw)) {
    if (!(SEED_REF_KEYS as readonly string[]).includes(key)) {
      fail(path, `unknown key ${JSON.stringify(key)} in a node-seed ref; ${SEED_FORMS}`);
    }
  }
  if (raw.from !== "node") {
    fail(
      `${path}.from`,
      `"from" must be "node", the one seed a noise can derive from today; got ${
        typeof raw.from === "string" ? JSON.stringify(raw.from) : describeValue(raw.from)
      }`,
    );
  }
  if (raw.variant === undefined) return { from: "node", variant: 0 };
  if (typeof raw.variant === "number") {
    checkSeedVariant(raw.variant, `${path}.variant`);
    return { from: "node", variant: raw.variant };
  }
  if (isPlainObject(raw.variant)) {
    if (raw.variant.fn !== "param") {
      fail(
        `${path}.variant`,
        `variant takes an integer, or an inline {"fn": "param", "name": "...", "value": <integer>} ` +
          `whose value is one — got ${
            typeof raw.variant.fn === "string"
              ? `a spec for ${JSON.stringify(raw.variant.fn)}`
              : "an object with no fn"
          }. No other expression is admitted in a seed: every field column is f32, so an ` +
          "expression here would resolve to a different u32 on the GPU and cook a different noise",
      );
    }
    return { from: "node", variant: parseSeedVariantParam(raw.variant, `${path}.variant`) };
  }
  fail(`${path}.variant`, `${SEED_FORMS}; got ${describeValue(raw.variant)}`);
}

function parseNoiseOpts(
  spec: Record<string, unknown>,
  path: string,
  extraKeys: readonly string[],
): { opts: NoiseOpts; raw: Record<string, unknown> } {
  const rawOpts = spec.opts;
  if (rawOpts === undefined) return { opts: {}, raw: {} };
  if (!isPlainObject(rawOpts)) fail(`${path}.opts`, "opts must be an object");
  const allowed = new Set<string>([...NOISE_OPT_KEYS, ...extraKeys]);
  for (const key of Object.keys(rawOpts)) {
    if (!allowed.has(key)) {
      fail(`${path}.opts`, `unknown noise option "${key}"; allowed: ${[...allowed].join(", ")}`);
    }
  }
  const opts: {
    seed?: number | NodeSeedRef;
    frequency?: number;
    offset?: readonly [number, number, number];
    position?: FieldLike;
    normalized?: boolean;
  } = {};
  if (rawOpts.seed !== undefined) {
    opts.seed = parseNoiseSeed(rawOpts.seed, `${path}.opts.seed`);
  }
  if (rawOpts.frequency !== undefined) {
    if (typeof rawOpts.frequency !== "number" || !Number.isFinite(rawOpts.frequency)) {
      // The refusal names the equivalent because a field-valued frequency
      // ALREADY EXISTS, spelled through the one option that takes a spec:
      // the sample point is `p * frequency + offset`, so scaling the
      // position computes the same point. fbm included — its per-octave
      // `p * (frequency * lacunarity^o)` is `(p * F) * lacunarity^o`.
      fail(
        `${path}.opts.frequency`,
        "frequency must be a finite number; it is not a field position. For a frequency that " +
          'varies per element, scale the SAMPLE POSITION instead: {"position": {"fn": "mul", ' +
          '"args": [{"fn": "position"}, <F>]}, "frequency": 1} samples exactly the same point, ' +
          "and <F> there may be any expression — an attribute, a param, another noise",
      );
    }
    opts.frequency = rawOpts.frequency;
  }
  if (rawOpts.offset !== undefined) {
    const o = rawOpts.offset;
    if (!isNumberArray(o) || o.length !== 3) {
      fail(`${path}.opts.offset`, "offset must be an array of 3 finite numbers");
    }
    opts.offset = [o[0], o[1], o[2]];
  }
  if (rawOpts.position !== undefined) {
    opts.position = buildArg(rawOpts.position, `${path}.opts.position`);
  }
  if (rawOpts.normalized !== undefined) {
    if (typeof rawOpts.normalized !== "boolean") {
      fail(`${path}.opts.normalized`, "normalized must be a boolean");
    }
    opts.normalized = rawOpts.normalized;
  }
  return { opts, raw: rawOpts };
}

// PER-ELEMENT, all five of them: a noise samples a POSITION, which is the
// per-element leaf by definition, and it keeps doing so when `opts.position`
// names another expression — the fold recurses INTO that option (a seed
// shift added to the sample position is exactly the fold's target) without
// ever folding the noise itself.
for (const name of ["valueNoise", "perlinNoise", "simplexNoise"] as const) {
  register(
    name,
    "per-element",
    ["opts"],
    `{ fn: "${name}", opts?: { seed?, frequency?, offset?: [x,y,z], position?, normalized? } }`,
    (spec, path) => NOISE_FACTORIES[name](parseNoiseOpts(spec, path, []).opts),
  );
}

register(
  "worleyNoise",
  "per-element",
  ["opts"],
  `{ fn: "worleyNoise", opts?: { seed?, frequency?, offset?, position?, normalized?, output?: "f1" | "f2" | "f2-f1", exact? } }`,
  (spec, path) => {
    const { opts, raw } = parseNoiseOpts(spec, path, ["output", "exact"]);
    const worleyOpts: WorleyNoiseOpts = { ...opts };
    if (raw.output !== undefined) {
      if (typeof raw.output !== "string" || !WORLEY_OUTPUTS.includes(raw.output)) {
        fail(`${path}.opts.output`, `output must be one of: ${WORLEY_OUTPUTS.join(", ")}`);
      }
      worleyOpts.output = raw.output as WorleyNoiseOpts["output"];
    }
    if (raw.exact !== undefined) {
      if (typeof raw.exact !== "boolean") {
        fail(`${path}.opts.exact`, "exact must be a boolean");
      }
      worleyOpts.exact = raw.exact;
    }
    return worleyNoise(worleyOpts);
  },
);

register(
  "fbm",
  "per-element",
  ["base", "opts"],
  `{ fn: "fbm", base: "perlinNoise", opts?: { seed?, frequency?, offset?, position?, normalized?, octaves?, lacunarity?, gain? } }`,
  (spec, path) => {
    const base = spec.base;
    if (typeof base !== "string" || !(base in NOISE_FACTORIES)) {
      fail(
        `${path}.base`,
        `fbm base must be one of: ${Object.keys(NOISE_FACTORIES).join(", ")}; got ${describeValue(base) === "a string" ? `"${String(base)}"` : describeValue(base)}`,
      );
    }
    const { opts, raw } = parseNoiseOpts(spec, path, ["octaves", "lacunarity", "gain"]);
    const fbmOpts: FbmOpts = { ...opts };
    if (raw.octaves !== undefined) {
      if (typeof raw.octaves !== "number" || !Number.isInteger(raw.octaves) || raw.octaves < 1) {
        fail(`${path}.opts.octaves`, "octaves must be a positive integer");
      }
      fbmOpts.octaves = raw.octaves;
    }
    for (const key of ["lacunarity", "gain"] as const) {
      const v = raw[key];
      if (v !== undefined) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          fail(`${path}.opts.${key}`, `${key} must be a finite number`);
        }
        fbmOpts[key] = v;
      }
    }
    return fbm(NOISE_FACTORIES[base as string], fbmOpts);
  },
);

// -- public API ------------------------------------------------------------

/** Names of all field constructors available in JSON specs, sorted. */
export function listFieldFns(): string[] {
  return [...FNS.keys()].sort();
}

/** JSON-safe metadata of one field-expression constructor. */
export interface FieldFnInfo {
  /** The `fn` value in a spec. */
  readonly fn: string;
  /** Spec keys allowed besides `fn`, in declaration order. */
  readonly keys: readonly string[];
  /** Usage sketch — the same text the validation errors quote. */
  readonly usage: string;
}

/**
 * Metadata for every field constructor available in JSON specs, sorted by
 * name: the grammar's counterpart of {@link listNodeTypes}, and the
 * catalog an agent reads before writing a field-valued param.
 */
export function listFieldFnInfos(): FieldFnInfo[] {
  return listFieldFns().map((fn) => {
    const def = FNS.get(fn) as FnDef;
    return { fn, keys: [...def.keys], usage: def.usage };
  });
}

/**
 * Values for the `param` references in a spec, by name. A number binds
 * as a scalar and an array as the matching vector — in both cases
 * exactly what writing that literal in the same position would have
 * produced.
 *
 * A `Field` binds too, and is the one binding that is not a literal: it
 * is SPLICED into the expression where the reference stands, so the
 * result is the expression the author would have written around it. That
 * is what lets a named value VARY per element — a noise driving a
 * primitive's knob — where a number is necessarily uniform over the
 * cook. Everything else follows unchanged: the composed key carries the
 * bound field's key, so a rebind moves the reading node's memo key, and
 * the attached spec still round-trips the reference rather than the
 * field it stood for.
 */
export type FieldBindings = Readonly<Record<string, number | readonly number[] | Field>>;

/**
 * Visit every spec node in a tree, once each. The field-valued positions
 * come from {@link specChildren}, the single answer shared with the walks
 * in `fold.ts`, `src/gpu/compile.ts` and `src/gpu/run.ts` — so a fn that
 * puts a spec somewhere new is taught once rather than four times, in four
 * places whose disagreement would be silent.
 *
 * `seen` guards cycles: `buildSpec` rejects them before anything reaches
 * here, but {@link paramNamesOf} is public and may be handed raw JSON
 * that `structuredClone` has faithfully reproduced a cycle in.
 */
function walkSpecNodes(
  v: unknown,
  visit: (node: Record<string, unknown>) => void,
  seen: Set<object>,
): void {
  if (!isPlainObject(v) || seen.has(v)) return;
  seen.add(v);
  visit(v);
  for (const child of specChildren(v)) walkSpecNodes(child, visit, seen);
}

/** Call `visit` for every well-formed `param` node in `spec`. */
function eachParam(spec: FieldSpec, visit: (node: Record<string, unknown>, name: string) => void): void {
  walkSpecNodes(
    spec,
    (node) => {
      if (node.fn === "param" && typeof node.name === "string" && node.name !== "") {
        visit(node, node.name);
      }
    },
    new Set<object>(),
  );
}

/**
 * Every `param` name a spec references, sorted and deduplicated — the
 * catalog of what {@link fieldFromJson} must be given before the spec can
 * be evaluated. Walks the whole tree, `opts.position` included, and is
 * tolerant of malformed input (it reads, it does not validate).
 */
export function paramNamesOf(spec: FieldSpec): readonly string[] {
  const names = new Set<string>();
  eachParam(spec, (_node, name) => names.add(name));
  return [...names].sort();
}

/**
 * @internal The subset of {@link paramNamesOf} that some reference leaves
 * for a BINDER to supply: a name is listed as soon as one `param` node
 * mentioning it carries no inline value of its own.
 *
 * The two lists are different questions and both are asked. "What may I
 * bind?" is every name — an outer binding overrides an inline value, so a
 * self-supplied name is still bindable. "What MUST somebody supply?" is
 * this one, and it is what a wrapper checks its declarations against
 * (`checkBodyReferences` in `src/graph/subgraph.ts`): refusing a body
 * expression that supplies its own value would make an inline value
 * unusable inside a subgraph, which is the one place the corpus keeps
 * most of its expressions.
 *
 * A name mentioned twice, once with a value and once without, is listed:
 * the value-free reference is as unbound as it ever was.
 */
export function unboundParamNamesOf(spec: FieldSpec): readonly string[] {
  const names = new Set<string>();
  eachParam(spec, (node, name) => {
    if (readInlineValue(node.value) === undefined) names.add(name);
  });
  return [...names].sort();
}

/**
 * Every `param` name in `spec` that supplies its OWN value, and the value
 * it supplies — the complement of {@link unboundParamNamesOf}, and what a
 * panel enumerates to offer one knob per literal an author named inside an
 * expression.
 *
 * A name with no inline value is deliberately absent. That reference is
 * waiting for a binder and refuses to evaluate without one, so it is an
 * error state rather than a control: a widget offered for it would write a
 * number into a spec that never asked for one, and the loud failure an
 * author chose by writing no value would quietly become a default.
 *
 * A name mentioned twice with two different values reports the FIRST, and
 * {@link withInlineParamValue} then writes both. One name is one knob
 * within one expression, because `"<nodeId>.<paramKey>.<name>"` is the
 * whole of what the address can say.
 *
 * Walks the tree the same way {@link paramNamesOf} does, `opts.position`
 * included, and is tolerant of malformed input: it reads, it does not
 * validate.
 */
export function inlineParamValuesOf(spec: FieldSpec): Readonly<Record<string, FieldBindingValue>> {
  // Null-prototype: a param name is any non-empty dot-free string, which
  // includes `__proto__` — and on a plain object that key is a setter, so
  // the name would be silently dropped and a tuple value would re-prototype
  // the record the caller iterates.
  const values: Record<string, FieldBindingValue> = Object.create(null) as Record<
    string,
    FieldBindingValue
  >;
  eachParam(spec, (node, name) => {
    if (Object.hasOwn(values, name)) return;
    const value = readInlineValue(node.value);
    if (value !== undefined) values[name] = value;
  });
  return values;
}

/**
 * The presentation metadata each name in {@link inlineParamValuesOf}
 * declares — its range and what turning it does — so a knob can be labelled
 * and bounded from the GRAPH and not from a file beside it.
 *
 * This exists because the form it replaced already had it. A subgraph
 * wrapper declares a full `ParamSchema` per exposed param, description and
 * bounds included, INSIDE the graph; flattening such a wrapper into inline
 * `param` values moved that prose into `graphs/panels/*.json`, and a graph
 * opened without its panel then knew less about itself than it had before.
 * A panel is one presentation of a graph; what a value MEANS is the graph's.
 *
 * Read per KEY rather than per node, first definition winning, for the
 * reason {@link inlineParamValuesOf} reports the first of two values: one
 * name is one knob within one expression. A name read twice — the rig's
 * `wanderScale` reaches two noises — is documented once, beside whichever
 * reference its author chose, and neither reference is the privileged one.
 *
 * Tolerant of malformed input like its siblings: it reads, it does not
 * validate. {@link fieldFromJson} is where a range nothing satisfies is
 * refused, and it names the param when it does.
 */
export function inlineParamMetaOf(spec: FieldSpec): Readonly<Record<string, InlineParamMeta>> {
  // Null-prototype for the reason `inlineParamValuesOf` is: `__proto__` is a
  // legal param name and a setter on a plain object.
  const meta: Record<string, InlineParamMeta> = Object.create(null) as Record<
    string,
    InlineParamMeta
  >;
  eachParam(spec, (node, name) => {
    const read = readInlineMeta(node);
    if (read === undefined) return;
    const have = Object.hasOwn(meta, name) ? meta[name] : {};
    meta[name] = { ...read, ...have };
  });
  return meta;
}

/**
 * `spec` with the inline value of every `param` node named `name`
 * rewritten — the write half of {@link inlineParamValuesOf}, and what a
 * panel calls before handing the result back to {@link fieldFromJson}.
 *
 * A `param` node of that name carrying NO inline value is left exactly as
 * it was. Not because writing one could delete a binding — it could not,
 * since an outer binding and a spliced field both outrank an inline value
 * — but because the author of a value-free reference chose the loud
 * refusal, and quietly giving it a default is how that choice disappears.
 * The optional key is the whole of this feature's safety; a writer that
 * supplies it uninvited spends it.
 *
 * Refuses a name no node supplies, rather than returning an unchanged
 * clone: the caller believes it is moving a value, and a write that
 * reports success while changing nothing is the failure a panel cannot
 * see.
 *
 * Rewrites `value` and nothing else, so the node's `min`, `max` and
 * `description` survive every knob turn: a range is a property of the param,
 * not of the number currently sitting in it.
 *
 * Deep-copies, so the spec handed in is never mutated; the caller's is
 * usually the one a live `Field` is still carrying. The copy is a plain
 * tree, so records held OUTSIDE the nodes — the spec of a field an outer
 * binding spliced here — do not survive it. Nothing reachable from a knob
 * carries one today (only a subgraph body's nodes are ever spliced), and
 * an inline value is by definition the case where there is no outer
 * binding to lose.
 */
export function withInlineParamValue(
  spec: FieldSpec,
  name: string,
  value: FieldBindingValue,
): FieldSpec {
  const written = readInlineValue(value);
  if (written === undefined) {
    throw new FieldJsonError(
      `withInlineParamValue: value for param ${JSON.stringify(name)} must be a finite number ` +
        "(which stands as a scalar) or a non-empty array of finite numbers (which stands as the " +
        `matching vector), got ${describeValue(value)}`,
    );
  }
  const next = structuredClone(spec) as FieldSpec;
  let rewritten = 0;
  eachParam(next, (node, n) => {
    if (n !== name) return;
    if (readInlineValue(node.value) === undefined) return;
    // A fresh copy per node: two references to one name are two
    // independent literals in the JSON, and a shared array would make an
    // edit to one of them silently move the other.
    node.value = Array.isArray(written) ? [...written] : written;
    rewritten++;
  });
  if (rewritten === 0) {
    const supplied = Object.keys(inlineParamValuesOf(spec));
    const unbound = unboundParamNamesOf(spec).filter((n) => n === name);
    throw new FieldJsonError(
      `withInlineParamValue: no param ${JSON.stringify(name)} in this spec supplies its own ` +
        `value, so there is nothing to rewrite. ${
          unbound.length > 0
            ? `The name IS referenced, but with no "value" of its own — that reference is bound ` +
              "from outside, and its value belongs to whoever binds it"
            : `Names this spec supplies: ${supplied.length > 0 ? supplied.join(", ") : "(none)"}`
        }`,
    );
  }
  return next;
}

/**
 * Add the bindings a build resolved to the message of a failure the
 * FIELD CONSTRUCTORS raised. A tuple mismatch is reported by whichever
 * combinator broadcast the substituted constant ("add: incompatible
 * tuple sizes 3 and 2"), which cannot know a `param` stood in that
 * position — so the fact only this frame still holds is appended here
 * rather than guessed at the throw site. Grammar failures are left
 * alone: `fail()` already names the path, the cause and the fix.
 */
function withBindingContext(err: unknown, spec: FieldSpec, bindings: FieldBindings): unknown {
  if (err instanceof FieldJsonError || !(err instanceof Error)) return err;
  const bound = paramNamesOf(spec).filter((n) => Object.hasOwn(bindings, n));
  if (bound.length === 0) return err;
  const shown = bound
    .map((n) => {
      const v = bindings[n];
      const shape = isField(v)
        ? `a Field of tuple size ${v.tupleSize ?? "unknown until it lands on a domain"}`
        : typeof v === "number"
          ? "a scalar"
          : `a ${v.length}-tuple`;
      return `${JSON.stringify(n)} = ${shape}`;
    })
    .join(", ");
  const wrapped = new FieldJsonError(
    `${err.message} — this spec binds ${shown}; check each binding's arity against the position ` +
      "it is used in (a scalar broadcasts against any tuple size, a tuple must match exactly)",
  );
  // The constructor's own stack points here, at the frame that added a
  // clause — not at the combinator that refused. Carrying the original
  // keeps that frame reachable, since the same underlying failure surfaces
  // as a plain Error when no bindings were passed.
  wrapped.cause = err;
  return wrapped;
}

/**
 * Build a Field from a declarative JSON spec. Validates the constructor
 * name and every argument (errors name the failing path and list valid
 * alternatives), and attaches a copy of the spec to the resulting field
 * so {@link fieldToJson} can serialize it back.
 *
 * `bindings` supplies the values for the spec's `param` references
 * ({@link paramNamesOf} lists what a spec needs). Binding SUBSTITUTES:
 * the field comes out as if the literal had been written, so `Field.key`
 * carries the value and a rebind moves the cook's memo key exactly the
 * way editing the literal would. A `Field` binding substitutes the same
 * way one level up — the field itself stands where the reference did —
 * so a named value can vary per element instead of only over the cook,
 * and the composed key carries the bound field's key. The spec attached
 * to the field keeps the reference either way, so `fieldToJson`
 * round-trips `{fn: "param", name}` rather than the value or the field it
 * stood for — and a name nothing bound builds a field that refuses to
 * evaluate rather than one that quietly reads zero.
 *
 * A `param` node may also carry its own `value`, and then the precedence
 * is: a binding here, else a field an earlier call spliced onto this node,
 * else the node's own value, else the refusal. So a binder always wins and
 * the inline value is the fallback — which is what lets one expression be
 * tunable standalone AND still be wrapped in a subgraph that exposes the
 * same name.
 *
 * That fallback is the one binding that SURVIVES SERIALIZATION, and for
 * the plainest of reasons: it is written in the spec rather than beside
 * it. `fieldToJson` re-emits it with the rest of the node, where a value
 * this call was handed exists only in a side table and reloads as the
 * unbound refusal.
 */
export function fieldFromJson(spec: FieldSpec, bindings?: FieldBindings): Field {
  if (!isPlainObject(spec)) {
    throw new FieldJsonError(`fieldFromJson: expected a spec object, got ${describeValue(spec)}`);
  }
  if (bindings !== undefined && !isPlainObject(bindings)) {
    throw new FieldJsonError(
      "fieldFromJson: bindings must be an object mapping param names to a number or a number " +
        `array, got ${describeValue(bindings)}`,
    );
  }
  deepestLevel = 0;
  const outer = currentBindings;
  currentBindings = bindings;
  let field: Field;
  try {
    field = buildSpec(spec, "$");
  } catch (err) {
    throw bindings === undefined ? err : withBindingContext(err, spec, bindings);
  } finally {
    currentBindings = outer;
  }
  // Stamped LAST, over whatever spec the constructors derived while
  // building the tree, so `fieldToJson` returns the author's exact JSON
  // rather than a canonicalized derivation of it.
  const authored = structuredClone(spec) as FieldSpec;
  // A bare block, and no longer conditional on `bindings`: an inline value
  // is stamped by the same walk, so a build with nothing bound has a
  // record to leave too. The block is what scopes `spliced`.
  {
    // The values ride the CLONE's nodes — the objects the attached spec
    // is made of, and the ones a derived parent structure-shares — so
    // whatever later reads this field's spec (the WGSL compiler, the run
    // planner) recovers the arity it must lower and the value it must
    // write into the uniform. See `attachParamValue` for why they cannot
    // live inside the node.
    //
    // Worst provenance any SPLICED field contributes, recorded on the
    // root so `deviceSpec` can answer for the whole expression rather
    // than for the spec object alone. Opaque outranks derived: a tree
    // with something undescribable in it is undescribable however the
    // rest was written.
    let spliced: "derived" | "opaque" | undefined;
    // The clone's `param` nodes paired with the ones they were cloned
    // FROM, because the two carry different halves of what the build just
    // decided. The value to stamp is written in the CLONE (it came from
    // the JSON); whether the handler USED it — rather than a field an
    // earlier call spliced onto that very node — is recorded beside the
    // ORIGINAL, and a fresh clone carries no side-table record of its own.
    //
    // Two walks of ONE walker rather than a second walker that recurses
    // over both trees: `structuredClone` reproduces the tree's shape and
    // its sharing exactly, so the two visit the same nodes in the same
    // order, and a walker that could drift from itself does not exist. The
    // length check is what makes that an assertion instead of an
    // assumption; a mismatch stamps nothing, which is what this call did
    // before an inline value was a thing it could stamp.
    const origins: Array<Record<string, unknown>> = [];
    const targets: Array<Record<string, unknown>> = [];
    eachParam(spec, (node) => origins.push(node));
    eachParam(authored, (node) => targets.push(node));
    const paired = origins.length === targets.length;
    for (let i = 0; i < targets.length; i++) {
      const node = targets[i];
      const name = node.name as string;
      const target = node as unknown as FieldSpec;
      if (bindings === undefined || !Object.hasOwn(bindings, name)) {
        // An INLINE value is stamped through the same channel a binding's
        // is, which is the whole of why the parts that read only a spec
        // need no further change: `paramValue` is what the WGSL compiler
        // fills its uniform slot from and what the domain-constant fold
        // recovers to rebuild a subtree. The value is ALSO still written
        // in the node — unlike a binding's, which lives only here — so an
        // inline value is the one binding that survives serialization.
        //
        // Only when the handler actually took it, though. A node an
        // earlier call spliced a FIELD onto builds that field again here
        // (`paramSpecOf` outranks the inline value), so stamping the
        // literal would tell the compiler and the fold to substitute a
        // number this field never computed — a wrong answer where the
        // unstamped node is merely a declined one. An OPAQUE node is not
        // skipped, and must not be: nothing can rebuild what it stood for,
        // so the handler falls through to the inline value and the stamp
        // describes exactly the field that came out.
        if (ignoreInlineValues || !paired) continue;
        if (paramSpecOf(origins[i] as unknown as FieldSpec) !== undefined) continue;
        const inline = readInlineValue(node.value);
        if (inline !== undefined) attachParamValue(target, inline);
        continue;
      }
      const value = bindings[name];
      if (isField(value)) {
        // A FIELD rides the same channel as a value and for the same
        // reason, but records the field's SPEC rather than its numbers:
        // what the compiler must recover here is the expression to
        // splice, not a payload to write into a uniform. The spec object
        // is the field's own and is immutable by contract, so it is
        // recorded as-is where a mutable tuple is copied.
        const bound = peekFieldSpec(value);
        if (bound === undefined) {
          attachOpaqueParam(target);
          spliced = "opaque";
          continue;
        }
        // A field that IS a constant binds as the constant. The built
        // field is the same object and the same key either way, so this
        // changes no byte on the CPU — but on the device it is the
        // difference between a uniform slot every value shares and a
        // kernel specialized per value. That case is not hypothetical: a
        // panel toggling a knob to "field" mode seeds the editor with
        // `{fn: "constant", value: <default>}`, so a slider dragged in
        // that mode would compile a pipeline per tick into a Map with no
        // bound. It also carries `-0` and subnormals exactly, where a
        // baked literal may be flushed.
        const literal = constantSpecValue(bound);
        if (literal !== undefined) {
          attachParamValue(target, literal);
          continue;
        }
        attachParamSpec(target, bound);
        // Transitive: a bound field may itself have been built with
        // bindings, and what IT spliced is just as much part of what this
        // expression computes. Reading the record back is what keeps the
        // walk from stopping one level down.
        const inherited = splicedProvenance(bound);
        if (inherited === "opaque") {
          spliced = "opaque";
          continue;
        }
        if ((isDerivedSpec(bound) || inherited === "derived") && spliced === undefined) {
          spliced = "derived";
        }
        continue;
      }
      // Copied, never referenced: the field's key was fixed from this
      // value at construction, so a caller who later mutates the array
      // they passed would leave the recorded arity and the key describing
      // different numbers — and the device would then write bytes the CPU
      // never produced. The copy is what makes the record as immutable as
      // the key it belongs to.
      attachParamValue(target, typeof value === "number" ? value : [...value]);
    }
    if (spliced !== undefined) recordSplicedProvenance(authored, spliced);
  }
  attachAuthoredSpec(field, authored, deepestLevel);
  return field;
}

/**
 * @internal Build `spec` with every INLINE `param` value ignored, so the
 * result's key describes the expression and not the numbers standing in
 * it. `specKernelKey` in `src/gpu/compile.ts` is the one caller, and the
 * kernel-cache invariant it keeps is the only reason this exists: one
 * kernel serves every value of a name (the value goes into a uniform
 * slot), so a key that carried the value would add a Map entry per slider
 * tick.
 *
 * A BOUND value never needed this. It lives in a side table keyed on the
 * spec node, and the `param` handler consults that table only for the
 * spliced-FIELD case — so rebuilding an already-built spec with no
 * bindings drops the numbers by construction. An inline value is written
 * INTO the node, which is exactly what makes it survive serialization, and
 * therefore also what would carry it into a rebuild that must not see it.
 */
export function fieldFromJsonValueFree(spec: FieldSpec): Field {
  const outer = ignoreInlineValues;
  ignoreInlineValues = true;
  try {
    return fieldFromJson(spec);
  } finally {
    ignoreInlineValues = outer;
  }
}

/** The refusal's shared opening — one prefix, four continuations. */
const NO_SPEC = "fieldToJson: this field carries no JSON spec, so it cannot be serialized";

/** How to build a field the grammar CAN name, named the same way twice. */
const GRAMMAR = "grammar constructors (combinators, inputs, noise — see listFieldFns), or fieldFromJson";

/**
 * A structural key inside a message. Keys embed their children, so a
 * deep expression's key is unbounded; an error nobody can read names its
 * offender no better than one that says nothing.
 */
function nameKey(key: string): string {
  return key.length <= 120 ? `\`${key}\`` : `\`${key.slice(0, 117)}...\` (truncated)`;
}

/**
 * Why this spec-less field is spec-less, as one message naming the one
 * cause that applied. The reason was recorded at the withhold site (see
 * `WithheldReason`), because by the time the field arrives here every
 * constructor that knew has returned.
 */
function noSpecMessage(field: Field): string {
  const reason = withheldReason(field);
  // No reason recorded means nothing WITHHELD one: `makeField` does not
  // decline to describe its closure, it simply has nothing to describe.
  // That is the only way to arrive here without a reason, because every
  // constructor that declines records why.
  //
  // The `leafKey === field.key` disjunct is defensive, not a live path:
  // `withheldOver` only ever mints an `opaque` naming a DIFFERENT field
  // (the argument), and every combinator key embeds its arguments' keys,
  // so the two cannot collide today. It is here so that a future site
  // recording "this field is itself the opaque leaf" gets the accusation
  // that describes it, rather than being told one of its own
  // sub-expressions is at fault.
  if (reason === undefined || (reason.kind === "opaque" && reason.leafKey === field.key)) {
    return (
      `${NO_SPEC}. It was built by makeField, whose evaluator is an arbitrary closure that ` +
      `nothing can name — the deliberate escape hatch. Rebuild it with ${GRAMMAR}`
    );
  }
  switch (reason.kind) {
    case "opaque":
      return (
        `${NO_SPEC}. The sub-expression ${nameKey(reason.leafKey)} carries none of its own — a ` +
        "makeField closure can never be named — and every field composed over it inherits that, " +
        `because a combinator derives its spec from its arguments. Replace that sub-expression ` +
        `with ${GRAMMAR}`
      );
    case "too-deep":
      return (
        `${NO_SPEC}. It nests deeper than the grammar's cap of ${MAX_SPEC_DEPTH} levels, which ` +
        "fieldFromJson refuses to parse — and a spec that cannot be read back would be worse " +
        "than none. Flatten the expression to fit under the cap"
      );
    case "ungrammatical":
      return (
        `${NO_SPEC}: ${reason.detail}. The constructor accepts values the grammar's parser does ` +
        "not, and a spec fieldFromJson would reject would be worse than none. Use a value the " +
        "grammar accepts, or build the field with fieldFromJson"
      );
  }
}

/**
 * Serialize a field back to its JSON spec. Fields built by
 * {@link fieldFromJson} return the author's original spec; fields built
 * with the combinator API return the spec derived from their inputs.
 * Fields that carry none throw an actionable error naming the ONE cause
 * that applied — an opaque `makeField` closure (its own, or a named
 * sub-expression's), a tree past the grammar's depth cap, or an argument
 * the grammar's parser would reject. See `getFieldSpec` for the
 * non-throwing variant.
 */
export function fieldToJson(field: Field): FieldSpec {
  if (!isField(field)) {
    throw new FieldJsonError("fieldToJson: value is not a Field");
  }
  const spec = peekFieldSpec(field);
  if (spec === undefined) {
    throw new FieldJsonError(noSpecMessage(field));
  }
  return structuredClone(spec) as FieldSpec;
}
