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

### Field-expression reuse: A3 and D3, 2026-08-17

From `PLAN-fields-ergonomics.md`, which is otherwise closed — E1, C1, D1,
C2 and B2 all shipped today. These two did not, and they are here rather
than there because this file is where what is still ahead lives.

**A3 — naming a subexpression inside ONE expression.** A repeated
sub-formula is written out in full at every occurrence; nothing lets you
bind it. Not a performance problem — invariant subtrees are already
hoisted at evaluation and fields carry content-addressed keys — purely
what an author types and reads. The worked case is
`examples-gpu-fields`' `color.value`: three colour channels, each
`ramp(CORE, differentStops)`, where CORE is an identical 340-character
terrain formula written three times. `let h = …` says the thing the
original only implies — one height, three ways of colouring it.

**D3 — a `field` pin kind over a RESTRICTED sub-registry.** Grammar ops
get output pins, wires between them are inlined into one spec tree before
cooking, and eligibility is unaffected because the sub-registry stays
closed. The naive version — any node emits a field — forfeits the fusion
guarantee and is not on the table. The worked case is `examples-rig`'s
four `trussMove*.translate`: 149 lines and 33 operations each,
structurally identical, differing in four of twelve numbers that are all
+/-sqrt(2)/2 in three different roundings. 447 redundant lines, 63% of all
within-file duplication in the corpus, and **the only rung nothing else
reaches**: graph params share a VALUE across nodes, A3 shares a
subexpression WITHIN one expression, and only D3 shares an expression
ACROSS nodes.

**READ THE CORPUS RATE AS A FLOOR, NOT A VERDICT.** The first survey
reported "45 bindable repeats in 11 of 149 specs" and called the mandate
thin. That denominator is wrong and will keep being wrong: the corpus is
roughly 140 `basics-*` graphs that are deliberately one node doing one
thing — a single-concept demo CANNOT exhibit subexpression reuse — plus a
handful of real ones. Divide by them and you manufacture a thin mandate
out of an unrepresentative population. Where the demand actually sits is
the tell: six of the eight worst A3 cases are in `examples-rig` and the
single worst is in `examples-gpu-fields`, which are the two most complex
graphs. Demand tracks COMPLEXITY, and this file already documents that
pattern under its own headings — the rig has generated three gap lists,
the streamed level one, and the blind-authored graph drove `cross`, the
field-catalog semantics and `pcg assets`. Every substantial example so far
has produced a feature list. The base rate among complex graphs is close
to 1; only the sample is small.

**Why they are parked anyway**, and it is this file's own discipline
rather than weak demand: let the consumer specify the mechanism. A3 has a
real open question — what a name bound twice means, and whether a binding
survives a programmatic edit, given every write path in the library edits
the TREE — that the next rig-sized graph will answer better than a guess
will. Building the guess risks a mechanism the next real example does not
fit.

**Triggers.**

- Both: the NEXT COMPLEX EXAMPLE is the measurement. Re-derive when it
  lands, expecting these to strengthen rather than soften, and count over
  complex graphs rather than over the whole corpus.
- D3 specifically, and cheaply, FIRST: try the data fix. Make the truss's
  four +/-sqrt(2)/2 signs an attribute or a param and see whether the four
  expressions collapse into one shared formula on their own. A field is
  deferred and evaluated once per consumer, so one shared formula
  genuinely can produce four answers — but only if the varying part stops
  being a literal. If they collapse, D3 was not needed FOR THAT CASE
  (n=1, not a verdict); if they do not, D3's case is established on a real
  graph. A day against a large feature, and either outcome generalises to
  every complex graph after it.
