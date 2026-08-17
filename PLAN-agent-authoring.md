# Friction log — authoring `graphs/examples-riverbank.json` from the CLI alone

Rules I am playing under: only `node bin/pcg.mjs <cmd>`; I may not read any repo file
except my own graph. Everything below is written as it happened.

Target outcome (given to me, no node names):
> A river runs through open ground. Trees grow on the ground but thin out as they
> approach the water, and the ones nearest the river are smaller. Driftwood lies
> along the bank itself, following the river's course.

---

## 0. First contact

```
$ node bin/pcg.mjs --help
```

Good: the help ends with an explicit workflow line —
`The loop: pcg validate g.json && pcg cook g.json --stats && pcg inspect g.json --node <id>`
That is the single most useful sentence in the whole tool for an agent. It tells me
the iteration cycle before I know anything else.

Immediate open question the top-level help does NOT answer: **what does a graph file
look like?** `validate` says "Deserialize a graph file", `cook` says "Cook every
declared output" — "declared output" is a term of art I have to reverse-engineer.
Nothing on this screen hints at the JSON shape. Noting this as the first thing I
must discover indirectly.

---

## 1. Discovering the file format with nothing but `validate`

`validate --help` leaks exactly one fact: `graph.json  path to a serialized graph
(formatVersion 1)`. That is the whole documented surface of the format. So I bisected
the schema by feeding `validate` deliberately broken files and reading the errors.

**This worked, and it worked well.** Eight probes, start to finish:

```
$ printf '{}' > probe.json ; node bin/pcg.mjs validate probe.json
unsupported formatVersion undefined; this build reads formatVersion 1

$ ... '{"formatVersion":1}'
graph seed must be a finite number, got undefined

$ ... '{"formatVersion":1,"seed":1}'
"nodes" must be an array

$ ... '{"formatVersion":1,"seed":1,"nodes":[{}]}'
nodes[0]: node id must be a non-empty string, got undefined

$ ... 'nodes:[{"id":"a"}]'
node "a": type must be a string, got undefined

$ ... 'outputs:["a"]'
outputs[0]: expected an output object, got "a"

$ ... 'outputs:[{"name":"pts"}]'
outputs[0]: expected { id, pin, name } strings, got {"name":"pts"}

$ ... 'connections:[{"from":"a","to":"b"}]'
connections[0].from: expected [nodeId, pinName], got "a"
```

**EXCELLENT — call this out loudly.** Every one of those errors names the offending
path (`nodes[0]`, `node "a"`, `connections[0].from`), states the expected shape
*positively* (`expected { id, pin, name } strings`, `expected [nodeId, pinName]`),
and echoes what it actually got. Two of them — the outputs one and the connections
one — are effectively the schema written out. I reconstructed the entire format
without a single guess that took more than one attempt.

FRICTION (small but real): the validator **stops at the first error**. Each probe
cost a full round trip because I could only learn one field per run. Seven runs to
learn a five-key schema. A `validate` that reported all structural problems at once,
or a `pcg format`/`pcg nodes --schema` that just *printed* the envelope, would have
collapsed this to one command. This is the single most mechanical part of the whole
exercise and it is the part the tool helps with least *proactively* — it helps
brilliantly but only reactively, and only if you think to attack it this way.

FRICTION (naming): `params` was never named by any error. I guessed it from the
catalog's use of the word "param" and it happened to be right first try. Had I
guessed `parameters` or `props` I would have gotten **no error at all** — an unknown
top-level key on a node is silently ignored, so a typo'd `params` block produces a
graph that validates, cooks, and silently uses every default. That is the one place
in the format where the tool will let me be wrong quietly. Verified later, see §6.

Working envelope:

```json
{ "formatVersion": 1, "seed": 1,
  "nodes":       [ { "id": "a", "type": "pointScatterInBounds", "params": { "count": 5 } } ],
  "connections": [ { "from": ["a","out"], "to": ["b","in"] } ],
  "outputs":     [ { "id": "b", "pin": "out", "name": "pts" } ] }
```

