/**
 * The NEIGHBOUR-QUERY REACH a graph asks for: how far outside its own
 * points a graph looks, read off the graph statically, without cooking it.
 *
 * WHY THIS EXISTS. A streamed level cooks each cell from a WIDENED query
 * window — the cell's own rectangle grown by a halo — and clips the result
 * back to the cell. That is exact only while the halo is at least as wide
 * as the furthest any node inside the cell looks. A node asking for
 * neighbours within R, cooked in a cell that was given a halo of H < R,
 * receives a TRUNCATED neighbour set and writes an answer that differs
 * from the same point's answer in an unstreamed cook. Nothing throws, and
 * nothing looks wrong: the output is deterministic and wrong, which is the
 * worst combination a generator can produce, and it shows up at the seams
 * only — where a reader is most likely to read it as a rendering artifact.
 *
 * Until this file the only check was per test, by hand, with the node id
 * and the param name spelled out as string literals: `tests/
 * worldStreaming.test.ts` parses the level's graph JSON back and pulls
 * `("crowding", "radius")` out of it precisely so its halo constant cannot
 * drift from the graph it streams. That check is right, and it is also one
 * graph's worth of it. This is that read, once, for any graph.
 *
 * WHAT IT CAN AND CANNOT SEE — stated up front, because the gap is the
 * whole subject. A reach is a NUMBER here only when a node declares a
 * radius param and that param holds a plain literal: a `pointNeighborhood`
 * with `radius: 4` reaches 4, and that is knowable before any cook. Three
 * things defeat that, and each is REPORTED rather than dropped, because a
 * reach this cannot bound is exactly the case where a caller must not read
 * silence as safety:
 *
 *   - A FIELD radius. A `Field` is a recipe evaluated per point on a
 *     domain that does not exist yet, so it carries no number to compare.
 *     The bound that matters is the GLOBAL MAXIMUM the field can return
 *     anywhere in the world, and both `pointNeighborhood.radius` and
 *     `connectPoints.radius` document why that is derived by the author
 *     rather than measured: the cloud a cell can see has already been
 *     clipped by the very halo being sized, so the far neighbour that
 *     would have set the bound is the one it cannot see. Measuring it
 *     here would be circular, and reporting a smaller number than the
 *     truth would be worse than reporting none.
 *   - The UNLIMITED SENTINELS. `sampleNearestPoint.maxDistance` of 0
 *     means unlimited, not zero — the one place in this table where the
 *     smallest legal number is the widest possible reach — and an
 *     infinite radius anywhere means the whole cloud.
 *   - The DERIVED-REACH nodes. `occlusionCull` and `pathCoverage` declare
 *     no radius param at all; theirs comes out of a ray fan and the
 *     bounding spheres of an upstream input, so it is a function of
 *     GEOMETRY rather than of params and no static read reaches it. So
 *     does `transferAttribute`, whose DEFAULT mapping caps nothing at
 *     all — see TRANSFER_MAPPING for why a node filed under "attributes",
 *     importing nothing from `src/spatial`, is the widest reach here.
 *
 * And two things no halo fixes, reported separately from any number:
 * `selfPrune` in its default `"greedy"` mode, and `occlusionCull` with a
 * `pushClearance` above 0. Both chain — this point survives because that
 * neighbour did not, which happened because ITS neighbour did; this point
 * settled here because that one settled there — with no bound, so a cell
 * cannot reproduce the whole-region answer from ANY halo width. Those are
 * not numbers to compare against; they are a different fact about the
 * graph, and they are the cases where widening the halo is the wrong fix.
 *
 * AND THE LARGEST GAP OF ALL IS SILENCE. A node type in neither table
 * produces no entry — not a gap, nothing — and a caller reading an empty
 * `unbounded` as "nothing to worry about" has read the absence of an
 * ENTRY as the absence of a REACH. There is a whole family of nodes that
 * consume a WHOLE INPUT rather than a neighbourhood, and every one of
 * them is silent here: `transferAlongPath`, `pathScan`, `pathRuns`,
 * `runFit`, `attributeReduce`, `quotaRebalance`, `mergePoints`. A running
 * total along a path, a fit over a run, a reduction over a cloud and a
 * quota rebalanced across a population all depend on the WHOLE of what
 * they were given; a cell holding a fraction of it computes a different
 * answer, and no halo width is the fix because the thing they read is not
 * a neighbourhood. They are not in the unpartitionable table either,
 * because "whole-input" is a property of what the node MEANS rather than
 * of a param this could read, and inventing entries for it would be
 * guessing. Size a halo from this, but never conclude from it.
 *
 * WHY A TABLE OF TYPE NAMES rather than something the registry declares.
 * Nothing in `NodeTypeInfo` says "this param is a query reach" — a node
 * type publishes its params' types, defaults, ranges and prose, and the
 * reach lives in the prose. So the mapping is written here, once, next to
 * the argument for each entry. The entry a new neighbour-query node needs
 * is one line; a `reach` field on the registered param schema would
 * replace the table outright and is the change that would make this
 * complete rather than curated.
 */
