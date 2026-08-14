---
name: graph-authoring
description: "Doctrine for building a pcg-ts graph. Use before writing or editing pcg-ts graph JSON, when choosing between a shipped primitive and hand-wired node types, when a graph rejects a param or pin you guessed at, or when it cooks without error but the output looks wrong. Covers what to read first, how to discover what exists, exposing knobs instead of hardcoding them, and the validate/cook/inspect/render loop with the pcg CLI."
---

# Building a pcg-ts graph

This is doctrine — the order to do things in and how to tell whether the
result is right. *What exists* lives in the generated references, and they
are cited here rather than copied, because a pasted list goes stale and a
stale list is worse than no list.

- `llms.txt` — the mental model, the JSON field names, the invariants.
- `docs/primitives.md` — the primitive catalog (`docs/primitives.json` for machine reading).
- `docs/nodes.md` — every node type, its pins, params, defaults and ranges (`docs/nodes.json`).
- `docs/authoring.md` — the graph JSON spec, the field-expression grammar, worked recipes.
- `docs/examples.md` — the single-concept example corpus, indexed by what each one teaches.

The CLI is `pcg` when the package is installed (`npx pcg …`), and
`node bin/pcg.mjs …` from a clone. Both are the same entry point.

## Do this first

Three reads, in order. Most of the failures at the bottom of this file are
what happens when one is skipped.

1. **Scan the primitive catalog** (`docs/primitives.md`). It opens with a
   one-line summary of every primitive. If one of those lines describes what
   you are about to build, you are done choosing.
2. **Read one example graph** (`docs/examples.md`) close to your goal. Copy
   its shape. `docs/authoring.md`'s "Recipes" section carries longer,
   annotated ones.
3. **Look up the exact schema of anything you type by hand** — `pcg nodes
   <type>` for a node, `pcg fields <fn>` for a field expression, and the
   primitive's own section in `docs/primitives.md` for a `ref`.

Never write a param name from memory. `pcg nodes` with no argument prints
the whole registry by category; `pcg nodes pointGrid` prints that type's
pins and full param table.

## Prefer a primitive

A primitive is a registered subgraph referenced by name instead of an
embedded payload. Referencing one is one node:

```json
{ "id": "ground", "type": "subgraph",
  "params": { "count": 800, "size": [40, 0, 40] },
  "ref": { "name": "shape/disc" } }
```

Decide this way:

- A primitive whose summary line matches the intent → **reference it**. It is
  tested, its defaults are tuned to produce something on the first cook, and
  it collapses several nodes into one.
- Close but not exact → reference it and check its exposed params first. The
  knob may already be there.
- Nothing covers it → wire node types, and consider whether the result should
  become a primitive.

Primitives compose out of primitives, so a `ref` inside your graph may itself
be built from other refs. Reach past a primitive to raw nodes only when it
does not expose the pin or param you need — not because the graph "looks
cleaner" flat. It does not; it just loses the tests.

`ref.hash` is optional and it is a decision, not decoration: absent means
"the library's current version of this primitive", present means "cook
exactly what I authored against" and hard-errors on any change. Neither mode
warns. See `docs/authoring.md`, "Pinning: the optional content hash".

To try a primitive alone, with no graph file at all:

```
pcg run shape/disc --param count=400 --param size=24,0,24
```

`--param` is repeatable and typed by that param's own schema. This works for
primitives with **no input pins** (the pins are listed per primitive in
`docs/primitives.md`); one that takes geometry has nothing to feed it and
will fail inside — write a graph instead.

## Parameterize, don't hardcode

Every number a caller might reasonably want to change belongs in a param, not
buried in a value. When you wrap your own subgraph, expose the knobs: an
exposed param binds one param on the wrapping node to one or more inner
slots, and its schema is *derived* from those targets, so it cannot promise
something the inner node would reject.

Two constraints that decide the design for you:

- An exposed param's default must be a plain value, and every cook writes the
  current value inward. So a slot holding a field expression **cannot** be
  usefully exposed — the first cook overwrites the expression with a number.
- An exposed param DOES reach inside a field spec, by name: a spec in the
  body reads it as `{ "fn": "param", "name": "amplitude" }`, and `targets`
  is optional — a param that writes nowhere and is only read by a spec is
  the normal shape. This is what the shipped vocabulary uses.