- Also worth re-checking before either is built: both numbers were counted
  by walking JSON, and an expression now reads as TEXT and as a DIAGRAM
  (`printFieldSpec`, and the editor's field-tree view). The duplication
  that motivates A3 used to be invisible. Whether it grates more or less
  once you can see it at a glance is unknown, and it is cheap to find out
  by living with the new views.

**The decision D3 still needs** is §7.4 of the fields plan: whether
cross-node expression reuse is a goal at all. The truss experiment above
is the honest way to settle it.

One suggestive detail for whoever picks D3 up: the graph already defines
a `value` pin kind that NO node consumes — a wire type with a producer
and no destination (`src/graph/node.ts`, `valueConstant`). A vestige
pointing at exactly the model D3 would complete.

### ~~The seven remaining math primitives~~ — SHIPPED 2026-08-19

`fract mod smoothstep exp log sign distance` are in the grammar, which
goes 50 -> 57 fns. Kept here rather than deleted because the entry's own
reasoning is what the outcome tested, and it was half right.

**The trigger was a caller, exactly as the entry demanded — but not the
one it predicted.** It said "build one when a graph wants it", and no
graph did: measured corpus demand was still zero the morning this
shipped. What arrived instead was a person asking for all seven at once,
which is a legitimate caller and a different kind of one. The `mod`
semantics the entry reserved for such a caller was duly put to them, and
answered FLOORED — sign follows the divisor, `mod(-1, 8)` is 7 — for
coordinate wrapping, since a truncated remainder mirrors every tile in
the negative quadrants and so breaks precisely where an unbounded
generator lives. That answer is now permanent and `graphs/basics-tiling-a-field.json`
is built to make it visible rather than merely stated.

**The cost estimate was right about the shape and wrong about the size.**
Each fn did cost a CPU implementation, a lowering, parse/emit, a parity
row and a device probe. What the entry did not anticipate is that FOUR OF
THE SEVEN CAME OUT BIT-EXACT — `fract`, `mod`, `sign` and `smoothstep` —
because each was DESIGNED for exactness rather than measured for a
budget: `sign` is a pair of comparisons, `fract` is two exact ops, and
`mod` and `smoothstep` round each intermediate to f32 individually so the
CPU runs the device's expansion step for step, which is the trade `cross`
made. Only `exp` and `log` are genuinely transcendental (budgets 8 and 2)
and `distance` carries 1 ULP against `length`'s 4. Three new budgeted
rows, not seven — so "permanent catalog surface" was the real cost and
the parity work was less than billed.

**One assumption was refuted outright.** The entry treats a synonym as
disqualifying, per the `and`/`or` refusal below. `sign` IS a synonym —
`normalize` on a scalar already returned -1/0/1 — and it shipped anyway,
on the `step` precedent: it renames something nobody would guess the
spelling of. The `and`/`or` line therefore is not "no synonyms" but "no
synonym for an operation whose existing spelling is already the obvious
one", which is a narrower rule than this entry assumed it was applying.

What is still absent, and now deliberately: `exp2`/`log2` (`pow(2, x)` is
the first, nothing has asked for the second), a truncated remainder to sit
beside the floored one, and `trunc` itself.

### The graph written blind, 2026-08-17

A third vehicle: an agent given ONLY the CLI — no source, no docs, no other
graph, not even to learn the file format — and asked to author a graph from
an outcome that named no node types. Full friction log kept at
`PLAN-agent-authoring.md`; the graph it produced ships as
`graphs/examples-riverbank.json`, description included, because how it was
made is the interesting part of it.

**What it fixed.** The field catalog published type signatures with no
semantics (`usage: { fn: "select", args: [arg0, arg1, arg2] }`) while the
node catalog published a full param table — so half the library's
expressive power had no agent-facing documentation at all. Every fn now
carries a description and named args. Two things the library KNEW and did
not say went with it: each noise's output range (`noiseOutputRange` is a
public export the catalog never printed), and that gradient noise is
exactly 0 on the integer lattice, so a unit-spaced grid at a whole-number
frequency yields a silently DEAD field — `perlinNoise` and `fbm` only;
`valueNoise` and `simplexNoise` are unaffected.

**Both items that log deferred are now CLOSED (2026-08-17), and each
closed differently from how it was written** — one shipped four of its six
names and refused the other two on their merits, the other turned out to
be asking the wrong question. Kept rather than deleted because the
re-derivation is the expensive part, and because a deferral that was
wrong about its own shape is worth being able to read back:

- **~~No `cross`, `pow`, `sqrt`, `step`, `and` or `or` in the field
  grammar.~~ FOUR OF THE SIX SHIPPED 2026-08-17.** `cross`, `pow`, `sqrt`
  and `step` are in the grammar; the riverbank's nine-deep hand-rolled
  perpendicular is now one `cross` call, byte-identical.
  **`and` and `or` stay out, and that is now a decision rather than a
  deferral**: `mul` IS logical AND on 0/1 predicates and `max` IS OR,
  exactly, with no rounding to argue about, and both say so in their own
  catalog entries. A second spelling of an existing operation would cost
  the full new-fn tax to buy a synonym. `step` was added knowing it is
  exactly `ge(x, edge)` with the operands swapped — that one bought a name
  a shader author reaches for, and its entry says as much — so the line
  between the two calls is worth stating: `step` renames a fn whose
  argument ORDER trips people, `and`/`or` would rename ones whose spelling
  is already the obvious one.
- **~~No way to discover a valid asset id.~~ SHIPPED 2026-08-17**, and the
  entry it replaces guessed the shape wrong. It wanted "a registry the
  host populates and the CLI can list", waiting on a caller outside the
  library. That caller was never the missing piece: a registry is the
  HOST's to own — the library is render-agnostic on purpose and cannot
  hold one — so the answerable question was never "which ids are valid"
  but "which ids does this graph REQUIRE". `describeGraphAssets` and
  `pcg assets <graph.json>` answer that, statically, across every branch
  rather than the one a seed reached, and report an id set they cannot
  determine as OPEN rather than guessing it.
  Two counts the old entry got wrong, both now measured: the blind author
  invented FOUR ids, not two (`tree_pine`, `tree_birch`, `tree_willow`,
  `driftwood_log`), and they "may render nothing" understates it — all
  four render as hashed stand-ins, which looks like success. Corpus-wide
  it is 19 distinct ids against the shipped viewer's 9, overlapping on 6.
  That gap is BY DESIGN (a viewer of arbitrary graphs must draw
  something) and is deliberately not asserted anywhere; what was missing
  was any way to see it.
  Still open, and now genuinely blocked on a caller: comparing that list
  against a host's registry. `pcg assets --against <manifest.json>` is
  one flag, but it would invent a manifest format with no shipped
  producer — the exact trap this entry fell into the first time.
  `shared/assets.ts` now exports `PLACEHOLDER_ASSET_IDS`, so the compare
  is a line of shell today; a format can wait for a second consumer.

### Release state, corrected 2026-08-17

**The previous version of this entry was WRONG, and the way it was wrong is
worth keeping.** It said "the last PUBLISH was v0.9.0", and a release pass
built on that: the version was left at 0.15.0, a v0.15.0 tag was cut and
pushed, and `npm publish` refused with "you cannot publish over the
previously published versions: 0.15.0". The registry is the only authority
on what is published, and it says 0.6.1, 0.8.0, 0.9.0, 0.9.1, 0.14.0,
0.15.0, with `latest` at 0.15.0 since 2026-08-11.

The contradiction was already inside the repository. `docs/index.html`'s
roadmap carries a shipped row reading `v0.15.0  2026-08-11`, matching the
registry's date exactly. Two documents disagreed and the one that was
checked against nothing won. **Check `npm view pcg-ts versions` before any
release claim** — it costs one command and it is the only source that
cannot be stale.

CURRENT STATE. `package.json` and `src/index.ts`'s `VERSION` are 0.16.0.
Everything after 2026-08-11 is unreleased: the field-capability rule and
its sweep (20 to 44 params over 25 node types), the text syntax
(`printFieldSpec`/`parseFieldText`), node-seeded noise, graph-scoped params
with `targets`, `cross`/`pow`/`sqrt`/`step`, `pcg assets`, the editor
rename, and the read-only field diagram.

A release pass wants: the version bumped in BOTH `package.json` and
`src/index.ts` (the export is hand-maintained and `npm run docs` re-stamps
the two HTML pages from package.json), a roadmap row in
`docs/index.html` — every shipped version has one — the dist smoke gate,
and a tag cut only AFTER the version is settled. Publishing is interactive
(npm 2FA is a passkey), so it ends with a command for a human to type.

STILL OPEN, found by the audit this pass actually did: 41 of 190 runtime
exports are named in none of `llms.txt`, `README.md` or
`docs/authoring.md` — including `isField`, `defineNode`,
`createTriangleMesh`, `getNodeType`, `listFieldFnInfos`,
`describeGraphAssets` and `specChildEntries`. Some of the rest
(`FIELD_BRAND`, `keyNum`, `nextRev`, `paramValueError`) read like they
should not be public at all. Worth a documentation pass before the next
release rather than a scramble during one.

