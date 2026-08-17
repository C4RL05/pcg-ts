# Noise seeds that follow the graph — `{"from":"node","variant":N}`

Gaps 3 and 4 of the rig's gap list are one subsystem: how a SAVED noise
re-rolls when the graph seed moves, and how an author gets several
independent re-rolls out of one node. They are also, in the order they
were written, cause and effect. Gap 3 is the missing feature. Gap 4 is
the bill for the workaround that stands in for it.

The proposal here is small and it is not what either gap asked for:

**`opts.seed` gains exactly one non-numeric form,
`{"from":"node","variant":N}`, resolved as `hashCombine(ctx.seed,
variant)` in u32 integer math. Arbitrary field-valued `opts.seed` is
refused. Field-valued `opts.frequency` is refused because it already
exists. No new grammar `fn` is added.**

The rest of this document is why each of those is the answer, what it
costs, and — §6 — the one thing gap 4 asked for that provably cannot be
delivered.

## What the corpus pays today, measured

Every noise in the corpus carries a literal `opts.seed`, so the graph's
seed box moves the scatters and not the shapes. The workaround, documented
at `src/fields/inputs.ts:463-528` and derived at
`docs/authoring.md:449-559`, folds a bounded per-node offset into
`opts.position`:

```
A * (fract(nodeSeed * 2^-32 * K) - W0)     per axis, three axes
```

Counted over `graphs/`, all 88 files:

- **25 files carry it** — PLAN.md's entry says 38 specs across 23 graphs;
  recounted for this document it is 39 across 25, so that figure is stale
  by two files and one spec. 234 `{"fn":"nodeSeed"}` spec nodes, which is
  exactly `39 folded specs x 6` — two `nodeSeed` leaves per axis (once in
  the product, once inside the `floor`), three axes, no exceptions.
- **39 of the corpus' 41 noise specs are folded** (perlin 17/17, fbm
  16/18, worley 4/4, value 2/2). The two that are not sit inside a
  `forEach` body, which is the one place the docs forbid the idiom.
- Each fold is ~32 spec nodes (10 per axis, plus the `vec` and the
  `add`), or ~44 where the rig adds its variant knob. **About 1,300 spec
  nodes of the corpus are this one idiom.**
- Three constant families: `K ∈ {1021, 3067, 8191}`, rotated per slot,
  universal; **15 distinct amplitudes `A`**, each ≈ `32 / opts.frequency`
  rounded tidy, so no two graphs at different frequencies can share one;
  and **117 `W0` literals, 66 distinct**, each written to nine
  significant figures because eight fails to name an f32 about one time
  in 160.
- The CPU cost is a dozen extra full-domain passes per folded noise —
  `examples-gpu-fields` measured 0.61 s → 1.22 s — which is why
  `src/fields/fold.ts` exists at all, and why it declines below 1024
  elements, i.e. throughout the streaming regime.

### The measurement that decides this design

`W0` is the fold's own value at that graph's default seed, which is what
makes adopting the idiom output-neutral. It is derived by emulating the
library's staged f32 rounding — the throwaway script gap 4 complains
about. **Recomputing all 117 from the shipped derivation
(`deriveNodeSeed` + murmur3 + `fround` at each stage): 111 match, 6 do
not.**

The six are the three axes each of `graphs/basics-field-params.json`
(seed 1044, node `lift`) and `graphs/basics-inline-field-params.json`
(seed 1045, node `dunes`). They carry an identical W0 triple despite
different seeds AND different node ids, so it is correct for neither: it
was inherited from some third (seed, node id) pair that no longer exists
in the corpus. **Both graphs have silently lost the property the
calibration constant is there to provide, and nothing noticed.**

That is the case against calibration constants stated as a fact rather
than a preference. A number that must be re-derived by script whenever
the graph seed or a node id changes will be stale in ~5% of its
instances, and staleness is invisible: the graph still cooks, still looks
plausible, and is simply no longer seed-neutral.

## 1. Arbitrary field-valued `opts.seed` — REJECTED

Gap 3 asks for `opts.seed` to hold a field spec. It must not, and the
reasons compound rather than merely accumulate.

