# Primitive reference

Generated from the named-subgraph registry (`listSubgraphs()`) by `node scripts/gen-primitives.mjs` — do not edit by hand. The same catalog, machine-readable, is in [primitives.json](./primitives.json). For the graph JSON format, including how a graph references a primitive by name, see [authoring.md](./authoring.md); for the node types a primitive is built from, [nodes.md](./nodes.md).

37 registered primitives, alphabetical:

- [compose/merge-tagged](#composemerge-tagged) — Merge two clouds and remember which is which
- [compose/scatter-copies](#composescatter-copies) — Copy a whole cloud onto every target point
- [fill/scatter-by-density](#fillscatter-by-density) — Scatter points into noise-driven clumps
- [fill/scatter-clustered](#fillscatter-clustered) — Scatter points in groups rather than spread out
- [fill/scatter-even](#fillscatter-even) — Scatter points with a guaranteed minimum spacing
- [fill/volume-by-noise](#fillvolume-by-noise) — Carve connected volumes out of a solid box
- [filter/by-distance-to](#filterby-distance-to) — Keep points by how far they are from another cloud
- [filter/by-distance-to-curve](#filterby-distance-to-curve) — Keep points by how far they are from a curve
- [filter/by-neighbor-count](#filterby-neighbor-count) — Keep points by how crowded they are
- [filter/inside-radius](#filterinside-radius) — Keep the points within a radius of a centre
- [filter/mask-by-noise](#filtermask-by-noise) — Keep the points where a noise field is above a threshold
- [filter/thin-by-density](#filterthin-by-density) — Thin a point cloud by a noise density
- [place/align-to-surface](#placealign-to-surface) — Stand each point up along the surface under it
- [place/along-curve](#placealong-curve) — Space points along a curve and turn them to follow it
- [place/drop-to-surface](#placedrop-to-surface) — Drop points onto a mesh and discard the misses
- [place/on-surface](#placeon-surface) — Scatter points across a mesh with height and slope
- [place/plantable](#placeplantable) — Scatter points only where vegetation could grow
- [place/radial-on-curve](#placeradial-on-curve) — Place points along a curve and aim them radially
- [shape/disc](#shapedisc) — Points scattered uniformly inside a circle
- [shape/path-loop](#shapepath-loop) — A closed path around a circle
- [shape/path-meander](#shapepath-meander) — A wandering open path between two ends
- [shape/ring](#shapering) — Points evenly around a circle or an arc
- [shape/sphere-points](#shapesphere-points) — Points scattered uniformly on a sphere
- [shape/spiral](#shapespiral) — Points winding outward over a number of turns
- [transform/displace-by-noise](#transformdisplace-by-noise) — Push points up and down by a noise field
- [transform/gather-on-path](#transformgather-on-path) — Gather a path's own points into clumps along it
- [transform/relax-spacing](#transformrelax-spacing) — Even out spacing without deleting anything
- [transform/snap-to-grid](#transformsnap-to-grid) — Move every point to the nearest grid corner
- [write/color-from-attribute](#writecolor-from-attribute) — Turn a scalar attribute into a colour gradient
- [write/curve-frame](#writecurve-frame) — Write a smoothly carried frame along a path
- [write/density-from-noise](#writedensity-from-noise) — Write the standard density attribute from a noise field
- [write/height-slope](#writeheight-slope) — Stamp height and slope from a surface normal
- [write/instances-by-species](#writeinstances-by-species) — Pick one asset per point and emit the instances
- [write/local-density](#writelocal-density) — Write how crowded each point is as a density
- [write/orient-along-path](#writeorient-along-path) — Turn a path's own points to follow the path
- [write/random-scale](#writerandom-scale) — Write one uniform random size per point
- [write/random-yaw](#writerandom-yaw) — Turn each point to face a random direction

## compose/merge-tagged

**Merge two clouds and remember which is which**

Concatenates two point clouds and stamps a string attribute on each side first, so the result remembers where every point came from — then `partitionByAttribute` can route them apart again, or the spawner can read the same attribute and give each source a different asset. ONE knob names the attribute on both sides, which is the point: a hand-written version has the same string typed twice and drifts the first time one is edited. Note that merging unions the attribute sets and FAILS when the two inputs disagree on a name's type, so a scratch column left on one side can break a merge that used to work. Fully deterministic. Writes the kind attribute; carries every other attribute through.

**Content hash:** `beeef6ae3fc70113`

**Tags:** `compose`, `merge`, `routing`

**Inputs:** `a` (geometry), `b` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kindAttr` | string | `"kind"` |  |  |  | tagA.name, tagB.name | Name of the string point attribute stamped on both sides. One knob writes both, so the two labels always land on the same attribute. |
| `nameA` | string | `"a"` |  |  |  | tagA.stringValue | Label written on every point arriving at `a`. |
| `nameB` | string | `"b"` |  |  |  | tagB.stringValue | Label written on every point arriving at `b`. |

Run it: `pcg run compose/merge-tagged`

## compose/scatter-copies

**Copy a whole cloud onto every target point**

Copies the entire `source` cloud onto every point of `target`, composing the transforms per copy, then jitters the result so the repeated copies do not read as stamped. COUNT: the output is source x target points — 20 onto 500 is 10,000, and it multiplies fast. The transforms compose rather than overwrite: each copy is placed by the target's position, turned by the target's rotation and sized by the target's scale, so a target cloud carrying `rot` and `scale` lays its copies out already varied. VARIATION: yes — the jitter is context-seeded, so two instances differ, and `seed` re-rolls one explicitly. Reads and writes `P`; carries every source attribute through.

**Content hash:** `be5f7f50eb607c11`

**Tags:** `compose`, `copy`, `clusters`

**Inputs:** `source` (geometry), `target` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jitter` | vec3 | `[0.5,0,0.5]` |  |  | yes | jit.amount | Random offset per axis, in world units, uniform and SYMMETRIC: each copy moves somewhere in -jitter..+jitter on each axis independently, so the spread is 2 * jitter wide, not jitter, and the measured extremes sit on the bound exactly. What makes copied clusters look placed rather than stamped. The default [0.5,0,0.5] jitters in the ground plane only — the zero on Y is what keeps copies from sinking through a surface. Set it to [0,0,0] for exact copies. |
| `seed` | u32 | `0` |  |  |  | jit.seed | Re-rolls the jitter. Two instances already differ without it. |

Run it: `pcg run compose/scatter-copies`

## fill/scatter-by-density

**Scatter points into noise-driven clumps**

Scatters candidates through a box and keeps each one with a probability read from a noise field, so the points arrive in soft clumps instead of spread evenly — the single most common authoring situation in the library. COUNT: about `count` x 0.5 survive, since the normalized pattern averages 0.5. VARIATION: this is the MIXED case and the one an agent gets wrong. Which candidates survive varies per instance, but the PATTERN does not, so two instances put different points in the SAME clumps unless their `variant` differs. Writes `density`; reads nothing. Built on `filter/thin-by-density`, which is the same thinning applied to a cloud you already have.

**Content hash:** `86f00d2d2e3603a6`

**Tags:** `fill`, `scatter`, `noise`, `density`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[100,0,100]` |  |  |  | scatter.boundsMax | Maximum corner of the box to fill, in world units. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | scatter.boundsMin | Minimum corner of the box to fill, in world units. |
| `count` | i32 | `4000` | >= 0 |  |  | scatter.count | Candidates scattered before thinning. Roughly half survive. |
| `frequency` | f32 | `0.02` |  |  | yes | thin.frequency | Feature size of the clumps: smaller means broader clumps. |
| `seed` | u32 | `0` |  |  |  | scatter.seed, thin.seed | Re-rolls both the candidate positions and which of them survive. It does NOT move the clumps; `variant` does that. |
| `variant` | f32 | `0` |  |  | yes | thin.variant | Offset added to the noise sample position — the only way to give two instances different CLUMPS rather than different points in the same clumps. |

Run it: `pcg run fill/scatter-by-density`

## fill/scatter-clustered

**Scatter points in groups rather than spread out**

Scatters a few cluster centres through a box, then copies a small local cloud onto each one, so points arrive in groups — villages, groves, boulder fields. COUNT: the output is clusters x perCluster exactly, which multiplies fast. SHAPE: a group is a BOX running -spread to +spread around its centre and all three components of `spread` are live. It ships flat — the default is [4, 0, 4], a ground-plane patch, because that is what a village or a grove is — so raise `spread.y` to make the group volumetric (a swarm, an asteroid field, a cave's boulders) rather than reaching for a box scatter. The groups OVERHANG the bounds by up to `spread`, deliberately and unclamped: `boundsMin`/`boundsMax` place the CENTRES, and a group straddling the edge is a whole group rather than a clipped one — inset the bounds by `spread` if the points themselves have to stay inside a region. VARIATION: yes — both scatters are context-seeded, so two instances differ, and `seed` re-rolls both explicitly. The local cloud's own `scale` is reset before copying, so `spread` sizes the cluster and not the assets in it.

**Content hash:** `84e6d02c5fa48592`

**Tags:** `fill`, `scatter`, `clusters`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[100,0,100]` |  |  |  | centres.boundsMax | Maximum corner of the box the group centres can land in, in world units. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | centres.boundsMin | Minimum corner of the box the group centres can land in, in world units. |
| `clusters` | i32 | `24` | >= 0 |  |  | centres.count | How many groups to place. |
| `perCluster` | i32 | `12` | >= 0 |  |  | local.count | How many points each group holds. The output count is clusters x this. One local cloud is scattered and then copied onto every centre, so every group is the SAME arrangement translated — this is also how finely a group's shape is sampled, and two groups differ by position, not by shape. |
| `seed` | u32 | `0` |  |  |  | centres.seed, local.seed | Re-rolls both the group positions and the shape of the group. Two instances already differ without it. |
| `spread` | vec3 | `[4,0,4]` |  |  | yes | spread.scale | Half-extent of one group, per axis, in world units: its points land uniformly in a BOX running -spread to +spread around the centre, so a group measures 2 * spread across and the reach is exactly linear in the value. The peak sits just under `spread` because it is `perCluster` uniform draws deep, not because the bound is different: measured 0.88 to 0.96 of it at the default 12 points per group, 0.995 at 300. All three axes are live, Y included. It DEFAULTS to [4, 0, 4] — a flat ground patch, where every point of a group shares its centre's Y exactly — because the common group stands on the ground; [4, 4, 4] gives a cube-shaped group instead, and [4, 12, 4] a column. The box bounds the POINTS while `boundsMin`/`boundsMax` bound only the CENTRES, so the result overhangs the box by up to `spread` on each side, on Y as well once the group has height. Nothing clamps that, on purpose — inset the bounds by `spread` when the points must stay inside a region. A bare number is not accepted: pass [4, 0, 4], or {"fn":"constant","value":4} for equal reach on all three axes. |

Run it: `pcg run fill/scatter-clustered`

## fill/scatter-even

**Scatter points with a guaranteed minimum spacing**

Scatters candidates through a box and then removes any that fall closer than a minimum distance, giving evenly spaced points with no visible clumping — for anything with physical extent: trees, rocks, buildings. COUNT: over-scatter deliberately. The output count is EMERGENT and approaches a ceiling of about 0.7 x area / minDistance squared from BELOW — the default 4000 candidates reach only about 85% of it — so raising `count` keeps adding a few points for a long time, while the way to get materially more is a smaller `minDistance`. The scan is a deterministic greedy pass in index order, not a Poisson-disc sample, so the count is not controllable and looping to hit a target count will not converge. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly.

**Content hash:** `cc82fcafd7656e59`

**Tags:** `fill`, `scatter`, `spacing`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[50,0,50]` |  |  |  | scatter.boundsMax | Maximum corner of the box to fill, in world units. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | scatter.boundsMin | Minimum corner of the box to fill, in world units. |
| `count` | i32 | `4000` | >= 0 |  |  | scatter.count | Candidates scattered before pruning. Over-scatter, and expect to over-scatter HARD: the survivor count climbs slowly toward saturation instead of reaching it, so this knob still moves the result long after it looks like it should not. Saturation is about 0.7 * area / minDistance^2 — roughly 440 points in the default 50x50 box at minDistance 2 — and it takes on the order of 150 candidates per surviving point to get within a few percent of it. Measured in that box at minDistance 2: 4000 candidates give 374 (84% of saturation), 16000 give 416, 64000 give 436, 200000 give 444. Each 4x costs the next ~5%. Nothing here ever produces MORE than saturation, so a target count above it is unreachable at any `count`. |
| `minDistance` | f32 | `2` | >= 0 |  | yes | prune.minDistance | Closest two kept points may be, in world units — and it is exact, not approximate: the measured nearest pair sits at minDistance to within a rounding error. This is the real knob, because the count follows it as an inverse square: the achievable maximum is about 0.7 * area / minDistance^2, so halving it makes room for four times as many points (and needs four times the `count` to find them). |
| `seed` | u32 | `0` |  |  |  | scatter.seed | Re-rolls the scatter. Two instances already differ without it. |

Run it: `pcg run fill/scatter-even`

## fill/volume-by-noise

**Carve connected volumes out of a solid box**

Fills a box with a jittered grid of points and keeps only the cells where a 3D noise field rises above a threshold, carving connected volumes out of solid — caves, clouds, asteroid interiors, floating islands. COUNT: the grid is extent cubed over cellSize cubed, so this is the one primitive here that can blow up; halving `cellSize` costs eight times as many points in a three-dimensional region (four over a flat one) before the threshold takes any away. Connect the `in` pin and the bounds come from that geometry's own extents instead of the params, which is the library's only 'adapt to whatever arrives' mechanism. VARIATION: the jitter varies per instance but the CARVE PATTERN does not, so two instances hollow out the same shape unless their `variant` differs.

**Content hash:** `613a9dd972ddc544`

**Tags:** `fill`, `noise`, `volume`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[32,32,32]` |  |  |  | vol.boundsMax | Maximum corner of the box to fill. IGNORED when the `in` pin is connected. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | vol.boundsMin | Minimum corner of the box to fill. IGNORED when the `in` pin is connected. |
| `cellSize` | f32 | `2` |  |  |  | vol.cellSize | Grid resolution in world units. The candidate count is floor(extent / cellSize) per axis — at least 1, whole cells only, no partial cell at the far edge — multiplied together, so halving it costs EIGHT times as many points only where the region is fully three-dimensional: over a flat region — a plane, or any scatter with a constant Y — it is four times, and along a line twice. Measured on the default 32-unit box: cellSize 8 gives 64 candidates, 4 gives 512, 2 gives 4096, 1 gives 32768, exactly 8x per halving because 32 divides by all of them. Measured on the same box arriving through the `in` pin, where a scatter's extent lands just under 32 and every axis loses its last whole cell: 27, 343, 3375, 29791 (3, 7, 15 and 31 per axis), with the ratios running 12.7x, 9.8x, 8.8x down toward 8. The threshold then takes some away; this is the count BEFORE it. |
| `frequency` | f32 | `0.05` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Feature size: smaller means larger, smoother caverns. |
| `jitter` | f32 | `0.5` | 0..1 |  | yes | vol.jitter | How far each point may wander from its own lattice node: 0 is a hard lattice, 1 is fully irregular. The offset is uniform on each axis, exactly linear in the value, and bounded by HALF A CELL structurally rather than statistically — a point never leaves the cell it was generated in, at any jitter, so neighbours keep their grid order, never cross, and stay at least (1 - jitter) * cell apart. Build non-overlap on that. What that bound is NOT is half of the `cellSize` you typed, and the difference surprises: the grid divides the extent into floor(extent / `cellSize`) whole cells, so the real cell is extent / that — equal to `cellSize` only when the extent is a whole multiple of it, wider otherwise. Measured on the default 32-unit box at cellSize 2 (16 whole cells of exactly 2): +/-1.0 at jitter 1. Measured with the bounds taken from the `in` pin, where the extent lands just under 32 and leaves 15 cells of 2.13: +/-1.066 — 0.53 of the number typed, and still exactly half of its own cell. |
| `seed` | u32 | `0` |  |  |  | vol.seed | Re-rolls the per-cell jitter. It does NOT move the carve pattern; `variant` does that. |
| `threshold` | f32 | `0.5` | 0..1 |  | yes | *(nothing — the body's field expressions read it by name)* | Where the cut falls on the 0..1 noise. Higher leaves less material, but the noise only reaches the MIDDLE of that range, so the whole knob lives between about 0.35 (solid) and 0.68 (empty) — four octaves of normalized fBm are bell-shaped around 0.5 and never near the ends. Measured on the default 32-unit box at cellSize 2: 0.3 keeps 100% of the grid, 0.45 keeps 85%, 0.5 keeps 65%, 0.55 keeps 41%, 0.6 keeps 18%, 0.65 keeps 3.6%, 0.7 keeps nothing. The centre of that band is NOT fixed at 0.5 the way the flat filters' is: the box times `frequency` decides how much of the field is sampled, and a small window sits wherever its own patch of noise happens to sit (the same box read as a 2D spread has 0.5 keeping half rather than two thirds). Sweep in steps of 0.02, not 0.1. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position — the per-instance re-roll of the carve pattern. |

Run it: `pcg run fill/volume-by-noise`

## filter/by-distance-to

**Keep points by how far they are from another cloud**

Measures each point's distance to the nearest point of a second cloud and keeps or drops it by that distance — 'no trees within 20m of the road', or 'cabins only near the lake'. This is the only way to ask how far anything is from anything: transferring the nearest value copies it but never reveals the distance. A point that finds nothing (an empty `features` cloud) is at distance Infinity, so 'le' drops it and 'ge' keeps it. Fully deterministic. Reads `P` on both inputs; writes nothing (the distance column is removed again).

**Content hash:** `d0aa7eab0a945715`

**Tags:** `filter`, `spatial`, `proximity`

**Inputs:** `in` (geometry), `features` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | 'ge' keeps what is far from the features (a clearance), 'le' keeps what is near them (a band). |
| `distance` | f32 | `5` | >= 0 |  | yes | keep.value | The band edge, in world units. |

Run it: `pcg run filter/by-distance-to`

## filter/by-distance-to-curve

**Keep points by how far they are from a curve**

Measures each point's distance to the supplied `curve` and keeps or drops it by that distance — a clearance either side of a road, a band of reeds along a river, a strip of lamps beside a path. The densification is the content: a polyline's own points can be tens of metres apart, and measuring to THEM instead of to the curve reports huge distances mid-segment and cuts scalloped bites out of the result. The curve is therefore sampled every `resolution` units first, and the measurement is against those samples, so `resolution` is the accuracy of the answer. PRECONDITION: `curve` must carry polyline topology (`shape/path-loop`, `shape/path-meander`, or a `pointsToPath` node) — a point cloud is rejected as having no polylines. Several separate paths are all measured against; the nearest one wins. Fully deterministic. Reads `P` on both inputs; writes nothing.

**Content hash:** `ea60d3a55b196c50`

**Tags:** `filter`, `path`, `spatial`, `proximity`

**Inputs:** `in` (geometry), `curve` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | dist.comparison | 'ge' keeps what is far from the curve (a clearance either side of it), 'le' keeps what runs alongside it (a band). |
| `distance` | f32 | `5` | >= 0 |  | yes | dist.distance | The band edge, in world units — how far from the curve the decision flips. |
| `resolution` | f32 | `1` | >= 0 |  |  | dense.spacing | How finely the curve is sampled before distances are measured, in world units. It is the accuracy of the measurement, and it only ever UNDERSTATES the band — sampling a curve sparsely puts every point further from the nearest sample than it is from the curve, so points are lost from the edges, never gained. Measured against a 5-unit band on a straight curve: resolution 1 (a fifth of `distance`) loses 0.2% of the points, 2 loses 0.7%, 5 (equal to `distance`) loses 4%, 10 loses 18% and 20 loses half. A fifth of `distance` is the practical floor; below that it only costs sample points, one more per step along every path. |

Run it: `pcg run filter/by-distance-to-curve`

## filter/by-neighbor-count

**Keep points by how crowded they are**

Counts each point's neighbours within a radius and keeps or drops it by that count — 'ge' removes lonely outliers and finds cluster cores, 'le' thins the dense middle out. Fully deterministic: it measures whatever arrives. Reads `P`; writes nothing (the count column is removed again).

**Content hash:** `f461750d35f784ab`

**Tags:** `filter`, `neighborhood`, `spatial`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | 'ge' keeps the crowded points (cluster cores), 'le' keeps the isolated ones. |
| `count` | f32 | `2` | >= 0 |  | yes | keep.value | How many neighbours the comparison is made against. The point itself is not counted. |
| `radius` | f32 | `5` | >= 0 |  | yes | nbr.radius | How far around each point counts as its neighbourhood, in world units. As a FIELD it is a PER-POINT radius, so each point measures the neighbourhood it asks for and the relation stops being symmetric — B within A's reach does not put A within B's. |

Run it: `pcg run filter/by-neighbor-count`

## filter/inside-radius

**Keep the points within a radius of a centre**

Keeps the points whose distance to a centre satisfies a comparison — 'le' for a circular district, 'ge' for an exclusion zone around a landmark. The distance is the true 3D distance, not a squared one and not a planar one, which are the two ways a hand-written version goes wrong. Fully deterministic. Reads `P`; writes nothing (the scratch distance column is removed again).

**Content hash:** `980a8b52f53c9a64`

**Tags:** `filter`, `spatial`, `mask`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | *(nothing — the body's field expressions read it by name)* | World position the distance is measured from, as three numbers [x, y, z]. It is read straight into the distance expression, so the whole triple is set at once — a bare number is not accepted, and the origin is [0, 0, 0]. Field-capable, and resolved on the incoming points: a field moves the centre PER POINT, so distance can be measured from a per-cluster origin rather than from one place. A field may be scalar and broadcasts across all three axes when it is; a plain [x, y, z] is the ordinary case. |
| `comparison` | enum | `"le"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | How the distance is tested: 'le' keeps what is inside the radius, 'ge' keeps what is outside it. |
| `radius` | f32 | `10` | >= 0 |  | yes | keep.value | The distance the comparison is made against, in world units. |

Run it: `pcg run filter/inside-radius`

## filter/mask-by-noise

**Keep the points where a noise field is above a threshold**

Keeps only the points where a normalized noise field rises above a threshold — a HARD mask, giving connected regions with visible edges, the way a coastline separates land from sea. For a soft, gradual fade instead, use `filter/thin-by-density`. On normalized noise a threshold of 0.5 keeps roughly half the area, and higher keeps less — but the usable band is only about 0.32 to 0.68, not the full 0..1 the param's range suggests; the `threshold` description gives the measured table. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances mask IDENTICALLY unless their `variant` differs. Reads `P`; writes nothing at all — the whole test is one field expression, so no scratch column is created to be cleaned up.

**Content hash:** `21ea595e362b93a1`

**Tags:** `filter`, `noise`, `mask`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Feature size: the noise sample position is multiplied by this, so smaller means larger regions. |
| `threshold` | f32 | `0.5` | 0..1 |  | yes | *(nothing — the body's field expressions read it by name)* | Where the cut falls on the 0..1 noise — but the noise only reaches the MIDDLE of that range, so the whole knob lives between about 0.32 (keeps everything) and 0.68 (keeps nothing). Four octaves of normalized fBm come out bell-shaped around 0.5 with a standard deviation near 0.065, never at the ends: the theoretical 0..1 is the nominal range of the term, not the values it takes. Measured on a wide 2D spread: 0.42 keeps ~89%, 0.46 ~75%, 0.50 ~50%, 0.55 ~23%, 0.59 ~9%. So a threshold of 0.8 does not keep a fifth, it keeps NOTHING, and 0.2 does not keep four fifths, it keeps everything. `frequency`, `variant` and how widely the points sample the field move the two ends by a few hundredths. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position — the per-instance re-roll. Two instances with the same value mask identically. |

Run it: `pcg run filter/mask-by-noise`

## filter/thin-by-density

**Thin a point cloud by a noise density**

Writes a normalized noise field into the standard `density` attribute and keeps each point with a probability equal to its density, so dense regions stay full and sparse ones fade out. The result is SOFT-EDGED: individual points thin out gradually, with no boundary. For hard-edged regions with a visible coastline, use `filter/mask-by-noise` instead. VARIATION: which points survive varies per instance (the draw is context-seeded), but the PATTERN does not — this field writes no `opts.seed` at all, and that slot is closed to expressions anyway: it takes an integer, or the tagged `{"from": "node", "variant": N}` form whose `variant` may be an inline `param`, and nothing else, because a field column is f32 and a seed rounded through one avalanches to an unrelated noise — two instances thin the same blobs unless their `variant` differs. Writes `density`; reads `P`.

**Content hash:** `a94d6d5d2f3d9ad4`

**Tags:** `filter`, `noise`, `density`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Feature size: the noise sample position is multiplied by this, so smaller means broader clumps. 0.02 gives clumps tens of world units across. |
| `seed` | u32 | `0` |  |  |  | thin.seed | Re-rolls which points survive within the same pattern. It does NOT move the pattern; `variant` does that. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position — the only way to give two instances different PATTERNS. Any two different values are unrelated; the same value always reproduces. |

Run it: `pcg run filter/thin-by-density`

## place/align-to-surface

**Stand each point up along the surface under it**

Casts a ray from every point onto a mesh, reads the surface `normal` where it lands, and turns the point so its chosen local axis stands along that normal — props lying on slopes instead of standing upright through them. PRECONDITION: the `surface` must carry a `normal` point attribute (f32, tuple 3); a mesh built by `meshPrimitive` carries uv and topology but no normal, so stamp one on it first. A point whose ray misses keeps the previous normal it had, and a zero-length one keeps its existing rotation. Fully deterministic. Writes `rot` and `normal`; `P` is not moved — pair it with `place/drop-to-surface` for that.

**Content hash:** `8e97e3270e054aaa`

**Tags:** `place`, `surface`, `raycast`, `instancing`

**Inputs:** `points` (geometry), `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+y"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset stands along the surface normal. '+y' is upright. |
| `direction` | vec3 | `[0,-1,0]` |  |  | yes | normal.direction | Which way the ray travels to find the surface. [0,-1,0] looks straight down. |
| `maxDistance` | f32 | `0` | >= 0 |  | yes | normal.maxDistance | Longest ray that still counts as a find, in world units. 0 means unlimited. |
| `up` | vec3 | `[0,1,0]` |  |  | yes | orient.up | Up hint fixing the roll around the normal. |

Run it: `pcg run place/align-to-surface`

## place/along-curve

**Space points along a curve and turn them to follow it**

Places points at even arc-length steps along every path of the supplied `curve` and turns each one to face the way the curve is going — fence posts, streetlights, bollards, sleepers. Each path is measured and resampled on its OWN length, so several paths in one input stay separate and each gets its own run of points; `splineSample` would treat them as one concatenated curve instead. PRECONDITION: `curve` must carry polyline topology — `shape/path-loop`, `shape/path-meander` or a `pointsToPath` node, never a bare point cloud, and never anything that has been through a step that can REMOVE points: the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy topology, and `filterByAttribute` does so even when its predicate keeps every point. Category is not the rule — `projectToPlane` is a `filter` that preserves it, because it clones. The points are NEW: they carry `P`, the unit `tangent`, `curveU` (0..1 along their own path) and `rot`, plus the standard attributes at their defaults. Nothing written on the curve's own POINTS survives, which is what `write/orient-along-path` is for — but every PRIMITIVE attribute does: a post placed along a road carries that road's `roadWidth` and `roadKind`, because a sample inherits the primitive it was taken from. The output is still a path, so it can be resampled again. Fully deterministic.

**Content hash:** `7ac69e839d461b15`

**Tags:** `place`, `curve`, `path`, `instancing`

**Inputs:** `curve` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset points along the curve. '+z' is the forward axis assets face by convention. |
| `count` | i32 | `24` | >= 2 |  |  | resample.count | Points per path in 'count' mode: exactly this many come out, whatever the path's length, and they are evenly spaced at length / (count - 1) — so a 40-unit path at count 5 pitches them every 10 units, and the two ends are always occupied. At least 2 (3 on a closed path); ignored in 'spacing' mode. |
| `mode` | enum | `"count"` |  | `count`, `spacing` |  | resample.mode | 'count' puts exactly `count` points on each path whatever its length; 'spacing' steps every `spacing` world units, so longer paths get more points — the right one for evenly pitched props. |
| `spacing` | f32 | `1` | >= 0 |  | yes | resample.spacing | Distance between points in world units in 'spacing' mode — exact for every step except the LAST, which is the leftover. The walk starts at the beginning of each path, steps `spacing` until another step would overshoot, then puts a final point exactly on the end: a 40-unit path at spacing 7 comes out with gaps 7, 7, 7, 7, 7, 5. So the count per path is floor(length / spacing) + 2, or length / spacing + 1 when it divides exactly, and the far end is always the short one. For props that must be evenly pitched the whole way, pick a `spacing` that divides the path length. Must be greater than 0 and short enough to leave 2 points on the shortest path; ignored in 'count' mode. |
| `up` | vec3 | `[0,1,0]` |  |  | yes | orient.up | Up hint fixing the roll around the curve; leave it at world up for props that stand on the ground. |

Run it: `pcg run place/along-curve`

## place/drop-to-surface

**Drop points onto a mesh and discard the misses**

Casts a ray from every point along a direction, moves each one to where it hits the mesh, and DISCARDS the ones that hit nothing — which is what turns any flat scatter into a terrain-aware one. THREE nodes casting ONE ray: the transfer moves `P` to the hit AND reports per point whether it found anything, so the filter that discards the misses reads the outcome of the very ray that did the moving. It used to be five nodes and two rays, the second cast only to recover what the first already knew; there is nothing left to get out of order. A miss keeps its prior position and is filtered out. Fully deterministic. Reads and writes `P`; the internal `__onSurface` flag column (bool, tuple 1) is removed again. PRECONDITION: the input must not already carry `__onSurface` under a different shape — the hit flag refuses to delete an existing column, so it stops instead of cooking something plausible; an input holding the name as a bool is harmless, since every point is rewritten.

**Content hash:** `998e22fafd04cba1`

**Tags:** `place`, `surface`, `raycast`, `terrain`

**Inputs:** `points` (geometry), `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `direction` | vec3 | `[0,-1,0]` |  |  | yes | snap.direction | Which way the ray travels. [0,-1,0] drops straight down; rays are forward-only, so points below the surface miss. |
| `maxDistance` | f32 | `0` | >= 0 |  | yes | snap.maxDistance | Longest drop that still counts as a landing, in world units. 0 means unlimited. |

Run it: `pcg run place/drop-to-surface`

## place/on-surface

**Scatter points across a mesh with height and slope**

Scatters points over a triangle mesh with probability proportional to triangle area, then stamps the two standard terrain quantities — `height` (world Y) and `slope` (1 - normal.y) — so downstream filters have something to test without re-deriving it. The points also carry the flat per-triangle `normal` the sampler writes. COUNT: `count` is the number of CANDIDATES; with the default density of 1 every one is kept, and a lower `density` keeps proportionally fewer. VARIATION: yes — two instances in one graph sample differently, and `seed` re-rolls one explicitly. Writes `height`, `slope`, `normal`, `density`.

**Content hash:** `cc714c8bfddb1f4d`

**Tags:** `place`, `surface`, `terrain`, `scatter`

**Inputs:** `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `1000` | >= 0 |  |  | sample.count | Candidates placed on the mesh before density acceptance. |
| `density` | f32 | `1` | 0..1 |  | yes | sample.densityField | Acceptance probability per candidate, 0..1 — where sampling is allowed at all. Pass a field spec to make it vary across the surface. |
| `seed` | u32 | `0` |  |  |  | sample.seed | Re-rolls the sampling. Two instances already differ without it. |

Run it: `pcg run place/on-surface`

## place/plantable

**Scatter points only where vegetation could grow**

Scatters points on a mesh and keeps only the ones on gentle enough ground below a height limit — the standard 'where can vegetation go' test, and the shape every forest in the demo corpus is built from. `maxSlope` is on the 0..1 scale `place/on-surface` writes, where 0 is dead flat: 0.3 is about a 45-degree limit. VARIATION: yes, through the scatter. Built on `place/on-surface`, so the output carries `height`, `slope`, `normal` and `density` too.

**Content hash:** `b5bdeceea73e7232`

**Tags:** `place`, `surface`, `terrain`, `vegetation`

**Inputs:** `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `1000` | >= 0 |  |  | pts.count | Candidates placed on the mesh before the slope and height tests. |
| `density` | f32 | `1` | 0..1 |  | yes | pts.density | Acceptance probability per candidate, 0..1. Pass a field spec to make it vary across the surface. |
| `maxHeight` | f32 | `60` |  |  | yes | height.value | Highest world Y still plantable — a tree line. |
| `maxSlope` | f32 | `0.3` |  |  | yes | slope.value | Steepest ground still plantable, on the `slope` scale `write/height-slope` writes — which is 1 - cos(angle), NOT a fraction of 90 degrees, so it is heavily compressed at the flat end and half the scale already covers two thirds of the range of real slopes. The default 0.3 is therefore a 45-degree limit, not the 27-degree one a linear reading gives. The anchors, measured: 10 degrees is 0.015, 20 is 0.060, 30 is 0.134, 45 is 0.293, 60 is 0.500, 75 is 0.741, 90 is 1. Inverted, for a limit of A degrees pass 1 - cos(A). |
| `seed` | u32 | `0` |  |  |  | pts.seed | Re-rolls the sampling. Two instances already differ without it. |

Run it: `pcg run place/plantable`

## place/radial-on-curve

**Place points along a curve and aim them radially**

Places points at even arc-length steps along every path of the supplied `curve`, then rolls each one to a random angle AROUND the curve — spikes on a mace, bristles on a brush, brackets round a mast, leaves up a stem, buds on a branch. It is deliberately distinct from `place/along-curve`, which spaces points the same way but aims them ALONG the tangent with a CONSTANT world `up`: that fixes every asset in the same world orientation, and it flips them a half turn wherever the curve turns over. Here the up hint is per point — cos(a) * `curveNormal` + sin(a) * `curveBinormal`, the unit vector at a random angle a in the plane perpendicular to the tangent, taken from the rotation-minimizing frame `write/curve-frame` describes — so the assets fan out around the path and the fan follows the path however it bends. A constant up simply cannot express that, which is the whole reason to reach for this one. GEOMETRY: the asset's local +z runs along the curve and its local +y is the radial direction, so a prop that must stick OUT of the path wants its length on +y. The points are NEW: they carry `P`, the unit `tangent`, `curveU`, `curveNormal`, `curveBinormal` and `rot`, plus the standard attributes at their defaults, and nothing written on the curve's own POINTS survives — use `write/curve-frame` and an `orientAlongVector` of your own if it must. Every PRIMITIVE attribute does survive, since a sample inherits the polyline it was taken from. PRECONDITION: `curve` must carry polyline topology and must not have been through anything that can REMOVE points — the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy it, and `filterByAttribute` does so even when its predicate keeps every point. VARIATION: yes — the angle is drawn from the evaluation context, so two instances in one graph fan differently on their own; there is no seed knob, so an explicit re-roll means a different `spread`. A CLOSED path does not come back seamless: the frame is transported around the loop and returns rotated by that curve's residual angle, so the fan does not line up across the seam. The output is still a path and can be resampled again.

**Content hash:** `eb37e7014fb3b60b`

**Tags:** `place`, `curve`, `path`, `instancing`

**Inputs:** `curve` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `24` | >= 2 |  |  | resample.count | Points per path: exactly this many come out whatever the path's length, evenly spaced at length / (count - 1), and both ends are always occupied. At least 2 (3 on a closed path). For a fixed pitch in world units instead, resample with `place/along-curve` in 'spacing' mode first and feed the result in here. |
| `spread` | f32 | `1` | >= 0 |  | yes | *(nothing — the body's field expressions read it by name)* | How much of a full turn around the curve the fan covers, as a fraction: 1 spreads uniformly over the whole circle, 0.25 over a quarter turn, and 0 aims every point the same way — straight along the transported `curveNormal`, which is a smooth ribbon rather than a fan, and the one setting that does NOT vary between two instances. The angle is drawn uniformly over 0..spread turns, so it is one-sided: the fan opens from the normal in one direction only, and a spread of 0.5 covers a half turn from it rather than a quarter turn either side. Values above 1 wrap and buy nothing. |

Run it: `pcg run place/radial-on-curve`

## shape/disc

**Points scattered uniformly inside a circle**

Scatters points uniformly inside a disc in the XZ plane by scattering a square and rejecting the corners — the circular counterpart to scattering a box, and the right answer when scattering a square and hoping is wrong. COUNT: `count` is the number of CANDIDATES; the disc keeps about 78.5% of them, so asking for 1000 gives roughly 785 points. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.

**Content hash:** `04436e88391a9fb8`

**Tags:** `shape`, `scatter`, `radial`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `600` | >= 0 |  |  | scatter.count | Candidates scattered before the corners are rejected. About 78.5% survive. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `seed` | u32 | `0` |  |  |  | scatter.seed | Re-rolls the scatter. Two instances already differ without it. |
| `size` | vec3 | `[8,8,8]` |  |  | yes | place.scale | Size of the shape in world units — a radius for the round ones. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse or an ellipsoid. |

Run it: `pcg run shape/disc`

## shape/path-loop

**A closed path around a circle**

Builds a CLOSED PATH — polyline topology, not a loose point cloud — around a circle in the XZ plane, then sizes, rotates and moves it. This is the curve source a saved graph reaches for: feed it to `place/along-curve`, `filter/by-distance-to-curve`, `write/orient-along-path` or the `splineSample` / `pathResample` nodes, which all report finding no polylines when handed a point cloud. COUNT: `count` is the number of corner points and exactly the number of points emitted; closure is structural (a trailing vertex back to the first point), so there is no duplicated seam point to trip over. Built on `shape/ring`, so the points also carry `scale` at 1. Fully deterministic. TOPOLOGY IS FRAGILE: anything that can REMOVE points destroys it — the `filter/*` family, `partitionByAttribute` (categorised `attribute`, not `filter`) and `mergePoints` — so whatever must see a path has to come before them. The category is not the rule: `projectToPlane` is a `filter` that PRESERVES topology because it clones rather than gathers, and `filterByAttribute` drops it even when its predicate keeps every point.

**Content hash:** `2603767744729512`

**Tags:** `shape`, `curve`, `path`, `radial`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | ring.center | Where the loop sits, in world units. |
| `count` | i32 | `24` | >= 3 |  |  | ring.count | Corner points around the loop. At least 3 — two points cannot enclose anything — and higher counts make the polygon read as a circle. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | ring.rotate | Rotation in degrees per world axis, applied about the origin before the loop is moved into place. |
| `size` | vec3 | `[8,8,8]` |  |  | yes | ring.size | Radius of the loop in world units. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse. |

Run it: `pcg run shape/path-loop`

## shape/path-meander

**A wandering open path between two ends**

Builds an open PATH — polyline topology — that runs along X and wanders off the straight line by a noise field, then evens the spacing out again by arc length. The resampling is the content: displacing a polyline sideways stretches the segments where the wander is steep, so points placed along it afterwards would bunch on the straight parts, and the fix cannot be seen in a picture until something is spawned on it. Use it for a road, a river, a fence line or a trail. COUNT: `count` is both the number of corners the wander is built from and the number of points emitted, evenly spaced along the finished curve. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances wander IDENTICALLY unless their `variant` differs. Writes `P`, the unit `tangent` and `curveU` (0..1 along the path) on points the resample creates, so the recipe writes no working column at all and the per-point `scale` is 1. TOPOLOGY IS FRAGILE: anything that can REMOVE points destroys it — the `filter/*` family, `partitionByAttribute` and `mergePoints` — so a path has to reach its consumer before them. Being a `filter` is not the rule: `projectToPlane` PRESERVES topology (it clones), while `filterByAttribute` drops it even when its predicate keeps every point.

**Content hash:** `bad7066a523e99ff`

**Tags:** `shape`, `curve`, `path`, `noise`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `33` | >= 2 |  |  | line.count, even.count | Points along the path, and the number of corners the wander is drawn from. A dozen or more before the wander reads as a curve rather than a zig-zag. |
| `frequency` | f32 | `3` |  |  | yes | *(nothing — the body's field expressions read it by name)* | How many bends over the length of the path, roughly: the noise sample position is multiplied by this, so smaller means longer, lazier curves. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `size` | vec3 | `[40,1,40]` |  |  | yes | place.scale | Extent in world units: X is the end-to-end length, Z scales the wander. A bare number is not accepted here: pass three numbers [40,1,40], or {"fn":"constant","value":40}. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field. |
| `wander` | f32 | `0.15` |  |  | yes | *(nothing — the body's field expressions read it by name)* | How far the path strays from the straight line between its ends. 0 is a straight line; above that the peak deviation is about 0.22 * wander * `size.z`, exactly linear in both — so at the default `size` [40,1,40], 0.15 strays about 1.3 units to each side and 0.5 about 4.4. Inverted, for a peak of a fraction f of `size.z`, ask for wander around 4.6 * f. This is a FRACTION OF A NOMINAL RANGE, not of the deviation you get: the value scales a noise term whose range is +/-1 in principle, but four octaves of normalized fBm sampled along one line only cover part of it, and `frequency` and `variant` move that coverage (measured 0.13 to 0.31 of wander * `size.z` across the usable range). The wander is sideways only — the path is a height field along X, so it NEVER doubles back on itself at any wander; for a curve that turns back, build the corners yourself and run `pointsToPath` over them. |

Run it: `pcg run shape/path-meander`

## shape/ring

**Points evenly around a circle or an arc**

Places points evenly around a circle in the XZ plane, optionally sweeping only part of the way round, then sizes, rotates and moves the result. COUNT: `count` is exactly the number of points emitted, whatever `sweep` and `includeEnd` are. The seam is handled by `includeEnd`, not by deleting a point: left false (the default) the samples divide the sweep and the last one stops one step short, which is what a full circle needs — the end of a full sweep IS its start. Set it true for an arc that must touch both ends. Emits a loose point CLOUD, not a path: for polyline topology use `shape/path-loop`, which is this primitive plus the closure. Fully deterministic: two instances with the same params are identical, which is what a ring should be. Writes `P`; leaves the per-point `scale` attribute at 1 so the ring's size does not become the asset's size.

**Content hash:** `61c2a9c21755544f`

**Tags:** `shape`, `radial`, `outline`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `24` | >= 1 |  |  | line.count | How many points to place, and exactly how many come out — the sweep is divided into this many samples. |
| `includeEnd` | bool | `false` |  |  |  | line.includeEnd | Whether the last point lands exactly on the end of the sweep. Leave it false for a full circle: the end is the start, so a point there would sit on top of the first one. Set it true for a partial sweep pinned at both ends (a quarter arc whose corners must be occupied). It never changes how many points come out, only where the last one sits. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `size` | vec3 | `[8,8,8]` |  |  | yes | place.scale | Size of the shape in world units — a radius for the round ones. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse or an ellipsoid. |
| `sweep` | f32 | `1` | 0..1 |  | yes | *(nothing — the body's field expressions read it by name)* | How far round to go: 1 is a closed circle, 0.5 a half-circle, 0.25 a quarter arc. |

Run it: `pcg run shape/ring`

## shape/sphere-points

**Points scattered uniformly on a sphere**

Scatters points uniformly over the surface of a sphere, by rejecting a cube scatter down to the ball first and then pushing every survivor out to the surface. The rejection step is the content: normalizing a cube scatter directly piles points up toward the eight corner directions, and the result looks wrong without looking obviously wrong. COUNT: `count` is the number of CANDIDATES; the ball keeps about 52.4% of them. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.

**Content hash:** `9bb9972d74d6b2da`

**Tags:** `shape`, `scatter`, `radial`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `800` | >= 0 |  |  | scatter.count | Candidates scattered in the cube before rejection to the ball. About 52.4% survive. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `seed` | u32 | `0` |  |  |  | scatter.seed | Re-rolls the scatter. Two instances already differ without it. |
| `size` | vec3 | `[8,8,8]` |  |  | yes | place.scale | Size of the shape in world units — a radius for the round ones. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse or an ellipsoid. |

Run it: `pcg run shape/sphere-points`

## shape/spiral

**Points winding outward over a number of turns**

Winds points outward from the origin over a given number of turns in the XZ plane — an Archimedean spiral, evenly spaced in angle — then sizes, rotates and moves the result. `size` is the OUTER radius: the innermost point sits at the centre and the outermost exactly on the rim. Emits a loose point CLOUD, not a path. Fully deterministic: two instances with the same params are identical. Writes `P`; leaves the per-point `scale` attribute at 1.

**Content hash:** `61244d9febfed57d`

**Tags:** `shape`, `radial`, `outline`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `160` | >= 1 |  |  | line.count | Points along the spiral, evenly spaced in angle (so they crowd near the centre). |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `size` | vec3 | `[8,8,8]` |  |  | yes | place.scale | Size of the shape in world units — a radius for the round ones. A bare number is not accepted here: pass three numbers [8,8,8], or {"fn":"constant","value":8} for a uniform one. Unequal components give an ellipse or an ellipsoid. |
| `turns` | f32 | `3` | >= 0 |  | yes | *(nothing — the body's field expressions read it by name)* | How many full revolutions the spiral makes between the centre and the outer radius. |

Run it: `pcg run shape/spiral`

## transform/displace-by-noise

**Push points up and down by a noise field**

Displaces every point along +Y by a noise field centred on zero, so a flat scatter becomes a rolling one. The displacement is centred: the mean height does not move, and the peak is a FRACTION of `amount` — about 0.42 on a wide cloud and as little as 0.25 on a small patch, never `amount` itself. See that param for the law. LIMITATION: +Y only — the direction lives inside the field structure, not in a param slot, so displacing along another axis means rotating the whole result. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances displace IDENTICALLY unless their `variant` differs, and this is the primitive most likely to be used twice in one graph. Reads and writes `P`; leaves every other attribute alone.

**Content hash:** `8fe1bd2b9b26ccdc`

**Tags:** `transform`, `noise`, `terrain`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `amount` | f32 | `4` |  |  | yes | *(nothing — the body's field expressions read it by name)* | How far points move along Y. It SCALES the displacement but does not bound it: on a cloud spanning many noise periods the peak is about 0.42 * amount, so the default 4 lifts and drops by roughly 1.7 units, and for a peak of h world units ask for amount around 2.4 * h. Exactly linear in amount — doubling it doubles every displacement — and the mean stays within 1% of 0, so the average height does not move. This is a FRACTION OF A NOMINAL RANGE, not of the displacement you get: the value scales a noise term whose range is +/-1 in principle, and four octaves of normalized fBm only ever reach the middle of it. How much of it depends on how much FIELD the cloud spans — extent x `frequency`, not the point count. Measured at amount 4: a 600-unit spread peaks at 0.42 to 0.49 of amount at every frequency from 0.01 up, while a 30-unit patch at the default frequency 0.05 spans barely one period and peaks at only 0.25, whether it holds 100 points or 20,000. On a small patch, either raise `frequency` or scale `amount` up to compensate. |
| `frequency` | f32 | `0.05` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Feature size: the noise sample position is multiplied by this, so smaller means longer, gentler waves. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field. |

Run it: `pcg run transform/displace-by-noise`

## transform/gather-on-path

**Gather a path's own points into clumps along it**

Slides every point of a path along the curve it already sits on, toward the centre of its own bin, so an even distribution becomes clumps with bare runs between them — hedgerows, rock piles, bundled cables, knots in a crowd. Nothing is created or deleted: the count, the attributes and the polyline topology all survive, and each point is RE-EVALUATED on the curve rather than stepped along its tangent, so it stays exactly on the path however hard the path bends. Each point's target is the centre of the bin its own `curveU` falls into — `bins` equal bins per path — and `amount` is how far of the way there it travels, so 0 changes nothing and 1 collapses every bin onto a single spot. PRECONDITION: the input must carry `curveU` (f32, tuple 1) as well as polyline topology, so it has to have come from a sampler that writes one — `pathResample`, `splineSample`, `place/along-curve`, `place/radial-on-curve` or `shape/path-meander`. A path built straight out of `pointsToPath` has no parameterization to gather along, and the cook fails naming `curveU` rather than guessing one. The point sitting exactly at the end of a path does not move: its bin centre lies past the end and clamps back onto it. `curveU` and `tangent` are rewritten to where each point LANDS, so a second gather bins the new positions and not the old ones. Fully deterministic: two instances with the same params clump identically, and there is no seed — the clumps are where the bins are, not where a draw put them. Reads and writes `P`; every other attribute arrives untouched.

**Content hash:** `99afd454caeffa25`

**Tags:** `transform`, `curve`, `path`, `spacing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `amount` | f32 | `0.7` | 0..1 |  | yes | *(nothing — the body's field expressions read it by name)* | How far of the way to its bin centre each point travels, 0..1: 0 leaves the distribution exactly as it arrived, 1 collapses every bin onto a single point, and the travel is exactly linear in between — 0.5 halves every gap to the centre. Field-capable, resolved on the points BEFORE they move, so a field over `curveU` can gather one end of a path harder than the other. |
| `bins` | f32 | `6` | >= 1 |  | yes | *(nothing — the body's field expressions read it by name)* | How many clumps each path gets: its 0..1 parameter is cut into this many equal bins and every point heads for the centre of its own. Fewer bins means fewer, fatter clumps further apart, and the clumps land at (i + 0.5) / bins along each path — a fixed lattice, not a random one, so two paths of different lengths clump at the same RELATIVE places. It is per path rather than per world unit, so a long path and a short one both get `bins` clumps; for a fixed clump pitch, resample to a `spacing` first and scale this with the length. A fractional value leaves a short last bin at the far end. Field-capable like every knob here, but keep it UNIFORM unless you mean otherwise: a bin count that varies per point stops partitioning the path, because neighbouring points then head for the centres of bins that do not line up. A field over something constant along each path — a per-path attribute, say — is the coherent way to vary it; a field over `curveU` or position is not. Guarded at the point of use, because it is the DIVISOR that turns a 0..1 parameter into a bin: anything below the declared minimum of 1 is read as exactly 1 — one bin, the whole path gathering onto a single spot — and that covers the values a bound cannot refuse, since a field's are never range-checked. A plain value below 1 is still an error rather than a clamp. |

Run it: `pcg run transform/gather-on-path`

## transform/relax-spacing

**Even out spacing without deleting anything**

Nudges every point away from the centroid of its neighbours, so crowded regions spread out and the spacing evens up while the COUNT stays exactly the same. This is the alternative to `selfPrune`, which enforces spacing by deleting: use this one when the count is fixed (a fleet, a crowd, a fixed budget of props). A strength near 0.5 is one relaxation step; run the primitive twice for a stronger effect rather than pushing the strength past 1, which overshoots and oscillates. Isolated points do not move. Fully deterministic. Reads and writes `P`; leaves every other attribute alone.

**Content hash:** `f71db798e240a787`

**Tags:** `transform`, `neighborhood`, `spacing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `radius` | f32 | `4` | >= 0 |  | yes | nbr.radius | How far around each point counts as its neighbourhood, in world units. Points with nothing inside it do not move. As a FIELD it is a PER-POINT radius, so each point measures the neighbourhood it asks for and the relation stops being symmetric — B within A's reach does not put A within B's. |
| `strength` | f32 | `0.5` |  |  | yes | *(nothing — the body's field expressions read it by name)* | How far along the push each point travels: the point moves exactly strength * (its own position - the mean position of its neighbours inside `radius`), so 0 changes nothing and the travel is exactly linear in strength. It is a fraction of a LOCAL offset, not a world distance, so `radius` sets the scale and this sets the fraction of it: measured on 300 points in a 30x30 box, strength 0.5 moves the average point 0.42 units at radius 4 and 1.5 units at radius 12, and strength 1 moves it exactly twice as far. 0.5 is one relaxation step; run the primitive twice rather than pushing past 1, which overshoots and oscillates. |

Run it: `pcg run transform/relax-spacing`

## transform/snap-to-grid

**Move every point to the nearest grid corner**

Snaps every point to the nearest corner of a regular 3D grid of the given pitch, so scattered positions become tile-aligned. Note that snapping can land two points on the SAME corner: follow it with `selfPrune` at a distance just under the pitch if the duplicates matter. Fully deterministic. Reads and writes `P`; leaves every other attribute alone, including `scale`.

**Content hash:** `fb6cdc17c05250bf`

**Tags:** `transform`, `grid`, `align`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cellSize` | f32 | `4` | >= 0.000001 |  | yes | *(nothing — the body's field expressions read it by name)* | Grid pitch in world units, the same on all three axes. It is the DIVISOR of the snap, so it must be greater than 0 — declared as well as said: a plain value below 0.000001 is refused by name, and a FIELD delivering one — which no declared bound can refuse — is clamped to 0.000001 at the point of use rather than dividing by it. That clamp is the limit the pitch was heading for anyway: a millionth-of-a-unit grid moves a point by at most half of that, so a pitch of 0 or less leaves the cloud where it is instead of snapping every position to NaN. The clamp is a floor and nothing more: a field that returns NaN still snaps to NaN, because there is no value to floor it to. |

Run it: `pcg run transform/snap-to-grid`

## write/color-from-attribute

**Turn a scalar attribute into a colour gradient**

Rescales any numeric point attribute to 0..1 over its OWN observed range, then maps it through a blue-green-yellow-red heat ramp into the standard `color` attribute (f32, tuple 4, alpha 1). Fitting to the observed range is what makes it work on an invented quantity — a neighbour count, a hand-built score — without knowing its scale in advance. Fully deterministic: two instances produce identical output. Writes `color`; reads the attribute named by `source`, which must exist on the point domain.

**Content hash:** `c49261568d4e645b`

**Tags:** `write`, `color`, `debug`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `source` | string | `"density"` |  |  |  | fit.name | Numeric point attribute to colour by. It is fitted to its own minimum and maximum, so any scale works — 'density', 'height', 'slope' or anything you computed yourself. |

Run it: `pcg run write/color-from-attribute`

## write/curve-frame

**Write a smoothly carried frame along a path**

Writes a full orthonormal frame at every point of a path — `tangent`, `curveNormal` and `curveBinormal` (f32, tuple 3) — with the normal CARRIED along the curve by rotation-minimizing transport rather than rebuilt from a world axis at each point. That is the thing a constant `up` cannot do: as a curve turns over, a tangent passing through the up vector flips the roll a half turn and everything placed there snaps round with it. Feed `curveNormal` back into `orientAlongVector`'s `up` — field-capable for exactly this — and the roll varies smoothly however the curve bends; combine the normal and the binormal with cos and sin of an angle to aim anything RADIALLY around the path, which is what `place/radial-on-curve` does. It sits beside `write/orient-along-path`: that one turns the points to face ALONG the curve, this one hands over the two perpendicular axes as well and writes no `rot` at all. The points, their attributes and the topology all arrive and leave untouched. PRECONDITION: the input must carry polyline topology; a point on no polyline gets [0,0,0] on all three columns. ORDER: run it AFTER any resample — `pathResample` and `splineSample` build NEW points and do not carry the input's point attributes, so a frame written before one is silently dropped there — and BEFORE anything that can remove points, since the `filter/*` family, `partitionByAttribute` and `mergePoints` all destroy the topology it needs. THE FRAME IS NOT LOCAL: a point's normal depends on every point before it along its own path, so a curve that arrives split across two cook cells gets two unrelated frames, and a CLOSED path does not come back seamless — transport around a loop returns rotated by that curve's own residual angle, either side of the seam differs, and no local rule can fix it. Fully deterministic: two instances write identical frames. Writes `tangent`, `curveNormal` and `curveBinormal`; `P` and the count are untouched.

**Content hash:** `01aa13cf72e15dd8`

**Tags:** `write`, `curve`, `path`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `binormalName` | string | `"curveBinormal"` |  |  |  | frame.binormalName | Attribute the binormal — tangent cross normal, the frame's third axis — is written to. It ships as a column rather than being recomputed downstream, because recomputing it from two f32 columns is where a frame stops being exactly orthonormal. |
| `normalName` | string | `"curveNormal"` |  |  |  | frame.normalName | Attribute the transported normal is written to. Do NOT rename it to 'normal': `surfaceSample` writes a surface `normal` of the very same shape (f32, tuple 3), and a matching shape is exactly the case an attribute writer ACCEPTS — so a graph that samples a surface and frames a curve would have one silently overwrite the other. |
| `tangentName` | string | `"tangent"` |  |  |  | frame.tangentName | Attribute the unit tangent is written to. The default 'tangent' is what `pathResample` and `splineSample` emit and what an `orientAlongVector` direction field reads, so leave it alone unless two frames have to coexist on one cloud. |

Run it: `pcg run write/curve-frame`

## write/density-from-noise

**Write the standard density attribute from a noise field**

Writes `density` (f32, 0..1) from four octaves of normalized Perlin fBm — the exact input `filterByDensity` and the density-aware samplers expect, separated from applying it so one pattern can drive a thin, a colour and a scale. VARIATION: noise does not vary per instance. Two instances of this primitive with the same params write the IDENTICAL pattern, and this primitive exposes no seed that could change it — its field writes no `opts.seed`, and that slot admits only an integer or the tagged `{"from": "node", "variant": N}` form whose `variant` may be an inline `param`, never an arbitrary expression, because a field column is f32 and a seed rounded through one avalanches to an unrelated noise. Pass a different `variant` to move the sample position to an unrelated part of the field, which is the per-instance re-roll. Writes `density`; reads nothing.

**Content hash:** `2e7fc0e994278fb0`

**Tags:** `write`, `noise`, `density`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Feature size: the noise sample position is multiplied by this, so smaller means broader blobs. 0.02 gives features tens of world units across. |
| `variant` | f32 | `0` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Offset added to the noise sample position. This is the per-instance re-roll this primitive offers: any two different values give unrelated patterns, and the same value always reproduces. |

Run it: `pcg run write/density-from-noise`

## write/height-slope

**Stamp height and slope from a surface normal**

Writes the two standard terrain quantities onto points that already carry a surface normal: `height` (f32) is the world Y of each point, and `slope` (f32) is 1 - normal.y, so 0 is dead flat and 1 is a vertical wall. That scale is 1 - cos(angle) and so is NOT linear in degrees — it is compressed at the flat end, where 30 degrees is only 0.134 and 45 is 0.293, and half the scale (0.5) is already 60 degrees. Downstream filters can then test ground suitability without re-deriving either. PRECONDITION: the input must carry a `normal` point attribute (f32, tuple 3) — `surfaceSample` writes one, and `place/align-to-surface` transfers one from a mesh; without it the cook fails naming the missing attribute. Fully deterministic: two instances of this primitive produce identical output.

**Content hash:** `8ef9938364bb9298`

**Tags:** `write`, `terrain`, `attributes`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:** *(none)*

Run it: `pcg run write/height-slope`

## write/instances-by-species

**Pick one asset per point and emit the instances**

Chooses an asset id per point from a list and emits the instance batches — the multi-asset spawn. The point of the primitive is the string coupling: one param names BOTH the attribute the choice is written to and the attribute the spawner reads it back from, so the two can never drift apart. The built-in selector spreads uniformly over FOUR entries, so pass exactly four assets and repeat one to weight it (['pine','pine','birch','bush'] is 50/25/25). VARIATION: yes — the choice comes from the evaluation context, so two instances differ automatically, and `seed` re-rolls one explicitly. Writes the species attribute; reads `P`, `rot` and `scale` through the spawner.

**Content hash:** `0b3a9c8e048b9a12`

**Tags:** `write`, `spawn`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `instances` (instances), `points` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `assetId` | string | `"pine"` |  |  |  | spawn.assetId | Asset id used for any point whose species entry is empty. |
| `assets` | stringList | `["pine","pine","birch","bush"]` |  |  |  | species.values | Asset ids to choose among, as four entries. Repeat an entry to weight it; an empty entry falls back to `assetId`. |
| `seed` | u32 | `0` |  |  |  | species.seed | Re-rolls which point gets which asset. 0 uses the node's own derived seed. |
| `speciesAttr` | string | `"species"` |  |  |  | species.name, spawn.assetAttr | Name of the string point attribute holding the per-point asset id. One knob writes it and reads it, so the writer and the spawner cannot disagree. |

Run it: `pcg run write/instances-by-species`

## write/local-density

**Write how crowded each point is as a density**

Counts each point's neighbours within a radius and rescales the counts to 0..1 over their own observed range, writing the standard `density` attribute — so crowding can drive size, colour, or a proportional thinning through `filter/thin-by-density`. Fully deterministic: two instances produce identical output, since this measures whatever arrives rather than inventing anything. Writes `density`; reads `P`.

**Content hash:** `783e65a1eff6cea7`

**Tags:** `write`, `neighborhood`, `density`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `radius` | f32 | `5` | >= 0 |  | yes | nbr.radius | How far around each point counts as its neighbourhood, in world units. It changes the ORDERING of the densities, never their range: the counts are refitted to 0..1 over whatever spread they happen to have, so the emptiest point is always exactly 0 and the fullest always exactly 1 at every radius, and even a perfectly uniform scatter comes out spanning the full 0..1 (measured mean 0.56). Two consequences an agent has to plan around: the values are NOT comparable between two clouds, two radii or two cooks with different counts, and a threshold like 0.8 means 'the top of THIS cloud' rather than any absolute crowding. For an absolute measure, read the raw neighbour count with a `pointNeighborhood` node instead. As a FIELD it is a PER-POINT radius, so each point measures the neighbourhood it asks for and the relation stops being symmetric — B within A's reach does not put A within B's. |

Run it: `pcg run write/local-density`

## write/orient-along-path

**Turn a path's own points to follow the path**

Writes a unit `tangent` along the polyline at every point of a path, then sets `rot` so each point faces that way — the points, their attributes and the topology all arrive and leave untouched. That is the whole difference from `place/along-curve`, which resamples: use this one when the points already mean something (a species, a scale, a colour, a point index other geometry refers to) and must survive being oriented. It is also the only way to orient the points of a path that was hand-built with `pointsToPath`, since a tangent otherwise exists only on points a sampler created. The tangent is the normalized central difference between each point's neighbours along the path, so it stays smooth through corners, and it wraps on a closed path. PRECONDITION: the input must carry polyline topology; a point on no polyline gets a zero tangent and deliberately keeps the `rot` it had. Run it BEFORE anything that can REMOVE points — the `filter/*` family, `partitionByAttribute` and `mergePoints` all drop topology, and this node would then find no paths. Category is not the predicate: `filterByAttribute` drops it even when its predicate keeps every point, while `projectToPlane` is a `filter` that preserves it by cloning. Fully deterministic. Writes `tangent` and `rot`; `P` and the count are untouched.

**Content hash:** `ca79e90912aad86a`

**Tags:** `write`, `curve`, `path`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset points along the path. '+z' is the forward axis assets face by convention. |
| `up` | vec3 | `[0,1,0]` |  |  | yes | orient.up | Up hint fixing the roll around the path; leave it at world up for props that stand on the ground. |

Run it: `pcg run write/orient-along-path`

## write/random-scale

**Write one uniform random size per point**

Writes the standard `scale` attribute (f32, tuple 3) as ONE random size per point, drawn uniformly between min and max — both ends reachable — and written the same on all three axes. It REPLACES `scale` rather than multiplying it, so anything an earlier node wrote there is discarded and two of these in a chain do not compound. The uniformity is the content: a hand-written version reaches for a separate random per axis and gets an asset stretched differently in x, y and z, which reads as a modelling error rather than as variety. VARIATION: yes — the draw comes from the evaluation context, so two instances in one graph differ automatically, and `seed` re-rolls one of them explicitly. Writes `scale`; reads nothing.

**Content hash:** `b52724f8e8c38fa0`

**Tags:** `write`, `scatter`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `max` | f32 | `1.4` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Largest size a point can get, as a multiple of the asset's own size. |
| `min` | f32 | `0.7` |  |  | yes | *(nothing — the body's field expressions read it by name)* | Smallest size a point can get, as a multiple of the asset's own size. |
| `seed` | u32 | `0` |  |  |  | scaleAttr.seed | Re-rolls which point gets which size. 0 uses the node's own derived seed. |

Run it: `pcg run write/random-scale`

## write/random-yaw

**Turn each point to face a random direction**

Writes the standard `rot` attribute so every point faces a uniformly random direction around the vertical axis, so repeated assets do not all point the same way. The field is the content: the direction an author reaches for instead — a noise vector — is SPATIALLY CORRELATED, which reads as a combed field rather than randomness and is a bug that is hard to diagnose from the result. VARIATION: yes — the draw comes from the evaluation context, so two instances in one graph differ automatically. Writes `rot`; reads nothing.

**Content hash:** `c29485b2fe9804fb`

**Tags:** `write`, `scatter`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | yaw.axis | Which local axis of the asset turns to face the random direction. '+z' is the forward axis assets face by convention. |
| `up` | vec3 | `[0,1,0]` |  |  | yes | yaw.up | Up hint fixing the roll; leave it at world up unless the assets stand along another axis. |

Run it: `pcg run write/random-yaw`
