import { pointIdentities, primitiveIdentities } from "../data/identity.js";
import { hashCombine, hashFloat, hashString } from "../random/index.js";
import {
  type FieldSpec,
  MAX_SPEC_DEPTH,
  attachSpec,
  isSpecNumber,
  peekFieldSpec,
  recordWithheld,
  specDepth,
  withheldOver,
} from "./spec.js";
import {
  type Field,
  type FieldLike,
  elementCount,
  evaluateField,
  isField,
  keyNum,
  keyRef,
  makeField,
} from "./types.js";
import { broadcastTupleSize, readColumnAt } from "./broadcast.js";

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
 * are copied to 0/1 floats. A string attribute has no numeric column to
 * return and is refused here — {@link attributeIs} and
 * {@link byAttribute} are how one drives a field. When `tupleSize` is
 * given, the attribute's tuple size must match.
 */
export function attribute(name: string, tupleSize?: number): Field {
  // JSON.stringify quotes and escapes the name, so keys stay
  // injection-proof for arbitrary attribute names.
  const quoted = JSON.stringify(name);
  const key = tupleSize === undefined ? `attr(${quoted})` : `attr(${quoted},${tupleSize})`;
  const field = makeField(key, tupleSize, (ctx) => {
    const attr = ctx.geo.attrs[ctx.domain].require(name);
    if (attr.type === "string") {
      // THE message an author hits, not the one in the GPU compiler: that
      // path declines with `compile-error` and the node re-resolves here,
      // so a fix named only over there is a fix nobody is shown.
      throw new Error(
        `attribute "${name}": a string attribute has no numeric column to read; ` +
          `test it with attributeIs("${name}", "<value>"), which is 1 where it matches ` +
          `and 0 elsewhere, or select on it with byAttribute("${name}", {...}, <default>). ` +
          `Reading the table INDEX is deliberately not offered — it is ` +
          `insertion-ordered and differs between cells of a partitioned world.`,
      );
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

/**
 * Test a STRING attribute against a literal: 1 on elements whose `name`
 * is `value`, 0 everywhere else. The way a string column drives a field,
 * and a predicate rather than an accessor for the reason that follows.
 *
 * A string column stores indices into a per-attribute table
 * (`Attribute.stringTable`), and that table is insertion-ordered and
 * REBUILT by ordinary work: `setAttribute` interns its whole declared
 * list up front, while clone, filter and merge re-intern per element and
 * so compact the table to first-encounter order over the survivors. The
 * same logical value therefore sits at different indices depending on
 * what happened upstream — and, under partitioned cooking, in different
 * cells of one world. A fn that handed back the INDEX would agree with
 * itself everywhere until two cells disagreed. The predicate resolves the
 * index against the geometry in hand and never exposes it, so there is
 * nothing left to disagree about.
 *
 * That same fact forces the uncomfortable half of the semantics: a
 * literal ABSENT from the geometry's table yields all zeros rather than
 * throwing. A cell holding no pines legitimately has no `"pine"` in its
 * table, and filtering the last pine away does the same thing within one
 * cook — so an error there would make the result depend on how the world
 * was partitioned. The cost is that a MISSPELLED literal reads as
 * "nothing matches"; partition-independence is an invariant and typo
 * detection is a convenience, so the convenience loses.
 *
 * Structural mistakes still throw, and the line is exactly this: absence
 * of a VALUE is data, absence of an ATTRIBUTE is a bug. A missing
 * attribute throws, and so does a numeric one — naming `eq(attribute(…))`
 * as the thing that author wanted.
 *
 * Reads component 0 of a tuple-valued string attribute, matching
 * `Attribute.getString`'s default component. Never mutates the geometry:
 * the lookup is `Attribute.lookupString`, not `internString`.
 */
export function attributeIs(name: string, value: string): Field<1> {
  // Both halves go through JSON.stringify, which quotes and escapes them,
  // so neither an attribute name nor a literal containing a comma or a
  // quote can forge the key of a different (name, value) pair.
  const key = `attrIs(${JSON.stringify(name)},${JSON.stringify(value)})`;
  const field = makeField<1>(key, 1, (ctx) => {
    const attr = ctx.geo.attrs[ctx.domain].require(name);
    if (attr.type !== "string") {
      throw new Error(
        `attributeIs "${name}": expected a string attribute, got ${attr.type}; ` +
          `compare a numeric attribute with eq(attribute("${name}"), value)`,
      );
    }
    const n = elementCount(ctx);
    const data = new Float32Array(n);
    const idx = attr.lookupString(value);
    // Absent from this geometry's table: every element is a non-match, and
    // the zero-filled column already says so.
    if (idx !== undefined) {
      const ts = attr.tupleSize;
      const src = attr.data;
      for (let i = 0; i < n; i++) data[i] = src[i * ts] === idx ? 1 : 0;
    }
    return { data, tupleSize: 1 };
  });
  // The grammar requires a non-empty name; the value has no such rule,
  // because "" is a real table entry — it is the default every string
  // attribute interns at index 0, so `attributeIs(name, "")` selects the
  // elements nobody ever wrote to.
  if (name !== "") {
    attachSpec(field, { fn: "attributeIs", name, value }, 1);
  } else {
    recordWithheld(field, {
      kind: "ungrammatical",
      detail: "attributeIs's `name` must not be empty",
    });
  }
  return field;
}

/**
 * The tuple size a case set resolves to, or undefined when some branch's
 * width is not known until a geometry is in hand (`attribute(name)` with
 * no declared `tupleSize`). The rule is the library's ordinary broadcast
 * rule — {@link broadcastTupleSize} — restated here only so the message
 * can name the CASE KEY that disagreed, which is the whole reason an
 * author is reading it.
 */
function caseSetTupleSize(
  name: string,
  keys: readonly string[],
  branches: readonly Field[],
  fallback: Field,
): number | undefined {
  // "the default" is the last entry, so one loop covers both populations
  // and the blame is always attributed to the position that widened it.
  const labels = [...keys.map((k) => `case ${JSON.stringify(k)}`), "the default"];
  const sizes = [...branches.map((b) => b.tupleSize), fallback.tupleSize];
  let ts = 1;
  let setBy = "the default";
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    if (s === undefined) return undefined;
    if (s === 1) continue;
    if (ts !== 1 && ts !== s) {
      throw new Error(
        `byAttribute ${JSON.stringify(name)}: ${labels[i]} has tuple size ${s}, but ${setBy} has ` +
          `tuple size ${ts}; every case and the default must agree, except that a scalar ` +
          `broadcasts against any size`,
      );
    }
    ts = s;
    setBy = labels[i];
  }
  return ts;
}

/**
 * Select a field by the value of a STRING attribute: the case whose key
 * equals the element's `name`, or `defaultValue` where no key does. The
 * N-way form of {@link attributeIs}, and it exists because the 2-way form
 * composes badly — an expression that sizes a part by its kind on three
 * axes needs one nested `lerp` per axis per kind, so a new kind means
 * editing every axis and forgetting one is silent.
 *
 * **The `default` is required, and that is the point of the fn.** A case
 * set spread across nested `lerp`s has a fall-through nobody wrote: the
 * value an element takes when every predicate reads 0. It cannot be
 * searched for, reviewed, or edited, because it is the ABSENCE of an
 * expression rather than one. Naming it is what this fn buys.
 *
 * What it does NOT buy, and the docs must not imply otherwise: **a case
 * key is never validated against the geometry's string table.** A key the
 * table does not hold selects nothing and its elements take the default,
 * so a MISSPELLED key becomes dead code rather than an error. That is
 * forced, not chosen — each cell of a partitioned world cooks its own
 * geometry with its own insertion-ordered table (see {@link attributeIs}),
 * so a cell legitimately holding no clamps has no `"clamp"` in its table,
 * and throwing there would make output depend on how the world was
 * partitioned. Partition-independence is an invariant; typo detection is a
 * convenience.
 *
 * What it DOES buy is narrower and real: the fall-through is explicit, and
 * the case set is enumerable in one place instead of spread across one
 * expression per component.
 *
 * Structural mistakes still throw, on the same line {@link attributeIs}
 * draws: a missing attribute throws, and a NUMERIC one throws naming
 * `eq(attribute(name), value)`. Absence of a VALUE is data; absence of an
 * ATTRIBUTE is a bug.
 *
 * Widths follow the library's ordinary broadcast rule — a scalar case
 * broadcasts against tuple cases, two non-scalar widths must match — so
 * the result's tuple size is a property of the EXPRESSION and never of
 * which case happened to fire.
 *
 * Every case is evaluated, then selected between, exactly as the nested
 * `lerp`s it replaces already did (`lerp` is strict). Sub-expressions
 * shared between cases are evaluated once, because `evaluateField`
 * memoizes per context on `Field.key`.
 *
 * At most one case can fire — distinct keys intern at distinct table
 * indices — so the result does not depend on the order the cases are
 * written in, and `Field.key` sorts them so two orderings are one field.
 */
export function byAttribute(
  name: string,
  cases: Readonly<Record<string, FieldLike>>,
  defaultValue: FieldLike,
): Field {
  const keys = Object.keys(cases).sort();
  if (keys.length === 0) {
    throw new Error(
      `byAttribute ${JSON.stringify(name)}: \`cases\` must name at least one value; a case set ` +
        `with no cases is its default written the long way`,
    );
  }
  const branches = keys.map((k) => resolveField(cases[k]));
  const fallback = resolveField(defaultValue);
  const staticTs = caseSetTupleSize(name, keys, branches, fallback);
  // Sorted keys, so two orderings of one case set are one field — they
  // compute the same column, and `Field.key`'s contract is that equal keys
  // mean interchangeable columns. Both halves of every pair go through
  // `JSON.stringify` and the child keys through `keyRef`, so no attribute
  // name, case key or child key can forge the shape of another.
  const key =
    `byAttr(${JSON.stringify(name)},` +
    `${keys.map((k, i) => `${JSON.stringify(k)}=${keyRef(branches[i].key)}`).join(",")},` +
    `else=${keyRef(fallback.key)})`;
  const field = makeField(key, staticTs, (ctx) => {
    const attr = ctx.geo.attrs[ctx.domain].require(name);
    if (attr.type !== "string") {
      throw new Error(
        `byAttribute ${JSON.stringify(name)}: expected a string attribute, got ${attr.type}; ` +
          `compare a numeric attribute with eq(attribute(${JSON.stringify(name)}), value)`,
      );
    }
    const cols = branches.map((b) => evaluateField(b, ctx));
    const fallbackCol = evaluateField(fallback, ctx);
    const ts =
      broadcastTupleSize(
        `byAttribute ${JSON.stringify(name)}`,
        [...cols.map((c) => c.tupleSize), fallbackCol.tupleSize],
      ) ?? 1;
    const n = elementCount(ctx);
    const out = new Float32Array(n * ts);
    // Dense table-index -> case ordinal, so the inner loop is an array
    // read rather than a Map probe. -1 is "no case", which is what every
    // index a case set does not name keeps — including every index when a
    // key is absent from this geometry's table. `lookupString` never
    // inserts, so the table is the same afterwards as before.
    const lut = new Int32Array(attr.stringTable.length).fill(-1);
    for (let c = 0; c < keys.length; c++) {
      const idx = attr.lookupString(keys[c]);
      if (idx !== undefined) lut[idx] = c;
    }
    const src = attr.data;
    const ats = attr.tupleSize;
    for (let i = 0; i < n; i++) {
      // Component 0 of a tuple-valued string attribute, matching
      // `Attribute.getString`'s default component and `attributeIs`.
      const raw = src[i * ats];
      const c = raw < lut.length ? lut[raw] : -1;
      const col = c < 0 ? fallbackCol : cols[c];
      for (let k = 0; k < ts; k++) out[i * ts + k] = readColumnAt(col, i, k);
    }
    return { data: out, tupleSize: ts };
  });
  // Derivation is all-or-nothing over every branch, the rule `argSpecs`
  // enforces for argument lists — but the case values are not an argument
  // LIST, so the withhold and the depth are counted here. The emitted
  // `cases` object is keyed in the caller's order rather than the sorted
  // one, because a spec describes what the author wrote; the sorted order
  // is an implementation detail of the key and of the kernel.
  if (name === "") {
    recordWithheld(field, { kind: "ungrammatical", detail: "byAttribute's `name` must not be empty" });
    return field;
  }
  const byKey = new Map(keys.map((k, i) => [k, branches[i]]));
  // Null-prototype, for the reason the grammar's builder is: `"__proto__"`
  // is a legal case key, and writing it onto a plain object runs
  // `Object.prototype`'s setter and drops the case. Here the loss lands on
  // the SPEC rather than the field — the column would be right and
  // `fieldToJson` would emit a case set missing an entry, so a kernel
  // built from that spec would answer the default where the CPU did not.
  const caseSpecs: Record<string, FieldSpec> = Object.create(null) as Record<string, FieldSpec>;
  let deepest = 0;
  for (const k of Object.keys(cases)) {
    const branch = byKey.get(k) as Field;
    const spec = peekFieldSpec(branch);
    if (spec === undefined) {
      recordWithheld(field, withheldOver(branch));
      return field;
    }
    const d = specDepth(spec);
    if (d > deepest) deepest = d;
    caseSpecs[k] = spec;
  }
  const fallbackSpec = peekFieldSpec(fallback);
  if (fallbackSpec === undefined) {
    recordWithheld(field, withheldOver(fallback));
    return field;
  }
  const fd = specDepth(fallbackSpec);
  if (fd > deepest) deepest = fd;
  const depth = deepest + 1;
  if (depth > MAX_SPEC_DEPTH) {
    recordWithheld(field, { kind: "too-deep" });
    return field;
  }
  attachSpec(field, { fn: "byAttribute", name, cases: caseSpecs, default: fallbackSpec }, depth);
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
 * **For making a saved noise re-roll with the graph seed, reach for
 * `opts.seed: { from: "node", variant: N }` instead.** That form resolves
 * to `hashCombine(ctx.seed, variant)` in u32 integer math — no float in
 * the seed path, bit-exact on CPU and GPU with no tolerance spent, no
 * calibration constant to go stale, and `variant` gives one node as many
 * independent draws as it needs. It is the preferred spelling and the one
 * to write in new graphs. The cost is that adopting it in a SAVED noise
 * re-rolls that noise: it is a different draw from the same family at the
 * graph's default seed, and no form can avoid that without carrying the
 * default seed in the spec.
 *
 * The rest of this block documents the idiom that form replaces. NO graph
 * under `graphs/` writes it any more — commit 8faf95d converted all 39 —
 * but it is still legal grammar, four labelled fixtures in
 * `tests/foldCorpus.test.ts` pin the constant-fold against it, and a graph
 * saved before that conversion or an expression written by hand may hold
 * one, so a reader meeting one needs to know what it computes.
 *
 * It exists because a serialized field expression bakes its numbers, so a
 * saved noise carries a literal `opts.seed` and the graph's seed box
 * moves nothing about it. Before the tagged form, `opts.seed` was read as
 * a plain number and could hold nothing else; `opts.position` is an
 * ordinary argument position and can — so this is what an author folded
 * into the SAMPLE POSITION to make a frozen noise re-roll with the graph.
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
 * `W0` is also why the idiom was replaced rather than merely joined: it
 * is correct for exactly one (graph seed, node id) pair, so a rename, a
 * change of default seed, or a copy into another graph leaves it stale —
 * the graph still cooks, still looks plausible, and is simply no longer
 * seed-neutral, with no test able to say so.
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
 * On the PRIMITIVE domain the draw is keyed on the primitive's identity:
 * the order-independent fold of the identities of its own points
 * (`primitiveIdentities`). So an edge network that comes back permuted —
 * from a faster neighbour query, a filter upstream, or a cell cooked with
 * a halo — hands each edge the same number it had, and an edge agrees
 * with its reverse. The same two consequences follow as on the point
 * domain, plus one of its own: two primitives over the same point SET are
 * one primitive here whatever their vertex order, so a quad ABCD and a
 * quad ABDC draw alike.
 *
 * On the VERTEX and DETAIL domains the element index is used. Detail has
 * exactly one element, so there is nothing to name. Vertex has the same
 * index defect the primitive domain had, and no caller: a vertex is a
 * point AND a position within a primitive, which is a different question
 * from either identity above, and this library does not answer a question
 * nothing has asked yet. The asymmetry is deliberate, not an oversight.
 */
export function randomField(key: number | string = 0): Field<1> {
  const keyHash = typeof key === "string" ? hashString(key) : key >>> 0;
  const field = makeField(`random(${keyHash})`, 1, (ctx) => {
    const n = elementCount(ctx);
    const seed = ctx.seed;
    const data = new Float32Array(n);
    const who = `randomField(${JSON.stringify(key)})`;
    if (ctx.domain === "point") {
      const ident = pointIdentities(ctx.geo, who);
      for (let i = 0; i < n; i++) data[i] = hashFloat(hashCombine(seed, keyHash, ident[i]));
    } else if (ctx.domain === "primitive") {
      // A primitive is named by its own points, so this survives a
      // reordering exactly as the point domain does. Vertex and detail
      // fall through to the index deliberately — see the note above.
      const ident = primitiveIdentities(ctx.geo, who);
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
