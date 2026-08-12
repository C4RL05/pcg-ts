# 10 — headless

The first example that is **data, not a page**. `graph.json` is a complete
graph in the library's serialized format (`formatVersion` 1), carrying an
optional `meta` block that says what it is. Nothing here renders: the
graph is loaded, cooked in plain Node, and reported on.

```
npm run build
node examples/07-headless/run.mjs          # cook it, print stats and bounds
node examples/07-headless/run.mjs 12345    # same graph, another seed
```

## The same graph through the CLI

`run.mjs` exists to show the API. In practice you do not write a script at
all — `pcg` is the feedback loop:

```
pcg validate examples/07-headless/graph.json
pcg cook     examples/07-headless/graph.json --stats
pcg inspect  examples/07-headless/graph.json --node height --rows 3
pcg render   examples/07-headless/graph.json --attr height --out ridge.svg
```

`validate` deserializes and reports the structure. `cook` runs it headless
and prints per-node stats (cooked vs served from cache). `inspect` cooks
one node's output pin — only its upstream subgraph, not the whole graph —
and prints element counts per domain, attribute statistics, bounds and
sample rows. `render` draws a deterministic top-down SVG: same seed, same
bytes, so it diffs in git like any other file.

In the repo, before publishing, run it through the built entry point:

```
node bin/pcg.mjs cook examples/07-headless/graph.json --stats
```

## The graph

`pointScatterInBounds` → `setAttribute` (an fbm perlin field, normalized to
[0, 1], written to `height`) → `filterByAttribute` (keep `height > 0.55`) →
`jitterPoints`. Four nodes, one declared output named `points`. The ridge
lines that survive the filter are the noise field's upper contour.
