import { resolveField } from "./inputs.js";
import { attachArgsSpec, isSpecNumber, recordWithheld } from "./spec.js";
import {
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  keyNum,
  keyRef,
  makeField,
} from "./types.js";
import { broadcastTupleSize, readColumnAt as readAt } from "./broadcast.js";

/**
 * Build an elementwise combinator field: inputs are broadcast per the
 * scalar rule, computed in f64, and stored as f32.
 */
function elementwise(
  kind: string,
  inputs: readonly FieldLike[],
  fn: (args: readonly number[]) => number,
): Field {
  const fields = inputs.map(resolveField);
  const staticTs = broadcastTupleSize(kind, fields.map((f) => f.tupleSize));
  const key = `${kind}(${fields.map((f) => keyRef(f.key)).join(",")})`;
  const field = makeField(key, staticTs, (ctx) => {
    const cols = fields.map((f) => evaluateField(f, ctx));
    const ts = broadcastTupleSize(kind, cols.map((c) => c.tupleSize)) ?? 1;
    const n = elementCount(ctx);
    const out = new Float32Array(n * ts);
    const m = cols.length;
    const args = new Array<number>(m);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ts; k++) {
        for (let j = 0; j < m; j++) args[j] = readAt(cols[j], i, k);
        out[i * ts + k] = fn(args);
      }
    }
    return { data: out, tupleSize: ts };
  });
  // `kind` IS the grammar fn name for every elementwise combinator — one
  // derivation covers all 28. "names 28 constructors, each a registered fn"
  // in spec.test.ts pins that correspondence so it cannot drift.
  return attachArgsSpec(field, kind, fields);
}

/** Elementwise a + b. */
export function add(a: FieldLike, b: FieldLike): Field {
  return elementwise("add", [a, b], (v) => v[0] + v[1]);
}

/** Elementwise a - b. */
export function sub(a: FieldLike, b: FieldLike): Field {
  return elementwise("sub", [a, b], (v) => v[0] - v[1]);
}

/** Elementwise a * b. */
export function mul(a: FieldLike, b: FieldLike): Field {
  return elementwise("mul", [a, b], (v) => v[0] * v[1]);
}

/** Elementwise a / b. */
export function div(a: FieldLike, b: FieldLike): Field {
  return elementwise("div", [a, b], (v) => v[0] / v[1]);
}

/** Elementwise minimum. */
export function min(a: FieldLike, b: FieldLike): Field {
  return elementwise("min", [a, b], (v) => Math.min(v[0], v[1]));
}

/** Elementwise maximum. */
export function max(a: FieldLike, b: FieldLike): Field {
  return elementwise("max", [a, b], (v) => Math.max(v[0], v[1]));
}

/** Elementwise absolute value. */
export function abs(a: FieldLike): Field {
  return elementwise("abs", [a], (v) => Math.abs(v[0]));
}

/** Elementwise floor. */
export function floor(a: FieldLike): Field {
  return elementwise("floor", [a], (v) => Math.floor(v[0]));
}

/**
 * Elementwise square root, and NOT bit-exact on the GPU despite IEEE 754
 * mandating a correctly rounded one. `Math.sqrt` does honour that — the
 * f64 result rounded once at the f32 store is the nearest f32, measured
 * over 2,000,000 samples with zero mismatches — but the device does not:
 * it lowers `sqrt` to a reciprocal-square-root plus refinement, which
 * lands 1 ULP low or high on ~16% of inputs at every magnitude (perfect
 * squares stay exact). So `sqrt` carries a 1-ULP budget in the parity
 * table. The CPU is the correctly rounded side of that disagreement.
 *
 * Negative inputs are NaN on both paths, matching `Math.sqrt`.
 */
export function sqrt(a: FieldLike): Field {
  return elementwise("sqrt", [a], (v) => Math.sqrt(v[0]));
}

