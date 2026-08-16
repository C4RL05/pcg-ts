# `byAttribute` — one case set instead of nested `lerp`s

`byAttribute("part", {rod: …, bar: …, panel: …}, default)` resolves to the
case whose key equals the element's `part`, and to `default` where none
does. It is the N-way form of `attributeIs`, and it exists because the
2-way form composes badly: `graphs/examples-rig.json` sizes its parts by
kind through three nested `lerp`s over three `attributeIs` calls, one per
AXIS, so a fifth kind means editing three separate expressions.

## The bug that motivated it, stated precisely

The rig has FOUR part kinds. Decoding what its three axes actually
compute, with `S = lerp(0.55, 1.6, randomField("stretch"))`:

| kind | X | Y | Z |
|---|---|---|---|
| `panel` | `S` | `0.7` | `S` |
| `rod` | `1` | `S` | `1` |
| `bar` | `1` | `1` | `S` |
| `clamp` | `1` | `1` | `1` |

`clamp` is named nowhere in that expression. It is not a decision; it is
what is left over when three predicates all read 0. Nobody noticed until
instance transforms were diffed across a change meant to resize it — the
change did nothing, because the thing it edited never applied to `clamp`.
That is the failure this fn is shaped against: **the fall-through has no
name, so it cannot be reviewed, searched for, or edited.**

## 1. What a case VALUE may be — a full field spec

**Decision: a case value is a `FieldSpecArg` — a nested spec, a number, or
a number array — exactly what an `args` entry may be.** Numbers and tuples
wrap into `constant`, so scalars and tuples are subsumed rather than
special-cased.

Confirmed against the rig rather than assumed. Its case values are not
constants: `panel` is `vec(S, 0.7, S)` where `S` is
`lerp(0.55, 1.6, randomField("stretch"))` — a per-element random draw
inside a `vec` inside a case. A scalar-only or tuple-only `cases` map
could not express the rig's actual requirement, which is the requirement
that produced this fn. So the value position is the general one.

The corollary is that `cases` is a new SPEC-VALUED POSITION in the
grammar, the first since a noise's `opts.position`. Five walkers hard-code
the set of spec-valued positions (`args` entries and `opts.position`) and
every one of them must learn `cases` and `default`:

- `walkSpecNodes` — `src/fields/fieldJson.ts` (backs `paramNamesOf`,
  `unboundParamNamesOf`, `inlineParamValuesOf`)
- `eachSpecNode` — `src/gpu/compile.ts` (backs `computeParamPlan`)
- `collectAttrNames` — `src/gpu/compile.ts`
- `specKeysOnIdentity` — `src/gpu/run.ts`
- `paramBindings` and `rewrite` — `src/fields/fold.ts`

Four of the six are pure visits and get one shared `specChildren` helper,
placed in `src/fields/spec.ts` because that module already sits below both
the constructors and the grammar and imports nothing but `./types.js`.
`rewrite` rebuilds rather than visits, and `collectAttrNames` has per-fn
early returns, so both learn the position explicitly.

`src/fields/fold.ts:385-394` already anticipated this exact day in a
comment — it cross-checks its own walk against `paramNamesOf`'s and
DECLINES the fold when the two disagree, precisely so that "a fn puts a
spec somewhere else" costs a missed optimization rather than an
unbound-param throw. That guard stays, and it is a test target: a
`byAttribute` with a `param` inside a case value must cook, not decline.

### Why an object and not a parallel `keys` + `args`

`{"keys": [...], "args": [...]}` would ride every existing walker for
free. It is rejected because the keys and the values would be coupled by
POSITION: inserting a case means editing two arrays in step, and getting
it wrong is silent — which is the same class of defect as the
fall-through this fn was written to remove. The cost of the object form is
six walker edits, paid once.

### The one thing the object form gives up

