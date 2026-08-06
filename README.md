# pcg-ts

Deterministic procedural content generation for TypeScript. Runs in the
browser and Node, with optional three.js interop (`pcg-ts/three`). Built
to be driven by AI agents as well as humans: every node type carries
machine-readable metadata, graphs serialize to a stable JSON format, and
errors name the offending node, pin, or param. Agent-facing entry points:
[llms.txt](./llms.txt), [docs/nodes.md](./docs/nodes.md),
[docs/authoring.md](./docs/authoring.md).

**One-page overview:** <https://c4rl05.github.io/pcg-ts/> — what it is,
architecture and pipeline diagrams, and the roadmap.

Three foundations, carried through the whole library:

- **The data model.** Attributes live on domains (point / vertex /
  primitive / detail) as SoA typed-array columns, with promote and
  transfer between domains — transfer maps by nearest source point, by
  barycentric lookup in the source triangulation's UV space, or by
  raycast against the source mesh. The standard "point with attributes"
  is the point domain plus transform (`P`, `rot`, `scale`), `density`,
  bounds, `color`, and a per-point `seed`.
- **Fields.** A value can be a deferred function of evaluation context
  (`Field<T>`), resolved only when it lands on a domain. Node params
  accept `T | Field<T>`; combinators and noise compose into expression
  trees; `capture` stores intermediate results as anonymous attributes.
- **The runtime.** A pull-based graph executor with content-keyed
  memoization, budgeted and cancellable cooking, and subgraph
  composition — plus a hierarchical `World` that streams grid cells
  around a viewpoint, coarse to fine, deterministically.

## Install

```sh
npm install pcg-ts
# optional, only for the pcg-ts/three adapter:
npm install three
```

Requires Node 18+ (or any modern browser bundler). ESM only.

## Quickstart

Scatter points in a box, then displace them with a noise field:

```ts
import {
  Graph,
  cook,
  firstGeometry,
  pointScatterInBounds,
  jitterPoints,
  fbm,
  perlinNoise,
  remap,
} from "pcg-ts";

const graph = new Graph(42); // graph seed: all node seeds derive from it

const scatter = graph.add(pointScatterInBounds, {
  count: 500,
  boundsMin: [0, 0, 0],
  boundsMax: [50, 0, 50],
});

// `amount` is field-capable: a scalar noise field, evaluated per point,
// broadcasts to all three axes.
const jitter = graph.add(jitterPoints, {
  amount: remap(fbm(perlinNoise, { seed: 7, frequency: 0.05 }), -1, 1, 0, 1),
});

graph.connect(scatter, "out", jitter, "in");
graph.output(jitter, "out", "points");

const result = await cook(graph);
const geo = firstGeometry(result.outputs.points);
if (!geo) throw new Error("no geometry");

const P = geo.attrs.point.require("P"); // f32, 3 components per point
console.log(geo.pointCount, [...P.data.subarray(0, 3)]);
console.log(result.stats); // { cooked: 2, cached: 0, elapsedMs: ... }
```

Cook again and both nodes are served from cache; change a param
(`graph.setParam(scatter, "count", 1000)`) and only what depends on it
recooks. Same seed always reproduces the same bytes.

## Fields

A `Field` is a deferred computation: it resolves to one column of values
when evaluated over a domain (`EvalContext` = geometry + domain + seed).
Inputs (`position()`, `attribute(name)`, `index()`, `randomField(key)`),
combinators (arithmetic, comparisons, trig from `sin` through `atan2`,
`clamp`/`lerp`/`remap`, `select`, `ramp`, vector ops), and noise
(`valueNoise`, `perlinNoise`, `simplexNoise`, `worleyNoise`, `fbm`) all
return fields, so expressions compose before any geometry exists:

```ts
import { createPointCloud, capture, attribute, clamp, add, mul, worleyNoise } from "pcg-ts";

// density = clamp(0.2 + worley * 0.9, 0, 1)
const density = clamp(add(0.2, mul(worleyNoise({ frequency: 0.15 }), 0.9)), 0, 1);

const geo = createPointCloud(1000);
// Evaluate over the point domain and store as a hidden anonymous
// attribute; read it back later with attribute(name).
const name = capture(geo, "point", density);
const col = attribute(name).evaluate({ geo, domain: "point", seed: 0 });
```