import { isField } from "../fields/index.js";
// `spec.js` rather than `fields/index.js`: the field-expression spec is
// published through `src/nodes`, not re-exported from the fields barrel,
// and `src/nodes/filtering.ts` reaches for exactly this path to do
// exactly this job.
import { peekFieldSpec } from "../fields/spec.js";
import { getSubgraphSpec, type Graph } from "../graph/index.js";

/** One neighbour query whose reach is a number this could read. */
export interface NeighborQuerySource {
  /**
   * The node's id, prefixed by the ids of the subgraph nodes it sits
   * inside (`"props/prune"`), so an id in an error message locates the
   * node even when it is nested.
   */
  readonly node: string;
  /** The registered node type. */
  readonly type: string;
  /** The param the reach was read from. */
  readonly param: string;
  /** The reach, in world units. Always finite and > 0. */
  readonly reach: number;
}

/**
 * One neighbour query whose reach this could NOT read, and why. A caller
 * that needs a guarantee has to answer these itself — they are the reason
 * an empty {@link NeighborReach.unbounded} is worth more than a large
 * {@link NeighborReach.width}.
 */
export interface NeighborQueryGap {
  /** Node id, subgraph-prefixed exactly as {@link NeighborQuerySource.node}. */
  readonly node: string;
  /** The registered node type. */
  readonly type: string;
  /**
   * The param the reach would have been read from, or `undefined` for a
   * node type that declares no reach param at all.
   */
  readonly param: string | undefined;
  /** A sentence naming what stopped the read and what the caller must do. */
  readonly why: string;
}

/** What {@link neighborReach} found in one graph. */
export interface NeighborReach {
  /**
   * The widest reach that could be read as a number, in world units, or 0
   * when the graph asks for none. A halo narrower than this is provably
   * too narrow. A halo wider than it is not thereby provably wide enough:
   * see {@link unbounded}.
   */
  readonly width: number;
  /**
   * Readable reaches, in graph node order — at most
   * {@link EXEMPLAR_LIMIT} of them. {@link sourceCount} is how many there
   * really are.
   *
   * WHY THIS IS A SAMPLE AND NOT THE LIST. Subgraph nodes multiply: a def
   * that instantiates the def below it twice has 2^depth leaf instances,
   * every one of them a distinct node with its own id, and a chain 20
   * deep reaches a million. They are genuinely distinct — this is not
   * double counting — so the only list that stays bounded is a sample.
   * The `width` above is a max and is exact whatever the count; the
   * counts are exact too. It is the ids that are sampled, and they exist
   * to be READ, in an error message, by someone who then goes and looks
   * at the graph. Eight is enough to see the pattern and short enough to
   * print; a thousand would be neither, and the message that printed them
   * all measured 3.2 million characters.
   */
  readonly sources: readonly NeighborQuerySource[];
  /**
   * The source {@link width} came from, NOT sampled.
   *
   * IT IS SEPARATE FROM {@link sources} BECAUSE THAT LIST IS A SAMPLE AND
   * THIS IS THE ANSWER. A caller writing "the halo is too narrow for node
   * X" wants the node the number came from, and reducing over the sample
   * to find it names whichever of the first eight happened to be widest —
   * which on a graph with more than eight queries is usually not the one,
   * and produces a message that names a node whose reach is BELOW the
   * declared halo while telling the reader to raise the halo past it.
   * Tracked alongside `width` so the two are updated in one place and
   * cannot disagree. `undefined` exactly when the graph asks for no
   * readable reach at all, which is also when `width` is 0.
   */
  readonly widest: NeighborQuerySource | undefined;
  /** How many readable reaches there are, counting past the sample. */
  readonly sourceCount: number;
  /**
   * Neighbour queries whose reach could not be read, sampled the same way
   * (see {@link sources}). A non-zero {@link unboundedCount} means
   * {@link width} is a LOWER BOUND on what the graph asks for, not the
   * answer.
   */
  readonly unbounded: readonly NeighborQueryGap[];
  /** How many unreadable reaches there are, counting past the sample. */
  readonly unboundedCount: number;
  /**
   * Nodes that no halo width can make exact, whatever the halo is
   * (`selfPrune` in `"greedy"` mode; `occlusionCull` above a
   * `pushClearance` of 0). Widening is not the fix for these, so they are
   * not folded into {@link width}. Sampled the same way.
   */
  readonly unpartitionable: readonly NeighborQueryGap[];
  /** How many such nodes there are, counting past the sample. */
  readonly unpartitionableCount: number;
}

