# A `params` block the whole graph binds by name

PLAN.md gap 7 asks for "a top-level `params` block a node's field
expression binds by name", because "cable radius" lives in three nodes of
`graphs/examples-rig.json` and only the panel's `also` knows they are one
thing.

The mechanism it asks for is right. The example it names is the smallest
instance of the problem in that graph, and measuring the rest changes what
the feature has to be — so the measurement comes first.

## What the rig actually measures

**Cable radius: five sites, three of them reachable.** `0.035` appears
five times, spanning three top-level nodes:

| node | path | kind |
| --- | --- | --- |
| `wrapWraps` | `params.cableRadius` | exposed param of a `forEach` |
| `wrapSkin` | `subgraph.graph.nodes[…].params.radius` | the body's baked value |
| `wrapWraps` | `subgraph.params[0].default` | the wrapper's schema default |
| `danglerDanglerSkin` | `params.radius` | plain `sweepProfile` param |
| `drapeDrapeSkin` | `params.radius` | plain `sweepProfile` param |

**None of the five is an inline `{"fn":"param"}` value.** Every one is a
plain JSON number in a node param slot. That matters, because gap 7's
sentence — "a node's field expression binds by name" — describes a
mechanism that reaches into field EXPRESSIONS, and the rig's cable radius
is not written in one. It becomes reachable only because
`sweepProfile.radius` is `acceptsField: true` (`src/nodes/surfaces.ts:296`),
so the literal `0.035` can be rewritten as the reference
`{"fn":"param","name":"cableRadius"}`. The migration is a rewrite of the
param VALUE, not a rewrite of an expression, and the design has to say so.

**The largest duplication is not cable radius, and `also` cannot express
it.** One authored quantity — the truss's half-width — occupies **20 sites
across 10 nodes**, in two derived magnitudes:

- `±0.425` at 8 sites across `trussMove0/2/4/6`, in **four distinct float
  spellings** (`0.425`, `0.42500000000000004`, `0.4250000000000001`,
  `0.42499999999999993`);
- `0.6010407640085654` at 12 sites across `trussMove1/3/5/7`, `partMount`
  and `wrapMove` — which is `0.425 × √2` exactly.

These sit inside field specs (`params.translate.args[0].args[0].args[0].value`),
so a `param` reference reaches them directly. And the second group is a
DERIVED value: it wants
`{"fn":"mul","args":[{"fn":"param","name":"trussHalfWidth"},1.4142135623730951]}`.
`also` writes one value verbatim to N addresses (`mirrorsFor` at
`shared/graphUi.ts:426-454` performs no transformation, and
`editor/Overview.svelte:144-157` commits `c.value` unchanged), so it can
never express a relation. **A name can appear inside an expression; a
mirror can only be assigned.** That is the whole argument for binding a
name rather than broadening `also`.

**And some duplication is out of reach of both.** Six `sweepProfile` nodes
carry `"sides": 8`. `sides` is `i32` with no `acceptsField`
(`src/nodes/surfaces.ts:288-295`), and a field expression has no integers
— the reason `resolveTargetless` refuses to derive `i32`/`u32` from a
default's shape (`src/nodes/subgraphParams.ts:311-333`). No `param`
reference can ever stand in that slot. That case is why `also` survives
this feature.

**The scoreboard.** `also` covers 3 duplicated-scalar sites in the whole
corpus, in one panel file of 34, across 2 rows of 30. The sites it does
not cover in that one graph number roughly 93. The rig's panel would
shrink by exactly **two lines** — which is the honest measure of how
little of this problem was ever a panel problem.

## 1. The mechanism — a top-level `params` array

**Decision: `SerializedGraph` gains an optional `params` key holding an
array of `{ name, value, min?, max?, description? }`.**

```json
{
  "formatVersion": 1,
  "seed": 7,
  "params": [
    {
      "name": "cableRadius",
      "value": 0.035,
      "min": 0.005,
      "max": 0.2,
      "description": "Radius of every suspension cable, in metres"
    }
  ],
  "nodes": [
    {
      "id": "danglerDanglerSkin",
      "type": "sweepProfile",
      "params": { "radius": { "fn": "param", "name": "cableRadius" } }
    }
  ]
}
```