Raw numbers and tuples coerce to constants wherever a field is accepted
(scalars broadcast against tuples). Evaluated columns may alias live
attribute storage: treat them as read-only, and re-evaluate with a fresh
context after mutating the geometry.

Every noise field takes `normalized: true` for a uniform [0, 1] output
contract — an exact affine remap of the per-noise raw range, published
in `NOISE_RAW_RANGES` and queryable per field via `noiseOutputRange()`.
Worley additionally takes `exact: true` to widen its cell search until
provably correct (property-tested against brute force) when the fast
approximation's rare artifacts matter.

## The graph runtime

`Graph` is code-first: `add` node instances, `connect` typed pins
(geometry / value / instances / any; `multi` inputs concatenate),
declare terminal `output`s, then `cook`. Validation is eager — bad pin
names, kind mismatches, and cycles throw at `connect` time with the node
and pin named.

- **Caching.** Each node memoizes on (type, param hash, node seed, input
  item revisions). Data items carry monotonically assigned `rev` ids, so
  caching never deep-hashes geometry; unchanged outputs keep their revs
  and cleanliness propagates downstream. `CookResult.stats` reports
  cooked vs cached counts.
- **Budgeted cooking.** `cook(graph, { budgetMs })` yields to the event
  loop between nodes once the budget elapses — cooking always completes,
  it just shares the thread.
- **Cancellation.** `cook(graph, { signal })` rejects with
  `CookCancelledError`; completed nodes keep their caches, so the next
  cook resumes where the cancelled one left off.
- **Per-output cooking.** `cook(graph, { outputs: ["a"] })` cooks only
  the named outputs' upstream subgraph; everything else is untouched and
  keeps its caches. Staged pipelines fit in one graph — cook the early
  output, bind data derived from it, then cook the rest.
- **Subgraphs.** `subgraphNode(inner, exposedInputs, exposedOutputs)`
  wraps a whole graph as one node with its own persistent inner caches.
- **Live editing.** `removeNode` cascades: every connection touching the
  node and every output declared on it go with it, in a single version
  bump — downstream nodes recook on the next cook, untouched branches
  keep their caches. `disconnect` and `removeOutput` follow the same
  cache contract; unknown nodes, pins, or output names throw actionably,
  while disconnecting a connection that simply isn't there returns
  `false`.
- **Introspection.** For tooling, `describe()` returns a frozen
  structural snapshot of the live graph (nodes with their derived seeds,
  connections, declared outputs — insertion order) and `getParams` a
  frozen snapshot of a node's current params: reads that cannot mutate
  the graph behind the version counter.

## JSON authoring (for agents, editors, tools)

Everything needed to author a graph without reading source is available
at runtime: `listNodeTypes()` returns every registered node type with
pins, per-param schemas (type, default, range, enum values, field
capability, description), and an optional grouping `category` — the
standard library is fully categorized (source, sampler, point op,
filter, attribute, value, spawn, io, composite), so palettes and
generated docs group without heuristics. Graphs round-trip through a
stable, versioned
JSON format, and field-valued params are expressed as declarative JSON
specs (`fieldFromJson` / `fieldToJson`):

```ts
import { deserializeGraph, serializeGraph, fieldFromJson, cook } from "pcg-ts";

const graph = deserializeGraph({
  formatVersion: 1,
  seed: 42,
  nodes: [
    { id: "scatter", type: "pointScatterInBounds",
      params: { count: 500, boundsMin: [0, 0, 0], boundsMax: [50, 0, 50] } },
    { id: "jitter", type: "jitterPoints",
      params: { amount: { fn: "fbm", base: "perlinNoise", opts: { frequency: 0.05 } } } },
  ],
  connections: [{ from: ["scatter", "out"], to: ["jitter", "in"] }],
  outputs: [{ id: "jitter", pin: "out", name: "points" }],
});

const roundTrip = serializeGraph(graph); // structurally equal JSON back
const result = await cook(graph);
```

