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

### Killing the racetrack's TypeScript prelude: four library gaps, scoped 2026-08-25

`demos/racetrack/levels.ts` records the honest limit of the streamed
racetrack: its graph is BUILT from a cooked `Lap`, so the World cannot be
constructed until the road has cooked and the placement list is decided. A
kilometre of track pays that whole rule pass at load instead of streaming
it. This is what it would actually take, surveyed before starting so the
size is not discovered halfway.

**THREE OF THE FOUR GAPS BELOW WERE WRONG, and the corrections are
inline.** They were written from a survey and from a `PLAN.md` entry six
days old; each was then settled by building and cooking the thing. Only
gap 1 was real, and it shipped the same day as `transferAlongPath`. The
lesson is the one this file keeps relearning: a capability claim about
this library is worth what its last measurement is worth, and reading the
sources is not measuring.

**The size.** The prelude is `dressLap` and everything it calls:
`dress.ts, assets.ts, legibility.ts, stations.ts, tunnels.ts,
enclosure.ts, zones.ts, falseEdges.ts, sightline.ts, corners.ts,
tolerance.ts, rand.ts` = 5,362 lines, ~2,393 non-comment. Deducting
test-only minimality gates leaves **~2,240 code lines** to become nodes or
bound data. Of those, ~900 are pure arithmetic (and `dressGraph.ts`
already ports exactly those five stages), ~700 are set/map/sort/fixed-point
work with no node story, and ~400 are weighted draws over the measured
kit.

**AND IT ONLY PAYS OFF AT THE END.** Porting a stage shrinks the prelude
but does not remove it: the remaining lap-global repairs operate on the
placement list, so the structural constraint -- a graph built from cooked
data -- survives until the LAST stage lands. The return on this work is
the library capabilities below, not an early win in the demo.

**Gap 1 -- nothing samples a path at arbitrary arc positions.**
`pathPointAt` slides the path's OWN points: its output carries the input
path's point count and topology, so it cannot answer "an N-point cloud of
stations against an M-point path". `writeCurveFrame` evaluates only at a
path's existing points, and its normal is a transported one with seam
holonomy rather than the road's banked `up`. The demo's `frameLookup` is
this operation in TypeScript. SHIPPED 2026-08-25 as `transferAlongPath`
-- not "gather", because the primitive `transform/gather-on-path` already
owns that phrase for very nearly the opposite operation.

**Gap 2 -- ~~no in-cook global reduction~~ WRONG, corrected 2026-08-25 by
cooking it.** A global reduction DOES close inside one cook, and the older
entry's REASON was the error: it observed correctly that a point-domain
field cannot read a detail attribute, and concluded wrongly that the total
was therefore unreachable. `promoteAttribute` (`from: "detail"`, `to:
"point"`) broadcasts it straight back. Measured chain, 500 points:

    setAttribute weight -> attributeReduce{mode:"sum"} -> detail
      -> promoteAttribute{detail->point} -> setAttribute share = w/total