Three sub-decisions, each with a reason that is not aesthetic:

**The keys are the inline `param` node's keys, minus `fn`.** A `param`
spec node already takes `["name","value","min","max","description"]`
(`src/fields/fieldJson.ts:718`), and a graph-scoped param is exactly an
inline value hoisted out of one expression so several can share it. Giving
it the same five keys means `inlineParamMetaOf`'s vocabulary, its
validation (`checkInlineParamMeta`), and the schema derived from it are
one thing rather than two. It is deliberately NOT the exposed-param
vocabulary (`{name, targets, description, default, min, max}`): `targets`
has no meaning without a wrapper, and `default` is the value a fresh
INSTANCE starts with, where a graph has no instances and the value it
holds is simply its value.

**An ARRAY, not an object keyed by name.** `JSON.parse('{"a":1,"a":2}')`
is `{a: 2}` — the trap `PLAN-by-attribute.md` §1 had to concede for
`cases`, where duplicate-key detection is unimplementable at this layer.
Here it is implementable, so it is implemented: a repeated `name` in the
array is a parse error. The array also fixes a display order that does not
rest on JS object-key insertion order.

**`value` is a literal, never a spec.** The admitted shapes are
`readInlineValue`'s: a finite number, or a non-empty array of finite
numbers. Not a nested field spec, and not a reference to another
graph-scoped param. A param that could hold an expression would need a
topological order among params and cycle detection, for no consumer that
has asked; and a value that can compute is a node, which the graph already
has. An author who wants `trussCornerOffset = trussHalfWidth × √2` writes
that `mul` at each reading site, or declares both.

**Emitted only when non-empty**, so every graph in the corpus serializes
byte-identically to today.

### No `formatVersion` bump, and the tension is real

`GRAPH_KEYS` (`src/nodes/serialize.ts:193`) is closed, and the comment
above it says a future field "arrives with a `formatVersion` bump rather
than riding along unnoticed" — text quoted verbatim in `docs/manual.html`
(981-984) and `llms.txt` (90-97).

**Decision: no bump, matching the two precedents, and amend the doctrine's
wording instead.**

- The doctrine's protection is that an unknown key is REFUSED. That is
  untouched: an old library meeting `params` fails on `checkKeys` with a
  message naming the key. Nothing rides along unnoticed, which is the
  entire hazard the sentence was written against.
- `meta` was added under exactly this reasoning (`serialize.ts:164-167`),
  and `PLAN-spec-params.md` spent it again for the inline `value` key.
- The bump is not free. `hashableGraph` covers `formatVersion`
  (`src/nodes/subgraphRegistry.ts:200`), so 1 → 2 moves every subgraph
  content hash and breaks every pinned `ref` in the corpus and in
  `src/primitives`. Pre-alpha format breaks are acceptable; that is a
  reason not to fear one, not a reason to spend one on an added key.

The sentence in `serialize.ts:176-192`, and its two verbatim copies,
should be narrowed from "a future format field" to "a future field that an
old reader could MISREAD" — which is what it always meant.

## 2. When binding resolves — at deserialize, and nowhere else

**Decision: the `params` block is turned into a `FieldBindings` record and
passed to every `fieldFromJson` call `deserializeGraph` makes for a
top-level node param (`src/nodes/serialize.ts:1253`). After
deserialization the graph holds ordinary fields with the value already in
them. Cooking is untouched.**

This is forced, not chosen. `src/fields/fieldJson.ts:694-700` states the
constraint in its own words: binding SUBSTITUTES at build time, "not an
optimization but the memoization contract — `Field.key` is computed at
construction and is what `stableValueHash` hashes a field as, so a value
arriving later (an `EvalContext` variable, say) would never move a node's
param hash and the node would serve stale bytes for the new value." The
executor's per-node key is
`` `${def.type}|s${seed}|p${stableValueHash(node.params)}|i…` ``
(`src/graph/execute.ts:1039`) and a Field hashes as `F(field.key)`
(`execute.ts:182`). A value outside `Field.key` is a value the cache
cannot see.

