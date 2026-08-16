# Fields ergonomics — making a field expression readable, reusable, and consistent

Written 2026-08-16 from external reviewer feedback. **Not started.** No
code in this plan has been written; the repository state below was read,
not changed.

---

## 0. Read this first

This plan was written while ANOTHER SESSION was actively committing to
`main` in this same working tree. At the time of writing, HEAD was
`72d6ec5` and there were ~1000 uncommitted lines across 15 files, most of
them in `src/fields/` and `src/gpu/compile.ts`. `src/nodes/filtering.ts`
had been written to seconds earlier.

**Every number in section 2 is therefore a snapshot and may be wrong by
the time you read this.** Each one comes with the command that re-derives
it. Run them before acting on anything.

Two in-flight plans overlapped this work and may have landed:

- `PLAN-by-attribute.md` — an N-way case primitive for the grammar. Same
  family as §4.A here, and its motivation is the same diagnosis reached
  from a different graph.
- `PLAN-filter-topology.md` — `topology: "keep"` on the five point
  filters, one of which is `filterByExpression`.

**First action in the new session:**

```sh
git log --oneline 72d6ec5..HEAD
git status --short
ls PLAN-*.md
```

Then re-run the checks in §2 and strike whatever is already done.

---

## 1. Where this came from

A reviewer said, in substance: *"I don't quite understand the idea of
fields being text instead of just being another node input."* They were
comparing against the wire-everything node model — the one where a socket
carries either a single value or a per-element function, field-ness is
shown by socket shape rather than declared by the node author, field-ness
propagates contagiously from input nodes that have no data input, and a
field is realized when it lands on a socket that has a domain.

Three things that model gives them, which this library does not:

1. **One vocabulary.** Arithmetic on a field is the same node you would
   use on a constant. There is no second op set to learn.
2. **Composition by wire, therefore reuse.** One expression chain fans out
   to many consumers. Here an expression lives inline in one param, so
   sharing it means copy-paste.
3. **Visibility.** The graph *is* the expression; nothing hides inside a
   param.

What does not transfer: that model was designed without a compute-kernel
compiler underneath it. Arbitrary nodes may appear mid-expression there
because nothing downstream must prove a run lowers to a fused kernel. Our
closed grammar is load-bearing (§6.1). Its implicit domain interpolation
is also a known source of confusion; our explicit promote/transfer is
arguably the better call and is not up for trade.

**Read the complaint as a legibility signal before an architecture
signal.** "I don't quite understand the idea" is a docs symptom. A
correction worth making regardless: in the TypeScript API, fields are not
text — they are `Field<T>` values built with combinators. The text is the
serialization. The reviewer met the serialization first.

---

## 2. Evidence

### 2.1 The worked example: 80% of a predicate is one open-coded idiom

`graphs/basics-filter-by-expression.json`, node `keep`:

| measure | lines |
| --- | --- |
| whole node JSON | 207 |
| the `predicate` param | 201 |
| the vec3 seed offset inside it | **161** |

The predicate means, in full:

```
length(P) < 20  AND  valueNoise(P + seedOffset, frequency 0.06, seed 3) > 0.4
```

Re-derive:

```sh
node -e "const g=require('./graphs/basics-filter-by-expression.json');
const n=g.nodes.find(x=>x.id==='keep');
console.log(JSON.stringify(n,null,2).split('\n').length,
            JSON.stringify(n.params.predicate,null,2).split('\n').length);"
```

The 161 lines are three axes of
`A * (fract(nodeSeed * 2^-32 * K) - W0)`, the decorrelation idiom that
makes a saved noise re-roll with the graph seed. It is now documented at
length in `src/fields/inputs.ts` (the `nodeSeed` doc comment), which
states the cause outright: *"the shared `nodeSeed * 2^-32` written out
both times because JSON has no way to name a subexpression."*

Two multipliers, three axes, two missing features. It is the single
best-evidenced ergonomic defect in the library.

### 2.2 `fract` is not in the grammar

It appears only in prose:

```sh
grep -rn "\bfract\b" src/fields/ src/gpu/ --include=*.ts | grep -v "\.test\."
```

Because it is spelled `x - floor(x)`, every use serializes `x` twice.
That alone roughly doubles the idiom above.

