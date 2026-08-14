# Parameterizable field expressions

Design for `{"fn": "param", "name": "…"}` — a field expression reading a
named, schema'd, panel-addressable scalar instead of baking a literal.

Status: designed, not built. Every claim below was checked against the
code; `file:line` references are to the tree at the time of writing.

## 1. What this actually is

Not a new capability. A **cheaper spelling of one the shipped vocabulary
already depends on**. The library says out loud, three times, that it
cannot do this:

- `src/primitives/expr.ts:65-77` — "An exposed param is pure fan-out into
  an inner param slot, and a noise `frequency`, `seed` or `offset` lives
  INSIDE a field spec, where no param slot exists — so neither can ever
  be exposed."
- `src/primitives/transform.ts:19-24` — "The two knobs live in ATTRIBUTES
  rather than in this expression, and that is forced rather than
  stylistic."
- `docs/authoring.md:222-224` — the parameter-attribute idiom "is the only
  way to make anything inside a field spec adjustable."

So the measure of the feature is what the current spelling costs:
**38 `setAttribute` + 18 `removeAttribute` plumbing nodes across 37
primitives**, each carrying a `count`-element f32 column, a GPU dispatch,
and one of the 7 usable storage-buffer slots (`MAX_STORAGE_BUFFERS = 8`,
`src/gpu/run.ts:167`; the `"too-many-buffers"` fallback is
`src/fields/gpuResolver.ts:32-34`).

## 2. The mechanism

`{"fn":"param","name":"k"}` resolves by **substitution at bind time**: the
field is built as if the literal had been written, so `Field.key` carries
the value. The authored spec is kept separately so `fieldToJson`
round-trips the reference rather than the value.

Fields are built in exactly three places — `src/nodes/serialize.ts:1046`,
`serialize.ts:1168`, and `src/runtime/patches.ts:130` — so
`fieldFromJson(spec, bindings?)` is the whole entry surface.

**Substitution, never late binding.** Adding `vars` to `EvalContext`
(`src/fields/types.ts:25-29`) is the trap: `Field.key` is computed at
construction and *is* the memoization contract — `stableValueHash` hashes
a Field as `` `F(${obj.key})` `` (`src/graph/execute.ts:178`). A value
arriving at evaluation time never enters the key, so `paramHash` does not
move and the node serves stale bytes. Recovering correctness would mean a
variable component in the memo key, which without per-field reference
tracking degrades to "any change invalidates every node" — i.e. the seed.

## 3. Scope: where the value lives

**Every exposed param binds its name into its body's field scope.
`targets` becomes optional fan-out.**

`ExposedParam` (`src/graph/subgraph.ts:68-77`) already is exactly what is
needed: a name, an agent-facing description, a default, optional min/max.
Already per-instance (`subgraph.ts:457-459`), already panel-addressable
(`Knob.exposed`, `examples/shared/graphUi.ts`), already patchable through
`ParamPatch{node,param}`, already covered by the content hash
(`hashableExposedParam`, `src/nodes/subgraphRegistry.ts:173-184`).

Nothing new is authored, so nothing new is validated, serialized, hashed,
patched or rendered — and `formatVersion` stays 1.

