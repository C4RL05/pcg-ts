# Non-finite values: where a guard belongs, and what it may do

Design pass. Nothing here is implemented. Every number below was measured on
this machine (Node v22.20.0, Windows 11), not inherited.

Repo state while writing: HEAD moved from `f8dbfbd` to `b849d0b` mid-pass
(the concurrent CPU/GPU parity agent). `b849d0b` **reworded the invariant this
document has to satisfy** - see section 4.

---

## Summary

`f8dbfbd` deferred one question: a field-valued param can deliver NaN or +-Inf
to any of 75 field-capable params, and eight demonstrations put one in an
output column under `ok: true`.

Three findings change the shape of the answer:

1. **There is exactly one CPU chokepoint, and all eight failures pass through
   it.** `resolveOn` / `resolveOnMaybeGpu` (`src/nodes/util.ts:151`, `:192`)
   are the only way a field-capable standard-node param becomes a column -
   19 call sites, 16 params, and every one of the eight demonstrations traces
   to one of them (section 5).
2. **It is cheap: 0.038 ms on a 44 ms cook of the rig (0.09%).** Measured,
   not estimated (section 2).
3. **A blanket "non-finite is an error" is wrong, and the corpus proves it in
   at least four places** - two of them *field-param columns* with documented
   NaN semantics (section 3). The guard must be a property of the param, with
   a named opt-out list, not a rule about numbers.

Recommendation: **throw at the param seam, gated on `isField`, with a
two-entry opt-out list; report (never throw) at the fused-run terminal; never
clamp.** The run-terminal instance is mandatory, not optional: without it the
CPU and GPU paths behave differently, which the invariant as reworded in
`b849d0b` forbids.

---

## 1. What the library already does

The library is not silent on non-finite values. It has five stances, and they
do not agree with each other - which is itself the finding.

### 1.1 Plain params are refused, but only at three boundaries

`paramValueError` (`src/graph/params.ts:179`) rejects a non-finite number for
`f32`/`i32`/`u32` (`:181`) and any non-finite component of a `vec3`/`vec4`
(`:233`). It is called from exactly three places:

- `src/nodes/serialize.ts:338` - deserialization / serialization
- `src/graph/subgraph.ts:670` - exposed-param resolution
- `src/runtime/patches.ts:125` - World / worker per-cell patches

**`Graph.setParam` does not validate at all** (`src/graph/graph.ts:504-507`
calls `_setParamQuiet` and bumps the version; no schema check). So the
finiteness refusal for plain params is a *serialization-boundary* check, not a
cook-time one. A TypeScript author can set a plain NaN and cook it.

That is not an oversight to close blindly: `filterByBounds.boundsMin` /
`boundsMax` **document +-Infinity as the intended spelling** for an unbounded
axis (`src/nodes/filtering.ts:242`, `:247`), and `requireBounds3`'s own error
message tells the author to write `[ctx.min[0], -Infinity, ctx.min[1]]`
(`src/nodes/filtering.ts:170`). JSON has no `Infinity` literal, so that value
can only ever arrive through `setParam` - the one door that does not check.
The gap and the feature are the same gap.

Also worth recording: the field-spec branch of the patch path skips
`paramValueError` entirely. `src/runtime/patches.ts:108-114` runs
`fieldFromJson` and returns; the validator on `:125` is in the `else`.

### 1.2 The field grammar refuses a non-finite CONSTANT - everywhere it can

`fieldJson.ts` checks finiteness in seven places: bare numeric args (`:153`),
number arrays (`:143`), `constant` (`:246`, `:248`), a bound `param` (`:397`),
`ramp` stops (`:483`), noise `frequency` (`:536`) and fbm `lacunarity`/`gain`
(`:615`). The constructor API is looser and knows it: `constant()` accepts NaN
but then *withholds the spec* with the reason "constant's `value` must be
finite, and not -0" (`src/fields/inputs.ts:38-41`), which demotes the field to
the CPU path rather than refusing it.