`cook --stats` on that printed the full attribute list of the result
(`P(f32x3), rot(f32x4), scale(f32x3), density(f32), boundsMin, boundsMax, color(f32x4), seed(u32)`)
— which told me the standard attribute vocabulary without my having to ask. Good.

---

## 2. Finding the nodes for the scene (the catalog at its best)

`pcg nodes` printed 46 types grouped by category with a one-line-ish description each.
Reading it once was enough to build the whole plan. Two hits I want to record because
they are the difference between this exercise working and not:

**`sampleNearestPoint` names my exact problem in its own description:**

```
$ node bin/pcg.mjs nodes sampleNearestPoint
This is the node that answers HOW FAR — transferAttribute's 'nearest' mapping copies
a value but never reveals the distance, so banding by proximity to a road, A RIVER or
a set of landmarks needs this one.
```

That is the single best line in the catalog. It disambiguates itself against its
nearest neighbour (`transferAttribute`) *and* states the use case I actually had. I
did not have to guess.

**`pointsToPath` tells me the one thing I would otherwise have learned by failing:**

```
Downstream: any node that can REMOVE points drops topology — filterByDensity,
filterByBounds, filterByAttribute, filterByExpression, selfPrune, partitionByAttribute
— and so does mergePoints, so a path that passes through one stops being a path; put
this node after them, not before. Category is not the rule: projectToPlane is
categorised `filter` but preserves topology, and filterByAttribute drops it even when
its predicate keeps every point.
```

It enumerates the offenders by name and explicitly warns that the *category* is not a
reliable guide. That saved me a cook-fail cycle: my driftwood chain filters a sampled
curve, and I would have put the filter on the wrong side of the path.

**`filterByExpression` documents the combinator idiom** I would otherwise have gone
looking for a node for: *"combining them with mul acts as AND, max as OR"*. There is
no `and`/`or` in the field catalog and I went looking for one; this sentence is where
I found the answer, in a node doc rather than in the field catalog where I looked
first. Right answer, wrong place.

---

## 3. THE BIG ONE: `pcg fields <fn>` has signatures and no semantics

This is the worst friction in the whole exercise, by a wide margin. `pcg nodes <type>`
gives me a typed table with defaults, ranges, enums, a field-capable flag and a
paragraph of prose per param. `pcg fields <fn>` gives me this:

```
$ node bin/pcg.mjs fields select
select
keys:  args
usage: { fn: "select", args: [arg0, arg1, arg2] }

$ node bin/pcg.mjs fields ramp
ramp
keys:  args, stops
usage: { fn: "ramp", args: [scalarField], stops: [[0, 0], [1, 1]] }

$ node bin/pcg.mjs fields randomField
randomField
keys:  key
usage: { fn: "randomField", key?: 0 | "salt" }

$ node bin/pcg.mjs fields clamp
clamp
keys:  args
usage: { fn: "clamp", args: [arg0, arg1, arg2] }
```

`--json` adds nothing — it is the same three fields (`fn`, `keys`, `usage`) verbatim.
So, concretely, things I could NOT discover from the tool and had to determine by
experiment:

- **`select`**: `arg0, arg1, arg2` are unnamed. Is it `(cond, ifTrue, ifFalse)`, or
  `(a, b, t)` like a step/lerp? The names carry zero information.
- **`randomField`**: what RANGE? `[0,1)`? `[-1,1)`? A hash of unknown scale? The
  entire thinning design depends on this and the catalog does not say. Also: what is
  `key` FOR? I inferred "salt so two randomFields in one graph differ" purely from
  the placeholder string `"salt"`.
- **`clamp`**: `(x, min, max)` or `(min, max, x)`? Unnamed.
- **`remap`**: FIVE unnamed args. `{ fn: "remap", args: [arg0, arg1, arg2, arg3, arg4] }`
  is not a signature, it is a length.
- **`ramp`**: are `stops` `[input, output]` pairs or `[position, value]` normalized to
  0..1? What happens OUTSIDE the first/last stop — clamp, or extrapolate? Not stated.
