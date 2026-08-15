/**
 * Derived field specs: the "two descriptions, one field" invariant.
 *
 * A code-authored field now carries a `FieldSpec` composed from its
 * inputs' specs. That creates a second, parallel description of the same
 * computation — the CPU runs the closure, everything else reads the
 * spec — and any disagreement between them is a silent numeric
 * divergence with no error anywhere. So the correspondence is PROVEN per
 * constructor, not argued:
 *
 *   fieldFromJson(getFieldSpec(f))  ≡  f    (key, tuple size, and bytes)
 *
 * over an argument matrix that exercises every registered grammar fn.
 */
import { describe, expect, it } from "vitest";
import { createPointCloud } from "../data/index.js";
import { fbm, perlinNoise, simplexNoise, valueNoise, worleyNoise } from "../noise/index.js";
import { fieldFromJson, listFieldFns } from "./fieldJson.js";
import {
  abs,
  acos,
  add,
  asin,
  atan,
  atan2,
  clamp,
  component,
  cos,
  div,
  dot,
  eq,
  floor,
  ge,
  gt,
  le,
  length,
  lerp,
  lt,
  max,
  min,
  mul,
  ne,
  normalize,
  ramp,
  remap,
  select,
  sin,
  sub,
  tan,
  vec,
} from "./combinators.js";
import { attribute, constant, fraction, index, position, randomField } from "./inputs.js";
import {
  type FieldSpec,
  deviceSpec,
  getFieldSpec,
  isDerivedSpec,
  peekFieldSpec,
  specFallbackReason,
} from "./spec.js";
import {
  type Column,
  type EvalContext,
  type Field,
  type FieldLike,
  evaluateField,
  makeField,
} from "./types.js";

/**
 * The spec a device seam would see with `acceptDerivedSpecs` OFF — the
 * default gate, and the only reading of "authored" the library still
 * has now that provenance is asked through one flagged predicate.
 */
const authoredSpec = (field: Field): FieldSpec | undefined => deviceSpec(field, false);

const COUNT = 24;

/**
 * A point cloud with the attributes the matrix reads, filled with values
 * that are neither uniform nor symmetric (so a wrong component index or
 * a swapped argument shows up in the bytes).
 */
function fixture(seed: number): EvalContext {
  const geo = createPointCloud(COUNT);
  const set = geo.attrs.point;
  const P = set.require("P");
  for (let i = 0; i < COUNT; i++) {
    P.data[i * 3] = Math.sin(i) * 3;
    P.data[i * 3 + 1] = Math.cos(i * 0.7) * 2;
    P.data[i * 3 + 2] = i * 0.25 - 3;
  }
  const density = set.require("density");
  for (let i = 0; i < COUNT; i++) density.data[i] = (i % 7) / 6 - 0.5;
  const normal = set.add("normal", "f32", 3);
  for (let i = 0; i < COUNT; i++) {
    normal.data[i * 3] = ((i % 5) - 2) / 2;
    normal.data[i * 3 + 1] = ((i % 3) - 1) / 2;
    normal.data[i * 3 + 2] = ((i % 4) - 1.5) / 2;
  }
  const flag = set.add("flag", "bool");
  for (let i = 0; i < COUNT; i++) flag.set(i, i % 3 === 0 ? 1 : 0);
  const tag = set.add("tag", "u32", 1);
  for (let i = 0; i < COUNT; i++) tag.data[i] = (i * 7) % 11;
  return { geo, domain: "point", seed };
}

/** Raw bytes of a column, so NaN payloads and -0 compare exactly. */
function columnBytes(col: Column): number[] {
  return Array.from(new Uint8Array(col.data.buffer, col.data.byteOffset, col.data.byteLength));
}

function expectSameColumn(actual: Column, expected: Column, label: string): void {
  expect(actual.tupleSize, `${label}: tupleSize`).toBe(expected.tupleSize);
  expect(actual.data.constructor.name, `${label}: storage`).toBe(expected.data.constructor.name);
  expect(actual.data.length, `${label}: length`).toBe(expected.data.length);
  expect(columnBytes(actual), `${label}: bytes`).toEqual(columnBytes(expected));
}

/** A field whose evaluator is an arbitrary closure: no spec can name it. */
function opaque(tupleSize: number): Field {
  return makeField(`opaque${tupleSize}`, tupleSize, (ctx) => {
    const n = ctx.geo.attrs[ctx.domain].count;
    const data = new Float32Array(n * tupleSize);
    for (let i = 0; i < data.length; i++) data[i] = i * 0.5;
    return { data, tupleSize };
  });
}

// -- the argument matrix ----------------------------------------------------

/** Spec'd operands spanning tuple sizes, storage types, and depth. */
const S = (): Field => constant(0.5);
const T3 = (): Field => constant([0.25, -0.5, 2]);
const P = (): Field => position();
const DEN = (): Field => attribute("density");
const N3 = (): Field => attribute("normal", 3);
const IDX = (): Field => index();
const RND = (): Field => randomField("salt");
const NSE = (): Field => perlinNoise({ seed: 7, frequency: 0.5 });
const NEST = (): Field => add(component(position(), 1), mul(randomField("nest"), 2));