This is why the audit needed `div(1,0)`: the grammar refuses non-finite
*literals* and has no opinion whatsoever about non-finite *results*. Verified
live - `pcg run "shape/ring" --param 'sweep={"fn":"div","args":[1,0]}'` cooks
24 points and prints no bounds at all.

### 1.3 The CLI already counts non-finite slots - and the total-loss case is
its quietest output

`attributeStats` (`src/cli/summary.ts:41-82`) scans every scalar of a column,
counts non-finite slots into `nonFinite` (`:63-65`), and excludes them from
min/max/mean. `pcg inspect` prints it as a table column
(`src/cli/commands.ts:440-461`).

**Reusable? Partly, and not as-is.** The loop is the right loop but it also
accumulates min/max/mean per component and allocates four arrays per column. A
guard wants a `firstNonFinite(data): number` that early-exits; `attributeStats`
wants a full pass. Share the *policy* (what counts as non-finite:
`!Number.isFinite`, so NaN and both infinities), not the loop.

Worse, the reporting has a hole exactly where the damage is worst:
`geometrySummary` only sets `boundsExcluded` when `stats.min` is defined
(`src/cli/summary.ts:142-149`), and `min` is undefined when *every* value is
non-finite (`:74`). So a geometry with one NaN position prints
`bounds ... (excludes 1 non-finite P value)`, and a geometry where **all**
positions are NaN prints no bounds and no warning - which is what the
`shape/ring` reproduction above did. `pcg cook` never surfaces `nonFinite` at
all; only `inspect` does.

### 1.4 `src/data` validates shape, never values

Deliberately. `attribute.ts` throws on tuple-length mismatch (`:108`, `:156`),
non-positive `tupleSize` (`:57`), out-of-range `copyFrom` (`:182`), name
collisions (`:265`); `geometry.ts` validates topology references (`:67`,
`:72`). Not one check looks at a number's magnitude or finiteness. The data
layer's stance is: **structure is the library's business, values are the
caller's.** A guard should not change that - it belongs above `src/data`.

### 1.5 `src/graph/execute.ts` has no value-level check at all

The cook path checks memo keys (`:955-957`), param *hashability*
(`stableValueHash`, `:157`), declared output pins (`:982-988`), and wraps node
throws in `NodeExecutionError` (`:980`). Nothing inspects a column.
`CookStats` (`:110-123`) carries `cooked`, `cached`, `elapsedMs`, `gpu`.

### 1.6 The consumers each invented their own policy

- **three mesh/line adapter - drop, then throw on total loss.**
  `collectIndexed` (`src/three/convert.ts:264-279`) drops any primitive
  touching a non-finite position, and throws when that leaves nothing:
  "every <kind> primitive touches a non-finite position, so there is nothing
  to draw - a field divided by zero or overflowed upstream" (`:293-296`).
  The module doc states the policy outright (`:186-192`): "Partial drops are
  silent by design - there is no way to draw a NaN... What is NOT silent is
  dropping everything."
- **WebGPU instance adapter - throw on a bad radius, tolerate an infinite
  centre.** `resolveBoundingSphere` (`src/three/webgpuInstances.ts:529-541`)
  throws for a non-finite radius but treats an infinite CENTRE as the
  legitimate unbounded-level AABB and disables culling.
- **SVG renderer - drop and break the run.** `src/cli/render.ts:413`,
  `:459-468`, `:498`; a non-finite vertex ends a polyline run rather than
  splicing across it.
- **Spatial index - documented NaN-tolerant, never an error.**
  `src/spatial/uniformGrid.ts:46-48` and `src/spatial/adjacency.ts:77-79`
  guarantee that a non-finite point has no neighbours and is nobody's
  neighbour, and every query with a non-finite coordinate returns nothing.
- **Spawner - no check whatsoever.** `buildInstanceBatches`
  (`src/spawn/instances.ts:121-202`) reads `P`, `rot`, `scale` and calls
  `composeTRS` with no finiteness test anywhere. NaN goes straight into the
  matrix buffer.

