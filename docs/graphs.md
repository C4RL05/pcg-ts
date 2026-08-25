# Example corpus

Generated from the graphs in [`graphs`](../graphs) by `node scripts/gen-graphs.mjs` — do not edit by hand. The same index, machine-readable, is in [graphs.json](./graphs.json). For the graph JSON format see [authoring.md](./authoring.md); for the node types these graphs use, [nodes.md](./nodes.md); for the primitives they reference, [primitives.md](./primitives.md).

Each file teaches ONE thing and cooks from JSON alone — no runtime-injected data, so `pcg cook <file>` on a clean install reproduces exactly what the corpus test asserts.

77 examples, alphabetical by file:

- [basics-attribute-from-noise.json](#basics-attribute-from-noisejson) — write an attribute from a noise field
- [basics-attribute-remap.json](#basics-attribute-remapjson) — rescale an attribute to a new range
- [basics-compose-primitives.json](#basics-compose-primitivesjson) — compose several primitives into a scatter
- [basics-connect-by-reach.json](#basics-connect-by-reachjson) — connect a cloud by each point's own reach
- [basics-copy-to-points.json](#basics-copy-to-pointsjson) — give every copy the attributes of the point it landed on
- [basics-curve-shaping.json](#basics-curve-shapingjson) — a mask, a decay and a compression
- [basics-density-along-a-path.json](#basics-density-along-a-pathjson) — place an exact number of points along a path, bunched where a density says
- [basics-even-spacing.json](#basics-even-spacingjson) — enforce a minimum distance between points
- [basics-extrude-polygon.json](#basics-extrude-polygonjson) — turn a footprint into massing
- [basics-field-params.json](#basics-field-paramsjson) — read a field's shaping numbers from a knob
- [basics-field-shaping.json](#basics-field-shapingjson) — shape one falloff six ways
- [basics-filter-by-attribute.json](#basics-filter-by-attributejson) — keep points by an attribute comparison
- [basics-filter-by-density.json](#basics-filter-by-densityjson) — thin a cloud by the density attribute
- [basics-filter-by-expression.json](#basics-filter-by-expressionjson) — keep points with a predicate expression
- [basics-filter-primitives-by-attribute.json](#basics-filter-primitives-by-attributejson) — keep whole primitives by an attribute comparison
- [basics-fit-runs.json](#basics-fit-runsjson) — fit a line through each row of props, and catch the row that only looks straight
- [basics-flatten-and-remember.json](#basics-flatten-and-rememberjson) — flatten a cloud onto a plane and keep the height it lost
- [basics-foreach-per-group.json](#basics-foreach-per-groupjson) — treat each group on its own
- [basics-gather-by-index.json](#basics-gather-by-indexjson) — two hundred props each pick one of five kinds, by drawing its number
- [basics-gather-on-path.json](#basics-gather-on-pathjson) — gather evenly spaced points into clumps along a curve
- [basics-inline-field-params.json](#basics-inline-field-paramsjson) — put a field's shaping numbers on knobs without a wrapper
- [basics-jitter-points.json](#basics-jitter-pointsjson) — break up a lattice with deterministic jitter
- [basics-mask-by-species.json](#basics-mask-by-speciesjson) — let a string attribute drive a field
- [basics-merge-points.json](#basics-merge-pointsjson) — concatenate two clouds into one
- [basics-merge-primitives.json](#basics-merge-primitivesjson) — join an authored path to a generated network
- [basics-mesh-primitive.json](#basics-mesh-primitivejson) — build a mesh a saved graph can cook
- [basics-neighborhood-count.json](#basics-neighborhood-countjson) — measure how crowded each point is
- [basics-neighborhood-varying-radius.json](#basics-neighborhood-varying-radiusjson) — measure a neighbourhood at each point's own scale
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
- [basics-repeat-until-settled.json](#basics-repeat-until-settledjson) — run a body until it settles
- [basics-report-to-the-host.json](#basics-report-to-the-hostjson) — what a graph hands back that is not geometry
- [basics-reseed-a-noise.json](#basics-reseed-a-noisejson) — make a saved noise re-roll with the graph seed
- [basics-runs-along-a-path.json](#basics-runs-along-a-pathjson) — measure distance since the last gate, and to the next one, around a closed lap
- [basics-scatter-along-a-path.json](#basics-scatter-along-a-pathjson) — scatter a lap with as many markers as its own length asks for
- [basics-scatter-in-bounds.json](#basics-scatter-in-boundsjson) — scatter points in a box
- [basics-scatter-in-world.json](#basics-scatter-in-worldjson) — scatter points anchored to the world, not to the box
- [basics-shift-along-a-path.json](#basics-shift-along-a-pathjson) — draw the chain between scattered beads, from nothing but each one's successor
- [basics-sightline-cull.json](#basics-sightline-culljson) — clear a line of sight by moving the props, not by deleting them
- [basics-signed-distance.json](#basics-signed-distancejson) — a signed distance field, and which side of it
- [basics-spawn-by-species.json](#basics-spawn-by-speciesjson) — spawn a different asset per point
- [basics-spawn-instances.json](#basics-spawn-instancesjson) — turn points into instance batches
- [basics-stations-on-a-path.json](#basics-stations-on-a-pathjson) — read a lap's own frame and width at thirty arbitrary stations, and place markers there
- [basics-subgraph-exposed-params.json](#basics-subgraph-exposed-paramsjson) — wrap a graph as one node with its own knobs
- [basics-surface-sample.json](#basics-surface-samplejson) — scatter points over a mesh surface
- [basics-sweep-profile.json](#basics-sweep-profilejson) — put a real surface on a curve
- [basics-tile-an-arc.json](#basics-tile-an-arcjson) — tile a repeated piece over three stretches of one lap, choosing the piece once per stretch
- [basics-tiling-a-field.json](#basics-tiling-a-fieldjson) — tile a field across the origin
- [basics-transfer-attribute.json](#basics-transfer-attributejson) — read a value off a surface below each point
- [basics-transform-points.json](#basics-transform-pointsjson) — move, turn and size a whole cloud
- [basics-two-kinds-of-bounds.json](#basics-two-kinds-of-boundsjson) — two things called bounds, and they are not the same thing
- [basics-under-cover.json](#basics-under-coverjson) — measure what runs under cover, where the route passes close to itself
- [basics-volume-scatter.json](#basics-volume-scatterjson) — fill a box with points, then carve it
- [examples-forest.json](#examples-forestjson) — plant a hillside, thinned by slope and treeline
- [examples-gpu-fields.json](#examples-gpu-fieldsjson) — a fusable chain, on the CPU or the device
- [examples-headless-scatter.json](#examples-headless-scatterjson) — headless scatter
- [examples-rig.json](#examples-rigjson) — a suspended rig, built from curves
- [examples-riverbank.json](#examples-riverbankjson) — Riverbank
- [examples-streamed-terrain.json](#examples-streamed-terrainjson) — one cell of a streamed world, halo and all
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

A field-capable param takes a field expression instead of a constant: `setAttribute`'s `value` here is four octaves of Perlin fBm, resolved once per point and stored into a new `height` attribute. `normalized: true` maps the noise's own raw range onto [0, 1], so no remap wrapper is needed. Noise carries its own `seed` inside the spec, so a literal there is a number the graph seed cannot reach; what makes this one answer the seed box is `"seed": { "from": "node", "variant": 0 }`, which derives the noise's seed from the cooking node's own and which `basics-reseed-a-noise` explains in full.

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

## basics-connect-by-reach.json

**connect a cloud by each point's own reach**

`connectPoints`' `radius` as a FIELD: every point carries its own `reach`, written here as 1.8 plus the SQUARE of three octaves of Perlin fBm, so the reach spans 1.8 to 8.2 against a median nearest-neighbour distance of 1.7, and the network that comes out is a web of mean degree six with starbursts where the reach spikes — the busiest point carries twenty-five edges, and exactly one point of the 220 reaches past 8 at all. Squaring the noise is what makes the pair rule VISIBLE rather than merely true: the long spokes exist only because the big end asked for them, and the small point at the far end of one could never have reached back. THE RULE OF THE PAIR IS max(rA, rB): a pair becomes an edge when it is closer than the LARGER of the two reaches, which is what keeps the relation symmetric. Neither alternative agrees with the same number passed plainly — the SMALLER would let a big point be crowded by a small one, and the SUM would double the spacing of an evenly-sized cloud — and without a stated rule 'A is near B' and 'B is near A' become two different tests, so an edge would depend on which endpoint asked. It is the same rule `selfPrune.minDistance` has always used. `color` is written from the same expression as a BRIGHTNESS rather than a hue, purely so the picture shows the reach its edges were drawn from: the viewer reads a point-domain `color` onto the line vertices and multiplies it into its own material tint, so a monochrome ramp survives that multiply where a hue would be swallowed by it. Per-point `scale` would say nothing here — it is read for instance transforms, never for a bare cloud or a network. TWO COSTS travel with a field here and neither is a correctness risk. The candidate scan runs at the WIDEST reach in the cloud, since either endpoint may be the larger, so the edge ceiling is measured on candidates rather than on the edges that survive. And under a partitioned cook the halo is no longer `radius` but the GLOBAL MAXIMUM the field can return ANYWHERE in the world — a bound to be DERIVED and not measured, because the cloud a cell sees has already been clipped by the halo being sized. Derive it from the expression: a `clamp` states the bound outright — `1.8 + 7 * u^2` with `u` clamped to [0, 1] maxes at 8.8 and cannot exceed it, which is why the remap here ends in one. Without the clamp the bound would have to come from the noise's own documented range instead, and a normalized fBm only actually spans about two fifths of its nominal [0, 1] — derive the halo from the nominal range and it is safe but loose; measure it from a cook and it is tight and wrong. The derived bound is the number to widen a cell by. Underestimating does not throw; it drops the long edges at the seams only. A non-finite reach is REFUSED here, naming the offending element, where `pointNeighborhood`'s radius reads NaN and Infinity as documented values — the distinction is which mistake is likelier, and a reach is arithmetic an author writes, so a NaN there is a broken expression rather than a request for no edges. `degreeAttr` is what makes the hubs readable downstream: filter on it to find the dead ends, or promote it to size a junction.

**Tags:** `basics`, `topology`, `fields`, `network`, `halo`

**Seed:** 1052

**Node types:** `connectPoints`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `network` (from `net`.`out`)

Cook it: `pcg cook graphs/basics-connect-by-reach.json --stats`

## basics-copy-to-points.json

**give every copy the attributes of the point it landed on**

`copyToPoints` stamps the whole `source` cloud onto every `target` point and composes the transforms per copy — P, rot and scale fold the target's frame into the source's, and each copied seed is hashCombine(sourceSeed, targetSeed) so the copies of one clump stay distinguishable. What the copies do NOT get by default is any idea of WHICH target they landed on, which makes them identical in everything but placement. `targetNames` is the fix: each named target point attribute arrives as a column on the copies, with the target's type, tuple size and default, and every copy in a target's block holds that target's value. Here the clump of nine props is a bare `pointGrid` around the origin, and the two things that vary between clumps — `species` and `vigour` — are computed once per plot and carried. `species` is the case nothing else reaches: it is a STRING, so `spawnInstances`' `assetAttr` can split the copies into one batch per asset id, and no amount of transform composition can decide an asset id. `vigour` is the case that shows why a carried value beats a composed one — the `scale` written after the copy multiplies the plot's vigour by a per-copy `randomField`, so a clump's props agree on how well the plot is doing and still differ from each other. The transform attributes are refused by name rather than resolved silently: carrying the target's `P` would put all nine props on top of the plot and the cook would stay clean, so `targetNames` rejects P, rot, scale and seed, and rejects a name the source already carries instead of letting statement order decide the winner.

**Tags:** `basics`, `copy`, `instancing`, `attributes`

**Seed:** 1051

**Node types:** `copyToPoints`, `pointGrid`, `pointScatterInBounds`, `setAttribute`, `spawnInstances`

**Primitives:** *(none)*

**Outputs:** `points` (from `size`.`out`), `instances` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-copy-to-points.json --stats`

## basics-curve-shaping.json

**a mask, a decay and a compression**

THREE CURVES, THREE DIFFERENT JOBS — not three ways of doing one, which is what makes this the companion to `basics-field-shaping` rather than a repeat of it. Each panel reads the same input, the distance from its own centre, and each answers a question the other two answer badly. LEFT, `smoothstep(2, 8, d)` inverted: a MASK with stated ends. It is flat at 1 out to d = 2, flat at 0 beyond d = 8, and smooth in between — and the flatness at BOTH ends is the whole point, because that is what a linear falloff cannot give you. A `lerp` mask creases visibly where it starts and stops; this one does not, which is why it is the shape to reach for when a region has to fade out without announcing its own boundary. The expansion is emitted rather than the WGSL builtin, whose result is undefined when the edges cross, and a zero span is guarded into the step the curve approaches instead of a division by zero. `ramp` remains the choice when the knees belong anywhere other than the ends; `smoothstep` is the two-edge case worth a name. MIDDLE, `6 * exp(-0.45 * d)`: DECAY, and the one curve here that never reaches zero. Every 1.54 units it halves — that is `log(2) / 0.45`, which is the number to reason with rather than the exponent — so across this panel it is small everywhere and zero nowhere, and a threshold rather than the curve is what ends it. Push it far enough and f32 does end it: `exp` underflows to exactly 0 below about -103.9, which is the format's floor and not the curve's. This is the honest shape for anything physical that falls off: light, heat, density away from a source. RIGHT, `2.4 * log(1 + d)`: COMPRESSION, and the only one that rises. It grows without bound and ever more slowly, which is what turns a quantity spanning orders of magnitude into one a height or a colour can show. The `1 +` is insurance rather than a fix for something this cook hits: `log(0)` is -Infinity, and no grid point here lands exactly on the centre — the nearest sits 0.283 away — so the offset is what makes the panel safe to re-spacing rather than what rescues it now. For a base other than e, divide — `div(log(x), log(2))` — since the grammar carries the natural logarithm only. `exp` AND `log` ARE BUDGETED rather than exact on the GPU — with `distance`, which carries 1 ULP, they are the three of the seven additions that are: the device has its own transcendentals and the CPU has the host's, and they are simply not the same function. `smoothstep` is bit-exact, which was not a given for a five-operation interior — it holds only because the CPU rounds each of those operations to f32 in the order the kernel does. `distance` supplies the input to all three, and is exactly `length(sub(a, b))` by construction.

**Tags:** `basics`, `fields`, `remap`, `composition`

**Seed:** 1057

**Node types:** `mergePoints`, `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `chart`.`out`)

Cook it: `pcg cook graphs/basics-curve-shaping.json --stats`

## basics-density-along-a-path.json

**place an exact number of points along a path, bunched where a density says**

Scattering in proportion to a density usually means rejection sampling: draw a candidate, keep it with probability density, and accept whatever count comes out. The count is then binomial — ask for ninety and get eighty-one this cook and ninety-six the next — which is fine for grass and useless for anything an author counts. `pathScan` buys the other trade: it writes the RUNNING TOTAL of a point attribute along each polyline in the path's own walk order, and a running total of a density is a cumulative distribution. Sample the inverse of that at ninety places and you get ninety points, every one of them placed in proportion to the density, with no draw to be unlucky in. This is the operation a field structurally cannot express at any length: a field resolves each element from that element alone, so 'how much density lies BEHIND me along this curve' has no formulation in the grammar — which is why it is a node.

The pieces, in the order they appear. `density` is any expression of `curveU`, here one hump per lap, and it is FLOORED at 0.02 rather than allowed to reach zero: across a dead stretch the distribution is flat, the inverse is ambiguous, and the nearest-point lookup below picks arbitrarily within it. `mode: "exclusive"` starts the first sample at zero — that is the mode that makes the first bucket reachable, since an inclusive scan gives the first sample its own whole value and nothing can land below it. `totalAttr` reports each path's whole total to the PRIMITIVE domain, `promoteAttribute` brings it back to the points, and dividing gives a cdf in [0, 1). Both ends matter and neither is more correct: exclusive is exact at the start, inclusive at the end.

The lookup is the part with no primitive behind it. Finding the sample whose cdf bucket contains a given u is a scalar-keyed search, and the library has no node for one, so the cdf is laid out AS GEOMETRY: each sample is re-embedded at (cdf, 0, 0) — `onCurve` saves its real position first — and `sampleNearestPoint` answers the question with a spatial query. Read the approximation honestly: nearest-in-cdf is not the containing bucket, it is the nearer of the two bucket edges, so a point can sit up to half a bucket off — a tenth of a percent of the lap at the 480 samples used here, and invisible. THE SAMPLE COUNT IS NOT FREE, though, and the rule is worth carrying: a sample's cdf bucket is as wide as its share of the total, so the widest one must stay NARROWER than the anchor spacing 1 / count, or two anchors fall in one bucket and land two points on the same spot. This graph at 240 samples did exactly that — peak bucket 0.0128 against a spacing of 0.0111, four coincident pairs out of ninety — and a graph teaching an exact count has no business emitting a doubled point. Halving the bucket fixed it. Denser density humps need more samples, and the check is arithmetic, not taste. The anchors themselves come from `pointLine` between [0,0,0] and [1,0,0] with `includeEnd` false, which is a stratified sample of the half-open range and needs no random number at all: point i sits at exactly i / count. A golden-ratio or uniform-random u substitutes here unchanged — the machinery downstream does not care where u came from.

**Tags:** `basics`, `path`, `density`, `sampling`, `scan`

**Seed:** 1059

**Node types:** `pathResample`, `pathScan`, `pointLine`, `pointsToPath`, `promoteAttribute`, `sampleNearestPoint`, `setAttribute`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `points` (from `land`.`out`), `path` (from `keepP`.`out`)

Cook it: `pcg cook graphs/basics-density-along-a-path.json --stats`

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

A field expression can read a named value instead of baking one: `{ "fn": "param", "name": "amplitude" }` inside the body's `translate` spec takes whatever the wrapping node's `amplitude` knob holds, so the two numbers that shape this surface are knobs rather than literals a caller would have to edit the graph to move. Every exposed param binds its name into its body's field scope, which is why both declarations here list no `targets` at all — neither writes into an inner param slot, so their type comes from the shape of `default` (a number is f32, a 3-number array vec3, a 4-number array vec4). The value is SUBSTITUTED before the field is built, so what cooks is exactly the field the literal would have built, cache key included: turning the knob invalidates precisely what editing the number would have. `frequency` multiplies the sample position rather than sitting in `opts.frequency`, because that option is read as a plain number and cannot hold a spec — folding the scale into the position is the same move every noise-bearing primitive makes.

**Tags:** `basics`, `fields`, `subgraph`, `params`

**Seed:** 1044

**Node types:** `pointGrid`, `subgraph`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `dunes`.`out`)

Cook it: `pcg cook graphs/basics-field-params.json --stats`

## basics-field-shaping.json

**shape one falloff six ways**

SIX SHAPING FUNCTIONS ON ONE INPUT. Every panel is the same grid and the same scalar `t` — 1 at the panel's centre, falling to 0 at its rim, written `1 - clamp(distance(P, centre) / 6, 0, 1)` — lifted by `6 * f(t)` and differing only in `f`. The six sit in two rows of three, named by coordinate rather than by which one faces you, since that depends on where the camera is: at z = -10, in increasing x, `t` itself (a cone, the control), `sqrt(t)` (a dome, steep at the rim) and `t * t` (a rounded spire); at z = +10, `pow(t, 3)` (a sharper spire), `ramp(t)` through four stops (the S-curve, flat at both ends) and `step(0.5, t)` (a flat-topped mesa — a hard cut, not a curve, and the only panel here that leaves the plane it started on). Read across and the choice of `f` is the whole difference between a cone and a mesa, which is what makes a falloff an authored decision rather than whatever the arithmetic happened to give. THREE RULES ARE VISIBLE HERE RATHER THAN STATED. `step` takes its EDGE FIRST — `step(edge, x)` is exactly `ge(x, edge)` with the operands swapped, and it exists to buy the name a shader author reaches for; getting the order backwards gives the complement, silently. `pow` HAS A NARROWER DOMAIN than a host-language power: every negative base is NaN, as are `pow(0, 0)` and `pow(x, 0)` for a zero, negative, infinite or NaN `x`, because the measured device implements it as `exp2(b * log2(a))` exactly and the CPU adopts that domain rather than letting the two paths disagree over a whole quadrant. The `clamp` inside `t` is therefore LOAD-BEARING — and in TWO panels rather than one, because `sqrt` answers a negative on exactly the same rule. Strip the clamp and this graph fails at the `sqrt` panel before it ever reaches `pow`: `transformPoints: param "translate" resolved to NaN at element 0`, 254 of that panel's 961 points non-finite. Nor is it decorative in the other four. Only `ramp` and `step` clamp by construction; `t` and `t * t` just keep going, the cone dipping 2.5 units BELOW its own plane at a corner and the square lifting a raised rim. The corners are the whole of it either way — a 12-unit panel around a radius-6 disc leaves nothing else outside. And `pow` carries the widest GPU parity budget of the grammar's ALGEBRAIC fns — 8 ULP, against bit-exact for `mul` and 1 for `sqrt`, with only the trigonometric family wider — which is why the square is spelled `t * t` rather than `pow(t, 2)`: `mul` for a square, `sqrt` for a root, `ramp` for a falloff, and `pow` only when the exponent is genuinely arbitrary. `ramp` and `smoothstep` divide the smooth-edge job between them: `smoothstep` when the knees belong at the two ends, which is the common case and now has its own fn, and `ramp` when they belong anywhere else, because a ramp says where they are instead of hiding them in a cubic. `basics-curve-shaping` puts `smoothstep` beside `exp` and `log` for that comparison. ONE MORE THING THIS FILE SHOWS BY BEING LONG: the `t` subexpression is written out SEVEN times across six panels — the square panel spells it twice, once per factor of `t * t` — because nothing yet lets one expression bind a name to a subexpression it uses more than once. Each of those seven used to be `length(sub(P, centre))` and is now `distance`, which is the same number by construction and thirty-five fewer lines of file; the repetition it does NOT fix is the point of this paragraph. That is the A3 entry in PLAN.md, and this graph is now its second worked case.

**Tags:** `basics`, `fields`, `remap`, `composition`

**Seed:** 1054

**Node types:** `mergePoints`, `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `chart`.`out`)

Cook it: `pcg cook graphs/basics-field-shaping.json --stats`

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

## basics-fit-runs.json

**fit a line through each row of props, and catch the row that only looks straight**

`pathRuns` cuts a path into runs at points something FLAGGED, and the flag has to come from somewhere. Nothing flags a row of posts: what separates one row from the next is empty arc, and a gap is a fact about TWO points at once — the shape of fact a field cannot state, because a field resolves each element from that element alone, and no boolean column exists to carry it until someone has already found the runs. `runFit` is the gap-delimited half of the family: it cuts at an along-arc distance, least-squares fits a numeric attribute against arc position inside each run, and writes slope, worst residual and span back onto every point of the run. Five rows of props are threaded onto one lap here — four of twenty and one of two — and the verdict is a colour with three values: GREEN for a row that really is a line, RED for one that is not, BLUE for one there is not enough of to say.

THE ANSWER IS PER RUN AND IT LANDS ON EVERY POINT OF IT. A run is not a primitive — one path holds five of them, so the primitive domain has no element to hold one — and repeating the verdict per point is also the shape it gets used in, since every consumer is a per-point decision. The repetition is what the picture is made of. One row is nineteen posts on a line plus ONE post four units off it, and all twenty come out red, because the verdict belongs to the run and every member carries it. That row is also why the residual is the WORST member rather than an RMS: fitted from the offsets this graph builds, its worst residual is 3.762 and its RMS is 0.868, so a rule reading 'no post sits further than a unit off the line' fails on the worst and PASSES on the mean. An RMS lets one straggler hide behind nineteen good members, which is exactly the arrangement that reads as a line to the eye.

THE BLUE PAIR IS THE MISTAKE THE NODE MOST WANTS YOU TO AVOID. Its residual is 0 — exactly, not nearly — because a line through two points is always perfect, and its slope of 6.878 is an invented number reported as confidently as any other. Those two posts sit 0.87 units apart along the road and 6 units apart across it: nothing anyone would call a row. `countAttr` is the only column that says so, which is why the colour is `runResidual < 1` ANDed with `runCount > 2` rather than the residual alone — straight is evidence only above three members, and a residual is compared against a threshold rather than against zero for the same reason every float is.

THE FIT IS AGAINST RUN-LOCAL ARC, and that is invisible when it works. A least-squares fit only ever uses `s - mean(s)`, so fitting an order-1 offset against an order-300 lap coordinate subtracts away every leading digit the coordinate was written with. `runFit` rebases each run on its own start before summing anything, which is THE SAME LINE THROUGH THE SAME POINTS — a fit is translation-invariant in the abscissa, so slope and residual are unchanged — computed where the numbers are small, and exactly rather than approximately. The check is in the graph: those twenty offsets fitted from zero give slope 0.303833 and worst residual 3.7624, and the node, fitting them where they actually lie from station 179.70, reports 0.303833 and 3.762408. `runStart` still reports the lap position (179.70) rather than the zero the fit used, because a start is a range other nodes have to be able to read.

THE ARC COORDINATE IS THE ROAD'S, NOT THE PROPS' OWN. `arcAttr` names `station` — `curveU` times the lap length — instead of being left empty to measure the polyline threaded through the props, and that choice is worth the two `promoteAttribute` nodes it costs. The props stand up to 6 units off the kerb, so the 3D chord between two of them carries their lateral offsets as well as their spacing. Cooked the other way, on the measured arc, this same graph reports the parallel row as spanning 17.57 units instead of 16.57 and the wobbling row as 53.70 instead of 16.57, and it CUTS THE PAIR IN HALF: their chord is 6.07 where the road distance between them is 0.87, so a 5-unit gap finds a break the road never had and two one-point runs appear, whose residuals are also 0. Naming a coordinate means naming its `period` too — here a field reading the lap length back off the primitive domain, since the props' own measured length is not what the station coordinate wraps at.

THE SEAM IS NOT A BREAK. One row is laid deliberately ACROSS the start/finish line, ten posts before it and ten after, and with `wrap` on the walk starts at the first REAL gap rather than at vertex zero, so those twenty stay ONE run: one slope of 0.3439, one residual of 0, one span of 16.57, and a `runStart` of 305.31 that is larger than the station of its own last member. Set `wrap` false and it becomes two rows of ten, each with residual 0 and the same slope, each too short for any rule to act on, and nothing in the columns complains. Leaving `period` at 0 while naming an `arcAttr` used to do the same thing silently, and writing this graph is what found it: a period of 0 means the path's own measured length, which is a world-unit number handed to a coordinate that is not in world units, so the seam gap inflates and a break appears where the road has none. The node now REFUSES that combination rather than inventing one — the mistake a graph cannot make is better than the mistake a graph explains. A line of eight objects across the start line reading as two lines of four is the bug this whole family agrees about the seam to prevent. The re-threading at the end is `pointsToPath` grouped on `runId` and ordered by `runIndex` — the group key and the within-run position runFit hands out — and it is what draws that row as one arc crossing the line instead of a chord across the middle of the lap, because `runIndex` counts in the walk order the runs were cut in. The second output is the lap itself, so the rows can be read against the road they were measured along.

**Tags:** `basics`, `path`, `runs`, `fit`, `closed`

**Seed:** 3311

**Node types:** `filterByExpression`, `pathResample`, `pointsToPath`, `promoteAttribute`, `runFit`, `setAttribute`, `subgraph`, `transformPoints`

**Primitives:** `shape/path-loop`

**Outputs:** `road` (from `lap`.`out`), `rows` (from `rows`.`out`)

Cook it: `pcg cook graphs/basics-fit-runs.json --stats`

## basics-flatten-and-remember.json

**flatten a cloud onto a plane and keep the height it lost**

`projectToPlane` drops every point orthogonally onto the plane through `origin` with normal `normal`, and with `keepOffset` it writes each point's SIGNED pre-projection distance into a `planeOffset` attribute before moving it. That pairing is the whole idiom: the geometry becomes a plan view, and the third dimension survives as data rather than being thrown away. Here a relief grid flattens to y = 0 and the height it had drives its colour, so the map still says where the hills were. The ramp is fitted to the relief that actually arrives (about ±1.8 units) rather than to the amplitude the transform asks for: a normalized fBm spans only the middle stretch of its nominal range, so a ramp cut to the nominal number leaves its ends unreachable and the map reads washed out. Signed, so the sign is the side — points below the plane come back negative, and a rule that wants only the high ground reads `planeOffset > 0` rather than needing a second node to tell it which way is up.

The params are field-capable and that changes what the node is. As plain vectors they describe ONE plane and the normal must be non-zero. As FIELDS they are read per point, so each point falls onto the plane IT was given: a per-point `origin` with a constant normal is an OFFSET along that normal, which is how a stepped or terraced flattening is written; a per-point normal — `attribute("N")` — puts every point onto its own surface plane instead of onto one shared one. One safety worth knowing before relying on it: where a per-point normal resolves to zero there is no plane to project onto, so that point is left exactly where it stands rather than being collapsed to the origin.

**Tags:** `basics`, `project`, `plane`, `attributes`

**Seed:** 1062

**Node types:** `pointGrid`, `projectToPlane`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `tint`.`out`)

Cook it: `pcg cook graphs/basics-flatten-and-remember.json --stats`

## basics-foreach-per-group.json

**treat each group on its own**

`partitionByAttribute` splits the cloud into one geometry per district, and `forEach` cooks its inner graph once per group instead of once — so each district shakes loose on its own seed rather than all four sharing one. Exactly one exposed input must be named `each` (one iteration per item) or `eachPoint` (one per point); every other exposed input is broadcast whole to every iteration. Each iteration is seeded on its group's own CONTENT, never on where the group sat in the collection, so reordering the input reorders the output and re-rolls none of it. The `groups` output is the four separate results, still tagged `district=<value>`; `points` is the same four put back together with `mergePoints`, which is how you return to a single cloud.

**Tags:** `basics`, `foreach`, `partition`, `composite`

**Seed:** 2026

**Node types:** `forEach`, `jitterPoints`, `mergePoints`, `partitionByAttribute`, `pointScatterInBounds`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `groups` (from `each`.`out`), `points` (from `rejoin`.`out`)

Cook it: `pcg cook graphs/basics-foreach-per-group.json --stats`

## basics-gather-by-index.json

**two hundred props each pick one of five kinds, by drawing its number**

A TABLE, A CLOUD, AND A NUMBER THAT JOINS THEM. Five points carry a catalog — a colour and a size per row. Two hundred scattered points carry one number each, `floor(u * 5)`, drawn independently. `transferByIndex` reads row `pick` of the catalog onto every one of them. That is a database join in a point graph, and until this node it had no spelling.

WHY IT IS NOT A MAPPING ON `transferAttribute`. That node offers three mappings and every one asks its question in SPACE: which source point is nearest, which triangle contains this UV, what does this ray hit. None of them can answer "read row three". The distinction is not pedantic — a `nearest` gather would make the catalog's LAYOUT decide the answer, so moving a row would silently change which props got it, and two rows at the same position would be indistinguishable. An index is not a position, and a param list that decided which of two incompatible questions was being asked would be one node in name only.

WHAT AN INDEX OFF THE END DOES, which is the whole of the node's edge behaviour. `outOfRange` names the reading: `clamp` pins into [0, count-1]; `wrap` takes a EUCLIDEAN modulo, so -1 is the LAST row rather than JavaScript's -1; `miss` leaves the destination's prior value and flags it through `hitAttr`. An EMPTY source misses every point under all three, because there is no row to clamp or wrap TO. The index truncates toward zero before any of that applies, so `floor` in the expression and truncation in the node agree on every non-negative draw.

THE UNIFORM PICK IS THE IDIOM. `floor(mul(randomField(key), n))` is how a point chooses one of n things with replacement, and `n` here is written literally because the catalog's size is known to the author. Where it is not, `attributeReduce` in `count` mode puts the row count on the detail domain and `promoteAttribute` brings it down to be read as a field — which is what a clustered scatter needs, since the number of clusters is itself decided by the graph.

STRINGS COME ACROSS. An empty `attributes` list gathers every point attribute of the source except the eight bookkeeping columns, and unlike `transferAlongPath` that includes STRING columns — that node interpolates and there is no value between two strings, while this one copies. Gathering an asset id by index is the case that matters, and it is why the exception exists.

**Tags:** `basics`, `attributes`, `transfer`, `field`, `table`, `instancing`

**Seed:** 9043

**Node types:** `pointGrid`, `pointScatterInBounds`, `setAttribute`, `spawnInstances`, `transferByIndex`

**Primitives:** *(none)*

**Outputs:** `catalog` (from `catalogSize`.`out`), `props` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-gather-by-index.json --stats`

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

The dunes of `basics-field-params` with the wrapper deleted. A `param` reference inside a field spec may carry its own value — `{ "fn": "param", "name": "amplitude", "value": 24 }` — so a plain `transformPoints` node holds both the expression and the numbers that shape it, where before a subgraph had to exist for the sole purpose of carrying them. The value is SUBSTITUTED before the field is built, exactly as a binding is, so what cooks is the field the literal would have built, cache key included. The key is optional and that is the whole of its safety: omit it and the reference is unbound and refuses to evaluate, with the same error as ever, so a default exists only where somebody wrote one. An outer binding still wins, so wrapping this node in a subgraph that exposes `amplitude` overrides the 24 without editing it. Two details are inherited rather than invented: `frequency` multiplies the sample position instead of sitting in `opts.frequency`, because that option is read as a plain number and cannot hold a spec; and the noise takes its seed from the node, `{ "from": "node", "variant": 0 }`, because a literal `opts.seed` is a number the graph seed cannot otherwise move. The grid is sized so the knobs are legible rather than merely wired: 20 units of ground at quarter-unit spacing, three octaves, and an amplitude that lands about 10 units of relief. A normalized fBm only spans about two fifths of its nominal range, so a wide grid under a modest amplitude reads as a flat field of dots and the graph fails to show its own effect; the ratio of relief to footprint is also what the viewer's framing reads to pick its elevation angle, so a flat cook is photographed from a flatter angle and hides itself twice.

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

## basics-neighborhood-varying-radius.json

**measure a neighbourhood at each point's own scale**

`pointNeighborhood`'s `radius` as a FIELD. The cloud is UNIFORM — a plain scatter, the same density everywhere — and `reach` rises left to right from 1.5 to 9 world units, so the count that comes out rises with it. Nothing about the geometry changes across the frame; what changes is the QUESTION each point asks, and that is the whole reading a per-point radius buys: 'how crowded am I, at my own scale', a big point surveying a big neighbourhood and a small one a small neighbourhood in the same cook. NEIGHBOURHOOD IS THEN NOT SYMMETRIC, and that is the point rather than a defect — B lying inside A's radius does not put A inside B's, so two points can disagree about whether they are neighbours and `countAttr` counts what each point can SEE. That asymmetry is also why this param needs no pair rule where `connectPoints.radius` needs max(rA, rB): an EDGE is one thing shared by two points, so it would depend on which endpoint asked, while a count is one point's own measurement and belongs to it alone. `reach` is written with `remap` on the x component rather than from noise so the gradient is legible as a gradient — swap in a noise or an authored size and the reading is the same. COST, NOT CORRECTNESS, is what a mixed set of radii affects: the uniform grid is sized from the largest FINITE radius, and a query wider than that scans more cells rather than returning a different answer. An INFINITE radius is legal here and means the whole cloud, falling back to a full scan at O(n) per point — but a graph FILE cannot carry one, because JSON has no infinity and the serializer refuses a non-finite param outright, and a live param patch cannot carry one either: that route gates on the param declaring `acceptsInfinite`, and this one does not — in the whole standard library only `filterByBounds`' and `filterPrimitivesByBounds`' bounds do, so `setParam` here answers 'expected a finite number, got null'. What is left is an expression that COMPUTES one at cook time, and `div(1, 0)` in this slot duly gives every point a count of 1199 — every other point in the cloud. Under a partitioned cook the halo a cell needs is the GLOBAL MAXIMUM this field can return anywhere in the world, DERIVED rather than measured — the far neighbour that would have set it is precisely the one a clipped cell cannot see. Here the `clamp` states it: 9. The remap alone would not, because `remap` is UNCLAMPED — the same expression returns 67.75 at x = 500, and 'anywhere in the world' is precisely the range a halo has to survive rather than the range this one cook happens to sample. Underestimating does not throw; it silently misses neighbours, at the seams only. THE LIFT IS THE PICTURE, not part of the idiom: `nbrCount * 0.25` raises each point by what it measured, turning a flat plane into a wedge that rises left to right even though the cloud under it is uniform. The wedge is CURVED, and that is the arithmetic being honest: `reach` is linear in x, but the disc it sweeps grows with its SQUARE, so a linearly widening question gets a quadratically growing answer: about 4 neighbours across the first six units and about 52 across the last. THE WEDGE TURNS OVER before it gets there, peaking at a band mean of 58 just inside the far edge and falling back — and that is the boundary rather than the arithmetic. A point near the edge sweeps a disc that runs off the end of the cloud, so it counts less than an interior point asking the identical question. It is the same effect a partitioned cook sizes a halo to defeat, visible here because nothing feeds this cloud from outside. Delete that node and the graph is unchanged in everything it teaches — but a plane of 1200 dots four pixels wide cannot show a number, and a corpus graph that cannot be seen fails at its only job. `color` carries the same count as a HUE at constant brightness, cool where a point sees little and warm where it sees a lot. A point cloud renders at one uniform size — per-point `scale` is read for instance transforms, never for a bare cloud — so colour is the only per-point channel the picture has, and a ramp that darkens instead of shifting hue spends half of it on going invisible. `basics-neighborhood-count` is this graph with one radius for the whole cloud.

**Tags:** `basics`, `attributes`, `neighborhood`, `fields`, `measure`

**Seed:** 1053

**Node types:** `pointNeighborhood`, `pointScatterInBounds`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `tint`.`out`)

Cook it: `pcg cook graphs/basics-neighborhood-varying-radius.json --stats`

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

## basics-repeat-until-settled.json

**run a body until it settles**

`repeatUntil` cooks its inner graph again and again, feeding each round's `carry` output back into its own `carry` input, and stops when the body says nothing changed. This is the loop a DAG cannot wire — a wire from an output back to an input is a cycle, which `connect` refuses — so the feedback is an assignment between cooks instead. The body here is a damped descent: every round halves each point's height, then writes 1 for every point still further than 0.01 from the ground and reduces that to the DETAIL attribute `moves`. When `moves` reaches zero the cloud has settled and the loop stops; the scatter starts up to 8 high, so halving takes about ten rounds and the `rounds` output says exactly how many. Two things are worth reading off this graph. The settle signal rides the DETAIL domain because a wrapper has no non-geometry output pin — `attributeReduce` is what normally writes it, and an ABSENT `moves` is refused by name rather than read as zero, so a typo cannot report convergence on round one. And the body's seed is NOT rotated per round: a fixed point exists only if the body is the same function every time, so a body seeded on the round number can never converge, however many rounds it is given. Every real use has this skeleton — push overlapping props apart, snap dangling edges, repair a placement against a rule — and differs only in what one round does.

**Tags:** `basics`, `repeatuntil`, `relaxation`, `composite`

**Seed:** 2026

**Node types:** `attributeReduce`, `pointScatterInBounds`, `repeatUntil`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `settle`.`carry`), `rounds` (from `settle`.`rounds`), `converged` (from `settle`.`converged`)

Cook it: `pcg cook graphs/basics-repeat-until-settled.json --stats`

## basics-report-to-the-host.json

**what a graph hands back that is not geometry**

A cook returns items, and only some of them are shapes. This graph returns three kinds at once and the difference between them is the lesson.

`attributeReduce` collapses a whole domain into ONE value on the DETAIL domain: the sum of the weights, their maximum, and a plain count of the points. Three reductions of one attribute need three distinct `outName`s — left empty the name is reused, which is what promoting would have produced and is fine for one. Mode 'count' reads no attribute at all, so `name` is left empty there rather than pointing at a column it will ignore. THE CONSTRAINT WORTH KNOWING: a point-domain field cannot read the detail domain. That is deliberate, not an oversight — a field resolves each element from that element alone, and a total is a property of every element at once, so a graph cannot feed its own totals back into its own points. Anything that needs to (calibrate a count against a budget, normalize by a maximum) runs as a loop in the HOST, between cooks, reading these reports and setting params for the next one.

`removeAttribute` is the other half. `weight` here is scratch — it exists to be reduced — and every idiom that carries a value between nodes leaves its column on the output forever unless something takes it off. This is the only node that can, and the ORDER is the point: the reductions read the column, so they must run before the removal. It is `strict` by default, so a typo in the name is an error naming the columns that do exist rather than a silent no-op leaving exactly the debris it was meant to clear.

`valueConstant` is the third kind: a plain number, riding back beside the geometry. Here it is the weight budget the graph was authored against, for a host to compare the reduced `weightSum` against — and as it stands this cook comes out OVER it, which is the interesting case: the comparison is a signal a host loop acts on by changing a param and cooking again, not an assertion the graph makes about itself — a number the graph declares rather than derives, which is why it is a constant and not another reduction. Worth knowing before reaching for it: EVERY input pin in this library is geometry-kind, so a value item has nowhere to go inside a graph. Its only destination is an output.

**Tags:** `basics`, `attributes`, `reduce`, `detail`, `values`

**Seed:** 1060

**Node types:** `attributeReduce`, `pointGrid`, `removeAttribute`, `setAttribute`, `valueConstant`

**Primitives:** *(none)*

**Outputs:** `points` (from `clean`.`out`), `weightBudget` (from `budget`.`out`)

Cook it: `pcg cook graphs/basics-report-to-the-host.json --stats`

## basics-reseed-a-noise.json

**make a saved noise re-roll with the graph seed**

A serialized field expression bakes its numbers, so a noise that carries `opts.seed` as a literal leaves the graph's seed box moving every scatter and jitter while the shape stays exactly where it was. `opts.seed` is the way out, because besides an integer it takes one tagged form: `{ "from": "node", "variant": 5 }` derives this noise's seed as `hashCombine(the cooking node's own seed, variant)`, the node seed being `deriveNodeSeed(graph seed, node id)` — the same number `randomField` hashes. So the seed box now moves this surface and not merely the points on it. Every part of that shape is load-bearing. The whole derivation is u32 murmur with no float anywhere in it, which is why it is bit-exact on CPU and GPU rather than budgeted the way a noise interior is: a seed has no tolerance, since a one-ULP disagreement in one is not a rounding error in the output but `hashCombine` avalanching to an unrelated number and the two paths cooking different noises. That is also why the position is the one noise option that takes a spec and the seed admits no arbitrary expression — every field column is f32, so a seed read through one would arrive already rounded to 24 bits. `variant` stands where the old literal seed stood, and it picks WHICH draw off this node: two noises on one node with different variants are two independent fields, which is how a single node yields several. It is capped at 2^24, where an f32 stops holding every integer, because the GPU may read it back through a uniform slot — a variant is a slot number, not a seed. Adopting the form RE-ROLLS the noise: frequency, amplitude, position and normalization are untouched, but the field is a different draw from the same family, so it is an edit made once and deliberately rather than a new default. Change the seed and this surface becomes a different surface; write a literal back into `opts.seed` and it is deaf to the seed again.

**Tags:** `basics`, `fields`, `noise`, `determinism`

**Seed:** 1048

**Node types:** `pointGrid`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `lift`.`out`)

Cook it: `pcg cook graphs/basics-reseed-a-noise.json --stats`

## basics-runs-along-a-path.json

**measure distance since the last gate, and to the next one, around a closed lap**

`pathScan` accumulates from a path's seam and never resets, which answers 'how much lies behind me' and nothing else. The questions a marker rule actually asks are 'how far since the last gate' and 'how far to the next one', and neither is a prefix sum: getting the first out of a scan means subtracting the scan value at the most recent gate behind you, and OBTAINING that value is a backward look-up along the path. A field cannot perform one — a field resolves each element from that element alone — and `pathScan` was the library's only order-aware node, so there was nothing to build the emulation out of. `pathRuns` is the missing primitive: a SEGMENTED scan, where the accumulator resets at points a boolean attribute flags.

It accumulates a VALUE rather than counting elements, which is the whole ergonomic difference. Scan a per-segment length and you get distance; scan a constant 1 and you get the number of points; scan a cost and you get cost. Here `seg` is the lap length over the sample count — `pathResample` in `count` mode spaces its samples evenly, so one number describes every segment — brought back from the primitive domain by `promoteAttribute`, the same way `basics-density-along-a-path` recovers its scan total.

The gates are picked with arithmetic on `index` — every sixtieth sample of the 240, offset by thirty — which is exact where a threshold on `curveU` would not be: `mod(index + 30, 60) < 0.5` selects four samples and cannot select a fifth by rounding, where `fract(curveU * 4)` near zero can read 0.9999 instead and drop a gate. The offset is the point of the exercise. Without it the first gate would land on sample zero, which is the seam, and the graph would demonstrate nothing: gates at the seam make wrapping a no-op. `index` names a SLOT rather than an element and anything that filters or reorders upstream renumbers it, which is safe here because it is read immediately after the resample that creates the samples.

WHAT THE CLOSED LAP IS DOING HERE, because it is the case the primitive exists for. Sample zero sits thirty samples PAST the last gate, on the far side of the start/finish line from it. With `wrap` on, the walk starts at the first flagged point rather than at vertex zero, so that run stays ONE run and sample zero reads the distance back to the gate behind it — about a quarter of the way into its run rather than at its start. Turn `wrap` off and the seam cuts the run in two: sample zero reads zero, and the thirty samples after it read a distance measured from the SEAM rather than from their gate, wrong by however far back the gate is. Nothing about the column shows it — the values are all still positive and still increasing, and the ramp simply restarts at a place no gate stands. A real circuit always has a corner that straddles the line.

Both directions are cooked because they are different questions rather than one question reversed. `since` reads backward-looking (what is behind me since the last gate) and `ahead` reads forward-looking (what is in front of me up to the next one); recovering either from the other needs each run's total, which no point holds. The colour ramps from `since` over a quarter-lap, so each run climbs from blue at its gate to red just before the next, and the ramp is continuous across the seam — that continuity is the whole picture. The second output is the four gate points themselves, filtered on the same flag, so the ramp can be read against where it is supposed to reset.

**Tags:** `basics`, `path`, `runs`, `segmented-scan`, `closed`

**Seed:** 2207

**Node types:** `filterByAttribute`, `pathResample`, `pathRuns`, `pointsToPath`, `promoteAttribute`, `setAttribute`, `subgraph`

**Primitives:** `shape/ring`

**Outputs:** `lap` (from `tint`.`out`), `gates` (from `gates`.`out`)

Cook it: `pcg cook graphs/basics-runs-along-a-path.json --stats`

## basics-scatter-along-a-path.json

**scatter a lap with as many markers as its own length asks for**

THE COUNT IS NOT IN THIS FILE. Thirty-five markers land on this loop, and nowhere does the graph say thirty-five: `pointScatterOnPath`'s `count` is the expression `0.35 * length`, resolved against the path's OWN primitive-domain length column, which `pathResample` measured at 100.4906. Stretch the loop and the marker count follows it; there is no number to keep in step by hand.

WHY THAT NEEDED A NODE. Every other arc-length placer in the library is deterministic-even — `pathResample` and `splineSample` divide a length into equal steps, `arcTile` walks a fixed spacing, `pathSegments` emits one point per segment — so a RANDOM population along a curve had to be composed: a source node for the count, a `setAttribute` for a random station, then `transferAlongPath` sampling `P` to pull the cloud onto the curve. That recipe still works and `basics-stations-on-a-path` still shows it. What it cannot do is decide HOW MANY.

A source node emits points from nothing, so it has no element against which to read a field, and `fieldCapability.test.ts` refuses a field-capable param on one for exactly that reason. The question is never what a param decides — `pathResample.spacing` decides an output count and is field-capable — it is whether an element exists to read the param PER. A scatter that takes the path as an input has one: the polyline itself. So the count becomes a field, and the population becomes a property of the curve rather than a constant the author maintains beside it.

ONE COUNT PER POLYLINE, NOT ONE PER CLOUD. The field resolves on the primitive domain, so a geometry carrying four paths gets four independent counts and each path is scattered to its own. The emitted total is always the sum of them, so no path is ever silently skipped.

WHAT THE MARKERS DO NOT CARRY. This node writes three things — the position on the curve, the arc position it was drawn at (`station` here), and the per-point seed. It does not write a tangent, and that is deliberate: `writeTangents`, `writeCurveFrame` and `transferAlongPath` already answer that question against the same shared arc table, and a fourth node measuring the same curve is how two nodes come to disagree about where the halfway point is. Orient these markers by gathering the tangent, the way the sibling graph does.

**Tags:** `basics`, `path`, `curve`, `closed`, `scatter`, `field`, `instancing`

**Seed:** 4211

**Node types:** `pathResample`, `pointScatterOnPath`, `setAttribute`, `spawnInstances`, `subgraph`

**Primitives:** `shape/path-loop`

**Outputs:** `lap` (from `measure`.`out`), `markers` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-scatter-along-a-path.json --stats`

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

## basics-shift-along-a-path.json

**draw the chain between scattered beads, from nothing but each one's successor**

TWENTY-FOUR BEADS AT RANDOM ARC POSITIONS, AND THE LINKS BETWEEN THEM. Every link here is built from one fact: where the NEXT bead is. `pathShift` reads it — the beads are ordered into a closed ring by `pointsToPath`, and each one is handed its successor's `P` under the name `nextP`. A link is then just the vector between the two: `orientAlongVector` aims it, and `distance` sizes it. Nothing measures the curve, and nothing counts anything.

WHY THIS NEEDED A NODE. "What does the element next to me carry" had no spelling. `pathScan` and `pathRuns` are prefix sums — they accumulate ALONG the order but cannot hand one element another's value. `transferByIndex` gathers by an ABSOLUTE point index, which is not the same question: the beads are stored in the order they were scattered, and the ring visits them in the order of their arc positions, so point 7's successor is whatever point happens to sit next round the lap, not point 8. `pathSegments` does draw one thing per segment, but it emits a SEPARATE cloud and explicitly drops the input's point attributes, so what it makes cannot be a bead that knows anything about itself. `transferAlongPath` reads at an arc position, not at an ordinal neighbour.

THE CLOSING LINK IS THE TEST OF IT. `outOfRange: "wrap"` is what makes the last bead's successor the first one, so the ring closes and there are twenty-four links for twenty-four beads rather than twenty-three and a gap. Set it to "clamp" and the last bead points at itself, giving a zero-length link; set it to "miss" and it keeps the default, which for `nextP` is the origin — so the last link stretches to the middle of the world, which is exactly the kind of wrong that looks like a rendering bug rather than a policy choice. Pick the one you mean.

WRAP IS A POLICY, NOT A PROPERTY OF THE PATH. A closed polyline changes the ring's COUNT — its last position has a successor where an open one's does not — but it does not change which policy applies. An open path under "wrap" still comes round to its own start, because the question is what an ordinal past the end of a list should do, and a list has ends whether or not a segment joins them.

THE BEADS ARE UNEVENLY SPACED ON PURPOSE. `pointScatterOnPath` draws twenty-four arc positions at random, so the links differ in length and the picture shows the shift doing real work. Evenly-spaced beads would draw the same chain whether the successor lookup were right or off by one.

**Tags:** `basics`, `path`, `curve`, `closed`, `attributes`, `instancing`

**Seed:** 6607

**Node types:** `orientAlongVector`, `pathResample`, `pathShift`, `pointScatterOnPath`, `pointsToPath`, `setAttribute`, `spawnInstances`, `subgraph`

**Primitives:** `shape/path-loop`

**Outputs:** `loop` (from `measure`.`out`), `chain` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-shift-along-a-path.json --stats`

## basics-sightline-cull.json

**clear a line of sight by moving the props, not by deleting them**

`occlusionCull` is the only node in the library that MOVES a point as well as removing one, and this graph exists to show that the order of those two is the whole node rather than an optimisation inside it. Two identical culls run over the same 220 hoardings, differing in exactly one number. At `pushMax` 0 — the shipped default, and the conservative reading — every hoarding standing in the drivers' line of sight is deleted and 151 come out. At 8 the node first steps each blocker along `pushAxis` in half-unit rungs, keeps the first position that clears every chord, and drops only what it could not move: 220 come out. Same sight path, same swept band, same rule. The difference is 69 assets an author placed and a budget upstream counted. Dropping spends both, pushing spends neither, and that is why the default is 0 rather than something generous — 8 is a long way in a courtyard and nothing at all on a motorway, so a default distance would either do nothing or relocate an authored point by an amount nobody chose, and of the two failures the missing prop is the one an author notices.

THE SIGHT PATH IS A CLOSED LOOP because the case this node is for is a route, and a route bends. The eyes are the loop resampled at 3-unit spacing, 55 of them, raised 1.5 by `eyeOffset` while the TARGETS stay on the road — lift both ends and a low box slips under the chord that was supposed to catch it. `lookAhead` is 30 world units of ARC LENGTH, so the chords from an eye cut across the inside of the bend and dip to 26·cos(30/52), about 21.8 of the loop's own 26. That annulus, widened by a hoarding's half-diagonal, is the strip the two outputs sweep clean: neither has a single hoarding left between radius 22 and 25, because the cull is the same cull and only the repair differs. Cost is one test per (point, nearby eye, sample), so it scales with EYE DENSITY as much as with the cloud — resample the sight path to the spacing the rule needs rather than the spacing it happens to have, since at 0.1 this same loop would be over sixteen hundred eyes for the identical answer.

WHY THE FAN IS TEN CHORDS AND NOT ONE, stated as a number the graph will produce: set `samples` to 1 and the pure cull keeps 156 instead of 151. Those five hoardings stand squarely across the middle of the look-ahead while leaving its far end in plain view, so a single chord to the end of the run misses them and the rule passes vacuously. The targets sit at `lookAhead * i / samples`, so the gap between them here is 3 units, and a box narrower than that gap can still slip between two chords and be kept. Raise `samples` until the gap is smaller than the narrowest thing that matters; lowering it is the cheapest way to make this node fast and the first thing to make it wrong.

`pushAxis` IS A FIELD HERE, which is the form the param is really for. `vec(P.x, 0, P.z)` gives every hoarding the outward radial of the place it stands, which on a circular route is its lateral; only the DIRECTION is read, since the node normalizes it and chooses the sign itself, pushing whichever of ±axis takes the point further from the nearest eye. That is what lets one expression serve the inside of the loop, which moves inward, and the outside, which moves outward, with no sign written per point. Replace it with the plain `[1, 0, 0]` this param defaults to and 19 hoardings are dropped anyway — the ones at the north and south of the loop, where world X runs ALONG the sight line, so a point pushed along it never leaves it. A world axis stops being an approximation the moment the route turns. `pushMax` is a real distance and not a slider: at 4 instead of 8, 18 blockers cannot reach clear air and are dropped after all.

WHAT IS TESTED IS WHAT WILL BE DRAWN: `P` is the box centre, `rot` its orientation, `scale` its FULL extents, and those are the same three columns `spawnInstances` reads. Note there is no `boxSize` param here as there is on `pathCoverage` — `scale` alone is the world size, so a cloud standing for an asset that is not unit-sized has to fold the asset's own extent into `scale` before this node sees it. A cloud with NO `scale` column is read as a box with no extent, which blocks nothing: the node becomes a visible no-op rather than an error, and that asymmetry is deliberate, since assuming a unit box would delete points on the strength of a size nobody wrote. `write/random-yaw` turns each 3.2 by 1.0 hoarding, and the slab test runs in each box's OWN frame: one that presents its narrow edge to the chords survives where its world-aligned hull would not. On a straight the hull and the box agree; through a bend they do not, which is exactly where the rule matters, so testing the hull would be checking the one case that never fails.

BOTH CULLS RUN AT `pushClearance` 0, which is what lets this graph claim anything about order. Points are visited in an order fixed by point IDENTITY — the bits of the stored position plus the `seed` attribute — and never by array index, so shuffling the cloud, filtering something upstream, or deriving the same hoardings inside another cell's halo yields the identical survivor set. At 0 a verdict depends on the sight input and the point itself and on nothing else, so a partitioned cook is EXACT given a window of `lookAhead` plus `pushMax` plus the widest box half-diagonal, about 40 units here. Raise it and each pushed point begins avoiding the ones already settled, which is a chain no halo width covers: the answer is still the same answer on every run, but a per-cell cook stops agreeing with a whole-region one and the disagreement shows up as pushed points overlapping at the seams rather than as an error. It is the knob to reach for when the pushed points land in a heap; on this scene they do not, because the 69 of them spread over an annulus 120 units around.

TOPOLOGY DOES NOT SURVIVE under any setting, and unlike the five point filters there is no `topology: keep` to ask for it — a primitive kept over a MOVED point would describe a shape nobody authored, a road that follows its lamp posts sideways. Rebuild with `pointsToPath` or `connectPoints`. One consequence worth stating because nothing else will say it: a pushed point comes out with a different `P`, and `P` is half of a point's identity, so anything identity-keyed downstream re-rolls for exactly the points that moved.

THE TWO SCENES ARE ONE SCENE, translated 92 units apart so they can be read side by side, and the loop under each is the same sight path. Read the band. On the left it is empty and the hoardings that stood in it are gone; on the right it is just as empty, and they are standing along both of its edges.

**Tags:** `basics`, `visibility`, `filter`, `placement`

**Seed:** 3391

**Node types:** `mergePrimitives`, `occlusionCull`, `pathResample`, `pointScatterInBounds`, `setAttribute`, `spawnInstances`, `subgraph`, `transformPoints`

**Primitives:** `shape/path-loop`, `write/random-yaw`

**Outputs:** `roads` (from `roads`.`out`), `dropped` (from `spawnDrop`.`instances`), `pushed` (from `spawnPush`.`instances`)

Cook it: `pcg cook graphs/basics-sightline-cull.json --stats`

## basics-signed-distance.json

**a signed distance field, and which side of it**

A SIGNED DISTANCE FIELD, which is what `distance` and `sign` are for together. `distance(P, centre) - 12` is negative inside a circle of radius 12, zero on it and positive outside — one number that carries both HOW FAR and WHICH SIDE, and splitting those two questions apart is the whole idiom. `sign` answers the second, `abs` the first, and the height here multiplies them: `sign(sd) * 5 * exp(-0.30 * |sd|)` raises a rim outside the circle and sinks a trench inside it, both decaying away from the boundary. The result is a crater, and the ring where it crosses zero is the shape the field was defined by. `sign` IS EXACT ON BOTH PATHS, and that is a design decision rather than a measurement that happened to come out clean: it is defined as `(x > 0) - (x < 0)`, a pair of comparisons with no interior to round, so the device and the CPU cannot disagree. Two answers depart from a host language on purpose — a NaN gets 0 rather than NaN, and a negative zero gets +0 — because a rule both paths execute exactly beats a rule one of them approximates. Neither input occurs in this cook, which is the ordinary case: the departures matter where a field feeds `sign` something degenerate, not on a clean grid. It is what `normalize` already does to a scalar; it exists to buy the NAME, on the precedent `step` set, since nobody reaches for a vector normalizer to ask which side of a line they are on. The exact-zero case is REACHABLE but unreached here, and the arithmetic says why: a grid point lands on the circle only where its integer offsets satisfy j^2 + k^2 = 711.11, which none do. The nearest sits 0.0075 off it, so the deepest trench and the highest rim come out at 4.989 rather than the nominal 5 — which is the cooked bounds, and a neat demonstration that a sampled field only ever shows you the samples. `distance` IS EXACTLY `length(sub(a, b))`, pinned by a test rather than merely intended — the difference is rounded to f32 before it is squared, because that is what `sub` stores and what the device subtracts, so the fused spelling cannot drift from the composed one. It is the fn `basics-field-shaping` open-codes seven times over, and its measured GPU budget is 1 ULP against `length`'s 4, because that family compounds two fns in one measurement where this is a single square root over a subtraction. THE COLOUR IS THE SIGN, not the height, which is why the two regions read as different materials rather than as one surface with a fold in it: a ramp with stops at -1, 0 and +1 can take only three values, because `sign` only ever produces three. In this cook it takes TWO — no point lands on the circle, so the middle stop is never selected, and it sits there for the boundary case rather than for anything visible.

**Tags:** `basics`, `fields`, `distance-falloff`, `composition`

**Seed:** 1058

**Node types:** `pointGrid`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `sides`.`out`)

Cook it: `pcg cook graphs/basics-signed-distance.json --stats`

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

## basics-stations-on-a-path.json

**read a lap's own frame and width at thirty arbitrary stations, and place markers there**

AN N-POINT CLOUD OF STATIONS AGAINST AN M-POINT PATH. Thirty markers, sixty-four path points, and no relationship between the two numbers: each marker carries one number — how far along the lap it belongs — and `transferAlongPath` reads the path there and writes the answer onto the marker. Nothing else in the library can state that. `pathResample` and `place/along-curve` step a WHOLE curve at even intervals, so the count is the curve's to decide and the positions are evenly spaced by construction. `pathPointAt` slides the path's OWN points, so its output carries the path's point count and topology and can only ever answer questions about the path itself. `writeCurveFrame` evaluates at a path's existing points and nowhere between them. The stations here are none of those things: they are thirty numbers drawn independently, they do not divide anything evenly, and they arrived on a cloud that has never met this path.

THE ARC COORDINATE IS THE CHORD ONE, and it is the same one every other path node uses: the running sum of the straight-line distances between consecutive path points, closing segment included. This 64-corner loop of radius 16 measures 100.4906, a little under the 100.5310 of the circle it approximates, and that shortfall is the honest number — a polyline is what the library stores, and a length taken off a curve fitted through the points would be a measurement of something that is not there. `pathPointAt`'s 'distance' mode, `arcTile`'s `startAttr` and this node's `arcAttr` all mean this same coordinate, which is what lets one graph mix them.

THE STATIONS RUN OFF BOTH ENDS OF THE LAP, ON PURPOSE. Each marker's station is drawn uniformly from [-24, 126) — wider than the lap in both directions, so about a sixth of them are negative and a sixth are past the end. Every one of them still lands on the road, because `wrap` is on and the path is CLOSED: the position is taken modulo the length and a negative is corrected, so -12 is 88.49 and 130 is 29.51. That is the same reading of a closed path's seam that `pathRuns`, `runFit` and `arcTile` take, and it is what makes an arc coordinate usable as a lap counter — a car three and a half laps in has travelled 351.7, and 351.7 is a place. Turn `wrap` off and the two tails would pile up on the start/finish line instead, which is what CLAMPING means and what an OPEN path does whatever `wrap` says, since it has no seam to cross.

WHICH COLUMNS ARE SAMPLED IS SPELLED OUT HERE RATHER THAN LEFT TO THE DEFAULT. `attributes` names three, and each is a different reason for the node to exist. `P` is the placement: sampling it MOVES every marker onto the curve at its own station, which is how a cloud of numbers becomes a set of positions on a road, and it is the reason the eight standard bookkeeping columns are excluded from the default rule rather than forbidden — the default must not move a cloud, but naming P must always work. `tangent` is the direction, written on the path by `writeCurveFrame` and read here so `orientAlongVector` can turn each marker to face the way the road goes. `roadWidth` is the one nobody but the author knew about: it was computed on the path's sixty-four points and it is read at thirty places that are not any of them. Leaving `attributes` empty would have sampled `tangent`, `curveNormal`, `curveBinormal` and `roadWidth` — every numeric column that is not bookkeeping — and left the markers where they were, which is a different graph.

INTERPOLATING A DIRECTION SHORTENS IT, which is why `normalize` names `tangent`. Two unit vectors blended halfway are shorter than one by a factor that depends on the angle between them, so the shortfall is worst exactly where the road turns hardest and it is invisible until something reads the length. Renormalising each axis independently does NOT re-orthogonalise them, so a frame that must stay orthonormal has to be rebuilt from two of its axes with a cross product; that is not what this param does and the node's description says so.

EVERY SAMPLED COLUMN ARRIVES AS f32, whatever the path stored it as, because an interpolated value is a real number: a lane index read halfway between lane 1 and lane 2 is 1.5, and an integer column would round that to a value neither neighbour holds and destroy the one fact the query was asking for. A value that must stay discrete is not an interpolation and belongs on `transferAttribute`'s 'nearest' mapping — which is also the node to reach for when the question really is 'what is nearest in space'. The two are not interchangeable, and where they part company is a fold: two stations tens of units apart along a lap are centimetres apart in world space at a hairpin, and a nearest-point gather there reads the far side of the corner and reports it as a hit.

The marker sizes are the proof that the width made it across: `scale` IS the gathered `roadWidth`, which runs between 1.8 and 4.2 twice around the loop, so the markers breathe with the road at stations the road was never sampled at. The second output is the lap itself, to read them against.

**Tags:** `basics`, `path`, `curve`, `closed`, `instancing`

**Seed:** 8317

**Node types:** `orientAlongVector`, `pointLine`, `setAttribute`, `spawnInstances`, `subgraph`, `transferAlongPath`, `writeCurveFrame`

**Primitives:** `shape/path-loop`

**Outputs:** `road` (from `width`.`out`), `markers` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-stations-on-a-path.json --stats`

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

## basics-tile-an-arc.json

**tile a repeated piece over three stretches of one lap, choosing the piece once per stretch**

ENCLOSURE IS A PATTERN, NOT AN ASSET. On the most enclosed of twenty-two measured circuits the cover overhead is held up by 126 separate objects, and the largest single one accounts for 5.9% of it — the workhorse is one strip placed 24 times. There is no tunnel model to find and place; there is a run of repeated pieces over an arc range, and `arcTile` is the node that builds one. The ranges arrive as a SECOND GEOMETRY rather than as params: there are many of them and each carries its own decisions — where it starts, how long it is, which piece it is made of, how wide, which variant — and a param is one value for the whole cook. Three ranges here, hand-written as three points, become 48 tiles in three batches.

THE PIECE IS CHOSEN ONCE PER RANGE, AND THAT IS THE WHOLE POINT. The draw happens on the ranges cloud, where there is exactly ONE element per stretch to draw on: `randomField` picks 0, 1 or 2, and that one number decides the asset id, the colour and the piece's length. `rangeNames` then COPIES those columns, unchanged, onto every tile of that range. Copying is what makes a run atomic. Move the same `setAttribute` downstream of `arcTile` and it becomes 48 draws instead of 3: every stretch turns into a speckle of all three assets, which is still 48 instances of the same vocabulary and is no longer three covered stretches. A per-tile draw can be uniform only by luck, and only until someone changes the seed — the case this node comes from measured a planned 17-unit covered stretch back as 8 the moment poses were drawn per piece, because varying the shape along a run reopens the seams the overlap existed to close.

THE COLOUR IS CALLED `rangeColor` AND NOT `color` ON PURPOSE. `color` is one of the names `arcTile` writes on every tile itself, and `rangeNames` REFUSES such a name rather than resolving it quietly, because carrying it would delete what the node wrote and the cook would look entirely fine afterwards. So the per-range decision is written under a name the node does not own, and `spawnInstances` is pointed at that name directly — nothing is picked up automatically, and an attribute never named in `colorAttr` is silently not drawn. The picture is the test of the whole paragraph above: each stretch is one solid colour, and the three colours differ.

SPACING IS A CEILING ON THE PITCH, NOT THE PITCH, and here it is a FIELD so the pitch can follow the piece. Each range writes `pieceLen` beside its asset id and `arcTile` resolves `spacing` on the ranges' POINT domain, so an 8-unit gantry, a 5-unit arch and a 2-unit rib tile at their own pitches in ONE cook, each reading the size its own range chose. A range of length L takes max(1, ceil(L / spacing)) tiles at the centres of that many equal sub-intervals, so the step is L / count and is at most `spacing`, never more: the 52-unit arch range takes 11 tiles at a pitch of 4.727, the 66-unit gantry range 9 at 7.333, the 55-unit rib range 28 at 1.964. Rounded UP, not to nearest, so that pieces meant to abut do — nearest would have given the arch range 10 tiles at 5.200, which is a fifth of a unit of daylight at every joint and two units of it over the range, and a gap in a tiled cover is not a near-miss but a hole. Nothing here knows how big your piece is, which is why OVERLAP is spelled as a spacing SMALLER than the piece; about 5% under closes the wedge two pieces leave on the outside of a bend.

THE MOUTHS FLARE. `flare` is the arc distance over which each end opens and `taper` the scale the very mouth reaches, taken from whichever mouth is nearer, and it is applied to the two `scale` components that are NOT `axis` — the cross-section opens while the length along the path is left alone, since scaling all three would make the mouth pieces longer as well as wider and open the seams between them. With flare 6 and taper 1.6, the first arch tile sits 2.36 into its range, so its ramp is 0.606 and its scale comes out [1.364, 1.364, 1]: opened across, untouched along. A cover that starts at full section is a wall with a hole in it; the eye reads an opening from the way the section grows, and the flare is what keeps the view clear at the moment of entry, which is the moment it matters. When a mouth should do something else — lift, tilt, swap to a wider variant, fade a material — `flareAttr` writes the raw 0..1 ramp and leaves the doing to the asset.

THE SEAM IS NOT A BOUNDARY. The rib range starts at 285 on a lap of 314.03 and runs 55, so it crosses the start/finish line, and on a CLOSED path that is one range whose arc is taken modulo the path's length — the same answer `pathRuns` and `runFit` give a run there. Its 28 ribs step from 285.98 through 313.48 to 1.41 and on to 24.98, 1.964 apart the whole way including across the line: no double tile, no gap. On an OPEN path that range would be REFUSED rather than clamped, because a clamped range is a shorter tunnel than the one that was planned, reported as a success. The ranges are hand-written here because the point of the graph is WHERE the decision is made, and three points make that unmistakable — but any cloud will do, and `startAttr` and `lengthAttr` default to `runStart` and `runSpan`, which are `runFit`'s own default output names: filter a fitted path down to `runIndex == 0` and each survivor is one point carrying its run's start and span, which is a ranges cloud (see `basics-fit-runs`). The output is a plain CLOUD and not a path — the tiles are placements along the curve, not the curve — so the second output is the lap itself, to read them against.

**Tags:** `basics`, `path`, `tiling`, `instancing`, `closed`

**Seed:** 4139

**Node types:** `arcTile`, `pointLine`, `setAttribute`, `spawnInstances`, `subgraph`

**Primitives:** `shape/path-loop`

**Outputs:** `road` (from `loop`.`out`), `cover` (from `spawn`.`instances`)

Cook it: `pcg cook graphs/basics-tile-an-arc.json --stats`

## basics-tiling-a-field.json

**tile a field across the origin**

TILING IS `fract` AND `mod`, and this graph is built so the choice inside them is visible rather than asserted. Every bump is the same expression of a TILE-LOCAL coordinate — `fract(x / 8)` and `fract(z / 8)`, each in [0, 1] — closed at the top, because `fract(-1e-8)` rounds up to exactly 1 in f32 — and the checker under them is the TILE INDEX, `mod(floor(x / 8) + floor(z / 8), 2)`. The field is unbounded in principle and periodic in fact, which is the whole trick: nothing here stores a tile, and a point 4000 units away costs exactly what a point at the origin costs. The size is one inline `param`, and counting where it lands is instructive: FOUR logical uses — two `fract` divisions and two `floor` divisions — but TEN occurrences in the file, because `bump` reads its argument twice and the colour ramp repeats the whole tile index once per channel. One knob moves all ten coherently; spelling them as ten literals means ten edits to retile, and nine chances to leave one behind. That gap between four ideas and ten occurrences is the A3 entry in PLAN.md seen from another angle — nothing yet lets an expression bind a name to a subexpression it uses more than once, so the inline `param` is standing in for the `let` the grammar does not have. LOOK AT THE ORIGIN. Both fns in this library are FLOORED — `fract` is non-negative for every finite input and `mod`'s sign follows the DIVISOR — so `fract(-0.125)` is 0.875 and `mod(-1, 2)` is 1. The tiling therefore crosses x = 0 and z = 0 with no seam at all, and that is the entire reason the choice was made that way. A truncated remainder — JS `%`, and WGSL's `%` on floats — answers -0.125 and -1 instead, which mirrors every tile in the negative quadrants: the bumps invert into pits and the checker takes a third value the ramp was never given a stop for. It is a defect that cannot be seen in a demo built around the origin's positive corner, and it appears the moment a world grows in the other direction, which is precisely what an unbounded generator does. THE `floor` PAIR IS NOT THE SAME OPERATION as the `fract` pair, though they read alike: `fract` gives the position WITHIN a tile and `floor` gives WHICH tile, and together they are the standard decomposition of a coordinate. `fract(t)` is exactly `mod(t, 1)` — the library pins that equivalence in a test rather than just claiming it — so the two lines here are one idea used twice, once for a continuous value and once for an integer bin. Both are BIT-EXACT on the GPU, which is not a given for `mod`: it is four operations, and the CPU rounds each to f32 individually so it runs the device's expansion step for step rather than accumulating in f64 and rounding once. The bump is `t * (1 - t)` on each axis, a parabola that is zero at both tile edges and so leaves no ridge where tiles meet — a falloff that did not vanish at the boundary would show the grid as a lattice of cracks.

**Tags:** `basics`, `fields`, `grid`, `composition`

**Seed:** 1056

**Node types:** `pointGrid`, `setAttribute`, `transformPoints`

**Primitives:** *(none)*

**Outputs:** `points` (from `checker`.`out`)

Cook it: `pcg cook graphs/basics-tiling-a-field.json --stats`

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

## basics-two-kinds-of-bounds.json

**two things called bounds, and they are not the same thing**

The word does double duty in this library and confusing the two costs an afternoon, so here they are in one graph.

`filterPrimitivesByBounds` is a WORLD box that SELECTS. It keeps or drops whole primitives by testing their vertices against [boundsMin, boundsMax], and it is one of only two filters here that PRESERVE TOPOLOGY — the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network filtered this way is still a network rather than a cloud that used to be one. Three params decide what 'in the box' means and they are read together. `vertex: "first"` tests exactly ONE vertex per primitive, which is what makes it an OWNERSHIP rule: every primitive has exactly one first vertex, so abutting boxes claim it exactly once between them and a partitioned cook can tile the world with no edge counted twice. `boundary: "halfOpen"` is the other half of that — min inclusive, max exclusive — so an edge lying exactly on a shared face belongs to one box, not both. A consequence worth seeing before it surprises you: only the FIRST vertex is tested, so an edge that starts inside and ends well outside survives WHOLE, and the filtered network overhangs its own box — about forty percent of the points left here sit outside [-12, 12]. That is the ownership rule working, not leaking: the box owns edges, not space. And `unreferencedPoints: "drop"`, used here, discards the points no surviving edge touches; the default 'keep' leaves the point domain completely untouched instead, same points in the same order, which is what anything holding a point index needs.

`setBounds` is a per-point LOCAL extent that DESCRIBES. It writes `boundsMin` and `boundsMax` on every point as that point's own axis-aligned size, in world units, and nothing filters on it — spawners and downstream nodes read it to know how much room the thing at that point takes up. Constants here for legibility, but the param is field-capable and that is where it earns its place: an extent derived from the point's own `scale`, or chosen by a species attribute, gives every instance the box it actually occupies instead of one box for the whole cloud. Note also what it does NOT check — min against max is not validated, the two corners are written independently, and a point whose corners cross is a point with an inside-out box.

So: one bounds is a question asked of the world, the other is an answer a point carries about itself. They share a name and a shape and nothing else.

**Tags:** `basics`, `bounds`, `filter`, `topology`

**Seed:** 1061

**Node types:** `connectPoints`, `filterPrimitivesByBounds`, `pointScatterInBounds`, `setBounds`

**Primitives:** *(none)*

**Outputs:** `network` (from `extent`.`out`)

Cook it: `pcg cook graphs/basics-two-kinds-of-bounds.json --stats`

## basics-under-cover.json

**measure what runs under cover, where the route passes close to itself**

`pathCoverage` casts REAL RAYS IN WORLD SPACE, and this graph is built out of the mistake that makes that necessary. The cheap way to ask how much of a route runs under cover is to project each piece of cover onto the route's arc length and add the windows up — and A BOUNDS PROJECTION ONTO A FOLDED CENTRELINE CANNOT TELL `above the path here` FROM `near the path twice`. Three such proxies gave 7.9%, 32.3% and 50.3% for one circuit, no two of them estimating the same quantity; the 32.3% was published and then withdrawn, because a single object near a hairpin had claimed 78 half-widths of lap for 6 half-widths of geometry. A SPIRAL IS THAT FAILURE MADE INTO A SHAPE: three turns out to a radius of 26, so every winding runs 8.7 units from the one inside it and a whole turn — a hundred units and more — from it along the path. Cover sits on the outermost winding only. The sample at (-21.5, 0, 1.7) has all six of its rays blocked; the sample at (-13.0, 0, 0.4) has none of them blocked, and neither does anything else on the inner coils — the largest hit count anywhere inside radius 19 is zero. Those two points are 8.6 apart in the world and 108.0 apart along the path. A path-relative window wide enough to reach the first would have swallowed the second. The rays cannot, because a fold is two different places in the world and one place in arc length.

THE MEASUREMENT CONVERGES, which is the property the three proxies lacked and the only reason to trust this one. 73 of the 311 evenly spaced samples are covered — 23.5% of the route — with the ceiling at 9; the same 23.5% with it at 18; the same at 40, because nothing else in this scene is overhead and raising the ceiling stops changing the answer. Halve the sample spacing and it is 23.7% over twice as many samples, so the figure is a property of the geometry rather than of how finely it was asked. But `far` IS LOAD-BEARING and has no unlimited setting: with an unbounded ray the sky is a tunnel and the answer is 100% everywhere, and set to 4 — below the canopy rather than above it — this graph reports nothing covered at all. Choose it for the scene, as the height at which something overhead has stopped being cover and started being scenery, and restate the number here rather than importing it from whatever placed the boxes: a figure whose whole value is that today's can be compared with yesterday's must not move when a placement rule is retuned.

WHAT IS MEASURED IS EXACTLY WHAT IS DRAWN, and `boxSize` is how. A box's world extent is `boxSize * scale` componentwise: `boxSize` is the asset's own extent in its local frame and `scale` is the per-point multiplier `spawnInstances` puts in the matrix. The canopy spawns as `panel`, whose placeholder geometry is 0.42 by 0.3 by 0.66 and is centred on its point — which is where this node puts the box — so `boxSize` is written as exactly that triple and `scale` carries the multiplier, and the slab a ray meets is the slab on screen. GETTING THIS WRONG IS SILENT IN BOTH DIRECTIONS. Leave `boxSize` at its default [1, 1, 1], which is the honest reading for a cloud of unit cubes and the wrong one for this cloud, and every box inflates by one over the asset's own extent: the cook finishes cleanly and reports 32.8%. Forget `scale` instead and the boxes shrink and it reports no cover anywhere. Neither throws, and each leaves a plausible wrong number behind. Worth noting that `occlusionCull` reads the same three columns and has NO `boxSize` — there `scale` alone is the world extent, so the two nodes want the same cloud described two different ways.

THE CANOPY TAPERS, from 5.11 world units across at the start of its run to 0.30 at the end, and that is what turns `minHits` from a threshold into a picture. Selecting it and sizing it are the same question asked twice of the same quantity, the coil's own radius: `filterByExpression` keeps the stations outside 21, and `remap` narrows the panel linearly from there out to 26. The fan is 6 rays over -1.5..+1.5 WITH BOTH EDGES INCLUDED, so they sit at ±0.3, ±0.9 and ±1.5 across the path — a panel narrower than 3.0 stops reaching the outer pair, narrower than 1.8 the middle pair, narrower than 0.6 the inner pair. The count therefore walks 6, 4, 2 and 0 down the run as the panels close: 45 samples at 6, 24 at 4, 26 at 2, 208 at 0, and eight caught between bands where the coil curves out from under a panel's centreline. `minHits` 3 — half the fan, the shipped meaning of `cover spans the corridor` — cuts between 4 and 2, so THE COVERED STRETCH ENDS WELL BEFORE THE CANOPY DOES: it stops where the cover stopped spanning, not where the cover stopped existing. Ask for `anything at all overhead` with `minHits` 1 and 33.1% is covered; ask for edge to edge with 6 and 14.5% is. The threshold IS the definition, which is why `hitsAttr` writes the raw count as well — a graph still choosing what it means can compare against several thresholds downstream without casting again, and the colour ramp here reads that column rather than the flag.

`spread` is HALF the fan's lateral span, and collapsing it to 0 is exactly the mistake `rayCount`'s own description names: one ray down the middle sees the span of a narrowing gantry and calls the whole thing a tunnel, and this graph duly reports 34.7% that way. `across` is perpendicular to both the cast direction and the path's own direction of travel, derived here from the route's POLYLINE TOPOLOGY — which is why an empty `acrossAttr` refuses a bare point cloud, and why the route reaches this node straight from `pathResample` rather than through anything that rebuilds the point domain. `near` at 1.2 is the floor that stops the road's own surface, and whatever lies on it, from counting as a roof over itself; nothing lies on this road, so it changes no answer here and is set for the reason rather than for the effect.

THIS NODE ADDS A COLUMN AND REMOVES NOTHING: the route goes in and the same route comes out — points, vertices, primitives, topology and every existing attribute — two columns wider. That is the opposite of the five point filters, which rebuild the point domain from the survivors and take the topology with them, so the order is MEASURE THEN FILTER. `sheltered` is a `filterByExpression` on the flag this node wrote, and it is a separate output so that the difference between measuring and cutting shows up in the counts: 311 points on the route against 73 in the cloud. The node is order-independent by construction — no point's answer depends on another's, no box's on another's, and nothing accumulates in floating point — and it is exactly cell-invariant under a partitioned cook given a halo of hypot(spread, max(|near|, |far|)) plus the largest box's bounding-sphere radius, about 12.6 units here.

THE PICTURE is the argument in one frame. Three coils; the outer one roofed by twenty-two panels that narrow as they go; that coil warm where the roof spans it, amber where it half spans it, cool where it has closed to a rib. The two coils inside — never more than nine units away, always a full turn behind — blue from end to end.

**Tags:** `basics`, `path`, `coverage`, `measure`, `rays`

**Seed:** 4127

**Node types:** `filterByExpression`, `pathCoverage`, `pathResample`, `pointsToPath`, `setAttribute`, `spawnInstances`, `subgraph`, `transformPoints`

**Primitives:** `place/along-curve`, `shape/spiral`

**Outputs:** `lap` (from `tint`.`out`), `sheltered` (from `sheltered`.`out`), `canopy` (from `canopy`.`instances`)

Cook it: `pcg cook graphs/basics-under-cover.json --stats`

## basics-volume-scatter.json

**fill a box with points, then carve it**

`volumeSample` is the library's only source that fills a volume with a REGULAR GRID — `pointScatterInBounds` fills a box too and `pointGrid` reaches into y, but neither puts one point in each cell of a requested size: each axis of the box is divided into max(1, floor(extent / cellSize)) whole cells and a point is placed at each cell centre, then jittered inside its own cell. `cellSize` is a REQUEST, not the cell you get — 28 units of extent at 1.4 gives exactly 20 cells because it divides evenly, while an extent that does not divide gives a LARGER cell (extent 20 at cellSize 12 is one 20-wide cell), and every axis has at least one cell however small the box. Bounds come from a connected geometry's P extents when one is wired and from `boundsMin`/`boundsMax` when none is, as here. JITTER IS A FIELD, and it is evaluated on the UN-JITTERED centres: 0 below y = 1, rising to 1 by y = 11, so one node emits an exact lattice at the floor and a fully random cloud at the ceiling with the dissolve in between. That gradient is the whole reason the param is field-capable — the alternative is two `volumeSample` nodes and a merge, which cannot interpolate between them. THE CARVE is `filterByDensity` in 'threshold' mode, which `basics-filter-by-density` describes but does not show, and its `threshold` is a field too: it rises from 0.32 at the floor to 0.86 at the ceiling, so the solid erodes upward and what survives tapers instead of ending in a flat lid. TWO THINGS THIS GRAPH LEARNED THE HARD WAY. A `normalized` fBm does NOT actually span [0, 1] — normalization maps its NOMINAL range, and the three octaves of summed gradient noise here only reach about the middle two fifths of it in practice — measured on this cook, 0.325 to 0.740. A threshold swept across the full [0, 1] against a raw normalized fBm therefore keeps everything at one end and nothing at the other, and the fix is the `clamp(remap(noise, 0.35, 0.68, 0, 1), 0, 1)` here, which stretches the range the noise really occupies onto the range the threshold really uses. And Perlin noise is identically ZERO on integer lattice coordinates, so a lattice of cell centres sampled at an integer frequency gives a dead attribute and a filter that keeps everything or nothing; `frequency: 0.055` keeps the samples off the lattice, `cellSize: 1` at `frequency: 1` would not. WHY THIS ONE SPAWNS. A dense 3D point cloud is unreadable as points — unlit dots on a regular lattice read as moiré rays rather than as a shape, and the structure this graph is about disappears into them. Instances are shaded geometry, so the ordered floor reads as packing and the dissolved ceiling as debris, and `scale` — ignored for a bare cloud — becomes the channel carrying `density` per box.

**Tags:** `basics`, `source`, `sampler`, `fields`, `filter`, `density`, `instancing`

**Seed:** 1055

**Node types:** `filterByDensity`, `setAttribute`, `spawnInstances`, `volumeSample`

**Primitives:** *(none)*

**Outputs:** `instances` (from `blocks`.`instances`)

Cook it: `pcg cook graphs/basics-volume-scatter.json --stats`

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

A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a `forEach`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. The wander is a plain `transformPoints`: the three numbers shaping it — how far it drifts up, how far sideways, and how fast — are `param` spec nodes carrying their own values inside its `translate` expression, and the editor reads each as a knob. It used to be a one-node subgraph, because a param could only be DECLARED on a wrapper, and the wrapper existed for nothing else. `wanderScale` is named twice in that one expression and is still one knob writing both — the case that made a wrapper look unavoidable. Everything that was drawn as a tube is a real surface now: `sweepProfile` skins the chords, the braces, the frames, the cables, the fringe and the swags, every one of which used to end at `pathSegments` with a unit cylinder landing on each segment — half the drawn triangles, because rings are shared between segments and no interior caps grow, and nine `extend` settings gone with them, because a continuous skin leaves no wedge at a bend to fill. The chains do NOT sweep, and that is the line between the two nodes: `pathSegments` still has a job of its own, one oriented asset per segment, and a chain of separate links is exactly that job — what it lost is the borrowed one, faking a tube. Four chords reach ONE sweep rather than four, because a sweep reads a geometry and a geometry holds as many polylines as you like: each strut arrives from `pathResample` already a polyline, `transformPoints` moves it without touching that topology, and `mergePrimitives` unions the four KEEPING it, so the sweep gets four paths in one geometry and the chord radius stays a single knob rather than one knob mirrored into four. Seven values this graph repeats are declared once at the top, under `params`. Six are numbers read by name from the expressions that need them: `trussHalfWidth` was TWENTY literals in four different float spellings of 0.425 — the chords at ± it, the braces and the component mounts at it × √2, eighteen of them here and two inside the cable body, which is why `pcg validate --params` counts nineteen readings on this graph rather than twenty: the eighteen plus the one wrapper slot that carries the value in — and `cableRadius` was three nodes that only the panel's `also` knew were one gauge of rope. A node-scoped param cannot say either of those, because the thing being said is that several nodes share one value. Four more say it about smaller things. `braceRadius` gangs the diagonal braces to the station frames, and it retired the last `also` row in the whole corpus: no fact about this graph's structure lives in a presentation file any more. `stretchMin` and `stretchMax` are the two ends of ONE draw that the component sizes write once per axis — `lerp(0.55, 1.6, randomField("stretch"))`, four times over, for the rod, the bar and the panel's two faces — where how far a component may stretch is a single decision and eight literals were spelling it. `bundles` is the fringe's 7, read twice inside one expression: `floor(u × 7)` bins each strand and the `/ 7` puts the bin back in [0, 1), so the two have to agree, and until the number had a name nothing said so. The seventh travels the other way. ELEVEN WRAPS ARE ONE CALL NOW. Every place this graph wrapped a value into a range spelled it `x - N * floor(x / N)`, four nodes deep, eleven times over; they are `mod(x, N)` since the grammar grew one. The graph is 133 lines shorter and cooks the SAME BYTES — checked, not assumed, because `mod` rounds each of its four operations to f32 exactly where the four separate nodes did, and a corpus-wide digest of every cooked column moved on none of the 63 graphs. Those eleven sites were also the demand signal: `PLAN-rig-gaps-3.md` recorded them and filed them under ergonomics, while the fields plan was measuring demand for `mod` by grepping for a different idiom and finding none. `tubeSides` is an `i32`, and no expression can ever carry one — a field resolves per element and only f32, vec3 and vec4 read one — so it declares `targets` and is WRITTEN into the `sides` slot of all six skins — five `sweepProfile` nodes and, through its wrapper, the sixth inside the cable body — rather than substituted into a field, which is how one name reaches the half of the format that counts, enums, booleans and attribute names live in. It is one decision because it is a BUDGET and not a dimension: cost is linear in it, six skins pay it at once, and nothing about a 0.03-radius brace wants a different roundness from the 0.055-radius chord standing next to it. The gauge params say the opposite about the very same nodes — `cableRadius` and `braceRadius` gang radii precisely because a radius legitimately differs from member to member — which is why `sides` is the only one of the six non-field literals every sweep repeats that earns a name. The other five stay written out, and that is a measurement rather than an oversight: `profile` means "a rope is round" at three sites and "the stock is round tube" at the other three, `caps` turns on whether a tube's ends are visible at all (the station frames are closed rings and have no ends, the braces bury theirs inside the chords), `frame` is invisible on a circular section — as are the field-capable `up` and `roll` written out beside it — and `joint` with its `miterLimit` is one pair rather than two decisions, neither of which moves: `miter` is simply the right answer at the two places this rig actually bends and indistinguishable from `perpendicular` everywhere else, and the limit is never reached, because the sharpest bend anywhere a sweep sees is the braces' zigzag at 100°, a stretch of 1.56 against a limit of 4, with the frame ring's square corner next at 1.41 and every resampled curve under 1.02. A shared name asserts that several slots must move together, and asserting that falsely is worse than the repetition. The sixth reading is inside the cable `forEach` body and gets there through a `sides` param on the wrapper, sitting next to `halfWidth` and working by the opposite mechanism: `halfWidth` declares NO targets and is read by the body's own expression, `sides` names one and is written into it. A body is bound by its wrapper either way and by nothing else, so ganging five of six would have left the cables at 8 while everything else moved. The three `writeCurveFrame` nodes repeat their three attribute names and KEEP them, now that a `string` param could reach them: `curveNormal` is named fourteen times here and only three of those are the writes — the other eleven are `attribute("curveNormal")` inside expressions, where no param can follow — and `sweepProfile`'s own `curveFrame` mode reads that attribute by that name in the library itself. The name is a shared vocabulary rather than this graph's to rename, so a knob over the three writers would only break the eleven readers. It used to tag every strut with a `strutId`, merge the POINTS, and rebuild the same four paths with `pointsToPath` — ten nodes spent throwing topology away and putting it back, because the topology-preserving union did not exist yet when this graph was written. The frames still regroup, and that contrast is the useful one: their rings connect the four chords ACROSS each station, topology that never existed anywhere upstream, so `pointsToPath` over `stationId` BUILDS something rather than restoring it — and the filter feeding it drops three points in four, which no union could have preserved. The chains and the fringe do not regroup at all any more, and that is the other half of the contrast: each strand is made a path BEFORE it is copied, and `copyToPoints` carries it across with `topology: "keep"` — the source's one polyline re-emitted per anchor, shifted onto that anchor's block of points. What that retires is not a node but a round trip. The copy no longer has to label its output with `targetIndexAttr` so that a rebuild can group on the label, and the fringe's swept surface stops carrying a dead `anchorId` on all 17,100 of its points; the path is built once over the strand itself — 35 points for a chain, 17 for a fringe strand — instead of over the 245 and the 1700 the copies make of them. The label was itself the second version of this problem: before `targetIndexAttr` the id was recovered arithmetically — `floor(index / 35)` for the chains and `floor(index / 17)` for the fringe — where the 35 and the 17 were the strand's point count written out a second time, in another node, with nothing holding the two together, so editing the strand welded every chain into one path and said nothing. A strand that is already a path cannot fall out of step with itself, which is the version that has no number in it at all. The swags are gated BEFORE the sweep now, which is where a gate has to sit once the thing downstream of it is a surface: `connectPoints` writes `edgeLength` on the primitive domain and the pick lands there too, so the gating is TWO `filterPrimitivesByAttribute` nodes cutting 456 chords to 360 and then to 62 while they are still polylines — the first drops every chord shorter than 4 units, the second keeps the roughly one in six the pick chose — and gating the segment cloud afterwards, which is what this graph used to do, meant building 7.35 times the geometry that survives. The components are proportioned by KIND rather than by one draw wearing four hats: one `byAttribute` reads the string `part` and hands back that kind's whole vec3, so a rod lengthens along the radius it points down, a bar along the chord it lies on, a panel widens on both of its faces while staying slab-thin, and a clamp is a squat collar rather than a cube. It was three nested `lerp`s over three `attributeIs` calls, written out once per AXIS — and `clamp` was in none of them, so it fell through all three to the uniform base scale and stayed there, because a fall-through nobody writes is a fall-through nobody can find. Its `default` is the same sentence made explicit: any part kind this expression does not name keeps the base scale, unstretched, and now says so. The kinds themselves are a WEIGHTING rather than a table with rows repeated to spell one: `values: ["rod", "bar", "panel", "clamp"]` with `weights: [4, 2, 1, 2]` and a `select` fraction, where nine rows used to carry the mix and a `mul(randomField, 9)` restated the table's own length beside them — append a fifth kind to that and the selector never reaches it, silently. The two spellings are byte-identical, because a whole-count weighting IS the repeated table. Three more numbers this graph used to restate are now read from the node that already knew them. `partScatter` jitters by half a STEP of the sampling above it: `partDense` publishes its step on the primitive domain, one `promoteAttribute` carries it onto the points before the cluster cut drops the topology, and the panel's scatter knob is that multiple rather than a distance — where the frozen 0.0189 it replaces was half a step of a 900-sample resample of a NOMINALLY 34-unit spine whose true arc length is 34.213, and so 0.05 of a step at the density knob's bottom and 1.10 of one at its top, invisible at one end and crossing its neighbours at the other. The carrier line states its SPACING instead of its far end, which is what stops the wraps knob from redrawing the cables it is not adding: the `15` in `end` was `count - 1`, and a `forEach` item key is content-derived, so 16 → 17 re-spaced the line and re-seeded every body — 1 of the 16 cables came back unchanged, against 16 of 16 now. `chainAlternate` reads the per-path `linkIndex` that `pathSegments` writes, not the global point index it used to: the two agree only while every chain has an even number of segments, and at `chainStrand.count` 36 the chains disagreed with each other — two distinct first-link orientations with nothing to report it, one at both 35 and 36 now. Eight declared outputs, one per part, plus the bare spine, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — and the noises with it: all eight fbm fields take their seed from the node, `{ "from": "node", "variant": … }` rather than a literal, so the spine takes a different wander and the clusters a different shape instead of the same frozen field being walked over by points that moved. The six outside the cable body each carry their `variant` as an inline `param` of their own, so ONE noise can be re-rolled while the rest hold still — a node has a single seed, and the variant is what picks which draw off it. That is also what keeps the pairs apart: the spine's two wanders sit on one node and the fringe's two curls on another, so within each pair variant 0 and variant 1 are what make them independent draws, where a literal seed used to do it. The last two are the cable wobble, inside the `forEach` body, and they were held back as the deliberate exception — the body's seed varies per item, so its wobble was said to re-roll already. That was true of the sample WINDOW and false of the FIELD. Freeze the four per-carrier picks and cook: on the old literal seed the sixteen cables come back as ONE geometry, on the node seed as sixteen. A body node's seed is hashed with the item's own key, so `{ "from": "node" }` there means per-cable, and what it replaced was a fourth pick — `wofs`, transferred onto the wrap and multiplied by 1000 — whose whole job was to walk one frozen field far enough sideways that no two cables sampled the same place. That pick and its transfer are gone with it: the body is eight nodes where it was ten. Variants 0 and 1 keep the wobble's two components apart, the one riding the curve normal and the one riding the binormal, which a single literal seed had collapsed into the same number twice.

**Tags:** `examples`, `curves`, `foreach`, `surface`, `instancing`, `rig`

**Seed:** 3

**Node types:** `connectPoints`, `copyToPoints`, `filterByAttribute`, `filterByDensity`, `filterPrimitivesByAttribute`, `forEach`, `jitterPoints`, `mergePrimitives`, `orientAlongVector`, `partitionByAttribute`, `pathPointAt`, `pathResample`, `pathSegments`, `pointLine`, `pointsToPath`, `promoteAttribute`, `setAttribute`, `spawnInstances`, `sweepProfile`, `transferAttribute`, `transformPoints`, `writeCurveFrame`

**Primitives:** *(none)*

**Outputs:** `truss` (from `trussChordSkin`.`out`), `braces` (from `trussBraceSkin`.`out`), `frames` (from `trussFrameSkin`.`out`), `parts` (from `partPartSpawn`.`instances`), `wraps` (from `wrapWraps`.`out`), `chains` (from `chainSpawn`.`instances`), `danglers` (from `danglerDanglerSkin`.`out`), `drapes` (from `drapeDrapeSkin`.`out`), `spinePoints` (from `spineSpine`.`out`)

Cook it: `pcg cook graphs/examples-rig.json --stats`

## examples-riverbank.json

**Riverbank**

Distance to a FEATURE as the thing that shapes everything else, which several graphs use in passing and none is named for. A straight line of points is pushed sideways by a noise and pathed into a river, `splineSample` walks it at even spacing, and `sampleNearestPoint` writes each ground point's distance to the nearest of those samples into `riverDist` — one attribute that then drives three separate decisions: `filterByExpression` thins the trees near the water, their `scale` rises with it, and the driftwood is placed on the river's own samples rather than on the ground at all, pushed to the bank along the curve normal and turned to the `tangent` that `splineSample` already wrote. Measured across three equal-area distance bands, tree counts run 163, 256, 289 outward and mean scale 0.53, 0.81, 1.03, 1.22 — the falloff is in the numbers, not only in the picture. IT WAS AUTHORED BY AN AGENT THAT COULD NOT READ THIS REPOSITORY, and that is why it is here. Given only `pcg nodes`, `pcg fields`, `pcg validate` and `pcg inspect` — no source, no docs, no other graph, not even for the file format — it reverse-engineered the format in eight `validate` probes and reached a clean cook on its second write. What it could NOT learn from the catalog is what got fixed because of it: the field catalog published type signatures with no semantics, the noise output ranges the library already knew were never printed, and nothing warned that gradient noise is exactly zero on the integer lattice. The hand-rolled perpendicular it wrote in `driftToBank` — nine nested objects deep, because the grammar had no `cross` — is what put `cross` in the grammar, and `driftToBank` now reads as the single call it always meant. Byte-identical output, checked against a control that moves when the operands are swapped: the graph is unchanged and only its spelling of the idea got shorter. THE FOUR ASSET IDS IT INVENTED were the other thing it could not discover: `tree_pine`, `tree_birch`, `tree_willow` and `driftwood_log` cooked, validated and reported their instance counts while rendering as anonymous stand-ins, because an asset id is a free string and nothing checked it. They are the shared vocabulary's `pine`, `birch`, `willow` and `log` now, and `pcg assets <graph.json>` is what makes that checkable rather than a thing you notice in a picture.

**Tags:** `river`, `scatter`, `distance-falloff`, `path`, `spawn`

**Seed:** 20260816

**Node types:** `filterByExpression`, `meshPrimitive`, `orientAlongVector`, `pointLine`, `pointScatterInBounds`, `pointsToPath`, `sampleNearestPoint`, `selfPrune`, `setAttribute`, `spawnInstances`, `splineSample`

**Primitives:** *(none)*

**Outputs:** `trees` (from `trees`.`instances`), `driftwood` (from `driftwood`.`instances`), `river` (from `riverPath`.`out`), `ground` (from `ground`.`out`)

Cook it: `pcg cook graphs/examples-riverbank.json --stats`

## examples-streamed-terrain.json

**one cell of a streamed world, halo and all**

The corpus graph a `World` can BIND, not just cook: every per-cell quantity is an ordinary top-level node param, so `bindPatches` reaches it as plain JSON and the level can cook on a worker. Its defaults are not a picture, they are the RECTANGLE OF ONE CELL: cell [0, 0] of a 64-unit level, which is [0, 64) on both axes, queried with the 4-unit halo it needs (the scatter window runs -4 to 68) and clipped back to what it owns. Note where that box is NOT — a cell is always [c*size, (c+1)*size), so no cell is ever centred on the origin, and a graph whose default box straddles it is quietly claiming to be a window rather than a cell. What a bind still supplies is the SEEDS: standalone they are the literals below, while a World writes ctx.worldSeed and salts of it, so the standalone cook shows this cell's geometry and mechanism rather than any particular world's bytes. Four seam hazards are wired on purpose. (1) The source is `pointScatterInWorld` — `basics-scatter-in-world` teaches it alone — whose lattice is a function of its own `seed` and never of the graph seed, so bind hands it a cell-INVARIANT `ctx.worldSeed` and varies only `boundsMin`/`boundsMax`. (2) The density noise carries a LITERAL `seed` inside its spec instead of `{ "from": "node", "variant": 0 }`, because a nodeSeed-folded noise 'samples a different region in every cell, so it must not feed anything that has to agree across a seam' (src/nodes/attributes.ts) — which is exactly what `basics-reseed-a-noise` wires up, and exactly what a level graph must not. (3) `pointNeighborhood` is the ONE-HOP rung: exact at a halo of `radius` and at no smaller width, so bind widens the scatter window by exactly 4 units and by nothing more. (4) `filterByBounds` at its default half-open boundary is the OWNERSHIP rule, bound from the UNWIDENED cell, because 'the exactness comes from the two cells sharing an endpoint value' — 'compare against the box, not against a recomputed index', since `floor(67.8 / 0.1)` is 677 while `678 * 0.1` is exactly 67.8 (docs/authoring.md). Its Y bounds are a finite +/-1e6 rather than infinities, which do not survive JSON and cannot be patched, and which an 'xz' World column does not bound anyway. `filterByDensity` and the `randomField` inside `size` both draw on their node seed, which the GRAPH seed does reach, so a per-cell `graph.setSeed` (or a `bindPatches` `seed`) would move them and 'the halo and the neighbour disagree, deterministically and silently' (src/runtime/types.ts); bind seeds them cell-invariantly and never reseeds the graph. The second output, `populationRank`, is the counter-example kept deliberately: a `fraction` field measures the population present in THIS cook, which under a World means the population HERE, so it is the unbounded rung no halo width can repair and the one thing in this graph a partitioned cook is not allowed to agree about.

**Tags:** `examples`, `world`, `streaming`, `halo`, `determinism`

**Seed:** 20260816

**Node types:** `filterByBounds`, `filterByDensity`, `pointNeighborhood`, `pointScatterInWorld`, `setAttribute`

**Primitives:** *(none)*

**Outputs:** `points` (from `size`.`out`), `populationRank` (from `rank`.`out`)

Cook it: `pcg cook graphs/examples-streamed-terrain.json --stats`

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