/** Argument tuples for unary combinators. */
const UNARY: Array<() => FieldLike[]> = [
  () => [S()],
  () => [T3()],
  () => [P()],
  () => [DEN()],
  () => [N3()],
  () => [IDX()],
  () => [RND()],
  () => [NSE()],
  () => [NEST()],
  () => [-2.5],
];

/** Argument tuples for binary combinators (broadcast-legal pairs). */
const BINARY: Array<() => FieldLike[]> = [
  () => [S(), S()],
  () => [S(), T3()],
  () => [T3(), S()],
  () => [T3(), T3()],
  () => [P(), S()],
  () => [P(), T3()],
  () => [DEN(), S()],
  () => [N3(), P()],
  () => [IDX(), RND()],
  () => [NSE(), S()],
  () => [NEST(), S()],
  () => [RND(), NSE()],
  () => [3, DEN()],
  () => [DEN(), 0.75],
];

/** Argument tuples for ternary combinators. */
const TERNARY: Array<() => FieldLike[]> = [
  () => [S(), S(), S()],
  () => [P(), S(), T3()],
  () => [DEN(), RND(), NSE()],
  () => [T3(), 0, P()],
  () => [NEST(), IDX(), RND()],
];

interface Case {
  readonly name: string;
  readonly make: () => Field;
  /** False when the field legitimately throws at evaluation time. */
  readonly evaluable?: boolean;
}

function spread(
  fn: string,
  tuples: ReadonlyArray<() => FieldLike[]>,
  build: (args: FieldLike[]) => Field,
): Case[] {
  return tuples.map((args, i) => ({ name: `${fn} #${i}`, make: () => build(args()) }));
}

