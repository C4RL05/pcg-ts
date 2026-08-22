var e=`{\r
  "formatVersion": 1,\r
  "seed": 1022,\r
  "meta": {\r
    "title": "reference a shipped primitive by name",\r
    "description": "Instead of embedding a copy of a subgraph, a node can name one from the shipped vocabulary: \`ref: { name }\` resolves against the registry, which is populated by importing \`pcg-ts/primitives\` (the \`pcg\` CLI does it for you). Prefer this over rebuilding the same four nodes by hand — the catalog in docs/primitives.md documents each primitive's real behaviour, including what varies per instance. A \`ref\` may also carry an optional \`hash\` to pin the exact content it was authored against; without one it always resolves to the library's current version.",\r
    "tags": ["basics", "primitives", "vocabulary", "ref"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "trees",\r
      "type": "subgraph",\r
      "params": {\r
        "count": 4000,\r
        "minDistance": 3,\r
        "boundsMin": [-40, 0, -40],\r
        "boundsMax": [40, 0, 40]\r
      },\r
      "ref": { "name": "fill/scatter-even" }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "trees", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};