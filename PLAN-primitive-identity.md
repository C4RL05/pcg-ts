# Primitive identity

Primitive-domain randomness falls back to the element INDEX
(`randomField`, `src/fields/inputs.ts:342-355` — one `else` covering
vertex, primitive and detail alike). So it re-rolls whenever anything
upstream changes the order primitives come out in, even when the set is
unchanged. Point-domain randomness does not: it is keyed on an identity
derived from position bits and the `seed` attribute
(`src/data/identity.ts`).

## First, a correction to the backlog entry

PLAN.md justifies this with a measurement on `examples-rig.json`: moving
the spine by 1.9e-6 world units left `connectPoints` emitting the same 456
edges but 156 of the 456 slots holding a different one, and `chordPick`
turning 63 passing chords into 54.

**Endpoint-derived identity would not have prevented that, and the entry
should not claim it would.** `pointIdentities` hashes the f32 BIT PATTERNS
of `P`, so a position that moves at all gets a new identity, and anything
derived from it moves too. Measured at rig-scale coordinates, 1.9e-6 is:

    at x = 1     16 ulps    bits change
    at x = 10     2 ulps    bits change
    at x = 36     0 ulps    bits identical

which is also why only a THIRD of the edges permuted rather than all of
them — the nudge is below one ULP out at the ends of the spine and
several ULPs near the origin. Two distinct failures were running at once:

1. **Points moved**, so their identities changed, and every random keyed
   on them changed. Unavoidable and by design — point identity IS position
   bits, and a library that pretended otherwise would be lying about what
   makes two points the same point.
2. **Primitives reordered**, so index-keyed randomness re-rolled even for
   the edges whose endpoints never moved.

Only (2) is fixable, and it is what this change fixes. That is still worth
having, and PLAN.md's *other* example is precisely it: a faster spatial
grid returning neighbours in a different order reorders primitives without
moving a single point, and today that silently reshuffles every
primitive-keyed random. But the honest claim is "stable under reordering",
not "stable under numerical improvement".

## Design

**`primitiveIdentities(geo, who): Uint32Array`** in `src/data/identity.ts`,
beside `pointIdentities`.

A primitive's identity is the ORDER-INDEPENDENT fold of its own points'
identities, plus its point count. Its points are
`vertexToPoint[primVertexStart[i] + k]` for `k < primVertexCount[i]`
(`src/data/geometry.ts:13-15`); there is no other backing, since
`PrimType` is only `"poly" | "polyline"`.

- **Order-independent, so an edge and its reverse agree.** Sort the
  identities, then chain `hashCombine`, seeded with the count. NOT XOR,
  which cancels duplicates — the same trap `src/graph/itemKey.ts:17-20`
  already records, and coincident points are real.
- **Derived from its OWN points, not from a parent.** `sweepProfile` and
  `extrudePolygon` carry a `primSrc` back to the primitive they came from,
  and it is tempting to key on that. Do not: a cell may hold a derived
  primitive whose parent is outside it, and then the parent identity is
  unreachable. Own points are always present by construction.
- **Documented under-determination, mirroring the point domain.** Two
  primitives over the same point SET are the same primitive here, whatever
  their vertex order — so a quad ABCD and a quad ABDC collide. That is the
  same shape of admission `pointIdentities` already makes ("two points that
  agree on position and seed are the SAME point", `identity.ts:27-33`) and
  it should be written in the same voice. The stronger answer is a
  canonical cyclic sequence (rotate to the smallest identity, take the
  lexicographically smaller of the two directions), which distinguishes
  them and still makes an edge agree with its reverse. Deferred until a
  caller needs it, and named here so it is not re-derived from scratch.

**Reuse the fold, do not copy it.** `foldIdentities` already exists,
module-private, at `src/graph/itemKey.ts:86`. `itemKey.ts` imports
`src/data/identity.js`, so a `src/data` module cannot import back. Move the
helper DOWN into `src/data/identity.ts` and have `itemKey.ts` import it
from there — that removes a duplicate rather than creating one.

**Partitioning is fine, and for a reason worth recording.** Halo is not a
runtime concept; it is authored, as the three-node recipe at
`src/nodes/topology.ts:83` (widen, `filterByBounds` half-open,
`connectPoints`, then `filterPrimitivesByBounds` on the unwidened
rectangle). Both cells therefore hold both endpoints of a seam edge,
identity is a pure function of stored position bits and `seed`, and
`unreferencedPoints: "drop"` renumbers points without moving them. So two
cells agree on a shared primitive's identity.

**Vertex and detail keep the index**, deliberately. The vertex domain has
the same defect and no caller — no corpus graph uses vertex-domain
randomness at all — and a vertex identity is a different question (a
vertex is a point AND a position within a primitive). Leaving it is
consistent with this file's "wants a caller" discipline; say so in the
comment rather than leaving the asymmetry to be discovered.

## This one MOVES THE GOLDEN, which makes it a different class of commit

Every other change this run had "the golden must not move" as its
correctness gate. Here it must move: `graphs/examples-rig.json:3341` puts a
`randomField` on the primitive domain, `drapeSome` filters on it, and a
`sweepProfile` builds drapes from what survives — so the drape counts and
bounds in `tests/graphs.golden.json` all shift. `npm run graphs:golden`
regenerates it, and the commit has to say why rather than letting a
regenerated golden pass unremarked.

The two other primitive-domain `setAttribute`s in the corpus
(`pipeline-5-roads*.json`) remap a `roadWeight` attribute and carry no
randomness, so they must NOT move. That is a useful control: if they move,
something is wrong beyond the intended change.

## What must be tested

- **The actual property**: permute a geometry's primitives WITHOUT moving
  any point, and assert primitive-domain `randomField` is unchanged. This
  is the claim; everything else is detail. It must fail on the current
  index-keyed implementation.
- An edge and its reverse get the same identity.
- Two primitives over the same points in different vertex order collide —
  asserted, not left implicit, so the documented limitation is pinned.
- Coincident points do not cancel (the XOR trap).
- A seam edge gets the same identity in both cells of a halo split.
- Vertex and detail domains still key on the index.
- `pipeline-5-roads*.json` golden entries do NOT move.