`JSON.parse('{"a":1,"a":2}')` is `{a: 2}`. A duplicated case key is
already gone by the time the grammar sees the spec, so **duplicate-key
detection is not implementable at this layer** and is not claimed. This
corrects the brief, which listed it as a parse-time check. The check would
require reading raw JSON text, which the field grammar never sees — it
receives parsed objects, both from `deserializeGraph` and from callers.

## 2. Tuple-size agreement — the library's broadcast rule, checked twice

**Decision: the existing elementwise broadcast rule, not exact equality.
Scalars broadcast against any tuple size; two non-scalar sizes must match
exactly.** Checked STATICALLY at construction where every branch's size is
known, and again at evaluation over the produced columns.

Not a new rule, and deliberately not: `broadcastTupleSize` in
`src/fields/combinators.ts` is what all ~25 elementwise combinators use,
and the nested `lerp`s being replaced already broadcast — `lerp(1, S3, t)`
is a scalar against a vec3 today. A `byAttribute` stricter than the idiom
it replaces would block the rewrite that motivated it. The function moves
to `src/fields/types.ts` (which both `combinators.ts` and `inputs.ts`
already import) so there is one implementation and no import cycle;
nothing about its behavior changes.

The output tuple size is the broadcast of ALL branches including the
default, so it is a property of the EXPRESSION and never of the data —
which case fired cannot change the column's width.

Two checks rather than one because a branch's size is not always static:
`attribute(name)` without an explicit `tupleSize` has
`Field.tupleSize === undefined` until a geometry is in hand. This is the
same two-stage arrangement `elementwise` already uses (static check at
line 47, evaluation check at line 51).

The error names the fn, the attribute, the offending case key and both
sizes:

```
byAttribute "part": case "panel" has tuple size 3, but case "rod" (and the
default) has tuple size 2; every case and the default must agree, except
that a scalar broadcasts against any size
```

It is a plain `Error` thrown from the constructor, not a `FieldJsonError`
with a path, matching the precedent: `fieldFromJson({fn:"add",args:[[1,2],[1,2,3]]})`
already throws a plain construction-time `Error` through `broadcastTupleSize`.

## 3. The `default` — REQUIRED

**Decision: required. A spec with no `default` is a parse error.**

Its entire purpose is to give the fall-through a name. An optional default
would reintroduce, one level down, the exact defect that produced this fn:
`clamp` fell through and got a value nobody wrote. Making it optional
would mean choosing an implicit value (zeros? the first case?) and every
choice is a value nobody wrote.

The error says so rather than just reporting the missing key:

```
byAttribute requires a "default": an element whose "part" matches no case
has to resolve to something, and naming it here is the point of this fn —
write default: 0, or a spec, or add a case for every value you expect
```

## 4. Evaluation strategy — evaluate every branch, then select

**Decision: evaluate all K+1 branches into columns, build a table-index →
branch lookup, and select per element. No per-element branching.**

The cost is K+1 column evaluations per cook instead of 1. That is not a
regression: `lerp` is strict, so the three nested `lerp`s already evaluate
every branch on every element, and the rig's expression evaluates its
stretch draw and its base scale for all four kinds today. It is the same
work with a name on it.

Two things bound the cost more tightly than "K+1" suggests:

- `evaluateField` memoizes per `EvalContext` keyed on `Field.key`, so
  subexpressions SHARED between branches are computed once. The rig's `S`
  appears in three of four cases and is evaluated once for all three.
- The selection loop is a flat pass over typed arrays with an
  `Int32Array` lookup indexed by table index — no `Map` probe and no
  per-element object, per the SoA rule in CLAUDE.md.

A per-element branch is rejected on three counts. It is unrepresentable in
the column-at-a-time evaluator without abandoning vectorized evaluation;
it buys nothing on the GPU, where a warp evaluates every lane's branch
regardless; and it would make CPU and GPU do structurally different work
in the one place this feature promises exactness. The naive form is the
form that keeps the two sides identical.