This is a generalization of the reviewed design, which proposed that an
**empty** `targets` list means "binds". Empty-means-bind conflates two
different facts and makes a param that both fans out *and* is read by a
field unexpressible. Making every exposed param bindable is simpler, has
no ambiguity, and needs the same single code change: `subgraph.ts:622-626`
currently refuses a zero-target declaration ("an exposed param that writes
nowhere cannot affect the cook"). That sentence becomes false — it can,
through a field reference — so the check becomes "at least one target OR
at least one referencing field in the body", with a message naming both
routes and listing the body's referenced names.

### Options rejected, and why

**Graph-level variable table** (`SerializedGraph.variables`). Two
disqualifiers. (1) No patch channel: `ParamPatch` is `{node, param, value}`
(`src/runtime/types.ts:23-30`), and a graph variable is neither — a
per-cell or per-frame variable needs new protocol fields in
`CellCookRequest`, `BindPatches` and the worker `cook` message, and
`src/runtime/patches.ts:3-8` exists precisely because that path must stay
byte-identical to the local one. (2) It cannot reach the shipped
vocabulary: the 37 primitives are subgraph payloads with their own inner
`Graph`, so either the inner graph sees outer variables — dynamic scoping
into a graph object that is *shared* by every reference — or it does not,
and the primitives keep their plumbing nodes.

It remains available later as a second trigger of the same machinery,
additively.

**The value as a detail-domain attribute.** Rejected for this problem on
three counts. Invalidation is data-flow-shaped: `inputSig` is built from
item revs (`execute.ts:932`), so everything downstream of the writing node
recooks, and a value shared by several consumers must precede the first of
them. That is the right property for a *measured* value and the wrong one
for a *tuned* one. It also breaks "a field reads the domain it lands on",
stated as an invariant at `src/data/attributes.ts:452`. And it carries no
`ParamSchema`, so it is not a knob.

It *is* a good separate feature — see §8.

## 4. Memoization

**Nothing new makes a node's key move; `Field.key` already does.**

Because binding substitutes, a field built from `{"fn":"param","name":"amp"}`
with `amp = 1.2` has key `const(1.2)` — byte-identical to what the literal
would have produced. Therefore:

- Invalidation is **exact and free**. Only nodes whose fields reference a
  changed name get a new `paramHash`. No reference tracking needed.
- It is content-addressed, so two names bound to the same value share a
  cache entry legitimately — they produce the same bytes.
- **`src/graph/execute.ts` needs no change at all.** That is the strongest
  signal this is the right mechanism.

Opaque fields are a non-issue: a `makeField` closure has no spec, so it
can contain no `param` node. `WithheldReason`/`withheldOver`
(`src/fields/spec.ts:95-151`) are untouched.

Measured against the rig's `6 cooked / 235 cached` readout:

| route | recooks |
|---|---|
| plain node param today | node + downstream — 6 of 241 |
| **binding** | structurally identical — ~6 |
| graph variable as a seed-like salt | **241 / 0** — the trap |
| attribute-carried (today's idiom) | writer + everything downstream; ~236 / ~5 when shared |

**One regression.** A wrapper is one node in the outer cook and its inner
`CookStats` are discarded (`subgraph.ts:527-532`), so a wrapped graph's
top-level readout shows `1 cooked / 0 cached`. Cook *work* is unchanged;
its visibility is not. Separable fix: surface inner stats the way the GPU
counters already do through `viewSinks` (`execute.ts:280-315`).

## 5. GPU

**`param` lowers to a uniform slot — forced, not chosen.**
`compileFieldSpec(spec, layout)` (`src/gpu/compile.ts:798`) receives a
spec and never values, so a literal lowering has nowhere to read from.
The uniform path is also the one the library already settled on next door:

> `src/gpu/applyKernels.ts:315-318` — "Constants contribute their tuple
> size and slot — never their values, so a constant edit rebinds the
> uniform and reuses the pipeline."

and it is **bit-exact against the CPU reference**, better than a literal
at `-0`/subnormal (`src/gpu/run.ts:33-45`).

- Const slots allocated per distinct name in **sorted-name order**,
  mirroring the attribute pre-pass (`compile.ts:809-811`) so codegen stays
  deterministic.
- `PcgParams` (`compile.ts:878-882`) grows `consts: array<vec4<f32>, N>`,
  reusing `applyUniformBytes` / `APPLY_CONST_OFFSET` verbatim.
- `collectAttrNames` (`compile.ts:719-750`) is already inert for `param`,
  so it adds **no storage buffer** — strictly better than the attribute
  idiom it replaces, which spends a slot per value.
- Run fusion needs no executor change: `run.ts:672-686` already builds
  field-kernel steps with a `consts` field (set to `NO_CONSTS`) and
  `run.ts:1203-1211` already writes it into the per-chunk uniform. The
  plumbing exists and is currently unused.

**The subtle part — two keys, deliberately.** `field.key` must carry the
value (the CPU memoization contract). `kernel.key` must not, or the
pipeline re-specializes per slider tick, and both `this.kernels` and
`this.pipelines` are unbounded Maps (`src/gpu/evaluator.ts:250,256`) — so
getting it wrong is a memory leak on every drag, not a slowdown.
`compileFieldSpec` already derives a value-free key by calling
`fieldFromJson(rootSpec)` with no bindings (`compile.ts:803`); the fix is
at `evaluator.ts:341`, which currently keys the kernel cache off the live
field.

Crossing those two keys serves GPU bytes under a CPU key — the exact class
of bug `deviceSpec`'s doc (`src/fields/spec.ts:203-232`) exists to prevent.
It is the piece most likely to be got wrong and deserves a dedicated
parity test.

**Unbound `param`** must be buildable but not evaluable: key `param("k")`,
`evaluate` throws naming the name and the fix. Compilation needs only the
key, which is exactly what the compiler wants.

**If it did not lower**, the existing machinery already handles it:
`GpuCompileError` at `compile.ts:272-276` → caught at `evaluator.ts:347-352`
→ reason `"compile-error"`; for fused runs `PlanFail("compile")` at
`run.ts:665-666` → `"run-plan-failed"`. The fall-back-with-a-reason
invariant holds by construction on either path.

One invariant the uniform lowering preserves for free: `compile.test.ts:188`
asserts `supportedGpuFieldFns()` **equals** `listFieldFns()`. A literal
lowering could not satisfy it; a uniform lowering does.

## 6. Format and compatibility

**No `formatVersion` bump is required.** The field grammar is not part of
`GRAPH_KEYS`; `fn` names are validated by the `FNS` map in
`src/nodes/fieldJson.ts`, and an unknown one already fails well
(`fieldJson.ts:196-198`), path-prefixed by `fail()` and node-prefixed by
`deserializeGraph`:

```
node "spineWander" param "translate": $.args[1].args[0]: unknown field fn
"param"; valid fns: abs, acos, add, asin, …
```

That already names the node, the param, the exact path and every valid
alternative. Worth appending one clause — "`param` requires pcg-ts ≥ 0.16"
— which is a string change, not a format change.

The break the project has authorised is therefore **not needed for this
feature**. It *is* needed for the primitive cleanup in §7, which changes
every primitive's node list and hence every content hash and every pinned
`ref` (`examples-forest.json`, `pipeline-*.json`). That break is caused by
the cleanup, not by the grammar.

## 7. Work breakdown

XS < 1h · S ≈ half-day · M ≈ 1-2d · L ≈ 3-5d

**Core grammar (2)** — `src/nodes/fieldJson.ts` register `param`,
`fieldFromJson(spec, bindings?)`, unbound-eval error **M**;
`src/fields/spec.ts` bindings + unbound-key WeakMaps (held outside the
spec object, as `SPEC_DEPTH`/`DERIVED_SPECS`/`WITHHELD` are, because
`checkKeys` rejects unknown keys) **S**.

**Graph / subgraph (2)** — `src/graph/subgraph.ts` relax the zero-target
check, body pre-scan in `prepareWrapper` (version-keyed: the body is fixed
after wrapping and edits bump `inner.version`, already in the wrapper's
`memoKey` at `subgraph.ts:502`), rebuild + restore in `withExposedParams`
**L**; `src/nodes/subgraphParams.ts` schema derivation from `default`'s
shape when there are no targets, and declared-vs-referenced validation both
ways **M**.

**`src/graph/execute.ts` — no change.** Stated so a reviewer looks.

**Serialization (2)** — `src/nodes/serialize.ts` reader path **S**;
`src/nodes/subgraphRegistry.ts` verify stable hashing **XS**.

**GPU (5)** — `compile.ts` handler + slot allocation + `PcgParams` **M**;
`gpu/types.ts` `constSlots`/`paramNames`/`uniformBytes` **S**;
`evaluator.ts` write slots in `dispatch`, unbound kernel-cache key **M**;
`run.ts` populate `step.consts` **S**; `applyKernels.ts` export the
uniform helpers **XS**.

**Runtime / worker — no change.** `patches.ts`, `runtime/types.ts`,
`worker/protocol.ts`, `worker/pool.ts` all untouched.

**Examples (2)** — new `basics-field-params.json` + panel **M**; sandbox
`controller.ts`/`FieldParam.svelte` annotation **S** (optional).
`examples/shared/graphUi.ts` needs **no change** — the knob is
`exposed: true` and non-field, so `admit()` already accepts it.

**Primitives — the payoff (8)** — `expr.ts` add `param(name)`, rewrite
`noisePosition`/`tunableFbm` (`expr.ts:78-102`) **S**; delete the 38
`setAttribute` + 18 `removeAttribute` plumbing nodes across
`transform/write/filter/shape/fill/place/compose` and rewire **L**.

**Docs (6, 3 regenerated)** — `docs/authoring.md` fn table (:331), the
"all 42 names" claim (:325), and the parameter-attribute paragraph
(:214-224) which becomes historical **M**; `docs/index.html` +
`docs/manual.html` hand-edit 4 `COUNT_CLAIMS` (`src/docs/site.ts:314-319,
348-352, 384-388, 390-393`) plus the verbatim `listFieldFns()` block that
`site.test.ts:202-226` compares live **S**; `llms.txt:260` 42 → 43 **S**;
`docs/{nodes,primitives,examples}.*` and `tests/corpus.golden.json`
regenerate.

**Tests (9)** — `src/fields/spec.test.ts:303`'s derivation matrix asserts
every registered fn is reachable from a constructor; `param` is
deliberately JSON-only, so that becomes "every *derivable* fn" with
`param` named as the documented exception **S**. New `fieldJson` parse /
round-trip / unbound-eval / depth tests **M**; `compile.test.ts:237`
`MINIMAL_SPECS.param` **S**; `gpu/corpus.testsupport.ts` mirror **S**;
subgraph binding, restore-after-cook, concurrency **M**; **CPU/GPU parity
for a bound field plus pipeline reuse across two values** — the regression
this design exists to prevent **M**.

**Sequencing.** (1) grammar + spec maps → (2) subgraph binding + tests →
(3) GPU uniform lowering + parity → (4) corpus graph + docs → (5) primitive
cleanup + re-pin + goldens. Steps 1–4 are one shippable unit; step 5 is
the second, and is where the hash churn lands.

~26 files for steps 1–4; ~34 including the cleanup.

## 8. What it unlocks, and what it does not

**Does**

1. **One expression at several scales** — two instances of a def, or two
   `ref`s to one primitive, with different bindings and no body edit.
   Today this needs the 3-node attribute idiom per value.
2. **A runtime level driving a field.** `bindPatches` → `ParamPatch` → the
   wrapper's exposed param → the body's fields. Today a per-cell value can
   reach a node param slot but **never inside a field expression**. Per-cell
   noise amplitude falling off with distance, a per-cell LOD scalar inside
   a displacement. Free under this design; impossible under the graph-level
   variable table, which has no patch channel.
3. **Agent-authored tunable graphs.** An agent's interface is
   `listNodeTypes()` plus a primitive's exposed params. Today it must
   either bake a shaping number or know a three-node idiom with an
   attribute-naming convention and a cleanup. With bindings it writes one
   declaration. Largest ergonomic win.
4. **One knob for several places in one body**, making the panel's `also:`
   mirror unnecessary for field-internal values.

**Does not**

- **A spawner driving a field.** Spawners are terminals. The real want
  behind that phrasing — a value *computed in the graph* driving a field —
  is correctly the attribute route, i.e. §9's `detail` item. The boundary
  is worth writing down: **a value that varies per element is an
  attribute; a value uniform over the cook is a param.**
- **Tunable `octaves`, `base`, `component.index`, `attribute.name`,
  `ramp.stops`** — structure, not values.
- **Tunable noise `frequency`/`seed`/`offset` *directly*** — they live in
  `opts`, read as plain numbers (`fieldJson.ts:391-409`), not argument
  positions.

**On that last point, with numbers.** The rig holds **133 `constant`
nodes** inside field expressions (argument positions, directly bindable)
against **8 `fbm` blocks** carrying `frequency`/`octaves`/`lacunarity`/
`gain`/`offset`. And `opts.position` *is* an argument position
(`fieldJson.ts:410-412`), so `frequency: f` is exactly
`position: mul(position(), f)` with `frequency: 1` — which is what
`noisePosition` already does (`expr.ts:78-84`).

> Of the rig's ~141 field-internal shaping numbers, **133 are directly
> bindable and 7 of the remaining 8 become bindable by writing the fbm the
> way `expr.ts` already writes it.** The design makes the
> `frequency`-in-`opts` problem disappear rather than solving it.

Caveat to document: folding a scale into the position field rounds through
f32 at the column where `frequency` multiplies in f64
(`src/noise/util.ts:328-330`). Identical except at knife edges — a
sentence in `authoring.md`, not a blocker.

## 9. Decided, and open

**Decided.**

- Every exposed param binds; `targets` is optional fan-out (§3).
- A bind-only param is **not** field-capable in v1 — a Field cannot be a
  uniform, and `checkExposedValues` (`subgraph.ts:702-706`) already
  refuses it with a good message. The v2 path is clear: compile a
  field-valued binding to a nested column as `run.ts compileParam`
  (`run.ts:636-691`) already does.
- No `formatVersion` bump for the grammar (§6).

**Open — needs a call.**

1. **Does the primitive cleanup land in this unit or the next?** It is the
   value case (56 plumbing nodes deleted) and it is where the hash churn
   and ref re-pinning land.
2. **Ship `{"fn":"detail","name":…}` alongside, or separately?** It closes
   the dead end documented at `src/data/attributes.ts:452` ("a detail
   attribute is NOT readable from a point-domain field") and at
   `attributeReduce`'s doc ("whose detail-domain output no field or param
   could have read back anyway"). Genuinely valuable, genuinely a different
   feature with different invalidation semantics: it needs a second
   namespace in `FieldKernelLayout` (`evaluator.ts:332` builds the layout
   from `ctx.geo.attrs[ctx.domain]` only) and index-0 rather than
   `flatIndex(ts,k)` addressing in `loadAttribute` (`compile.ts:233-250`).
3. **Should a wrapper surface its inner cook stats?** Small, separable,
   and it is what keeps the sandbox's `cooked / cached` readout honest
   once graphs get wrapped.