/**
 * How many nodes each of {@link NeighborReach}'s three lists names before
 * it stops collecting and only counts. See {@link NeighborReach.sources}.
 */
export const EXEMPLAR_LIMIT = 8;

/**
 * Node types that declare their reach as a param, and which param it is.
 *
 * Every one of these is an `f32` with `min: 0` and `acceptsField: true` in
 * the registry, which is why a LITERAL value here is always finite and
 * >= 0: `Graph.setParam` refuses a NaN, refuses an infinity (none of them
 * declares `acceptsInfinite`) and refuses a negative. The non-finite
 * branches below are therefore defensive, for a graph hand-built from an
 * unregistered def, and not the normal path.
 */
const REACH_PARAM: Readonly<Record<string, string>> = {
  // Counts and averages over the points within `radius` of each point.
  pointNeighborhood: "radius",
  // Builds an edge for every pair closer than `radius`.
  connectPoints: "radius",
  // Keeps a point only against the points within `minDistance`; see the
  // mode rule below for why that is only half the story.
  selfPrune: "minDistance",
  // Finds the nearest source point within `maxDistance` — where 0 is the
  // UNLIMITED sentinel rather than the smallest reach.
  sampleNearestPoint: "maxDistance",
};

/**
 * Node types that query neighbours but derive the reach from geometry, so
 * no param carries it and no static read can bound it. Each value is the
 * `why` the caller is told.
 *
 * `occlusionCull` is here only for its NON-greedy setting; above a
 * `pushClearance` of 0 it is unpartitionable instead, and the walk decides
 * which before consulting this table.
 */
const DERIVED_REACH: Readonly<Record<string, string>> = {
  occlusionCull:
    'derives its query radius per point from the widest chord of its own ray fan plus the bounding-sphere radius of each candidate box and its push allowance, so the reach is a function of the INPUT GEOMETRY (its `scale` attribute) and not of any param; its own documentation puts the halo it needs at roughly lookAhead + pushMax, which is a number only the author can state',
  pathCoverage:
    "derives its query radius from hypot(spread, max(|near|, |far|)) plus the largest bounding-sphere radius among the boxes it is given, so the reach depends on upstream geometry and not on params alone; state the halo from the same expression using the largest box the level can produce",
};

/**
 * Why each `transferAttribute` mapping reaches as far as it does.
 *
 * WHY THIS NODE IS IN THE FILE AT ALL, when it is not what anyone calls a
 * neighbour query and it imports nothing from `src/spatial`: it reaches
 * across a cell boundary exactly like one, through
 * `src/data/transfer.ts`'s own grids. Its DEFAULT mapping is the widest
 * reach in this file — `"nearest"` assigns EVERY destination point, with
 * no distance cap anywhere in the node, so the query grows until it finds
 * something and a miss is impossible. A cell holding half the source
 * cloud therefore transfers from a different source point than the whole
 * region would, silently, and the halo that would fix it is the extent of
 * the source cloud rather than any number on this node. Leaving it out
 * because it is filed under "attributes" rather than "neighbourhood" was
 * the exact shape of mistake this table exists to prevent.
 */
