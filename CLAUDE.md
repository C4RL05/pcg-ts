# pcg-ts

A procedural content generation (PCG) library for TypeScript with
optional three.js interop, built for real-time use. Runs in the browser
and Node. Deterministic by construction.

## Design pillars

Three foundations, each carried through the whole library:

- **The data model.** Attributes live on domains (point / vertex /
  primitive / detail) with promote and transfer between them. The PCG
  "point with attributes" is the point domain plus standard attributes
  (transform, density, bounds, color, seed).
- **The runtime.** Hierarchical generation across grid levels with an
  unbounded level above, partitioned (budgeted, cancellable) cooking,
  spawners as first-class graph terminals. GPU subgraphs are a recorded
  stretch goal (WebGPU), not scheduled.
- **Fields.** A node output can be a deferred function of evaluation
  context (`Field<T>`), resolved only when it lands on a domain. Node
  params accept `T | Field<T>`. Anonymous attributes carry intermediate
  results.
- **Agent and human ergonomics.** The library is built to be driven by
  AI agents as well as humans: node types carry machine-readable metadata
  (pins, param schemas, descriptions) in a registry; graphs serialize
  to/from a stable JSON format; behavior is deterministic and
  introspectable (cook stats, cache hits). Docs ship in human form
  (README) and agent form (llms.txt + generated node/API reference).

## Layout

- `src/data` — attribute storage (SoA typed arrays), domains, promote/transfer
- `src/random` — PCG32 RNG, seed hashing (no `Math.random` anywhere)
- `src/fields` — `Field<T>`, combinators, evaluation context
- `src/noise` — value/perlin/simplex/worley/fbm noise as fields
- `src/graph` — nodes, pins, data collections, scheduler, caching, subgraphs
- `src/runtime` — grid levels, partitioned cooking, streaming, invalidation
- `src/nodes` — standard node library (samplers, point ops, attribute ops)
- `src/three` — three.js interop (optional peer dep; core never imports three)
- `tests/` — cross-module integration and determinism suites (unit tests are
  co-located as `src/**/*.test.ts`)
- `examples/` — vite multi-page demos
- `scripts/` — status.html generator and other tooling

## Commands

- `npm test` — vitest run (unit + integration)
- `npm run build` — build the library (subpath exports: `.`, `./three`)
- `npm run check` — `tsc --noEmit`; needs a current `dist/` first, because
  `examples/` import `pcg-ts` by package name
- `npm run examples` — vite dev server for the examples
- `npm run preview -- <graph.json>` — render any serialized graph from
  fixed camera poses (hero / ground / top) into `preview/`, with a JSON
  sidecar. Opens a real browser; see `scripts/preview.mjs` for why it is a
  repo script rather than a `pcg` subcommand
- `npm run capture` — regenerate the committed demo screenshots
- `npm run status` — rebuild the local `status.html` dashboard from
  `status.json`. Generated output, not committed (gitignored); CI builds
  it per run and uploads it as the `status-html` artifact

## Conventions

- TypeScript strict. No `any` in the public API surface.
- Hot paths use SoA typed arrays; never per-point objects in inner loops.
- Determinism is a hard invariant: all randomness flows from seeds via
  PCG32 and hash-combining (node seed, cell coords, point index). Same
  seed → identical output across runs, platforms, and cook orders.
- `src/three` is the only place allowed to import `three` (optional peer
  dependency, exported as `pcg-ts/three`).
- Prefer fields over eager values: node params accept `T | Field<T>`.
- Any UI (editor tooling, example chrome beyond plain HTML) uses Svelte.
- Error messages are part of the agent API: name the offending node, pin,
  or param and state the valid alternatives or the fix.

## Unattended build protocol

- `PLAN.md` is the source of truth for phases and exit criteria;
  `status.json` tracks live progress.
- After each completed work unit: run tests, update `status.json`, and
  commit (`phase(N): <summary>`). Do NOT commit `status.html` — it is
  derived from `status.json` and gitignored. Run `npm run status` whenever
  you want to read the dashboard locally.
