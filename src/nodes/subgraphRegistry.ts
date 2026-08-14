/**
 * Named subgraphs: a registry of reusable primitives that serialized
 * graphs reference BY NAME (`"ref": { "name": ... }`) instead of embedding
 * a copy of the inner graph.
 *
 * **The registry stores a RECIPE, never a live graph and never a prebuilt
 * def.** `subgraphNode` MUTATES what it wraps — it adds a `__in_<name>`
 * portal node per exposed input and declares an `__out_<name>` output per
 * exposed output — so a live `Graph` can be wrapped exactly once, and the
 * second reference to a stored graph would fail with `node id "__in_..."
 * already exists`. A stored def would be worse than illegal, it would be
 * quietly wrong: two references would share one inner graph, one set of
 * per-node caches, and any edit made through either.
 *
 * So every reference MATERIALIZES afresh, through the same
 * `deserializeGraph` → `subgraphNode` path an embedded payload takes. That
 * shared path is what makes the by-name and embedded forms cook
 * byte-identically; there is deliberately no second construction route.
 *
 * The mechanism lives in core because `deserializeGraph` must resolve
 * names. The ASSETS do not: a corpus of primitives that register on import
 * is unshakeable weight in every bundle, so shipped primitives belong
 * behind their own subpath export (`pcg-ts/primitives`), leaving
 * `import "pcg-ts"` costing nothing.
 */
import { Graph, type GraphMeta, type NodeHandle } from "../graph/index.js";
import { ITERATED_PIN_NAMES } from "../graph/subgraph.js";
import { hashCombine, hashString } from "../random/index.js";
import {
  deserializeGraph,
  serializeGraph,
  type SerializedExposedParam,
  type SerializedExposedPin,
  type SerializedGraph,
  type SerializedSubgraph,
} from "./serialize.js";

/** What {@link registerSubgraph} accepts: a graph plus its exposed interface. */
export interface SubgraphRegistrationSpec {
  /**
   * The inner graph — live (serialized here) or already serialized. A
   * live one is only ever READ: the registry keeps the serialized recipe,
   * so later edits to the object passed in do not reach the registry.
   */
  readonly graph: Graph | SerializedGraph;
  /**
   * Exposed input pins. The inner node may be named by id (`"scatter"`)
   * or given as the handle `graph.add` returned — the same handle
   * `subgraphNode` takes, so a primitive built in code can be registered
   * without restating its declarations in a second shape.
   */
  readonly inputs?: readonly RegistrationPin[];
  /** Exposed output pins; see {@link SubgraphRegistrationSpec.inputs}. */
  readonly outputs?: readonly RegistrationPin[];
  /**
   * Exposed-param declarations, authored part only — `type`, `enum` and
   * `acceptsField` are re-derived from the targets' registered schemas.
   * Targets accept an id or a handle, as the pins do.
   * Default: none.
   */
  readonly params?: readonly RegistrationParam[];
}

/** An inner node named by id, or by the handle `graph.add` returned. */
export type RegistrationNodeRef = string | NodeHandle;

/** {@link SerializedExposedPin} whose `node` may also be a handle. */
export interface RegistrationPin {
  readonly name: string;
  readonly node: RegistrationNodeRef;
  readonly pin: string;
}

/** {@link SerializedExposedParam} whose targets' `node` may also be a handle. */
export interface RegistrationParam {
  readonly name: string;
  /**
   * Omitted or empty for a param the body's field expressions read by
   * name; `default` is then required, and its shape decides the type.
   */
  readonly targets?: readonly { readonly node: RegistrationNodeRef; readonly param: string }[];
  readonly description: string;
  readonly default?: unknown;
  readonly min?: number;
  readonly max?: number;
}

/** Resolve an id-or-handle to the inner node id. */
function nodeIdOf(node: RegistrationNodeRef): string {
  return typeof node === "string" ? node : node.id;
}