Practical ceiling: `MAX_FIELD_CONST_SLOTS` is 16 uniform slots shared
between author `param`s and string literals, and every case key takes one.
A `byAttribute` with more than ~15 cases will not compile to a kernel and
falls back to the CPU with a machine-readable reason, which is the
documented behavior for everything else that exceeds a device limit.

## The trap: NO validation of case keys against the string table

**Case keys are NOT checked against the geometry's string table, at cook
time or any other time.** This is the same constraint `attributeIs`
navigated, and the argument is unchanged (see `PLAN-attribute-is.md`).
Each cell of a partitioned world cooks its own geometry with its own
`stringTable`, rebuilt by `setAttribute`, clone, filter and merge. A cell
that legitimately holds no `clamp` has no `"clamp"` in its table.
Throwing there would make the output depend on how the world was
partitioned, which is a hard invariant, not a preference.

So: **a case key absent from the table selects nothing and its elements
take the `default`.** A MISSPELLED key silently becomes dead code.

### What this feature therefore does and does not buy

It does **not** make a typo impossible. `{"pnael": …}` compiles, cooks,
and quietly routes every panel to the default. Nothing at this layer can
detect that without breaking partition-independence.

What it buys is narrower and worth stating without inflation:

1. **The fall-through is explicit.** `default` is a named position an
   author writes on purpose. `clamp` landing on the base scale becomes a
   sentence in the graph rather than the absence of one.
2. **The case set is enumerable in one place.** Four kinds are four keys
   in one object, not four predicates spread across three axis
   expressions. A fifth kind is one line. A reader can list what the
   expression handles by reading it.
3. **Adding a kind cannot silently miss an axis**, because there are no
   longer per-axis copies to keep in step.

That is the whole claim. The docs say exactly this and do not imply
validation the design cannot safely perform.

### What IS checked, at parse time

- `name` is a non-empty string (a string attribute name).
- `cases` is an object with at least one key. An empty case set is a
  `byAttribute` that is only its default, which is a `default` written the
  long way and almost certainly a mistake.
- `default` is present.
- Every case value is a well-formed spec, number, or number array.
- Tuple sizes broadcast (§2), at construction where statically known.
- Structural mistakes at evaluation, matching `attributeIs`: a MISSING
  attribute throws, and a NUMERIC one throws naming `eq(attribute(name), …)`.
  Absence of a VALUE is data; absence of an ATTRIBUTE is a bug.

Duplicate keys are not checked, because they cannot be — see §1.

## Order-independence, which is a testable property

At most one case can fire: distinct keys intern at distinct table
indices, and the column holds one index per element. So the ANSWER does
not depend on the order the cases are written in, and permuting `cases`
must produce a byte-identical column. `Field.key` sorts the keys so two
permutations are also the same field for memoization; the emitted WGSL
sorts them too, so the kernel TEXT is order-independent as well. Only the
kernel cache KEY differs between permutations (it carries the spec text
verbatim, so that authored specs round-trip unchanged), which costs a
duplicate cache entry and nothing else.

## The GPU half: the same uniform mechanism, N times

`attributeIs` established that a resolved table index must not be compiled
into WGSL — the kernel cache key is spec text plus attribute
name/type/tupleSize and holds NO table contents, so a baked literal would
be shared by two geometries whose tables disagree and be wrong for one of
them. The index rides a per-dispatch uniform instead.

`byAttribute` extends that mechanism rather than inventing a second one.
**One `AttrIsSlot` per case key**, which means:

- `computeParamPlan` collects `byAttribute`'s keys into the same
  `attrIs` map, under the same `attrIsKey(name, value)`. A `byAttribute`
  case and an `attributeIs` on the same (attribute, literal) pair
  therefore SHARE one slot.
- `paramSig`, `ParamPlan`, `CompiledFieldKernel.attrIsSlots`,
  `constSlots`, `paramConstValues`' decline, the geometry-aware
  `constSlotValues` filler, the `-1`-on-absence rule, the
  `runnerClient` refusal and the `run.ts` plan-time decline are all
  **unchanged**. Slots stay numbered after the param slots, so no existing
  kernel's key, inputs or WGSL move a byte.