Present in `src/fields/combinators.ts`: `add sub mul div min max abs floor
sin cos tan asin acos atan atan2 clamp lerp remap select lt le gt ge eq ne
dot length normalize vec component ramp`.

Present in `src/fields/inputs.ts`: `constant attribute attributeIs
position index fraction nodeSeed randomField`.

Absent and wanted: `fract mod step smoothstep sqrt pow exp log sign cross
distance`.

```sh
grep -n "^export function [a-zA-Z0-9]*" src/fields/combinators.ts | sed 's/(.*//'
```

### 2.3 Field-capability is a whitelist with no stated rule

From `docs/nodes.json`: **19 of 166 params, across 12 of 46 nodes.**

| node | field-capable params |
| --- | --- |
| `transformPoints` | translate, rotateEuler, scale (3 of 3) |
| `sweepProfile` | radius, width, up, roll (4 of 10) |
| `orientAlongVector` | direction, up |
| `selfPrune` | minDistance, priority |
| `filterByExpression` | predicate |
| `setAttribute` | value |
| `surfaceSample` | densityField |
| `jitterPoints` | amount |
| `pathPointAt` | parameter |
| `pathSegments` | radius |
| `extrudePolygon` | distance |
| `volumeSample` | jitter |

```sh
node -e "const n=require('./docs/nodes.json');let t=0,f=0;
for(const x of n){const p=Object.entries(x.params||{});t+=p.length;
f+=p.filter(([,s])=>s.acceptsField===true).length;}
console.log(f,'of',t,'params across',n.length,'nodes');"
```

Note `docs/nodes.json` is generated; regenerate with `npm run docs`
before trusting it.

The sharpest symptom is documented in the library's own corpus.
`graphs/basics-field-params.json` explains that `frequency` is multiplied
into the sample position rather than passed as `opts.frequency`, "because
the noise options are read as plain numbers and cannot hold a spec." So
`valueNoise`'s position accepts a field and its frequency does not, and
the fix is to fold one into the other.

### 2.4 There is no field wire

```ts
// src/graph/node.ts:5
export type PinKind = "geometry" | "value" | "instances" | "any";
```

No `field` kind. A field never travels on a wire and no node emits one.
The reviewer's description is literally accurate.

One curiosity: `valueConstant` (`src/nodes/mathNodes.ts:20`) emits a
`value` pin, and **no node in the catalog declares a `value` input.** It
is a wire type with no consumer — a vestige pointing at the model the
reviewer expected.

---

## 3. The four problems, separated

They were reported as one complaint. They have independent fixes and can
be adopted in any combination.

| # | problem | symptom | fix axis |
| --- | --- | --- | --- |
| A | grammar is missing primitives | 161 of 201 lines | §4.A |
| B | JSON is a hostile concrete syntax | unreadable, unwritable | §4.B |
| C | field-capability is an unstated whitelist | 19 of 166, arbitrary | §4.C |
| D | expressions are invisible and unshareable | copy-paste reuse | §4.D |

Ordered by evidence strength, A is first by a wide margin.

---

## 4. Options

### A. Grammar completeness

**A1 — the missing math primitives.** `fract mod step smoothstep sqrt pow
exp log sign cross distance`. Each is one WGSL builtin plus one CPU
implementation plus grammar parse/emit plus a parity test. Mechanical,
additive, low risk. `fract` is the one that matters for §2.1.

**A2 — a `seedOffset` primitive.** The single highest-leverage item. One
grammar fn replacing ~161 lines wherever the idiom appears.

*The hard part is not the arithmetic.* The idiom's `W0` term is the
expression's own value at the graph's authored seed, chosen so the offset
is exactly `+0` there — which is what makes folding it into a saved graph
leave existing output **bit-identical**. A primitive must preserve that
property or it is not a drop-in replacement. Design questions:

- Is `W0` a parameter the author supplies, or computed from a `zeroAt`
  seed the node records?
- Are the per-axis keys (`1021, 3067, 8191`) baked, parameterized, or
  derived from an index so several noises on one node stay decorrelated?
- Is amplitude `A` explicit, or derived from frequency
  (the doc comment says `A ≈ 32 / opts.frequency`)?

