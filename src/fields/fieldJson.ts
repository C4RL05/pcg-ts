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
// `NOISE_RAW_RANGES` rides the same import for the catalog's sake — the
// documented output ranges are published from the ONE table the noise
// factories are built against, so `pcg fields perlinNoise` cannot print a
// range the field does not have.
import { MAX_SEED_VARIANT, NOISE_RAW_RANGES } from "../noise/util.js";

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

/**
 * One argument position of a fn's `args` array, named and explained.
 *
 * The name is the identifier the usage sketch prints in that slot, so
 * `select` reads `args: [cond, whenTrue, whenFalse]` rather than
 * `[arg0, arg1, arg2]` — a length is not a signature. A trailing `…`
 * marks a REPEATED position (`vec`'s components), the one case where the
 * list is shorter than the arity.
 */
interface ArgDoc {
  readonly name: string;
  readonly description: string;
}

/**
 * A documented output range, and the configuration it holds under.
 *
 * `note` carries the qualification whenever a fn has more than one range
 * (worley's three outputs, every noise's `normalized: true`) or whenever
 * the bounds are not both attainable (`randomField` never returns 1).
 * Without it, one pair of numbers would have to stand for several
 * different answers, which is how a published range becomes a wrong one.
 */
interface RangeDoc {
  readonly min: number;
  readonly max: number;
  readonly note?: string;
}

/** The catalog half of a registration: what the fn does, and its arguments. */
interface FnDoc {
  /**
   * What the fn COMPUTES, in the voice `ParamSchema.description` uses for
   * a node param: the operation, then the edges that bite (ranges,
   * degenerate inputs, what happens outside a domain). Not a restatement
   * of the name.
   */
  readonly description: string;
  /** One entry per `args` position, in order. Absent for fns taking no `args`. */
  readonly args?: readonly ArgDoc[];
  /** Documented output range(s), when the fn has one worth stating. */
  readonly outputRange?: readonly RangeDoc[];
}

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
  /**
   * REQUIRED for the reason {@link FnVariation} is: a fn registered with
   * no prose publishes a type signature and calls it a catalog, which is
   * exactly the gap this field exists to close. `pcg fields` and
   * {@link listFieldFnInfos} read it, and the completeness test in
   * fieldJson.test.ts refuses an empty one.
   */
  readonly doc: FnDoc;
  build(spec: Record<string, unknown>, path: string): Field;
}

/**
 * The broadcast rule, restated on every combinator that has one, because
 * an author reads ONE entry and must not have to have read another.
 */
const BROADCAST =
  "Arguments broadcast: a scalar spreads across any tuple width, and two non-scalar widths must match.";

/** The four noise options every noise fn shares, said once. */
const NOISE_OPTS_DOC =
  "Shared options: `seed` (an integer, or {\"from\": \"node\", \"variant\": N} so the graph's seed " +
  "box re-rolls it), `frequency` and `offset` (the point sampled is `p * frequency + offset`, so a " +
  "SMALLER frequency means larger features), `position` (replaces `position()` as the point sampled " +
  "— the one option that takes a field expression, and how a per-element frequency is written), and " +
  "`normalized` (maps the range below affinely onto [0, 1]).";

/** The `normalized: true` range entry, identical for every noise. */
const NORMALIZED_RANGE: RangeDoc = { min: 0, max: 1, note: "opts.normalized: true" };

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
  doc: FnDoc,
  build: FnDef["build"],
): void {
  FNS.set(name, { keys, variation, usage, doc, build });
}

/**
 * `variation` is named at every call site rather than assumed from the
 * shape: an elementwise combinator over its arguments is uniform, but
 * nothing about "fixed arity" says so, and a per-element fn registered
 * through here would otherwise inherit a classification nobody chose.
 *
 * The arity comes from `args.length` rather than from a number beside it,
 * so the usage sketch, the arity check and the published argument list are
 * one declaration: a fn cannot advertise three names and accept four.
 */
