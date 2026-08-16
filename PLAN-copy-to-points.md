# `copyToPoints` — letting a copy know which target it landed on

`copyToPoints` composes a transform per copy and bulk-carries every
SOURCE point column into each target block (the `srcSet` loop under
"Bulk-carry every source attribute" in `src/nodes/pointOps.ts`). It
carries nothing from the target. So the copies are identical in every
respect but their placement: a scattered forest whose targets carry
`species`, `age` or a noise sampled at the target cannot vary per copy,
because the copy has no way to read the point it was placed on. The
information exists, on the target cloud, one index away — `i = t * nS + s`
already names the target of every output element — and is thrown away.

## First: does an existing node already compose to this?

Close, and not equivalent. `transferAttribute` with mapping `"nearest"`
(`transfer.ts:244`) run after the copy — output cloud as `in`, target
cloud as source — moves one named column by **3D distance to the nearest
target point**, ties to the lowest target index. That agrees with the
index correspondence only when every copy stays nearer its own target
than any other, which the node's own arithmetic is free to break: a
source point offset from the origin, a large `targetScale`, or targets
spaced closer than the source cloud's radius all silently reassign
copies, and the failure is a wrong value rather than an error. It also
costs one node per attribute and builds a spatial grid to rediscover a
correspondence the copy loop already had in a local variable.

`promoteAttribute` is not a candidate at all: it moves a column between
DOMAINS of one geometry, and this is one domain across two geometries.

So the honest answer is that the composition exists, is approximate, and
is not what the author means. The correspondence is exact and free
exactly here; everywhere else it has to be guessed at.

## The param is `targetNames`, a `stringList`

`removeAttribute.names` (`attributes.ts:773`) is the settled vocabulary
for "a list of attribute names": `type: "stringList"`, `default: []`,
described as "in any order", empty meaning do nothing rather than an
error. `setAttribute.name` is the singular twin. This follows both. The
one departure is the qualifier: this node has TWO geometry inputs, so a
bare `names` would not say which cloud the names live on. `targetNames`
matches the pin it reads (`target`).

Rejected: a `prefix` / rename param, and a `"src=dst"` micro-syntax
inside the list entries. Both invent a second naming vocabulary for a
problem the library already answers — `unionColumns` (`src/nodes/pointOps.ts`)
tells authors to "rename one side with setAttribute", so renaming is an
upstream node, not a param on every node that could collide. A rename
rule here would also have to be parsed, validated and error-messaged,
and it would make the param's value no longer a list of attribute names.

`acceptsField` is not available and would be meaningless: `params.ts:164`
refuses it for `stringList` because string lists are authoring data, not
per-element values.

## Collisions REFUSE, and the transform attributes always do

Three ways a name can be unusable and a fourth way it can be wrong —
four errors, each naming the node, the param and the fix, never a silent
winner.

**The composed transform attributes — `P`, `rot`, `scale`, `seed` — are
refused unconditionally**, whether or not the source carries them,
because `COPY_STANDARD` (`src/nodes/pointOps.ts`) guarantees the output has all
four and the copy loop writes every one of them from a composition that
ALREADY contains the target's contribution. Letting a carry overwrite `P`
would put every copy of a target's block at that target's position, which
is not a subtle corruption but it is a silent one: the cook is clean and
the render is a pile. There is no reading under which "carry the target's
`P`" and "compose the target's `P`" are both wanted, so this is a refusal
and not a precedence rule. The error says how to get the raw value
anyway: copy it to a different name on the target upstream
(`setAttribute`) and carry that.

**A name already on the SOURCE is refused too**, naming both sides. The
source carry and the target carry would write the same column, and the
one that ran second would win by nothing more than statement order. The
error offers the two existing remedies by name: rename one side with
`setAttribute`, or drop it upstream with `removeAttribute` (domain
`"point"`). Refusing is also the reversible choice — deciding later that
one side wins is a behaviour change, while un-refusing is not.

**A name repeated within the list is refused**, because the second `add`
would otherwise throw `attribute "x" already exists` from the attribute
layer, an error naming neither this node nor the param the author typed
it into.

## Type, tupleSize and default come from the target column

`promote` and `transferNearest` both derive the destination column from
the source column and nothing else — `promote.ts` as

    dstSet.replace(attrName, src.type, src.tupleSize, src.defaultValue)

and `transfer.ts` as the same call on `dstPoints` with `srcAttr`.

