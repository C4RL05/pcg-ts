var e=`{
  "formatVersion": 1,
  "seed": 1050,
  "meta": {
    "title": "join an authored path to a generated network",
    "description": "\`mergePrimitives\` is \`mergePoints\` with the topology kept: points, vertices AND primitives are concatenated, and each input's vertex and primitive references are renumbered onto its place in the result — so an authored boundary path and a generated trail network come out one geometry that is still a network. Send the same two inputs through \`mergePoints\` instead and both survive as loose points with every primitive gone, which is what blocked mixing authored geometry with generated geometry at all. Each domain carries the union of its attributes, an input missing one filling with that column's default over its own range. \`primtype\` is the exception, because it is a type tag rather than a value: each input's primitives keep their own tag, and primitives from an input carrying no tag come out with an empty one instead of inheriting another input's. Mixed primitive kinds in one geometry are fine — every consumer selects what it understands, so a mesh unioned with a network is coherent.",
    "tags": ["basics", "merge", "topology", "compose"]
  },
  "nodes": [
    {
      "id": "boundary",
      "type": "subgraph",
      "params": { "count": 28, "size": [26, 26, 26], "center": [0, 0, 0] },
      "ref": { "name": "shape/path-loop" }
    },
    {
      "id": "camps",
      "type": "pointScatterInBounds",
      "params": {
        "count": 70,
        "boundsMin": [-18, 0, -18],
        "boundsMax": [18, 0, 18]
      }
    },
    {
      "id": "trails",
      "type": "connectPoints",
      "params": { "mode": "relativeNeighborhood", "radius": 12 }
    },
    { "id": "network", "type": "mergePrimitives", "params": {} }
  ],
  "connections": [
    { "from": ["camps", "out"], "to": ["trails", "in"] },
    { "from": ["boundary", "out"], "to": ["network", "in"] },
    { "from": ["trails", "out"], "to": ["network", "in"] }
  ],
  "outputs": [{ "id": "network", "pin": "out", "name": "network" }]
}
`;export{e as default};