const TRANSFER_MAPPING: Readonly<Record<string, string>> = {
  nearest:
    'transfers with mapping "nearest", which has NO distance cap at all — every destination point is assigned the closest source point, however far away, so the query widens until it finds one and no halo bounds it. The halo such a level needs is the extent of the SOURCE cloud, which is not a number this node carries; cook the transfer unpartitioned, or clip the source to a window you state yourself',
  uv: 'transfers with mapping "uv", which locates each point in the source triangulation\'s UV space rather than by world distance, so there is no world-unit reach to compare a halo against; the source triangle a point lands in can be arbitrarily far away in world units',
};

/** How one node's reach param read. */
type ReachRead =
  | { readonly kind: "reach"; readonly reach: number }
  /** The node is switched off at this value and queries nothing. */
  | { readonly kind: "silent" }
  | { readonly kind: "gap"; readonly why: string };

function describeValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `a ${value.length}-tuple`;
  return typeof value;
}

/**
 * The number a param holds, when it holds one — a plain number, or a
 * `constant` field spec, which is the same graph literal with brackets
 * round it.
 *
 * THIS IS `staticScalar` FROM `src/nodes/filtering.ts`, deliberately: the
 * nodes resolve a constant spec exactly here too, and a reader that did
 * not would disagree with the cook about what the graph says. It cost a
 * false refusal to learn. `selfPrune` routes `minDistance` through its own
 * copy before anything else happens, so `constant(0)` and a plain `0`
 * cook to byte-identical geometry (measured: 481 points, identical P) —
 * and reading the field spelling as "a Field, therefore unbounded,
 * therefore a greedy prune no halo fixes" refused a legitimate level and
 * told its author to change `mode`, which was not the fix. The same
 * applies to `occlusionCull.pushClearance`, whose grid of settled points
 * is only built when the widest clearance is above 0.
 *
 * The line it keeps is the one `staticScalar` documents: a `constant` is
 * AUTHORED, fixed before any point exists, and reading it decides nothing
 * from the cook's numbers. A field that reads an attribute, a position or
 * a random is DATA, and stays unresolved here even when every value it
 * would return is identical.
 */
function staticNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (!isField(value)) return undefined;
  const spec = peekFieldSpec(value);
  if (spec === undefined || spec.fn !== "constant") return undefined;
  const literal = spec.value;
  if (typeof literal === "number") return literal;
  // A 1-tuple constant is the scalar spelling with brackets round it.
  return Array.isArray(literal) && literal.length === 1 && typeof literal[0] === "number"
    ? literal[0]
    : undefined;
}

/**
 * Read one node's reach param. The per-type branches are the documented
 * sentinels, not defensive noise: the same literal means "reaches
 * nothing" on one of these types and "reaches everything" on another, and
 * a table that ignored that would be wrong in the unsafe direction on the
 * node whose default value IS the sentinel.
 */
