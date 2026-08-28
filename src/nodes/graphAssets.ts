/**
 * What asset ids can this graph spawn, without cooking it?
 *
 * `spawnInstances.assetId` is a free string whose meaning belongs to the
 * renderer — the library never validates one, because it cannot: an id is
 * a promise to a host that the library has never met. What it CAN do is
 * say which promises a graph makes, which is the half that was missing.
 * A graph written by someone who could not read this repository invented
 * two asset ids that cooked perfectly and rendered as placeholder shapes,
 * and nothing in the toolchain could have told them so.
 *
 * `pcg cook --json` already reports the ids a cook ACTUALLY produced. This
 * is the other question, and the answers differ: a cook reports what one
 * seed happened to reach on the outputs that were declared, so an id
 * behind an unlucky branch is simply absent, and an id inside a subgraph
 * body is reported without saying which node asked for it. This reads the
 * graph instead, so the answer covers every branch and carries provenance.
 *
 * WHAT IT REFUSES TO GUESS is the point of {@link DescribedSpawner.open}.
 * Per-point ids come from a string attribute, and only an authored table
 * (`setAttribute` with `type: "string"`) is statically knowable. An
 * attribute that arrives by promotion, transfer, a copy from a template,
 * or a partition carries values from somewhere this walk cannot see, and
 * a report that quietly omitted those would read as "these are the ids"
 * when it meant "these are the ids I could find". So an open set says so,
 * and names the node that made it open.
 */
import { getSubgraphSpec } from "../graph/index.js";
// By module: `getSubgraphPlumbing` is @internal — it hands back the
// injected portal ids serialization hides — so the barrel no longer
// republishes it.
import { getSubgraphPlumbing } from "../graph/subgraph.js";
import type { ExposedParam, Graph } from "../graph/index.js";
// By module, like `graphParams`' import of `paramScan`: the node record is
// the graph layer's own shape and the barrel does not name it, but this walk
// reads live params off it exactly as `strandedGraphParamValues` does.
import type { NodeState } from "../graph/graph.js";

/**
 * Where one asset id in a spawner's set came from.
 *
 * A union rather than one shape with an optional author, because the
 * invariant is that an attribute origin ALWAYS names its writer: there is
 * no such thing as a table entry nobody wrote.
 */
export type AssetIdOrigin =
  | {
      /** The id as the renderer will receive it. */
      readonly id: string;
      /**
       * The node's own literal, which every point resolves to when no
       * `assetAttr` is set and which an EMPTY string-table entry falls
       * back to.
       */
      readonly from: "assetId";
    }
  | {
      readonly id: string;
      /** One entry of an authored string table. */
      readonly from: "attribute";
      /** Node that authored the entry. Never absent on this branch. */
      readonly writtenBy: string;
    };

/** One reason a spawner's id set could not be closed. */
export interface OpenAssetSet {
  /** The node that made it open — a node id, or a `"wrapper > inner"` path. */
  readonly node: string;
  /** Its node type, so a reader can look it up with `pcg nodes <type>`. */
  readonly type: string;
  /**
   * Why, and what to do instead. Prose, in the voice the rest of the
   * agent-facing API uses — this is written to be printed verbatim.
   */
  readonly reason: string;
}

/** One `spawnInstances` node, and the ids it can emit. */
export interface DescribedSpawner {
  /**
   * The node's id, or a `"wrapper > inner"` path when it sits inside a
   * subgraph body — the same spelling `strandedGraphParamValues` uses,
   * so one convention covers both reports.
   */
  readonly node: string;
  /** The node's `assetId` param: the default every unmatched point takes. */
  readonly assetId: string;
  /** The `assetAttr` param, absent when the node spawns one batch. */
  readonly assetAttr?: string;
  /** Every id this node can emit, deduplicated, in first-occurrence order. */
  readonly ids: readonly AssetIdOrigin[];
  /**
   * Every reason this spawner's `ids` is a LOWER BOUND rather than the
   * whole set. Empty means the set is closed — that is the only
   * completeness flag, deliberately, so there is one source of truth
   * rather than a boolean that can disagree with its own explanation.
   */
  readonly open: readonly OpenAssetSet[];
}

