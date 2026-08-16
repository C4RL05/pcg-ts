/**
 * Every value in a graph that can be addressed and turned, by the name a
 * panel, a link or a CLI flag has to spell it with.
 *
 * A graph's params live in three different places and only one of them is
 * obvious. A registered node's are in the REGISTRY, keyed by type. A
 * subgraph wrapper's are on the INSTANCE, resolved at wrap time from the
 * inner params they bind. And a `param` node carrying its own value lives
 * INSIDE a field expression, where nothing outside the spec names it at
 * all. The address that reaches the third — `<node>.<param>.<fieldParam>`
 * — is not derivable from any catalog, which is why finding one used to
 * mean opening the graph in the sandbox and reading a label.
 *
 * This is the one derivation of those addresses. `pcg validate --params`
 * prints it; the sandbox builds its knobs from it, so a panel file and a
 * command line cannot disagree about what a graph's params are called.
 *
 * It reports what the GRAPH says, and stops there. Whether an address gets
 * a widget, a label, a section or a slider step is a panel's business (see
 * `graphs/panels/`), and the two must not be confused: a knob that no
 * panel shows is still addressable, and that is exactly the case this
 * exists to make findable.
 */
import { isField } from "../fields/index.js";
// Straight from the grammar module, not through `src/fields/index.ts`:
// that barrel deliberately does not re-export it (the noise modules would
// close a cycle through it), and this package's copy is the one re-exported
// from `src/nodes/index.ts`.
import {
  type FieldBindingValue,
  type InlineParamMeta,
  inlineParamMetaOf,
  inlineParamValuesOf,
} from "../fields/fieldJson.js";
import { MAX_SPEC_DEPTH, peekFieldSpec } from "../fields/spec.js";
import {
  type Graph,
  type GraphParam,
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  describeSubgraphParams,
  getSubgraphSpec,
} from "../graph/index.js";
// By module: the scan is the graph layer's internal, and this is the
// second caller of it rather than a new public surface.
import { paramScan } from "../graph/paramScan.js";
import { getNodeType, hasNodeType } from "./registry.js";

/** What every addressable param carries, whatever its scope. */
export interface DescribedParamBase {
  /** The address a panel, a link or a CLI flag spells it with. */
  readonly key: string;
  /**
   * The registered schema, the wrapper's resolved one, or — for a value
   * living inside an expression — one derived from the shape of the literal
   * its author wrote plus whatever the `param` node declares about it.
   */
  readonly schema: ParamSchema;
  /**
   * The value the graph currently holds. Absent when a node param holds a
   * Field: the value is then the expression, and what a knob turns is one
   * of the `fieldParam` entries that follow it.
   */
  readonly value?: ParamValue;
  /** Whether the param holds a Field rather than a plain value. */
  readonly holdsField: boolean;
  /**
   * Whether someone DECLARED this one worth turning: a wrapper's exposed
   * param, a literal an author named inside an expression, or a top-level
   * declaration. A standard node's params are mostly wiring and report
   * `false` — still addressable, just not self-nominated.
   */
  readonly exposed: boolean;
}

/**
 * A param belonging to one node, addressed `"<node>.<param>"` or
 * `"<node>.<param>.<fieldParam>"`. A `param` name may not contain a "."
 * (the grammar refuses one), so the split is unambiguous.
 */
export interface DescribedNodeParam extends DescribedParamBase {
  readonly scope: "node";
  /** Node instance holding it. */
  readonly node: string;
  /** The node's declared type, or `undefined` for a def carrying none. */
  readonly type: string | undefined;
  /** Param name on the node. */
  readonly param: string;
  /** Name of the inline `param` node inside `param`'s field expression. */
  readonly fieldParam?: string;
}

/**
 * A param belonging to the GRAPH: declared once at the top level, read by
 * name from any node's expression, addressed `"$<name>"`. One segment and
 * a sigil, so it collides with neither node shape nor with the sandbox's
 * bare `"seed"` — and so its KIND is legible without the graph in hand,
 * where a bare name is indistinguishable from a mistyped node id.
 */