- **`perlinNoise`**: what is the output RANGE (this decides every multiplier I write),
  what does `normalized` do, what is `frequency`'s default, and what does `position`
  accept? Every one of those is a bare `?` in the usage string.
- **`fraction`, `index`, `nodeSeed`**: `{ fn: "fraction" }` and nothing else. Fraction
  *of what*? I still do not know and did not use it.

I could not look at the source, so I built a probe graph that writes six fields into
six attributes on an 8-point line and read them back:

```
$ node bin/pcg.mjs inspect probe-fields.json --rows 8
    #  P          ...  rnd       sel  rmp  clp  rem        pnz
    0  [0, 0, 0]       0.340114  200  0    2    10         0
    3  [3, 0, 0]       0.28697   200  30   3    14.285714  0.222923
    4  [4, 0, 0]       0.154926  100  40   4    15.714286  0.153841
    7  [7, 0, 0]       0.833473  100  70   5    20         -0.378436
    rnd  f32  1  0.154926  0.833473  0.470074
    pnz  f32  1  -0.378436  0.222923  0
```

Answers, all confirmed in ONE probe run (my guesses happened to be right, but they
were guesses):
- `randomField` → uniform `[0,1)`.
- `select(cond, ifTrue, ifFalse)` — x>3.5 gave 100 (arg1), else 200 (arg2).
- `ramp` stops are `[input, output]`, linearly interpolated.
- `clamp(x, min, max)`.
- `remap(x, inMin, inMax, outMin, outMax)`.
- `perlinNoise` is SIGNED and centred on 0 (and exactly 0 at lattice points).

That probe took me about fifteen minutes to construct and it should not have had to
exist. **The fix is one line of the same prose `pcg nodes` already carries, per field
fn, plus real argument names instead of `arg0..arg4`.** The node catalog proves the
project knows how to write this; the field catalog just doesn't have it. Given that
"a graph can be authored from the catalog alone" is the claim, and that field
expressions are where all the *interesting* authoring happens, this is the gap that
most directly contradicts the pillar.

---

## 4. A CORRECTION to §1 — I was wrong, and the tool is better than I said

In §1 I asserted that a misspelled `params` block would be silently ignored. I went
back and tested it rather than leaving the claim standing:

```
$ ... 'nodes:[{"id":"a","type":"pointScatterInBounds","parameters":{"count":5}}]'
$ node bin/pcg.mjs validate typo.json
node "a": unknown key "parameters"; valid keys: id, type, params, subgraph, ref. The
format is closed — an unrecognized key is a typo, not an extension, so a future field
arrives with a formatVersion bump. There is no annotation key: descriptive text
belongs in the graph's "meta" block ({ title, description, tags })
```

That is one of the best error messages I have ever been handed by a tool. It (a)
names the bad key, (b) enumerates every valid one — including `subgraph` and `ref`,
which I did not know existed, (c) states the *design rule* so I stop trying variants,
and (d) anticipates the follow-up question ("where do I put a comment?") and answers
it with a `meta` block I had no other way to discover. I added `meta` to my graph on
the strength of this error message alone. **A `params` typo is caught, loudly, with
the whole schema attached.** Strike the §1 complaint.

---

## 5. Building the graph: attempts from first write to first clean cook

**Two.** That is the honest count, and it is a good number.

- **Attempt 1** — 17 nodes written blind from the catalog. One failure:
  ```
  node "treeSpacing": unknown param "distance" for type "selfPrune";
  valid params: mode, minDistance, priority, topology
  ```
  My fault (I guessed `distance` without running `pcg nodes selfPrune`), and the error
  fixed it for me by listing the four valid names. One-word edit.
- **Attempt 2** — `validate` ok, and `cook` was clean on the FIRST try: 17 nodes,
  1484 tree instances in 3 asset batches, 26 driftwood, one river polyline. Zero
  runtime errors on a 17-node graph written without reading a line of source.

That is the strongest single result in this experiment. The pillar mostly holds: the
*structure* of a graph is authorable from the catalog alone.

Everything after attempt 2 was **tuning**, not fixing — and tuning is where the real
friction lives.

---

## 6. Tuning friction: the numbers the catalog cannot give you

