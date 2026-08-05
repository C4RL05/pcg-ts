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
serialize only when the field was built by `fieldFromJson` (fields
composed in code have no JSON spec attached); `fieldToJson` throws an
actionable error otherwise.

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