export interface DescribedGraphScopedParam extends DescribedParamBase {
  readonly scope: "graph";
  /** The declared name, without the address's `$`. */
  readonly name: string;
  /**
   * `"<node>.<param>"` of every slot this value reaches — the ones it is
   * WRITTEN into first, then the ones whose expressions read the name.
   */
  readonly readers: readonly string[];
  /** Node params it writes into, when it declares any. */
  readonly targets?: readonly { readonly node: string; readonly param: string }[];
  /**
   * Total READINGS across those slots — a name read four times inside one
   * expression is 1 slot and 4 readings, and the second number is the one
   * that says why it is a param.
   */
  readonly readings: number;
}

/**
 * A node param whose value is WRITTEN into it by a graph-scoped
 * declaration's `targets` — an address that can be READ and cannot be
 * turned.
 *
 * Its own scope rather than a flag on {@link DescribedNodeParam}, because
 * the difference is not a decoration on an editable address: the literal
 * standing in the graph file for this slot is dead text. `deserializeGraph`
 * overwrites it from the declaration on every load, and `serializeGraph`
 * writes the declaration's current value straight back over it — so
 * whatever a knob, a `--param` flag or an agent writes here is gone by the
 * next load, with no error to say so. A consumer that narrows on `scope`
 * to decide what an address IS therefore has to meet this one and choose,
 * which is the whole reason it is a third member and not a boolean: an
 * optional field lets a listing keep the old label by doing nothing.
 *
 * `$<driver>` is the address that DOES move it.
 */
export interface DescribedDrivenParam extends DescribedParamBase {
  readonly scope: "driven";
  /** Node instance holding it. */
  readonly node: string;
  /** The node's declared type, or `undefined` for a def carrying none. */
  readonly type: string | undefined;
  /** Param name on the node. */
  readonly param: string;
  /**
   * Never set here. Declared so a consumer narrowing `scope === "graph"`
   * and treating everything else as a node address keeps compiling: an
   * inline field param inside a driven slot is unreachable, since a
   * declaration with `targets` is refused against a param holding an
   * expression.
   */
  readonly fieldParam?: string;
  /**
   * Declared name (no `$`) of the graph param that writes this slot.
   *
   * The EFFECTIVE one when two declarations name the same slot: they are
   * written in declaration order, so the last one wins and it is the only
   * one whose value is actually in the param.
   */
  readonly driver: string;
}

/**
 * One addressable param of a graph; see {@link describeGraphParams}.
 *
 * A UNION rather than one shape with optional fields, because a
 * graph-scoped param has no node and a consumer reading `.node` as
 * `undefined` would print a wrong address. Narrowing on `scope` makes each
 * consumer decide what it shows for a knob belonging to no node — and, for
 * {@link DescribedDrivenParam}, for one that belongs to a node and is
 * nonetheless not the address that turns it.
 */
export type DescribedGraphParam =
  | DescribedNodeParam
  | DescribedDrivenParam
  | DescribedGraphScopedParam;

/**
 * The `ParamSchema` an inline field param does not have, derived from the
 * shape of its value and from what the `param` node declares beside it.
 *
 * A node param carries a registered schema; a `param` node inside a field
 * expression carries a name and a number. The value's shape is enough to
 * type it — the same rule a targetless exposed param already uses to type
 * itself from its default — so a graph describes its own knobs with no
 * panel file at all. `min`, `max` and `description` come from the node when
 * it declares them ({@link inlineParamMetaOf}), which is what keeps them in
 * the GRAPH rather than in a presentation file beside it.
 *
 * `undefined` for a tuple the param vocabulary cannot name — 1 or 2
 * components, or more than 4. The grammar accepts any non-empty run of
 * numbers while `ParamType` names only vec3 and vec4, and inventing a type
 * here would describe an address nothing can write back.
 */
