# Sweep and extrude — giving the library a surface

Design for the two node types that turn a curve into a skin and a
footprint into a solid.

Status: designed, not built. Every claim below was checked against the
tree at the time of writing; `file:line` references are to that tree.
Every count was **re-measured for this document** rather than inherited —
including the ones `CLAUDE.md` and `PLAN.md` state — and where a number
is an estimate rather than a measurement it says so in the sentence.

---

## 1. Summary

The library can already *represent* a triangle mesh, *sample* one,
*transfer* through one, *filter* one, *serialize* one and *render* one.
It has exactly one node that *makes* one — `meshPrimitive`, which makes
planes and boxes (`src/nodes/meshes.ts:107-230`). Everything the corpus
builds out of curves stops at `pathSegments`, which emits an oriented
point per segment for a unit cylinder to land on
(`src/nodes/paths.ts:423-568`).

So this is **not a data-model gap**. `Geometry` already carries the
topology a swept surface needs (`src/data/geometry.ts:17-25`),
`createTriangleMesh` already stamps `primtype = "poly"`
(`geometry.ts:111-146`), `toBufferGeometry` already exports `poly`
primitives to three and already fan-triangulates n-gons
(`src/three/convert.ts:357-387`), and the sandbox already draws one
geometry's `poly` and `polyline` primitives side by side in a single
item (`examples/shared/draw.ts:157-170`). **A node that returns a
`createTriangleMesh` result is visible with no change to `src/three`
and no change to `src/data`.**

What is missing is producers, plus the small companions the consumers
name for themselves (§3): a `uv` path through `toBufferGeometry`, a
primitive-domain attribute filter, and a decision about `mergePoints`.

Proposal: **two node types, one new category, no format change, no
`Geometry` change.**

- **`sweepProfile`** — polyline in, `poly` mesh out. A profile (circle /
  square / ribbon, sized by a field-capable radius or width) is placed
  once per path point and stitched. Replaces 12 of the 13 `pathSegments`
  in the rig.
- **`extrudePolygon`** — closed polyline in, `poly` mesh out. The
  boundary is swept along a direction, with optional caps. Turns the
  city pipeline's 55 lot footprints into massing and its 64-point
  boundary loop into a wall.

A "tube" node is rejected: it is `sweepProfile` with the default
profile. The convenience belongs in `src/primitives`, which is what that
subpath export exists for (37 registered recipes, `docs/primitives.md:5`).

---

## 2. What the data model can represent today

### 2.1 A primitive can be a polyline or a triangle, and nothing else names itself

`PrimType` is a closed two-value union:

```ts
// src/data/geometry.ts:8
export type PrimType = "poly" | "polyline";
```

`primtype` is a `string` attribute on the primitive domain
(`geometry.ts:5`, written at `:144` and `:213`). Nothing else in `src/`
writes a third value. `primitiveTypeCounts` (`geometry.ts:95-104`) is
the public "what is this geometry" query, and it deliberately collapses
"untagged" and "no primitives" to the same `{}`; `src/three/convert.ts`
needed to tell those apart and wrote its own `describeContents`
(`convert.ts:156-169`) to do it.

Topology is range-based and completely general (`geometry.ts:17-25`):
vertex `i` references point `vertexToPoint[i]`, and primitive `p` spans
`[primVertexStart[p], primVertexStart[p] + primVertexCount[p])`.
**There is no per-primitive vertex-count constraint anywhere in the
container.** A `poly` may have 3, 4 or 40 vertices as far as `Geometry`
is concerned.

The consumers are stricter, and this is the constraint that decides the
representation:

- `surfaceSample` skips any primitive whose `primVertexCount !== 3` and
  any whose `primtype !== "poly"` (`src/nodes/samplers.ts:94-96`).
- The `uv` and `raycast` transfer mappings collect only 3-vertex `poly`
  primitives (`src/data/transferMapping.ts:263-274`), with an error that
  says so.
- `toBufferGeometry` is the one that is *lenient*: it fan-triangulates
  anything with three or more vertices from its first vertex
  (`src/three/convert.ts:365-372`).

**Conclusion, and it is not negotiable: a swept surface must emit
triangles, not quads.** Emitting quads would produce a mesh that draws
correctly and is invisible to `surfaceSample` and to both mesh transfer
mappings — a plausible-looking cook, which is the failure class this
library refuses everywhere else. Cost of the decision: two primitives per
quad instead of one, so the primitive-domain element count doubles
against the quad spelling. §6.6 prices it.

### 2.2 `meshPrimitive` and `basics-mesh-primitive.json`, exactly

`meshPrimitive` (`src/nodes/meshes.ts:107-230`) takes no input and
produces, from params alone:

- `P` (f32 tuple 3) on the point domain;
- **`uv` (f32 tuple 2) on the POINT domain** (`meshes.ts:226`), running
  0..1 across each face, u fastest then v;
- one 3-vertex `poly` primitive per triangle, via `createTriangleMesh`
  (`meshes.ts:225`);
- shape `plane` = one subdivided rectangle in a named world plane;
  shape `box` = six of them, faces not sharing points so uv seams are
  exact.

`examples/graphs/basics-mesh-primitive.json` is a **one-node graph**: a
40x40 `xz` plane at 8x8 subdivisions, one declared output. It exists to
say that this is the only mesh source that survives serialization —
`dataInput` items are injected at runtime and a saved graph carries none
(`meshes.ts:1-10`).

So: **the library can already emit n-gons and triangles; it just has one
node that does, and that node takes no geometry input.**

### 2.3 The vertex domain is real, addressable, carried, and unwritten

`Domain` is `"point" | "vertex" | "primitive" | "detail"`
(`src/data/types.ts:2`). The vertex domain is not decorative:

- `promoteAttribute` moves values across every domain pair through the
  topology, including point/vertex and vertex/primitive
  (`src/data/promote.ts:14-54`).
- `setAttribute`, `removeAttribute` and `attributeReduce` all accept
  `vertex` in their domain enums (`src/nodes/attributes.ts:60-66`,
  `:466`, `:772`).
