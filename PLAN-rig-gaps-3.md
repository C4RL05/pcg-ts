# The rig's gap list, round three — 2026-08-16

Ten things the rig wanted to say and could not, found by taking
`graphs/examples-rig.json` through the five mechanisms that shipped because of
its *previous* gap list: `copyToPoints.targetIndexAttr`, `pointsToPath`'s
string `groupAttr`, `{"from":"node","variant":N}` noise seeds, top-level
`params`, and `pcg validate --params`.

All work was done on a scratch copy; nothing under the repo was edited. Every
adoption below was cooked, and every byte claim is `graphFingerprint` against a
control that reports *different* for `--seed 4`, so "byte-identical" is a
measurement and not an assumption.

## Adopted in this pass

**1. The `forEach` cable body takes the node seed, and two nodes disappear.**
The body's wobble was the round-two exception: two identical `fbm` subtrees on
the literal seed `2459580991`, justified on the grounds that "their wobble
already re-rolls through `randomField`". **That was true of the sample WINDOW
and false of the FIELD, and the difference is two nodes.** Freeze the body's
four per-carrier picks to constants and cook: on the literal seed the 16 cables
come back as **1 distinct geometry**; on `{"from":"node","variant":0}` they come
back as **16**. Freeze the spine too and compare `P` digests across graph seeds:
the literal-seeded wobble is **byte-identical at seed 3 and seed 9** — the seed
box never reached it — while the node-seeded one re-rolls. A body node's seed is
`hashCombine(forEachSeed, hashString("forEach"), itemKey)` and the item key is
content-derived, so this is per-item, deterministic and cook-order independent
(`src/nodes/forEach.ts:245`).
What the per-item decorrelation used to cost: `wrapPick_wofs`, `wrapOnto_wofs`,
and an `opts.position` of `add(position, vec(wofs * 1000, 0, 0))` — a random
number whose whole job was to walk one frozen field far enough away that two
cables did not sample the same place. All three are now redundant. **Body 10
nodes → 8**, and `wraps` is the only output that moves — a look change, of
exactly the kind the round-two seed migration was authorized as.

**2. `$braceRadius` retires the corpus's only panel `also` row.**
`trussBraceSkin.radius` and `trussFrameSkin.radius` are both `0.03`, both
field-capable, and were ganged in `graphs/panels/examples-rig.json` by the one
`also` in the whole corpus. As a graph param the pairing moves into the graph.
Byte-identical.

**3. `$stretchMin` / `$stretchMax` — 8 readings, 4 sites, one concept.**
`partSize`'s `byAttribute` writes `lerp(0.55, 1.6, randomField("stretch"))` four
times (rod, bar, panel twice). "How far a component may stretch" is one
decision. Byte-identical.

**4. `$bundles` — the fringe's `7`, read twice in one expression.**
`danglerBundling.parameter` quantizes `curveU` into bundles with `floor(u * 7)`
and then divides by `7`; the two must agree and nothing said so. Byte-identical.

**5. `$trussHalfWidth` reaches into the `forEach` body — see gap 10.**
Byte-identical at the default value, and it fixes a live desync.

Four adoptions, `303 → 307` addresses and `2 → 6` graph-scoped params by
`pcg validate --params`; the fifth is a bug fix.

## This did not fit, and that is a result

**`pointsToPath`'s string `groupAttr` has no site in the rig, and the reason
generalizes.** All three groupings key on a machine-made integer — `stationId`
(`{"fn":"index"}`), `anchorId` twice (`targetIndexAttr`). The rig's only string
column is `part`, which lives on an instanced cloud that has no paths and never
will. Round two already noticed the feature had no corpus consumer and blamed
timing ("the graphs that group by name are the ones nobody has written"). The
sharper statement after this pass: **a word-keyed group appears when a HUMAN
named the groups, and every group in the rig is generated.** The rig is a
procedural graph end to end, so it is structurally the wrong place to look for
this consumer — a graph that imports authored data is the right one. Inventing
a site here (interning `"station-12"` to key the frame rings) makes the graph
strictly worse, so it was not done.

