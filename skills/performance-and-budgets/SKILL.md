---
name: performance-and-budgets
description: "Doctrine for what a pcg-ts cook costs and for keeping it from blocking the frame. Use when a cook is slower than expected, when reading `pcg cook --stats`, when choosing a budget for a frame loop or a World update, when sizing candidate counts or deciding where a filter belongs, when a graph is fine standalone but seams or stutters inside a World, or before optimizing anything inside the library. Covers the two unrelated budgets, what each stats number means, the cost asymmetry you control, the SoA rules for hot loops, and the optimization determinism forbids."
---

# Cost and budgets in pcg-ts

Two questions get conflated, and conflating them wastes the work: **how
much a cook does**, and **whether doing it blocks the frame**. Budgets
address only the second. A graph that scatters ten times the points it
keeps is not fixed by any budget.

*What exists* is in `docs/nodes.md`, `docs/primitives.md` and
`docs/authoring.md`, cited here rather than copied. The figures below were
measured at phase 40 on one machine with the commands shown — orders of
magnitude, not constants. Re-measure yours; the method is the transferable
part.

## Read the numbers before changing anything

```
pcg cook g.json --stats
```

Line two is the summary — `32 cooked, 0 cached, 30.3 ms` — and each number
has a different fix behind it.

- **`cooked`** is nodes whose `execute` ran. Not the graph's node count:
  only the upstream subgraph of the selected outputs is visited. A rise
  here without new nodes means something stopped hitting cache.
- **`cached`** is nodes served from their memo entry. `cooked + cached` is
  always the number of nodes visited, so the pair tells you whether a
  cheap-looking pass was cheap from caching or from doing little.
- **`elapsedMs`** is the whole pass — read it against the per-node table
  `--stats` prints below (`id  type  state  elapsed`), because cost is
  never spread evenly. Every stage of the shipped pipeline spends ~8 ms
  inside one `terrain` subgraph node, so a 30 ms stage is 22 ms of
  everything else and the terrain is not the thing to look at. Those
  numbers are from an unbudgeted cook, which is what makes them work.
  **Add `--budget` and they become wall time**, including the latency of
  every yield the cook took — and the `terrain` node is a `subgraph`,
  one of the three types that yield inside themselves. See "A budgeted
  `elapsedMs` is wall time, not work" below before comparing any two
  budget settings.

Optimize the top row of that table. `pcg inspect` reports the same three
numbers for one pin, which attributes cost to a branch rather than a graph.

**The trap: warm is not cached.** A second run being faster proves
nothing about caching — check `cached` before concluding it. Measured on
the staged pipeline, which had six files then: all six in a fresh process,
124 ms; the same six again in that process, 42 ms, worst stage 12 ms — and
every pass reported
`cached=0`, because each file was deserialized into a *new* graph with cold
caches. That 3x is the JIT, not the memoizer. The memo cache looks nothing
like it: re-cooking one *same* graph object went `39 cooked, 0 cached,
7.2 ms` → `0 cooked, 39 cached, 0.2 ms`.

So: **rebuilding a graph throws away every warm cache.** Mutate the graph
you have (`setParam`, `connect`) when the cache matters; `deserializeGraph`
again when you want a cold measurement.

## Two budgets, and they mean opposite things

"Budget" covers two unrelated mechanisms. Swapping them gives you either a
stall or an empty world.

**`CookOptions.budgetMs` is a *yield* budget.** When a node completes and
the current slice has run past the budget, the executor yields to the event
loop and starts a new slice. It never leaves work undone — cooking always
completes unless aborted through the signal. Use it to keep a long cook
from freezing the page, never to bound total cost.

**`UpdateOptions.budgetMs` on a `World` is a *stop* budget.** It is checked
*before* starting each cell; cells past it are counted `pending` and picked
up by the next `update()`. So `budgetMs: 0` here cooks nothing and leaves
the store untouched — the opposite of what zero means to a cook. Its
companion `maxCooksPerUpdate` bounds the same queue by count, which is the
better knob when per-cell cost is unpredictable. `World.update` also passes
its budget down as each cell's yield budget, so one number does both jobs.

**Granularity is one node — the EXECUTOR never slices one.** The yield
check sits after `cookNode` returns (`src/graph/execute.ts:1353-1359`), and
a node is handed only `signal`/`checkCancelled()`, which throws rather than
yielding. There are no generators, resumable state or `shouldYield` hooks
anywhere in `src/`. So a single 200 ms LEAF node blows any budget and no
budget will fix it — that is a node to make cheaper or to move to a coarser
level. Same shape at the World level: the in-flight cell always runs to
completion.

