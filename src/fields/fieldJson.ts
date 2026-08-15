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
 * - `{ fn: "position" }` / `{ fn: "index" }`
 * - `{ fn: "fraction" }` — normalized index, `index / (count - 1)`:
 *   exactly 0 on the first element and exactly 1 on the last (a lone
 *   element gives 0)
 * - `{ fn: "randomField", key?: 0 | "salt" }`
 * - `{ fn: "param", name: "amplitude" }` — the value bound to that name,
 *   substituted at build time as if the literal had been written; a
 *   binding may also be a `Field`, and is then spliced in where the
 *   reference stands (see {@link fieldFromJson}'s `bindings`)
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
  splicedProvenance,
  withheldOver,
  withheldReason,
} from "./spec.js";
import { NOISE_BASES, WORLEY_OUTPUTS } from "../noise/bases.js";
import {
  type FbmOpts,
  type NoiseOpts,
  type WorleyNoiseOpts,
  fbm,
  worleyNoise,
} from "../noise/index.js";

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
export { type FieldSpec, type FieldSpecArg, getFieldSpec } from "./spec.js";

interface FnDef {
  /** Spec keys allowed besides `fn`. */
  readonly keys: readonly string[];
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

function register(name: string, keys: readonly string[], usage: string, build: FnDef["build"]): void {
  FNS.set(name, { keys, usage, build });
}

function registerFixed(name: string, arity: number, make: (fields: Field[]) => Field): void {
  const argNames = Array.from({ length: arity }, (_, i) => `arg${i}`).join(", ");
  register(name, ["args"], `{ fn: "${name}", args: [${argNames}] }`, (spec, path) => {
    const args = requireArgs(spec, path, arity);
    return make(args.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
  });
}

// -- inputs ----------------------------------------------------------------

register("constant", ["value"], `{ fn: "constant", value: 1 | [1, 2, 3] }`, (spec, path) => {
  const v = spec.value;
  if (typeof v === "number" && Number.isFinite(v)) return constant(v);
  if (isNumberArray(v)) return constant(v);
  fail(`${path}.value`, "constant requires a finite number or non-empty number array");
});

register(
  "attribute",
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

register("position", [], `{ fn: "position" }`, () => detachedLeaf(position(), { fn: "position" }));
register("index", [], `{ fn: "index" }`, () => detachedLeaf(index(), { fn: "index" }));
register("fraction", [], `{ fn: "fraction" }`, () =>
  detachedLeaf(fraction(), { fn: "fraction" }),
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
register("param", ["name"], `{ fn: "param", name: "amplitude" }`, (spec, path) => {
  const name = spec.name;
  if (typeof name !== "string" || name === "") {
    fail(`${path}.name`, "param requires a non-empty string name");
  }
  if (currentBindings === undefined || !Object.hasOwn(currentBindings, name)) {
    // Nothing bound in THIS call, but the node may still carry the spec
    // of a field a previous one spliced here (see `fieldFromJson`). That
    // is the value-free rebuild `specKernelKey` performs to key a kernel:
    // a spliced field decides the emitted WGSL, so it must be rebuilt,
    // where a spliced literal must not.
    const bound = paramSpecOf(spec as unknown as FieldSpec);
    if (bound !== undefined) return buildSpec(bound as Record<string, unknown>, `${path}<${name}>`);
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
});

register("randomField", ["key"], `{ fn: "randomField", key?: 0 | "salt" }`, (spec, path) => {
  const key = spec.key;
  if (key === undefined) return randomField();
  if (typeof key === "number" || typeof key === "string") return randomField(key);
  fail(`${path}.key`, "key must be a number or string");
});

// -- combinators -----------------------------------------------------------

registerFixed("add", 2, (f) => add(f[0], f[1]));
registerFixed("sub", 2, (f) => sub(f[0], f[1]));
registerFixed("mul", 2, (f) => mul(f[0], f[1]));
registerFixed("div", 2, (f) => div(f[0], f[1]));
registerFixed("min", 2, (f) => min(f[0], f[1]));
registerFixed("max", 2, (f) => max(f[0], f[1]));
registerFixed("abs", 1, (f) => abs(f[0]));
registerFixed("floor", 1, (f) => floor(f[0]));
registerFixed("clamp", 3, (f) => clamp(f[0], f[1], f[2]));
registerFixed("lerp", 3, (f) => lerp(f[0], f[1], f[2]));
registerFixed("remap", 5, (f) => remap(f[0], f[1], f[2], f[3], f[4]));
registerFixed("select", 3, (f) => select(f[0], f[1], f[2]));
registerFixed("lt", 2, (f) => lt(f[0], f[1]));
registerFixed("le", 2, (f) => le(f[0], f[1]));
registerFixed("gt", 2, (f) => gt(f[0], f[1]));
registerFixed("ge", 2, (f) => ge(f[0], f[1]));
registerFixed("eq", 2, (f) => eq(f[0], f[1]));
registerFixed("ne", 2, (f) => ne(f[0], f[1]));
registerFixed("dot", 2, (f) => dot(f[0], f[1]));
registerFixed("length", 1, (f) => length(f[0]));
registerFixed("normalize", 1, (f) => normalize(f[0]));
registerFixed("sin", 1, (f) => sin(f[0]));
registerFixed("cos", 1, (f) => cos(f[0]));
registerFixed("tan", 1, (f) => tan(f[0]));
registerFixed("asin", 1, (f) => asin(f[0]));
registerFixed("acos", 1, (f) => acos(f[0]));
registerFixed("atan", 1, (f) => atan(f[0]));
registerFixed("atan2", 2, (f) => atan2(f[0], f[1]));

register("vec", ["args"], `{ fn: "vec", args: [x, y, z] }`, (spec, path) => {
  const args = requireArgs(spec, path, "variadic");
  return vec(...args.map((a, i) => buildArg(a, `${path}.args[${i}]`)));
});

register(
  "component",
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
    seed?: number;
    frequency?: number;
    offset?: readonly [number, number, number];
    position?: FieldLike;
    normalized?: boolean;
  } = {};
  if (rawOpts.seed !== undefined) {
    if (typeof rawOpts.seed !== "number" || !Number.isInteger(rawOpts.seed)) {
      fail(`${path}.opts.seed`, "seed must be an integer");
    }
    opts.seed = rawOpts.seed;
  }
  if (rawOpts.frequency !== undefined) {
    if (typeof rawOpts.frequency !== "number" || !Number.isFinite(rawOpts.frequency)) {
      fail(`${path}.opts.frequency`, "frequency must be a finite number");
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

for (const name of ["valueNoise", "perlinNoise", "simplexNoise"] as const) {
  register(
    name,
    ["opts"],
    `{ fn: "${name}", opts?: { seed?, frequency?, offset?: [x,y,z], position?, normalized? } }`,
    (spec, path) => NOISE_FACTORIES[name](parseNoiseOpts(spec, path, []).opts),
  );
}

register(
  "worleyNoise",
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
 * are `args` entries and `opts.position` — the noise samplers' position
 * input is an argument position like any other, which is why a `param`
 * can appear there too (`collectAttrNames` in `src/gpu/compile.ts` walks
 * the same two).
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
  const args = v.args;
  if (Array.isArray(args)) {
    for (const a of args) walkSpecNodes(a, visit, seen);
  }
  const opts = v.opts;
  if (isPlainObject(opts)) walkSpecNodes(opts.position, visit, seen);
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
  if (bindings !== undefined) {
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
    eachParam(authored, (node, name) => {
      if (!Object.hasOwn(bindings, name)) return;
      const value = bindings[name];
      const target = node as unknown as FieldSpec;
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
          return;
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
          return;
        }
        attachParamSpec(target, bound);
        // Transitive: a bound field may itself have been built with
        // bindings, and what IT spliced is just as much part of what this
        // expression computes. Reading the record back is what keeps the
        // walk from stopping one level down.
        const inherited = splicedProvenance(bound);
        if (inherited === "opaque") {
          spliced = "opaque";
          return;
        }
        if ((isDerivedSpec(bound) || inherited === "derived") && spliced === undefined) {
          spliced = "derived";
        }
        return;
      }
      // Copied, never referenced: the field's key was fixed from this
      // value at construction, so a caller who later mutates the array
      // they passed would leave the recorded arity and the key describing
      // different numbers — and the device would then write bytes the CPU
      // never produced. The copy is what makes the record as immutable as
      // the key it belongs to.
      attachParamValue(target, typeof value === "number" ? value : [...value]);
    });
    if (spliced !== undefined) recordSplicedProvenance(authored, spliced);
  }
  attachAuthoredSpec(field, authored, deepestLevel);
  return field;
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