export function inlineParamSchema(
  name: string,
  value: FieldBindingValue,
  meta?: InlineParamMeta,
  origin = "inside this node's field expression",
): ParamSchema | undefined {
  // Addressed to whoever is looking at an undocumented knob, so it says
  // where the missing sentence goes rather than restating the mechanism.
  const description =
    meta?.description ??
    `Inline value "${name}" ${origin}. The graph says nothing else ` +
      'about it — write "description", "min" and "max" beside the value to say what turning it does.';
  const bounds = {
    ...(meta?.min !== undefined ? { min: meta.min } : {}),
    ...(meta?.max !== undefined ? { max: meta.max } : {}),
  };
  if (typeof value === "number") return { type: "f32", default: value, description, ...bounds };
  if (value.length === 3) return { type: "vec3", default: [...value], description, ...bounds };
  if (value.length === 4) return { type: "vec4", default: [...value], description, ...bounds };
  return undefined;
}


/** A defensive copy of a param value, whatever kind it is. */
function copyParamValue(v: ParamValue): ParamValue {
  return Array.isArray(v) ? ([...v] as ParamValue) : v;
}

/** The inline field params of one node param, in spec-walk order. */
function fieldParamsOf(
  node: string,
  type: string | undefined,
  param: string,
  value: unknown,
): DescribedNodeParam[] {
  if (!isField(value)) return [];
  // The non-throwing reader, and the uncopied one: a field built by
  // makeField carries no spec, and a param holding one is not an error
  // here — it is a param whose insides simply cannot be named. Nothing
  // below mutates the spec, so the defensive copy `getFieldSpec` makes
  // would be one deep clone per field param in the graph, for nothing.
  const spec = peekFieldSpec(value);
  if (spec === undefined) return [];
  const out: DescribedNodeParam[] = [];
  // Two reads of one walk's worth of information, kept apart because they
  // are two questions: what the value IS, and what the graph says about
  // it. The second is empty for every param authored before those keys
  // existed, which is what makes them additive.
  const meta = inlineParamMetaOf(spec);
  for (const [fieldParam, inline] of Object.entries(inlineParamValuesOf(spec))) {
    const schema = inlineParamSchema(fieldParam, inline, meta[fieldParam]);
    if (schema === undefined) continue;
    out.push({
      key: `${node}.${param}.${fieldParam}`,
      scope: "node",
      node,
      type,
      param,
      fieldParam,
      schema,
      // The node param holds a Field; THIS entry holds the literal
      // standing inside it, which is a plain value by construction.
      value: typeof inline === "number" ? inline : [...inline],
      holdsField: false,
      // An author who wrote a value into an expression decided that number
      // was worth turning — the same declaration a wrapper makes by
      // exposing a param.
      exposed: true,
    });
  }
  return out;
}

/**
 * Every addressable param of a graph, in node insertion order and then
 * schema order, with each node param immediately followed by the inline
 * field params living inside it.
 *
 * Two kinds of param are deliberately absent. `items` params hold
 * runtime-injected {@link DataItem}s — bound by a World per cell, never
 * serialized, never authored — so there is no address to publish. And a
 * node whose def is neither registered nor a subgraph wrapper contributes
 * nothing: its params exist, but with no schema to read there is nothing
 * true to say about them beyond their current values.
 *
 * Graph-scoped params come FIRST, in declaration order, before any node.
 * They are graph-level, like the seed, and a reader scanning the list wants
 * the shared knobs at the top — a value read by ten nodes is not a property
 * of whichever node happens to be first.
 *
 * The graph's own `seed` is NOT in this list. It is a property of the
 * graph rather than of any node, it has no `<node>.<param>` address, and
 * every caller that offers it as a knob (the sandbox does, under the bare
 * key `"seed"`) already knows where to find it.
 *
 * A node param a declaration's `targets` WRITES INTO reports
 * `scope: "driven"` rather than `"node"`; see {@link DescribedDrivenParam}
 * for why that is a scope and not a flag. It stays in the list — the
 * address is real and its value is the truth about the slot — but it is no
 * longer indistinguishable from one a knob can turn.
 */