const CASES: Case[] = [
  // -- inputs ---------------------------------------------------------
  { name: "constant scalar", make: () => constant(1) },
  { name: "constant tuple", make: () => constant([1, 2, 3]) },
  { name: "constant one-element tuple", make: () => constant([7]) },
  { name: "attribute untyped", make: () => attribute("density") },
  { name: "attribute with tupleSize", make: () => attribute("normal", 3) },
  { name: "attribute bool storage", make: () => attribute("flag") },
  { name: "attribute u32 storage", make: () => attribute("tag") },
  { name: "position", make: () => position() },
  { name: "index", make: () => index() },
  { name: "fraction", make: () => fraction() },
  { name: "randomField default key", make: () => randomField() },
  { name: "randomField numeric key", make: () => randomField(7) },
  { name: "randomField negative key", make: () => randomField(-3) },
  { name: "randomField string key", make: () => randomField("species") },

  // -- elementwise (25) -----------------------------------------------
  ...spread("add", BINARY, (a) => add(a[0], a[1])),
  ...spread("sub", BINARY, (a) => sub(a[0], a[1])),
  ...spread("mul", BINARY, (a) => mul(a[0], a[1])),
  ...spread("div", BINARY, (a) => div(a[0], a[1])),
  ...spread("min", BINARY, (a) => min(a[0], a[1])),
  ...spread("max", BINARY, (a) => max(a[0], a[1])),
  ...spread("atan2", BINARY, (a) => atan2(a[0], a[1])),
  ...spread("lt", BINARY, (a) => lt(a[0], a[1])),
  ...spread("le", BINARY, (a) => le(a[0], a[1])),
  ...spread("gt", BINARY, (a) => gt(a[0], a[1])),
  ...spread("ge", BINARY, (a) => ge(a[0], a[1])),
  ...spread("eq", BINARY, (a) => eq(a[0], a[1])),
  ...spread("ne", BINARY, (a) => ne(a[0], a[1])),
  ...spread("abs", UNARY, (a) => abs(a[0])),
  ...spread("floor", UNARY, (a) => floor(a[0])),
  ...spread("sin", UNARY, (a) => sin(a[0])),
  ...spread("cos", UNARY, (a) => cos(a[0])),
  ...spread("tan", UNARY, (a) => tan(a[0])),
  ...spread("asin", UNARY, (a) => asin(a[0])),
  ...spread("acos", UNARY, (a) => acos(a[0])),
  ...spread("atan", UNARY, (a) => atan(a[0])),
  ...spread("clamp", TERNARY, (a) => clamp(a[0], a[1], a[2])),
  ...spread("lerp", TERNARY, (a) => lerp(a[0], a[1], a[2])),
  ...spread("select", TERNARY, (a) => select(a[0], a[1], a[2])),
  { name: "remap literals", make: () => remap(randomField("size"), 0, 1, 0.6, 1.5) },
  { name: "remap fields", make: () => remap(P(), S(), T3(), constant(0), constant(1)) },
  { name: "remap degenerate range", make: () => remap(NSE(), 1, 1, 0, 10) },

  // -- bespoke combinators --------------------------------------------
  ...spread("dot", BINARY, (a) => dot(a[0], a[1])),
  ...spread("length", UNARY, (a) => length(a[0])),
  ...spread("normalize", UNARY, (a) => normalize(a[0])),
  { name: "vec of one", make: () => vec(S()) },
  { name: "vec of scalars", make: () => vec(DEN(), RND(), IDX()) },
  { name: "vec mixing tuple sizes", make: () => vec(T3(), N3(), S()) },
  { name: "vec of literals", make: () => vec(1, 2, 3) },
  { name: "component 0 of tuple", make: () => component(T3(), 0) },
  { name: "component 2 of tuple", make: () => component(T3(), 2) },
  { name: "component of position", make: () => component(P(), 1) },
  { name: "component of attribute", make: () => component(N3(), 2) },
  { name: "component of scalar", make: () => component(NEST(), 0) },
  { name: "ramp two stops", make: () => ramp(DEN(), [[0, 0], [1, 1]]) },
  { name: "ramp three stops", make: () => ramp(RND(), [[-1, 2], [0, 0.5], [1, -3]]) },
  { name: "ramp single stop", make: () => ramp(S(), [[0.5, 7]]) },

  // -- noise ----------------------------------------------------------
  { name: "valueNoise defaults", make: () => valueNoise() },
  { name: "valueNoise seeded", make: () => valueNoise({ seed: 5 }) },
  { name: "valueNoise full opts", make: () => valueNoise({ seed: -3, frequency: 2.5, offset: [1, -2, 0.5] }) },
  { name: "valueNoise normalized", make: () => valueNoise({ seed: 2, normalized: true }) },
  { name: "perlinNoise defaults", make: () => perlinNoise() },
  { name: "perlinNoise full opts", make: () => perlinNoise({ seed: 11, frequency: 0.3, offset: [-1, 0, 4] }) },
  { name: "perlinNoise normalized", make: () => perlinNoise({ normalized: true }) },
  {
    name: "perlinNoise over a derived position",
    make: () => perlinNoise({ seed: 4, position: vec(component(position(), 0), constant(1), component(position(), 2)) }),
  },
  { name: "simplexNoise defaults", make: () => simplexNoise() },
  { name: "simplexNoise seeded", make: () => simplexNoise({ seed: 8, frequency: 1.25 }) },
  { name: "simplexNoise normalized", make: () => simplexNoise({ seed: 1, normalized: true }) },
  { name: "worleyNoise defaults", make: () => worleyNoise() },
  { name: "worleyNoise f2", make: () => worleyNoise({ output: "f2", seed: 6 }) },
  { name: "worleyNoise f2-f1 exact", make: () => worleyNoise({ output: "f2-f1", exact: true }) },
  { name: "worleyNoise f1 exact normalized", make: () => worleyNoise({ output: "f1", exact: true, normalized: true }) },
  { name: "worleyNoise offset", make: () => worleyNoise({ seed: 9, frequency: 0.3, offset: [2, 2, 2] }) },

  // -- fbm ------------------------------------------------------------
  { name: "fbm defaults", make: () => fbm(perlinNoise) },
  { name: "fbm single octave", make: () => fbm(valueNoise, { octaves: 1 }) },
  { name: "fbm tuned", make: () => fbm(simplexNoise, { octaves: 3, lacunarity: 1.7, gain: 0.6, seed: 11 }) },
  { name: "fbm negative gain", make: () => fbm(perlinNoise, { octaves: 3, gain: -0.5 }) },
  { name: "fbm worley base", make: () => fbm(worleyNoise, { octaves: 2 }) },
  { name: "fbm normalized", make: () => fbm(perlinNoise, { octaves: 2, normalized: true, frequency: 0.4, offset: [1, 2, 3] }) },
  {
    name: "fbm over a derived position",
    make: () => fbm(perlinNoise, { octaves: 2, position: mul(position(), 0.5) }),
  },
];

