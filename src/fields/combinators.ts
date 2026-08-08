import { resolveField } from "./inputs.js";
import { attachArgsSpec, isSpecNumber, recordWithheld } from "./spec.js";
import {
  type Column,
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  keyNum,
  keyRef,
  makeField,
} from "./types.js";

/**
 * Broadcast rule shared by all elementwise combinators: scalars
 * (tupleSize 1) broadcast against any tuple size; non-scalar tuple sizes
 * must match exactly.
 */
function broadcastTupleSize(kind: string, sizes: readonly (number | undefined)[]): number | undefined {
  let ts: number | undefined = 1;
  for (const s of sizes) {
    if (s === undefined) return undefined;
    if (s === 1) continue;
    if (ts !== 1 && ts !== s) {
      throw new Error(`${kind}: incompatible tuple sizes ${ts} and ${s}`);
    }
    ts = s;
  }
  return ts;
}

/** Read component k of element i from a column, broadcasting scalars. */
function readAt(col: Column, i: number, k: number): number {
  return col.tupleSize === 1 ? col.data[i] : col.data[i * col.tupleSize + k];
}

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
  // derivation covers all 24. `elementwiseKindsAreRegisteredFns` in
  // spec.test.ts pins that correspondence so it cannot drift.
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
