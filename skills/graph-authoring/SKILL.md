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
- Exposed params cannot reach inside a field spec. A noise `seed`,
  `frequency` or `offset` lives in the spec, where no param slot exists.

The consequence is the pattern the shipped vocabulary uses: keep the noise on
an inner node and expose the *scalars it reads* — typically a frequency
multiplier and a `variant` added to the sample position. See the
`determinism` skill for why `variant` is the re-roll and a seed is not.

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
  instead of trusting its mean.

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

**Assuming a graph is correct because it cooked.** A cook that errors on
nothing is not evidence. A graph whose filter keeps zero points reports
`points 0` and exits `0`. Correct means: the counts are in the range you
expected, the attributes you meant to write are present with the right type
and tuple size, the bounds are where the geometry should be, `non-finite` is
0, and the picture looks like the thing. Check all five before you call it
done — `pcg inspect` for the first four, `pcg render` for the last.