Read the `nodeSeed` doc comment in `src/fields/inputs.ts` in full before
designing this. It is the specification.

**A3 — subexpression binding.** A `let`-style form so a shared subtree is
written once. Note carefully: **automatic CSE at compile time does not
solve this.** Fields already carry content-addressed keys (`8e10d5e`) and
invariant subexpressions are already hoisted at evaluation (`1a09b60`), so
codegen and runtime are fine. The complaint is *serialized size*, which
needs a binding form in the grammar itself. Verbose in JSON, natural in
text — pairs with B2.

**A4 — the N-way case form.** See `PLAN-by-attribute.md`. Likely already
landed; check before duplicating.

### B. Concrete syntax

**B1 — leave the JSON.** The authoring cost stays and so does the
impression that prompted this. Listed for completeness.

**B2 — a parsed text syntax.** `length(P) < 20 && valueNoise(P * 0.06) > 0.4`.
A string is accepted anywhere a spec node is; `src/fields/fieldJson.ts`
gains a parser and a printer; the tree stays canonical so programmatic
edits still work. Bounded but real work: precedence, type rules, and error
messages with source spans — errors are part of the agent API here, so a
parse failure must name the offending token and the valid alternatives.

Worth stating explicitly: this is an **agent** ergonomics win as much as a
human one. Models emit infix expressions far more reliably than 200-line
nested JSON, and agent ergonomics is one of the four design pillars.

**B3 — text only, drop the tree.** Rejected. It turns programmatic edits
into string surgery and loses machine manipulability.

### C. Coverage consistency

**C1 — document the rule, audit the gaps.** Cheapest. Fixes the noise-opts
edge (§2.3) without a sweep.

**C2 — flip the default.** Every numeric and vector param is
field-capable unless it declares `acceptsField: false`. The opt-out rule
is statable and defensible:

> A param cannot be a field if it determines allocation or structure.

Counts, topology, enums and strings must be known before there are
elements to evaluate against. Everything else can vary per element. This
is the closest thing to the reviewer's "if you can plug it in, it can be a
field," and it converts a scattered permission into a property of the
system. Large but mostly mechanical; every newly-capable param needs a
CPU path, a GPU lowering, and a test.

### D. Visibility and reuse

**D1 — render the field tree as a node diagram in the sandbox,
read-only.** The spec is a typed tree of named fns, so a generic renderer
is mechanical. Buys the visual legibility at near-zero cost; editing stays
textual. Note the sandbox already grew a field-spec knob (`1154bd7`), so
check what exists.

**D2 — make that view editable.** Boxes in, same tree out. Wire-style UX
on an expression-language substrate. No architecture change; sandbox work.

**D3 — a real `field` pin kind.** The reviewer's literal model. The naive
version — any node emits a field — destroys the fusion guarantee (§6.1).
The workable version is a **restricted sub-registry**: pure grammar ops
get a `field` output pin, wires between them are inlined into a spec tree
before cooking, and eligibility is unaffected because the sub-registry is
still closed. Cost: two authoring surfaces for one concept, plus an
inlining pass, plus sandbox work.

**Defer D3 and revisit after D1.** The complaint reads as "I cannot read
this," not "I need to connect these." But note what only D3 buys: sharing
one named field across *different nodes*. A3 gets naming within a single
expression; nothing else on this list gets cross-node reuse. If reuse
turns out to be the real pain, that is the argument that promotes D3.

### E. Framing

**E1.** Lead the docs with the TypeScript and text forms rather than the
graph JSON. The reviewer's entire impression formed from an artifact that
has no analogue in the system they were comparing against. Worth doing
regardless of everything above.

---

## 5. Recommended sequence

Each unit is independently shippable, tested and committed on its own.

| unit | scope | touches | corpus churn |
| --- | --- | --- | --- |
| 1 | A1 — missing math primitives | `src/fields/`, `src/gpu/compile.ts` | none |
| 2 | A2 — `seedOffset` primitive | `src/fields/`, `src/gpu/compile.ts` | none |
| 3 | A2b — rewrite graphs onto it | `graphs/*.json`, derived files | **yes** |
| 4 | A3 — subexpression binding | `src/fields/` | none |
| 5 | B2 — text syntax parse + print | `src/fields/fieldJson.ts` | none |
| 6 | D1 — sandbox tree view | `sandbox/` | none |
| 7 | C1 → C2 — coverage rule, then sweep | `src/nodes/`, `src/graph/params.ts` | none |
| 8 | E1 — docs framing | `README.md`, `docs/` | none |