function readReach(
  type: string,
  param: string,
  value: unknown,
  /**
   * What a literal 0 means on THIS param. Passed in rather than switched
   * on the type name, because two nodes in this file share the inverted
   * reading and nothing about their names says so.
   */
  zeroMeans: "nothing" | "unlimited" = "nothing",
): ReachRead {
  if (value === undefined) {
    return {
      kind: "gap",
      why: `is typed "${type}" but carries no "${param}" param, so its reach cannot be read; build the graph from the registered "${type}" node def`,
    };
  }
  // A `constant` spec is a literal the cook itself resolves, so it reads
  // as its number rather than as a Field. See staticNumber.
  const literal = staticNumber(value);
  if (literal === undefined) {
    if (isField(value)) {
      return {
        kind: "gap",
        why: `reads its ${param} from a Field, which resolves per point at cook time and carries no number to compare; the halo such a node needs is the GLOBAL MAXIMUM that field can return anywhere in the world, which is derived from the expression (a noise is in [-1, 1], so \`2 + 3 * noise\` maxes at 5) and cannot be measured from a cell whose cloud the halo has already clipped`,
      };
    }
    return {
      kind: "gap",
      why: `holds ${describeValue(value)} in ${param}, which is not a reach this can read`,
    };
  }
  const n = literal;
  if (zeroMeans === "unlimited") {
    // The inverted sentinel, on `sampleNearestPoint.maxDistance` and on
    // `transferAttribute.maxDistance` alike: 0 (the DEFAULT on both) means
    // unlimited, so the smallest legal literal is the widest possible
    // reach. Reading it as 0 would report a node that can reach anywhere
    // in the world as needing no halo at all.
    if (n <= 0) {
      return {
        kind: "gap",
        why: `sets ${param} ${n}, which is this node's UNLIMITED sentinel (0 or less), so it can reach anywhere in the source cloud and no halo bounds it; give it a positive ${param} to make the reach statable`,
      };
    }
    return Number.isFinite(n)
      ? { kind: "reach", reach: n }
      : { kind: "gap", why: `sets ${param} ${n}, which reaches the whole cloud` };
  }
  if (Number.isNaN(n)) {
    // Documented as "reaches nothing" on pointNeighborhood and selfPrune,
    // and refused outright by connectPoints. Either way it is not a reach
    // a halo has to cover, and the cook says so more precisely than this
    // could.
    return { kind: "silent" };
  }
  if (!Number.isFinite(n)) {
    return { kind: "gap", why: `sets ${param} ${n}, which reaches the whole cloud` };
  }
  // 0 turns every remaining node in the table off: pointNeighborhood
  // counts nothing, connectPoints builds no edges, selfPrune keeps
  // everything.
  return n > 0 ? { kind: "reach", reach: n } : { kind: "silent" };
}

/**
 * One graph's reach, with ids RELATIVE to that graph. The unit the memo
 * stores and a parent re-prefixes on its way past.
 */
interface SubReach {
  readonly width: number;
  readonly widest: NeighborQuerySource | undefined;
  readonly sources: readonly NeighborQuerySource[];
  readonly sourceCount: number;
  readonly unbounded: readonly NeighborQueryGap[];
  readonly unboundedCount: number;
  readonly unpartitionable: readonly NeighborQueryGap[];
  readonly unpartitionableCount: number;
}

interface Accumulator {
  width: number;
  widest: NeighborQuerySource | undefined;
  readonly sources: NeighborQuerySource[];
  sourceCount: number;
  readonly unbounded: NeighborQueryGap[];
  unboundedCount: number;
  readonly unpartitionable: NeighborQueryGap[];
  unpartitionableCount: number;
}

function newAccumulator(): Accumulator {
  return {
    width: 0,
    widest: undefined,
    sources: [],
    sourceCount: 0,
    unbounded: [],
    unboundedCount: 0,
    unpartitionable: [],
    unpartitionableCount: 0,
  };
}

function addSource(acc: Accumulator, source: NeighborQuerySource): void {
  acc.sourceCount++;
  // `widest` MOVES WITH `width`, in this one branch and the matching one
  // in `mergeSub`, so the number and the node it came from cannot drift
  // apart. Strictly greater, so the FIRST source at the widest reach is
  // the one named and ties go to graph order — the order a reader will
  // find them in. A reach is always > 0, so the first source taken always
  // sets both and `widest` is undefined exactly when `width` is 0.
  if (source.reach > acc.width) {
    acc.width = source.reach;
    acc.widest = source;
  }
  if (acc.sources.length < EXEMPLAR_LIMIT) acc.sources.push(source);
}

function addGap(
  acc: Accumulator,
  kind: "unbounded" | "unpartitionable",
  gap: NeighborQueryGap,
): void {
  if (kind === "unbounded") {
    acc.unboundedCount++;
    if (acc.unbounded.length < EXEMPLAR_LIMIT) acc.unbounded.push(gap);
  } else {
    acc.unpartitionableCount++;
    if (acc.unpartitionable.length < EXEMPLAR_LIMIT) acc.unpartitionable.push(gap);
  }
}

