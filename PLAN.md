# pcg-ts — plan

What is still ahead, and what was deliberately decided against.

Everything in this file is live. **Backlog** entries are wanted and
unscheduled, waiting on a real consumer to specify the mechanism.
**Stretch** entries record decisions NOT to build, with the measurements
that killed them — that is the expensive part to re-derive, so it is kept
even though nothing will act on it.

## Where the build log went

This file used to carry the phase-by-phase build plan: v0.1 through v0.12
plus phases 44-46, 47 of 48 phases, every one of them shipped. That was
~1,900 lines describing finished work, and the git history describes the
same work more accurately — each phase landed as its own commit, so
`git log` is the record, and unlike a checked-in tracker it cannot drift
from what actually merged.

The old "core type sketch" went with it. It was aligned to the v0.2 API
and said so in its own heading; `dist/*.d.ts`, `docs/nodes.json` and
`llms.txt` are generated from the code and are current by construction.

To read the plan as it stood at any release, check out its tag (`v0.1.0`
through `v0.14.0`), or follow this file back with
`git log --oneline -- PLAN.md`.

## Backlog — earned, waiting for a caller

Distinct from "Stretch" below, and the distinction is the point: Stretch
records things DECIDED AGAINST, with the measurements that killed them.
These are things we want, deferred only because nothing is pulling yet.
Every re-survey this cycle changed its own phase once a real consumer
existed, so the discipline is to let the consumer specify the mechanism
rather than guess at it. Each entry carries the analysis, because
re-deriving it is the expensive part.

### The rig's gap list, 2026-08-16

Ten things the rig wanted to say and could not, found by taking
`graphs/examples-rig.json` through the four features that shipped
because of its *previous* gap list. That loop is what the rig is for, so
these are recorded as found rather than triaged into other sections.

**Worked through 2026-08-16, and the loop closed on all ten.** Seven
shipped (1, 2's string half, 3, 4's calibration half, 5, 6, 7, 8, 10),
one was measured and deliberately deferred with the numbers that killed
it (9), and two entries turned out to be WRONG about their own case in
ways worth more than the features would have been: gap 2's `curveU`
dissolved when gap 1 shipped, and gap 7 named three sites when its real
case was eighteen. Two entries also record something the asking could not
have known — that a fractional group key is unsafe under the parity
promise (2), and that no seed derivation can be the identity at an
unnamed seed (4).

Adopted in that pass: inline `param` values (three ways — the
`spineWander` wrapper subgraph is gone, six noises gained an independent
`variant`, and a frozen `constant 1` became a knob), `attributeIs` (part
size now varies by kind), and `copyToPoints` `targetNames` (two
`floor(index/N)` restatements of another node's count are gone).
`mergePrimitives` did NOT fit and that is a result: every union in the rig
happens BEFORE topology exists, so there is nothing to preserve — see
gap 8, which is the reason.

1. **~~`copyToPoints` will not write the target index.~~ SHIPPED
   2026-08-16** as `targetIndexAttr`, exactly the param this entry asked
   for: name it and every copy in a target's block gets that target's
   index, i32, defaulted to -1 because that is the value no copy can have.
   The rig's two `setAttribute anchorId = index` nodes are gone (68 nodes
   to 66, 73 connections to 71) and `tests/graphs.golden.json` did not
   move by a byte — which is the whole claim, since a node whose only
   reader was `targetNames` was restating what the copy loop already
   computes as `i = t * nS + s`.
   **Its refusals are `targetNames`' refusals, and that is deliberate**:
   a composed standard (P / rot / scale / seed), a name the source
   already writes, and — the one that is new — a name `targetNames` is
   carrying, since those two would write the same column from opposite
   sides. A name the TARGET happens to carry is NOT refused: an uncarried
   target column never reaches the output, so there is nothing to collide
   with.
2. **~~`pointsToPath.groupAttr` requires whole numbers.~~ HALF SHIPPED,
   HALF REFUSED, 2026-08-16.** `groupAttr` now takes a STRING attribute —
   grouped by the word, emitted in ascending code-unit order of the word
   and never of its table index, which is the same identity-versus-index
   rule `attributeIs` is built on. That is the half worth having: a group
   IS usually a name, `partitionByAttribute` already splits on one, and
   the two nodes asking the same question and answering it differently is
   how an agent writes a graph that one accepts and the other refuses.
   **The fractional half is refused on purpose, and the reason is better
   than the old message's.** A group key is an IDENTITY. Two values a ULP
   apart are two paths, and the library's own parity promise is a
   TOLERANCE — the noise interiors round in f32 within a published range,
   so an f32 key could put a point in a different path on the GPU than on
   the CPU. The refusal now says that, and names the three ways to get a
   real key (`setAttribute` i32, `copyToPoints.targetIndexAttr`, or a
   string).
   **This entry's own example dissolved while it sat here.** `curveU` was
   the natural key only because writing an integer id cost a node; gap 1
   now has `copyToPoints` write that id itself, so the rig wants the
   fractional key nowhere. What shipped therefore has no corpus consumer
   yet — the graphs that group by name are the ones nobody has written.