**`copyToPoints.targetIndexAttr` is at both of the rig's two copy sites
already**, and there is no third — the rig copies in exactly two places. Its
complement, the SOURCE index, is reachable through `setAttribute {"fn":"index"}`
on the source and does survive the copy (measured), which is why this is not a
gap — but it does not survive what comes next; see gap 4.

**Graph params cannot reach `sides` or `count`, and the refusals say so
without saying what to do instead** — captured in gap 8.

---

## The gaps

1. **A graph-scoped param cannot be declared with `targets`, so nothing
   structural can be shared.** The rig's six `sweepProfile` nodes repeat six
   non-field params each — `profile: "circle"`, `sides: 8`, `frame: "upHint"`,
   `joint: "miter"`, `miterLimit: 4`, `caps: true` — **36 literals no name can
   reach**, plus three `writeCurveFrame` nodes repeating the same three
   attribute names. Round two closed with "`also` survives for what a field
   reference cannot occupy: `sweepProfile.sides` is `i32`, six copies". That
   framing undersells it by a lot: across the whole 46-type registry there are
   exactly **19 field-capable params and every one is `f32` or `vec3`**
   (`acceptsField` in `src/nodes/*.ts`), so a graph param can only ever reach a
   number sitting inside an expression. Counts, sides, enums, booleans,
   attribute names and even non-field `vec3`s are all structurally out of reach
   — this is a whole half of the format, not one integer.
   *What the author writes today:* the number N times, plus an `also` row in a
   panel file that only the editor reads, and which the plan doc itself admits
   drifts when the graph is edited through the node inspector.
   *The mechanism:* the subgraph/`forEach` exposed-param form already does this
   correctly — `params: [{name, targets: [{node, param}]}]`, resolved by
   `resolveExposedParam` (`src/nodes/subgraphParams.ts:195`), which merges the
   targets' registered schemas, requires them to agree on type and enum set, and
   accepts `i32`, `bool`, `string`, `enum`, `stringList` alike. It is refused at
   graph scope purely because the top-level key set is closed:
   `params[2]: unknown key "targets"; valid keys: name, value, min, max,
   description`. Admitting `targets` at graph scope reuses the resolver that
   exists, and the two forms would then differ only in whether a wrapper node
   supplies the value. **The alternative — leaving it to `also` — puts the
   graph's structure in a presentation file, which is the hazard gap 10 of
   round two closed for addresses and left open for values.**

2. **A resampled path does not publish its own length or step, so anything
   sized in units of the sampling is a frozen literal.** `partScatter.amount` is
   `0.018888888888888889` = **17/900**: half the step of a 900-sample resample
   of a nominally 34-unit spine. Nothing in the graph says "half a step", and
   `partDense.count` is a panel knob from 100 to 2000. Measured against the true
   arc length (34.213):

   | `partDense.count` | true step | frozen jitter as a multiple |
   |---|---|---|
   | 100 | 0.34558 | 0.05 x |
   | 900 | 0.03806 | **0.50 x** (the authored intent) |
   | 2000 | 0.01712 | 1.10 x |

   At the knob's top the scatter exceeds the spacing and components cross each
   other; at the bottom it is invisible. The literal is also derived from the
   *nominal* 34-unit span rather than the true 34.213 arc length — the author
   could not know the second number, which is the gap in one line.
   *What the author writes today:* the count and the span multiplied out by
   hand, in another node, with nothing holding the three together — the exact
   shape of round-two gap 1's `floor(index / 35)`.
   *The mechanism:* `pathResample` writes the path's arc length on the PRIMITIVE
   domain (and/or the step on the point domain) under an opt-in name.
   **The precedent is in this graph already**: `connectPoints.lengthAttr` writes
   `edgeLength` per primitive and `drapeSag` reads it in a field to make each
   swag's sag proportional to its own chord. The same author could not do the
   same thing one branch over.

