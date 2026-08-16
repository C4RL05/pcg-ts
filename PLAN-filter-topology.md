# `topology: "keep"` — point filters that leave a network a network

Every POINT filter in `src/nodes/filtering.ts` ends the same way:

```ts
return { out: [makeGeometryItem(gatherPoints(geo, keep))] };
```

`gatherPoints` (`src/nodes/util.ts`) builds a `new Geometry()` and copies
the point columns into it. `vertexToPoint`, `primVertexStart` and
`primVertexCount` are never read, so a polyline network in gives a bare
cloud out — no throw, no warning, and the primitives are gone whether or
not the filter touched a single point of them.

That is why the rig reaches for tag → `mergePoints` → regroup: once the
topology is gone the only way back is to rebuild it from a grouping
attribute. And it is why `mergePrimitives`, built for the
topology-preserving union, found nothing to preserve in
`graphs/examples-rig.json` — every union there happens on clouds that a
filter (or a merge) had already flattened. PLAN.md records this as gap 8.

Wanted: a `topology: "keep"` option that drops only the primitives which
lose points.

## 1. Which nodes get it

**In scope — the five point-domain filters in `src/nodes/filtering.ts`**,
which are exactly the nodes that compute an ascending `keep` list of point
indices and hand it to `gatherPoints`:

| node | `keep` comes from |
| --- | --- |
| `filterByDensity` | the `density` column, or a per-point hashed draw |
| `filterByBounds` | `insideBoxPredicate` |
| `filterByAttribute` | `comparisonPredicate` on the point domain |
| `filterByExpression` | a resolved field predicate |
| `selfPrune` | the greedy or local-maximum keep mask |

They differ only in how they decide; the rebuild is one line they share
verbatim. Consistency is the whole argument for taking all five: an author
who learns the param on one filter must not discover that a sibling lacks
it, and there is no filter here that cannot support it. All five get the
same param, validated by the same guard, routed through the same rebuild.

**Out of scope, each for a reason:**

- `filterPrimitivesByBounds`, `filterPrimitivesByAttribute` — already
  preserve topology. Their `unreferencedPoints` param is this same axis
  seen from the other domain, and its vocabulary is what this one borrows.
- `projectToPlane` (same file, same `"filter"` category) — removes no
  points. It mutates `P` in place and returns the input geometry, so
  topology already survives it untouched. Nothing to decide.
- `partitionByAttribute` (`src/nodes/attributes.ts`) — a SPLITTER, not a
  filter: every point survives into exactly one group. The all-or-nothing
  rule below is coherent there (a primitive lands in the group holding all
  of its points, or in none of them), but it needs its own decision about
  primitives that straddle groups, it lives in a file this unit does not
  own, and its `gatherPoints` call carries tags this rebuild does not.
  Recorded here as the obvious next candidate, deliberately not built.
- `forEach` (`src/nodes/forEach.ts`) — emits one point per iteration by
  construction; there is no subset to preserve.
- The samplers — they BUILD points; there is no input topology to keep.

## 2. The survival rule

**A primitive survives iff every point it references survives.**

Confirmed against the data model: a primitive is a contiguous run of
vertices in `primVertexStart`/`primVertexCount`, and each vertex names one
point through `vertexToPoint`. Nothing in `Geometry` records what a
partial primitive would mean, and every consumer reads a primitive whole —
`collectTriangles` wants exactly three vertices, `polylineArcTables` walks
the entire run to build its arc table. So a truncation would have to
INVENT geometry: drop the middle point of a five-vertex path and the
choices are to close the gap (a new segment nobody authored) or to split
it in two (a new primitive, and a new primitive-attribute row to go with
it). A triangle minus a vertex is not a smaller triangle. Neither is a
filter's job, and neither has a defensible default.

**A primitive that ends up with fewer than 2 vertices.** Under this rule
no primitive is ever truncated: it keeps all of its vertices or it is
dropped entire. So a surviving primitive has exactly the vertex count it
arrived with, and **a 1-vertex or 0-vertex primitive can only come out if
it went in** — this filter cannot manufacture one. It is passed through
unchanged. Deleting it would make the filter a degeneracy cleaner as well —
a second job, one that neither the current `"drop"` behaviour nor the
tag → regroup idiom it replaces ever performed, and one that would silently
delete authored data.