- What still cannot be reached is a noise's `seed`, `frequency` or
  `offset`. Those live in `opts`, which the parser reads as plain numbers;
  only ARGUMENT positions hold a reference. `opts.position` is an argument
  position, so a tunable frequency multiplies the sample position instead:
  `position: { "fn": "mul", "args": [{ "fn": "position" }, { "fn":
  "param", "name": "scale" }] }`, leaving `frequency` at its base.

So keep the noise on an inner node and expose the scalars its spec reads —
typically a scale on the sample position and a `variant` added to it. See
the `determinism` skill for why `variant` is the re-roll and a seed is not.

## The loop

```
pcg validate g.json                          # structure, before anything cooks
pcg cook g.json --stats                      # what came out, and what recooked
pcg inspect g.json --node <id> --pin <pin>   # the numbers
pcg render g.json --out g.svg                # the picture
```

- **validate** deserializes and reports nodes, connections and outputs. It
  catches unknown types, unknown params, bad pins and cycles before any work
  happens. Run it after every edit; it is nearly free.
- **cook** cooks every declared output and reports element counts, bounds and
  the attributes present. `--stats` adds the per-node breakdown of cooked vs.
  served-from-cache. `--budget <ms>` bounds a pass; `--seed <n>` overrides the
  graph seed without editing the file.
- **inspect** is the debugger. Point it at an intermediate node
  (`--node <id> --pin <pin>`) and it prints per-attribute min/max/mean, a
  non-finite count, and the first rows. When a graph is wrong, bisect it:
  inspect the first node, then the next, until the numbers stop being what
  you expect. That node is the bug.
- **render** draws a deterministic top-down SVG. `--attr <name>` colors by an
  attribute — a scalar ramp, a vec3+ as RGB, strings categorically — which is
  how you see whether a written attribute actually varies across space
  instead of trusting its mean. It reads **both** colorable domains and they
  color different marks, so there is no precedence question: a point column
  colors the circles, a primitive column colors the paths, and a per-edge
  value is therefore visible rather than unreachable. `--attr-domain
  point|primitive` narrows the lookup when one name lives on both — worth
  reaching for, since the ramp normalizes across every domain read. Every
  report says which domain the color came from.

Exit codes are scriptable: `0` did what was asked, `1` a named thing does not
exist or the run failed, `2` the command line itself was wrong.

## Failure modes

**Authoring a param that does not exist.** The error names it and lists the
alternatives — `unknown param "counts" for type "pointGrid"; valid params:
countX, countY, countZ, spacing, origin`. Read the message rather than
guessing again; the fix is in it. Prevent it with `pcg nodes <type>` before
you type the param.

**Hardcoding what should be exposed.** A magic number inside a subgraph is
invisible to every caller and forces a fork to change. If you would have to
edit the graph to change it, it should have been a param.

**Building from nodes what a primitive already does.** Ten hand-wired nodes
reproducing `fill/scatter-even` are ten nodes nobody tested, with defaults
nobody tuned. Scan `docs/primitives.md` before wiring — that is what step 1
is for.

**Filtering a path or a network, then wondering where it went.** Both are
topology (`polyline` primitives over the points), not an attribute. Every
filter node that can remove a point rebuilds the point domain from the
survivors and drops that topology with it, and so do `mergePoints` and
`partitionByAttribute`; the exemptions are `projectToPlane`, which clones
and removes nothing, and `filterPrimitivesByBounds`, which removes whole
primitives rather than points. Nothing warns where the loss happens. What you get instead is a path consumer several
nodes later reporting that it found no polylines — naming a node that is not
the one at fault. **Filter first, build the topology after.** The same
ordering applies to every path op and to the `curve` pin of the
path-consuming primitives; there is no in-place repair, so a path that must
lose points is rebuilt with `pointsToPath`. The contract, including why
closure is structural and how vertex order is decided, is in
`docs/authoring.md` ("Paths"); which pins require polyline topology is
stated per entry in `docs/nodes.md` and `docs/primitives.md`.

