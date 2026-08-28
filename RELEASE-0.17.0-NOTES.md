# pcg-ts 0.17.0 — release notes (DRAFT)

> Scratch draft for editing before publish. Everything below was checked
> against source rather than against a summary; where a claim is narrower
> than it might read, the narrowing is stated inline rather than left for
> a reader to discover.

The headline is the **per-instance attribute channel**: a graph can now
hand its host any point attribute as a named per-instance column, not
just transforms and RGB. Everything else in this release is either the
plumbing that carries it (worker wire format, packaging, a three-side
binder) or unrelated node work that landed alongside it.

---

## The per-instance attribute channel

`spawnInstances` gains **`instanceAttrs`** (`stringList`, default `[]`):
point attribute names, carried across the spawner in the order given.
Each becomes `batch.attributes[<the attribute's own name>]` — no
renaming, so the name an author wrote upstream is the string a shader
binds.

The reason it has to exist: the field grammar has no time input, on
purpose. A graph settles STRUCTURE and the host animates it, so anything
the host must drive per instance at runtime — a phase offset, a stable
id, a species index, an RGBA tint, a wind stiffness — has to leave the
graph as data. Before this, only transforms and RGB could cross, and a
host had to re-derive the rest from a position, which stopped agreeing
with the graph that authored it the first time either side changed.

**Dtype is preserved, never widened to f32.** A column is the attribute
storage's own array class (`Float32Array` / `Int32Array` / `Uint32Array`
/ `Uint8Array` for `bool`). f32 has a 24-bit mantissa, so a `u32` id past
2^24 would land on its neighbour and two instances would become one to a
host keying on it.

**`itemSize` is derived, not carried:** `column.length / count`. There is
no second place for it to be wrong. At `count === 0` it is unrecoverable
(nothing to divide by), so a zero-instance batch's columns must be empty
and an adapter binds none of them.

**`colors` is sugar over the reserved `"color"` channel, not a sibling of
it.** On a batch this library builds, `colors` is an accessor returning
`attributes["color"]` — one buffer under two spellings, kept so consumers
written against the older shape keep working. Enumerate through
`instanceAttributesOf(batch)`, which normalizes either spelling
(including a hand-built batch carrying a plain `colors` and no
`attributes`) and throws if a batch carries two *different* colour
buffers. This is also why `instanceAttrs` refuses `"color"` by name: a
renderer binds instance colour structurally (three's
`InstancedMesh.instanceColor` is a mesh property that flips the shader
variant, not a geometry attribute), so a generic channel of that name
would be uploaded twice and mean two things. `colorAttr` is colour's
route; to carry RGBA, copy the attribute to another name upstream and
name that here.

**`string` attributes are refused.** A string column holds indices into a
per-attribute string table that does not travel with it, so a renderer
would receive integers that mean nothing. Use `assetAttr` for per-point
asset ids, or encode the choice as `u32`/`i32` upstream. Four other
refusals join it, each naming the offending entry and the way out: an
empty name, a duplicate name, the reserved `"color"`, and a name missing
from the point domain.

**Instance order is the invariant everything rests on.**
`attributes[name]` slot `k` and `transforms` slot `k` are the same
instance, for every channel, on every path — the spawner writes them in
one loop from one source index, so no second traversal exists to fall out
of step. `tests/instanceAttributes.test.ts` pins it anyway, because a
host cannot check it and every consumer assumes it.

### Rendering: `ownsGeometry` and the geometry-clone rule

`toInstancedMeshes` binds every non-reserved channel as an
`InstancedBufferAttribute` of its own name, with the column's dtype and
derived item size intact.

An `InstancedBufferAttribute` lives on the GEOMETRY, so **a batch
carrying any named channel gets its own geometry clone** — the asset's
geometry is shared with every other batch drawing that asset, and writing
to it would publish this batch's ids to all of them. The clone is marked
with `ownsGeometry(mesh)` (a flag on the mesh, not an identity
comparison, because whoever disposes a mesh usually no longer holds the
asset map) and must be disposed with the mesh.

**The rule is narrowed to exclude colour:** colour alone does *not* force
a clone, because `instanceColor` is a property of the mesh rather than
the geometry, so a coloured spawn shares the asset geometry exactly as it
always has. Named channel ⇒ clone, own, dispose. Colour only ⇒ share.

Two refusals live on this seam rather than at the spawner: a channel
named after something three already means (`position`, `normal`, `uv`,
`instanceMatrix` and seven more) is refused instead of overwriting the
asset's vertex data, and a channel wider than 4 components is refused
because a vertex attribute cannot carry more.

### What is and is not on the GPU device — read this carefully

This is the one paragraph in the release that has already been misread
once, by an external integrator who nearly abandoned the feature over it.
Three separate questions get collapsed into the phrase "CPU-only", and
the answers differ:

- **Producing a channel on the device: not built.** A spawn naming any
  `instanceAttrs` channel rejects the resident run as `run-plan-failed`
  and the CPU spawner serves the entire terminal — transforms, colour and
  channels together. Nothing is dropped and nothing is silent; the
  rejection is counted in `CookStats.gpu.fallbacks` like every other. The
  reason is a **binding budget**, not a difficulty: the compose kernel's
  widest form already binds seven storage buffers (`P`, `rot`, `scale`,
  `transforms`, the permutation, the colour source, the colour output)
  against the baseline `maxStorageBuffersPerShaderStage` of 8, so an
  arbitrary number of gather channels does not fit in it. Note the refusal
  is a blanket policy on any non-empty list, justified by the widest form
  rather than counted per spawn — a narrower kernel has slots free, which
  is why a future kernel that fitted them would flip this.
  Note also that **colour IS composed on the device** — it is one known
  channel the kernel was built with, so "no gather channels on the GPU"
  would be wrong. A spawn naming no channel keeps its colour on the device
  exactly as before.
- **Rendering a channel under a `WebGPURenderer`: supported.** The
  device-production limit does not touch this. `toInstancedMeshes`
  imports only `three` and branches on nothing renderer-shaped, so an
  `InstancedBufferAttribute` is as valid under `WebGPURenderer` as under
  `WebGLRenderer`. A CPU-produced column reaching a WebGPU/TSL material is
  the whole supported path for per-instance data in a host's shaders.
  **Honest narrowing:** the library ships the DATA, not the shader.
  Nothing in it imports `three/tsl` or writes a material, and `normalized`
  and `gpuType` are left at three's defaults, so declaring the attribute
  (a TSL `attribute()` node, a `ShaderMaterial`, an `onBeforeCompile`
  patch) and the shader-side type of an integer channel are the host's.
  No demo binds a custom channel and no test issues a draw call, so
  "renders correctly" is intended and documented but not proven by the
  suite. Note also that three defaults an attribute to `FloatType`, so an
  integer channel whose `gpuType` the host does not set is read back as a
  float — reintroducing at the shader exactly the 2^24 widening the
  spawner refused to do at the boundary. The one WebGPU-side refusal is the *device-resident* adapter,
  which binds only the instance matrix and the reserved colour, and which
  throws on a hand-built device batch carrying anything else — naming both
  ways out (drop `deviceInstances: true` for CPU batches, or bind
  `batch.attributes[name].handle.resource` yourself).
- **Cooking on the main thread: not required.** `pcg-ts/worker` cooks
  off-thread and carries every named channel on the transfer list (see
  below). "CPU" here means "not the GPU device", never "on your frame".

So a host wanting per-instance data in a WebGPU material has a complete
path today: cook in a worker, receive the channels zero-copy, bind them
with `toInstancedMeshes`, read them from its own material — budgeting for
the geometry clone each channelled batch carries. What is not
available yet is having the device *compose* those channels without a
readback.

---

## Worker protocol: a pre-alpha format break

`EncodedInstanceBatch.colors?: Float32Array` is **replaced** by
`EncodedInstanceBatch.attributes?: Readonly<Record<string, AttrData>>`.

`attributes` carries every named per-instance channel, colour included —
`colors` is an accessor over the reserved `"color"` channel and has no
wire form of its own, so a batch encodes one buffer per instance property
and `decodeOutputs` rebuilds the accessor. Encoding both would put the
colour array on the transfer list twice.

This is a wire-format break, acceptable pre-alpha. Hand-built CPU batches
carrying a plain `colors` still survive: `instanceAttributesOf` lifts them
into the reserved channel, so they encode identically.

**The property that matters for a real-time host:** every column rides
the structured-clone transfer list, so a cooked batch reaches the main
thread as buffer ownership rather than as a copy. The worker pays one
`slice()` per column on its own thread — the one unavoidable copy,
because a cook's arrays alias live memo caches and transferring them
would detach the worker's own cache — and the main thread pays nothing.

(Worker cooks remain CPU-only in the literal sense: an item carrying
device-resident batches has no host bytes to post across a thread and is
refused with the fix, since its transforms live in GPU buffers.)

---

## `toDeviceInstanceObjects` and optional context

New in `pcg-ts/three`: `toDeviceInstanceObjects`, the device counterpart
of `toInstancedMeshes` — it loops a device item's batches, calls
`adapter.build`, and releases already-built objects if a later batch
throws.

`DeviceInstanceContext` moved out of `worldBinding.ts` into its own
module, and **every field is now optional** (`levelName` and `coord` were
required). A `World` is one caller and not the only one. Consequences:
the WebGPU adapter's error strings route through a `buildSite(ctx)`
helper that says "a batch built with no cell context" when both are
absent, and a batch with no bounds has frustum culling switched **off**
rather than guessed.

---

## Packaging