describe("derived spec round-trip", () => {
  /**
   * `param` is the one grammar fn NO constructor derives, and the
   * exclusion is a statement about the feature rather than a gap in this
   * matrix. A `param` names a value supplied at bind time; in TypeScript
   * you have variables, so you write `constant(amp)` (or pass `amp`
   * straight into the combinator) and the spec that derives from it says
   * `constant` — correctly, because that is what was built. The fn exists
   * for JSON, where there are no variables, and it is reachable only
   * through `fieldFromJson`, which is where its round trip is pinned
   * (`src/fields/fieldJson.test.ts`).
   *
   * So the invariant this asserts is "every DERIVABLE fn is covered
   * here", with the one exception named rather than skip-listed: a fn
   * added later that no constructor derives must justify itself the same
   * way, not simply appear in a filter.
   */
  const JSON_ONLY = new Set(["param"]);

  it("the matrix reaches every grammar fn a constructor can derive", () => {
    const reached = new Set<string>();
    for (const c of CASES) {
      const spec = getFieldSpec(c.make());
      if (spec !== undefined) reached.add(spec.fn);
    }
    expect([...reached].sort()).toEqual(listFieldFns().filter((fn) => !JSON_ONLY.has(fn)));
  });

  it("the JSON-only fns really are underivable, not merely unlisted", () => {
    // The exception has to stay earned: if a constructor ever starts
    // deriving `param`, the filter above would silently hide the case
    // instead of covering it. A derivation would have to come from a
    // Field the combinator API produced, and nothing in that API can
    // produce one — the only way to get a `param` spec is to author it.
    const spec = fieldFromJson({ fn: "param", name: "amp" }, { amp: 2 });
    expect(getFieldSpec(spec)?.fn, "authored param keeps its reference").toBe("param");
    // ...while the same value written as a literal derives `constant`,
    // which is the whole reason no constructor needs `param`.
    expect(getFieldSpec(constant(2))?.fn).toBe("constant");
  });

  for (const c of CASES) {
    it(`${c.name}: fieldFromJson(getFieldSpec(f)) is byte-identical to f`, () => {
      const field = c.make();
      const spec = getFieldSpec(field);
      expect(spec, `${c.name}: no derived spec`).toBeDefined();

      // Surviving `fieldFromJson` is itself an assertion: it re-validates
      // every value and `checkKeys` rejects any key the grammar does not
      // know (which is why the derived marker lives outside the object).
      const rebuilt = fieldFromJson(spec as FieldSpec);
      expect(rebuilt.key, `${c.name}: structural key`).toBe(field.key);
      expect(rebuilt.tupleSize, `${c.name}: static tuple size`).toBe(field.tupleSize);

      for (const seed of [0, 987654321]) {
        const ctx = fixture(seed);
        expectSameColumn(
          evaluateField(rebuilt, ctx),
          evaluateField(field, ctx),
          `${c.name} @seed ${seed}`,
        );
      }

      // The spec must also survive a real JSON round trip, or a graph
      // holding this field could serialize and fail to come back.
      const viaJson = fieldFromJson(JSON.parse(JSON.stringify(spec)) as FieldSpec);
      expect(viaJson.key, `${c.name}: key after JSON`).toBe(field.key);

      // Derivation is a pure function of the arguments.
      expect(getFieldSpec(c.make()), `${c.name}: derivation is stable`).toEqual(spec);
    });
  }
});

describe("derived spec shapes", () => {
  /**
   * The round-trip proves a derived spec REBUILDS the same field, which
   * several wrong specs also manage — `{ key: <hash> }` for a
   * `randomField` rebuilds identically because the hash is already a
   * uint32 and `>>> 0` is idempotent. The spec is also what a serialized
   * graph shows a human and an agent, so its shape is pinned directly.
   */
  it("randomField carries the author's key, not the hash it computed", () => {
    expect(getFieldSpec(randomField("species"))).toEqual({ fn: "randomField", key: "species" });
    expect(getFieldSpec(randomField(-3))).toEqual({ fn: "randomField", key: -3 });
    expect(getFieldSpec(randomField())).toEqual({ fn: "randomField", key: 0 });
  });

  it("names its arguments the way the grammar spells them", () => {
    expect(getFieldSpec(constant(2))).toEqual({ fn: "constant", value: 2 });
    expect(getFieldSpec(constant([1, 2]))).toEqual({ fn: "constant", value: [1, 2] });
    expect(getFieldSpec(attribute("density"))).toEqual({ fn: "attribute", name: "density" });
    expect(getFieldSpec(attribute("normal", 3))).toEqual({
      fn: "attribute",
      name: "normal",
      tupleSize: 3,
    });
    expect(getFieldSpec(component(position(), 2))).toEqual({
      fn: "component",
      args: [{ fn: "position" }],
      index: 2,
    });
    expect(getFieldSpec(ramp(attribute("density"), [[0, 1], [2, 3]]))).toEqual({
      fn: "ramp",
      args: [{ fn: "attribute", name: "density" }],
      stops: [[0, 1], [2, 3]],
    });
    expect(getFieldSpec(vec(constant(1), constant(2)))).toEqual({
      fn: "vec",
      args: [{ fn: "constant", value: 1 }, { fn: "constant", value: 2 }],
    });
  });

  it("normalizes noise options the way the structural key does", () => {
    expect(getFieldSpec(worleyNoise({ seed: 4, output: "f2", exact: true }))).toEqual({
      fn: "worleyNoise",
      opts: { seed: 4, frequency: 1, offset: [0, 0, 0], output: "f2", exact: true },
    });
    // The factory coerces the seed with `>>> 0`; the spec carries the
    // coerced value, which is what the key was built from.
    expect(getFieldSpec(perlinNoise({ seed: -1 }))).toEqual({
      fn: "perlinNoise",
      opts: { seed: 4294967295, frequency: 1, offset: [0, 0, 0] },
    });
    expect(getFieldSpec(fbm(simplexNoise, { octaves: 2, gain: 0.25 }))).toEqual({
      fn: "fbm",
      base: "simplexNoise",
      opts: { seed: 0, frequency: 1, offset: [0, 0, 0], octaves: 2, lacunarity: 2, gain: 0.25 },
    });
  });
});