export function describeGraphParams(graph: Graph): DescribedGraphParam[] {
  const out: DescribedGraphParam[] = [];
  const declared = graph.graphParams;
  // "<node>.<param>" -> the declaration that writes it. Built over ALL
  // declarations before any node is described, because a slot is driven by
  // whether a declaration names it and not by where the node sits.
  //
  // Later entries overwrite earlier ones, which the LOAD path no longer
  // produces — `deserializeGraph` refuses two declarations claiming one
  // slot — but this describes any Graph, including one assembled in
  // memory, and the targets are applied in declaration order there too. So
  // the last one is the value actually sitting in the param, and naming
  // the first would report a driver whose value is not there.
  const drivenBy = new Map<string, string>();
  for (const param of declared) {
    for (const t of param.targets ?? []) drivenBy.set(`${t.node}.${t.param}`, param.name);
  }
  if (declared.length > 0) {
    // One walk answers "who reads this name", for every name at once. A
    // declared-but-unread param reports an empty `readers`, which is the
    // only way an author sees that a rename left a value stranded.
    const readers = new Map<string, string[]>();
    const readings = new Map<string, number>();
    for (const ref of paramScan(graph).refs) {
      for (const name of ref.names) {
        let list = readers.get(name);
        if (list === undefined) readers.set(name, (list = []));
        list.push(`${ref.node}.${ref.param}`);
        // SLOTS and READINGS are different numbers wherever a name is worth
        // hoisting: one expression can read the same name four times, and
        // that is the case a param exists for rather than a literal.
        readings.set(name, (readings.get(name) ?? 0) + (ref.readings[name] ?? 1));
      }
    }
    for (const param of declared) {
      // A TARGETED param already carries the schema its targets merged
      // into, and that schema is the point: it is what makes the param an
      // `i32` or an `enum` rather than the `f32` a value's shape would
      // suggest. Only a targetless one is typed from its own value.
      const schema =
        param.schema ??
        inlineParamSchema(
          param.name,
          param.value as FieldBindingValue,
          param,
          `declared in the graph's "params" block`,
        );
      if (schema === undefined) continue;
      // The slots it writes are readers too — and for a targeted param they
      // are the only ones, since a `string` or an `i32` reaches no
      // expression. Listing both is what makes "read by nothing" mean it.
      const written = (param.targets ?? []).map((t) => `${t.node}.${t.param}`);
      out.push({
        key: `$${param.name}`,
        scope: "graph",
        name: param.name,
        readers: [...written, ...(readers.get(param.name) ?? [])],
        // A written target is one reading each; an expression may hold
        // several of the same name.
        readings: written.length + (readings.get(param.name) ?? 0),
        ...(param.targets !== undefined ? { targets: [...param.targets] } : {}),
        schema,
        value: copyParamValue(param.value),
        holdsField: false,
        // A top-level declaration is an author saying this number is worth
        // turning, which is the argument that makes an inline value
        // `exposed` too.
        exposed: true,
      });
    }
  }
  for (const described of graph.describe().nodes) {
    const node = described.id;
    const type = described.defType;
    const def = graph.require(node).def;
    let entries: { name: string; schema: ParamSchema }[];
    const exposedParams = describeSubgraphParams(def);
    let exposed = false;
    if (exposedParams !== undefined) {
      // A wrapper's params live on the INSTANCE: `listNodeTypes()` reports
      // the `subgraph` type as paramless because pins and params are
      // per-instance, so the registry has nothing to offer here.
      entries = exposedParams.map((p) => ({ name: p.name, schema: p.schema }));
      exposed = true;
    } else if (type !== undefined && hasNodeType(type)) {
      entries = Object.entries(getNodeType(type).info.params).map(([name, schema]) => ({
        name,
        schema,
      }));
    } else {
      continue;
    }
    const values = graph.getParams({ id: node } as NodeHandle<Record<string, unknown>>);
    for (const { name, schema } of entries) {
      if (schema.type === "items") continue;
      const value = values[name];
      const holdsField = isField(value);
      const driver = drivenBy.get(`${node}.${name}`);
      const shared: Omit<DescribedNodeParam, "scope" | "key"> = {
        node,
        type,
        param: name,
        schema,
        ...(holdsField ? {} : { value: value as ParamValue }),
        holdsField,
        exposed,
      };
      out.push(
        driver === undefined
          ? { key: `${node}.${name}`, scope: "node", ...shared }
          : { key: `${node}.${name}`, scope: "driven", driver, ...shared },
      );
      out.push(...fieldParamsOf(node, type, name, value));
    }
  }
  return out;
}