3. **~~A noise's `opts.seed` / `opts.frequency` cannot hold a field
   spec.~~ SHIPPED 2026-08-16**, but NOT as field-valued opts — see
   `PLAN-noise-seeds.md`. `opts.seed` accepts exactly one non-numeric
   form, `{"from":"node","variant":N}`, resolved as
   `hashCombine(ctx.seed, variant)` in u32. **The restriction is the
   design, not a shortcut.** Every field column is f32, so an arbitrary
   field-valued seed would derive an integer through float arithmetic —
   and a ULP in a SEED is a different noise, not a value within a
   tolerance, which is the one thing this library's CPU/GPU promise does
   not cover. The safe subset is value-dependent and unnameable in the
   grammar, so the grammar names the safe CONSTRUCT instead.
   **Field-valued `opts.frequency` is refused because it already
   exists**: `{"position": mul(pos, F), "frequency": 1}` is the same
   sample point, fbm octaves included. One paragraph of docs beats a
   second field-valued option, and the refusal says so.
   Extending `opts.seed` rather than adding an `fn` also skips the whole
   new-fn tax — mandatory WGSL handler, two `MINIMAL_SPECS` corpora, four
   `listFieldFns().length` claims, the closed-set blocks in
   `docs/manual.html` and `llms.txt` — and stays FUSED on the device,
   which `attributeIs` does not. (Confirmed after the migration: the
   `examples-gpu-fields` capture still reports `1 / 2 run / fused`.)
   **The corpus migrated, and it took the fold's only subject with it.**
   39 folds across 25 files, ~1,270 spec nodes deleted. `param` is
   registered per-element and `constant` is declined by `isWorthFolding`,
   so `nodeSeed` was the ONLY uniform leaf that could seed a foldable
   subtree — with the idiom gone, the graphs contain zero domain-constant
   expressions and `tests/foldCorpus.test.ts` measured `actuallyFolded`
   at 0. `src/fields/fold.ts` is NOT dead: the idiom is still legal
   grammar and still documented, so a user's graph may be full of it. But
   nothing we ship exercises it any more, which is worth knowing before
   anyone reads that module's break-even measurements as live. Its teeth
   now bite on fixtures the test states outright; no threshold was
   lowered.
4. **~~Renaming a node silently changes its geometry~~ HALF SHIPPED, HALF
   IMPOSSIBLE, and saying which is the point.** The calibration constant
   is gone: `{"from":"node","variant":N}` needs no `W0`, so nothing has to
   be re-derived when a node is renamed. The rename HAZARD is not gone and
   cannot be: `nodeSeed` is `hash(graphSeed, nodeId)`, so no function of
   (graphSeed, nodeId, variant) can be the identity at a seed nobody
   names. Adopting the new form therefore RE-ROLLS the noise rather than
   preserving it, which is why the corpus migration is a look change and
   is authorized as one.
   **What made the calibration indefensible is a measurement, not a
   preference.** All 117 `W0` literals in the corpus were recomputed from
   the shipped derivation: 111 match and SIX do not —
   `basics-field-params.json` and `basics-inline-field-params.json` share
   a triple correct for neither, so both have silently had no
   seed-neutrality for as long as they have existed. A constant a human
   derives per site is a constant that is wrong somewhere.
   The other half shipped with it: `pcg validate` prints each node's
   DERIVED seed beside its type (and carries it in `--json`). It was
   already in `DescribedNode.seed` and the CLI was throwing it away, so
   the number that decides what a node draws could only be seen by cooking
   and inferring.
5. **~~An inline `param` cannot carry `min`/`max`/`description`, and the
   subgraph form can.~~ SHIPPED 2026-08-16** — the regression this week's
   work caused, and the only gap here that was fixed rather than recorded.
   Flattening `spineWander` had moved three param descriptions out of the
   graph and into a presentation-only panel file, where a graph opened
   without its panel lost them; `PLAN-spec-params.md` decided the panel
   was the right home for min/max and did not notice that the subgraph
   form kept them IN the graph. A `param` node now takes `min`, `max` and
   `description` beside its `value` (`inlineParamMetaOf`), the rig's three
   are back in `graphs/examples-rig.json`, and the panel keeps only what
   the graph cannot know — label, step, section. NOT `step`: `ParamSchema`
   has no such field and a second vocabulary is what a panel file is for.
   None of the three reaches `Field.key`, so the rig cooks to the same
   hash (`2778aafc`) either side of the change.
