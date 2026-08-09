# pcg-ts

Real-time procedural content generation for TypeScript — deterministic
by construction, WebGPU accelerated. Runs in the browser and Node, with
optional three.js interop (`pcg-ts/three`), optional WebGPU field
evaluation (`pcg-ts/gpu`) and a shipped primitive vocabulary
(`pcg-ts/primitives`). Built
to be driven by AI agents as well as humans: every node type carries
machine-readable metadata, graphs serialize to a stable JSON format, and
errors name the offending node, pin, or param. Agent-facing entry points:
[llms.txt](./llms.txt), [docs/nodes.md](./docs/nodes.md),
[docs/primitives.md](./docs/primitives.md),
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
- **Subgraphs.** `subgraphNode(inner, exposedInputs, exposedOutputs,
  exposedParams)` wraps a whole graph as one node with its own persistent
  inner caches. Exposed params give the wrapper its own knobs, each bound
  to one or more inner params, with schemas derived from those params
  rather than hand-written. `registerSubgraph(name, recipe)` publishes one
  under a name, so a serialized graph can reference it instead of
  embedding a copy — and cook byte-identically either way.
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

**Field params serialize whichever way you authored them.** A field
built from the combinator API — `mul(position(), 0.1)`,
`ge(randomField("species"), 0.72)` — derives its spec from its
arguments, so it round-trips through `serializeGraph` exactly as a
`fieldFromJson` spec does. Before v0.9 it did not: `serializeGraph`
threw and pointed at `fieldFromJson`, so the pleasant authoring API and
the serializable one were different APIs. Four cases still refuse: a
field built by `makeField` (an arbitrary closure nothing can describe),
any field composed over one (the absent spec propagates through every
combinator), a tree nested deeper than the grammar's 256-level cap, and
an argument the constructor accepts but the grammar's parser does not
(`perlinNoise({ seed: 1.5 })` — the constructor coerces, the grammar
requires an integer). The depth cap refuses on purpose — derivation
stops at exactly the depth `fieldFromJson` will parse, so the library
never writes a graph it could not read back.

The error names the one cause that applied and the offender, not a list
to choose from: the node and param at fault, plus — for an opaque leaf
— that leaf's own structural key, so a `makeField` buried deep inside a
combinator tree is named rather than the constructor above it.

Serialization is complete: subgraph nodes carry their inner graph as a
nested payload (`subgraph: { graph, inputs, outputs, params }`,
recursively in the same format, with exposed-param values on the node
itself) or as a reference to a registered one (`ref: { name, hash? }`,
where the optional hash pins the reference and a mismatch is an error,
never a warning), and `dataInput` nodes serialize with an empty `items`
list — live data items are runtime-injected, so re-bind them after
deserializing. Deserialization validates node types, param schemas,
bounds, enum membership, pins, connections, and the key sets themselves
at every object position — every error names the node, param, pin, or key
at fault and lists what would be valid. See
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

### The primitive library

The library ships a catalog of named subgraphs — the vocabulary a graph
is written IN, rather than assembled from nodes every time. They register
on import of their own subpath, so `import "pcg-ts"` keeps costing
nothing:

```ts
import "pcg-ts/primitives";
```

Names are `<family>/<kebab-case>` over seven families — `shape` `fill`
`transform` `compose` `filter` `place` `write` — and the family is a
promise about the pin shape, so they chain without reading inner graphs.
A graph references one by name:

```json
{ "id": "trees", "type": "subgraph",
  "params": { "count": 4000, "minDistance": 3 },
  "ref": { "name": "fill/scatter-even" } }
```