This does the same with `add` rather than `replace`, because collisions
are already refused above and there is by construction nothing to
replace; `add`'s own "already exists" throw stays as an unreachable
backstop. No coercion, no widening, no tupleSize rule of its own — a
`u32` tuple-1 `species` index arrives as a `u32` tuple-1 column, an `f32`
tuple-3 `Cd` as an `f32` tuple-3 column.

## A missing attribute THROWS

`promoteAttribute` and `transferAttribute` both throw unconditionally
when the named attribute is absent (`promote.ts:78`, `transfer.ts:255`).
`removeAttribute` throws by default and offers `strict: false`, which it
earns because deleting an optional column is a legitimate best-effort
cleanup. Carrying has no such reading: skipping would leave the copies
without a column the author asked for by name, and the failure would
surface somewhere downstream as a missing attribute nobody asked about.
So: throw, naming the node, the param, the attribute and the target's
available point attributes — `removeAttribute`'s message shape — and no
`strict` escape hatch.

## Strings re-intern, and nothing may depend on the index

A string column's `data` holds indices into ITS OWN `stringTable`.
`copyFrom` re-interns by value into the destination's table
(`attribute.ts:209-215`), and `lookupString`'s comment
(`attribute.ts:138-149`) states outright that a table index is not stable
across geometries. The carry cannot use `copyFrom` — it broadcasts ONE
target element across `nS` copies rather than copying a range — so it
does the same thing explicitly: `internString` the target's value into
the output column once per target element, then write that index into the
block. Per target, not per copy: `nT` interns, not `nS * nT`.

The output table is therefore built in target order from target values,
which is deterministic given the target cloud. `spawnInstances`'
`assetAttr` reads such a column by value, so a target-side `species`
string reaches the spawner intact — the motivating case.

## Determinism

Nothing here touches the seed chain. `oSeed[i] = hashCombine(sourceSeed,
targetSeed)` is unchanged and still runs in the same loop over the same
values; carried columns are pure data movement with no hashing and no
RNG. Point identity is position bits plus the `seed` attribute
(`identity.ts`), and the carry changes neither, so every identity-keyed
decision downstream (jitter, probabilistic filters, `randomField`) sees
exactly what it saw before. Column insertion order is fixed — source
columns, then the standards, then `targetNames` in the order given — so
the output's attribute set is a function of the inputs and the param.

With the default empty list, not one byte of the existing path changes:
no column is added, no loop runs. `tests/graphs.golden.json` must not
move for any graph that does not use the param, which is every graph in
the corpus except the one added below.

## Hot path

The broadcast reads the target element ONCE per target and writes it
`nS` times through a strided loop over the raw typed array, with a single
scratch array reused across the whole node — no per-copy `copyFrom` (it
allocates a `subarray` view per call), no per-point objects.

## The sites to touch

- `src/nodes/pointOps.ts` — `CopyToPointsParams` stops being
  `Record<string, never>`; param schema, description, carry loop, errors.
- `src/nodes/pointOps.test.ts` — behaviour, each refusal, strings,
  determinism, and the empty-list no-op.
- `docs/nodes.md` / `docs/nodes.json` — generated; `npm run docs`.
- `llms.txt`, `docs/authoring.md`, `skills/graph-authoring/SKILL.md` —
  hand-written agent surface, if the rule changes what they claim.
- `graphs/basics-copy-to-points.json` — the corpus has NO basics graph
  for this node at all (only `pipeline-3/4/5` and `examples-rig` use it),
  so the graph that teaches the carry is also the graph that teaches the
  node. Adding one moves the corpus count, which `src/docs/site.test.ts`
  enforces against hand-written claims in `docs/index.html` and
  `docs/manual.html`, plus `docs/graphs.{md,json}`,
  `tests/graphs.golden.json` (additions only) and the committed
  `docs/pages/` build.

## What must be tested

1. A carried `u32` column lands the target's value on all `nS` copies of
   that target's block, and a second target's block gets its own value.
2. `f32` tuple-3 carries componentwise; type/tupleSize/default match the
   target column exactly.
3. A string column carries by VALUE across the geometry boundary (assert
   the string, not the index) and interns into the output's own table.
4. Each refusal, by message: `P` / `rot` / `scale` / `seed`, a
   source-side collision, a duplicate in the list, a missing name.
5. Empty list is byte-identical to the pre-param output, including the
   attribute name order.
6. Seeds are still `hashCombine(sourceSeed, targetSeed)` with a carry
   present, and two cooks agree byte for byte.