6. **~~No `switch` / `cases` over a string.~~ SHIPPED 2026-08-16** as
   `{"fn":"byAttribute","name":…,"cases":{…},"default":…}`; see
   `PLAN-by-attribute.md`. The rig's part sizing is three `byAttribute`
   calls instead of three nested `lerp`s over `attributeIs`, and `clamp`
   — which had been silently falling through to the uniform base scale —
   now has a stated case.
   **Two things this entry asked for are impossible and the feature does
   not pretend otherwise.** Case keys are NOT validated against the
   string table: each cell cooks its own geometry with its own table, so
   a cell legitimately lacking a value would throw while its neighbour
   succeeded (the partition-safety argument in `PLAN-attribute-is.md`).
   And duplicate-key detection is unimplementable — `JSON.parse`
   collapses duplicate object keys before the grammar ever sees them. So
   a misspelled key is still dead code; what the form buys is that the
   fall-through is NAMED and the case set is enumerable in one place.
7. **~~No graph-scoped param.~~ SHIPPED 2026-08-16** as a top-level
   `params` array bound by name at deserialize; see
   `PLAN-graph-scoped-params.md`. Binding SUBSTITUTES when the field is
   built, which is forced rather than chosen — `Field.key` is fixed at
   construction and is what the memo key hashes, so a value arriving later
   would cook the previous value's bytes. Two consequences, both tested: a
   declared value is byte-identical to the number written out longhand,
   and `setGraphParam` re-keys exactly the readers.
   **The entry named the smaller half of its own case.** Cable radius is
   three sites; the truss half-width is EIGHTEEN readings across nine
   nodes, in four different float spellings of 0.425, and `also` cannot
   express that one at all — `mirrorsFor` performs no transformation, so a
   mirror can only assign, where a name can sit inside `mul(name, √2)`.
   Gap 7 read as a panel problem and was a graph problem.
   **The migration's byte question answered itself.** The design expected
   the rig's bytes to move ~1e-16 because one declared value cannot
   reproduce four spellings. Measured: they do not move at all. Every
   combinator stores f32, all four f64 spellings round to the same f32,
   and `0.425 * 1.4142135623730951` reproduces the diagonal literal
   exactly in f64 — byte-identical under `graphFingerprint`, against a
   seed+1 control that reports different.
   `also` survives for what a field reference cannot occupy:
   `sweepProfile.sides` is `i32`, six copies, and no expression can reach
   it.
8. **~~Point filters drop all topology.~~ SHIPPED 2026-08-16** as
   `topology: "drop" | "keep"` on the five point filters
   (`filterByDensity`, `filterByBounds`, `filterByAttribute`,
   `filterByExpression`, `selfPrune`), default `"drop"` and byte-identical
   there; a primitive survives iff EVERY point it references does. See
   `PLAN-filter-topology.md`. `gatherPrimitives` was reused rather than
   duplicated — its `dropUnreferenced` boolean became
   `GatherPointRule = "all" | "referenced" | ArrayLike<number>`, because
   `"keep"` must emit exactly the point domain `"drop"` emits and neither
   old rule does that.
   **This entry's causal claim was wrong about the rig, which is worth
   keeping.** It said filters dropping topology was "exactly why
   `mergePrimitives` had nothing to preserve". Measured: `trussKeep` sits
   BELOW a `mergePoints` that had already flattened to 184 points and 0
   primitives, so the topology was destroyed by the MERGE, not by the
   filter. The feature is right in general and buys the rig nothing. What
   the rig actually wants is `mergePrimitives` in place of `mergePoints`
   at `trussMove0/2/4/6`, which makes `trussChordPath` / `trussBracePath`
   and eight `trussTag*` nodes dead — ten nodes, wiring in the plan doc.
   APPLIED 2026-08-16 (`948f235`): 78 nodes to 68, 83 connections to 73,
   and the only difference in the whole cook is that the dead
   `point.strutId` column stops appearing on three outputs.
