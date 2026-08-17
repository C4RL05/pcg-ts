# Fields ergonomics — making a field expression readable, reusable, and consistent

Written 2026-08-16 from external reviewer feedback. **Re-derived 2026-08-17
against HEAD `e178368`, 46 commits later.** Most of the original evidence
had expired: the defect it called "the single best-evidenced ergonomic
defect in the library" was fixed by other work three hours after this file
was committed, and the primitive it called "the single highest-leverage
item" had already been rejected by name in another plan.

The re-derivation is §2. What is still live is §5. The original numbers are
kept in §9 so the correction is auditable rather than quietly applied.

---

## 0. Read this first

Every number below is dated 2026-08-17 and comes with the command that
re-derives it. This file has been wrong once by being read a day late; run
the commands before acting on anything.

Two plans that overlapped this one have both landed:
`PLAN-by-attribute.md` (`a433e73`, `byAttribute`) and
`PLAN-filter-topology.md` (`a6905ed`, `topology: "keep"`). A third,
`PLAN-noise-seeds.md`, landed the work that killed §4.A2 here.

---

## 1. Where this came from

A reviewer said, in substance: *"I don't quite understand the idea of
fields being text instead of just being another node input."* They were
comparing against the wire-everything node model — the one where a socket
carries either a single value or a per-element function, field-ness is
shown by socket shape rather than declared by the node author, field-ness
propagates contagiously from input nodes that have no data input, and a
field is realized when it lands on a socket that has a domain.

Three things that model gives them, which this library does not:

1. **One vocabulary.** Arithmetic on a field is the same node you would
   use on a constant. There is no second op set to learn.
2. **Composition by wire, therefore reuse.** One expression chain fans out
   to many consumers. Here an expression lives inline in one param, so
   sharing it means copy-paste.
3. **Visibility.** The graph *is* the expression; nothing hides inside a
   param.

What does not transfer: that model was designed without a compute-kernel
compiler underneath it. Arbitrary nodes may appear mid-expression there
because nothing downstream must prove a run lowers to a fused kernel. Our
closed grammar is load-bearing (§6.1). Its implicit domain interpolation
is also a known source of confusion; our explicit promote/transfer is
arguably the better call and is not up for trade.

**Read the complaint as a legibility signal before an architecture
signal.** "I don't quite understand the idea" is a docs symptom. A
correction worth making regardless: in the TypeScript API, fields are not
text — they are `Field<T>` values built with combinators. The text is the
serialization. The reviewer met the serialization first.

**The re-derivation strengthens this reading.** Every *size* measurement
below came in smaller than the original plan assumed, and the one that
motivated the whole document had already gone to zero. The complaint was
about not understanding the model. It was never really about line count,
and this plan spent its first draft treating it as though it were.

---

## 2. Evidence, re-derived 2026-08-17

### 2.1 The worked example: EXPIRED

`graphs/basics-filter-by-expression.json`, node `keep`:

| measure | 2026-08-16 | 2026-08-17 |
| --- | --- | --- |
| whole node JSON | 207 | **44** |
| the `predicate` param | 201 | **38** |
| the vec3 seed offset inside it | 161 | **0** |

```sh
node -e "const g=require('./graphs/basics-filter-by-expression.json');
const n=g.nodes.find(x=>x.id==='keep');
console.log(JSON.stringify(n,null,2).split('\n').length,
            JSON.stringify(n.params.predicate,null,2).split('\n').length);"
```

Commit `8faf95d` converted the whole corpus onto the tagged seed form
`"seed": {"from": "node", "variant": N}` — 39 folds across 25 files, ~1270
spec nodes deleted. The idiom now appears in **zero** graphs; it survives
only as four labelled fixtures in `tests/foldCorpus.test.ts:156-232`.

**The claim "it is the single best-evidenced ergonomic defect in the
library" is retired, not weakened.** So is unit 3 (corpus rewrite): done.

