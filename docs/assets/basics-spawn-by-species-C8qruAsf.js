var e=`{\r
  "formatVersion": 1,\r
  "seed": 1020,\r
  "meta": {\r
    "title": "spawn a different asset per point",\r
    "description": "A string \`setAttribute\` with a non-empty \`values\` list turns its field-capable \`value\` into a per-point selector — floor, then clamp into range, NaN picks 0 — so weighting by repetition works: 'pine' twice in four entries is half the points. Pointing \`spawnInstances\`' \`assetAttr\` at that attribute splits the output into one batch per asset id, in first-occurrence order, with no per-point branching anywhere in the graph.",\r
    "tags": ["basics", "spawn", "instancing", "strings"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 400,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "species",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "species",\r
        "domain": "point",\r
        "type": "string",\r
        "values": ["pine", "pine", "birch", "boulder"],\r
        "value": { "fn": "mul", "args": [{ "fn": "randomField", "key": "species" }, 4] }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "pine", "assetAttr": "species" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["species", "in"] },\r
    { "from": ["species", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]\r
}\r
`;export{e as default};