9. **~~`attributeIs` disqualifies a fused GPU run~~ MEASURED AND
   DEFERRED 2026-08-16; the design is in `PLAN-attribute-is-gpu.md`, and
   this entry was wrong twice in a way that inflated it.** It does NOT
   make a node CPU-only: the field still resolves on the device per node
   — `compile.ts` gives `attributeIs` a pre-assigned uniform slot, and
   `compile.test.ts` asserts there is no such thing as a CPU-only field
   fn — what is lost is membership in a FUSED run. And there is no "u32
   device column" to add: a string column already binds as u32, and the
   literal's resolved index is a per-dispatch uniform lane rather than a
   column.
   **The stake, measured:** two corpus graphs use `attributeIs` /
   `byAttribute` and no demo does. `basics-mask-by-species.json` forms no
   resident run at all, so it loses nothing. In the rig the maximal
   fusable chain containing the `byAttribute` is `[partSize,
   partPartSpawn]` — `partOrient` is already out for a field-valued `up`
   and `partPart` for being a string write — and `narrowRun` falls back
   to `[partPartSpawn]`, which plans, so **the rig keeps its
   device-resident spawner today**. The whole win is fusing one
   `setAttribute` over 666 points: one readback and one clone, bounded
   above by that node's entire cost, 0.8 ms of a 104.9 ms cook.
   The fix is real and small when a caller earns it (two blockers, both
   in `run.ts`: `KernelStep` must carry the attributeIs PAIRS and resolve
   them at execute time where the geometry exists, and `slotFor` must
   stop refusing a string column). The rule to keep: the pairs belong in
   the kernel key, the resolved index belongs in NO key and NO plan —
   two cells of one world routinely share a point count and differ in
   table order, and the count is the executor's only guard, so a baked
   index would fail silently.
10. **~~No CLI listing of a graph's knob addresses.~~ SHIPPED
    2026-08-16** as `pcg validate <graph.json> --params`, which prints
    every address with its value and range and marks the ones an author
    declared worth turning; `--json` emits the same list. The rig reports
    301 addresses, 11 declared, and
    `spineWander.translate.verticalAmplitude` — the address that cost a
    browser launch to find — is one line of it.
    **The listing is a LIBRARY function, not a CLI one, and that is the
    part worth keeping.** `describeGraphParams(graph)` derives the
    addresses, and the sandbox now builds its knobs from it rather than
    from its own copy of the same rule. Two derivations of one address
    was the real hazard: a panel file, a shared link and a command line
    all spell a knob the same way, and the CLI answering differently from
    the tool would be worse than not answering. `inlineParamSchema` moved
    with it, so the schema a value inside a field spec gets is also
    derived once.
11. **~~`tests/graphs.golden.json` cannot see instance transforms.~~
    CLOSED 2026-08-16** — never an expressiveness gap like the ten above,
    a coverage one, found while fixing gap 6. The rig's `clamp` parts were
    resized from `(1,1,1)` to `(1.25, 0.5, 1.25)`, which is plainly
    visible in the render, and the golden entry did not move by one byte
    in any of the three states the rewrite passed through: the golden
    pinned per-domain counts and `P` bounds, and an instances output
    contributes neither.

    Closed by per-batch transform STATISTICS in `src/docs/graphGolden.ts`
    — translation, scale and rotation as min/max/mean, the three factors
    `InstanceBatch.transforms` is defined by — not by the digest this
    entry originally asked for. A digest was rejected on the golden's own
    stated grounds: it is exactness against a STORED constant, and the
    reason the tolerance exists names this case outright ("a different
    rounding in a transform"), so it would have gone stale on the next
    reassociated sum. It also fails uninformatively, where the statistics
    name the batch and the direction — the reverted-clamp proof reports
    `batch 2 "clamp" scale mean y 0.9963 (golden 0.4982)`. Byte-exactness
    over transforms already lives in `graphFingerprint`, run against run,
    where it cannot go stale but also cannot see an intended edit. 13 of
    the 54 corpus entries carry the new data, over 47 batches; the other
    41 are byte-identical.

**~~Primitive identity, so primitive-domain randomness stops being
index-keyed.~~ SHIPPED 2026-08-16** — `primitiveIdentities` in
`src/data/identity.ts`, folded order-independently from a primitive's own
points' identities; see `PLAN-primitive-identity.md`. Vertex and detail
deliberately still key on the index, having no caller.

**The measurement below does NOT demonstrate what this entry claimed, and
that is the part worth keeping.** `pointIdentities` hashes the f32 BIT
PATTERNS of `P`, so a position that moves at all gets a new identity and
everything derived from it moves too — endpoint-derived primitive identity
could never have prevented a spine nudge from re-rolling the chords.
Measured at rig-scale coordinates, 1.9e-6 is 16 ulps at x=1, 2 ulps at
x=10 and ZERO at x=36, which is also why only a third of the edges
permuted rather than all of them. Two failures were running at once:
points moving (unfixable, and correctly so) and primitives reordering
(fixed). The honest claim for the fix is "stable under reordering", which
is this entry's OTHER example — a faster spatial grid returning neighbours
in a different order — not "stable under numerical improvement".

Original analysis, kept because the measurement is still the expensive
part to re-derive: point-domain randomness is keyed on position bits and a
seed attribute (`src/data/identity.ts`), so it survives a renumbering.
Primitive-domain randomness had no such identity and fell back to the
element index — which meant it re-rolled whenever anything upstream changed
the ORDER primitives came out in, even when the set was unchanged.
- **Measured 2026-08-14 on `examples-rig.json`**, and this is what makes
  it worth an entry rather than a note. Moving the spine by 1.9e-6 world
  units — an f32 rounding, nothing more — left `connectPoints` emitting
  the same 456 edges with sorted lengths agreeing to 2.4e-7, but 156 of
  the 456 slots held a different edge. `chordPick` is a `randomField` on
  the primitive domain, so 63 chords passing its threshold became 54, and
  198 tube instances appeared out of a last-bit change. A control
  confirms the mechanism is not the field-param work: nudging the
  unwrapped original's baked noise frequency by a relative 1e-8 does the
  same thing.
- So a graph that is perfectly deterministic is not STABLE: any numerical
  improvement anywhere upstream — a reassociated sum, a faster spatial
  grid, the f32-vs-f64 difference between two spellings of the same knob
  — silently reshuffles every downstream primitive-keyed random. That is
  exactly the class of change `tests/graphs.test.ts` says it wants to
  survive.
- The fix is the phase-42 answer at a new domain: derive a primitive's
  identity from its ENDPOINTS' identities (order-independently, so an
  edge and its reverse agree), the way a point's comes from its position
  bits. Wants a caller before it is designed — the honest trigger is the
  first time someone is bitten by a corpus diff they cannot explain, or
  the first graph that needs a stable per-edge random across an edit.