/**
 * Elementwise `a` raised to `b`, over a DOMAIN narrower than `Math.pow`'s.
 *
 * The device is measured to implement `pow` as exactly `exp2(b * log2(a))`
 * — 4096 of 4096 samples bit-identical to that expansion — and that
 * identity is NaN across a whole region where `Math.pow` returns a number:
 * every negative base (`pow(-2, 2)` is 4 in JS, NaN here), `pow(0, 0)`,
 * and `pow(x, 0)` for a zero, negative, infinite or NaN `x`. Honouring the
 * JS answers would leave the two paths silently disagreeing there, so the
 * CPU adopts the identity's DOMAIN while keeping `Math.pow`'s better
 * accuracy everywhere the device returns a real number. For a signed power
 * write `mul(normalize(x), pow(abs(x), y))` — `normalize` on a scalar
 * yields the sign.
 *
 * Inside the shared domain it is still only approximate: the device's
 * expansion differs from `Math.pow` on ~64% of samples, so `pow` carries
 * the grammar's widest elementwise budget.
 */
export function pow(a: FieldLike, b: FieldLike): Field {
  return elementwise("pow", [a, b], (v) => {
    const base = v[0];
    // Strictly positive and finite: the device returns a real number here,
    // so use the accurate answer. `+ 0` normalizes a -0 result (which
    // `Math.pow(-0, 3)` can produce) to the +0 that exp2 always gives.
    if (base > 0 && base < Infinity) return Math.pow(base, v[1]) + 0;
    // Otherwise follow the identity itself, so the two paths answer NaN on
    // exactly the same inputs rather than on nearly the same ones.
    return Math.pow(2, v[1] * Math.log2(base));
  });
}

/**
 * Elementwise step: 1 where `x` is at or above `edge`, 0 below it.
 *
 * Exactly `ge(x, edge)` with the arguments the other way round, NaN case
 * included — it earns its place as the name a shader author reaches for,
 * not as new expressive power.
 */
export function step(edge: FieldLike, x: FieldLike): Field {
  return elementwise("step", [edge, x], (v) => (v[1] >= v[0] ? 1 : 0));
}

// -- trigonometry ----------------------------------------------------------
//
// Determinism note shared by sin/cos/tan/asin/acos/atan/atan2: JS engines
// have converged on fdlibm-derived implementations of these Math
// functions, but unlike Math.sqrt they are not mandated by IEEE 754 /
// ECMA-262 to be correctly rounded. Bit-exactness within one engine is
// guaranteed (same input → same output); across engines it is the
// practical norm, not a spec guarantee. Do not replace these with
// hand-rolled polynomial approximations.

/**
 * Elementwise sine (radians). Bit-exact within one engine; across
 * engines fdlibm convergence makes identical results the practical norm,
 * not a spec guarantee (see the trig determinism note in this module).
 */
export function sin(a: FieldLike): Field {
  return elementwise("sin", [a], (v) => Math.sin(v[0]));
}

/**
 * Elementwise cosine (radians). Bit-exact within one engine; across
 * engines fdlibm convergence makes identical results the practical norm,
 * not a spec guarantee (see the trig determinism note in this module).
 */
export function cos(a: FieldLike): Field {
  return elementwise("cos", [a], (v) => Math.cos(v[0]));
}

/**
 * Elementwise tangent (radians). Bit-exact within one engine; across
 * engines fdlibm convergence makes identical results the practical norm,
 * not a spec guarantee (see the trig determinism note in this module).
 */
export function tan(a: FieldLike): Field {
  return elementwise("tan", [a], (v) => Math.tan(v[0]));
}

/**
 * Elementwise arcsine, in radians. Inputs outside [-1, 1] produce NaN,
 * which propagates like any other elementwise result (no clamping).
 * Bit-exact within one engine; across engines fdlibm convergence makes
 * identical results the practical norm, not a spec guarantee.
 */
export function asin(a: FieldLike): Field {
  return elementwise("asin", [a], (v) => Math.asin(v[0]));
}

/**
 * Elementwise arccosine, in radians. Inputs outside [-1, 1] produce NaN,
 * which propagates like any other elementwise result (no clamping).
 * Bit-exact within one engine; across engines fdlibm convergence makes
 * identical results the practical norm, not a spec guarantee.
 */
export function acos(a: FieldLike): Field {
  return elementwise("acos", [a], (v) => Math.acos(v[0]));
}

/**
 * Elementwise arctangent, in radians (range (-π/2, π/2)). Bit-exact
 * within one engine; across engines fdlibm convergence makes identical
 * results the practical norm, not a spec guarantee (see the trig
 * determinism note in this module).
 */