**A seed has no tolerance.** The library's parity contract (README's
table, `src/gpu/parity.testsupport.ts`) budgets f32 rounding inside noise
INTERIORS. A one-ULP disagreement in a seed is not a rounding error in
the output; it is `hashCombine` avalanching to an unrelated u32 and the
node cooking a completely different noise field on the two paths. There
is no budget that expresses "within one ULP of the same seed", because
the notion is empty.

**Every field column is f32.** `Column.data` is a `Float32Array`, so a
seed read through a field arrives having been rounded to 24 bits of
mantissa. Node seeds are hashed u32s and are therefore above 2^24
essentially always — `nodeSeed()`'s own doc block says so and lowers
itself in two pieces precisely so that CPU and GPU land on the same
lossy f32. A seed that travels through a column cannot be the seed the
author meant, only a nearby one, and "nearby" is meaningless (above).

**The grammar cannot statically admit the safe subset.** A restriction
to "expressions that are exactly representable and computed identically
on both paths" is not checkable from the spec: it depends on VALUES
(`floor(x)` is exact everywhere; `mul(a, b)` is exact only for the
operands that happen to occur), and the values arrive at evaluation. The
existing idiom is safe only because `docs/authoring.md` states, in prose,
a four-function whitelist and a bounded amplitude, and because a human
obeys it.

**A UNIFORM restriction does not rescue it.** `fnVariation` in
`src/fields/fieldJson.ts:155-181` can prove an expression is
domain-constant, which answers "when is it resolved" but says nothing
about "is the number the same on both platforms". A uniform `div` or
`sin` is uniformly wrong on one of the two. Uniformity is the wrong
predicate for this position; exactness is the predicate, and it is not a
property the grammar can see.

**And it would cost structure for nothing.** `makeNoiseField`
(`src/noise/util.ts:303-367`) builds its sampler at CONSTRUCTION from
`hash2(kindSalt, seed)` and puts the seed in `Field.key`. A field-valued
seed defers both. That much is affordable (see §8) — but paying it to
admit a construction whose result is platform-dependent is paying for a
liability.

So: `opts.seed` stays closed. It admits an integer, or one tagged form.

## 2. What is admitted: one closed form, resolved in u32

**Decision: `opts.seed` may be an integer (unchanged), or
`{"from": "node", "variant": <integer>}`, which resolves at evaluation
to `hashCombine(ctx.seed, variant)` — pure u32 murmur, no float
arithmetic anywhere in the seed path.** `variant` defaults to 0.

```json
{ "fn": "perlinNoise", "opts": { "seed": { "from": "node", "variant": 3 },
                                 "frequency": 0.045 } }
```

That replaces this, per noise:

```json
{ "fn": "perlinNoise", "opts": { "seed": 12345, "frequency": 0.045,
  "position": { "fn": "add", "args": [ <the position>, { "fn": "vec", "args": [
    <10-node chain, K=1021, A=900, W0=0.185058594>,
    <10-node chain, K=3067, A=900, W0=0.663146973>,
    <10-node chain, K=8191, A=900, W0=0.968505859> ]}]}}}
```

