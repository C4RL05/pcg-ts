import { hashCombine, hashFloat, hashString } from "../random/index.js";
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
  // derivation covers all 34. "names 28 constructors, each a registered fn"
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
 * Elementwise sign as -1, 0 or +1 — EXACT rather than budgeted, which is
 * what choosing the definition rather than inheriting one buys.
 *
 * It is `(x > 0) - (x < 0)` on both paths, so the two inputs host languages
 * argue about fall out of the comparisons instead of being legislated: a
 * NaN is neither greater nor less than zero and gets 0, where `Math.sign`
 * gives NaN, and a negative zero is not less than zero and gets +0, where
 * `Math.sign` gives -0. Both departures are deliberate, and they are the
 * trade `step` already makes by lowering to a comparison — a rule both
 * paths execute exactly beats a rule one of them approximates. WGSL's
 * `sign()` builtin is not emitted for that reason: its NaN result is not
 * specified tightly enough to lean on.
 */
export function sign(a: FieldLike): Field {
  return elementwise("sign", [a], (v) => (v[0] > 0 ? 1 : 0) - (v[0] < 0 ? 1 : 0));
}

/**
 * Elementwise fractional part, `x - floor(x)`, and NON-NEGATIVE for every
 * finite input: `fract(-0.25)` is 0.75, not -0.25.
 *
 * That is the definition a tiling wants, because it is exactly `mod(x, 1)`
 * — a coordinate pushed through it repeats across the origin with no seam,
 * where a truncated fractional part mirrors the tile at zero.
 *
 * THE RANGE IS [0, 1] CLOSED, not half-open, and the difference is f32
 * rather than pedantry: `fract(-1e-8)` is exactly 1, because the true
 * answer 1 - 1e-8 has no f32 representation and rounds up to it. Anything
 * indexing a table by `fract` needs the top of the range to be a legal
 * index, or a clamp. The subtraction is therefore NOT always exact — what
 * makes this carry no budget is that both paths round it identically, the
 * device lowering being the same two operations in the same order.
 *
 * A non-finite input has no fractional part: `floor(Infinity)` is
 * `Infinity`, and the difference is NaN.
 */
export function fract(a: FieldLike): Field {
  return elementwise("fract", [a], (v) => v[0] - Math.floor(v[0]));
}

/**
 * Elementwise FLOORED modulo, `x - y * floor(x / y)` — the remainder whose
 * sign follows the DIVISOR rather than the dividend. `mod(-1, 8)` is 7.
 *
 * This is the choice the library documents forever, and it is made for the
 * dominant use: wrapping a coordinate into a tile. A truncated remainder
 * (JS `%`, and WGSL's `%` on floats) answers -1 there, so the tile either
 * side of the origin comes out mirrored and any pattern built on it breaks
 * along x = 0 and z = 0 — a seam that appears only once a world crosses
 * zero, which is precisely where an unbounded generator lives.
 *
 * The operations are rounded to f32 INDIVIDUALLY, matching the device's
 * expansion step for step rather than accumulating in f64 and rounding
 * once, which is the reasoning `cross` uses and for the same payoff. A zero
 * divisor gives NaN on both paths and for the same reason: `floor(x / 0)`
 * is infinite, and `0 * Infinity` is NaN.
 */
