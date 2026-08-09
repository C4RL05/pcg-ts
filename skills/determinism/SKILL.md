---
name: determinism
description: "Doctrine for keeping pcg-ts output reproducible. Use when adding randomness or noise to a graph, when choosing a seed or a per-instance variation knob, when output changes between runs or between machines, when writing a World level's per-cell bind, when content must look the same from either side of a cell boundary or a halo, when adding or sizing a neighbourhood, prune or topology op, when touching subgraph or GPU code paths, or before claiming any change is deterministic. Covers the seed chain and its one exception, what a seed re-rolls and what it provably cannot, why noise varies through position instead, world-anchoring and identity-keyed randomness, the hop count that decides whether an op can be partitioned at all, the GPU approximation boundary, and how to verify reproducibility rather than assume it."
---

# Keeping pcg-ts output reproducible

Determinism is a hard invariant here: same graph, same seed, byte-identical
output across runs, platforms, cook orders and streaming paths. It holds by
construction, and it is easy to break by accident. Reference for the
contracts is `llms.txt` ("Key invariants and contracts") and
`docs/authoring.md`; this is the doctrine for working inside them.

## The seed chain

Every random value in the library is derived, never drawn from a stream.

```
graph seed  (the JSON "seed" field)
  -> node seed   = hashCombine(graphSeed, hashString(nodeId))
  -> inner seed  = hashCombine(nodeSeed, hashString("subgraph"))   [subgraph nodes]
  -> per element = hashFloat(hashCombine(seed, index, axis))
```

Four consequences that decide real design questions:

- **Randomness is keyed, never drawn.** Nothing consumes a sequential
  stream, so cook order, partition boundaries, a time budget, a cancelled
  and resumed pass, and the streaming path cannot move a byte.
- **A node id is part of its seed.** Renaming a node re-rolls its randomness.
  Renames in a graph you care about reproducing are not free edits.
- **An index shift propagates.** Any change to the surviving *count* upstream
  renumbers everything downstream, so every index-keyed per-point value and
  cache key downstream changes too. A filter is the loudest version of
  this — and it is the reason the nodes that must survive repartitioning
  key on point *identity* instead (next section).
- **Ordering is a determinism surface too, and it uses the same tiebreak.**
  Anywhere the library has to order elements — a path's vertex order in
  `pointsToPath`, a capped neighbour set, a shared-edge transfer hit — ties
  break to the *lower index*, never to arrival order, sort stability or
  partition completion. Hold to that rule in anything you add; it is what
  makes an order reproducible without being a random draw.
A subgraph's inner seed derives from the wrapping node's seed, so two
instances of the same primitive in one graph get different randomness, and
the same instance reproduces exactly. The inner graph's own serialized `seed`
is inert — every cook overwrites it — which is why it is excluded from the
primitive content hash.

## What a seed re-rolls, and what it cannot

`setAttribute`'s `seed` param (and the sampler nodes' `seed` params) fold in
as `hashCombine(nodeSeed, seed)`, with `0` meaning "node seed unchanged" so
graphs authored before the param exists keep bit-identical output.

**It re-rolls randomness drawn from the evaluation context** — `randomField`,
and the per-point `seed` attribute.

**It does not touch noise.** A noise field carries its own seed *inside its
spec*, so `valueNoise` / `perlinNoise` / `simplexNoise` / `worleyNoise` /
`fbm` — the grammar's actual names, which is what a `fn` field must say —
are completely unaffected by a node-level seed. Measured, not assumed: on a fixed
16-point grid, changing `setAttribute.seed` from 0 to 99 moved a
`randomField` attribute (mean 0.5003 to 0.5584) and left a `perlinNoise`
attribute bit-identical (min −0.19169002771377563, max 0.20500269532203674,
identical in both runs).

So there are exactly two ways to vary noise:

1. Set `opts.seed` inside the field spec — reachable when you author the spec.
2. **Move the position it samples** — the only route from outside, because an
   exposed param cannot reach inside a field spec at all.

That is why noise-bearing primitives expose `frequency` and `variant` rather
than a seed: `variant` is added to the sample position and walks to an
unrelated part of the same infinite field, which is what a per-instance seed
would have done. Verified end to end: the same graph through
`filter/mask-by-noise` keeps 269 points at `variant: 0` and 289 at
`variant: 100`, with everything else unchanged. Any two different values are
unrelated; the same value always reproduces.

If you are reaching for a seed to make two instances of a noise-driven
primitive look different, you want `variant`.

## Anchoring: the same point under any window

Reproducibility has a second half that "same seed, same bytes" does not
cover. A partitioned world asks the *same question at different sizes* —
one cell, that cell grown by a halo, the whole region cooked at once — and
every one of those answers has to agree about the points they share.
A graph can be perfectly deterministic and still fail this, deterministically
and silently, at every seam.

