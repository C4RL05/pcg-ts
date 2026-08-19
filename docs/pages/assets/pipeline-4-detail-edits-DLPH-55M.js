var e=`{\r
  "formatVersion": 1,\r
  "seed": 40100,\r
  "meta": {\r
    "title": "staged pipeline 4/5, edited — the full settlement with authored plots",\r
    "description": "\`pipeline-4-detail.json\` verbatim plus the same authored edit layer \`pipeline-3-lots-edits.json\` adds, so it is a superset of BOTH. It is the whole point of the arrangement: \`terrain\`, \`boundary\` and \`districts\` stay bit-identical to the unedited stage 4, while \`lots\`, \`footprints\`, \`buildings\` and everything downstream of them respond to the hand-placed geometry. An edit reaches exactly as far as the dependency graph says it does, and no further.",\r
    "tags": [\r
      "pipeline",\r
      "staged",\r
      "edits",\r
      "spawn"\r
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
    },\r
    {\r
      "id": "spineU",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "spineU",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "atan2",\r
          "args": [\r
            {\r
              "fn": "component",\r
              "args": [\r
                {\r
                  "fn": "position"\r
                }\r
              ],\r
              "index": 2\r
            },\r
            {\r
              "fn": "component",\r
              "args": [\r
                {\r
                  "fn": "position"\r
                }\r
              ],\r
              "index": 0\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "spine",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": true,\r
        "orderAttr": "spineU"\r
      }\r
    },\r
    {\r
      "id": "nearSpine",\r
      "type": "subgraph",\r
      "params": {\r
        "comparison": "le",\r
        "distance": 11,\r
        "resolution": 2\r
      },\r
      "ref": {\r
        "name": "filter/by-distance-to-curve"\r
      }\r
    },\r
    {\r
      "id": "frontage",\r
      "type": "subgraph",\r
      "params": {\r
        "comparison": "ge",\r
        "distance": 4,\r
        "resolution": 2\r
      },\r
      "ref": {\r
        "name": "filter/by-distance-to-curve"\r
      }\r
    },\r
    {\r
      "id": "street",\r
      "type": "splineSample",\r
      "params": {\r
        "mode": "spacing",\r
        "spacing": 2\r
      }\r
    },\r
    {\r
      "id": "frontDir",\r
      "type": "sampleNearestPoint",\r
      "params": {\r
        "distanceAttr": "",\r
        "attribute": "P",\r
        "outAttribute": "streetP"\r
      }\r
    },\r
    {\r
      "id": "facing",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "axis": "+z",\r
        "direction": {\r
          "fn": "sub",\r
          "args": [\r
            {\r
              "fn": "attribute",\r
              "name": "streetP",\r
              "tupleSize": 3\r
            },\r
            {\r
              "fn": "position"\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "lotSize",\r
      "type": "subgraph",\r
      "params": {\r
        "min": 0.8,\r
        "max": 1.3\r
      },\r
      "ref": {\r
        "name": "write/random-scale"\r
      }\r
    },\r
    {\r
      "id": "editSlot",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 0,\r
        "boundsMin": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "boundsMax": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "edits",\r
      "type": "mergePoints",\r
      "params": {}\r
    },\r
    {\r
      "id": "clear",\r
      "type": "subgraph",\r
      "params": {\r
        "comparison": "ge",\r
        "distance": 3\r
      },\r
      "ref": {\r
        "name": "filter/by-distance-to"\r
      }\r
    },\r
    {\r
      "id": "lotLock",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "locked",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": 0\r
      }\r
    },\r
    {\r
      "id": "lotMerge",\r
      "type": "subgraph",\r
      "params": {\r
        "kindAttr": "origin",\r
        "nameA": "procedural",\r
        "nameB": "authored"\r
      },\r
      "ref": {\r
        "name": "compose/merge-tagged"\r
      }\r
    },\r
    {\r
      "id": "lots",\r
      "type": "selfPrune",\r
      "params": {\r
        "minDistance": 7,\r
        "priority": {\r
          "fn": "attribute",\r
          "name": "locked",\r
          "tupleSize": 1\r
        }\r
      }\r
    },\r
    {\r
      "id": "corner",\r
      "type": "subgraph",\r
      "params": {\r
        "count": 4,\r
        "size": [\r
          3.5,\r
          1,\r
          3.5\r
        ],\r
        "rotate": [\r
          0,\r
          45,\r
          0\r
        ]\r
      },\r
      "ref": {\r
        "name": "shape/ring"\r
      }\r
    },\r
    {\r
      "id": "footprint",\r
      "type": "copyToPoints",\r
      "params": {}\r
    },\r
    {\r
      "id": "lotId",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "lotId",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "floor",\r
          "args": [\r
            {\r
              "fn": "div",\r
              "args": [\r
                {\r
                  "fn": "index"\r
                },\r
                4\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "footprints",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": true,\r
        "groupAttr": "lotId"\r
      }\r
    },\r
    {\r
      "id": "buildings",\r
      "type": "subgraph",\r
      "params": {\r
        "assets": [\r
          "hall",\r
          "house",\r
          "house",\r
          "barn"\r
        ],\r
        "assetId": "house",\r
        "speciesAttr": "building"\r
      },\r
      "ref": {\r
        "name": "write/instances-by-species"\r
      }\r
    },\r
    {\r
      "id": "posts",\r
      "type": "subgraph",\r
      "params": {\r
        "mode": "spacing",\r
        "spacing": 6,\r
        "axis": "+z"\r
      },\r
      "ref": {\r
        "name": "place/along-curve"\r
      }\r
    },\r
    {\r
      "id": "postSpawn",\r
      "type": "spawnInstances",\r
      "params": {\r
        "assetId": "post"\r
      }\r
    },\r
    {\r
      "id": "forest",\r
      "type": "subgraph",\r
      "params": {\r
        "count": 1000,\r
        "maxSlope": 0.35,\r
        "maxHeight": 60\r
      },\r
      "ref": {\r
        "name": "place/plantable"\r
      }\r
    },\r
    {\r
      "id": "outside",\r
      "type": "filterByExpression",\r
      "params": {\r
        "predicate": {\r
          "fn": "ge",\r
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
            92\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "treeYaw",\r
      "type": "subgraph",\r
      "params": {},\r
      "ref": {\r
        "name": "write/random-yaw"\r
      }\r
    },\r
    {\r
      "id": "trees",\r
      "type": "subgraph",\r
      "params": {\r
        "assets": [\r
          "pine",\r
          "pine",\r
          "birch",\r
          "bush"\r
        ],\r
        "assetId": "pine"\r
      },\r
      "ref": {\r
        "name": "write/instances-by-species"\r
      }\r
    },\r
    {\r
      "id": "editRow",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 6,\r
        "start": [\r
          -34,\r
          40,\r
          -44\r
        ],\r
        "end": [\r
          16,\r
          40,\r
          -44\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "editBlock",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 3,\r
        "countY": 1,\r
        "countZ": 2,\r
        "spacing": [\r
          9,\r
          1,\r
          9\r
        ],\r
        "origin": [\r
          22,\r
          40,\r
          16\r
        ]\r
      }\r
    },\r
    {\r
      "id": "editPts",\r
      "type": "mergePoints",\r
      "params": {}\r
    },\r
    {\r
      "id": "editDrop",\r
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
      "id": "editLock",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "locked",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": 1\r
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
    },\r
    {\r
      "from": [\r
        "centreKind",\r
        "out"\r
      ],\r
      "to": [\r
        "spineU",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineU",\r
        "out"\r
      ],\r
      "to": [\r
        "spine",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "districts",\r
        "out"\r
      ],\r
      "to": [\r
        "nearSpine",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spine",\r
        "out"\r
      ],\r
      "to": [\r
        "nearSpine",\r
        "curve"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "nearSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "frontage",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spine",\r
        "out"\r
      ],\r
      "to": [\r
        "frontage",\r
        "curve"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spine",\r
        "out"\r
      ],\r
      "to": [\r
        "street",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "frontage",\r
        "out"\r
      ],\r
      "to": [\r
        "frontDir",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "street",\r
        "out"\r
      ],\r
      "to": [\r
        "frontDir",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "frontDir",\r
        "out"\r
      ],\r
      "to": [\r
        "facing",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "facing",\r
        "out"\r
      ],\r
      "to": [\r
        "lotSize",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editSlot",\r
        "out"\r
      ],\r
      "to": [\r
        "edits",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lotSize",\r
        "out"\r
      ],\r
      "to": [\r
        "clear",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "edits",\r
        "out"\r
      ],\r
      "to": [\r
        "clear",\r
        "features"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "edits",\r
        "out"\r
      ],\r
      "to": [\r
        "lotMerge",\r
        "b"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "clear",\r
        "out"\r
      ],\r
      "to": [\r
        "lotLock",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lotLock",\r
        "out"\r
      ],\r
      "to": [\r
        "lotMerge",\r
        "a"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lotMerge",\r
        "out"\r
      ],\r
      "to": [\r
        "lots",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "corner",\r
        "out"\r
      ],\r
      "to": [\r
        "footprint",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lots",\r
        "out"\r
      ],\r
      "to": [\r
        "footprint",\r
        "target"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "footprint",\r
        "out"\r
      ],\r
      "to": [\r
        "lotId",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lotId",\r
        "out"\r
      ],\r
      "to": [\r
        "footprints",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "lots",\r
        "out"\r
      ],\r
      "to": [\r
        "buildings",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wall",\r
        "out"\r
      ],\r
      "to": [\r
        "posts",\r
        "curve"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "posts",\r
        "out"\r
      ],\r
      "to": [\r
        "postSpawn",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "terrain",\r
        "out"\r
      ],\r
      "to": [\r
        "forest",\r
        "surface"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "forest",\r
        "out"\r
      ],\r
      "to": [\r
        "outside",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "outside",\r
        "out"\r
      ],\r
      "to": [\r
        "treeYaw",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "treeYaw",\r
        "out"\r
      ],\r
      "to": [\r
        "trees",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editRow",\r
        "out"\r
      ],\r
      "to": [\r
        "editPts",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editBlock",\r
        "out"\r
      ],\r
      "to": [\r
        "editPts",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editPts",\r
        "out"\r
      ],\r
      "to": [\r
        "editDrop",\r
        "points"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "terrain",\r
        "out"\r
      ],\r
      "to": [\r
        "editDrop",\r
        "surface"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editDrop",\r
        "out"\r
      ],\r
      "to": [\r
        "editLock",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "editLock",\r
        "out"\r
      ],\r
      "to": [\r
        "edits",\r
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
    },\r
    {\r
      "id": "districts",\r
      "pin": "out",\r
      "name": "districts"\r
    },\r
    {\r
      "id": "lots",\r
      "pin": "out",\r
      "name": "lots"\r
    },\r
    {\r
      "id": "footprints",\r
      "pin": "out",\r
      "name": "footprints"\r
    },\r
    {\r
      "id": "buildings",\r
      "pin": "instances",\r
      "name": "buildings"\r
    },\r
    {\r
      "id": "postSpawn",\r
      "pin": "instances",\r
      "name": "props"\r
    },\r
    {\r
      "id": "trees",\r
      "pin": "instances",\r
      "name": "vegetation"\r
    }\r
  ]\r
}\r
`;export{e as default};