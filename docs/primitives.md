# Primitive reference

Generated from the named-subgraph registry (`listSubgraphs()`) by `node scripts/gen-primitives.mjs` — do not edit by hand. The same catalog, machine-readable, is in [primitives.json](./primitives.json). For the graph JSON format, including how a graph references a primitive by name, see [authoring.md](./authoring.md); for the node types a primitive is built from, [nodes.md](./nodes.md).

**No primitives are registered in this build, so this catalog is empty.**

That is the honest state, not a generation failure: the mechanism ships —
`registerSubgraph(name, spec)` registers one, and `"ref": { "name": ... }` on
a serialized subgraph node references it — but the shipped vocabulary of
primitives arrives with a later phase. Registering a primitive is what puts a
section here, and `pcg run <name>` is what cooks it.