**But a node may slice ITSELF, and four do.** `budgetMs` is forwarded into
node execution, and the composites meter it internally: `forEach`
(`src/nodes/forEach.ts:286-290`), `repeatUntil`
(`src/nodes/repeatUntil.ts:545-549`), `subgraph` (`src/graph/subgraph.ts:837`,
whose inner cook runs this same loop with its own slice clock) and the
resident GPU run, between member kernel encodings (`src/gpu/run.ts:1280-1284`).
With a GPU resolver, `src/nodes/util.ts:328-330` also awaits a real device
readback inside ordinary leaf nodes. Read "granularity is one node" as a
statement about the EXECUTOR, not a guarantee that every node is atomic in
wall-clock time.

**Do not hardcode that list — the library publishes it.** Those four names
are the answer TODAY, and a consumer that copies them into its own code is
keeping a second model of this scheduler. Two fields state the fact instead:

- **`NodeTypeInfo.selfMetered`** (`listNodeTypes()`, `pcg nodes <type> --json`)
  — `true` on `subgraph`, `forEach`, `repeatUntil`; the key is absent on
  every other type, the way an absent `category` means uncategorized. It
  answers the question *without cooking anything*. A node type declares it
  with `NodeDef.selfMetered`, beside `gpu` and `resident`
  (`src/graph/node.ts`), and `src/graph/execute.ts` reads it off the def —
  there is no list of type names in the executor, so a fourth composite is
  flagged by declaring it and nothing else has to change.
- **`NodeDoneInfo.selfMetered`** — per entry, on every `onNodeDone` report.
  `false` means the executor timed one uninterrupted run and `elapsedMs` is
  a real block. `true` means it is wall time that may span the node's own
  yields.

The GPU run is the one case where the two disagree, on purpose. No
resident-capable type declares `selfMetered` — on the per-node path
`setAttribute` and friends really are atomic — so the flag is set by the
EXECUTOR on the fused run's terminal, the member that carries the run's
whole elapsed time (`src/graph/execute.ts`, both `cookResidentRun`
branches). Interior members report `elapsedMs` 0 and `selfMetered` false.
The same node reports false when its plan is rejected and it cooks per-node.

### A budgeted `elapsedMs` is wall time, not work

Say it plainly, because the number looks like work and is not: **under
`budgetMs`, a self-metering node's `elapsedMs` includes the latency of
every yield it took.** On this box each `setTimeout(0)` costs ~1 ms on an
idle loop. Measured on `basics-repeat-until-settled` @6000, one
`repeatUntil` node reported:

| cook | node `elapsedMs` | what it is |
| --- | --- | --- |
| unbudgeted | 25.6 ms | one uninterrupted block |
| `budgetMs: 1` | 450.7 ms | wall time; longest real block ~4.7 ms |

That is a **95x** overstatement, and it INVERTS the verdict: `budgetMs: 1`
is the setting that makes the graph most launchable, and ranking on the raw
number ranks it as catastrophically the worst. `CookStats.elapsedMs` for
the whole pass is wall time for the same reason.

**The recipe: derive the longest block from an UNBUDGETED cook.** Every
budget check in the library is `budgetMs !== undefined`, so with it unset
nothing yields on the budget, every `elapsedMs` is a true block, and the
largest is the floor no budget can lower — the figure you actually want,
and it needs no event-loop probe. (One caveat, and it is not about the
budget: with a GPU resolver, `src/nodes/util.ts:328-330` awaits a real
device readback inside ordinary leaf nodes, so measure the CPU path when
you want CPU block times.)

```ts
const seen: NodeDoneInfo[] = [];
await cook(g, { onNodeDone: (i) => seen.push(i) }); // no budgetMs
const longestBlock = Math.max(...seen.map((i) => i.elapsedMs));
// nothing yielded on the budget, so every elapsedMs here is a real block
// and `selfMetered` does not change how to read one
```

Then use a budgeted cook to check RESPONSIVENESS — that the event loop got
control back — never to compare durations. If you must read timings out of
a budgeted cook, an entry with `selfMetered === false` is directly
comparable (that path is identical either way); an entry with `true` is an
upper bound and nothing more. One gap the flag does not close, because it
is not about yielding: a rejected fused-run plan does real work
(`assembleInputs` plus member hashing) and reports no `onNodeDone` at
all, so the per-node timings never sum to `CookStats.elapsedMs`.

From the CLI, `--budget <ms>` takes any non-negative number. **`--budget 0`
is allowed and meaningful** — every budget check is `budgetMs !== undefined`
rather than a truthiness test, so 0 yields after every node, which is the
maximum-partitioning self-test the next section describes. Negative and NaN
are still misuse.

## Partition-safety, and the check that proves it

