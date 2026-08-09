# pcg-ts — build plan

Goal: a deterministic, browser/Node PCG library in TypeScript combining
a domain-based attribute data model, a hierarchical real-time generation
runtime, and deferred fields — with a standard node library, three.js interop,
examples, and tests. Designed to be driven by AI agents as well as
humans: self-describing node registry, stable JSON graph serialization,
precise actionable errors, introspectable execution. Built phase by phase, unattended, with `status.html`
regenerated and a commit after every phase (and after significant
mid-phase milestones).

Package name: `pcg-ts` (subpath exports `pcg-ts` and `pcg-ts/three`).
Tooling: TypeScript strict, vitest, tsup (library build), vite (examples),
npm. three.js is an optional peer dependency.

## Core type sketch (aligned with the shipped v0.2 API; the registry and dist types are the truth)

```ts
type Domain = 'point' | 'vertex' | 'primitive' | 'detail';
type AttrType = 'f32' | 'i32' | 'u32' | 'bool' | 'string';

// SoA storage: one typed-array column per attribute, with tuple size.
interface AttributeSet {
  add(name: string, type: AttrType, tupleSize?: number, defaultValue?: AttrDefault): Attribute;
  get(name: string): Attribute | undefined;
  require(name: string): Attribute; // get, but throws naming the attribute
  count: number; // elements in this domain
}

// Geometry holds one AttributeSet per domain plus topology
// (vertex->point map, primitive ranges). Points-only data is the
// common fast path of the whole library.
interface Geometry { attrs: Record<Domain, AttributeSet>; /* topology */ }

// Standard point attributes: P (f32x3), rot (quat f32x4 xyzw), scale
// (f32x3), density (f32), boundsMin/Max (f32x3), color (f32x4), seed (u32).

// Fields: deferred computation resolved on a domain.
interface EvalContext { geo: Geometry; domain: Domain; seed: number; }
interface Field<N extends number = number> {
  key: string;                 // stable structural identity (memo key)
  tupleSize: N | undefined;
  evaluate(ctx: EvalContext): Column; // { data, tupleSize }
}
// Node params accept T | Field. Combinators: arithmetic, trig
// (sin..atan2), compare, clamp/lerp/remap, select, ramp, vector ops;
// inputs: position(), attribute(name), index(), randomField(key);
// noise: value/perlin/simplex/worley/fbm ('normalized' [0,1] option,
// raw ranges in NOISE_RAW_RANGES / noiseOutputRange()).

// Graph: code-first builder, typed pins ('multi' inputs concatenate),
// data as DataCollection = readonly DataItem[] (geometry | value |
// instances items, tagged, with revision ids).
// Execution: pull-based topological; memoized per node on (type, param
// hash, node seed, input item revs); async time-budgeted scheduler,
// cancellable; per-output cooking via cook(graph, { outputs });
// subgraph nodes wrap inner graphs and serialize recursively.

// Hierarchical runtime: configurable grid levels (cellSize; optional
// leading unbounded level with no generationRadius; cellMode 'xz' |
// 'xyz' cube cells; optional cookOutputs subset per level); per-cell
// seeds hashCombine(worldSeed, levelIndex, ...coord); cells cook on
// demand around a viewpoint, LRU eviction, dirty propagation for
// invalidation.

// Spawner protocol (render-agnostic terminal): emits InstanceBatch
// { assetId, count, transforms: Float32Array /* column-major 4x4 per
// instance */ }; per-point asset ids via a string attribute
// (spawnInstances assetAttr). The three adapter maps
// InstanceBatch -> THREE.InstancedMesh.
```

## Phases

### Phase 0 — Scaffolding
- `package.json` (npm), strict `tsconfig.json`, vitest config, tsup config,
  vite config for `examples/`, `.gitignore`.
- Subpath exports wired (`.`, `./three`), placeholder entry points compile.
- `scripts/status.mjs`: reads `status.json` (+ latest vitest summary),
  writes self-contained `status.html`. `npm run status` script.
- Exit: `npm test` runs (empty suite passes), `npm run build` succeeds,
  `npm run status` regenerates status.html. Commit.

### Phase 1 — Core data model (attribute domains)
- `src/data`: AttributeSet with typed columns (f32/i32/u32/bool + string
  table), tuple sizes, resize/copy/compact.
- Geometry container with the four domains and topology maps; PointCloud
  helper that initializes standard point attributes.
- `promote(geo, attr, from, to, mode: first|average|sum|min|max)`;
  `transfer(dst, src, attr, mapping: nearest)` (uv/raycast later).
- Exit criteria: unit tests for storage round-trips, promote modes on a
  small known mesh, nearest transfer, stable iteration order. Commit.

### Phase 2 — RNG, noise, fields (deferred evaluation)
- `src/random`: PCG32; `hashCombine(...uints)` for seed derivation
  (graph seed ⊕ node seed ⊕ cell ⊕ index).
- `src/fields`: Field<T>, Column<T>; inputs (position, attribute, index),
  combinators (arith, compare, select, clamp/lerp/remap, ramp); anonymous
  attribute capture; per-evaluation memoization.
- `src/noise`: value, perlin, simplex, worley, fbm — all as fields.
- Exit: determinism tests (fixed seeds → golden values), field composition
  equals eager computation, noise output range/statistics sanity. Commit.

### Phase 3 — Graph runtime (execution core)
- `src/graph`: NodeDef (typed pins, params as `T | Field<T>`), code-first
  GraphBuilder, validation (types, cycles), DataCollection with tags.
- Executor: pull-based topological evaluation; content-hash memo cache;
  dirty propagation on param/input change; async scheduler with time
  budget per tick; cancellation; subgraph node.
- Exit: tests for execution order, cache hit/miss on param edits,
  cancellation mid-cook, deterministic replay. Commit.

### Phase 4 — Standard node library
- Sources: CreatePointsGrid, CreatePointsLine, primitive sources.
- Samplers: SurfaceSampler (area-weighted over triangles, density field),
  SplineSampler (by distance/count), VolumeSampler (grid in bounds).
- Point ops: TransformPoints, Jitter, DensityNoise, FilterByDensity /
  ByBounds / ByAttribute, SelfPruning (min distance), CopyPoints, Merge,
  BoundsDifference/Intersection, Projection (onto surface).
- Attribute ops: SetAttribute (field), PromoteAttribute, TransferAttribute,
  PartitionByAttribute.
- Node registry: central registration with machine-readable metadata per
  node type (type name, description, pins, param schema with types,
  defaults, descriptions) so agents can enumerate capabilities at runtime.
- Graph JSON serialization: stable, versioned format referencing
  registered node types; round-trips builder-authored graphs; validation
  errors name the node/pin/param at fault.
- Exit: golden + property tests per node; registry metadata completeness
  check; serialization round-trip tests; whole-library determinism suite.
  Commit.

### Phase 5 — Hierarchical runtime (grids and streaming)
- `src/runtime`: grid levels with configurable cell sizes + unbounded
  level; per-cell cook tasks with seeds hashed from cell coords; budgeted
  scheduler integration; viewpoint-driven streaming (generation radius per
  level, hysteresis, LRU eviction); invalidation by cell/node/param.
- Exit: tests for cook-order independence (same cells any order → same
  points), streaming lifecycle (enter/exit radius), eviction, seam
  determinism at cell borders. Commit.

### Phase 6 — three.js interop + spawners
- Spawner protocol in core (InstanceBatch terminal, render-agnostic).
- `src/three`: BufferGeometry → sampleable mesh, THREE.Curve → spline data,
  InstancedMeshSpawner, DebugPointsHelper. three stays an optional peer.
- Exit: vitest with headless three (BoxGeometry sampling, instance counts
  and transforms), core still builds without three installed. Commit.

### Phase 7 — Examples + docs + release polish
- Vite multi-page examples: 01-scatter-basic (plane + density noise),
  02-forest (terrain sampling, slope/altitude filters, instancing),
  03-spline-fence (spline sampling + copy points, oriented), 04-infinite-
  world (hierarchical streaming around camera), 05-fields-playground
  (compose fields, visualize as color/density).
- README with API tour; agent-facing docs: `llms.txt` plus a node/API
  reference generated from registry metadata, written for LLM
  consumption; final status.html; tag `v0.1.0`. Commit.

## Phases (v0.2) — backlog promoted 2026-08-05

The post-v0.1 backlog (example-building friction + audit findings),
grouped by subsystem into phases 8–12. Same protocol as v0.1: delegated
implementation, independent adversarial audit per nontrivial phase,
tests + status.html + commit after each phase.

### Phase 8 — Serialization completeness
- Serializable subgraphs: register subgraphs via `standardNode` with an
  inner-graph payload so a graph containing subgraph nodes round-trips
  through `serializeGraph`/`deserializeGraph` (recursive, versioned,
  cycle-safe). Closes the "graphs serialize" pillar gap.
- Item-list param type in the registry schema language; `dataInput`
  loses its placeholder schema and becomes serializable.
- Exit: round-trip tests for nested subgraphs and dataInput graphs;
  deserialized graphs cook to byte-identical outputs; validation errors
  name the node/param/pin at fault. Commit.

### Phase 9 — Field grammar and noise contract
- Trig functions (sin/cos/tan/asin/acos/atan/atan2) in field
  combinators and the field-expression JSON grammar.
- "Orient along vector" node: build rot quaternions from a direction
  (+ up hint) so tangent-to-rotation stays in the graph instead of
  dropping to the data API.
- `normalized: true` option on noise fields for a uniform [0,1] output
  contract; per-noise raw ranges documented in registry metadata.
- Exact (opt-in) worley mode that widens the cell search until correct,
  property-tested against brute force.
- Exit: trig goldens; orient node matches quaternion reference; noise
  normalization property tests; exact-worley equivalence tests. Commit.

### Phase 10 — Attribute ergonomics and seeding
- String/enum-capable `setAttribute` (string-table backed) so
  multi-asset spawns (assetAttr) stay declarative in the graph.
- Sanctioned per-cell seeding: `seed` param on setAttribute (hashed with
  the cell/graph seed) and document graph.setSeed-in-bind as supported.
- Exit: string attribute round-trips through cook + serialization;
  forest-style multi-asset graph needs no imperative escape hatch;
  per-cell seed determinism tests. Commit.

### Phase 11 — Cooking and runtime upgrades
- Per-output cooking (cook a chosen output pin) or optional outputs, so
  staged pipelines no longer need two graphs when a terminal branch is
  unbound.
- 3D grid cells (cube cells, XYZ addressing) as a level option.
- Unbounded levels without a dummy generationRadius.
- Exit: single-graph staged pipeline test; 3D cell determinism + seam
  tests; unbounded-level API test; cook-order independence retained.
  Commit.

### Phase 12 — Docs alignment and v0.2.0
- Align the PLAN core-type sketch and node-name mentions with shipped
  names (registry is the truth).
- Regenerate node reference; update README/llms.txt/authoring docs for
  new capabilities; example updates where new nodes simplify them.
- Version 0.2.0, tag, GitHub release.
- Exit: full suite green, docs regenerated and idempotent, release
  tagged. Commit.

## Phases (v0.3) — stretch tier scheduled 2026-08-05