/** Fold one subgraph's result in, re-prefixing the ids it sampled. */
function mergeSub(acc: Accumulator, prefix: string, sub: SubReach): void {
  // Same rule as `addSource`, and the prefix has to be applied here too:
  // a subgraph's `widest` is relative to its own graph, exactly as its
  // sampled ids are.
  if (sub.width > acc.width && sub.widest !== undefined) {
    acc.widest = { ...sub.widest, node: `${prefix}${sub.widest.node}` };
  }
  acc.width = Math.max(acc.width, sub.width);
  acc.sourceCount += sub.sourceCount;
  acc.unboundedCount += sub.unboundedCount;
  acc.unpartitionableCount += sub.unpartitionableCount;
  for (const s of sub.sources) {
    if (acc.sources.length >= EXEMPLAR_LIMIT) break;
    acc.sources.push({ ...s, node: `${prefix}${s.node}` });
  }
  for (const g of sub.unbounded) {
    if (acc.unbounded.length >= EXEMPLAR_LIMIT) break;
    acc.unbounded.push({ ...g, node: `${prefix}${g.node}` });
  }
  for (const g of sub.unpartitionable) {
    if (acc.unpartitionable.length >= EXEMPLAR_LIMIT) break;
    acc.unpartitionable.push({ ...g, node: `${prefix}${g.node}` });
  }
}

/**
 * Per-call state: the `(graph, overrides)` memo, and the object ids the
 * override key is built from.
 */
interface Memo {
  readonly byGraph: Map<Graph, Map<string, SubReach>>;
  readonly objectIds: WeakMap<object, number>;
  nextObjectId: number;
}

/**
 * A stable key for the overrides a parent is imposing on `graph`.
 *
 * Values are keyed by IDENTITY when they are objects — a `Field`, a
 * tuple — rather than structurally. Two structurally equal but distinct
 * Fields then miss the memo and are walked twice, which costs time and
 * never changes an answer; treating them as equal could change one. JSON
 * does the quoting, so a node id containing the separator is not a
 * question that has to be asked.
 */
function overrideKey(
  overrides: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  memo: Memo,
): string {
  if (overrides.size === 0) return "";
  const triples: [string, string, string][] = [];
  for (const [nodeId, byParam] of overrides) {
    for (const [param, value] of byParam) {
      let key: string;
      if (value !== null && (typeof value === "object" || typeof value === "function")) {
        let id = memo.objectIds.get(value as object);
        if (id === undefined) {
          id = memo.nextObjectId++;
          memo.objectIds.set(value as object, id);
        }
        key = `#${id}`;
      } else {
        key = `${typeof value}:${String(value)}`;
      }
      triples.push([nodeId, param, key]);
    }
  }
  triples.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return JSON.stringify(triples);
}

/**
 * Walk one graph and return its reach with RELATIVE ids, memoized on
 * `(graph, the overrides imposed on it)`.
 *
 * WHY THE MEMO IS NOT AN OPTIMISATION. Without it this walk is O(distinct
 * PATHS through the wrapper forest), and a def that instantiates the def
 * below it TWICE doubles per level: depth 20 is a million node visits,
 * depth 22 is four million and several seconds, and depth 26 does not
 * finish. That runs inside the `World` constructor, so it is a hang at
 * build time and not a slow build. Distinct GRAPHS at those depths number
 * about twenty. Keying on the overrides as well as the graph is what
 * keeps it correct while collapsing it: two instances handed DIFFERENT
 * exposed values key differently and are both walked, which is the very
 * thing the path-scoped visited set was restored to protect.
 *
 * The counts still add up to the true 2^depth — they are numbers, and a
 * number does not blow up. It is the id LISTS that are sampled, at
 * {@link EXEMPLAR_LIMIT}.
 */