**The distinction to hold.** A cook budget partitions *time*, and nothing in
this section applies to it: node bodies are atomic under a budget, so every
node still sees its whole dataset. A `World` cell partitions *data*. Only
data-partitioning needs anchoring, and it needs it in the chain, not in one
node.

**A source is anchored when its output is a function of world coordinates
rather than of the query.** This is not a new discipline — it is what noise
has always done, which is why moving the sample position is the only way to
vary a noise field. `pointScatterInWorld` applies it to a source: positions
come from the lattice cell and index, and the bounds only choose which cells
to visit and clip. `pointScatterInBounds` computes positions *from* the
bounds, so widening it to build a halo moves every point and reproduces
nothing. Every neighbourhood-style op inherits that, not just the ones near
an edge.

**Downstream stays anchored by keying on identity, not index.** An index is
a fact about *this array* — a filter one node earlier renumbers it. Identity
is the point's stored position bits plus its `seed` attribute, so a point
decides the same way whichever window derived it and however many neighbours
were dropped upstream. Which nodes key which way, and which still fold in a
node seed you must therefore anchor yourself, is tabulated in
`docs/authoring.md`, "Content that must NOT vary per cell". Read the table
before assuming a chain is safe: identity keying makes a node indifferent to
the *window*, never to its own seed, so a per-cell `ctx.seed` wired one node
downstream de-anchors the chain just as thoroughly as de-anchoring the
source did.

**One node sits outside the seed chain, on purpose.** `pointScatterInWorld`
derives its lattice from its own `seed` param alone; the graph seed does not
reach it. Do not "fix" that. A `graph.setSeed` inside a level's `bind`, a
CLI `--seed`, or a rename would otherwise de-anchor a world silently — the
failure this exception makes impossible rather than merely documented. The
price is the lost node-id decorrelation: two such nodes with equal params
scatter *identical* points, exactly as two `perlinNoise` fields with one
spec are one field. Separate layers with `hashCombine(ctx.worldSeed, n)`.

**Count the hops before deciding an op can be partitioned at all.** A halo
is exact only where the operation's reach is *bounded*, and "bounded" is
stronger than "local" — every step of a greedy chain is local and the chain
is not. The question that actually decides it is **how many hops of
dependency it takes before an answer is settled**, and the shipped nodes
populate all three rungs:

| Hops | The answer reads | Halo | Worked example |
| --- | --- | --- | --- |
| **Zero** | only stored values of the elements it names — no third element | exact at the op's own reach | `connectPoints`: whether A and B are an edge is a distance between two *stored positions*, so a cell also holding every point within `radius` of its rectangle is exact at `haloWidth >= radius` |
| **One** | its neighbours' stored *values*, never their *answers* | exact at the stated width | `pointNeighborhood` within `radius`; `selfPrune` mode `localMaximum`, which decides each point from its immediate neighbours alone |
| **Unbounded** | another element's *answer* | none, at any width | a greedy prune — this point survives because that neighbour did not, because ITS neighbour did; a minimum spanning tree, where an edge belongs iff no lighter *path* connects its ends; a shortest path |

Two payoffs from stating it this way. The zero-hop rung is where the
argument is *structural* rather than measured: `connectPoints` needs no
seam experiment because no third point can enter the decision, and
`relativeNeighborhood` stays on that rung because its disqualifying witness
must lie inside the pair's own neighbourhood. And the unbounded rung is a
design constraint, not a bug to fix later — it is why `connectPoints` ships
a local lune test that *contains* an MST instead of an MST mode, and why no
shortest-path node ships at all. Worse than unbounded are the ops with no
reach to widen: anything that fits parameters to the population present in
this cook (`attributeRemap` mode `"fit"`, `attributeReduce`, aggregate
`promoteAttribute`, the `fraction` and `index` fields) measures the
population *here*. The `performance-and-budgets` skill catalogues those.

One consequence for the ownership step — the clip back to the unwidened
cell with `filterByBounds` at `halfOpen`. When the op emitted **topology**,
that clip would DROP the topology rather than trim it, so ownership moves
to the primitive domain and to `filterPrimitivesByBounds`, which keeps the
edges whose lower-keyed first vertex lies in the unwidened rectangle. Only
its `vertex` values `first` and `last` are ownership rules — each reads a
single vertex, so exactly one cell claims each edge; `all` and `any` are
selections and tile nothing. See `docs/authoring.md`, "Networks: the
primitive domain is the edge domain", and the node's entry in
`docs/nodes.md`.

**Verify it with the three questions a single-graph test cannot ask.**
Byte-comparing one cook against itself proves nothing here; each of these
compares two *different* partitionings of the same world.

1. **Permutation equivariance** — shuffle the input order, expect the same
   output (modulo the same permutation). Catches anything that leaked an
   array index into a value.
2. **Split-with-halo equals whole** — cook a region in one pass, then cook
   it as cells with halos and concatenate the owned points. Any difference
   is a seam you would otherwise find by eye, later.
3. **Two-cell seam agreement** — cook both sides of one boundary and assert
   that every point is claimed exactly once and measured identically in both.