/** One registered subgraph: the canonical recipe and its content hash. */
export interface RegisteredSubgraph {
  /** The name graphs reference it by. */
  readonly name: string;
  /**
   * The CANONICAL recipe: `serializeGraph(deserializeGraph(authored))`, so
   * two spellings of one primitive (sparse params vs. filled defaults)
   * become one payload and compare byte for byte against an embedded one.
   * Deeply frozen.
   */
  readonly subgraph: SerializedSubgraph;
  /** Content hash of the canonical recipe; see {@link subgraphContentHash}. */
  readonly hash: string;
  /**
   * The recipe graph's own `meta` block, lifted for catalogs. It is not a
   * second metadata channel — the same object is inside `subgraph.graph`.
   */
  readonly meta?: GraphMeta;
}

/** @internal Stored form: the public record plus its canonical key string. */
interface StoredSubgraph {
  readonly entry: RegisteredSubgraph;
  /** Stable stringification of the canonical recipe; see `_registeredSubgraphKey`. */
  readonly key: string;
}

// Global module state, mirroring the node-type registry (registry.ts).
// Precedent, not inertia: names are resolved inside `deserializeGraph`,
// which takes no context argument and cannot grow one without breaking
// every caller. The costs are stated in docs/authoring.md: every primitive
// must be registered before a graph referencing it is deserialized, and
// re-registering is not a live-update mechanism (resolution happens once,
// at load; a loaded graph owns its materialized inner graph).
const registry = new Map<string, StoredSubgraph>();

const PROBE_ID = "recipe";
const PROBE_PREFIX = new RegExp(`^node "${PROBE_ID}"(?: inner graph)?: `);