`budgetMs: 0` yields after *every* node — the most finely partitioned cook
the library can perform. Since output must not depend on cook order,
partitioning or cancellation, a cook under it must be byte-identical to an
unbudgeted one. That makes it a cheap, decisive self-test:

```ts
const a = await cook(deserializeGraph(json), {});
const b = await cook(deserializeGraph(json), { budgetMs: 0 });
// compare the outputs byte-for-byte; any difference is a bug
```

Run across the whole corpus at phase 40 (34 graphs then): zero differed.
The corpus suite itself cooks every example under `GRAPHS_BUDGET_MS = 8`
(`src/docs/graphGolden.ts`) for the same reason — exercising the partitioned
path on real graphs is free and would otherwise go untested.

**Know its limit, because it is narrower than it looks.** There are two
partitionings and this check covers only one of them.

- **A cook budget partitions *time*.** The yield happens *between* nodes,
  so every node body is atomic under it and still sees its whole dataset.
  Nothing can seam, because nothing was cut. That is why this check is
  cheap and why passing it proves so little about a World.
- **A `World` cell partitions *data*.** Each cell cooks over its own slice
  and can see no other cell — there is no sibling accessor, and neighbours
  are LRU-evictable, so there is nothing to ask even if you wanted to.

Only the second needs halos and identity-keyed randomness, and only the
second can produce a discontinuity that no test of a single graph will
show you. The mechanism — anchor the source, query a wider box, clip to
ownership with `filterByBounds` — is in `docs/authoring.md`, "Content that
must NOT vary per cell", and the doctrine for verifying it is the
`determinism` skill's "Anchoring" section. What follows is the cost side
of the same story: the shortcuts that look like optimizations and are
really cell-local measurements.

## The optimization determinism forbids

**Anything that fits parameters to the data present in this cook is
cell-local, and will seam.** Under a World each cook sees one cell's
elements, so a quantity derived from "all the points" is derived from all
the points *here*. Neighbouring cells compute different constants and the
boundary between them becomes visible — a discontinuity that does not exist
in an unpartitioned cook, and that no test of a single graph will show you.

It is the trap that looks like an optimization, because measuring the data
is cheaper and far more convenient than plumbing a constant in. The ones
that bite:

- **`attributeRemap` mode `"fit"`** measures the attribute's own min/max
  over the geometry it was handed. Mode `"range"` with explicit bounds is
  the partition-safe form.
- **`attributeReduce`, and aggregate `promoteAttribute`**, reduce over the
  elements present — per cell, a per-cell total.
- **`fraction` and `index` fields** read the element count of the domain
  they land on. Both mean "position along this thing", never "position in
  the world".
- **`selfPrune` and `pointNeighborhood`** work inside one cloud: a minimum
  distance holds within a cell and not across a boundary, and a point near
  an edge sees a truncated neighbourhood.

That last pair is the one worth understanding properly, because a halo
fixes it only when the operation's **reach is bounded**, and "bounded" is a
stronger condition than "local". `pointNeighborhood` is bounded: it reads
everything within `radius`, so a halo of `radius` reproduces the
whole-region answer exactly. A *greedy* prune is not: this point survives
because that neighbour did not, which happened because ITS neighbour did,
and the chain has no bound — no halo width covers it, and the failure shows
up as seam pairs closer than the distance the node exists to enforce.
`selfPrune` therefore carries a `mode`; the local-maximum rule decides each
point from its immediate neighbours alone and is the halo-exact one, at the
cost of keeping strictly fewer points. `docs/nodes.md` has the rule, the
required halo width, and the measured seam numbers. The general test —
count the **hops of dependency** before an answer is settled, zero / one /
unbounded — is the `determinism` skill's, with the worked examples; use it
before sizing a halo rather than after measuring a seam.

The three cases above it are worse still: they measure the whole population,
so no reach bound exists to widen to.

Hashed randomness is *safe* — `randomField`, `filterByDensity` mode
`"probabilistic"`, `jitterPoints`, the per-point `seed` — because it hashes
a key instead of measuring a population. On the point domain that key is
the point's **identity** (its position bits plus its `seed` attribute), not
its array index, which is what lets a point survive being renumbered by an
upstream filter or derived from a different window. It costs nothing extra
at runtime and it is the whole reason a halo reproduces anything. The
`determinism` skill covers why that distinction is the design.

When you genuinely need a global quantity: compute it once on the coarse or
unbounded level and push it down. A level's `bind` can feed the parent's
outputs into a `dataInput`, and the child remaps against bounds that are
identical in every cell. See `docs/authoring.md`, "Per-cell seeding".

## The cost you actually control

Micro-optimization is rarely where a graph's time goes. Three authoring
decisions dominate it.

