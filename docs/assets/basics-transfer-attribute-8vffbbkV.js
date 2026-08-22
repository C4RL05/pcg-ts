var e=`{\r
  "formatVersion": 1,\r
  "seed": 1014,\r
  "meta": {\r
    "title": "read a value off a surface below each point",\r
    "description": "\`transferAttribute\` copies an attribute from its \`source\` geometry onto the main input's points. Mapping 'raycast' casts a ray from each point along \`direction\` and interpolates the value at the nearest forward hit, which is how a scattered cloud reads the terrain under it. A point whose ray hits nothing keeps the value it already had — never an invented one — and \`missCountAttr\` records how many missed as a detail attribute so a graph can assert on it.",\r
    "tags": ["basics", "transfer", "mesh", "raycast"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "plane",\r
        "size": [60, 0, 60],\r
        "center": [0, 0, 0],\r
        "orientation": "xz",\r
        "subdivisions": [16, 1, 16]\r
      }\r
    },\r
    {\r
      "id": "terrain",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "terrain",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fbm",\r
          "base": "perlinNoise",\r
          "opts": {\r
            "seed": { "from": "node", "variant": 0 },\r
            "frequency": 0.03,\r
            "octaves": 4,\r
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 400,\r
        "boundsMin": [-28, 10, -28],\r
        "boundsMax": [28, 10, 28]\r
      }\r
    },\r
    {\r
      "id": "sampleDown",\r
      "type": "transferAttribute",\r
      "params": {\r
        "name": "terrain",\r
        "mapping": "raycast",\r
        "direction": [0, -1, 0],\r
        "missCountAttr": "terrainMisses"\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ground", "out"], "to": ["terrain", "in"] },\r
    { "from": ["scatter", "out"], "to": ["sampleDown", "in"] },\r
    { "from": ["terrain", "out"], "to": ["sampleDown", "source"] }\r
  ],\r
  "outputs": [{ "id": "sampleDown", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};