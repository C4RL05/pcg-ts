# `attributeIs` — letting a string attribute drive a field

`attributeIs("species", "pine")` resolves to 1 on elements whose `species`
is `"pine"` and 0 everywhere else. It is the answer to PLAN.md's "strings
readable as fields", and it is a PREDICATE rather than an accessor for a
reason that is the whole design.

## Why not expose the index

A string attribute is a `Uint32Array` column plus an interned
`stringTable` (`src/data/attribute.ts:47-53`). The obvious field fn —
"give me the table index" — is a determinism bug wearing a new costume,
and the costume is convincing enough to be worth naming.

The table is insertion-ordered, and it is REBUILT on the ordinary
operations:

- `setAttribute` in string mode interns its whole declared `values` list
  up front (`src/nodes/attributes.ts:159`), so a freshly-set attribute
  holds every declared value at a stable declared-order index — including
  values no element uses.
- `Attribute.copyFrom` re-interns per element (`attribute.ts:192-199`),
  so clone, filter and merge compact the table to first-encounter order
  over the SURVIVING elements and drop the rest. `cloneGeometry`,
  `copyElements` and `mergePoints` all go through it.

So the same logical value interns at different indices depending on what
happened upstream — and under partitioned cooking, in different cells.
An index-returning fn would pass every test we have until two cells
disagreed, which is precisely the phase-42 lesson. The predicate never
exposes the index, so there is nothing to disagree about.

## Semantics, including the uncomfortable one

- Returns `Field<1>`: exactly 0 or 1, on any domain.
- **A literal absent from the geometry's table yields all zeros. It is not
  an error, and this is forced rather than chosen.** Each cell cooks its
  own geometry (`src/runtime/world.ts:787-819`), so a cell holding no
  pines legitimately has no `"pine"` in its table; throwing there would
  make the result depend on how the world was partitioned. Filtering out
  the last pine does the same thing within one cook. The cost is that a
  MISSPELLED literal reads as "nothing matches" rather than as an error,
  and that is the trade: partition-independence is a hard invariant, typo
  detection is a convenience.
- **Structural mistakes still throw**, and the line sits exactly there: a
  missing attribute throws (`require`), and a NUMERIC attribute throws
  with a message naming `eq(attribute(name), value)` as the thing the
  author wanted. Absence of a value is data; absence of an attribute is a
  bug.
- Never mutates. `internString` INSERTS on miss (`attribute.ts:127-136`),
  so calling it from a field would edit the geometry mid-evaluation and
  desynchronize CPU from GPU. Needs a new non-mutating
  `Attribute.lookupString(value): number | undefined` — every existing
  caller of `internString` wants the inserting behaviour, which is why no
  read-only lookup exists yet.

## The GPU half, which PLAN.md underestimated

PLAN.md says this "compiles to the GPU cleanly". The kernel does; getting
the literal INTO the kernel does not, and the reason is worth recording.

**A baked WGSL literal would be unsound.** The kernel cache key is spec
text plus each attribute's name/type/tupleSize (`evaluator.ts:346-368`) —
**table contents are not in it**. Two geometries whose tables differ would
share a cached kernel carrying the wrong constant. The resolved index is a
property of the geometry, not of the spec, so it must not be compiled in.

**So it rides a uniform**, and the kernel stays table-agnostic: compare
the column against a value supplied per dispatch. Cache key needs no
change, and two cells with different tables get different uniforms and the
same answer — which is the entire point.

**But `ParamPlan` is spec-only today.** `computeParamPlan`
(`compile.ts:933`) walks the spec and admits only `fn === "param"` nodes;
`paramConstValues` (`compile.ts:1090`) takes spec + kernel and explicitly
never reads geometry. There is no precedent for a compiler-invented slot.
This change makes the plan spec + geometry, which is the real work:

1. Reserve a slot per DISTINCT `(name, literal)` pair, ordered
   deterministically (sorted), so the arity signature stays honest.
2. `paramSig` counts them.
3. A geometry-aware filler at dispatch. `evaluator.ts:507-509` already has
   `ctx.geo.attrs[ctx.domain]` in hand at uniform-fill time, so the value
   is reachable there — it is `paramConstValues`, computed earlier at
   `evaluator.ts:388`, that cannot see it.