So the only question is WHICH build, and deserialize is the earliest one
that has the values.

### What that buys, stated as properties

**A graph-scoped param is invisible to the cache, in the right way.** A
graph declaring `cableRadius: 0.035` and referencing it in three nodes
produces the same `Field.key`s — and therefore the same memo keys and the
same cooked bytes — as a graph with `0.035` written literally in those
three places. That is a testable claim, and it is the "no-op until it is
not" shape `PLAN-by-attribute.md` closes with.

**Turning one knob re-keys exactly the readers.** The live edit is a new
`Graph` method:

```ts
graph.setGraphParam("cableRadius", 0.05);
```

which, for every node param holding an AUTHORED field spec that references
the name, rebuilds it with `fieldFromJson(spec, bindings)` and installs it
with `setParam`. A non-reader's param object is untouched, so its
`stableValueHash` is unchanged, so `node.cache.key === key` still holds and
it is served from cache. Downstream nodes recook because their `inputSig`
moved, which is ordinary dataflow and not a property of this feature.

**The scan is not new code.** `bodyScan` (`src/graph/subgraph.ts:455`)
already computes exactly this — every authored field spec in a graph, the
`param` names it reads, and which of them it supplies itself — memoized on
`Graph.version`, and already "keyed per GRAPH rather than per def…what it
reads is a fact about the body alone". It is hoisted to
`src/graph/paramScan.ts` and imported by both. Two traps come with it, both
already solved there and both applying verbatim:

- **Take the scan BEFORE the first write.** `setParam` bumps
  `Graph.version`, which invalidates the memo mid-loop; a cold re-scan
  would then read a graph this call has already substituted into.
  `withExposedParams` documents the identical hazard at `subgraph.ts:1123-1129`.
- **A DERIVED spec that reads a declared name is refused.**
  `mul(fieldFromJson(spec), 3)` cannot be rebuilt, so it would keep the
  value it was built with while every authored expression took the new one
  — `checkDerivedReaders` (`subgraph.ts:600`), one level up, with the same
  message shape.

**The writes are LOUD, which is the one place this inverts the subgraph
mechanism.** `withExposedParams` writes with `_setParamQuiet` and restores
on the way out, because a body is shared between wrapper instances and a
version bump would invalidate the wrapper on every cook. A graph-scoped
write is a permanent edit of a graph nobody else owns, so it must bump
`Graph.version` — a `World` reads that counter to tell a user edit from its
own per-cell binding (`src/runtime/world.ts:796-802`), and a quiet write
would leave every stored cell serving the old value.

### The two rejected timings, precisely

**Cook time, like `withExposedParams`.** It pays the save/restore
discipline for a hazard that does not exist: the restore exists because an
inner graph is shared by several instances and by `serializeGraph`, and a
top-level graph has exactly one set of values. It also adds a whole-graph
pass to the hot path, and it would make `describeGraphParams` and
`serializeGraph` describe an unbound graph everywhere outside a cook.

**Evaluate time, through `EvalContext`.** This is the cheapest-looking
option and it is simply wrong: the value never reaches `Field.key`, so the
node's memo key never moves and the cook serves the previous value's bytes.
It would also hide the value from the GPU param plan and from the
domain-constant fold, both of which read the value off the spec
(`paramValue`, `src/fields/spec.ts:204`).

## 3. Shadowing — a hard error, not a precedence rule

An inline `{"fn":"param","name":"cableRadius","value":0.04}` inside a node,
in a graph that also declares `cableRadius` at the top level.

Under the existing chain — binding > spliced field > inline value >
refusal (`fieldJson.ts:1326-1331`) — the graph-scoped value would arrive as
a binding and silently win. **Decision: refuse it at deserialize instead.**