### 1.7 There is already a cook-time finiteness guard on a param

`pathSegments` checks its plain `extend` param inside `execute`, raising
`pathSegments: param "extend" must be a finite number >= 0, got ...`
(`src/nodes/paths.ts:468-472`). So the pattern this design proposes already
exists in the node library - for exactly one plain param.

### 1.8 The clamps are floors, and floors do not stop NaN

`f8dbfbd` said so; the code confirms it. `guarded()` emits `max(param, least)`
(`src/primitives/transform.ts:36-38`) and `Math.max(NaN, x)` is NaN;
`pathSegments` does `Math.max(0, (r0 + r1) * 0.5)` (`src/nodes/paths.ts:552`),
same result. Any clamp-based answer has to INVENT a value for NaN, which is a
different decision from clamping and should be argued as one (section 3).

**The library's stance, in its own words:** PLAIN params must be finite at
every boundary that has a schema, FIELD results are unexamined, columns are
the caller's business, and every consumer that must draw something decides
locally between dropping, throwing, and disabling a feature. There is no
stance about the middle - between "a field produced it" and "a renderer had to
draw it" - and that is the whole gap.

---

## 2. Placements, with measured costs

### 2.1 The measurement rig

`graphs/examples-rig.json`, cooked headless through `dist/`:

| quantity | value |
| --- | --- |
| points / vertices / primitives (declared outputs) | 74,281 / 368,050 / 122,641 |
| numeric scalars in declared-output columns | 2,558,795 in 375 columns |
| numeric scalars in all 78 outer nodes cached outputs | 4,204,676 in 1,347 columns |
| cook, median of 7 cold deserialize+cook | **44.4 ms** |

Raw cook samples, sorted: 39.1 / 43.5 / 43.8 / 44.4 / 46.2 / 51.0 / 117.9 ms.
The brief quotes ~65 ms; this box is faster. The ratios below are what travel.

Scan rate, `Number.isFinite` over a `Float32Array`, warmed, no early exit:

| n | ns/element | ms/pass |
| --- | --- | --- |
| 1,024 | 0.569 | 0.001 |
| 16,384 | 0.564 | 0.009 |
| 102,600 | 0.557 | 0.057 |
| 2,558,795 | 0.842 | 2.154 |

Small columns scan at the same rate as large ones, so per-call overhead is not
the cost - bandwidth is, and only past L2. Note for the implementer:
`Number.isFinite(v)` beat the branch-free `v * 0 === 0` at every size by about
0.1 ns/element; use the readable one.

### 2.2 Candidate A - the field-to-column seam (`src/nodes/util.ts`)

`resolveOn` (`:151`) and `resolveOnMaybeGpu` (`:192`) are the ONLY route from
a field-capable standard-node param to a column: 19 call sites across
`attributes.ts`, `filtering.ts`, `paths.ts`, `pointOps.ts`, `samplers.ts` and
`surfaces.ts`, covering all 16 field-capable standard params. `capture` and
`captureAsync` (`src/fields/capture.ts`) are the public graph-free door and
have no in-library callers outside tests.

CATCHES: every field-param to column conversion on the CPU path, including
GPU per-node resolution (`tryResolveOnGpu` returns a materialised CPU column,
`src/nodes/util.ts:169-179`), and it can name the node AND the param, which no
downstream placement can.

MISSES: fused device-resident runs (section 4); non-finite values a node
computes internally from finite params; non-finite data a caller writes
directly into a column.

COST, MEASURED. Instrumented by handing the cook a fake `GpuFieldResolver`
whose `resolveField` records the field and context and returns null - the exact
call the guard would sit beside, with zero source changes:

- **118 field resolutions, 67,576 scalars** across the whole rig cook,
  including the forEach 16 inner cooks.
- At 0.57 ns/element: **0.038 ms**, i.e. **0.09%** of a 44.4 ms cook.
- Largest single column: 31,464 scalars (0.018 ms).