/** One constant inside a subgraph body that equals a declared graph param. */
export interface StrandedGraphParamValue {
  /** The declared param whose value it duplicates. */
  readonly name: string;
  /**
   * The wrapper node whose body holds the constant. Nested bodies join
   * their wrappers outermost-first with `" > "`, so a one-level finding —
   * every finding until a body wraps a body — is still a bare node id.
   */
  readonly slot: string;
  /** `"<innerNode>.<param>"` inside that body. */
  readonly innerSlot: string;
  /** The value both carry: a number, or the tuple a vec knob declares. */
  readonly value: number | readonly number[];
}

/**
 * Constants inside subgraph bodies that equal a declared graph param's
 * value — the class of bug that a boundary hides.
 *
 * WHY THIS EXISTS. A body is bound by its WRAPPER and by nothing else, so
 * the graph's `params` block cannot reach into one. That is the correct
 * rule and it is silent: a literal in a body that is a copy of a declared
 * value keeps working, keeps cooking byte-identically, and desyncs the
 * moment the knob moves. It happened in the rig — the cable wraps carried
 * `0.425 * √2` while the eighteen siblings of that number became live, so
 * turning "half width" dragged the truss out through its own cables — and
 * nothing could have reported it: `--params` sees addresses and a constant
 * is not one, the fingerprint sees the default cook and that was
 * unchanged, and a text migration stops at the boundary.
 *
 * WHAT IT LOOKS AT. Every number a body's params hold, wherever it sits:
 * a `{"fn":"constant"}` node, a BARE numeric argument (the commoner
 * spelling by an order of magnitude — 1,017 bare args against 105
 * `constant` nodes across `graphs/`, and the rig's own cable body is 26
 * against 14), a component of a numeric tuple, a number in a sampler's
 * options bag, and a plain non-field param's value. Position is not what
 * makes a match believable — the gates below are — and a scan that
 * believed it was is a scan that misses the bug in the spelling its own
 * graph mostly writes, which is exactly what this one did.
 *
 * It walks nested bodies too, at any depth: a wrapper inside a wrapper is
 * the same boundary twice, and the value is more hidden rather than less.
 *
 * WHAT IT REPORTS, and why it is choosy. A numeric equality is a SUSPICION,
 * not a defect — a body may hold a number that happens to match — so the
 * rule is built to earn its noise. Measured on the rig, which is the only
 * graph with both a declared param and a body: reporting every exact match
 * gave ONE finding and it was a coincidence (`$stretchMin` is 0.55 and the
 * cable body holds an unrelated 0.55), while the real bug's constant was
 * `0.6010407640085654`. So a match counts when EITHER
 *
 *   - the constant is DISTINCTIVE — more significant digits than anyone
 *     types by hand, which is what a value computed from another value
 *     looks like; or
 *   - it matches the declared value times √2, a relationship no coincidence
 *     produces and exactly the "half width / half diagonal" pair the rig's
 *     bug was.
 *
 * and, either way, the constant is not one that stands on its OWN merits
 * ({@link SELF_STANDING}). That last clause is not a refinement, it is what
 * keeps the ×√2 rule usable: the relation is symmetric, so a declared 0.5
 * "derives" 0.7071067811865476 — the unit diagonal's component, which the
 * rig writes four times for reasons that have nothing to do with any param
 * — and widening the scan to bare arguments drags √2 itself into range,
 * where any declared 1 would light it up.
 *
 * A short round number matching exactly is left alone, because that is what
 * a coincidence looks like and a lint nobody believes is worse than none.
 * The costs are stated plainly rather than hidden: a body that freezes a
 * declared 0.5 is not caught, and neither is one that freezes a declared √2
 * or π. The relationship set is deliberately two entries rather than
 * general arithmetic, which would either miss most relationships or flag
 * every number in the graph.
 *
 * A TUPLE declaration (a vec3 knob) is matched WHOLE and componentwise
 * never: `[0.425, 0, 1]` shares two components with most graphs ever
 * written, so component matching would report the coincidence class this
 * lint was tuned to avoid, while a full tuple agreeing to the last bit with
 * one distinctive component is not a coincidence at all.
 */