`filterByBounds` at its default `halfOpen` boundary is the ownership rule
that makes question 3 answerable; `inclusive` has both cells emit the shared
face, which is invisible until two cells disagree.

## The GPU boundary

The CPU is the bit-exact reference; goldens are CPU-produced and never move.
The device path is a **documented approximation**: hash/random streams,
integer roots and f32 add/sub/mul/clamp/min/max/floor/select are bit-exact
ports, and everything else matches within measured per-op-family ULP budgets
that a different adapter may exceed. The table is in `docs/authoring.md`,
"Determinism contract and measured budgets".

`filterByExpression` deliberately does **not** declare `gpu: "fields"`,
breaking the pattern every other field-capable node follows. The reason is
worth internalizing before "fixing" it: the approximation is tolerated
elsewhere because it moves a *value* by an ulp. In a filter the value is a
*decision*. A point sitting on the predicate boundary flips in or out, which
changes the surviving count — and by the index rule above, every downstream
index, per-point seed and cache key with it. Adopting it needs a parity
budget expressed in surviving points, not in ulps.

The general rule: an ulp is acceptable where it perturbs a magnitude, and
never where it decides a branch, a count or a key.

## Verify — do not assume

The test is always the same: produce it twice and compare bytes.

At the CLI, `render` is the cleanest oracle because the SVG carries no
timings:

```
pcg render g.json --out a.svg
pcg render g.json --out b.svg
cmp a.svg b.svg
```

The `--json` reports do carry `elapsedMs` (and `cook --out` echoes its own
path), so strip the timings before diffing them:

```
pcg inspect g.json --json | grep -v elapsedMs > a.json
pcg inspect g.json --json | grep -v elapsedMs > b.json
cmp a.json b.json
```

Both of those were run against a real graph and are byte-identical.

Then run the negative half, which is the one people skip: `pcg cook g.json
--seed <other>` must produce *different* output. If it does not, nothing in
the graph is actually seeded and the "reproducible" result is reproducible
for the wrong reason.

In code, cook **two fresh graphs** built from the same builder and compare
snapshots, rather than re-cooking one graph — a second cook of the same graph
can pass on cache alone and proves much less. Assert both: fresh-vs-fresh
byte identity, and that a re-cook reports `stats.cooked === 0` with identical
data. The reference implementation is the `whole-library determinism` suite
in `src/nodes/integration.test.ts` (its `snapshotGeometry` helper lives in
`src/nodes/testSupport.ts` and is internal, not public API).

## What legitimately varies

- **Across library versions.** Byte identity is not attempted and is
  unattainable by any design: an embedded subgraph payload freezes the
  defaults and canonicalization of the build that wrote it, while a named
  `ref` is re-derived from the current build. The optional `ref.hash` pin is
  precisely what converts that divergence from silent into a stated error.
- **Across GPU adapters**, within the published budgets. One device is
  run-to-run byte-identical; two devices are not promised to agree.
- **Nothing else.** Cook order, partitioning, budgets, cancellation,
  streaming and CPU platform are all guaranteed not to matter. If output
  moves along any of those axes, it is a bug, not a tolerance.

## Hazards this project has actually hit

- **Concurrency is a determinism surface.** One inner `Graph` can back
  several subgraph wrapper instances. A wrapper that writes the inner seed
  and inputs *before* entering the exclusivity guard lets a concurrent cook
  overwrite them between the write and the read — same graph, same seed,
  output dependent on scheduling. Preparation and cook must be one
  indivisible step.
- **Saving must be a pure function of the graph.** Wrapper writes into a
  shared inner graph that are never restored made `serializeGraph` bytes
  depend on cook history: the same graph serialized differently before
  cooking, after cooking itself, and after cooking a *different* graph that
  shared the definition.
- **A test that has never been seen to fail is worth nothing.** Prove a
  determinism regression test reddens by disabling the fix before you trust
  it, and reproduce the bug against a clean oracle before you fix it.
- **Per-cell variation has sanctioned routes.** In a `World`, the level's
  `bind` callback is the only channel. Wire `ctx.seed` into each stochastic
  node's `seed` param, varying per node with `hashCombine` — *except* for
  anything that must agree across a cell boundary, which takes the
  cell-invariant `ctx.worldSeed` or `ctx.levelSeed` instead. See
  `docs/authoring.md`, "Per-cell seeding" and "Content that must NOT vary
  per cell". Do not reach for wall-clock time, a counter, or cell arrival
  order — there is no `Math.random` anywhere in this library and adding an
  ambient source of variation breaks the pillar.
- **A whole-graph reseed in `bind` reaches further than it looks.**
  `graph.setSeed` inside a level's `bind` is supported and re-rolls *every*
  node, so it is exactly wrong in a level carrying anchored content: it
  de-anchors every seeded node downstream of the source in one line. Prefer
  per-node `seed` params there, which state which nodes vary per cell and
  which do not.
