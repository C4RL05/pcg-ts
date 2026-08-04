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
 * - `{ fn: "randomField", key?: 0 | "salt" }`
 * - `{ fn: "add", args: [a, b] }` — likewise sub, mul, div, min, max,
 *   lt, le, gt, ge, eq, dot (2 args); abs, floor, length, normalize
 *   (1 arg); clamp, lerp, select (3); remap (5); vec (1+)
 * - `{ fn: "component", args: [a], index: 0 }`
 * - `{ fn: "ramp", args: [a], stops: [[0, 0], [1, 1]] }`
 * - `{ fn: "valueNoise" | "perlinNoise" | "simplexNoise", opts?: { seed?,
 *   frequency?, offset?: [x,y,z], position?: spec } }`
 * - `{ fn: "worleyNoise", opts?: { ...noise opts, output?: "f1" | "f2" | "f2-f1" } }`
 * - `{ fn: "fbm", base: "perlinNoise", opts?: { ...noise opts, octaves?,
 *   lacunarity?, gain? } }`
 */
import {
  type Field,
  type FieldLike,
  abs,
  add,
  attribute,
  clamp,
  component,
  constant,
  div,
  dot,
  eq,
  floor,
  ge,
  gt,
  index,
  isField,
  le,
  length,
  lerp,
  lt,
  max,
  min,
  mul,
  normalize,
  position,
  ramp,
  randomField,
  remap,
  select,
  sub,
  vec,
} from "../fields/index.js";
import {
  type FbmOpts,
  type NoiseFactory,
  type NoiseOpts,
  type WorleyNoiseOpts,
  fbm,
  perlinNoise,
  simplexNoise,
  valueNoise,
  worleyNoise,
} from "../noise/index.js";

/** Errors raised while converting fields to or from JSON specs. */
export class FieldJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldJsonError";
  }
}

/** A JSON field expression: a constructor name plus its arguments. */
export interface FieldSpec {
  /** Field constructor name; see {@link listFieldFns}. */
  readonly fn: string;
  readonly [key: string]: unknown;
}

/** An argument position: a nested spec, or a number/tuple (wraps into constant). */
export type FieldSpecArg = FieldSpec | number | readonly number[];

/** @internal Symbol under which fieldFromJson attaches the original spec. */
const FIELD_SPEC: unique symbol = Symbol("pcg-ts.fieldSpec");

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

function buildSpec(spec: Record<string, unknown>, path: string): Field {
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

register("position", [], `{ fn: "position" }`, () => position());
register("index", [], `{ fn: "index" }`, () => index());

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
registerFixed("dot", 2, (f) => dot(f[0], f[1]));
registerFixed("length", 1, (f) => length(f[0]));
registerFixed("normalize", 1, (f) => normalize(f[0]));

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

const NOISE_FACTORIES: Record<string, NoiseFactory> = {
  valueNoise,
  perlinNoise,
  simplexNoise,
  worleyNoise,
};

const NOISE_OPT_KEYS = ["seed", "frequency", "offset", "position"] as const;
const WORLEY_OUTPUTS = ["f1", "f2", "f2-f1"] as const;

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
  return { opts, raw: rawOpts };
}

for (const name of ["valueNoise", "perlinNoise", "simplexNoise"] as const) {
  register(
    name,
    ["opts"],
    `{ fn: "${name}", opts?: { seed?, frequency?, offset?: [x,y,z], position? } }`,
    (spec, path) => NOISE_FACTORIES[name](parseNoiseOpts(spec, path, []).opts),
  );
}

register(
  "worleyNoise",
  ["opts"],
  `{ fn: "worleyNoise", opts?: { seed?, frequency?, offset?, position?, output?: "f1" | "f2" | "f2-f1" } }`,
  (spec, path) => {
    const { opts, raw } = parseNoiseOpts(spec, path, ["output"]);
    const worleyOpts: WorleyNoiseOpts = { ...opts };
    if (raw.output !== undefined) {
      if (typeof raw.output !== "string" || !(WORLEY_OUTPUTS as readonly string[]).includes(raw.output)) {
        fail(`${path}.opts.output`, `output must be one of: ${WORLEY_OUTPUTS.join(", ")}`);
      }
      worleyOpts.output = raw.output as WorleyNoiseOpts["output"];
    }
    return worleyNoise(worleyOpts);
  },
);

register(
  "fbm",
  ["base", "opts"],
  `{ fn: "fbm", base: "perlinNoise", opts?: { seed?, frequency?, offset?, position?, octaves?, lacunarity?, gain? } }`,
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
 * Build a Field from a declarative JSON spec. Validates the constructor
 * name and every argument (errors name the failing path and list valid
 * alternatives), and attaches a copy of the spec to the resulting field
 * so {@link fieldToJson} can serialize it back.
 */
export function fieldFromJson(spec: FieldSpec): Field {
  if (!isPlainObject(spec)) {
    throw new FieldJsonError(`fieldFromJson: expected a spec object, got ${describeValue(spec)}`);
  }
  const field = buildSpec(spec, "$");
  (field as unknown as Record<symbol, unknown>)[FIELD_SPEC] = structuredClone(spec);
  return field;
}

/**
 * Serialize a field back to the JSON spec it was built from. Only fields
 * constructed by {@link fieldFromJson} carry a spec; code-authored fields
 * throw an actionable error.
 */
export function fieldToJson(field: Field): FieldSpec {
  if (!isField(field)) {
    throw new FieldJsonError("fieldToJson: value is not a Field");
  }
  const spec = (field as unknown as Record<symbol, unknown>)[FIELD_SPEC];
  if (spec === undefined) {
    throw new FieldJsonError(
      "fieldToJson: this field was authored in code and carries no JSON spec; construct it via fieldFromJson to make it serializable",
    );
  }
  return structuredClone(spec) as FieldSpec;
}
