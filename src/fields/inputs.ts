import { pointIdentities } from "../data/identity.js";
import { hashCombine, hashFloat, hashString } from "../random/index.js";
import { attachSpec, isSpecNumber, recordWithheld } from "./spec.js";
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
  const field = makeField(`const(${values.map(keyNum).join(",")})`, ts, (ctx) => {
    const n = elementCount(ctx);
    const data = new Float32Array(n * ts);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < ts; k++) data[i * ts + k] = values[k];
    }
    return { data, tupleSize: ts };
  });
  // The grammar's `constant` takes a finite number or a non-empty array
  // of finite numbers; this constructor accepts NaN/±Infinity too, and a
  // spec carrying one would be rejected by `fieldFromJson`.
  if (values.every(isSpecNumber)) {
    attachSpec(field, { fn: "constant", value: typeof value === "number" ? value : values }, 1);
  } else {
    recordWithheld(field, {
      kind: "ungrammatical",
      detail: "constant's `value` must be finite, and not -0",
    });
  }
  return field;
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
  const field = makeField(key, tupleSize, (ctx) => {
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
  // The grammar requires a non-empty name and, when given, a positive
  // integer tupleSize; this constructor checks neither.
  if (name !== "" && (tupleSize === undefined || (Number.isInteger(tupleSize) && tupleSize >= 1))) {
    attachSpec(
      field,
      tupleSize === undefined ? { fn: "attribute", name } : { fn: "attribute", name, tupleSize },
      1,
    );
  } else {
    recordWithheld(field, {
      kind: "ungrammatical",
      detail:
        name === ""
          ? "attribute's `name` must not be empty"
          : "attribute's `tupleSize` must be a positive integer",
    });
  }
  return field;
}

const P_ATTR = attribute("P", 3);
const POSITION: Field<3> = makeField("position", 3, (ctx) => P_ATTR.evaluate(ctx));
attachSpec(POSITION, { fn: "position" }, 1);

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
attachSpec(INDEX, { fn: "index" }, 1);

/** Element index input: 0, 1, 2, ... over the domain. */
export function index(): Field<1> {
  return INDEX;
}

const FRACTION: Field<1> = makeField("fraction", 1, (ctx) => {
  const n = elementCount(ctx);
  const data = new Float32Array(n);
  // Divide by the number of GAPS (n - 1), so the last element lands
  // exactly on 1 — the closed convention, matching `pointLine`'s default
  // `includeEnd: true`. A lone element has no gap to divide by; it takes
  // the start of the span (0), which is the same degenerate answer
  // `pointLine` gives at count 1, and is why the divisor is never 0. An
  // empty domain produces an empty column and never enters the loop.
  const gaps = n > 1 ? n - 1 : 1;
  for (let i = 0; i < n; i++) data[i] = i / gaps;
  return { data, tupleSize: 1 };
});
attachSpec(FRACTION, { fn: "fraction" }, 1);

/**
 * Normalized element index: `index / (count - 1)`, spanning **[0, 1]
 * inclusive** — the first element is exactly 0 and the last exactly 1.
 * The span is CLOSED, not half-open: with 5 elements the values are 0,
 * 0.25, 0.5, 0.75, 1. A periodic function of it therefore repeats its
 * start value at the last element; scale by `(count - 1) / count` if a
 * seam-free loop is wanted.
 *
 * Degenerate counts: a single element yields 0 (there is no span to
 * normalize over), and an empty domain yields an empty column.
 */
export function fraction(): Field<1> {
  return FRACTION;
}

const NODE_SEED: Field<1> = makeField("nodeSeed", 1, (ctx) => {
  const n = elementCount(ctx);
  const data = new Float32Array(n);
  // `>>> 0` because that is exactly what the device paths write into the
  // seed uniform (`evaluator.ts` and `run.ts` both coerce), and the two
  // must not read the same context differently. Every seed the executor
  // derives is already a uint32, so this changes nothing for them and
  // pins the answer for a node that folds a param into its own seed.
  //
  // Stored as f32 like every other column, so the low bits round off
  // above 2^24. Deliberate, and why the GPU lowering splits the u32
  // rather than converting it whole: both sides must land on the SAME
  // f32, and only 24 of the 32 bits survive the trip either way.
  data.fill(ctx.seed >>> 0);
  return { data, tupleSize: 1 };
});
attachSpec(NODE_SEED, { fn: "nodeSeed" }, 1);

/**
 * The cooking node's own seed — `EvalContext.seed`, which the executor
 * derives as `deriveNodeSeed(graph.seed, nodeId)` and which `randomField`
 * already hashes. Constant over the domain: the same number on every
 * element, changing only when the GRAPH seed or the node's id changes.
 *
 * It exists because a serialized field expression bakes its numbers, so a
 * saved noise carries a literal `opts.seed` and the graph's seed box
 * moves nothing about it. `opts.seed` is read as a plain number and
 * cannot hold a spec; `opts.position` is an ordinary argument position
 * and can — so this is what an author folds into the SAMPLE POSITION to
 * make a frozen noise re-roll with the graph.
 *
 * Fold it BOUNDED. The offset per axis is
 * `A * (fract(nodeSeed * 2^-32 * K) - W0)`, added outside whatever
 * position the noise already sampled — one axis of it, with the shared
 * `nodeSeed * 2^-32` written out both times because JSON has no way to
 * name a subexpression:
 *
 * ```json
 * { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [
 *   { "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" },
 *     2.3283064365386963e-10] }, 1021] },
 *   { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args":
 *     [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] },
 *   0.245422363] }, 1600] }
 * ```
 *
 * `2.3283064365386963e-10` is 2^-32, and scaling by a power of two is
 * exact, so the fold reads the seed's HIGH bits — the ones a hash
 * actually randomizes — rather than the low bits an f32 column has
 * already rounded away. `A` (1600 here) is about `32 / opts.frequency`,
 * a shift of roughly 32 noise cells: far enough to decorrelate, near
 * enough that an f32 still resolves a lattice cell at the sample point.
 * `K` differs per noise on one node (1021, 3067, 8191) so several
 * noises on the same node do not move in lockstep. `W0` is the
 * expression's own value at that graph's default seed, which makes the
 * offset exactly `+0` there — so folding this into a saved graph leaves
 * what it already cooks bit-identical and only adds an effect to the
 * seed box.
 *
 * Two rules, both load-bearing. Build it from `add`/`sub`/`mul`/`floor`
 * and nothing else: those four are bit-exact across CPU and GPU, while
 * `div` is within a range-ULP and `sin` far worse, and a one-ULP
 * disagreement INSIDE a `floor` moves the offset by a whole unit rather
 * than a ULP. And do not write the unbounded `mul(nodeSeed, 1e-6)`: it
 * reaches ~1.3e4 world units, which is harmless at frequency 0.045 and
 * leaves ~73 f32 steps per noise period at frequency 14 — a field that
 * still cooks, still looks plausible, and rounds differently on CPU and
 * GPU. `docs/authoring.md` carries the derivation.
 *
 * Two properties worth stating, because both are easy to assume wrongly:
 *
 * - The value lands in an f32 column, so seeds above 2^24 round to the
 *   nearest multiple of a power of two. It is a decorrelation source, not
 *   an integer you can compare for equality against `Graph.describe`'s
 *   reported seed.
 * - It is NOT in `Field.key`, and must not be: the key is fixed at
 *   construction while the seed arrives at evaluation. Invalidation is
 *   exact anyway, because the executor's memo key already carries the
 *   node seed verbatim (`|s${seed}|`) — every node recooks when the graph
 *   seed moves, whether or not its fields mention this one.
 */
export function nodeSeed(): Field<1> {
  return NODE_SEED;
}

/**
 * Per-element deterministic random in [0, 1). Same seed and key always
 * reproduce the same values; distinct keys give independent streams.
 *
 * On the POINT domain the draw is keyed on each point's IDENTITY —
 * `hashCombine(ctx.seed, key, identity)`, where identity hashes the bit
 * patterns of the point's stored position with its `seed` attribute — so
 * the value belongs to the POINT and not to the slot it happens to
 * occupy. Reordering, filtering upstream, or re-deriving a point inside
 * a neighbouring cell's halo hands it the same number. Two consequences
 * an author has to know: a cloud whose points share a position AND a
 * seed gets one value repeated (a fresh `createPointCloud` is exactly
 * that — every P at the origin, every seed 0, so this is constant over
 * it), and moving points changes their randomness, so draw before you
 * jitter if you want the value to survive the move.
 *
 * On the vertex, primitive and detail domains there is no position and
 * no seed to key on, so the element index is used — it is the only name
 * those elements have.
 */
export function randomField(key: number | string = 0): Field<1> {
  const keyHash = typeof key === "string" ? hashString(key) : key >>> 0;
  const field = makeField(`random(${keyHash})`, 1, (ctx) => {
    const n = elementCount(ctx);
    const seed = ctx.seed;
    const data = new Float32Array(n);
    if (ctx.domain === "point") {
      const ident = pointIdentities(ctx.geo, `randomField(${JSON.stringify(key)})`);
      for (let i = 0; i < n; i++) data[i] = hashFloat(hashCombine(seed, keyHash, ident[i]));
    } else {
      for (let i = 0; i < n; i++) data[i] = hashFloat(hashCombine(seed, keyHash, i));
    }
    return { data, tupleSize: 1 };
  });
  // The spec carries the ORIGINAL key, not the hash. Emitting `keyHash`
  // would rebuild the same stream — `hashString` returns a uint32 and
  // `>>> 0` is idempotent, so re-hashing it is a no-op — but it would
  // describe the field as something nobody wrote: a saved graph would
  // show `randomField("species")` as an opaque uint32, and the author's
  // name would be unrecoverable from it. Fidelity of the description,
  // not correctness of the stream, is the reason.
  //
  // A non-finite numeric key survives `fieldFromJson` but not JSON
  // (NaN/Infinity serialize as null, which the parser then rejects), so
  // it derives no spec.
  if (typeof key === "string" || isSpecNumber(key)) {
    attachSpec(field, { fn: "randomField", key }, 1);
  } else {
    recordWithheld(field, {
      kind: "ungrammatical",
      detail: "randomField's numeric `key` must be finite, and not -0",
    });
  }
  return field;
}
