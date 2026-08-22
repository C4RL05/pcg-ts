var e=`{\r
  "formatVersion": 1,\r
  "seed": 40100,\r
  "meta": {\r
    "title": "staged pipeline 2/5 — district centres and the field they claim",\r
    "description": "Stage 1 verbatim, plus a district layer. ADDS \`districts\`: a 34x34 grid masked to a disc and dropped onto the terrain, with every surviving cell told which district owns it. The centres come from a separate scatter thinned by \`selfPrune\`, numbered with an i32 \`district\` and given a string \`districtKind\`; \`sampleNearestPoint\` then writes the owning index, the distance to it and the kind onto each cell. \`terrain\` and \`boundary\` cook bit-identically to stage 1 — nothing upstream was touched. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.",\r
    "tags": [\r
      "pipeline",\r
      "staged",\r
      "sampling",\r
      "attributes"\r
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
    },\r
    {\r
      "id": "cells",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 34,\r
        "countY": 1,\r
        "countZ": 34,\r
        "spacing": [\r
          6,\r
          1,\r
          6\r
        ],\r
        "origin": [\r
          -99,\r
          40,\r
          -99\r
        ]\r
      }\r
    },\r
    {\r
      "id": "cellMask",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "le",\r
          "args": [\r
            {\r
              "fn": "length",\r
              "args": [\r
                {\r
                  "fn": "vec",\r
                  "args": [\r
                    {\r
                      "fn": "component",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        }\r
                      ],\r
                      "index": 0\r
                    },\r
                    0,\r
                    {\r
                      "fn": "component",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        }\r
                      ],\r
                      "index": 2\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            63\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "cellDrop",\r
      "type": "subgraph",\r
      "params": {\r
        "direction": [\r
          0,\r
          -1,\r
          0\r
        ],\r
        "maxDistance": 0\r
      },\r
      "ref": {\r
        "name": "place/drop-to-surface"\r
      }\r
    },\r
    {\r
      "id": "seeds",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 600,\r
        "boundsMin": [\r
          -63,\r
          0,\r
          -63\r
        ],\r
        "boundsMax": [\r
          63,\r
          0,\r
          63\r
        ],\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "seedMask",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "le",\r
          "args": [\r
            {\r
              "fn": "length",\r
              "args": [\r
                {\r
                  "fn": "vec",\r
                  "args": [\r
                    {\r
                      "fn": "component",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        }\r
                      ],\r
                      "index": 0\r
                    },\r
                    0,\r
                    {\r
                      "fn": "component",\r
                      "args": [\r
                        {\r
                          "fn": "position"\r
                        }\r
                      ],\r
                      "index": 2\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            63\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "centres",\r
      "type": "selfPrune",\r
      "params": {\r
        "minDistance": 34\r
      }\r
    },\r
    {\r
      "id": "centreId",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "district",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "index"\r
        }\r
      }\r
    },\r
    {\r
      "id": "centreKind",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "districtKind",\r
        "domain": "point",\r
        "type": "string",\r
        "values": [\r
          "core",\r
          "market",\r
          "works",\r
          "fields"\r
        ],\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "randomField",\r
              "key": "district"\r
            },\r
            4\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "districts",\r
      "type": "sampleNearestPoint",\r
      "params": {\r
        "distanceAttr": "districtDist",\r
        "indexAttr": "district",\r
        "attribute": "districtKind",\r
        "outAttribute": "districtKind"\r
      }\r
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
    },\r
    {\r
      "from": [\r
        "cells",\r
        "out"\r
      ],\r
      "to": [\r
        "cellMask",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "cellMask",\r
        "out"\r
      ],\r
      "to": [\r
        "cellDrop",\r
        "points"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "terrain",\r
        "out"\r
      ],\r
      "to": [\r
        "cellDrop",\r
        "surface"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "seeds",\r
        "out"\r
      ],\r
      "to": [\r
        "seedMask",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "seedMask",\r
        "out"\r
      ],\r
      "to": [\r
        "centres",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "centres",\r
        "out"\r
      ],\r
      "to": [\r
        "centreId",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "centreId",\r
        "out"\r
      ],\r
      "to": [\r
        "centreKind",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "cellDrop",\r
        "out"\r
      ],\r
      "to": [\r
        "districts",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "centreKind",\r
        "out"\r
      ],\r
      "to": [\r
        "districts",\r
        "source"\r
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
    },\r
    {\r
      "id": "districts",\r
      "pin": "out",\r
      "name": "districts"\r
    }\r
  ]\r
}\r
`;export{e as default};