**Gate on `isField`.** `constant()` materialises a full n x ts column
(`src/fields/inputs.ts:24-31`), so an ungated guard would also scan every plain
param broadcast: 44 plain field-capable params in the outer graph alone add
**405,346 scalars** (at least 0.27 ms, 0.6%) - about 6x the cost for zero
coverage, since a plain value finiteness is decidable from its 1-4 raw numbers.
Check THOSE instead: O(4), and it closes the `setParam` hole in 1.1 for free.

### 2.3 Candidate B - per node, after execute (`src/graph/execute.ts:967`)

CATCHES: everything that lands in a column, whatever produced it, on every path
including fused runs (a run `result.geo` is a CPU geometry,
`src/graph/execute.ts:1192`). Uniform across CPU and GPU by construction.

MISSES: device-resident instance batches (section 4); the IDENTITY of the
offending param - it can name the node and the attribute, never the knob.

COST, MEASURED:

| variant | scalars | ms | % of cook |
| --- | --- | --- | --- |
| every numeric column of every node output | 4,204,676+ | 3.5+ | **8%+** |
| `P`, `rot`, `scale` only | 1,338,230+ | 1.1+ | **2.5%+** |

Both are floors: they count the 78 outer nodes caches only, and the rig
`forEach` (16 items) and `subgraph` node cook their bodies in nested cooks
whose intermediate outputs are not in those caches. The true multiplier is
worse than 90x candidate A, because pass-through nodes re-scan columns they did
not touch - the rig 78 nodes hold 108 geometries and 1,347 columns for 375
columns of actual output.

### 2.4 Candidate C - the spawner / renderer boundary only

CATCHES: what a renderer would draw. `buildInstanceBatches`
(`src/spawn/instances.ts:121`) has no check today; the three mesh/line adapters
and the SVG renderer already have one each (1.6).

COST: **14,464 scalars** for the rig 904 instances (0.012 ms, 0.03%) if the
composed transforms are scanned; about 9,040 if `P`/`rot`/`scale` are scanned
instead. Effectively free.

MISSES: six of the eight demonstrations. Only `place/radial-on-curve.spread`
(landing in `rot`) and `write/random-scale.min|max` (landing in `scale`) reach
a spawner. The other six land in geometry - where `toBufferGeometry` already
drops or throws, and where a headless `pcg cook`, a worker cook, or an export
never reaches a renderer at all. This placement diagnoses the symptom at the
one boundary that already handles it, and stays silent for every consumer that
does not draw.

### 2.5 Candidate D - opt-in cook option / debug mode

CATCHES whatever the enabled placement catches, when enabled. COSTS zero when
off. MISSES everyone who does not know to switch it on - which is the entire
population the guard exists for. The CLAUDE.md agent-ergonomics pillar is about
what an agent gets WITHOUT reading source. A default-off guard is a guard for
people who already suspected. It has one honest use: as the ESCALATION level
for the expensive candidate B, once a cheap default-on candidate A has told
someone where to look.

### 2.6 Verdict

A is about 90x cheaper than B, is the only placement that can name the param,
and covers 8/8 of the demonstrations on the CPU path. B is the only placement
that is path-uniform. Take A as the primary and a NARROWED B at the fused run
terminal only (section 4) as the parity patch - not B everywhere.

---

## 3. The policy question

### 3.1 Is a non-finite value ever legitimate? Yes - four cases in the corpus

Not reasoned abstractly; found by reading.

1. **`attributeReduce` writes +-Infinity by design.** Its own description:
   "Over an empty domain sum and average are 0, min is Infinity, max is
   -Infinity, count is 0" (`src/nodes/attributes.ts:452`). A legitimate,
   documented, non-finite value in an output column.
2. **The unbounded level cell rectangle is +-Infinity.**
   `src/runtime/world.ts:744-745`, typed as such in
   `src/runtime/types.ts:170-172`, and consumed as such by
   `resolveBoundingSphere` (`src/three/webgpuInstances.ts:531-534`), which
   disables culling rather than failing.