describe("elementwise kind ↔ grammar fn", () => {
  /**
   * Every elementwise combinator derives `{ fn: <its kind> }`, which
   * only works because `elementwise`'s `kind` string is exactly the
   * grammar's registered fn name. Pinned here so a rename cannot quietly
   * produce specs naming a fn that does not exist.
   */
  const ELEMENTWISE: ReadonlyArray<readonly [string, () => Field]> = [
    ["add", () => add(1, 2)],
    ["sub", () => sub(1, 2)],
    ["mul", () => mul(1, 2)],
    ["div", () => div(1, 2)],
    ["min", () => min(1, 2)],
    ["max", () => max(1, 2)],
    ["abs", () => abs(1)],
    ["floor", () => floor(1)],
    ["sin", () => sin(1)],
    ["cos", () => cos(1)],
    ["tan", () => tan(1)],
    ["asin", () => asin(1)],
    ["acos", () => acos(1)],
    ["atan", () => atan(1)],
    ["atan2", () => atan2(1, 2)],
    ["clamp", () => clamp(1, 0, 2)],
    ["lerp", () => lerp(1, 2, 0.5)],
    ["remap", () => remap(1, 0, 1, 2, 3)],
    ["select", () => select(1, 2, 3)],
    ["lt", () => lt(1, 2)],
    ["le", () => le(1, 2)],
    ["gt", () => gt(1, 2)],
    ["ge", () => ge(1, 2)],
    ["eq", () => eq(1, 2)],
    ["ne", () => ne(1, 2)],
  ];

  it("names 25 constructors, each a registered fn", () => {
    expect(ELEMENTWISE.length).toBe(25);
    const registered = new Set(listFieldFns());
    for (const [name, make] of ELEMENTWISE) {
      expect(getFieldSpec(make())?.fn, `${name}: derived fn`).toBe(name);
      expect(registered.has(name), `${name}: registered in the grammar`).toBe(true);
    }
  });
});

describe("no spec is derived when none can be", () => {
  const NONE: Case[] = [
    { name: "makeField", make: () => opaque(1) },
    { name: "combinator over makeField", make: () => add(opaque(1), 1) },
    { name: "deep tree over makeField", make: () => clamp(mul(opaque(1), 2), 0, 1) },
    { name: "vec containing makeField", make: () => vec(constant(1), opaque(1)) },
    { name: "component of makeField", make: () => component(opaque(3), 1) },
    { name: "ramp over makeField", make: () => ramp(opaque(1), [[0, 0], [1, 1]]) },
    { name: "dot with makeField", make: () => dot(position(), opaque(3)) },
    { name: "length of makeField", make: () => length(opaque(3)) },
    { name: "normalize of makeField", make: () => normalize(opaque(3)) },
    { name: "noise over a spec-less position", make: () => perlinNoise({ position: opaque(3) }) },
    {
      name: "normalized noise over a spec-less position",
      make: () => valueNoise({ position: opaque(3), normalized: true }),
    },
    { name: "worley over a spec-less position", make: () => worleyNoise({ position: opaque(3) }) },
    { name: "fbm over a spec-less base", make: () => fbm(() => opaque(1) as Field<1>) },
    { name: "fbm over a spec-less position", make: () => fbm(perlinNoise, { position: opaque(3) }) },
    { name: "constant NaN", make: () => constant(NaN) },
    { name: "constant Infinity", make: () => constant(-Infinity) },
    { name: "constant tuple with a non-finite component", make: () => constant([1, Infinity, 3]) },
    // -0 survives `fieldFromJson` but not JSON (`JSON.stringify(-0)` is
    // "0"), and `keyNum` keeps -0 and 0 apart because their columns do
    // differ — so a derived spec would change meaning in transit.
    { name: "constant negative zero", make: () => constant(-0) },
    { name: "constant tuple with a negative zero", make: () => constant([1, -0]) },
    { name: "ramp with a negative-zero stop", make: () => ramp(attribute("density"), [[-0, 1], [1, 2]]) },
    { name: "noise with a negative-zero frequency", make: () => valueNoise({ frequency: -0 }) },
    { name: "attribute with an empty name", make: () => attribute(""), evaluable: false },
    { name: "attribute with a fractional tupleSize", make: () => attribute("density", 2.5), evaluable: false },
    { name: "attribute with a zero tupleSize", make: () => attribute("density", 0), evaluable: false },
    { name: "randomField with a non-finite key", make: () => randomField(NaN) },
    { name: "noise with a fractional seed", make: () => perlinNoise({ seed: 1.5 }) },
    { name: "noise with a non-finite frequency", make: () => valueNoise({ frequency: Infinity }) },
    { name: "noise with a non-finite offset", make: () => simplexNoise({ offset: [0, NaN, 0] }) },
    { name: "worley with an out-of-union output", make: () => worleyNoise({ output: "f3" as never }) },
    { name: "ramp with a non-finite stop value", make: () => ramp(attribute("density"), [[0, 0], [1, Infinity]]) },
    { name: "ramp with a non-finite stop position", make: () => ramp(attribute("density"), [[0, 0], [Infinity, 1]]) },
  ];

  for (const c of NONE) {
    it(`${c.name}: carries no spec`, () => {
      const field = c.make();
      expect(getFieldSpec(field), c.name).toBeUndefined();
      expect(peekFieldSpec(field), `${c.name}: internal peek`).toBeUndefined();
      expect(authoredSpec(field), `${c.name}: authored peek`).toBeUndefined();
      // Still a working field — declining to describe it changes nothing
      // about what it computes.
      if (c.evaluable !== false) {
        expect(() => evaluateField(field, fixture(0))).not.toThrow();
      }
    });
  }

  it("a guarded value is the reason, not the constructor", () => {
    // The same constructors DO derive specs when their arguments are in
    // the grammar's domain, so the negatives above pin the guards rather
    // than a missing derivation.
    expect(getFieldSpec(constant(1))).toBeDefined();
    expect(getFieldSpec(attribute("density", 3))).toBeDefined();
    expect(getFieldSpec(randomField(2))).toBeDefined();
    expect(getFieldSpec(perlinNoise({ seed: 2 }))).toBeDefined();
    expect(getFieldSpec(worleyNoise({ output: "f2" }))).toBeDefined();
    expect(getFieldSpec(ramp(attribute("density"), [[0, 0], [1, 1]]))).toBeDefined();
  });
});

