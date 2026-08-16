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

**Strings readable as fields.** A field cannot read a string attribute,
so a `species` or `biome` string cannot drive a density field. Workaround
today: `setAttribute` in string mode already takes a NUMERIC selector to
index its `values` list, so an author has that number in hand and can
write it to an int attribute with one extra node.
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

**A knob that reaches into a field spec.** `nodeSeed` shipped and the
corpus has been rewritten around it: 38 noise specs across 23 graphs now
fold a bounded seed shift into `opts.position`, zero at each graph's own
default seed, so the seed box moves the shapes as well as the scatters.
What is still missing is the part an EDIT cannot supply. A panel knob
addresses `"<nodeId>.<param>"` and cannot reach INTO a field spec, so a
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