Serialization is complete: subgraph nodes carry their inner graph as a
nested payload (`subgraph: { graph, inputs, outputs }`, recursively in
the same format), and `dataInput` nodes serialize with an empty `items`
list — live data items are runtime-injected, so re-bind them after
deserializing. Deserialization validates node types, param schemas,
bounds, enum membership, pins, and connections — every error names the
node, param, or pin at fault and lists what would be valid. See
[llms.txt](./llms.txt) for the compact agent guide,
[docs/authoring.md](./docs/authoring.md) for the format spec and field
grammar, and [docs/nodes.md](./docs/nodes.md) for the full node
reference (generated from the registry). The `06-graph-editor` example
is this section as an app: an interactive node editor built entirely on
`listNodeTypes()` (palette grouped by category), the live graph's
validation, and `serializeGraph`/`deserializeGraph` — and it edits the
live graph through the mutation API rather than rebuilding from JSON,
so deleting or rewiring one branch leaves every untouched branch's
caches warm.

## Hierarchical streaming

A `World` streams cells of grid levels (coarse to fine, one graph per
level) around a moving viewpoint, with budgeted cooking, hysteresis,
LRU eviction, and invalidation:

```ts
import { Graph, World, pointScatterInBounds, spawnInstances } from "pcg-ts";

const level = new Graph();
const scatter = level.add(pointScatterInBounds, { count: 200 });
const spawn = level.add(spawnInstances, { assetId: "tree" });
level.connect(scatter, "out", spawn, "in");
level.output(spawn, "instances", "instances");

const world = new World({
  seed: 1234,
  levels: [
    {
      name: "props",
      cellSize: 32,          // world units per cell (XZ plane)
      generationRadius: 96,  // cells cook when their center enters this radius
      graph: level,
      bind(graph, ctx) {
        // The only channel through which cell data enters the graph.
        // Determinism contract: derive params only from ctx, and wire
        // ctx.seed into every stochastic node.
        graph.setParam(scatter, "boundsMin", [ctx.min[0], 0, ctx.min[1]]);
        graph.setParam(scatter, "boundsMax", [ctx.max[0], 0, ctx.max[1]]);
        graph.setParam(scatter, "seed", ctx.seed);
      },
    },
  ],
  onCellReady: (level, coord, outputs) => {/* hand outputs to the renderer */},
  onCellEvicted: (level, coord) => {/* tear down renderer state */},
});

// Per frame (or on movement); overlapping calls are serialized.
await world.update([camera.x, camera.y, camera.z], { budgetMs: 8 });
```

Each cell's seed hashes the world seed, the level index, and every cell
coordinate (`hashCombine(worldSeed, levelIndex, cx, cz)` above), so cell
content is a pure function of (world seed, level, coordinate, graph,
parent cell content) — never of cook order, viewpoint path, or eviction
history. Wire `ctx.seed` into each stochastic node, or reseed the whole
graph with `graph.setSeed(...)` inside `bind` — both are sanctioned
(`setAttribute` also takes an optional `seed` param that folds a
per-cell value into its field evaluation). Lower levels see their parent
cell's outputs via `ctx.parent` (typically injected through a
`dataInput` node), and a parent recook automatically marks its children
stale.

Levels use square XZ-plane cells by default; `cellMode: "xyz"` switches
a level to cube cells addressed `[cx, cy, cz]`, with radii measured in
full XYZ distance and all three coordinates hashed into the cell seed
(`ctx` is a discriminated union on `cellMode`, so `bind` can narrow it).
An optional leading `cellSize: "unbounded"` level covers the world with
one global cell and needs no `generationRadius`. `cookOutputs: [...]` on
a level cooks only those declared outputs per cell — a terminal branch
another consumer uses costs the level nothing.

## three.js interop

`pcg-ts/three` is the only module that imports `three` (an optional
peer dependency); the core is renderer-agnostic.

