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
| `nodes` | Node instances. `id` must be unique and non-empty; `type` must be a registered node type; `params` maps param names to values. Omitted params take their schema defaults. A `subgraph` node additionally carries either a `subgraph` payload or a `ref` (below); no other node type may carry either. |
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
- unknown *key*, at any object position — the graph object, a node
  object, a `subgraph` payload, a `ref`, a connection, a declared output,
  an exposed-pin declaration, an exposed-param declaration or one of its
  `targets` — → error naming the key and listing the valid ones
- `type`, `enum` or `acceptsField` on an exposed-param declaration →
  refused by name, with the reason: they are derived from the targets'
  registered schemas, not authored, so a declaration cannot claim a type
  or a field capability the inner params do not have

The unknown-key rule is worth stating plainly, because **the format is
closed**. Until v0.10 an unrecognized key was ignored, which is how `meta`
could be added in v0.9 and still be read by every earlier v1 reader. That
leniency is spent: a reader that ignores what it does not recognize cannot
tell a new field from a typo, and `"refs"` for `"ref"` would have cooked as
an ordinary subgraph node — a near-miss, silently. The consequence is
deliberate and permanent: **a future format field arrives with a
`formatVersion` bump**, never by riding along unnoticed. There is no
annotation or comment key either; descriptive text belongs in the `meta`
block, or — for an exposed param — in its own `description`.

The rule holds at every object position, not only the outer ones, because
a lenient nested object is the same near-miss one level down and the
nested positions are where the plausible typos live: `description` on a
declared output, `kind` on an exposed pin, `maximum` for `max` on an
exposed param.

`serializeGraph` enforces the same schemas on the way out, and requires
every node to be a registered type (`standardNode`). Field-valued params
serialize whether the field was built by `fieldFromJson` or composed
from the combinator API — a combinator field derives its spec from its
arguments. Since v0.9 there is therefore no authoring cliff between the
pleasant API and the serializable one: a graph holding
`mul(position(), 0.1)` round-trips, where before it could not be saved
at all. Four cases still refuse:

1. a field built by `makeField` — an arbitrary closure that nothing can
   describe, and the deliberate escape hatch;
2. any field composed over one, because a combinator derives its spec
   from its arguments and one missing argument spec propagates;
3. a tree nested deeper than the spec depth limit (256 levels).
   Derivation refuses at exactly the depth `fieldFromJson` will parse,
   so a spec that could not be re-parsed is never produced — a graph
   that saves and cannot be reopened would be worse than one that
   refuses to save;
4. an argument the constructor accepts but the grammar's parser does
   not — `perlinNoise({ seed: 1.5 })` builds a working field (the seed
   is coerced with `>>> 0`), but the grammar requires an integer, and a
   spec `fieldFromJson` would reject is worse than none. Same for a
   non-finite `frequency`/`offset`/`constant`/`ramp` stop, an fbm
   `base` outside the built-in factories, and `-0` anywhere (JSON turns
   it into `0`, and the two fields differ).

`fieldToJson` names the ONE cause that applied, and the offender:

- **opaque, this field** — "It was built by makeField ... Rebuild it
  with grammar constructors";
- **opaque, a sub-expression** — the offending leaf's structural key,
  so a `makeField` buried twelve combinator levels down is named
  directly rather than the constructor that noticed it;
- **too deep** — "It nests deeper than the grammar's cap of 256 levels
  ... Flatten the expression";
- **ungrammatical** — the message leads with the offending option, e.g.
  `` `seed` must be an integer ``.

`serializeGraph` prefixes any of them with the offending
`node "<id>" param "<key>"`, so the fault is localized in the graph and
in the field expression at once.

