var e=`{\r
  "formatVersion": 1,\r
  "seed": 1054,\r
  "meta": {\r
    "title": "shape one falloff six ways",\r
    "description": "SIX SHAPING FUNCTIONS ON ONE INPUT. Every panel is the same grid and the same scalar \`t\` \\u2014 1 at the panel's centre, falling to 0 at its rim, written \`1 - clamp(length(P - centre) / 6, 0, 1)\` \\u2014 lifted by \`6 * f(t)\` and differing only in \`f\`. The six sit in two rows of three, named by coordinate rather than by which one faces you, since that depends on where the camera is: at z = -10, in increasing x, \`t\` itself (a cone, the control), \`sqrt(t)\` (a dome, steep at the rim) and \`t * t\` (a rounded spire); at z = +10, \`pow(t, 3)\` (a sharper spire), \`ramp(t)\` through four stops (the S-curve, flat at both ends) and \`step(0.5, t)\` (a flat-topped mesa \\u2014 a hard cut, not a curve, and the only panel here that leaves the plane it started on). Read across and the choice of \`f\` is the whole difference between a cone and a mesa, which is what makes a falloff an authored decision rather than whatever the arithmetic happened to give. THREE RULES ARE VISIBLE HERE RATHER THAN STATED. \`step\` takes its EDGE FIRST \\u2014 \`step(edge, x)\` is exactly \`ge(x, edge)\` with the operands swapped, and it exists to buy the name a shader author reaches for; getting the order backwards gives the complement, silently. \`pow\` HAS A NARROWER DOMAIN than a host-language power: every negative base is NaN, as are \`pow(0, 0)\` and \`pow(x, 0)\` for a zero, negative, infinite or NaN \`x\`, because the measured device implements it as \`exp2(b * log2(a))\` exactly and the CPU adopts that domain rather than letting the two paths disagree over a whole quadrant. The \`clamp\` inside \`t\` is therefore LOAD-BEARING \\u2014 and in TWO panels rather than one, because \`sqrt\` answers a negative on exactly the same rule. Strip the clamp and this graph fails at the \`sqrt\` panel before it ever reaches \`pow\`: \`transformPoints: param \\"translate\\" resolved to NaN at element 0\`, 254 of that panel's 961 points non-finite. Nor is it decorative in the other four. Only \`ramp\` and \`step\` clamp by construction; \`t\` and \`t * t\` just keep going, the cone dipping 2.5 units BELOW its own plane at a corner and the square lifting a raised rim. The corners are the whole of it either way \\u2014 a 12-unit panel around a radius-6 disc leaves nothing else outside. And \`pow\` carries the widest GPU parity budget of the grammar's ALGEBRAIC fns \\u2014 8 ULP, against bit-exact for \`mul\` and 1 for \`sqrt\`, with only the trigonometric family wider \\u2014 which is why the square is spelled \`t * t\` rather than \`pow(t, 2)\`: \`mul\` for a square, \`sqrt\` for a root, \`ramp\` for a falloff, and \`pow\` only when the exponent is genuinely arbitrary. \`ramp\` is also the shape to reach for when a smooth step is wanted \\u2014 the grammar has no \`smoothstep\`, and a ramp says where its knees are instead of hiding them in a cubic. ONE MORE THING THIS FILE SHOWS BY BEING LONG: the \`t\` subexpression is written out six times, because nothing yet lets one expression bind a name to a subexpression it uses more than once. That is the A3 entry in PLAN.md, and this graph is now its second worked case.",\r
    "tags": [\r
      "basics",\r
      "fields",\r
      "remap",\r
      "composition"\r
    ]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid_linear",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -22.0,\r
          0,\r
          -16.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_linear",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "sub",\r
                  "args": [\r
                    1,\r
                    {\r
                      "fn": "clamp",\r
                      "args": [\r
                        {\r
                          "fn": "div",\r
                          "args": [\r
                            {\r
                              "fn": "length",\r
                              "args": [\r
                                {\r
                                  "fn": "sub",\r
                                  "args": [\r
                                    {\r
                                      "fn": "position"\r
                                    },\r
                                    {\r
                                      "fn": "vec",\r
                                      "args": [\r
                                        -16,\r
                                        0,\r
                                        -10\r
                                      ]\r
                                    }\r
                                  ]\r
                                }\r
                              ]\r
                            },\r
                            6.0\r
                          ]\r
                        },\r
                        0,\r
                        1\r
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
      "id": "grid_sqrt",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -6.0,\r
          0,\r
          -16.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_sqrt",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "sqrt",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            0,\r
                                            0,\r
                                            -10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
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
      "id": "grid_square",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          10.0,\r
          0,\r
          -16.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_square",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "mul",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            16,\r
                                            0,\r
                                            -10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            16,\r
                                            0,\r
                                            -10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
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
      "id": "grid_pow",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -22.0,\r
          0,\r
          4.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_pow",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "pow",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            -16,\r
                                            0,\r
                                            10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
                          ]\r
                        }\r
                      ]\r
                    },\r
                    3\r
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
      "id": "grid_ramp",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          -6.0,\r
          0,\r
          4.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_ramp",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "ramp",\r
                  "args": [\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            0,\r
                                            0,\r
                                            10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
                          ]\r
                        }\r
                      ]\r
                    }\r
                  ],\r
                  "stops": [\r
                    [\r
                      0,\r
                      0\r
                    ],\r
                    [\r
                      0.35,\r
                      0.06\r
                    ],\r
                    [\r
                      0.65,\r
                      0.94\r
                    ],\r
                    [\r
                      1,\r
                      1\r
                    ]\r
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
      "id": "grid_step",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 31,\r
        "countZ": 31,\r
        "spacing": [\r
          0.4,\r
          1,\r
          0.4\r
        ],\r
        "origin": [\r
          10.0,\r
          0,\r
          4.0\r
        ]\r
      }\r
    },\r
    {\r
      "id": "shape_step",\r
      "type": "transformPoints",\r
      "params": {\r
        "translate": {\r
          "fn": "vec",\r
          "args": [\r
            0,\r
            {\r
              "fn": "mul",\r
              "args": [\r
                6.0,\r
                {\r
                  "fn": "step",\r
                  "args": [\r
                    0.5,\r
                    {\r
                      "fn": "sub",\r
                      "args": [\r
                        1,\r
                        {\r
                          "fn": "clamp",\r
                          "args": [\r
                            {\r
                              "fn": "div",\r
                              "args": [\r
                                {\r
                                  "fn": "length",\r
                                  "args": [\r
                                    {\r
                                      "fn": "sub",\r
                                      "args": [\r
                                        {\r
                                          "fn": "position"\r
                                        },\r
                                        {\r
                                          "fn": "vec",\r
                                          "args": [\r
                                            16,\r
                                            0,\r
                                            10\r
                                          ]\r
                                        }\r
                                      ]\r
                                    }\r
                                  ]\r
                                },\r
                                6.0\r
                              ]\r
                            },\r
                            0,\r
                            1\r
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
      "id": "chart",\r
      "type": "mergePoints",\r
      "params": {}\r
    }\r
  ],\r
  "connections": [\r
    {\r
      "from": [\r
        "grid_linear",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_linear",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_linear",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_sqrt",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_sqrt",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_sqrt",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_square",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_square",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_square",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_pow",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_pow",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_pow",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_ramp",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_ramp",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_ramp",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "grid_step",\r
        "out"\r
      ],\r
      "to": [\r
        "shape_step",\r
        "in"\r
      ]\r
    },\r
    {\r
      "from": [\r
        "shape_step",\r
        "out"\r
      ],\r
      "to": [\r
        "chart",\r
        "in"\r
      ]\r
    }\r
  ],\r
  "outputs": [\r
    {\r
      "id": "chart",\r
      "pin": "out",\r
      "name": "points"\r
    }\r
  ]\r
}\r
`;export{e as default};