The two schedulable stretch items, plus release polish. Same protocol:
delegated implementation, independent adversarial audit per nontrivial
phase, tests + status.html + commit after each phase.

### Phase 13 — uv/raycast attribute transfer
- Extend `transfer` beyond nearest: `uv` mapping (locate each
  destination element's UV in the source triangulation's UV space,
  barycentric-interpolate the attribute) and `raycast` mapping (cast a
  ray per destination point along a direction against the source
  triangle mesh, interpolate at the hit).
- Deterministic acceleration structures (uniform grids over triangles,
  2D for UV and 3D for raycast) with documented deterministic
  tie-breaking (nearest hit, then lowest triangle index).
- Documented policies: misses (keep prior value + report count, or
  documented fill), degenerate triangles, non-interpolatable types
  (string/int use the dominant/nearest vertex, documented).
- Node exposure through the existing transfer node family with full
  registry metadata and serialization; errors name node/param and fix.
- Exit: equivalence vs brute-force reference on adversarial meshes
  (shared edges, degenerate tris, misses); determinism suites;
  round-trip tests; existing nearest-transfer goldens unmoved. Commit.

### Phase 14 — Interactive graph editor (Svelte)
- New example `06-graph-editor`: a registry-driven editor built
  entirely on the public API — node palette from `listNodeTypes()`,
  schema-driven param forms (including field-expression JSON), pin
  connections validated by the existing graph validation, live cook
  into a three.js viewport, JSON import/export via
  serializeGraph/deserializeGraph.
- Svelte 5 (runes), matching the fields-playground conventions; no new
  runtime dependencies in the library itself.
- Exit: examples build + typecheck; browser-verified flows (add node,
  connect, edit param, cook preview updates, export → import →
  identical cook); library source untouched except genuine public-API
  gaps found by the editor (each reported and tested). Commit.

### Phase 15 — Docs and v0.3.0
- README/llms.txt/authoring updates for transfer mappings and the
  editor; regenerate node reference; overview site (docs/index.html)
  roadmap refreshed.
- Version 0.3.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, release tagged. Commit.

## Phases (v0.4) — editor-grade graph APIs, scheduled 2026-08-05

The public-API gaps recorded while building the phase-14 editor
strictly on the public surface. Same protocol: delegated
implementation, independent adversarial audit per nontrivial phase,
tests + status.html + commit after each phase.

### Phase 16 — Graph mutation and introspection
- `Graph.removeNode(node)`: removes the node, all its connections, and
  any outputs declared on it (documented cascade); bumps the graph
  version and invalidates exactly what depends on the removal —
  downstream nodes recook, untouched branches keep their caches.
- `Graph.disconnect(from, pin, to, pin)` and
  `Graph.removeOutput(name)` with the same versioning/cache contract.
- Public read API for live graph structure: enumerate nodes (id, type
  where known, seed), connections, declared outputs, and current param
  values as read-only snapshots with deterministic (insertion) order —
  no mutation path that bypasses version bumps.
- Errors actionable: removing/disconnecting things that don't exist
  names the node/pin/output and lists what does exist.
- Exit: cache-surgery tests (remove upstream → downstream recooks,
  siblings stay cached, stats prove it); serialization consistency
  after every mutation (serialize(mutated) round-trips and cooks
  byte-identically); subgraph and World interplay regression-free;
  introspection snapshots cannot mutate graph state. Commit.

### Phase 17 — Registry metadata and editor adoption
- Optional `category` on node registration, surfaced through
  `listNodeTypes()`; categorize the standard library; palette grouping
  becomes metadata-driven (heuristic stays as fallback for uncategorized
  third-party nodes).
