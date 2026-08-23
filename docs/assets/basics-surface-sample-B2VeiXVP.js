var e=`{\r
  "formatVersion": 1,\r
  "seed": 1013,\r
  "meta": {\r
    "title": "scatter points over a mesh surface",\r
    "description": "\`surfaceSample\` picks each candidate's triangle with probability proportional to its area and then a uniform position inside it, so coverage is even in world units rather than per triangle. Output points carry P, the flat per-triangle \`normal\`, density 1 and a hashed per-point seed. \`densityField\` is field-capable and applied after placement, so the count is at most \`count\` and exactly \`count\` while density stays 1.",\r
    "tags": ["basics", "mesh", "sampler", "placement"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "rock",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "box",\r
        "size": [20, 10, 20],\r
        "center": [0, 5, 0],\r
        "subdivisions": [2, 2, 2]\r
      }\r
    },\r
    {\r
      "id": "onSurface",\r
      "type": "surfaceSample",\r
      "params": { "count": 800, "seed": 2 }\r
    }\r
  ],\r
  "connections": [{ "from": ["rock", "out"], "to": ["onSurface", "in"] }],\r
  "outputs": [{ "id": "onSurface", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};