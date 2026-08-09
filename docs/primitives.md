# Primitive reference

Generated from the named-subgraph registry (`listSubgraphs()`) by `node scripts/gen-primitives.mjs` — do not edit by hand. The same catalog, machine-readable, is in [primitives.json](./primitives.json). For the graph JSON format, including how a graph references a primitive by name, see [authoring.md](./authoring.md); for the node types a primitive is built from, [nodes.md](./nodes.md).

34 registered primitives, alphabetical:

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
- [shape/disc](#shapedisc) — Points scattered uniformly inside a circle
- [shape/path-loop](#shapepath-loop) — A closed path around a circle
- [shape/path-meander](#shapepath-meander) — A wandering open path between two ends
- [shape/ring](#shapering) — Points evenly around a circle or an arc
- [shape/sphere-points](#shapesphere-points) — Points scattered uniformly on a sphere
- [shape/spiral](#shapespiral) — Points winding outward over a number of turns
- [transform/displace-by-noise](#transformdisplace-by-noise) — Push points up and down by a noise field
- [transform/relax-spacing](#transformrelax-spacing) — Even out spacing without deleting anything
- [transform/snap-to-grid](#transformsnap-to-grid) — Move every point to the nearest grid corner
- [write/color-from-attribute](#writecolor-from-attribute) — Turn a scalar attribute into a colour gradient
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

**Content hash:** `8a21d7c3d364ba8b`

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

**Content hash:** `79e8d25f2addd3bc`

**Tags:** `compose`, `copy`, `clusters`

**Inputs:** `source` (geometry), `target` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jitter` | vec3 | `[0.5,0,0.5]` |  |  | yes | jit.amount | Maximum random offset per axis, in world units — what makes copied clusters look placed rather than stamped. Set it to [0,0,0] for exact copies. |
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

Scatters a few cluster centres through a box, then copies a small local cloud onto each one, so points arrive in groups — villages, groves, boulder fields, star clusters. COUNT: the output is clusters x perCluster, which multiplies fast. VARIATION: yes — both scatters are context-seeded, so two instances differ, and `seed` re-rolls both explicitly. The local cloud's own `scale` is reset before copying, so `spread` sizes the cluster and not the assets in it.

**Content hash:** `bd7f170c0b451a4e`

**Tags:** `fill`, `scatter`, `clusters`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[100,0,100]` |  |  |  | centres.boundsMax | Maximum corner of the box the group centres can land in, in world units. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | centres.boundsMin | Minimum corner of the box the group centres can land in, in world units. |
| `clusters` | i32 | `24` | >= 0 |  |  | centres.count | How many groups to place. |
| `perCluster` | i32 | `12` | >= 0 |  |  | local.count | How many points each group holds. The output count is clusters x this. |
| `seed` | u32 | `0` |  |  |  | centres.seed, local.seed | Re-rolls both the group positions and the shape of the group. Two instances already differ without it. |
| `spread` | vec3 | `[4,4,4]` |  |  | yes | spread.scale | How far a group reaches from its centre, in world units. A bare number is not accepted: pass [4,4,4], or {"fn":"constant","value":4} for a round cluster. |

Run it: `pcg run fill/scatter-clustered`

## fill/scatter-even

**Scatter points with a guaranteed minimum spacing**

Scatters candidates through a box and then removes any that fall closer than a minimum distance, giving evenly spaced points with no visible clumping — for anything with physical extent: trees, rocks, buildings. COUNT: over-scatter deliberately. The output count is EMERGENT, capped by the area divided by minDistance squared, so raising `count` past that point adds nothing and the way to get more points is a smaller `minDistance`. The scan is a deterministic greedy pass in index order, not a Poisson-disc sample, so the count is not controllable and looping to hit a target count will not converge. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly.

**Content hash:** `f87469cb73593828`

**Tags:** `fill`, `scatter`, `spacing`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[50,0,50]` |  |  |  | scatter.boundsMax | Maximum corner of the box to fill, in world units. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | scatter.boundsMin | Minimum corner of the box to fill, in world units. |
| `count` | i32 | `4000` | >= 0 |  |  | scatter.count | Candidates scattered before pruning. Over-scatter: the survivors are however many fit at `minDistance`, never more. |
| `minDistance` | f32 | `2` | >= 0 |  |  | prune.minDistance | Closest two kept points may be, in world units. This is the real knob. |
| `seed` | u32 | `0` |  |  |  | scatter.seed | Re-rolls the scatter. Two instances already differ without it. |

Run it: `pcg run fill/scatter-even`

## fill/volume-by-noise

**Carve connected volumes out of a solid box**

Fills a box with a jittered grid of points and keeps only the cells where a 3D noise field rises above a threshold, carving connected volumes out of solid — caves, clouds, asteroid interiors, floating islands. COUNT: the grid is extent cubed over cellSize cubed, so this is the one primitive here that can blow up; halving `cellSize` costs eight times as many points before the threshold takes any away. Connect the `in` pin and the bounds come from that geometry's own extents instead of the params, which is the library's only 'adapt to whatever arrives' mechanism. VARIATION: the jitter varies per instance but the CARVE PATTERN does not, so two instances hollow out the same shape unless their `variant` differs.

**Content hash:** `41deaab7adaf34d8`

**Tags:** `fill`, `noise`, `volume`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `boundsMax` | vec3 | `[32,32,32]` |  |  |  | vol.boundsMax | Maximum corner of the box to fill. IGNORED when the `in` pin is connected. |
| `boundsMin` | vec3 | `[0,0,0]` |  |  |  | vol.boundsMin | Minimum corner of the box to fill. IGNORED when the `in` pin is connected. |
| `cellSize` | f32 | `2` |  |  |  | vol.cellSize | Grid resolution in world units. Halving it costs eight times as many candidate points. |
| `frequency` | f32 | `0.05` |  |  | yes | freqAttr.value | Feature size: smaller means larger, smoother caverns. |
| `jitter` | f32 | `0.5` | 0..1 |  | yes | vol.jitter | How far each point may wander inside its own cell: 0 is a hard lattice, 1 is fully irregular. |
| `seed` | u32 | `0` |  |  |  | vol.seed | Re-rolls the per-cell jitter. It does NOT move the carve pattern; `variant` does that. |
| `threshold` | f32 | `0.5` | 0..1 |  | yes | threshAttr.value | Where the cut falls on the 0..1 noise. Higher leaves less material. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position — the per-instance re-roll of the carve pattern. |

Run it: `pcg run fill/volume-by-noise`

## filter/by-distance-to

**Keep points by how far they are from another cloud**

Measures each point's distance to the nearest point of a second cloud and keeps or drops it by that distance — 'no trees within 20m of the road', or 'cabins only near the lake'. This is the only way to ask how far anything is from anything: transferring the nearest value copies it but never reveals the distance. A point that finds nothing (an empty `features` cloud) is at distance Infinity, so 'le' drops it and 'ge' keeps it. Fully deterministic. Reads `P` on both inputs; writes nothing (the distance column is removed again).

**Content hash:** `988d52b6ceb54ba4`

**Tags:** `filter`, `spatial`, `proximity`

**Inputs:** `in` (geometry), `features` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | 'ge' keeps what is far from the features (a clearance), 'le' keeps what is near them (a band). |
| `distance` | f32 | `5` | >= 0 |  |  | keep.value | The band edge, in world units. |

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
| `distance` | f32 | `5` | >= 0 |  |  | dist.distance | The band edge, in world units — how far from the curve the decision flips. |
| `resolution` | f32 | `1` | >= 0 |  |  | dense.spacing | How finely the curve is sampled before distances are measured, in world units. It is the accuracy of the measurement, so keep it well under `distance`; smaller costs one more sample point per step along every path. |

Run it: `pcg run filter/by-distance-to-curve`

## filter/by-neighbor-count

**Keep points by how crowded they are**

Counts each point's neighbours within a radius and keeps or drops it by that count — 'ge' removes lonely outliers and finds cluster cores, 'le' thins the dense middle out. Fully deterministic: it measures whatever arrives. Reads `P`; writes nothing (the count column is removed again).

**Content hash:** `ee36765e9ee4552b`

**Tags:** `filter`, `neighborhood`, `spatial`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `comparison` | enum | `"ge"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | 'ge' keeps the crowded points (cluster cores), 'le' keeps the isolated ones. |
| `count` | f32 | `2` | >= 0 |  |  | keep.value | How many neighbours the comparison is made against. The point itself is not counted. |
| `radius` | f32 | `5` | >= 0 |  |  | nbr.radius | How far around each point counts as its neighbourhood, in world units. |

Run it: `pcg run filter/by-neighbor-count`

## filter/inside-radius

**Keep the points within a radius of a centre**

Keeps the points whose distance to a centre satisfies a comparison — 'le' for a circular district, 'ge' for an exclusion zone around a landmark. The distance is the true 3D distance, not a squared one and not a planar one, which are the two ways a hand-written version goes wrong. Fully deterministic. Reads `P`; writes nothing (both scratch columns are removed again).

**Content hash:** `3281ccbb09ada442`

**Tags:** `filter`, `spatial`, `mask`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | f32 | `0` |  |  | yes | centerAttr.value | World position the distance is measured from. A plain number broadcasts to all three axes, so 0 is the origin; for anywhere else pass a field spec: {"fn":"constant","value":[x,y,z]}. |
| `comparison` | enum | `"le"` |  | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |  | keep.comparison | How the distance is tested: 'le' keeps what is inside the radius, 'ge' keeps what is outside it. |
| `radius` | f32 | `10` | >= 0 |  |  | keep.value | The distance the comparison is made against, in world units. |

Run it: `pcg run filter/inside-radius`

## filter/mask-by-noise

**Keep the points where a noise field is above a threshold**

Keeps only the points where a normalized noise field rises above a threshold — a HARD mask, giving connected regions with visible edges, the way a coastline separates land from sea. For a soft, gradual fade instead, use `filter/thin-by-density`. On normalized noise a threshold of 0.5 keeps roughly half the area, and higher keeps less. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances mask IDENTICALLY unless their `variant` differs. Reads `P`; writes nothing (every scratch column is removed again).

**Content hash:** `2883baa351726504`

**Tags:** `filter`, `noise`, `mask`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | freqAttr.value | Feature size: the noise sample position is multiplied by this, so smaller means larger regions. |
| `threshold` | f32 | `0.5` | 0..1 |  | yes | threshAttr.value | Where the cut falls on the 0..1 noise. 0.5 keeps about half; 1 keeps nothing and 0 keeps everything. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position — the per-instance re-roll. Two instances with the same value mask identically. |

Run it: `pcg run filter/mask-by-noise`

## filter/thin-by-density

**Thin a point cloud by a noise density**

Writes a normalized noise field into the standard `density` attribute and keeps each point with a probability equal to its density, so dense regions stay full and sparse ones fade out. The result is SOFT-EDGED: individual points thin out gradually, with no boundary. For hard-edged regions with a visible coastline, use `filter/mask-by-noise` instead. VARIATION: which points survive varies per instance (the draw is context-seeded), but the PATTERN does not — noise carries its own seed inside its field spec, where no exposed param can reach, so two instances thin the same blobs unless their `variant` differs. Writes `density`; reads `P`.

**Content hash:** `f933bd0bccb5b2e2`

**Tags:** `filter`, `noise`, `density`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | freqAttr.value | Feature size: the noise sample position is multiplied by this, so smaller means broader clumps. 0.02 gives clumps tens of world units across. |
| `seed` | u32 | `0` |  |  |  | thin.seed | Re-rolls which points survive within the same pattern. It does NOT move the pattern; `variant` does that. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position — the only way to give two instances different PATTERNS. Any two different values are unrelated; the same value always reproduces. |

Run it: `pcg run filter/thin-by-density`

## place/align-to-surface

**Stand each point up along the surface under it**

Casts a ray from every point onto a mesh, reads the surface `normal` where it lands, and turns the point so its chosen local axis stands along that normal — props lying on slopes instead of standing upright through them. PRECONDITION: the `surface` must carry a `normal` point attribute (f32, tuple 3); a mesh built by `meshPrimitive` carries uv and topology but no normal, so stamp one on it first. A point whose ray misses keeps the previous normal it had, and a zero-length one keeps its existing rotation. Fully deterministic. Writes `rot` and `normal`; `P` is not moved — pair it with `place/drop-to-surface` for that.

**Content hash:** `00b616e8d41bce55`

**Tags:** `place`, `surface`, `raycast`, `instancing`

**Inputs:** `points` (geometry), `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+y"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset stands along the surface normal. '+y' is upright. |
| `direction` | vec3 | `[0,-1,0]` |  |  |  | normal.direction | Which way the ray travels to find the surface. [0,-1,0] looks straight down. |
| `maxDistance` | f32 | `0` | >= 0 |  |  | normal.maxDistance | Longest ray that still counts as a find, in world units. 0 means unlimited. |
| `up` | vec3 | `[0,1,0]` |  |  |  | orient.up | Up hint fixing the roll around the normal. |

Run it: `pcg run place/align-to-surface`

## place/along-curve

**Space points along a curve and turn them to follow it**

Places points at even arc-length steps along every path of the supplied `curve` and turns each one to face the way the curve is going — fence posts, streetlights, bollards, sleepers. Each path is measured and resampled on its OWN length, so several paths in one input stay separate and each gets its own run of points; `splineSample` would treat them as one concatenated curve instead. PRECONDITION: `curve` must carry polyline topology — `shape/path-loop`, `shape/path-meander` or a `pointsToPath` node, never a bare point cloud, and never anything that has been through a filter (filters and `mergePoints` drop topology). The points are NEW: they carry `P`, the unit `tangent`, `curveU` (0..1 along their own path) and `rot`, plus the standard attributes at their defaults — nothing written on the curve's own points survives, which is what `write/orient-along-path` is for. The output is still a path, so it can be resampled again. Fully deterministic.

**Content hash:** `76f7ab52571ed822`

**Tags:** `place`, `curve`, `path`, `instancing`

**Inputs:** `curve` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset points along the curve. '+z' is the forward axis assets face by convention. |
| `count` | i32 | `24` | >= 2 |  |  | resample.count | Points per path in 'count' mode. At least 2 (3 on a closed path); ignored in 'spacing' mode. |
| `mode` | enum | `"count"` |  | `count`, `spacing` |  | resample.mode | 'count' puts exactly `count` points on each path whatever its length; 'spacing' steps every `spacing` world units, so longer paths get more points — the right one for evenly pitched props. |
| `spacing` | f32 | `1` | >= 0 |  |  | resample.spacing | Distance between points in world units in 'spacing' mode. Must be greater than 0 and short enough to leave 2 points on the shortest path; ignored in 'count' mode. |
| `up` | vec3 | `[0,1,0]` |  |  |  | orient.up | Up hint fixing the roll around the curve; leave it at world up for props that stand on the ground. |

Run it: `pcg run place/along-curve`

## place/drop-to-surface

**Drop points onto a mesh and discard the misses**

Casts a ray from every point along a direction, moves each one to where it hits the mesh, and DISCARDS the ones that hit nothing — which is what turns any flat scatter into a terrain-aware one. Two rays are cast, not one, and the second is the content: a miss keeps its prior value rather than reporting itself, so points that hit nothing would otherwise stay floating with no per-point way to find them. A marker stamped on the surface before the transfer comes back as 1 on a hit and 0 on a miss, which is what makes the discard possible at all. Fully deterministic. Reads and writes `P`; the marker column is removed again.

**Content hash:** `ddc00f2881334737`

**Tags:** `place`, `surface`, `raycast`, `terrain`

**Inputs:** `points` (geometry), `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `direction` | vec3 | `[0,-1,0]` |  |  |  | hit.direction, snap.direction | Which way the rays travel. [0,-1,0] drops straight down; rays are forward-only, so points below the surface miss. |
| `maxDistance` | f32 | `0` | >= 0 |  |  | hit.maxDistance, snap.maxDistance | Longest drop that still counts as a landing, in world units. 0 means unlimited. |

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

**Content hash:** `dd94c5b8741967f1`

**Tags:** `place`, `surface`, `terrain`, `vegetation`

**Inputs:** `surface` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `count` | i32 | `1000` | >= 0 |  |  | pts.count | Candidates placed on the mesh before the slope and height tests. |
| `density` | f32 | `1` | 0..1 |  | yes | pts.density | Acceptance probability per candidate, 0..1. Pass a field spec to make it vary across the surface. |
| `maxHeight` | f32 | `60` |  |  |  | height.value | Highest world Y still plantable — a tree line. |
| `maxSlope` | f32 | `0.3` |  |  |  | slope.value | Steepest ground still plantable, on the 0..1 slope scale (0 is flat, 1 is a vertical wall). |
| `seed` | u32 | `0` |  |  |  | pts.seed | Re-rolls the sampling. Two instances already differ without it. |

Run it: `pcg run place/plantable`

## shape/disc

**Points scattered uniformly inside a circle**

Scatters points uniformly inside a disc in the XZ plane by scattering a square and rejecting the corners — the circular counterpart to scattering a box, and the right answer when scattering a square and hoping is wrong. COUNT: `count` is the number of CANDIDATES; the disc keeps about 78.5% of them, so asking for 1000 gives roughly 785 points. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.

**Content hash:** `80a61364563e287a`

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

Builds a CLOSED PATH — polyline topology, not a loose point cloud — around a circle in the XZ plane, then sizes, rotates and moves it. This is the curve source a saved graph reaches for: feed it to `place/along-curve`, `filter/by-distance-to-curve`, `write/orient-along-path` or the `splineSample` / `pathResample` nodes, which all report finding no polylines when handed a point cloud. COUNT: `count` is the number of corner points and exactly the number of points emitted; closure is structural (a trailing vertex back to the first point), so there is no duplicated seam point to trip over. Built on `shape/ring`, so the points also carry `scale` at 1. Fully deterministic. TOPOLOGY IS FRAGILE: every filter node and `mergePoints` drop it, so anything that must see a path has to come before the first filter.

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

Builds an open PATH — polyline topology — that runs along X and wanders off the straight line by a noise field, then evens the spacing out again by arc length. The resampling is the content: displacing a polyline sideways stretches the segments where the wander is steep, so points placed along it afterwards would bunch on the straight parts, and the fix cannot be seen in a picture until something is spawned on it. Use it for a road, a river, a fence line or a trail. COUNT: `count` is both the number of corners the wander is built from and the number of points emitted, evenly spaced along the finished curve. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances wander IDENTICALLY unless their `variant` differs. Writes `P`, the unit `tangent` and `curveU` (0..1 along the path) on points the resample creates, so none of the recipe's own working columns reach the output and the per-point `scale` is 1. TOPOLOGY IS FRAGILE: every filter node and `mergePoints` drop it, so a path that must stay a path has to reach its consumer before the first filter.

**Content hash:** `997b64b03a959e47`

**Tags:** `shape`, `curve`, `path`, `noise`

**Inputs:** *(none)*

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `center` | vec3 | `[0,0,0]` |  |  | yes | place.translate | Where the shape sits, in world units. |
| `count` | i32 | `33` | >= 2 |  |  | line.count, even.count | Points along the path, and the number of corners the wander is drawn from. A dozen or more before the wander reads as a curve rather than a zig-zag. |
| `frequency` | f32 | `3` |  |  | yes | freqAttr.value | How many bends over the length of the path, roughly: the noise sample position is multiplied by this, so smaller means longer, lazier curves. |
| `rotate` | vec3 | `[0,0,0]` |  |  | yes | place.rotateEuler | Rotation in degrees per world axis, applied about the origin before the shape is moved into place. |
| `size` | vec3 | `[40,1,40]` |  |  | yes | place.scale | Extent in world units: X is the end-to-end length, Z scales the wander. A bare number is not accepted here: pass three numbers [40,1,40], or {"fn":"constant","value":40}. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field. |
| `wander` | f32 | `0.15` |  |  | yes | ampAttr.value | How far the path strays from the straight line between its ends. 0 is a straight line; above that the peak deviation is about 0.22 * wander * `size.z`, exactly linear in both — so at the default `size` [40,1,40], 0.15 strays about 1.3 units to each side and 0.5 about 4.4. Inverted, for a peak of a fraction f of `size.z`, ask for wander around 4.6 * f. This is a FRACTION OF A NOMINAL RANGE, not of the deviation you get: the value scales a noise term whose range is +/-1 in principle, but four octaves of normalized fBm sampled along one line only cover part of it, and `frequency` and `variant` move that coverage (measured 0.13 to 0.31 of wander * `size.z` across the usable range). The wander is sideways only — the path is a height field along X, so it NEVER doubles back on itself at any wander; for a curve that turns back, build the corners yourself and run `pointsToPath` over them. |

Run it: `pcg run shape/path-meander`

## shape/ring

**Points evenly around a circle or an arc**

Places points evenly around a circle in the XZ plane, optionally sweeping only part of the way round, then sizes, rotates and moves the result. COUNT: `count` is exactly the number of points emitted, whatever `sweep` and `includeEnd` are. The seam is handled by `includeEnd`, not by deleting a point: left false (the default) the samples divide the sweep and the last one stops one step short, which is what a full circle needs — the end of a full sweep IS its start. Set it true for an arc that must touch both ends. Emits a loose point CLOUD, not a path: for polyline topology use `shape/path-loop`, which is this primitive plus the closure. Fully deterministic: two instances with the same params are identical, which is what a ring should be. Writes `P`; leaves the per-point `scale` attribute at 1 so the ring's size does not become the asset's size.

**Content hash:** `ac1cddafb1a1492b`

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
| `sweep` | f32 | `1` | 0..1 |  | yes | sweepAttr.value | How far round to go: 1 is a closed circle, 0.5 a half-circle, 0.25 a quarter arc. |

Run it: `pcg run shape/ring`

## shape/sphere-points

**Points scattered uniformly on a sphere**

Scatters points uniformly over the surface of a sphere, by rejecting a cube scatter down to the ball first and then pushing every survivor out to the surface. The rejection step is the content: normalizing a cube scatter directly piles points up toward the eight corner directions, and the result looks wrong without looking obviously wrong. COUNT: `count` is the number of CANDIDATES; the ball keeps about 52.4% of them. VARIATION: yes — two instances in one graph scatter differently, and `seed` re-rolls one explicitly. Writes `P`; leaves the per-point `scale` attribute at 1.

**Content hash:** `bfae98c5249b3ebd`

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

**Content hash:** `62e4436dd187375e`

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
| `turns` | f32 | `3` | >= 0 |  | yes | turnsAttr.value | How many full revolutions the spiral makes between the centre and the outer radius. |

Run it: `pcg run shape/spiral`

## transform/displace-by-noise

**Push points up and down by a noise field**

Displaces every point along +Y by a noise field centred on zero, so a flat scatter becomes a rolling one. The displacement runs from -amount to +amount, so the average height does not move. LIMITATION: +Y only — the direction lives inside the field structure, not in a param slot, so displacing along another axis means rotating the whole result. VARIATION: none by default — noise carries its own seed inside its field spec, so two instances displace IDENTICALLY unless their `variant` differs, and this is the primitive most likely to be used twice in one graph. Reads and writes `P`; leaves every other attribute alone.

**Content hash:** `f81df283558901c3`

**Tags:** `transform`, `noise`, `terrain`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `amount` | f32 | `4` |  |  | yes | ampAttr.value | Peak displacement in world units: points move between -amount and +amount. |
| `frequency` | f32 | `0.05` |  |  | yes | freqAttr.value | Feature size: the noise sample position is multiplied by this, so smaller means longer, gentler waves. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position — the per-instance re-roll, and the ONLY one: no seed can move a noise field. |

Run it: `pcg run transform/displace-by-noise`

## transform/relax-spacing

**Even out spacing without deleting anything**

Nudges every point away from the centroid of its neighbours, so crowded regions spread out and the spacing evens up while the COUNT stays exactly the same. This is the alternative to `selfPrune`, which enforces spacing by deleting: use this one when the count is fixed (a fleet, a crowd, a fixed budget of props). A strength near 0.5 is one relaxation step; run the primitive twice for a stronger effect rather than pushing the strength past 1, which overshoots and oscillates. Isolated points do not move. Fully deterministic. Reads and writes `P`; leaves every other attribute alone.

**Content hash:** `00d0b320600b2385`

**Tags:** `transform`, `neighborhood`, `spacing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `radius` | f32 | `4` | >= 0 |  |  | nbr.radius | How far around each point counts as its neighbourhood, in world units. Points with nothing inside it do not move. |
| `strength` | f32 | `0.5` |  |  | yes | strAttr.value | How far along the push each point travels: 0 changes nothing, 0.5 is one relaxation step. |

Run it: `pcg run transform/relax-spacing`

## transform/snap-to-grid

**Move every point to the nearest grid corner**

Snaps every point to the nearest corner of a regular 3D grid of the given pitch, so scattered positions become tile-aligned. Note that snapping can land two points on the SAME corner: follow it with `selfPrune` at a distance just under the pitch if the duplicates matter. Fully deterministic. Reads and writes `P`; leaves every other attribute alone, including `scale`.

**Content hash:** `399afbaa1ca4eb39`

**Tags:** `transform`, `grid`, `align`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cellSize` | f32 | `4` |  |  | yes | cellAttr.value | Grid pitch in world units, the same on all three axes. Must be greater than 0. |

Run it: `pcg run transform/snap-to-grid`

## write/color-from-attribute

**Turn a scalar attribute into a colour gradient**

Rescales any numeric point attribute to 0..1 over its OWN observed range, then maps it through a blue-green-yellow-red heat ramp into the standard `color` attribute (f32, tuple 4, alpha 1). Fitting to the observed range is what makes it work on an invented quantity — a neighbour count, a hand-built score — without knowing its scale in advance. Fully deterministic: two instances produce identical output. Writes `color`; reads the attribute named by `source`, which must exist on the point domain.

**Content hash:** `fc1cc477358f2ace`

**Tags:** `write`, `color`, `debug`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `source` | string | `"density"` |  |  |  | fit.name | Numeric point attribute to colour by. It is fitted to its own minimum and maximum, so any scale works — 'density', 'height', 'slope' or anything you computed yourself. |

Run it: `pcg run write/color-from-attribute`

## write/density-from-noise

**Write the standard density attribute from a noise field**

Writes `density` (f32, 0..1) from four octaves of normalized Perlin fBm — the exact input `filterByDensity` and the density-aware samplers expect, separated from applying it so one pattern can drive a thin, a colour and a scale. VARIATION: noise does not vary per instance. Two instances of this primitive with the same params write the IDENTICAL pattern, and no seed can change that — a noise field carries its own seed inside its spec, where no exposed param can reach. Pass a different `variant` to move the sample position to an unrelated part of the field, which is the per-instance re-roll. Writes `density`; reads nothing.

**Content hash:** `f6463069f49e3917`

**Tags:** `write`, `noise`, `density`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `frequency` | f32 | `0.02` |  |  | yes | freqAttr.value | Feature size: the noise sample position is multiplied by this, so smaller means broader blobs. 0.02 gives features tens of world units across. |
| `variant` | f32 | `0` |  |  | yes | variantAttr.value | Offset added to the noise sample position. This is the per-instance re-roll: any two different values give unrelated patterns, and the same value always reproduces. There is no seed that can do this. |

Run it: `pcg run write/density-from-noise`

## write/height-slope

**Stamp height and slope from a surface normal**

Writes the two standard terrain quantities onto points that already carry a surface normal: `height` (f32) is the world Y of each point, and `slope` (f32) is 1 - normal.y, so 0 is dead flat and 1 is a vertical wall. Downstream filters can then test ground suitability without re-deriving either. PRECONDITION: the input must carry a `normal` point attribute (f32, tuple 3) — `surfaceSample` writes one, and `place/align-to-surface` transfers one from a mesh; without it the cook fails naming the missing attribute. Fully deterministic: two instances of this primitive produce identical output.

**Content hash:** `06e0b90b4acc0e56`

**Tags:** `write`, `terrain`, `attributes`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:** *(none)*

Run it: `pcg run write/height-slope`

## write/instances-by-species

**Pick one asset per point and emit the instances**

Chooses an asset id per point from a list and emits the instance batches — the multi-asset spawn. The point of the primitive is the string coupling: one param names BOTH the attribute the choice is written to and the attribute the spawner reads it back from, so the two can never drift apart. The built-in selector spreads uniformly over FOUR entries, so pass exactly four assets and repeat one to weight it (['pine','pine','birch','bush'] is 50/25/25). VARIATION: yes — the choice comes from the evaluation context, so two instances differ automatically, and `seed` re-rolls one explicitly. Writes the species attribute; reads `P`, `rot` and `scale` through the spawner.

**Content hash:** `0fad13f078670f88`

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
| `radius` | f32 | `5` | >= 0 |  |  | nbr.radius | How far around each point counts as its neighbourhood, in world units. |

Run it: `pcg run write/local-density`

## write/orient-along-path

**Turn a path's own points to follow the path**

Writes a unit `tangent` along the polyline at every point of a path, then sets `rot` so each point faces that way — the points, their attributes and the topology all arrive and leave untouched. That is the whole difference from `place/along-curve`, which resamples: use this one when the points already mean something (a species, a scale, a colour, a point index other geometry refers to) and must survive being oriented. It is also the only way to orient the points of a path that was hand-built with `pointsToPath`, since a tangent otherwise exists only on points a sampler created. The tangent is the normalized central difference between each point's neighbours along the path, so it stays smooth through corners, and it wraps on a closed path. PRECONDITION: the input must carry polyline topology; a point on no polyline gets a zero tangent and deliberately keeps the `rot` it had. Run it BEFORE any filter — every filter node and `mergePoints` drop topology, and this node would then find no paths. Fully deterministic. Writes `tangent` and `rot`; `P` and the count are untouched.

**Content hash:** `ca79e90912aad86a`

**Tags:** `write`, `curve`, `path`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `axis` | enum | `"+z"` |  | `+x`, `-x`, `+y`, `-y`, `+z`, `-z` |  | orient.axis | Which local axis of the asset points along the path. '+z' is the forward axis assets face by convention. |
| `up` | vec3 | `[0,1,0]` |  |  |  | orient.up | Up hint fixing the roll around the path; leave it at world up for props that stand on the ground. |

Run it: `pcg run write/orient-along-path`

## write/random-scale

**Write one uniform random size per point**

Writes the standard `scale` attribute (f32, tuple 3) as ONE random size per point between min and max, the same value on all three axes. The uniformity is the content: a hand-written version reaches for a separate random per axis and gets an asset stretched differently in x, y and z, which reads as a modelling error rather than as variety. VARIATION: yes — the draw comes from the evaluation context, so two instances in one graph differ automatically, and `seed` re-rolls one of them explicitly. Writes `scale`; reads nothing.

**Content hash:** `fa8ac17842b0c258`

**Tags:** `write`, `scatter`, `instancing`

**Inputs:** `in` (geometry)

**Outputs:** `out` (geometry)

**Params:**

| Param | Type | Default | Range | Enum | Field | Writes to | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `max` | f32 | `1.4` |  |  | yes | maxAttr.value | Largest size a point can get, as a multiple of the asset's own size. |
| `min` | f32 | `0.7` |  |  | yes | minAttr.value | Smallest size a point can get, as a multiple of the asset's own size. |
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
| `up` | vec3 | `[0,1,0]` |  |  |  | yaw.up | Up hint fixing the roll; leave it at world up unless the assets stand along another axis. |

Run it: `pcg run write/random-yaw`