- `transferAttribute` mapping `uv` reads per-corner UVs from the
  **vertex** domain when present, falling back to the point domain
  (`src/data/transferMapping.ts:437`; documented at
  `src/nodes/attributes.ts:312`).
- `gatherPrimitives` carries vertex attributes with the primitives that
  own them (`src/nodes/util.ts:545`), which is how
  `filterPrimitivesByBounds` keeps them.
- The worker protocol encodes and decodes it
  (`src/worker/protocol.ts:207`, `:226`).

But **no shipped node writes a vertex attribute except a `setAttribute`
aimed there by hand**. `createTriangleMesh` creates none.
`setPolylineTopology` deletes every vertex and primitive attribute it
finds before installing new topology (`geometry.ts:204-207`), on the
stated grounds that "the topology they described is gone".
`meshPrimitive` puts its `uv` on the point domain, not the vertex domain.

That matters for §6.2: **the shipped convention for UVs is the point
domain**, and the vertex domain is the seam-accurate escape hatch that
one consumer reads and nothing writes.

### 2.4 What `src/three` does with a mesh versus with instances

Two entirely separate bridges, and the mesh one already exists:

| | mesh | instances |
|---|---|---|
| entry | `toBufferGeometry` (`convert.ts:357`) | `toInstancedMeshes` (`instanced.ts:83`) |
| input | a `Geometry` `poly` primitives | `InstanceBatch[]` plus an `AssetMap` |
| output | one `BufferGeometry` | one `InstancedMesh` per batch |
| carries | `position`, index, `color`, `normal` | `instanceMatrix`, `instanceColor` |
| n-gons | fan-triangulated (`convert.ts:365-372`) | n/a |
| compaction | unreferenced and non-finite points dropped (`convert.ts:252-315`) | n/a |

`toLineGeometry` (`convert.ts:408-429`) is the third, for `polyline`.

`drawItem` runs the mesh exporter when `counts.poly > 0`, the line
exporter when `counts.polyline > 0`, and suppresses the point cloud when
either drew (`examples/shared/draw.ts:131-177`). Both run on the *same*
geometry, so a mesh with leftover polylines draws both.

**So the bridge a swept surface needs is already built.** The one real
gap, and it is a bug the sweep exposes rather than causes:
`toBufferGeometry` gathers `color` and `normal` onto the compacted
points (`convert.ts:377-385`) and **never gathers `uv`**. Its own
docstring admits the inbound direction drops it (`convert.ts:33`); the
outbound direction drops it silently. Today that means **the `uv` that
`meshPrimitive` writes cannot reach three.js at all** — a textured plane
is not currently possible in the examples. Fixing it is one
`gatherVec3`-shaped helper at tuple 2, and it is a prerequisite for a
swept surface meaning anything.

### 2.5 What consumes a surface today

Five things, and all five constrain the representation:

1. **`surfaceSample`** — 3-vertex `poly` only, area-weighted, writes a
   flat per-triangle `normal` on the output point domain and carries the
   triangle own primitive attributes onto each sample
   (`src/nodes/samplers.ts:32-118`).
2. **`transferAttribute` mappings `uv` and `raycast`** — 3-vertex `poly`
   only (`transferMapping.ts:263-274`); refuses an edge network by name
   and states the fix.
3. **`promoteAttribute`** — any topology, via `forEachContribution`
   (`promote.ts:14-54`).
4. **`filterPrimitivesByBounds`** — the only topology-preserving filter
   in the library (`src/nodes/filtering.ts:268`), backed by
   `gatherPrimitives` (`util.ts:491-549`), which carries point, vertex,
   primitive and detail attributes.
5. **`toBufferGeometry`** and the CLI SVG renderer
   (`src/cli/render.ts:454`, `:484`).

Nothing indexes triangles spatially outside `src/data/transferMapping.ts`,
which builds its own grids. `src/spatial` is points-only: `UniformGrid`
takes a `PositionView` (`src/spatial/uniformGrid.ts:26`, `:67`) and
`buildAdjacency` works over points (`adjacency.ts:139`). There is no
primitive-domain spatial structure to invalidate.

**The strong constraint, stated once: because surface sampling already
reads triangles, a swept surface that is not 3-vertex `poly` is a second
class of mesh the library own consumers cannot see.**

---

## 3. Consumer survey

Measured today across all **46** graphs in `examples/graphs/`.

### 3.1 The rig — `examples-rig.json`

Counted recursively (the top-level list plus the two composite bodies):
**93 nodes**, of which 82 are top-level. `pathSegments` appears **13**
times: 12 at top level plus `wrapSolid` inside the `wrapWraps` `forEach`
body. Corpus-wide `pathSegments` is **14** — those 13 plus one in
`basics-path-segments.json`. No `src/primitives` recipe wraps it.

Cook: `82 cooked, 0 cached, 78 ms` against a `CORPUS_TIME_LIMIT_MS` of
**10 000** (`src/docs/corpus.ts`).

Instance counts are from `tests/corpus.golden.json`; ring, segment and
turn-angle figures I measured by cooking each `pathSegments` input.

| site | asset | paths | rings | segments | instances | max turn | becomes |
|---|---|---|---|---|---|---|---|
| `trussSolid0/2/4/6` | tube | 4 | 184 | 180 | 180 | **4.3 deg** | 4 swept tubes r=0.055 |
| `trussSolid1/3/5/7` | tube | 4 | 184 | 180 | 180 | **99.9 deg** | 4 swept tubes r=0.03, mitered |
| `trussSolid` | tube | 12 closed | 48 | 48 | 48 | **90.0 deg** | 12 swept closed frames |
| `wrapSolid` (x16 forEach) | tube | 16 | 2400 | 2384 | 2384 | small | 16 swept cables |
| `danglerDanglerTube` | tube | 200 | 3400 | 3200 | 3200 | **12.6 deg** | 200 swept danglers |
| `drapeDrapeTube` | tube | 456 -> 63 | 10488 -> 1449 | 10032 -> **1386** | 1386 | **16.2 deg** | 63 swept swags |
| `chainSegments` | **chainLink** | 7 | 245 | 238 | 238 | **0.0 deg** | **stays `pathSegments`** |

