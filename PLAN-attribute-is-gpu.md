# `attributeIs` in a fused run — what it would take, and what it is worth

Gap 9 of the rig's list: "`attributeIs` disqualifies a fused GPU run
(`run-plan-failed`), so adding string variation silently makes a node
CPU-only. Wants the interned index lowered to a u32 device column."

The mechanism is real, the fix is small and fully worked below, and the
measurement says **do not schedule it yet**. What it buys the corpus
today is one extra fused member over 666 points in one graph. The entry
is kept whole because the expensive part is the analysis, not the diff.

## Two things the gap entry gets wrong, and they change the size of it

**Nothing becomes CPU-only.** A `setAttribute` whose value carries
`attributeIs` or `byAttribute` still resolves its field ON THE DEVICE,
through the per-field path: `resolveField` compiles the kernel, fills the
uniform from the geometry it is handed (`evaluator.ts:395`), dispatches,
and reads one column back. What the node loses is MEMBERSHIP IN A RUN —
one readback and one geometry materialization, not the device. The
per-field lowering shipped complete; see `PLAN-attribute-is.md`.

**There is no column to lower.** A string column already binds as u32 —
`bufferType` (`compile.ts:1502`) returns `u32` for `string` because that
is what the column IS, a `Uint32Array` of table indices. The index of the
LITERAL is not a column at all; it is one scalar per `(attribute,
literal)` pair, and it already rides a uniform slot
(`compile.ts:408`, `compile.ts:437`). So the wish "lower the interned
index to a u32 device column" describes work that is done, and misses the
two things that are actually missing:

1. **`slotFor` refuses a string column outright** (`run.ts:583`:
   `attr === undefined || attr.type === "string"` → `PlanFail`). A
   resident run cannot upload the column the kernel would read.
2. **The plan bakes its uniform payload at plan time**, where no geometry
   exists (`run.ts:691-695`). This is the one the existing comments name.

Both are in `run.ts`. Neither is in the kernel.

## What actually has to reach the device

Confirmed from the code, unchanged from the original analysis:

- **The column**: `count * tupleSize` u32, exactly as it sits in
  `Attribute.data`. `executeResidentRun`'s uploader already handles it —
  `device.queue.writeBuffer(buf, 0, attr.data.subarray(0, n))`
  (`run.ts:1102`) is type-agnostic, and `bytes = count * tupleSize * 4`
  (`run.ts:585`) is right for a `Uint32Array`. Only `slotFor`'s refusal
  stands between the plan and a correct upload.
- **One f32 lane per distinct `(attribute, literal)` pair**, holding that
  literal's index in THIS geometry's table, or `-1`
  (`ABSENT_STRING_INDEX`, `compile.ts:1393`). `constSlotValues`
  (`compile.ts:1426`) already computes exactly this given a
  `StringTableSource`, which `AttributeSet` satisfies as it stands.
- **The table itself never crosses.** Nothing on the device compares
  strings; both sides compare an integer. That is why parity here is
  exact rather than a tolerance class.

## How it rides: execute time, not plan time

`ResidentRunContext` (`gpuResolver.ts:242-257`) carries attribute
descriptors and a count, deliberately — planning is documented as
synchronous and device-free. **But `executeResidentRun` HAS the
geometry** (`run.ts:1042`, and it already reads columns off
`geo.attrs.point` at `run.ts:1091`), and it already rebuilds the uniform
per step per dispatch (`run.ts:1229-1237`). So the fused path CAN carry a
geometry-resolved value. The decline is not a limit of the plan; it is a
consequence of WHEN the consts are computed, which is what the comment at
`run.ts:682` says.

The shape:

1. `KernelStep` (`run.ts:225-251`) gains
   `readonly attrIs: readonly AttrIsSlot[]` — the pairs, in slot order,
   copied straight from `kernel.attrIsSlots`. Never an index.
2. `compileParam` (`run.ts:628`) drops the `attrIsSlots.length > 0`
   refusal and fills only the PARAM half of the payload. `compile.ts`
   exports the param-only filler it already has internally
   (`paramSlotValues`, `compile.ts:1351`); `paramConstValues` keeps its
   refusal verbatim for every other spec-only caller.