- A phase is complete only when its tests are green and (for nontrivial
  phases) an independent verification
  agent has re-derived correctness per the delegation rules below.
- Never mark a task done in `status.json` without a passing test run to
  back it.

# Subagent delegation and cost economy

**Principle:** Protect the main thread. Optimize for its context economy.
Delegate to preserve reasoning quality, not to maximize parallelism.

## Context economy (research and lookups)

Reading >~3 files or unfamiliar territory to ground a task? Delegate to an
Explore/general-purpose subagent with a tight question. Its reads stay in
throwaway context; only the synthesis returns. Direct reads in the main
thread persist for the entire session. Reserve them for small, targeted
lookups.

Large file with one relevant section? Grep to locate it, then Read with
offset/limit. Don't read the whole file.

Sibling files sharing structure (specs, fixtures, tests)? Read one in full
to learn the pattern, then grep the rest for structural conformance.

## Other delegation triggers

- Independent subtasks with no data dependency? Spawn one agent per subtask
  in a single message instead of running serially, subject to the batching
  limits below. Follow the orchestration rules below.
- Nontrivial change (core logic, security, or >1 file)? Spawn a fresh agent
  to independently re-derive correctness before declaring the work complete.
  Don't rely only on self-review. Skip for one-line or purely mechanical
  edits.
- Self-contained subtask: clear deliverable, no main-thread context needed,
  and otherwise >~3 file edits/reads inline? Delegate it (for example,
  "write tests for X" or "update all callers of Y").

## When not to delegate

- Single-file, single-location lookup/edit: do it directly.
- Scope still ambiguous? Resolve it first (ask or decide). Never hand a
  subagent an underspecified prompt: state the objective, the output
  format, which tools/sources to use, and what's out of scope.
- Destructive or high-blast-radius operations (push, deletion, force
  operations): keep them in the main thread under confirm-first. Never
  delegate them.

## Parallel orchestration

Before spawning agents:

- Define ownership for every agent (files or scope). Concurrent writers
  must own disjoint sets; if overlap is unavoidable, isolate work with
  worktrees instead of racing the working tree.
- Delegate by cognitive locality, not task count. Merge work that shares a
  subsystem, files, conventions, or mental model. Each additional agent
  pays the orientation cost again.
- Specify required skills. Subagents do not inherit skills automatically.
  Reference the skill file instead of restating it inline.
- Subagent producing large or structured output (generated code, reports,
  extracted data)? Instruct it to write to a file and return a reference.
  Routed through the orchestrator instead, it's copied twice (produced,
  relayed) and then sits in context for the rest of the session whether
  it's needed again — the depletion cost and the dilution cost, paid at
  once.

Prefer 2-4 agents per wave. More than 4 independent subtasks? Group by
cognitive locality until the wave count fits; don't spawn one agent per
subtask past that point. Treat 5+ ungrouped agents as a signal to
consolidate.

Subagents inherit the current model unless explicitly changed. Use cheaper
models for mechanical work (search, scaffolding, structural checks).
Reserve the primary model for tasks requiring equivalent reasoning quality.

Forbid repo-wide Git operations (stash, checkout, reset, clean) in
subagent prompts. Use scoped alternatives instead (for example, `test --filter <name>`).

Background tasks: wait for completion notifications. If asked for status,
answer from what is already known. Don't call `TaskOutput`; it may return
the full raw transcript, and repeated polling multiplies context cost.

**Guideline:** Delegate to minimize main-thread context while preserving
cognitive locality. Parallelism is a tool, not the objective.

## Other cost-saving habits

Confirm well-documented library or framework behavior through reasoning.
Cite the documentation when appropriate, and mark conclusions as inference
when certainty matters. Reserve execution for undocumented, surprising, or
project-specific behavior.

When using tools that forward the full conversation transcript (for example,
advisor or critic calls), batch multiple open decisions into fewer, earlier
calls. Cost scales with transcript length, so the same call is cheaper
earlier than later.
