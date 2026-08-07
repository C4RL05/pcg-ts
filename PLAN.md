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

## Stretch (recorded, not scheduled)
- Device-side multi-asset grouping: sort/partition points by asset id
  on device so `assetAttr` spawns fuse instead of falling back.

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