A **network** from `connectPoints` is the worse half of this, and it is
worth its own line because the failure is quieter and there is no rebuild.
`filterByBounds` placed after `connectPoints` reads like trimming the net to
a rectangle; it is demolition. The points come out fine, the attributes
survive, `pcg validate` says `ok`, the cook succeeds — and a road network is
now a point cloud, with nothing downstream necessarily complaining. Two
fixes, both in `docs/authoring.md` ("Networks: the primitive domain is the
edge domain"): clip *before* connecting when the clip is an authoring
choice, or — when it is a partition boundary — hand the clip to
`filterPrimitivesByBounds`, the one filter that trims topology instead of
dropping it, on the unwidened rectangle at `vertex: "first"`. That makes
the partitioned cook a serializable graph rather than host TypeScript:
`filterByBounds(widened, halfOpen)` → `connectPoints` →
`filterPrimitivesByBounds(unwidened, first, halfOpen)`. Only `first` and
`last` tile — they read one vertex, so exactly one cell owns each edge;
`all` and `any` are selections and will double-count or drop at the seams.
Params per entry in `docs/nodes.md`; the runnable JSON is in
`docs/authoring.md` ("Owning primitives instead of destroying them").

**Writing a per-instance colour and never naming it.** Colour reaches the
renderer only when `spawnInstances`' `colorAttr` names the attribute
carrying it. Write `color` (or a `tint`) upstream, leave `colorAttr` at its
default `""`, and the cook succeeds, `pcg validate` says `ok`, and every
instance draws in its asset's own colour — no warning, because there is
nothing to warn about: every point cloud in this library already carries
`color` at `[1,1,1,1]`, so presence cannot be read as intent the way a
primitive attribute's can. Naming the attribute *is* the intent. Nothing
scans the values, deliberately: an "is it all white?" test would cost O(n)
per cook and make the renderer's shader variant depend on the data. The
mistake in the other direction is loud — a `colorAttr` naming something
missing, or not f32 with `tupleSize >= 3`, errors and lists the point
attributes that would fit.

**Looking for the edge domain.** There isn't one, and none is needed: a
2-vertex polyline over shared points already *is* an edge, so an edge is a
`primitive`. Per-edge values are `promoteAttribute` point→primitive (`min`,
`first`), `setAttribute` on `domain: "primitive"`, and `promoteAttribute`
primitive→point (`max`) to bring a value back to the junction —
`connectPoints`' `degreeAttr` and `lengthAttr` cover degree and length
without any of that. The five moves and a runnable graph are in
`docs/authoring.md` ("Networks"); `examples/graphs/pipeline-5-roads.json`
runs them end to end.

**Expecting the value to die at the sampler.** It does not, and planning
around a loss that no longer happens costs a transfer node and a wrong
answer. Every sampler that reads a primitive carries that primitive's
attributes onto the points it emits — `splineSample`, `pathResample`,
`place/along-curve`, and `surfaceSample` for triangles — automatically,
with no param to enable. A lamp placed along a road arrives holding that
road's `roadWidth`. Do **not** reach for `transferAttribute` to recover
it, and in particular do not reach for `mapping: "nearest"`, which
refuses a primitive source outright (it searches source *points*), or for
`uv`/`raycast`, which read a primitive source but only off 3-vertex
`poly` triangles and so can never touch a polyline network at all. The
*point* attributes of the input are still lost, because the points are
new; `writeTangents` and `write/orient-along-path` are the ops that keep
them. Two consequences to plan for: there is deliberately no
`sourcePrimitive` index column to group by afterwards (primitive
numbering is per-partition, so shipping one would break determinism), and
every upstream primitive attribute is now part of a sampler's output
contract, so an unrelated `lengthAttr` widens the samples too — that is
accepted, not a bug.

**A carried primitive attribute colliding with one the sampler writes.**
The samplers carry no input *point* attributes, so the only name a
carried column can hit is one the node owns (`P`, `tangent`, `curveU`,
`seed`, …), and the node refuses rather than overwriting it — the error
names the node, the attribute, both shapes and the fix. There is no
opt-out to reach for: rename the attribute where it was written (the
`name` param of the `setAttribute` or `promoteAttribute` that produced
it), or `removeAttribute` it upstream on `domain: "primitive"` if it is
dead.

**Assuming a graph is correct because it cooked.** A cook that errors on
nothing is not evidence. A graph whose filter keeps zero points reports
`points 0` and exits `0`. Correct means: the counts are in the range you
expected, the attributes you meant to write are present with the right type
and tuple size, the bounds are where the geometry should be, `non-finite` is
0, and the picture looks like the thing. Check all five before you call it
done — `pcg inspect` for the first four, `pcg render` for the last.
