# Example corpus

Generated from the graphs in [`examples/graphs`](../examples/graphs) by `node scripts/gen-examples.mjs` — do not edit by hand. The same index, machine-readable, is in [examples.json](./examples.json). For the graph JSON format see [authoring.md](./authoring.md); for the node types these graphs use, [nodes.md](./nodes.md); for the primitives they reference, [primitives.md](./primitives.md).

Each file teaches ONE thing and cooks from JSON alone — no runtime-injected data, so `pcg cook <file>` on a clean install reproduces exactly what the corpus test asserts.

35 examples, alphabetical by file:

- [basics-attribute-from-noise.json](#basics-attribute-from-noisejson) — write an attribute from a noise field
- [basics-attribute-remap.json](#basics-attribute-remapjson) — rescale an attribute to a new range
- [basics-compose-primitives.json](#basics-compose-primitivesjson) — compose several primitives into a scatter
- [basics-even-spacing.json](#basics-even-spacingjson) — enforce a minimum distance between points
- [basics-filter-by-attribute.json](#basics-filter-by-attributejson) — keep points by an attribute comparison
- [basics-filter-by-density.json](#basics-filter-by-densityjson) — thin a cloud by the density attribute
- [basics-filter-by-expression.json](#basics-filter-by-expressionjson) — keep points with a predicate expression
- [basics-jitter-points.json](#basics-jitter-pointsjson) — break up a lattice with deterministic jitter
- [basics-merge-points.json](#basics-merge-pointsjson) — concatenate two clouds into one
- [basics-mesh-primitive.json](#basics-mesh-primitivejson) — build a mesh a saved graph can cook
- [basics-neighborhood-count.json](#basics-neighborhood-countjson) — measure how crowded each point is
- [basics-orient-along-path.json](#basics-orient-along-pathjson) — turn a path's own points to follow it
- [basics-orient-along-vector.json](#basics-orient-along-vectorjson) — turn each point to face a direction
- [basics-partition-by-attribute.json](#basics-partition-by-attributejson) — split one cloud into labelled groups
- [basics-path-resample.json](#basics-path-resamplejson) — even out the spacing along a path
- [basics-paths-by-group.json](#basics-paths-by-groupjson) — cut one cloud into several separate paths
- [basics-point-grid.json](#basics-point-gridjson) — place points on a regular grid
- [basics-points-to-path.json](#basics-points-to-pathjson) — build a path from a point cloud
- [basics-primitive-ref.json](#basics-primitive-refjson) — reference a shipped primitive by name
- [basics-promote-attribute.json](#basics-promote-attributejson) — move an attribute between domains
- [basics-props-along-a-path.json](#basics-props-along-a-pathjson) — space props evenly along a curve
- [basics-scatter-in-bounds.json](#basics-scatter-in-boundsjson) — scatter points in a box
- [basics-scatter-in-world.json](#basics-scatter-in-worldjson) — scatter points anchored to the world, not to the box
- [basics-spawn-by-species.json](#basics-spawn-by-speciesjson) — spawn a different asset per point
- [basics-spawn-instances.json](#basics-spawn-instancesjson) — turn points into instance batches
- [basics-subgraph-exposed-params.json](#basics-subgraph-exposed-paramsjson) — wrap a graph as one node with its own knobs
- [basics-surface-sample.json](#basics-surface-samplejson) — scatter points over a mesh surface
- [basics-transfer-attribute.json](#basics-transfer-attributejson) — read a value off a surface below each point
- [basics-transform-points.json](#basics-transform-pointsjson) — move, turn and size a whole cloud
- [pipeline-1-boundary.json](#pipeline-1-boundaryjson) — staged pipeline 1/4 — the ground and the wall
- [pipeline-2-districts.json](#pipeline-2-districtsjson) — staged pipeline 2/4 — district centres and the field they claim
- [pipeline-3-lots-edits.json](#pipeline-3-lots-editsjson) — staged pipeline 3/4, edited — hand-placed plots that win on priority
- [pipeline-3-lots.json](#pipeline-3-lotsjson) — staged pipeline 3/4 — a street, its frontage band, and lot footprints
- [pipeline-4-detail-edits.json](#pipeline-4-detail-editsjson) — staged pipeline 4/4, edited — the full settlement with authored plots
- [pipeline-4-detail.json](#pipeline-4-detailjson) — staged pipeline 4/4 — buildings, wall posts and forest

## basics-attribute-from-noise.json

**write an attribute from a noise field**

A field-capable param takes a field expression instead of a constant: `setAttribute`'s `value` here is four octaves of Perlin fBm, resolved once per point and stored into a new `height` attribute. `normalized: true` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own `seed` inside the spec — the graph seed does not move the pattern, only `opts.seed` or the sample position does.

**Tags:** `basics`, `fields`, `noise`, `attributes`

**Seed:** 1003

**Node types:** `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `height`.`out`)

Cook it: `pcg cook examples/graphs/basics-attribute-from-noise.json --stats`

## basics-attribute-remap.json

**rescale an attribute to a new range**

`attributeRemap` in mode 'fit' measures an attribute's actual minimum and maximum over the domain and stretches them onto [outMin, outMax], which is how a quantity of unknown scale — a raw noise value, a neighbour count, an invented score — becomes something a density or a colour can consume. `outName` writes the result beside the original instead of over it, so both columns survive for inspection.

**Tags:** `basics`, `attributes`, `remap`

**Seed:** 1004

**Node types:** `attributeRemap`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `fit`.`out`)

Cook it: `pcg cook examples/graphs/basics-attribute-remap.json --stats`

## basics-compose-primitives.json

**compose several primitives into a scatter**

Four primitives and one terminal node build a complete placement pass: scatter with a guaranteed spacing, cut it to noise-defined regions, turn every point a random way, give every point one uniform random size, then spawn. Each step is a name from the catalog rather than a hand-built cluster of nodes, which is what keeps the graph readable and its behaviour documented. Note what varies: the scatter and the two write steps differ per instance, while the noise mask does not — two masks with the same params cut identically unless their `variant` differs.

**Tags:** `basics`, `primitives`, `composition`, `spawn`

**Seed:** 1023

**Node types:** `spawnInstances`, `subgraph`

**Primitives:** `fill/scatter-even`, `filter/mask-by-noise`, `write/random-scale`, `write/random-yaw`

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook examples/graphs/basics-compose-primitives.json --stats`

## basics-even-spacing.json

**enforce a minimum distance between points**

`selfPrune` scans points in index order and keeps one only when every already-kept point is at least `minDistance` away, which turns a clumpy uniform scatter into evenly spaced points for anything with physical extent. Over-scatter deliberately: the output count is emergent, capped by the area divided by minDistance squared, so raising `count` past that adds nothing and the real knob is `minDistance`.

**Tags:** `basics`, `filter`, `spacing`

**Seed:** 1008

**Node types:** `pointScatterInBounds`, `selfPrune`

**Primitives:** *(none)*

**Outputs:** `points` (from `prune`.`out`)

Cook it: `pcg cook examples/graphs/basics-even-spacing.json --stats`

## basics-filter-by-attribute.json

**keep points by an attribute comparison**

The first of the three ways to remove points: write a scalar column, then compare it. `filterByAttribute` tests one named point attribute against `value` with one of eq/ne/lt/le/gt/ge and keeps the survivors with every attribute carried. The scratch column stays on the output — `removeAttribute` is what takes it off again — which is the cost this idiom pays and `filterByExpression` avoids.

**Tags:** `basics`, `filter`, `attributes`

**Seed:** 1005

**Node types:** `filterByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `ridge`.`out`)

Cook it: `pcg cook examples/graphs/basics-filter-by-attribute.json --stats`

## basics-filter-by-density.json

**thin a cloud by the density attribute**

The standard thinning idiom: write the standard `density` attribute from a 0..1 noise field, then let `filterByDensity` in mode 'probabilistic' keep each point with probability equal to its own density. The result is soft-edged — dense regions stay full, sparse ones fade out, with no visible boundary. Mode 'threshold' on the same input gives the hard-edged version instead.

**Tags:** `basics`, `filter`, `density`, `noise`

**Seed:** 1007

**Node types:** `filterByDensity`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `thin`.`out`)

Cook it: `pcg cook examples/graphs/basics-filter-by-density.json --stats`

## basics-filter-by-expression.json

**keep points with a predicate expression**

`filterByExpression` decides per point from a field expression, so a test that would otherwise need a scratch attribute plus a comparison node becomes one node with no leftover column. The comparison functions emit 1 and 0, `mul` combines them as AND (and `max` as OR): this predicate keeps points inside a radius of 20 AND where a value-noise field rises above 0.4. NaN never passes, so a predicate that fails to compute drops the point.

**Tags:** `basics`, `filter`, `fields`, `predicate`

**Seed:** 1006

**Node types:** `filterByExpression`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `keep`.`out`)

Cook it: `pcg cook examples/graphs/basics-filter-by-expression.json --stats`

## basics-jitter-points.json

**break up a lattice with deterministic jitter**

`jitterPoints` offsets each point by a random vector drawn per axis from (seed, point index, axis), so the result is reproducible and independent of cook order — the lattice stops reading as a lattice without giving up determinism. `amount` is the maximum offset per axis and is field-capable, so the jitter can itself vary across space; here y is left at 0 to keep the cloud flat.

**Tags:** `basics`, `jitter`, `determinism`

**Seed:** 1009

**Node types:** `jitterPoints`, `pointGrid`

**Primitives:** *(none)*

**Outputs:** `points` (from `jitter`.`out`)

Cook it: `pcg cook examples/graphs/basics-jitter-points.json --stats`

## basics-merge-points.json

**concatenate two clouds into one**

`mergePoints` has a multi input: every connected geometry is concatenated in connection order into a single point cloud. The output carries the union of all point attributes — one missing on an input fills with its default over that input's range — and attributes sharing a name must agree on type and tuple size, so a scratch column left on one side can break a merge that used to work. Topology is not carried: the result is points only.

**Tags:** `basics`, `merge`, `compose`

**Seed:** 1016

**Node types:** `mergePoints`, `pointGrid`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `both`.`out`)

Cook it: `pcg cook examples/graphs/basics-merge-points.json --stats`

## basics-mesh-primitive.json

**build a mesh a saved graph can cook**

`meshPrimitive` is the only mesh source that survives serialization — `dataInput`'s items are injected at runtime and a saved graph carries none — so a graph that must cook from JSON alone gets its surface from here. The output carries P and a `uv` point attribute, plus one three-vertex 'poly' primitive per triangle: exactly the topology `surfaceSample`, `promoteAttribute`, and the 'uv' and 'raycast' transfer mappings need.

**Tags:** `basics`, `mesh`, `source`, `serialization`

**Seed:** 1012

**Node types:** `meshPrimitive`

**Primitives:** *(none)*

**Outputs:** `mesh` (from `ground`.`out`)

Cook it: `pcg cook examples/graphs/basics-mesh-primitive.json --stats`

## basics-neighborhood-count.json

**measure how crowded each point is**

`pointNeighborhood` writes how many other points lie within `radius` into a u32 attribute, using a uniform spatial grid so it stays fast well beyond a few thousand points. The count is a measured quantity rather than an authored one, which is what a later filter, colour or scale can react to. A point with no neighbours gets 0 and keeps its own value as the neighbour average, so a displacement built from that average is zero rather than undefined.

**Tags:** `basics`, `attributes`, `neighborhood`, `measure`

**Seed:** 1018

**Node types:** `pointNeighborhood`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `crowding`.`out`)

Cook it: `pcg cook examples/graphs/basics-neighborhood-count.json --stats`

## basics-orient-along-path.json

**turn a path's own points to follow it**

A path built by `pointsToPath` carries no `tangent` — only a sampler writes one, for the points it created — so `orientAlongVector` has nothing to read. `writeTangents` supplies it, from the normalized central difference between each point's neighbours along the polyline, which stays smooth through corners and wraps on a closed path. Both nodes keep the points, their attributes and the topology exactly as they arrived, so the `width` column written before the path was built is still on the output after the rotation: that is the whole difference from `place/along-curve`, which resamples and hands back new points carrying none of it. Run the pair BEFORE any filter — every filter drops topology, and `writeTangents` would then find no paths.

**Tags:** `basics`, `path`, `rotation`, `attributes`

**Seed:** 1026

**Node types:** `orientAlongVector`, `pointsToPath`, `setAttribute`, `subgraph`, `writeTangents`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `face`.`out`)

Cook it: `pcg cook examples/graphs/basics-orient-along-path.json --stats`

## basics-orient-along-vector.json

**turn each point to face a direction**

`orientAlongVector` writes the standard `rot` quaternion so a chosen local axis points along `direction`, with `up` fixing the roll. `direction` is field-capable and resolved per point, so an expression is what makes each point face somewhere different: here `vec(P.x, 0, P.z)` points every point radially away from the origin. A zero-length direction leaves that point's rotation alone rather than inventing one.

**Tags:** `basics`, `transform`, `rotation`, `fields`

**Seed:** 1011

**Node types:** `orientAlongVector`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `face`.`out`)

Cook it: `pcg cook examples/graphs/basics-orient-along-vector.json --stats`

## basics-partition-by-attribute.json

**split one cloud into labelled groups**

`partitionByAttribute` splits the input into one point cloud per distinct value of an i32, u32 or string attribute, so a single declared output holds several geometry items rather than one. Groups arrive in order of each value's first occurrence and each is tagged `<name>=<value>`, which is how a downstream node or a host routes them apart. The labels here come from a string `setAttribute` whose `value` acts as a per-point selector into `values`.

**Tags:** `basics`, `attributes`, `partition`, `routing`

**Seed:** 1017

**Node types:** `partitionByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `groups` (from `groups`.`out`)

Cook it: `pcg cook examples/graphs/basics-partition-by-attribute.json --stats`

## basics-path-resample.json

**even out the spacing along a path**

`pathResample` walks each polyline's own arc length and places new points at even steps along it, which is a different operation from thinning a cloud: `selfPrune` keeps a subset of the points it was handed, while this creates points that were never there. The ellipse shows why it is needed — `shape/ring` spaces its points evenly in ANGLE, and on anything that is not a circle that leaves them bunched at the two ends of the long axis. `count` mode places exactly that many samples on every path whatever its length, and on a closed one they divide it without duplicating the start, so every step here comes out equal; `spacing` mode steps a fixed number of world units instead, so a longer path simply gets more points. The output is still a path and a closed one comes back closed, but the points are new: they carry `tangent` and `curveU`, and nothing written on the input's points is carried across.

**Tags:** `basics`, `path`, `resample`, `spacing`

**Seed:** 1025

**Node types:** `pathResample`, `pointsToPath`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `even`.`out`)

Cook it: `pcg cook examples/graphs/basics-path-resample.json --stats`

## basics-paths-by-group.json

**cut one cloud into several separate paths**

With `groupAttr` set, `pointsToPath` splits the cloud by a whole-number point attribute and emits one polyline per distinct id, in ascending id — four rows here become four independent paths over the same 40 points, not one path zig-zagging between them. The ids come from a `setAttribute` of type i32 reading world Z, which is what keeps the grouping a property of the geometry rather than a hardcoded list. Within a group the points are visited in input index order; `orderAttr` is the companion knob when that order is not the one the path should follow, and its ties always break to the lower index so the result never depends on the sort.

**Tags:** `basics`, `path`, `groups`, `attributes`

**Seed:** 1027

**Node types:** `pointGrid`, `pointsToPath`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `paths` (from `paths`.`out`)

Cook it: `pcg cook examples/graphs/basics-paths-by-group.json --stats`

## basics-point-grid.json

**place points on a regular grid**

The deterministic counterpart to scattering: `pointGrid` places countX * countY * countZ points stepped by `spacing` from `origin`, in X-fastest order. There is no randomness at all here — the same params always give the same positions, which makes a grid the right starting cloud when the variation should come from a later node rather than from the source.

**Tags:** `basics`, `grid`, `source`

**Seed:** 1002

**Node types:** `pointGrid`

**Primitives:** *(none)*

**Outputs:** `points` (from `grid`.`out`)

Cook it: `pcg cook examples/graphs/basics-point-grid.json --stats`

## basics-points-to-path.json

**build a path from a point cloud**

`pointsToPath` is the only way a saved graph can produce polyline geometry: it lays one `polyline` primitive over the points it was given, so the points and every attribute on them survive untouched and only topology is added. Visiting order is the input's point order unless `orderAttr` names a sort key. `closed` appends a trailing vertex referencing the first point — closure is structural, not a flag, so a closed path over 12 points has 13 vertices and there is no duplicated seam point to trip over. `shape/path-loop` is exactly this pair of nodes under one name.

**Tags:** `basics`, `path`, `topology`, `source`

**Seed:** 1024

**Node types:** `pointsToPath`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `path`.`out`)

Cook it: `pcg cook examples/graphs/basics-points-to-path.json --stats`

## basics-primitive-ref.json

**reference a shipped primitive by name**

Instead of embedding a copy of a subgraph, a node can name one from the shipped vocabulary: `ref: { name }` resolves against the registry, which is populated by importing `pcg-ts/primitives` (the `pcg` CLI does it for you). Prefer this over rebuilding the same four nodes by hand — the catalog in docs/primitives.md documents each primitive's real behaviour, including what varies per instance. A `ref` may also carry an optional `hash` to pin the exact content it was authored against; without one it always resolves to the library's current version.

**Tags:** `basics`, `primitives`, `vocabulary`, `ref`

**Seed:** 1022

**Node types:** `subgraph`

**Primitives:** `fill/scatter-even`

**Outputs:** `points` (from `trees`.`out`)

Cook it: `pcg cook examples/graphs/basics-primitive-ref.json --stats`

## basics-promote-attribute.json

**move an attribute between domains**

Attributes live on domains — point, vertex, primitive, detail — and `promoteAttribute` walks the geometry's topology to move one between them. Here a per-point `height` becomes a per-triangle `height` by averaging the corners, which is what a shader or an exporter that colours faces rather than corners needs. Elements with no contributors keep the attribute default, and string attributes support only mode 'first'.

**Tags:** `basics`, `attributes`, `domains`, `promote`

**Seed:** 1015

**Node types:** `meshPrimitive`, `promoteAttribute`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `mesh` (from `perFace`.`out`)

Cook it: `pcg cook examples/graphs/basics-promote-attribute.json --stats`

## basics-props-along-a-path.json

**space props evenly along a curve**

Two primitives cover the whole road-and-lamp-posts shape: `shape/path-meander` is a curve SOURCE — an open path that wanders off a straight line by noise and is re-evened by arc length, needing no cloud to start from — and `place/along-curve` resamples it and turns every new point to face the way the curve goes, so a `spacing` of 6 means a post every 6 world units however long the road turns out to be. The points `place/along-curve` emits are new ones carrying `P`, `tangent`, `curveU` and `rot`; when the curve's own points matter instead, `write/orient-along-path` orients them in place. Note what varies: the meander carries its noise seed inside a field spec, so `variant` is its only re-roll.

**Tags:** `basics`, `primitives`, `path`, `placement`

**Seed:** 1028

**Node types:** `spawnInstances`, `subgraph`

**Primitives:** `place/along-curve`, `shape/path-meander`

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook examples/graphs/basics-props-along-a-path.json --stats`

## basics-scatter-in-bounds.json

**scatter points in a box**

The smallest complete graph: one source node fills an axis-aligned box with a fixed count of points. Nothing is connected and nothing is filtered, so the output count is exactly `count`. Every point already carries the standard attributes (P, rot, scale, density, boundsMin, boundsMax, color, seed) whether the graph writes them or not, which is why later examples can filter on `density` without creating it first.

**Tags:** `basics`, `scatter`, `source`

**Seed:** 1001

**Node types:** `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `scatter`.`out`)

Cook it: `pcg cook examples/graphs/basics-scatter-in-bounds.json --stats`

## basics-scatter-in-world.json

**scatter points anchored to the world, not to the box**

The same shape of graph as 'scatter points in a box', with the one difference that makes a region streamable: `pointScatterInWorld` computes each point from its own lattice cell and index, so the box only says which points to RETURN. Widen it, move it, or ask for it in four pieces and every point that was already there stays exactly where it was, with the same per-point seed — `pointScatterInBounds` derives positions FROM the bounds and moves all 500 of them when the box moves an inch. Population is `density * area`: at 0.05 points per square unit over an 80x80 window that is 320 points, predictable without cooking, with `cellSize` deciding only how evenly they clump. The clip is half-open, so abutting windows tile the world with no gap and no duplicate — which is why a cell can derive its own halo by simply asking for a wider box.

**Tags:** `basics`, `scatter`, `source`, `streaming`

**Seed:** 1029

**Node types:** `pointScatterInWorld`

**Primitives:** *(none)*

**Outputs:** `points` (from `scatter`.`out`)

Cook it: `pcg cook examples/graphs/basics-scatter-in-world.json --stats`

## basics-spawn-by-species.json

**spawn a different asset per point**

A string `setAttribute` with a non-empty `values` list turns its field-capable `value` into a per-point selector — floor, then clamp into range, NaN picks 0 — so weighting by repetition works: 'pine' twice in four entries is half the points. Pointing `spawnInstances`' `assetAttr` at that attribute splits the output into one batch per asset id, in first-occurrence order, with no per-point branching anywhere in the graph.

**Tags:** `basics`, `spawn`, `instancing`, `strings`

**Seed:** 1020

**Node types:** `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook examples/graphs/basics-spawn-by-species.json --stats`

## basics-spawn-instances.json

**turn points into instance batches**

`spawnInstances` is a terminal: it converts a point cloud into render-agnostic instance batches, one 4x4 world matrix per point composed as T(P) * R(rot) * S(scale) from the standard attributes. Points group into one batch per asset id. The node has two output pins — `instances` for the batches and `points`, which passes the input through unchanged for chaining or debug rendering — and this graph declares only the first.

**Tags:** `basics`, `spawn`, `instancing`

**Seed:** 1019

**Node types:** `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook examples/graphs/basics-spawn-instances.json --stats`

## basics-subgraph-exposed-params.json

**wrap a graph as one node with its own knobs**

A `subgraph` node carries an inner graph plus the pins and params it exposes, so a reusable piece becomes a single node with a deliberately small interface. Declarations live in the payload and VALUES live in the node's own `params`, exactly as a standard node keeps its schema in the registry and its value on the node. A declaration may not carry `type`, `enum` or `acceptsField` — those are re-derived from the targets' registered schemas, so a payload cannot claim a capability the inner params do not have.

**Tags:** `basics`, `subgraph`, `composition`, `params`

**Seed:** 1021

**Node types:** `pointScatterInBounds`, `selfPrune`, `subgraph`

**Primitives:** *(none)*

**Outputs:** `points` (from `grove`.`out`)

Cook it: `pcg cook examples/graphs/basics-subgraph-exposed-params.json --stats`

## basics-surface-sample.json

**scatter points over a mesh surface**

`surfaceSample` picks each candidate's triangle with probability proportional to its area and then a uniform position inside it, so coverage is even in world units rather than per triangle. Output points carry P, the flat per-triangle `normal`, density 1 and a hashed per-point seed. `densityField` is field-capable and applied after placement, so the count is at most `count` and exactly `count` while density stays 1.

**Tags:** `basics`, `mesh`, `sampler`, `placement`

**Seed:** 1013

**Node types:** `meshPrimitive`, `surfaceSample`

**Primitives:** *(none)*

**Outputs:** `points` (from `onSurface`.`out`)

Cook it: `pcg cook examples/graphs/basics-surface-sample.json --stats`

## basics-transfer-attribute.json

**read a value off a surface below each point**

`transferAttribute` copies an attribute from its `source` geometry onto the main input's points. Mapping 'raycast' casts a ray from each point along `direction` and interpolates the value at the nearest forward hit, which is how a scattered cloud reads the terrain under it. A point whose ray hits nothing keeps the value it already had — never an invented one — and `missCountAttr` records how many missed as a detail attribute so a graph can assert on it.

**Tags:** `basics`, `transfer`, `mesh`, `raycast`

**Seed:** 1014

**Node types:** `meshPrimitive`, `pointScatterInBounds`, `setAttribute`, `transferAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `sampleDown`.`out`)

Cook it: `pcg cook examples/graphs/basics-transfer-attribute.json --stats`

## basics-transform-points.json

**move, turn and size a whole cloud**

`transformPoints` applies P' = R * (scale * P) + translate about the world origin, with `rotateEuler` in degrees extrinsic XYZ. It composes with the per-point transform attributes rather than replacing them: `rot` becomes R * rot and `scale` multiplies componentwise, so transforming a cloud that already carries orientations keeps them. All three params are field-capable, which is how one node can taper or twist a cloud instead of moving it rigidly.

**Tags:** `basics`, `transform`

**Seed:** 1010

**Node types:** `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `place`.`out`)

Cook it: `pcg cook examples/graphs/basics-transform-points.json --stats`

## pipeline-1-boundary.json

**staged pipeline 1/4 — the ground and the wall**

First step of a settlement-scale pipeline whose four stages are four files, each the previous file plus new nodes, connections and outputs — nothing removed, no param retuned, one shared seed. This stage ADDS the two things every later stage stands on: a subdivided plane pushed into rolling terrain by a noise field (`terrain`), and a 64-point ring displaced along its own radius and closed into a path with tangents written on it (`boundary`). Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `terrain`, `path`

**Seed:** 40100

**Node types:** `meshPrimitive`, `pointsToPath`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `shape/ring`, `transform/displace-by-noise`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`)

Cook it: `pcg cook examples/graphs/pipeline-1-boundary.json --stats`

## pipeline-2-districts.json

**staged pipeline 2/4 — district centres and the field they claim**

Stage 1 verbatim, plus a district layer. ADDS `districts`: a 34x34 grid masked to a disc and dropped onto the terrain, with every surviving cell told which district owns it. The centres come from a separate scatter thinned by `selfPrune`, numbered with an i32 `district` and given a string `districtKind`; `sampleNearestPoint` then writes the owning index, the distance to it and the kind onto each cell. `terrain` and `boundary` cook bit-identically to stage 1 — nothing upstream was touched. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `sampling`, `attributes`

**Seed:** 40100

**Node types:** `filterByExpression`, `meshPrimitive`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`)

Cook it: `pcg cook examples/graphs/pipeline-2-districts.json --stats`

## pipeline-3-lots-edits.json

**staged pipeline 3/4, edited — hand-placed plots that win on priority**

`pipeline-3-lots.json` verbatim, plus an authored edit layer: a `pointLine` terrace and a `pointGrid` block dropped onto the same terrain, stamped `locked = 1`, and wired into the edit slot the base reserved — ONE connection is the whole edit. It lands twice: as the `features` of a `filter/by-distance-to` that keeps procedural lots 3 units clear of it, and on pin `b` of `compose/merge-tagged`, which appends the authored points AFTER the procedural ones at the HIGHEST indices — the worst place an index-greedy prune could put them. They take every contested spot anyway, because `selfPrune` ranks by `priority: attribute("locked")`: higher wins, ties fall to the lower index, so the 12 authored points are visited first and the procedural ones prune against them. Survival is a value the points carry, not a position in a merge — drop the `priority` param and 8 of the 12 lose their spots to procedural neighbours; move the edit back to pin `a` and the same 12 survive. The point of the variant: `terrain`, `boundary` and `districts` cook bit-identically to the base while `lots` and `footprints` change — the edit is provably local.

**Tags:** `pipeline`, `staged`, `edits`, `authoring`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`, `write/random-scale`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`)

Cook it: `pcg cook examples/graphs/pipeline-3-lots-edits.json --stats`

## pipeline-3-lots.json

**staged pipeline 3/4 — a street, its frontage band, and lot footprints**

Stages 1-2 verbatim, plus building plots. ADDS `lots` and `footprints`: the district centres are ordered by bearing and closed into a spine street, the district field is cut to a frontage band (within 11 of the street, at least 4 off it), each survivor is turned to face the nearest street sample and given a random size, and `selfPrune` spaces them 7 apart. A 4-corner ring copied onto every lot and grouped by `lotId` becomes one closed quad per plot. Note the reserved EDIT SLOT: `edits` is a `mergePoints` with nothing connected, so it cooks to an empty cloud that clears nothing and merges nothing — see the `-edits` variant, which is this file plus authored geometry and one connection. The slot comes with a RANK as well as a wire: procedural lots are stamped `locked = 0` on their way into the merge and the prune reads `priority: attribute("locked")`, so a point arriving through the slot at 1 outranks every procedural neighbour it contests. Here nothing arrives, every point ties at 0, and the prune is exactly the index-greedy one it has always been — which is what `priority`'s default is for. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `path`, `placement`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`, `write/random-scale`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`)

Cook it: `pcg cook examples/graphs/pipeline-3-lots.json --stats`

## pipeline-4-detail-edits.json

**staged pipeline 4/4, edited — the full settlement with authored plots**

`pipeline-4-detail.json` verbatim plus the same authored edit layer `pipeline-3-lots-edits.json` adds, so it is a superset of BOTH. It is the whole point of the arrangement: `terrain`, `boundary` and `districts` stay bit-identical to the unedited stage 4, while `lots`, `footprints`, `buildings` and everything downstream of them respond to the hand-placed geometry. An edit reaches exactly as far as the dependency graph says it does, and no further.

**Tags:** `pipeline`, `staged`, `edits`, `spawn`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`)

Cook it: `pcg cook examples/graphs/pipeline-4-detail-edits.json --stats`

## pipeline-4-detail.json

**staged pipeline 4/4 — buildings, wall posts and forest**

Stages 1-3 verbatim, plus everything that gets drawn. ADDS `buildings` (one asset per lot, chosen per point and spawned), `props` (posts spaced every 6 units along the boundary wall and turned to follow it) and `vegetation` (plantable scatter on the terrain, cut to the ground outside the wall, yawed at random and split into species batches). Every earlier output — `terrain`, `boundary`, `districts`, `lots`, `footprints` — is bit-identical to the stage that introduced it. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `spawn`, `instancing`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`)

Cook it: `pcg cook examples/graphs/pipeline-4-detail.json --stats`