export function atan(a: FieldLike): Field {
  return elementwise("atan", [a], (v) => Math.atan(v[0]));
}

/**
 * Elementwise two-argument arctangent atan2(y, x), in radians (range
 * [-π, π]), broadcasting like the other binary combinators. Bit-exact
 * within one engine; across engines fdlibm convergence makes identical
 * results the practical norm, not a spec guarantee.
 */
export function atan2(y: FieldLike, x: FieldLike): Field {
  return elementwise("atan2", [y, x], (v) => Math.atan2(v[0], v[1]));
}

/** Elementwise clamp of x to [lo, hi]. */
export function clamp(x: FieldLike, lo: FieldLike, hi: FieldLike): Field {
  return elementwise("clamp", [x, lo, hi], (v) => Math.min(Math.max(v[0], v[1]), v[2]));
}

/** Elementwise linear interpolation a + (b - a) * t. */
export function lerp(a: FieldLike, b: FieldLike, t: FieldLike): Field {
  return elementwise("lerp", [a, b, t], (v) => v[0] + (v[1] - v[0]) * v[2]);
}

/**
 * Elementwise linear remap of x from [inMin, inMax] to [outMin, outMax]
 * (unclamped). A degenerate input range maps to outMin.
 */
export function remap(
  x: FieldLike,
  inMin: FieldLike,
  inMax: FieldLike,
  outMin: FieldLike,
  outMax: FieldLike,
): Field {
  return elementwise("remap", [x, inMin, inMax, outMin, outMax], (v) => {
    const span = v[2] - v[1];
    if (span === 0) return v[3];
    return v[3] + ((v[0] - v[1]) / span) * (v[4] - v[3]);
  });
}

/** Elementwise select: where cond is non-zero take a, else b. */
export function select(cond: FieldLike, a: FieldLike, b: FieldLike): Field {
  return elementwise("select", [cond, a, b], (v) => (v[0] !== 0 ? v[1] : v[2]));
}

/** Elementwise a < b as 1/0. */
export function lt(a: FieldLike, b: FieldLike): Field {
  return elementwise("lt", [a, b], (v) => (v[0] < v[1] ? 1 : 0));
}

/** Elementwise a <= b as 1/0. */
export function le(a: FieldLike, b: FieldLike): Field {
  return elementwise("le", [a, b], (v) => (v[0] <= v[1] ? 1 : 0));
}

/** Elementwise a > b as 1/0. */
export function gt(a: FieldLike, b: FieldLike): Field {
  return elementwise("gt", [a, b], (v) => (v[0] > v[1] ? 1 : 0));
}

/** Elementwise a >= b as 1/0. */
export function ge(a: FieldLike, b: FieldLike): Field {
  return elementwise("ge", [a, b], (v) => (v[0] >= v[1] ? 1 : 0));
}

/** Elementwise exact equality as 1/0. */
export function eq(a: FieldLike, b: FieldLike): Field {
  return elementwise("eq", [a, b], (v) => (v[0] === v[1] ? 1 : 0));
}

/**
 * Elementwise exact inequality as 1/0 — the exact complement of
 * {@link eq}, tolerance-free like it: floats are compared bit-for-bit
 * after the usual f32 rounding, so `ne` on two computed values is a test
 * of identical results, not of "far enough apart". Reach for
 * `gt(abs(sub(a, b)), epsilon)` when you meant approximate.
 */
export function ne(a: FieldLike, b: FieldLike): Field {
  return elementwise("ne", [a, b], (v) => (v[0] !== v[1] ? 1 : 0));
}

/** Dot product per element (scalars broadcast): sum over components of a*b. */
export function dot(a: FieldLike, b: FieldLike): Field<1> {
  const fa = resolveField(a);
  const fb = resolveField(b);
  broadcastTupleSize("dot", [fa.tupleSize, fb.tupleSize]); // static check
  const field = makeField<1>(`dot(${keyRef(fa.key)},${keyRef(fb.key)})`, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const cb = evaluateField(fb, ctx);
    const ts = broadcastTupleSize("dot", [ca.tupleSize, cb.tupleSize]) ?? 1;
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < ts; k++) sum += readAt(ca, i, k) * readAt(cb, i, k);
      out[i] = sum;
    }
    return { data: out, tupleSize: 1 };
  });
  return attachArgsSpec(field, "dot", [fa, fb]);
}

