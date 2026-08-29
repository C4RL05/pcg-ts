# Authoring graphs

How to author pcg-ts graphs as JSON (the interchange format used by
`serializeGraph` / `deserializeGraph`) and in code. Node-by-node schemas
live in [nodes.md](./nodes.md) (generated; machine-readable twin:
[nodes.json](./nodes.json)); at runtime the same metadata comes from
`listNodeTypes()`. For authoring this format interactively, the
`editor/` tool (`npm run examples`) is a node editor built on
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
| `params` | Optional. Graph-scoped params, in declaration order: `{ name, value, targets?, min?, max?, description? }` each. One value declared once, which reaches a node either by being READ (a field expression names it) or by being WRITTEN (a `targets` entry `{ node, param }` names a param slot) — see [Graph-scoped params](#one-value-many-nodes-graph-scoped-params). Written only when non-empty, so a graph that declares none serializes exactly as it did before the key existed. |
| `meta` | Optional `{ title, description, tags }` — the only place descriptive text belongs; there is no comment or annotation key. Excluded from the content hash, so retitling a graph invalidates nothing. |
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
- a `params` entry that repeats a name, holds anything but a finite
  number or a non-empty array of them, states a value outside its own
  declared `min`/`max`, or carries a name containing a `.` or starting
  with `$` → refused, naming the index and the rule
- an inline `{"fn": "param", "name": X, "value": …}` for a name the graph
  declares in `params` → refused, naming both sites and both fixes
- a `params` block on a subgraph payload's inner graph → refused, naming
  the wrapper's exposed params as the right home

The unknown-key rule is worth stating plainly, because **the format is
closed**. Until v0.10 an unrecognized key was ignored, which is how `meta`
could be added in v0.9 and still be read by every earlier v1 reader. That
leniency is spent: a reader that ignores what it does not recognize cannot
tell a new field from a typo, and `"refs"` for `"ref"` would have cooked as
an ordinary subgraph node — a near-miss, silently. The consequence is
deliberate and permanent: **a future field an old reader could MISREAD
arrives with a `formatVersion` bump**, never by riding along unnoticed.

That is narrower than "a future format field", and the narrowing is the
honest statement of what the rule protects. An added KEY is not the hazard
it was written against: the list is closed, so an old reader meeting
`params` refuses it by name rather than ignoring it, and nothing rides
along. `meta` arrived that way, then the inline `value` on a `param` spec
node, then `params` — all at `formatVersion` 1. The bump is not free
either. `hashableGraph` covers `formatVersion`, so moving it moves every
subgraph content hash and breaks every pinned `ref`; spend it on a change
to what an EXISTING key means, not on an addition the closed list already
polices.

There is no annotation or comment key either; descriptive text belongs in
the `meta` block, in a graph param's own `description`, or — for an
exposed param — in its own `description`.

The `meta` block has ONE validator, and both ends of the round trip go
through it. `validateGraphMeta(value, where)` takes an untrusted value
and returns a frozen canonical copy — known keys only, absent keys
omitted, and `tags` copied so a caller mutating its own array afterwards
cannot reach into the graph. `Graph.setMeta` and the JSON reader both
call it, deliberately: the two ends disagreeing is exactly how you get a
graph that saves and cannot be reopened, since a writer that accepts
`{ title: 7 }` hands the reader something it is right to refuse. It
throws `GraphValidationError` for a non-object (or `null`, or an array),
for any key outside `GRAPH_META_KEYS` — the message lists the valid ones
— for a non-string `title` or `description`, for a `tags` that is not an
array, and for a non-string entry in `tags`. That last check is an
indexed loop rather than a `forEach` for a reason worth knowing if you
build a `meta` block programmatically: `forEach` SKIPS holes, so a sparse
`tags` array would validate clean and then serialize its holes as
`null`s — saved, and unreadable on the way back in. `where` is the
caller's label for the offender's location, and it is what puts
`"meta"` or `"setMeta"` at the front of the message.

`GRAPH_META_KEYS` is that key list at runtime — `["title", "description",
"tags"]`, in canonical order, and frozen. It is frozen because the
validator reads it twice, once to decide what is legal and once to write
the error that lists the alternatives; a caller who could push to it
could make the library advertise a key it then silently drops.

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
   describe. This is the sanctioned extension point, not a mistake: see
   [Hand-authoring a field](#hand-authoring-a-field-makefield) for what
   it buys and what refusing to serialize actually costs;
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

Serialization is complete — the wrappers and `dataInput` have special
shapes:

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
- A `forEach` node and a `repeatUntil` node carry the SAME payload under
  their own `type`: which wrapper cooks a body lives in `type` and nowhere
  else, which is why the pin names a loop reserves (`each`/`eachPoint`
  for `forEach`, `carry` for `repeatUntil`) are refused on any other type
  — a body written for a loop and retyped by hand would otherwise cook
  once, validate, save, and be wrong. A `repeatUntil` node's `params` hold
  its own `maxRounds` and `settleAttr` beside the exposed values: they are
  the loop's, not the body's, so every instance has them however few
  params it exposes.
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
scalars those fields READ BACK.

They used to do that through the parameter-attribute idiom: a
`setAttribute` whose value is exposed, a downstream field reading
`{ "fn": "attribute", "name": ... }`, and a `removeAttribute` taking the
scratch column off again before the result leaves. None of them do any
more — those 37 plumbing nodes are gone, and the specs read their scalars
by name instead.

That idiom was once the only way to make anything inside a field spec
adjustable. It is not any more — an exposed param also binds its name
into the body's field scope, so a spec can read
`{ "fn": "param", "name": ... }` directly (see
[the grammar](#the-field-expression-grammar) below) — and the choice
between them is a domain question rather than a matter of taste: **a
value the GRAPH computes is an attribute; a value a CALLER supplies is a
param.** The idiom is still the only route for a number the graph itself
produced — a measurement, a transferred value, anything whose answer a
node upstream had to work out — because that is a column, and a column
is what a node writes. A caller's value goes in as a param whether it is
one number or varies per element: a param accepts a `Field` too, and the
field is spliced into the expression that reads the name, so it is the
expression the author would have written around it. For a number a caller types, the
param route costs no plumbing at all, where the idiom costs a
`setAttribute` per value and a `removeAttribute` to clear up after them,
a `count`-element f32 column each, and one of the seven usable
storage-buffer slots on the GPU.

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

**A recipe does not record which wrapper cooks it** — that lives in the
referencing node's `type`, and nowhere else. So anything that builds a
node around a registered recipe has to supply the type itself, and the
reserved pin names are the only evidence there is: a body exposing
`each`/`eachPoint` was written for a `forEach`, one exposing `carry` for
a `repeatUntil`, and the loader refuses either under any other type.
`inferWrapperKind({ inputs, outputs })` is that reading, exported so a
caller does not have to reimplement it: pass the recipe's exposed pins
(`getRegisteredSubgraph(name).subgraph`) and it returns the `type` to
write. `registerSubgraph`'s own canonicalizing probe, `pcg run`'s
synthesized wrapper and the primitive catalog all go through it, which
is why a loop body is registerable, runnable and documentable rather
than refused by a guard quoting a node the caller never wrote.

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

A field is a VALUE, not a text format. In TypeScript it is what a
combinator returns — `mul(perlinNoise({ frequency: 0.05 }), 3)` is a
`Field`, composed out of other fields long before any geometry exists,
and the README's [Fields](../README.md#fields) section is that side of
it. What follows is the same object graph WRITTEN DOWN, one JSON object
per combinator, so that a saved graph can carry one. The expression
above serializes to

```json
{ "fn": "mul", "args": [
  { "fn": "perlinNoise", "opts": { "frequency": 0.05 } },
  3
] }
```

— same fns, same arguments, same column on every element. The one place
the library tells the two spellings apart is GPU eligibility, where an
authored (JSON) spec is accepted by default and a derived (combinator)
one needs `acceptDerivedSpecs`
([below](#eligibility--what-runs-on-the-gpu)).

Field-capable params (marked "Field" in [nodes.md](./nodes.md), or
`acceptsField: true` in the schemas) accept a declarative spec instead
of a constant: `{ "fn": <name>, ... }`. Wherever a spec takes arguments
(`args` entries, noise `position`), a finite number or number array is
also accepted and wraps into `constant`. Specs nest arbitrarily (up to
256 levels). `listFieldFns()` returns all 62 names at runtime.

### Which params accept one

44 of the standard library's 180 params do, across 25 node types, and one
rule separates them from the other 136: **a param can be a field exactly
when its value is read PER ELEMENT.** Everything settled before the
elements are walked cannot be one, and there are five ways to be settled
early.

Those 44 are what the rule produced when it was swept over every numeric
param in the library rather than applied case by case. It started at 20,
and only FOUR were refused — `splineSample.spacing` and `volumeSample`'s
`cellSize` and bounds — every one of them on the allocation clause.

**The column is f32.** All 44 are `f32` (27) or `vec3` (17). No `i32`,
`u32`, `enum`, `bool`, `string` or list param is ever field-capable,
because a field resolves per element into a column and only f32 and its
tuples read one. Part of that is executable rather than editorial: a
schema declaring `acceptsField` on `items`, `numberList` or
`stringList` is refused at node registration, naming the type. It is
also the reason a noise's `opts.seed` admits no arbitrary expression
(below) — a seed read through an f32 column arrives rounded to 24 bits,
and one ULP in a seed is not a rounding error but `hashCombine`
avalanching to an unrelated u32.

**There must already be elements to evaluate against.** The 9 source
nodes — `meshPrimitive`, `pointGrid`, `pointLine`,
`pointScatterInBounds`, `pointScatterInWorld`, `valueConstant` and the
rest — hold 16 `f32`/`vec3` params between them and not one is
field-capable, because a source builds its elements FROM those params.
There is no domain to resolve against yet.

**Anything read before the walk stays eager.** All 8 `seed` params: a
seed is hash-combined into the node's derived seed at cook start, when
there is no element in hand.

**Nothing read ONCE to size a single allocation.** `volumeSample`'s
`cellSize` and its bounds are the clear case: the node builds ONE grid,
so there is one value to read and no element to read it per.

This clause was first written as "nothing that decides how many elements
come out", and sweeping it over the library proved that wrong.
`pathResample.spacing` decides exactly that and is field-capable anyway,
because the node "resamples every polyline primitive ... on its own arc
length": the field resolves over the input's PRIMITIVE domain, one
spacing per path, and each path's count is derived from its own value.
`splineSample.spacing` is the same word in the same units and cannot be
a field, and the reason is sharper than "one curve": that node DOES keep
each sample's source primitive, but it walks the concatenated length
from s = 0, so which polyline a sample lands on is known only AFTER the
step that placed it. A per-primitive spacing would have to be read to
decide which primitive is being read for — the value cannot precede the
element it is indexed by. **The question
is never what the param decides. It is whether an element exists to read
it per.** Where a fielded allocation param has a global cap, the cap
becomes a post-resolution check rather than a reason to refuse.

`volumeSample` shows both halves inside ONE node: its `jitter` is
field-capable because it is read per output centre, and its `cellSize`
cannot be, because it sizes the grid those centres are made from. Same
node, same cook, opposite answers, and the reason is which side of the
allocation each one sits on.

**A SYMMETRIC RELATION needs a stated symmetrisation — but that is a
requirement, not an exclusion.** A per-point radius makes "A is near B"
and "B is near A" two different tests, so any relation built from one
needs a RULE for which wins. Both nodes that define one have adopted the
same rule: the LARGER of the two radii, chosen because the smaller would
let a big point be crowded by a small one and the sum would double the
spacing of an evenly-sized cloud. `selfPrune.minDistance` has used it all
along (`src/nodes/filtering.ts:1252`); `connectPoints.radius` adopted it
when it became field-capable. A per-POINT measurement such as
`pointNeighborhood.radius` owes nothing here at all, since a count is one
point's own answer.

**This clause refuses nothing today**, and its history is why it is still
written down. It first said a symmetric relation was IMPOSSIBLE to field
and named `connectPoints.radius` as the case. That was wrong twice over:
`selfPrune` was already doing it, and `connectPoints` now does too. What
survives is the requirement — field a relation without stating which
radius wins and the edge depends on which endpoint asked, which no amount
of determinism elsewhere repairs.

Two reasons a reader supplies for themselves, neither of them real.
**Grid cell size is not one.** `selfPrune` resolves the field to a
column FIRST and derives its cell size from the largest resolved claim,
and `adjacencyFor` deliberately excludes cell size from its cache key,
because it decides only how many cells a query touches and never the
answer: a mismatched cell size is slow, never wrong. **And deciding how
many elements SURVIVE is not the clause above.**
`selfPrune.minDistance` decides survival and is field-capable; that
clause is about ALLOCATION — how much output there is to make — and not
about how much of the input lives.

**The rule has already found one thing, which is the argument for having
written it down.** When it was first stated, `pointNeighborhood.radius`
was the one param it disagreed with the library about: per-point,
grid-local and symmetry-free, so the rule said it could be a field, and
it was not one, for no reason anything in the source gave. It is a field
now, and the disagreement was the library's rather than the rule's. A
rule that only described what was already there would have been a
summary; this one predicted a gap and the gap was real.

One caveat travels with every fielded radius. Across a partitioned
cook's seams the halo has to be the field's GLOBAL MAXIMUM, and the
author is the one who supplies it: nothing in `src/runtime/` reads a
node's radius param to size a halo, so the widening is author code
inside `bind`. Underestimating it does not throw — it keeps pairs
closer than the field asked for, at the seams only.
`selfPrune.minDistance`'s schema spells out how to bound a field rather
than measure it, and [How wide a halo, and when no halo works at
all](#how-wide-a-halo-and-when-no-halo-works-at-all) is the general
version.

### The same expression as text

The tree is the format, but you do not have to read it. `printFieldSpec`
and `parseFieldText` are a bidirectional view over exactly the same tree,
and they are what the editor and the CLI show. The predicate of
`graphs/basics-filter-by-expression.json` is 38 lines of JSON and this:

```
(length(position()) < 20) * (valueNoise({ frequency: 0.06, seed: { from: "node", variant: 3 }, position: position() }) > 0.4)
```

**Text is never saved.** It is an intermediate: you type it, it parses to
the tree, the tree is what the graph file holds and what every
programmatic edit touches. That is not a limitation to route around — it
is why the view is safe. Every write path in the library edits the tree
(`withInlineParamValue`, `applyParamPatches`, World patches, the editor
knobs), so a stored string would be re-printed by the first knob turn
anyway. Normalizing costs you your spelling, the way any formatter does,
and buys you a canonical form that no edit can invalidate.

The syntax reads like the TypeScript API on purpose — one mental model for
both spellings:

| grammar | text |
| --- | --- |
| `add sub mul div` | `+ - * /`, JS precedence, minimal parens |
| `lt le gt ge eq ne` | `< <= > >= == !=` |
| a raw number or tuple in `args` | `3`, `[1, 2, 3]` |
| `{ fn: "constant", value: 3 }` | `constant(3)` — see below |
| `attribute` | `attribute("density")`, `attribute("tangent", 3)` |
| `byAttribute` | `byAttribute("part", { rod: 1 }, 1)` |
| `component` | `component(expr, 0)` |
| `ramp` | `ramp(expr, [[4.5, 0.02], [14, 0.3]])` |
| a noise | `perlinNoise({ frequency: 0.05, seed: { from: "node", variant: 0 } })` |
| everything else | `name(arg, …)` |

**`constant(3)` is not the same text as `3`, and that is not pedantry.**
The corpus holds both spellings in quantity — raw numbers inside `args`,
and explicit `constant` nodes — and they are different TREES even though
they mean the same thing. Printing both as `3` would make the round trip
quietly rewrite one into the other, so the bare literal means the raw
argument and `constant(…)` means the node.

**Input-only sugar, which the printer never emits.** `&&` and `||` parse
as `mul` and `max`: the grammar has no boolean type, comparisons yield 1
and 0, and combining them that way is already how a predicate is built.
Printing them back would be the trap — `a && b` on values outside {0, 1}
silently multiplies — so a `mul` prints as `*` whether or not its operands
happen to be predicates. Unary `-` is sugar the same way: it folds into a
number literal, or becomes `sub(0, x)` and prints as `0 - x`. Single
quotes, trailing commas and redundant parentheses are accepted and never
printed.

`P` is NOT sugar for `position()`, and the error says so rather than
guessing: one way to write a thing, and a message that names it.

The correspondence is proven rather than asserted, on the same terms
`spec.ts` sets for code-authored specs: `parseFieldText(printFieldSpec(s))`
deep-equals `s` for every spec in the graph corpus, and printing is
idempotent.

### Inputs

| fn | Spec | Result |
| --- | --- | --- |
| `constant` | `{ fn, value: 1 \| [1, 2, 3] }` | Same scalar/tuple for every element |
| `attribute` | `{ fn, name: "density", tupleSize?: 1 }` | Reads a numeric attribute of the target domain (a string attribute is read by `attributeIs` or `byAttribute` instead, never by this fn; `tupleSize`, when given, must match) |
| `attributeIs` | `{ fn, name: "species", value: "pine" }` | 1 on elements whose STRING attribute equals the literal, 0 on all the others, on any domain. A predicate, never an index accessor: the string table is insertion-ordered and rebuilt by clone/filter/merge, so one logical value sits at different indices in different cells of a partitioned world |
| `byAttribute` | `{ fn, name: "part", cases: { "rod": 1, "panel": [1, 0.7, 1] }, default: 1 }` | The N-way form: the case whose KEY equals the STRING attribute's value, or `default` where none does. Case values are full argument positions (spec, number, or tuple) and broadcast against each other like any other combinator's inputs. The `default` is REQUIRED |
| `position` | `{ fn }` | The `P` attribute (f32, tuple 3) |
| `index` | `{ fn }` | Element index 0, 1, 2, ... |
| `fraction` | `{ fn }` | Normalized element index, `index / (count - 1)` |
| `nodeSeed` | `{ fn }` | The cooking node's own seed — `deriveNodeSeed(graph seed, node id)`, the same number `randomField` hashes. The same value on every element |
| `randomField` | `{ fn, key?: 0 \| "salt" }` | Per-element deterministic random in [0, 1) from (context seed, key, element IDENTITY): point identity on the point domain, the order-independent fold of a primitive's own points' identities on the primitive domain, and the element index on vertex and detail |
| `param` | `{ fn, name: "amplitude" }` | The value bound to that name, substituted where the literal would have stood. Same for every element — a value that varies per element is an attribute, not a param. An unbound `param` builds (its key and its GPU kernel need only the name) but refuses to evaluate |

`attributeIs` and `byAttribute` share one rule that will surprise you,
and it is forced rather than chosen: **a literal the geometry's string
table does not hold yields all zeros (or, for `byAttribute`, the
`default`) rather than an error.** Each cell of a `World` cooks its
own geometry, so a cell holding no pines legitimately has no `"pine"` in
its table, and filtering the last pine away does the same thing inside a
single cook — throwing there would make the result depend on how the
world happened to be partitioned. The price is that a MISSPELLED literal
reads as "nothing matches" rather than as a mistake, which is the trade
partition-independence buys. Structural errors still throw, and the line
falls exactly there: absence of a VALUE is data, absence of an ATTRIBUTE
is a bug. A missing attribute throws, and so does a numeric one — naming
`eq(attribute(name), value)` as the comparison you meant to write.

`byAttribute` exists because the 2-way form composes badly. Sizing a part
by its kind on three axes needs one nested `lerp` per axis per kind, so a
new kind means editing every axis — and the value an element takes when
every predicate reads 0 is written down nowhere at all. That
fall-through is the defect, and it is the ABSENCE of an expression rather
than one, so it cannot be searched for, reviewed, or edited. Naming it is
what this fn buys, which is why its `default` is required rather than
optional.

Be precise about what that does and does not get you. **It does not make
a typo impossible.** A case key the table does not hold matches nothing
and takes the default, exactly as a misspelled `attributeIs` literal
reads as "nothing matches", and for the same partition-independence
reason — a cell holding no clamps has no `"clamp"` in its table, so
validating case keys against the table would make output depend on how
the world was partitioned. What you get is narrower and real: the
fall-through is explicit, and the case set is enumerable in ONE place
instead of spread across one expression per component. What the parser
does check is an empty `name`, an empty case set, a missing `default`,
and tuple sizes that do not broadcast. Duplicate keys it cannot check —
`JSON.parse` has already collapsed them.

Every case is evaluated and then selected between, exactly as the nested
`lerp`s it replaces already did (`lerp` is strict). Sub-expressions
shared between cases are evaluated once. At most one case can fire —
distinct keys intern at distinct table indices — so the result does not
depend on the order you write the cases in.

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

`nodeSeed` exists because a saved graph's seed box does only half of
what an author expects. A serialized field expression bakes its numbers,
so a noise carries `opts.seed` as a LITERAL: moving the graph seed
re-rolls every scatter, jitter and probabilistic filter and moves no
noise at all. It is a property of the format, not a defect in any one
graph. That half is repaired inside `opts.seed` itself rather than here
(next section) — so reach for this fn when an expression needs the
node's seed as a NUMBER, and not when a noise needs to answer the seed
box.

Three properties follow from where the value comes from, and all three
are easy to assume wrongly. It is a DECORRELATION SOURCE rather than an
integer: it arrives in an f32 column, so seeds above 2^24 round to the
nearest representable multiple and will not compare equal to the seed
`Graph.describe()` reports. It is the NODE's seed, so two nodes in one
graph get different values and renaming a node changes its value — the
same rule every seeded node already lives under. And it is not in
`Field.key`, which is fixed at construction while the seed arrives at
evaluation; invalidation stays exact anyway, because the executor's memo
key carries the node seed itself, so every node recooks when the graph
seed moves whether or not its fields mention this one.

#### Making a saved noise answer the seed box

Write the seed as the tagged form. Besides an integer, `opts.seed` takes
exactly one other shape:

```json
{ "fn": "perlinNoise", "opts": { "frequency": 0.05,
  "seed": { "from": "node", "variant": 0 } } }
```

which derives this noise's seed as `hashCombine(the cooking node's own
seed, variant)`, the node seed being `deriveNodeSeed(graph seed, node
id)` — the same number `randomField` hashes. So the seed box now moves
the SURFACE and not merely the points standing on it.
`graphs/basics-reseed-a-noise.json` is the worked example. Every part of
the shape is load-bearing.

**The whole derivation is u32 murmur with no float in it**, which is why
it is bit-exact on CPU and GPU rather than budgeted the way a noise
interior is. A seed has no tolerance: a one-ULP disagreement in one is
not a rounding error in the output, it is `hashCombine` avalanching to
an unrelated number and the two paths cooking different noises. That is
also why the position is the one noise option admitting a spec and the
seed admits no arbitrary expression — every field column is f32, so a
seed read through one would arrive already rounded to 24 bits.

**`variant` picks WHICH draw off the node**, standing exactly where the
old literal seed stood. A node has ONE seed, so two noises on it are the
same field twice unless their variants differ; give them 0 and 1 and
they are two independent draws, which is how a single node yields
several. It defaults to 0, must be a non-negative integer, and is capped
at 2^24, where an f32 stops holding every integer — the GPU may read it
back through a uniform slot, so a variant is a slot number, not a seed.

**It is also the one slot inside `opts` a knob can reach**, as an inline
`{"fn": "param", "name": "variant", "value": 0}` carrying a whole
number — the only spec the slot admits. A panel row over it re-rolls one
noise while the rest hold still, and it is an INTEGER knob, so it steps
by 1 unless a panel says otherwise. What holds it to whole numbers is
the value and not the row: `variant` meets the same non-negative-integer
check wherever it is written, inline `param` and bare literal alike, so
a fractional value fails with the variant's own error rather than being
rounded to a neighbouring draw. A variant NAMES a draw rather than
scaling one, and nothing between two of them is a third.

**Adopting the form re-rolls the noise.** Frequency, amplitude, position
and normalization are untouched, but the field becomes a different draw
from the same family: no function of (graph seed, node id, variant) can
be the identity at a seed nobody named. It is an edit made once and
deliberately, never a silent upgrade of a saved graph.

**A value that has to agree across a seam keeps its literal.** A noise
seeded from its node follows anything that moves that node's seed, so
under a partitioned `World` it is a per-cell field wherever the bind is
not seed-invariant. `graphs/examples-streamed-terrain.json` pins its
density noise to a literal for that reason and says so in its
description.

#### The seed-shift idiom

Background rather than instruction, and the distinction matters: NO
graph under `graphs/` writes this any more. Commit `8faf95d` converted
all 39 folds, across 25 files, to the tagged form above, and a new graph
should use that form. The idiom is still legal grammar, four labelled
fixtures in `tests/foldCorpus.test.ts` pin the constant-fold against it,
and a graph saved before that conversion or an expression written by
hand may hold one — so here is what it computes.

Before `opts.seed` took a tagged form it was read as a plain number and
could hold nothing else, so the only way in was an ARGUMENT position.
`opts.position` is one, and shifting the sample position decorrelates a
noise exactly as changing its seed would. Per axis:

```
offset = A * (fract(nodeSeed * 2^-32 * K) - W0)
```

added outside whatever position the noise already sampled — where the
noise sampled a computed position, this became the first argument of
that `add` — with the shared `nodeSeed * 2^-32` written out twice
because JSON cannot name a subexpression (one axis, `K = 1021`,
`A = 1600`):

```json
{ "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [
  { "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" },
    2.3283064365386963e-10] }, 1021] },
  { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args":
    [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] },
  0.245422363] }, 1600] }