4. Absent literal fills the slot with `-1`, which no index equals. The
   lane is f32; table indices are small integers and `-1` is exact, so no
   rounding question arises.
5. `bufferType` (`compile.ts:1161`) binds a string column as `u32` — one
   line. `resolveLayoutAttr`'s string refusal (`compile.ts:222-227`) must
   still reject `attribute("species")` while permitting a column reached
   through `attributeIs`.
6. WGSL shape: `select(0f, 1f, f32(in{i}[idx]) == params.consts[s].{lane})`.

**The fused/resident path cannot do this and must decline.** `run.ts:680`
calls `paramConstValues` at PLAN time and bakes the result into the step
(`run.ts:692`); plan time has no geometry (`ResidentRunContext`,
`gpuResolver.ts:235-250`, carries attribute descriptors and a count, not
data). Moving consts from plan time to execute time is a separate change.
Until then a run containing `attributeIs` declines with a machine-readable
reason, per the pillar in CLAUDE.md — `"run-plan-failed"` is the existing
vocabulary (`gpuResolver.ts:12-84`).

CPU/GPU agreement is exact here, not within a tolerance: both sides do an
integer comparison and emit 0 or 1.

## The sites to touch

PLAN.md calls this "the fixed five-site grammar change". It is six, each
pinned by a test that fails if it is skipped:

1. Constructor — `src/fields/inputs.ts` (`src/fields/index.ts` is
   `export *`, so no export edit).
2. Grammar registration with its `variation` — `src/fields/fieldJson.ts`.
   `"per-element"`: it reads a column.
3. Spec emission — an explicit `attachSpec`, as `attribute` does; it is a
   leaf, so it gets nothing for free from `attachArgsSpec`.
4. WGSL lowering — `src/gpu/compile.ts`. MANDATORY:
   `compile.test.ts:234` asserts `supportedGpuFieldFns()` equals
   `listFieldFns()`, so a CPU-only fn fails the build.
5. Parity minimal spec — `src/gpu/parity.testsupport.ts`, pinned by
   `parity.test.ts` and `compile.test.ts`.
6. Docs — four `listFieldFns().length` claims and the verbatim closed-set
   block in `src/docs/site.ts`, plus `docs/authoring.md` and `llms.txt`.

## What implementation corrected

**The WGSL indexing sketch above is stride-free and was wrong.** The CPU
reads component 0 of a possibly-tuple attribute, so the kernel must too:
`f32(in0[i * Nu])`, not `in0[i]`. Left uncaught, a tuple-valued string
attribute would have made CPU and GPU disagree — a parity defect in the
one place this feature promises exactness. There is now a device test
whose only job is that stride ("a value that only sits at component 1
matches nothing").

**"`evaluator.ts:388` cannot see geometry" is true of the function and
false of the call site.** `paramConstValues` is spec-only and stays that
way — it now DECLINES a kernel carrying attribute slots, which is exactly
what makes the plan-time caller in `run.ts` decline. The geometry-aware
counterpart is called from `resolveField`, where the attribute set is
already in scope, so nothing had to be threaded through `dispatch`.

**Slot numbering matters more than it looks.** The attribute slots are
numbered AFTER the param slots, so every kernel that existed before this
change keeps its numbering, its key and its cached pipeline. A test
asserts no non-`attributeIs` kernel's key, inputs or WGSL moved a byte.

Two bounds now recorded in comments: the f32 uniform compare is exact
only below 2^24 table entries (the same bound `index` already carries),
and the `run.ts` decline is deliberately redundant with two downstream
guards.

## What must be tested

- The predicate itself, on every domain, including tuple and empty cases.
- **Partition-independence, which is the reason this design exists**: the
  same points split into cells whose tables differ in membership AND in
  index order must produce identical results. Build the disagreement
  deliberately — do not hope for it.
- An absent literal yields zeros and does NOT throw; the table is
  unchanged afterwards (guards against `internString` creeping in).
- A numeric attribute throws and the message names `eq`.
- Post-filter behaviour: filter away every pine, confirm the table no
  longer holds `"pine"`, confirm the predicate is all zeros rather than an
  error.
- CPU/GPU parity is EXACT, and a fused run containing `attributeIs`
  declines with the recorded reason rather than producing something else.
