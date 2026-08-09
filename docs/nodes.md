# Node reference

Generated from the node registry metadata (`listNodeTypes()`) by `node scripts/gen-node-reference.mjs` — do not edit by hand. The same metadata, machine-readable, is in [nodes.json](./nodes.json). For the graph JSON format and field-expression grammar see [authoring.md](./authoring.md).

35 node types, grouped by `category` (node sections below are alphabetical):

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
- [writeTangents](#writetangents) — Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path.

**composite**

- [subgraph](#subgraph) — Composite node wrapping an inner graph as a single node.

**filter**

- [filterByAttribute](#filterbyattribute) — Keeps points whose named point attribute satisfies a comparison.
- [filterByBounds](#filterbybounds) — Keeps points by position against the axis-aligned box [boundsMin, boundsMax] (bounds inclusive).
- [filterByDensity](#filterbydensity) — Filters points by their `density` point attribute (f32, tuple 1).
- [filterByExpression](#filterbyexpression) — Keeps points where a field-capable `predicate` evaluates to a non-zero number.
- [projectToPlane](#projecttoplane) — Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally; must be non-zero).
- [selfPrune](#selfprune) — Enforces a minimum distance between points: scans points in index order and keeps a point only when every previously kept point is at least minDistance away (deterministic greedy — lower indices win).

**io**

- [dataInput](#datainput) — Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph.

**point op**

- [copyToPoints](#copytopoints) — Copies the source point cloud onto every target point (output count = source points * target points, grouped by target).
- [jitterPoints](#jitterpoints) — Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point index, axis) — order-independent and reproducible.
- [mergePoints](#mergepoints) — Concatenates the points of every connected geometry, in connection order, into one point cloud.
- [orientAlongVector](#orientalongvector) — Sets the standard rot point attribute (f32 tuple 4 quaternion, [x, y, z, w]) so the chosen local axis points along `direction`, with `up` fixing the roll.
- [pointsToPath](#pointstopath) — Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph.
- [setBounds](#setbounds) — Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing.
- [transformPoints](#transformpoints) — Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX').

**sampler**

- [pathResample](#pathresample) — Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed.
- [splineSample](#splinesample) — Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve.
- [surfaceSample](#surfacesample) — Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement).
- [volumeSample](#volumesample) — Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell.

**source**

- [meshPrimitive](#meshprimitive) — Builds a parametric triangle mesh with no input: shape 'plane' is one axis-aligned rectangle, shape 'box' is six of them around a volume.
- [pointGrid](#pointgrid) — Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis.
- [pointLine](#pointline) — Creates `count` evenly spaced points on the straight segment from start to end.
- [pointScatterInBounds](#pointscatterinbounds) — Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax].

**spawn**

- [spawnInstances](#spawninstances) — Spawner terminal: converts the input point cloud into render-agnostic instance batches.

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
| `outName` | string | `""` |  |  |  | Name of the detail attribute to write. Empty (the default) reuses `name`, which is what promoting would have produced; give distinct names to hold several reductions of one attribute at once. |

## attributeRemap

Rescales a numeric attribute linearly from an input range to an output range, writing f32. Mode 'range' uses inMin/inMax as given — the hand-tuned remap(x, -1, 1, 0, 1) that every noise-driven graph writes. Mode 'fit' MEASURES the attribute's own range over the domain first (ignoring NaN) and uses that, which is what turns any invented quantity — a neighbor count, a hand-built score — into a usable 0..1 density or color input without knowing its scale in advance; it is also why this node needs no help from attributeReduce, whose detail-domain output no field or param could have read back anyway. An empty input range (inMin == inMax, or a fit over zero usable elements) maps everything to outMin, matching the `remap` field function. Tuples remap componentwise against one shared range, and NaN stays NaN in every mode — including the empty-range case, so unmeasurable data never turns into a valid-looking value. Reversed output ranges are fine and invert the values.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Numeric attribute to rescale (tuple 1..4). Must exist on `domain`. |
| `outName` | string | `""` |  |  |  | Name of the f32 attribute to write on the same domain. Empty (the default) rewrites `name` in place, which also converts an integer attribute to f32. |
| `domain` | enum | `"point"` |  | `point`, `vertex`, `primitive`, `detail` |  | Domain the attribute lives on: point, vertex, primitive, or detail. |
| `mode` | enum | `"range"` |  | `range`, `fit` |  | 'range' takes the input range from inMin/inMax; 'fit' measures the attribute's actual minimum and maximum over the domain and ignores inMin/inMax. |
| `inMin` | f32 | `-1` |  |  |  | Value mapped to outMin, in mode 'range'. Ignored in mode 'fit'. |
| `inMax` | f32 | `1` |  |  |  | Value mapped to outMax, in mode 'range'. Ignored in mode 'fit'. |
| `outMin` | f32 | `0` |  |  |  | Value inMin maps to. |
| `outMax` | f32 | `1` |  |  |  | Value inMax maps to. |
| `clamp` | bool | `false` |  |  |  | Hold results inside the output range (whichever of outMin/outMax is smaller or larger). False (the default) extrapolates, matching the `remap` field function; true is the usual choice when the result feeds density or color. In mode 'fit' it only affects NaN-free data trivially, since fitted values already land inside the range. |

## copyToPoints

Copies the source point cloud onto every target point (output count = source points * target points, grouped by target). Transforms compose per copy: P = targetP + targetRot * (targetScale * sourceP), rot = targetRot * sourceRot (quaternion product), scale = targetScale * sourceScale (componentwise), and each copied seed is hashCombine(sourceSeed, targetSeed). All other source point attributes are carried through unchanged; missing transform attributes are treated as identity.

**Category:** point op

**Inputs:** `source` (geometry), `target` (geometry)

**Outputs:** `out` (geometry)

**Params:** *(none)*

## dataInput

Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph. Items hash by rev in memo keys, so caching stays correct as items are swapped.

**Category:** io

**Inputs:** *(none)*

**Outputs:** `out` (any)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `items` | items | `[]` |  |  |  | Data items to emit, bound at runtime via graph.setParam (the World binds parent-cell outputs here, per cell, at bind time). Live DataItems are runtime-injected and never serialized: a serialized graph carries an empty item list, and items must be re-bound after deserialization. |

## filterByAttribute

Keeps points whose named point attribute satisfies a comparison. Numeric attributes (f32/i32/u32/bool, tuple 1) compare against `value` with any comparison. String attributes compare against `stringValue` and support only 'eq' and 'ne'. Output is a point cloud of the survivors with all attributes carried.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `attribute` | string | `"density"` |  |  |  | Name of the point attribute to test. Must exist with tuple size 1. |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | Comparison operator: eq (equal), ne (not equal), lt (<), le (<=), gt (>), ge (>=). String attributes allow only eq and ne. |
| `value` | f32 | `0` |  |  |  | Right-hand side for numeric attributes. Ignored for string attributes. |
| `stringValue` | string | `""` |  |  |  | Right-hand side for string attributes. Ignored for numeric attributes. |

## filterByBounds

Keeps points by position against the axis-aligned box [boundsMin, boundsMax] (bounds inclusive). mode 'inside' keeps points within the box, 'outside' keeps the rest. Output is a point cloud of the survivors with all attributes carried.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | Minimum corner of the box, in world units. |
| `boundsMax` | vec3 | `[1,1,1]` |  |  |  | Maximum corner of the box, in world units. |
| `mode` | enum | `"inside"` |  | `inside`, `outside` |  | 'inside' keeps points within the box (inclusive); 'outside' keeps points beyond it. |

## filterByDensity

Filters points by their `density` point attribute (f32, tuple 1). mode 'threshold' keeps points with density >= threshold; mode 'probabilistic' keeps each point when a deterministic per-point hashed random in [0, 1) is < its density (so density 0 never survives, 1 always does). Output is a point cloud of the survivors with all attributes carried.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"threshold"` |  | `threshold`, `probabilistic` |  | 'threshold' keeps density >= threshold; 'probabilistic' keeps each point with probability equal to its density. |
| `threshold` | f32 | `0.5` |  |  |  | Minimum density a point needs to survive in 'threshold' mode. Ignored in 'probabilistic' mode. |
| `seed` | u32 | `0` |  |  |  | Extra seed for 'probabilistic' mode; change it to re-roll which points survive. |

## filterByExpression

Keeps points where a field-capable `predicate` evaluates to a non-zero number. The predicate is resolved once over the input's point domain, so it can read position, any attribute, noise, or per-point randomness — which means a test that would otherwise need a scratch attribute plus filterByAttribute becomes one node, with no leftover column on the output. Comparison field functions (gt/ge/lt/le/eq/ne) already yield 1 and 0, and combining them with mul acts as AND, max as OR. NaN never passes, so a predicate that fails to compute drops the point instead of keeping it. The predicate must evaluate to tuple size 1: comparisons broadcast elementwise, so comparing a vector yields a vector of flags, which is not a decision. Output is a point cloud of the survivors with all attributes carried.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `predicate` | f32 | `1` |  |  | yes | Per-point test: non-zero keeps the point, 0 and NaN drop it. Field-capable and evaluated on the input's points. The default 1 keeps everything, so an unconfigured node passes its input through. |
| `seed` | u32 | `0` |  |  |  | Extra seed for evaluating `predicate`: 0 (the default) uses the node's derived seed unchanged; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the evaluation context (randomField, and the per-point seed attribute) but NOT noise, whose seed lives inside its own field spec. |

## jitterPoints

Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point index, axis) — order-independent and reproducible. amount is field-capable (evaluated on the input positions; tuple 1 broadcasts to all axes).

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `amount` | vec3 | `[0.1,0.1,0.1]` |  |  | yes | Maximum offset per axis, in world units. Field-capable (tuple 1 broadcasts). |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the jitter. |

## mergePoints

Concatenates the points of every connected geometry, in connection order, into one point cloud. The output carries the union of all point attributes: an attribute missing on an input fills with its default over that input's range. Attributes sharing a name must agree on type and tuple size. Topology (vertices/primitives) is not carried — the result is points only. Output tags are the union of input tags.

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
| `up` | vec3 | `[0,1,0]` |  |  |  | Up hint fixing the roll around the direction; need not be unit length. When parallel/antiparallel to the direction (or zero), deterministically falls back to [0, 0, 1], then [1, 0, 0]. |
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

## pathResample

Resamples every polyline primitive at even arc-length steps and emits a PATH, not a cloud: the new points carry polyline topology, and a path that was closed comes back closed. Unlike splineSample, each polyline is resampled on its own arc length rather than as one concatenated curve, so a graph with several paths keeps them separate. mode 'count' places exactly `count` samples per path (endpoints included on an open path; a closed path divides its length without duplicating the start). mode 'spacing' steps every `spacing` world units, keeping that step exact rather than stretching it to fit: an open path always ends on its true endpoint, so it never comes back shorter than it went in, and a closed path closes with a REMAINDER segment at the seam that is shorter than `spacing` (use 'count' to divide a loop evenly — see the `spacing` param). Output points are new: they carry the standard point-cloud attributes plus the unit segment `tangent` (f32 tuple 3) and `curveU` (f32, normalized position within that path), and the input's point attributes are NOT carried across. Downstream, any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a resampled path that passes through one stops being a path. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `mode` | enum | `"count"` |  | `count`, `spacing` |  | How samples are placed: 'count' puts exactly `count` samples on each path; 'spacing' steps every `spacing` units along each path. |
| `count` | i32 | `10` | >= 2 |  |  | Samples per path when mode is 'count'. Minimum 2 for an open path and 3 for a closed one — below that the result would not be a path. Ignored in 'spacing' mode. |
| `spacing` | f32 | `1` | >= 0 |  |  | Distance between samples in world units when mode is 'spacing'. The step is EXACT and is never stretched to make the samples come out even, so a CLOSED path ends on a REMAINDER: the last sample sits at floor(length / spacing) * spacing and the segment from it back to the start is SHORTER than `spacing` — a 43-unit loop at spacing 5 gets 9 samples and closes with a 3-unit segment at the seam. That remainder is whatever the loop's length leaves over, anywhere from a hair above 0 to just under `spacing`. To divide a loop EVENLY, switch mode to 'count': it splits the length into `count` equal steps and has no seam segment. An open path is the same story at its far end — it always lands on its true endpoint, so its last segment is short in the same way. Must be > 0, small enough to leave at least 2 samples on each open path (3 on a closed one), and large enough that the whole input stays under 1048576 samples. Ignored in 'count' mode. |

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

Measures each point's neighborhood inside the same cloud and writes the result as point attributes: countAttr receives how many other points lie within radius (u32), and averageAttr/averageOutAttr average a numeric point attribute over those neighbors (f32, same tuple size — averaging "P" gives each point the centroid of its neighbors, which is one Lloyd relaxation step away from even spacing). Distances are 3D over P and boundary-inclusive. A point with no neighbors gets count 0 and keeps its OWN value as the average, so a displacement built from the average is zero for isolated points instead of undefined. Points with a non-finite coordinate are nobody's neighbor and have none themselves. Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is the input with the new attributes added; nothing is moved or removed — countAttr and averageOutAttr are reporting slots whose shape this node picks, so pointing either at an existing attribute of a DIFFERENT shape is refused rather than silently deleting it (a same-shape column is reused and reset).

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `radius` | f32 | `1` | >= 0 |  |  | Neighborhood radius in world units, boundary included. 0 searches nothing: every count is 0 and every average falls back to the point's own value. |
| `maxCount` | i32 | `0` | >= 0 |  |  | Cap on how many neighbors each point keeps: the nearest maxCount of them, ties resolved toward the lower point index. 0 (the default) keeps every neighbor within the radius. Use it to bound the cost in dense clouds. |
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

## pointsToPath

Turns a point cloud into one or more paths by building `polyline` primitives over the SAME points, so every point attribute survives — this is the only way to produce a path from a serialized graph. Ordering is fixed and deterministic: within a path the points are visited in ascending point index (the order they arrive on this node's input) unless orderAttr names a sort key, and ties in that key always break to the lower point index. With groupAttr set, the cloud splits into one path per distinct group id, emitted in ascending group id. `closed` appends a trailing vertex referencing the path's first point — closure is structural, exactly what createPolyline produces and what splineSample detects; no `closed` attribute is written. Any existing topology on the input is replaced, and its vertex and primitive attributes are dropped with it. Downstream: any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path; put this node after them, not before. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** point op

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `closed` | bool | `false` |  |  |  | Close each path by appending a trailing vertex back to its first point (structural closure — no attribute is written). A closed path needs at least 3 points; 2 would fold the path back onto itself and is an error. |
| `groupAttr` | string | `""` |  |  |  | Name of a scalar numeric point attribute holding a group id, splitting the cloud into one path per distinct id (paths are emitted in ascending id). Ids must be whole numbers — write them with setAttribute (type 'i32'). Leave empty to build a single path over every point. |
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

Enforces a minimum distance between points: scans points in index order and keeps a point only when every previously kept point is at least minDistance away (deterministic greedy — lower indices win). Uses a uniform spatial grid, so it stays fast well beyond a few thousand points. Output is a point cloud of the survivors with all attributes carried.

**Category:** filter

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `minDistance` | f32 | `1` | >= 0 |  |  | Minimum allowed distance between any two kept points, in world units. 0 keeps every point. |

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
| `seed` | u32 | `0` |  |  |  | Extra seed for evaluating `value`: 0 (the default) uses the node's derived seed unchanged, so pre-existing graphs keep bit-identical output; any nonzero value folds in as hashCombine(nodeSeed, seed). This re-rolls randomness drawn from the EVALUATION CONTEXT — randomField, and the per-point seed attribute — but NOT noise: a noise field carries its own seed inside its spec, so `valueNoise`, `perlinNoise`, `simplexNoise`, `worleyNoise` and `fbm` are unaffected here and are varied through their own `opts.seed`, or by moving the positions they sample. Bind a per-cell value (such as ctx.seed) here for per-cell variation in a World level. |

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

Spawner terminal: converts the input point cloud into render-agnostic instance batches. Each point becomes one instance with world matrix T(P) * R(rot) * S(scale) (column-major 4x4, THREE.Matrix4.elements layout; missing rot/scale attributes are identity). Points are grouped into one batch per asset id, in first-occurrence order: assetAttr (when non-empty) names a string point attribute holding per-point asset ids — empty per-point values fall back to assetId. The 'instances' pin emits one instances item (input tags carried over); 'points' passes the input geometry through unchanged for chaining or debug rendering.

**Category:** spawn

**Inputs:** `in` (geometry)

**Outputs:** `instances` (instances), `points` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `assetId` | string | `"asset"` |  |  |  | Asset id stamped on every instance not overridden per point via assetAttr. The renderer resolves it to an actual renderable (e.g. the three adapter's asset map). |
| `assetAttr` | string | `""` |  |  |  | Optional name of a string point attribute holding per-point asset ids; empty string disables the override. Points whose attribute value is empty use assetId instead. Errors when the named attribute is missing or not a string attribute. Device-resident spawning supports it: the grouping is planned on the CPU (the asset column is always host-resident) and the device composes one transform buffer per asset, in the same batch order the CPU path produces. |

## splineSample

Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve. mode 'count' places exactly `count` samples (endpoints included on open curves; when every polyline is closed the samples divide the total length without duplicating the start). mode 'spacing' places samples every `spacing` world units from the start. Output points carry P, the unit segment `tangent` (f32 tuple 3), and `curveU` (f32) — the normalized arc-length position in [0, 1]. Input polylines come from pointsToPath, pathResample, or createPolyline in TypeScript; the output is a plain point CLOUD with no topology, so it is no longer a path. Topology is fragile upstream too: any node that can REMOVE points drops it — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so a path that passes through one stops being a path and this node will report that it found no polylines. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

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

Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement). densityField (0..1) is then evaluated once over the candidate cloud and each candidate is accepted when a per-candidate hashed random < density — so the output count is at most `count` and exactly `count` when density is 1. Output points carry P, a flat per-triangle `normal` (f32 tuple 3), density 1, and a hashed per-point seed.

**Category:** sampler

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `100` | >= 0 |  |  | Number of candidate samples to place before density acceptance. Minimum 0. |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the sampling. |
| `densityField` | f32 | `1` | 0..1 |  | yes | Acceptance probability in [0, 1] per candidate, evaluated on the candidate points after placement (so it can read P or noise). 1 keeps every candidate; 0 keeps none. |

## transferAttribute

Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain. Mapping 'nearest' copies from the nearest source point in 3D (positions from P; distance ties resolve to the lowest source index; every point is assigned). Mapping 'uv' locates each destination point's UV (see uvAttr) in the source triangulation's UV space and interpolates inside the containing triangle; a UV on an edge shared by two triangles deterministically picks the lowest source primitive index. Mapping 'raycast' casts a normalized ray from each destination point along `direction` (or per-point directionAttr) against the source triangle mesh and interpolates at the nearest forward hit (smallest t >= 0, optionally capped by maxDistance; exactly-equal distances pick the lowest source primitive index). For uv/raycast the source must have 3-vertex 'poly' primitives (createTriangleMesh); zero-area (degenerate) triangles are skipped; f32 attributes interpolate barycentrically while i32/u32/bool/string take the triangle corner with the largest barycentric weight (ties to the first corner in vertex order); destination points with no containing triangle or no hit are misses that keep their prior value (the attribute default when the attribute did not exist) — set missCountAttr to record how many missed, and hitAttr to record WHICH ones did not (a per-point bool, 1 = found a source, 0 = missed). A miss cannot report itself through the transferred value, so hitAttr is the only per-point way to find one: filter on it to discard the misses rather than casting a second query to re-learn what this one already knew. All mappings are accelerated with deterministic uniform grids, so large inputs are fine.

**Category:** attribute

**Inputs:** `in` (geometry), `source` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"density"` |  |  |  | Name of the attribute to transfer. Must exist on the source domain selected by attrDomain (always the point domain for mapping 'nearest'). |
| `mapping` | enum | `"nearest"` |  | `nearest`, `uv`, `raycast` |  | How destination points find their source value: 'nearest' (closest source point in 3D), 'uv' (barycentric lookup of the destination UV in the source triangulation's UV space), or 'raycast' (nearest triangle hit along a ray from each destination point). |
| `attrDomain` | enum | `"point"` |  | `point`, `vertex` |  | Source domain the transferred attribute is read from (uv/raycast only): 'point' reads triangle corners through the topology, 'vertex' reads per-corner values (seam-accurate). Mapping 'nearest' supports only 'point'. The result always lands on the destination's point domain. |
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

## writeTangents

Writes a unit `tangent` (f32 tuple 3) onto the points of every polyline primitive, keeping the points, their attributes and the topology exactly as they arrived — the output is still a path. This is the tangent source for paths that were never spline-sampled: splineSample emits `tangent` only for the new points it creates, so a path built with pointsToPath has none, and orientAlongVector (which reads a direction field, typically the tangent attribute) has nothing to consume. The tangent at a point is the normalized central difference between its neighbours along the path, which stays smooth through corners; at the ends of an open path it is the adjacent segment direction, and a closed path wraps around. When the two neighbours coincide — a hairpin, where the path doubles back on itself — the forward segment direction stands in, pointing the way the path LEAVES the point. A point whose neighbours all sit on top of it, and any point not referenced by any polyline, gets [0, 0, 0] — orientAlongVector deliberately leaves a zero direction's rot untouched. A point visited by more than one polyline takes the tangent of the last one in primitive order. Any node that can REMOVE points drops topology — filterByDensity, filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute — and so does mergePoints, so run this before them, not after. Category is not the rule: projectToPlane is categorised `filter` but preserves topology, and filterByAttribute drops it even when its predicate keeps every point.

**Category:** attribute

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string | `"tangent"` |  |  |  | Attribute to write (created, or replaced when it exists with another shape). The default 'tangent' is the name splineSample emits and the one an orientAlongVector direction field usually reads. Cannot be 'P'. |