The existing rule is right and stays right for the case it was written
for. `PLAN-spec-params.md` established "an outer binding wins…so a node is
tunable standalone AND still wrappable", and that is about a SUBGRAPH
binding a BODY — two documents, where the body must also stand alone and
the inline value is its standalone answer. **A graph-scoped param is not
"outer". It is the same document.** A top-level graph is the only context
its nodes ever have, so an inline value the graph always overrides is not a
fallback; it is dead text a reader will believe, and
`describeGraphParams` would publish two addresses for one number where
turning one of them does nothing. That is the class of defect
`PLAN-by-attribute.md` exists to remove.

The message names both sites and both fixes:

```
deserializeGraph: node "danglerDanglerSkin" param "radius" writes an inline
value 0.04 for param "cableRadius", and the graph declares a top-level param
of the same name (0.035). One name, one value: a graph-scoped param binds
every reference to it, so this inline value could never be read. Remove the
"value" from this reference to read the graph's, or rename one of them.
```

Two adjacent cases, decided the other way:

- **A declared name nothing reads is legal**, and reported. It is how an
  author stages a knob before wiring it. `describeGraphParams` lists it
  (being addressable is the point of the derivation) and
  `pcg validate --params` marks it `read by 0`, because "I turned it and
  nothing happened" is the confusion worth pre-empting.
- **A reference to a name nothing declares is unchanged**: it builds, and
  refuses at evaluate with the existing message
  (`unboundParam`, `fieldJson.ts:522`). Refusing it at deserialize would
  be a better error and is deliberately not taken here — see "what this
  does not do".

## 4. Addressing — one segment, with a sigil

`describeGraphParams` publishes two shapes today, `"<node>.<param>"` and
`"<node>.<param>.<fieldParam>"`, plus the editor's bare `"seed"`, which is
safe only because "knob keys always contain a dot"
(`shared/graphUi.ts:186-188`).

**Decision: `"$<name>"`.** A leading `$`, one segment, no dot.

- It cannot collide with either node-scoped shape, which have two segments
  and three. `Knob.key` is read from the RIGHT when it must be split at
  all (`graphUi.ts:130-139`), and a one-segment key never reaches that
  path.
- It cannot collide with `"seed"`. A graph param named `seed` is addressed
  `$seed` and is a different knob — where a bare-name scheme would have to
  reserve `seed` in an author's namespace forever.
- `$` is already this codebase's spelling for "the root of the
  expression" (`buildSpec(spec, "$")`), so it reads as "the graph itself"
  in the vocabulary the errors already use.
- The address's KIND is legible without the graph in hand: `$cableRadius`
  says what it is, where a bare `cableRadius` is indistinguishable from a
  mistyped node id.

The name is refused if it contains a `.` (the reason
`resolveExposedParam` gives at `subgraphParams.ts:185-190`) or begins with
`$` (so the sigil appears exactly once and `$$x` cannot exist).

### `DescribedGraphParam` becomes a discriminated union

A graph-scoped param has no node, and `DescribedGraphParam` requires
`node`, `type` and `param`. Making them optional would let a consumer read
`.node` as `undefined` and print a wrong address. So:

```ts
export interface DescribedNodeParam extends DescribedParamBase {
  readonly scope: "node";
  readonly node: string;
  readonly type: string | undefined;
  readonly param: string;
  readonly fieldParam?: string;
}
export interface DescribedGraphScopedParam extends DescribedParamBase {
  readonly scope: "graph";
  readonly name: string;
  /** `"<node>.<param>"` of every slot whose expression reads this name. */
  readonly readers: readonly string[];
}
export type DescribedGraphParam = DescribedNodeParam | DescribedGraphScopedParam;
```

`key`, `schema`, `value`, `holdsField` and `exposed` stay on the base. The
union breaks every consumer that reads `.node` under `tsc --noEmit`, and
**that break is the feature**: there are exactly two such consumers
(`editor/controller.ts:462` and `src/cli/commands.ts:305`) and each has to
decide what it prints for a knob with no node.

`readers` is free — the scan of §2 already computes it — and it is what
makes a declared-but-unread param visible.