/**
 * @internal The width rule for {@link cross}, applied statically where the
 * widths are known and again at evaluation where they were not. Its own
 * function so both checks phrase the refusal identically.
 */
function requireCrossWidth(a: number | undefined, b: number | undefined): void {
  const bad =
    a !== undefined && a !== 3 ? ["a", a] : b !== undefined && b !== 3 ? ["b", b] : null;
  if (bad === null) return;
  throw new Error(
    `cross: argument \`${bad[0]}\` has width ${bad[1]}, but a cross product is defined for ` +
      "width 3 only. Scalars do NOT broadcast into one here — build a vec3 with " +
      "`vec(x, y, z)`, or use `dot` for a product that works at any width.",
  );
}

/**
 * Cross product of two 3-component tuples, per element.
 *
 * The grammar's ONLY width-specific fn. Everything else broadcasts, and
 * the scalar rule is suppressed here on purpose: `cross(t, 1)` is a width
 * error rather than a cross against `[1, 1, 1]`, because the second
 * reading is never what an author meant.
 *
 * BIT-EXACT on the GPU, and deliberately so — it is the one place in this
 * module where rounding order is chosen rather than inherited. Every other
 * compound fn (`dot`, `lerp`, `normalize`) accumulates in f64 and rounds
 * once at the store, which is why each carries a budget. Here the products
 * are rounded to f32 individually, with `Math.fround`, before they are
 * subtracted, because that is what the device does: measured over 12,288
 * lanes, the device matches f32-at-each-step on 100% and f64-once on 65%,
 * and the gap is worth 539 ULP. Three roundings buy exactness.
 *
 * The device's `cross` builtin and a hand-written expansion are themselves
 * bit-identical on every lane, and a deliberate `fma` control shader was
 * used to confirm the comparison can see contraction when it happens — it
 * simply does not here.
 */
export function cross(a: FieldLike, b: FieldLike): Field<3> {
  const fa = resolveField(a);
  const fb = resolveField(b);
  requireCrossWidth(fa.tupleSize, fb.tupleSize); // static check where widths are known
  const field = makeField<3>(`cross(${keyRef(fa.key)},${keyRef(fb.key)})`, 3, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const cb = evaluateField(fb, ctx);
    requireCrossWidth(ca.tupleSize, cb.tupleSize);
    const n = elementCount(ctx);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const ax = ca.data[o];
      const ay = ca.data[o + 1];
      const az = ca.data[o + 2];
      const bx = cb.data[o];
      const by = cb.data[o + 1];
      const bz = cb.data[o + 2];
      // fround on each product, not on the difference: see the note above.
      out[o] = Math.fround(ay * bz) - Math.fround(az * by);
      out[o + 1] = Math.fround(az * bx) - Math.fround(ax * bz);
      out[o + 2] = Math.fround(ax * by) - Math.fround(ay * bx);
    }
    return { data: out, tupleSize: 3 };
  });
  return attachArgsSpec(field, "cross", [fa, fb]);
}

/** Euclidean length of each element tuple. */
export function length(a: FieldLike): Field<1> {
  const fa = resolveField(a);
  const field = makeField<1>(`length(${keyRef(fa.key)})`, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const ts = ca.tupleSize;
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < ts; k++) {
        const v = ca.data[i * ts + k];
        sum += v * v;
      }
      out[i] = Math.sqrt(sum);
    }
    return { data: out, tupleSize: 1 };
  });
  return attachArgsSpec(field, "length", [fa]);
}

/** Normalize each element tuple to unit length (zero tuples stay zero). */
export function normalize(a: FieldLike): Field {
  const fa = resolveField(a);
  const field = makeField(`normalize(${keyRef(fa.key)})`, fa.tupleSize, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const ts = ca.tupleSize;
    const n = elementCount(ctx);
    const out = new Float32Array(n * ts);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < ts; k++) {
        const v = ca.data[i * ts + k];
        sum += v * v;
      }
      const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
      for (let k = 0; k < ts; k++) out[i * ts + k] = ca.data[i * ts + k] * inv;
    }
    return { data: out, tupleSize: ts };
  });
  return attachArgsSpec(field, "normalize", [fa]);
}