3. **`filterByExpression.predicate` has DEFINED NaN semantics.**
   `src/nodes/filtering.ts:757-761`: "`> 0 || < 0` is the non-zero test that
   also rejects NaN, where `!== 0` would keep it." A NaN predicate value means
   DROP THIS POINT, deliberately. This is a field-param column - the guard
   would sit directly on it.
4. **`setAttribute.value` in string value-list mode has defined NaN
   semantics.** `src/nodes/attributes.ts:158-161`: "NaN and -Infinity land on
   0 (via `!(idx > 0)`), +Infinity on last - never a per-element throw." Also
   a field-param column.

Cases 3 and 4 are decisive: they are EXACTLY the columns candidate A scans,
and both have a documented meaning for NaN that a blanket throw would delete.

A fifth, weaker case: `selfPrune.minDistance` - a NaN there makes
`hasPointCloserThan` return false (`src/spatial/uniformGrid.ts:46-48`), i.e.
"prune nothing", which is BEHAVIOURALLY defined but nowhere DOCUMENTED as
intended. Open question in section 7.

The conclusion is not "do not guard". It is that **finiteness is a property of
the param, not of the number**, and the guard needs a named opt-out list of two
(plus a decision on the fifth). Two opt-outs against seventeen guarded sites is
a proportionate answer, and each opt-out is a line of code beside a comment
quoting the semantics it preserves - the same shape as the `resident.eligible`
predicates elsewhere.

### 3.2 Throw, report, or clamp

**Clamp: no.** Three reasons. (a) A clamp cannot handle NaN without inventing a
value, and every candidate - 0, the schema `min`, the previous element - is a
number the author did not ask for, producing the plausible-looking cook that
`requireReportSlot` (`src/nodes/util.ts:287-302`) and `multiGeometryMessage`
(`:41-58`) both exist to refuse. (b) `f8dbfbd` already ran this experiment:
`max(param, least)` is a floor and NaN survives it, and the fix own commit
message records that. (c) It changes bytes for graphs that currently produce
NaN, which is allowed but throws away the diagnostic in exchange for output
nobody can distinguish from correct.

**Report only: not sufficient as the primary.** CLAUDE.md - "Error messages are
part of the agent API: name the offending node, pin, or param and state the
valid alternatives or the fix" - and the library own record of converting
silent plausible cooks into errors (`requireReportSlot`,
`multiGeometryMessage`, the `carryPrimitiveAttributes` collision, the
`pathSegments` zero-length-segments refusal, the `toBufferGeometry` total-loss
throw) both point the other way. A counter in `CookStats` is read by whoever
already asked; the eight demonstrations are about someone who did not.

**Throw - at the param seam, as `NodeExecutionError`.** It is the smallest
policy that satisfies:

- DETERMINISM. The scan is read-only; bytes are unchanged for any graph that
  produces no non-finite value. For a graph that does, the throw is a pure
  function of the inputs, so it is as deterministic as the output was.
- MACHINE READABILITY. `NodeExecutionError` carries `nodeId` and survives the
  worker wire with it intact (`src/worker/protocol.ts:309-317`, rehydrated at
  `:321`), so the pool and the World report the same thing the in-process cook
  does.
- PRECEDENT. `toBufferGeometry` already throws for this exact condition and its
  message already blames "a field divided by zero or overflowed upstream"
  (`src/three/convert.ts:294-296`). The guard does not invent a policy; it
  moves an existing one upstream to the node that caused it, so that headless
  cooks, worker cooks and exports get the diagnostic that today only a three.js
  renderer produces.

Proposed message shape - the whole point of choosing this placement:

    sweepProfile: param "radius" evaluated to NaN at point 0 (74281 of 74281
    elements are non-finite). A field param is not range-checked - the schema
    min/max bind a plain value only - so a division by zero, an overflow, or
    an asin() outside [-1, 1] reaches the geometry as NaN and draws nothing.
    Guard the expression itself (max(x, 1e-6) before a div, clamp before an
    asin), or set the param to a plain number to have it checked at load time.