**~~Strings readable as fields.~~ SHIPPED 2026-08-16** as
`attributeIs(name, value)` — see `PLAN-attribute-is.md`. The analysis
below is kept because it is what made the design safe, and because the
GPU half of it was wrong in a way worth not repeating.

Original entry: a field could not read a string attribute, so a `species`
or `biome` string could not drive a density field. The workaround was to
carry a parallel numeric column by hand.
- **The obvious design is a determinism bug, and this is the part worth
  keeping.** A field fn returning the string's TABLE INDEX would expose
  an insertion-ordered artifact: the same logical value can intern at
  different indices in different geometries, and under partitioned
  cooking, in different cells. It is the identity-versus-index lesson of
  phase 42 wearing a new costume, and it would pass every test we have
  until two cells disagreed.
- The safe form is a PREDICATE — `attributeIs(name, "pine")` → 0/1 —
  which never exposes the index. **In progress; see
  `PLAN-attribute-is.md` for the worked design.**
- This entry used to say it "compiles to the GPU cleanly: the literal
  resolves against the string table host-side at kernel BUILD time".
  The first half is right and the second is a bug. The kernel cache key
  is spec text plus each attribute's name/type/tupleSize
  (`evaluator.ts:346-368`) and does NOT include table contents, so a
  literal baked at build time would be shared by two geometries whose
  tables differ. The resolved index belongs to the geometry, not the
  spec: it has to ride a per-dispatch uniform.
- Which is the part the old cost estimate missed. `ParamPlan` is derived
  from the SPEC ALONE (`computeParamPlan`, `compile.ts:933`, admits only
  `fn === "param"`), and the fused path bakes its consts at plan time
  (`run.ts:680-692`) where no geometry exists. So this needs a
  geometry-aware slot on the per-field path and a declared decline on the
  fused one — not just a new fn.
- Cost: the grammar change itself is SIX sites, not the five this entry
  claimed — constructor, registration (now including `variation`), spec
  emission, WGSL lowering, the parity minimal spec, and the docs'
  closed-set block. Each is pinned by a test, `compile.test.ts`'s
  `supportedGpuFieldFns() === listFieldFns()` most sharply: there is no
  such thing as a CPU-only field fn.

**~~A knob that reaches into a field spec.~~ SHIPPED 2026-08-16.** A
`param` spec node carries an optional inline `value`, and the sandbox
surfaces each inline-valued one as a knob keyed
`"<nodeId>.<paramKey>.<fieldParamName>"` with a schema derived from the
value's shape, refinable by a panel file. See `PLAN-spec-params.md`. The
entry's own guess — "expose a plain node's field-spec `param` names on the
panel, not a new mechanism" — was right; what it did not anticipate is
that a plain node had nowhere to keep the VALUE, which is why the grammar
gained a key rather than the panel gaining a lookup.

