/**
 * `definePrimitive` — the one door every shipped primitive goes through.
 *
 * It is a thin layer over `registerSubgraph`, and each thing it adds is a
 * rule the catalog would otherwise depend on 29 authors remembering:
 *
 * 1. **The name is checked against the closed family set.** A registry
 *    record carries no category — `GraphMeta` is exactly
 *    `{ title, description, tags }` — so the `<family>/<kebab-case>`
 *    prefix is the only place a family can live, and a name-sorted
 *    `listSubgraphs()` groups by family for free. A typo'd or invented
 *    family would silently produce an ungrouped catalog entry, so it is an
 *    error naming the seven families instead.
 * 2. **The family becomes a tag, derived rather than authored.** Authored
 *    duplication drifts; a derived one cannot.
 * 3. **`acceptsField: true` is ASSERTED where it is meant.** `acceptsField`
 *    is ANDed across an exposed param's targets — correct, since the
 *    exposed schema must never admit a value one target rejects — but
 *    silent: fan a knob across one field-capable param and one plain one
 *    and it registers cleanly having quietly become field-incapable, which
 *    is usually the entire point of the knob. `resolveExposedParam` takes
 *    an opt-in assertion that names the refusing target instead, and this
 *    is where the catalog opts in. The assertion cannot travel inside the
 *    recipe — a serialized exposed param carries the AUTHORED half only,
 *    and `acceptsField` there is a hard error ("derived from the targets'
 *    registered schemas; remove it") — so it is checked HERE, at
 *    registration, which is import time for the shipped catalog.
 *
 * The assertion pass materializes the recipe once through
 * `deserializeGraph` before handing it to `registerSubgraph`, which
 * materializes it again to canonicalize. That is a deliberate second
 * traversal of ~30 small graphs at import: the alternative is an
 * assertion that cannot be made at all.
 */
import {
  type GraphMeta,
  type ParamValue,
  type RegisteredSubgraph,
  type RegistrationPin,
  type SerializedConnection,
  type SerializedGraph,
  type SerializedNode,
  deserializeGraph,
  registerSubgraph,
  resolveExposedParam,
} from "../index.js";

/**
 * The closed family set. A family is a promise about the pin shape, which
 * is what lets an agent chain primitives without reading inner graphs:
 *
 * - `shape` → geometry: a point set describing a region or skeleton, built
 *   at unit size around the origin and placed by a trailing transform.
 * - `fill` → geometry: turns a region into a distribution of points.
 * - `transform` geometry → geometry: changes `P`; the count is preserved.
 * - `compose` geometry x geometry → geometry: combines two point sets.
 * - `filter` geometry → geometry: removes points; `P` is untouched.
 * - `place` geometry (+ host mesh) → geometry: puts points on or against
 *   supplied geometry.
 * - `write` geometry → geometry: creates or sets attributes; the count and
 *   `P` are untouched, and the spawner terminal lives here.
 */
export const PRIMITIVE_FAMILIES = [
  "shape",
  "fill",
  "transform",
  "compose",
  "filter",
  "place",
  "write",
] as const;

/** One of {@link PRIMITIVE_FAMILIES}. */
export type PrimitiveFamily = (typeof PRIMITIVE_FAMILIES)[number];

/** `<family>/<kebab-case>`: lowercase, digits allowed, no leading/trailing dash. */
const LEAF = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * One exposed-param declaration on a primitive: the authored half
 * `registerSubgraph` stores, plus the field-capability assertion, which is
 * checked here and not stored (it is re-derived on every load).
 */
export interface PrimitiveParamDecl {
  /** Param name on the primitive. */
  readonly name: string;
  /** Inner `(node id, param)` slots the one value is written into. */
  readonly targets: readonly { readonly node: string; readonly param: string }[];
  /** What the knob does at the PRIMITIVE's level of abstraction. */
  readonly description: string;
  /** Default; omitted means the first target's authored value. */
  readonly default?: ParamValue;
  /** Inclusive lower bound; may only NARROW the targets' own. */
  readonly min?: number;
  /** Inclusive upper bound; may only NARROW the targets' own. */
  readonly max?: number;
  /**
   * Assert that the resolved param accepts a `Field`. Set it on every knob
   * whose point is that a field can be passed to it; a target that refuses
   * is then a hard error naming that target, instead of a knob that
   * silently stops taking fields.
   */
  readonly acceptsField?: boolean;
}

