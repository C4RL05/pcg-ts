# Node reference

Generated from the node registry metadata (`listNodeTypes()`) by `node scripts/gen-node-reference.mjs` — do not edit by hand. The same metadata, machine-readable, is in [nodes.json](./nodes.json). For the graph JSON format and field-expression grammar see [authoring.md](./authoring.md).

25 node types, grouped by `category` (node sections below are alphabetical):

**attribute**

- [partitionByAttribute](#partitionbyattribute) — Splits the input into one point cloud per distinct value of an i32, u32, or string point attribute (tuple 1).
- [promoteAttribute](#promoteattribute) — Moves an attribute between domains using the geometry's topology, creating or overwriting it on the target domain.
- [setAttribute](#setattribute) — Creates or overwrites an attribute on the chosen domain.
- [transferAttribute](#transferattribute) — Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain.

**composite**

- [subgraph](#subgraph) — Composite node wrapping an inner graph as a single node.

**filter**

- [filterByAttribute](#filterbyattribute) — Keeps points whose named point attribute satisfies a comparison.
- [filterByBounds](#filterbybounds) — Keeps points by position against the axis-aligned box [boundsMin, boundsMax] (bounds inclusive).
- [filterByDensity](#filterbydensity) — Filters points by their `density` point attribute (f32, tuple 1).
- [projectToPlane](#projecttoplane) — Projects every point orthogonally onto the plane through `origin` with normal `normal` (normalized internally; must be non-zero).
- [selfPrune](#selfprune) — Enforces a minimum distance between points: scans points in index order and keeps a point only when every previously kept point is at least minDistance away (deterministic greedy — lower indices win).

**io**

- [dataInput](#datainput) — Emits exactly the data items in its `items` param, unchanged — the bridge for injecting externally produced data (for example parent-cell outputs in the hierarchical runtime) into a graph.

**point op**

- [copyToPoints](#copytopoints) — Copies the source point cloud onto every target point (output count = source points * target points, grouped by target).
- [jitterPoints](#jitterpoints) — Offsets each point by a deterministic random vector: each axis moves by a uniform random in [-amount, +amount], hashed from (seed, point index, axis) — order-independent and reproducible.
- [mergePoints](#mergepoints) — Concatenates the points of every connected geometry, in connection order, into one point cloud.
- [orientAlongVector](#orientalongvector) — Sets the standard rot point attribute (f32 tuple 4 quaternion, [x, y, z, w]) so the chosen local axis points along `direction`, with `up` fixing the roll.
- [setBounds](#setbounds) — Sets the standard per-point bounds attributes: writes boundsMin and boundsMax (f32 tuple 3, world units) on every point, creating the attributes when missing.
- [transformPoints](#transformpoints) — Transforms every point: P' = R * (scale * P) + translate, with R from rotateEuler (degrees, extrinsic XYZ order — world X applied first, then world Y, then world Z; equivalent to intrinsic ZYX, three.js Euler order 'ZYX').

**sampler**

- [splineSample](#splinesample) — Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve.
- [surfaceSample](#surfacesample) — Scatters points on a triangle mesh: each of `count` candidates picks a triangle with probability proportional to its area, then a uniform position on it (uniform barycentric placement).
- [volumeSample](#volumesample) — Fills an axis-aligned box with a regular grid of points: each axis is divided into floor(extent / cellSize) cells (at least 1) and a point is placed at each cell center, then jittered inside its cell.

**source**

- [pointGrid](#pointgrid) — Creates a regular grid of points: countX * countY * countZ points starting at origin, stepped by spacing per axis.
- [pointLine](#pointline) — Creates `count` evenly spaced points on the straight segment from start to end, both endpoints included (count 1 places a single point at start).
- [pointScatterInBounds](#pointscatterinbounds) — Scatters `count` points uniformly inside the axis-aligned box [boundsMin, boundsMax].

**spawn**

- [spawnInstances](#spawninstances) — Spawner terminal: converts the input point cloud into render-agnostic instance batches.

**value**

- [valueConstant](#valueconstant) — Emits a single constant number as a value item, for feeding value pins or tagging pipelines with plain data.

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

Creates `count` evenly spaced points on the straight segment from start to end, both endpoints included (count 1 places a single point at start). Emits a standard point cloud; per-point seed is hashed from the node seed and point index.

**Category:** source

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Description |
| --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `10` | >= 1 |  |  | Number of points to place. Minimum 1. |
| `start` | vec3 | `[0,0,0]` |  |  |  | World position of the first point. |
| `end` | vec3 | `[10,0,0]` |  |  |  | World position of the last point. |

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
| `seed` | u32 | `0` |  |  |  | Extra seed for evaluating `value`: 0 (the default) uses the node's derived seed unchanged, so pre-existing graphs keep bit-identical output; any nonzero value folds in as hashCombine(nodeSeed, seed), re-rolling field randomness (e.g. randomField). Bind a per-cell value (such as ctx.seed) here for per-cell variation in a World level. |

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

Samples points along polyline primitives by arc length, treating all polylines of the input as one concatenated curve. mode 'count' places exactly `count` samples (endpoints included on open curves; when every polyline is closed the samples divide the total length without duplicating the start). mode 'spacing' places samples every `spacing` world units from the start. Output points carry P, the unit segment `tangent` (f32 tuple 3), and `curveU` (f32) — the normalized arc-length position in [0, 1].

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

Transfers an attribute from the `source` geometry onto the main input's points, creating or overwriting it on the output's point domain. Mapping 'nearest' copies from the nearest source point in 3D (positions from P; distance ties resolve to the lowest source index; every point is assigned). Mapping 'uv' locates each destination point's UV (see uvAttr) in the source triangulation's UV space and interpolates inside the containing triangle; a UV on an edge shared by two triangles deterministically picks the lowest source primitive index. Mapping 'raycast' casts a normalized ray from each destination point along `direction` (or per-point directionAttr) against the source triangle mesh and interpolates at the nearest forward hit (smallest t >= 0, optionally capped by maxDistance; exactly-equal distances pick the lowest source primitive index). For uv/raycast the source must have 3-vertex 'poly' primitives (createTriangleMesh); zero-area (degenerate) triangles are skipped; f32 attributes interpolate barycentrically while i32/u32/bool/string take the triangle corner with the largest barycentric weight (ties to the first corner in vertex order); destination points with no containing triangle or no hit are misses that keep their prior value (the attribute default when the attribute did not exist) — set missCountAttr to record how many missed. All mappings are accelerated with deterministic uniform grids, so large inputs are fine.

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
| `missCountAttr` | string | `""` |  |  |  | When non-empty, writes the number of missed destination points into a u32 detail attribute of this name on the output (mapping 'nearest' always writes 0 — every point is assigned). Empty = don't record. |

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
| `cellSize` | f32 | `1` |  |  |  | Grid cell edge length in world units. Must be > 0. |
| `jitter` | f32 | `0` | 0..1 |  | yes | Per-cell jitter amount in [0, 1]: fraction of the cell size each point may move from its cell center, per axis. Field-capable (evaluated on the grid centers). |
| `seed` | u32 | `0` |  |  |  | Extra seed folded into the node seed; change it to re-roll the jitter. |