/**
 * Every `spawnInstances` in the graph and its bodies, in node order.
 *
 * Matches {@link describeGraphParams}' shape deliberately: a walk that
 * returns machine-readable descriptions rather than printing, so the CLI
 * and any agent read the same answer.
 */
export function describeGraphAssets(graph: Graph): DescribedSpawner[] {
  const out: DescribedSpawner[] = [];
  walkGraph(frameOf(graph, undefined, NO_OVERRIDES), out, new Set());
  return out;
}

// ---------------------------------------------------------------------------
// Reading params the way a cook reads them.
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>;

/**
 * Inner `(node, param)` values a wrapper's exposed params write on entry to
 * a body, keyed node id → param name.
 *
 * The runtime is the authority here, not the declaration: `withExposedParams`
 * writes `params[exp.name]` into every target with `_setParamQuiet` before the
 * inner cook, so the WRAPPER's value is what an inner param holds while the
 * body cooks — a body literal only stands where the wrapper supplies nothing.
 * A wrapper instance always carries every exposed param (its `defaultParams`
 * come from the resolved schema, whose default is the first target's live
 * value at wrap time), so the two agree on every graph the supported doors
 * can build; `undefined` is treated as "supplies nothing" so a hand-built
 * wrapper reports the body's own literal rather than a blank.
 */
type Overrides = ReadonlyMap<string, ReadonlyMap<string, unknown>>;

const NO_OVERRIDES: Overrides = new Map();

/** One node's params, with any exposed-param writes applied. */
function paramsOf(state: NodeState, overrides: Overrides): Params {
  const slot = overrides.get(state.id);
  if (slot === undefined || slot.size === 0) return state.params;
  const merged: Params = { ...state.params };
  for (const [name, value] of slot) merged[name] = value;
  return merged;
}

/**
 * A string param, or the registry default when the slot holds something
 * else. The defaults are restated here rather than looked up because this
 * walk must also describe a hand-rolled def that never registered one.
 */
function stringParam(params: Params, name: string, fallback: string): string {
  const value = params[name];
  return typeof value === "string" ? value : fallback;
}

/**
 * A `stringList` param: the entries, or `undefined` when the slot holds
 * something this walk cannot read as a list of strings (which is an open
 * set rather than a throw — see {@link describeGraphAssets}).
 */