3. The attribute-slot numbering is what makes step 2 legal: attr slots
   are allocated AFTER the param slots (`compile.ts:1216`), so the
   plan-time payload is a strict PREFIX of the full one and the executor
   appends rather than patches.
4. At execute time, once per step before the range loop, resolve the
   pairs against `geo.attrs.point` and append
   `APPLY_CONST_COMPONENTS` f32 per pair (index in lane 0, zeros after).
   `uniformBytes` already covers every slot — it comes from
   `kernel.uniformBytes` — so no size changes.
5. `slotFor` admits `type === "string"` for READS.
6. `PLAN_FORMAT` (`run.ts:336`) bumps to `pcg-resident-run/6`.

**A geometry the run does not model cannot appear mid-chain, and that is
what makes one resolution serve every member.** No resident kind writes a
string attribute: `setAttribute`'s `eligible` excludes `type === "string"`
(`attributes.ts:117`) and no other kind writes by name. So the string
column a member reads is always the run INPUT's, in the run input's table,
whatever epoch the member sits in. A later member REPLACING the name with
a numeric column is handled already — the layout entry changes and
`resolveStringAttr` rejects the compile, failing the plan.

**The failure mode at execute time is a throw, not a fallback.** If the
resolution finds no string column of that name, the plan and the geometry
disagree, which is a caller contract violation exactly like the existing
count check (`run.ts:1051-1056`, "plans are single-cook artifacts").
Post-plan failures are errors by the resolver contract; message it the way
the count mismatch is messaged.

## Cache-key soundness

Stated precisely, because this is the half the original entry got wrong
and the half a reviewer must be able to check.

**Must enter the kernel key** (and does today): the `(attribute,
literal)` PAIRS, via `paramSig` → `|attrIs=[...]` (`compile.ts:1237`).
They decide the emitted text — the slot numbering, the struct's array
length, the uniform size — so a key that omitted them would name a kernel
that is not the one compiled.

**Must NOT enter any key**: the resolved index. It is a property of one
geometry. If it entered the kernel key, every cell of a partitioned world
would compile its own pipeline for one identical kernel; if it entered
the WGSL, two geometries sharing that key would be served each other's
constant. The per-field cache key is the spec key plus `name:typexTS` per
attribute (`evaluator.ts:344-368`) — **verified: still no table
contents** — and the run's pipeline cache is keyed on `step.key`, which is
`kernel.key`. Both stay correct because the index is written per dispatch
and named by nothing.

**And it must not enter the PLAN.** This is the sharp one, and it is why
the recommendation is execute-time and not "hand the planner a table
source". `executeResidentRun` validates that the geometry matches the
plan's COUNT and nothing else. Two cells of one world routinely have the
same point count and different tables — same membership in a different
order is enough. A baked index would therefore be guarded by a check that
cannot see the thing it would need to check, and would fail SILENTLY
(wrong parts scaled), which is the exact failure this feature was designed
against. Keeping the plan geometry-free also leaves plan REUSE across
same-shape inputs available as a future move, which baking forecloses.

## "No such index"

Unchanged, and free: the fused path calls the same `constSlotValues`, so
an absent literal fills the slot with `-1`, no table index equals it, the
`select` is false on every lane, and the column is the zeros the CPU
produces. The partition-safety argument in `PLAN-attribute-is.md` §
"Semantics" carries over without a new sentence: a cell holding no pines
legitimately has no `"pine"`, on either path, on either side of the
device seam. `lookupString` and never `internString` — a run must not edit
the geometry it uploads.

## The measurement, which is why this is not scheduled

Corpus-wide, `attributeIs` / `byAttribute` appear in **two graphs**
(`graphs/basics-mask-by-species.json`, `graphs/examples-rig.json`) and in
**no demo**.

**`basics-mask-by-species.json` loses nothing.** Its chain is
`scatter → moisture → species → size`; `species` is a string
`setAttribute` and so is not fusable at all, which leaves `moisture` and
`size` as lone chain nodes. A lone chain node is not a run
(`execute.ts:626-632`). The graph forms no run today and would form none
after the fix. Cost of gap 9 to it: **zero**.

