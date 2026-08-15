# A knob that reaches into a field spec

Today a noise's frequency becomes tunable only by wrapping its node in a
subgraph and exposing a param. The wrapper exists solely to carry a
number, and PLAN.md's entry guesses the honest shape is "expose a plain
node's field-spec `param` names on the panel". That is the right target,
but it needs one thing that does not exist: somewhere for a plain node's
binding to live.

## Why a plain node has nowhere to put it

- `{"fn":"param","name":"freq"}` in a plain node's field spec is
  UNBOUND. `serialize.ts:1227` calls `fieldFromJson(value)` with no
  bindings, so the field builds and then refuses to evaluate. Only a
  subgraph binds, via `fieldFromJson(ref.spec, bindings)` in
  `withExposedParams`.
- There is no bag to put bindings in. `NODE_KEYS` is closed
  (`["id","type","params","subgraph","ref"]`) with hard errors on unknown
  keys, param schemas are fixed per node type, and `deserializeGraph`
  rejects any param key not in the schema. PLAN.md's "inventing a place to
  keep them is the actual work" is accurate.

## Ruled out: put the values in the panel file

`graphs/panels/*.json` already exists as optional presentation data, it is
where min/max and labels naturally belong, and using it would need no
grammar change at all.

**It breaks a property the corpus rests on: a graph must cook standalone.**
`tests/graphs.test.ts` cooks every graph with no panel present, and a
graph whose params only resolve when a presentation file happens to be
there is not a graph. So the VALUE has to live in the graph. The panel may
only refine how it is presented.

## The design

**A `param` spec node may carry its own value inline:**
`{"fn":"param","name":"freq","value":0.05}`.

- **Optional.** Omitting it preserves today's behaviour exactly — an
  unbound param that refuses to evaluate, with the same error. This is
  what makes the change strictly additive: no existing graph moves, and an
  author who wants the loud unbound error keeps it by writing nothing.
  (An earlier draft of this design worried that a subgraph body param the
  wrapper forgot to expose would silently take a default. Making the key
  optional dissolves that: the silent default only exists where an author
  wrote one.)
- **An outer binding wins.** A subgraph exposing `freq` overrides the
  inline value; the inline value is the fallback. So a node is tunable
  standalone AND still wrappable, and the two mechanisms compose in the
  one order that makes sense.
- **Self-binding makes the spec self-contained**, which is why the fold
  can then treat it as an ordinary constant.

**No `formatVersion` bump.** The key is additive: new readers accept old
graphs unchanged. An old library reading a new graph fails on `checkKeys`
with a message naming the unknown key, which is informative — where a
version bump would move `hashableGraph` and break every pinned `ref` hash
for a purely additive change. Pre-alpha format breaks are acceptable, but
that is a reason not to fear one, not a reason to spend one.

**The panel schema is derived, and refinable.** `Knob.schema` is always a
`ParamSchema` and a field-spec param name has none. Derive a minimal one
from the inline value's shape — number → `f32`, 3-array → `vec3`, 4-array
→ `vec4`, default = the value. `graphs/panels/*.json` may then refine
`min`/`max`/`description`, which is exactly what a panel file is for and
where a slider's range belongs. Deriving first means a graph gets a
working knob with no panel file at all.

**Knob key needs a third shape.** Today `"<nodeId>.<paramName>"`
addresses a node param. A field-spec param is one level deeper, so
`"<nodeId>.<paramKey>.<fieldParamName>"`. It must not be able to collide
with a node param whose name contains a dot — check whether that is
possible before choosing the separator.

**Editing a knob rewrites the spec's `value`** and calls `setParam` with
the rewritten spec — which is a thing the sandbox already does for field
params, so the write path is not new.

## Scope note

Names are SUBGRAPH-scoped when bound from outside (one exposed `freq`
drives every body spec that mentions it) and NODE-scoped when authored
inline (each spec carries its own). That asymmetry is not an accident and
should be documented rather than smoothed over: it is the difference
between a binding, which belongs to the binder, and a literal, which
belongs to the expression.

## What must be tested

- A plain node with an inline value cooks standalone, and its field
  resolves to that value.
- Omitting the key still produces the unbound-param error, unchanged.
- An outer subgraph binding overrides an inline value, both directions
  round-tripped through serialization.
- The knob list includes the field-spec params of plain nodes, with a
  derived schema, and editing one changes the cooked output.
- A panel file refining min/max is applied; absent one, the derived
  schema still yields a usable control.
- The key shape cannot collide with a node param name.
- Bit-exactness: a graph rewritten from a wrapper-with-exposed-param to
  an inline value produces identical bytes.