3. **`pointLine` cannot say "count points, one unit apart", so the carrier line
   restates its own count — and turning the knob re-rolls every cable.**
   `wrapCarrierLine` is `count: 16, end: [15, 0, 0]`: the `15` is `count - 1`,
   and it exists so the carriers land on integer positions. The panel exposes
   `wrapCarrierLine.count` as "wraps", 1..40. Measured, 16 → 17:

   - `end` left at `[15,0,0]` (what the graph does today): **1 of the 16
     existing cables survives unchanged**. Only cable 0, which sits at the
     origin either way.
   - `end` moved to `[16,0,0]` by hand: **16 of 16 survive**, and the 17th is
     genuinely new.

   The `forEach` item key is content-derived and `pointIdentities` hashes the
   `P` bit patterns, so respacing the carrier line re-keys every item and
   re-seeds every body. Asking for one more cable silently redraws all of them.
   *What the author writes today:* `count - 1` typed into `end`, in the same
   node, where no expression can reach it (`pointLine.end` is a non-field
   `vec3`) and no panel knob edits it.
   *The mechanism:* `pointLine` gains the `count | spacing` mode-pair its
   sibling `pathResample` already has, so the step is stated and the endpoint is
   derived. **The sibling inconsistency is the tell**: the two source-side nodes
   that place evenly spaced things answer the same question differently.

4. **There is no index within a path, so the chain's alternation is correct only
   by parity luck.** `chainAlternate` alternates link orientation with
   `index - 2 * floor(index / 2)` over the GLOBAL point index of
   `chainSegments`' output. What it means is "every other link of THIS chain".
   The two agree only because `chainStrand.count: 35` gives 34 segments per
   chain, an even number. Measured:

   - `count: 35` → 34 segments/chain → every chain's first link has **1**
     orientation. Correct.
   - `count: 36` → 35 segments/chain → **2** distinct first-link orientations.
     The chains disagree with each other, and nothing reports it.

   *What the author writes today:* the global index, and a strand count that
   must stay even for a reason written down nowhere.
   *Why the obvious workaround is blocked:* writing `strandIndex =
   {"fn":"index"}` on the source works and **survives `copyToPoints`**
   (measured) — and is then **destroyed by `pathSegments`**, which carries
   primitive attributes and drops point attributes (measured: `strandIndex`
   present on `chainCopies`, absent on `chainSegments`). The only per-path
   coordinate that survives is `curveU`, and recovering an index from a
   normalized parameter needs the count again.
   *The mechanism:* `pathSegments` writes an opt-in `segmentIndex` (i32, per
   path) beside the `curveU` it already writes — the direct analogue of the
   `stationId` the truss writes by hand.

5. **`setAttribute` type `string` restates its own `values.length` in its
   selector, and the weights are spelled by repeating table entries.**
   `partPart` is `values: ["rod","rod","rod","rod","bar","bar","panel","clamp",
   "clamp"]` with `value: mul(randomField("part"), 9)`. The `9` is the table's
   own length, retyped. Measured: append a fifth kind to `values` and leave the
   selector alone — the cook reports **`rod x290, bar x152, clamp x149,
   panel x70` and not one instance of the new kind**, with no diagnostic. The
   node knows the number the author had to retype.
   *What the author writes today:* the length, twice removed from the list it
   describes, plus a 4:2:1:2 weighting expressed as nine table rows.
   *The mechanism:* either a selector convention in `[0, 1)` mapped across the
   table (a format break, so: an opt-in mode), or a `weights` param beside
   `values`, which says both things at once —
   `values: ["rod","bar","panel","clamp"], weights: [4, 2, 1, 2]`. The second is
   the one with the caller: the repetition in the rig's table is a weighting and
   nothing in the graph says so.

