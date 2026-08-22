var e=`{\r
  "formatVersion": 1,\r
  "seed": 1019,\r
  "meta": {\r
    "title": "turn points into instance batches",\r
    "description": "\`spawnInstances\` is a terminal: it converts a point cloud into render-agnostic instance batches, one 4x4 world matrix per point composed as T(P) * R(rot) * S(scale) from the standard attributes. Points group into one batch per asset id. The node has two output pins — \`instances\` for the batches and \`points\`, which passes the input through unchanged for chaining or debug rendering — and this graph declares only the first.",\r
    "tags": ["basics", "spawn", "instancing"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "scatter",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 250,\r
        "boundsMin": [-20, 0, -20],\r
        "boundsMax": [20, 0, 20]\r
      }\r
    },\r
    {\r
      "id": "size",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "remap",\r
          "args": [\r
            {\r
              "fn": "perlinNoise",\r
              "opts": {\r
                "frequency": 0.08,\r
                "seed": { "from": "node", "variant": 9 },\r
                "position": { "fn": "position" }\r
              }\r
            },\r
            -1,\r
            1,\r
            0.6,\r
            1.4\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spawn",\r
      "type": "spawnInstances",\r
      "params": { "assetId": "boulder" }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["scatter", "out"], "to": ["size", "in"] },\r
    { "from": ["size", "out"], "to": ["spawn", "in"] }\r
  ],\r
  "outputs": [{ "id": "spawn", "pin": "instances", "name": "instances" }]\r
}\r
`;export{e as default};