**`schema` is `inlineParamSchema`, reused.** Same derivation from the
value's shape (number → `f32`, 3-array → `vec3`, 4-array → `vec4`,
`undefined` for a width the param vocabulary cannot name), same
`min`/`max`/`description` read from the same three keys, same fallback
sentence. It gains one optional argument naming where the missing prose
should be written — "beside the value in the graph's `params` block"
rather than "beside the value in this node's field expression" — and
nothing else. `exposed` is always `true`: an author who wrote a top-level
declaration declared it worth turning, which is the same argument that
makes an inline value `exposed`.

Ordering: graph-scoped params come first, in declaration order, before any
node. They are graph-level, like `seed`, and a reader scanning
`--params` wants the shared knobs at the top.

**The editor write is the simplest of the three.** `KnobTarget` gains the
same union, and `writeKnob` (`editor/controller.ts:560`) gains a branch
above the existing two:

```ts
if (knob.scope === "graph") { this.mirror.setGraphParam(knob.name, value); return; }
```

No `getFieldSpec`, no `withInlineParamValue`, no per-slot loop — the graph
layer owns the fan-out. `applyKnobPatch`'s `"seed"` special case
(`controller.ts:503-511`) is untouched; `$name` keys go through the
ordinary `targets` map, so share links and reset replay for free.

## 5. Determinism and streaming — the invariant

**A graph-scoped param is a property of the GRAPH, fixed before the first
cell cooks and identical for every cell. There is no per-cell channel and
none is added.**

The strong form of the guarantee is structural rather than disciplinary:
**a per-cell value is unrepresentable.** A value reaches an expression only
by being substituted when the field is built, so two cells holding
different values would hold different `Field.key`s, hence different memo
keys, hence visibly different nodes. There is no channel through which a
value can reach an expression without moving its key — which is the same
property that makes the memoization correct in §2.

The runtime shape already agrees. A `World` holds one `Graph` per level
(`LevelDef.graph`, `src/runtime/types.ts:264`), refuses to share one
between levels (`world.ts:393-405`), and mutates it in place per cell; the
pooled path serializes it once and memoizes on `Graph.version`
(`src/worker/pool.ts:399-414`), and the worker deserializes it once per
graph key (`src/worker/host.ts:58`). So a graph-scoped value is shared
across every cell on both paths, with no work.

**`ParamPatch` deliberately gains no graph-scoped form.** It is
`{node, param, value}` (`types.ts:23-30`) and it is the per-cell channel
(`LevelDef.bindPatches` → `applyParamPatches`). Giving it a `$name` form
would be exactly the hidden per-cell input this section forbids. The seed
is the sole graph-level value carried per cell, out of band as
`BindPatches.seed`, and it is carried that way because varying the seed
per cell is the point of a seed and is not the point of a param.

Two corollaries worth writing down:

- **Node seeds do not move.** `deriveNodeSeed(graph.seed, nodeId)` is
  untouched. Declaring, renaming or removing a graph param changes no
  node's seed — unlike renaming a node, which is gap 4's complaint.
- **Turning a knob mid-stream invalidates cells exactly as any other param
  edit does**, through the `Graph.version` bump of §2. This design adds no
  invalidation rule and makes none cheaper.

## 6. `also` — subsumed for one case, kept for the other

Both of the rig's `also` rows are drop-in replaceable, because both mirror
a value that is literally equal to its primary:

| row | today | after |
| --- | --- | --- |
| "brace" | `trussBraceSkin.radius` + `also: ["trussFrameSkin.radius"]` | `$tubeRadius` |
| "cable radius" | `wrapWraps.cableRadius` + `also: ["danglerDanglerSkin.radius", "drapeDrapeSkin.radius"]` | `$cableRadius` |

The difference is not the row; it is what the graph holds. Today the graph
holds N independent numbers and a presentation file asserts they are one
thing — and `mirrorsFor` checks only existence, field-ness and schema
type, never the values, so a mirror edited in the node inspector drifts
until the row is next turned (admitted at `graphUi.ts:52-55`). With a
graph-scoped param the graph holds ONE number and there is nothing to
drift. The claim is not that the panel gets shorter — it loses two lines —
but that the invariant moves from a sidecar into the artifact.