### 6a. Noise amplitude — the river came out nearly straight

The first clean cook produced a river whose Z extent was `0.001677 .. 16.916771` on a
150-unit-wide ground. Effectively a straight line down one side. I had written
`perlinNoise{frequency:0.009} * 64` expecting roughly plus/minus 60 units of meander.

`pcg fields perlinNoise` gives me `opts?: { seed?, frequency?, offset?, position?,
normalized? }` and no output range at all, so I had no way to size that multiplier
except by running it. I probed 300 points along the same line with six noise configs:

```
$ node bin/pcg.mjs inspect probe-noise.json --rows 0
    attr        min        max       mean
    n_f009      0          0.222925  0.118438     <- perlin, freq .009, NO offset
    n_f009_off  -0.2085    0.193236  0.009869     <- same, offset [0,10.37,4.61]
    n_f03       -0.277996  0.229592  -0.004569
    n_norm      0.361002   0.614796  0.497716     <- same but normalized:true
    n_simp      -0.825978  0.354099  -0.169216    <- simplexNoise, freq .02
    n_fbm       -0.045305  0.396103  0.148583     <- fbm perlin, 3 octaves
```

Three findings the tool never told me, each of which cost a probe:

1. **Perlin's practical amplitude here is about +/-0.25, not +/-1.** Every multiplier
   an author writes is off by ~4x on the first try. One sentence in the catalog
   ("output is roughly [-0.5, 0.5]; `normalized` maps to [0,1]") fixes this forever.
2. **`normalized: true` maps to [0,1]** — I had to guess that from the word. Confirmed
   by the probe (0.36..0.61), never stated.
3. **Sampling along a lattice-aligned line through the origin is degenerate.**
   `n_f009` with no offset never goes negative — `0 .. 0.22`. That was the actual
   cause of my straight river: my line lay exactly on `y=0, z=0`. Adding
   `offset: [0, 10.37, 4.61]` restored the full signed range. Nothing in
   `offset?: [x,y,z]` hints that this matters, and it is a trap *specific to authoring
   a curve from a straight line*, which is the most obvious thing you would do.

Fix: switched to `simplexNoise` (wider range) with an off-lattice offset, and
retuned the multiplier by inspecting bounds twice (72 -> 46). Final river Z extent
`-41.3 .. 14.7`, which reads as a river.

### 6b. There is no `cross`, so a perpendicular has to be hand-rolled

Driftwood must sit on the *bank*, i.e. offset perpendicular to the river's course.
`splineSample` helpfully writes a unit `tangent`, but the field catalog has
`dot`, `length`, `normalize` and **no `cross`**. I looked for it, twice.

I had to hand-build the 2D normal, which only works because my river is flat:

```json
{ "fn": "vec", "args": [
    { "fn": "mul", "args": [ {"fn":"component","args":[{"fn":"attribute","name":"tangent","tupleSize":3}],"index":2}, -1 ] },
    0,
    {"fn":"component","args":[{"fn":"attribute","name":"tangent","tupleSize":3}],"index":0} ] }
```

Nine nested objects to express `perp = (-t.z, 0, t.x)`. It works — the driftwood
lands 3.2 to 5.8 units off the centreline on alternating sides — but a `cross` fn
would have made it one line. (`writeCurveFrame` exists and writes exactly the
`curveNormal` I wanted, but it writes onto a *path's* points; `splineSample` then
resamples and I could not tell from the catalog whether the frame survives, so I did
not risk it. That uncertainty is itself the finding: two nodes that obviously want to
compose, and neither doc says whether they do.)

### 6c. "Distance to a curve" does not exist; you approximate it

`sampleNearestPoint` measures distance to a *point cloud*, not to a curve. So the
river had to be densified (`splineSample` at spacing 1.2) purely to serve as a
distance source. That works, but the resulting `riverDist` is up to ~0.6 units wrong
near the sample midpoints, and **nothing in either doc tells you that** — you have to
notice that you have turned a continuous curve into a discrete proxy and pick the
spacing yourself. I would have liked `sampleNearestPoint` to accept a path input, or
a `distanceToPath` field.