Measured while fixturing this, and worth recording because it narrows the
case: **`setPolylineTopology` already refuses a polyline under two
vertices** ("polyline P has N vertices; a polyline needs at least 2 (drop
it, or give it another point)"), so a degenerate primitive cannot come from
the polyline builders at all. It is reachable only through bare
`Geometry.setTopology`, which is the path `gatherPrimitives` itself uses
and the one the fixture had to take. That is a narrow door, but it is open,
so the rule still needs the answer above rather than an assumption.

**A primitive with no vertices survives vacuously**: it references no
point, so it loses none. Note that `filterPrimitivesByBounds` writes down
the OPPOSITE vacuous answer for `c === 0` ("not inside, under all four
rules"), and the two are not in conflict — they answer different
questions. There the question is *where is this primitive*, and a
primitive with no vertices is nowhere, so no box contains it. Here the
question is *did this primitive lose a point*, and one with no points lost
none.

That reading also buys the invariant that makes the param safe to reach
for: **a predicate that keeps every point reproduces the input's
topology.** Dropping empty primitives would break it for no gain.

One inherited caveat on that invariant, found by the verification pass and
worth stating rather than quietly carrying: `gatherPrimitives` lays the
survivors out into CONTIGUOUS vertex runs, so a geometry whose primitive
ranges do not tile its vertex array loses the vertices no primitive
references. Nothing forbids such a geometry — `setTopology` and
`setPolylineTopology` check only `start + count <= vertexCount` — and
`filterPrimitivesByBounds` and `filterPrimitivesByAttribute` have always
behaved this way, so `"keep"` inherits it rather than introducing it.
Measured: 5 vertices in, 4 out, with every point kept. The param
description says so instead of claiming "exactly".

## 3. The param shape

**An enum `topology: "drop" | "keep"`, defaulting to `"drop"`.**

- **Enum, not boolean.** The prior art in this file is enums for every
  decision of this class: `unreferencedPoints: "keep" | "drop"` on both
  primitive filters, `vertex: "first" | "last" | "all" | "any"`, `mode`,
  `boundary`. The one boolean in the file, `projectToPlane`'s
  `keepOffset`, is a genuine yes/no — write an extra column or do not —
  with no third answer imaginable. This decision has obvious third answers
  waiting (also drop primitives left degenerate; split a broken polyline
  at the gap), and an enum admits one later without changing a param's
  TYPE. A boolean would also have to be named `keepTopology` and default
  to `false`, which reads as "this node does not do that" where `"drop"`
  names what it actually does.
- **Named `topology`.** `unreferencedPoints` on the primitive filters is
  the mirror image of this param — what happens to the OTHER domain when
  this one is filtered — and it carries the same `"keep"`/`"drop"` value
  pair. A reader who knows one knows this one. `keepTopology`,
  `preserveTopology` and `primitives` are all new coinages against a
  settled vocabulary.
- **Checked at runtime**, by a `requireTopologyRule(nodeType, value)`
  shared by all five, for the reason `requireUnreferencedPointsRule` is
  shared by both primitive filters and `requireComparison` says outright:
  a param's `enum` is metadata for an editor, not a runtime guard, and
  five nodes must not be able to drift on one decision.
- **`"drop"` is the default and is byte-identical to today.** It is the
  same `gatherPoints(geo, keep)` call, not a re-derivation of it, so
  `tests/graphs.golden.json` must not move. If it does, the default
  changed, and that is a bug rather than a golden to regenerate.

**What `"keep"` also carries.** `gatherPrimitives` copies the vertex,
primitive AND detail domains; `gatherPoints` copies points only. So
`"keep"` additionally carries the input's DETAIL columns, which `"drop"`
discards. This is stated in the param description rather than papered
over: it is strictly more preservation, on an opt-in path, and suppressing
it would mean teaching the shared assembler a special case.

**`"keep"` always routes through the assembler, even when the input has no
primitives.** `selfPrune` already writes the principle down — "whether the
output carries topology must not depend on the data, only on the graph" —
so an empty primitive domain comes out as an explicitly empty topology
rather than as a silently different shape.

**`selfPrune`'s off switch is unchanged.** A `minDistance <= 0` returns
`cloneGeometry(geo)`, which already preserves topology whatever this param
says. Under `"keep"` that is exactly right. Under `"drop"` it stays the
documented quirk it is today — changing it would break compatibility for a
tidiness nobody asked for.

## 4. Vertex-domain attributes

Carried by the existing assembler, with nothing new written.
`gatherPrimitives` builds `vertexSrc`, the SOURCE vertex index of each
surviving vertex, while it lays the survivors out into contiguous runs;
`copyElements(src.attrs.vertex, out.attrs.vertex, vertexSrc, nv)` then
gathers the vertex columns through exactly that permutation, so vertex
values travel with the primitive that owns them and are renumbered with
it. Primitive columns come across through the surviving-primitive list the
same way, and detail columns are copied whole. Types, tuple sizes,
defaults and string tables all ride along, because `copyElements` recreates
each column before filling it.

## Reuse: `gatherPrimitives` fits, after gaining a third point rule

`gatherPrimitives(src, prims, dropUnreferenced)` already does the whole
job — select a subset of primitives, lay their vertices out contiguously,
renumber `vertexToPoint`, carry four domains — and it is the right helper
for a SUBSET selection. `mergePrimitives` was deliberately kept off it
because a union must append each input's vertex runs as they arrived while
this one compacts them into contiguous runs; a subset selection compacts,
so that reasoning points the other way here.

What does not fit is its point rule, which has two settings and needs a
third:

- `false` copies the point domain WHOLE — the points the filter just
  removed come straight back.
- `true` compacts to the points that surviving primitives reference — so a
  point that survived the filter but belongs to no primitive is dropped.
  A cloud carrying both a network and loose scatter would lose the
  scatter.

Either would make `topology` change the POINT domain, and the invariant
that keeps this param honest is the opposite: **`"keep"` emits exactly the
point domain `"drop"` emits** — same points, same order, same attributes,
same identities, same count — so switching the param adds topology and
changes nothing a downstream node reads off a point.

So the helper gains a third rule rather than the codebase gaining a third
assembler:

```ts
export type GatherPointRule = "all" | "referenced" | ArrayLike<number>;
export function gatherPrimitives(src, prims, points: GatherPointRule): Geometry;
```

The explicit form takes the ascending point selection the filter has
already computed — the very array it would hand `gatherPoints` — and
builds the remap from that. The two existing callers become
`drop ? "referenced" : "all"`, a mechanical change in the file that owns
both. `vertexSrc`, the run layout, the points-before-`setTopology`
ordering and all four `copyElements` calls are untouched.

**One guard comes with the generalization.** Under an explicit selection a
primitive could name a point that is not in it, and the remap would then
hand back a stale index that `setTopology`'s bounds check would happily
accept — a silently WRONG point rather than an error. The remap is
therefore prefilled with a sentinel and the vertex loop, which already
walks every surviving vertex, checks it. The shipped callers cannot
trigger it (they select the primitives from the same survivor mask), which
is precisely why it is worth a test that calls the helper directly.

The filter side is one small shared function:

```ts
function rebuildFiltered(geo, keep, keepTopology) {
  if (!keepTopology) return gatherPoints(geo, keep);   // today, unchanged
  const alive = new Uint8Array(geo.pointCount);
  for (const i of keep) alive[i] = 1;
  // a primitive survives iff every one of its vertices names a live point
  return gatherPrimitives(geo, survivingPrims, keep);
}
```

## What the rig actually needed, measured

Gap 8 says the missing option "forces the tag → `mergePoints` → regroup
idiom throughout the rig". Taking `graphs/examples-rig.json` through the
shipped param says otherwise, and the measurement is the useful part.

The rig has exactly TWO point filters among its 78 nodes:

- **`trussKeep`** (`filterByAttribute`, `framePhase lt 0.5`). Its input has
  already been flattened — `pcg inspect` puts `trussCorners`
  (`mergePoints`) at **184 points, 0 vertices, 0 primitives**. There is no
  topology left for `topology "keep"` to keep.
- **`partCluster`** (`filterByDensity`, threshold 0.46). This one DOES sit
  over live topology (the resampled spine, one polyline), but the branch
  ends at `spawnInstances`, so nothing downstream reads a primitive — and
  a threshold filter drops points out of the middle of that single
  polyline, so `"keep"` would drop it anyway.

**So the rig needs no `topology "keep"` edit at all.** The idiom gap 8
names is really there, but on inspection it is not one idiom and neither
half of it is a filter workaround:

1. **The chord and brace paths are a regroup of topology that already
   existed.** `trussMove0/2/4/6` each cook to **46 points, 46 vertices, 1
   primitive** — four offset copies of the resampled spine, each of which
   IS a chord. `trussCorners` (`mergePoints`) then throws all four
   primitives away, and `trussChordPath` (`pointsToPath`,
   `groupAttr "strutId"`) rebuilds exactly **4 primitives over the same
   184 points**. That is `mergePrimitives`, spelled in three nodes and an
   attribute. Same for `trussBraces` / `trussBracePath`.
2. **The frame rings are a regroup that builds NEW topology.** `trussRing`
   (`pointsToPath`, `closed true`, `groupAttr "stationId"`) connects the
   four chords ACROSS each station. No filter and no merge could have
   preserved that, because it never existed upstream. The regroup is
   essential here, not a workaround.

The conclusion worth carrying back to PLAN.md: gap 8's premise was half
right. The option is real and now exists; what the rig was actually
missing at those nodes was `mergePrimitives`, which finally has something
to preserve.

### The rig edits this recommends (not applied here)

`graphs/examples-rig.json` belongs to another unit, so these are written
down rather than made. Verified wiring, from the graph's own connections:

```
trussStation -> trussTag{0,2,4,6} -> trussMove{0,2,4,6} -> trussCorners
trussCorners -> trussChordPath -> trussChordSkin
trussCorners -> trussPhase -> trussKeep -> trussRing
trussStation -> trussTag{1,3,5,7} -> trussMove{1,3,5,7} -> trussBraces
trussBraces  -> trussBracePath -> trussBraceSkin
```

1. `trussCorners`: `"type": "mergePoints"` -> `"mergePrimitives"`. Delete
   `trussChordPath` and rewire `trussCorners -> trussChordSkin`.
2. `trussBraces`: the same, deleting `trussBracePath` and rewiring
   `trussBraces -> trussBraceSkin`. (`trussMove1` is 46 points / 46
   vertices / 1 primitive and `trussBracePath` is 184 / 184 / 4, exactly
   as on the chord side.)
3. `strutId` then has no reader — it occurs 11 times in the file: once in
   the graph description, 8 times as a `setAttribute` name, twice as a
   `groupAttr`, and both `groupAttr`s go with step 1 and 2. So the eight
   `trussTag*` nodes are dead and can be deleted, rewiring
   `trussStation -> trussMove*` directly. Ten nodes removed in total.
4. `trussCorners`' OTHER consumer needs no change: `trussPhase` ->
   `trussKeep` keeps the default `topology "drop"`, so the frame branch
   flattens exactly as it does today and `trussRing` still builds the
   rings. Setting `"keep"` there would be pointless work — every chord
   loses three points in four, so all four would be dropped anyway.

Confirm after applying: the four chord and four brace primitives must come
out in the same order with the same vertex runs. Both paths concatenate
their inputs in pin order, so they should, but the graph's cook hash is
the thing to check rather than the argument.

## Test plan

- `"drop"` is untouched: the golden does not move, and each of the five
  nodes still emits a bare cloud from a network.
- `"keep"` on a network: only the primitives whose points all survive come
  through; their vertex, primitive and detail columns are correct; the
  point domain is IDENTICAL to what `"drop"` produced from the same input
  and params.
- The all-surviving case reproduces the input's topology exactly.
- A surviving point belonging to no primitive is still kept.
- Both `"keep"` and `"drop"` refuse a misspelled value, naming the node.
- The assembler's sentinel guard throws when handed a primitive whose
  point is outside the selection.
- **Falsifiability**: break the survival rule (accept a primitive when ANY
  of its points survives) and the network test must go red.