Note `8faf95d` deliberately abandoned §6 invariant 4 (bit-identity at the
authored seed), on the grounds that of 117 `W0` literals six were already
wrong and two graphs shared a triple correct for neither. The look changed
and the committed screenshots caught up in `22b07d5`. That invariant is
struck below.

### 2.2 Grammar contents: 50 fns, and the gap has no corpus demand

`3b58a31` added `cross`, `pow`, `sqrt` and `step`. `cross` had a measured
site — a nine-nested-object hand-rolled perpendicular in
`graphs/examples-riverbank.json` — and now reads as one call.

Still absent: `fract mod smoothstep exp log sign distance`.

**Measured demand for those, in the corpus: zero.**

```sh
# fract idiom sub(x, floor(x)): 0 hits.  distance idiom length(sub(a,b)): 0 hits.
# All 20 surviving `floor` uses are integer binning — floor(index/2), floor(u*7).
```

Each remaining fn is still one WGSL builtin plus a CPU implementation plus
parse/emit plus a parity test — and, per `3b58a31`, a real device probe,
because three of four assumptions about parity were overturned by
measurement there. That is a non-trivial cost against zero demand.
`mod` additionally forces a semantic choice (truncated vs floored
remainder) that must then be documented forever.

**Downgraded from "first by a wide margin" to speculative completeness.**

### 2.3 Field-capability was a whitelist with no stated rule — NOW STATED

**20 of 180 params, across 12 of 46 nodes**, when this was re-derived on
2026-08-17: the only §2 measurement that had not shrunk. The rule is
written down now (`a3d3b94`) and the count is **21 of 180**, because
stating it exposed one param that belonged on the other side.

```sh
node -e "const n=require('./docs/nodes.json');let t=0,f=0;
for(const x of n){const p=Object.entries(x.params||{});t+=p.length;
f+=p.filter(([,s])=>s.acceptsField===true).length;}
console.log(f,'of',t,'params across',n.length,'nodes');"
```

Full classification: `scratchpad/coverage-audit.md`. Against C2's own
wording (numeric and vector params only — 83 of 180):

| bucket | count (as audited, 2026-08-17) |
| --- | --- |
| already field-capable | 20 — now 44, C2 swept |
| **CANDIDATE — the real cost of C2** | **24 as audited; 27 by the rule, 23 done, 4 refused** |
| structural, correctly refused | 38 |
| unclear | 1 (`valueConstant.value`, see §2.4) |

So C2 is **24 params, not 160.** Spot-checking 12 of them against the
node sources: 5 easy (already read inside the per-element loop), 5 medium
(read once into a hoisted scalar that must be dissolved — e.g.
`attributeRemap.inMin/inMax`, `filterByBounds.boundsMin/Max`), and 2 the
audit called hard for a reason that did not survive reading the source.

**The stated rule was not merely unwritten — it was wrong.** The rule that
shipped is in `docs/authoring.md`, derived clause by clause from what the
registry actually does. Two corrections to what this section said before
that derivation:

1. *"`connectPoints.radius` and `pointNeighborhood.radius` both size and
   cache-key the uniform grid via `adjacencyFor()`."* **False.** Cell size
   is deliberately EXCLUDED from the adjacency cache key, because it only
   changes how many cells a query touches and never the answer
   (`src/spatial/adjacency.ts:110-113`). `selfPrune` resolves its field to
   a column FIRST and derives cell size from the largest resolved claim
   (`src/nodes/filtering.ts:1223-1237`), so a mismatch is slow, never
   wrong.
2. *"What makes a fielded radius expensive is that the partitioned cook's
   halo width becomes a global bound the author has to supply."* **Half
   true.** The author-supplied halo is real and documented on the param
   (`src/nodes/filtering.ts:1122`), but nothing in `src/runtime/` reads a
   node's radius to size a halo — it is author code inside `bind`.