WGSL shape — a chain of `select`s over the same compare `attributeIs`
emits, innermost value being the default:

```wgsl
let vD = <default>;
let v = select(select(vD, <caseA>, f32(in0[i * Nu]) == params.consts[sA].x),
               <caseB>, f32(in0[i * Nu]) == params.consts[sB].x);
```

`select(f, t, cond)` is defined for vectors as well as scalars, so a vec3
case set needs nothing extra; scalar branches are splatted with the
existing `splat` helper. The compare expression is identical across cases
and `ctx.emit` value-numbers by expression text, so the column is loaded
and converted ONCE regardless of case count.

Component 0 of a tuple-valued string attribute, via `flatIndex(ts, 0)` —
the same stride `attributeIs` got wrong in its first sketch and now has a
device test for. CPU and GPU agree EXACTLY here, with no tolerance to
spend: both sides do an integer comparison and then select between values
computed by paths that are already bit-exact or already budgeted.

The FUSED / device-resident path declines, unchanged and for the unchanged
reason: `run.ts` bakes its constants at plan time, where no geometry
exists. The existing `kernel.attrIsSlots.length > 0` guard already covers
`byAttribute` — its message widens to name both fns. The externally
counted reason stays `"run-plan-failed"`.

## The sites to touch

The six from `attributeIs`, plus the walkers §1 named:

1. Constructor — `src/fields/inputs.ts`, beside `attributeIs`.
   `broadcastTupleSize` moves to `src/fields/types.ts`.
2. Grammar registration — `src/fields/fieldJson.ts`, keys
   `["name", "cases", "default"]`, variation **`"per-element"`**: it reads
   a column, so which case fires differs between two elements of the same
   domain even when every case value is uniform.
3. Spec emission — an explicit `attachSpec`, with depth
   `1 + max(specDepth of every case value and the default)` and
   all-or-nothing withholding if any branch has no spec.
4. WGSL lowering — `src/gpu/compile.ts`. MANDATORY: `compile.test.ts`
   asserts `supportedGpuFieldFns()` equals `listFieldFns()`.
5. Parity minimal spec — `src/gpu/parity.testsupport.ts` (and the second
   `MINIMAL_SPECS` corpus inside `compile.test.ts`).
6. Docs — the `listFieldFns().length` claims and the verbatim closed-set
   block `src/docs/site.ts` extracts, plus `docs/authoring.md`,
   `llms.txt`, `README.md`.
7. The six spec walkers listed in §1.

## What must be tested

- The selection itself, on every domain, with scalar, tuple and
  spec-valued cases and a scalar default broadcast against tuple cases.
- **A key absent from the table takes the default and does NOT throw**,
  and the table is unchanged afterwards (guards against `internString`).
- **Partition-independence**: the same points split into cells whose
  tables differ in MEMBERSHIP and in INDEX ORDER produce identical
  results. Build the disagreement deliberately.
- **Order-independence**: permuting `cases` is byte-identical and gives an
  equal `Field.key`.
- A missing attribute throws; a numeric one throws naming `eq`.
- Parse refusals: empty name, empty case set, missing `default`,
  tuple-size disagreement.
- A `param` inside a case value survives the fold (the `fold.ts` walk
  cross-check) and reaches the GPU param plan (`eachSpecNode`).
- CPU/GPU parity is EXACT on a real adapter, one kernel serving two
  geometries whose tables disagree; and a fused run containing
  `byAttribute` declines with the recorded reason.
- **The rewrite is a no-op until it is not**: rewriting the rig with
  `clamp` at `(1,1,1)` must be cook-hash IDENTICAL to the nested `lerp`s,
  which proves the rewrite is faithful; then giving `clamp` its real
  proportion changes the hash, which proves the test can tell.
