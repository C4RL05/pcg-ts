# Example corpus

Generated from the graphs in [`graphs`](../graphs) by `node scripts/gen-graphs.mjs` — do not edit by hand. The same index, machine-readable, is in [graphs.json](./graphs.json). For the graph JSON format see [authoring.md](./authoring.md); for the node types these graphs use, [nodes.md](./nodes.md); for the primitives they reference, [primitives.md](./primitives.md).

Each file teaches ONE thing and cooks from JSON alone — no runtime-injected data, so `pcg cook <file>` on a clean install reproduces exactly what the corpus test asserts.

54 examples, alphabetical by file:

- [basics-attribute-from-noise.json](#basics-attribute-from-noisejson) — write an attribute from a noise field
- [basics-attribute-remap.json](#basics-attribute-remapjson) — rescale an attribute to a new range
- [basics-compose-primitives.json](#basics-compose-primitivesjson) — compose several primitives into a scatter
- [basics-copy-to-points.json](#basics-copy-to-pointsjson) — give every copy the attributes of the point it landed on
- [basics-even-spacing.json](#basics-even-spacingjson) — enforce a minimum distance between points
- [basics-extrude-polygon.json](#basics-extrude-polygonjson) — turn a footprint into massing
- [basics-field-params.json](#basics-field-paramsjson) — read a field's shaping numbers from a knob
- [basics-filter-by-attribute.json](#basics-filter-by-attributejson) — keep points by an attribute comparison
- [basics-filter-by-density.json](#basics-filter-by-densityjson) — thin a cloud by the density attribute
- [basics-filter-by-expression.json](#basics-filter-by-expressionjson) — keep points with a predicate expression
- [basics-filter-primitives-by-attribute.json](#basics-filter-primitives-by-attributejson) — keep whole primitives by an attribute comparison
- [basics-foreach-per-group.json](#basics-foreach-per-groupjson) — treat each group on its own
- [basics-gather-on-path.json](#basics-gather-on-pathjson) — gather evenly spaced points into clumps along a curve
- [basics-inline-field-params.json](#basics-inline-field-paramsjson) — put a field's shaping numbers on knobs without a wrapper
- [basics-jitter-points.json](#basics-jitter-pointsjson) — break up a lattice with deterministic jitter
- [basics-mask-by-species.json](#basics-mask-by-speciesjson) — let a string attribute drive a field
- [basics-merge-points.json](#basics-merge-pointsjson) — concatenate two clouds into one
- [basics-merge-primitives.json](#basics-merge-primitivesjson) — join an authored path to a generated network
- [basics-mesh-primitive.json](#basics-mesh-primitivejson) — build a mesh a saved graph can cook
- [basics-neighborhood-count.json](#basics-neighborhood-countjson) — measure how crowded each point is
- [basics-orient-along-path.json](#basics-orient-along-pathjson) — turn a path's own points to follow it
- [basics-orient-along-vector.json](#basics-orient-along-vectorjson) — turn each point to face a direction
- [basics-partition-by-attribute.json](#basics-partition-by-attributejson) — split one cloud into labelled groups
- [basics-path-resample.json](#basics-path-resamplejson) — even out the spacing along a path
- [basics-path-segments.json](#basics-path-segmentsjson) — draw a curve as solid geometry
- [basics-paths-by-group.json](#basics-paths-by-groupjson) — cut one cloud into several separate paths
- [basics-point-grid.json](#basics-point-gridjson) — place points on a regular grid
- [basics-points-to-path.json](#basics-points-to-pathjson) — build a path from a point cloud
- [basics-primitive-ref.json](#basics-primitive-refjson) — reference a shipped primitive by name
- [basics-promote-attribute.json](#basics-promote-attributejson) — move an attribute between domains
- [basics-props-along-a-path.json](#basics-props-along-a-pathjson) — space props evenly along a curve
- [basics-radial-on-curve.json](#basics-radial-on-curvejson) — aim things radially around a curve
- [basics-reseed-a-noise.json](#basics-reseed-a-noisejson) — make a saved noise re-roll with the graph seed
- [basics-scatter-in-bounds.json](#basics-scatter-in-boundsjson) — scatter points in a box
- [basics-scatter-in-world.json](#basics-scatter-in-worldjson) — scatter points anchored to the world, not to the box
- [basics-spawn-by-species.json](#basics-spawn-by-speciesjson) — spawn a different asset per point
- [basics-spawn-instances.json](#basics-spawn-instancesjson) — turn points into instance batches
- [basics-subgraph-exposed-params.json](#basics-subgraph-exposed-paramsjson) — wrap a graph as one node with its own knobs
- [basics-surface-sample.json](#basics-surface-samplejson) — scatter points over a mesh surface
- [basics-sweep-profile.json](#basics-sweep-profilejson) — put a real surface on a curve
- [basics-transfer-attribute.json](#basics-transfer-attributejson) — read a value off a surface below each point
- [basics-transform-points.json](#basics-transform-pointsjson) — move, turn and size a whole cloud
- [examples-forest.json](#examples-forestjson) — plant a hillside, thinned by slope and treeline
- [examples-gpu-fields.json](#examples-gpu-fieldsjson) — a fusable chain, on the CPU or the device
- [examples-headless-scatter.json](#examples-headless-scatterjson) — headless scatter
- [examples-rig.json](#examples-rigjson) — a suspended rig, built from curves
- [pipeline-1-boundary.json](#pipeline-1-boundaryjson) — staged pipeline 1/5 — the ground and the wall
- [pipeline-2-districts.json](#pipeline-2-districtsjson) — staged pipeline 2/5 — district centres and the field they claim
- [pipeline-3-lots-edits.json](#pipeline-3-lots-editsjson) — staged pipeline 3/5, edited — hand-placed plots that win on priority
- [pipeline-3-lots.json](#pipeline-3-lotsjson) — staged pipeline 3/5 — a street, its frontage band, and lot footprints
- [pipeline-4-detail-edits.json](#pipeline-4-detail-editsjson) — staged pipeline 4/5, edited — the full settlement with authored plots
- [pipeline-4-detail.json](#pipeline-4-detailjson) — staged pipeline 4/5 — buildings, wall posts and forest
- [pipeline-5-roads-edits.json](#pipeline-5-roads-editsjson) — staged pipeline 5/5, edited — the settlement, its roads and authored plots
- [pipeline-5-roads.json](#pipeline-5-roadsjson) — staged pipeline 5/5 — a road network between the district centres

## basics-attribute-from-noise.json

**write an attribute from a noise field**

A field-capable param takes a field expression instead of a constant: `setAttribute`'s `value` here is four octaves of Perlin fBm, resolved once per point and stored into a new `height` attribute. `normalized: true` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own `seed` inside the spec, so the graph seed cannot reach it directly; what makes this one answer the seed box is the bounded `nodeSeed` shift folded into `opts.position`, which `basics-reseed-a-noise` explains in full. That shift is exactly zero at this graph's own seed, so what renders here is the raw fBm.

**Tags:** `basics`, `fields`, `noise`, `attributes`

**Seed:** 1003

**Node types:** `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `height`.`out`)

Cook it: `pcg cook graphs/basics-attribute-from-noise.json --stats`

## basics-attribute-remap.json

**rescale an attribute to a new range**

`attributeRemap` in mode 'fit' measures an attribute's actual minimum and maximum over the domain and stretches them onto [outMin, outMax], which is how a quantity of unknown scale — a raw noise value, a neighbour count, an invented score — becomes something a density or a colour can consume. `outName` writes the result beside the original instead of over it, so both columns survive for inspection.

**Tags:** `basics`, `attributes`, `remap`

**Seed:** 1004

**Node types:** `attributeRemap`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `fit`.`out`)

Cook it: `pcg cook graphs/basics-attribute-remap.json --stats`

## basics-compose-primitives.json

**compose several primitives into a scatter**

Four primitives and one terminal node build a complete placement pass: scatter with a guaranteed spacing, cut it to noise-defined regions, turn every point a random way, give every point one uniform random size, then spawn. Each step is a name from the catalog rather than a hand-built cluster of nodes, which is what keeps the graph readable and its behaviour documented. Note what varies: the scatter and the two write steps differ per instance, while the noise mask does not — two masks with the same params cut identically unless their `variant` differs.

**Tags:** `basics`, `primitives`, `composition`, `spawn`

**Seed:** 1023

**Node types:** `spawnInstances`, `subgraph`

**Primitives:** `fill/scatter-even`, `filter/mask-by-noise`, `write/random-scale`, `write/random-yaw`

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-compose-primitives.json --stats`

## basics-copy-to-points.json

**give every copy the attributes of the point it landed on**

`copyToPoints` stamps the whole `source` cloud onto every `target` point and composes the transforms per copy — P, rot and scale fold the target's frame into the source's, and each copied seed is hashCombine(sourceSeed, targetSeed) so the copies of one clump stay distinguishable. What the copies do NOT get by default is any idea of WHICH target they landed on, which makes them identical in everything but placement. `targetNames` is the fix: each named target point attribute arrives as a column on the copies, with the target's type, tuple size and default, and every copy in a target's block holds that target's value. Here the clump of nine props is a bare `pointGrid` around the origin, and the two things that vary between clumps — `species` and `vigour` — are computed once per plot and carried. `species` is the case nothing else reaches: it is a STRING, so `spawnInstances`' `assetAttr` can split the copies into one batch per asset id, and no amount of transform composition can decide an asset id. `vigour` is the case that shows why a carried value beats a composed one — the `scale` written after the copy multiplies the plot's vigour by a per-copy `randomField`, so a clump's props agree on how well the plot is doing and still differ from each other. The transform attributes are refused by name rather than resolved silently: carrying the target's `P` would put all nine props on top of the plot and the cook would stay clean, so `targetNames` rejects P, rot, scale and seed, and rejects a name the source already carries instead of letting statement order decide the winner.

**Tags:** `basics`, `copy`, `instancing`, `attributes`

**Seed:** 1051

**Node types:** `copyToPoints`, `pointGrid`, `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `points` (from `size`.`out`), `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-copy-to-points.json --stats`

## basics-even-spacing.json

**enforce a minimum distance between points**

`selfPrune` scans points in index order and keeps one only when every already-kept point is at least `minDistance` away, which turns a clumpy uniform scatter into evenly spaced points for anything with physical extent. Over-scatter deliberately: the output count is emergent, capped by the area divided by minDistance squared, so raising `count` past that adds nothing and the real knob is `minDistance`.

**Tags:** `basics`, `filter`, `spacing`

**Seed:** 1008

**Node types:** `pointScatterInBounds`, `selfPrune`

**Primitives:** *(none)*

**Outputs:** `points` (from `prune`.`out`)

Cook it: `pcg cook graphs/basics-even-spacing.json --stats`

## basics-extrude-polygon.json

**turn a footprint into massing**

A closed polyline is already a plan; `extrudePolygon` gives it a third dimension. The boundary is swept along a direction into three-vertex 'poly' triangles — walls, a floor and a roof — and until this node existed a graph that had computed its plots could only draw them as hairlines, which is why a settlement pipeline puts a pre-made house on a lot CENTRE while the lot's own shape goes unshown. `distance` is field-capable and resolves on the INPUT points, so a per-point value gives a SLOPED top rather than a flat one: the noise here lifts each corner of the plan by a different amount. Walls, roof and floor keep SEPARATE points, so the eaves stay a crease instead of being shaded round, and the winding is derived from the polygon's own Newell normal against the direction — a footprint wound either way comes out facing outward. Caps are fan-triangulated from the boundary's first point, which is exact for a CONVEX plan and is all the topology records. An OPEN polyline is refused by name: extrusion is not defined on one, and the fix is `pointsToPath` with `closed: true`.

**Tags:** `basics`, `surface`, `mesh`, `extrude`, `fields`

**Seed:** 1046

**Node types:** `extrudePolygon`, `subgraph`

**Primitives:** `shape/path-loop`

**Outputs:** `massing` (from `massing`.`out`), `footprint` (from `plot`.`out`)

Cook it: `pcg cook graphs/basics-extrude-polygon.json --stats`

## basics-field-params.json

**read a field's shaping numbers from a knob**

A field expression can read a named value instead of baking one: `{ "fn": "param", "name": "amplitude" }` inside the body's `translate` spec takes whatever the wrapping node's `amplitude` knob holds, so the two numbers that shape this surface are knobs rather than literals a caller would have to edit the graph to move. Every exposed param binds its name into its body's field scope, which is why both declarations here list no `targets` at all — neither writes into an inner param slot, so their type comes from the shape of `default` (a number is f32, a 3-number array vec3, a 4-number array vec4). The value is SUBSTITUTED before the field is built, so what cooks is exactly the field the literal would have built, cache key included: turning the knob invalidates precisely what editing the number would have. `frequency` multiplies the sample position rather than sitting in `opts.frequency`, because the noise options are read as plain numbers and cannot hold a spec — folding the scale into the position is the same move every noise-bearing primitive makes.

**Tags:** `basics`, `fields`, `subgraph`, `params`

**Seed:** 1044

**Node types:** `pointGrid`, `subgraph`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `dunes`.`out`)

Cook it: `pcg cook graphs/basics-field-params.json --stats`

## basics-filter-by-attribute.json

**keep points by an attribute comparison**

The first of the three ways to remove points: write a scalar column, then compare it. `filterByAttribute` tests one named point attribute against `value` with one of eq/ne/lt/le/gt/ge and keeps the survivors with every attribute carried. The scratch column stays on the output — `removeAttribute` is what takes it off again — which is the cost this idiom pays and `filterByExpression` avoids.

**Tags:** `basics`, `filter`, `attributes`

**Seed:** 1005

**Node types:** `filterByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `ridge`.`out`)

Cook it: `pcg cook graphs/basics-filter-by-attribute.json --stats`

## basics-filter-by-density.json

**thin a cloud by the density attribute**

The standard thinning idiom: write the standard `density` attribute from a 0..1 noise field, then let `filterByDensity` in mode 'probabilistic' keep each point with probability equal to its own density. The result is soft-edged — dense regions stay full, sparse ones fade out, with no visible boundary. Mode 'threshold' on the same input gives the hard-edged version instead.

**Tags:** `basics`, `filter`, `density`, `noise`

**Seed:** 1007

**Node types:** `filterByDensity`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `thin`.`out`)

Cook it: `pcg cook graphs/basics-filter-by-density.json --stats`

## basics-filter-by-expression.json

**keep points with a predicate expression**

`filterByExpression` decides per point from a field expression, so a test that would otherwise need a scratch attribute plus a comparison node becomes one node with no leftover column. The comparison functions emit 1 and 0, `mul` combines them as AND (and `max` as OR): this predicate keeps points inside a radius of 20 AND where a value-noise field rises above 0.4. NaN never passes, so a predicate that fails to compute drops the point.

**Tags:** `basics`, `filter`, `fields`, `predicate`

**Seed:** 1006

**Node types:** `filterByExpression`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `keep`.`out`)

Cook it: `pcg cook graphs/basics-filter-by-expression.json --stats`

## basics-filter-primitives-by-attribute.json

**keep whole primitives by an attribute comparison**

`filterByAttribute` one domain up. `connectPoints` writes each edge's length onto the PRIMITIVE domain as `edgeLength`, and `filterPrimitivesByAttribute` compares that column with the same six operators and keeps WHOLE PRIMITIVES: vertices, vertex and primitive columns, and the points they share all survive, so a network that goes in comes out a network. Every point filter would rebuild the point domain instead and the topology would go with it. The same column can be read after a sampler has flattened it onto points — that is how such graphs were written before this node existed — and the difference is that everything downstream then pays for the edges that were always going to be dropped.

**Tags:** `basics`, `filter`, `primitives`, `topology`

**Seed:** 1047

**Node types:** `connectPoints`, `filterPrimitivesByAttribute`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `network` (from `short`.`out`)

Cook it: `pcg cook graphs/basics-filter-primitives-by-attribute.json --stats`

## basics-foreach-per-group.json

**treat each group on its own**

`partitionByAttribute` splits the cloud into one geometry per district, and `forEach` cooks its inner graph once per group instead of once — so each district shakes loose on its own seed rather than all four sharing one. Exactly one exposed input must be named `each` (one iteration per item) or `eachPoint` (one per point); every other exposed input is broadcast whole to every iteration. Each iteration is seeded on its group's own CONTENT, never on where the group sat in the collection, so reordering the input reorders the output and re-rolls none of it. The `groups` output is the four separate results, still tagged `district=<value>`; `points` is the same four put back together with `mergePoints`, which is how you return to a single cloud.

**Tags:** `basics`, `foreach`, `partition`, `composite`

**Seed:** 2026

**Node types:** `forEach`, `jitterPoints`, `mergePoints`, `partitionByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `groups` (from `each`.`out`), `points` (from `rejoin`.`out`)

Cook it: `pcg cook graphs/basics-foreach-per-group.json --stats`

## basics-gather-on-path.json

**gather evenly spaced points into clumps along a curve**

`pathPointAt` answers the question the library could not: where is this curve at u = 0.37. Resampling steps a whole curve at even intervals, so anything needing one arbitrary parameter had to walk along the tangent and accept leaving the curve wherever it bent. This node moves each point to a parameter along ITS OWN polyline, keeping the points, their attributes and the topology — it slides points along the curve they already sit on, so the path stays the same path and only its parameterization changes. The parameter is field-capable and resolves BEFORE anything moves, which is what lets it read `curveU` and express a move relative to where the point already is. `transform/gather-on-path` is that idiom packaged: each point slides `amount` of the way toward the centre of its own bin, so an even distribution becomes clumps with bare runs between, and because nothing is removed the count is exactly what arrived. It needs `curveU` on its input, which pathResample, splineSample and the shape/path-* primitives write and a bare pointsToPath does not.

**Tags:** `basics`, `curve`, `path`, `spacing`

**Seed:** 1043

**Node types:** `subgraph`

**Primitives:** `shape/path-meander`, `transform/gather-on-path`

**Outputs:** `points` (from `bundles`.`out`)

Cook it: `pcg cook graphs/basics-gather-on-path.json --stats`

## basics-inline-field-params.json

**put a field's shaping numbers on knobs without a wrapper**

The dunes of `basics-field-params` with the wrapper deleted. A `param` reference inside a field spec may carry its own value — `{ "fn": "param", "name": "amplitude", "value": 24 }` — so a plain `transformPoints` node holds both the expression and the numbers that shape it, where before a subgraph had to exist for the sole purpose of carrying them. The value is SUBSTITUTED before the field is built, exactly as a binding is, so what cooks is the field the literal would have built, cache key included. The key is optional and that is the whole of its safety: omit it and the reference is unbound and refuses to evaluate, with the same error as ever, so a default exists only where somebody wrote one. An outer binding still wins, so wrapping this node in a subgraph that exposes `amplitude` overrides the 24 without editing it. Two details are inherited rather than invented: `frequency` multiplies the sample position instead of sitting in `opts.frequency`, because the noise options are read as plain numbers and cannot hold a spec; and the sample position is offset by a `nodeSeed`-derived vector, because a saved noise carries a literal `opts.seed` that the graph seed cannot otherwise move. The grid is sized so the knobs are legible rather than merely wired: 20 units of ground at quarter-unit spacing, three octaves, and an amplitude that lands about 10 units of relief. A normalized fBm only spans about two fifths of its nominal range, so a wide grid under a modest amplitude reads as a flat field of dots and the graph fails to show its own effect; the ratio of relief to footprint is also what the viewer's framing reads to pick its elevation angle, so a flat cook is photographed from a flatter angle and hides itself twice.

**Tags:** `basics`, `fields`, `params`

**Seed:** 1045

**Node types:** `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `dunes`.`out`)

Cook it: `pcg cook graphs/basics-inline-field-params.json --stats`

## basics-jitter-points.json

**break up a lattice with deterministic jitter**

`jitterPoints` offsets each point by a random vector drawn per axis from (seed, point index, axis), so the result is reproducible and independent of cook order — the lattice stops reading as a lattice without giving up determinism. `amount` is the maximum offset per axis and is field-capable, so the jitter can itself vary across space; here y is left at 0 to keep the cloud flat.

**Tags:** `basics`, `jitter`, `determinism`

**Seed:** 1009

**Node types:** `jitterPoints`, `pointGrid`

**Primitives:** *(none)*

**Outputs:** `points` (from `jitter`.`out`)

Cook it: `pcg cook graphs/basics-jitter-points.json --stats`

## basics-mask-by-species.json

**let a string attribute drive a field**

`attributeIs` is the only way a field can read a STRING attribute: it resolves to 1 on the elements whose named string attribute equals the literal and 0 on every other one, so `species` — itself painted spatially here, because `setAttribute`'s string mode takes a field as the selector into `values` and this one is a noise — becomes an ordinary scalar field. It is a PREDICATE rather than an index on purpose. A string column stores positions in a per-geometry table that clone, filter and merge rebuild to first-encounter order, so the same value sits at different indices depending on what happened upstream, and in different cells of one partitioned world; the predicate resolves the index against the geometry in hand and never exposes it. The same fact makes a literal that is absent from the table read as all zeros instead of throwing — a cell holding no pines legitimately has no `pine`, so a misspelled literal reads as 'nothing matches'. Feeding the 0/1 column to `lerp` as the blend factor is what makes the point: both endpoints are continuous fields of `moisture` and both are evaluated for every point, and the mask chooses between them. It is a mask, not a branch — swap the `lerp` for a `mul` and the same column gates instead. The `remap` on the selector is only bookkeeping: Perlin's values bunch around the middle of its range, so a bare `moisture * 3` would put nearly nine points in ten in the middle band, and stretching the band the noise actually occupies across the three names is what makes the split roughly even. It needs no clamp of its own: `setAttribute` floors the selector and clamps it into range, and NaN picks entry 0, so no per-point value can miss.

**Tags:** `basics`, `fields`, `attributes`, `strings`

**Seed:** 1049

**Node types:** `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `size`.`out`)

Cook it: `pcg cook graphs/basics-mask-by-species.json --stats`

## basics-merge-points.json

**concatenate two clouds into one**

`mergePoints` has a multi input: every connected geometry is concatenated in connection order into a single point cloud. The output carries the union of all point attributes — one missing on an input fills with its default over that input's range — and attributes sharing a name must agree on type and tuple size, so a scratch column left on one side can break a merge that used to work. Topology is not carried: the result is points only.

**Tags:** `basics`, `merge`, `compose`

**Seed:** 1016

**Node types:** `mergePoints`, `pointGrid`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `both`.`out`)

Cook it: `pcg cook graphs/basics-merge-points.json --stats`

## basics-merge-primitives.json

**join an authored path to a generated network**

`mergePrimitives` is `mergePoints` with the topology kept: points, vertices AND primitives are concatenated, and each input's vertex and primitive references are renumbered onto its place in the result — so an authored boundary path and a generated trail network come out one geometry that is still a network. Send the same two inputs through `mergePoints` instead and both survive as loose points with every primitive gone, which is what blocked mixing authored geometry with generated geometry at all. Each domain carries the union of its attributes, an input missing one filling with that column's default over its own range. `primtype` is the exception, because it is a type tag rather than a value: each input's primitives keep their own tag, and primitives from an input carrying no tag come out with an empty one instead of inheriting another input's. Mixed primitive kinds in one geometry are fine — every consumer selects what it understands, so a mesh unioned with a network is coherent.

**Tags:** `basics`, `merge`, `topology`, `compose`

**Seed:** 1050

**Node types:** `connectPoints`, `mergePrimitives`, `pointScatterInBounds`, `subgraph`

**Primitives:** `shape/path-loop`

**Outputs:** `network` (from `network`.`out`)

Cook it: `pcg cook graphs/basics-merge-primitives.json --stats`

## basics-mesh-primitive.json

**build a mesh a saved graph can cook**

`meshPrimitive` is the only mesh source that survives serialization — `dataInput`'s items are injected at runtime and a saved graph carries none — so a graph that must cook from JSON alone gets its surface from here. The output carries P and a `uv` point attribute, plus one three-vertex 'poly' primitive per triangle: exactly the topology `surfaceSample`, `promoteAttribute`, and the 'uv' and 'raycast' transfer mappings need.

**Tags:** `basics`, `mesh`, `source`, `serialization`

**Seed:** 1012

**Node types:** `meshPrimitive`

**Primitives:** *(none)*

**Outputs:** `mesh` (from `ground`.`out`)

Cook it: `pcg cook graphs/basics-mesh-primitive.json --stats`

## basics-neighborhood-count.json

**measure how crowded each point is**

`pointNeighborhood` writes how many other points lie within `radius` into a u32 attribute, using a uniform spatial grid so it stays fast well beyond a few thousand points. The count is a measured quantity rather than an authored one, which is what a later filter, colour or scale can react to. A point with no neighbours gets 0 and keeps its own value as the neighbour average, so a displacement built from that average is zero rather than undefined.

**Tags:** `basics`, `attributes`, `neighborhood`, `measure`

**Seed:** 1018

**Node types:** `pointNeighborhood`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `crowding`.`out`)

Cook it: `pcg cook graphs/basics-neighborhood-count.json --stats`

## basics-orient-along-path.json

**turn a path's own points to follow it**

A path built by `pointsToPath` carries no `tangent` — only a sampler writes one, for the points it created — so `orientAlongVector` has nothing to read. `writeTangents` supplies it, from the normalized central difference between each point's neighbours along the polyline, which stays smooth through corners and wraps on a closed path. Both nodes keep the points, their attributes and the topology exactly as they arrived, so the `width` column written before the path was built is still on the output after the rotation: that is the whole difference from `place/along-curve`, which resamples and hands back new points carrying none of it. Run the pair BEFORE any filter — every filter drops topology, and `writeTangents` would then find no paths.

**Tags:** `basics`, `path`, `rotation`, `attributes`

**Seed:** 1026

**Node types:** `orientAlongVector`, `pointsToPath`, `setAttribute`, `subgraph`, `writeTangents`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `face`.`out`)

Cook it: `pcg cook graphs/basics-orient-along-path.json --stats`

## basics-orient-along-vector.json

**turn each point to face a direction**

`orientAlongVector` writes the standard `rot` quaternion so a chosen local axis points along `direction`, with `up` fixing the roll. `direction` is field-capable and resolved per point, so an expression is what makes each point face somewhere different: here `vec(P.x, 0, P.z)` points every point radially away from the origin. A zero-length direction leaves that point's rotation alone rather than inventing one.

**Tags:** `basics`, `transform`, `rotation`, `fields`

**Seed:** 1011

**Node types:** `orientAlongVector`, `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `face`.`out`)

Cook it: `pcg cook graphs/basics-orient-along-vector.json --stats`

## basics-partition-by-attribute.json

**split one cloud into labelled groups**

`partitionByAttribute` splits the input into one point cloud per distinct value of an i32, u32 or string attribute, so a single declared output holds several geometry items rather than one. Groups arrive in order of each value's first occurrence and each is tagged `<name>=<value>`, which is how a downstream node or a host routes them apart. The labels here come from a string `setAttribute` whose `value` acts as a per-point selector into `values`.

**Tags:** `basics`, `attributes`, `partition`, `routing`

**Seed:** 1017

**Node types:** `partitionByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `groups` (from `groups`.`out`)

Cook it: `pcg cook graphs/basics-partition-by-attribute.json --stats`

## basics-path-resample.json

**even out the spacing along a path**

`pathResample` walks each polyline's own arc length and places new points at even steps along it, which is a different operation from thinning a cloud: `selfPrune` keeps a subset of the points it was handed, while this creates points that were never there. The ellipse shows why it is needed — `shape/ring` spaces its points evenly in ANGLE, and on anything that is not a circle that leaves them bunched at the two ends of the long axis. `count` mode places exactly that many samples on every path whatever its length, and on a closed one they divide it without duplicating the start, so every step here comes out equal; `spacing` mode steps a fixed number of world units instead, so a longer path simply gets more points. The output is still a path and a closed one comes back closed, but the points are new: they carry `tangent` and `curveU`. Nothing written on the input's POINTS is carried across — but every PRIMITIVE attribute is, onto both the new points and the resampled path, so a road resampled here stays a road that knows its own width.

**Tags:** `basics`, `path`, `resample`, `spacing`

**Seed:** 1025

**Node types:** `pathResample`, `pointsToPath`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `even`.`out`)

Cook it: `pcg cook graphs/basics-path-resample.json --stats`

## basics-path-segments.json

**draw a curve as solid geometry**

One oriented asset per segment, which is a different job from a skin. `sweepProfile` is what draws a curve as a continuous SURFACE; this node draws it as a run of discrete instanced assets, which is the only way to spell a chain of separate links, a row of sleepers or a string of beads. `pathSegments` emits ONE point per polyline segment: positioned at the segment's midpoint, `rot` turning the chosen local axis onto the segment, and `scale` carrying the segment's length on that axis with `radius` on the other two. Spawn a unit cylinder — radius 1, height 1 — on those points and each one lands exactly on its segment, so a whole tangle of cable costs a single draw call. The default axis is `+y` rather than orientAlongVector's `+z` because the assets this feeds are cylinders and capsules, which three.js builds along Y. `extend` adds to both ends, closing the wedge consecutive segments leave on the outside of a bend. The OUTPUT IS A PLAIN CLOUD: the points are midpoints, not the curve, so re-pathing them describes the midpoints.

**Tags:** `basics`, `curve`, `path`, `instancing`

**Seed:** 1041

**Node types:** `pathSegments`, `spawnInstances`, `subgraph`

**Primitives:** `shape/path-meander`

**Outputs:** `instances` (from `spawn`.`instances`), `points` (from `tubes`.`out`)

Cook it: `pcg cook graphs/basics-path-segments.json --stats`

## basics-paths-by-group.json

**cut one cloud into several separate paths**

With `groupAttr` set, `pointsToPath` splits the cloud by a whole-number point attribute and emits one polyline per distinct id, in ascending id — four rows here become four independent paths over the same 40 points, not one path zig-zagging between them. The ids come from a `setAttribute` of type i32 reading world Z, which is what keeps the grouping a property of the geometry rather than a hardcoded list. Within a group the points are visited in input index order; `orderAttr` is the companion knob when that order is not the one the path should follow, and its ties always break to the lower index so the result never depends on the sort.

**Tags:** `basics`, `path`, `groups`, `attributes`

**Seed:** 1027

**Node types:** `pointGrid`, `pointsToPath`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `paths` (from `paths`.`out`)

Cook it: `pcg cook graphs/basics-paths-by-group.json --stats`

## basics-point-grid.json

**place points on a regular grid**

The deterministic counterpart to scattering: `pointGrid` places countX * countY * countZ points stepped by `spacing` from `origin`, in X-fastest order. There is no randomness at all here — the same params always give the same positions, which makes a grid the right starting cloud when the variation should come from a later node rather than from the source.

**Tags:** `basics`, `grid`, `source`

**Seed:** 1002

**Node types:** `pointGrid`

**Primitives:** *(none)*

**Outputs:** `points` (from `grid`.`out`)

Cook it: `pcg cook graphs/basics-point-grid.json --stats`

## basics-points-to-path.json

**build a path from a point cloud**

`pointsToPath` is the only way a saved graph can produce polyline geometry: it lays one `polyline` primitive over the points it was given, so the points and every attribute on them survive untouched and only topology is added. Visiting order is the input's point order unless `orderAttr` names a sort key. `closed` appends a trailing vertex referencing the first point — closure is structural, not a flag, so a closed path over 12 points has 13 vertices and there is no duplicated seam point to trip over. `shape/path-loop` is exactly this pair of nodes under one name.

**Tags:** `basics`, `path`, `topology`, `source`

**Seed:** 1024

**Node types:** `pointsToPath`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `path` (from `path`.`out`)

Cook it: `pcg cook graphs/basics-points-to-path.json --stats`

## basics-primitive-ref.json

**reference a shipped primitive by name**

Instead of embedding a copy of a subgraph, a node can name one from the shipped vocabulary: `ref: { name }` resolves against the registry, which is populated by importing `pcg-ts/primitives` (the `pcg` CLI does it for you). Prefer this over rebuilding the same four nodes by hand — the catalog in docs/primitives.md documents each primitive's real behaviour, including what varies per instance. A `ref` may also carry an optional `hash` to pin the exact content it was authored against; without one it always resolves to the library's current version.

**Tags:** `basics`, `primitives`, `vocabulary`, `ref`

**Seed:** 1022

**Node types:** `subgraph`

**Primitives:** `fill/scatter-even`

**Outputs:** `points` (from `trees`.`out`)

Cook it: `pcg cook graphs/basics-primitive-ref.json --stats`

## basics-promote-attribute.json

**move an attribute between domains**

Attributes live on domains — point, vertex, primitive, detail — and `promoteAttribute` walks the geometry's topology to move one between them. Here a per-point `height` becomes a per-triangle `height` by averaging the corners, which is what a shader or an exporter that colours faces rather than corners needs. Elements with no contributors keep the attribute default, and string attributes support only mode 'first'.

**Tags:** `basics`, `attributes`, `domains`, `promote`

**Seed:** 1015

**Node types:** `meshPrimitive`, `promoteAttribute`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `mesh` (from `perFace`.`out`)

Cook it: `pcg cook graphs/basics-promote-attribute.json --stats`

## basics-props-along-a-path.json

**space props evenly along a curve**

Two primitives cover the whole road-and-lamp-posts shape: `shape/path-meander` is a curve SOURCE — an open path that wanders off a straight line by noise and is re-evened by arc length, needing no cloud to start from — and `place/along-curve` resamples it and turns every new point to face the way the curve goes, so a `spacing` of 6 means a post every 6 world units however long the road turns out to be. The points `place/along-curve` emits are new ones carrying `P`, `tangent`, `curveU` and `rot`, plus every attribute the curve carried on its PRIMITIVES — a post inherits the road it stands on; when the curve's own POINTS matter instead, `write/orient-along-path` orients them in place. Note what varies: the meander carries its noise seed inside a field spec, so `variant` is its only re-roll.

**Tags:** `basics`, `primitives`, `path`, `placement`

**Seed:** 1028

**Node types:** `spawnInstances`, `subgraph`

**Primitives:** `place/along-curve`, `shape/path-meander`

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-props-along-a-path.json --stats`

## basics-radial-on-curve.json

**aim things radially around a curve**

`orientAlongVector` fixes the roll around a direction with an `up` hint, and a CONSTANT up cannot follow a curve that turns over: as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve snaps round with it. `place/radial-on-curve` solves that the only way it can be solved — with a per-point up carried ALONG the curve. `writeCurveFrame` seeds a normal perpendicular to the first tangent and transports it point to point by double reflection, the rotation that moves it least at each step, giving `curveNormal` and `curveBinormal` beside the tangent. The fan is then cos(a) * curveNormal + sin(a) * curveBinormal — the unit vector at angle `a` in the plane perpendicular to the tangent — fed back in as `up`, which is field-capable for exactly this. `spread` is how much of the turn the fan covers, measured from the normal: 0 lines everything up on one side, 1 is a complete fan. Compare `place/along-curve`, which aims along the tangent and gives every copy the same roll.

**Tags:** `basics`, `curve`, `path`, `instancing`, `orientation`

**Seed:** 1042

**Node types:** `spawnInstances`, `subgraph`

**Primitives:** `place/radial-on-curve`, `shape/path-meander`

**Outputs:** `instances` (from `spawn`.`instances`), `points` (from `fan`.`out`)

Cook it: `pcg cook graphs/basics-radial-on-curve.json --stats`

## basics-reseed-a-noise.json

**make a saved noise re-roll with the graph seed**

A serialized field expression bakes its numbers, so a noise carries `opts.seed` as a literal and the graph's seed box moves every scatter and jitter while leaving the shape exactly where it was. `{ "fn": "nodeSeed" }` is the way out: it resolves to the cooking node's own seed — `deriveNodeSeed(graph seed, node id)`, the same number `randomField` hashes — and `opts.position` is an ordinary argument position where `opts.seed` is read as a plain number and cannot hold a spec. So the seed is folded into the SAMPLE POSITION instead, one `A * (fract(nodeSeed * 2^-32 * K) - W0)` per axis. Every part of that shape is load-bearing. Multiplying by 2^-32 is exact, so the fold reads the seed's HIGH bits rather than the low ones an f32 column has already rounded away. `A` is about 32 noise cells (`32 / opts.frequency`, so 700 here): far enough to decorrelate, near enough that an f32 still resolves a lattice cell at the sample point. `K` is 1021, 3067 and 8191 so the three axes do not move together. And `W0` is the expression's own value at seed 1048, which makes the offset exactly zero at this graph's default seed — folding this into a saved graph costs nothing until someone moves the seed. It is built from `add`, `sub`, `mul` and `floor` alone, because those four are bit-exact on CPU and GPU and a one-ULP disagreement inside a `floor` would move the offset by a whole unit rather than a ULP. Change the seed and this surface becomes a different surface; delete the `add` and it is deaf to the seed again. Every noise-bearing graph in this corpus carries the same fold, and `docs/authoring.md` has the derivation.

**Tags:** `basics`, `fields`, `noise`, `determinism`

**Seed:** 1048

**Node types:** `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `lift`.`out`)

Cook it: `pcg cook graphs/basics-reseed-a-noise.json --stats`

## basics-scatter-in-bounds.json

**scatter points in a box**

The smallest complete graph: one source node fills an axis-aligned box with a fixed count of points. Nothing is connected and nothing is filtered, so the output count is exactly `count`. Every point already carries the standard attributes (P, rot, scale, density, boundsMin, boundsMax, color, seed) whether the graph writes them or not, which is why later examples can filter on `density` without creating it first.

**Tags:** `basics`, `scatter`, `source`

**Seed:** 1001

**Node types:** `pointScatterInBounds`

**Primitives:** *(none)*

**Outputs:** `points` (from `scatter`.`out`)

Cook it: `pcg cook graphs/basics-scatter-in-bounds.json --stats`

## basics-scatter-in-world.json

**scatter points anchored to the world, not to the box**

The same shape of graph as 'scatter points in a box', with the one difference that makes a region streamable: `pointScatterInWorld` computes each point from its own lattice cell and index, so the box only says which points to RETURN. Widen it, move it, or ask for it in four pieces and every point that was already there stays exactly where it was, with the same per-point seed — `pointScatterInBounds` derives positions FROM the bounds and moves all 500 of them when the box moves an inch. Population is `density * area`: at 0.05 points per square unit over an 80x80 window that is 320 points, predictable without cooking, with `cellSize` deciding only how evenly they clump. The clip is half-open, so abutting windows tile the world with no gap and no duplicate — which is why a cell can derive its own halo by simply asking for a wider box.

**Tags:** `basics`, `scatter`, `source`, `streaming`

**Seed:** 1029

**Node types:** `pointScatterInWorld`

**Primitives:** *(none)*

**Outputs:** `points` (from `scatter`.`out`)

Cook it: `pcg cook graphs/basics-scatter-in-world.json --stats`

## basics-spawn-by-species.json

**spawn a different asset per point**

A string `setAttribute` with a non-empty `values` list turns its field-capable `value` into a per-point selector — floor, then clamp into range, NaN picks 0 — so weighting by repetition works: 'pine' twice in four entries is half the points. Pointing `spawnInstances`' `assetAttr` at that attribute splits the output into one batch per asset id, in first-occurrence order, with no per-point branching anywhere in the graph.

**Tags:** `basics`, `spawn`, `instancing`, `strings`

**Seed:** 1020

**Node types:** `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-spawn-by-species.json --stats`

## basics-spawn-instances.json

**turn points into instance batches**

`spawnInstances` is a terminal: it converts a point cloud into render-agnostic instance batches, one 4x4 world matrix per point composed as T(P) * R(rot) * S(scale) from the standard attributes. Points group into one batch per asset id. The node has two output pins — `instances` for the batches and `points`, which passes the input through unchanged for chaining or debug rendering — and this graph declares only the first.

**Tags:** `basics`, `spawn`, `instancing`

**Seed:** 1019

**Node types:** `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-spawn-instances.json --stats`

## basics-subgraph-exposed-params.json

**wrap a graph as one node with its own knobs**

A `subgraph` node carries an inner graph plus the pins and params it exposes, so a reusable piece becomes a single node with a deliberately small interface. Declarations live in the payload and VALUES live in the node's own `params`, exactly as a standard node keeps its schema in the registry and its value on the node. A declaration may not carry `type`, `enum` or `acceptsField` — those are re-derived from the targets' registered schemas, so a payload cannot claim a capability the inner params do not have.

**Tags:** `basics`, `subgraph`, `composition`, `params`

**Seed:** 1021

**Node types:** `pointScatterInBounds`, `selfPrune`, `subgraph`

**Primitives:** *(none)*

**Outputs:** `points` (from `grove`.`out`)

Cook it: `pcg cook graphs/basics-subgraph-exposed-params.json --stats`

## basics-surface-sample.json

**scatter points over a mesh surface**

`surfaceSample` picks each candidate's triangle with probability proportional to its area and then a uniform position inside it, so coverage is even in world units rather than per triangle. Output points carry P, the flat per-triangle `normal`, density 1 and a hashed per-point seed. `densityField` is field-capable and applied after placement, so the count is at most `count` and exactly `count` while density stays 1.

**Tags:** `basics`, `mesh`, `sampler`, `placement`

**Seed:** 1013

**Node types:** `meshPrimitive`, `surfaceSample`

**Primitives:** *(none)*

**Outputs:** `points` (from `onSurface`.`out`)

Cook it: `pcg cook graphs/basics-surface-sample.json --stats`

## basics-sweep-profile.json

**put a real surface on a curve**

A curve becomes a skin. `sweepProfile` places a cross-section on EVERY POINT of a polyline and stitches consecutive placements into three-vertex 'poly' triangles — the same topology `meshPrimitive` emits, so the result is not a second class of mesh: `surfaceSample`, `promoteAttribute` and the 'uv' and 'raycast' transfer mappings all see it. THE PATH IS NOT RESAMPLED. One ring per input point, exactly where the point is, which is why `radius` here can be a field: it resolves AT the ring rather than being averaged across a segment's two endpoints the way `pathSegments` must, so this taper from 0.9 to 0.15 along `curveU` is exact. For a finer surface, run `pathResample` first — that is the knob, not a subdivision param. Rings meet through a mitered joint, so the section keeps its radius round a bend instead of pinching by the cosine of the half-angle. The node writes `normal` itself rather than leaving `computeVertexNormals` to smooth across the uv seam and the caps, and writes `uv` with `u` as normalized arc length — the same measure `curveU` carries, so a texture lines up with anything else measured along this curve.

**Tags:** `basics`, `curve`, `surface`, `mesh`, `fields`

**Seed:** 1045

**Node types:** `subgraph`, `sweepProfile`

**Primitives:** `shape/path-meander`

**Outputs:** `surface` (from `skin`.`out`), `path` (from `curve`.`out`)

Cook it: `pcg cook graphs/basics-sweep-profile.json --stats`

## basics-transfer-attribute.json

**read a value off a surface below each point**

`transferAttribute` copies an attribute from its `source` geometry onto the main input's points. Mapping 'raycast' casts a ray from each point along `direction` and interpolates the value at the nearest forward hit, which is how a scattered cloud reads the terrain under it. A point whose ray hits nothing keeps the value it already had — never an invented one — and `missCountAttr` records how many missed as a detail attribute so a graph can assert on it.

**Tags:** `basics`, `transfer`, `mesh`, `raycast`

**Seed:** 1014

**Node types:** `meshPrimitive`, `pointScatterInBounds`, `setAttribute`, `transferAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `sampleDown`.`out`)

Cook it: `pcg cook graphs/basics-transfer-attribute.json --stats`

## basics-transform-points.json

**move, turn and size a whole cloud**

`transformPoints` applies P' = R * (scale * P) + translate about the world origin, with `rotateEuler` in degrees extrinsic XYZ. It composes with the per-point transform attributes rather than replacing them: `rot` becomes R * rot and `scale` multiplies componentwise, so transforming a cloud that already carries orientations keeps them. All three params are field-capable, which is how one node can taper or twist a cloud instead of moving it rigidly.

**Tags:** `basics`, `transform`

**Seed:** 1010

**Node types:** `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `place`.`out`)

Cook it: `pcg cook graphs/basics-transform-points.json --stats`

## examples-forest.json

**plant a hillside, thinned by slope and treeline**

The forest recipe as one serialized graph. A displaced plane is the terrain; `surfaceSample` scatters candidates over it carrying the flat per-triangle `normal`; two attributes derived from that geometry — `height` from the point's own Y, `slope` as `1 - normal.y` — become the two `filterByAttribute` gates that decide where a tree is allowed. Scale is stamped BEFORE the filters, since it depends on nothing they decide. The last attribute is a string: `species` selects into `values` per point, mixing roughly three pines to one bush, and the spawner splits by it.

**Tags:** `examples`, `terrain`, `placement`, `filter`, `spawner`

**Seed:** 2402

**Node types:** `filterByAttribute`, `meshPrimitive`, `setAttribute`, `spawnInstances`, `subgraph`, `surfaceSample`

**Primitives:** `transform/displace-by-noise`

**Outputs:** `terrain` (from `terrain`.`out`), `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/examples-forest.json --stats`

## examples-gpu-fields.json

**a fusable chain, on the CPU or the device**

Five count-preserving nodes in a strict line, every field param authored as a serialized spec rather than composed in code, so the chain is device-eligible. Switch the cook path in the toolbar: the two device paths agree bit for bit, so the hash holds across them while the time drops as the tail fuses into one resident run. The CPU hash differs, and that is not a defect: GPU floats are not byte-identical to CPU floats. Raise the point count to see why the device path exists.

**Tags:** `gpu`, `fields`, `attributes`, `performance`

**Seed:** 1

**Node types:** `jitterPoints`, `pointScatterInBounds`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `psize`.`out`)

Cook it: `pcg cook graphs/examples-gpu-fields.json --stats`

## examples-headless-scatter.json

**headless scatter**

Scatter points across a 60x60 patch, write a height attribute from fbm perlin noise, keep the points above the midline, and jitter what survives. Cooks in plain Node with no renderer and no page — the graph is data, and the CLI is its feedback loop.

**Tags:** `headless`, `scatter`, `fields`, `cli`

**Seed:** 20260808

**Node types:** `filterByAttribute`, `jitterPoints`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `spread`.`out`)

Cook it: `pcg cook graphs/examples-headless-scatter.json --stats`

## examples-rig.json

**a suspended rig, built from curves**

A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a `forEach`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. The wander is a plain `transformPoints`: the three numbers shaping it — how far it drifts up, how far sideways, and how fast — are `param` spec nodes carrying their own values inside its `translate` expression, and the sandbox reads each as a knob. It used to be a one-node subgraph, because a param could only be DECLARED on a wrapper, and the wrapper existed for nothing else. `wanderScale` is named twice in that one expression and is still one knob writing both — the case that made a wrapper look unavoidable. Everything that was drawn as a tube is a real surface now: `sweepProfile` skins the chords, the braces, the frames, the cables, the fringe and the swags, every one of which used to end at `pathSegments` with a unit cylinder landing on each segment — half the drawn triangles, because rings are shared between segments and no interior caps grow, and nine `extend` settings gone with them, because a continuous skin leaves no wedge at a bend to fill. The chains do NOT sweep, and that is the line between the two nodes: `pathSegments` still has a job of its own, one oriented asset per segment, and a chain of separate links is exactly that job — what it lost is the borrowed one, faking a tube. Four chords reach ONE sweep rather than four, because a sweep reads a geometry and a geometry holds as many polylines as you like: each strut arrives from `pathResample` already a polyline, `transformPoints` moves it without touching that topology, and `mergePrimitives` unions the four KEEPING it, so the sweep gets four paths in one geometry and the chord radius stays a single knob rather than one knob mirrored into four. It used to tag every strut with a `strutId`, merge the POINTS, and rebuild the same four paths with `pointsToPath` — ten nodes spent throwing topology away and putting it back, because the topology-preserving union did not exist yet when this graph was written. The frames still regroup, and that contrast is the useful one: their rings connect the four chords ACROSS each station, topology that never existed anywhere upstream, so `pointsToPath` over `stationId` BUILDS something rather than restoring it — and the filter feeding it drops three points in four, which no union could have preserved. The chains and the fringe reach that same grouping from the other end: `copyToPoints` writes each copy's anchor index itself, through `targetIndexAttr`, and `pointsToPath` groups by it. Carrying it needed a `setAttribute` on the anchors first, writing an `index` field into a column whose only reader was `targetNames` — the node had already computed that index to place the copies, so both of those are gone. Before that the id was recovered arithmetically — `floor(index / 35)` for the chains and `floor(index / 17)` for the fringe — where the 35 and the 17 were the source strand's point count written out a second time, in another node, with nothing holding the two together. Editing the strand welded every chain into one path and said nothing. The swags are gated BEFORE the sweep now, which is where a gate has to sit once the thing downstream of it is a surface: `connectPoints` writes `edgeLength` on the primitive domain and the pick lands there too, so `filterPrimitivesByAttribute` cuts 456 chords to 63 while they are still polylines — gating the segment cloud afterwards, which is what this graph used to do, meant building 7.24 times the geometry that survives. The components are proportioned by KIND rather than by one draw wearing four hats: one `byAttribute` reads the string `part` and hands back that kind's whole vec3, so a rod lengthens along the radius it points down, a bar along the chord it lies on, a panel widens on both of its faces while staying slab-thin, and a clamp is a squat collar rather than a cube. It was three nested `lerp`s over three `attributeIs` calls, written out once per AXIS — and `clamp` was in none of them, so it fell through all three to the uniform base scale and stayed there, because a fall-through nobody writes is a fall-through nobody can find. Its `default` is the same sentence made explicit: any part kind this expression does not name keeps the base scale, unstretched, and now says so. Eight declared outputs, one per part, plus the bare spine, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — and the noises with it: six of the eight fbm fields fold `nodeSeed` into `opts.position` as a bounded shift, so the spine takes a different wander and the clusters a different shape, rather than the same frozen field being walked over by points that moved. Each of those six also carries a `variant` param of its own, an inline value added into the fold before it is scaled, so ONE noise can be re-rolled while the rest hold still — a node has a single seed, so until a param could sit inside a plain node's expression the spine's two noises could only move together, and the four scalars this graph needed had to be folded into literal noise seeds before it was saved. Every variant defaults to 0, so the shift is still exactly zero at seed 3 and the spine is the spine this file has always cooked — the flattening moved the node's id, and with it the seed the fold is calibrated against, so the three constants that zero it were re-derived rather than left to drift. The cable wraps are the deliberate exception: their body is a `forEach`, whose seed varies per item, and their wobble already re-rolls through `randomField`.

**Tags:** `examples`, `curves`, `foreach`, `surface`, `instancing`, `rig`

**Seed:** 3

**Node types:** `connectPoints`, `copyToPoints`, `filterByAttribute`, `filterByDensity`, `filterPrimitivesByAttribute`, `forEach`, `jitterPoints`, `mergePrimitives`, `orientAlongVector`, `partitionByAttribute`, `pathPointAt`, `pathResample`, `pathSegments`, `pointLine`, `pointsToPath`, `setAttribute`, `spawnInstances`, `sweepProfile`, `transferAttribute`, `transformPoints`, `writeCurveFrame`

**Primitives:** *(none)*

**Outputs:** `truss` (from `trussChordSkin`.`out`), `braces` (from `trussBraceSkin`.`out`), `frames` (from `trussFrameSkin`.`out`), `parts` (from `partPartSpawn`.`instances`), `wraps` (from `wrapWraps`.`out`), `chains` (from `chainSpawn`.`instances`), `danglers` (from `danglerDanglerSkin`.`out`), `drapes` (from `drapeDrapeSkin`.`out`), `spinePoints` (from `spineSpine`.`out`)

Cook it: `pcg cook graphs/examples-rig.json --stats`

## pipeline-1-boundary.json

**staged pipeline 1/5 — the ground and the wall**

First step of a settlement-scale pipeline whose four stages are four files, each the previous file plus new nodes, connections and outputs — nothing removed, no param retuned, one shared seed. This stage ADDS the two things every later stage stands on: a subdivided plane pushed into rolling terrain by a noise field (`terrain`), and a 64-point ring displaced along its own radius and closed into a path with tangents written on it (`boundary`). Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `terrain`, `path`

**Seed:** 40100

**Node types:** `meshPrimitive`, `pointsToPath`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `shape/ring`, `transform/displace-by-noise`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`)

Cook it: `pcg cook graphs/pipeline-1-boundary.json --stats`

## pipeline-2-districts.json

**staged pipeline 2/5 — district centres and the field they claim**

Stage 1 verbatim, plus a district layer. ADDS `districts`: a 34x34 grid masked to a disc and dropped onto the terrain, with every surviving cell told which district owns it. The centres come from a separate scatter thinned by `selfPrune`, numbered with an i32 `district` and given a string `districtKind`; `sampleNearestPoint` then writes the owning index, the distance to it and the kind onto each cell. `terrain` and `boundary` cook bit-identically to stage 1 — nothing upstream was touched. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `sampling`, `attributes`

**Seed:** 40100

**Node types:** `filterByExpression`, `meshPrimitive`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`)

Cook it: `pcg cook graphs/pipeline-2-districts.json --stats`

## pipeline-3-lots-edits.json

**staged pipeline 3/5, edited — hand-placed plots that win on priority**

`pipeline-3-lots.json` verbatim, plus an authored edit layer: a `pointLine` terrace and a `pointGrid` block dropped onto the same terrain, stamped `locked = 1`, and wired into the edit slot the base reserved — ONE connection is the whole edit. It lands twice: as the `features` of a `filter/by-distance-to` that keeps procedural lots 3 units clear of it, and on pin `b` of `compose/merge-tagged`, which appends the authored points AFTER the procedural ones at the HIGHEST indices — the worst place an index-greedy prune could put them. They take every contested spot anyway, because `selfPrune` ranks by `priority: attribute("locked")`: higher wins, ties fall to the lower index, so the 12 authored points are visited first and the procedural ones prune against them. Survival is a value the points carry, not a position in a merge — drop the `priority` param and 8 of the 12 lose their spots to procedural neighbours; move the edit back to pin `a` and the same 12 survive. The point of the variant: `terrain`, `boundary` and `districts` cook bit-identically to the base while `lots` and `footprints` change — the edit is provably local.

**Tags:** `pipeline`, `staged`, `edits`, `authoring`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`, `write/random-scale`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`)

Cook it: `pcg cook graphs/pipeline-3-lots-edits.json --stats`

## pipeline-3-lots.json

**staged pipeline 3/5 — a street, its frontage band, and lot footprints**

Stages 1-2 verbatim, plus building plots. ADDS `lots` and `footprints`: the district centres are sorted by their bearing, atan2(z, x), and closed into one ring called `spine`, the district field is cut to a frontage band (within 11 of the street, at least 4 off it), each survivor is turned to face the nearest street sample and given a random size, and `selfPrune` spaces them 7 apart. A 4-corner ring copied onto every lot and grouped by `lotId` becomes one closed quad per plot. Note the reserved EDIT SLOT: `edits` is a `mergePoints` with nothing connected, so it cooks to an empty cloud that clears nothing and merges nothing — see the `-edits` variant, which is this file plus authored geometry and one connection. The slot comes with a RANK as well as a wire: procedural lots are stamped `locked = 0` on their way into the merge and the prune reads `priority: attribute("locked")`, so a point arriving through the slot at 1 outranks every procedural neighbour it contests. Here nothing arrives, every point ties at 0, and the prune is exactly the index-greedy one it has always been — which is what `priority`'s default is for. WHAT `spine` IS, PLAINLY: an angular TOUR of the centres in bearing order, and NOT a road network. It cannot branch and it cannot fork — `pointsToPath` puts every point in exactly one group, so every centre gets exactly two neighbours and the result is always a single closed loop. What it is good for is what it is used for here: one continuous curve to measure frontage against, which `nearSpine`, `frontage` and `street` all read. The actual network is stage 5 (`pipeline-5-roads.json`), where `connectPoints` joins these same centres into 2-vertex polylines that SHARE their endpoints, so a junction can carry three roads or more. This ring stays where it is because the stages are supersets: stages 3 and 4 were measured against it, and retuning it would move them both. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `path`, `placement`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/drop-to-surface`, `shape/ring`, `transform/displace-by-noise`, `write/random-scale`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`)

Cook it: `pcg cook graphs/pipeline-3-lots.json --stats`

## pipeline-4-detail-edits.json

**staged pipeline 4/5, edited — the full settlement with authored plots**

`pipeline-4-detail.json` verbatim plus the same authored edit layer `pipeline-3-lots-edits.json` adds, so it is a superset of BOTH. It is the whole point of the arrangement: `terrain`, `boundary` and `districts` stay bit-identical to the unedited stage 4, while `lots`, `footprints`, `buildings` and everything downstream of them respond to the hand-placed geometry. An edit reaches exactly as far as the dependency graph says it does, and no further.

**Tags:** `pipeline`, `staged`, `edits`, `spawn`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`)

Cook it: `pcg cook graphs/pipeline-4-detail-edits.json --stats`

## pipeline-4-detail.json

**staged pipeline 4/5 — buildings, wall posts and forest**

Stages 1-3 verbatim, plus everything that gets drawn. ADDS `buildings` (one asset per lot, chosen per point and spawned), `props` (posts spaced every 6 units along the boundary wall and turned to follow it) and `vegetation` (plantable scatter on the terrain, cut to the ground outside the wall, yawed at random and split into species batches). Every earlier output — `terrain`, `boundary`, `districts`, `lots`, `footprints` — is bit-identical to the stage that introduced it. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `spawn`, `instancing`

**Seed:** 40100

**Node types:** `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`)

Cook it: `pcg cook graphs/pipeline-4-detail.json --stats`

## pipeline-5-roads-edits.json

**staged pipeline 5/5, edited — the settlement, its roads and authored plots**

`pipeline-5-roads.json` verbatim plus the same authored edit layer `pipeline-3-lots-edits.json` adds, so it is a superset of BOTH. The road net is built from the district centres, upstream of the `edits` slot, so `roads` and `lamps` join `terrain`, `boundary` and `districts` on the list of outputs an edit provably cannot reach — while `lots`, `footprints`, `buildings` and everything downstream of them respond to the hand-placed geometry. An edit reaches exactly as far as the dependency graph says it does, and no further.

**Tags:** `pipeline`, `staged`, `edits`, `network`

**Seed:** 40100

**Node types:** `connectPoints`, `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `promoteAttribute`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`), `roads` (from `roadJunction`.`out`), `lamps` (from `roadSpawn`.`instances`)

Cook it: `pcg cook graphs/pipeline-5-roads-edits.json --stats`

## pipeline-5-roads.json

**staged pipeline 5/5 — a road network between the district centres**

Stages 1-4 verbatim, plus the roads. ADDS `roads`, a genuine NETWORK rather than a tour: `connectPoints` in `relativeNeighborhood` mode joins the district centres into one 2-vertex `polyline` primitive per edge over the SAME points, so a centre that three roads meet at is one point of degree 3 — which `pointsToPath` cannot express, since it gives every point exactly one group (that is what the stage-3 `spine` is, and why it is a ring and not a net). The lune test is LOCAL — a pair is joined unless some third point is closer to both ends — so unlike a minimum spanning tree it survives partitioning, and it still CONTAINS one, so the net stays connected while keeping the cycles a road layout wants. Per-edge values need no edge domain: `roadWeight` is a centrality written on the centres (1 at the middle, 0 at the 63-unit rim), `roadClass` promotes it point→primitive with `min` so a road is only as wide as its weaker end, `roadKind` carries the district's name across with `first`, `roadWidth` is a field on the PRIMITIVE domain reading the promoted value, and `roadJunction` makes the return trip primitive→point with `max` so every centre learns the width of the widest road that reaches it. `place/along-curve` then walks the whole net at once — each edge is measured on its own length — and spawns `lamps`. Every earlier output — `terrain`, `boundary`, `districts`, `lots`, `footprints`, `buildings`, `props`, `vegetation` — is bit-identical to the stage that introduced it. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.

**Tags:** `pipeline`, `staged`, `network`, `topology`

**Seed:** 40100

**Node types:** `connectPoints`, `copyToPoints`, `filterByExpression`, `mergePoints`, `meshPrimitive`, `orientAlongVector`, `pointGrid`, `pointScatterInBounds`, `pointsToPath`, `promoteAttribute`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`, `subgraph`, `transformPoints`, `writeTangents`

**Primitives:** `compose/merge-tagged`, `filter/by-distance-to`, `filter/by-distance-to-curve`, `place/along-curve`, `place/drop-to-surface`, `place/plantable`, `shape/ring`, `transform/displace-by-noise`, `write/instances-by-species`, `write/random-scale`, `write/random-yaw`

**Outputs:** `terrain` (from `terrain`.`out`), `boundary` (from `wall`.`out`), `districts` (from `districts`.`out`), `lots` (from `lots`.`out`), `footprints` (from `footprints`.`out`), `buildings` (from `buildings`.`instances`), `props` (from `postSpawn`.`instances`), `vegetation` (from `trees`.`instances`), `roads` (from `roadJunction`.`out`), `lamps` (from `roadSpawn`.`instances`)

Cook it: `pcg cook graphs/pipeline-5-roads.json --stats`