**And report, in addition, where throwing is wrong** - i.e. at the two levels
where the value may be legitimate data rather than a param recipe: a
`CookStats.nonFinite?: Record<string, number>` keyed by `<nodeId>:<param>` for
the opted-out params, and by `<nodeId>:<attr>` at the run terminal. The
vocabulary precedent is `GpuCookStats.fallbacks`
(`src/fields/gpuResolver.ts:14-86`), which is exactly this: a machine-readable
reason-keyed counter that costs nothing when empty.

### 3.3 Partitioned cooking and the worker pool

A guard that throws mid-cook interacts badly with streaming, and the
interaction is worth stating rather than discovering.

`World.cookCell` awaits each dispatched cell; a throw propagates out of
`update()`, the remaining dispatches are settled quietly, and the failed cell
is NOT stored (`src/runtime/world.ts:888-896`). So:

- one cell failing DOES fail the whole `update()`, not just that cell;
- WHICH cells are wanted depends on the viewpoint history, so a graph whose
  field goes non-finite only in some cells throws or does not throw depending
  on where the camera has been. The throw is deterministic per cell and
  non-deterministic per session.

This is an argument for scope, not against the policy: a graph that produces
NaN in one cell produces it in that cell every time, and the alternative is
that cell silently rendering nothing forever. But it is a product decision
about the streaming path specifically, and it is the first open question in
section 7.

---

## 4. The GPU path

`b849d0b` reworded the invariant, and the new wording is the one to design
against (`CLAUDE.md:20-27`):

> Every path that cannot run on the GPU falls back to the CPU with a
> machine-readable reason rather than silently doing something else. The CPU is
> the reference and the GPU is a documented approximation...

"The CPU is the reference" settles the design: **the CPU guard defines the
behaviour, and the GPU path either reproduces it or declares a machine-readable
reason for not checking.** "Rather than silently doing something else" is
precisely what a guard that is absent on the fused path would be doing.

Three GPU sub-paths, three different honest answers.

**(a) Per-node GPU field resolution - fully covered, for free.**
`GpuFieldResolver.resolveField` contracts to return "a freshly allocated
column" (`src/fields/gpuResolver.ts:347-351`), and `resolveOnMaybeGpu` returns
it to the caller (`src/nodes/util.ts:199-203`). The bytes are already on the
CPU when the guard would run. No readback is added; the readback already
happened.

**(b) Fused device-resident runs - covered, but only with a second guard, and
it is mandatory.** A run keeps field columns in storage buffers and reads back
only the written attributes at the terminal (`src/gpu/run.ts:1-11`), so
`resolveOn` is never called for a fused member. The resident kinds are
`setAttribute` (`src/nodes/attributes.ts:115`), `transformPoints`
(`src/nodes/pointOps.ts:73`), `jitterPoints` (`:152`), `orientAlongVector`
(`:405`) and the `spawnInstances` terminal (`src/spawn/spawnNode.ts:111`) -
which is **five of the eight demonstrated failure sites** (section 5). A guard
only at candidate A would therefore throw on the CPU and stay silent on a
run-fusing device: different behaviour on the two paths, which the invariant
forbids.

The fix is cheap and local: the run `result.geo` is a CPU geometry by the time
the executor wraps it (`src/graph/execute.ts:1192`). Scan the point columns the
run wrote, there, once per run. Cost is one geometry written columns per run -
for the rig scale, tens of thousands of scalars, not millions. It cannot name
the param (the run has fused several), so its policy is REPORT plus a message
naming the run members, not the param-seam throw. The asymmetry is honest and
should be documented: a fused run trades param attribution for a device round
trip, and the guard says which members were in the run.