**`variant` IS the old literal seed.** That is the point of the name
sharing a position with it: the migration of one noise is `"seed": 12345`
→ `"seed": {"from":"node","variant":12345}`, and the author's chosen
number keeps whatever meaning it had. Two noises on one node with
different variants are two independent draws, not — as today — one draw
wearing three hats via different `K` multipliers. That closes the
reservation recorded in PLAN.md ("still one draw wearing three hats… four
genuinely independent per-shape variants still want four `param` names
bound from a wrapper"): they want a variant, and now they have one.

The derivation, stated so it can be tested from outside:

```
noiseSeed = hashCombine(ctx.seed, variant)              // u32
sampler   = makeSampler(hash2(kindSalt, noiseSeed))     // unchanged
fbm octave o: hashCombine(noiseSeed, o)                 // unchanged shape
```

Every step is `Math.imul`, xor and shift on the CPU
(`src/random/hash.ts`) and the same operations on wrapping u32s in WGSL
(`src/gpu/wgslLib.ts:110-164`, built from the SAME exported constants).
**Bit-exact by construction, on every platform, with no budget spent** —
which is a strictly better position than the current idiom holds, since
that one is bit-exact only inside a hand-maintained whitelist of four
combinators and a bounded amplitude.

Range rules, checked at parse: `variant` is an integer, `0 <= variant <=
2^24`. Non-negative because `hashCombine` interprets values mod 2^32
(negatives wrap fine on the CPU) while the GPU may read it back through
an f32 uniform slot (§3), where a negative or out-of-range conversion is
not defined to agree. `2^24` because that is where an f32 stops holding
every integer. The bound costs nothing: a variant is a slot number, not
a seed.

### Why a tagged object and not a spec at `opts.seed`

`{"fn":"nodeSeed","variant":3}` would look tidier and is wrong twice: it
reuses a name whose established meaning is "the f32 column holding
`ctx.seed`" for something that is deliberately never an f32, and it puts
a `fn`-shaped node in a position that every spec walker would then try to
compile as a field. A bare `{from, variant}` object announces that it is
NOT a field expression; the walkers reach exactly one thing inside it
(§3) and nothing else.

`from` rather than a boolean because the discriminator has obvious
future members (`{"from":"cell"}` for a per-cell re-roll that survives a
node rename) and a boolean has none.

## 3. The `variant` as a knob — the rig's six `*Variant` params

The rig does not write a bare constant into its folds. Every one of its
six carries an inline param ADDED to the normalized seed before the `K`
multiply:

```json
{ "fn": "add", "args": [ { "fn": "mul", "args": [ { "fn": "nodeSeed" },
  2.3283064365386963e-10 ] }, { "fn": "param", "name": "clusterVariant",
  "value": 0 } ] }
```

Those six are addresses `describeGraphParams` reports and the editor
puts on a panel. A design that made `variant` a bare integer would delete
six working knobs, so:

**Decision: `opts.seed.variant` accepts an integer, or an inline `param`
spec whose value is an integer in range.** It is the second spec-valued
position the grammar has gained since `byAttribute`'s `cases`, and it is
the narrowest possible one: exactly one `fn` is admitted there, and only
with an integer value.

`specChildren` (`src/fields/spec.ts:495`) learns to yield
`opts.seed.variant`, which gets `walkSpecNodes`, `eachSpecNode`,
`paramBindings` and `specKeysOnIdentity` for free — the four walkers that
route through it. **`fold.ts:rewrite` needs no change**: the only spec
admitted at that position is a bare `param`, and `isWorthFolding`
(`fold.ts:241`) declines any node whose args contain no spec, so a bare
param is never replaced. The fold's own drift guard (`fold.ts:423`,
comparing its walk against `paramNamesOf`'s) stays honest because both
sides read `specChildren`. `collectAttrNames` needs no change: a `param`
node names no attribute.

**On the GPU the variant lowers two ways, and the distinction is a
correctness one.** An integer literal is part of the spec text, hence
part of the kernel cache key, so it is baked: `pcg_hash2(params.seed,
3u)`. A `param` must NOT be baked. Two bindings of one param name produce
the same spec text and therefore the same kernel key while meaning
different numbers — baking the value would serve the second binding a
pipeline compiled for the first, which is cache poisoning rather than a
missed optimization. It takes a uniform const slot instead, exactly as
every other `param` does, read back as `u32(params.consts[s].x)` (exact
for the admitted range). `computeParamPlan` allocates it with no change
of its own, because it finds `param` nodes through `eachSpecNode`.

This half is separable and should be sequenced: **Phase A** is the
integer variant (no new spec-valued position, no walker edits, no GPU
slot); **Phase B** adds the param. The corpus needs Phase B only for the
rig's six.

## 4. Field-valued `opts.frequency` — REJECTED, because it already exists

Gap 3 asks for `opts.frequency` to hold a field spec too. It does, spelled
differently. The sample point is

```
p * frequency + offset              // noise/util.ts:327-331
```

so `{"frequency": F}` and `{"position": mul(<pos>, F), "frequency": 1}`
compute the same sample point, and `F` in the second form may be any
field — uniform, per-element, an attribute, a `param`. fbm included: its
per-octave `p * (frequency * lacunarity^o)` is `(p * F) * lacunarity^o`,
so scaling the position gives the identical octave chain. `offset` is
likewise `add(mul(pos, F), vec(ox, oy, oz))`. **The entire `opts`
transform is sugar over an expression the grammar already accepts in a
position it already accepts it in.**

One difference, stated because it is real and small: the position form
rounds the scaled coordinate to f32 before sampling (it passes through a
column), where a literal `frequency` keeps `p * frequency` in f64 into
the sampler. That is a sub-ULP difference in the sample point of exactly
the kind the noise parity budget already covers — and the GPU has always
rounded the position form's way, since `compileSamplePoint`
(`src/gpu/compile.ts:808`) emits `pos * freq + off` over f32 vars. So the
position form is, if anything, the more CPU/GPU-agreeable of the two.

The cost of this decision is one paragraph in `docs/authoring.md`. The
cost of the alternative is a second, redundant field-valued position in
every noise, in the parser, the spec deriver, the WGSL lowering and the
fbm octave chain, to express what one `mul` expresses today.

## 5. Why not a new `fn` — the tax, measured

Gap 3's own suggestion is `{"fn":"seedOffset","scale":900,"variant":N}`.
Rejected on two counts.

**It preserves every hazard it was meant to remove.** A seed OFFSET is
still a shift of the sample position, so it still needs an amplitude tied
to the frequency (`A ≈ 32 / f`, and the corpus' 15 distinct amplitudes
are the evidence that this cannot be defaulted), still risks an f32 that
no longer resolves a lattice cell at high frequency, still computes a
float from a hash, and still needs `W0` if adoption is to be neutral.
Compressing 32 spec nodes into one node does not make the construction
sound; it makes an unsound construction shorter.

**And a new `fn` is the most expensive shape available.** From the
registry survey:

- `src/gpu/compile.test.ts:239` asserts
  `supportedGpuFieldFns()` equals `listFieldFns()`, so **a new fn is
  required to lower to WGSL** — no CPU-only fns exist by construction.
- TWO minimal-spec corpora must gain an entry and both are pinned against
  `listFieldFns()`: `src/gpu/parity.testsupport.ts:77` and a duplicate
  inside `compile.test.ts:242`.
- Four count claims sourced from `listFieldFns().length` in
  `src/docs/site.ts:314-394`, plus the verbatim closed-set block at
  `docs/manual.html:908-914` that `extractFieldFnList` diffs against the
  live registry.
- `src/fields/fieldJson.test.ts` (advertised names, PER_ELEMENT
  classification), `src/fields/fold.test.ts` (UNIFORM_CASES),
  `src/fields/spec.test.ts` (round-trip CASES),
  `src/publicSurface.test.ts` (ROOT_SURFACE).
- Unchecked and already drifting: `docs/authoring.md:347` says "all 45
  names" and `llms.txt:297` says "All 45 fns" while the live registry is
  46.

**Extending `opts.seed` costs none of that.** `listFieldFns()` does not
move, so no count claim, no closed-set block, no MINIMAL_SPECS entry, no
new handler, no classification row. The grammar's fn set is exactly what
it was; one option position widened.

## 6. Gap 4: the calibration constant, and the part that cannot be built

Gap 4 wants a "zero-centred `nodeSeedOffset` needing no calibration",
where zero-centred means: adopting it in a saved graph leaves that
graph's output bit-identical at its own default seed, and only the seed
box gains an effect.

**That is impossible, and the impossibility is one line.** Any
`f(graphSeed, nodeId, variant)` that is the identity at one particular
seed `s0` must be told `s0`; a function that is not told it cannot
distinguish `s0` from any other seed. So there are exactly two designs:
name the zero (`"zeroAt": 40100` in the spec, which is a calibration
constant with better ergonomics — the author copies the graph's own seed
instead of running a script), or drop the requirement.

**Decision: drop the requirement, and state plainly what that means.**
Adopting `{"from":"node","variant":N}` in a saved noise RE-ROLLS that
noise. Its frequency, amplitude, position and normalization are
untouched; the field is a different draw from the same family. At the
graph's default seed the output is not bit-identical and cannot be made
so.

Three things justify paying that:

1. **The property is already not being maintained.** 6 of 117 W0 literals
   are stale (above), so two corpus graphs are not seed-neutral today and
   no test can tell. A guarantee that decays silently is worth less than
   the arithmetic suggests.
2. **`zeroAt` buys neutrality once and costs it forever.** It is correct
   for exactly one (graph seed, node id) pair. Rename the node, change
   the graph's default seed, copy the node into another graph — all
   normal edits — and it is stale again, in the same undetectable way.
   The design would be shipping the defect whose bill is gap 4.
3. **The re-roll is a one-time cost per noise, at a moment the author
   chooses**, whereas the calibration is a cost per edit forever.

### What DOES close in gap 4

The complaint has three parts and this design answers two.

- *"Re-zeroing the fold needed a throwaway script emulating the library's
  staged f32 rounding."* **Closed.** There is nothing to re-zero: the
  form has no calibration constant. A rename re-rolls the shapes and the
  author accepts the new roll or renames back.
- *"Renaming a node silently changes its geometry."* **Not closed, and it
  cannot be closed here** — `nodeSeed` is `hash(graphSeed, nodeId)` and
  every `randomField` draw in the library has always moved when a node is
  renamed. What the seed-shift idiom did was widen the blast radius of a
  rename from "the scatters move" to "the shapes move too", and that
  stays true under this design. Which is the honest framing of the whole
  gap: **gap 4 is the interest on gap 3, and paying off the principal
  does not refund it.**
- *"Or `pcg` printing derived node seeds."* **Ship it, separately and
  now.** `DescribedNode.seed` already exists (`src/graph/graph.ts:163-172`)
  and `Graph.describe()` already computes it; `pcg validate` builds its
  node listing from that description and throws the field away
  (`src/cli/commands.ts:354`). Adding `seed` to the JSON entry and a
  column to the text listing is ~10 lines and one assertion, and it turns
  "my geometry changed and I don't know why" into a diff of two numbers.

### Considered: a node-level `seedKey`

`deriveNodeSeed(graphSeed, node.seedKey ?? id)` would decouple the seed
from the id outright, so a rename would be free. **Not recommended now.**
It adds a second identity to every node in the format to fix a hazard
that bites only during renames; two nodes sharing a key silently
correlate all their randomness, which is a worse and quieter failure than
the one it fixes; and it is adopted graph-wide or not at all, since a
half-pinned graph re-rolls half its nodes on a rename. Printing the
seeds covers the same ground at a fraction of the surface. Recorded here
so the next person does not re-derive it.

## 7. Parity: exactly which forms are safe

Stated as a rule the implementation and the docs can both cite.

**Safe — u32-exact, no budget:** any chain of `hashMix` /
`hashFinalize` / `hashSeed` over integers, i.e. `hashCombine` and its
fixed-arity twins. WGSL u32 arithmetic wraps by specification and
`src/gpu/wgslLib.ts` serializes the SAME murmur constants
`src/random/hash.ts` exports, so both sides run identical integer
programs. Integer inputs to that chain are safe when they are exactly
representable wherever they are stored — which is why `variant` is capped
at 2^24 (an f32 uniform slot) and why `ctx.seed` reaches the kernel as a
u32 uniform rather than through a column.

**Not safe — and this is what the current idiom navigates by hand:** any
float arithmetic that lands in a seed. `add`/`sub`/`mul`/`floor` are
bit-exact on both paths, so the existing fold is correct — but only
because the whitelist is obeyed, and only because the amplitude is
bounded so the shifted position still resolves a lattice cell in f32.
`div` is within a range-ULP; `sin` is far worse; a one-ULP disagreement
INSIDE a `floor` moves a whole unit. The new form deletes this entire
category from the seed path: there is no float in it.

**Unchanged:** the noise interiors, whose published per-family tolerances
this design does not touch. A re-seeded noise is measured by the same
parity cases as any other noise.

## 8. Deferred resolution: keys, memos and caches

`makeNoiseField` currently derives `hash2(kindSalt, seed)` at
construction and captures the sampler in a closure. With a seed ref it
must resolve at evaluation, because `ctx.seed` does not exist before
then. Four things to get right, each with an existing precedent:

**Sampler construction moves inside the evaluate closure**, memoized on
the last resolved u32 (`if (s !== lastSeed) { lastSampler =
makeSampler(s); lastSeed = s; }`). A sampler is a closure over a number
in all four bases, so this is one allocation per distinct seed per field
— nothing next to a per-element sample loop.

**`Field.key` names the REF, not the value**: `perlin(n3,0.045,…)` where
today it is `perlin(305419896,0.045,…)`. The `n` prefix makes a ref
unforgeable by a literal seed. This is the same shape `nodeSeed()`
already has and its doc block already defends: the key is fixed at
construction while the seed arrives at evaluation. It is sound because
`evaluateField` memoizes per `EvalContext` OBJECT
(`src/fields/types.ts:108-147`) — one context is one seed — and because
the executor's node memo key carries the node seed verbatim (`|s${seed}|`),
so every node recooks when the graph seed moves whether or not its fields
mention the seed. Two noises on DIFFERENT nodes sharing a key never share
a context, so they never share a column.

**The fold needs no change and gets quieter.** A seed ref is not a spec,
so `isDomainConstant` never sees it and `rewrite` copies `opts` through
as it already does. What changes is that the workload `fold.ts` was
written for largely disappears: a migrated graph has no domain-constant
chains to fold, so it pays neither the ~12 extra passes per noise nor the
20-25 µs per subtree of a fold miss — and, notably, pays nothing in the
sub-1024-element streaming regime where the fold declines and the chains
run in full today. `fold.ts`'s module doc opens on the seed-shift idiom
and would need rewording; the machinery stays, because it is general.

**The kernel cache key stays sound, and improves.** The key is spec text
plus attribute descriptors. Today a noise's effective seed is baked as a
hex u32 literal (`compile.ts:828`), which is fine because the literal is
in the spec text. Under the new form the spec text carries
`{"from":"node","variant":N}` and the WGSL reads `params.seed` — so ONE
kernel serves every seed the graph is ever given, which is precisely the
argument `HANDLERS.set("nodeSeed", …)` already makes at
`compile.ts:518-536` against baking a value that moves on every drag of
the seed box. A param variant rides a const slot, so one kernel serves
every variant too.

**The fused / device-resident path admits it with no change.** Each
`KernelStep` already carries the per-node `seed` written into the uniform
at dispatch (`src/gpu/run.ts:228-232`), and `paramConstValues` fills
param slots from values stamped at plan time. Unlike `attributeIs`, this
needs no per-dispatch string table and no geometry, so a fused run
containing a node-seeded noise stays fused. That is worth stating
explicitly because gap 9 records the opposite outcome for string
variation: **this feature does not make a node CPU-only.**

WGSL needs one new library entry, `pcg_hash2`, built by the same
`hashChain(hashSeed(2), ["a","b"])` recipe as `pcg_hash3/4/5`. The noise
call becomes `pcg_value_noise(pcg_hash2(SALT, pcg_hash2(params.seed,
V)), sp)`; the fbm helper's `seeds` array holds expressions instead of
literals, which a `var` array constructor in a function body accepts.
The per-lane cost is a handful of integer ops against a noise sample.

**fbm's octave chain, internally.** CPU fbm builds one base field per
octave at construction with `seed: hashCombine(seed, o)`
(`src/noise/fbm.ts:64-70`). The internal ref therefore carries an
optional octave — `{from:"node", variant, octave?}`, resolving to
`hashCombine(hashCombine(ctx.seed, variant), o)` — which is not part of
the grammar (an fbm spec carries one `opts.seed`) and exists only so the
octave layers can be built the way they already are.

## 9. Where a node-derived seed is NOT continuous

Two regimes where this needs saying, both of which the current idiom
shares exactly:

**Per-cell graph seeds.** A `World` level may rotate the graph seed per
cell (`{ patches, seed: hashCombine(ctx.seed, salt) }`, or `setSeed` in a
bind). Where it does, every node's seed differs per cell, so a
node-derived noise seed is a DIFFERENT noise field in each cell and the
field is discontinuous at cell boundaries. The rule is one sentence: a
node-derived noise seed is continuous across cells exactly when the graph
seed is. Today's position-shift idiom has the same property (a per-cell
offset is a per-cell discontinuity) and the corpus does not exercise it,
which is why nobody has been bitten.