describe("fbm base reverse-lookup", () => {
  /**
   * `fbm` builds an `add`/`mul` tree over its octaves, so when its base
   * cannot be named in the grammar it does not invent an `fbm` spec — it
   * simply adds none, and the octave tree's own composed spec stands.
   * That spec is derived from the fields actually built, so it is exactly
   * as faithful; it just spells the fractal out.
   */
  it("names a built-in base directly", () => {
    const spec = getFieldSpec(fbm(perlinNoise, { octaves: 2 }));
    expect(spec?.fn).toBe("fbm");
    expect(spec?.base).toBe("perlinNoise");
  });

  it("falls back to the octave tree for a wrapper factory", () => {
    const wrapper = (o: Parameters<typeof perlinNoise>[0] = {}) => perlinNoise(o);
    const field = fbm(wrapper, { octaves: 2, seed: 4 });
    const spec = getFieldSpec(field);
    expect(spec?.fn).toBe("add");
    expect(spec?.base).toBeUndefined();
    const rebuilt = fieldFromJson(spec as FieldSpec);
    expect(rebuilt.key).toBe(field.key);
    const ctx = fixture(5);
    expectSameColumn(evaluateField(rebuilt, ctx), evaluateField(field, ctx), "wrapper fbm");
  });

  it("still names itself when the seed is negative zero", () => {
    // `deriveFbmSpec` used to withhold for `-0`, which no test could
    // reach: `hashCombine` cannot tell -0 from 0, so both build the
    // identical field, and JSON's `-0` -> `0` cannot change what the
    // spec means. The guard is gone; this pins what replaced it.
    const field = fbm(perlinNoise, { octaves: 2, seed: -0 });
    const spec = getFieldSpec(field) as FieldSpec;
    expect(spec.fn).toBe("fbm");
    expect(fieldFromJson(spec).key).toBe(field.key);
    // ...including through real JSON transit, where -0 becomes 0.
    const viaJson = fieldFromJson(JSON.parse(JSON.stringify(spec)) as FieldSpec);
    expect(viaJson.key).toBe(field.key);
    const ctx = fixture(3);
    expectSameColumn(evaluateField(viaJson, ctx), evaluateField(field, ctx), "fbm seed -0");
    // A non-integer seed is still withheld — by `noiseOptsSpec`, which is
    // where that condition actually lives.
    expect(getFieldSpec(fbm(perlinNoise, { octaves: 2, seed: 1.5 }))?.fn).not.toBe("fbm");
  });

  it("falls back to the octave tree when an fbm option is out of grammar", () => {
    // A fractional seed is fine for `hashCombine`, so the octaves are
    // spec'd; only the `fbm` spec itself is withheld.
    const field = fbm(perlinNoise, { octaves: 2, seed: 0.5 });
    const spec = getFieldSpec(field);
    expect(spec?.fn).toBe("add");
    const rebuilt = fieldFromJson(spec as FieldSpec);
    expect(rebuilt.key).toBe(field.key);
  });
});