**The rig loses one member.** Its part chain is
`partScatter(jitter) → partAngleAttr(setAttr) → partMount(transform) →
partPart(setAttr, string) → partOrient(orient) → partSize(setAttr) →
partPartSpawn(spawn)`, and three of those seven are already out for
reasons that have nothing to do with strings:

- `partPart` sets a STRING attribute — ineligible (`attributes.ts:117`).
- `partOrient` has a field-valued `up` — ineligible by its own predicate,
  counted as an author-actionable opt-out (`pointOps.ts:717`).

So the maximal chain containing the `byAttribute` is exactly
**`[partSize, partPartSpawn]`**. Today it rejects, `narrowRun`
(`execute.ts:731`) drops to `[partPartSpawn]`, and that plans — a lone
terminal IS a run (`execute.ts:734`), so **the rig keeps its
device-resident spawner either way**. Nothing about the parts becomes
CPU-only; `partSize`'s field resolves on the device per-node.

The whole win, therefore: **one member, 666 points**. Per cook that is
one column readback (`scale` f32x3 × 666 = 7,992 bytes), one CPU
attribute write, and one point-domain clone (~14 columns) avoided, plus
`readbacksSaved` gaining 1. On the CPU reference cook the node measures
**0.7 ms of a 100.5 ms whole-graph cook** (`node bin/pcg.mjs cook
graphs/examples-rig.json --stats`, 2026-08-16, 66 nodes, seed 3, parts
output 666 instances in 4 batches). It is not a performance argument and
should not be presented as one.

**What would change the number**, and so the honest trigger:

- A STREAMED world with a `byAttribute` in a spawner chain. There the
  same one-member loss multiplies by live cells and by frame, and the
  readback it costs is on the frame path rather than on a build. The
  asset-pack direction (tagged packs, `assetAttr` spawners) makes this
  the likely first caller.
- A chain where two or more members carry it — colour by kind AND scale
  by kind AND orient by kind — where the loss compounds and the narrowing
  cannot recover a device-resident terminal at all if the terminal's own
  predecessor is the one that carries it.

Either one, and this is a day's work with the design already written.
Neither yet, so it waits.

## The sites to touch, if it is built

1. `src/gpu/compile.ts` — export the param-only filler (`paramSlotValues`,
   `compile.ts:1351`) under a name that says spec-only. `paramConstValues`
   keeps its refusal (`compile.ts:1338`) unchanged; its comment gains the
   run.ts door beside the `constSlotValues` one.
2. `src/gpu/run.ts` — `KernelStep.attrIs`; `compileParam` loses the
   refusal at `run.ts:691` and records the pairs; `slotFor` admits
   `string` (`run.ts:583`); `executeResidentRun` resolves and appends the
   lanes before the range loop (`run.ts:1229-1237`); `PLAN_FORMAT` bump
   (`run.ts:336`). An assertion that no `written` entry is a string slot
   — free today, and the guard that keeps it free.
3. `src/gpu/evaluator.ts` — nothing. `executeRun` (`evaluator.ts:454`)
   already forwards `input.geo`; that is the point of choosing execute
   time.
4. `src/fields/gpuResolver.ts:54-65` — the `"run-plan-failed"`
   vocabulary explains the `attributeIs` decline in five sentences. They
   go, and the reason keeps its other meanings.
5. `src/gpu/types.ts:118-128` — `attrIsSlots`' doc says
   `paramConstValues` declines such a kernel; it must now say who fills
   it on each path.
6. Tests that ASSERT the decline, all of which flip:
   `src/gpu/runPlan.test.ts:452-503` (a whole describe block),
   `src/gpu/attributeIs.testsupport.ts:27-31` +
   `attributeIs.device.test.ts:236`,
   `src/gpu/byAttribute.testsupport.ts:39` +
   `byAttribute.device.test.ts:344`.
7. `PLAN-attribute-is.md` — "The fused/resident path cannot do this and
   must decline" becomes a record of what was true until it was not, in
   the file's own "What implementation corrected" idiom. And PLAN.md's
   gap 9.