6. **`copyToPoints` drops the source's topology, so an array of a PATH has to be
   rebuilt by hand.** Measured on a minimal graph: a 5-point polyline
   (1 primitive) copied onto 3 targets comes out as **15 points and 0
   primitives**. The rig pays for this twice — `chainCopies → chainChainPath`
   and `danglerCopies → danglerDanglerPath` — and both `targetIndexAttr` writes
   exist to feed those rebuilds.
   **This reframes round-two gap 1 rather than contradicting it.**
   `targetIndexAttr` made the rebuild cheaper (two `setAttribute` nodes gone)
   and left the rebuild in place. Round two's gap 8 already established the
   principle for the two other topology-destroying steps — `mergePrimitives` for
   unions, `topology: "keep"` for the five point filters — and the rig's own
   meta description tells that story about the truss: "ten nodes spent throwing
   topology away and putting it back". The chains and the fringe are the same
   sentence, unfinished.
   *What the author writes today:* `targetIndexAttr` plus a `pointsToPath`
   grouping on it, per copy site.
   *The mechanism:* the same `topology: "drop" | "keep"` flag, defaulting to
   `"drop"` and byte-identical there. Copies are laid out in contiguous blocks
   of `nS` (`i = t * nS + s`), so preserving topology is exactly what
   `mergePrimitives` already does — concatenate and renumber, once per block.

7. **A curve frame cannot be carried across a resample, so the rig computes
   three of them and they disagree.** `trussCells` (46), `wrapCells` (150) and
   `partDense` (900) each resample the same spine and each run their own
   `writeCurveFrame`; `pathResample` does not carry input point attributes, and
   a rotation-minimizing frame is a function of the discretization, so the parts
   are mounted on a different frame from the chords they are bolted to.
   Measured, angle between the two normals at matching `curveU`:

   | `trussCells.count` | mean | max | offset at the truss radius |
   |---|---|---|---|
   | 12 (panel min is 8) | 0.755° | 1.883° | 14.0 mm |
   | 24 | 0.292° | 0.818° | 6.1 mm |
   | 46 (authored) | 0.107° | 0.366° | 2.7 mm |
   | 90 | 0.050° | 0.288° | 2.1 mm |

   **The honest verdict: the mechanism is genuinely missing and the rig does not
   suffer from it.** At the authored counts the worst offset is 5% of a chord
   radius (0.055) and invisible; it converges as the counts rise and only
   approaches a quarter of a chord radius at the coarsest setting the panel
   offers. Recorded because the entry that assumed otherwise would have been
   wrong, and because the number is the expensive part to re-derive.
   *What the author writes today:* nothing — there is no way to say it. The only
   carrier across a resample is `transferAttribute` with `nearest`, which the
   wraps already use for their four scalars, and which for a frame would give a
   piecewise-constant normal that is worse than recomputing.