export function strandedGraphParamValues(graph: Graph): StrandedGraphParamValue[] {
  const declared = graph.graphParams.filter(
    (p) => typeof p.value === "number" || isNumberTuple(p.value),
  );
  if (declared.length === 0) return [];
  const out: StrandedGraphParamValue[] = [];
  for (const state of graph._nodes.values()) {
    const spec = getSubgraphSpec(state.def);
    if (spec === undefined) continue;
    scanBody(spec.graph, state.id, declared, out, new Set());
  }
  return out;
}

/**
 * One body's params against every declaration, then the bodies inside it.
 *
 * `seen` guards the recursion on the body GRAPH rather than on a depth
 * count: a def is a value and two wrappers may share one, so the same body
 * can appear twice in a graph without any cycle, and reporting its
 * constants twice would inflate a count this lint asks people to trust.
 */
function scanBody(
  body: Graph,
  path: string,
  declared: readonly GraphParam[],
  out: StrandedGraphParamValue[],
  seen: Set<Graph>,
): void {
  if (seen.has(body)) return;
  seen.add(body);
  for (const inner of body._nodes.values()) {
    for (const [param, value] of Object.entries(inner.params)) {
      // EVERY field spec in the body, not `paramScan`'s refs: that scan
      // keeps only specs which already read a name, and a stranded constant
      // is precisely one that reads nothing. Filtering by refs made this
      // lint silent on the exact bug it was written for.
      const numbers = paramNumbers(value);
      if (numbers.scalars.length === 0 && numbers.tuples.length === 0) continue;
      const innerSlot = `${inner.id}.${param}`;
      for (const declaredParam of declared) {
        const declaredValue = declaredParam.value;
        if (typeof declaredValue === "number") {
          // Occurrences, not distinct values: a name read twice in one
          // expression is the case a param exists for, and the rig's own
          // bug was two readings in one slot.
          for (const constant of numbers.scalars) {
            if (!scalarIsStranded(constant, declaredValue)) continue;
            out.push({ name: declaredParam.name, slot: path, innerSlot, value: constant });
          }
        } else if (isNumberTuple(declaredValue)) {
          for (const tuple of numbers.tuples) {
            if (!tupleIsStranded(tuple, declaredValue)) continue;
            out.push({ name: declaredParam.name, slot: path, innerSlot, value: [...tuple] });
          }
        }
      }
    }
    const nested = getSubgraphSpec(inner.def);
    if (nested !== undefined) scanBody(nested.graph, `${path} > ${inner.id}`, declared, out, seen);
  }
}

/** Does this body constant look like a frozen copy of `declaredValue`? */
function scalarIsStranded(constant: number, declaredValue: number): boolean {
  if (SELF_STANDING.has(constant)) return false;
  if (constant === declaredValue) return isDistinctive(constant);
  return (
    declaredValue !== 0 && constant === declaredValue * Math.SQRT2 && isDistinctive(constant)
  );
}

