var e=`{\r
  "formatVersion": 1,\r
  "seed": 1050,\r
  "meta": {\r
    "title": "join an authored path to a generated network",\r
    "description": "\`mergePrimitives\` is \`mergePoints\` with the topology kept: points, vertices AND primitives are concatenated, and each input's vertex and primitive references are renumbered onto its place in the result — so an authored boundary path and a generated trail network come out one geometry that is still a network. Send the same two inputs through \`mergePoints\` instead and both survive as loose points with every primitive gone, which is what blocked mixing authored geometry with generated geometry at all. Each domain carries the union of its attributes, an input missing one filling with that column's default over its own range. \`primtype\` is the exception, because it is a type tag rather than a value: each input's primitives keep their own tag, and primitives from an input carrying no tag come out with an empty one instead of inheriting another input's. Mixed primitive kinds in one geometry are fine — every consumer selects what it understands, so a mesh unioned with a network is coherent.",\r
    "tags": ["basics", "merge", "topology", "compose"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "boundary",\r
      "type": "subgraph",\r
      "params": { "count": 28, "size": [26, 26, 26], "center": [0, 0, 0] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "camps",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 70,\r
        "boundsMin": [-18, 0, -18],\r
        "boundsMax": [18, 0, 18]\r
      }\r
    },\r
    {\r
      "id": "trails",\r
      "type": "connectPoints",\r
      "params": { "mode": "relativeNeighborhood", "radius": 12 }\r
    },\r
    { "id": "network", "type": "mergePrimitives", "params": {} }\r
  ],\r
  "connections": [\r
    { "from": ["camps", "out"], "to": ["trails", "in"] },\r
    { "from": ["boundary", "out"], "to": ["network", "in"] },\r
    { "from": ["trails", "out"], "to": ["network", "in"] }\r
  ],\r
  "outputs": [{ "id": "network", "pin": "out", "name": "network" }]\r
}\r
`;export{e as default};