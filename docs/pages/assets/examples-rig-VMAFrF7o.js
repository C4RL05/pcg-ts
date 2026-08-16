var e=`{
  "formatVersion": 1,
  "seed": 3,
  "meta": {
    "title": "a suspended rig, built from curves",
    "description": "A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a \`forEach\`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. The wander is a plain \`transformPoints\`: the three numbers shaping it — how far it drifts up, how far sideways, and how fast — are \`param\` spec nodes carrying their own values inside its \`translate\` expression, and the sandbox reads each as a knob. It used to be a one-node subgraph, because a param could only be DECLARED on a wrapper, and the wrapper existed for nothing else. \`wanderScale\` is named twice in that one expression and is still one knob writing both — the case that made a wrapper look unavoidable. Everything that was drawn as a tube is a real surface now: \`sweepProfile\` skins the chords, the braces, the frames, the cables, the fringe and the swags, every one of which used to end at \`pathSegments\` with a unit cylinder landing on each segment — half the drawn triangles, because rings are shared between segments and no interior caps grow, and nine \`extend\` settings gone with them, because a continuous skin leaves no wedge at a bend to fill. The chains do NOT sweep, and that is the line between the two nodes: \`pathSegments\` still has a job of its own, one oriented asset per segment, and a chain of separate links is exactly that job — what it lost is the borrowed one, faking a tube. Four chords reach ONE sweep rather than four, because a sweep reads a geometry and a geometry holds as many polylines as you like: each strut is tagged with a \`strutId\` before it is moved, the four are merged, and \`pointsToPath\` groups them back into four paths — the same idiom the frames use, and it leaves the chord radius a single knob rather than one knob mirrored into four. The chains and the fringe reach that same grouping from the other end: \`copyToPoints\` now carries the anchor's own \`anchorId\` onto every copy through \`targetNames\`, and \`pointsToPath\` groups by it. The id used to be recovered arithmetically instead — \`floor(index / 35)\` for the chains and \`floor(index / 17)\` for the fringe — where the 35 and the 17 were the source strand's point count written out a second time, in another node, with nothing holding the two together. Editing the strand welded every chain into one path and said nothing. The swags are gated BEFORE the sweep now, which is where a gate has to sit once the thing downstream of it is a surface: \`connectPoints\` writes \`edgeLength\` on the primitive domain and the pick lands there too, so \`filterPrimitivesByAttribute\` cuts 456 chords to 63 while they are still polylines — gating the segment cloud afterwards, which is what this graph used to do, meant building 7.24 times the geometry that survives. The components are proportioned by KIND rather than by one draw wearing four hats: \`attributeIs\` reads the string \`part\` as a 0 or a 1 and blends on it, so a rod lengthens along the radius it points down, a bar along the chord it lies on, and a panel widens on both of its faces while staying slab-thin. Four kinds shared one shape law until a string could reach a field expression. Eight declared outputs, one per part, plus the bare spine, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — and the noises with it: six of the eight fbm fields fold \`nodeSeed\` into \`opts.position\` as a bounded shift, so the spine takes a different wander and the clusters a different shape, rather than the same frozen field being walked over by points that moved. Each of those six also carries a \`variant\` param of its own, an inline value added into the fold before it is scaled, so ONE noise can be re-rolled while the rest hold still — a node has a single seed, so until a param could sit inside a plain node's expression the spine's two noises could only move together, and the four scalars this graph needed had to be folded into literal noise seeds before it was saved. Every variant defaults to 0, so the shift is still exactly zero at seed 3 and the spine is the spine this file has always cooked — the flattening moved the node's id, and with it the seed the fold is calibrated against, so the three constants that zero it were re-derived rather than left to drift. The cable wraps are the deliberate exception: their body is a \`forEach\`, whose seed varies per item, and their wobble already re-rolls through \`randomField\`.",
    "tags": [
      "examples",
      "curves",
      "foreach",
      "surface",
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
                  "fn": "param",
                  "name": "verticalAmplitude",
                  "value": 1.2
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 4178438610,
                    "frequency": 0.035,
                    "position": {
                      "fn": "add",
                      "args": [
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "position"
                            },
                            {
                              "fn": "param",
                              "name": "wanderScale",
                              "value": 1
                            }
                          ]
                        },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 1021] }] }] }, 0.6426391602] }, 900] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 3067] }] }] }, 0.2977294922] }, 900] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 8191] }] }] }, 0.0173339844] }, 900] }
                          ]
                        }
                      ]
                    },
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
                  "fn": "param",
                  "name": "horizontalAmplitude",
                  "value": 2.4
                },
                {
                  "fn": "fbm",
                  "base": "perlinNoise",
                  "opts": {
                    "seed": 2443226542,
                    "frequency": 0.035,
                    "position": {
                      "fn": "add",
                      "args": [
                        {
                          "fn": "mul",
                          "args": [
                            {
                              "fn": "position"
                            },
                            {
                              "fn": "param",
                              "name": "wanderScale",
                              "value": 1
                            }
                          ]
                        },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 3067] }] }] }, 0.2977294922] }, 900] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 8191] }] }] }, 0.0173339844] }, 900] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 1021] }] }] }, 0.6426391602] }, 900] }
                          ]
                        }
                      ]
                    },
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
      "id": "trussTag0",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 0
        },
        "values": [],
        "stringValue": "",
        "seed": 0
      }
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
      "id": "trussTag2",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 1
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussTag4",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 2
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussTag6",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 3
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussCorners",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "trussChordPath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "strutId",
        "orderAttr": ""
      }
    },
    {
      "id": "trussChordSkin",
      "type": "sweepProfile",
      "params": {
        "profile": "circle",
        "sides": 8,
        "radius": 0.055,
        "frame": "upHint",
        "up": [
          0,
          1,
          0
        ],
        "roll": 0,
        "joint": "miter",
        "miterLimit": 4,
        "caps": true
      }
    },
    {
      "id": "trussTag1",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 0
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussTag3",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 1
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussTag5",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 2
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussTag7",
      "type": "setAttribute",
      "params": {
        "name": "strutId",
        "domain": "point",
        "type": "i32",
        "tupleSize": 1,
        "value": {
          "fn": "constant",
          "value": 3
        },
        "values": [],
        "stringValue": "",
        "seed": 0
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
      "id": "trussBraces",
      "type": "mergePoints",
      "params": {}
    },
    {
      "id": "trussBracePath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "strutId",
        "orderAttr": ""
      }
    },
    {
      "id": "trussBraceSkin",
      "type": "sweepProfile",
      "params": {
        "profile": "circle",
        "sides": 8,
        "radius": 0.03,
        "frame": "upHint",
        "up": [
          0,
          1,
          0
        ],
        "roll": 0,
        "joint": "miter",
        "miterLimit": 4,
        "caps": true
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
      "id": "trussFrameSkin",
      "type": "sweepProfile",
      "params": {
        "profile": "circle",
        "sides": 8,
        "radius": 0.03,
        "frame": "upHint",
        "up": [
          0,
          1,
          0
        ],
        "roll": 0,
        "joint": "miter",
        "miterLimit": 4,
        "caps": true
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
              "fn": "add",
              "args": [
                {
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
                {
                  "fn": "vec",
                  "args": [
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 1021] }] }] }, 0.0648269653] }, 2.5] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 3067] }] }] }, 0.660949707] }, 2.5] },
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 8191] }] }] }, 0.200744629] }, 2.5] }
                  ]
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
                  "fn": "mul",
                  "args": [
                    { "fn": "param", "name": "partScale", "value": 1 },
                    { "fn": "lerp", "args": [0.55, 1.45, { "fn": "randomField", "key": "size" }] }
                  ]
                },
                {
                  "fn": "lerp",
                  "args": [
                    1,
                    { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] },
                    { "fn": "attributeIs", "name": "part", "value": "panel" }
                  ]
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    { "fn": "param", "name": "partScale", "value": 1 },
                    { "fn": "lerp", "args": [0.55, 1.45, { "fn": "randomField", "key": "size" }] }
                  ]
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "lerp",
                      "args": [
                        1,
                        { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] },
                        { "fn": "attributeIs", "name": "part", "value": "rod" }
                      ]
                    },
                    0.7,
                    { "fn": "attributeIs", "name": "part", "value": "panel" }
                  ]
                }
              ]
            },
            {
              "fn": "mul",
              "args": [
                {
                  "fn": "mul",
                  "args": [
                    { "fn": "param", "name": "partScale", "value": 1 },
                    { "fn": "lerp", "args": [0.55, 1.45, { "fn": "randomField", "key": "size" }] }
                  ]
                },
                {
                  "fn": "lerp",
                  "args": [
                    {
                      "fn": "lerp",
                      "args": [
                        1,
                        { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] },
                        { "fn": "attributeIs", "name": "part", "value": "bar" }
                      ]
                    },
                    { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] },
                    { "fn": "attributeIs", "name": "part", "value": "panel" }
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
              "id": "wrapSkin",
              "type": "sweepProfile",
              "params": {
                "profile": "circle",
                "sides": 8,
                "radius": 0.035,
                "frame": "upHint",
                "up": [
                  0,
                  1,
                  0
                ],
                "roll": 0,
                "joint": "miter",
                "miterLimit": 4,
                "caps": true
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
                "wrapSkin",
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
            "node": "wrapSkin",
            "pin": "out"
          }
        ],
        "params": [
          {
            "name": "cableRadius",
            "targets": [
              {
                "node": "wrapSkin",
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
      "id": "chainAnchorId",
      "type": "setAttribute",
      "params": {
        "name": "anchorId",
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
      "id": "chainCopies",
      "type": "copyToPoints",
      "params": {
        "targetNames": [
          "anchorId"
        ]
      }
    },
    {
      "id": "chainChainPath",
      "type": "pointsToPath",
      "params": {
        "closed": false,
        "groupAttr": "anchorId",
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
        "count": 100,
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
      "id": "danglerAnchorId",
      "type": "setAttribute",
      "params": {
        "name": "anchorId",
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
      "id": "danglerCopies",
      "type": "copyToPoints",
      "params": {
        "targetNames": [
          "anchorId"
        ]
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
                    "gain": 0.5,
                    "position": {
                      "fn": "add",
                      "args": [
                        { "fn": "position" },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 1021] }] }] }, 0.51373291] }, 64] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 3067] }] }] }, 0.395263672] }, 64] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 8191] }] }] }, 0.520996094] }, 64] }
                          ]
                        }
                      ]
                    }
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
                    "gain": 0.5,
                    "position": {
                      "fn": "add",
                      "args": [
                        { "fn": "position" },
                        {
                          "fn": "vec",
                          "args": [
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 3067] }] }] }, 0.395263672] }, 64] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 8191] }] }] }, 0.520996094] }, 64] },
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 1021] }] }] }, 0.51373291] }, 64] }
                          ]
                        }
                      ]
                    }
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
        "groupAttr": "anchorId",
        "orderAttr": ""
      }
    },
    {
      "id": "danglerDanglerSkin",
      "type": "sweepProfile",
      "params": {
        "profile": "circle",
        "sides": 8,
        "radius": 0.035,
        "frame": "upHint",
        "up": [
          0,
          1,
          0
        ],
        "roll": 0,
        "joint": "miter",
        "miterLimit": 4,
        "caps": true
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
                                "gain": 0.5,
                                "position": {
                                  "fn": "add",
                                  "args": [
                                    { "fn": "position" },
                                    {
                                      "fn": "vec",
                                      "args": [
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 1021] }] }] }, 0.0917510986] }, 500] },
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 3067] }] }] }, 0.761413574] }, 500] },
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 8191] }] }] }, 0.529418945] }, 500] }
                                      ]
                                    }
                                  ]
                                }
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
      "id": "drapeLong",
      "type": "filterPrimitivesByAttribute",
      "params": {
        "attribute": "edgeLength",
        "comparison": "ge",
        "value": 4,
        "stringValue": "",
        "unreferencedPoints": "keep"
      }
    },
    {
      "id": "drapeSome",
      "type": "filterPrimitivesByAttribute",
      "params": {
        "attribute": "chordPick",
        "comparison": "lt",
        "value": 0.16,
        "stringValue": "",
        "unreferencedPoints": "drop"
      }
    },
    {
      "id": "drapeDrapeSkin",
      "type": "sweepProfile",
      "params": {
        "profile": "circle",
        "sides": 8,
        "radius": 0.035,
        "frame": "upHint",
        "up": [
          0,
          1,
          0
        ],
        "roll": 0,
        "joint": "miter",
        "miterLimit": 4,
        "caps": true
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
        "trussTag0",
        "in"
      ]
    },
    {
      "from": [
        "trussTag0",
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
        "trussTag2",
        "in"
      ]
    },
    {
      "from": [
        "trussTag2",
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
        "trussTag4",
        "in"
      ]
    },
    {
      "from": [
        "trussTag4",
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
        "trussTag6",
        "in"
      ]
    },
    {
      "from": [
        "trussTag6",
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
        "trussCorners",
        "in"
      ]
    },
    {
      "from": [
        "trussCorners",
        "out"
      ],
      "to": [
        "trussChordPath",
        "in"
      ]
    },
    {
      "from": [
        "trussChordPath",
        "out"
      ],
      "to": [
        "trussChordSkin",
        "in"
      ]
    },
    {
      "from": [
        "trussStation",
        "out"
      ],
      "to": [
        "trussTag1",
        "in"
      ]
    },
    {
      "from": [
        "trussTag1",
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
        "trussTag3",
        "in"
      ]
    },
    {
      "from": [
        "trussTag3",
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
        "trussTag5",
        "in"
      ]
    },
    {
      "from": [
        "trussTag5",
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
        "trussTag7",
        "in"
      ]
    },
    {
      "from": [
        "trussTag7",
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
        "trussBraces",
        "in"
      ]
    },
    {
      "from": [
        "trussBraces",
        "out"
      ],
      "to": [
        "trussBracePath",
        "in"
      ]
    },
    {
      "from": [
        "trussBracePath",
        "out"
      ],
      "to": [
        "trussBraceSkin",
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
        "trussFrameSkin",
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
        "chainAnchorId",
        "in"
      ]
    },
    {
      "from": [
        "chainAnchorId",
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
        "danglerAnchorId",
        "in"
      ]
    },
    {
      "from": [
        "danglerAnchorId",
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
        "danglerDanglerPath",
        "out"
      ],
      "to": [
        "danglerDanglerSkin",
        "in"
      ]
    },
    {
      "from": [
        "drapeSag",
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
        "drapeDrapeSkin",
        "in"
      ]
    }
  ],
  "outputs": [
    {
      "id": "trussChordSkin",
      "pin": "out",
      "name": "truss"
    },
    {
      "id": "trussBraceSkin",
      "pin": "out",
      "name": "braces"
    },
    {
      "id": "trussFrameSkin",
      "pin": "out",
      "name": "frames"
    },
    {
      "id": "partPartSpawn",
      "pin": "instances",
      "name": "parts"
    },
    {
      "id": "wrapWraps",
      "pin": "out",
      "name": "wraps"
    },
    {
      "id": "chainSpawn",
      "pin": "instances",
      "name": "chains"
    },
    {
      "id": "danglerDanglerSkin",
      "pin": "out",
      "name": "danglers"
    },
    {
      "id": "drapeDrapeSkin",
      "pin": "out",
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