The real boundary is **relational symmetry**, and it splits the two params
the audit had lumped together: a per-point radius would make "A is near B"
disagree with "B is near A" (`src/nodes/topology.ts:101`), so
`connectPoints.radius` genuinely cannot be a field, while a per-POINT
query carries no such obligation — which is why `selfPrune.minDistance`
already is one, symmetrising with max(rA, rB). That left
**`pointNeighborhood.radius` as an unexplained gap**: per-point,
grid-local, symmetry-free, and eager for no reason stated anywhere in the
source. IT IS A FIELD NOW — the one param the rule disagreed with the
library about, and the disagreement was the library's. That is the return
on writing the rule down: a rule that only described what was already
there would have been a summary, and this one predicted a gap that turned
out to be real. Field-capable params are 21 of 180.

The one counterexample that did hold: eight `u32` **seed** params allocate
nothing and are not structural, yet must stay eager, being hash-combined
into the node seed before any element exists. Part of the rule is already
executable — `src/graph/params.ts:302-331` hard-refuses `acceptsField` on
list and items types — and three clauses of it are now pinned by
`src/nodes/fieldCapability.test.ts`.

The sharpest symptom is still documented in the corpus.
`graphs/basics-field-params.json` explains that `frequency` is multiplied
into the sample position rather than passed as `opts.frequency`, "because
that option is read as a plain number and cannot hold a spec."

That quote is scoped to ONE option, and the 2026-08-17 draft of this
section paraphrased it as "the noise options" — a blanket claim the graph
never made, and one that is now false. `opts.position` takes a full field
spec, and `opts.seed` takes the tagged `{"from": "node", "variant": N}`
form whose `variant` accepts an inline `param`. `frequency` and `offset`
are the ones that genuinely take plain numbers, and `frequency`'s reason
is EQUIVALENCE rather than impossibility: scaling the position computes
the same point, so a field-valued frequency already exists
(`src/fields/fieldJson.ts:1658-1668`). The blanket version of the claim
had spread to six places in the library and is corrected there.

### 2.4 There is no field wire — UNCHANGED

```ts
// src/graph/node.ts:5
export type PinKind = "geometry" | "value" | "instances" | "any";
```

No `field` kind. A field never travels on a wire and no node emits one.
The reviewer's description is literally accurate.

The curiosity holds: `valueConstant.out` is the only `value` pin in the
catalog and **no node declares a `value` input.** A wire type with no
consumer, pointing at the model the reviewer expected.

### 2.5 NEW — how big field expressions actually are

149 top-level field-spec params across the corpus, 4714 serialized lines.

| measure | value |
| --- | --- |
| mean lines | 31.6 |
| **median lines** | **19** |
| median nesting depth | 3 |
| p90 depth | 5 |
| over 80 lines | 12 specs |
| deeper than 5 | 14 of 149 |
| largest | 296 lines, depth 8 (`examples-gpu-fields.json color.value`) |

This is the measurement the original plan never took, and it reframes
problem B. The typical field expression is 19 lines and three deep — not
pleasant JSON, but not the catastrophe a 201-line predicate implied. The
tail is real and concentrated: 12 specs carry the pain.

### 2.6 NEW — repetition, split into the two kinds