**Candidate count before acceptance.** Nearly every generation pattern is a
funnel: scatter candidates, reject most. Cost is paid on the candidates,
not the survivors — so the scatter count is the real knob, and it is the
one tuned last because the visible number is the survivor count. Halving a
scatter feeding a filter that keeps 10% halves the cook.

**Filter ordering.** Filters are commutative in intent and never in cost.
Cheapest and most selective first, so everything after runs on fewer
points. A bounds or attribute comparison costs almost nothing; a raycast
transfer, a neighbourhood query or a noise field costs per point.

**Pair-wise work is priced in `radius`, not in point count.**
`connectPoints` scans the same radius neighbourhood in both modes, and the
pair count grows with `radius^2` over a surface and `radius^3` through a
volume — so it is `radius` that runs away, and a guard at 1,048,576 edges
fails during the scan rather than after allocating. Switching to
`relativeNeighborhood` does not help the cost: it keeps far fewer edges but
selects them from the same neighbourhood. Lower `radius`, thin the cloud
upstream (`selfPrune`, `filterByDensity`) — upstream, because a filter
placed *after* it also destroys the network — or cook the region in cells.

**The spawner is budgeted, and the budget is per cook.** `spawnInstances`
refuses a cook that would produce more than 1,048,576 instances — one per
input point, 64 MiB of transforms — before it allocates anything, so a
density typo is a named diagnostic instead of an allocation failure. The
fix it names is the funnel above: thin the cloud *upstream*, or cook the
region in cells with a `World` level. Note what the ceiling is not: it is
not a limit on instances *alive*. A global one would depend on which cells
happened to be resident, so the same world would fail or not depending on
the order it streamed in — the order-dependence the `determinism` skill
forbids. A streamed world holding many times the budget across its live
cells is correct, not a leak.

**Where the filter sits relative to expensive work.** Filtering *after* the
expensive node pays for points you are about to discard, so move it
upstream of the cost — with one hard exception from the `graph-authoring`
skill: a filter rebuilds the point domain and drops polyline topology, so a
graph that needs a path or a network filters first and builds the topology
after. Here cost and correctness point the same way, which is convenient
until the filter is a cell clip and cannot move; then ownership goes on the
primitive domain instead, via `filterPrimitivesByBounds`. When the test is
a value the primitive carries rather than a boundary,
`filterPrimitivesByAttribute` is the same move for the same reason: it
thins the network while it is still a network, so a sweep or a sampler
downstream pays for what survives and not for what was proposed. Order for
cost, then check you have not broken topology.

**When a stage exceeds its budget, shrink the stage.** The staged pipeline
holds itself to 1000 instances across a stage's declared outputs
(`INSTANCE_BUDGET`, `tests/pipeline.test.ts`); stage 4 sits at 731. The
failure message states the rule outright — a stage that outgrows its budget
is shrunk, the budget is not raised. A cap that moves whenever it is
inconvenient is not a cap.

## Extending the library: the SoA rules

Attributes are struct-of-arrays: one `Attribute` per name holding a flat
typed array (`Float32Array`, `Int32Array`, `Uint32Array`, `Uint8Array` for
bool, `Uint32Array` of string-table indices for string) plus a `tupleSize`.
`CLAUDE.md`'s rule — typed arrays in hot paths, never per-point objects in
inner loops — cashes out as four habits.

**Hoist the array and the stride, then index by hand:**

```ts
const P = geo.attrs.point.require("P");
const pd = P.data;
const ps = P.tupleSize;
for (let i = 0, n = geo.pointCount; i < n; i++) {
  const o = i * ps;
  const x = pd[o], y = pd[o + 1], z = pd[o + 2];
}
```

**Do not hold `data` across a resize.** Growth reallocates the buffer, so a
reference hoisted above an `AttributeSet.resize` writes into an orphaned
array — no error, values silently lost. Hoist inside the region where
capacity is fixed.

**The convenience accessors are not for inner loops.** `get`/`set` re-read
`this.data` and `this.tupleSize` per component, `setTuple` validates every
call, `getString`/`setString` intern through a `Map`, and `getTuple`
**allocates a `number[]` per call** unless you pass `out`. They belong in
setup and validation. The bulk helpers (`fill`, `fillDefault`, `copyFrom`)
delegate to typed-array intrinsics and beat a hand-written loop where they
fit.

**Inputs are shared, not yours.** Upstream memo caches hold the same
objects your node receives, so a node transforming geometry clones first
(`cloneGeometry`). Mutating an input corrupts the cache with no error and
no way to notice until a later cook returns something impossible.

And one the executor cannot do for you: a node running a long loop must
call `checkCancelled()` periodically. Cancellation and the yield budget are
both checked *between* nodes, so a node that never yields cannot be
interrupted.