### 6d. No `and` / `or` / `not`, and the answer is in the wrong catalog

I wanted `AND` to combine "far enough from the water" with "passes the thinning
roll". The field catalog has no boolean combinators. The answer turned out to be in
`pcg nodes filterByExpression`: *"combining them with mul acts as AND, max as OR"*.
Correct, and well put — but it is documented on ONE node, and it is a property of the
*field language*, not of that node. An author reaching for it from `setAttribute` or
`orientAlongVector` will never find it.

Also absent and looked for: `pow`, `sqrt`, `exp`, `mod`, `smoothstep`, `step`.
`length` exists but `sqrt` does not, which is an odd place to draw the line. I wanted
`pow` for a falloff exponent and used a three-stop `ramp` instead — arguably better
authoring, but it was a workaround, not a choice.

---

## 7. The thing I could not discover AT ALL

**What asset ids exist.** `spawnInstances.assetId` says:

```
Asset id stamped on every instance not overridden per point via assetAttr. The
renderer resolves it to an actual renderable (e.g. the three adapter's asset map).
```

There is no `pcg assets`, no `--list-assets`, nothing in `pcg nodes`, nothing in
`pcg --help`. So `"tree_pine"`, `"tree_birch"`, `"tree_willow"` and `"driftwood_log"`
are strings I invented. The graph cooks perfectly and reports
`tree_birch x440, tree_pine x697, tree_willow x288` — and for all the CLI can tell me,
every one of those may resolve to nothing when a renderer opens the file. The one
part of this scene I cannot verify from the tool is whether anything will be
*visible*. For a library whose pitch is "an agent can author a graph from the catalog
alone", the terminal node of every scene takes an unvalidated magic string. This is
the single thing I most wanted and did not get.

(Related, smaller: `pcg render` draws points and polylines top-down, which is a real
verification aid — but I cannot see an SVG from a terminal, so it verified nothing
for me. `render --json` giving me `points / primitives / instances / bounds` counts
is what I actually used, and that was genuinely useful. Its failure message was good
too: `item 2 has no attribute "riverDist" to color by on the point or the primitive
domain; item 2 point attributes: P, rot, scale, ...` — it listed what I could have
used instead.)

---

## 8. Verifying the OUTCOME, not just the cook

A clean cook proves nothing about whether trees actually thin toward the water. I
built four scratch copies of my own graph with a band filter appended
(`riverDist` in [4.5,15), [15,25), [25,35), [35,45)) and read the counts back:

```
band0  trees= 163  scaleMean=0.526  riverDistMean=10.7
band1  trees= 256  scaleMean=0.811  riverDistMean=20.0
band2  trees= 289  scaleMean=1.029  riverDistMean=29.8
band3  trees= 255  scaleMean=1.221  riverDistMean=39.9
```