export function mod(a: FieldLike, b: FieldLike): Field {
  return elementwise("mod", [a, b], (v) =>
    Math.fround(v[0] - Math.fround(v[1] * Math.floor(Math.fround(v[0] / v[1])))),
  );
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
 * the widest budget of the grammar's ALGEBRAIC fns — 8, against bit-exact
 * for add/sub/mul and 1 for `sqrt`. Only the trigonometric family is
 * wider (sin/cos 12, tan 40, atan/atan2 96, acos 512, asin 640), which
 * is a different error class and not a budget this one competes with.
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

/**
 * Elementwise e^x — one of the two fns here that are transcendental on both
 * sides, and so carry a MEASURED budget rather than a construction that
 * makes them exact.
 *
 * It overflows to Infinity above about 88.7 and underflows to 0 below about
 * -103.9, on both paths, because that range belongs to f32 and not to the
 * implementation. For another base, `pow(b, x)` already exists; there is no
 * `exp2` in the grammar because that is what it would be a synonym for.
 */
export function exp(a: FieldLike): Field {
  return elementwise("exp", [a], (v) => Math.exp(v[0]));
}

/**
 * Elementwise NATURAL logarithm. `log(0)` is -Infinity and `log(x)` for
 * x < 0 is NaN, on both paths. For another base, divide by a constant:
 * `div(log(x), log(b))`. See {@link exp} for the shared budget note.
 */
export function log(a: FieldLike): Field {
  return elementwise("log", [a], (v) => Math.log(v[0]));
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
 * Elementwise smooth Hermite interpolation between two edges: 0 at or below
 * `edge0`, 1 at or above `edge1`, and `t * t * (3 - 2t)` over the clamped
 * `t` between them, so the curve leaves both ends flat.
 *
 * The EXPANSION is emitted rather than WGSL's `smoothstep()` builtin, for
 * the reason `step` and `lerp` are written out too: the builtin's result is
 * not defined when `edge0 >= edge1`, and two paths disagreeing across a
 * whole region is worse than one small budget everywhere.
 *
 * COINCIDENT EDGES ARE GUARDED rather than left to the arithmetic,
 * mirroring `remap`, whose degenerate input range yields `outMin` instead
 * of a division by zero. `edge0 == edge1` gives the step the curve is
 * approaching — 1 where `x >= edge0`, 0 below — which is what the limit
 * says it should be, and both paths were measured agreeing on it,
 * INFINITE edges included. The guard tests the edges rather than their
 * difference for exactly that reason: `Infinity - Infinity` is NaN, so a
 * span test would let coincident infinite edges through to the division.
 *
 * ONE INPUT DISAGREES, and it is documented rather than fixed: a NaN edge
 * with a live span reaches the `clamp`, where the CPU propagates the NaN
 * and WGSL's `clamp` may return the non-NaN operand — the measured device
 * answers 0 on every lane. That is the same contract `min` and `max`
 * already carry for a NaN operand, inherited here through the expansion,
 * and it is why this fn's parity row is exact over a domain that has no
 * NaN edges in it.
 *
 * `ramp` is still the shape to reach for when the knees belong anywhere but
 * the ends; this buys the name and the flat ends, nothing more.
 */
export function smoothstep(edge0: FieldLike, edge1: FieldLike, x: FieldLike): Field {
  return elementwise("smoothstep", [edge0, edge1, x], (v) => {
    // The guard tests the EDGES, not their difference: `Infinity - Infinity`
    // is NaN, so a span test would let coincident infinite edges fall through
    // to the division and answer NaN instead of the step this promises.
    if (v[0] === v[1]) return v[2] >= v[0] ? 1 : 0;
    const span = Math.fround(v[1] - v[0]);
    const t = Math.min(Math.max(Math.fround(Math.fround(v[2] - v[0]) / span), 0), 1);
    return Math.fround(Math.fround(t * t) * Math.fround(3 - Math.fround(2 * t)));
  });
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

/**
 * Euclidean distance between two element tuples — exactly
 * `length(sub(a, b))`, and a test pins the equivalence.
 *
 * "Exactly" is a decision rather than an accident: the difference is
 * rounded to f32 BEFORE it is squared, because that is what `sub` stores
 * into its own column and what the device subtracts, so the fused spelling
 * and the composed one cannot drift apart. Accumulating the difference in
 * f64 instead would have been marginally more accurate and would have made
 * this fn a third answer nobody asked for.
 */
export function distance(a: FieldLike, b: FieldLike): Field<1> {
  const fa = resolveField(a);
  const fb = resolveField(b);
  broadcastTupleSize("distance", [fa.tupleSize, fb.tupleSize]); // static check
  const field = makeField<1>(`distance(${keyRef(fa.key)},${keyRef(fb.key)})`, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    const cb = evaluateField(fb, ctx);
    const ts = broadcastTupleSize("distance", [ca.tupleSize, cb.tupleSize]) ?? 1;
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < ts; k++) {
        const d = Math.fround(readAt(ca, i, k) - readAt(cb, i, k));
        sum += d * d;
      }
      out[i] = Math.sqrt(sum);
    }
    return { data: out, tupleSize: 1 };
  });
  return attachArgsSpec(field, "distance", [fa, fb]);
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
 * A uniform draw in [0, 1) keyed on a VALUE the graph computes, rather
 * than on where the element happens to be.
 *
 * THE DIFFERENCE FROM `randomField` IS THE WHOLE POINT, and it is about
 * what survives. `randomField` keys on a point's IDENTITY — the bits of
 * its stored position together with its `seed` attribute — so a point that
 * MOVES draws a different number, which is the right answer when the
 * question is "give this point a number" and the wrong one when the
 * question is "give whatever is at this STATION a number". Anything that
 * has to keep its draw while it is being repaired needs a key that does
 * not move with it: an arc coordinate, a lane, an id, a cell index, the
 * bucket a value falls in. This takes that key as a field and hashes it.
 *
 * The case it was built for is a racetrack's pose: a placement draws one
 * of its asset's recorded shapes, and a repair loop nudges placements
 * sideways every round. Keyed on identity the shape would change every
 * time the piece was nudged; keyed on the station it does not.
 *
 * THE KEY IS HASHED AS BITS, NOT AS A NUMBER, so two values that differ
 * anywhere in their f32 representation are independent draws and there is
 * no interval that maps to one stream. That is what makes it a hash rather
 * than a quantiser, and it is also the trap: a key computed as `s / 3` is
 * a different key on either side of a rounding difference, so QUANTISE
 * DELIBERATELY when you mean buckets — `floor(div(s, 3))` names a bucket,
 * `div(s, 3)` names a value. A key that is already a whole number is exact
 * to at least 2^24 and needs no rounding.
 *
 * `key` salts the stream exactly as `randomField`'s does, and the cooking
 * node's seed is folded in the same way, so two nodes hashing the same
 * value draw differently and one node hashing it under two keys draws
 * twice. A tuple-valued input is refused: a key is one number, and folding
 * three into one silently is how two different keys come to share a
 * stream.
 */
export function randomFrom(value: FieldLike, key: number | string = 0): Field<1> {
  const keyHash = typeof key === "string" ? hashString(key) : key >>> 0;
  const fa = resolveField(value);
  const field = makeField<1>(`randomFrom(${keyRef(fa.key)},${keyHash})`, 1, (ctx) => {
    const ca = evaluateField(fa, ctx);
    if (ca.tupleSize !== 1) {
      throw new Error(
        `randomFrom: the key must be ONE number per element (tupleSize 1), got tupleSize ${ca.tupleSize}; a key is a single value, and folding a tuple into one would let two different keys share a stream — reduce it first, e.g. component(<expr>, 0)`,
      );
    }
    const n = elementCount(ctx);
    const out = new Float32Array(n);
    // BITS, NEVER THE VALUE, for `randomField`'s reason at the same line:
    // `hashCombine` truncates a float toward zero, so every key inside a
    // unit interval would hash identically and a station of 12.1 would
    // draw with 12.9.
    const bits = new Float32Array(1);
    const asU32 = new Uint32Array(bits.buffer);
    for (let i = 0; i < n; i++) {
      bits[0] = ca.data[i] as number;
      out[i] = hashFloat(hashCombine(ctx.seed, keyHash, asU32[0] as number));
    }
    return { data: out, tupleSize: 1 };
  });
  // THE KEY IS ALWAYS CARRIED, even at its default, and always as the
  // author WROTE it rather than as its hash — `randomField` argues both at
  // length. Omitting it at 0 would print a call the parser then refuses,
  // so the two ends would disagree about a spec instead of both rejecting
  // it. A non-finite numeric key survives `fieldFromJson` but not JSON, so
  // it derives no spec at all.
  if (typeof key === "string" || isSpecNumber(key)) {
    return attachArgsSpec(field, "randomFrom", [fa], { key });
  }
  recordWithheld(field, {
    kind: "ungrammatical",
    detail: "randomFrom's numeric `key` must be finite, and not -0",
  });
  return field;
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