**12 of 13 become sweeps; one does not.** `chainSegments` places a
discrete stadium-shaped link per segment (`examples/shared/assets.ts:57-61`
builds it with the three.js `TubeGeometry`), and a swept surface cannot
express a chain of separate links. `pathSegments` keeps a job: *one
oriented asset per segment*. What it loses is its second, borrowed job:
*fake a tube*.

Two consumer requirements fall out of the rig that a design-first pass
would have missed.

**(a) The drape branch filters AFTER the fake-tube node, by 7.24x.**
`drapeDrapeTube` emits 10 032 segment points; `drapeLong`
(`edgeLength >= 4`) and `drapeSome` (`chordPick < 0.16`) cut them to
1 386. Both read *primitive* attributes that `pathSegments` carried onto
its output *points* (`carryPrimitiveAttributes`, `util.ts:423-462`).
Post-sweep the equivalent filter must run on the **polyline primitive
domain, before the sweep** — and the only primitive-domain filter in the
library is `filterPrimitivesByBounds` (`filtering.ts:268`), which is
bounds-only. Without a companion node the swept drapes do 7.24x the work
and 7.24x the memory. **This is a required companion specified by a
consumer, not by taste.**

**(b) `mergePoints` destroys topology** (`src/nodes/pointOps.ts:303`,
"Topology (vertices/primitives) is not carried"). The rig has four:
`trussChords`, `trussBraces`, `trussCorners`, `wrapMerged`. Three of them
sit *downstream of* a `pathSegments`, so with sweeps they would delete
the very surface just built. **This is not a blocker**, because
`examples/01-sandbox/main.ts:222-232` iterates every item of an output
collection and calls `drawItem` per item — a `forEach` emitting 16 mesh
items renders fine. The three merges get deleted and each output becomes
a multi-item collection. `PLAN.md:144-147` already carries "a
topology-preserving union" in the Backlog, ranked #3 in the stage-5
design missing list; **the sweep is the caller it was waiting for, but it
is a nice-to-have here, not a prerequisite.** Said honestly rather than
smuggled in.

### 3.2 The city pipeline — `pipeline-1..5`

Cooked `pipeline-5-roads.json` (48 top-level nodes, 15 of them `ref`s
into `src/primitives`) in **38 ms**. Output shapes, measured:

| output | shape | what it is | wants |
|---|---|---|---|
| `terrain` | 1152 `poly`, 625 pts | a real displaced mesh | nothing |
| `boundary` | **1 closed `polyline`, 64 pts**, max turn 13.4 deg | the city wall | **extrude up**, 128 tris |
| `footprints` | **55 closed `polyline`, 220 pts / 275 verts**, max turn 90.0 deg | one closed quad per lot | **extrude up**, 660 tris |
| `roads` | **10 open 2-vertex `polyline` over 9 pts**, primitive attrs `roadLength, roadWeight, districtKind, roadWidth` | the road network | **ribbon**, 20 tris |
| `buildings` | 55 instances (house 27 / hall 15 / barn 13) | assets standing on lot **centres** | — |
| `props` | 82 `post` instances along the boundary | **a wall faked as a row of posts** | — |
| `lamps` | 42 `lamp` instances along the roads | legitimate props | — |

The guess was right, and better than expected: **the pipeline has already
done the modelling work and cannot draw it.**

