# `mergePrimitives` — a union that keeps topology

`mergePoints` concatenates point columns and stops there. It builds a
`new Geometry()` and never reads its inputs' `vertexToPoint` /
`primVertexStart` / `primVertexCount`, so a polyline network in gives a
bare cloud out — primitive domain empty, no throw, no warning. That blocks
mixing an authored network with a generated one, which is the motivating
case and was #3 in the stage-5 missing list.

## The name is not a choice

`filterByBounds` / `filterPrimitivesByBounds` and `filterByAttribute` /
`filterPrimitivesByAttribute` already establish the convention: the
topology-preserving twin of a point-domain node inserts `Primitives`. So
this is **`mergePrimitives`**, category `"point op"` — which already hosts
the topology builders `connectPoints` and `pointsToPath`. `union`,
`append` and `mergeGeometry` are all absent from the codebase and all
would be new coinages against a settled vocabulary.

## Mixed primitive types are PERMITTED, and that is a finding

Every consumer filters per primitive rather than per geometry:
`surfaceSample` skips anything that is not a 3-vertex `poly`
(`samplers.ts:94-95`), `collectTriangles`, `polylineArcTables`, the
three.js exporters (`collectIndexed(who, geo, wanted)` takes the kind it
wants and ignores the rest), and the SVG renderer all do the same.
`primitiveTypeCounts` returns a per-value map, not a mode. **Nothing
assumes homogeneity**, so a mesh unioned with a network is coherent and
each downstream consumer picks out what it understands. The node does not
refuse it.

## The `primtype` hazard, which decides the attribute rule

A geometry whose topology came from bare `Geometry.setTopology` carries NO
`primtype` column (`geometry.ts:86-87`); only `createTriangleMesh`
(`"poly"`), `setPolylineTopology` (`"polyline"`) and the two surface nodes
stamp one. Meanwhile `mergePoints`' union rule fills a column absent from
one input with **that column's default**, and `primtype`'s default is
whichever of `"poly"` / `"polyline"` the first input that HAS one
established.

Left alone, that silently mislabels: union an untagged mesh with a
polyline network and the mesh's triangles come out tagged `"polyline"`,
after which `surfaceSample` skips them and a renderer draws them as lines.
Cooks clean, wrong answer.

**So `primtype` is special-cased.** If any input carries the column, the
output carries it, and each input's primitives take either their own value
or — where that input has no column — nothing, written as the empty
string. An empty tag is what "untagged" already means to
`primitiveTypeCounts`, and it is the honest answer: this node does not
know what an untagged primitive is and must not guess. Every other
attribute keeps `mergePoints`' rule exactly.

## Semantics

- **Point domain**: identical to `mergePoints` — first-occurrence union of
  columns, conflicting `type`/`tupleSize` is a hard error naming the
  attribute, missing columns default-fill, points renumbered by
  concatenation order.
- **Vertex and primitive domains**: same union rule, concatenated in the
  same order.
- **Topology**: each input's `vertexToPoint` is offset by the running point
  base, its `primVertexStart` by the running vertex base. `primVertexCount`
  concatenates unchanged.
- **An input with no topology contributes its points and no primitives** —
  not an error. That is exactly the authored-trail-plus-generated-network
  case where one side is a bare cloud.
- **Zero inputs** gives an empty cloud, as `mergePoints` does. **One
  input** is a copy, not the identity object.
- Tags union, as `mergePoints` does.

## Do not write a third topology assembler

`gatherPrimitives` (`util.ts:629-687`) already does the renumbering and the
running-`w` rebuild, but single-source into a fresh `Geometry`, and
`copyElements` throws on a second call into the same destination
(`to.add(...)` per column). Extending `gatherPrimitives` to N sources means
changing its point-compaction mask and its three `copyElements` calls into
accumulating ones, which changes behaviour for its two existing callers
(`filtering.ts:423`, `:707`).

Judgement: **factor the offset-and-append step out** so the new node and
`gatherPrimitives` share it, rather than either duplicating the arithmetic
or destabilising two working call sites. If that turns out to be more
invasive than it looks, prefer a clearly-commented local assembler in the
new node over a risky refactor of a filter path — and say so.

## Determinism

Concatenation order is connection order, which is already the contract for
a `multi` pin. Point identity is position bits plus `seed` and neither
moves, so identities survive the union unchanged; primitive identity is
the order-independent fold of its own points' identities (shipped today),
so a primitive keeps its identity across the merge too. That is worth a
test: the same primitive, unioned from either side, keeps its
`randomField` draw.

The known hazard is inherited, not new: `mergePoints` copies the point
`seed` column verbatim with no collision check, so two inputs carrying the
same `(P, seed)` pair are ONE point as far as identity is concerned
(`identity.ts:16-19`). Document it on the node; do not invent a rehash
here, which would be a different and larger decision about what identity
means across a union.

## What must be tested

- Two polyline networks union into one whose edge multiset is the union of
  theirs — `tests/support/edgeMultiset.ts` has the comparator.
- A mesh unioned with a network keeps both, and `surfaceSample` still finds
  exactly the mesh's triangles.
- **The `primtype` case, deliberately**: an untagged mesh unioned with a
  tagged network must NOT come out labelled `polyline`.
- An input with no topology contributes points only.
- Conflicting attribute shapes throw, naming the attribute.
- A primitive's `randomField` draw is unchanged by the union, and unchanged
  by which side it came from.
- Zero and one input.