**`forEach` bodies.** Each iteration rotates the inner graph's seed, so
a node-derived seed re-rolls per iteration. `docs/authoring.md` currently
forbids the fold there ("Never fold `nodeSeed` inside a `forEach` body if
the default output must not move"); the rule changes in kind rather than
disappearing — the re-roll is usually WANTED (each group gets its own
noise) and there is no longer a neutrality claim to break, so it becomes
a documented behavior instead of a prohibition. The corpus' two unfolded
noise specs are exactly the two inside a `forEach`.

## 10. Migration

**Adoption is optional and old graphs are untouched.** An integer
`opts.seed` parses, cooks and lowers exactly as it does today; the
position-shift idiom is an ordinary expression and keeps working. No
`formatVersion` bump is required — a graph that does not use the new form
is byte-identical, and `tests/graphs.golden.json` does not move on the
library change alone.

**A corpus migration is a re-roll, and that is the decision to make.**
Migrating one noise deletes its ~32-node position fold and rewrites its
seed; the noise then draws differently at the graph's default seed. For
the 23 teaching graphs (`basics-*`, `pipeline-*`) the re-roll is
cosmetically irrelevant — they demonstrate a mechanism, not a
composition. For `examples-rig.json` and `examples-gpu-fields.json` it is
a look someone tuned by eye, and re-tuning is a real cost.

If it is taken, the cost is: 39 specs across 25 files edited;
`npm run graphs:golden` regenerated; `npm run capture` re-run and the
screenshots visually diffed (never byte-stable, per the capture notes);
`docs/authoring.md:421-559` — the ~140-line derivation of the idiom —
replaced by a much shorter section, with the old one kept only as a note
about what old graphs contain; `src/fields/inputs.ts:463-528` (the
`nodeSeed()` doc block) shortened to what `nodeSeed` is still for.
Roughly 1,300 spec nodes leave the corpus.

**Recommended: migrate the 23 teaching graphs in one pass, and leave the
rig and the GPU demo until someone is re-tuning them anyway.** The two
graphs with stale W0 constants are among the 23, so that pass also
retires the only known instances of the defect.

## 11. The sites to touch

Phase A — the integer variant:

1. `src/noise/util.ts` — `NoiseOpts["seed"]` widens to `number |
   NodeSeedRef`; `makeNoiseField` defers the sampler and keys on the ref;
   `noiseOptsSpec` validates and re-emits the ref (its current check is
   `Number.isInteger(opts.seed)`).
2. `src/noise/fbm.ts` — per-octave refs; `deriveFbmSpec`'s `seed`
   resolution (`fbm.ts:152-166`).
3. `src/fields/fieldJson.ts` — `parseNoiseOpts` (`:902-907`) admits the
   tagged object with its range rules and a message naming both legal
   forms; the module doc's spec-forms list (`:48-53`).
4. `src/gpu/compile.ts` — `NoiseOptsSpec["seed"]` (`:760`),
   `effectiveSeed` (`:812`) and its three call sites (`:828`, `:842`,
   `:898`), the fbm handler's `const seed` (`:873`). **Widening the TYPE
   is what makes `tsc` enumerate these**, which is the cheapest way to be
   sure none is missed — an unwidened site would silently read the tagged
   object as `0`.
5. `src/gpu/wgslLib.ts` — `pcg_hash2`.
6. Docs: `docs/authoring.md` (the idiom section, and the "`opts.seed`
   cannot hold a spec" claim it opens with), `src/fields/inputs.ts`'s
   `nodeSeed()` block, `llms.txt`'s grammar section, `README.md` if it
   names the idiom.

Phase B — the param variant:

7. `src/fields/spec.ts:495` `specChildren` yields `opts.seed.variant`.
8. `src/fields/fieldJson.ts` — build-time substitution at that position,
   `inlineParamMetaOf`/`inlineParamSchema` reachability so
   `describeGraphParams` reports the address.
9. `src/gpu/compile.ts` — the noise handlers read a slot instead of
   baking when the variant is a `param`.

Not touched, and worth listing because a reader will expect them:
`listFieldFns()`, `supportedGpuFieldFns()`, both MINIMAL_SPECS tables,
the docs count claims and closed-set block, `ParamPlan`'s attrIs half,
`run.ts`'s plan-time decline, `fold.ts:rewrite`, `collectAttrNames`.

Separately shippable, ~10 lines: `seed` in `pcg validate`'s node listing
and its `--json` (§6).

## 12. What must be tested

- **The derivation, from outside the library.** Recompute
  `hashCombine(deriveNodeSeed(graphSeed, id), variant)` in the test and
  assert the cooked column equals a noise built with that literal seed.
  That pins the contract an author reasons with.
- **Independence.** Variants 0/1/2 on one node are three uncorrelated
  fields (the same correlation test that justified `K ∈ {1021, 3067,
  8191}` — |r| ≈ 0.003 rather than 0.339).
- **Seed response.** Moving the graph seed changes a node-seeded noise;
  moving it does NOT change a literal-seeded one. The second half is what
  proves the test can tell.
- **CPU/GPU parity is EXACT**, not budgeted, for the seed derivation:
  same node, same variant, both paths, on a real adapter — including an
  fbm whose octave seeds are all derived, and a param variant read from a
  const slot.
- **The fused path stays fused** with a node-seeded noise in the run
  (contrast `attributeIs`, which declines) — assert the recorded reason
  is absent, not merely that the output matches.
- **One kernel, many seeds**: cooking at three graph seeds compiles ONE
  pipeline. This is the regression that a baked seed would cause and it
  is invisible in output comparisons.
- **Round trip**: `fieldToJson(fieldFromJson(spec))` returns the tagged
  form unchanged, with a param variant intact, and a graph reopens.
- Parse refusals with the message naming both legal forms: a float
  variant, a negative one, one above 2^24, an unknown `from`, a `from`
  with no `variant` (legal, defaults to 0 — assert it is legal), a
  non-`param` spec at `variant`.
- **The fold still declines to touch it**, and a `param` variant is
  reported by `describeGraphParams` at its address.
- **A migrated graph re-rolls and nothing else moves**: same point count,
  same topology, same everything except the noise column — which is the
  claim §10 makes and the one a reviewer will want evidence for.

## What this does NOT do

- **It does not make a saved graph's shapes seed-responsive without an
  edit.** Every noise still names its own seed; the new form is a
  different thing to write, not a new default. A graph gains a working
  seed box by being edited, exactly as today.
- **It does not make adoption output-neutral.** Adopting it re-rolls the
  noise. §6 proves no design can do otherwise without carrying the zero
  seed in the spec, and explains why carrying it is worse.
- **It does not stop a rename from changing geometry.** `nodeSeed` is
  still `hash(graphSeed, nodeId)`. It removes the calibration a rename
  used to invalidate, and (via `pcg validate`) makes the change visible.
- **It does not admit field-valued noise options in general.** `seed`
  admits one closed tagged form and integers; `frequency`, `offset`,
  `octaves`, `lacunarity`, `gain`, `output`, `exact` and `normalized`
  remain literals. `position` is, as before, the one field-valued option
  — and the one through which a per-element frequency is already
  expressible (§4).
- **It does not give a per-CELL re-roll.** `{"from":"cell"}` is left as
  an obvious future member of the discriminator and is deliberately not
  designed here; nothing pulls on it yet.
- **It does not touch the noise parity tolerances**, the string-attribute
  machinery, or `MAX_FIELD_CONST_SLOTS`. A param variant consumes one of
  the 16 slots like any other param, and that is the only budget it
  touches.
- **It does not deduplicate the rig's four `*Variant` knobs into one
  graph-scoped param.** That is gap 7 and it is a different mechanism.
