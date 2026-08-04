import { hashCombine, hashFloat, hashString } from "../random/index.js";
import {
  type Field,
  type FieldLike,
  elementCount,
  isField,
  keyNum,
  makeField,
} from "./types.js";

/**
 * Constant field: the same scalar or tuple for every element. Values are
 * stored as f32.
 */
export function constant(value: number): Field<1>;
export function constant(value: readonly number[]): Field;
export function constant(value: number | readonly number[]): Field;
export function constant(value: number | readonly number[]): Field {
  const values = typeof value === "number" ? [value] : [...value];
  const ts = values.length;
  if (ts < 1) throw new Error("constant: tuple must have at least one component");
  return makeField(`const(${values.map(keyNum).join(",")})`, ts, (ctx) => {
    const n = elementCount(ctx);
    const data = new Float32Array(n * ts);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ts; k++) data[i * ts + k] = values[k];
    }
    return { data, tupleSize: ts };
  });
}

/** Coerce a `T | Field` parameter to a Field (numbers/arrays wrap into constant). */
export function resolveField(v: FieldLike): Field {
  return isField(v) ? v : constant(v);
}

/**
 * Read a named attribute of the context's domain. Numeric attributes are
 * returned as zero-copy views of the attribute storage; bool attributes
 * are copied to 0/1 floats; string attributes are not readable as fields.
 * When `tupleSize` is given, the attribute's tuple size must match.
 */
export function attribute(name: string, tupleSize?: number): Field {
  // JSON.stringify quotes and escapes the name, so keys stay
  // injection-proof for arbitrary attribute names.
  const quoted = JSON.stringify(name);
  const key = tupleSize === undefined ? `attr(${quoted})` : `attr(${quoted},${tupleSize})`;
  return makeField(key, tupleSize, (ctx) => {
    const attr = ctx.geo.attrs[ctx.domain].require(name);
    if (attr.type === "string") {
      throw new Error(`attribute "${name}": string attributes cannot be read as fields`);
    }
    if (tupleSize !== undefined && attr.tupleSize !== tupleSize) {
      throw new Error(
        `attribute "${name}": expected tupleSize ${tupleSize}, got ${attr.tupleSize}`,
      );
    }
    const ts = attr.tupleSize;
    const n = elementCount(ctx) * ts;
    if (attr.data instanceof Uint8Array) {
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = attr.data[i];
      return { data, tupleSize: ts };
    }
    return { data: attr.data.subarray(0, n), tupleSize: ts };
  });
}

const P_ATTR = attribute("P", 3);
const POSITION: Field<3> = makeField("position", 3, (ctx) => P_ATTR.evaluate(ctx));

/** The standard position input: reads the `P` attribute (f32, tuple 3). */
export function position(): Field<3> {
  return POSITION;
}

const INDEX: Field<1> = makeField("index", 1, (ctx) => {
  const n = elementCount(ctx);
  const data = new Uint32Array(n);
  for (let i = 0; i < n; i++) data[i] = i;
  return { data, tupleSize: 1 };
});

/** Element index input: 0, 1, 2, ... over the domain. */
export function index(): Field<1> {
  return INDEX;
}

/**
 * Per-element deterministic random in [0, 1), derived from
 * `hashCombine(ctx.seed, key, elementIndex)`. Same seed and key always
 * reproduce the same values; distinct keys give independent streams.
 */
export function randomField(key: number | string = 0): Field<1> {
  const keyHash = typeof key === "string" ? hashString(key) : key >>> 0;
  return makeField(`random(${keyHash})`, 1, (ctx) => {
    const n = elementCount(ctx);
    const seed = ctx.seed;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = hashFloat(hashCombine(seed, keyHash, i));
    return { data, tupleSize: 1 };
  });
}