**Within one expression (this is A3's demand).** Counting repeated
subtrees, but *only those worth binding* — a repeated
`{"fn":"constant","value":2}` is already minimal and sharing it saves
nothing:

| repeated subtree size | occurrences |
| --- | --- |
| 1 fn-node (leaf) | 138 — sharing saves nothing |
| 2 fn-nodes | 14 — marginal |
| **3+ fn-nodes** | **45 — worth binding** |

**11 of 149 specs** contain a 3+ repeat. The worst: a 70-line `clamp`
written three times inside `examples-gpu-fields.json color.value`, and a
55-line `add` twice inside `examples-rig.json partMount.translate`. Six of
the top eight are in `examples-rig.json`.

A first cut of this measurement said 197 repeats and 22%. That counted
leaves, and counted nested repeats twice. **The number is 45, in 11
files' worth of specs.** Real, narrow, and concentrated in two graphs.

**Across nodes in one file (this is D's demand).** 712 redundant lines,
15% of the corpus's field-spec text — and **447 of those 712 are one
group**:

```
447 redundant  4x 149L  examples-rig.json  trussMove1/3/5/7.translate
 35 redundant  2x  35L  pipeline-*.json    cellMask.predicate, seedMask.predicate  (x7 files)
```

The truss group is worth stating precisely, because it is now the best
single piece of evidence in this document. Four `transformPoints.translate`
expressions, 149 lines each, depth 9, 33 fn-nodes — **structurally
identical, differing in exactly 4 of 12 literals.** All four differing
literals are ±√2/2, spelled four different ways:

```
0.7071067811865476 | -0.7071067811865475 | -0.7071067811865477 | 0.7071067811865474
```

Three distinct roundings of one constant, in expressions that are
otherwise the same expression. `trussMove0/2/4/6` are 33/39/45/39 lines
and share nothing — so this is four of eight, not a symmetric pattern.

Cross-file repetition (1772 lines) is **excluded as a defect**: the
`pipeline-1..5` graphs are a deliberately incremental tutorial series, and
each stage repeating the last plus one change is the point of the series.

Note what A3 would *not* fix here: these are four different nodes. Naming
a subexpression within one expression does nothing for them. Graph-scoped
params (`9888815`) already share a *value* across nodes — `trussHalfWidth`
is read as a `param` inside these very expressions — but there is no way
to share an *expression*. That is the one thing only D3 buys.

---

## 3. The four problems, re-scored

| # | problem | evidence 2026-08-16 | evidence 2026-08-17 | verdict |
| --- | --- | --- | --- | --- |
| A | grammar missing primitives | 161 of 201 lines | 4 shipped; 0 corpus demand for the rest | **mostly closed** |
| B | JSON is a hostile concrete syntax | unreadable | median 19 lines, depth 3; 12 bad specs | **reduced** |
| C | field-capability is an unstated whitelist | 19 of 166 | 20 of 180, rule has 2 counterexamples | **unchanged — now the strongest** |
| D | expressions invisible and unshareable | copy-paste, unquantified | 447 redundant lines in one 4-way group | **strengthened** |

The original ordering ("A is first by a wide margin") has inverted.

---

## 4. Options

Struck items are retired with the reason; live items keep their original
letters so cross-references from other plans still resolve.

### A. Grammar completeness

**A1 — the remaining math primitives** (`fract mod smoothstep exp log sign
distance`). Live but unmotivated: zero corpus demand (§2.2), real cost per
fn (CPU + WGSL + parity test + device probe + catalog prose + permanent
surface). **Do these when a graph wants one, not before.** `cross` is the
model: it shipped because a real site open-coded it nine objects deep.

**~~A2 — a `seedOffset` primitive.~~ DEAD.** Rejected by name in
`PLAN-noise-seeds.md:281` ("Gap 3's own suggestion is
`{"fn":"seedOffset","scale":900,"variant":N}`. Rejected on two counts"),
and the underlying problem was solved without a new fn by the tagged seed
form `{"from":"node","variant":N}` (`9888815`, `src/fields/fieldJson.ts`
:1468, :1557-1570). **~~Unit 3, the corpus rewrite~~: done by `8faf95d`.**

**A3 — subexpression binding.** Live, demand now measured at 45 bindable
repeats in 11 specs (§2.6). Still true that **automatic CSE does not solve
this** — fields already carry content-addressed keys (`8e10d5e`) and
invariant subtrees are hoisted at evaluation (`1a09b60`); the complaint is
serialized size, which needs a binding form in the grammar. But 11 specs,
six of them in one graph, is a thin mandate for a format change.

**~~A4 — the N-way case form.~~ SHIPPED** as `byAttribute` (`a433e73`).

### B. Concrete syntax

**B2 — a parsed text syntax.** `length(P) < 20 && valueNoise(P * 0.06) > 0.4`.
A string accepted anywhere a spec node is; `src/fields/fieldJson.ts` gains
a parser and a printer; the tree stays canonical so programmatic edits
still work.

The size argument for this is weaker than the plan assumed (§2.5). The
**agent-ergonomics** argument is not, and it now has direct evidence:
`graphs/examples-riverbank.json` was authored by an agent given only the
CLI catalogs, and it hand-rolled a perpendicular nine nested objects deep
because it could not see that a single call would do. Models emit infix
expressions far more reliably than nested JSON, and agent ergonomics is
one of the four design pillars.

Blocked on decision §7.1.

**~~B3 — text only, drop the tree.~~** Rejected: turns programmatic edits
into string surgery.

### C. Coverage consistency

**C1 — write the rule down, audit the gaps.** Cheapest live item. Must now
state the two counterexamples in §2.3, not just the allocation clause —
a rule with unstated exceptions is how this whitelist got here. Fixes the
noise-opts edge.

**C2 — flip the default. SHIPPED.** Field-capable params went from 20 of
180 to **44 of 180, across 25 node types**: 23 implemented, 4 refused —
`splineSample.spacing` and `volumeSample`'s `cellSize` and bounds, every
one of them on the allocation clause.

THE SYMMETRY CLAUSE NOW REFUSES NOTHING. It was written to exclude
`connectPoints.radius`, on the ground that a per-point radius makes an
edge depend on which endpoint asked. That was wrong twice: `selfPrune`
was already fielding a per-point radius and symmetrising on the larger of
the two, and `connectPoints` has now adopted the same rule. What survives
is a REQUIREMENT — a relation fielded without a stated pair rule really
does depend on which endpoint asked — and the costs turned out ordinary:
the candidate scan runs at the widest resolved radius, and the documented
partition halo becomes the field's global maximum rather than `radius`.

The audit's "24 candidates" was an estimate; applying the written rule to
the registry gave **27**. The sizing was also wrong in the other
direction — this was called "closer to a month than a week" and it was a
day, because the rule turned a judgement call per param into a lookup,
which is the whole argument for having written it down first.

THE SWEEP FALSIFIED THE RULE'S OWN CLAUSE 4, which had read "nothing that
decides how many elements come out". `pathResample.spacing` decides
exactly that and is field-capable anyway, because that node resamples
each polyline on its own arc length — the field resolves per PRIMITIVE,
one spacing per path. `splineSample.spacing` is the same word in the same
units and cannot be one, because that node concatenates every polyline
into a single curve. The clause is now "nothing read ONCE to size a
single allocation": the question is never what the param decides, it is
whether an element exists to read it per. `volumeSample` shows both
halves inside one node — `jitter` is a field, `cellSize` cannot be.

The non-mechanical part was as predicted: each newly-fielded param
converts an eager refusal into a stated per-element policy. A zero
extrusion vector now refuses THAT primitive by index rather than the
cook; a zero ray direction MISSES that point and is counted by
`hitAttr`; `attributeRemap`'s window ends are not evaluated at all under
`mode: "fit"`, which the description now says.

### D. Visibility and reuse

**D1 — render the field tree as a node diagram in the sandbox,
read-only.** Costed. Today a field param is a raw JSON `<textarea rows=7>`
in `sandbox/FieldParam.svelte:131`, and on the canvas it collapses to one
row reading `ƒ mul` (`sandbox/model.ts:82-92`). `1154bd7` added knobs over
inline `param` values, not a viewer.

`sandbox/autoLayout.ts:478` is **hard-wired** to `NodeView`/`EdgeView`
(`nodeHeight` at :509, `slot.node.inputs/outputs` at :520-525, fixed
`NODE_W` at :575). But a spec tree is a DAG, so the cheap path is a
spec→`{nodes, edges}` adapter minting synthetic ids rather than a second
layout engine.

Reuses `getFieldSpec`/`fieldToJson`, `listFieldFnInfos()` for labels and
arg names, `inlineParamValuesOf`/`inlineParamMetaOf` for leaves. Needs: a
public child accessor (`specChildren` exists at `src/fields/spec.ts:501`
but is `@internal` and absent from `src/publicSurface.test.ts`), the
adapter, a read-only SVG component (`Canvas.svelte`/`NodeBox.svelte` carry
drag/connect gestures a viewer does not want), and a mount point in
`FieldParam.svelte`.

**D3 — a real `field` pin kind.** The naive version destroys the fusion
guarantee (§6.1). The workable version is a **restricted sub-registry**:
pure grammar ops get a `field` output pin, wires between them are inlined
into a spec tree before cooking, eligibility is unaffected because the
sub-registry is still closed.

§2.6 is the argument that promotes it: the truss group is 447 redundant
lines that **nothing else on this list can remove**. Graph-scoped params
share a value across nodes; A3 shares a subexpression within one
expression; only D3 shares an expression across nodes. Still expensive
(two authoring surfaces, an inlining pass, sandbox work) and still gated
on decision §7.4.

### E. Framing

**E1.** Lead the docs with the TypeScript and text forms rather than the
graph JSON. The reviewer's entire impression formed from an artifact that
has no analogue in the system they were comparing against.

**This is now the item that most directly answers the complaint that
started the file**, and §2 is why: every size defect the plan proposed to
fix has shrunk or gone, and the reviewer's sentence was about not
understanding the model, not about line count.

---

## 5. What is actually live

| unit | scope | cost | blocked on |
| --- | --- | --- | --- |
| ~~E1~~ | docs framing — lead with `Field<T>`, not the JSON | — | **SHIPPED** `a3d3b94` |
| ~~C1~~ | state the capability rule | — | **SHIPPED** `a3d3b94` |
| ~~D1~~ | sandbox read-only field-tree view | — | **SHIPPED** `5bb3301` |
| ~~C2~~ | flip the default over the candidate params | — | **SHIPPED** — 23 done, 4 refused by rule |
| ~~B2~~ | text syntax — parse + print, tree stays the format | — | **SHIPPED** |
| A3 | subexpression binding | medium | thin mandate — 11 specs |
| D3 | `field` pin kind over a restricted sub-registry | large | §7.4 |
| A1 | remaining math primitives | small each | no demand — wait for a site |

Retired: A2, A4, B3, unit 3.

**E1 and C1 shipped in `a3d3b94`.** The rule is in `docs/authoring.md`
("Which params accept one") and `llms.txt`, with three of its five clauses
pinned against the live registry by `src/nodes/fieldCapability.test.ts` —
each proven able to fail by perturbation rather than merely observed
green. The framing now opens both field sections on the value rather than
the syntax, which is what the reviewer's sentence actually asked for.

Two things changed in the doing, and both are recorded above rather than
here: the rule's fifth clause turned out to be RELATIONAL SYMMETRY and not
grid sizing (§2.3), which unblocked C2; and auditing the gaps turned up
seven false claims about what a noise's `opts` can hold, two of them
shipped in primitive descriptions.

**D1 shipped in `5bb3301`**, and it was the best of the larger items for
the reason it was picked: the only one that makes an expression legible
without changing the format, and it cannot be wrong, because a read-only
view has no correctness stake. It cost the library one export —
`specChildEntries`, the labelled form of the walk `specChildren` already
did — rather than the sandbox duplicating the grammar's five child
positions, which is what the plan's own D1 note had left open.

Worth recording, because it argues for another entry on this list: the
diagram makes the THREE IDENTICAL channel chains inside
`examples-gpu-fields`' `color.value` obvious at a glance — the repetition
§2.6 had to count subtrees to find. A view that surfaces the evidence for
A3 by being looked at is doing more than legibility.

**B2 shipped**, and the corpus survey that preceded it corrected the
design twice before a line was written: only NINE fns carry keys beyond
`args`, so object and array literals cover the whole grammar and no
bespoke sugar was needed for the tagged seed; and `constant(3)` had to
stay distinct from a bare `3`, because the corpus holds both spellings —
230 raw numbers in `args` against 105 explicit `constant` nodes — and
they are different TREES. Collapsing them would have made the round trip
rewrite one into the other, silently.

**Recommendation from here: stop.** The three remaining units are waiting
on evidence rather than on a decision — A3 on a thin mandate (45 bindable
repeats in 11 of 149 specs), D3 on §7.4, A1 on any site at all wanting
one of the seven remaining math primitives. None should be started
without one of those changing.

The obvious FOLLOW-ON, deliberately not done here: the sandbox still
shows a JSON textarea. `printFieldSpec` is what it should show, beside
the D1 diagram — that is a `sandbox/` change with no library risk, and it
is where B2's value actually reaches a reader.

### Verification per unit

```sh
env -u NODE_ENV npm test        # NODE_ENV=production causes a false failure
npm run build && npm run check  # check needs a current dist/
npm run docs                    # CI fails if catalogs are stale
npm run graphs:golden           # only for units that change graph output
```

A unit is complete only when its tests are green and, for anything
non-mechanical, an independent agent has re-derived correctness. C2, B2
and D3 qualify; E1 and C1 do not.

---

## 6. Invariants that constrain every option

1. **The grammar stays closed.** It is closed so a run's GPU eligibility
   is decidable and a fused kernel is provable, with a machine-readable
   reason on fallback. Any design that lets an arbitrary registry node
   appear mid-expression breaks this. This is the reason the library does
   not simply adopt the model the reviewer described.
2. **Determinism.** All randomness flows from seeds through PCG32 and
   hash-combining. Same seed, identical output across runs, platforms and
   cook orders.
3. **CPU is the reference, GPU is a documented approximation.** Any new
   primitive needs both paths plus a parity test, within the published
   per-family tolerances — and a real device probe, not a reading of the
   spec. `3b58a31` overturned three of four assumptions that way.
4. **~~Bit-identical folding for A2.~~** Struck. `8faf95d` chose to change
   the look, on the ground that no function of (graphSeed, nodeId,
   variant) can be the identity at a seed nobody names, and that six of
   the 117 `W0` literals were wrong anyway.
5. **Derived files are regenerated, never hand-merged.** `docs/nodes.json`,
   `docs/graphs.json` and the graphs golden file conflict on any parallel
   branch; the resolution is always to re-run the generator.
6. **Pre-alpha: format breaks are acceptable.** A `formatVersion` bump and
   broken pinned refs are fine. Never compromise a design to avoid one.
7. **Error messages are API.** Name the offending node, pin or param and
   state the fix. This applies with force to a new parser (B2).

---

## 7. Open decisions — need the user

1. **~~Does authored text round-trip verbatim, or normalize to the tree on
   save?~~ DECIDED 2026-08-17: NORMALIZE.** Text is an INTERMEDIATE
   format. The tree stays the format; text is a bidirectional view over
   it. Nothing is ever saved as text, and no comments are expected in the
   syntax.

   The question dissolves once framed that way, and one fact decides it
   rather than a preference: **every write path in this library already
   edits the tree.** `withInlineParamValue(spec: FieldSpec, …): FieldSpec`
   is tree-in tree-out, and its callers are `src/runtime/world.ts`,
   `src/runtime/patches.ts`, `src/worker/host.ts` and the sandbox's knobs;
   `applyParamPatches` is the same shape, as is everything the
   agent-ergonomics pillar rests on. So storing the string as the authored
   form would advertise a guarantee the library breaks on first contact —
   one World patch, one knob turn, one `pcg` param patch and the text has
   to be re-printed anyway. It would preserve verbatim text only for
   graphs nothing ever edits, which under a patch-driven streaming runtime
   is close to none of them.

   WHAT IT COSTS is the author's specific spelling — redundant parens,
   `sub(1, p)` printed back as `1 - p` — which is what every formatter
   costs and what authors accept from them. The original worry, that "the
   first sandbox save silently destroys what someone wrote", was really
   about a save that hands back raw JSON; with a canonical printer it
   becomes "reformats what you wrote", and JSON is never shown again.

   NO COMMENTS, decided with it, which is what keeps this cheap: comments
   would have to live in the TREE as data to survive a programmatic edit
   (the way `param`'s `description` already does), and that is a grammar
   addition this does not need. The closed grammar stays as it is.

   `&&` AND `||` ARE INPUT-ONLY SUGAR, decided 2026-08-17 with the above.
   The grammar has no boolean type — comparisons yield 1 and 0, and
   `filterByExpression`'s own description already says that combining them
   with `mul` acts as AND and `max` as OR. So the parser accepts `&&`/`||`
   as sugar over exactly those two fns, and THE PRINTER NEVER EMITS THEM:
   a `mul` prints as `*` whether or not its operands happen to be
   predicates. That asymmetry is the point. `a && b` on values outside
   {0, 1} silently multiplies, and printing `&&` back for an arbitrary
   `mul` would put that trap in front of a reader who never typed it.

   THE GATE, and it is not optional — `src/fields/spec.test.ts` already
   holds the library's standard for two descriptions of one computation
   ("any disagreement between them is a silent numeric divergence with no
   error anywhere"), and it pays for it with a per-constructor proof.
   Text's equivalent is cheap and must exist before the parser ships:
   `parse(print(spec)) ≡ spec` over all 149 corpus specs, and
   `print(parse(text))` idempotent.
2. **~~C1 or C2?~~ CLOSED — both shipped.** C1 wrote the rule down
   (`a3d3b94`), and C2 swept it over the library: 43 of 180 params are
   field-capable now, 22 added and 5 refused by the rule. Writing the
   rule first is what made the sweep a day's work instead of a month's,
   and the sweep is what corrected the rule (clause 4, above). Neither
   half would have been right alone.
3. **~~Is unit 3 (corpus rewrite) in scope?~~** Moot — done by `8faf95d`.
4. **Is D3 ever wanted?** §2.6 gives it a real number (447 lines nothing
   else can remove) but that number is one graph. This decides whether
   cross-node expression reuse is a goal.

---

## 8. What not to do

- **Do not adopt the wire-everything model wholesale.** It costs the
  fusion guarantee and puts scheduler, cache and invalidation machinery on
  individual multiplies. The node graph is the outer dataflow; the field
  grammar is the inner loop. That split is correct.
- **Do not reach for compile-time CSE to fix duplication.** Wrong layer;
  see A3.
- **Do not add a grammar fn without a site that wants it.** §2.2 is the
  standing reason: the surface is permanent, the parity work is real, and
  four of the ten originally listed shipped precisely because one of them
  had a measured site.
- **Do not name specific third-party engine or DCC products** in any file
  or commit message in this repository. Describe the mechanism instead —
  as §1 does.
- **Do not trust a number in this file that is more than a day old.**
  §9 is what happened last time.

---

## 9. What the 2026-08-16 draft got wrong

Kept so the correction is auditable, and because the failure mode is
general: a plan is a measurement with a timestamp, and this repository
moves faster than a plan's shelf life.

| claim | status |
| --- | --- |
| node `keep` is 207/201/161 lines | 44/38/0 — `8faf95d` |
| the seed idiom is "the single best-evidenced ergonomic defect" | it appears in zero graphs |
| A2 `seedOffset` is "the single highest-leverage item" | rejected by name in `PLAN-noise-seeds.md:281` |
| unit 3, rewrite the corpus onto it | already done |
| §6 invariant 4, bit-identity, is binding | deliberately abandoned |
| C2 means flipping 166 params | 24 are real candidates |
| C2's rule: "cannot be a field if it determines allocation or structure" | two counterexamples (§2.3) |
| A4 likely already landed | it had — `a433e73` |
| 19 of 166 params, 46 nodes | 20 of 180, 46 nodes |

Three measurements taken *during* this re-derivation were also wrong
before they were checked, and are recorded because the checking is the
method: field-spec duplication first came out as 38% of all lines (it
counted a deliberate tutorial series as duplication — 15% within-file is
the real figure); intra-spec repetition first came out as 1392 redundant
lines (nested repeats double-counted, giving 468 redundant lines inside a
296-line spec, which is impossible); and the corrected 197-repeat figure
still counted 138 leaf repeats where sharing saves nothing. **45 is the
number.**
