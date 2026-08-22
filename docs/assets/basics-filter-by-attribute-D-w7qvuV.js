var e=`{\r
  "formatVersion": 1,\r
  "seed": 1005,\r
  "meta": {\r
    "title": "keep points by an attribute comparison",\r
    "description": "The first of the three ways to remove points: write a scalar column, then compare it. \`filterByAttribute\` tests one named point attribute against \`value\` with one of eq/ne/lt/le/gt/ge and keeps the survivors with every attribute carried. The scratch column stays on the output — \`removeAttribute\` is what takes it off again — which is the cost this idiom pays and \`filterByExpression\` avoids.",\r
    "tags": ["basics", "filter", "attributes"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 800,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "height",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "height",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fbm",\r
          "base": "perlinNoise",\r
          "opts": {\r
            "seed": { "from": "node", "variant": 0 },\r
            "frequency": 0.025,\r
            "octaves": 4,\r
            "normalized": true,\r
            "position": { "fn": "position" }\r
          }\r
        }\r
      }\r
    },\r
    {\r
      "id": "ridge",\r
      "type": "filterByAttribute",\r
      "params": { "attribute": "height", "comparison": "gt", "value": 0.55 }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["height", "in"] },\r
    { "from": ["height", "out"], "to": ["ridge", "in"] }\r
  ],\r
  "outputs": [{ "id": "ridge", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};