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

A ~~struck~~ heading here means the entry SHIPPED and is no longer
waiting for anything. Its body stays because the analysis under it is
what the outcome tested — several of these scored badly, and a survey
that guessed wrong is worth more to the next survey than a deleted one.

### ~~Killing the racetrack's TypeScript prelude: four library gaps~~ — DONE 2026-08-27

**THE PRELUDE IS GONE.** `demos/racetrack/main.ts` cooks
`cookReserveMarkers` and the road, and nothing else: `placements` is
omitted, the lap level decides the list, and the panel reads the level's
outputs. See "The page has no prelude, 2026-08-27" and "What verification
found after the prelude went, 2026-08-27" below for what shipped and what
an independent pass then found in it. Kept here rather than deleted
because the survey below is what the outcome tested, and it scored badly
enough to be worth remembering: three of its four gaps were wrong, and the
thing that actually blocked the page in the end (`densityScale` having
nowhere to go on `DressGraphInput`) is not in the list at all.

`demos/racetrack/levels.ts` recorded the honest limit of the streamed
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
work with no node story, and ~400 are weighted draws over the
vocabulary.

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

### ~~The station process as a graph -- the shape the three probes imply~~ — BUILT 2026-08-25

**It is `stationGraph.ts`**, and `addLapPlacements` calls it, which is how
the entry above came to be struck too. "The graph and TypeScript station
processes, measured side by side, 2026-08-25" records what the built one
agreed with and what it could not: the port is distributionally equal and
NOT bit-identical, deliberately, for the reason "The station port cannot
be bit-identical, and why that is the design, 2026-08-25" gives. Kept
because the over-generate-then-cut pattern below is the shape three later
stages took as well, and it is cheaper to read here than to re-derive.

Written down before building because it FOLLOWED from the corrected gaps
above and would otherwise have been re-derived from scratch.
`makeStationsDetailed`
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

### The per-instance channel, verified on WebGPU by an external consumer, 2026-08-28

The 0.17.0 channel shipped with a gap we could not close ourselves: the
library ships the data and deliberately no material, so nothing here can
issue a draw call through a real TSL/WebGPU material. `tests/instanceChannelRender.test.ts`
covers WebGL and the WebGPU backend; the NODE/TSL path was reasoned about,
not exercised.

An integrator (Fantasynth) closed it. Real Chrome, `WebGPURenderer`, three
0.185.0, 16,384 instances, four cases, one page load each. Method worth
keeping: one instance per pixel of an f32 render target, with the u32 split
**in the vertex stage while it is still an integer** — splitting after a
float varying would have measured nothing — and `idx` riding as its own u32
channel rather than TSL's `instanceIndex`, so the readback PINS the
instance-order invariant instead of assuming it.

**What it established that no test in this repo can:**

- f32 and u32 channels arrive exact, including 2^24+1, 2^32-1, and real
  cooked seeds from `graphs/basics-instance-channels.json`.
- The instance-order invariant (`attributes[k]` ↔ `transforms[k]`) held on
  every instance — now pinned by a consumer that shares none of our code.
- Two meshes sharing ONE compiled `NodeMaterial` each read their own data,
  with `renderer._pipelines.caches.size === 1`. A per-mesh material would be
  a shader compile per clip launch for a real-time host, so this is the
  property that makes the channel usable rather than merely correct.
- **With no `gpuType` set on any column**, u32 still arrives exact. The
  0.17.0 retraction (see `docs/authoring.md`) now rests on WebGPU evidence
  as well as on reading three's source and a WebGL readback.

**TWO ITEMS THIS LEAVES US, both deliberately unbuilt:**

**1. Silent zeros when one assetId mixes channelled and unchannelled
batches.** A mesh missing a channel its material declares reads 0 for every
declared channel — no throw, no console output, no WebGPU validation
message. That is three's behaviour, but it meets our adapter: a second batch
of the SAME assetId carrying no channels joins a pipeline already compiled
with those attributes and quietly shades zeros, which renders as "every
instance identical" and nothing flags it.

**CORRECTED 2026-08-29 — this is NOT pooling-specific, and the reasoning
below was wrong.** The claim was that our default path is safe because
every mesh gets its own material clone. It is not: `cloneAssetMaterial`
gives each mesh its own `Material` INSTANCE, but three's `WebGLPrograms`
keys the program cache on SHADER SOURCE, so two clones of one material
resolve to ONE compiled program. Measured in
`tests/instanceChannelRender.test.ts`: two `buildInstanceBatches` calls for
assetId `"q"`, `meshes = 2`, `programs = 1`, `usedTimes = 2`, and the
unchannelled sibling shades `[0,0,0,255]` while its partner draws correctly
— from two ordinary cooked cells, with nothing misspelled anywhere and no
pooling host involved.

So the argument against an unconditional warning is weaker than stated: the
hazard reaches every consumer, not just a pooling one. What still holds is
that the adapter cannot see it — `toInstancedMeshes` binds what the batch
carries and never learns what the material declares — so a check has to be
told what to expect. The opt-in expectation remains the right shape, but for
a better reason than "pooling hosts only".

**2. `toInstancedMeshes`'s material clone is documented only from the
disposal angle.** A host with a pooled or shared material must overwrite
`mesh.material` and dispose the clone, and today that is derivable from the
ownership notes only if you already know to look. One sentence there closes
it. (`ownsGeometry` by contrast was reported clear, and they branch teardown
on it as documented.)

**Channel NAMING, and the integrator's design resolves it — one way that
matters for what we should build.** A graph names channels freely, but a
pooled material's attribute names are COMPILED INTO ITS PIPELINE and cannot
vary per clip without losing the pooling. Both cannot be free, so the host's
names win and the content carries the mapping (a `CHANNEL_MAP` per actor on
their side). Their cheap first move is routing a channel onto an attribute
the template ALREADY declares — `cell` onto `aGridCoord`, driving existing
grid-repeat behaviour with no shader change and no new pipeline variant.

**What that means for us, and it removes an option rather than adding one:**

- **Do NOT build static channel reporting** (a `pcg channels` reading
  `instanceAttrs` off a graph without cooking, mirroring `pcg assets`). It
  answers "do the graph's names match the shader's?", which is a question a
  mapping host does not ask. It would also have to report a lower bound,
  since `instanceAttrs` can be field-driven — a second source of truth that
  can drift from the cook, which is the objection that killed the
  invalidation preview.
- **Do NOT add an alias/rename option to `toInstancedMeshes`.** The mapping
  is per-content actor DATA on the host side, not per-call config; a
  library-level alias map is a second home for the same mapping.
- **DO consider the opt-in expectation** (see item 1 above). With a mapping
  in play the failure is not "names disagree" but "the map is wrong or
  stale", which produces the identical silent zeros. An opt-in
  `expectChannels` is what turns that into a named error, and the host
  asserts its OWN post-mapping names, which are exactly the names it knows.
  One mechanism covers this and the silent-zeros hazard both.
- **DO pin the zeros behaviour in `tests/instanceChannelRender.test.ts`** —
  a shader declaring a channel no batch provides. Today "shades zeros, no
  error, no validation message" is an integrator's observation on their
  renderer rather than our documented behaviour. The rig already exists.

**A method note from their own correction**, which generalises:
`readRenderTargetPixelsAsync` returns TOP-DOWN, and a hand-picked probe row
sampled the neighbouring mesh's perfectly correct data — a plausible number
from the wrong place. Their per-instance assertions were unaffected because
each pixel is identified by its OWN payload rather than by position.
**Payload-identified assertions cannot read the right answer from the wrong
place; position-indexed ones can.**

### What the channel expectation left, and the wiring it does NOT get, 2026-08-29

All four items above are closed. The zeros behaviour is pinned
(`tests/instanceChannelRender.test.ts`: two ordinary cooked cells, one
material clone each, ONE compiled program, the unchannelled sibling
shading `[0,0,0,255]`), `requireChannels` ships as the opt-in refusal, and
item 2's material-clone sentence is now in both the ownership notes and
`docs/authoring.md` — a pooling host must dispose the clone it displaces
when it overwrites `mesh.material`, which was derivable before only if you
already knew to look.

**`WorldThreeBinding` does NOT forward an expectation, and the survey is
why.** It looked like the obvious next move — the binding is the one call
site left on the two-argument form, and the streamed world is exactly
where a cell cooks without a channel its sibling has. The consumer survey
kills it on two counts:

- **No caller.** Every `WorldThreeBinding` consumer draws batches with no
  named channels at all: `gpu-world` (one assetId, `spire`),
  `infinite-world` (`megarock` and `rock`), `racetrack`'s streamed
  dressing (many assetIds, and `assets3d.ts` says outright that none
  carries a channel). The only SHIPPED material that declares an instance
  attribute is `lanterns`' `ShaderMaterial` (`in uint seed;`, `in float
  seedWidened;`), and `lanterns` calls `toInstancedMeshes` directly,
  never the binding. A `requireChannels` on `WorldThreeBindingOptions`
  would ship with zero callers, which is what this section of the file
  exists to prevent. (Two in-repo consumers do pair the two, and neither
  changes the count: `tests/support/instanceChannelPage.ts` declares
  instance attributes in its own shaders, and
  `src/three/worldBindingRetainOrder.test.ts` hands a BINDING a batch
  carrying a `phase` channel. Both are harnesses written to exercise the
  seam, which is the opposite of a consumer that would set an
  expectation.)
- **The world-level shape is wrong even when a caller appears.** One list
  on the binding asserts across EVERY batch the world produces, and a
  world is heterogeneous by construction — `infinite-world` already draws
  two assetIds and `racetrack` many. The per-call list is honest because
  the caller partitions its batches the way it partitions its materials;
  a binding hands over whatever the cook produced, so the same list
  becomes all-or-nothing over assets that have nothing to do with each
  other. The per-assetId map that would fix that is the one rejected in
  the commit that shipped `requireChannels`, for the reason that still
  holds: the realistic cause is a stale name map, and keying by id adds a
  second map whose unnamed ids go silently unchecked.

  So the binding waits for a consumer that can state the mechanism —
  most plausibly a callback of the shape `DeviceInstanceBinding.bounds`
  already sets (`levelName, coord, assetId`), which is the one per-asset
  lever in this file that a real integrator asked for.

**`lanterns` is wired instead**, and it is the honest caller: its material
declares both channels, its single `spawnInstances` publishes both, and
the cook confirms one batch of 6000 carrying both. The expectation asserts
the promise rather than guarding a branch that can fire today — verified
headless against `dist/`, accepted as cooked, and refused by name with one
channel stripped.

**And the gap that found itself while wiring it: `ToInstancedMeshesOptions`
could have vanished from the published surface with a green suite.**
`publicSurface.test.ts` reads `Object.keys` of the imported namespace, and
an `interface` leaves nothing there to key, so the three entry's 15
type-only exports were pinned by nothing — `src/publicTypeSurface.test.ts`
covers the ROOT entry alone. `src/three/publicTypeSurface.test.ts` closes
it with the same compiler-API machinery, no new mechanism, one file per
entry point for the reason the value pins already are (importing the three
entry's values means importing three, which `noThreeInCore.test.ts`
forbids outside `src/three/`). Proven by injection both ways: dropping a
name from the list, and dropping `type ToPointsOptions` from the barrel —
**the value assertions stayed green through the second, which is the hole
in one sentence.**

`pcg-ts/gpu` has the identical hole and does not get the identical file
yet: `src/gpu/publicSurface.test.ts` pins 8 values, while the ~24
TYPE-only exports of `src/gpu/index.ts` — the structural WebGPU shims
(`GpuDeviceLike`, `GpuBufferLike` and their siblings), the kernel
description (`CompiledFieldKernel`, `FieldKernelLayout`, `KernelInput`,
`AttrIsSlot`, `GpuScalarType`), `DetachedBuffer`, `GpuPoolStats` and
`GpuFieldEvaluatorOptions` — are pinned by nothing. The fix is a copy of
the three one with a different entry path. Left undone deliberately —
each `it` rebuilds a TS program, so this is three more program builds in
every run, and unlike the three entry no options interface of the gpu
entry has just been added by hand. Do it the next time one of those
exported type NAMES is added or renamed (not when a WGSL scalar type is:
`GpuScalarType` is a TypeScript type whose subject happens to be one,
which is exactly the ambiguity that makes "a gpu type" the wrong phrase
for this).

### What the Fantasynth integration asked for, and what it found, 2026-08-29

Six ranked change requests from the VJ host adopting the library. Three
needed no library change at all, which is the part worth keeping: the
survey that answers "you already have this" is the cheapest outcome
available and it only happens if the survey runs BEFORE the build.

Four shipped this cycle (`d397c14`..`74c292d`): `materialFor` and the
`materialListOf`/`ownsMaterial` exports, opt-in device production of
named channels behind `deviceInstanceAttrs`, panel `visibleWhen`, and
the two undocumented fallback reasons. The three that needed nothing
were transform decomposition (`instanceAttrs: ["P","rot","scale"]`
already publishes exactly the pack's inputs), the panel control TYPE
(`describeGraphParams` is keyed identically to `PanelControlSpec.param`,
so the join is the host's ~40 lines), and the World rebuild pattern
(two Worlds sequenced by the host is the only shape, and it is the one
they had already planned).

**FOUR THINGS THIS TURNED UP THAT NOBODY IS BUILDING, each waiting for a
caller in the sense this section means.**

**1. The matrix pack falls back silently where the channel path
refuses.** There is ONE attribute namespace, so a user attribute named
`scale` IS the standard one. Measured: `scale` written as `u32x2`
produces a channel that faithfully carries `Uint32Array` tuple 2, while
`composeTRS` — which needs f32x3 — falls back to identity scale and says
nothing. `resolveInstanceAttrs` throws a message naming the node, the
param and the fix for a MISSING attribute; the pack is mute for a
MIS-SHAPED one, and the render just looks wrong. That is the one place
in the spawner where "nothing fails silently" is not true.
The shape of a fix is not obvious, which is why this is an entry and not
a commit: a refusal is a behaviour change for any graph relying on the
fallback (`instances.ts:247-253` documents it as deliberate for the
ABSENT case, where identity is the right answer), and the two cases want
different treatment — absent is a default, mis-shaped is a mistake. Wait
for a graph that trips it.

**2. `color` is unrepresentable as a param type.** `ParamSchema` has 11
types (`f32 i32 u32 bool string vec3 vec4 enum items stringList
numberList`) and none of them is `color`, so a host deriving a typed UI
cannot tell a colour from any other `vec3`. This came from the panel
request and is the half of it that is genuinely ours: the panel
correctly carries no type, and the schema correctly carries no
presentation, but "this vec3 is a colour" is a node-type FACT that has
nowhere to live. Note the shape of the trap: `color` as a 12th type
widens every switch over `ParamType` in the library and in every host,
to say something a `vec3` plus one bit would say. Commit `9656a8f`
declined `step`/`label`/`group` on `ParamSchema` for a related reason
and that decision still holds; this is not a re-run of it.

**3. `llms.txt` has no generator, and it was the staleest thing here.**
It still gave the binding budget as the reason channels were not device
produced, still said the resident spawner "does not fill it yet", and
still ended "such a spawn has NO parity class at all" — so an agent
reading the agent-form docs would have concluded device residency and
named channels are mutually exclusive, which is the exact conclusion the
opt-in retires. `docs/nodes.json` and `docs/nodes.md` were stale the
same way and `npm run docs` fixed those; nothing fixes `llms.txt`.
The generated catalogs cannot absorb it — it is prose about mechanisms,
not a listing — so the realistic move is a test that fails when a
phrase it quotes leaves the source, rather than a generator. Cheap
version: pin the handful of sentences it quotes verbatim from a JSDoc.

**4. AN ASSERTION THAT CANNOT FAIL, and it is a hazard class rather than
one bug.** The device gather test found that deleting the explicit
pad-zero write left all 41 tests green — and that the PRE-EXISTING
colour pad assertion had been unable to fail since the day it was
written. WebGPU zero-initializes a new buffer, and a retained buffer is
always created fresh (detached at production, never returned to the
pool), so a missing write reads as zero and the test agrees with a bug.
Both are now pinned through a probe that cancels a channelled cook at
its last cancellation check, so the run's `finally` reclaims 56 dirty
buffers and the next cook reuses every one; an itemSize-4 channel shares
a (usage, bucket) with an itemSize-3 one, so the pad lands exactly where
a live component of the previous tenant sat. Without the write, 899 of
1024 pad slots read dirty.
The generalisation, and it is the entry: ANY assertion that a buffer
slot is zero is vacuous on a fresh allocation. The same is true of any
"is cleared", "is reset" or "is absent" check that runs on a
first-use object. `measurement-harness-false-passes` already says prove
an equality check can report "different" before trusting "same"; this
is the allocator's version, and the way to run it is a RECYCLED object,
not a new one.

**5. CORRECTION, 2026-08-29, and it came back from the integrator: "the
clone is not a compile" is true and "mesh churn is not a compile" is
FALSE, and we shipped the second by implication.** `docs/authoring.md`
said WebGL keys on source and "the WebGPU backend already forks per
instanced mesh, so per-mesh clones add no extra builds". The premise is
right and the inference runs backwards. `RenderObject.js:833-837` folds
`object.uuid` for any instanced object, and `NodeManager` caches node
BUILDERS on that key — so a distinct key does not mean a shared program,
it means a fresh build per mesh. Whether that build yields a new program
is then decided by the generated WGSL, which `Pipelines.js:186` looks up
by SOURCE.
For a stock node material the source is per-mesh unique, and the
threshold is the part nobody would guess: `createInstanceMatrixNode`
binds `instanceMatrix` as a UNIFORM BUFFER while `count x 64` fits
`maxUniformBufferBindingSize` (65536 default, so under ~1024 instances),
and that node is named `NodeBuffer_<id>` from a GLOBAL counter.
Past that count three falls to four interleaved instanced `vec4`
attributes named from a PER-BUILDER counter, and the source matches
again. So a SMALL instanced mesh shares programs worse than a large one.
Integrator's numbers on r185, `renderer.info.memory.programs`: 12 fresh
meshes on one shared stock material +12; 12 geometry swaps on one reused
mesh +0; 30 fresh meshes on materials reading their own instanced
attributes +0.
**The suite could not have caught this, and that is the reusable part.**
`renderStateRelease.test.ts` instantiates NO renderer: it greps three's
source text and drives `RenderObject` with stubs, so it counts no
programs and never could. The cache-key assertions in it are correct and
the PROSE CONCLUSION ATTACHED TO THEM was not — a comment inferring a
program-sharing outcome from a cache-key fact, sitting on a green test
that does not measure the outcome. Same family as finding 4 above: the
assertion is fine, the sentence next to it is what shipped wrong. When a
test's comment states a CONSEQUENCE the test does not observe, the
consequence is unverified prose wearing a passing test's authority.

**5b. The threshold, MEASURED, 2026-08-29.** The integrator ran the
prediction back at us and it lands on the instance: four fresh meshes
per row, one shared stock `MeshBasicNodeMaterial`, 65536-byte limit —
4 instances +5 programs, 1024 +5, 1025 zero, 4096 zero. So the
comparison is `<=` and 1024 sits ON the limit still taking the
uniform-buffer path. They pinned it as a standing test rather than a
one-off, on the correct ground that a three bump could move it silently.
The `+5` for four meshes is the detail that confirms the mechanism
rather than merely the number: `Pipelines.js:186,200` keys vertex and
fragment separately and `Info.js:420` counts each, `instanceMatrixNode`
drives `positionLocal`/`normalLocal`/`positionPrevious` (all vertex
stage), and `WGSLNodeBuilder` collects uniforms per stage — so the
unique `NodeBuffer_<id>` lands in the VERTEX shader only. Four unique
vertex programs plus one shared fragment. The cost is vertex programs,
and a fragment-heavy material does not multiply it.
Their 30-fresh-meshes-at-zero case was ABOVE the limit, not
better-behaved materials — they corrected "material-dependent" to
"binding-dependent" themselves, which is the accurate framing and the
one the docs now carry.

**5b-i. CORRECTION to our own correction, and it was ours twice.** The
docs then said "a material that reads its own instanced attributes
rather than `instanceMatrix` shares them regardless of count", and I
told the integrator the same thing to explain their +0. FALSE.
`NodeMaterial.js:796` branches on the OBJECT alone — `isInstancedMesh`
plus an `instanceMatrix` that is an `InstancedBufferAttribute` — and
never on what the material's node graph reads, so `instancedMesh(object)`
runs regardless and the matrix node is created regardless. Declaring
your own instanced attributes avoids a per-launch material VARIANT; it
does not avoid the per-mesh vertex program. Two claims, easily merged,
and the integrator caught the merge in their own renderer's comment
before we caught it in our docs. THE COUNT IS THE ONLY ESCAPE.
Worth noticing how this one survived: the +0 measurement had ALREADY
been re-attributed to the instance count, and the sentence lived on
because it sat in a separate clause that the re-attribution did not
visit. A correction that fixes the finding and leaves its restatement
standing is a fourth costume in embryo.

**5c. A DEFENCE THAT WORKS AND WILL STOP WORKING, worth stealing and
worth guarding.** Their instanced attributes default `aInstScale` to 1
rather than 0, specifically so a missing channel renders visibly wrong
instead of plausibly. That is the right instinct against the same
unobservability as finding 4: a zero default makes "never written" and
"written zero" indistinguishable, so an assertion that a channel
ARRIVED can pass for the wrong reason. But the defence lives in a
default value with nothing pinning it, so it ends the day someone tidies
the default to 0 for consistency — and the test that was passing for the
right reason starts passing for the wrong one, silently. The general
rule: a defence that consists of a value being unusual needs a test that
FAILS when the value becomes usual. Distinguishing written-zero from
never-written needs the recycled-object probe in finding 4, not a
cleverer default.

**5d. THE HAZARD HAS THREE COSTUMES, and the integrator found the third.**
Worth stating once, because the three findings above are one thing and
filing them separately is how it gets rediscovered a fourth time.

- The ALLOCATOR agrees with the bug: an assertion that a slot is zero is
  vacuous on a fresh allocation (finding 4, the pad write). Run it on a
  recycled object.
- The COMMENT borrows the test's authority: a sentence stating a
  consequence the assertion beside it does not observe (finding 5, the
  program-sharing inference). Say what the test measures, not what you
  concluded from it.
- The GUARD is itself unverified: a trip-wire nobody has deliberately
  tripped is an unverified consequence wearing a passing suite's
  authority. Their words, and they are right that it is the same shape —
  they deleted the `.fill(1)` their defence rests on, watched exactly one
  test fail naming the site, and restored it byte-identical. WE HAVE THIS
  DISCIPLINE ALREADY and inconsistently: the device channel work
  mutation-proved ten guards, the panel cycle check was proved to fail
  before it was trusted, and plenty of older assertions have never been
  tripped once.

The unifying rule, and it is cheap: EVERY GUARD SHOULD HAVE BEEN SEEN TO
FAIL AT LEAST ONCE, ON PURPOSE, BY THE PERSON WHO WROTE IT. All three
costumes are that rule going unenforced in a different place — the
allocator, the prose, or the guard itself.

**And one decision deliberately not taken.** The panel format now has a
key (`visibleWhen`) that older parsers hard-reject, and still no
`formatVersion`. Pre-alpha makes that acceptable and the design should
not be bent to avoid it, but a versioning story for the panel format is
a decision someone should take on purpose rather than by accumulation.
Related: `smoke-dist.mjs` never imports `pcg-ts/panels`, so the subpath's
six exported names are pinned in source and unchecked across the build.

### Stretch: intra-node yielding — MEASURED AND REJECTED, 2026-08-28

An external integrator's cook-cost harness, run headless against `dist/`,
found one corpus graph that cannot launch inside a frame — and it is not a
spawn graph. Re-derived independently here with an instrument proved
against known synthetic costs first (30 ms busy loop read 30.06 ms, 5 ms
read 5.04 ms, an idle control reported no blocks at all, and a lone 30 ms
block among fast turns was found without smearing).

**The finding.** `examples-headless-scatter` at 16000 points: one
`setAttribute` node (`height`, fbm perlin over four octaves) costs
**20.6 ms p50 / 28.5 ms p95 on its own**, against a 24.5 ms total cook.
Three independent measurements — two here, one by an agent not shown the
others — landed inside 3%, and the integrator's 21.2 ms floor agrees. It
decomposes cleanly: ~1.2 ms is the node's whole per-point machinery and
**~4.9 ms is each perlin octave** (64,000 evaluations at ~305 ns). This is
noise arithmetic, not framework overhead. Scaling is exactly linear —
5.23 / 10.21 / 20.64 / 40.71 ms at 4k / 8k / 16k / 32k.

**No budget lowers it.** At `budgetMs: 0`, the library's own documented
maximum partitioning, block p95 is still **20.61 ms**. The executor's
budget check sits outside `cookNode` (`src/graph/execute.ts:1353-1359`) and
a node is handed only `signal`/`checkCancelled()`, which throws rather than
yielding.

**Do not build intra-node chunking.** It is feasible — `setAttribute`'s
point loop is pure per-point, so chunking would be byte-identical, and
there is in-repo precedent in the four composites that already meter the
forwarded `budgetMs` themselves (`forEach`, `repeatUntil`, `subgraph`, the
resident GPU run). The measurement is what kills it: forwarding a budget
into `repeatUntil` **doubled that node's own wall time, 24.2 → 48.6 ms**, at
roughly **1 ms per `setTimeout(0)` yield** on this platform. Slicing a
20 ms node into 1 ms slices would cost more than the node. Written down
here so it is not proposed again.

**Three escape hatches, in order of what they actually do.**

- **`pcg-ts/worker` RELOCATES it, and that is usually enough.** Measured on
  the same graph at 16000: main-thread blocks fall to p50 0.38 / p95 0.71 /
  max 0.98 ms, with a 25.07 ms round trip and 0.30 ms decode. It does not
  make the work smaller — useless if the result is needed this frame, right
  for anything streamed.
- **The GPU path targets this node specifically.** `setAttribute` already
  declares `gpu: "fields"` and a `resident` block
  (`src/nodes/attributes.ts:306-311`), and this graph's value is an authored
  `FieldSpec` — the eligible category. A 19.4 ms per-point fbm is the
  archetypal WGSL kernel, and this is the one hatch that makes the number
  smaller rather than moving it.
- **World cell sizing is the product answer.** `src/runtime/world.ts:1057-1062`
  checks the budget BEFORE dispatching each cell and defers the rest, so at
  the World level the atomic unit is a cell and cell size is a real floor
  knob.

**A measurement trap worth keeping.** A budgeted `stats.elapsedMs` includes
yield latency and is not work: the same cook read 24.9 ms budgeted against
23.7 ms unbudgeted here, and 39.8 against 23.8 in an otherwise-idle process,
because `setTimeout(0)` on an idle Windows loop pays real timer latency.
**Quote node times or unbudgeted totals, never a budgeted total.** Relatedly,
deriving the longest uninterrupted block by replaying the accumulate-and-reset
policy over `onNodeDone.elapsedMs` is exact for CPU leaf graphs (28.46
replayed against 28.56 measured) but an UPPER BOUND in general — on
`basics-repeat-until-settled` it over-stated by 11x, because a composite's
single `elapsedMs` spans yields it took internally.

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
vocabulary the demo ships IS that catalogue's numbers. Guarded now by
three tests on the enclosed kit, each verified to fail against the old
code.

WHAT TO TAKE FROM IT: the first fix satisfied the property that was being
complained about and broke the one nobody had stated. "It converges" and
"it works" are different claims, and a repair can be made to pass the
first at the cost of the second without anything going red.

### ~~Probing a registered recipe assumes it is a `subgraph`~~ — FIXED 2026-08-28

`src/cli/primitiveRun.ts:70` and `src/docs/primitives.ts:81` both
materialized a registered recipe with a hardcoded `type: "subgraph"`. A
recipe whose body exposes a wrapper's reserved pin was then refused by the
reserved-name guard — the same hazard fixed in the registry when
`repeatUntil` landed, where the inference already covered all three kinds.

It predated the loop node: a `forEach` body broke these two identically.
It was latent only because no shipped primitive is a loop body. The fix is
one shared inference helper reachable from both the CLI and the docs
generator, which is why it was left rather than patched twice.

**Two corrections to the entry as first written.** It cited the registry as
`src/graph/subgraphRegistry.ts`; there is no such file and it is
`src/nodes/subgraphRegistry.ts`. And "has been able to since `forEach`
shipped" was never verified — it depends on when `each`/`eachPoint` became
globally reserved, which is a different date. The mechanism is what the
shipped comments state; the dating is dropped.

**What shipped.** `inferWrapperKind(exposed)` in `src/graph/subgraph.ts`,
beside the three facts it reads, FACTORED OUT of the registry's existing
inference rather than written a third time — `canonicalize`'s inline
ternary is gone and all three materialization sites now share one answer.
It is public, because `registerSubgraph` ships and a recipe deliberately
does not record its wrapper, so any third party building a node around one
asks the identical question.

A 342,225-combination differential sweep of the helper against the exact
ternary it replaced found zero disagreements — and the sweep was shown able
to detect one, by seeding a deliberately wrong port. So no primitive
content hash moves.

### ~~A settled lap has placements inside the corridor~~ — NOT A DEFECT, 2026-08-27

**The entry was wrong, and its own measurement was the thing at fault.** It
reported 3 to 5 non-cover placements a lap inside the corridor, counted with
a hand-written `|t| < 1W && base < CORRIDOR.ceilingW`. Run with `inCorridor`
— the rule's OWN predicate, tolerance included — the count is **zero**, on
seeds 1/2/3, on both the TypeScript and the graph path. Independently
re-derived twice.

**What the hand-written test was measuring was the arithmetic.** Z-3's
`over` fill stores `h = 1.2 + tall/2` so that the base IS the ceiling;
recovering it as `h - tall/2` lands an ulp under, ~1e-7 in the f32 columns.
`inCorridor` carries `SAME_PLACE_W` for exactly that round trip and
`zones.ts` explains why at length. A restatement without it reads a gantry
standing correctly ON the corridor as standing IN it. That family was 7/12/8
of the flagged placements. The rest had bases below the deck — Z8's
exemption, which the entry's test had no term for.

**And the hypothesis was wrong too.** It blamed L-1's lateral push. On the
settled lap `conePushW` is 0 and `edgeDrop` is 0 on every flagged placement:
neither L-1 nor L-5 had touched any of them. It is also structurally
impossible — Z-1 re-runs at the top of every round and `corridorMoved` is in
the convergence test, so a push into the corridor would prevent the lap from
settling, and all three seeds converged.

**What came out of it that was worth having** is the assertion the entry
asked for, now in `tests/racetrackCorridorGraph.test.ts`: the corridor,
checked on a lap that has SETTLED, on both paths. Z-1 was compared against
`resolveCorridor` in two suites and both compared pre-cull clouds — "Z-1
resolved correctly" and "the finished lap has nothing on the racing line"
are different claims and only the second is the promise. It passes, so it is
a regression guard rather than a repair, and the gap it closes was real even
though the defect was not.

### Stretch: the corridor's floor as an EXTENT test — MEASURED AND REJECTED, 2026-08-27

The one finding that survived the correction above looked real: a 0.75 x
0.52W object at |t| = 0.93 with its base 0.064W under the deck and its top
0.45W above it — knee-high on the racing line, exempt because `inCorridor`'s
floor rung reads the BASE. Z8 exempts what is under the deck, and read on
the base alone that reaches anything merely SUNK into the terrain. The fix
looks obvious: `baseH + tallW > floorW` in place of `baseH >= floorW`.

**Built, measured, and backed out.** It moves **5 to 13 placements a lap**,
mean 9.2 across ten seeds — not the 0-2 the settled-lap count implied — and
raises Z-1's move count by 25-45%, each move a 2-6W lateral shove or a 1.26W
lift. Then look at WHAT it moves: `shell-02` and `shell-04` (2.6W across,
lateral median 0.02-0.05), `panel-28` (**9.8W across**, lateral median 0.03,
height median **-0.43**), `panel-33` (3.4W across). Wide flat pieces centred
on the racing line with their mass at or under the deck. **They are the
road** — surface shells and deck panels — and the floor exemption is what
lets them exist inside the corridor's footprint at all. An extent test
shoves the road surface to the verge.

**So the floor rung is right as written**, and the "sunk piece" it admits is
`panel-03`, whose own recorded `where.lateral.median` is 0.9323 — it is
placed at the lateral the vocabulary gives it, at the edge of the
corridor, which is where a roadside panel goes. There is no defect here to
fix, and the shape of the rule is load-bearing: the ceiling asks where a
piece STARTS because an overhead piece spans from outside, and the floor
asks the same because the things below it are the deck itself.

**A separate consequence, recorded because it cost a probe to find.** The
`under` branch of `lateralFor` draws a base in [-2.5, -0.5] with no regard
to the asset's height, so a 0.8W-tall pylon there pokes 0.3W through the
deck. Unreachable today (`UNDER_SHARE` is 0 — this spline has relief but no
elevated stretches) and only visible because the extent test above asked the
placer and the predicate to agree. If Z8 is ever switched on, the draw
should set the piece's TOP rather than its base.

### The corridor is tested on a CENTRE laterally and resolved on an EXTENT, 2026-08-27

Left open deliberately. `inCorridor` tests `|t| < 1W` on the placement's
centre, while `resolveCorridor`'s large-art exit moves the object's NEAR
FACE to the edge — "its edge goes to the corridor edge, not its centre",
which `zones.ts` argues is the fifth time in this demo that a centre was
used where an extent was meant. The entry side has not been changed to
match, and the reason is a measurement: **15 / 22 / 33 non-cover placements
a lap** have their centre outside 1W, their near face inside it, and their
vertical extent inside [0, 1.2). Z-1 never considers them.

Making the entry test an extent test would therefore move an order of
magnitude more than the floor change did, and it would reshape the verge
band — the archetypes reaching inside 1W are the same ones filling 1.0-1.5W,
which is the argument `resolveCorridor` already makes for having two exits.
That is a design decision with a measurement behind it, not a bug fix to
fold into another change, and it wants a look at the pictures before the
numbers.

### road and racetrack are two demos, 2026-08-27

`demos/road` was made as a copy of `demos/racetrack` with the placement
rules taken out, and CLAUDE.md carried the consequence as a promise: the
module names are identical, so the diff between them reads as what the
rules added. The promise has expired and pretending otherwise costs more
than admitting it.

**Measured, on the day this was written:**

| module | road | racetrack | only in road | only in racetrack |
| --- | --- | --- | --- | --- |
| `spline.ts` | 289 | 289 | 0 | 0 |
| `lap.ts` | 112 | 234 | 27 | 149 |
| `graph.ts` | 211 | 463 | 95 | 347 |
| `main.ts` | 505 | 1287 | 505 | 1287 |

**`main.ts` SHARES NOT ONE LINE.** They are different files with the same
name. And the other two diverged in BOTH directions, which is the part that
kills the promise outright: road has 95 lines of `graph.ts` and 27 of
`lap.ts` that racetrack does not have -- its own `dressVerges`, and a
simpler `Lap` that carries no corner model -- so the diff is not "what the
rules added", it is two files that grew apart. Only `spline.ts` still
holds, and it holds because it is byte-identical.

**Why this is a decision and not just a note.** The promise implied an
obligation -- change racetrack, port it to road, keep the diff meaningful --
and that obligation was never being met, so it was a cost with no benefit:
a reader trusting the claim would take the diff for a feature list and be
wrong about three files of four. The decision is to stop: they are two
demos that share a spline and a naming scheme.

**What that means in practice.** A change to `demos/racetrack` implies
nothing about `demos/road`, and neither needs porting to the other.
`spline.ts` is the one place where a change should be made twice or moved
to `shared/`, and it is identical today, which is worth keeping. If the two
ever need to share more than a spline, the answer is `shared/`, not a copy
whose divergence nobody is tracking.

**This session did not cause it and did not touch it.** None of the eight
commits changed `demos/road` or racetrack's `graph.ts`, `lap.ts` or
`spline.ts`; the divergence predates them. It is recorded now because it
lived only in a CLAUDE.md sentence that had quietly become false.

### ~~Two arc lengths, one parameter: `pathPointAt` on a resampled path~~ — FIXED 2026-08-27

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

**A SECOND CALLER, 2026-08-27.** The racetrack's placement assembly hit
the same disagreement from the other end: scattering stations on the road
graph's frames reads `lapLen` as the CURVE length, which decides the
station populations, and every station on seed 1 landed 0.018585W from
where the chord length puts it. Worked around the same way -- by handing
the stage a polyline whose length attribute is the chord sum
(`lapAsPath`) -- which is a second reconstruction that the fix below would
delete. See "`placements` has left the `dataInput` list" at the end of this
file.

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

~~What is still absent, and now deliberately: `exp2`/`log2` (`pow(2, x)` is
the first, nothing has asked for the second), a truncated remainder to sit
beside the floored one, and `trunc` itself.~~ — ALL FOUR SHIPPED 2026-08-28,
which takes the grammar 58 -> 62.

**AND THE PARENTHESIS WAS THE WRONG ARGUMENT, measured.** `pow(2, x)` is
not `exp2`. On this box's adapter `exp2` lands at 0.50 range-ulp against
`exp`'s 4.12 — EIGHT TIMES tighter — and `log2` at 0.65 against `log`'s
0.93, because the base-2 pair IS the hardware instruction and base-e is the
scaled composition on top of it. Writing the new pair base-e instead was
tried and measured 6.0x and 2.0x worse, busting a budget of 1 at 3.00 and
1.30. So the entry had the dependency backwards: the base-e fns it already
had are the derived ones.

`rem` is the truncated remainder — sign follows the DIVIDEND, so
`rem(-1, 8)` is -1 where `mod(-1, 8)` is 7. Named for the `mod`/`rem` split
Ada, Common Lisp, Haskell and Julia all spell that way; `fmod` was declined
for CONTAINING the other name, since reaching for one and getting the other
is the failure mode. `trunc` and `rem` are bit-exact on the device (maxUlp
0), and both bit-exactness claims were falsified before being believed —
swapping `trunc` for `floor` in either lowering reddens the rows.

Two things worth keeping from the build. WGSL's `%` is NOT emitted for
`rem` even though it means the same: this adapter implements `%` as the
spec's expansion, so emitting it leaves the whole device table green and
the argument for the expansion is PORTABILITY rather than a measurement —
which is why the emitted WGSL text is pinned in `compile.test.ts` instead,
a pin that does fire. And the shader compiler algebraically folds
`log2(exp2(x))` to `x`: the CPU runs `exp2(128)` to Infinity and answers
Infinity where the device answers 128. Parity is a claim about one fn's
lowering and not about an expression built from several.

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
  RE-CONFIRMED 2026-08-27, and the check is cheap enough to repeat: the
  string `--against` appears in this file and NOWHERE ELSE in the
  repository — not in `src/cli`, not in a test, not in a script. There is
  still exactly one consumer and it is this paragraph. Do not build it.

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
Two smaller ones with it. ~~Nothing enforces that a level's halo matches
the radius of the neighbour query that needs it~~ — BUILT 2026-08-28,
`src/runtime/reach.ts`; the suite's hand-read of the radius out of the JSON
is now one call. And a `ParamPatch` can only replace a whole `FieldSpec`,
never a number inside one — RE-CONFIRMED CALLER-BLOCKED 2026-08-28, and
cheap to re-check: `bindPatches` has exactly two consumers outside the
runtime, `graphs/examples-streamed-terrain.json` and
`tests/worldStreaming.test.ts`, and neither patches into a field spec. The
racetrack does not use `bindPatches` at all. Backlog's own rule is to let
the consumer specify the mechanism, so this waits for one.

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
the whole point of the campaign: a host can then generate a track from a
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

### The band mix is a quota fill, and a recommendation that was already built, 2026-08-26

**FIRST, A CORRECTION TO THE ENTRY ABOVE.** Its recommendation reads
"`occlusionCull` as a library node, and the cull onto the per-cell level."
Both halves were already settled when it was written and it should not
have been written:

- `occlusionCull` has been in the standard library since `4014fc6`
  (`src/nodes/visibility.ts`, its own module, 789 lines), and
  `dressGraph.ts`'s `writeSightlineCull` has been calling it from inside
  the graph's `repeatUntil` repair body since `48d2543`.
- The per-cell cull is DECIDED AGAINST, on purpose and in writing.
  `levels.ts` puts the whole repair on the unbounded lap level so that a
  sector reads no neighbour: "no sector repairs anything, and there is
  therefore NO HALO AT ALL: the union of the sectors is the whole lap, box
  for box, not to a tolerance but by construction." Moving the cull down
  would trade that for a windowed approximation, which is the opposite of
  what the measurement in that entry was for.

The measurement in that entry stands. The recommendation drawn from it was
written against the slice-2 plan rather than against the shipped code, and
this is what should have been drawn instead.

**WHAT IS ACTUALLY LEFT IN `dressLap`'s LOOP.** The trace line has eight
terms. Three are in the graph already (`corridor`, `cull`, `L5`). Three
never fire on this vocabulary (`trim`, `cov`, `L4`). That leaves two that
fire and are not ported: L-6's cover top-up, which `dressGraph.ts` has
already argued out on its merits -- it reads a measurement the previous
repair invalidated and draws from `seed + rounds`, so both halves of the
admission test fail -- and **Z-3's band mix**, which nothing has argued
about. So the mix is the whole of the remaining question.

**AND THE MIX IS NOT THE SEARCH IT LOOKS LIKE.** `repairBandMix` recomputes
all six band shares after every single move, picks the worst-over and
worst-under bands, takes the first eligible donor and draws up to eight
times -- a greedy sequential loop with a `failed` set, which is the shape
that does not become a graph. Measured over six seeds, shipped vocabulary,
by deriving each move's (source band, destination band) from the repair's
own log:

| seed | moves | distinct pairs | runs | into `over` |
| --- | --- | --- | --- | --- |
| 1 | 27 | 3 | 25 | 25 |
| 2 | 28 | 3 | 4 | 26 |
| 3 | 30 | 3 | 23 | 28 |
| 4 | 34 | 5 | 15 | 26 |
| 5 | 23 | 2 | 9 | 23 |
| 6 | 25 | 3 | 20 | 22 |

**One destination, two sources, and the counts are the deficits.** On every
seed `over` enters at 2.7-4.2% against a floor of 10% and `near` and `mid`
enter above their ceilings; the mix moves placements out of those two into
`over` and stops. Seed 1 is the whole story in three numbers: `near` is
0.3935 against a ceiling of 0.35, `mid` is 0.4349 against 0.40, and on 362
placements those excesses are 15 and 12 -- against 27 moves.

**The per-move recompute only INTERLEAVES the sources.** The long
`near>over mid>over near>over mid>over` runs are the greedy loop
alternating because each move makes the other band the worst-over one. It
never changes the destination, and it cannot change WHICH placements a band
gives up, because the donor scan is a linear `find` and always takes the
first eligible member of that band. So the set moved out of `near` is its
first k1 eligible members and the set moved out of `mid` is its first k2 --
the same two sets a closed-form quota fill would take, arrived at in a
different order.

**And it converges in one round.** `mix=0` in round 2 on all six seeds,
which is stronger than the whole-loop table above suggested: the settling
tail those rounds show is L-6's cover top-up, not the mix.

**So Z-3 is a quota fill and it is expressible.** Per-band shares are the
grouped reduction the corner language already uses -- `pointsToPath` by
band, `pathScan` with a `totalAttr`, `promoteAttribute` back with mode
`first`. Per-band excess and deficit are arithmetic on those. The donor
choice is "the first k eligible members of this band in arc order", which
is an exclusive scan of an eligibility flag compared against k. The redraw
is `placeAsset`, which the asset choice stage already spells as fields.

**The library gap it names is `quotaRebalance`** -- the node the slice-2
plan predicted, and the measurement narrows what it has to be. Not a
transportation solver and not a greedy search: given a category per
element, a per-category `[lo, hi]` share band and a per-element
eligibility, mark the minimum set of elements that must leave an over-full
category and name the under-full category each should join. Nearest edge,
never centre, for the reason `assets.ts` gives -- driving every lap to the
middle of each band would make generated laps markedly more uniform than
the rule allows, since `over` spans a factor of five.

**AND ONE CLAIM IN THE DEMO IS SIMPLY WRONG, which this port needs.**
`dressGraph.ts` says a per-point asset id "has to be WRITTEN by whatever
builds the cloud in TypeScript" because "`spawnInstances` groups by a
string point attribute and there is no field that produces one." There is:
`setAttribute` with `type: "string"` takes a field-capable INDEX selector
into a `values` table (`35d1a4b`, 2026-08-05) and a weighted FRACTION
selector beside it (`14e409e`, 2026-08-16), and
`graphs/basics-spawn-by-species.json` ships exactly that pattern into
`spawnInstances`. The comment postdates both. The conclusion it supports --
spawn one instance per placement rather than per box -- survives on its
other argument, which is that a gantry is one object rather than seven
slabs; but a mix that redraws a placement's asset can write the new id in
the graph, and without that it could not be ported at all.

### Where the prelude stands after Z-3's decision, 2026-08-26

Z-3 split in two and only one half moved, which is the finding rather
than a compromise. `repairBandMix` is a lap-wide SEARCH for which
placements must change band and a per-placement REDRAW of one of them.
The search is `quotaRebalance` in the repair body now; the redraw is
still `dressLap`'s.

**The decision is exact.** Four seeds, on the list as it reaches step 8
for the first time: the graph marks the same placements for the same
destination bands as the reference chooses -- 17, 28, 14 and 22 moves,
nothing missing and nothing extra -- and the band ladder agrees with
`bandOfPlacement` on all 329, 312, 328 and 331 placements. That held
because `quotaRebalance` takes the visit order as a param and this passed
it the station: the reference found its donor with a linear `find` over a
station-ordered list, so "the first k eligible members of this band" was
the same k either way. THE ORDER IS HASHED SINCE 2026-08-28 and the
agreement is unchanged for the same structural reason -- both paths now
rank by `mixDonorPriority(station)`, so they still agree member for
member. See the struck entry below.

**What is left of the lap prelude, in the order the measurements put it:**

1. **Z-3's REDRAW.** Blocked on ONE thing, and it is not the one the code
   said. `dressGraph.ts` claimed no field can produce a string attribute,
   so the asset id had to be written in TypeScript; that was false when it
   was written and is corrected in place. The real blocker is the POSE:
   `poseFor` draws which recorded instance of an asset to use, from a
   library the repair body is never handed, and a redraw that changes the
   asset must change the pose. The way through is the one the asset choice
   already uses -- hand the pose cloud in as a second broadcast input and
   pick with the same group/scan/bracket recipe, then write the id from a
   `values` table. Two measurements narrow it: the eight draw attempts the
   reference walks are unexercised here (all 224 committed moves across
   eight seeds landed on the FIRST draw, so one stream suffices for this
   vocabulary, and `assets.ts` records that the enclosed kit needs more),
   and Z-3's band table admits a whole-number arrangement at every lap
   population from 200 to 460, so `quotaRebalance` cannot refuse a real
   lap.
2. **L-6's cover top-up and tiler.** Argued out on its merits long ago and
   the argument still holds: it reads a measurement the previous repair
   invalidated and draws from `seed + rounds`.
3. **L-4 landmarks, L-5 false edges, D-4's second pass.** Never fire on
   this vocabulary. A port of a rule that does not run has nothing
   end-to-end to check it with.
4. **The assembly of the placement list itself**, which is what would let
   the page stop calling `dressLap` at all.

**And a node was corrected by a fixture, which is worth recording.**
`quotaRebalance` refused bands no whole number of points could satisfy,
and a deliberately minimal five-point false-edge fixture cannot satisfy a
band of [0.04, 0.12] -- the floor needs one point, the ceiling allows
zero. Throwing killed a cook that had nothing to do with Z-3. Unreachable
bands are REPORTED now: no arrangement is right, so none is made, and
`unmetAttr` says so. The distinction the node draws is the one to keep:
a band list no population could satisfy is an authoring error and is
still refused outright by the two sum checks, while a band list THIS
population cannot satisfy is data, and a node that throws on data cannot
sit inside the loop it exists for.

**~~A defect the port surfaced and did not fix~~ — FIXED 2026-08-28, ON
BOTH PATHS.** The reference took the first eligible member of an over-full
band in station order, and a band's members are spread over the whole
circuit -- so "the first k" was a CONTIGUOUS STRETCH of track. Every
replacement the mix made landed in the first tenth of the lap, and every
share still came out exactly right. It was transcribed rather than
improved because a port that quietly changes the rule cannot be checked
against it, and `quotaRebalance` takes the order as a param so that
changing it later is one expression rather than a new node.

**MEASURED, THEN SHOWN, THEN TAKEN.** The paragraph above asked for the
picture before deciding, and that is what happened. Over seeds 1-6 on the
page's own configuration, the station order touches TWO lap tenths on
every seed with nothing in the other eight; a hashed priority touches
seven to ten. Longest contiguous run 4-9 falls to 2-3. What does NOT move
is everything the rule states: band shares are the same INTEGER in all six
bands on all six seeds, the placement count is identical, the station set
is identical, and every seed still converges. What moves is asset identity
on 12-18% of placements. Frames of the chase view -- the only viewpoint
the demo says the result is consumed from -- show a continuous canopy of
overhead furniture across the upper half becoming open sky and discrete
gantries, with a mid-lap control confirming it is a LOCALISED artifact and
not a change of look. Carlos looked at both and took it.

BOTH STATEMENTS MOVED TOGETHER, which the "cannot be checked against it"
argument above demanded: `repairBandMix` calls `mixDonorPriority` and
`writeBandMix` spells `randomFrom(attribute(PLACEMENT.station),
MIX_DONOR_KEY)`, one shared key constant, so the comparison suite still
compares. That hash is the LIBRARY's rather than the demo's `rand`, and
had to be -- the number is computed twice in two languages and must agree
to the bit, and no field can compute `rand`'s mix, since the grammar has
no bit operators. The choice was never between two hashes; it was between
the library's hash and no shared order at all.

### Z-3 is a graph, both halves, 2026-08-26

The mix's decision and its redraw are both nodes now. On a settled lap the
band shares come out inside Z-3 on all six bands -- over 0.106, verge
0.043, near 0.328, mid 0.398, far 0.125, distant 0.000 -- through the cull
that spends the loop undoing them, and all twenty seeds measured settle in
at most five rounds.

**What that leaves.** Of the repair loop's eight terms, five are graph
stages (Z-1, L-1, L-5, and now both halves of Z-3), two never fire on this
vocabulary (D-4's second pass, L-4), one never fires and is ported anyway
(L-5), and exactly one FIRES and is not ported: **L-6's cover top-up**, at
+1 to +2 a round. `dressGraph.ts` argued it out on its merits long ago and
the argument still holds -- it reads a measurement the previous repair
invalidated, and it draws from `seed + rounds`, so both halves of the
admission test fail.

**So the rules are done and the ARCHITECTURE is what is left.** This is
worth stating plainly because the rule list has been the plan for weeks
and is now finished. What stops a host generating a track from a
serialized graph and a spline is no longer a missing rule. It is that the
lap level's graph is BUILT from a cooked `Lap`: `placementCloudInTrackFrame`
turns a placement list into a cloud in TypeScript, through the lap's own
frame lookup, so the level cannot be constructed until the road has been
cooked and the list decided. `levels.ts` has said so from the day it was
written, and names the way out -- make the station process and the frame
lookup nodes. The station process IS a graph (`stationGraph.ts`). The
frame lookup is what `transferAlongPath` answers.

**The next unit is therefore the assembly**, not another rule: joining the
stages that already exist -- spline, road, stations, corner language,
asset choice, the repair body, the boxes -- into ONE graph with no
TypeScript between them. Every piece has shipped and been checked against
its rule; what has never been done is running them end to end without a
`cook` in the middle.

### What verification found in the redraw, and what it says about the suite, 2026-08-26

Five defects, and the suite was green through all of them. The lesson is
about the SUITE rather than about any of the five:

  - every `buildDressGraph` case in the rule-comparison suite switches Z-3
    off, because those cases measure the other three rules;
  - the band-mix suite cooked the stage standalone, with no lift and no
    loop;
  - the streamed-level suite feeds it a list `dressLap` has already
    balanced, so the quota marks nothing.

Nothing cooked an unmixed list through the loop with the mix on. Three of
the five defects were invisible for that reason alone, and the test that
closes the gap found all three in one run.

**P and `scale` were stale on every redrawn placement** -- both derived,
both computed before the mix rewrote what they derive from, measured at up
to 113 world units. Inside a loop that is worse than a plain bug: the next
round repairs it, so it only escapes on the round the loop STOPS.

**The settle signal could not see the mix**, which was an edit of mine that
failed silently -- a string replace with the wrong indentation and no
assertion that it matched anything. Every mechanical edit in this campaign
now asserts its match count; this is the one that did not.

**And the loop did not terminate on two seeds of twenty where `dressLap`
does.** The mix refills a band, the next round's cull pushes the
replacement off the racing line, the push changes its band, and the quota
marks it again -- it is still the first eligible member of that band in
the priority order, whatever that order is; hashing the priority spreads
WHICH placements are taken and does nothing about a placement being taken
twice. `repairBandMix` does not have this problem because it
remembers the pairs it has tried. `PLACEMENT.mixTried` is that memory, and
it bounds the mix by the population exactly as the reference's own pass
loop is bounded.

**Two tests were measuring nothing**, which is the same lesson one level
down. One walked only the placements the stage does not write and compared
`poseFor` to `poseFor`; the other could not reach the `cover:` half of a
table it claimed to check, because no lap produces a cover placement for
the mix to touch.

### The frame lookup is a stage, and what that leaves, 2026-08-26

`dressGraph.ts` carried a paragraph saying the pose at a station could not
be stated in a graph -- "there is no node that samples a path's frame at a
per-point arc length for a foreign cloud, so the interpolation `poseAt`
does cannot be stated here. It is reported rather than worked around."
`transferAlongPath` is that node, and its own description opens by naming
the operation "the library had no node for". The gap had been closed and
the demo never came back to it; `sampleTrackFrame` is the demo using it.

**A placement now arrives holding track coordinates and nothing else** --
`stationW`, `trackT`, `trackH`, its asset's extents -- where it used to
arrive carrying the lap's own frame at its station, four columns baked in
by a TypeScript lookup per placement run when the graph was BUILT. That is
the difference between a list and a picture of one: a cloud carrying a
frame is an answer about the lap it was built against, and only the other
one survives being written to a file. `dressGraph.ts` no longer imports
`dress.ts` at all.

**The two sides now sample the lap at different stations, and that is a
finding rather than a tolerance.** The graph gathers at the station its
COLUMN holds, which is f32; `buildBoxes` gathers at the double the
placement OBJECT holds. Measured, the whole disagreement is a slide ALONG
the track of 0.67-0.71 f32 spacings of the arc -- 2.8e-5W, which
`tolerance.ts` already calls the same point on the lap by a factor of
thirty-five -- with the perpendicular component an order below it. Two
roundings at half a spacing each is the derivation and 1.5 spacings is the
bound; the first draft said 2, which was 1.5 rounded up to what the box
comparison needed, and a derivation that produces a different number from
the one written above it is worth nothing.

**What the assembly still cannot do, which is now the whole of it.** Three
columns on that cloud are not derivable in a graph today, and each is the
output of a rule that is still TypeScript: `cover` is L-6's, `locked` is
L-2/L-3's marker vocabulary, `mixPinned` is L-4's landmarks. So
`placements` cannot leave the `dataInput` list without those. L-4 NEVER
FIRES on the shipped kit and L-6's cover top-up was argued out on its
merits above, so porting either one to satisfy a structural goal would be
the tail wagging the dog. **That is a decision to take deliberately rather
than a unit to pick up**: either the remaining rules get ported because a
serialized track is worth it, or the placement list stays something a
caller hands in and the demo stops claiming otherwise.

**Verification found four real defects in the test I wrote to prove this,
and the pattern is the same one as last time.** The test asserted
positions and printed the axes -- so swapping `up` and `across`, or
dropping the `normalize` that is the only reason an interpolated frame is
unit, both passed it. The axis bound was then sized at 1e-4, thirty-seven
times the truth and inside one percent of the un-normalized failure: a
bound that catches that fault on this lap and misses it on a gentler one.
Both faults were injected and measured before the bound was moved to sit
between them, and the margin is asserted rather than only printed. The
global slide check divided one placement's worst by another's arc, which
is not a quantity; the exact claim -- that the station column holds the
f32 nearest its double, to half a spacing -- has no geometry in it and is
what the suite pins now.

### Correction: what actually blocks the list, 2026-08-26

The entry above says three columns are undeliverable in a graph and names
`locked`, `mixPinned` and `cover`. Two of those three are wrong, and the
error is worth naming because it would send the next unit at the wrong
target.

**`locked` and `mixPinned` are derivable.** `locked` is L-3's brake marker
id and `cookReserveMarkers` is already a graph. `mixPinned` is that
reserved set together with `landmarkAssets`, which is "the assets used
exactly once on the lap, then the lowest id in each tenth" -- a count per
asset and a minimum per bucket, which is the shape of half the stages in
this demo already. What never fires is L-4's REPAIR; its SET is a
statistic over the list, and those are two different claims that got
collapsed into one.

**`cover` is the real blocker and it is not a flag.** L-6 does not mark
placements, it MAKES them: `tunnels.ts` pushes cover pieces and
`dress.ts:838` appends them to the list. So a graph-built list is not a
list with one column missing, it is a list sixteen entries short. L-2 and
L-3 add entries too. That is the honest shape of what is left: the
remaining rules do not annotate the list, they EDIT it, and a list a graph
owns has to own those edits.

### The map, measured, 2026-08-26

Scoping the node-built list turned up three corrections and one finding
that changes what the remaining work IS.

**"Sixteen entries short" was wrong by an order.** One L-6 plan tiles into
`ceil(lengthW/alongW)+1 x columns` pieces: measured at 49, 108 and 132 from
a SINGLE plan. A lap takes 0 or 1 stretches, so the list is short by
nothing or by up to 132 -- and the 16 in the demo's stat line is pieces
per RUN, not per lap. That is the difference between a rounding error and
the largest single edit any rule makes.

**`placements` is not the only derived `dataInput`, which is what I have
been telling myself for two sessions.** `mixPinned` is a statistic over
the FINISHED list and it reaches the graph in three separate places: the
per-point column, `mixAssets.free`, and the `mixBandPools` literal. So two
of the five inputs are derived, not one, and removing `placements` alone
would still leave a graph that cannot be built until a lap has been
dressed.

**The stages are already joined; the page is what is not.**
`cookLapPlacements` puts the station stage, the coverage repair, the asset
choice, Z-1 AND the corner language into one graph with ONE cook. The four
cooks the page runs are a property of `main.ts`, not of the stages. Two of
them could merge today. `cookReserveMarkers` cannot join them, and the
reason is sound rather than incidental: a choice is an INDEX INTO THE POOL
that reservation produces, so it cannot be a stage inside the graph that
consumes its answer.

**And the finding: essentially no new library nodes are needed.** `arcTile`
already IS L-6's tiler -- its own description says "the tile-a-tunnel-out-
of-one-rib operation... ENCLOSURE IS A PATTERN, NOT AN ASSET" -- and
`pathCoverage` is already wired as `writeCoverage`, doing `measureEnclosure`'s
job in nodes. `runFit` and `pathRuns` find the stretches. The L-2/L-3 edits
are `setAttribute` under a predicate, `filterByExpression` and
`mergePoints`, with the indices already handed over by the bookkeeping.

**What blocks L-6 is the LOOP, and that argument is already settled here.**
`placeEnclosure` draws from `seed + rounds`, and a body whose seed varies
per round has no fixed point -- which is why `buildRepairBody` already
excludes it, in writing. The cost of running it ONCE instead was measured
above: one mix move and one cull move per lap, on two seeds of six. So
L-6 outside the loop is not a compromise forced by the port; it is the
arrangement the graph already has, at a price already paid.

**L-4's repair confirmed idle: 0 moves on 8 of 8 seeds** of the shipped
vocabulary, 64-85 unique assets per lap against a guard that needs a tenth
with none. `tests/racetrackDress.test.ts:199` lists the stages a lap must
exercise and L-4 is deliberately not among them. Its SET is another
matter and stays on the critical path, as the entry above says.

**So the assembly is finite and its shape is known**: L-6's list
generation is the one substantial rule left, the nodes it needs all ship,
and the loop question it used to raise has already been decided and
priced.

### L-6's planner is a real rejection sampler, and `randomFrom` is what ports it, 2026-08-26

MEASURED ON THE SHIPPED VOCABULARY, which matters because the scoping pass
above reported different numbers from a different catalogue:

  - **2 cover candidates out of 229 assets.** The asset draw inside a plan
    is very nearly binary.
  - **1, 1, 2, 1, 4, 3, 1, 1 stretches** across seeds 1-8, at **16 to 26
    pieces** per lap. Not "up to 132": that figure is a bigger budget on a
    catalogue this demo does not ship. The list is short by a couple of
    dozen entries, which is still the largest edit any rule makes.
  - **The clash test IS exercised.** Forced to budgets that want several
    stretches, overlap rejections run 0-2 at realistic budgets and 33 at
    160W. It is not dead code, which is what I was hoping to find.

**So this is NOT Z-3 again.** Z-3's greedy search turned out to be a
closed-form quota fill once the pairs were traced. This one does not
collapse: `planEnclosure` accepts or rejects each candidate against the
set it has already accepted, and that set is what the predicate reads.

**It is still portable, and by the node this session added for something
else.** The obstacle looked structural -- a rejection sampler needs a
fresh draw per attempt, `repeatUntil` deliberately does not rotate its
body's seed, and a body cannot see its own iteration index. But it does
not need to: THE CARRY CAN COUNT. A detail attribute incremented once per
round is an iteration index, and `randomFrom` keyed on it draws a fresh
uniform per round without the seed moving at all. That is exactly what
`randomFrom` is for -- a draw keyed on a VALUE the graph computes -- and
the pose was only the case that found it.

The rest is existing vocabulary: `attributeReduce` over the accepted cloud
answers "does this candidate clash", `mergePoints` appends the one that
does not, `transferAlongPath` reads the radius and the corner columns at
the candidate's start, and `arcTile` tiles the accepted stretch into
pieces.

**What will NOT match, and the precedent for accepting it.** `rand(seed,
k, salt)` and `randomFrom(k, salt)` are different hashes, so the graph
plans different stretches from the same seed. Z-3's redraw made the same
trade for the same reason and is checked on its POSTCONDITION instead:
here that is no two stretches within `separationW`, none starting inside a
tight corner or within `flareW` before one, and covered length within one
draw of the budget.

### L-6's budget is a graph stage, and its trim never fires, 2026-08-27

`longCoverBudgetW` reads two numbers off the ray cast and does scalar
arithmetic on them, so the port is really the two numbers: the covered arc
and the arc held by stretches longer than `heavyW`. Both are path scans
over the coverage mask `pathCoverage` already writes.

**`pathRuns`' two directions do not share a boundary set, which cost two
bugs.** Marking only where cover BEGINS makes one run out of a covered
stretch and the uncovered lap after it -- the long total came out 7.3W
high. Cutting at every transition fixed that and left 0.385W, exactly one
frame pitch: forward runs make a boundary frame the FIRST of its run and
backward runs make it the LAST, so one flag through both directions
describes two run sets offset by a frame, and adding the arcs from both
overcounts by the frame the backward scan reaches into the next run. A
probe on ten points made it obvious in a way staring at a 900-frame lap
did not. The fix is a second boundary, `runEnd`, one `pathShift` from the
first.

**`reduceEnclosure` NEVER FIRES on the shipped kit** -- `enclosureTrims` is
0 on 8 of 8 seeds -- and the mechanism says why: it reduces a lap that is
over L-6's 25% ceiling, and the demo runs at 8.8%. That is the same
argument L-4's repair lost, and it loses it for the same reason: porting a
rule with nothing end to end to check it would leave a stage whose only
possible test is a synthetic lap built to make it fire. So L-6's port is
the planner, the tiler and the budget, and the trim is named as skipped
rather than quietly missing.

Measured against `measureEnclosure` and `longCoverBudgetW` on four laps,
in both branches -- a dressed lap already holds its cover and asks for
nothing, a bare lap asks for the population's median share: worst
|dCovered| 5.4e-3W, |dLong| 1.6e-3W, |dBudget| 1.6e-6W.

### L-6 is wired into the dress graph, 2026-08-27

The planner, the tiler and the budget now run inside `buildDressGraph`,
between two passes of the repair loop: settle, measure the cover the lap
already has, plan and tile what it is short of, merge, settle again. The
second pass is `dressLap`'s own arrangement rescheduled -- it adds cover
INSIDE its loop and the rounds after repair what it added -- and it is
what gives the pieces the cull's verdict on a lap that now has tunnels in
it. Z-1 leaves them alone by itself, which is what `PLACEMENT.cover` is
for.

**Measured on a lap with its cover stripped out: 11, 16, 16 and 4 pieces
over four seeds**, covered share 7.3 to 14.7% against the reference's 8.8%
on the same laps, converging every time.

**AND IT IS A NO-OP IN THE PAGE TODAY, which is worth stating plainly.**
`main.ts` hands `buildDressGraph` the list `dressLap` returns, and
`dressLap` has already run L-6 -- so the graph measures an enclosed lap,
computes a budget of zero, correctly adds nothing, and the picture is
byte-identical. The value is for the caller who has NOT run it, which is
the caller this whole port exists for. Wiring the page to stop running L-6
in TypeScript is a separate change and a bigger one, because `dressLap`
threads cover through the rest of its loop.

**That no-op is also what made the first version of the test worthless.**
It counted cover placements on the graph's output and found sixteen --
every one of them arriving in the INPUT. Deleting the merge outright left
all fifteen tests green. The test now strips cover from the input, which
is both the honest input and the only one where the stage has anything to
do, and asserts the list GREW; the merge cannot be deleted under it.

One assertion had to be withdrawn rather than fixed: a MEASURED covered
stretch is shorter than the PLANNED one. A stretch is planned at 10W or
more, but the rays count a frame only when three of six hit and the flare
deliberately lifts the roof over the first and last 2.5W of every run, so
a 10W tunnel measures about 5W in its middle. Requiring 10W failed at 7.3W
against a rule that was working correctly.

### What verification found in the assembly, 2026-08-27

**A regression I introduced, and it fired where L-6 does nothing.**
Renumbering `PLACEMENT.id` over the MERGED list destroyed what that column
means -- "where this placement sat in the list the graph was handed",
which is what the cull's own reporting subtracts against. It ran after a
pass that had already dropped members, so on seed 5, 337 of the survivors
named the wrong input row, the worst 9.4W away; seed 7, 21 rows; seed 8,
330. Seeds 1-4 drop nothing in the first pass, so the ids coincidentally
lined up and every test passed. It also silently corrupted the frame
suite's own `dressing.placements[idOf.get(i)]` lookup, whose
`toBeDefined()` guard cannot catch an off-by-k. The originals keep their
numbers now and a piece takes the next number past the list.

**`GraphDressing.dropped` had gone negative** -- -11 to -16 on a bare lap
-- because it measured a list that had grown. The invariant it documents
(`pushed + dropped` is the cull's blocking count) had quietly stopped
holding and nothing asserted it. Measured against the first pass now.

**Three of four mutants passed the new test.** Dropping the frame sample
put every piece at the world origin -- 11 of 11, 16 of 16 -- and all nine
assertions stayed green, because `share` reads the ordinary dressing's own
cover and the `> refShare * 0.5` bound is loose. Emitting every tile at
its run's start collapsed sixteen pieces into a 13m box and passed.
Pinning columns to 1 passed here (the enclosure suite catches it). Each
now has an assertion sized against what it must catch, and each was
re-injected to prove it fails.

**Two latent hazards, named rather than fixed.** L-1 has NO cover
exemption, so a blocking piece would be pushed up to 6.5W along `across` --
the same hole in the roof Z-1 exempts cover to avoid -- and nothing
reaches it only because a tunnel's base sits above the eye. And
`PLACEMENT.poseU` is the one column a piece lacks that the body reads; it
is inert because the mix excludes cover, and it is the first thing to
write if that ever changes.

**The second repair pass has never paid out.** Over 16 seeds it moved
nothing, dropped nothing, and `final === first + planned` exactly -- at a
cost of 3 to 4 rounds a lap. It is insurance against a tunnel blocking a
sightline, which the measurements say does not happen on this kit. Worth
knowing before anyone optimises it away: the argument for it is
correctness on a kit whose cover sits lower, not a measured effect here.

### `enclosure: "deferred"`, and what still stands between the port and the page, 2026-08-27

`dressLap` takes an option saying who builds L-6: itself, or something
downstream. It is a SKIP rather than a hand-in, which is where it parts
company with `stations`, `choices`, `language` and `bookkeeping` -- those
take a graph's ANSWER and leave `dressLap` the authority on the list.
Enclosure cannot work that way round: the budget it spends is measured
from boxes built out of the SETTLED list, which does not exist until
`dressLap` has finished. So the graph runs later and `dressLap` stands
aside.

The graph now also reports what enclosure did rather than leaving a caller
to infer it: `shareBefore` beside `share`, and the pieces and runs it
built. A run is identified by its start station, which is unique because
the planner keeps runs `separationW` apart -- sixteen pieces is a fact
about tiling, three runs is the fact a reader of the lap would state.

**THE PAGE STILL RUNS L-6 IN TYPESCRIPT, and the reason is scheduling
rather than correctness.** `main.ts` prints its enclosure stat
synchronously, straight after `dressLap` returns; the graph's L-6 runs
inside the lap LEVEL, which the World cooks later and asynchronously. So
switching the page over means moving when that stat appears, which is page
chrome and touches the streaming path. The rule is ported, tested against
the reference on four laps, and exercised through the real option -- what
is left is where the number is printed.

### The corner bookkeeping is 7 nodes for every lap, 2026-08-27

L-2's conversion and L-3's payment were both UNROLLED -- a node stage per
corner, and per (corner, mark) -- so a lap with 25 corners built a bigger
graph than one with 15. A graph whose SHAPE depends on the spline cannot
be serialized once and re-run against another track, which is the whole
point of putting these rules in a graph.

Both are loops now, and the measurement is the claim: **7 nodes on every
lap**, over corner counts of 19, 15, 25, 15, 21 and 15 and tight counts of
9 to 13. Adding one node per corner back breaks it immediately (26 / 22 /
32 / 22 / 28 / 22), which is what makes the assertion worth having --
every OTHER test in that file passed with the graph still unrolled,
because behaviour never changed. It still has not: the bookkeeping matches
the shipped reference exactly on all four seeds (9+10/-25, 13+6/-22,
13+6/-24, 10+9/-27).

**The two reasons the code gave for the unroll had both stopped being
true.** "A `repeatUntil` body cannot see its own iteration index" -- the
node cannot, and the CARRY CAN COUNT, which is what the enclosure planner
runs on. "`repeatUntil` carries exactly one pin and this needs two
populations" -- it carries one carry plus as many broadcast inputs as the
body exposes, and `buildRepairBody` already uses two.

`cookCornerBookkeeping` is split into `buildCornerBookkeeping` + a cook,
the same way `buildDressGraph` and `dressLapByGraph` are, because a
topology claim cannot be checked through an entry point that throws the
graph away.

**What is left before `placements` can leave the `dataInput` list** is the
join itself: `cookLapPlacements` already puts stations, the coverage
repair, asset choice, Z-1 and the corner language in ONE graph with one
cook, and `buildDressGraph` builds a second. Joining them is now a wiring
question rather than a topology one.

### `placements` has left the `dataInput` list, 2026-08-27

`DressGraphInput.placements` is OPTIONAL now. Left out, `assemble` builds
the stations, D-4's coverage repair, the asset choice and the assembly from
the lap path and runs every rule over the result; nothing about the lap is
data in the graph except the path itself, which is what `graph.ts` has
always said it should be. Measured: the list the dress graph decides is
EXACTLY the list `cookLapPlacements` decides, station for station, on three
seeds -- 969 placements, no list handed in, settling and stamping and
building cover.

**Three findings, in the order they cost time.**

**1. The order of the list is not read anywhere, and that had never been
measured.** The assembly's cloud comes out in the scatter's order --
`pointScatterOnPath` lays stations down with no relation to arc position,
165 descents in 329 points on seed 1, before the repair -- where
`cookLapPlacements` sorts its rows in TypeScript. Every stage that cares
takes the order as a parameter (`pointsToPath`'s `orderAttr`,
`quotaRebalance`'s priority) and both already passed the station. Shuffling
the list with Fisher-Yates and dressing both ways gives 1411 placements
agreeing exactly across four laps with Z-3 on. This nearly cost a new
library node: there is no node that sorts a cloud by an attribute, and
`gatherPoints` (`src/nodes/util.ts:867`) plus `canonicalPointRanks`
(`src/data/identity.ts:239`) is the recipe if one is ever wanted --
`gatherPoints` already accepts a permutation, and the repo's tie-break
convention is to end every comparator in the point index.

**2. `ASSET.id` and `PLACEMENT.asset` are the same string, `"assetId"`.**
The kit's numeric id and the pose name a spawner keys batches by. Nothing
had ever put both on one cloud, so nothing had noticed; the assembly does,
and stripping the numeric one after writing the string deletes the string.
The strip runs first.

**3. The frames are not the path the stations want -- AND THIS IS THE
KNOWN GAP, MET FROM THE OTHER END.** `assemble` first scattered on the road
graph's own frames, since `readLap` reads the lap out of them: one fewer
reconstruction. Every station came out 0.018585W from where
`cookLapPlacements` puts it, which is 0.1673 world units, which is exactly
the difference between the two lengths the same geometry reports --
3121.533 and 3121.365 on seed 1, 0.0054%.

That is "Two arc lengths, one parameter" above, found on 2026-08-19 and
still open: `pathResample` reports `lengthAttr` for the CURVE it sampled
while emitting the polyline THROUGH the samples, which is shorter. That
entry met it as a slide that landed two frames ahead; this meets it as a
population count, because `lapLen` decides how many stations there are and
0.0054% re-lays the whole scatter. `lapAsPath` writes the chord length,
which is what `lap.lengthW` is and what every rule speaks in, so the
stations scatter on that.

**It now has a second caller, which is the argument for fixing it.** The
fix that entry names -- `pathResample` publishing the parameterization it
emits, a `resampledLengthAttr` or a `sampleU` -- is exactly what would let
the stations scatter on the frames directly and delete `lapAsPath`. It was
parked as helping only a caller who already knew to look; there are two of
those now, and the second one is on the path to the endpoint.

**What is left.**

1. **The corner language.** `dressLap` merges L-2's markers and L-3's ruler
   marks into the list at its step 4; `addLapPlacements` stops before that,
   so a self-decided lap carries no corner vocabulary. The language is
   already a graph -- `addCornerLanguage`, which `cookLapPlacements` cooks
   beside the stations -- so what is missing is the merge, not a rule. This
   is the next unit.
2. **`mixPinned` and `mixBandPools`.** The first reaches the graph three
   ways and should be derived in-graph; the second is a build-time literal
   by design and probably stays one.
3. **The page.** `main.ts` prints the enclosure stat synchronously and the
   graph's L-6 runs in the lap level, cooked later. A scheduling question,
   untouched.

**And an observation the assembly surfaced without explaining**, written
up as its own Backlog entry above -- "A settled lap has placements inside
the corridor".

### L-2 and L-3 are placed by the graph, 2026-08-27

`addLapPlacements` takes a marker kit now. Given one it runs
`addCornerLanguage`, turns its two clouds into placement rows, and merges
them into the lap: every corner carries its marker and every tight corner
its three ruler marks, checked by the rules' OWN gates
(`cornerMarkersSatisfied`, `brakingRulersSatisfied`) rather than by a
restatement of them. 59 corners marked and 102 marks over three seeds.

**A marker is an asset at a station, which is what a placement is.** That
is the whole reason this needed no new vocabulary: the corner language
decides four numbers per mark -- station, lateral, height, and which of the
three reserved assets -- and the assembly wants an ord plus those same
three. So `addPlacementAssembly` runs a SECOND time over the language's
rows rather than the language getting its own spelling of the pose draw,
the extents lookup and the id string.

Two things had to move to make that true. The station lookup became
OPTIONAL: a chosen row carries a station INDEX, because `copyToPoints`
writes the target's index and not its columns, and a marker carries a
station VALUE with no station cloud to be an index into. And the extents
are GATHERED now instead of riding the copy, so a row needs an ord and
nothing else.

**The lookup table split from the redraw's pool, and the reason is a rule.**
Z-3 draws from `mixAssetCloud`, and a marker in it is a marker the mix
could scatter round the lap -- which is precisely what `reserveFor` exists
to prevent. But a CONVERTED placement carries a marker and still needs its
extents and its poses. So `placementAssetCloud` is the table a placement is
LOOKED UP in (pool then sharp, open, brake) and `mixAssetCloud` stays the
table Z-3 DRAWS FROM. `placementAssetRows` is the one definition of the ord
space, so the choice never learns that the table it picks from is a prefix
of a longer one.

**`PLACEMENT.id` moved out of the assembly.** The assembly builds one KIND
of row and now runs twice, so `index()` there numbers both from zero and
gives every marker the id of an ordinary placement. It is written once, in
`addLapPlacements`, over the merged cloud -- the first moment the list
exists.

**HALF OF L-2/L-3 IS DELIBERATELY NOT WIRED, AND THE COUNT SAYS SO
EXACTLY.** `placeCornerLanguage` does four things: CONVERT an ordinary
placement into a marker, ADD one where no victim fits, place L-3's marks,
and DISPLACE what those marks pay for. The two placements are done; the two
bookkeeping halves are not -- `buildCornerBookkeeping` already decides both
as columns (`VICTIM.claimedBy`, `VICTIM.displacedBy`) and what is missing
is applying them. Rather than describe that, the suite asserts the list is
exactly `chosen + corners + 3 * tight`. The moment a conversion replaces an
addition, that equality fails, so the next unit cannot land silently.

**What verification found, and it was two things the suite could not see.**
The corner stages resolve a whole corner model onto their clouds, and all
of it rode into the placement list through the merge -- 45 columns instead
of 23, through the whole repair loop, chosen rows getting 0 for each from
the merge default. Inert, since nothing downstream reads `cornerEntryW`;
but `arcW` is live scratch in three modules and was one rename from meaning
two things on one cloud. `CORNER_LANGUAGE_SCRATCH` in `cornerGraph.ts` is
the producer stating what it leaves behind, and the rows stage drops it
before the assembly. The column-set assertion existed already and ran only
on the no-marker path; it runs on both now.

And the case handed in `immovable` and `mixPinned`, said in a comment that
the markers were protected, and asserted nothing that depended on it. Run
with both sets EMPTY every assertion still passed, while seed 3 came out of
the repair loop holding 19 of its 25 markers -- Z-3 redrawing corner
vocabulary into ordinary scenery, invisible. The case reads
`placementsInput`, which is the list BEFORE any rule ran; it now also
counts what survives the loop.
**What the other half needs, scoped while the placement half was built.**
Applying `buildCornerBookkeeping` is four operations and only one of them
is hard.

1. **CONVERT is already computed.** `addConvertStage` rewrites
   `VICTIM.assetOrd` to the marker's ordinal INSIDE the loop -- it has to,
   because the next corner's histogram must count the marker rather than
   the asset it replaced -- and the ordinal is `-1 - row`. So applying it is
   a select on the placement cloud, `ord = ordBase + (-1 - vAssetOrd)` where
   `claimedBy >= 0`, plus a gather of that corner's decided lateral and
   height from the marker cloud by `claimedBy`. The station stays the
   placement's own, which is L-2's rule.
2. **DISPLACE is a filter**, `displacedBy < 0`, run once after both loops --
   which is exactly why the bookkeeping names victims by their index in the
   list AS IT ARRIVED and removes nothing itself.
3. **ADD is the hard one**, and it is the inverse of a gather: a marker row
   is wanted only for a corner NO placement claimed, and the cloud that
   knows is the PLACEMENTS while the cloud that needs to know is the
   CORNERS. `transferByIndex` goes the wrong way. The idiom that fits is a
   proximity transfer -- lay the claimants out at `P = [claimedBy, 0, 0]`,
   lay the corners at `P = [index(), 0, 0]`, carry `claimedBy` across with
   `transferAttribute`, and a corner is claimed iff what arrives equals its
   own index. It needs a guard row for the lap that claimed nothing, the
   way `mixPoseCloud` carries one. Worth measuring against the alternative
   -- `pointsToPath` grouped by `claimedBy` and a scan -- before choosing.
4. **The ord space has two spellings of "marker" now** and they should not
   both survive: `VICTIM.assetOrd` says `-1 - row` and `placementAssetRows`
   says `poolLength + row`. The first is the bookkeeping's own and predates
   the second. Converting between them is one expression, but a reader
   meeting both will assume they agree about something they do not.

### The corner language is finished, 2026-08-27

All four of `placeCornerLanguage`'s operations are graph stages now --
CONVERT, ADD, the ruler marks, and DISPLACE. The lap the graph builds
matches the lap the rule builds placement for placement, keyed on station,
asset, lateral and height, on three seeds.

**The interesting part was an off-by-one that turned out not to be a bug.**
Seed 3 built 348 where the reference built 347. Every marker matched -- 8
sharp, 17 open, 39 brake -- and the extra was an ORDINARY placement, so one
displacement had not happened.

**The rule is not order-invariant, and the graph and the reference were
visiting in different orders.** `placeCornerLanguage` scans with a strict
`>`, keeping the first maximum in the order its list is held, and every
caller holds it in station order. `addVictimSearch` ranked by ROW INDEX,
which says the same thing only while the cloud is sorted -- and the dress
graph's is not, because `pointScatterOnPath` lays stations down in an order
unrelated to arc position. Measured over six shuffles of one lap: the same
corners claim the same NUMBER of victims but a different SET, two to six
rows moving, and L-3's displacement count itself moves between 34 and 35,
because a different pick leaves a different candidate in the next window and
a window that runs out stops early.

So the answer depended on how the cloud was stored. The rank is the STATION
now, with the row index kept as a second key -- two placements at one
station with equal counts would otherwise both match and a corner would
claim two, which `cookLapPlacements` makes unreachable through this demo
but which the function cannot assume, since it takes any list a caller hands
it. Order invariance is a permanent test in
`tests/racetrackCornerBookkeeping.test.ts`, and it separates the two rules
on all four seeds (2/8, 2/4, 2/2 and 0/6 rows moving under index rank).

**A mutation exposed a limit in the new comparison, which is now stated in
the test.** The corner-language case compares against `placeCornerLanguage`
fed `booked` from `cookCornerBookkeeping` -- which runs the SAME
`addVictimSearch` the graph does. So a defect in the victim search moves
both sides and that case stays green: flipping the station rank from min to
max leaves it failing only on its own premise assertion, for the wrong
reason. What owns the search is the bookkeeping suite's hand-written
TypeScript `reference()`, an independent implementation, and it does catch
the flip. The case owns the APPLICATION instead, where the two sides really
are independent.

**And the comparison key needed two more columns.** Verification found that
swapping the drawn lateral and height between two conversions whose corners
share severity and side is invisible to the whole case: the multiset is
byte-identical and both rule gates still pass, because
`cornerMarkersSatisfied` checks only the SIGN of the lateral and that the
height is in the marker band -- and every marker's height is drawn from that
band. Seeds 1, 2 and 3 each have such a pair. The key carries `t` and `h`
now.

**Three smaller things it also found.** The unclaimed-corner test clobbers
`P` to a corner ordinal to ask its proximity question, and the added markers
were being published with that ordinal still in `P` -- inert, because
`sampleTrackFrame` overwrites `P` before anything reads it, which is exactly
why it would not have been noticed; the answer is carried back onto the
untouched rows now. A lap where L-3 displaced every surviving placement
would take the cook down with a library-level message that names neither
this demo nor the fix; it is unreachable and named rather than guarded. And
`SEVERITY.tightW` and `BRAKING.tighterThanW` cut the same set of corners
from two different files, equal by coincidence -- `displacedBy` indexes the
TIGHT corner list, so a divergence would attribute a ruler's victim to a
different corner with both sides still running. One assertion pins them.

**What is left of the lap prelude.** The rules are done and so is the
assembly. `mixPinned` still reaches the graph three ways and could be
derived in-graph; `mixBandPools` is a build-time literal by design. The page
is the remaining piece, and it is a scheduling question rather than a rule:
`main.ts` prints the enclosure stat synchronously while the graph's L-6
cooks later.


### The page runs the graph's L-6, 2026-08-27

`main.ts` passes `enclosure: "deferred"` now, and the two panel lines that
describe the drawn lap are filled from the lap LEVEL's cell rather than
from `dressLap`. That was the last thing the page ran in TypeScript, and
the entry above was right that what remained was scheduling: the rule
needed no work at all.

**WHAT WAS ACTUALLY WRONG WAS WORSE THAN A MISPRINTED NUMBER.** The graph
has run L-6 since it was ported, and on the page it was INERT -- `dressLap`
enclosed the lap first, so the level measured a lap that was already
covered, computed a budget of zero and correctly added nothing. Every
tunnel on screen was the TypeScript one's. The dress-graph suite had
written that failure mode down when it hit it in a fixture
(`racetrackDressGraph.test.ts`: "deleting the merge outright left all
fifteen tests passing") and the page was living in it. Deferring is what
makes the ported stage the one that builds them; the visible difference on
seed 1 is one run of 16 pieces becoming two of 11.

**THE STAT IS NOW A DIFFERENT MEASUREMENT AND THE "BEFORE" MOVED MOST.**
0.6% -> 8.8% became 4.8% -> 8.3%. The after is the same quantity read by
the same ray cast; the before is not. `dressLap` reports the incidental
cover it measured on its FIRST round, before its own repairs ran; the graph
reports `coverageFirst`, which is the settled list -- Z-1, L-1, L-5 and Z-3
at their fixed point -- with no enclosure in it. Both are honest answers to
"what did this path start from" and they are not the same question, which
is worth knowing before anyone reads the drop as a regression.

**THE PLACEMENT COUNT HAD TO MOVE WITH IT, and that is not decoration.**
L-6's pieces ARE placements, so a count taken from the prelude beside a
cover share taken from the level describes two laps: measured, the level
settles the prelude's list plus exactly the pieces it built -- 11, 16 and
16 on seeds 1-3 -- which is 3-5% of `/W`, enough to move the D-1 verdict
printed next to it. Both lines now say `cooking the lap` until the cell
lands, in the same words the `sectors` readout already used, rather than
filling the window with numbers about a lap the page is not drawing.
`scripts/capture-demos.mjs` learned that phrase too: it is a non-empty
string, so the readiness rule would have taken it and photographed a lap
with no tunnels on it.

**`readEnclosure` IS THE ONE READING, and the test is an equality between
two schedules.** `dressLapByGraph` cooks the graph and has the figures on
the next line; the page hands the same graph to a `World` and gets them in
`onCellReady`. `tests/racetrackLevels.test.ts` drives the World, reads the
cell through the page's own handle, and asserts the four numbers and both
per-frame arrays equal a cook of the same input -- exactly, since a
tolerance there would be admitting the page and the suite measure different
laps.

**What is left of the lap prelude.** `mixPinned` still reaches the graph
three ways and could be derived in-graph; `mixBandPools` is a build-time
literal by design. L-6's TRIM is the one half of the rule still in
TypeScript -- `dressLap` runs `reduceEnclosure` whatever `enclosure` says,
because a kit whose vocabulary is half overhead pieces can pass the rule's
ceiling with no enclosure pass having run. It is not urgent: the graph's
own budget subtracts what is already covered from the ceiling, so it cannot
push a lap past it, and on the shipped vocabulary the trim finds nothing to
do on any seed. What it protects is the case where the ORDINARY dressing is
already over, which is a property of a kit rather than of this one.

### L-6's trim is a graph stage too, 2026-08-27

**THIS REVERSES "L-6's budget is a graph stage, and its trim never fires"
ABOVE**, which decided against the port and gave a reason worth restating
because it was half right: "porting a rule with nothing end to end to check
it would leave a stage whose only possible test is a synthetic lap built to
make it fire". Carlos asked for it anyway. The measurement that decision
rested on still holds -- across seeds 1-8 at density 1, 2 and 3 the shipped
vocabulary tops out at **20.0% against a 25% ceiling**, so the trim has had
nothing to do in 24 laps -- and what was wrong was the conclusion about
testability, not the measurement.

**THE FIXTURE IS MOSTLY REAL, WHICH IS WHY THE ENTRY ABOVE WAS TOO
PESSIMISTIC.** Seed 1's actual dressing plus ten copies of one wide
overhead piece reaches **31.3% of lap, 17 stretches, 41 trimmable of 364** --
and `reduceEnclosure` takes that to 24.9% in 8 moves over 6 runs. Only the
exact-station-tie cases need a synthetic lap, and they need one for a reason
that is itself a fact worth having: a real lap's f32 arc lengths never put a
placement exactly on a frame, so the tie is unreachable at unit pitch or
not at all.

**WHERE IT RUNS: the SECOND repair pass, not the first.** The trim is a
ceiling repair on a finished lap, and the first pass settles a lap with no
enclosure in it -- the budget the top-up spends is measured from exactly
that lap, so trimming there would move the incidental overhead the budget is
sized from and the top-up would then spend a figure describing a lap that no
longer existed. In the second pass the trim's moves are re-culled by the
next round and the loop converges only when the trim has nothing left to do,
which is what "at convergence the last trim saw the final list" means in
`dressLap`. `dressLap`'s `enclosure: "deferred"` now stands down BOTH halves
of L-6 rather than one, so nothing trims twice.

**THE COST IS NOT MEASURABLE.** A coverage pass is ~25 ms against a ~950 ms
lap cook, and the loop settles in a round or two: 743 / 822 / 1073 ms with
the trim in, against a 999 / 897 / 926 ms baseline. That is inside
run-to-run variance on this box.

**HOW A PLACEMENT LEARNS WHICH RUN IT IS IN, which was the whole of the
difficulty.** No node does an arc-parametric DISCRETE lookup:
`transferAlongPath` interpolates and lands everything as f32, so a run
identity taken through it arrives blended, and `transferAttribute`'s nearest
mapping asks in space, where a hairpin puts the far side of the corner
within reach. So the frames and the placements are MERGED into one path
ordered by station and `pathRuns` propagates the run across it -- a
placement carries no boundary flag, so it never cuts a run, it inherits the
one it falls inside. The merged cloud is a side branch; three numbers come
back onto the real cloud by ordinal, which is what preserves the polyline
topology L-5 built and `DRESS_OUTPUTS.placements` publishes.

**FOUR DEFECTS, ALL FOUND BY INDEPENDENT AGENTS AND NONE BY THE AUTHOR.**
Worth listing because three of them were invisible to a green suite.

1. **The run's LOWER end was exclusive; `inRun`'s is inclusive.** Merging
   the placements first buys the inclusive UPPER end -- a placement at
   exactly `endW` sorts before the frame that ends the run -- and pays for
   it at the lower end. Frames first only swaps which end is wrong. The
   repair is after the fold: a backward run cut at the covered-run starts
   carries the next start's key and station, and a placement that landed in
   a gap whose station equals that start adopts it.
2. **The global `overheadCount <= keepOverhead` refusal had no port.** The
   reference breaks before it looks at a run and says `blockedByBandMix`;
   the port said `nothingToTrim`. That is exactly the confusion the two
   flags exist to prevent -- one says the vocabulary cannot make a lap this
   open, the other says the band mix is binding.
3. **A SHARED `Field` IS NOT A SNAPSHOT, and this is the one to remember.**
   The fix for (1) built its adoption test once and spent it in two
   consecutive `setAttribute` nodes -- and the first REWRITES the column the
   test reads, so by the second the test was false for exactly the points
   that had just adopted. They kept a run length of 0, which then WON the
   shortest-run argmin, so the stage trimmed a single placement instead of
   taking a run whole: the one guarantee the rule makes, broken on precisely
   the case the repair was added for. The length no longer rides a fold at
   all -- it comes off the same grouping the member count does, so length
   and membership are one mechanism over one key and cannot disagree.
4. **`mergePoints` fills a missing column with its DEFAULT, which is 0**,
   and 0 is a legal station -- so a sentinel that only worked because
   stations are non-negative. Written explicitly now.

**TWO DIVERGENCES ARE DELIBERATE AND BOTH ARE STATED IN THE CODE.**

- **It is not bit-identical, and cannot be.** `pathRuns` writes f32 whatever
  it reads; `measureEnclosure` sums in f64. Two runs at 2.697621W and
  2.697623W -- seven f32 ulps -- are ordered one way by the f64 sum and the
  other by the f32 one, so the two implementations opened different runs.
  Not a tie-break failure: they disagree about which is SHORTER. Both are
  shortest to within a quarter of a frame pitch, both whole, both respect
  Z-3's floor, and the loop re-measures, so the lap converges under the
  ceiling either way. Same category as "The station port cannot be
  bit-identical" above.
- **A fully covered lap.** `stretchesOf` spells it `{startW: 0, endW: 0,
  lengthW: lapW}`, which `inRun` reads as "station exactly 0" -- so the
  reference trims ONE placement on a lap roofed end to end. The graph has no
  coverage transition anywhere, so it reports nothing to trim. Reproducing
  the reference would mean porting an artefact of how the stretch list spells
  "all of it" rather than porting the rule.

**The page reads all of it**: `trims`, `runsTrimmed` and both flags come off
the lap level's settled cloud through `readEnclosure`, beside the share and
the pieces. On every lap this demo can draw the line says 0 trimmed, which is
printed rather than hidden because a rule only ever seen not firing is one
nobody can tell from a rule that is missing.

**What is left of the lap prelude.** `mixPinned` still reaches the graph
three ways and could be derived in-graph; `mixBandPools` is a build-time
literal by design. Both halves of L-6 are now graph stages.

### Stretch: `mixPinned` derived in-graph — MEASURED AND DECLINED, 2026-08-27

The last thing in the racetrack's lap prelude that reached the graph as
bound data rather than as a decision the graph makes. `mixPinned` is
`reserved ∪ landmarkAssets(settled list)` — the asset ids Z-3 may not move
or redraw — and it arrives FOUR ways: a per-placement column from
`placementCloudInTrackCoords`, a per-asset `pinned` column from both
`mixAssetCloud` and `placementAssetCloud`, and `mixBandPools` as a
build-time boolean list.

**What deriving it would buy: nothing measurable.** Running the repair body
round by round with the set fixed, and again with it recomputed every round,
gives **0 differing placements on all eight seeds**, compared by asset,
station, lateral and height.

**What it would cost** is L-4's rule as a per-round stage: a uniqueness pass
over the whole cloud (an asset that appears exactly once) and a min-reduce
per tenth of the lap (the lowest-id unique asset in each). Both are
groupings on a whole-number key, so both are buildable with the idiom L-6's
trim already uses. The obstacle is smaller and more annoying than the rules:
**the settled cloud carries no numeric asset id.** `PLACEMENT.asset` is the
string `pose:N` that the spawner groups batches by, and recovering the kit id
from it means inverting `poseLibrary().posesOf`. Deriving the set in-graph
means first putting an id on the cloud that nothing else needs.

**Two claims in the code were wrong and are corrected rather than deleted**,
because the design rests on them. `DressGraphInput.mixPinned` said "`mix` is
0 in round two on every seed of six" — it is 0 on seeds 1-7 and **1 on seed
8**, so the mix does run after round one. And it gave `dressLap`'s reason
for rebuilding as "L-4 re-draws landmarks as the loop runs", while L-4 moves
**0 in every round on all eight seeds**: the rebuild answers a question
nothing on this vocabulary asks.

**The real exposure, stated precisely.** The set drifts exactly once in
eight seeds (seed 2, round 2: one landmark id in, one out) and the mix
targets placements after round one on seeds 4 and 8. Neither event is rare
on its own; they never coincided. A seed where they did would give the graph
a different lap from the rules. That is the whole of what a port would fix,
and it is not worth a stage plus a new id column until something makes it
happen.

**Sizes, for whoever picks this up.** Identical on every seed: `|reserved|`
is 3, `|landmarkAssets|` is 10, `|mixPinned|` is 13, and the two halves
never intersect — the reserved markers are held out of the pool, so they
cannot be landmarks. The flag gates 46-73 placements a lap (13-20% of the
list) and 10 of 226 pool assets. `mixBandPools` is `[1,1,1,1,1,0]` on every
seed: one band has no donor regardless of the set, which is a fact about the
vocabulary and not about this decision.

### ~~Where the lap prelude stands~~ — THE PAGE DROPPED IT, 2026-08-27

Every rule that decides the racetrack's lap is a graph stage. The station
process, D-4's coverage repair, asset choice, Z-1, L-1, L-5, Z-3, the corner
model, the marker vocabulary, the reservation, the corner language and its
bookkeeping, and both halves of L-6 — the top-up and, as of today, the trim.
`DressGraphInput.placements` is OPTIONAL: left out, `addLapPlacements`
decides the whole list from the path.

**AND THE PAGE STILL HANDS ONE IN, WHICH AN EARLIER DRAFT OF THIS ENTRY
DENIED.** It claimed "the page leaves it out; nothing about the lap is data
in the graph except the spline". That is true of the library capability and
of the suites that exercise it, and false of the demo:
`demos/racetrack/main.ts:725` passes `placements: dressed.placements`, and
above it the page still runs `cookLapPlacements`, `placementsBeforeLanguage`,
`cookCorners`, `cookCornerBookkeeping` and `dressLap`. The prelude is
PORTABLE, not yet PORTED, and the difference is the whole remaining unit.

**What stands between the two, MEASURED.** The first draft of this list
ranked `mixPinned` as the blocker; it is not, and the real one is duller and
worse.

1. **`densityScale` HAS NOWHERE TO GO, and this is the blocker.**
   `DressGraphInput` has no density field, and `assemble` hands
   `addLapPlacements` exactly `{halfWidth, assetCount, poseIds, language}`.
   The page's density slider would go INERT at x1.00 — a silent functional
   regression, which is a different and worse thing than the fidelity costs
   below. Add it to the input and thread it through.
2. **The page never passes `markers`**, so the omitted-placements branch sets
   `language: undefined` and the lap comes out with no L-2/L-3 vocabulary at
   all. One line: `markers: reservation.markers`.
3. **`mixPinned` is circular but NOT a dependency, and the Stretch entry
   above answered the wrong question.** It is required, and it is `reserved ∪
   landmarkAssets(THE SETTLED LIST)` — the list the graph would be deciding —
   so the page cannot reproduce `dressLap`'s set without running `dressLap`.
   But an empty or reserved-only set COOKS FINE. Measured with `placements`
   omitted on seeds 1-3, placement counts identical at 352/338/360 either
   way, against `dressLap`'s real 13-id set: reserved-only (the 3 ids
   `cookReserveMarkers` already returns) differs by 5 / 6 / 25 placements,
   1.4% / 1.8% / 6.9%; empty differs by 6 / 21 / 34. So this is a fidelity
   POLICY to state, not a wall — pass `reserved` and say what it costs, or
   port L-4, which this file declined once already.
4. **Both panel lines die, and one of them cannot be revived.** All nineteen
   `DressStats` fields behind `statCorners` and `statRules` have no
   `DRESS_OUTPUTS` equivalent — the twelve outputs are geometries plus
   `rounds`/`converged`. `landmarkFixes` is unobtainable IN PRINCIPLE,
   because L-4 is not a stage at all; the per-round counters are
   structurally unavailable from `repeatUntil`, which publishes only its last
   round. And `showLapStats` is gated on `if (!s) return`, so `dressing` and
   `enclosure` go dark with them unless that gate is rewritten.
5. **`immovable` and `pool` are NOT blockers** — both come straight from
   `cookReserveMarkers`; `dressLap` merely re-exposes `opts.reservation`.

**And the coverage is thinner than the capability suggests.**
`buildRacetrackLevels` is NEVER called without a placement list anywhere in
the suite — both `racetrackLevels.test.ts` sites hand one in — so the page's
actual two-level path has zero coverage for the mode the page would switch
to. Only `racetrackPlacementAssembly.test.ts` omits the list, and it passes
`mixPinned` as an empty set or the three reserved ids, never with the
landmark half. "The graph decides the list" has therefore only ever been
exercised with a protect set no page would use.

What is NOT left is rules. `mixBandPools` is a build-time literal by design.
The other two open items are a library gap (`splineSample`'s
curve-versus-chord, above) and a design question (`inCorridor`'s lateral
centre-vs-extent, above), and neither is a rule waiting to be ported.

### The two arc lengths are one ruler now, and it was hiding a seam, 2026-08-27

`pathResample` publishes what it EMITS: `resampledLengthAttr` (the chord sum
of the polyline through the samples, closing chord included) and
`sampleArcAttr` (each sample's own chord arc, in world units). Both are
additive, default `""`, and write nothing unset. The racetrack takes both:
the frames' `lapLen` IS `lap.lengthW` and their `stationW` IS
`lap.s / halfWidth`, verified at 2.6e-5 W — one f32 ulp of a column holding
347.

**THE 0.0054% WAS NEVER THE INTERESTING PART.** It is invisible: the demo's
capture is pixel-stable across the change and every stat is identical — 352
placements, 1.01/W, enclosure 4.8% -> 8.3%, 19 corners. The populations
could not move either, and not merely by luck: every station stage runs on
`lapAsPath`, which already wrote the chord length, and `dressLap` sizes in
TypeScript off `lap.lengthW`. Neither ever read the frames' `lapLen`.

**WHAT IT WAS ACTUALLY HIDING IS A SEAM.** L-6's budget takes each frame's
own arc as `next.station - station` and wraps the last one by adding
`lap.lengthW` — a CHORD length added to a difference of CURVE stations. The
frame that crosses the start line therefore reported **0.3668 W against a
true 0.3854 W, 4.8% out on seed 1** and 5.2-6.3% on seeds 2-4. Every lap,
one frame, for as long as the two rulers coexisted.

**AND THE TOTAL WAS ALWAYS RIGHT, WHICH IS WHY NOTHING CAUGHT IT.** The ring
difference telescopes to zero and the wrap adds `lapW` exactly once, so the
sum of the per-frame arcs equals the lap length under ANY station column.
A total-only check has zero diagnostic power here. The per-frame comparison
is what finds it, and that is now the shape of the check.

**`curveU * lapLen` WAS TWO RULERS IN ONE EXPRESSION**, and scaling `curveU`
by the chord length — the obvious smaller fix — would have corrected the
total and left every station between the ends on the curve's
parameterization. The two agree on straights and diverge wherever the road
bends, which is exactly where a corner rule reads them. The per-sample arc is
the ruler itself, so the demo takes that.

**`lapAsPath` STAYS, and the entry above was wrong to say it would go.**
`cookCorners` takes a bare `Lap` and `tests/racetrackCornerGraph.test.ts`
builds circle and stadium laps out of raw arrays with no cook behind them —
there are no frames to hand it. What the fix removed is the DISAGREEMENT
between the two paths, not the reconstruction. The dress graph could now
scatter on `framesIn` directly; it buys one `dataInput` and costs naming the
frames' sample arc `arcW`, which is live scratch in three modules and one
rename from meaning two things on one cloud. Not taken.

**Still standing, for whoever wants it.** `splineSample`
(`src/nodes/samplers.ts`) has the identical curve-versus-chord gap and
reports no length at all, so the second offender is untouched. And
`pointScatterOnPath`'s description used to teach the bug outright — telling
readers to size `count` from `lengthAttr` "which writes each path's true arc
length", in the same paragraph that says its own arc coordinate is the chord
one. That is corrected in the same commit as the reports.

### The page has no prelude, 2026-08-27

`demos/racetrack/main.ts` runs `cookReserveMarkers` and nothing else before
handing the spline to a `World`. `cookLapPlacements`,
`placementsBeforeLanguage`, `cookCorners`, `cookCornerBookkeeping` and
`dressLap` are all gone from it, `placements` is not passed to
`buildRacetrackLevels`, and the lap level decides the whole list. Nothing
about the lap is data in the graph except the spline.

**THE ONE COOK THAT STAYS IS NOT AN EXCEPTION BEING TOLERATED.**
`reserveMarkers` decides WHICH ASSETS EXIST before anything is dressed --
the pool everything downstream draws from is the kit minus L-2 and L-3's
three reserved verticals -- so it cannot be a stage inside the graph that
consumes its answer. It is a cook over eight candidates.

**WHAT ACTUALLY BLOCKED IT WAS `densityScale`, AND THE ENTRY ABOVE RANKED
`mixPinned` FIRST BY GUESSING.** `addLapPlacements` had taken a density
scale since it was written; `assemble` handed it exactly
`{halfWidth, assetCount, poseIds, language}`. Nothing would have thrown --
the page's slider would simply have dressed every lap at x1.00, a control
that moves nothing, which is worse than one that is not there. Threading it
is one field. Measured: seed 1 at x0.5 lays 165 placements against x1.00's
329, a ratio of 0.501 -- D-4's coverage repair does NOT add back what the
thinning removes, so it is not the binding constraint on this population at
either rate.

**`mixPinned` IS RESERVED-ONLY, AND THAT IS BETTER THAN THE REFERENCE
RATHER THAN A COMPROMISE.** `dressLap` pins `reserved ∪
landmarkAssets(the settled list)`, which the page cannot reproduce without
running `dressLap`. The question was never the 1.4-6.9% placement delta
recorded above; it is whether L-4's actual guarantee survives -- every tenth
of the lap holding an asset unique to the lap. Measured over six seeds, in
three variants (reserved-only, reserved + a two-pass reconstruction of the
full 13-id set, and a nothing-pinned control), counting covered stretches
off the settled cloud with cover pieces excluded:

| seed | reserved-only | + landmarks | control |
| --- | --- | --- | --- |
| 1 | 10 | 10 | 10 |
| 2 | 10 | 10 | 10 |
| 3 | 9 (bare [9]) | 9 (bare [9]) | 9 (bare [9]) |
| 4 | 10 | 10 | 10 |
| 5 | 10 | 10 | 10 |
| 6 | **10** | **9 (bare [3])** | 9 (bare [3]) |

Placement counts identical across all three on every seed; all 18 cooks
converged in 3-5 rounds. The landmark pin buys ZERO coverage on five seeds
and COSTS a stretch on the sixth, where it lands on exactly the answer
pinning nothing gives. Seed 3's bare stretch is bare under all three, so it
is not the mix's doing. Independently re-derived by a second agent that
wrote its own measurement and reproduced all 18 cells.

**THE MECHANISM, since "pinning is harmful" reads as backwards.** A pinned
id is excluded from the quota's eligible donors AND from the redraw pool, so
withholding ten more assets shrinks a ~226-asset pool and pushes Z-3 onto
more-repeated replacements -- which destroys uniqueness elsewhere faster
than the pin protects it here. And in graph mode the pin is purely
defensive: `repairLandmarks` is not a stage, so there is no L-4 repair to
restore what the mix breaks, which is the situation the reference's pin
exists to answer. `uniqueAssetCount` moves with the pin set on every seed
(seed 3: 82 / 77 / 74), so the measurement is sensitive; it only reaches
stretch coverage on seed 6.

**AND TWO PANEL LINES CHANGED, WHICH IS THE PRICE AND IT IS REAL.**
`statCorners` and `statRules` read `DressStats`, and most of it cannot come
back. Five figures have NO graph source at all -- D-4's post-cull pass and
L-4 are not stages, so `coverageMoves`, `worstGapW` and `landmarkFixes` do
not exist to publish, and Z-1's and Z-3's per-round counts are folded into
the settle signal rather than reduced apart. `dropped` survives exactly,
because it is a difference between two published LISTS rather than a flag on
a carry: the first pass only ever shrinks.

**AND THE FIRST VERSION OF THE REPLACEMENT LINE PRINTED TWO FIGURES THAT
ARE ALWAYS ZERO**, which is worth recording because they looked perfectly
reasonable and shipped through a typecheck and a green suite. It said
`still pushed N, still lowered M (last round)`, off `PLACEMENT.pushW` and
`PLACEMENT.drop` on the finished carry. Both columns are REWRITTEN
unconditionally each round rather than accumulated, and `writeSettleCount`
stops the loop exactly when `max(corridorMoved, mixCommit, pushW != 0,
drop)` sums to zero over every point -- so on a lap that converged, the last
round moved nothing and both counts are zero BY CONSTRUCTION. They carried
the one bit `converged` already carries, and read on the panel as "L-1
pushed nothing", which is false about the lap. Caught by looking at the
rendered page, not by any test: nothing outside `main.ts` had ever read
`GraphDressing.pushed` or `.lowered`, so a field that was provably always 0
sat in the interface unexercised.

**WHAT REPLACED THEM IS THE ROUND COUNTS, which survive the same argument
from the other side.** `repeatUntil` synthesizes `rounds` and `converged`
itself and the body cannot see them, so nothing in the body can overwrite
them. The page reads `settled in 2+1 rounds` on seed 1 -- and that is also
the explanation for the zeros, since a second pass that converges in one
round has a final round that by definition did nothing.

**STILL AVAILABLE, NOT TAKEN.** A true push TOTAL is reachable without a
running column: compare `trackT` per placement id between `placementsInput`
and `placementsFirst`. It would count Z-1's corridor moves in with L-1's,
so it wants a way to tell the two apart before it is worth printing.

**THE CORNER LINE CAME BACK STRONGER, THOUGH.** `languagePoses` inverts the
pose library for L-2's two assets and L-3's one, and `readRepairs` counts
them on `placementsInput` and `placementsFirst` -- placed, and survived.
`dressLap` derived its equivalent by running `legibilityHealth` before and
after and subtracting, which answers "is every corner still marked" and only
approximates "how many went". What is lost is L-2's converted/added split,
which lives in the bookkeeping stage and not in the cloud it hands on. The
corner COUNT is `cornersOf(lap)`, a reading of the road graph's own
curvature columns and the same model the graph's stage reads -- pinned
corner for corner against `cookCorners` in `tests/racetrackCornerGraph.test.ts`
-- so it is the same category of thing as the lap length, not a survival of
the prelude.

**AND THE MILLISECONDS MEAN A DIFFERENT THING NOW**, so the label does too.
`dressLap` ran synchronously and reported its own compute time; the level is
budgeted across frames, so the panel says `ready in` and measures wall clock
from the World being built to the cell landing. That is the wait a viewer is
actually timing, and the blocking quarter-second the prelude cost is gone
from it entirely.

**COVERAGE FOR THE MODE THE PAGE SWITCHED TO DID NOT EXIST UNTIL NOW.**
`buildRacetrackLevels` had never been called without a placement list
anywhere in the suite -- both call sites handed one in, and the branch was
only ever exercised through `dressLapByGraph`, which COOKS. The dressing
level reads its list off `ctx.parent.outputs`, and on every prior path that
cloud was a `dataInput` restating a caller-built item rather than the end of
a chain of stages. `tests/racetrackLevels.test.ts` now drives a World round
a self-decided lap: 352 / 338 / 360 placements into 17 / 16 / 17 sectors,
every placement spawned exactly once, union bit-identical to spawning the
settled cloud whole.

**On screen: 352 placements at 1.01/W, inside D-1, 19 markers on 19
corners.** The count is unchanged from the prelude's lap.

### What verification found after the prelude went, 2026-08-27

An agent that was not told the answer rebuilt the page's exact input, cooked
it, and checked the settled lap against the rules' OWN predicates rather
than against a description of them. Seeds 1-3, L-6 cover pieces excluded,
three reference laps: the old prelude's list, that list handed back through
`dressLapByGraph` the way HEAD's `buildStreamedDressing` did (**the lap the
old page actually drew**), and a plain `dressedLapFor`.

**DROPPING THE PRELUDE LOST NO RULE, and the strongest form of that is an
equality.** The graph-decided lap and the lap the old page drew agree
EXACTLY on every figure: 341 / 317 / 343 placements, the same cover counts,
the same L-3 corner ids. L-2 marks every corner on every seed. D-1 comes out
0.983 / 0.966 / 0.994 per W, inside `[0.71, 1.54]` and within 0.01 of the
0.95 target. Controls were run rather than assumed -- an empty list makes
`cornerMarkersSatisfied` report every corner missing, so the gate can fail.

**Z-1 IS CLEAN, AND THE BASELINE THIS FILE AND
`tests/racetrackPlacementAssembly.test.ts` BOTH QUOTE IS ABOUT A DIFFERENT
PREDICATE.** That suite records "3 of seed 1's 340 sit inside the corridor"
and PLAN repeated it. Measured with `inCorridor` itself (`zones.ts`,
`SAME_PLACE_W` included), the count is **0 on all three seeds and on all
three references**. The 3/5/3 belongs to a tolerance-free restatement --
`|t| < 1 && 0 <= base < 1.2` -- which scores 6/3/5 on the page's lap and
6/6/6 under that suite's own config. The counter is live either way: a
deliberately wrong base (centre height instead of bottom) scores 5/10/13. So
the rule holds and the recorded number was never the rule's.

**L-3 LOSES 5 OF 12 TIGHT CORNERS ON SEED 2, AND IT IS NOT THIS CHANGE.**
The page's lap fails corners 0, 1, 3, 6 and 9, each one mark short or with a
mark on the inside, keeping 31 of 36 braking marks. The lap the OLD page
drew fails the same five with the same 31/36. It only reads as a regression
against `dressLap` run on its own (0 failures, 36/36) -- which is a
different marker vocabulary and does not run the graph's second repair pass.
So this is a pre-existing property of that pass, it was on screen before
today, and it is a real defect worth its own unit: three marks are lost
somewhere after L-6 has added cover. Seeds 1 and 3 are clean (27/27, 39/39).

**SUPERSEDED 2026-08-28 -- the localisation in this paragraph is WRONG.**
The marks are gone before the enclosure runs, dropped by L-1's cull in the
FIRST pass, and it is the documented `immovable` contract rather than a
defect. See "L-3's lost marks are L-1 doing its job" at the end of this
file.

### L-3's lost marks are L-1 doing its job, and the suite was watching a different lap, 2026-08-28

**The entry above is wrong and this one supersedes it.** It said the five
marks go missing "somewhere after L-6 has added cover", in the graph's
second repair pass. They do not. Two agents derived the answer
independently -- the second told only the symptom, never the first's
conclusion -- and they agree on the mechanism and on every number.

**THEY ARE GONE BEFORE THE ENCLOSURE RUNS.** Cooked on seed 2 with the
page's exact input, stage by stage: `placementsInput` 324 points and 36
brake marks, L-3 satisfied. `placementsFirst`, the end of the FIRST repair
pass, 317 points and 31 marks, five corners failing. L-6 then adds 16 cover
pieces (317 + 16 = 333) and the second pass removes nothing at all. The
failing corners are 0, 1, 3, 6, 9 of 12 tight, each losing exactly one
mark, at ruler index 1, 0, 2, 1, 2.

**THE MECHANISM IS THE `immovable` CONTRACT WORKING AS SPECIFIED.**
`main.ts` sets `immovable = {markers.brake.id}`; that writes
`PLACEMENT.locked = 1`; `writeSightlineCull` spells the flag as
`pushMax: select(attribute(PLACEMENT.locked), 0, ...)`. A locked placement
has no rung to step to, so `occlusionCull` REMOVES it rather than pushing
it outward -- which is exactly what `immovable` is for and what
`dressGraph`'s own comment says it is for: a braking reference in the wrong
place is worse than none.

**THE CONTROL, PREDICTED BEFORE IT WAS RUN.** Empty `immovable`, change
nothing else, and the five marks should survive and their rulers should
bend instead. They do: 36 marks, drops fall 7 to 2, and all five corners
now fail as `marks not on one line` at 0.500W, 1.500W, 0.500W, 0.500W,
0.500W -- the pushed mark in each case being the one that had been absent,
moved 1 or 3 rungs of `pushStepW`. So the trade is real and it is the one
the contract chose: five corners with a two-mark ruler, or five corners
with a bent one.

**THE CHECKER'S MESSAGE WAS HIDING WHICH HALF FIRED.**
`brakingRulersSatisfied` folded the station match and the outside test into
one `find` and reported "N of 3 marks missing or on the inside" for either.
Across all 36 pairs on seed 2 there are 31 ok, 5 absent and ZERO
wrong-side, so the second half of that sentence was dead text on the lap it
was being read about. The two halves are counted apart now and the message
names the one that fired. Error messages are part of this library's API and
that applies to a demo's rule gates too.

**WHAT WAS ACTUALLY BROKEN IS THE COVERAGE, IN TWO INDEPENDENT WAYS.**
Every `tests/racetrack*` suite reserved through `reserveMarkers`; the page
reserves through `cookReserveMarkers`, a `randomField` graph cook, and the
two draw different assets -- seed 2 {38,0,12} against {0,12,10}, seed 3
{0,17,20} against {17,36,10}, agreeing only on seed 1. WHICH ASSET IS THE
BRAKE MARK DECIDES THE ANSWER, because its footprint is what blocks or
clears the sight cone: through the page's reservation seed 2 loses five
marks and seed 3 is clean, through the suite's, seed 2 is clean 36/36 and
seed 3 loses one. And separately, the one suite that DOES gate
`brakingRulersSatisfied` reads `got.placementsInput` -- the list as
assembled, before the cull -- where all 36 marks are present on every seed.
So the gate was green on a different lap at a different moment, and either
half alone was enough to hide this.

Both are closed. `racetrackLevels.test.ts` now reserves the page's way, and
carries a new gate on the SETTLED cloud that asserts the contract rather
than the count: never a bent ruler, never a wrong-side mark, and the drop
count reported rather than pinned, because it is a property of the spline
and the reserved asset's footprint and is allowed to move. It was run
against the control and FAILS there, naming all five corners.

**WHAT IS LEFT IS A DECISION, NOT A DEFECT, AND IT WANTS A LOOK AT THE
PICTURE.** A corner that has lost one of three marks still draws two, and
two marks read as a broken ruler rather than as no ruler. The candidates:
drop the whole ruler GROUP when the cull takes any of its marks, so a
corner reports honestly (needs a ruler-group id on the placement cloud and
a cull that can remove a group -- it changes how the lap fails, not the
lap); or make L-3's per-corner lateral draw clear the sight cone AS A
GROUP, which is the real fix and is a bigger one (ported in two places,
needs the sightline test at draw time, probably an extra fixed-point
round). Do NOT simply clear `immovable`: the control above is what that
buys. Do NOT reconcile the two reservations either -- that divergence is
deliberate and documented, and the reference one loses a mark on seed 3.
This is a change to what is on screen, so it should be measured and LOOKED
AT before it ships, the way Z-3's donor order still should be.

### The corpus's own runFit demo has the two-rulers bug, and fixing it breaks what it teaches, 2026-08-28

Found while shipping `splineSample`'s length reports. `graphs/basics-fit-runs.json`
contains exactly the pattern PLAN's ruler entry describes: `pathResample`
writes `lengthAttr: "lapLength"` — the INPUT curve's length — a `promoteAttribute`
carries it to the points, `station = mul(curveU, lapLength)`, and `runFit` reads
that `station` with `period: attribute("lapLength")`. Two rulers in one
expression, in the graph the corpus uses to teach run fitting.

**MEASURED BEFORE TOUCHING IT, and the measurement is why it is still there.**
Both numbers below were re-derived independently, with the arc column checked
against a hand-walked `P` polyline (agreeing to 1.5e-5, f32 noise) and the
closing chord accounted for on the closed path.

- max |station − emitted arc| = 0.044136 = **0.01405%** of the lap length
- RMS = 0.025429 = 0.00810%
- It is a near-uniform **140 ppm RESCALE** (emitted/input = 0.99985948),
  accumulating almost linearly and peaking at the seam — not a local wobble.
- `runFit` output changes on **80 of 82 points**: `runSlope` 60, `runResidual` 60,
  `runSpan` 80, `runStart` all 82 by up to 0.0431. `runId` 0. **Colour 0 of 82.**

So the picture is unchanged and the NUMBERS ARE NOT, which is the awkward
case. The rule for this was "identical or do not ship", and it is not
identical, so the file is untouched.

**AND TWO OF THE GRAPH'S OWN TEACHING CLAIMS WOULD BREAK, which is the real
reason this is a decision rather than a chore.** `meta.description` carries a
titled paragraph, "THE ARC COORDINATE IS THE ROAD'S, NOT THE PROPS' OWN",
whose whole job is to explain `station` as `curveU` times the lap length and
to defend the two `promoteAttribute` nodes it costs. It quotes 0.303833,
3.762408, 179.70, 305.31 and "a residual of 0". Under the fix:

- the seam row's residual goes from 3.2199e-7 — which is "0" at any sane
  display precision — to 1.797e-4, about 560x larger, and the sentence
  stops being true;
- the translation-invariance demonstration fails at the 5th digit
  (0.303882 against the stated 0.303833), because the ruler swap is a
  SCALE and invariance covers a translation. The demonstration is not
  wrong; it is being asked the wrong question by the new column.

That prose is mirrored verbatim into the committed `docs/graphs.json` and
`docs/graphs.md`, so the fix is a graph edit, a rewrite of the paragraph,
five re-measured figures and a `npm run docs`. `tests/graphs.golden.json`
would move too — it pins per-domain attribute presence and the `road`
output's points would gain `station:f32`.

**What the fix would be**, so it is not re-derived: `resampledLengthAttr` for
the emitted total, `sampleArcAttr: "station"` for the coordinate, which
deletes the `station` setAttribute and both `promoteAttribute` nodes; and
`runFit`'s `period` must move to the emitted length in the same edit, since
the period IS that coordinate's wrap length and the two cannot be mixed.

**Recommendation: take it, but as its own unit with the prose rewritten
deliberately.** The graph currently teaches the mistake the library just
grew the parts to avoid, and it teaches it in a paragraph that argues FOR
the two-rulers expression by name. That is worse than a stale number. It was
not taken unattended only because a teaching graph's quoted figures are
content, not output, and rewriting five of them silently is not a thing to
do without the author looking at the result.

### The second repair pass has exactly one lock, and it is not the one anyone thought, 2026-08-28

T4.4 asked for a fixture that makes the racetrack's post-enclosure repair
pass FIRE, so that a pass which never runs is distinguishable from one that
cannot. The answer arrived twice, and the second one is right.

**THE FIRST ANSWER WAS "no kit can reach it", AND IT WAS WRONG.** The
argument was two constants: L-1's sight fan runs from an eye at
`SIGHTLINE.eyeW` 0.3W down to targets on the road surface so it never
exceeds 0.3W, while `coverPlacements` floors a piece's centre at
`CORRIDOR.ceilingW + tall/2`. A 1.2W floor against a 0.3W ceiling looks
unreachable by construction. `dressGraph.ts:2691` already said otherwise,
fifteen lines from the param being written about: "a coincidence of two
constants and not a rule -- a lower kit, a taller eye or a fan over a crest
all reach it."

**THE LAP IS NOT FLAT, WHICH IS THE WHOLE THING.** `LAP.relief` is 26
against a half-width of 9, so +/-2.89W, and a cover rib is horizontal in
its OWN station's frame while the road falls away under its far end. Run
L-1's own `occludes` over 87 ribs per lap at an underside of exactly
`CORRIDOR.ceilingW`, seeds 1-6, sweeping the rib's LENGTH:

    along   2.2   8   10.29   16   24   32    44     60
    blocked   0   0       0    0    0    0   1-4    4-9

Controls both directions: the same rib at h = 0.1 blocks 87 of 87, and the
shipped floor at h = 2.158 blocks 0 even at 44W.

**SO THE LEVER IS A LONGER ASSET, NOT A LOWER ONE**, and the first test
could not have found that -- its adversarial sweep varied `tall` and the
stated height while PINNING `across: 1.4, along: 2.2`, which are the two
dimensions that decide it. `coverCandidates` filters on height and on
`across` and puts NO CAP ON `along` AT ALL. What protects the demo is data:
the longest shipped asset is 10.29W, a 4.3x margin. That is a property of
the vocabulary and it moves when the vocabulary does.

**AND THE PASS STILL WOULD NOT FIRE, because there is exactly one lock and
it is shut.** `occlusionCull`'s `include` gate takes `1 - cover`, so cover
is never tested whatever its shape. Add a 44W cover asset and the geometry
becomes reachable and nothing happens -- you get a tunnel you cannot see
through, which is a different bug. Delete the `include` param and the pass
fires that day. One lock, named, with the geometry behind it now measured
rather than assumed.

The test is split accordingly: the height floor, which does hold for any
kit, and a MEASURED MARGIN test that gates the art's reach and asserts 44W
does block -- so the tripwire cannot pass vacuously the way its predecessor
did.

**Worth a decision, not taken here:** nothing caps `along` in
`coverCandidates`. A cap would make the margin a rule instead of a
coincidence. The alternative is to leave it and rely on the margin test,
which is what shipped. Either is defensible; the current state is the
second one, deliberately.