```ts
import { BoxGeometry, MeshStandardMaterial, SphereGeometry } from "three";
import { fromBufferGeometry, toInstancedMeshes } from "pcg-ts/three";
import { Graph, cook, dataInput, makeGeometryItem, surfaceSample, spawnInstances } from "pcg-ts";

// three -> pcg: a triangle mesh becomes sampleable geometry.
const surface = fromBufferGeometry(new BoxGeometry(10, 1, 10));

const graph = new Graph(7);
const input = graph.add(dataInput, { items: [makeGeometryItem(surface)] });
const sample = graph.add(surfaceSample, { count: 2000 });
const spawn = graph.add(spawnInstances, { assetId: "rock" });
graph.connect(input, "out", sample, "in");
graph.connect(sample, "out", spawn, "in");
graph.output(spawn, "instances", "instances");

// pcg -> three: instance batches become InstancedMesh objects.
const { outputs } = await cook(graph);
for (const item of outputs.instances) {
  if (item.kind !== "instances") continue;
  const meshes = toInstancedMeshes(item.batches, {
    rock: { geometry: new SphereGeometry(0.1), material: new MeshStandardMaterial() },
  });
  // meshes[i] is a THREE.InstancedMesh; add to your scene.
}
```

Multi-asset spawns stay declarative: write a per-point string attribute
with `setAttribute` (`type: "string"`, a `values` list, and a
field-capable selector that picks per point) and name it in
`spawnInstances`' `assetAttr` — batches then split by asset id, and
`orientAlongVector` turns a direction attribute (a surface normal, a
spline tangent) into the standard `rot` quaternion without leaving the
graph. See `examples/02-forest` and `examples/03-spline-fence`.

Also available: `fromCurve` (a `THREE.Curve` becomes a polyline for
`splineSample`), `toPointsObject` (debug point rendering), and
`WorldThreeBinding`, which manages one scene-graph group per live
`World` cell — pass its `cellReady`/`cellEvicted` methods into the
`World`'s `onCellReady`/`onCellEvicted` callbacks.

## Determinism guarantees

What the library promises:

- **Same seed → identical output.** All randomness flows from seeds via
  PCG32 and murmur-style hash combining (`hashCombine`), never
  `Math.random`. Same graph + same seed produce byte-identical results
  across runs and platforms.
- **Order and path independence.** Per-point randomness is hashed from
  (seed, index, axis), per-cell seeds from (world seed, level, coords).
  Cook order, streaming order, cancellation, eviction, and recooks never
  change the bytes produced.
- **Introspectable execution.** Cook stats, cache hit/miss counts, and
  per-node progress callbacks expose what actually ran.

What the caller must respect (the mutation contracts):

- **Cook results are immutable.** `CookResult` collections (and the
  geometry inside) alias live cache internals; mutating them corrupts
  the cache undetectably. Use `cloneGeometry` first. Node authors have
  the same duty: `execute` must treat inputs as immutable and derive all
  randomness from its `seed` argument.
- **Bound arrays are frozen.** Arrays bound into params (e.g. a
  `dataInput` node's `items`) are captured by reference; mutate them in
  place and stored cell outputs change with no staleness signal. Bind a
  fresh array instead.
- **Columns are transient.** An evaluated field `Column` may alias
  attribute storage and is valid only until the geometry is mutated or
  resized; re-evaluate with a fresh `EvalContext` after mutating.
- **Don't edit a graph mid-cook.** Edits while a cook or `World.update`
  is in flight are detected and heal on the next pass, but that pass may
  return a torn mix of old and new state.

## Examples

The `examples/` directory contains seven vite multi-page demos (scatter
with density noise, forest instancing, spline sampling, infinite
streaming world, field composition playground, a registry-driven
node-graph editor, and an infinite deterministic spiral galaxy with
click-to-visit star systems):

```sh
npm run examples
```

## Development

```sh
npm test          # vitest: unit + integration + determinism suites
npm run build     # tsup: dist/ with subpath exports ".", "./three"
npm run check     # tsc --noEmit
npm run examples  # vite dev server for examples/
npm run docs:nodes  # regenerate docs/nodes.{md,json} from the registry
```

## License

MIT
