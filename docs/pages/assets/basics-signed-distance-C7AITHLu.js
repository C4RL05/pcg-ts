var e=`{\r
  "formatVersion": 1,\r
  "seed": 1058,\r
  "meta": {\r
    "title": "a signed distance field, and which side of it",\r
    "description": "A SIGNED DISTANCE FIELD, which is what \`distance\` and \`sign\` are for together. \`distance(P, centre) - 12\` is negative inside a circle of radius 12, zero on it and positive outside \\u2014 one number that carries both HOW FAR and WHICH SIDE, and splitting those two questions apart is the whole idiom. \`sign\` answers the second, \`abs\` the first, and the height here multiplies them: \`sign(sd) * 5 * exp(-0.30 * |sd|)\` raises a rim outside the circle and sinks a trench inside it, both decaying away from the boundary. The result is a crater, and the ring where it crosses zero is the shape the field was defined by. \`sign\` IS EXACT ON BOTH PATHS, and that is a design decision rather than a measurement that happened to come out clean: it is defined as \`(x > 0) - (x < 0)\`, a pair of comparisons with no interior to round, so the device and the CPU cannot disagree. Two answers depart from a host language on purpose \\u2014 a NaN gets 0 rather than NaN, and a negative zero gets +0 \\u2014 because a rule both paths execute exactly beats a rule one of them approximates. Neither input occurs in this cook, which is the ordinary case: the departures matter where a field feeds \`sign\` something degenerate, not on a clean grid. It is what \`normalize\` already does to a scalar; it exists to buy the NAME, on the precedent \`step\` set, since nobody reaches for a vector normalizer to ask which side of a line they are on. The exact-zero case is REACHABLE but unreached here, and the arithmetic says why: a grid point lands on the circle only where its integer offsets satisfy j^2 + k^2 = 711.11, which none do. The nearest sits 0.0075 off it, so the deepest trench and the highest rim come out at 4.989 rather than the nominal 5 \\u2014 which is the cooked bounds, and a neat demonstration that a sampled field only ever shows you the samples. \`distance\` IS EXACTLY \`length(sub(a, b))\`, pinned by a test rather than merely intended \\u2014 the difference is rounded to f32 before it is squared, because that is what \`sub\` stores and what the device subtracts, so the fused spelling cannot drift from the composed one. It is the fn \`basics-field-shaping\` open-codes seven times over, and its measured GPU budget is 1 ULP against \`length\`'s 4, because that family compounds two fns in one measurement where this is a single square root over a subtraction. THE COLOUR IS THE SIGN, not the height, which is why the two regions read as different materials rather than as one surface with a fold in it: a ramp with stops at -1, 0 and +1 can take only three values, because \`sign\` only ever produces three. In this cook it takes TWO \\u2014 no point lands on the circle, so the middle stop is never selected, and it sits there for the boundary case rather than for anything visible.",\r
    "tags": [\r
      "basics",\r
      "fields",\r
      "distance-falloff",\r
      "composition"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 111,\r
        "countZ": 111,\r
        "spacing": [\r
          0.45,\r
          1,\r
          0.45\r
        ],\r
        "origin": [\r
          -24.75,\r
          0,\r
          -24.75\r
        ]\r
      }\r
    },\r
    {\r
      "id": "crater",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "sign",\r
                      "args": [\r
                        {\r
                          "fn": "sub",\r
                          "args": [\r
                            {\r
                              "fn": "distance",\r
                              "args": [\r
                                {\r
                                  "fn": "position"\r
                                },\r
                                {\r
                                  "fn": "vec",\r
                                  "args": [\r
                                    0,\r
                                    0,\r
                                    0\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            12.0\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    5\r
                  ]\r
                },\r
                {\r
                  "fn": "exp",\r
                  "args": [\r
                    {\r
                      "fn": "mul",\r
                      "args": [\r
                        -0.3,\r
                        {\r
                          "fn": "abs",\r
                          "args": [\r
                            {\r
                              "fn": "sub",\r
                              "args": [\r
                                {\r
                                  "fn": "distance",\r
                                  "args": [\r
                                    {\r
                                      "fn": "position"\r
                                    },\r
                                    {\r
                                      "fn": "vec",\r
                                      "args": [\r
                                        0,\r
                                        0,\r
                                        0\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                12.0\r
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
            0\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "sides",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "color",\r
        "domain": "point",\r
        "type": "f32",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "sign",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        {\r
                          "fn": "distance",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "vec",\r
                              "args": [\r
                                0,\r
                                0,\r
                                0\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        12.0\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  -1,\r
                  0.24\r
                ],\r
                [\r
                  0,\r
                  0.9\r
                ],\r
                [\r
                  1,\r
                  0.96\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "sign",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        {\r
                          "fn": "distance",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "vec",\r
                              "args": [\r
                                0,\r
                                0,\r
                                0\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        12.0\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  -1,\r
                  0.46\r
                ],\r
                [\r
                  0,\r
                  0.9\r
                ],\r
                [\r
                  1,\r
                  0.62\r
                ]\r
              ]\r
            },\r
            {\r
              "fn": "ramp",\r
              "args": [\r
                {\r
                  "fn": "sign",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        {\r
                          "fn": "distance",\r
                          "args": [\r
                            {\r
                              "fn": "position"\r
                            },\r
                            {\r
                              "fn": "vec",\r
                              "args": [\r
                                0,\r
                                0,\r
                                0\r
                              ]\r
                            }\r
                          ]\r
                        },\r
                        12.0\r
                      ]\r
                    }\r
                  ]\r
                }\r
              ],\r
              "stops": [\r
                [\r
                  -1,\r
                  0.78\r
                ],\r
                [\r
                  0,\r
                  0.9\r
                ],\r
                [\r
                  1,\r
                  0.28\r
                ]\r
              ]\r
            }\r
          ]\r
        }\r
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
        "crater",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "crater",\r
        "out"\r
      ],\r
      "to": [\r
        "sides",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "sides",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};