function walkGraph(
  graph: Graph,
  /** Inner node id -> param name -> the wrapper instance's value. */
  overrides: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  memo: Memo,
  /** The graphs on the current path, for the cycle that cannot happen. */
  stack: Set<Graph>,
): SubReach {
  const key = overrideKey(overrides, memo);
  const cached = memo.byGraph.get(graph)?.get(key);
  if (cached !== undefined) return cached;
  // NOT the cycle guard, and not what makes this terminate: containment
  // cycles cannot reach here, because `Graph.add` refuses them at build
  // time (`checkNoWrapCycle`, graph.ts) in both forms — a def wrapping
  // "this very graph", and one wrapping "a graph that reaches back to
  // this one through subgraph nodes A -> B". Measured, not assumed: both
  // throw, and the tests pin the refusals so that a relaxation upstream
  // shows up here rather than as a hang. This stays as belt-and-braces
  // for a def assembled without going through `Graph.add`, and it is
  // PATH-scoped so that a shared inner graph reached twice by different
  // routes is still read twice.
  if (stack.has(graph)) return newAccumulator();
  stack.add(graph);
  const acc = newAccumulator();
  for (const state of graph._nodes.values()) {
    const id = state.id;
    // What THIS wrapper's parent wrote into this node, if anything.
    const overridden = overrides.get(state.id);
    const paramOf = (name: string): unknown =>
      overridden?.has(name) === true ? overridden.get(name) : state.params[name];
    const spec = getSubgraphSpec(state.def);
    if (spec !== undefined) {
      // A subgraph node's exposed params are written into their inner
      // targets at cook time, so the INSTANCE's value is what the inner
      // node will actually see — the value sitting on the inner node is
      // whatever it was built with. Read the override where there is one.
      //
      // `paramOf`, not `state.params`, because exposures CHAIN: an outer
      // wrapper may expose a param that targets this wrapper's own exposed
      // param, which then targets the leaf. Reading the middle instance's
      // stored value there reports the middle's number for a query the
      // outer one has already overridden.
      //
      // Keyed as a map of maps rather than a joined string: a node id is
      // whatever the caller passed to `Graph.add`, so no separator
      // character is provably absent from one.
      const inner = new Map<string, Map<string, unknown>>();
      for (const exposed of spec.params) {
        const declared = Object.prototype.hasOwnProperty.call(state.params, exposed.name);
        if (!declared && overridden?.has(exposed.name) !== true) continue;
        const value = paramOf(exposed.name);
        for (const target of exposed.targets) {
          let byParam = inner.get(target.node.id);
          if (byParam === undefined) {
            byParam = new Map<string, unknown>();
            inner.set(target.node.id, byParam);
          }
          byParam.set(target.param, value);
        }
      }
      mergeSub(acc, `${id}/`, walkGraph(spec.graph, inner, memo, stack));
      continue;
    }
    const type = state.def.type;
    if (type === "occlusionCull") {
      // Two different failures wear this node's name, and which one it is
      // turns on ONE param. At pushClearance 0 (the default) every point's
      // verdict depends on the sight input alone, so it is a wide query
      // with a derived width — a gap. Above 0 a pushed point avoids the
      // points already settled, which settled around THEIR neighbours, and
      // the node's own docs call that greedy and say no halo covers it.
      // A `constant` spec resolves to its number here exactly as
      // `staticNumber` explains: the node builds its grid of settled
      // points only when the widest clearance is ABOVE 0, so a constant 0
      // is not greedy and refusing it would be a false refusal. A field
      // that could vary still reads as greedy, because it is evaluated per
      // point and cannot be shown to be 0 at all of them.
      const raw = paramOf("pushClearance");
      const clearance = staticNumber(raw);
      const greedy = clearance === undefined ? isField(raw) : clearance > 0;
      if (greedy) {
        addGap(acc, "unpartitionable", {
          node: id,
          type,
          param: "pushClearance",
          why:
            clearance === undefined
              ? "culls with a pushClearance that is a Field, and above 0 this node is GREEDY — a pushed point avoids the points already settled, an unbounded chain no halo width covers. A varying field cannot be shown to return 0 at every point, so it is read as the greedy case; pass a plain 0, or a constant field of 0, if that is what it means"
              : `culls with pushClearance ${clearance}, above 0, which makes this node GREEDY — a pushed point avoids the points already settled, which settled around THEIR neighbours, an unbounded chain that no halo width covers (its own documentation says so). Set pushClearance to 0, whose verdicts depend on the sight input alone and are exact from a halo of about lookAhead + pushMax, or cull outside the streamed level`,
        });
        continue;
      }
    }
    const derived = DERIVED_REACH[type];
    if (derived !== undefined) {
      addGap(acc, "unbounded", { node: id, type, param: undefined, why: derived });
      continue;
    }
    if (type === "transferAttribute") {
      // Reach without a radius param and without a spatial import: see
      // TRANSFER_MAPPING for why the default mapping is the widest thing
      // in this file.
      const mappingValue = paramOf("mapping");
      const mapping = typeof mappingValue === "string" ? mappingValue : "nearest";
      const why = TRANSFER_MAPPING[mapping];
      if (why !== undefined) {
        addGap(acc, "unbounded", { node: id, type, param: "mapping", why });
        continue;
      }
      const read = readReach(type, "maxDistance", paramOf("maxDistance"), "unlimited");
      if (read.kind === "reach") {
        // maxDistance caps the RAY PARAMETER, and the search grid is over
        // triangle BOUNDING BOXES: a triangle whose hit lies within
        // maxDistance can have vertices further out still, so the halo a
        // cell needs is maxDistance PLUS the largest triangle extent in
        // the source mesh. That extent is a property of upstream geometry
        // and is not computed here — the same correction pathCoverage's
        // own description makes for its boxes. The number reported is the
        // cap alone, which is therefore a floor.
        addSource(acc, { node: id, type, param: "maxDistance", reach: read.reach });
      } else if (read.kind === "gap") {
        addGap(acc, "unbounded", { node: id, type, param: "maxDistance", why: read.why });
      }
      continue;
    }
    const param = REACH_PARAM[type];
    if (param === undefined) continue;
    const value = paramOf(param);
    const read = readReach(
      type,
      param,
      value,
      type === "sampleNearestPoint" ? "unlimited" : "nothing",
    );
    if (type === "selfPrune" && read.kind !== "silent") {
      // Greedy pruning is not a wide query, it is an unbounded CHAIN of
      // them: a survivor depends on a neighbour's fate, which depends on
      // its neighbour's. The node's own docs carry the measurement — the
      // same world cooked in cells keeps points a whole-region cook
      // pruned, and leaves survivors closer together than was asked for,
      // at every cell size tried. No halo width covers it, so it is not a
      // number to compare and does not belong in `width`.
      const modeValue = paramOf("mode");
      const mode = typeof modeValue === "string" ? modeValue : "greedy";
      if (mode === "greedy") {
        addGap(acc, "unpartitionable", {
          node: id,
          type,
          param: "mode",
          why: 'prunes in mode "greedy", whose decisions chain from neighbour to neighbour with no bound, so no halo width reproduces the answer an unstreamed cook gives; set mode to "localMaximum", which decides each point from the points within minDistance alone and is exact at a halo of minDistance, or move the prune out of the streamed level into a single unpartitioned cook',
        });
        continue;
      }
    }
    if (read.kind === "reach") {
      addSource(acc, { node: id, type, param, reach: read.reach });
    } else if (read.kind === "gap") {
      addGap(acc, "unbounded", { node: id, type, param, why: read.why });
    }
  }
  // Off the current path again, so a shared inner graph reached by a
  // second route is read rather than skipped. See the note above.
  stack.delete(graph);
  const result: SubReach = {
    width: acc.width,
    widest: acc.widest,
    sources: acc.sources,
    sourceCount: acc.sourceCount,
    unbounded: acc.unbounded,
    unboundedCount: acc.unboundedCount,
    unpartitionable: acc.unpartitionable,
    unpartitionableCount: acc.unpartitionableCount,
  };
  let byKey = memo.byGraph.get(graph);
  if (byKey === undefined) {
    byKey = new Map<string, SubReach>();
    memo.byGraph.set(graph, byKey);
  }
  byKey.set(key, result);
  return result;
}

/**
 * Read the neighbour-query reach of every node in `graph`, including the
 * nodes inside any subgraph node it holds, without cooking anything.
 *
 * The result separates three answers that a single number would run
 * together: what the graph provably asks for ({@link NeighborReach.width}
 * and `sources`), what it asks for that cannot be read from here
 * (`unbounded`), and what no halo can satisfy at all
 * (`unpartitionable`). A caller sizing a halo needs all three — `width`
 * alone says "at least this", never "this is enough".
 *
 * The three lists are SAMPLES of at most {@link EXEMPLAR_LIMIT} nodes
 * each, with the true totals alongside them; `width` and the counts are
 * exact. See {@link NeighborReach.sources}.
 *
 * Deterministic and free of side effects: nodes are visited in the
 * graph's own insertion order and nothing is cooked, evaluated or
 * mutated. The memo it builds lives for one call and is discarded.
 */
export function neighborReach(graph: Graph): NeighborReach {
  const memo: Memo = { byGraph: new Map(), objectIds: new WeakMap(), nextObjectId: 0 };
  return walkGraph(graph, new Map(), memo, new Set());
}
