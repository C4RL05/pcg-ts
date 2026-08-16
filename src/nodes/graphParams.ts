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
import { peekFieldSpec } from "../fields/spec.js";
import {
  type Graph,
  type NodeHandle,
  type ParamSchema,
  type ParamValue,
  describeSubgraphParams,
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
  /** `"<node>.<param>"` of every slot whose expression reads this name. */
  readonly readers: readonly string[];
}

/**
 * One addressable param of a graph; see {@link describeGraphParams}.
 *
 * A UNION rather than one shape with optional fields, because a
 * graph-scoped param has no node and a consumer reading `.node` as
 * `undefined` would print a wrong address. Narrowing on `scope` makes each
 * consumer decide what it shows for a knob belonging to no node.
 */
export type DescribedGraphParam = DescribedNodeParam | DescribedGraphScopedParam;

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
 */
export function describeGraphParams(graph: Graph): DescribedGraphParam[] {
  const out: DescribedGraphParam[] = [];
  const declared = graph.graphParams;
  if (declared.length > 0) {
    // One walk answers "who reads this name", for every name at once. A
    // declared-but-unread param reports an empty `readers`, which is the
    // only way an author sees that a rename left a value stranded.
    const readers = new Map<string, string[]>();
    for (const ref of paramScan(graph).refs) {
      for (const name of ref.names) {
        let list = readers.get(name);
        if (list === undefined) readers.set(name, (list = []));
        list.push(`${ref.node}.${ref.param}`);
      }
    }
    for (const param of declared) {
      const schema = inlineParamSchema(
        param.name,
        param.value,
        param,
        `declared in the graph's "params" block`,
      );
      if (schema === undefined) continue;
      out.push({
        key: `$${param.name}`,
        scope: "graph",
        name: param.name,
        readers: readers.get(param.name) ?? [],
        schema,
        value: typeof param.value === "number" ? param.value : [...param.value],
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
      out.push({
        key: `${node}.${name}`,
        scope: "node",
        node,
        type,
        param: name,
        schema,
        ...(holdsField ? {} : { value: value as ParamValue }),
        holdsField,
        exposed,
      });
      out.push(...fieldParamsOf(node, type, name, value));
    }
  }
  return out;
}