Serializing is about *describing* a field. Whether it then runs on the
GPU is a narrower question with an extra condition — see
[Eligibility](#eligibility--what-runs-on-the-gpu).

Numbers must be finite. A field-capable vec3/vec4 param set to a plain
scalar is canonicalized to the full tuple on serialization (broadcast
semantics keep the cooked output identical).

### Subgraph and dataInput serialization

Serialization is complete — two node types have special shapes:

- A `subgraph` node (built with `subgraphNode`) serializes with a
  `subgraph: { graph, inputs, outputs, params }` payload: the inner graph
  recursively in this same format, the exposed pin mappings as
  `{ name, node, pin }` (pin name on the wrapper, inner node id, inner
  pin), and the exposed-param declarations as
  `{ name, targets, description, default, min?, max? }`. Its own `params`
  hold the exposed params' VALUES — declarations in the payload, values
  on the node, exactly as a standard node keeps its schemas in the
  registry and its values on the node. A declaration carries only the
  authored part: `type`, `enum` and `acceptsField` are re-derived from
  the targets' registered schemas on load, and authoring one is refused
  by name rather than quietly dropped, so a payload cannot claim a
  capability the inner params do not have. `params` is `{}` and the
  payload's `params` key is absent when the node exposes none.
  Deserialization rebuilds the inner graph and re-wraps it through
  `subgraphNode`, so nested subgraphs round-trip and cook
  byte-identically. A subgraph node may instead carry
  `ref: { name, hash? }` — see [Named subgraphs](#named-subgraphs) — and
  the two are mutually exclusive.
- A `dataInput` node serializes with `items: []`: live `DataItems` are
  runtime-injected (via `graph.setParam` or a `World` bind), never
  embedded in JSON. After deserializing, re-bind the items before
  cooking.

A reader older than v0.10 meeting a `ref` node reports `a "subgraph" node
needs a "subgraph" payload object ... got undefined`. Misleading, but a
hard error rather than a miscook — which is why `formatVersion` stays 1:
bumping it would invalidate every existing v1 graph in the wild to buy a
better message on builds whose messages cannot be changed retroactively.

## Named subgraphs

A subgraph node can reference a registered subgraph BY NAME instead of
embedding a copy of it:

```json
{ "id": "trees", "type": "subgraph",
  "params": { "minDistance": 4 },
  "ref": { "name": "fill/scatter-even" } }
```

### The shipped vocabulary

`fill/scatter-even` above is real: the library ships a catalog of
primitives, generated reference in
[primitives.md](./primitives.md) (machine-readable:
[primitives.json](./primitives.json)). **They register on import of their
own subpath**, so nothing is available until something imports it:

```ts
import "pcg-ts/primitives";   // registers the whole catalog
```

That is a deliberate cost boundary, not an oversight. A corpus that
registers on import would be unshakeable weight in every bundle, so
`import "pcg-ts"` keeps costing nothing and the assets sit behind
`pcg-ts/primitives`. The `pcg` CLI imports it for you, which is why
`pcg run fill/scatter-even` works on a clean install.

Names are `<family>/<kebab-case>` over a closed set of seven families —
`shape` `fill` `transform` `compose` `filter` `place` `write` — and the
family is a promise about the pin shape: `shape` and `fill` produce
geometry from nothing, `transform` changes `P` and keeps the count,
`filter` removes points without moving any, `compose` combines two,
`place` works against a supplied geometry — a mesh for the surface
members, a path for `place/along-curve` — `write` sets attributes. Node
types are camelCase with no separator, so a name containing `/` can never
be mistaken for a `"type"`.

### Registering your own

The name must be registered before any graph referencing it is
deserialized, the same ordering constraint node types have, satisfied the
same way (one side-effecting index module):

```ts
import { registerSubgraph } from "pcg-ts";

registerSubgraph("scatter/grid", {
  graph: innerGraph,                              // live Graph or SerializedGraph
  inputs: [{ name: "bounds", node: "b", pin: "in" }],
  outputs: [{ name: "out", node: "xf", pin: "out" }],
  params: [{ name: "spacing", targets: [{ node: "g", param: "spacingX" }],
             description: "Grid spacing in metres.", default: 2 }],
});
```

**An exposed param's default is always a PLAIN value**, never a `Field` —
a field is set as a value on an instance, not as a default. Every cook
writes each exposed param's current value into its targets, so exposing a
slot that holds the primitive's characteristic field would overwrite that
field with a plain number on the very first cook. The shipped primitives
therefore keep their noise fields on the inner nodes and expose the
scalars those fields READ BACK, through the parameter-attribute idiom: a
`setAttribute` whose value is exposed, and a downstream field that reads
`{ "fn": "attribute", "name": ... }`. It is the only way to make anything
inside a field spec adjustable, and `removeAttribute` takes the scratch
column off again before the result leaves.

**What is stored is a recipe, never a live graph.** `subgraphNode`
mutates what it wraps (it injects a `__in_<name>` portal node per exposed
input and an `__out_<name>` output per exposed output), so a live `Graph`
can be wrapped exactly once. Every reference therefore materializes a
fresh graph and definition, through the same `deserializeGraph` →
`subgraphNode` path an embedded payload takes. Three consequences follow,
and they are the contract:

- **A reference and an embedded copy of the same recipe cook
  byte-identically** — same output bytes, same cache decisions, same
  transitive version key. They travel one construction route; there is no
  second one.
- **Two references to one name share nothing.** Each owns its inner
  graph and its per-node caches, so editing one through
  `getSubgraphSpec(def).graph` invalidates only that one. (They also
  produce *different* output, because each derives its inner seed from
  its own outer node id — that is correct, not a defect.)
- **The registry is not a live-update channel.** Resolution happens once,
  at load; a loaded graph holds its own materialized inner graph and no
  later registration reaches it. Duplicate names throw, mirroring
  `standardNode`, and there is no public unregister. To hot-reload a
  primitive, reload the graph.

`registerSubgraph` canonicalizes the recipe at registration —
`serializeGraph(deserializeGraph(authored))` — so a sparsely authored
recipe and a fully-filled one become one payload, and every structural
error (unknown node type, bad param, an exposed pin naming a missing
inner node, an `__in_`/`__out_` collision) is reported there, with the
author's stack, rather than at some consumer's `deserializeGraph`.

Editing a referenced primitive's inner graph in place and then saving is
refused, naming the node: writing the reference back out would write the
*registry's* content and silently discard the edit.

### Pinning: the optional content hash

`hash` in a `ref` is **optional**, and the two modes are the whole design:

| `hash` | contract | on a change to the primitive |
| --- | --- | --- |
| absent (default) | "give me the library's current `fill/scatter-even`" | resolves, cooks, no friction |
| present | "cook exactly what I authored against" | **hard error** naming both hashes |

Neither mode warns. A library warning lands in a CI log or a console the
agent driving the graph never reads, which makes "resolve and warn"
operationally indistinguishable from resolving silently — the class the
determinism pillar exists to exclude. Mandatory pinning would be the
opposite failure: every improvement to a shipped primitive would break
every saved graph referencing it.

`registerSubgraph` returns the hash; `subgraphContentHash(payload)`
computes one. What it covers is the contract:

- **Covered** — every node id, type and param value; connections;
  declared outputs; the exposed pin mappings; each exposed param's name,
  targets, default and bounds. A nested `ref` contributes the referenced
  *name* (and its own pin hash, when it carries one), not the content
  behind it.
- **Excluded, at every nesting level** — `meta` blocks, graph `seed`s,
  and exposed-param `description` strings.

The exclusions are not oversights. A payload's `seed` is inert at cook
time (every cook derives the inner seed from the outer node seed and
overwrites it), so it cannot change a cooked byte. And `Graph.setMeta`
deliberately does not bump `version`, because retitling a graph must not
invalidate a cache — hashing `meta` would reintroduce exactly that
invalidation sideways, breaking every pinned graph on a typo fix in a
description.

Object keys are sorted before hashing, so reordering a node type's param
schema cannot move a primitive's hash.

**The boundary worth knowing.** The hash, and byte-identity between the
by-name and embedded forms, hold **within one build**. Across library
versions neither can, by any design: an embedded payload freezes the
defaults and canonicalization of the build that wrote it, while a
registry entry is re-derived from the current build, so adding a param to
any node type a primitive uses moves its hash. The optional pin is
precisely what turns that divergence from silent into stated.

### Subgraph nesting is acyclic, and enforced

A graph may not contain a node whose definition wraps it, directly or
through a chain. `Graph.add` refuses one — the only moment the cycle can
be caught, since a subgraph definition carries no edge until it is
placed. Cooking such a graph could only hang: the inner cook re-enters
the same graph's exclusive section, where a re-entrant call is
indistinguishable from a concurrent one. Named references get the same
treatment: a recipe that references the subgraph being registered is
refused by `registerSubgraph`, and a name cycle reaching a name already
on the resolution path is refused by `deserializeGraph`.

## The field-expression grammar

Field-capable params (marked "Field" in [nodes.md](./nodes.md), or
`acceptsField: true` in the schemas) accept a declarative spec instead
of a constant: `{ "fn": <name>, ... }`. Wherever a spec takes arguments
(`args` entries, noise `position`), a finite number or number array is
also accepted and wraps into `constant`. Specs nest arbitrarily (up to
256 levels). `listFieldFns()` returns all 42 names at runtime.

### Inputs

| fn | Spec | Result |
| --- | --- | --- |
| `constant` | `{ fn, value: 1 \| [1, 2, 3] }` | Same scalar/tuple for every element |
| `attribute` | `{ fn, name: "density", tupleSize?: 1 }` | Reads a numeric attribute of the target domain (string attributes are not readable as fields; `tupleSize`, when given, must match) |
| `position` | `{ fn }` | The `P` attribute (f32, tuple 3) |
| `index` | `{ fn }` | Element index 0, 1, 2, ... |
| `fraction` | `{ fn }` | Normalized element index, `index / (count - 1)` |
| `randomField` | `{ fn, key?: 0 \| "salt" }` | Per-element deterministic random in [0, 1) from (context seed, key, index) |

`fraction` spans **[0, 1] closed**: exactly 0 on the first element and
exactly 1 on the last, matching `pointLine`'s `includeEnd: true`
convention, so five elements give 0, 0.25, 0.5, 0.75, 1. A single
element gives 0 (the divisor is clamped, never zero) and an empty domain
gives an empty column. Because the endpoints coincide, a periodic
function fed straight from `fraction` repeats its start value at the last
element — scale by `(count - 1) / count` when you want a seam-free loop.

Its value is a function of how many elements share the domain, so it
answers "how far along this thing" and never "where in the world": the
same point gets a different `fraction` after any upstream filter changes
the count, and a different one again in a `World` cell that holds a
different number of elements. Use `position` for anything that must agree
across partitions.

### Elementwise combinators

All take `args` with an exact arity. Scalars (tuple 1) broadcast against
any tuple size; other tuple sizes must match. Math runs in f64, results
store as f32.

| Arity | fns |
| --- | --- |
| 1 | `abs`, `floor`, `length` (tuple → scalar Euclidean length), `normalize` (zero tuples stay zero), and trig `sin`, `cos`, `tan`, `asin`, `acos`, `atan` (radians, elementwise) |
| 2 | `add`, `sub`, `mul`, `div`, `min`, `max`, `dot` (tuple → scalar), `atan2` (args `[y, x]`, radians), and comparisons `lt`, `le`, `gt`, `ge`, `eq`, `ne` emitting 1/0 (`ne` is the exact complement of `eq`) |
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
`getSubgraphSpec(def)` exposes a node definition's inner graph, pin
mappings and param declarations for inspection.

A fourth argument gives the wrapper its own params, each bound to one or
more inner `(node, param)` slots. Build them with `resolveExposedParam`,
which DERIVES the schema from the targets' registered schemas — the
author supplies only a name, an agent-facing description, and optionally
a default or narrowed bounds:

```ts
import { resolveExposedParam } from "pcg-ts";

const clusterDef = subgraphNode(
  inner,
  [],
  [{ name: "out", node: jitter, pin: "out" }],
  [
    resolveExposedParam(inner, {
      name: "count",
      targets: [{ node: scatter, param: "count" }],
      description: "How many points in the cluster.",
    }),
  ],
);
const cluster = outer.add(clusterDef, { count: 120 });
```

The default is the target's LIVE value at wrap time (50 above), so
wrapping a tuned graph keeps its tuning. Values live on the wrapping
instance, so two instances of one def can be tuned differently and each
caches on its own values; they are written into the inner graph at cook
time. Fanning one param out to several targets requires them to agree on
`type` and `enum`; `acceptsField` is ANDed and bounds intersect, so the
exposed schema never admits a value one target would reject. A `Field`
set on a param that is not field-capable fails at cook time naming the
exposed param and the offending inner target.

The ANDing is correct and silent, which is a bad combination: fan a knob
across one field-capable param and one plain one and it registers
cleanly, having quietly stopped accepting fields — usually the entire
point of the knob. So a declaration may ASSERT the capability, and the
resolver then names the target that refuses instead:

```ts
resolveExposedParam(inner, {
  name: "density",
  targets: [{ node: sample, param: "densityField" },
            { node: thin, param: "threshold" }],
  description: "Where planting is allowed.",
  acceptsField: true,     // -> error: "thin".threshold does not accept fields
});
```

It is opt-in, like the content hash on a reference: an author who says it
means it. Every field-capable param in the shipped catalog asserts it.

Two exposed params may not bind the same inner slot, and one may not list
a slot twice: both are hard errors naming the params and the slot. A
silent last-write-wins would leave a knob that appears to do something,
forces a recook when it changes, and provably cannot change the output.

**Cooking does not modify the inner graph.** The values are written in
and restored again around each cook, so a graph's serialized bytes never
depend on what has been cooked — including a cook of a DIFFERENT graph
sharing the same definition, and including a cook that throws partway.
This is the same guarantee the inner seed already carries, and it is what
lets one definition back many independently tuned instances: `getSubgraphSpec(def).graph`
holds what you wrapped, not what somebody last cooked through it.

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
  non-subgraph defs. `describeSubgraphParams(def)` is its sibling for
  params: exposed name, resolved schema, and the inner targets the value
  is written into. Together they are a subgraph node's real interface —
  `listNodeTypes()` reports the `subgraph` type as pinless and paramless
  because both are per-instance.

When to mutate vs rebuild: mutate while a live graph is being edited and
warm caches matter (tweaking one branch of an expensive graph must not
recook its siblings); rebuild through `serializeGraph` /
`deserializeGraph` when loading a document or handing a graph across a
boundary — a rebuilt graph is fully validated but starts with cold
caches. The two stay consistent: after any mutation,
`serializeGraph(graph)` reflects the current structure and round-trips.

## One pin, many geometries

A pin carries a **collection**, not a geometry, and a single connection
can put several geometries on it. Two ordinary ways that happens:
`partitionByAttribute` emits one geometry per distinct value, and a
`subgraph` or `dataInput` forwards however many items it holds.

Most nodes process exactly one geometry. Handed several, **they error**:

```
transferAttribute: input pin "in" received 3 geometries, but
transferAttribute processes exactly ONE. Using the first and discarding
the other 2 would look like a successful cook, so it is an error instead.
```

That is the trade being made. Taking the first item is the friendlier
behavior right up to the moment it is wrong, and then it is a cook that
succeeds, reports plausible counts, renders a plausible picture, and has
silently dropped two thirds of the work — the failure this library is
least able to help you find. An error at the pin names the node and the
count instead.

**There is no for-each node, and no in-graph node that selects one item
of a collection.** This is a real limitation, not an omission you can
route around inside the JSON. Three fixes, and the error message lists
all three:

1. **Merge.** Insert `mergePoints` between the source and the node, to
   concatenate the geometries back into one cloud. It is points-only, so
   rebuild any path after it with `pointsToPath` (see "A path that goes
   through a filter stops being a path").
2. **Move the op upstream of the split**, so it runs once on the whole
   cloud before it is partitioned. Usually the right answer when the
   operation does not actually depend on the partitioning.
3. **Drive it from TypeScript**, where a collection is an ordinary array:
   `collection.filter((item) => item.kind === "geometry")` gives you all
   of them to loop over, and `filterByTag(collection, "<attr>=<value>")`
   picks one by the tag `partitionByAttribute` wrote.

## Transfer mappings

`transferAttribute` copies an attribute from a second geometry (its
`source` input) onto the main input's points. The `mapping` param picks
how each destination point finds its source value:

| mapping | Source needs | Source domains (`attrDomain`) | Use when | A point misses when |
| --- | --- | --- | --- | --- |
| `nearest` (default) | any points | `point` only | Both sides live in the same 3D space; closest source point (ties → lowest index) is the right answer | never |
| `uv` | triangle mesh + UVs | `point`, `vertex`, `primitive` | The geometries share a UV parameterization but not a position — transfer between differently tessellated meshes, or read texture-space data | its UV lies in no source triangle |
| `raycast` | triangle mesh | `point`, `vertex`, `primitive` | The value should come from a surface along a spatial direction — drape scattered points onto the terrain below, probe walls sideways | its ray hits nothing (or nothing within `maxDistance`) |

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
- **A `primitive` source is read whole, never blended.** `attrDomain:
  "primitive"` takes one value for the entire triangle, whatever its
  type — a per-face id, a material tag, a width — so it arrives
  bit-exact rather than smeared across the face. That is not a
  convenience: `w0·v + w1·v + w2·v` is not `v` in floating point, so
  interpolating a constant would return a value nobody wrote.
- **Neither mesh mapping can reach a road.** This is the expectation to
  correct before you spend an afternoon on it. `uv` and `raycast` both
  need 3-vertex `poly` triangles, and an edge or polyline network from
  `connectPoints` or `pointsToPath` has none — so `attrDomain:
  "primitive"` reads a per-face value off a **triangle mesh only**, and
  a road network is refused, naming the fix. `mapping: "nearest"`
  refuses `attrDomain: "primitive"` outright for a different reason: it
  searches source *points*, and a per-primitive value sits on none of
  them. Its error names the route — `promoteAttribute` the value from
  `"primitive"` to `"point"` on the source (`mode: "max"` or `"first"`),
  then transfer with `attrDomain: "point"`. Switching mapping is not the
  fix there, and the message says so. If the destination points are
  being *sampled off* that network in the first place, you need none of
  this: the carry described under "Sampling a path, and keeping one"
  has already put the value on them.
- **The miss contract.** A missed point keeps the value it already had
  (the attribute default if the attribute is newly created) — it is
  never invented. Name a `missCountAttr` and the node writes the miss
  total into a u32 detail attribute so a graph can assert on it;
  `nearest` assigns every point and always reports 0.
- **Which points missed.** `missCountAttr` gives the total; `hitAttr`
  gives the per-point answer. Name one and the node writes a bool
  attribute of that name (tuple 1) onto the output's point domain, where
  **1 means this point found a source** and received a transferred
  value and 0 means it missed and kept its prior one. The polarity is
  the hit, the inverse of what `missCountAttr` counts. Every point is
  written and the column is replaced rather than merged, so it can never
  carry a stale value: `nearest` leaves it all 1, and a source with
  nothing to search — every triangle degenerate — leaves it all 0. It
  must differ from `name`, which it would otherwise overwrite; empty
  (the default) writes nothing.

  This is what lets one ray decide both the move and the discard.
  Transfer `P` by `raycast` with a `hitAttr`, keep the hits with
  `filterByAttribute` (comparison `eq`, value 1), then `removeAttribute`
  to clean up — three nodes reading the outcome of the very ray that did
  the moving. `place/drop-to-surface` is exactly those three nodes. Do
  not recover the same information by casting a second ray from the
  snapped positions: the snapped point sits *on* the surface, so a
  forward-only second ray can start a hair below a tilted plane and miss
  what the first ray hit.
- **Determinism.** Degenerate triangles are skipped, tie-breaks are by
  lowest index, and the acceleration grids are provably result-neutral;
  the epsilon policy is exported (`TRANSFER_BARY_EPS`,
  `TRANSFER_AREA_EPS`, `TRANSFER_DET_EPS`, `TRANSFER_BOX_PAD_REL`).

The node covers the common cases; the data-layer functions
(`transferNearest`, `transferUv`, `transferRaycast`) additionally
accept a `cellSize` grid hint (lookup cost only — never results), and
`transferUv` a `uvDomain` override forcing the source UV domain.

## Paths

A path is not a new kind of point and not an attribute on one. It is
**topology** laid over points that already exist: `polyline` primitives
whose vertices reference point indices, living beside the point domain
rather than replacing it. The points keep every attribute they were
carrying; the path is the added statement that they are visited in an
order.

`pointsToPath` is the node that turns a point cloud into a *path*, and
one of only two ways to start polyline topology from serialized JSON —
`createPolyline` is a TypeScript function a JSON author cannot call. It
builds polylines over the *same* points it is handed, so nothing written
upstream is lost. (`pathResample` also emits polyline topology, but it
derives it from a path it was already given; it extends a chain rather
than starting one.)

The other way is `connectPoints`, which starts polyline topology as a
*network* rather than a path: one 2-vertex primitive per edge, so a
point may belong to many primitives and a junction is genuinely one
shared point. Reach for it whenever the thing you are describing
branches — `pointsToPath` gives each point exactly one group and so can
never express a vertex of degree greater than two.
`shape/path-loop` and `shape/path-meander` are the ready-made sources
built on it, and the generated catalogs
([nodes.md](./nodes.md), [primitives.md](./primitives.md)) say which
consumers require polyline topology on which pin.

### Closure is structural

A closed path is one whose last vertex references the path's first
point. That is the entire representation. There is **no `closed`
attribute** — do not write one, do not look for one, and do not infer
closure by comparing the first and last positions. `pointsToPath`'s
`closed` param appends that trailing vertex and writes nothing else, and
every consumer detects closure by reading the topology, so there is
nothing that can disagree with anything else. (A dedicated attribute was
considered and rejected for exactly that reason: a second copy of a fact
is a second copy that can go wrong.) A closed path needs at least three
points; two would fold the path back onto itself and is an error.

### Order is a contract

Within a path the points are visited in **ascending point index** — the
order they arrived on the node's input — unless `orderAttr` names a
finite numeric point attribute to sort by, ascending. **Ties in that key
always break to the lower point index**, so the result never depends on
the sort implementation, and there is no arrival-order or cook-order
component to it. `groupAttr` splits one cloud into one path per distinct
group id (whole numbers, typically written with `setAttribute` at type
`i32`), and the paths are emitted in ascending id.

### A path that goes through a filter stops being a path

This is the one that bites first. Every filter node that can remove
points routes through `gatherPoints`, which rebuilds the point domain
from the survivors and drops primitive topology with it. `mergePoints`
and `partitionByAttribute` drop it the same way. Two filter-category
nodes are exempt, for unrelated reasons: `projectToPlane` moves points
without removing any, and `filterPrimitivesByBounds` removes whole
*primitives* rather than points — the one node in the library that takes
topology as its subject instead of its casualty (see "Owning primitives
instead of destroying them", below). So "filter" is not quite the
boundary: **removing or recombining points** is. The category decides
nothing in either direction — `partitionByAttribute` is categorised
`attribute` and drops topology, while both exemptions above are
categorised `filter` — and the test is **can** remove, not did:
`filterByAttribute` drops topology even when its predicate keeps every
point, because it routes through `gatherPoints` regardless.

Nothing warns at the filter. The loss is silent where it happens and
surfaces somewhere else entirely, as a path consumer reporting that it
found no polylines — a confusing error, because the node it names is not
the node at fault. So the ordering rule is:

> **Filter first, then build the path.** Every path op belongs after the
> last filter, never before it.

That covers `pathResample`, `writeTangents` and `splineSample`, and the
`curve` input of the path-consuming primitives. If a graph genuinely
needs to remove points from something that is already a path, remove
them first and rebuild with `pointsToPath` — there is no in-place
repair.

**The same rule destroys a network, and there it costs more.** A network
(next section) is the same polyline topology with branching, and it is
built by `connectPoints` from a spatial predicate rather than from a
group id — so there is nothing to rebuild it *from* once the points have
been renumbered. A `filterByBounds` placed after `connectPoints` reads
like trimming the net to a rectangle and is actually demolition: the
edges are gone, the points come out fine, `pcg validate` says `ok`, and
the cook succeeds with a plain cloud where a road network was. What to
do instead is at the end of the next section.

```json
{
  "formatVersion": 1,
  "seed": 7,
  "nodes": [
    { "id": "line", "type": "pointLine",
      "params": { "count": 12, "start": [0, 0, 0], "end": [40, 0, 0] } },
    { "id": "wobble", "type": "jitterPoints", "params": { "amount": [0, 0, 3] } },
    { "id": "gap", "type": "filterByExpression",
      "params": { "predicate": { "fn": "ne", "args": [{ "fn": "index" }, 4] } } },
    { "id": "path", "type": "pointsToPath", "params": { "closed": false } },
    { "id": "posts", "type": "pathResample",
      "params": { "mode": "spacing", "spacing": 2.5 } },
    { "id": "aim", "type": "orientAlongVector",
      "params": { "axis": "+z",
                  "direction": { "fn": "attribute", "name": "tangent", "tupleSize": 3 } } }
  ],
  "connections": [
    { "from": ["line", "out"], "to": ["wobble", "in"] },
    { "from": ["wobble", "out"], "to": ["gap", "in"] },
    { "from": ["gap", "out"], "to": ["path", "in"] },
    { "from": ["path", "out"], "to": ["posts", "in"] },
    { "from": ["posts", "out"], "to": ["aim", "in"] }
  ],
  "outputs": [{ "id": "aim", "pin": "out", "name": "fence" }]
}
```

The filter runs before `pointsToPath`, so the path is built over exactly
the points that survive. Swap those two nodes and `pcg validate` still
says `ok` — the structure is fine, only the meaning is gone — and the
cook then fails at `posts`, three nodes downstream of the mistake:

```
node "posts" failed: pathResample: input has no polyline primitives —
the input is a plain point cloud (11 points, 0 primitives). Build a path
in-graph with pointsToPath (or createPolyline in TypeScript). If one WAS
built upstream, a node between it and pathResample dropped the topology:
any node that can REMOVE points rebuilds the point domain from the
survivors and the primitives go with it — filterByDensity,
filterByBounds, filterByAttribute, filterByExpression, selfPrune,
partitionByAttribute — and mergePoints does the same when it
concatenates clouds. Category is not the rule: projectToPlane is
categorised "filter" but preserves topology, and filterByAttribute drops
it even when its predicate keeps every point. filterPrimitivesByBounds
is never the culprit for a DROPPED topology — it filters the PRIMITIVE
domain and preserves the topology of everything it keeps — but it can
empty that domain by rejecting every primitive, so if one is upstream,
check its boundsMin/boundsMax, vertex and mode before you move anything.
Fix by moving pointsToPath after those nodes, so the path is built over
the points that survive.
```

### Sampling a path, and keeping one

Two nodes read a path and they do different things with it:

| | Treats each path | Emits | The input's POINT attributes | The input's PRIMITIVE attributes |
| --- | --- | --- | --- | --- |
| `splineSample` | all polylines as one concatenated curve | a point **cloud** — topology ends here | lost; new points carrying `tangent` and `curveU` | **carried onto every sample** |
| `pathResample` | each on its own arc length, kept separate | a **path**, closed if the input was | lost; new points carrying `tangent` and `curveU` | **carried both ways**: onto every sample, and onto the output polyline that replaced each input one |

The two columns on the right pull in opposite directions and both matter.

**Point attributes are lost, because the points are new.** When the
points already mean something — a species, a scale, an index other
geometry refers to — do not resample: `writeTangents` writes a `tangent`
onto a path's own points and hands back the same points, attributes and
topology, which is what `orientAlongVector` needs to read, and what
`write/orient-along-path` packages as one step. A path built by hand
with `pointsToPath` has no `tangent` at all until something writes one,
because only a sampler emits it and only for the points it created.

**Primitive attributes survive, automatically.** A sample inherits the
primitive it was taken from, so a `roadWidth` on a road lands on every
lamp placed along it — see "The five moves" below, and note that
`surfaceSample` does the same for the triangle each of its candidates
landed on. There is no opt-out param, deliberately: an author who wrote
the value should get it without knowing a knob exists, and
`place/along-curve` would otherwise have to re-expose one. Three
consequences worth reading before you rely on it:

- **`primtype` is the one exception.** It is a type tag, not a value —
  `"polyline"` says nothing about a point.
- **No index column rides along.** There is no `sourcePrimitive` to
  group by afterwards, and there will not be: primitive numbering is
  per-partition, so shipping one would make a cell's output differ from
  the whole region's and break the determinism invariant. Values carry;
  identity does not.
- **A collision is refused, not resolved.** These nodes carry no input
  *point* attributes, so the only name a carried column can hit is one
  the node writes itself (`P`, `tangent`, `curveU`, `seed`, …). Rather
  than delete that column and return a plausible-looking cook, the node
  errors, naming itself, the attribute, both shapes and the two fixes:
  rename it where it was written (the `name` param of the `setAttribute`
  or `promoteAttribute` that produced it), or `removeAttribute` it
  upstream on `domain: "primitive"` if it is dead.

The accepted cost, stated so nobody files it as a bug: every upstream
primitive attribute is now part of a sampler's output contract, so an
unrelated `connectPoints` `lengthAttr` widens the samples too. The
widening is bounded — only `connectPoints` and `promoteAttribute`
produce primitive columns — and it is the better trade, because the
alternative is losing a value the author asked for in silence.

## Networks: the primitive domain is the edge domain

A path visits its points in a line. A **network** lets them branch — a
crossroads where three roads meet, a trail net between camps, a scaffold
to displace. The first question everyone asks is *"so where does an edge
live, and how do I put a value on one?"*, and the answer is worth stating
plainly because it is not the answer the question expects:

> **There is no edge domain, and none is needed. A 2-vertex `polyline`
> over shared points already IS an edge — so an edge is a `primitive`,
> and a per-edge value is an ordinary primitive attribute.**

Nothing was added to the data model for this. The `polyline` topology
that carries a path has never required one point to belong to one
primitive; that restriction was only ever `pointsToPath`'s, which gives
every point exactly one group and therefore at most two neighbours.
`connectPoints` decides its polylines from a spatial predicate instead,
over the *same* points it was handed, so a centre where three roads meet
is genuinely **one point**, of degree 3, shared by all three primitives —
and everything that point was carrying is still on it.

Two modes, and the choice between them is not a quality knob:

| `mode` | Joins | Use it when |
| --- | --- | --- |
| `radius` | every pair closer than `radius` | you want the dense neighbourhood graph — a scaffold, a proximity mesh. Edge count grows with the square of the point count. |
| `relativeNeighborhood` | such a pair only when no third point is closer to **both** endpoints than they are to each other (the lune test) | you want something road-shaped: sparse, connected, still holding cycles. |

`relativeNeighborhood` is the one to reach for by default. It **contains
a minimum spanning tree**, so it never disconnects what the radius
reached, and it keeps cycles, so the result is a network rather than a
tree — which is what a road layout wants, and a tree is not. (A true MST
mode was designed and rejected: tree membership is a *global* property —
an edge is in the tree iff no lighter path connects its ends — so it can
never be made partition-safe. The lune test is local, and that is the
whole reason it ships. See "Content that must NOT vary per cell".)

`radius` is a plain number and, alone among the distance params in the
library, deliberately **not** field-capable. A per-point radius would let
"A is near B" and "B is near A" disagree, and an edge would then depend on
which endpoint asked. The test is strict — `d < radius`, so a pair at
exactly `radius` is not connected — which is what makes a partitioned
cook exact.

### The five moves

Every per-edge and per-junction value comes from nodes that already
shipped. This is the whole vocabulary:

1. **point → edge.** `promoteAttribute` `from: "point"`, `to:
   "primitive"`. `mode: "min"` gives a road the width of its *weaker*
   end; `"first"` carries a categorical across (it takes the edge's first
   vertex, which is its lower-keyed endpoint).
2. **on the edge.** `setAttribute` with `domain: "primitive"`. Its field
   evaluates on the primitive domain, so `{ "fn": "attribute", … }` reads
   a promoted per-edge value and `remap` / `ramp` shape it.
3. **edge → junction.** `promoteAttribute` `from: "primitive"`, `to:
   "point"`, `mode: "max"` — each point learns the largest value among
   the edges touching it, which is how a junction gets sized by the
   widest road that reaches it.
4. **degree, without arithmetic.** `connectPoints`' own `degreeAttr`
   writes it (u32, point): a dead end is `degree == 1`, a junction
   `degree >= 3`, both reachable with `filterByAttribute`. `lengthAttr`
   does the same for per-edge length (f32, primitive). Both refuse a name
   the geometry already holds under a *different* shape, rather than
   deleting that column silently.
5. **edge → the points sampled off it.** Nothing to author: every node
   that samples a polyline down onto points carries the source
   primitive's attributes onto each sample automatically —
   `splineSample`, `pathResample`, `place/along-curve`, and
   `surfaceSample` for the triangle case. A lamp placed along a road
   arrives already knowing that road's `roadWidth` and its `districtKind`,
   because a sample inherits the primitive it was taken from. Move 3
   answers *what does this junction know*; this one answers *what does
   the thing standing on this edge know*, and the two are different
   questions — move 3 aggregates with `max` across every edge at a point,
   while this one is exact, since a sample sits on exactly one primitive.
   `primtype` is the one attribute never carried; the full contract,
   including why a name clash is refused rather than resolved, is under
   "Sampling a path, and keeping one" above.

```json
{
  "formatVersion": 1,
  "seed": 11,
  "nodes": [
    { "id": "camps", "type": "pointScatterInBounds",
      "params": { "count": 24, "boundsMin": [-40, 0, -40], "boundsMax": [40, 0, 40] } },
    { "id": "size", "type": "setAttribute",
      "params": { "name": "campSize", "domain": "point", "type": "f32", "tupleSize": 1,
                  "value": { "fn": "randomField" } } },
    { "id": "trails", "type": "connectPoints",
      "params": { "mode": "relativeNeighborhood", "radius": 30,
                  "degreeAttr": "degree", "lengthAttr": "trailLength" } },
    { "id": "weakEnd", "type": "promoteAttribute",
      "params": { "name": "campSize", "from": "point", "to": "primitive", "mode": "min" } },
    { "id": "trailWidth", "type": "setAttribute",
      "params": { "name": "trailWidth", "domain": "primitive", "type": "f32", "tupleSize": 1,
                  "value": { "fn": "remap",
                             "args": [{ "fn": "attribute", "name": "campSize", "tupleSize": 1 },
                                      0, 1, 0.5, 3] } } },
    { "id": "junction", "type": "promoteAttribute",
      "params": { "name": "trailWidth", "from": "primitive", "to": "point", "mode": "max" } }
  ],
  "connections": [
    { "from": ["camps", "out"], "to": ["size", "in"] },
    { "from": ["size", "out"], "to": ["trails", "in"] },
    { "from": ["trails", "out"], "to": ["weakEnd", "in"] },
    { "from": ["weakEnd", "out"], "to": ["trailWidth", "in"] },
    { "from": ["trailWidth", "out"], "to": ["junction", "in"] }
  ],
  "outputs": [{ "id": "junction", "pin": "out", "name": "trails" }]
}
```

That cooks to 24 points and 28 edges, with `degree` running 1 to 3 on the
point domain and the primitive domain carrying `primtype`, `trailLength`,
the promoted `campSize` and `trailWidth`. Note what `pcg cook`'s one-line
summary shows and what
it does not: it lists **point** attributes, so `trailLength` is invisible
there. `pcg inspect --node junction --pin out` prints every domain, which
is how you confirm an edge attribute actually landed.

`pcg render --attr` reads both colorable domains, so a per-edge value is
visible as well as inspectable, and the two never compete for one mark:
the **point** column colors the circles and the **primitive** column
colors the paths. `pcg render trails.json --attr trailWidth --out
trails.svg` therefore draws each trail in the color of its own width.
Points of a geometry that carries the name only on its primitives keep
the flat default color rather than borrowing one — a junction where three
trails meet has three candidate values, and picking one would be a
picture of something that is not in the data. When a name lives on *both*
domains, as `trailWidth` does the moment move 3 promotes it back to the
points, `--attr-domain point` or `--attr-domain primitive` narrows the
lookup; that matters because the scalar ramp is normalized over every
domain read, so one legend spans both ranges unless you say otherwise.
Every render report names the domain the color came from, so a picture is
never ambiguous about what it is showing. `vertex` and `detail` are
refused: neither draws a mark of its own.

Two more facts that bite if they are not stated. `connectPoints`
**replaces** any topology on its input, dropping that topology's vertex
and primitive attributes with it — so promote *after* connecting, never
before. And `place/along-curve` (and every other polyline consumer) reads
the whole net at once, measuring each edge on its own length, which is
how stage 5 of the shipped pipeline spawns lamps along a road network
with one node — and how each of those lamps arrives carrying the width,
the length and the district of the road it stands on, without a transfer
node anywhere in the graph.

### A point-removing op destroys a network

This is the trap worth budgeting for, because it is the same mechanism as
the path rule above and it costs more when it fires. Every op that can
remove points routes through `gatherPoints`, which rebuilds the point
domain from the survivors and drops primitive topology with it —
`filterByDensity`, `filterByBounds`, `filterByAttribute`,
`filterByExpression`, `selfPrune`, `partitionByAttribute`, and
`mergePoints` when it concatenates. Put any of them after
`connectPoints` and the network is quietly a point cloud again: the
points look right, the attributes survive, `pcg validate` says `ok`, and
the cook succeeds. Nothing warns.

`filterByBounds` is the specific one to watch, because clipping a net to
a rectangle is a thing you genuinely want to do and it reads like
trimming. It is not trimming; it is demolition. There are exactly two
things to do instead:

**1. Clip before connecting.** Move every filter upstream of
`connectPoints`. This is the same "filter first, build the topology
after" rule paths carry, and it is the right answer whenever the clip is
an authoring decision.

**2. When the clip is a partition boundary, own the edge by its
lower-keyed ENDPOINT.** Under a `World` the clip cannot move upstream —
the halo is precisely what has to be connected — so the ownership
decision moves to the *primitive* domain, which is what
`filterPrimitivesByBounds` does. The next section is that recipe, in
full.

### Owning primitives instead of destroying them

`filterPrimitivesByBounds` keeps or drops **whole primitives** by testing
their vertices against an axis-aligned box, and it is the one filter in
the library that **preserves topology**: the survivors keep their
vertices, their vertex and primitive attributes, and the points they
share. A network goes in and a network comes out. Every point filter
rebuilds the point domain from the survivors and the primitives go with
it; this one filters the *primitive* domain instead, and that single
difference is the whole node. It is the exception to the rule the
previous section states, and the only one.

**`vertex` is the param to get right**, because two of its four values
are ownership rules and two are selections:

| `vertex` | Keeps a primitive when | Tiles? |
| --- | --- | --- |
| `first` (default) | its **first** vertex is in the box | **yes** — reads one vertex, so exactly one box of a tiling claims it |
| `last` | its **last** vertex is in the box | **yes** — same argument, other end |
| `all` | **every** vertex is in the box | no — a straddling primitive is claimed by *no* box |
| `any` | **at least one** vertex is in the box | no — a straddling primitive is claimed by *every* box it reaches |

A partitioned cook needs `first` or `last`, and nothing else will do:
`any` double-counts at every seam and `all` loses the edges that cross
one. `all` and `any` are for selections — "keep the roads lying entirely
inside the park" is `all` + `inside`, "delete every road that touches the
lake" is `any` + `outside`. A primitive with no vertices is never inside,
under all four rules.

`boundary` is `filterByBounds`' rule with the same meaning and the same
reason to prefer `halfOpen` wherever ownership matters: two boxes meeting
at a face claim a vertex lying on it exactly once between them.
`inclusive` has both claim it, and with `vertex: "first"` both would emit
the same edge. `mode: "outside"` is the exact complement of `inside`
under whichever vertex rule and boundary are active, so running both over
one input reproduces every primitive exactly once.

`unreferencedPoints` decides the fate of points no surviving primitive
references. `keep` (the default) leaves the point domain **untouched** —
same points, same order, so every index, attribute and identity is still
the input's and anything computed per point upstream still lines up; a
partition cell keeps its halo points as isolated leftovers beside the
network it owns. `drop` removes them and renumbers the topology onto what
remains, in ascending input order, which is how a clean network comes
out. The cost of `drop` is that point indices move, and that it also
drops points that never had a primitive at all — so a cloud carrying both
a road network and unrelated scatter loses the scatter.

The partitioned recipe is now three nodes and a source:

- widen the cell's rectangle by `radius` and clip the cloud to it with
  `filterByBounds` at the default `halfOpen` boundary, **before**
  `connectPoints`;
- run `connectPoints`;
- run `filterPrimitivesByBounds` on the **unwidened** rectangle with
  `vertex: "first"` and the same `halfOpen` boundary.

```json
{
  "formatVersion": 1,
  "seed": 11,
  "nodes": [
    { "id": "cloud", "type": "pointScatterInBounds",
      "params": { "count": 400, "boundsMin": [-10, 0, -10], "boundsMax": [30, 0, 30] } },
    { "id": "halo", "type": "filterByBounds",
      "params": { "boundsMin": [-4, -1, -4], "boundsMax": [24, 1, 24],
                  "mode": "inside", "boundary": "halfOpen" } },
    { "id": "net", "type": "connectPoints",
      "params": { "mode": "relativeNeighborhood", "radius": 4 } },
    { "id": "owned", "type": "filterPrimitivesByBounds",
      "params": { "boundsMin": [0, -1, 0], "boundsMax": [20, 1, 20],
                  "vertex": "first", "mode": "inside", "boundary": "halfOpen",
                  "unreferencedPoints": "keep" } }
  ],
  "connections": [
    { "from": ["cloud", "out"], "to": ["halo", "in"] },
    { "from": ["halo", "out"], "to": ["net", "in"] },
    { "from": ["net", "out"], "to": ["owned", "in"] }
  ],
  "outputs": [{ "id": "owned", "pin": "out", "name": "roads" }]
}
```

The cell here is the 20×20 square at the origin and `radius` is 4, so the
halo box is the cell grown by 4 on each side and the ownership box is the
cell itself — under a `World` those two come from `ctx.min`/`ctx.max`
bound with and without the halo, never from a recovered cell index (see
"Per-cell seeding"). Each edge's first vertex is its lower-keyed endpoint
— `connectPoints` guarantees that ordering — so with `vertex: "first"`
the owner a cell computes and the canonical edge order are the same
choice by construction, exactly one cell claims each edge, and the cells
tile the network with no duplicate and no gap. **The whole recipe is a
serializable graph**, which is what it was not before this node shipped.

For a polyline that came from somewhere other than `connectPoints` —
`pointsToPath`, `pathResample`, `createPolyline` — the first vertex is
simply the path's START. Every path still has exactly one, so the tiling
is still exact; the owner is just the cell holding the start rather than
the cell holding most of the road, and that one cell emits the whole path
however far it runs. Budget for that: a long path is not split across the
cells it crosses.

A geometry with no primitives is not an error here but an empty result —
a cell too sparse to make an edge is a legitimate, silent case in a
partitioned cook. Why the halo width is exactly `radius` is in "Content
that must NOT vary per cell" below; `docs/nodes.md`'s `connectPoints`
entry states the same bound per param.

## Staged pipelines

Two independent mechanisms, often wanted together: cooking *part* of one
graph at a time, and authoring a *sequence of files* where each is the
previous one extended.

### Staging inside one graph (per-output cooking)

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

### Staging across files (the flat superset)

The shipped example of a multi-file pipeline is
`examples/graphs/pipeline-*.json`: a settlement built as
`pipeline-1-boundary` → `-2-districts` → `-3-lots` → `-4-detail` →
`-5-roads`, plus `-3-lots-edits`, `-4-detail-edits` and `-5-roads-edits`.

The mechanism is deliberately the dullest one available — **each stage's
file is the previous stage's file plus new nodes, connections and
outputs.** Not an include, not a subgraph payload, not a patch format.
Nothing is removed, no shared node is retuned, no param is edited, and
all eight carry the same graph seed. Every earlier stage therefore
reproduces bit-identically inside every later one, and you can open any
stage on its own and cook it.

The last stage is also the clearest illustration of the difference
between a path and a network, because both are in the same file lineage
over the same points. Stage 3's `spine` is a `pointsToPath` ring ordered
by `atan2(z, x)` — an angular tour that *cannot* branch, since that node
gives every point exactly one group. Stage 5's `roads` runs
`connectPoints` in `relativeNeighborhood` mode over the district centres
and comes out as 10 segments over 9 centres, one connected component with
two cycles and degrees `{1: 1, 2: 5, 3: 3}` — three genuine junctions,
each of them one point. Stage 3 is deliberately kept rather than
upgraded, as the contrast. The per-edge values ride the promote round
trip from "Networks" above, with no edge domain anywhere in it.

That works because of the seed chain and nothing else. A node's seed is
`hashCombine(graphSeed, hashString(nodeId))` — derived from its **id**,
not from its position in the DAG, its index, or its distance from an
output. Appending a whole district layer downstream of the terrain
cannot move the terrain, because no input to the terrain's seed
mentions the district layer.

Two consequences worth stating explicitly:

- **Renaming a node breaks the chain**, since the id is the seed. A
  stage that renames a shared node is no longer an extension of its
  base, even though every file still cooks and still validates.
- **Wrapping an earlier stage as a subgraph does not work**, and this
  was measured rather than assumed. A `subgraph` node derives its inner
  seed from the wrapper's own node seed (`hashCombine(nodeSeed,
  hashString("subgraph"))`), so the inner nodes get different seeds than
  they had as top-level nodes and the stage no longer reproduces
  bit-identically. Copy the nodes; do not wrap them.

**Reserving an edit slot.** The `-edits` variants add authored geometry
and wire it into a slot the base already reserved — an unconnected
`mergePoints` node named `edits`, sitting downstream of the terrain, the
wall and the district pass. Feeding a new branch into a reserved slot
keeps the file a superset; rewiring an existing edge does not, because
it changes what the earlier stage cooks. The payoff is that locality is
provable: `terrain`, `boundary` and `districts` stay bit-identical
between base and edited, while `lots` changes. Stage 5's road net is
built from the district centres, which sit *upstream* of the `edits`
slot, so `roads` and the `lamps` spawned along them are as untouchable by
an edit as the terrain is — and the test asserts that too.

`tests/pipeline.test.ts` enforces all of this — one shared seed, no
dropped node, no retuned param, no dropped connection, no moved output,
the upstream outputs bit-identical across each base/edited pair, and a
ceiling of 1000 instances across a stage's declared outputs. That last
one carries a rule as much as a number: a stage that outgrows its budget
is shrunk, the budget is not raised.

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

Read that reach literally: it re-rolls **every** node, including any
whose content is supposed to be the same from either side of a cell
boundary. In a level that carries world-anchored content, prefer the
per-node form above — see the next section for what is protected
structurally and what is not.

Either way, cell content stays a pure function of (world seed, level,
coord, graph, parent content) — independent of cook order, viewpoint
path, and eviction history. `ctx.seed` hashes every cell coordinate:
`hashCombine(worldSeed, levelIndex, cx, cz)` for a 2D cell,
`hashCombine(worldSeed, levelIndex, cx, cy, cz)` for a 3D one.

### Content that must NOT vary per cell

`ctx.seed` is per-cell by construction, so both patterns above are
exactly wrong for anything that has to look the same from either side of
a boundary: a world-anchored source, and the ops that read its points.
That content is seeded from a cell-INVARIANT anchor instead —
`ctx.worldSeed` (the `World`'s own seed, identical in every cell of every
level) or `ctx.levelSeed` (`hashCombine(worldSeed, levelIndex)`,
identical within a level, so two levels running the same graph get
unrelated worlds rather than the same one).

`pointScatterInWorld` takes its half of that out of the author's hands.
Its lattice is a function of its own `seed` param, `latticeMode` and
`cellSize` — **the graph seed is not an input at all**: alone among the
library's nodes, and for the same reason a noise field carries its seed
inside its own spec. A per-cell `setSeed`, a CLI seed override and a rename
therefore all leave it byte-identical, so the failure they used to cause
is not a documented hazard but an impossible one. It cost the node the
usual node-id decorrelation, and you will meet that: two such nodes with
identical params scatter *identical* points, exactly as two `perlinNoise`
fields with one spec are one field. Give each layer its own seed.

```ts
bind(g, ctx) {
  g.setParam(trees, "boundsMin", [ctx.min[0] - halo, 0, ctx.min[1] - halo]);
  g.setParam(trees, "boundsMax", [ctx.max[0] + halo, 0, ctx.max[1] + halo]);
  g.setParam(trees, "seed", hashCombine(ctx.worldSeed, 1)); // not ctx.seed
  g.setParam(rocks, "seed", hashCombine(ctx.worldSeed, 2)); // a second world
  g.setParam(scatterInThisCell, "seed", ctx.seed);          // this one may vary
}
```

**Anchoring is a property of a chain, not of one node.** Keying on point
identity — `filterByDensity` (probabilistic), `jitterPoints`,
`randomField`, and the tiebreaks in `selfPrune` and `pointNeighborhood` —
is what makes those nodes indifferent to which WINDOW produced a point.
It does not make the seeded ones indifferent to their own seed, and they
still derive it from the graph seed:

| Node | Reseeding per cell moves it? |
| --- | --- |
| `filterByDensity` (probabilistic), `jitterPoints` | yes — `hashCombine(nodeSeed, seed)` decides each draw |
| any field param resolving `randomField` (including `selfPrune`'s `minDistance` / `priority` and `filterByExpression`'s `predicate`) | yes — the node seed is the evaluation seed |
| `selfPrune` with plain numbers, `pointNeighborhood` | no — their order is pure identity, with no seed in it |

So a per-cell `ctx.seed` (or a whole-graph reseed) wired into one of the
first two rows lands one node later exactly where de-anchoring the source
used to: the halo and the neighbour disagree, deterministically and
silently. Seed those from `ctx.worldSeed` / `ctx.levelSeed`, or leave
them at their defaults.

A halo, finally, is nothing but a wider query. Widen `boundsMin` /
`boundsMax` by the width you need and the extra ring is byte-identical to
what the neighbouring cell owns — whether or not that neighbour has ever
cooked, which is the point: nothing is fetched from a sibling. To decide
who OWNS a point once the halo has done its work, filter with
`filterByBounds` at its default half-open `boundary`: `min <= p < max`,
the same rule a cell rectangle and `pointScatterInWorld`'s window
already use, so two abutting cells claim a point on their shared face
exactly once between them. Bind the box from `ctx.min` / `ctx.max` — the
unwidened cell — and the exactness comes from the two cells sharing an
endpoint *value*, so it holds at any cell size. (Recovering the index
arithmetically instead, as `floor(p / cellSize)`, can name the
neighbouring cell when `cellSize` is not exactly representable:
`floor(67.8 / 0.1)` is 677 while `678 * 0.1` is exactly 67.8. Compare
against the box, not against a recomputed index.) The `inclusive`
boundary is for selecting a box whose faces carry points on purpose, and
would have both cells emit that point.

### How wide a halo, and when no halo works at all

A halo only buys exactness when the operation's **reach is bounded**, and
"bounded" is a stronger condition than "local". The useful question is
not whether an op looks local but **how many hops of dependency it takes
before its answer is settled** — and there are three rungs, which the
shipped nodes populate all the way down.

**Zero hops — exact, and the cheapest case to reason about.** The answer
reads only stored values of the elements it names, and consults no third
element at all. `connectPoints` is the type specimen: whether A and B are
an edge is a distance between two *stored positions*. So a cell that also
holds every point within `radius` of its own rectangle decides its edges
exactly, at `haloWidth >= radius` and no more. `relativeNeighborhood`
looks like it adds a hop and does not — its disqualifying witness must
lie inside the pair's own neighbourhood, so it is already in that halo.

**One hop — exact at a stated width.** The answer reads its neighbours'
*stored values*, but never its neighbours' *answers*.
`pointNeighborhood` is bounded by its `radius`, so a halo of `radius`
reproduces the whole-region result. `selfPrune`'s `localMaximum` rule
decides each point from its immediate neighbours alone, which is exactly
why that mode is the halo-exact one and the greedy mode is not.

**Unbounded — no halo width works.** The answer depends on another
element's *answer*, and the chain has no bound. A greedy prune is the
canonical case: this point survives because that neighbour did not, which
happened because *its* neighbour did. A minimum spanning tree is the same
shape one level up — an edge is in the tree iff no lighter *path* connects
its ends, so a long chain plus one closing edge defeats any halo — and
that is precisely why `connectPoints` offers `relativeNeighborhood`
instead of an MST mode, and why no shortest-path node ships. Worse still
are the ops with no reach bound to widen at all: `attributeRemap` mode
`"fit"`, `attributeReduce`, an aggregate `promoteAttribute`, and the
`fraction` and `index` fields all measure the population *present in this
cook*, which under a `World` means the population *here*.

One wrinkle applies to the ownership step whenever the op emitted
**topology**. Clipping with `filterByBounds` would drop that topology
rather than trim it, so ownership becomes a primitive-domain decision:
`filterPrimitivesByBounds` on the unwidened rectangle at `vertex:
"first"` and the same `halfOpen` boundary, which keeps the edges whose
first vertex lies inside it. See "Owning primitives instead of destroying
them" above for the full recipe.

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

**Describing and running are two questions.** `getFieldSpec(field)` —
the non-throwing probe — answers the first: since v0.9 it returns a
spec both for fields built by `fieldFromJson` (*authored*) and for
fields built from the combinator API (*derived*), and `undefined` only
for the four cases listed under
[Validation behavior](#validation-behavior). Eligibility is the
narrower question, and it asks about provenance as well as
describability.

A field-capable param resolves on the GPU exactly when all of these
hold; otherwise it falls back to the CPU with a machine-readable
reason in `CookStats.gpu.fallbacks`:

1. The field carries a spec **this resolver accepts**. An authored spec
   always qualifies (JSON params always are authored). A derived spec
   qualifies only when the resolver advertises
   `acceptDerivedSpecs: true` — with the default `false`, a derived
   field falls back with `derived-spec`, and a field with no spec at
   all falls back with `no-spec`.
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

Those four reasons (`no-spec`, `derived-spec`, `compile-error`,
`too-many-buffers`) are the complete per-field vocabulary; fused runs
add two more, below. `derived-spec` is scoped to the **per-field seam**
only: a node the same setting keeps out of a fused run is not counted
again at the fusion gate, because its fields still fall back per-field
and the one cause reported twice would read as two.
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

#### `acceptDerivedSpecs` — why the wider set is opt-in

```ts
const gpu = new GpuFieldEvaluator(device, {
  adapterInfo: adapter.info,
  acceptDerivedSpecs: true,    // default false
});
```

The default is `false`, and the reasoning is worth having rather than
the flag alone.

Derived specs were measured before they were gated. On one adapter, the
derived form of an expression compiles to the same kernel key and the
same WGSL text as its authored twin and produces the same bytes, family
by family, within the existing per-family budgets — nothing widened.
But that evidence establishes *derived ≡ authored on the device*. It
says nothing new about *device ≡ CPU*, and that is the comparison a
default would change: the CPU is the bit-exact reference and the GPU
path is a documented approximation of it (see
[Determinism contract](#determinism-contract-and-measured-budgets)).

So accepting derived specs automatically would move output bytes on
upgrade, for graphs that already pass a resolver and never asked for
the change. Most of that movement is inside the documented tolerances,
but not all of it is tolerance-shaped: a `ge`/`select` threshold landing
on a knife edge flips a whole point to the other branch — a visible,
discrete change, not a sub-ULP one. The memo salt below keeps *caches*
correct across the setting; it has no way to keep *output* stable. That
is why adoption is your explicit choice, per evaluator, rather than a
consequence of upgrading.

Two things follow for anyone turning it on:

- Every `cacheSalt` gains a `+derived` component, so the first cook
  after the flip recooks the affected nodes. That is by design; see
  [Cache provenance](#cache-provenance).
- `captureAsync` has no memo key at all, so it has no salt to gain and
  no cache to poison — but it changes its output the moment it is
  handed an evaluator with the flag on. It is the one entry point where
  the effect is immediate and unmediated by any cache.

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

plus, for every member: every `Field` in its param tree carries a spec
*this resolver accepts* — authored always, derived only under
`acceptDerivedSpecs`. The gate therefore widens which chains fuse as
well as which single fields resolve, and both read the same
advertisement, so a node can never resolve on the device under a memo
key that did not gain the salt.

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
resolver and a node would resolve a live Field param on device *under
that resolver's settings*, the node's memo key gains
`|gpu:<cacheSalt>` — the evaluator's salt is
`"gpu2|<vendor>|<architecture>|<device>|<description>"`, and the
executor appends `+derived` to it when `acceptDerivedSpecs` is on and
appends nothing when it is off. The empty case is deliberate: every
memo key a pre-v0.9 graph produced is byte-identical. The non-empty
case is what keeps two evaluators on *one* adapter — one accepting
derived specs, one not — from serving each other's bytes, which
`cacheSalt` alone could not do since they share an adapter identity.

Toggling gpu on or off (or switching devices, or flipping
`acceptDerivedSpecs`) therefore never serves bytes produced by the
other path, while a node whose live field params are all ineligible
under the current settings — no spec at all, or a derived spec with the
gate off — keeps its cache hits across the toggle. The marker is
conservative: an eligible-but-uncompilable field also gains it
(over-invalidation, bytes still CPU-identical). Fused runs fold the same salt into the run key
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
| `deviceInstances` | `false` | opt in to device-resident instance transforms ([above](#device-resident-instancing-drawing-without-a-readback)) |
| `acceptDerivedSpecs` | `false` | opt in to resolving combinator-derived specs on device ([above](#acceptderivedspecs--why-the-wider-set-is-opt-in)) |

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