/**
 * Concatenate component fields into one tuple per element (e.g. three
 * scalars into a vec3). Tuple inputs contribute all their components.
 */
export function vec(...components: FieldLike[]): Field {
  if (components.length === 0) throw new Error("vec: needs at least one component");
  const fields = components.map(resolveField);
  const sizes = fields.map((f) => f.tupleSize);
  const staticTs = sizes.every((s) => s !== undefined)
    ? sizes.reduce<number>((acc, s) => acc + (s as number), 0)
    : undefined;
  const key = `vec(${fields.map((f) => keyRef(f.key)).join(",")})`;
  const field = makeField(key, staticTs, (ctx) => {
    const cols = fields.map((f) => evaluateField(f, ctx));
    const ts = cols.reduce((acc, c) => acc + c.tupleSize, 0);
    const n = elementCount(ctx);
    const out = new Float32Array(n * ts);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (const c of cols) {
        for (let j = 0; j < c.tupleSize; j++) out[i * ts + k++] = c.data[i * c.tupleSize + j];
      }
    }
    return { data: out, tupleSize: ts };
  });
  return attachArgsSpec(field, "vec", fields);
}

/** Extract one component of each element tuple as a scalar field. */
export function component(a: FieldLike, componentIndex: number): Field<1> {
  if (!Number.isInteger(componentIndex) || componentIndex < 0) {
    throw new Error(`component: index must be a non-negative integer, got ${componentIndex}`);
  }
  const fa = resolveField(a);
  const field = makeField<1>(`component(${keyRef(fa.key)},${componentIndex})`, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const ts = ca.tupleSize;
    if (componentIndex >= ts) {
      throw new Error(`component: index ${componentIndex} out of range for tupleSize ${ts}`);
    }
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = ca.data[i * ts + componentIndex];
    return { data: out, tupleSize: 1 };
  });
  // `componentIndex` was already validated exactly as the grammar does.
  return attachArgsSpec(field, "component", [fa], { index: componentIndex });
}

/**
 * Piecewise-linear curve through `[t, value]` stops, applied to a scalar
 * field. Stop positions must be strictly ascending; inputs outside the
 * stop range clamp to the first/last value.
 */
export function ramp(
  input: FieldLike,
  stops: ReadonlyArray<readonly [number, number]>,
): Field<1> {
  if (stops.length === 0) throw new Error("ramp: needs at least one stop");
  const ts = stops.map((s) => s[0]);
  const vs = stops.map((s) => s[1]);
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] <= ts[i - 1]) {
      throw new Error("ramp: stop positions must be strictly ascending");
    }
  }
  const fa = resolveField(input);
  const stopsKey = stops.map((s) => `${keyNum(s[0])}:${keyNum(s[1])}`).join(",");
  const key = `ramp(${keyRef(fa.key)};${stopsKey})`;
  const field = makeField<1>(key, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    if (ca.tupleSize !== 1) {
      throw new Error(`ramp: input must be scalar, got tupleSize ${ca.tupleSize}`);
    }
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    const last = ts.length - 1;
    for (let i = 0; i < n; i++) {
      const t = ca.data[i];
      if (t <= ts[0]) {
        out[i] = vs[0];
        continue;
      }
      if (t >= ts[last]) {
        out[i] = vs[last];
        continue;
      }
      let j = 1;
      while (ts[j] < t) j++;
      const u = (t - ts[j - 1]) / (ts[j] - ts[j - 1]);
      out[i] = vs[j - 1] + (vs[j] - vs[j - 1]) * u;
    }
    return { data: out, tupleSize: 1 };
  });
  // Ascending order is already enforced above (more strictly than the
  // grammar checks), but finiteness is not — and the grammar requires it,
  // so it is checked BEFORE the spec is derived at all.
  if (!ts.every(isSpecNumber) || !vs.every(isSpecNumber)) {
    recordWithheld(field, {
      kind: "ungrammatical",
      detail: "ramp's `stops` positions and values must all be finite, and not -0",
    });
    return field;
  }
  return attachArgsSpec(field, "ramp", [fa], { stops: stops.map((s) => [s[0], s[1]]) });
}