**`also` stays, and must.** A `param` reference can only stand where a
field spec can stand, so `also` remains the only way to gang params that
refuse fields: six copies of `sweepProfile.sides: 8` are `i32`, and no
expression can produce an integer. It is also the only mechanism that can
gang params of a type the field grammar cannot carry at all — enums, bools,
strings.

A worthwhile follow-on, not in scope: `buildKnobPanel` could report an
`also` row whose every address is field-capable and currently equal, since
that row is a graph-scoped param waiting to be written. `also` has no test
coverage today (`tests/editorKnobs.test.ts` never mentions it), which
should be fixed by whichever change touches it.

## 7. The GPU half — inherited, not new

A `param` reference lowers to a **uniform slot**, not a baked literal
(`src/gpu/compile.ts:495-504`), and the kernel key is computed value-free
(`specKernelKey` / `fieldFromJsonValueFree`), so "two values of a number
share a kernel" (`compile.ts:1275-1277`). Turning a graph-scoped knob
therefore rewrites a uniform and reuses the pipeline. That is not a new
benefit — it is exactly what an inline `param` already gets — but it is the
reason the rewrite in §1 (a literal `0.035` becoming a reference) is an
improvement on the device and not merely a wash.

The ceiling is `MAX_FIELD_CONST_SLOTS = 16` (`compile.ts:1011`), one slot
per distinct `param` name **per kernel**, shared with `attributeIs` /
`byAttribute` string literals. It bounds how many distinct names ONE
expression may read, not how many a graph may declare, and the existing
error already names the count and the fix.

## The sites to touch

1. **Format** — `src/nodes/serialize.ts`: `SerializedGraph` (159-172), a
   `GRAPH_PARAM_KEYS` beside the other key sets, `"params"` added to
   `GRAPH_KEYS` (193), the reader in `deserializeGraphRec` (1174+),
   the emitter in `serializeGraphRec` (781+), and the narrowed doctrine
   comment (176-192). `FORMAT_VERSION` does not move.
2. **Nested payloads refuse it.** `deserializeGraphRec` takes a `nested`
   flag (or `ReadContext` gains one); a `params` block on a subgraph
   payload's graph is an error naming the wrapper's exposed params as the
   right home. This is what keeps `hashableGraph`
   (`src/nodes/subgraphRegistry.ts:198`) untouched, so no pinned `ref` hash
   moves.
3. **Graph layer** — `src/graph/graph.ts`: a `_graphParams` field beside
   `_seed`/`_meta`, `get graphParams()`, `setGraphParams(list)` and
   `setGraphParam(name, value)`.
4. **The reader scan** — hoist `bodyScan` from `src/graph/subgraph.ts:455`
   to `src/graph/paramScan.ts`; `subgraph.ts` imports it unchanged.
5. **Addressing** — `src/nodes/graphParams.ts`: the union type, the
   `"$<name>"` entries emitted first, `inlineParamSchema`'s origin
   argument. `src/nodes/index.ts` and `src/publicSurface.test.ts:23,31`
   for the exported names.
6. **CLI** — `src/cli/commands.ts`: `graphParamRow` (305-335) narrowing on
   `scope`, and `validateCommand`'s header (377-389) gaining a graph-param
   line beside the existing seed line. `--json` carries the union.
7. **Editor** — `editor/controller.ts`: `knobs()` (462), `writeKnob`
   (560), and nothing else; `applyKnobPatch` (498) and `setSeed` (397) are
   untouched. `shared/graphUi.ts`: `KnobTarget` (112), `Knob` (125), the
   default section title for graph-level knobs, `PanelControlSpec.param`'s
   doc comment (36-41).