Original entry: `nodeSeed` shipped and the
corpus has been rewritten around it: 38 noise specs across 23 graphs now
fold a bounded seed shift into `opts.position`, zero at each graph's own
default seed, so the seed box moves the shapes as well as the scatters.
What was still missing was the part an EDIT cannot supply. A panel knob
addressed `"<nodeId>.<param>"` and could not reach INTO a field spec, so a
graph gains a working seed box only by being rewritten, and a knob that
is not the seed still cannot touch a noise at all. `param` is the
closest thing to an answer (a name inside a spec, bound from outside)
and the subgraph binding already supplies it — so the honest shape of
this is probably "expose a plain node's field-spec `param` names on the
panel", not a new mechanism.
- The rig showed what the shape costs. Its four `*Variant` params folded
  into the noise seed host-side; frozen, they were numbers in a spec.
  There is one `nodeSeed` per node, so independence has to come from a
  different constant per noise rather than from separate seeds: the
  corpus uses a distinct multiplier per slot (1021 / 3067 / 8191), which
  measures as indistinguishable from independent but is still one draw
  wearing three hats. Four genuinely independent per-shape variants
  still want four `param` names bound from a wrapper.

**A per-item cache for `forEach`.** The loop shipped; this is the one
piece of it deliberately left out, and the measurement is the expensive
part to re-derive. A `forEach` cooks its body once per element and
memoizes nothing between iterations, so an edit anywhere upstream
recooks all K.
- **Caching per item does not pay against its own motivating producer.**
  `partitionByAttribute` calls `makeGeometryItem` per group on every
  execute, and that mints a fresh `rev` — so when anything upstream
  moves, all K groups arrive with new revs even where K-1 are
  byte-identical, and a rev-keyed cache misses on all of them. When
  nothing moves, the `forEach` node's own memo key is unchanged and the
  whole node is a hit, so the per-item cache is never consulted. Its win
  case is the narrow band where exactly one item's rev moved: a
  `dataInput` binding from the World, not the partition producer the
  feature exists for.
- **Keying it on content alone would be unsound**, which is the trap
  worth recording: a changed "pine" group would serve the old "pine"
  bytes. `(contentKey, rev)` is sound and never hits, per above.
- So the prerequisite is a rev-stable `partitionByAttribute` — one that
  hands an unchanged group back its previous item rather than minting a
  new one. That is a separate, well-scoped change, and it is what a
  consumer should ask for first.
- Two hazards for whoever builds it. A cached item carrying
  `deviceBatches` hands out a handle its consumer already disposed —
  the executor marks those entries `volatile` for exactly this reason,
  so any cache must refuse them. And the no-node-mutates-its-input rule
  the aliasing rests on is a convention (`cloneGeometry` at 46 sites),
  not an enforced invariant: a third-party node that mutates its input
  corrupts a shared cache where today it corrupts only its own memo.

**`docs/pages/` is a committed build that no gate regenerates or
checks.** 100 tracked files produced by `npm run examples:pages`, which
neither `npm run docs` nor CI runs — so it drifts from source silently and
nothing notices. Adding `graphs/basics-mask-by-species.json` proved it:
the sandbox enumerates graphs with `import.meta.glob` at BUILD time
(`shared/presets.ts:33-34`), so until the site was rebuilt by hand,
`docs/graphs.md` advertised 51 graphs while the hosted tool offered 50.
The rebuild is cheap and small — 408 ms, 27 files, because vite
content-hashes per graph so untouched graphs keep their chunks — which is
what makes the absence of a gate hard to justify. Either `npm run docs`
should include it, or a test should assert the built manifest covers every
graph in `graphs/`. The second is better: it fails on the drift rather
than papering over it, and it is the same "prose nothing tests" defect
this file records twice below.

**Documentation that quotes measured output has no assertion behind
it.** Phase 44's docs pass found the manual's Part II transcripts had
silently become fiction — 1008 points where the library now produces
1038, a stale determinism fingerprint, an error listing 25 registered
types against a registry of 38 — because phases 42-44 moved per-point
randomness onto identity and every number shifted. The countable half is
now policed by `COUNT_CLAIMS` in `src/docs/site.ts` (19 claims). The
transcripts are not. Fixing it means either generating them or asserting
them, and both are real work.

## Stretch — surveyed and NOT scheduled