/** A primitive recipe, authored as the JSON a hand-written graph would carry. */
export interface PrimitiveSpec {
  /** One line, sentence case, no trailing period — the catalog's heading. */
  readonly title: string;
  /**
   * Agent-facing prose. It must state what the primitive is FOR, what it
   * reads and writes, and — for anything stochastic or noise-driven —
   * whether two instances differ by default.
   */
  readonly description: string;
  /** Extra tags; the family is prepended automatically. */
  readonly tags?: readonly string[];
  readonly nodes: readonly SerializedNode[];
  readonly connections: readonly SerializedConnection[];
  readonly inputs?: readonly RegistrationPin[];
  readonly outputs: readonly RegistrationPin[];
  readonly params?: readonly PrimitiveParamDecl[];
}

function fail(name: string, message: string): never {
  throw new Error(`definePrimitive "${name}": ${message}`);
}

/**
 * The family of a primitive name, or a hard error naming the closed set.
 * Exported because the catalog tests group by it and must not re-derive
 * the parse.
 */
export function primitiveFamily(name: string): PrimitiveFamily {
  const slash = name.indexOf("/");
  if (slash < 0) {
    fail(
      name,
      `a primitive name is "<family>/<kebab-case>" and this one has no "/"; families: ${PRIMITIVE_FAMILIES.join(", ")}`,
    );
  }
  const family = name.slice(0, slash);
  const leaf = name.slice(slash + 1);
  if (!(PRIMITIVE_FAMILIES as readonly string[]).includes(family)) {
    fail(
      name,
      `"${family}" is not one of the seven families: ${PRIMITIVE_FAMILIES.join(", ")} — the family prefix is the only place a family can live, since a registry record carries no category`,
    );
  }
  if (!LEAF.test(leaf)) {
    fail(
      name,
      `"${leaf}" is not kebab-case; the part after the "/" is lowercase letters and digits with single dashes between them (fill/scatter-even), never camelCase — node types are camelCase and the two namespaces must not look alike`,
    );
  }
  return family as PrimitiveFamily;
}

/**
 * Register one shipped primitive. Returns the stored record, so a caller
 * can pin against its content hash.
 */
export function definePrimitive(name: string, spec: PrimitiveSpec): RegisteredSubgraph {
  const family = primitiveFamily(name);
  if (spec.title.trim() === "") fail(name, "needs a non-empty title — it is the catalog's heading");
  if (spec.description.trim() === "") {
    fail(
      name,
      "needs a non-empty description — the catalog is the only place an agent learns what this primitive is for",
    );
  }
  if (spec.outputs.length === 0) {
    fail(name, "declares no output pin, so nothing downstream could ever read it");
  }
  const meta: GraphMeta = {
    title: spec.title,
    description: spec.description,
    tags: [family, ...(spec.tags ?? [])],
  };
  const graph: SerializedGraph = {
    formatVersion: 1,
    seed: 0,
    meta,
    nodes: spec.nodes,
    connections: spec.connections,
    outputs: [],
  };
  const params = spec.params ?? [];
  if (params.length > 0) {
    // Materialize once, purely to resolve every declaration against the
    // registry's live schemas. Structural faults surface here too, with
    // the primitive's name on them, one step before canonicalization
    // would have found them.
    const inner = deserializeGraph(graph);
    for (const p of params) {
      try {
        resolveExposedParam(inner, {
          name: p.name,
          targets: p.targets.map((t) => ({ node: { id: t.node }, param: t.param })),
          description: p.description,
          ...(p.default !== undefined ? { default: p.default } : {}),
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(p.acceptsField === true ? { acceptsField: true } : {}),
        });
      } catch (err) {
        fail(name, err instanceof Error ? err.message : String(err));
      }
    }
  }
  return registerSubgraph(name, {
    graph,
    ...(spec.inputs !== undefined ? { inputs: spec.inputs } : {}),
    outputs: spec.outputs,
    // `acceptsField` is dropped: it is an assertion about the targets, not
    // a stored fact. A serialized recipe that carried it would be claiming
    // a schema, which the format refuses on purpose.
    params: params.map((p) => ({
      name: p.name,
      targets: p.targets,
      description: p.description,
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.min !== undefined ? { min: p.min } : {}),
      ...(p.max !== undefined ? { max: p.max } : {}),
    })),
  });
}