Note what is NOT on this list: the six grammar sites, the parity minimal
spec (`src/gpu/parity.testsupport.ts`), `supportedGpuFieldFns()`
(`compile.test.ts:234`), the WGSL, the kernel cache key, `bufferType`,
and every doc that states the closed set. The kernel is finished; this is
a plumbing change in one file and a doc change in five.

## What this does NOT do

- **Does not make a string attribute readable as a number.** `attribute("species")`
  still throws on both paths, with the message naming `attributeIs` and
  `byAttribute` (`compile.ts:232-239`).
- **Does not let a resident member WRITE a string attribute.**
  `setAttribute` in string mode stays off the device, and the design
  depends on that: it is what makes one host-side resolution correct for
  every member of a run.
- **Does not send the string table to the device**, in any form, at any
  time.
- **Does not validate a literal or a case key against the table.** A
  misspelled literal is still dead code that reads as all zeros, on both
  paths, for the partition-safety reason. Gap 6 already recorded that this
  is unimplementable rather than unimplemented.
- **Does not touch CPU bytes or any memo key.** Every graph cooks to the
  same hash; the rig's `2778aafc` must not move.
- **Does not lift the 2^24 bound** on an exact f32 index compare, which
  no geometry the library can build reaches.
- **Does not fix gap 2** (`pointsToPath.groupAttr` wanting a string), which
  is a CPU-side grouping and shares nothing with this but the word
  "string".
- **Does not rescue the rig's other two ineligible members.** `partOrient`
  is out for a field-valued `up` and `partPart` for being a string write;
  both are separate entries if anyone wants them.

## Rejected, with the reason

- **Bake the index at plan time, by giving `ResidentRunContext` a string
  table source.** Cheapest possible diff — `ctx` already reaches the
  planner and the caller already holds the geometry
  (`execute.ts:1207-1220`). Rejected: it makes the plan's validity depend
  on table membership and ORDER, which nothing checks and which two
  same-count geometries routinely differ in, and the failure is silent
  wrong output rather than an error. It also contradicts the planner's
  stated contract ("synchronous and device-free"), and would foreclose
  plan reuse. The one-line count guard at `run.ts:1051` is not a substitute
  for a table guard, and writing a table guard is more work than resolving
  at execute time.
- **Extend `ResidentAttrDesc` with the table contents.** Same objection,
  plus it puts data into a descriptor that exists to be shape-only, where
  anything downstream may key on it.
- **Upload the table (offsets + bytes) and compare strings on device.**
  Enormous, and buys nothing: the literal is known host-side and the CPU
  comparison it must match is an integer compare.
- **Leave the decline and give it a better machine-readable reason** (e.g.
  `"run-needs-string-table"`). Considered seriously, since a declared
  decline is the pillar. Rejected on two counts: reasons are counted per
  RUN, so a new one still cannot name the member that carried the literal;
  and it would add a vocabulary entry that the fix deletes, in a
  vocabulary that is public API. The existing narrowing already gives the
  author the useful signal — `"run-partially-fused"` — and
  `PLAN-attribute-is.md` plus this file are where the WHY belongs.
- **Fuse only when the run contains exactly one string-carrying member.**
  A special case with no principle behind it; the general form is not
  harder.

## What must be tested, if it is built

- **Two geometries, one plan shape, different tables.** The soundness
  case the per-field path already makes
  (`attributeIs.testsupport.ts`, case 2) repeated at run scale: build the
  disagreement deliberately — same literals, different index ORDER — and
  assert the fused results are identical and equal the CPU's. Do not hope
  for the disagreement; assert it before asserting it is ignored.
- **The fused and per-node paths agree bit for bit** on a chain carrying
  the predicate, including the absent-literal case and the tuple-column
  stride case (component 1 matches nothing).
- **The table is unchanged after a fused run.** Guards against
  `internString` creeping into the execute-time filler.
- **No non-`attributeIs` plan moved.** The plan-format bump must not
  change a single existing step's `consts`, bindings or key; the same
  assertion `PLAN-attribute-is.md` records for kernel numbering, one level
  up.
- **A string slot is never written and never read back.** Assert it
  structurally (no `written` entry names a string column), not by
  observation.
- **`graphs.golden.json` does not move by a byte**, since the CPU is the
  reference and nothing here touches it.