- **Lowering the fold's element threshold so a param-bearing graph pays
  for itself.** Measured 2026-08-15, right after `src/fields/fold.ts`
  learned to see through a bound `param` — it recovers each reference's
  substituted value from the stamp beside its spec node and re-supplies it
  to the rebuild, which is what the old backlog entry here asked for.
  **Recommendation: do not schedule.** The mechanism works and pays where
  it applies: the rig's own spine-wander expression — three bound params
  over twelve seed-shift chains — resolved across 40 000 points goes 89.2
  ms → 85.5 ms warm (medians of 24 cooks per side, interleaved
  process-by-process; p25–p75 87.3–92.8 against 77.5–88.8, and -4% to -7%
  across repeats of the whole experiment) and 109.1 ms → 101.1 ms cold,
  which is the steadier number at -7 to -8% every time because a cold
  process pays the fold's miss as well as its saving. Byte-identical
  output either way. But no SHIPPED graph is in that regime.
  `examples-rig.json` resolves that expression over its
  130-point spine and `basics-field-params.json` over 576 points, both
  under `MIN_ELEMENTS_TO_FOLD` (1024), so the whole-graph cook does not
  move: two runs of the same interleaved experiment gave +0.6% and -1.8%
  warm, -2.7% and -3.2% cold — a difference whose SIGN is not repeatable
  is the definition of noise. The "~10% back" the old entry promised is
  therefore not available to the corpus as it stands, and the threshold is
  not the thing to move for it: it exists because a fold MISS is a fixed
  cost against a per-element saving, and without it a 16-point streamed
  cell measured 16.8x SLOWER. The win arrives on its own the first time a
  param-bearing expression lands on a domain of thousands.