function registerFixed(
  name: string,
  variation: FnVariation,
  args: readonly ArgDoc[],
  description: string,
  make: (fields: Field[]) => Field,
  outputRange?: readonly RangeDoc[],
): void {
  const arity = args.length;
  const usage = `{ fn: "${name}", args: [${args.map((a) => a.name).join(", ")}] }`;
  register(
    name,
    variation,
    ["args"],
    usage,
    { description, args, ...(outputRange !== undefined ? { outputRange } : {}) },
    (spec, path) => {
      const parsed = requireArgs(spec, path, arity);
      return make(parsed.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
    },
  );
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

register(
  "constant",
  "uniform",
  ["value"],
  `{ fn: "constant", value: 1 | [1, 2, 3] }`,
  {
    description:
      "The same value on every element: a finite number for a scalar, or a non-empty array of finite " +
      "numbers for the matching tuple. Rarely written out — a bare number or number array in any " +
      "argument position wraps into one automatically, so `{\"fn\": \"mul\", \"args\": [x, 2]}` needs no " +
      "constant node.",
  },
  (spec, path) => {
    const v = spec.value;
    if (typeof v === "number" && Number.isFinite(v)) return constant(v);
    if (isNumberArray(v)) return constant(v);
    fail(`${path}.value`, "constant requires a finite number or non-empty number array");
  },
);

register(
  "attribute",
  "per-element",
  ["name", "tupleSize"],
  `{ fn: "attribute", name: "density", tupleSize?: 1 }`,
  {
    description:
      "Reads a NUMERIC attribute of whatever domain the expression lands on. Any of `P`, `density`, " +
      "or anything an upstream node wrote. Numeric columns are read in place and a bool column reads as " +
      "0 or 1. A STRING attribute is refused (drive one with `attributeIs` or `byAttribute`), and so " +
      "is a missing attribute or a `tupleSize` that disagrees with the stored one. Leave `tupleSize` " +
      "off to accept whatever width the geometry has; give it to have the width checked against the " +
      "REST OF THE EXPRESSION when the field is built, since the disagreement with what the geometry " +
      "actually stores can only be reported once a geometry is in hand.",
  },
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
  {
    description:
      "1 on elements whose STRING attribute `name` equals `value`, 0 everywhere else. This is how a " +
      "string column drives a field, and it is a predicate rather than an accessor because a string " +
      "column's indices are rebuilt by ordinary filtering and merging. A literal the geometry's " +
      "string table does not hold matches nothing and reads as all zeros rather than throwing, so a " +
      "MISSPELLED value is silent; a missing attribute, or a numeric one, still throws. Use " +
      "`byAttribute` when there are more than two cases.",
    outputRange: [{ min: 0, max: 1, note: "1 or 0, nothing between" }],
  },
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
  {
    description:
      "The N-way `attributeIs`. Each element takes the `cases` entry whose KEY equals its `name` " +
      "string attribute, and `default` where no key does. `default` is REQUIRED — naming the " +
      "fall-through is the point of the fn. Case values are full argument positions (a nested spec, " +
      "a number, or a tuple) and broadcast against each other, so the result's width is a property " +
      "of the expression and never of which case fired. Every case is evaluated and then selected " +
      "between; at most one can fire, so the order they are written in does not matter. A key the " +
      "geometry's string table does not hold matches nothing and takes the default, which makes a " +
      "misspelled key dead code rather than an error.",
  },
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

register(
  "position",
  "per-element",
  [],
  `{ fn: "position" }`,
  {
    description:
      "The element's world position: the standard `P` attribute as a tuple-3 field. This is the " +
      "point every noise samples when its `opts.position` is not set, and the input to scale when a " +
      "per-element noise frequency is wanted.",
  },
  () => detachedLeaf(position(), { fn: "position" }),
);
register(
  "index",
  "per-element",
  [],
  `{ fn: "index" }`,
  {
    description:
      "The element's 0-based index within the domain, in storage order (0, 1, 2, …). It names a " +
      "SLOT rather than an element, so anything that filters, merges or reorders upstream renumbers " +
      "it. For a per-element value that survives those, use `randomField`, which is keyed on " +
      "identity on the point and primitive domains (on vertex and detail it falls back to this same " +
      "index).",
  },
  () => detachedLeaf(index(), { fn: "index" }),
);
register(
  "fraction",
  "per-element",
  [],
  `{ fn: "fraction" }`,
  {
    description:
      "The element index normalized onto a CLOSED [0, 1], as `index / (count - 1)`. Exactly 0 on " +
      "the first element and exactly 1 on the last, so 5 elements give 0, 0.25, 0.5, 0.75, 1; a " +
      "lone element gives 0. That closed span is why a periodic function of it repeats its start " +
      "value on the last element — multiply by `(count - 1) / count` for a seam-free loop. Like " +
      "`index` it reads the slot, so it moves when the domain is filtered.",
    outputRange: [{ min: 0, max: 1, note: "inclusive at both ends" }],
  },
  () => detachedLeaf(fraction(), { fn: "fraction" }),
);
// UNIFORM, and the only leaf that is: the node seed is one number for the
// whole cook, which is exactly what makes the seed-shift idiom built on it
// worth folding.
register(
  "nodeSeed",
  "uniform",
  [],
  `{ fn: "nodeSeed" }`,
  {
    description:
      "The cooking node's own seed as a number, CONSTANT over the whole domain. It is the same " +
      "value `randomField` hashes, moving only when the graph's seed or the node's id changes. To make a " +
      "saved noise re-roll with the graph's seed box, write `opts.seed: {\"from\": \"node\", " +
      "\"variant\": N}` on the noise rather than folding this into its `opts.position`; the fold is " +
      "what older graphs contain and it is correct for exactly one (graph seed, node id) pair. The " +
      "value lands in an f32 column, so seeds above 2^24 round to a nearby multiple of a power of " +
      "two: it is a decorrelation source, not an integer to compare for equality against a reported " +
      "seed.",
  },
  () => detachedLeaf(nodeSeed(), { fn: "nodeSeed" }),
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
  {
    description:
      "A NAMED value standing where a literal would, so one number inside an expression becomes a " +
      "knob without a subgraph wrapped around it to carry the number. The value is " +
      "SUBSTITUTED at build time: the field comes out exactly as if the literal had been written, " +
      "key included. Resolution order is an outer binding first (`fieldFromJson`'s second " +
      "argument), then a Field an earlier call already spliced onto this node, then this node's own " +
      "`value`, then a refusal — a name nothing supplies builds but never evaluates, rather than " +
      "quietly reading zero. `min`, `max` and `description` document the inline `value` the way a " +
      "node's param schema documents a param, and are what a panel reads to label and bound the " +
      "knob; they are refused without a `value` to describe. The same name may appear several times " +
      "in one expression, and a panel then treats them as ONE knob and writes every one of them.",
  },
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

register(
  "randomField",
  "per-element",
  ["key"],
  `{ fn: "randomField", key?: 0 | "salt" }`,
  {
    description:
      "A per-element uniform random draw in [0, 1) — 1 is never returned. The distribution is flat, " +
      "so `lt(randomField(), 0.3)` keeps about 30% of the elements. `key` SALTS the stream " +
      "(any number or string, default 0), so two `randomField`s in one expression with different " +
      "keys are independent draws, and the same key on the same node at the same graph seed " +
      "reproduces the same numbers — the stream also carries the COOKING NODE's seed, so two nodes " +
      "writing `randomField()` draw differently. On the " +
      "point domain the draw is keyed on the point's IDENTITY — its stored position together with " +
      "its `seed` attribute — not on its slot, with two consequences worth knowing: filtering or " +
      "reordering upstream hands each point the number it already had, and MOVING a point changes " +
      "its draw, so draw before you jitter. Points that share a position and a seed draw alike (a " +
      "freshly created cloud is exactly that). On the primitive domain the key is the primitive's " +
      "own points; on vertex and detail it is the element index. Re-rolls with the graph's seed " +
      "box, unlike a noise carrying a literal `opts.seed`.",
    outputRange: [{ min: 0, max: 1, note: "half-open — 0 occurs, 1 never does" }],
  },
  (spec, path) => {
    const key = spec.key;
    if (key === undefined) return randomField();
    if (typeof key === "number" || typeof key === "string") return randomField(key);
    fail(`${path}.key`, "key must be a number or string");
  },
);

// -- combinators -----------------------------------------------------------

/** One named argument position. */
const arg = (name: string, description: string): ArgDoc => ({ name, description });

/** The 1/0 result every comparison produces. */
const PREDICATE_RANGE: readonly RangeDoc[] = [{ min: 0, max: 1, note: "1 or 0, nothing between" }];

/** The two operands of a comparison, whose prose is the same for all six. */
const COMPARE_ARGS: readonly ArgDoc[] = [
  arg("a", "Left-hand value."),
  arg("b", "Right-hand value."),
];

// All UNIFORM: an elementwise combinator's value at an element is a
// function of its arguments' values at that element and of nothing else,
// so it varies exactly as much as they do — which is what makes "every
// argument is uniform" a sufficient test for the whole subtree.
registerFixed(
  "add",
  "uniform",
  [arg("a", "First addend."), arg("b", "Second addend.")],
  `Elementwise \`a + b\`. ${BROADCAST}`,
  (f) => add(f[0], f[1]),
);
registerFixed(
  "sub",
  "uniform",
  [arg("a", "Value subtracted FROM."), arg("b", "Value subtracted.")],
  `Elementwise \`a - b\`. On a 0/1 predicate, \`sub(1, p)\` is logical NOT — the grammar has no ` +
    `\`not\` of its own. ${BROADCAST}`,
  (f) => sub(f[0], f[1]),
);
registerFixed(
  "mul",
  "uniform",
  [arg("a", "First factor."), arg("b", "Second factor.")],
  "Elementwise `a * b`. On 0/1 predicates (`lt`, `gt`, `eq`, `attributeIs`, …) this is logical " +
    `AND: the product is 1 only where both are. ${BROADCAST}`,
  (f) => mul(f[0], f[1]),
);
registerFixed(
  "div",
  "uniform",
  [arg("a", "Dividend."), arg("b", "Divisor. Not checked — see the description.")],
  "Elementwise `a / b`. Division by zero is NOT an error: it yields ±Infinity (and 0/0 yields " +
    "NaN), which then propagates through everything downstream and shows up as a non-finite count " +
    `in \`pcg inspect\`. Guard the divisor with \`max\` when it can reach zero. ${BROADCAST}`,
  (f) => div(f[0], f[1]),
);
registerFixed(
  "min",
  "uniform",
  [arg("a", "First value."), arg("b", "Second value.")],
  "Elementwise minimum. On 0/1 predicates this is logical AND, the same as `mul`. " + BROADCAST,
  (f) => min(f[0], f[1]),
);
registerFixed(
  "max",
  "uniform",
  [arg("a", "First value."), arg("b", "Second value.")],
  "Elementwise maximum. On 0/1 predicates this is logical OR: 1 wherever either one is. " +
    BROADCAST,
  (f) => max(f[0], f[1]),
);
registerFixed(
  "abs",
  "uniform",
  [arg("x", "Value whose sign is discarded.")],
  "Elementwise absolute value, component by component.",
  (f) => abs(f[0]),
);
registerFixed(
  "floor",
  "uniform",
  [arg("x", "Value to round down.")],
  "Elementwise floor: the largest integer at or below the value, so it rounds toward -Infinity " +
    "and `floor(-0.5)` is -1, not 0. `sub(x, floor(x))` is the fractional part, which is how a " +
    "value is wrapped into [0, 1).",
  (f) => floor(f[0]),
);
registerFixed(
  "clamp",
  "uniform",
  [
    arg("x", "Value to bound."),
    arg("lo", "Lower bound, returned wherever `x` falls below it."),
    arg("hi", "Upper bound, returned wherever `x` rises above it."),
  ],
  "Elementwise `min(max(x, lo), hi)`. The bounds are not checked against each other: with " +
    "`lo` above `hi` every element comes out as `hi`. A NaN `x` stays NaN — clamping does not " +
    `rescue one. ${BROADCAST}`,
  (f) => clamp(f[0], f[1], f[2]),
);
registerFixed(
  "lerp",
  "uniform",
  [
    arg("a", "Value at `t` = 0."),
    arg("b", "Value at `t` = 1."),
    arg("t", "Blend weight. Not clamped."),
  ],
  "Elementwise `a + (b - a) * t`. UNCLAMPED — a `t` outside [0, 1] extrapolates past the " +
    `endpoints — so wrap \`t\` in \`clamp\` when the result must stay between them. ${BROADCAST}`,
  (f) => lerp(f[0], f[1], f[2]),
);
registerFixed(
  "remap",
  "uniform",
  [
    arg("x", "Value to rescale."),
    arg("inMin", "Input value that maps to `outMin`."),
    arg("inMax", "Input value that maps to `outMax`."),
    arg("outMin", "Output at `inMin`."),
    arg("outMax", "Output at `inMax`."),
  ],
  "Elementwise linear rescale of `x` from [inMin, inMax] onto [outMin, outMax]. This is the usual " +
    "way to turn a signed noise into a usable multiplier, as `remap(noise, -1, 1, 0.5, 2)`. " +
    "UNCLAMPED: an " +
    "`x` outside the input range lands outside the output range, so wrap it in `clamp` when the " +
    "result must stay bounded. A degenerate input range (`inMax` equal to `inMin`) yields `outMin` " +
    `rather than a division by zero, and the ranges may run backwards. ${BROADCAST}`,
  (f) => remap(f[0], f[1], f[2], f[3], f[4]),
);
registerFixed(
  "select",
  "uniform",
  [
    arg("cond", "Condition. Any non-zero value is true, negatives and NaN included."),
    arg("whenTrue", "Result where `cond` is non-zero."),
    arg("whenFalse", "Result where `cond` is exactly 0."),
  ],
  "Elementwise conditional: `whenTrue` where `cond` is non-zero, `whenFalse` where it is exactly " +
    "0. BOTH branches are evaluated on every element — there is no short-circuit — so a branch that " +
    `would error or divide by zero still does. ${BROADCAST}`,
  (f) => select(f[0], f[1], f[2]),
);
registerFixed(
  "lt",
  "uniform",
  COMPARE_ARGS,
  `Elementwise \`a < b\` as 1 or 0. ${BROADCAST}`,
  (f) => lt(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "le",
  "uniform",
  COMPARE_ARGS,
  `Elementwise \`a <= b\` as 1 or 0. ${BROADCAST}`,
  (f) => le(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "gt",
  "uniform",
  COMPARE_ARGS,
  `Elementwise \`a > b\` as 1 or 0. ${BROADCAST}`,
  (f) => gt(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "ge",
  "uniform",
  COMPARE_ARGS,
  `Elementwise \`a >= b\` as 1 or 0. ${BROADCAST}`,
  (f) => ge(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "eq",
  "uniform",
  COMPARE_ARGS,
  "Elementwise EXACT equality as 1 or 0, tolerance-free. The two values are compared with `===` " +
    "after the usual f32 rounding, so this tests identical results and not 'close enough' — and " +
    "with the two edges that operator carries: -0 equals 0, and NaN equals nothing, itself " +
    `included. For an approximate test write \`lt(abs(sub(a, b)), epsilon)\`. ${BROADCAST}`,
  (f) => eq(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "ne",
  "uniform",
  COMPARE_ARGS,
  "Elementwise exact inequality as 1 or 0 — the complement of `eq`, and tolerance-free the same " +
    `way. ${BROADCAST}`,
  (f) => ne(f[0], f[1]),
  PREDICATE_RANGE,
);
registerFixed(
  "dot",
  "uniform",
  [arg("a", "First vector."), arg("b", "Second vector.")],
  "Per-element dot product: the sum over components of `a * b`, always SCALAR whatever the input " +
    "width. With unit vectors it is the cosine of the angle between them. There is no `cross` in " +
    "the grammar; a flat 2D perpendicular of a tangent `t` is written by hand as `vec(mul(t.z, -1), " +
    `0, t.x)\` using \`component\`. ${BROADCAST}`,
  (f) => dot(f[0], f[1]),
);
registerFixed(
  "length",
  "uniform",
  [arg("v", "Tuple whose magnitude is taken.")],
  "Euclidean length of each element's tuple, returned as a SCALAR; on a scalar input it is the " +
    "absolute value. This is the grammar's only way to reach a square root — there is no `sqrt`, " +
    "`pow`, `exp` or `mod` — so a shaped falloff is written with `ramp` rather than with an " +
    "exponent.",
  (f) => length(f[0]),
);
registerFixed(
  "normalize",
  "uniform",
  [arg("v", "Tuple to scale to unit length.")],
  "Scales each element's tuple to unit length, keeping its direction and its width. A zero tuple " +
    "stays zero rather than producing NaN. On a scalar input it yields the sign: -1, 0 or 1.",
  (f) => normalize(f[0]),
);
registerFixed(
  "sin",
  "uniform",
  [arg("x", "Angle in RADIANS.")],
  "Elementwise sine of an angle in RADIANS (not degrees). Deterministic within one engine; across " +
    "engines identical results are the practical norm rather than a spec guarantee.",
  (f) => sin(f[0]),
  [{ min: -1, max: 1 }],
);
registerFixed(
  "cos",
  "uniform",
  [arg("x", "Angle in RADIANS.")],
  "Elementwise cosine of an angle in RADIANS (not degrees). Deterministic within one engine; " +
    "across engines identical results are the practical norm rather than a spec guarantee.",
  (f) => cos(f[0]),
  [{ min: -1, max: 1 }],
);
registerFixed(
  "tan",
  "uniform",
  [arg("x", "Angle in RADIANS.")],
  "Elementwise tangent of an angle in RADIANS. UNBOUNDED — it grows without limit near ±π/2 — so " +
    "clamp the result before it multiplies a position.",
  (f) => tan(f[0]),
);
registerFixed(
  "asin",
  "uniform",
  [arg("x", "Sine value. Outside [-1, 1] the result is NaN.")],
  "Elementwise arcsine, in radians. An input outside [-1, 1] yields NaN rather than clamping, and " +
    "the NaN propagates through everything downstream — clamp the input when it is computed.",
  (f) => asin(f[0]),
  [{ min: -Math.PI / 2, max: Math.PI / 2 }],
);
registerFixed(
  "acos",
  "uniform",
  [arg("x", "Cosine value. Outside [-1, 1] the result is NaN.")],
  "Elementwise arccosine, in radians. An input outside [-1, 1] yields NaN rather than clamping, " +
    "and the NaN propagates — which is the usual failure of feeding it an un-normalized `dot`.",
  (f) => acos(f[0]),
  [{ min: 0, max: Math.PI }],
);
registerFixed(
  "atan",
  "uniform",
  [arg("x", "Tangent value.")],
  "Elementwise arctangent, in radians. Total over every finite input, unlike `asin` and `acos`. " +
    "Use `atan2` when you have both legs of the angle and need all four quadrants.",
  (f) => atan(f[0]),
  [{ min: -Math.PI / 2, max: Math.PI / 2, note: "open interval — the endpoints are limits" }],
);
registerFixed(
  "atan2",
  "uniform",
  [arg("y", "The Y leg. FIRST, as in the C signature."), arg("x", "The X leg.")],
  "Elementwise two-argument arctangent `atan2(y, x)`, in radians. It is the angle of the vector " +
    "(x, y), correct in all four quadrants. Note the argument ORDER — `y` comes first — which is " +
    `the usual way this one is written wrong. ${BROADCAST}`,
  (f) => atan2(f[0], f[1]),
  [{ min: -Math.PI, max: Math.PI }],
);

register(
  "vec",
  "uniform",
  ["args"],
  `{ fn: "vec", args: [x, y, z] }`,
  {
    description:
      "Concatenates its arguments into ONE tuple per element, so `vec(x, y, z)` builds a vec3 out " +
      "of three scalars. That is how a field-valued position or colour is assembled. A TUPLE argument " +
      "contributes all of its components, so the result's width is the sum of the inputs' widths " +
      "and not the number of arguments — `vec(someVec3, 1)` is a vec4. Takes one argument or more; " +
      "there is no broadcasting here, because nothing is being combined.",
    args: [
      arg(
        "components…",
        "One or more fields, numbers or tuples, concatenated in the order written. At least one.",
      ),
    ],
  },
  (spec, path) => {
    const args = requireArgs(spec, path, "variadic");
    return vec(...args.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
  },
);

register(
  "component",
  "uniform",
  ["args", "index"],
  `{ fn: "component", args: [tupleField], index: 0 }`,
  {
    description:
      "Extracts ONE component of each element's tuple as a scalar field: `index` 0 is x, 1 is y, 2 " +
      "is z, 3 is w. The inverse of `vec`, and how a single axis of `position` or of a `tangent` " +
      "attribute is read. An `index` at or beyond the input's tuple size throws when the field is " +
      "EVALUATED rather than when the graph is validated, because the width is not known until a " +
      "geometry is in hand.",
    args: [arg("tupleField", "The tuple-valued field to read one component of.")],
  },
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
  {
    description:
      "A piecewise-linear curve applied to a SCALAR field. `stops` is a list of `[inputPosition, " +
      "outputValue]` pairs — NOT normalized to 0..1: the positions are read in the input's own " +
      "units, so `[[4, 0], [30, 1]]` fades in between a distance of 4 and a distance of 30. " +
      "Positions must be STRICTLY ASCENDING (equal or descending positions are refused), and the " +
      "value between two stops is interpolated linearly. Outside the range the curve CLAMPS and " +
      "never extrapolates: an input at or below the first position yields the first value, at or " +
      "above the last yields the last, so a single stop is a constant. With no `pow` or `exp` in " +
      "the grammar this is how a shaped falloff is written. A non-scalar input throws at evaluation.",
    args: [arg("scalarField", "The value to look up along the curve. Must be tuple size 1.")],
  },
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

/** One documented range entry, read off the table the factories are built against. */
function noiseRange(range: readonly [number, number], note?: string): RangeDoc {
  return { min: range[0], max: range[1], ...(note !== undefined ? { note } : {}) };
}

/**
 * The integer-lattice trap, said in full on the two fns it bites.
 *
 * Perlin's gradients live AT the lattice points and the value it blends is
 * the dot product of a gradient with the offset FROM its lattice point, so
 * at an integer coordinate every offset is zero and so is the result — for
 * every seed, silently, with no error anywhere. It is documented here
 * rather than left to be discovered because a unit-spaced `pointGrid` with
 * a whole-number frequency is the most natural thing an author writes.
 *
 * Measured on this build: 40 points at unit spacing from [0,0,0] to
 * [39,0,0], `perlinNoise` at `frequency` 1 (and at 2, and at 3) gives min
 * 0, max 0, mean 0 — a dead attribute. The same points at 0.5 give
 * -0.408..0.408, and at 0.97 give -0.378..0.403. An INTEGER `offset` does
 * not help ([3,4,5] is still all zeros); a fractional one does. The
 * `the integer-lattice trap the catalog documents` suite in
 * fieldJson.test.ts pins the measurement so the prose cannot go stale.
 */
const LATTICE_TRAP =
  "TRAP: gradient noise is exactly 0 at every integer lattice point, so a sample position that " +
  "lands on whole numbers gives a SILENTLY DEAD field — no error, every element 0. Measured on " +
  "this build: 40 points at unit spacing from [0,0,0] to [39,0,0] at `frequency` 1 (or 2, or any " +
  "whole number) give min 0, max 0, stddev 0; the same points at `frequency` 0.5 give " +
  "-0.408..0.408. A unit-spaced `pointGrid` with a whole-number frequency is the most natural " +
  "thing to write, so check for it first. The fix is a fractional `frequency`, or a fractional " +
  "`offset` — an INTEGER offset such as [3, 4, 5] leaves the field just as dead.";

/** The three simple noises' catalog entries; the loop below registers them. */
const SIMPLE_NOISE_DOCS: Readonly<Record<string, FnDoc>> = {
  valueNoise: {
    description:
      "Value noise: one independent random value per integer lattice point, blended with a quintic " +
      "fade. UNSIGNED — the lattice values are drawn from [0, 1) and blended " +
      "convexly, so the output stays inside [0, 1] and `normalized: true` is the identity here. " +
      "Unlike `perlinNoise` it is not degenerate on integer coordinates: at a lattice point it " +
      "returns that point's own random value. Cheapest of the noises and the blockiest. " +
      NOISE_OPTS_DOC,
    outputRange: [noiseRange(NOISE_RAW_RANGES.valueNoise)],
  },
  perlinNoise: {
    description:
      "Perlin gradient noise: hash-selected cube-edge gradients, quintic fade, trilinear blend. " +
      "SIGNED and centred on 0. The documented bound is [-1, 1], but it is a BOUND and not an " +
      "amplitude — over 40,000 pseudo-random sample points the extremes reach only about ±0.75, and " +
      "most values sit far inside that — so size a multiplier against a measured cook (`pcg " +
      "inspect` reports min/max/mean per attribute) rather than against the bound. " +
      `${LATTICE_TRAP} ${NOISE_OPTS_DOC}`,
    outputRange: [
      noiseRange(NOISE_RAW_RANGES.perlinNoise, "documented bound; 40,000 samples reach only ~±0.75"),
      NORMALIZED_RANGE,
    ],
  },
  simplexNoise: {
    description:
      "Simplex noise, in Gustavson's 3D formulation with hashed gradients. SIGNED and centred on 0, " +
      "bounded by APPROXIMATELY [-1, 1] — the output scale is empirical, fitted to the largest raw " +
      "kernel sum seen over 1.28M samples with about 6% headroom left for rarer peaks, so unlike " +
      "perlin's this bound is not proved — and it is the widest-swinging of the three in practice: " +
      "the same 40,000 sample points that take `perlinNoise` to ±0.75 take this to ±0.94. The " +
      "kernel radius is r² = 0.5 so the field stays continuous across skew-cell boundaries, and the " +
      "lattice is SKEWED, so unlike `perlinNoise` it is not degenerate on integer world positions. " +
      NOISE_OPTS_DOC,
    outputRange: [
      noiseRange(
        NOISE_RAW_RANGES.simplexNoise,
        "approximate — an empirical scale with ~6% headroom, not a proved bound",
      ),
      NORMALIZED_RANGE,
    ],
  },
};

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
    SIMPLE_NOISE_DOCS[name],
    (spec, path) => NOISE_FACTORIES[name](parseNoiseOpts(spec, path, []).opts),
  );
}

register(
  "worleyNoise",
  "per-element",
  ["opts"],
  `{ fn: "worleyNoise", opts?: { seed?, frequency?, offset?, position?, normalized?, output?: "f1" | "f2" | "f2-f1", exact? } }`,
  {
    description:
      "Worley (cellular) noise: the Euclidean DISTANCE from the sample point to hashed feature " +
      "points, one per unit cell. It is a distance field — never negative, cell-shaped rather than " +
      "smooth. `opts.output` picks which distance: `f1` is the nearest feature (the " +
      "default), `f2` the second nearest, and `f2-f1` their difference, which is the ridged one " +
      "that outlines cell borders. The default search covers the 3x3x3 neighbouring cells and can " +
      "miss a closer feature just outside that block — measured over corner-adjacent queries, about " +
      "7e-5 of them return a wrong f1 and about 7e-4 a wrong f2, so the `f2` and `f2-f1` outputs " +
      "are the ones that miss most often. Error magnitudes run around 0.016, with an adversarial " +
      "worst case near 0.036. `opts.exact: true` widens the search until provably correct, at the " +
      `cost of more work. ${NOISE_OPTS_DOC}`,
    outputRange: [
      noiseRange(NOISE_RAW_RANGES.worleyNoise.f1, 'output: "f1" (the default) — at most a cube diagonal'),
      noiseRange(NOISE_RAW_RANGES.worleyNoise.f2, 'output: "f2"'),
      noiseRange(NOISE_RAW_RANGES.worleyNoise["f2-f1"], 'output: "f2-f1"'),
      NORMALIZED_RANGE,
    ],
  },
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
  {
    description:
      "Fractal Brownian motion: `octaves` layers of `base` summed at rising frequency and falling " +
      "amplitude, which turns one smooth noise into terrain-like detail. Octave o is " +
      "sampled at `frequency * lacunarity^o` with amplitude `gain^o` and its own derived seed; " +
      "`base` names one of valueNoise, perlinNoise, simplexNoise or worleyNoise. The sum is NOT " +
      "renormalized, so the raw range is the base's range times `(1 - gain^octaves) / (1 - gain)` — " +
      "with the defaults (4 octaves, gain 0.5) that factor is 1.875, so an fbm over `perlinNoise` " +
      "spans [-1.875, 1.875] rather than [-1, 1]. It INHERITS perlin's integer-lattice trap and " +
      "makes it worse: `lacunarity` defaults to 2, so every octave lands on the lattice together " +
      "and an fbm over `perlinNoise` sampled at a whole-number frequency on a unit-spaced grid is " +
      "measured dead — min 0, max 0, no error. Use a fractional `frequency` or a fractional " +
      "`offset`. `normalized: true` maps the per-configuration range onto [0, 1] and needs a base " +
      `whose fields carry range metadata, which the four standard factories do. ${NOISE_OPTS_DOC}`,
    outputRange: [
      {
        min: NOISE_RAW_RANGES.perlinNoise[0] * 1.875,
        max: NOISE_RAW_RANGES.perlinNoise[1] * 1.875,
        note: 'base: "perlinNoise" at the default octaves 4 / gain 0.5 — otherwise scale the base range by (1 - gain^octaves) / (1 - gain)',
      },
      NORMALIZED_RANGE,
    ],
  },
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

/**
 * JSON-safe metadata of one field-expression constructor.
 *
 * The shape mirrors what `NodeTypeInfo` publishes for a node type, because
 * the two catalogs answer the same question about the two halves of the
 * authoring language and an agent reading one must not be told less than
 * an agent reading the other: `description` is the prose a
 * `ParamSchema.description` would carry, `args` names the positions that
 * were otherwise `arg0..argN`, and `outputRange` states the numbers a
 * multiplier has to be sized against.
 */
export interface FieldFnInfo {
  /** The `fn` value in a spec. */
  readonly fn: string;
  /** Spec keys allowed besides `fn`, in declaration order. */
  readonly keys: readonly string[];
  /** Usage sketch — the same text the validation errors quote. */
  readonly usage: string;
  /**
   * What the fn computes, and the edges that bite: ranges, degenerate
   * inputs, what happens outside a domain. Never empty.
   */
  readonly description: string;
  /**
   * The `args` positions, in order, each named as the usage sketch spells
   * it. Absent for a fn that takes no `args` array. A name ending in `…`
   * marks a REPEATED position, so the list is shorter than the arity.
   */
  readonly args?: readonly { readonly name: string; readonly description: string }[];
  /**
   * The documented output range(s), where the fn has one worth stating —
   * every noise, the predicates, `randomField`, `fraction`, the inverse
   * trig. `note` names the configuration a range holds under (worley's
   * `output`, a noise's `normalized`) or qualifies the bounds where they
   * are not both attainable. Absent when the output is unbounded or
   * entirely a function of the inputs.
   */
  readonly outputRange?: readonly {
    readonly min: number;
    readonly max: number;
    readonly note?: string;
  }[];
}

/**
 * Metadata for every field constructor available in JSON specs, sorted by
 * name: the grammar's counterpart of {@link listNodeTypes}, and the
 * catalog an agent reads before writing a field-valued param.
 */
export function listFieldFnInfos(): FieldFnInfo[] {
  return listFieldFns().map((fn) => {
    const def = FNS.get(fn) as FnDef;
    const { description, args, outputRange } = def.doc;
    return {
      fn,
      keys: [...def.keys],
      usage: def.usage,
      description,
      // Copied out rather than shared: the registry's arrays are module
      // state, and a caller that mutated a returned one would edit the
      // catalog every later call reads.
      ...(args !== undefined ? { args: args.map((a) => ({ ...a })) } : {}),
      ...(outputRange !== undefined ? { outputRange: outputRange.map((r) => ({ ...r })) } : {}),
    };
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
 * How many times each name is READ, which {@link paramNamesOf} cannot say
 * because it answers a set question.
 *
 * The two counts differ wherever a name is worth hoisting: the rig's
 * `stretchMin` is read four times inside ONE expression, so a listing that
 * reports slots alone says "1" about the very case that makes it a param
 * rather than a literal. Both numbers are reported, because both are true
 * and neither implies the other.
 */
export function paramReadingCounts(spec: FieldSpec): Readonly<Record<string, number>> {
  // Null-prototype for the reason `inlineParamValuesOf` is: `__proto__` is
  // a legal param name and a setter on a plain object.
  const counts = Object.create(null) as Record<string, number>;
  eachParam(spec, (_node, name) => {
    counts[name] = (counts[name] ?? 0) + 1;
  });
  return counts;
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