- **New subpath `pcg-ts/panels`.** `parsePanelSpec` and the panel spec
  types (`GraphPanelSpec`, `PanelSectionSpec`, `PanelControlSpec`,
  `ParsePanelSpecOptions`, `PanelSpecError`) get their own entry so a HOST
  can validate an authored panel without pulling the cooking core in
  behind it. It previously lived in `shared/`, reachable only through this
  repo's own Vite build.
- **`sideEffects` is now an array** rather than absent. It must not be
  `false`: tsup code-splits, so `dist/primitives/index.js` is a ~420-byte
  re-export shell and every `definePrimitive`/`register` call lands in a
  shared chunk — `./dist/chunk-*.js` is load-bearing, not a convenience.
  `./src/**` is included because the Vite/Vitest configs alias the package
  name to `src/`; `shared/`, `demos/` and `editor/` because
  `npm run examples:pages` is a production build over them whose output is
  committed and published. `./dist/three/index.js` and
  `./dist/panels/index.js` are deliberately omitted. `tests/packaging.test.ts`
  pins all of this.
- **`three` peer range `^0.185.1` → `^0.185.0`** — a **widening**, not a
  tightening. The floor is the minor line rather than one patch because
  nothing compares version strings: `checkAdoptionSeam` probes the buffer
  adoption seam behaviourally on every use, which is stronger than a range.
  Still verified against `0.185.1`.
- `files` collapsed from `graphs/basics-*.json` + `graphs/pipeline-*.json`
  to `graphs`; `prepublishOnly` reordered to run `build` first.

---

## BREAKING: names withdrawn from the public surface

One deliberate withdrawal, taken while the package is pre-alpha. All of
these are **still exported from their own modules** — they left the root
`pcg-ts` surface, not the codebase. Verified against
`src/publicSurface.test.ts` (value surface) and
`src/publicTypeSurface.test.ts` (type surface); the list below is
exhaustive for this release.

Values (9):

| Removed | Replacement |
|---|---|
| `ATTR_CTORS` | none — internal dtype constructor table |
| `FIELD_BRAND` | `makeField` stamps it; `isField` is the check |
| `MAX_INSTANCES` | none (the limit is still stated in the `spawnInstances` description) |
| `nextRev` | the item constructors call it |
| `makeDeviceInstancesItem` | none — it takes executor-only device handles |
| `isDeviceInstanceBatch` | `batch.residency === "device"`, or `isDeviceResidentInstances` (still exported) |
| `getSubgraphPlumbing` | `describeSubgraphPins` / `describeSubgraphParams` |
| `paramSchemaError` | `liveParamValueError` (still exported) |
| `paramValueError` | `liveParamValueError` (still exported) |

Types (2): **`AnyInstanceBatch`** (no replacement; `InstancesItem` keeps
`batches` and `deviceBatches` as separate fields) and
**`SubgraphPlumbing`** (no replacement).

The two types needed a second pin to catch: `publicSurface.test.ts` reads
the module's runtime keys, and a `type` export has none — hence the new
`publicTypeSurface.test.ts`.

### Added to the surface

Values: `INSTANCE_COLOR_CHANNEL`, `instanceAttributesOf`,
`deviceInstanceAttributesOf`, `deviceInstanceAttributeLayout`.
Types: `InstanceAttributes`, `DeviceInstanceAttrType`,
`DeviceInstanceAttribute`, `DeviceInstanceAttributeLayout`.
From `pcg-ts/three`: `ownsGeometry`, `toDeviceInstanceObjects`.

`makeInstanceBatch` is deliberately **not** root-exported.

---

## New nodes (12)

| Node | What it does |
|---|---|
| `runFit` | Least-squares fit of a run, per point, along a path |
| `arcTile` | A repeated piece laid over each of a path's arc ranges |
| `pathCoverage` | Per-point cover from a cloud of oriented boxes, by ray cast |
| `pathShift` | Read a path's own attributes from the point `offset` positions along |
| `pathScan` | A running fold along a path, in walk order |
| `pathRuns` | A running total *within* each run of a path, reset at flagged points |
| `pointScatterOnPath` | Uniform random points along every polyline of a path, hash-seeded |
| `transferAlongPath` | Interpolate a path's attributes onto a cloud of arc positions |
| `transferByIndex` | Gather a source geometry's point attributes at a per-point index |
| `quotaRebalance` | Decide which elements must change category for every category's share to land inside its stated band, and name the category each should join |
| `occlusionCull` | Move or drop points whose oriented box blocks a line of sight |
| `repeatUntil` | Wrap an inner graph as a node that re-cooks it until it settles — a bounded fixed point, in a graph where a cycle cannot be wired |

---

## Editor's checklist before publishing

- [ ] Decide whether the "What is and is not on the GPU device" section
      belongs this high up, or whether it reads as defensive.
- [ ] The device-production limit has no scheduled lift. Say so, or say
      nothing about the future — the source only notes that a narrower
      kernel would fit.
- [ ] Consider whether the withdrawn names deserve a codemod note.