- **Rescaling the shared noise convention so an amplitude knob reaches
  its stated bound.** Measured 2026-08-09 across all 34 primitives.
  **Recommendation: do not schedule.** Every noise-amplitude param
  under-delivers, because the catalog's shared `amp × remap(normalized
  fBm)` term normalizes against fBm's THEORETICAL range while its
  realized range is far narrower: `transform/displace-by-noise` reaches
  0.42 of its promised `±amount`, and the threshold knobs on
  `filter/mask-by-noise` and `fill/volume-by-noise` do all their travel
  inside 0.32–0.68 rather than 0–1. The obvious fix is a two-line
  constant rescale in `tunableFbm`, and it is wrong: utilization is NOT
  a constant — 0.42 on a wide 2D cloud, 0.50 in 3D, 0.25 on a patch
  spanning about one period — so a constant factor converts systematic
  UNDER-delivery into position-dependent error, overshooting to 1.17×
  on wide high-frequency clouds. An `amount` that sometimes EXCEEDS its
  stated bound is worse than one that reliably undershoots it. A
  per-cook fit to the realized range would be exact and breaks the
  determinism invariant outright: under partitioned cooking each
  partition would fit its own range, so the same point would move
  differently depending on how the work was split. What shipped instead
  is the honest alternative — every one of these params now documents
  its measured law and band, with tests pinning them. If a
  true-amplitude knob is ever wanted, add it opt-in beside the existing
  one; do not move what already ships.

- **Device-produced asset keys** (make `setAttribute` resident in
  string `values` mode). Surveyed 2026-08-07; **recommendation: do not
  schedule.** Recorded here so it is not picked up later on the
  premises it was written with, all three of which the survey broke:
  - *"It would extend the forest's run to its full chain."* It would
    not. Every field in `graphs/examples-forest.json` is code-authored and
    carries no `FieldSpec`, and fusability requires all field params to
    be spec'd — so widening the resident predicate moves the forest
    from 1 fused member to 1. The benefit is zero, not small.
  - *"It would finally require the stable counting sort."* It would
    not. WebGPU has no device-side allocation, and the host must know
    each batch's `assetId` (a string), its `count`, and how many
    batches there are before it can allocate. A readback is therefore
    unavoidable in every candidate design, and all of them pay the same
    mid-run pass split. The only question is how many bytes ride an
    already-paid round trip — reading back the key column is `n * 4`
    against a constant `2K`, i.e. microseconds of bandwidth against a
    sub-millisecond latency. Buying that with the repo's first atomics,
    first workgroup-shared memory and first cross-workgroup scan — and
    a determinism proof argued rather than inherited from
    `groupPointsByAsset` — is a bad trade.
  - *"The kernel writes `lut[clamp(floor(selector), 0, last)]`."* Not
    portable: the CPU semantics are `floor`, then `!(idx > 0) -> 0`,
    which is deliberately NaN-safe (NaN selects index 0). WGSL `clamp`
    carries no such guarantee, so that body would violate the
    determinism invariant.

  If it is ever revisited, the design to build is the cheap one: read
  back the key column and reuse the shipped `groupPointsByAsset`.

- ~~**The better opener:** give code-authored field combinators their
  own `FieldSpec`s.~~ Surveyed and **scheduled as v0.9, phases 32-34**
  above. The survey confirmed it is cheap but reframed the reason: the
  GPU gain is small (`02-forest` 1 member → 3), while the real cost of
  today's behaviour is that a graph holding a combinator field cannot
  be serialized at all.

- **A `resident` descriptor for `filterByAttribute`** (a count-changing
  resident member). Surveyed 2026-08-08; **recommendation: do not
  schedule.** Feasible, and cheaper than this entry assumed — the
  data-dependent count is *not* the blocker v0.9's survey found for
  device-produced keys, because the input count bounds every
  allocation, no field's value depends on the element count, and the
  surviving count rides the run's existing readback as four extra
  bytes. Two findings settle it anyway:
  - **It does not compose with the zero-round-trip path.** At a spawner
    terminal the surviving count sizes a retained buffer and there is
    no readback for it to ride (`needsGeometry === false`). So a run
    may never contain both a count-changing member and an instances
    terminal — the feature is architecturally exclusive with what
    phases 26-30 built, which is the line this project has invested
    most in.
  - **The forest's entire saving is free today.** Moving
    `setAttribute("scale")` ahead of the two filters in
    `graphs/examples-forest.json` buys the same one readback for zero library
    work (different random scales, equally valid). Any estimate of this
    feature must be net of that, and net of it the benefit is close to
    nothing.

  It would also retire the safety argument at `run.ts:11-18` — "every
  kernel touches only element `i`" is why attribute buffers are bound
  in place as `read_write`, and a prefix scan breaks that. If it is
  ever revisited, build the cheap shape: host-normalized
  `(comparison, f32 threshold)`, a global ping-pong scan with **no
  atomics** (an atomic bump would make survivor order nondeterministic),
  a device-side count word, and materialization reusing the shipped
  `gatherPoints` so the ordering spec keeps one implementation — the
  shape v0.8 and v0.9 both converged on. And gate it on a measurement:
  the scan must beat the round trip it eliminates at the counts the
  examples actually use.

  Full survey: `notes/research/v10-resident-filter-survey.md` in the
  private repo, including a phase breakdown if it is scheduled anyway.

- ~~**Free and unscheduled:** reorder `graphs/examples-forest.json` so
  `setAttribute("scale")` precedes the two filters.~~ **Done**
  2026-08-08 (`0ed9290`): 2 runs / 4 members, one readback fewer, no
  library change. It captured the entire benefit the resident-filter
  descriptor above was going to be built for.

- **A `maxDegree` bounded within a radius.** Halo-exact and unbuilt. The
  distinction that makes it safe: an unbounded k-nearest is the trap, a
  bounded RANK is not — within a radius the witness for any pair lies
  inside that pair's own neighbourhood, so a partition cannot change the
  answer. Chaining maximal degree-2 runs into longer polylines is the
  part that stays out of reach: it is NOT partition-invariant at the
  primitive domain, because the edge set and the geometry agree across a
  split while the grouping does not. (`findPath` remains cut for the
  related reason that no finite halo suffices for a global shortest
  path.)

- **Per-cause serialization refusal messages.** `fieldToJson` refuses
  with one message that *enumerates* all three causes — a `makeField`
  closure, anything composed over one, and a tree past
  `MAX_SPEC_DEPTH` — rather than naming the one that actually applies.
  `serializeGraph` prefixes it with `node "<id>" param "<key>"`, so the
  location is always exact; only the cause is ambiguous. CLAUDE.md
  treats error messages as part of the agent API, and "it is one of
  these three" is weaker than this library's standard elsewhere.
  Not fixable in the message alone: nothing records *why* a spec is
  absent, because `undefined` propagates up the derivation without a
  reason. Needs a reason carried alongside the withheld spec (the depth
  `WeakMap` in `src/fields/spec.ts` is the obvious place), then the
  three call sites in `fieldToJson` discriminate on it. Small, and
  worth doing the next time `src/fields/spec.ts` is open for another
  purpose.

- **Give `demos/infinite-world` a GPU evaluator.** It has
  `demos/gpu-world`'s shape authored with combinators, so it became the
  natural showcase once v0.9 landed — but it is demo work, not library
  work.

Full survey: `notes/research/v09-device-keys-survey.md` in the private
repo.

## Execution notes (unattended)
- Phases run in order; no phase starts until the previous phase's exit
  criteria pass.
- Per CLAUDE.md: bulk implementation of a phase may be delegated to a
  subagent owning that phase's files; nontrivial phases get an independent
  verification agent before being marked complete.
- After every phase (and significant mid-phase milestone): run full tests,
  commit `phase(N): ...`. The commit history IS the progress record.
- Blockers that need a user decision are raised with the user rather than
  stalling silently — pick the most reasonable default, note it in the
  commit message, and continue.