describe("spec provenance", () => {
  it("distinguishes derived from authored", () => {
    const derived = add(position(), 1);
    const derivedSpec = peekFieldSpec(derived);
    expect(derivedSpec).toBeDefined();
    expect(isDerivedSpec(derivedSpec as FieldSpec)).toBe(true);
    expect(authoredSpec(derived)).toBeUndefined();
    expect(getFieldSpec(derived)).toBeDefined();

    const authored = fieldFromJson({ fn: "add", args: [{ fn: "position" }, 1] });
    const stamped = peekFieldSpec(authored);
    expect(stamped).toBeDefined();
    expect(isDerivedSpec(stamped as FieldSpec)).toBe(false);
    expect(authoredSpec(authored)).toBeDefined();
  });

  it("the authored stamp overwrites the spec derived while building", () => {
    // `fieldFromJson` builds through the same constructors, so the tree's
    // outermost field carries a derived spec until the author's original
    // lands on it last.
    const authored = fieldFromJson({ fn: "mul", args: [{ fn: "position" }, [2, 2, 2]] });
    expect(authoredSpec(authored)).toEqual({
      fn: "mul",
      args: [{ fn: "position" }, [2, 2, 2]],
    });
  });

  it("keeps the derived marker out of the spec object", () => {
    // A marker key would be rejected by `checkKeys`, breaking the very
    // round-trip that validates derivation.
    const spec = peekFieldSpec(component(position(), 1)) as FieldSpec;
    expect(Reflect.ownKeys(spec).sort()).toEqual(["args", "fn", "index"]);
    expect(JSON.stringify(spec)).toBe('{"fn":"component","args":[{"fn":"position"}],"index":1}');
  });

  it("shares child spec structure instead of cloning per level", () => {
    // Deep trees must cost O(depth) spec objects, not O(depth²).
    const leaf = randomField("shared");
    const parent = mul(leaf, 2);
    const grandparent = clamp(parent, 0, 1);
    const parentSpec = peekFieldSpec(parent) as FieldSpec;
    expect((parentSpec.args as unknown[])[0]).toBe(peekFieldSpec(leaf));
    expect(((peekFieldSpec(grandparent) as FieldSpec).args as unknown[])[0]).toBe(parentSpec);
  });

  it("hands out a defensive copy of a derived spec", () => {
    const field = add(position(), 1);
    const first = getFieldSpec(field) as { fn: string; args: unknown[] };
    expect(first).toBeDefined();
    expect(first).not.toBe(peekFieldSpec(field));
    first.fn = "mul";
    first.args[0] = 99;
    expect(getFieldSpec(field)).toEqual({
      fn: "add",
      args: [{ fn: "position" }, { fn: "constant", value: 1 }],
    });
  });

  it("stamps the position, index and fraction singletons once", () => {
    expect(peekFieldSpec(position())).toBe(peekFieldSpec(position()));
    expect(getFieldSpec(position())).toEqual({ fn: "position" });
    expect(getFieldSpec(index())).toEqual({ fn: "index" });
    expect(peekFieldSpec(fraction())).toBe(peekFieldSpec(fraction()));
    expect(getFieldSpec(fraction())).toEqual({ fn: "fraction" });
  });

  it("never returns a field whose provenance another caller can see", () => {
    // `fieldFromJson` stamps an AUTHORED spec on whatever it built, and
    // provenance is what device eligibility turns on. So no parse may
    // hand back an object another caller also holds — otherwise one
    // `fieldFromJson({fn:"position"})` anywhere in a process would flip
    // every later `position()` to authored, and device eligibility would
    // depend on module load order.
    //
    // Checked over the WHOLE matrix (which pins itself equal to
    // `listFieldFns()`), not just the two known singletons, so a
    // constructor that starts caching its result fails here.
    for (const c of CASES) {
      const spec = getFieldSpec(c.make());
      if (spec === undefined) continue;
      const a = fieldFromJson(spec);
      const b = fieldFromJson(spec);
      expect(a, `${c.name}: two parses share a field object`).not.toBe(b);
    }

    // And specifically for the two singletons: the parse is authored, the
    // singleton stays derived, and they still compute the same thing.
    const before = authoredSpec(position());
    const parsed = fieldFromJson({ fn: "position" });
    expect(before).toBeUndefined();
    expect(authoredSpec(position())).toBeUndefined();
    expect(authoredSpec(parsed)).toEqual({ fn: "position" });
    expect(parsed).not.toBe(position());
    expect(parsed.key).toBe(position().key);
    expect(parsed.tupleSize).toBe(position().tupleSize);
    expectSameColumn(
      evaluateField(parsed, fixture(1)),
      evaluateField(position(), fixture(1)),
      "position copy",
    );

    const parsedIndex = fieldFromJson({ fn: "index" });
    expect(authoredSpec(index())).toBeUndefined();
    expect(authoredSpec(parsedIndex)).toEqual({ fn: "index" });
    expect(parsedIndex).not.toBe(index());
    expectSameColumn(
      evaluateField(parsedIndex, fixture(1)),
      evaluateField(index(), fixture(1)),
      "index copy",
    );

    const parsedFraction = fieldFromJson({ fn: "fraction" });
    expect(authoredSpec(fraction())).toBeUndefined();
    expect(authoredSpec(parsedFraction)).toEqual({ fn: "fraction" });
    expect(parsedFraction).not.toBe(fraction());
    expectSameColumn(
      evaluateField(parsedFraction, fixture(1)),
      evaluateField(fraction(), fixture(1)),
      "fraction copy",
    );
  });

  it("a parsed position copy composes exactly like the singleton", () => {
    // The copy carries the same DERIVED spec, so nesting it inside a
    // larger expression must derive the same description — otherwise
    // `fieldFromJson` would quietly produce less serializable trees.
    const parsed = fieldFromJson({ fn: "position" });
    expect(getFieldSpec(mul(parsed, 2))).toEqual(getFieldSpec(mul(position(), 2)));
    expect(mul(parsed, 2).key).toBe(mul(position(), 2).key);
  });

  it("never lets a spec reach the field's structural identity", () => {
    // The spec is symbol-keyed, so `Object.keys`, JSON, and the graph
    // executor's structural param hash cannot see it — which is why
    // memo keys are unchanged by any of this.
    const field = mul(position(), 2);
    expect(Object.keys(field).sort()).toEqual(["evaluate", "key", "tupleSize"]);
    expect(JSON.parse(JSON.stringify(field))).toEqual({ key: field.key, tupleSize: 3 });
    expect(field.key).toBe(mul(position(), 2).key);
  });
});

