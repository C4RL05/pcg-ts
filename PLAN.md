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

## Core type sketch (anchor, refine during phases)

```ts
type Domain = 'point' | 'vertex' | 'primitive' | 'detail';
type AttrType = 'f32' | 'i32' | 'u32' | 'bool' | 'string';

// SoA storage: one typed-array column per attribute, with tuple size.
interface AttributeSet {
  add(name: string, type: AttrType, tuple: number): Attribute;
  get(name: string): Attribute | undefined;
  count: number; // elements in this domain
}

// Geometry holds one AttributeSet per domain plus topology
// (vertex->point map, primitive ranges). Points-only data is the
// common fast path of the whole library.
interface Geometry { attrs: Record<Domain, AttributeSet>; /* topology */ }

// Standard point attributes: P (f32x3), rot (quat f32x4), scale (f32x3),
// density (f32), boundsMin/Max (f32x3), color (f32x4), seed (u32).

// Fields: deferred computation resolved on a domain.
interface EvalContext { geo: Geometry; domain: Domain; seed: number; }
interface Field<T> { evaluate(ctx: EvalContext): Column<T>; }
// Node params accept T | Field<T>. Combinators: math, clamp/lerp/remap,
// select, ramp; inputs: position(), attribute(name), index(), noise fields.

// Graph: code-first builder, typed pins, multi-data pins carrying
// DataCollection (tagged list of Geometry | spatial | param data).
// Execution: pull-based topological, memoized by content hash of
// (inputs, params, seed); async time-budgeted scheduler, cancellable.

// Hierarchical runtime: configurable grid levels (cell sizes) + one
// unbounded level; per-cell seeds hashed from (graphSeed, level, cx, cy);
// cells cook on demand around a viewpoint, LRU eviction, dirty
// propagation for invalidation.

// Spawner protocol (render-agnostic terminal): emits
// InstanceBatch { assetId, transforms: Float32Array /* 4x4 per instance */ }.
// The three adapter maps InstanceBatch -> THREE.InstancedMesh.
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

## Stretch (recorded, not scheduled)
- WebGPU compute subgraphs; uv/raycast attribute transfer; interactive
  graph editor UI (Svelte).

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