**(c) Device-resident instance batches - nothing, and here is why that is
acceptable.** A `DeviceTransformsHandle` wraps a GPU buffer that is never read
back (`src/gpu/deviceTransforms.ts:1-15`); `result.deviceBatches` carries it
straight to the renderer (`src/graph/execute.ts:1180-1207`), and the
corresponding `InstancesItem.batches` accessor throws by design. Checking it
means a full readback of count x 16 floats - reintroducing exactly the transfer
the feature exists to eliminate, on the frame path.

The honest answer is: **do not check, and say so in the machine-readable
channel.** Emit a distinct key such as
`CookStats.nonFinite["<terminal>:device-resident"] = "unchecked"`, so an agent
reading the stats can tell "clean" from "not looked at". That is the same
discipline `GpuCookStats.fallbacks` already applies to work the GPU declined.

Note the mitigation that already exists: `resolveBoundingSphere`
(`src/three/webgpuInstances.ts:529-541`) validates the BOUNDS the caller
supplies for such a batch and throws with the cell and asset named, so the one
non-finite value that reaches the frame path from the CPU side is already
caught.

One parity note for the implementer, since it decides whether the CPU throw and
the GPU value even agree: the WGSL compiler documents NaN propagation as
matching the CPU for the comparison-based ops (`src/gpu/compile.ts:554`,
`:583`), and float-to-int stores are explicitly GIGO and NOT matched
(`src/gpu/applyKernels.ts:15`, `:342-343`). A guard on f32 columns is inside
the matched region; a guard that tried to read meaning from an i32/u32 column
produced from a non-finite f32 is not. Guard f32 columns only.

---

## 5. The smallest honest version

**Ship candidate A alone, plus the (b) patch from section 4.** Concretely:

1. `firstNonFinite(data: ColumnData): number` - a shared helper, -1 when clean,
   early-exit on the first offender. f32 columns only.
2. In `resolveOn` and `resolveOnMaybeGpu` (`src/nodes/util.ts:151`, `:192`):
   if `isField(value)`, scan the resulting column; otherwise check the 1-4 raw
   numbers of the plain value (which also closes the `setParam` hole in 1.1 -
   but see section 7 on `boundsMin`). Throw `NodeExecutionError` naming node,
   param, element index and the non-finite count.
3. An explicit opt-out at the two documented-NaN call sites -
   `filterByExpression.predicate` (`src/nodes/filtering.ts:748`) and
   `setAttribute` string value-list mode (`src/nodes/attributes.ts:137`) - each
   with a comment quoting the semantics it preserves.
4. At `src/graph/execute.ts:1192`, scan the fused run `result.geo` point
   columns and REPORT (do not throw), naming the run members.
5. `CookStats.nonFinite?: Record<string, number>` for items 3 and 4, plus the
   `unchecked` key for device-resident terminals.

**Coverage against the eight demonstrations.** Every one resolves through a
single `resolveOn*` call site - traced through each primitive recipe:

| # | demonstrated failure | reaches | call site | resident? |
| --- | --- | --- | --- | --- |
| 1 | `transform/gather-on-path` bins, amount | `pathPointAt.parameter` (`src/primitives/transform.ts:169`) | `src/nodes/paths.ts:638` | no |
| 2 | `shape/ring.sweep` | `transformPoints.translate` (`src/primitives/shape.ts:127-131`) | `src/nodes/pointOps.ts:77` | **yes** |
| 3 | `shape/spiral.turns` | `transformPoints.translate` (`src/primitives/shape.ts:181-185`) | `src/nodes/pointOps.ts:77` | **yes** |
| 4 | `sweepProfile.radius` | `sweepProfile` itself | `src/nodes/surfaces.ts:432` | no |
| 5 | `pathSegments.radius` | `scale` (`src/nodes/paths.ts:550-555`) | `src/nodes/paths.ts:477` | no |
| 6 | `place/radial-on-curve.spread` | `orientAlongVector.up` (`src/primitives/place.ts:288`) | `src/nodes/pointOps.ts:440` | **yes** |
| 7 | `write/random-scale.min\|max` | `setAttribute.value` (`src/primitives/write.ts:110`) | `src/nodes/attributes.ts:184` | **yes** |
| 8 | `transform/relax-spacing.strength` | `transformPoints.translate` (`src/primitives/transform.ts:223`) | `src/nodes/pointOps.ts:77` | **yes** |