### The streamed level, and what it found first, 2026-08-16

`graphs/examples-streamed-terrain.json` plus `tests/worldStreaming.test.ts`
— a second discovery vehicle, added because round four judged the rig
SATURATED FOR THE DATA MODEL: four of its five findings were in the
reporting surface rather than the cook, and three rounds of measurement
were all one cook at defaults.

Two absences made the choice. No serialized graph in `graphs/` could be
cooked by a `World` at all — every streaming example builds its graph in
TypeScript, so the format agents and the editor actually use had never
been exercised for streaming. And the BUDGET x CELL-ORDER product was
untested: `budgetMs` appeared in World tests only as 0 ("nothing cooks"),
while `crossPartition.test.ts` says in its own header that it partitions in
SPACE and `graphs.test.ts` in TIME. Nothing crossed them, and the contract
(`world.ts:247`) covers both: "Cook order, viewpoint path, evictions, and
recooks never change the bytes a cell produces."

**Its first finding, and the reason a vehicle is worth building. ~~±Infinity
cannot cross a bind patch.~~ FIXED 2026-08-17, and the refusal rested on a
FALSE PREMISE.** `patches.ts` refused an infinity because "a patch is JSON
that must survive `postMessage`, and `JSON.stringify(Infinity)` is `null`".
The second half is true; the first is not. A patch is never stringified —
it rides `postMessage`, which is STRUCTURED CLONE, and structured clone
carries ±Infinity exactly. Measured through a `MessageChannel`:
`[0, -Infinity, 0]` arrives intact where `JSON.stringify` would have made
it `[0, null, 0]`.
So the FILE rule was being applied to a TRANSPORT that does not need it,
and the cost was specific rather than theoretical: `filterByBounds`
declares `acceptsInfinite` for exactly one case — a `halfOpen` ownership
clip over an `xz` column, unbounded in Y — and that, the canonical
partition recipe, was the one thing a serializable bind could not express.
A level written the textbook way could not reach a worker pool. Patches now
apply the LIVE rule (`liveParamValueError`), the streamed level binds the
bound it means, and the graph keeps a finite ±1e6 in the FILE, where JSON
has no infinity literal and the serialization rule correctly still refuses
one. The two rules differ because the two destinations do.
The entry is kept because the shape recurs: a constraint inherited from
the wrong layer, carried in a comment confident enough that nobody
re-derived it until a consumer made it hurt.
Two smaller ones with it: nothing enforces that a level's halo matches the
radius of the neighbour query that needs it (the suite reads the radius out
of the JSON to stop the two drifting), and a `ParamPatch` can only replace
a whole `FieldSpec`, never a number inside one.

**What the suite asserts, and what it refuses to.** Byte-identity across
budgets, across cell orders, and across the two together, each with a
control that was SEEN to fail — a halo of 0 and of radius-1 (pinning the
width, not merely that a halo exists), a per-cell reseed on a graph whose
`randomField` moves with it, and a retain radius large enough that nothing
evicts. The unbounded-hop rung is kept in the graph on purpose and its
DISAGREEMENT is asserted rather than papered over: a rank over a cell's own
population is not the rank over the region, and a suite that pretended
otherwise would be asserting something the library does not promise.

### The rig's gap list, round three, 2026-08-16

Ten more, found by taking the rig through the five mechanisms that shipped
because of round two. Every byte claim below is `graphFingerprint` against
a control that reports DIFFERENT at another seed, so "byte-identical" is a
measurement.

**Worked through 2026-08-16 in one pass. Nine of the ten shipped; the
tenth was refused with a measurement, which is the same result.** Gap 7 —
carrying a curve frame across a resample — is the refusal, and it got
STRONGER on the second look rather than weaker: the general mechanism
appeared to have a consumer besides frames, three scalars the cable body
carries with a piecewise-constant `nearest` transfer, and those scalars
measure as per-cable CONSTANTS (min = max = mean, standard deviation
zero), so an interpolating carrier would buy exactly nothing. With that
consumer withdrawn the entry has none, and this file's opening discipline
applies.

Two entries corrected their own reasoning while being built, which is what
these lists keep earning: gap 1 undersold itself by a whole half of the
format (19 field-capable params in 46 node types, all f32/vec3/vec4), and
gap 6 was wrong about the rig — both copy sources emit zero primitives, so
the rebuild it wanted to retire was BUILDING topology, not restoring it.