Equal-width bands around a curve have roughly equal area, so those counts are
densities: 163 -> 256 -> 289 near-to-far (band3 dips only because it runs off the
ground's edge). Mean scale climbs monotonically 0.53 -> 1.22. The brief is satisfied
and I can *prove* it numerically. Minimum `riverDist` over all trees is 4.52, so the
water itself is clear of trees.

**`pcg inspect` is the best thing in this toolchain.** Per-attribute min/max/mean plus
N sample rows plus a `non-finite` column, on any node's pin, without editing the
graph's outputs (`--node`/`--pin`). It is what let me determine field semantics
empirically in §3, size the noise in §6a, and prove the outcome here. All three would
have been impossible with `cook` alone.

Determinism, checked because the README claims it and I could not read the README:

```
$ node bin/pcg.mjs cook graphs/examples-riverbank.json --json   (x2, timings stripped)
c74ced4fa83f91a8
c74ced4fa83f91a8
```

Byte-identical. Small note: **the raw `--json` report is NOT byte-stable** because it
embeds `elapsedMs`, so an agent diffing two reports gets a false positive — my first
two hashes differed (`1b7860cb...` vs `48a4d3c2...`) and for a moment I thought
determinism was broken. I had to strip timings to make the check work. A flag that
omitted or zeroed timings would make "did anything change?" a one-liner.

---

## 9. A documented gotcha the catalog got RIGHT, and half-fixed

`--seed 99` re-rolls the tree scatter and the driftwood thinning, but the **river does
not move**:

```
$ node bin/pcg.mjs inspect graphs/examples-riverbank.json --output river --seed 99
bounds -78,0,-41.317707 .. 78,0,14.687435     <- identical to seed 20260816
```

I was not surprised, because `pcg nodes setAttribute` had already told me exactly why:

> This re-rolls randomness drawn from the EVALUATION CONTEXT — randomField, and the
> per-point seed attribute — but a noise only if it ASKS: a noise field carries its
> own seed inside its spec, so `valueNoise`, `perlinNoise`, `simplexNoise`,
> `worleyNoise` and `fbm` are unaffected here unless their `opts.position` reads the
> seed through the `nodeSeed` field.

That paragraph is a model of what a param doc should be: it predicts the surprise,
explains the mechanism, and names the remedy.

**But I cannot act on the remedy from the tool.** It says to read the seed through
`nodeSeed` in `opts.position`. The field catalog's entire entry for that is:

```
$ node bin/pcg.mjs fields nodeSeed
nodeSeed
keys:  (none besides fn)
usage: { fn: "nodeSeed" }
```

and for the noise `opts`, `position?` has no type, no example, and no statement of
what a position field must evaluate to. So the doc that warns me hands me off to a
doc that cannot teach me the spelling. I left the river seeded literally rather than
guess. This is §3 biting again from the other direction, and it is the clearest
single argument that the field catalog is the weak link.

---

## 10. Summary scoreboard

**Excellent, specifically:**
- `validate`'s error messages. Positive, path-qualified, schema-attached. The
  `unknown key "parameters"` message is worth copying into other projects.
- `pcg nodes <type>` prose. `sampleNearestPoint` naming "a river" as its use case;
  `pointsToPath` enumerating the six nodes that destroy topology and warning that
  category is not the rule; `setAttribute`'s seed paragraph in §9.
- `pcg inspect` with `--node` / `--pin` / `--rows`. The whole experiment ran on it.
- The `field` column in the params table — the one place that tells you *where* a
  field expression is even legal. Without it I would have had to guess per param.
- The `The loop:` line in the root help.

**Worst friction, ranked:**
1. `pcg fields <fn>` is signatures without semantics — `args: [arg0..arg4]`, no
   ranges, no argument names, no prose, `--json` no richer. Everything interesting is
   authored in fields.
2. No asset-id catalog anywhere; the terminal node of every scene takes an
   unverifiable magic string.
3. Noise has no documented output range, and axis-aligned sampling through the origin
   is silently degenerate.
4. No `cross` (and no `pow`/`sqrt`/`step`); no boolean combinators, whose idiom is
   documented on one unrelated node.
5. No "distance to a curve" — you densify a path by hand and never learn what error
   you introduced.
6. The graph envelope has to be reverse-engineered one `validate` failure at a time;
   `validate` stops at the first error.

**Guesses that cost more than one attempt:** one (`selfPrune.distance` ->
`minDistance`, and only because I skipped a `pcg nodes` call I should have made).
Everything else that cost me was a *number*, not a *name* — which says the catalog's
naming layer is strong and its quantitative layer is thin.

---

## 11. Final state

```
$ node bin/pcg.mjs validate graphs/examples-riverbank.json   -> exit 0
$ node bin/pcg.mjs cook     graphs/examples-riverbank.json   -> exit 0, 18 cooked, 48 ms
outputs:
  trees      1425 instances in 3 batches — tree_birch x440, tree_pine x697, tree_willow x288
  driftwood    77 instances in 1 batch  — driftwood_log x77
  river      48 points, 1 polyline primitive, bounds -78,0,-41.3 .. 78,0,14.7
  ground     625 points, 1152 triangles, bounds -75,0,-75 .. 75,0,75
```

18 nodes, 16 connections, 4 declared outputs. No repo file other than the graph was
opened at any point.


