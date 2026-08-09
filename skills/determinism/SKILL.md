---
name: determinism
description: "Doctrine for keeping pcg-ts output reproducible. Use when adding randomness or noise to a graph, when choosing a seed or a per-instance variation knob, when output changes between runs or between machines, when writing a World level's per-cell bind, when touching subgraph or GPU code paths, or before claiming any change is deterministic. Covers the seed chain, what a seed re-rolls and what it provably cannot, why noise varies through position instead, the GPU approximation boundary, and how to verify reproducibility rather than assume it."
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

Three consequences that decide real design questions:

- **Randomness is keyed by index, not by draw order.** Nothing consumes a
  sequential stream, so cook order, partition boundaries, a time budget, a
  cancelled and resumed pass, and the streaming path cannot move a byte.
- **A node id is part of its seed.** Renaming a node re-rolls its randomness.
  Renames in a graph you care about reproducing are not free edits.
- **An index shift propagates.** Any change to the surviving *count* upstream
  renumbers everything downstream, so every per-point value, per-point seed
  and cache key downstream changes too. A filter is the loudest version of
  this.

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
spec*, so `valueNoise` / `perlin` / `simplex` / `worley` / `fbm` are
completely unaffected by a node-level seed. Measured, not assumed: on a fixed
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
  `bind` callback and `ctx.seed` are the only channel; wire `ctx.seed` into
  each stochastic node's `seed` param, varying per node with `hashCombine`.
  See `docs/authoring.md`, "Per-cell seeding". Do not reach for wall-clock
  time, a counter, or cell arrival order — there is no `Math.random` anywhere
  in this library and adding an ambient source of variation breaks the
  pillar.