**Round three's headline is a BUG, not a feature, and it was in our own
work.** Gap 10: the cable wraps carried a frozen `0.6010407640085654`
inside the `forEach` body — `0.425 * √2`, the truss half-diagonal, which
is to say readings NINETEEN and TWENTY of `$trussHalfWidth`. The migration
that collapsed the other eighteen skipped subgraph payloads, correctly (a
body is bound by its wrapper and by nothing else) and silently. Turning
the knob that says "this is the knob that sizes the truss" therefore
dragged the truss out through its own cables: at 1.2 the chords sit at
1.698 and the cables stayed at 0.743, a full unit inside. FIXED — the
wrapper declares a targetless param and the body reads it, the same hop
`$cableRadius` already uses, byte-identical at the default.
**The durable part is that nothing could have told anyone.** A body
literal that is a copy of an outer value is invisible to `--params` (a
constant is not an address), invisible to the fingerprint (byte-identical
until the knob moves), and invisible to a text migration (a subgraph
boundary is where search-and-replace stops). Gap 1 would make this class
WORSE, so a lint belongs with it — and it shipped with it: `pcg validate`
reports constants inside a body that equal a declared graph param.
Verified against history rather than a fixture, and made CHOOSY by
measurement: reporting every exact match produced one finding on the whole
corpus and it was a coincidence, so a match now counts only when the
constant is distinctive or equals the value times √2.

1. **~~A graph-scoped param cannot declare `targets`~~ SHIPPED
   2026-08-16.** It reaches `i32`, `bool`, `string`, `enum` and non-field
   vectors now, by being WRITTEN into named node params rather than
   substituted into an expression, with the schema derived from those
   params by `resolveExposedParam` — the subgraph resolver, unchanged, so
   a declaration can never claim a type or a capability the slots it
   drives do not have.
   **What the rig then earned is ONE param, not thirty-six**, and the
   restraint is the finding. `$tubeSides` gangs the `sides` of all six
   skins because a tessellation budget is one decision — cost is linear,
   six skins pay it, and nothing about a 0.03-radius brace wants a
   different roundness from the 0.055 chord beside it. The other five
   repeated literals stay written out, measured rather than assumed:
   `profile` means two different things at its six sites, `caps` turns on
   whether a tube has visible ends at all, `frame` is invisible on a
   circular section, and `joint`/`miterLimit` never move (the sharpest
   bend anywhere is the braces’ 100° zigzag, a stretch of 1.56 against a
   limit of 4). A shared name asserts that slots must move together, and
   asserting that falsely is worse than the repetition.
   The `writeCurveFrame` attribute names stay too, for a sharper reason:
   `curveNormal` is written 3 times and READ 11, and `sweepProfile` reads
   it by that name in the library — the name is a shared vocabulary, not
   this graph’s to rename.
   Original entry: a graph-scoped param cannot declare `targets`, so
   nothing structural is shareable. Six `sweepProfile` nodes repeat six non-field params
   each — 36 literals no name can reach. Across the whole 46-type registry
   there are exactly 19 field-capable params and every one is `f32` or
   `vec3`, so a graph param reaches only a number inside an expression;
   counts, sides, enums, booleans and attribute names are structurally out.
   Round two's closing line ("`also` survives for `sides`, six copies")
   undersells it by a whole half of the format. The resolver already exists
   — `resolveExposedParam` merges targets' registered schemas and accepts
   `i32`/`bool`/`string`/`enum` alike; graph scope refuses `targets` only
   because the top-level key set is closed.
2. **~~A resampled path publishes neither its length nor its step~~
   SHIPPED 2026-08-16** as opt-in `lengthAttr` / `stepAttr`, both on the
   PRIMITIVE domain because a length is one fact per path — per-point it
   would be the same number repeated, free to disagree with itself — and
   reporting the TRUE arc length, which is the number the author cannot
   compute. In `spacing` mode it reports the step the node TAKES rather
   than the short seam remainder, so a downstream multiple keeps its
   meaning when the mode changes.
   Original entry: a resampled path publishes neither its length nor its
   step, so
   anything sized in units of the sampling is frozen. `partScatter.amount`
   is 17/900 — half a step of a 900-sample resample of a nominally 34-unit
   spine — and the panel moves that count from 100 to 2000, where the same
   literal is 0.05x the step at one end and 1.10x at the other. It is also
   derived from the nominal span rather than the true arc length (34.213),
   which the author could not know. `connectPoints.lengthAttr` is the
   precedent, one branch over.