Each carries its own agent-facing description, the exposed params with
derived schemas, and — where it matters — a statement of whether two
instances of it differ by default, which is the counter-intuitive part:
scattering varies per instance automatically, noise does not and cannot
be re-rolled by any seed, so noise-driven primitives expose a `variant`
that moves where the field is sampled. The generated reference is
[docs/primitives.md](./docs/primitives.md) (machine-readable:
[docs/primitives.json](./docs/primitives.json)), and `pcg run
fill/scatter-even --param minDistance=3` cooks one from the command line
with no graph file at all.

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
`spawnInstances`' `assetAttr` — batches then split by asset id (in
ascending first-occurrence point order), and `orientAlongVector` turns
a direction attribute (a surface normal, a spline tangent) into the
standard `rot` quaternion without leaving the graph. Since v0.8.0 such
a spawn can be device-resident too — composed on the GPU and handed to
the renderer without a CPU round trip — not just a CPU one. See
`examples/02-forest` and `examples/03-spline-fence`.

Also available: `fromCurve` (a `THREE.Curve` becomes a polyline for
`splineSample`), `toPointsObject` (debug point rendering), and
`WorldThreeBinding`, which manages one scene-graph group per live
`World` cell — pass its `cellReady`/`cellEvicted` methods into the
`World`'s `onCellReady`/`onCellEvicted` callbacks.

