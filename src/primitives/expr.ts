/**
 * Field-expression spelling helpers for the shipped primitives.
 *
 * A recipe is authored as the JSON an agent could have written by hand, so
 * every field value here is a plain `FieldSpec` object — never a live
 * `Field`. Building them through these helpers rather than as literals
 * buys one thing: the shape of an expression stays readable at the call
 * site (`mul(position(), param("frequency"))`), which matters because the
 * recipes below are the library's own worked examples of the grammar.
 *
 * Nothing here validates: `fieldFromJson` does that, at the moment
 * `definePrimitive` materializes the recipe, and its messages already name
 * the offending path.
 */

/** A JSON field-expression spec, as `docs/authoring.md` describes it. */
export type Spec = Record<string, unknown>;

/** An argument position in a spec: a nested spec, or a literal constant. */
export type Arg = Spec | number | readonly number[];

/** Radians in a full turn — the constant every parametric shape needs. */
export const TAU = 6.283185307179586;

/** `{ fn: "position" }` — the `P` attribute of the domain being resolved. */
export function position(): Spec {
  return { fn: "position" };
}

/** `{ fn: "attribute", ... }` — read a numeric attribute of that domain. */
export function attr(name: string, tupleSize?: number): Spec {
  return tupleSize === undefined ? { fn: "attribute", name } : { fn: "attribute", name, tupleSize };
}

/** `{ fn: "constant", value }` — the spelling a bare scalar cannot use on a vec param. */
export function constant(value: number | readonly number[]): Spec {
  return { fn: "constant", value };
}

/**
 * `{ fn: "param", name }` — the value the wrapper's exposed param of that
 * name holds, substituted in as the literal it stands for.
 *
 * This is how a primitive's knob reaches INSIDE a field expression, and
 * the whole catalog is written on it. `name` is the PRIMITIVE's param name
 * (the one an agent sets), not an inner node's: every exposed param binds
 * its name into its body's field scope, so a declaration with an empty
 * `targets` list writes nowhere and is read here instead.
 *
 * A misspelling is a hard error at registration naming the declared
 * params, so the two halves cannot drift.
 */
export function param(name: string): Spec {
  return { fn: "param", name };
}

/** Per-element deterministic random in [0, 1), salted by `key`. */
export function randomField(key: string): Spec {
  return { fn: "randomField", key };
}

/** Any fixed-arity combinator: `fn(args...)`. */
export function call(fn: string, ...args: readonly Arg[]): Spec {
  return { fn, args: [...args] };
}

/** `{ fn: "vec", args }` — concatenate components into one tuple. */
export function vec(...args: readonly Arg[]): Spec {
  return { fn: "vec", args: [...args] };
}

/** `{ fn: "component", args: [tuple], index }` — one component as a scalar. */
export function component(arg: Arg, index: number): Spec {
  return { fn: "component", args: [arg], index };
}

/** `{ fn: "ramp", args: [scalar], stops }` — a piecewise-linear curve. */
export function ramp(arg: Arg, stops: readonly (readonly [number, number])[]): Spec {
  return { fn: "ramp", args: [arg], stops: stops.map((s) => [s[0], s[1]]) };
}

/**
 * The sample position a TUNABLE noise field reads, built from two exposed
 * params.
 *
 * This is the whole reason noise-bearing primitives have knobs at all. A
 * noise `frequency` and `offset` live in `opts` as plain numbers, and no
 * reference of any kind can stand there. A `seed` is not like them: it
 * takes an integer or the tagged `{ from: "node", variant: N }` form,
 * whose `variant` may be an inline `param` — but a seed is fixed when the
 * field is BUILT, so it picks a whole draw and can never vary per
 * element. Scaling and offsetting the position the noise samples is the
 * reachable equivalent, and for `frequency` an exact one: the point
 * sampled is `p * frequency + offset`, so multiplying by the frequency
 * knob computes the same point, and adding the variant knob walks to an
 * unrelated part of the same infinite field, which is what a per-instance
 * seed would have done.
 *
 * Both values arrive as {@link param} references. They used to arrive as
 * ATTRIBUTES, because an exposed param fanned out into an inner param slot
 * and a field spec has none — so each knob cost a `setAttribute` writing a
 * `count`-element f32 column, a `removeAttribute` taking it away again,
 * and a storage-buffer slot in the compiled kernel. A `param` reference
 * reads the same value with none of that, and lowers to a uniform slot on
 * the GPU rather than a buffer.
 */
export function noisePosition(freqParam: string, variantParam: string): Spec {
  return call(
    "add",
    call("mul", position(), param(freqParam)),
    vec(param(variantParam), param(variantParam), param(variantParam)),
  );
}

/**
 * The catalog's standard pattern field: four octaves of Perlin fBm,
 * normalized to 0..1, sampled through {@link noisePosition}.
 *
 * Normalization is not a detail. `density`, `filterByDensity`'s
 * probabilistic mode and every 0..1 threshold in the library expect that
 * range, and raw fBm is signed — across the demo corpus fBm is never used
 * raw, it is always wrapped in a remap or given `normalized: true`. Baking
 * it here is what a primitive is for.
 */
export function tunableFbm(freqParam: string, variantParam: string, octaves = 4): Spec {
  return {
    fn: "fbm",
    base: "perlinNoise",
    opts: { normalized: true, octaves, position: noisePosition(freqParam, variantParam) },
  };
}