Rationale for the order:

- **Units 1–2 first** because they are additive, low-risk, and unit 2
  alone plausibly removes more serialized bloat than everything else
  combined.
- **Unit 3 is deliberately split from unit 2.** Adding a primitive does
  not require rewriting any graph. Corpus churn is optional, deferrable,
  and should be its own commit so it can be reviewed as a mechanical
  transform. Do it when nothing else is in flight.
- **Unit 5 after unit 4** so the text form has a clean grammar to compile
  to, rather than being retrofitted.
- **Unit 7 last of the code units.** It fixes a different complaint
  (inconsistency) than the one that prompted this (illegibility), it is
  the long pole, and sequencing it after unit 5 keeps the audit and the
  parser from fighting over `src/fields/fieldJson.ts`.

### Verification per unit

```sh
env -u NODE_ENV npm test        # NODE_ENV=production causes a false failure
npm run build && npm run check  # check needs a current dist/
npm run docs                    # CI fails if catalogs are stale
npm run graphs:golden           # only for units that change graph output
```

Per the build protocol: a unit is complete only when its tests are green
and, for anything non-mechanical, an independent agent has re-derived
correctness. Units 2, 5 and 7 qualify; units 1 and 8 do not.

---

## 6. Invariants that constrain every option

1. **The grammar stays closed.** It is closed so a run's GPU eligibility
   is decidable and a fused kernel is provable, with a machine-readable
   reason on fallback. Any design that lets an arbitrary registry node
   appear mid-expression breaks this. This is the reason the library does
   not simply adopt the model the reviewer described.
2. **Determinism.** All randomness flows from seeds through PCG32 and
   hash-combining. Same seed, identical output across runs, platforms and
   cook orders.
3. **CPU is the reference, GPU is a documented approximation.** Any new
   primitive needs both paths plus a parity test, within the published
   per-family tolerances.
4. **Bit-identical folding for A2.** The `W0` term exists so the offset is
   `+0` at the authored seed. A replacement primitive that loses this
   changes existing graph output.
5. **Derived files are regenerated, never hand-merged.** `docs/nodes.json`,
   `docs/graphs.json` and the graphs golden file conflict on any parallel
   branch; the resolution is always to re-run the generator.
6. **Pre-alpha: format breaks are acceptable.** A `formatVersion` bump and
   broken pinned refs are fine. Never compromise a design to avoid one.
7. **Error messages are API.** Name the offending node, pin or param and
   state the fix. This applies with force to a new parser (B2).

---

## 7. Open decisions — need the user

1. **Does authored text round-trip verbatim, or normalize to the tree on
   save?** Blocks B2 and must be settled before the parser is written.
   Normalizing means the first sandbox save silently destroys what someone
   wrote. Storing the string as the authored form with the tree derived
   avoids that, but has knock-on effects on diffing and the golden file.
2. **C1 or C2?** Document the rule, or flip the default across all 166
   params. Materially different scope.
3. **Is unit 3 (corpus rewrite) in scope,** or does the corpus stay on the
   open-coded idiom until something else forces it?
4. **Is D3 ever wanted,** or is the sandbox tree view the intended answer
   to the reviewer? This decides whether cross-node field reuse is a goal.

---

## 8. What not to do

- **Do not adopt the wire-everything model wholesale.** It costs the
  fusion guarantee and puts scheduler, cache and invalidation machinery on
  individual multiplies. The node graph is the outer dataflow; the field
  grammar is the inner loop. That split is correct.
- **Do not reach for compile-time CSE to fix §2.1.** Wrong layer; see A3.
- **Do not name specific third-party engine or DCC products** in any file
  or commit message in this repository. Describe the mechanism instead —
  as §1 does.
- **Do not start any unit while another session holds uncommitted work in
  `src/fields/`.** There is one worktree on `main`; there is no isolation.
  A worktree would fix file races but not design collisions — two branches
  each inventing a binding form both compile, and no rebase catches that.