**8 of 8 on the CPU path, for 0.038 ms (0.09%).**

**What escapes, stated plainly.**

- **Five of eight on a run-fusing GPU** (numbers 2, 3, 6, 7, 8 - the resident
  column) without step 4. With step 4 they are REPORTED, not thrown, and
  without the param name. Cost of step 4: one geometry per run, low tens of
  thousands of scalars on the rig. This is the coverage claim most likely to be
  overstated by accident; it belongs in the guard own doc comment.
- **Device-resident spawner terminals: nothing, ever** (4c). Declared as
  unchecked in `CookStats` rather than implied clean.
- **Non-finite values a node computes internally from finite params.** Not
  covered by any placement short of candidate B everywhere (8%+). The library
  already tolerates several such cases on purpose (the `orientQuat` fallbacks,
  the `locateOnArcLength` zero-length-segment rule), so this is out of scope by
  design, not by omission.
- **Non-finite data a TypeScript caller writes straight into a column.** Out of
  scope: the `src/data` stance (1.4) is that values are the caller business.
- **`pcg cook` still under-reports the total-loss case** (1.3). Independent of
  the guard and worth fixing in the same pass: three lines in `geometrySummary`
  (`src/cli/summary.ts:139-151`) to set `boundsExcluded` even when no bounds
  could be computed.

---

## 6. What I did not measure, and would

- **Cost on a GPU cook with a real adapter.** All numbers here are CPU-path.
  The step 4 cost is inferred from the shape of `result.geo`, not measured; it
  needs a device run.
- **Cost in a streamed World.** The rig is one cook. The per-cell cost should
  be the same fraction, but the interaction with `budgetMs` yields between
  nodes is untested.
- **Whether early exit matters.** All rates above are full passes. A guard on a
  CLEAN column always pays the full pass, so early exit only helps the failing
  case - it is a diagnostics feature, not an optimisation.
- **The 405,346-scalar constant-broadcast figure is outer-graph only.** The
  nested cooks add to it; the gated design makes the number moot, but if anyone
  proposes an ungated guard, measure it properly first.

---

## 7. Open questions - these need a decision, not more measurement

1. **Streaming.** Should a non-finite param in one cell fail the whole
   `World.update()` (today propagation, `src/runtime/world.ts:888-896`), or
   should the World catch it, skip the cell, and surface it in `UpdateStats`?
   The first is consistent with the cook API and inconsistent with "a cell is a
   unit of work"; the second needs a new field on `UpdateStats` and a rule for
   how long a poisoned cell keeps retrying.
2. **`selfPrune.minDistance` / `priority`** (`src/nodes/filtering.ts:786`). NaN
   there currently means "prune nothing" via the spatial index documented
   tolerance. Is that intended behaviour to preserve as a third opt-out, or an
   accident to refuse? Its own description does not say.
3. **`filterByBounds.boundsMin`/`boundsMax` and the `setParam` hole.** Step 2
   would start checking plain values at cook time, which would refuse the
   +-Infinity spelling the node own description recommends
   (`src/nodes/filtering.ts:242`, `:247`). Either those two params opt out, or
   the plain-value half of step 2 is dropped, or `ParamSchema` gains a way to
   say "infinite is meaningful here". Which?
4. **Does the throw belong behind a version bump?** It converts cooks that
   succeed today into cooks that fail. Every one of them was producing nothing
   drawable, but "produced nothing drawable" and "threw" are different
   observable behaviours for an existing caller.
5. **Is `CookStats.nonFinite` worth adding at all if the primary policy is a
   throw?** It exists only for the opted-out params and the fused run terminal.
   If the answer to question 2 is "refuse", the list shrinks to two and the
   counter may not earn its place in the public type.