function fail(name: string, message: string): never {
  throw new Error(`registerSubgraph "${name}": ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * JSON with object keys sorted. Serialized param key order is the node
 * type's SCHEMA DECLARATION order, so reordering a schema would otherwise
 * move every primitive's hash without changing what anything cooks.
 * Array order is preserved throughout — it is semantic everywhere it
 * occurs (pin order, exposed-param write order, node order).
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/**
 * One salted 32-bit fold of a string, using the library's own murmur3
 * combiner: pure integer math, identical across runs and platforms, the
 * same guarantee every other hash here carries. Two UTF-16 code units per
 * mix round; the length is folded in first, so a trailing odd code unit
 * cannot collide with a trailing NUL.
 */
function fold(s: string, salt: number): number {
  let h = hashCombine(salt, s.length);
  for (let i = 0; i < s.length; i += 2) {
    h = hashCombine(h, (s.charCodeAt(i) << 16) | (i + 1 < s.length ? s.charCodeAt(i + 1) : 0));
  }
  return h;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * The reduced view of an exposed-param declaration the hash covers.
 *
 * A param with no targets reduces to `targets: []`, which is as stable as
 * any other list — and it must be covered, not skipped: a targetless param
 * is read by the body's field expressions, so adding, removing or renaming
 * one changes what the recipe cooks exactly as a target list does.
 */
function hashableExposedParam(p: SerializedExposedParam): unknown {
  return {
    name: p.name,
    targets: p.targets.map((t) => ({ node: t.node, param: t.param })),
    // `default`, `min` and `max` change what a BOUND value in a saved
    // graph means, so they are identity. `description` does not, and is
    // excluded for the same reason `meta` is.
    default: p.default,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
  };
}

/** The reduced view of a serialized graph the hash covers. */
function hashableGraph(g: SerializedGraph): unknown {
  return {
    formatVersion: g.formatVersion,
    // `seed` is absent: a subgraph payload's seed is inert at cook time
    // (every cook derives the inner seed from the outer node seed and
    // overwrites it), so it cannot change a single cooked byte.
    // `meta` is absent: `Graph.setMeta` deliberately does not bump
    // `version`, because retitling a graph must not invalidate a cache.
    // Hashing meta would re-introduce exactly that invalidation sideways —
    // every saved graph pinned to a primitive would break on a typo fix
    // in its description.
    nodes: g.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      params: n.params,
      ...(n.subgraph !== undefined ? { subgraph: hashableSubgraph(n.subgraph) } : {}),
      // A nested reference contributes its NAME (and its pin, when it
      // has one), not the content behind it. That is the same opt-in
      // contract one level down: an unpinned nested ref means "whatever
      // the registry currently holds", so improving it does not move the
      // outer primitive's hash.
      ...(n.ref !== undefined
        ? {
            ref: {
              name: n.ref.name,
              ...(n.ref.hash !== undefined ? { hash: n.ref.hash } : {}),
            },
          }
        : {}),
    })),
    connections: g.connections.map((c) => ({ from: [c.from[0], c.from[1]], to: [c.to[0], c.to[1]] })),
    outputs: g.outputs.map((o) => ({ id: o.id, pin: o.pin, name: o.name })),
  };
}

/** The reduced view of a subgraph payload the hash covers. */
function hashableSubgraph(s: SerializedSubgraph): unknown {
  return {
    graph: hashableGraph(s.graph),
    inputs: s.inputs.map((p) => ({ name: p.name, node: p.node, pin: p.pin })),
    outputs: s.outputs.map((p) => ({ name: p.name, node: p.node, pin: p.pin })),
    ...(s.params !== undefined ? { params: s.params.map(hashableExposedParam) } : {}),
  };
}

/**
 * Content hash of a canonical subgraph payload: 16 lowercase hex digits
 * (64 bits, two independently salted folds). This is the value a
 * serialized reference may pin itself to, so what it covers IS the
 * contract:
 *
 * **Covered** — every node id, type and param value; connections;
 * declared outputs; the exposed pin mappings; and each exposed param's
 * name, targets, default and bounds. In short, everything that changes
 * what the primitive cooks or what a bound param on it means.
 *
 * **Excluded, at every nesting level** — `meta` blocks, graph `seed`s, and
 * exposed-param `description` strings. None of them can change a cooked
 * byte, and hashing them would make a typo fix in a description break
 * every graph pinned to the primitive.
 *
 * A nested `ref` contributes the referenced NAME (plus its own pin hash if
 * it carries one), not the content it resolves to.
 *
 * Object keys are sorted before hashing, so reordering a node type's param
 * schema cannot move a primitive's hash. Array order is preserved, because
 * it is semantic everywhere it occurs.
 *
 * The value is stable within one build. It is NOT stable across library
 * versions, and cannot be made so: canonicalization fills each node's
 * params from the registry's current schemas, so adding a param to any
 * node type a primitive uses moves its hash. That is the boundary a pin
 * exists to state — see {@link registerSubgraph}.
 */
export function subgraphContentHash(subgraph: SerializedSubgraph): string {
  const canonical = stableStringify(hashableSubgraph(subgraph));
  return hex8(fold(canonical, hashString("pcg-ts/subgraph-hash/lo"))) +
    hex8(fold(canonical, hashString("pcg-ts/subgraph-hash/hi")));
}

/** Every name a raw (not yet validated) recipe references, at any depth. */
function collectRefNames(subgraph: unknown, out: Set<string>): void {
  if (!isPlainObject(subgraph)) return;
  const graph = subgraph.graph;
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return;
  for (const node of graph.nodes as unknown[]) {
    if (!isPlainObject(node)) continue;
    const ref = node.ref;
    if (isPlainObject(ref) && typeof ref.name === "string") out.add(ref.name);
    if (node.subgraph !== undefined) collectRefNames(node.subgraph, out);
  }
}

function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  for (const key of Object.keys(v as object)) {
    deepFreeze((v as unknown as Record<string, unknown>)[key]);
  }
  return Object.freeze(v);
}

/**
 * Canonicalize a recipe by MATERIALIZING it and serializing the result —
 * the same `deserializeGraph` → `subgraphNode` path a reference and an
 * embedded payload both take, so the three forms cannot drift.
 *
 * This is not cosmetic. An authored recipe may leave params out;
 * `Graph.add` merges the def's defaults and `serializeGraph` writes every
 * schema key, so two spellings of one primitive would otherwise hash
 * differently and would not compare byte for byte against an embedded
 * payload. It also means every structural rule the loader enforces
 * (unknown node types, bad params, exposed pins naming missing inner
 * nodes, `__in_`/`__out_` collisions) fails HERE, with the author's stack,
 * instead of at some consumer's `deserializeGraph`.
 */
function canonicalize(name: string, raw: SerializedSubgraph): SerializedSubgraph {
  // The probe's own type is scaffolding — `canonicalize` returns the
  // PAYLOAD, so this never reaches the recipe or its content hash. It has
  // to be right anyway: a recipe is wrapper-agnostic, but the wrapper it
  // will be used with is the one whose rules it must satisfy, and a body
  // exposing the reserved iterated-pin name is written to be looped over.
  // Probing it as a "subgraph" would refuse it at registration (the loader
  // rejects that combination as the one way to reach a silent one-pass
  // cook), making a forEach body unregisterable.
  const wrapper = raw.inputs.some((p) => ITERATED_PIN_NAMES.has(p.name)) ? "forEach" : "subgraph";
  const probe: SerializedGraph = {
    formatVersion: 1,
    seed: 0,
    nodes: [{ id: PROBE_ID, type: wrapper, params: {}, subgraph: raw }],
    connections: [],
    outputs: [],
  };
  let graph: Graph;
  try {
    graph = deserializeGraph(probe);
  } catch (err) {
    // The probe node is scaffolding; strip its breadcrumb so the message
    // names the offending inner node and nothing else.
    fail(name, (err instanceof Error ? err.message : String(err)).replace(PROBE_PREFIX, ""));
  }
  const node = serializeGraph(graph).nodes[0];
  // Unreachable: the probe node IS a subgraph node, so serializeGraph
  // always emits a payload for it. Narrowing, not a real failure mode.
  if (node.subgraph === undefined) {
    fail(name, "internal: canonicalization produced no subgraph payload");
  }
  return node.subgraph;
}

/**
 * Register a subgraph under a name, so serialized graphs can reference it
 * with `"ref": { "name": ... }` instead of embedding a copy.
 *
 * The recipe is canonicalized and validated NOW (see {@link
 * RegisteredSubgraph.subgraph}), and its content hash computed once. A
 * duplicate name throws, mirroring `standardNode`: there is deliberately
 * no public unregister and no re-registration, because resolution happens
 * once at load — a graph already loaded holds its own materialized inner
 * graph and could not be updated by mutating the registry anyway.
 *
 * **On pinning.** A reference may carry the `hash` this returns, and then
 * a mismatch is a hard error. Leaving it out is the default and means
 * "whatever the library currently holds", so a primitive can be improved
 * under saved graphs with no friction. Neither mode warns; neither cooks a
 * near-miss.
 *
 * @returns the stored record (deeply frozen).
 */
export function registerSubgraph(name: string, spec: SubgraphRegistrationSpec): RegisteredSubgraph {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error(
      `registerSubgraph: name must be a non-empty string, got ${JSON.stringify(name)}`,
    );
  }
  if (registry.has(name)) {
    fail(name, "a subgraph with this name is already registered");
  }
  // Handles are normalized to ids up front, so everything downstream —
  // canonicalization, hashing, the recipe itself — sees exactly one shape.
  const pins = (list: readonly RegistrationPin[] | undefined): SerializedExposedPin[] =>
    (list ?? []).map((p) => ({ name: p.name, node: nodeIdOf(p.node), pin: p.pin }));
  const params: SerializedExposedParam[] = (spec.params ?? []).map((p) => ({
    name: p.name,
    targets: (p.targets ?? []).map((t) => ({ node: nodeIdOf(t.node), param: t.param })),
    description: p.description,
    default: p.default,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
  }));
  const raw: SerializedSubgraph = {
    graph: spec.graph instanceof Graph ? serializeGraph(spec.graph) : spec.graph,
    inputs: pins(spec.inputs),
    outputs: pins(spec.outputs),
    ...(params.length > 0 ? { params } : {}),
  };
  // Acyclicity, the good error. A mutual cycle ("a" refs "b" refs "a") is
  // already unconstructible — canonicalization materializes every nested
  // ref, so "b" must be registered before "a" and vice versa — which
  // leaves self-reference as the one case that reaches this far, and it
  // would otherwise be reported as the unhelpful "unknown subgraph". The
  // guard that catches a cycle however it arrived is in `deserializeGraph`.
  const referenced = new Set<string>();
  collectRefNames(raw, referenced);
  if (referenced.has(name)) {
    fail(
      name,
      `its recipe references "${name}", the subgraph being registered — named subgraph references must be acyclic, since resolving one would resolve itself forever`,
    );
  }
  const canonical = canonicalize(name, raw);
  const entry: RegisteredSubgraph = deepFreeze({
    name,
    subgraph: canonical,
    hash: subgraphContentHash(canonical),
    ...(canonical.graph.meta !== undefined ? { meta: canonical.graph.meta } : {}),
  });
  registry.set(name, { entry, key: stableStringify(canonical) });
  return entry;
}

/** Whether a subgraph name is registered. */
export function hasRegisteredSubgraph(name: string): boolean {
  return registry.has(name);
}

/**
 * Look up a registered subgraph by name. Throws listing every registered
 * name (sorted), or explaining that none are, when the name is unknown.
 */
export function getRegisteredSubgraph(name: string): RegisteredSubgraph {
  const stored = registry.get(name);
  if (stored === undefined) throw new Error(unknownSubgraphMessage(name));
  return stored.entry;
}

/**
 * @internal The message `deserializeGraph` and {@link getRegisteredSubgraph}
 * both use for an unknown name, so the two cannot drift.
 */
export function unknownSubgraphMessage(name: string): string {
  const names = [...registry.keys()].sort();
  return names.length === 0
    ? `unknown subgraph ${JSON.stringify(name)} — no subgraphs are registered; call registerSubgraph(name, spec) before loading a graph that references one`
    : `unknown subgraph ${JSON.stringify(name)}; registered subgraphs: ${names.join(", ")}`;
}

/**
 * Every registered subgraph, in registration order (mirroring
 * `listNodeTypes`). The records are the frozen stored ones — this is the
 * source of truth a catalog generator reads, so that a catalog cannot be
 * generated from assets that failed to register.
 */
export function listSubgraphs(): RegisteredSubgraph[] {
  return [...registry.values()].map((s) => s.entry);
}

/**
 * @internal The canonical key string of a registered recipe, or
 * `undefined` when the name is unknown. `serializeGraph` compares a
 * reference's live payload against it, so an edit made through
 * `getSubgraphSpec(def).graph` cannot be silently dropped by writing the
 * reference back out.
 */
export function _registeredSubgraphKey(name: string): string | undefined {
  return registry.get(name)?.key;
}

/** @internal The same stringification `_registeredSubgraphKey` returns. */
export function _subgraphKey(subgraph: SerializedSubgraph): string {
  return stableStringify(subgraph);
}

/**
 * @internal Test door: empty the registry. Primitives are DATA, so a suite
 * needs throwaway ones; node types get away without an equivalent because
 * they are code registered once per process. Not exported from the
 * package — a public unregister would suggest the registry is a live
 * update channel, which it deliberately is not.
 */
export function __resetSubgraphRegistry(): void {
  registry.clear();
}

/**
 * @internal Test door: store a recipe WITHOUT canonicalizing it and
 * WITHOUT the acyclicity check. It exists to build the one shape the
 * public API cannot — a mutual name cycle, which `registerSubgraph`
 * refuses by construction because each half would have to be registered
 * first — so that `deserializeGraph`'s own cycle guard is exercised rather
 * than merely asserted. Not exported from the package.
 */
export function __defineSubgraphUnchecked(name: string, subgraph: SerializedSubgraph): void {
  registry.set(name, {
    entry: { name, subgraph, hash: subgraphContentHash(subgraph) },
    key: stableStringify(subgraph),
  });
}
