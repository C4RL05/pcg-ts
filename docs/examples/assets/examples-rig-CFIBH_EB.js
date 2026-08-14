var e=`{
  "formatVersion": 1,
  "seed": 3,
  "meta": {
    "title": "a suspended rig, built from curves",
    "description": "A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a \`forEach\`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. Nothing is drawn as a surface — the library has no sweep or extrude, so everything solid ends at \`pathSegments\`, which emits one oriented instance per segment for a unit cylinder to land on. Eight declared outputs, one per part, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — but not the noises: a serialized noise carries its seed as a literal, so the spine keeps its wander and the clusters keep their shape. That is true of every corpus graph with a noise in it, not just this one.",
    "tags": [
      "examples",
      "curves",
      "foreach",
      "instancing",
      "rig"
    ]
  },
  "nodes": [
    {
      "id": "spineLine",
      "type": "pointLine",
      "params": {
        "count": 97,
        "start": [
          -17,
          7,
          0
        ],
        "end": [
          17,
          7,
          0
        ],
        "includeEnd": true
      }
    },
    {
      "id": "spineWander",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "vec",
          "args": [
            {
              "fn": "constant",
              "value": 0
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1.2
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 4178438610,
                    "frequency": 0.035,
                    "offset": [
                      0,
                      0,
                      0
                    ],
                    "octaves": 3,
                    "lacunarity": 2,
                    "gain": 0.5
                  }
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 2.4
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 2443226542,
                    "frequency": 0.035,
                    "offset": [
                      0,
                      0,
                      0
                    ],
                    "octaves": 3,
                    "lacunarity": 2,
                    "gain": 0.5
                  }
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "spineSpinePath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "",
        "orderAttr": ""
      }
    },
    {
      "id": "spineSpine",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 130,
        "spacing": 1
      }
    },
    {
      "id": "trussCells",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 46,
        "spacing": 1
      }
    },
    {
      "id": "trussFrame",
      "type": "writeCurveFrame",
      "params": {
        "tangentName": "tangent",
        "normalName": "curveNormal",
        "binormalName": "curveBinormal"
      }
    },
    {
      "id": "trussStation",
      "type": "setAttribute",
      "params": {
        "name": "stationId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "index"
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "trussChords",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "trussBraces",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "trussCorners",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "trussMove0",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 0.42500000000000004
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 0.425
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid0",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.055,
        "extend": 0.055
      }
    },
    {
      "id": "trussMove1",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 0.7071067811865476
                        },
                        {
                          "fn": "constant",
                          "value": -0.7071067811865475
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 0.7071067811865475
                        },
                        {
                          "fn": "constant",
                          "value": 0.7071067811865476
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid1",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.03,
        "extend": 0.03
      }
    },
    {
      "id": "trussMove2",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": -0.425
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 0.42500000000000004
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid2",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.055,
        "extend": 0.055
      }
    },
    {
      "id": "trussMove3",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": -0.7071067811865475
                        },
                        {
                          "fn": "constant",
                          "value": -0.7071067811865476
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 0.7071067811865476
                        },
                        {
                          "fn": "constant",
                          "value": -0.7071067811865475
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid3",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.03,
        "extend": 0.03
      }
    },
    {
      "id": "trussMove4",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": -0.4250000000000001
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": -0.425
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid4",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.055,
        "extend": 0.055
      }
    },
    {
      "id": "trussMove5",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": -0.7071067811865477
                        },
                        {
                          "fn": "constant",
                          "value": 0.7071067811865475
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": -0.7071067811865475
                        },
                        {
                          "fn": "constant",
                          "value": -0.7071067811865477
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid5",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.03,
        "extend": 0.03
      }
    },
    {
      "id": "trussMove6",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 0.42499999999999993
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": -0.4250000000000001
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid6",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.055,
        "extend": 0.055
      }
    },
    {
      "id": "trussMove7",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 0.7071067811865474
                        },
                        {
                          "fn": "constant",
                          "value": 0.7071067811865477
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "lerp",
                      "args": [
                        {
                          "fn": "constant",
                          "value": -0.7071067811865477
                        },
                        {
                          "fn": "constant",
                          "value": 0.7071067811865474
                        },
                        {
                          "fn": "sub",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 2
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "div",
                                      "args": [
                                        {
                                          "fn": "index"
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 2
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "trussSolid7",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.03,
        "extend": 0.03
      }
    },
    {
      "id": "trussChordSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "trussBraceSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "trussPhase",
      "type": "setAttribute",
      "params": {
        "name": "framePhase",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "sub",
          "args": [
            {
              "fn": "attribute",
              "name": "stationId",
              "tupleSize": 1
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 4
                },
                {
                  "fn": "floor",
                  "args": [
                    {
                      "fn": "div",
                      "args": [
                        {
                          "fn": "attribute",
                          "name": "stationId",
                          "tupleSize": 1
                        },
                        {
                          "fn": "constant",
                          "value": 4
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "trussKeep",
      "type": "filterByAttribute",
      "params": {
        "attribute": "framePhase",
        "comparison": "lt",
        "value": 0.5,
        "stringValue": ""
      }
    },
    {
      "id": "trussRing",
      "type": "pointsToPath",
      "params": {
        "closed": true,
        "groupAttr": "stationId",
        "orderAttr": ""
      }
    },
    {
      "id": "trussSolid",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.03,
        "extend": 0.03
      }
    },
    {
      "id": "trussSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "partDense",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 900,
        "spacing": 1
      }
    },
    {
      "id": "partFrame",
      "type": "writeCurveFrame",
      "params": {
        "tangentName": "tangent",
        "normalName": "curveNormal",
        "binormalName": "curveBinormal"
      }
    },
    {
      "id": "partDensity",
      "type": "setAttribute",
      "params": {
        "name": "density",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "fbm",
          "base": "perlinNoise",
          "opts": {
            "seed": 2616234397,
            "frequency": 14,
            "offset": [
              0,
              0,
              0
            ],
            "position": {
              "fn": "vec",
              "args": [
                {
                  "fn": "attribute",
                  "name": "curveU",
                  "tupleSize": 1
                },
                {
                  "fn": "constant",
                  "value": 0
                },
                {
                  "fn": "constant",
                  "value": 0
                }
              ]
            },
            "octaves": 2,
            "lacunarity": 2,
            "gain": 0.5,
            "normalized": true
          }
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "partCluster",
      "type": "filterByDensity",
      "params": {
        "mode": "threshold",
        "threshold": 0.46,
        "seed": 0
      }
    },
    {
      "id": "partScatter",
      "type": "jitterPoints",
      "params": {
        "amount": [
          0.01888888888888889,
          0.01888888888888889,
          0.01888888888888889
        ],
        "seed": 3098584255
      }
    },
    {
      "id": "partPart",
      "type": "setAttribute",
      "params": {
        "name": "part",
        "domain": "point",
        "type": "string",
        "tupleSize": 1,
        "value": {
          "fn": "mul",
          "args": [
            {
              "fn": "randomField",
              "key": "part"
            },
            {
              "fn": "constant",
              "value": 9
            }
          ]
        },
        "values": [
          "rod",
          "rod",
          "rod",
          "rod",
          "bar",
          "bar",
          "panel",
          "clamp",
          "clamp"
        ],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "partAngleAttr",
      "type": "setAttribute",
      "params": {
        "name": "radialAngle",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "mul",
          "args": [
            {
              "fn": "randomField",
              "key": "radial"
            },
            {
              "fn": "constant",
              "value": 6.283185307179586
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "partMount",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "cos",
                      "args": [
                        {
                          "fn": "add",
                          "args": [
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 1.5707963267948966
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "add",
                                      "args": [
                                        {
                                          "fn": "div",
                                          "args": [
                                            {
                                              "fn": "sub",
                                              "args": [
                                                {
                                                  "fn": "attribute",
                                                  "name": "radialAngle",
                                                  "tupleSize": 1
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0.7853981633974483
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 1.5707963267948966
                                            }
                                          ]
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 0.5
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "fn": "constant",
                              "value": 0.7853981633974483
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.6010407640085654
                    },
                    {
                      "fn": "sin",
                      "args": [
                        {
                          "fn": "add",
                          "args": [
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "constant",
                                  "value": 1.5707963267948966
                                },
                                {
                                  "fn": "floor",
                                  "args": [
                                    {
                                      "fn": "add",
                                      "args": [
                                        {
                                          "fn": "div",
                                          "args": [
                                            {
                                              "fn": "sub",
                                              "args": [
                                                {
                                                  "fn": "attribute",
                                                  "name": "radialAngle",
                                                  "tupleSize": 1
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0.7853981633974483
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 1.5707963267948966
                                            }
                                          ]
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 0.5
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "fn": "constant",
                              "value": 0.7853981633974483
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "partOrient",
      "type": "orientAlongVector",
      "params": {
        "direction": {
          "fn": "attribute",
          "name": "tangent",
          "tupleSize": 3
        },
        "up": {
          "fn": "add",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "cos",
                  "args": [
                    {
                      "fn": "attribute",
                      "name": "radialAngle",
                      "tupleSize": 1
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveNormal",
                  "tupleSize": 3
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "sin",
                  "args": [
                    {
                      "fn": "attribute",
                      "name": "radialAngle",
                      "tupleSize": 1
                    }
                  ]
                },
                {
                  "fn": "attribute",
                  "name": "curveBinormal",
                  "tupleSize": 3
                }
              ]
            }
          ]
        },
        "axis": "+z"
      }
    },
    {
      "id": "partSize",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.55
                    },
                    {
                      "fn": "constant",
                      "value": 1.45
                    },
                    {
                      "fn": "randomField",
                      "key": "size"
                    }
                  ]
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.55
                    },
                    {
                      "fn": "constant",
                      "value": 1.45
                    },
                    {
                      "fn": "randomField",
                      "key": "size"
                    }
                  ]
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.55
                    },
                    {
                      "fn": "constant",
                      "value": 1.45
                    },
                    {
                      "fn": "randomField",
                      "key": "size"
                    }
                  ]
                }
              ]
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "partPartSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "rod",
        "assetAttr": "part",
        "colorAttr": ""
      }
    },
    {
      "id": "wrapCells",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 150,
        "spacing": 1
      }
    },
    {
      "id": "wrapFrame",
      "type": "writeCurveFrame",
      "params": {
        "tangentName": "tangent",
        "normalName": "curveNormal",
        "binormalName": "curveBinormal"
      }
    },
    {
      "id": "wrapCarrierLine",
      "type": "pointLine",
      "params": {
        "count": 16,
        "start": [
          0,
          0,
          0
        ],
        "end": [
          15,
          0,
          0
        ],
        "includeEnd": true
      }
    },
    {
      "id": "wrapCarrierId",
      "type": "setAttribute",
      "params": {
        "name": "wrapId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "index"
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "wrapCarriers",
      "type": "partitionByAttribute",
      "params": {
        "name": "wrapId"
      }
    },
    {
      "id": "wrapWraps",
      "type": "forEach",
      "params": {
        "cableRadius": 0.035
      },
      "subgraph": {
        "graph": {
          "formatVersion": 1,
          "seed": 0,
          "nodes": [
            {
              "id": "wrapPick_wphase",
              "type": "setAttribute",
              "params": {
                "name": "wphase",
                "domain": "point",
                "type": "f32",
                "tupleSize": 1,
                "value": {
                  "fn": "randomField",
                  "key": "wphase"
                },
                "values": [],
                "stringValue": "",
                "seed": 0
              }
            },
            {
              "id": "wrapPick_wturns",
              "type": "setAttribute",
              "params": {
                "name": "wturns",
                "domain": "point",
                "type": "f32",
                "tupleSize": 1,
                "value": {
                  "fn": "randomField",
                  "key": "wturns"
                },
                "values": [],
                "stringValue": "",
                "seed": 0
              }
            },
            {
              "id": "wrapPick_wspread",
              "type": "setAttribute",
              "params": {
                "name": "wspread",
                "domain": "point",
                "type": "f32",
                "tupleSize": 1,
                "value": {
                  "fn": "randomField",
                  "key": "wspread"
                },
                "values": [],
                "stringValue": "",
                "seed": 0
              }
            },
            {
              "id": "wrapPick_wofs",
              "type": "setAttribute",
              "params": {
                "name": "wofs",
                "domain": "point",
                "type": "f32",
                "tupleSize": 1,
                "value": {
                  "fn": "randomField",
                  "key": "wofs"
                },
                "values": [],
                "stringValue": "",
                "seed": 0
              }
            },
            {
              "id": "wrapOnto_wphase",
              "type": "transferAttribute",
              "params": {
                "name": "wphase",
                "mapping": "nearest",
                "attrDomain": "point",
                "uvAttr": "uv",
                "direction": [
                  0,
                  -1,
                  0
                ],
                "directionAttr": "",
                "maxDistance": 0,
                "missCountAttr": "",
                "hitAttr": ""
              }
            },
            {
              "id": "wrapOnto_wturns",
              "type": "transferAttribute",
              "params": {
                "name": "wturns",
                "mapping": "nearest",
                "attrDomain": "point",
                "uvAttr": "uv",
                "direction": [
                  0,
                  -1,
                  0
                ],
                "directionAttr": "",
                "maxDistance": 0,
                "missCountAttr": "",
                "hitAttr": ""
              }
            },
            {
              "id": "wrapOnto_wspread",
              "type": "transferAttribute",
              "params": {
                "name": "wspread",
                "mapping": "nearest",
                "attrDomain": "point",
                "uvAttr": "uv",
                "direction": [
                  0,
                  -1,
                  0
                ],
                "directionAttr": "",
                "maxDistance": 0,
                "missCountAttr": "",
                "hitAttr": ""
              }
            },
            {
              "id": "wrapOnto_wofs",
              "type": "transferAttribute",
              "params": {
                "name": "wofs",
                "mapping": "nearest",
                "attrDomain": "point",
                "uvAttr": "uv",
                "direction": [
                  0,
                  -1,
                  0
                ],
                "directionAttr": "",
                "maxDistance": 0,
                "missCountAttr": "",
                "hitAttr": ""
              }
            },
            {
              "id": "wrapMove",
              "type": "transformPoints",
              "params": {
                "translate": {
                  "fn": "add",
                  "args": [
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "add",
                              "args": [
                                {
                                  "fn": "mul",
                                  "args": [
                                    {
                                      "fn": "constant",
                                      "value": 0.6010407640085654
                                    },
                                    {
                                      "fn": "add",
                                      "args": [
                                        {
                                          "fn": "constant",
                                          "value": 1.1
                                        },
                                        {
                                          "fn": "mul",
                                          "args": [
                                            {
                                              "fn": "mul",
                                              "args": [
                                                {
                                                  "fn": "attribute",
                                                  "name": "wspread",
                                                  "tupleSize": 1
                                                },
                                                {
                                                  "fn": "attribute",
                                                  "name": "wspread",
                                                  "tupleSize": 1
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 0.55
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                },
                                {
                                  "fn": "mul",
                                  "args": [
                                    {
                                      "fn": "constant",
                                      "value": 0.14
                                    },
                                    {
                                      "fn": "fbm",
                                      "base": "perlinNoise",
                                      "opts": {
                                        "seed": 2459580991,
                                        "frequency": 0.35,
                                        "offset": [
                                          0,
                                          0,
                                          0
                                        ],
                                        "position": {
                                          "fn": "add",
                                          "args": [
                                            {
                                              "fn": "position"
                                            },
                                            {
                                              "fn": "vec",
                                              "args": [
                                                {
                                                  "fn": "mul",
                                                  "args": [
                                                    {
                                                      "fn": "attribute",
                                                      "name": "wofs",
                                                      "tupleSize": 1
                                                    },
                                                    {
                                                      "fn": "constant",
                                                      "value": 1000
                                                    }
                                                  ]
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0
                                                }
                                              ]
                                            }
                                          ]
                                        },
                                        "octaves": 2,
                                        "lacunarity": 2,
                                        "gain": 0.5
                                      }
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "fn": "cos",
                              "args": [
                                {
                                  "fn": "add",
                                  "args": [
                                    {
                                      "fn": "mul",
                                      "args": [
                                        {
                                          "fn": "attribute",
                                          "name": "wphase",
                                          "tupleSize": 1
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 6.283185307179586
                                        }
                                      ]
                                    },
                                    {
                                      "fn": "mul",
                                      "args": [
                                        {
                                          "fn": "mul",
                                          "args": [
                                            {
                                              "fn": "lerp",
                                              "args": [
                                                {
                                                  "fn": "constant",
                                                  "value": 0.4
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 3.5
                                                },
                                                {
                                                  "fn": "attribute",
                                                  "name": "wturns",
                                                  "tupleSize": 1
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 6.283185307179586
                                            }
                                          ]
                                        },
                                        {
                                          "fn": "attribute",
                                          "name": "curveU",
                                          "tupleSize": 1
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        },
                        {
                          "fn": "attribute",
                          "name": "curveNormal",
                          "tupleSize": 3
                        }
                      ]
                    },
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "add",
                              "args": [
                                {
                                  "fn": "mul",
                                  "args": [
                                    {
                                      "fn": "constant",
                                      "value": 0.6010407640085654
                                    },
                                    {
                                      "fn": "add",
                                      "args": [
                                        {
                                          "fn": "constant",
                                          "value": 1.1
                                        },
                                        {
                                          "fn": "mul",
                                          "args": [
                                            {
                                              "fn": "mul",
                                              "args": [
                                                {
                                                  "fn": "attribute",
                                                  "name": "wspread",
                                                  "tupleSize": 1
                                                },
                                                {
                                                  "fn": "attribute",
                                                  "name": "wspread",
                                                  "tupleSize": 1
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 0.55
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                },
                                {
                                  "fn": "mul",
                                  "args": [
                                    {
                                      "fn": "constant",
                                      "value": 0.14
                                    },
                                    {
                                      "fn": "fbm",
                                      "base": "perlinNoise",
                                      "opts": {
                                        "seed": 2459580991,
                                        "frequency": 0.35,
                                        "offset": [
                                          0,
                                          0,
                                          0
                                        ],
                                        "position": {
                                          "fn": "add",
                                          "args": [
                                            {
                                              "fn": "position"
                                            },
                                            {
                                              "fn": "vec",
                                              "args": [
                                                {
                                                  "fn": "mul",
                                                  "args": [
                                                    {
                                                      "fn": "attribute",
                                                      "name": "wofs",
                                                      "tupleSize": 1
                                                    },
                                                    {
                                                      "fn": "constant",
                                                      "value": 1000
                                                    }
                                                  ]
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 0
                                                }
                                              ]
                                            }
                                          ]
                                        },
                                        "octaves": 2,
                                        "lacunarity": 2,
                                        "gain": 0.5
                                      }
                                    }
                                  ]
                                }
                              ]
                            },
                            {
                              "fn": "sin",
                              "args": [
                                {
                                  "fn": "add",
                                  "args": [
                                    {
                                      "fn": "mul",
                                      "args": [
                                        {
                                          "fn": "attribute",
                                          "name": "wphase",
                                          "tupleSize": 1
                                        },
                                        {
                                          "fn": "constant",
                                          "value": 6.283185307179586
                                        }
                                      ]
                                    },
                                    {
                                      "fn": "mul",
                                      "args": [
                                        {
                                          "fn": "mul",
                                          "args": [
                                            {
                                              "fn": "lerp",
                                              "args": [
                                                {
                                                  "fn": "constant",
                                                  "value": 0.4
                                                },
                                                {
                                                  "fn": "constant",
                                                  "value": 3.5
                                                },
                                                {
                                                  "fn": "attribute",
                                                  "name": "wturns",
                                                  "tupleSize": 1
                                                }
                                              ]
                                            },
                                            {
                                              "fn": "constant",
                                              "value": 6.283185307179586
                                            }
                                          ]
                                        },
                                        {
                                          "fn": "attribute",
                                          "name": "curveU",
                                          "tupleSize": 1
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        },
                        {
                          "fn": "attribute",
                          "name": "curveBinormal",
                          "tupleSize": 3
                        }
                      ]
                    }
                  ]
                },
                "rotateEuler": [
                  0,
                  0,
                  0
                ],
                "scale": [
                  1,
                  1,
                  1
                ]
              }
            },
            {
              "id": "wrapSolid",
              "type": "pathSegments",
              "params": {
                "axis": "+y",
                "radius": 0.035,
                "extend": 0
              }
            }
          ],
          "connections": [
            {
              "from": [
                "wrapPick_wphase",
                "out"
              ],
              "to": [
                "wrapPick_wturns",
                "in"
              ]
            },
            {
              "from": [
                "wrapPick_wturns",
                "out"
              ],
              "to": [
                "wrapPick_wspread",
                "in"
              ]
            },
            {
              "from": [
                "wrapPick_wspread",
                "out"
              ],
              "to": [
                "wrapPick_wofs",
                "in"
              ]
            },
            {
              "from": [
                "wrapPick_wofs",
                "out"
              ],
              "to": [
                "wrapOnto_wphase",
                "source"
              ]
            },
            {
              "from": [
                "wrapPick_wofs",
                "out"
              ],
              "to": [
                "wrapOnto_wturns",
                "source"
              ]
            },
            {
              "from": [
                "wrapOnto_wphase",
                "out"
              ],
              "to": [
                "wrapOnto_wturns",
                "in"
              ]
            },
            {
              "from": [
                "wrapPick_wofs",
                "out"
              ],
              "to": [
                "wrapOnto_wspread",
                "source"
              ]
            },
            {
              "from": [
                "wrapOnto_wturns",
                "out"
              ],
              "to": [
                "wrapOnto_wspread",
                "in"
              ]
            },
            {
              "from": [
                "wrapPick_wofs",
                "out"
              ],
              "to": [
                "wrapOnto_wofs",
                "source"
              ]
            },
            {
              "from": [
                "wrapOnto_wspread",
                "out"
              ],
              "to": [
                "wrapOnto_wofs",
                "in"
              ]
            },
            {
              "from": [
                "wrapOnto_wofs",
                "out"
              ],
              "to": [
                "wrapMove",
                "in"
              ]
            },
            {
              "from": [
                "wrapMove",
                "out"
              ],
              "to": [
                "wrapSolid",
                "in"
              ]
            }
          ],
          "outputs": []
        },
        "inputs": [
          {
            "name": "each",
            "node": "wrapPick_wphase",
            "pin": "in"
          },
          {
            "name": "frame",
            "node": "wrapOnto_wphase",
            "pin": "in"
          }
        ],
        "outputs": [
          {
            "name": "out",
            "node": "wrapSolid",
            "pin": "out"
          }
        ],
        "params": [
          {
            "name": "cableRadius",
            "targets": [
              {
                "node": "wrapSolid",
                "param": "radius"
              }
            ],
            "description": "Radius of the tube each wrap is drawn as.",
            "default": 0.035,
            "min": 0.005,
            "max": 0.2
          }
        ]
      }
    },
    {
      "id": "wrapMerged",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "wrapSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "chainStrand",
      "type": "pointLine",
      "params": {
        "count": 35,
        "start": [
          0,
          0,
          0
        ],
        "end": [
          0,
          1,
          0
        ],
        "includeEnd": true
      }
    },
    {
      "id": "chainAnchors",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 7,
        "spacing": 1
      }
    },
    {
      "id": "chainReach",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "constant",
              "value": 1
            },
            {
              "fn": "sub",
              "args": [
                {
                  "fn": "constant",
                  "value": 13
                },
                {
                  "fn": "component",
                  "args": [
                    {
                      "fn": "position"
                    }
                  ],
                  "index": 1
                }
              ]
            },
            {
              "fn": "constant",
              "value": 1
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "chainCopies",
      "type": "copyToPoints",
      "params": {}
    },
    {
      "id": "chainChainId",
      "type": "setAttribute",
      "params": {
        "name": "chainId",
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
                {
                  "fn": "constant",
                  "value": 35
                }
              ]
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "chainChainPath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "chainId",
        "orderAttr": ""
      }
    },
    {
      "id": "chainSegments",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 1,
        "extend": 0
      }
    },
    {
      "id": "chainLinkSize",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1.3
                },
                {
                  "fn": "component",
                  "args": [
                    {
                      "fn": "attribute",
                      "name": "scale",
                      "tupleSize": 3
                    }
                  ],
                  "index": 1
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1.3
                },
                {
                  "fn": "component",
                  "args": [
                    {
                      "fn": "attribute",
                      "name": "scale",
                      "tupleSize": 3
                    }
                  ],
                  "index": 1
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 1.3
                },
                {
                  "fn": "component",
                  "args": [
                    {
                      "fn": "attribute",
                      "name": "scale",
                      "tupleSize": 3
                    }
                  ],
                  "index": 1
                }
              ]
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "chainAlternate",
      "type": "orientAlongVector",
      "params": {
        "direction": {
          "fn": "vec",
          "args": [
            {
              "fn": "sub",
              "args": [
                {
                  "fn": "constant",
                  "value": 1
                },
                {
                  "fn": "sub",
                  "args": [
                    {
                      "fn": "index"
                    },
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 2
                        },
                        {
                          "fn": "floor",
                          "args": [
                            {
                              "fn": "div",
                              "args": [
                                {
                                  "fn": "index"
                                },
                                {
                                  "fn": "constant",
                                  "value": 2
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "fn": "constant",
              "value": 0
            },
            {
              "fn": "sub",
              "args": [
                {
                  "fn": "index"
                },
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 2
                    },
                    {
                      "fn": "floor",
                      "args": [
                        {
                          "fn": "div",
                          "args": [
                            {
                              "fn": "index"
                            },
                            {
                              "fn": "constant",
                              "value": 2
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        "up": {
          "fn": "attribute",
          "name": "tangent",
          "tupleSize": 3
        },
        "axis": "+z"
      }
    },
    {
      "id": "chainSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "chainLink",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "danglerStrand",
      "type": "pointLine",
      "params": {
        "count": 17,
        "start": [
          0,
          0,
          0
        ],
        "end": [
          0,
          -1,
          0
        ],
        "includeEnd": true
      }
    },
    {
      "id": "danglerStrandU",
      "type": "setAttribute",
      "params": {
        "name": "cableU",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "fraction"
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "danglerAnchors",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 200,
        "spacing": 1
      }
    },
    {
      "id": "danglerBundling",
      "type": "pathPointAt",
      "params": {
        "mode": "fraction",
        "parameter": {
          "fn": "lerp",
          "args": [
            {
              "fn": "attribute",
              "name": "curveU",
              "tupleSize": 1
            },
            {
              "fn": "div",
              "args": [
                {
                  "fn": "add",
                  "args": [
                    {
                      "fn": "floor",
                      "args": [
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "attribute",
                              "name": "curveU",
                              "tupleSize": 1
                            },
                            {
                              "fn": "constant",
                              "value": 7
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "fn": "constant",
                      "value": 0.5
                    }
                  ]
                },
                {
                  "fn": "constant",
                  "value": 7
                }
              ]
            },
            {
              "fn": "constant",
              "value": 0.8
            }
          ]
        }
      }
    },
    {
      "id": "danglerDrop",
      "type": "setAttribute",
      "params": {
        "name": "scale",
        "domain": "point",
        "type": "f32",
        "tupleSize": 3,
        "value": {
          "fn": "vec",
          "args": [
            {
              "fn": "constant",
              "value": 1
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": 3.2
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.55
                    },
                    {
                      "fn": "constant",
                      "value": 1
                    },
                    {
                      "fn": "randomField",
                      "key": "drop0"
                    }
                  ]
                }
              ]
            },
            {
              "fn": "constant",
              "value": 1
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "danglerCopies",
      "type": "copyToPoints",
      "params": {}
    },
    {
      "id": "danglerCableId",
      "type": "setAttribute",
      "params": {
        "name": "cableId",
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
                {
                  "fn": "constant",
                  "value": 17
                }
              ]
            }
          ]
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "danglerCurl",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "vec",
          "args": [
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.5
                    },
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "attribute",
                          "name": "cableU",
                          "tupleSize": 1
                        },
                        {
                          "fn": "attribute",
                          "name": "cableU",
                          "tupleSize": 1
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 2098766061,
                    "frequency": 0.5,
                    "offset": [
                      0,
                      0,
                      0
                    ],
                    "octaves": 2,
                    "lacunarity": 2,
                    "gain": 0.5
                  }
                }
              ]
            },
            {
              "fn": "constant",
              "value": 0
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "constant",
                      "value": 0.5
                    },
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "attribute",
                          "name": "cableU",
                          "tupleSize": 1
                        },
                        {
                          "fn": "attribute",
                          "name": "cableU",
                          "tupleSize": 1
                        }
                      ]
                    }
                  ]
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 1211183335,
                    "frequency": 0.5,
                    "offset": [
                      0,
                      0,
                      0
                    ],
                    "octaves": 2,
                    "lacunarity": 2,
                    "gain": 0.5
                  }
                }
              ]
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "danglerDanglerPath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "cableId",
        "orderAttr": ""
      }
    },
    {
      "id": "danglerDanglerTube",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.035,
        "extend": 0
      }
    },
    {
      "id": "danglerDanglerSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "drapeDrapeAnchors",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 34,
        "spacing": 1
      }
    },
    {
      "id": "drapeChords",
      "type": "connectPoints",
      "params": {
        "mode": "radius",
        "radius": 20,
        "degreeAttr": "",
        "lengthAttr": "edgeLength"
      }
    },
    {
      "id": "drapePick",
      "type": "setAttribute",
      "params": {
        "name": "chordPick",
        "domain": "primitive",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "randomField",
          "key": "chord0"
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
    },
    {
      "id": "drapeDrapeEven",
      "type": "pathResample",
      "params": {
        "mode": "count",
        "count": 23,
        "spacing": 1
      }
    },
    {
      "id": "drapeSag",
      "type": "transformPoints",
      "params": {
        "translate": {
          "fn": "vec",
          "args": [
            {
              "fn": "constant",
              "value": 0
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "constant",
                  "value": -1
                },
                {
                  "fn": "mul",
                  "args": [
                    {
                      "fn": "add",
                      "args": [
                        {
                          "fn": "constant",
                          "value": 0.45
                        },
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "constant",
                              "value": 0.36000000000000004
                            },
                            {
                              "fn": "fbm",
                              "base": "perlinNoise",
                              "opts": {
                                "seed": 1367222746,
                                "frequency": 0.06,
                                "offset": [
                                  0,
                                  0,
                                  0
                                ],
                                "octaves": 1,
                                "lacunarity": 2,
                                "gain": 0.5
                              }
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "fn": "mul",
                      "args": [
                        {
                          "fn": "attribute",
                          "name": "edgeLength",
                          "tupleSize": 1
                        },
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "constant",
                              "value": 4
                            },
                            {
                              "fn": "mul",
                              "args": [
                                {
                                  "fn": "attribute",
                                  "name": "curveU",
                                  "tupleSize": 1
                                },
                                {
                                  "fn": "sub",
                                  "args": [
                                    {
                                      "fn": "constant",
                                      "value": 1
                                    },
                                    {
                                      "fn": "attribute",
                                      "name": "curveU",
                                      "tupleSize": 1
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "fn": "constant",
              "value": 0
            }
          ]
        },
        "rotateEuler": [
          0,
          0,
          0
        ],
        "scale": [
          1,
          1,
          1
        ]
      }
    },
    {
      "id": "drapeDrapeTube",
      "type": "pathSegments",
      "params": {
        "axis": "+y",
        "radius": 0.035,
        "extend": 0
      }
    },
    {
      "id": "drapeDrapeSpawn",
      "type": "spawnInstances",
      "params": {
        "assetId": "tube",
        "assetAttr": "",
        "colorAttr": ""
      }
    },
    {
      "id": "drapeLong",
      "type": "filterByAttribute",
      "params": {
        "attribute": "edgeLength",
        "comparison": "ge",
        "value": 4,
        "stringValue": ""
      }
    },
    {
      "id": "drapeSome",
      "type": "filterByAttribute",
      "params": {
        "attribute": "chordPick",
        "comparison": "lt",
        "value": 0.16,
        "stringValue": ""
      }
    }
  ],
  "connections": [
    {
      "from": [
        "spineLine",
        "out"
      ],
      "to": [
        "spineWander",
        "in"
      ]
    },
    {
      "from": [
        "spineWander",
        "out"
      ],
      "to": [
        "spineSpinePath",
        "in"
      ]
    },
    {
      "from": [
        "spineSpinePath",
        "out"
      ],
      "to": [
        "spineSpine",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "trussCells",
        "in"
      ]
    },
    {
      "from": [
        "trussCells",
        "out"
      ],
      "to": [
        "trussFrame",
        "in"
      ]
    },
    {
      "from": [
        "trussFrame",
        "out"
      ],
      "to": [
        "trussStation",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove0",
        "in"
      ]
    },
    {
      "from": [
        "trussMove0",
        "out"
      ],
      "to": [
        "trussSolid0",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid0",
        "out"
      ],
      "to": [
        "trussChords",
        "in"
      ]
    },
    {
      "from": [
        "trussMove0",
        "out"
      ],
      "to": [
        "trussCorners",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove1",
        "in"
      ]
    },
    {
      "from": [
        "trussMove1",
        "out"
      ],
      "to": [
        "trussSolid1",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid1",
        "out"
      ],
      "to": [
        "trussBraces",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove2",
        "in"
      ]
    },
    {
      "from": [
        "trussMove2",
        "out"
      ],
      "to": [
        "trussSolid2",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid2",
        "out"
      ],
      "to": [
        "trussChords",
        "in"
      ]
    },
    {
      "from": [
        "trussMove2",
        "out"
      ],
      "to": [
        "trussCorners",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove3",
        "in"
      ]
    },
    {
      "from": [
        "trussMove3",
        "out"
      ],
      "to": [
        "trussSolid3",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid3",
        "out"
      ],
      "to": [
        "trussBraces",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove4",
        "in"
      ]
    },
    {
      "from": [
        "trussMove4",
        "out"
      ],
      "to": [
        "trussSolid4",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid4",
        "out"
      ],
      "to": [
        "trussChords",
        "in"
      ]
    },
    {
      "from": [
        "trussMove4",
        "out"
      ],
      "to": [
        "trussCorners",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove5",
        "in"
      ]
    },
    {
      "from": [
        "trussMove5",
        "out"
      ],
      "to": [
        "trussSolid5",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid5",
        "out"
      ],
      "to": [
        "trussBraces",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove6",
        "in"
      ]
    },
    {
      "from": [
        "trussMove6",
        "out"
      ],
      "to": [
        "trussSolid6",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid6",
        "out"
      ],
      "to": [
        "trussChords",
        "in"
      ]
    },
    {
      "from": [
        "trussMove6",
        "out"
      ],
      "to": [
        "trussCorners",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussMove7",
        "in"
      ]
    },
    {
      "from": [
        "trussMove7",
        "out"
      ],
      "to": [
        "trussSolid7",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid7",
        "out"
      ],
      "to": [
        "trussBraces",
        "in"
      ]
    },
    {
      "from": [
        "trussChords",
        "out"
      ],
      "to": [
        "trussChordSpawn",
        "in"
      ]
    },
    {
      "from": [
        "trussBraces",
        "out"
      ],
      "to": [
        "trussBraceSpawn",
        "in"
      ]
    },
    {
      "from": [
        "trussPhase",
        "out"
      ],
      "to": [
        "trussKeep",
        "in"
      ]
    },
    {
      "from": [
        "trussKeep",
        "out"
      ],
      "to": [
        "trussRing",
        "in"
      ]
    },
    {
      "from": [
        "trussRing",
        "out"
      ],
      "to": [
        "trussSolid",
        "in"
      ]
    },
    {
      "from": [
        "trussSolid",
        "out"
      ],
      "to": [
        "trussSpawn",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "partDense",
        "in"
      ]
    },
    {
      "from": [
        "partDense",
        "out"
      ],
      "to": [
        "partFrame",
        "in"
      ]
    },
    {
      "from": [
        "partFrame",
        "out"
      ],
      "to": [
        "partDensity",
        "in"
      ]
    },
    {
      "from": [
        "partDensity",
        "out"
      ],
      "to": [
        "partCluster",
        "in"
      ]
    },
    {
      "from": [
        "partCluster",
        "out"
      ],
      "to": [
        "partScatter",
        "in"
      ]
    },
    {
      "from": [
        "partScatter",
        "out"
      ],
      "to": [
        "partAngleAttr",
        "in"
      ]
    },
    {
      "from": [
        "partAngleAttr",
        "out"
      ],
      "to": [
        "partMount",
        "in"
      ]
    },
    {
      "from": [
        "partMount",
        "out"
      ],
      "to": [
        "partPart",
        "in"
      ]
    },
    {
      "from": [
        "partPart",
        "out"
      ],
      "to": [
        "partOrient",
        "in"
      ]
    },
    {
      "from": [
        "partOrient",
        "out"
      ],
      "to": [
        "partSize",
        "in"
      ]
    },
    {
      "from": [
        "partSize",
        "out"
      ],
      "to": [
        "partPartSpawn",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "wrapCells",
        "in"
      ]
    },
    {
      "from": [
        "wrapCells",
        "out"
      ],
      "to": [
        "wrapFrame",
        "in"
      ]
    },
    {
      "from": [
        "wrapCarrierLine",
        "out"
      ],
      "to": [
        "wrapCarrierId",
        "in"
      ]
    },
    {
      "from": [
        "wrapCarrierId",
        "out"
      ],
      "to": [
        "wrapCarriers",
        "in"
      ]
    },
    {
      "from": [
        "wrapCarriers",
        "out"
      ],
      "to": [
        "wrapWraps",
        "each"
      ]
    },
    {
      "from": [
        "wrapFrame",
        "out"
      ],
      "to": [
        "wrapWraps",
        "frame"
      ]
    },
    {
      "from": [
        "wrapWraps",
        "out"
      ],
      "to": [
        "wrapMerged",
        "in"
      ]
    },
    {
      "from": [
        "wrapMerged",
        "out"
      ],
      "to": [
        "wrapSpawn",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "chainAnchors",
        "in"
      ]
    },
    {
      "from": [
        "chainAnchors",
        "out"
      ],
      "to": [
        "chainReach",
        "in"
      ]
    },
    {
      "from": [
        "chainStrand",
        "out"
      ],
      "to": [
        "chainCopies",
        "source"
      ]
    },
    {
      "from": [
        "chainReach",
        "out"
      ],
      "to": [
        "chainCopies",
        "target"
      ]
    },
    {
      "from": [
        "chainCopies",
        "out"
      ],
      "to": [
        "chainChainId",
        "in"
      ]
    },
    {
      "from": [
        "chainChainId",
        "out"
      ],
      "to": [
        "chainChainPath",
        "in"
      ]
    },
    {
      "from": [
        "chainChainPath",
        "out"
      ],
      "to": [
        "chainSegments",
        "in"
      ]
    },
    {
      "from": [
        "chainSegments",
        "out"
      ],
      "to": [
        "chainLinkSize",
        "in"
      ]
    },
    {
      "from": [
        "chainLinkSize",
        "out"
      ],
      "to": [
        "chainAlternate",
        "in"
      ]
    },
    {
      "from": [
        "chainAlternate",
        "out"
      ],
      "to": [
        "chainSpawn",
        "in"
      ]
    },
    {
      "from": [
        "danglerStrand",
        "out"
      ],
      "to": [
        "danglerStrandU",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "danglerAnchors",
        "in"
      ]
    },
    {
      "from": [
        "danglerAnchors",
        "out"
      ],
      "to": [
        "danglerBundling",
        "in"
      ]
    },
    {
      "from": [
        "danglerBundling",
        "out"
      ],
      "to": [
        "danglerDrop",
        "in"
      ]
    },
    {
      "from": [
        "danglerStrandU",
        "out"
      ],
      "to": [
        "danglerCopies",
        "source"
      ]
    },
    {
      "from": [
        "danglerDrop",
        "out"
      ],
      "to": [
        "danglerCopies",
        "target"
      ]
    },
    {
      "from": [
        "danglerCopies",
        "out"
      ],
      "to": [
        "danglerCableId",
        "in"
      ]
    },
    {
      "from": [
        "danglerCableId",
        "out"
      ],
      "to": [
        "danglerCurl",
        "in"
      ]
    },
    {
      "from": [
        "danglerCurl",
        "out"
      ],
      "to": [
        "danglerDanglerPath",
        "in"
      ]
    },
    {
      "from": [
        "danglerDanglerPath",
        "out"
      ],
      "to": [
        "danglerDanglerTube",
        "in"
      ]
    },
    {
      "from": [
        "danglerDanglerTube",
        "out"
      ],
      "to": [
        "danglerDanglerSpawn",
        "in"
      ]
    },
    {
      "from": [
        "spineSpine",
        "out"
      ],
      "to": [
        "drapeDrapeAnchors",
        "in"
      ]
    },
    {
      "from": [
        "drapeDrapeAnchors",
        "out"
      ],
      "to": [
        "drapeChords",
        "in"
      ]
    },
    {
      "from": [
        "drapeChords",
        "out"
      ],
      "to": [
        "drapePick",
        "in"
      ]
    },
    {
      "from": [
        "drapePick",
        "out"
      ],
      "to": [
        "drapeDrapeEven",
        "in"
      ]
    },
    {
      "from": [
        "drapeDrapeEven",
        "out"
      ],
      "to": [
        "drapeSag",
        "in"
      ]
    },
    {
      "from": [
        "drapeSag",
        "out"
      ],
      "to": [
        "drapeDrapeTube",
        "in"
      ]
    },
    {
      "from": [
        "drapeDrapeTube",
        "out"
      ],
      "to": [
        "drapeLong",
        "in"
      ]
    },
    {
      "from": [
        "drapeLong",
        "out"
      ],
      "to": [
        "drapeSome",
        "in"
      ]
    },
    {
      "from": [
        "drapeSome",
        "out"
      ],
      "to": [
        "drapeDrapeSpawn",
        "in"
      ]
    },
    {
      "from": [
        "trussCorners",
        "out"
      ],
      "to": [
        "trussPhase",
        "in"
      ]
    }
  ],
  "outputs": [
    {
      "id": "trussChordSpawn",
      "pin": "instances",
      "name": "truss"
    },
    {
      "id": "trussBraceSpawn",
      "pin": "instances",
      "name": "braces"
    },
    {
      "id": "trussSpawn",
      "pin": "instances",
      "name": "frames"
    },
    {
      "id": "partPartSpawn",
      "pin": "instances",
      "name": "parts"
    },
    {
      "id": "wrapSpawn",
      "pin": "instances",
      "name": "wraps"
    },
    {
      "id": "chainSpawn",
      "pin": "instances",
      "name": "chains"
    },
    {
      "id": "danglerDanglerSpawn",
      "pin": "instances",
      "name": "danglers"
    },
    {
      "id": "drapeDrapeSpawn",
      "pin": "instances",
      "name": "drapes"
    },
    {
      "id": "spineSpine",
      "pin": "out",
      "name": "spinePoints"
    }
  ]
}
`;export{e as default};