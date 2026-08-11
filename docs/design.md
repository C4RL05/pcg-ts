# Design notes

Why the library is shaped the way it is. [authoring.md](./authoring.md)
says how to use the data model; this file says why it has that shape, and
what was rejected. Written for the reader — human or agent — who asks
"why is there a `vertex` domain when there is already a `point` domain?"
and deserves an answer better than "because that is how it is done".

## Why four domains

Attributes live on one of four domains — `point`, `vertex`, `primitive`,
`detail` (`src/data/types.ts`). These are not four buckets someone found
convenient. They are the four **distinct cardinalities** an indexed
geometry has, and there is no fifth.

`Geometry` (`src/data/geometry.ts`) stores a mesh as shared positions
plus a corner list:

```ts
vertexToPoint: Uint32Array;    // vertex i references point vertexToPoint[i]
primVertexStart: Uint32Array;  // primitive p spans vertices
primVertexCount: Uint32Array;  // [start[p], start[p] + count[p])
```

That gives three array lengths that can differ independently, plus one
implicit global. Each is a domain:

| Domain | Count | What one element *is* | Attributes that belong there |
| --- | --- | --- | --- |
| `point` | `np` | a position in space, shareable by any number of corners | `P`, `rot`, `scale`, `density`, `seed`, `color` |
| `vertex` | `vertexToPoint.length` | one corner of one primitive | `uv` across a seam, a split normal, a per-face-corner colour |
| `primitive` | `primVertexStart.length` | a face or a polyline | `primtype`, material id, road width, face normal |
| `detail` | always 1 | the whole geometry | bounds, source seed, unit scale, provenance |

### The split that earns its keep: point vs. vertex

This is the load-bearing distinction, and it exists for exactly one
reason: **a shared point can carry one value, but a UV seam, a hard
edge, or a per-face colour needs two different values at the same
location.**

Collapse `vertex` into `point` and the only way left to express a seam
is to split the point. That breaks the invariant the point domain exists
to hold — that two corners in the same place *are* the same element —
so deformation, smoothing, welding, and every neighbourhood query start
seeing a crack where the geometry has none, and the point count silently
doubles along every seam. For this library the cost is worse than for a
mesh editor: the point domain is also the scatter and instancing domain,
so splitting points to satisfy a texture seam corrupts the very thing
points are for.

Collapse `point` into `vertex` and the opposite breaks: nothing records
that two corners are the same place, so connectivity is gone and with it
`connectPoints`, `pointNeighborhood`, `selfPrune`, path topology, and
every partition-safe neighbour test.

Both directions lose something real, so both domains stay.

### Primitive, and why `detail` is a domain rather than a metadata bag

`primitive` vs. `detail` is the cheaper distinction but still a genuine
one: per-face data has count `nprim`, whole-geometry data has count 1.

The design choice worth recording is that `detail` is a **real domain of
exactly one element** (`attrs.detail.resize(1)` in the `Geometry`
constructor) rather than a side-channel `metadata` object. Because it is
a normal `AttributeSet`, it needs no separate API, and `promote` stays
*total* over the 4×4 grid of domain pairs: `detail` participates as
broadcast (from) and reduce-all (to), through the same
`forEachContribution` walk as every other pair (`src/data/promote.ts`).
A metadata bag would have forced every attribute op, every serializer,
and every node schema to special-case one of its four cases forever.

### What the shape buys a PCG library specifically

Most nodes touch only `point`. A scatter, a jitter, a density filter, a
spawner — none of them read topology, and because topology lives outside
the point columns, none of them pay for it. When face-level or
whole-geometry context *is* needed on points, `promoteAttribute` pulls it
down with an explicit aggregation mode instead of an implicit rule, and
samplers that read a primitive carry that primitive's attributes onto the
points they emit.

## Why not more: the domains that don't exist

- **No edge domain.** A 2-vertex `polyline` over shared points already
  *is* an edge, so a per-edge value is an ordinary primitive attribute.
  A real edge domain would need adjacency or half-edge structure that
  this representation deliberately does not store. Full argument:
  [Networks](./authoring.md#networks-the-primitive-domain-is-the-edge-domain).
- **No instance domain.** An instance is a point carrying a transform.
  That is the whole "point with attributes" model; a parallel domain
  would duplicate it.
- **No object domain.** Whole-object identity is a graph and `World`
  concern, one level above geometry, and lives there.

Every candidate fifth domain either has no independent count in this
representation, or is already covered by one of the four.

## The same four appear in formats that never talked to each other

Useful as evidence that four is the natural number here rather than a
local preference. Scene interchange and rendering formats reached the
same set independently, under other names:

| pcg-ts | glTF accessor role | USD interpolation | RenderMan primvar class |
| --- | --- | --- | --- |
| `detail` | asset/mesh-level extras | `constant` | constant |
| `primitive` | per-face (via indices) | `uniform` | uniform |
| `point` | per-vertex accessor | `vertex` / `varying` | vertex / varying |
| `vertex` | requires de-indexing | `faceVarying` | facevarying |

USD's `varying` and `vertex` differ in subdivision interpolation basis,
not in cardinality, so the set is four wide there too. The one column
worth noting is glTF: it has no face-varying mode at all, which is why
exporting a seamed mesh to glTF must split points — the exact cost this
data model avoids internally, paid at the boundary instead.

## Invariants this shape commits us to

- `detail` is always count 1. Nothing may resize it.
- Topology references points by index, so **any op that removes points
  rebuilds the point domain and drops topology with it** — the reason a
  path or network must be built after the last filter
  ([authoring.md](./authoring.md#a-path-that-goes-through-a-filter-stops-being-a-path)).
- `promote` walks contributions in a fixed ascending scan order, so
  aggregation is deterministic regardless of cook order — including
  `first`, which would otherwise be the one mode able to leak iteration
  order into output.
