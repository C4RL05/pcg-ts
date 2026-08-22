var e=`{\r
  "formatVersion": 1,\r
  "seed": 40100,\r
  "meta": {\r
    "title": "staged pipeline 1/5 — the ground and the wall",\r
    "description": "First step of a settlement-scale pipeline whose four stages are four files, each the previous file plus new nodes, connections and outputs — nothing removed, no param retuned, one shared seed. This stage ADDS the two things every later stage stands on: a subdivided plane pushed into rolling terrain by a noise field (\`terrain\`), and a 64-point ring displaced along its own radius and closed into a path with tangents written on it (\`boundary\`). Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.",\r
    "tags": [\r
      "pipeline",\r
      "staged",\r
      "terrain",\r
      "path"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "plane",\r
        "size": [\r
          260,\r
          0,\r
          260\r
        ],\r
        "orientation": "xz",\r
        "subdivisions": [\r
          24,\r
          1,\r
          24\r
        ]\r
      }\r
    },\r
    {\r
      "id": "terrain",\r
      "type": "subgraph",\r
      "params": {\r
        "amount": 20,\r
        "frequency": 0.012,\r
        "variant": 0\r
      },\r
      "ref": {\r
        "name": "transform/displace-by-noise"\r
      }\r
    },\r
    {\r
      "id": "ring",\r
      "type": "subgraph",\r
      "params": {\r
        "count": 64,\r
        "size": [\r
          78,\r
          1,\r
          78\r
        ]\r
      },\r
      "ref": {\r
        "name": "shape/ring"\r
      }\r
    },\r
    {\r
      "id": "wallShape",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "normalize",\r
              "args": [\r
                {\r
                  "fn": "position"\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "remap",\r
              "args": [\r
                {\r
                  "fn": "perlinNoise",\r
                  "opts": {\r
                    "seed": { "from": "node", "variant": 0 },\r
                    "frequency": 0.02,\r
                    "normalized": true,\r
                    "position": { "fn": "position" }\r
                  }\r
                },\r
                0,\r
                1,\r
                -8,\r
                8\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "wallPath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": true\r
      }\r
    },\r
    {\r
      "id": "wall",\r
      "type": "writeTangents",\r
      "params": {}\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "ground",\r
        "out"\r
      ],\r
      "to": [\r
        "terrain",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "ring",\r
        "out"\r
      ],\r
      "to": [\r
        "wallShape",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wallShape",\r
        "out"\r
      ],\r
      "to": [\r
        "wallPath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wallPath",\r
        "out"\r
      ],\r
      "to": [\r
        "wall",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "terrain",\r
      "pin": "out",\r
      "name": "terrain"\r
    },\r
    {\r
      "id": "wall",\r
      "pin": "out",\r
      "name": "boundary"\r
    }\r
  ]\r
}\r
`;export{e as default};