var e=`{
  "formatVersion": 1,
  "seed": 40100,
  "meta": {
    "title": "staged pipeline 3/5 — a street, its frontage band, and lot footprints",
    "description": "Stages 1-2 verbatim, plus building plots. ADDS \`lots\` and \`footprints\`: the district centres are sorted by their bearing, atan2(z, x), and closed into one ring called \`spine\`, the district field is cut to a frontage band (within 11 of the street, at least 4 off it), each survivor is turned to face the nearest street sample and given a random size, and \`selfPrune\` spaces them 7 apart. A 4-corner ring copied onto every lot and grouped by \`lotId\` becomes one closed quad per plot. Note the reserved EDIT SLOT: \`edits\` is a \`mergePoints\` with nothing connected, so it cooks to an empty cloud that clears nothing and merges nothing — see the \`-edits\` variant, which is this file plus authored geometry and one connection. The slot comes with a RANK as well as a wire: procedural lots are stamped \`locked = 0\` on their way into the merge and the prune reads \`priority: attribute(\\"locked\\")\`, so a point arriving through the slot at 1 outranks every procedural neighbour it contests. Here nothing arrives, every point ties at 0, and the prune is exactly the index-greedy one it has always been — which is what \`priority\`'s default is for. WHAT \`spine\` IS, PLAINLY: an angular TOUR of the centres in bearing order, and NOT a road network. It cannot branch and it cannot fork — \`pointsToPath\` puts every point in exactly one group, so every centre gets exactly two neighbours and the result is always a single closed loop. What it is good for is what it is used for here: one continuous curve to measure frontage against, which \`nearSpine\`, \`frontage\` and \`street\` all read. The actual network is stage 5 (\`pipeline-5-roads.json\`), where \`connectPoints\` joins these same centres into 2-vertex polylines that SHARE their endpoints, so a junction can carry three roads or more. This ring stays where it is because the stages are supersets: stages 3 and 4 were measured against it, and retuning it would move them both. Staging works because a node's seed is hashCombine(graphSeed, hashString(nodeId)) — node-local, independent of where the node sits in the DAG — so every earlier stage reproduces bit-identically inside every later one.",
    "tags": [
      "pipeline",
      "staged",
      "path",
      "placement"
    ]
  },
  "nodes": [
    {
      "id": "ground",
      "type": "meshPrimitive",
      "params": {
        "shape": "plane",
        "size": [
          260,
          0,
          260
        ],
        "orientation": "xz",
        "subdivisions": [
          24,
          1,
          24
        ]
      }
    },
    {
      "id": "terrain",
      "type": "subgraph",
      "params": {
        "amount": 20,
        "frequency": 0.012,
        "variant": 0
      },
      "ref": {
        "name": "transform/displace-by-noise"
      }
    },
    {
      "id": "ring",
      "type": "subgraph",
      "params": {
        "count": 64,
        "size": [
          78,
          1,
          78
        ]
      },
      "ref": {
        "name": "shape/ring"
      }
    },
    {
      "id": "wallShape",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "mul",
          "args": [
            {
              "fn": "normalize",
              "args": [
                {
                  "fn": "position"
                }
              ]
            },
            {
              "fn": "remap",
              "args": [
                {
                  "fn": "perlinNoise",
                  "opts": {
                    "frequency": 0.02,
                    "normalized": true,
                    "position": {
                      "fn": "add",
                      "args": [
                        { "fn": "position" },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 1021] }] }] }, 0.245422363] }, 1600] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 3067] }] }] }, 0.852783203] }, 1600] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, 8191] }] }] }, 0.133300781] }, 1600] }
                          ]
                        }
                      ]
                    }
                  }
                },
                0,
                1,
                -8,
                8
              ]
            }
          ]
        }
      }
    },
    {
      "id": "wallPath",
      "type": "pointsToPath",
      "params": {
        "closed": true
      }
    },
    {
      "id": "wall",
      "type": "writeTangents",
      "params": {}
    },
    {
      "id": "cells",
      "type": "pointGrid",
      "params": {
        "countX": 34,
        "countY": 1,
        "countZ": 34,
        "spacing": [
          6,
          1,
          6
        ],
        "origin": [
          -99,
          40,
          -99
        ]
      }
    },
    {
      "id": "cellMask",
      "type": "filterByExpression",
      "params": {
        "predicate": {
          "fn": "le",
          "args": [
            {
              "fn": "length",
              "args": [
                {
                  "fn": "vec",
                  "args": [
                    {
                      "fn": "component",
                      "args": [
                        {
                          "fn": "position"
                        }
                      ],
                      "index": 0
                    },
                    0,
                    {
                      "fn": "component",
                      "args": [
                        {
                          "fn": "position"
                        }
                      ],
                      "index": 2
                    }
                  ]
                }
              ]
            },
            63
          ]
        }
      }
    },
    {
      "id": "cellDrop",
      "type": "subgraph",
      "params": {
        "direction": [
          0,
          -1,
          0
        ],
        "maxDistance": 0
      },
      "ref": {
        "name": "place/drop-to-surface"
      }
    },
    {
      "id": "seeds",
      "type": "pointScatterInBounds",
      "params": {
        "count": 600,
        "boundsMin": [
          -63,
          0,
          -63
        ],
        "boundsMax": [
          63,
          0,
          63
        ],
        "seed": 0
      }
    },
    {
      "id": "seedMask",
      "type": "filterByExpression",
      "params": {
        "predicate": {
          "fn": "le",
          "args": [
            {
              "fn": "length",
              "args": [
                {
                  "fn": "vec",
                  "args": [
                    {
                      "fn": "component",
                      "args": [
                        {
                          "fn": "position"
                        }
                      ],
                      "index": 0
                    },
                    0,
                    {
                      "fn": "component",
                      "args": [
                        {
                          "fn": "position"
                        }
                      ],
                      "index": 2
                    }
                  ]
                }
              ]
            },
            63
          ]
        }
      }
    },
    {
      "id": "centres",
      "type": "selfPrune",
      "params": {
        "minDistance": 34
      }
    },
    {
      "id": "centreId",
      "type": "setAttribute",
      "params": {
        "name": "district",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "index"
        }
      }
    },
    {
      "id": "centreKind",
      "type": "setAttribute",
      "params": {
        "name": "districtKind",
        "domain": "point",
        "type": "string",
        "values": [
          "core",
          "market",
          "works",
          "fields"
        ],
        "value": {
          "fn": "mul",
          "args": [
            {
              "fn": "randomField",
              "key": "district"
            },
            4
          ]
        }
      }
    },
    {
      "id": "districts",
      "type": "sampleNearestPoint",
      "params": {
        "distanceAttr": "districtDist",
        "indexAttr": "district",
        "attribute": "districtKind",
        "outAttribute": "districtKind"
      }
    },
    {
      "id": "spineU",
      "type": "setAttribute",
      "params": {
        "name": "spineU",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "atan2",
          "args": [
            {
              "fn": "component",
              "args": [
                {
                  "fn": "position"
                }
              ],
              "index": 2
            },
            {
              "fn": "component",
              "args": [
                {
                  "fn": "position"
                }
              ],
              "index": 0
            }
          ]
        }
      }
    },
    {
      "id": "spine",
      "type": "pointsToPath",
      "params": {
        "closed": true,
        "orderAttr": "spineU"
      }
    },
    {
      "id": "nearSpine",
      "type": "subgraph",
      "params": {
        "comparison": "le",
        "distance": 11,
        "resolution": 2
      },
      "ref": {
        "name": "filter/by-distance-to-curve"
      }
    },
    {
      "id": "frontage",
      "type": "subgraph",
      "params": {
        "comparison": "ge",
        "distance": 4,
        "resolution": 2
      },
      "ref": {
        "name": "filter/by-distance-to-curve"
      }
    },
    {
      "id": "street",
      "type": "splineSample",
      "params": {
        "mode": "spacing",
        "spacing": 2
      }
    },
    {
      "id": "frontDir",
      "type": "sampleNearestPoint",
      "params": {
        "distanceAttr": "",
        "attribute": "P",
        "outAttribute": "streetP"
      }
    },
    {
      "id": "facing",
      "type": "orientAlongVector",
      "params": {
        "axis": "+z",
        "direction": {
          "fn": "sub",
          "args": [
            {
              "fn": "attribute",
              "name": "streetP",
              "tupleSize": 3
            },
            {
              "fn": "position"
            }
          ]
        }
      }
    },
    {
      "id": "lotSize",
      "type": "subgraph",
      "params": {
        "min": 0.8,
        "max": 1.3
      },
      "ref": {
        "name": "write/random-scale"
      }
    },
    {
      "id": "editSlot",
      "type": "pointScatterInBounds",
      "params": {
        "count": 0,
        "boundsMin": [
          0,
          0,
          0
        ],
        "boundsMax": [
          0,
          0,
          0
        ],
        "seed": 0
      }
    },
    {
      "id": "edits",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "clear",
      "type": "subgraph",
      "params": {
        "comparison": "ge",
        "distance": 3
      },
      "ref": {
        "name": "filter/by-distance-to"
      }
    },
    {
      "id": "lotLock",
      "type": "setAttribute",
      "params": {
        "name": "locked",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": 0
      }
    },
    {
      "id": "lotMerge",
      "type": "subgraph",
      "params": {
        "kindAttr": "origin",
        "nameA": "procedural",
        "nameB": "authored"
      },
      "ref": {
        "name": "compose/merge-tagged"
      }
    },
    {
      "id": "lots",
      "type": "selfPrune",
      "params": {
        "minDistance": 7,
        "priority": {
          "fn": "attribute",
          "name": "locked",
          "tupleSize": 1
        }
      }
    },
    {
      "id": "corner",
      "type": "subgraph",
      "params": {
        "count": 4,
        "size": [
          3.5,
          1,
          3.5
        ],
        "rotate": [
          0,
          45,
          0
        ]
      },
      "ref": {
        "name": "shape/ring"
      }
    },
    {
      "id": "footprint",
      "type": "copyToPoints",
      "params": {}
    },
    {
      "id": "lotId",
      "type": "setAttribute",
      "params": {
        "name": "lotId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "floor",
          "args": [
            {
              "fn": "div",
              "args": [
                {
                  "fn": "index"
                },
                4
              ]
            }
          ]
        }
      }
    },
    {
      "id": "footprints",
      "type": "pointsToPath",
      "params": {
        "closed": true,
        "groupAttr": "lotId"
      }
    }
  ],
  "connections": [
    {
      "from": [
        "ground",
        "out"
      ],
      "to": [
        "terrain",
        "in"
      ]
    },
    {
      "from": [
        "ring",
        "out"
      ],
      "to": [
        "wallShape",
        "in"
      ]
    },
    {
      "from": [
        "wallShape",
        "out"
      ],
      "to": [
        "wallPath",
        "in"
      ]
    },
    {
      "from": [
        "wallPath",
        "out"
      ],
      "to": [
        "wall",
        "in"
      ]
    },
    {
      "from": [
        "cells",
        "out"
      ],
      "to": [
        "cellMask",
        "in"
      ]
    },
    {
      "from": [
        "cellMask",
        "out"
      ],
      "to": [
        "cellDrop",
        "points"
      ]
    },
    {
      "from": [
        "terrain",
        "out"
      ],
      "to": [
        "cellDrop",
        "surface"
      ]
    },
    {
      "from": [
        "seeds",
        "out"
      ],
      "to": [
        "seedMask",
        "in"
      ]
    },
    {
      "from": [
        "seedMask",
        "out"
      ],
      "to": [
        "centres",
        "in"
      ]
    },
    {
      "from": [
        "centres",
        "out"
      ],
      "to": [
        "centreId",
        "in"
      ]
    },
    {
      "from": [
        "centreId",
        "out"
      ],
      "to": [
        "centreKind",
        "in"
      ]
    },
    {
      "from": [
        "cellDrop",
        "out"
      ],
      "to": [
        "districts",
        "in"
      ]
    },
    {
      "from": [
        "centreKind",
        "out"
      ],
      "to": [
        "districts",
        "source"
      ]
    },
    {
      "from": [
        "centreKind",
        "out"
      ],
      "to": [
        "spineU",
        "in"
      ]
    },
    {
      "from": [
        "spineU",
        "out"
      ],
      "to": [
        "spine",
        "in"
      ]
    },
    {
      "from": [
        "districts",
        "out"
      ],
      "to": [
        "nearSpine",
        "in"
      ]
    },
    {
      "from": [
        "spine",
        "out"
      ],
      "to": [
        "nearSpine",
        "curve"
      ]
    },
    {
      "from": [
        "nearSpine",
        "out"
      ],
      "to": [
        "frontage",
        "in"
      ]
    },
    {
      "from": [
        "spine",
        "out"
      ],
      "to": [
        "frontage",
        "curve"
      ]
    },
    {
      "from": [
        "spine",
        "out"
      ],
      "to": [
        "street",
        "in"
      ]
    },
    {
      "from": [
        "frontage",
        "out"
      ],
      "to": [
        "frontDir",
        "in"
      ]
    },
    {
      "from": [
        "street",
        "out"
      ],
      "to": [
        "frontDir",
        "source"
      ]
    },
    {
      "from": [
        "frontDir",
        "out"
      ],
      "to": [
        "facing",
        "in"
      ]
    },
    {
      "from": [
        "facing",
        "out"
      ],
      "to": [
        "lotSize",
        "in"
      ]
    },
    {
      "from": [
        "editSlot",
        "out"
      ],
      "to": [
        "edits",
        "in"
      ]
    },
    {
      "from": [
        "lotSize",
        "out"
      ],
      "to": [
        "clear",
        "in"
      ]
    },
    {
      "from": [
        "edits",
        "out"
      ],
      "to": [
        "clear",
        "features"
      ]
    },
    {
      "from": [
        "edits",
        "out"
      ],
      "to": [
        "lotMerge",
        "b"
      ]
    },
    {
      "from": [
        "clear",
        "out"
      ],
      "to": [
        "lotLock",
        "in"
      ]
    },
    {
      "from": [
        "lotLock",
        "out"
      ],
      "to": [
        "lotMerge",
        "a"
      ]
    },
    {
      "from": [
        "lotMerge",
        "out"
      ],
      "to": [
        "lots",
        "in"
      ]
    },
    {
      "from": [
        "corner",
        "out"
      ],
      "to": [
        "footprint",
        "source"
      ]
    },
    {
      "from": [
        "lots",
        "out"
      ],
      "to": [
        "footprint",
        "target"
      ]
    },
    {
      "from": [
        "footprint",
        "out"
      ],
      "to": [
        "lotId",
        "in"
      ]
    },
    {
      "from": [
        "lotId",
        "out"
      ],
      "to": [
        "footprints",
        "in"
      ]
    }
  ],
  "outputs": [
    {
      "id": "terrain",
      "pin": "out",
      "name": "terrain"
    },
    {
      "id": "wall",
      "pin": "out",
      "name": "boundary"
    },
    {
      "id": "districts",
      "pin": "out",
      "name": "districts"
    },
    {
      "id": "lots",
      "pin": "out",
      "name": "lots"
    },
    {
      "id": "footprints",
      "pin": "out",
      "name": "footprints"
    }
  ]
}
`;export{e as default};