3. **~~`pointLine` cannot say "count points, one unit apart"~~ SHIPPED
   2026-08-16** as `mode: "endpoints" | "spacing"`. The names diverge from
   `pathResample`'s pair on purpose and the node says why: there `count`
   is the discriminator because a spacing resample derives it, here
   `count` is read in BOTH modes, so what differs is which END is
   authored. `includeEnd: false` is REFUSED in the new mode rather than
   accepted as a no-op — the derived far end is the last point, and a
   setting that moves no byte is invisible to the fingerprint, to
   `--params` and to a reader, which is gap 10's hazard class.
   Original entry: `pointLine` cannot say "count points, one unit apart",
   so
   `wrapCarrierLine` restates its own count in `end: [15,0,0]`. Turning the
   "wraps" knob 16 → 17 therefore re-spaces the line and re-keys every
   `forEach` item: 1 of 16 cables survives, where moving `end` to 16 by
   hand keeps all 16 and adds one. Its sibling `pathResample` already has
   the `count | spacing` mode-pair; the two source-side nodes that place
   evenly spaced things answer the same question differently.
4. **~~No index within a path~~ SHIPPED 2026-08-16** as `pathSegments`'
   opt-in `segmentIndexAttr`, DENSE — it counts emitted segments — so a
   skipped zero-length segment cannot flip the parity it exists to feed.
   Original entry: no index within a path, so the chain's alternation is right only by
   parity luck: `chainAlternate` reads the GLOBAL index and means "every
   other link of THIS chain", and the two agree only because 35 points give
   34 segments. At `count: 36` the chains disagree with each other and
   nothing reports it. A `strandIndex` written on the source survives
   `copyToPoints` and is then destroyed by `pathSegments`, which drops
   point attributes — so the workaround is blocked, not merely ugly.
5. **~~`setAttribute` type `string` restates its own `values.length`.~~
   SHIPPED 2026-08-16** as `weights` beside `values`, with its OWN
   selector: `select` is a fraction in [0, 1) — what `randomField`
   produces natively — because a fraction read as an index is a wrong
   distribution with nothing to report it, so the convention is carried by
   the slot the expression sits in and setting both is refused. Weights
   are whole counts, which makes the bucket ends exact integers below 2^53
   and the weighted table literally the repeated table.
   **It also caused a param type.** `weights` first shipped as a
   `stringList` of digit strings, because the vocabulary had no
   variable-length numeric list — a second convention every reader of the
   machine-readable schema would have to learn for something a type can
   state. `ParamType` gains `numberList`, and this file's own rule is the
   argument: never compromise a design to avoid a format break.
   Original entry: `setAttribute` type `string` restates its own
   `values.length`.
   `partPart` selects with `mul(randomField, 9)` over a nine-entry table
   whose repetitions ARE a weighting nothing says is one. Append a fifth
   kind and leave the selector: the cook reports zero instances of it, with
   no diagnostic. Wants `weights` beside `values`.
6. **~~`copyToPoints` drops the source's topology~~ SHIPPED 2026-08-16**
   as `topology: "drop" | "keep"`, default `"drop"` and byte-identical
   there, reusing `mergePrimitives`' block shift because a copy array IS a
   union whose terms are equal.
   **The entry's account of the RIG was wrong, and the adoption is better
   for it.** It said the two sites rebuild a path the copy destroyed. They
   do not: both sources are `pointLine`, which emits ZERO primitives, so
   the `pointsToPath` downstream was BUILDING topology and not restoring
   it — `"keep"` alone would have been a no-op. The equivalent adoption is
   to path each strand BEFORE the copy, so the copy carries one polyline
   across per anchor. What that retires is not a node but a ROUND TRIP:
   the copy no longer labels its output with `targetIndexAttr` so a
   rebuild can group on the label, the fringe's swept surface stops
   carrying a dead `anchorId` on all 17,100 points, and the path is built
   once over the 35-point strand instead of over the 245 points the copies
   make of it. Node and connection counts are unchanged (66/71) because a
   node moved upstream at each site rather than vanishing.
   That label was itself the second version of the problem — round-two gap
   1 replaced `floor(index / 35)` with `targetIndexAttr`, and this
   replaces the label entirely.