8. **Docs** — `docs/authoring.md`: the top-level key table (29-35), and
   the scope sentence at ~593-597 ("SUBGRAPH-scoped when bound from
   outside and NODE-scoped when written inline") gains its third clause.
   `llms.txt`: the format block (68-88) and the `describeGraphParams`
   bullet (210-228) — hand-written, not generated. `docs/manual.html`: the
   `<dl>` at 973-980 and the closed-format paragraph at 981-984.
   `README.md`: the sample at 224-241. `skills/graph-authoring/SKILL.md`:
   the knob doctrine at 85-109. Any doc sample that gains a `params` block
   must deserialize — `src/nodes/documentedGraphs.test.ts:26-32` extracts
   and cooks them.
9. **Corpus** — `graphs/examples-rig.json` and
   `graphs/panels/examples-rig.json`. No other graph needs migrating; 53
   of 54 are unaffected because the key is optional and omitted when empty.
10. **Not touched, and worth asserting**: `ParamPatch`,
    `applyParamPatches`, `src/runtime/world.ts`, `src/worker/*`,
    `hashableGraph`, `FORMAT_VERSION`, `deriveNodeSeed`, and every WGSL
    path.

## What this does NOT do

- **It does not reach inside a subgraph body.** A body's expressions are
  bound by its wrapper's exposed params, and that is the correct boundary:
  two binders that can disagree is the failure `checkDerivedReaders`
  refuses one level up. A graph-scoped value reaches a body one hop at a
  time through the existing seam — the wrapper's param slot may hold a
  field built from `{"fn":"param","name":…}`, which the graph binds at
  deserialize and `withExposedParams` then substitutes into the body — so
  composition needs no new rule.
- **It does not reach a param that refuses fields.** `sides: 8` across six
  nodes stays six numbers.
- **It does not add a per-cell or per-context value channel** (§5).
- **It does not change when an unbound `param` fails.** An unbound
  reference in a top-level graph can never be bound and so always throws at
  evaluate, which means refusing it at deserialize would be strictly better
  — and is still not done, because the editor deserializes a graph in
  order to EDIT it, and a graph mid-edit would become unopenable. That
  improvement is separable and wants its own decision.
- **It does not let a graph param hold an expression** (§1).
- **It does not give the CLI a way to set one.** `pcg cook` has no
  `--param` today (only `pcg run <primitive>` does, against a synthesized
  wrapper). A graph-scoped block is the natural home for one; it is a
  separate change with its own surface.
- **It does not detect that an `also` row could become a graph param** (§6).
- **It does not make the panel file meaningfully smaller.** Two lines.

## Alternatives rejected

**Put the values in the panel file.** Killed once already
(`PLAN-spec-params.md`): `tests/graphs.test.ts` cooks every graph with no
panel present, and a graph whose params resolve only when a presentation
file happens to be there is not a graph. Unchanged here.

**Wrap the whole graph in a subgraph with `targets: []` params.** The
closest existing thing, and it works mechanically — a targetless exposed
param is precisely "a param the body's field expressions read by name"
(`subgraphParams.ts:335`). It is rejected on four counts, and the first is
fatal on its own:

1. **It moves every node's seed.** Node seeds derive from
   `deriveNodeSeed(graph.seed, id)`, and a wrapped body derives its seed
   from the outer node's. Wrapping the rig changes its geometry — gap 4's
   complaint, and an immediate golden break for no semantic change.
2. **The values would live on the wrapper NODE**, i.e. in
   `nodes[0].params` — a node-scoped home for a graph-scoped value, which
   restates the problem one level up rather than solving it.
3. **It pays the save/restore of `withExposedParams` for a hazard it does
   not have.** That machinery exists because a body is shared between
   instances; a whole-graph wrapper has exactly one.
4. **Everything that names a node gains an indirection** — outputs, the
   node inspector, `describeGraphParams`' addresses, a World's terminals —
   and the editor would have to open the body to edit anything, which is
   what the `also` workaround was avoiding.

**Bind at cook time; bind at evaluate time.** §2, both with their reasons;
the evaluate-time one is the cheapest-looking and produces stale bytes.

**An object-keyed `params` map.** Duplicate names would collapse in
`JSON.parse` before the reader ever sees them, making the one check this
format CAN make unimplementable (§1).

**A new spec fn, `{"fn":"graphParam","name":…}`.** Two vocabularies for one
idea. Every spec walker would learn a second name — the six that
`PLAN-by-attribute.md` §1 enumerates — and `paramNamesOf`,
`unboundParamNamesOf`, `inlineParamValuesOf`, `inlineParamMetaOf` and
`withInlineParamValue` would each need a sibling. The existing reference is
already the right syntax; what changes is who binds it.

**Silent shadowing (graph wins, inline is the fallback).** §3. It would
publish two addresses for one number, one of which does nothing.

**A bare-name address with `seed` reserved.** §4. It reserves a word in the
author's namespace forever and makes an address's kind unreadable.

**Broaden `also` instead** — let a mirror carry a scale factor, or let it
mirror across types. It cannot reach the rig's largest duplication without
becoming an expression language in a presentation file, which is the
`PLAN-spec-params.md` argument in a new costume: what a value MEANS is the
graph's.

## What must be tested

- **The no-op**: rewriting three literals as references to one declared
  param, with the same value, is cook-hash IDENTICAL — and then changing
  the declared value moves it, which proves the test can tell.
- Round-trip: a graph with a `params` block serializes and deserializes to
  an equal graph, and the emitted `param` nodes carry the REFERENCE, not
  the value (`fieldToJson` hands out unstamped copies —
  `src/fields/spec.ts:185-191`).
- A graph with no `params` block serializes byte-identically to today.
- **Selective invalidation**: `setGraphParam` recooks every reader and
  leaves every non-reader's `node.cache.key` unchanged. Assert on the memo
  key, not on the cook count.
- The scan is taken before the first write: a graph with two readers
  rebuilds both (the version-bump trap of §2).
- A derived spec reading a declared name is refused, naming the slot.
- Shadowing: an inline value plus a declaration of the same name is a
  deserialize error naming the node, the param, both values and both fixes.
- A declared name nothing reads deserializes, cooks, and reports
  `read by 0`.
- A `params` block on a nested subgraph payload is refused.
- `hashableGraph` output is unchanged for every corpus graph, and no
  pinned `ref` hash moves.
- Addressing: `$name` never collides with a two- or three-segment key, a
  graph param named `seed` is addressed `$seed` and does not disturb the
  seed knob, and a name containing `.` or starting with `$` is refused.
- Duplicate `name` in the `params` array is refused.
- `value` shapes: a finite number, a 3-array and a 4-array derive `f32`,
  `vec3`, `vec4`; a 2-array yields no schema and is skipped, exactly as an
  inline value of that shape is; a spec in `value` is refused.
- `min`/`max`/`description` validate by `checkInlineParamMeta`'s rules — an
  empty range refused, a value outside its own range refused componentwise.
- Determinism: a `World` cooking N cells produces identical bytes with a
  graph-scoped param and with the same value written literally, and a
  partitioned cook matches a straight-through one.
- GPU: an expression reading a graph-scoped param compiles to a uniform
  slot, two values share one kernel, and a fused run behaves as it does for
  an inline param.
- The editor: a `$` knob renders from the derived schema with no panel
  file, a panel row addressing `$name` writes through one call, and a share
  link replays it.

## The one open question

**May the rig's migration move `tests/graphs.golden.json`?**

Two stages, and they differ:

- **Stage 1 — cable radius and tube radius — is value-preserving.** All
  five `0.035` sites and both `0.03` sites hold bit-identical literals, so
  collapsing each to one declared param must leave the golden untouched.
  That is the §"what must be tested" no-op, and it is the safe half.
- **Stage 2 — the truss half-width — cannot be.** The 8 sites of `±0.425`
  are written in **four different float spellings**, and the 12 sites of
  `0.6010407640085654` are `0.425 × √2` only as a design intent —
  `0.425 * 1.4142135623730951` in f64 need not reproduce that literal
  bit-for-bit, and no single declared value can reproduce four spellings at
  once. Collapsing 20 sites to one name therefore MOVES the cooked bytes,
  by an amount around 1e-16 relative, which the golden's
  `tolerance: {absolute: 0.001, relative: 0.001}` would likely absorb —
  but the byte-determinism half of `tests/graphs.test.ts` would not.

Stage 2 is where nearly all of this feature's value in that graph sits (20
sites, 10 nodes, versus 5 sites and 3 nodes for the entry's own example).
It is also the only part that asks permission. Everything above is
implementable without an answer; only the corpus migration's second stage
waits on one.
