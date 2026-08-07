# Authoring graphs

How to author pcg-ts graphs as JSON (the interchange format used by
`serializeGraph` / `deserializeGraph`) and in code. Node-by-node schemas
live in [nodes.md](./nodes.md) (generated; machine-readable twin:
[nodes.json](./nodes.json)); at runtime the same metadata comes from
`listNodeTypes()`. For authoring this format interactively, the
`06-graph-editor` example (`npm run examples`) is a node editor built on
the same metadata: registry palette (grouped by node `category`),
connections checked by the live graph's validation, schema-driven param
forms, live cook, JSON import/export, and in-place edits through the
mutation API (see [Editing live graphs](#editing-live-graphs)).

## The graph JSON format

A serialized graph is one JSON object (`SerializedGraph`):

```json
{
  "formatVersion": 1,
  "seed": 42,
  "nodes": [ { "id": "scatter", "type": "pointScatterInBounds", "params": {} } ],
  "connections": [],
  "outputs": [ { "id": "scatter", "pin": "out", "name": "points" } ]
}
```

| Field | Meaning |
| --- | --- |
| `formatVersion` | Always `1`. Other values are rejected with the supported version named. |
| `seed` | Graph seed (finite number, used as u32). Every node's seed is `hashCombine(seed, hashString(nodeId))`. |
| `nodes` | Node instances. `id` must be unique and non-empty; `type` must be a registered node type; `params` maps param names to values. Omitted params take their schema defaults. A `subgraph` node additionally carries a `subgraph` payload (below). |
| `connections` | Directed edges `from: [nodeId, outputPin]` to `to: [nodeId, inputPin]`. Pin kinds must be compatible (`any` matches everything); an input pin accepts one connection unless declared `multi`; cycles are rejected. |
| `outputs` | Declared terminal outputs. Cooking pulls from these (and cooks only what they reach); `name` keys the collection in `CookResult.outputs`. |

### Validation behavior

`deserializeGraph` validates everything before building, and every error
names the node id, param, or pin at fault and states what would be
valid:

- unknown node type → error listing all registered type names
- unknown param → error listing the type's valid params
- wrong param value → expected type/enum/bounds and the offending value
- unknown connection endpoint or pin → error listing known nodes / valid pins
- kind mismatch, occupied single pin, or cycle → the specific edge named

`serializeGraph` enforces the same schemas on the way out, and requires
every node to be a registered type (`standardNode`). Field-valued params
serialize whether the field was built by `fieldFromJson` or composed
from the combinator API — a combinator field derives its spec from its
arguments. The exceptions are a field built by `makeField` (an
arbitrary closure that nothing can describe), any field composed over
one, and a tree nested deeper than the spec depth limit; `fieldToJson`
throws an actionable error naming which of those it hit.

Numbers must be finite. A field-capable vec3/vec4 param set to a plain
scalar is canonicalized to the full tuple on serialization (broadcast
semantics keep the cooked output identical).

### Subgraph and dataInput serialization

Serialization is complete — two node types have special shapes:

- A `subgraph` node (built with `subgraphNode`) serializes with empty
  `params` plus a `subgraph: { graph, inputs, outputs }` payload: the
  inner graph recursively in this same format, and the exposed pin
  mappings as `{ name, node, pin }` (pin name on the wrapper, inner node
  id, inner pin). Deserialization rebuilds the inner graph and re-wraps
  it through `subgraphNode`, so nested subgraphs round-trip and cook
  byte-identically.
- A `dataInput` node serializes with `items: []`: live `DataItems` are
  runtime-injected (via `graph.setParam` or a `World` bind), never
  embedded in JSON. After deserializing, re-bind the items before
  cooking.

## The field-expression grammar

Field-capable params (marked "Field" in [nodes.md](./nodes.md), or
`acceptsField: true` in the schemas) accept a declarative spec instead
of a constant: `{ "fn": <name>, ... }`. Wherever a spec takes arguments
(`args` entries, noise `position`), a finite number or number array is
also accepted and wraps into `constant`. Specs nest arbitrarily (up to
256 levels). `listFieldFns()` returns all 40 names at runtime.

### Inputs

| fn | Spec | Result |
| --- | --- | --- |
| `constant` | `{ fn, value: 1 \| [1, 2, 3] }` | Same scalar/tuple for every element |
| `attribute` | `{ fn, name: "density", tupleSize?: 1 }` | Reads a numeric attribute of the target domain (string attributes are not readable as fields; `tupleSize`, when given, must match) |
| `position` | `{ fn }` | The `P` attribute (f32, tuple 3) |
| `index` | `{ fn }` | Element index 0, 1, 2, ... |
| `randomField` | `{ fn, key?: 0 \| "salt" }` | Per-element deterministic random in [0, 1) from (context seed, key, index) |

### Elementwise combinators

All take `args` with an exact arity. Scalars (tuple 1) broadcast against
any tuple size; other tuple sizes must match. Math runs in f64, results
store as f32.

| Arity | fns |
| --- | --- |
| 1 | `abs`, `floor`, `length` (tuple → scalar Euclidean length), `normalize` (zero tuples stay zero), and trig `sin`, `cos`, `tan`, `asin`, `acos`, `atan` (radians, elementwise) |
| 2 | `add`, `sub`, `mul`, `div`, `min`, `max`, `dot` (tuple → scalar), `atan2` (args `[y, x]`, radians), and comparisons `lt`, `le`, `gt`, `ge`, `eq` emitting 1/0 |
| 3 | `clamp` (x, lo, hi), `lerp` (a, b, t), `select` (cond, a, b — cond non-zero picks a) |
| 5 | `remap` (x, inMin, inMax, outMin, outMax — linear, unclamped; degenerate input range yields outMin) |

### Structure

| fn | Spec | Notes |
| --- | --- | --- |
| `vec` | `{ fn, args: [x, y, z] }` | 1+ args; concatenates all components into one tuple |
| `component` | `{ fn, args: [tupleField], index: 0 }` | Extracts one component as a scalar; `index` is a non-negative integer < tuple size |
| `ramp` | `{ fn, args: [scalarField], stops: [[0, 0], [1, 1]] }` | Piecewise-linear curve through `[position, value]` stops; positions strictly ascending; input clamps to the end values |

### Noise

Scalar fields sampled at a position (default: the `P` attribute). Noise
is a pure function of its own `seed` option and the sample position —
the evaluation-context seed does not affect it, so identical specs give
identical values on any domain.

Common `opts`: `seed?` (integer, default 0), `frequency?` (position
scale, default 1), `offset?` (`[x, y, z]` added after scaling),
`position?` (a nested spec, tuple 3), `normalized?` (boolean, default
false).

| fn | Extra opts | Raw output range |
| --- | --- | --- |
| `valueNoise` | — | [0, 1) |
| `perlinNoise` | — | approximately [-1, 1] |
| `simplexNoise` | — | approximately [-1, 1] |
| `worleyNoise` | `output?: "f1" \| "f2" \| "f2-f1"`, `exact?: false` | f1 in [0, ~1.73); f2 >= f1 |
| `fbm` | `base` (required: one of the four noise fn names), `octaves?: 4`, `lacunarity?: 2`, `gain?: 0.5` | Sum is not renormalized: grows toward `baseRange * (1 - gain^octaves) / (1 - gain)` |

`normalized: true` affinely remaps the noise's documented raw range to
exactly [0, 1] — so a wrapper like
`{ "fn": "remap", "args": [<noise>, -1, 1, 0, 1] }` collapses to the
noise spec itself, with fbm's configuration-dependent range handled for
you. The raw ranges are machine-readable: `NOISE_RAW_RANGES` per noise
type, `noiseOutputRange(field)` per field instance (fbm-aware; returns
the normalized or raw range as built). `exact: true` on worley widens
the cell search until provably exhaustive — slower, for when the fast
approximation's rare wrong-neighbor artifacts matter.

## Recipes

### 1. Scatter thinned by density noise (pure JSON)

Scatter uniformly, write a `density` attribute from remapped fractal
noise, then keep each point with probability equal to its density:

```json
{
  "formatVersion": 1,
  "seed": 7,
  "nodes": [
    { "id": "scatter", "type": "pointScatterInBounds",
      "params": { "count": 2000, "boundsMin": [0, 0, 0], "boundsMax": [100, 0, 100] } },
    { "id": "density", "type": "setAttribute",
      "params": {
        "name": "density", "domain": "point", "type": "f32", "tupleSize": 1,
        "value": { "fn": "clamp", "args": [
          { "fn": "remap", "args": [
            { "fn": "fbm", "base": "perlinNoise", "opts": { "frequency": 0.03, "octaves": 4 } },
            -1, 1, 0, 1 ] },
          0, 1 ] }
      } },
    { "id": "keep", "type": "filterByDensity", "params": { "mode": "probabilistic" } }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["density", "in"] },
    { "from": ["density", "out"], "to": ["keep", "in"] }
  ],
  "outputs": [ { "id": "keep", "pin": "out", "name": "points" } ]
}
```

The survivor count follows the noise (about half here); the same seed
always keeps exactly the same points. The `clamp(remap(...))` wrapper
predates normalized noise — `{ "fn": "fbm", "base": "perlinNoise",
"opts": { "frequency": 0.03, "octaves": 4, "normalized": true } }` is
already in [0, 1] on its own.

### 2. Attribute pipeline: noise-driven instance scale (pure JSON)

Write the standard `scale` attribute (f32, tuple 3) from a scalar noise
field — scalars broadcast across the tuple, so every axis scales
uniformly — then spawn instance batches whose transforms bake it in:

```json
{
  "formatVersion": 1,
  "seed": 3,
  "nodes": [
    { "id": "grid", "type": "pointGrid",
      "params": { "countX": 20, "countZ": 20, "spacing": [2, 2, 2] } },
    { "id": "size", "type": "setAttribute",
      "params": {
        "name": "scale", "domain": "point", "type": "f32", "tupleSize": 3,
        "value": { "fn": "remap", "args": [
          { "fn": "perlinNoise", "opts": { "frequency": 0.1 } }, -1, 1, 0.5, 1.5 ] }
      } },
    { "id": "spawn", "type": "spawnInstances", "params": { "assetId": "bush" } }
  ],
  "connections": [
    { "from": ["grid", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [ { "id": "spawn", "pin": "instances", "name": "instances" } ]
}
```

The `instances` output holds one instances item; each instance's 4x4
transform composes `T(P) * R(rot) * S(scale)`. Swap `setAttribute` to
write `rot` (tuple 4, quaternion xyzw) or `color` the same way.

### 3. Subgraph composition (code)

Wrap a reusable cluster graph as a single node with `subgraphNode`,
exposing chosen inner pins. The inner graph keeps its own caches across
outer cooks:

```ts
import {
  Graph, cook, subgraphNode,
  pointScatterInBounds, jitterPoints, spawnInstances,
} from "pcg-ts";

// Inner graph: a jittered cluster of 50 points.
const inner = new Graph();
const scatter = inner.add(pointScatterInBounds, { count: 50 });
const jitter = inner.add(jitterPoints, { amount: [0.5, 0, 0.5] });
inner.connect(scatter, "out", jitter, "in");

// Expose jitter.out as the node's "out" pin (no exposed inputs here).
const clusterDef = subgraphNode(inner, [], [
  { name: "out", node: jitter, pin: "out" },
]);

const outer = new Graph(99);
const cluster = outer.add(clusterDef);
const spawn = outer.add(spawnInstances, { assetId: "tree" });
outer.connect(cluster, "out", spawn, "in");
outer.output(spawn, "instances", "instances");
const result = await cook(outer);
```

Exposed inputs work the same way with input pins:
`subgraphNode(inner, [{ name: "in", node: someInnerNode, pin: "in" }], ...)`
adds an outer input pin wired into the inner node. The inner graph's
seed derives from the outer node's seed, so two instances of a subgraph
produce different (but reproducible) content. Graphs containing
subgraph nodes serialize like any other: the inner graph rides along as
a nested `subgraph` payload (see above), recursively, and
`getSubgraphSpec(def)` exposes a node definition's inner graph and pin
mappings for inspection.

### 4. Multi-asset spawn: per-point species (pure JSON)

A string `setAttribute` keeps multi-asset spawns declarative: with
`type: "string"` and a non-empty `values` list, the field-capable
`value` acts as a per-element selector into the list. Point
`spawnInstances`' `assetAttr` at the attribute and the output splits
into one batch per asset id:

```json
{
  "formatVersion": 1,
  "seed": 11,
  "nodes": [
    { "id": "scatter", "type": "pointScatterInBounds",
      "params": { "count": 800, "boundsMin": [0, 0, 0], "boundsMax": [60, 0, 60] } },
    { "id": "species", "type": "setAttribute",
      "params": {
        "name": "species", "domain": "point", "type": "string",
        "values": ["pine", "pine", "birch", "bush"],
        "value": { "fn": "mul", "args": [ { "fn": "randomField", "key": "species" }, 4 ] }
      } },
    { "id": "spawn", "type": "spawnInstances",
      "params": { "assetId": "pine", "assetAttr": "species" } }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["species", "in"] },
    { "from": ["species", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [ { "id": "spawn", "pin": "instances", "name": "instances" } ]
}
```

The selector is total: floor(selector), then clamp into
`[0, values.length - 1]`, NaN picks 0 — weighting by repetition works
(50% pine here) and an out-of-range value never throws per element.
Batches form in first-occurrence order of each asset id; an
empty-string entry never names an asset — those points fall back to the
spawner's `assetId`. With `values` empty, the constant `stringValue`
param is written instead.

Since v0.8.0 `assetAttr` no longer costs you the device-resident path:
the spawner composes one transform buffer per asset on the GPU, in the
same batch order the CPU path produces. What the *string*
`setAttribute` above does cost is fusion depth — it is not resident, so
it ends the chain and the run around the spawner holds only the
spawner. See
[Device-resident instancing](#device-resident-instancing-drawing-without-a-readback).

## Editing live graphs

JSON is the interchange format, not the only way to change a graph. A
tool that keeps one live `Graph` (as the `06-graph-editor` example does)
edits it in place with the mutation API and reads it back with the
introspection API — preserving node caches that a rebuild through
`deserializeGraph` would discard:

- `removeNode(handle)` removes the node plus every connection touching
  it and every output declared on it, in one version bump. On the next
  cook, former downstream nodes recook; untouched branches serve their
  caches. Removing a subgraph *instance* leaves its def and inner graph
  intact for other instances.
- `disconnect(from, pin, to, pin)` removes one matching connection and
  returns whether one existed. Unknown nodes or pins throw (naming the
  offender, listing valid pins); a missing connection between valid
  endpoints returns `false` and bumps nothing.
- `removeOutput(name)` undeclares a terminal output (unknown names
  throw, listing what is declared). Node caches are untouched — an
  output changes what a cook pulls, not any memo key — so the next cook
  serves every unchanged node from cache.
- `describe()` returns a frozen structural snapshot: nodes (`id`,
  derived `seed`, `defType`), connections, and declared outputs, in
  insertion order. `getParams(handle)` returns a frozen shallow copy of
  a node's current params — nested values by reference, so treat them
  as frozen and change params only through `setParam`. Neither offers a
  mutation path that bypasses the graph's version counter.
- `describeSubgraphPins(def)` resolves a subgraph def's per-instance
  pins — exposed name plus the concrete kind of the inner pin, through
  nested subgraphs — live from the recorded spec; `undefined` for
  non-subgraph defs.

When to mutate vs rebuild: mutate while a live graph is being edited and
warm caches matter (tweaking one branch of an expensive graph must not
recook its siblings); rebuild through `serializeGraph` /
`deserializeGraph` when loading a document or handing a graph across a
boundary — a rebuilt graph is fully validated but starts with cold
caches. The two stay consistent: after any mutation,
`serializeGraph(graph)` reflects the current structure and round-trips.

## Transfer mappings

`transferAttribute` copies an attribute from a second geometry (its
`source` input) onto the main input's points. The `mapping` param picks
how each destination point finds its source value:

| mapping | Source needs | Use when | A point misses when |
| --- | --- | --- | --- |
| `nearest` (default) | any points | Both sides live in the same 3D space; closest source point (ties → lowest index) is the right answer | never |
| `uv` | triangle mesh + UVs | The geometries share a UV parameterization but not a position — transfer between differently tessellated meshes, or read texture-space data | its UV lies in no source triangle |
| `raycast` | triangle mesh | The value should come from a surface along a spatial direction — drape scattered points onto the terrain below, probe walls sideways | its ray hits nothing (or nothing within `maxDistance`) |

For `uv`, destination UVs are read from the point-domain `uvAttr` (f32,
tupleSize ≥ 2); source UVs come from the vertex domain when present
(per-corner, seam-correct) and fall back to the point domain. For
`raycast`, rays start at each point along the constant `direction` — or
a per-point `directionAttr` — normalized, forward-only, nearest hit;
exactly tied hit distances (like a UV on a shared edge) resolve to the
lowest source primitive index.

The policies both mesh mappings share:

- **Interpolation by type.** `f32` attributes interpolate
  barycentrically; `i32`/`u32`/`bool`/`string` cannot, so they take the
  value at the triangle corner with the largest barycentric weight
  (ties → the first such corner in vertex order). `attrDomain:
  "vertex"` reads per-corner source values (seam-accurate) instead of
  point values; the result always lands on the destination's point
  domain.
- **The miss contract.** A missed point keeps the value it already had
  (the attribute default if the attribute is newly created) — it is
  never invented. Name a `missCountAttr` and the node writes the miss
  total into a u32 detail attribute so a graph can assert on it;
  `nearest` assigns every point and always reports 0.
- **Determinism.** Degenerate triangles are skipped, tie-breaks are by
  lowest index, and the acceleration grids are provably result-neutral;
  the epsilon policy is exported (`TRANSFER_BARY_EPS`,
  `TRANSFER_AREA_EPS`, `TRANSFER_DET_EPS`, `TRANSFER_BOX_PAD_REL`).

The node covers the common cases; the data-layer functions
(`transferNearest`, `transferUv`, `transferRaycast`) additionally
accept a `cellSize` grid hint (lookup cost only — never results), and
`transferUv` a `uvDomain` override forcing the source UV domain.

## Staged pipelines (per-output cooking)

`cook(graph, { outputs: ["name"] })` cooks only the named declared
outputs: the pass visits just their upstream nodes, and the result
contains exactly those names. Nodes outside the selection are neither
cooked nor invalidated, so a later cook of the other outputs reuses
every shared upstream result from the memo cache.

One graph therefore suffices for staged pipelines that used to need
two: cook an early output, let application code derive data from it and
bind the result into a `dataInput`, then cook the terminal output — a
still-unbound terminal branch is simply never pulled by the first cook:

```ts
const stage1 = await cook(graph, { outputs: ["samples"] });
graph.setParam(input, "items", deriveItems(stage1.outputs.samples));
const stage2 = await cook(graph, { outputs: ["instances"] }); // shared upstream cached
```

In a `World`, `LevelDef.cookOutputs` applies the same selection per
cell: the level cooks and stores only those outputs (names are
validated against the graph's declared outputs at World construction).

## Per-cell seeding

A `World` cooks one graph per cell of each level, and the level's
`bind` callback is the only channel through which cell data enters the
graph (see `LevelDef`). Two sanctioned, deterministic ways to vary
content per cell, both driven by `ctx.seed`:

**Seed params.** Wire `ctx.seed` into each stochastic node's `seed`
param, varying per node with `hashCombine`:

```ts
bind(g, ctx) {
  g.setParam(scatter, "seed", ctx.seed);
  g.setParam(species, "seed", hashCombine(ctx.seed, 1));
}
```

`setAttribute`'s `seed` param reseeds its `value` field evaluation
(`randomField` streams included): 0 — the default — keeps the node's
derived seed untouched, so graphs authored without it cook bit-identically;
any nonzero value folds in via `hashCombine(nodeSeed, seed)`.

**Whole-graph reseed.** Calling `graph.setSeed(...)` inside `bind` is a
supported pattern. Every node's seed derives from the graph seed
(`hashCombine(graphSeed, hashString(nodeId))`), node memo keys include
it, and the runtime counts bind-time writes (`setSeed` and `setParam`
alike) as its own, so reseeding causes no phantom invalidation:

```ts
bind(g, ctx) {
  g.setSeed(hashCombine(ctx.seed, 7));
}
```

Either way, cell content stays a pure function of (world seed, level,
coord, graph, parent content) — independent of cook order, viewpoint
path, and eviction history. `ctx.seed` hashes every cell coordinate:
`hashCombine(worldSeed, levelIndex, cx, cz)` for a 2D cell,
`hashCombine(worldSeed, levelIndex, cx, cy, cz)` for a 3D one.

## 3D cells (cellMode)

Levels default to 2D cells on the XZ plane (`cellMode: "xz"`): square
cells, unbounded in Y, addressed `[cx, cz]`. Set `cellMode: "xyz"` on a
level for cube cells addressed `[cx, cy, cz]` — the generation/retain
radii then measure full XYZ distance from the viewpoint, and the
per-cell seed hashes all three coordinates. `CellContext` is a
discriminated union on `cellMode`, so `bind` narrows to the right
coord/bounds shape:

```ts
bind(g, ctx) {
  if (ctx.cellMode === "xyz") {
    // ctx.coord is [cx, cy, cz]; ctx.min/max are [x, y, z]
    g.setParam(fill, "boundsMin", [...ctx.min]);
    g.setParam(fill, "boundsMax", [...ctx.max]);
  }
  g.setParam(fill, "seed", ctx.seed);
}
```

Nesting rules (the parent is the level above):

- like under like: the parent is the cell containing this cell's center;
- `"xyz"` under `"xz"`: the parent is the containing XZ column cell;
- `"xz"` under a bounded `"xyz"` parent is rejected at World
  construction — a 2D column spans every Y layer of the parent, so no
  single parent cell contains it (make the parent `"xz"` or the child
  `"xyz"`);
- an unbounded parent (one global cell) accepts either mode below it.

An unbounded level (`cellSize: "unbounded"`, first level only) needs no
`generationRadius`; omit it — a value is accepted and ignored, so
configs written before it became optional keep working.

## GPU evaluation of field expressions (pcg-ts/gpu)

Every field expression written in the JSON grammar above is also the
GPU surface: `pcg-ts/gpu` compiles a FieldSpec to one WGSL compute
kernel and evaluates it over a whole domain in one dispatch. Chains of
fusable nodes go one step further and cook as a single device-resident
run. Nothing about authoring changes — the same spec cooks on either
path — but the rules below decide which path actually runs.

### Wiring a resolver into a cook

```ts
import { cook } from "pcg-ts";
import { GpuFieldEvaluator } from "pcg-ts/gpu";

// Browser
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const device = await adapter.requestDevice();
const gpu = new GpuFieldEvaluator(device, { adapterInfo: adapter.info });

const result = await cook(graph, { gpu });     // graph path
// World: WorldOptions.gpu, or world.update(vp, { gpu }) — update wins
// Graph-free: await captureAsync(geo, "point", field, seed, gpu)
console.log(result.stats.gpu);
```

In Node install the `webgpu` package (Dawn bindings) as a dev
dependency and obtain the adapter with
`import { create } from "webgpu"; const adapter = await create([]).requestAdapter()`.
The library itself never imports WebGPU — the evaluator is typed
structurally, and core code sees only the `GpuFieldResolver` interface
(`{ cacheSalt, resolveField }`, expressed in core types).

### Eligibility — what runs on the GPU

A field-capable param resolves on the GPU exactly when all of these
hold; otherwise it falls back to the CPU with a machine-readable
reason in `CookStats.gpu.fallbacks`:

1. The field carries a serializable spec: it was built by
   `fieldFromJson` (JSON params always are; `getFieldSpec(field)` is
   the non-throwing probe). Hand-composed combinator fields have no
   spec → `no-spec`.
2. The spec compiles against the geometry's attribute layout: every
   `attribute` it reads exists on the domain, is numeric (bool reads
   compile; string attributes do not), and tuple sizes stay ≤ 4 with
   finite f32 constants → otherwise `compile-error` (the thrown
   compile diagnostics name the offending spec node; the cook just
   counts and falls back).
3. The kernel fits baseline WebGPU limits: at most 8 storage buffers —
   up to 7 distinct attribute inputs plus the output
   (`too-many-buffers`).

Element count is **not** a limit. A kernel covering more elements than
one `dispatchWorkgroups` call allows (`65535 × 64 ≈ 4.19M` at workgroup
size 64) splits into chunked dispatches whose output is byte-identical
to the unchunked one, so the old `dispatch-too-large` reason no longer
exists.

Those three reasons (`no-spec`, `compile-error`, `too-many-buffers`)
are the complete per-field vocabulary; fused runs add two more, below.
Node-level opt-out reasons (a `ResidentDesc.eligible` returning a
string) belong to the same vocabulary in principle, but the standard
node library declares none — v0.7's `spawn-asset-attr` was the only
one, and v0.8 retired it when `assetAttr` spawns became
device-resident.
Plain (non-Field) params never consult the resolver on the per-node
path — constants are cheaper on the CPU. Six nodes are GPU-adopting
(`NodeDef.gpu: "fields"`): `setAttribute`, `transformPoints`,
`jitterPoints`, `orientAlongVector`, `surfaceSample`, `volumeSample`.
Subgraph nodes forward the resolver to their inner cooks
(`NodeDef.gpu: "always"`), whose stats land in the outermost cook's
sink. A fallback is silent in the bytes — CPU output is what the GPU
path approximates — but never silent in the stats.

### Device-resident runs (fusion)

A resolver may implement two more methods, **both or neither** — the
executor fuses only when it finds both, so a resolver with just
`resolveField` gets exactly the per-node behavior and identical bytes:

```ts
planRun?(members: readonly ResidentMemberDesc[],
         ctx: ResidentRunContext,
         stats?: GpuCookStats): object | null;   // sync, device-free
executeRun?(plan: object,
            input: ResidentRunInput,
            stats?: GpuCookStats): Promise<ResidentRunResult>;
```

`planRun` returning `null` means "cannot fuse": the resolver counts the
reason and every member cooks per-node. The plan it returns is opaque
to the executor and handed back verbatim. `executeRun` **commits** —
its rejection is an error, never a silent fallback (except the standard
cancellation error when `input.signal` aborted) — and its `geo` must be
structurally indistinguishable from cooking the members sequentially:
same attribute set, shapes, defaults, insertion order, string tables
and topology, with untouched attributes passing through byte-identically.

`ResidentMemberDesc` is `{ id, type, kind, params, seed }` (`kind` from
the node def's `resident` descriptor; `seed` is exactly what the CPU
`execute` would have received). `ResidentRunContext` is
`{ attributes: Record<name, { type, tupleSize }>, count }`.

**What fuses.** Four *chain* kinds, all count-preserving with one
geometry input and one geometry output, plus one *terminal* kind:

| node | fuses when |
|---|---|
| `setAttribute` | numeric mode: `type` is not `"string"`, `domain` is `"point"`, `values` is empty, `stringValue` is empty |
| `transformPoints` | always |
| `jitterPoints` | always |
| `orientAlongVector` | always |
| `spawnInstances` | the resolver advertises the kind — with or without `assetAttr`, since v0.8.0; terminal only, and it declares no `eligible` gate; see [Device-resident instancing](#device-resident-instancing-drawing-without-a-readback) |

plus, for every member: every `Field` in its param tree carries a
serializable spec (`getFieldSpec`).

A terminal may be a run's *last* member and a chain never continues
through it. It is also the one place a run of length 1 still counts as
a run, because there the fused and per-node paths are not equivalent —
fusion is the only way to produce device-resident output at all.

**Where a run ends.** The executor takes *maximal linear chains* and
stops when the tail has anything other than exactly one outgoing
connection (counting connections to nodes outside this cook's
selection), when the tail carries a declared graph output, when the
consumer is outside the cooked selection, when the consumer is not
fusable, or when the consumer's incoming set is not exactly the tail. A
chain of length 1 is not a run, except for the lone-terminal case noted
above. Detection is deliberately conservative:
it under-fuses, never over-fuses. An interior node with external
consumers — a declared output, a multi-consumer tap, a non-fusable
downstream — becomes a run terminal with its own readback, so fusion
never changes which bytes the rest of the graph observes.

**Cache contract.** Only the terminal caches, under

```
run1|gpu:<cacheSalt>|i<first member's inputSig>|m[type|s<seed>|p<paramHash>|x<memoKey>]…
```

with one `m[...]` tuple per member in chain order. Interior members
hold **no** cache entry while fused (a stale per-node entry from an
earlier cook is cleared). Editing any member's params recooks exactly
that run and leaves siblings and upstream nodes cached. Run keys and
per-node keys (`<type>|s…`) cannot collide, so neither path ever serves
the other's bytes — but a node holds a *single* memo slot, so flipping
`gpu` on and off, or fusion on and off, recooks the chain every time.
That is by design, not a bug; benchmark from cold caches.

**Two more fallback reasons**, each counted once per rejected run
(after which every member cooks per-node):

- `run-plan-failed` — a member cannot be compiled into the resident
  pipeline: unknown resident kind, field compile error, tuple-size or
  layout mismatch, a missing standard attribute, over the
  storage-buffer limit. Genuinely invalid params still surface the
  identical CPU error from the per-node path.
- `run-too-large` — the run's working set exceeds the evaluator's
  `maxResidentBytes` (default 512 MiB). The working set is
  `Σ resident slot bytes over every epoch + Σ field-temporary column
  bytes + readback staging bytes`, in *logical* bytes: power-of-two
  pool bucketing can allocate up to 2×, and the 12-byte per-chunk
  uniforms are not counted. Field temporaries live for the whole run,
  not just their member, so an 8-member run holds 8 columns at once.

**Cost model.** A *constant* param — a plain number or number tuple —
costs a 16-byte uniform slot and no dispatch; only field-valued params
materialize an `n`-element column. In the `examples/08-gpu-fields`
chain (five members: `setAttribute` → `jitterPoints` →
`transformPoints` → `setAttribute` → `setAttribute`) that is 120 bytes
per point and 9 member kernels, down from 212 bytes and 12 kernels
before v0.6.1, when every constant cost a full column. A kernel
carries at most `MAX_APPLY_CONST_SLOTS` (4) constant slots.

Constant *values* live in the uniform and never in the generated WGSL:
the apply-kernel specialization key encodes only which params are
constant, their tuple sizes, and their slots. Editing a constant —
dragging a slider, animating a transform — therefore rebinds a uniform
and hits the pipeline cache, where baking values into the shader text
would recompile on every change.

**Third-party resident kinds.** `NodeDef.resident?: { kind: string;
eligible?(params): boolean | string; terminal?: boolean }` marks a node
fusable. `eligible` runs outside the executor's error wrapping: keep it
cheap, pure, and total — an exception thrown there escapes `cook()`
unwrapped rather than as a `NodeExecutionError`. Returning a non-empty
*string* means the same as `false` (the node does not fuse) but names
the reason, which the executor counts once per cook in
`CookStats.gpu.fallbacks` under exactly that key — use it for cases an
author can act on, and plain `false` for combinations that are simply
not the kind's business. `terminal: true` additionally permits output
pins beyond the single geometry one, and gates the node behind the
resolver's `residentTerminals` advertisement.

### Device-resident instancing (drawing without a readback)

A fused run ends with a readback so the CPU can see the result. If a
WebGPU renderer is what consumes that result, the readback is pure
waste: the instance matrices are already on the device it draws from.
Opting in makes a `spawnInstances` terminal compose every 4×4 on the
GPU and hand back *buffer handles* — one per asset — instead of
`Float32Array`s. Shipped in v0.7.0 for a constant `assetId`; since
v0.8.0 an `assetAttr`-driven multi-asset spawn is resident too.

**1. Share one device between the evaluator and the renderer.** This
is the load-bearing requirement, and it is a platform constraint rather
than a convenience: a `GPUBuffer` belongs to the device that created
it, two devices cannot share one, and a WebGL context cannot read a
WebGPU buffer at all. Create the device yourself and hand it to both.

```ts
import { GpuFieldEvaluator } from "pcg-ts/gpu";
import { createWebGpuInstanceAdapter, WorldThreeBinding } from "pcg-ts/three";
import { WebGPURenderer } from "three/webgpu";

const gpuAdapter = await navigator.gpu.requestAdapter();
if (!gpuAdapter) throw new Error("no WebGPU adapter");
const device = await gpuAdapter.requestDevice();

const renderer = new WebGPURenderer({ device });
await renderer.init();                    // must be initialized first

const gpu = new GpuFieldEvaluator(device, {
  adapterInfo: gpuAdapter.info,
  deviceInstances: true,                  // opt in
});
gpu.residentTerminals;                    // ["spawnInstances"]

const adapter = await createWebGpuInstanceAdapter({ renderer, assets });
```

`createWebGpuInstanceAdapter` is async because it imports `three/webgpu`
lazily — a WebGL app that merely imports `pcg-ts/three` pays nothing.
Batches whose handle carries any other backend are refused by name:
`... carries a "cpu" transforms handle, not "webgpu"; only a
GpuFieldEvaluator running on the renderer's own GPUDevice produces
bindable buffers`.

**2. Wire the binding.** `WorldThreeBinding` grows one option:

```ts
const binding = new WorldThreeBinding({
  group,
  assets,
  deviceInstances: {
    adapter,
    bounds: (levelName, coord) => cellSphere(levelName, coord),
  },
});
```

`bounds` supplies the bounding sphere out of band because a
device-resident batch has no CPU matrices to compute one from —
`InstancedMesh.computeBoundingSphere()` would read the empty array and
cull the cell away. Derive it from the cell AABB: its centre, and half
its diagonal plus the asset's radius so instances straddling the border
are not culled while still on screen. Return `undefined` and frustum
culling is switched *off* for that batch's object instead of guessed
(drawing too much is recoverable; culling visible geometry is not); an
unbounded level's infinite centre does the same. A non-finite or
negative radius throws rather than being clamped.

The full signature is `bounds(levelName, coord, assetId)` and it is
called **once per batch**, not once per cell. The third argument is what
a multi-asset cell needs: pad by the radius of *that* asset, because
with one sphere per cell every asset inherits the padding of the
tallest one — a cell holding both a 200-unit landmark and ground cover
would draw the ground cover with a 200-unit skirt and stop culling it
in practice. Ignoring the argument is fine and keeps the per-cell
behaviour; a two-parameter callback still type-checks and is simply
asked once per asset.

Omit `deviceInstances` while the cook still produces device batches and
the binding throws instead of rendering an empty cell, naming both
fixes: pass `deviceInstances: { adapter, bounds }`, or construct the
evaluator without `deviceInstances: true` to get CPU batches back.

**3. Read the output as device batches, never as `batches`.** The
terminal's `instances` pin carries an item whose `deviceBatches` holds
the payload — one entry per asset, in the batch order specified below.
Reading `.batches` on it **throws** on purpose, because the alternative
is a CPU consumer silently drawing nothing:

```ts
for (const item of outputs.instances) {
  if (item.kind !== "instances") continue;
  if (item.deviceBatches !== undefined) {         // or isDeviceResidentInstances(item)
    for (const batch of item.deviceBatches) {
      batch.residency;            // "device"
      batch.count;                // instances
      batch.transforms.byteLength; // count * 64
    }
  } else {
    // CPU path: item.batches, Float32Array transforms
  }
}
```

Check residency *first* — the residency probe is safe, the `batches`
read is not. Each `transforms` is an opaque `DeviceTransformsHandle`
(`backend`, `byteLength`, `disposed`, `resource`, `dispose()`), never a
typed array. Writing your own adapter?
`deviceTransformsBuffer(handle)` from `pcg-ts/gpu` is the one supported
way to get the buffer back; bind exactly `handle.byteLength` bytes from
offset 0, since the pool buckets allocations to powers of two and the
tail is uninitialized.

**4. Know what the run skips.** The run appends a compose-TRS kernel
writing one column-major 4×4 per point in exactly the `InstanceBatch`
layout, then transfers the composed buffers out of the evaluator's pool
— one buffer per asset, so a constant-`assetId` spawn yields one and an
`assetAttr` spawn yields as many as there are distinct asset ids on its
points. If
nothing in the cook reads the terminal's `points` pin — it is neither
connected nor a declared graph output — the run performs *no readback
at all*: no `mapAsync`, no staging buffer, no CPU copy of
`P`/`rot`/`scale`. That is the one case where the
`readbacksSaved === fusedNodes − residentRuns` identity does not hold;
such a run contributes its full member count. Declare or connect the
`points` output and the readback comes back, with both outputs
agreeing.

**5. Multi-asset spawns, and the order their batches arrive in.**
Since v0.8.0 an `assetAttr`-driven spawn is device-resident too; the
node declares no `eligible` gate and there is no node-level fallback
reason to count. There is also no device-side sort. No resident node
can produce a string attribute — `setAttribute`'s resident predicate
requires `type !== "string"` — so the asset key is a host column *by
construction*. The host plans the grouping with the same function the
CPU spawner (`buildInstanceBatches`) calls, uploads a permutation, and
the device composes once per asset: no atomics, no prefix sum, no
readback. Both paths therefore agree by construction rather than by
comparison, which is what makes the order safe to depend on:

- **Batch order is ascending first-occurrence point index** of each
  distinct *resolved* asset id. Not string-table order, not intern
  order, not lexicographic — a recook whose string table interned in a
  different order still produces the same batch order. Points
  `["b", "a", "b"]` give batches `["b", "a"]` with counts `[2, 1]`.
- **Within a batch, instances are in ascending original point index.**
  The grouping is a stable partition.
- **Key resolution** reads component 0 of the string attribute — only
  component 0, whatever the tuple size. An empty value (`""`) resolves
  to the spawner's `assetId` and *merges* into that batch rather than
  opening its own, including when another point carries the literal
  string equal to `assetId`; the merged batch sits at the first
  occurrence of either. An out-of-range string-table index resolves to
  `""` and merges the same way. The table-index → asset-id map is not
  injective, so never key a batch on a raw table index.
- **Zero points yields zero batches**, in constant mode as well as
  attribute mode. An asset present in the string table but on no point
  produces no batch: groups come from points, never from the table.

`assetAttr` naming a missing attribute, or one that is not a string
attribute, is still an error carrying the CPU spawner's exact message,
which names the attribute — and, in the missing-attribute form, also
lists the string point attributes that *are* present. The run planner
mirrors those two conditions and *rejects* — counting
`run-plan-failed` — rather than throwing, so the per-node path serves
and raises it. Exactly one copy of each message exists.

`stats.dispatches` counts the multi-asset compose once per asset: the
unit is (step, asset), not step. See
[Introspection](#introspection) for the full counter contract.

**6. The remaining boundary: a string `setAttribute` breaks the
chain.** `setAttribute` fuses in numeric point-domain mode only, so the
idiomatic way to *compute* an asset key — `type: "string"` with a
`values` list and a field-capable selector, the recipe earlier in this
document — is not resident, and the chain breaks there. Where it feeds
the spawner directly, as in that recipe and in `examples/02-forest`,
the run holds only the spawner: report fusion depth honestly — one
member, not four. Resident nodes sitting *between* the string write and
the spawn still fuse with it, so the depth is whatever survives
downstream of the break; the chain in *front* of the break fuses as its
own run. Making `setAttribute` resident in string
`values` mode is the recorded successor — and because the asset key
would then be device-produced, it is also the change that would finally
require the device-side counting sort this design avoids.

**Lifetime: who frees what, and when.** Each batch's buffer starts
pool-owned. `BufferPool.detach` moves them out on the run's very last
line, after the final cancellation check — one detach and one
`DeviceTransformsHandle` per asset — so every earlier failure path
still reclaims every buffer, and a transfer that fails partway disposes
each buffer exactly once. From that instant the *holder* owns them, and
nothing else in the library will ever free them — not the pool, not the
memo cache, not `GpuFieldEvaluator.dispose()`.

| stage | owner | frees it |
|---|---|---|
| during the run | evaluator's `BufferPool` | the run's `finally` |
| after `detach` | whoever holds the handle | `handle.dispose()` |
| delivered to a cook result | the cook's caller | — |
| retained by `WorldThreeBinding` | the binding | at the last release |

- **The graph delivers but never owns.** A terminal that produced
  device batches writes a *volatile* cache entry: it feeds this cook's
  consumers and is then refused by the cache-hit path, so a
  device-resident spawner recooks every cook and yields a fresh handle.
  Memoizing one would pin GPU memory for the graph's lifetime and hand
  the same handle to a second owner. A handle that no delivered
  collection carries — or one from a cook that threw or was cancelled —
  is disposed by the cook rather than stranded.
- **`WorldThreeBinding` is the owner of last resort.** It
  reference-counts handles **by identity** and disposes only at the
  last release, across four paths: eviction, recook (new handles are
  retained before old ones are released, so a handle common to both
  survives the swap), a partial build failure (the whole cell's handles
  are retained up front and released in the catch), and
  `binding.dispose()`. Identity counting is load-bearing: a child cell
  that forwards its parent's outputs holds the *same handle object*, so
  the parent evicting first must not destroy a buffer the live child
  still draws from. Either eviction order is safe.
- **The adapter never disposes a handle.** It owns the `InstancedMesh`
  and its attribute only; `adapter.release(object)` frees those without
  destroying the adopted buffer.
- **Double dispose is a no-op**, never a double free. Reading
  `resource` after dispose throws rather than handing out a destroyed
  buffer.
- **Leaks stay visible.** An un-disposed handle keeps counting in
  `evaluator.poolStats` (`detachedBuffers`, `detachedBytes`, cumulative
  `buffersDetached`); the binding reports the same population from its
  own side as `binding.deviceHandleCount` and
  `binding.deviceHandleBytes` — since v0.8 one handle per *batch*, i.e.
  per asset in a cell, rather than one per cell; both count *distinct*
  handles, so one shared across cells still counts once — and the
  adapter's `stats` gives
  `{ built, released, adopted, liveInstances }`. Over a sustained
  fly-through those numbers must reach a steady state rather than
  climbing. It is the *counts* that track each other: pool bytes are
  power-of-two bucket sizes while binding bytes are the logical
  `count * 64` payload, so the two byte totals differ by design.
- **Read `deviceHandleBytes` as a leak meter, not as VRAM.** It is a
  lower bound on device occupancy and, since v0.8, a loose one. The
  pool buckets to the next power of two with a 256-byte floor, and a
  multi-asset spawn takes one buffer per asset, so a cell with four
  small batches pays four roundings where it used to pay one: a
  3-instance batch is 192 logical bytes in a 256-byte bucket, and a
  20-instance batch is 1280 in 2048. With many small per-asset batches
  the gap is structural, not incidental. What stays exact is the
  property the meter exists for — retained bytes returning to zero and
  staying bounded over a fly-through.

**The three version this depends on.** three publishes no supported way
to render from a `GPUBuffer` you already own; left alone it allocates
its own and uploads the attribute's (empty) array over the top. The
adapter therefore seeds three's WebGPU backend attribute record
(`renderer.backend.get(attribute).buffer`) so that three's own creation
and upload become a no-op. That is an internal, so the peer range is
pinned to `three@^0.185.1` and verified against `0.185.1`.

`checkAdoptionSeam(renderer, makeAttribute)`, exported from
`pcg-ts/three`, is the guard that pins the seam: it seeds a sentinel on
a throwaway attribute, lets three's own creation path run over it, and
verifies the sentinel survived untouched.
`createWebGpuInstanceAdapter` runs it at *construction*, so a moved
internal fails at startup instead of drawing wrong matrices at frame
time — and it fails with the fix spelled out rather than degrading
silently:

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
throughout, where the CPU's `composeTRS` keeps an f64 interior. Device
matrices are therefore a *documented tolerance class*, not a bit-exact
port — a deliberate exception, justified by these bytes driving a
renderer rather than a seed chain. Measured against `composeTRS` over
4096 instances:

| quantity | result |
|---|---|
| translation column (elements 12–14) | byte-identical always (a straight copy of `P`) |
| pad rows (3, 7, 11 = 0; 15 = 1) | exact |
| no `rot`/`scale` attribute present | **bit-exact** end to end (compiled-in identity/one) |
| basis, full TRS | ≤ 1e-6 absolute, ≤ 5e-8 of the basis range (measured 1.70e-8) |
| `rot` present, `scale` absent | max \|cpu − gpu\| = 1.19e-7 |
| repeated cooks, one device | byte-identical |

What this does **not** weaken: everything else. The determinism suites
pin the CPU path, the CPU spawner's `composeTRS` goldens are unchanged,
and seed and hash streams are untouched. A spawner writes no attribute,
so nothing the compose kernel produces re-enters the graph — the handle
leaves the cook and goes to the renderer, never into a seed, an index,
or a later cook. What it *does* mean: if you need instance matrices
that match the CPU bit for bit, leave `deviceInstances` off.

`examples/09-gpu-world` is the worked end-to-end version of all of the
above: a streamed `World` whose cells draw from matrices that never
touch the CPU, with the binding's handle accounting and the evaluator
pool's detached-buffer counters shown side by side.
`examples/02-forest` is the multi-asset version — `assetAttr: "species"`
on the device-resident path, with a CPU/resident toggle, the per-asset
batch count, and a fusion readout that does not overstate depth.

### Cache provenance

GPU floats are not byte-identical to CPU floats, so when a cook has a
resolver and a node would resolve a live spec'd Field param on device,
that node's memo key gains `|gpu:<cacheSalt>` — the evaluator's salt is
`"gpu2|<vendor>|<architecture>|<device>|<description>"`. Toggling gpu
on or off (or switching devices) therefore never serves bytes produced
by the other path, while nodes without live spec'd field params keep
their cache hits across the toggle. The marker is conservative: a
spec'd-but-ineligible field also gains it (over-invalidation, bytes
still CPU-identical). Fused runs fold the same salt into the run key
shown above. Compiled pipelines cache on the evaluator instance and
persist across cooks. In a `World`, toggling gpu between updates does
not by itself recook stored cells; provenance applies whenever a cell
actually recooks.

### Determinism contract and measured budgets

The CPU is the bit-exact reference: goldens are CPU-produced and never
move. On the GPU, u32 hash/random streams (`randomField`, noise
lattice hashing), `index`, integer attribute roots, bool→f32 reads,
hash+compare+select trees, and f32 add/sub/mul, clamp/min/max, floor,
select/compares are bit-exact ports. One device is run-to-run
byte-identical. Everything else matches within measured per-op-family
budgets, in range-ULP units — |cpu−gpu| / (2⁻²³ · max|cpu|), i.e. ULPs
at the top of the family's output range (raw max-ULP is misleading at
output zero-crossings, where the CPU's f64 interior survives
cancellation that f32 cannot). Measured on discrete desktop hardware
(D3D12/Dawn) over 10 000 dense hash-derived inputs; budgets are the
measured values rounded up minimally, and a different adapter may
exceed them:

| family | measured rangeUlp | budget |
|---|---|---|
| arith add/sub/mul | 0 | bit-exact |
| clamp/min/max, floor, select/compare | 0 | bit-exact |
| div | 0.76 | 1 |
| lerp | 0.50 | 1 |
| remap | 0.00 | 1 |
| ramp (multi-stop) | 1.09 | 2 |
| dot | 0.70 | 1 |
| length/normalize (incl. sqrt) | 1.50 | 2 |
| sin/cos over [−8, 8] | 6.50 | 8 |
| tan over [−1.45, 1.45] | 19.48 | 24 |
| asin over [−0.9, 0.9] | 503.99 | 512 |
| acos over [−0.9, 0.9] | 359.09 | 384 |
| atan | 67.06 | 80 |
| atan2 | 64.52 | 80 |
| valueNoise raw / normalized | 6.53 / 6.53 | 8 / 8 |
| perlinNoise raw / normalized | 7.69 / 4.21 | 10 / 6 |
| simplexNoise raw / normalized | 17.46 / 8.55 | 24 / 12 |
| worley f1 / f2 | 5.16 / 4.71 | 8 / 8 |
| worley f2−f1 normalized / exact f2−f1 | 9.42 / 9.28 | 12 / 12 |
| fbm value / perlin / simplex / worley | 4.32 / 4.84 / 19.02 / 4.81 | 6 / 6 / 24 / 6 |
| composite (ramp∘perlin × (random+attr)) | 9.77 | 12 |

asin/acos absolute error is ≈ 6.7e-5 — the WGSL-specified
absolute-error class for those builtins. Branchy ops (select,
compares, ramp segments, worley cell walks) may flip at knife-edge
inputs whose operands differ within tolerance.

The field-driven point ops carry their own measured budgets (same
adapter, 10k/8k points, perlin-normalized params):

| node (noise-driven param) | measured | budget |
|---|---|---|
| transformPoints (translate) | rangeUlp 0.92 | 2 |
| jitterPoints (amount) | rangeUlp 0.93 | 2 |
| volumeSample (jitter) | rangeUlp 0.50 | 1 |
| orientAlongVector (direction) | min quat dot 0.999999933 | ≥ 0.9999999 |
| surfaceSample (density) | accept-set symDiff 0 / 4096 | ≤ 8 |

Fused runs compose those errors and are budgeted as whole chains. Over
17 device chains of 2–8 members:

| chain | quantity | measured | budget |
|---|---|---|---|
| noise → orient → transform → jitter | P | rangeUlp 4.83 | ≤ 6 |
| | perlin-normalized attr | rangeUlp 4.27 | ≤ 6 |
| | rot | min quat dot 0.99999957 | ≥ 0.9999995 |
| transform → orient → length | P / h | rangeUlp 1.69 / 1.71 | ≤ 3 |
| orient → transform | P | rangeUlp 1.33 | ≤ 3 |

Twelve of those 17 chains are **byte-identical** to the CPU, which is
engineered rather than incidental: they use power-of-two jitter
amounts and identity-euler / power-of-two transform scales, so every
f32 step is exact and the single store is the only rounding. Two
things break that. `jitterPoints` rounds twice on the GPU (product,
then accumulate) where the CPU rounds once, so bit-exactness holds only
for power-of-two amounts; and any rotation built by `quatFromBasis`
(`orientAlongVector`, and `transformPoints` composing an existing
`rot`) lands in the budgeted class by construction.

**Every budget on this page was measured on one adapter** (discrete
desktop, D3D12/Dawn) and is the measured value rounded up minimally.
Another adapter exceeding one is a finding worth reporting upstream,
not expected noise.

Out-of-domain inputs are garbage-in/garbage-out — measured and
documented, not patched: NaN through `min`/`max` may return the
non-NaN operand on GPU (CPU propagates NaN); vector magnitudes near
the f32 range boundary overflow (length → Inf, normalize → 0) or
underflow to 0 where the CPU's f64 interior survives; noise lattice
coordinates ≥ 2³¹ diverge (JS ToUint32 wraps, WGSL f32→int saturates);
subnormal results flush to exactly 0.

### Introspection

`CookStats.gpu` is present exactly when the cook was given a resolver,
and includes nested subgraph-cook work:

```ts
{
  dispatches,          // kernels — NOT dispatchWorkgroups calls
  pipelinesCompiled,
  pipelineCacheHits,
  residentRuns,        // resident runs executed (a cached run counts nothing)
  fusedNodes,          // their total member count
  readbacksSaved,      // fusedNodes - runs that read back at all
  fallbacks,           // Record<reason, count>
}
```

`dispatches` counts one kernel per resolved field column plus one apply
kernel per fused member. Chunking never multiplies it — a kernel split
across several `dispatchWorkgroups` calls still counts once, so a
4.3M-point four-member run reports `4` while issuing 8 GPU calls. Do
not read it as a GPU-call count.

One kernel counts more than once, and only one: a **multi-asset spawner
terminal** dispatches once per asset present in the input, over that
asset's element range and into that asset's output buffer, so the unit
is (step, asset) rather than step. Those are distinct dispatches over
disjoint ranges — not chunks of one range — and each is work the graph
asked for: add a species, pay a dispatch. A constant-`assetId` spawn
has exactly one asset and still counts `1`, so v0.7 numbers stay
comparable. The line the counter draws is whether a unit has its own
destination; a chunk does not, and its count would move with
`maxElementsPerDispatch`, a tuning knob with no graph-level meaning.

`GpuFieldEvaluatorOptions` tunes the runtime:

| option | default | effect |
|---|---|---|
| `adapterInfo` | device's own | identity folded into `cacheSalt` |
| `maxResidentBytes` | 512 MiB | resident-run working-set bound (`run-too-large` above it) |
| `maxPooledBytes` | 256 MiB | idle bytes the buffer pool retains; `0` disables retention |
| `maxElementsPerDispatch` | `65535 × wg` (4 194 240 at wg 64) | chunk-size override; byte-invisible, for tests forcing chunk seams — leave unset in production |

`evaluator.dispose()` destroys pooled (idle) buffers only: buffers
still in flight stay valid and re-pool on release, and the evaluator
remains usable afterwards (pipeline and kernel caches are untouched).
`evaluator.poolStats` reports `{ buffersCreated, buffersReused,
buffersDestroyed, pooledBuffers, pooledBytes, buffersDetached,
detachedBuffers, detachedBytes }` — its byte fields are **bucket**
bytes, since the pool rounds every allocation up to a power of two with
a 256-byte floor — and
`GpuFieldEvaluator.pipelineCacheSize` reports the live pipeline cache.
`compileFieldSpec(spec, { attributes })` exposes the generated WGSL and
its bind-layout plan directly, and `supportedGpuFieldFns()` lists the
compilable fns.

The `examples/08-gpu-fields` demo shows the whole surface at once: one
five-node fusable chain over a million points cooked three ways — CPU,
GPU per-node (a resolver whose `planRun` returns null), and one fused
device-resident run — with per-path cold-cache wall times, the full
counter set, per-path output hashes, and a live deviation readout
against the CPU reference. `examples/09-gpu-world` covers the
device-resident instancing surface: a streamed `World` drawing from
matrices that never reach the CPU, with `poolStats.detachedBuffers`
and the binding's own handle count shown together as a live leak meter.
`examples/02-forest` covers the multi-asset shape: `assetAttr:
"species"` on the device-resident path, one buffer per species, with a
CPU/resident toggle and an honest fusion readout.