describe("derivation stops at the parser's nesting cap", () => {
  /**
   * The cap `fieldFromJson` enforces, restated independently of the
   * production constant: derivation and parsing must agree on the SAME
   * number, and a test that imported the constant could not tell whether
   * they still did.
   */
  const MAX_DEPTH = 256;

  /** A field whose derived spec is exactly `levels` deep. */
  const addChain = (levels: number): Field => {
    let f: Field = position(); // a leaf spec, depth 1
    for (let i = 1; i < levels; i++) f = add(f, 1);
    return f;
  };

  it("derives at the cap, and what it derives still parses back", () => {
    const field = addChain(MAX_DEPTH);
    const spec = getFieldSpec(field);
    expect(spec).toBeDefined();
    // The whole point: the deepest spec derivation will produce is one
    // `fieldFromJson` accepts, and it rebuilds the identical field.
    const rebuilt = fieldFromJson(spec as FieldSpec);
    expect(rebuilt.key).toBe(field.key);
    const ctx = fixture(11);
    expectSameColumn(evaluateField(rebuilt, ctx), evaluateField(field, ctx), "chain at cap");
  });

  it("withholds one level past the cap, through all three accessors", () => {
    const field = addChain(MAX_DEPTH + 1);
    expect(getFieldSpec(field)).toBeUndefined();
    expect(peekFieldSpec(field)).toBeUndefined();
    expect(authoredSpec(field)).toBeUndefined();
    // Withholding a description never changes what the field computes.
    expect(() => evaluateField(field, fixture(0))).not.toThrow();
  });

  it("keeps withholding above the cap, and every constructor propagates it", () => {
    const tooDeep = addChain(MAX_DEPTH + 40);
    expect(getFieldSpec(tooDeep)).toBeUndefined();
    // A spec-less subtree is a spec-less tree, exactly as for `makeField`:
    // nothing built on top of it can describe itself either.
    for (const over of [mul(tooDeep, 2), vec(tooDeep), component(tooDeep, 0), length(tooDeep)]) {
      expect(getFieldSpec(over)).toBeUndefined();
    }
    // ...including the noise/fbm path, which nests its position in `opts`
    // (`tooDeep` is a tuple-3 chain over `position()`, so it is a legal
    // position input; only its description is missing).
    expect(getFieldSpec(perlinNoise({ position: tooDeep }))).toBeUndefined();
    expect(getFieldSpec(fbm(perlinNoise, { position: tooDeep }))).toBeUndefined();
  });

  it("counts the position a noise spec nests in its opts", () => {
    // `opts.position` is a nesting level like any argument (the parser
    // walks it with the same `buildArg`), so a noise over a cap-deep
    // position is one level too deep and must withhold — even though
    // every value in its opts is in the grammar's domain.
    const atCap = perlinNoise({ position: addChain(MAX_DEPTH - 1) });
    const spec = getFieldSpec(atCap);
    expect(spec).toBeDefined();
    expect(fieldFromJson(spec as FieldSpec).key).toBe(atCap.key);

    expect(getFieldSpec(perlinNoise({ position: addChain(MAX_DEPTH) }))).toBeUndefined();
    expect(getFieldSpec(worleyNoise({ position: addChain(MAX_DEPTH) }))).toBeUndefined();
    expect(getFieldSpec(valueNoise({ position: addChain(MAX_DEPTH), normalized: true }))).toBeUndefined();
    expect(getFieldSpec(fbm(perlinNoise, { position: addChain(MAX_DEPTH) }))).toBeUndefined();
  });

  it("counts an authored spec's own depth, not just what was built over it", () => {
    // `fieldFromJson` parses up to the cap, so a field one `add` above a
    // cap-deep authored spec is past it — and must withhold, or the
    // author could reach an unparseable spec through the front door.
    const atCap = fieldFromJson(getFieldSpec(addChain(MAX_DEPTH)) as FieldSpec);
    expect(authoredSpec(atCap)).toBeDefined();
    expect(getFieldSpec(add(atCap, 1))).toBeUndefined();

    // A shallow authored spec keeps composing normally.
    const shallow = fieldFromJson({ fn: "add", args: [{ fn: "position" }, 1] });
    const composed = getFieldSpec(add(shallow, 1));
    expect(composed).toBeDefined();
    expect(fieldFromJson(composed as FieldSpec).key).toBe(add(shallow, 1).key);
  });

  it("stops the fbm octave tree at the cap too", () => {
    // `fbm` over a non-built-in base keeps its octave tree's own spec,
    // which is an `add` chain one level per octave — the shortest route
    // to a spec deeper than the grammar allows.
    const wrapper = (o: Parameters<typeof perlinNoise>[0] = {}) => perlinNoise(o);
    expect(getFieldSpec(fbm(wrapper, { octaves: 4 }))?.fn).toBe("add");
    expect(getFieldSpec(fbm(wrapper, { octaves: MAX_DEPTH + 44 }))).toBeUndefined();
    // A built-in base names itself in one level, so it is unaffected.
    expect(getFieldSpec(fbm(perlinNoise, { octaves: MAX_DEPTH + 44 }))?.fn).toBe("fbm");
  });
});