detail `shareTotal` came back exactly 1. `attributeReduce{mode:"count"}`
writes an element count the same way, `pathResample.lengthAttr` writes each
path's true arc length to the primitive domain, and `round(density *
lapLength)` therefore composes end to end -- measured, exactly 50 survivors
from a computed budget. Detail-domain fields read detail attributes
NATIVELY; only detail->point needs the promote.

What actually survives is two narrower limits, and they are the ones to
carry:

- **A total is per-COOK, so under a spatial partition it is the CELL's
  total.** Measured: 12 World cells of 125 points each, every cell's
  shares summing to 1.0 independently. Harmless for an unbounded level,
  which is one cell -- which is exactly where the racetrack's lap-global
  rules live. `attributeReduce`'s description says nothing about
  partitioning at all, which is a doc gap worth closing.
- **No `count` param anywhere is field-capable** (zero `acceptsField`
  hits across `src/nodes/*.ts`). So a total cannot SIZE a generator; it
  can only cut an over-generated cloud down, via `filterByExpression`
  against a field predicate. That is the real shape of the constraint,
  and it is much weaker than "cannot close inside one cook".

Budgeting in TIME is safe: `cook(graph, { budgetMs: 0 })` gave a
byte-identical total, because the executor yields only after `cookNode`
returns, so a node body is atomic and `attributeReduce` always sees the
whole geometry.

**Gap 3 -- ~~no gaussian field~~ EXPRESSIBLE TODAY, corrected 2026-08-25
by cooking it.** `mul(sqrt(mul(-2, log(randomField("u1")))), cos(mul(2*PI,
randomField("u2"))))` is a correct standard normal. Measured over 200,000
points: mean -0.00039, sd 1.00000, skew 0.00209, excess kurtosis 0.00765,
matching an f64 reference to five decimals. Distinct `randomField` KEYS
give independent streams at the same point -- Pearson r 7.6e-4, Spearman
7.7e-4, a 16x16 joint chi2 of 279.1 at df=255 (p~0.14), and a control
r(u1,u1) of exactly 1.0 proving the estimator can report "correlated".
Cost 253 ns/pt over 10 field nodes; 277 ns and 12 nodes guarded.

**GUARD IT.** `hashFloat` returns exactly 0 whenever the hash is < 256, so
`randomField` is 0 with probability 2^-24 -- measured, 10 zeros in
200,000,000 draws. `log(0)` is -Infinity and PROPAGATES SILENTLY through
`evaluateField`; it is caught only downstream at `resolveOn`, which
refuses a non-finite field param. So an unguarded gaussian does not draw
garbage, it turns a 1-in-16.7M draw into a hard cook failure.
`max(u1, 1e-7)` costs two field nodes and no measurable distortion.

**What is actually missing is the GENERATIVE half.** `randomField` is
keyed on an EXISTING point's identity, so it can only replace `gauss`
after the placement list exists -- not during the process that decides how
many stations there are and where. There is still no scatter along a path,
no arc-length scatter, and no per-parent variable child count. Combined
with the no-field-capable-`count` limit above, the shape a graph must take
is OVER-GENERATE A FIXED CLOUD AND FILTER TO A COMPUTED BUDGET, which is
proven to work and is how the supers and clusters would be cut.

**Gap 4 -- ~~no per-point weighted draw~~ NOT A GAP AT ALL, corrected
2026-08-25 by cooking it.** `setAttribute.weights` is indeed a static
table producing an interned string, and its index is deliberately not
readable (`byAttribute`/`attributeIs` are the offered escapes). But it is
not the only route, and the one that works needs nothing new:

    copyToPoints (table -> stations, targetIndexAttr)
      -> setAttribute w  (the row's own weight, picked by the station's bucket)
      -> pointsToPath    (groupAttr: station, orderAttr: row)
      -> pathScan        exclusive -> cw, inclusive -> ci, plus totalAttr
      -> promoteAttribute the total back to point
      -> filterByExpression  le(cw, u*total) * lt(u*total, ci)

`pathScan` IS the prefix sum, per group. Weights may be real-valued -- the
racetrack's `instances * affinity` needs no integer spelling -- the
distribution matches, and the surviving `row` column is NUMERIC, so
`transferAttribute` then gathers that asset's size/lateral/height.

The cost is the catch and it is a cost, not a capability: the pick
materialises N x R intermediate points. Measured 4,000 stations x 229 rows
= 916,000 points in 754 ms on one CPU cook; 1,000 stations in 238 ms. The
racetrack's ~354 placements x 229 assets is ~81,000 points, well inside
what a level that cooks ONCE can pay. If that ever stops being true the
primitive to buy is a per-point bracket search over a grouped cumulative
column -- O(N log R) instead of N x R -- and not before.

**The data half.** `DataItem` is `GeometryItem | ValueItem | InstancesItem`
and `DataValue` is `number | readonly number[] | string | boolean`. There
is no record, map or ragged-list item kind, so every kit structure --
`Record<CurvatureBucket, number>`, `{median,p10,p90}`, `KitBox[][]` -- has
to be flattened to attribute columns on a geometry item first. That is
already what `placementCloudInTrackFrame` and `poseLibrary` do for the
five ported stages, and it is the pattern the rest would follow: the kit
is 229 assets x ~16 numeric columns, which is a small cloud.

### The station process as a graph -- the shape the three probes imply, 2026-08-25

Not built. Written down because it FOLLOWS from the corrected gaps above
and would otherwise be re-derived from scratch. `makeStationsDetailed`
(`demos/racetrack/stations.ts:180-225`) is Neyman-Scott: supers uniform on
the lap, clusters gaussian about each super, instances gaussian about a
cluster drawn uniformly WITH REPLACEMENT, plus a uniform background
fraction, then a coverage repair. `FITTED`: density 0.95, superRate
0.0493, superSpreadW 14.95, clustersPerSuper 7.92, clusterSpreadW 4.99,
background 0.117.

EVERY GENERATIVE STEP TAKES THE SAME SHAPE, forced by the one thing that
IS still missing: `randomField` is keyed on an existing point and no
`count` param is field-capable, so nothing can size a generator from a
computed number. Over-generate a fixed cloud, then cut it to a budget
computed in-graph with `filterByExpression` against `index()`. That is the
pattern gap 2's probe measured (exactly 50 survivors from a computed
budget) and it applies three times here:

1. **Supers.** Over-generate a fixed maximum, cut to
   `round(superRate * lapLength)` -- the length coming off
   `pathResample.lengthAttr` on the primitive domain, promoted.
2. **Clusters.** `copyToPoints` a fixed MAX children per super, offset by
   a guarded gaussian scaled by `superSpreadW`, then cut per parent with
   `lt(index(), k)` where `k = floor(clustersPerSuper + u)` is the
   stochastic rounding the TypeScript does -- this is how a per-parent
   VARIABLE child count is spelled when the library has no such thing.
3. **Instances.** "Pick a cluster uniformly with replacement" is gap 4's
   recipe with equal weights: copyToPoints the cluster table onto the
   instance cloud, `pointsToPath` + `pathScan`, bracket against `u*total`.
   A uniform pick could also be `floor(u * clusterCount)` plus a gather,
   which is cheaper and worth trying FIRST -- the bracket is only needed
   when the weights are unequal.
4. **Background** is a plain uniform draw over the lap, cut to
   `round(total * background)`.
5. **Wrap** is `mod lapLength`. **Sorting** is not needed as a step: what
   wants order downstream gets it from `pointsToPath`'s `orderAttr`.
6. **`enforceCoverage`** is an iterative move-the-donor loop and belongs
   in a `repeatUntil`, which now exists -- but check the admission test
   first: it moves the donor whose NEAREST NEIGHBOUR is closest anywhere
   on the lap, which is lap-global, and lap-global is fine on the
   unbounded level and only there.

The open question is whether the fixed maxima can be chosen without making
the over-generation dominate. Supers are ~17 on a 350W lap and clusters
~8 each, so a max of 2x on both is ~270 intermediate points -- nothing.
The instance pick is the only step where N x R could bite.

### What a windowed per-sector repair would cost, measured 2026-08-24

The racetrack now streams its dressing on `cellMode: "path"` sectors, and
the cut was placed so that NO sector reads a neighbour: the whole-lap
repair runs once on the unbounded lap level and a sector only turns
settled placements into instances. That makes the union of the sectors
equal to the whole lap bit for bit, and it means the demo needs no halo
at all.

Moving the LOCAL repairs (Z-1's corridor, L-1's sightline cull) down onto
the sectors is a real future option, and it needs a halo. This is the
measurement that sizes one, taken before the design was fixed so nobody
has to re-derive it. Sixteen seeds, all 900 frames each, all 404,550
pairs, exact - no downsampling. Distances in half-widths.

- **No seed produces a genuine fold.** On every seed the minimum world
  distance beyond an arc threshold occurs AT that threshold, so world
  distance is monotone in arc separation there. Two arc-distant sections
  running physically adjacent - the case an arc window cannot cover, and
  the one `enclosure.ts` withdrew a published figure over - does not
  happen on this spline. That is a fact about the shipped generator, not
  a guarantee about any centreline.
- **The binding constraint is hairpin arc compression**, not folding: 20W
  of arc buys only 10.6W of world displacement round the tightest corner
  (seed 10).
- **For a 12W query radius the critical arc window is 24W** (worst case,
  seed 10; typical 13.8-17.9W). A +/-20W window FAILS - it is short by
  about 4W on the worst seed.
- **+/-60W is safe with 2.4x to spare.** The closest arc-distant approach
  beyond 60W is 28.7W (seed 8). No pair anywhere is within 20W of world
  distance beyond an arc separation of 38W.
- **L-6's ~6.2W enclosure ray never needs more than +/-7.4W.**

So: a windowed repair wants `aheadArc`/`behindArc` halos of 60W around a
20W sector - a window 7x the owned length. That ratio is the actual cost
of moving the repairs down, and it is why they stayed up.

### Measured but not taken: five hot-path costs in the new nodes, 2026-08-24

From a cleanup pass over the whole branch. Each was MEASURED on this box,
which is the expensive part and the reason they are written down rather
than left to be rediscovered. None is urgent — the paths are fast enough
at today's sizes — and each is a few lines.

- **`occlusionCull` defeats its own grid at scale.** The eye grid is built
  at `cellSize = widestChord` (~100 units) and queried at ~220, so
  `cellRadiusFor` asks for 3 rings, `useFullScan` fires, and every query
  linearly scans all 900 eyes. Break-even at 900; at 10,000 eyes it is
  3.5M distance tests per cook against ~450k. One line: size the cell at
  the max query radius, which the pass already computes. `pathCoverage`
  does exactly this.
- **The chord length is computed, discarded, then recomputed 58x.** The
  fan builder already takes a `sqrt` for all 7,200 chords to find
  `widestChord` and throws it away; the slab test redoes it per (point,
  eye, sample) — ~420k recomputes per cook for 7,200 distinct values.
  Fill a `Float64Array` in the build loop.
- **`pathCoverage`'s parallel threshold is cook-constant and computed per
  ray.** `to - from` is `(far - near) * dir` with unit `dir`, so it is the
  same number for all 900 points: ~270k evaluations where 900 would do.
- **`pathCoverage` rebuilds its candidate list by copying**, 250k-855k
  `push` calls per cook, and sizes the query radius from the binning
  THRESHOLD rather than the largest box actually binned — inflating the
  3x3x3 block and most of those pushes.
- **Z-1's decision tree is evaluated three times per point per round** in
  `dressGraph.ts`: `moved` expands to ~50 field nodes and is referenced by
  the fire flag and both downstream selects, when the flag column already
  holds the answer. ~70k redundant field evaluations per cook, ~420k at
  the round cap. `writeFalseEdges` already uses the column-reading form.

Ruled out by measurement, so nobody chases them: the `inside` closure in
`assets.ts`/`zones.ts` is 0 +/- 1.2 ns/call against an inlined control (V8
escape-analyses it away); there are no long-lived large-scope closures
anywhere in the branch; and the demo does no repeated I/O.

### ~~Z-3's band mix does not terminate on the enclosed kit~~ — FIXED 2026-08-24

Measured while surveying `dressLap`'s repair loop for the `repeatUntil`
port. On `DEFAULT_KIT` every seed settles in two or three rounds. On
`ENCLOSURE_KIT` every seed runs all twelve and reports
`converged: false`, and one repair is responsible: `repairBandMix` moves
exactly `n` placements every round, where `n` is the live placement count.
It is not converging slowly, it is burning its whole budget forever.

The mechanism, from the code rather than from the counter. The
replacement pool is filtered on an asset's MEDIAN lateral
(`assets.ts:493`), and `placeAsset` then draws that placement's lateral
from the asset's own DISTRIBUTION — so a redraw need not land in the band
it was selected for. The share it was fixing does not move, the same
first-in-band donor is picked again (`live().find(...)`, `assets.ts:486`),
and the round repeats identically. `dressLap`'s own comment records this
pair being fixed once against Z-1; it is not fixed, it has merely stopped
involving Z-1.

Why it is not urgent: the shipped demo runs the vegetation kit, so nothing
on the page shows it, and `converged` is reported rather than swallowed.
Why it is worth doing: a repair that cannot converge is a repair whose
budget is spent proving nothing, it is the reason the enclosed kit cannot
be dressed to its own rules, and it is the one member of `dressLap`'s loop
that a fixed-point node could not rescue as written — a body with no fixed
point does not acquire one by being iterated more carefully.

The fix is a mechanism question, not a threshold one: either select the
donor by the lateral it will actually be given, or accept the draw and
re-test rather than assuming the median stands for it.
**FIXED, and it took all three.** Checking that the draw landed stopped the
spin and left the bands broken — converged by giving up, `over` at 25%
against a 10-21% rule and `verge` at 0.6% against 4-12%. Pooling by the
asset's measured lateral RANGE rather than its median widened the eligible
set to assets whose instances are actually observed in the band. And the
band now supplies the lateral, within that asset's own reach, which is what
the `over` branch had always done with the height.

Enclosed kit: twelve rounds and `converged: false` becomes three to seven
rounds with every band inside its rule. Vegetation kit:
character-for-character identical — which is why this hid, since the
vocabulary the demo ships IS that kit's measurements. Guarded now by three
tests on the enclosed kit, each verified to fail against the old code.

WHAT TO TAKE FROM IT: the first fix satisfied the property that was being
complained about and broke the one nobody had stated. "It converges" and
"it works" are different claims, and a repair can be made to pass the
first at the cost of the second without anything going red.

### Probing a registered recipe assumes it is a `subgraph`, 2026-08-24

`src/cli/primitiveRun.ts:70` and `src/docs/primitives.ts:81` both
materialize a registered recipe with a hardcoded `type: "subgraph"`. A
recipe whose body exposes a wrapper's reserved pin is then refused by the
reserved-name guard — the same hazard fixed in `subgraphRegistry.ts` when
`repeatUntil` landed, where the inference now covers all three kinds.

It predates the loop node: a `forEach` body breaks these two identically,
and has been able to since `forEach` shipped. It is latent only because no
shipped primitive is a loop body. Fixing it means one shared inference
helper reachable from both the CLI and the docs generator, which is why it
was left rather than patched twice.

### Two arc lengths, one parameter: `pathPointAt` on a resampled path, 2026-08-19

Found while building `tests/trackDressing.test.ts`, and it cost most of a
debugging session because both wrong answers look right.

**The shape of it.** `pathResample` writes `curveU` measured on the INPUT
polyline's arc length, and reports `lengthAttr` for the same curve. But
the geometry it emits is the polyline through the SAMPLES, which is
shorter — a resample cuts corners, and the doc for `lengthAttr` already
says so. `pathPointAt` then offers two modes and neither one closes the
gap:

- `distance` measures along the resampled polyline, so a step computed as
  `lapLength / frames` is a fraction of a percent too long. On a 400-frame
  closed lap the error accumulates and the slide lands two frames ahead by
  the far side. Measured: a corner model that found 15 corners reported 24.
- `fraction` measures 0..1 of the resampled polyline, and `curveU` is
  0..1 of the input's. Same disagreement, differently spelled, and it
  cannot be fixed by scaling because the two parameterizations differ
  NON-uniformly — they agree on straights and diverge wherever the curve
  bends, which is exactly where a corner rule reads them.

**Why it is not just a docs problem.** Both modes are individually
correct and documented. What is missing is a way to say "the sample one
step further along", which is an INDEX operation and has no spelling at
all. The workaround that shipped is a STATION RING: give every frame a
position on a circle whose circumference is the lap, and a neighbour
becomes a nearest-point transfer, exact by construction and wrapping at
the seam for free. It works, it is cheap, and it is a strange thing to
have to invent — laying a scalar out as geometry so that "nearest" can
answer a question about ordering.

**What a fix would look like, and why it is not scheduled.** The honest
one is for `pathResample` to publish the parameterization it emits — a
`sampleU` alongside `curveU`, or an opt-in `resampledLengthAttr` — so a
caller can convert. Cheap, and it only helps a caller who already knows
the trap exists. The better one is a neighbour-along-a-path operation,
which is the same missing primitive `pathScan` closed for accumulation:
`pathScan` gave the grammar a way to see BEHIND itself along a curve, and
nothing gives it a way to see one step ahead. That is a node, not a doc
fix, and it should wait for a second caller — the station-ring workaround
is fine, and a node designed against one use is a node designed against
its author's imagination.

**The related limit, already known and confirmed by this build:** there is
no in-cook global reduction. `attributeReduce` writes the detail domain
and a point-domain field cannot read it, so nothing that normalises
against a total — a share, a mix, a budget — can close inside one cook.
The track-dressing calibration lives in a host loop for exactly this
reason, and that is the right place for it; recording it here because it
came up as a question three separate times while building.

### Lookup by a scalar key, and the three embeddings that stand in for it, 2026-08-19

Surfaced by a cleanup review of the track-dressing build. Recorded rather
than built, because the shape wants a second consumer outside that one
graph before it is designed — but the "wait for a second caller" note on
the entry above is already answered here, and by three callers rather than
one.

**What the graph does three times.** `transferAttribute mapping:"nearest"`
is the only thing in the library that can answer "which element of A
corresponds to element of B", so the track graph makes a scalar into a
POSITION and lets a 3-D nearest-point search answer a 1-D question:

- CDF lanes: each profile's frames re-embedded at `(cdf, laneIndex * 10, 0)`,
  so one transfer serves three inverse-transform draws without them
  bleeding into each other.
- the lap ring: every frame at `(cos(2*pi*u), sin(2*pi*u)) * R`, so
  "one frame further on" and "four half-widths back from here" are
  nearest-point queries that wrap correctly at the seam.
- the station ring, again at a different radius, so a gap between two
  placements measures along the lap instead of through space.

**What it costs.** Each embedding destroys `P`, so nothing spatial can
follow one without restoring it. Each pays a full 3-D uniform grid build
over data that is 1-D by construction. And the separations — `LANE = 10`,
`RING_R = 1000` — are correctness constants defended by a comment: a CDF
gap above the lane pitch, or a ring whose chord error exceeds the frame
spacing, silently returns a neighbour that is merely close rather than
right. Nothing checks either.

**The shape a fix would take.** A `keyAttr` (and a `period` for the cyclic
case) on `transferAttribute`, or a `sampleByKey` node: match a
destination's scalar to the source element with the nearest scalar, in one
sort or one hash rather than a spatial index. It subsumes all three uses
and it is honest about what is being asked.

**The related narrowing, same review.** `transferAttribute` moves exactly
ONE attribute per node, which is why the same graph hand-packs `pack0..3`
as four tuple-4 columns and carries an `unpack3` helper: purely to amortise
lookups. The packing is an undocumented layout shared across roughly
fifteen call sites, and heterogeneous types cannot join it at all — the
`archetype` string never can. Widening `name` to accept a list would delete
that layer outright and is a much smaller change than the key lookup.

**Two smaller ones, same origin.** `pathScan` publishes `totalAttr` on the
primitive domain but not the normalised scan, so the CDF its own docs name
as the reason it exists costs a promote and a divide — and the promote is
`mode:"average"`, which is correct only because each point belongs to one
polyline. A `normalize` option would remove both nodes and the hazard.
And the field grammar has no indexed lookup into a small constant table,
which is why the same graph packs ten ternary digits into one f32
(`encodeCommittedStretches`) to make a ten-entry table readable inside an
expression; the alternative, an inline `param` per entry, multiplies by the
seven call sites that read it.

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

- **A lap-periodic density envelope for placement density along a
  track.** Measured 2026-08-20 to 08-22 in the retired racetrack demo.
  **Recommendation: do not schedule, and do not reach for it again.** It
  reproduces the small-window clumping statistics and fails the shape of
  them: read as an index of dispersion across window widths, one lap
  uncorrected, at 2 / 4 / 8 / 16 / 32 / 64 / 128W --

  ```
    envelope  1.94 / 2.49 / 3.51 / 5.68 / 9.41 / 16.90 / 35.99
    source    1.48 / 1.81 / 3.01 / 5.03 / 6.63 /  5.98 /  5.11
    null      1.00 / 1.09 / 1.02 / 1.00 / 0.95 /  0.83 /  0.79
  ```

  The source climbs to 5 or 6 by 16-32W and STOPS, because clumps stop
  being clumps above the size of the largest one; a lap-period swell keeps
  climbing, because a swell puts its variance at the largest scales there
  are. A single number cannot see this - the same envelope makes the
  per-archetype gap CV read 1.80 against a measured 1.78, correct to two
  decimal places by a mechanism the source does not use. `null` is a
  Poisson process simulated through the identical pipeline rather than
  assumed to be 1.0, which is why it drifts under 1 at the wide end.

  Five replacements were tried and none shipped. Deleting the envelope
  alone flattens the curve to about 1.9 at every window - the clustering
  carries the small scales and nothing carries the middle. Super-clusters
  on a REGULAR grid fall away to 0.27 at 128W, because regular spacing
  suppresses large-scale variance rather than adding it. Modulating at the
  super scale rather than the lap scale gives a PEAK, not a plateau; any
  wave does, because a periodic rate averages out in windows wider than
  its period, so only clumps of finite extent, scattered, plateau.
  Duplicating each anchor into a super-cluster gives the right SHAPE and
  inflates per-archetype cluster size from 1.5 to near 8, because an
  archetype is chosen per anchor. A full rewrite with the archetype drawn
  per PLACEMENT scored 15 of 18 and read 4.18 at 2W against a measured
  1.36 - and the spec team rebuilt it independently and read 4.21, so it
  is not an implementation slip.

  The lap-scale variance is not the vocabulary at all: it is the profile
  split, and the mechanism is monotone in concentration. Neutralised
  (`cluster` = 1, `rate` equal) at 128W, a 6/6 split reads 12.32, the
  shipped 9/3 reads 22.48, and forcing all twelve rows onto one profile
  reads 44.86 (all `flat`) or 45.25 (all `built`). One lap-periodic
  envelope is built per profile, each with its own phase, so concentrating
  the mass puts more of it on one phase and the swells add instead of
  partially cancelling. A change confined to the CROSS-SECTION therefore
  moved a LONGITUDINAL statistic, which nothing about a kit should.

  Superseded by the near-Poisson generator that reproduces both the
  cluster tables and the curve. Full extraction, with the twelve-row
  archetype table and 55 numbered findings, archived alongside the demo -
  see the deletion commit for the refs.

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

## What the retired racetrack established

Five thousand lines of demo and two suites were deleted once the road work
superseded them. What they COST to establish is kept here; the code itself
is archived (see the deletion commit). These are findings rather than
plans, which is why they are not in Stretch - nothing will act on them
directly, and re-deriving any of them is a week.

**Descriptive statistics are not a specification.** Cluster counts, mean
sizes and size distributions obtained by grouping placements at a fixed
threshold are VALIDATION statistics, and building a generator from them
double-counts the clumping. At a 1.5W threshold and roughly one placement
per W, that threshold chains most neighbours together whatever the process
produced: a homogeneous Poisson null reads 21.3 clusters per 100W against
a measured 19.3, mean 4.38 against 4.90, single-instance clusters 24%
against 23%. The information in such a table is the EXCESS over the null,
which is small and lives in the gaps rather than in the counts. The single
most transferable thing the demo found.

**A "is it clumped?" validator can be blind to clumping.** Per-archetype
gap CV reads correlation in archetype IDENTITY, not whether placements
cluster: shuffling labels while holding stations fixed takes the source
from 2.12 to 1.17 and the generator from 2.05 to 1.24, and a 36-setting
sweep upstream reaches 1.13 at best. An independently assigned archetype
is a random thinning of the whole process, and random thinning drives any
clustered process toward Poisson - so no cluster process can supply what
the metric is reading. This invalidates a family of validators, not one.
It survived only in a branch commit message; nothing in the shipped tree
recorded it.

**Clustering alone has a ceiling.** A cluster process with exponential
gaps and a geometric cluster size gives `CV = sqrt(2m - 1)`, which at a
measured mean cluster size near 1.5 caps at about 1.41 - short of the
measured per-archetype median of 1.78. The formula is right; it describes
a HOMOGENEOUS process, and the material is not homogeneous.

**Marginals reproduce every marginal and no joint.** A corridor predicate
is a statement about lateral offset and width TOGETHER. Drawing them
independently puts about 24.9% of side placements over the corridor
against a measured 14.8%. A Gaussian copula at each archetype's measured
rank correlation buys back half a point on one kit and nothing on the
other, because the median |r| is only 0.20 and 0.13. Three to four points
of over-intrusion is the irreducible price of holding art as marginals;
the fix is a boolean subtract against the swept corridor volume, which
trims the art instead of moving the anchor.

### How to measure a generator - rules that cost something to learn

- **State the population before comparing anything against it.** Before
  publishing a pooled statistic, fit it per member and check the members
  look like the pool; when reporting a quantity NEARLY the published one,
  recompute the published one from your own intermediates and assert it
  reduces. Six method errors in one two-party loop were all this, and
  every one was caught by the other party opening the artefact rather than
  re-reading a summary. A per-archetype median of 1.78 and a per-family
  2.21 are the same answer at different granularity, not a disagreement.
- **A statistic with no null cannot be interpreted.** Prefer a curve with
  a null at every point over a number with a reference at one. The
  statistic this replaced lost three references in turn: a source range
  read as a target, a decomposition that assumed independence when
  clustering was the whole point, and a reshuffle that was a BIASED null
  because it let clusters land on top of each other where the grouping
  threshold forbids it.
- **Simulate the null through the identical pipeline; never assume its
  value.** The "obvious" 1.0 is wrong at both ends for different reasons.
- **Never A/B two samplers through a correction loop.** The loop drags
  both toward the same target - which is how an earlier A/B between two
  bounded shapes read as a wash when one of them was eleven points out.
  Sample the raw draw with the loop OFF before believing anything.
- **Turn each pass off and require the metric that names it to FAIL.** A
  suite that passes is worth nothing until it has been shown to fail: an
  exemption that quietly matched everything, a count taken from the thing
  it was meant to verify, a metric wired to a constant - all of those
  pass. The subtler half is the exception: one metric was deliberately
  EXCLUDED from that list because it passes with its own pass switched
  off, so it does not OWN that pass and claiming otherwise would have been
  a green assertion about nothing.
- **Score a pass with a different algorithm than the pass uses.**
- **Pin a number you believe is WRONG, two-sided.** It should fail if the
  shortfall grows AND if someone fixes the mechanism; the second is the
  point. The comment a set of these replaced had quietly drifted from the
  code it described - a finding written into a comment rots, a two-sided
  pin does not.
- **A control that confirms the alternative hypothesis is not a control.**
  Forcing full concentration and observing every configuration at or above
  the mixed one was read as exonerating the profile assignment. Under a
  mechanism monotone in concentration, that result is exactly what the
  assignment being responsible looks like.

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

### The station port cannot be bit-identical, and why that is the design, 2026-08-25

Measured by reading `stations.ts` against the field grammar, before building
anything. It overturns the unstated assumption in the sketch above -- that a
graph port is a refactor whose output can be diffed against the old lap.

**`makeStationsDetailed` runs on ONE sequential PCG32 stream.**
`stream(seed, 0x5741)` is created once and every stage draws from it in
written order: the super positions, then per super one draw for the
stochastic rounding `k = floor(clustersPerSuper + u)`, then two draws per
cluster for its gaussian, then THREE per instance (one to pick a cluster,
two for the gaussian), then one per background placement. Change how many
draws any stage consumes and every station after it moves.

**A graph cannot reproduce that, and the reason is structural rather than
incidental.** `randomField` is keyed on a point's IDENTITY -- its stored
position and `seed` column -- not on a position in a stream. That is the
property that makes a cook order-independent and partitionable, which is
the library's hard invariant; a node that consumed a shared sequential
stream would be a node whose output depended on how many points some other
node had already asked about. So the port draws `hashCombine(seed, i, ch)`
per point and produces a DIFFERENT lap. Not a worse one -- a different one.

**Therefore the port re-baselines every measured figure downstream**, and
"verified" has to mean something other than a diff. What makes that
tractable is that `racetrackStations.test.ts` was already written as
DISTRIBUTIONAL gates rather than golden values, because the process was
fitted to a published curve rather than invented:

- the dispersion curve inside the source's p10-p90 at all seven windows
- the shape gate: climbs through 4/8/16/32 W, then `at(128) < at(32)*1.15`
- `at(1.0)` for a Poisson control, proving the instrument works
- D-1's budget hit EXACTLY (`round(0.95 * lapW)`), which is arithmetic and
  must survive unchanged
- D-4's floor: 85% within 2 W, no gap over 25 W
- the repair fires at least once across seeds 1-8 and every move it makes
  is non-removable

Those are the acceptance criteria for the port. Five of the six are
properties of the PROCESS, not of a particular draw, so they transfer.

**Two constraints the sketch above did not record:**

1. **The count is exact, not Poisson**, and deliberately: "letting the
   total float adds variance at the lap scale, which is the one place the
   source has none". So the graph must land on exactly
   `round(density * lapW)` placements -- which is why a field-capable
   `count` resolved on the path's primitive domain is the right primitive
   and a per-cell density is not.
2. **Sorted order is load-bearing beyond the station list.** `dressLap`
   walks the sorted stations by index and feeds that index to
   `placeAsset(pool, bucket, seed, i)`, so the i-th station gets the i-th
   asset stream. Reproducing a dressing needs the sorted ORDER, not just
   the set -- and after the port the order is different, so the asset
   choice re-baselines with it. That is one more reason asset choice
   should move into the graph in the same pass rather than a later one.

**What the port buys, stated plainly so the cost above is judged against
something.** The lap level stops needing a TypeScript prelude, which is
the whole point of the campaign: a game can then generate a track from a
serialized graph and a spline, with no demo code in the loop.

### Two nodes the port needs, and why each is a node rather than a recipe, 2026-08-25

Both were checked against the shipped library before being written, because
this branch has repeatedly recorded a "gap" that turned out to be a node
nobody had read.

**`pointScatterOnPath` -- scatter N points along a path by arc length.**
Confirmed missing: every arc-length placer in the library is
deterministic-even (`pathResample` and `splineSample` divide the length,
`arcTile` steps a fixed spacing, `pathSegments` is one per segment). The
composed recipe exists and the corpus already ships it as
`graphs/basics-stations-on-a-path.json` -- `pointLine` for the count, a
`setAttribute` writing a random station, then `transferAlongPath` sampling
`"P"` to move the cloud onto the curve -- so this node buys no NEW
expressive power on its own. What it buys is the COUNT.

The four existing source nodes take no geometry input, and that is exactly
why none of their params is field-capable: `fieldCapability.test.ts` clause
2 forbids it, because a field needs an element to be read per and a source
has none. A path-input scatter has the path's primitive domain to resolve
on, so `count = round(superRate * length)` is expressible -- reading the
per-primitive length column, with no TypeScript deciding the number. The
precedent is exact: `pathResample.spacing` is field-capable and decides the
output count, resolved per primitive. `docs/authoring.md` states the rule:
"The question is never what the param decides. It is whether an element
exists to read it per."

Clause 1 of that same test forces the param's TYPE: only `f32`/`vec3`/`vec4`
may be field-capable, since a field resolves to one f32 column. So `count`
is an `f32` that rounds, not an `i32`.

**`transferByIndex` -- read a source geometry's attributes at a per-point
computed index.** Confirmed missing: `transferAttribute` offers `nearest`,
`uv` and `raycast`, and every one asks its question in SPACE. There is no
way to say "read source point number i, where i is a number I computed".
This is the "pick a cluster uniformly with replacement" step, in O(N)
rather than the N x R bracket the corrected gap 4 measured (916,000
intermediate points for 4,000 stations x 229 rows).

It is a separate node rather than a fourth mapping for the reason
`transferAlongPath`'s header already gives about itself: an index is not a
spatial query, and the gap between the two opens exactly where a curve
folds. A node whose param list decided which of two incompatible questions
was being asked would be one node in name only.

**What was NOT added, and why.** `copyToPoints` makes exactly
`source x target` copies, so a per-parent VARIABLE child count -- the
`k = floor(clustersPerSuper + u)` step -- has no direct spelling. The
workaround is a fixed maximum plus a cut on a per-block index, with the
per-super `u` computed on the supers cloud and carried down by
`targetNames` so every copy of one super agrees about its own k. At ~17
supers and a max of 16 that is ~270 intermediate points, which is nothing.
A field-capable per-target count on `copyToPoints` is a real capability and
probably a good one, but it makes a central node's output size
data-dependent, and it should be bought on a measurement rather than on a
hunch. The cut idiom goes in first; if it proves painful, that is the
evidence.

### The graph and TypeScript station processes, measured side by side, 2026-08-25

Taken when an end-to-end test failed and the obvious reading -- "the
graph process is wrong" -- turned out to be false. Both processes run on
the same cooked lap (`lengthW` 346.8) at the shipped density.

| seed | TS worst gap (W) | TS moves | graph worst gap (W) | graph moves |
| --- | --- | --- | --- | --- |
| 1 | 14.29 | 0 | 7.43 | 0 |
| 2 | 13.36 | 0 | 8.78 | 0 |
| 3 | 11.78 | 0 | 14.19 | 0 |
| 4 | 14.68 | 0 | 9.62 | 0 |
| 5 | **31.65** | **1** | 17.53 | 0 |
| 6 | 7.78 | 0 | 24.56 | 0 |
| 7 | 15.31 | 0 | 21.35 | 0 |
| 8 | 10.05 | 0 | 12.91 | 0 |

Both produce **329 placements on every seed** -- D-1's budget is exact
arithmetic and the port reproduces it. The gap distributions overlap
almost entirely: 7.78-31.65 against 7.43-24.56.

**D-4's repair is a RARE EVENT at the shipped density, in both.** The
fitted TypeScript process crosses the 25 W bound on one seed in eight;
the graph process on none of the eight measured. That is a fact about
the process -- 329 placements on a 347 W lap average 1.05 W apart, and a
25 W hole is a long way into the tail -- not a difference between the two
implementations.

**So a test asserting "the repair fires" at density 1 is asserting a rare
event on a small sample**, and passes or fails on which seeds it picks.
`racetrackStations.test.ts` gets away with it over seeds 1-8 because its
particular draw happens to include s5. That is worth knowing about the
existing suite: the assertion is sound but it is one unlucky re-tuning
away from being flaky, and nothing says so where it is written.

The port's own suite exercises D-4 where it is REACHABLE instead:
hand-built fixtures with a stated hole, and a sparse lap. Density sweep
on the same lap, four seeds each:

| density | worst gap before (W) | total moves |
| --- | --- | --- |
| 1.0 | 14.19 | 0 |
| 0.8 | 14.19 | 0 |
| 0.6 | 17.24 | 0 |
| 0.4 | 35.28 | 1 |
| 0.3 | 48.92 | 1 |
| 0.2 | 48.92 | 6 |

Density 0.2 is far outside D-1's accepted band (0.6-1.2 per W) and is not
a lap anyone would ship. It is a lap that MAKES gaps, which is what the
rule is for, and it is deterministic.

### Where the prelude stands after the station port, 2026-08-25

`main.ts` now cooks the stations as a graph and hands them to `dressLap`
through a new `DressOptions.stations`. What is still TypeScript on the
lap level, in the order it would have to move:

1. **Asset choice** (`placeAsset` per station, weighted by the curvature
   THERE). The big one, and it re-baselines with the stations because it
   is indexed by SORTED station order -- the i-th station draws the i-th
   asset stream. Rank is now computable in-graph (`pathScan` exclusive of
   a constant over the ordered ring), so the index exists; what does not
   is the weighted draw from a per-bucket pool, which is gap 4's
   `pointsToPath`/`pathScan` bracket recipe, or `transferByIndex` against
   a cumulative column.
2. **The corner model and marker vocabulary** (L-2/L-3), which
   `writeCurveFrame` + `pathRuns` already answer per PLAN's slice-2
   table.
3. **Landmark uniqueness (L-4) and the band mix (Z-3)**, both list
   arithmetic over the whole lap.
4. **The frame lookup**, which `transferAlongPath` now answers.

The seam is deliberately an OPTION rather than a switch inside
`dressLap`: cooking is async and `dressLap` is not, and making it async
to reach a cook would ripple through a dozen synchronous callers for no
benefit. The suites that call `dressLap` without stations keep measuring
the fitted process, which is what their figures were fitted against.

### Asset choice, decomposed — every draw now has a spelling, 2026-08-25

Written down because the spellings did not exist when the slice-2 table
above was drafted, and the conclusion would otherwise be re-derived.

`placeAsset` (`demos/racetrack/assets.ts:129`) makes FOUR independent
draws per station, each from a different salt off the same
`rand(seed, index, salt)` — 0x11, 0x23, 0x37, 0x41. In a graph those are
four distinct `randomField` KEYS, which the gaussian work already
measured as independent (Pearson r 7.6e-4) with a control proving the
estimator can report otherwise.

| # | draw | what it needs | spelling |
| --- | --- | --- | --- |
| 1 | WHICH asset | a weighted pick over ~229 assets, weights varying by the CURVATURE BUCKET at that station | the cumulative-column bracket (corrected gap 4), or `transferByIndex` against a prefix-summed weight column |
| 2 | lateral `t` | a quantile drawn from THAT asset's own measured lateral distribution | `transferByIndex` gathers the chosen asset's table columns, then interpolate |
| 3 | height `h` | same, from its height distribution | as above |
| 4 | which side | a biased coin at the asset's own `rightOfTravel` | `lt(randomField(k), gathered rightOfTravel)` |

**The curvature bucket is no longer a problem.** `writeCurveFrame`'s
`curvatureName` puts a radius column on the lap's own points, and
`transferAlongPath` reads it AT each station's arc position — which is
exactly the node this branch added and exactly the question it answers.
Bucketing is then a `select` ladder over thresholds.

**The pick is the only step whose COST could bite.** It materialises
stations x assets intermediate points: ~354 x 229 = ~81,000 here, which
gap 4 measured at well inside what a level that cooks once can pay
(1,000 stations x 229 rows = 238 ms). If a longer track ever makes that
false, the primitive to buy is a per-point bracket search over a grouped
cumulative column — O(N log R) instead of N x R — and not before.

**The kit has to become a cloud first.** `DataValue` has no record or
ragged kind, so `Record<CurvatureBucket, number>` and `{median,p10,p90}`
must be flattened to columns on a geometry item: 229 assets x ~16
numeric columns, plus the string asset id. That is the same shape
`poseLibrary` already builds, and `spawnInstances` already needs a string
id column, so the id survives the whole chain as data rather than being
re-derived.

**Order dependence, stated once.** `dressLap` feeds `placeAsset` the
station's INDEX IN SORTED ORDER, so porting this re-bases with the
stations. Rank is now computable in-graph — `pathScan` in `exclusive`
mode over a constant-1 column on the ring `pointsToPath(orderAttr)`
builds — so the index exists; it just will not be the same index the
TypeScript saw, which is the same re-baselining the station port already
accepted.

**Do NOT port `reserveMarkers` in the same pass.** L-2/L-3 reserve three
asset ids for corner markers BEFORE anything is dressed, and the pool
`placeAsset` draws from is what is left. That is a set difference over
the whole kit, it is cheap, and it is the kind of lap-global bookkeeping
that belongs with L-4's uniqueness rather than with the per-station draw.
Keeping it in TypeScript for one more pass keeps this unit to one rule.

### Asset choice shipped, and what the pick actually cost, 2026-08-25

`demos/racetrack/assetGraph.ts`. The four draws `placeAsset` makes are
four `randomField` keys, and the page now cooks stations, D-4's repair
and asset choice in ONE graph — `cookLapPlacements` — because the
endpoint is a lap LEVEL and a level is one graph. `dressLap` gained
`DressOptions.choices` beside `stations`, an index into the pool
`reserveFor` answers rather than an asset object, so a caller cannot
hand back something L-2 reserved.

**The pick is four nodes, and every one of them already existed.**
`copyToPoints` stamps the 226-row table onto every station carrying the
station's own uniforms through `targetNames`; `pointsToPath` groups by
`targetIndexAttr`; two `pathScan`s (exclusive and inclusive, the second
with `totalAttr`) give a bracket per copy; `filterByExpression` keeps the
one containing `u * total`. No new library node was needed, which is
worth recording because the plan's decomposition expected to need one.

**Measured, on the shipped vocabulary at seeds 1-3:**

| | |
| --- | --- |
| placements | 355-358 (1.024-1.032 per W, inside D-1's 0.6-1.2) |
| distinct assets over 6 laps | 224 of 226 |
| pick shares vs weights (4000 draws, 3 assets + 1 zero) | 0.0975/0.2950/0.6075 against 0.1/0.3/0.6, and the zero exactly 0 |
| lateral vs `drawQuantile` on the same uniform | worst 8.3e-7 |
| even side lean over 2000 draws | 49.6% right |
| mean straight-affinity of what was picked | 2.075 on straights, 0.159 in bends |

**`drawQuantile` is TWO lines, not four.** The outer two branches are
algebraically the same lines as their neighbours — below p10 it continues
the p10-to-median slope, which IS that segment evaluated outside its
range. The field spells it as two pieces meeting at the median, and the
8.3e-7 agreement above is against the four-branch original, so this is
measured rather than argued.

**The curvature bucket had to become curvature, not radius.**
`transferAlongPath` interpolates and has no nearest mode, and a straight's
radius is Infinity, so blending it with a finite neighbour gives Infinity
or NaN across the whole neighbourhood of every straight. The reciprocal is
taken on the PATH, once per frame, and the cuts inverted are the same
cuts. It is inexact only for a frame sitting precisely on 40/15/7 W,
because 1/40 is not representable in binary.

**The naive bracket passes every test, and the exact one shipped anyway.**
`cum <= x < cum + w` reads a bracket's top from two already-rounded f32
numbers while its successor's bottom is the f64 partial sum rounded once,
so the brackets do not tile — they overlap at some boundaries and part at
others. Substituting it passes all sixteen tests in
`racetrackAssetGraph`, including a duplicate-station guard, over six laps.
Measured honestly: the discrepancy is about 1e-7 of a station's total, so
it decides one draw in ten million and a few thousand draws cannot see
it. Two scans cost one extra node and make the tiling exact by
construction; that is the whole argument, and it is not "we found a bug".

**A broken fixture read exactly like a broken sampler.** The synthetic
station cloud first wrote positions with `set(i, [x, y, z])`, whose second
parameter is a scalar and whose third is a component index — so every x
became NaN, every point identity became the same one, and `randomField`
answered one constant for the whole cloud. The suite then reported a pick
that always chose the heaviest asset and a coin that always came up
right. Both readings were of the fixture. `setTuple` is the API, and the
lesson is the one this file keeps re-learning: a degenerate input is
indistinguishable from a degenerate rule at the assertion level.

### Where the prelude stands after asset choice, 2026-08-25

Still TypeScript on the lap level, in the order it would have to move:

1. **The corner model and marker vocabulary** (L-2/L-3), which
   `writeCurveFrame` + `pathRuns` already answer per the slice-2 table.
   `reserveMarkers` goes with them: it is a set difference over the whole
   kit, done before anything is dressed, and it belongs with L-4's
   uniqueness rather than with the per-station draw.
2. **Landmark uniqueness (L-4) and the band mix (Z-3)**, both list
   arithmetic over the whole lap.
3. **The frame lookup**, which `transferAlongPath` now answers.

### What independent verification found in the asset choice, 2026-08-25

Four things the sixteen tests missed, each found by mutating the module
and watching the suite stay green. Recorded because the pattern is the
one this campaign keeps hitting: a suite that measures the right
QUANTITIES can still leave a whole factor unmeasured.

| # | mutation | impact on 987 placements | caught? |
| --- | --- | --- | --- |
| 1 | swap the easy and medium affinity columns | 388 assets change, 181 flip side | no |
| 2 | height becomes the constant 0 | 987 of 987 heights change | no |
| 3 | height read from the LATERAL quantiles | 987 of 987 change | no |
| 4 | drop both `abs` on the lateral | 0 on this kit, real on one with p10 near 0 | no |

**Why 1 escaped:** the only bucket test used radii 5 / 39 / 41 against a
pool whose bucket-sensitive asset weighed `[0, 1, 1, 1]` — easy and
medium the same number, so the two rungs were interchangeable — and the
"declines into bends" gate lumps tight and medium together against
straight. Fixed with four one-hot assets and ten radii straddling every
cut from both sides, so each bucket has exactly one legal answer.

**Why 2 and 3 escaped:** the helper returned `h` and nothing ever
compared it. `h` drives `resolveCorridor`, `fitsOverhead` and every band
statistic, and on the shipped lap it runs -3.31 to 5.68 W, so this was
not a rounding-scale gap. Fixed by publishing `uHgt` alongside `uLat` and
asserting the same `drawQuantile` agreement, plus that the two answers
are not the same number.

**The pool seam had a silent-corruption hazard the range check could not
see.** `reserveFor` answers a pool of the SAME LENGTH for every seed and
varies only which three assets it held back, so cooking against seed 1's
pool and dressing at seed 2 leaves every index in range and names a
different asset at 23 of 329 placements — a normal-looking lap.
`AssetChoice` now carries the kit's own asset id and `dressLap` compares
it, which turns the whole class into a throw for one integer per
placement.

**Two claims in the module's own prose were wrong and are corrected.**

- The f32 cut boundary is *deterministic*, not "either side": `f32(1/40)`
  is 0.02500000037, above `1/40`, so a radius of exactly 40 W failed `le`
  and landed in easy where `bucketOf(40)` answers straight. The cuts are
  now `Math.fround`ed, which makes the cut itself exact and leaves a
  sliver of relative width ~4e-8 on the other side.
- What actually moves track is the TRANSFER, not the ladder: nearest-frame
  against interpolated puts **12 of 329 stations (3.6%) in a different
  bucket** on the shipped lap. Interpolation is the more defensible
  reading and the port re-bases anyway, but "the cuts inverted are the
  same cuts" is a claim about the ladder alone and was being read as
  agreement two orders of magnitude stronger than the measurement.

**And one about `randomField` that was true for the wrong reason.**
`randomField` hashes `(ctx.seed, keyHash, pointIdentity)` where `ctx.seed`
is the NODE's derived seed — so the same key written twice under two
names measures r = -0.0009, not 1. The four draws are independent because
they are on four nodes; the key names buy readability and stability of
intent. Pairwise |r| over 20,000 points: 1.3e-4 to 9.5e-3 against a noise
floor of 7.1e-3, with controls returning 1, -1 and 0.035 for a deliberate
3.5% blend.

**Corroborated, not corrected:** the `copyToPoints` -> `pointsToPath` ->
`pathScan` ordering chain, measured three independent ways; the f32
tiling identity `cumHi[i] === cumLo[i+1]`, 0 mismatches over fractional
weights spanning eight orders of magnitude; and the two-line quantile
algebra, worst 5.15e-16 relative in f64 over 1.4M points. The naive
bracket mistiles **17.5% of boundaries** on random f32 weight tables
spread over four orders of magnitude (38,878 gaps, 40,658 overlaps) —
which is the evidence the earlier entry said it did not have, and it
still changes 0 of 987 placements on this vocabulary.

### The corner model, and the first port that does not re-base, 2026-08-26

`pathRuns` gained `reduce: "sum" | "min" | "max"` and
`demos/racetrack/cornerGraph.ts` derives the corners as nodes.

**The library gap was named in this repo's own prose.** `corners.ts`'
header says the corner model is the graph's *except* that "the tightest
radius in a run is a MINIMUM, and a segmented running total is a sum", so
that one quantity stayed a hand-written loop. A segmented minimum is the
same walk with a different fold; `attributeReduce` cannot help, because it
collapses a whole domain to the detail domain and cannot group.

**This one is checkable EXACTLY, and that is new.** The station process
and the asset choice both draw from `randomField`, which keys on point
identity rather than on a stream position, so neither could reproduce its
TypeScript lap and both had to be judged distributionally. A corner is
geometry -- same frames, same threshold, same arithmetic, no draw
anywhere -- so `racetrackCornerGraph` asserts EQUALITY, corner for corner,
on the generated circuit at four seeds plus a stadium, a seam-straddling
bend and a circle.

**Three falsifications, and the third found a real defect.**

| mutation | caught |
| --- | --- |
| `reduce: "min"` -> `"max"` | yes -- the sentinel lands in every tightest radius |
| drop the `anyStraight` guard | yes -- the circle grows a corner nothing turned into |
| mirror the `outside` sign | **NO** |

The mirrored sign is the failure `corners.ts` warns about by name: "a
mirrored turn direction produces a lap where every marker is on the wrong
side while every count, share and distance still passes". It escaped
because `cookCorners` re-derived `outside` from the turn in TypeScript, so
the graph's own `cornerOutside` column was written and never read. **A
column nothing reads is a column nothing tests.** The bridge reads the
column now, and the suite checks it twice -- against the loop, and against
the relation `outside === -turn`, so both sides flipping together still
fails.

**And one claim of mine was wrong.** I wrote that masked frames are never
in a corner's run. They are: a BACKWARD run ends at its flag INCLUSIVE, so
the first straight frame after a corner is in the run that holds it. It
survives a minimum harmlessly -- a straight's radius is at or above 12 W
and every corner frame's is below -- so the mask buys nothing for the fold
this stage uses, and the comment says that now instead of the opposite.

**What the library change cost, and what it was checked with.** 12 new
tests; `reduce: "sum"` byte-identical over a 1920-case differential fuzz
against an independent transcription of the previous loop (240 randomised
paths x inclusive/exclusive x forward/backward x wrap on/off, compared as
raw bytes so NaN counts), **with a negative control** proving the
comparison can report a difference. The identity is `attributeReduce`'s --
0 for a sum, +/-Infinity for a min or a max -- and it was extended to the
output column's DEFAULT, so a point in no polyline reads the fold over no
values rather than a zero that would compare tighter than every real
radius.

**A false premise in my own brief, corrected by the agent.** I wrote that
forward-inclusive and backward-inclusive give the same run total. They do
not, and not because of `reduce`: forward a flagged point OPENS its run
and backward it CLOSES one, so the two directions do not partition the
path into the same runs at all -- they sit one point apart. `direction`'s
description says so outright now.

### Where the prelude stands after the corner model, 2026-08-26

1. **The marker vocabulary** (L-2/L-3's placements, and `reserveMarkers`).
   Where each marker GOES is four independent draws per corner and ports
   like the asset choice did. What does not is `placeCornerLanguage`'s
   convert-or-add: an order-dependent greedy walk over a mutable list that
   recomputes which asset is most repeated after every change, and can
   DELETE. That is D-4's class of rule and wants D-4's treatment -- one
   move per `repeatUntil` round. `reserveMarkers` is three weighted draws
   WITHOUT replacement, which is its own small problem.
2. **Landmark uniqueness (L-4) and the band mix (Z-3)**, both list
   arithmetic over the whole lap.
3. **The frame lookup**, which `transferAlongPath` now answers.

### The marker vocabulary, and the seam that hid a bug, 2026-08-26

L-2's markers and L-3's rulers are decided by nodes.
`cookLapPlacements` now adds them to the SAME graph as the stations and
the asset choice, because the endpoint is a lap level and a level is one
graph -- `Graph` memoizes per node, so the lap path is resampled once and
the corner model read once for all three stages.

**What moved and what did not.** The corner language splits cleanly in
two, and only one half is portable:

| | |
| --- | --- |
| DRAWN, and now nodes | a marker's distance back from the entry, its lateral quantile, its height; a ruler's shared lateral |
| EXACT, and unchanged | `rulerStations` -- 6, 10.5 and 15 W before the entry |
| GREEDY, still TypeScript | the convert-or-add, and the ruler's displacement |

The greedy half recomputes a lap-wide histogram of which asset is most
repeated after every change, and can DELETE. That is D-4's class of rule
and wants D-4's treatment; it is one more pass.

**The one that would have been invisible.** L-3's three marks must share
ONE lateral -- "they are a line, not a scatter" -- and the way to get that
wrong in a graph is to draw the magnitude AFTER `copyToPoints` rather than
before it, because a copy carries its own identity and `randomField` then
answers three different numbers. Every count, every station and every
window still passes. The asset choice learned the same lesson about its
uniforms; this is the case where getting it wrong is visible in the
picture rather than merely wrong.

**And the seam hid it, which is the finding worth keeping.** The first
version of `placeCornerLanguage`'s hand-off read the lateral off
`cooked[0]` and imposed it on all three marks -- so "the three share a
lateral" was a property of THAT LINE, not of the cook, and the scattered
draw came out looking correct. `brakingRulersSatisfied`, the shipped gate
whose whole job is to catch exactly this, could not see it either. The fix
is to transcribe each mark WHOLE, which puts the claim back where it is
made; with that done the deliberate mutation fails both the dedicated test
and the shipped gate. This is the second time in three units that a
value the graph computed was quietly discarded by the TypeScript that
consumed it -- the first was `cornerOutside` -- and the shape is the same
both times: **a column the seam does not read is a column nothing tests.**

**Three falsifications, all caught after the fix:**

| mutation | caught by |
| --- | --- |
| ruler magnitude drawn per mark, not per corner | the line test AND `brakingRulersSatisfied` |
| the gather always reads row 0 (sharp) | the archetype assertion |
| ruler span divided by `count` not `count - 1` | the `rulerStations` comparison AND the gate |

**Measured, seed 1, shipped vocabulary:** 19 corners, 9 tight, L-2 9+10,
L-3 27 marks, both gates satisfied, and the ruler stations agree with
`rulerStations` to 3.05e-5 W -- well inside `SAME_STATION_W`, which
matters because the gate looks for a mark AT each of those stations.
Identical figures whether the language is cooked in its own graph or
folded into the lap graph, which is its own test.

### Where the prelude stands after the marker vocabulary, 2026-08-26

1. **The bookkeeping half of the corner language** -- convert-or-add and
   the ruler's displacement -- plus `reserveMarkers`, which is three
   weighted draws WITHOUT replacement and is its own small problem.
2. **Landmark uniqueness (L-4) and the band mix (Z-3)**, both list
   arithmetic over the whole lap, and both greedy in the same way.
3. **The frame lookup**, which `transferAlongPath` now answers.

### Reserving the vocabulary, and a test that passed by coincidence, 2026-08-26

`reserveMarkers` is a graph: three weighted draws without replacement over
the kit's verticals. `DressOptions.reservation` is the fourth seam, and
the page now decides its own corner vocabulary.

**The loop is UNROLLED, not `repeatUntil`, and that is a decision.** A
`repeatUntil` body cannot see its own iteration index, and the round index
is exactly what selects the uniform -- `rand(seed, k, 0x4d21)` is one
number per round. Three is a constant `MarkerKit`'s own shape fixes, so
three stages is the honest spelling.

**One uniform per ROUND needed a mechanism.** `randomField` answers one
number per POINT, so reading it on the candidates gives every candidate a
different uniform, which is not a draw from anything. The answer is a
separate three-point cloud whose rows are the three uniforms, gathered
onto every candidate by `transferByIndex` at a constant index.

**A taken candidate is masked to zero weight rather than removed** -- the
same thing said in a language with no `splice`, since a zero weight makes
a bracket of width zero and a bracket of width zero can contain nothing.

**The bookkeeping test passed by coincidence, and the id guard caught it.**
The end-to-end test handed `dressLap` a graph-reserved POOL while
`dressLap` re-derived a TypeScript-reserved one -- so the asset choices
were indices into a list that did not exist there. It passed, because at
seed 1 the two reservations happened to pick the same three. Deliberately
changing the graph's draw made them diverge, and `fromChoice`'s carried
asset id -- added two units ago for exactly this class -- threw. The fix
is `DressOptions.reservation`, which carries the markers AND the pool
together, because a reservation is a partition and taking half of it
lets the halves disagree.

**Three falsifications, and the third needed a measurement to state.**

| mutation | caught |
| --- | --- |
| drop the without-replacement mask | yes -- a later round overwrites an earlier round's marker, so a pick vanishes |
| hand every round the same uniform | **not at first** |
| (the error message blamed the wrong cause) | corrected |

The shared uniform is nearly invisible: the picks stay distinct because
masking shifts the CDF, stay weighted, stay deterministic, and every other
test passes. What collapses is the SPACE -- three degrees of freedom
become one, and the second pick can only land at or before the first,
because removing a candidate shrinks the total the same uniform is scaled
against. Measured over 120 seeds on 8 verticals, which allow 56 distinct
sets of three: **three uniforms reach 28, one uniform reaches 8.** The
bound asserts >15, with the failing variant run to confirm it fails.

**Measured otherwise:** 8 vertical candidates of 229 placeable assets;
mean `instances` of what is picked 7.68 against a flat 4.75 over 120
draws, which is the weighting `reserveMarkers` argues for showing up as a
number; both L-2 and L-3 gates satisfied on a lap dressed from a
graph-reserved vocabulary.

**Two cooks on the page, deliberately.** The reservation decides which
assets EXIST for everything after it, so it cannot be a stage inside the
graph that consumes its answer. Folding it in would also mean ranking
three objects by height in-graph and handing `dressLap` a pool it can
resolve indices against, which is a list of TypeScript objects. The cook
is over eight candidates and costs nothing measurable.

### Where the prelude stands after the reservation, 2026-08-26

1. **The bookkeeping half of the corner language** -- convert-or-add and
   the ruler's displacement. Both are greedy walks over a mutable list
   that recompute a lap-wide histogram after every change; the histogram
   itself is now expressible (`pointsToPath` by asset, `pathScan` with a
   `totalAttr`), and the sequential part wants D-4's `repeatUntil`.
2. **Landmark uniqueness (L-4) and the band mix (Z-3)**, the same shape.
3. **The frame lookup**, which `transferAlongPath` now answers.

### The convert-or-add, measured before it is built, 2026-08-26

The next unit is L-2's convert-or-add and L-3's displacement. Both are
greedy walks over a mutable list that recompute a lap-wide histogram of
"which asset is most repeated" after every change, and the design turns
on one question: **does the drift actually matter?** Measured rather than
assumed, on the shipped vocabulary at six seeds, comparing the victim each
corner picks under a LIVE histogram (what `placeCornerLanguage` does)
against a FROZEN one (what a parallel graph could do):

| seed | corners | converted | victims the drift moves | collisions under frozen |
| --- | --- | --- | --- | --- |
| 1 | 19 | 9 | 1 | 0 |
| 2 | 19 | 13 | 2 | 1 |
| 3 | 19 | 13 | 3 | 1 |
| 4 | 19 | 10 | 0 | 0 |
| 5 | 19 | 13 | 1 | 1 |
| 6 | 19 | 7 | 0 | 0 |

**Two different things, and only one of them is optional.**

The DRIFT moves which victim a corner takes, on 0-3 corners of 19. Every
one of those is still a legal victim -- in the window, on the outside, not
reserved, with more than one copy on the lap -- so a frozen histogram
picks differently rather than wrongly. That is a stateable approximation,
and `selfPrune` is the precedent for accepting a bounded one and saying
so.

The COLLISION is not optional. Under a frozen histogram two corners whose
windows overlap can name the SAME placement, and converting it twice
means one corner silently ends up with no marker at all -- with
`markersConverted + markersAdded` still summing to the corner count,
because both corners think they converted. It happens on 0 or 1 victims
per lap, which is exactly often enough to ship broken and rare enough
never to be noticed. Any parallel pick has to arbitrate it: lowest corner
index keeps the victim, the loser re-picks or adds.

**So the shape is a `repeatUntil` that converges in a round or two**, not
one that walks nineteen corners one at a time: pick in parallel against a
frozen histogram, arbitrate collisions, repeat while any corner is still
contending. The histogram itself is now expressible -- `pointsToPath` by
asset ord, `pathScan` with `reduce: "sum"` and a `totalAttr`, then
`promoteAttribute` primitive to point -- which is the grouped reduction
`pathScan`'s `reduce` was added for.

**The ADD case needs the carried geometry to GROW**, which no rule ported
so far has needed: a corner with no victim pushes a new placement rather
than replacing one. Expressible as a one-point cloud filtered by "no
victim was found" and merged, but it is the part to build first, because
it is the part that decides whether the whole thing fits in a
`repeatUntil` body at all.

### The convert-or-add, built exact, 2026-08-26

`cookCornerBookkeeping`. It answers which corner converted each placement
and which tight corner's ruler displaced it; building the resulting list
stays with `placeCornerLanguage`.

**The design the measurement pointed at was not the one that shipped.**
The plan above expected a `repeatUntil` with parallel picking and
collision arbitration, accepting the frozen histogram as a stated
approximation. What made that unnecessary: **`cookCorners` has already
run**, so a corner's `entryW` and `outside` are ordinary numbers at
graph-build time. The eligibility test is then a field expression over the
placements alone -- no `copyToPoints` stamping nineteen corners onto three
hundred placements, no grouped reduction to undo it -- and unrolling the
corners costs about a dozen whole-cloud reductions each. Sequential stages
come free, so the histogram is rebuilt every stage and the port is EXACT.

Two structural facts made unrolling the only sensible choice anyway: a
`repeatUntil` body cannot see its own iteration index, so it could not
know which corner it was handling; and it carries exactly ONE pin, where
this needs two populations.

**The pre-build measurement showed up again as a test.** Deliberately
freezing the histogram fails all four equivalence seeds AND the
shipped-count check on seed 3 -- which is exactly where the earlier
measurement said the drift moves three victims.

**Checked two ways, because one is not enough.** The suite transcribes the
victim rule so picks can be compared index for index; that reference is
mine, so agreeing with it proves only that the graph matches my READING of
the rule. So it also runs the function that ships and compares its three
counts, on four seeds: graph and shipped agree at 9+10/-25, 13+6/-22,
13+6/-24, 10+9/-27.

**Two things worth keeping.** One column carries both kinds of asset --
non-negative is a pool index, negative is `-1 - row` for a reserved marker
-- so "never convert a marker" is `ord < 0`, a test that stays true AS
L-2 converts, which a column written before any conversion would not. And
`victimCount = 1` with a strict `>` is a rule hiding in a loop
initialiser: an asset with one copy on the lap is never the most repeated
anything, so L-4's landmarks are safe from both stages by construction
rather than by a protect set. It now has a name and a test.

### Where the prelude stands after the convert-or-add, 2026-08-26

The corner language is now entirely graph-decided except for assembling
the list. What is left of the lap prelude:

1. **Landmark uniqueness (L-4)** -- a greedy walk that re-draws the most
   repeated placement in a bare tenth from the assets the lap has not
   used. The same shape as this unit: a lap-wide histogram plus a
   sequential pass, and the stretch index is a constant per stage.
2. **The band mix (Z-3)** -- likewise, over six bands rather than ten
   tenths, and with a per-band share to hit rather than a threshold.
3. **The frame lookup**, which `transferAlongPath` answers.

And then the repair TAIL, which is a different problem: the sightline
cull, D-4's second pass, false edges, tunnels and enclosure all run
INSIDE `dressLap`'s bounded fixed point, so they cannot move one at a
time the way these have.

### Which rules actually fire, and what that does to this plan, 2026-08-26

The remaining order in the entries above was written from the rule list
rather than from the lap, and measuring it reorders everything. Eight
seeds, shipped vocabulary, every stage graph-decided up to the corner
language:

| rule | moves per lap, seeds 1-8 |
| --- | --- |
| Z-1 corridor | 19, 21, 29, 33, 19, 28, 22, 24 |
| **L-4 landmarks** | **0, 0, 1, 0, 0, 1, 0, 0** |
| L-1 sightline cull | 42/0, 45/2, 57/3, 48/0, 56/11, 37/0, 70/14, 40/1 (pushed / dropped) |
| Z-3 band mix | 25, 28, 41, 39, 27, 28, 48, 26 |
| L-5 false edges | 0 on every seed |
| D-4 inside `dressLap` | 0 on every seed |

**L-4 was next on this plan and should not have been.** It fires once in
eight laps. Porting it would move a rule that never runs, and the port
would have no observable effect to test end to end -- the strongest test
available for it would be a synthetic lap built to make it fire, which is
worth doing eventually and is not worth doing NEXT. The same is true of
L-5 and of D-4's second pass, which never fire at all on this vocabulary.

**What does the work is Z-1, the cull and the mix.** Z-1 is the only one
of the three that is PRELUDE; the other two live inside `dressLap`'s
bounded fixed point.

**And that loop is the real remaining problem, not a list of rules.**
Every seam shipped so far works because the stage runs ONCE, before the
loop, so an async cook can hand its answer to a synchronous `dressLap`.
A rule inside the loop is re-run per round against placements the
previous round changed, so the same trick would need a cook per round
from synchronous code. The two ways out are the ones the slice-2 plan
already names: make the whole tail one graph with a `repeatUntil`, or
make `dressLap` async and ripple that through a dozen synchronous
callers. Neither is a seam; both are the architecture.

**So the prelude is finished** except Z-1, which is a pure per-placement
function and belongs with the asset choice rather than with the repairs.

### The repair loop is not a fixed point, measured, 2026-08-26

Per-round repair counts through `ROAD_TRACE`, six seeds, every stage
graph-decided up to and including Z-1:

| seed | round 1 | round 2 | round 3 | round 4 |
| --- | --- | --- | --- | --- |
| 1 | cull 42, cover +1, mix 25 | all zero | — | — |
| 2 | cull 47, cover +1, mix 28 | all zero | — | — |
| 3 | cull 58, cover +1, mix 39 | cull 1, cover +1, mix 1 | cull 1, mix 1 | all zero |
| 4 | cull 46, cover +1, mix 37 | cull 1, mix 1 | cull 1, mix 1 | all zero |
| 5 | cull 67, cover +1, mix 27 | cover +1 | cover +2 | all zero |
| 6 | cull 37, cover +2, mix 28 | cover +1 | all zero | — |

**Round one does essentially everything.** After it, the whole lap needs
at most two cull moves, two mix moves and three cover pieces -- and on two
seeds of six, nothing at all. This is one pass with a settling tail, not a
fixed point that iterates to a solution.

**Five of the eight rules in the loop never fire on this vocabulary.**
`corridor` is 0 in every round now that Z-1 runs in the cook, which is the
port confirming itself; `trim`, `cov` (D-4's second pass), `L4` and `L5`
are 0 in every round of every seed. That is a fact about THIS kit and this
lap length, not a licence to delete them -- D-4 exists because the cull
opens gaps, and a kit with taller art would drop more than the 0 to 14 it
drops here. But for porting ORDER it settles the question: the rules that
matter are the CULL, the mix, and L-6's top-up.

**And it settles the architecture question the entries above left open.**
The slice-2 plan proposed splitting the cull onto the per-cell level and
accepting that its outcome can no longer feed back into the lap-level mix
-- "the cull wins and the damage is counted" -- as a design decision taken
without evidence. The evidence is now here: **that feedback is worth one
mix move and one cull move per lap, on two seeds of six.** The coupling
the split destroys is real and is close to nothing.

So the recommendation is not "make `dressLap` async" and not "port the
whole tail as one `repeatUntil`". It is:

1. **`occlusionCull` as a library node, and the cull onto the per-cell
   level.** It is 37 to 67 moves a lap -- more than everything else
   together -- it is the only rule in the loop whose halo is LOCAL (a 12 W
   cone), and it is what makes a track drivable rather than merely
   dressed. This is the one that pays.
2. **Leave the lap-global tail in TypeScript for now.** The mix at 25 to
   39 cooks once at level 0 where it is cheap, and the feedback it loses
   is the single move measured above. Porting it buys the architecture
   nothing until the cull has moved.
3. **Do not port L-4, L-5 or D-4's second pass** until a kit exists that
   makes them fire. A port of a rule that never runs cannot be checked.
