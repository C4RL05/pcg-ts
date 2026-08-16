var e=`{\r
  "formatVersion": 1,\r
  "seed": 3,\r
  "meta": {\r
    "title": "a suspended rig, built from curves",\r
    "description": "A box truss follows a spline pushed around by two noises: four chords with zigzag bracing and square frames every few bays. Components are scattered over it in noise clusters and aimed radially, chains hang it from the ceiling, cables wrap along it, and two more kinds hang off it — a fringe gathered into bundles, and swags strung between anchors. The cables are a \`forEach\`: one body cooked once per cable, each seeded on its own carrier, where this used to need one hand-built branch per cable and so could not be a saved graph at all. The wander is a plain \`transformPoints\`: the three numbers shaping it — how far it drifts up, how far sideways, and how fast — are \`param\` spec nodes carrying their own values inside its \`translate\` expression, and the sandbox reads each as a knob. It used to be a one-node subgraph, because a param could only be DECLARED on a wrapper, and the wrapper existed for nothing else. \`wanderScale\` is named twice in that one expression and is still one knob writing both — the case that made a wrapper look unavoidable. Everything that was drawn as a tube is a real surface now: \`sweepProfile\` skins the chords, the braces, the frames, the cables, the fringe and the swags, every one of which used to end at \`pathSegments\` with a unit cylinder landing on each segment — half the drawn triangles, because rings are shared between segments and no interior caps grow, and nine \`extend\` settings gone with them, because a continuous skin leaves no wedge at a bend to fill. The chains do NOT sweep, and that is the line between the two nodes: \`pathSegments\` still has a job of its own, one oriented asset per segment, and a chain of separate links is exactly that job — what it lost is the borrowed one, faking a tube. Four chords reach ONE sweep rather than four, because a sweep reads a geometry and a geometry holds as many polylines as you like: each strut arrives from \`pathResample\` already a polyline, \`transformPoints\` moves it without touching that topology, and \`mergePrimitives\` unions the four KEEPING it, so the sweep gets four paths in one geometry and the chord radius stays a single knob rather than one knob mirrored into four. Two numbers this graph reads over and over are declared once at the top, under \`params\`, and read by name from the expressions that need them: \`trussHalfWidth\` was eighteen literals in four different float spellings of 0.425 — the chords at ± it, the braces and the component mounts at it × √2 — and \`cableRadius\` was three nodes that only the panel's \`also\` knew were one gauge of rope. A node-scoped param cannot say either of those, because the thing being said is that several nodes share one value. It used to tag every strut with a \`strutId\`, merge the POINTS, and rebuild the same four paths with \`pointsToPath\` — ten nodes spent throwing topology away and putting it back, because the topology-preserving union did not exist yet when this graph was written. The frames still regroup, and that contrast is the useful one: their rings connect the four chords ACROSS each station, topology that never existed anywhere upstream, so \`pointsToPath\` over \`stationId\` BUILDS something rather than restoring it — and the filter feeding it drops three points in four, which no union could have preserved. The chains and the fringe reach that same grouping from the other end: \`copyToPoints\` writes each copy's anchor index itself, through \`targetIndexAttr\`, and \`pointsToPath\` groups by it. Carrying it needed a \`setAttribute\` on the anchors first, writing an \`index\` field into a column whose only reader was \`targetNames\` — the node had already computed that index to place the copies, so both of those are gone. Before that the id was recovered arithmetically — \`floor(index / 35)\` for the chains and \`floor(index / 17)\` for the fringe — where the 35 and the 17 were the source strand's point count written out a second time, in another node, with nothing holding the two together. Editing the strand welded every chain into one path and said nothing. The swags are gated BEFORE the sweep now, which is where a gate has to sit once the thing downstream of it is a surface: \`connectPoints\` writes \`edgeLength\` on the primitive domain and the pick lands there too, so \`filterPrimitivesByAttribute\` cuts 456 chords to 63 while they are still polylines — gating the segment cloud afterwards, which is what this graph used to do, meant building 7.24 times the geometry that survives. The components are proportioned by KIND rather than by one draw wearing four hats: one \`byAttribute\` reads the string \`part\` and hands back that kind's whole vec3, so a rod lengthens along the radius it points down, a bar along the chord it lies on, a panel widens on both of its faces while staying slab-thin, and a clamp is a squat collar rather than a cube. It was three nested \`lerp\`s over three \`attributeIs\` calls, written out once per AXIS — and \`clamp\` was in none of them, so it fell through all three to the uniform base scale and stayed there, because a fall-through nobody writes is a fall-through nobody can find. Its \`default\` is the same sentence made explicit: any part kind this expression does not name keeps the base scale, unstretched, and now says so. Eight declared outputs, one per part, plus the bare spine, so a viewer can tell them apart. The seed box re-rolls what is keyed on a node seed — where the components land, which chords get hung, how far each cable drops, and the four scalars that make each wrap its own — and the noises with it: six of the eight fbm fields fold \`nodeSeed\` into \`opts.position\` as a bounded shift, so the spine takes a different wander and the clusters a different shape, rather than the same frozen field being walked over by points that moved. Each of those six also carries a \`variant\` param of its own, an inline value added into the fold before it is scaled, so ONE noise can be re-rolled while the rest hold still — a node has a single seed, so until a param could sit inside a plain node's expression the spine's two noises could only move together, and the four scalars this graph needed had to be folded into literal noise seeds before it was saved. Every variant defaults to 0, so the shift is still exactly zero at seed 3 and the spine is the spine this file has always cooked — the flattening moved the node's id, and with it the seed the fold is calibrated against, so the three constants that zero it were re-derived rather than left to drift. The cable wraps are the deliberate exception: their body is a \`forEach\`, whose seed varies per item, and their wobble already re-rolls through \`randomField\`.",\r
    "tags": [\r
      "examples",\r
      "curves",\r
      "foreach",\r
      "surface",\r
      "instancing",\r
      "rig"\r
    ]\r
  },\r
  "params": [\r
    {\r
      "name": "cableRadius",\r
      "value": 0.035,\r
      "min": 0.005,\r
      "max": 0.2,\r
      "description": "Radius of every rope on the rig — the cable wraps, the fringe strands and the swags — in world units. One value because they are one gauge of rope, which the graph had no way to say: it lived in three nodes, and only the panel's \`also\` knew they were one thing."\r
    },\r
    {\r
      "name": "trussHalfWidth",\r
      "value": 0.425,\r
      "min": 0.15,\r
      "max": 1.2,\r
      "description": "Half the width of the box truss, in world units: the distance from the spine out to each chord. The four chords sit at ± this along the curve normal and binormal, and the diagonal braces and component mounts at this × √2 — eighteen readings of one number, previously written in four different float spellings of it, so this is the knob that sizes the truss."\r
    }\r
  ],\r
  "nodes": [\r
    {\r
      "id": "spineLine",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 97,\r
        "start": [\r
          -17,\r
          7,\r
          0\r
        ],\r
        "end": [\r
          17,\r
          7,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "spineWander",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "verticalAmplitude",\r
                  "value": 1.2,\r
                  "min": 0,\r
                  "max": 8,\r
                  "description": "How far the spine wanders up and down, in world units, multiplied into a perlin fBm that is already centred on zero — so 0 gives a straight spine."\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": 4178438610,\r
                    "frequency": 0.035,\r
                    "position": {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "param",\r
                              "name": "wanderScale",\r
                              "value": 1,\r
                              "min": 0.1,\r
                              "max": 8,\r
                              "description": "Scales the position both noises are sampled at, so larger means a tighter, faster wander and 1 is the wander the graph was authored with. It is a MULTIPLIER rather than a frequency because that is what keeps the default exact: the base frequency stays in the noise, where it multiplies in f64, and x1.0 through the position column is the identity. One name, read twice in one expression — so this single knob reaches both noises."\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "vec",\r
                          "args": [\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 1021] }] }] }, 0.6426391602] }, 900] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 3067] }] }] }, 0.2977294922] }, 900] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantUp", "value": 0 }] }, 8191] }] }] }, 0.0173339844] }, 900] }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 3,\r
                    "lacunarity": 2,\r
                    "gain": 0.5\r
                  }\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "horizontalAmplitude",\r
                  "value": 2.4,\r
                  "min": 0,\r
                  "max": 12,\r
                  "description": "How far the spine wanders sideways over the same run, on its own noise seed, so the two axes drift independently instead of tracing one curve in a plane."\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": 2443226542,\r
                    "frequency": 0.035,\r
                    "position": {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "param",\r
                              "name": "wanderScale",\r
                              "value": 1\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "vec",\r
                          "args": [\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 3067] }] }] }, 0.2977294922] }, 900] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 8191] }] }] }, 0.0173339844] }, 900] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "variantAcross", "value": 0 }] }, 1021] }] }] }, 0.6426391602] }, 900] }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 3,\r
                    "lacunarity": 2,\r
                    "gain": 0.5\r
                  }\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "spineSpinePath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "spineSpine",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 130,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "trussCells",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 46,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "trussFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "trussStation",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "stationId",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "index"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "trussMove0",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove2",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove4",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove6",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "param",\r
                  "name": "trussHalfWidth"\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "param",\r
                      "name": "trussHalfWidth"\r
                    },\r
                    -1\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussCorners",\r
      "type": "mergePrimitives",\r
      "params": {}\r
    },\r
    {\r
      "id": "trussChordSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": 0.055,\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "trussMove1",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove3",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865476\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove5",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865475\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussMove7",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865474\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "lerp",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": -0.7071067811865477\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.7071067811865474\r
                        },\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "div",\r
                                      "args": [\r
                                        {\r
                                          "fn": "index"\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 2\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "trussBraces",\r
      "type": "mergePrimitives",\r
      "params": {}\r
    },\r
    {\r
      "id": "trussBraceSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": 0.03,\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "trussPhase",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "framePhase",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "sub",\r
          "args": [\r
            {\r
              "fn": "attribute",\r
              "name": "stationId",\r
              "tupleSize": 1\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 4\r
                },\r
                {\r
                  "fn": "floor",\r
                  "args": [\r
                    {\r
                      "fn": "div",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "stationId",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "constant",\r
                          "value": 4\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "trussKeep",\r
      "type": "filterByAttribute",\r
      "params": {\r
        "attribute": "framePhase",\r
        "comparison": "lt",\r
        "value": 0.5,\r
        "stringValue": ""\r
      }\r
    },\r
    {\r
      "id": "trussRing",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": true,\r
        "groupAttr": "stationId",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "trussFrameSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": 0.03,\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "partDense",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 900,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "partFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "partDensity",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "density",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fbm",\r
          "base": "perlinNoise",\r
          "opts": {\r
            "seed": 2616234397,\r
            "frequency": 14,\r
            "offset": [\r
              0,\r
              0,\r
              0\r
            ],\r
            "position": {\r
              "fn": "add",\r
              "args": [\r
                {\r
                  "fn": "vec",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "curveU",\r
                      "tupleSize": 1\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 0\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 0\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "vec",\r
                  "args": [\r
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 1021] }] }] }, 0.0648269653] }, 2.5] },\r
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 3067] }] }] }, 0.660949707] }, 2.5] },\r
                    { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "clusterVariant", "value": 0 }] }, 8191] }] }] }, 0.200744629] }, 2.5] }\r
                  ]\r
                }\r
              ]\r
            },\r
            "octaves": 2,\r
            "lacunarity": 2,\r
            "gain": 0.5,\r
            "normalized": true\r
          }\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partCluster",\r
      "type": "filterByDensity",\r
      "params": {\r
        "mode": "threshold",\r
        "threshold": 0.46,\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partScatter",\r
      "type": "jitterPoints",\r
      "params": {\r
        "amount": [\r
          0.01888888888888889,\r
          0.01888888888888889,\r
          0.01888888888888889\r
        ],\r
        "seed": 3098584255\r
      }\r
    },\r
    {\r
      "id": "partPart",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "part",\r
        "domain": "point",\r
        "type": "string",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "randomField",\r
              "key": "part"\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 9\r
            }\r
          ]\r
        },\r
        "values": [\r
          "rod",\r
          "rod",\r
          "rod",\r
          "rod",\r
          "bar",\r
          "bar",\r
          "panel",\r
          "clamp",\r
          "clamp"\r
        ],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partAngleAttr",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "radialAngle",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "randomField",\r
              "key": "radial"\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 6.283185307179586\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partMount",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "cos",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 1.5707963267948966\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "div",\r
                                          "args": [\r
                                            {\r
                                              "fn": "sub",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "radialAngle",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.7853981633974483\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 1.5707963267948966\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 0.5\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.7853981633974483\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "param",\r
                          "name": "trussHalfWidth"\r
                        },\r
                        1.4142135623730951\r
                      ]\r
                    },\r
                    {\r
                      "fn": "sin",\r
                      "args": [\r
                        {\r
                          "fn": "add",\r
                          "args": [\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 1.5707963267948966\r
                                },\r
                                {\r
                                  "fn": "floor",\r
                                  "args": [\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "div",\r
                                          "args": [\r
                                            {\r
                                              "fn": "sub",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "radialAngle",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.7853981633974483\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 1.5707963267948966\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 0.5\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.7853981633974483\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "partOrient",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "attribute",\r
          "name": "tangent",\r
          "tupleSize": 3\r
        },\r
        "up": {\r
          "fn": "add",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "cos",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "radialAngle",\r
                      "tupleSize": 1\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveNormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "sin",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "radialAngle",\r
                      "tupleSize": 1\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "attribute",\r
                  "name": "curveBinormal",\r
                  "tupleSize": 3\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "partSize",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "mul",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                { "fn": "param", "name": "partScale", "value": 1 },\r
                { "fn": "lerp", "args": [0.55, 1.45, { "fn": "randomField", "key": "size" }] }\r
              ]\r
            },\r
            {\r
              "fn": "byAttribute",\r
              "name": "part",\r
              "cases": {\r
                "rod": { "fn": "vec", "args": [1, { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] }, 1] },\r
                "bar": { "fn": "vec", "args": [1, 1, { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] }] },\r
                "panel": { "fn": "vec", "args": [{ "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] }, 0.7, { "fn": "lerp", "args": [0.55, 1.6, { "fn": "randomField", "key": "stretch" }] }] },\r
                "clamp": [1.25, 0.5, 1.25]\r
              },\r
              "default": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "partPartSpawn",\r
      "type": "spawnInstances",\r
      "params": {\r
        "assetId": "rod",\r
        "assetAttr": "part",\r
        "colorAttr": ""\r
      }\r
    },\r
    {\r
      "id": "wrapCells",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 150,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "wrapFrame",\r
      "type": "writeCurveFrame",\r
      "params": {\r
        "tangentName": "tangent",\r
        "normalName": "curveNormal",\r
        "binormalName": "curveBinormal"\r
      }\r
    },\r
    {\r
      "id": "wrapCarrierLine",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 16,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          15,\r
          0,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "wrapCarrierId",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "wrapId",\r
        "domain": "point",\r
        "type": "i32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "index"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "wrapCarriers",\r
      "type": "partitionByAttribute",\r
      "params": {\r
        "name": "wrapId"\r
      }\r
    },\r
    {\r
      "id": "wrapWraps",\r
      "type": "forEach",\r
      "params": {\r
        "cableRadius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        }\r
      },\r
      "subgraph": {\r
        "graph": {\r
          "formatVersion": 1,\r
          "seed": 0,\r
          "nodes": [\r
            {\r
              "id": "wrapPick_wphase",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wphase",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wphase"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapPick_wturns",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wturns",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wturns"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapPick_wspread",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wspread",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wspread"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapPick_wofs",\r
              "type": "setAttribute",\r
              "params": {\r
                "name": "wofs",\r
                "domain": "point",\r
                "type": "f32",\r
                "tupleSize": 1,\r
                "value": {\r
                  "fn": "randomField",\r
                  "key": "wofs"\r
                },\r
                "values": [],\r
                "stringValue": "",\r
                "seed": 0\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wphase",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wphase",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wturns",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wturns",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wspread",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wspread",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapOnto_wofs",\r
              "type": "transferAttribute",\r
              "params": {\r
                "name": "wofs",\r
                "mapping": "nearest",\r
                "attrDomain": "point",\r
                "uvAttr": "uv",\r
                "direction": [\r
                  0,\r
                  -1,\r
                  0\r
                ],\r
                "directionAttr": "",\r
                "maxDistance": 0,\r
                "missCountAttr": "",\r
                "hitAttr": ""\r
              }\r
            },\r
            {\r
              "id": "wrapMove",\r
              "type": "transformPoints",\r
              "params": {\r
                "translate": {\r
                  "fn": "add",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "add",\r
                              "args": [\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.6010407640085654\r
                                    },\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 1.1\r
                                        },\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "mul",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 0.55\r
                                            }\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.14\r
                                    },\r
                                    {\r
                                      "fn": "fbm",\r
                                      "base": "perlinNoise",\r
                                      "opts": {\r
                                        "seed": 2459580991,\r
                                        "frequency": 0.35,\r
                                        "offset": [\r
                                          0,\r
                                          0,\r
                                          0\r
                                        ],\r
                                        "position": {\r
                                          "fn": "add",\r
                                          "args": [\r
                                            {\r
                                              "fn": "position"\r
                                            },\r
                                            {\r
                                              "fn": "vec",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "mul",\r
                                                  "args": [\r
                                                    {\r
                                                      "fn": "attribute",\r
                                                      "name": "wofs",\r
                                                      "tupleSize": 1\r
                                                    },\r
                                                    {\r
                                                      "fn": "constant",\r
                                                      "value": 1000\r
                                                    }\r
                                                  ]\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0\r
                                                }\r
                                              ]\r
                                            }\r
                                          ]\r
                                        },\r
                                        "octaves": 2,\r
                                        "lacunarity": 2,\r
                                        "gain": 0.5\r
                                      }\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "cos",\r
                              "args": [\r
                                {\r
                                  "fn": "add",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "wphase",\r
                                          "tupleSize": 1\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 6.283185307179586\r
                                        }\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "lerp",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.4\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 3.5\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wturns",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 6.283185307179586\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "curveU",\r
                                          "tupleSize": 1\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "curveNormal",\r
                          "tupleSize": 3\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "add",\r
                              "args": [\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.6010407640085654\r
                                    },\r
                                    {\r
                                      "fn": "add",\r
                                      "args": [\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 1.1\r
                                        },\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "mul",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wspread",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 0.55\r
                                            }\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                {\r
                                  "fn": "mul",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 0.14\r
                                    },\r
                                    {\r
                                      "fn": "fbm",\r
                                      "base": "perlinNoise",\r
                                      "opts": {\r
                                        "seed": 2459580991,\r
                                        "frequency": 0.35,\r
                                        "offset": [\r
                                          0,\r
                                          0,\r
                                          0\r
                                        ],\r
                                        "position": {\r
                                          "fn": "add",\r
                                          "args": [\r
                                            {\r
                                              "fn": "position"\r
                                            },\r
                                            {\r
                                              "fn": "vec",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "mul",\r
                                                  "args": [\r
                                                    {\r
                                                      "fn": "attribute",\r
                                                      "name": "wofs",\r
                                                      "tupleSize": 1\r
                                                    },\r
                                                    {\r
                                                      "fn": "constant",\r
                                                      "value": 1000\r
                                                    }\r
                                                  ]\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0\r
                                                }\r
                                              ]\r
                                            }\r
                                          ]\r
                                        },\r
                                        "octaves": 2,\r
                                        "lacunarity": 2,\r
                                        "gain": 0.5\r
                                      }\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            {\r
                              "fn": "sin",\r
                              "args": [\r
                                {\r
                                  "fn": "add",\r
                                  "args": [\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "wphase",\r
                                          "tupleSize": 1\r
                                        },\r
                                        {\r
                                          "fn": "constant",\r
                                          "value": 6.283185307179586\r
                                        }\r
                                      ]\r
                                    },\r
                                    {\r
                                      "fn": "mul",\r
                                      "args": [\r
                                        {\r
                                          "fn": "mul",\r
                                          "args": [\r
                                            {\r
                                              "fn": "lerp",\r
                                              "args": [\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 0.4\r
                                                },\r
                                                {\r
                                                  "fn": "constant",\r
                                                  "value": 3.5\r
                                                },\r
                                                {\r
                                                  "fn": "attribute",\r
                                                  "name": "wturns",\r
                                                  "tupleSize": 1\r
                                                }\r
                                              ]\r
                                            },\r
                                            {\r
                                              "fn": "constant",\r
                                              "value": 6.283185307179586\r
                                            }\r
                                          ]\r
                                        },\r
                                        {\r
                                          "fn": "attribute",\r
                                          "name": "curveU",\r
                                          "tupleSize": 1\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "curveBinormal",\r
                          "tupleSize": 3\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                "rotateEuler": [\r
                  0,\r
                  0,\r
                  0\r
                ],\r
                "scale": [\r
                  1,\r
                  1,\r
                  1\r
                ]\r
              }\r
            },\r
            {\r
              "id": "wrapSkin",\r
              "type": "sweepProfile",\r
              "params": {\r
                "profile": "circle",\r
                "sides": 8,\r
                "radius": 0.035,\r
                "frame": "upHint",\r
                "up": [\r
                  0,\r
                  1,\r
                  0\r
                ],\r
                "roll": 0,\r
                "joint": "miter",\r
                "miterLimit": 4,\r
                "caps": true\r
              }\r
            }\r
          ],\r
          "connections": [\r
            {\r
              "from": [\r
                "wrapPick_wphase",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapPick_wturns",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wturns",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapPick_wspread",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapPick_wofs",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wofs",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wphase",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wofs",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wturns",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wphase",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wturns",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wofs",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wspread",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wturns",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wspread",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapPick_wofs",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wofs",\r
                "source"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wspread",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapOnto_wofs",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapOnto_wofs",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapMove",\r
                "in"\r
              ]\r
            },\r
            {\r
              "from": [\r
                "wrapMove",\r
                "out"\r
              ],\r
              "to": [\r
                "wrapSkin",\r
                "in"\r
              ]\r
            }\r
          ],\r
          "outputs": []\r
        },\r
        "inputs": [\r
          {\r
            "name": "each",\r
            "node": "wrapPick_wphase",\r
            "pin": "in"\r
          },\r
          {\r
            "name": "frame",\r
            "node": "wrapOnto_wphase",\r
            "pin": "in"\r
          }\r
        ],\r
        "outputs": [\r
          {\r
            "name": "out",\r
            "node": "wrapSkin",\r
            "pin": "out"\r
          }\r
        ],\r
        "params": [\r
          {\r
            "name": "cableRadius",\r
            "targets": [\r
              {\r
                "node": "wrapSkin",\r
                "param": "radius"\r
              }\r
            ],\r
            "description": "Radius of the tube each wrap is drawn as.",\r
            "default": 0.035,\r
            "min": 0.005,\r
            "max": 0.2\r
          }\r
        ]\r
      }\r
    },\r
    {\r
      "id": "chainStrand",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 35,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "chainAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 7,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "chainReach",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            },\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 13\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "position"\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "chainCopies",\r
      "type": "copyToPoints",\r
      "params": {\r
        "targetNames": [],\r
        "targetIndexAttr": "anchorId"\r
      }\r
    },\r
    {\r
      "id": "chainChainPath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "anchorId",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "chainSegments",\r
      "type": "pathSegments",\r
      "params": {\r
        "axis": "+y",\r
        "radius": 1,\r
        "extend": 0\r
      }\r
    },\r
    {\r
      "id": "chainLinkSize",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1.3\r
                },\r
                {\r
                  "fn": "component",\r
                  "args": [\r
                    {\r
                      "fn": "attribute",\r
                      "name": "scale",\r
                      "tupleSize": 3\r
                    }\r
                  ],\r
                  "index": 1\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "chainAlternate",\r
      "type": "orientAlongVector",\r
      "params": {\r
        "direction": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 1\r
                },\r
                {\r
                  "fn": "sub",\r
                  "args": [\r
                    {\r
                      "fn": "index"\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 2\r
                        },\r
                        {\r
                          "fn": "floor",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "index"\r
                                },\r
                                {\r
                                  "fn": "constant",\r
                                  "value": 2\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "sub",\r
              "args": [\r
                {\r
                  "fn": "index"\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 2\r
                    },\r
                    {\r
                      "fn": "floor",\r
                      "args": [\r
                        {\r
                          "fn": "div",\r
                          "args": [\r
                            {\r
                              "fn": "index"\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 2\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "up": {\r
          "fn": "attribute",\r
          "name": "tangent",\r
          "tupleSize": 3\r
        },\r
        "axis": "+z"\r
      }\r
    },\r
    {\r
      "id": "chainSpawn",\r
      "type": "spawnInstances",\r
      "params": {\r
        "assetId": "chainLink",\r
        "assetAttr": "",\r
        "colorAttr": ""\r
      }\r
    },\r
    {\r
      "id": "danglerStrand",\r
      "type": "pointLine",\r
      "params": {\r
        "count": 17,\r
        "start": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "end": [\r
          0,\r
          -1,\r
          0\r
        ],\r
        "includeEnd": true\r
      }\r
    },\r
    {\r
      "id": "danglerStrandU",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "cableU",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "fraction"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "danglerAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 100,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "danglerBundling",\r
      "type": "pathPointAt",\r
      "params": {\r
        "mode": "fraction",\r
        "parameter": {\r
          "fn": "lerp",\r
          "args": [\r
            {\r
              "fn": "attribute",\r
              "name": "curveU",\r
              "tupleSize": 1\r
            },\r
            {\r
              "fn": "div",\r
              "args": [\r
                {\r
                  "fn": "add",\r
                  "args": [\r
                    {\r
                      "fn": "floor",\r
                      "args": [\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "attribute",\r
                              "name": "curveU",\r
                              "tupleSize": 1\r
                            },\r
                            {\r
                              "fn": "constant",\r
                              "value": 7\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "constant",\r
                  "value": 7\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0.8\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "danglerDrop",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "scale",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": 3.2\r
                },\r
                {\r
                  "fn": "lerp",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.55\r
                    },\r
                    {\r
                      "fn": "constant",\r
                      "value": 1\r
                    },\r
                    {\r
                      "fn": "randomField",\r
                      "key": "drop0"\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 1\r
            }\r
          ]\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "danglerCopies",\r
      "type": "copyToPoints",\r
      "params": {\r
        "targetNames": [],\r
        "targetIndexAttr": "anchorId"\r
      }\r
    },\r
    {\r
      "id": "danglerCurl",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": 2098766061,\r
                    "frequency": 0.5,\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 2,\r
                    "lacunarity": 2,\r
                    "gain": 0.5,\r
                    "position": {\r
                      "fn": "add",\r
                      "args": [\r
                        { "fn": "position" },\r
                        {\r
                          "fn": "vec",\r
                          "args": [\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 1021] }] }] }, 0.51373291] }, 64] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 3067] }] }] }, 0.395263672] }, 64] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantX", "value": 0 }] }, 8191] }] }] }, 0.520996094] }, 64] }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  }\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "constant",\r
                      "value": 0.5\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "attribute",\r
                          "name": "cableU",\r
                          "tupleSize": 1\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                },\r
                {\r
                  "fn": "fbm",\r
                  "base": "perlinNoise",\r
                  "opts": {\r
                    "seed": 1211183335,\r
                    "frequency": 0.5,\r
                    "offset": [\r
                      0,\r
                      0,\r
                      0\r
                    ],\r
                    "octaves": 2,\r
                    "lacunarity": 2,\r
                    "gain": 0.5,\r
                    "position": {\r
                      "fn": "add",\r
                      "args": [\r
                        { "fn": "position" },\r
                        {\r
                          "fn": "vec",\r
                          "args": [\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 3067] }] }] }, 0.395263672] }, 64] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 8191] }] }] }, 0.520996094] }, 64] },\r
                            { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "curlVariantZ", "value": 0 }] }, 1021] }] }] }, 0.51373291] }, 64] }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  }\r
                }\r
              ]\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "danglerDanglerPath",\r
      "type": "pointsToPath",\r
      "params": {\r
        "closed": false,\r
        "groupAttr": "anchorId",\r
        "orderAttr": ""\r
      }\r
    },\r
    {\r
      "id": "danglerDanglerSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeAnchors",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 34,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "drapeChords",\r
      "type": "connectPoints",\r
      "params": {\r
        "mode": "radius",\r
        "radius": 20,\r
        "degreeAttr": "",\r
        "lengthAttr": "edgeLength"\r
      }\r
    },\r
    {\r
      "id": "drapePick",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "chordPick",\r
        "domain": "primitive",\r
        "type": "f32",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "randomField",\r
          "key": "chord0"\r
        },\r
        "values": [],\r
        "stringValue": "",\r
        "seed": 0\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeEven",\r
      "type": "pathResample",\r
      "params": {\r
        "mode": "count",\r
        "count": 23,\r
        "spacing": 1\r
      }\r
    },\r
    {\r
      "id": "drapeSag",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            },\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "constant",\r
                  "value": -1\r
                },\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "add",\r
                      "args": [\r
                        {\r
                          "fn": "constant",\r
                          "value": 0.45\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "constant",\r
                              "value": 0.36000000000000004\r
                            },\r
                            {\r
                              "fn": "fbm",\r
                              "base": "perlinNoise",\r
                              "opts": {\r
                                "seed": 1367222746,\r
                                "frequency": 0.06,\r
                                "offset": [\r
                                  0,\r
                                  0,\r
                                  0\r
                                ],\r
                                "octaves": 1,\r
                                "lacunarity": 2,\r
                                "gain": 0.5,\r
                                "position": {\r
                                  "fn": "add",\r
                                  "args": [\r
                                    { "fn": "position" },\r
                                    {\r
                                      "fn": "vec",\r
                                      "args": [\r
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 1021] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 1021] }] }] }, 0.0917510986] }, 500] },\r
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 3067] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 3067] }] }] }, 0.761413574] }, 500] },\r
                                        { "fn": "mul", "args": [{ "fn": "sub", "args": [{ "fn": "sub", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 8191] }, { "fn": "floor", "args": [{ "fn": "mul", "args": [{ "fn": "add", "args": [{ "fn": "mul", "args": [{ "fn": "nodeSeed" }, 2.3283064365386963e-10] }, { "fn": "param", "name": "sagVariant", "value": 0 }] }, 8191] }] }] }, 0.529418945] }, 500] }\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              }\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        {\r
                          "fn": "attribute",\r
                          "name": "edgeLength",\r
                          "tupleSize": 1\r
                        },\r
                        {\r
                          "fn": "mul",\r
                          "args": [\r
                            {\r
                              "fn": "constant",\r
                              "value": 4\r
                            },\r
                            {\r
                              "fn": "mul",\r
                              "args": [\r
                                {\r
                                  "fn": "attribute",\r
                                  "name": "curveU",\r
                                  "tupleSize": 1\r
                                },\r
                                {\r
                                  "fn": "sub",\r
                                  "args": [\r
                                    {\r
                                      "fn": "constant",\r
                                      "value": 1\r
                                    },\r
                                    {\r
                                      "fn": "attribute",\r
                                      "name": "curveU",\r
                                      "tupleSize": 1\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            }\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ]\r
            },\r
            {\r
              "fn": "constant",\r
              "value": 0\r
            }\r
          ]\r
        },\r
        "rotateEuler": [\r
          0,\r
          0,\r
          0\r
        ],\r
        "scale": [\r
          1,\r
          1,\r
          1\r
        ]\r
      }\r
    },\r
    {\r
      "id": "drapeLong",\r
      "type": "filterPrimitivesByAttribute",\r
      "params": {\r
        "attribute": "edgeLength",\r
        "comparison": "ge",\r
        "value": 4,\r
        "stringValue": "",\r
        "unreferencedPoints": "keep"\r
      }\r
    },\r
    {\r
      "id": "drapeSome",\r
      "type": "filterPrimitivesByAttribute",\r
      "params": {\r
        "attribute": "chordPick",\r
        "comparison": "lt",\r
        "value": 0.16,\r
        "stringValue": "",\r
        "unreferencedPoints": "drop"\r
      }\r
    },\r
    {\r
      "id": "drapeDrapeSkin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 8,\r
        "radius": {\r
          "fn": "param",\r
          "name": "cableRadius"\r
        },\r
        "frame": "upHint",\r
        "up": [\r
          0,\r
          1,\r
          0\r
        ],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "spineLine",\r
        "out"\r
      ],\r
      "to": [\r
        "spineWander",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineWander",\r
        "out"\r
      ],\r
      "to": [\r
        "spineSpinePath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpinePath",\r
        "out"\r
      ],\r
      "to": [\r
        "spineSpine",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCells",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCells",\r
        "out"\r
      ],\r
      "to": [\r
        "trussFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "trussStation",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove0",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove0",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove2",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove2",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove4",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove4",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove6",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove6",\r
        "out"\r
      ],\r
      "to": [\r
        "trussCorners",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCorners",\r
        "out"\r
      ],\r
      "to": [\r
        "trussChordSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove1",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove1",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove3",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove3",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove5",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove5",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussStation",\r
        "out"\r
      ],\r
      "to": [\r
        "trussMove7",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussMove7",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraces",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussBraces",\r
        "out"\r
      ],\r
      "to": [\r
        "trussBraceSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussCorners",\r
        "out"\r
      ],\r
      "to": [\r
        "trussPhase",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussPhase",\r
        "out"\r
      ],\r
      "to": [\r
        "trussKeep",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussKeep",\r
        "out"\r
      ],\r
      "to": [\r
        "trussRing",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "trussRing",\r
        "out"\r
      ],\r
      "to": [\r
        "trussFrameSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "partDense",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partDense",\r
        "out"\r
      ],\r
      "to": [\r
        "partFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "partDensity",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partDensity",\r
        "out"\r
      ],\r
      "to": [\r
        "partCluster",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partCluster",\r
        "out"\r
      ],\r
      "to": [\r
        "partScatter",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partScatter",\r
        "out"\r
      ],\r
      "to": [\r
        "partAngleAttr",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partAngleAttr",\r
        "out"\r
      ],\r
      "to": [\r
        "partMount",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partMount",\r
        "out"\r
      ],\r
      "to": [\r
        "partPart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partPart",\r
        "out"\r
      ],\r
      "to": [\r
        "partOrient",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partOrient",\r
        "out"\r
      ],\r
      "to": [\r
        "partSize",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "partSize",\r
        "out"\r
      ],\r
      "to": [\r
        "partPartSpawn",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCells",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCells",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapFrame",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarrierLine",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCarrierId",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarrierId",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapCarriers",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapCarriers",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapWraps",\r
        "each"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "wrapFrame",\r
        "out"\r
      ],\r
      "to": [\r
        "wrapWraps",\r
        "frame"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "chainAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "chainReach",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainStrand",\r
        "out"\r
      ],\r
      "to": [\r
        "chainCopies",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainReach",\r
        "out"\r
      ],\r
      "to": [\r
        "chainCopies",\r
        "target"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainCopies",\r
        "out"\r
      ],\r
      "to": [\r
        "chainChainPath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainChainPath",\r
        "out"\r
      ],\r
      "to": [\r
        "chainSegments",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainSegments",\r
        "out"\r
      ],\r
      "to": [\r
        "chainLinkSize",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainLinkSize",\r
        "out"\r
      ],\r
      "to": [\r
        "chainAlternate",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "chainAlternate",\r
        "out"\r
      ],\r
      "to": [\r
        "chainSpawn",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerStrand",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerStrandU",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerBundling",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerBundling",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerDrop",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerStrandU",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCopies",\r
        "source"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerDrop",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCopies",\r
        "target"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerCopies",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerCurl",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerCurl",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerDanglerPath",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "spineSpine",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeAnchors",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeDrapeAnchors",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeChords",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeChords",\r
        "out"\r
      ],\r
      "to": [\r
        "drapePick",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapePick",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeEven",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeDrapeEven",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeSag",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "danglerDanglerPath",\r
        "out"\r
      ],\r
      "to": [\r
        "danglerDanglerSkin",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeSag",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeLong",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeLong",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeSome",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "drapeSome",\r
        "out"\r
      ],\r
      "to": [\r
        "drapeDrapeSkin",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "trussChordSkin",\r
      "pin": "out",\r
      "name": "truss"\r
    },\r
    {\r
      "id": "trussBraceSkin",\r
      "pin": "out",\r
      "name": "braces"\r
    },\r
    {\r
      "id": "trussFrameSkin",\r
      "pin": "out",\r
      "name": "frames"\r
    },\r
    {\r
      "id": "partPartSpawn",\r
      "pin": "instances",\r
      "name": "parts"\r
    },\r
    {\r
      "id": "wrapWraps",\r
      "pin": "out",\r
      "name": "wraps"\r
    },\r
    {\r
      "id": "chainSpawn",\r
      "pin": "instances",\r
      "name": "chains"\r
    },\r
    {\r
      "id": "danglerDanglerSkin",\r
      "pin": "out",\r
      "name": "danglers"\r
    },\r
    {\r
      "id": "drapeDrapeSkin",\r
      "pin": "out",\r
      "name": "drapes"\r
    },\r
    {\r
      "id": "spineSpine",\r
      "pin": "out",\r
      "name": "spinePoints"\r
    }\r
  ]\r
}\r
`;export{e as default};