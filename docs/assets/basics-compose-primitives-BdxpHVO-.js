var e=`{\r
  "formatVersion": 1,\r
  "seed": 1023,\r
  "meta": {\r
    "title": "compose several primitives into a scatter",\r
    "description": "Four primitives and one terminal node build a complete placement pass: scatter with a guaranteed spacing, cut it to noise-defined regions, turn every point a random way, give every point one uniform random size, then spawn. Each step is a name from the catalog rather than a hand-built cluster of nodes, which is what keeps the graph readable and its behaviour documented. Note what varies: the scatter and the two write steps differ per instance, while the noise mask does not — two masks with the same params cut identically unless their \`variant\` differs.",\r
    "tags": ["basics", "primitives", "composition", "spawn"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "subgraph",\r
      "params": {\r
        "count": 6000,\r
        "minDistance": 2.5,\r
        "boundsMin": [-40, 0, -40],\r
        "boundsMax": [40, 0, 40]\r
      },\r
      "ref": { "name": "fill/scatter-even" }\r
    },\r
    {\r
      "id": "mask",\r
      "type": "subgraph",\r
      "params": { "frequency": 0.03, "threshold": 0.45 },\r
      "ref": { "name": "filter/mask-by-noise" }\r
    },\r
    {\r
      "id": "yaw",\r
      "type": "subgraph",\r
      "params": {},\r
      "ref": { "name": "write/random-yaw" }\r
    },\r
    {\r
      "id": "size",\r
      "type": "subgraph",\r
      "params": { "min": 0.8, "max": 1.6 },\r
      "ref": { "name": "write/random-scale" }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "pine" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["mask", "in"] },\r
    { "from": ["mask", "out"], "to": ["yaw", "in"] },\r
    { "from": ["yaw", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]\r
}\r
`;export{e as default};