function stringListParam(params: Params, name: string): readonly string[] | undefined {
  const value = params[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? (value as readonly string[]) : undefined;
}

// ---------------------------------------------------------------------------
// One graph under walk: the outer graph, or one wrapper's body.
// ---------------------------------------------------------------------------

interface Frame {
  readonly graph: Graph;
  /** Path prefix for this graph's node ids: `""` outside any body. */
  readonly path: string;
  /**
   * The node whose body this graph is, absent for the graph under
   * description. Its path is `path`; a portal reason names it rather than
   * the injected portal node, which is plumbing nobody authored.
   */
  readonly wrapper?: { readonly node: string; readonly type: string };
  readonly overrides: Overrides;
  /** Upstream node ids per node id, in connection order. */
  readonly incoming: ReadonlyMap<string, readonly string[]>;
  /** Injected pass-through sources: geometry entering this body from outside. */
  readonly portals: ReadonlySet<string>;
}

const NO_PORTALS: ReadonlySet<string> = new Set();

/**
 * The reverse index this walk needs, from the structural snapshot rather
 * than from the executor's own `_inTo`: `describe()` is the documented door
 * onto a graph's shape, and one pass over it is nothing beside the cook this
 * function exists to avoid.
 */
function frameOf(graph: Graph, wrapper: Frame["wrapper"], overrides: Overrides): Frame {
  const incoming = new Map<string, string[]>();
  for (const connection of graph.describe().connections) {
    const to = connection.to[0];
    let list = incoming.get(to);
    if (list === undefined) incoming.set(to, (list = []));
    list.push(connection.from[0]);
  }
  return {
    graph,
    path: wrapper?.node ?? "",
    wrapper,
    overrides,
    incoming,
    portals: getSubgraphPlumbing(graph)?.portalIds ?? NO_PORTALS,
  };
}

/** `"id"` outside a body, `"wrapper > inner"` inside one. */
function pathOf(frame: Frame, id: string): string {
  return frame.path === "" ? id : `${frame.path} > ${id}`;
}

/**
 * Every spawner in one graph and its bodies, depth first in node order.
 *
 * `onPath` guards the recursion on the body GRAPH and is scoped to the
 * current path — added on the way down, removed on the way back up — rather
 * than to the whole walk. A def is a value and two wrappers may share one:
 * `strandedGraphParamValues` reports a shared body once on purpose, but here
 * two instances are two spawners with two sets of exposed values, and the
 * corpus has exactly that (`pipeline-4-detail` wraps `write/instances-by-
 * species` twice, once for buildings and once for trees).
 */
function walkGraph(frame: Frame, out: DescribedSpawner[], onPath: Set<Graph>): void {
  onPath.add(frame.graph);
  for (const state of frame.graph._nodes.values()) {
    const path = pathOf(frame, state.id);
    if (state.def.type === SPAWN_TYPE) out.push(describeSpawner(frame, state, path));
    const spec = getSubgraphSpec(state.def);
    if (spec === undefined || onPath.has(spec.graph)) continue;
    walkGraph(
      frameOf(
        spec.graph,
        { node: path, type: state.def.type },
        bodyOverrides(frame, state, spec.params),
      ),
      out,
      onPath,
    );
  }
  onPath.delete(frame.graph);
}

/** What one wrapper instance writes into its body's params at cook time. */
function bodyOverrides(frame: Frame, state: NodeState, exposed: readonly ExposedParam[]): Overrides {
  if (exposed.length === 0) return NO_OVERRIDES;
  const wrapper = paramsOf(state, frame.overrides);
  const out = new Map<string, Map<string, unknown>>();
  for (const param of exposed) {
    const value = wrapper[param.name];
    if (value === undefined) continue;
    for (const target of param.targets) {
      let slot = out.get(target.node.id);
      if (slot === undefined) out.set(target.node.id, (slot = new Map()));
      slot.set(target.param, value);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One spawner.
// ---------------------------------------------------------------------------

const SPAWN_TYPE = "spawnInstances";
/** Registry defaults, for a param a hand-rolled def may not carry. */
const DEFAULT_ASSET_ID = "asset";
const DEFAULT_ATTR_NAME = "value";
const DEFAULT_ATTR_TYPE = "f32";
const DEFAULT_DOMAIN = "point";

function describeSpawner(frame: Frame, state: NodeState, path: string): DescribedSpawner {
  const params = paramsOf(state, frame.overrides);
  const assetId = stringParam(params, "assetId", DEFAULT_ASSET_ID);
  const assetAttr = stringParam(params, "assetAttr", "");
  if (assetAttr === "") {
    // Constant mode: every point resolves to the node's own literal, and
    // there is nothing upstream that could add to that.
    return { node: path, assetId, ids: [{ id: assetId, from: "assetId" }], open: [] };
  }
  const scan = new Scan(assetAttr, assetId);
  scan.upstreamOf(frame, state.id);
  scan.settle(path);
  return { node: path, assetId, assetAttr, ids: scan.ids, open: scan.open };
}

/**
 * The upstream sweep for one spawner's `assetAttr`.
 *
 * It collects rather than decides: an id found behind an opaque node is
 * still an id the spawner can emit, so the sweep keeps walking past one and
 * the ids stand as a LOWER BOUND with a non-empty `open` beside them. The
 * alternative — stopping at the first thing it cannot read — reports an
 * empty set for a graph whose ids are half visible, which is the shape of
 * answer this whole module exists to avoid.
 *
 * One entry per OFFENDING NODE: two nodes that each make the set open are
 * two reasons a reader can act on separately, which is the whole reason
 * `open` is a list and not a sentence.
 */
class Scan {
  readonly ids: AssetIdOrigin[] = [];
  readonly open: OpenAssetSet[] = [];
  private readonly seenIds = new Set<string>();
  private wrote = false;
  /** The spawner's `assetAttr`, and the default an unread value falls to. */
  private readonly attr: string;
  private readonly assetId: string;

  // Fields and assignments rather than parameter properties: this module is
  // reachable from the package barrel, and node's type stripping refuses
  // that syntax (see `renderSvg across processes` in src/cli/render.test.ts).
  constructor(attr: string, assetId: string) {
    this.attr = attr;
    this.assetId = assetId;
  }

  /** Dedup by id string, first occurrence keeps its provenance. */
  private add(origin: AssetIdOrigin): void {
    if (this.seenIds.has(origin.id)) return;
    this.seenIds.add(origin.id);
    this.ids.push(origin);
  }

  /**
   * Walk every node feeding `id`, depth first in connection order.
   *
   * EVERY input pin, not a guessed geometry one: nothing in a def says which
   * pin carries the points through, and the pins that are not the obvious one
   * are exactly where a value comes from — a `transferAttribute` reads its
   * ids off "source", a merge takes both sides. Over-collecting is the safe
   * error for a report whose question is "what CAN this node emit", and the
   * dedup bounds it; a spawner's own `in` pin holds one connection either way.
   */
  upstreamOf(frame: Frame, id: string, seen = new Set<string>([id])): void {
    for (const up of frame.incoming.get(id) ?? []) {
      if (seen.has(up)) continue;
      seen.add(up);
      if (this.visit(frame, up)) this.upstreamOf(frame, up, seen);
    }
  }

  /** Read one node; `true` to keep walking above it. */
  private visit(frame: Frame, id: string): boolean {
    const state = frame.graph._nodes.get(id);
    if (state === undefined) return false;
    const path = pathOf(frame, id);
    if (frame.portals.has(id)) {
      // The body's geometry arrives through the wrapper's input pin, so the
      // attribute may be written anywhere outside it. The WRAPPER is what a
      // reader can act on, so that is the node named — the portal is
      // plumbing the subgraph injected, not a node anyone wrote.
      this.open.push({
        node: frame.wrapper?.node ?? path,
        type: frame.wrapper?.type ?? state.def.type,
        reason:
          `the geometry reaching this spawner enters the body "${frame.path}" through its input pin "${id}", ` +
          `so "${this.attr}" may be written outside the body, where this walk does not follow it; ` +
          `describe the graph that wraps it, or read the ids a cook produced with pcg cook --json`,
      });
      return false;
    }
    const params = paramsOf(state, frame.overrides);
    const type = state.def.type;
    if (type === "setAttribute" && this.isWriter(params)) {
      // setAttribute REPLACES the column, so nothing above it can reach the
      // spawner through this branch: the table here is the whole answer.
      this.readTable(params, path);
      return false;
    }
    const opaque = opaqueReason(type, params, path, this.attr);
    if (opaque !== undefined) this.open.push({ node: path, type, reason: opaque });
    return true;
  }

  /** Does this `setAttribute` write the point column the spawner reads? */
  private isWriter(params: Params): boolean {
    return (
      stringParam(params, "name", DEFAULT_ATTR_NAME) === this.attr &&
      stringParam(params, "domain", DEFAULT_DOMAIN) === DEFAULT_DOMAIN
    );
  }

  /** The ids one `setAttribute` in string mode can put on a point. */
  private readTable(params: Params, path: string): void {
    // A writer was found either way: whatever it puts in the column, nothing
    // is missing an author, so the "nothing writes it" reason stays quiet.
    this.wrote = true;
    if (stringParam(params, "type", DEFAULT_ATTR_TYPE) !== "string") {
      this.open.push({
        node: path,
        type: "setAttribute",
        reason:
          `"${path}" (setAttribute) replaces the point attribute "${this.attr}" with a ` +
          `${stringParam(params, "type", DEFAULT_ATTR_TYPE)} column, which spawnInstances cannot read as an asset id; ` +
          'set that node\'s type to "string", or point assetAttr at the attribute that holds the ids',
      });
      return;
    }
    const values = stringListParam(params, "values");
    if (values === undefined) {
      this.open.push({
        node: path,
        type: "setAttribute",
        reason:
          `"${path}" (setAttribute) writes "${this.attr}" from a "values" param this walk cannot read as a ` +
          "list of strings; give it a plain string list, or read the ids a cook produced with pcg cook --json",
      });
      return;
    }
    // Two modes, one rule: a non-empty `values` is the table every element
    // selects from, and an empty one writes the constant `stringValue`.
    const table = values.length > 0 ? values : [stringParam(params, "stringValue", "")];
    for (const entry of table) {
      // An EMPTY entry never names an asset. The spawner resolves it to its
      // own assetId (src/spawn/grouping.ts), so that is what it contributes
      // — an id of "" is not a thing a renderer is ever asked for.
      if (entry === "") this.add({ id: this.assetId, from: "assetId" });
      else this.add({ id: entry, from: "attribute", writtenBy: path });
    }
  }

  /**
   * The last two things only the finished sweep knows.
   *
   * The one reason with no offending node upstream names the SPAWNER: a set
   * nothing writes is open because of the spawner's own `assetAttr`, and a
   * reader given no node at all could not act on it.
   */
  settle(spawner: string): void {
    if (!this.wrote && this.open.length === 0) {
      this.open.push({
        node: spawner,
        type: SPAWN_TYPE,
        reason:
          `nothing upstream of it writes a string point attribute named "${this.attr}", so this walk found no ` +
          "ids at all and a cook would refuse the spawn; write it with a setAttribute " +
          '(type "string"), or clear assetAttr to spawn one batch of assetId',
      });
    }
    // An open set can always land on the default: a value this walk could
    // not see may be the empty string, which resolves to assetId.
    if (this.open.length > 0) this.add({ id: this.assetId, from: "assetId" });
  }
}

/**
 * Why one upstream node makes the set open, or `undefined` when it is
 * transparent to this walk.
 *
 * Gated on the attribute wherever the node's own params say which one it
 * writes — an unrelated `promoteAttribute` upstream is no reason to give up
 * on a table that is right there. Three entries are ungated, for cause:
 * `copyToPoints` composes its output column from the SOURCE's attributes or
 * from a carried target attribute (`targetNames`), and proving the source
 * carries no column of this name means resolving every attribute on that
 * branch, a different and much larger walk; a `forEach` or `subgraph` body
 * reaches the spawner through pins this walk does not follow across; and a
 * `partitionByAttribute` hands its groups on by TAG, so which of them a
 * spawner receives is settled at cook time. That last one is the conservative
 * member of the set — it writes no column, so it can only ever remove values
 * — and it is here because the module comment above names a partition as a
 * case this report refuses to guess at.
 */
function opaqueReason(
  type: string | undefined,
  params: Params,
  path: string,
  attr: string,
): string | undefined {
  const tail = `; read the ids a cook produced with pcg cook --json, or write "${attr}" with a setAttribute (type "string") below it`;
  switch (type) {
    case "promoteAttribute":
      if (stringParam(params, "name", "density") !== attr) return undefined;
      if (stringParam(params, "to", "primitive") !== DEFAULT_DOMAIN) return undefined;
      return (
        `"${path}" (promoteAttribute) writes the point attribute "${attr}" from the ` +
        `${stringParam(params, "from", DEFAULT_DOMAIN)} domain, whose values this walk does not read${tail}`
      );
    case "transferAttribute":
      if (stringParam(params, "name", "density") !== attr) return undefined;
      return (
        `"${path}" (transferAttribute) writes the point attribute "${attr}" from its "source" geometry, ` +
        `whose values this walk does not read${tail}`
      );
    case "attributeRemap": {
      const written = stringParam(params, "outName", "") || stringParam(params, "name", "density");
      if (written !== attr) return undefined;
      if (stringParam(params, "domain", DEFAULT_DOMAIN) !== DEFAULT_DOMAIN) return undefined;
      return (
        `"${path}" (attributeRemap) writes "${attr}" as an f32 point attribute, which spawnInstances cannot ` +
        `read as an asset id; give the remap an outName of its own, or point assetAttr at the attribute that holds the ids`
      );
    }
    case "partitionByAttribute":
      return (
        `"${path}" (partitionByAttribute) splits its input into one geometry per distinct value and routes ` +
        `them by tag, so which of them reaches this spawner is settled at cook time${tail}`
      );
    case "copyToPoints":
      return (
        `"${path}" (copyToPoints) builds its points from a source template, and "${attr}" reaches the copies ` +
        `either as a column the source already carried or as a target column named in "targetNames" — this ` +
        `walk cannot read a template's attributes, so it cannot say which${tail}`
      );
    case "forEach":
    case "repeatUntil":
    case "subgraph":
      return (
        `"${path}" (${type}) stands between this spawner and any writer, and this walk does not follow ` +
        `geometry out of a wrapper's body${tail}`
      );
    default:
      return undefined;
  }
}
