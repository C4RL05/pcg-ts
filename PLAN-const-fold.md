# Domain-constant folding

Evaluate a field subexpression that cannot vary per element ONCE, instead
of once per element.

## Why, with the measurements

`{"fn":"nodeSeed"}` resolves to `ctx.seed` — the same number on every
element. The seed-shift idiom the graphs use to derive a per-node offset,
`A * (fract(nodeSeed * 2^-32 * K) - W0)`, is therefore a chain of six
arithmetic nodes whose value is fixed for the whole domain, and it was
being recomputed for all 40 000 of them, three times over for three axes.

Folding `nodeSeed` into the graph corpus (`0d74d41`) roughly doubled the
CPU cook of `graphs/examples-gpu-fields`. Two things fix that; the first
already shipped.

| state of `graphs/examples-gpu-fields`, `pcg cook`, 40k points | ms |
| --- | --- |
| before `nodeSeed` was folded in, on today's code | 350.7 |
| with `nodeSeed`, before the CSE fix | ~760 |
| with `nodeSeed`, after the CSE fix (`8e10d5e`) | 386.7 |
| with `nodeSeed`, after CSE **and** this fold (prototype) | ~344 |

So content-keying the evaluation cache took the feature's cost from
+100% to +10%, and this fold takes the remaining +10% to about nothing.

Prototype measurements, interleaved runs, median of 9 after 2 warmups,
each version cooked alternately so both meet the same JIT and GC state:

| graph | subtrees folded | before | after | change |
| --- | --- | --- | --- | --- |
| `examples-gpu-fields` | 10 | 555.5 ms | 494.1 ms | −11.1% |
| `basics-reseed-a-noise` | 1 | 2.9 ms | 2.0 ms | −30.4% |
| `basics-attribute-from-noise` | 1 | 2.1 ms | 1.7 ms | −15.1% |
| `examples-forest` (control) | **0** | 18.7 ms | 18.4 ms | −1.7% |

The control row is the point of the table: a graph the fold does not
touch moves 1.7%, so that is the noise floor and the others clear it. An
earlier version of the probe ran all of A then all of B and reported a
12.5% win on that same zero-subtree control — the whole measurement was
warmup.

Every row above is byte-identical output, checked with a SHA-256 over
every attribute of every output geometry. That digest is itself checked:
it returns a different hash for the same graph at seed n and seed n+1, so
"same bytes" is not a hash of nothing. (It was, at first: the items key
their payload as `.geo`, the probe read `.geometry`, and every row
reported agreement while hashing the empty string.)

## Design

**Bit-exactness is the premise.** Every combinator computes in f64 and
stores f32. Folding a chain to the f32 value it already produced, and
re-emitting that through `constant`, rounds a number that is already an
f32 — idempotent, so the fold cannot move a bit. This is what makes the
change safe to do behind the author's back; a fold that computed in f64
and skipped the intermediate roundings would NOT be exact and must not be
written that way.

**Rewrite the spec, not the closure tree.** Every grammar-built field
carries a `FieldSpec` (`src/fields/spec.ts`, read with `getFieldSpec`).
Walk it, replace each maximal domain-constant subtree with
`{fn: "constant", value}`, and rebuild with `fieldFromJson`. A field with
no spec (a hand-written `makeField` closure) is returned untouched.

**Fold at the CPU resolve seam only** — `resolveOnAllowingNonFinite` in
`src/nodes/util.ts`, the single funnel every CPU resolve goes through.
The GPU path is deliberately not touched: `nodeSeed` already lowers to a
uniform and `CompileCtx.emit` already value-numbers, so the device gets
this win for free and rebuilding a field there would only risk changing
its provenance, which is what device eligibility turns on.

**Classification lives in the grammar registry, and is required.** Add a
field to `FnDef` recording whether that `fn` introduces per-element
variation *of its own*: `position`, `index`, `fraction`, `attribute`,
`randomField` and all five noises do; `constant`, `nodeSeed` and every
arithmetic combinator do not. A node is domain-constant when its own fn
introduces no variation AND every spec-valued argument is domain-constant.

Make the field REQUIRED rather than defaulted. A defaulted flag means the
next `fn` someone registers is silently classified, and if the default is
"constant" that is a wrong answer that no test asks about. A test asserts
every registered fn carries an explicit classification, so adding one
forces the decision.

**The synthetic context is a one-point cloud**, `{geo: createPointCloud(1),
domain: "point", seed: ctx.seed}`. Sound precisely because a
domain-constant subtree reads neither geometry nor domain — that is what
the classification establishes — so the only member that matters is
`seed`. The domain is pinned to `point` rather than passed through
because `elementCount` reads `geo.attrs[domain].count` and a fresh point
cloud has zero vertices and zero primitives; passing a caller's
`"primitive"` through would evaluate over an empty domain and fold to
nothing.

**Do not fold to a value the grammar would refuse.** `fieldFromJson`
rejects a `constant` whose value is non-finite or `-0`, so a subtree
evaluating to `Infinity` (a division by zero, say) must be LEFT ALONE
rather than folded — otherwise the rebuild throws from inside an
optimization, at a site the author cannot see, instead of the finiteness
guard reporting it at the seam with the message it was written to give.
Same for `-0`, which `keyNum` keeps distinct from `0` for a reason.

**Cache the rewritten field per (field, seed)**, as a
`WeakMap<Field, Map<number, Field>>`. Keyed on the field instance so
entries die with the graph node that holds it, and bounded on the inner
map, because an unbounded cache keyed on a value that changes is how the
GPU pipeline cache nearly grew without limit.

**Skip the rebuild when nothing folds.** If the walk finds no
foldable subtree, return the original field rather than an identical
rebuild — most fields have nothing to fold and must not pay a re-parse.

## What must be tested

- Each of the four tables above is a claim; the byte-equality one is the
  claim that matters and the 50-graph golden diff is what enforces it.
- Classification completeness: every registered grammar `fn` carries an
  explicit answer.
- A varying leaf under a constant-looking parent is not folded
  (`add(1, position())` stays whole).
- A non-finite fold is declined and the finiteness guard still produces
  its own message.
- `-0` is declined.
- Folding is bit-exact for a chain that rounds at every step — assert
  against a value computed with `Math.fround` at each stage, not one f64
  expression.
- A field with no spec resolves unchanged.