```

Four constants, each answering a hazard the tagged form simply does not
have. `2^-32` is exact — a power of two only moves the exponent — so the
fold reads the seed's HIGH bits rather than the low ones an f32 column
has already rounded away: over 20 000 graph seeds the obvious
`fract(S / 1024)` yields 281 distinct values where this yields 25 107.
Only `add`/`sub`/`mul`/`floor` appear, because those four are bit-exact
across CPU and GPU while `div` sits within a range-ULP and `sin` far
worse, and a one-ULP disagreement INSIDE a `floor` moves the offset by a
whole unit rather than a ULP — which rules out both the textbook modulo
`x - K * floor(x / K)` and the classic `fract(sin(x) * K)` hash.
`A ≈ 32 / opts.frequency` puts the shift about 32 noise cells away, far
enough to decorrelate and near enough that an f32 still resolves a
lattice cell there, which is why no fixed offset scale copies between
graphs: the constant that is comfortable at frequency 0.045 is a
staircase at frequency 14. And `K` differs per noise on one node —
`[1021, 3067, 8191]` for x/y/z, rotated per slot — because a node has
one seed, so several folds of it can only be made to LOOK independent.
Measured over 40 000 graph seeds those three give worst pairwise `|r|`
0.003, where small multipliers like `fract(u)` and `fract(3u)` lie on
straight lines at `|r|` 0.339.

`W0` is the fourth, and it is why the idiom was replaced rather than
merely joined. It is the fold's own value at one graph's default seed —
`W0 = fround(t - floor(t))`, `t = fround(fround(fround(S) * 2**-32) * K)`
— written to **nine** significant figures, since eight fails to
determine an f32 about one case in 160. Subtracting it made the offset
exactly `+0` there, so folding the idiom into a saved graph left its
output bit-identical and added only an effect to the seed box. But it is
correct for exactly ONE (graph seed, node id) pair: a rename, a re-baked
default seed, or a copy into another graph leaves it stale, and a stale
`W0` costs seed-neutrality silently, with no test able to say so. That
was not theoretical — of the 117 `W0` literals the corpus carried, SIX
were wrong, and two graphs shared a triple correct for neither. A
constant a human derives per site is a constant that is wrong somewhere.

Two smaller costs travelled with it. The offset is constant over the
domain and the grammar has no way to say so, so every op in it
materialized a full-length column: `examples-gpu-fields`, ten noise
specs over ~1.6 M attribute elements, cooked about twice as long on the
CPU path (0.61 s to 1.22 s), while on the GPU it was a handful of extra
ALU ops inside a kernel already running. And folding `nodeSeed` inside a
`forEach` body moved the default output whatever `W0` said, because
`forEach` seeds its body as
`hashCombine(nodeSeed, hashString("forEach"), itemKey)` with a
content-derived `itemKey`, so one baked constant could zero at most one
iteration.

#### `param`: a literal something outside can reach

`param` is the only fn with no TypeScript constructor, which is not an
omission: in TypeScript a shaping number is already a variable, and the
problem it solves — a literal buried in a spec that a caller cannot reach
— is a JSON problem.

**Where the value comes from: an enclosing wrapper's exposed param.**
Every exposed param on a `subgraph` node, and on `forEach` and
`repeatUntil`, binds its name into its body's field scope, so a spec
anywhere inside that body reads it by name and the wrapper's knob supplies
it. See
[Subgraph composition](#3-subgraph-composition-code) for the declaration;
a param that exists only to feed an expression declares `targets: []`.

**Binding SUBSTITUTES, and that is the contract rather than an
optimization.** The value is written into the spec before the field is
built, so what cooks is byte-for-byte the field the literal would have
built, `Field.key` included. A value arriving later — at evaluation time,
from the context — would never enter that key, and since the key is what
`stableValueHash` hashes a field as, the node's param hash would not move
and it would serve stale bytes. Substituting instead makes invalidation
exact and free: turning a knob recooks precisely the nodes whose fields
read that name, exactly as editing the number in the JSON would.

**Or from the reference itself: `{"fn": "param", "name": "freq", "value":
0.05}`.** The optional `value` is the spec's own fallback, and it exists
because a wrapper whose only job is to carry a number is a wrapper that
should not have to exist — with one, a PLAIN node's expression is tunable
where it stands. It composes in the one order that makes sense: a binding
wins, and the inline value is what a name falls back to. So the same spec
is tunable standalone and still wrappable, and a wrapper that exposes
`freq` overrides every inline `freq` in its body.

That asymmetry is deliberate and worth stating: a name is
SUBGRAPH-scoped when bound from outside — one exposed `freq` drives every
body spec that mentions it — NODE-scoped when written inline, each spec
carrying its own, and GRAPH-scoped when the document's own `params` block
declares it, one value reaching every slot in the graph that names it
(below). A binding belongs to the binder; a literal belongs to the
expression.

The inline value is also the one binding that survives a save, for the
plainest of reasons: it is written in the spec rather than beside it. A
graph with one reopens supplying itself, where a graph whose values came
from a wrapper reopens needing that wrapper again. Two other rules follow
from what the key must carry: the value moves `Field.key` exactly as
editing the literal would (two knob positions are two fields, never one
served twice), and a param NAME may not contain a `.`, since an editor
addresses a field-spec param as `<nodeId>.<paramKey>.<fieldParamName>`.

**A value written there IS a knob.** The editor's panel enumerates every
`param` in a node's field spec that carries one and offers a control per
name, addressed by that three-part key; `inlineParamValuesOf(spec)` and
`withInlineParamValue(spec, name, value)` are the read and write halves.
The control's type comes from the value's shape — a number is `f32`, a
3-number array `vec3`, a 4-number array `vec4` — so a graph gets a working
knob with no extra files. A reference with NO inline value gets no control,
deliberately: it is an unbound reference waiting for a binder, and a widget
for one would write a literal where its author chose to leave none.

**And the reference says what its value MEANS**, through three more
optional keys beside it: `{"fn": "param", "name": "freq", "value": 0.05,
"min": 0.01, "max": 0.4, "description": "..."}`. They are the subset of
`ParamSchema` a named literal can answer — `type` and `default` come from
the value itself, and there is no `step`, because `ParamSchema` has none
and one vocabulary is enough. Both bounds present make the knob a slider;
`inlineParamMetaOf(spec)` is the reader.

They live in the GRAPH because the form this replaced kept them there. A
subgraph wrapper declares a full schema per exposed param, so flattening
one into inline values used to move its prose into a presentation file and
a graph opened without that file knew less about itself than before. A
panel spec under `graphs/panels/` still refines all three, key by key and
exactly as it refines a registered node param's schema: what a row omits
stays the graph's. What belongs only to the panel is what the graph cannot
know — the row's `label`, its `step`, its `unit`, its section.

The metadata never reaches `Field.key`. The value is in the key because it
changes the answer; a range and a sentence do not, and the per-evaluation
cache is content-keyed on that key — so two nodes holding 0.05 under
different prose still share one column, and editing a description recooks
nothing. What IS checked at parse time is that the description describes
something real: bounds must be finite and ordered, the value must lie
inside them (componentwise for a tuple), and metadata with no `value` to
describe is refused rather than silently ignored.

**With neither, a `param` builds but refuses to evaluate.** Its key is
`param("amplitude")` and its WGSL kernel needs only the name, so a spec
outside any wrapper still validates, hashes and compiles; only producing
a column needs a value. The refusal names the name and the call that
supplies one. On the GPU a `param` lowers to a uniform slot — forced, not
chosen, since `compileFieldSpec` receives a spec and never values — which
is why it costs no storage buffer where the parameter-attribute idiom
spends one of seven, and why twenty values share one compiled pipeline
instead of re-specializing per slider tick.

**Only argument positions can hold one:** `args` entries and a noise
`opts.position`. Structure cannot — `octaves`, `base`, `component`'s
`index`, `attribute`'s `name`, `ramp`'s `stops` — and neither can
`opts.frequency` or `opts.offset`, which are read as plain numbers
rather than as fields. `opts.seed` is the one partial exception, and it
is not a field either: its tagged form's `variant` takes an inline
`param` carrying an integer ([above](#making-a-saved-noise-answer-the-seed-box)),
substituted like any other and never resolved per element. A tunable
frequency has an exact
equivalent, and it is the one the shipped primitives already write: leave
`opts.frequency` at 1 and scale the sample position instead.

```json
{ "fn": "mul", "args": [{ "fn": "position" }, { "fn": "param", "name": "freq" }] }
```

One caveat rides along with it. A position field resolves to an f32
column, so folding the scale in rounds one step earlier than
`opts.frequency` does, which multiplies that same f32 position in f64.
The two agree except at knife edges.

#### One value, many nodes: graph-scoped params

An inline value tunes one expression, and an exposed param tunes one
wrapper's body. Neither reaches the case where one authored quantity —
a cable radius, a truss half-width — is written into six nodes of the
same document. For that the graph itself declares it, in an optional
top-level `params` array, and every expression that names it reads that
one value:

```json
{
  "formatVersion": 1,
  "seed": 7,
  "params": [
    {
      "name": "tubeRadius",
      "value": 0.035,
      "min": 0.005,
      "max": 0.2,
      "description": "Radius of every tube in the rig, in metres."
    }
  ],
  "nodes": [
    { "id": "grid", "type": "pointGrid", "params": { "countX": 8, "countZ": 8 } },
    { "id": "thicken", "type": "transformPoints",
      "params": { "scale": { "fn": "mul", "args": [{ "fn": "param", "name": "tubeRadius" }, 2] } } },
    { "id": "lift", "type": "transformPoints",
      "params": { "translate": { "fn": "vec", "args": [0, { "fn": "param", "name": "tubeRadius" }, 0] } } }
  ],
  "connections": [
    { "from": ["grid", "out"], "to": ["thicken", "in"] },
    { "from": ["thicken", "out"], "to": ["lift", "in"] }
  ],
  "outputs": [{ "id": "lift", "pin": "out", "name": "points" }]
}
```

A reading slot writes the reference and NOTHING else: `{"fn": "param",
"name": "tubeRadius"}`, with no `value` beside it. The value lives in one
place, which is the whole point.

**Binding happens at deserialize, by substitution.** `deserializeGraph`
turns the block into bindings and hands them to every `fieldFromJson`
call it makes for a top-level node param, so the graph that comes back
holds ordinary fields with the number already inside them. A declared
`0.035` is therefore byte-identical to `0.035` written out in each of the
two slots — same `Field.key`, same memo keys, same cooked bytes — which
is the substitution contract stated a few paragraphs above, applied one
scope wider. Cooking is untouched; there is no per-cook, per-cell or
per-context step that could make two readers disagree.

**Turning one re-keys exactly the readers.** `graph.setGraphParam("tubeRadius",
0.05)` rebuilds every authored spec that names it and installs the result.
A non-reader's params are not touched, so its hash does not move and the
next cook serves it from cache; the readers recook because their
`Field.key` moved, and whatever is downstream of them recooks as ordinary
dataflow. The declared `min`/`max` binds that write: the GRAPH enforces
its own range, componentwise, because a hoisted value has no spec of its
own to be refused by and a knob free to write past its declared maximum
would make the range a decoration rather than a rule. One slot shape is
refused rather than rewritten: a field COMPOSED with the constructors
around a spec — `mul(fieldFromJson({"fn": "param", "name": "lift"}), 3)` —
cannot be rebuilt, so it would keep the value it was built with while
every authored expression took the new one. `setGraphParam` names that
slot and stops. Write it as one `fieldFromJson` spec instead.

**One name, one value — shadowing is an error.** An inline
`{"fn": "param", "name": "tubeRadius", "value": 0.04}` in a graph that
declares `tubeRadius` is refused at deserialize, naming the node, the
param, both numbers and both fixes. It is not a precedence rule, because
a graph-scoped param is not "outer": it is the same document as the
expression reading it, so the inline number could never be read and would
publish a second address for one value where turning one of them does
nothing. The rule that a binder beats an inline value still holds where
it was written for — a subgraph binding a body, which is two documents
and where the body must also stand alone.

The rest of the rules, each with a reason:

- **`value` is a literal**: a finite number, or an array of exactly
  three or four of them — a vec3 or a vec4. Any other width is refused
  by name, because the param vocabulary has nothing to call it: a
  two-number array is not a type the format can express. (A TARGETED
  declaration is judged by its merged schema instead, and may hold
  whatever that admits.) Not a spec, and not a reference to another
  graph param — a value that computes is a node, and params referring to
  params would need a topological order and cycle detection for nobody
  who has asked. Write the `mul` at the reading site, or declare both
  values.
- **An array, not an object keyed by name.** `JSON.parse` collapses
  duplicate object keys before any reader sees them; in an array a
  repeated name is detectable, so it is detected and refused. The array
  also fixes the display order.
- **`name` may not contain a `.` or start with `$`.** A knob addresses a
  graph param as `"$<name>"` and a node param as `"<node>.<param>"`, so a
  dot would make the address ambiguous and a leading `$` would let `$$x`
  exist.
- **A declared name nothing reads is legal**, and reported rather than
  refused: it is how a knob is staged before it is wired, and it is what
  a rename leaves behind. `pcg validate <graph.json> --params` prints it
  as `read by nothing`.
- **A reference to a name nothing declares is unchanged**: it builds, and
  refuses at evaluation, exactly as it does anywhere else.
- **A subgraph payload's inner graph may not declare `params`.** A body's
  names are bound by its wrapper's exposed params, which is the one
  binder it has; two binders that can disagree is the failure the derived
  reader check refuses one level up. A graph-scoped value still reaches a
  body, one hop at a time: the wrapper's own param slot holds a field
  built from `{"fn": "param", "name": …}`, the graph binds that at
  deserialize, and the wrapper substitutes into the body at cook.
- **The block is written only when non-empty**, so a graph that declares
  none serializes exactly as it did before the key existed.
- **It is not a per-cell channel.** A graph-scoped param is a property of
  the graph, fixed before the first cell cooks and identical for every
  cell — structurally so, since a value reaches an expression only by
  being substituted when the field is built, and two cells holding
  different values would hold different `Field.key`s. `ParamPatch` gains
  no `$name` form; the seed remains the one graph-level value carried per
  cell.

The address is `"$<name>"` — one segment and a sigil, so it collides with
neither `"<node>.<param>"` nor the editor's bare `"seed"`, and a graph
param named `seed` is addressed `$seed` and is a different knob.
`describeGraphParams` publishes the graph-scoped rows first, in
declaration order, each carrying the `"<node>.<param>"` of every slot that
reads it:

```
params:  12 addresses, 1 declared worth turning (*)
  1 graph-scoped param first, addressed "$<name>" — one value, every slot that reads the name
  the graph's own seed is a knob too, addressed as "seed" (currently 7)

  *  $tubeRadius          f32   0.035    0.005..0.2  read by 2 slots: thicken.scale, lift.translate
     grid.countX          i32   8        >= 1
     ...