- Public introspection for per-instance subgraph pins (describe an
  instance's pins + their kinds from its def), replacing the editor's
  payload re-derivation.
- Editor adoption as proof the APIs suffice: deletes/disconnects use
  the new mutation API (no full rebuild — cook stats must show
  untouched branches staying cached across edits), palette uses
  categories, subgraph pins use the new introspection, and the
  serialized-JSON-as-source-of-truth workaround is retired where the
  read API now serves.
- Exit: editor flows re-verified in the browser (delete/reconnect keeps
  sibling caches; palette groups by category); library tests green;
  registry docs regenerate with categories. Commit.

### Phase 18 — Docs and v0.4.0
- README/llms.txt/authoring updates (mutation + introspection APIs,
  categories); regenerate node reference; overview site + hosted demos
  refreshed; version 0.4.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, release tagged. Commit.

Node-level exposure of the transfer tuning options (`uvDomain`,
`cellSize`) stays out until a real graph needs it — the data-layer
functions already accept them, and `cellSize` is result-neutral by
construction.

## Phases (v0.5) — WebGPU field kernels, scheduled 2026-08-06

The recorded WebGPU stretch goal, scheduled. Design decisions fixed up
front, grounded in an architecture audit of the shipped code:

- **What compiles.** The serializable field-expression grammar (the
  closed set of inputs, combinators, and noise fns in `fieldJson`) is
  the GPU surface. A compilable field evaluates over a whole domain in
  one compute dispatch. Code-authored fields (no spec) stay on CPU.
- **Where it lives.** New `pcg-ts/gpu` subpath. Core never imports it
  (guard-tested, same pattern as `src/three`); the graph layer sees
  only a structural resolver interface expressed in core types.
- **Determinism contract** (documented prominently; CPU remains the
  bit-exact reference and existing goldens never move): u32 hash and
  random streams (hashCombine, hashFloat, randomField) are bit-exact
  between CPU and WGSL; float arithmetic matches within documented
  per-op tolerances (CPU computes in f64 and stores f32; WGSL computes
  in f32); on a single device results are run-to-run deterministic;
  branchy ops (select/compare/ramp stops) may flip at knife-edge inputs
  whose operands differ within tolerance.
- **Cache provenance.** GPU output is not byte-identical to CPU, so
  gpu participation folds into the memo key for nodes that would
  resolve a live Field on device; toggling gpu never serves bytes
  produced by the other path, and nodes without live Field params keep
  their cache hits across the toggle.

### Phase 19 — WGSL field compiler (codegen only, no device)
- `src/gpu` + `pcg-ts/gpu` subpath: tsup entry, exports map, examples
  vite alias, `noGpuInCore`-style guard test; `@webgpu/types` as a dev
  dependency only.
- `compileFieldSpec`: FieldSpec → WGSL compute kernel + bind-layout
  plan covering the complete grammar: constant, attribute (numeric +
  bool-as-f32; string attrs are actionable errors), position, index,
  randomField; all elementwise combinators including trig; dot/length/
  normalize/vec/component/ramp; clamp/lerp/remap/select/compares;
  value/perlin/simplex/worley (f1, f2, f2-f1; exact mode via the
  bounded r≤3 ring walk) and fbm as a fused octave loop; `normalized`
  wrapping with the same range endpoints.
- WGSL library ports, bit-faithful where integer: hashMix/hashFinalize/
  hashSeed chains (hash2/hash4/hash5 equivalents), hashFloat (exact by
  construction), GRAD3, fade, PERLIN_SCALE / SIMPLEX_SCALE / R2 / F3 /
  G3 constants imported from the CPU source of truth, not duplicated.
- Static tuple-size inference mirroring `broadcastTupleSize`;
  shared-subtree dedup so a spec DAG computes each subtree once;
  pipeline specialization key = (field key, input column layout).
- `getFieldSpec(field)` non-throwing public accessor beside
  `fieldToJson` so compilability is queryable without try/catch.
- Errors actionable: unsupported fn, string attribute, unresolvable
  tuple size name the offending spec node and list what is supported.
- Exit: golden WGSL snapshots per grammar family; tuple inference +
  broadcast + dedup unit tests; error-message tests; build and guard
  tests green. No device required. Commit.

### Phase 20 — Device runtime + cook integration
- `GpuFieldEvaluator`: wraps a GPUDevice; pipeline cache, SoA column →
  storage-buffer marshalling (f32/i32/u32 columns), uniform params,
  dispatch, async readback to Column. Implements the core-side
  resolver interface; returns null for ineligible fields (CPU
  fallback) with the reason recorded.
- Threading: `CookOptions.gpu` → `NodeExecuteArgs` → async field
  resolution in setAttribute (the density workhorse) and a public
  capture-level API; forwarded explicitly through subgraph execute and
  World (`WorldOptions`/`UpdateOptions`) to the world cook call site.
- Cook stats gain gpu counters: dispatches, compiled pipelines, cache
  hits, fallbacks with reasons — introspectable per the agent pillar.
- Adapter strategy: device suite runs on Node WebGPU bindings if
  installable, else vitest browser mode (Chromium); without any
  adapter it skips visibly, never silently passes.
- Parity suite: bit-exact u32/randomField streams; measured per-op-
  family float tolerances vs CPU (then documented verbatim in the
  contract); run-to-run byte-equality on one device; ineligible-field
  cooks byte-identical to CPU-only cooks.
- Exit: parity, provenance (cache-surgery across gpu toggle with stats
  proving it), and threading tests green; device suite green on an
  adapter and skipped-not-failed without one; existing goldens
  unmoved; CPU-only suite untouched. Commit.

### Phase 21 — Example, docs, v0.5.0
- New example 08-gpu-fields: large-N scatter (order 10⁶ points) driven
  by a chunky field expression, CPU/GPU toggle, cook timing + gpu stat
  overlay, live max-deviation readout vs CPU on a sample window.
  Browser-verified on a real adapter.
- README/llms.txt/authoring: the `pcg-ts/gpu` API and the determinism
  contract with the measured tolerances; node/API reference
  regenerated if metadata changed; overview site + hosted demos
  refreshed.
- Version 0.5.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, example browser-verified,
  release tagged. Commit.

## Phases (v0.6) — pervasive GPU + resident pipelines, scheduled 2026-08-06

Two tiers, in order: first make the v0.5 GPU path pervasive (every
field-resolving node consults the resolver; device limits stop being
fallbacks), then the recorded stretch — device-resident pipelines that
fuse chains of field-driven nodes so intermediates never ride back
through the CPU. Design decisions fixed up front:

- **Fusion is executor-driven and automatic** over maximal runs of
  eligible nodes: element-count-preserving, all live Field params
  spec'd, node type flagged resident-capable. No new authoring
  surface; existing graphs benefit unchanged.
- **Cache contract for fused runs.** A run caches only its terminal
  output (one readback); interior nodes cache nothing while fused —
  any interior change recooks the whole run (composite memo key from
  member keys + gpu salt), siblings unaffected. An interior node with
  external consumers (declared output, multi-consumer tap, or a
  non-fusable downstream) becomes a run terminal with a readback —
  fusion never changes which bytes the rest of the graph observes.
- **Determinism composes.** Per-op budgets accumulate across a fused
  chain exactly as across sequential dispatches; run-to-run
  byte-stability on one device still holds; CPU-only cooking remains
  the bit-exact reference and is byte-identical to v0.5.0.

### Phase 22 — Pervasive GPU adoption, chunked dispatch, buffer pooling
- Adopt the resolver in the remaining field-resolving nodes:
  transformPoints (translate/rotateEuler/scale), jitterPoints
  (amount), orientAlongVector (direction), surfaceSample
  (densityField over the candidate cloud), volumeSample (jitter) —
  each with `gpu: "fields"` provenance and CPU fallback, aliasing
  semantics preserved.
- Chunked 1D dispatch: counts beyond 65535 x workgroupSize split
  across dispatches with a chunk-offset uniform; `dispatch-too-large`
  leaves the fallback vocabulary; chunked output byte-identical to
  unchunked for sizes both can serve (internal max-dispatch override
  so tests exercise chunk seams without 16MB buffers).
- Size-bucketed buffer pooling per evaluator (bounded, introspectable
  via a pool-stats getter); reuse must be observationally invisible —
  full-overwrite or explicit clear semantics, proven by tests that
  interleave differently-shaped dispatches.
- Exit: per-node device parity + provenance-surgery tests; chunk-seam
  byte-equality incl. counts 1 above/below a seam; pooling
  reuse-safety tests; CPU-only cooks byte-identical to v0.5.0;
  existing goldens and the 769-test suite untouched. Commit.

### Phase 23 — Device-resident pipeline core
- Run detection in the executor per the fixed contract above;
  compiled-run representation (ordered member kernels + attribute
  read/write sets) with a stable composite specialization key.
- Resident columns: intermediate attribute writes live in storage
  buffers between member kernels (ping-pong or read_write in place,
  implementer's choice, documented); one readback materializes the
  terminal node's output items; interior boundary cases (external
  consumer, output decl, count-changing downstream) split runs.
- Cook stats gain resident-run counters (runs, fusedNodes,
  readbacksSaved) alongside the existing gpu counters.
- Cancellation/budget: runs respect signal/budgetMs at member-kernel
  granularity without leaking device resources mid-run.
- Exit: fused output within composed budgets of the per-node GPU
  path and CPU reference on device; byte-stable run-to-run;
  cache-surgery tests (interior edit recooks exactly the run;
  sibling caches survive; boundary nodes cache normally); World and
  subgraph interplay regression-free; CPU-only byte-identical.
  Commit.

### Phase 24 — Demo, docs, v0.6.0
- Extend 08-gpu-fields with a fused chain (e.g. setAttribute →
  jitter → transform → setAttribute) and a three-way wall-time
  readout: CPU / per-node GPU / resident run, plus readbacksSaved.
  Browser-verified on a real adapter.
- README/llms.txt/authoring: pervasive adoption list, chunking and
  pooling notes, the fused-run cache contract, updated stats shape;
  node reference regenerated if metadata changed; overview site
  refreshed; version 0.6.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, demo browser-verified,
  release tagged. Commit.

## Phase 25 — Uniform constant params (v0.6.1), scheduled 2026-08-06

The cost v0.6.0 shipped documented: inside a resident run, a plain
constant node param (`translate: [0,0,0]`) compiles like a field —
a full `count x tupleSize x 4` device column plus a dispatch to fill
it with the same value every element. In a mixed chain that is ~36%
of the working set (36 MB at 1M points for transformPoints' three
constants alone), it inflates `totalBytes` toward `run-too-large`,
and it is why a constant-heavy fused chain can trail per-node GPU.

- Constants ride the apply kernel's uniform instead: the planner
  allocates a uniform slot rather than a column and emits no field
  kernel; the apply kernel reads `params.consts[slot][k]` with the
  same scalar-broadcast rule columns use.
- **Values live in the uniform, never in the WGSL text.** The apply
  kernel key encodes only which params are constant and their tuple
  sizes — so editing a constant (a slider, an animated param) rebinds
  a uniform and never recompiles a pipeline. Baking values as
  literals is explicitly rejected: it would trade one cost for
  pipeline-cache thrash.
- Byte-exactness is the acceptance bar, not a hope: a JS number
  written through a `Float32Array` uniform rounds exactly as the
  constant column it replaces, so every existing bit-exact fused
  chain must stay bit-exact. If any output byte moves, the change is
  wrong — *unless* it moves onto the CPU reference, which is the one
  admissible direction. Measured instance: a `-0` or subnormal f32
  baked as a WGSL literal is flushed to `+0` by the D3D12 back end,
  so the old constant column diverged from the CPU there; a uniform
  load is not flushed, so those cases now match. Bytes changed, so
  `SALT_VERSION` bumps per its own rule.
- Compiled-artifact identities (apply-kernel version, run-plan
  format) bump because the WGSL and plan shape change. The device
  `cacheSalt` (`SALT_VERSION`) was expected to stay put — the whole
  point being that bytes do not move — but the literal-flush finding
  above means they can, so it bumps too.
- Optional, same mechanism: `orientAlongVector`'s `up` is currently
  baked as a WGSL literal, so editing it recompiles. Move it to the
  uniform if it falls out cleanly.
- Exit: device tests prove the previously-bit-exact chains are still
  bit-exact byte-for-byte; working-set bytes and dispatch counts drop
  measurably (record before/after for the demo chain); a constant
  edit shows a pipeline cache hit, not a compile; `run-too-large`
  boundary moves accordingly; full suite green with pinned counts
  updated to the new (lower) numbers. Commit, release v0.6.1.

## Phases (v0.7) — GPU-resident World streaming, scheduled 2026-08-07

The recorded stretch: a streamed cell's instance transforms are
composed on device and handed to the renderer without ever crossing to
the CPU. Today every cell pays a full round trip — the resident run
reads P/rot/scale back (`run.ts` readback), `composeTRS` builds 16
floats per point in a JS loop (`spawn/instances.ts`), and the three
adapter copies that array a second time into `instanceMatrix`.

Feasibility settled before scheduling: three 0.185.1 already ships
`three/webgpu`, and its backend takes `parameters.device` ("create the
device if it is not passed with parameters"), so one `GPUDevice` can
back both the evaluator and a `WebGPURenderer`. Without shared-device
support this feature is impossible — a WebGL context cannot read a
WebGPU buffer, and two devices cannot share one either.

Design decisions fixed up front:

- **Additive and opt-in.** The CPU spawner path and the WebGL
  `toInstancedMeshes` route stay byte-for-byte as they are. The
  resident path activates only when the caller supplies a shared
  device and a WebGPU renderer; everything else keeps working
  untouched.
- **Single-asset first; multi-asset stays on CPU.** Device-side asset
  grouping needs a sort/partition over a string-table attribute — the
  one genuinely GPU-hostile step in the pipeline. v0.7 fuses only the
  constant-`assetId` case; `assetAttr` falls back to the CPU path with
  a machine-readable reason. Recorded as the obvious successor, not
  smuggled in.
- **Lifetime is the hard problem, not the math.** Cells evict
  continuously, so every retained device buffer is a leak in waiting.
  Ownership transfers explicitly out of the pool (a `detach` that
  survives the run's `finally`), the buffer's owner is named at every
  moment, eviction is ordered against in-flight GPU work, and the
  node memo cache must not silently pin device memory across cells.
- **CPU stays the reference.** Composing on device in f32 will not
  bit-match `composeTRS`'s f64 interior; that is a documented
  tolerance class (these bytes drive a renderer, not a seed chain),
  and the CPU path remains what determinism tests pin.
- **The three seam is an internal.** three publishes no supported way
  to render from a buffer you already own, so this leans on backend
  internals. It gets version-pinned and guarded by a test that fails
  loudly and legibly when three moves it — never a silent fallback to
  wrong rendering.

### Phase 26 — Device-resident instance transforms
- Compose-TRS WGSL kernel writing column-major 4x4 matrices, ported
  from `composeTRS` (`spawn/instances.ts`) and validated against it
  within the documented tolerance.
- Buffer ownership: `BufferPool.detach` (ownership leaves the pool so
  the run's `finally` cannot reclaim it), an explicit disposable
  handle, and a documented rule for who destroys what and when.
- Core gains a device-resident instance-batch variant carrying an
  opaque handle instead of a `Float32Array` — expressed in core types
  only, so `src/fields`/`src/graph` still know nothing about WebGPU.
- `spawnInstances` becomes eligible as a resident-run terminal (its
  second output is what bars it from `isFusable` today); the run
  keeps P/rot/scale device-side and skips their readback.
- Memo-cache interaction: a cached node output must never pin a
  device buffer indefinitely — pin the policy with a test that cooks
  many cells and asserts retained device bytes stay bounded.
- Exit: kernel parity vs `composeTRS`; no-leak tests across cook →
  evict → recook cycles with pool stats proving it; `assetAttr`
  falls back with bytes identical to the CPU path; CPU-only and
  WebGL paths byte-identical to v0.6.1. Commit.

### Phase 27 — three/webgpu adapter and shared-device binding
- `WebGPURenderer` interop: shared-device construction, an instanced
  material/attribute path fed by the retained buffer, and bounds
  supplied out-of-band from the cell AABB (`computeBoundingSphere`
  reads CPU matrices that no longer exist).
- `WorldThreeBinding` gains a resident branch: device batches build
  and dispose alongside CPU ones, eviction releases device buffers in
  the right order, and a partial build still cleans up.
- Guard test pinning the three internals the adapter depends on, with
  an actionable failure naming the three version and the moved API.
- Verification is browser-based by necessity: `WebGPURenderer` needs a
  real canvas/swap chain, so Node+Dawn cannot cover it. Unit-test
  everything that does not need three; verify the rest live.
- Exit: browser-verified streaming with instances rendering from
  device-composed matrices, cells entering and leaving cleanly over a
  sustained fly-through with no growth in device memory; guard test
  green; WebGL path unaffected. Commit.

### Phase 28 — Example, docs, v0.7.0
- New or extended example: a streamed world rendering wholly from
  device-resident transforms, with a CPU/resident toggle and readouts
  for retained device bytes, matrix uploads avoided, and cell churn.
  (Shipped as "matrix uploads avoided", not "readbacks avoided" as
  first written: the metered bytes are `count * 64`, which is the
  matrix upload that did not happen. The avoided *readback* is the
  P/rot/scale columns at 28 bytes per instance — a different number,
  and the label has to name the one it prints.)
- README/llms.txt/authoring: the resident spawner contract, the
  shared-device requirement, the single-asset limitation and its
  fallback reason, the lifetime/ownership rules, and the three
  version dependency. Overview site and hosted demos refreshed.
- Version 0.7.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, example browser-verified,
  release tagged. Commit.

## Phases (v0.8) — multi-asset resident spawns, scheduled 2026-08-07

v0.7's one documented limitation: only a constant `assetId` fuses, and
a spawn driven by `assetAttr` falls back to the CPU path with the
machine-readable reason `"spawn-asset-attr"`. That is not a corner
case — `examples/02-forest` spawns with `assetAttr: "species"`, so the
most representative demo in the repo cannot use the device-resident
path at all.

Feasibility settled before scheduling, and it **inverted the recorded
stretch**. That entry assumed a device-side sort/partition. There is no
need for one: a resident run always starts from a host `Geometry`, and
no resident node can produce a string attribute (`setAttribute`'s
resident predicate requires `type !== "string"`; `run.ts` planning
throws `PlanFail` on a string slot). The asset key is therefore
host-resident at plan time *by construction*. The host plans the
grouping, uploads a permutation, and the device composes once per
asset — no atomics, no prefix sum, no readback. String columns are
already `Uint32Array` indices into a per-attribute table, so there is
nothing to marshal.

Design decisions fixed up front:

- **Host plans the grouping; the device only composes.** The grouping
  shares code with `buildInstanceBatches` rather than re-deriving it,
  so ordering is identical by construction rather than by comparison.
  The device-side counting sort stays recorded and unbuilt, gated on a
  change nothing currently requires.
- **N buffers, not one buffer with per-asset offsets.** three's
  bind-group seam emits `{ binding, resource: { buffer } }` with no
  offset or size, so a sub-range cannot be expressed without an
  upstream change. One detach per asset needs no renderer change and
  keeps the existing identity-keyed refcount correct.
- **Additive and opt-in, again.** The CPU spawner path, the WebGL
  route, and the constant-`assetId` resident path stay byte-for-byte
  as they are.
- **CPU stays the reference.** Grouping order is exact; matrix values
  keep v0.7's f32-vs-f64 compose tolerance.
- **The chain still breaks at the string `setAttribute`.** The
  forest's run fuses exactly one member — the spawn. That is the
  honest number, and the docs and demo readouts must say so rather
  than implying deeper fusion.

### Phase 29 — Host-planned asset grouping in the resident run
- Extract the grouping out of `buildInstanceBatches`
  (`spawn/instances.ts`) into a shared, testable function returning
  `{ order, counts, offsets, perm }`, with the CPU spawner rewritten to
  consume it so exactly one implementation of the ordering spec exists.
  Order is: batches by ascending first-occurrence point index;
  within a batch, ascending point index. `""` merges with
  `defaultAssetId`, and table-index order is *not* batch order, so a
  host-side dense-key remap is required.
- `run.ts`: make
  `InstancesDesc`/`BufRef.out` plural; add a per-step element count and
  a u32 `base` to the uniform header (it fits the existing 16-byte
  padding); one output buffer and one compose dispatch per asset; N
  detaches after the final cancellation check, with exactly-once
  disposal on partial failure. Bump `PLAN_FORMAT`, and `APPLY_VERSION`
  / `SALT_VERSION` if WGSL text moves.
- `makeComposeInstancesApply` gains a `perm` binding and a
  `src = perm[base + i]` indirection; the destination index stays `i`.
- Planner validation rejects the two CPU throws (missing attribute,
  non-string attribute) via `PlanFail`, so the per-node path raises the
  identical message.
- Retire the `"spawn-asset-attr"` opt-out and its reason from the
  source taxonomy. (The doc mirrors — README, llms.txt, authoring,
  nodes.md — belong to phase 31 with the rest of the documentation, so
  the two phases do not both claim them.)
- Not needed after all: allowing `string` attributes as `u32` slots.
  Written into this plan on the assumption that the asset key might
  have to reach the device, it is dead on arrival under host-planned
  grouping — the key never leaves the host, string attributes are
  CPU-only in the compiler, and `setAttribute` rejects string mode, so
  the code would be uncallable. Verified during the phase, not assumed.
- Exit: device batch ids, order and counts identical to
  `buildInstanceBatches` across a fixture matrix covering every edge
  case and determinism item in the survey; matrices within the v0.7
  tolerance; constant-`assetId` and CPU-only paths byte-identical to
  v0.7.0; pool stats show N buffers out and N back across cook →
  evict → recook. Commit.

### Phase 30 — Multi-batch delivery, renderer, and lifetime
- `WorldThreeBinding` and the WebGPU adapter carry N batches per cell.
  The expectation is **no production change on the three side** — the
  phase's first job is to prove that, and the guard test pinning the
  bind-group seam must remain untouched and green.
- Leak and ordering tests extended to multi-batch: partial-build
  cleanup, eviction with several handles per cell, sustained churn
  returning to zero retained bytes.
- Decide and document `stats.dispatches` for per-asset dispatch, and
  note that per-asset pool bucketing makes reported logical bytes
  understate device occupancy.
- Per-asset bounds: either thread `assetId` into the `bounds` callback
  or record the cell-sphere approximation as deliberate.
- Exit: `worldBindingDevice` churn tests green with multi-asset cells;
  no growth in retained device bytes over a sustained fly-through;
  three guard test unchanged and green; browser-verified multi-asset
  resident rendering. Commit.

### Phase 31 — Forest resident, docs, v0.8.0
- `examples/02-forest` runs on the device-resident path with its
  `assetAttr: "species"` intact, with the CPU/resident toggle and
  readouts v0.7's example established — and a fusion readout that does
  not overstate depth (one fused member, not four).
- README / llms.txt / authoring: the resident spawner contract loses
  the single-asset limitation and the `"spawn-asset-attr"` reason; the
  grouping order becomes part of the documented device contract; the
  string-`setAttribute` chain break is documented as the remaining
  boundary.
- Correct the `stats.dispatches` wording, which phase 29 made false.
  "One apply kernel per fused member" holds only at one asset; a
  multi-asset spawn dispatches once per (step, asset). Known mirrors:
  `README.md:429`, `llms.txt:350`, `docs/authoring.md:1030`, and the
  `08-gpu-fields` panel copy. Also record that per-asset pool bucketing
  (256 B floor, powers of two) makes reported logical bytes understate
  device occupancy.
- `examples/09-gpu-world/levels.ts:110-113` still tells the reader that
  single-asset is the supported shape and that `assetAttr` falls back
  to the CPU path. Phase 29 made that false; correct it.
- Version 0.8.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, example browser-verified,
  release tagged. Commit.

## Phases (v0.9) — derived field specs, scheduled 2026-08-07

There are two ways to build a `Field` and only one of them is a
first-class citizen. Author it with `fieldFromJson` and it carries a
`FieldSpec`: it serializes, and it can reach the device. Author it with
the ergonomic combinator API — `component(position(), 1)`,
`ge(randomField("species"), 0.72)` — and it carries nothing.

The consequence people actually hit is **not** the GPU one. A graph
holding a combinator field **cannot be serialized at all**:
`serializeGraph` throws and points at `fieldFromJson`. For a library
whose stated pillar is that graphs round-trip through a stable JSON
format, that is an authoring cliff between the pleasant API and the
supported one. The GPU eligibility is a smaller, secondary gain, and
this cycle should be judged on the serialization fix.

Feasibility settled before scheduling. 40 of 42 exported constructors
can derive a spec from their arguments, and 24 of them through a single
edit in `elementwise()`, whose `kind` string already *is* the grammar
`fn` name. There are no callbacks anywhere in the combinator API, so
the only genuinely spec-less cases are `makeField` (by design), `fbm`
with a non-built-in `base`, and noise over a spec-less `position` — all
covered by one `undefined`-propagation rule. `supportedGpuFieldFns()`
already equals `listFieldFns()`, so no grammar entries and no new WGSL
are needed.

Measured honestly, the fusion gain is small: `02-forest` goes from
1 run / 1 member to 2 runs / 3 members, and `08-gpu-fields` and
`09-gpu-world` gain nothing because they are already spec'd. Say so in
the docs rather than implying more.

Design decisions fixed up front:

- **Device adoption is opt-in, default off**, behind
  `GpuFieldEvaluatorOptions.acceptDerivedSpecs`, mirroring
  `deviceInstances`. This is not caution for its own sake: the GPU path
  is a documented approximation of the CPU one, so making more nodes
  eligible would change output bytes for graphs that never asked for
  it — and README:366 currently *promises* the opposite ("Code-authored
  combinator fields have no spec and stay on the CPU"). The memo salt
  covers cache correctness but not output stability, so it does not
  save us here. With the gate off, every byte and every memo key is
  identical to v0.8.0.
- **Specs are derived, not remembered.** Each constructor composes
  `{fn, args}` from its inputs' specs and propagates `undefined` when
  any input lacks one. `makeField` never attaches, so the escape hatch
  behaves exactly as today.
- **Two descriptions of one field is the new risk**, and it gets tested
  rather than argued: every constructor must satisfy
  `fieldFromJson(getFieldSpec(f))` ≡ `f` byte-for-byte on the CPU.
- **One predicate, not three.** The memo-salt mark, the fusion gate and
  the evaluator's acceptance must consult the same flag through the
  same path, or a node can resolve on device without its key gaining
  the salt — a stale-cache bug.
- **The spec module moves down; the constructors do not move up.**
  `FieldSpec` and its accessors relocate to `src/fields/spec.ts`, and
  `src/nodes/fieldJson.ts` re-exports them, so the public surface is
  unchanged.

### Phase 32 — Derived specs in the field layer
- New `src/fields/spec.ts` holding `FieldSpec`, `FIELD_SPEC`,
  `getFieldSpec` (cloning, public), `peekFieldSpec` (non-cloning,
  internal), `attachSpec`, and a `WeakSet` derived marker. The marker
  must NOT be a key inside the spec object — `checkKeys` rejects
  unknown keys and would break the round-trip.
- `elementwise()` composes `{fn: kind, args}`, covering 24
  constructors at once; `vec`, `component`, `ramp`, `dot`, `length`,
  `normalize` attach individually; `constant`, `attribute`,
  `position`, `index`, `randomField` attach leaf specs.
  `makeNoiseField` attaches `{fn, opts}` including the nested
  `position` spec; `fbm` reverse-looks-up `base` against the built-in
  factories and attaches nothing otherwise.
- Derive from the **normalized** values that already feed the
  structural key, and attach nothing when a value falls outside the
  grammar's accepted domain (non-finite `constant`, empty attribute
  name, non-integer noise seed, …) — code-side validation is looser
  than the parser's, and a spec that would not survive parsing must
  not be produced.
- Swap the hot readers to `peekFieldSpec`; share child spec structure
  rather than cloning per level. Rewrite the two pinned negatives to
  assert the new rule rather than deleting them.
- Exit: a property test over all 40 constructors × an argument matrix
  proving `fieldFromJson(getFieldSpec(f))` evaluates byte-identically
  to `f`; `getFieldSpec` undefined for `makeField` and any tree
  containing one, and for noise over a spec-less `position`; a test
  pinning `elementwise`'s `kind` set equal to the registered fn set;
  existing round-trip tests unchanged and green; **full suite green
  with no resolver, CPU bytes and memo keys byte-identical to
  v0.8.0**. Commit.
- Amended during the phase, deliberately: this originally required
  `getFieldSpec` to be `undefined` for `fbm` with a non-built-in
  `base`. It is not. A custom base built from spec'd octaves composes
  a faithful `add`/`mul` octave tree, and erasing a spec that already
  round-trips would serve the plan rather than the user. Deep cases
  still yield `undefined`, but through the depth rule below rather
  than through the base.
- Also learned the hard way, and now a rule rather than a footnote:
  **derivation must refuse at the same nesting depth the parser
  enforces**, sharing the limit rather than restating it. Producing a
  spec deeper than `MAX_SPEC_DEPTH` let `serializeGraph` emit JSON
  that `deserializeGraph` then rejected — a graph that saves and
  cannot be reopened, which is worse than one that refuses to save.

### Phase 33 — Device adoption, gated
- `GpuFieldEvaluatorOptions.acceptDerivedSpecs` (default `false`),
  advertised on the resolver and forwarded through the stats view
  exactly as `residentTerminals` is.
- Both `execute.ts` predicates and the run planner consult that one
  flag. With the gate off, a derived-spec field resolves on the CPU
  and counts a new reason `"derived-spec"`, distinct from `"no-spec"`,
  which keeps its meaning for genuinely spec-less fields.
- Amended during the phase: `"derived-spec"` is scoped to the
  **per-field** seam only. Making the fusion gate return it as well
  double-counts — a node excluded from a run still falls back
  per-field, and the same cause would be reported twice — and it
  conflates the gate's own `"no-spec"` verdict. The reason answers
  "why did this field stay on the CPU", not "why did this node leave
  the run".
- Parity corpus extended with the derived forms plus the three
  `02-forest` fields, on real hardware against existing per-family
  budgets.
- **Hazard carried over from phase 32's audit:** `fieldFromJson({fn:
  "position"})` permanently stamps an authored spec onto the global
  `position` singleton. Verified identical in v0.8.0, so it is not a
  regression — but once acceptance is gated, one call anywhere could
  make every `position()` in the process look authored rather than
  derived, and eligibility would depend on load order. Settle it here.
- Exit: gate off — every byte and memo key identical to v0.8.0 across
  the full suite including device suites; gate on — a test proving the
  salt mark and the resolver's acceptance agree for every node type,
  so no node resolves on device without `|gpu:` in its key; parity
  green within existing budgets, any overrun reported as a finding
  rather than absorbed. Commit.

### Phase 34 — Serialization, examples, docs, v0.9.0
- **The headline.** `serializeGraph` now succeeds for combinator-field
  params. Rewrite the pinned refusal into a round-trip assertion
  (serialize → deserialize → cook, byte-identical), and keep a
  negative proving a `makeField` param still refuses with the same
  actionable message.
- `examples/02-forest`: enable `acceptDerivedSpecs`, update the
  readouts to the real numbers, and rewrite the "why one fused member"
  panel — including dropping any implication that a spec alone would
  fuse `scale`. Record that the surviving breaks are the two
  `filterByAttribute` nodes and the string `setAttribute`.
- Docs: the eligibility rule, the fallback vocabulary (no longer
  complete without `derived-spec`), the cache-provenance sentence, and
  the serialization section.
- Decide the default: flip `acceptDerivedSpecs` to `true` only if
  phase 33's hardware evidence is clean; otherwise ship opt-in and
  schedule the flip for v0.10 with the evidence recorded.
- Version 0.9.0, tag, GitHub release.
- Exit: full suite green, docs idempotent, `02-forest` browser-verified
  on both toggles, release tagged. Commit.

## Phases (v0.10) — the agent authoring layer, scheduled 2026-08-08

Design fixed up front; the full research plan and the node-library
survey live in the private repo (`notes/research/node-roadmap.md` and
the agent-authoring plan beside it).

- **The pillar this serves.** The library is built to be driven by
  agents: the registry is self-describing, graphs round-trip stable
  JSON, errors name the offender. What is missing is everything
  *around* that surface: authoring feedback needs a bespoke script per
  question (no validate → cook → inspect loop), subgraphs cannot
  expose params, there is no library of reusable subgraphs, and the
  examples are code, not data an agent can read, imitate, or load.
- **No server, no RPC — a CLI.** An agent authors the graph JSON
  directly; wrapping add-node/connect calls in a remote API would be
  more round trips and less reviewable than a diff. The part of a tool
  API actually worth having is its feedback functions, and those ship
  as `pcg` subcommands that serve humans and CI equally. Deferred,
  recorded, not scheduled: a watch-mode process keeping cook caches
  warm across iterations; any live co-editing bridge.
- **Three data layers on top: primitives, examples, skills.**
  Primitives are named, parameterized subgraphs — the vocabulary an
  agent composes instead of reasoning out every wire. Examples are
  complete graphs in JSON — read, imitated, loaded, and cooked in CI
  so they cannot rot. Skills are short doctrine documents in the
  standard Agent Skills format. Every catalog is generated from the
  assets themselves and drift-tested; none are hand-maintained.
- **Errors keep the house rule.** Unknown primitive name, unknown
  param: hard error naming the offender and listing what is valid —
  never a warning that lets a near-miss cook.
- **Sequencing.** Interleaved with the node-library expansion:
  the scaffolding phases need no new nodes and multiply agent leverage
  over the existing 25 immediately; node waves land with the
  vocabulary tiers that need them (paths in v0.11, topology in v0.12).

### Phase 35 — Graph CLI and the feedback loop
- `pcg` bin (pure Node, no new runtime deps): `nodes [type]` /
  `fields` print the registry catalogs (wrapping `listNodeTypes()` /
  `listFieldFns()`); `validate <graph.json>` deserializes and reports;
  `cook <graph.json> [--seed] [--budget] [--stats] [--out]` cooks
  headless and prints per-node stats; `inspect <graph.json> --node
  [--pin]` prints element counts per domain, attribute
  names/types/min/max/mean, bounds, and first-K sample rows; `render
  <graph.json> --out out.svg` draws a deterministic top-down SVG
  (points by attribute, polylines as paths) — the agent's eyes on the
  output, diffable in git.
- Optional `meta` block (`{ title, description, tags }`) in graph
  JSON — optional field, `formatVersion` stays 1.
- A headless Node example (load JSON → cook → stats) — the first
  example that is data, not a page.
- Exit: CLI smoke tests green; same seed → byte-identical SVG across
  two runs; exit codes wired (0 ok, nonzero with the library's message
  verbatim); an agent can author → validate → cook → inspect with no
  bespoke script. Commit.

### Phase 36 — Subgraph params and the named-primitive registry

Amended 2026-08-08 after two design surveys re-derived the mechanics
against source. Four things the original entry assumed turned out to be
wrong, and one prerequisite it did not know about; each correction is
recorded with its reason rather than silently rewritten.

- **Prerequisite, and the phase's real risk: the shared inner `Graph`.**
  A subgraph wrapper writes the inner graph's seed and portal items and
  *then* awaits `cook(inner)`, while `cook`'s overlap guard only engages
  after those writes. Two outer graphs holding instances of one def,
  cooked concurrently, therefore produce TORN results — measured, with
  one graph's item cooked against another's seeds. That is a live
  violation of the library's hardest invariant in shipped code (v0.9.1),
  not a hypothetical, and the named-primitive registry promotes shared
  inner graphs from exotic to normal. Fix first: a critical section per
  inner graph acquired BEFORE the writes (deadlock-free because subgraph
  nesting is acyclic), plus per-reference inner-graph instantiation.
  Also fix, found beside it: cooking a self-wrapping graph hangs forever
  with no error.
- Exposed params on subgraph nodes: schema'd (`ParamSchema` including
  `acceptsField`), forwarded to inner nodes. CORRECTION: "hashed into
  memo keys exactly as native params are" describes work that does not
  exist — values held in the wrapping instance's own `params` record
  already hash correctly with no executor change. The real deliverable
  is that representation constraint (a def-level side table is provably
  incapable of keying correctly, since a def is shared by instances and
  `memoKey()` takes no arguments) plus write discipline: values are
  written inward at COOK time with a quiet write, because a loud one
  would change the transitive version key every cook and the wrapper
  would never cache. CORRECTION: `Field` values surviving end-to-end is
  the easy case, not the hard one — prototyped working, fan-out
  included. Schemas are DERIVED from the inner targets through the
  registry (never hand-written), defaults come from the target's live
  value at wrap time so a tuned primitive keeps its tuning, and fan-out
  requires identical `type`/`enum` across targets with `acceptsField`
  ANDed and bounds intersected.
- Fixes a house-rule violation on the way past: a param set on a
  subgraph instance is silently DROPPED by `serializeGraph` today while
  the reader hard-errors on the same data.
- Named subgraph registry: `registerSubgraph(name, spec)`; serialized
  graphs may reference a subgraph by name instead of embedding; the
  loader resolves from the registry, unknown names error listing what
  is registered. The registry stores a RECIPE (serialized JSON), never a
  live `Graph` or a prebuilt `NodeDef`, because `subgraphNode` mutates
  what it wraps and a live graph can be wrapped exactly once (measured).
  CORRECTION: the content hash is OPTIONAL, not a mandatory pair with
  the name. Mandatory pinning makes every primitive improvement a
  breaking change for saved graphs; optional pinning means name-only
  refs upgrade freely while an author who writes a hash has asked to be
  pinned and gets a hard error on mismatch — so no mode warns and no
  mode cooks a near-miss. Transitive version-key invalidation needs no
  change (it is blind to how a def was built); a name-cycle guard does,
  since the existing object-identity guard cannot see `a -> b -> a`.
- Unknown keys on a serialized node object, and unknown top-level graph
  keys, are silently ignored today. This phase introduces a `ref` key on
  nodes, so a `"refs"` typo would cook as an ordinary subgraph node:
  the leniency is fixed in the same commit that introduces `ref`. (Two
  independent audits reached this defect from different directions.)
- Catalog generator (`docs/primitives.json` + `.md`) reading the
  assets' own meta, with the rendering in a module BOTH the script and
  the test import, so the drift test cannot drift from the generator.
  CORRECTION: there is no CI in this repo — no `.github/` directory
  exists and no drift test exists today. The drift test is a vitest
  test; `docs/nodes.md`/`nodes.json` are unprotected right now and get
  the same treatment retroactively.
- `pcg run <name> [--param k=v] [--in data.json]` — direct
  fire-and-forget execution of a named primitive. `--param` typing is
  schema-directed through the existing `checkParamValue`, and needs a
  repeatable-flag kind (`parseArgs` rejects any repeated flag today).
  CORRECTION: `--in` cannot carry geometry — no JSON representation of
  `Geometry` exists anywhere in the tree — so it binds value items only
  and hard-errors on anything else, via `dataInput` nodes in the
  synthesized wrapper.
- Recorded, not fixed, from the registry audit: the content hash is
  sensitive to `connections` ARRAY ORDER and canonicalization does not
  normalize it, so a semantically identical re-authoring hard-errors
  every pinned graph; and `params: []` on an embedded payload is not a
  serialization fixed point (unreachable for registered recipes, which
  omit the key entirely). Both want a decision when the first real
  primitives exercise pinning.
- Exit: a JSON graph referencing a named primitive with bound params
  round-trips and cooks byte-identically to its embedded form — within
  one build, which is the only place it is achievable: an embedded
  payload freezes the defaults and canonicalization of the build that
  wrote it, and the optional pin hash is what turns cross-version
  divergence from silent into stated. Plus: concurrent cooks of one
  shared inner graph proven deterministic, exposed-param round-trip and
  cache-invalidation tests, catalog generation idempotent, and the
  drift test proven to redden. Commit.

### Phase 37 — Vocabulary v1, spatial index, predicate filters
- `src/spatial`: extract the uniform grid hash living privately inside
  `selfPrune` into a reusable, deterministic, cacheable module.
  `selfPrune` goldens must not move.
- New nodes, first wave: `pointNeighborhood`, `sampleNearestPoint`,
  `attributeReduce`; second wave: `filterByExpression` (a boolean
  `Field` predicate — the params-accept-fields pillar finally reaching
  the filter family), `attributeRemap`.
- **Added after the vocabulary survey, and load-bearing for this phase's
  own exit criterion: a mesh SOURCE node.** Nothing in the library can
  produce mesh or polyline geometry in-graph — `dataInput` is the only
  door and it carries nothing through serialization, so five of the
  proposed primitives (the whole `place/` family and
  `transform/align-to-surface`) cannot cook from JSON at all. That
  collides directly with "every primitive validates and cooks in CI"
  here and with phase 38's all-JSON corpus. One cheap node (a
  subdivided plane, ideally a box too) unblocks all of it. This is the
  THIRD independent sighting of one gap: phase 35 found `pcg render`'s
  primitive path unreachable from any graph, phase 39 was already
  scheduled around `pointsToPath` for the same reason, and now the
  vocabulary cannot be built without it.
- **Also added: attribute deletion.** There is no way to remove an
  attribute, so every workaround leaves a permanent debris column
  (measured). Cheapest fix in the survey and it touches many primitives.
- **`filterGroup` is DEFERRED, not built.** The survey found nothing in
  the vocabulary can use it: the only tag producer
  (`partitionByAttribute`) emits a collection, and the exposed-pin model
  has no collection-shaped output. Settle what it filters before
  building it; a node no primitive can reach is not vocabulary.
  - *Correction, re-survey 2026-08-09: the DEFERRAL stands but the
    reason above is wrong, and would send whoever picks this up next
    hunting a mechanism that already exists. Pins ARE collection-shaped
    (`DataCollection = DataItem[]`, and subgraphs forward the whole
    array). The real blocker is that `requireGeometry` takes item[0] and
    discards the rest, so the collection never survives into a node.
    `filterGroup` itself is ~30 lines on top of `filterByTag`; it stays
    inventory until for-each semantics exist, not until pins change.*
- The first ~30 primitives across shape / fill / transform / compose /
  filter / place / write, built on the node set above; all catalogued.
  Names are `<family>/<kebab-case>`: node types are camelCase with no
  separator, so the slash makes the two impossible to confuse, and the
  prefix is the only place a family can live — a registry record carries
  no category, so name-sorted `listSubgraphs()` groups by family for
  free. The rule for what earns a primitive: it must contribute
  STRUCTURE (two or more wired nodes) or one node plus a non-trivial
  default field expression encoding real domain knowledge. Never a
  rename, a re-default, or a hidden param.
- **What exposed params cannot express** (measured against the shipped
  mechanism, so the vocabulary must be designed around it): a param is
  pure fan-out of one identical value, so no arithmetic — a `radius`
  cannot produce `[-r,0,-r]` and `[r,0,r]`; no cross-type fan-out; and
  NOTHING INSIDE A FIELD SPEC is reachable, which includes every noise
  `seed`, `frequency` and `offset`. Two idioms recover most of it and
  both are proven working: a "parameter attribute" (expose a scalar into
  a `setAttribute` that a downstream field reads back) and unit-space
  construction with a trailing `transformPoints`.
- **Noise variation needs the second idiom, and the docs must say so.**
  `setAttribute.seed` re-rolls context-seeded randomness (`randomField`
  — verified) but NOT noise, because a noise field carries its own seed
  inside its spec (verified: identical output at seed 0 and 99). Since
  exposed params cannot reach inside a spec, a noise-bearing primitive
  offers variation by exposing an upstream position offset, not a seed.
  The `setAttribute.seed` description says "re-rolling field randomness"
  and must be narrowed to say which randomness, or it reads as a promise
  it does not keep.
- **Fix while building the vocabulary, from the same survey:** fanning
  an exposed param across targets with differing `acceptsField` ANDs the
  capability away with NO diagnostic — a `density` knob over
  `surfaceSample.densityField` plus `filterByDensity.threshold`
  registers clean and silently stops accepting fields, which was the
  entire point of the knob. The merge itself is right; its silence is
  not. Let a declaration ASSERT `acceptsField: true` and hard-error
  naming the target that refuses, the same opt-in strictness the content
  hash uses.
- **Wire the assets to the tools.** Phase 36 shipped the registry
  mechanism, the catalog generator and `pcg run`, and all three work —
  but nothing is registered, so the catalog is a (deliberately explicit)
  empty file and `pcg run` can only report that no subgraphs exist.
  Registration happens by importing the module that declares them, so
  when the assets land behind `pcg-ts/primitives`, the CLI and the
  catalog generator must import that subpath or they will keep reporting
  an empty registry while the primitives sit in the package. Also then:
  add `docs/primitives.md`/`.json` to package.json `files` (left out
  while nothing references them) and pin them in the bin test the way
  the node reference is pinned.
- Exit: the reference regenerated for the new node set (five from the
  waves above, plus the mesh source and attribute deletion, minus the
  deferred `filterGroup`); every primitive validates and COOKS FROM JSON
  in the suite — no primitive may depend on `dataInput` to be
  exercisable, which is what the mesh source is for; double-cook
  determinism over the primitive set; `pcg run <a real primitive>` cooks
  from a clean install, and the catalog is non-empty. Commit.

### Phase 38 — Example corpus, skills, docs, v0.10.0
- ~20 single-concept examples (`examples/graphs/basics-*.json`), each
  meta-described and named by what it teaches; generated index
  (`docs/examples.json` + `.md`).
- Skills: `graph-authoring` (prefer primitives; read the catalog and
  an example before building; parameterize, don't hardcode; the
  validate → cook → inspect loop) and `determinism` (seeds,
  hash-combining, how to verify). Skills cite the generated references
  and never embed listings that can drift stale.
- Corpus CI: validate + cook under budget + golden count-level stats
  (element counts, attribute presence, bounds within tolerance — not
  float dumps, or the suite fights every legitimate change).
- llms.txt gains the generated index sections; README/authoring
  document the CLI and the primitive library. Version 0.10.0, tag,
  GitHub release.
- Exit: corpus green including double-cook determinism; docs
  idempotent; release tagged. Commit.

## Phases (v0.11) — paths and the pipeline corpus, planned 2026-08-08

Planned from the same research pass; re-survey at cycle start per the
usual protocol before treating the phase split as fixed.

### Phase 39 — Path authoring, vocabulary v2
**Re-surveyed at cycle start 2026-08-09 as the note above requires. The
split below REPLACES the planned one: two of the five planned nodes are
cut, two backlog items are folded in, and the representation question
the plan left open is settled here.**

- `pointsToPath` — the unblocking node, and the reason the phase exists.
  Confirmed from two independent directions: the library has a polyline
  CONSUMER (`splineSample`), a polyline TYPE (`primtype`), a `pcg
  render` branch and a `pcg inspect` branch — and ZERO in-graph
  producers. All nine `splineSample` call sites are TypeScript or
  `dataInput`; not one cooks from serialized JSON, and its own error
  message tells JSON authors to build polylines with `createPolyline`,
  a function a JSON author cannot call. This is the same shape as the
  mesh gap phase 37 closed, and the fifth sighting of the one gap.
  Precisely: it is the only node that turns a point CLOUD into a path.
  `pathResample` also writes polyline topology, but only onto a path it
  was handed — it can continue a path and never start one.
- **Representation: reuse, do not extend.** A path is what
  `createPolyline` already emits, and closure stays STRUCTURAL — a
  trailing vertex referencing point 0, which is what `splineSample`
  already detects. An explicit `closed` primitive attribute was
  considered and REJECTED: nothing would read it, so it is a debris
  column that can disagree with the structure that is actually
  authoritative — precisely the failure `removeAttribute` was added to
  clean up. A new `PrimType` was also rejected: it forces edits at four
  consumers and collides with phase 41, the scheduled data-model
  expansion. Build through a `src/data` factory the way `meshPrimitive`
  does; a node never touches `setTopology` itself.
- `pathResample`, which REQUIRES extracting `splineSample`'s arc-length
  table (today a local `cum[]`/`segDir[]` concatenated across every
  polyline at once) into a shared helper, then re-expressing
  `splineSample` on it. `splineSample`'s existing goldens must not
  move — that is the proof the extraction was behavior-preserving, the
  standard `selfPrune`'s goldens set in phase 37.
- `writeTangents` ONLY IF a path primitive consumes it. `splineSample`
  already emits `tangent` and `orientAlongVector` already reads it, so
  the node exists to serve paths that were not spline-sampled. It ships
  with its caller or it does not ship.
- **`pathSmooth` and `pathFuseCollinear` are CUT.** The re-survey found
  zero references to either outside this plan — no caller, no
  primitive, no example, no demo. That is the same bar that deferred
  `filterGroup`: a node no primitive can reach is not vocabulary. The
  plan does not get an exemption from its own rule.
- **Folded in from the node-capability backlog** (kept with the research
  notes), both path-adjacent, both fixing something already shipped
  rather than adding a wish:
  - `pointLine` gains an exclusive-end mode. `shape/ring` currently
    carries an entire extra `filterByExpression` node to drop the
    duplicate seam point, which makes its `count` mean "count − 1".
    Note the primitive needs BOTH modes and an exposed param cannot
    derive one from the other (no arithmetic in fan-out), so the
    rewiring is a real edit, not a flag flip.
  - The missing `ne` field function is added. `filterByExpression`'s own
    description advertises `ne` to agents and no such function exists —
    error messages and descriptions are the agent API, so this is a bug
    against a shipped surface, not a feature request.
- Trace/subdivide-verb primitives — the first curve family, since 0 of
  the 29 shipped primitives touch a polyline — and path basics
  examples. The corpus has no path example and its golden harness
  already pins per-domain counts, so it needs only a source.
- **Drift to fix in-phase, both found by the re-survey:** llms.txt
  claims `meshPrimitive` feeds "splineSample's mesh-side neighbours",
  but it emits `poly` and `splineSample` skips non-`polyline` prims;
  and `shape/ring`/`shape/spiral` are tagged `curve` while emitting
  point clouds, so an agent chaining ring → `splineSample` by tag hits a
  hard error. Both are promises to an agent that the code does not keep.
- **Topology is fragile and the node descriptions must say so.** Every
  path op must clone, and a path flowing through a filter stops being a
  path — an agent will hit this on its first graph if nothing warns it.
  - *Correction, verified against source during the docs pass: the rule
    is NOT "every filter drops topology", which is how the survey put it
    and how this plan first recorded it. It is every op that REMOVES
    POINTS, because those route through `gatherPoints`. `projectToPlane`
    is categorised `filter` and preserves topology (it clones); and
    `partitionByAttribute` is categorised `attribute` and DROPS it. So
    the category is not the predicate — removing points is. Stated the
    wrong way, an agent trusts `partitionByAttribute` and distrusts
    `projectToPlane`, both backwards.*
- Exit: nodes tested and the reference regenerated; `splineSample`
  goldens unmoved across the helper extraction; path primitives
  catalogued and cooking FROM JSON with no `dataInput`; path corpus
  green including double-cook determinism. Commit.

### Phase 40 — Staged pipeline, skills v2, docs, v0.11.0
- One staged pipeline in the corpus (settlement-scale: boundary →
  districts → lots → detail), each step a graph extending the
  previous; base + edits variants.
- `performance-and-budgets` skill (SoA rules, partitioned cooking,
  reading cook stats). Docs; version 0.11.0, tag, GitHub release.
- **Backlog candidates, re-validated 2026-08-09** and carried here
  rather than into 39, which is already full:
  - A per-point miss flag on `transferAttribute` — the best cost/payoff
    in the backlog. The per-point `hit` array ALREADY exists inside
    `transferMapping`; only a detail-domain total is exposed. Today
    `place/drop-to-surface` casts a second ray and stamps a marker
    purely to recover what the first ray knew: five nodes where three
    would do. It is also where phase 37's mutation testing found a real
    bug, so deleting the workaround deletes the bug's surface.
  - A `fraction`/element-count field input. Both runtimes already have
    the number (CPU `elementCount`, and the GPU kernel already carries
    `params.count` as a uniform). The cost is not the arithmetic: every
    grammar function is a fixed five-site change including a WGSL
    handler, because the GPU corpus test pins the corpus to
    `listFieldFns()` and requires every entry to compile. No CPU-only
    escape hatch exists, by design.
  - A field-capable `setBounds` is DROPPED, not deferred: the backlog
    claim was overstated. `setAttribute` is already field-capable and
    writes any name at tuple 3, so per-point bounds are already
    expressible; and the examples cited as "restating constants" restate
    an aggregate bounding SPHERE for culling, which per-point bounds
    would not remove. Recorded so it is not re-derived later.
- Exit: every pipeline step cooks in CI; docs idempotent; release
  tagged. Commit.

### Carried out of phase 40 — reporting slots that still clobber

Phase 40 closed a class of silent data loss: a param naming an attribute
the NODE shapes (a "reporting slot") used `replace()`, which deletes and
re-adds on a shape mismatch — so `hitAttr: "P"` turned positions into a
`bool` column with no error, producing a plausible-looking cook. Fixed on
`transferAttribute` (`hitAttr`, `missCountAttr`) and `pointNeighborhood`
/ `sampleNearestPoint` (`countAttr`, `averageOutAttr`, `distanceAttr`,
`indexAttr`): a differently-shaped existing column is refused, a
same-shaped one is still reused and reset.

Three sites were found with the same hole and NOT fixed, because they
were outside the fixing agent's ownership. They are cheap and should go
together, not one at a time:
- `attributeReduce.outName` (`src/nodes/attributes.ts`, detail domain,
  u32×1 and f32×ts) — a genuine reporting slot, same clobber.
- `writeTangents.name` (`src/nodes/paths.ts`, f32×3) — guards only
  `name === "P"`; any other differently-shaped column dies silently.
- `attributeRemap.outName` (`src/nodes/attributes.ts`, always f32×ts) —
  **borderline, think before copying the rule**: an in-place i32→f32
  remap is intended usage, so a blanket refusal would break a legitimate
  case. This one needs a narrower rule than the other two.

Also carried: the guard helper is currently duplicated locally in two
modules. `src/nodes/util.ts` is its home, but it must NOT simply be
exported from a node module — `src/nodes/index.ts` does `export *`, so
that would leak it into the public package surface.

## Phases (v0.12) — topology, planned 2026-08-08

The one genuine data-model expansion in this arc (edges/adjacency),
carrying its highest determinism risk. The encoding decision (an edge
domain vs. paired datasets vs. side-car CSR) and the halo/tiebreak
policy are recorded as open questions in the survey and must be
settled before implementation. Re-survey at cycle start.

### Phase 41 — Topology, vocabulary v3, docs, v0.12.0

**RE-SURVEYED at cycle start 2026-08-09, as this section required. The
phase SPLITS. Three surveys — encoding, determinism, demand — agreed
that the phase as written cannot be built in one pass, and the reason is
a prerequisite nobody had priced. Original text preserved at the bottom
of this section.**

#### The three settled questions

**Encoding: side-car CSR** in `src/spatial/adjacency.ts`, following
`uniformGrid`'s precedent and NOT re-exported from `src/index.ts`. An
edge DOMAIN was costed at ~20 hand-edited files, takes `promote`'s
ordered-pair matrix from 12 pairs to 20 (8 new pair semantics, several
with no natural meaning), and permanently widens the exported `Domain`
union. The decisive argument is not cost, it is staleness: a side-car
cannot go stale, because `cloneGeometry` returns a new object, so the
index is simply absent and recomputed. An edge array living ON the
geometry rides that clone into all seven-plus topology-destroying nodes
and must be dropped at each — failing SILENTLY into a cook that still
looks fine, which is the failure class this codebase names as its worst.
Promoting a proven CSR to a domain later is additive; the reverse is the
expensive mistake. No option forces a format bump: the serialized format
never carries geometry.

**Tiebreak: hash stable element IDENTITY, never index.** Identity is
`(bits(Px), bits(Py), bits(Pz), seed)` — the u32 bit pattern of the
stored f32 position plus the standard per-point `seed`. Order by (1) the
op's metric, (2) `pointKey` ascending, (3) the raw tuple componentwise
to break hash collisions. Edges canonicalize their endpoints the same
way. NEITHER identity alone works, both verified: `seed` defaults to 0
for hand-built and `dataInput` clouds and collides after `copyToPoints`,
while position alone collides on coincident points, which `snapToGrid`
deliberately creates. Never pass a float to `hashCombine` — it truncates
toward zero.

**Halo: derived, never fetched.** A cell recomputes its halo from
`(worldSeed, levelIndex, coords)` the way noise does. `World` exposes no
sibling accessor, and `cells3d.test.ts` already pins "a cube's content is
independent of which neighbours exist" as a contract — a fetched halo
breaks it, and neighbours are LRU-evictable anyway.

#### The blocker that splits the phase

**No existing source is halo-derivable, so no cross-partition op can be
correct yet.** `pointScatterInBounds` computes positions as a FUNCTION OF
THE BOUNDS, so widening the bounds to form a halo moves every point and
reproduces nothing. A world-anchored scatter — points as a pure function
of the world lattice cell — is a prerequisite for all of this and is not
in the phase.

Also recorded, because it changes what phase 40's test proves: the
executor yields AFTER `cookNode` returns, so **node bodies are atomic
under a budget**. The 34-graph partition-safety test guards
time-partitioning and can never catch a data-partitioning bug. The
cross-partition ops need different tests: permutation equivariance,
split-with-halo equals whole, two-cell seam agreement.

#### The re-cut, decided 2026-08-09

One phase becomes three, because the prerequisite is not a topology
prerequisite. Direction given at the time: **prioritize the most solid
long-term construction; breaking compatibility is free, because the
package has zero users.** That removes cost-of-migration from every
decision below — but note it does NOT change the encoding choice, whose
decisive argument was silent staleness, not migration cost.

- **Phase 41** — priority pruning and the carried fixes. v0.12.0.
- **Phase 42** — world-anchored sources: close the hole in the runtime
  pillar, on its own merits.
- **Phase 43** — topology, shipped with its consumer.

**A single-partition-only topology was considered and REJECTED** even
though it is the cheapest path to edges. It ships a permanent
restriction into the public API, and a restriction is the one thing that
cannot be retracted later without changing behavior for whoever worked
around it. It also costs the pillar: "deterministic by construction"
with an asterisk is a weaker claim than the one the agent-authoring
thesis rests on. Zero users makes breaking changes free; it does not
make a shipped exemption free, because the exemption would be a
permanent design fact rather than a migration.

#### Phase 41 — priority pruning and carried fixes, v0.12.0

No topology. Everything here has a caller today.

- **`selfPrune` gains priority**, which is what `pruneByPriority` really
  was. It is the only item in the original four with a workaround
  already shipped: `pipeline-3-lots-edits.json` gets authored-beats-
  procedural by placing authored points on pin `a` of
  `compose/merge-tagged` so the index-greedy prune keeps them, and
  `docs/examples.md` documents that as winning "BY CONSTRUCTION rather
  than by luck". Extend rather than add a node: multiple inputs, a
  priority attribute, and a field-capable `minDistance` (the per-point
  radius that has been open in the backlog since before phase 37).
  Existing goldens must not move — greedy stays the default rule.
- Rewire the pipeline edits variant onto it, so the trick becomes a
  parameter and the corpus stops teaching a workaround.
- Sweep the three carried reporting-slot clobber sites recorded below.
- Docs; version 0.12.0, tag. (Publish stays user-driven.)
- Exit: `selfPrune`'s existing goldens unmoved; the edits variant still
  proves edit locality; corpus and catalog green; docs idempotent.

### Phase 42 — World-anchored sources, cross-partition foundations

**Scheduled on its own merits, not as topology's tax.** The runtime
pillar claims hierarchical generation across grid levels with an
unbounded level above and partitioned, cancellable cooking. It does not
hold for any op that must see slightly outside its own cell, because
`pointScatterInBounds` computes positions as a FUNCTION OF THE BOUNDS
(`src/nodes/sources.ts`): widening the bounds to form a halo moves every
point, so the halo reproduces nothing. Every neighbourhood-style op
inherits this, not just edges.

- A world-anchored scatter: point positions as a pure function of
  `(worldSeed, levelIndex, cellCoords, index)`, so any window over the
  world yields the same points for the region it covers. This is the
  same discipline noise already follows, applied to a source.
- The halo contract, made real and documented: a cell DERIVES its halo
  from world coordinates, never fetches it from siblings. `World`
  exposes no sibling accessor, neighbours are LRU-evictable, and
  `cells3d.test.ts` already pins "a cube's content is independent of
  which neighbours exist" — a fetched halo would break a contract the
  suite asserts today.
- **The three test kinds that do not exist yet**, and are the real
  deliverable: permutation equivariance (shuffle input order, same
  output), split-with-halo equals whole (cook a region whole, then in
  cells, compare), and two-cell seam agreement (both sides of a boundary
  agree on who owns what). Phase 40's partition-safety test cannot cover
  any of these: the executor yields AFTER `cookNode` returns, so node
  bodies are atomic under a budget — that test guards time-partitioning
  only.
- Exit: a world-anchored source cooking in the corpus; the three test
  kinds green over it; a documented halo contract; docs idempotent.

### Carried out of phase 42 — the identity/fusion invariant

Recorded because it is the one permanent cost of keying randomness on
identity, and because someone will eventually try to "optimize" the
guard away and silently reintroduce a divergent world.

**A device-resident run may rewrite `P`, or key on identity, but not in
that order.** Position bits became a KEY, so a one-ulp difference in `P`
is no longer a small error but an unrelated random number — measured at
up to 2.08e-1 on 99.5% of components. The guard lives at
`src/gpu/run.ts` (`identity after P write`).

Three narrowings were investigated during phase 42 and ALL THREE closed
off by measurement, not argument. Do not reopen them without new
evidence:
- *"Decline only when the identity-keyed member actually reads the
  written `P`"* — a provable no-op. A compiled `randomField` takes
  `[P, seed]` as kernel inputs in every grammar position tested, and
  there is no dead-code elimination, so no admitted spec keys on
  identity without reading `P`.
- *"Allow it when the `P` write is bit-exact"* — cannot be a param-only
  predicate. Whether `v*s + t` is exact depends on each point's
  exponent, which is the DATA, not the params the planner can see. The
  maximal safe window would also need signed-zero behavior and
  operation order pinned across two implementations, and would lapse
  silently if either were refactored.
- *"Allow it when the member's output is not position-dependent"* —
  refuted directly: `randomField` is by construction a discontinuous
  function of position bits.

What is NOT true, and was my own first conclusion before the
measurement came back: identity-keyed chains are not barred from being
device-resident. `[tint, psize]` plans fine. Only the ORDER is barred.

### Phase 43 — Topology, shipped with its consumer

Schedulable only once phase 42 lands AND a pipeline stage 5 — a road
network between district centres — is committed as the deliverable. The
vocabulary ships with its caller, the rule `writeTangents` was held to
in phase 39. Three of the four originally planned nodes had no caller;
this is what earning one looks like.

- Adjacency as a side-car CSR in `src/spatial/adjacency.ts`, following
  `uniformGrid`'s precedent, not re-exported from `src/index.ts`.
- `connectPoints` over the neighbour lists `pointNeighborhood` already
  computes and discards — **plus an edges-to-polylines node, which the
  original plan omits.** Nothing can consume edges today: `pointsToPath`
  lays a path over the SAME points with one group id each, so a vertex
  of degree > 1 is structurally inexpressible. That is the phase-39 gap
  in reverse — a source with no sink — and both must ship in one wave.
- Radius mode only at first. A `k`-nearest mode is a rank over the
  present population, which is the fit-to-data trap phase 40 recorded;
  radius mode is halo-exact at `haloWidth >= radius`.
- `refineCluster`: MST mode ONLY. Six of its seven proposed modes have
  zero references outside the roadmap, and the name collides with
  `fill/scatter-clustered`, which already means clumps-with-no-edges.
- **`findPath` is CUT as specified.** No finite halo suffices for a
  global shortest path. If it returns, it is restricted to an unbounded
  or single-partition level with results pushed down through
  `ctx.parent.outputs` — and that restriction is the design, stated up
  front, not a footnote discovered later.
- **Revisit the encoding once, here, and only on this trigger:** the
  side-car was chosen because a derived index cannot go stale, while an
  edge array on `Geometry` rides `cloneGeometry` into every
  topology-destroying node and fails silently. That argument covers a
  DERIVED index. If edges need user-facing ATTRIBUTES — road width,
  kind, authored per edge and promoted or transferred like any other —
  then they are authored data, not a derived index, and a real edge
  domain becomes the correct answer rather than the expensive one. With
  zero users the ~20-file cost and the widened `Domain` union are
  affordable; what must not happen is drifting into a half-domain
  because the side-car was already there.

#### The original exit criterion was unsatisfiable

"The survey's 15-node batch is complete" cannot be met: `filterGroup` was
deferred in 37, `pathSmooth` and `pathFuseCollinear` cut in 39, so 12 is
the ceiling — and phase 39 shipped two items that were never in the
batch. Replaced above with criteria that can actually fail.

<details>
<summary>Original phase 41 text, before the 2026-08-09 re-survey</summary>

- Edge/adjacency topology with materialized CSR adjacency, built
  deterministically and cached per input.
- New nodes: `connectPoints`, `refineCluster`, `findPath`, and
  `pruneByPriority` with an explicit halo/tiebreak policy (hash
  tiebreak — never arrival order, never partition completion order).
- Connect-verb primitives; network examples (paths between scattered
  points).
- Docs; version 0.12.0, tag, GitHub release.
- Exit: the survey's 15-node batch is complete; cook-order-independence
  tests for the cross-partition ops green; catalog and corpus green;
  docs idempotent; release tagged. Commit.

</details>

## Stretch — surveyed and NOT scheduled

- **Rescaling the shared noise convention so an amplitude knob reaches
  its stated bound.** Measured 2026-08-09 across all 34 primitives.
  **Recommendation: do not schedule.** Every noise-amplitude param
  under-delivers, because the catalog's shared `amp × remap(normalized
  fBm)` term normalizes against fBm's THEORETICAL range while its
  realized range is far narrower: `transform/displace-by-noise` reaches
  0.42 of its promised `±amount`, and the threshold knobs on
  `filter/mask-by-noise` and `fill/volume-by-noise` do all their travel
  inside 0.32–0.68 rather than 0–1. The obvious fix is a two-line
  constant rescale in `tunableFbm`, and it is wrong: utilization is NOT
  a constant — 0.42 on a wide 2D cloud, 0.50 in 3D, 0.25 on a patch
  spanning about one period — so a constant factor converts systematic
  UNDER-delivery into position-dependent error, overshooting to 1.17×
  on wide high-frequency clouds. An `amount` that sometimes EXCEEDS its
  stated bound is worse than one that reliably undershoots it. A
  per-cook fit to the realized range would be exact and breaks the
  determinism invariant outright: under partitioned cooking each
  partition would fit its own range, so the same point would move
  differently depending on how the work was split. What shipped instead
  is the honest alternative — every one of these params now documents
  its measured law and band, with tests pinning them. If a
  true-amplitude knob is ever wanted, add it opt-in beside the existing
  one; do not move what already ships.

- **Device-produced asset keys** (make `setAttribute` resident in
  string `values` mode). Surveyed 2026-08-07; **recommendation: do not
  schedule.** Recorded here so it is not picked up later on the
  premises it was written with, all three of which the survey broke:
  - *"It would extend the forest's run to its full chain."* It would
    not. Every field in `examples/02-forest` is code-authored and
    carries no `FieldSpec`, and fusability requires all field params to
    be spec'd — so widening the resident predicate moves the forest
    from 1 fused member to 1. The benefit is zero, not small.
  - *"It would finally require the stable counting sort."* It would
    not. WebGPU has no device-side allocation, and the host must know
    each batch's `assetId` (a string), its `count`, and how many
    batches there are before it can allocate. A readback is therefore
    unavoidable in every candidate design, and all of them pay the same
    mid-run pass split. The only question is how many bytes ride an
    already-paid round trip — reading back the key column is `n * 4`
    against a constant `2K`, i.e. microseconds of bandwidth against a
    sub-millisecond latency. Buying that with the repo's first atomics,
    first workgroup-shared memory and first cross-workgroup scan — and
    a determinism proof argued rather than inherited from
    `groupPointsByAsset` — is a bad trade.
  - *"The kernel writes `lut[clamp(floor(selector), 0, last)]`."* Not
    portable: the CPU semantics are `floor`, then `!(idx > 0) -> 0`,
    which is deliberately NaN-safe (NaN selects index 0). WGSL `clamp`
    carries no such guarantee, so that body would violate the
    determinism invariant.

  If it is ever revisited, the design to build is the cheap one: read
  back the key column and reuse the shipped `groupPointsByAsset`.

- ~~**The better opener:** give code-authored field combinators their
  own `FieldSpec`s.~~ Surveyed and **scheduled as v0.9, phases 32-34**
  above. The survey confirmed it is cheap but reframed the reason: the
  GPU gain is small (`02-forest` 1 member → 3), while the real cost of
  today's behaviour is that a graph holding a combinator field cannot
  be serialized at all.

- **A `resident` descriptor for `filterByAttribute`** (a count-changing
  resident member). Surveyed 2026-08-08; **recommendation: do not
  schedule.** Feasible, and cheaper than this entry assumed — the
  data-dependent count is *not* the blocker v0.9's survey found for
  device-produced keys, because the input count bounds every
  allocation, no field's value depends on the element count, and the
  surviving count rides the run's existing readback as four extra
  bytes. Two findings settle it anyway:
  - **It does not compose with the zero-round-trip path.** At a spawner
    terminal the surviving count sizes a retained buffer and there is
    no readback for it to ride (`needsGeometry === false`). So a run
    may never contain both a count-changing member and an instances
    terminal — the feature is architecturally exclusive with what
    phases 26-30 built, which is the line this project has invested
    most in.
  - **The forest's entire saving is free today.** Moving
    `setAttribute("scale")` ahead of the two filters in
    `examples/02-forest` buys the same one readback for zero library
    work (different random scales, equally valid). Any estimate of this
    feature must be net of that, and net of it the benefit is close to
    nothing.

  It would also retire the safety argument at `run.ts:11-18` — "every
  kernel touches only element `i`" is why attribute buffers are bound
  in place as `read_write`, and a prefix scan breaks that. If it is
  ever revisited, build the cheap shape: host-normalized
  `(comparison, f32 threshold)`, a global ping-pong scan with **no
  atomics** (an atomic bump would make survivor order nondeterministic),
  a device-side count word, and materialization reusing the shipped
  `gatherPoints` so the ordering spec keeps one implementation — the
  shape v0.8 and v0.9 both converged on. And gate it on a measurement:
  the scan must beat the round trip it eliminates at the counts the
  examples actually use.

  Full survey: `notes/research/v10-resident-filter-survey.md` in the
  private repo, including a phase breakdown if it is scheduled anyway.

- ~~**Free and unscheduled:** reorder `examples/02-forest` so
  `setAttribute("scale")` precedes the two filters.~~ **Done**
  2026-08-08 (`0ed9290`): 2 runs / 4 members, one readback fewer, no
  library change. It captured the entire benefit the resident-filter
  descriptor above was going to be built for.

- **Per-cause serialization refusal messages.** `fieldToJson` refuses
  with one message that *enumerates* all three causes — a `makeField`
  closure, anything composed over one, and a tree past
  `MAX_SPEC_DEPTH` — rather than naming the one that actually applies.
  `serializeGraph` prefixes it with `node "<id>" param "<key>"`, so the
  location is always exact; only the cause is ambiguous. CLAUDE.md
  treats error messages as part of the agent API, and "it is one of
  these three" is weaker than this library's standard elsewhere.
  Not fixable in the message alone: nothing records *why* a spec is
  absent, because `undefined` propagates up the derivation without a
  reason. Needs a reason carried alongside the withheld spec (the depth
  `WeakMap` in `src/fields/spec.ts` is the obvious place), then the
  three call sites in `fieldToJson` discriminate on it. Small, and
  worth doing the next time `src/fields/spec.ts` is open for another
  purpose.

- **Give `04-infinite-world` a GPU evaluator.** It has `09-gpu-world`'s
  shape authored with combinators, so it became the natural showcase
  once v0.9 landed — but it is example work, not library work.

Full survey: `notes/research/v09-device-keys-survey.md` in the private
repo.

## Execution notes (unattended)
- Phases run in order; no phase starts until the previous phase's exit
  criteria pass.
- Per CLAUDE.md: bulk implementation of a phase may be delegated to a
  subagent owning that phase's files; nontrivial phases get an independent
  verification agent before being marked complete.
- After every phase (and significant mid-phase milestone): run full tests,
  update `status.json`, regenerate `status.html`, commit `phase(N): ...`.
- Blockers that need a user decision are recorded in status.json under
  `blockers` and surfaced in status.html rather than stalling silently —
  pick the most reasonable default, note it, and continue.
