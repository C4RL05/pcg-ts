var e=`{\r
  "formatVersion": 1,\r
  "seed": 40100,\r
  "meta": {\r
    "title": "staged pipeline 3/5 — a street, its frontage band, and lot footprints",\r
    "description": "Stages 1-2 verbatim, plus building plots. ADDS \`lots\` and \`footprints\`: the district centres are sorted by their bearing, atan2(z, x), and closed into one ring called \`spine\`, the district field is cut to a frontage band (within 11 of the street, at least 4 off it), each survivor is turned to face the nearest street sample and given a random size, and \`selfPrune\` spaces them 7 apart. A 4-corner ring copied onto every lot and grouped by \`lotId\` becomes one closed quad per plot. Note the reserved EDIT SLOT: \`edits\` is a \`mergePoints\` with nothing connected, so it cooks to an empty cloud that clears nothing and merges nothing — see the \`-edits\` variant, which is this file plus authored geometry and one connection. The slot comes with a RANK as well as a wire: procedural lots are stamped \`locked = 0\` on their way into the merge and the prune reads \`priority: attribute(\\"locked\\")\`, so a point arriving through the slot at 1 outranks every procedural neighbour it contests. Here nothing arrives, every point ties at 0, and the prune is exactly the index-greedy one it has always been — which is what \`priority\`'s default is for. WHAT \`spine\` IS, PLAINLY: an angular TOUR of the centres in bearing order, and NOT a road network. It cannot branch and it cannot fork — \`pointsToPath\` puts every point in exactly one group, so every centre gets exactly two neighbours and the result is always a single closed loop. What it is good for is what it is used for here: one continuous curve to measure frontage against, which \`nearSpine\`, \`frontage\` and \`street\` all read. The actual network is stage 5 (\`pipeline-5-roads.json\`), where \`connectPoints\` joins these same centres into 2-vertex polylines that SHARE their endpoints, so a junction can carry three roads or more. This ring stays where it is because the stages are supersets: stages 3 and 4 were measured against it, and retuning it would move them both. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.",\r
    "tags": [\r
      "pipeline",\r
      "staged",\r
      "path",\r
      "placement"\r
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
    }\r
  ]\r
}\r
`;export{e as default};