```

**The other route: `targets`, for the values an expression cannot carry.**
Everything above is the READ route — a field expression names the param
and the value is substituted in when the field is built. That route can
only carry what a field can carry, which is a number: every field-capable
param in the registry is `f32`, `vec3` or `vec4`. So a declaration may
also list `targets`, an array of `{ node, param }` naming param slots to
WRITE the value into, in write order:

```json
{
  "name": "tubeSides",
  "value": 8,
  "min": 3,
  "max": 32,
  "targets": [
    { "node": "trussChordSkin", "param": "sides" },
    { "node": "wrapWraps", "param": "sides" }
  ]
}
```

Writing rather than substituting is what reaches the other half of the
format — `i32`, `u32`, `bool`, `string`, `enum`, the list types and
non-field vectors — none of which any expression could have carried.
That block is abridged from `graphs/examples-rig.json`, which declares
`tubeSides` as an `i32` narrowed to 3..32 and drives six slots with it:
five `sweepProfile.sides`, plus a `forEach` wrapper whose own exposed
`sides` carries the value on into the cable body. A declaration with
neither a target nor a reader is legal, and
reported rather than refused: it is what a rename leaves behind, and
`pcg validate --params` prints it as `read by nothing`.

The schema a targeted param is judged by is DERIVED from the slots it
drives, through the same resolver a subgraph's exposed param uses, and
the merge rules are the soundness argument rather than a convenience:
`type` and `enum` must be identical across targets, `acceptsField` and
`acceptsInfinite` are ANDed, and bounds intersect — an authored `min`/`max`
may only NARROW what the targets already allow, never widen it. A
declaration therefore cannot claim a capability the params it drives do
not have, which is what lets it reach `i32` and `enum` safely. The
derived schema is not serialized; it is re-derived on every load.

Four things are refused rather than resolved:

- **Two declarations on one slot**, or one declaration listing a slot
  twice. Measured before the guard existed, two params targeting one
  `countX` simply let the last one win — 90 points against 40, with
  nothing said.
- **A target that already holds a field expression.** Writing the value
  would leave the expression in the file and dead in the cook: a
  `translate` of `mul(position, 2)` under a declared `3` cooks a flat
  `3` while the JSON still shows the expression. Drop the expression, or
  drop the target and let the expression READ the name instead — a
  `param` reference inside it binds to the same declared value.
- **A target naming a node or param that does not exist**, listing what
  does.
- **A node literal that disagrees with its driver**, when the loader can
  tell an authored value from a filled-in default. The declaration wins
  on every load, so the literal would be discarded silently.

That last point is the consequence worth carrying away: **a node param a
graph param drives is not independently editable.** The write happens at
deserialize, once, after every node exists, and it is permanent — unlike
a wrapper's write into a body, which happens at cook time and is undone,
because a body is shared and a top-level graph has exactly one owner.
Saving then writes the declaration's current value straight back over the
node's literal. So the number standing in the file for a driven slot is
dead text in both directions, and whatever a knob or an agent writes
there is gone by the next load with no error to say so.

Three exports make this surface reachable from outside:

- `graphParamBindings(params)` builds the binding record `fieldFromJson`
  takes, which is how a `{"fn":"param"}` reference resolves at BUILD time
  — the only moment a value can reach `Field.key`, and therefore the only
  moment it can reach a memo key. It keeps only what an expression can
  hold: a number, or an array of numbers. A declaration carrying a string,
  a bool or an enum is dropped, and an expression naming one stays
  unbound and is reported against the name the author typed. The filter
  reads the VALUE's shape, not whether the param has targets.
- `applyGraphParamTargets(graph, params, authored)` resolves every
  targeted declaration against the nodes it drives, writes the values in,
  and hands back the params carrying their merged schemas. It is exported
  because `deserializeGraph` is not the only thing that builds a graph
  from a `SerializedGraph` — the editor rebuilds its own mirror node by
  node, and skipping this step left every driven slot holding whatever
  the file said instead of what its declaration says. That is the second
  time a hand-rolled rebuild missed a step this performs, so it is the
  thing both call rather than a shape both imitate. `authored` maps node
  id to the param keys that node's JSON actually carried; it decides only
  whether a disagreeing literal is an error, so a caller that cannot tell
  an authored value from a default passes an empty map.
- `strandedGraphParamValues(graph)` is a LINT, and the one that catches
  the failure this whole feature invites: a constant frozen inside a
  subgraph body that was plainly derived from a declared param and no
  longer tracks it. A body is bound by its wrapper and by nothing else,
  so the `params` block cannot reach in; these cook correctly today and
  desync the moment the knob moves. Three conditions must hold at once,
  and the narrowness is the point. The constant must equal the declared
  value EXACTLY, or equal it times √2 — the "half width against half
  diagonal" pair, a relationship no coincidence produces. It must be
  DISTINCTIVE: ten or more significant digits, which is what a computed
  value looks like and not what anyone types. And it must not be a value
  that stands on its own merits (√2, √3 and π over the usual small
  factors, plus the degree/radian pair). Distinctiveness is required in
  BOTH branches, so a √2 relation between two round numbers is not
  reported either. Tuples are matched whole rather than componentwise —
  every component equal, and at least one of them distinctive and not
  self-standing — and they have no √2 branch at all. Each hit is
  `{ name, slot, innerSlot, value }`, `slot` joining nested bodies
  outermost-first with `>`. Its blind spots are stated rather than hidden:
  a body that freezes a declared `0.5` is not caught, and neither is one
  that freezes a declared √2 or π — a short round number matching exactly
  is what a coincidence looks like, and a lint nobody believes is worse
  than none. `pcg validate` reports it with or without `--params`, since
  a suspected defect is worth volunteering, and it does not fail the
  command.

What a save writes back is the REFERENCE, not the value it was bound to:
the declaration stays in `params` and each reading slot round-trips as
`{"fn": "param", "name": "tubeRadius"}`. So the expression is still a
`param` node everywhere that reads specs, and everything said above about
one — its key, its GPU lowering — applies to a graph-scoped reference
unchanged.

### Elementwise combinators

All take `args` with an exact arity. Scalars (tuple 1) broadcast against
any tuple size; other tuple sizes must match. Math runs in f64, results
store as f32.

| Arity | fns |
| --- | --- |
| 1 | `abs`, `floor`, `trunc` (see below — toward zero, not down), `fract` (see below — never negative), `sign` (see below), `sqrt` (negative input is NaN), `exp` (see below), `exp2` (see below — 2^x, not a spelling of `pow(2, x)`), `log` (see below — natural), `log2` (see below — base two), `length` (tuple → scalar Euclidean length), `normalize` (zero tuples stay zero), and trig `sin`, `cos`, `tan`, `asin`, `acos`, `atan` (radians, elementwise) |
| 2 | `add`, `sub`, `mul`, `div`, `min`, `max`, `dot` (tuple → scalar), `distance` (tuple → scalar; see below), `cross` (see below — the one fn that does NOT broadcast), `mod` (see below — floored, not truncated), `rem` (see below — truncated, the other half of that pair), `pow` (see below — a narrowed domain), `step` (args `[edge, x]`, exactly `ge(x, edge)`), `atan2` (args `[y, x]`, radians), and comparisons `lt`, `le`, `gt`, `ge`, `eq`, `ne` emitting 1/0 (`ne` is the exact complement of `eq`) |
| 3 | `clamp` (x, lo, hi), `lerp` (a, b, t), `select` (cond, a, b — cond non-zero picks a), `smoothstep` (edge0, edge1, x — see below) |
| 5 | `remap` (x, inMin, inMax, outMin, outMax — linear, unclamped; degenerate input range yields outMin) |

Several of those carry rules the table cannot hold.

**`cross` is the only width-specific fn in the grammar.** Both arguments
must be tuple size 3, and the scalar broadcast rule is suppressed: a
width other than 3 is refused by name rather than spread, because
`cross(t, 1)` meaning a cross against `[1, 1, 1]` is never what an author
meant. It is right-handed, so `cross(x, y)` is `+z`, and parallel inputs
give zero rather than a direction. The usual use is a frame from a
tangent — `normalize(cross(tangent, vec(0, 1, 0)))` is the horizontal
perpendicular, which collapses to zero where the tangent is vertical.

**`pow` has a narrower domain than a host-language power**, and the
difference is not an edge case. Every negative base is NaN — where
`pow(-2, 2)` would ordinarily be 4 — and so are `pow(0, 0)` and
`pow(x, 0)` for a zero, negative, infinite or NaN `x`. That follows the
identity `exp2(b * log2(a))`, which measured hardware implements `pow`
as exactly; adopting it on the CPU too is what stops the two paths from
silently disagreeing over a whole quadrant. A zero or infinite base
still behaves for a non-zero exponent: `pow(0, 2)` is 0 and `pow(0, -1)`
is Infinity. For a signed power write `mul(sign(x), pow(abs(x), y))` —
`normalize` on a scalar yields the sign too, but `sign` is the name to
reach for. `pow` also carries the widest GPU budget of the parity
table's algebraic fns: `exp` ties it at 8, which is no coincidence,
since measured hardware lowers `pow` to `exp2` of a product and the two
are the same machinery, and only the trig family is wider than either.
So prefer `mul` for a square, `sqrt` for a root, `smoothstep` for a knee
at each end and `ramp` for a falloff whose knees fall anywhere else,
rather than spending it.

**`trunc` rounds TOWARD ZERO, where `floor` rounds toward -Infinity.**
The two agree on every non-negative input and differ on every negative
one that is not already an integer: `trunc(-1.5)` is -1 where
`floor(-1.5)` is -2. An exact integer comes back unchanged, and
`trunc(-0.5)` is -0 rather than +0. Choosing between them is not a
matter of taste — reach for `floor` to BIN a coordinate and for `trunc`
to COUNT whole units outward from an origin. Only `floor` gives bins of
equal width across zero: `trunc` maps both (-1, 0) and (0, 1) onto 0, so
the bin at the origin comes out twice as wide as every other one, which
is a version of the same break `mod` is floored to avoid.

**`mod` is FLOORED, not truncated**, and that is a permanent documented
choice rather than an implementation detail. It computes
`x - y * floor(x / y)`, so the sign of the result follows the DIVISOR:
`mod(-1, 8)` is 7, where JS `%`, C's `fmod` and WGSL `%` all give -1 —
which is `rem`, below. The reason is what the fn is for — wrapping a
coordinate into a tile. A truncated remainder mirrors the tile across
the origin, which puts a visible break
along x = 0 and z = 0, the two lines a world is most likely to be built
around. A zero divisor is NaN on both paths. `fract(x)` is exactly
`mod(x, 1)` and inherits all of it: `x - floor(x)`, so it is
NON-NEGATIVE for every finite input and `fract(-0.25)` is 0.75 rather
than -0.25; a non-finite input gives NaN.

**`rem` is the TRUNCATED remainder, and `mod` and `rem` are one pair.**
It computes `x - y * trunc(x / y)`, so its sign follows the DIVIDEND
where `mod`'s follows the divisor: `rem(-1, 8)` is -1 and `mod(-1, 8)`
is 7. Above zero they are the same number — `rem(9, 8)` and `mod(9, 8)`
are both 1 — and that is exactly what makes picking the wrong one
silent, since nothing goes wrong until an input crosses the origin. A
negative divisor swaps their sides again: `rem(9, -8)` is 1 where
`mod(9, -8)` is -7. `rem` follows the CONVENTION of JS `%`, C's `fmod`
and WGSL's `%` — the sign of the dividend — so it is the fn to reach for
when porting an expression out of a host language, and `mod` the one to
reach for when tiling. It is not the same FUNCTION as a true fmod,
though: a real remainder is exact for any operands, and it gives a zero
result the dividend's sign where this expansion gives +0 (`-8 % 8` is -0
in JS, `rem(-8, 8)` is +0 here). A zero divisor is NaN on both paths.
Both are bit-exact against the GPU by the same construction — the CPU
rounds the divide, the multiply and the subtraction to f32 one at a
time, so it runs the kernel's expansion step for step — and `rem`
inherits `mod`'s limit along with it: once |x / y| passes 2^24 the
quotient can no longer hold an exact integer, and neither path is
computing a remainder any more: `rem(1e9, 3)` is 0 here where JS `%`
says 1, and `mod` does exactly the same thing with the same divisor, so
it is the pair's limit rather than a defect of either.
WGSL's `%` is NOT emitted even though it means the right thing — the
second builtin declined despite correct semantics, after `fract`'s, and
for a stronger reason than that one (which is only that writing it out
costs nothing); `smoothstep`'s is declined for having no semantics at
all on a zero span. The specification defines `%` on floats as
precisely that expansion, but the backends it lowers through need not
agree — a true fmod, as in MSL and SPIR-V's `OpFRem`, is exact for
operands where the expansion has already lost the quotient's low bits
past 2^24 — so the expansion is written out to pin which of the two the
device runs. That is a PORTABILITY argument and measured to be nothing
stronger: emitting `%` leaves the reference adapter's whole parity
table green, past-2^24 probe included, because this adapter does
implement `%` as the spec's expansion. The form is pinned as emitted
TEXT in `compile.test.ts` for that reason — on this hardware no
measurement can tell the two apart. The NAMES are the pair Ada, Common
Lisp, Haskell and Julia use for exactly this floored/truncated
distinction, so the two words carry the semantics between them; `fmod`
was rejected as a name for CONTAINING the other one, which is how the
wrong fn gets reached for in the first place.

**`sign` is `(x > 0) - (x < 0)`**, three values and nothing else, and it
deliberately differs from the host language on two inputs: NaN gives 0
rather than NaN, and -0 gives +0 rather than -0. It is what `normalize`
already does to a scalar, so it buys the NAME rather than the arithmetic
— the same reason `step` exists next to `ge`. Like `step` it lowers to a
pair of comparisons on the device, which is why both are bit-exact.

**`smoothstep(edge0, edge1, x)` leaves FLAT at both ends** — 0 at or
below `edge0`, 1 at or above `edge1`, and `t*t*(3-2t)` over the clamped
`t` between them. Reach for it where the knee belongs at each end of a
range, and for `ramp` where the knees belong anywhere else: a ramp's
stops put the corners where you say, this puts them at the edges and
smooths the join. The expansion is emitted rather than WGSL's
`smoothstep()` builtin, whose result the specification leaves undefined
for `edge0 >= edge1`; a ZERO SPAN is guarded the way `remap`'s
degenerate input range is, giving the step the curve approaches — 1
where `x >= edge0`, 0 below it.

**`exp` and `log` are e^x and its natural inverse.** `exp` overflows to
Infinity above roughly 88.7 and underflows to 0 below roughly -103.9,
which is f32's range rather than this implementation's limit. `log(0)`
is -Infinity and a negative input is NaN, and an arbitrary base is
`div(log(x), log(b))` — except base two, which has its own fn.

**`exp2` and `log2` are the base-two pair, and neither is a spelling of
something the grammar already had.** Both emit the WGSL builtin of the
same name, which is the instruction the hardware actually has. `exp2` is
2^x, and `pow(2, x)` is NOT a synonym for it: measured hardware
implements `pow(a, b)` as exactly `exp2(b * log2(a))`, so `pow(2, x)` is
this fn with a logarithm and a multiply bolted on the front, billed at
`pow`'s parity budget of 8 against this one's 1. Its range is f32's
exponent range and nothing narrower — `exp2(128)` is Infinity and
`exp2(-150)` is 0, where `exp` gives up at about 88.7 and -103.9, the
same two limits in the wrong base — and a whole exponent inside that
range comes back exact. That last part is a construction on the CPU
side only, a power of two being an f32 with a zero mantissa; WGSL gives
`exp2` a ULP tolerance rather than an exactness rule, so the DEVICE
agreeing there is measured on the reference adapter (the edge probe
pins it) rather than guaranteed by the format. `log2` is the inverse: `log2(0)` is
-Infinity and a negative input is NaN, exactly as `log`, and it replaces
the workaround `div(log(x), log(2))`, two transcendentals and a division
standing in for one device instruction. Reach for it whenever the
question is a count of doublings — which fbm octave a frequency belongs
to, how many bits a range needs, how many halvings a level of detail
sits from the root. The base-two pair also measures TIGHTER on the
device than the base-e one does (see the parity table below), for the
same reason it is cheaper: it is what the hardware runs, and `exp`/`log`
are the scaled compositions built on top of it.

**`distance(a, b)` is `length(sub(a, b))`**, a tuple pair reduced to one
scalar exactly as `dot` is, broadcasting the same way, and the absolute
difference on scalars. It is not merely equivalent by algebra: the CPU
rounds the difference to f32 before squaring precisely so that the
single fn and the composed spelling cannot drift apart on either path.
It also measures *tighter* than `length`/`normalize` do, because that
row of the parity table compounds two fns in one spec where this one is
a single square root.

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

Common `opts`: `seed?` (an integer, default 0, or the tagged
`{ "from": "node", "variant": N }` that derives it from the cooking
node's seed — see
[Making a saved noise answer the seed box](#making-a-saved-noise-answer-the-seed-box)),
`frequency?` (position scale, default 1), `offset?` (`[x, y, z]` added
after scaling), `position?` (a nested spec, tuple 3), `normalized?`
(boolean, default false).

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

### Hand-authoring a field (`makeField`)

The grammar above is the *serializable* half of fields, and it is
**elementwise**: every fn sees one element at a time. When what you need
is not that — an order statistic, a whole-column reduction, a table
lookup, a call into a library the grammar has no name for — `makeField`
is the supported way to write the evaluator yourself. It is the same
door `constant`, `attribute` and every noise go through; at cook time a
hand-authored field is not second-class in any way.

It does cost something, and the cost is exact: a hand-authored field
cannot be *described*, so it cannot leave the process. Both halves are
below — write the field, then decide whether you can afford it.

#### What a `Field` is at runtime

Three members and a brand:

```ts
interface Field<N extends number = number> {
  readonly key: string;                 // stable structural identity
  readonly tupleSize: N | undefined;    // components, when statically known
  evaluate(ctx: EvalContext): Column;   // compute the column
}
```

`EvalContext` is `{ geo, domain, seed }` — the geometry, the domain the
field is landing on, and the evaluation seed. `Column` is
`{ data, tupleSize }`, where `data` is a `Float32Array`, `Int32Array` or
`Uint32Array` holding `count * tupleSize` scalars in SoA layout
(element `i`, component `k` at `i * tupleSize + k`). A column may alias
live attribute storage — `attribute(name)` returns a `subarray` of the
attribute, not a copy — which is why callers treat every column as
read-only, and why a held column is valid only until the geometry is
mutated or resized. Index the `Column`, not the attribute behind it: an
attribute's own `data` is `capacity * tupleSize` long and capacity grows
by doubling, so reading it directly runs past the live elements.

`makeField(key, tupleSize, evaluate)` builds one and stamps the brand
`isField` reads. **It is the only constructor.** A plain object literal
`{ key, tupleSize, evaluate }` type-checks as a `Field` — the interface
does not declare the brand — and `isField` still answers `false`.
`isField` is the gate the library asks everywhere, so the literal is not
quietly mis-cached; it is refused at the door, by the param validator,
before the graph is even built:

```text
add: node "setAttribute_0" (type "setAttribute") param "value":
expected a finite number, got {"key":"impostor()","tupleSize":1}
```

The brand is enumerable, so `{ ...field }` is still a field. There is
nothing to import and nothing to stamp by hand: call `makeField`.

#### The one contract: equal keys mean interchangeable columns

`key` is a *structural identity* — kind, params, and child keys — and
**two** caches key on it: the graph executor's node cache (which hashes
a field as `F(<key>)`) and `evaluateField`'s per-context memo. The
library will compute one field and hand the result to another that
shares its key. So every input that can change the column must appear in
the key, and nothing that cannot should. Three helpers exist for exactly
this job, and they are meaningful only here:

- **`elementCount(ctx)`** — how many elements the context's domain
  currently holds. The first line of almost every evaluator: your output
  column must cover exactly that many elements, so its `data` holds
  `elementCount(ctx) * tupleSize` scalars. Read it per evaluation, never
  captured at construction — one field instance is evaluated over
  domains of different sizes.
- **`keyNum(v)`** — a number as key text, `Object.is`-aware: `-0`
  serializes as `"-0"` so it can never collide with `0`. Their columns
  differ, so their keys must too.
- **`keyRef(childKey)`** — embeds a child field's key inside yours,
  length-prefixed. A child key is an arbitrary string — a hand-authored
  one chooses its own — so raw concatenation is ambiguous: `f("x,y", "z")`
  and `f("x", "y,z")` both concatenate to `f(x,y,z)` and would share a
  cache entry, where `keyRef` writes `f(3#x,y,1#z)` against
  `f(1#x,3#y,z)`. Every shipped combinator uses it for the same reason.

Resolve child fields with **`evaluateField(child, ctx)`** rather than
`child.evaluate(ctx)`: it memoizes per context on `key`, so a
sub-expression shared with a sibling is computed once.

#### A worked example

Standardizing a field over the domain — subtract the mean, divide by the
standard deviation — cannot be written in the grammar at any length,
because mean and deviation are properties of the whole column while
every grammar fn sees one element. It reads component 0 of its input:

```ts
import {
  type Column, type EvalContext, type Field,
  elementCount, evaluateField, keyNum, keyRef, makeField,
} from "pcg-ts";

function standardize(of: Field, epsilon = 1e-6): Field<1> {
  const key = `standardize(${keyRef(of.key)},${keyNum(epsilon)})`;
  return makeField<1>(key, 1, (ctx: EvalContext): Column => {
    const n = elementCount(ctx);
    const src = evaluateField(of, ctx);
    const out = new Float32Array(n);
    if (n === 0) return { data: out, tupleSize: 1 };
    let sum = 0;
    for (let i = 0; i < n; i++) sum += src.data[i * src.tupleSize];
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const d = src.data[i * src.tupleSize] - mean;
      sq += d * d;
    }
    const sd = Math.sqrt(sq / n);
    const scale = sd > epsilon ? 1 / sd : 0;
    for (let i = 0; i < n; i++) out[i] = (src.data[i * src.tupleSize] - mean) * scale;
    return { data: out, tupleSize: 1 };
  });
}
```

Both inputs are in the key — the child through `keyRef`, the epsilon
through `keyNum` — so two `standardize` calls with equal arguments are
one field to both caches, and two with different epsilons are two. The
result drops into any field-capable param, and composes with the
combinators in both directions (`mul(standardize(x), 10)` is a field,
and `standardize` takes grammar fields as its input):

```ts
const g = new Graph(7);
const src = g.add(pointGrid, { countX: 2, countY: 1, countZ: 2, spacing: [1, 0, 1] });
const set = g.add(setAttribute, {
  name: "rank", domain: "point", type: "f32", tupleSize: 1,
  value: standardize(component(position(), 0)),
});
g.connect(src, "out", set, "in");
g.output(set, "out", "points");
const { outputs } = await cook(g);  // "rank" is ±1 over the four grid points
```

#### The trade: it cannot be described, so it cannot leave the process

`getFieldSpec(field)` answers "can this be written down as grammar
JSON". For a hand-authored field it returns `undefined`, and the absence
propagates: anything composed over one is undescribable too, because a
combinator derives its spec from its arguments. Three consequences, all
of them the same fact:

- **`serializeGraph` refuses**, so the graph cannot be saved, opened in
  the editor, or pinned as a corpus fixture. It names the node, the
  param and the cause:

  ```text
  node "setAttribute_0" param "value": fieldToJson: this field carries no
  JSON spec, so it cannot be serialized. It was built by makeField, whose
  evaluator is an arbitrary closure that nothing can name — the deliberate
  escape hatch. Rebuild it with grammar constructors (combinators, inputs,
  noise — see listFieldFns), or fieldFromJson
  ```

- **It cannot be cooked off-thread.** The worker pool serializes before
  anything crosses the thread — `cook` takes a `SerializedGraph`
  outright, and `cookCell`, the backend a `World` drives, is handed a
  live `Graph` and calls `serializeGraph` itself. Both paths hit the
  refusal above.
- **It cannot run on the GPU.** WGSL is compiled from the spec; with no
  spec the param evaluates on the CPU and counts a `no-spec` fallback
  (see [Eligibility](#eligibility--what-runs-on-the-gpu)).

What it does **not** cost is cooking. In-process, a hand-authored field
is a first-class node param: it cooks, it caches, it is deterministic on
the same terms as everything else, and the executor's node cache keys on
its `key` exactly as it does for a grammar field.

#### Which to reach for

Write **grammar** — combinator or JSON, they serialize alike — when the
expression is elementwise and the graph has to be saved, opened in the
editor, shipped to a worker, or run on the GPU. That covers every graph
under `graphs/` — a saved graph is JSON, and JSON holds no closures, so
the grammar is the only field language a file can carry.

Write **`makeField`** when the computation is not elementwise or simply
has no name in the grammar, *and* the graph is built in code and cooked
in the same process: a tool, a test, a measurement harness, an
application that constructs its graph at startup and never saves it.

If you need both — the computation *and* a graph that saves — put the
computation in a **node** rather than in a field. A registered
`standardNode`'s params are plain values, so nothing about it has to be
describable as a field expression, and a graph using it serializes like
any other. The field stays inside the node's `execute`, where the
boundary never sees it.

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

A fourth argument gives the wrapper its own params, each fanned out into
zero or more inner `(node, param)` slots. Build them with
`resolveExposedParam`, which DERIVES the schema from the targets'
registered schemas — the author supplies only a name, an agent-facing
description, and optionally a default or narrowed bounds:

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

**`targets` is fan-out, and it is optional.** Every exposed param also
binds its name into the body's FIELD scope, so any spec in the inner
graph may read it as `{ "fn": "param", "name": "amplitude" }` — which is
how a value reaches a number that lives inside a field expression, where
there is no param slot to write into. A declaration with `targets: []`
therefore still affects the cook. It has no inner schema to borrow, so
`default` becomes required and its SHAPE decides the type: a number is
`f32`, a 3-number array `vec3`, a 4-number array `vec4`. Nothing else —
`i32` and `u32` are not derivable, because a field expression has no
integers and deriving one from `3` would promise a rounding the grammar
never performs. And such a param is always field-capable, derived rather
than authored like the rest of its schema: the value is substituted into
the expression before the field is built, and a `Field` substitutes there
as readily as a number — it is spliced in where the reference stands, so
the body cooks the expression an author would have written around it.
That is how a knob varies PER ELEMENT without any plumbing: pass a noise
to a primitive's `amount` and the amount follows the noise.

The body may only read names its own wrapper declares. An undeclared one
is refused at wrap time — naming the slot holding the expression, the
name, and every name the wrapper does expose, so a typo shows its
near-miss — rather than left to the unbound-`param` failure the field
would raise later, once cooking has already started. The one shape that
cannot be rebuilt is refused too: an expression COMPOSED with the field
constructors (`mul(fieldFromJson(spec), 3)`) rather than authored as one
spec would keep whatever value it was built with while the rest of the
body took the instance's, and two expressions reading one name and
disagreeing is the wrong cook worth refusing outright.

Two exposed params may not bind the same inner slot, and one may not list
a slot twice: both are hard errors naming the params and the slot. A
silent last-write-wins would leave a knob that appears to do something,
forces a recook when it changes, and provably cannot change the output.

A third refusal has the same shape. A param may not target a slot that
holds a field expression reading exposed params by name: both writes land
on that one slot in one cook, so either the fan-out replaces the whole
expression with a number or the rebuilt expression replaces the fan-out,
and one of the two provably does nothing. The error names the slot and
the names that expression reads, and gives both ways out — drop the
target and let the expression read the param by name, or move the
expression to a slot nothing fans out into.

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

### 5. Per-instance colour: variation inside one asset (pure JSON)

Splitting into more asset ids is not the only variation channel. Write
a colour-shaped attribute — f32, `tupleSize` 3 or 4 — and name it in
`spawnInstances`' `colorAttr`; components 0, 1 and 2 become each
instance's RGB, so age, health, season or a hue drift vary *within* one
asset:

```json
{
  "formatVersion": 1,
  "seed": 12,
  "nodes": [
    { "id": "scatter", "type": "pointScatterInBounds",
      "params": { "count": 600, "boundsMin": [0, 0, 0], "boundsMax": [60, 0, 60] } },
    { "id": "tint", "type": "setAttribute",
      "params": {
        "name": "tint", "domain": "point", "type": "f32", "tupleSize": 3,
        "value": { "fn": "remap", "args": [
          { "fn": "fbm", "base": "perlinNoise",
            "opts": { "frequency": 0.04, "octaves": 3, "normalized": true } },
          0, 1, 0.45, 1 ] }
      } },
    { "id": "spawn", "type": "spawnInstances",
      "params": { "assetId": "bush", "colorAttr": "tint" } }
  ],
  "connections": [
    { "from": ["scatter", "out"], "to": ["tint", "in"] },
    { "from": ["tint", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [ { "id": "spawn", "pin": "instances", "name": "instances" } ]
}
```

One scalar broadcast across all three components is a brightness drift;
a hue drift is the same shape with a field per component. The batch
comes back with `colors` alongside `transforms` — 3 floats per
instance, `colors.length === count * 3`, in the same instance order —
which the three adapter turns into `InstancedMesh.instanceColor`.

**Alpha is dropped**, and that is stated here rather than discovered:
both three adapters take RGB, so the standard `color` attribute's
fourth component has nowhere to go. Naming `color` itself works fine —
it is f32 `tupleSize` 4 — you just get its RGB. To carry the alpha, or
anything else per instance, use the general channel:
[The per-instance channel](#the-per-instance-channel-the-abi-between-a-graph-and-its-host).

**It is opt-in, and nothing is picked up automatically.** This is the
one place the reasoning differs from primitive-attribute carrying,
which *is* automatic: a primitive attribute exists only because an
author made one, so its presence is the intent. `color` is minted at
`[1, 1, 1, 1]` on every point cloud in this library, so its presence
means nothing at all. The cost of enabling it anyway is not the wasted
floats — setting `instanceColor` flips three's program variant
(`instanceColor !== null` forces the `vColor` varying and a shader
recompile) for zero pixels changed. Nor does anything scan the column
to auto-enable when it is not all white: that is O(n) every cook *and*
makes the renderer's shader variant depend on the data.

So the accepted cost, which is worth knowing before it bites: **write a
colour upstream, never name it in `colorAttr`, and you get silence.**
Nothing warns, and the instances draw in the asset's own colour. The
error path is the other half — a `colorAttr` naming an attribute that
is missing, or one that is not f32 with `tupleSize >= 3`, is refused
with a message listing the point attributes that *would* fit and two
ways out (write one with `setAttribute`, or leave `colorAttr` empty).

**One cook may spawn at most 1 048 576 instances**, one per input
point — 64 MiB of transforms — checked before anything is allocated, so
a density typo is a diagnostic naming the count and the fix rather than
an allocation failure. Thin the cloud upstream (a lower scatter count,
`filterByDensity`, `selfPrune`) or cook the region in cells. The
ceiling is per **cook**, never per world: a limit on instances *alive*
would depend on which cells happened to be resident, so the same world
would fail or not depending on the order it streamed in — exactly the
order-dependence the determinism invariant forbids. A streamed `World`
may hold many times the budget across its live cells, and that is
correct.

## The per-instance channel: the ABI between a graph and its host

Colour is one channel out of a general mechanism, and the general one is
worth stating on its own terms because of *why* it has to exist.

**The field grammar has no time input, and that is deliberate.** A
graph produces STRUCTURE; the host animates it. Nothing inside a cook
can be a function of the frame, so anything the host must drive per
instance at runtime — a phase offset, a stable id, a species index, an
RGBA tint, a wind stiffness — has to leave the graph as *data*. That
makes `spawnInstances`' `instanceAttrs` the ABI between the two: before
it existed only transforms and RGB could cross the spawner, and a host
had to re-derive everything else from a position, which stopped
agreeing with the graph that authored it the first time either side
changed.

`instanceAttrs` is a `stringList`, default `[]`: point attribute names,
carried in the order given.

```json
{ "id": "spawn", "type": "spawnInstances",
  "params": { "assetId": "reed",
              "instanceAttrs": ["phase", "windStiffness", "plantId"] } }
```

Each named attribute becomes `batch.attributes[<the attribute's own
name>]` — the name is not remapped, so what an author wrote upstream is
what a shader reads:

```ts
import { instanceAttributesOf } from "pcg-ts";

for (const item of outputs.instances) {
  if (item.kind !== "instances") continue;
  for (const batch of item.batches) {
    const channels = instanceAttributesOf(batch);  // the ONE form to read
    channels.phase;      // Float32Array, count * 1
    channels.plantId;    // Uint32Array,  count * 1 — still u32
  }
}
```

**Read channels through `instanceAttributesOf(batch)`, not off
`batch.attributes`.** It is the one form that is always right. Every
adapter in this library starts there and special-cases exactly one name,
which is why the two spellings of colour never became two code paths.

**The lift is keyed on the reserved colour CHANNEL, never on whether
`attributes` exists.** That distinction is the whole rule, and getting it
backwards is what a hand-built batch pays for:

| the batch | what you get back |
|---|---|
| no plain `colors` | its own `attributes`, or a shared frozen empty record when it has none |
| plain `colors`, no `"color"` channel | `{ ...attributes, color: colors }` — with `attributes` **absent**, `{}`, or holding other channels alike |
| both spellings, **same** buffer | `attributes` unchanged |
| both spellings, **different** buffers | it **throws** (below) |

Spreading `undefined` is `{}`, and a spread copies own enumerable keys —
the same set — so absent, empty and populated `attributes` are one case
and not three. `{ attributes: {}, colors }`, which is what a host writes
when it fills the record generically and finds nothing to put in it, and
`{ attributes: { phase }, colors }`, which is the same defect one channel
later, both keep their colour.

> Earlier versions lifted only when `attributes` was **absent**, and
> silently dropped the colour in the other two shapes. If you are reading
> an adapter — or a doc — that still says "when the batch has no record",
> it is a version behind this one.

"Already carries that channel" means an **own, enumerable** property, the
set `Object.keys` / `Object.entries` / a spread report and the only set an
adapter can loop. A `color` reachable only through a prototype (a host
layering its channels over a defaults object) or hidden as
non-enumerable does not count as present, so your plain `colors` is
lifted rather than dropped in favour of a channel nothing downstream
could enumerate.

**The one shape that throws: two different colour buffers.** They are one
thing spelled twice, so nothing could pick a winner without silently
discarding the other — the normalizer refuses instead of guessing. The
error names the batch, both spellings with their lengths, and the two
ways out:

```
instanceAttributesOf: batch "reed" carries two different colour buffers —
attributes["color"] (1800 elements) and colors (1800 floats). `colors` is
sugar for the reserved "color" channel and not a second buffer, so there is
no rule for which one a renderer should draw. Set exactly one of them: keep
the channel and omit `colors`, or keep the plain `colors` and drop the
"color" entry from attributes. (Batches the library mints install `colors`
as an accessor over the channel, so the two can never disagree there.)
```

**You cannot hit it with a batch this library built**, which is why the
error is worded at hand-built ones. The internal constructor the spawner
and the worker's decode mint through installs `colors` as an *accessor*
over the reserved channel, so the two spellings are the same array by
construction and the identity test always passes. That constructor is
deliberately **not** exported, which is why the message states that
property as the reason library batches are safe rather than offering it as
a call you could make. Your fix is **set exactly one spelling**: keep the
`"color"` channel and omit `colors`, or keep the plain `colors` and drop
the channel. Setting both to the *same* array is fine and is not the error
case.

A caller building a batch writes the object literal the `InstanceBatch`
type documents and reads it back through `instanceAttributesOf`, which is
published for exactly that half of the job.

**The layout.** A channel is one tightly packed column of
`count * tupleSize` elements, instance `k` at `k * tupleSize`.
`itemSize` is **derived** by the consumer as `column.length / count`
and is not carried on the CPU batch — so there is no second place for it
to be wrong and no stored copy that can disagree with the buffer it
describes. `toInstancedMeshes` recovers it exactly that way, and refuses
a column that is not a whole number of components per instance rather
than reading a prefix of it. (The device twin does carry it, and has to:
`DeviceInstanceAttribute.itemSize` is the width the *author* asked for,
which a device buffer cannot be measured for because WGSL pads a
3-component channel to four slots.)

**Instance order is the invariant everything else rests on**:
`attributes[name][k]` and `transforms[k]` are the same instance, for
every channel, on every path. The spawner writes them in ONE loop from
ONE source index, so there is no second traversal that could fall out of
step. `tests/instanceAttributes.test.ts` pins it anyway, because a host
cannot check it and every consumer assumes it.

**The dtype is preserved, not widened to f32.** A channel is a point
attribute that crossed the spawner carrying the element type it had on
the point domain — `f32`, `i32`, `u32` or `bool`, backed by
`Float32Array` / `Int32Array` / `Uint32Array` / `Uint8Array`. That is
`src/data`'s own `AttrType` vocabulary rather than a second one. The
reason is exactness rather than tidiness: **f32 carries a 24-bit
mantissa, so consecutive integers stop being representable past 2^24
(16 777 216)** — an id above that lands on its neighbour and two
instances become one instance to a host keying on it. Nothing
downstream wants the widening either:
`THREE.InstancedBufferAttribute` takes any typed array.

> **The 2^24 collision belongs to the COLUMN, not to the binding, and a
> `u32` channel needs no `gpuType`.** This box said the opposite twice,
> so the provenance of each claim below is marked. The `u32` and
> f32-column ones are MEASURED, on a real draw call with a pixel
> readback — `tests/instanceChannelRender.test.ts`, in a browser. Two of
> its cases (`f32-tint`, `u32-default-gpuType`) also run under
> `WebGPURenderer` and agree byte for byte; the f32 widening and the
> `IntType` comparison run under WebGL only, so do not promote them to
> "both renderers". The `Uint8Array` and `Float32Array` ones
> are READ OUT OF three's source (r185) and the WebGL2 rules: nothing in
> this repo binds those two yet.
>
> **A `Uint32Array` channel arrives exact with `gpuType` left alone.**
> `WebGLAttributes` maps `Uint32Array` to `gl.UNSIGNED_INT` (and
> `Int32Array` to `gl.INT`), and `WebGLBindingStates` picks the integer
> pointer call as `type === gl.INT || type === gl.UNSIGNED_INT ||
> geometryAttribute.gpuType === IntType` — `gpuType` is the third
> disjunct, so for a 32-bit integer typed array it is short-circuited
> before it is ever read. The same four ids at 2^24 and above read back
> BYTE-IDENTICALLY with the flag unset and with `IntType` set (red bytes
> `[0, 40, 80, 120]`, blue `1` for all four, so the top byte survived
> too). Do not add the line. A no-op that reads as a requirement is
> worse than no line at all: it gets copied into codebases that never
> measure it, and then nobody can retire it.
>
> **The WebGPU/TSL path reaches the same three rules by a different
> route, which is why they are rules and not an artefact of the classic
> renderer.** Everything above is WebGL evidence; `three.webgpu.js`
> carries `gpuType` in exactly two places, and only the second is news.
> `getTypeFromAttribute` (`three.webgpu.js:65256-65272` in 0.185.1)
> starts from the node type and DEMOTES it:
>
> ```js
> if ( /^[iu]/.test( nodeType ) && attribute.gpuType !== IntType ) {
>   const array = dataAttribute.array;
>   if ( ( array instanceof Uint32Array || array instanceof Int32Array ) === false ) {
>     nodeType = nodeType.slice( 1 );   // i32/u32 -> f32
> ```
>
> So an integer node type falls back to float UNLESS the array is
> 32-bit integer, or `gpuType` is `IntType`. That derives all three
> cases rather than observing them: a `u32`/`i32` column is exempt by
> the array check and needs no flag; a `Uint8Array` is NOT exempt and
> demotes unless the flag is set, which is the same conclusion the draw
> call reached for `bool`; and a `Float32Array` never matches
> `/^[iu]/`, so the branch is not entered at all. The other occurrence
> (`:67068`) is the bundled WebGL backend restating the disjunct above.
> **An earlier version of this note claimed `gpuType` appears zero
> times under three's WebGPU renderer. It appears twice**, and the one
> that matters is the one that explains `bool` — the correction came
> from an integrator who checked rather than took our word.
>
> **Where the flag IS load-bearing: any integer array narrower than 32
> bits — `Uint8Array` among them**, which is how a `bool` channel is
> stored. `gl.UNSIGNED_BYTE` fails both GL-type tests, so `integer` is
> decided entirely by `gpuType`, and with it left at `FloatType` the
> pointer call still succeeds — the failure lands at the DRAW, as
> `INVALID_OPERATION`, because a float-path pointer cannot feed an
> integer shader input. Set it, and declare that channel `in uint`: the
> WebGL2 rule is three-way, and `gl.UNSIGNED_BYTE` on the integer path
> against an `in int` is the same error again. **Where it is actively
> harmful: a `Float32Array`.** That expression carries no guard on the
> array class, so `IntType` there makes three call
> `vertexAttribIPointer` with `gl.FLOAT`, which that entry point does
> not accept — `INVALID_ENUM`, raised synchronously at the pointer call,
> which then does nothing, so the attribute quietly keeps whatever state
> it already had. **three's own JSDoc denies this**: `BufferAttribute`
> documents `gpuType` as having "an effect for integer arrays" only and
> being "not configurable for float arrays", and the code enforces no
> such thing. Read the source, not the doc comment — that disagreement
> is why this paragraph is worth its length. So "set it to be safe" is
> unsafe in both directions: the flag chooses which pointer call to
> make, and only one of them is legal per buffer type. And it is a
> WebGL concept — native WebGPU takes the vertex format from the array's
> constructor and never reads it (zero occurrences under three's
> `renderers/webgpu/`, which also widens a `Uint8Array` to
> `Uint32Array` before upload, so even a bool channel needs no flag
> there). It survives on that side only in the WebGL2 fallback backend,
> in two places: the attribute binding, which repeats the short-circuit
> verbatim, and the GLSL node builder, which reads it with the opposite
> polarity and exempts the 32-bit integer arrays all the same.
>
> **A dtype mismatch at the shader is loud, not lossy.** Declaring a
> `u32` channel as `in float` does not quietly round it: WebGL2 rejects
> it — observed as `INVALID_OPERATION` (`0x502`) with no fragment
> written, on the adapter this ran on. The test pins the loudness (a GL
> error, or nothing drawn) rather than either specific, because the code
> is the driver's.
>
> **So the 2^24 hazard is upstream of all of this, in the column
> itself** — which is the honest motivation for preserving the dtype.
> Carry `[2^24, 2^24+1, 2^24+2, 2^24+3]` through an f32 column and the
> same shader reads back `[0, 0, 80, 160]`: the first two ids are one
> f32 and therefore one pixel, while the last two are not — an asymmetry
> that "the attribute never arrived" cannot produce. Keeping a column
> `f32` end to end and converting in the shader
> (`int(attribute('aOrigIndex', 'float'))`) is exact only while the
> values stay under 2^24, and is the right choice precisely when they
> do. `demos/lanterns` draws both columns of the same ids side by side.

**A node is the unit of yielding, so one expensive node is a floor.**
Under `cook(graph, { budgetMs })` the executor yields between nodes, never
inside one: it checks the budget after a node returns. A single leaf node
that costs 20 ms therefore blocks for 20 ms whatever budget you set, and
the fix is to make it cheaper, split it upstream, or cook it off the main
thread through `pcg-ts/worker`. The composites are the exception and meter
the budget themselves — `forEach`, `repeatUntil`, `subgraph` and the
resident GPU run — which is why the `forEach` section below can say budget
is honoured inside iterations without contradicting this. `skills/performance-and-budgets`
carries the full rule and the partition-safety check built on it.

**Which nodes those are is PUBLISHED — never hardcode the list.** A
self-metering node's timing means something different from every other
node's, and nothing observable at the seam distinguishes the two, so the
library states the fact in two machine-readable places:

- `NodeTypeInfo.selfMetered` — `true` on `subgraph`, `forEach` and
  `repeatUntil`, absent on every other type, exactly as an absent
  `category` means uncategorized. Read it from `listNodeTypes()`,
  `pcg nodes <type> --json`, or the generated catalog
  ([nodes.json](./nodes.json), [nodes.md](./nodes.md)) — **without
  cooking anything**. A node type
  declares it with `NodeDef.selfMetered`, beside `gpu` and `resident`,
  so a third-party node that meters the budget joins the set by saying
  so.
- `NodeDoneInfo.selfMetered` — per entry, on every `onNodeDone` report.
  `false` means the executor timed one uninterrupted run and `elapsedMs`
  is a real block. `true` means it is wall time that may span the node's
  own yields.

The fourth case, the resident GPU run, is deliberately absent from the
catalog: it is a property of the RUN and not of any node type. No
resident-capable type declares `selfMetered`, because on the per-node
path (no resolver, or a rejected plan) `setAttribute` and friends really
are atomic. The executor instead flags the fused run's **terminal** — the
member that carries the whole run's elapsed time, and the one whose work
crossed into `executeRun`, which receives `budgetMs` and yields between
member kernel encodings. Interior members report `elapsedMs` 0 and
`selfMetered` false. So a node type's catalog entry answers "is this type
ever non-atomic on its own"; the per-report flag answers "was THIS
number".

**A budgeted `elapsedMs` includes yield latency and is not work.** This
is the trap the flag exists for. Each `setTimeout(0)` costs about a
millisecond on an idle loop, a self-metering node under a small budget
takes many, and the wall time it reports is dominated by them: one
measured `repeatUntil` reported **25.6 ms** unbudgeted and **450.7 ms**
at `budgetMs: 1` — a 95x overstatement of a node whose longest real
block is ~4.7 ms. `CookStats.elapsedMs` for the whole pass is wall time
for the same reason. Rank budget settings on those numbers and you rank
the most launchable setting as the worst.

**To derive a longest-block figure, cook once with the budget UNSET.**
Every budget check in the library is `budgetMs !== undefined`, so nothing
yields on the budget then: every `elapsedMs` is a true uninterrupted
block and the largest is the floor no budget can lower. Use the budgeted
cook to check responsiveness — that the page got control back — not to
compare durations, and ignore a flagged entry's duration entirely when
the two runs are being compared. The one number a budgeted cook reports
that is directly comparable is an UNflagged node's, because that path is
identical either way.

**`"color"` is reserved and `instanceAttrs` refuses it by name.** A
renderer treats colour *structurally* rather than generically — three
hangs it on `InstancedMesh.instanceColor`, a mesh property that flips
the shader variant, not a geometry attribute — so a channel that merely
happened to be called `color` would be uploaded twice and mean two
things. `colorAttr` is its route, and `InstanceBatch.colors` is sugar
for that same reserved entry: one buffer, two spellings, kept only so
consumers written against the older shape keep working. To carry RGBA —
which `colorAttr`'s alpha drop cannot — copy the attribute to another
name upstream and name *that* in `instanceAttrs`.

**`string` channels are refused, and the refusal is not a limitation to
work around.** A string column's data is indices into a per-attribute
string table, and the table does not cross the spawner with the column,
so a renderer would receive meaningless integers. The case that really
wants strings — per-point asset ids — has its own route, `assetAttr`,
which resolves them to batches before anything leaves the graph.

**Five things error**, each naming the offending entry and the way out:
an empty name in the list, the same name listed twice (a channel is
named after its attribute, so a repeat would be one channel listed
twice), the reserved name `color`, an attribute that is not on the
point domain (the message lists the point attributes that *could*
become channels), and a `string` attribute. The reserved-name check runs
*before* the lookup, so `color` reports as reserved even when no such
attribute exists.

Those messages are raised by `buildInstanceBatches`, which is what
prefixes them — the spawner's `assetAttr` and `colorAttr` diagnostics
follow the same convention, so grep for the param name rather than for
the node type.

**Absent, not empty, is the default.** `instanceAttrs: []` carries
nothing and allocates nothing, and `batch.attributes` is then absent
exactly as `colors` is absent when no colour was asked for.

**What a renderer does with them.** `toInstancedMeshes` sets each
non-reserved channel on the mesh's geometry as an
`InstancedBufferAttribute` under the channel's own name. A batch
carrying any such channel therefore gets its own geometry **clone** —
the asset's geometry is shared with every other batch and must not be
written — marked by `ownsGeometry(mesh)` and disposed by whoever
disposes the mesh. Colour alone does not clone, since `instanceColor`
is a mesh property. Two refusals live on that seam rather than at the
spawner: a channel named after something three already means
(`position`, `normal`, `uv`, `instanceMatrix` and seven more) is
refused instead of overwriting the asset's vertex data, and a channel
wider than 4 components is refused because a vertex attribute cannot
carry more — split it upstream into several narrower ones. Both are
unconditional, because both describe a batch that is wrong on its own
terms. A third refusal lives on the same seam but is OPT-IN, because
what it checks is a batch that is wrong only relative to the caller's
materials — see `requireChannels` below.

**A channel the material declares and no batch carries reads ZERO.** It
is worth stating plainly because it does not look like a failure: every
fragment runs, no exception is thrown, and no GL error is queued. A
per-instance size, phase or hue collapses to a single value, so the
picture is *every instance identical* — which reads as a content mistake
rather than a binding one. Measured on three 0.185.1 in
`tests/instanceChannelRender.test.ts`, which draws it and reads the
pixels back under both renderers. Four things are worth telling apart:

- **Whether anything SAYS so depends on how you declared it, and this is
  the half to plan around.** A `ShaderMaterial` under `WebGLRenderer`
  prints nothing at any severity: an unbound float attribute has a
  legitimate meaning to the classic renderer — the generic
  vertex-attribute constant, `(0, 0, 0, 1)`, so `0` for the `float` and
  `vec3` declarations that make up most channels, though an `in vec4`
  gets `w = 1` — and it is used without comment. A `NodeMaterial` under
  `WebGPURenderer` warns by name as the node builds:
  `THREE.AttributeNode: Vertex attribute "tint" not found on geometry.`
  Same batch, same mistake, a usable diagnostic in one host and none at
  all in the other. Those are the two pairs measured; that the deciding
  factor is the MATERIAL rather than the renderer is inference from
  `AttributeNode` living in three's backend-agnostic node core, not
  something the suite varies independently.
- **A stale name map is the realistic cause, not a typo.** A host whose
  shader owns the attribute names carries a map from a graph's channel
  names onto its own; when an entry goes stale, nothing is malformed. The
  batch is a valid channelled batch, the material is a valid material,
  and neither can see the other.
- **An INTEGER declaration fails loudly instead.** `in uint` with nothing
  bound is not a constant, it is invalid, so WebGL2 refuses the draw with
  `INVALID_OPERATION`, no fragment appears at all, and the driver warns.
  So the silent case above is narrower than "a missing channel": it is a
  FLOAT declaration in a `ShaderMaterial` — which is most of them, but
  both axes matter.
- **Two batches of one asset id, only one carrying the channel, is the
  same failure with nothing misspelled anywhere.** Each mesh's material
  is a clone of one source, so three compiles ONE program for the pair
  and the unchannelled mesh shades through a pipeline built for
  attributes its geometry has not got. Its instances read zero while its
  sibling's draw correctly, in one scene, from one asset.

This is three's behaviour rather than the library's, and by default the
library does not intercept it: `toInstancedMeshes` binds what the batch
carries and never sees what the material declares.

**`requireChannels` is how you say what your materials declare, and turn
that silence into a named error.** Pass it as the optional third
argument and a batch missing one of the names is refused instead of
drawn:

```ts
import { toInstancedMeshes } from "pcg-ts/three";

const meshes = toInstancedMeshes(batches, assets, {
  requireChannels: ["tint", "gain"],
});
```

```
toInstancedMeshes: batch "tree" does not carry the required per-instance
channels "gain", "tint"; it carries "seed". requireChannels asked for
"gain", "tint". Nothing downstream would refuse this: three binds only what
the batch carries and never sees what the material declares. A material
declaring "gain" as a FLOAT reads it as ZEROS for every instance — the
fragments still run and write black, every instance draws identical, and a
ShaderMaterial under WebGL logs nothing at any severity. Declared as an
INTEGER it fails loudly instead, and the symptom looks unrelated: WebGL2
refuses the draw with INVALID_OPERATION and nothing is drawn at all. The
usual cause is a stale
channel-name map: compare the two lists above, then either publish the name
from the spawn (spawnInstances' instanceAttrs, or colorAttr for the
reserved "color" channel) or drop it from requireChannels.
```

The two name lists are the point. The realistic cause is the stale map
above, and a stale map is diagnosed by reading the names the host expects
beside the names the content actually shipped — so the error carries
both, and the batch's own list is sorted so you can compare it by eye.
`(none)` is a common and meaningful value for it.

Four things about the shape are deliberate:

- **Opt-in, with no default.** Omit the argument (or pass `{}`, or an
  empty list) and nothing changes at all — same meshes, same errors.
  Plenty of callers legitimately draw batches with no channels, so an
  expectation the library invented for them would be wrong more often
  than right.
- **Per CALL, not per asset id.** One list, checked against every batch.
  Keying it by asset id would add a second map beside the stale one this
  exists to catch, and an asset id that map failed to name would be
  silently unchecked — a hole in the shape of the hole. Checking every
  batch is also what catches the fourth bullet above, the two batches of
  one asset id, without the caller having had to think of it. A host
  whose assets genuinely need different channels partitions its batches
  and calls the function once per group, which is the same partition it
  already makes when they need different materials.
- **The reserved `"color"` is expressible**, and satisfied by either
  spelling — `attributes.color` or the plain `colors` sugar — because
  presence is read through `instanceAttributesOf`, where the lift has
  already happened. Its failure is a DIFFERENT picture and the error
  states that one instead of the zeros: three leaves `instanceColor`
  null, `USE_INSTANCING_COLOR` never turns on, and every instance draws
  the material's own colour rather than black. A host sent looking for
  black instances by a message that did not separate the two would not
  find any, and would conclude the error was wrong.
- **It is not an alias map, deliberately.** There is no option to rename
  a graph's channel onto a host's attribute name. That mapping is
  per-content data belonging to the host; a library-level copy of it
  would be a second home for the one mapping, which is how the entry goes
  stale in the first place.

**Carrying a name means what BINDING means**, which is narrower than
having the key. A batch satisfies the expectation only when the name is
an OWN, ENUMERABLE key of its channel record AND holds an actual column.
Both halves are load-bearing and both are the stale map's own shapes: a
name reachable only through a prototype is invisible to the loop that
binds channels, and a key holding `undefined` is what the ordinary host
loop writes —

```ts
for (const name of wanted) attributes[name] = columns[name]; // a miss writes undefined
```

— which type-checks, because this project does not enable
`noUncheckedIndexedAccess`. Under a key-presence test both would report
as satisfied while `toInstancedMeshes` bound nothing, which is a hole
reported as coverage — strictly worse than no check. For `"color"` in
particular the consequence is the silent one: `instanceColor` stays null
and the instances draw the material's own colour, with the expectation
having said the batch was fine.

The refusal reports the two states apart, so the name it calls missing
never also appears in the list of what arrived:

```
… does not carry the required per-instance channel "tint"; it carries
"phase" ("tint" is present but holds no column). requireChannels asked
for "tint". …
```

A present-but-empty key is named rather than dropped, because it is a
sharper reading of a stale map than the name silently vanishing: it says
the loop that fills the record ran and found nothing.

**A name three already means something by is refused up front.** Naming
`position`, `normal`, `instanceMatrix` or the other eight in
`requireChannels` throws immediately, before any batch is examined,
because the loop refuses a batch that CARRIES such a channel — so the
expectation could never be satisfied, and the per-batch refusal would
otherwise advise publishing the name from the spawn, which is exactly
what the reserved-name guard rejects. `"color"` is not on that list and
is requirable: it rides `mesh.instanceColor`, not the geometry. Note the
ordering: this is a defect in the CALL rather than in a batch, so it is
reported ahead of per-batch errors that would otherwise come first (an
unknown asset id, a bad transform length). Callers that pass no
expectation see the old order untouched.

Zero-instance batches are checked too. One cannot draw a wrong picture
yet, but exempting it would be another hole of the same shape, and a
batch missing a channel at count 0 is the batch that will be missing it
at count 500. A zero-instance batch satisfies the expectation by carrying
the name with an EMPTY column, which is the only length a channel may
have at count 0 anyway. A named channel then binds nothing, since there
is no item size to recover from zero instances; the reserved colour is
asymmetric here and DOES produce an `instanceColor` attribute, because a
zero-length `Float32Array` is truthy and colour carries no derived item
size. Neither matters at 0 instances — nothing draws — and the shape is
refused as soon as the count is real.

**"CPU-only" is a statement about one of three things, and it is worth
separating them before you plan around it.** The phrase has been read
here as "this stalls your frame", which is the opposite of what is true.

- **Producing** a channel on the GPU device: **opt-in.** The evaluator's
  `deviceInstanceAttrs` (which requires `deviceInstances`) gathers each
  named channel into its own device buffer beside the transforms; with
  it off — the default — a spawn naming any `instanceAttrs` channel
  rejects the resident run as `run-plan-failed` and the CPU spawner
  serves the whole terminal. The flag exists because production hands
  the host an OBLIGATION rather than because the gather is hard: a named
  channel is bound by the host, not by the renderer, and the
  device-resident adapter this library ships refuses every channel but
  the reserved colour — so turning it on unconditionally would break a
  graph that renders through it today. See
  [Device-resident instancing](#device-resident-instancing-drawing-without-a-readback).
  Note what this does *not* cover: the reserved `color` channel IS
  composed on the device unconditionally (that is what `colorAttr`
  does), so "no gather channels on the device" would be wrong either
  way.
- **Rendering** a channel under a `WebGPURenderer`: **supported, and the
  device-production limit does not touch it.** `toInstancedMeshes`
  imports only `three` and branches on nothing renderer-shaped; an
  `InstancedBufferAttribute` is as valid under `WebGPURenderer` as under
  `WebGLRenderer`. A CPU-produced column reaching a WebGPU material is
  the whole supported path for per-instance data in your shaders, and it
  is the one to plan on. What the library ships is the DATA, not the
  shader: nothing here imports `three/tsl` or writes a material, and
  `normalized`/`gpuType` are left at three's defaults, so declaring the
  attribute (a TSL `attribute()` node, a `ShaderMaterial`, an
  `onBeforeCompile` patch) — and the shader-side type of an integer
  channel — is yours. Do NOT reach for `gpuType` on the way: a 32-bit
  integer typed array selects the integer pointer call by itself, and
  the flag matters only for the narrower integer arrays (`Uint8Array`
  among them, which is how a `bool` channel is stored) — the box under
  "the dtype is preserved" above carries the whole rule, including the
  array type where setting it breaks the draw instead.
  **Scope of the word "supported":** `demos/lanterns` binds a `u32`
  channel and draws with it, and `tests/instanceChannelRender.test.ts`
  issues real draw calls in a browser and reads the pixels back under
  both renderers — so the pixels are measured now, not merely intended.
  The one place a custom channel is refused on the WebGPU side is the
  *device-resident* adapter, which binds only the two channels three
  treats structurally; see below.
- **Cooking** on the main thread: **not required.** `pcg-ts/worker`
  cooks off-thread, and `EncodedInstanceBatch.attributes` carries every
  named channel — colour among them, since `colors` is an accessor over
  the reserved entry and has no wire form of its own. Every column rides
  the structured-clone **transfer list**, so the batch arrives on the
  main thread as buffer ownership rather than as a copy. The worker pays
  one `slice()` per column on its own thread (the cook's arrays alias
  live memo caches and must not be detached); the main thread pays
  nothing. "CPU" here means "not the GPU device", never "on your frame".

So a host that wants per-instance data in a WebGPU material has a
complete path today: cook in a worker, receive the channels zero-copy,
bind them with `toInstancedMeshes`, read them from your own material —
remembering that each channelled batch gets its own geometry clone to
dispose, as above.
Having the device *produce* those channels without a readback is the
other route, and it is the one that asks you to bind the buffers
yourself: `deviceInstanceAttrs`, above.

If your material is **pooled or shared** across meshes, pass
`materialFor`. It is asked once per batch and the material it returns is
used AS-IS — no clone is minted, so there is nothing to displace and
nothing to dispose. Return `undefined` for a batch to take the default
clone instead, which is the per-asset lever: pool for the assets your
shader knows and let the rest clone. A multi-material asset must be
answered slot for slot, and SHAPE binds rather than count — an array is
what puts three on its per-group path, so a 1-element array is not a
spelling of a single material and is refused by name.

**What you take on with it.** In three r185 the `dispose` event of a
mesh's material is the only trigger that releases that mesh's render
state, so a material you share across meshes never fires it and the
library will not dispose it for you (`materialFor` marks the mesh, and
`WorldThreeBinding` honours the mark on evict, recook and teardown).
Left unmanaged that is a real leak, measured at 1911 → 8821 programs and
+22 MB in six minutes. The way to hold it is to pool the MESHES, not
only the materials: a fixed ring of `(InstancedMesh, material)` pairs
sized to your live-cell ceiling, geometry swapped and `.count` set on
cell-ready, keeps the pair stable so three's per-mesh entry is reused
instead of accumulating.

**The clone is not the compile, but a fresh MESH can be** — and the two
are worth keeping apart, because reading the first as the second invites
churning meshes freely. Cloning a material costs no extra program: WebGL
keys its cache on shader source, and WebGPU's `getMaterialCacheKey` skips
`uuid`, `name` and `version`, so clones with identical parameters resolve
to one program. Creating a fresh `InstancedMesh` is the other question.
`RenderObject.js` folds `object.uuid` into the cache key for any
instanced object, which forces a fresh node-builder build per mesh; the
program is then looked up by generated WGSL SOURCE
(`Pipelines.js:186`), so whether that build yields a NEW program depends
on whether the source came out identical.

For a stock node material it does not, and the threshold is the
surprising part. `NodeMaterial` routes an `InstancedMesh` through
`createInstanceMatrixNode`, which binds `instanceMatrix` as a UNIFORM
BUFFER while `count × 64` bytes fit `maxUniformBufferBindingSize`. That
buffer node is named `NodeBuffer_<id>` from a GLOBAL counter, so its WGSL
is unique per mesh and every new mesh is a new program. Past that count
three falls to four interleaved instanced `vec4` attributes, whose names
come from a per-builder counter, and the source is identical across
meshes again. So small instanced meshes share programs WORSE than large
ones, and a material that reads its own instanced attributes rather than
`instanceMatrix` shares them regardless of count.

**The crossover is a hard edge, and the comparison is `<=`.** With the
default 65536-byte limit it falls between 1024 instances and 1025.
Measured by an integrator on r185 through `renderer.info.memory.programs`,
four fresh meshes per row against one shared stock `MeshBasicNodeMaterial`:

| instances | `count × 64` | programs |
| --- | --- | --- |
| 4 | 256 | +5 |
| 1024 | 65536 | +5 |
| 1025 | 65600 | 0 |
| 4096 | 262144 | 0 |

1024 sits exactly ON the limit and still takes the uniform-buffer path.
**The cost is VERTEX programs only** — `instanceMatrixNode` drives
`positionLocal`, `normalLocal` and `positionPrevious`, all vertex stage,
and `WGSLNodeBuilder` collects uniforms per stage, so the fragment source
is identical across meshes and shared. That is why four meshes cost five
and not eight: four unique vertex programs plus one fragment they all
share.

The same integrator measured 12 geometry swaps on one REUSED mesh at +0,
and 30 fresh meshes at +0 — the latter because those meshes were ABOVE
the limit, not because the materials were better behaved. Which is the
same conclusion from the other side: pool the meshes, and know which side
of the edge your content sits on.

And do not reach for geometry disposal to release any of this.
`onGeometryDispose` only clears the attribute cache; `onMaterialDispose`
is the one that deletes pipelines, bindings, nodes and the chainMap
entry. Material dispose is the only release trigger there is, which is
exactly what `materialFor` hands you.

If you already have meshes and are overwriting `mesh.material` after the
fact, the old route still works: dispose what you displaced — after the
assignment nothing else holds a reference to it — reading the old value
through `materialListOf` first, since a multi-material asset is cloned
SLOT BY SLOT and disposing only the first leaks the rest. Dispose what
was displaced, never the pooled material that displaced it.

## Editing live graphs

JSON is the interchange format, not the only way to change a graph. A
tool that keeps one live `Graph` (as the `editor/` tool does)
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
- `setGraphParam(name, value)` turns one graph-scoped param: it rebuilds
  every authored field spec that reads the name and installs the result
  with `setParam`. Readers recook, non-readers keep their caches, and the
  declared `min`/`max` binds the write. The writes are LOUD — they bump
  the version, because a streaming World reads that counter to tell a
  user edit from its own per-cell binding, and a quiet write would leave
  every stored cell serving the old value. `setGraphParams(list)` is the
  declaration half: it records what the graph declares and pushes nothing
  into the nodes (an expression is bound when it is BUILT, which is why
  `deserializeGraph` calls it with the same values it bound the fields
  with, and why it bumps no version on its own). `graphParams` reads the
  list back, frozen. See
  [Graph-scoped params](#one-value-many-nodes-graph-scoped-params).
- `describe()` returns a frozen structural snapshot: nodes (`id`,
  derived `seed`, `defType`), connections, and declared outputs, in
  insertion order. `getParams(handle)` returns a frozen shallow copy of
  a node's current params — nested values by reference, so treat them
  as frozen and change params only through `setParam`. Neither offers a
  mutation path that bypasses the graph's version counter.
- `describeSubgraphPins(def)` resolves a subgraph def's per-instance
  pins — exposed name plus the concrete kind of the inner pin, through
  nested subgraphs — live from the recorded spec; `undefined` for
  non-subgraph defs. The body's exposed pins come first, in exposure
  order, followed by any the WRAPPER adds, in the order the def declares
  them. Those carry `synthesized: true`, and today they are exactly
  `repeatUntil`'s `rounds` and `converged` (`forEach` adds none). The
  flag is worth reading in both directions. The pin is REAL: it is on
  the def, it can be wired, and a description that omitted it would
  claim a loop node has fewer outputs than it has — leaving no way to
  tell a converged result from one truncated at `maxRounds`, which is
  what those two pins exist to answer. But it is not the body's, so it
  resolves to no inner pin, it does not move when the recipe's exposed
  outputs are renamed, and it survives editing the body. It is reported
  as an ordinary entry rather than in a second list precisely so that
  "what can I read off this node" stays one array; the key is ABSENT
  rather than `false` on an exposed pin, so an equality check against
  `{ name, kind }` still describes the ordinary case exactly. The
  primitive catalog prints them the same way, annotated `wrapper`.
  `describeSubgraphParams(def)` is its sibling for
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

Three fixes, and the error message lists all three:

1. **Merge.** Insert `mergePoints` between the source and the node, to
   concatenate the geometries back into one cloud. It is points-only, so
   rebuild any path after it with `pointsToPath` (see "A path that goes
   through a filter stops being a path").
2. **Move the op upstream of the split**, so it runs once on the whole
   cloud before it is partitioned. Usually the right answer when the
   operation does not actually depend on the partitioning.
3. **Put the op inside a `forEach`**, which cooks an inner graph once per
   element instead of once — see below.

### forEach: one cook per element

`forEach` is a composite node built like `subgraph`, with one added rule:
exactly one of its exposed inputs must be named **`each`** or
**`eachPoint`**, and that pin is what the body iterates.

| exposed input | one iteration per |
| --- | --- |
| `each` | ITEM of the collection on that pin |
| `eachPoint` | POINT of the one geometry on that pin, the body seeing a one-point cloud |

Every other exposed input is **broadcast** — passed whole to every
iteration — so a shared spine, a lookup surface or a mask reaches all of
them. Each iteration's outputs are concatenated onto the matching output
pin, in the iterated collection's own order, carrying the iterated item's
tags so `partitionByAttribute` → `forEach` → `filterByTag` works end to
end.

The mode is a pin NAME rather than a param on purpose. The graph format is
closed at every object position and a new key arrives with a
`formatVersion` bump, which would move every registered primitive's
content hash and break every pinned `ref`; reserved names (`__in_`,
`__out_`) are how this format already encodes roles.

**Every iteration is seeded on its element's content** — its points'
position bits, their `seed` attribute, and the item's tags — and never on
its position in the collection. That matters because a collection's order
is an artefact: `partitionByAttribute` emits groups in first-occurrence
order, a pin with two connections concatenates them in connection order,
and a `dataInput` binding is whatever the host passed. Reordering the
input reorders the output and re-rolls none of it. Two elements with
identical content AND identical tags are refused rather than run twice:
they would be seeded alike and emit the same block, which is never what a
loop was reached for.

**The body gets no memo reuse between iterations, by construction.** Each
iteration rotates the inner graph's seed — that is where per-iteration
randomness comes from — which changes every inner node's memo key, and a
node holds one cache slot. The `forEach` node itself memoizes normally, so
an unchanged graph still costs nothing on a recook. Budget and cancellation
are honoured between iterations as well as inside them.

To REPLICATE rather than iterate over data — K variations of one thing —
build the carriers and iterate those: `pointLine` with `count: K`, a
`setAttribute` writing `index()` to an `id`, and `partitionByAttribute` on
that `id` gives K single-point items, each with its own identity. Inside
the body, a `setAttribute` on the `detail` domain reading `randomField` is
a per-iteration constant (detail always holds exactly one element), which
`promoteAttribute` can then push onto the points.

### repeatUntil: cook until it settles

`repeatUntil` is the other loop, and it exists because a `forEach` cannot
express the one where the work creates more work: push overlapping props
apart and a new pair now overlaps; snap a dangling edge and the snap
creates another dangler. The number of passes is not known before the
first one runs, and a graph is a DAG, so the cycle that would express it
cannot be wired.

It is built like `subgraph` with one rule on BOTH sides: exactly one
exposed input and exactly one exposed output must be named **`carry`**.
Round 1 gets the outer `carry` input, round k+1 gets round k's `carry`
output, and every other exposed input is broadcast whole to every round,
as in a `forEach`.

Termination is the body's to declare. It publishes a scalar on the
**detail** domain of the carried geometry — the domain is the one that
holds exactly one value per geometry, and a wrapper has no non-geometry
output pin a scalar could ride out on — named by `settleAttr` (default
`moves`, and `attributeReduce` is what normally writes it). All zero
means settled: the loop stops, and that round counts. An **absent**
attribute is refused by name rather than read as zero, because reading it
as zero turns a typo, or a body that never wired the reduction, into
"converged on round one" — a wrong answer that cooks and saves cleanly.

`maxRounds` is a hard ceiling, and reaching it is neither an error nor
silent: two synthetic outputs the body never declared, `rounds` and
`converged`, report how many times the body cooked and whether the signal
reached zero, so a host can tell a settled result from a truncated one.

**The seed is not rotated per round**, which is the opposite of what
`forEach` does and is the design. A fixed point exists only if the body is
the same function every round; a body whose seed varies with the round
number is a different function each time, re-rolls whatever the last round
settled, runs the full budget every time and reports `converged` false
forever, with no error to say why. Pass a constant seed and let the DATA
change between rounds. The payoff is the mirror of `forEach`'s cost: a
constant inner seed means inner nodes whose inputs did not change serve
their caches, so a broadcast branch is computed once for the whole loop.

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
and `partitionByAttribute` drop it the same way — combine two geometries
with `mergePrimitives` instead, which concatenates points, vertices *and*
primitives and renumbers each input's references, so an authored network
joined to a generated one stays one network. Three filter-category
nodes are exempt, for two unrelated reasons: `projectToPlane` moves
points without removing any, and `filterPrimitivesByBounds` and
`filterPrimitivesByAttribute` remove whole *primitives* rather than
points — the two nodes in the library that take topology as their
subject instead of its casualty (see "Owning primitives instead of
destroying them", below). So "filter" is not quite the
boundary: **removing or recombining points** is. The category decides
nothing in either direction — `partitionByAttribute` is categorised
`attribute` and drops topology, while all three exemptions above are
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
it even when its predicate keeps every point. The primitive filters,
filterPrimitivesByBounds and filterPrimitivesByAttribute, are never the
culprit for a DROPPED topology — they filter the PRIMITIVE domain and
preserve the topology of everything they keep — but either can empty
that domain by rejecting every primitive, so if one is upstream, check
its bounds/vertex/mode or its attribute/comparison/value before you move
anything. Fix by moving pointsToPath after those nodes, so the path is
built over the points that survive.
```

### Sampling a path, and keeping one

Two nodes read a path and they do different things with it:

| | Treats each path | Emits | The input's POINT attributes | The input's PRIMITIVE attributes |
| --- | --- | --- | --- | --- |
| `splineSample` | all polylines as one concatenated curve | a point **cloud** — topology ends here | lost; new points carrying `tangent` and `curveU` | **carried onto every sample** |
| `pathResample` | each on its own arc length, kept separate | a **path**, closed if the input was | lost; new points carrying `tangent` and `curveU` | **carried both ways**: onto every sample, and onto the output polyline that replaced each input one |

The two columns on the right pull in opposite directions and both matter.

**Both nodes emit a polyline through the samples, and neither one's
`curveU` measures it.** `curveU` is a fraction of the arc length of the
INPUT CURVE; what gets handed downstream is the chord path through the
samples, and sampling cuts corners. The two agree on straights and diverge
wherever the curve bends — which is exactly where a rule that reads a
station is looking. So `curveU * someLength` is two rulers in one
expression, and scaling `curveU` by the emitted length does not fix it: it
corrects the total and leaves every station between the ends on the input
curve's parameterization.

Each node therefore publishes the ruler its own output is measured in, as
opt-in reports that default to `""` and write nothing unset — the output
is byte-identical to a cook without them:

| | The emitted total | Each sample's own arc |
| --- | --- | --- |
| `splineSample` | `sampledLengthAttr` → **detail** (one number: every polyline is one curve here), closing chord included when every input polyline is closed | `sampleArcAttr` → **point**, world units, ONE running coordinate over the whole output — a sample crossing between polylines adds the joining chord |
| `pathResample` | `resampledLengthAttr` → **primitive**, per output polyline, closing chord included when that polyline is closed | `sampleArcAttr` → **point**, world units, restarting at each path |

Take the per-sample arc, not the total. The per-frame arcs telescope, so
their sum equals the length under *any* station column and a total-only
check has no diagnostic power at all — the racetrack carried a 4.8% error
on the one frame crossing its start line for as long as the two rulers
coexisted, with a total that was always right. `sampleArcAttr` is also the
coordinate `pathPointAt`'s `distance` mode, `transferAlongPath` and
`arcTile` already read, so taking it is usually one param rather than an
expression.

`splineSample`'s total lands on **detail** rather than primitive because
it concatenates every polyline into one curve and emits a cloud with no
primitives at all — there is one emitted length and nothing to hang it on.
A detail attribute is not readable from a point field; broadcast it with
`promoteAttribute` (`from: "detail"`, `to: "point"`) if a field needs it.

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

### Giving a path a surface

`sweepProfile` places a cross-section on **every point** of every
polyline and stitches consecutive placements into triangles, so a curve
becomes a mesh rather than a run of instanced cylinders. `extrudePolygon`
does the closed-boundary case: a footprint becomes walls, a floor and a
roof. Both emit **3-vertex `poly` primitives**, which is not decoration
— `surfaceSample` skips any primitive that is not one, and so do the
`uv` and `raycast` transfer mappings, so a quad-spelled surface would
draw and then be invisible to the library's own consumers.

Four things about them are easy to get wrong from the schema alone:

- **Neither node resamples.** `sweepProfile` puts one ring on each
  point it is handed. If the silhouette is too coarse, run
  `pathResample` first — that is the density knob, and there is no
  second one. The payoff is that `radius`, `width`, `roll` and `up`
  resolve as fields **at the ring**, exactly, instead of being averaged
  across a segment's two endpoints the way `pathSegments`' `radius` must
  be (a segment has no element of its own; a ring does).
- **`frame` fixes the roll, never the plane.** The ring's plane always
  comes from the path, bisecting the two segments that meet at the
  point. `upHint` is purely local; `curveFrame` reads the `curveNormal`
  that `writeCurveFrame` wrote, and inherits **that** node's documented
  non-locality and nothing more; `rot` reads whatever
  `orientAlongVector` left. So a sweep introduces no new
  cook-order sensitivity of its own.
- **`normal` and `uv` are reporting slots.** The node picks their shape,
  so an input already carrying either under a different shape is refused
  by name rather than silently deleted (`requireReportSlot`, the same
  rule `writeTangents` and `writeCurveFrame` follow). `u` is normalized
  arc length, matching `curveU`, so a texture lines up with anything
  else measured along that curve.
- **Attributes cross the dimension change by the table above, with one
  addition.** Input *point* attributes are **copied**, replicated around
  each ring, with no interpolation — the sweep adds no new positions
  *along* the path, only around it, so there is nothing to interpolate
  between. Input *primitive* attributes gather onto the triangles that
  came from them, by the same rule and with the same refusal on
  collision. Input *vertex* attributes are dropped, for
  `setPolylineTopology`'s reason: the topology they described is gone.
  Copying every point column means the standard eight ride around every
  ring whether or not they mean anything on a surface point; if that
  matters, `removeAttribute` upstream is the answer, and a silent
  built-in exception list is deliberately not.

`pathSegments` keeps the job it was always right for and loses the one
it was borrowed for. **One oriented asset per segment** is how a chain of
separate links, a row of sleepers or a string of beads is spelled, and no
swept surface can express it. Faking a tube is no longer its job — and
its `extend` param, which exists purely to overlap consecutive cylinders
so the wedge on the outside of a bend closes, has nothing to do on a
surface that is continuous.

## Networks: the primitive domain is the edge domain

A path visits its points in a line. A **network** lets them branch — a
crossroads where three roads meet, a trail net between camps, a scaffold
to displace. The first question everyone asks is *"so where does an edge
live, and how do I put a value on one?"*, and the answer is worth stating
plainly because it is not the answer the question expects:

> **There is no edge domain, and none is needed. A 2-vertex `polyline`
> over shared points already IS an edge — so an edge is a `primitive`,
> and a per-edge value is an ordinary primitive attribute.**

(The general form of that answer — which cardinalities get a domain, and
what a candidate fifth one would have to prove — is in
[design.md](./design.md#why-not-more-the-domains-that-dont-exist).)

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

`radius` is a plain number and deliberately **not** field-capable — the
one param in the library held back for being a SYMMETRIC RELATION rather
than for anything about fields ([Which params accept
one](#which-params-accept-one) has the whole rule, and the other
distance params it excludes). A per-point radius would let
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
`mergePoints` when it concatenates (`mergePrimitives` is the
concatenation that keeps the network). Put any of them after
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
their vertices against an axis-aligned box, and it is one of the two
filters in the library that **preserve topology**: the survivors keep
their vertices, their vertex and primitive attributes, and the points
they share. A network goes in and a network comes out. Every point filter
rebuilds the point domain from the survivors and the primitives go with
it; this one filters the *primitive* domain instead, and that single
difference is the whole node. It is the exception to the rule the
previous section states, and `filterPrimitivesByAttribute` — the section
after this one — is the only other.

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

### Keeping primitives by what they carry

`filterPrimitivesByAttribute` is `filterByAttribute` one domain up: the
same six comparisons, the same numeric/string split, the same scalar-only
rule — applied to a **primitive** attribute, keeping whole primitives and
preserving their topology exactly as `filterPrimitivesByBounds` does. It
is that node's sibling, and the only difference between them is what they
ask about a primitive: a value it carries, rather than where its vertices
lie. String attributes still compare against `stringValue` under `eq` and
`ne` alone, and `primtype` is one of them, so `primtype eq polyline`
narrows a mixed geometry to its curves.

Where it sits in the chain is the point of it:

- **Filter before the sampler, not after it.** A primitive attribute —
  `connectPoints`' edge length, a promoted density, anything
  `promoteAttribute` lifted — can also be read *after* a sampler has
  flattened it onto points, because every sampler carries primitive
  columns down ("Sampling a path, and keeping one" above), and
  `filterByAttribute` then works. That is how these graphs were written
  before this node existed. The cost is that the flattening, and
  everything downstream of it, runs on primitives that were always going
  to be discarded; filtering here discards them while they are still
  primitives, so the work that follows is proportional to what survives
  rather than to what was proposed.
- **Orphaned points are kept, not tidied.** `unreferencedPoints` means
  here exactly what it means above: `keep` (the default) leaves the point
  domain untouched, so every index, attribute and identity is still the
  input's and anything computed per point upstream still lines up;
  `drop` removes every point no surviving primitive references, renumbers
  the topology onto what remains, and takes unrelated scatter with it.
- **It partitions with nothing extra to arrange.** The test reads one
  primitive's own value — not its index, not its neighbours, not how many
  primitives there are — so the survivors and their order are the input's
  however the cook was partitioned, and no index column is emitted for a
  per-partition number to leak into a fingerprint. A polyline whose
  points span two cells is emitted whole by the single cell that owns its
  first vertex — `filterPrimitivesByBounds` at `vertex: "first"` and
  `halfOpen`, above — so this node tests it exactly once, and with its
  complete value.

Naming an attribute that turns out to live on the **point** domain is
refused rather than guessed at, and the message carries both ways out:
lift the column with `promoteAttribute` and filter here, or filter the
points with `filterByAttribute` and accept that the topology goes with
them. `filterByAttribute` carries the mirror-image message — a name
that is only on the primitives would have had its carriers filtered out
from under it — so whichever of the pair you reach for first, the error
names the other. An empty primitive domain that still carries the named
column is an empty result here too, never an error — the sparse cell of a
partitioned cook. A geometry with no primitive columns at all is refused
and told which nodes drop a topology, because that is a network that was
never built or one a point filter took away, not a cell with nothing in
it. `graphs/basics-filter-primitives-by-attribute.json`
is the whole thing in three nodes: scatter, `connectPoints` writing an
`edgeLength`, then this node keeping the short edges — fewer than half
the trails come out, and what comes out is still a network.

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
`graphs/pipeline-*.json`: a settlement built as
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
`hashCombine(worldSeed, levelIndex, cx, cy, cz)` for a 3D one, and
`hashCombine(worldSeed, levelIndex, cs)` for the single sector index of
a `"path"` cell. The hash chain's length prefix keeps the three arities
structurally distinct, so 1-, 2- and 3-tuple chains never collide at the
same numbers.

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
| any field param resolving `randomField` or `nodeSeed` (including `selfPrune`'s `minDistance` / `priority` and `filterByExpression`'s `predicate`) | yes — the node seed is the evaluation seed |
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

## Cell modes (cellMode)

Levels default to 2D cells on the XZ plane (`cellMode: "xz"`): square
cells, unbounded in Y, addressed `[cx, cz]`. The other two modes change
what a cell *is* — `"xyz"` cuts Y as well, and `"path"` stops cutting
space at all. `CellContext` is a discriminated union on `cellMode`, so
`bind` narrows to the shape its own level declared.

### Cube cells (`"xyz"`)

Set `cellMode: "xyz"` on a level for cube cells addressed
`[cx, cy, cz]` — the generation/retain radii then measure full XYZ
distance from the viewpoint, and the per-cell seed hashes all three
coordinates:

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

### Arc sectors (`"path"`)

A `"path"` cell is not a box. It is the half-open arc range
`[sMin, sMax)` along the level's centreline, addressed by a single
sector index `[cs]`, and such a level streams **the next N metres**
instead of a disc around the viewpoint.

That is what one-dimensional content — a road, a river, a racetrack —
actually wants. Around a car at speed a disc spends half of what it
loads on the stretch just left behind, does not reach far enough down
the road being driven, and counts its cells by bounding-box AREA while
the content it holds is measured in LENGTH: a circuit that doubles back
past its own paddock pays for every square between the two straights.
An arc window measures the one quantity the content actually has.

The table is cut into `round(length / cellSize)` equal sectors, so
`cellSize` is a TARGET rather than an exact width: the seam then falls
exactly at `s = 0` instead of leaving a short runt sector in front of
it. Sector 0 starts at arc length 0, and the last sector's upper bound
is the table length itself.

**The runtime learns a ruler, not a curve.** `LevelDef.path` is
`{ length, closed }` and nothing more — two numbers, no geometry. Those
plus `cellSize` are everything needed to turn an arc coordinate into a
sector and to wrap one, so the `World` never becomes content-aware and
there is no second copy of the centreline to disagree with the one the
graph cooks.

The table is also **static**, and cannot be sourced from a parent
level's outputs however natural that looks when the curve is itself
generated. `update` computes the whole wanted set before it consults any
parent cell, since parent outputs exist only at bind time: a
parent-sourced table would make wanted-set MEMBERSHIP a function of cook
state — nothing wanted at all on the first update, and "the same cells
whatever the cook order" gone with it. A level whose centreline is
generated upstream still declares the length here, as configuration
matching the curve it will be handed.

**The caller supplies the arc position**, once per update, keyed by
level name:

```ts
const dressing: LevelDef = {
  name: "dressing",
  cellMode: "path",
  cellSize: 40,                        // target: round(2400 / 40) = 60 sectors
  path: { length: 2400, closed: true },
  aheadArc: 400,                       // the next 400 units of track
  behindArc: 100,                      // and a little of the last
  graph: dress,
  bind(g, ctx) {
    if (ctx.cellMode !== "path") throw new Error("dressing is a path level");
    // The cell IS an arc range: hand it to whatever walks the
    // centreline. `start` and `span` here are setAttribute nodes
    // writing `runStart` and `runSpan`, the names arcTile reads its
    // ranges from.
    g.setParam(start, "value", ctx.sMin);
    g.setParam(span, "value", ctx.sMax - ctx.sMin);
    g.setParam(scatter, "seed", ctx.seed);
  },
};

await world.update([camera.x, camera.y, camera.z], {
  anchors: { dressing: car.station },  // an arc length, not a world point
  budgetMs: 8,
});
```

An anchor is a COORDINATE, exactly like the viewpoint, and the window
around it is POLICY, exactly like `generationRadius` — which is why one
is an update option and the other lives on `LevelDef`. Nothing projects
a world point onto the centreline: the caller already knows its station
(anything lapping a circuit tracks it for timing regardless), and
projection would have made the World carry geometry to answer a question
the caller can answer exactly, needing a stated tie-break at every
crossover where two arc positions are equally near. A mixed World
therefore streams in one call — the world point drives the `"xz"` and
`"xyz"` levels, each entry in `anchors` drives its own `"path"` level.
Every `"path"` level needs a finite entry, and a missing one, a
non-finite one, an unknown level name, or a name that is not a `"path"`
level throws `WorldValidationError`, all of it checked before any cell
of the update cooks.

**A window that knows which way you are going.** `generationRadius`
still works on a `"path"` level and reads as an arc distance to the
sector's nearest bound, symmetric around the anchor, with `retainRadius`
as its band in the same arc units — which is the shape to use when the
thing riding the curve may turn around. A car at racing speed is the
opposite case: it will be four hundred units further down the road in a
few seconds and will not revisit the hundred behind it this lap, so a
symmetric window spends half its budget on road already driven and still
runs out of road in front. State the two halves instead:

- `aheadArc` and `behindArc` REPLACE `generationRadius` on that level,
  which is refused alongside them — on a `"path"` level
  `generationRadius` *is* `aheadArc = behindArc = generationRadius`,
  exactly and not approximately, so a level carrying both spellings has
  one number present and never read. Both halves must be stated: a
  half-stated window would have to borrow its other half from
  `generationRadius`, which is the same collision under a shorter name.
- Either half may be `0`, where `generationRadius` must be positive.
  `behindArc: 0` wants the sector the anchor is standing in — the anchor
  is inside it, so its gap is zero on both sides — and nothing further
  back. A level that never looks behind is the limit case, not a
  misconfiguration.
- Hysteresis is per half: `retainAheadArc` and `retainBehindArc`, each
  defaulting to its own half times 1.25 and each required to be at least
  its own half. `retainRadius` is refused alongside a directional
  window rather than quietly applied to both, because one scalar cannot
  describe two halves of different depths. Against
  `aheadArc: 400, behindArc: 100`, a single 500 grows the behind half to
  five times the depth that was asked for until the LRU cap starts
  arbitrating what the window was supposed to; a single 125 strips the
  ahead half's band instead, and a sector 130 ahead is cooked and
  evicted in the same update, then wanted again on the next — the exact
  thrash a retain band exists to prevent.
- "Ahead" needs no heading input. The table has its own direction —
  increasing arc IS ahead, by the same convention that puts sector 0 at
  `s = 0` — so a level travelled the other way states its window
  mirrored (`aheadArc: 100, behindArc: 400`) rather than passing a
  reverse flag. As static configuration such a flag would be the
  mirrored window under a longer name; as per-update state it would make
  which sectors are wanted a function of the frame that asked, and the
  cook schedule would stop being reproducible from configuration plus
  anchor path.

The window also changes what "nearest first" means, and the scheduler
follows it: a wanted sector's cook priority is its gap as a FRACTION of
the half that claims it, not its raw arc distance. Both halves then
drain outward from the anchor at the same proportional rate, so a
starved budget spends proportionally more of itself on the longer half
— which is what asking for a longer half meant. Ranking by raw distance
would put the road already driven ahead of the road coming, which is the
failure the directional window exists to fix, reintroduced one layer
down in the scheduler. With equal halves the rank degenerates exactly,
not approximately, to the ordering a symmetric level always had.

The rule that a level's radius should be at least as large as every
finer level's applies here PER HALF: a child wanting 400 ahead under a
parent wanting 200 leaves the far half of its window pending forever,
exactly as an oversized radius would.

**Wrapping.** On a closed table the seam at `s = 0` is not a boundary:
the last sector is adjacent to sector 0, both gaps are cyclic, and the
anchor itself wraps, so `s = 105` on a 100-unit lap is `s = 5` and wants
the same sectors in the same order. That is the rule the path NODES
already keep: `pathRuns` treats a closed path's seam as no boundary
unless something flags it, `runFit` and `arcTile` match it to the
letter, and nothing can flag it here — so a sector window and a run
tiled across the start/finish line agree about where a lap begins. A
window longer than the table clamps to it, wanting every sector exactly
once, each claimed by whichever half reaches it in fewer arc units;
widening further changes nothing. That is deliberately not an error,
because "keep the whole lap resident" is a real configuration and
refusing it would turn an edit to `path.length` into a breakage.

On an OPEN table the seam is a hard boundary instead: the two ends are
as far apart as their arc lengths say rather than adjacent, the
direction a sector is not on is unreachable rather than a long way
round, and a window running off either end simply finds no sectors
there.

**The context carries no box, deliberately.** A `"path"` cell's context
is `sMin`, `sMax`, `pathLength` and `closed` — plus the usual seeds,
coord and parent — and has no `min`/`max` at all. An arc sector is a
curved tube, so a world-space box would be a lie about what the cell
covers; worse, a third `min` under the same name (2-arity on `"xz"`,
3-arity on `"xyz"`) would let the common
`ctx.cellMode === "xyz" ? … : (xz)` else-branch read a 1-tuple's
`min[1]` as a z that was never there, and be silently wrong. Omitting it
breaks that pattern at COMPILE time instead. For the square case the
narrowing every such `bind` needs ships as a helper:

```ts
import { xzCell } from "pcg-ts";

bind(g, ctx) {
  const { min, max } = xzCell(ctx);   // throws, naming the mode it got
  g.setParam(scatter, "boundsMin", [min[0], 0, min[1]]);
  g.setParam(scatter, "boundsMax", [max[0], 0, max[1]]);
}
```

Nesting rules (the parent is the level above):

- like under like: the parent is the cell containing this cell's center,
  and for `"path"` the parent SECTOR containing this sector's arc
  midpoint;
- `"xyz"` under `"xz"`: the parent is the containing XZ column cell;
- `"xz"` under a bounded `"xyz"` parent is rejected at World
  construction — a 2D column spans every Y layer of the parent, so no
  single parent cell contains it (make the parent `"xz"` or the child
  `"xyz"`);
- nested `"path"` levels ride ONE table: the same `path.length` and
  `path.closed` on both, enforced at construction, since a sector's
  parent is found by arc length alone. They may still differ in
  `cellSize`;
- `"path"` under a bounded `"xz"`/`"xyz"` parent, and either of those
  under a bounded `"path"` parent, are both rejected — an arc sector is
  a tube along a curve, so no square cell contains it and it contains no
  square cell, which is the argument that rejects `"xz"` under `"xyz"`
  one dimension along;
- an unbounded parent (one global cell) accepts any mode below it.

Two consequences of that last pair. Levels form one chain, so a bounded
square level and a `"path"` level cannot coexist in one `World` — only
an unbounded level above a `"path"` level mixes today. And the
coarse-to-fine `cellSize` rule is checked WITHIN a mode family, the
world-space modes against each other and `"path"` levels against each
other, because an arc length and a world length are not comparable
quantities.

`src/runtime/cellsPath.test.ts` pins all of the above, and needs no
curve to do it: the whole mode is exercised with a length and a boolean,
which is the clearest statement that the runtime never sees the
centreline.

An unbounded level (`cellSize: "unbounded"`, first level only) needs no
`generationRadius`; omit it — a value is accepted and ignored, so
configs written before it became optional keep working. It partitions
nothing, so `cellMode` is ignored there too, `"path"` included: sectors
need a table to mean anything, and a directional window on an unbounded
level is refused outright rather than dropped.

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
   compile; a string column compiles only through `attributeIs` or
   `byAttribute`, whose
   literal rides a per-dispatch uniform rather than a baked constant —
   the resolved table index is a property of the geometry, not of the
   spec, and the kernel cache key does not include table contents), and
   tuple sizes stay ≤ 4 with
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

4. Every `{"fn":"param"}` reference in the spec resolves to exactly
   one value per name. A name nothing bound, or two references to one
   name bound to different VALUES in a single expression, falls back
   with `param-bindings` — the kernel compiles either way, since a
   param lowers to a uniform slot that needs only the name, but the
   values it would write are missing or contradictory. Two references
   bound at different *arities* are a different failure and report
   `compile-error`: one slot cannot be both a scalar and a vector, so
   there is no kernel rather than no value.

Those five reasons (`no-spec`, `derived-spec`, `compile-error`,
`too-many-buffers`, `param-bindings`) are the complete per-field
vocabulary; fused runs add two more, below. `derived-spec` is scoped to the **per-field seam**
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

The `stats` both methods take is the `GpuCookStats` the cook is
accumulating into, and `createGpuCookStats()` is where one comes from: a
fresh all-zero set of the counters described under
[Introspection](#introspection), with empty `fallbacks` and empty
`nonFinite` records. A resolver implementing these methods writes
into the object it is handed when it is handed one — the parameter is
optional, so it must also work with `undefined` — and never constructs
one. What does need to construct one is a HOST that cooks more than once
and wants a single figure for the lot: a page cooking each declared
output in its own pass, or a streaming World cooking a cell at a time.
`CookStats.gpu` describes ONE cook, so the device counters of every
earlier pass are otherwise dropped on the floor. Start from
`createGpuCookStats()` and fold each cook's counters into it — the
editor's per-output loop and `demos/infinite-world` both do, and neither
could have used a literal instead, since adding a counter to the struct
would have left their zero object silently short a field.

**What fuses.** Four *chain* kinds, all count-preserving with one
geometry input and one geometry output, plus one *terminal* kind:

| node | fuses when |
|---|---|
| `setAttribute` | numeric mode: `type` is not `"string"`, `domain` is `"point"`, `values` is empty, `stringValue` is empty |
| `transformPoints` | always |
| `jitterPoints` | always |
| `orientAlongVector` | always |
| `spawnInstances` | the resolver advertises the kind UNCONDITIONALLY — with or without `assetAttr` (since v0.8.0), with or without `colorAttr`, and whatever `instanceAttrs` says; the RUN then fuses a non-empty `instanceAttrs` only when the evaluator sets `deviceInstanceAttrs: true`, and otherwise only an empty one; terminal only, and it declares no `eligible` gate (the channel case is decided by the run planner instead, so a rejection keeps the node off only the run that names one); see [Device-resident instancing](#device-resident-instancing-drawing-without-a-readback) |

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
  storage-buffer limit, or a `spawnInstances` over the instance budget,
  naming an `assetAttr`/`colorAttr` it cannot use, or naming per-instance
  channels in `instanceAttrs` without `deviceInstanceAttrs: true`.
  Genuinely invalid params still surface the identical CPU error from the
  per-node path, which is why none of those spawner conditions needed a
  reason of its own — with one exception worth stating, because it is a
  capability gate rather than a mistake: `instanceAttrs` is a perfectly
  valid param that the CPU path executes fine, so there is no CPU error
  to surface. It rejects because you did not opt in to device production
  of those channels (`deviceInstanceAttrs`, below), not because the graph
  is wrong.
  An `attributeIs` or `byAttribute` anywhere in the run declines here
  too, and for
  a reason worth separating from the rest: its kernel compiles and
  dispatches perfectly well — the per-node path runs it on the device.
  What a plan cannot supply is the uniform that kernel reads, the
  literal's index in the string table of the geometry being cooked,
  because plan time has attribute descriptors and a count and no data.
- `run-too-large` — the run's working set exceeds the evaluator's
  `maxResidentBytes` (default 512 MiB). The working set is
  `Σ resident slot bytes over every epoch + Σ field-temporary column
  bytes + readback staging bytes`, in *logical* bytes: power-of-two
  pool bucketing can allocate up to 2×, and the 12-byte per-chunk
  uniforms are not counted. Field temporaries live for the whole run,
  not just their member, so an 8-member run holds 8 columns at once.

**And one per-run reason that is not a fallback**, counted separately
because it reports a partial success rather than a lost run:

- `run-partially-fused` — a member was rejected, so the planner retried
  the SUFFIX after it and fused what remained. Counted once per chain
  per cook; the dropped members cooked per-node. Note the asymmetry:
  only a suffix is ever retried, never a prefix. Fusing the prefix
  would compute `P` on the device and hand the drifted bits to the
  identity-keyed member one node later — the same hazard the rejection
  exists to prevent, with the boundary moved rather than removed.

**Cost model.** A *constant* param — a plain number or number tuple —
costs a 16-byte uniform slot and no dispatch; only field-valued params
materialize an `n`-element column. In the
`graphs/examples-gpu-fields.json`
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
      batch.colors?.byteLength;   // count * 16 — see the stride note below
    }
  } else {
    // CPU path: item.batches, Float32Array transforms (and colors)
  }
}
```

Check residency *first* — the residency probe is safe, the `batches`
read is not. Each `transforms` is an opaque `DeviceTransformsHandle`
(`backend`, `byteLength`, `disposed`, `resource`, `dispose()`), never a
typed array.

`colors` is the same handle type, is present only when `colorAttr` is
set, and **does not carry the CPU layout**. WGSL's `array<vec3<f32>>`
pads to a 16-byte stride, so the device buffer holds 4 floats per
instance (`count * 16` bytes) where the CPU `InstanceBatch.colors`
packs 3 (`count * 12`). Instance *k* sits at `4k..4k+2` and the kernel
writes `4k+3` as a literal `0f` rather than leaving it undefined —
respect that stride if you extend the device path, because it is the
one place the two layouts legitimately differ.

**Enumerate a device batch's handles through
`deviceInstanceAttributesOf(batch)`, never alongside `batch.colors`.**
Reading `batch.colors` for its *byte length*, as above, is fine — on a
batch this library builds it is an accessor over the reserved `"color"`
channel. Walking `attributes` and `colors` side by side to collect
handles is not: colour is a channel *in* that record, so the same handle
would be counted twice. `deviceInstanceAttributesOf` applies exactly the
CPU rule described in
[The per-instance channel](#the-per-instance-channel-the-abi-between-a-graph-and-its-host)
— the lift is keyed on the `"color"` channel and not on whether
`attributes` exists, so absent, `{}` and populated records converge; only
own, enumerable keys count; and two **different** handles under the two
spellings throw, naming the batch and the same two fixes. The lifted
entry is `{ handle: colors, type: "f32", itemSize: 3 }`.

Getting this wrong costs more here than on the CPU. **Every handle is an
owner obligation** — the device path has no GC, so a handle you fail to
enumerate is a buffer nothing will ever free (a visible leak, counted in
`poolStats`), and one you enumerate twice is a double free. Note that the
refusal *throws out of the enumeration*, so an owner that retains handles
while walking that record must make its `transforms` retain independent
of the call. `WorldThreeBinding` retains `transforms` first for precisely
this reason; if the normalizer then refuses, it retains the batch's raw
reachable handle set (deduplicated by identity) and re-throws the
refusal, so the batch's reachable buffers stay freeable and the
diagnosis still reaches the caller. Best-effort by construction: that
sweep is itself guarded, so a hostile `attributes` getter can leave it
incomplete — "reachable" is doing real work in that sentence.

Writing your own adapter?
`deviceTransformsBuffer(handle)` from `pcg-ts/gpu` is the one supported
way to get the buffer back; bind exactly `handle.byteLength` bytes from
offset 0, since the pool buckets allocations to powers of two and the
tail is uninitialized.

**4. Know what the run skips.** The run appends a compose-TRS kernel
writing one column-major 4×4 per point in exactly the `InstanceBatch`
layout, then transfers the composed buffers out of the evaluator's pool
— one buffer per asset, so a constant-`assetId` spawn yields one and an
`assetAttr` spawn yields as many as there are distinct asset ids on its
points. With `colorAttr` set, that same kernel also gathers RGB into a
second buffer per asset, from inside the same loop over the same index
expression that writes the matrix — there is no second traversal, so
the two orderings cannot fall out of step. Under
`deviceInstanceAttrs: true`, each name in `instanceAttrs` adds one
gather kernel and one retained buffer per asset on top of that,
dispatched after the compose and reading through the same index
expression — so the per-asset buffer count is 1 + (colour ? 1 : 0) +
channels, and an instance's channel value can never come from a
different point than its matrix. If
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

The instance budget and `colorAttr`'s two errors ride the same
mechanism, which is why neither widened the fallback vocabulary: a
spawn over 1 048 576 instances, or one naming a colour attribute that
is missing or is not f32 with `tupleSize >= 3`, rejects the run as
`run-plan-failed` and the CPU node raises the single diagnostic. The
device path words no message of its own, so the two paths cannot word
it differently.

**`instanceAttrs` is device-*produced* only if you ask for it, and that
opt-in is the one spawner condition here that is not about a mistake.**
Two flags, and the narrow one requires the broad one:

```ts
const gpu = new GpuFieldEvaluator(device, {
  deviceInstances: true,      // spawner terminals compose on the device
  deviceInstanceAttrs: true,  // …and gather their named channels too
});
gpu.deviceInstanceAttrs;      // true — the flag reads back off the evaluator
```

`deviceInstanceAttrs` without `deviceInstances` throws from the
constructor, naming both fixes: without a device-resident terminal there
is no batch for a channel to ride on, so the flag would read as on while
every channel still came from the CPU.

**Default off, and off is byte for byte what it was.** A spawn naming any
[per-instance channel](#the-per-instance-channel-the-abi-between-a-graph-and-its-host)
rejects the whole run as `run-plan-failed`, and the CPU spawner then
serves the *entire* terminal — the transforms it composes there, its
colour, and the channels. Nothing is dropped and nothing is silent: the
rejection is counted in `CookStats.gpu.fallbacks` like every other.

What a caller observes is the counter key and nothing more. The
planner's own rejection carries a sentence — `instanceAttrs names N
per-instance channel(s) and this resolver did not opt in to device
channels (deviceInstanceAttrs)` — but `PlanRejection` carries only the
reason, so that wording never leaves `planResidentRun`. Quoted here
because it is what you will find in the source, not because a cook will
hand it to you.

**Why this is opt-in when `colorAttr` is not.** Colour is one channel a
renderer binds *structurally* — three has a place for it — so composing
it on the device changes nothing a host has to do. A named channel is an
open-ended list that only the HOST can bind, and the device-resident
adapter this library ships binds the instance matrix and the reserved
`"color"` and refuses every other channel by name. Produce channels on
the device unconditionally and a graph that names one and renders
through that adapter goes from working to throwing — a working graph
broken by an optimisation. So the flag defaults off, every existing
assertion holds, and turning it on is a statement that you bind the
buffers yourself.

**What it costs, and what bounds it.** One gather kernel and one
retained buffer per channel per asset batch:
`out[i] = src[perm[base + i]]` in multi-asset mode and `out[i] = src[i]`
in constant-`assetId` mode, dispatched after the compose that wrote the
matrices and reading through the *same* index expression it used — so an
instance's channel value and its transform can never come from different
points. Its own kernel rather than more bindings on the compose one,
and that is arithmetic rather than taste: compose's widest form already
binds **seven** storage buffers — `P`, `rot`, `scale`, `transforms`, the
permutation, the colour source and the colour output — against the
baseline `maxStorageBuffersPerShaderStage` of 8 (`MAX_STORAGE_BUFFERS`),
so folding channels into it would have bought exactly ONE and then
failed on the second. A gather binds three at most — source, output, and
the permutation in multi-asset mode — whatever the channel's dtype and
width are, so the number of channels a spawn may carry is bounded by
memory rather than by a binding budget: the bytes count against
`maxResidentBytes` like every other allocation, and `run-too-large`
applies to them.

**The device buffer differs from the CPU column in exactly two ways**,
both `deviceInstanceAttributeLayout`'s. An `itemSize`-3 channel spends
**four** f32 slots per instance — WGSL's `array<vec3<T>>` pads to a
16-byte stride — and the kernel writes that pad as an explicit zero
rather than leaving it undefined, the same rule the colour buffer
follows. A `bool` channel is stored as u32 words. Nothing else is
widened: a `u32` column stays `u32`, which is the whole point of the
ABI.

**Bit-exact, and structurally rather than luckily so.** Both sides bind
as `array<u32>`, so the kernel moves raw 4-byte words and never a
value: no conversion to round, no arithmetic to contract, one pipeline
for `f32x2` and `u32x2` alike. Every component equals the CPU batch's
bit for bit — the only thing the CPU column does not also hold is the
vec3 pad slot, and that is a written zero, not a value.
Contrast the composed *transforms* on the same batch, which are a
documented tolerance class (an f32 kernel against `composeTRS`'s f64
interior — see the parity table below): the channels beside them carry
no such deviation.

**The handles are yours.** Each channel arrives as
`batch.attributes[name]`, whose `handle.resource` is the `GPUBuffer`,
holding the batch's instances in the same order as its transforms.
Enumerate them with `deviceInstanceAttributesOf(batch)` — never
alongside `batch.colors`, per the ownership rules above — and dispose
each exactly once: a handle you fail to enumerate is a buffer nothing
will ever free.

**One device-only narrowing.** A channel wider than **4 components**
rejects the run, because WGSL has no vector wider than 4 and carrying
one would be a different binding convention on every renderer rather
than a bigger buffer. The CPU spawner carries it happily, so this is a
fallback and not an error — split it upstream into narrower channels if
you want it resident. Every other shape the planner cannot carry (an
empty or duplicate name, the reserved `"color"`, a name missing from the
point domain, a string column) *rejects* rather than throws for the same
reason `assetAttr` does: `resolveInstanceAttrs` stays the single voice
that names the node, the param, the offending channel and the way out.
The channel check runs before the `colorAttr` one, so there is no
partial device spawn either way.

**With the flag off, read the rejection as a limit on PRODUCTION and
nothing else.** Two things it is regularly misread as forbidding, both
of which are supported:

- **Rendering the channel under a `WebGPURenderer`.** The CPU batch this
  fallback produces carries every channel, and `toInstancedMeshes` binds
  each one as an `InstancedBufferAttribute` of its own name — renderer
  agnostic, so a WebGPU material reads it exactly as a WebGL one does.
  That is the supported route for per-instance data in a shader and it
  is untouched by anything on this page. (The `deviceInstances` adapter
  is the exception: it binds only the instance matrix and the reserved
  colour, and refuses a device batch carrying anything else — hand-built
  or spawner-produced — naming its ways out.)
- **Keeping the cook off your frame.** The fallback is a CPU cook, not a
  main-thread one. Run it through `pcg-ts/worker` and the channels cross
  on the transfer list with the transforms — buffer ownership, not a
  copy — so a spawn that loses the device path does not thereby cost you
  a frame hitch.

The device batch type carries the channel shape
(`DeviceInstanceBatch.attributes`, `DeviceInstanceAttribute`, and
`deviceInstanceAttributeLayout` for what WGSL makes of a dtype and an
item size), and with the opt-in the resident spawner fills it — but the
WebGPU adapter that ships here still refuses a batch carrying a named
channel rather than drawing without it, whether a spawner produced that
batch or a host built it by hand. That refusal is a thrown error naming
the batch, the channel and its layout, with three ways out: drop
`deviceInstances: true` to cook CPU batches, drop just
`deviceInstanceAttrs: true` to send the spawns that name channels back
to the CPU spawner and leave the rest of the graph resident, or bind the
buffer yourself from `batch.attributes[name].handle.resource`. Unlike
the planner's, it is a hard error and not a counted fallback — by then
there is no CPU path left to fall back to.

The rejection did not widen the fallback vocabulary, for the same reason
the budget and `colorAttr` did not: `run-plan-failed` already says a
member could not be planned, and a second code would only be a second
place to keep the same fact.

`stats.dispatches` counts the multi-asset compose once per asset: the
unit is (step, asset), not step. See
[Introspection](#introspection) for the full counter contract.

**6. The remaining boundary: a string `setAttribute` breaks the
chain.** `setAttribute` fuses in numeric point-domain mode only, so the
idiomatic way to *compute* an asset key — `type: "string"` with a
`values` list and a field-capable selector, the recipe earlier in this
document — is not resident, and the chain breaks there. Where it feeds
the spawner directly, as in that recipe and in `graphs/examples-forest.json`,
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
`three@^0.185.0`, verified against `0.185.1`. The floor is the minor
line rather than one patch because nothing here compares version
strings: `checkAdoptionSeam` probes the seam behaviourally once per
`createWebGpuInstanceAdapter` call — per adapter, not per build or per
frame — which is a stronger guarantee than a range can be.

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

**Per-instance colour is not in that class, and the reason is
structural rather than lucky.** Colour is a *gather* — the kernel
copies the three source f32 into the output buffer and performs no
arithmetic on them — so unlike the composed matrix there is no
operation for f32 to round differently, and therefore no ULP class and
no budget. Measured with `Object.is` rather than a tolerance, so `-0`
cannot pass as `0` and a NaN would compare equal to itself: 12 288
colour components, zero mismatches, over a sample that pins signed
zero, out-of-gamut negatives, f32 max, min-normal and subnormals. The
pad slot at `4k+3` is asserted zero over that same sample, since a kernel
that wrote the source's *alpha* there instead of a literal `0f` would
leak a component the CPU path drops.

**The other per-instance channels have no parity class either, and for
one of two reasons depending on the flag.** With `deviceInstanceAttrs`
off — the default — a spawn naming anything in `instanceAttrs` rejects
the resident run as `run-plan-failed` and the CPU spawner serves the
whole terminal, so there is no device output to compare, transforms
included, and the numbers in the table above do not apply to it at all.
That is a CPU-only fallback like any other in this document: counted
under `run-plan-failed`, never silent. With the flag on, each channel is
a word gather — both sides bind `array<u32>`, so nothing is converted
and nothing rounds — and every component equals the CPU column's bit for
bit (the vec3 pad slot aside, as for colour), which is the colour
argument above generalized to any dtype. The transforms beside
them stay in the tolerance class; the channels never enter one. See
[Device-resident instancing](#device-resident-instancing-drawing-without-a-readback)
for the opt-in and what it hands the host.

What this does **not** weaken: everything else. The determinism suites
pin the CPU path, the CPU spawner's `composeTRS` goldens are unchanged,
and seed and hash streams are untouched. A spawner writes no attribute,
so nothing the compose kernel produces re-enters the graph — the handle
leaves the cook and goes to the renderer, never into a seed, an index,
or a later cook. What it *does* mean: if you need instance matrices
that match the CPU bit for bit, leave `deviceInstances` off.

`demos/gpu-world` is the worked end-to-end version of all of the
above: a streamed `World` whose cells draw from matrices that never
touch the CPU, with the binding's handle accounting and the evaluator
pool's detached-buffer counters shown side by side.
`graphs/examples-forest.json` is the multi-asset version — `assetAttr: "species"`
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
trunc, fract, select/compares, step, sign, mod, rem and smoothstep are
bit-exact ports — the last five by construction rather than by luck:
`step` and `sign` lower to comparisons, which have no interior to round,
and `mod`, `rem` and `smoothstep` have their CPU interiors rounded to
f32 op by op to match the device's expansion, the same trade `cross`
makes. `trunc` is exact for `floor`'s reason instead: it emits the
builtin, and an integer-valued result was a representable f32 already,
so there is nothing left to round. `randomField`'s is point-domain:
the kernel requires `P`, so a primitive-domain `randomField` declines to
the CPU and keys on primitive identity there. One device is run-to-run
byte-identical. Everything else matches within measured per-op-family
budgets, in range-ULP units — |cpu−gpu| / (2⁻²³ · max|cpu|), i.e. ULPs
at the top of the family's output range (raw max-ULP is misleading at
output zero-crossings, where the CPU's f64 interior survives
cancellation that f32 cannot).

`rangeUlp` is a **max over lanes**, so it is an extreme-value
statistic: a bigger cloud of the same distribution reaches further into
the same tail, and the worst lane climbs with the element count on its
own. Every family below is therefore measured across a sweep of counts
(10 000 → 1 000 000 on discrete desktop hardware, D3D12/Dawn) rather
than at one, and each budget carries headroom over the largest value in
that sweep: **1.5×** where the maximum grows with count, **1.25×**
where it has saturated because the op's own absolute-error bound (not
the sample size) is what limits it. Families in the first group are
re-measured at more than one count on every test run.

| family | rangeUlp, 10k → 1M | budget | mean \|cpu−gpu\| budget |
|---|---|---|---|
| arith add/sub/mul | 0 | bit-exact | — |
| clamp/min/max, floor, trunc, select/compare, step | 0 | bit-exact | — |
| fract, mod, rem, sign, smoothstep | 0 | bit-exact | — |
| div | 0.76 → 0.75 | 1 | 2.0e-8 |
| lerp | 0.50 → 0.50 | 1 | 7.3e-8 |
| remap | 0.00 → 0.00 | 1 | 6.0e-8 |
| fraction (a function of the count itself) | 0.50 → 0.50 | 1 | 6.0e-8 |
| ramp (multi-stop) | 1.09 → 1.27 | 2 | 3.8e-9 |
| dot | 0.70 → 0.67 | 1 | 7.4e-8 |
| cross | 0 | bit-exact | — |
| length/normalize (their internal square root) | 1.50 → 2.00 | 4 | 2.0e-7 |
| distance (one square root over an f32-rounded difference) | 0.52 → 0.51 | 1 | 1.9e-7 |
| sqrt | 0.71 → 0.71 | 1 | 3.6e-8 |
| pow, base ≥ 0.5, exponent over [−3, 3] | 4.31 → 5.05 | 8 | 2.9e-6 |
| exp over [−8, 8] | 3.44 → 4.12 | 8 | 3.8e-5 |
| exp2 over [−8, 8] | 0.50 → 0.50 | 1 | 9.8e-7 |
| log over [0.5, 8.5] | 0.93 → 0.93 | 2 | 5.5e-8 |
| log2 over [0.5, 8.5] | 0.65 → 0.65 | 1 | 6.3e-8 |
| sin/cos over [−8, 8] | 6.50 → 7.13 | 12 | 3.2e-7 |
| tan over [−1.45, 1.45] | 19.48 → 22.34 | 40 | 6.5e-7 |
| asin over [0, 0.9] | 503.99 → 506.98 | 640 | 3.9e-5 |
| acos over [0, 0.9] | 359.09 → 360.96 | 512 | 3.8e-5 |
| atan | 67.06 → 67.06 | 96 | 1.1e-5 |
| atan2 | 64.52 → 64.32 | 96 | 9.2e-6 |
| valueNoise raw / normalized | 6.53 → 10.44 (both) | 16 / 16 | 7.0e-8 |
| perlinNoise raw / normalized | 7.69 → 10.63 / 4.21 → 4.41 | 16 / 8 | 7.6e-8 / 3.8e-8 |
| simplexNoise raw / normalized | 17.46 → 22.56 / 8.55 → 10.85 | 40 / 20 | 2.6e-7 / 1.3e-7 |
| worley f1 / f2 | 5.16 → 6.00 / 4.71 → 5.71 | 10 / 10 | 1.5e-7 |
| worley f2−f1 normalized / exact f2−f1 | 9.42 → 10.64 / 9.28 → 10.38 | 16 / 16 | 9.0e-8 / 2.3e-7 |
| fbm value / perlin / simplex / worley | 4.32 → 6.12 / 4.84 → 5.90 / 19.02 → 31.67 / 4.81 → 5.10 | 10 / 10 / 64 / 8 | 7.8e-8 / 5.1e-8 / 4.6e-7 / 4.7e-8 |
| composite (ramp∘perlin × (random+attr)) | 8.78 → 17.05 | 32 | 7.4e-8 |

Five rows — `exp`, `log`, `distance`, `exp2` and `log2` — read their
arrows as 10k → 131k, because 131 072 is the in-suite sweep's ceiling and
what CI re-measures on every run. The first three were ALSO anchored at
1 000 000 on a widened run, and none of them moved: `exp` 4.12, `log`
0.93, `distance` 0.50. So `exp` climbs 1.20× over the first two decades
(4.13 at 65k) and then saturates, which makes its budget of 8 headroom
over a bound rather than over the largest sample so far. Their measured
means are 3.06e-5, 4.38e-8 and 1.53e-7 against the budgets tabulated.
`exp2` and `log2` carry NO 1M anchor and should not be read as if they
did: their arrows are dead flat across the sweep, so 0.50 and 0.65 are
simply the largest values measured for them anywhere in it. Their
measured means are 7.83e-7 and 5.05e-8.

Read the four-figure rows above with their own provenance in mind: they
are historical anchors from a sweep at 10k/65k/262k/1M that the harness
no longer runs, since `PARITY_SWEEP_COUNTS` is now `[10_000, 131_072]`.

**`log` is the clearest argument in this table for range-ULP being the
metric.** Its raw max-ULP is 4843 while its rangeUlp stays under 1,
because `log` crosses zero at x = 1: an absolute error of 4.4e-8 sitting
beside an output of 1e-11 is thousands of ULP *of that output*, and a
thousandth of one ULP of the family's range. Budgeting the raw figure
would demand 6000 here and would still say nothing about the answers
anyone reads. `distance` shows the mirror image — it measures *better*
than `length`/`normalize` (budget 4) because that row compounds two fns
in one spec, where this one is a single square root over a difference
the CPU also rounds to f32, which is exactly what makes `distance(a, b)`
and `length(sub(a, b))` the same number on both paths.

**The base-two pair measures TIGHTER than the base-e pair, and that is
the strongest evidence in this table that picking a builtin is a
decision rather than a detail.** Against the figures tabulated above,
`exp2` is 0.50 against `exp`'s 4.12 — 8× tighter — and `log2` is 0.65
against `log`'s 0.93. Same cause both times: the base-two pair is the
instruction the hardware has, and the base-e pair is the scaled
composition built on top of it. (`log2` also shows `log`'s zero-crossing
effect, and more of it: raw max-ULP 6986 beside a rangeUlp of 0.65,
because it crosses zero at x = 1 too.) Lowering the two the other way
round measures worse and busts the budget outright — `exp2` written as
`exp(x * LN2)` gives rangeUlp 3.00, 6.0× worse than 0.50, and `log2` as
`log(x) * LOG2E` gives 1.30, 2.0× worse than 0.65, both over the budget
of 1 the builtins earn. What holds the tolerance is the form that is
emitted, not the algebra behind it.

The last column is the second budget each family carries: the **mean**
absolute divergence over lanes. Unlike the max it is stable under
sample size — across 10k → 1M it moves by at most 1.05× for every
family above — so it is the one that trips when the interior of the
distribution actually changes, which a max budget wide enough to
survive a large cloud would not notice. The two are asserted together
because they fail for different reasons.

Noise divergence is a rounding-class difference, not a behavioural
one: `select(gt(perlinNoise, 0))` flips 0 lanes in 1 000 000, worley's
worst lane is 8.3e-7 absolute where picking a different cell would move
f1 by O(0.1), `normalized: true` damps the error rather than amplifying
it, and fbm does not compound disproportionately across octaves.

Each row bounds **that expression**, not the grammar fn in general —
the noise options move it, and not always in the direction you would
guess. At 1M elements `valueNoise()` with default options measures 5.64
against the 10.44 tabulated for frequency 0.35, while `simplexNoise()`
measures 48.86 against the 22.56 tabulated for frequency 0.4. Measure
before quoting a row at a different frequency.

asin/acos absolute error is ≈ 6.8e-5 — the WGSL-specified
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
desktop, D3D12/Dawn) and carries the headroom described above over the
largest measured value. Another adapter exceeding one is a finding
worth reporting upstream, not expected noise.

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
| `deviceInstances` | `false` | opt in to device-resident instance transforms, and their colours ([above](#device-resident-instancing-drawing-without-a-readback)) |
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

The editor shows the whole surface at once: its `cook` selector cooks
the graph you have open three ways — CPU, GPU per-node (a resolver
whose `planRun` returns null), and one fused device-resident run — and
its status line carries the wall time, the output hash and the full
counter set for the selected path. Open it on
`graphs/examples-gpu-fields.json`, a five-node fusable chain,
to read all three off one graph. `demos/gpu-world` covers the
device-resident instancing surface: a streamed `World` drawing from
matrices that never reach the CPU, with `poolStats.detachedBuffers`
and the binding's own handle count shown together as a live leak meter.
`graphs/examples-forest.json` covers the multi-asset shape: `assetAttr:
"species"` on the device-resident path, one buffer per species, with a
CPU/resident toggle and an honest fusion readout.
