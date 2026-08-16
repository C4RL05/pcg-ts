# Node reference

Generated from the node registry metadata (`listNodeTypes()`) by `node scripts/gen-node-reference.mjs` — do not edit by hand. The same metadata, machine-readable, is in [nodes.json](./nodes.json). For the graph JSON format and field-expression grammar see [authoring.md](./authoring.md).

46 node types, grouped by `category` (node sections below are alphabetical):

**attribute**

- [attributeReduce](#attributereduce) — Collapses a numeric attribute over a whole domain into a single value on the detail domain: sum, min, max, average (all f32, componentwise, keeping the source tuple size) or count (u32, the number of elements — this mode reads no attribute).
- [attributeRemap](#attributeremap) — Rescales a numeric attribute linearly from an input range to an output range, writing f32.
- [partitionByAttribute](#partitionbyattribute) — Splits the input into one point cloud per distinct value of an i32, u32, or string point attribute (tuple 1).
- [pointNeighborhood](#pointneighborhood) — Measures each point's neighborhood inside the same cloud and writes the result as point attributes: countAttr receives how many other points lie within radius (u32), and averageAttr/averageOutAttr average a numeric point attribute over those neighbors (f32, same tuple size — averaging "P" gives each point the centroid of its neighbors, which is one Lloyd relaxation step away from even spacing).
- [promoteAttribute](#promoteattribute) — Moves an attribute between domains using the geometry's topology, creating or overwriting it on the target domain.
- [removeAttribute](#removeattribute) — Deletes named attributes from one domain.
- [sampleNearestPoint](#samplenearestpoint) — For every point of `in`, finds the nearest point of the `source` cloud in 3D (positions from P, ties resolved toward the lowest source index) and records what it found on the output's point domain: distanceAttr gets the distance (f32), indexAttr the source point index (i32), and `attribute`/`outAttribute` copy one of the source's point attributes across.
- [setAttribute](#setattribute) — Creates or overwrites an attribute on the chosen domain.
- [transferAttribute](#transferattribute) — Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain.
- [writeCurveFrame](#writecurveframe) — Writes a full orthonormal frame — `tangent`, `curveNormal` and `curveBinormal` (f32 tuple 3) — at the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived.
- [writeTangents](#writetangents) — Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path.

**composite**

- [forEach](#foreach) — Composite node that cooks an inner graph ONCE PER ELEMENT instead of once.
- [subgraph](#subgraph) — Composite node wrapping an inner graph as a single node.

**filter**

- [filterByAttribute](#filterbyattribute) — Keeps points whose named point attribute satisfies a comparison.
- [filterByBounds](#filterbybounds) — Keeps points by position against the axis-aligned box [boundsMin, boundsMax].
- [filterByDensity](#filterbydensity) — Filters points by their `density` point attribute (f32, tuple 1).
- [filterByExpression](#filterbyexpression) — Keeps points where a field-capable `predicate` evaluates to a non-zero number.
- [filterPrimitivesByAttribute](#filterprimitivesbyattribute) — Keeps WHOLE PRIMITIVES whose named PRIMITIVE attribute satisfies a comparison, and preserves topology: the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network.
- [filterPrimitivesByBounds](#filterprimitivesbybounds) — Keeps or drops WHOLE PRIMITIVES by testing their vertices against the axis-aligned box [boundsMin, boundsMax], and it is one of the two filters in this library that PRESERVE TOPOLOGY (filterPrimitivesByAttribute, which tests a value a primitive carries rather than where its vertices lie, is the other): the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network.
- [projectToPlane](#projecttoplane) — Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally; must be non-zero).
- [selfPrune](#selfprune) — Enforces a minimum distance between points, under one of two rules chosen by `mode`.

**io**

- [dataInput](#datainput) — Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph.

**point op**

- [connectPoints](#connectpoints) — Connects a point cloud into a NETWORK: one 2-vertex `polyline` primitive per edge, built over the SAME points that arrived, so every point attribute survives and a junction is genuinely one point shared by every edge that meets there.
- [copyToPoints](#copytopoints) — Copies the source point cloud onto every target point (output count = source points * target points, grouped by target).
- [jitterPoints](#jitterpoints) — Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point IDENTITY, axis).
- [mergePoints](#mergepoints) — Concatenates the points of every connected geometry, in connection order, into one point cloud.
- [mergePrimitives](#mergeprimitives) — Concatenates every connected geometry, in connection order, KEEPING TOPOLOGY: points, vertices and primitives are appended and each input's vertex and primitive references are renumbered onto its place in the result, so an authored network merged with a generated one comes out a single network.
- [orientAlongVector](#orientalongvector) — Sets the standard rot point attribute (f32 tuple 4 quaternion, [x, y, z, w]) so the chosen local axis points along `direction`, with `up` fixing the roll.
- [pathPointAt](#pathpointat) — Moves every point of every polyline to the position at a given parameter ALONG ITS OWN polyline, and writes the unit `tangent` and `curveU` it finds there.
- [pointsToPath](#pointstopath) — Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph.
- [setBounds](#setbounds) — Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing.
- [transformPoints](#transformpoints) — Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX').

**sampler**

- [pathResample](#pathresample) — Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed.
- [pathSegments](#pathsegments) — Emits ONE POINT PER SEGMENT of every polyline primitive, placed and oriented so that spawning a unit-sized asset on it draws the path as solid geometry.
- [splineSample](#splinesample) — Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve.
- [surfaceSample](#surfacesample) — Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement).
- [volumeSample](#volumesample) — Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell.

**source**

- [meshPrimitive](#meshprimitive) — Builds a parametric triangle mesh with no input: shape 'plane' is one axis-aligned rectangle, shape 'box' is six of them around a volume.
- [pointGrid](#pointgrid) — Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis.
- [pointLine](#pointline) — Creates `count` evenly spaced points on the straight segment from start to end.
- [pointScatterInBounds](#pointscatterinbounds) — Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax].
- [pointScatterInWorld](#pointscatterinworld) — Scatters points over an INFINITE lattice anchored to world coordinates, then returns the ones inside the query window [boundsMin, boundsMax).

**spawn**

- [spawnInstances](#spawninstances) — Spawner terminal: converts the input point cloud into render-agnostic instance batches.

**surface**

- [extrudePolygon](#extrudepolygon) — Treats every CLOSED polyline primitive as a polygon boundary and sweeps it along a direction into 3-vertex 'poly' triangles: a footprint becomes massing, a boundary loop becomes a wall.
- [sweepProfile](#sweepprofile) — Places a cross-section on EVERY POINT of every polyline primitive and stitches consecutive placements into 3-vertex 'poly' triangles: a curve becomes a surface.

**value**

- [valueConstant](#valueconstant) — Emits a single constant number as a value item, for feeding value pins or tagging pipelines with plain data.

## attributeReduce

Collapses a numeric attribute over a whole domain into a single value on the detail domain: sum, min, max, average (all f32, componentwise, keeping the source tuple size) or count (u32, the number of elements — this mode reads no attribute). NaN elements are ignored by every mode, and average divides by however many were left, so one bad element cannot destroy the statistic; this is the deliberate difference from promoteAttribute point->detail, which propagates NaN. The other difference is outName: two reductions of one attribute (a min AND a max) can coexist, which promoting cannot do because both would land on the same detail name. Over an empty domain sum and average are 0, min is Infinity, max is -Infinity, count is 0. Note that a detail attribute is NOT readable from a point-domain field (a field reads the domain it lands on), so a reduction is for hosts, inspection and cook-stat reporting — to rescale an attribute by its own observed range use attributeRemap's 'fit' mode, which measures it internally.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Numeric attribute to reduce (tuple 1..4). Must exist on `domain`. Ignored by mode 'count', which counts elements and may leave this empty. |
| `domain` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain to reduce over: point, vertex, primitive, or detail (one element). |
| `mode` | enum | `"max"` |  | `sum`, `min`, `max`, `average`, `count` |  | How the elements collapse: sum, min, max, average (each componentwise over the tuple, NaN elements skipped), or count (how many elements the domain has, ignoring `name`). |
| `outName` | string | `""` |  |  |  | Name of the detail attribute to write. Empty (the default) reuses `name`, which is what promoting would have produced; give distinct names to hold several reductions of one attribute at once. The shape is this node's to pick (f32 at the source's tuple size, or u32 for mode 'count'), so a name the DETAIL domain already holds under a different shape is REFUSED rather than deleted and re-added — writing it would destroy that column while the cook still looked fine. A same-shape column is reused and reset. The one exception is reducing a detail attribute into its own name: there the column replaced is the column read, so it converts in place. |

## attributeRemap

Rescales a numeric attribute linearly from an input range to an output range, writing f32. Mode 'range' uses inMin/inMax as given — the hand-tuned remap(x, -1, 1, 0, 1) that every noise-driven graph writes. Mode 'fit' MEASURES the attribute's own range over the domain first (ignoring NaN) and uses that, which is what turns any invented quantity — a neighbor count, a hand-built score — into a usable 0..1 density or color input without knowing its scale in advance; it is also why this node needs no help from attributeReduce, whose detail-domain output no field or param could have read back anyway. An empty input range (inMin == inMax, or a fit over zero usable elements) maps everything to outMin, matching the `remap` field function. Tuples remap componentwise against one shared range, and NaN stays NaN in every mode — including the empty-range case, so unmeasurable data never turns into a valid-looking value. Reversed output ranges are fine and invert the values.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Numeric attribute to rescale (tuple 1..4). Must exist on `domain`. |
| `outName` | string | `""` |  |  |  | Name of the f32 attribute to write on the same domain. Empty (the default) rewrites `name` in place, which also converts an integer attribute to f32. Writing over a DIFFERENT attribute that already exists with another shape is REFUSED rather than deleted and re-added — remapping into an i32 `id` or into `P` would destroy that column while the cook still looked fine. A same-shape column is reused, and the in-place conversion above stays legal because there the column replaced is the one being read. |
| `domain` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain the attribute lives on: point, vertex, primitive, or detail. |
| `mode` | enum | `"range"` |  | `range`, `fit` |  | 'range' takes the input range from inMin/inMax; 'fit' measures the attribute's actual minimum and maximum over the domain and ignores inMin/inMax. |
| `inMin` | f32 | `-1` |  |  |  | Value mapped to outMin, in mode 'range'. Ignored in mode 'fit'. |
| `inMax` | f32 | `1` |  |  |  | Value mapped to outMax, in mode 'range'. Ignored in mode 'fit'. |
| `outMin` | f32 | `0` |  |  |  | Value inMin maps to. |
| `outMax` | f32 | `1` |  |  |  | Value inMax maps to. |
| `clamp` | bool | `false` |  |  |  | Hold results inside the output range (whichever of outMin/outMax is smaller or larger). False (the default) extrapolates, matching the `remap` field function; true is the usual choice when the result feeds density or color. In mode 'fit' it only affects NaN-free data trivially, since fitted values already land inside the range. |

## connectPoints

Connects a point cloud into a NETWORK: one 2-vertex `polyline` primitive per edge, built over the SAME points that arrived, so every point attribute survives and a junction is genuinely one point shared by every edge that meets there. This is how you get roads between district centres, a trail net between camps, or a triangulated-looking scaffold to displace. There is no edge domain and none is needed — per-edge values come from promoteAttribute point->primitive (`min` for a width, `first` for a kind) and setAttribute on domain 'primitive', and per-junction values from promoteAttribute primitive->point (`max`). mode 'radius' connects every pair closer than `radius`. mode 'relativeNeighborhood' keeps such a pair ONLY when no third point is closer to BOTH of its endpoints than they are to each other (the lune test): that thins a dense blob into a road-like net that still CONTAINS a minimum spanning tree — so the network stays connected wherever the radius does — while leaving the cycles a road layout wants and a tree does not have. Distances are 3D over P and the test is STRICT (d < radius), which is what makes this node's answer independent of how the cloud was windowed: a pair at exactly `radius` is not an edge. Edges come out in a canonical order fixed by the POINTS (identity, then position bits, then seed) and never by the order they arrived in, and each edge's FIRST vertex is its lower-keyed endpoint — reorder the input and you get the same network, permuted. PARTITIONING: an edge reads two stored positions and no third point, so a cell that also holds every point within `radius` of its own rectangle decides its edges exactly; emit an edge from the cell that owns its FIRST vertex under the half-open rule (filterByBounds' 'halfOpen'), and the cells tile the network with no duplicate and no gap. The wiring is three NODES, so a partitioned network cook is a serializable graph and needs no host code: widen the cell's rectangle by `radius` and clip the cloud to it with filterByBounds ('halfOpen'), run this node, then run filterPrimitivesByBounds on the UNWIDENED rectangle with vertex 'first' and the same 'halfOpen' boundary — that node keeps the primitives whose FIRST vertex lies back inside the cell, and it is one of the two filters in the library that trim topology instead of dropping it. The relativeNeighborhood witness lies inside the pair's own neighbourhood, so it needs no wider halo. Any existing topology on the input is REPLACED, and its vertex and primitive attributes drop with it. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a network that passes through one stops being a network — use mergePrimitives to combine this node's output with another network, an authored path or a mesh, which concatenates points, vertices AND primitives and renumbers the references; category is not the rule, since projectToPlane is categorised `filter` and PRESERVES topology, and so do filterPrimitivesByBounds and filterPrimitivesByAttribute, which filter the PRIMITIVE domain and are the nodes to reach for when a network has to be cut down rather than a cloud — the second tests a primitive attribute, so a network thinned by its own `lengthAttr` (or by a promoted or setAttribute-authored per-edge value) stays a network, and the thinning happens before anything downstream pays for the edges it removes. degreeAttr and lengthAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"radius"` |  | `radius`, `relativeNeighborhood` |  | Which pairs become edges. 'radius' connects every pair closer than `radius` — dense, and the count grows with the square of the point count. 'relativeNeighborhood' additionally requires that no third point is closer to BOTH endpoints than they are to each other, which keeps a sparse, road-like net (it contains a minimum spanning tree, so it does not disconnect what the radius reached, and it keeps cycles, so it is a network rather than a tree). Both modes read the same radius neighbourhood, so 'relativeNeighborhood' costs at least as much to compute and is bounded by the same edge limit. |
| `radius` | f32 | `1` | >= 0 |  |  | Largest distance that can become an edge, in world units, tested STRICTLY: a pair at exactly `radius` is NOT connected. That strictness is deliberate and is what makes a partitioned cook exact — a neighbour lying exactly on a cell's far face is excluded from the cell by the half-open ownership rule, and under a strict test it is not an edge of anything that cell owns either, so the two conventions cannot disagree. 0 builds no edges. This is a plain number and not a field on purpose: a per-point radius would make 'A is near B' disagree with 'B is near A', and an edge would then depend on which endpoint asked. |
| `degreeAttr` | string | `""` |  |  |  | Name of a u32 point attribute receiving each point's DEGREE — how many emitted edges touch it (0 for an isolated point). Empty (the default) writes none. Use it to size junctions, or to find the dead ends of a network with filterByAttribute. The shape is this node's to pick (u32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten: writing it would delete that column outright and the cook would still look fine (degreeAttr "P" would leave a cloud with no positions). A same-shape column IS reused and reset, so re-running this node over its own output is fine. |
| `lengthAttr` | string | `""` |  |  |  | Name of an f32 PRIMITIVE attribute receiving each edge's length in world units. Empty (the default) writes none. Handy as a width or cost driver, and as a filter key once the network is promoted. The shape is this node's to pick (f32, tuple 1), so a name already present on the output's primitive domain under a different shape is REFUSED — which in practice means `primtype`, the string attribute that marks these primitives as polylines and without which nothing downstream would recognise them. Note that the input's own primitive attributes are dropped by the topology replacement before this is written. |

## copyToPoints

Copies the source point cloud onto every target point (output count = source points * target points, grouped by target). Transforms compose per copy: P = targetP + targetRot * (targetScale * sourceP), rot = targetRot * sourceRot (quaternion product), scale = targetScale * sourceScale (componentwise), and each copied seed is hashCombine(sourceSeed, targetSeed). All other source point attributes are carried through unchanged; missing transform attributes are treated as identity. `targetNames` additionally carries named TARGET point attributes onto the copies: every copy in a target's block receives that target's value, in a column keeping the target's type, tuple size and default. That is what lets copies vary by what the author computed on the target cloud — a species tag, an age, a noise sampled per target — since the copies are otherwise identical in everything but placement. The composed transform attributes cannot be carried, a name the source already carries is refused rather than silently overwritten, a name repeated in the list is refused, and a name absent from the target is an error. `targetIndexAttr` writes the target's INDEX rather than one of its attributes, which is what makes "one thing per target" — one path per anchor, one group per instance — expressible without an upstream setAttribute whose only job was to give this node something to carry. The source's TOPOLOGY is dropped by default — an array of a path comes out a bare cloud — and `topology "keep"` re-emits every source primitive once per target instead, which is what makes the array of paths a set of paths without rebuilding them downstream.

**Category:** point op

**Inputs:** `source` (geometry), `target` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `targetNames` | stringList | `[]` |  |  |  | Target point attributes to carry onto the copies, in any order. Each copy in a target's block gets that target's value, and the column arrives with the target's type, tuple size and default. An empty list carries nothing, which is the default and not an error. Three kinds of name are refused rather than resolved silently: "P", "rot", "scale" and "seed", because they are composed per copy and already hold the target's contribution (copy one to another name on the target with setAttribute and carry that to get the raw value); a name repeated in the list; and a name the source also carries, because the two would write the same column. A name absent from the target is an error listing what the target does carry. |
| `targetIndexAttr` | string | `""` |  |  |  | Name of an i32 point attribute to write the TARGET INDEX into — 0 for every copy that landed on the first target point, 1 for the second, and so on. Empty (the default) writes nothing. This is the key downstream nodes group by: pointsToPath's `groupAttr` turns "the copies of one target" into one path per target, and partitionByAttribute turns them into one item each. The node already computes this index to place the copies, so naming it here replaces the setAttribute writing `{"fn":"index"}` on the target purely so `targetNames` had something to carry. The column is i32, tuple size 1, default -1 (which no copy ever gets, so an element appended later reads as belonging to no target). Refused for the same three reasons `targetNames` refuses a name: "P", "rot", "scale" and "seed" are composed per copy, a name the source already carries would have two writers, and so would a name `targetNames` is carrying. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the SOURCE's topology — the vertices and primitives built over the source's points. 'drop' (the default) copies POINTS only: an array of a path comes out a bare cloud with the paths gone, which is why the copies have to be rebuilt downstream (targetIndexAttr, then a pointsToPath grouping on it). 'keep' re-emits every source primitive once per TARGET: the copies are laid out in contiguous blocks of nSource (copy s of target t is point t * nSource + s), so primitive p of block t walks exactly the points its original walked, t * nSource further on. That is what mergePrimitives produces from nTarget copies of the source, and it is the whole difference between an array of points and an array of paths. Nothing is filtered and no primitive is reshaped: a source with N primitives always yields nTarget * N, in target-block order. The source's VERTEX and PRIMITIVE attributes come along, each copy carrying the original's values (a per-primitive width, a per-vertex uv, and `primtype`, so the copies stay samplable as what they are). The TARGET's own topology is never read under either setting — the target contributes point transforms and, through targetNames/targetIndexAttr, point attributes, while its primitives describe points that are not in this output at all. The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information, and neither targetNames nor targetIndexAttr (which write point columns) can be disturbed by it. The DETAIL domain is carried under NEITHER setting, for the reason mergePrimitives gives for dropping it: there are two inputs, each has a detail domain, and choosing between them would be a guess. On IDENTITY, because it decides what per-copy randomness does: a primitive is named by the fold of its own points' identities, and a point's identity is its position bits plus its `seed` — both of which this node composes per copy (P from the target's transform, seed from hashCombine(sourceSeed, targetSeed)). So the nTarget copies of one source primitive are nTarget DISTINCT primitives, and a randomField on the primitive domain draws a different value for each, which is what 'one variation per copy' needs. The exception is the one mergePrimitives documents: two targets sharing a position AND a seed produce copies that are the same points, hence ONE primitive to every identity-keyed decision — give coincident targets distinct seeds. |

## dataInput

Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph. Items hash by rev in memo keys, so caching stays correct as items are swapped.

**Category:** io

**Inputs:** *(none)*

**Outputs:** `out` (any)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `items` | items | `[]` |  |  |  | Data items to emit, bound at runtime via graph.setParam (the World binds parent-cell outputs here, per cell, at bind time). Live DataItems are runtime-injected and never serialized: a serialized graph carries an empty item list, and items must be re-bound after deserialization. |

## extrudePolygon

Treats every CLOSED polyline primitive as a polygon boundary and sweeps it along a direction into 3-vertex 'poly' triangles: a footprint becomes massing, a boundary loop becomes a wall. This is the node a pipeline that already computed its plots has been waiting for — a closed quad per lot renders as four hairlines until something gives it a third dimension. Output carries P, a `normal` (f32 tuple 3) and a `uv` (f32 tuple 2) the node writes itself, plus every INPUT POINT attribute copied onto the points that came from it and every input PRIMITIVE attribute gathered onto the triangles, so a per-lot `lotId` or `districtKind` survives; input VERTEX attributes are dropped. `normal` and `uv` are reporting slots — an input already carrying either at a different shape is REFUSED by name rather than silently deleted. On the walls `u` runs 0..1 around the boundary by ARC LENGTH (so a plot with one long side does not stretch its texture there) and `v` 0..1 from bottom to top; on the caps both run 0..1 across the footprint's own bounding box in the plane perpendicular to the direction. Walls, top cap and bottom cap keep SEPARATE points, so the edge where a roof meets a wall stays a crease instead of being shaded round. Caps are fan-triangulated from the boundary's first point, which is exact for a CONVEX footprint and is all the topology records — a concave footprint gets triangles outside itself, so subdivide it upstream. An OPEN polyline is refused by name: extrusion is not defined on one, and the fix is pointsToPath with `closed: true`. Winding is derived from the polygon's own Newell normal against the direction and against the sign of `distance`, so a footprint wound either way, extruded either way, comes out facing outward.

**Category:** surface

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `distance` | f32 | `3` |  |  | yes | How far the boundary travels along the direction, in world units. Field-capable and resolved on the INPUT points — the footprint's own points — so a per-point value gives a sloped top rather than a flat one, and a per-lot height living on the primitive domain becomes a field once promoteAttribute has put it on the points. A negative distance builds the solid on the OTHER side of the footprint and still comes out facing outward — the winding flips with it. A footprint whose distances straddle zero is a bowtie and has no outward side; the sign of their sum decides, which is total rather than right. |
| `direction` | enum | `"+y"` |  | `+y`, `vector`, `polygonNormal` |  | Which way the boundary travels. '+y' is straight up, the answer for buildings and walls on a ground plane. 'vector' uses the `vector` param, normalized. 'polygonNormal' computes each polygon's OWN normal by Newell's method — a sum over the boundary edges, so it is exact for a planar polygon, deterministic, and defined for a non-planar one (it returns the best-fit plane's normal) — which is what extrudes a footprint that is not lying flat. A polygon whose Newell normal is zero (every point collinear, or zero area) is refused by primitive index. |
| `vector` | vec3 | `[0,1,0]` |  |  |  | Direction for the 'vector' mode; need not be unit length, and is normalized before use. Ignored by the other modes. A zero-length vector is refused rather than producing a flat sheet. Not field-capable on purpose: it names the direction of the whole extrusion, and a per-point one would not be a sweep — that is what `distance` is for. |
| `caps` | enum | `"both"` |  | `none`, `top`, `bottom`, `both` |  | Which ends are closed. 'both' is a solid; 'bottom' or 'top' alone leaves an open shell (with `sides` false, 'top' is a floating lid — a roof with no building); 'none' with `sides` is a tube of wall. Each cap faces along its OWN plane's normal rather than along the direction, which is what makes a per-point `distance` shade as the sloped roof it actually builds, and what keeps a footprint lying in a tilted plane correct when it is extruded straight up. |
| `sides` | bool | `true` |  |  |  | Build the wall between the two ends. False keeps only the caps the `caps` param asked for, which is how a flat slab (`caps: 'bottom'`) or a floating roof (`caps: 'top'`) is spelled without a second node. False with `caps: 'none'` has nothing to build and is refused. |

## filterByAttribute

Keeps points whose named point attribute satisfies a comparison. Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value` with any comparison. String attributes compare against `stringValue` and support only 'eq' and 'ne'. Output is a point cloud of the survivors with all attributes carried, so by default the topology describing the points that are gone goes with them — all of it. Two ways to keep a network a network: set `topology` to 'keep' here, which preserves every primitive ALL of whose points survived and drops the rest, or reach for filterPrimitivesByAttribute, which is this node at the PRIMITIVE domain and tests a value the primitive itself carries.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `attribute` | string | `"density"` |  |  |  | Name of the POINT attribute to test. Must exist on the point domain with tuple size 1. A name that exists on the primitive domain instead is refused with the fix, since filtering a primitive column here means letting a sampler flatten it onto points first. |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne. |
| `value` | f32 | `0` |  |  |  | Right-hand side for numeric attributes. Ignored for string attributes. |
| `stringValue` | string | `""` |  |  |  | Right-hand side for string attributes. Ignored for numeric attributes. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter. |

## filterByBounds

Keeps points by position against the axis-aligned box [boundsMin, boundsMax]. What happens ON a face is the `boundary` param, and it is the difference between a selection and an OWNERSHIP RULE: the default 'halfOpen' keeps min <= p < max on every axis — the min face is inside, the max face is not — so two boxes that MEET at a face (one's max is the other's min, the same number) tile space with no gap and no duplicate, and each point belongs to exactly one of them. That is the rule a grid cell uses, and the one pointScatterInWorld's query window and a World cell rectangle already follow; note that it is the shared ENDPOINT VALUE that makes the tiling exact, so building the boxes as [c*size, (c+1)*size) is exact at any size, while recovering the index arithmetically as floor(p / size) can name the neighbouring cell when size is not exactly representable (floor(67.8 / 0.1) is 677, yet 678*0.1 is exactly 67.8). 'inclusive' keeps min <= p <= max, which is what you want to select a box whose faces carry points on purpose, and which emits a point sitting on a shared face from BOTH neighbouring boxes — harmless in a one-off selection, wrong in a partitioned cook, where a doubled point is invisible until two cells disagree. mode 'outside' is the exact complement of 'inside' under whichever boundary rule is active, so the two modes always partition the input: no point lost, none emitted twice. Infinite bounds work under both rules (every finite coordinate satisfies p < +Infinity), so an axis that should not be bounded — the Y of a World 'xz' column — needs no extra param. A NaN coordinate is never inside, so such a point lands in 'outside'. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `boundsMin` | vec3 | `[0,0,0]` | (±Infinity ok, but never serializes) |  |  | Minimum corner of the box, in world units. INCLUSIVE under both boundary rules: a point lying exactly on this face is inside. Use -Infinity on an axis that should not be bounded (an infinity does not survive JSON, so a graph that must serialize needs a finite bound wide enough to hold the world). |
| `boundsMax` | vec3 | `[1,1,1]` | (±Infinity ok, but never serializes) |  |  | Maximum corner of the box, in world units. EXCLUSIVE under the default 'halfOpen' boundary (a point exactly on this face belongs to the next box along), INCLUSIVE under 'inclusive'. Use +Infinity on an axis that should not be bounded. An axis with max <= min keeps nothing under 'halfOpen' — a zero-width box has no interior — while under 'inclusive' max === min still keeps the points lying exactly on that plane. |
| `mode` | enum | `"inside"` |  | `inside`, `outside` |  | 'inside' keeps points within the box, 'outside' keeps the rest. They are exact complements under whichever `boundary` rule is active, so running both over one input reproduces it exactly once. |
| `boundary` | enum | `"halfOpen"` |  | `halfOpen`, `inclusive` |  | Which faces belong to the box. 'halfOpen' (the default) keeps min <= p < max on every axis, matching the half-open windows of pointScatterInWorld and of a World cell: two abutting boxes then own a point on their shared face exactly once between them, which is what makes this node usable as the ownership rule of a partitioned cook. 'inclusive' keeps min <= p <= max, so BOTH such boxes emit that point — choose it when the box is a selection whose faces carry points deliberately (a pointGrid's last row, an authored extent) and nothing downstream requires one owner per point. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter. |

## filterByDensity

Filters points by their `density` point attribute (f32, tuple 1). mode 'threshold' keeps points with density >= threshold; mode 'probabilistic' keeps each point when a deterministic per-point hashed random in [0, 1) is < its density (so density 0 never survives, 1 always does). The probabilistic draw is keyed on each point's IDENTITY — its stored position bits together with its `seed` point attribute — not on its array index, so the same point survives or does not whatever order it arrives in and whichever cell derived it. Two points that share a position AND a seed are one point as far as that draw is concerned and always decide the same way, so a cloud with no per-point seeds (the attribute defaults to 0) decides purely on position. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"threshold"` |  | `threshold`, `probabilistic` |  | 'threshold' keeps density >= threshold; 'probabilistic' keeps each point with probability equal to its density. |
| `threshold` | f32 | `0.5` |  |  |  | Minimum density a point needs to survive in 'threshold' mode. Ignored in 'probabilistic' mode. |
| `seed` | u32 | `0` |  |  |  | Extra seed for 'probabilistic' mode; change it to re-roll which points survive. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter. |

## filterByExpression

Keeps points where a field-capable `predicate` evaluates to a non-zero number. The predicate is resolved once over the input's point domain, so it can read position, any attribute, noise, or per-point randomness — which means a test that would otherwise need a scratch attribute plus filterByAttribute becomes one node, with no leftover column on the output. Comparison field functions (gt/ge/lt/le/eq/ne) already yield 1 and 0, and combining them with mul acts as AND, max as OR. NaN never passes, so a predicate that fails to compute drops the point instead of keeping it. The predicate must evaluate to tuple size 1: comparisons broadcast elementwise, so comparing a vector yields a vector of flags, which is not a decision. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `predicate` | f32 | `1` |  |  | yes | Per-point test: non-zero keeps the point, 0 and NaN drop it. Field-capable and evaluated on the input's points. The default 1 keeps everything, so an unconfigured node passes its input through. |
| `seed` | u32 | `0` |  |  |  | Extra seed for evaluating `predicate`: 0 (the default) uses the node's derived seed unchanged; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the evaluation context (randomField, the per-point seed attribute, and the `nodeSeed` field) but not a noise on its own, whose seed lives inside its own field spec — a noise moves with this only when its `opts.position` reads `nodeSeed`. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter. |

## filterPrimitivesByAttribute

Keeps WHOLE PRIMITIVES whose named PRIMITIVE attribute satisfies a comparison, and preserves topology: the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network. It is filterByAttribute at the primitive domain — the same six comparisons, the same numeric/string split, the same scalar-only rule — and filterPrimitivesByBounds' sibling, differing only in what it asks about a primitive (a value it carries, rather than where its vertices lie). Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value`; string attributes compare against `stringValue` and allow only 'eq' and 'ne', which includes `primtype`, so 'primtype eq polyline' is how a mixed geometry is narrowed to its curves. WHY IT MATTERS WHERE THE FILTER SITS: a primitive attribute — connectPoints' edge length, a promoted density, anything promoteAttribute lifted onto the primitive domain — can also be read AFTER a sampler has flattened it onto points, because every sampler carries primitive columns down onto the points it makes; filterByAttribute then works, and that is how such graphs were written before this node existed. The cost is that the flattening, and everything downstream of it, runs on primitives that were always going to be discarded. Filtering here instead discards them while they are still primitives, so the work that follows is proportional to what survives rather than to what was proposed. POINTS: by default (unreferencedPoints 'keep') the point domain is passed through untouched — same points, same indices, same attributes, same identities — so anything computed per point upstream still lines up and a partition cell keeps its halo; 'drop' removes every point no surviving primitive references and renumbers the topology onto what is left, which is how a clean network comes out. DETERMINISM: the test reads one primitive's own value and nothing else — not its index, not its neighbours, not how many primitives there are — so the survivors and their order are the input's however the cook was partitioned, and no index column is emitted for a per-partition number to leak through. An EMPTY primitive domain that still carries the named column is an empty result rather than an error, as in filterPrimitivesByBounds: a cell too sparse to make a primitive is a legitimate, silent case in a partitioned cook. A geometry with no primitive columns at all is refused instead, and told so — that is a topology never built or dropped upstream, not a sparse cell.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `attribute` | string | `"edgeLength"` |  |  |  | Name of the PRIMITIVE attribute to test. Must exist on the primitive domain with tuple size 1. The default names connectPoints' own convention for its `lengthAttr`, which is the commonest key here; `primtype` is always present once a geometry has topology and is tested with 'eq'/'ne' against stringValue. A name that exists on the POINT domain instead is refused with the fix, since that is the shape of the idiom this node replaces. |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne. Identical to filterByAttribute's, deliberately: moving a filter between the two domains must not change what it means. |
| `value` | f32 | `0` |  |  |  | Right-hand side for numeric attributes. Ignored for string attributes. |
| `stringValue` | string | `""` |  |  |  | Right-hand side for string attributes. Ignored for numeric attributes. |
| `unreferencedPoints` | enum | `"keep"` |  | `keep`, `drop` |  | What happens to points no surviving primitive references, exactly as in filterPrimitivesByBounds. 'keep' (the default) leaves the point domain completely untouched: same points in the same order, so every point index, attribute and identity is still the input's. 'drop' removes them and renumbers the topology onto the points that remain, in ascending input order, which yields a clean network with nothing dangling; the cost is that point indices move. Note that 'drop' also drops points that had NO primitive to begin with, so a cloud carrying both a network and unrelated scatter loses the scatter. |

## filterPrimitivesByBounds

Keeps or drops WHOLE PRIMITIVES by testing their vertices against the axis-aligned box [boundsMin, boundsMax], and it is one of the two filters in this library that PRESERVE TOPOLOGY (filterPrimitivesByAttribute, which tests a value a primitive carries rather than where its vertices lie, is the other): the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network that goes in comes out a network. Every point filter — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune — rebuilds the point domain from the survivors and the primitives go with it; this node filters the PRIMITIVE domain instead, which is what makes the difference. It exists to complete the partitioned network cook connectPoints prescribes, whose last step no node could perform: widen the cell's rectangle by `radius` and clip the CLOUD to it with filterByBounds ('halfOpen'), run connectPoints, then run THIS node on the UNWIDENED rectangle with vertex 'first' and the same 'halfOpen' boundary. Each cell then emits exactly the edges it owns, the cells tile the whole-region network with no duplicate and no gap, and the recipe is a serializable graph rather than a TypeScript script. `vertex` decides what 'in the box' means for a primitive: 'first' and 'last' consult ONE vertex, which is what makes them OWNERSHIP rules — every primitive has exactly one first vertex, so exactly one box of a tiling claims it — while 'all' and 'any' are SELECTIONS and do not tile ('any' claims a straddling primitive from every box it reaches, 'all' from none of them). connectPoints emits each edge's lower-keyed endpoint FIRST, so with vertex 'first' this node's owner and that node's canonical edge order are the same choice by construction. For a polyline from any other source — pointsToPath, resamplePath, createPolyline — the first vertex is simply the path's START point: still exactly one owner per path, so the tiling is still exact, but the owner is the cell holding the start rather than the cell holding most of the road, and that one cell emits the whole path however far it runs. `mode` 'outside' is the exact complement of 'inside' under whichever vertex rule and boundary are active, so running both over one input reproduces its primitives exactly once; combined with `vertex` that spans the four quantifiers — 'all'+'inside' keeps primitives lying entirely inside, 'any'+'outside' those lying entirely outside, 'any'+'inside' those touching the box, 'all'+'outside' those not entirely within it. `boundary` is filterByBounds' rule with the same meaning and the same reason to prefer 'halfOpen' wherever ownership matters. POINTS: by default (unreferencedPoints 'keep') the point domain is passed through untouched — same points, same indices, same attributes, same identities — so a partition cell keeps its halo points as isolated leftovers; 'drop' removes every point no surviving primitive references and renumbers the topology onto what is left, which is how a clean network comes out. A geometry with no primitives is not an error but an empty result: a cell too sparse to make an edge is a legitimate, silent case in a partitioned cook. Primitives of any kind are handled, polylines and polys alike — this reads vertices, never `primtype`.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `boundsMin` | vec3 | `[0,0,0]` | (±Infinity ok, but never serializes) |  |  | Minimum corner of the box, in world units. INCLUSIVE under both boundary rules: a vertex lying exactly on this face is inside. Use -Infinity on an axis that should not be bounded (note that an infinity does not survive JSON, so a graph that must serialize needs a finite bound wide enough to hold the world). |
| `boundsMax` | vec3 | `[1,1,1]` | (±Infinity ok, but never serializes) |  |  | Maximum corner of the box, in world units. EXCLUSIVE under the default 'halfOpen' boundary (a vertex exactly on this face belongs to the next box along), INCLUSIVE under 'inclusive'. Use +Infinity on an axis that should not be bounded, subject to the serialization note on boundsMin. |
| `vertex` | enum | `"first"` |  | `first`, `last`, `all`, `any` |  | Which of a primitive's vertices the box test reads. 'first' (the default) and 'last' read exactly ONE — the primitive's first or last vertex — which is what makes them ownership rules: every primitive has exactly one of each, so abutting boxes under the 'halfOpen' boundary claim it exactly once between them. Use 'first' with connectPoints, whose edges already lead with their lower-keyed endpoint, so the owner a cell computes matches the canonical edge order rather than merely correlating with it. 'all' keeps a primitive only when EVERY vertex is in the box, 'any' when at least one is; both are selections, and neither tiles — 'any' hands a straddling primitive to every box it reaches and 'all' to none of them, so a partitioned cook using either double-counts or loses edges at the seams. A primitive with no vertices is never inside, under all four rules. |
| `mode` | enum | `"inside"` |  | `inside`, `outside` |  | 'inside' keeps the primitives the `vertex` rule places in the box, 'outside' keeps the rest. They are exact complements under whichever vertex rule and boundary are active, so running both over one input reproduces every primitive exactly once. Read the two params together: 'any' with 'outside' keeps primitives lying ENTIRELY outside the box (no vertex inside), which is the deletion 'all' with 'outside' does NOT perform — that one keeps everything not entirely within it, straddlers included. |
| `boundary` | enum | `"halfOpen"` |  | `halfOpen`, `inclusive` |  | Which faces belong to the box, exactly as in filterByBounds. 'halfOpen' (the default) keeps min <= p < max on every axis, so two boxes meeting at a face claim a vertex lying on it exactly once between them — pair it with vertex 'first' and it is an ownership rule a partitioned cook can tile with. 'inclusive' keeps min <= p <= max, so both boxes claim that vertex, and with vertex 'first' both would emit the same edge; choose it for a selection whose faces carry points on purpose, never for a cook that is split into cells. |
| `unreferencedPoints` | enum | `"keep"` |  | `keep`, `drop` |  | What happens to points no surviving primitive references. 'keep' (the default) leaves the point domain completely untouched: same points in the same order, so every point index, attribute and identity is still the input's and anything computed per point upstream still lines up — a partition cell keeps its halo points as isolated leftovers beside the network it owns. 'drop' removes them and renumbers the topology onto the points that remain, in ascending input order, which yields a clean network with nothing dangling; the cost is that point indices move, and that a point kept by one cell may also be kept by its neighbour, since an edge crossing a seam needs both of its endpoints wherever it is emitted. Note that 'drop' also drops points that had NO primitive to begin with, so a cloud carrying both a road network and unrelated scatter loses the scatter — filter such a cloud before the network is built, or keep the leftovers. |

## forEach

Composite node that cooks an inner graph ONCE PER ELEMENT instead of once. Exactly one exposed input must be named "each" (one iteration per item of the collection on that pin) or "eachPoint" (one iteration per point of the one geometry on that pin, the body seeing a one-point cloud); every other exposed input is broadcast whole to every iteration. Each iteration's outputs are concatenated onto the matching output pin in the iterated collection's own order, and carry the iterated item's tags. Every iteration is seeded on its element's CONTENT — position bits, the seed attribute and the tags — never on its position in the collection, so reordering the input reorders the output without re-rolling any of it. Pins and params are per-instance exactly as for "subgraph", and the serialized form is the same payload: create instances with forEachNode(innerGraph, exposedInputs, exposedOutputs, exposedParams), or deserialize a graph containing one. The body gets no memo reuse between iterations, by construction — each rotates the inner seed, and a node holds one cache slot.

**Category:** composite

**Inputs:** *(none)*

**Outputs:** *(none)*

**Params:** *(none)*

## jitterPoints

Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point IDENTITY, axis). Identity is the point's incoming position bits together with its `seed` point attribute, not its array index, so the offset belongs to the point: reorder the cloud, drop points upstream, or derive the same region inside another cell's halo, and every point still moves exactly as far. Two points that share a position AND a seed move identically and stay coincident (the `seed` attribute defaults to 0, so a cloud with no per-point seeds jitters on position alone). amount is field-capable (evaluated on the input positions; tuple 1 broadcasts to all axes).

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `amount` | vec3 | `[0.1,0.1,0.1]` |  |  | yes | Maximum offset per axis, in world units. Field-capable (tuple 1 broadcasts). |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the jitter. |

## mergePoints

Concatenates the points of every connected geometry, in connection order, into one point cloud. The output carries the union of all point attributes: an attribute missing on an input fills with its default over that input's range. Attributes sharing a name must agree on type and tuple size. Topology (vertices/primitives) is not carried — the result is points only, so a network or a mesh arrives here and leaves as a bare cloud; `mergePrimitives` is the twin that keeps it. Output tags are the union of input tags.

**Category:** point op

**Inputs:** `in` (geometry, multi)

**Outputs:** `out` (geometry)

**Params:** *(none)*

## mergePrimitives

Concatenates every connected geometry, in connection order, KEEPING TOPOLOGY: points, vertices and primitives are appended and each input's vertex and primitive references are renumbered onto its place in the result, so an authored network merged with a generated one comes out a single network. The topology-preserving twin of mergePoints, which carries points only and so turns any input into a bare cloud. The point, vertex and primitive domains each carry the union of that domain's attributes: an attribute missing on an input fills with its default over that input's range, and attributes sharing a name must agree on type and tuple size. The one exception is `primtype`, which is a type tag rather than a value: each input's primitives keep their own tag, and primitives from an input carrying no primtype column come out with an EMPTY tag rather than inheriting another input's — this node cannot know what an untagged primitive is and must not guess. One consequence to know before relying on absence: surfaceSample ignores the tag entirely when a geometry has NO primtype column, so an untagged triangle mesh samples fine alone but is skipped once a tagged input is merged in and the column exists — tag such a mesh upstream (createTriangleMesh does) rather than leaving it untagged. Mixed primitive types are allowed, because every consumer selects what it understands (surfaceSample takes 3-vertex `poly`, the path nodes take `polyline`). An input with no topology contributes its points and no primitives, which is not an error. The detail domain is not carried: every input has one and choosing between them would be a guess. Output tags are the union of input tags. Point identity is position bits plus the `seed` attribute and both are copied verbatim, so two inputs holding a point at the same position with the same seed are ONE point to every identity-keyed decision (jitter, probabilistic filters, randomField) — the same inherited hazard mergePoints carries. Give clouds that must stay distinct distinct seeds.

**Category:** point op

**Inputs:** `in` (geometry, multi)

**Outputs:** `out` (geometry)

**Params:** *(none)*

## meshPrimitive

Builds a parametric triangle mesh with no input: shape 'plane' is one axis-aligned rectangle, shape 'box' is six of them around a volume. Output carries P (f32 tuple 3), a uv point attribute (f32 tuple 2) running 0..1 across each face, and one 3-vertex 'poly' primitive per triangle — everything surfaceSample, transferAttribute's 'uv' and 'raycast' mappings, and promoteAttribute need. This is the only mesh source that survives serialization: dataInput's items are injected at runtime and a saved graph carries none, so a graph that must cook from JSON alone gets its surface from here. Plane normals point along the positive third axis (+y for orientation 'xz', +z for 'xy', +x for 'yz'); box normals point outward. Point order is u fastest then v, one block per face in the order +x, -x, +y, -y, +z, -z; a box's faces do not share points, so uv seams are exact. A zero size component makes degenerate (zero-area) triangles, which area-weighted sampling and the raycast mapping skip.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `shape` | enum | `"plane"` |  | `plane`, `box` |  | 'plane' builds one rectangle in the world plane named by `orientation`; 'box' builds a closed six-sided box of the full `size` extents (and ignores `orientation`). |
| `size` | vec3 | `[10,10,10]` | >= 0 |  |  | Full extents along world x, y, z, in world units (not half-extents). For 'plane', the component along the plane's normal axis is ignored. |
| `center` | vec3 | `[0,0,0]` |  |  |  | World position of the shape's center. |
| `orientation` | enum | `"xz"` |  | `xz`, `xy`, `yz` |  | Which world plane a 'plane' lies in, and so which axis is its normal: 'xz' is the ground plane (normal +y), 'xy' faces +z, 'yz' faces +x. Ignored for 'box'. |
| `subdivisions` | vec3 | `[1,1,1]` | >= 1 |  |  | Quads along world x, y, z — whole numbers, minimum 1. A plane uses the two components of its own axes ([1,1,1] is a single quad, two triangles); a box uses all three, each face taking the two that span it. More subdivisions give finer sampling and a finer uv/raycast target. |
| `flip` | bool | `false` |  |  |  | Reverse every triangle's winding, which flips the surface normals — a plane becomes a ceiling, a box becomes an inward-facing room. |

## orientAlongVector

Sets the standard rot point attribute (f32 tuple 4 quaternion, [x, y, z, w]) so the chosen local axis points along `direction`, with `up` fixing the roll. The quaternion is right-handed and matches the spawner path's three.js Matrix4.compose conventions (and quatFromEulerDeg's frame), so with the default '+z' axis, spawned assets face the direction the way the spline-fence example's tangent yaw does. For axes ±x and ±z the local +Y axis turns as close to `up` as the direction allows; for axes ±y (which consume the up-like axis) local +Z takes that role. Points with a zero-length direction keep their existing rot (identity when the attribute is newly created). When direction and up are parallel or antiparallel (cross product squared length <= 1e-12, after normalizing both), the up hint deterministically falls back to [0, 0, 1], then [1, 0, 0].

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `direction` | vec3 | `[0,0,1]` |  |  | yes | World-space direction the chosen local axis should point along; need not be unit length. Field-capable (resolved per point on the input, e.g. a tangent attribute; tuple 1 broadcasts). Zero-length directions leave that point's rot unchanged (identity when the rot attribute did not exist before). |
| `up` | vec3 | `[0,1,0]` |  |  | yes | Up hint fixing the roll around the direction; need not be unit length. When parallel/antiparallel to the direction (or zero), deterministically falls back to [0, 0, 1], then [1, 0, 0]. Field-capable (resolved per point on the input; tuple 1 broadcasts). A per-point up is what a curve that turns over needs: a CONSTANT up flips the roll a half turn as the direction passes through it, and everything placed along the curve snaps round with it — feed writeCurveFrame's `curveNormal` here instead and the roll varies smoothly. A field `up` keeps this node OFF the device-resident path, because the apply kernel bakes the normalized up in as a constant; the cook reports that by name in its fallbacks rather than silently producing different bytes. |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | Which local axis maps onto the direction. Default '+z' — the forward axis assets face in the examples (a spline-fence style tangent yaw). For ±x/±z the local +Y follows the up hint; for ±y the local +Z follows it. |

## partitionByAttribute

Splits the input into one point cloud per distinct value of an i32, u32, or string point attribute (tuple 1). The output collection holds the groups in order of each value's first occurrence; every group carries all point attributes and is tagged `<name>=<value>` (plus the input's tags) so downstream nodes can route by tag.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"name"` |  |  |  | Point attribute to partition by. Must be i32, u32, or string with tuple size 1. |

## pathPointAt

Moves every point of every polyline to the position at a given parameter ALONG ITS OWN polyline, and writes the unit `tangent` and `curveU` it finds there. Points, attributes and topology all survive — this slides points along the curve they already sit on rather than building new ones, so a path stays the same path and only its parameterization changes. This is the evaluate-at-parameter the library otherwise lacks: pathResample and splineSample can only step a whole curve at even intervals, so 'where is this curve at u = 0.37' had no answer, and anything that needed one had to approximate by stepping along the tangent and hoping the curve was straight enough. mode 'fraction' reads the parameter as 0..1 of that polyline's arc length; mode 'distance' reads it as world units from the start. Both CLAMP out of range rather than wrapping or erroring — a parameter is usually computed, and a clamp is what keeps a point on the curve. The parameter is field-capable and resolves on the INPUT points BEFORE anything moves, so a field reading `curveU` sees where each point started and can be written as an offset from it: lerp(curveU, target, amount) slides each point partway toward a target. A point in several polylines is placed by the LAST one in primitive order, matching writeTangents, and a point in none is left exactly where it is with a zero tangent and curveU 0 — as is every point of a polyline whose length is zero, since it has no parameter to speak of. Because points can slide past each other, a path whose parameters are not monotonic comes back folded; that is the caller's to avoid, and it is legal geometry either way.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"fraction"` |  | `fraction`, `distance` |  | How the parameter is read: 'fraction' is 0..1 of the polyline's own arc length, so the same value means the same relative place on curves of different lengths; 'distance' is world units from the polyline's start. Both clamp to the ends. |
| `parameter` | f32 | `0.5` |  |  | yes | Where along the polyline to place the point, read according to `mode`. Field-capable, resolved on the INPUT points before any of them move — so it can read `curveU` and express a move relative to where the point already is (for example lerp(attribute('curveU'), target, amount)), which is the usual way to use this node. Values outside the range clamp. |

## pathResample

Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed. Unlike splineSample, each polyline is resampled on its own arc length rather than as one concatenated curve, so a graph with several paths keeps them separate. mode 'count' places exactly `count` samples per path (endpoints included on an open path; a closed path divides its length without duplicating the start). mode 'spacing' steps every `spacing` world units, keeping that step exact rather than stretching it to fit: an open path always ends on its true endpoint, so it never comes back shorter than it went in, and a closed path closes with a REMAINDER segment at the seam that is shorter than `spacing` (use 'count' to divide a loop evenly — see the `spacing` param). Output points are new: they carry the standard point-cloud attributes plus the unit segment `tangent` (f32 tuple 3) and `curveU` (f32, normalized position within that path), and the input's point attributes are NOT carried across. Its PRIMITIVE attributes ARE, in both directions: every attribute of the polyline a sample came from lands on that sample, and each output polyline keeps the attributes of the input polyline it replaces (output primitive i resamples input polyline i and nothing else), so a road resampled here comes back still a road rather than a nameless polyline. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes (P, tangent, curveU, seed, ...) is refused with an error naming the attribute and the fix. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a resampled path that passes through one stops being a path. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"count"` |  | `count`, `spacing` |  | How samples are placed: 'count' puts exactly `count` samples on each path; 'spacing' steps every `spacing` units along each path. |
| `count` | i32 | `10` | >= 2 |  |  | Samples per path when mode is 'count'. Minimum 2 for an open path and 3 for a closed one — below that the result would not be a path. Ignored in 'spacing' mode. |
| `spacing` | f32 | `1` | >= 0 |  |  | Distance between samples in world units when mode is 'spacing'. The step is EXACT and is never stretched to make the samples come out even, so a CLOSED path ends on a REMAINDER: the last sample sits at floor(length / spacing) * spacing and the segment from it back to the start is SHORTER than `spacing` — a 43-unit loop at spacing 5 gets 9 samples and closes with a 3-unit segment at the seam. That remainder is whatever the loop's length leaves over, anywhere from a hair above 0 to just under `spacing`. To divide a loop EVENLY, switch mode to 'count': it splits the length into `count` equal steps and has no seam segment. An open path is the same story at its far end — it always lands on its true endpoint, so its last segment is short in the same way. Must be > 0, small enough to leave at least 2 samples on each open path (3 on a closed one), and large enough that the whole input stays under 1048576 samples. Ignored in 'count' mode. |

## pathSegments

Emits ONE POINT PER SEGMENT of every polyline primitive, placed and oriented so that spawning a unit-sized asset on it draws the path as solid geometry. This is the DISCRETE way to draw a curve: one asset per segment, which is what a chain of separate links, a row of sleepers or a string of beads is. For a continuous skin use sweepProfile instead — it emits a real triangle mesh, shares rings between segments, and needs no `extend` because it leaves no gap to fill. Each output point sits at its segment's MIDPOINT, with `rot` turning the chosen local `axis` onto the segment direction and `scale` holding the segment's length on that axis and `radius` on the other two — so a unit cylinder (height 1, radius 1) lands exactly on the segment. Also writes the unit `tangent` (f32 tuple 3, the segment direction), `curveU` (f32, the midpoint's normalized position along that path) and `seed`; the input's POINT attributes are not carried, its PRIMITIVE attributes are. The default axis is '+y', deliberately unlike orientAlongVector's '+z': the assets this feeds are cylinders and capsules, which are built along Y in three.js, whereas orientAlongVector points props at a heading. Roll around the segment is fixed by an up hint of [0, 1, 0] with the same deterministic fallbacks orientAlongVector uses ([0, 0, 1], then [1, 0, 0]) — a tube is rotationally symmetric so the roll is arbitrary, but it is never random; when it MATTERS (alternating chain links), re-orient downstream with orientAlongVector reading the `tangent` this node wrote. Segments of zero length are SKIPPED rather than emitted as degenerate instances, so the output can hold fewer points than the input had segments. THE OUTPUT IS A PLAIN CLOUD, not a path: the points are segment midpoints, not the curve, and no polyline topology is built over them — resampling or re-pathing this output describes the midpoints, not the original curve, so branch off the path itself for that. Closed paths need nothing special: their closing segment is a segment like any other.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+y"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | Which local axis of the spawned asset runs along the segment, and therefore which `scale` component carries the segment length. Default '+y' — three.js CylinderGeometry and CapsuleGeometry are built along Y, and this node exists to feed them. The other two components carry `radius`. |
| `radius` | f32 | `0.05` | >= 0 |  | yes | Scale written to the two components that are not the axis; with a unit-radius asset this is the tube's radius in world units. Field-capable, but note WHERE it resolves: on the INPUT points (the path's own points), not on the segments this node emits — the output domain does not exist yet when the field runs. Each segment takes the AVERAGE of the values at its two endpoints, so a radius that tapers along a path tapers smoothly across the segments. That also means a field can only read attributes the input POINTS carry: a per-path radius living on the PRIMITIVE domain has to be promoted onto the points first (promoteAttribute, primitive to point) before a field can see it. Values below 0 are clamped to 0. |
| `extend` | f32 | `0` | >= 0 |  |  | World units added to BOTH ends of every segment (the length on the axis becomes segment + 2 * extend; the midpoint does not move). This is the joint filler: consecutive segments meeting at a bend leave a wedge-shaped gap on the outside of the corner, and overlapping them closes it. About one radius is enough down to right-angle bends. Costs nothing but overlap, and with a capsule asset the rounded caps hide the seam entirely. |

## pointGrid

Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis. Point order is X fastest, then Y, then Z. Emits a standard point cloud; per-point seed is hashed from the node seed and point index.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `countX` | i32 | `10` | >= 1 |  |  | Number of points along X. Minimum 1. |
| `countY` | i32 | `1` | >= 1 |  |  | Number of points along Y. Minimum 1. |
| `countZ` | i32 | `10` | >= 1 |  |  | Number of points along Z. Minimum 1. |
| `spacing` | vec3 | `[1,1,1]` |  |  |  | Distance between neighboring points along each axis, in world units. |
| `origin` | vec3 | `[0,0,0]` |  |  |  | World position of the first point (index 0,0,0). |

## pointLine

Creates `count` evenly spaced points on the straight segment from start to end. By default both endpoints are included, so the last point sits exactly on end; set includeEnd false to sample the half-open range instead, stopping one step short of end — which is what a sweep that wraps back on itself needs so its first and last samples are not the same place. count 1 places a single point at start in either mode. Emits a standard point cloud; per-point seed is hashed from the node seed and point index.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `10` | >= 1 |  |  | Number of points to place. Minimum 1. |
| `start` | vec3 | `[0,0,0]` |  |  |  | World position of the first point. |
| `end` | vec3 | `[10,0,0]` |  |  |  | World position of the last point. |
| `includeEnd` | bool | `true` |  |  |  | Whether `end` is one of the emitted positions. true (the default) samples the closed range [start, end]: `count` points stepping (end - start) / (count - 1), the first on start and the last exactly on end — use it for a run of points with both ends pinned, such as a fence between two posts. false samples the half-open range [start, end): `count` points stepping (end - start) / count, the last one step short of end — use it when the segment is a parameter that wraps, so a closed shape gets `count` distinct positions and no duplicate seam. count 1 emits a single point at start in both modes; count 0 emits nothing. |

## pointNeighborhood

Measures each point's neighborhood inside the same cloud and writes the result as point attributes: countAttr receives how many other points lie within radius (u32), and averageAttr/averageOutAttr average a numeric point attribute over those neighbors (f32, same tuple size — averaging "P" gives each point the centroid of its neighbors, which is one Lloyd relaxation step away from even spacing). Distances are 3D over P and boundary-inclusive. A point with no neighbors gets count 0 and keeps its OWN value as the average, so a displacement built from the average is zero for isolated points instead of undefined. Points with a non-finite coordinate are nobody's neighbor and have none themselves. Both places where this node has to pick an order — which neighbors a maxCount cap keeps, and the order their values are summed — are keyed on point IDENTITY (position bits plus the `seed` point attribute), never on the array index, so reordering the input cannot move a count, a kept set, or a single bit of an average. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is the input with the new attributes added; nothing is moved or removed — countAttr and averageOutAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it (a same-shape column is reused and reset).

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `radius` | f32 | `1` | >= 0 |  |  | Neighborhood radius in world units, boundary included. 0 searches nothing: every count is 0 and every average falls back to the point's own value. |
| `maxCount` | i32 | `0` | >= 0 |  |  | Cap on how many neighbors each point keeps: the nearest maxCount of them, distance ties resolved toward the lower point IDENTITY (a hash of the neighbor's position bits and its `seed` attribute) so the kept set is a property of the points and not of the order they arrived in. 0 (the default) keeps every neighbor within the radius. Use it to bound the cost in dense clouds. |
| `includeSelf` | bool | `false` |  |  |  | Count the point itself as one of its neighbors (and include its own value in the average). False (the default) measures the OTHER points, so an isolated point counts 0. |
| `countAttr` | string | `"nbrCount"` |  |  |  | Name of the u32 point attribute receiving the neighbor count. Empty writes no count (then averageAttr must be set). The shape is this node's to pick (u32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten: writing it would delete that column outright and the cook would still look fine (countAttr "P" would leave a point cloud with no positions). An existing u32 tuple-1 column of the same name IS reused and reset, so re-running this node over its own output is fine. To write over something of another shape, removeAttribute it first, or pick another name. |
| `averageAttr` | string | `""` |  |  |  | Numeric point attribute (tuple 1..4) to average over each point's neighbors, for example "P". Empty (the default) computes no average. |
| `averageOutAttr` | string | `"nbrAvg"` |  |  |  | Name of the f32 point attribute receiving the neighbor average; it takes averageAttr's tuple size. Required when averageAttr is set, ignored otherwise. Naming it the same as averageAttr overwrites in place — allowed whenever that attribute is ALREADY f32 at the same tuple size, which "P" is. Otherwise the shape is this node's to pick, and a name the input holds under a DIFFERENT shape is REFUSED rather than deleted and re-added: averaging an i32, u32 or bool attribute needs an output name of its own, since the average is always f32. An existing column of the matching f32 shape IS reused and reset. |

## pointScatterInBounds

Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax]. Each coordinate is an independent deterministic hash of (seed, point index, axis) — same seed always reproduces the same points, independent of evaluation order. Emits a standard point cloud.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `100` | >= 0 |  |  | Number of points to scatter. Minimum 0. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | Minimum corner of the box, in world units. |
| `boundsMax` | vec3 | `[1,1,1]` |  |  |  | Maximum corner of the box, in world units. Should be >= boundsMin per component. |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the scatter. |

## pointScatterInWorld

Scatters points over an INFINITE lattice anchored to world coordinates, then returns the ones inside the query window [boundsMin, boundsMax). A point's position and per-point seed are a pure function of (seed, latticeMode, cellSize) and its own lattice cell and index — never of the window, and density only decides how many points a cell holds — so the same world position always yields the same point under ANY query. Note what is NOT in that list: the graph seed. Alone among the nodes here, this one ignores it (see the `seed` param), because a lattice that moved with the graph seed could be de-anchored silently by an author reseeding a level graph per cell. That is what makes a halo just a wider query, lets a region cooked whole and the same region cooked in pieces agree byte for byte, and lets two cells on a boundary agree on what is there; pointScatterInBounds computes positions from the bounds and can promise none of it. Expected population is exactly `density * area` of the window in "xz" mode and `density * volume` in "xyz" mode, so an author can predict the count without cooking. Points are ordered by lattice cell (Z outer, then Y, then X) and by index within a cell, so any two windows list their shared points in the same relative order. Windows need not align to the lattice: partial cells are generated whole and clipped per point. The clip is half-open — a point on the min face belongs to this window, a point on the max face belongs to the next one — so abutting windows partition the world with no gap and no duplicate. The coordinate the clip tests is the f32 the point cloud STORES, not the wider intermediate it was computed from, so "inside the window" is a statement about the position you can actually read back: far from the origin, where the f32 spacing grows toward the lattice spacing, the two differ, and testing the intermediate would emit points whose stored position lies outside the window and have two abutting windows both disown the same point. Emits a standard point cloud.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `density` | f32 | `0.01` | >= 0 |  |  | Points per square world unit in "xz" mode, per cubic world unit in "xyz" mode. The expected number of points in a window is exactly density * area (or density * volume), for any window: a cell holds floor(lambda) points plus one more with probability frac(lambda), where lambda = density * cellSize^2 (or ^3). Raising density only ADDS points — the ones already there keep their positions and their per-point seeds — so it is safe to tune against a fixed layout. 0 emits nothing. |
| `cellSize` | f32 | `10` | >= 0 |  |  | Edge length, in world units, of this node's own lattice cell — the patch over which the point count is quantized. It controls clumping, not population: population is set by density alone, while cellSize decides how evenly the points are spread (small cells spread them out, large cells let counts vary more). Must be > 0. Set it from the content's scale and NEVER from a World level's cellSize: tying the two would make the generated content a function of the runtime's partitioning, so re-tuning a level's streaming, or cooking the same region at two levels, would change the world. |
| `latticeMode` | enum | `"xz"` |  | `xz`, `xyz` |  | "xz" (default): a 2D lattice on the XZ plane, every point at Y = height, with the Y components of boundsMin/boundsMax IGNORED (they may be infinite, matching an "xz" World cell, which is unbounded in Y). "xyz": a 3D lattice, with Y coming from the lattice and the full box clipped. The two modes are independent point sets, not slices of one — switching modes re-rolls the layout. |
| `height` | f32 | `0` |  |  |  | World Y of every point in "xz" mode. Ignored in "xyz" mode. The 2D lattice is deliberately flat rather than spread over the query's Y range: deriving Y from the window is exactly what makes a source non-anchored. To put points on a surface, displace Y afterwards from a position-anchored field (e.g. setAttribute on P with a noise field) — that stays a function of world position, so it survives any query window. |
| `boundsMin` | vec3 | `[0,0,0]` | (±Infinity ok, but never serializes) |  |  | Minimum corner of the query window, in world units — INCLUSIVE. Read only to choose which lattice cells to visit and to clip; it never moves a point. In "xz" mode the Y component is ignored, and -Infinity is the honest thing to write there: a World "xz" cell is a column with no vertical extent. An axis this mode DOES read must still be finite — the window chooses which cells to visit, so it has to be bounded — and an infinity never survives JSON, so a graph that must serialize needs a finite window. |
| `boundsMax` | vec3 | `[100,100,100]` | (±Infinity ok, but never serializes) |  |  | Maximum corner of the query window, in world units — EXCLUSIVE, so abutting windows neither drop nor duplicate a point on their shared face. Read only to choose which lattice cells to visit and to clip. In "xz" mode the Y component is ignored and may be +Infinity, subject to the notes on boundsMin. A window with max <= min on a read axis emits nothing. |
| `seed` | u32 | `0` |  |  |  | THE seed of the world this node lays down, and its ONLY source of randomness: the graph seed does not reach it, which is unlike every other node in this library and is the point. Change THIS to re-roll the world; changing the graph seed, calling graph.setSeed inside a level's bind, passing a CLI seed override, or renaming the node all leave the lattice byte-identical, so anchoring cannot be lost by accident. It must be the SAME for every query that has to agree — in a World, bind it from the cell-INVARIANT `ctx.worldSeed` or `ctx.levelSeed`, never from the per-cell `ctx.seed`, which would make each cell an unrelated world and the guarantee empty. The cost of all this, which you have to plan for: two nodes of this type with identical params scatter IDENTICAL points, exactly as two noise fields with one spec are one field — so give each layer its own value here (e.g. hashCombine(ctx.worldSeed, 1) for trees and hashCombine(ctx.worldSeed, 2) for rocks) rather than relying on the node id to separate them. |

## pointsToPath

Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph. Ordering is fixed and deterministic: within a path the points are visited in ascending point index (the order they arrive on this node's input) unless orderAttr names a sort key, and ties in that key always break to the lower point index. With groupAttr set, the cloud splits into one path per distinct group key — a whole-number id or a string name — emitted in ascending key order. `closed` appends a trailing vertex referencing the path's first point — closure is structural, exactly what createPolyline produces and what splineSample detects; no `closed` attribute is written. Any existing topology on the input is replaced, and its vertex and primitive attributes are dropped with it. Downstream: any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path; put this node after them, not before. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `closed` | bool | `false` |  |  |  | Close each path by appending a trailing vertex back to its first point (structural closure — no attribute is written). A closed path needs at least 3 points; 2 would fold the path back onto itself and is an error. |
| `groupAttr` | string | `""` |  |  |  | Name of a scalar point attribute holding a group key, splitting the cloud into one path per distinct key. A NUMERIC key must be a whole number (write one with setAttribute type 'i32', or have copyToPoints write the target index with `targetIndexAttr`) and paths are emitted in ascending key; a STRING key names the group instead — the usual thing a group is — and paths are emitted in ascending code-unit order of the word, never of its table index, so the same names produce the same paths in every geometry and every cell. Fractional numbers are refused rather than grouped: a key is an identity, two values a ULP apart would be two paths, and CPU/GPU parity is a tolerance rather than an equality. Leave empty to build a single path over every point. |
| `orderAttr` | string | `""` |  |  |  | Name of a scalar numeric point attribute to order each path by, ascending; ties break to the lower point index, so the result never depends on sort implementation. Values must be finite. Leave empty to use point index order. |

## projectToPlane

Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally; must be non-zero). With keepOffset enabled, the signed distance each point moved (positive along the normal) is stored in a `planeOffset` point attribute (f32, tuple 1) before projecting, so the flattening is invertible.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `origin` | vec3 | `[0,0,0]` |  |  |  | A point on the plane, in world units. |
| `normal` | vec3 | `[0,1,0]` |  |  |  | Plane normal; any non-zero vector (normalized internally). |
| `keepOffset` | bool | `false` |  |  |  | When true, store each point's signed pre-projection distance to the plane in a `planeOffset` point attribute (f32). |

## promoteAttribute

Moves an attribute between domains using the geometry's topology, creating or overwriting it on the target domain. Modes: 'first' keeps the first contribution in scan order (the only mode valid for string attributes); 'average', 'sum', 'min', 'max' aggregate all contributions. 'detail' broadcasts (from) or reduces over everything (to). Elements with no contributors keep the attribute default.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Name of the attribute to promote. Must exist on the `from` domain. |
| `from` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain the attribute currently lives on. |
| `to` | enum | `"primitive"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain to create the attribute on. |
| `mode` | enum | `"average"` |  | `first`, `average`, `sum`, `min`, `max` |  | How multiple contributions collapse: first (scan order), average, sum, min, or max. String attributes support only 'first'. |

## removeAttribute

Deletes named attributes from one domain. Every idiom that carries a value between nodes — a scratch column feeding a filter, a parameter attribute read back by a field, a hit marker recovered from a transfer — leaves that column on the output forever; this is the only way to take it off again. Unknown names are an error by default, so a typo does not silently leave the debris it was meant to remove; set strict false when a name may legitimately be absent. Removing the point attribute "P" is refused: it is the position every downstream node reads, and dropping it turns a clear failure here into an obscure one later.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `names` | stringList | `[]` |  |  |  | Attribute names to delete, in any order. An empty list removes nothing (and is not an error, so a graph can leave the node in place with nothing to clean). |
| `domain` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain to delete from: point, vertex, primitive, or detail. |
| `strict` | bool | `true` |  |  |  | Error when a listed name does not exist on the domain, naming the available attributes. False makes removal best-effort and skips missing names. |

## sampleNearestPoint

For every point of `in`, finds the nearest point of the `source` cloud in 3D (positions from P, ties resolved toward the lowest source index) and records what it found on the output's point domain: distanceAttr gets the distance (f32), indexAttr the source point index (i32), and `attribute`/`outAttribute` copy one of the source's point attributes across. This is the node that answers HOW FAR — transferAttribute's 'nearest' mapping copies a value but never reveals the distance, so banding by proximity to a road, a river or a set of landmarks needs this one. A point that finds nothing (an empty source, a non-finite position, or nothing within maxDistance) is a miss: its distance is Infinity, its index is -1, and a copied attribute keeps its prior value (the attribute default when it did not exist), so a miss is testable per point rather than only as a total. distanceAttr and indexAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it (a same-shape column is reused and reset); `outAttribute` is exempt, since a copy takes its shape from the source. Uses a uniform spatial grid, so large clouds are fine.

**Category:** attribute

**Inputs:** `in` (geometry), `source` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `distanceAttr` | string | `"nearDist"` |  |  |  | Name of the f32 point attribute receiving the distance to the nearest source point, in world units (Infinity on a miss). Empty writes no distance. The shape is this node's to pick (f32, tuple 1), so a name the input already holds under a DIFFERENT shape is REFUSED, not overwritten — writing it would delete that column and the cook would still look fine. A same-shape column IS reused and reset; to write over another shape, removeAttribute it first or pick another name. |
| `indexAttr` | string | `""` |  |  |  | Name of the i32 point attribute receiving the nearest source point's index, or -1 on a miss. Empty (the default) writes no index. Same rule as distanceAttr: the shape is this node's to pick (i32, tuple 1), so a name the input holds under a DIFFERENT shape is REFUSED rather than deleted and re-added, while a same-shape column is reused and reset. `attribute`/`outAttribute` are exempt — a copy takes its shape from the source and overwriting is the point. |
| `attribute` | string | `""` |  |  |  | Point attribute of the `source` geometry to copy from the nearest source point. Empty (the default) copies nothing. Any type, including string. |
| `outAttribute` | string | `""` |  |  |  | Name to store the copied attribute under on the output. Empty (the default) reuses `attribute`'s own name. Ignored when `attribute` is empty. |
| `maxDistance` | f32 | `0` | >= 0 |  |  | Largest distance that still counts as a find, in world units. 0 (the default) means unlimited; beyond it a point is a miss. |

## selfPrune

Enforces a minimum distance between points, under one of two rules chosen by `mode`. The default 'greedy' considers points one at a time and keeps a point only when every already-kept point is at least minDistance away; it packs points densely, and it CANNOT BE SPLIT ACROSS CELLS — a point's fate depends on whether its neighbour survived, which depends on ITS neighbour, an unbounded chain that no halo width covers, so running it per cell in a partitioned or World cook silently produces survivors that differ with the cell size and seam pairs closer than minDistance (measured: 1.41 apart where 3 was asked for) that read as a rendering artifact rather than as this node. Use mode 'localMaximum' there: it decides each point from its immediate neighbours alone, which makes a halo of minDistance exactly sufficient, at the price of keeping fewer points. Both rules settle every contest the same way — `priority` DESCENDING (higher priority survives) with ties broken by the LOWER point IDENTITY, a hash of the point's stored position bits and its `seed` point attribute, NOT its array index. That is what makes the survivors a property of the points rather than of the order they arrived in: shuffle the input, filter something upstream, or derive the same region inside another cell's halo, and the same points survive. With priority left alone every point ties, so identity alone decides, and the result is a spatially unbiased thinning rather than the front-of-the-array-wins prune an index order gives. Points that are indistinguishable — same position AND same seed — fall back to the lower index, since nothing else separates them. Both params are field-capable: a field `minDistance` is a PER-POINT radius (scale-aware declutter — big trees claim more room than bushes), and a pair then conflicts when it is closer than the LARGER of the two radii, so no kept point ever has another kept point inside its own radius. Survivors always come out in ascending INPUT index order; priority chooses who survives, never the order of the output. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried — unless `topology` is set to 'keep', which also preserves every primitive ALL of whose points survived, renumbered onto them.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"greedy"` |  | `greedy`, `localMaximum` |  | Which rule picks the survivors — the two disagree by design, and what separates them is how far one decision reaches. 'greedy' (the default) considers the points in order and keeps one whenever every ALREADY-KEPT point is at least minDistance away. It packs points about as densely as the order allows, and it is the right rule for cooking a region in one piece. Its decisions chain, though: this point survives because that neighbour did not, which happened because ITS neighbour did, and so on with no bound — so a cell cannot reproduce it from any halo, however wide. MEASURED, not argued: over one 60x60 world of 2000 points at minDistance 3, where a whole-region cook keeps 238, cooking in cells of 10, 15, 20 and 30 (each with a full 3-unit halo) kept 4, 4, 2 and 1 point the whole cook had pruned and dropped 7, 5, 2 and 3 it had kept — every cell size wrong in its own way, none agreeing with another — and three of the four left a surviving pair closer than the 3 that was asked for (1.41, 2.18 and 1.41; the worst of them under half of it). 'localMaximum' is the rule to reach for under partitioned or per-cell (World) cooking: a point survives only when it OUTRANKS EVERY point within minDistance of it, consulting nothing further. That is ONE hop, so a cell holding everything within minDistance of its own points computes exactly the whole-region answer — all four cell sizes above: identical survivors, and no pair under minDistance anywhere, seams included. The honest cost is density. A local-maximum survivor is always a greedy survivor too, never the reverse, so this rule keeps strictly FEWER points — 122 against 238 on that same world, about half — and leaves gaps a greedy pass would have filled. It is not the better rule; it is the correct one where the greedy is wrong. |
| `minDistance` | f32 | `1` | >= 0 |  | yes | Minimum allowed distance between two kept points, in world units. As a FIELD it is a per-point radius, evaluated on the input's points, and two points conflict when they are closer than the LARGER of their two radii (never the smaller, which would let a big point be crowded by a small one, and never the sum, which would double the spacing of an evenly-sized cloud and so disagree with the same number passed plainly). A per-point radius that is 0, negative or NaN claims no room of its own, but such a point can still be pruned by a bigger neighbour. A minDistance of 0 or less turns the node off: every point survives, topology included, and `priority` is not evaluated, whichever mode is set. That is a property of the VALUE, so both spellings of it get there — a plain 0 and a `constant` field of 0 are one graph literal written two ways, and they cook to the same geometry. A field that READS anything (an attribute, a position, a random) never takes that shortcut, even when every value it returns is 0: it always outputs a point cloud, so what the output IS depends on the graph and never on the numbers that come back. This is also the HALO WIDTH a cell needs under mode 'localMaximum', and as a field that width is the GLOBAL MAXIMUM the field can return anywhere in the world — not each point's own radius, since a big point reaches that far into its neighbours, and NOT the largest radius present in the cell's cloud, which is circular: the cloud a cell sees has already been clipped by the very halo you are trying to size, so the big neighbour that would have set the width is precisely the one it cannot see. Bound the field instead of measuring it — a constant times the range of whatever drives it (e.g. a noise field is in [-1, 1], so `2 + 3 * noise` maxes at 5; a radius read from an attribute maxes at that attribute's maximum over the WHOLE world, not over this cell) — and pass that bound as the halo. Overestimating costs a wider query; underestimating silently keeps pairs closer than the field asked for, at the seams only. |
| `priority` | f32 | `0` |  |  | yes | Per-point survival priority: HIGHER WINS. Points are considered in descending priority, so a point at priority 1 survives against a neighbour at priority 0 whichever of them the tiebreak would have preferred — this is how authored points beat procedural ones by SAYING so, instead of by being merged onto an earlier pin. Field-capable and evaluated on the input's points: attribute("locked") ranks by a flag written upstream (merge the layers with mergePoints first — an attribute missing on one input fills with its default there), and randomField("key") re-rolls the thinning when the key changes. Equal priorities break to the LOWER point IDENTITY (position bits plus the `seed` attribute), and NaN ranks lowest. The default 0 ties every point, so identity alone picks the survivors — which is already unbiased, so a random priority is for re-rolling, not for undoing an ordering bias. This decides WHO survives, never the output order. |
| `topology` | enum | `"drop"` |  | `drop`, `keep` |  | What happens to the input's TOPOLOGY — the vertices and primitives built over these points. 'drop' (the default) outputs a point cloud: the survivors are rebuilt as points and EVERY primitive goes with them, whether or not the filter touched one of its points, which is why a filtered network has to be rebuilt downstream (pointsToPath over a grouping attribute, or connectPoints again). 'keep' preserves the primitives ALL of whose points survive, carrying their vertices, their vertex and primitive attributes, and the detail domain, renumbered onto the surviving points. A primitive that loses even ONE point is dropped whole: there is no truncation of a polyline or a poly that means anything — closing the gap invents a segment nobody authored and splitting the primitive in two invents a primitive, and neither is a filter's job. A primitive is never SHORTENED, so one that comes out with fewer than two vertices is one that went in that way — this node cannot manufacture a degenerate primitive, and it does not delete one either (setPolylineTopology already refuses a polyline under two vertices, so such a primitive can only have come from bare setTopology, deliberately). The POINT domain is IDENTICAL under both settings — same points, same order, same attributes, same identities — so this param only ever ADDS information and nothing reading a point can tell which was set; the one thing 'keep' carries beyond topology is the DETAIL attributes, which a point cloud has no room for. A predicate that keeps every point reproduces the input's topology, with one inherited caveat it shares with filterPrimitivesByBounds and filterPrimitivesByAttribute: surviving primitives are laid out into contiguous vertex runs, so a geometry whose primitive ranges do not TILE its vertex array (only bare setTopology can build one — nothing checks more than start + count <= vertexCount) loses the vertices no primitive references, and their vertex attribute values with them. This is the point-domain mirror of the primitive filters' `unreferencedPoints`, and it is what lets mergePrimitives find something to preserve downstream of a filter. |

## setAttribute

Creates or overwrites an attribute on the chosen domain. Numeric types fill from `value`, which is field-capable and resolves per element of that domain (so it can read position, other attributes, or noise); the evaluated field must be scalar (broadcast across the tuple) or match tupleSize exactly, and stores with the target type's conversion: i32/u32 truncate, bool stores nonzero as 1. Type 'string' writes through the geometry's string table in two modes: with a non-empty `values` list, `value` acts as a per-element numeric selector — floor(selector), then clamped into [0, values.length - 1]; NaN selects 0 — choosing one entry per element (e.g. for per-point asset ids consumed by spawnInstances assetAttr); with `values` empty, the constant `stringValue` is written to every element.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"value"` |  |  |  | Attribute name to create or overwrite (an existing attribute of any shape is replaced). |
| `domain` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain the attribute lives on: point, vertex, primitive, or detail (one element). |
| `type` | enum | `"f32"` |  | `f32`, `i32`, `u32`, `bool`, `string` |  | Storage type. f32 keeps fractions; i32/u32 truncate toward zero; bool stores 0/1 (nonzero field values become 1); string interns into the geometry's string table and writes via `values` + selector or `stringValue` (see those params). |
| `tupleSize` | i32 | `1` | 1..4 |  |  | Components per element (1 = scalar, 3 = vector, 4 = color/quaternion). Range 1..4. |
| `value` | f32 | `0` |  |  | yes | Numeric value written to every element — or, for type 'string' with a non-empty `values` list, the per-element selector into it: floor(selector) clamped into [0, values.length - 1], NaN selects 0 (a total function; out-of-range never errors per element). Field-capable: evaluated on the target domain; scalar results broadcast across the tuple, otherwise the tuple size must match tupleSize. Ignored for type 'string' with `values` empty. |
| `values` | stringList | `[]` |  |  |  | String values to choose among when type is 'string': `value` selects per element (floor, then clamp into range). Leave empty to write the constant `stringValue` instead. Setting this with a numeric type is an error. Note: when the attribute feeds spawnInstances via assetAttr, an empty-string entry never names an asset — the spawner falls back to its assetId param for those elements. |
| `stringValue` | string | `""` |  |  |  | Constant written to every element when type is 'string' and `values` is empty. Must stay "" for numeric types. |
| `seed` | u32 | `0` |  |  |  | Extra seed for evaluating `value`: 0 (the default) uses the node's derived seed unchanged, so pre-existing graphs keep bit-identical output; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the EVALUATION CONTEXT — randomField, and the per-point seed attribute — but a noise only if it ASKS: a noise field carries its own seed inside its spec, so `valueNoise`, `perlinNoise`, `simplexNoise`, `worleyNoise` and `fbm` are unaffected here unless their `opts.position` reads the seed through the `nodeSeed` field. Otherwise they are varied through their own `opts.seed`, or by moving the positions they sample some other way. Bind a per-cell value (such as ctx.seed) here for per-cell variation in a World level — and note that a `nodeSeed`-folded noise then samples a different region in every cell, so it must not feed anything that has to agree across a seam. |

## setBounds

Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing. Downstream nodes and spawners read these as each point's axis-aligned extent.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | Minimum corner written to every point's boundsMin, in world units. |
| `boundsMax` | vec3 | `[1,1,1]` |  |  |  | Maximum corner written to every point's boundsMax, in world units. |

## spawnInstances

Spawner terminal: converts the input point cloud into render-agnostic instance batches. Each point becomes one instance with world matrix T(P) * R(rot) * S(scale) (column-major 4x4, THREE.Matrix4.elements layout; missing rot/scale attributes are identity). Points are grouped into one batch per asset id, in first-occurrence order: assetAttr (when non-empty) names a string point attribute holding per-point asset ids — empty per-point values fall back to assetId. colorAttr (when non-empty) additionally carries a per-instance RGB read from that point attribute, which is how instances of ONE asset id vary in appearance — age, health, season, a hue drift — without splitting into more assets. The 'instances' pin emits one instances item (input tags carried over); 'points' passes the input geometry through unchanged for chaining or debug rendering. One cook may spawn at most 1048576 instances (one per input point); a runaway density is refused with a diagnostic rather than an allocation failure. That budget is per COOK, not per world, so a streamed world cooking one cell at a time may hold many times it across its resident cells.

**Category:** spawn

**Inputs:** `in` (geometry)

**Outputs:** `instances` (instances), `points` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `assetId` | string | `"asset"` |  |  |  | Asset id stamped on every instance not overridden per point via assetAttr. The renderer resolves it to an actual renderable (e.g. the three adapter's asset map). |
| `assetAttr` | string | `""` |  |  |  | Optional name of a string point attribute holding per-point asset ids; empty string disables the override. Points whose attribute value is empty use assetId instead. Errors when the named attribute is missing or not a string attribute. Device-resident spawning supports it: the grouping is planned on the CPU (the asset column is always host-resident) and the device composes one transform buffer per asset, in the same batch order the CPU path produces. |
| `colorAttr` | string | `""` |  |  |  | Optional name of an f32 point attribute (tupleSize 3 or more) whose components 0, 1 and 2 are carried to the renderer as each instance's RGB. ALPHA IS DROPPED — both three adapters take RGB, so a fourth component (the standard `color` attribute is f32x4) has nowhere to go and is not carried. Empty (the default) carries no colour at all, and the renderer then leaves its instance-colour channel untouched. Nothing is picked up automatically and nothing scans the values: every point cloud in this library already carries `color` at [1,1,1,1], so its presence says nothing about intent, and writing an all-white instance-colour buffer would recompile the renderer's shader for zero pixels changed. Naming it is what states the intent — which also means an attribute written upstream and never named here is silently NOT drawn. Any colour-shaped attribute works: `color`, or a `tint`/`speciesColor` written with setAttribute. Errors when the named attribute is missing or is not f32 with tupleSize >= 3, listing the attributes that would fit. |

## splineSample

Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve. mode 'count' places exactly `count` samples (endpoints included on open curves; when every polyline is closed the samples divide the total length without duplicating the start). mode 'spacing' places samples every `spacing` world units from the start. Output points carry P, the unit segment `tangent` (f32 tuple 3), and `curveU` (f32) — the normalized arc-length position in [0, 1]. Each sample ALSO carries every attribute of the polyline PRIMITIVE it landed on, even though the polylines are measured as one concatenated curve, so a per-edge value survives the sampling; a sample landing exactly on a join between two polylines takes the LATER one's values. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes is refused with an error naming the attribute and the fix. Input polylines come from pointsToPath, pathResample, or createPolyline in TypeScript; the output is a plain point CLOUD with no topology, so it is no longer a path. Topology is fragile upstream too: any node that can REMOVE points drops it — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path and this node will report that it found no polylines. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"count"` |  | `count`, `spacing` |  | How samples are placed: 'count' distributes exactly `count` samples over the total arc length; 'spacing' steps every `spacing` units. |
| `count` | i32 | `10` | >= 1 |  |  | Number of samples when mode is 'count'. Minimum 1. Ignored in 'spacing' mode. |
| `spacing` | f32 | `1` | >= 0 |  |  | Distance between samples in world units when mode is 'spacing'. Must be > 0 in that mode. Ignored in 'count' mode. |

## subgraph

Composite node wrapping an inner graph as a single node. Pins and params are per-instance, derived from the exposed inner pins and the exposed inner params, so this registry entry declares none — create instances with subgraphNode(innerGraph, exposedInputs, exposedOutputs, exposedParams) and read an instance's real interface with describeSubgraphPins(def) and describeSubgraphParams(def). A serialized subgraph node carries its exposed-param VALUES in "params" and its inner graph plus the exposed pin and param DECLARATIONS either inline under "subgraph" ({ graph, inputs, outputs, params }), recursively in the same versioned format, or by reference under "ref" ({ name, hash? }) to a subgraph registered with registerSubgraph. "subgraph" and "ref" are mutually exclusive; a ref's "hash" is optional, and pins the reference to that exact content (a mismatch is an error, never a warning).

**Category:** composite

**Inputs:** *(none)*

**Outputs:** *(none)*

**Params:** *(none)*

## surfaceSample

Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement). densityField (0..1) is then evaluated once over the candidate cloud and each candidate is accepted when a per-candidate hashed random < density — so the output count is at most `count` and exactly `count` when density is 1. Output points carry P, a flat per-triangle `normal` (f32 tuple 3), density 1, and a hashed per-point seed. They ALSO carry every attribute of the triangle's own PRIMITIVE, gathered onto each sample — a per-face value written upstream survives the sampling instead of dying at it. `primtype` is the one exception, being a type tag rather than a value, and there is no opt-out: a carried name that collides with one this node writes is refused with an error naming the attribute and the fix.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `100` | >= 0 |  |  | Number of candidate samples to place before density acceptance. Minimum 0. |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the sampling. |
| `densityField` | f32 | `1` | 0..1 |  | yes | Acceptance probability in [0, 1] per candidate, evaluated on the candidate points after placement (so it can read P or noise). 1 keeps every candidate; 0 keeps none. |

## sweepProfile

Places a cross-section on EVERY POINT of every polyline primitive and stitches consecutive placements into 3-vertex 'poly' triangles: a curve becomes a surface. This is what `pathSegments` could only fake — a run of overlapping instanced cylinders becomes one continuous skin, at HALF the drawn triangles of the eight-sided instanced tube it replaces, because rings are shared between segments and no interior caps grow. THE PATH IS NOT RESAMPLED: one ring per input point, exactly where the point is, so a field-capable `radius` resolves at the ring rather than being averaged across a segment's endpoints the way pathSegments must. Run `pathResample` first for a finer surface. Output carries P, a `normal` (f32 tuple 3) and a `uv` (f32 tuple 2) the node writes itself — `u` is normalized arc length along the path, matching the `curveU` that pathSegments and pathPointAt write, and `v` runs around the profile — plus every INPUT POINT attribute copied (not interpolated) around each ring, and every input PRIMITIVE attribute gathered onto the triangles that came from it, so a per-path `roadWidth` or `chordPick` survives the sweep and a primitive-domain filter downstream can still see it. Input VERTEX attributes are dropped: the topology they described is gone. `normal` and `uv` are reporting slots — an input already carrying either at a different shape is REFUSED by name rather than silently deleted. Open versus closed is structural and needs no flag: a closed path shares its first and last ring so the tube closes on itself exactly (which means `u` returns to 0 across that one closing band — a texture measured along `u` repeats backwards there, the price of a genuinely closed tube), and `caps` applies only to an OPEN path with a CLOSED profile, since a closed path has no ends and a ribbon has no hole. Roll around the path is fixed by `frame` and never by chance. Junctions are NOT solved: where several polylines share an endpoint each is swept independently and the surfaces overlap, which is what every mitered-stroke renderer does by default.

**Category:** surface

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `profile` | enum | `"circle"` |  | `circle`, `square`, `ribbon` |  | Cross-section shape. 'circle' and 'square' are CLOSED (a tube, and a square rod whose four faces stay flat because its corners carry per-face normals) and take `radius` and `caps`; 'ribbon' is OPEN — a flat two-point strip of `width`, centred on the path, facing the frame's up axis — and takes neither, because a strip has no inside. A profile from a second geometry pin (an I-beam, a kerb) is deliberately not here yet: it forces four decisions no consumer has asked for, and these enum values stay valid when it arrives. |
| `sides` | i32 | `8` | 3..256 |  |  | Points around a 'circle' profile; ignored by the other two. Default 8 matches the shipped tube asset (a three.js CylinderGeometry with 8 radial segments), so a swept tube reads like the instanced tube it replaces. Cost is linear: the ring emits `sides + 1` points (the extra one duplicates the seam so the uv does not run backwards across one column of quads) and `sides * 2` triangles per band. |
| `radius` | f32 | `0.05` | >= 0 |  | yes | Distance from the path to the surface, in world units, for the 'circle' and 'square' profiles ('square' reads it as HALF-WIDTH, so the section fits a 2 x radius box). Same default as pathSegments' `radius`. Field-capable and resolved on the INPUT points — the path's own points, which is exactly where a ring sits — so a taper is exact rather than averaged. A per-path radius living on the primitive domain has to be promoted onto the points first (promoteAttribute, primitive to point) before a field can see it. |
| `width` | f32 | `1` | >= 0 |  | yes | Full width of a 'ribbon' profile in world units (the strip runs from -width/2 to +width/2 across the path); ignored by the closed profiles. Field-capable on the INPUT points, so a road that widens at a junction is one promoted attribute away. |
| `frame` | enum | `"upHint"` |  | `upHint`, `curveFrame`, `rot` |  | Where the ROLL inside the ring comes from. The ring's PLANE always comes from the path, so this never changes where the surface is, only how the profile is turned within it — which is invisible for a circle and decisive for a square or a ribbon. 'upHint' uses the `up` param through the same deterministic construction (and the same [0,0,1] then [1,0,0] fallbacks) orientAlongVector and pathSegments use: purely local, correct for a tube and for a flat road ribbon, wrong for a ribbon on a curve that turns over. 'curveFrame' reads the `curveNormal` point attribute writeCurveFrame writes — a rotation-minimizing frame carried ALONG the curve, which is what a ribbon on a twisting path needs; `curveBinormal` is not read, the second axis is derived so the ring stays right-handed. 'rot' reads the standard `rot` quaternion's local +X, so anything that writes `rot` (orientAlongVector, with its field-capable direction and up) drives the roll. Both attribute modes fall back to `up` at a point whose attribute is degenerate. This node TRANSPORTS nothing along the path: the ring plane reads only the two segments meeting at its own point (a one-neighbour rule, the same reach writeTangents has) and no mode carries a value forward, so the only non-locality in a swept surface is whatever the attribute it was handed already had — 'curveFrame' inherits the non-locality writeCurveFrame documents, and nothing more. |
| `up` | vec3 | `[0,1,0]` |  |  | yes | Up hint fixing the roll in 'upHint' mode, and the fallback in the other two; need not be unit length. When parallel or antiparallel to the path direction (or zero) it deterministically falls back to [0, 0, 1], then [1, 0, 0] — the same contract orientAlongVector and pathSegments state, through the same shared code, so a vertical path's roll is arbitrary but never random. Field-capable on the input points. |
| `roll` | f32 | `0` |  |  | yes | Turns of the profile about the path direction, applied inside the ring plane on top of `frame` — 0.25 is a quarter turn, 1 is a full one. Field-capable on the input points, so a value that ramps along the path twists the section. Invisible on a 'circle' (it is rotationally symmetric) and the reason a 'square' or 'ribbon' can be aimed without changing the frame. |
| `joint` | enum | `"miter"` |  | `miter`, `perpendicular` |  | How the section meets a bend. Both modes put the ring in the plane that BISECTS the two segments meeting at the point; they differ in whether the section is corrected for the tilt. 'miter' stretches the ring by 1/cos(half the turn angle) along the bend direction, which is exactly the ellipse a cylinder cuts on that plane, so the tube keeps its radius through the corner. 'perpendicular' leaves it, so the section thins by cos(half the turn angle) — 33% at a 96-degree bend, which is visible. Miter self-intersects only when the mitered half-width exceeds half the shorter segment; `miterLimit` is what refuses that. |
| `miterLimit` | f32 | `4` | >= 1 |  |  | Largest stretch 'miter' may apply. Past it the ring falls back to the unstretched 'perpendicular' section for that point ONLY, which pinches rather than shooting a spike out of the corner. A stretch of 4 is a 151-degree turn; the limit is never reached by a path that was resampled at anything like an even spacing, and exists for the pathological input that would otherwise self-intersect. Ignored by 'perpendicular'. |
| `caps` | bool | `true` |  |  |  | Close the two ends of an OPEN path with a CLOSED profile, as a triangle fan from the path's endpoint. Ignored for a closed path (it has no ends) and for the 'ribbon' profile (it has no hole), so all four combinations are defined rather than merely unsurprising. Cap points are separate from the wall's, so the seam between a flat cap and a round wall stays a real crease instead of being smoothed away. Cap uv is a disc mapping — the unit section mapped into the 0..1 square — not a continuation of the wall's. |

## transferAttribute

Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain. Mapping 'nearest' copies from the nearest source point in 3D (positions from P; distance ties resolve to the lowest source index; every point is assigned). Mapping 'uv' locates each destination point's UV (see uvAttr) in the source triangulation's UV space and interpolates inside the containing triangle; a UV on an edge shared by two triangles deterministically picks the lowest source primitive index. Mapping 'raycast' casts a normalized ray from each destination point along `direction` (or per-point directionAttr) against the source triangle mesh and interpolates at the nearest forward hit (smallest t >= 0, optionally capped by maxDistance; exactly-equal distances pick the lowest source primitive index). For uv/raycast the source must have 3-vertex 'poly' primitives (createTriangleMesh); zero-area (degenerate) triangles are skipped; f32 attributes interpolate barycentrically while i32/u32/bool/string take the triangle corner with the largest barycentric weight (ties to the first corner in vertex order). A PRIMITIVE source (attrDomain 'primitive') is never interpolated, whatever its type: a per-face value is constant across its triangle, so it arrives bit-exact instead of blended, and a per-triangle id, material tag or width survives the transfer intact. That reads a per-face value off a triangle MESH only — an edge or polyline network (a road from connectPoints/pointsToPath) has no 3-vertex 'poly' primitives, so neither uv nor raycast can ever reach one; to move a value off an edge network, promoteAttribute it from 'primitive' to 'point' on the source and transfer with mapping 'nearest'. Back to the shared policy: destination points with no containing triangle or no hit are misses that keep their prior value (the attribute default when the attribute did not exist) — set missCountAttr to record how many missed, and hitAttr to record WHICH ones did not (a per-point bool, 1 = found a source, 0 = missed). A miss cannot report itself through the transferred value, so hitAttr is the only per-point way to find one: filter on it to discard the misses rather than casting a second query to re-learn what this one already knew. All mappings are accelerated with deterministic uniform grids, so large inputs are fine.

**Category:** attribute

**Inputs:** `in` (geometry), `source` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Name of the attribute to transfer. Must exist on the source domain selected by attrDomain — point, vertex or primitive for mappings 'uv' and 'raycast', always the point domain for mapping 'nearest'. |
| `mapping` | enum | `"nearest"` |  | `nearest`, `uv`, `raycast` |  | How destination points find their source value: 'nearest' (closest source point in 3D), 'uv' (barycentric lookup of the destination UV in the source triangulation's UV space), or 'raycast' (nearest triangle hit along a ray from each destination point). |
| `attrDomain` | enum | `"point"` |  | `point`, `vertex`, `primitive` |  | Source domain the transferred attribute is read from (uv/raycast only): 'point' reads triangle corners through the topology, 'vertex' reads per-corner values (seam-accurate), 'primitive' reads one value for the whole triangle. Mapping 'nearest' supports only 'point'. The result always lands on the destination's point domain. What 'primitive' reaches, and what it does not: it reads a per-face value off a TRIANGLE MESH — the source still needs 3-vertex 'poly' primitives, so an edge or polyline network (a road built with connectPoints or pointsToPath, carrying a width promoted onto its edges) has no triangles for either mapping to find and is refused, naming the fix. To move a value off an edge network, promoteAttribute it from 'primitive' to 'point' on the source and transfer with mapping 'nearest'. |
| `uvAttr` | string | `"uv"` |  |  |  | UV attribute name for mapping 'uv' (ignored otherwise). On the destination it must live on the point domain (f32, tupleSize >= 2; extra components ignored). On the source it is read from the vertex domain when present (per-corner UVs, supports seams), else from the point domain. Destination UVs with non-finite components miss. |
| `direction` | vec3 | `[0,-1,0]` |  |  |  | Constant ray direction for mapping 'raycast' (ignored otherwise, and ignored when directionAttr is set). Normalized internally so maxDistance is world-space; must be non-zero. |
| `directionAttr` | string | `""` |  |  |  | Optional per-point ray direction attribute on the destination point domain (f32, tupleSize >= 3) for mapping 'raycast'; overrides `direction` when non-empty. Each direction is normalized per point; points with a zero or non-finite direction miss. Empty = use `direction`. |
| `maxDistance` | f32 | `0` | >= 0 |  |  | Maximum world-space hit distance for mapping 'raycast' (ignored otherwise). 0 (the default) means unlimited; a positive value ignores hits farther along the ray. Rays are forward-only regardless (hits need t >= 0). |
| `missCountAttr` | string | `""` |  |  |  | When non-empty, writes the number of missed destination points into a u32 detail attribute of this name on the output (mapping 'nearest' always writes 0 — every point is assigned). Empty = don't record. For which points those were, see hitAttr. This is a reporting slot whose shape this node picks (u32, tuple 1), so a name the input's DETAIL domain already holds under a different shape is REFUSED rather than deleted and re-added — give it a name of its own (a "__" prefix marks it internal, e.g. "__missed") or removeAttribute the clash first. A same-shape column is reused and reset. |
| `hitAttr` | string | `""` |  |  |  | When non-empty, writes a per-point flag of this name onto the OUTPUT'S POINT DOMAIN (bool, tuple 1). The polarity is the HIT, not the miss — the inverse of missCountAttr, which counts the zeros: 1 means this point found a source and received a transferred value, 0 means it missed and kept its prior value (the attribute default when it had none). Every point is written, so the column never carries a stale value: mapping 'nearest' leaves it all 1 (every point is assigned), and a source with nothing to search — every triangle degenerate — leaves it all 0, since nothing was found. Feed it to filterByAttribute (comparison 'eq', value 1) to keep only the points that landed, then removeAttribute to clean it up. Two names are refused rather than written: `name`, which the flag would otherwise overwrite, and any point attribute the input ALREADY holds under a different shape — the flag's shape is this node's to pick, so writing it there would delete that column and everything in it while the cook still looked fine (hitAttr "P" would leave a point cloud with no positions). An existing bool tuple-1 column of the same name IS reused and reset, which is what keeps the flag describing THIS transfer only. On a clash, give the flag a name of its own (a "__" prefix marks it internal, e.g. "__hit") or removeAttribute the existing column first. Empty = don't record. |

## transformPoints

Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX'). Composes with existing point transform attributes when present: rot becomes R * rot (quaternion product) and scale multiplies componentwise. All three params are field-capable and resolve per point on the input positions.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `translate` | vec3 | `[0,0,0]` |  |  | yes | Translation added after rotation and scale, in world units. Field-capable (tuple 1 broadcasts). |
| `rotateEuler` | vec3 | `[0,0,0]` |  |  | yes | Rotation about the world origin in degrees per axis, applied extrinsically in XYZ order: world X first, then world Y, then world Z (equivalent to intrinsic ZYX; three.js Euler order 'ZYX'). Field-capable (tuple 1 broadcasts). |
| `scale` | vec3 | `[1,1,1]` |  |  | yes | Componentwise scale about the world origin, applied before rotation. Field-capable (tuple 1 broadcasts). |

## valueConstant

Emits a single constant number as a value item, for feeding value pins or tagging pipelines with plain data.

**Category:** value

**Inputs:** *(none)*

**Outputs:** `out` (value)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `value` | f32 | `0` |  |  |  | The number to emit. |

## volumeSample

Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell. jitter in [0, 1] scales a deterministic per-cell random offset (0 = exact centers, 1 = anywhere in the cell) and may be a field evaluated on the un-jittered centers. Bounds come from the optional input geometry's P extents when connected, else from boundsMin/boundsMax. Emits a standard point cloud.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | Minimum corner of the box, in world units. Ignored when a geometry is connected. |
| `boundsMax` | vec3 | `[1,1,1]` |  |  |  | Maximum corner of the box, in world units. Ignored when a geometry is connected. |
| `cellSize` | f32 | `1` |  |  |  | Requested grid cell edge length in world units — a REQUEST, not the cell you get. Each axis is divided into max(1, floor(extent / cellSize)) whole cells, so the actual cell is extent / that count. When the extent is not a multiple you get a LARGER cell (extent 20, cellSize 12 -> one 20-wide cell); when the extent is smaller than cellSize you get a SMALLER one (extent 20, cellSize 25 -> one 20-wide cell, since an axis always has at least one cell). It equals cellSize exactly when the extent divides evenly by it. Must be > 0. |
| `jitter` | f32 | `0` | 0..1 |  | yes | Per-cell jitter amount in [0, 1]: fraction of the cell size each point may move from its cell center, per axis. Field-capable (evaluated on the grid centers). |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the jitter. |

## writeCurveFrame

Writes a full orthonormal frame — `tangent`, `curveNormal` and `curveBinormal` (f32 tuple 3) — at the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived. The tangent is the same central difference writeTangents writes, from the same shared code, so the three columns are guaranteed mutually perpendicular rather than nearly so. WHY IT EXISTS: orientAlongVector fixes the roll around a direction with an `up` hint, and a CONSTANT up cannot follow a curve that turns over — as the tangent passes through the up vector the roll flips a half turn, and everything placed along the curve (a radial spike, a chain link, a bracket) snaps round with it. The normal here is carried ALONG the curve instead of recomputed from a world axis: it starts perpendicular to the first tangent and is transported point to point by double reflection, which is the rotation that moves it as little as each step allows. Feed it back in as orientAlongVector's `up` — field-capable for exactly this — and the roll varies smoothly however the curve turns; combine `curveNormal` and `curveBinormal` with cos and sin of an angle to aim anything radially around the path. THE FRAME IS NOT LOCAL: a point's normal depends on every point before it along its path, so this must run BEFORE anything that splits a path across cook cells or partitions it — the same curve arriving as two pieces gets two unrelated frames. A CLOSED path does not come back seamless: transport around a loop returns rotated by a residual angle (the holonomy of that curve), so the frame either side of the seam differs, and no local rule can fix it. That is a property of closed curves rather than a defect, and it is left visible instead of smeared out. Degenerate points follow writeTangents: a point whose neighbours all coincide gets a zero tangent and is skipped by the transport, a point in several polylines takes the last one in primitive order, and unreferenced points get [0, 0, 0] on all three.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `tangentName` | string | `"tangent"` |  |  |  | Attribute for the unit tangent (created, or reset when it already exists as f32 tuple 3). The default matches what pathResample and splineSample emit, so a path that already carries tangents has them rewritten to identical values. |
| `normalName` | string | `"curveNormal"` |  |  |  | Attribute for the transported normal. NOT called 'normal' deliberately: surfaceSample writes a surface `normal` of the same shape (f32 tuple 3), and an identical shape is exactly the case a reporting slot ACCEPTS — so that name would be quietly reset in place, and a graph that samples a surface and frames a curve would have one silently overwrite the other. |
| `binormalName` | string | `"curveBinormal"` |  |  |  | Attribute for the binormal, tangent cross normal — the third axis of the frame. Written here rather than left to the consumer because recomputing it downstream from two f32 columns is where a frame stops being exactly orthonormal. |

## writeTangents

Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path. This is the tangent source for paths that were never spline-sampled: splineSample emits `tangent` only for the new points it creates, so a path built with pointsToPath has none, and orientAlongVector (which reads a direction field, typically the tangent attribute) has nothing to consume. The tangent at a point is the normalized central difference between its neighbours along the path, which stays smooth through corners; at the ends of an open path it is the adjacent segment direction, and a closed path wraps around. When the two neighbours coincide — a hairpin, where the path doubles back on itself — the forward segment direction stands in, pointing the way the path LEAVES the point. A point whose neighbours all sit on top of it, and any point not referenced by any polyline, gets [0, 0, 0] — orientAlongVector deliberately leaves a zero direction's rot untouched. A point visited by more than one polyline takes the tangent of the last one in primitive order. Any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so run this before them, not after. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"tangent"` |  |  |  | Attribute to write (created, or reset when it already exists as f32 tuple 3). The default 'tangent' is the name splineSample emits and the one an orientAlongVector direction field usually reads. The shape is this node's to pick, so a name the input's point domain already holds under a DIFFERENT shape is REFUSED rather than deleted and re-added — writing it would destroy that column and everything in it while the cook still looked fine. Give the tangents a name of their own, or removeAttribute the clash first. 'P' is refused outright, same shape or not: it is what the tangents are computed from. |
