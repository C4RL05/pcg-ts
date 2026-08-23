var e=`{\r
  "formatVersion": 1,\r
  "seed": 20260808,\r
  "meta": {\r
    "title": "headless scatter",\r
    "description": "Scatter points across a 60x60 patch, write a height attribute from fbm perlin noise, keep the points above the midline, and jitter what survives. Cooks in plain Node with no renderer and no page — the graph is data, and the CLI is its feedback loop.",\r
    "tags": ["headless", "scatter", "fields", "cli"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 4000,\r
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
            "frequency": 0.02,\r
            "octaves": 4,\r
            "gain": 0.5,\r
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
    },\r
    {\r
      "id": "spread",\r
      "type": "jitterPoints",\r
      "params": { "amount": [0.6, 0, 0.6] }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["height", "in"] },\r
    { "from": ["height", "out"], "to": ["ridge", "in"] },\r
    { "from": ["ridge", "out"], "to": ["spread", "in"] }\r
  ],\r
  "outputs": [{ "id": "spread", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};