- `footprints` are literally closed quads per lot ("A 4-corner ring
  copied onto every lot and grouped by `lotId` becomes one closed quad
  per plot", `pipeline-3-lots.json` meta). They render as line loops.
  Meanwhile `buildings` puts a pre-made house asset on the lot *centre* —
  so the footprint the graph computed and the building the viewer sees
  are two unrelated shapes. That is the clearest case in the corpus of
  the data saying what the shape is while nothing can show it.
- `roads` already carries `roadWidth` **on the primitive domain**, and
  the graph already promotes it back to points as `roadJunction` (mode
  `max`). A ribbon node has both spellings of width waiting for it before
  the node exists.
- `boundary` plus `props` is a wall drawn as 82 posts.

**Extrusion and ribbon cost on the pipeline is negligible**: about 808
new triangles against the 1152 already in `terrain`.

One thing the survey says that the vocabulary must answer: **`roads` is a
network, not a set of independent curves.** `connectPoints` in
`relativeNeighborhood` mode joins 9 centres with 10 edges *sharing their
endpoints*, so a centre can have degree 3 (`pipeline-5-roads.json` meta).
Ten independently swept ribbons will overlap at junctions. §6.3.

### 3.3 Anything else faking a surface

Checked all 46 graphs. Only two idioms:

1. **tube-as-instanced-segments** — the rig, 12 sites.
2. **wall/road-as-instanced-props** — `pipeline-4/5` `posts` (82) and
   `roadPosts` (42).

Everything else that instances props is *legitimately* instancing props:
`examples-forest.json` scatters 3 tree species on a real `meshPrimitive`
surface; `basics-radial-on-curve`, `basics-props-along-a-path`,
`basics-gather-on-path` and `basics-spawn-by-species` are all genuinely
per-point assets. The `spawnInstances` terminal is not in question —
corpus-wide it appears 21 times and the sweep removes at most 6 of them.

---

## 4. Proposed vocabulary

### 4.1 Two nodes, in a new `surface` category

`category` is a free string (`src/nodes/registry.ts:42`, validated only
as non-empty at `:131-136`), and the shipped set is
`attribute / composite / filter / io / point op / sampler / source /
spawn / value`. None fits. **`surface`.**

#### `sweepProfile`

**A profile is placed once per point of every polyline primitive, and
consecutive placements are stitched into triangles.** Polyline in, `poly`
mesh out.

| param | type | default | notes |
|---|---|---|---|
| `profile` | enum | `"circle"` | `circle` / `square` / `ribbon` |
| `sides` | i32 | `8` | `circle` only. 8 matches the shipped `tube` asset, `CylinderGeometry(1,1,1,8)` (`examples/shared/assets.ts:119`) |
| `radius` | f32, **field** | `0.05` | `circle` and `square`. Same default as `pathSegments.radius` |
| `width` | f32, **field** | `1` | `ribbon` |
| `frame` | enum | `"upHint"` | `upHint` / `curveFrame` / `rot` — §4.3 |
| `up` | vec3, **field** | `[0,1,0]` | `upHint` mode. Same default and same fallback chain as `pathSegments` (`paths.ts:427`) |
| `roll` | f32, **field** | `0` | turns of the profile about the tangent |
| `joint` | enum | `"miter"` | `miter` / `perpendicular` — §6.3 |
| `miterLimit` | f32 | `4` | falls back to `perpendicular` past this — §6.3 |
| `caps` | bool | `true` | close the ends of an OPEN path with a closed profile |

`gpu: "fields"`, exactly as `pathSegments` declares (`paths.ts:457`). Not
`resident` — §6.5.

#### `extrudePolygon`

**Each closed polyline is treated as a polygon boundary and swept along a
direction, with optional caps.** Closed polyline in, `poly` mesh out.

| param | type | default | notes |
|---|---|---|---|
| `distance` | f32, **field** | `3` | resolves on the input POINT domain, so a per-point value gives a sloped top |
| `direction` | enum | `"+y"` | `+y` / `vector` / `polygonNormal` (Newell, deterministic) |
| `vector` | vec3 | `[0,1,0]` | `vector` mode |
| `caps` | enum | `"both"` | `none` / `top` / `bottom` / `both` |
| `sides` | bool | `true` | false plus `caps: "top"` is a floating lid |

An OPEN polyline is refused, naming the fix (`pointsToPath` with
`closed: true`) — the operation is not defined on one.

`gpu: "fields"`. Not `resident`.

### 4.2 Alternatives rejected

**A `tube` node.** It is `sweepProfile` with `profile: "circle"`, which
is the default — a second registry name for one param value. The library
already has the right home for a convenience: `src/primitives`, whose 37
recipes exist precisely to name a wiring (`docs/primitives.md:5`; the
subpath is described in `CLAUDE.md` as "the shipped vocabulary"). Ship
`shape/tube-along-curve` there in step 5, not a node type.
**Naming hazard worth recording: `sweep` is already taken.** `shape/ring`
has a `sweep` param meaning *arc fraction*
(`src/primitives/shape.ts:151-163`), which is why the node is
`sweepProfile` and not `sweep`.

**A separate `ribbon` node.** A ribbon is `sweepProfile` with an open
2-point profile. What genuinely differs is not the geometry but the
FRAME — a road ribbon wants world up, a cable wants a transported
normal — and that is a param, not a node. `orientAlongVector` already
demonstrates the exact shape: a field-capable `direction` plus a
field-capable `up` hint (`src/nodes/pointOps.ts:353-362`).

**Folding extrude into sweep.** Extruding a footprint *is* sweeping the
footprint along a 2-point path, and that observation is a trap: it
inverts the pins (the input becomes the profile and the path becomes a
param), and it needs polygon *triangulation* for caps, which a sweep
never needs. Two nodes, two jobs.

**A profile from a second geometry input pin (v1).** Deferred, not
rejected. It is the right long-term answer — an I-beam, a kerb, a
gutter — but it forces four decisions with no consumer asking for them
yet: which plane the profile lies in, what its origin means, what happens
when it has several primitives, and whether its attributes carry.
`meshPrimitive` had the same shape of question and answered it with an
enum. Add the pin when a consumer asks; the enum values stay valid.

**A profile named from `src/primitives`.** Rejected outright: `src/nodes`
must not depend on `src/primitives` — importing the latter *registers*
every primitive, which is exactly why it is not in the root import
(`CLAUDE.md`, Layout).

**Emitting quads instead of triangles.** Rejected in §2.1: invisible to
`surfaceSample` and to both mesh transfer mappings.

### 4.3 Where the frame comes from, and open versus closed

**Open versus closed PATH** is already structural and needs no flag: a
closed polyline last vertex references its own first point
(`geometry.ts:158-160`), and `polylineArcTables` reports it as `closed`
(`util.ts:583`, computed at `:643`). A closed path sweep shares the first
and last ring rather than emitting two, so the tube closes on itself
exactly, with no seam to hide.

**Open versus closed PROFILE** is the node own business and is decided by
the `profile` enum: `circle` and `square` are closed, `ribbon` is open. A
closed profile stitches ring point `N-1` back to `0`; an open one does
not, and gets no caps (a ribbon has no inside).

**Caps** apply only to an OPEN path with a CLOSED profile — the two ends.
A closed path has no ends; an open profile has no hole. Stated as a rule
so all four combinations are defined.

**The frame is the real question, and the answer is: mostly do not
compute one.**

- `frame: "upHint"` (default) reproduces the exact `pathSegments` rule —
  an up hint of `[0,1,0]` with the same deterministic fallbacks
  (`[0,0,1]`, then `[1,0,0]`) through the shared `orientQuat`
  (`util.ts:876`). **Purely local.** Correct for a tube (rotationally
  symmetric) and for a flat road ribbon (up *is* world up). Wrong for a
  ribbon on a curve that turns over — and `writeCurveFrame` already
  explains why in detail (`paths.ts:794`).
- `frame: "curveFrame"` reads the `curveNormal` and `curveBinormal` point
  attributes that `writeCurveFrame` writes (`paths.ts:790-984`). This is
  a **rotation-minimizing frame the library already ships**, built by
  double reflection, orthonormal by construction. The rig already runs
  `writeCurveFrame` three times.
- `frame: "rot"` reads the standard `rot` quaternion, so anything that
  writes `rot` — `orientAlongVector`, with its field-capable direction
  and up — drives the sweep.

**Why this matters more than it looks: the sweep computes no frame of its
own, so it introduces no new non-locality.** §6.4.

---

## 5. What the vocabulary needs beside it

Named here rather than in §8 because two of the three are prerequisites.

1. **`toBufferGeometry` must carry `uv`** (`convert.ts:377-385`).
   Prerequisite: a swept surface that cannot be textured is a swept
   surface nobody wants. Side effect: the `uv` that `meshPrimitive`
   writes (`meshes.ts:226`) reaches three.js for the first time.
2. **A primitive-domain attribute filter.** Prerequisite for the rig
   drape branch (§3.1a). Cheapest shape: adding an `attribute` mode to
   `filterPrimitivesByBounds` is *wrong* — its name would lie. A sibling
   `filterPrimitivesByAttribute` reusing `gatherPrimitives`
   (`util.ts:491-549`) and mirroring the `filterByAttribute` comparison
   enum is right. Small.
3. **A topology-preserving union.** *Not* a prerequisite (§3.1b), and
   already in `PLAN.md:144-147`. The sweep is its first real caller.

---

## 6. The hard parts

### 6.1 Attributes across the dimension change

This is where the promises of the data model meet a topology change, and
the library has already answered the same question twice, in opposite
directions:

- **`carryPrimitiveAttributes`** (`util.ts:423-462`) — when a sampler
  collapses a primitive to points, every primitive column except
  `primtype` gathers onto the new elements; name collisions are
  **refused** with an error naming the node, the column, the shape and
  the fix; and **no index column rides along**, because "primitive
  numbering is per-partition, so a shipped `sourcePrimitive` would differ
  between one cell and the whole region and redden split-equals-whole"
  (`util.ts:396-401`). *Values carry; identity does not.*
- **`setPolylineTopology`** (`geometry.ts:204-207`) — when topology is
  replaced, vertex and primitive attributes are **dropped**, because
  "the topology they described is gone, and keeping them would leave
  values belonging to elements that no longer exist".

A sweep is neither collapse nor replacement: the mapping is exact and
**1 : (N+1)**. Every output point belongs to exactly one (input point,
profile index) pair. So:

| domain | rule | why |
|---|---|---|
| input **point** to output **point** | **copy, replicated around the ring. No interpolation.** | The sweep introduces no new positions ALONG the path, only around it. Interpolating would invent values the author did not ask for. |
| `P` | replaced | obviously |
| `normal` (f32 tuple 3), `uv` (f32 tuple 2) | **written by the node**, and therefore **reporting slots** | An input already carrying one is REFUSED via `requireReportSlot` (`util.ts:287`) — exactly what `writeTangents` and `writeCurveFrame` do (`paths.ts:727`, `:856`). Deleting and re-adding would destroy a column while the cook still looked fine. |
| input **primitive** to output **primitive** | **gather**, by the same rule and the same helper shape as `carryPrimitiveAttributes` | This is what keeps `roadWidth`, `chordPick` and `edgeLength` alive across the sweep, and what makes a post-sweep primitive filter possible at all. |
| input **vertex** | **dropped**, with the `setPolylineTopology` reasoning | A closed path repeated last vertex makes the mapping genuinely ambiguous, nothing writes vertex attributes anyway (§2.3), and inventing a rule for a domain with no producer is the wrong order. |
| **detail** | copied through 1:1 | as `gatherPrimitives` does (`util.ts:547`) |
| `primtype` | never carried; the node stamps `"poly"` | it is a type tag, not a value — the existing exception |

**The key simplification, stated so a reviewer can attack it: the sweep
does not resample the path.** Rings sit exactly on the input points. If
the author wants more rings, they run `pathResample` first, which is
already the idiom (the rig runs it 8 times). That decision removes the
interpolation question entirely, and it also removes the one fudge in
`pathSegments`: its `radius` resolves on the input points and each
segment takes "the AVERAGE of the values at its two endpoints"
(`paths.ts:444`), because a segment has no element of its own. A sweep
ring *is* at a point, so a field-capable radius resolves there exactly.

**The honest cost, and the honest answer.** Copying *all* point
attributes means the standard 8 (`src/data/points.ts:16-25`, 88 bytes per
point) are replicated N+1 times around every ring, and `rot`, `scale`,
`boundsMin`, `boundsMax` and `seed` are meaningless on a surface point.
At N=8 that is about 6.1 MB of mostly-dead columns on the rig (§6.6).
Three options were considered:

- copy all — simple, matches `cloneGeometry` and `gatherPoints`;
- a `carry: string[]` param — a new knob;
- copy all *except* a hard-coded exception list — **rejected**, because a
  silent exception list is precisely the plausible-looking cook this
  library refuses.

**Take the first, and document the second as an existing node.**
`removeAttribute` already deletes named attributes from one domain
(`src/nodes/attributes.ts:755`). The fix is a sentence in the node
description, not a param. If measurement later says the default is wrong,
the param is additive.

### 6.2 UVs and normals

**A UV convention exists; do not invent one.** `meshPrimitive` writes
`uv`, f32 tuple 2, **point domain**, 0..1 across a face
(`meshes.ts:111`, `:226`). `transferAttribute` reads `uvAttr` defaulting
to `"uv"`, f32 tupleSize at least 2, from the destination point domain
and from the source vertex domain when present else its point domain
(`attributes.ts:308-312`, `transferMapping.ts:425`, `:437`). So:
**`uv`, f32 tuple 2, point domain.** In scope: writing it. Out of scope:
inventing it.

For `sweepProfile`, `u` is normalized arc length along the path and `v`
is normalized position around the profile. Matching `u` to `curveU` —
which `pathSegments` and `pathPointAt` both write — is what makes a
texture line up with anything else measured along that curve.

Two decisions this forces:

- **Normalized `u`, not world length**, in v1. It matches
  `meshPrimitive`, `curveU` and `fraction`. Tiling along a 34-unit truss
  chord then needs a rescale, which `setAttribute` with a `vec` field can
  do. A `uvScale` vec2 param is additive; add it when someone asks.
- **The seam column must be duplicated.** For a closed profile, ring
  point 0 and ring point N are the same position but need `v = 0` and
  `v = 1`. Sharing the point makes the texture wrap backwards across one
  column of quads; duplicating it costs `(N+1)/N` points — 12.5% at
  N=8 — and is the standard answer. §6.6 prices the duplicated version.

**Normals: the node writes them, and must.** `toBufferGeometry` uses a
`normal` point attribute when present and otherwise calls
`computeVertexNormals()` (`convert.ts:381-385`), which smooths across the
shared points of the indexed result. On a swept tube that smooths across
the uv seam and across the cap ring, producing a visible crease where
there is none and a smooth shade where there should be one. The sweep
knows the analytic normal (the profile own normal rotated by the frame),
so it writes it. `normal` (f32 tuple 3, point domain) is already the name
`surfaceSample` uses, and `writeCurveFrame` deliberately avoided it for
exactly that reason (`paths.ts:808`) — so there is no collision to
resolve, only a convention to join.

### 6.3 Joints

**Measured on the corpus rather than assumed.** Maximum turn angle
between consecutive segments, per sweep site:

| site | median | p99 | max |
|---|---|---|---|
| truss chords | 1.2 | 4.3 | **4.3 deg** |
| truss braces (zigzag) | 96.3 | 99.9 | **99.9 deg** |
| truss frames (closed squares) | 90.0 | 90.0 | **90.0 deg** |
| chains | 0.0 | 0.0 | **0.0 deg** |
| danglers | 1.9 | 10.1 | **12.6 deg** |
| drapes | 5.0 | 12.7 | **16.2 deg** |
| pipeline boundary | — | — | **13.4 deg** |
| pipeline footprints | — | — | **90.0 deg** |
| pipeline roads | — | — | **0.0 deg** (single-segment edges) |

So **four of the seven curve sites are gentle (16.2 deg or less) and
three are right-angled or worse**. A design that only handles gentle
curves fails the truss braces, the truss frames and every lot footprint.

- **`perpendicular`** — one ring per point, perpendicular to the
  central-difference tangent `writeTangents` already computes ("stays
  smooth through corners", `paths.ts:695`). The surface is continuous,
  but the cross-section thins by `cos(theta/2)`: at 96.3 deg on the
  braces that is **0.67**, a 33% pinch. Visible.
- **`miter`** — scale the ring by `1/cos(theta/2)` in the bend plane.
  Exact for a constant profile, one multiply, and it is what a real tube
  generator does. It self-intersects only when the miter half-width
  exceeds half the shorter segment. **Measured margins: braces
  0.03 x 1.495 = 0.045 against a minimum segment of 1.121 (25x); frames
  0.03 x 1.414 = 0.042 against 0.850 (20x).** Safe everywhere in the
  corpus, by a factor of twenty.
- **round or bevel joins** — more geometry, no consumer asking. Defer.

**So: `miter` by default, with a `miterLimit` that degrades to
`perpendicular` rather than self-intersecting.** The rig never reaches
the limit; a pathological input would.

A pleasant consequence worth stating: **the `extend` param of
`pathSegments` becomes unnecessary.** It exists purely as "the joint
filler" for the wedge-shaped gap between two independent instanced
cylinders (`paths.ts:446-452`). A swept surface is continuous and has no
gap. The rig sets `extend` on 9 of its 13 `pathSegments`; all 9 uses
disappear.

**The junction problem is different and is NOT solved.** Where three road
ribbons meet at a degree-3 centre (`pipeline-5-roads.json`, 10 edges over
9 points), v1 sweeps each polyline independently and the ribbons overlap.
That is what every per-polyline sweep and every mitered-stroke renderer
does by default — the geometry is generated one curve at a time, so a
shared endpoint is shared by coincidence rather than by construction — and
it is honest; solving it means a per-junction planar arrangement, which is
a different feature.
Document it in the node description.

### 6.4 Determinism

The hardest invariant in `CLAUDE.md`, so verify rather than assert. Four
separate claims, three of which check out and one of which needs a test:

1. **The sweep reads no seed and contains no randomness.** Its output is
   a pure function of `(input geometry, params)`. The `NodeDef` purity
   contract (`src/graph/node.ts:130-133`) is satisfied trivially.
2. **Time-partitioned cooking cannot reorder anything it sees.** "The
   executor yields AFTER `cookNode` returns, so a node body is atomic
   under a budget and a budget cannot reorder anything a node sees"
   (`tests/crossPartition.test.ts:26-31`). The corpus
   straight-through-versus-fully-partitioned determinism test covers it
   for free.
3. **Space-partitioned cooking is the real hazard, and the sweep adds
   ZERO of it** — *provided it computes no frame*. `writeCurveFrame`
   already documents the whole problem: "THE FRAME IS NOT LOCAL: a point
   normal depends on every point before it along its path, so this must
   run BEFORE anything that splits a path across cook cells or partitions
   it — the same curve arriving as two pieces gets two unrelated frames"
   (`paths.ts:794`). If `sweepProfile` *reads* a frame from point
   attributes instead of transporting one, the non-locality stays where
   it already is, in a node that already documents it. This is the
   strongest argument for the §4.3 design, and it is why the `upHint`
   default (purely local) and the `curveFrame` mode (inherits existing,
   documented non-locality) are both correct and neither is new exposure.
4. **Permutation equivariance is where a sweep could actually fail, and
   it needs a test.** Output element order must be a total function of
   (primitive index, vertex index within the primitive, profile index) —
   no `Map` or `Set` iteration order anywhere in the emit loop, and the
   ring stitching must not depend on which ring was built first.
   `tests/crossPartition.test.ts:6-11` calls this "the property every
   other one here rests on".

**Measured, not assumed: the closed-path seam is a non-issue in this
corpus.** `writeCurveFrame` warns that "a CLOSED path does not come back
seamless: transport around a loop returns rotated by a residual angle
(the holonomy of that curve)" (`paths.ts:794`). I transported the frame
around every closed polyline the corpus produces and measured the
residual: **truss rings 0.0000 deg (12 of them), pipeline boundary
0.0000 deg, pipeline footprints 0.0001 deg (55 of them).** All of them
are planar, and a rotation-minimizing frame on a planar loop keeps its
normal in the plane and returns exactly. A non-planar closed sweep would
show a twist in its last quad column; nothing in the corpus has one, and
the node description should say what would happen if it did.

One pre-existing exposure the sweep inherits without widening: a `circle`
profile computes `Math.cos` and `Math.sin`, which are not IEEE-specified
across engines. The library is already there — `quatFromEulerDeg`
(`util.ts:712`) and the `shape/ring` field expression
(`src/primitives/shape.ts:128-130`) both do it. **Named, not new, and not
a GPU parity risk because the sweep never runs on the device.**

### 6.5 GPU: the honest answer is no, and the reason is structural

**A sweep cannot be device-resident, and this is not an effort question.**

`ResidentDesc` requires it: "A resident-capable node must be
element-count-preserving on its single geometry input to single geometry
output" (`src/graph/node.ts:85-87`). The run executor data-flow design
rests on the same fact: attribute buffers are bound `read_write` and
mutated in place "because every kernel touches only element i slots"
(`src/gpu/run.ts:11-18`). A sweep multiplies the element count by N+1,
creates a primitive domain that did not exist, and writes three topology
arrays — and **no topology array is device-resident anywhere in
`src/gpu`**. `PLAN.md:222-254` records the same wall being hit by the
resident-filter survey for the milder case of a *count-reducing* node,
and killed it.

**What IS on the GPU: the field params.** `sweepProfile` and
`extrudePolygon` declare `gpu: "fields"`, exactly as `pathSegments` does
(`paths.ts:457`), and for exactly the reason it records: `radius`,
`width`, `roll` and `distance` all resolve on the **input** geometry
point domain, which the node never mutates because it builds a fresh
output — "so the resolver and the CPU fallback see identical bytes"
(`paths.ts:454-457`). Nothing new to argue.

**What happens to the attributes of a swept mesh if they are
field-driven?** They work, and they work on the device. The point domain
of a swept mesh is an ordinary point domain: a downstream `setAttribute`,
`transformPoints` or `jitterPoints` fuses into a resident run as usual,
because *those* nodes are count-preserving. The field grammar is about
per-element values, not topology (`CLAUDE.md`, Fields), so the boundary
is exactly where the grammar already draws it. The only thing that never
reaches the device is the topology-creating step itself.

**Fallback with a reason**: nothing to add. A sweep that cannot resolve
its radius on the device takes the existing per-node CPU path with the
existing machine-readable reason; the run planner never sees it because
it declares no `resident` kind, so it simply ends a run rather than
failing one.

### 6.6 Cost

**The rig, measured and then extrapolated. Extrapolations are marked.**

Sweepable path geometry across the 12 tube sites, with the drape filter
moved upstream of the sweep (§3.1a): **7 665 rings, 7 378 segments, 684
paths.**

At `sides = 8` (matching the shipped `tube` asset), with the uv seam
column duplicated (§6.2) and triangles rather than quads (§2.1):

| | today | swept, N=8 |
|---|---|---|
| output element count | 7 378 instances | **68 985 points, 118 048 primitives, 354 144 vertices** |
| point attributes (8 standard, 88 B) | — | **6.07 MB** |
| `vertexToPoint` | — | 1.42 MB |
| `primVertexStart` plus `primVertexCount` | — | 0.94 MB |
| `primtype` (u32 index column) | — | 0.47 MB |
| instance matrices (16 f32) | 0.47 MB | — |
| **total host bytes** | **about 0.5 MB** | **about 8.9 MB (19x)** |
| triangles the GPU draws | 7 378 x 32 = **236 096** | **118 048** |

That last row is the one that surprises: `tube` is
`CylinderGeometry(1, 1, 1, 8)` with caps
(`examples/shared/assets.ts:119`), so 32 triangles per instance.
**A swept surface renders HALF the triangles the instanced fake does**,
because it shares rings between segments and grows no caps. The trade is
honest and it is memory for continuity: 19x the host bytes, half the
drawn triangles, and a surface that is actually continuous instead of
7 378 overlapping cylinders.

**Draw calls are roughly unchanged**: 8 `spawnInstances` today produce
one `InstancedMesh` per (output, assetId); 12 sweeps produce one `Mesh`
per geometry item, and if the three `mergePoints` are deleted (§3.1b) a
few outputs become multi-item, so the count drifts from about 9 to about
20. Not a concern at this scale, and a topology-preserving union would
collapse it again.

**Cook time — ESTIMATED, not measured.** The rig cooks in **78 ms**
against a **10 000 ms** budget. `drapeDrapeTube` writes 10 032 segment
points in **5.4 ms**; the five tube `pathSegments` together cost about
9 ms. A sweep writes about 9x the points plus three topology arrays, so
**I expect the rig to land between 150 and 350 ms** — a 30x to 60x
margin. I have not measured it and cannot until it is built.

**What nothing notices.** `src/spatial` is points-only
(`uniformGrid.ts:26`, `:67`), so no spatial index grows. Bounds are
per-point attributes (`points.ts:16-25`), unchanged in shape. Nothing
downstream of a mesh in the corpus does a neighbourhood query.

**What might notice, and I have not measured it.** `corpusFingerprint`
hashes every attribute column, the topology arrays and every instance
transform (`tests/corpus.test.ts:69-73`), and the corpus determinism
tests cook each graph **twice** and fingerprint both. A 118 000-primitive
geometry makes that about 10 MB of hashing per cook, four times per
graph. **The measurement to take before step 5: run `tests/corpus.test.ts`
against a swept rig and read the wall clock, not the per-graph budget.**

**The pipeline is free**: about 808 new triangles against a 38 ms cook.

---

## 7. Staging

XS < 1h - S about half a day - M about 1-2d - L about 3-5d

Mirrors the split in `PLAN-field-params.md`: **steps 1-4 are one
shippable unit and land no corpus-golden churn beyond two new entries;
step 5 is the second unit and is where every existing golden moves.**

### Unit A — the capability (steps 1-4)

**Step 1 — `sweepProfile`.** `src/nodes/surfaces.ts` (new file, beside
`meshes.ts`): profile generation, frame resolution, miter, ring
stitching, caps, attribute carry, `normal` and `uv`. Reuses
`polylineArcTables` (`util.ts:595`), `orientQuat` (`util.ts:876`),
`requireReportSlot` (`util.ts:287`) and `createTriangleMesh`
(`geometry.ts:111`). **L.** Registered in `src/nodes/registerAll.ts` and
exported from `src/nodes/index.ts`. **XS.**

**Step 2 — the three-attribute bridge.** `toBufferGeometry` carries `uv`
(f32 tuple 2) — one helper beside `gatherVec3` (`convert.ts:326-332`),
plus a test that `toBufferGeometry` round-trips a `meshPrimitive` uv.
**S.** This is a bug fix that predates the sweep (§2.4) and should be
reviewed as one.

**Step 3 — `extrudePolygon`** in the same file: Newell normal, side
walls, fan-triangulated caps with consistent winding, open-path refusal.
**M.**

**Step 4 — `filterPrimitivesByAttribute`** in `src/nodes/filtering.ts`,
mirroring the `filterByAttribute` comparison enum over
`gatherPrimitives`. **S.** Plus two corpus graphs
(`basics-sweep-profile.json`, `basics-extrude-polygon.json`) and the
generated docs: `docs/nodes.{md,json}`, `docs/examples.*`, `llms.txt`,
and the `COUNT_CLAIMS` entries for "registered node types" (two, at
`src/docs/site.ts:284-295`) and "corpus graphs" (one, at `:320-328`).
**M.**

Tests through the unit: permutation equivariance and split-equals-whole
with a sweep in the chain (§6.4.4); ring count and triangle count against
a hand-derived formula; the miter geometry at 90 deg and at the limit;
`surfaceSample` on a swept tube (the §2.1 constraint, asserted rather
than assumed); attribute carry in both directions with a refused
collision; a closed path producing no seam ring; all four
open/closed/cap combinations. **M-L.**

**What Unit A unblocks the moment it lands**, without touching a single
existing graph: any author can put a surface on a curve; the 55
footprints and 64-point boundary in the pipeline become massing and a
wall in three node insertions; the `meshPrimitive` UVs reach a renderer.

### Unit B — the corpus (step 5, where the churn lands)

**Step 5a — the pipeline.** Insert `extrudePolygon` after `footprints`
and after `wall`, and `sweepProfile` (profile `ribbon`, width from the
promoted `roadJunction`) after `roadJunction`. Three new outputs across
`pipeline-3/4/5` and their `-edits` variants — **6 files**, all of which
are supersets of each other and must stay bit-identical stage to stage.
**M.**

**Step 5b — the rig.** Replace 12 of 13 `pathSegments` with
`sweepProfile`; delete 9 `extend` settings; move `drapeLong` and
`drapeSome` upstream of the sweep as `filterPrimitivesByAttribute`;
delete `trussChords`, `trussBraces` and `wrapMerged`; rewrite the
`meta.description`, which currently states the gap this plan closes
("Nothing is drawn as a surface — the library has no sweep or extrude").
Every instance-shaped golden entry becomes a geometry-shaped one. **L.**

**Step 5c — primitives.** `shape/tube-along-curve` and
`shape/massing-from-footprint` in `src/primitives`, which moves the three
"named primitives" `COUNT_CLAIMS` (`site.ts:296-313`) and
`docs/primitives.*`. **S.**

**Step 5d — regenerate** `tests/corpus.golden.json` and re-time the suite
against the §6.6 concern. **S.**

Unit A is about 12 files. Unit B is about 14 more, and every corpus
golden moves in it.

---

## 8. Open questions for the user

1. **Does the rig rewire land in this unit or the next?** It is the value
   case — it is the graph whose own `meta.description` names this gap —
   and it is where every golden moves. `PLAN-field-params.md` faced the
   identical question about the primitive cleanup and split it out; the
   same split is proposed here, but it is a call.

2. **Copy all input point attributes around every ring, or only a named
   list?** §6.1 recommends copy-all with `removeAttribute` as the
   documented escape, because a silent exception list is the failure mode
   this library refuses. The cost is about 6 MB of mostly-dead standard
   columns on the swept rig. If that is unacceptable, the alternative is
   a `carry` param, and it should be decided before the node ships rather
   than added after — changing the default later moves every golden a
   second time.

3. **Normalized `u`, or world arc length?** §6.2 recommends normalized,
   matching `meshPrimitive`, `curveU` and `fraction`. World length is
   what a tiled texture on a 34-unit chord actually wants. A `uvScale`
   param makes the question go away and adds a knob.

4. **Is `filterPrimitivesByAttribute` in scope, or does the drape branch
   just do 7.24x the work in v1?** It is small and independently useful,
   but it is a third node type in a plan that claims to add two.

5. **Is `sides = 8` the right default?** It matches the shipped `tube`
   asset exactly (`examples/shared/assets.ts:119`), so the swept rig
   looks like the instanced rig it replaces. A higher default looks
   better and costs linearly.

### What I would measure before committing to any of it

- **Cook time of a swept rig.** The 150-350 ms in §6.6 is an
  extrapolation from the 5.4 ms of `drapeDrapeTube`, not a measurement.
  It is the number in this document most likely to be wrong.
- **`tests/corpus.test.ts` wall clock** with a 118 000-primitive geometry
  in it, cooked four times and fingerprinted. The per-graph 10 s budget
  is not the binding constraint; the total suite runtime might be.
- **Whether the `pathResample` ring density is the right sweep density.**
  The rig resamples to 46, 130, 150 and 900 points for reasons chosen for
  *instances*, not for the silhouette of a surface. Some of those numbers
  are probably wrong now, in both directions.
- **Whether a swept `ribbon` on the boundary loop actually reads as a
  wall** at the pipeline scale, or whether a wall wants `extrudePolygon`
  on an offset polygon — which the library cannot do, because it has no
  polygon offset. If it is the latter, the pipeline wall stays 82 posts
  and only the footprints and roads benefit.