7. **A curve frame cannot be carried across a resample.** The rig computes
   three frames on one spine and they disagree, so the parts are mounted on
   a different frame from the chords they are bolted to. **The mechanism is
   genuinely missing and the rig does not suffer from it**, which is why
   the measurement is the point: 0.107° mean and 0.366° max at the authored
   46 stations, 2.7 mm at the truss radius, converging as counts rise and
   reaching 1.883° only at the coarsest setting the panel offers.
   **NOT BUILT, 2026-08-16, and the second look is why.** The general
   mechanism this wants is `pathResample` carrying named POINT attributes
   across (it states in its own description that it does not), and that
   looked like it had a consumer besides frames: the cable body carries
   three scalars over a resample with `transferAttribute` `nearest`, which
   is piecewise-constant. Measured on the shipped graph — `wphase` reports
   min, max and mean all 0.491225 with a standard deviation of ZERO. The
   three scalars are per-cable CONSTANTS, so `nearest` is exact for them by
   construction and an interpolating carrier would buy exactly nothing.
   With that consumer withdrawn the entry has none at all, and the
   discipline this file opens with applies: let the consumer specify the
   mechanism. The number above is kept because re-deriving it is the
   expensive part.
8. **~~The refusal at a non-field param states no fix~~ SHIPPED
   2026-08-16** — it now states the RULE (no `i32`, `enum`, `bool` or
   `string` param is ever field-capable) and the route that works (gap
   1’s `targets`), gated on the value actually looking like a field spec.
   Original entry: the refusal at a non-field param states no fix, unlike the model
   message the same probe gets inside a `forEach` body, which names the
   missing name, lists the params that do exist, and states the non-obvious
   half. One sentence in `paramValueError`, gated on the value being a
   field spec.
9. **~~`--params` counts reader SLOTS, not readings.~~ SHIPPED
   2026-08-16** — both numbers, so the rig reads `$trussHalfWidth` in
   “10 slots, 19 readings”.
   Original entry: `--params` counts reader SLOTS, not readings. `$trussHalfWidth`
   reports "9 slots" where round two's own headline was eighteen readings,
   and `$stretchMin` reports one slot while being read four times inside
   one expression — which is the entire reason it is a param. `paramScan`
   already walks to each reference.
10. **~~The cable wrap radius is a frozen copy of `$trussHalfWidth`.~~
    FIXED 2026-08-16** — see the headline above.

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
   at 0. `src/fields/fold.ts` is NOT dead, and the first reason is not a
   hypothesis: `src/nodes/util.ts:283` calls `foldDomainConstants` on
   EVERY CPU field resolve, so the module is on the live path of every
   cook whether or not anything folds. (Stated because the weaker
   argument below was read on its own once and taken to mean the module
   had lost its consumer — it never had one removed.) The second reason
   is the idiom: still legal grammar and still documented, so a user's
   graph may be full of it. But
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
    addresses, and the editor now builds its knobs from it rather than
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
`param` spec node carries an optional inline `value`, and the editor
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

**~~`docs/pages/` is a committed build that no gate regenerates or
checks.~~ CLOSED 2026-08-16.** `tests/builtSiteCoverage.test.ts` gates
both halves now: a graph with no chunk (the ADDED case this entry
describes) and a chunk carrying superseded text (the EDITED case, which
that file used to say it deliberately could not catch). It reads the JSON
each chunk embeds rather than rebuilding, so it costs nothing and does not
depend on vite emitting identical bytes on another OS — the CI byte-diff
this entry proposed was written, measured against that risk, and thrown
away. Two bugs in the original presence check went with it: chunk names
were matched by prefix, so `pipeline-3-lots` was covered by
`pipeline-3-lots-edits`, and the base was cut at the last dash, which
vite's base64url hash can itself end with.

Original entry: 100 tracked files produced by `npm run examples:pages`, which
neither `npm run docs` nor CI runs — so it drifts from source silently and
nothing notices. Adding `graphs/basics-mask-by-species.json` proved it:
the editor enumerates graphs with `import.meta.glob` at BUILD time
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