8. **The refusal for a field spec at a non-field param states no fix.** Both
   probes return the same shape of message:
   `node "trussChordSkin" param "sides": expected an integer, got
   {"fn":"param","name":"sweepSides"}` and
   `node "trussCells" param "count": expected an integer, got {...}`.
   Compare the message the same probe gets one level down, inside the `forEach`
   body, which is a model of the house rule: it names the node, the body slot,
   the missing name, *lists the exposed params that do exist*, and states the
   fix including the non-obvious half ("its `targets` may be empty: a
   declaration with none exists exactly to feed a field expression").
   *What the author — or an agent that has just learned `$name` works — does
   today:* guesses. The message does not say that no `i32` param anywhere is
   field-capable, nor name the two routes out (a panel `also` today, gap 1's
   `targets` if it ships).
   *The mechanism:* one sentence in `paramValueError`, gated on the value being
   a field spec: this param is not field-capable, no `i32`/`enum`/`bool`/
   `string` param is, and here is where the value can live instead.

9. **`pcg validate --params` counts reader SLOTS, not readings, and the case for
   the feature was made in readings.** The adopted rig reports
   `$trussHalfWidth … read by 9 slots` and `$stretchMin … read by 1 slot`. The
   first is the number round two chose *not* to lead with — its own headline was
   "EIGHTEEN readings across nine nodes, in four different float spellings" —
   and the second hides that the name is read four times inside one expression,
   which is the entire reason it is a param rather than a literal.
   *What the author writes today:* counts the occurrences by eye, in JSON.
   *The mechanism:* `paramScan` already walks to each reference; report both
   numbers ("9 slots, 18 readings"). Small, but this listing is the library
   function the editor and the CLI now share precisely so that one derivation
   answers everyone — and it currently under-reports the thing it exists to
   demonstrate.

10. **The bug this pass found: the cable wrap radius is a frozen copy of
    `$trussHalfWidth`, inside the `forEach` body where the migration could not
    see it.** `wrapMove` carries the literal `0.6010407640085654` twice. That is
    exactly `0.425 * Math.SQRT2` in f64 — the truss half-diagonal, the same
    quantity `partMount` and the four brace nodes read as
    `mul($trussHalfWidth, 1.4142135623730951)`. **Round two's eighteen readings
    were twenty.** Measured, mean distance from the spine:

    | `$trussHalfWidth` | chords | cables |
    |---|---|---|
    | 0.425 (authored) | 0.606 | 0.743 — outside, correct |
    | 1.2 (the panel's max) | 1.698 | **0.743 — a full unit inside the truss** |

    The knob whose description reads "this is the knob that sizes the truss"
    drags the truss out through its own cables.
    *What the author writes today, and what fixes it:* the mechanism is NOT
    missing — a targetless exposed param on the wrapper, which is how
    `$cableRadius` already crosses the same boundary, and the error message
    quoted in gap 8 spells it out. Declaring it and rewriting the two body
    literals is **byte-identical at the default value** (0.425 x √2 reproduces
    the literal exactly in f64, the same finding round two measured for the
    diagonal spellings) and correct at every other value: at 1.2 the cables move
    to 2.076, back outside the chords at 1.698.
    **The gap is that nothing could have told anyone.** A body literal that is a
    copy of an outer value is invisible to `--params` (it is a constant, not an
    address), invisible to the fingerprint (it is byte-identical until the knob
    moves), and invisible to the migration that collapsed its eighteen
    siblings — a subgraph boundary is exactly a place where a search-and-replace
    stops. If gap 1 ships `targets` at graph scope, this class gets worse, not
    better, because more values will be declared once and read in more places
    that a text pass cannot reach. The cheap mechanism is a lint, not a feature:
    `pcg validate` reporting constants inside subgraph bodies that equal a
    declared graph param's value.

---

## Not gaps — candidates killed by measurement

Kept because each one looks like a gap when reading the JSON, and re-deriving
the refutation is the expensive part.

- **No `let` / `ref` / CSE in the field grammar.** The body's `wrapMove` writes
  a 15-node subtree twice (once for the normal component, once for the
  binormal), `chainLinkSize` writes `1.3 * scale.y` three times, `partMount`
  writes its quantized angle twice. It reads like a performance problem and is
  not one: `evaluateField` memoizes per `EvalContext` on `field.key`
  (`src/fields/types.ts:111-147`), which is common-subexpression elimination by
  another name, so two identical subtrees evaluate once. What is left is
  verbosity, and the pillar "anonymous attributes carry intermediate results"
  already names the escape hatch. A wish, not a gap.
- **No `mod` and no `round` in the 46 field fns.** `x - N * floor(x / N)`
  appears seven times in the rig and `floor(x + 0.5)` once. Both are exact at
  the magnitudes involved. Typing, not mechanism.
- **Duplicated attribute NAMES** — `"curveNormal"` 14 times, `"anchorId"` 4,
  `"radialAngle"` 5 — cannot be collapsed by any param (a graph param holds only
  numbers), which looks like a silent-rename hazard. It is not silent: renaming
  `trussFrame.normalName` alone fails with `node "trussMove0" failed: attribute
  "curveNormal" not found`, naming the node and the attribute. Loud failure, no
  gap.
- **`forEach` has no fan-in.** It looks like a one-way street: 16 items out and
  no node to fold them back. `mergePrimitives` accepts the multi-item collection
  on one pin and returns a single 21,888-point geometry (16 x 1,368), keeping
  the topology. No gap.
- **The four `trussMove0/2/4/6` + `mergePrimitives` shape looks like it should
  collapse into one `copyToPoints` onto four corner targets**, now that
  `targetIndexAttr` can hand the corner id to a switching expression. It cannot,
  and gap 6 is why: the copy would destroy the polyline topology that round
  two's gap 8 rewrite exists to preserve. If gap 6 ships, this becomes a real
  simplification — nine nodes to two, twice.