/** The same question for a tuple: every component equal, one distinctive. */
function tupleIsStranded(tuple: readonly number[], declaredValue: readonly number[]): boolean {
  if (tuple.length !== declaredValue.length) return false;
  if (!tuple.every((v, i) => v === declaredValue[i])) return false;
  return tuple.some((v) => isDistinctive(v) && !SELF_STANDING.has(v));
}

/**
 * Numbers that occur on their own merits, so an equality with one says
 * nothing about where it came from.
 *
 * √2, √3 and π at the small factors geometry actually writes, plus the
 * degree conversions. Every entry is a hole in the lint — a declared value
 * whose copy will not be reported — which is why the set is generated from
 * three bases rather than accumulated by hand: a list nobody can justify
 * grows until the rule means nothing.
 */
const SELF_STANDING: ReadonlySet<number> = new Set(
  [Math.SQRT2, Math.sqrt(3), Math.PI]
    .flatMap((base) => [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4].flatMap((f) => [base * f, base / f]))
    .concat([180 / Math.PI, Math.PI / 180]),
);

/**
 * Does this number look computed rather than typed?
 *
 * The shortest round-trip decimal of a hand-typed constant is short — 0.55,
 * 7, 0.03. A value derived from another (0.425 * √2) carries the full f64
 * mantissa, and that is the signature this lint keys on. Ten significant
 * digits is well above anything an author types and well below the 16 a
 * derived double shows.
 */
function isDistinctive(value: number): boolean {
  const digits = String(value).replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/e.*$/, "");
  return digits.length >= 10;
}

/** A finite numeric tuple — what a vec3 or vec4 declaration holds. */
function isNumberTuple(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** The scalars and the numeric tuples one param value holds. */
interface BodyNumbers {
  readonly scalars: number[];
  readonly tuples: (readonly number[])[];
}

/**
 * Every number in one param value, whether it holds a Field or a literal.
 *
 * The non-field half is the other spelling this scan used to miss: a body
 * node with `spacing: 0.6010407640085654` freezes the declared value just
 * as thoroughly as an expression does, and it is the cheaper thing for an
 * author to write. `items` and other opaque param values contribute
 * nothing, which is why the plain walk admits only numbers and arrays of
 * them rather than recursing into whatever an object turns out to be.
 */
function paramNumbers(value: unknown): BodyNumbers {
  const into: BodyNumbers = { scalars: [], tuples: [] };
  if (isField(value)) {
    // The non-throwing reader: a field built by `makeField` carries no spec
    // and is not an error here, it is simply a value with no insides to
    // read.
    const spec = peekFieldSpec(value);
    if (spec !== undefined) collectSpecNumbers(spec, into, 0);
    return into;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) into.scalars.push(value);
  } else if (isNumberTuple(value)) {
    into.tuples.push(value);
    into.scalars.push(...value);
  }
  return into;
}

/**
 * Every number anywhere inside a field spec.
 *
 * A generic walk over the JSON rather than `specChildren`, which
 * answers "the child POSITIONS the grammar recurses into" and deliberately
 * stops at an options bag's own keys. That is the right answer for a
 * compiler and the wrong one here: a frozen value in `opts.frequency` is
 * the same defect as one in `args[0]`, and this walk is looking for a
 * number rather than for a subexpression. A spec is JSON by construction
 * ({@link peekFieldSpec} hands back what the grammar parsed), so there is
 * nothing but objects, arrays and leaves to meet.
 */
function collectSpecNumbers(node: unknown, into: BodyNumbers, depth: number): void {
  // The grammar refuses to parse deeper than MAX_SPEC_DEPTH, so a spec
  // cannot exceed it; the cap is here so a hand-built one cannot spin.
  if (depth > MAX_SPEC_DEPTH) return;
  if (typeof node === "number") {
    if (Number.isFinite(node)) into.scalars.push(node);
    return;
  }
  if (Array.isArray(node)) {
    if (isNumberTuple(node)) into.tuples.push(node);
    for (const child of node) collectSpecNumbers(child, into, depth + 1);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const child of Object.values(node)) collectSpecNumbers(child, into, depth + 1);
  }
}