With a `THREE.WebGPURenderer`, `createWebGpuInstanceAdapter` lets the
same binding draw instance matrices straight out of the GPU buffer the
cook composed them in, skipping the `Float32Array` entirely — see
[Device-resident instancing](#device-resident-instancing) below.
`three/webgpu` is imported lazily by that factory, so a WebGL app pays
nothing for its existence.

## GPU cooking (WebGPU)

`pcg-ts/gpu` compiles the serializable field-expression grammar to WGSL
compute kernels, runs them on a WebGPU device, and fuses chains of
field-driven nodes into single device-resident runs. The core never
imports it (guard-tested, like `pcg-ts/three`); the graph layer sees
only a structural resolver interface, injected per cook:

```ts
import { cook } from "pcg-ts";
import { GpuFieldEvaluator } from "pcg-ts/gpu";

// Browser
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const device = await adapter.requestDevice();
const gpu = new GpuFieldEvaluator(device, { adapterInfo: adapter.info });

const result = await cook(graph, { gpu });
console.log(result.stats.gpu);
// { dispatches, pipelinesCompiled, pipelineCacheHits,
//   residentRuns, fusedNodes, readbacksSaved, fallbacks: {...} }
```

In Node, install the `webgpu` package (Dawn bindings, a dev-time
dependency — the library itself depends on nothing):

```ts
import { create } from "webgpu";
const adapter = await create([]).requestAdapter();
```

**What compiles.** The whole grammar — inputs, arithmetic, trig,
`clamp`/`lerp`/`remap`/`select`/`ramp`, vector ops, and all noise
including `fbm` and exact worley. One eligible field evaluates over a
whole domain in one compute dispatch.

**Describing a field and running it on the device are two different
questions.** Since v0.9 both authoring styles describe themselves:
`getFieldSpec(field)` returns a spec for a field built by
`fieldFromJson` (*authored*) and for one built from the combinator API
(*derived* — `getFieldSpec(component(position(), 1))` is a spec, not
`undefined`). Device eligibility is the narrower question, and it also
asks about provenance: an authored spec is eligible; a derived one only
when the evaluator was constructed with `acceptDerivedSpecs: true`.

```ts
const gpu = new GpuFieldEvaluator(device, {
  adapterInfo: adapter.info,
  acceptDerivedSpecs: true,     // default false
});
```

With the default `false`, a derived-spec field resolves on the CPU and
counts a `derived-spec` fallback — its own reason, distinct from
`no-spec`, which now means the field cannot be described at all.

**Why it is opt-in.** Not caution for its own sake. Measured on one
adapter, the derived form of an expression compiles to the same kernel
key and the same WGSL text as its authored twin, and produces the same
bytes — but that establishes *derived ≡ authored on the device*, not
*device ≡ CPU*. The CPU stays the bit-exact reference and the GPU path
stays a documented approximation of it (see the budgets below), so
accepting derived specs by default would move output bytes for every
graph that already passes a resolver and never asked — including the
discrete case, where a `ge`/`select` threshold at a knife edge flips a
whole point to the other branch. The memo salt keeps caches honest
across the setting; it cannot keep output stable, which is the thing at
risk. So the wider eligible set is a per-evaluator choice you make.

Six nodes resolve their field params on the device — `setAttribute`,
`transformPoints`, `jitterPoints`, `orientAlongVector`,
`surfaceSample`, `volumeSample` — subgraph nodes forward the resolver
to their inner cooks, `captureAsync` is the graph-free entry point,
and `WorldOptions.gpu` / `UpdateOptions.gpu` (update wins) thread a
resolver into every cell cook. Element count is never a limit: a
kernel covering more elements than one `dispatchWorkgroups` call
allows (65535 × 64 ≈ 4.19M) splits into chunked dispatches with
byte-identical output. Ineligible fields fall back to the CPU silently
but countably — `CookStats.gpu.fallbacks` records machine-readable
reasons: `no-spec`, `derived-spec`, `compile-error`,
`too-many-buffers` per field, and `run-plan-failed`, `run-too-large`
per fused run. That is the complete vocabulary. `derived-spec` is
scoped to the per-field seam: a node kept out of a fused run by the
same setting is not counted again at the fusion gate, because its
fields still fall back per-field and one cause reported twice would
read as two. Node-level opt-outs are part of it in principle (a node
whose `ResidentDesc.eligible` returns a reason string), but the
standard node library declares none — v0.7's `spawn-asset-attr` was
the only one, and v0.8 retired it when `assetAttr` spawns became
device-resident.

**Device-resident runs.** When the resolver implements the optional
`planRun`/`executeRun` pair — `GpuFieldEvaluator` does; a resolver
with neither degrades cleanly to per-node cooking — the executor finds
**maximal linear chains** of fusable nodes and cooks each as one
device round trip. Attribute columns live in storage buffers across
member kernels; only the run's terminal reads back.

- **What fuses:** `setAttribute` (numeric mode, point domain, no
  literal `values`/`stringValue`), `transformPoints`, `jitterPoints`,
  and `orientAlongVector` — all count-preserving, one geometry in, one
  geometry out — in a straight line where every member has exactly one
  consumer, that consumer is the next member, and every `Field` param
  along the chain carries a spec *this resolver accepts* — authored
  always, derived only under `acceptDerivedSpecs`. A chain of one is not a
  run — with one exception: a lone *terminal* is, because fusion is the
  only way to produce device output at all (see
  [Device-resident instancing](#device-resident-instancing)).
- **Where runs end:** at a non-fusable node, at a node carrying a
  declared graph output, and at any fan-out. An interior node with
  external consumers becomes a run terminal with its own readback —
  fusion never changes which bytes the rest of the graph observes.
- **Cache contract:** only the terminal caches, under a composite key
  `run1|gpu:<cacheSalt>|i<inputSig>|m[type|seed|paramHash|memoKey]…`
  covering every member in order. Interior members hold no entry while
  fused. Editing any member's params recooks exactly that run and
  leaves siblings and upstream cached.
- **Stats:** `residentRuns` (runs executed), `fusedNodes` (their total
  members), and `readbacksSaved` — each run reads back once where the
  per-node path reads back per member, so `readbacksSaved =
  fusedNodes − residentRuns` for every run that materializes. A run
  that reads back nothing at all — a device-resident spawner whose
  `points` pin is neither connected nor declared — contributes its
  full member count instead.

Three things to know before reading a benchmark:

- **Constant params ride the run uniform, not a column.** A plain
  `translate: [0, 0, 0]` costs a 16-byte uniform slot and no dispatch;
  only field-valued params materialize an `n`-element temporary. In
  the `examples/08-gpu-fields` chain that is 120 of the 156 bytes per
  point the run used to hold (−23%) and 9 member kernels instead of
  12. Constant *values* live in the uniform and never in the generated
  WGSL, so editing one rebinds a buffer and hits the pipeline cache
  instead of recompiling. (Before v0.6.1 constants cost a full column
  each, which is why older notes describe constant-heavy chains as a
  fusion hazard.)
- **`stats.dispatches` counts kernels, not `dispatchWorkgroups`
  calls** — one per resolved field column plus one apply kernel per
  member. A kernel chunked across several dispatches still counts
  once: a 4.3M-point four-member run reports 4 while issuing 8. One
  kernel counts more than once, and only one: a **multi-asset spawner
  terminal** dispatches once per asset present in the input — the unit
  is (step, asset), not step — because those are distinct dispatches
  over disjoint ranges into distinct output buffers, not chunks of one
  range. A constant-`assetId` spawn has exactly one asset and still
  counts 1, so v0.7 numbers stay comparable.
- **Toggling `gpu` on and off thrashes the terminal's cache slot by
  design.** A node holds one memo entry; a fused cook stores under the
  run key above, a per-node cook under `<type>|s…`. The two formats
  cannot collide, so neither path ever serves the other's bytes — but
  the chain does recook on every flip. Time GPU work from cold caches.

A run's working set — resident attribute slots across every epoch,
field temporaries held for the whole run, and the readback staging
buffer — is computed at plan time and compared against
`maxResidentBytes` (default 512 MiB); over-budget runs fall back with
`run-too-large`. Two more evaluator options matter under load:
`maxPooledBytes` (default 256 MiB, `0` disables retention) bounds the
buffer pool's idle bytes, and `evaluator.dispose()` destroys those
idle buffers while leaving in-flight ones valid and the evaluator
usable. `evaluator.poolStats` reports `{ buffersCreated,
buffersReused, buffersDestroyed, pooledBuffers, pooledBytes,
buffersDetached, detachedBuffers, detachedBytes }`. Its byte totals
are **bucket** bytes, not logical ones: the pool rounds every
allocation up to a power of two with a 256-byte floor.

**Determinism contract.** The CPU is the bit-exact reference and
existing goldens never move; the GPU path is a documented approximation
of it:

- u32 hash and random streams (`hashCombine`, `hashFloat`,
  `randomField`, noise lattice hashing) are **bit-exact** between CPU
  and WGSL — likewise `index`, integer attribute reads, bool→f32 reads,
  and pure hash+compare+select trees.
- Float arithmetic matches within measured per-op-family budgets (CPU
  computes in f64 and stores f32; WGSL computes in f32). Condensed, in
  range-ULP units (error / 2⁻²³·max|output|, measured on real
  hardware; the full table lives in [llms.txt](./llms.txt) and
  [docs/authoring.md](./docs/authoring.md)): add/sub/mul and
  clamp/min/max/floor/select/compares are bit-exact; div, lerp, remap,
  and dot ≤ 1; ramp, length/normalize ≤ 2; sin/cos ≤ 8, tan ≤ 24,
  atan/atan2 ≤ 80, asin/acos ≤ 512 (an absolute-error class per the
  WGSL spec); noise families ≤ 6–24 depending on base and mode.
- On a single device, results are run-to-run **byte-identical**.
- Branchy ops (select, compares, ramp segments, worley cell walks) may
  flip at knife-edge inputs whose operands differ within tolerance.
- Fused runs carry composed budgets. Across 17 device chains the worst
  case is `rangeUlp` 4.83 on `P` for a
  noise→orient→transform→jitter chain (budget 6), with quaternion dot
  ≥ 0.99999957 against a floor of 0.9999995. Twelve of the 17 are
  **byte-identical** to the CPU — which holds only because their
  jitter amounts are powers of two and their transforms use identity
  euler angles and power-of-two scales, so every f32 step is exact and
  the single store is the only rounding. Change an amount to 0.1 and
  the chain moves into the budgeted class.
- **Every budget here was measured on one adapter** (discrete desktop,
  D3D12/Dawn) and is the measured value rounded up minimally. Another
  adapter exceeding one is a finding worth reporting, not expected
  noise.

Out-of-domain inputs are garbage-in/garbage-out, measured and
documented rather than patched: NaN through `min`/`max` may return the
other operand on GPU (CPU propagates NaN); vector lengths beyond f32
range overflow to Inf/0 where the CPU's f64 interior survives; noise
lattice coordinates at or above 2³¹ diverge (JS wraps, WGSL
saturates); subnormal results flush to exactly 0 on GPU.

**Cache provenance.** GPU output is not byte-identical to CPU, so a
resolver's `cacheSalt` (format version + adapter vendor, architecture,
device, description) folds into the memo key of any node that would
resolve a live Field param on device *under this resolver's settings*.
The salt gains a `+derived` component when `acceptDerivedSpecs` is on
and nothing at all when it is off — so two evaluators on one adapter,
one accepting derived specs and one not, cannot serve each other's
bytes, and every memo key a pre-v0.9 graph produced is byte-identical.
Toggling `gpu` never serves bytes produced by the other path, and a
node whose live field params are all ineligible under the current
settings — no spec at all, or a derived spec with the gate off — keeps
its cache hits across the toggle. Fused runs use the same salt inside
the run key above. Pipelines are cached on the evaluator instance and
persist across cooks.

See it live: [`examples/08-gpu-fields`](./examples/08-gpu-fields) cooks
a five-node fusable chain over a million points three ways — CPU, GPU
per-node (fusion switched off), and one fused device-resident run —
with per-path cold-cache wall times, the full `CookStats.gpu` counters,
per-path output hashes, and a live deviation readout.

## Device-resident instancing

A fused run normally ends by reading its result back to the CPU. With a
WebGPU renderer on the other side there is no reason to: the instance
matrices already live in the memory of the same GPU device — a
`GPUDevice`, WebGPU's handle to the GPU, not a device in the everyday
sense — that the renderer draws from. Opt in with
`deviceInstances: true` and a `spawnInstances` terminal composes every
4×4 on the GPU and hands back **buffer handles** instead of
`Float32Array`s — no readback, no CPU compose loop, and no
`instanceMatrix` upload on the way back out. (Shipped in v0.7.0 for a
constant `assetId`; since v0.8.0 an `assetAttr`-driven multi-asset
spawn is resident too.)

```ts
import { World } from "pcg-ts";
import { GpuFieldEvaluator } from "pcg-ts/gpu";
import { WorldThreeBinding, createWebGpuInstanceAdapter } from "pcg-ts/three";
import { WebGPURenderer } from "three/webgpu";

// ONE device, two consumers. This is the whole feature.
const gpuAdapter = await navigator.gpu.requestAdapter();
if (!gpuAdapter) throw new Error("no WebGPU adapter");
const device = await gpuAdapter.requestDevice();

const renderer = new WebGPURenderer({ device });
await renderer.init();                       // must be initialized first

const gpu = new GpuFieldEvaluator(device, {
  adapterInfo: gpuAdapter.info,
  deviceInstances: true,                     // advertises spawnInstances
});
const adapter = await createWebGpuInstanceAdapter({ renderer, assets });

const binding = new WorldThreeBinding({
  group, assets,
  deviceInstances: { adapter, bounds: (level, coord) => cellSphere(level, coord) },
});
const world = new World({
  ..., gpu,
  onCellReady: (l, c, outputs) => binding.cellReady(l, c, outputs),
  onCellEvicted: (l, c) => binding.cellEvicted(l, c),
});
```

**The same `GPUDevice` must back both halves.** Not a convenience — a
hard requirement of the platform. A `GPUBuffer` belongs to the device
that created it; two devices cannot share one, and a WebGL context
cannot read a WebGPU buffer at all. So the CPU-free path exists only
when one device backs the evaluator *and* the renderer. Create the
device yourself and pass it to `new WebGPURenderer({ device })` — and
after `init()`, checking that `renderer.backend.device` really is that
same object is cheap insurance against a future three release quietly
dropping the parameter. A batch that arrives from anywhere else is
refused by name:

```
createWebGpuInstanceAdapter: batch "tree" carries a "cpu" transforms handle,
not "webgpu"; only a GpuFieldEvaluator running on the renderer's own GPUDevice
produces bindable buffers
```

**What the spawner terminal produces.** `spawnInstances` declares
itself a run *terminal*: it may be a run's last member and a chain
never continues through it. When the evaluator advertises it
(`evaluator.residentTerminals` is `["spawnInstances"]` under the
opt-in) the run appends a compose-TRS kernel writing one column-major
4×4 per point, then transfers the composed buffers out of the
evaluator's pool — **one buffer per asset**, so a constant-`assetId`
spawn yields one and an `assetAttr` spawn yields as many as there are
distinct asset ids on its points. If nothing in the cook reads the
terminal's `points` pin, the run performs *no readback at all* — no
`mapAsync`, no staging buffer, no CPU copy of `P`/`rot`/`scale`. Even a
lone spawner counts as a run here, because fusion is the only way to
produce device output.

The `instances` item that comes back carries `deviceBatches`, not
`batches` — one entry per asset, in the batch order documented below.
Each `DeviceInstanceBatch` is `{ residency: "device",
assetId, count, transforms }`, where `transforms` is an opaque
`DeviceTransformsHandle` (`backend`, `byteLength`, `disposed`,
`resource`, `dispose()`) — never a typed array. Reading `batches` on
such an item throws on purpose, because a WebGL adapter silently
drawing nothing is the worse failure:

```
instances item is device-resident (1 batch(es), 140 instances): its transforms
live in GPU buffers and were never composed on the CPU, so `batches` does not
exist. Read `item.deviceBatches` and bind each batch's `transforms` handle with
a WebGPU renderer, or construct the GpuFieldEvaluator without
`deviceInstances: true` to get CPU `batches` back.
```

Writing your own renderer adapter? `deviceTransformsBuffer(handle)`
from `pcg-ts/gpu` is the one supported way to get the `GPUBuffer` back
out. Bind exactly `handle.byteLength` bytes from offset 0 — the pool
buckets allocations to powers of two, so the tail is uninitialized.

**Multi-asset spawns are resident too (v0.8.0), and the batch order is
part of the contract.** `assetAttr` no longer forces the compose back
to the host. There is no device-side sort, and none is needed: no
resident node can produce a string attribute, so the asset key is a
host column *by construction*. The host plans the grouping with the
same function the CPU spawner calls, uploads a permutation, and the
device composes once per asset — no atomics, no prefix sum, no
readback. Both paths therefore agree by construction rather than by
comparison, which is what makes the order safe to depend on:

- **Batches are ordered by ascending first-occurrence point index** of
  each distinct resolved asset id. Not string-table order, not intern
  order, not lexicographic — so a recook whose string table interned
  in a different order still produces the same batch order. Points
  `["b", "a", "b"]` give batches `["b", "a"]`.
- **Within a batch, instances are in ascending original point index.**
  The grouping is a stable partition.
- **An empty per-point value (`""`) resolves to `assetId`** and merges
  into that batch rather than opening its own — including when some
  other point carries the literal string equal to `assetId`. The
  merged batch sits at the first occurrence of *either*. An
  out-of-range string-table index resolves the same way.
- **Zero points yields zero batches**, in constant mode as well as
  attribute mode. An asset that appears in the string table but on no
  point produces no batch: groups come from points, never from the
  table.

`assetAttr` naming a missing attribute, or an attribute that is not a
string attribute, is still an error and still raises the CPU spawner's
message, naming the attribute (the missing-attribute form also lists
the string point attributes that *are* present). The run planner
mirrors those two conditions and *rejects* rather than throwing —
counting `run-plan-failed` — so the per-node path serves and there is
exactly one copy of each message.

**The remaining boundary: a string `setAttribute` breaks the chain.**
`setAttribute` is fusable in numeric point-domain mode only; its
resident predicate excludes `type: "string"`. So the idiomatic way to
*compute* an asset key — `setAttribute` with `type: "string"` and a
field-capable selector over a `values` list — is not resident, and the
chain breaks there. Where it feeds the spawner directly, as in the
recipe above and in `examples/02-forest`, the run holds only the
spawner: one fused member, not four. Resident nodes sitting *between*
the string write and the spawn still fuse with it, so the depth is
whatever survives downstream of the break, and the chain in front of
the break fuses as its own run. Making `setAttribute` resident in
string `values` mode is the recorded successor — and because the key
would then be device-produced, that is also the change that would
finally require the device-side counting sort this design avoids.

**Who frees what.** Each batch's buffer starts pool-owned;
`BufferPool.detach` moves them out on the run's very last line, after
the final cancellation check — one detach and one
`DeviceTransformsHandle` per asset — so every earlier failure path
still reclaims every buffer, and a transfer that fails partway disposes
each buffer exactly once. From that instant the *holder* owns them and
nothing else will ever free them — not the pool, not the memo cache,
not `evaluator.dispose()`.

- The graph delivers handles but never owns them. A terminal that
  produced device batches writes a **volatile** cache entry: it feeds
  this cook's consumers and is then refused by the cache-hit path, so
  every cook produces a fresh handle. Memoizing one would pin GPU
  memory for the lifetime of the graph and hand the same handle to a
  second owner.
- `WorldThreeBinding` is the owner of last resort. It reference-counts
  handles **by identity** and disposes only at the last release, across
  four paths: evict, recook, a partial build failure, and `dispose()`.
  Identity counting is load-bearing, not decoration — a child cell that
  forwards its parent's outputs holds the *same handle object*, so
  eviction in either order is safe.
- The adapter never disposes a handle. It owns the `InstancedMesh` and
  its attribute only; `release()` deliberately avoids anything that
  would `destroy()` a buffer another live cell may still draw from.
- `dispose()` twice is a no-op, never a double free. Reading `resource`
  after dispose throws instead of handing out a destroyed buffer.
- **Leaks are visible, not silent.** An un-disposed handle stays
  counted in `evaluator.poolStats` (`detachedBuffers`, `detachedBytes`,
  plus cumulative `buffersDetached`); the binding reports the same
  population from its own side as `binding.deviceHandleCount` and
  `binding.deviceHandleBytes` — now one handle per *batch*, i.e. per
  asset in a cell, rather than one per cell; a handle shared across
  cells is still counted once, since the count is of distinct handles.
  Over a sustained fly-through both must reach a steady
  state, not climb. Compare the *counts*: the byte totals are different
  quantities and never converge — the pool reports the power-of-two
  bucket it allocated, the binding the logical `count * 64` payload it
  holds.
- **Read `deviceHandleBytes` as a leak meter, not as VRAM.** It is a
  lower bound on device occupancy, and since v0.8 a loose one: the pool
  buckets to the next power of two with a 256-byte floor, and a
  multi-asset spawn takes one buffer per asset, so a cell with four
  small batches pays four roundings where it used to pay one — a
  3-instance batch is 192 logical bytes in a 256-byte bucket, a
  20-instance batch 1280 in 2048. With many small per-asset batches the
  gap is structural, not incidental. What stays exact is the property
  the meter exists for: retained bytes returning to zero and staying
  bounded.

Cells with no CPU matrices have no bounding sphere to compute, so
supply one out of band via `deviceInstances.bounds` (derive it from the
cell AABB). Return `undefined` and frustum culling is switched off for
that batch's object rather than guessed — drawing too much is
recoverable, culling visible geometry is not.

`bounds` is called **once per batch**, not once per cell, and takes
`(levelName, coord, assetId)`. The third argument is the lever a
multi-asset cell needs: the sphere must cover the instances' own extent
as well as the cell's, and with one sphere per cell every asset
inherits the padding of the tallest one — a cell holding both a
200-unit landmark and ground cover would draw the ground cover with a
200-unit skirt and effectively stop culling it. Ignoring the third
argument is fine and keeps the per-cell behaviour; existing
two-parameter callbacks still type-check and are simply asked once per
asset.

**This leans on three's renderer internals, and says so loudly.** three
publishes no supported way to render from a `GPUBuffer` you already
own; left alone it allocates its own and uploads the attribute's
(empty) array over the top. The adapter seeds three's WebGPU backend
attribute record so creation and upload become a no-op. The peer range
is pinned to `three@^0.185.1`, and `checkAdoptionSeam(renderer,
makeAttribute)` — exported from `pcg-ts/three` — is the guard that pins
the seam: it seeds a sentinel on a throwaway attribute, lets three's
own creation path run over it, and verifies the sentinel survived.
`createWebGpuInstanceAdapter` runs that check at construction, so a
moved internal fails at startup rather than drawing wrong matrices at
frame time. The failure names the version and every way out:

```
pcg-ts/three WebGPU instance adapter: <detail>. This adapter binds device-resident
instance transforms by seeding three's WebGPU backend attribute record
(`renderer.backend.get(attribute).buffer`), an internal verified against three
0.185.1; observed: <observed>. three has moved or renamed it, so rendering from a
device buffer would silently draw the wrong matrices. Pin three to 0.185.1, or
update src/three/webgpuInstances.ts (ADOPTION_SEAM) to the new shape, or drop
`deviceInstances: true` from the GpuFieldEvaluator to render through the CPU path
```

**The CPU stays the reference.** The compose kernel works in f32
throughout where the CPU's `composeTRS` keeps an f64 interior, so
device matrices are a *documented tolerance class*, not a bit-exact
port — these bytes drive a renderer, not a seed chain. Measured against
`composeTRS` over a dense 4096-instance sample: the translation column
is byte-identical always (it is a straight copy of `P`), the constant
rows are exact (3/7/11 = 0, 15 = 1), a spawner with no `rot`/`scale`
attribute is **bit-exact** end to end (the compiled-in identity makes
every product exact in f32), and basis deviation stays ≤ 1e-6 absolute
and ≤ 5e-8 of the basis range (measured 1.70e-8) with over 70% of the
sample still bit-equal. On one device, the same graph composes
byte-identical transforms twice.

What that does **not** weaken: anything outside these matrices. Seeds,
hash streams, and every CPU golden are untouched, and the CPU spawner's
goldens still pin `composeTRS`. A spawner writes no attribute, so
nothing the compose kernel produces ever re-enters the graph: the
handle leaves the cook and goes to the renderer, never into a seed, an
index, or a subsequent cook. What it *does* mean: if you need matrices
that match the CPU bit for bit, do not turn `deviceInstances` on.

See it live: [`examples/09-gpu-world`](./examples/09-gpu-world) streams
a `World` whose cells render from instance matrices that never touch
the CPU, showing the binding's live handle count and the evaluator
pool's own detached-buffer accounting side by side — an independent
second opinion on the lifetime story above. For the multi-asset shape,
[`examples/02-forest`](./examples/02-forest) spawns with
`assetAttr: "species"` and toggles between the CPU and device-resident
paths, reporting the batch count and the fusion depth it actually
achieves (one member — the spawn — for the reason above).

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

The `examples/` directory contains nine vite multi-page demos (scatter
with density noise, forest instancing, spline sampling, infinite
streaming world, field composition playground, a registry-driven
node-graph editor, an infinite deterministic spiral galaxy with
click-to-visit star systems, a million-point WebGPU cook comparing
CPU, per-node GPU, and one fused device-resident run, and a streamed
world drawing from device-resident instance transforms):

```sh
npm run examples
```

## Development

```sh
npm test          # vitest: unit + integration + determinism suites
npm run build     # tsup: dist/ with subpath exports ".", "./three", "./gpu"
npm run check     # tsc --noEmit
npm run examples  # vite dev server for examples/
npm run docs:nodes  # regenerate docs/nodes.{md,json} from the registry
```

## License

MIT
